// Purpose:
// Render AI suggestions inline.

// Features:

// Ghost text overlay

// Accept (Tab)

// Dismiss (Esc)

// Undo support

// UX rule:

// Helpful, not intrusive.

// Dummy implementation for now
import { state } from "./contentScript";

export function getDummySuggestion(intent) {
    if (intent.type === "selection") {
        return "Improve Clarity and tone of the selected text.";
    }

    if (intent.type === "cursor") {
        return " Continue writing this though naturally.";
    }
    return " This sounds good - let me refine it.";
}

// Ghost element creator
let ghostEl = null;
export function removeGhost() {
    if (ghostEl) {
        ghostEl.remove();
        ghostEl = null;
    }
}

// render ghost for contenteditable
export function showGhostforContentEditable(_el, suggestion) {
    removeGhost();

    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0).cloneRange();
    range.collapse(true);

    ghostEl = document.createElement("span");
    ghostEl.textContent = suggestion;
    ghostEl.className = "inline-ai-ghost";
    ghostEl.style.opacity = "0.4";
    ghostEl.style.pointerEvents = "none";
    ghostEl.style.whiteSpace = "pre";

    try {
        range.insertNode(ghostEl);
    } catch (e) {
        console.error("[Inline-AI] Failed to insert ghost:", e);
    }
}

function getCaretCoordinates(el) {
    const div = document.createElement("div");
    const style = getComputedStyle(el);

    for (const prop of style) {
        div.style[prop] = style[prop];
    }

    div.style.position = "absolute";
    div.style.visibility = "hidden";
    div.style.whiteSpace = "pre-wrap";
    div.style.wordWrap = "break-word";
    
    div.textContent = el.value.substring(0, el.selectionStart);

    const span = document.createElement("span");
    span.textContent = "\u200b";
    div.appendChild(span);

    document.body.appendChild(div);
    const rect = span.getBoundingClientRect();
    document.body.removeChild(div);

    return rect;
}

let currentTextarea = null;
// render ghost for textarea/input
function showGhostforTextarea(el, suggestion) {
    removeGhost();
    currentTextarea = el;
    ghostEl = document.createElement("div");
    ghostEl.textContent = suggestion;
    ghostEl.style.position = "absolute";

    const caret = getCaretCoordinates(el);
    ghostEl.style.left = caret.left + "px";
    ghostEl.style.top = caret.top + "px";
    ghostEl.style.opacity = "0.4";
    ghostEl.style.pointerEvents = "none";
    ghostEl.style.font = getComputedStyle(el).font;
    ghostEl.style.whiteSpace = "pre";
    ghostEl.style.zIndex = "9999";

    document.body.appendChild(ghostEl);

    el.removeEventListener("input", updateGhostPosition);
    el.addEventListener("input", updateGhostPosition);
}

function updateGhostPosition() {
    if (!ghostEl || !currentTextarea) return;
    const caret = getCaretCoordinates(currentTextarea);
    ghostEl.style.left = caret.left + "px";
    ghostEl.style.top = caret.top + "px";
}

export function acceptGhost(el) {
  if (!ghostEl) return;
  const suggestion = ghostEl.textContent;
  removeGhost();

  if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    const start = el.selectionStart ?? el.value.length;
    const end = el.selectionEnd ?? el.value.length;

    el.value =
      el.value.slice(0, start) +
      suggestion +
      el.value.slice(end);

    el.selectionStart = el.selectionEnd = start + suggestion.length;
  } else {
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return;

    const range = selection.getRangeAt(0);
    range.deleteContents();
    range.insertNode(document.createTextNode(suggestion));
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  }

  el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Remove ghost on selection change
// document.addEventListener("selectionchange", () => {
//   removeGhost();
// });

// Show ghost on selection change if applicable
document.addEventListener("selectionchange", () => {
  const el = document.activeElement;
  if (!el) return;
  if (state.isUserTyping || state.isRenderingGhost) return;

  const intent = handleTextIntent(el);
  if (intent && intent.type === "selection") {
    handleSentence(intent, el);
  }
});

// Add Tab key listener to accept suggestions 
document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && ghostEl) {
    e.preventDefault();
    const el = document.activeElement;
    acceptGhost(el);
    }
}, true);

// Main exported function
export function showGhost(el, suggestion) {
    // const suggestion = getDummySuggestion(sentence);

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        showGhostforTextarea(el, suggestion);
    } else {
        showGhostforContentEditable(el, suggestion);
    }
}

// ghost replacement for selection
export function showGhostForSelection(range, text) {
    removeGhost();

    ghostEl.document.createElement("span");
    ghostEl.textContent = getDummySuggestion(text);
    ghostEl.className = "inline-ai-ghost";
    ghostEl.style.opacity = "0.4";
    ghostEl.style.pointerEvents = "none";

    range.deleteContents();
    range.insertNode(ghostEl);
}

// ghost replacement for range
export function showGhostForRange(range, suggestion) {
  removeGhost();
  if (!range) return;

  const ghost = document.createElement("span");
  ghost.textContent = suggestion;
  ghost.className = "inline-ai-ghost";
  ghost.style.opacity = "0.4";
  ghost.style.pointerEvents = "none";
  ghost.style.whiteSpace = "pre";

  const insertRange = range.cloneRange();
  insertRange.collapse(false);
  insertRange.insertNode(ghost);

  ghostEl = ghost;
}

