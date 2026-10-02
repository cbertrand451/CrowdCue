# CrowdCue

CrowdCue is a collaborative Spotify party-request application. The application foundation, PostgreSQL database structure, Spotify OAuth authentication, and party creation system are implemented. Guest sessions, song requests, voting, and Spotify queue operations are upcoming milestones. Product requirements live in [PROJECT_SPEC.md](PROJECT_SPEC.md); contributor instructions live in [AGENTS.md](AGENTS.md).

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

The frontend is at `http://127.0.0.1:5173`; the API is at `http://127.0.0.1:3000/api/health`. The health endpoint returns `{"status":"ok","service":"crowdcue"}`. The frontend confirms actual API connectivity and reports connection failure. A `.env` file is optional when OAuth is disabled; blank optional variables use defaults.

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

If your local `.env` enables OAuth with an HTTP loopback callback, use `SPOTIFY_AUTH_ENABLED=false npm start` for a local production-build smoke test, or supply HTTPS OAuth settings for a production authentication test.

## Project structure

```text
src/client/         React entry point, authentication, party creation/link pages
src/server/         App factory, configuration, authentication, party APIs, database
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

| Variable                  | Default / purpose                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | `development`; accepts `development`, `test`, `production`. `npm start` selects `production`.                             |
| `HOST`                    | `127.0.0.1`; use `0.0.0.0` for a cloud/container listener                                                                 |
| `PORT`                    | `3000`; integer from 1 to 65535                                                                                           |
| `LOG_LEVEL`               | `info`; Pino levels or `silent`                                                                                           |
| `API_PROXY_TARGET`        | Optional Vite process environment override; defaults to `http://127.0.0.1:3000`. Set this when changing the backend port. |
| `DATABASE_URL`            | PostgreSQL URL for migrations and enabled authentication; never exposed to the browser                                    |
| `TEST_DATABASE_URL`       | PostgreSQL URL for integration tests; use a separate test database                                                        |
| `SPOTIFY_AUTH_ENABLED`    | Blank/false disables OAuth. Set true after completing the setup below                                                     |
| `SPOTIFY_CLIENT_ID`       | Spotify application client ID                                                                                             |
| `SPOTIFY_CLIENT_SECRET`   | Spotify application secret; backend only                                                                                  |
| `SPOTIFY_REDIRECT_URI`    | Exact registered callback URL ending in /api/auth/spotify/callback                                                        |
| `SPOTIFY_REDIRECT_URL`    | Alias when SPOTIFY_REDIRECT_URI is absent/blank                                                                           |
| `APP_ORIGIN`              | Browser origin without a trailing slash; defaults to the callback origin and must match it                                |
| `TOKEN_ENCRYPTION_KEYS`   | Secret JSON object of key IDs to canonical base64-encoded 32-byte keys                                                    |
| `TOKEN_ENCRYPTION_KEY_ID` | Active encryption key ID; defaults to v1                                                                                  |

Vite does not read the backend `.env` into its configuration. For example, a custom backend port uses `PORT=3001 API_PROXY_TARGET=http://127.0.0.1:3001 npm run dev` on POSIX shells. No Spotify credentials or database connection are required to install, run unit tests, or start with OAuth disabled.

## Spotify authentication setup

The host clicks **Connect Spotify**, grants Spotify permissions, and returns to CrowdCue with a private host session. No Spotify password is handled by CrowdCue and no audio is played by the application.

1. Supply `DATABASE_URL` and run `npm run db:migrate` to apply migration 002, which adds expiring OAuth attempts, host sessions, and host display names. Existing parties and credentials are preserved.
2. Set the real Spotify application credentials in the backend environment. The managed environment's `SPOTIFY_REDIRECT_URL` is accepted as an alias.
3. In the Spotify developer dashboard, register the exact callback URL `http://127.0.0.1:5173/api/auth/spotify/callback` for local development. Set `SPOTIFY_REDIRECT_URI` to that value and `APP_ORIGIN` to `http://127.0.0.1:5173`. Open the app using that same origin. Vite proxies the callback to the backend. HTTPS is required for production; replace the local origin with the deployed browser origin. Spotify requires explicit loopback IPs for HTTP redirects, so do not use localhost.
4. For local development, run `npm run auth:keygen`. This writes a random encryption key to ignored `.env.token-key` with private permissions, without printing it. Existing key files are never overwritten. Server/start scripts load this file after `.env`; process environment values take precedence over both. Preserve the file across restarts. For deployment, provision `TOKEN_ENCRYPTION_KEYS` and `TOKEN_ENCRYPTION_KEY_ID` through your secret manager; never commit the local file.
5. Set `SPOTIFY_AUTH_ENABLED=true`, restart with `npm run dev`, and click Connect Spotify. Configuration validation fails safely when required values, matching origins, or encryption keys are missing. When disabled, the app remains runnable and displays an unavailable connection button.

The requested scopes are `user-read-private`, `user-read-playback-state`, `user-modify-playback-state`, and `playlist-modify-private`. They support host identification and the planned playback-state, queue, and private backup-playlist features. Spotify app development-mode access restrictions still apply: use an eligible account allowed by the app configuration. A live browser consent/sign-in is required to confirm provider configuration; automated tests use mocked Spotify responses.

Authentication endpoints:

| Endpoint                       | Behavior                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| POST /api/auth/spotify/login   | Same-origin browser form; sets a 10-minute OAuth cookie and redirects to Spotify                                          |
| GET /api/auth/spotify/callback | Consumes browser-bound state, exchanges the code with PKCE, saves encrypted tokens, and rotates the host cookie           |
| GET /api/auth/spotify/status   | Returns enabled/authenticated/connected flags, optional display name, and safe recovery status; refreshes expiring tokens |
| POST /api/auth/logout          | Same-origin session revocation and cookie clearing for the current browser                                                |

OAuth state is random, stored as a SHA-256 hash, bound to a separate HttpOnly browser cookie, and consumed atomically once. PKCE verifiers are also encrypted in the database. Private host sessions last 30 days and are stored only as token hashes. HTTPS cookies use Secure, HttpOnly, SameSite=Lax, Path=/, and the __Host- prefix. Mutating endpoints require the exact configured Origin. Authentication responses use no-store and no-referrer headers. Reverse-proxy/access logs must also avoid recording OAuth codes and private URLs.

Access and refresh tokens use AES-256-GCM with random nonces and account/purpose binding. The key ring permits old and active key IDs: retain old keys while their ciphertext exists, switch the active ID for new writes, and refresh/reconnect to re-encrypt Spotify credentials. Party link records also use this key ring; refreshing Spotify credentials does not re-encrypt party links, so keep their old keys until those records are deliberately re-encrypted. Database errors, provider messages, and Spotify token values never reach browser responses or raw application logs.

Tokens refresh automatically within 60 seconds of expiry. PostgreSQL row locks serialize refreshes across processes; omitted refresh tokens retain the previous value and rotated tokens replace it. Invalid grants commit credential removal and request reconnection, while transient errors/rate limits retain credentials for retry. Backend `AuthService.hostProfile` validates the host session and retries a Spotify 401 once with a refreshed token. Future privileged endpoints must use `requireHost` and verify party ownership; no client-supplied account ID grants host access.

Sign out revokes this browser's CrowdCue session. It does not revoke Spotify consent or delete the host's encrypted credentials, so it will not interrupt future party workers. The status endpoint reports locally stored credential availability/refresh results; revocation of an otherwise unexpired token is detected on the next Spotify API call. No playlist, playback, or queue mutation is performed in this milestone.

Authentication routes have per-process IP rate limits (10 login attempts, 30 callbacks/logout requests, and 60 status requests per minute). Do not trust arbitrary forwarded IP headers. When deploying behind a reverse proxy or across multiple instances, configure trusted proxy handling and shared edge rate limiting as part of deployment hardening. Node's environment proxy support honors configured HTTP/HTTPS proxies and CA trust for backend Spotify calls.

## Party creation

Sign in with Spotify, enter a party name, choose preferences, and click **Create party**. The party becomes ACTIVE immediately. The host receives a guest link to share, a private admin link, and a read-only display link. **Your parties** restores the same links after refresh or a new host login and supports loading older parties, 20 at a time. Hosts may create multiple active parties.

Party creation requires a valid host session and the configured browser Origin; ownership is determined on the server. It does not make Spotify API calls, create playlists, or change playback. A previously authenticated host may create a party while Spotify needs reconnection, but future Spotify operations will require valid credentials.

Run `npm run db:migrate` before starting the updated server. Migration 003 backfills only missing settings, adds encrypted private link records and creation-key records, and preserves existing parties/settings. Pre-existing manually seeded parties whose private tokens were never saved cannot have those tokens recovered; their guest links remain available and their owner responses have null admin/display links. The migration does not rotate those identifiers.

The create endpoint accepts JSON with a trimmed name of 1–120 characters (no control characters), optional `settings`, and a UUID `Idempotency-Key` header. Unknown fields and client-supplied ownership/status/identifiers are rejected. A database transaction saves the party, settings, encrypted links, and creation key together. Concurrent requests with the same host/key and normalized payload return the same party and links; reuse with different details returns 409. The frontend prevents overlapping submissions and keeps its key for retries after uncertain failures. Refresh your party list before starting a different attempt after an uncertain result.

Initial preferences:

| Setting                     | Default                                         |
| --------------------------- | ----------------------------------------------- |
| `requireGuestNames`         | false                                           |
| `votingEnabled`             | true                                            |
| `approvalRequired`          | false                                           |
| `allowExplicitTracks`       | true                                            |
| `maxActiveRequestsPerGuest` | null (unlimited); optional integer 1–100        |
| `requestCooldownSeconds`    | 0; integer 0–3600                               |
| `queueBehavior`             | SPOTIFY_QUEUE; BACKUP_PLAYLIST is also accepted |

The form exposes the four boolean preferences. Limits, cooldown, and queue behavior can be initialized through the API. These preferences are persisted for the later guest/request/vote/Spotify features; those features are not implemented in this milestone.

| Endpoint                            | Behavior                                                          |
| ----------------------------------- | ----------------------------------------------------------------- |
| POST /api/parties                   | Create for the authenticated host: 201 when new, 200 for a replay |
| GET /api/parties?offset=0           | List only the authenticated host's parties and recover role links |
| GET /api/parties/:id                | Owner-only party details                                          |
| GET /api/party-links/admin/:token   | Private party details, requiring the owning host session          |
| GET /api/party-links/guest/:token   | Public party name, status, and settings                           |
| GET /api/party-links/display/:token | Public party details and the shareable guest URL                  |

Guest/Admin/Display URLs use independent cryptographically random 256-bit tokens: `/join/<token>`, `/admin/<token>`, and `/display/<token>`. Guest identifiers are intentionally shareable. Admin/display token hashes support role lookup; an AES-256-GCM envelope bound to the party ID lets the host recover the original private links. Public responses never decrypt link records or include private links, host identifiers, OAuth credentials, or session tokens. An Admin URL by itself does not grant host privileges. Unknown parties and other hosts' parties return the same 404 response.

All party API responses and role pages use no-store/no-referrer headers and `X-Robots-Tag: noindex, nofollow, noarchive`. Crawler directives discourage indexing; authorization still controls private access. Malformed role-page tokens return a generic 404 without echoing the token; syntactically valid links load the page and are verified by the role-specific API. Request bodies, tokens, and raw database errors are not logged. Per-process IP limits allow 10 create attempts, 60 owner/admin reads, and 300 public reads per minute; deployment still needs shared edge limits and trusted proxy configuration.

Production serves the React entry point at all three role URLs so bookmarked links and page refreshes work. The current role pages show persistent party details; guest identity, search, requests, moderation, QR codes, and the full display are later tasks. They poll party state every 15 seconds, with no overlapping requests, so an ended party is reflected on open pages. There is no end-party or settings-edit endpoint yet.

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

Party creation inserts its settings and private links in the same transaction using `inTransaction`. Future mutation code must maintain `updated_at`, authorize operations, enforce party state/settings/session expiry, and implement allowed request transitions. Database row types are internal shapes, not public API responses.

Guest session identifiers still need implementation and must be independent of role-link tokens. Store only SHA-256 hashes of private session tokens. Length/format constraints cannot establish unpredictability or authorization. Host sessions, OAuth encryption, role links, and party creation are implemented as described above. Do not store plaintext Spotify/session tokens or serialize credential rows. Queue coordination provides storage, not exactly-once Spotify delivery: the future worker must atomically claim operations and reconcile uncertain outcomes before retrying.

### Database integration tests

Set `TEST_DATABASE_URL` in the process environment to a separate test database, then run:

```sh
npm run test:db
# Run every check with PostgreSQL tests included:
npm run check
```

The test runner does not load `.env` automatically. Database tests create random isolated schemas and drop only those schemas afterward; the test role needs schema creation privileges. They verify migrations, settings/lifecycle constraints, concurrent duplicate requests/votes, cross-party references, rollback/deletion behavior, OAuth/session behavior, party creation transactions/idempotency, host ownership, role isolation, and link recovery. Frontend tests cover creation preferences, retries, sign-out privacy, link pages, and state polling. Ordinary `npm test` skips database tests when `TEST_DATABASE_URL` is absent; `npm run test:db` fails if it is absent.

The server remains runnable without database configuration when OAuth is disabled; party APIs then report unavailability. The health endpoint reports process liveness, not database readiness. **Secure Guest/Admin/Display URLs are complete. Next task: build the Host/Admin interface foundation**, then the Guest interface and guest sessions.

Future request/vote updates can use Server-Sent Events with ordinary HTTP mutations; only party-state polling is implemented. Multi-instance event delivery and Spotify queue synchronization will need explicit coordination when those tasks begin.
