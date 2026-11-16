# BasketCoach notifications

Notifications reuse the existing authenticated WebSocket. PostgreSQL remains the source of truth for users and friendships; MongoDB stores notification history, never a duplicate friendship graph.

## Configuration and deployment

The actual `.env` files contain a newly generated `NOTIFICATIONS_INTERNAL_SECRET`, shared only by sportsService and communicationService. It differs from `AI_INTERNAL_SECRET`. Keep it private; no frontend environment variable is needed.

| File | Variable | Purpose |
| --- | --- | --- |
| `sportsService/.env` | `COMMUNICATION_SERVICE_URL=http://127.0.0.1:3001` | Direct internal service URL, bypassing the Gateway. |
| Both backend `.env` files | `NOTIFICATIONS_INTERNAL_SECRET` | Identical secret of at least 32 characters for internal event delivery. |

Apply the included additive migration before starting the updated sportsService:

```powershell
cd sportsService
python -m alembic upgrade head
python -m uvicorn main:app --reload --port 8001
```

Revision `d4b29c7e8301` creates **only** `notification_outbox` and its due-delivery index. It does not backfill events or change existing users, requests, friendships, training data or messages. The migration was checked on isolated test storage; it has not been applied automatically to the user's PostgreSQL database.

Restart communicationService and apiGateway (`npm.cmd start` in each service), and restart/reload the frontend (`npm.cmd run dev`). MongoDB must be running. Keep the existing ports: 8001, 3001, 3000 and 5173. aiTrainingService is not involved.

## REST endpoints

All public routes below use `/api/communication` through the Gateway and require the authenticated user's JWT:

| Method and path | Response |
| --- | --- |
| `GET /notifications?limit=20&offset=0` | `{ items, has_more, limit, offset }`, newest first with ID tie-breaker. Limit 1–100, offset 0–10000. |
| `GET /notifications/unread-count` | `{ unread_count }` |
| `PATCH /notifications/{id}/read` | `{ notification, unread_count }` |
| `PATCH /notifications/read-all` | `{ unread_count, read_at }` |

No recipient/user ID is accepted for these operations. A foreign or missing notification returns 404 when marking it read. Dates are UTC ISO strings; all responses are non-cacheable. Public actor metadata is looked up through sportsService using the recipient's verified JWT; missing/unavailable actors use `actor: null`, never private user details.

Each item contains `id`, `event_id`, `recipient_id`, `actor_id`, `actor`, `type`, `resource`, `created_at`, `is_read` and `read_at`. `resource` contains `friend_request_id` for friendship activity, or `conversation_id`, `message_id`, `message_type` for chat activity. Captions, message bodies, media bytes, passwords, emails and tokens are not copied into notifications.

The internal endpoint is **direct only**: `POST http://127.0.0.1:3001/internal/notifications`, with `X-Notification-Secret`. It accepts exactly:

```json
{
  "event_id": "friend-request:123:FRIEND_REQUEST",
  "type": "FRIEND_REQUEST",
  "actor_id": 1,
  "recipient_id": 2,
  "friend_request_id": 123,
  "occurred_at": "2026-11-16T12:00:00Z"
}
```

Only FRIEND_REQUEST and FRIEND_ACCEPTED events are accepted internally. Event IDs must match the request ID and type, actor/recipient must differ, unexpected fields are rejected, and a conflicting reuse of an event ID returns 409. Identical retries return 200 instead of 201 without resetting read state. The secret is compared in constant time. The Gateway blocks `/api/communication/internal*` (including encoded paths) and strips the secret header from proxied requests. The frontend cannot post arbitrary notifications using a JWT.

## WebSocket protocol

Authentication and ticket flow are unchanged. One socket remains mounted for the authenticated layout, shared by chat and notifications across navigation. Multiple tabs can each connect using their own one-use ticket.

Server events:

- `notification.created`: `{ notification, unread_count }`, sent only to the recipient's connected tabs.
- `notifications.read`: `{ notification_id?, conversation_id?, all?, read_at, unread_count }`, synchronizes the recipient's tabs after read changes.
- `conversation.viewed`: `{ conversation_id }`, acknowledges validated conversation presence.
- `conversation.unread`: `{ conversation_id, unread_count }`, synchronizes the recipient's independent unread-chat badge across tabs.

Client presence:

```json
{ "event": "conversation.view", "conversation_id": "507f1f77bcf86cd799439011" }
```

Send `conversation_id: null` when leaving/losing focus. The frontend handles routing, focus, blur and document visibility automatically. The server checks ownership of the selected conversation and never accepts a user ID from this frame. Existing TEXT sends, media uploads and message events keep their original protocol.

If any authenticated, unexpired recipient tab is viewing the conversation, new message notifications are stored as read. Opening a conversation marks its existing message notifications read across tabs. A per-participant **notification** view checkpoint in the conversation protects against late retries that arrive after the user has already viewed the activity. This checkpoint and notification read timestamps are not message delivery/read receipts; message documents have no new read-status field. Presence is best effort when a network connection disappears unexpectedly.

Unread-chat badges use a separate private `messageReadCursor` per participant (message timestamp plus ID, for stable equal-timestamp ordering). `GET /conversations` and conversation creation/recovery include `unread_count`. Counts derive from actual received messages, not notification rows, and cannot be cleared by marking the bell read. A visible conversation advances the cursor and broadcasts exact counters. Existing view checkpoints provide a compatibility baseline until the first new cursor is saved. No PostgreSQL or MongoDB schema migration or message deletion is needed, and no double-check/read receipt is sent to the other participant.

## Persistence and retries

MongoDB `notifications` has a unique `eventId` index, a recipient/date/ID history index and an unread lookup index. Notification writes/count publication are serialized per recipient within the local instance. Existing notification read state is retained on duplicate event delivery.

Friendship changes enqueue an outbox row in the **same PostgreSQL transaction** as the request/acceptance. HTTP is sent only after commit, in a background task, and by a lifespan worker every five seconds. Failures increment `attempts`, log the event ID/error class, and schedule backoff (5 seconds up to 5 minutes). PostgreSQL row locks with SKIP LOCKED coordinate concurrent dispatchers. Delivered rows remain for auditing; no automatic purge is introduced.

If communicationService is offline or its secret is misconfigured, committed friendships remain valid. Fix configuration/start the service and leave sportsService running: due events retry automatically, including after process restarts. Do not generate new event IDs to retry. Pending rows can be inspected using:

```sql
SELECT event_id, attempts, next_attempt_at
FROM notification_outbox
WHERE delivered_at IS NULL
ORDER BY next_attempt_at;
```

Chat messages atomically carry `notificationPending: true` on new inserts. After the notification is persisted, the flag is cleared. If notification creation fails, the message stays saved/acknowledged, and communicationService retries the flag every five seconds and at startup. TEXT, IMAGE and VIDEO follow the same path. Older messages without the flag are never backfilled by reading history or retrying the worker. The pending flag is not exposed in API responses.

If an acknowledgement/status update fails after delivery, the same deterministic event ID is retried and MongoDB deduplicates it. No cross-service distributed transaction is claimed. One communicationService instance owns the live socket registry and recipient queues; multi-instance deployment requires shared presence and pub/sub. Notification history and unread counts survive disconnects and are reloaded on login/reconnection.

## Frontend and manual checks

The existing top bar has a bell for all roles, with unread count, recent items, pagination, individual read actions and **Mark all as read**. Selecting a friend request opens `/friends/requests`; an acceptance opens `/friends`; a message opens its conversation. The existing design and sports navigation are retained. There are no sounds or browser push notifications.

Use two existing users in normal/incognito browser sessions:

1. A sends B a friend request. B sees a live bell update; selecting it opens received requests.
2. B accepts. A sees FRIEND_ACCEPTED. Read one item or mark all; check another tab of the same user updates.
3. With A outside the Messages screen, B sends text, an image or a video. A sees NEW_MESSAGE and can open that conversation from the bell.
4. Keep the recipient's same conversation visibly focused: incoming chat still appears, while unread notifications do not accumulate.
5. Disconnect the recipient, send activity, then sign in/reconnect to recover stored notifications.
6. Stop communicationService temporarily and send/accept a friendship request. Restart it and wait for the scheduled retry; the friendship must remain confirmed and its notification must appear once.

These manual actions intentionally change real friendship/chat data. Automated checks instead use temporary MongoDB/upload directories, in-memory SQLite and mocked HTTP, plus optional isolated Chromium profiles:

```powershell
cd sportsService
python -m unittest tests.test_notifications tests.test_social
# In communicationService:
$env:BASKETCOACH_MONGOD_PATH = 'C:\Program Files\MongoDB\Server\9.0\bin\mongod.exe'
npm.cmd test
# In frontend:
npm.cmd run build
npm.cmd test
$env:BASKETCOACH_BROWSER_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm.cmd run test:browser
```

No automated check applies the migration to the real PostgreSQL database or inserts real-user notifications.
