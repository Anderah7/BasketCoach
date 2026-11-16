const fp = require('fastify-plugin');
const { resolve } = require('node:path');
const { createMediaStore } = require('../lib/media-store');

async function mediaStorage(fastify, options) {
    fastify.decorate('mediaStore', await createMediaStore({
        root: options.mediaRoot ?? resolve(__dirname, '../uploads'),
        imageMaxBytes: options.imageMaxBytes, videoMaxBytes: options.videoMaxBytes,
        findMessageById: fastify.chatStore.findMessageById
    }));
}

module.exports = fp(mediaStorage, { fastify: '5.x', name: 'media-storage', dependencies: ['chat-storage'] });
