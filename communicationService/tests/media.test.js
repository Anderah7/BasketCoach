const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs/promises');
const { join } = require('node:path');
const http = require('node:http');
const { once } = require('node:events');
const Fastify = require('fastify');
const WebSocket = require('ws');
const { buildApp } = require('../app');
const { createMediaStore, parseRange } = require('../lib/media-store');
const { startMongo } = require('./support/mongo');

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9K4q0AAAAASUVORK5CYII=', 'base64');
const MP4 = Buffer.concat([Buffer.from('000000186674797069736f6d0000000069736f6d69736f32', 'hex'), Buffer.from('000000106d6461740000000000000000', 'hex')]);
const WEBM = Buffer.from('1a45dfa39f4286810142f7810142f2810442f381084282847765626d4287810242858102', 'hex');
const WEBP = Buffer.from('UklGRiIAAABXRUJQVlA4IBYAAAAwAQCdASoBAAEADsD+JaQAA3AAAAAA', 'base64');
const JPEG = Buffer.from('ffd8ffe000104a46494600010100000100010000ffd9', 'hex');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check, message) {
    for (let index = 0; index < 100; index++) { if (await check()) return; await wait(30); }
    throw new Error(`Timed out: ${message}`);
}

test('single byte ranges include suffixes, clamp ends and reject invalid/multiple ranges', () => {
    assert.equal(parseRange(undefined, 10), null);
    assert.deepEqual(parseRange('bytes=2-4', 10), { start: 2, end: 4 });
    assert.deepEqual(parseRange('bytes=5-', 10), { start: 5, end: 9 });
    assert.deepEqual(parseRange('bytes=-3', 10), { start: 7, end: 9 });
    assert.deepEqual(parseRange('bytes=0-999', 10), { start: 0, end: 9 });
    for (const value of ['bytes=10-', 'bytes=4-1', 'bytes=-0', 'bytes=-', 'bytes=0-1,3-4', '../file', 'bytes=99999999999999999999-']) {
        assert.throws(() => parseRange(value, 10), { statusCode: 416 });
    }
});

test('isolated multipart chat media through Gateway with real storage and WebSocket events', {
    skip: !process.env.BASKETCOACH_MONGOD_PATH && 'Set BASKETCOACH_MONGOD_PATH for isolated MongoDB checks', timeout: 60000
}, async t => {
    const mongo = await startMongo(process.env.BASKETCOACH_MONGOD_PATH);
    let app, gateway;
    const sockets = [];
    t.after(async () => {
        for (const socket of sockets) socket.terminate();
        await app?.close(); await gateway?.close(); await mongo.stop();
    });
    const tokens = new Map([1, 2, 3].map(id => [id, `header.${Buffer.from(JSON.stringify({ sub: String(id), exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.mock-signature`]));
    let friends = true, revokeAfterRead = false, profileCalls = 0;
    app = buildApp({ logger: false, config: {
        mongoUri: mongo.uri, mongoDbName: 'basketcoach_media_isolated_test', mediaRoot: mongo.mediaRoot,
        imageMaxBytes: 1024, videoMaxBytes: 4096, sportsServiceUrl: 'http://sports.test', corsOrigins: []
    }, fetchImpl: async (url, options) => {
        const id = [...tokens].find(([, token]) => options.headers.Authorization === `Bearer ${token}`)?.[0];
        if (!id) return Response.json({}, { status: 401 });
        if (url.endsWith('/users/me')) return Response.json({ id, name: `User ${id}`, role: 'player', is_active: true });
        const target = Number(url.match(/\/users\/(\d+)\/public$/)?.[1]);
        if (revokeAfterRead && ++profileCalls > 1) friends = false;
        return Response.json({ id: target, username: `player_${target}`, avatar_media_id: null, role: 'player', friendship_status: friends && [1, 2].includes(id) && [1, 2].includes(target) ? 'FRIENDS' : 'NONE' });
    } });
    await app.listen({ host: '127.0.0.1', port: 0 });
    const previous = process.env.COMMUNICATION_SERVICE_URL;
    const direct = `http://127.0.0.1:${app.server.address().port}`;
    process.env.COMMUNICATION_SERVICE_URL = direct;
    gateway = Fastify();
    try { gateway.register(require('../../apiGateway/routes/pruebas')); await gateway.listen({ host: '127.0.0.1', port: 0 }); }
    finally { if (previous === undefined) delete process.env.COMMUNICATION_SERVICE_URL; else process.env.COMMUNICATION_SERVICE_URL = previous; }
    const base = `http://127.0.0.1:${gateway.server.address().port}/api/communication`;
    const auth = id => ({ Authorization: `Bearer ${tokens.get(id) ?? 'invalid'}` });
    const result = await fetch(`${base}/conversations`, { method: 'POST', headers: { ...auth(1), 'Content-Type': 'application/json' }, body: JSON.stringify({ user_id: 2 }) });
    assert.equal(result.status, 201);
    const conversation = await result.json();
    async function upload({ user = 1, data = PNG, mime = 'image/png', filename = '../../unsafe.png', id = randomUUID(), text, extra, fileFirst = false } = {}) {
        const form = new FormData();
        if (fileFirst) form.append('file', new Blob([data], { type: mime }), filename);
        form.append('client_message_id', id);
        if (text !== undefined) form.append('text', text);
        if (!fileFirst) form.append('file', new Blob([data], { type: mime }), filename);
        if (extra) form.append(extra, 'spoofed');
        const response = await fetch(`${base}/conversations/${conversation.id}/messages/media`, { method: 'POST', headers: auth(user), body: form });
        return { status: response.status, body: await response.json(), id };
    }
    const files = async () => (await fs.readdir(mongo.mediaRoot)).filter(name => name !== '.pending').sort();
    const pendingFiles = () => fs.readdir(join(mongo.mediaRoot, '.pending'));
    async function peer(user) {
        const response = await fetch(`${base}/ws/tickets`, { method: 'POST', headers: auth(user) });
        const { ticket } = await response.json();
        const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws');
        sockets.push(socket);
        const frames = [];
        socket.on('message', raw => frames.push(JSON.parse(raw.toString())));
        await once(socket, 'open'); socket.send(JSON.stringify({ event: 'authenticate', ticket }));
        await until(() => frames.some(frame => frame.event === 'ready'), 'WebSocket authentication');
        return frames;
    }
    const [sender, receiver] = await Promise.all([peer(1), peer(2)]);
    let imageMessage, videoMessage;

    await t.test('configured limits, actual formats, metadata-only persistence and live publication after save', async () => {
        const limits = await fetch(`${base}/media/config`, { headers: auth(1) });
        assert.equal((await limits.json()).image_max_bytes, 1024);
        for (const [data, mime] of [[PNG, 'image/png'], [JPEG, 'image/jpeg'], [WEBP, 'image/webp'], [MP4, 'video/mp4'], [WEBM, 'video/webm']]) {
            const uploaded = await upload({ data, mime, text: 'Optional comment', fileFirst: true });
            assert.equal(uploaded.status, 201, JSON.stringify(uploaded.body));
            const message = uploaded.body.message;
            if (mime === 'image/png') imageMessage = message;
            if (mime === 'video/mp4') videoMessage = message;
            assert.equal(message.type, mime.startsWith('image') ? 'IMAGE' : 'VIDEO');
            assert.equal(message.text, 'Optional comment');
            assert.deepEqual(message.media, { content_type: mime, size_bytes: data.length });
            const stored = await app.chatStore.findMessageById(message.id);
            assert.match(stored.media.storageKey, /^[a-f0-9]{32}$/);
            assert.deepEqual(await fs.readFile(join(mongo.mediaRoot, stored.media.storageKey)), data);
            assert.ok(!JSON.stringify(message).includes(stored.media.storageKey));
            await until(() => receiver.some(frame => frame.message?.id === message.id), 'recipient receives saved attachment');
            await until(() => sender.some(frame => frame.message?.id === message.id), 'sender tabs receive saved attachment');
        }
        assert.equal((await pendingFiles()).length, 0);
        const history = await fetch(`${base}/conversations/${conversation.id}/messages`, { headers: auth(2) });
        assert.equal((await history.json()).items.filter(message => message.media).length, 5);
    });

    await t.test('downloads and HEAD preserve JWT, MIME, bytes, Range and security headers through Gateway', async () => {
        const full = await fetch(`${base}/messages/${imageMessage.id}/media`, { headers: auth(2) });
        assert.equal(full.status, 200); assert.equal(full.headers.get('content-type'), 'image/png');
        assert.equal(full.headers.get('x-content-type-options'), 'nosniff');
        assert.equal(full.headers.get('cache-control'), 'private, no-store');
        assert.deepEqual(Buffer.from(await full.arrayBuffer()), PNG);
        for (const [range, start, end] of [['bytes=2-9', 2, 9], ['bytes=10-', 10, MP4.length - 1], ['bytes=-4', MP4.length - 4, MP4.length - 1]]) {
            const response = await fetch(`${base}/messages/${videoMessage.id}/media`, { headers: { ...auth(2), Range: range } });
            assert.equal(response.status, 206); assert.equal(response.headers.get('content-range'), `bytes ${start}-${end}/${MP4.length}`);
            assert.deepEqual(Buffer.from(await response.arrayBuffer()), MP4.subarray(start, end + 1));
        }
        const invalid = await fetch(`${base}/messages/${videoMessage.id}/media`, { headers: { ...auth(2), Range: 'bytes=999-' } });
        assert.equal(invalid.status, 416); assert.equal(invalid.headers.get('content-range'), `bytes */${MP4.length}`);
        await invalid.body.cancel();
        const head = await fetch(`${base}/messages/${imageMessage.id}/media`, { method: 'HEAD', headers: auth(1) });
        const directHead = await fetch(`${direct}/messages/${imageMessage.id}/media`, { method: 'HEAD', headers: auth(1) });
        assert.equal(head.headers.get('content-length'), String(PNG.length), `direct HEAD: ${directHead.status} ${JSON.stringify([...directHead.headers])}; proxy HEAD: ${head.status}`); assert.equal((await head.text()).length, 0);
        const unauthenticated = await fetch(`${base}/messages/${imageMessage.id}/media`);
        assert.equal(unauthenticated.status, 401); await unauthenticated.body.cancel();
        const foreign = await fetch(`${base}/messages/${imageMessage.id}/media`, { headers: auth(3) });
        assert.equal(foreign.status, 403); await foreign.body.cancel();
        const traversal = await fetch(`${base}/messages/not-a-message/media`, { headers: auth(1) });
        assert.equal(traversal.status, 400); await traversal.body.cancel();
        const publicPath = await fetch(`${base}/uploads/${(await files())[0]}`);
        assert.equal(publicPath.status, 404); await publicPath.body.cancel();
    });

    await t.test('retry and concurrent upload uniqueness retain one file; different bytes or comments conflict', async () => {
        const before = (await files()).length;
        const id = randomUUID();
        const uploads = await Promise.all([upload({ id }), upload({ id })]);
        assert.deepEqual(uploads.map(result => result.status).sort(), [200, 201]);
        assert.equal(uploads[0].body.message.id, uploads[1].body.message.id);
        assert.equal((await files()).length, before + 1);
        assert.equal((await upload({ id, text: 'Changed comment' })).status, 409);
        assert.equal((await upload({ id, data: Buffer.concat([PNG, Buffer.from('different bytes')]) })).status, 409);
        assert.equal((await files()).length, before + 1); assert.equal((await pendingFiles()).length, 0);
    });

    await t.test('permissions, real-content detection, metadata tampering and size limits leave no new files', async () => {
        const before = await files();
        for (const options of [
            { user: 3 }, { user: 99 }, { data: Buffer.from('<script>not a PNG</script>') },
            { mime: 'video/mp4' }, { data: Buffer.alloc(0) }, { id: '../invalid' }, { extra: 'sender_id' },
            { text: 'x'.repeat(4001) }, { data: Buffer.concat([PNG, Buffer.alloc(1100)]) },
            { data: Buffer.concat([MP4, Buffer.alloc(4100)]), mime: 'video/mp4' }
        ]) {
            const response = await upload(options);
            assert.ok([400, 401, 403, 413, 415, 422].includes(response.status), JSON.stringify(response));
            assert.deepEqual(await files(), before); assert.deepEqual(await pendingFiles(), []);
        }
    });

    await t.test('friendship is checked again after upload and failed inserts remove new files', async () => {
        const before = await files();
        revokeAfterRead = true; profileCalls = 0;
        assert.equal((await upload()).status, 403);
        revokeAfterRead = false; friends = true;
        assert.deepEqual(await files(), before); assert.deepEqual(await pendingFiles(), []);
        const save = app.chatStore.saveMedia;
        app.chatStore.saveMedia = async () => { throw new Error('Insert failed before commit'); };
        try { assert.equal((await upload()).status, 503); }
        finally { app.chatStore.saveMedia = save; }
        assert.deepEqual(await files(), before); assert.deepEqual(await pendingFiles(), []);
    });

    await t.test('uncertain commits preserve saved files, and unresolved staged files recover safely', async () => {
        const save = app.chatStore.saveMedia, find = app.chatStore.findMessageById;
        app.chatStore.saveMedia = async message => { await save(message); throw new Error('Acknowledgement lost after commit'); };
        const id = randomUUID();
        try { assert.equal((await upload({ id })).status, 503); }
        finally { app.chatStore.saveMedia = save; }
        const retry = await upload({ id }); assert.equal(retry.status, 200);
        const downloaded = await fetch(`${base}/messages/${retry.body.message.id}/media`, { headers: auth(2) });
        assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), PNG);
        const before = await files();
        app.chatStore.saveMedia = async () => { throw new Error('MongoDB unavailable'); };
        app.chatStore.findMessageById = async () => { throw new Error('Cannot determine commit outcome'); };
        try { assert.equal((await upload()).status, 503); }
        finally { app.chatStore.saveMedia = save; app.chatStore.findMessageById = find; }
        assert.equal((await pendingFiles()).length, 1);
        assert.equal((await files()).length, before.length + 1);
        await createMediaStore({ root: mongo.mediaRoot, findMessageById: find });
        assert.deepEqual(await files(), before); assert.deepEqual(await pendingFiles(), []);
    });

    await t.test('aborted uploads remove partial files without deleting existing attachments', async () => {
        const before = await files();
        const boundary = 'basketcoach-test-boundary';
        const target = new URL(`${base}/conversations/${conversation.id}/messages/media`);
        const request = http.request(target, { method: 'POST', headers: { ...auth(1), 'Content-Type': `multipart/form-data; boundary=${boundary}` } });
        request.on('error', () => {});
        request.write(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="interrupted.png"\r\nContent-Type: image/png\r\n\r\n`);
        request.write(PNG);
        await until(async () => (await pendingFiles()).some(name => name.endsWith('.part')), 'partial upload exists');
        request.destroy();
        await until(async () => (await pendingFiles()).length === 0, 'partial upload cleanup');
        assert.deepEqual(await files(), before);
    });

    await t.test('unfriending blocks new attachments but retains authorized historical downloads', async () => {
        friends = false;
        const before = await files();
        assert.equal((await upload()).status, 403);
        const response = await fetch(`${base}/messages/${imageMessage.id}/media`, { headers: auth(2) });
        assert.equal(response.status, 200); assert.deepEqual(Buffer.from(await response.arrayBuffer()), PNG);
        assert.deepEqual(await files(), before);
    });
});
