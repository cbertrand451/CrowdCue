# CrowdCue — Project Specification

## 1. Product Overview

CrowdCue is a web application for parties, events, and social gatherings that allows guests to search for music, request songs, vote on requests, and influence a shared Spotify queue without requiring access to the host's Spotify account.

The host continues using Spotify normally on their phone, computer, speaker, TV, or other playback device. CrowdCue does **not** play audio itself and does **not** manage speaker/device connections.

CrowdCue acts as the collaborative layer between party guests and the host's Spotify account.

The primary goal is to provide a polished, extremely simple guest experience while giving the host control over what ultimately reaches their Spotify queue.

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

The implemented TV interface shows the observed Spotify song, artwork, artist/album, paused/idle states, a bounded progress estimate, and six upcoming songs with locked/backup labels and guest vote totals. Pending requests expose only an approval count. A shared backend observation cache prevents extra Spotify calls per screen; it also observes music before the CrowdCue queue starts. Stale/provider-failed playback is labeled last-seen and never replaced with the locked next song. Ended parties show a finished-session message and saved queue, with no active joining prompt. Display snapshots contain no private links, credentials, host/guest identifiers, request authors, personal vote selections, or admin controls. WebSockets and five-second fallback reads keep the page current. Browser full screen is a presentation-only option. Active displays render a locally generated QR code for the guest joining URL.


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

---

# 13. Voting

Guests should be able to vote for requested songs.

Voting influences CrowdCue's ordering of requests.

A guest should normally be limited to one active vote per song.

Votes should be associated with the guest/session identity so refreshing the page does not allow unlimited duplicate voting.

The UI should update quickly when votes change.

Guests can add or remove a vote on pending or approved requests, including their own. Vote totals and each guest’s selected state persist across refreshes; repeated desired-state mutations are idempotent. The host can disable voting without deleting totals. An active party, unexpired party-scoped guest identity, required name, and enabled voting are checked server-side. Queued/historical requests and ended parties are read-only. Voting never bypasses host approval or automatically sends a track to Spotify. Request boards update after local mutations and remote WebSocket notifications, with five-second polling as a fallback. Vote-based queue ranking is implemented in the live CrowdCue queue. Only approved requests are eligible; pending requests require approval first. Ranking uses votes descending, request time ascending, then request ID for deterministic ties. Disabling voting uses request time and ID without deleting votes. Guest and admin queue snapshots refresh after local mutations and remote WebSocket notifications, retain five-second fallback polling, and preserve read-only context for ended parties. Spotify delivery uses the locked front song and the nightly playlist described below.

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

# 15. Spotify Queue Integration

The host starts music normally on their chosen Spotify device and starts the CrowdCue queue in the admin dashboard. Spotify Premium, an active unrestricted playback device, and host OAuth permissions are required. CrowdCue never streams audio or requires a device picker.

The upcoming queue contains at least three songs in CrowdCue, not three precommitted Spotify queue entries. On initialization, three backup songs reserve the first three positions; a new approved guest request is appended behind them at position four. Backup slots retain their relative position. Votes reorder only unlocked guest slots, with request time and request ID as ties. The server locks the song at position one; it cannot be changed, removed, or voted on. The host can reject/remove an approved guest request until it reaches position one. Approved requests become QUEUED at commitment, then PLAYED after an observed departure; this does not prove a complete listen.

Only the locked front song is handed to Spotify through its queue API. After it begins playing, the next front song locks and is handed over. Playback state and Spotify queue observations detect progress and observed skips; the host remains free to skip or change playback outside CrowdCue. The application maintains a minimum three-song buffer using backup songs whenever guest requests are insufficient. Admission, moderation, refill, and locking are serialized by the party row lock.

Spotify provides no queue idempotency key or remove/reorder endpoint. A durable SENDING marker precedes each queue write, SENT requires an acknowledged command, and a timeout/5xx or interrupted SENDING state becomes UNKNOWN. UNKNOWN writes are never automatically resent. Known rejections can retry after their cooldown, and a rejected 401 can refresh once. A PostgreSQL advisory lock coordinates workers and host actions across processes. Only one CrowdCue session per host may actively feed Spotify. Ended sessions stop feeding the playback queue; already committed Spotify commands cannot be recalled.

A five-second worker runs within the existing server process and continues while the browser is closed. Credentials remain encrypted and server-only. API failure, lack of active playback, or an unreadable/empty backup source may prevent playback; the dashboard must show the failure and saved queue rather than claim a guaranteed listen. Browser queue/status views refresh on WebSocket notifications and retain five-second fallback polling.

---

# 16. Backup Source and Nightly Playlist

Each session has two distinct playlist roles:

- **Backup source:** an existing Spotify playlist owned by the host or available to them as a collaborator. The host supplies its link at creation or later in settings. Playable Spotify tracks are read through the current `/items` endpoints, respect the explicit-song setting, and cycle to replenish the queue. Locked and already reserved slots remain stable. Task 17 adds a host-only Check / refresh action and a usable-track count before or during queue operation. Refresh bypasses the one-minute provider cache without starting playback or editing the source playlist. Source or explicit-policy edits clear cached refill tracks and reset the cursor; in-flight reads from outdated settings are discarded. Existing reserved slots remain unchanged, and future refills use the updated source. Adjacent repeats are avoided even when a source contains duplicate entries; a single usable song may repeat to maintain the three-song buffer. Empty/unreadable sources show a host error rather than pretend the buffer can be guaranteed.
- **Nightly playlist:** an application-created private playlist in the host's Spotify account, created regardless of the initial save choice. Every song locked for commitment enters this playlist in commitment order, including backup songs, repeated songs, and songs later skipped in Spotify. It is a record of committed songs rather than guaranteed completed listens. Pending/rejected/removed requests are excluded during normal queue operation.

The host answers Yes/No to saving the nightly playlist at creation and again on the ended-session summary. The initial decision is immutable. Any Yes keeps the playlist. Two No decisions clear the temporary playlist and remove it from the host's Spotify library only after the second choice. If the summary has not been answered, retain the playlist. Spotify has no permanent-delete API: clearing and removing it from the library is the supported cleanup. Local session history remains intact. Task 18 adds a private host history view, expandable during the event and open in the ended summary. It lists committed guest and backup songs in the same order as the event playlist, preserving repeated occurrences. First observed-playing timestamps come from existing Spotify polling of matching Spotify tracks; paused/unobserved/skipped entries are not retroactively labeled listened. Playback observations are best-effort and never certify completion of a song. Earlier commitments upgraded from before observation tracking retain a null observation timestamp. History excludes waiting/pending/rejected/removed uncommitted songs, is paginated at 50 rows, updates through existing WebSockets/polling, and remains readable after recap cleanup. Guest/Display tokens cannot read host event history.

Private playlist creation uses a durable marker before its non-idempotent POST. Uncertain creation searches the host's library for the exact session marker and never blindly repeats creation. The host may explicitly confirm replacement after checking Spotify. Playlist writes reconcile current contents before appending, use ordered batches of at most 100, and support up to 10,000 committed songs. Interrupted writes can resume without blindly duplicating an append. Final synchronization/cleanup retries safely and respects Spotify cooldowns.

If queue delivery fails, the host can use the nightly playlist as recovery. The dashboard requires them to clear outstanding manually queued songs in Spotify before explicitly starting recovery. CrowdCue switches to playlist mode, updates the playlist with the committed history followed by the current waiting queue, and starts it at the latest locked song via Spotify's playback API. It never silently starts playback or repeatedly retries an uncertain playback-start command. New requests and vote changes continue updating the playlist. Spotify may not immediately rebuild its active playback order when playlist contents change; CrowdCue does not promise otherwise. Once the session ends, remove uncommitted recovery entries before retaining the final recap.

Playlist operations use host credentials resolved from verified parties. Save/cleanup/recovery controls require the owning host session, private admin token, same-origin POST, strict input validation, and rate limits. New playlist read/removal scopes require existing hosts to reconnect Spotify. The TV Display interface reads cached observations and the same CrowdCue ordering through its independent read-only snapshot.

---

# 17. Host Moderation

The host must retain ultimate control.

The architecture should support host actions including:

- Remove request.
- Reject request.
- Approve request.
- Reorder when appropriate.

Task 16 adds authenticated host ordering of unlocked guest songs. Move up/down exchanges adjacent guest slots, preserving every backup slot and locked #1. The first move stores the current waiting guest order as a host override; votes remain recorded, and newly approved songs rank after the ordered songs until the host restores vote order (or request order when voting is disabled). Overrides apply before playback starts, during Spotify queue delivery, in playlist recovery, and on Guest/TV views. Moves target a specific neighboring request rather than a stale numeric position; nonadjacent, pending, removed, foreign, locked, or backup targets return a conflict. Repeating a move to the same relative position is safe. All ordering changes share the party transaction lock with voting, moderation, settings, ending, and playback locking, and publish committed realtime updates. Ended queues are read-only. UI arrows operate among guest songs on the current 50-song queue page.

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
19. Refine professional responsive UI.
20. Harden security and error handling.
21. Expand automated testing.
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
