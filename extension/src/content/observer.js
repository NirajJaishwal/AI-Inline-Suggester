import { attachInputTracker } from "./inputTracker.js";

// P0.1.1: discover native textareas only; retain teardown for every attached tracker.
export function initObserver(onSentenceDetected) {
  const tracked = new Map();
  let stopped = false;
  let scheduled = false;
  let frame = null;
  const scan = () => {
    if (stopped) return;
    for (const [el, cleanup] of tracked) {
      if (!el.isConnected) { cleanup(); tracked.delete(el); }
    }
    document.querySelectorAll("textarea").forEach(el => {
      if (!tracked.has(el)) tracked.set(el, attachInputTracker(el, onSentenceDetected));
    });
  };
  const observer = new MutationObserver(() => {
    if (scheduled || stopped) return;
    scheduled = true;
    frame = requestAnimationFrame(() => {
      scheduled = false;
      scan();
    });
  });
  observer.observe(document.body, { childList: true, subtree: true });
  scan();
  return () => {
    if (stopped) return;
    stopped = true;
    observer.disconnect();
    if (frame !== null) cancelAnimationFrame(frame);
    tracked.forEach(cleanup => cleanup());
    tracked.clear();
  };
}
