// Purpose:
// Decides when a sentence is ready for AI.

// Logic:

// Sentence-ending punctuation

// Cursor at end of sentence

// User idle (debounced)

// Minimum length threshold

// This is the brainstem of your extension.

export function handleTextIntent(el) {

  const selection = getActiveSelection(el);
  if (selection) {
    return {
      type: "selection",
      payload: selection.text,
      range: selection.range
    };
  }
    const text = getText(el);
    if (!text) return null;

    const sentence = extractLastSentence(text);
    if (!sentence) return null;

    return {
      type: "cursor",
      payload: sentence
    };
}

function getText(el) {
    if (el.tagName === "TEXTAREA" || el.tagName === "INPUT") {
        return el.value;
    }

    // contenteeditable
    return el.innerText || el.textContent || "";

}

function extractLastSentence(text) {
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map(s => s.trim())
    .filter(s => s.length >= 5);

  return sentences.length ? sentences[sentences.length - 1] : null;
}

// export function getActiveSelection() {
//   const selection = window.getSelection();
//   if (!selection || selection.rangeCount === 0) return null;
//   if (selection.isCollapsed) return null;

//   const text = selection.toString().trim();
//   if (text.split(/\s+/).length < 5) return null;

//   return {text, range: selection.getRangeAt(0) };
// }

export function getActiveSelection(el) {
  // TEXTAREA / INPUT selection
  if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT")) {
    const start = el.selectionStart;
    const end = el.selectionEnd;

    if (start == null || end == null || start === end) return null;

    const text = el.value.slice(start, end).trim();
    if (text.split(/\s+/).length < 5) return null;

    return {
      text,
      range: null, // textarea has no DOM range
      source: "textarea"
    };
  }

  // CONTENTEDITABLE selection
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return null;
  if (selection.isCollapsed) return null;

  const text = selection.toString().trim();
  if (text.split(/\s+/).length < 5) return null;

  return {
    text,
    range: selection.getRangeAt(0),
    source: "contenteditable"
  };
}

