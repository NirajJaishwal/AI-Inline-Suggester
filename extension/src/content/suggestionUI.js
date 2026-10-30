import { isSessionValid, markVisible, finishSession, onSessionEnd } from "./suggestionSession.js";

// One preview record; its session is the only source of editor/target ownership.
let preview = null;
let dispose = null;

export function hasGhost() { return Boolean(preview); }

function clearPreview() {
  if (!preview) return;
  preview.session.owner.removeEventListener("scroll", updateGhostPosition);
  preview.element.remove();
  preview = null;
}

export function removeGhost() {
  if (preview) finishSession(preview.session);
  clearPreview();
}

export function showGhost(session, suggestion) {
  if (!dispose || typeof suggestion !== "string" || !suggestion ||
      session?.status !== "pending" || !isSessionValid(session)) return false;
  removeGhost();
  const element = document.createElement("div");
  element.textContent = suggestion;
  element.className = "inline-ai-ghost";
  element.setAttribute("aria-hidden", "true");
  Object.assign(element.style, {
    position: "absolute", opacity: "0.4", pointerEvents: "none",
    font: getComputedStyle(session.owner).font, whiteSpace: "pre", zIndex: "2147483647",
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

export function acceptGhost() {
  const active = preview;
  if (!active || active.session.status !== "visible" || !isSessionValid(active.session)) return false;
  const { owner, text, start, end, intent } = active.session;
  if (intent.type === "cursor" && start !== end) return false;
  // Consume before editing. Never read replacement text back from host-accessible DOM.
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
  marker.textContent = "\u200b";
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const markerRect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);

  return {
    left: markerRect.left + window.scrollX,
    top: markerRect.top + window.scrollY,
  };
}

function handleKeydown(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key !== "Tab" && event.key !== "Escape") return;
  const session = preview?.session;
  if (!session || session.status !== "visible" || !isSessionValid(session) ||
      event.target !== session.owner) return;
  if (event.key === "Tab" && acceptGhost()) event.preventDefault();
  if (event.key === "Escape") finishSession(session, "dismissed");
}

export function initSuggestionUI() {
  if (dispose) return dispose;
  const unsubscribe = onSessionEnd(session => {
    if (preview?.session === session) clearPreview();
  });
  document.addEventListener("keydown", handleKeydown);
  const cleanup = () => {
    if (dispose !== cleanup) return;
    removeGhost();
    document.removeEventListener("keydown", handleKeydown);
    unsubscribe();
    dispose = null;
  };
  dispose = cleanup;
  return cleanup;
}
