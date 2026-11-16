import { test } from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { build } from 'vite'

// Bundle in memory with the project's existing compiler: no test framework or DOM dependency.
async function importSource(entry) {
  const result = await build({ configFile: false, logLevel: 'silent', build: {
    write: false, minify: false, lib: { entry: resolve(entry), formats: ['es'] },
  } })
  const output = (Array.isArray(result) ? result[0] : result).output.find(item => item.type === 'chunk' && item.isEntry)
  return import(`data:text/javascript;base64,${Buffer.from(output.code).toString('base64')}`)
}
const { ChatConnection } = await importSource('src/services/chat-connection.ts')
const { mergeMessages, parseChatEvent } = await importSource('src/services/chat.ts')
const nextTurn = () => new Promise(resolve => setImmediate(resolve))
const ticket = { ticket: 'a'.repeat(43), expires_at: new Date(Date.now() + 30000).toISOString(), ws_path: '/ws' }
const ready = { event: 'ready', user_id: 1, expires_at: new Date(Date.now() + 60000).toISOString() }
const message = {
  id: '000000000000000000000001', conversation_id: 'aaaaaaaaaaaaaaaaaaaaaaaa', sender_id: 1,
  client_message_id: 'client-message-001', type: 'TEXT', text: 'Hello', media: null, created_at: '2026-01-01T12:00:00.000Z',
}

class FakeSocket {
  readyState = 0
  frames = []
  onopen = null
  onmessage = null
  onclose = null
  onerror = null
  constructor(url) { this.url = url }
  open() { this.readyState = 1; this.onopen?.() }
  receive(frame) { this.onmessage?.({ data: JSON.stringify(frame) }) }
  send(frame) { this.frames.push(JSON.parse(frame)) }
  close() { this.readyState = 3; this.onclose?.() }
}

function setup(t, overrides = {}) {
  const sockets = [], states = [], events = []
  let tickets = 0, disconnects = 0
  const connection = new ChatConnection({
    url: 'ws://localhost/api/communication/ws', userId: 1,
    getTicket: async () => { tickets++; return ticket },
    onState: (state, message) => states.push({ state, message }),
    onEvent: event => events.push(event),
    onDisconnect: () => { disconnects++ },
    createSocket: url => { const socket = new FakeSocket(url); sockets.push(socket); return socket },
    ...overrides,
  })
  t.after(() => connection.stop())
  return { connection, sockets, states, events, tickets: () => tickets, disconnects: () => disconnects }
}

test('authenticate using a fresh ticket frame; never put credentials in the URL', async t => {
  const { connection, sockets, states } = setup(t)
  connection.start(); await nextTurn()
  const socket = sockets[0]
  assert.equal(socket.url, 'ws://localhost/api/communication/ws')
  assert.equal(connection.send({ event: 'message.send' }), false)
  socket.open()
  assert.deepEqual(socket.frames, [{ event: 'authenticate', ticket: ticket.ticket }])
  socket.receive(ready)
  assert.equal(states.at(-1).state, 'connected')
  const frame = { event: 'message.send', conversation_id: message.conversation_id, client_message_id: message.client_message_id, type: 'TEXT', text: 'Hello' }
  assert.equal(connection.send(frame), true)
  assert.deepEqual(socket.frames.at(-1), frame)
})

test('disconnects reconnect with a new ticket instead of reusing an old one', async t => {
  const { connection, sockets, tickets, disconnects } = setup(t)
  connection.start(); await nextTurn()
  sockets[0].open(); sockets[0].receive(ready); sockets[0].close()
  assert.equal(disconnects(), 1)
  await new Promise(resolve => setTimeout(resolve, 1100))
  assert.equal(tickets(), 2); assert.equal(sockets.length, 2)
  assert.equal(connection.send({ event: 'message.send' }), false)
})

test('late ticket responses cannot open a socket after logout or unmount', async t => {
  let resolveTicket, signal
  const { connection, sockets } = setup(t, { getTicket: value => { signal = value; return new Promise(resolve => { resolveTicket = resolve }) } })
  connection.start(); connection.stop()
  assert.equal(signal.aborted, true)
  resolveTicket(ticket); await nextTurn()
  assert.equal(sockets.length, 0)
})

test('reconnect ignores stale callbacks from the previous connection', async t => {
  const { connection, sockets, states } = setup(t)
  connection.start(); await nextTurn()
  const oldMessage = sockets[0].onmessage
  connection.reconnect(); await nextTurn()
  oldMessage({ data: JSON.stringify(ready) })
  assert.equal(states.at(-1).state, 'connecting')
  sockets[1].open(); sockets[1].receive(ready)
  assert.equal(states.at(-1).state, 'connected')
})

test('rejected JWTs stop automatic retries; a mismatched ready identity is rejected', async t => {
  const rejected = setup(t, { getTicket: async () => { throw Object.assign(new Error('Session expired'), { status: 401 }) } })
  rejected.connection.start(); await nextTurn()
  assert.equal(rejected.states.at(-1).state, 'error'); assert.equal(rejected.sockets.length, 0)
  const mismatch = setup(t)
  mismatch.connection.start(); await nextTurn()
  mismatch.sockets[0].open(); mismatch.sockets[0].receive({ ...ready, user_id: 99 })
  assert.equal(mismatch.states.at(-1).state, 'error'); assert.equal(mismatch.sockets[0].readyState, 3)
})

test('message errors are forwarded for retry feedback and friendship restrictions', async t => {
  const { connection, sockets, events } = setup(t)
  connection.start(); await nextTurn(); sockets[0].open(); sockets[0].receive(ready)
  const error = { event: 'error', status: 403, code: 'NOT_FRIENDS', message: 'You can only chat with current friends', client_message_id: message.client_message_id }
  sockets[0].receive(error)
  assert.deepEqual(events.at(-1), error)
})

test('deduplicate retries and merge paginated/live messages with a stable timestamp tie-breaker', () => {
  const second = { ...message, id: '000000000000000000000002', client_message_id: 'client-message-002' }
  const merged = mergeMessages([second, message], [message, second])
  assert.deepEqual(merged.map(row => row.id), [message.id, second.id])
  assert.deepEqual(parseChatEvent(JSON.stringify({ event: 'message.ack', client_message_id: message.client_message_id, duplicate: true, message })), {
    event: 'message.ack', client_message_id: message.client_message_id, duplicate: true, message,
  })
  assert.throws(() => parseChatEvent('{'))
  assert.throws(() => parseChatEvent(JSON.stringify({ event: 'message.received', message: { ...message, sender_id: -1 } })))
  assert.throws(() => parseChatEvent(JSON.stringify({ event: 'message.ack', message, duplicate: true, client_message_id: 'wrong-message-id' })))
})
