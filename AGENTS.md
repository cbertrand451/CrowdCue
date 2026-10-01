# CrowdCue — Codex Agent Instructions

## Project Context

CrowdCue is a collaborative Spotify party-request application.

Before implementing or modifying product functionality, read:

1. `PROJECT_SPEC.md`
2. `README.md`
3. Existing relevant source code and tests

`PROJECT_SPEC.md` is the primary source of truth for product behavior.

Explicit instructions from the user override this document and `PROJECT_SPEC.md`. When a user instruction materially changes the product, update the relevant documentation.

---

## Development Mode

CrowdCue may be developed through short voice-directed tasks while the user is traveling and unable to inspect code.

Operate autonomously.

Do not stop to ask about minor implementation decisions. Choose a sensible, maintainable solution consistent with `PROJECT_SPEC.md`.

Only request clarification when:

- Requirements materially conflict.
- A decision would substantially change product behavior.
- Required credentials/infrastructure are unavailable.
- Continuing could cause destructive or irreversible changes.
- A critical security decision cannot safely be inferred.

Otherwise, proceed.

---

## Task Workflow

For every development task:

1. Read the relevant specification and existing implementation.
2. Determine the smallest complete implementation that satisfies the task.
3. Implement the feature completely.
4. Preserve existing working functionality.
5. Add or update tests where appropriate.
6. Run relevant tests.
7. Run linting, formatting, type checking, and build validation where configured.
8. Fix failures caused by the changes.
9. Verify the application remains runnable.
10. Update documentation when necessary.
11. Summarize the completed work concisely.

Do not leave obvious errors for the user to discover later when they could reasonably be detected automatically.

---

## Completion Reports

After each task, provide a concise report containing:

- What was implemented.
- Important implementation decisions.
- Tests/checks performed and whether they passed.
- Any remaining limitation or blocker.
- What is ready to be implemented next.

Do not overwhelm the user with file-by-file descriptions unless they are relevant.

---

## Scope Discipline

Implement the task the user requested.

Do not attempt to build the entire remaining product during every task.

However, make reasonable supporting changes necessary to implement the requested feature correctly.

Do not add unrelated features simply because they might be useful.

Do not introduce AI/LLM functionality unless explicitly requested.

---

## Architecture

Prefer a maintainable monolithic architecture unless the existing project or a specific technical requirement justifies something more complex.

Favor:

- Clear separation of concerns.
- Small focused modules.
- Reusable business logic.
- Explicit data models.
- Typed interfaces where supported.
- Centralized configuration.
- Consistent error handling.
- Testable Spotify integration boundaries.

Avoid:

- Premature microservices.
- Giant files.
- Duplicated business logic.
- Excessive abstractions.
- Unnecessary dependencies.
- Hard-coded configuration.
- Placeholder implementations presented as complete features.

Before making major architectural changes, inspect the existing architecture and preserve established patterns unless there is a strong reason to change them.

---

## Spotify Responsibilities

Spotify handles actual music playback.

CrowdCue must NOT:

- Stream audio.
- Become an audio player.
- Manage Bluetooth speakers.
- Require the host to select a Spotify playback device through CrowdCue.
- Replace Spotify's normal playback controls.

The host continues using Spotify normally on their chosen device/speaker.

CrowdCue manages requests, voting, party state, moderation, queue logic, and Spotify API integration around that playback.

---

## Spotify Configuration

Expected environment configuration includes:

```text
SPOTIFY_CLIENT_ID
SPOTIFY_CLIENT_SECRET
SPOTIFY_REDIRECT_URI
```

Use environment configuration rather than hard-coded values.

Never assume credential values.

Never generate fake production credentials.

---

## Secret Handling

Security of credentials is mandatory.

Never:

- Print secrets.
- Log secrets.
- Commit secrets.
- Hard-code secrets.
- Return secrets through API responses.
- Send secrets to frontend code.
- Include secrets in documentation.
- Include secrets in screenshots.
- Include OAuth access or refresh tokens in diagnostic output.

This includes:

- `SPOTIFY_CLIENT_SECRET`
- Spotify access tokens
- Spotify refresh tokens
- Session secrets
- Database credentials
- Deployment credentials
- Any future API credentials

Files containing local credentials must remain ignored by Git.

At minimum, ensure appropriate handling for:

```text
.env
.env.*
secrets.txt
```

A safe `.env.example` containing variable names without values may be committed.

Before committing changes, check that no credentials or tokens have accidentally entered the diff.

---

## Spotify API

Spotify API communication requiring privileged credentials must occur through trusted backend code.

Never expose the Spotify Client Secret to browser code.

Handle:

- Access-token expiration.
- Refresh tokens.
- Spotify API errors.
- Rate limits.
- Authentication failures.
- Network failures.
- Queue-operation failures.

Spotify integration code should be isolated enough that automated tests can mock external Spotify behavior.

Do not make the entire test suite depend on the live Spotify API.

---

## Database

Database changes should use the project's migration system when one exists.

Maintain:

- Referential integrity.
- Appropriate uniqueness constraints.
- Useful indexes.
- Transaction safety where necessary.

Pay particular attention to preventing:

- Duplicate votes.
- Duplicate active requests.
- Race conditions.
- Invalid party references.
- Repeated Spotify queue insertion.

Do not destroy existing persistent data unless explicitly instructed.

---

## Security

Treat all frontend/client input as untrusted.

Protect administrative operations on the backend.

Guest identifiers must never grant Admin privileges.

Admin and Display identifiers should not be trivially derivable from Guest identifiers.

Use cryptographically secure identifiers where security depends on unpredictability.

Validate user input.

Apply authorization checks server-side.

Use secure session/cookie configuration in production.

Do not rely solely on hidden UI controls for authorization.

---

## Real-Time Behavior

CrowdCue is a multi-user party application.

When implementing functionality involving:

- Requests.
- Votes.
- Queue changes.
- Moderation.
- Currently playing music.
- Party state.

Consider how changes propagate to other connected Guest, Admin, and Display clients.

Use the simplest reliable real-time mechanism supported by the architecture.

Avoid unnecessary infrastructure.

---

## Frontend Quality

CrowdCue should look like a professionally designed consumer music/event product.

Avoid stereotypical AI-generated UI patterns.

In particular, avoid overusing:

- Gradients.
- Glassmorphism.
- Glowing elements.
- Excessive rounded cards.
- Generic dashboard cards.
- Decorative animations.
- Huge hero sections.
- Excessive explanatory copy.

Prefer:

- Strong typography.
- Deliberate spacing.
- Clear hierarchy.
- Restrained color.
- Album artwork as a natural source of visual color.
- Consistent controls.
- Purposeful animation.
- Clean mobile interactions.

Guest pages are mobile-first.

Admin pages must work well on phones and desktops.

Display pages must work well on large screens viewed from a distance.

Do not sacrifice usability for visual novelty.

---

## Responsive Design

Test important interfaces at representative:

- Mobile widths.
- Tablet widths.
- Desktop widths.
- Large Display/TV widths when relevant.

Avoid unintended horizontal scrolling.

Primary Guest interactions should be easy to perform on a phone.

---

## Testing Expectations

Add meaningful automated tests as features are implemented.

Prioritize coverage for business-critical behavior, including:

- Party creation.
- Guest sessions.
- Admin authorization.
- Song requests.
- Duplicate-request prevention.
- Voting.
- Duplicate-vote prevention.
- Queue ordering.
- Request state transitions.
- Spotify integration boundaries.
- Spotify token refresh.
- Queue synchronization.

A task should not be considered complete merely because the code compiles.

Run the most relevant available validation commands.

When feasible, run the broader test suite before completing substantial changes.

---

## Dependency Management

Declare all dependencies in the project's dependency-management files.

Do not rely on packages installed manually on a developer's computer.

Prefer established, actively maintained libraries.

Avoid adding dependencies for trivial functionality that can be implemented safely and clearly without them.

Keep dependency versions reproducible through appropriate lockfiles.

---

## Error Handling

User-facing errors should be understandable.

Do not expose:

- Stack traces.
- Internal implementation details.
- Credentials.
- Tokens.
- Sensitive database information.

Server-side logging may contain useful diagnostic context but must never contain secrets.

Handle expected external-service failures gracefully.

---

## Git Practices

Keep changes focused on the requested task.

Before considering a task complete:

- Inspect the resulting diff.
- Ensure no credentials are present.
- Ensure generated junk files are not being committed.
- Ensure dependency lockfiles are included when appropriate.
- Ensure migrations are included when database models changed.

Do not rewrite Git history, force-push, delete branches, or perform other destructive Git operations unless explicitly instructed.

Do not delete existing functionality merely to simplify implementation.

---

## Development Priorities

When tradeoffs are necessary, prioritize in this order:

1. Security and credential protection.
2. Correctness.
3. Data integrity.
4. Reliability.
5. User experience.
6. Maintainability.
7. Performance.
8. Development convenience.

Do not knowingly compromise security or correctness to finish a task faster.

---

## Handling Problems Autonomously

When an implementation attempt fails:

1. Diagnose the failure.
2. Inspect relevant logs/errors.
3. Attempt a reasonable fix.
4. Re-run validation.
5. Try reasonable alternative approaches if necessary.

Do not immediately stop and ask the user to solve ordinary development problems.

If blocked by infrastructure, credentials, permissions, or an external service, clearly report:

- What failed.
- What was attempted.
- Why progress is blocked.
- The specific action the user needs to take.

Never expose secret values while reporting a configuration problem.

---

## Long-Running Development

Maintain the repository in a state where another Codex task can continue development without relying on undocumented conversational context.

Important architectural or product decisions should be reflected in:

- Code.
- Tests.
- `PROJECT_SPEC.md`
- `README.md`
- Other appropriate project documentation.

Do not rely on the current conversation as the only record of important implementation decisions.

---

## Source of Truth Priority

When determining intended behavior, use this priority:

1. The user's latest explicit instruction.
2. `PROJECT_SPEC.md`
3. This `AGENTS.md`
4. Existing tests and documented behavior.
5. Existing implementation.
6. Reasonable engineering judgment.

If a newer user instruction changes an existing requirement, implement the newer instruction and update the appropriate documentation.

---

## Branch Policy

During autonomous development, work on the designated development branch rather than `main`.

For the current build:
- Development branch: `codex/crowdcue-build`
- Do not push implementation changes directly to `main`.
- Do not merge into `main` unless explicitly instructed by the user.
- Commit completed, tested milestones to the development branch.
- Before beginning a new task, verify the current branch.

---

## Spotify Account Safety

Protect the user's personal Spotify account from unintended modification.

CrowdCue must follow least-privilege Spotify authorization.

Unless explicitly authorized by the user, NEVER request or use:

- user-library-modify
- user-follow-modify
- playlist-modify-public
- playlist-modify-private
- ugc-image-upload

Never modify or delete:

- Saved/liked songs
- Saved albums
- Followed artists/users
- Existing playlists
- Existing playlist contents
- Playlist metadata
- Other persistent Spotify library data

Never use destructive Spotify API operations during development or testing.

Do not test Spotify write operations against the user's existing playlists or library.

### Playback Permissions

CrowdCue may eventually request:

- user-read-currently-playing
- user-read-playback-state
- user-modify-playback-state

`user-modify-playback-state` should only be used for functionality
explicitly required by CrowdCue.

For the initial product, its intended write operation is adding approved
tracks to the Spotify playback queue.

Do NOT use it to:

- Skip tracks
- Pause playback
- Start playback
- Seek
- Change volume
- Toggle shuffle
- Change repeat mode
- Transfer playback between devices

unless the user explicitly adds those capabilities to the product.

### Development Safety

Prefer mocked Spotify API responses during automated testing.

Live Spotify write operations must not be used in automated tests.

Read-only live Spotify API calls may be used when appropriate.

Before implementing any new Spotify functionality that requires an
additional write scope, report the required scope and its capabilities
to the user before adding it.

---

## Spotify Playlist Safety

During development, Spotify playlists are READ ONLY.

Allowed scopes:
- playlist-read-private
- playlist-read-collaborative

Do NOT request:
- playlist-modify-private
- playlist-modify-public

CrowdCue may:
- List playlists
- Read playlist metadata
- Read playlist contents
- Select and store a backup playlist ID
- Compare CrowdCue tracks against playlist contents
- Implement playlist synchronization logic behind an abstraction
- Mock playlist writes in automated tests

CrowdCue must NOT make live Spotify API calls that:
- Add playlist items
- Remove playlist items
- Replace playlist contents
- Reorder playlist items
- Rename playlists
- Change playlist metadata
- Create playlists
- Follow/unfollow playlists

Implement playlist-writing functionality behind a dedicated service
interface so write operations can be enabled later.

All playlist write operations must be mocked or disabled during
development.

Future playlist write access must be restricted to the single Spotify
playlist ID explicitly designated as CrowdCue's managed backup playlist.

Never modify any other Spotify playlist.

Do not add Spotify playlist modification scopes without explicit user
approval.

---

## Development Order

Use the following as the backup default development sequence for CrowdCue. This is to be referenced when the user is lost on what the next step is, or if more context is needed to understand the task at hand. 

Complete, test, and validate each stage before proceeding to the next stage. Do not automatically begin the next major stage unless instructed by the user. If the user says "continue," "next step," or equivalent, proceed to the next incomplete stage in this list.

If a stage has already been completed, verified, and committed, do not repeat it.

1. **Initialize Project**
   Establish the application architecture, dependencies, configuration, development tooling, testing, linting, type checking, `.gitignore`, `.env.example`, basic application entry points, initial README, and health checks.

2. **Build Database Foundation**
   Implement the database architecture, models, relationships, constraints, migrations, and tests required by `PROJECT_SPEC.md`.

3. **Build Party & Session System**
   Implement party creation, party state, secure identifiers, guest sessions/identity, party joining, and associated backend APIs.

4. **Implement Spotify Authentication**
   Implement Spotify OAuth, token storage, refresh handling, required read-only scopes, authentication state, and Spotify service abstractions. Follow all Spotify Account Safety rules in this file.

5. **Build Admin Foundation**
   Create the initial Host/Admin interface, authentication/authorization protection, party overview, party status, and navigation required for future host controls.

6. **Build Guest Foundation**
   Create the mobile-first Guest experience, party joining flow, guest identity/name handling, and basic party interface.

7. **Implement Spotify Search**
   Allow guests to search Spotify's catalog through the backend. Implement track results, metadata, artwork, debouncing/caching where appropriate, error handling, and tests.

8. **Implement Song Requests**
   Allow guests to request Spotify tracks. Implement request persistence, request statuses, duplicate prevention, request history/state, and corresponding Guest/Admin UI.

9. **Implement Voting**
   Allow guests to vote on active requests. Prevent duplicate votes and ensure vote state survives ordinary refreshes.

10. **Implement CrowdCue Queue Logic**
    Implement deterministic request ordering using votes and request time according to `PROJECT_SPEC.md`. Keep queue-ranking logic isolated and testable.

11. **Implement Spotify Playback Queue Integration**
    Connect approved CrowdCue requests to Spotify's playback queue using the minimum required Spotify permissions. Implement idempotency, failure handling, retry safety, and synchronization. Do not implement unrelated Spotify playback controls.

12. **Build Backup Playlist System — Read Only**
    Implement the backup-playlist architecture, playlist selection, playlist metadata/track reading, storage of the selected playlist ID, comparison logic, and mocked write operations. Do NOT enable live playlist modification or request playlist modification scopes.

13. **Build Display Interface**
    Create the large-screen Display experience showing party information, currently playing music where available, album artwork, requests/upcoming music, CrowdCue branding, and join information.

14. **Implement QR-Code Joining**
    Generate and display party-specific QR codes that send guests directly to the appropriate Guest interface. Make QR codes available through Admin and Display interfaces.

15. **Finalize Secure URLs & Authorization**
    Audit Guest, Admin, and Display identifiers/routes. Ensure Admin identifiers cannot be derived from Guest URLs and that privileged operations are protected server-side.

16. **Implement Party Controls & Settings**
    Add appropriate host controls and configurable party behavior described in `PROJECT_SPEC.md`, while keeping the interface straightforward.

17. **Implement Real-Time Synchronization**
    Ensure requests, votes, queue changes, moderation actions, currently-playing information, and party-state changes propagate appropriately between Guest, Admin, and Display clients without manual refreshes.

18. **Refine Complete UI/UX**
    Perform a dedicated design pass across Guest, Admin, and Display interfaces. Make CrowdCue feel like a polished professional consumer music/event product. Follow the frontend-quality requirements in this file and avoid stereotypical AI-generated UI patterns.

19. **Security & Reliability Audit**
    Review authentication, authorization, sessions, Spotify permissions, input validation, rate limiting, secret handling, error handling, race conditions, database integrity, and external API failure behavior. Fix discovered issues.

20. **Expand Automated Testing**
    Add or improve unit, integration, and appropriate end-to-end tests for critical CrowdCue workflows. Spotify write operations must remain mocked where required by the Spotify safety rules.

21. **Full End-to-End Validation**
    Test the complete CrowdCue workflow from host party creation through guest joining, Spotify search, requests, voting, queue behavior, Admin moderation, Display updates, and party termination. Diagnose and fix failures.

22. **Prepare Deployment**
    Finalize production configuration, environment-variable documentation, database deployment/migrations, build commands, Spotify redirect configuration requirements, HTTPS assumptions, startup procedures, and deployment documentation.

23. **Final Code & Documentation Review**
    Remove dead code, temporary development artifacts, TODOs that should be resolved, debugging output, and unnecessary dependencies. Verify README and project documentation accurately describe the final application.

24. **Prepare for User Acceptance Testing**
    Leave the development branch in a clean, runnable, tested state so the user can pull it locally, run CrowdCue, visually inspect the application, test it with their Spotify account, and identify final changes before merging into `main`.

### Progress Tracking

Maintain a concise development progress section in the repository so another Codex task can determine which stages above are complete, in progress, blocked, or not started.

After completing a major stage:

- Run relevant validation.
- Fix failures attributable to the implementation.
- Update progress documentation.
- Commit the completed milestone to `codex/crowdcue-build`.
- Never merge into `main` unless explicitly instructed.
- Report the completed stage and the next recommended stage to the user.

When the user asks "what's next?" or instructs Codex to "continue," consult this list and proceed with the next incomplete stage.

---

## Primary Goal

Build CrowdCue incrementally into a secure, reliable, polished Spotify party-request application while requiring minimal supervision from the user.

Each task should leave the repository in a better, working, testable state that the next Codex task can safely continue from.
