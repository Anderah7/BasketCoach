async function routes(fastify) {
    fastify.get('/me', {
        preHandler: fastify.authenticate,
        schema: {
            response: {
                200: {
                    type: 'object',
                    additionalProperties: false,
                    required: ['id', 'name', 'role'],
                    properties: {
                        id: { type: 'integer', minimum: 1 },
                        name: { type: 'string' },
                        role: { type: 'string', enum: ['coach', 'player', 'fan'] }
                    }
                }
            }
        }
    }, async (request, reply) => {
        reply.header('Cache-Control', 'no-store');
        return request.user;
    });
}

module.exports = routes;
