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

`FriendsContext` shares friend/request state between these pages and refreshes after actions and when navigating between them. The **Refresh** button retrieves external changes without real-time connections. A 409 conflict also reloads state, so crossed or already answered requests show the correct available action. API calls and protected avatar downloads reuse `AuthContext` and pass through the Gateway.

For manual verification, use two existing accounts in separate browser profiles, set their usernames, search for one from the other, send a request, then refresh the recipient's requests page. Accept/reject it and check the friends list, public profile state and removal flow. No account or database changes are performed by the build checks.

## Private chat

All roles have a **Messages** entry. Open `/chat` to browse conversations and `/chat/{conversationId}` to read a session. Use **New conversation** to select a current friend, or **Message** from the existing friendship controls (friends list, public profiles and team-player profiles). The backend creates or recovers the same private conversation.

The chat follows the dashboard's navy, orange and white styling. On narrow screens, the inbox and conversation are separate views with a back button. Avatars reuse authenticated sportsService media downloads. Only public identity fields are displayed. There are no online-presence indicators, read receipts, attachments or notifications.

All communication requests use `/api/communication` through the Gateway. The existing `AuthContext.request` accepts `service: 'communication'`, keeping JWT access and HTTP 401 handling centralized. The WebSocket uses the page's origin at `/api/communication/ws`; Vite forwards upgrades with `ws: true`. No backend URLs or secrets are placed in the frontend.

The frontend first obtains a short-lived ticket via authenticated HTTP, sends it in the first WebSocket frame and waits for `ready`. Each reconnect obtains a new ticket. The JWT is never placed in the socket URL or exposed outside the existing authentication context. Sockets, requests and timers are cleaned up when leaving Messages or logging out. After changing `vite.config.ts`, restart the Vite development server.

Messages show **Sending**, **Saved**, or **Not confirmed**. Saved means the server confirmed persistence; it does not mean the recipient has read the message. Failed sends have **Retry**, which preserves the original client message ID. Lost acknowledgements can also be reconciled with history. History is paginated using **Load earlier messages**; refreshing after an outage fetches intervening pages as necessary. Conversation search filters loaded conversations; use **Load more conversations** for older ones. Drafts and unconfirmed messages are kept only in memory while the Messages screen is mounted.

Send with Enter, insert a newline with Shift+Enter. Messages are limited to 4,000 characters. A friendship check controls the composer, while the server independently checks every send. If a friendship is removed, history remains readable and sending is blocked. **Refresh** rechecks the friendship; received backend permission errors also disable the composer. The frontend does not poll friendship changes or simulate server permissions.

To test manually, run MongoDB, sportsService (8001), communicationService (3001), Gateway (3000) and Vite (5173). aiTrainingService is not required. Use a normal browser window and an incognito window, log in with two existing friends, create a conversation and exchange messages. Reload to check saved history, interrupt the connection to check reconnection and retry feedback, and remove the friendship to check that history survives. Sending messages in this manual flow intentionally writes your actual chat data.

Automated checks do not use real application databases:

```powershell
npm.cmd test
# Optional full browser flow; install apiGateway and communicationService dependencies first.
$env:BASKETCOACH_MONGOD_PATH = 'C:\Program Files\MongoDB\Server\9.0\bin\mongod.exe'
$env:BASKETCOACH_BROWSER_PATH = 'C:\Program Files\Google\Chrome\Application\chrome.exe'
npm.cmd run test:browser
```

The browser check launches a temporary MongoDB on a random port, a mocked sports HTTP service, real communication/Gateway routes, Vite and an isolated headless Chromium profile. It covers both users, live replies, failed-send retry, reload, offline recovery across multiple history pages, friendship removal, mobile layout and logout. It is explicitly skipped unless both binary paths are set. No frontend test dependencies were added; the existing Vite compiler and Node test runner are used.

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run build
```

The JWT stays in `sessionStorage` until the tab is closed. “Remember me” saves only the email address in `localStorage`. The session is verified through `GET /users/me` on reload. The storage strategy should be reviewed before production.
