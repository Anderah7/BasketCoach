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

## Checks

```powershell
npm.cmd run typecheck
npm.cmd run build
```

The JWT stays in `sessionStorage` until the tab is closed. “Remember me” saves only the email address in `localStorage`. The session is verified through `GET /users/me` on reload. The storage strategy should be reviewed before production.
