# Run CrowdCue in VS Code

You need **Node.js 24 LTS**, which includes npm. You do **not** need to install PostgreSQL, Docker, Python, Git, or a database GUI.

## 1. Download the app branch

On [GitHub](https://github.com/cbertrand451/CrowdCue/tree/codex/crowdcue-build), select **codex/crowdcue-build**, then **Code → Download ZIP**. The `main` branch may contain only project documents. Extract the ZIP first; in VS Code choose **File → Open Folder** and select the folder containing `package.json`.

If you prefer Git:

```sh
git clone --branch codex/crowdcue-build https://github.com/cbertrand451/CrowdCue.git
cd CrowdCue
```

## 2. Install and start

Open **Terminal → New Terminal** in VS Code:

```sh
npm ci
npm run local
```

Open **http://127.0.0.1:5173**. Keep the terminal open. Press **Ctrl+C** to stop.

The first install needs internet. npm downloads the app libraries and a PostgreSQL binary for your operating system. There is no PostgreSQL installer or global database service. The app starts/stops its bundled database, creates its schema, and generates a private local encryption key automatically. Later starts reuse your data and key.

Without Spotify credentials the page and health checks work, but Spotify sign-in and party creation are unavailable. There is no simulated live music or bypass of host authentication.

## 3. Connect your Spotify app

Create a Spotify application in the [Spotify Developer Dashboard](https://developer.spotify.com/dashboard). Register this exact redirect URI:

```text
http://127.0.0.1:5173/api/auth/spotify/callback
```

Create a file named `.env` in the repository root (alongside `package.json`). Add your **own** values for the two credentials:

```dotenv
SPOTIFY_CLIENT_ID=your_client_id
SPOTIFY_CLIENT_SECRET=your_client_secret
SPOTIFY_AUTH_ENABLED=true
SPOTIFY_REDIRECT_URI=http://127.0.0.1:5173/api/auth/spotify/callback
APP_ORIGIN=http://127.0.0.1:5173
```

Leave `DATABASE_URL` absent or blank. Do not copy an example PostgreSQL URL; the launcher supplies the private bundled connection automatically. Do not share or commit `.env`, `.env.token-key`, or `data/`.

Restart `npm run local`, open the exact address above, and click **Connect Spotify**. Spotify development-mode apps require an eligible account on the app's allowed-users list; queue features may require Premium. Start music on your chosen device in Spotify normally. CrowdCue does not play audio itself.

CrowdCue requests private playlist modification and playback read permissions. Start session creates a private playlist; press Play in Spotify yourself with Shuffle, Smart Shuffle and Repeat off. Current/next are locked in CrowdCue. Session playlists are kept; manual removal instructions appear after ending. No playback modification or public playlist modification permission is requested, and automated tests never perform live Spotify writes. Reconnect existing hosts after updating.

## 4. Try the existing party flow

1. Connect Spotify, then create a party.
2. Keep the private Admin link in the signed-in host browser.
3. Open the Guest link in another browser/private window and join.
4. Search, request a song, and vote.
5. Use the Admin screen to approve or moderate requests and configure queue behavior.
6. Open the Display link to see the party, joining QR code, and queue updates.

These default URLs work on your laptop only. A phone cannot reach your laptop using `127.0.0.1`. Testing with phones needs a reachable HTTPS origin and matching Spotify callback, frontend listener, and app origin; simply scanning a loopback QR code will not work from another device. Local setup does not publish your app to the internet.

## Data and restarts

Your local party data lives in `data/local/`. OAuth tokens and party links are encrypted using `.env.token-key`. Preserve both together; losing the key makes existing encrypted records unusable. The launcher never overwrites the key or deletes your database on shutdown. Back up these private files only after stopping the app. `data/tests/` is separate test data.

## Tests and checks

```sh
npm run test:local
npm run check
```

`test:local` runs the whole suite with a bundled test database, including persistence/concurrency tests. Spotify responses and write operations are mocked. `check` runs formatting, lint, TypeScript, normal tests, and the production build; database tests in that command skip unless `TEST_DATABASE_URL` is supplied.

To prepare data without starting the UI:

```sh
npm run local:setup
```

## Troubleshooting

- **Node/npm version errors:** install Node 24 LTS, reopen the VS Code terminal, and check `node --version` / `npm --version`.
- **Windows PowerShell blocks npm.ps1:** use the VS Code Command Prompt terminal, or run `npm.cmd ci` and `npm.cmd run local`.
- **Port in use:** stop the other CrowdCue instance. The UI uses 5173, the API 3000, and the bundled database 55432 (tests use 55433). To change the API port, set `PORT` in `.env`; the launcher updates its proxy target. Set `LOCAL_DATABASE_PORT` to change the database port.
- **Database binary missing:** use plain `npm ci` with optional dependencies and install scripts enabled. Do not use `--omit=optional` or `--ignore-scripts`. The binary packages support Windows x64, macOS x64/arm64, and Linux variants; Linux x64 was validated here.
- **Database won't start:** run as a normal user with a writable extracted folder; PostgreSQL cannot run as root. Do not launch from inside the ZIP. Keep the `data` folder and encryption key; after a forced shutdown, close any remaining CrowdCue processes and restart for database recovery.
- **Connect Spotify disabled:** set the credentials and `SPOTIFY_AUTH_ENABLED=true`, then restart.
- **Spotify callback fails:** dashboard redirect, `.env` redirect, and browser origin must match exactly. Use `127.0.0.1`, not `localhost`.

## Existing external database / production setup

If you already have PostgreSQL, set `DATABASE_URL` to that database and `npm run local` uses it without starting a bundled database; it still applies migrations automatically. `TEST_DATABASE_URL` selects a separate external test database for `test:local`.

Existing `npm run dev`, `npm run db:migrate`, `npm run build`, and `npm start` remain unchanged for advanced development and deployment. They do not automatically launch the local bundled database. Production requires an externally managed PostgreSQL database, persistent token encryption keys, and HTTPS OAuth configuration. See [README.md](README.md).
