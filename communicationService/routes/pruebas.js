async function routes(fastify) {
    fastify.get('/pruebas', async () => ({
        status: 'ok',
        service: 'communicationService'
    }));
}

module.exports = routes;
