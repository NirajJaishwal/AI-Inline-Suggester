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

let lastSentence = "";
var lastRenderTime = 0;

function handleSentence(sentence, el) {
  if (sentence === lastSentence) return;

  const now = Date.now();
  if (now - lastRenderTime < 300) return;
  lastSentence = sentence;
  lastRenderTime = now;

  // console.log("[Inline-AI] Final sentence:", sentence);

  // render ghost text
  removeGhost();
  showGhost(el, sentence);

  // later:
  // send to AI
  // show suggestion UI
}

try {
  initObserver(handleSentence);
  console.log("[Inline-AI] Content script initialized");
} catch (error) {
  console.error("[Inline-AI] Failed to initialize:", error);
}

