const { test } = require('node:test');
const assert = require('node:assert/strict');
const Fastify = require('fastify');
const authentication = require('../plugins/authentication');
const accountRoutes = require('../routes/account');
const healthRoutes = require('../routes/health');
const probeRoutes = require('../routes/pruebas');

function createApp(t, fetchImpl) {
    const app = Fastify();
    app.register(authentication, { sportsServiceUrl: 'http://sports.test', fetchImpl });
    app.register(accountRoutes);
    t.after(() => app.close());
    return app;
}

test('missing or malformed Bearer tokens are rejected without contacting sportsService', async (t) => {
    const app = createApp(t, async () => { assert.fail('Unexpected upstream call'); });
    for (const authorization of [undefined, 'Basic credentials', 'Bearer', 'Bearer a b']) {
        const response = await app.inject({ url: '/me', headers: authorization ? { authorization } : {} });
        assert.equal(response.statusCode, 401);
        assert.equal(response.headers['www-authenticate'], 'Bearer');
    }
});

test('identity comes from sportsService and exposes only id, name and role', async (t) => {
    let calls = 0;
    const app = createApp(t, async (url, options) => {
        calls++;
        assert.equal(url, 'http://sports.test/users/me');
        assert.equal(options.method, 'GET');
        assert.equal(options.headers.Authorization, 'Bearer example-token');
        assert.equal(options.redirect, 'manual');
        assert.ok(options.signal instanceof AbortSignal);
        return Response.json({ id: 7, name: 'Coach', role: 'coach', is_active: true, email: 'private@example.com' });
    });
    const response = await app.inject({ url: '/me?user_id=999', headers: { authorization: 'Bearer example-token' } });
    assert.equal(response.statusCode, 200);
    assert.deepEqual(response.json(), { id: 7, name: 'Coach', role: 'coach' });
    assert.equal(response.headers['cache-control'], 'no-store');
    await app.inject({ url: '/me', headers: { authorization: 'Bearer example-token' } });
    assert.equal(calls, 2, 'Each request must revalidate the active user');
});

test('upstream 401 and 403 remain authentication and permission errors', async (t) => {
    for (const status of [401, 403]) {
        await t.test(String(status), async (subtest) => {
            const app = createApp(subtest, async () => Response.json({ detail: 'Denied' }, { status }));
            const response = await app.inject({ url: '/me', headers: { authorization: 'Bearer example-token' } });
            assert.equal(response.statusCode, status);
        });
    }
});

test('inactive users and malformed upstream profiles are rejected', async (t) => {
    const cases = [
        [{ id: 7, name: 'Coach', role: 'coach', is_active: false }, 403],
        [{ id: 7, name: 'Coach', role: 'coach' }, 502],
        [{ id: 7, name: 'Coach', role: 'admin', is_active: true }, 502],
        [{ id: '7', name: 'Coach', role: 'coach', is_active: true }, 502],
        [null, 502]
    ];
    for (const [profile, status] of cases) {
        await t.test(JSON.stringify(profile), async (subtest) => {
            const app = createApp(subtest, async () => Response.json(profile));
            const response = await app.inject({ url: '/me', headers: { authorization: 'Bearer example-token' } });
            assert.equal(response.statusCode, status);
        });
    }
});

test('dependency failures are mapped without exposing upstream credentials or internals', async (t) => {
    const cases = [
        [async () => { throw new TypeError('Network error with private details'); }, 503],
        [async () => { throw new DOMException('Timeout', 'TimeoutError'); }, 504],
        [async () => new Response('Not JSON', { status: 200 }), 502],
        [async () => new Response('Unavailable', { status: 500 }), 503],
        [async () => new Response(null, { status: 302 }), 502]
    ];
    for (const [fetchImpl, status] of cases) {
        await t.test(String(status), async (subtest) => {
            const app = createApp(subtest, fetchImpl);
            const response = await app.inject({ url: '/me', headers: { authorization: 'Bearer example-token' } });
            assert.equal(response.statusCode, status);
            assert.ok(!response.body.includes('private details'));
            assert.ok(!response.body.includes('example-token'));
        });
    }
});

test('health pings MongoDB and returns 503 on failure; probe aliases are preserved', async (t) => {
    const app = Fastify();
    t.after(() => app.close());
    let available = true;
    app.decorate('mongo', { db: { command: async (command) => {
        assert.deepEqual(command, { ping: 1 });
        if (!available) throw new Error('Disconnected');
        return { ok: 1 };
    } } });
    app.register(healthRoutes);
    app.register(probeRoutes);
    assert.equal((await app.inject('/health')).json().mongodb, 'ok');
    available = false;
    const failed = await app.inject('/health');
    assert.equal(failed.statusCode, 503);
    assert.equal(failed.json().mongodb, 'unavailable');
    for (const url of ['/prueba', '/pruebas']) {
        const response = await app.inject(url);
        assert.equal(response.statusCode, 200);
        assert.deepEqual(response.json(), { status: 'ok', service: 'communicationService' });
    }
});
