import { MAX_PAYLOAD_CHARS } from "../shared/suggestionRequest.js";

// P0.1.1 supports textareas only. Caret-relative context is a later milestone.
export function handleTextIntent(el) {
  if (el?.tagName !== "TEXTAREA") return null;
  if (el.selectionStart !== el.selectionEnd) {
    const selection = getActiveSelection(el);
    return selection ? { type: "selection", payload: selection.text } : null;
  }
  const sentence = extractLastSentence(el.value);
  return sentence ? { type: "cursor", payload: sentence } : null;
}

function extractLastSentence(text) {
  const sentences = text.split(/(?<=[.!?])\s+/)
    .map(s => s.trim()).filter(s => s.length >= 5);
  return sentences.length ? sentences[sentences.length - 1] : null;
}

export function getActiveSelection(el) {
  if (el?.tagName !== "TEXTAREA") return null;
  const start = el.selectionStart;
  const end = el.selectionEnd;
  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 ||
      end > el.value.length || start >= end) return null;
  const text = el.value.slice(start, end);
  if (text.length > MAX_PAYLOAD_CHARS || text.trim().split(/\s+/).length < 5) return null;
  // Keep the exact selected text; trimming must not disguise an oversized target.
  return { text };
}
