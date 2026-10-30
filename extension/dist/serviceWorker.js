// src/shared/suggestionRequest.js
var SUGGESTION_MESSAGE = "INLINE_AI_GET_SUGGESTION";
var INTENT_TYPES = {
  CURSOR: "cursor",
  SELECTION: "selection"
};
function getDummySuggestion(request) {
  const text = request?.payload || "";
  if (request?.type === INTENT_TYPES.SELECTION) {
    return compactRewrite(text);
  }
  return continueSentence(text);
}
function compactRewrite(text) {
  if (!text) return "This is clearer and more concise.";
  return text.replace(/\bkind of\b/gi, "somewhat").replace(/\breally\b/gi, "").replace(/\bvery\b/gi, "").replace(/\s+/g, " ").trim();
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

// src/background/serviceWorker.js
var USE_DUMMY_AI = true;
var cache = /* @__PURE__ */ new Map();
var inFlight = /* @__PURE__ */ new Map();
chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== SUGGESTION_MESSAGE) return false;
  getSuggestion(message.request).then((suggestion) => sendResponse({ suggestion })).catch((error) => {
    console.error("[Inline-AI] Suggestion failed:", error);
    sendResponse({ suggestion: getDummySuggestion(message.request) });
  });
  return true;
});
async function getSuggestion(request) {
  const key = createCacheKey(request);
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);
  const promise = USE_DUMMY_AI ? Promise.resolve(getDummySuggestion(request)) : requestOpenAISuggestion(request);
  inFlight.set(key, promise);
  try {
    const suggestion = await promise;
    cache.set(key, suggestion);
    trimCache();
    return suggestion;
  } finally {
    inFlight.delete(key);
  }
}
function createCacheKey(request) {
  return [
    request?.type || "",
    request?.context?.host || "",
    request?.payload || ""
  ].join("::");
}
function trimCache() {
  const maxEntries = 50;
  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}
async function requestOpenAISuggestion(request) {
  return getDummySuggestion(request);
}
