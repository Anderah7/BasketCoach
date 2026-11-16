const fp = require('fastify-plugin');

async function authentication(fastify, options) {
    const { sportsServiceUrl, timeoutMs = 5000, fetchImpl = globalThis.fetch } = options;
    fastify.decorateRequest('user', null);
    fastify.decorate('authenticate', async function authenticate(request, reply) {
        const authorization = request.headers.authorization;
        const credentials = typeof authorization === 'string' && authorization.match(/^Bearer +(\S+)$/i);
        if (!credentials) {
            return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ detail: 'A Bearer token is required' });
        }

        let response;
        let user;
        try {
            response = await fetchImpl(`${sportsServiceUrl}/users/me`, {
                method: 'GET',
                headers: { Accept: 'application/json', Authorization: `Bearer ${credentials[1]}` },
                signal: AbortSignal.timeout(timeoutMs),
                redirect: 'manual'
            });
            if (response.status === 401) {
                await response.body?.cancel();
                return reply.code(401).header('WWW-Authenticate', 'Bearer').send({ detail: 'Invalid or expired token' });
            }
            if (response.status === 403) {
                await response.body?.cancel();
                return reply.code(403).send({ detail: 'Access denied by sportsService' });
            }
            if (response.status !== 200) {
                await response.body?.cancel();
                return reply.code(response.status >= 500 ? 503 : 502).send({ detail: 'Authentication service unavailable' });
            }
            user = await response.json();
        } catch (error) {
            if (error.name === 'TimeoutError' || error.name === 'AbortError') {
                return reply.code(504).send({ detail: 'Authentication service timed out' });
            }
            if (error instanceof SyntaxError) {
                return reply.code(502).send({ detail: 'Invalid authentication service response' });
            }
            return reply.code(503).send({ detail: 'Could not contact the authentication service' });
        }
        if (user && user.is_active === false) {
            return reply.code(403).send({ detail: 'This account is inactive' });
        }
        if (!user || !Number.isSafeInteger(user.id) || user.id <= 0 ||
            typeof user.name !== 'string' || !user.name.trim() ||
            !['coach', 'player', 'fan'].includes(user.role) || user.is_active !== true) {
            return reply.code(502).send({ detail: 'Invalid authentication service response' });
        }
        request.user = { id: user.id, name: user.name, role: user.role };
    });
}

module.exports = fp(authentication, { fastify: '5.x', name: 'communication-authentication' });
