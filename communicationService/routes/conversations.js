const { ServiceError } = require('../lib/errors');
const { conversationResponse } = require('../lib/chat-store');

async function publicIdentity(fastify, authorization, userId) {
    try {
        const profile = await fastify.sports.getPublicProfile(authorization, userId);
        const { friendship_status, ...identity } = profile;
        return identity;
    } catch (error) {
        if (error.statusCode === 401 || error.statusCode === 403) throw error;
        return null;
    }
}

async function routes(fastify) {
    fastify.post('/conversations', {
        preHandler: fastify.authenticate,
        schema: { body: {
            type: 'object', additionalProperties: false, required: ['user_id'],
            properties: { user_id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER } }
        } }
    }, async (request, reply) => {
        if (request.body.user_id === request.user.id) throw new ServiceError(409, 'SELF_CONVERSATION', 'A private conversation needs another user');
        const { friendship_status, ...other } = await fastify.sports.assertFriend(request.authorization, request.body.user_id);
        const { conversation, created } = await fastify.chatStore.getOrCreate(request.user.id, other.id);
        // Existing conversations must return the same current last-message data as the list.
        const latest = await fastify.chatStore.history(conversation._id.toHexString(), 1);
        const response = conversationResponse(conversation, other);
        response.unread_count = await fastify.chatRead.count(conversation, request.user.id);
        response.last_message = latest.items[0] ?? null;
        return reply.code(created ? 201 : 200).header('Cache-Control', 'no-store').send(response);
    });

    fastify.get('/conversations', {
        preHandler: fastify.authenticate,
        schema: { querystring: {
            type: 'object', additionalProperties: false,
            properties: { limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 } }
        } }
    }, async (request, reply) => {
        const rows = await fastify.chatStore.listConversations(request.user.id, request.query.limit, request.query.offset);
        const items = [];
        // Bound concurrent calls to sportsService instead of issuing one per row at once.
        for (let start = 0; start < rows.length; start += 5) {
            items.push(...await Promise.all(rows.slice(start, start + 5).map(async (conversation) => {
                const otherId = conversation.participantIds.find(id => id !== request.user.id);
                return conversationResponse(conversation, await publicIdentity(fastify, request.authorization, otherId));
            })));
        }
        return reply.header('Cache-Control', 'no-store').send({ items, limit: request.query.limit, offset: request.query.offset });
    });

    fastify.get('/conversations/:id/messages', {
        preHandler: fastify.authenticate,
        schema: {
            params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } } },
            querystring: { type: 'object', additionalProperties: false, properties: {
                limit: { type: 'integer', minimum: 1, maximum: 100, default: 50 },
                before: { type: 'string', minLength: 1, maxLength: 300, pattern: '^[A-Za-z0-9_-]+$' }
            } }
        }
    }, async (request, reply) => {
        const conversation = await fastify.chatStore.requireConversation(request.params.id, request.user.id);
        return reply.header('Cache-Control', 'no-store').send(await fastify.chatStore.history(conversation._id.toHexString(), request.query.limit, request.query.before));
    });
}

module.exports = routes;
