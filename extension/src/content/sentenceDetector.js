import { resolveEditorAdapter } from "./editors/index.js";
import { MAX_PAYLOAD_CHARS } from "../shared/suggestionRequest.js";

// Native context retains its existing behavior; contenteditable context is caret-relative.
export function handleTextIntent(el) {
  const adapter = resolveEditorAdapter(el);
  el = adapter?.resolveOwner(el);
  const target = adapter?.readSelection(el);
  if (!target) return null;
  if (!target.collapsed) {
    const selection = getActiveSelection(el);
    return selection ? { type: "selection", payload: selection.text } : null;
  }
  const text = adapter.readText(el);
  const sentence = text ? extractLastSentence(text) : null;
  return sentence ? { type: "cursor", payload: sentence } : null;
}

function extractLastSentence(text) {
  const sentences = text.split(/(?<=[.!?])\s+/)
    .map(s => s.trim()).filter(s => s.length >= 5);
  return sentences.length ? sentences[sentences.length - 1] : null;
}

export function getActiveSelection(el) {
  const adapter = resolveEditorAdapter(el);
  const selection = adapter?.readSelection(adapter.resolveOwner(el));
  if (!selection || selection.collapsed) return null;
  const text = selection.text;
  if (text.length > MAX_PAYLOAD_CHARS || text.trim().split(/\s+/).length < 5) return null;
  return { text };
}
