# Running CrowdCue From Scratch

These instructions assume you can see the public GitHub repository and want to run the `codex/crowdcue-build` branch locally.

## 1. Install Prerequisites

Install:

- Git
- Node.js 24 LTS
- npm 11
- PostgreSQL 15 or newer

If you use `nvm`, install the Node version from the repo after cloning:

```sh
nvm install 24
nvm use 24
```

Check your versions:

```sh
node --version
npm --version
git --version
psql --version
```

## 2. Download The Branch

Clone the repository:

```sh
git clone https://github.com/cbertrand451/CrowdCue.git
cd CrowdCue
```

Fetch and switch to the development branch:

```sh
git fetch origin codex/crowdcue-build
git checkout codex/crowdcue-build
```

Confirm you are on the right branch:

```sh
git branch --show-current
```

Expected:

```text
codex/crowdcue-build
```

## 3. Install Libraries

Install the exact locked dependencies:

```sh
npm ci
```

If `npm ci` complains about your Node or npm version, update to Node 24 and npm 11, then rerun it.

## 4. Create Local PostgreSQL Databases

Create one development database and one test database. The exact commands depend on your PostgreSQL setup.

Common local commands:

```sh
createdb crowdcue_dev
createdb crowdcue_test
```

If your PostgreSQL user requires an explicit username:

```sh
createdb -U postgres crowdcue_dev
createdb -U postgres crowdcue_test
```

Example local database URLs:

```text
postgresql://localhost/crowdcue_dev
postgresql://localhost/crowdcue_test
```

If you use a username/password, your URL may look like:

```text
postgresql://USER:PASSWORD@localhost:5432/crowdcue_dev
```

## 5. Create Environment Files

Copy the example file:

```sh
cp .env.example .env
```

Open `.env` and set at least:

```text
NODE_ENV=development
HOST=127.0.0.1
PORT=3000
DATABASE_URL=postgresql://localhost/crowdcue_dev
TEST_DATABASE_URL=postgresql://localhost/crowdcue_test
SPOTIFY_AUTH_ENABLED=false
APP_ORIGIN=http://127.0.0.1:5173
```

Leave Spotify credentials blank for a non-Spotify smoke test.

Important:

- Do not commit `.env`.
- Do not commit `.env.token-key`.
- Do not paste Spotify secrets into GitHub issues, screenshots, or logs.

## 6. Generate The Local Token Encryption Key

Run:

```sh
npm run auth:keygen
```

This creates an ignored `.env.token-key` file. Keep it locally. Do not commit it.

## 7. Run Database Migrations

Apply the schema to your development database:

```sh
npm run db:migrate
```

If this fails, check that:

- PostgreSQL is running.
- `DATABASE_URL` points to an existing database.
- Your database user has permission to create tables and indexes.

## 8. Start The App

Run the frontend and backend together:

```sh
npm run dev
```

You should see two processes:

- `api`, the Fastify backend
- `web`, the Vite frontend

Open:

```text
http://127.0.0.1:5173
```

The API health endpoint is:

```text
http://127.0.0.1:3000/api/health
```

Expected API health response:

```json
{ "status": "ok", "service": "crowdcue" }
```

## 9. Test The UI Without Spotify

With `SPOTIFY_AUTH_ENABLED=false`, the app should still load. This is useful for a basic UI smoke test.

Check:

1. Open `http://127.0.0.1:5173`.
2. Confirm the page loads without a blank screen.
3. Confirm the app reports API connectivity.
4. Confirm Spotify connection controls show that Spotify auth is unavailable or disabled.

Without Spotify auth, you will not be able to complete the full live host flow.

## 10. Enable Spotify For Full Manual Testing

To test the full app with Spotify:

1. Create a Spotify app in the Spotify Developer Dashboard.
2. Add this exact redirect URI:

```text
http://127.0.0.1:5173/api/auth/spotify/callback
```

3. Update `.env`:

```text
SPOTIFY_AUTH_ENABLED=true
SPOTIFY_CLIENT_ID=your_spotify_client_id
SPOTIFY_CLIENT_SECRET=your_spotify_client_secret
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/api/auth/spotify/callback
APP_ORIGIN=http://127.0.0.1:5173
```

4. Restart the dev server:

```sh
npm run dev
```

5. Open:

```text
http://127.0.0.1:5173
```

6. Click **Connect Spotify** and complete Spotify consent.

Spotify development-mode apps may require your Spotify account to be added as an allowed test user in the Spotify dashboard.

## 11. Manual Full-Flow UI Test

After connecting Spotify:

1. Create a party from the host page.
2. Copy/open the Guest link in another browser or private window.
3. Join the party as a guest.
4. Search for a song.
5. Request a song.
6. In the Admin view, approve or moderate the request if approval is enabled.
7. Vote from the guest view.
8. Open the Display link and confirm the party and queue information appear.
9. Test the repeated-song confirmation:
   - Let or mark a requested song reach `PLAYED` during the session.
   - Search for the same song again as a guest.
   - Click **Request song**.
   - Confirm the app shows `Song already played...proceed?`
   - Click **No** and confirm no new request is added.
   - Try again, click **Yes**, and confirm a repeat request is submitted.

## 12. Run Automated Tests

Run the normal test suite:

```sh
npm test
```

Run formatting, linting, type checking, tests, and build:

```sh
npm run check
```

Run database-backed tests:

```sh
npm run test:db
```

Database tests require `TEST_DATABASE_URL`. They create temporary isolated schemas inside the test database and remove them afterward.

## 13. Build And Run Production Locally

Build:

```sh
npm run build
```

Start the production build:

```sh
npm start
```

Open:

```text
http://127.0.0.1:3000
```

For a local production smoke test without Spotify auth, you can run:

```sh
SPOTIFY_AUTH_ENABLED=false npm start
```

## 14. Common Problems

### `npm ci` fails because of Node version

Use Node 24:

```sh
nvm install 24
nvm use 24
npm ci
```

### Database migration fails

Check:

```sh
psql "$DATABASE_URL" -c "select 1;"
```

If that fails, fix the database URL or start PostgreSQL.

### Spotify callback fails

Confirm all three values match the same origin:

```text
APP_ORIGIN=http://127.0.0.1:5173
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/api/auth/spotify/callback
Spotify dashboard redirect URI=http://127.0.0.1:5173/api/auth/spotify/callback
```

Use `127.0.0.1`, not `localhost`, for the local Spotify redirect.

### The frontend cannot reach the API

Confirm the backend is running:

```sh
curl http://127.0.0.1:3000/api/health
```

If you changed `PORT`, also set `API_PROXY_TARGET`, for example:

```sh
PORT=3001 API_PROXY_TARGET=http://127.0.0.1:3001 npm run dev
```

## 15. Stop The App

Press `Ctrl+C` in the terminal running `npm run dev` or `npm start`.
