import type { PublicUser } from './social'
import type { NotificationEvent } from './notifications'

interface MessageBase {
  id: string
  conversation_id: string
  sender_id: number
  client_message_id: string
  created_at: string
}

export type ChatMessage = MessageBase & (
  | { type: 'TEXT'; text: string; media: null }
  | { type: 'IMAGE' | 'VIDEO'; text: string | null; media: { content_type: string; size_bytes: number } }
)

export interface MediaConfig {
  image_max_bytes: number
  video_max_bytes: number
  image_types: string[]
  video_types: string[]
}

export interface Conversation {
  id: string
  participant_ids: [number, number]
  created_at: string
  other_participant: PublicUser | null
  last_message: ChatMessage | null
  unread_count: number
}

export interface ConversationPage {
  items: Conversation[]
  limit: number
  offset: number
}

export interface MessagePage {
  items: ChatMessage[]
  next_cursor: string | null
}

export interface ChatTicket {
  ticket: string
  expires_at: string
  ws_path: string
}

export interface SendMessage {
  event: 'message.send'
  conversation_id: string
  client_message_id: string
  type: 'TEXT'
  text: string
}

export type ClientChatEvent = SendMessage | { event: 'conversation.view'; conversation_id: string | null }

export interface OutgoingMessage {
  event: 'message.send'
  conversation_id: string
  client_message_id: string
  type: 'TEXT' | 'IMAGE' | 'VIDEO'
  text: string
  file?: File
  created_at: string
  state: 'sending' | 'failed'
  error: string | null
}

export type ChatEvent =
  | { event: 'ready'; user_id: number; expires_at: string }
  | { event: 'message.ack'; client_message_id: string; duplicate: boolean; message: ChatMessage }
  | { event: 'message.received'; message: ChatMessage }
  | { event: 'error'; status: number; code: string; message: string; client_message_id: string | null }
  | { event: 'conversation.viewed'; conversation_id: string | null }
  | { event: 'conversation.unread'; conversation_id: string; unread_count: number }
  | NotificationEvent

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error'
