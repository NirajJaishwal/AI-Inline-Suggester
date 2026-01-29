(() => {
  // src/content/sentenceDetector.js
  function handleTextIntent2(el) {
    const selection = getActiveSelection(el);
    if (selection) {
      return {
        type: "selection",
        payload: selection.text,
        range: selection.range
      };
    }
    const text = getText(el);
    if (!text) return null;
    const sentence = extractLastSentence(text);
    if (!sentence) return null;
    return {
      type: "cursor",
      payload: sentence
    };
  }
  function getText(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      return el.value;
    }
    return el.innerText || el.textContent || "";
  }
  function extractLastSentence(text) {
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 5);
    return sentences.length ? sentences[sentences.length - 1] : null;
  }
  function getActiveSelection(el) {
    if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
      const start = el.selectionStart;
      const end = el.selectionEnd;
      if (start == null || end == null || start === end) return null;
      const text2 = el.value.slice(start, end).trim();
      if (text2.split(/\s+/).length < 5) return null;
      return {
        text: text2,
        range: null,
        // textarea has no DOM range
        source: "textarea"
      };
    }
    const selection = window.getSelection();
    if (!selection || selection.rangeCount === 0) return null;
    if (selection.isCollapsed) return null;
    const text = selection.toString().trim();
    if (text.split(/\s+/).length < 5) return null;
    return {
      text,
      range: selection.getRangeAt(0),
      source: "contenteditable"
    };
  }

  // src/content/suggestionUI.js
  function getDummySuggestion(intent) {
    if (intent.type === "selection") {
      return "Improve Clarity and tone of the selected text.";
    }
    if (intent.type === "cursor") {
      return " Continue writing this though naturally.";
    }
    return " This sounds good - let me refine it.";
  }
  var ghostEl = null;
  function removeGhost() {
    if (ghostEl) {
      ghostEl.remove();
      ghostEl = null;
    }
  }
  function showGhostforContentEditable(_el, suggestion) {
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
    span.textContent = "\u200B";
    div.appendChild(span);
    document.body.appendChild(div);
    const rect = span.getBoundingClientRect();
    document.body.removeChild(div);
    return rect;
  }
  var currentTextarea = null;
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
  function acceptGhost(el) {
    if (!ghostEl) return;
    const suggestion = ghostEl.textContent;
    removeGhost();
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      const start = el.selectionStart ?? el.value.length;
      const end = el.selectionEnd ?? el.value.length;
      el.value = el.value.slice(0, start) + suggestion + el.value.slice(end);
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
  document.addEventListener("selectionchange", () => {
    const el = document.activeElement;
    if (!el) return;
    if (state.isUserTyping || state.isRenderingGhost) return;
    const intent = handleTextIntent(el);
    if (intent && intent.type === "selection") {
      handleSentence(intent, el);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Tab" && ghostEl) {
      e.preventDefault();
      const el = document.activeElement;
      acceptGhost(el);
    }
  }, true);
  function showGhost(el, suggestion) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
      showGhostforTextarea(el, suggestion);
    } else {
      showGhostforContentEditable(el, suggestion);
    }
  }
  function showGhostForRange(range, suggestion) {
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

  // src/content/inputTracker.js
  function attachInputTracker(el, onSentenceDetected) {
    let typingTimer = null;
    el.addEventListener("input", () => {
      if (document.activeElement !== el) return;
      state.isUserTyping = true;
      removeGhost();
      clearTimeout(typingTimer);
      typingTimer = setTimeout(() => {
        state.isUserTyping = false;
        if (state.isRenderingGhost) return;
        const intent = handleTextIntent2(el);
        if (intent) {
          onSentenceDetected(intent, el);
        }
      }, 700);
    });
  }

  // src/content/observer.js
  var trackedEditables = /* @__PURE__ */ new WeakSet();
  function initObserver(onSentenceDetected) {
    let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scanforEditableElements(onSentenceDetected);
        scheduled = false;
      });
    });
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
    scanforEditableElements(onSentenceDetected);
  }
  function scanforEditableElements(onSentenceDetected) {
    document.querySelectorAll('textarea, [contenteditable="true"]').forEach((el) => {
      if (trackedEditables.has(el)) return;
      trackedEditables.add(el);
      attachInputTracker(el, onSentenceDetected);
    });
  }

  // src/content/contentScript.js
  var state = {
    isUserTyping: false,
    lastIntentKey: "",
    isRenderingGhost: false
  };
  function handleSentence2(intent, el) {
    if (state.isUserTyping || state.isRenderingGhost) return;
    const intentKey = intent.type + "::" + intent.payload.slice(0, 200);
    if (intentKey === state.lastIntentKey) return;
    state.isRenderingGhost = true;
    state.lastIntentKey = intentKey;
    removeGhost();
    const suggestion = getDummySuggestion(intent);
    if (intent.type === "selection" && intent.range) {
      showGhostForRange(intent.range, suggestion);
    } else {
      showGhost(el, suggestion);
    }
    requestAnimationFrame(() => {
      state.isRenderingGhost = false;
    });
  }
  try {
    initObserver(handleSentence2);
    console.log("[Inline-AI] Content script initialized");
  } catch (error) {
    console.error("[Inline-AI] Failed to initialize:", error);
  }
})();
