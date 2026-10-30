import { resolveEditorAdapter, resolveEditorOwner } from "./editors/index.js";
import { handleTextIntent } from "./sentenceDetector.js";
import { isEligibleEditor } from "./suggestionSession.js";

export function attachInputTracker(el, onSentenceDetected) {
  if (!resolveEditorAdapter(el)) return;
  let typingTimer = null;
  const cancelTimer = () => {
    clearTimeout(typingTimer);
    typingTimer = null;
  };
  el.addEventListener("focusout", cancelTimer);
  el.addEventListener("compositionstart", cancelTimer);
  const onInput = (event) => {
    if (resolveEditorOwner(event.target) !== el) return;
    cancelTimer();
    if (event.isComposing || !isEligibleEditor(el)) return;
    typingTimer = setTimeout(() => {
      typingTimer = null;
      if (!isEligibleEditor(el)) return;
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
