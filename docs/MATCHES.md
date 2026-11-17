# Matches and calendar

The existing `Match`, `Team`, `Season` and `SeasonTeam` models are reused. No schema migration, new dependency or environment variable is required. Existing match-related records are never deleted.

## Files added or modified

- `sportsService/routers/matches.py`: routes, authorization, season checks and atomic state transitions.
- `sportsService/schemas.py`: match request/response schemas and safe selector options.
- `sportsService/main.py`: router registration.
- `sportsService/tests/test_matches.py`: isolated API, rollback, preservation and concurrency tests.
- `frontend/src/pages/MatchesPage.tsx`: shared calendar, agenda, filters and coach action dialogs.
- `frontend/src/pages/matches.css`: responsive styles matching the existing theme.
- `frontend/src/types/matches.ts`: typed API requests and responses.
- `frontend/src/services/matches.ts`: month boundaries, day grids, labels and query construction.
- `frontend/src/App.tsx`: authenticated `/matches` route.
- `frontend/src/components/DashboardLayout.tsx`: navigation for all three roles.
- `frontend/src/pages/FanDashboard.tsx`: calendar entry point and updated welcome text.
- `frontend/src/services/api.ts`: readable match API errors.
- `frontend/tests/matches.test.mjs`: isolated calendar/query tests.
- `frontend/package.json`: include calendar tests in the existing test command.
- `docs/MATCHES.md`: implementation, limitations and manual examples.

## Authorization and state policy

All routes require the existing JWT and an active account. All authenticated roles may read fixtures and scores. The frontend scopes coaches to a selected team they coach, players to their current team, and fans to any team or all teams. Calendar read access itself is shared by all authenticated roles, rather than being a privacy boundary between teams.

`Match` has no creator/organizer field. For this prototype **either participating team's current coach** may create, reschedule, record a result or cancel the fixture. Opponents do not need to approve the action. Public responses expose `can_manage` and basic team information, never invitation codes, emails or player evaluations.

Only `SCHEDULED` matches can be changed. Recording a nonnegative integer score sets `FINISHED`; cancelling sets `CANCELLED`. Both states are terminal, including repeat result/cancel calls (409). Result corrections, undoing cancellation and coach approval/version history require a future policy and are not implemented. Equal scores are accepted because this initial feature does not model overtime or competition-specific rules.

Home and away teams are fixed after creation. PATCH permits only `match_date`, `location` and `season_id`; `season_id: null` removes the optional season. Location is optional, up to 150 characters, matching the existing nullable column. Datetimes must include an offset and are stored in UTC; the calendar displays the browser's local time. When a season is supplied, both teams must have `SeasonTeam` entries, its dates must be valid, and the UTC date of the fixture must fall within its inclusive start/end dates. No season or enrollment management is added.

## Endpoints

The gateway forwards these under `/api/sports`, with no gateway changes:

| Method | Path | Behavior |
| --- | --- | --- |
| POST | `/matches` | Create a scheduled match (201). |
| GET | `/matches` | Filtered page of fixtures: `items`, `total`, `limit`, `offset`. |
| GET | `/matches/options` | Basic teams and existing seasons with participating team IDs for selectors. |
| GET | `/matches/{match_id}` | Full fixture, teams, optional season, scores, status and permission. |
| PATCH | `/matches/{match_id}` | Reschedule/change venue or optional season. |
| PATCH | `/matches/{match_id}/result` | Save scores and finish. |
| PATCH | `/matches/{match_id}/cancel` | Cancel; no request body required. |

List filters: optional `team_id`, `season_id`, `status` (`SCHEDULED`, `FINISHED`, `CANCELLED`), aware `date_from` (inclusive), aware `date_to` (exclusive). Sort: date, then ID. Default limit 100, maximum 200, offset 0. Missing explicit teams/seasons return 404; malformed filters 422. The frontend loads all pages for its selected month so days do not silently omit fixtures beyond the first page.

Unauthenticated: 401. Unauthorized writes: 403. Missing resources: 404. Terminal states/write conflicts: 409. Invalid fields, teams playing themselves or season enrollment/date mismatch: 422.

## Transactions and concurrency

Each write uses the request's SQLAlchemy transaction. Mutations obtain `SELECT ... FOR UPDATE OF matches`, validate authorization and current state after acquiring the lock, then update and commit once. A conditional `UPDATE ... WHERE status = 'SCHEDULED'` adds protection against a stale terminal transition. Competing result/cancellation requests have one winner; the other receives 409. Concurrent scheduled edits serialize on PostgreSQL; the later edit wins for overlapping fields. No optimistic client version/ETag is available in the current model.

Creation locks both teams in ID order; season validation locks the season and relevant enrollment rows. Exceptions before commit roll back on session close; integrity errors roll back explicitly. Neither statistics, availabilities, lineups, friendships, messages nor notifications are changed.

## Frontend

Open **Matches & calendar** in any role's sidebar, route `/matches`. Coaches choose one of their teams and can create matches and manage scheduled fixtures through centered dialogs. Players without a team receive a link to join one. Fans choose any team or all teams. All roles have month navigation, Today, Refresh, team/season/status filters, month calendar, agenda and detailed score/venue/status dialogs. The fan dashboard also links to the calendar.

The page uses `AuthContext.request`, which supplies the JWT and routes HTTP through `/api/sports`. There are no direct backend URLs or credentials in this feature.

## Swagger examples

Open `http://localhost:8001/docs`, log in through `/users/login` and use **Authorize** with the returned token. Replace IDs below with real teams and, if needed, a real season. A coach must own at least one of the two teams.

POST `/matches` (friendly):

```json
{
  "home_team_id": 1,
  "away_team_id": 2,
  "match_date": "2026-12-05T18:30:00+01:00",
  "location": "Deusto Sports Hall",
  "season_id": null
}
```

PATCH `/matches/{match_id}`:

```json
{
  "match_date": "2026-12-06T12:00:00+01:00",
  "location": "Court 2"
}
```

PATCH `/matches/{match_id}/result`:

```json
{
  "home_score": 82,
  "away_score": 76
}
```

GET `/matches?team_id=1&status=SCHEDULED` filters fixtures. PATCH `/matches/{match_id}/cancel` takes no body. To try both finalization and cancellation, create two separate scheduled matches.

## Isolated automated checks

```powershell
cd sportsService
python -m unittest tests.test_matches -v
```

Uses UUID-named temporary SQLite files in the test directory, foreign keys enabled, and a small FastAPI test app with `get_db` overridden. Does not connect to local PostgreSQL or run the notification worker. Tests cover JWT/role permissions, both coaches, public reads, invalid inputs, season membership/date rules, pagination, terminal states, rollback, router registration and simultaneous result/cancel requests. PostgreSQL lock SQL is checked by compilation; real PostgreSQL locking behavior is not exercised by SQLite.

```powershell
cd frontend
npm.cmd run build
npm.cmd test
```

Calendar unit tests check Monday-based month grids, leap years, local-time/DST boundaries and filtered API queries. The existing chat unit tests remain included. Functional acceptance can be done manually with a coach, a player and a fan; no real test fixtures are inserted automatically.
