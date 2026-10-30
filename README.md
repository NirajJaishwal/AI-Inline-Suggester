# Inline AI — P0.1.1 baseline

A Manifest V3 writing-assistant prototype using deterministic mock suggestions.
No real AI integration is enabled. P0.1.1 supports native textareas only;
contenteditable, input elements and DOM-range suggestions are gated off.

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

Caret-relative context extraction, textarea overlay geometry, undo integration,
rich-editor support and real AI are deferred. The existing sentence detector
still reads the final sentence-like fragment from the entire textarea.
