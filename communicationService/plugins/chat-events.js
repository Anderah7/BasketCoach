const fp = require('fastify-plugin');
const { messageResponse } = require('../lib/chat-store');

async function chatEvents(fastify) {
    const connections = new Map();
    function sendToUser(userId, frame) {
        const payload = JSON.stringify(frame);
        for (const recipient of connections.get(userId) ?? []) {
            const socket = recipient.socket;
            if (socket.readyState !== socket.OPEN || !recipient.session || recipient.session.expiresAt <= Date.now()) continue;
            if (socket.bufferedAmount > 1024 * 1024) { socket.terminate(); continue; }
            try { socket.send(payload, error => { if (error) socket.terminate(); }); } catch { socket.terminate(); }
        }
    }
    fastify.decorate('chatEvents', {
        connections, sendToUser,
        isViewing(userId, conversationId) {
            return [...(connections.get(userId) ?? [])].some(connection => connection.activeConversationId === conversationId && connection.session?.expiresAt > Date.now() && connection.socket.readyState === connection.socket.OPEN);
        },
        publish(message, participantIds, originSocket = null) {
            const frame = JSON.stringify({ event: 'message.received', message: messageResponse(message) });
            for (const userId of participantIds) {
                for (const recipient of connections.get(userId) ?? []) {
                    const socket = recipient.socket;
                    if (socket === originSocket || socket.readyState !== socket.OPEN || !recipient.session || recipient.session.expiresAt <= Date.now()) continue;
                    if (socket.bufferedAmount > 1024 * 1024) { socket.terminate(); continue; }
                    // Persistence has already succeeded. Delivery failures cannot roll it back.
                    try { socket.send(frame, error => { if (error) socket.terminate(); }); }
                    catch { socket.terminate(); }
                }
            }
        }
    });
}

module.exports = fp(chatEvents, { fastify: '5.x', name: 'chat-events' });
