import type { PublicUser } from './social'

export interface Notification {
  id: string
  event_id: string
  recipient_id: number
  actor_id: number
  actor: PublicUser | null
  type: 'FRIEND_REQUEST' | 'FRIEND_ACCEPTED' | 'NEW_MESSAGE'
  resource: { friend_request_id?: number; conversation_id?: string; message_id?: string; message_type?: 'TEXT' | 'IMAGE' | 'VIDEO' }
  created_at: string
  is_read: boolean
  read_at: string | null
}

export interface NotificationPage { items: Notification[]; has_more: boolean; limit: number; offset: number }

export type NotificationEvent =
  | { event: 'notification.created'; notification: Notification; unread_count: number }
  | { event: 'notifications.read'; unread_count: number; read_at: string; notification_id?: string; conversation_id?: string; all?: boolean }
