const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const websocket = require('@fastify/websocket');
const { TicketStore, verifiedTokenExpiry } = require('../lib/ws-tickets');
const authentication = require('../plugins/authentication');
const websocketRoutes = require('../routes/websocket');

test('tickets are opaque, hashed, single-use, expiring and limited per user', () => {
    let now = 1000;
    const store = new TicketStore({ now: () => now, ttlMs: 100, maxPerUser: 1 });
    const first = store.issue(1, 'Bearer private-token', 5000);
    assert.equal(first.ticket.length, 43);
    assert.ok(!store.entries.has(first.ticket));
    assert.throws(() => store.issue(1, 'Bearer private-token', 5000), { statusCode: 429 });
    assert.equal(store.consume(first.ticket).userId, 1);
    assert.throws(() => store.consume(first.ticket), { statusCode: 401 });
    const second = store.issue(1, 'Bearer private-token', 5000);
    now += 101;
    assert.throws(() => store.consume(second.ticket), { statusCode: 401 });
    assert.throws(() => store.consume('bad-ticket'), { statusCode: 401 });
    assert.throws(() => store.issue(1, 'Bearer expired-token', now - 1), { statusCode: 401 });
    store.clear();
    assert.equal(store.entries.size, 0);
});

test('verified JWT expiry limits tickets and session lifetime', () => {
    const jwt = `header.${Buffer.from(JSON.stringify({ sub: '1', exp: 5 })).toString('base64url')}.signature`;
    assert.equal(verifiedTokenExpiry(`Bearer ${jwt}`, 1000), 5000);
    assert.throws(() => verifiedTokenExpiry(`Bearer ${jwt}`, 5001), { statusCode: 401 });
    assert.throws(() => verifiedTokenExpiry('Bearer invalid', 1000), { statusCode: 401 });
    const store = new TicketStore({ now: () => 1000, ttlMs: 30000 });
    assert.equal(store.issue(1, `Bearer ${jwt}`, 5000).expires_at, new Date(5000).toISOString());
});

test('expired tickets are rejected over the actual WebSocket handler', async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    app.register(websocket);
    app.register(authentication, {
        sportsServiceUrl: 'http://sports.test',
        fetchImpl: async () => Response.json({ id: 1, name: 'Private user', role: 'fan', is_active: true })
    });
    app.register(websocketRoutes, { ticketTtlMs: 5 });
    await app.ready();
    const jwt = `header.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 })).toString('base64url')}.signature`;
    const result = await app.inject({ method: 'POST', url: '/ws/tickets', headers: { authorization: `Bearer ${jwt}` } });
    assert.equal(result.statusCode, 200);
    assert.equal(result.headers['cache-control'], 'no-store');
    await new Promise(resolve => setTimeout(resolve, 15));
    const socket = await app.injectWS('/ws');
    const frame = new Promise(resolve => socket.once('message', data => resolve(JSON.parse(data))));
    socket.send(JSON.stringify({ event: 'authenticate', ticket: result.json().ticket }));
    const rejected = await frame;
    assert.equal(rejected.event, 'error');
    assert.equal(rejected.status, 401);
    socket.terminate();
});
