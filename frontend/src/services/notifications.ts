import type { Notification, NotificationEvent } from '../types/notifications'

const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)
const id = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{24}$/i.test(value)
const userId = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value > 0
const count = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
const date = (value: unknown): value is string => typeof value === 'string' && Number.isFinite(Date.parse(value))

export function isNotification(value: unknown): value is Notification {
  if (!object(value) || !id(value.id) || typeof value.event_id !== 'string' || !userId(value.recipient_id) || !userId(value.actor_id) ||
    !date(value.created_at) || typeof value.is_read !== 'boolean' || !(value.read_at === null || date(value.read_at)) || !object(value.resource)) return false
  if (value.actor !== null && !(object(value.actor) && value.actor.id === value.actor_id &&
    (value.actor.username === null || typeof value.actor.username === 'string') && ['coach', 'player', 'fan'].includes(String(value.actor.role)) &&
    (value.actor.avatar_media_id === null || userId(value.actor.avatar_media_id)))) return false
  return value.type === 'NEW_MESSAGE'
    ? id(value.resource.conversation_id) && id(value.resource.message_id) && ['TEXT', 'IMAGE', 'VIDEO'].includes(String(value.resource.message_type))
    : ['FRIEND_REQUEST', 'FRIEND_ACCEPTED'].includes(String(value.type)) && userId(value.resource.friend_request_id)
}

export function notificationEvent(frame: unknown): NotificationEvent | null {
  if (!object(frame) || !count(frame.unread_count)) return null
  if (frame.event === 'notification.created' && isNotification(frame.notification)) {
    return { event: 'notification.created', notification: frame.notification, unread_count: frame.unread_count }
  }
  if (frame.event === 'notifications.read' && date(frame.read_at) &&
    (id(frame.notification_id) || id(frame.conversation_id) || frame.all === true)) {
    return {
      event: 'notifications.read', unread_count: frame.unread_count, read_at: frame.read_at,
      ...(id(frame.notification_id) ? { notification_id: frame.notification_id } : {}),
      ...(id(frame.conversation_id) ? { conversation_id: frame.conversation_id } : {}),
      ...(frame.all === true ? { all: true } : {}),
    }
  }
  return null
}

export function notificationText(item: Notification): string {
  const actor = item.actor?.username ? `@${item.actor.username}` : `User #${item.actor_id}`
  if (item.type === 'FRIEND_REQUEST') return `${actor} sent you a friend request.`
  if (item.type === 'FRIEND_ACCEPTED') return `${actor} accepted your friend request.`
  return `${actor} sent you ${item.resource.message_type === 'IMAGE' ? 'a photo' : item.resource.message_type === 'VIDEO' ? 'a video' : 'a message'}.`
}

export const notificationPath = (item: Notification) => item.type === 'NEW_MESSAGE'
  ? `/chat/${item.resource.conversation_id}` : item.type === 'FRIEND_REQUEST' ? '/friends/requests' : '/friends'
