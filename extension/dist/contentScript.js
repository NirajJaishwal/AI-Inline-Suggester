(() => {
  // src/shared/suggestionRequest.js
  var SUGGESTION_MESSAGE = "INLINE_AI_GET_SUGGESTION";
  var INTENT_TYPES = {
    CURSOR: "cursor",
    SELECTION: "selection"
  };
  var MAX_PAYLOAD_CHARS = 900;
  function normalizeSuggestionRequest(intent, pageContext = {}) {
    const type = intent?.type || INTENT_TYPES.CURSOR;
    const raw = String(intent?.payload || "");
    if (![INTENT_TYPES.CURSOR, INTENT_TYPES.SELECTION].includes(type)) return null;
    if (type === INTENT_TYPES.SELECTION && raw.length > MAX_PAYLOAD_CHARS) return null;
    const payload = type === INTENT_TYPES.SELECTION ? raw : raw.trim().slice(0, MAX_PAYLOAD_CHARS);
    if (!payload.trim()) return null;
    return {
      type,
      payload,
      context: {
        url: pageContext.url || "",
        host: pageContext.host || "",
        editableKind: pageContext.editableKind || "unknown"
      }
    };
  }
  function getDummySuggestion(request) {
    const text = request?.payload || "";
    if (request?.type === INTENT_TYPES.SELECTION) {
      return compactRewrite(text);
    }
    return continueSentence(text);
  }
  function compactRewrite(text) {
    if (!text) return "This is clearer and more concise.";
    return text.replace(/\bkind of\b/gi, "somewhat").replace(/\breally\b/gi, "").replace(/\bvery\b/gi, "").replace(/\s+/g, " ").trim();
  }
  function continueSentence(text) {
    const lower = text.toLowerCase();
    if (lower.includes("thank")) {
      return " I appreciate your help and look forward to hearing from you.";
    }
    if (lower.includes("schedule") || lower.includes("meeting")) {
      return " Does tomorrow afternoon work for you?";
    }
    if (lower.includes("please")) {
      return " when you have a chance.";
    }
    return " Let me know what you think.";
  }

  // src/content/sentenceDetector.js
  function handleTextIntent(el) {
    if (el?.tagName !== "TEXTAREA") return null;
    if (el.selectionStart !== el.selectionEnd) {
      const selection = getActiveSelection(el);
      return selection ? { type: "selection", payload: selection.text } : null;
    }
    const sentence = extractLastSentence(el.value);
    return sentence ? { type: "cursor", payload: sentence } : null;
  }
  function extractLastSentence(text) {
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 5);
    return sentences.length ? sentences[sentences.length - 1] : null;
  }
  function getActiveSelection(el) {
    if (el?.tagName !== "TEXTAREA") return null;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > el.value.length || start >= end) return null;
    const text = el.value.slice(start, end);
    if (text.length > MAX_PAYLOAD_CHARS || text.trim().split(/\s+/).length < 5) return null;
    return { text };
  }

  // src/content/suggestionSession.js
  var nextId = 0;
  var current = null;
  var dismissed = null;
  var composing = /* @__PURE__ */ new WeakSet();
  var dispose = null;
  var endListeners = /* @__PURE__ */ new Set();
  function isEligibleTextarea(owner) {
    return owner?.tagName === "TEXTAREA" && owner.isConnected && document.activeElement === owner && document.hasFocus() && !owner.disabled && !owner.readOnly && !composing.has(owner);
  }
  function isSafeEdit(owner, intent) {
    if (typeof intent?.payload !== "string" || !intent.payload.trim()) return false;
    if (intent?.type === "cursor") return owner.selectionStart === owner.selectionEnd;
    if (intent?.type !== "selection") return false;
    const selection = getActiveSelection(owner);
    return Boolean(selection && selection.text === intent.payload);
  }
  function matchesSnapshot(session) {
    const owner = session.owner;
    return isEligibleTextarea(owner) && owner.value === session.text && owner.selectionStart === session.start && owner.selectionEnd === session.end && owner.selectionDirection === session.direction;
  }
  function getCurrentSession() {
    return current;
  }
  function onSessionEnd(listener) {
    endListeners.add(listener);
    return () => endListeners.delete(listener);
  }
  function finishSession(session, status = "invalidated") {
    if (!session || session !== current || !["pending", "visible"].includes(session.status) || !["accepted", "dismissed", "invalidated"].includes(status)) return false;
    if (status === "accepted" && (session.status !== "visible" || !isSessionValid(session))) return false;
    session.status = status;
    current = null;
    if (status === "dismissed") dismissed = session;
    for (const listener of endListeners) listener(session);
    return true;
  }
  function invalidateSession() {
    if (current) finishSession(current);
  }
  function beginSession(owner, intent) {
    if (!isEligibleTextarea(owner) || !isSafeEdit(owner, intent)) return null;
    if (dismissed && matchesSnapshot(dismissed)) return null;
    dismissed = null;
    invalidateSession();
    current = {
      id: ++nextId,
      owner,
      text: owner.value,
      start: owner.selectionStart,
      end: owner.selectionEnd,
      direction: owner.selectionDirection,
      intent: { ...intent },
      status: "pending"
    };
    return current;
  }
  function isSessionValid(session) {
    if (!session || session !== current || !["pending", "visible"].includes(session.status)) return false;
    const valid = matchesSnapshot(session) && isSafeEdit(session.owner, session.intent);
    if (!valid) finishSession(session);
    return valid;
  }
  function markVisible(session) {
    if (!isSessionValid(session) || session.status !== "pending") return false;
    session.status = "visible";
    return true;
  }
  function initSuggestionSessions() {
    if (dispose) return dispose;
    const cleanups = [];
    const listen = (target, name, fn) => {
      target.addEventListener(name, fn, true);
      cleanups.push(() => target.removeEventListener(name, fn, true));
    };
    const ownerChanged = (event) => {
      if (dismissed?.owner === event.target) dismissed = null;
      if (current?.owner === event.target) invalidateSession();
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
      if (event.target?.tagName !== "TEXTAREA") return;
      composing.add(event.target);
      ownerChanged(event);
    });
    listen(document, "compositionend", (event) => composing.delete(event.target));
    listen(window, "blur", () => {
      dismissed = null;
      invalidateSession();
    });
    const observer = new MutationObserver(() => {
      if (dismissed && !dismissed.owner.isConnected) dismissed = null;
      if (current && !current.owner.isConnected) invalidateSession();
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    const cleanup = () => {
      if (dispose !== cleanup) return;
      cleanups.forEach((fn) => fn());
      observer.disconnect();
      dismissed = null;
      composing = /* @__PURE__ */ new WeakSet();
      invalidateSession();
      dispose = null;
    };
    dispose = cleanup;
    return cleanup;
  }

  // src/content/inputTracker.js
  function attachInputTracker(el, onSentenceDetected) {
    if (el.tagName !== "TEXTAREA") return;
    let typingTimer = null;
    const cancelTimer = () => {
      clearTimeout(typingTimer);
      typingTimer = null;
    };
    el.addEventListener("focusout", cancelTimer);
    el.addEventListener("compositionstart", cancelTimer);
    const onInput = (event) => {
      cancelTimer();
      if (event.isComposing || !isEligibleTextarea(el)) return;
      typingTimer = setTimeout(() => {
        typingTimer = null;
        if (!isEligibleTextarea(el)) return;
        const intent = handleTextIntent(el);
        if (intent) onSentenceDetected(intent, el);
      }, 700);
    };
    el.addEventListener("input", onInput);
    return () => {
      cancelTimer();
      el.removeEventListener("input", onInput);
      el.removeEventListener("focusout", cancelTimer);
      el.removeEventListener("compositionstart", cancelTimer);
    };
  }

  // src/content/observer.js
  function initObserver(onSentenceDetected) {
    const tracked = /* @__PURE__ */ new Map();
    let stopped = false;
    let scheduled = false;
    let frame = null;
    const scan = () => {
      if (stopped) return;
      for (const [el, cleanup] of tracked) {
        if (!el.isConnected) {
          cleanup();
          tracked.delete(el);
        }
      }
      document.querySelectorAll("textarea").forEach((el) => {
        if (!tracked.has(el)) tracked.set(el, attachInputTracker(el, onSentenceDetected));
      });
    };
    const observer = new MutationObserver(() => {
      if (scheduled || stopped) return;
      scheduled = true;
      frame = requestAnimationFrame(() => {
        scheduled = false;
        scan();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
    scan();
    return () => {
      if (stopped) return;
      stopped = true;
      observer.disconnect();
      if (frame !== null) cancelAnimationFrame(frame);
      tracked.forEach((cleanup) => cleanup());
      tracked.clear();
    };
  }

  // src/content/suggestionUI.js
  var preview = null;
  var dispose2 = null;
  function clearPreview() {
    if (!preview) return;
    preview.session.owner.removeEventListener("scroll", updateGhostPosition);
    preview.element.remove();
    preview = null;
  }
  function removeGhost() {
    if (preview) finishSession(preview.session);
    clearPreview();
  }
  function showGhost(session, suggestion) {
    if (!dispose2 || typeof suggestion !== "string" || !suggestion || session?.status !== "pending" || !isSessionValid(session)) return false;
    removeGhost();
    const element = document.createElement("div");
    element.textContent = suggestion;
    element.className = "inline-ai-ghost";
    element.setAttribute("aria-hidden", "true");
    Object.assign(element.style, {
      position: "absolute",
      opacity: "0.4",
      pointerEvents: "none",
      font: getComputedStyle(session.owner).font,
      whiteSpace: "pre",
      zIndex: "2147483647"
    });
    preview = { session, element, suggestion };
    try {
      document.body.appendChild(element);
      updateGhostPosition();
      session.owner.addEventListener("scroll", updateGhostPosition);
      return markVisible(session);
    } catch (error) {
      removeGhost();
      throw error;
    }
  }
  function acceptGhost() {
    const active = preview;
    if (!active || active.session.status !== "visible" || !isSessionValid(active.session)) return false;
    const { owner, text, start, end, intent } = active.session;
    if (intent.type === "cursor" && start !== end) return false;
    if (!finishSession(active.session, "accepted")) return false;
    owner.value = text.slice(0, start) + active.suggestion + text.slice(end);
    owner.selectionStart = owner.selectionEnd = start + active.suggestion.length;
    owner.dispatchEvent(new Event("input", { bubbles: true }));
    return true;
  }
  function updateGhostPosition() {
    if (!preview) return;
    const caret = getCaretCoordinates(preview.session.owner);
    preview.element.style.left = caret.left + "px";
    preview.element.style.top = caret.top + "px";
  }
  function getCaretCoordinates(el) {
    const mirror = document.createElement("div");
    const style = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    for (const prop of style) {
      mirror.style[prop] = style[prop];
    }
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.overflow = "hidden";
    mirror.style.left = rect.left + window.scrollX + "px";
    mirror.style.top = rect.top + window.scrollY + "px";
    mirror.style.width = rect.width + "px";
    mirror.style.height = rect.height + "px";
    mirror.textContent = el.value.slice(0, el.selectionStart ?? el.value.length);
    const marker = document.createElement("span");
    marker.textContent = "\u200B";
    mirror.appendChild(marker);
    document.body.appendChild(mirror);
    const markerRect = marker.getBoundingClientRect();
    document.body.removeChild(mirror);
    return {
      left: markerRect.left + window.scrollX,
      top: markerRect.top + window.scrollY
    };
  }
  function handleKeydown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key !== "Tab" && event.key !== "Escape") return;
    const session = preview?.session;
    if (!session || session.status !== "visible" || !isSessionValid(session) || event.target !== session.owner) return;
    if (event.key === "Tab" && acceptGhost()) event.preventDefault();
    if (event.key === "Escape") finishSession(session, "dismissed");
  }
  function initSuggestionUI() {
    if (dispose2) return dispose2;
    const unsubscribe = onSessionEnd((session) => {
      if (preview?.session === session) clearPreview();
    });
    document.addEventListener("keydown", handleKeydown);
    const cleanup = () => {
      if (dispose2 !== cleanup) return;
      removeGhost();
      document.removeEventListener("keydown", handleKeydown);
      unsubscribe();
      dispose2 = null;
    };
    dispose2 = cleanup;
    return cleanup;
  }

  // src/content/contentScript.js
  async function handleSentence(intent, el) {
    if (!intent || !isEligibleTextarea(el)) return;
    const active = getCurrentSession();
    if (isSessionValid(active) && active.owner === el && active.intent.type === intent.type && active.intent.payload === intent.payload) return;
    const request = normalizeSuggestionRequest(intent, {
      url: location.href,
      host: location.host,
      editableKind: "textarea"
    });
    if (!request) return;
    const session = beginSession(el, intent);
    if (!session) return;
    const suggestion = await requestSuggestion(request);
    if (!isSessionValid(session)) return;
    if (!suggestion) {
      invalidateSession();
      return;
    }
    try {
      showGhost(session, suggestion);
    } catch (error) {
      invalidateSession();
      console.error("[Inline-AI] Failed to render suggestion:", error);
    }
  }
  async function requestSuggestion(request) {
    if (!globalThis.chrome?.runtime?.sendMessage) return getDummySuggestion(request);
    try {
      const response = await chrome.runtime.sendMessage({ type: SUGGESTION_MESSAGE, request });
      return response?.suggestion || getDummySuggestion(request);
    } catch (error) {
      console.warn("[Inline-AI] Falling back to dummy suggestion:", error);
      return getDummySuggestion(request);
    }
  }
  function handleSelectionChange() {
    const el = document.activeElement;
    if (!isEligibleTextarea(el)) return;
    const intent = handleTextIntent(el);
    if (intent?.type === "selection") handleSentence(intent, el);
  }
  var dispose3 = null;
  function initContentScript() {
    if (dispose3) return dispose3;
    const stopSessions = initSuggestionSessions();
    const stopUI = initSuggestionUI();
    let stopObserver;
    try {
      stopObserver = initObserver(handleSentence);
    } catch (error) {
      stopSessions();
      stopUI();
      throw error;
    }
    document.addEventListener("selectionchange", handleSelectionChange);
    const cleanup = () => {
      if (dispose3 !== cleanup) return;
      document.removeEventListener("selectionchange", handleSelectionChange);
      stopObserver();
      stopSessions();
      stopUI();
      dispose3 = null;
    };
    dispose3 = cleanup;
    return cleanup;
  }
  try {
    initContentScript();
    console.log("[Inline-AI] Content script initialized");
  } catch (error) {
    console.error("[Inline-AI] Failed to initialize:", error);
  }
})();
