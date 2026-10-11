/**
 * LetterBloxd video store: the shared-edits backend (Google Apps Script).
 *
 * How it works
 *   Writes  The extension posts each edit to a Google Form. Every response
 *           lands as a row in the "Log" sheet. The log is append-only: it is
 *           the history and the backup, and nothing ever rewrites it.
 *   Fold    Every 5 minutes fold() reads only the rows it hasn't seen yet and
 *           updates "State": one row per thing (a film's shelf, its logo, a
 *           franchise...) holding the latest value. Requests (removals,
 *           additions) go to "Requests" for moderators instead.
 *   Reads   doGet() serves State as one small JSON (cached), so the
 *           extension never reads the log.
 *   Repair  Tick "Rejected" on any Log row and run rebuild(): State is
 *           replayed from the log from scratch.
 *
 * Set up (once): paste this into a new Apps Script project, run setup(),
 * allow the permissions, then Deploy > New deployment > Web app
 * (Execute as: me, Who has access: Anyone). Put the form URL, its field ids
 * and the web app URL into the extension.
 */

const PROPS = PropertiesService.getScriptProperties();
const REQUEST_KINDS = { "remove-film": 1, "remove-section": 1, "add-film": 1, "artwork": 1 };

function setup() {
  const ss = SpreadsheetApp.create("LetterBloxd store edits");
  const form = FormApp.create("LetterBloxd store edits")
    .setDescription("Written by the LetterBloxd extension. Each response is one change to the video store.")
    .setCollectEmail(false)
    .setLimitOneResponsePerUser(false)
    .setShowLinkToRespondAgain(false);
  form.addTextItem().setTitle("Kind").setRequired(true);
  form.addTextItem().setTitle("Target").setRequired(true);
  form.addParagraphTextItem().setTitle("Value");
  form.addParagraphTextItem().setTitle("Meta");
  form.setDestination(FormApp.DestinationType.SPREADSHEET, ss.getId());
  SpreadsheetApp.flush();

  // The form's response tab is the log.
  const log = ss.getSheets().find((s) => s.getFormUrl()) || ss.getSheets()[0];
  log.setName("Log");
  log.getRange(1, 6).setValue("Rejected");
  const state = ss.insertSheet("State");
  state.appendRow(["key", "kind", "target", "value", "updated", "edits"]);
  state.setFrozenRows(1);
  const req = ss.insertSheet("Requests");
  req.appendRow(["when", "kind", "target", "value", "status"]);
  req.setFrozenRows(1);
  const blank = ss.getSheetByName("Sheet1");
  if (blank && ss.getSheets().length > 3) ss.deleteSheet(blank);

  PROPS.setProperties({ sheet: ss.getId(), form: form.getId(), done: "1" });
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger("fold").timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger("snapshot").timeBased().everyDays(1).atHour(4).create();

  const items = form.getItems().map((it) => `${it.getTitle()}: entry.${it.getId()}`);
  Logger.log("Sheet: " + ss.getUrl());
  Logger.log("Form (post here): " + form.getPublishedUrl().replace("/viewform", "/formResponse"));
  Logger.log("Field ids — " + items.join(", "));
}

// Fold new log rows into State (latest value wins) and Requests.
function fold() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return;
  try {
    const ss = SpreadsheetApp.openById(PROPS.getProperty("sheet"));
    const log = ss.getSheetByName("Log");
    const done = Number(PROPS.getProperty("done") || 1);
    const last = log.getLastRow();
    if (last <= done) return;
    const rows = log.getRange(done + 1, 1, last - done, 6).getValues();
    applyRows(ss, rows);
    PROPS.setProperty("done", String(last));
    CacheService.getScriptCache().remove("state");
  } finally {
    lock.releaseLock();
  }
}

function applyRows(ss, rows) {
  const state = ss.getSheetByName("State");
  const req = ss.getSheetByName("Requests");
  const data = state.getDataRange().getValues();
  const at = new Map(data.slice(1).map((r, i) => [r[0], i + 2]));
  const updates = new Map(); // row number -> values
  const appends = [];
  const requests = [];
  for (const [when, kind, target, value, , rejected] of rows) {
    if (!kind || !target || rejected === true || String(rejected).toLowerCase() === "x") continue;
    if (REQUEST_KINDS[kind]) { requests.push([when, kind, target, value, "open"]); continue; }
    const key = `${kind}:${target}`;
    const n = at.get(key);
    if (n) {
      const prev = updates.get(n) || data[n - 1];
      updates.set(n, [key, kind, target, value, when, Number(prev[5] || 0) + 1]);
    } else {
      appends.push([key, kind, target, value, when, 1]);
      at.set(key, data.length + appends.length);
    }
  }
  for (const [n, vals] of updates) state.getRange(n, 1, 1, 6).setValues([vals]);
  if (appends.length) state.getRange(state.getLastRow() + 1, 1, appends.length, 6).setValues(appends);
  if (requests.length) req.getRange(req.getLastRow() + 1, 1, requests.length, 5).setValues(requests);
}

// Replay everything (after ticking Rejected on bad rows).
function rebuild() {
  const ss = SpreadsheetApp.openById(PROPS.getProperty("sheet"));
  const state = ss.getSheetByName("State");
  state.getRange(2, 1, Math.max(1, state.getLastRow() - 1), 6).clearContent();
  PROPS.setProperty("done", "1");
  fold();
}

// The extension reads this: { at, edits: { key: [kind, target, value] } }
function doGet() {
  const cache = CacheService.getScriptCache();
  let body = cache.get("state");
  if (!body) {
    const ss = SpreadsheetApp.openById(PROPS.getProperty("sheet"));
    const rows = ss.getSheetByName("State").getDataRange().getValues().slice(1);
    const edits = {};
    for (const [key, kind, target, value] of rows) if (key) edits[key] = [kind, target, value];
    body = JSON.stringify({ at: new Date().toISOString(), edits });
    if (body.length < 95000) cache.put("state", body, 300);
  }
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

// Nightly: a dated copy of State, kept for 30 days.
function snapshot() {
  const ss = SpreadsheetApp.openById(PROPS.getProperty("sheet"));
  const name = "State " + Utilities.formatDate(new Date(), "UTC", "yyyy-MM-dd");
  if (ss.getSheetByName(name)) return;
  ss.getSheetByName("State").copyTo(ss).setName(name);
  const old = ss.getSheets().filter((s) => /^State \d{4}-\d\d-\d\d$/.test(s.getName())).sort((a, b) => (a.getName() < b.getName() ? -1 : 1));
  while (old.length > 30) ss.deleteSheet(old.shift());
}
