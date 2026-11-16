const fp = require('fastify-plugin');
const { bearerAuthorization, createSportsClient } = require('../lib/sports-client');
const { ServiceError } = require('../lib/errors');

async function authentication(fastify, options) {
    const sports = createSportsClient(options);
    fastify.decorate('sports', sports);
    fastify.decorate('verifyUser', sports.getUser);
    fastify.decorateRequest('user', null);
    fastify.decorateRequest('authorization', null);
    fastify.decorate('authenticate', async function authenticate(request, reply) {
        try {
            const authorization = bearerAuthorization(request.headers.authorization);
            request.user = await sports.getUser(authorization);
            request.authorization = authorization;
        } catch (error) {
            if (!(error instanceof ServiceError)) throw error;
            if (error.statusCode === 401) reply.header('WWW-Authenticate', 'Bearer');
            return reply.code(error.statusCode).send({ detail: error.message });
        }
    });
}

module.exports = fp(authentication, { fastify: '5.x', name: 'communication-authentication' });
