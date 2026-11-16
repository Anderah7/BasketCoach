import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createRequire } from 'node:module'
import { randomUUID } from 'node:crypto'
import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, mkdir, writeFile } from 'node:fs/promises'
import { join, resolve, dirname, basename } from 'node:path'
import { tmpdir } from 'node:os'
import { createServer as createViteServer } from 'vite'

const optedIn = process.env.BASKETCOACH_BROWSER_PATH && process.env.BASKETCOACH_MONGOD_PATH
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds))
async function until(check, description, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    const result = await check()
    if (result) return result
    await wait(50)
  }
  throw new Error(`Timed out: ${description}`)
}

// Opt-in browser check. Uses actual communicationService, Gateway and Vite, with
// temporary MongoDB + mocked sports HTTP. Database settings come only from the fixture.
test('two browser users chat through Vite and Gateway, retry failures and retain history', {
  skip: !optedIn && 'Set BASKETCOACH_BROWSER_PATH and BASKETCOACH_MONGOD_PATH for isolated browser checks', timeout: 90000,
}, async t => {
  const requireCommunication = createRequire(new URL('../../communicationService/package.json', import.meta.url))
  const Fastify = requireCommunication('fastify')
  const WebSocket = requireCommunication('ws')
  const { buildApp } = requireCommunication('./app')
  const { startMongo } = requireCommunication('./tests/support/mongo')
  const gatewayRoutes = requireCommunication('../apiGateway/routes/pruebas')
  const mongo = await startMongo(process.env.BASKETCOACH_MONGOD_PATH)
  const temporaryRoot = resolve(tmpdir())
  const browserDirectory = await mkdtemp(join(temporaryRoot, 'basketcoach-chat-browser-'))
  if (dirname(resolve(browserDirectory)) !== temporaryRoot || !basename(browserDirectory).startsWith('basketcoach-chat-browser-')) throw new Error('Unsafe browser test directory')
  let app, gateway, sports, vite, chrome, cdp
  let stopped
  t.after(async () => {
    if (cdp) await cdp.call('Browser.close').catch(() => {})
    if (chrome) { chrome.kill(); await stopped }
    cdp?.socket.close()
    // Terminate upstream sockets before closing proxies, including half-open
    // connections left by the deliberately simulated network interruption.
    await app?.close(); await vite?.close(); await gateway?.close(); await sports?.close()
    await mongo.stop()
    await rm(browserDirectory, { recursive: true, force: true, maxRetries: 10, retryDelay: 150 })
  })
  const users = [1, 2].map(id => ({ id, name: `Test User ${id}`, username: `player_${id}`, role: id === 1 ? 'coach' : 'player',
    avatar_media_id: null, is_active: true, created_at: '2026-01-01T00:00:00Z', email: `test${id}@example.com` }))
  const tokens = users.map(user => `header.${Buffer.from(JSON.stringify({ sub: String(user.id), exp: Math.floor(Date.now() / 1000) + 600 })).toString('base64url')}.test-signature`)
  let friends = true
  sports = Fastify()
  sports.addHook('preHandler', async (request, reply) => {
    const index = tokens.findIndex(token => request.headers.authorization === `Bearer ${token}`)
    if (index < 0) return reply.code(401).send({ detail: 'Invalid token' })
    request.testUser = users[index]
  })
  sports.get('/users/me', async request => request.testUser)
  sports.get('/users/:id/public', async request => ({ ...users[Number(request.params.id) - 1], friendship_status: friends ? 'FRIENDS' : 'NONE', friend_request_id: null, position: null, team: null, jersey_number: null }))
  sports.get('/friends', async request => friends ? [{ ...users.find(user => user.id !== request.testUser.id), friends_since: '2026-01-01T00:00:00Z' }] : [])
  sports.get('/friends/requests', async () => ({ received: [], sent: [] }))
  await sports.listen({ host: '127.0.0.1', port: 0 })
  const sportsUrl = `http://127.0.0.1:${sports.server.address().port}`
  const origins = []
  app = buildApp({ logger: false, config: { mongoUri: mongo.uri, mongoDbName: 'basketcoach_browser_isolated_test', sportsServiceUrl: sportsUrl, corsOrigins: origins } })
  await app.listen({ host: '127.0.0.1', port: 0 })
  const previousSports = process.env.SPORTS_SERVICE_URL, previousCommunication = process.env.COMMUNICATION_SERVICE_URL
  process.env.SPORTS_SERVICE_URL = sportsUrl
  process.env.COMMUNICATION_SERVICE_URL = `http://127.0.0.1:${app.server.address().port}`
  gateway = Fastify()
  try { gateway.register(gatewayRoutes); await gateway.listen({ host: '127.0.0.1', port: 0 }) }
  finally {
    if (previousSports === undefined) delete process.env.SPORTS_SERVICE_URL; else process.env.SPORTS_SERVICE_URL = previousSports
    if (previousCommunication === undefined) delete process.env.COMMUNICATION_SERVICE_URL; else process.env.COMMUNICATION_SERVICE_URL = previousCommunication
  }
  vite = await createViteServer({ server: { host: '127.0.0.1', port: 0, proxy: { '/api': { target: `http://127.0.0.1:${gateway.server.address().port}`, changeOrigin: true, ws: true } } } })
  await vite.listen()
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`
  origins.push(origin)
  chrome = spawn(process.env.BASKETCOACH_BROWSER_PATH, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${browserDirectory}`, '--no-first-run', '--no-default-browser-check', 'about:blank'], { windowsHide: true, stdio: 'ignore' })
  let launchError
  chrome.on('error', error => { launchError = error })
  stopped = new Promise(resolve => { chrome.once('exit', resolve); chrome.once('error', resolve) })
  const debug = await until(async () => {
    if (launchError) throw launchError
    return readFile(join(browserDirectory, 'DevToolsActivePort'), 'utf8').catch(() => null)
  }, 'temporary headless browser startup')
  const [port, browserPath] = debug.trim().split(/\r?\n/)
  const socket = new WebSocket(`ws://127.0.0.1:${port}${browserPath}`)
  await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject) })
  let sequence = 0
  const pending = new Map(), errors = []
  socket.on('message', raw => {
    const frame = JSON.parse(raw.toString())
    if (frame.method === 'Runtime.exceptionThrown') errors.push(frame.params.exceptionDetails.text)
    if (frame.id) {
      const item = pending.get(frame.id)
      if (!item) return
      pending.delete(frame.id); clearTimeout(item.timer)
      if (frame.error) item.reject(new Error(frame.error.message)); else item.resolve(frame.result)
    }
  })
  cdp = { socket, call(method, params = {}, sessionId) {
    return new Promise((resolve, reject) => {
      const id = ++sequence
      pending.set(id, { resolve, reject, timer: setTimeout(() => { pending.delete(id); reject(new Error(`CDP timed out: ${method}`)) }, 10000) })
      socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }))
    })
  } }
  async function evaluate(session, expression) {
    const response = await cdp.call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, session)
    if (response.exceptionDetails) throw new Error(response.exceptionDetails.exception?.description ?? response.exceptionDetails.text)
    return response.result.value
  }
  async function openUser(index, path = '/chat') {
    const context = await cdp.call('Target.createBrowserContext')
    const target = await cdp.call('Target.createTarget', { url: 'about:blank', browserContextId: context.browserContextId })
    const { sessionId } = await cdp.call('Target.attachToTarget', { targetId: target.targetId, flatten: true })
    await cdp.call('Runtime.enable', {}, sessionId)
    await cdp.call('Page.enable', {}, sessionId)
    await cdp.call('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false }, sessionId)
    await cdp.call('Page.addScriptToEvaluateOnNewDocument', { source: `if (location.origin === ${JSON.stringify(origin)}) sessionStorage.setItem('basketcoach.accessToken', ${JSON.stringify(tokens[index])});` }, sessionId)
    await cdp.call('Page.navigate', { url: origin + path }, sessionId)
    await until(() => evaluate(sessionId, `document.querySelector('.chat-connection-connected') !== null`), 'chat connection ready')
    return sessionId
  }
  const a = await openUser(0)
  await evaluate(a, `document.querySelector('[aria-label="New conversation"]').click()`)
  await until(() => evaluate(a, `document.querySelector('.chat-friend') !== null`), 'friend picker')
  await evaluate(a, `document.querySelector('.chat-friend').click()`)
  await until(() => evaluate(a, `document.querySelector('.chat-composer textarea')?.disabled === false`), 'friend conversation creation')
  const id = await evaluate(a, `location.pathname.split('/').at(-1)`)
  assert.match(id, /^[a-f0-9]{24}$/)
  const b = await openUser(1, `/chat/${id}`)
  await until(() => evaluate(b, `document.querySelector('.chat-composer textarea')?.disabled === false`), 'second user can send')

  async function send(session, text) {
    await evaluate(session, `(() => { const input = document.querySelector('.chat-composer textarea'); Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, ${JSON.stringify(text)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`)
    await until(() => evaluate(session, `document.querySelector('.chat-send')?.disabled === false`), 'composer accepts text')
    await evaluate(session, `document.querySelector('.chat-send').click()`)
  }
  const countText = (session, text) => evaluate(session, `Array.from(document.querySelectorAll('.chat-bubble p')).filter(node => node.textContent === ${JSON.stringify(text)}).length`)
  await send(a, 'Hello from the coach')
  await until(() => countText(b, 'Hello from the coach'), 'recipient receives live message')
  await until(() => evaluate(a, `document.querySelector('.chat-message-own footer')?.textContent.includes('Saved')`), 'sender sees persisted acknowledgement')
  await send(b, 'Hello from the player')
  await until(() => countText(a, 'Hello from the player'), 'coach receives reply')
  assert.equal(await app.mongo.db.collection('messages').countDocuments(), 2)

  const save = app.chatStore.saveText
  let failOnce = true
  app.chatStore.saveText = async (...args) => { if (failOnce) { failOnce = false; throw new Error('Simulated storage outage') } return save(...args) }
  await send(a, 'Retry this message')
  await until(() => evaluate(a, `document.querySelector('.chat-send-error button') !== null`), 'failed send has retry feedback')
  await evaluate(a, `document.querySelector('.chat-send-error button').click()`)
  await until(() => countText(b, 'Retry this message'), 'manual retry reaches recipient')
  assert.equal(await countText(a, 'Retry this message'), 1)
  assert.equal(await app.mongo.db.collection('messages').countDocuments({ text: 'Retry this message' }), 1)
  if (process.env.BASKETCOACH_CHAT_SCREENSHOT === '1') {
    const screenshot = await cdp.call('Page.captureScreenshot', { format: 'png' }, a)
    await mkdir(resolve('node_modules/.tmp'), { recursive: true })
    await writeFile(resolve('node_modules/.tmp/chat-preview.png'), Buffer.from(screenshot.data, 'base64'))
  }
  await cdp.call('Page.reload', {}, b)
  await until(() => countText(b, 'Hello from the coach'), 'persisted history survives reload')
  await until(() => countText(b, 'Retry this message'), 'all saved messages restored')

  // Missing more than one page during an outage must not leave a hole in history.
  await cdp.call('Network.enable', {}, b)
  await cdp.call('Network.emulateNetworkConditions', { offline: true, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, b)
  await until(() => evaluate(b, `document.querySelector('.chat-connection-offline') !== null`), 'offline state')
  for (let index = 0; index < 55; index++) await app.chatStore.saveText(id, 1, randomUUID(), `Missed while offline ${index}`)
  await cdp.call('Network.emulateNetworkConditions', { offline: false, latency: 0, downloadThroughput: -1, uploadThroughput: -1 }, b)
  await until(() => evaluate(b, `document.querySelectorAll('.chat-bubble p').length === 58`), 'reconnection recovers all pages without history gaps')
  assert.equal(await countText(b, 'Missed while offline 0'), 1)
  assert.equal(await countText(b, 'Missed while offline 54'), 1)

  friends = false
  await evaluate(a, `document.querySelector('[aria-label="Refresh conversations and messages"]').click()`)
  await until(() => evaluate(a, `document.querySelector('.chat-composer textarea')?.disabled === true && document.querySelector('.chat-thread-notice')?.textContent.includes('current friends')`), 'unfriending blocks composer')
  assert.equal(await countText(a, 'Hello from the player'), 1)
  await cdp.call('Emulation.setDeviceMetricsOverride', { width: 390, height: 844, deviceScaleFactor: 1, mobile: true }, a)
  assert.equal(await evaluate(a, `getComputedStyle(document.querySelector('.chat-sidebar')).display`), 'none')
  assert.equal(await evaluate(a, `document.documentElement.scrollWidth <= window.innerWidth`), true)
  await evaluate(a, `document.querySelector('.chat-back').click()`)
  await until(() => evaluate(a, `location.pathname === '/chat' && getComputedStyle(document.querySelector('.chat-sidebar')).display !== 'none'`), 'mobile back navigation')
  await evaluate(a, `document.querySelector('.sidebar-logout').click()`)
  await until(() => evaluate(a, `location.pathname === '/login'`), 'logout exits chat')
  assert.equal(await evaluate(a, `sessionStorage.getItem('basketcoach.accessToken')`), null)
  await until(() => app.websocketServer.clients.size === 1, 'logout closes the first user WebSocket')
  assert.deepEqual(errors, [], 'No uncaught browser errors')
})
