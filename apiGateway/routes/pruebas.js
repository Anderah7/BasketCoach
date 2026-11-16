const proxy = require('@fastify/http-proxy');

async function routes(fastify) {
    fastify.addHook('onRequest', async (request, reply) => {
        let path = new URL(request.raw.url, 'http://gateway').pathname;
        try { for (let i = 0; i < 3; i++) path = decodeURIComponent(path); }
        catch { return reply.code(400).send({ detail: 'Invalid path' }); }
        path = new URL(path.replace(/\/+/g, '/'), 'http://gateway').pathname;
        if (path.startsWith('/api/communication/internal')) return reply.code(404).send({ detail: 'Not found' });
        delete request.headers['x-notification-secret'];
    });
    fastify.get('/pruebas', async () => ({
        status: 'ok',
        service: 'apiGateway'
    }));

    fastify.register(proxy, {
        upstream: process.env.SPORTS_SERVICE_URL || 'http://127.0.0.1:8001',
        prefix: '/api/sports'
    });

    fastify.register(proxy, {
        upstream: process.env.COMMUNICATION_SERVICE_URL || 'http://127.0.0.1:3001',
        prefix: '/api/communication',
        websocket: true,
        wsServerOptions: { maxPayload: 16 * 1024, perMessageDeflate: false },
        wsClientOptions: {
            maxPayload: 16 * 1024,
            perMessageDeflate: false,
            rewriteRequestHeaders: (_headers, request) => request.headers.origin ? { origin: request.headers.origin } : {}
        }
    });
}

module.exports = routes;
