import type { ChatEvent, ChatTicket, ConnectionState, SendMessage } from '../types/chat'
import { parseChatEvent } from './chat'

interface ConnectionOptions {
  url: string
  userId: number
  getTicket: (signal: AbortSignal) => Promise<ChatTicket>
  onEvent: (event: ChatEvent) => void
  onState: (state: ConnectionState, message: string | null) => void
  onDisconnect: () => void
  createSocket?: (url: string) => WebSocket
}

export class ChatConnection {
  private readonly options: ConnectionOptions
  private socket: WebSocket | null = null
  private controller: AbortController | null = null
  private retryTimer: ReturnType<typeof setTimeout> | undefined
  private handshakeTimer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private ready = false
  private generation = 0
  private attempts = 0

  constructor(options: ConnectionOptions) { this.options = options }

  start() {
    if (this.running) return
    this.running = true
    void this.connect()
  }

  stop() {
    this.running = false
    this.generation++
    this.controller?.abort()
    clearTimeout(this.retryTimer)
    clearTimeout(this.handshakeTimer)
    this.releaseSocket()
  }

  reconnect() {
    this.stop()
    this.attempts = 0
    this.start()
  }

  send(message: SendMessage): boolean {
    if (!this.ready || !this.socket || this.socket.readyState !== 1) return false
    try { this.socket.send(JSON.stringify(message)); return true } catch { return false }
  }

  private releaseSocket() {
    this.ready = false
    if (this.socket) {
      this.socket.onopen = null
      this.socket.onmessage = null
      this.socket.onerror = null
      this.socket.onclose = null
      this.socket.close()
      this.socket = null
    }
  }

  private schedule(message: string) {
    if (!this.running) return
    this.options.onState('reconnecting', message)
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.attempts++, 5))
    this.retryTimer = setTimeout(() => { void this.connect() }, delay)
  }

  private async connect() {
    if (!this.running) return
    const generation = ++this.generation
    const current = () => this.running && this.generation === generation
    this.releaseSocket()
    this.options.onState(this.attempts ? 'reconnecting' : 'connecting', null)
    const controller = new AbortController()
    this.controller = controller
    const ticketTimeout = setTimeout(() => controller.abort(), 10000)
    try {
      // A fresh single-use ticket is obtained for every connection attempt.
      const ticket = await this.options.getTicket(controller.signal)
      clearTimeout(ticketTimeout)
      if (!current()) return
      if (!ticket || typeof ticket.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(ticket.ticket)) {
        throw new Error('The chat service returned an invalid ticket.')
      }
      const socket = (this.options.createSocket ?? (url => new WebSocket(url)))(this.options.url)
      this.socket = socket
      this.handshakeTimer = setTimeout(() => {
        if (current()) socket.close()
      }, 10000)
      socket.onopen = () => {
        if (current()) socket.send(JSON.stringify({ event: 'authenticate', ticket: ticket.ticket }))
      }
      socket.onmessage = (message: MessageEvent<unknown>) => {
        if (!current()) return
        let frame: ChatEvent
        try {
          if (typeof message.data !== 'string') throw new Error('Invalid chat event')
          frame = parseChatEvent(message.data)
        } catch {
          this.options.onState('error', 'The chat service returned an invalid response.')
          socket.close(1002)
          return
        }
        if (frame.event === 'ready') {
          if (frame.user_id !== this.options.userId) {
            this.options.onState('error', 'The chat session does not match your account.')
            this.stop()
            return
          }
          this.ready = true
          this.attempts = 0
          clearTimeout(this.handshakeTimer)
          this.options.onState('connected', null)
        } else if (!this.ready && frame.event !== 'error') {
          socket.close(1002)
          return
        }
        this.options.onEvent(frame)
      }
      socket.onerror = () => { /* onclose handles reconnects without exposing credentials. */ }
      socket.onclose = () => {
        if (!current()) return
        this.ready = false
        clearTimeout(this.handshakeTimer)
        this.options.onDisconnect()
        this.schedule('Connection lost. Reconnecting to chat...')
      }
    } catch (error) {
      clearTimeout(ticketTimeout)
      if (!current()) return
      const status = error && typeof error === 'object' && 'status' in error ? error.status : null
      const message = error instanceof Error && error.name !== 'AbortError' ? error.message : 'The chat connection timed out.'
      if (status === 401 || status === 403) {
        this.options.onState('error', message)
        this.running = false
      } else {
        this.schedule(message)
      }
    }
  }
}
