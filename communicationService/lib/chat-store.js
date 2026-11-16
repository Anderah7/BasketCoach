const { ObjectId } = require('@fastify/mongodb');
const { ServiceError } = require('./errors');

const ID_PATTERN = /^[a-f0-9]{24}$/i;
const MESSAGE_TYPES = ['TEXT', 'IMAGE', 'VIDEO'];

function objectId(value) {
    if (typeof value !== 'string' || !ID_PATTERN.test(value)) throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid conversation ID');
    return new ObjectId(value);
}

function messageResponse(message) {
    return {
        id: message._id.toHexString(), conversation_id: message.conversationId.toHexString(),
        sender_id: message.senderId, client_message_id: message.clientMessageId,
        type: message.type, text: message.text, media: message.media,
        created_at: message.createdAt.toISOString()
    };
}

function conversationResponse(conversation, otherParticipant = null) {
    return {
        id: conversation._id.toHexString(), participant_ids: conversation.participantIds,
        created_at: conversation.createdAt.toISOString(), other_participant: otherParticipant,
        last_message: conversation.lastMessage ? messageResponse(conversation.lastMessage) : null
    };
}

async function createCollection(db, name, schema) {
    try { await db.createCollection(name, { validator: { $jsonSchema: schema } }); }
    catch (error) { if (error.code !== 48) throw error; }
}

async function initializeChatStore(db) {
    await createCollection(db, 'conversations', {
        bsonType: 'object', required: ['pairKey', 'participantIds', 'createdAt'],
        properties: {
            pairKey: { bsonType: 'string' },
            participantIds: { bsonType: 'array', minItems: 2, maxItems: 2, uniqueItems: true, items: { bsonType: ['int', 'long', 'double'], minimum: 1 } },
            createdAt: { bsonType: 'date' }
        }
    });
    await createCollection(db, 'messages', {
        bsonType: 'object', required: ['conversationId', 'senderId', 'clientMessageId', 'type', 'text', 'media', 'createdAt'],
        properties: {
            conversationId: { bsonType: 'objectId' }, senderId: { bsonType: ['int', 'long', 'double'], minimum: 1 },
            clientMessageId: { bsonType: 'string' }, type: { enum: MESSAGE_TYPES },
            text: { bsonType: ['string', 'null'] }, media: { bsonType: ['object', 'null'] }, createdAt: { bsonType: 'date' }
        }
    });
    const conversations = db.collection('conversations');
    const messages = db.collection('messages');
    await conversations.createIndex({ pairKey: 1 }, { unique: true, name: 'uq_private_pair' });
    await conversations.createIndex({ participantIds: 1 }, { name: 'ix_conversation_participant' });
    await messages.createIndex({ conversationId: 1, createdAt: -1, _id: -1 }, { name: 'ix_message_history' });
    await messages.createIndex({ conversationId: 1, senderId: 1, clientMessageId: 1 }, { unique: true, name: 'uq_message_retry' });

    async function getOrCreate(firstId, secondId) {
        const participantIds = [firstId, secondId].sort((a, b) => a - b);
        const pairKey = participantIds.join(':');
        let created = false;
        try {
            const result = await conversations.updateOne({ pairKey }, { $setOnInsert: { pairKey, participantIds, createdAt: new Date() } }, { upsert: true });
            created = result.upsertedCount === 1;
        } catch (error) { if (error.code !== 11000) throw error; }
        const conversation = await conversations.findOne({ pairKey });
        if (!conversation) throw new ServiceError(503, 'STORAGE_UNAVAILABLE', 'Could not load the conversation');
        return { conversation, created };
    }

    async function requireConversation(id, userId) {
        const conversation = await conversations.findOne({ _id: objectId(id) });
        if (!conversation) throw new ServiceError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found');
        if (!conversation.participantIds.includes(userId)) throw new ServiceError(403, 'FORBIDDEN', 'You do not belong to this conversation');
        return conversation;
    }

    async function listConversations(userId, limit, offset) {
        // Derive the last message from committed messages. No cross-document transaction
        // or denormalized summary is required on a standalone MongoDB installation.
        return conversations.aggregate([
            { $match: { participantIds: userId } },
            { $lookup: {
                from: 'messages', let: { conversation: '$_id' },
                pipeline: [
                    { $match: { $expr: { $eq: ['$conversationId', '$$conversation'] } } },
                    { $sort: { createdAt: -1, _id: -1 } }, { $limit: 1 }
                ], as: 'latest'
            } },
            { $set: { lastMessage: { $arrayElemAt: ['$latest', 0] } } },
            { $set: { activityAt: { $ifNull: ['$lastMessage.createdAt', '$createdAt'] } } },
            { $sort: { activityAt: -1, _id: -1 } }, { $skip: offset }, { $limit: limit }
        ]).toArray();
    }

    async function history(conversationId, limit, before) {
        const filter = { conversationId: objectId(conversationId) };
        if (before) {
            let cursor;
            try {
                cursor = JSON.parse(Buffer.from(before, 'base64url').toString('utf8'));
                if (cursor.conversation_id !== conversationId || !ID_PATTERN.test(cursor.id) || typeof cursor.created_at !== 'string' || !Number.isFinite(Date.parse(cursor.created_at))) throw new Error('Invalid cursor');
            } catch { throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid history cursor'); }
            const createdAt = new Date(cursor.created_at);
            filter.$or = [{ createdAt: { $lt: createdAt } }, { createdAt, _id: { $lt: new ObjectId(cursor.id) } }];
        }
        const rows = await messages.find(filter).sort({ createdAt: -1, _id: -1 }).limit(limit + 1).toArray();
        const hasMore = rows.length > limit;
        const page = rows.slice(0, limit);
        const oldest = page.at(-1);
        const nextCursor = hasMore ? Buffer.from(JSON.stringify({
            conversation_id: conversationId, id: oldest._id.toHexString(), created_at: oldest.createdAt.toISOString()
        })).toString('base64url') : null;
        return { items: page.reverse().map(messageResponse), next_cursor: nextCursor };
    }

    async function saveText(conversationId, senderId, clientMessageId, text) {
        const message = {
            _id: new ObjectId(), conversationId: objectId(conversationId), senderId, clientMessageId,
            type: 'TEXT', text, media: null, createdAt: new Date()
        };
        try {
            const result = await messages.insertOne(message);
            if (!result.acknowledged) throw new ServiceError(503, 'STORAGE_UNAVAILABLE', 'Message was not acknowledged by storage');
            return { message, duplicate: false };
        } catch (error) {
            if (error.code !== 11000) throw error;
            const existing = await messages.findOne({ conversationId: message.conversationId, senderId, clientMessageId });
            if (!existing || existing.type !== 'TEXT' || existing.text !== text) {
                throw new ServiceError(409, 'IDEMPOTENCY_CONFLICT', 'This client message ID was already used for different content');
            }
            return { message: existing, duplicate: true };
        }
    }

    return { getOrCreate, requireConversation, listConversations, history, saveText };
}

module.exports = { initializeChatStore, conversationResponse, messageResponse, MESSAGE_TYPES };
