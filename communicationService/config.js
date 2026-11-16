const { join } = require('node:path');
const { loadEnvFile } = require('node:process');

function loadConfig() {
    try {
        loadEnvFile(join(__dirname, '.env'));
    } catch (error) {
        if (error.code !== 'ENOENT') throw error;
    }

    const mongoUri = (process.env.MONGODB_URI || '').trim();
    const mongoDbName = (process.env.MONGODB_DB_NAME || '').trim();
    const sportsServiceUrl = (process.env.SPORTS_SERVICE_URL || '').trim().replace(/\/+$/, '');
    const port = Number(process.env.PORT || 3001);
    if (!/^mongodb(?:\+srv)?:\/\//.test(mongoUri)) {
        throw new Error('Configure a valid MONGODB_URI in communicationService/.env');
    }
    if (!mongoDbName) {
        throw new Error('Configure MONGODB_DB_NAME in communicationService/.env');
    }
    let sportsUrl;
    try { sportsUrl = new URL(sportsServiceUrl); } catch {
        throw new Error('Configure a valid SPORTS_SERVICE_URL in communicationService/.env');
    }
    if (!['http:', 'https:'].includes(sportsUrl.protocol) || sportsUrl.username || sportsUrl.password || sportsUrl.search || sportsUrl.hash) {
        throw new Error('SPORTS_SERVICE_URL must be an HTTP(S) base URL without credentials, query or fragment');
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
        throw new Error('PORT must be an integer between 1 and 65535');
    }
    const corsOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
        .split(',').map(origin => origin.trim()).filter(Boolean);
    return { mongoUri, mongoDbName, sportsServiceUrl, port, corsOrigins };
}

module.exports = { loadConfig };
