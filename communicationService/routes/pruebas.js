async function routes(fastify) {
    const probe = async () => ({
        status: 'ok',
        service: 'communicationService'
    });
    fastify.get('/prueba', probe);
    fastify.get('/pruebas', probe);
}

module.exports = routes;
