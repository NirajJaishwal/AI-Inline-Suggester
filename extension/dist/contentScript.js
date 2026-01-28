(() => {
  // src/content/sentenceDetector.js
  function handleSentenceDetection(el) {
    const text = getText(el);
    if (!text) return;
    const sentence = extractLastSentence(text);
    if (!sentence) return;
    return sentence;
  }
  function getText(el) {
    if (el.tagName === "TEXTAREA") {
      return el.value;
    }
    return el.innerText || el.textContent || "";
  }
  function extractLastSentence(text) {
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 5);
    return sentences.length ? sentences[sentences.length - 1] : null;
  }

  // src/content/inputTracker.js
  function attachInputTracker(el, onSentenceDetected) {
    let typingTimer = null;
    el.addEventListener("input", () => {
      if (document.activeElement !== el) return;
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        const sentence = handleSentenceDetection(el);
        if (sentence) {
          onSentenceDetected(sentence, el);
        }
      }, 700);
    });
  }

  // src/content/observer.js
  function initObserver(onSentenceDetected) {
    const observer = new MutationObserver(() => {
      scanforEditableElements(onSentenceDetected);
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    scanforEditableElements(onSentenceDetected);
  }
  function scanforEditableElements(onSentenceDetected) {
    let activeEditable = null;
    document.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => {
      if (!el.inlineAiAttached) {
        el.inlineAiAttached = true;
        el.addEventListener("focus", () => {
          activeEditable = el;
        });
        el.addEventListener("blur", () => {
          if (activeEditable === el) {
            activeEditable = null;
          }
        });
        attachInputTracker(el, onSentenceDetected);
      }
    });
  }

  // src/content/suggestionUI.js
  function getDummySuggestion(sentence) {
    return " This sounds good - let me refine it.";
  }
  var ghostEl = null;
  function removeGhost() {
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
  }
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
  function showGhostforTextarea(el, suggestion) {
    removeGhost();
    const rect = el.getBoundingClientRect();
    ghostEl = document.createElement("div");
    ghostEl.textContent = suggestion;
    ghostEl.style.position = "absolute";
    ghostEl.style.left = rect.left + "px";
    ghostEl.style.top = rect.top + 6 + "px";
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
    ghostEl.style.top = rect.top + 6 + "px";
  }
  function acceptGhost(el) {
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
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && ghostEl) {
      e.preventDefault();
      const el = document.activeElement;
      acceptGhost(el);
    }
  }, true);
  function showGhost(el, sentence) {
    const suggestion = getDummySuggestion(sentence);
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      showGhostforTextarea(el, suggestion);
    } else {
      showGhostforContentEditable(el, suggestion);
    }
  }

  // src/content/contentScript.js
  var lastSentence = "";
  var lastRenderTime = 0;
  function handleSentence(sentence, el) {
    if (sentence === lastSentence) return;
    const now = Date.now();
    if (now - lastRenderTime < 300) return;
    lastSentence = sentence;
    lastRenderTime = now;
    removeGhost();
    showGhost(el, sentence);
  }
  try {
    initObserver(handleSentence);
    console.log("[Inline-AI] Content script initialized");
  } catch (error) {
    console.error("[Inline-AI] Failed to initialize:", error);
  }
})();
