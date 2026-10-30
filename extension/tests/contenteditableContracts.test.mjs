import test from "node:test";
import assert from "node:assert/strict";
import { contenteditableAdapter as adapter } from "../src/content/editors/contenteditable.js";
import { resolveEditorAdapter } from "../src/content/editors/index.js";

function element(editable, parent = null, value = "true") {
  const doc = parent?.ownerDocument || { hasFocus: () => true };
  const el = { nodeType: 1, tagName: "DIV", isContentEditable: editable, isConnected: true,
    parentElement: parent, ownerDocument: doc, getRootNode: () => doc,
    getAttribute: key => key === "contenteditable" ? value : null,
    closest: () => null };
  doc.activeElement = el; return el;
}

test("contenteditable resolution follows inherited editability to its actual host", () => {
  const outer = element(true); const child = element(true, outer, null);
  assert.equal(adapter.resolveOwner(child), outer);
  assert.equal(adapter.resolveOwner({ nodeType: 3, parentElement: child }), outer);
  assert.equal(resolveEditorAdapter(child), adapter);
  for (const value of ["", "true", "plaintext-only"]) assert.equal(adapter.resolveOwner(element(true, null, value))?.isContentEditable, true);
});
test("a re-enabled host has separate ownership across a noneditable boundary", () => {
  const outer = element(true); const island = element(false, outer, "false");
  const inner = element(true, island); assert.equal(adapter.resolveOwner(inner), inner);
  assert.equal(adapter.resolveOwner(island), null);
});
test("ordinary nodes, malformed roots and shadow roots are rejected", () => {
  for (const node of [null, {}, element(false), element(true, null, "invalid")]) assert.equal(adapter.resolveOwner(node), null);
  const shadow = element(true); shadow.getRootNode = () => ({});
  assert.equal(adapter.resolveOwner(shadow), null);
  assert.equal(adapter.capture(null, { type: "cursor", payload: "text" }), null);
  assert.equal(adapter.validate(null), false);
});
test("read-only previews never expose an insertion or undo strategy", () => {
  const capabilities = adapter.getCapabilities();
  assert.equal(capabilities.preview.status, "experimental");
  assert.equal(capabilities.insertText.status, "unsupported");
  assert.equal(capabilities.replaceSelection.status, "unsupported");
  assert.equal(capabilities.undoRedo.status, "unsupported");
  assert.equal(adapter.apply({ owner: element(true) }, "never write"), false);
});
