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

const trackedEditables = new WeakSet();
export function initObserver(onSentenceDetected) {
  let scheduled = false;
    const observer = new MutationObserver(() => {
      if (scheduled) return;
      scheduled = true;

      requestAnimationFrame(() => {
        scanforEditableElements(onSentenceDetected);
        scheduled = false;
      });
    });

    observer.observe(document.body, {
        childList: true,
        subtree: true,
    });

    scanforEditableElements(onSentenceDetected);
}


function scanforEditableElements(onSentenceDetected) {
  document
    .querySelectorAll('textarea, [contenteditable="true"]')
    .forEach((el) => {
      if (trackedEditables.has(el)) return;
      trackedEditables.add(el);
      attachInputTracker(el, onSentenceDetected);
    });
}
