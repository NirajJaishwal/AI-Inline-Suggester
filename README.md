# Inline AI — P0.2A / A3 contenteditable preview baseline

A Manifest V3 writing-assistant prototype using deterministic mock suggestions.
No real AI integration is enabled. Textareas retain mock suggestion acceptance.
A3 adds experimental contenteditable reading and external previews only;
contenteditable insertion and input-element support remain disabled.

## Verification

Use a recent Node.js runtime (verified with Node 24.18.1) and the existing
esbuild installation. From [extension](./extension):

```sh
npm test
npm run build
```

The dependency-free Node test suite uses a deliberately small DOM/event double.
It verifies session ownership, invalidation, delayed responses, keyboard
policy, discovery/debounce wiring, and real detector/normalizer/mock/acceptance flows; it does not verify browser layout, framework compatibility or undo.
Both production bundles must be rebuilt before loading source changes.

## Manual Chrome acceptance

1. Build, open chrome://extensions, enable Developer mode, and load the
   [extension directory](./extension) as an unpacked extension. Reload the
   extension and refresh the test page after each build.
2. Use a local HTTP test page containing two textareas, a contenteditable,
   ordinary selectable text and a focusable button. No private text is needed.
3. Type at least five characters in textarea A and wait 700 ms. Tab should
   insert one mock suggestion at its unchanged selection; a second Tab should
   navigate normally. Escape should dismiss while remaining available to the page.
4. Move the caret, edit, click textarea B, start IME composition or remove A
   while its preview is visible. The preview must disappear and Tab must not
   insert the old suggestion. Shift+Tab and modified Tab must remain untouched.
5. With no preview, Tab/Escape must retain normal page behavior. Selecting
   ordinary text or typing in contenteditable must produce no suggestion.
6. To exercise pending-response races, set a debugger breakpoint immediately
   before the worker's sendResponse call in
   [serviceWorker.js](./extension/src/background/serviceWorker.js). While paused,
   edit/move the caret, focus B, remove A or begin composition; resume the worker.
   No stale preview or insertion may occur. Run each case after a fresh request.
7. Select one to four words and wait: no suggestion should appear, and Tab
   must not overwrite them. Repeat with a selection longer than 900 characters,
   including one whose length exceeds 900 only because of boundary whitespace.
8. Select five or more words within the limit. Accept a rewrite and verify that
   text before and after the selection is byte-for-byte unchanged. Repeat after
   moving the selection before Tab: no old suggestion may be accepted.
9. Dismiss a selected rewrite with Escape. Keep the same selection, wait and
   trigger select/selectionchange notifications: it must stay dismissed. Change
   the selection (or edit/refocus), then verify a new suggestion is permitted.
10. Check textarea selection replacement, scrolling and layout manually. Undo
   preservation and compatibility with framework-controlled editors are not
   established by this milestone.

## Safety boundary and remaining work

Sessions capture owner, text, selection, intent and an increasing ID. Pending
and visible sessions invalidate on input, focus departure, selection changes,
composition, window blur and disconnection. Rendering and acceptance revalidate
snapshots, including silent programmatic changes. Completed sessions cannot be
reused. Preview text is outside the textarea. Unreachable legacy DOM-range rendering and
insertion functions have been removed. Replacement text comes from the captured
preview record, never from host-accessible overlay DOM.

Continuation requires a collapsed selection. Selected rewrites require at least
five words and at most 900 raw JavaScript string characters (UTF-16 code units),
including selected boundary whitespace. Oversized rewrites are rejected rather
than truncated. Continuation requests keep their separate 900-character context
cap. Acceptance validates that a rewrite payload matches the exact selected text.

Dismissed snapshots are suppressed until text, selection or focus changes.
The entrypoint calls initContentScript(), which initializes session/UI listeners
and discovery. Its returned cleanup is idempotent, disconnects observers,
removes listeners, cancels tracked timers, invalidates pending work and permits
reinitialization. Supporting modules no longer install global listeners at import.

Native textarea caret-relative context, textarea overlay geometry, undo integration,
rich-editor insertion and real AI are deferred. Native sentence detection still
reads the final sentence-like fragment from the entire textarea.

## A1 — native adapter extraction

The [native control adapter](./extension/src/content/editors/nativeControl.js) now
owns textarea resolution, selection/text reads, immutable target snapshots,
validation, caret geometry and the existing direct-value insertion strategy.
Sessions store `{ id, adapter, snapshot, status }`; editor facts and intent are
frozen separately from lifecycle state. The preview renderer delegates geometry
and edits rather than reading `.value` or interpreting selection offsets.

Adapter capability reports distinguish supported text/selection reads from
experimental preview/insertion and unsupported undo guarantees. These labels
report evidence limits; they do not enable additional editor types. Inputs,
contenteditable, framework integrations, shadow roots and frames remain disabled.
No adapter registry, new dependency, provider change or website-specific logic
was introduced. The existing full-value/final-fragment context behavior and
overlay positioning limitations remain deliberately unchanged.

[Adapter contract tests](./extension/tests/editorContracts.test.mjs) exercise
unsupported targets, frozen snapshots, stale text/selection/focus/composition,
rewrite bounds, exact surrounding-text preservation, capability reporting and
measurement cleanup. Existing ownership integration tests remain unchanged.
A2 added the standalone compatibility playground and input diagnostics below.

## A2 — standalone playground and input diagnostics

Run `npm run playground` from [extension](./extension), then open
http://127.0.0.1:4173 in Chrome. Stop with Ctrl+C. Set `PORT` to select another
local port. The dependency-free server binds only to loopback and serves an
explicit file allowlist, including the two production modules needed for
read-only adapter recognition; it does not serve the repository generally.

The [playground](./extension/tests/playground/index.html) contains two textareas,
text/search/URL/telephone/email/number inputs, sensitive and readonly/disabled
fixtures, plain/nested contenteditable, dynamic textarea creation/removal/remount,
and a scrolling fixture. The [diagnostics](./extension/tests/playground/diagnostics.js)
read metadata and numeric selections only, never field contents. Password, payment,
one-time-code and explicitly sensitive targets are rejected before selection
access. These are diagnostic policies, not newly enabled production policies.
Production accepts textarea suggestions only. A3 rich-editor previews are separate
from these native-input diagnostics; input support remains disabled.

Focus an eligible fixture, then click Capture diagnostic request. During its
three-second delay, move the caret, switch focus, mutate the fixture, remove it,
or start composition. The result reports stale/matching metadata and never inserts
anything. This request is a local diagnostic timer, not a runtime/AI request.
Silent programmatic value changes without an event are outside this metadata-only
diagnostic: production still uses its stronger full-text snapshot checks.

Use the installed extension independently for textarea suggestion acceptance and
selection replacement. Check undo/redo with actual keyboard commands; diagnostics
do not establish undo preservation or host-model reconciliation. Composition
buttons dispatch untrusted events; test an actual OS IME separately. Use only
disposable text. No typed characters, field values or event data are logged.
The explicit Mutate fixture control changes disposable fixture text for testing.

`npm test` includes diagnostic privacy/snapshot tests, local HTTP route/security
tests and markup checks, alongside all existing regression tests. These do not
prove browser layout, native event timing, IME, undo or framework compatibility.
An integrated-browser playground smoke run verified page/module loading, text-input
metadata, delayed snapshot invalidation after fixture mutation, password exclusion,
and dynamic add/remount-latest/remove controls. This was not a Chrome extension
compatibility run and did not verify undo/redo, OS IME or framework reconciliation.
Framework fixtures and frame/shadow-root support remain future work.
A3 read-only contenteditable snapshots and previews are described below.

## A3 — contenteditable snapshots and external previews

The [contenteditable adapter](./extension/src/content/editors/contenteditable.js)
resolves inherited editing hosts and distinct re-enabled hosts inside noneditable
islands. It supports DOM selection snapshots, caret-relative context bounded to
900 UTF-16 code units within the current block, and bounded selected text. DOM
traversal has a node budget; unsupported or ambiguous selections are rejected.
Selections crossing owners, protected/sensitive islands or shadow roots are rejected.

Snapshots freeze endpoint references/offsets, direction, intent, bounded context,
observer generation and mutation revision. Pending observer records are flushed
before validation. Text, structural and formatting mutations invalidate snapshots,
including same-text node replacement. Input, focus, selection, composition and
removal protections remain active. Discovery observes editability changes and
tears down per-owner revision observers and timers.

Ghosts are positioned from read-only range geometry in an overlay outside the
editable subtree. No marker or preview node is inserted into editor content.
Unmeasurable positions produce no preview; scrolling or resize dismisses rich
previews. A3 advertises no insertion strategy: adapter.apply(), UI acceptance and
accepted session transitions all reject contenteditable edits. Tab is not consumed;
Escape dismisses. This is preview capability, not full rich-editor compatibility.

### Reproduce browser checks

Restart `npm run playground` if a server was already running, then open
http://127.0.0.1:4173/browser-tests.html (also linked from the playground). Focus
the page and click **Run browser checks**; real document focus is required.
The page runs source modules with disposable fixtures and a deterministic test
transport. It tests preview HTML/selection/input-count preservation, caret anchoring,
bounded multiline context, pending mutation flushing, stale responses, composition
simulation, ownership boundaries, payload limits, dismissal, cleanup and rejected
acceptance. No external AI calls occur. This source-module harness is separate
from installed-extension testing; use the main playground for that.

The 56 Node tests cover additional adapter contracts. All 10 real-DOM checks passed in the
integrated browser, not as an installed Chrome extension. Undo/redo, actual OS IME,
framework reconciliation, app-specific behavior, RTL/zoom/transformed layouts, frames
and shadow roots remain unverified. Empty blocks or complex layouts may have no
usable caret geometry and therefore no preview. Native textarea context/positioning
and its existing direct-value insertion remain unchanged. No new dependencies.

The next milestone is A4: evaluate and verify insertion strategies separately.
Do not enable contenteditable acceptance without native editing, formatting, model
reconciliation and undo/redo evidence.
