# BasketCoach communicationService

Fastify 5 service on port 3001, using MongoDB and `@fastify/websocket` 11. Node.js 20.19 or newer is required; checked with Node.js 24.13.1. sportsService remains the authority for users and friendships; no user collection is created here.

## Configuration and startup

Install dependencies with `npm install`. Keep the service configuration in `communicationService/.env`:

```dotenv
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=basketcoach_communication
SPORTS_SERVICE_URL=http://127.0.0.1:8001
MEDIA_ROOT=./uploads
MAX_IMAGE_SIZE_MB=10
MAX_VIDEO_SIZE_MB=50
```

`MONGODB_URI` specifies the MongoDB server. `MONGODB_DB_NAME` selects the existing database. `SPORTS_SERVICE_URL` is used for `GET /users/me` and `GET /users/{id}/public` (including `friendship_status`). `CORS_ORIGINS` optionally overrides the allowed HTTP and WebSocket origins; defaults to `http://localhost:5173,http://127.0.0.1:5173`. Configuration stays in `.env`; there are no new secrets or example env files. The file is loaded relative to this service.

Start the MongoDB Windows service, then run:

```powershell
cd communicationService
npm start
```

If PowerShell blocks `npm.ps1`, use `npm.cmd start` (and `npm.cmd test` for tests) without changing Windows execution policies.

Startup connects to MongoDB, initializes the `conversations` and `messages` collections and their indexes, and performs `ping` before opening the listener. It does not insert sample data or recreate the database. Existing records are preserved; conflicting existing records/indexes cause startup to fail rather than being deleted. Stop with Ctrl+C to close sockets and MongoDB connections.

## Manual checks

Start the Gateway with `npm start` from `apiGateway`. Start sportsService on port 8001 when testing authenticated requests.

| Endpoint | Direct URL | Gateway URL |
| --- | --- | --- |
| Probe | `http://localhost:3001/prueba` | `http://localhost:3000/api/communication/prueba` |
| Health | `http://localhost:3001/health` | `http://localhost:3000/api/communication/health` |
| Current user | `http://localhost:3001/me` | `http://localhost:3000/api/communication/me` |

The existing `/pruebas` endpoint remains available as an alias. Probe and health are public. Health performs a MongoDB ping on each request and returns 503 if MongoDB is unavailable.

```powershell
Invoke-RestMethod http://localhost:3000/api/communication/prueba
Invoke-RestMethod http://localhost:3000/api/communication/health
```

Use an existing sportsService account to obtain a JWT, then call `/me`:

```powershell
$loginBody = @{ email = 'your-email@example.com'; password = 'your-password' } | ConvertTo-Json
$session = Invoke-RestMethod -Method Post -Uri http://localhost:3000/api/sports/users/login -ContentType 'application/json' -Body $loginBody
$headers = @{ Authorization = "Bearer $($session.access_token)" }
Invoke-RestMethod -Uri http://localhost:3000/api/communication/me -Headers $headers
```

The response contains only `id`, `name` and `role`. Every protected HTTP request forwards its Bearer token to sportsService and checks the active user. Routes reuse `preHandler: fastify.authenticate` and `request.user`; client-supplied sender IDs are never trusted.

Missing or rejected tokens return 401; denied/inactive accounts return 403. An unreachable authentication service returns 503, a timeout returns 504, and an unexpected or invalid upstream response returns 502. Authentication has a five-second timeout and does not follow redirects.

## Conversations and history

All REST paths below are relative to `http://localhost:3000/api/communication` and require `Authorization: Bearer <JWT>`.

| Method and path | Request / response |
| --- | --- |
| `POST /conversations` | `{ "user_id": 2 }` returns a conversation; 201 for creation, 200 when it already exists. Both users must currently be friends. |
| `GET /conversations?limit=20&offset=0` | `{ "items": [...], "limit": 20, "offset": 0 }`, ordered by latest activity. Each item includes `participant_ids`, `other_participant` and `last_message`. |
| `GET /conversations/{id}/messages?limit=50` | `{ "items": [...], "next_cursor": "..." }`. The latest page is returned in chronological order. Pass `before=<next_cursor>` for older messages. |
| `POST /ws/tickets` | `{ "ticket": "...", "expires_at": "...", "ws_path": "/ws" }`. No body needed. |

Limits are 1–100 records; conversation offsets are capped at 10,000. Message cursors use both timestamp and ID to avoid losing messages with identical timestamps. A conversation always has two participants. Other participants' metadata contains only `id`, `username`, `role`, `avatar_media_id`; unavailable metadata is `null` while history remains accessible. Avatar IDs refer to sportsService media.

Missing or invalid conversations return 404/400; non-participants receive 403. Unfriending prevents conversation creation/recovery through POST and future sends, but GET endpoints continue to expose participants' existing history. Becoming friends again recovers the same conversation. Unavailable sportsService blocks new messages rather than bypassing friendship checks.

## WebSocket protocol

Connect to `ws://localhost:3000/api/communication/ws` (direct: `ws://localhost:3001/ws`). The Gateway removes `/api/communication` and forwards WebSocket upgrades and the browser's Origin. No AI service route is exposed.

1. Obtain a ticket using the JWT-protected HTTP endpoint.
2. Open the WebSocket without query parameters or credentials in its URL.
3. Within five seconds, send `{ "event": "authenticate", "ticket": "..." }`.
4. Wait for `{ "event": "ready", "user_id": 1, "expires_at": "..." }`.

Tickets expire after at most 30 seconds, are single-use, held only in memory with hashed keys, and are never logged. Redeeming one revalidates the JWT with sportsService. Connections expire after 15 minutes or JWT expiry, whichever is earlier; obtain a fresh ticket and reconnect then. Only the expiry claim is read locally, after remote JWT verification; identity always comes from sportsService. Tokens are not put in URLs or MongoDB. Authentication failures close the connection with code 1008.

Send a text message:

```json
{
  "event": "message.send",
  "conversation_id": "507f1f77bcf86cd799439011",
  "client_message_id": "4b0dc818-8ae1-4da4-8086-48adf74db776",
  "type": "TEXT",
  "text": "Ready for practice?"
}
```

`client_message_id` must contain 8–64 letters, numbers, underscores or hyphens; generate a new UUID for each new message. Text is trimmed and must contain 1–4000 characters. Binary frames, IMAGE/VIDEO sends and extra fields such as `sender_id` are rejected. Frames are capped at 16 KiB.

| Server event | Meaning |
| --- | --- |
| `ready` | Connection authenticated, with user and session expiry. |
| `message.ack` | Saved in MongoDB. Contains `client_message_id`, `duplicate` and `message`. Sent to the originating connection. |
| `message.received` | Contains `message`. Broadcast to the other connected tabs of both participants. |
| `error` | Contains `status`, `code`, `message` and `client_message_id` when valid/available (otherwise null). |

A message contains `id`, `conversation_id`, `sender_id`, `client_message_id`, `type`, `text`, `media`, `created_at` (UTC ISO date). TEXT messages have `media: null`. IMAGE/VIDEO messages have nullable caption `text` and `media: { content_type, size_bytes }`; storage keys, filesystem paths and hashes are never exposed. The sender identity comes from authentication. There are heartbeat, connection, pending-ticket, queue and outgoing-buffer limits.

After a lost acknowledgement, resend the same ID and text. The unique index returns the original message with `duplicate: true`, without rebroadcasting it. Reusing an ID with different content gives 409 `IDEMPOTENCY_CONFLICT`. After removing friendship, sending returns 403 `NOT_FRIENDS`. A storage failure produces an error, never a success acknowledgement; retry using the same ID.

## Manual conversation between two users

Start MongoDB, sportsService (8001), communicationService (3001) and the Gateway (3000). aiTrainingService is not needed. The browser-console example below uses the existing frontend on port 5173; alternatively, a standalone WebSocket client can test the protocol without a frontend. Use two existing accounts that are already friends, and obtain their JWTs using the existing login endpoint. No test accounts are created automatically.

From a browser page on `http://localhost:5173` (or another configured allowed origin), use the developer console. Open a second tab for user B. The following helper works in both tabs:

```javascript
const api = 'http://localhost:3000/api/communication';
const token = prompt('Paste this user’s JWT'); // No "Bearer " prefix here.
async function request(path, method = 'GET', body) {
  const response = await fetch(api + path, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {})
  });
  const result = await response.json();
  if (!response.ok) throw new Error(JSON.stringify(result));
  return result;
}
async function connectChat() {
  const { ticket } = await request('/ws/tickets', 'POST');
  const ws = new WebSocket('ws://localhost:3000/api/communication/ws');
  ws.onmessage = event => console.log(JSON.parse(event.data));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
  ws.send(JSON.stringify({ event: 'authenticate', ticket }));
  return ws;
}
const ws = await connectChat();
```

In user A's tab, use user B's actual sportsService numeric ID:

```javascript
const conversation = await request('/conversations', 'POST', { user_id: 2 });
// After the "ready" event:
const message = {
  event: 'message.send', conversation_id: conversation.id,
  client_message_id: crypto.randomUUID(), type: 'TEXT', text: 'Ready for practice?'
};
ws.send(JSON.stringify(message));
```

A should receive `message.ack`, B should receive `message.received`. Send the same `message` again to see `duplicate: true`. In B's tab, run `await request('/conversations')` to obtain the conversation ID and reply using a new UUID. Check history with:

```javascript
await request('/conversations');
await request(`/conversations/${conversation.id}/messages?limit=2`); // A's tab
ws.close();
```

Try a non-friend, a third user's token, and unfriending through the existing friendship UI: new sends must fail while earlier messages remain in history. Native Swagger does not open WebSockets; use the console or a WebSocket client for real-time events. Use `wss://` and HTTPS when deploying outside local development.

## Images and videos

Files are uploaded over HTTP, never inside a WebSocket frame. The HTTP request creates the message and returns the same `message.ack` shape as text delivery. After MongoDB acknowledges persistence, `message.received` is published to every connected tab of both participants, including the uploading user. Existing TEXT socket sends are unchanged; IMAGE/VIDEO socket sends are rejected.

| Method and path (relative to `/api/communication`) | Purpose |
| --- | --- |
| `GET /media/config` | Authenticated list of image/video MIME types and size limits in bytes. |
| `POST /conversations/{id}/messages/media` | JWT-protected multipart upload: required `file`, required `client_message_id`, optional `text` caption (maximum 4,000 characters). One file per request. Returns 201, or 200 for an identical retry. |
| `GET /messages/{id}/media` | JWT-protected download for a conversation participant. Supports single byte ranges (206) and returns 416 with `Content-Range: bytes */size` for unavailable/unsupported ranges. |
| `HEAD /messages/{id}/media` | Same authorization and headers, with no response body. |

`MEDIA_ROOT` is resolved relative to communicationService unless absolute. It defaults to `communicationService/uploads`, which is excluded from Git and is never served as a public/static directory. Configure `MAX_IMAGE_SIZE_MB` (10 by default) and `MAX_VIDEO_SIZE_MB` (50 by default) in `.env`; each unit is 1,048,576 bytes, and positive integers up to 1024 are accepted. Limits apply while streaming and again according to the detected content type. JPEG, PNG, WebP, MP4 and WebM are the only allowed types. Binary format detection uses `file-type`; supplied filenames/extensions never determine the stored type or path. This is format inspection, not a full media decoding/transcoding pipeline; playback still depends on browser codec support.

Files receive random 128-bit internal keys. MongoDB stores the key, detected content type, byte count and SHA-256 in the existing message document; no file bytes or additional user records are stored. Captions, bytes and type must match when reusing a `client_message_id`; different content returns 409. Parallel identical retries keep exactly one MongoDB message and one final file.

The service verifies membership and friendship before consuming the upload, then revalidates the JWT/account and friendship before inserting. Downloads require membership and current JWT validation, but not an ongoing friendship, so historical media survives unfriending. Downloads use `private, no-store`, `nosniff` and a fixed safe inline filename. IDs are validated; filesystem paths and user filenames are not accepted by the download endpoint.

Each new upload has a small durable marker and a partial file under `uploads/.pending`. Validation failures, disconnects, duplicate copies and failed inserts clean up only the files created by that request. If an insert has an uncertain outcome and MongoDB is unavailable, the service retains the new file and marker rather than deleting a potentially committed attachment. On the next startup, markers are checked against MongoDB: committed files are retained and unfinished new uploads are removed. Existing messages and unrelated files are never purged. This recovery procedure, like in-memory WebSocket routing, assumes a single service instance owns the media directory. Back up the directory together with MongoDB.

Manual HTTP example from the frontend browser console, using the `request` helper and `conversation` from above:

```javascript
const chooser = document.createElement('input');
chooser.type = 'file';
chooser.accept = 'image/jpeg,image/png,image/webp,video/mp4,video/webm';
chooser.onchange = async () => {
  const form = new FormData();
  form.append('client_message_id', crypto.randomUUID());
  form.append('text', 'Optional practice comment');
  form.append('file', chooser.files[0]);
  const response = await fetch(`${api}/conversations/${conversation.id}/messages/media`, {
    method: 'POST', headers: { Authorization: `Bearer ${token}` }, body: form
  });
  console.log(response.status, await response.json());
};
chooser.click();
```

Do not set multipart Content-Type yourself: the browser supplies the boundary. The receiving user's socket gets `message.received` with metadata only. For Range checks, request the protected download with `Authorization: Bearer <JWT>` and `Range: bytes=0-1023` in Postman. A public browser URL without Authorization is intentionally rejected.

## Storage and deployment limits

- `conversations`: `_id`, canonical `pairKey` (`lowId:highId`), exactly two `participantIds`, `createdAt`. Unique `uq_private_pair` and participant lookup index prevent duplicate conversations under concurrent creation.
- `messages`: `_id`, `conversationId`, `senderId`, `clientMessageId`, `type`, `text`, `media`, `createdAt`. Unique `(conversationId, senderId, clientMessageId)` prevents retry duplicates; `(conversationId, createdAt, _id)` supports history and last-message lookup.
- The existing MongoDB validator already supports `TEXT`, `IMAGE`, `VIDEO` and media metadata; existing documents and indexes need no migration.
- Conversation summaries derive their last message from persisted messages, so no replica-set transaction is required on local standalone MongoDB. Each message is inserted atomically before acknowledgement. Conversation creation is an atomic upsert with a unique-index conflict fallback.
- Friendships live in PostgreSQL and messages in MongoDB: a friendship deletion concurrent with an already authorized, in-flight send cannot be atomic across both services. Later sends always recheck friendship. There is no friendship cache.
- Tickets and connected sockets belong to one process. Multiple instances require shared single-use ticket storage and a pub/sub channel for broadcasts (plus appropriate routing); process restarts invalidate tickets and disconnect sockets but preserve MongoDB history.
- Real-time broadcasts are best effort, not delivery/read receipts. Offline recipients and interrupted connections recover through history. There is no automatic retry or notification system. Conversation sorting currently aggregates the user's conversations; revisit pagination/index strategy at larger scale.

## Automated checks

```powershell
npm test
```

Authentication/ticket tests use mocks. Full integration tests are explicitly opt-in and launch their own `mongod` with a fresh temporary data directory, random non-27017 port and an isolated database; they ignore `.env`/`MONGODB_URI`. sportsService is a local mock HTTP server, so PostgreSQL is never contacted. Both communicationService and the real Gateway route plugin listen on temporary ports. Temporary data is removed and only the test MongoDB process is shut down afterwards.

```powershell
cd communicationService
$env:BASKETCOACH_MONGOD_PATH = 'C:\Program Files\MongoDB\Server\9.0\bin\mongod.exe'
npm test
```

Adjust the binary path to the installed version and install `apiGateway` dependencies before running the integration suite. Without this variable, those suites are visibly skipped; mock/range checks still run. Media checks use a separate temporary upload directory under the temporary MongoDB data directory. Coverage includes all supported formats, multipart forwarding, authenticated downloads/HEAD/Range, content spoofing, both size limits, concurrent retries, aborted uploads, insert rollback, uncertain-commit recovery, and media history after unfriending. Gateway's existing sports multipart/JWT regression check can also be run from `apiGateway` with `node --test tests/media-proxy.test.js`.
