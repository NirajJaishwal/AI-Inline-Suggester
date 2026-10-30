import { resolveEditorAdapter, resolveEditorOwner } from "./editors/index.js";

let nextId = 0;
let current = null;
let dismissed = null;
let composing = new WeakSet();
let dispose = null;
const endListeners = new Set();

export function isEligibleEditor(owner) {
  owner = resolveEditorOwner(owner);
  return Boolean(resolveEditorAdapter(owner)?.isEligible(owner, { composing: composing.has(owner) }));
}

function matchesSnapshot(session) {
  return session.adapter.validate(session.snapshot, { composing: composing.has(session.snapshot.owner) });
}

export function getCurrentSession() { return current; }

export function onSessionEnd(listener) {
  endListeners.add(listener);
  return () => endListeners.delete(listener);
}

export function finishSession(session, status = "invalidated") {
  if (!session || session !== current || !["pending", "visible"].includes(session.status) ||
      !["accepted", "dismissed", "invalidated"].includes(status)) return false;
  if (status === "accepted" && (session.status !== "visible" || !isSessionValid(session) ||
      session.adapter.getCapabilities(session.snapshot.owner)[session.snapshot.intent.type === "selection" ? "replaceSelection" : "insertText"].status === "unsupported")) return false;
  session.status = status;
  current = null;
  if (status === "dismissed") dismissed = session;
  for (const listener of endListeners) listener(session);
  return true;
}

export function invalidateSession() {
  if (current) finishSession(current);
}

export function beginSession(owner, intent) {
  const adapter = resolveEditorAdapter(owner);
  owner = adapter?.resolveOwner(owner);
  const snapshot = adapter?.capture(owner, intent, { composing: composing.has(owner) });
  if (!snapshot) return null;
  if (dismissed && matchesSnapshot(dismissed)) return null;
  dismissed = null;
  invalidateSession();
  current = { id: ++nextId, adapter, snapshot, status: "pending" };
  return current;
}

export function isSessionValid(session) {
  if (!session || session !== current || !["pending", "visible"].includes(session.status)) return false;
  const valid = matchesSnapshot(session);
  if (!valid) finishSession(session);
  return valid;
}

export function markVisible(session) {
  if (!isSessionValid(session) || session.status !== "pending") return false;
  session.status = "visible";
  return true;
}

export function initSuggestionSessions() {
  if (dispose) return dispose;
  const cleanups = [];
  const listen = (target, name, fn) => {
    target.addEventListener(name, fn, true);
    cleanups.push(() => target.removeEventListener(name, fn, true));
  };
  const ownerChanged = (event) => {
    const owner = resolveEditorOwner(event.target);
    if (event.type === "focusout" && owner && resolveEditorOwner(event.relatedTarget) === owner) return;
    invalidateOwner(owner);
  };
  listen(document, "input", ownerChanged);
  listen(document, "focusout", ownerChanged);
  const selectionChanged = () => {
    if (dismissed && !matchesSnapshot(dismissed)) dismissed = null;
    if (current) isSessionValid(current);
  };
  listen(document, "selectionchange", selectionChanged);
  listen(document, "select", selectionChanged);
  listen(document, "compositionstart", (event) => {
    const owner = resolveEditorOwner(event.target);
    if (!owner) return;
    composing.add(owner);
    ownerChanged(event);
  });
  listen(document, "compositionend", (event) => {
    const owner = resolveEditorOwner(event.target);
    if (owner) composing.delete(owner);
  });
  listen(window, "blur", () => { dismissed = null; invalidateSession(); });
  const observer = new MutationObserver(() => {
    if (dismissed && !dismissed.snapshot.owner.isConnected) dismissed = null;
    if (current && !current.snapshot.owner.isConnected) invalidateSession();
  });
  observer.observe(document.documentElement, { childList: true, subtree: true });
  const cleanup = () => {
    if (dispose !== cleanup) return;
    cleanups.forEach(fn => fn());
    observer.disconnect();
    dismissed = null;
    composing = new WeakSet();
    invalidateSession();
    dispose = null;
  };
  dispose = cleanup;
  return cleanup;
}

export function invalidateOwner(owner) {
  if (!owner) return;
  if (dismissed?.snapshot.owner === owner) dismissed = null;
  if (current?.snapshot.owner === owner) invalidateSession();
}
