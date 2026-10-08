# CrowdCue

CrowdCue is a collaborative Spotify party-request application. The application foundation, PostgreSQL database structure, Spotify OAuth authentication, and party creation system are implemented. The guest interface and party-scoped guest sessions are implemented. Spotify song search, song requests with host moderation, and voting are implemented. Session playlists, random backup refill, current/next locking, live voting/reordering and manual playlist cleanup instructions are implemented. Product requirements live in [PROJECT_SPEC.md](PROJECT_SPEC.md); contributor instructions live in [AGENTS.md](AGENTS.md).

## Public hosting — no local installation

Deploy CrowdCue to **Render Free + Supabase Free** using [DEPLOY.md](DEPLOY.md).
No PostgreSQL, Node, Docker, or app download is required on your computer.
The included `render.yaml` uses the development branch, builds the app, applies
migrations automatically, and starts the existing frontend/backend together.
Public HTTPS Guest links and QR codes use Render's assigned address.
Provider account setup and Spotify callback registration are required before
live use. Free hosting can sleep; see the deployment guide for limits.

## Optional local start — no database installation

Download the **codex/crowdcue-build** branch as a ZIP from GitHub, extract it, and open the extracted folder in VS Code. Install **Node.js 24 LTS** (npm is included). In the VS Code terminal:

```sh
npm ci
npm run local
```

Open **http://127.0.0.1:5173**. No Git, Python, Docker, PostgreSQL installer, database commands, or separately generated encryption key are required. The npm install includes platform-specific PostgreSQL binaries; the launcher runs them privately on your laptop, creates the databases, applies migrations, and generates the ignored encryption key automatically. This keeps the existing PostgreSQL transactions, locks, and live updates intact. It is a bundled database, not SQLite or a hosted service.

For real parties and Spotify search/playback, add your Spotify application credentials to `.env` as described in [RUN.md](RUN.md), register the local callback, then restart. Without credentials, the app opens for a UI/connectivity check; Spotify sign-in and party creation remain unavailable. The launcher never supplies fake Spotify credentials or bypasses authentication.

Local data persists in ignored `data/local/`; keep that folder **and** `.env.token-key` together across restarts. Ctrl+C stops the app and bundled database. Run `npm run test:local` to run all tests, including database integration tests, against a separate bundled test database. Windows x64, macOS Intel/Apple Silicon, and supported Linux architectures receive the matching binary through npm; only Linux x64 has been verified in this workspace. The first install needs internet and normal npm install scripts enabled. Run as a normal user, not root/administrator.

## Architecture and stack

A TypeScript monolith with React and Vite for the browser and Fastify 5 for the backend. Development runs a Vite server that proxies `/api` to Fastify. Production runs one Node process serving the compiled frontend and API from the same origin. An in-process Spotify worker coordinates through PostgreSQL; no separate worker infrastructure, Redis, or microservices are needed.

Fastify Helmet supplies security headers; Fastify's Pino logger supplies structured logs. Request logging is disabled to avoid recording private URLs and future OAuth query strings. Errors return a generic response and do not log raw exceptions. Zod validates server configuration without reporting environment values. Browser code receives no server configuration or secrets.

Vitest covers API/configuration behavior and frontend loading, success, and failure states, using Testing Library and jsdom. ESLint, Prettier, and strict TypeScript enforce code quality. npm's committed lockfile makes installs reproducible.

## Advanced development and deployment commands

Use Node **24 LTS** and npm **11** (see `.nvmrc`). For the simplest local setup use `npm run local` above. The original commands below remain available for an externally managed PostgreSQL database:

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

Visit `http://127.0.0.1:3000`. `npm start` explicitly selects production mode. Public hosting uses `npm run start:cloud` and the Render Blueprint documented in [DEPLOY.md](DEPLOY.md). Deployment provides HTTPS through a reverse proxy and uses `HOST=0.0.0.0`. SIGINT/SIGTERM close Fastify gracefully. Install build dependencies before building; a runtime-only installation may use `npm ci --omit=dev` after the build artifacts have been produced.

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

| Variable                  | Default / purpose                                                                                                                                    |
| ------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE_ENV`                | `development`; accepts `development`, `test`, `production`. `npm start` selects `production`.                                                        |
| `HOST`                    | `127.0.0.1`; use `0.0.0.0` for a cloud/container listener                                                                                            |
| `PORT`                    | `3000`; integer from 1 to 65535                                                                                                                      |
| `LOG_LEVEL`               | `info`; Pino levels or `silent`                                                                                                                      |
| `API_PROXY_TARGET`        | Optional Vite process environment override; defaults to `http://127.0.0.1:3000`. Set this when changing the backend port.                            |
| `DATABASE_URL`            | Optional with `npm run local`; blank uses the bundled database. Otherwise PostgreSQL URL for migrations/authentication; never exposed to the browser |
| `TEST_DATABASE_URL`       | PostgreSQL URL for integration tests; use a separate test database                                                                                   |
| `SPOTIFY_AUTH_ENABLED`    | Blank/false disables OAuth. Set true after completing the setup below                                                                                |
| `SPOTIFY_CLIENT_ID`       | Spotify application client ID                                                                                                                        |
| `SPOTIFY_CLIENT_SECRET`   | Spotify application secret; backend only                                                                                                             |
| `SPOTIFY_REDIRECT_URI`    | Exact registered callback URL ending in /api/auth/spotify/callback                                                                                   |
| `SPOTIFY_REDIRECT_URL`    | Alias when SPOTIFY_REDIRECT_URI is absent/blank                                                                                                      |
| `APP_ORIGIN`              | Browser origin without a trailing slash; defaults to the callback origin and must match it                                                           |
| `TOKEN_ENCRYPTION_KEYS`   | Secret JSON object of key IDs to canonical base64-encoded 32-byte keys                                                                               |
| `TOKEN_ENCRYPTION_KEY_ID` | Active encryption key ID; defaults to v1                                                                                                             |

Vite does not read the backend `.env` into its configuration. For example, a custom backend port uses `PORT=3001 API_PROXY_TARGET=http://127.0.0.1:3001 npm run dev` on POSIX shells. No Spotify credentials or database connection are required to install, run unit tests, or start with OAuth disabled.

## Spotify authentication setup

The host clicks **Connect Spotify**, grants Spotify permissions, and returns to CrowdCue with a private host session. No Spotify password is handled by CrowdCue and no audio is played by the application.

1. Supply `DATABASE_URL` and run `npm run db:migrate` to apply migration 002, which adds expiring OAuth attempts, host sessions, and host display names. Existing parties and credentials are preserved.
2. Set the real Spotify application credentials in the backend environment. The managed environment's `SPOTIFY_REDIRECT_URL` is accepted as an alias.
3. In the Spotify developer dashboard, register the exact callback URL `http://127.0.0.1:5173/api/auth/spotify/callback` for local development. Set `SPOTIFY_REDIRECT_URI` to that value and `APP_ORIGIN` to `http://127.0.0.1:5173`. Open the app using that same origin. Vite proxies the callback to the backend. HTTPS is required for production; replace the local origin with the deployed browser origin. Spotify requires explicit loopback IPs for HTTP redirects, so do not use localhost.
4. For local development, run `npm run auth:keygen`. This writes a random encryption key to ignored `.env.token-key` with private permissions, without printing it. Existing key files are never overwritten. Server/start scripts load this file after `.env`; process environment values take precedence over both. Preserve the file across restarts. For deployment, provision `TOKEN_ENCRYPTION_KEYS` and `TOKEN_ENCRYPTION_KEY_ID` through your secret manager; never commit the local file.
5. Set `SPOTIFY_AUTH_ENABLED=true`, restart with `npm run dev`, and click Connect Spotify. Configuration validation fails safely when required values, matching origins, or encryption keys are missing. When disabled, the app remains runnable and displays an unavailable connection button.

The requested scopes are `user-read-private`, `user-read-playback-state`, `playlist-modify-private`, `playlist-read-private`, and `playlist-read-collaborative`. CrowdCue only writes to the private session playlist it creates. It does not request playback modification or public playlist modification. Existing hosts should reconnect Spotify to use the reduced consent list. Spotify app access restrictions still apply; browser consent and live client acceptance testing are required. All automated Spotify writes are mocked.

Authentication endpoints:

| Endpoint                       | Behavior                                                                                                                  |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------- |
| POST /api/auth/spotify/login   | Same-origin POST; sets a 10-minute OAuth cookie and returns the authorization URL for JSON clients, otherwise redirects   |
| GET /api/auth/spotify/callback | Consumes browser-bound state, exchanges the code with PKCE, saves encrypted tokens, and rotates the host cookie           |
| GET /api/auth/spotify/status   | Returns enabled/authenticated/connected flags, optional display name, and safe recovery status; refreshes expiring tokens |
| POST /api/auth/logout          | Same-origin session revocation and cookie clearing for the current browser                                                |

OAuth state is random, stored as a SHA-256 hash, bound to a separate HttpOnly browser cookie, and consumed atomically once. PKCE verifiers are also encrypted in the database. Private host sessions last 30 days and are stored only as token hashes. HTTPS cookies use Secure, HttpOnly, SameSite=Lax, Path=/, and the __Host- prefix. Mutating endpoints require the exact configured Origin. Authentication responses use no-store and no-referrer headers. Reverse-proxy/access logs must also avoid recording OAuth codes and private URLs.

Access and refresh tokens use AES-256-GCM with random nonces and account/purpose binding. The key ring permits old and active key IDs: retain old keys while their ciphertext exists, switch the active ID for new writes, and refresh/reconnect to re-encrypt Spotify credentials. Party link records also use this key ring; refreshing Spotify credentials does not re-encrypt party links, so keep their old keys until those records are deliberately re-encrypted. Database errors, provider messages, and Spotify token values never reach browser responses or raw application logs.

Tokens refresh automatically within 60 seconds of expiry. PostgreSQL row locks serialize refreshes across processes; omitted refresh tokens retain the previous value and rotated tokens replace it. Invalid grants commit credential removal and request reconnection, while transient errors/rate limits retain credentials for retry. Backend `AuthService.hostProfile` validates the host session and retries a Spotify 401 once with a refreshed token. Future privileged endpoints must use `requireHost` and verify party ownership; no client-supplied account ID grants host access.

Sign out revokes this browser's CrowdCue session. It does not revoke Spotify consent or delete the host's encrypted credentials, so it will not interrupt party workers. The status endpoint reports locally stored credential availability/refresh results; revocation of an otherwise unexpired token is detected on the next Spotify API call. Authentication endpoints do not mutate playback; the separate session worker performs the authorized queue/playlist operations.

Authentication routes have per-process IP rate limits (10 login attempts, 30 callbacks/logout requests, and 60 status requests per minute). Do not trust arbitrary forwarded IP headers. When deploying behind a reverse proxy or across multiple instances, configure trusted proxy handling and shared edge rate limiting as part of deployment hardening. Node's environment proxy support honors configured HTTP/HTTPS proxies and CA trust for backend Spotify calls.

## Party creation

Sign in with Spotify, enter a party name, choose preferences, and click **Create party**. The party becomes ACTIVE immediately. The host receives a guest link to share, a private admin link, and a read-only display link. **Your parties** restores the same links after refresh or a new host login and supports loading older parties, 20 at a time. Hosts may create multiple active parties.

Party creation requires a valid host session and the configured browser Origin; ownership is determined on the server. The creation request writes database records without contacting Spotify. Start session creates the private Spotify playlist; the host then presses Play in Spotify. A previously authenticated host may create a party while Spotify needs reconnection, but playlist creation and playback require valid credentials.

Run `npm run db:migrate` before starting the updated server. Migration 003 backfills only missing settings, adds encrypted private link records and creation-key records, and preserves existing parties/settings. Pre-existing manually seeded parties whose private tokens were never saved cannot have those tokens recovered; their guest links remain available and their owner responses have null admin/display links. The migration does not rotate those identifiers.

The create endpoint accepts JSON with a trimmed name of 1–120 characters (no control characters), optional `settings`, and a UUID `Idempotency-Key` header. Unknown fields and client-supplied ownership/status/identifiers are rejected. A database transaction saves the party, settings, encrypted links, and creation key together. Concurrent requests with the same host/key and normalized payload return the same party and links; reuse with different details returns 409. The frontend prevents overlapping submissions and keeps its key for retries after uncertain failures. Refresh your party list before starting a different attempt after an uncertain result.

Initial preferences:

| Setting                     | Default                                                |
| --------------------------- | ------------------------------------------------------ |
| `requireGuestNames`         | false                                                  |
| `votingEnabled`             | true                                                   |
| `approvalRequired`          | false                                                  |
| `allowExplicitTracks`       | true                                                   |
| `maxActiveRequestsPerGuest` | null (unlimited); optional integer 1–100               |
| `requestCooldownSeconds`    | 0; integer 0–3600                                      |
| `queueBehavior`             | SPOTIFY_QUEUE; BACKUP_PLAYLIST is also accepted        |
| `backupSourceId`            | null; select a Spotify backup playlist before starting |
| `saveRecapPlaylist`         | false; asked again when the session closes             |

The form exposes guest, voting, approval, explicit-track, backup-playlist, and recap-saving preferences. The dashboard also exposes request limits and cooldown. Guest requests, voting, and Spotify playback use these persisted settings.

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

Production serves the React entry point at all three role URLs so bookmarked links and page refreshes work. The current role pages show persistent party details and joined guests can search Spotify; The TV display is implemented; guest QR codes are implemented. They poll party state every 15 seconds, with no overlapping requests, so an ended party is reflected on open pages. The owning host can now rename a party, change its request preferences, and end it from the Admin dashboard. Ended parties remain readable and cannot be reopened or edited. Ending a party does not stop Spotify playback.

## Guest interface and sessions

Opening a Guest link shows the party name, active/ended state, and current preferences without requiring a Spotify or CrowdCue account. Tap **Join party** to join anonymously or enter an optional name. When the host requires guest names, the server enforces a trimmed name of 1–80 characters. Control characters and extra input fields are rejected. Existing guests can change or clear an optional name; a newly required name prompts them to add one. Joined guests can search Spotify, request songs, and view request status. Guests can also add or remove a vote on eligible requests.

`GET /api/party-links/guest/:token/session` returns this browser's guest identity or `null`. `POST` on the same endpoint joins the party or updates the current guest name. POST requires the configured Origin and bounded JSON, and is limited to 30 attempts per minute per process/IP; GET permits 300. Tokens from Admin or Display links do not resolve a guest party. The guest interface never includes private host links or Spotify credentials.

Each party receives a separate random 256-bit guest session cookie, with HttpOnly, SameSite=Lax, Path=/, a 30-day fixed expiration, and Secure plus the `__Host-` prefix on HTTPS. Cookie names include a digest of the party's join token, allowing simultaneous parties in one browser. Only the SHA-256 session hash is stored in the existing `guests` table; no new migration is required. Sessions survive refreshes and server restarts, and never grant host access. Expired sessions must join again and receive a new identity; expired rows remain for request/vote history. Do not infer guest identity from a link token, client-supplied ID, or name. Cookie-blocking browsers cannot preserve identity across reloads.

Join/name changes lock the party row against simultaneous ending/settings updates. Ended parties reject joining and name changes, but retain read-only session/party context. Public party-state polling updates preferences and ended status. The guest form cancels pending requests on navigation and prevents overlapping submissions. Host sign-out does not revoke independent guest sessions.

## Spotify song search

Joined guests in active parties can search songs, artists, or albums. Search waits 400 ms after typing, requires 2–200 characters, and shows title, artists, album/artwork, duration, explicit status, and a link to the track on Spotify. Paging loads 10 provider items at a time, removes duplicate displayed IDs, and stops before Spotify's bounded offset range. Unavailable/local tracks and explicit songs disallowed by the host are filtered on the backend. A page may be empty after filtering while more results remain. Results include song-request buttons; guests vote in the request list.

`GET /api/party-links/guest/:token/search?q=...&offset=...` requires this party's unexpired guest cookie, an active party, and a name when required. Client-supplied host IDs and unexpected query fields are rejected. The host account is resolved only through the verified party. The server calls Spotify's track-search API with that host's encrypted credentials, proactively refreshes expiring tokens, and retries one Spotify 401 after refresh. No host login cookie is needed by a guest; host sign-out does not disconnect the party's stored Spotify credentials.

Search is limited to 30 requests per minute per process/IP, times out provider calls after 10 seconds, and returns safe errors. Spotify 429s preserve bounded `Retry-After` guidance. Guests are told when search is unavailable or a host reconnect may be needed. The client cancels obsolete searches and ignores stale responses on query changes, navigation, and party ending. Only normalized track metadata is returned; provider errors, next-page URLs, and credentials stay on the backend. Artwork uses HTTPS Spotify image hosts, with a fallback when unavailable. Existing no-store/no-referrer/noindex protections also cover search. Production still needs shared edge rate limits; browser cancellation does not cancel an already-started provider request.

## Song requests and host moderation

Run `npm run db:migrate` before starting this build. Migration 004 adds persistent guest-scoped request-attempt keys and a cooldown index without changing existing requests, parties, or credentials.

Use **Request song** on a search result. The client sends only the Spotify track ID plus a UUID `Idempotency-Key`; the backend resolves the party host and fetches canonical track metadata from Spotify before saving a new request. Titles, artists, artwork, duration, explicit status, author, and status cannot be supplied by the browser. Metadata is cached in the request row for later display. New requests use `REQUESTED` when host approval is required and `APPROVED` otherwise; approval means accepted by CrowdCue, and does not place a song in Spotify's queue yet.

A duplicate active track returns its existing request and directs the guest to **View requests**, without adding a duplicate or voting automatically. The original requester remains the author. A retry of the same guest/key/track returns the saved request even after moderation, with no provider call; reusing a key for a different track returns 409. A fresh attempt may request a previously rejected or removed song again. A previously played song shows **Song already played...proceed?** with Yes and No choices; choosing Yes submits the repeat, and choosing No leaves the queue unchanged. The frontend prevents overlapping submissions and retains a key after an uncertain failure. After a confirmed success, requesting that song again starts a new intent, which still collapses against any active duplicate.

Mutations require an active party, its unexpired guest cookie, a name when required, and the exact configured Origin. The server enforces explicit-song restrictions, active-request limits, and a cooldown measured from the guest's latest request, including moderated history. Duplicate/replayed requests do not consume another slot or restart the cooldown. A party-row lock serializes insertion and moderation against rule changes and ending; Spotify I/O happens outside the transaction, with all rules revalidated before insert. The existing database unique index is the final guard against duplicate active tracks.

| Endpoint                                              | Behavior                                                                           |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `GET /api/party-links/guest/:token/requests?offset=0` | Active party requests plus this guest's own history; guest session required        |
| `POST /api/party-links/guest/:token/requests`         | Submit `{ "trackId": "..." }` with a UUID request key                              |
| `GET /api/party-links/admin/:token/requests?offset=0` | All requests; owning host session and Admin token required                         |
| `POST /api/party-links/admin/:token/requests/:id`     | Submit `{ "action": "approve" }`, `reject`, or `remove`; owner and Origin required |

Lists show 50 records per page, newest first, and poll every five seconds. They expose song metadata, a display name, status, and an own-request flag, while keeping account/session identifiers and credentials private. Admins can approve pending requests or reject/remove pending or approved requests. Repeating an already-applied action is safe; incompatible transitions and changes to queued/played requests return 409. Ended parties retain read-only lists and reject new requests/moderation. Normal moderation applies before a song locks; the recovery control explicitly starts playlist playback.

Per-process/IP limits permit 20 submissions, 600 guest list reads, 60 admin list reads, and 30 moderation attempts per minute. Cooldown/provider limits include `Retry-After`. Safe errors and no-store/no-referrer/noindex protections cover request endpoints. Request creation, retries, concurrent duplicates, moderation, policy changes during metadata fetch, and browser interactions are tested with real PostgreSQL and fixture Spotify responses. Live Spotify validation requires host OAuth consent.

## Voting

Task ten covers duplicate prevention and request limits, which were delivered with song requests. Task eleven adds voting. No new migration is needed: the existing `votes` table already has a unique `(request_id, guest_id)` key and party-bound foreign keys.

Joined guests can vote for pending or approved requests, including their own, and remove their vote. Request lists return `voteCount` and this guest's `hasVoted` state; the host sees totals without guest/session IDs or voter lists. Each guest/session can hold one vote per request. Refreshing or reopening the party retains the same vote, and repeated or concurrent add/remove calls use the desired state instead of toggling unpredictably. Submitting or duplicating a song request never votes automatically.

`POST /api/party-links/guest/:token/requests/:id/vote` accepts only `{ "voted": true }` or `{ "voted": false }`. It requires the exact configured Origin, an unexpired party-scoped guest cookie, an active party, a guest name when required, enabled voting, and an eligible request belonging to that party. Voter IDs/counts cannot be supplied by the browser. A party-row lock serializes votes against disabling voting, moderation, and ending. Votes do not call Spotify or change a request's approval status.

The host's **Allow voting** setting defaults to enabled. Turning it off blocks vote changes and preserves totals; turning it back on restores the existing votes. Queued, played, rejected, removed, and ended-party requests are read-only for voting. Historical votes remain attached to their original request; requesting the same track again starts at zero votes.

Vote controls update totals after a successful response, prevent overlapping mutations, cancel on navigation, and show the guest's selected state. All request boards poll every five seconds so other guests and the host see updated totals. Party settings/status still poll every 15 seconds, and the server checks current rules on every mutation. Guest request reads permit 600 requests per minute per process/IP and vote changes permit 120; shared deployment limits remain a later hardening task. Votes are scoped to the lightweight guest identity, with the same cookie persistence/expiration behavior as other guest features.

The live CrowdCue queue ranks approved songs by votes. The request list remains newest first; automatic request acceptance still defaults to enabled, and Spotify delivery commits the first three upcoming songs.

## Admin dashboard

Open the private Admin link from **Your parties**. The dashboard shows Spotify connection status, guest sharing, Display access, party name/preferences, and an explicit end-party confirmation. It works on phones and laptops. Saved preferences persist; edits in progress are retained during polling. Refresh the page to reload a draft from another browser. If multiple hosts' browser sessions edit the same party, the last successful save wins.

`POST /api/party-links/admin/:token/settings` accepts the validated party name/settings shape; `POST /api/party-links/admin/:token/end` accepts `{}`. Both require the owning host session, the party's Admin token, the exact configured Origin, and bounded JSON. Mutations are limited to 30 attempts per minute per process/IP. Database row locks serialize settings changes against ending; an ended party rejects edits, while repeated end calls retain the original end timestamp. Public guest/display pages reflect ended state through WebSocket notifications, with polling as a fallback.

The dashboard includes request lists and approval/rejection/removal. The dashboard includes the live queue, Spotify synchronization status, the session playlist, and an ended-session summary. The dedicated TV Display interface is implemented; guest QR codes are implemented. The session playlist is the only Spotify queue integration.

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
- `song_request_attempts`: guest-scoped creation keys pointing to the canonical request for duplicate/retry recovery.
- `votes`: one vote per guest/request, with foreign keys requiring the voter and request to belong to the same party.
- `spotify_queue_operations`: one durable queue coordination record per request, including an UNKNOWN state for uncertain external outcomes.

A partial unique index prevents the same track from having multiple REQUESTED, APPROVED, or QUEUED requests in one party, including concurrent inserts. PLAYED, REJECTED, and REMOVED requests remain as history and permit requesting the track again. Request authors must belong to the request's party. Indexes support party/host lookup, queue reads, guest requests, votes, and pending queue operations. Party deletion cascades party-owned data; deleting a host with parties is restricted and deleting a guest who authored requests is restricted. Ending a party preserves history.

Party creation inserts its settings and private links in the same transaction using `inTransaction`. Future mutation code must maintain `updated_at`, authorize operations, enforce party state/settings/session expiry, and implement allowed request transitions. Database row types are internal shapes, not public API responses.

Guest session identifiers are implemented and independent of role-link tokens. Store only SHA-256 hashes of private session tokens. Length/format constraints cannot establish unpredictability or authorization. Host sessions, OAuth encryption, role links, and party creation are implemented as described above. Do not store plaintext Spotify/session tokens or serialize credential rows. Playback workers use per-host PostgreSQL advisory locks and durable delivery claims. Spotify offers no exactly-once delivery guarantee; uncertain queue writes require host recovery rather than automatic retries.

### Database integration tests

Set `TEST_DATABASE_URL` in the process environment to a separate test database, then run:

```sh
npm run test:db
# Run every check with PostgreSQL tests included:
npm run check
```

The test runner does not load `.env` automatically. Database tests create random isolated schemas and drop only those schemas afterward; the test role needs schema creation privileges. They verify migrations, settings/lifecycle constraints, concurrent duplicate requests/votes, cross-party references, rollback/deletion behavior, OAuth/session behavior, party creation transactions/idempotency, host ownership, role isolation, and link recovery. Frontend tests cover creation preferences, retries, sign-out privacy, link pages, live updates, reconnection, and fallback polling. Ordinary `npm test` skips database tests when `TEST_DATABASE_URL` is absent; `npm run test:db` fails if it is absent.

The server remains runnable without database configuration when OAuth is disabled; party APIs then report unavailability. The health endpoint reports process liveness, not database readiness. **Spotify sessions, real-time updates, and the TV Display interface are complete. Guest QR-code joining is also complete.**

## Real-time WebSocket updates (task 14)

Run `npm run db:migrate` to apply migration 006 before starting this backend. Commit-only database triggers publish party invalidations for requests, votes, moderation, guest names, settings, party ending, and playback changes. PostgreSQL LISTEN/NOTIFY delivers them to every server instance; each instance reserves one pool connection for its listener. Timestamp/progress-only writes do not cause unnecessary refreshes. The listener reconnects after database failures and resynchronizes connected rooms.

Role pages connect to `/api/party-links/:role/:token/live` using same-origin WebSockets (`wss` on HTTPS). Guest share links authorize refresh signals, and Display links remain read-only. Admin sockets require the private Admin link plus the owning host cookie. Every handshake requires the exact configured `APP_ORIGIN`; role substitution, forged links, foreign host sessions, and client commands are rejected. Messages contain only `{ "type": "ready" }` or `{ "type": "changed" }`; private links, credentials, request authorship, vote selections, and snapshots remain behind the existing HTTP endpoints and their authorization checks. Guest request/queue reads still require a valid party-scoped guest cookie.

One browser socket serves each page and refreshes party details, request lists, queue order, and host playback status after batched notifications. Reconnecting reloads snapshots to recover missed changes; online/visibility events also refresh. A small connection status indicates live delivery or reconnection. Existing five-second board polling and fifteen-second party polling remain available when sockets are blocked or disconnected. Spotify changes appear after the worker observes them on its five-second interval. The TV Display refreshes its unified snapshot on WebSocket notifications and every five seconds as a fallback, including observed Spotify playback and queue order.

Connections use thirty-second heartbeats and authorization checks, a 1 KiB incoming frame limit, a 64 KiB outgoing backlog limit, and caps of 1,000 sockets per process and 300 per party/IP. Handshakes are limited to 300 per minute per process/IP. Clients reconnect with jitter and backoff capped around thirty seconds. Configure the deployment reverse proxy to forward WebSocket Upgrade/Connection headers and allow long-lived connections; use a direct PostgreSQL connection or session-mode pooler for LISTEN, rather than transaction-mode pooling. Vite's development proxy forwards WebSockets automatically. Polling remains functional if the transport is unavailable.

Database integration tests use real TCP WebSockets, two server instances, and isolated PostgreSQL schemas to verify room isolation, commit/rollback behavior, role/Origin/host authorization, request/vote/playback/end broadcasts, and read-only sockets. Separate tests cover listener reconnection, heartbeat revocation, slow connections, browser reconnection, notification batching, and polling fallback.

### Dynamic CrowdCue queue

Guest and admin pages show a live, numbered queue, refreshed every five seconds and immediately after local requests, votes, or moderation. Only APPROVED requests enter this queue. Automatic approval remains the default; requests requiring host approval stay outside the queue until approved.

With voting enabled, songs rank by vote count descending, then request time ascending, then request ID for a deterministic tie. With voting disabled, songs follow request time and ID. Votes remain saved when voting is disabled and regain their effect when enabled. Removed, rejected, played, and Spotify-queued requests are excluded. Ending a party retains its queue for read-only viewing.

Authenticated GET endpoints `/api/party-links/guest/:token/queue` and `/api/party-links/admin/:token/queue` return `{ items: [{ position, request }], nextOffset, votingEnabled, status }`. Guest sessions and host ownership are checked server-side. Pages contain up to 50 songs with global positions; `?offset=50` requests the next page. Each response holds a shared party lock while reading settings and ranking songs. Pagination is live: votes can move songs between page loads; refresh or return to the first page to see the current front.

Before starting Spotify queueing, the list ranks approved requests by votes. After starting, current and next songs are locked; later songs remain editable.

## Spotify session playlists

The host selects a readable backup Spotify playlist and clicks **Start session** in Admin, choosing a playlist name (defaults to the party name) and description. CrowdCue creates a private session playlist and seeds three randomly chosen eligible backup songs. The host opens **Open session playlist in Spotify** and presses Play on their normal device. Disable Shuffle, Smart Shuffle and Repeat, and clear any old manually queued songs in Spotify. CrowdCue never starts, pauses, skips, transfers playback, or adds anything to Spotify's playback queue.

Before the first song starts, the first two songs are locked. During playback, the current song and exactly the next song stay locked for everyone, including the host. The queue view displays the current song separately; upcoming position 1 is the locked next song, and upcoming position 2 is editable (third position including current). Guests can vote on unlocked guest requests; hosts can move any unlocked song, including a backup song. The host can remove unlocked guest requests. Requests awaiting approval stay outside the playlist.

Keep at least two upcoming songs after the current song (three total before playback begins). Guest songs take priority over unlocked backup fillers, which they can replace. Rank unlocked guest requests by votes descending, then request time and ID; host ordering overrides ranking until Restore vote/request order. Random eligible backup songs fill shortages, avoiding adjacent repeats when another distinct song is available; a one-song source may repeat. Voting, moderation and ordering changes update the session playlist on the five-second server worker. The current/next pair never moves through CrowdCue controls. Playback observations require the session playlist context; playing unrelated music does not advance its queue. Skips and repeated tracks are detected where observations permit. These observations do not certify complete listens.

Spotify controls playback and may cache its active playback order. Updating the playlist through the API does not guarantee immediate changes to an already loaded playback sequence; this needs live acceptance testing with the host's Spotify client. CrowdCue does not compensate by issuing playback commands.

Only the application-created session playlist is written. The backup source is read-only. Creation uses a durable session marker and searches the host's private playlists after an uncertain acknowledgement before issuing another create request. Writes read actual contents before reconciliation and insert/reorder/remove individual occurrences while preserving the matching history/current/next prefix. Inserts/removals use batches of at most 100 songs and sessions support 10,000 playlist entries. A PostgreSQL host advisory lock serializes workers/start actions; party locks serialize scheduling and playlist synchronization with votes/moderation/reordering. Known failures respect Spotify cooldowns. Only one session per host actively synchronizes. Credentials remain encrypted and server-only.

Ending stops playlist synchronization. The entire playlist stays in Spotify by default, including its remaining songs. CrowdCue never clears, deletes, or removes a session playlist from the library. The ended-session screen explains how the host can remove it manually using Spotify's three-dot menu. Host history/statistics/leaderboard remain available locally; history includes locked/observed songs, not every waiting playlist entry.

Run `npm run db:migrate` for migration **009-session-playlist** (the local launcher applies it automatically). New private session playlists are created at Start, not party creation. Existing queued Spotify songs cannot be removed by CrowdCue; clear them manually before playing the session playlist.

## TV display (task 15)

Open **Open display** from the host’s party links on a TV, projector, or shared browser. `/display/<display-token>` shows the party name, observed Spotify song and album artwork, artists/album, a bounded progress bar, and the first six upcoming CrowdCue songs. Queue rows identify locked songs, backup tracks, and guest vote totals. Pending requests appear only as an approval count; their titles and guest identities are omitted. The footer includes the shareable guest link and joining instructions. The footer also renders the guest joining QR code. A browser full-screen button is provided where supported; it changes presentation only.

`GET /api/party-links/display/:token/snapshot` validates the independent Display token and returns only a public snapshot. Guest/Admin tokens cannot access it. It neither requires a host cookie nor contacts Spotify. Party/settings/queue reads share a party lock, use the same queue ordering policy as the host/guest pages, and return at most six songs plus a `hasMore` flag. Private role links, Spotify credentials, host/guest identifiers, request authors, personal vote selections, backup playlist IDs, nightly playlist links, and host recovery controls are not included. There are no Display mutation endpoints. Responses are uncached, carry no-referrer/noindex headers, and are limited to 300 reads per process/IP/minute.

Run `npm run db:migrate` for migration 007. The server worker caches normalized Spotify observations even before CrowdCue queue delivery is enabled, using its existing host credentials and per-host coordination. An observation is reused by every display; opening extra screens does not trigger additional Spotify calls. Provider reads remain on the five-second worker interval and respect existing retry cooldowns. A locked queue song is never used as proof of the currently playing song. Local/unsupported tracks receive a neutral missing-details state. Paused songs keep their progress; absent playback shows a waiting state. Progress is estimated between observations for at most twenty seconds, without automatically advancing the current song. Provider failure or stale observations retain a clearly labeled last-seen song. Ending a party shows a finished-session screen and saved queue, hides the active join prompt, and does not claim Spotify playback has stopped.

The display uses large, high-contrast type, neutral artwork placeholders, bounded text, safe TV margins, and layouts for widescreen displays, tablets, and phones. WebSockets refresh song/state/queue changes; five-second HTTP polling updates progress and recovers when live connections are unavailable. Failed reads preserve the last snapshot with a reconnection message; a deleted/invalid Display link clears it. No audio or Spotify playback controls are rendered. Production Content Security Policy allows album images only from the approved Spotify image hosts and explicitly allows the configured same-origin WebSocket endpoint. Automated tests cover token isolation, snapshot privacy, shared ranking, playback states, worker observations before queue start, progress, artwork fallback, ended sessions, failure recovery, and presentation-only full screen.

### Task 16 — Admin party controls

Move up / Move down reorder unlocked songs, including backup songs, in the session playlist. Current and next songs are locked for all users. Host order is stored in `playback_entries.manual_position` after session initialization and `song_requests.manual_position` before it. Restore vote/request order removes the override. Mutations require the owning host cookie, private Admin token, strict JSON and same-origin checks. Stale/nonadjacent, locked, pending, removed or foreign targets return 409. Repeated desired-position moves are safe. Ending makes ordering read-only.

## Guest joining QR codes

Active parties show a high-contrast QR code in the host’s party list, Admin invitation section, and TV Display footer. Scan it with a phone camera to open the existing guest joining flow; guests do not need a CrowdCue account. The plain guest URL and copy-link action remain available. Ended parties hide their QR codes, and the TV hides active joining prompts.

QR codes are generated locally as SVG using `qrcode.react`, with a four-module white quiet zone, medium error correction, and responsive sizing. No QR service, extra API endpoint, credentials, or database migration is required. Only valid HTTP(S) Guest URLs are encoded; Admin and Display links are excluded. Independent `jsqr` decoding tests verify that rendered codes resolve to the exact guest URL. Production browser checks verify joining, live ended-state removal, and mobile/tablet/720p/1080p/4K layouts.

## Backup playlist system (task 17)

Save a Spotify playlist URL, URI, or ID in creation or Admin party settings. The host’s Spotify account must be able to read its playable tracks. **Check / refresh backup playlist** in the Spotify session panel checks the saved source immediately, shows its Spotify link and usable-song count, and bypasses the normal one-minute source cache. Checking never starts playback or edits the backup playlist. Save setting edits before checking. Current and next songs stay locked; new source contents apply to future refills. Refills select random eligible tracks from the refreshed source.

Random eligible backup songs fill gaps to keep two upcoming songs, or three before playback starts. Guest requests replace unlocked backup fillers. Current/next remain fixed. Sources are always read-only. Source refresh, filtering, errors and cache invalidation use existing host authorization and party locks.

## Event Spotify playlist and song history (task 18)

Every started session receives a private playlist with the host's chosen name and description. It contains played/current songs followed by the live ranked upcoming list. CrowdCue keeps it after ending and shows instructions for manual removal in Spotify.

**View event song history** opens chronological history in the Admin dashboard; it opens by default after the event ends. Rows include position, cached track metadata, guest/backup source, guest display name when applicable, commitment time, Spotify delivery acknowledgement/uncertainty, and the first observed-playing time when available. Counts distinguish commitments from observed occurrences. Repeats have separate rows. Waiting, pending, rejected and removed uncommitted songs stay out. History remains available after the playlist is removed; it makes no further Spotify calls when read.

Observations use the existing five-second worker polling, matching Spotify track IDs/URIs and using progression/restart signals to associate repeated occurrences. Paused snapshots do not establish observed playback. Observations can be missed, do not prove the entire song was listened to, and do not include unrelated Spotify playback outside CrowdCue’s committed songs. Earlier records are not retroactively marked observed. The history view is a commitment record rather than a guaranteed listening-history audit; the session playlist also contains waiting songs.

Run `npm run db:migrate` for migration **008-event-history**, which preserves existing records and adds nullable observation timestamps plus a history index. `GET /api/party-links/admin/:token/history?offset=0` requires the owning host session and private Admin token, returns at most 50 records with global positions/counts and a next offset, and uses the existing no-store/no-referrer/noindex headers and IP limits. Guest/Display tokens and other hosts cannot access it. WebSockets refresh committed observations/history, with five-second reads as fallback; transient failures retain the last history, while invalid/expired access clears it. No new Spotify scopes are required. Tests cover history ordering/pagination/repeats, guest and backup commitments, paused/skipped observations, restart tracking, authorization/privacy, and UI failure/navigation behavior.

### Task 19: Party statistics

Open **View party statistics** on the admin dashboard for live duration, guest-session participation, request status counts, retained votes/voters, committed guest and backup songs, observed playback, and the top five most-voted songs. The section opens automatically in the ended-session summary; duration stops at party ending and local statistics remain after Spotify playlist removal. Counts update over WebSockets with five-second fallback polling. Guest sessions can represent repeat devices; observed playback/departure does not prove a full listen. Vote totals count currently retained votes (including moderated songs), not lifetime vote clicks. Repeated requests for the same track aggregate in the top-song ranking.

`GET /api/party-links/admin/:token/statistics` requires the owning host cookie and private Admin token, accepts no query parameters, and uses private no-store headers and a bounded read rate. Statistics require no Spotify calls or new database migration.

### Task 20: Guest points and leaderboard

Joined guests and hosts can open **View guest leaderboard** for live scores, tied ranks and score breakdowns. The leaderboard opens in the ended party summary and survives playlist removal. Guests see their own score even outside the top 50. Unnamed guests receive a join-order label; names and scores are shared with joined party guests.

A saved observation of a committed guest song earns **5 points**. Each retained vote from another guest on an approved, queued or played request earns **1 point**. Self-votes, pending/rejected/removed vote points, backup songs, unobserved songs and duplicate submissions earn nothing. Removing a vote removes its point. Queue ordering is unchanged. Scores belong to a party guest session, not a verified person; playback observations do not guarantee full listens. Older unobserved history earns no playback points.

Authenticated `GET /api/party-links/guest/:token/leaderboard` and owner-only `GET /api/party-links/admin/:token/leaderboard` accept no query parameters and use existing read limits/private headers. Both read durable data without contacting Spotify or requiring a migration. No client endpoint can set points.

### Task 21: Security and permissions

Existing server-side role protections are covered across all Admin features, including history, statistics and leaderboard: private Admin links also require the unexpired owning-host cookie. Guest cookies never grant host access; Display URLs are read-only. Origin checks now apply centrally to all unsafe API methods, and browser Fetch Metadata rejects cross-site API requests before handlers. Spotify callback navigation remains allowed with its existing cookie-bound single-use OAuth state. Browsers without Fetch Metadata still use cookies, exact mutation Origin checks and normal role authorization.

Every API response uses private caching/referrer/indexing headers, including errors. CSP and DENY framing protect the interfaces; form redirects allow only this app and Spotify’s OAuth destination; camera/microphone/location/payment/USB permissions are disabled while TV fullscreen remains available. Shared track validation only accepts canonical Spotify track links and approved HTTPS artwork hosts. Default bodies are limited to 4 KiB, with 1 KiB authentication limits and existing smaller route limits. HTTP request/connection timeouts are 15/60 seconds. Forwarded client IP headers are ignored; behind a reverse proxy, per-process/IP limits currently share the proxy address. Configure narrowly trusted proxy addresses only as a reviewed deployment change.

Request/error serializers omit private URLs, query strings, bodies, cookies and raw exception messages/stacks; existing logs record safe operation categories/request IDs. Deployment proxy/access logs must still redact private paths, OAuth codes and cookies. No migration is needed. The production dependency audit at implementation reported zero vulnerabilities; rerun `npm audit --omit=dev` as dependencies evolve.

Spotify sign-in now starts with a same-origin POST accepting JSON, followed by navigation to a validated `https://accounts.spotify.com/authorize` URL. This preserves `no-referrer` privacy and exact Origin checks: Chromium may send `Origin: null` for a plain HTML form under that policy. The response contains only the public authorization URL; the OAuth binding cookie stays HttpOnly and grants remain server-side. The login endpoint retains 303 responses for callers without `Accept: application/json` and requires a valid Origin for either response format. Duplicate browser starts are prevented and failures can retry.

### Public hosting milestone

Prepared: Render Free Blueprint, public-origin defaults, verified PostgreSQL TLS,
persistent generated encryption key and automatic startup migrations. Browser-only
Render/Supabase setup is documented in [DEPLOY.md](DEPLOY.md); no local database
installation is required. Actual hosting and mobile/Spotify acceptance remain
pending provider account setup and callback registration.

### Local setup milestone

Completed: GitHub ZIP / VS Code setup using Node only; bundled persistent PostgreSQL, automatic databases/migrations and encryption key, graceful process cleanup, and bundled database test runner. Original production/external database commands remain supported. Live Spotify acceptance still requires browser consent and the user’s Spotify developer app; no live Spotify writes are used during validation.

### Session playlist migration

Completed: playlist-only sessions, custom playlist metadata, random refill, current/next locking for all roles, editable waiting songs and manual-only removal guidance. Migration 009 preserves historical records and upgrades legacy sessions. Run `npm run test:local` for database integration coverage. Next: live Spotify acceptance testing to verify how the host's client refreshes active playlist playback after changes.
