// Purpose:
// Decides when a sentence is ready for AI.

// Logic:

// Sentence-ending punctuation

// Cursor at end of sentence

// User idle (debounced)

// Minimum length threshold

// This is the brainstem of your extension.

export function handleSentenceDetection(el) {
    const text = getText(el);
    if (!text) return;

    const sentence = extractLastSentence(text);
    if (!sentence) return;

    return sentence;
}

function getText(el) {
    if (el.tagName === "TEXTAREA") {
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
