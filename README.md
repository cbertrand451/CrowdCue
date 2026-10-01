# CrowdCue

CrowdCue is a collaborative Spotify party-request application. The application foundation and PostgreSQL database structure are implemented. Party/session APIs, authentication, requests, voting, and Spotify integration are upcoming milestones. Product requirements live in [PROJECT_SPEC.md](PROJECT_SPEC.md); contributor instructions live in [AGENTS.md](AGENTS.md).

## Architecture and stack

A TypeScript monolith with React and Vite for the browser and Fastify 5 for the backend. Development runs a Vite server that proxies `/api` to Fastify. Production runs one Node process serving the compiled frontend and API from the same origin. No CORS configuration, microservices, Redis, or background worker infrastructure is needed at this stage.

Fastify Helmet supplies security headers; Fastify's Pino logger supplies structured logs. Request logging is disabled to avoid recording private URLs and future OAuth query strings. Errors return a generic response and do not log raw exceptions. Zod validates server configuration without reporting environment values. Browser code receives no server configuration or secrets.

Vitest covers API/configuration behavior and frontend loading, success, and failure states, using Testing Library and jsdom. ESLint, Prettier, and strict TypeScript enforce code quality. npm's committed lockfile makes installs reproducible.

## Requirements and commands

Use Node **24 LTS** and npm **11** (see `.nvmrc`). From the repository root:

```sh
npm ci
cp .env.example .env
npm run dev
```

The frontend is at `http://localhost:5173`; the API is at `http://127.0.0.1:3000/api/health`. The health endpoint returns `{"status":"ok","service":"crowdcue"}`. The frontend confirms actual API connectivity and reports connection failure. A `.env` file is optional for this milestone; blank optional variables use defaults.

| Command                | Purpose                                                |
| ---------------------- | ------------------------------------------------------ |
| `npm ci`               | Install exact locked dependencies                      |
| `npm run dev`          | Run frontend and backend with reload                   |
| `npm run dev:server`   | Run only the API                                       |
| `npm run dev:client`   | Run only Vite                                          |
| `npm test`             | Run all automated tests                                |
| `npm run test:watch`   | Watch tests                                            |
| `npm run lint`         | Lint source and configuration                          |
| `npm run format`       | Format files                                           |
| `npm run format:check` | Check formatting                                       |
| `npm run typecheck`    | Check frontend, backend, tests, and build config types |
| `npm run build`        | Build browser assets and compile backend               |
| `npm start`            | Run the production build (build first)                 |
| `npm run check`        | Run formatting, lint, types, tests, and build          |

For a production smoke test:

```sh
npm run build
npm start
```

Visit `http://127.0.0.1:3000`. `npm start` explicitly selects production mode. Deployment should provide HTTPS through a reverse proxy and use `HOST=0.0.0.0` when binding inside a container. Deployment automation is deferred. SIGINT/SIGTERM close Fastify gracefully. Install build dependencies before building; a runtime-only installation may use `npm ci --omit=dev` after the build artifacts have been produced.

## Project structure

```text
src/client/         React entry point, status UI, styles
src/server/         App factory, environment validation, server entry point
tests/             API/configuration and browser component tests
index.html          Vite HTML entry point
vite.config.ts      Frontend build and development API proxy
vitest.config.ts    Test runner configuration
tsconfig*.json     Strict shared types and backend compilation
dist/client/       Generated browser assets (ignored)
dist/server/       Generated backend JavaScript (ignored)
```

## Environment variables

Keep local values in ignored `.env` files or deployment secret configuration. `.env.example` contains names only. Never prefix privileged configuration with `VITE_`: that prefix exposes values in browser bundles.

| Variable                | Default / purpose                                                                                                         |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`              | `development`; accepts `development`, `test`, `production`. `npm start` selects `production`.                             |
| `HOST`                  | `127.0.0.1`; use `0.0.0.0` for a cloud/container listener                                                                 |
| `PORT`                  | `3000`; integer from 1 to 65535                                                                                           |
| `LOG_LEVEL`             | `info`; Pino levels or `silent`                                                                                           |
| `API_PROXY_TARGET`      | Optional Vite process environment override; defaults to `http://127.0.0.1:3000`. Set this when changing the backend port. |
| `DATABASE_URL`          | PostgreSQL URL for migration commands; never exposed to the browser                                                       |
| `TEST_DATABASE_URL`     | PostgreSQL URL for integration tests; use a separate test database                                                        |
| `SPOTIFY_CLIENT_ID`     | Reserved for OAuth; not read yet                                                                                          |
| `SPOTIFY_CLIENT_SECRET` | Reserved server secret; not read yet                                                                                      |
| `SPOTIFY_REDIRECT_URI`  | Reserved OAuth callback URL; not read yet                                                                                 |

Vite does not read the backend `.env` into its configuration. For example, a custom backend port uses `PORT=3001 API_PROXY_TARGET=http://127.0.0.1:3001 npm run dev` on POSIX shells. No Spotify credentials or database connection are required to install, test, or start this foundation.

## Database structure and migrations

Use **PostgreSQL 17** (validated version) with the `pg` driver, parameterized SQL, backend row interfaces, and versioned migrations in `src/server/db/`. No ORM or extra database service layer is required. Set `DATABASE_URL` in your ignored `.env` or deployment environment, then run:

```sh
npm run db:migrate
# After npm run build, runtime-only deployments can use:
npm run db:migrate:production
```

Create the database and its owner through your PostgreSQL provider before migrating. The migration role needs schema/table creation privileges; use a separate restricted runtime role when implementing deployment. Use the provider's verified TLS configuration for remote connections; do not disable certificate verification.

Migrations run explicitly before deployment, rather than during server startup. The runner uses a transaction and a PostgreSQL advisory lock to serialize concurrent runners. Applied version/name/checksum records prevent silently modifying old migrations. Repeated runs are safe. Add a new migration for subsequent changes; do not edit an applied migration. No destructive rollback command is provided. Back up persistent data before production migrations.

The initial schema includes:

- `spotify_accounts` and private `spotify_credentials`: host identity and encrypted OAuth credential envelopes, separated from public party data.
- `parties` and `party_settings`: host ownership, active/ended lifecycle, separate join/admin/display identifiers, backup playlist reference, and typed settings.
- `guests`: party-scoped expiring guest sessions and optional display names.
- `song_requests`: cached Spotify metadata, moderation states, optional manual ordering, and timestamps.
- `votes`: one vote per guest/request, with foreign keys requiring the voter and request to belong to the same party.
- `spotify_queue_operations`: one durable queue coordination record per request, including an UNKNOWN state for uncertain external outcomes.

A partial unique index prevents the same track from having multiple REQUESTED, APPROVED, or QUEUED requests in one party, including concurrent inserts. PLAYED, REJECTED, and REMOVED requests remain as history and permit requesting the track again. Request authors must belong to the request's party. Indexes support party/host lookup, queue reads, guest requests, votes, and pending queue operations. Party deletion cascades party-owned data; deleting a host with parties is restricted and deleting a guest who authored requests is restricted. Ending a party preserves history.

Future party creation must insert its settings in the same transaction using `inTransaction`. Application code must maintain `updated_at`, authorize mutations, enforce party state/settings/session expiry, and implement allowed request transitions. Database row types are internal shapes, not public API responses.

Generate independent cryptographically random join/admin/display/session tokens in the session task. Store only SHA-256 hashes of private admin/display/session tokens. Length/format constraints cannot establish unpredictability or authorization. OAuth integration must encrypt access/refresh tokens with authenticated encryption and a key stored outside the database, using `encryption_key_id` for rotation; encryption is not implemented in this structure-only milestone. Do not store plaintext tokens or serialize credential rows. Queue coordination provides storage, not exactly-once Spotify delivery: the future worker must atomically claim operations and reconcile uncertain outcomes before retrying.

### Database integration tests

Set `TEST_DATABASE_URL` in the process environment to a separate test database, then run:

```sh
npm run test:db
# Run every check with PostgreSQL tests included:
npm run check
```

The test runner does not load `.env` automatically. Database tests create a random isolated schema and drop only that schema afterward; the test role needs schema creation privileges. They verify migration serialization/repeatability/drift, settings and lifecycle constraints, concurrent duplicate requests/votes, cross-party references, transaction rollback, and deletion behavior. Ordinary `npm test` skips database tests when `TEST_DATABASE_URL` is absent; `npm run test:db` fails if it is absent.

The server remains runnable without database configuration until party/session APIs are implemented. The health endpoint reports process liveness, not database readiness. **Next task: implement the Party/session system** using these tables and transaction helpers.

Future real-time behavior can use Server-Sent Events from this backend with ordinary HTTP mutations; no real-time functionality is implemented. Multi-instance delivery and Spotify queue synchronization will need explicit coordination when those tasks begin.
