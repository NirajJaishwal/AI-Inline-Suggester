import { resolveEditorOwner } from "./editors/index.js";
import { isSessionValid, markVisible, finishSession, onSessionEnd } from "./suggestionSession.js";

// One preview record; its session is the only source of editor/target ownership.
let preview = null;
let dispose = null;

export function hasGhost() { return Boolean(preview); }

function clearPreview() {
  if (!preview) return;
  preview.session.snapshot.owner.removeEventListener("scroll", updateGhostPosition);
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
    font: getComputedStyle(session.snapshot.owner).font, whiteSpace: "pre", zIndex: "2147483647",
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

export function acceptGhost() {
  const active = preview;
  if (!active || active.session.status !== "visible" || !isSessionValid(active.session)) return false;
  const capability = active.session.adapter.getCapabilities(active.session.snapshot.owner)[active.session.snapshot.intent.type === "selection" ? "replaceSelection" : "insertText"];
  if (capability.status === "unsupported") return false;
  // Consume before editing; the adapter revalidates the immutable target before writing.
  if (!finishSession(active.session, "accepted")) return false;
  return active.session.adapter.apply(active.session.snapshot, active.suggestion);
}

function updateGhostPosition() {
  if (!preview) return;
  const caret = preview.session.adapter.getCaretRect(preview.session.snapshot);
  if (!caret) { removeGhost(); return; }
  preview.element.style.left = (caret.left + window.scrollX) + "px";
  preview.element.style.top = (caret.top + window.scrollY) + "px";
}

function handleKeydown(event) {
  if (event.defaultPrevented || event.isComposing || event.keyCode === 229 ||
      event.shiftKey || event.ctrlKey || event.altKey || event.metaKey) return;
  if (event.key !== "Tab" && event.key !== "Escape") return;
  const session = preview?.session;
  if (!session || session.status !== "visible" || !isSessionValid(session) ||
      resolveEditorOwner(event.target) !== session.snapshot.owner) return;
  if (event.key === "Tab" && acceptGhost()) event.preventDefault();
  if (event.key === "Escape") finishSession(session, "dismissed");
}

export function initSuggestionUI() {
  if (dispose) return dispose;
  const unsubscribe = onSessionEnd(session => {
    if (preview?.session === session) clearPreview();
  });
  document.addEventListener("keydown", handleKeydown);
  const hideRichPreview = () => {
    if (preview?.session.adapter.kind === "contenteditable") removeGhost();
  };
  document.addEventListener("scroll", hideRichPreview, true);
  window.addEventListener("resize", hideRichPreview);
  const cleanup = () => {
    if (dispose !== cleanup) return;
    removeGhost();
    document.removeEventListener("keydown", handleKeydown);
    document.removeEventListener("scroll", hideRichPreview, true);
    window.removeEventListener("resize", hideRichPreview);
    unsubscribe();
    dispose = null;
  };
  dispose = cleanup;
  return cleanup;
}
