# CrowdCue — Project Specification

## 1. Product Overview

CrowdCue is a web application for parties, events, and social gatherings that allows guests to search for music, request songs, vote on requests, and influence a shared Spotify session playlist without requiring access to the host's Spotify account.

The host continues using Spotify normally on their phone, computer, speaker, TV, or other playback device. CrowdCue does **not** play audio itself and does **not** manage speaker/device connections.

CrowdCue acts as the collaborative layer between party guests and the host's Spotify account.

The primary goal is to provide a polished, extremely simple guest experience while giving the host control over what ultimately reaches their Spotify session playlist.

---

# 2. Core Product Principles

CrowdCue should be:

- Fast to join.
- Extremely simple for guests.
- Mobile-first.
- Professional and polished.
- Suitable for display on a TV or monitor.
- Secure enough that guests cannot access host/admin functionality.
- Resilient to page refreshes and multiple simultaneous users.
- Designed for real parties with many guests interacting at once.

The interface should feel like a professionally designed consumer product rather than an AI-generated prototype.

Avoid excessive gradients, excessive rounded cards, unnecessary animations, generic dashboard layouts, excessive glassmorphism, and other stereotypical "AI-generated SaaS" design patterns.

Favor strong typography, deliberate spacing, clear hierarchy, restrained use of color, and intuitive interactions.

---

# 3. Application Roles

CrowdCue has three primary interfaces.

## Guest

The Guest interface is what party attendees use from their phones.

Guests should be able to:

- Join a party.
- Enter a display name if required.
- Search Spotify's music catalog.
- Request songs.
- View requested songs.
- Vote on songs.
- See the current queue/request ordering.
- See what is currently playing when Spotify information is available.
- See whether one of their requests has been played, queued, rejected, or removed where appropriate.

Guests must never receive access to Spotify credentials or administrative controls.

---

## Host / Admin

The Host interface controls the CrowdCue session.

The host should be able to:

- Authenticate with Spotify.
- Create/start a party.
- End a party.
- View the current CrowdCue queue.
- View song requests.
- Remove requests.
- Approve requests if approval mode is enabled.
- Reject requests.
- Manually adjust ordering when appropriate.
- View voting activity.
- Configure party settings.
- Access the guest QR code.
- Access the Display interface.
- See Spotify connection/authentication status.
- See the currently playing Spotify track when available.
- Control CrowdCue's behavior without CrowdCue replacing Spotify's normal playback controls.

The admin interface should be designed primarily for the host's phone or laptop.

The dashboard foundation includes Spotify connection status, private role links, editing the party name/request preferences, and confirmed party ending. Only the owning host with the Admin token may mutate a party. Ending is idempotent, preserves Spotify playback, and makes party settings read-only. Request lists and approval/rejection/removal are implemented with song requests. Queue controls, playback status, and QR codes are added with their respective features.

---

## Display

The Display interface is intended for a TV, monitor, projector, tablet, or other shared screen at the event.

It should prominently show information such as:

- Party name.
- CrowdCue branding.
- QR code for joining.
- Short join instructions.
- Currently playing track.
- Album artwork.
- Artist.
- Upcoming/requested songs.
- Vote/request information where appropriate.

The Display interface should automatically update without requiring manual refreshes.

It should be visually useful from several feet away.

The Display interface is read-only.

The implemented TV interface shows the observed Spotify song, artwork, artist/album, paused/idle states, a bounded progress estimate, and six upcoming songs with locked/backup labels, requester display names (or “a guest”), and guest vote totals. Current-song attribution appears only when it matches a tracked playing occurrence; externally played songs do not inherit a requester. Pending requests expose only an approval count. A shared backend observation cache prevents extra Spotify calls per screen; it also observes music before the CrowdCue queue starts. Stale/provider-failed playback is labeled last-seen and never replaced with the locked next song. Ended parties show a finished-session message and saved queue, with no active joining prompt. Display snapshots contain no private links, credentials, host/guest identifiers, personal vote selections, or admin controls. WebSockets and five-second fallback reads keep the page current. Browser full screen is a presentation-only option. Active displays render a locally generated QR code for the guest joining URL.


---

# 4. Spotify Responsibilities

Spotify remains responsible for actual music playback.

CrowdCue must NOT:

- Stream audio.
- Act as an audio player.
- Require the host to select a playback device inside CrowdCue.
- Attempt to connect the host to Bluetooth speakers.
- Replace Spotify's playback interface.
- Store Spotify passwords.

The host should connect Spotify to speakers/devices normally.

CrowdCue communicates with Spotify through the Spotify Web API.

---

# 5. Spotify Authentication

The host must be able to authenticate their Spotify account through Spotify OAuth.

Credentials must be supplied through environment configuration.

Expected configuration includes:

```text
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REDIRECT_URI
```

No Spotify credentials may ever be:

- Hard-coded.
- Logged.
- Printed.
- Returned to the frontend.
- Stored in Git.
- Included in screenshots/debug output.
- Committed to the repository.

OAuth tokens must be stored and handled securely.

Refresh tokens should be used when appropriate so the host does not need to repeatedly authenticate during an active party.

---

# 6. Party Sessions

CrowdCue revolves around a Party Session.

A party should have a persistent unique identifier.

Example conceptual model:

```text
Party
- id
- name
- created_at
- host
- status
- settings
- guest_join_identifier
- admin_identifier
- display_identifier
```

A party can be:

```text
ACTIVE
ENDED
```

Additional states may be added if technically useful.

Party creation belongs to the signed-in Spotify host. The party, initial settings, and role-specific links are saved atomically. Retrying the same creation key with the same normalized details returns the existing party; changing details with that key is rejected. A host can create multiple simultaneous parties.

---

# 7. Party URLs

Each party should expose separate URLs for:

```text
Guest URL
Admin URL
Display URL
```

Example conceptually:

```text
/join/<public-id>

/admin/<secure-id>

/display/<display-id>
```

These examples are illustrative and do not mandate the exact route structure.

## Important Security Requirement

Admin URLs must NOT be trivially derivable from Guest URLs.

For example, this is unacceptable:

```text
/join/1234
/admin/1234
```

Do not rely on simple numeric offsets or reversible transformations.

Use cryptographically random identifiers/tokens.

Admin access requires both the private Admin link and the signed-in owning host. Possessing a Guest or Display link never grants administration. Private link material is encrypted for owner-only recovery after refresh or server restart.

The Display URL should also use an identifier that cannot simply be guessed from the Guest URL.

The Guest URL is intentionally shareable.

The Admin URL is private.

Role pages and APIs must prevent caching and referrer disclosure, discourage search-engine indexing, and reject malformed identifiers without echoing private link material.

---

# 8. QR Code

Every active party should have a QR code representing its Guest URL.

The QR code should be prominently available:

- In the Admin interface.
- In the Display interface.

Scanning the QR code should immediately take a guest to the correct party.

Guests should not need to create CrowdCue accounts.

Implemented after task 16: active host invitations and TV displays render local SVG QR codes for the exact Guest URL, with black/white contrast and a four-module quiet zone. No external QR service receives party links. Admin/Display links cannot be encoded. Plain guest links remain available; ended parties hide QR codes.

---

# 9. Guest Identity

Guests should not need permanent accounts.

A lightweight session-based identity system should be used.

A guest may provide:

```text
Display name
```

The application should assign an internal identifier/session identifier.

Guest identity should persist through ordinary page refreshes when possible.

Guest sessions are party-scoped, last 30 days, and use independent random HttpOnly cookie tokens stored only as hashes. A guest joins explicitly, anonymously when allowed, and can update their name. Required names are enforced server-side. Ended parties retain read-only context and reject joins/name changes. Guest sessions never authorize administration or expose private role links.

---

# 10. Song Search

Guests should be able to search Spotify's catalog.

Search results should include useful information such as:

- Track title.
- Artist.
- Album.
- Album artwork.
- Duration.

Search should feel responsive.

Use debouncing or equivalent techniques where appropriate to avoid unnecessary Spotify API calls.

Never expose Spotify credentials to the browser.

Spotify API requests requiring privileged credentials should go through the backend.

Search requires an active party and a valid party-scoped guest session, including a name when required. The backend resolves the host from the party, refreshes credentials, returns normalized track metadata, and filters disallowed explicit, local, and unavailable tracks. Searches debounce for 400 ms, support bounded pagination, cancel stale browser requests, and provide safe recovery for provider failures and rate limits. Search results link to Spotify; song requests are implemented separately.

---

# 11. Song Requests

Guests can request songs from Spotify search results.

A request should store enough Spotify metadata to display the song without repeatedly fetching basic metadata.

Conceptual model:

```text
SongRequest
- id
- party_id
- spotify_track_id
- track_name
- artist_name
- album_name
- album_art_url
- duration_ms
- requested_by
- created_at
- status
```

Potential statuses include:

```text
REQUESTED
APPROVED
QUEUED
PLAYED
REJECTED
REMOVED
```

Exact implementation may differ if a cleaner model is appropriate.

---

# 12. Duplicate Requests

The same Spotify track should generally not appear multiple times as separate active requests within the same party.

Song request creation accepts only a Spotify track ID and a guest-scoped idempotency key. The backend fetches canonical metadata and revalidates party rules before saving. Active duplicates return the existing request, without automatically voting or changing its author. Required names, explicit-song restrictions, per-guest active limits, and cooldowns are enforced on the server. Requests start pending when approval is required, and approved otherwise. The owning host may approve, reject, or remove pending/approved requests; ended parties are read-only. Guest lists include active requests and their own history. Approval does not itself send a song to Spotify; delivery is a later task.

If another guest attempts to request an already-requested song, the application should direct them toward the existing request and/or treat their action as support for that request.

Avoid cluttering the queue with duplicates.

If a guest attempts to request a song that has already been played during the same party session, the Guest interface should show a confirmation prompt before adding it again. The prompt should say:

```text
This song has been played in this session already, are you sure?
```

The guest should be able to choose Yes or No. Choosing Yes may create a new request for the previously played song. Choosing No should leave the queue unchanged.

---

# 13. Voting

Guests should be able to vote for requested songs.

Voting influences CrowdCue's ordering of requests.

A guest should normally be limited to one active vote per song.

Votes should be associated with the guest/session identity so refreshing the page does not allow unlimited duplicate voting.

The UI should update quickly when votes change.

Guests can add or remove a vote on pending or approved requests, excluding their own. Vote totals and each guest’s selected state persist across refreshes; repeated desired-state mutations are idempotent. The host can disable voting without deleting totals. An active party, unexpired party-scoped guest identity, required name, and enabled voting are checked server-side. Queued/historical requests and ended parties are read-only. Voting never bypasses host approval or automatically sends a track to Spotify. Request boards update after local mutations and remote WebSocket notifications, with five-second polling as a fallback. Vote-based queue ranking is implemented in the live CrowdCue queue. Only approved requests are eligible; pending requests require approval first. Ranking uses votes descending, request time ascending, then request ID for deterministic ties. Disabling voting uses request time and ID without deleting votes. Guest and admin queue snapshots refresh after local mutations and remote WebSocket notifications, retain five-second fallback polling, and preserve read-only context for ended parties. Spotify synchronization uses the session playlist and current/next-two locking described below.

---

# 14. Queue Ordering

CrowdCue maintains its own logical request queue.

The default ordering should primarily consider votes.

When multiple songs have equal vote counts, earlier requests should generally receive priority.

A reasonable default algorithm is:

```text
1. Higher vote count
2. Earlier request time
```

The implementation should be deterministic.

Future ranking logic should be easy to extend without rewriting the entire queue system.

---

# 15. Spotify Session Playlist

The host selects a readable backup Spotify playlist and clicks **Start session** in Admin, choosing a playlist name (defaults to the party name) and description. CrowdCue creates a private session playlist and seeds three randomly chosen eligible backup songs. The host opens **Open session playlist in Spotify** and presses Play on their normal device. The Admin screen shows this link as soon as Spotify confirms a playlist ID, even if filling the playlist fails. Status automatically refreshes every five seconds. Enabling synchronization alone is not confirmation that creation succeeded; missing/uncertain creation and created-but-unsynchronized playlists have distinct messages. **Retry Spotify sync** schedules another worker attempt; **Refresh Spotify status** reads progress, and **Check / refresh backup playlist** only reloads the source songs. Disable Shuffle, Smart Shuffle and Repeat, and clear any old manually queued songs in Spotify. CrowdCue never starts, pauses, skips, transfers playback, or adds anything to Spotify's playback queue.

Before the first song starts, all three seeded songs are locked. During playback, the current song and the next two songs stay locked for everyone, including the host. The queue view displays the current song separately; upcoming positions 1 and 2 are locked and position 3 onward is editable. Guests can vote on unlocked guest requests; hosts can move any unlocked song, including a backup song. The host can remove unlocked guest requests. Requests awaiting approval stay outside the playlist.

Keep at least two upcoming songs after the current song (three total before playback begins). Guest songs take priority over unlocked backup fillers, which they can replace. Rank unlocked guest requests by votes descending, then request time and ID; host ordering overrides ranking until Restore vote/request order. Random eligible backup songs fill shortages, avoiding adjacent repeats when another distinct song is available; a one-song source may repeat. Voting, moderation and ordering changes update the session playlist on the five-second server worker. The current/next-two buffer never moves through CrowdCue controls. Playback observations require the session playlist context; playing unrelated music does not advance its queue. Skips and repeated tracks are detected where observations permit. These observations do not certify complete listens.

Spotify controls playback and may cache its active playback order. Updating the playlist through the API does not guarantee immediate changes to an already loaded playback sequence; this needs live acceptance testing with the host's Spotify client. CrowdCue does not compensate by issuing playback commands.

Only the application-created session playlist is written. The backup source is read-only. Descriptions include the host’s optional text followed by “Playlist created using CrowdCue by Colin Bertrand”; session IDs are not included. Migration 011 stores a baseline of matching owned private playlist IDs before creation. Uncertain creation recovery excludes those older IDs, matches the name and description, and requires a single result; ambiguous results remain unconfirmed for host recovery. Legacy uncertain sessions can still be found by their old marker, and known managed playlists receive the new credit on the worker’s next successful pass, including completed recaps. Writes read actual contents before reconciliation and insert/reorder/remove individual occurrences while preserving the matching history/current/next-two prefix. Inserts/removals use batches of at most 100 songs and sessions support 10,000 playlist entries. A PostgreSQL host advisory lock serializes workers/start actions; party locks serialize scheduling and playlist synchronization with votes/moderation/reordering. Known failures respect Spotify cooldowns. Only one session per host actively synchronizes. Credentials remain encrypted and server-only.

Ending stops playlist synchronization. The entire playlist stays in Spotify by default, including its remaining songs. CrowdCue never clears, deletes, or removes a session playlist from the library. The ended-session screen explains how the host can remove it manually using Spotify's three-dot menu. Host history/statistics/leaderboard remain available locally; history includes locked/observed songs, not every waiting playlist entry.

---

# 16. Backup Source

A backup source is required to start a session and must contain playable Spotify tracks allowed by party settings. It may be selected at creation or later. The source is read through `/items`; local tracks, episodes, unplayable tracks and disallowed explicit songs are filtered. Check / refresh bypasses the one-minute source cache without starting music or modifying the source. Source/policy changes clear refill caches; in-flight results from obsolete settings are discarded. Locked songs remain fixed. Empty/unreadable sources show a host error.

---

# 17. Host Moderation

The host must retain ultimate control.

The architecture should support host actions including:

- Remove request.
- Reject request.
- Approve request.
- Reorder when appropriate.

Task 16 adds authenticated host ordering of unlocked guest songs. Move up/down exchanges adjacent guest slots, preserving every backup slot and all committed buffer songs. The first move stores the current waiting guest order as a host override; votes remain recorded, and newly approved songs rank after the ordered songs until the host restores vote order (or request order when voting is disabled). Overrides apply before playback starts, during Spotify queue delivery, in playlist recovery, and on Guest/TV views. Moves target a specific neighboring request rather than a stale numeric position; nonadjacent, pending, removed, foreign, locked, or backup targets return a conflict. Repeating a move to the same relative position is safe. All ordering changes share the party transaction lock with voting, moderation, settings, ending, and playback locking, and publish committed realtime updates. Ended queues are read-only. UI arrows operate among guest songs on the current 50-song queue page.

CrowdCue should never create a situation where guests have unrestricted control of the host's Spotify account.

---

# 18. Party Settings

The architecture should allow party-specific configuration.

Potential settings include:

```text
Require guest names
Enable/disable voting
Enable/disable request approval
Maximum active requests per guest
Allow/disallow explicit tracks
Request cooldown
Queue behavior
```

Not every setting needs to be implemented immediately.

The architecture should make additional settings straightforward to add.

---

# 19. Real-Time Updates

CrowdCue is a multi-user application.

Changes should propagate to connected clients without requiring constant manual refreshes.

Examples:

- New song request.
- Vote changes.
- Queue ordering changes.
- Request removed.
- Song approved.
- Currently playing track changes.
- Party ended.

WebSockets now send party-scoped refresh notifications to Guest, Admin, and Display pages. Database triggers publish only committed changes through PostgreSQL LISTEN/NOTIFY, including request, vote, moderation, settings, party lifecycle, and playback changes. Each server instance listens independently; no extra message broker is required. Notifications contain only a message type, never identifiers, credentials, private links, or personalized snapshots. Clients then read their existing authorized HTTP endpoints. Guest share links authorize public invalidations; request/queue reads still require the party-scoped guest identity. Display tokens remain read-only; Admin sockets require both the private link and the owning host session. Exact Origin validation prevents cross-site socket use. Connections periodically recheck authorization and heartbeat liveness, have bounded payloads and backlog, and reject all client commands.

The browser opens one socket per role page, batches rapid updates, reconnects with bounded backoff, and reloads snapshots after reconnection or returning online. Existing polling remains a fallback when the socket or database listener is unavailable. The database listener also reconnects and refreshes its connected rooms after a notification gap. Spotify observations remain limited by the backend’s five-second provider polling interval. The TV Display reads its unified snapshot after notifications and on five-second fallback polling, including observed Spotify playback, queue order, party name/state, and joining instructions.

Do not introduce unnecessary infrastructure if a simpler reliable solution satisfies the requirements.

---

# 20. Database

CrowdCue requires persistent storage.

At minimum, the database should support entities representing:

```text
Party
Guest
SongRequest
Vote
Spotify authentication/session information
Party settings
```

Use appropriate foreign keys, uniqueness constraints, indexes, and transactional operations.

The database should protect against:

- Duplicate votes.
- Duplicate active requests.
- Race conditions.
- Invalid party references.

The data model should support multiple simultaneous parties in the future even if early development primarily tests one party.

---

# 21. Backend

The backend is responsible for:

- Spotify OAuth.
- Spotify API communication.
- Party creation.
- Guest sessions.
- Song searching.
- Song requests.
- Voting.
- Queue ordering.
- Host moderation.
- Database operations.
- Security.
- Real-time updates.
- Display data.
- Spotify token refresh.
- Queue synchronization.

The backend should expose a clean API to the frontend.

API endpoints should use appropriate HTTP methods and status codes.

Validate all client input.

---

# 22. Frontend

CrowdCue should have a modern responsive frontend.

The Guest interface is primarily mobile-first.

The Admin interface should work well on both mobile and desktop.

The Display interface should be optimized for large screens.

The frontend should provide clear:

- Loading states.
- Empty states.
- Error states.
- Success feedback.
- Disabled states.

Avoid interfaces that silently fail.

## Shared Loading Feedback

Use the user-provided animated button in `docs/ui/loading-button.reference.txt`
as the visual reference for loading tasks throughout the app. The reference is
preserved as supplied; the reusable implementation lives in
`src/client/LoadingButton.tsx` and uses React, TypeScript, Motion, and plain CSS.

- For asynchronous button actions, use its button-to-circle spinner transition,
  followed by a checkmark and an action-specific completion label on success.
- For loading tasks without a button, reuse the same spinner treatment without
  introducing an extra clickable control.
- Use the app's existing theme colors for backgrounds, borders, text, spinner,
  and success feedback. Replace the reference's hard-coded colors with the
  actual theme tokens; do not introduce a separate palette.
- Drive pending and success states from the real operation, replacing the
  reference's simulated loading timers. Show success only after confirmation.
- Prevent duplicate submissions while pending, and handle failure with clear
  error feedback and a usable retry action.
- Preserve visible keyboard focus, accessible action labels and loading status,
  reduced-motion support, and space for action-specific labels.

---

# 23. Design Direction

CrowdCue should feel like a polished music/event product.

The visual hierarchy should prioritize:

```text
Music
Party
People
Requests
Voting
```

Album artwork can provide much of the application's visual color.

Avoid making every component look like an isolated rounded card.

Avoid unnecessary decorative gradients.

Avoid excessive glowing effects.

Avoid generic AI-generated landing-page aesthetics.

Use consistent:

- Typography.
- Spacing.
- Buttons.
- Form controls.
- Icons.
- Album artwork treatment.
- Navigation patterns.

Interactions should feel intentional.

Mobile interactions should be easy to use one-handed.

## Supplied component patterns

Apply user-supplied component designs only where they support an existing
CrowdCue workflow. Use the shared dark-green, pale-green, text, surface and
border CSS variables for all states. Preserve real operation results,
role authorization, keyboard controls and reduced-motion preferences.

Current placements:

- Inline Action: copy the guest invite link, with real clipboard confirmation
  and failure recovery; retain the shared animated loading button.
- Expandable Profile Card: the joined guest's identity, profile explanation
  and existing name-editing flow. Use their name/initial, not demo portraits.
- Onboarding Checklist: the host session's confirmed backup availability,
  enabled session and created playlist. Clicks do not mark steps complete.
- Wiggling Cards: real party statistics, with a desktop grid and a bounded
  mobile scroll-snap strip with previous/next controls. Keep totals readable.
- UniSwap dialogue pattern: search the host parties already loaded in Your
  parties and open their existing role links. Show the search's loaded-data
  scope and an empty state; do not introduce region or cryptocurrency features.
- Create New Disclosure: host shortcuts to create a party, browse parties and
  view the Spotify connection. Every shortcut performs an existing action.
- Inline Overflow: keep the main moderation action visible and disclose
  secondary actions for unlocked requests. Respect pending and ended states.

The uploaded examples are retained under `docs/ui/*.reference.txt`; adapted
components live in `src/client`. Native dialogs retain modal focus, Escape
handling and focus restoration. No new icon, theme or CSS-framework dependency
is required for these patterns.

---

# 24. Responsive Design

Support at minimum:

```text
Modern mobile browsers
Tablets
Desktop browsers
Large TV/display screens
```

Guest functionality must remain usable on relatively small phones.

Avoid horizontal scrolling except where explicitly appropriate.

---

# 25. Security

Security requirements include:

- Never expose Spotify Client Secret.
- Never commit credentials.
- Validate all backend input.
- Protect Admin endpoints.
- Use cryptographically secure Admin identifiers.
- Do not trust identifiers supplied by the frontend.
- Prevent guests from calling privileged Admin operations.
- Protect against duplicate/replayed actions where relevant.
- Use secure cookie/session configuration in production.
- Avoid leaking OAuth tokens.
- Sanitize user-provided display values.
- Apply reasonable rate limiting to abuse-prone endpoints.
- Do not expose stack traces or internal secrets to users.

Security should be considered during implementation rather than added only at the end.

---

# 26. Environment Configuration

Development and production configuration should use environment variables.

Maintain:

```text
.env.example
```

with variable names but never real values.

Ensure these patterns are ignored by Git:

```text
.env
.env.*
secrets.txt
```

except where an intentionally safe example file such as `.env.example` is explicitly unignored.

---

# 27. Error Handling

CrowdCue should gracefully handle:

- Spotify API unavailable.
- Spotify rate limits.
- Expired Spotify access tokens.
- Failed token refresh.
- Invalid party.
- Ended party.
- Duplicate requests.
- Duplicate votes.
- Database errors.
- Network interruptions.
- Spotify queue failure.
- Invalid/expired Admin link.

Errors shown to users should be understandable and actionable.

Detailed diagnostic information may be logged server-side, but secrets and tokens must never be logged.

---

# 28. Logging

Implement useful structured logging.

Logs should help diagnose:

- Spotify API failures.
- Authentication failures.
- Queue synchronization issues.
- Database errors.
- Application exceptions.

Never log:

```text
SPOTIFY_CLIENT_SECRET
Spotify access tokens
Spotify refresh tokens
Session secrets
Other sensitive credentials
```

---

# 29. Testing

Testing is required throughout development.

Important backend behavior should have automated tests.

Prioritize tests for:

- Queue ordering.
- Duplicate prevention.
- Voting.
- Party authorization.
- Admin authorization.
- Guest sessions.
- Spotify integration boundaries.
- Spotify token refresh.
- Request state transitions.

Spotify API behavior should be mocked where appropriate so tests do not depend entirely on the live Spotify service.

Every major implementation task should run the relevant test suite before being considered complete.

---

# 30. Code Quality

Code should be:

- Modular.
- Typed where supported.
- Readable.
- Documented where logic is non-obvious.
- Organized around clear responsibilities.

Avoid:

- Giant files.
- Duplicated business logic.
- Hard-coded configuration.
- Unnecessary abstraction.
- Premature microservices.
- Placeholder implementations that masquerade as completed functionality.

Prefer a maintainable monolithic application unless there is a strong technical reason to introduce additional services.

---

# 31. Dependency Management

All dependencies must be declared through the project's package/dependency management files.

A fresh development environment should be reproducible from the repository plus required environment variables.

Do not rely on packages manually installed on a developer's computer.

Lock dependency versions where appropriate.

---

# 32. Deployment

CrowdCue should be designed for cloud deployment.

The architecture should support:

- Persistent database storage.
- HTTPS.
- Environment variables/secrets.
- Spotify OAuth callback URLs.
- Multiple simultaneous users.
- Application restart without losing persistent party data.

Deployment-specific configuration should not contaminate core business logic.

The README should eventually contain clear deployment instructions.

---

# 33. Development Workflow

CrowdCue will be developed incrementally.

A recommended implementation sequence is:

1. Initialize application architecture.
2. Create database models and migrations.
3. Implement Spotify OAuth (including secure host authentication sessions).
4. Implement Party creation system.
5. Implement secure Guest/Admin/Display URLs.
6. Implement Admin/Host interface foundation.
7. Implement Guest interface and guest session foundation.
8. Implement Spotify song search.
9. Implement song requests.
10. Implement duplicate prevention and per-guest request limits.
11. Implement voting.
12. Implement CrowdCue queue ordering.
13. Implement Spotify queue integration.
14. Implement real-time WebSocket updates (backup playlist behavior included in task 13).
15. Implement Display interface.
16. Implement admin party controls (host queue ordering, alongside existing settings/moderation).
17. Complete backup playlist system (source checks/refresh and safe replenishment).
18. Complete event Spotify playlist and song history (QR-code joining already completed).
19. Add party statistics (private live totals and ended-session summary).
20. Add guest points and leaderboard features.
21. Add security and permission protections.
22. Perform complete end-to-end testing.
23. Prepare production deployment.

Codex should implement these incrementally rather than attempting to generate the entire application at once.

---

# 34. Autonomous Agent Instructions

During autonomous development, Codex should:

1. Read this specification before implementing relevant features.
2. Inspect existing code before making architectural changes.
3. Preserve working functionality.
4. Make reasonable implementation decisions independently.
5. Avoid asking for clarification about minor engineering choices.
6. Ask for clarification only when a decision materially changes product behavior or conflicts with this specification.
7. Run appropriate tests after changes.
8. Fix failures caused by its changes.
9. Keep the application runnable.
10. Never expose or commit secrets.
11. Update documentation when architecture or setup changes.
12. Avoid implementing unrelated features.
13. Prefer complete working increments over broad unfinished scaffolding.

When a requirement is ambiguous, choose the simplest implementation consistent with the overall product goals and document the decision.

---

# 35. Non-Goals

Unless explicitly requested later, CrowdCue does NOT need:

- AI/LLM features.
- Built-in music streaming.
- Audio playback.
- Bluetooth/speaker management.
- A replacement Spotify player.
- Permanent guest accounts.
- Social-media functionality.
- Complex recommendation algorithms.
- Microservices.
- Native iOS or Android applications.

CrowdCue should remain focused on collaborative Spotify requests for real-world parties.

---

# 36. Definition of Done

The initial CrowdCue product is considered functionally complete when:

A host can authenticate Spotify, create a party, and display a QR code.

A guest can scan the QR code, join the party, search Spotify, request a track, view existing requests, and vote.

Multiple guests can interact with the same party.

CrowdCue correctly orders requests.

Approved/requested music can be synchronized with Spotify according to the application's configured queue behavior.

The host can moderate requests.

A shared Display interface shows the party, currently playing music, join QR code, and relevant queue/request information.

The application survives refreshes and normal network interruptions without corrupting party state.

Credentials remain secure.

The application has meaningful automated tests.

The UI is responsive and polished.

The project can be deployed from documented instructions without relying on undeclared local configuration.

---

# 37. Source of Truth

This file is the primary product specification for CrowdCue.

When implementation decisions conflict with this document, Codex should follow this document unless the user explicitly provides a newer instruction.

Explicit user instructions given during development override this specification.

When requirements change, update this document so future development tasks operate from the latest product definition.

## Task 19 — Party statistics

Owner-only statistics are expandable in the admin dashboard and open automatically after ending. They include duration since party creation (frozen at ending), joined guest sessions including expired sessions, persisted song requests by current status, retained votes and distinct voters, committed guest/backup occurrences and observed-playing occurrences, and the five most-voted Spotify tracks. Ranking aggregates retained votes across repeated requests for a track, includes moderated requests, and breaks ties by earliest request then track ID. Removed votes are excluded; rejected/duplicate attempts are not requests. Guest sessions are not unique-person counts. PLAYED means observed departure, not a full listen. Counts use a consistent database snapshot, update through existing WebSockets/five-second fallback polling, and survive playlist cleanup/restart. Only the owning host session with the Admin token may read them. No additional Spotify calls or schema migration are needed.

## Task 20 — Guest points and leaderboard

Points are party-scoped to the existing guest session. Award 5 points per committed guest-song occurrence with a saved observed-playing timestamp and 1 point per retained vote from another guest on APPROVED, QUEUED or PLAYED requests. Self-votes, pending/rejected/removed request votes, duplicate attempts, backup songs and unobserved commitments earn no points. Removing a vote removes its point; approving a pending request enables its vote points. Scores are derived from durable database records, never accepted from clients, never alter queue ordering, and survive refresh/restart/playlist cleanup. Previous songs without observation timestamps earn no playback points. Spotify observations do not certify full listens.

Joined guests and the owning host can read the top 50 guest sessions and scores; a guest also receives their own rank/score outside the list. Equal scores share competition rank (1,1,3), with display order by join time then internal ID. Anonymous guests use a stable join-order label. Responses contain names, ranks and score breakdowns, never guest IDs, session tokens or private links. Reads require a valid party-scoped guest cookie or owning host session plus Admin token, reject query parameters, and update through existing WebSockets/five-second polling. The leaderboard is expandable during an event and opens after ending. Existing anonymous-session limits apply: changing devices can create another session; this feature does not claim unique-person or anti-collusion verification. No migration or extra Spotify calls are required.

## Task 21 — Security and permission protections

All APIs use no-store/no-referrer/noindex headers, including failures. Browser requests marked cross-site by Fetch Metadata are rejected before handlers (health is public; Spotify OAuth callback is allowed only as a top-level GET navigation when marked cross-site and still requires cookie-bound, single-use state). Every unsafe API method centrally requires the exact configured Origin when authentication is configured, supplementing existing route checks. Role permissions remain server-side: Admin APIs require an unexpired owning-host session plus independent Admin token; guest actions/read-only personalized data require an unexpired party guest session; Display is read-only. No URL or body-supplied account/role/points grants privileges.

CSP forbids framing, object content and base-URL injection, restricts forms to same origin and the Spotify OAuth destination, and retains approved Spotify images and same-origin WebSockets. X-Frame-Options is DENY. Permissions Policy disables camera/microphone/geolocation/payment/USB and permits same-origin fullscreen for the TV display. Track links must match the canonical Spotify ID; artwork must use an approved HTTPS Spotify image host without embedded credentials or nonstandard ports. React continues escaping text rather than interpreting guest names or track titles as HTML.

Default request bodies are bounded to 4 KiB with smaller per-route limits; authentication bodies are at most 1 KiB. Request/connection timeouts are 15/60 seconds. Forwarded addresses are not trusted, preventing client-forged rate-limit identity; deployments should evaluate explicitly trusted proxy addresses rather than enable blanket proxy trust. Automatic request logging is disabled; serializers retain only request ID/method and response status, and scrub raw error messages/stacks. Application logs must not deliberately include credential-bearing data; upstream proxy logs still require deployment redaction. Security regressions cover role/owner/session expiry, cross-site reads/mutations, OAuth redirects, input URL safety, body limits and forwarded-IP spoofing. No migration or credential changes are required.

Spotify sign-in now starts with a same-origin POST accepting JSON, followed by navigation to a validated `https://accounts.spotify.com/authorize` URL. This preserves `no-referrer` privacy and exact Origin checks: Chromium may send `Origin: null` for a plain HTML form under that policy. The response contains only the public authorization URL; the OAuth binding cookie stays HttpOnly and grants remain server-side. The login endpoint retains 303 responses for callers without `Accept: application/json` and requires a valid Origin for either response format. Duplicate browser starts are prevented and failures can retry.

## Public hosting requirement (October 2026)

Public hosting uses a free Render web service and hosted Supabase PostgreSQL;
the user must not need to install PostgreSQL or run CrowdCue on their computer.
The React frontend, Fastify API, WebSockets and Spotify worker remain a single
Node application. The Render Blueprint builds the application, generates a
persistent encryption key, and applies the existing migrations before startup.
The trusted public HTTPS origin supplies all role links and Guest QR URLs.
Database TLS verifies the provider certificate. Supabase's Data API must be
disabled before deployment because only CrowdCue's backend may access private
database records. Use the session pooler for notifications and session locks.
Local execution remains optional; cloud deployment does not import local data.
Repository preparation is complete; actual provider provisioning and live
phone/Spotify acceptance require connected accounts and callback registration.
See `DEPLOY.md` for the browser-only setup and free-plan limitations.

## Local execution requirement (October 2026)

A GitHub branch ZIP opened in a local VS Code folder must run with Node.js 24 and its included npm, without separately installing PostgreSQL, Docker, Python, or database administration tools. `npm ci` installs a pinned bundled PostgreSQL dependency; `npm run local` starts a loopback-only persistent database, creates local databases, applies the existing migrations, generates/reuses the ignored encryption key, and starts the existing frontend/backend. Persistent local data and keys must survive normal restarts. An explicit `DATABASE_URL` continues to select an external PostgreSQL database. Real Spotify features still require the host’s configured Spotify application and OAuth consent. Local automated tests use a separate bundled test database.

## Session playlist milestone (October 2026)

Implemented playlist-only sessions, custom name/description at start, random backups, current/next-two locking, unlocked song ordering, and manual-only playlist removal instructions. Migration 009 adds playlist metadata and entry ordering, switches existing sessions to playlist mode, and releases excess legacy buffer locks. Old manually queued Spotify songs must be cleared by the host in Spotify. Reconnect existing hosts to use the reduced consent scopes: playback read, private playlist write and playlist read; playback/public-playlist write permissions are no longer requested. Automated Spotify writes use mocks.


# 38. UX and playlist reliability update

- Lock the next two upcoming songs for all users. Before playback, lock the initial three songs. Keep at least two upcoming tracks in the actual session playlist; verify provider contents every five-second worker pass, even when the saved local digest is unchanged. Failures retain queue state and retry feedback; provider outages or empty eligible sources cannot guarantee this buffer.
- Hosts can close ended parties from Your parties. This persists `closed_at`, hides the party from normal owner listings, and retains private links, history and Spotify playlist data. Active parties must be ended first. Closing requires the owning host and is idempotent.
- Host home, admin and guest dashboards use selectable menus; desktop sidebars collapse to mobile navigation. Display stays read-only without a sidebar. Search/input state survives menu changes.
- New guests see a welcome screen before the dashboard. Names are enforced when required; otherwise guests explicitly join by name or Continue as guest. Existing valid sessions restore access. Edit Guest Name opens a modal populated with the current name; successful Update closes it. Required-name changes gate restored anonymous sessions again.
- Guests cannot add votes to their own requests. Existing historical self-votes are retained but excluded from ranking/totals/statistics. Guests may remove old votes when the request is otherwise votable.
- Search results show green Song Requested buttons for active requests shared across all guests, refreshed through live revisions and five-second reads. Once a requested song starts playing, it is marked played and becomes requestable again with explicit Yes/No repeat confirmation. Removing or rejecting an active request also releases its button. Backend authorization, confirmation and duplicate prevention remain authoritative.
- Playlist descriptions use dark form styling. A prominent external link appears as soon as a session playlist is created. All manual refresh actions display loading feedback and block repeated clicks until completion; provider actions show working feedback.

Migration 010 adds party dismissal without deleting history. Tests use isolated PostgreSQL schemas and mocked Spotify writes. Live Spotify clients may cache playback order and require host acceptance testing.

### Additional supplied UI patterns

Party setup and settings use controlled switch disclosures and floating-label
fields. Guest voting uses a confirmation/undo presentation tied to persisted
positive votes. Request status filters apply to the current loaded page and are
labeled accordingly. Invite links use clipboard confirmation and failure
recovery. Guests can open an optional feature guide from party details and
expand the actual party rules. Mobile navigation uses the supplied dock
interaction; statistics use manual carousel indicators without autoplay.
Deferred reference components and integration decisions are documented in
`docs/ui/batch-2/README.md`. These visual adaptations preserve existing API
contracts, authorization, save behavior and queue locks.


### Layout and attribution corrections

CrowdCue branding displays the name without a motto. Decorative wave marks are
removed from menu and welcome headings. Functional icons are centered within
controls; shared actions, navigation and disclosures keep visible spacing.
Ended-party Close party actions sit at the right edge of the summary header.
Guest and host queues show requester display names for current and upcoming
songs, use “a guest” when unnamed, and label backup entries “Backup playlist”.
Display exposes requester display names, never guest identifiers or session
credentials. The optional playlist description retains host text and ends with
“Playlist created using CrowdCue by Colin Bertrand”. Migration 011 keeps
creation recovery metadata in the database instead of the public description.


### Reference palette and invitation layout

The shared UI uses #111111 page backgrounds, #000000 card surfaces, #ffffff
card text, #65b32e green accents with #000000 foregrounds, and #bfbfbf secondary
controls/muted text. The CSS theme tokens apply across host, guest and Display
screens; QR codes retain black/white encoding. Green buttons, selected menus and
confirmed votes use black text in normal and hover states.

The Session setup disclosure has no inherited section padding above its header;
its title, chevron, progress bars and completion count align vertically in the
same row. Guest invitations group the QR code, instructions, share URL, copy
confirmation, role links and host reminder inside a black card. Desktop uses
QR/details columns; smaller screens stack them, with long links wrapping.

### Display playback motion

The Display shows circular album artwork with a clockwise vinyl-record animation
and a decorative waveform beside the now-playing status. Animate only when a
track is present, the party is active and the Spotify observation is PLAYING and
fresh. Pause motion when paused, unavailable or stale; ended parties show the
existing completion view. Honor reduced-motion preferences. The waveform is a
visual playback indicator, not measured audio data; Spotify retains playback.
