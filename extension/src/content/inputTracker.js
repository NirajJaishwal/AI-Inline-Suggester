// Purpose:
// Tracks real-time typing behavior.

// Stores:

// Last keystroke timestamp

// Active editable element

// Cursor position

// Current text snapshot

// Why this matters:

// You can’t do sentence-level AI without understanding where the user is typing.

import { handleTextIntent } from "./sentenceDetector.js";
import { removeGhost } from "./suggestionUI.js";
import {state} from "./contentScript.js";


export function attachInputTracker(el, onSentenceDetected) {
  let typingTimer = null;

  el.addEventListener("input", () => {
    if (document.activeElement !== el) return;

    state.isUserTyping = true;
    removeGhost();
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => {
      state.isUserTyping = false;
      if (state.isRenderingGhost) return;
      const intent = handleTextIntent(el);
      if (intent) {
        onSentenceDetected(intent, el);
      }
    }, 700);
  });
}
