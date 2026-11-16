const { spawn } = require('node:child_process');
const { mkdtemp, rm, readFile } = require('node:fs/promises');
const { tmpdir } = require('node:os');
const { join, resolve, dirname, basename } = require('node:path');
const { createServer } = require('node:net');
const { mongodb } = require('@fastify/mongodb');

async function startMongo(mongodPath) {
    const temporaryRoot = resolve(tmpdir());
    const directory = await mkdtemp(join(temporaryRoot, 'basketcoach-chat-test-'));
    // Recursive cleanup is restricted to the exact directory created by this fixture.
    if (dirname(resolve(directory)) !== temporaryRoot || !basename(directory).startsWith('basketcoach-chat-test-')) {
        throw new Error('Temporary MongoDB directory escaped the intended test root');
    }
    const reservation = createServer();
    await new Promise(resolve => reservation.listen(0, '127.0.0.1', resolve));
    const port = reservation.address().port;
    await new Promise(resolve => reservation.close(resolve));
    if (port === 27017) throw new Error('Refusing to test on the standard MongoDB port');
    const log = join(directory, 'mongo.log');
    const mongoProcess = spawn(mongodPath, ['--dbpath', directory, '--port', String(port), '--bind_ip', '127.0.0.1', '--logpath', log, '--quiet'], {
        windowsHide: true, stdio: 'ignore'
    });
    let spawnError;
    mongoProcess.on('error', error => { spawnError = error; });
    const stopped = new Promise(resolve => {
        mongoProcess.once('exit', resolve);
        mongoProcess.once('error', resolve);
    });
    const uri = `mongodb://127.0.0.1:${port}`;
    const client = new mongodb.MongoClient(uri, { serverSelectionTimeoutMS: 10000, connectTimeoutMS: 1000 });
    try { await client.connect(); } catch (error) {
        mongoProcess.kill();
        await stopped;
        await client.close();
        const details = spawnError?.message ?? await readFile(log, 'utf8').catch(() => error.message);
        await rm(directory, { recursive: true, force: true });
        throw new Error(`Temporary MongoDB could not start: ${details.slice(-1500)}`);
    }
    return {
        uri,
        mediaRoot: join(directory, 'uploads'),
        async stop() {
            // This client can only reach the temporary server reserved above.
            try { await client.db('admin').command({ shutdown: 1, force: true }); } catch { /* Server closes the socket on shutdown. */ }
            await client.close();
            await stopped;
            await rm(directory, { recursive: true, force: true });
        }
    };
}

module.exports = { startMongo };
