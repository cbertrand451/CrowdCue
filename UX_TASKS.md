# CrowdCue UX and reliability tasks

Each task includes implementation and regression coverage. Status: implemented and validated on `codex/crowdcue-build`.

- [x] CC-01 Lock the next **two** songs for all roles (three locked before playback).
- [x] CC-02 Keep those two songs present in the Spotify session playlist during playback; reconcile missing contents on every worker pass.
- [x] CC-03 Close ended parties from Your parties, persist dismissal, preserve history and Spotify playlists.
- [x] CC-04 Sidebar menus on host and guest dashboards; mobile navigation; Display stays without a sidebar.
- [x] CC-05 Music-focused visual refresh: artwork, stronger typography, interactive rows, purposeful motion and accessible controls.
- [x] CC-06 Reject self-voting server-side, hide guest self-vote controls, exclude legacy self-votes from ranking without deleting records.
- [x] CC-07 Welcome screen with required/optional names, explicit Continue as guest, compact Edit Guest Name dialog.
- [x] CC-08 Shared green Song Requested state until playback, including remote guest updates; Yes/No dialog for played repeats.
- [x] CC-09 Match playlist description textarea to the dark form controls.
- [x] CC-10 Prominent session playlist link immediately after creation.
- [x] CC-11 Visible loading feedback and duplicate-click protection for refresh actions.

## Validation

Passed:

- `npm run test:local`: 192 tests across 30 files, including isolated PostgreSQL schemas and mocked Spotify mutations.
- `npm run format:check`, `npm run lint`, `npm run typecheck`, `npm run build` using the exact lockfile dependencies.
- Chromium at 390, 768 and 1440 pixels: guest welcome gating, name dialog updates, retained search state through menus, admin menus, dark description textarea, immediate Spotify playlist link, closing ended parties, no horizontal overflow, and Display without a sidebar.
- Reviewed the code diff; no credential files or new runtime dependencies are included.

Migration 010 must be applied before running the updated app; the existing local and cloud launchers apply it automatically. Implementation is committed locally; production has not been deployed from this task.

Live Spotify playback cache behavior requires host acceptance testing; automated tests never write to a live Spotify account.
