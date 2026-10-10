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

## Shared animated loading feedback

Adapted the supplied SaveToggle into `src/client/LoadingButton.tsx`, using
React, TypeScript, Motion and the shared CSS theme tokens (updated to the reference palette below).
Async buttons morph into a circular spinner while their actual operation is
pending. Confirmed song requests, settings saves and clipboard copies support
checkmark feedback. Initial loads and search use the matching passive spinner;
background polling does not repeatedly animate the controls.

The original example is preserved in `docs/ui/loading-button.reference.txt`.
Its simulated timers and separate theme dependencies are replaced by real
operation state and shared CSS colors. Keyboard focus, accessible labels,
disabled controls, failure recovery and reduced motion are preserved.

Validation: `npm run check` passed (129 tests passed; 67 database tests skipped
without a configured test database). Additional shared-component tests cover
pending clicks, explicit success, form semantics and passive status feedback.
The production build reports a JavaScript chunk-size advisory. Browser visual
acceptance of this animation remains pending; earlier Chromium results above
describe the previous UI milestone.

## Supplied component integration

Integrated all seven requested patterns where they fit existing functionality:
invite-link Inline Action, expandable guest identity, confirmed session setup
checklist, party-statistic Wiggling Cards, searchable host-party dialogue,
Create New host shortcuts, and secondary moderation Inline Overflow.
Uploaded references are preserved in `docs/ui`; theme colors come from shared
CSS variables and icons use SVG. No additional runtime dependencies were added.

Validation: the existing 132 tests and seven new interaction tests cover
clipboard failure/retry, overflow actions/Escape, shortcut dispatch, profile
editing, confirmed checklist progress, party filtering/role links and statistic
navigation. Chromium checks at 390, 768 and 1440 pixels use mocked API responses
and cover the same screen flows, native dialog focus restoration, moderation
failure recovery, mobile statistic scrolling and no page-level horizontal
overflow. Browser validation makes no live Spotify writes. Database tests
require a configured test database and remain outside this UI-only change.

## Second supplied component batch

Integrated twelve suitable patterns, including combined Filter/Dropdown
Disclosure, with placements and deferred examples documented in
`docs/ui/batch-2/README.md`. Invite copying and moderation overflow replace the
earlier presentations; shared loading controls remain. Existing settings and
identity save flows keep their validation and atomic persistence. Quick Feedback
supports upvote/undo through the existing API. Request filtering is explicitly
limited to the currently loaded page. No demo timers fabricate success.

Validation: `npm run check`; six additional interaction tests cover input
handlers, inherited disabled controls, filter focus/Escape, confirmed voting,
clipboard recovery and optional tour dismissal. Chromium at 390, 768 and 1440
pixels exercises the existing flows plus vote/undo, empty filter results, party
rules and tour navigation/focus. Browser responses are mocked; no live Spotify
writes. Database tests require a configured database and are skipped here.

## Layout, attribution and branding corrections

- Move ended-party Close party actions into the right-hand header group.
- Increase shared control/disclosure spacing and center functional SVG icons.
- Remove decorative menu/welcome wave marks and the “Good music. Together.” motto.
- Show requester names on current/upcoming host and guest queues and Display;
  anonymous guests use “a guest”, backups keep their source label, and unmatched
  external Spotify songs receive no invented requester.
- Preserve host playlist description text and add Colin Bertrand’s credit.
  Migration 011 stores pre-creation playlist matches so shared credit does not
  cause recovery to adopt an older session. Legacy recovery and description
  upgrades support already managed playlists, including completed recaps.

Validation includes the full bundled PostgreSQL suite, provider recovery tests,
queue/Display attribution tests, all standard checks, and Chromium layout checks
at 390, 768, 1440 and 1920 pixels, plus 1280×720 and 1920×1080 TV checks
that keep the queue and join QR visible without vertical scrolling. Browser/provider responses are mocked; these
checks perform no live Spotify mutations.

## Reference palette and invitation card

Replaced the previous green-tinted background/pale accent with the supplied
reference scheme: #111111 page, black cards, #65b32e accents, white card text,
black accent-button text, and #bfbfbf secondary controls/muted text. Removed
remaining hard-coded old colors from shared CSS. Corrected the copy-confirm
selector specificity that allowed white text on its green background, including
hover/loading states. Setup headers now override general section top padding
and center the chevron, title, progress and count.

PartyLinks is a responsive invitation card grouping QR, instructions, share
URL, copy action, role links and reminder. The QR encoding and existing actions
remain intact. Chromium checks at 390, 768 and 1440 pixels verify actual palette
values, black copy-button text in normal/hover states, setup vertical alignment,
card backgrounds and no horizontal overflow alongside existing interaction
flows. Standard formatting/lint/type/test/build checks pass. No backend or
migration changes are needed for this visual update.

The page background was subsequently darkened to #111111 following visual
feedback. Cards remain #000000 and the accent remains #65b32e.

### Home overview and session startup diagnostics

- [x] Group connection and creation shortcuts in a compact card; show loaded active parties alongside it with role links and backup status.
- [x] Remove the home introduction and retain the almost-black background/black cards/green theme.
- [x] Show a startup checklist and expanded recovery guidance for failed Spotify/session actions, including safe Spotify categories and cooldown information.
- [x] Refresh status after uncertain network failures without automatically resubmitting playlist creation.

- [x] Remove the redundant home Create New shortcut; retain New party and Your parties workspace navigation.

### Navigation, session controls and Spotify pacing

- [x] Open home admin/Display links in new tabs and identify the role in tab titles.
- [x] Add guest QR codes to active-party summaries.
- [x] Place Spotify account and sign-out controls in the right side of Home/Admin headers.
- [x] Move Setup help below session content; match the third setup action to the other rows.
- [x] Animate only the mutation being performed when saving settings or ending parties.
- [x] Share a hardcoded Spotify request budget and cooldown across all production callers; bound admission waits and preserve mutation certainty.

- [x] Remove the App status card and its reserved column; retain compact connection feedback below the home header and let active parties use the full width.
