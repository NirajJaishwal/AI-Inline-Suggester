// Purpose:
// Tracks real-time typing behavior.

// Stores:

// Last keystroke timestamp

// Active editable element

// Cursor position

// Current text snapshot

// Why this matters:

// You can’t do sentence-level AI without understanding where the user is typing.

import { handleSentenceDetection } from "./sentenceDetector.js";

export function attachInputTracker(el, onSentenceDetected) {
  let typingTimer = null;

  el.addEventListener("input", () => {
    if (document.activeElement !== el) return;
    clearTimeout(typingTimer);

    typingTimer = setTimeout(() => {
      const sentence = handleSentenceDetection(el);

      if (sentence) {
        // 🔥 HERE is where it is finally used
        onSentenceDetected(sentence, el);
      }
    }, 700);
  });
}
