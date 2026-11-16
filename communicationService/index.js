const { buildApp } = require('./app');
const { loadConfig } = require('./config');

async function start() {
    let app;
    try {
        const config = loadConfig();
        app = buildApp({ config });
        let closing = false;
        const shutdown = async (signal) => {
            if (closing) return;
            closing = true;
            app.log.info({ signal }, 'Stopping communicationService');
            try { await app.close(); } catch {
                app.log.error('Could not close communicationService cleanly');
                process.exitCode = 1;
            }
        };
        process.once('SIGINT', () => { void shutdown('SIGINT'); });
        process.once('SIGTERM', () => { void shutdown('SIGTERM'); });
        await app.listen({ port: config.port, host: '0.0.0.0' });
    } catch (error) {
        if (app) {
            app.log.error({ code: error.code, name: error.name }, 'Startup failed. Check MongoDB connectivity, configuration and the HTTP port.');
            await app.close().catch(() => {});
        } else {
            console.error(error.message);
        }
        process.exitCode = 1;
    }
}

void start();
