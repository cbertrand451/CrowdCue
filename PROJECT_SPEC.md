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

CrowdCue should integrate approved/requested tracks with the host's Spotify queue when Spotify API capabilities permit it.

The backend should handle Spotify queue operations.

The system must avoid repeatedly adding the same track because of retries, refreshes, duplicate workers, or race conditions.

Queue synchronization should therefore be idempotent where possible.

If Spotify rejects an operation, CrowdCue should handle the error gracefully rather than corrupting the internal queue state.

---

# 16. Backup Playlist

CrowdCue should support a Spotify playlist associated with the party as a backup/fallback mechanism when appropriate.

The playlist can contain approved/requested songs so that the party has a persistent Spotify representation of the CrowdCue requests.

The exact interaction between direct Spotify queue insertion and the backup playlist should be implemented conservatively to avoid duplicate playback.

The Spotify queue should be preferred when technically appropriate.

---

# 17. Host Moderation

The host must retain ultimate control.

The architecture should support host actions including:

- Remove request.
- Reject request.
- Approve request.
- Reorder when appropriate.

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

Use an appropriate real-time strategy such as WebSockets, Server-Sent Events, or efficient polling based on the chosen deployment architecture.

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
10. Implement voting.
11. Implement CrowdCue queue ordering.
12. Implement Spotify queue integration.
13. Implement backup playlist behavior.
14. Implement Display interface.
15. Implement QR-code joining.
16. Finalize secure Admin/Display URLs.
17. Implement party controls/settings.
18. Refine professional responsive UI.
19. Harden security and error handling.
20. Expand automated testing.
21. Perform complete end-to-end testing.
22. Prepare production deployment.

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
