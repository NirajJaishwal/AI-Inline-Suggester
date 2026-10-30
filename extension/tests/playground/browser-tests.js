import { contenteditableAdapter as adapter } from "/src/content/editors/contenteditable.js";
import { resolveEditorOwner } from "/src/content/editors/index.js";
import { handleTextIntent } from "/src/content/sentenceDetector.js";
import { getDummySuggestion } from "/src/shared/suggestionRequest.js";
import { handleSentence, initContentScript } from "/src/content/contentScript.js";
import { getCurrentSession, finishSession } from "/src/content/suggestionSession.js";
import { hasGhost, acceptGhost } from "/src/content/suggestionUI.js";

const stage = document.querySelector("#browser-fixtures");
const output = document.querySelector("#results");
const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
const assert = (condition, message) => { if (!condition) throw new Error(message); };
function select(owner, start, end = start, node = owner.firstChild) {
  owner.focus(); document.getSelection().setBaseAndExtent(node, start, node, end);
}
async function editor(text = "Please review this draft before our meeting.") {
  const owner = document.createElement("div"); owner.contentEditable = "true"; owner.setAttribute("role", "textbox");
  owner.textContent = text; stage.appendChild(owner); select(owner, text.length); await frame(); return owner;
}
const key = (owner, name) => {
  const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
  owner.dispatchEvent(event); return event;
};
let running = false;
export async function runBrowserChecks() {
  if (running) throw new Error("Checks already running");
  if (!document.hasFocus()) throw new Error("Focus this page and click Run browser checks; focus is a real eligibility requirement.");
  running = true;
  const originalChrome = Object.getOwnPropertyDescriptor(window, "chrome");
  const results = []; let delayed = false; let pending = []; let stop = initContentScript();
  try {
    Object.defineProperty(window, "chrome", { configurable: true, value: { runtime: { sendMessage: message => {
      const response = { suggestion: getDummySuggestion(message.request) };
      return delayed ? new Promise(resolve => pending.push(() => resolve(response))) : Promise.resolve(response);
    } } } });
    async function check(name, fn) {
      stop(); stage.replaceChildren(); delayed = false; pending = []; stop = initContentScript();
      try { await fn(); results.push({ name, passed: true }); }
      catch (error) { results.push({ name, passed: false, error: error.message }); }
      output.textContent = JSON.stringify(results, null, 2);
    }
    await check("preview/Escape leave HTML, selection and input count unchanged; Tab cannot accept", async () => {
      const owner = await editor(); const html = owner.innerHTML; const node = owner.firstChild;
      let inputs = 0; owner.addEventListener("input", () => inputs++);
      await handleSentence(handleTextIntent(owner), owner);
      assert(hasGhost(), "No preview");
      const ghost = document.querySelector(".inline-ai-ghost");
      assert(ghost && !owner.contains(ghost), "Preview entered editable DOM");
      const caretRect = adapter.getCaretRect(getCurrentSession().snapshot), ghostRect = ghost.getBoundingClientRect();
      assert(Math.abs(caretRect.left - ghostRect.left) < 2 && Math.abs(caretRect.top - ghostRect.top) < 2, "Preview is not anchored at the caret");
      assert(owner.innerHTML === html && document.getSelection().anchorNode === node, "Preview changed editor");
      assert(!acceptGhost(), "Contenteditable acceptance succeeded");
      assert(!finishSession(getCurrentSession(), "accepted"), "Session allowed acceptance");
      assert(!key(owner, "Tab").defaultPrevented, "Tab intercepted");
      key(owner, "Escape"); assert(!hasGhost(), "Escape failed");
      assert(owner.innerHTML === html && inputs === 0, "Preview/dismissal edited content");
    });
    await check("context is bounded and ends at the caret", async () => {
      const owner = await editor("please review this|AFTER"); select(owner, 18);
      assert(adapter.readText(owner) === "please review this", "Read after caret");
      owner.firstChild.data = "x".repeat(1200); select(owner, 1200); await frame();
      assert(adapter.readText(owner).length === 900, "Context is not bounded");
    });
    await check("multiline context stays within the caret block and represents line breaks", async () => {
      const owner = await editor();
      const first = document.createElement("p"); first.textContent = "Earlier block excluded.";
      const second = document.createElement("p"); const before = document.createTextNode("current block");
      const br = document.createElement("br"), after = document.createTextNode("next line|SUFFIX");
      second.append(before, br, after); owner.replaceChildren(first, second);
      select(owner, 9, 9, after); await frame();
      assert(adapter.readText(owner) === "current block\nnext line", "Block/line-break context incorrect");
    });
    await check("same-text node replacement invalidates synchronously via pending mutation records", async () => {
      const owner = await editor(); const snapshot = adapter.capture(owner, handleTextIntent(owner));
      assert(snapshot && Object.isFrozen(snapshot.selection), "No frozen snapshot");
      const replacement = document.createTextNode(owner.firstChild.data); owner.firstChild.replaceWith(replacement);
      select(owner, replacement.length); assert(!adapter.validate(snapshot), "Replaced node accepted");
    });
    await check("text and formatting mutations clear visible previews", async () => {
      const owner = await editor(); await handleSentence(handleTextIntent(owner), owner); assert(hasGhost(), "No preview");
      owner.classList.add("changed-format"); await frame(); assert(!hasGhost(), "Formatting change left preview");
      await handleSentence(handleTextIntent(owner), owner); assert(hasGhost(), "No refreshed preview");
      owner.firstChild.data += " changed"; await frame(); assert(!hasGhost(), "Silent text mutation left preview");
    });
    await check("delayed mock responses are rejected after edits, focus loss, removal and composition", async () => {
      for (const action of [
        owner => { owner.firstChild.data += " changed"; owner.dispatchEvent(new Event("input", { bubbles: true })); },
        () => { const button = document.createElement("button"); stage.appendChild(button); button.focus(); },
        owner => owner.remove(),
        owner => owner.dispatchEvent(new CompositionEvent("compositionstart", { bubbles: true })),
      ]) {
        const owner = await editor(); delayed = true; const response = handleSentence(handleTextIntent(owner), owner);
        assert(pending.length === 1, "No pending mock"); action(owner); pending.shift()(); await response;
        assert(!hasGhost(), "Stale response rendered");
        owner.dispatchEvent(new CompositionEvent("compositionend", { bubbles: true })); owner.remove();
        delayed = false; await frame();
      }
    });
    await check("caret movement rejects acceptance/render and unchanged dismissal stays suppressed", async () => {
      const owner = await editor(); await handleSentence(handleTextIntent(owner), owner);
      const snapshot = getCurrentSession().snapshot; select(owner, 1);
      assert(!adapter.validate(snapshot) && !acceptGhost(), "Moved caret accepted"); await frame();
      select(owner, owner.firstChild.length); await frame(); await handleSentence(handleTextIntent(owner), owner);
      key(owner, "Escape"); await handleSentence(handleTextIntent(owner), owner);
      assert(!hasGhost(), "Dismissed unchanged snapshot reappeared");
    });
    await check("selected rewrites are preview-only; short/oversized ranges are rejected", async () => {
      const owner = await editor("This is really very useful writing"); select(owner, 0, owner.firstChild.length); await frame();
      const html = owner.innerHTML; await handleSentence(handleTextIntent(owner), owner);
      assert(hasGhost() && !acceptGhost() && owner.innerHTML === html, "Rewrite mutated content");
      select(owner, 0, 4); await frame(); assert(handleTextIntent(owner) === null, "Short selection produced continuation");
      owner.firstChild.data = "word ".repeat(250); select(owner, 0, owner.firstChild.length); await frame();
      assert(handleTextIntent(owner) === null, "Oversized selection accepted");
    });
    await check("nested ownership, protected islands, cross-editor and sensitive selections fail safely", async () => {
      const outer = await editor("before "); const inherited = document.createElement("span"); inherited.textContent = "inherited text"; outer.appendChild(inherited);
      assert(resolveEditorOwner(inherited.firstChild) === outer, "Inherited ownership incorrect");
      const island = document.createElement("span"); island.contentEditable = "false"; island.textContent = "protected"; outer.appendChild(island);
      const inner = document.createElement("div"); inner.contentEditable = "true"; inner.textContent = "inner text"; island.appendChild(inner);
      assert(resolveEditorOwner(inner) === inner, "Re-enabled host not distinct");
      select(inner, inner.firstChild.length); await frame();
      await handleSentence(handleTextIntent(inner), inner);
      assert(hasGhost() && getCurrentSession().snapshot.owner === inner, "Nested host preview unavailable");
      const tail = document.createTextNode(" after text"); outer.appendChild(tail);
      outer.focus(); document.getSelection().setBaseAndExtent(outer.firstChild, 0, tail, tail.length);
      assert(adapter.readSelection(outer) === null, "Selection crossed protected island");
      const other = await editor("other editor"); outer.focus(); document.getSelection().setBaseAndExtent(outer.firstChild, 0, other.firstChild, 5);
      assert(adapter.readSelection(outer) === null, "Cross-owner selection allowed");
      other.setAttribute("data-sensitive", ""); select(other, other.firstChild.length);
      assert(!adapter.isEligible(other), "Sensitive editor eligible");
    });
    await check("scroll/resize dismiss previews and cleanup prevents reappearance", async () => {
      const owner = await editor(); await handleSentence(handleTextIntent(owner), owner);
      assert(hasGhost(), "No preview before scroll");
      document.dispatchEvent(new Event("scroll")); assert(!hasGhost(), "Scroll left preview");
      await handleSentence(handleTextIntent(owner), owner); assert(hasGhost(), "No preview before resize"); window.dispatchEvent(new Event("resize"));
      assert(!hasGhost(), "Resize left preview");
      await handleSentence(handleTextIntent(owner), owner); assert(hasGhost(), "No preview before cleanup"); stop(); assert(!hasGhost(), "Cleanup left preview");
    });
  } finally {
    stop(); stage.replaceChildren(); running = false;
    if (originalChrome) Object.defineProperty(window, "chrome", originalChrome); else delete window.chrome;
  }
  return results;
}
document.querySelector("#run-checks").addEventListener("click", () => runBrowserChecks().catch(error => { output.textContent = error.message; }));
