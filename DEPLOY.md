# Public hosting with Render and Supabase

Everything runs in the cloud. You do not need to install Node, PostgreSQL,
Docker, or CrowdCue on your computer. Render serves the app, backend,
WebSockets and Spotify worker together; Supabase stores the data.

## 1. Create the hosted database

1. Create a **Free** project at [Supabase](https://supabase.com/dashboard).
   Use a new project dedicated to CrowdCue and save its database password privately.
2. In the project's **Data API** settings, turn **Enable Data API** off **before
   deploying**. CrowdCue accesses PostgreSQL through its backend, not Supabase's
   browser APIs. This prevents the app's private tables from being exposed by
   auto-generated REST endpoints. Keep it disabled.
3. Click **Connect**, choose **Session pooler**, and copy its PostgreSQL URI.
   It uses port **5432** and a username like `postgres.PROJECT_REF`.
   Replace the password placeholder with your database password; URL-encode
   special password characters. Keep the full URL private.
4. Download the database's root certificate from Supabase's database SSL settings.
   Open that certificate as text and keep its complete PEM contents, including
   `-----BEGIN CERTIFICATE-----` and `-----END CERTIFICATE-----`.

Use **session mode**, not the transaction pooler on port 6543. CrowdCue uses
PostgreSQL LISTEN/NOTIFY and session advisory locks. Direct connections can also
work when IPv6 is available, but the session pooler supports IPv4 on Render.

## 2. Deploy the app

1. Sign in to [Render](https://dashboard.render.com), connect GitHub, and grant
   access to `cbertrand451/CrowdCue`.
2. Choose **New > Blueprint**, select this repository, and choose branch
   **codex/crowdcue-build**. Render reads `render.yaml` from that branch.
3. Confirm the web service has the **Free** plan. This Blueprint creates no paid
   database, worker, disk, or extra service.
4. Enter the four requested environment values:

   | Setting                 | Value                                                                |
   | ----------------------- | -------------------------------------------------------------------- |
   | `DATABASE_URL`          | Supabase **session pooler** URI with the actual password             |
   | `DATABASE_SSL_CA`       | Complete PEM root certificate from Supabase, with actual line breaks |
   | `SPOTIFY_CLIENT_ID`     | Your Spotify developer app client ID                                 |
   | `SPOTIFY_CLIENT_SECRET` | Your Spotify developer app client secret                             |

5. Apply the Blueprint. Render builds the frontend and backend, generates a
   persistent 32-byte encryption key, applies migrations, and starts CrowdCue.
   The web service's public `https://…onrender.com` address is your app URL.

The start command is `npm run start:cloud`; the build command is
`npm ci --include=dev && npm run build`. Migrations run before the server starts
because free Render services do not provide a pre-deploy command. The existing
migration runner serializes simultaneous starts and fails safely on mismatched
migration history. Never run `npm run local` on Render.

`APP_ORIGIN` defaults to Render's `RENDER_EXTERNAL_URL`.
`SPOTIFY_REDIRECT_URI` defaults to that origin plus `/api/auth/spotify/callback`.
Guest, Admin and Display links are generated using that origin; the QR encodes
the Guest URL. Public links do not depend on your laptop being on.

## 3. Register Spotify's public callback

In the [Spotify developer dashboard](https://developer.spotify.com/dashboard),
open your app's settings and add the exact URL:

```text
https://YOUR-ACTUAL-SERVICE.onrender.com/api/auth/spotify/callback
```

Use the real hostname shown by Render. Open CrowdCue at the same HTTPS origin
and choose **Connect Spotify**. Guests joining by QR do not need Spotify
credentials. Spotify's development-mode account restrictions still apply to
hosts signing in.

## 4. Verify public joining

1. Open the public app URL and connect Spotify as the host.
2. Create a new party. Its Guest link should start with the public HTTPS URL.
3. Scan its QR on a phone with Wi-Fi switched off, using mobile data.
4. Join and verify requests/votes update on the host and Display interfaces.
5. Refresh the Guest and Display pages and confirm they still load.

The deployment health endpoint is `/api/health`. It reports server availability;
complete the joining check above to verify database/authentication behavior.

## Data, keys and domains

Render's disk is temporary. All party/session data lives in Supabase. Preserve
Render's generated `TOKEN_ENCRYPTION_KEY` across redeploys and keep a private
backup with the database backup; changing it makes existing encrypted Spotify
credentials and private role links unreadable. Do not recreate the service or
rotate the key casually. Existing key rings remain supported through
`TOKEN_ENCRYPTION_KEYS`, which takes precedence over the single generated key.

Local parties are not automatically copied to Supabase. Start with new parties
on the public site. If importing a local database later, preserve its original
encryption key ring and use it in Render; never overwrite existing cloud data.

For a custom domain, add it in Render and set `APP_ORIGIN` to its HTTPS origin
without a trailing slash. Update any explicit `SPOTIFY_REDIRECT_URI`, register
the matching callback in Spotify, and redeploy. Share the newly generated links
and QR codes. Avoid switching domains during an active party.

## Free-plan limits and troubleshooting

Render's free web service sleeps after 15 minutes without inbound traffic;
the next request can take about a minute to wake it. Spotify synchronization
stops while the server sleeps. Keep the host or Display interface open during
an active party; upgrade the web service if continuous availability is required.
Free compute and database usage limits apply, and Supabase can pause inactive
free projects. There is no local database requirement at any stage.

- **Database connection/startup fails:** verify Supabase is active, the password
  is correct and URL-encoded, and the URI is the session pooler on port 5432.
- **TLS verification fails:** use the correct Supabase root certificate as
  `DATABASE_SSL_CA`. Keep `DATABASE_SSL=true`; do not disable verification.
- **Spotify rejects the callback:** compare the exact URL in Spotify settings
  with the public origin plus `/api/auth/spotify/callback`.
- **QR points to a local address:** clear old local `APP_ORIGIN` and callback
  overrides in Render, redeploy, and get the QR from the public site.
- **Rate limits affect multiple guests:** forwarded IP headers are deliberately
  untrusted, so requests can share the reverse proxy's IP limits. Adjust proxy
  trust only after verifying Render's actual forwarding chain; do not trust
  arbitrary client-supplied headers. Edge rate limiting and access-log redaction
  for private role URLs/cookies/OAuth codes remain hosting hardening tasks.

Provider references: [Render free services](https://render.com/docs/free),
[Render Blueprint settings](https://render.com/docs/blueprint-spec),
[Supabase database connections](https://supabase.com/docs/guides/database/connecting-to-postgres),
[Supabase Data API security](https://supabase.com/docs/guides/api/securing-your-api).
