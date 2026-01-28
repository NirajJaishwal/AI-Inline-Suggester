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
function getDummySuggestion(sentence) {
    return " This sounds good - let me refine it."
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
function showGhostforContentEditable(el, suggestion) {
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

// render ghost for textarea/input
function showGhostforTextarea(el, suggestion) {
    removeGhost();

    const rect = el.getBoundingClientRect();

    ghostEl = document.createElement("div");
    ghostEl.textContent = suggestion;
    ghostEl.style.position = "absolute";
    ghostEl.style.left = rect.left + "px";
    ghostEl.style.top = (rect.top + 6) + "px";
    ghostEl.style.opacity = "0.4";
    ghostEl.style.pointerEvents = "none";
    ghostEl.style.font = getComputedStyle(el).font;
    ghostEl.style.whiteSpace = "pre";
    ghostEl.style.zIndex = "9999";

    document.body.appendChild(ghostEl);

    el.addEventListener("input", updateGhostPosition);
}

function updateGhostPosition() {
    if (!ghostEl || !currentTextarea) return;
    const rect = currentTextarea.getBoundingClientRect();
    ghostEl.style.left = rect.left + "px";
    ghostEl.style.top = (rect.top + 6) + "px";

}

export function acceptGhost(el) {
    if (!ghostEl) return;
    const suggestion = ghostEl.textContent;
    removeGhost();
    
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
    el.value += suggestion;
    } else {
    document.execCommand("insertText", false, suggestion);
    }
    
    el.dispatchEvent(new Event("input", { bubbles: true }));
}

// Add Tab key listener to accept suggestions 
document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && ghostEl) {
    e.preventDefault();
    const el = document.activeElement;
    acceptGhost(el);
    }
}, true);

// Main exported function
export function showGhost(el, sentence) {
    const suggestion = getDummySuggestion(sentence);

    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        showGhostforTextarea(el, suggestion);
    } else {
        showGhostforContentEditable(el, suggestion);
    }
}