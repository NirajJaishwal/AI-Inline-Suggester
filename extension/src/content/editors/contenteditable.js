import { MAX_PAYLOAD_CHARS } from "../../shared/suggestionRequest.js";

const watches = new WeakMap();
let generation = 0;
const NODE_BUDGET = 512;
const blocked = '[contenteditable="false"], [hidden], [inert], [data-sensitive], [aria-disabled="true"], [aria-readonly="true"], input, textarea, select, button, script, style';
const blocks = new Set(["DIV", "P", "LI", "PRE", "BLOCKQUOTE", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6"]);

function elementFor(node) { return node?.nodeType === 3 ? node.parentElement : node; }
function resolveOwner(candidate) {
  let el = elementFor(candidate);
  if (!el?.ownerDocument || !el.getAttribute || !el.isContentEditable ||
      el.closest?.("input, textarea, select, button")) return null;
  const doc = el.ownerDocument;
  if (el.getRootNode && el.getRootNode() !== doc) return null; // Shadow roots are a later milestone.
  while (el.parentElement?.isContentEditable) el = el.parentElement;
  const value = el.getAttribute("contenteditable");
  return value !== null && ["", "true", "plaintext-only"].includes(value.toLowerCase()) ? el : null;
}
function isEligible(owner, { composing = false } = {}) {
  if (!owner || resolveOwner(owner) !== owner || !owner.isConnected || composing || owner.closest('[hidden], [inert], [data-sensitive], [aria-disabled="true"], [aria-readonly="true"]')) return false;
  const doc = owner.ownerDocument;
  return doc.hasFocus() && resolveOwner(doc.activeElement) === owner;
}
function processRecords(state, records) {
  if (!records.length) return;
  state.revision++;
  for (const listener of state.listeners) listener();
}
function observe(owner, onChange) {
  if (resolveOwner(owner) !== owner) return () => {};
  let state = watches.get(owner);
  if (!state) {
    state = { generation: ++generation, revision: 0, listeners: new Set() };
    const Observer = owner.ownerDocument.defaultView.MutationObserver;
    state.observer = new Observer(records => processRecords(state, records));
    state.observer.observe(owner, { childList: true, subtree: true, characterData: true, attributes: true });
    watches.set(owner, state);
  }
  state.listeners.add(onChange);
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    state.listeners.delete(onChange);
    if (!state.listeners.size) { state.observer.disconnect(); watches.delete(owner); }
  };
}
function revision(owner) {
  const state = watches.get(owner);
  if (state) processRecords(state, state.observer.takeRecords());
  return state;
}
function nextNode(node, boundary) {
  if (node.firstChild) return node.firstChild;
  while (node && node !== boundary) {
    if (node.nextSibling) return node.nextSibling;
    node = node.parentNode;
  }
  return null;
}
function previousNode(node, boundary) {
  if (node === boundary) return null;
  if (node.previousSibling) {
    node = node.previousSibling;
    while (node.lastChild) node = node.lastChild;
    return node;
  }
  return node.parentNode === boundary ? null : node.parentNode;
}
function protectedNode(node, owner) {
  const el = elementFor(node);
  // A re-enabled host inside a protected island is allowed; its own content still must be safe.
  let current = el;
  while (current && current !== owner) {
    if (current.isContentEditable === false || current.matches?.(blocked)) return true;
    current = current.parentElement;
  }
  return false;
}
function readSelection(owner) {
  if (!isEligible(owner)) return null;
  const selection = owner.ownerDocument.defaultView.getSelection();
  if (!selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  for (const node of [selection.anchorNode, selection.focusNode, range.startContainer, range.endContainer]) {
    if (resolveOwner(node) !== owner || protectedNode(node, owner)) return null;
  }
  let text = "";
  if (!selection.isCollapsed) {
    let node = range.startContainer;
    if (node.nodeType !== 3) node = node.childNodes[range.startOffset] || nextAfter(node, owner);
    let count = 0, length = 0;
    while (node && owner.contains(node)) {
      if (++count > NODE_BUDGET) return null;
      if (range.comparePoint(node, 0) > 0) break;
      if (range.intersectsNode(node)) {
        if (protectedNode(node, owner)) return null;
        if (node.nodeType === 3) {
          const start = node === range.startContainer ? range.startOffset : 0;
          const end = node === range.endContainer ? range.endOffset : node.data.length;
          length += end - start;
          if (length > MAX_PAYLOAD_CHARS) return null;
        }
      }
      node = nextNode(node, owner);
    }
    text = range.toString(); // Bounded above before serialization.
    if (text.length > MAX_PAYLOAD_CHARS) return null;
  }
  return Object.freeze({ anchorNode: selection.anchorNode, anchorOffset: selection.anchorOffset,
    focusNode: selection.focusNode, focusOffset: selection.focusOffset,
    startContainer: range.startContainer, startOffset: range.startOffset,
    endContainer: range.endContainer, endOffset: range.endOffset,
    collapsed: selection.isCollapsed, text });
}
function nextAfter(node, boundary) {
  while (node && node !== boundary) {
    if (node.nextSibling) return node.nextSibling;
    node = node.parentNode;
  }
  return null;
}
function readText(owner) {
  const selection = readSelection(owner);
  if (!selection?.collapsed) return null;
  let boundary = elementFor(selection.startContainer);
  while (boundary !== owner && !blocks.has(boundary.tagName)) boundary = boundary.parentElement;
  let node = selection.startContainer;
  let text = "";
  if (node.nodeType === 3) {
    text = node.data.slice(Math.max(0, selection.startOffset - MAX_PAYLOAD_CHARS), selection.startOffset);
    node = previousNode(node, boundary);
  } else if (selection.startOffset) {
    node = node.childNodes[selection.startOffset - 1];
    while (node.lastChild) node = node.lastChild;
  } else node = previousNode(node, boundary);
  let count = 0;
  while (node && node !== boundary && text.length < MAX_PAYLOAD_CHARS) {
    if (++count > NODE_BUDGET || protectedNode(node, owner)) return null;
    if (node.nodeType === 3) text = node.data.slice(-(MAX_PAYLOAD_CHARS - text.length)) + text;
    else if (node.tagName === "BR") text = "\n" + text;
    node = previousNode(node, boundary);
  }
  return text;
}
const endpointKeys = ["anchorNode", "anchorOffset", "focusNode", "focusOffset", "startContainer", "startOffset", "endContainer", "endOffset", "collapsed", "text"];
function capture(owner, intent, options) {
  if (!isEligible(owner, options)) return null;
  const state = revision(owner), selection = readSelection(owner);
  if (!state || !selection || typeof intent?.payload !== "string") return null;
  const text = selection.collapsed ? readText(owner) : selection.text;
  if (!text || (selection.collapsed ? intent.type !== "cursor" || !text.trim().endsWith(intent.payload) :
      intent.type !== "selection" || intent.payload !== text || text.trim().split(/\s+/).length < 5)) return null;
  return Object.freeze({ owner, text, selection, generation: state.generation, revision: state.revision,
    intent: Object.freeze({ type: intent.type, payload: intent.payload }) });
}
function validate(snapshot, options) {
  if (!snapshot || !isEligible(snapshot.owner, options)) return false;
  const state = revision(snapshot.owner);
  if (!state || state.generation !== snapshot.generation || state.revision !== snapshot.revision) return false;
  const selection = readSelection(snapshot.owner);
  return Boolean(selection && endpointKeys.every(key => selection[key] === snapshot.selection[key]) &&
    (selection.collapsed ? readText(snapshot.owner) : selection.text) === snapshot.text);
}
function getCaretRect(snapshot) {
  if (!validate(snapshot)) return null;
  const doc = snapshot.owner.ownerDocument;
  const range = doc.createRange();
  const point = snapshot.selection;
  range.setStart(point.endContainer, point.endOffset); range.collapse(true);
  let rect = [...range.getClientRects()].find(r => r.height > 0);
  if (!rect && point.endContainer.nodeType === 3 && point.endContainer.data.length) {
    const offset = point.endOffset;
    range.setStart(point.endContainer, offset ? offset - 1 : 0);
    range.setEnd(point.endContainer, offset || 1);
    rect = [...range.getClientRects()].find(r => r.height > 0);
    if (rect) return { left: offset ? rect.right : rect.left, top: rect.top };
  }
  return rect ? { left: rect.left, top: rect.top } : null;
}
const experimental = Object.freeze({ status: "experimental", reason: "A3 DOM snapshot/preview only; model integration unverified." });
const noInsertion = Object.freeze({ status: "unsupported", reason: "No verified contenteditable insertion strategy. A3 never edits." });
const capabilities = Object.freeze({ readText: experimental, readSelection: experimental, preview: experimental,
  insertText: noInsertion, replaceSelection: noInsertion, undoRedo: noInsertion });
export const contenteditableAdapter = Object.freeze({ id: "contenteditable-preview", kind: "contenteditable",
  selector: "[contenteditable]", resolveOwner, isEligible, observe, readSelection, readText, capture, validate,
  getCaretRect, apply: () => false, getCapabilities: () => capabilities });
