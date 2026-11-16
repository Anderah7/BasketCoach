# BasketCoach communicationService

Fastify 5 service on port 3001, using `@fastify/mongodb` 10 and the official MongoDB driver. Node.js 20.19 or newer is required; the project has been checked with Node.js 24.13.1.

## Configuration and startup

Install dependencies with `npm install`. Copy `.env.example` to `.env` if the local file does not exist, then configure:

```dotenv
PORT=3001
MONGODB_URI=mongodb://127.0.0.1:27017
MONGODB_DB_NAME=basketcoach_communication
SPORTS_SERVICE_URL=http://127.0.0.1:8001
```

`MONGODB_URI` specifies the MongoDB server. `MONGODB_DB_NAME` selects the existing database. `SPORTS_SERVICE_URL` is the internal base URL used to validate tokens through `GET /users/me`. `CORS_ORIGINS` optionally overrides the allowed frontend origins. The `.env` file is loaded relative to this service, regardless of the terminal working directory.

Start the MongoDB Windows service, then run:

```powershell
cd communicationService
npm start
```

Startup connects to MongoDB and performs a read-only `ping` before opening the HTTP listener. MongoDB must be reachable. On startup failure, the process exits with an error status. Stop with Ctrl+C; Fastify closes its listener and MongoDB connection. Selecting a database and pinging it do not create collections or insert documents.

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

The response contains only `id`, `name` and `role`. Every protected request forwards its Bearer token to sportsService and checks the active user; communicationService does not maintain users or decode tokens without verification. Future routes can reuse `preHandler: fastify.authenticate` and read `request.user`.

Missing or rejected tokens return 401; denied/inactive accounts return 403. An unreachable authentication service returns 503, a timeout returns 504, and an unexpected or invalid upstream response returns 502. Authentication has a five-second timeout and does not follow redirects.

## Automated checks

```powershell
npm test
```

These checks simulate sportsService and MongoDB. They do not connect to PostgreSQL, insert MongoDB documents or create user records. Connection lifecycle is provided by the [official Fastify MongoDB plugin](https://github.com/fastify/fastify-mongodb).
