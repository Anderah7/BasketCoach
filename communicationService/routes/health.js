async function routes(fastify) {
    fastify.get('/health', async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        try {
            const result = await fastify.mongo.db.command({ ping: 1 }, { timeoutMS: 3000 });
            if (result.ok !== 1) throw new Error('MongoDB ping failed');
            return { status: 'ok', service: 'communicationService', mongodb: 'ok' };
        } catch {
            request.log.warn('MongoDB health ping failed');
            return reply.code(503).send({ status: 'error', service: 'communicationService', mongodb: 'unavailable' });
        }
    });
}

module.exports = routes;
