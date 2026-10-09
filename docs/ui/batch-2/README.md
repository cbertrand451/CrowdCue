# Second supplied component batch

The uploaded examples are preserved as references, not compiled application code.
Adaptations use React/TypeScript, the existing Motion dependency, native SVG and
CrowdCue CSS variables. Demo data, fake completion timers, theme toggles and
unrelated package dependencies are omitted.

| Supplied pattern                        | Application placement                                                                                                          |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Switch Disclosure                       | Controlled party-creation and host-settings preferences; host descriptions expand when enabled. Settings still save together.  |
| Inline Disclosure Menu                  | Secondary request moderation actions, replacing Inline Overflow; closes outside, on blur, and on Escape.                       |
| Filter Disclosure / Dropdown Disclosure | Request status filter with selected-option feedback. Filters apply to the currently loaded page, explicitly labeled.           |
| Floating Input                          | Party name, backup playlist and guest name forms; keeps validation, input values and existing change handlers.                 |
| Carousel Navigator                      | Mobile statistic cards with manual indicators and bounded arrows. No autoplay or decorative countdown.                         |
| Copy Confirm                            | Guest invite links, replacing Inline Action. Clipboard errors allow retry; only confirmed copies show success.                 |
| Dock Component                          | Existing mobile dashboard navigation, with controlled selection, SVG icons and spring interactions. Desktop keeps its sidebar. |
| Expand Details                          | Guest party rules and request limits using keyboard-accessible native disclosure.                                              |
| Feature Tour                            | Optional “How CrowdCue works” guide in guest party details. Native modal focus/Escape behavior; no automatic popup.            |
| Feedback Action                         | Actual request-loading or mutation errors with a retry action; existing polling and refresh remain.                            |
| Quick Feedback                          | Guest upvote with undo. Server-confirmed vote state, real pending/disabled controls, existing positive-vote API.               |

Deferred where they do not fit existing workflows:

- Slot Picker: CrowdCue has no scheduling workflow.
- Edit Badge: request and party statuses are server-managed, not editable metadata.
- Collection Grid Disclosure: the current navigation and insights disclosures already organize these sections; a second collection menu would duplicate them.
- Editable Chip and Inline Edit: floating labels and the existing validated save forms cover editable party and guest names. Introducing additional save entry points would add redundant controls. The event-specific fields in Inline Edit do not exist in CrowdCue.

No scheduling, downvotes, model selection, expenses, or status-editing features
are added. Voting, queue locks, moderation authorization and atomic settings
saves keep their existing backend contracts.
