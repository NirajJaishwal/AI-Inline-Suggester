// P0.1.1: only native textareas may own suggestions.
import { initObserver } from "./observer.js";
import { handleTextIntent } from "./sentenceDetector.js";
import { showGhost, initSuggestionUI } from "./suggestionUI.js";
import { beginSession, getCurrentSession, isEligibleTextarea, isSessionValid, invalidateSession, initSuggestionSessions } from "./suggestionSession.js";
import { getDummySuggestion, normalizeSuggestionRequest, SUGGESTION_MESSAGE } from "../shared/suggestionRequest.js";

export async function handleSentence(intent, el) {
  if (!intent || !isEligibleTextarea(el)) return;
  const active = getCurrentSession();
  if (isSessionValid(active) && active.owner === el &&
      active.intent.type === intent.type && active.intent.payload === intent.payload) return;
  const request = normalizeSuggestionRequest(intent, {
    url: location.href,
    host: location.host,
    editableKind: "textarea",
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

let dispose = null;
export function initContentScript() {
  if (dispose) return dispose;
  const stopSessions = initSuggestionSessions();
  const stopUI = initSuggestionUI();
  let stopObserver;
  try {
    stopObserver = initObserver(handleSentence);
  } catch (error) {
    stopSessions(); stopUI();
    throw error;
  }
  document.addEventListener("selectionchange", handleSelectionChange);
  const cleanup = () => {
    if (dispose !== cleanup) return;
    document.removeEventListener("selectionchange", handleSelectionChange);
    stopObserver();
    stopSessions();
    stopUI();
    dispose = null;
  };
  dispose = cleanup;
  return cleanup;
}

try {
  initContentScript();
  console.log("[Inline-AI] Content script initialized");
} catch (error) {
  console.error("[Inline-AI] Failed to initialize:", error);
}
