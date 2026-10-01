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

## Primary Goal

Build CrowdCue incrementally into a secure, reliable, polished Spotify party-request application while requiring minimal supervision from the user.

Each task should leave the repository in a better, working, testable state that the next Codex task can safely continue from.
