import { resolveEditorAdapter } from "../../src/content/editors/nativeControl.js";

// Metadata only: never read value, textContent, innerText, event.data or credentials.
export function inspectControl(owner) {
  if (!owner || !["INPUT", "TEXTAREA"].includes(owner.tagName)) {
    return { category: "non-native", status: "unsupported", reason: "Rich-editor diagnostics are event-only in A2." };
  }
  const type = owner.tagName === "TEXTAREA" ? "textarea" : owner.type || "text";
  const productionRecognized = Boolean(resolveEditorAdapter(owner));
  const result = { category: type, productionRecognized, status: "excluded" };
  const autocomplete = (owner.getAttribute?.("autocomplete") || "").toLowerCase().split(/\s+/);
  if (type === "password" || autocomplete.some(token =>
    ["current-password", "new-password", "one-time-code"].includes(token) || token.startsWith("cc-")) ||
    owner.closest?.("[data-sensitive]")) return { ...result, reason: "Sensitive field; selection and content were not read." };
  if (owner.disabled || owner.readOnly || owner.matches?.(":disabled") || owner.closest?.("[hidden], [inert]")) {
    return { ...result, reason: "Disabled, readonly, hidden or inert." };
  }
  if (!["textarea", "text", "search"].includes(type)) {
    return { ...result, status: ["url", "tel"].includes(type) ? "excluded" : "unsupported",
      reason: ["url", "tel"].includes(type) ? "Excluded by conservative diagnostic policy." : "No supported selection strategy in A2." };
  }
  let start, end, direction;
  try { start = owner.selectionStart; end = owner.selectionEnd; direction = owner.selectionDirection; }
  catch { return { ...result, status: "unsupported", reason: "Selection access failed." }; }
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start) {
    return { ...result, status: "unsupported", reason: "Selection API unavailable." };
  }
  return { ...result, status: "diagnostic-only", selection: { start, end, direction },
    reason: productionRecognized ? "Textarea recognized by production; diagnostics do not insert." : "Readable selection; production input support remains disabled." };
}

export function captureDiagnostic(owner, revision, composing = false) {
  const result = inspectControl(owner);
  if (result.status !== "diagnostic-only" || composing || !owner.isConnected ||
      owner.ownerDocument.activeElement !== owner || !owner.ownerDocument.hasFocus()) return null;
  return Object.freeze({ owner, revision, category: result.category,
    selection: Object.freeze({ ...result.selection }) });
}

export function validateDiagnostic(snapshot, revision, composing = false) {
  if (!snapshot) return false;
  const current = captureDiagnostic(snapshot.owner, revision, composing);
  return Boolean(current && current.revision === snapshot.revision && current.category === snapshot.category &&
    current.selection.start === snapshot.selection.start && current.selection.end === snapshot.selection.end &&
    current.selection.direction === snapshot.selection.direction);
}
