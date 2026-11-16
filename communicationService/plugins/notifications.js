const fp = require('fastify-plugin');
const { ObjectId } = require('@fastify/mongodb');
const { ServiceError } = require('../lib/errors');

function notificationResponse(row, actor = null) {
    return {
        id: row._id.toHexString(), event_id: row.eventId, recipient_id: row.recipientId,
        actor_id: row.actorId, actor, type: row.type, resource: row.resource,
        created_at: row.createdAt.toISOString(), is_read: row.readAt !== null,
        read_at: row.readAt?.toISOString() ?? null
    };
}

async function notifications(fastify, options) {
    const db = fastify.mongo.db;
    try {
        await db.createCollection('notifications', { validator: { $jsonSchema: {
            bsonType: 'object', required: ['eventId', 'recipientId', 'actorId', 'type', 'resource', 'createdAt', 'readAt'],
            properties: {
                eventId: { bsonType: 'string' }, recipientId: { bsonType: ['int', 'long', 'double'], minimum: 1 },
                actorId: { bsonType: ['int', 'long', 'double'], minimum: 1 },
                type: { enum: ['FRIEND_REQUEST', 'FRIEND_ACCEPTED', 'NEW_MESSAGE'] },
                resource: { bsonType: 'object' }, createdAt: { bsonType: 'date' }, readAt: { bsonType: ['date', 'null'] }
            }
        } } });
    } catch (error) { if (error.code !== 48) throw error; }
    const collection = db.collection('notifications');
    const messages = db.collection('messages');
    await collection.createIndex({ eventId: 1 }, { unique: true, name: 'uq_notification_event' });
    await collection.createIndex({ recipientId: 1, createdAt: -1, _id: -1 }, { name: 'ix_notification_history' });
    await collection.createIndex({ recipientId: 1, readAt: 1 }, { name: 'ix_notification_unread' });
    await messages.createIndex({ notificationPending: 1, createdAt: 1 }, { name: 'ix_message_notification_pending', partialFilterExpression: { notificationPending: true } });
    const queues = new Map();
    function serialized(userId, action) {
        const previous = queues.get(userId) ?? Promise.resolve();
        const job = previous.catch(() => {}).then(action);
        queues.set(userId, job);
        void job.finally(() => { if (queues.get(userId) === job) queues.delete(userId); }).catch(() => {});
        return job;
    }
    const count = userId => collection.countDocuments({ recipientId: userId, readAt: null });
    async function create(event) {
        return serialized(event.recipientId, async () => {
            const row = { _id: new ObjectId(), ...event };
            if (row.type === 'NEW_MESSAGE') {
                const conversation = await db.collection('conversations').findOne({ _id: new ObjectId(row.resource.conversation_id) });
                const seenAt = conversation?.notificationSeenAt?.[String(row.recipientId)];
                if (fastify.chatEvents.isViewing(row.recipientId, row.resource.conversation_id) || (seenAt && seenAt >= row.createdAt)) row.readAt = new Date();
            }
            try { await collection.insertOne(row); }
            catch (error) {
                if (error.code !== 11000) throw error;
                const existing = await collection.findOne({ eventId: event.eventId });
                if (!existing || existing.recipientId !== row.recipientId || existing.actorId !== row.actorId || existing.type !== row.type || JSON.stringify(existing.resource) !== JSON.stringify(row.resource)) {
                    throw new ServiceError(409, 'EVENT_CONFLICT', 'This event ID already belongs to different notification data');
                }
                return { notification: existing, duplicate: true };
            }
            fastify.chatEvents.sendToUser(row.recipientId, { event: 'notification.created', notification: notificationResponse(row), unread_count: await count(row.recipientId) });
            return { notification: row, duplicate: false };
        });
    }
    async function markConversation(userId, conversationId) {
        return serialized(userId, async () => {
            const readAt = new Date();
            await db.collection('conversations').updateOne({ _id: new ObjectId(conversationId), participantIds: userId }, { $max: { [`notificationSeenAt.${userId}`]: readAt } });
            const result = await collection.updateMany({ recipientId: userId, type: 'NEW_MESSAGE', 'resource.conversation_id': conversationId, createdAt: { $lte: readAt }, readAt: null }, { $set: { readAt } });
            if (result.modifiedCount) fastify.chatEvents.sendToUser(userId, { event: 'notifications.read', conversation_id: conversationId, read_at: readAt.toISOString(), unread_count: await count(userId) });
        });
    }
    async function markRead(userId, id) {
        return serialized(userId, async () => {
            const row = await collection.findOne({ _id: new ObjectId(id), recipientId: userId });
            if (!row) throw new ServiceError(404, 'NOTIFICATION_NOT_FOUND', 'Notification not found');
            const readAt = row.readAt ?? new Date();
            await collection.updateOne({ _id: row._id, recipientId: userId, readAt: null }, { $set: { readAt } });
            const unread = await count(userId);
            fastify.chatEvents.sendToUser(userId, { event: 'notifications.read', notification_id: id, read_at: readAt.toISOString(), unread_count: unread });
            return { notification: notificationResponse({ ...row, readAt }), unread_count: unread };
        });
    }
    async function markAll(userId) {
        return serialized(userId, async () => {
            const readAt = new Date();
            await collection.updateMany({ recipientId: userId, readAt: null }, { $set: { readAt } });
            const unread = await count(userId);
            fastify.chatEvents.sendToUser(userId, { event: 'notifications.read', all: true, read_at: readAt.toISOString(), unread_count: unread });
            return { unread_count: unread, read_at: readAt.toISOString() };
        });
    }
    async function processMessage(message) {
        if (!message.notificationPending) return;
        const conversation = await fastify.chatStore.requireConversation(message.conversationId.toHexString(), message.senderId);
        const recipientId = conversation.participantIds.find(id => id !== message.senderId);
        await fastify.notifications.create({
            eventId: `message:${message._id.toHexString()}`, actorId: message.senderId, recipientId,
            type: 'NEW_MESSAGE', resource: { conversation_id: conversation._id.toHexString(), message_id: message._id.toHexString(), message_type: message.type },
            createdAt: message.createdAt,
            readAt: fastify.chatEvents.isViewing(recipientId, conversation._id.toHexString()) ? new Date() : null
        });
        await messages.updateOne({ _id: message._id }, { $set: { notificationPending: false } });
    }
    async function messageSaved(message) {
        try { await fastify.chatRead.messageSaved(message); }
        catch { fastify.log.warn('Message saved; unread chat count will refresh after recovery'); }
        try { await processMessage(message); }
        catch { fastify.log.warn('Message saved; notification pending for retry'); }
    }
    let stopping = false, work = null;
    async function retry() {
        if (stopping || work) return;
        work = (async () => {
            const pending = await messages.find({ notificationPending: true }).sort({ createdAt: 1 }).limit(50).toArray();
            for (const message of pending) { if (stopping) break; await messageSaved(message); }
        })();
        try { await work; } catch { fastify.log.warn('Notification retry deferred: storage unavailable'); }
        finally { work = null; }
    }
    const timer = setInterval(() => { void retry(); }, options.retryMs ?? 5000);
    timer.unref();
    fastify.addHook('onReady', retry);
    fastify.addHook('preClose', async () => { stopping = true; clearInterval(timer); if (work) await work.catch(() => {}); await Promise.allSettled([...queues.values()]); });
    fastify.decorate('notifications', {
        create, count, markRead, markAll, markConversation, messageSaved, retry,
        async list(userId, limit, offset) {
            const rows = await collection.find({ recipientId: userId }).sort({ createdAt: -1, _id: -1 }).skip(offset).limit(limit + 1).toArray();
            return { rows: rows.slice(0, limit), hasMore: rows.length > limit };
        }
    });
}

module.exports = fp(notifications, { fastify: '5.x', name: 'notifications', dependencies: ['chat-storage', 'chat-events'] });
module.exports.notificationResponse = notificationResponse;
