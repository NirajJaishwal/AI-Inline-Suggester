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

  // src/content/editors/nativeControl.js
  function resolveOwner(candidate) {
    return candidate?.tagName === "TEXTAREA" ? candidate : null;
  }
  function isEligible(owner, { composing: composing2 = false } = {}) {
    if (!resolveOwner(owner)) return false;
    const doc = owner.ownerDocument || document;
    return owner.isConnected && doc.activeElement === owner && doc.hasFocus() && !owner.disabled && !owner.readOnly && !composing2;
  }
  function readText(owner) {
    return resolveOwner(owner) ? owner.value : null;
  }
  function readSelection(owner) {
    if (!resolveOwner(owner)) return null;
    const start = owner.selectionStart;
    const end = owner.selectionEnd;
    if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end > owner.value.length || start > end) return null;
    return Object.freeze({
      start,
      end,
      direction: owner.selectionDirection,
      collapsed: start === end,
      text: owner.value.slice(start, end)
    });
  }
  function isSafeEdit(snapshot) {
    const { text, start, end, intent } = snapshot;
    if (typeof intent?.payload !== "string" || !intent.payload.trim()) return false;
    if (intent.type === "cursor") return start === end;
    if (intent.type !== "selection" || start === end || end - start > MAX_PAYLOAD_CHARS) return false;
    const selected = text.slice(start, end);
    return selected === intent.payload && selected.trim().split(/\s+/).length >= 5;
  }
  function capture(owner, intent, options) {
    if (!isEligible(owner, options)) return null;
    const selection = readSelection(owner);
    if (!selection) return null;
    const snapshot = Object.freeze({
      owner,
      text: owner.value,
      start: selection.start,
      end: selection.end,
      direction: selection.direction,
      intent: Object.freeze({ type: intent?.type, payload: intent?.payload })
    });
    return isSafeEdit(snapshot) ? snapshot : null;
  }
  function validate(snapshot, options) {
    if (!snapshot || !isEligible(snapshot.owner, options)) return false;
    const selection = readSelection(snapshot.owner);
    return Boolean(selection && snapshot.owner.value === snapshot.text && selection.start === snapshot.start && selection.end === snapshot.end && selection.direction === snapshot.direction && isSafeEdit(snapshot));
  }
  function apply(snapshot, suggestion, options) {
    if (typeof suggestion !== "string" || !suggestion || !validate(snapshot, options)) return false;
    const { owner, text, start, end } = snapshot;
    owner.value = text.slice(0, start) + suggestion + text.slice(end);
    owner.selectionStart = owner.selectionEnd = start + suggestion.length;
    const EventType = owner.ownerDocument?.defaultView?.Event || Event;
    owner.dispatchEvent(new EventType("input", { bubbles: true }));
    return true;
  }
  var supported = Object.freeze({ status: "supported" });
  var unverifiedEdit = Object.freeze({
    status: "experimental",
    reason: "Existing direct-value strategy; native undo and host-model reconciliation are unverified."
  });
  var capabilities = Object.freeze({
    readText: supported,
    readSelection: supported,
    preview: Object.freeze({ status: "experimental", reason: "Existing mirror geometry; browser layout unverified." }),
    insertText: unverifiedEdit,
    replaceSelection: unverifiedEdit,
    undoRedo: Object.freeze({ status: "unsupported", reason: "No verified undo-preserving strategy." })
  });
  var unsupported = Object.freeze({ status: "unsupported", reason: "A1 supports native textareas only." });
  var unsupportedCapabilities = Object.freeze(Object.fromEntries(
    Object.keys(capabilities).map((key) => [key, unsupported])
  ));
  var nativeControlAdapter = Object.freeze({
    id: "native-textarea",
    kind: "textarea",
    selector: "textarea",
    resolveOwner,
    isEligible,
    readText,
    readSelection,
    capture,
    validate,
    getCaretRect,
    apply,
    getCapabilities: (owner) => resolveOwner(owner) ? capabilities : unsupportedCapabilities
  });
  function getCaretRect(snapshot) {
    if (!validate(snapshot)) return null;
    const el = snapshot.owner;
    const doc = el.ownerDocument || document;
    const view = doc.defaultView || window;
    const mirror = doc.createElement("div");
    const style = view.getComputedStyle ? view.getComputedStyle(el) : getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    for (const prop of style) {
      mirror.style[prop] = style[prop];
    }
    mirror.style.position = "absolute";
    mirror.style.visibility = "hidden";
    mirror.style.whiteSpace = "pre-wrap";
    mirror.style.wordWrap = "break-word";
    mirror.style.overflow = "hidden";
    mirror.style.left = rect.left + view.scrollX + "px";
    mirror.style.top = rect.top + view.scrollY + "px";
    mirror.style.width = rect.width + "px";
    mirror.style.height = rect.height + "px";
    mirror.textContent = el.value.slice(0, snapshot.start);
    const marker = doc.createElement("span");
    marker.textContent = "\u200B";
    mirror.appendChild(marker);
    doc.body.appendChild(mirror);
    try {
      const rect2 = marker.getBoundingClientRect();
      return { left: rect2.left, top: rect2.top };
    } finally {
      mirror.remove();
    }
  }

  // src/content/editors/contenteditable.js
  var watches = /* @__PURE__ */ new WeakMap();
  var generation = 0;
  var NODE_BUDGET = 512;
  var blocked = '[contenteditable="false"], [hidden], [inert], [data-sensitive], [aria-disabled="true"], [aria-readonly="true"], input, textarea, select, button, script, style';
  var blocks = /* @__PURE__ */ new Set(["DIV", "P", "LI", "PRE", "BLOCKQUOTE", "TD", "TH", "H1", "H2", "H3", "H4", "H5", "H6"]);
  function elementFor(node) {
    return node?.nodeType === 3 ? node.parentElement : node;
  }
  function resolveOwner2(candidate) {
    let el = elementFor(candidate);
    if (!el?.ownerDocument || !el.getAttribute || !el.isContentEditable || el.closest?.("input, textarea, select, button")) return null;
    const doc = el.ownerDocument;
    if (el.getRootNode && el.getRootNode() !== doc) return null;
    while (el.parentElement?.isContentEditable) el = el.parentElement;
    const value = el.getAttribute("contenteditable");
    return value !== null && ["", "true", "plaintext-only"].includes(value.toLowerCase()) ? el : null;
  }
  function isEligible2(owner, { composing: composing2 = false } = {}) {
    if (!owner || resolveOwner2(owner) !== owner || !owner.isConnected || composing2 || owner.closest('[hidden], [inert], [data-sensitive], [aria-disabled="true"], [aria-readonly="true"]')) return false;
    const doc = owner.ownerDocument;
    return doc.hasFocus() && resolveOwner2(doc.activeElement) === owner;
  }
  function processRecords(state, records) {
    if (!records.length) return;
    state.revision++;
    for (const listener of state.listeners) listener();
  }
  function observe(owner, onChange) {
    if (resolveOwner2(owner) !== owner) return () => {
    };
    let state = watches.get(owner);
    if (!state) {
      state = { generation: ++generation, revision: 0, listeners: /* @__PURE__ */ new Set() };
      const Observer = owner.ownerDocument.defaultView.MutationObserver;
      state.observer = new Observer((records) => processRecords(state, records));
      state.observer.observe(owner, { childList: true, subtree: true, characterData: true, attributes: true });
      watches.set(owner, state);
    }
    state.listeners.add(onChange);
    let stopped = false;
    return () => {
      if (stopped) return;
      stopped = true;
      state.listeners.delete(onChange);
      if (!state.listeners.size) {
        state.observer.disconnect();
        watches.delete(owner);
      }
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
    let current2 = el;
    while (current2 && current2 !== owner) {
      if (current2.isContentEditable === false || current2.matches?.(blocked)) return true;
      current2 = current2.parentElement;
    }
    return false;
  }
  function readSelection2(owner) {
    if (!isEligible2(owner)) return null;
    const selection = owner.ownerDocument.defaultView.getSelection();
    if (!selection || selection.rangeCount !== 1) return null;
    const range = selection.getRangeAt(0);
    for (const node of [selection.anchorNode, selection.focusNode, range.startContainer, range.endContainer]) {
      if (resolveOwner2(node) !== owner || protectedNode(node, owner)) return null;
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
      text = range.toString();
      if (text.length > MAX_PAYLOAD_CHARS) return null;
    }
    return Object.freeze({
      anchorNode: selection.anchorNode,
      anchorOffset: selection.anchorOffset,
      focusNode: selection.focusNode,
      focusOffset: selection.focusOffset,
      startContainer: range.startContainer,
      startOffset: range.startOffset,
      endContainer: range.endContainer,
      endOffset: range.endOffset,
      collapsed: selection.isCollapsed,
      text
    });
  }
  function nextAfter(node, boundary) {
    while (node && node !== boundary) {
      if (node.nextSibling) return node.nextSibling;
      node = node.parentNode;
    }
    return null;
  }
  function readText2(owner) {
    const selection = readSelection2(owner);
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
  var endpointKeys = ["anchorNode", "anchorOffset", "focusNode", "focusOffset", "startContainer", "startOffset", "endContainer", "endOffset", "collapsed", "text"];
  function capture2(owner, intent, options) {
    if (!isEligible2(owner, options)) return null;
    const state = revision(owner), selection = readSelection2(owner);
    if (!state || !selection || typeof intent?.payload !== "string") return null;
    const text = selection.collapsed ? readText2(owner) : selection.text;
    if (!text || (selection.collapsed ? intent.type !== "cursor" || !text.trim().endsWith(intent.payload) : intent.type !== "selection" || intent.payload !== text || text.trim().split(/\s+/).length < 5)) return null;
    return Object.freeze({
      owner,
      text,
      selection,
      generation: state.generation,
      revision: state.revision,
      intent: Object.freeze({ type: intent.type, payload: intent.payload })
    });
  }
  function validate2(snapshot, options) {
    if (!snapshot || !isEligible2(snapshot.owner, options)) return false;
    const state = revision(snapshot.owner);
    if (!state || state.generation !== snapshot.generation || state.revision !== snapshot.revision) return false;
    const selection = readSelection2(snapshot.owner);
    return Boolean(selection && endpointKeys.every((key) => selection[key] === snapshot.selection[key]) && (selection.collapsed ? readText2(snapshot.owner) : selection.text) === snapshot.text);
  }
  function getCaretRect2(snapshot) {
    if (!validate2(snapshot)) return null;
    const doc = snapshot.owner.ownerDocument;
    const range = doc.createRange();
    const point = snapshot.selection;
    range.setStart(point.endContainer, point.endOffset);
    range.collapse(true);
    let rect = [...range.getClientRects()].find((r) => r.height > 0);
    if (!rect && point.endContainer.nodeType === 3 && point.endContainer.data.length) {
      const offset = point.endOffset;
      range.setStart(point.endContainer, offset ? offset - 1 : 0);
      range.setEnd(point.endContainer, offset || 1);
      rect = [...range.getClientRects()].find((r) => r.height > 0);
      if (rect) return { left: offset ? rect.right : rect.left, top: rect.top };
    }
    return rect ? { left: rect.left, top: rect.top } : null;
  }
  var experimental = Object.freeze({ status: "experimental", reason: "A3 DOM snapshot/preview only; model integration unverified." });
  var noInsertion = Object.freeze({ status: "unsupported", reason: "No verified contenteditable insertion strategy. A3 never edits." });
  var capabilities2 = Object.freeze({
    readText: experimental,
    readSelection: experimental,
    preview: experimental,
    insertText: noInsertion,
    replaceSelection: noInsertion,
    undoRedo: noInsertion
  });
  var contenteditableAdapter = Object.freeze({
    id: "contenteditable-preview",
    kind: "contenteditable",
    selector: "[contenteditable]",
    resolveOwner: resolveOwner2,
    isEligible: isEligible2,
    observe,
    readSelection: readSelection2,
    readText: readText2,
    capture: capture2,
    validate: validate2,
    getCaretRect: getCaretRect2,
    apply: () => false,
    getCapabilities: () => capabilities2
  });

  // src/content/editors/index.js
  var editorSelector = nativeControlAdapter.selector + ", " + contenteditableAdapter.selector;
  function resolveEditorAdapter(candidate) {
    if (nativeControlAdapter.resolveOwner(candidate)) return nativeControlAdapter;
    return contenteditableAdapter.resolveOwner(candidate) ? contenteditableAdapter : null;
  }
  function resolveEditorOwner(candidate) {
    return resolveEditorAdapter(candidate)?.resolveOwner(candidate) || null;
  }

  // src/content/suggestionSession.js
  var nextId = 0;
  var current = null;
  var dismissed = null;
  var composing = /* @__PURE__ */ new WeakSet();
  var dispose = null;
  var endListeners = /* @__PURE__ */ new Set();
  function isEligibleEditor(owner) {
    owner = resolveEditorOwner(owner);
    return Boolean(resolveEditorAdapter(owner)?.isEligible(owner, { composing: composing.has(owner) }));
  }
  function matchesSnapshot(session) {
    return session.adapter.validate(session.snapshot, { composing: composing.has(session.snapshot.owner) });
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
    if (status === "accepted" && (session.status !== "visible" || !isSessionValid(session) || session.adapter.getCapabilities(session.snapshot.owner)[session.snapshot.intent.type === "selection" ? "replaceSelection" : "insertText"].status === "unsupported")) return false;
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
  function isSessionValid(session) {
    if (!session || session !== current || !["pending", "visible"].includes(session.status)) return false;
    const valid = matchesSnapshot(session);
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
    listen(window, "blur", () => {
      dismissed = null;
      invalidateSession();
    });
    const observer = new MutationObserver(() => {
      if (dismissed && !dismissed.snapshot.owner.isConnected) dismissed = null;
      if (current && !current.snapshot.owner.isConnected) invalidateSession();
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
  function invalidateOwner(owner) {
    if (!owner) return;
    if (dismissed?.snapshot.owner === owner) dismissed = null;
    if (current?.snapshot.owner === owner) invalidateSession();
  }

  // src/content/sentenceDetector.js
  function handleTextIntent(el) {
    const adapter = resolveEditorAdapter(el);
    el = adapter?.resolveOwner(el);
    const target = adapter?.readSelection(el);
    if (!target) return null;
    if (!target.collapsed) {
      const selection = getActiveSelection(el);
      return selection ? { type: "selection", payload: selection.text } : null;
    }
    const text = adapter.readText(el);
    const sentence = text ? extractLastSentence(text) : null;
    return sentence ? { type: "cursor", payload: sentence } : null;
  }
  function extractLastSentence(text) {
    const sentences = text.split(/(?<=[.!?])\s+/).map((s) => s.trim()).filter((s) => s.length >= 5);
    return sentences.length ? sentences[sentences.length - 1] : null;
  }
  function getActiveSelection(el) {
    const adapter = resolveEditorAdapter(el);
    const selection = adapter?.readSelection(adapter.resolveOwner(el));
    if (!selection || selection.collapsed) return null;
    const text = selection.text;
    if (text.length > MAX_PAYLOAD_CHARS || text.trim().split(/\s+/).length < 5) return null;
    return { text };
  }

  // src/content/inputTracker.js
  function attachInputTracker(el, onSentenceDetected) {
    if (!resolveEditorAdapter(el)) return;
    let typingTimer = null;
    const cancelTimer = () => {
      clearTimeout(typingTimer);
      typingTimer = null;
    };
    el.addEventListener("focusout", cancelTimer);
    el.addEventListener("compositionstart", cancelTimer);
    const onInput = (event) => {
      if (resolveEditorOwner(event.target) !== el) return;
      cancelTimer();
      if (event.isComposing || !isEligibleEditor(el)) return;
      typingTimer = setTimeout(() => {
        typingTimer = null;
        if (!isEligibleEditor(el)) return;
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
        if (!el.isConnected || resolveEditorAdapter(el)?.resolveOwner(el) !== el) {
          cleanup();
          tracked.delete(el);
        }
      }
      document.querySelectorAll(editorSelector).forEach((candidate) => {
        const adapter = resolveEditorAdapter(candidate);
        const el = adapter?.resolveOwner(candidate);
        if (!el || tracked.has(el)) return;
        const stopInput = attachInputTracker(el, onSentenceDetected);
        const stopRevision = adapter.observe?.(el, () => invalidateOwner(el));
        tracked.set(el, () => {
          stopInput?.();
          stopRevision?.();
          invalidateOwner(el);
        });
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
    observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable"] });
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
    preview.session.snapshot.owner.removeEventListener("scroll", updateGhostPosition);
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
      font: getComputedStyle(session.snapshot.owner).font,
      whiteSpace: "pre",
      zIndex: "2147483647"
    });
    preview = { session, element, suggestion };
    try {
      document.body.appendChild(element);
      updateGhostPosition();
      if (!preview) return false;
      session.snapshot.owner.addEventListener("scroll", updateGhostPosition);
      return markVisible(session);
    } catch (error) {
      removeGhost();
      throw error;
    }
  }
  function acceptGhost() {
    const active = preview;
    if (!active || active.session.status !== "visible" || !isSessionValid(active.session)) return false;
    const capability = active.session.adapter.getCapabilities(active.session.snapshot.owner)[active.session.snapshot.intent.type === "selection" ? "replaceSelection" : "insertText"];
    if (capability.status === "unsupported") return false;
    if (!finishSession(active.session, "accepted")) return false;
    return active.session.adapter.apply(active.session.snapshot, active.suggestion);
  }
  function updateGhostPosition() {
    if (!preview) return;
    const caret = preview.session.adapter.getCaretRect(preview.session.snapshot);
    if (!caret) {
      removeGhost();
      return;
    }
    preview.element.style.left = caret.left + window.scrollX + "px";
    preview.element.style.top = caret.top + window.scrollY + "px";
  }
  function handleKeydown(event) {
    if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
    if (event.key !== "Tab" && event.key !== "Escape") return;
    const session = preview?.session;
    if (!session || session.status !== "visible" || !isSessionValid(session) || resolveEditorOwner(event.target) !== session.snapshot.owner) return;
    if (event.key === "Tab" && acceptGhost()) event.preventDefault();
    if (event.key === "Escape") finishSession(session, "dismissed");
  }
  function initSuggestionUI() {
    if (dispose2) return dispose2;
    const unsubscribe = onSessionEnd((session) => {
      if (preview?.session === session) clearPreview();
    });
    document.addEventListener("keydown", handleKeydown);
    const hideRichPreview = () => {
      if (preview?.session.adapter.kind === "contenteditable") removeGhost();
    };
    document.addEventListener("scroll", hideRichPreview, true);
    window.addEventListener("resize", hideRichPreview);
    const cleanup = () => {
      if (dispose2 !== cleanup) return;
      removeGhost();
      document.removeEventListener("keydown", handleKeydown);
      document.removeEventListener("scroll", hideRichPreview, true);
      window.removeEventListener("resize", hideRichPreview);
      unsubscribe();
      dispose2 = null;
    };
    dispose2 = cleanup;
    return cleanup;
  }

  // src/content/contentScript.js
  async function handleSentence(intent, el) {
    el = resolveEditorOwner(el);
    if (!intent || !isEligibleEditor(el)) return;
    const active = getCurrentSession();
    if (isSessionValid(active) && active.snapshot.owner === el && active.snapshot.intent.type === intent.type && active.snapshot.intent.payload === intent.payload) return;
    const request = normalizeSuggestionRequest(intent, {
      url: location.href,
      host: location.host,
      editableKind: resolveEditorAdapter(el).kind
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
    const el = resolveEditorOwner(document.activeElement);
    if (!isEligibleEditor(el)) return;
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
