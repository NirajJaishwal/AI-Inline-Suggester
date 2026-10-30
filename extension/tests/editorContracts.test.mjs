import test from "node:test";
import assert from "node:assert/strict";
import { nativeControlAdapter as adapter, resolveEditorAdapter } from "../src/content/editors/nativeControl.js";

// No global DOM or content-script bootstrap: an adapter import has no side effects.
function editor(text = "Please review this draft") {
  const events = [];
  const body = { children: [], appendChild(node) { this.children.push(node); node.parent = this; } };
  const view = {
    scrollX: 10, scrollY: 20,
    Event: class { constructor(type, options) { this.type = type; Object.assign(this, options); } },
    getComputedStyle: () => Object.assign([], { font: "16px sans-serif" }),
  };
  let failMeasurement = false;
  const doc = {
    body, defaultView: view, focused: true, hasFocus() { return this.focused; },
    createElement(tag) {
      return {
        tag, style: {}, children: [], textContent: "",
        appendChild(child) { this.children.push(child); },
        getBoundingClientRect() {
          if (failMeasurement) throw new Error("measurement failed");
          return { left: 120, top: 90 };
        },
        remove() { if (this.parent) this.parent.children = this.parent.children.filter(x => x !== this); },
      };
    },
  };
  const owner = {
    tagName: "TEXTAREA", value: text, isConnected: true, disabled: false, readOnly: false,
    selectionStart: text.length, selectionEnd: text.length, selectionDirection: "none",
    ownerDocument: doc,
    dispatchEvent(event) { events.push(event); },
    getBoundingClientRect: () => ({ left: 100, top: 80, width: 300, height: 60 }),
  };
  doc.activeElement = owner;
  return { owner, doc, events, failMeasurement: () => { failMeasurement = true; } };
}
const cursor = { type: "cursor", payload: "Please review this draft" };

test("resolution recognizes only textareas and does not activate new editor types", () => {
  const { owner } = editor();
  assert.equal(resolveEditorAdapter(owner), adapter);
  assert.equal(adapter.resolveOwner(owner), owner);
  for (const candidate of [null, {}, { tagName: "INPUT", type: "text" },
    { tagName: "DIV", isContentEditable: true }]) {
    assert.equal(resolveEditorAdapter(candidate), null);
    assert.equal(adapter.resolveOwner(candidate), null);
    assert.equal(adapter.readText(candidate), null);
    assert.equal(adapter.readSelection(candidate), null);
    assert.equal(adapter.capture(candidate, cursor), null);
    assert.equal(adapter.getCapabilities(candidate).insertText.status, "unsupported");
  }
  assert.equal(adapter.selector, "textarea");
});

test("capabilities disclose the unverified insertion, undo and preview boundaries", () => {
  const { owner } = editor(); const capabilities = adapter.getCapabilities(owner);
  assert.equal(capabilities.readText.status, "supported");
  assert.equal(capabilities.readSelection.status, "supported");
  assert.equal(capabilities.preview.status, "experimental");
  assert.equal(capabilities.insertText.status, "experimental");
  assert.equal(capabilities.replaceSelection.status, "experimental");
  assert.equal(capabilities.undoRedo.status, "unsupported");
  assert.match(capabilities.insertText.reason, /unverified/);
  assert.ok(Object.isFrozen(capabilities)); assert.ok(Object.isFrozen(capabilities.insertText));
});

test("capture freezes selection/text/intent facts while leaving the DOM owner mutable", () => {
  const { owner } = editor(); const intent = { ...cursor };
  const snapshot = adapter.capture(owner, intent);
  assert.ok(Object.isFrozen(snapshot)); assert.ok(Object.isFrozen(snapshot.intent));
  assert.equal(snapshot.owner, owner); assert.equal(snapshot.text, owner.value);
  assert.equal(snapshot.start, owner.selectionStart); assert.equal(snapshot.end, owner.selectionEnd);
  assert.throws(() => { snapshot.start = 0; }, TypeError);
  assert.throws(() => { snapshot.intent.type = "selection"; }, TypeError);
  intent.type = "selection"; assert.equal(snapshot.intent.type, "cursor");
  owner.value += " edit"; assert.equal(adapter.validate(snapshot), false);
});

test("validation rejects text, caret, direction, focus, connectivity and composition changes", () => {
  for (const change of [
    ({ owner }) => { owner.value += "x"; },
    ({ owner }) => { owner.selectionStart = owner.selectionEnd = 0; },
    ({ owner }) => { owner.selectionDirection = "backward"; },
    ({ doc }) => { doc.activeElement = {}; },
    ({ doc }) => { doc.focused = false; },
    ({ owner }) => { owner.isConnected = false; },
    ({ owner }) => { owner.disabled = true; },
    ({ owner }) => { owner.readOnly = true; },
  ]) {
    const fixture = editor(); const snapshot = adapter.capture(fixture.owner, cursor);
    change(fixture); const original = fixture.owner.value;
    assert.equal(adapter.validate(snapshot), false);
    assert.equal(adapter.apply(snapshot, " unsafe"), false);
    assert.equal(fixture.owner.value, original); assert.equal(fixture.events.length, 0);
  }
  const { owner } = editor(); const snapshot = adapter.capture(owner, cursor);
  assert.equal(adapter.capture(owner, cursor, { composing: true }), null);
  assert.equal(adapter.validate(snapshot, { composing: true }), false);
  assert.equal(adapter.apply(snapshot, " unsafe", { composing: true }), false);
});

test("selection reads preserve exact whitespace and invalid bounds fail closed", () => {
  const { owner } = editor(" one two three four five ");
  owner.selectionStart = 0; owner.selectionEnd = owner.value.length;
  const selection = adapter.readSelection(owner);
  assert.equal(selection.text, owner.value); assert.equal(selection.collapsed, false);
  assert.ok(Object.isFrozen(selection));
  for (const [start, end] of [[-1, 1], [4, 2], [0, 100], [null, null], [1.5, 2]]) {
    owner.selectionStart = start; owner.selectionEnd = end;
    assert.equal(adapter.readSelection(owner), null);
    assert.equal(adapter.capture(owner, cursor), null);
  }
});

test("capture rejects continuation over selection, short rewrites and mismatched payloads", () => {
  const { owner } = editor("one two three four five");
  owner.selectionStart = 0; owner.selectionEnd = owner.value.length;
  assert.equal(adapter.capture(owner, cursor), null);
  assert.equal(adapter.capture(owner, { type: "selection", payload: "wrong target" }), null);
  assert.equal(adapter.capture(owner, { type: "unknown", payload: owner.value }), null);
  owner.selectionEnd = 3;
  assert.equal(adapter.capture(owner, { type: "selection", payload: "one" }), null);
});

test("rewrite limits apply to the complete raw target, including whitespace", () => {
  for (const length of [900, 901]) {
    const selected = "word ".repeat(180) + (length === 901 ? " " : "");
    const { owner, events } = editor("BEFORE|" + selected + "|AFTER");
    owner.selectionStart = 7; owner.selectionEnd = 7 + selected.length;
    const snapshot = adapter.capture(owner, { type: "selection", payload: selected });
    if (length === 901) { assert.equal(snapshot, null); continue; }
    assert.ok(snapshot); assert.equal(adapter.apply(snapshot, "replacement"), true);
    assert.equal(owner.value, "BEFORE|replacement|AFTER");
    assert.equal(events.length, 1); assert.equal(owner.selectionStart, 18);
  }
});

test("continuation applies at the captured caret and preserves both surrounding slices", () => {
  const { owner, events } = editor("BEFORE|AFTER"); owner.selectionStart = owner.selectionEnd = 7;
  const snapshot = adapter.capture(owner, cursor);
  assert.equal(adapter.apply(snapshot, "inserted"), true);
  assert.equal(owner.value, "BEFORE|insertedAFTER");
  assert.equal(owner.selectionStart, 15); assert.equal(owner.selectionEnd, 15);
  assert.equal(events.length, 1); assert.equal(events[0].type, "input");
  assert.equal(events[0].bubbles, true);
  assert.equal(adapter.apply(snapshot, "duplicate"), false);
  assert.equal(events.length, 1);
});

test("empty suggestions and missing snapshots never edit", () => {
  const { owner, events } = editor(); const snapshot = adapter.capture(owner, cursor);
  for (const suggestion of ["", null, undefined, {}]) assert.equal(adapter.apply(snapshot, suggestion), false);
  assert.equal(adapter.validate(null), false); assert.equal(adapter.apply(null, "text"), false);
  assert.equal(owner.value, cursor.payload); assert.equal(events.length, 0);
});

test("geometry returns viewport coordinates without changing editor text/selection", () => {
  const { owner, doc } = editor(); const snapshot = adapter.capture(owner, cursor);
  assert.deepEqual(adapter.getCaretRect(snapshot), { left: 120, top: 90 });
  assert.equal(doc.body.children.length, 0);
  assert.equal(owner.value, snapshot.text); assert.equal(owner.selectionStart, snapshot.start);
  owner.value += "stale"; assert.equal(adapter.getCaretRect(snapshot), null);
  assert.equal(doc.body.children.length, 0);
});

test("measurement failure removes the temporary mirror", () => {
  const fixture = editor(); const snapshot = adapter.capture(fixture.owner, cursor);
  fixture.failMeasurement();
  assert.throws(() => adapter.getCaretRect(snapshot), /measurement failed/);
  assert.equal(fixture.doc.body.children.length, 0);
});
