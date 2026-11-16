const { TicketStore, verifiedTokenExpiry } = require('../lib/ws-tickets');
const { ServiceError } = require('../lib/errors');
const { messageResponse } = require('../lib/chat-store');

function exactKeys(value, keys) {
    return value && typeof value === 'object' && !Array.isArray(value) &&
        Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key));
}

function validateSend(frame) {
    if (!exactKeys(frame, ['event', 'conversation_id', 'client_message_id', 'type', 'text']) ||
        frame.event !== 'message.send' || frame.type !== 'TEXT' ||
        typeof frame.conversation_id !== 'string' || !/^[a-f0-9]{24}$/i.test(frame.conversation_id) ||
        typeof frame.client_message_id !== 'string' || !/^[A-Za-z0-9_-]{8,64}$/.test(frame.client_message_id) ||
        typeof frame.text !== 'string' || !frame.text.trim() || frame.text.trim().length > 4000) {
        throw new ServiceError(400, 'VALIDATION_ERROR', 'Send a TEXT message of 1–4000 characters with a conversation ID and client message ID');
    }
    return { ...frame, text: frame.text.trim() };
}

async function routes(fastify, options) {
    const {
        allowedOrigins = [], ticketTtlMs = 30000, authTimeoutMs = 5000,
        sessionMaxMs = 15 * 60 * 1000, maxConnectionsPerUser = 10
    } = options;
    const tickets = new TicketStore({ ttlMs: ticketTtlMs });
    const sockets = new Set();
    const byUser = new Map();
    const processing = new Set();
    let closing = false;

    function send(socket, frame) {
        if (socket.readyState !== socket.OPEN) return;
        if (socket.bufferedAmount > 1024 * 1024) { socket.terminate(); return; }
        socket.send(JSON.stringify(frame), (error) => { if (error) socket.terminate(); });
    }

    function errorFrame(socket, error, clientMessageId = null) {
        const known = error instanceof ServiceError;
        send(socket, {
            event: 'error', client_message_id: clientMessageId,
            status: known ? error.statusCode : 503,
            code: known ? error.code : 'STORAGE_UNAVAILABLE',
            message: known ? error.message : 'Chat storage is unavailable; retry with the same client message ID'
        });
        if (!known) fastify.log.error({ name: error.name, code: error.code }, 'WebSocket message operation failed');
    }

    const heartbeat = setInterval(() => {
        tickets.purge();
        for (const connection of sockets) {
            if (!connection.alive) { connection.socket.terminate(); continue; }
            connection.alive = false;
            if (connection.socket.readyState === connection.socket.OPEN) connection.socket.ping();
        }
    }, 30000);
    heartbeat.unref();

    fastify.addHook('preClose', async () => {
        closing = true;
        clearInterval(heartbeat);
        tickets.clear();
        for (const connection of sockets) connection.socket.terminate();
        await Promise.allSettled([...processing]);
        byUser.clear();
    });

    fastify.post('/ws/tickets', { preHandler: fastify.authenticate }, async (request, reply) => {
        const tokenExpiresAt = verifiedTokenExpiry(request.authorization);
        const ticket = tickets.issue(request.user.id, request.authorization, tokenExpiresAt);
        return reply.header('Cache-Control', 'no-store').send({ ...ticket, ws_path: '/ws' });
    });

    fastify.get('/ws', {
        websocket: true,
        preValidation: async (request) => {
            if (request.raw.url.includes('?')) throw new ServiceError(400, 'VALIDATION_ERROR', 'WebSocket credentials must be sent in the first frame, not the URL');
            const origin = request.headers.origin;
            if (origin && !allowedOrigins.includes(origin)) throw new ServiceError(403, 'FORBIDDEN', 'WebSocket origin is not allowed');
            if (closing || sockets.size >= 1000) throw new ServiceError(503, 'UNAVAILABLE', 'WebSocket capacity is unavailable');
        }
    }, (socket) => {
        const connection = { socket, session: null, alive: true };
        sockets.add(connection);
        let queue = Promise.resolve();
        let queuedFrames = 0;
        let expiryTimer;
        const authTimer = setTimeout(() => {
            errorFrame(socket, new ServiceError(401, 'UNAUTHORIZED', 'Authenticate with a WebSocket ticket within five seconds'));
            socket.close(1008, 'Authentication timeout');
        }, authTimeoutMs);
        authTimer.unref();

        socket.on('pong', () => { connection.alive = true; });
        socket.on('error', () => { socket.terminate(); });
        socket.on('close', () => {
            clearTimeout(authTimer); clearTimeout(expiryTimer);
            sockets.delete(connection);
            if (connection.session) {
                const group = byUser.get(connection.session.userId);
                group?.delete(connection);
                if (group?.size === 0) byUser.delete(connection.session.userId);
                connection.session = null;
            }
        });

        async function handle(raw, binary) {
            if (socket.readyState !== socket.OPEN || closing) return;
            let frame;
            try {
                if (binary) throw new ServiceError(400, 'VALIDATION_ERROR', 'Only JSON text frames are supported');
                try { frame = JSON.parse(raw.toString()); } catch { throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid JSON frame'); }
                if (!connection.session) {
                    if (!exactKeys(frame, ['event', 'ticket']) || frame.event !== 'authenticate') {
                        throw new ServiceError(401, 'UNAUTHORIZED', 'Authenticate with a one-use WebSocket ticket first');
                    }
                    const entry = tickets.consume(frame.ticket);
                    const user = await fastify.verifyUser(entry.authorization);
                    if (user.id !== entry.userId || entry.tokenExpiresAt <= Date.now()) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid or expired token');
                    if (socket.readyState !== socket.OPEN || closing) return;
                    const group = byUser.get(user.id) ?? new Set();
                    if (group.size >= maxConnectionsPerUser) throw new ServiceError(429, 'RATE_LIMITED', 'Too many chat connections for this user');
                    const expiresAt = Math.min(entry.tokenExpiresAt, Date.now() + sessionMaxMs);
                    connection.session = { userId: user.id, authorization: entry.authorization, expiresAt };
                    group.add(connection); byUser.set(user.id, group);
                    clearTimeout(authTimer);
                    expiryTimer = setTimeout(() => {
                        errorFrame(socket, new ServiceError(401, 'UNAUTHORIZED', 'Chat session expired; obtain a new ticket'));
                        socket.close(1008, 'Session expired');
                    }, expiresAt - Date.now());
                    expiryTimer.unref();
                    send(socket, { event: 'ready', user_id: user.id, expires_at: new Date(expiresAt).toISOString() });
                    return;
                }
                const session = connection.session;
                if (session.expiresAt <= Date.now()) throw new ServiceError(401, 'UNAUTHORIZED', 'Chat session expired');
                const message = validateSend(frame);
                const user = await fastify.verifyUser(session.authorization);
                if (user.id !== session.userId) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid session identity');
                const conversation = await fastify.chatStore.requireConversation(message.conversation_id, user.id);
                const otherId = conversation.participantIds.find(id => id !== user.id);
                await fastify.sports.assertFriend(session.authorization, otherId);
                if (socket.readyState !== socket.OPEN || closing || session.expiresAt <= Date.now()) return;
                const saved = await fastify.chatStore.saveText(message.conversation_id, user.id, message.client_message_id, message.text);
                const response = messageResponse(saved.message);
                send(socket, { event: 'message.ack', client_message_id: message.client_message_id, duplicate: saved.duplicate, message: response });
                if (!saved.duplicate) {
                    for (const participantId of conversation.participantIds) {
                        for (const recipient of byUser.get(participantId) ?? []) {
                            if (recipient.socket !== socket && recipient.session?.expiresAt > Date.now()) {
                                send(recipient.socket, { event: 'message.received', message: response });
                            }
                        }
                    }
                }
            } catch (error) {
                const clientId = typeof frame?.client_message_id === 'string' && /^[A-Za-z0-9_-]{8,64}$/.test(frame.client_message_id) ? frame.client_message_id : null;
                errorFrame(socket, error, clientId);
                if (!connection.session || error.statusCode === 401 || error.code === 'FORBIDDEN') socket.close(1008, 'Authentication or access denied');
            }
        }

        // Attach synchronously, before any asynchronous authentication or storage work.
        socket.on('message', (raw, binary) => {
            if (queuedFrames >= 20) {
                errorFrame(socket, new ServiceError(429, 'RATE_LIMITED', 'Too many queued chat events'));
                socket.close(1008, 'Too many events');
                return;
            }
            queuedFrames++;
            const job = queue.then(() => handle(raw, binary)).finally(() => { queuedFrames--; processing.delete(job); });
            processing.add(job);
            queue = job.catch(() => { socket.terminate(); });
        });
    });
}

module.exports = routes;
