const proxy = require('@fastify/http-proxy');

async function routes(fastify) {
    fastify.get('/pruebas', async () => ({
        status: 'ok',
        service: 'apiGateway'
    }));

    fastify.register(proxy, {
        upstream: process.env.SPORTS_SERVICE_URL || 'http://127.0.0.1:8001',
        prefix: '/api/sports'
    });

    fastify.register(proxy, {
        upstream: 'http://127.0.0.1:3001',
        prefix: '/api/communication'
    });
}

module.exports = routes;
