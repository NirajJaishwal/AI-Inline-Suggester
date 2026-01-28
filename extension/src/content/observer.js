// Purpose:
// Detect dynamically created text inputs.

// Handles:

// <textarea>

// contenteditable="true"

// Uses:

// MutationObserver

// Why it exists:

// Gmail, Outlook, Notion dynamically mount editors—this keeps you future-proof.

import { attachInputTracker } from "./inputTracker.js";

export function initObserver(onSentenceDetected) {
    const observer = new MutationObserver(() => {
        scanforEditableElements(onSentenceDetected);
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    scanforEditableElements(onSentenceDetected);
}


function scanforEditableElements(onSentenceDetected) {
    let activeEditable = null;
  document
    .querySelectorAll('textarea, [contenteditable="true"]')
    .forEach((el) => {
      if (!el.inlineAiAttached) {
        el.inlineAiAttached = true;

        el.addEventListener("focus", () => {
          activeEditable = el;
        });

        el.addEventListener("blur", () => {
          if (activeEditable === el) {
            activeEditable = null;
          }
        });

        attachInputTracker(el, onSentenceDetected);
      }
    });
}
