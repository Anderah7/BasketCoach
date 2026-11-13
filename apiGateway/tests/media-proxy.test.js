const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const Fastify = require('fastify');
const routes = require('../routes/pruebas');

test('sports proxy forwards multipart uploads and JWT unchanged', async () => {
    const upstream = http.createServer((request, response) => {
        if (request.method === 'GET' && request.url === '/media/1') {
            response.writeHead(200, {
                'content-type': 'image/png',
                'x-received-auth': request.headers.authorization || ''
            });
            response.end(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
            return;
        }
        let bytes = 0;
        request.on('data', (chunk) => { bytes += chunk.length; });
        request.on('end', () => {
            response.writeHead(201, { 'content-type': 'application/json' });
            response.end(JSON.stringify({
                method: request.method,
                path: request.url,
                auth: request.headers.authorization,
                contentType: request.headers['content-type'],
                bytes
            }));
        });
    });
    await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
    const oldUpstream = process.env.SPORTS_SERVICE_URL;
    process.env.SPORTS_SERVICE_URL = `http://127.0.0.1:${upstream.address().port}`;
    const gateway = Fastify();
    try {
        await gateway.register(routes);
        await gateway.listen({ port: 0, host: '127.0.0.1' });
        const form = new FormData();
        form.append('files', new Blob([new Uint8Array(2 * 1024 * 1024)], { type: 'image/png' }), 'sample.png');
        const response = await fetch(`http://127.0.0.1:${gateway.server.address().port}/api/sports/exercises/1/media`, {
            method: 'POST', headers: { Authorization: 'Bearer test-token' }, body: form
        });
        assert.equal(response.status, 201);
        const result = await response.json();
        assert.equal(result.method, 'POST');
        assert.equal(result.path, '/exercises/1/media');
        assert.equal(result.auth, 'Bearer test-token');
        assert.match(result.contentType, /^multipart\/form-data; boundary=/);
        assert.ok(result.bytes > 2 * 1024 * 1024);
        const media = await fetch(`http://127.0.0.1:${gateway.server.address().port}/api/sports/media/1`, {
            headers: { Authorization: 'Bearer test-token' }
        });
        assert.equal(media.status, 200);
        assert.equal(media.headers.get('content-type'), 'image/png');
        assert.equal(media.headers.get('x-received-auth'), 'Bearer test-token');
        assert.deepEqual(Buffer.from(await media.arrayBuffer()), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    } finally {
        await gateway.close();
        await new Promise((resolve) => upstream.close(resolve));
        if (oldUpstream === undefined) delete process.env.SPORTS_SERVICE_URL;
        else process.env.SPORTS_SERVICE_URL = oldUpstream;
    }
});
