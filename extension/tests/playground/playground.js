import { inspectControl, captureDiagnostic, validateDiagnostic } from "./diagnostics.js";

const fixtures = document.querySelector("#fixtures");
const diagnostic = document.querySelector("#diagnostic");
const eventView = document.querySelector("#events");
const requestStatus = document.querySelector("#request-status");
const revisions = new WeakMap();
const composing = new WeakSet();
const selectionKeys = new WeakMap();
const cleanups = [];
const timers = new Set();
const events = [];
let selected = null;
let requestId = 0;
let dynamicId = 0;
const revision = owner => revisions.get(owner) || 0;
const changed = owner => { if (owner) revisions.set(owner, revision(owner) + 1); };
const fixtureFor = target => {
  const el = target?.nodeType === 3 ? target.parentElement : target;
  const candidate = el?.closest?.("textarea, input, [contenteditable]");
  return candidate && fixtures.contains(candidate) ? candidate : null;
};
function listen(target, name, fn, capture = false) {
  target.addEventListener(name, fn, capture);
  cleanups.push(() => target.removeEventListener(name, fn, capture));
}
function show() {
  diagnostic.textContent = selected ? JSON.stringify({ id: selected.id || "unnamed", connected: selected.isConnected,
    revision: revision(selected), composing: composing.has(selected), ...inspectControl(selected) }, null, 2) : "Focus a fixture.";
}
function log(event, owner) {
  events.unshift({ event: event.type, fixture: owner.id || "unnamed", trusted: event.isTrusted,
    revision: revision(owner), ...(event.type === "keydown" ? { navigationKey: event.key } : {}) });
  events.length = Math.min(events.length, 60);
  eventView.textContent = events.map(item => JSON.stringify(item)).join("\n");
}
for (const type of ["focusin", "focusout", "beforeinput", "input", "select", "keydown", "compositionstart", "compositionend"]) {
  listen(fixtures, type, event => {
    const owner = fixtureFor(event.target);
    if (!owner) return;
    if (type === "keydown" && !["Tab", "Escape", "ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
    if (type === "focusin") selected = owner;
    if (["input", "focusout", "compositionstart"].includes(type)) changed(owner);
    if (type === "compositionstart") composing.add(owner);
    if (type === "compositionend") composing.delete(owner);
    log(event, owner); show();
  }, true);
}
listen(document, "selectionchange", () => {
  if (!selected) return;
  const data = inspectControl(selected);
  const next = JSON.stringify(data.selection || null);
  if (selectionKeys.has(selected) && selectionKeys.get(selected) !== next) changed(selected);
  selectionKeys.set(selected, next); show();
});
const observer = new MutationObserver(records => {
  const owners = new Set(records.map(record => fixtureFor(record.target)).filter(Boolean));
  owners.forEach(changed); show();
});
observer.observe(fixtures, { childList: true, subtree: true, characterData: true, attributes: true,
  attributeFilter: ["contenteditable", "type", "disabled", "readonly", "hidden", "inert", "autocomplete"] });

// Preserve the last editor's focus only for these explicit diagnostic controls.
for (const id of ["capture", "mutate", "compose-start", "compose-end"]) {
  listen(document.getElementById(id), "mousedown", event => event.preventDefault());
}
listen(document.querySelector("#capture"), "click", () => {
  const snapshot = selected && captureDiagnostic(selected, revision(selected), composing.has(selected));
  if (!snapshot) { requestStatus.textContent = "Unavailable: focus an eligible native fixture first."; return; }
  const id = ++requestId;
  requestStatus.textContent = "Diagnostic request " + id + " pending (3 seconds). No AI request was sent.";
  const timer = setTimeout(() => {
    timers.delete(timer);
    if (id !== requestId) return;
    const valid = validateDiagnostic(snapshot, revision(snapshot.owner), composing.has(snapshot.owner));
    requestStatus.textContent = "Diagnostic request " + id + (valid ? ": snapshot still matches. Nothing inserted." : ": stale or ineligible; rejected. Nothing inserted.");
  }, 3000);
  timers.add(timer);
});
listen(document.querySelector("#mutate"), "click", () => {
  // This is an explicit fixture edit, not a suggestion insertion strategy.
  if (!selected || inspectControl(selected).status !== "diagnostic-only") return;
  selected.value += " [fixture mutation]";
  selected.dispatchEvent(new Event("input", { bubbles: true }));
});
for (const [id, type] of [["compose-start", "compositionstart"], ["compose-end", "compositionend"]]) {
  listen(document.getElementById(id), "click", () => {
    if (selected?.isConnected) selected.dispatchEvent(new CompositionEvent(type, { bubbles: true }));
  });
}
const dynamic = document.querySelector("#dynamic-editors");
listen(document.querySelector("#add-editor"), "click", () => {
  const label = document.createElement("label");
  label.textContent = "Dynamic textarea " + (++dynamicId);
  const textarea = document.createElement("textarea"); textarea.id = "dynamic-" + dynamicId;
  textarea.rows = 3; textarea.value = "Please review this dynamic draft.";
  label.appendChild(textarea); dynamic.appendChild(label); textarea.focus();
});
listen(document.querySelector("#remove-editor"), "click", () => dynamic.lastElementChild?.remove());
listen(document.querySelector("#remount-editor"), "click", () => {
  const old = dynamic.lastElementChild?.querySelector("textarea");
  if (!old) return;
  const replacement = document.createElement("textarea");
  replacement.id = old.id; replacement.rows = 3; replacement.value = "Please review this remounted draft.";
  old.replaceWith(replacement); replacement.focus();
});
listen(document.querySelector("#clear-log"), "click", () => { events.length = 0; eventView.textContent = ""; });
listen(window, "pagehide", () => {
  ++requestId; timers.forEach(clearTimeout); timers.clear(); observer.disconnect();
  cleanups.forEach(fn => fn());
});
