const Fastify = require('fastify');
const cors = require('@fastify/cors');
const mongodb = require('@fastify/mongodb');
const websocket = require('@fastify/websocket');
const multipart = require('@fastify/multipart');
const { loadConfig } = require('./config');
const authentication = require('./plugins/authentication');
const probeRoutes = require('./routes/pruebas');
const healthRoutes = require('./routes/health');
const accountRoutes = require('./routes/account');
const chatStorage = require('./plugins/chat-storage');
const conversationRoutes = require('./routes/conversations');
const websocketRoutes = require('./routes/websocket');
const { ServiceError } = require('./lib/errors');
const chatEvents = require('./plugins/chat-events');
const mediaStorage = require('./plugins/media-storage');
const mediaRoutes = require('./routes/media');

function buildApp({ config = loadConfig(), logger = true, fetchImpl, chatOptions = {} } = {}) {
    const app = Fastify({
        ajv: { customOptions: { removeAdditional: false } },
        logger: logger ? {
            redact: ['req.headers.authorization'],
            serializers: { req: request => ({ method: request.method, url: request.url.split('?')[0], host: request.host }) }
        } : false
    });
    app.setErrorHandler((error, request, reply) => {
        if (error instanceof ServiceError) {
            if (error.statusCode === 401) reply.header('WWW-Authenticate', 'Bearer');
            return reply.code(error.statusCode).send({ detail: error.message, code: error.code });
        }
        if (error.validation) return reply.code(400).send({ detail: 'Invalid request parameters or body', code: 'VALIDATION_ERROR' });
        if (Number.isInteger(error.statusCode) && error.statusCode >= 400 && error.statusCode < 500) {
            return reply.code(error.statusCode).send({ detail: 'Invalid request', code: 'INVALID_REQUEST' });
        }
        request.log.error({ name: error.name, code: error.code }, 'communicationService request failed');
        return reply.code(503).send({ detail: 'Communication service is unavailable', code: 'UNAVAILABLE' });
    });
    app.register(cors, {
        origin: config.corsOrigins,
        methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']
    });
    app.register(mongodb, {
        url: config.mongoUri,
        database: config.mongoDbName,
        forceClose: true,
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        socketTimeoutMS: 5000,
        maxPoolSize: 10
    });
    app.register(websocket, {
        options: { maxPayload: 16 * 1024, perMessageDeflate: false },
        preClose(done) {
            for (const socket of this.websocketServer.clients) socket.terminate();
            this.websocketServer.close(done);
        }
    });
    app.register(authentication, { sportsServiceUrl: config.sportsServiceUrl, fetchImpl });
    app.register(chatStorage);
    app.register(chatEvents);
    app.register(mediaStorage, config);
    app.register(multipart, { limits: { files: 1, fields: 2, parts: 3 } });
    app.register(probeRoutes);
    app.register(healthRoutes);
    app.register(accountRoutes);
    app.register(conversationRoutes);
    app.register(websocketRoutes, { allowedOrigins: config.corsOrigins, ...chatOptions });
    app.register(mediaRoutes);
    app.addHook('onReady', async () => {
        const result = await app.mongo.db.command({ ping: 1 }, { timeoutMS: 5000 });
        if (result.ok !== 1) throw new Error('MongoDB startup ping failed');
        app.log.info({ database: config.mongoDbName }, 'MongoDB connection and ping successful');
    });
    return app;
}

module.exports = { buildApp };
