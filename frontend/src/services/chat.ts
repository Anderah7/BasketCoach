import type { ChatEvent, ChatMessage, Conversation, MediaConfig } from '../types/chat'

const objectId = /^[a-f0-9]{24}$/i
const clientId = /^[A-Za-z0-9_-]{8,64}$/
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))
const positiveId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0

export function isChatMessage(value: unknown): value is ChatMessage {
  if (!(record(value) && typeof value.id === 'string' && objectId.test(value.id) &&
    typeof value.conversation_id === 'string' && objectId.test(value.conversation_id) && positiveId(value.sender_id) &&
    typeof value.client_message_id === 'string' && clientId.test(value.client_message_id) &&
    date(value.created_at))) return false
  if (value.type === 'TEXT') return typeof value.text === 'string' && value.media === null
  if (value.type !== 'IMAGE' && value.type !== 'VIDEO') return false
  return (value.text === null || typeof value.text === 'string') && record(value.media) &&
    typeof value.media.size_bytes === 'number' && Number.isSafeInteger(value.media.size_bytes) && value.media.size_bytes > 0 &&
    typeof value.media.content_type === 'string' && (value.type === 'IMAGE'
      ? ['image/jpeg', 'image/png', 'image/webp'].includes(value.media.content_type)
      : ['video/mp4', 'video/webm'].includes(value.media.content_type))
}

export function parseChatEvent(raw: string): ChatEvent {
  const frame: unknown = JSON.parse(raw)
  if (record(frame)) {
    if (frame.event === 'ready' && positiveId(frame.user_id) && date(frame.expires_at)) {
      return { event: 'ready', user_id: frame.user_id, expires_at: frame.expires_at }
    }
    if (frame.event === 'message.received' && isChatMessage(frame.message)) return { event: 'message.received', message: frame.message }
    if (frame.event === 'message.ack' && isChatMessage(frame.message) && typeof frame.duplicate === 'boolean' && frame.client_message_id === frame.message.client_message_id) {
      return { event: 'message.ack', message: frame.message, duplicate: frame.duplicate, client_message_id: frame.message.client_message_id }
    }
    if (frame.event === 'error' && typeof frame.status === 'number' && Number.isInteger(frame.status) && frame.status >= 400 && frame.status <= 599 &&
      typeof frame.code === 'string' && typeof frame.message === 'string' &&
      (frame.client_message_id === null || (typeof frame.client_message_id === 'string' && clientId.test(frame.client_message_id)))) {
      return { event: 'error', status: frame.status, code: frame.code, message: frame.message, client_message_id: frame.client_message_id }
    }
  }
  throw new Error('The chat service returned an invalid event.')
}

export function mergeMessages(current: ChatMessage[], incoming: ChatMessage[]): ChatMessage[] {
  const messages = new Map(current.map(message => [message.id, message]))
  for (const message of incoming) messages.set(message.id, message)
  return [...messages.values()].sort((a, b) => a.created_at.localeCompare(b.created_at) || a.id.localeCompare(b.id))
}

export function sortConversations(items: Conversation[]): Conversation[] {
  return [...items].sort((a, b) => (b.last_message?.created_at ?? b.created_at).localeCompare(a.last_message?.created_at ?? a.created_at) || b.id.localeCompare(a.id))
}

export function conversationLabel(conversation: Conversation, userId: number): string {
  const person = conversation.other_participant
  return person?.username ? `@${person.username}` : `User #${conversation.participant_ids.find(id => id !== userId) ?? '?'}`
}

export function chatSocketUrl(): string {
  const url = new URL('/api/communication/ws', window.location.origin)
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

export function messagePreview(message: ChatMessage): string {
  return message.type === 'TEXT' ? message.text : `${message.type === 'IMAGE' ? 'Photo' : 'Video'}${message.text ? ` · ${message.text}` : ''}`
}

export function attachmentType(file: File, config: MediaConfig): 'IMAGE' | 'VIDEO' {
  const type = config.image_types.includes(file.type) ? 'IMAGE' : config.video_types.includes(file.type) ? 'VIDEO' : null
  if (!type) throw new Error('Choose a JPEG, PNG, WebP image or an MP4 or WebM video.')
  const maximum = type === 'IMAGE' ? config.image_max_bytes : config.video_max_bytes
  if (!file.size) throw new Error('Empty files are not allowed.')
  if (file.size > maximum) throw new Error(`This ${type.toLowerCase()} exceeds the ${Number((maximum / 1024 / 1024).toFixed(2))} MB limit.`)
  return type
}
