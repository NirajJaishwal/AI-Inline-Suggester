export const SUGGESTION_MESSAGE = "INLINE_AI_GET_SUGGESTION";

export const INTENT_TYPES = {
  CURSOR: "cursor",
  SELECTION: "selection",
};

export const MAX_PAYLOAD_CHARS = 900;

// A rewrite payload describes the entire replacement target: never truncate it.
export function normalizeSuggestionRequest(intent, pageContext = {}) {
  const type = intent?.type || INTENT_TYPES.CURSOR;
  const raw = String(intent?.payload || "");
  if (![INTENT_TYPES.CURSOR, INTENT_TYPES.SELECTION].includes(type)) return null;
  if (type === INTENT_TYPES.SELECTION && raw.length > MAX_PAYLOAD_CHARS) return null;
  const payload = type === INTENT_TYPES.SELECTION ? raw : raw.trim().slice(0, MAX_PAYLOAD_CHARS);
  if (!payload.trim()) return null;
  return {
    type,
    payload,
    context: {
      url: pageContext.url || "",
      host: pageContext.host || "",
      editableKind: pageContext.editableKind || "unknown",
    },
  };
}

export function getDummySuggestion(request) {
  const text = request?.payload || "";

  if (request?.type === INTENT_TYPES.SELECTION) {
    return compactRewrite(text);
  }

  return continueSentence(text);
}

function compactRewrite(text) {
  if (!text) return "This is clearer and more concise.";

  return text
    .replace(/\bkind of\b/gi, "somewhat")
    .replace(/\breally\b/gi, "")
    .replace(/\bvery\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();
}

function continueSentence(text) {
  const lower = text.toLowerCase();

  if (lower.includes("thank")) {
    return " I appreciate your help and look forward to hearing from you.";
  }

  if (lower.includes("schedule") || lower.includes("meeting")) {
    return " Does tomorrow afternoon work for you?";
  }

  if (lower.includes("please")) {
    return " when you have a chance.";
  }

  return " Let me know what you think.";
}
