import { editorSelector, resolveEditorAdapter } from "./editors/index.js";
import { invalidateOwner } from "./suggestionSession.js";
import { attachInputTracker } from "./inputTracker.js";

// Discover canonical editing hosts; each host owns its trackers and revision observer.
export function initObserver(onSentenceDetected) {
  const tracked = new Map();
  let stopped = false;
  let scheduled = false;
  let frame = null;
  const scan = () => {
    if (stopped) return;
    for (const [el, cleanup] of tracked) {
      if (!el.isConnected || resolveEditorAdapter(el)?.resolveOwner(el) !== el) { cleanup(); tracked.delete(el); }
    }
    document.querySelectorAll(editorSelector).forEach(candidate => {
      const adapter = resolveEditorAdapter(candidate);
      const el = adapter?.resolveOwner(candidate);
      if (!el || tracked.has(el)) return;
      const stopInput = attachInputTracker(el, onSentenceDetected);
      const stopRevision = adapter.observe?.(el, () => invalidateOwner(el));
      tracked.set(el, () => { stopInput?.(); stopRevision?.(); invalidateOwner(el); });
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
  observer.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["contenteditable"] });
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
