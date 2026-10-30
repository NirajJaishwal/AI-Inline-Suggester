import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

// Deliberately small event/DOM double: tests ownership, not layout or browser editing.
class FakeEvent {
  constructor(type, options = {}) { Object.assign(this, { type, defaultPrevented: false }, options); }
  preventDefault() { this.defaultPrevented = true; }
}
class Target {
  listeners = new Map();
  addEventListener(type, fn, capture = false) {
    const list = this.listeners.get(type) || [];
    list.push({ fn, capture }); this.listeners.set(type, list);
  }
  removeEventListener(type, fn) {
    this.listeners.set(type, (this.listeners.get(type) || []).filter(x => x.fn !== fn));
  }
  fire(event, capture) {
    for (const item of [...(this.listeners.get(event.type) || [])]) {
      if (capture === undefined || item.capture === capture) item.fn(event);
    }
  }
  dispatchEvent(event) {
    event.target = this;
    if (this !== document) document.fire(event, true);
    this.fire(event);
    if (this !== document && event.bubbles) document.fire(event, false);
    return !event.defaultPrevented;
  }
}
class Element extends Target {
  constructor(tag = "DIV") {
    super(); this.tagName = tag.toUpperCase(); this.children = []; this.style = {};
    this.isConnected = true; this.value = "Please review this draft";
    this.selectionStart = this.selectionEnd = this.value.length;
    this.selectionDirection = "none"; this.disabled = this.readOnly = false;
    this.textContent = "";
  }
  setAttribute() {}
  appendChild(child) { this.children.push(child); child.parent = this; return child; }
  removeChild(child) { this.children = this.children.filter(x => x !== child); child.parent = null; }
  remove() { this.parent?.removeChild(this); this.isConnected = false; }
  getBoundingClientRect() { return { left: 0, top: 0, width: 300, height: 60 }; }
}
const observers = [];
const document = new Target();
document.body = new Element(); document.documentElement = new Element();
document.hasFocus = () => true;
document.createElement = tag => new Element(tag);
document.querySelectorAll = () => {
  const result = [];
  const visit = el => { if (el.tagName === "TEXTAREA" && el.isConnected) result.push(el); el.children.forEach(visit); };
  document.body.children.forEach(visit);
  return result;
};
globalThis.document = document;
globalThis.window = new Target();
window.scrollX = window.scrollY = 0;
window.getSelection = () => { throw new Error("Non-textarea selection must not be read"); };
globalThis.Event = FakeEvent;
globalThis.MutationObserver = class {
  constructor(fn) { this.active = false; observers.push(() => { if (this.active) fn(); }); }
  observe() { this.active = true; }
  disconnect() { this.active = false; }
};
globalThis.requestAnimationFrame = fn => { fn(); return 1; };
globalThis.cancelAnimationFrame = () => {};
globalThis.getComputedStyle = () => Object.assign([], { font: "16px sans-serif" });
globalThis.location = { href: "https://example.test/", host: "example.test" };
let responses;
let requestMessages = [];
let useMockProvider = false;
globalThis.chrome = { runtime: { sendMessage: message => {
  requestMessages.push(message);
  return useMockProvider ? Promise.resolve({ suggestion: getDummySuggestion(message.request) }) :
    new Promise(resolve => responses.push(resolve));
} } };

const sessions = await import("../src/content/suggestionSession.js");
const ui = await import("../src/content/suggestionUI.js");
const { handleSentence, initContentScript } = await import("../src/content/contentScript.js");
const { handleTextIntent } = await import("../src/content/sentenceDetector.js");
const { normalizeSuggestionRequest, getDummySuggestion, MAX_PAYLOAD_CHARS } = await import("../src/shared/suggestionRequest.js");
const { attachInputTracker } = await import("../src/content/inputTracker.js");
const intent = { type: "cursor", payload: "Please review this draft" };
const key = (owner, name, options = {}) => {
  const event = new FakeEvent("keydown", { key: name, bubbles: true, ...options });
  owner.dispatchEvent(event); return event;
};
function focus(owner) {
  const previous = document.activeElement;
  if (previous && previous !== owner) previous.dispatchEvent(new FakeEvent("focusout", { bubbles: true }));
  document.activeElement = owner;
}
function textarea() { const el = new Element("TEXTAREA"); document.body.appendChild(el); focus(el); return el; }
async function visible(owner) {
  const request = handleSentence(intent, owner);
  responses.at(-1)({ suggestion: " suggestion" }); await request;
  assert.equal(sessions.getCurrentSession().status, "visible");
}
let stopApp = initContentScript();
beforeEach(() => {
  stopApp(); responses = []; requestMessages = []; useMockProvider = false;
  document.activeElement = null; document.body.children = [];
  stopApp = initContentScript();
});
afterEach(() => stopApp());
const flushMutations = () => observers.forEach(fn => fn());
const settle = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

test("pending request cannot follow focus from A to B", async () => {
  const a = textarea(); const request = handleSentence(intent, a);
  const session = sessions.getCurrentSession(); const b = textarea();
  responses[0]({ suggestion: " unsafe" }); await request;
  assert.equal(session.status, "invalidated"); assert.equal(ui.hasGhost(), false);
  assert.equal(key(b, "Tab").defaultPrevented, false);
  assert.equal(a.value, intent.payload); assert.equal(b.value, intent.payload);
});

test("text edit invalidates a delayed response", async () => {
  const a = textarea(); const request = handleSentence(intent, a);
  a.value += " edited"; a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  responses[0]({ suggestion: " unsafe" }); await request;
  assert.equal(ui.hasGhost(), false); assert.equal(sessions.getCurrentSession(), null);
});

test("moving caret invalidates preview and does not consume Tab", async () => {
  const a = textarea(); await visible(a); const session = sessions.getCurrentSession();
  a.selectionStart = a.selectionEnd = 0;
  document.dispatchEvent(new FakeEvent("selectionchange"));
  assert.equal(session.status, "invalidated"); assert.equal(ui.hasGhost(), false);
  assert.equal(key(a, "Tab").defaultPrevented, false); assert.equal(a.value, intent.payload);
});

test("acceptance revalidates selection even before selectionchange fires", async () => {
  const a = textarea(); await visible(a); a.selectionStart = a.selectionEnd = 0;
  assert.equal(key(a, "Tab").defaultPrevented, false); assert.equal(a.value, intent.payload);
});

test("Tab without a visible valid suggestion is untouched", async () => {
  const a = textarea(); assert.equal(key(a, "Tab").defaultPrevented, false);
  const request = handleSentence(intent, a);
  assert.equal(key(a, "Tab").defaultPrevented, false);
  responses[0]({ suggestion: " suggestion" }); await request;
});

test("Escape dismisses owned preview without preventing host Escape", async () => {
  const a = textarea(); await visible(a); const session = sessions.getCurrentSession();
  assert.equal(key(a, "Escape").defaultPrevented, false);
  assert.equal(session.status, "dismissed"); assert.equal(ui.hasGhost(), false);
  assert.equal(key(a, "Tab").defaultPrevented, false);
});

test("removed editor invalidates pending response", async () => {
  const a = textarea(); const request = handleSentence(intent, a);
  const session = sessions.getCurrentSession(); a.remove(); observers.forEach(fn => fn());
  assert.equal(session.status, "invalidated");
  responses[0]({ suggestion: " unsafe" }); await request; assert.equal(ui.hasGhost(), false);
});

test("composition start invalidates pending request and blocks new requests", async () => {
  const a = textarea(); const request = handleSentence(intent, a);
  const session = sessions.getCurrentSession(); a.dispatchEvent(new FakeEvent("compositionstart", { bubbles: true }));
  await handleSentence(intent, a); assert.equal(responses.length, 1);
  responses[0]({ suggestion: " unsafe" }); await request;
  assert.equal(session.status, "invalidated"); assert.equal(ui.hasGhost(), false);
  a.dispatchEvent(new FakeEvent("compositionend", { bubbles: true }));
});

test("ordinary page selection and unresolvable editable-like objects are rejected", async () => {
  const page = new Element(); focus(page); document.dispatchEvent(new FakeEvent("selectionchange"));
  await handleSentence({ type: "selection", payload: "five words in ordinary page text" }, page);
  page.isContentEditable = true; await handleSentence(intent, page);
  assert.equal(responses.length, 0); assert.equal(ui.hasGhost(), false);
});

test("valid Tab edits captured owner once and consumes session", async () => {
  const a = textarea(); let inputs = 0; a.addEventListener("input", () => inputs++);
  await visible(a); const session = sessions.getCurrentSession();
  assert.equal(key(a, "Tab").defaultPrevented, true);
  assert.equal(a.value, intent.payload + " suggestion"); assert.equal(inputs, 1);
  assert.equal(session.status, "accepted"); assert.equal(ui.hasGhost(), false);
  assert.equal(key(a, "Tab").defaultPrevented, false);
});

test("modified, composing and host-prevented keys remain untouched", async () => {
  const a = textarea(); await visible(a);
  for (const opts of [{ shiftKey: true }, { ctrlKey: true }, { altKey: true }, { metaKey: true }, { isComposing: true }]) {
    assert.equal(key(a, "Tab", opts).defaultPrevented, false);
  }
  key(a, "Tab", { defaultPrevented: true });
  assert.equal(a.value, intent.payload); assert.equal(ui.hasGhost(), true);
});

test("out-of-order response cannot replace a newer session", async () => {
  const a = textarea(); const old = handleSentence(intent, a);
  a.value += " newer"; a.selectionStart = a.selectionEnd = a.value.length;
  a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  const latest = handleSentence({ type: "cursor", payload: a.value }, a);
  responses[1]({ suggestion: " latest" }); await latest;
  responses[0]({ suggestion: " stale" }); await old;
  assert.equal(key(a, "Tab").defaultPrevented, true); assert.equal(a.value.endsWith(" latest"), true);
});

test("debounce is cancelled by blur and composition; detached timers cannot request", t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = textarea(); let requests = 0; attachInputTracker(a, () => requests++);
  a.dispatchEvent(new FakeEvent("input", { bubbles: true })); focus(new Element("TEXTAREA"));
  t.mock.timers.tick(700); assert.equal(requests, 0);
  focus(a); a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  a.dispatchEvent(new FakeEvent("compositionstart", { bubbles: true }));
  t.mock.timers.tick(700); assert.equal(requests, 0);
  a.dispatchEvent(new FakeEvent("compositionend", { bubbles: true }));
  a.dispatchEvent(new FakeEvent("input", { bubbles: true })); a.remove();
  t.mock.timers.tick(700); assert.equal(requests, 0);
});


test("caret movement while pending invalidates the old request", async () => {
  const a = textarea(); const request = handleSentence(intent, a);
  const session = sessions.getCurrentSession(); a.selectionStart = a.selectionEnd = 1;
  document.dispatchEvent(new FakeEvent("selectionchange"));
  responses[0]({ suggestion: " stale" }); await request;
  assert.equal(session.status, "invalidated"); assert.equal(ui.hasGhost(), false);
});

test("visible preview is cleared on blur, input, composition and removal", async () => {
  for (const action of [
    a => focus(new Element("TEXTAREA")),
    a => { a.value += "x"; a.dispatchEvent(new FakeEvent("input", { bubbles: true })); },
    a => a.dispatchEvent(new FakeEvent("compositionstart", { bubbles: true })),
    a => { a.remove(); observers.forEach(fn => fn()); },
  ]) {
    const a = textarea(); await visible(a); const session = sessions.getCurrentSession();
    action(a); assert.equal(session.status, "invalidated"); assert.equal(ui.hasGhost(), false);
  }
});

test("selected replacement uses captured bounds and session IDs are unique", async () => {
  const a = textarea(); a.value = "prefix one two three four five suffix";
  a.selectionStart = 7; a.selectionEnd = a.value.indexOf(" suffix");
  const request = handleSentence(handleTextIntent(a), a);
  const first = sessions.getCurrentSession(); responses[0]({ suggestion: "replacement" }); await request;
  assert.equal(key(a, "Tab").defaultPrevented, true);
  assert.equal(a.value, "prefix replacement suffix");
  const next = handleSentence(intent, a); const second = sessions.getCurrentSession();
  assert.ok(second.id > first.id); responses[1]({ suggestion: " more" }); await next;
});

test("render and acceptance validate snapshots without relying on input events", async () => {
  const a = textarea(); const request = handleSentence(intent, a);
  const pending = sessions.getCurrentSession(); a.value += " programmatic";
  responses[0]({ suggestion: " stale" }); await request;
  assert.equal(pending.status, "invalidated"); assert.equal(ui.hasGhost(), false);
  await visible(a); a.value += " changed again";
  assert.equal(key(a, "Tab").defaultPrevented, false); assert.equal(ui.hasGhost(), false);
});


test("short or blank selections never become continuation, including after debounce", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = textarea(); flushMutations(); useMockProvider = true;
  for (const text of ["one", "one two three four", "   "]) {
    a.value = "prefix " + text + " suffix"; a.selectionStart = 7; a.selectionEnd = 7 + text.length;
    assert.equal(handleTextIntent(a), null);
    a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
    document.dispatchEvent(new FakeEvent("selectionchange"));
    t.mock.timers.tick(700); await settle();
    const original = a.value;
    assert.equal(key(a, "Tab").defaultPrevented, false); assert.equal(a.value, original);
  }
  assert.equal(requestMessages.length, 0);
});

test("session and coordinator reject manufactured continuation over selected text", async () => {
  const a = textarea(); a.selectionStart = 0; a.selectionEnd = 6;
  assert.equal(sessions.beginSession(a, intent), null);
  await handleSentence(intent, a);
  assert.equal(requestMessages.length, 0); assert.equal(ui.acceptGhost(), false);
  assert.equal(a.value, intent.payload);
});

test("oversized rewrite cannot send or replace the entire selection", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = textarea(); flushMutations(); useMockProvider = true;
  for (const selected of ["word ".repeat(250), " " + "word ".repeat(179) + "word "]) {
    a.value = "BEFORE|" + selected + "|AFTER";
    a.selectionStart = 7; a.selectionEnd = 7 + selected.length;
    const original = a.value;
    assert.ok(selected.length > MAX_PAYLOAD_CHARS);
    assert.equal(handleTextIntent(a), null);
    assert.equal(normalizeSuggestionRequest({ type: "selection", payload: selected }), null);
    await handleSentence({ type: "selection", payload: selected }, a);
    a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
    document.dispatchEvent(new FakeEvent("selectionchange"));
    t.mock.timers.tick(700); await settle();
    assert.equal(ui.hasGhost(), false); assert.equal(key(a, "Tab").defaultPrevented, false);
    assert.equal(a.value, original);
  }
  assert.equal(requestMessages.length, 0);
});

test("actual detection, normalization and mock rewrite preserve text outside exact target", async () => {
  const a = textarea(); useMockProvider = true;
  const selected = "This is really very good work";
  a.value = "KEEP BEFORE|" + selected + "|KEEP AFTER";
  a.selectionStart = 12; a.selectionEnd = 12 + selected.length;
  document.dispatchEvent(new FakeEvent("selectionchange")); await settle();
  assert.equal(requestMessages.length, 1);
  assert.equal(requestMessages[0].request.payload, selected);
  assert.equal(sessions.getCurrentSession().status, "visible");
  assert.equal(key(a, "Tab").defaultPrevented, true);
  assert.equal(a.value, "KEEP BEFORE|This is good work|KEEP AFTER");
});

test("exactly 900 raw selected characters are supported without payload truncation", async () => {
  const a = textarea(); useMockProvider = true;
  const selected = "word ".repeat(180);
  a.value = "BEFORE|" + selected + "|AFTER"; a.selectionStart = 7; a.selectionEnd = 907;
  const detected = handleTextIntent(a); assert.equal(detected.payload.length, 900);
  await handleSentence(detected, a);
  assert.equal(requestMessages[0].request.payload, selected);
  assert.equal(key(a, "Tab").defaultPrevented, true);
  assert.equal(a.value, "BEFORE|" + selected.trim() + "|AFTER");
});

test("continuation truncation never becomes a replacement of surrounding text", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = textarea(); flushMutations(); useMockProvider = true;
  a.value = "please " + "x".repeat(1000) + "|SUFFIX";
  const original = a.value; const caret = 20;
  a.selectionStart = a.selectionEnd = caret;
  a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  t.mock.timers.tick(700); await settle();
  assert.equal(requestMessages.length, 1);
  assert.equal(requestMessages[0].request.type, "cursor");
  assert.equal(requestMessages[0].request.payload.length, 900);
  assert.equal(key(a, "Tab").defaultPrevented, true);
  assert.equal(a.value, original.slice(0, caret) + " when you have a chance." + original.slice(caret));
});

test("dismissed rewrite survives repeated notifications and debounce until selection changes", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = textarea(); flushMutations(); useMockProvider = true;
  a.value = "This is really very good work"; a.selectionStart = 0; a.selectionEnd = a.value.length;
  a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  document.dispatchEvent(new FakeEvent("selectionchange")); await settle();
  const dismissed = sessions.getCurrentSession(); key(a, "Escape");
  for (let i = 0; i < 3; i++) document.dispatchEvent(new FakeEvent("selectionchange"));
  a.dispatchEvent(new FakeEvent("select", { bubbles: true }));
  t.mock.timers.tick(700); await settle();
  assert.equal(dismissed.status, "dismissed"); assert.equal(requestMessages.length, 1);
  assert.equal(ui.hasGhost(), false); assert.equal(key(a, "Tab").defaultPrevented, false);
  a.selectionStart = a.selectionEnd = 0;
  document.dispatchEvent(new FakeEvent("selectionchange"));
  a.selectionEnd = a.value.length;
  document.dispatchEvent(new FakeEvent("selectionchange")); await settle();
  assert.equal(requestMessages.length, 2); assert.equal(ui.hasGhost(), true);
});

test("dismissal clears after text edits and focus changes", async () => {
  const a = textarea(); useMockProvider = true;
  a.value = "This is really very good work"; a.selectionStart = 0; a.selectionEnd = a.value.length;
  document.dispatchEvent(new FakeEvent("selectionchange")); await settle(); key(a, "Escape");
  const b = textarea(); focus(a);
  document.dispatchEvent(new FakeEvent("selectionchange")); await settle();
  assert.equal(requestMessages.length, 2); key(a, "Escape");
  a.value += " today"; a.selectionEnd = a.value.length;
  a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  document.dispatchEvent(new FakeEvent("selectionchange")); await settle();
  assert.equal(requestMessages.length, 3); assert.equal(b.value, intent.payload);
});

test("terminal transitions are null-safe, idempotent and cannot affect newer sessions", async () => {
  assert.equal(sessions.finishSession(null), false);
  assert.equal(sessions.finishSession(undefined), false);
  const a = textarea(); const pending = sessions.beginSession(a, intent);
  assert.equal(sessions.finishSession(pending, "accepted"), false);
  assert.equal(pending.status, "pending");
  assert.equal(sessions.finishSession(pending, "dismissed"), true);
  assert.equal(sessions.finishSession(pending, "invalidated"), false);
  assert.equal(pending.status, "dismissed");
  a.selectionStart = a.selectionEnd = 0;
  document.dispatchEvent(new FakeEvent("selectionchange"));
  const next = sessions.beginSession(a, intent);
  assert.ok(next.id > pending.id);
  assert.equal(sessions.finishSession(pending), false);
  assert.equal(sessions.getCurrentSession(), next);
  assert.equal(sessions.finishSession(next, "unknown"), false);
  assert.equal(sessions.finishSession(next), true);
  assert.equal(sessions.finishSession(next), false);
});

test("acceptance uses stored suggestion, not text modified in the overlay DOM", async () => {
  const a = textarea(); useMockProvider = true; await handleSentence(handleTextIntent(a), a);
  document.body.children.find(el => el.className === "inline-ai-ghost").textContent = "tampered";
  assert.equal(key(a, "Tab").defaultPrevented, true);
  assert.equal(a.value, intent.payload + " when you have a chance.");
});

test("reinitialization and repeated cleanup do not duplicate global handlers or trackers", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const a = textarea(); flushMutations(); useMockProvider = true;
  const listenerCount = () => [...document.listeners.values()].reduce((sum, list) => sum + list.length, 0);
  const before = listenerCount();
  assert.equal(initContentScript(), stopApp); assert.equal(listenerCount(), before);
  a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  stopApp(); stopApp(); t.mock.timers.tick(700); await settle();
  assert.equal(requestMessages.length, 0); assert.equal(listenerCount(), 0);
  document.dispatchEvent(new FakeEvent("selectionchange")); assert.equal(requestMessages.length, 0);
  stopApp = initContentScript(); assert.equal(listenerCount(), before);
  a.dispatchEvent(new FakeEvent("input", { bubbles: true }));
  t.mock.timers.tick(700); await settle();
  assert.equal(requestMessages.length, 1); assert.equal(key(a, "Tab").defaultPrevented, true);
});

test("cleanup invalidates in-flight work; its late response cannot revive a preview", async () => {
  const a = textarea(); const request = handleSentence(handleTextIntent(a), a);
  const pending = sessions.getCurrentSession(); stopApp();
  responses[0]({ suggestion: "stale" }); await request;
  assert.equal(pending.status, "invalidated"); assert.equal(ui.hasGhost(), false);
  assert.equal(key(a, "Tab").defaultPrevented, false);
});


test("a truncated manufactured rewrite cannot target a larger actual selection", async () => {
  const a = textarea(); a.value = "word ".repeat(250);
  a.selectionStart = 0; a.selectionEnd = a.value.length;
  const truncated = { type: "selection", payload: a.value.slice(0, 900) };
  assert.ok(normalizeSuggestionRequest(truncated));
  assert.equal(sessions.beginSession(a, truncated), null);
  await handleSentence(truncated, a);
  assert.equal(requestMessages.length, 0); assert.equal(key(a, "Tab").defaultPrevented, false);
  assert.equal(a.value, "word ".repeat(250));
});

test("changing the rewrite target before acceptance never edits the new selection", async () => {
  const a = textarea(); useMockProvider = true;
  a.value = "BEFORE|This is really very good work|AFTER";
  a.selectionStart = 7; a.selectionEnd = a.value.indexOf("|AFTER");
  await handleSentence(handleTextIntent(a), a);
  const original = a.value;
  a.selectionStart = 0; a.selectionEnd = 6;
  assert.equal(key(a, "Tab").defaultPrevented, false); assert.equal(a.value, original);
});

test("old cleanup cannot stop a new initialization or revive its old request", async () => {
  const a = textarea(); const pending = handleSentence(handleTextIntent(a), a);
  const oldStop = stopApp; oldStop(); stopApp = initContentScript(); oldStop();
  useMockProvider = true; await handleSentence(handleTextIntent(a), a);
  assert.equal(ui.hasGhost(), true);
  responses[0]({ suggestion: "stale" }); await pending;
  assert.equal(key(a, "Tab").defaultPrevented, true);
  assert.equal(a.value, intent.payload + " when you have a chance.");
});
