// Purpose:
// Bootstraps everything on page load.

// Responsibilities:

// Initialize DOM observers

// Attach input tracking

// Coordinate sentence detection + UI

// Think of it as the orchestrator.
import { initObserver } from "./observer.js";
import { removeGhost } from "./suggestionUI.js";
import { showGhost } from "./suggestionUI.js";
import { showGhostForRange } from "./suggestionUI.js";
import { getDummySuggestion } from "./suggestionUI.js";

export const state = {
  isUserTyping: false,
  lastIntentKey: "",
  isRenderingGhost: false
};

// Debounce and deduplicate renders
// function handleSentence(intent, el) {
//   if (state.isUserTyping || state.isRenderingGhost) return;
//   const now = Date.now();

//   if (now - lastRenderTime < 300) return;

//   const intentKey = intent.type + "::" + intent.payload.slice(0,200);
//   if (intentKey === state.lastIntentKey) return;
//   state.isRenderingGhost = true;
//   state.lastIntentKey = intentKey;
//   // lastRenderTime = now;

//   removeGhost();
//   if (intent.type === "selection") {
//     const suggestion = getDummySuggestion(intent);
//     showGhostForRange(intent.range, suggestion);
//     return;
//   }

//   if (intent.type === "cursor") {
//     const suggestion = getDummySuggestion(intent);
//     showGhost(el, suggestion);
//   }
//   // unlock After pain
//   requestAnimationFrame(() => {
//     state.isRenderingGhost = false;
//   });
// }

function handleSentence(intent, el) {
  if (state.isUserTyping || state.isRenderingGhost) return;

  // 🔥 DEDUPLICATION KEY
  const intentKey = intent.type + "::" + intent.payload.slice(0, 200);
  // const intentKey =
  // intent.type +
  // "::" +
  // intent.payload.slice(0, 200) +
  // "::" +
  // Date.now();

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


// Initialize everything
try {
  initObserver(handleSentence);
  console.log("[Inline-AI] Content script initialized");
} catch (error) {
  console.error("[Inline-AI] Failed to initialize:", error);
}
