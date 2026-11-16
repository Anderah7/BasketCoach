const Fastify = require('fastify');
const cors = require('@fastify/cors');
const mongodb = require('@fastify/mongodb');
const { loadConfig } = require('./config');
const authentication = require('./plugins/authentication');
const probeRoutes = require('./routes/pruebas');
const healthRoutes = require('./routes/health');
const accountRoutes = require('./routes/account');

function buildApp({ config = loadConfig(), logger = true } = {}) {
    const app = Fastify({
        logger: logger ? { redact: ['req.headers.authorization'] } : false
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
    app.register(authentication, { sportsServiceUrl: config.sportsServiceUrl });
    app.register(probeRoutes);
    app.register(healthRoutes);
    app.register(accountRoutes);
    app.addHook('onReady', async () => {
        const result = await app.mongo.db.command({ ping: 1 }, { timeoutMS: 5000 });
        if (result.ok !== 1) throw new Error('MongoDB startup ping failed');
        app.log.info({ database: config.mongoDbName }, 'MongoDB connection and ping successful');
    });
    return app;
}

module.exports = { buildApp };
