const fp = require('fastify-plugin');
const { initializeChatStore } = require('../lib/chat-store');

async function chatStorage(fastify) {
    fastify.decorate('chatStore', await initializeChatStore(fastify.mongo.db));
}

module.exports = fp(chatStorage, { fastify: '5.x', name: 'chat-storage', dependencies: ['@fastify/mongodb'] });
