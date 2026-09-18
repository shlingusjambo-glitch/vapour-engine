# Narrative and visual-novel runtime

`NarrativeRuntime` executes serialized dialogue programs without `eval` or
hardcoded game logic. Programs contain line, choice, variable assignment,
branch, jump, command, and end nodes. Conditions are structured data, which
makes stories deterministic, source-control friendly, inspectable by tooling,
and safe for AI-authored projects.

The runtime exposes the current line or choices, variable access, history,
rollback, command events, completion state, and a versioned snapshot. Loading a
snapshot verifies the program identity and version; projects can provide a
migration function instead of silently accepting incompatible save data.
Localization is supplied as a resolver, so narrative assets store stable text
keys while games choose their own locale bundles and fallback policy.

`TypewriterText` reveals Unicode grapheme clusters rather than UTF-16 code
units. Emoji, combining marks, and non-Latin text therefore reveal as visible
characters instead of broken halves. It supports time-based updates, instant
completion, reset, and configurable characters per second.

The engine intentionally keeps rendering separate: narrative state decides
what text and choices exist; the 2D/UI layer decides how they look. A DDLC-style
project should bind line changes to portrait/background sprite batches, render
the localized text with the text system, persist narrative snapshots through
`SaveDatabase`, and map action-based input to advance/choice selection.

## Current limits

Branching execution, localization hooks, rollback, save snapshots, commands,
and typewriter timing are implemented and unit tested. Engine-native font/SDF
rendering, focusable UI widgets, scene-integrated portraits, audio cues, and a
complete visual-novel sample remain release gates. The narrative API is marked
Experimental until that end-to-end sample ships.
