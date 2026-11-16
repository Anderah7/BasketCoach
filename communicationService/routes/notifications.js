const { timingSafeEqual } = require('node:crypto');
const { ServiceError } = require('../lib/errors');
const { notificationResponse } = require('../plugins/notifications');

async function routes(fastify, options) {
    fastify.get('/notifications', {
        preHandler: fastify.authenticate,
        schema: { querystring: { type: 'object', additionalProperties: false, properties: {
            limit: { type: 'integer', minimum: 1, maximum: 100, default: 20 }, offset: { type: 'integer', minimum: 0, maximum: 10000, default: 0 }
        } } }
    }, async (request, reply) => {
        const { rows, hasMore } = await fastify.notifications.list(request.user.id, request.query.limit, request.query.offset);
        const actors = new Map();
        const actorIds = [...new Set(rows.map(row => row.actorId))];
        for (let start = 0; start < actorIds.length; start += 5) {
            await Promise.all(actorIds.slice(start, start + 5).map(async actorId => {
                try {
                    const { friendship_status, ...actor } = await fastify.sports.getPublicProfile(request.authorization, actorId);
                    actors.set(actorId, actor);
                } catch (error) {
                    if ([401, 403].includes(error.statusCode)) throw error;
                    actors.set(actorId, null);
                }
            }));
        }
        const items = rows.map(row => notificationResponse(row, actors.get(row.actorId)));
        return reply.header('Cache-Control', 'no-store').send({ items, has_more: hasMore, limit: request.query.limit, offset: request.query.offset });
    });
    fastify.get('/notifications/unread-count', { preHandler: fastify.authenticate }, async (request, reply) =>
        reply.header('Cache-Control', 'no-store').send({ unread_count: await fastify.notifications.count(request.user.id) }));
    fastify.patch('/notifications/read-all', { preHandler: fastify.authenticate }, async (request, reply) =>
        reply.header('Cache-Control', 'no-store').send(await fastify.notifications.markAll(request.user.id)));
    fastify.patch('/notifications/:id/read', {
        preHandler: fastify.authenticate,
        schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } } } }
    }, async (request, reply) => reply.header('Cache-Control', 'no-store').send(await fastify.notifications.markRead(request.user.id, request.params.id)));

    fastify.post('/internal/notifications', {
        bodyLimit: 4096,
        onRequest: async request => {
            const expected = options.secret;
            if (!expected || expected.length < 32) throw new ServiceError(503, 'INTERNAL_UNAVAILABLE', 'Internal notifications are not configured');
            const supplied = request.headers['x-notification-secret'];
            if (typeof supplied !== 'string' || Buffer.byteLength(supplied) !== Buffer.byteLength(expected) || !timingSafeEqual(Buffer.from(supplied), Buffer.from(expected))) {
                throw new ServiceError(403, 'FORBIDDEN', 'Internal access denied');
            }
        },
        schema: { body: {
            type: 'object', additionalProperties: false,
            required: ['event_id', 'type', 'actor_id', 'recipient_id', 'friend_request_id', 'occurred_at'],
            properties: {
                event_id: { type: 'string', maxLength: 120 }, type: { enum: ['FRIEND_REQUEST', 'FRIEND_ACCEPTED'] },
                actor_id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
                recipient_id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
                friend_request_id: { type: 'integer', minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
                occurred_at: { type: 'string', format: 'date-time' }
            }
        } }
    }, async (request, reply) => {
        const data = request.body;
        if (data.actor_id === data.recipient_id || data.event_id !== `friend-request:${data.friend_request_id}:${data.type}` || Date.parse(data.occurred_at) > Date.now() + 300000) {
            throw new ServiceError(422, 'INVALID_EVENT', 'Invalid friendship notification event');
        }
        const saved = await fastify.notifications.create({
            eventId: data.event_id, type: data.type, actorId: data.actor_id, recipientId: data.recipient_id,
            resource: { friend_request_id: data.friend_request_id }, createdAt: new Date(data.occurred_at), readAt: null
        });
        return reply.code(saved.duplicate ? 200 : 201).send({ id: saved.notification._id.toHexString(), duplicate: saved.duplicate });
    });
}

module.exports = routes;
