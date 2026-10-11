/*
 * LetterBloxd background: sends feedback.
 *
 * The page script can't call extension APIs, so feedback travels
 * page (content.js) -> bridge.js -> here -> the developer's Google Form.
 *
 * What's sent, only when you type feedback and press Enter:
 *   your message, the extension version, your browser and OS, the kind of
 *   Letterboxd page you were on (e.g. "film page", never the address), and
 *   your LetterBloxd display settings. No username, no address, no history.
 *
 * Firefox: both kinds of data are optional permissions, so the first time you
 * send, a small window asks you to allow it. Chrome has no such API; there it
 * is covered by the store listing's privacy disclosure.
 */
const api = globalThis.browser || globalThis.chrome;

// The developer's Google Form. Leave `url` empty and nothing is ever sent.
const FORM = {
  url: "",
  entries: { text: "", version: "", browser: "", page: "", settings: "" },
};
const DATA = ["personalCommunications", "technicalAndInteraction"];

function browserName() {
  const ua = navigator.userAgent;
  const m = ua.match(/Edg\/(\d+)/) || ua.match(/Firefox\/(\d+)/) || ua.match(/Chrome\/(\d+)/);
  const b = m ? `${m[0].startsWith("Edg") ? "Edge" : m[0].split("/")[0]} ${m[1]}` : "Other";
  const os = /Mac OS X/.test(ua) ? "macOS" : /Windows/.test(ua) ? "Windows" : /Android/.test(ua) ? "Android" : /CrOS/.test(ua) ? "ChromeOS" : /Linux/.test(ua) ? "Linux" : "Other";
  return `${b} · ${os}`;
}

// Firefox only: ask once, in a small window, before anything is sent.
let asking = null;
async function haveConsent() {
  let has;
  try {
    has = await api.permissions.contains({ data_collection: DATA });
  } catch {
    return true; // this browser has no data-collection permissions (Chrome)
  }
  if (has) return true;
  if (!asking) {
    asking = new Promise((resolve) => {
      let winId = null;
      const done = (granted) => {
        api.runtime.onMessage.removeListener(onAnswer);
        api.windows.onRemoved.removeListener(onClosed);
        asking = null;
        resolve(granted);
      };
      const onAnswer = (msg) => { if (msg && msg.type === "consent") done(!!msg.granted); };
      const onClosed = (id) => { if (id === winId) done(false); };
      api.runtime.onMessage.addListener(onAnswer);
      api.windows.onRemoved.addListener(onClosed);
      api.windows.create({ url: api.runtime.getURL("consent.html"), type: "popup", width: 440, height: 330 }).then((w) => (winId = w.id), () => done(false));
    });
  }
  return asking;
}

async function send(payload) {
  if (!FORM.url) return { ok: false, reason: "Feedback isn't set up yet." };
  if (!(await haveConsent())) return { ok: false, reason: "Not sent: sending wasn't allowed.", declined: true };
  const e = FORM.entries;
  const body = new URLSearchParams();
  body.set(e.text, String(payload.text || "").slice(0, 2000));
  body.set(e.version, api.runtime.getManifest().version);
  body.set(e.browser, browserName());
  body.set(e.page, String(payload.page || "").slice(0, 40));
  body.set(e.settings, String(payload.settings || "").slice(0, 500));
  try {
    // Google Forms doesn't answer cross-site requests readably, so this is
    // fire-and-forget: a network error is the only failure we can see.
    await fetch(FORM.url, { method: "POST", mode: "no-cors", body });
    return { ok: true };
  } catch {
    return { ok: false, reason: "Couldn't reach the feedback form. Check your connection." };
  }
}

api.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (!msg || msg.type !== "feedback") return;
  send(msg.payload || {}).then(reply);
  return true; // reply later
});
