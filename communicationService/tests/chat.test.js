const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const Fastify = require('fastify');
const WebSocket = require('ws');
const { buildApp } = require('../app');
const { startMongo } = require('./support/mongo');

// Explicit opt-in: never fall back to MONGODB_URI or a running local database.
test('private chat with isolated MongoDB, real HTTP, WebSockets and Gateway', {
    skip: !process.env.BASKETCOACH_MONGOD_PATH && 'Set BASKETCOACH_MONGOD_PATH to run isolated MongoDB integration tests',
    timeout: 90000
}, async (t) => {
    const gatewayRoutes = require('../../apiGateway/routes/pruebas');
    const mongo = await startMongo(process.env.BASKETCOACH_MONGOD_PATH);
    const sockets = new Set();
    let app, gateway, sports;
    t.after(async () => {
        for (const socket of sockets) socket.terminate();
        await gateway?.close();
        await app?.close();
        await sports?.close();
        await mongo.stop();
    });

    const tokens = new Map([1, 2, 3].map(id => [id,
        `header.${Buffer.from(JSON.stringify({ sub: String(id), exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.mock-signature`
    ]));
    const users = new Map([1, 2, 3].map(id => [id, {
        id, name: `Private name ${id}`, role: id === 1 ? 'coach' : 'player', is_active: true
    }]));
    let friends = true;
    let publicUnavailable = false;
    const sportsCalls = [];
    sports = Fastify();
    sports.addHook('preHandler', async (request, reply) => {
        sportsCalls.push(request.url);
        const id = [...tokens].find(([, token]) => request.headers.authorization === `Bearer ${token}`)?.[0];
        if (!id || !users.get(id).is_active) return reply.code(401).send({ detail: 'Invalid token' });
        request.mockUser = users.get(id);
    });
    sports.get('/users/me', async request => ({ ...request.mockUser, email: 'never-send-this@example.com' }));
    sports.get('/users/:id/public', async (request, reply) => {
        if (publicUnavailable) return reply.code(503).send({ detail: 'Unavailable' });
        const target = users.get(Number(request.params.id));
        if (!target?.is_active) return reply.code(404).send({ detail: 'Not found' });
        return {
            id: target.id, role: target.role, username: `player_${target.id}`, avatar_media_id: null,
            friendship_status: friends && [1, 2].includes(request.mockUser.id) && [1, 2].includes(target.id) ? 'FRIENDS' : 'NONE',
            email: 'private@example.com', name: target.name
        };
    });
    await sports.listen({ host: '127.0.0.1', port: 0 });
    const sportsUrl = `http://127.0.0.1:${sports.server.address().port}`;
    app = buildApp({ logger: false, config: {
        mongoUri: mongo.uri, mongoDbName: 'basketcoach_chat_isolated_test', mediaRoot: mongo.mediaRoot,
        sportsServiceUrl: sportsUrl, corsOrigins: ['http://localhost:5173']
    } });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const direct = `http://127.0.0.1:${app.server.address().port}`;
    const oldCommunication = process.env.COMMUNICATION_SERVICE_URL;
    const oldSports = process.env.SPORTS_SERVICE_URL;
    process.env.COMMUNICATION_SERVICE_URL = direct;
    process.env.SPORTS_SERVICE_URL = sportsUrl;
    gateway = Fastify();
    try {
        gateway.register(gatewayRoutes);
        await gateway.listen({ host: '127.0.0.1', port: 0 });
    } finally {
        if (oldCommunication === undefined) delete process.env.COMMUNICATION_SERVICE_URL;
        else process.env.COMMUNICATION_SERVICE_URL = oldCommunication;
        if (oldSports === undefined) delete process.env.SPORTS_SERVICE_URL;
        else process.env.SPORTS_SERVICE_URL = oldSports;
    }
    const gatewayBase = `http://127.0.0.1:${gateway.server.address().port}`;
    const base = `${gatewayBase}/api/communication`;

    async function http(userId, path, method = 'GET', body) {
        const response = await fetch(base + path, {
            method, headers: { Authorization: `Bearer ${tokens.get(userId) ?? 'invalid'}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
            ...(body ? { body: JSON.stringify(body) } : {})
        });
        return { status: response.status, body: await response.json() };
    }

    async function openSocket(ticket, url = `${base.replace('http:', 'ws:')}/ws`, origin = 'http://localhost:5173') {
        const socket = new WebSocket(url, { origin });
        sockets.add(socket);
        const frames = [];
        const waiting = [];
        socket.on('message', data => {
            const frame = JSON.parse(data.toString());
            const index = waiting.findIndex(item => item.predicate(frame));
            if (index === -1) frames.push(frame);
            else {
                const item = waiting.splice(index, 1)[0];
                clearTimeout(item.timer); item.resolve(frame);
            }
        });
        const peer = {
            socket, frames,
            next(predicate) {
                const index = frames.findIndex(predicate);
                if (index !== -1) return Promise.resolve(frames.splice(index, 1)[0]);
                return new Promise((resolve, reject) => {
                    const item = { predicate, resolve, timer: setTimeout(() => {
                        waiting.splice(waiting.indexOf(item), 1);
                        reject(new Error(`Timed out waiting for frame; queued: ${JSON.stringify(frames)}`));
                    }, 4000) };
                    waiting.push(item);
                });
            },
            send(frame) { socket.send(JSON.stringify(frame)); }
        };
        await once(socket, 'open');
        peer.send({ event: 'authenticate', ticket });
        return peer;
    }

    async function connect(userId) {
        const issued = await http(userId, '/ws/tickets', 'POST');
        assert.equal(issued.status, 200);
        assert.equal(issued.body.ws_path, '/ws');
        const peer = await openSocket(issued.body.ticket);
        assert.equal((await peer.next(frame => frame.event === 'ready')).user_id, userId);
        return peer;
    }
    const newMessage = (conversationId, text, id = randomUUID()) => ({
        event: 'message.send', conversation_id: conversationId, client_message_id: id, type: 'TEXT', text
    });
    const frameFor = (event, id) => frame => frame.event === event && (frame.client_message_id ?? frame.message?.client_message_id) === id;
    let conversationId, first, second, firstTab, secondTab;

    await t.test('startup, existing REST endpoints and sports forwarding work through Gateway', async () => {
        assert.equal((await http(1, '/prueba')).status, 200);
        assert.equal((await http(1, '/pruebas')).status, 200);
        assert.equal((await http(1, '/health')).status, 200);
        assert.deepEqual((await http(1, '/me')).body, { id: 1, name: 'Private name 1', role: 'coach' });
        const response = await fetch(`${gatewayBase}/api/sports/users/me`, { headers: { Authorization: `Bearer ${tokens.get(1)}` } });
        assert.equal(response.status, 200);
        assert.equal((await response.json()).id, 1);
        assert.equal((await fetch(`${gatewayBase}/api/ai/generate`, { method: 'POST' })).status, 404);
    });

    await t.test('friend-only creation, membership, strict bodies and unique pair under concurrent requests', async () => {
        assert.equal((await http(1, '/conversations', 'POST', { user_id: 3 })).status, 403);
        assert.equal((await http(1, '/conversations', 'POST', { user_id: 1 })).status, 409);
        assert.equal((await http(1, '/conversations', 'POST', { user_id: 2, sender_id: 3 })).status, 400);
        assert.equal((await http(1, '/conversations', 'POST', { user_id: 99 })).status, 404);
        const malformed = await fetch(`${base}/conversations`, {
            method: 'POST', headers: { Authorization: `Bearer ${tokens.get(1)}`, 'Content-Type': 'application/json' }, body: '{'
        });
        assert.equal(malformed.status, 400);
        await malformed.body.cancel();
        const results = await Promise.all(Array.from({ length: 10 }, (_, i) => http(i % 2 ? 1 : 2, '/conversations', 'POST', { user_id: i % 2 ? 2 : 1 })));
        assert.equal(results.filter(result => result.status === 201).length, 1);
        assert.ok(results.every(result => [200, 201].includes(result.status)));
        conversationId = results[0].body.id;
        assert.ok(results.every(result => result.body.id === conversationId));
        assert.equal(await app.mongo.db.collection('conversations').countDocuments(), 1);
        const list = await http(1, '/conversations');
        assert.equal(list.body.items.length, 1);
        assert.deepEqual(list.body.items[0].other_participant, { id: 2, username: 'player_2', role: 'player', avatar_media_id: null });
        assert.equal(list.body.items[0].last_message, null);
        assert.equal((await http(3, '/conversations')).body.items.length, 0);
        assert.equal((await http(3, `/conversations/${conversationId}/messages`)).status, 403);
        assert.equal((await http(1, '/conversations/aaaaaaaaaaaaaaaaaaaaaaaa/messages')).status, 404);
        assert.equal((await http(1, '/conversations/not-an-id/messages')).status, 400);
        assert.equal((await http(1, '/conversations?limit=101')).status, 400);
    });

    await t.test('invalid JWT, one-use tickets, forbidden query credentials and forwarded Origin', async () => {
        assert.equal((await http(99, '/ws/tickets', 'POST')).status, 401);
        const ticket = (await http(1, '/ws/tickets', 'POST')).body.ticket;
        const owner = await openSocket(ticket);
        await owner.next(frame => frame.event === 'ready');
        const reused = await openSocket(ticket);
        assert.equal((await reused.next(frame => frame.event === 'error')).status, 401);
        const invalid = await openSocket('invalid');
        assert.equal((await invalid.next(frame => frame.event === 'error')).status, 401);
        for (const [suffix, origin, status] of [
            ['/ws?ticket=never-use-urls', 'http://localhost:5173', 400],
            ['/ws', 'https://untrusted.example', 403]
        ]) {
            const socket = new WebSocket(`${direct.replace('http:', 'ws:')}${suffix}`, { origin });
            sockets.add(socket);
            const response = await new Promise((resolve, reject) => {
                socket.once('unexpected-response', (_request, reply) => { reply.resume(); socket.terminate(); resolve(reply.statusCode); });
                socket.on('error', () => {});
                socket.once('open', () => reject(new Error('Unexpected accepted upgrade')));
            });
            assert.equal(response, status);
            // The Gateway upgrades its incoming leg before the upstream handshake.
            // An upstream rejection must close that leg, never authenticate it.
            const proxied = new WebSocket(`${base.replace('http:', 'ws:')}${suffix}`, { origin });
            sockets.add(proxied);
            const frames = [];
            const closed = new Promise((resolve, reject) => {
                const timeout = setTimeout(() => reject(new Error('Rejected proxy connection stayed open')), 4000);
                proxied.on('message', data => frames.push(JSON.parse(data.toString())));
                proxied.on('error', () => {});
                proxied.once('close', () => { clearTimeout(timeout); resolve(); });
            });
            await closed;
            assert.deepEqual(frames, []);
        }
        owner.socket.terminate();
    });

    await t.test('persist before acknowledgement and broadcast to both participants and multiple tabs', async () => {
        [first, second, firstTab, secondTab] = await Promise.all([connect(1), connect(2), connect(1), connect(2)]);
        const frame = newMessage(conversationId, '  First message  ');
        first.send(frame);
        const ack = await first.next(frameFor('message.ack', frame.client_message_id));
        assert.equal(ack.duplicate, false);
        assert.equal(ack.message.sender_id, 1);
        assert.equal(ack.message.text, 'First message');
        const stored = await app.mongo.db.collection('messages').findOne({ clientMessageId: frame.client_message_id });
        assert.ok(stored, 'Message is committed when ACK arrives');
        assert.equal(stored.media, null);
        for (const peer of [second, firstTab, secondTab]) {
            assert.deepEqual((await peer.next(frameFor('message.received', frame.client_message_id))).message, ack.message);
        }
        assert.ok(!first.frames.some(item => item.event === 'message.received'));
        const list = await http(2, '/conversations');
        assert.equal(list.body.items[0].last_message.id, ack.message.id);
    });

    await t.test('simultaneous retries insert once; different content using the same ID conflicts', async () => {
        const frame = newMessage(conversationId, 'Concurrent retry');
        first.send(frame); firstTab.send(frame);
        const acknowledgements = await Promise.all([first.next(frameFor('message.ack', frame.client_message_id)), firstTab.next(frameFor('message.ack', frame.client_message_id))]);
        assert.deepEqual(acknowledgements.map(ack => ack.duplicate).sort(), [false, true]);
        assert.equal(acknowledgements[0].message.id, acknowledgements[1].message.id);
        assert.equal(await app.mongo.db.collection('messages').countDocuments({ clientMessageId: frame.client_message_id }), 1);
        await second.next(frameFor('message.received', frame.client_message_id));
        first.send(frame);
        assert.equal((await first.next(frameFor('message.ack', frame.client_message_id))).duplicate, true);
        // This later event is a barrier: all earlier frames on first's queue are processed.
        const barrier = newMessage(conversationId, 'After retry');
        first.send(barrier);
        await second.next(frameFor('message.received', barrier.client_message_id));
        assert.equal(second.frames.filter(frameFor('message.received', frame.client_message_id)).length, 0);
        first.send({ ...frame, text: 'Changed content' });
        assert.equal((await first.next(frameFor('error', frame.client_message_id))).status, 409);
    });

    await t.test('reject invalid text, unsupported media, sender spoofing, binary frames and foreign conversations', async () => {
        const count = await app.mongo.db.collection('messages').countDocuments();
        for (const change of [{ text: '' }, { text: 'x'.repeat(4001) }, { type: 'IMAGE' }, { type: 'VIDEO' }, { sender_id: 2 }]) {
            const frame = { ...newMessage(conversationId, 'Valid text'), ...change };
            first.send(frame);
            assert.equal((await first.next(frameFor('error', frame.client_message_id))).status, 400);
        }
        first.socket.send('not JSON');
        assert.equal((await first.next(frame => frame.event === 'error')).status, 400);
        first.socket.send(Buffer.from('binary'));
        assert.equal((await first.next(frame => frame.event === 'error')).status, 400);
        const stranger = await connect(3);
        const frame = newMessage(conversationId, 'Forbidden');
        stranger.send(frame);
        assert.equal((await stranger.next(frameFor('error', frame.client_message_id))).status, 403);
        assert.equal(await app.mongo.db.collection('messages').countDocuments(), count);
    });

    await t.test('history cursor pages are chronological and stable with identical timestamps', async () => {
        // Equal timestamps deliberately exercise the ObjectId tie-breaker.
        await app.mongo.db.collection('messages').updateMany({}, { $set: { createdAt: new Date('2026-01-01T12:00:00Z') } });
        const page = await http(1, `/conversations/${conversationId}/messages?limit=2`);
        assert.equal(page.body.items.length, 2);
        assert.ok(page.body.next_cursor);
        const older = await http(2, `/conversations/${conversationId}/messages?limit=2&before=${page.body.next_cursor}`);
        assert.equal(older.body.items.length, 1);
        assert.equal(older.body.next_cursor, null);
        const ids = [...older.body.items, ...page.body.items].map(message => message.id);
        assert.equal(new Set(ids).size, 3);
        assert.deepEqual(ids, [...ids].sort());
        assert.equal((await http(1, `/conversations/${conversationId}/messages?before=notacursor`)).status, 400);
    });

    await t.test('storage failures are not confirmed or broadcast; retry can succeed', async () => {
        const save = app.chatStore.saveText;
        app.chatStore.saveText = async () => { throw new Error('Simulated insert failure'); };
        const frame = newMessage(conversationId, 'Retry after storage recovers');
        try {
            first.send(frame);
            assert.equal((await first.next(frameFor('error', frame.client_message_id))).status, 503);
            assert.equal(await app.mongo.db.collection('messages').countDocuments({ clientMessageId: frame.client_message_id }), 0);
        } finally { app.chatStore.saveText = save; }
        first.send(frame);
        assert.equal((await first.next(frameFor('message.ack', frame.client_message_id))).duplicate, false);
    });

    await t.test('removing friendship blocks sending and recreation while preserving history and public metadata', async () => {
        friends = false;
        const frame = newMessage(conversationId, 'No longer friends');
        first.send(frame);
        const error = await first.next(frameFor('error', frame.client_message_id));
        assert.equal(error.status, 403); assert.equal(error.code, 'NOT_FRIENDS');
        assert.equal((await http(1, '/conversations', 'POST', { user_id: 2 })).status, 403);
        const history = await http(2, `/conversations/${conversationId}/messages`);
        assert.equal(history.status, 200); assert.equal(history.body.items.length, 4);
        assert.equal((await http(1, '/conversations')).body.items.length, 1);
        publicUnavailable = true;
        const list = await http(1, '/conversations');
        assert.equal(list.status, 200); assert.equal(list.body.items[0].other_participant, null);
        publicUnavailable = false;
        friends = true;
        const restored = await http(1, '/conversations', 'POST', { user_id: 2 });
        assert.equal(restored.status, 200); assert.equal(restored.body.id, conversationId);
        assert.ok(sportsCalls.filter(path => path === '/users/2/public').length > 5, 'Friendship is checked again on sends, not cached');
    });

    await t.test('active sessions revalidate the token on each send', async () => {
        users.get(2).is_active = false;
        const frame = newMessage(conversationId, 'Inactive sender');
        second.send(frame);
        assert.equal((await second.next(frameFor('error', frame.client_message_id))).status, 401);
        assert.equal(await app.mongo.db.collection('messages').countDocuments({ clientMessageId: frame.client_message_id }), 0);
        assert.equal((await http(2, '/ws/tickets', 'POST')).status, 401);
    });
});
