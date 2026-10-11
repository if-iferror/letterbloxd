/*
 * LetterBloxd bridge: passes feedback from the page script (content.js, which
 * runs in the page) to the background script, and the result back.
 * It only reacts to LetterBloxd's own messages from this same page.
 */
(() => {
  const api = globalThis.browser || globalThis.chrome;
  window.addEventListener("message", (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__lbni !== "feedback" || typeof d.id !== "string") return;
    const answer = (result) => window.postMessage({ __lbni: "feedback-result", id: d.id, ...result }, location.origin);
    try {
      api.runtime.sendMessage({ type: "feedback", payload: d.payload }, (result) => {
        answer(result || { ok: false, reason: "No answer from the extension." });
      });
    } catch {
      answer({ ok: false, reason: "The extension was updated. Reload the page and try again." });
    }
  });
})();
