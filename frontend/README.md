# BasketCoach Frontend

React, TypeScript and Vite. Navigation and role-specific pages use the role verified by `GET /users/me`.

## Development

Start PostgreSQL, `sportsService` (8001) and `apiGateway` (3000), then run:

```powershell
cd frontend
npm.cmd install
npm.cmd run dev
```

Open `http://localhost:5173`. Vite forwards `/api/*` to the Gateway at `http://localhost:3000`. AI generation also requires `aiTrainingService` (8002).

## Pages

- **Coach:** overview, teams and roster, private exercise catalogue, manual training, assignments and progress, AI proposal generation and acceptance.
- **Player:** overview, joining and leaving a team, player profile, assigned training and exercise progress. Cancelled assignments are read-only.
- **Fan:** overview and account details. Public match and standings data does not have an API yet.

All sports requests go through `/api/sports`.

## Friends and public profiles

All three roles have a **Friends** entry in the main menu:

- `/friends`: current friends, public profile access and removal with confirmation.
- `/friends/search`: paginated username search, avatars, roles and friendship actions. Search and page are kept in the URL.
- `/friends/requests`: received and sent requests. Pending requests are shown first; enable **Show answered requests** to see accepted/rejected history.

Select a user card to open the public profile in the central dialog. It shows only the identity and sporting fields returned by `GET /users/{id}/public`; accounts without usernames use a neutral user-ID label. The backend currently keeps sporting fields private, so the dialog displays an empty state when none are shared.

Coaches can also send friend requests from **My teams → team → player profile**. The profile reuses the friendship controls and shows existing friends and pending incoming/outgoing requests.

`FriendsContext` shares friend/request state between these pages, refreshes after actions/navigation, and listens to friendship notifications/reconnections on the shared socket. The **Refresh** button is also available. A 409 conflict reloads state, so crossed or already answered requests show the correct available action. API calls and protected avatar downloads reuse `AuthContext` and pass through the Gateway.

For manual verification, use two existing accounts in separate browser profiles, set their usernames, search for one from the other, send a request, then refresh the recipient's requests page. Accept/reject it and check the friends list, public profile state and removal flow. No account or database changes are performed by the build checks.

## Private chat

All roles have a **Messages** entry. Open `/chat` to browse conversations and `/chat/{conversationId}` to read a session. Use **New conversation** to select a current friend, or **Message** from the existing friendship controls (friends list, public profiles and team-player profiles). The backend creates or recovers the same private conversation.

The chat follows the dashboard's navy, orange and white styling. On narrow screens, the inbox and conversation are separate views with a back button. Avatars reuse authenticated sportsService media downloads. Only public identity fields are displayed. There are no public online-presence indicators or message read receipts.

Each conversation has a live unread-message badge (displayed as `99+` above 99). Counts include received text, image and video messages and are stored independently of bell-notification read status. Opening a visibly focused conversation clears its unread count across the user's tabs. Counts survive reloads; marking the bell read leaves unread chats unchanged. This is a private per-user read cursor, not a sender-facing delivery/read receipt.

All communication requests use `/api/communication` through the Gateway. The existing `AuthContext.request` accepts `service: 'communication'`, keeping JWT access and HTTP 401 handling centralized. The WebSocket uses the page's origin at `/api/communication/ws`; Vite forwards upgrades with `ws: true`. No backend URLs or secrets are placed in the frontend.

`RealtimeProvider` first obtains a short-lived ticket via authenticated HTTP, sends it in the first WebSocket frame and waits for `ready`. The single layout connection remains active outside Messages, shared with notifications; each reconnect obtains a new ticket. The JWT is never placed in the socket URL or exposed outside authentication. Chat requests/uploads/timers are cleaned up when leaving Messages, and the shared socket closes on logout. After changing `vite.config.ts`, restart the Vite development server.

Messages show **Sending**, **Uploading**, **Saved**, or **Not confirmed**. Saved means the server confirmed persistence; it does not mean the recipient has read the message. Failed sends have **Retry**, preserving the original client message ID, file and caption. Lost acknowledgements can also be reconciled with history. History is paginated using **Load earlier messages**; refreshing after an outage fetches intervening pages as necessary. Conversation search filters loaded conversations; use **Load more conversations** for older ones. Drafts, selected files and unconfirmed messages are kept only in memory while the Messages screen is mounted.

Send with Enter, insert a newline with Shift+Enter. Messages are limited to 4,000 characters. A friendship check controls the composer, while the server independently checks every send. If a friendship is removed, history remains readable and sending is blocked. **Refresh** rechecks the friendship; received backend permission errors also disable the composer. The frontend does not poll friendship changes or simulate server permissions.

Use the attachment button beside the composer to select a JPEG, PNG, WebP, MP4 or WebM. The UI loads limits from the authenticated `GET /media/config`, shows a local preview with a remove button, and uses the text box for an optional caption. Submit uploads a FormData request to `POST /conversations/{id}/messages/media`; file bytes never enter the WebSocket. HTTP confirmations and live `message.received` events are merged without duplicates. Empty/oversized/unsupported files are rejected before upload as a convenience, with authoritative content/permission checks on the server.

Images load inline when near the viewport. Videos have a **Load video** button and native playback controls. Downloads use `AuthContext.requestBlob(..., 'communication')` so the JWT remains encapsulated; the rendered sources are temporary Blob URLs, not public server URLs or JWT-bearing URLs. Videos are downloaded as authenticated blobs before playback (up to the configured limit), while the backend also supports direct authenticated Range requests. Local previews and downloaded Blob URLs are released on unmount; requests are cancelled when leaving the chat or logging out.

To test manually, run MongoDB, sportsService (8001), communicationService (3001), Gateway (3000) and Vite (5173). aiTrainingService is not required. Use a normal browser window and an incognito window, log in with two existing friends, create a conversation and exchange text, images and videos (with and without captions). Check the preview before sending, load/play the recipient's video, and reload to confirm persistence. Try an oversized file, interrupt the connection to check retry feedback, and remove the friendship to check that old media remains accessible while new sends are blocked. Sending messages in this manual flow intentionally writes your actual chat data.

Automated checks do not use real application databases:

```powershell
npm.cmd test
# Optional full browser flow; install apiGateway and communicationService dependencies first.
$env:BASKETCOACH_MONGOD_PATH = 'C:\Program Files\MongoDB\Server\9.0\bin\mongod.exe'
$env:BASKETCOACH_BROWSER_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm.cmd run test:browser
```

The browser check launches a temporary MongoDB and upload directory, a mocked sports HTTP service, real communication/Gateway routes, Vite and an isolated headless Chromium profile. It covers both users, live replies, failed-send retry, reload, offline recovery across multiple history pages, image previews/authenticated loading, a synthetic generated WebM in the native player, friendship removal, mobile layout and logout. It is explicitly skipped unless both binary paths are set. No frontend test dependencies were added; the existing Vite compiler and Node test runner are used.

## Notifications

All roles have a bell in the existing top bar. `NotificationsContext` reloads recent items and unread count on login/reconnection and synchronizes changes from `notification.created` / `notifications.read` on the shared socket. The menu supports pagination, individual read actions, mark-all and navigation to friendship requests/friends or the message conversation. Focus/visibility changes send validated conversation presence, suppressing unread activity for the visibly open conversation without changing message read state.

The browser check also verifies live bell updates, individual/all read actions, notification navigation, mobile menu bounds and preservation of the same socket while moving between chat and Friends. Backend setup now requires the additive sportsService outbox migration and the configured backend-only secret; see [notification deployment and manual checks](../docs/NOTIFICATIONS.md). No notification secret is present in the frontend.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run build
```

The JWT stays in `sessionStorage` until the tab is closed. “Remember me” saves only the email address in `localStorage`. The session is verified through `GET /users/me` on reload. The storage strategy should be reviewed before production.
