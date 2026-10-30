import { MAX_PAYLOAD_CHARS } from "../../shared/suggestionRequest.js";

// Native-control adapter recognizes only textareas. Rich previews use a separate adapter.
function resolveOwner(candidate) {
  return candidate?.tagName === "TEXTAREA" ? candidate : null;
}

function isEligible(owner, { composing = false } = {}) {
  if (!resolveOwner(owner)) return false;
  const doc = owner.ownerDocument || document;
  return owner.isConnected && doc.activeElement === owner && doc.hasFocus() &&
    !owner.disabled && !owner.readOnly && !composing;
}

function readText(owner) {
  return resolveOwner(owner) ? owner.value : null;
}

function readSelection(owner) {
  if (!resolveOwner(owner)) return null;
  const start = owner.selectionStart;
  const end = owner.selectionEnd;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
      end > owner.value.length || start > end) return null;
  return Object.freeze({ start, end, direction: owner.selectionDirection,
    collapsed: start === end, text: owner.value.slice(start, end) });
}

function isSafeEdit(snapshot) {
  const { text, start, end, intent } = snapshot;
  if (typeof intent?.payload !== "string" || !intent.payload.trim()) return false;
  if (intent.type === "cursor") return start === end;
  if (intent.type !== "selection" || start === end || end - start > MAX_PAYLOAD_CHARS) return false;
  const selected = text.slice(start, end);
  return selected === intent.payload && selected.trim().split(/\s+/).length >= 5;
}

function capture(owner, intent, options) {
  if (!isEligible(owner, options)) return null;
  const selection = readSelection(owner);
  if (!selection) return null;
  const snapshot = Object.freeze({ owner, text: owner.value,
    start: selection.start, end: selection.end, direction: selection.direction,
    intent: Object.freeze({ type: intent?.type, payload: intent?.payload }) });
  return isSafeEdit(snapshot) ? snapshot : null;
}

function validate(snapshot, options) {
  if (!snapshot || !isEligible(snapshot.owner, options)) return false;
  const selection = readSelection(snapshot.owner);
  return Boolean(selection && snapshot.owner.value === snapshot.text &&
    selection.start === snapshot.start && selection.end === snapshot.end &&
    selection.direction === snapshot.direction && isSafeEdit(snapshot));
}

// Preserve the existing direct-value strategy. This is not an undo/model guarantee.
function apply(snapshot, suggestion, options) {
  if (typeof suggestion !== "string" || !suggestion || !validate(snapshot, options)) return false;
  const { owner, text, start, end } = snapshot;
  owner.value = text.slice(0, start) + suggestion + text.slice(end);
  owner.selectionStart = owner.selectionEnd = start + suggestion.length;
  const EventType = owner.ownerDocument?.defaultView?.Event || Event;
  owner.dispatchEvent(new EventType("input", { bubbles: true }));
  return true;
}

const supported = Object.freeze({ status: "supported" });
const unverifiedEdit = Object.freeze({ status: "experimental",
  reason: "Existing direct-value strategy; native undo and host-model reconciliation are unverified." });
const capabilities = Object.freeze({
  readText: supported, readSelection: supported,
  preview: Object.freeze({ status: "experimental", reason: "Existing mirror geometry; browser layout unverified." }),
  insertText: unverifiedEdit, replaceSelection: unverifiedEdit,
  undoRedo: Object.freeze({ status: "unsupported", reason: "No verified undo-preserving strategy." }),
});
const unsupported = Object.freeze({ status: "unsupported", reason: "A1 supports native textareas only." });
const unsupportedCapabilities = Object.freeze(Object.fromEntries(
  Object.keys(capabilities).map(key => [key, unsupported])));

/**
 * Small editor boundary. No listeners are installed by importing this module.
 * capture() freezes request facts, not the referenced DOM element.
 * getCaretRect() returns viewport coordinates; apply() never refocuses the owner.
 * readText() intentionally retains full-value extraction until a later milestone.
 */
export const nativeControlAdapter = Object.freeze({
  id: "native-textarea", kind: "textarea", selector: "textarea",
  resolveOwner, isEligible, readText, readSelection, capture, validate, getCaretRect, apply,
  getCapabilities: owner => resolveOwner(owner) ? capabilities : unsupportedCapabilities,
});

// Native-only resolution retained for A2 diagnostics; production uses editors/index.js.
export function resolveEditorAdapter(candidate) {
  return resolveOwner(candidate) ? nativeControlAdapter : null;
}

function getCaretRect(snapshot) {
  if (!validate(snapshot)) return null;
  const el = snapshot.owner;
  const doc = el.ownerDocument || document;
  const view = doc.defaultView || window;
  const mirror = doc.createElement("div");
  const style = view.getComputedStyle ? view.getComputedStyle(el) : getComputedStyle(el);
  const rect = el.getBoundingClientRect();

  for (const prop of style) {
    mirror.style[prop] = style[prop];
  }

  mirror.style.position = "absolute";
  mirror.style.visibility = "hidden";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.wordWrap = "break-word";
  mirror.style.overflow = "hidden";
  mirror.style.left = rect.left + view.scrollX + "px";
  mirror.style.top = rect.top + view.scrollY + "px";
  mirror.style.width = rect.width + "px";
  mirror.style.height = rect.height + "px";

  mirror.textContent = el.value.slice(0, snapshot.start);

  const marker = doc.createElement("span");
  marker.textContent = "\u200b";
  mirror.appendChild(marker);

  doc.body.appendChild(mirror);
  try {
    const rect = marker.getBoundingClientRect();
    // Viewport coordinates; the renderer chooses its own positioning strategy.
    return { left: rect.left, top: rect.top };
  } finally {
    mirror.remove();
  }
}

