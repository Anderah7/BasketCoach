const { test } = require('node:test');
const assert = require('node:assert/strict');
const { once } = require('node:events');
const { randomUUID } = require('node:crypto');
const Fastify = require('fastify');
const WebSocket = require('ws');
const { ObjectId } = require('@fastify/mongodb');
const { buildApp } = require('../app');
const { startMongo } = require('./support/mongo');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(check) { for (let i = 0; i < 100; i++) { if (await check()) return; await wait(20); } throw new Error('Timed out waiting for notification state'); }

test('isolated notification ownership, internal events, retries, presence and multiple tabs', {
    skip: !process.env.BASKETCOACH_MONGOD_PATH && 'Set BASKETCOACH_MONGOD_PATH for isolated integration tests', timeout: 60000
}, async t => {
    const mongo = await startMongo(process.env.BASKETCOACH_MONGOD_PATH);
    let app, gateway;
    const peers = [];
    t.after(async () => { peers.forEach(peer => peer.socket.terminate()); await app?.close(); await gateway?.close(); await mongo.stop(); });
    const secret = 'isolated-notification-secret-not-used-in-production';
    const tokens = new Map([1, 2, 3].map(id => [id, `header.${Buffer.from(JSON.stringify({ sub: String(id), exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.test-signature`]));
    app = buildApp({ logger: false, config: {
        mongoUri: mongo.uri, mongoDbName: 'basketcoach_notifications_isolated_test', mediaRoot: mongo.mediaRoot,
        sportsServiceUrl: 'http://sports.test', corsOrigins: [], notificationSecret: secret, notificationRetryMs: 100000
    }, fetchImpl: async (url, options) => {
        const id = [...tokens].find(([, token]) => options.headers.Authorization === `Bearer ${token}`)?.[0];
        if (!id) return Response.json({}, { status: 401 });
        if (url.endsWith('/users/me')) return Response.json({ id, name: 'Private Name', role: 'player', is_active: true });
        const otherId = Number(url.match(/\/users\/(\d+)\/public$/)[1]);
        return Response.json({ id: otherId, username: `user_${otherId}`, role: 'player', avatar_media_id: null, friendship_status: 'FRIENDS', email: 'private@example.com', strengths: 'private' });
    } });
    app.get('/test/headers', async request => ({ hasSecret: Object.hasOwn(request.headers, 'x-notification-secret') }));
    await app.listen({ host: '127.0.0.1', port: 0 });
    const direct = `http://127.0.0.1:${app.server.address().port}`;
    const previous = process.env.COMMUNICATION_SERVICE_URL;
    process.env.COMMUNICATION_SERVICE_URL = direct;
    gateway = Fastify();
    try { gateway.register(require('../../apiGateway/routes/pruebas')); await gateway.listen({ host: '127.0.0.1', port: 0 }); }
    finally { if (previous === undefined) delete process.env.COMMUNICATION_SERVICE_URL; else process.env.COMMUNICATION_SERVICE_URL = previous; }
    const base = `http://127.0.0.1:${gateway.server.address().port}/api/communication`;
    const auth = id => ({ Authorization: `Bearer ${tokens.get(id) ?? 'invalid'}` });
    async function request(user, path, method = 'GET', body) {
        const response = await fetch(base + path, { method, headers: { ...auth(user), ...(body ? { 'Content-Type': 'application/json' } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
        return { status: response.status, body: await response.json() };
    }
    const count = async user => (await request(user, '/notifications/unread-count')).body.unread_count;
    const event = (requestId, type = 'FRIEND_REQUEST') => ({ event_id: `friend-request:${requestId}:${type}`, type, actor_id: type === 'FRIEND_REQUEST' ? 1 : 2,
        recipient_id: type === 'FRIEND_REQUEST' ? 2 : 1, friend_request_id: requestId, occurred_at: new Date().toISOString() });
    async function internal(body, supplied = secret, url = direct + '/internal/notifications') {
        const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Notification-Secret': supplied }, body: JSON.stringify(body) });
        return { status: response.status, body: await response.json() };
    }
    async function connect(user) {
        const ticket = (await request(user, '/ws/tickets', 'POST')).body.ticket;
        const socket = new WebSocket(base.replace('http:', 'ws:') + '/ws');
        const frames = [];
        socket.on('message', raw => frames.push(JSON.parse(raw.toString())));
        const peer = { socket, frames, send: frame => socket.send(JSON.stringify(frame)) };
        peers.push(peer);
        await once(socket, 'open'); peer.send({ event: 'authenticate', ticket });
        await until(() => frames.some(frame => frame.event === 'ready'));
        return peer;
    }
    const [a, b, bTab, stranger] = await Promise.all([connect(1), connect(2), connect(2), connect(3)]);
    const conversation = (await request(1, '/conversations', 'POST', { user_id: 2 })).body;
    let first;

    await t.test('internal friendship events require the dedicated secret, validate payloads and cannot pass Gateway', async () => {
        assert.equal((await internal(event(1), 'invalid')).status, 403);
        assert.equal((await internal({ ...event(1), type: 'NEW_MESSAGE' })).status, 400);
        assert.equal((await internal({ ...event(1), extra: 'spoof' })).status, 400);
        assert.equal((await internal({ ...event(1), recipient_id: 1 })).status, 422);
        for (const path of ['/internal/notifications', '/%69nternal/notifications', '/internal%2fnotifications']) {
            assert.equal((await internal(event(1), secret, base + path)).status, 404);
        }
        const headers = await fetch(base + '/test/headers', { headers: { ...auth(1), 'X-Notification-Secret': secret } });
        assert.equal((await headers.json()).hasSecret, false);
        first = await internal(event(1)); assert.equal(first.status, 201);
        assert.equal((await internal(event(1))).status, 200);
        assert.equal((await internal({ ...event(1), actor_id: 3 })).status, 409);
        await until(() => b.frames.some(frame => frame.event === 'notification.created'));
        assert.ok(bTab.frames.some(frame => frame.event === 'notification.created'));
        assert.ok(!a.frames.some(frame => frame.event === 'notification.created'));
        assert.ok(!stranger.frames.some(frame => frame.event === 'notification.created'));
        assert.equal(await count(2), 1);
    });

    await t.test('only the recipient can list or mark notifications; pagination and duplicate retries preserve read state', async () => {
        const list = await request(2, '/notifications?limit=1&offset=0');
        assert.equal(list.body.items[0].actor.username, 'user_1');
        assert.ok(!JSON.stringify(list.body).includes('private@example.com'));
        assert.equal((await request(3, '/notifications')).body.items.length, 0);
        assert.equal((await request(1, `/notifications/${first.body.id}/read`, 'PATCH')).status, 404);
        assert.equal((await request(2, '/notifications?user_id=1')).status, 400);
        assert.equal((await request(99, '/notifications')).status, 401);
        await internal(event(2));
        const page = await request(2, '/notifications?limit=1&offset=0');
        assert.equal(page.body.has_more, true);
        assert.notEqual((await request(2, '/notifications?limit=1&offset=1')).body.items[0].id, page.body.items[0].id);
        await internal(event(1, 'FRIEND_ACCEPTED'));
        assert.equal(await count(1), 1);
        await request(2, `/notifications/${first.body.id}/read`, 'PATCH');
        assert.equal((await internal(event(1))).status, 200);
        assert.equal(await count(2), 1);
        await request(2, '/notifications/read-all', 'PATCH');
        assert.equal(await count(2), 0); assert.equal(await count(1), 1);
        await until(() => bTab.frames.some(frame => frame.event === 'notifications.read' && frame.all));
        assert.ok(!stranger.frames.some(frame => frame.event === 'notifications.read'));
        const notifications = b.frames.filter(frame => frame.event.startsWith('notification'));
        assert.ok(!JSON.stringify(notifications).includes(secret)); assert.ok(!JSON.stringify(notifications).includes(tokens.get(2)));
    });

    async function text(value) {
        const clientId = randomUUID();
        a.send({ event: 'message.send', conversation_id: conversation.id, client_message_id: clientId, type: 'TEXT', text: value });
        await until(() => a.frames.some(frame => frame.event === 'message.ack' && frame.client_message_id === clientId));
        return a.frames.find(frame => frame.event === 'message.ack' && frame.client_message_id === clientId).message;
    }
    await t.test('new chat messages notify only their recipient, and replays/history cannot create duplicate notices', async () => {
        const message = await text('Notify recipient');
        await until(async () => await count(2) === 1);
        a.send({ event: 'message.send', conversation_id: conversation.id, client_message_id: message.client_message_id, type: 'TEXT', text: message.text });
        await until(() => a.frames.some(frame => frame.event === 'message.ack' && frame.client_message_id === message.client_message_id && frame.duplicate));
        assert.equal(await count(2), 1);
        const row = await app.chatStore.findMessageById(message.id);
        assert.equal(row.notificationPending, false);
        const old = { ...row, _id: new ObjectId(), clientMessageId: randomUUID() }; delete old.notificationPending;
        await app.mongo.db.collection('messages').insertOne(old);
        await request(2, `/conversations/${conversation.id}/messages`); await app.notifications.retry();
        assert.equal(await count(2), 1);
    });

    await t.test('chat unread counts persist independently of bell reads and synchronize receipt cursors across tabs', async () => {
        const chats = await request(2, '/conversations');
        assert.equal(chats.body.items.find(item => item.id === conversation.id).unread_count, 2);
        assert.equal((await request(1, '/conversations')).body.items.find(item => item.id === conversation.id).unread_count, 0);
        await request(2, '/notifications/read-all', 'PATCH');
        assert.equal(await count(2), 0);
        assert.equal((await request(2, '/conversations')).body.items.find(item => item.id === conversation.id).unread_count, 2);
        const before = b.frames.length;
        b.send({ event: 'conversation.view', conversation_id: conversation.id });
        await until(() => b.frames.slice(before).some(frame => frame.event === 'conversation.viewed'));
        assert.equal((await request(2, '/conversations')).body.items.find(item => item.id === conversation.id).unread_count, 0);
        await until(() => bTab.frames.some(frame => frame.event === 'conversation.unread' && frame.conversation_id === conversation.id && frame.unread_count === 0));
        const live = await text('Read immediately in a focused conversation');
        await until(async () => (await app.chatStore.findMessageById(live.id)).notificationPending === false);
        assert.equal((await request(2, '/conversations')).body.items.find(item => item.id === conversation.id).unread_count, 0);
        const end = b.frames.length;
        b.send({ event: 'conversation.view', conversation_id: null });
        await until(() => b.frames.slice(end).some(frame => frame.event === 'conversation.viewed'));
        const stored = await app.chatStore.findMessageById(live.id);
        const tied = { ...stored, _id: new ObjectId(), clientMessageId: randomUUID(), notificationPending: false };
        await app.mongo.db.collection('messages').insertOne(tied);
        assert.equal((await request(2, '/conversations')).body.items.find(item => item.id === conversation.id).unread_count, 1, 'Equal timestamps still compare message IDs');
        await Promise.all([app.chatRead.markRead(2, conversation.id), app.chatRead.markRead(2, conversation.id)]);
        assert.equal((await request(2, '/conversations', 'POST', { user_id: 1 })).body.unread_count, 0);
        assert.ok(!a.frames.some(frame => frame.event === 'conversation.unread'), 'Receiver counters are not disclosed to the sender');
    });

    await t.test('visible conversation suppresses unread alerts across tabs and marks only notifications as read', async () => {
        bTab.send({ event: 'conversation.view', conversation_id: conversation.id });
        await until(() => bTab.frames.some(frame => frame.event === 'conversation.viewed' && frame.conversation_id === conversation.id));
        assert.equal(await count(2), 0);
        const message = await text('Read in the active tab');
        await until(async () => (await app.chatStore.findMessageById(message.id)).notificationPending === false);
        assert.equal(await count(2), 0);
        const notice = (await request(2, '/notifications')).body.items.find(item => item.resource.message_id === message.id);
        assert.equal(notice.is_read, true);
        assert.equal((await app.chatStore.findMessageById(message.id)).readAt, undefined);
        b.send({ event: 'conversation.view', conversation_id: null });
        const next = await text('Another tab still reads this');
        await until(async () => (await app.chatStore.findMessageById(next.id)).notificationPending === false);
        assert.equal(await count(2), 0);
        bTab.socket.close(); await once(bTab.socket, 'close');
        const foreign = (await request(1, '/conversations', 'POST', { user_id: 3 })).body;
        b.send({ event: 'conversation.view', conversation_id: foreign.id });
        await until(() => b.frames.some(frame => frame.event === 'error' && frame.status === 403));
        const unread = await text('No recipient tab is viewing');
        await until(async () => (await app.chatStore.findMessageById(unread.id)).notificationPending === false);
        assert.equal(await count(2), 1);
    });

    await t.test('notification storage failure does not fail a saved message; pending flags recover without resetting read notices', async () => {
        const create = app.notifications.create;
        app.notifications.create = async () => { throw new Error('Notification storage failed'); };
        let message;
        try { message = await text('Durably retry this notice'); await until(async () => (await app.chatStore.findMessageById(message.id)).notificationPending === true); }
        finally { app.notifications.create = create; }
        const start = b.frames.length;
        b.send({ event: 'conversation.view', conversation_id: conversation.id });
        await until(() => b.frames.slice(start).some(frame => frame.event === 'conversation.viewed' && frame.conversation_id === conversation.id));
        b.send({ event: 'conversation.view', conversation_id: null });
        await until(() => b.frames.slice(start).some(frame => frame.event === 'conversation.viewed' && frame.conversation_id === null));
        await app.notifications.retry();
        assert.equal((await app.chatStore.findMessageById(message.id)).notificationPending, false);
        const notice = (await request(2, '/notifications')).body.items.find(item => item.resource.message_id === message.id);
        assert.equal(notice.is_read, true, 'Delayed notifications respect a previous view, without message read receipts');
        await request(2, `/notifications/${notice.id}/read`, 'PATCH');
        const before = await count(2);
        await app.mongo.db.collection('messages').updateOne({ _id: new ObjectId(message.id) }, { $set: { notificationPending: true } });
        await app.notifications.retry(); assert.equal(await count(2), before);
    });

    await t.test('HTTP image/video uploads generate the same recipient notifications and retry deduplication', async () => {
        const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9K4q0AAAAASUVORK5CYII=', 'base64');
        const mp4 = Buffer.from('000000186674797069736f6d0000000069736f6d69736f32', 'hex');
        for (const [bytes, mime, type] of [[png, 'image/png', 'IMAGE'], [mp4, 'video/mp4', 'VIDEO']]) {
            const clientId = randomUUID();
            for (let attempt = 0; attempt < 2; attempt++) {
                const form = new FormData(); form.append('client_message_id', clientId); form.append('file', new Blob([bytes], { type: mime }), 'attachment');
                const response = await fetch(`${base}/conversations/${conversation.id}/messages/media`, { method: 'POST', headers: auth(1), body: form });
                assert.equal(response.status, attempt ? 200 : 201);
                const message = (await response.json()).message;
                const list = (await request(2, '/notifications')).body.items.filter(item => item.resource.message_id === message.id);
                assert.equal(list.length, 1); assert.equal(list[0].resource.message_type, type);
            }
        }
    });
});
