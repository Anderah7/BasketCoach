import type { PublicUser } from './social'

export interface ChatMessage {
  id: string
  conversation_id: string
  sender_id: number
  client_message_id: string
  type: 'TEXT'
  text: string
  media: null
  created_at: string
}

export interface Conversation {
  id: string
  participant_ids: [number, number]
  created_at: string
  other_participant: PublicUser | null
  last_message: ChatMessage | null
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

export interface OutgoingMessage extends SendMessage {
  created_at: string
  state: 'sending' | 'failed'
  error: string | null
}

export type ChatEvent =
  | { event: 'ready'; user_id: number; expires_at: string }
  | { event: 'message.ack'; client_message_id: string; duplicate: boolean; message: ChatMessage }
  | { event: 'message.received'; message: ChatMessage }
  | { event: 'error'; status: number; code: string; message: string; client_message_id: string | null }

export type ConnectionState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'error'
