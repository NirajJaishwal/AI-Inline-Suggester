// Purpose:
// Non-blocking suggestion provider. Content scripts detect text intent; this
// worker handles caching, request coalescing, and the eventual AI/backend call.
import { getDummySuggestion, SUGGESTION_MESSAGE } from "../shared/suggestionRequest.js";

const USE_DUMMY_AI = true;
const cache = new Map();
const inFlight = new Map();

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type !== SUGGESTION_MESSAGE) return false;

  getSuggestion(message.request)
    .then((suggestion) => sendResponse({ suggestion }))
    .catch((error) => {
      console.error("[Inline-AI] Suggestion failed:", error);
      sendResponse({ suggestion: getDummySuggestion(message.request) });
    });

  return true;
});

async function getSuggestion(request) {
  const key = createCacheKey(request);
  if (cache.has(key)) return cache.get(key);
  if (inFlight.has(key)) return inFlight.get(key);

  const promise = USE_DUMMY_AI
    ? Promise.resolve(getDummySuggestion(request))
    : requestOpenAISuggestion(request);

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
    request?.payload || "",
  ].join("::");
}

function trimCache() {
  const maxEntries = 50;

  while (cache.size > maxEntries) {
    cache.delete(cache.keys().next().value);
  }
}

async function requestOpenAISuggestion(request) {
  // Local testing only:
  // 1. Set USE_DUMMY_AI to false.
  // 2. Paste your key below.
  // 3. Add https://api.openai.com/* to manifest host_permissions.
  //
  // Shipping a browser extension with a client-side API key is not safe.
  // For production, call your own backend and keep the key on the server.
  //
  // const OPENAI_API_KEY = "sk-your-key-here";
  // const response = await fetch("https://api.openai.com/v1/responses", {
  //   method: "POST",
  //   headers: {
  //     "Content-Type": "application/json",
  //     Authorization: `Bearer ${OPENAI_API_KEY}`,
  //   },
  //   body: JSON.stringify({
  //     model: request.type === "selection" ? "gpt-5-mini" : "gpt-5-nano",
  //     max_output_tokens: request.type === "selection" ? 120 : 40,
  //     input: [
  //       {
  //         role: "system",
  //         content:
  //           "You are an inline writing assistant. Return only the text to insert. No explanations.",
  //       },
  //       {
  //         role: "user",
  //         content: JSON.stringify({
  //           task: request.type === "selection" ? "rewrite_selected_text" : "continue_text",
  //           text: request.payload,
  //           context: request.context,
  //         }),
  //       },
  //     ],
  //   }),
  // });
  //
  // if (!response.ok) throw new Error(`OpenAI request failed: ${response.status}`);
  // const data = await response.json();
  // return data.output_text?.trim() || "";

  return getDummySuggestion(request);
}
