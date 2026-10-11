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

// The developer's Google Form ("LetterBloxd feedback", owned by if.iferror).
// Two fields: the message, and one line of technical details.
const FORM = {
  url: "https://docs.google.com/forms/d/e/1FAIpQLSdimOuu93oNmPj3PoPkcWgJNrHqhD9rTCV17-gz_ba05AgPrw/formResponse",
  entries: { text: "entry.1491097896", details: "entry.1838492833" },
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
  // e.g. "v1.3.0 · Firefox 131 · macOS · film page · {"mode":"hide",...}"
  body.set(e.details, [`v${api.runtime.getManifest().version}`, browserName(), String(payload.page || "").slice(0, 40), String(payload.settings || "").slice(0, 500)].join(" · "));
  try {
    // Google Forms doesn't answer cross-site requests readably, so this is
    // fire-and-forget: a network error is the only failure we can see.
    await fetch(FORM.url, { method: "POST", mode: "no-cors", body });
    return { ok: true };
  } catch {
    return { ok: false, reason: "Couldn't reach the feedback form. Check your connection." };
  }
}

/* The video store (dev builds only).
 * store:logos  every logo TMDB lists for a film (read from TMDB's public
 *              logo page; no API key needed, nothing stored)
 * store:edit   a shared edit (a move, a new section, a logo or colour pick,
 *              a franchise, a request) added to the store's log */
async function storeLogos({ id }) {
  if (!/^\d+$/.test(String(id))) return { ok: false, reason: "bad id" };
  const r = await fetch(`https://www.themoviedb.org/movie/${id}/images/logos`, { credentials: "omit" });
  if (!r.ok) return { ok: false, reason: `TMDB ${r.status}` };
  const html = await r.text();
  const seen = new Set();
  for (const m of html.matchAll(/\/t\/p\/w500\/([A-Za-z0-9]+\.(?:png|svg))/g)) seen.add(m[1]);
  return { ok: true, data: [...seen] };
}
// The store's shared-edits backend (see tools/store-backend.gs). Until it's
// set up, edits go to the feedback form, marked [store].
const STORE = {
  form: "https://docs.google.com/forms/d/e/1FAIpQLScJhV2pJR0ormeIczfXES-kkUWjOABHpWlXZ2aLvQgEHeBBcw/formResponse",
  entries: { kind: "entry.514253111", target: "entry.1244489204", value: "entry.1007145499", meta: "entry.112719795" },
  state: "https://script.google.com/macros/s/AKfycbz8vnW4lQOT0Bt9CUggz6DcbdS7ELlj2lD1-FRbSrk15v9czgiEf71zOAMP4NYSufg/exec",
};
async function storeEdit({ kind, target, value }) {
  if (!(await haveConsent())) return { ok: false, reason: "not allowed" };
  const body = new URLSearchParams();
  const meta = JSON.stringify({ v: api.runtime.getManifest().version, at: new Date().toISOString() });
  let url = FORM.url;
  if (STORE.form) {
    url = STORE.form;
    body.set(STORE.entries.kind, String(kind).slice(0, 60));
    body.set(STORE.entries.target, String(target).slice(0, 300));
    body.set(STORE.entries.value, JSON.stringify(value ?? null).slice(0, 8000));
    body.set(STORE.entries.meta, meta);
  } else {
    body.set(FORM.entries.text, `[store] ${String(kind).slice(0, 40)} ${String(target).slice(0, 200)}`);
    body.set(FORM.entries.details, JSON.stringify({ kind, target, value, meta }).slice(0, 4000));
  }
  try {
    await fetch(url, { method: "POST", mode: "no-cors", body });
    return { ok: true };
  } catch {
    return { ok: false, reason: "offline" };
  }
}
// Everyone's edits, folded: fetched at most every 5 minutes.
let stateCache = null;
async function storeState() {
  if (!STORE.state) return { ok: true, data: { edits: {} } };
  if (stateCache && Date.now() - stateCache.at < 300000) return { ok: true, data: stateCache.data };
  try {
    const r = await fetch(STORE.state, { credentials: "omit" });
    const data = await r.json();
    stateCache = { at: Date.now(), data };
    return { ok: true, data };
  } catch {
    return stateCache ? { ok: true, data: stateCache.data } : { ok: false, reason: "offline" };
  }
}

api.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg && msg.type === "store:logos") { storeLogos(msg.payload || {}).then(reply, () => reply({ ok: false })); return true; }
  if (msg && msg.type === "store:edit") { storeEdit(msg.payload || {}).then(reply, () => reply({ ok: false })); return true; }
  if (msg && msg.type === "store:state") { storeState().then(reply, () => reply({ ok: false })); return true; }
  if (!msg || msg.type !== "feedback") return;
  send(msg.payload || {}).then(reply);
  return true; // reply later
});
