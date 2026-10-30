import { handleTextIntent } from "./sentenceDetector.js";
import { isEligibleTextarea } from "./suggestionSession.js";

export function attachInputTracker(el, onSentenceDetected) {
  if (el.tagName !== "TEXTAREA") return;
  let typingTimer = null;
  const cancelTimer = () => {
    clearTimeout(typingTimer);
    typingTimer = null;
  };
  el.addEventListener("focusout", cancelTimer);
  el.addEventListener("compositionstart", cancelTimer);
  const onInput = (event) => {
    cancelTimer();
    if (event.isComposing || !isEligibleTextarea(el)) return;
    typingTimer = setTimeout(() => {
      typingTimer = null;
      if (!isEligibleTextarea(el)) return;
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
