# CrowdCue

CrowdCue is a collaborative Spotify party-request application. This milestone provides a runnable application foundation only. Authentication, persistence, parties, requests, voting, and Spotify integration are not implemented yet. Product requirements live in [PROJECT_SPEC.md](PROJECT_SPEC.md); contributor instructions live in [AGENTS.md](AGENTS.md).

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
| `DATABASE_URL`          | Reserved for the next database task; not read yet                                                                         |
| `SPOTIFY_CLIENT_ID`     | Reserved for OAuth; not read yet                                                                                          |
| `SPOTIFY_CLIENT_SECRET` | Reserved server secret; not read yet                                                                                      |
| `SPOTIFY_REDIRECT_URI`  | Reserved OAuth callback URL; not read yet                                                                                 |

Vite does not read the backend `.env` into its configuration. For example, a custom backend port uses `PORT=3001 API_PROXY_TARGET=http://127.0.0.1:3001 npm run dev` on POSIX shells. No Spotify credentials or database connection are required to install, test, or start this foundation.

## Next: database implementation

Plan on **PostgreSQL**, which provides transactions, foreign keys, partial unique indexes, and row locking for concurrent requests and votes. No ORM, database driver, models, or migrations have been introduced. Choose and install a migration/query layer in the database task; place persistence behind backend modules and add transactional integration tests against PostgreSQL. Enforce duplicate prevention in database constraints rather than relying solely on application checks. The health endpoint currently reports process liveness, not database readiness.

Future real-time behavior can use Server-Sent Events from this backend with ordinary HTTP mutations; no real-time functionality is implemented. Multi-instance delivery and Spotify queue synchronization will need explicit coordination when those tasks begin.
