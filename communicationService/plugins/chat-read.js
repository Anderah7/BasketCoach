const fp = require('fastify-plugin');
const { ObjectId } = require('@fastify/mongodb');

async function chatRead(fastify) {
    const conversations = fastify.mongo.db.collection('conversations');
    const messages = fastify.mongo.db.collection('messages');
    const queues = new Map();
    function serialized(userId, action) {
        const job = (queues.get(userId) ?? Promise.resolve()).catch(() => {}).then(action);
        queues.set(userId, job);
        void job.finally(() => { if (queues.get(userId) === job) queues.delete(userId); }).catch(() => {});
        return job;
    }
    async function count(conversation, userId) {
        const cursor = conversation.messageReadCursor?.[userId];
        // Existing conversation view checkpoints are a compatibility baseline;
        // reading a bell notification never advances the independent chat cursor.
        const at = cursor?.at ?? conversation.notificationSeenAt?.[userId] ?? new Date(0);
        const id = cursor?.id ?? new ObjectId('ffffffffffffffffffffffff');
        return messages.countDocuments({ conversationId: conversation._id, senderId: { $ne: userId },
            $or: [{ createdAt: { $gt: at } }, { createdAt: at, _id: { $gt: id } }] });
    }
    async function markCursor(conversation, userId) {
        const latest = await messages.find({ conversationId: conversation._id, senderId: { $ne: userId } })
            .sort({ createdAt: -1, _id: -1 }).limit(1).next();
        const cursor = { at: latest?.createdAt ?? new Date(0), id: latest?._id ?? new ObjectId('000000000000000000000000') };
        const path = `messageReadCursor.${userId}`;
        // Atomic conditional update: concurrent/stale views cannot move backwards.
        await conversations.updateOne({ _id: conversation._id, participantIds: userId, $or: [
            { [path]: { $exists: false } }, { [`${path}.at`]: { $lt: cursor.at } },
            { [`${path}.at`]: cursor.at, [`${path}.id`]: { $lt: cursor.id } }
        ] }, { $set: { [path]: cursor } });
    }
    async function publish(userId, conversationId) {
        const conversation = await fastify.chatStore.requireConversation(conversationId, userId);
        const unread = await count(conversation, userId);
        fastify.chatEvents.sendToUser(userId, { event: 'conversation.unread', conversation_id: conversation._id.toHexString(), unread_count: unread });
        return unread;
    }
    fastify.decorate('chatRead', {
        count,
        markRead(userId, conversationId) {
            return serialized(userId, async () => {
                const conversation = await fastify.chatStore.requireConversation(conversationId, userId);
                await markCursor(conversation, userId);
                return publish(userId, conversationId);
            });
        },
        messageSaved(message) {
            return (async () => {
                const conversation = await fastify.chatStore.requireConversation(message.conversationId.toHexString(), message.senderId);
                const recipient = conversation.participantIds.find(id => id !== message.senderId);
                await serialized(recipient, async () => {
                    if (fastify.chatEvents.isViewing(recipient, conversation._id.toHexString())) await markCursor(conversation, recipient);
                    await publish(recipient, conversation._id.toHexString());
                });
            })();
        }
    });
    fastify.addHook('preClose', async () => { await Promise.allSettled([...queues.values()]); });
}

module.exports = fp(chatRead, { fastify: '5.x', name: 'chat-read', dependencies: ['chat-storage', 'chat-events'] });
