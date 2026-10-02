# CrowdCue

CrowdCue is a collaborative Spotify party-request application. The application foundation, PostgreSQL database structure, Spotify OAuth authentication, and party creation system are implemented. The guest interface and party-scoped guest sessions are implemented. Spotify song search, song requests with host moderation, and voting are implemented. Spotify queue delivery, a three-song backup buffer, locked-front queue ordering, nightly playlists, recovery, and session closeout are implemented. Product requirements live in [PROJECT_SPEC.md](PROJECT_SPEC.md); contributor instructions live in [AGENTS.md](AGENTS.md).

## Architecture and stack

A TypeScript monolith with React and Vite for the browser and Fastify 5 for the backend. Development runs a Vite server that proxies `/api` to Fastify. Production runs one Node process serving the compiled frontend and API from the same origin. An in-process Spotify worker coordinates through PostgreSQL; no separate worker infrastructure, Redis, or microservices are needed.

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

The requested scopes are `user-read-private`, `user-read-playback-state`, `user-modify-playback-state`, `playlist-modify-private`, `playlist-modify-public`, `playlist-read-private`, and `playlist-read-collaborative`. Existing hosts must reconnect to grant the added playlist scopes. The public playlist modification scope supports Spotify’s unified playlist removal endpoint; nightly playlists are always created private. They support host identification and playback-state, queue delivery, source playlist reads, nightly playlists, and cleanup. Spotify app development-mode access restrictions still apply: use an eligible account allowed by the app configuration. A live browser consent/sign-in is required to confirm provider configuration; automated tests use mocked Spotify responses.

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

Sign out revokes this browser's CrowdCue session. It does not revoke Spotify consent or delete the host's encrypted credentials, so it will not interrupt party workers. The status endpoint reports locally stored credential availability/refresh results; revocation of an otherwise unexpired token is detected on the next Spotify API call. Authentication endpoints do not mutate playback; the separate session worker performs the authorized queue/playlist operations.

Authentication routes have per-process IP rate limits (10 login attempts, 30 callbacks/logout requests, and 60 status requests per minute). Do not trust arbitrary forwarded IP headers. When deploying behind a reverse proxy or across multiple instances, configure trusted proxy handling and shared edge rate limiting as part of deployment hardening. Node's environment proxy support honors configured HTTP/HTTPS proxies and CA trust for backend Spotify calls.

## Party creation

Sign in with Spotify, enter a party name, choose preferences, and click **Create party**. The party becomes ACTIVE immediately. The host receives a guest link to share, a private admin link, and a read-only display link. **Your parties** restores the same links after refresh or a new host login and supports loading older parties, 20 at a time. Hosts may create multiple active parties.

Party creation requires a valid host session and the configured browser Origin; ownership is determined on the server. The creation request writes database records without contacting Spotify. The background worker then creates the private nightly playlist; playback begins only after the host starts the session queue. A previously authenticated host may create a party while Spotify needs reconnection, but playlist creation and playback require valid credentials.

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

Production serves the React entry point at all three role URLs so bookmarked links and page refreshes work. The current role pages show persistent party details and joined guests can search Spotify; QR codes and the full display are later tasks. They poll party state every 15 seconds, with no overlapping requests, so an ended party is reflected on open pages. The owning host can now rename a party, change its request preferences, and end it from the Admin dashboard. Ended parties remain readable and cannot be reopened or edited. Ending a party does not stop Spotify playback.

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

A duplicate active track returns its existing request and directs the guest to **View requests**, without adding a duplicate or voting automatically. The original requester remains the author. A retry of the same guest/key/track returns the saved request even after moderation, with no provider call; reusing a key for a different track returns 409. A fresh attempt may request a previously rejected, removed, or played song again. The frontend prevents overlapping submissions and retains a key after an uncertain failure. After a confirmed success, requesting that song again starts a new intent, which still collapses against any active duplicate.

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

The live CrowdCue queue ranks approved songs by votes. The request list remains newest first; automatic request acceptance still defaults to enabled, and Spotify delivery commits only the locked front song.

## Admin dashboard

Open the private Admin link from **Your parties**. The dashboard shows Spotify connection status, guest sharing, Display access, party name/preferences, and an explicit end-party confirmation. It works on phones and laptops. Saved preferences persist; edits in progress are retained during polling. Refresh the page to reload a draft from another browser. If multiple hosts' browser sessions edit the same party, the last successful save wins.

`POST /api/party-links/admin/:token/settings` accepts the validated party name/settings shape; `POST /api/party-links/admin/:token/end` accepts `{}`. Both require the owning host session, the party's Admin token, the exact configured Origin, and bounded JSON. Mutations are limited to 30 attempts per minute per process/IP. Database row locks serialize settings changes against ending; an ended party rejects edits, while repeated end calls retain the original end timestamp. Public guest/display pages reflect the ended state through their existing polling.

The dashboard includes request lists and approval/rejection/removal. The dashboard includes the live queue, Spotify delivery status, nightly playlist, recovery controls, and an ended-session summary. QR codes and the dedicated Display interface remain separate milestones. Spotify queue delivery is the default; playlist recovery is an explicit host action.

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

The test runner does not load `.env` automatically. Database tests create random isolated schemas and drop only those schemas afterward; the test role needs schema creation privileges. They verify migrations, settings/lifecycle constraints, concurrent duplicate requests/votes, cross-party references, rollback/deletion behavior, OAuth/session behavior, party creation transactions/idempotency, host ownership, role isolation, and link recovery. Frontend tests cover creation preferences, retries, sign-out privacy, link pages, and state polling. Ordinary `npm test` skips database tests when `TEST_DATABASE_URL` is absent; `npm run test:db` fails if it is absent.

The server remains runnable without database configuration when OAuth is disabled; party APIs then report unavailability. The health endpoint reports process liveness, not database readiness. **Spotify session queueing, nightly playlists, and backup recovery are complete. Next milestone: the Display interface.**

Future request/vote updates can use Server-Sent Events with ordinary HTTP mutations; party state, requests, votes, and queue snapshots currently use polling. Multi-instance event delivery and Spotify queue synchronization will need explicit coordination when those tasks begin.

### Dynamic CrowdCue queue

Guest and admin pages show a live, numbered queue, refreshed every five seconds and immediately after local requests, votes, or moderation. Only APPROVED requests enter this queue. Automatic approval remains the default; requests requiring host approval stay outside the queue until approved.

With voting enabled, songs rank by vote count descending, then request time ascending, then request ID for a deterministic tie. With voting disabled, songs follow request time and ID. Votes remain saved when voting is disabled and regain their effect when enabled. Removed, rejected, played, and Spotify-queued requests are excluded. Ending a party retains its queue for read-only viewing.

Authenticated GET endpoints `/api/party-links/guest/:token/queue` and `/api/party-links/admin/:token/queue` return `{ items: [{ position, request }], nextOffset, votingEnabled, status }`. Guest sessions and host ownership are checked server-side. Pages contain up to 50 songs with global positions; `?offset=50` requests the next page. Each response holds a shared party lock while reading settings and ranking songs. Pagination is live: votes can move songs between page loads; refresh or return to the first page to see the current front.

Before starting Spotify queueing, the list ranks approved requests by votes. After starting, it uses the reserved backup slots and immutable locked front described below.

## Spotify sessions, backup buffer, and nightly playlists

Run `npm run db:migrate` to apply migration 005 before starting the updated backend. It preserves existing party/request data and adds playback sessions, entry history, save choices, and delivery markers. **Reconnect Spotify** to grant the additional playlist read/removal scopes. The worker starts with the server when OAuth/database configuration is enabled; tests inject providers and do not start live workers.

1. Create a party and optionally supply a backup Spotify playlist link and **Save the nightly playlist? Yes/No**. Automatic guest request approval still defaults to enabled. A private nightly playlist is created either way.
2. Supply an owned/collaborative playlist containing playable Spotify tracks; an unreadable source or one fully excluded by explicit-track rules cannot fill the buffer. The source cycles when necessary. The source playlist itself is never edited.
3. Start music normally in Spotify on the host’s usual speaker/device, then click **Start CrowdCue queue**. Only one session per host can actively feed Spotify.
4. CrowdCue reserves three backup songs. A guest request joins behind them at position four. Votes change only unlocked guest slots; backup slots retain their place. Only #1 locks and is sent to Spotify. The host can remove/reject guest songs before #1. The next lock occurs after playback advances, and the upcoming buffer is refilled to three.
5. End the party and finish the **Session summary**. Yes at either creation or closeout keeps the nightly playlist. No twice clears it and removes it from the host’s library. Leaving the summary unanswered retains the temporary playlist.

The buffer lives in CrowdCue; Spotify receives only the committed front song. A locked song can no longer be changed in CrowdCue, but network/device failures may still prevent playback. Spotify Premium and active unrestricted playback are required. SENT means Spotify acknowledged the command, not a guarantee the song was heard. Every committed song enters the nightly playlist, including host-skipped songs and repeats. This is a commitment recap rather than a listening-history audit.

The backend polls playback every five seconds independently of connected browsers. It uses durable SENDING/SENT/UNKNOWN markers and a per-host PostgreSQL advisory lock. A timeout, uncertain 5xx response, or crashed worker does not trigger a duplicate queue insertion: UNKNOWN stays stopped and visible. Explicit Spotify rejection can retry safely; 401 refresh is bounded to one retry, 429 honors Retry-After, and transient failures retain session state. Brief playback transitions may be missed; observed queue departures also advance the buffer, and the recovery control remains available when progression is uncertain.

**Playlist recovery:** clear pending manually queued songs in Spotify, confirm that in the dashboard, and choose **Start playlist recovery**. CrowdCue explicitly starts the nightly playlist at the latest locked song. In recovery mode, waiting songs follow the committed history in the playlist, and subsequent requests, votes, and removals synchronize there. Playlist edits do not guarantee Spotify will instantly rebuild playback already underway. Ending removes uncommitted recovery entries from the final saved recap. Queue delivery is disabled in recovery mode to avoid delivering through both paths.

Playlist creation uses `POST /v1/me/playlists`; reading/writing uses `/v1/playlists/:id/items` with at most 100 items per write and a 10,000-song supported session limit. Uncertain creation is recovered by finding the exact session marker on a private playlist owned by the host. Confirming replacement is a deliberate dashboard action. Before appending after an interrupted write, the worker compares actual playlist contents with the desired sequence. Unchanged lists are audited once a minute, and finalized kept sessions stop background work. Spotify’s supported removal is library removal, not permanent deletion: CrowdCue first clears the application-created private playlist, then uses `DELETE /v1/me/library?uris=spotify:playlist:…`. It never clears the backup source.

Authenticated `GET /api/party-links/admin/:token/playback` returns safe delivery/playlist status and summary counts. Same-origin `POST` accepts strict actions `{action:"start"}`, `{action:"retry"}`, `{action:"fallback",confirm:true}`, `{action:"recreate",confirm:true}`, and `{action:"close",save:boolean}`. These actions require the owning host cookie and private admin token; guests cannot control Spotify. Ended sessions accept the summary save decision only. Browser/private APIs use no-store and no-referrer headers. Queue items additionally expose source, locked state, and delivery state; no provider credentials reach browsers.

Automated coverage uses real isolated PostgreSQL schemas and fixture Spotify responses. Live Spotify OAuth consent and playback/device acceptance still require a real host account; passing fixture tests does not establish that Spotify has authorized this app/account in its current quota mode.
