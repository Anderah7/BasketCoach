const { ObjectId } = require('@fastify/mongodb');
const { createReadStream } = require('node:fs');
const { ServiceError } = require('../lib/errors');
const { messageResponse } = require('../lib/chat-store');
const { parseRange } = require('../lib/media-store');

async function routes(fastify) {
    fastify.get('/media/config', { preHandler: fastify.authenticate }, async (_request, reply) =>
        reply.header('Cache-Control', 'no-store').send(fastify.mediaStore.config));

    fastify.post('/conversations/:id/messages/media', {
        onRequest: fastify.authenticate,
        schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } } } }
    }, async (request, reply) => {
        const store = fastify.mediaStore;
        const conversation = await fastify.chatStore.requireConversation(request.params.id, request.user.id);
        const otherId = conversation.participantIds.find(id => id !== request.user.id);
        await fastify.sports.assertFriend(request.authorization, otherId);
        if (!request.isMultipart()) throw new ServiceError(415, 'MULTIPART_REQUIRED', 'Upload the file using multipart/form-data');
        const messageId = new ObjectId();
        const controller = new AbortController();
        const aborted = () => controller.abort();
        request.raw.on('aborted', aborted);
        const fields = {};
        let staged, key, insertStarted = false, committed = false;
        try {
            for await (const part of request.parts({ limits: {
                files: 1, fields: 2, parts: 3, fieldNameSize: 50, fieldSize: 16000,
                fileSize: Math.max(store.imageMaxBytes, store.videoMaxBytes), headerPairs: 100
            } })) {
                if (part.type === 'file') {
                    if (part.fieldname !== 'file' || staged) { part.file.resume(); throw new ServiceError(400, 'VALIDATION_ERROR', 'Upload exactly one file in the file field'); }
                    staged = await store.stage(part, messageId.toHexString(), controller.signal, created => { key = created; });
                } else {
                    if (!['client_message_id', 'text'].includes(part.fieldname) || Object.hasOwn(fields, part.fieldname) || part.valueTruncated || part.fieldnameTruncated || typeof part.value !== 'string') {
                        throw new ServiceError(400, 'VALIDATION_ERROR', 'Invalid multipart fields');
                    }
                    fields[part.fieldname] = part.value;
                }
            }
            if (!staged || !/^[A-Za-z0-9_-]{8,64}$/.test(fields.client_message_id ?? '') || (fields.text ?? '').trim().length > 4000) {
                throw new ServiceError(422, 'VALIDATION_ERROR', 'Provide a file, a valid client_message_id and an optional comment of at most 4000 characters');
            }
            // A long upload must not bypass an expired JWT, deactivated account or
            // friendship removed since the first authorization check.
            const current = await fastify.verifyUser(request.authorization);
            if (current.id !== request.user.id) throw new ServiceError(401, 'UNAUTHORIZED', 'Invalid session identity');
            await fastify.sports.assertFriend(request.authorization, otherId);
            if (controller.signal.aborted) throw new ServiceError(400, 'UPLOAD_ABORTED', 'The upload was interrupted');
            const message = {
                _id: messageId, conversationId: conversation._id, senderId: request.user.id,
                clientMessageId: fields.client_message_id, type: staged.type,
                text: (fields.text ?? '').trim() || null, media: staged.media, createdAt: new Date()
            };
            insertStarted = true;
            const saved = await fastify.chatStore.saveMedia(message);
            committed = saved.message._id.equals(messageId);
            if (committed) await store.finalize(key);
            else await store.cleanup(key); // A concurrent retry won: discard only our new copy.
            if (!saved.duplicate) fastify.chatEvents.publish(saved.message, conversation.participantIds);
            return reply.code(saved.duplicate ? 200 : 201).header('Cache-Control', 'no-store').send({
                event: 'message.ack', client_message_id: fields.client_message_id,
                duplicate: saved.duplicate, message: messageResponse(saved.message)
            });
        } catch (error) {
            if (key && !committed) {
                try {
                    const saved = insertStarted ? await fastify.chatStore.findMessageById(messageId.toHexString()) : null;
                    if (saved?.media?.storageKey === key) await store.finalize(key);
                    else await store.cleanup(key);
                } catch {
                    // Preserve an uncertain committed file; its durable marker is
                    // reconciled against MongoDB at the next service startup.
                    request.log.error('Pending upload cleanup deferred until storage recovery');
                }
            }
            throw error;
        } finally { request.raw.removeListener('aborted', aborted); }
    });

    fastify.route({
        method: ['GET', 'HEAD'], url: '/messages/:id/media',
        onRequest: fastify.authenticate,
        schema: { params: { type: 'object', required: ['id'], properties: { id: { type: 'string', pattern: '^[a-fA-F0-9]{24}$' } } } },
        handler: async (request, reply) => {
            const message = await fastify.chatStore.findMessageById(request.params.id);
            if (!message?.media || !['IMAGE', 'VIDEO'].includes(message.type)) throw new ServiceError(404, 'MEDIA_NOT_FOUND', 'Media not found');
            await fastify.chatStore.requireConversation(message.conversationId.toHexString(), request.user.id);
            let file;
            try { file = await fastify.mediaStore.open(message.media); }
            catch (error) {
                if (error.code !== 'ENOENT') request.log.error('Stored chat media is unavailable');
                throw new ServiceError(404, 'MEDIA_NOT_FOUND', 'Media is unavailable');
            }
            reply.header('Cache-Control', 'private, no-store').header('X-Content-Type-Options', 'nosniff')
                .header('Accept-Ranges', 'bytes');
            let range;
            try { range = parseRange(request.headers.range, file.size); }
            catch (error) { reply.header('Content-Range', `bytes */${file.size}`); throw error; }
            reply.type(file.contentType).header('Content-Disposition', `inline; filename="chat-${message.type.toLowerCase()}.${file.extension}"`);
            if (range) reply.code(206).header('Content-Range', `bytes ${range.start}-${range.end}/${file.size}`);
            reply.header('Content-Length', range ? range.end - range.start + 1 : file.size);
            if (request.method === 'HEAD') return reply.send();
            return reply.send(createReadStream(file.path, range ?? {}));
        }
    });
}

module.exports = routes;
