# Usernames, public profiles and friendships

All records live in sportsService/PostgreSQL. Friendships reference immutable user IDs, so changing a username does not change friendships. Public endpoints are public to authenticated BasketCoach users and reuse the existing JWT dependency and avatar downloads.

## Changed files

- Backend: `sportsService/models.py`, `schemas.py`, `main.py`, `routers/users.py`, `routers/friends.py`, `social.py`.
- Migration: `sportsService/alembic/versions/c7a943e51b20_usernames_and_friendships.py`.
- Frontend: `frontend/src/types/auth.ts`, `services/api.ts`, `services/username.ts`, `contexts/AuthContext.tsx`, `components/UsernameEditor.tsx`, `components/DashboardLayout.tsx`, `pages/RegisterPage.tsx`, `pages/AccountPage.tsx`, `pages/PlayerProfilePage.tsx`, `App.css`.
- Tests: `sportsService/tests/test_social.py`, `sportsService/tests/test_social_postgresql.py`; `.gitignore` excludes temporary PostgreSQL files.
- Documentation: `docs/SOCIAL.md`.

## Apply the migration manually

The migration is `sportsService/alembic/versions/c7a943e51b20_usernames_and_friendships.py`, following `2d8e7c9a4b10`. It adds a nullable username, the `friend_request_status` enum, `friend_requests` and `friendships`. Existing users and their sporting data are preserved, and usernames remain NULL until chosen.

Stop sportsService, then run from the project root:

```powershell
cd sportsService
python -m alembic upgrade head
python -m uvicorn main:app --reload --port 8001
```

The application queries the new column, so apply the migration before using this version against your local database. It has not been applied automatically. The downgrade removes social data and usernames and should only be used when intentionally discarding those features.

## Endpoints and Swagger examples

Open `http://localhost:8001/docs`. Log in with `POST /users/login`, copy `access_token`, and paste only the token into **Authorize**. Every endpoint below except registration requires JWT. The Gateway keeps the same endpoints under `/api/sports`.

| Method | Path | Purpose |
| --- | --- | --- |
| POST | `/users/register` | Register with an optional username |
| PATCH | `/users/me/username` | Set or change your own username |
| GET | `/users/search?username=coach&limit=20&offset=0` | Partial username search and pagination |
| GET | `/users/{user_id}/public` | Public identity and relationship to the current user |
| POST | `/friends/requests` | Send a request |
| GET | `/friends/requests` | Received and sent requests, including their response history |
| POST | `/friends/requests/{request_id}/accept` | Recipient accepts a pending request |
| POST | `/friends/requests/{request_id}/reject` | Recipient rejects a pending request |
| GET | `/friends` | Current active friends |
| DELETE | `/friends/{user_id}` | Remove a friendship; HTTP 204 |

Registration example:

```json
{
  "name": "Real name",
  "username": "Coach_23",
  "email": "coach23@example.com",
  "password": "example-password",
  "role": "coach"
}
```

`username` is optional: omit it or send `null` to keep it unset. Non-empty values accept 3–24 ASCII letters, numbers and underscores. Values are trimmed and normalized to lowercase (`coach_23`). The database enforces lowercase, allowed characters and a unique constraint; mixed-case duplicate requests return 409. Existing users receive no generated aliases. Username changes preserve the existing email-based login.

To set or rename your own alias:

```json
{
  "username": "new_coach_23"
}
```

Searches return `{ "items": [...], "total": 0, "limit": 20, "offset": 0 }`; only active users with usernames appear. `_` is a literal underscore, not a wildcard. Public identities contain only `id`, `username`, `avatar_media_id` and `role`.

Public profiles additionally return `friendship_status` (`SELF`, `NONE`, `PENDING_SENT`, `PENDING_RECEIVED` or `FRIENDS`) and a pending `friend_request_id`, when applicable. They never return real names, email addresses, dates of birth, evaluations or other private sporting details. Legacy accounts can be viewed by ID and have `username: null`.

The existing model has no permission flag that declares sporting details public. Consequently `team`, `position` and `jersey_number` remain null in public profiles. Publishing them requires a future explicit visibility policy. Private coach/player endpoints retain their current data and permissions.

To send a friend request to the user with ID 2:

```json
{
  "user_id": 2
}
```

Save the `id` in the response. Authenticate as user 2 to accept or reject it; these POST endpoints take no body. GET `/friends/requests` returns separate `received` and `sent` arrays. GET `/friends` returns public identities with `friends_since`.

All roles may become friends, including accounts without usernames. Self-requests, duplicate pending requests and requests between existing friends return 409. Crossed requests return 409 with instructions to answer the existing incoming request; they do not auto-accept. Only the recipient can answer, and an answered request returns 409 if answered again. Missing/inactive target accounts return 404. Unauthorized answers return 403.

Rejected requests remain in history and a later request receives a new ID. Removing a friendship preserves users, profiles, sporting data and accepted request history. The friendship disappears for both users; a later new request is allowed.

## Concurrency and transactions

All friendship writes lock both user rows in ascending ID order before checking or changing the pair. This serializes duplicate and opposite-direction requests across workers. Responses re-lock and refresh the request after acquiring the pair locks, so concurrent accept/reject operations cannot overwrite one another. Request acceptance and friendship creation commit together.

A canonical ordered user pair, a partial unique index for pending requests and the friendship's composite primary key provide database-level protection as well. Concurrent username conflicts are caught through the unique constraint and return 409.

## Automated checks

The regular suite uses isolated SQLite databases:

```powershell
cd sportsService
python -m unittest discover -s tests -v
```

Real PostgreSQL concurrency and migration checks are opt-in. Supply an isolated local database named `basketcoach_*_test`, distinct from your application database:

```powershell
$env:BASKETCOACH_TEST_DATABASE_URL = 'postgresql+psycopg://test_user:test_password@127.0.0.1:55439/basketcoach_social_test'
python -m unittest tests.test_social_postgresql -v
```

These PostgreSQL tests recreate the selected test database's tables. They refuse remote hosts, non-test database names and the configured application database. During implementation they were run against a separate temporary PostgreSQL instance on port 55439; the application's PostgreSQL schema was not migrated.

The frontend includes optional registration input, a shared username editor and username display in account navigation. All roles also have a **Friends** section with `/friends`, `/friends/search` and `/friends/requests`; public profiles open in a central dialog. These pages reuse the Gateway and JWT client and allow sending, accepting, rejecting and removing connections. Chat remains outside this feature.
