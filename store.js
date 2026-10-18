/*
 * LetterBloxd Video Store (prototype: the Horror wing, Main collection).
 *
 * Opens over any Letterboxd page at #store, laid out like a real store:
 *   WING    Horror. One long wall you walk along.
 *   AISLE   '80s Horror, Zombies... Side by side, A-Z, "Everything Else" last.
 *           A wooden sign along the top, repeating as you walk.
 *   SHELF   One subcategory per shelf row (Classic Zombies, Zombie Comedies...),
 *           filed A-Z by title, labelled with taped laminated tags on the shelf
 *           edge, repeating. When a subcategory runs out, the next one starts
 *           to its right on that same shelf.
 *
 * A film sits in exactly one aisle (the most specific it fits, in
 * AISLE_PRIORITY order) and exactly one shelf in it (the first SHELF_RULES
 * rule it matches). Only the end cap ("Popular This Week") may repeat.
 *
 * THE SORTING DESK (drawer at the bottom): films on the left, folders
 * (Genre > Category > Subcategory) on the right. Drag any film, from the
 * desk or straight off a shelf, onto any folder to re-file it. Your moves
 * and new folders are "Mine" and live in this browser; "Community" is the
 * house placement until shared voting exists.
 *
 * Main collection = Horror's top 9,360 by Letterboxd popularity (about 1,000+
 * watches). Everything comes from Letterboxd's browse pages, read once a week
 * and kept in localStorage. Posters load as you walk up to them.
 */
(() => {
  "use strict";
  if (window.__lbniStore) return;
  window.__lbniStore = true;

  const NS = "lbni";
  const CACHE_KEY = `${NS}:store:horror:v2`;
  const OLD_KEYS = [`${NS}:store:horror:v1`];
  const POSTER_KEY = `${NS}:store:posters`;
  const CACHE_MS = 7 * 864e5;
  const PER_PAGE = 72;
  const MAIN_PAGES = 130; // ranks 1-9,360
  const COLLECTIONS = [
    { id: "main", name: "Main", count: 9360, open: true },
    { id: "obscure", name: "Obscure", count: 15480, open: false },
    { id: "ultra", name: "Ultra-obscure", count: 53002, open: false },
  ];

  /* ---------------- the floor plan ---------------- */

  // Aisles. `q` is the Letterboxd browse path; one/many name the shelves.
  const AISLES = [
    { id: "slashers", name: "Slashers", q: "genre/horror/mini-theme/killing-slasher-gruesome-gory-bloody", one: "Slasher", many: "Slashers" },
    { id: "haunted", name: "Haunted & Supernatural", q: "genre/horror/mini-theme/supernatural-chilling-eerie-terrifying-dread", one: "Ghost Story", many: "Ghost Stories" },
    { id: "creepy", name: "Creepy & Chilling", q: "genre/horror/mini-theme/chilling-eerie-terrifying-terror-frighten", one: "Chiller", many: "Chillers" },
    { id: "gothic", name: "Gothic", q: "genre/horror/mini-theme/eerie-blood-gothic-mysterious-bizarre", one: "Gothic", many: "Gothic Horror" },
    { id: "vampires", name: "Vampires", q: "genre/horror/mini-theme/vampires-blood-undead-cool-bloody", one: "Vampire", many: "Vampires" },
    { id: "zombies", name: "Zombies & Survival", q: "genre/horror/mini-theme/zombies-undead-flesh-blood-infected", one: "Zombie", many: "Zombies" },
    { id: "creature", name: "Creature Features", q: "genre/horror/mini-theme/creature-monster-scary-horror-suspense", one: "Creature", many: "Creature Features" },
    { id: "madsci", name: "Mad Science & Classic Monsters", q: "genre/horror/mini-theme/scientist-monster-doctor-experiment-creature", one: "Mad Science", many: "Mad Science" },
    { id: "extreme", name: "Extreme", q: "genre/horror/mini-theme/cannibals-gruesome-graphic-shock-gory", one: "Extreme", many: "Extreme Horror" },
    { id: "giallo", name: "Giallo", q: "genre/horror/country/italy/decade/1970s", one: "Giallo", many: "Gialli", decade: 1970, noWorld: true },
    { id: "eighties", name: "’80s Horror", q: "genre/horror/decade/1980s", one: "’80s Horror", many: "’80s Horror", decade: 1980 },
    { id: "jhorror", name: "J-Horror", q: "genre/horror/country/japan", one: "J-Horror", many: "J-Horror", noWorld: true },
    { id: "comedy", name: "Horror-Comedy", q: "genre/horror+comedy", one: "Horror-Comedy", many: "Horror-Comedies", noComedy: true },
  ];
  // Which aisle wins when a film fits several: the most specific first.
  const AISLE_PRIORITY = ["giallo", "jhorror", "vampires", "zombies", "madsci", "extreme", "creature", "slashers", "gothic", "haunted", "creepy", "eighties", "comedy"];
  const EVERYTHING = { id: "rest", name: "General", q: "genre/horror", one: "Horror", many: "Horror" };
  // Every film starts Uncategorized: one folder at the top of the Library,
  // shown on the wall as a pile in the corner. Filing a film takes it out.
  const UNCAT = "uncat", UNCAT_CAT = "uncat/pile", UNCAT_SUB = "uncat/pile/general";

  // Tags read for every film, used to split aisles into shelves.
  const WORLD = ["japan", "south-korea", "france", "italy", "spain", "germany", "mexico", "india", "thailand", "hong-kong", "china", "taiwan", "indonesia", "philippines", "brazil", "argentina", "sweden", "norway", "denmark", "finland", "poland", "russia", "turkey", "iran", "belgium", "netherlands"];
  const TAGS = [
    ...["comedy", "science-fiction", "action", "thriller", "drama", "fantasy", "mystery", "romance", "animation", "crime"].map((g) => ({ id: g, q: `genre/horror+${g}` })),
    ...WORLD.map((c) => ({ id: "world", q: `genre/horror/country/${c}` })),
  ];

  // Shelves inside each aisle. A film goes on the FIRST rule it matches
  // (genre blends first, then era); shelves show in `order` from the top.
  // A rule matching fewer than MIN_SHELF films is dropped and its films fall
  // through to the next rule.
  const MIN_SHELF = 4;
  const era = (y, a, b) => y >= a && y < b;
  const SHELF_RULES = [
    { id: "anim", order: 12, name: (a) => `Animated ${a.many}`, test: (f) => f.tags.has("animation") },
    { id: "comedy", order: 5, name: (a) => `${a.one} Comedies`, test: (f, a) => !a.noComedy && f.tags.has("comedy") },
    { id: "romance", order: 10, name: (a) => `${a.one} Romance`, test: (f) => f.tags.has("romance") },
    { id: "scifi", order: 6, name: (a) => `Sci-Fi ${a.many}`, test: (f) => f.tags.has("science-fiction") },
    { id: "action", order: 7, name: (a) => `${a.one} Action`, test: (f) => f.tags.has("action") },
    { id: "fantasy", order: 11, name: (a) => `Dark Fantasy ${a.many}`, test: (f) => f.tags.has("fantasy") },
    { id: "world", order: 9, name: (a) => `World ${a.many}`, test: (f, a) => !a.noWorld && f.tags.has("world") },
    // Era: decades, or thirds of the decade for a one-decade aisle.
    { id: "e1", order: 1, name: (a) => (a.decade ? `${a.decade}–${a.decade + 3}` : `Classic ${a.many}`), test: (f, a) => (a.decade ? era(f.year, a.decade, a.decade + 4) : f.year > 0 && f.year < 1970) },
    { id: "e2", order: 2, name: (a) => (a.decade ? `${a.decade + 4}–${a.decade + 6}` : `’70s & ’80s ${a.many}`), test: (f, a) => (a.decade ? era(f.year, a.decade + 4, a.decade + 7) : era(f.year, 1970, 1990)) },
    { id: "thrill", order: 8, name: (a) => `${a.one} Thrillers`, test: (f) => f.tags.has("thriller") || f.tags.has("mystery") || f.tags.has("crime") },
    { id: "drama", order: 13, name: (a) => `${a.one} Dramas`, test: (f) => f.tags.has("drama") },
    { id: "e3", order: 3, name: (a) => (a.decade ? `${a.decade + 7}–${a.decade + 9}` : `’90s & 2000s ${a.many}`), test: (f, a) => (a.decade ? era(f.year, a.decade + 7, a.decade + 10) : era(f.year, 1990, 2010)) },
    { id: "e4", order: 4, name: (a) => (a.decade ? `More ${a.many}` : `Modern ${a.many}`), test: () => true },
  ];

  /* ---------------- small helpers ---------------- */

  const $ = (sel, root = document) => root.querySelector(sel);
  const h = (tag, cls, html) => {
    const el = document.createElement(tag);
    if (cls) el.className = cls;
    if (html != null) el.innerHTML = html;
    return el;
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]);
  const fmt = (n) => n.toLocaleString("en-US");
  const readJSON = (k, d) => {
    try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; }
  };
  const writeJSON = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };

  // Run async jobs with at most `n` in flight.
  function limiter(n) {
    let active = 0;
    const queue = [];
    const next = () => {
      if (active >= n || !queue.length) return;
      active++;
      const { fn, ok, fail } = queue.shift();
      fn().then(ok, fail).finally(() => { active--; next(); });
    };
    return (fn) => new Promise((ok, fail) => { queue.push({ fn, ok, fail }); next(); });
  }
  const pageLimit = limiter(8);
  const posterLimit = limiter(6);

  /* ---------------- reading Letterboxd ---------------- */

  // One page of a browse query, in popularity order: [{ slug, name }]
  async function readPage(path, page, sort = "by/popular") {
    const url = `/csi/films/films-browser-list/${path}/${sort ? sort + "/" : ""}${page > 1 ? `page/${page}/` : ""}?esiAllowFilters=false`;
    let res;
    for (let tries = 0; tries < 3; tries++) {
      res = await pageLimit(() => fetch(url, { credentials: "include" }));
      if (res.ok || res.status === 404) break;
      await new Promise((r) => setTimeout(r, 800 * (tries + 1)));
    }
    if (!res.ok) throw new Error(`Letterboxd answered ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), "text/html");
    return [...doc.querySelectorAll("[data-item-slug]")].map((el) => ({
      slug: el.dataset.itemSlug,
      name: el.dataset.itemName || el.dataset.itemFullDisplayName || el.dataset.itemSlug,
    }));
  }

  // Every Main-collection film in a query. Same popularity order as the Main
  // list, so Main films always come first: stop at the first page with none.
  async function readMembers(q, index, tick) {
    const got = [];
    for (let p = 1; p <= 80; p++) {
      const list = await readPage(q, p);
      const hits = list.map((f) => index.get(f.slug)).filter((i) => i != null);
      got.push(...hits);
      tick(p);
      if (!hits.length || list.length < PER_PAGE) break;
    }
    return got;
  }

  /* ---------------- building the stock list ---------------- */

  let stock = null; // { v, at, films: [[slug, name]], aisles: { id: [i] }, tags: { id: [i] }, front: [[slug, name]] }
  let building = null;

  function loadStock() {
    OLD_KEYS.forEach((k) => { try { localStorage.removeItem(k); } catch {} });
    const s = readJSON(CACHE_KEY, null);
    if (s && s.v === 2 && Date.now() - s.at < CACHE_MS && Array.isArray(s.films)) return s;
    return null;
  }

  function buildStock(onProgress) {
    if (building) return building;
    building = (async () => {
      let done = 0;
      let total = MAIN_PAGES + AISLES.length * 3 + TAGS.length * 4; // a guess, refined as we go
      const tick = (p) => {
        done++;
        if (p > 3) total++;
        onProgress && onProgress(Math.min(done / total, 0.99));
      };

      // 1. The Main collection: Horror's top 130 pages by popularity.
      const pages = await Promise.all(Array.from({ length: MAIN_PAGES }, (_, i) => readPage("genre/horror", i + 1).then((l) => { tick(0); return l; })));
      const films = [];
      const index = new Map();
      for (const film of pages.flat()) {
        if (index.has(film.slug)) continue;
        index.set(film.slug, films.length);
        films.push([film.slug, film.name]);
      }

      // 2. Aisles and tags, all at once.
      const [aisleLists, tagLists, front] = await Promise.all([
        Promise.all(AISLES.map((a) => readMembers(a.q, index, tick))),
        Promise.all(TAGS.map((t) => readMembers(t.q, index, tick))),
        readPage("popular/this/week/genre/horror", 1, "").catch(() => []),
      ]);

      // 3. One aisle per film: the most specific wins.
      const members = Object.fromEntries(AISLES.map((a, n) => [a.id, aisleLists[n]]));
      const placed = new Set();
      const aisles = {};
      for (const id of AISLE_PRIORITY) {
        aisles[id] = (members[id] || []).filter((i) => !placed.has(i));
        aisles[id].forEach((i) => placed.add(i));
      }
      aisles.rest = films.map((_, i) => i).filter((i) => !placed.has(i));

      const tags = {};
      TAGS.forEach((t, n) => { (tags[t.id] = tags[t.id] || []).push(...tagLists[n]); });

      const s = { v: 2, at: Date.now(), films, aisles, tags, front: front.slice(0, 15).map((f) => [f.slug, f.name]) };
      writeJSON(CACHE_KEY, s);
      onProgress && onProgress(1);
      return s;
    })().finally(() => { building = null; });
    return building;
  }

  /* ---------------- filing ---------------- */

  const yearOf = (name) => +((String(name).match(/\((\d{4})\)\s*$/) || [])[1] || 0);
  const titleOf = (name) => String(name).replace(/\s*\(\d{4}\)\s*$/, "");
  // "The Shining" files under S. Accents ignored, numbers before A.
  // (remembered: sorting tens of thousands of titles asks for each one many times)
  const fileKeys = new Map();
  const fileKey = (name) => {
    let k = fileKeys.get(name);
    if (k === undefined) { k = fileKey0(name); if (fileKeys.size > 300000) fileKeys.clear(); fileKeys.set(name, k); }
    return k;
  };
  const fileKey0 = (name) =>
    titleOf(name)
      .normalize("NFD")
      .replace(/[̀-ͯ]/g, "")
      .replace(/^(the|a|an)\s+/i, "")
      .replace(/^[^a-z0-9]+/i, "")
      .toLowerCase();
  const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
  const byTitle = (a, b) => collator.compare(fileKey(a[1]), fileKey(b[1])) || yearOf(a[1]) - yearOf(b[1]);

  /* ---------------- the library: genres › categories › subcategories ---------------- */

  // Letterboxd's genres. Only Horror is stocked so far; the rest are empty
  // folders you can already file films into.
  const GENRES = [
    ["action", "Action"], ["adventure", "Adventure"], ["animation", "Animation"], ["comedy", "Comedy"], ["crime", "Crime"],
    ["documentary", "Documentary"], ["drama", "Drama"], ["family", "Family"], ["fantasy", "Fantasy"], ["history", "History"],
    ["horror", "Horror"], ["music", "Music"], ["mystery", "Mystery"], ["romance", "Romance"], ["science-fiction", "Science Fiction"],
    ["thriller", "Thriller"], ["tv-movie", "TV Movie"], ["war", "War"], ["western", "Western"],
  ];
  const STOCKED = "horror"; // the genre with hand-made aisles (its own placement rules)
  // The room: every genre that has films, in genre order, each in its own run
  // of aisles. (For now only Horror is stocked; the others join as the
  // catalogue grows.)
  const roomGenres = () => (lib ? [...lib.genres.keys()].filter((g) => g !== UNCAT && (lib.count.get(g) || 0) > 0) : [STOCKED]);
  const inRoom = (genreId) => roomGenres().includes(genreId);
  const roomCats = () => roomGenres().flatMap((g) => lib.genres.get(g).cats);
  // For now the Store opens straight into the Sorting Desk; the walkable
  // aisles are switched off (set false to bring them back).
  const DESK_ONLY = true;

  // Your own moves and folders ("Mine"). Kept in this browser only.
  const MINE_KEY = `${NS}:store:mine:v1`;
  let mine = readJSON(MINE_KEY, null) || {};
  mine = { place: {}, cats: {}, subs: {}, recent: [], view: "community", sort: {}, held: [], colors: {}, wash: {}, ...mine };
  let paintVer = 0; // bumps when anything that colours the far-away wall changes
  // Never save before the saved copy has been read back (that would write an
  // empty shelf over it).
  let mineReady = false;
  // A tab opened as #store-builder only runs the builders: it never saves
  // your shelves, so your sorting in another tab can't be overwritten.
  const BUILD_TAB = /^#store-builder\b/.test(location.hash);
  const saveMine = () => { paintVer++; return mineReady && !BUILD_TAB ? persist(MINE_KEY, mine) : true; };

  /* Your shelves and the house plan are saved to IndexedDB as well as
   * localStorage. localStorage holds about 5 MB, and a few thousand moves
   * fill it; when it's full, it keeps a marker and IndexedDB keeps the rest.
   * The newer copy wins when the store opens. */
  const bigTimers = {};
  function persist(key, obj) {
    if (BUILD_TAB && (key === MINE_KEY || key === HOUSE_KEY)) return true; // builder tab: read-only shelves
    if (obj) obj._at = Date.now();
    let ok = true;
    if (!obj) { try { localStorage.removeItem(key); } catch {} }
    else if (!writeJSON(key, obj)) { ok = false; try { localStorage.setItem(key, JSON.stringify({ _idb: true, _at: obj._at })); } catch {} }
    clearTimeout(bigTimers[key]);
    bigTimers[key] = setTimeout(() => idbPut(`ls:${key}`, obj || null).catch(() => {}), ok ? 600 : 0);
    return true;
  }
  async function restoreBig(key, cur) {
    try {
      const saved = await idbGet(`ls:${key}`);
      // >= : when localStorage only holds the "it's in IndexedDB" marker, the
      // two carry the same timestamp, and the IndexedDB copy is the real one.
      if (saved && ((cur && cur._idb) || (saved._at || 0) >= ((cur && cur._at) || 0))) return saved;
    } catch {}
    return cur && cur._idb ? null : cur;
  }

  /* What everyone has changed (the store's shared edits), folded by the
   * backend into one small state file and fetched once per visit. Layers:
   * built-in defaults < house plan < shared edits < your own edits. */
  let shared = { place: {}, logo: {}, color: {}, wash: {}, franchises: {}, cats: {}, subs: {} };
  function applySharedState(data) {
    paintVer++;
    const next = { place: {}, logo: {}, color: {}, wash: {}, franchises: {}, cats: {}, subs: {} };
    const parse = (v) => { try { return typeof v === "string" && /^[\[{"]|^null$|^-?\d/.test(v) ? JSON.parse(v) : v; } catch { return v; } };
    for (const [kind, target, raw] of Object.values((data && data.edits) || {})) {
      const v = parse(raw);
      if (v == null || v === "") continue;
      if (kind === "place") next.place[target] = v;
      else if (kind === "logo") next.logo[target] = v === "plain" ? -1 : v;
      else if (kind === "color") next.color[target] = String(v).replace("#", "");
      else if (kind === "wash") next.wash[target] = v;
      else if (kind === "franchise" && v.films) next.franchises[target] = v;
      else if (kind === "add-section" && v.parent) next.cats[target] = { genre: v.parent, name: v.name };
      else if (kind === "add-subsection" && v.parent) next.subs[target] = { cat: v.parent, name: v.name };
      else if (kind === "add-niche" && v.parent && v.cat) next.subs[target] = { cat: v.cat, parent: v.parent, name: v.name };
    }
    shared = next;
  }
  // Franchises: shared ones (films as slugs) plus your own (films as [slug, name]).
  function allFranchises() {
    const out = {};
    for (const [id, f] of Object.entries(shared.franchises)) out[id] = { ...f, films: f.films.map((x) => (Array.isArray(x) ? x : [x, (lib && lib.names.get(x)) || x])) };
    return Object.assign(out, mine.franchises || {});
  }

  let lib = null; // built from stock + mine; see buildLibrary()
  let defaults = null; // slug -> sub id, the house placement

  /* ---------------- the house plan (moderator edits) ----------------
   * Everything a moderator changes about the community layout: names, new and
   * deleted folders, where films sit, the order of sections on the wall, and
   * each section's shape. Published as a static file (data/house-horror.json).
   * A moderator's unpublished edits stay in this browser until downloaded. */
  const HOUSE_KEY = `${NS}:store:house:v1`;
  const HOUSE_FILE = "https://raw.githubusercontent.com/if-iferror/letterbloxd/dev/data/house-horror.json";
  // index: a section's hand-made order (slugs); sort: each section's default
  // order ("title" | "year" | "index"); held: films taken off the wall into
  // the moderator's workspace.
  const blankHouse = () => ({ v: 1, names: {}, hidden: [], genres: {}, cats: {}, subs: {}, place: {}, order: [], subOrder: {}, index: {}, sort: {}, held: [], wall: null, walls: {} });
  const fullHouse = (x) => ({ ...blankHouse(), ...(x || {}) });
  let houseShared = null;
  let houseLocal = readJSON(HOUSE_KEY, null);
  // (after the rest of this file has run: the IndexedDB helpers are further down)
  const bigReady = Promise.resolve().then(async () => {
    const m = await restoreBig(MINE_KEY, mine);
    if (m && m !== mine) mine = { place: {}, cats: {}, subs: {}, recent: [], view: "community", sort: {}, held: [], colors: {}, wash: {}, ...m };
    // a marker with nothing behind it (IndexedDB unreadable): don't save over it
    mineReady = !mine._idb;
    delete mine._idb;
    if (mine.lv) Object.assign(lv, { mode: mine.lv.mode || lv.mode, f: mine.lv.f || {}, all: mine.lv.all || {}, y0: mine.lv.y0 || "", y1: mine.lv.y1 || "", sort: mine.lv.sort || "pop", showFilters: !mine.lv.hideFilters });
    houseLocal = await restoreBig(HOUSE_KEY, houseLocal);
  });
  const house = () => fullHouse(houseLocal || houseShared);
  // grab: "one" moves a single piece; "group" moves every piece of that section, keeping its shape.
  const edit = { on: false, sel: null, renaming: null, deleting: null, undo: [], grab: "one" };
  const isFixed = (id) => !id || lib.genres.has(id) || id === UNCAT_CAT || /\/general$/.test(id);
  const slugify = (name) => name.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "folder";
  function freshId(base) {
    let id = base;
    for (let n = 2; lib.cats.has(id) || lib.subs.has(id) || house().cats[id] || house().subs[id]; n++) id = `${base}-${n}`;
    return id;
  }

  let sharedLoaded = false;
  function loadSharedEdits() {
    if (sharedLoaded) return;
    sharedLoaded = true;
    ext("state", {}).then((data) => { applySharedState(data); refresh(); }).catch(() => {});
  }

  function loadSharedHouse() {
    if (houseShared) return;
    houseShared = blankHouse();
    fetch(HOUSE_FILE, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j) { houseShared = fullHouse(j); if (!houseLocal && root && !root.hidden && stock) refresh(); } })
      .catch(() => {});
  }

  // Every edit goes through here: snapshot for undo, apply, save, redraw.
  /* Undo keeps only what an edit changed (the house plan can hold tens of
   * thousands of placements; whole copies of it per step used up memory). */
  const clone = (x) => (typeof structuredClone === "function" ? structuredClone(x) : JSON.parse(JSON.stringify(x)));
  function houseDiff(prev, next, wasNull) {
    const d = { wasNull, keys: {}, place: null };
    for (const k of new Set([...Object.keys(prev), ...Object.keys(next)])) {
      if (k === "_at") continue;
      if (k === "place") {
        const a = prev.place || {}, b = next.place || {}, ch = {};
        let n = 0;
        for (const x in b) if (a[x] !== b[x] && JSON.stringify(a[x]) !== JSON.stringify(b[x])) { ch[x] = a[x] === undefined ? null : a[x]; n++; }
        for (const x in a) if (!(x in b)) { ch[x] = a[x]; n++; }
        if (n) d.place = ch;
        continue;
      }
      if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) d.keys[k] = prev[k] === undefined ? null : clone(prev[k]);
    }
    return d;
  }
  function houseEdit(label, fn) {
    const prev = house(), wasNull = !houseLocal;
    houseLocal = fullHouse(clone(prev));
    fn(houseLocal);
    edit.undo.push(houseDiff(prev, houseLocal, wasNull));
    // at most 40 steps, and no more than ~150,000 remembered placements in all
    const size = (d) => (d.place ? Object.keys(d.place).length : 0) + 1;
    while (edit.undo.length > 1 && (edit.undo.length > 40 || edit.undo.reduce((n, d) => n + size(d), 0) > 150000)) edit.undo.shift();
    persist(HOUSE_KEY, houseLocal);
    refresh();
    if (label) toast(label, undoHouse);
  }
  function undoHouse() {
    if (!edit.undo.length) return;
    const d = edit.undo.pop();
    if (d.wasNull) houseLocal = null;
    else {
      const H = fullHouse(clone(house()));
      for (const [k, v] of Object.entries(d.keys)) { if (v === null) delete H[k]; else H[k] = v; }
      if (d.place) for (const [x, v] of Object.entries(d.place)) { if (v === null) delete H.place[x]; else H.place[x] = v; }
      houseLocal = H;
    }
    persist(HOUSE_KEY, houseLocal);
    refresh();
  }

  /* ---------------- the catalogue ----------------
   * Every popular film with its genres, countries, languages and themes,
   * built by the Catalogue builder and published as data/catalogue.json.
   * When it's there the store reads it instead of scraping Letterboxd:
   * Horror's aisles come from its lists, and every other film starts in its
   * home genre's Everything Else. */
  const CAT_FILE = "https://raw.githubusercontent.com/if-iferror/letterbloxd/dev/data/catalogue.json";
  let catalogue = null; // { films: [[slug, name, rating]], lists: Map(key -> { name, set }) }
  let catState = "idle"; // idle | loading | ready | none
  function loadCatalogue() {
    catState = "loading";
    return fetch(CAT_FILE)
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (!useCatalogue(j)) catState = "none"; })
      .catch(() => { catState = "none"; });
  }
  function useCatalogue(j) {
    if (!j || !Array.isArray(j.films)) return false;
    const lists = new Map();
    for (const [key, [name, gaps]] of Object.entries(j.lists || {})) {
      let i = -1;
      lists.set(key, { name, set: new Set(gaps.map((d) => (i += d))) });
    }
    catalogue = { at: j.at, films: j.films, lists, info: Array.isArray(j.info) ? j.info : null, people: j.people || [], langNames: j.langNames || {}, kw: Array.isArray(j.kw) ? j.kw : null, fkw: Array.isArray(j.fkw) ? j.fkw : null,
      co: j.co || null, fco: j.fco || null, cast: j.cast || null, fcast: j.fcast || null, certs: j.certs || null, fcert: j.fcert || null };
    catState = "ready";
    return true;
  }
  // The films matching a browse path ("genre/horror+comedy/country/italy/decade/1970s"),
  // or null when the catalogue lacks one of its lists.
  function catQuery(q) {
    const parts = q.split("/");
    let out = null;
    const meet = (set) => { out = out ? new Set([...out].filter((i) => set.has(i))) : new Set(set); };
    for (let n = 0; n < parts.length; n += 2) {
      const [kind, val] = [parts[n], parts[n + 1]];
      if (kind === "decade") {
        const y0 = parseInt(val, 10);
        const set = new Set();
        catalogue.films.forEach((f, i) => { const y = yearOf(f[1]); if (y >= y0 && y < y0 + 10) set.add(i); });
        meet(set);
        continue;
      }
      for (const v of val.split("+")) {
        const l = catalogue.lists.get(`${kind}/${v}`);
        if (!l) return null;
        meet(l.set);
      }
    }
    return out || new Set();
  }
  // Lists the store itself needs (Horror's aisles and tags).
  const neededLists = () => [...new Set([...AISLES, ...TAGS].flatMap((a) => {
    const parts = a.q.split("/"), keys = [];
    for (let n = 0; n < parts.length; n += 2) if (parts[n] !== "decade") for (const v of parts[n + 1].split("+")) keys.push(`${parts[n]}/${v}`);
    return keys;
  }))];
  // A film's home genre: the most specific of its genres.
  const HOME_ORDER = ["horror", "documentary", "animation", "western", "war", "music", "science-fiction", "fantasy", "comedy", "romance", "crime", "thriller", "mystery", "family", "adventure", "action", "history", "tv-movie", "drama"];
  function stockFromCatalogue() {
    const C = catalogue;
    const films = C.films.map((f) => [f[0], f[1]]);
    const horror = (C.lists.get(`genre/${STOCKED}`) || { set: new Set() }).set;
    const sorted = (set) => [...set].filter((i) => horror.has(i)).sort((a, b) => a - b);
    const members = {};
    for (const a of AISLES) {
      const set = catQuery(a.q);
      if (!set) console.warn(`[store] catalogue has no list for aisle ${a.id} (${a.q})`);
      members[a.id] = set ? sorted(set) : [];
    }
    const placed = new Set();
    const aisles = {};
    for (const id of AISLE_PRIORITY) {
      aisles[id] = (members[id] || []).filter((i) => !placed.has(i));
      aisles[id].forEach((i) => placed.add(i));
    }
    aisles.rest = sorted(horror).filter((i) => !placed.has(i));
    const tags = {};
    for (const t of TAGS) { const set = catQuery(t.q); if (set) (tags[t.id] = tags[t.id] || []).push(...sorted(set)); }
    // Everyone else's home genre.
    const homes = {};
    const genreSets = HOME_ORDER.map((g) => [g, C.lists.get(`genre/${g}`)]).filter(([, l]) => l);
    films.forEach((f, i) => {
      if (horror.has(i)) return;
      const g = genreSets.find(([, l]) => l.set.has(i));
      if (g) homes[i] = g[0];
    });
    return { v: 2, at: Date.now(), films, aisles, tags, front: [], homes, catalogue: C.at };
  }

  // The house placement for every stocked film: aisle, then the first shelf
  // rule it matches (rules with fewer than MIN_SHELF films fall through).
  function houseDefaults() {
    const out = new Map();
    const tagSets = Object.entries(stock.tags || {}).map(([t, list]) => [t, new Set(list)]);
    for (const i of stock.aisles.rest || []) out.set(stock.films[i][0], UNCAT_SUB);
    for (const a of AISLES) {
      const films = (stock.aisles[a.id] || []).map((i) => {
        const [slug, name] = stock.films[i];
        const tags = new Set();
        for (const [t, set] of tagSets) if (set.has(i)) tags.add(t);
        return { slug, name, year: yearOf(name), tags };
      });
      let rules = SHELF_RULES.slice();
      for (;;) {
        const groups = new Map(rules.map((r) => [r, []]));
        for (const f of films) groups.get(rules.find((r) => r.test(f, a))).push(f);
        const tiny = rules.find((r) => r.id !== "e4" && groups.get(r).length > 0 && groups.get(r).length < MIN_SHELF);
        if (tiny) { rules = rules.filter((r) => r !== tiny); continue; }
        for (const [r, list] of groups) for (const f of list) out.set(f.slug, `${STOCKED}/${a.id}/${r.id}`);
        break;
      }
    }
    for (const [i, g] of Object.entries(stock.homes || {})) {
      const slug = stock.films[i][0];
      if (!out.has(slug)) out.set(slug, UNCAT_SUB);
    }
    return out;
  }

  function buildLibrary() {
    if (!defaults) defaults = houseDefaults();
    const genres = new Map();
    const cats = new Map();
    const subs = new Map();
    const addCat = (c) => { cats.set(c.id, { subs: [], ...c }); genres.get(c.genre).cats.push(c.id); };
    // A niche is a subcat inside a subcat (level 4): it has a parent and
    // sits in that subcat's niches rather than its category's subs.
    const addSub = (s) => {
      if (s.parent) {
        const par = subs.get(s.parent);
        if (!par || par.parent) return;
        subs.set(s.id, { ...s, cat: par.cat, niches: [] });
        par.niches.push(s.id);
        return;
      }
      subs.set(s.id, { niches: [], ...s });
      cats.get(s.cat).subs.push(s.id);
    };

    genres.set(UNCAT, { id: UNCAT, name: "Uncategorized", cats: [], uncat: true });
    addCat({ id: UNCAT_CAT, genre: UNCAT, name: "Uncategorized" });
    const H0 = house();
    for (const [id, name] of GENRES) genres.set(id, { id, name, cats: [] });
    // Genres made in dev mode, after Letterboxd's.
    for (const [id, g] of Object.entries(H0.genres || {}).sort((a, b) => collator.compare(a[1].name, b[1].name))) if (!genres.has(id)) genres.set(id, { id, name: g.name, cats: [], house: true });
    // Every genre has a "General" category (an ordinary one: nothing lands
    // there unless you put it there), and every category has a "General" subcat.
    for (const g of genres.keys()) {
      if (g === STOCKED || g === UNCAT) continue;
      addCat({ id: `${g}/rest`, genre: g, name: "General", order: 1 });
    }
    for (const a of [...AISLES, EVERYTHING]) {
      const id = `${STOCKED}/${a.id}`;
      addCat({ id, genre: STOCKED, name: a.name, aisle: a, order: 1 });
      for (const r of SHELF_RULES) addSub({ id: `${id}/${r.id}`, cat: id, name: r.name(a), order: r.order });
    }
    const H = house();
    for (const [id, c] of Object.entries(H.cats)) if (genres.has(c.genre) && !cats.has(id)) addCat({ id, genre: c.genre, name: c.name, house: true, order: 1 });
    for (const [id, c] of Object.entries(shared.cats)) if (genres.has(c.genre) && !cats.has(id)) addCat({ id, genre: c.genre, name: c.name, order: 1 });
    for (const [id, c] of Object.entries(mine.cats)) if (genres.has(c.genre) && !cats.has(id)) addCat({ id, genre: c.genre, name: c.name, own: true, order: 1 });
    for (const c of cats.values()) addSub({ id: `${c.id}/general`, cat: c.id, name: "General", order: 99 });
    // Subcats first, then niches (whose parent subcat must exist by then).
    for (const pass of [0, 1]) {
      for (const [src, extra] of [[H.subs, { house: true }], [shared.subs, {}], [mine.subs, { own: true }]]) {
        for (const [id, sc] of Object.entries(src)) {
          if (!!sc.parent !== !!pass || subs.has(id)) continue;
          if (!pass && !cats.has(sc.cat)) continue;
          addSub({ id, cat: sc.cat, parent: sc.parent, name: sc.name, order: 50, ...extra });
        }
      }
    }
    // Deleted folders (never a genre, Uncategorized, or a "General" subcat).
    for (const id of H.hidden) {
      if (id === UNCAT || id === UNCAT_CAT || /\/general$/.test(id)) continue;
      if (genres.has(id)) {
        // a deleted genre: its folders go with it, its films back to Uncategorized
        for (const cid of genres.get(id).cats) { for (const sid of cats.get(cid)?.subs || []) { for (const nid of subs.get(sid)?.niches || []) subs.delete(nid); subs.delete(sid); } cats.delete(cid); }
        genres.delete(id);
        continue;
      }
      if (cats.has(id)) {
        const c = cats.get(id);
        for (const sid of c.subs) subs.delete(sid);
        cats.delete(id);
        const g = genres.get(c.genre);
        g.cats = g.cats.filter((x) => x !== id);
      } else if (subs.has(id)) {
        const sc = subs.get(id);
        subs.delete(id);
        for (const nid of sc.niches || []) subs.delete(nid);
        if (sc.parent) { const par = subs.get(sc.parent); if (par) par.niches = par.niches.filter((x) => x !== id); }
        else { const c = cats.get(sc.cat); if (c) c.subs = c.subs.filter((x) => x !== id); }
      }
    }
    for (const [id, n] of Object.entries(H.names)) { const o = genres.get(id) || cats.get(id) || subs.get(id); if (o && n) o.name = n; }

    // Where every known film sits in the current view.
    const names = new Map(stock.films.map(([slug, name]) => [slug, name]));
    const place = new Map(defaults);
    for (const [slug, v] of Object.entries(H.place)) {
      const [sub, name] = Array.isArray(v) ? v : [v];
      place.set(slug, sub);
      if (name && !names.has(slug)) names.set(slug, name);
    }
    if (!edit.on) for (const [slug, sub] of Object.entries(shared.place)) if (subs.has(sub)) place.set(slug, sub);
    if (mine.view === "mine" && !edit.on) {
      for (const [slug, [sub, name]] of Object.entries(mine.place)) {
        if (!subs.has(sub)) continue;
        place.set(slug, sub);
        if (!names.has(slug)) names.set(slug, name);
      }
    }
    // Franchises: every film sits where #1 sits. frOf: film -> its franchise.
    const frs = allFranchises(), frOf = new Map();
    for (const [fid, fr] of Object.entries(frs)) for (const [s2] of fr.films) if (!frOf.has(s2)) frOf.set(s2, fid);
    for (const fr of Object.values(frs)) {
      const lead = fr.films.find(([s]) => place.has(s));
      if (!lead) continue;
      const at = place.get(lead[0]);
      for (const [s, n] of fr.films) { place.set(s, at); if (!names.has(s)) names.set(s, n); }
    }
    // A film whose folder was deleted drops one level: to its category's
    // General; a deleted category's films go back to Uncategorized.
    const home = (sub) => {
      if (subs.has(sub)) return sub;
      // A deleted niche's films go back to its subcat.
      const up = String(sub).split("/").slice(0, -1).join("/");
      if (up.split("/").length >= 3 && subs.has(up)) return up;
      const parts = String(sub).split("/");
      const cat = parts.slice(0, 2).join("/");
      return cats.has(cat) ? `${cat}/general` : UNCAT_SUB;
    };
    const inSub = new Map([...subs.keys()].map((k) => [k, []]));
    for (const [slug, sub] of place) {
      const at = home(sub);
      if (at !== sub) place.set(slug, at);
      inSub.get(at)?.push([slug, names.get(slug) || slug]);
    }
    for (const list of inSub.values()) list.sort(byTitle);

    const count = new Map();
    for (const [id, list] of inSub) {
      const s = subs.get(id);
      const c = cats.get(s.cat);
      count.set(id, (count.get(id) || 0) + list.length);
      if (s.parent) count.set(s.parent, (count.get(s.parent) || 0) + list.length);
      count.set(c.id, (count.get(c.id) || 0) + list.length);
      count.set(c.genre, (count.get(c.genre) || 0) + list.length);
    }
    const byName = (map) => (a, b) => (map.get(a).order || 1) - (map.get(b).order || 1) || collator.compare(map.get(a).name, map.get(b).name);
    for (const g of genres.values()) g.cats.sort(byName(cats));
    // The stocked genre lists its categories in wall order: the house order,
    // then the built-in order, own sections just before Everything Else.
    const wallKey = (id) => {
      const i = H.order.indexOf(id);
      if (i >= 0) return i;
      const w = WALL_ORDER.indexOf(id.split("/")[1]);
      return 1000 + (w >= 0 ? w : WALL_ORDER.length - 1.5);
    };
    genres.get(STOCKED)?.cats.sort((a, b) => wallKey(a) - wallKey(b));
    for (const g of genres.values()) if (g.id !== STOCKED && g.cats.some((c) => H.order.includes(c))) g.cats.sort((a, b) => wallKey(a) - wallKey(b));
    for (const c of cats.values()) {
      const o = H.subOrder[c.id];
      const k = (id) => { const i = o ? o.indexOf(id) : -1; return i < 0 ? 1e6 : i; };
      c.subs.sort((a, b) => k(a) - k(b) || byName(subs)(a, b));
      for (const sid of c.subs) { const o2 = H.subOrder[sid]; const k2 = (id) => { const i = o2 ? o2.indexOf(id) : -1; return i < 0 ? 1e6 : i; }; subs.get(sid).niches.sort((a, b) => k2(a) - k2(b) || byName(subs)(a, b)); }
    }
    const rank = (lib && lib.rank) || new Map(stock.films.map(([slug], i) => [slug, i]));
    lib = { genres, cats, subs, place, names, inSub, count, rank, frs, frOf };
    return lib;
  }

  // Which of genre/category/subcategory an id is, and its parts.
  function partsOf(id) {
    if (!id) return {};
    if (lib.genres.has(id)) return { genre: id };
    if (lib.cats.has(id)) return { genre: lib.cats.get(id).genre, cat: id };
    if (lib.subs.has(id)) {
      const s = lib.subs.get(id);
      return s.parent ? { genre: lib.cats.get(s.cat).genre, cat: s.cat, sub: s.parent, niche: id } : { genre: lib.cats.get(s.cat).genre, cat: s.cat, sub: id };
    }
    return {};
  }
  const nameOf = (id) => (String(id).startsWith("fr:") ? (lib.frs[id.slice(3)] || {}).name : (lib.genres.get(id) || lib.cats.get(id) || lib.subs.get(id) || {}).name) || "";
  // A film's franchise ({ id, name, films }), and the badge that opens it.
  const frFor = (slug) => { const fid = lib && lib.frOf && lib.frOf.get(slug); return fid ? { id: fid, ...lib.frs[fid] } : null; };
  const frBadge = (slug) => { const f = frFor(slug); return f ? `<button type="button" class="lbs-frbadge" data-act="fr-open" data-fr="${esc(f.id)}" title="Open the ${esc(f.name)} franchise">Franchise · ${esc(f.name)}</button>` : ""; };
  const openFranchiseById = (fid) => { const fr = lib.frs[fid]; if (fr && fr.films.length) openFranchise(fr.films[0][0], fr.films[0][1]); };
  function pathOf(id) {
    const p = partsOf(id);
    if (p.genre === UNCAT) return ["Uncategorized"];
    return [p.genre, p.cat, p.sub, p.niche].filter(Boolean).map(nameOf);
  }
  // A drop on a genre files under its Everything Else; on a category, under General.
  function landingSub(id) {
    if (id === UNCAT || id === UNCAT_CAT) return UNCAT_SUB;
    const p = partsOf(id);
    if (p.niche) return p.niche;
    if (p.sub) return p.sub;
    if (p.cat) return `${p.cat}/general`;
    if (p.genre) return `${p.genre}/rest/general`;
    return null;
  }
  // Films inside any folder (and the folders in it), A-Z.
  const withNiches = (sid) => [sid, ...((lib.subs.get(sid) || {}).niches || [])];
  function filmsIn(id) {
    const p = partsOf(id);
    if (p.niche) return lib.inSub.get(p.niche) || [];
    if (p.sub) return withNiches(p.sub).flatMap((x) => lib.inSub.get(x) || []).sort(byTitle);
    const subsOf = (p.cat ? lib.cats.get(p.cat).subs : (lib.genres.get(p.genre)?.cats || []).flatMap((c) => lib.cats.get(c).subs)).flatMap(withNiches);
    return subsOf.flatMap((s) => lib.inSub.get(s) || []).sort(byTitle);
  }

  /* ---------------- posters ---------------- */

  const posterCache = new Map(Object.entries(readJSON(POSTER_KEY, {})));
  let posterSaveTimer = 0;
  function rememberPoster(slug, urls) {
    posterCache.set(slug, urls);
    clearTimeout(posterSaveTimer);
    posterSaveTimer = setTimeout(() => {
      // Keep the most recent 4,000 so localStorage stays small.
      writeJSON(POSTER_KEY, Object.fromEntries([...posterCache.entries()].slice(-4000)));
    }, 1500);
  }

  async function posterFor(slug) {
    const hit = posterCache.get(slug);
    if (hit) return hit;
    const res = await posterLimit(() => fetch(`/film/${slug}/poster/std/150/`, { credentials: "include" }));
    if (!res.ok) throw new Error("no poster");
    const j = await res.json();
    const urls = [j.url, j.url2x || j.url];
    rememberPoster(slug, urls);
    return urls;
  }

  const EMPTY = "https://s.ltrbxd.com/static/img/empty-poster-150-DtnLDE3k.png";

  function makeWatcher(scroller, margin) {
    return "IntersectionObserver" in window
      ? new IntersectionObserver((entries, obs) => {
          for (const e of entries) {
            if (!e.isIntersecting) continue;
            obs.unobserve(e.target);
            fillPoster(e.target);
          }
        }, { root: scroller, rootMargin: margin })
      : null;
  }
  let io = null; // posters in the aisle
  let rowIo = null; // thumbnails in the desk

  /* Posters load with CORS (Letterboxd's image server allows it) so the
   * canvases they're drawn on stay readable: the eyedropper needs that. If a
   * CORS load ever fails, it loads again the plain way so nothing goes blank. */
  function corsSrc(im, src) {
    if (!src) return;
    if (im.crossOrigin !== "anonymous") im.crossOrigin = "anonymous";
    im.addEventListener("error", function retry() {
      if (im.crossOrigin == null || im._plain) return;
      im._plain = true; im.removeAttribute("crossorigin"); im.removeAttribute("srcset"); im.src = src;
    }, { once: true });
    im.src = src;
  }
  function fillPoster(el) {
    const img = el.querySelector("img");
    posterFor(el.dataset.slug)
      .then(([one, two]) => {
        img.crossOrigin = "anonymous";
        img.srcset = `${one} 1x, ${two} 2x`;
        corsSrc(img, one);
        el.classList.add("lbs-loaded");
      })
      .catch(() => el.classList.add("lbs-noposter"));
  }
  const imgAttrs = (slug) => {
    const c = posterCache.get(slug);
    return c ? `crossorigin="anonymous" src="${esc(c[0])}" srcset="${esc(c[0])} 1x, ${esc(c[1])} 2x"` : `src="${EMPTY}"`;
  };

  function posterHTML([slug, name], tag) {
    return (
      `<li class="lbs-item${posterCache.has(slug) ? " lbs-loaded" : ""}" data-slug="${esc(slug)}" data-name="${esc(name)}" data-dnd="film">` +
      `<div class="poster film-poster lbs-poster">` +
      `<img class="image" ${imgAttrs(slug)} width="150" height="225" alt="${esc(name)}" decoding="async" draggable="false">` +
      `<a class="frame" href="/film/${esc(slug)}/" title="${esc(name)}" draggable="false"><span class="frame-title">${esc(name)}</span><span class="overlay"></span></a>` +
      `</div>` +
      (tag ? `<span class="lbs-tag"><i></i>${esc(tag)}</span>` : "") +
      `</li>`
    );
  }

  /* ---------------- the store ---------------- */

  let root = null;
  let collection = "main";
  let walkway = null; // { track, els, aisles }

  const ICON_CLOSE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`;
  const ICON_LEFT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_RIGHT = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_UP = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 15l7-7 7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
  const ICON_FOLDER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6.5A1.5 1.5 0 0 1 4.5 5h4.2l2 2h8.8A1.5 1.5 0 0 1 21 8.5v9a1.5 1.5 0 0 1-1.5 1.5h-15A1.5 1.5 0 0 1 3 17.5z" fill="currentColor"/></svg>`;
  // The store's logo, an original mark (icons/bloxbuster-logo.svg, inlined: this script runs in the page).
  const LOGO_SVG = `<svg class="lbs-logo-svg" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 300" role="img" aria-label="BLOXBUSTER"> <rect x="6" y="6" width="588" height="288" rx="26" fill="#17191c" stroke="#3a3f46" stroke-width="4"/> <circle cx="34" cy="34" r="7" fill="#2c3036"/><circle cx="566" cy="34" r="7" fill="#2c3036"/> <circle cx="34" cy="266" r="7" fill="#2c3036"/><circle cx="566" cy="266" r="7" fill="#2c3036"/> <rect x="58" y="34" width="484" height="146" rx="10" fill="#e23b2e"/> <rect x="58" y="34" width="484" height="16" rx="8" fill="#f0e6cf"/> <rect x="58" y="164" width="484" height="16" rx="8" fill="#f0e6cf"/> <text x="300" y="139" text-anchor="middle" font-family="Impact, 'Haettenschweiler', 'Arial Narrow Bold', 'Arial Black', sans-serif" font-weight="900" font-size="92" letter-spacing="2" fill="#fff4dc" textLength="440" lengthAdjust="spacingAndGlyphs">BLOXBUSTER</text> <rect x="160" y="198" width="280" height="76" rx="38" fill="#0b0c0e" stroke="#3a3f46" stroke-width="4"/> <g fill="#f2efe6"> <circle cx="228" cy="236" r="27"/><circle cx="372" cy="236" r="27"/> </g> <g fill="#17191c"> <circle cx="228" cy="236" r="12"/><circle cx="372" cy="236" r="12"/> </g> <g fill="#f2efe6"> <rect x="225" y="222" width="6" height="8"/><rect x="225" y="242" width="6" height="8"/><rect x="214" y="233" width="8" height="6"/><rect x="234" y="233" width="8" height="6"/> <rect x="369" y="222" width="6" height="8"/><rect x="369" y="242" width="6" height="8"/><rect x="358" y="233" width="8" height="6"/><rect x="378" y="233" width="8" height="6"/> </g> <rect x="270" y="226" width="60" height="20" rx="3" fill="#2c3036"/> </svg>`;
  const ICON_GEAR = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h10M18 7h2M4 17h2M10 17h10" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="16" cy="7" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/><circle cx="8" cy="17" r="2.4" fill="none" stroke="currentColor" stroke-width="2.2"/></svg>`;
  const ICON_DROPPER = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M17.7 3.3a2.4 2.4 0 0 1 3.4 3.4l-2.6 2.6 1 1-1.5 1.5-1-1-7.6 7.6c-.4.4-.9.6-1.4.7l-2.3.4-1.3 1.3-1.4-1.4 1.3-1.3.4-2.3c.1-.5.3-1 .7-1.4l7.6-7.6-1-1L13.5 4l1 1zM8.6 13.6l-.6.6c-.1.1-.2.3-.2.4l-.2 1.4 1.4-.2c.1 0 .3-.1.4-.2l.6-.6z" fill="currentColor"/></svg>`;
  const ICON_SEARCH = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

  function openStore() {
    if (!document.body) return;
    if (BUILD_TAB && !openStore.built) { openStore.built = true; setTimeout(() => { if (root && $(".lbs-catbuild", root) && $(".lbs-catbuild", root).hidden) openCatBuild(); }, 1500); }
    if (!root) {
      root = h("div", "lbs-root");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "LetterBloxd Video Store");
      document.body.append(root);
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("keydown", onFieldKey);
      // No native drag and drop anywhere in the store. A native drag on
      // macOS can get stuck (when the thing being dragged is redrawn mid-drag)
      // and leave the whole computer ignoring clicks. Every drag here is our
      // own, done with the mouse (see mouseDndDown below).
      root.addEventListener("dragstart", (e) => e.preventDefault(), true);
      root.addEventListener("mousedown", mouseDndDown);
      root.addEventListener("contextmenu", onContextMenu);
      root.addEventListener("mousedown", (e) => {
        maybeCollapsePocket(e);
        if (e.button !== 0) return;
        const pc = edit.on && e.target.closest(".lbs-tray .lbs-piece");
        if (pc) { e.preventDefault(); return grabDown({ kind: "piece", cid: pc.dataset.cid, from: "tray" }, e); }
        const lr = e.target.closest(".lbs-lv-row");
        if (lr && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey) {
          const r = lv.rows[+lr.dataset.n];
          if (!r || e.target.closest("button")) return;
          const xs = rowSlugs(r);
          const inSel = xs.every((x) => lv.sel.has(x));
          const films = inSel && lv.sel.size > 1 ? lvFilms() : xs.map((x) => [x, lib.names.get(x) || x]);
          return grabDown({ kind: "dvd", slug: films[0][0], name: films[0][1], films: films.length > 1 ? films : null, from: "lib" }, e);
        }
        const dv = e.target.closest(".lbs-tray .lbs-dvd, .lbs-pk, .lbs-sp-chip, .lbs-lib-film");
        if (dv && !e.target.closest("button")) { e.preventDefault(); grabDown({ kind: "dvd", slug: dv.dataset.slug, name: dv.dataset.name, from: dv.classList.contains("lbs-lib-film") ? "lib" : dv.classList.contains("lbs-sp-chip") ? "card" : "tray" }, e); }
      });
      root.addEventListener("dblclick", (e) => {
        const fro = e.target.closest(".lbs-lv-row.-fr");
        if (fro) return openFranchiseById(fro.dataset.slug.slice(3));
        const lf = e.target.closest(".lbs-lib-film, .lbs-lv-row");
        if (lf) return openFilm(lf.dataset.slug, lf.dataset.name);
        const row = edit.on && e.target.closest(".lbs-folder");
        if (!row || isFixed(row.dataset.id)) return;
        edit.renaming = row.dataset.id;
        renderFolders();
      });
    }
    document.documentElement.classList.add("lbs-open");
    if (root.hidden || !root.firstChild) {
      root.hidden = false;
      render();
    }
  }

  function closeStore() {
    if (!root) return;
    root.hidden = true;
    document.documentElement.classList.remove("lbs-open");
  }

  function leaveStore() {
    if (history.state && history.state.lbsStore) history.back();
    else {
      history.replaceState(history.state, "", location.pathname + location.search);
      closeStore();
    }
  }

  function render() {
    if (catState === "idle") {
      Promise.all([loadCatalogue(), bigReady]).then(() => {
        if (catalogue) { stock = stockFromCatalogue(); defaults = null; lib = null; }
        if (root && !root.hidden) render();
      });
    }
    if (catState !== "loading") stock = stock || loadStock();
    const total = stock ? stock.films.length : COLLECTIONS[0].count;
    root.classList.toggle("lbs-nodates", !!mine.noDates);
    root.innerHTML =
      `<header class="lbs-top">` +
      (DESK_ONLY ? "" : `<div class="lbs-brand">LetterBloxd <span>video store</span></div>`) +
      (DESK_ONLY
        ? `<div class="lbs-logo">${LOGO_SVG}</div><button type="button" class="lbs-lib-btn -inhead" data-act="lib" aria-label="Library: every folder and film">${ICON_FOLDER}<span>Library</span></button>`
        : `<div class="lbs-wing-sign"><b>Horror</b><span>wing</span></div>`) +
      `<nav class="lbs-collections" aria-label="Collections"${DESK_ONLY ? " hidden" : ""}>` +
      COLLECTIONS.map((c) =>
        `<button type="button" class="lbs-coll${c.id === collection ? " -on" : ""}${c.open ? "" : " -soon"}" data-coll="${c.id}"${c.open ? "" : ' aria-disabled="true"'}>` +
        `${c.name} <span>${fmt(c.id === "main" ? total : c.count)}</span>${c.open ? "" : "<em>soon</em>"}</button>`
      ).join("") +
      `</nav>` +
      (DEV_TOOLS ? `<button type="button" class="lbs-edit-toggle" data-act="edit" aria-pressed="false">Dev mode</button>` : "") +
      `<button type="button" class="lbs-close" data-act="close" aria-label="Leave the store">${ICON_CLOSE}</button>` +
      `</header>` +
      `<div class="lbs-hall"></div>`;

    const hall = $(".lbs-hall", root);
    if (catState === "loading") { hall.append(h("div", "lbs-loading", `<p>Opening the store…</p>`)); return; }
    if (stock && DESK_ONLY) {
      buildLibrary();
      root.classList.add("lbs-desk-only");
      root.classList.toggle("lbs-browsing", !edit.on);
      if (!edit.on) desk.mode = "store";
      hall.innerHTML = deskHTML();
      desk.open = true;
      if (desk.folder === undefined) desk.folder = STOCKED;
      $(".lbs-drawer", root).hidden = false;
      renderDesk();
      $(".lbs-fq", root)?.focus();
      return;
    }
    if (stock) {
      buildLibrary();
      hall.innerHTML =
        `<div class="lbs-walk"></div>` +
        `<footer class="lbs-floor"><div class="lbs-map"></div><div class="lbs-you"></div></footer>` +
        deskHTML();
      buildWing();
      renderDesk();
      return;
    }

    const box = h("div", "lbs-loading", `<div class="lbs-meter"><i></i></div><p>Stocking the shelves: reading Horror's top ${fmt(COLLECTIONS[0].count)} films from Letterboxd and sorting them into categories. This happens once a week and takes about a minute.</p>`);
    hall.append(box);
    buildStock((f) => {
      const i = $(".lbs-meter i", root);
      if (i) i.style.width = `${Math.round(f * 100)}%`;
    })
      .then((s) => { stock = s; defaults = null; if (root && !root.hidden) render(); })
      .catch((err) => {
        box.innerHTML = `<p>Couldn't stock the shelves (${esc(err.message)}). <button type="button" class="lbs-retry" data-act="retry">Try again</button></p>`;
      });
  }

  // Sizes that make the shelving fill the height of the window.
  const HEAD = 64; // the aisle's wooden sign
  const LIP = 26; // shelf edge, where the laminated tags are taped
  const HEADROOM = 10; // gap between a poster's top and the shelf above
  const GAP = 8; // between posters
  const DIVIDER = 30; // between two shelves' worth of films on one row
  const PAD = 34; // inside the uprights
  const WOOD_EVERY = 1150; // px between repeats of the aisle sign
  const TAG_EVERY = 900; // px between repeats of a shelf tag

  function geometry(height) {
    const avail = Math.max(260, height - HEAD - 6);
    const rows = Math.max(3, Math.min(7, Math.floor(avail / 165)));
    const rowH = Math.floor(avail / rows);
    const ph = Math.max(78, Math.min(170, rowH - LIP - HEADROOM));
    return { rows, rowH, ph, pw: Math.round((ph * 2) / 3) };
  }

  // Lay shelves into rows: the first `rows` shelves take one row each, top
  // down; each later one starts to the right of whichever row ends first.
  function packRows(shelves, rows, g) {
    const lines = Array.from({ length: rows }, () => ({ width: 0, runs: [] }));
    const len = (n) => n * g.pw + (n - 1) * GAP;
    shelves.forEach((s, n) => {
      const line = n < rows ? lines[n] : lines.reduce((a, b) => (b.width < a.width ? b : a));
      if (line.runs.length) line.width += DIVIDER;
      line.runs.push(s);
      line.width += len(s.items.length);
    });
    return lines;
  }

  function aisleHTML(a, g, n) {
    const lines = a.lines;
    const inner = Math.max(...lines.map((l) => l.width), g.pw * 3);
    const width = inner + PAD * 2;
    const tagEvery = Math.max(5, Math.round(TAG_EVERY / (g.pw + GAP)));
    const woods = [];
    for (let x = PAD + 10; x < width - 200 || !woods.length; x += WOOD_EVERY) woods.push(x);
    return (
      `<section class="lbs-aisle${a.endcap ? " -endcap" : ""}" data-aisle="${esc(a.id)}" style="width:${width}px">` +
      `<div class="lbs-head">` +
      woods
        .map((x, k) => `<div class="lbs-wood" style="left:${x}px;--tilt:${[-0.6, 0.5, -0.3, 0.7][(n + k) % 4]}deg"${a.endcap ? "" : ` data-drop="${esc(a.id)}"`}><i></i><b>${esc(a.name)}</b><i></i></div>`)
        .join("") +
      `</div>` +
      lines
        .map(
          (line) =>
            `<div class="lbs-shelf">` +
            line.runs
              .map(
                (run) =>
                  `<ul class="lbs-run" data-shelf="${esc(run.id)}">` +
                  run.items
                    .map((film, k) => posterHTML(film, k === 0 || (k % tagEvery === 0 && run.items.length - k >= 3) ? run.name : ""))
                    .join("") +
                  `</ul>`
              )
              .join("") +
            `</div>`
        )
        .join("") +
      `</section>`
    );
  }

  function buildWing() {
    const walkEl = $(".lbs-walk", root);
    const keep = walkway && walkway.track.isConnected ? walkway.track.scrollLeft : 0;
    walkEl.innerHTML =
      `<button type="button" class="lbs-step -back" data-act="back" aria-label="Walk back">${ICON_LEFT}</button>` +
      `<div class="lbs-track" tabindex="0" aria-label="Horror wing. Scroll or use the arrow keys to walk."><div class="lbs-wall"></div></div>` +
      `<button type="button" class="lbs-step -on" data-act="on" aria-label="Walk on">${ICON_RIGHT}</button>`;

    const track = $(".lbs-track", walkEl);
    const wall = $(".lbs-wall", walkEl);
    if (io) io.disconnect();
    io = makeWatcher(track, "0px 1400px");
    const g = geometry(track.clientHeight || window.innerHeight - 140);
    root.style.setProperty("--ph", `${g.ph}px`);
    root.style.setProperty("--pw", `${g.pw}px`);
    root.style.setProperty("--row", `${g.rowH}px`);
    root.style.setProperty("--head", `${HEAD}px`);
    root.style.setProperty("--lip", `${LIP}px`);
    root.style.setProperty("--gap", `${GAP}px`);
    root.style.setProperty("--divider", `${DIVIDER}px`);
    root.style.setProperty("--pad", `${PAD}px`);

    // Aisles = Horror's categories, A-Z, Everything Else last.
    const aisles = lib.genres
      .get(STOCKED)
      .cats.map((id) => lib.cats.get(id))
      .map((c) => ({
        id: c.id,
        name: c.name,
        shelves: c.subs.map((s) => ({ id: s, name: lib.subs.get(s).name, items: lib.inSub.get(s) })).filter((s) => s.items.length),
      }))
      .filter((a) => a.shelves.length);
    aisles.forEach((a) => (a.lines = packRows(a.shelves, g.rows, g)));

    // The end cap at the head of the wing: this week's popular, face-out.
    if (stock.front && stock.front.length) {
      const per = Math.ceil(stock.front.length / g.rows);
      const lines = Array.from({ length: g.rows }, (_, r) => {
        const items = stock.front.slice(r * per, r * per + per);
        return { width: items.length ? items.length * g.pw + (items.length - 1) * GAP : 0, runs: items.length ? [{ id: "front", name: "This Week", items }] : [] };
      });
      aisles.unshift({ id: "front", name: "Popular This Week", endcap: true, lines });
    }

    wall.innerHTML = aisles.map((a, n) => aisleHTML(a, g, n)).join("");
    wall.querySelectorAll(".lbs-item:not(.lbs-loaded)").forEach((li) => (io ? io.observe(li) : fillPoster(li)));

    // Floor guide: every aisle, to scale. Click to walk there.
    const els = [...wall.children];
    $(".lbs-map", root).innerHTML = els
      .map((el, n) => `<button type="button" data-act="goto" data-n="${n}" style="flex-grow:${el.offsetWidth}" title="${esc(aisles[n].name)}"><span>${esc(aisles[n].name)}</span></button>`)
      .join("");
    walkway = { track, els, aisles };
    track.scrollLeft = keep;
    track.addEventListener("scroll", onWalk, { passive: true });
    track.addEventListener("wheel", onWheel, { passive: false });
    track.addEventListener("keydown", onKey);
    onWalk();
    if (!desk.open) track.focus({ preventScroll: true });
  }

  // Scrolling is walking: a vertical wheel moves you along the wing.
  function onWheel(e) {
    if (!walkway) return;
    const d = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
    if (!d) return;
    e.preventDefault();
    walkway.track.scrollLeft += d * (e.deltaMode === 1 ? 40 : 1);
  }

  function walk(dir) {
    const t = walkway.track;
    t.scrollBy({ left: dir * Math.max(t.clientWidth * 0.8, 300), behavior: "smooth" });
  }

  function onKey(e) {
    if (e.key === "ArrowRight" || e.key === "PageDown") { e.preventDefault(); walk(1); }
    else if (e.key === "ArrowLeft" || e.key === "PageUp") { e.preventDefault(); walk(-1); }
    else if (e.key === "Home") { e.preventDefault(); walkway.track.scrollTo({ left: 0, behavior: "smooth" }); }
    else if (e.key === "End") { e.preventDefault(); walkway.track.scrollTo({ left: walkway.track.scrollWidth, behavior: "smooth" }); }
  }

  let walkFrame = 0;
  let standingIn = null; // the aisle in the middle of the view
  function aisleHere() {
    if (!walkway) return null;
    const t = walkway.track;
    const mid = t.scrollLeft + t.clientWidth / 2;
    const n = walkway.els.findIndex((el) => el.offsetLeft <= mid && mid < el.offsetLeft + el.offsetWidth);
    return n >= 0 && !walkway.aisles[n].endcap ? walkway.aisles[n].id : null;
  }
  function onWalk() {
    if (walkFrame) return;
    walkFrame = requestAnimationFrame(() => {
      walkFrame = 0;
      if (!walkway) return;
      const t = walkway.track;
      const w = t.scrollWidth || 1;
      const you = $(".lbs-you", root);
      if (you) {
        you.style.left = `${(t.scrollLeft / w) * 100}%`;
        you.style.width = `${(t.clientWidth / w) * 100}%`;
      }
      $(".lbs-step.-back", root).hidden = t.scrollLeft < 4;
      $(".lbs-step.-on", root).hidden = t.scrollLeft + t.clientWidth >= t.scrollWidth - 4;
      const mid = t.scrollLeft + t.clientWidth / 2;
      const btns = root.querySelectorAll(".lbs-map button");
      walkway.els.forEach((el, n) => {
        const here = el.offsetLeft <= mid && mid < el.offsetLeft + el.offsetWidth;
        if (btns[n]) btns[n].classList.toggle("-here", here);
        if (here) standingIn = walkway.aisles[n].endcap ? null : walkway.aisles[n].id;
      });
      if (!desk.open) renderDeskBar();
    });
  }

  let resizeTimer = 0;
  window.addEventListener("resize", () => {
    if (!root || root.hidden || !walkway) return;
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      const at = walkway.track.scrollLeft / (walkway.track.scrollWidth || 1);
      buildWing();
      walkway.track.scrollLeft = at * walkway.track.scrollWidth;
    }, 200);
  });

  /* ---------------- the sorting desk ---------------- */

  const desk = {
    open: false,
    mode: "store", // left side: "store" (the wall) or "list" (the folders)
    folder: STOCKED, // the open folder (null = all genres)
    scope: "folder", // left search: "folder" or "all"
    q: "", // left search text
    fq: "", // folder search text
    shown: 150, // rows listed on the left
    selected: new Set(),
    anchor: null, // for shift-click ranges
    moving: null, // films waiting for a "Move to…" destination
    adding: null, // { level: "cat"|"sub"|"genre", parent }
    results: null, // "All of Letterboxd" results
  };

  function deskHTML() {
    return (
      `<section class="lbs-drawer" aria-label="Sorting desk" hidden>` +
      `<div class="lbs-films">` +
      `<div class="lbs-films-top">` +
      `<div class="lbs-mode" role="group" aria-label="Show"><button type="button" data-mode="store">Wall</button><button type="button" data-mode="list">Folders</button></div>` +
      `<label class="lbs-search">${ICON_SEARCH}<input type="search" class="lbs-fq" placeholder="Search films" autocomplete="off"></label>` +
      `<div class="lbs-scope" role="group" aria-label="Search in"><button type="button" data-scope="folder">This folder</button><button type="button" data-scope="all">All of Letterboxd</button></div>` +
      `</div>` +
      `<div class="lbs-where"></div>` +
      `<div class="lbs-moving" hidden></div>` +
      `<div class="lbs-stage" hidden>` +
      `<div class="lbs-stage-top"><div class="lbs-stage-path"></div>` +
      `<div class="lbs-zoom"><button type="button" data-act="zoom-out" aria-label="Zoom out">−</button><button type="button" data-act="zoom-in" aria-label="Zoom in">+</button></div></div>` +
      `<canvas class="lbs-canvas" draggable="false" aria-label="Horror wall. Scroll to move, pinch or Ctrl-scroll to zoom, drag a spine to a folder."></canvas>` +
      `<div class="lbs-tip" hidden></div><div class="lbs-sortpick" hidden></div>` +
      `<div class="lbs-logopick" hidden></div><div class="lbs-logobuild" hidden></div><div class="lbs-logobuild lbs-catbuild" hidden></div>` +
      `<p class="lbs-credit" hidden>Title logos from <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>` +
      `</div>` +
      `<ul class="lbs-rows" role="listbox" aria-multiselectable="true"></ul>` +
      `</div>` +
      `<div class="lbs-folders lbs-inv">` +
      `<div class="lbs-editbar" hidden></div>` +
      `<div class="lbs-tray" data-drop="@inv"></div>` +
      `</div>` +
      `</section>` +
      // The find bar stays put, above the Library, whether it's open or not.
      `<div class="lbs-find">` +
      `<button type="button" class="lbs-lib-btn" data-act="lib" aria-label="Library: every folder and film">${ICON_FOLDER}<span>Library</span></button>` +
      `<div class="lbs-find-box">${ICON_SEARCH}<input type="search" class="lbs-find-q" placeholder="Find a movie, person or studio" autocomplete="off" spellcheck="false">` +
      `<button type="button" class="lbs-find-type" data-act="find-type" aria-haspopup="menu" aria-label="Search for">Movie<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>` +
      `<button type="button" class="lbs-gear" data-act="settings" aria-haspopup="menu" aria-label="Settings" title="Settings">${ICON_GEAR}</button>` +
      `<ul class="lbs-find-types lbs-menu" role="menu" hidden><li><button type="button" data-act="find-as" data-v="film" class="-on">Movie</button></li><li><button type="button" disabled>People &amp; studios <em>just type a name</em></button></li></ul>` +
      `<div class="lbs-settings lbs-menu" role="menu" hidden></div>` +
      `<ul class="lbs-find-list" hidden></ul><div class="lbs-card" hidden></div></div>` +
      `<div class="lbs-pocket" hidden></div>` +
      `<div class="lbs-filmview" hidden></div>` +
      `<aside class="lbs-library" aria-label="Library" hidden></aside>` +
      `<div class="lbs-ask" hidden></div>` +
      `<div class="lbs-deskbar">` +
      `<button type="button" class="lbs-pocket-tab" data-act="pocket">${ICON_UP}<span>Inventory</span><em></em></button>` +
      `<button type="button" class="lbs-desk-toggle" data-act="desk">${ICON_UP}<span>Sorting desk</span></button>` +
      `<div class="lbs-deskbar-path"></div>` +
      `<div class="lbs-view" role="group" aria-label="Whose shelves"><button type="button" data-view="community">Community</button><button type="button" data-view="mine">Mine <span></span></button></div>` +
      `</div>` +
      `<div class="lbs-toast" role="status" hidden></div>`
    );
  }

  function setDesk(open) {
    desk.open = open;
    const d = $(".lbs-drawer", root);
    if (!d) return;
    root.classList.toggle("lbs-desk-open", open);
    if (open) {
      d.hidden = false;
      if (!desk.folder) {
        desk.folder = aisleHere() || STOCKED;
      }
      renderDesk();
    } else {
      d.hidden = true;
      desk.moving = null;
      renderDesk();
      walkway?.track.focus({ preventScroll: true });
    }
  }

  const pathHTML = (id, act) =>
    pathOf(id)
      .map((n, k, all) => {
        const p = partsOf(id);
        const target = [p.genre, p.cat, p.sub][k];
        return `<button type="button" class="lbs-crumb" data-act="${act}" data-id="${esc(target)}" data-drop="${esc(target)}">${esc(n)}</button>${k < all.length - 1 ? '<i aria-hidden="true">›</i>' : ""}`;
      })
      .join("");

  function renderDeskBar() {
    const bar = $(".lbs-deskbar-path", root);
    if (!bar) return;
    const here = desk.open ? desk.folder : aisleHere();
    bar.innerHTML = here
      ? `${pathHTML(here, "open")}<span class="lbs-hint">${desk.open ? "" : "· drag any film here to re-file it"}</span>`
      : `<span class="lbs-hint">Drag any film here to re-file it</span>`;
    const n = Object.keys(mine.place).length;
    root.querySelectorAll(".lbs-view button").forEach((b) => b.classList.toggle("-on", b.dataset.view === mine.view));
    const badge = $(".lbs-view [data-view=mine] span", root);
    if (badge) badge.textContent = n ? fmt(n) : "";
    $(".lbs-desk-toggle", root)?.classList.toggle("-open", desk.open);
  }

  function renderDesk() {
    renderDeskBar();
    if (!desk.open) return;
    renderFilms();
    renderFolders();
  }

  // Left: films.
  let searchTimer = 0;
  let searchSeq = 0;
  function renderFilms() {
    const where = $(".lbs-where", root);
    const list = $(".lbs-rows", root);
    root.querySelectorAll(".lbs-scope button").forEach((b) => b.classList.toggle("-on", b.dataset.scope === desk.scope));
    const field = $(".lbs-fq", root);
    if (field && field.value !== desk.q) field.value = desk.q;
    field.placeholder = desk.scope === "all" ? "Search all of Letterboxd" : desk.mode === "list" && !partsOf(desk.folder).sub ? `Search folders${desk.folder ? ` in ${nameOf(desk.folder)}` : ""}` : `Search ${nameOf(desk.folder) || "films"}`;

    const moving = $(".lbs-moving", root);
    moving.hidden = !desk.moving;
    if (desk.moving) {
      const n = desk.moving.length;
      moving.innerHTML = `Moving <b>${n === 1 ? esc(titleOf(desk.moving[0][1])) : `${n} films`}</b>. Open a folder, then <b>Move here</b>. <button type="button" data-act="cancel-move">Cancel</button>`;
    }

    root.querySelectorAll(".lbs-mode button").forEach((b) => b.classList.toggle("-on", b.dataset.mode === desk.mode));
    const storeMode = desk.mode === "store";
    where.hidden = list.hidden = storeMode;
    $(".lbs-stage", root).hidden = !storeMode;
    if (storeMode) return showStage();

    // Folders: a folder that holds folders shows those; a subcategory shows its films.
    const here = partsOf(desk.folder);
    if (desk.scope !== "all" && !here.sub) return renderBrowser(where, list);

    let films;
    if (desk.scope === "all") {
      where.innerHTML = desk.q.trim().length < 2 ? `<span>Type a title to search every film on Letterboxd.</span>` : desk.results ? `<span>${fmt(desk.results.length)} matches on Letterboxd</span>` : `<span>Searching…</span>`;
      films = desk.results || [];
    } else {
      const all = filmsIn(desk.folder);
      const q = desk.q.trim().toLowerCase();
      films = q ? all.filter(([, name]) => name.toLowerCase().includes(q)) : all;
      where.innerHTML = `${crumbsHTML()}<span>· ${fmt(films.length)} film${films.length === 1 ? "" : "s"}${q ? " match" : ""}</span>`;
    }

    if (rowIo) rowIo.disconnect();
    rowIo = makeWatcher(list, "300px 0px");
    const show = films.slice(0, desk.shown);
    list.innerHTML =
      show
        .map(([slug, name]) => {
          const at = lib.place.get(slug);
          const loc = at ? pathOf(at).join(" › ") : "Not in the store yet";
          const own = mine.place[slug] ? `<em title="You filed this one">you</em>` : "";
          return (
            `<li class="lbs-row${desk.selected.has(slug) ? " -sel" : ""}${posterCache.has(slug) ? " lbs-loaded" : ""}" data-slug="${esc(slug)}" data-name="${esc(name)}" data-dnd="film" role="option" aria-selected="${desk.selected.has(slug)}">` +
            `<img ${imgAttrs(slug)} alt="" width="30" height="45" draggable="false">` +
            `<div class="lbs-row-text"><b>${esc(titleOf(name))}</b> <span>${yearOf(name) || ""}</span><small>${own}${esc(loc)}</small></div>` +
            `<a class="lbs-row-open" href="/film/${esc(slug)}/" title="Open on Letterboxd" draggable="false">↗</a>` +
            `</li>`
          );
        })
        .join("") +
      (films.length > show.length ? `<li class="lbs-rows-more"><button type="button" data-act="more">Show more <span>${fmt(films.length - show.length)} left</span></button></li>` : "") +
      (!films.length && desk.scope === "folder" ? `<li class="lbs-rows-empty">${desk.q ? "No films here match." : "Empty. Drag films in from anywhere."}</li>` : "");
    list.querySelectorAll(".lbs-row:not(.lbs-loaded)").forEach((li) => (rowIo ? rowIo.observe(li) : fillPoster(li)));
  }

  function searchAll() {
    clearTimeout(searchTimer);
    const q = desk.q.trim();
    desk.results = null;
    if (q.length < 2) return renderFilms();
    renderFilms();
    const seq = ++searchSeq;
    searchTimer = setTimeout(async () => {
      try {
        const res = await fetch(`/s/autocompletefilm?q=${encodeURIComponent(q)}&limit=30`, { credentials: "include" });
        const j = await res.json();
        if (seq !== searchSeq) return;
        desk.results = (j.data || []).map((f) => [f.slug || String(f.url || "").split("/").filter(Boolean).pop(), `${f.name}${f.releaseYear ? ` (${f.releaseYear})` : ""}`]).filter(([s]) => s);
      } catch {
        desk.results = [];
      }
      if (seq === searchSeq) renderFilms();
    }, 220);
  }

  const crumbsHTML = () =>
    `<button type="button" class="lbs-up" data-act="up" aria-label="Up one level"${desk.folder ? "" : " disabled"}>${ICON_UP}</button>` +
    `<button type="button" class="lbs-crumb" data-act="open" data-id="" data-drop="">All genres</button>` +
    (desk.folder ? `<i aria-hidden="true">›</i>${pathHTML(desk.folder, "open")}` : "");

  // A folder row (with the editing tools in edit mode).
  function folderRow(id) {
    const o = lib.cats.get(id) || lib.subs.get(id);
    if (edit.on && edit.renaming === id) return `<li class="lbs-adding"><input type="text" class="lbs-rename" maxlength="40" value="${esc(nameOf(id))}"></li>`;
    if (edit.on && edit.deleting === id) {
      const n = lib.count.get(id) || 0;
      return `<li class="lbs-confirm">Delete <b>${esc(nameOf(id))}</b>?${n ? ` Its ${fmt(n)} film${n === 1 ? "" : "s"} go to ${lib.cats.has(id) ? "Uncategorized" : "General"}.` : ""} <button type="button" data-act="del-yes" data-id="${esc(id)}">Delete</button><button type="button" data-act="del-no">Keep</button></li>`;
    }
    const tools = !edit.on || lib.genres.has(id) ? "" :
      `<span class="lbs-tools">` +
      (o && o.own ? `<button type="button" data-act="approve" data-id="${esc(id)}" title="Approve: add to the house plan">✓</button>` : "") +
      (isFixed(id) ? "" : `<button type="button" data-act="rename" data-id="${esc(id)}" title="Rename">✎</button><button type="button" data-act="del" data-id="${esc(id)}" title="Delete">✕</button>`) +
      `</span>`;
    const kids = lib.genres.has(id) || lib.cats.has(id);
    const own = o && o.own ? `<em class="lbs-proposed" title="Only you can see this until a moderator approves it">proposed</em>` : "";
    const move = desk.moving ? `<button type="button" class="lbs-move-here" data-act="move-here" data-id="${esc(id)}">Move here</button>` : "";
    return (
      `<li class="lbs-folder${edit.on && edit.sel === id ? " -editsel" : ""}" data-act="open" data-id="${esc(id)}" data-drop="${esc(id)}"${edit.on && !lib.genres.has(id) ? ' data-dnd="folder"' : ""}>` +
      `${ICON_FOLDER}<span class="lbs-folder-name">${esc(nameOf(id))}</span>${own}<span class="lbs-n">${fmt(lib.count.get(id) || 0)}</span>${tools}${kids ? '<i class="lbs-chev" aria-hidden="true">›</i>' : ""}${move}</li>`
    );
  }

  // The folders view: the open folder's folders, like a file browser.
  function renderBrowser(where, list) {
    const p = partsOf(desk.folder);
    const q = desk.q.trim().toLowerCase();
    let ids, adder = "";
    if (q) {
      // Search: folders anywhere below this one.
      const under = (id) => !desk.folder || id === desk.folder || id.startsWith(desk.folder + "/") || partsOf(id).genre === desk.folder || partsOf(id).cat === desk.folder;
      ids = [...lib.cats.keys(), ...lib.subs.keys(), ...lib.genres.keys()].filter((id) => under(id) && nameOf(id).toLowerCase().includes(q)).slice(0, 120);
      where.innerHTML = `${crumbsHTML()}<span>· ${fmt(ids.length)} folder${ids.length === 1 ? "" : "s"} match</span>`;
    } else {
      ids = !desk.folder ? [...lib.genres.keys()] : p.cat ? lib.cats.get(p.cat).subs : lib.genres.get(p.genre).cats;
      const level = !desk.folder ? null : p.cat ? "sub" : "cat";
      if (level) {
        adder =
          desk.adding && desk.adding.level === level && desk.adding.parent === desk.folder
            ? `<li class="lbs-adding"><input type="text" class="lbs-new" maxlength="40" placeholder="${level === "cat" ? "New category" : "New subcategory"}"></li>`
            : `<li class="lbs-add"><button type="button" data-act="add" data-level="${level}" data-parent="${esc(desk.folder)}">+ New ${level === "cat" ? "category" : "subcategory"}</button></li>`;
      }
      where.innerHTML = `${crumbsHTML()}<span>· ${fmt(ids.length)} folder${ids.length === 1 ? "" : "s"}</span>`;
    }
    list.innerHTML = `<li class="lbs-browse"><ul>${ids.map((id) => (q ? folderRow(id).replace('<span class="lbs-folder-name">', `<span class="lbs-folder-name"><small>${esc(pathOf(id).slice(0, -1).join(" › "))}${pathOf(id).length > 1 ? " › " : ""}</small>`) : folderRow(id))).join("")}${adder}</ul></li>`;
    const input = $(".lbs-new, .lbs-rename", list);
    if (input) { input.focus(); if (input.classList.contains("lbs-rename")) input.select(); }
  }

  // The right-hand column (inventory), and the folders view if it's showing.
  function renderFolders() {
    renderEditBar();
    renderTray();
    renderPocket();
    renderLibrary();
    if (desk.open && desk.mode === "list") renderFilms();
  }

  function openFolder(id) {
    desk.folder = id || null;
    desk.q = "";
    desk.fq = "";
    desk.shown = 150;
    desk.selected.clear();
    if (desk.scope === "all") desk.scope = "folder";
    renderDesk();
  }

  function addFolder(level, parent, name) {
    name = name.trim().replace(/\s+/g, " ");
    if (!name) return;
    if (level === "genre") {
      if (!edit.on) return toast("New genres are made in Dev mode.");
      let gid = `g-${slugify(name)}`;
      for (let n = 2; lib.genres.has(gid); n++) gid = `g-${slugify(name)}-${n}`;
      houseEdit(`Added the genre “${name}”.`, (H) => { H.genres = { ...(H.genres || {}), [gid]: { name } }; H.hidden = H.hidden.filter((x) => x !== gid); });
      libUI.path = [gid];
      return renderLibrary();
    }
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "folder";
    let id = `${parent}/u-${slug}`;
    for (let n = 2; lib.cats.has(id) || lib.subs.has(id); n++) id = `${parent}/u-${slug}-${n}`;
    if (edit.on) {
      const hid = freshId(`${parent}/h-${slugify(name)}`);
      desk.adding = null;
      houseEdit(`Added “${name}”.`, (H) => {
        if (level === "cat") { H.cats[hid] = { genre: parent, name }; if (parent === STOCKED) H.order = [...lib.genres.get(STOCKED).cats.filter((c) => !/\/rest$/.test(c)), hid, `${STOCKED}/rest`]; }
        else if (level === "niche") H.subs[hid] = { cat: lib.subs.get(parent).cat, parent, name };
        else H.subs[hid] = { cat: parent, name };
      });
      desk.folder = hid;
      if (level === "cat") edit.sel = hid;
      return renderDesk();
    }
    if (level === "cat") mine.cats[id] = { genre: parent, name };
    else if (level === "niche") mine.subs[id] = { cat: lib.subs.get(parent).cat, parent, name };
    else mine.subs[id] = { cat: parent, name };
    saveMine();
    shareEdit(level === "cat" ? "add-section" : level === "niche" ? "add-niche" : "add-subsection", id, level === "niche" ? { name, parent, cat: lib.subs.get(parent).cat } : { name, parent });
    buildLibrary();
    desk.adding = null;
    desk.folder = id;
    renderDesk();
    toast(`Made “${name}”. It's yours until a moderator approves it.`);
  }


  /* ---------------- the store floor (left side, "Store" mode) ----------------
   * One big map of the Horror wall in "wall units". Sections pour onto the
   * shelves in WALL_ORDER: across a shelf, down to the next, then into the next
   * bay. A camera (x, y, zoom) moves over it and only the bays in view are
   * drawn, at a level of detail that depends on zoom:
   *   far    section colour blocks + names
   *   middle spine impressions + 3 face-out highlights per section
   *   near   spines with titles; hover for the poster, drag one to a folder
   */
  const WALL_ORDER = ["gothic", "haunted", "creepy", "vampires", "madsci", "creature", "zombies", "extreme", "slashers", "giallo", "eighties", "jhorror", "comedy", "rest"];
  const HUES = [282, 262, 220, 350, 160, 95, 120, 8, 0, 35, 315, 190, 48, 210];
  const WU = { bayW: 1000, gap: 36, pad: 5, sign: 260, shelfH: 200, shelves: 6, lip: 14 };
  const HANG_H = 216, HANG_DROP = 18; // the hanging category boards over each bay
  const AISLE_W = 900, AISLE_GAP = 90; // the big aisle sign at the start of each row of bays
  const ROW_H = WU.sign + WU.shelves * WU.shelfH + 150; // a row of bays plus the floor between rows
  const PILE_W = 2600, PILE_H = 1500, PILE_GAP = 900; // the uncategorized pile, in the corner
  const RUN_GAP = 700, GENRE_GAP = 400; // between runs of aisles, and between genres in a run
  const FAR = 0.09, NEAR = 0.45, TEXT = 0.8, ZMIN = 0.02, ZMAX = 6;
  const DEPTH_X = 4, DEPTH_Y = 5; // the sliver of top and side we see
  // Case plastic, as seen on top: VHS clamshells (darkest), DVDs, Blu-rays.
  /* Formats. Which case a film comes in goes by its year: film cans, VHS,
   * DVD, Blu-ray, each up to its cutoff year (Settings lets you switch
   * formats off and move the cutoffs). The last format switched on takes
   * everything after the one before it, and films with no year. */
  const FORMATS = [["can", "Film can", 1969], ["vhs", "VHS", 1999], ["dvd", "DVD", 2015], ["bluray", "Blu-ray", null]];
  function formatPlan() {
    const set = mine.formats || {};
    const on = FORMATS.filter(([k]) => (set[k] ? set[k].on !== false : true));
    const list = on.length ? on : [FORMATS[3]];
    return list.map(([k], i) => [k, i === list.length - 1 ? Infinity : +((set[k] && set[k].to) || FORMATS.find((x) => x[0] === k)[2])]);
  }
  let fmtPlan = null;
  const fmtOf = (y) => {
    const plan = fmtPlan || (fmtPlan = formatPlan());
    if (!y) return plan[plan.length - 1][0];
    for (const [k, to] of plan) if (y <= to) return k;
    return plan[plan.length - 1][0];
  };
  const caseTop = (y) => ({ can: "#141517", vhs: "#141517", dvd: "#25272b", bluray: "#1d5aa6" })[fmtOf(y)];
  const YEAR_ZONE = 18; // the year sits in this much of the bottom of a spine
  const CASE_END = 3, LAMINATE = 5, PAPER_IN = CASE_END + LAMINATE; // paper wrap stops short of the case ends
  const PAPER_TOP = PAPER_IN - 3; // where the paper wrap starts and ends (same at both ends)
  const CORNER = 1.6; // rounded case corners
  const YEAR_FS = 6.6; // the year: one size on every format
  // The year: white, unless the spine is too light for it.
  const yearInk = (own) => (own && lum(rgbOf(own)) > 0.62 ? "rgba(10,12,14,0.85)" : "rgba(255,255,255,0.9)");
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const wall = { level: "wall", bayCache: new Map(), lay: null, cam: { x: 0, y: 0, z: 0.05 }, hover: null, pin: null, lite: false, slow: 0, imgs: new Map(), logos: new Map(), frame: 0 };
  // 1969 and earlier: round steel film cans, standing on edge. Then VHS, DVD, Blu-ray.
  const isCan = (y) => fmtOf(y) === "can";
  const CAN_RX = 5, CAN_T = 25; // a can's lid ellipse half-width and rim thickness (see drawCan)
  const CAN_LIP = 2.6, CAN_GAP = 0.7, CAN_TAPE = CAN_T - 2 * (CAN_LIP + CAN_GAP); // its rolled lips, the bare steel beside them, the tape
  const spineW = (y) => ({ can: CAN_T, vhs: 20, dvd: 12, bluray: 10 })[fmtOf(y)];
  const spineH = (y) => ({ can: WU.shelfH - WU.lip - 1, vhs: 168, dvd: 158, bluray: 148 })[fmtOf(y)];
  const hash = (s) => { let x = 2166136261; for (let i = 0; i < s.length; i++) x = Math.imul(x ^ s.charCodeAt(i), 16777619); return x >>> 0; };

  /* The wall is built from "pieces". Each section's films, A-Z, are cut into
   * shelf-length pieces (the last one shorter): 2,500 units of Witches is two
   * full pieces and a half. The house plan says which shelf each piece sits on
   * (several small pieces can share a shelf). Films flow through a section's
   * placed pieces in reading order: down a bay first, then across. Pieces not
   * on the wall wait in the moderator's bucket.
   * A shelf that's at least 85% full is justified: the slack is taken up by
   * leaning spines. Fuller than that, it stays as is, with a gap at the end. */
  const CAP = WU.bayW - WU.pad * 2;
  const BOOKEND = 10, JUSTIFY = 0.83, MAX_LEAN = 0.42, LEAN_EACH = 48;
  const footprint = (list) => list.reduce((n, f) => n + f.w + 1, 0);
  const leanReach = (group, a) => (group.length ? group[0].h * Math.sin(a) + group.reduce((n, f) => n + f.w * (1 / Math.cos(a) - 1), 0) : 0);
  function solveLean(group, gap) {
    let lo = 0, hi = MAX_LEAN;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (leanReach(group, mid) < gap) lo = mid; else hi = mid; }
    return lo;
  }
  // One colour per section, spread round the wheel so neighbours never match.
  // One colour per category, spread round the wheel across the whole room.
  let roomCatCount = 1;
  const secHue = (i) => { const n = Math.max(1, roomCatCount), step = n % 5 ? 5 : 3; return (((i * step) % n) * 360) / n + 10; };

  // Every section's films (shelf order) and its pieces' lengths.
  // How a section is ordered: your own choice, else the house's, else A-Z.
  const sortOf = (cid) => (!edit.on && mine.sort[cid]) || house().sort[cid] || "title";
  // A section's films in shelf order (held films left out).
  function sectionOrder(cid) {
    return groupFranchises(sectionOrderRaw(cid));
  }
  // A franchise's films come together, in franchise order, where #1 falls.
  function groupFranchises(list) {
    const frs = Object.values(allFranchises());
    if (!frs.length) return list;
    const owner = new Map();
    frs.forEach((fr, k) => fr.films.forEach(([s], i) => owner.set(s, [k, i])));
    const out = [], done = new Set();
    const bySlug = new Map(list.map((f) => [f.slug, f]));
    for (const f of list) {
      const o = owner.get(f.slug);
      if (!o) { out.push(f); continue; }
      if (done.has(o[0])) continue;
      done.add(o[0]);
      for (const [s] of frs[o[0]].films) if (bySlug.has(s)) out.push({ ...bySlug.get(s), fr: o[0], blk: f.blk });
    }
    return out;
  }
  // A franchise lives in #1's section: films pulled in from other sections
  // move there, keeping their own subsection.
  function franchiseHomes() {
    const home = new Map();
    for (const fr of Object.values(allFranchises())) {
      const lead = fr.films[0] && filmSection(fr.films[0][0]);
      if (!lead) continue;
      for (const [s] of fr.films) { const at = filmSection(s); if (at && at !== lead) home.set(s, lead); }
    }
    return home;
  }
  function sectionOrderRaw(cid) {
    const H = house();
    const held = new Set(H.held.map(([slug]) => slug));
    const homes = franchiseHomes();
    const list = [];
    // Every folder in the category is a block on the shelf: each subcat's
    // niches first, then the subcat itself (whatever its niches didn't take).
    const blocks = blocksOf(cid);
    for (const bid of blocks) for (const [slug, name] of lib.inSub.get(bid) || []) if (!held.has(slug) && !homes.has(slug)) list.push({ slug, name, sub: bid, blk: bid });
    // Films pulled in by a franchise from another category join #1's block.
    for (const [slug, to] of homes) {
      if (to !== cid || held.has(slug)) continue;
      const sid = lib.place.get(slug);
      const hit = (lib.inSub.get(sid) || []).find(([s]) => s === slug);
      if (hit) list.push({ slug, name: hit[1], sub: sid, blk: sid });
    }
    const az = (a, b) => byTitle([a.slug, a.name], [b.slug, b.name]);
    const mode = sortOf(cid);
    // Blocks sit together on the shelf, each with its own tag, in folder
    // order ("General" last); A-Z or by year inside each.
    const subAt = new Map(blocks.map((bid, i) => [bid, i]));
    const bySub = (a, b) => (subAt.get(a.blk) ?? 1e7) - (subAt.get(b.blk) ?? 1e7);
    if (mode === "year") return list.sort((a, b) => bySub(a, b) || (yearOf(a.name) || 9999) - (yearOf(b.name) || 9999) || az(a, b));
    if (mode !== "index") return list.sort((a, b) => bySub(a, b) || az(a, b));
    list.sort(az);
    const index = mode === "index" && H.index[cid];
    if (!index) return list.sort(bySub);
    // Hand order; films it doesn't know yet slot in where A-Z would put them.
    const pos = new Map(index.map((slug, i) => [slug, i]));
    const known = list.filter((f) => pos.has(f.slug)).sort((a, b) => pos.get(a.slug) - pos.get(b.slug));
    const out = [];
    let k = 0;
    for (const f of list) {
      if (pos.has(f.slug)) continue;
      while (k < known.length && az(known[k], f) < 0) out.push(known[k++]);
      out.push(f);
    }
    while (k < known.length) out.push(known[k++]);
    return out.sort(bySub); // hand order, inside each block
  }
  // A category's blocks in shelf order: each subcat's niches, then the subcat ("General" last).
  function blocksOf(cid) {
    const c = lib.cats.get(cid);
    if (!c) return [];
    const subsIn = [...c.subs.filter((x) => !/\/general$/.test(x)), ...c.subs.filter((x) => /\/general$/.test(x))];
    return subsIn.flatMap((sid) => [...(lib.subs.get(sid).niches || []), sid]);
  }

  // Every block on the wall (a subcat, or a niche), category by category:
  // its films in shelf order and how much shelf they need.
  function sectionStock() {
    const out = new Map();
    const cats = roomCats();
    roomCatCount = cats.length;
    cats.forEach((cid, n) => {
      const genre = lib.cats.get(cid).genre;
      for (const bid of blocksOf(cid)) out.set(bid, { id: bid, cat: cid, genre, n, items: [], total: 0 });
      for (const f of sectionOrder(cid)) {
        const y = yearOf(f.name);
        const B = out.get(f.blk) || out.get(blocksOf(cid).slice(-1)[0]);
        B.items.push({ slug: f.slug, name: f.name, year: y, w: spineW(y), h: spineH(y), sub: f.sub, fr: f.fr, rank: lib.rank.get(f.slug) ?? 1e9 });
      }
      for (const bid of blocksOf(cid)) { const B = out.get(bid); B.total = footprint(B.items); if (!B.items.length) out.delete(bid); }
    });
    return out;
  }
  // A genre's plan (bays counted from the start of its region). Horror's plan
  // from before the room had genres lives in house.wall.
  function planOf(H, g) {
    const w = H.walls && H.walls[g];
    if (w && w.shelves) return w.shelves;
    if (g === STOCKED && H.wall && H.wall.shelves && Object.keys(H.wall.shelves).length) return H.wall.shelves;
    return null;
  }
  // Save a whole-room arrangement (in room bays, as the wall shows it) back
  // as one plan per genre region. Only the genres given are touched.
  function setPlan(H, shelves, only) {
    const perRow = wall.plan.perRow;
    H.walls = { ...(H.walls || {}) };
    const out = {};
    for (const R of wall.regions) if (!only || only.includes(R.genre)) out[R.genre] = {};
    for (const [k, list] of Object.entries(shelves)) {
      const [b, sh] = k.split(":").map(Number);
      const R = wall.regions.find((x) => b >= x.start && b < x.start + x.rows * perRow) || wall.regions[wall.regions.length - 1];
      if (!out[R.genre]) continue;
      out[R.genre][`${b - R.start}:${sh}`] = list;
    }
    for (const [g, sh] of Object.entries(out)) H.walls[g] = { shelves: sh };
    H.wall = { perRow }; // (the old single plan now lives in walls.horror)
  }
  // Old plans placed whole categories; turn each category piece into the
  // blocks it held, in order, so the wall looks exactly as it did.
  function migratePlan(shelves, blocks) {
    const isCat = (c) => lib.cats.has(c);
    if (!Object.values(shelves || {}).flat().some((pc) => pc && isCat(pc.c))) return shelves;
    const perRow = (house().wall && house().wall.perRow) || 1;
    const refs = [];
    for (const [key, list] of Object.entries(shelves)) list.forEach((pc, slot) => { const [bay, shelf] = key.split(":").map(Number); refs.push({ key, slot, bay, shelf, pc }); });
    refs.sort((a, b) => Math.floor(a.bay / perRow) - Math.floor(b.bay / perRow) || a.bay % perRow - (b.bay % perRow) || a.shelf - b.shelf || a.slot - b.slot);
    const queue = new Map(); // category -> its blocks' films, in order, with their block
    for (const B of blocks.values()) { const q = queue.get(B.cat) || queue.set(B.cat, []).get(B.cat); for (const it of B.items) q.push([B.id, it.w + 1]); }
    const pos = new Map();
    const out = {};
    for (const r of refs) {
      const list = out[r.key] || (out[r.key] = []);
      if (!isCat(r.pc.c)) { list.push(r.pc); continue; }
      const q = queue.get(r.pc.c) || [];
      let k = pos.get(r.pc.c) || 0, used = 0, cur = null;
      const parts = [];
      while (k < q.length && (!parts.length || used + q[k][1] <= r.pc.u)) {
        const [bid, w] = q[k++];
        if (!cur || cur.c !== bid) parts.push((cur = { c: bid, u: 0 }));
        cur.u += w; used += w;
      }
      pos.set(r.pc.c, k);
      if (!parts.length) continue;
      parts[parts.length - 1].u += Math.max(0, r.pc.u - used); // keep the piece's size
      list.push(...parts);
    }
    for (const k of Object.keys(out)) if (!out[k].length) delete out[k];
    return out;
  }
  const MIN_PIECE = 30; // the smallest space worth putting a section into
  const SQUEEZE_MAX = CAP * 0.12; // films over a block's space that may squeeze onto its shelf

  // The default arrangement: sections one after another, each starting
  // right where the last one ended, down each bay and then across.
  function autoArrange(stock_, perRow) {
    const shelves = {};
    let b = 0, s = 0, used = 0;
    const next = () => { used = 0; if (++s >= WU.shelves) { s = 0; b++; } };
    let genre = null;
    for (const P of stock_.values()) {
      // Each genre starts its own run of aisles (a fresh row of bays).
      if (genre && P.genre && P.genre !== genre && (b > 0 || s > 0 || used > 0)) { b = Math.ceil((b + (s || used ? 1 : 0)) / perRow) * perRow; s = 0; used = 0; }
      if (P.genre) genre = P.genre;
      let k = 0;
      while (k < P.items.length) {
        let free = CAP - used - (used ? BOOKEND : 0);
        if (free < Math.max(MIN_PIECE, P.items[k].w + 1)) { next(); free = CAP; }
        let u = 0;
        while (k < P.items.length && u + P.items[k].w + 1 <= free) u += P.items[k++].w + 1;
        (shelves[`${b}:${s}`] ||= []).push({ c: P.id, u });
        used += (used ? BOOKEND : 0) + u;
      }
    }
    return { perRow, shelves };
  }

  function buildLayout() {
    const sections = sectionStock();
    const H = house();
    // Bays per row (fixed once a plan exists, so the wall doesn't reflow while you edit).
    let perRow = H.wall && H.wall.perRow;
    const totalShelves = Math.ceil([...sections.values()].reduce((n, P) => n + P.total, 0) / (CAP * 0.92));
    if (!perRow) {
      const bays = Math.max(1, Math.ceil(totalShelves / WU.shelves));
      const c = wall.canvas;
      const aspect = c && c.clientHeight ? c.clientWidth / c.clientHeight : 1.4;
      let best = Infinity;
      for (let t = 1; t <= bays; t++) {
        const d = Math.abs(Math.log((t * (WU.bayW + WU.gap) + AISLE_W + AISLE_GAP) / (Math.ceil(bays / t) * ROW_H) / aspect));
        if (d < best) { best = d; perRow = t; }
      }
    }
    // The room is one region per genre, in genre order, each its own run of
    // whole rows of bays with its own plan (house.walls[genre], in bays
    // counted from the start of that region). A genre without a plan: viewers
    // get it arranged automatically; a moderator gets it empty, with its
    // blocks in the inventory. Pieces of folders that no longer exist are
    // left out, and plans from before blocks are converted.
    const valid = (x) => x && typeof x === "object" && sections.has(x.c) && x.u > 0;
    const genres = roomGenres();
    const regions = [];
    const shelvesAll = {};
    let rowAt = 0;
    for (const g of genres) {
      const own = new Map([...sections].filter(([, P]) => P.genre === g));
      let local = planOf(H, g);
      local = local ? migratePlan(local, sections) : edit.on ? {} : autoArrange(own, perRow).shelves;
      const extent = 1 + Math.max(-1, ...Object.keys(local).map((k) => +k.split(":")[0]));
      const rows = Math.max(1, Math.ceil((extent + (edit.on ? 1 : 0)) / perRow));
      regions.push({ genre: g, start: rowAt * perRow, rows, extent });
      for (const [k, list] of Object.entries(local)) { const [b, sh] = k.split(":").map(Number); shelvesAll[`${b + rowAt * perRow}:${sh}`] = list; }
      rowAt += rows;
    }
    const plan = { perRow, shelves: shelvesAll };
    wall.plan = { perRow, shelves: plan.shelves };
    wall.regions = regions;
    // Where each bay ends up once every genre's overflow has been given room.
    const regionAt = (b) => regions.find((r) => b >= r.start && b < r.start + r.rows * perRow) || regions[regions.length - 1];
    // Where each row of bays stands. Genres are packed into side-by-side runs
    // (set once the regions are final, below); until then rows simply stack.
    let rowPos = null;
    const origin = (b) => {
      const row = Math.floor(b / perRow), P = rowPos && (rowPos[row] || rowPos.extra(row));
      return P ? { x: P.x + (b % perRow) * (WU.bayW + WU.gap), y: P.y } : { x: (b % perRow) * (WU.bayW + WU.gap), y: row * ROW_H };
    };

    // Each placed piece: a section and an amount of shelf. ref = "bay:shelf/slot".
    const where = new Map(), refCid = new Map(), refU = new Map(), shelfList = new Map();
    for (const [key, list] of Object.entries(plan.shelves || {})) {
      const [bay, shelf] = key.split(":").map(Number);
      const keep = [];
      list.forEach((pc) => {
        if (!valid(pc)) return;
        const ref = `${key}/${keep.length}`;
        where.set(ref, { bay, shelf, slot: keep.length });
        refCid.set(ref, pc.c);
        refU.set(ref, pc.u);
        keep.push(ref);
      });
      if (keep.length) shelfList.set(key, keep);
    }
    // Reading order: bay row, bay, shelf (down first), then left to right.
    const readKey = (w) => [Math.floor(w.bay / perRow), w.bay % perRow, w.shelf, w.slot];
    const cmp = (a, b) => { const x = readKey(a), y = readKey(b); for (let i = 0; i < 4; i++) if (x[i] !== y[i]) return x[i] - y[i]; return 0; };

    // Pour each section's films through its pieces in reading order. What
    // doesn't fit stays in the workspace (viewers: it carries on after the
    // last bay used).
    const content = new Map();
    const leftovers = new Map();
    for (const P of sections.values()) {
      const refs = [...refCid].filter(([, c]) => c === P.id).map(([r]) => r).sort((a, b) => cmp(where.get(a), where.get(b)));
      let k = 0;
      for (const ref of refs) {
        const u = refU.get(ref), list = [];
        let acc = 0;
        while (k < P.items.length && (!list.length || acc + P.items[k].w + 1 <= u)) { acc += P.items[k].w + 1; list.push(P.items[k++]); }
        content.set(ref, list);
      }
      if (k < P.items.length) {
        // A few films over: squeeze them onto the block's last piece. More than
        // that: they wait in the inventory (viewers: after the last bay).
        const over = P.items.slice(k);
        if (refs.length && footprint(over) <= SQUEEZE_MAX) content.get(refs[refs.length - 1]).push(...over);
        else leftovers.set(P.id, over);
      }
    }
    // Viewers: a new block with no shelf of its own sits with its siblings
    // (on the last piece of its category, squeezed in) until a moderator places it.
    if (!edit.on) {
      for (const [bid, items] of [...leftovers]) {
        if (footprint(items) > SQUEEZE_MAX) continue;
        const cat = sections.get(bid).cat;
        const sib = [...refCid].filter(([, c]) => sections.has(c) && sections.get(c).cat === cat).map(([r]) => r).sort((a, b) => cmp(where.get(a), where.get(b)));
        if (!sib.length) continue;
        content.get(sib[sib.length - 1]).push(...items);
        leftovers.delete(bid);
      }
    }
    const bucket = [];
    if (edit.on) {
      for (const [bid, list] of leftovers) bucket.push({ sec: bid, cat: sections.get(bid).cat, n: sections.get(bid).n, size: footprint(list), count: list.length, whole: list.length === sections.get(bid).items.length });
    } else if (leftovers.size) {
      // Each genre's overflow carries on after its own plan, inside its own
      // region; regions after it move down to make room.
      const extra = new Map(); // genre -> rows added
      const placed = [];
      for (const R of regions) {
        const mine_ = [...leftovers].filter(([cid]) => sections.get(cid).genre === R.genre);
        if (!mine_.length) continue;
        const rest = autoArrange(new Map(mine_.map(([cid, items]) => [cid, { id: cid, items, genre: R.genre }])), perRow).shelves;
        const used = 1 + Math.max(-1, ...[...where.values()].filter((w) => regionAt(w.bay) === R).map((w) => w.bay - R.start));
        const startLocal = used > 0 ? used : 0;
        const need = 1 + Math.max(...Object.keys(rest).map((k) => +k.split(":")[0]));
        const rows = Math.ceil((startLocal + need) / perRow);
        extra.set(R.genre, Math.max(0, rows - R.rows));
        placed.push([R, rest, startLocal]);
      }
      // shift: final start of each region
      let shift = 0;
      for (const R of regions) { R.final = R.start + shift * perRow; shift += extra.get(R.genre) || 0; R.rows += extra.get(R.genre) || 0; }
      const moveBay = (b) => { const R = regions.find((x) => b >= x.start && b < x.start + (x.rows - (extra.get(x.genre) || 0)) * perRow) || regions[regions.length - 1]; return b - R.start + R.final; };
      for (const w of where.values()) w.bay = moveBay(w.bay);
      // (into a fresh map: a moved key can land on one not yet moved)
      const movedList = [...shelfList].map(([k, refs]) => { const [b, sh] = k.split(":").map(Number); return [`${moveBay(b)}:${sh}`, refs]; });
      shelfList.clear();
      for (const [k, refs] of movedList) shelfList.set(k, refs);
      for (const R of regions) R.start = R.final;
      const fed = new Map([...leftovers].map(([cid]) => [cid, 0]));
      for (const [R, rest, startLocal] of placed) for (const [key, list] of Object.entries(rest)) {
        const [b0, sh] = key.split(":").map(Number);
        const nk = `${b0 + startLocal + R.start}:${sh}`;
        const keep = [];
        for (const pc of list) {
          const ref = `L${nk}/${keep.length}`; // (L: overflow, never clashes with a plan's refs)
          where.set(ref, { bay: b0 + startLocal + R.start, shelf: sh, slot: keep.length });
          refCid.set(ref, pc.c);
          const items = leftovers.get(pc.c);
          let k = fed.get(pc.c), acc = 0;
          const out = [];
          while (k < items.length && (!out.length || acc + items[k].w + 1 <= pc.u)) { acc += items[k].w + 1; out.push(items[k++]); }
          fed.set(pc.c, k);
          content.set(ref, out);
          keep.push(ref);
        }
        shelfList.set(nk, keep);
      }
    }
    // The room's floor plan: each genre's rows stay together, genres run top
    // to bottom and then on to the next run to the right, with the number of
    // runs chosen so the room roughly matches the window's shape.
    const RUN_W = perRow * (WU.bayW + WU.gap) + AISLE_W + AISLE_GAP + RUN_GAP;
    let roomW = perRow * (WU.bayW + WU.gap), roomH = 0;
    {
      const lastBay = Math.max(0, ...[...shelfList.keys()].map((k) => +k.split(":")[0]));
      const blocks = regions.map((R) => ({ r0: R.start / perRow, n: R.rows }));
      const T = Math.max(Math.ceil((lastBay + 1) / perRow), ...blocks.map((B) => B.r0 + B.n));
      if (blocks.length) blocks[blocks.length - 1].n = T - blocks[blocks.length - 1].r0;
      const pack = (target) => {
        const cols = [];
        for (const B of blocks) {
          const c = cols[cols.length - 1];
          if (c && c.h + B.n <= target) { c.items.push(B); c.h += B.n; }
          else cols.push({ items: [B], h: B.n });
        }
        return cols;
      };
      const c = wall.canvas;
      const aspect = c && c.clientHeight ? c.clientWidth / c.clientHeight : 1.4;
      let best = null;
      const total = blocks.reduce((n, B) => n + B.n, 0);
      for (let k = 1; k <= Math.max(1, blocks.length); k++) {
        const cols = pack(Math.ceil(total / k));
        const h = Math.max(...cols.map((cl) => cl.h * ROW_H + (cl.items.length - 1) * GENRE_GAP));
        const w = cols.length * RUN_W - RUN_GAP;
        const d = Math.abs(Math.log(w / h / aspect));
        if (!best || d < best.d) best = { d, cols };
      }
      if (best && blocks.length > 1) {
        rowPos = [];
        best.cols.forEach((cl, ci) => {
          let y = 0;
          for (const B of cl.items) {
            for (let i = 0; i < B.n; i++) rowPos[B.r0 + i] = { x: ci * RUN_W, y: y + i * ROW_H };
            y += B.n * ROW_H + GENRE_GAP;
          }
          roomH = Math.max(roomH, y - GENRE_GAP);
        });
        roomW = (best.cols.length - 1) * RUN_W + perRow * (WU.bayW + WU.gap);
        const last = rowPos.length - 1, L0 = rowPos[last];
        rowPos.extra = (row) => ({ x: L0.x, y: L0.y + (row - last) * ROW_H });
      }
    }

    const parseRef = (ref) => [sections.get(refCid.get(ref)).cat, refCid.get(ref)];
    wall.refs = { refCid, refU };
    wall.leftovers = leftovers;

    const films = [], chunks = new Map(), secs = [], secIndex = new Map(), runs = [], bookends = [], idx = new Map();
    for (const P of sections.values()) {
      if (secIndex.has(P.cat)) continue;
      secIndex.set(P.cat, secs.length);
      secs.push({ id: P.cat, name: lib.cats.get(P.cat).name, hue: secHue(P.n), films: [], subs: [] });
    }
    let maxBay = 0;
    for (const [key, refs] of shelfList) {
      const [bay, shelf] = key.split(":").map(Number);
      maxBay = Math.max(maxBay, bay);
      const o = origin(bay);
      const x0 = o.x + WU.pad, y = o.y + WU.sign + (shelf + 1) * WU.shelfH - WU.lip;
      const lists = refs.map((r) => content.get(r) || []);
      const used = lists.reduce((n, l) => n + footprint(l), 0) + BOOKEND * (refs.length - 1);
      const squeeze = used > CAP ? CAP / used : 1;
      const slack = used >= CAP * JUSTIFY && used < CAP ? CAP - used : 0;
      if (!chunks.has(key)) chunks.set(key, []);
      let x = x0;
      refs.forEach((ref, ri) => {
        const si = secIndex.get(parseRef(ref)[0]);
        const list = lists[ri];
        const start = x;
        // This piece's share of the slack, as a few leaning groups.
        const share = slack ? (slack * footprint(list)) / Math.max(1, used - BOOKEND * (refs.length - 1)) : 0;
        const groups = share > 2 ? Math.max(1, Math.ceil(share / LEAN_EACH)) : 0;
        const per = groups ? share / groups : 0;
        const leanAt = new Map(); // index of a group's first leaning film -> angle
        let leftover = 0;
        if (groups && list.length) {
          for (let g = 0; g < groups; g++) {
            let end = Math.round(((g + 1) * list.length) / groups);
            while (end > 0 && list[end - 1].fr != null) end--; // franchises always stand
            let m = Math.min(6, Math.max(1, end - Math.round((g * list.length) / groups)));
            while (m > 0 && list.slice(end - m, end).some((x) => x.fr != null)) m--;
            if (m < 1 || end < 1) { leftover += per; continue; }
            const grp = list.slice(end - m, end);
            const reach = leanReach(grp, MAX_LEAN);
            const a = solveLean(grp, Math.min(per, reach));
            leftover += Math.max(0, per - reach);
            for (let j = end - m; j < end; j++) leanAt.set(j, { a, first: j === end - m });
          }
        }
        const standing = list.length - leanAt.size;
        const air = standing > 0 ? Math.min(3, leftover / standing) : 0;
        list.forEach((it, j) => {
          const L = leanAt.get(j);
          if (L && L.first) x += it.h * Math.sin(L.a);
          const f = { ...it, sec: si, bay, shelf, x, y, lean: L ? L.a : 0 };
          x += L ? (f.w / Math.cos(L.a) + 1) * squeeze : (f.w + 1 + air) * squeeze;
          chunks.get(key).push(films.length);
          secs[si].films.push(films.length);
          idx.set(f.slug, films.length);
          films.push(f);
        });
        // Where each subsection starts and ends along this piece (for its tags).
        const parts = [];
        for (let j = films.length - list.length; j < films.length; j++) {
          const f = films[j], last = parts[parts.length - 1];
          if (last && last.sub === f.sub) last.x1 = f.x + f.w;
          else parts.push({ sub: f.sub, x0: f.x, x1: f.x + f.w });
        }
        runs.push({ ref, sec: si, blk: parseRef(ref)[1], bay, shelf, x0: start, x1: Math.max(start + 8, x), by: o.y, parts });
        if (ri < refs.length - 1) {
          const next = secIndex.get(parseRef(refs[ri + 1])[0]);
          bookends.push({ x: x + 3, y, bay, change: next !== si, next, hue: secs[next].hue });
          x += BOOKEND * squeeze;
        }
      });
    }
    for (const sec of secs) sec.highlights = [...sec.films].sort((a, b) => films[a].rank - films[b].rank).slice(0, 3);
    // The hanging signs: each section's stretch of each bay, left to right.
    const hangAt = new Map();
    for (const r of runs) {
      const k = `${r.bay}:${r.sec}`;
      const hg = hangAt.get(k);
      if (hg) { hg.x0 = Math.min(hg.x0, r.x0); hg.x1 = Math.max(hg.x1, r.x1); }
      else hangAt.set(k, { bay: r.bay, sec: r.sec, x0: r.x0, x1: r.x1 });
    }
    const hang = [];
    {
      // Over each bay hang the categories on it: up to four stacked on one tall
      // board, more boards if there are more. Boards share the bay's width in
      // proportion to how much shelf their categories have there (in reading
      // order), then get nudged apart so none overlap.
      const mctx = (buildLayout.m ||= document.createElement("canvas").getContext("2d"));
      const perBay = new Map();
      for (const hg of hangAt.values()) {
        hg.amount = runs.filter((r) => r.bay === hg.bay && r.sec === hg.sec).reduce((n, r) => n + (r.x1 - r.x0), 0);
        hg.first = Math.min(...runs.filter((r) => r.bay === hg.bay && r.sec === hg.sec).map((r) => r.shelf * 1e5 + r.x0));
        (perBay.get(hg.bay) || perBay.set(hg.bay, []).get(hg.bay)).push(hg);
      }
      const GAPS = 16, EDGE = 8;
      for (const [b, all] of perBay) {
        all.sort((a, c) => a.first - c.first);
        const boards = [];
        for (let i = 0; i < all.length; i += 4) {
          const part = all.slice(i, i + 4);
          const k = part.length;
          const fs = Math.min(58, ((HANG_H - 34) / k) * 0.62);
          mctx.font = `800 ${fs}px "Helvetica Neue", Arial, sans-serif`;
          const tw = Math.max(...part.map((hg) => mctx.measureText(secs[hg.sec].name.toUpperCase()).width));
          boards.push({ bay: b, secs: part.map((hg) => hg.sec), amount: part.reduce((n, hg) => n + hg.amount, 0), fs, w: Math.min(WU.bayW - 2 * EDGE, Math.max(220, tw + 84)) });
        }
        const o = origin(b), total = boards.reduce((n, bd) => n + bd.amount, 0) || 1;
        let at = o.x;
        for (const bd of boards) { const seg = (WU.bayW * bd.amount) / total; bd.sx = at + seg / 2 - bd.w / 2; at += seg; }
        const need = boards.reduce((n, bd) => n + bd.w, 0) + GAPS * (boards.length - 1);
        if (need > WU.bayW - 2 * EDGE) { const k = (WU.bayW - 2 * EDGE - GAPS * (boards.length - 1)) / (need - GAPS * (boards.length - 1)); boards.forEach((bd) => (bd.w *= k)); }
        for (let i = 0; i < boards.length; i++) boards[i].sx = Math.max(i ? boards[i - 1].sx + boards[i - 1].w + GAPS : o.x + EDGE, boards[i].sx);
        for (let i = boards.length - 1; i >= 0; i--) boards[i].sx = Math.min(i < boards.length - 1 ? boards[i + 1].sx - GAPS - boards[i].w : o.x + WU.bayW - EDGE - boards[i].w, boards[i].sx);
        hang.push(...boards);
      }
    }
    // Franchise stickers: one per unbroken run of a franchise on a shelf.
    const frList = Object.values(allFranchises());
    const frIds = Object.keys(allFranchises());
    const stickers = [];
    for (const list of chunks.values()) {
      let run = null;
      for (const i of list) {
        const f = films[i];
        if (f.fr != null && run && run.fr === f.fr) { run.x1 = f.x + f.w; run.h = Math.max(run.h, f.h); continue; }
        if (run) stickers.push(run);
        const fo = frList[f.fr];
        run = f.fr != null && fo ? { fr: f.fr, id: frIds[f.fr], x0: f.x, x1: f.x + f.w, y: f.y, h: f.h, bay: f.bay, shelf: f.shelf, lead: fo.films[0][0], name: fo.name, color: fo.color, logo: fo.logo } : null;
      }
      if (run) stickers.push(run);
    }
    // Edit mode keeps an empty bay at the end to drop pieces into.
    const roomBays = regions.reduce((n, R) => n + R.rows * perRow, 0);
    const bays = edit.on ? Math.max(maxBay + 1, roomBays) : maxBay + 1;
    let width = rowPos ? roomW : Math.min(bays, perRow) * (WU.bayW + WU.gap);
    let height = rowPos ? Math.max(roomH, ...Array.from({ length: Math.ceil(bays / perRow) }, (_, r) => origin(r * perRow).y + ROW_H)) : Math.ceil(bays / perRow) * ROW_H;
    // The uncategorized films: a pile on the floor in the far corner.
    const unc = (lib.inSub.get(UNCAT_SUB) || []).length;
    let pile = null;
    if (unc) {
      pile = { x: width + PILE_GAP, y: Math.max(0, height - PILE_H), w: PILE_W, h: PILE_H, n: unc };
      width = pile.x + PILE_W;
      height = Math.max(height, PILE_H);
    }
    // Each row of bays is an aisle; its sign names the categories along it.
    const aisles = [];
    for (const r of [...runs].sort((a, c) => a.bay - c.bay || a.shelf - c.shelf || a.x0 - c.x0)) {
      const row = Math.floor(r.bay / perRow);
      const a = aisles[row] || (aisles[row] = { row, x: origin(row * perRow).x, y: origin(row * perRow).y, secs: [], genre: lib.cats.get(secs[r.sec].id).genre });
      if (!a.secs.includes(r.sec)) a.secs.push(r.sec);
    }
    // Aisles are numbered within their genre.
    { const seen = new Map(); for (const a of aisles.filter(Boolean)) { const n = (seen.get(a.genre) || 0) + 1; seen.set(a.genre, n); a.num = n; } }
    wall.bayCache.clear(); // (each cached bay points at its layout: keep only this one)
    wall.lay = { films, chunks, secs, runs, bookends, stickers, hang, aisles: aisles.filter(Boolean), left: -AISLE_W - AISLE_GAP, faces: [], idx, bucket, held: H.held, width, height, bays, k: perRow, origin, rowPos, pile };
    recolourSections();
    renderTray();
  }

  // Screen <-> wall coordinates.
  const toWall = (sx, sy) => ({ x: wall.cam.x + sx / wall.cam.z, y: wall.cam.y + sy / wall.cam.z });

  function fit() {
    const c = wall.canvas;
    if (!c || !wall.lay) return;
    const L = wall.lay, span = L.width - (L.left || 0);
    const z = Math.min(c.clientWidth / span, c.clientHeight / L.height) * 0.96;
    wall.cam.z = Math.max(ZMIN, z);
    wall.cam.x = (L.left || 0) - (c.clientWidth / wall.cam.z - span) / 2;
    wall.cam.y = -(c.clientHeight / wall.cam.z - wall.lay.height) / 2;
    drawSoon();
  }

  function clampCam() {
    const c = wall.canvas, L = wall.lay, cam = wall.cam;
    const vw = c.clientWidth / cam.z, vh = c.clientHeight / cam.z;
    const mx = Math.max(200, vw * 0.25), my = 120;
    const left = L.left || 0, span = L.width - left;
    cam.x = vw > span ? left - (vw - span) / 2 : Math.min(Math.max(cam.x, left - mx), L.width - vw + mx);
    cam.y = vh > L.height ? -(vh - L.height) / 2 : Math.min(Math.max(cam.y, -my), L.height - vh + my);
  }

  function zoomAt(factor, sx, sy) {
    const before = toWall(sx, sy);
    wall.cam.z = Math.min(ZMAX, Math.max(ZMIN, wall.cam.z * factor));
    wall.cam.x = before.x - sx / wall.cam.z;
    wall.cam.y = before.y - sy / wall.cam.z;
    drawSoon();
  }

  // Glide the camera to a wall point at a zoom (instant with reduced motion).
  function flyTo(x, y, z) {
    const c = wall.canvas, cam = wall.cam;
    const target = { z, x: x - c.clientWidth / 2 / z, y: y - c.clientHeight / 2 / z };
    if (reduceMotion || wall.lite) { Object.assign(cam, target); return drawSoon(); }
    const from = { ...cam }, t0 = performance.now(), dur = 420;
    const step = (t) => {
      const k = Math.min(1, (t - t0) / dur), e = 1 - Math.pow(1 - k, 3);
      cam.z = Math.exp(Math.log(from.z) + (Math.log(target.z) - Math.log(from.z)) * e);
      cam.x = from.x + (target.x - from.x) * e;
      cam.y = from.y + (target.y - from.y) * e;
      draw();
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  // Fly to a section or shelf picked on the right.
  function flyToFolder(id) {
    if (!wall.lay || wall.level !== "wall") return;
    const p = partsOf(id);
    if (!inRoom(p.genre)) return fit();
    if (!p.cat) { const g = wall.lay.secs.find((x) => lib.cats.get(x.id).genre === p.genre); const f = g && wall.lay.films[g.films[0]]; return f ? flyTo(f.x + 300, f.y - 120, 0.12) : fit(); }
    const L = wall.lay;
    const i = p.niche ? L.films.findIndex((f) => f.sub === p.niche) : p.sub ? L.films.findIndex((f) => f.sub === p.sub || (lib.subs.get(f.sub) || {}).parent === p.sub) : L.secs.find((s) => s.id === p.cat)?.films[0];
    if (i == null || i < 0) return;
    const f = L.films[i];
    flyTo(f.x + 300, f.y - 120, p.sub ? 0.9 : 0.25);
  }

  /* Colour catalogue: each film's main + accent colour, read from its poster.
   * Built a few films at a time while the store is open and kept in this
   * browser ("RRGGBBrrggbb" per film). Later this can be seeded from a shared
   * file so nobody has to build it themselves. */
  const COLOR_KEY = `${NS}:store:colors:v1`;
  // A film's colours: your own pick if you made one, else the poster's.
  const colorOf = (slug) => {
    const pick = (mine.colors && mine.colors[slug]) || shared.color[slug];
    return pick ? pick + ((colors[slug] || "").slice(6) || pick) : colors[slug];
  };
  const colors = readJSON(COLOR_KEY, {});
  const colorJob = { running: false, done: 0, total: 0 };
  let colorSaveTimer = 0;
  const hex = (r, g, b) => [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
  const rgbOf = (h6) => [0, 2, 4].map((i) => parseInt(h6.slice(i, i + 2), 16));
  const lum = ([r, g, b]) => (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;

  // Dominant colour, not the average (averages turn most posters to mud).
  function measure(img) {
    const c = document.createElement("canvas");
    c.width = 16; c.height = 24;
    const x = c.getContext("2d", { willReadFrequently: true });
    x.drawImage(img, 0, 0, 16, 24);
    const d = x.getImageData(0, 0, 16, 24).data;
    const bins = new Map();
    for (let i = 0; i < d.length; i += 4) {
      const k = ((d[i] >> 4) << 8) | ((d[i + 1] >> 4) << 4) | (d[i + 2] >> 4);
      const b = bins.get(k) || [0, 0, 0, 0];
      b[0]++; b[1] += d[i]; b[2] += d[i + 1]; b[3] += d[i + 2];
      bins.set(k, b);
    }
    const cands = [...bins.values()].map(([n, r, g, b]) => {
      const rgb = [r / n, g / n, b / n];
      const mx = Math.max(...rgb) / 255, mn = Math.min(...rgb) / 255, l = (mx + mn) / 2;
      const sat = mx === mn ? 0 : (mx - mn) / (1 - Math.abs(2 * l - 1));
      return { n, rgb, score: n * (0.25 + sat) * (l < 0.07 || l > 0.93 ? 0.15 : 1) };
    }).sort((a, b) => b.score - a.score);
    const main = cands[0].rgb;
    const far = (c) => Math.hypot(c.rgb[0] - main[0], c.rgb[1] - main[1], c.rgb[2] - main[2]) > 70;
    const accent = (cands.find(far) || { rgb: main.map((v) => (lum(main) > 0.5 ? v * 0.5 : v + (255 - v) * 0.5)) }).rgb;
    return hex(...main) + hex(...accent);
  }

  function colorOne(slug) {
    return posterFor(slug).then(([url]) => new Promise((ok) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.onload = () => { try { colors[slug] = measure(im); paintVer++; } catch {} ok(); };
      im.onerror = () => ok();
      im.src = url;
    })).catch(() => {});
  }

  // Colours are read from posters, so only for films you can see: the bays
  // in view, once the camera settles. (A prebuilt colour file will replace this.)
  let colorWait = null;
  const colorTried = new Set(); // (posters that failed aren't retried this visit)
  function colorView(bays) {
    if (colorJob.running || !wall.lay) return;
    clearTimeout(colorWait);
    colorWait = setTimeout(() => {
      const L = wall.lay, want = [];
      for (const b of bays) for (let s = 0; s < WU.shelves; s++) for (const i of L.chunks.get(`${b}:${s}`) || []) if (!colors[L.films[i].slug] && !colorTried.has(L.films[i].slug)) want.push(L.films[i].slug);
      if (want.length) runColorJob(want);
    }, 700);
  }
  async function runColorJob(want) {
    if (colorJob.running || !stock || !want) return;
    colorJob.running = true;
    const todo = want.filter((s) => !colors[s]);
    todo.forEach((s) => colorTried.add(s));
    colorJob.total = todo.length;
    colorJob.done = 0;
    const lane = limiter(4); // gentle on Letterboxd
    let n = 0;
    await Promise.all(todo.map((slug) => lane(async () => {
      if (!root || root.hidden) return; // store closed: stop, resume next visit
      await colorOne(slug);
      colorJob.done++;
      if (++n % 25 === 0) {
        if (wall.lay) recolourSections();
        drawSoon();
        clearTimeout(colorSaveTimer);
        colorSaveTimer = setTimeout(() => writeJSON(COLOR_KEY, colors), 400);
      }
    })));
    writeJSON(COLOR_KEY, colors);
    colorJob.running = false;
    colorJob.total = 0;
    if (wall.lay) recolourSections();
    drawSoon();
  }

  // A section's far-away colour = the average of its films' colours.
  function recolourSections() {
    for (const sec of wall.lay.secs) {
      let r = 0, g = 0, b = 0, n = 0;
      for (const i of sec.films) {
        const c = colors[wall.lay.films[i].slug];
        if (!c) continue;
        const [cr, cg, cb] = rgbOf(c);
        r += cr; g += cg; b += cb; n++;
      }
      sec.avg = n >= 15 ? `rgb(${r / n | 0},${g / n | 0},${b / n | 0})` : null;
    }
  }

  /* ---------------- title logos (TMDB) ----------------
   * Each film's title art comes from TMDB's "logos": the first English one,
   * else the original-language one, else any. A one-off build job (run by the
   * developer, with their own TMDB key, which never leaves their browser)
   * matches every film to TMDB and writes a small index:
   *   films: { slug: [tmdbId, "logo1.png", "logo2.svg", ...] }   (0 = no match)
   * The index is a static file; viewers' browsers load the images straight
   * from image.tmdb.org and never talk to the TMDB API.
   * Right-click a spine to pick a different logo (your pick is kept here and
   * becomes a vote once community voting exists). */
  const DEV_TOOLS = true; // dev: logo builder on (release builds set this false)
  const LOGO_KEY = `${NS}:store:logos:v1`;
  const LOGO_PICK_KEY = `${NS}:store:logo-picks:v1`;
  const SUGGEST_KEY = `${NS}:store:suggest:v1`;
  const TMDB_KEY = `${NS}:dev:tmdb`; // the developer's own key, this browser only
  // Published indexes: the first Horror run, then the whole catalogue.
  const LOGO_FILES = ["horror-logos.json", "logos.json"].map((f) => `https://raw.githubusercontent.com/if-iferror/letterbloxd/dev/data/${f}`);
  const LOGO_DB_KEY = "logos:v1";
  const TMDB_IMG = "https://image.tmdb.org/t/p/";
  const LOGO_Z = 0.7; // logos appear from this zoom in
  // Your own build, kept in IndexedDB (localStorage is too small for the
  // whole catalogue). An older build in localStorage is moved over once.
  let logoIndex = readJSON(LOGO_KEY, null) || { v: 1, films: {} };
  const logoReady = Promise.resolve().then(async () => { // (after the rest of this file has run)
    try {
      const saved = await idbGet(LOGO_DB_KEY);
      if (saved && saved.films) logoIndex = { ...saved, films: { ...logoIndex.films, ...saved.films } };
      if (localStorage.getItem(LOGO_KEY)) { await idbPut(LOGO_DB_KEY, logoIndex); localStorage.removeItem(LOGO_KEY); }
    } catch {}
    drawSoon();
  });
  let logoShared = null; // the published index, once fetched
  let logoSharedReady = Promise.resolve();
  // A film the build has already looked at (here, or in a published index).
  const logoKnown = (slug) => !!(logoIndex.films[slug] || (logoShared && logoShared[slug]));
  const logoPicks = readJSON(LOGO_PICK_KEY, {});
  const logoLoad = limiter(10);
  const logoJob = { running: false, done: 0, total: 0, found: 0, error: "" };

  const logoEntry = (slug) => logoIndex.films[slug] || (logoShared && logoShared[slug]) || null;
  // The logo on a film's spine: your pick (a TMDB path), "plain" (-1), or the index's first.
  function logoPath(slug) {
    const pick = slug in logoPicks ? logoPicks[slug] : shared.logo[slug];
    if (pick === -1) return null;
    if (typeof pick === "string" && pick) return pick;
    const e = logoEntry(slug);
    if (!e || e.length < 2) return null;
    return e[1 + (pick > 0 && pick < e.length - 1 ? pick : 0)];
  }
  // Every logo TMDB has for a film, fetched when you open Edit (not stored).
  const logoLists = new Map();
  function allLogos(slug) {
    const e = logoEntry(slug);
    if (!e || !e[0]) return Promise.resolve(e && e[1] ? [e[1]] : []);
    if (!logoLists.has(slug)) {
      logoLists.set(slug, ext("logos", { id: e[0] }).then((list) => (list && list.length ? list : e.slice(1))).catch(() => e.slice(1)));
    }
    return logoLists.get(slug);
  }

  function loadSharedLogos() {
    if (logoShared) return logoSharedReady;
    logoShared = {};
    return (logoSharedReady = Promise.all(LOGO_FILES.map((u) => fetch(u, { cache: "no-cache" }).then((r) => (r.ok ? r.json() : null)).catch(() => null)))
      .then((js) => {
        const films = Object.assign({}, ...js.map((j) => (j && j.films) || {}));
        if (Object.keys(films).length) { logoShared = films; drawSoon(); renderStagePath(); }
      }));
  }

  // Linear-light luminance, for contrast against the spine.
  const relLum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const contrast = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

  // A logo image, ready to draw, or null (and it starts loading).
  // Kept in wall.logos: key -> { img, ok, lum, ink: { colour: canvas } }
  function logoImg(slug, size) {
    const path = logoPath(slug);
    if (!path) return null;
    return logoImgPath(path, size);
  }
  function logoImgPath(path, size) {
    const key = `${size}/${path}`;
    let L = wall.logos.get(key);
    if (L) return L.ok ? L : null;
    L = { ok: false, lum: 0.5, ink: {} };
    wall.logos.set(key, L);
    if (wall.logos.size > 1600) [...wall.logos.keys()].slice(0, 400).forEach((k) => wall.logos.delete(k));
    logoLoad(() => new Promise((done) => {
      const im = new Image();
      im.crossOrigin = "anonymous";
      im.decoding = "async";
      im.onload = () => {
        if (!im.naturalWidth) im.width = 300; // a few SVGs have no size
        L.img = im;
        L.ok = true;
        try {
          const c = document.createElement("canvas");
          c.width = 48; c.height = 16;
          const x = c.getContext("2d", { willReadFrequently: true });
          x.drawImage(im, 0, 0, 48, 16);
          const d = x.getImageData(0, 0, 48, 16).data;
          let s = 0, n = 0;
          for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 128) { s += relLum([d[i], d[i + 1], d[i + 2]]); n++; }
          if (n) L.lum = s / n;
        } catch {}
        drawSoon();
        done();
      };
      im.onerror = () => { wall.logos.set(key, { ok: false, dead: true }); done(); };
      im.src = TMDB_IMG + size + "/" + path;
    }));
    return null;
  }

  // The logo as a flat silhouette in one colour, for logos that would vanish
  // into their spine (black logo on a black box, and so on).
  function logoInk(L, colour) {
    if (L.ink[colour]) return L.ink[colour];
    const w = L.img.naturalWidth || 300, h = L.img.naturalHeight || 100;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const x = c.getContext("2d");
    x.drawImage(L.img, 0, 0, w, h);
    x.globalCompositeOperation = "source-in";
    x.fillStyle = colour;
    x.fillRect(0, 0, w, h);
    return (L.ink[colour] = c);
  }

  /* Build job (developer only). Matches each film to TMDB:
   *   1. search by title + year; one exact title match within a year: done
   *   2. otherwise ask Letterboxd which film each candidate is
   *      (HEAD /tmdb/<id>/ redirects to the film's page, no page download)
   *   3. then fetch that film's logos */
  async function runLogoJob(key) {
    if (logoJob.running || !stock) return;
    logoJob.running = true;
    logoJob.error = "";
    await logoReady;
    await loadSharedLogos();
    const bearer = key.length > 40;
    const api = async (path, params, tries = 0) => {
      const u = new URL(`https://api.themoviedb.org/3/${path}`);
      for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
      if (!bearer) u.searchParams.set("api_key", key);
      const r = await fetch(u, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
      if (r.status === 401) throw new Error("TMDB didn't accept that key.");
      if (r.status === 429 && tries < 5) { await new Promise((ok) => setTimeout(ok, 1500 * (tries + 1))); return api(path, params, tries + 1); }
      if (!r.ok) throw new Error(`TMDB ${r.status}`);
      return r.json();
    };
    const norm = (s) => String(s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
    const yr = (c) => +String(c.release_date || "").slice(0, 4) || 0;
    const isOurs = async (id, slug) => {
      try {
        const r = await fetch(`/tmdb/${id}/`, { method: "HEAD", credentials: "include" });
        return r.ok && new URL(r.url).pathname.startsWith(`/film/${slug}/`);
      } catch { return false; }
    };
    const verify = limiter(3); // gentle on Letterboxd

    async function match(slug, name) {
      const t = titleOf(name), y = yearOf(name), nt = norm(t);
      let res = (await api("search/movie", { query: t, year: y || "", include_adult: "true" })).results || [];
      const exact = res.filter((c) => (norm(c.title) === nt || norm(c.original_title) === nt) && (!y || Math.abs(yr(c) - y) <= 1));
      if (exact.length === 1) return exact[0];
      if (!res.length) res = (await api("search/movie", { query: t, include_adult: "true" })).results || [];
      const order = [...exact, ...res.filter((c) => !exact.includes(c))].slice(0, 4);
      for (const c of order) if (await verify(() => isOurs(c.id, slug))) return c;
      return null;
    }

    const lane = limiter(6);
    const todo = stock.films.filter(([slug]) => !logoKnown(slug));
    logoJob.total = stock.films.length;
    logoJob.done = logoJob.total - todo.length;
    logoJob.found = stock.films.filter(([slug]) => { const e = logoEntry(slug); return e && e.length > 1; }).length;
    let n = 0;
    const save = () => { logoIndex.at = Date.now(); idbPut(LOGO_DB_KEY, logoIndex).catch(() => {}); };
    try {
      await Promise.all(todo.map(([slug, name]) => lane(async () => {
        if (!logoJob.running) return;
        try {
          const c = await match(slug, name);
          if (!c) { logoIndex.films[slug] = [0]; }
          else {
            const lang = c.original_language || "en";
            const im = await api(`movie/${c.id}/images`, { include_image_language: `en,${lang},null` });
            const logos = im.logos || [];
            const rank = (l) => (l.iso_639_1 === "en" ? 0 : l.iso_639_1 === lang ? 1 : l.iso_639_1 == null ? 2 : 3);
            // Stable sort keeps TMDB's own order inside each language.
            const paths = logos.map((l, i) => [rank(l), i, l.file_path]).sort((a, b) => a[0] - b[0] || a[1] - b[1]).slice(0, 4).map((l) => l[2].replace(/^\//, ""));
            logoIndex.films[slug] = [c.id, ...paths];
            if (paths.length) logoJob.found++;
          }
        } catch (err) {
          if (/key/.test(err.message)) { logoJob.error = err.message; logoJob.running = false; }
          return; // try this one again next run
        }
        logoJob.done++;
        if (++n % 40 === 0) { save(); renderStagePath(); renderLogoBuild(); drawSoon(); }
      })));
    } finally {
      save();
      logoJob.running = false;
      renderStagePath();
      renderLogoBuild();
      drawSoon();
    }
  }

  function renderLogoBuild() {
    const box = $(".lbs-logobuild", root);
    if (!box || box.hidden) return;
    const have = !!readJSON(TMDB_KEY, "");
    const pct = logoJob.done ? Math.round((logoJob.found / logoJob.done) * 100) : 0;
    const counted = stock ? stock.films.filter(([slug]) => logoKnown(slug)).length : 0;
    if (!logoJob.running && stock) logoJob.found = stock.films.filter(([slug]) => { const e = logoEntry(slug); return e && e.length > 1; }).length;
    box.innerHTML =
      `<b>Title logos from TMDB</b>` +
      `<p>Matches every film in the store to TMDB and keeps its logos. Takes a few hours for the whole catalogue; it can be paused and continued. Your TMDB key stays in this browser; it's only used for this.</p>` +
      (have ? "" : `<label>TMDB API key or read token<input type="password" class="lbs-tmdb-key" autocomplete="off" spellcheck="false"></label>`) +
      (logoJob.error ? `<p class="-err">${esc(logoJob.error)}</p>` : "") +
      `<p>${fmt(logoJob.done || counted)} / ${fmt(logoJob.total || (stock ? stock.films.length : 0))} checked · ${fmt(logoJob.found)} with a logo${logoJob.done ? ` (${pct}%)` : ""}</p>` +
      `<div class="lbs-logobuild-row">` +
      (logoJob.running ? `<button type="button" data-act="logo-stop">Pause</button>` : `<button type="button" data-act="logo-start" class="-go">${counted ? "Continue" : "Start"}</button>`) +
      (counted ? `<button type="button" data-act="logo-save">Download index</button>` : "") +
      (have ? `<button type="button" data-act="logo-forget">Forget key</button>` : "") +
      `<button type="button" data-act="logo-close">Close</button></div>`;
  }

  function downloadLogos() {
    // Everything known: the published indexes plus this browser's build.
    const films = Object.fromEntries(Object.entries({ ...(logoShared || {}), ...logoIndex.films }).filter(([, e]) => e[0]).sort());
    const blob = new Blob([JSON.stringify({ v: 1, at: new Date().toISOString().slice(0, 10), source: "TMDB", films })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "logos.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------------- the catalogue builder (developer only) ----------------
   * Reads every popular film once, with its genres, countries, languages and
   * Letterboxd themes, and saves it as one file (data/catalogue.json) that the
   * store then loads instead of scraping. Steps:
   *   1. cutoff  find how far down Letterboxd's popularity list films still
   *              have about MIN_WATCHES watches (popularity isn't watch count,
   *              so this samples pages and takes the median)
   *   2. films   every film above that point, in popularity order
   *   3. themes  which themes exist: read the Genres tab of a sample of films
   *   4. lists   every genre, country, language and theme list, read down to
   *              the cutoff, keeping which of our films are in it
   * Progress is saved in this browser (IndexedDB), so it can be paused,
   * closed and continued. */
  const CAT_DB = `${NS}-store`;
  const CAT_KEY = "catalogue-job:v1";
  const CAT_SAMPLE = 1500; // most film pages read to find themes
  const catJob = { running: false, st: null, msg: "", error: "", started: 0, reqs: 0 };
  const catLane = limiter(4); // gentle: four requests at a time

  function idb(mode, fn) {
    return new Promise((ok, fail) => {
      const open = indexedDB.open(CAT_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore("kv");
      open.onerror = () => fail(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction("kv", mode);
        const req = fn(tx.objectStore("kv"));
        tx.oncomplete = () => { db.close(); ok(req && req.result); };
        tx.onerror = () => { db.close(); fail(tx.error); };
      };
    });
  }
  const idbGet = (k) => idb("readonly", (s) => s.get(k));
  const idbPut = (k, v) => idb("readwrite", (s) => s.put(v, k));
  const idbDel = (k) => idb("readwrite", (s) => s.delete(k));

  // A Letterboxd page, politely: four at a time, backing off when told to.
  async function lbGet(url) {
    for (let tries = 0; ; tries++) {
      if (!catJob.running) throw new Error("paused");
      const r = await catLane(() => fetch(url, { credentials: "include" }));
      catJob.reqs++;
      if (r.ok || r.status === 404) return r.ok ? r.text() : "";
      if (tries >= 6) throw new Error(`Letterboxd answered ${r.status}`);
      const wait = r.status === 429 || r.status >= 500 ? 5000 * 2 ** tries : 1500;
      catJob.msg = `Letterboxd asked us to slow down; waiting ${Math.round(wait / 1000)}s`;
      renderCatBuild();
      await new Promise((ok) => setTimeout(ok, wait));
    }
  }
  const parse = (html) => new DOMParser().parseFromString(html, "text/html");
  // A film page's theme links, reading only as far as they go (the themes sit
  // about a third of the way into a ~300 KB page).
  async function filmThemes(slug) {
    for (let tries = 0; ; tries++) {
      if (!catJob.running) throw new Error("paused");
      const r = await catLane(() => fetch(`/film/${slug}/`, { credentials: "include" }));
      catJob.reqs++;
      if (r.status === 404) return [];
      if (!r.ok) {
        if (tries >= 6) throw new Error(`Letterboxd answered ${r.status}`);
        await new Promise((ok) => setTimeout(ok, 5000 * 2 ** tries));
        continue;
      }
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += dec.decode(value, { stream: true });
        const last = Math.max(text.lastIndexOf("/films/theme/"), text.lastIndexOf("/films/mini-theme/"));
        if ((last > 0 && text.length - last > 4000) || text.length > 140000) { reader.cancel().catch(() => {}); break; }
      }
      return [...text.matchAll(/href="\/films\/((?:mini-)?theme\/[a-z0-9-]+)\/[^"]*"[^>]*>([^<]+)</g)].map((m) => [m[1], m[2]]);
    }
  }
  async function catPage(path, page) {
    const html = await lbGet(`/csi/films/films-browser-list/${path ? path + "/" : ""}by/popular/${page > 1 ? `page/${page}/` : ""}?esiAllowFilters=false`);
    return [...parse(html).querySelectorAll("[data-item-slug]")].map((el) => {
      const li = el.closest("li") || el;
      const r = li.querySelector("[data-average-rating]") || (li.dataset.averageRating ? li : null);
      let lid = "";
      try { lid = JSON.parse(el.dataset.posteredIdentifier || "{}").lid || ""; } catch {}
      return { slug: el.dataset.itemSlug, name: el.dataset.itemFullDisplayName || el.dataset.itemName || el.dataset.itemSlug, rating: r ? Math.round(+r.dataset.averageRating * 100) || 0 : 0, lid };
    });
  }
  async function catWatches(slug) {
    const a = parse(await lbGet(`/csi/film/${slug}/stats/`)).querySelector('[title^="Watched by"]');
    return a ? +a.getAttribute("title").replace(/\D/g, "") : 0;
  }

  const catBlank = () => ({ v: 1, themeV: 2, phase: "cutoff", min: 1000, lo: 300, hi: 3000, probes: {}, cutPage: 0, page: 0, films: [], lists: {}, sampled: 0, quiet: 0, names: {} });

  async function catSave() { catJob.st.at = Date.now(); await idbPut(CAT_KEY, catJob.st); }

  async function runCatJob() {
    if (catJob.running) return;
    catJob.running = true;
    catJob.error = "";
    catJob.started = Date.now();
    catJob.reqs = 0;
    renderCatBuild();
    try {
      if (!catJob.st) catJob.st = (await idbGet(CAT_KEY)) || catBlank();
      const st = catJob.st;
      // Lists the store needs are always read, found on a film page or not.
      const seed = () => { for (const k of neededLists()) if (!st.lists[k]) st.lists[k] = { name: k.split("/")[1].replace(/-/g, " "), ids: null }; };
      if (st.themeV !== 2 && (st.phase === "lists" || st.phase === "done")) { st.sampled = 0; st.quiet = 0; st.phase = "themes"; }
      if (st.phase === "done") { seed(); if (Object.values(st.lists).some((l) => !l.ids)) st.phase = "lists"; else if (!st.lists["type/short"] || !st.lists["type/tv"]) st.phase = "types"; }
      const tick = () => { catJob.msg = ""; renderCatBuild(); };
      const readTypes = async () => {
          const index = new Map(st.films.map((f, i) => [f[0], i]));
          for (const [kind, key, name] of [["shorts", "type/short", "Short"], ["tv", "type/tv", "TV"]]) {
            if (st.lists[key] && st.lists[key].ids) continue;
            const ids = [];
            // (your own browse filters live in this cookie: put them back after)
            const was = (document.cookie.match(/(?:^|;\s*)filmFilter=([^;]*)/) || [])[1];
            document.cookie = `filmFilter=show-${kind}; path=/`;
            try {
              for (let p = 1; p <= 2000; p++) {
                const t = await lbGet(`/csi/films/films-browser-list/by/popular/${p > 1 ? `page/${p}/` : ""}?esiAllowFilters=true`);
                const list = [...parse(t).querySelectorAll("[data-item-slug]")].map((el) => el.dataset.itemSlug);
                const hits = list.map((x) => index.get(x)).filter((i) => i != null);
                ids.push(...hits);
                if (!hits.length || list.length < PER_PAGE) break;
              }
            } finally { document.cookie = was ? `filmFilter=${was}; path=/; max-age=31536000` : "filmFilter=; path=/; max-age=0"; }
            st.lists[key] = { name, ids: [...new Set(ids)].sort((a, b) => a - b) };
            await catSave();
            tick();
          }
      };

      // 1. The cutoff: the last page whose sampled films have a median of MIN watches.
      if (st.phase === "cutoff") {
        while (st.hi - st.lo > 8) {
          const mid = Math.round((st.lo + st.hi) / 2);
          const list = await catPage("", mid);
          const pick = [0, 9, 18, 27, 36, 45, 54, 63, 71].map((i) => list[i]).filter(Boolean);
          const w = (await Promise.all(pick.map((f) => catWatches(f.slug)))).sort((a, b) => a - b);
          const median = w[w.length >> 1] || 0;
          st.probes[mid] = median;
          if (median >= st.min) st.lo = mid; else st.hi = mid;
          await catSave();
          tick();
        }
        st.cutPage = st.lo;
        st.phase = "films";
        await catSave();
      }

      // 2. Every film down to the cutoff, in popularity order.
      if (st.phase === "films") {
        const seen = new Set(st.films.map((f) => f[0]));
        while (st.page < st.cutPage) {
          const from = st.page + 1, to = Math.min(st.cutPage, st.page + 20);
          const pages = await Promise.all(Array.from({ length: to - from + 1 }, (_, i) => catPage("", from + i)));
          for (const f of pages.flat()) if (!seen.has(f.slug)) { seen.add(f.slug); st.films.push([f.slug, f.name, f.rating]); }
          st.page = to;
          await catSave();
          tick();
        }
        st.phase = "themes";
        await catSave();
      }

      // 3. Which lists exist: genres, countries and languages are listed by
      //    Letterboxd; themes are found on a spread-out sample of film pages.
      if (st.phase === "themes") {
        for (const [id, name] of GENRES) if (!st.lists[`genre/${id}`]) st.lists[`genre/${id}`] = { name, ids: null };
        if (!Object.keys(st.lists).some((k) => k.startsWith("country/"))) {
          const doc = parse(await lbGet("/countries/"));
          for (const a of doc.querySelectorAll('a[href^="/films/country/"], a[href^="/films/language/"]')) {
            const m = a.getAttribute("href").match(/^\/films\/(country|language)\/([a-z0-9-]+)\/$/);
            const name = (a.querySelector(".name") || a).textContent.replace(/[\d,]+\s*$/, "").trim();
            if (m && name && !st.lists[`${m[1]}/${m[2]}`]) st.lists[`${m[1]}/${m[2]}`] = { name, ids: null };
          }
          await catSave();
        }
        // Themes belong to well-watched films, so read the top films closely
        // and the rest sparsely. Stop once 400 films with themes in a row
        // turn up nothing new.
        const N = st.films.length;
        const order = [];
        for (let i = 0; i < Math.min(N, 4000); i += 2) order.push(i);
        for (let i = 4000; i < N; i += Math.max(1, Math.floor((N - 4000) / 1200))) order.push(i);
        while (st.sampled < order.length && !(st.sampled >= 600 && st.quiet >= 400)) {
          const batch = order.slice(st.sampled, st.sampled + 8);
          const found = await Promise.all(batch.map((i) => filmThemes(st.films[i][0])));
          for (const links of found) {
            if (!links.length) continue;
            let fresh = false;
            for (const [key, name] of links) {
              if (st.lists[key]) continue;
              st.lists[key] = { name: parse(name).body.textContent.trim(), ids: null };
              fresh = true;
            }
            st.quiet = fresh ? 0 : st.quiet + 1;
          }
          st.sampled += batch.length;
          await catSave();
          tick();
        }
        st.themeV = 2;
        seed();
        st.phase = "lists";
        await catSave();
      }

      // 4. Each list, read down to the cutoff. A list is in popularity order,
      //    so the first page with none of our films ends it.
      if (st.phase === "lists") {
        const index = new Map(st.films.map((f, i) => [f[0], i]));
        const todo = Object.keys(st.lists).filter((k) => !st.lists[k].ids);
        let since = 0;
        await Promise.all(todo.map((key) => (async () => {
          // Page 1, then three pages at a time (big lists like Drama run to hundreds of pages).
          const ids = [];
          outer: for (let p = 1; p <= 2000; p += p === 1 ? 1 : 3) {
            const pages = await Promise.all((p === 1 ? [1] : [p, p + 1, p + 2]).map((n) => catPage(key, n)));
            for (const list of pages) {
              const hits = list.map((f) => index.get(f.slug)).filter((i) => i != null);
              ids.push(...hits);
              if (!hits.length || list.length < PER_PAGE) break outer;
            }
          }
          st.lists[key].ids = [...new Set(ids)].sort((a, b) => a - b);
          if (++since % 10 === 0) await catSave();
          tick();
        })()));
        st.phase = "types";
        await catSave();
      }

      // 4b. Shorts and TV, by Letterboxd's own marks: its "show only shorts"
      //     and "show only TV" browse filters (a cookie, so one at a time).
      if (st.phase === "types") {
        await readTypes();
        st.phase = "done";
        await catSave();
      }

      // 5 (optional, "Film details"). Each film's Letterboxd ID (from the
      //    popularity pages again), then its details from Letterboxd's own
      //    API: runtime, primary and original language, directors.
      if (st.phase === "lids") {
        const index = new Map(st.films.map((f, i) => [f[0], i]));
        st.info = st.info || new Array(st.films.length).fill(null);
        st.lidPage = st.lidPage || 0;
        while (st.lidPage < st.cutPage) {
          const from = st.lidPage + 1, to = Math.min(st.cutPage, st.lidPage + 20);
          const pages = await Promise.all(Array.from({ length: to - from + 1 }, (_, i) => catPage("", from + i)));
          for (const f of pages.flat()) { const i = index.get(f.slug); if (i != null && f.lid && !st.info[i]) st.info[i] = [f.lid]; }
          st.lidPage = to;
          await catSave();
          tick();
        }
        st.phase = "details";
        await catSave();
      }
      if (st.phase === "details") {
        st.langNames = st.langNames || {};
        const todo = [];
        st.info.forEach((x, i) => { if (x && x.length === 1) todo.push(i); });
        let n = 0;
        await Promise.all(todo.map((i) => (async () => {
          const lid = st.info[i][0];
          const txt = await lbGet(`/api/v0/production/${encodeURIComponent(lid)}`);
          let j = null;
          try { j = txt ? JSON.parse(txt) : null; } catch {}
          const pl = j && j.primaryLanguage, ol = j && j.originalLanguage;
          if (pl && pl.code) st.langNames[pl.code] = pl.name;
          if (ol && ol.code) st.langNames[ol.code] = ol.name;
          st.info[i] = [lid, (j && j.runTime) || 0, (pl && pl.code) || "", (ol && ol.code) || "", ((j && j.directors) || []).map((d) => d.name).filter(Boolean), j && j.type && j.type !== "Film" ? j.type : 0];
          if (++n % 200 === 0) { await catSave(); tick(); }
        })()));
        st.phase = "origin";
        await catSave();
      }
      // 6 (with film details). Country of origin, from TMDB (where a film
      //    comes from, not every country that helped make it). Uses the TMDB
      //    match the logo builder made and your TMDB key; films without a
      //    match are worked out in the store from their countries and language.
      if (st.phase === "origin") {
        const key = readJSON(TMDB_KEY, "");
        await logoReady; await loadSharedLogos();
        st.origin = st.origin || {};
        const todo = [];
        st.films.forEach(([slug], i) => { const e = logoEntry(slug); if (e && e[0] && !(i in st.origin)) todo.push([i, e[0]]); });
        if (key && todo.length) {
          const bearer = key.length > 40, lane = limiter(8);
          let n = 0;
          await Promise.all(todo.map(([i, tid]) => lane(async () => {
            if (!catJob.running) throw new Error("paused");
            for (let tries = 0; tries < 5; tries++) {
              const u = new URL(`https://api.themoviedb.org/3/movie/${tid}`);
              if (!bearer) u.searchParams.set("api_key", key);
              const r = await fetch(u, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
              if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500 * (tries + 1))); continue; }
              if (r.status === 401) throw new Error("TMDB didn't accept your key (Logo builder › Forget key, then paste it again).");
              const j = r.ok ? await r.json() : null;
              st.origin[i] = (j && j.origin_country) || [];
              break;
            }
            if (++n % 300 === 0) { catJob.msg = `Country of origin: ${fmt(Object.keys(st.origin).length)} / ${fmt(todo.length + Object.keys(st.origin).length - n)}`; await catSave(); tick(); }
          })));
        } else if (!key) catJob.msg = "No TMDB key here, so country of origin is worked out from countries and language instead.";
        if (!st.lists["type/short"] || !st.lists["type/tv"]) await readTypes();
        st.phase = "done";
        await catSave();
      }
      // 8 (on request). The films the Logo builder never matched: find each
      //    on TMDB (title + year; Letterboxd settles close calls), then read
      //    its country of origin and keywords in the same request.
      if (st.phase === "deep") {
        const key = readJSON(TMDB_KEY, "");
        if (!key) throw new Error("This step uses TMDB: paste your TMDB key in the Logo builder first.");
        await logoReady; await loadSharedLogos();
        st.tmdb = st.tmdb || {}; st.kw = st.kw || {}; st.kwNames = st.kwNames || {}; st.origin = st.origin || {};
        const bearer = key.length > 40, lane = limiter(8), verify = limiter(3);
        const api = async (path, params, tries = 0) => {
          if (!catJob.running) throw new Error("paused");
          const u = new URL(`https://api.themoviedb.org/3/${path}`);
          for (const [k, v] of Object.entries(params || {})) u.searchParams.set(k, v);
          if (!bearer) u.searchParams.set("api_key", key);
          const r = await fetch(u, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
          catJob.reqs++;
          if (r.status === 401) throw new Error("TMDB didn't accept your key (Logo builder › Forget key, then paste it again).");
          if (r.status === 429 && tries < 6) { await new Promise((ok) => setTimeout(ok, 1500 * (tries + 1))); return api(path, params, tries + 1); }
          return r.ok ? r.json() : null;
        };
        const norm = (x) => String(x || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/&/g, "and").replace(/[^a-z0-9]+/g, "");
        const yr = (c) => +String(c.release_date || "").slice(0, 4) || 0;
        const isOurs = async (id, slug) => {
          try { const r = await fetch(`/tmdb/${id}/`, { method: "HEAD", credentials: "include" }); return r.ok && new URL(r.url).pathname.startsWith(`/film/${slug}/`); } catch { return false; }
        };
        const todo = [];
        st.films.forEach(([slug], i) => { const e = logoEntry(slug); if (!(e && e[0]) && !(i in st.tmdb)) todo.push(i); });
        let n = 0, found = Object.values(st.tmdb).filter(Boolean).length;
        await Promise.all(todo.map((i) => lane(async () => {
          const [slug, name] = st.films[i];
          const t = titleOf(name), y = yearOf(name), nt = norm(t);
          let res = ((await api("search/movie", { query: t, year: y || "", include_adult: "true" })) || {}).results || [];
          const exact = res.filter((c) => (norm(c.title) === nt || norm(c.original_title) === nt) && (!y || Math.abs(yr(c) - y) <= 1));
          let id = exact.length === 1 ? exact[0].id : 0;
          if (!id) {
            if (!res.length && y) res = ((await api("search/movie", { query: t, include_adult: "true" })) || {}).results || [];
            const order = [...exact, ...res.filter((c) => !exact.includes(c))].slice(0, 3);
            for (const c of order) if (await verify(() => isOurs(c.id, slug))) { id = c.id; break; }
          }
          if (id) {
            const j = await api(`movie/${id}`, { append_to_response: "keywords" });
            if (j) {
              st.origin[i] = j.origin_country || [];
              const ks = (j.keywords && j.keywords.keywords) || [];
              for (const k of ks) st.kwNames[k.id] = k.name;
              st.kw[i] = ks.map((k) => k.id);
              found++;
            }
          }
          st.tmdb[i] = id;
          if (++n % 300 === 0) { catJob.msg = `Finding the rest on TMDB: ${fmt(n)} / ${fmt(todo.length)} · ${fmt(found)} found`; await catSave(); tick(); }
        })));
        st.phase = "done";
        await catSave();
      }
      // 9 (on request). Film facts from TMDB for every film it knows: the
      //    companies that made it (for Studio), the top-billed cast (for
      //    search), the US age rating, plus country and keywords again.
      if (st.phase === "facts") {
        const key = readJSON(TMDB_KEY, "");
        if (!key) throw new Error("This step uses TMDB: paste your TMDB key in the Logo builder first.");
        await logoReady; await loadSharedLogos();
        st.fx = st.fx || {}; st.coNames = st.coNames || {}; st.castNames = st.castNames || {};
        st.kw = st.kw || {}; st.kwNames = st.kwNames || {}; st.origin = st.origin || {};
        const bearer = key.length > 40, lane = limiter(10);
        const todo = [];
        st.films.forEach(([slug], i) => {
          if (i in st.fx) return;
          const e = logoEntry(slug), id = (e && e[0]) || (st.tmdb && st.tmdb[i]);
          if (id) todo.push([i, id]);
        });
        let n = 0;
        await Promise.all(todo.map(([i, id]) => lane(async () => {
          if (!catJob.running) throw new Error("paused");
          for (let tries = 0; tries < 6; tries++) {
            const u = new URL(`https://api.themoviedb.org/3/movie/${id}`);
            u.searchParams.set("append_to_response", "credits,release_dates,keywords");
            if (!bearer) u.searchParams.set("api_key", key);
            const r = await fetch(u, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
            catJob.reqs++;
            if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500 * (tries + 1))); continue; }
            if (r.status === 401) throw new Error("TMDB didn't accept your key (Logo builder › Forget key, then paste it again).");
            const j = r.ok ? await r.json() : null;
            if (!j) { st.fx[i] = 0; break; }
            const co = (j.production_companies || []).map((c) => { st.coNames[c.id] = c.name; return c.id; });
            const cast = ((j.credits && j.credits.cast) || []).slice(0, 6).map((c) => { st.castNames[c.id] = c.name; return c.id; });
            let cert = "";
            const us = ((j.release_dates && j.release_dates.results) || []).find((x) => x.iso_3166_1 === "US");
            if (us) { const ds = us.release_dates || []; const pick = ds.find((d) => d.certification && d.type === 3) || ds.find((d) => d.certification); cert = pick ? pick.certification.trim() : ""; }
            st.fx[i] = [co, cast, cert];
            if (j.origin_country) st.origin[i] = j.origin_country;
            const ks = (j.keywords && j.keywords.keywords) || [];
            if (ks.length || !(i in st.kw)) { for (const k of ks) st.kwNames[k.id] = k.name; st.kw[i] = ks.map((k) => k.id); }
            break;
          }
          if (++n % 400 === 0) { catJob.msg = `Film facts from TMDB: ${fmt(n)} / ${fmt(todo.length)}`; await catSave(); tick(); }
        })));
        st.phase = "done";
        await catSave();
      }
      // 7 (on request). TMDB keywords for every film TMDB knows, the raw
      //    material for the store's Tags filter (LGBTQ+, Heist, Musical…).
      if (st.phase === "keywords") {
        const key = readJSON(TMDB_KEY, "");
        if (!key) throw new Error("Keywords come from TMDB: paste your TMDB key in the Logo builder first.");
        await logoReady; await loadSharedLogos();
        st.kw = st.kw || {}; st.kwNames = st.kwNames || {};
        const todo = [];
        st.films.forEach(([slug], i) => { const e = logoEntry(slug); if (e && e[0] && !(i in st.kw)) todo.push([i, e[0]]); });
        const bearer = key.length > 40, lane = limiter(10);
        let n = 0;
        await Promise.all(todo.map(([i, tid]) => lane(async () => {
          if (!catJob.running) throw new Error("paused");
          for (let tries = 0; tries < 5; tries++) {
            const u = new URL(`https://api.themoviedb.org/3/movie/${tid}/keywords`);
            if (!bearer) u.searchParams.set("api_key", key);
            const r = await fetch(u, bearer ? { headers: { Authorization: `Bearer ${key}` } } : {});
            catJob.reqs++;
            if (r.status === 429) { await new Promise((ok) => setTimeout(ok, 1500 * (tries + 1))); continue; }
            if (r.status === 401) throw new Error("TMDB didn't accept your key (Logo builder › Forget key, then paste it again).");
            const j = r.ok ? await r.json() : null;
            const ks = (j && j.keywords) || [];
            for (const k of ks) st.kwNames[k.id] = k.name;
            st.kw[i] = ks.map((k) => k.id);
            break;
          }
          if (++n % 400 === 0) { catJob.msg = `Keywords: ${fmt(n)} / ${fmt(todo.length)}`; await catSave(); tick(); }
        })));
        st.phase = "done";
        await catSave();
      }
    } catch (err) {
      if (err.message !== "paused") catJob.error = err.message;
      if (catJob.st) await catSave().catch(() => {});
    } finally {
      catJob.running = false;
      catJob.msg = "";
      renderCatBuild();
    }
  }

  function catProgress(st) {
    if (!st) return "Not started.";
    const lists = Object.values(st.lists);
    const done = lists.filter((l) => l.ids).length;
    if (st.phase === "cutoff") return `Finding the cutoff (${fmt(st.min)}+ watches)… ${Object.keys(st.probes).length} pages sampled`;
    if (st.phase === "films") return `Reading films: page ${fmt(st.page)} / ${fmt(st.cutPage)} · ${fmt(st.films.length)} films`;
    if (st.phase === "themes") return `Finding themes: ${fmt(st.sampled)} film pages read · ${fmt(Object.keys(st.lists).filter((k) => /theme\//.test(k)).length)} themes so far`;
    if (st.phase === "lists") return `Reading lists: ${fmt(done)} / ${fmt(lists.length)}`;
    if (st.phase === "types") return "Reading Letterboxd's Short and TV marks…";
    if (st.phase === "lids") return `Film details: matching IDs, page ${fmt(st.lidPage || 0)} / ${fmt(st.cutPage)}`;
    if (st.phase === "facts") return `Film facts from TMDB: ${fmt(Object.keys(st.fx || {}).length)} films so far`;
    if (st.phase === "deep") return `Finding the rest on TMDB: ${fmt(Object.keys(st.tmdb || {}).length)} looked up · ${fmt(Object.values(st.tmdb || {}).filter(Boolean).length)} found`;
    if (st.phase === "keywords") return `TMDB keywords: ${fmt(Object.keys(st.kw || {}).length)} films so far`;
    if (st.phase === "origin") return `Country of origin from TMDB: ${fmt(Object.keys(st.origin || {}).length)} films so far`;
    if (st.phase === "details") { const got = (st.info || []).filter((x) => x && x.length > 1).length; return `Film details: ${fmt(got)} / ${fmt((st.info || []).filter(Boolean).length)} read`; }
    return `Done: ${fmt(st.films.length)} films · ${fmt(lists.length)} lists${st.info ? ` · details for ${fmt(st.info.filter((x) => x && x.length > 1).length)}` : ""}${st.kw ? ` · keywords for ${fmt(Object.keys(st.kw).length)}` : ""}`;
  }

  function renderCatBuild() {
    const box = $(".lbs-catbuild", root);
    if (!box || box.hidden) return;
    const st = catJob.st;
    const mins = catJob.running ? Math.round((Date.now() - catJob.started) / 60000) : 0;
    box.innerHTML =
      `<b>Catalogue builder</b>` +
      `<p>Reads every popular film with its genres, countries, languages and themes, then downloads <code>catalogue.json</code> for the repo. Takes about an hour; keep this tab open. You can pause and continue later.</p>` +
      `<p>${esc(catProgress(st))}</p>` +
      (st && st.cutPage ? `<p>Cutoff: page ${fmt(st.cutPage)} (about ${fmt(st.cutPage * PER_PAGE)} films)</p>` : "") +
      (catJob.running ? `<p>${fmt(catJob.reqs)} requests in ${mins} min${catJob.msg ? ` · ${esc(catJob.msg)}` : ""}</p>` : "") +
      (catJob.error ? `<p class="-err">${esc(catJob.error)}</p>` : "") +
      `<div class="lbs-logobuild-row">` +
      (catJob.running ? `<button type="button" data-act="cat-stop">Pause</button>` : st && st.phase === "done" && neededLists().every((k) => st.lists[k]) ? "" : `<button type="button" data-act="cat-start" class="-go">${st && (st.films.length || Object.keys(st.probes).length) ? "Continue" : "Start"}</button>`) +
      (st && st.phase === "done" ? `<button type="button" data-act="cat-save" class="-go">Download catalogue</button><button type="button" data-act="cat-try">Try it here</button>` + (catJob.running ? "" : `<button type="button" data-act="cat-details" title="Runtime, primary language and directors for every film (about an hour)">${st.info ? "Re-read film details" : "Read film details"}</button><button type="button" data-act="cat-keywords" title="TMDB keywords for every film, for the Tags filter (about an hour; needs your TMDB key)">${st.kw ? "Finish TMDB keywords" : "Read TMDB keywords"}</button><button type="button" data-act="cat-deep" title="Find the films the Logo builder never matched on TMDB, with their keywords and country (about two hours)">${st.tmdb ? "Finish finding the rest on TMDB" : "Find the rest on TMDB"}</button><button type="button" data-act="cat-facts" title="Studios, top-billed cast and US age rating for every film TMDB knows (run after Find the rest; about 1–2 hours)">${st.fx ? "Finish film facts from TMDB" : "Film facts from TMDB"}</button>`) : "") +
      (!BUILD_TAB ? `<p class="lbs-menu-note">Long runs: <a href="/films/#store-builder" target="_blank" rel="noopener">open the builder in its own tab</a> and keep sorting here. That tab never saves your shelves.</p>` : `<p class="lbs-menu-note">Builder tab: your shelves are read-only here, so sort in your other tab.</p>`) +
      (!catJob.running && st ? `<button type="button" data-act="cat-reset">Start over</button>` : "") +
      `<button type="button" data-act="cat-close">Close</button></div>`;
  }

  // The file: films in popularity order, [slug, "Title (Year)", rating x100];
  // each list as its name and the gaps between its films' places (small numbers).
  function catalogueJSON() {
    const st = catJob.st;
    const lists = {};
    for (const [k, l] of Object.entries(st.lists)) {
      if (!l.ids || !l.ids.length) continue;
      let prev = -1;
      lists[k] = [l.name, l.ids.map((i) => { const d = i - prev; prev = i; return d; })];
    }
    const out = { v: 1, at: new Date().toISOString().slice(0, 10), min: st.min, cutPage: st.cutPage, films: st.films, lists };
    if (st.info && st.info.some((x) => x && x.length > 1)) {
      // [lid, runtime, primary language, original language, [director index], type]
      const people = [], at = new Map();
      const pid = (n) => { if (!at.has(n)) { at.set(n, people.length); people.push(n); } return at.get(n); };
      const og = st.origin || {};
      out.info = st.info.map((x, i) => (x && x.length > 1 ? [x[0], x[1], x[2], x[3], (x[4] || []).map(pid), x[5] || 0, og[i] || 0] : x ? [x[0]] : 0));
      out.people = people;
      out.langNames = st.langNames || {};
    }
    if (st.fx) {
      // Companies (2+ films) and top-billed cast (2+ films): names once, and
      // each film's as indexes (fco / fcast; 0 for none); US age ratings.
      const table = (pick, names, min) => {
        const count = new Map();
        for (const x of Object.values(st.fx)) if (x) for (const id of pick(x)) count.set(id, (count.get(id) || 0) + 1);
        const keep = [...count].filter(([, c]) => c >= min).sort((a, b) => b[1] - a[1]).map(([id]) => id);
        const at = new Map(keep.map((id, n) => [id, n]));
        return { names: keep.map((id) => names[id] || String(id)), per: st.films.map((f, i) => { const x = st.fx[i]; const ids = x ? pick(x).filter((id) => at.has(id)).map((id) => at.get(id)) : []; return ids.length ? ids : 0; }) };
      };
      const co = table((x) => x[0], st.coNames, 2), cast = table((x) => x[1], st.castNames, 2);
      out.co = co.names; out.fco = co.per;
      out.cast = cast.names; out.fcast = cast.per;
      const certs = [];
      out.fcert = st.films.map((f, i) => { const c = st.fx[i] && st.fx[i][2]; if (!c) return 0; let k = certs.indexOf(c); if (k < 0) { certs.push(c); k = certs.length - 1; } return k + 1; });
      out.certs = certs;
    }
    if (st.kw) {
      // TMDB keywords used by 3+ films: their names once (kw), and each
      // film's as indexes into that list (fkw; 0 when it has none).
      const count = new Map();
      for (const ids of Object.values(st.kw)) for (const id of ids) count.set(id, (count.get(id) || 0) + 1);
      const keep = [...count].filter(([, c]) => c >= 3).sort((a, b) => b[1] - a[1]).map(([id]) => id);
      const at = new Map(keep.map((id, n) => [id, n]));
      out.kw = keep.map((id) => st.kwNames[id] || String(id));
      out.fkw = st.films.map((f, i) => { const ids = (st.kw[i] || []).filter((id) => at.has(id)).map((id) => at.get(id)); return ids.length ? ids : 0; });
    }
    return out;
  }
  function downloadCatalogue() {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(catalogueJSON())], { type: "application/json" }));
    a.download = "catalogue.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  async function openCatBuild() {
    const b = $(".lbs-catbuild", root);
    b.hidden = !b.hidden;
    if (!catJob.st) catJob.st = (await idbGet(CAT_KEY).catch(() => null)) || null;
    renderCatBuild();
  }

  // Right-click a spine: the film's other TMDB logos, to pick from.
  function openLogoPicker(i, sx, sy) {
    const f = wall.lay.films[i];
    const e = logoEntry(f.slug);
    const box = $(".lbs-logopick", root);
    if (!box || !e || !e[0]) return false;
    const cur = logoPicks[f.slug] ?? 0;
    const bg = colors[f.slug] ? `#${colors[f.slug].slice(0, 6)}` : "#2c3440";
    box.innerHTML =
      `<b>${esc(titleOf(f.name))}: spine logo</b>` +
      `<div class="lbs-logopick-list">` +
      e.slice(1).map((p, n) => `<button type="button" data-act="logo-pick" data-slug="${esc(f.slug)}" data-n="${n}" class="${cur === n ? "-on" : ""}" style="background:${bg}"><img src="${TMDB_IMG}w185/${esc(p)}" alt="Logo ${n + 1}"></button>`).join("") +
      `<button type="button" data-act="logo-pick" data-slug="${esc(f.slug)}" data-n="-1" class="-plain${cur === -1 ? " -on" : ""}">Plain title</button>` +
      `</div>` +
      `<a href="https://www.themoviedb.org/movie/${e[0]}/images/logos" target="_blank" rel="noopener">${e.length > 1 ? "See every logo on TMDB ↗" : "No logo yet. Add one on TMDB ↗"}</a>`;
    box.hidden = false;
    const st = $(".lbs-stage", root).getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(sx, st.width - box.offsetWidth - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(sy, st.height - box.offsetHeight - 8))}px`;
    return true;
  }

  function pickLogo(slug, n) {
    if (n === 0 || n === "") delete logoPicks[slug];
    else logoPicks[slug] = n;
    writeJSON(LOGO_PICK_KEY, logoPicks);
    shareEdit("logo", slug, n === -1 ? "plain" : typeof n === "string" ? n : null);
    const e = logoEntry(slug);
    const list = readJSON(SUGGEST_KEY, []).filter((s) => !(s.type === "logo" && s.slug === slug));
    list.push({ type: "logo", slug, tmdb: e && e[0], path: n === -1 ? null : e && e[1 + n], at: Date.now() });
    writeJSON(SUGGEST_KEY, list.slice(-500));
    const lp = $(".lbs-logopick", root);
    if (lp) lp.hidden = true;
    drawSoon();
    toast(n === 0 ? "Back to the first logo." : "Saved. It'll count as your vote once community voting opens.");
  }

  // Wood grain: a 256x64 tile drawn once, then used as a pattern fill.
  let woodTile = null, woodFor = null, woodPat = null;
  function woodPattern(ctx) {
    if (woodPat && woodFor === ctx) return woodPat;
    if (!woodTile) {
      woodTile = document.createElement("canvas");
      woodTile.width = 256; woodTile.height = 64;
      const x = woodTile.getContext("2d");
      x.fillStyle = "#6e4b2e";
      x.fillRect(0, 0, 256, 64);
      let seed = 7;
      const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
      for (let i = 0; i < 46; i++) {
        const y0 = rnd() * 64, amp = 1 + rnd() * 3, f = 0.01 + rnd() * 0.03, ph = rnd() * 6;
        x.strokeStyle = rnd() < 0.5 ? `rgba(40,24,12,${0.18 + rnd() * 0.3})` : `rgba(200,150,100,${0.08 + rnd() * 0.12})`;
        x.lineWidth = 0.6 + rnd() * 1.4;
        x.beginPath();
        for (let px = 0; px <= 256; px += 8) { const yy = y0 + Math.sin(px * f * 6.283 + ph) * amp; px ? x.lineTo(px, yy) : x.moveTo(px, yy); }
        x.stroke();
      }
    }
    woodFor = ctx;
    return (woodPat = ctx.createPattern(woodTile, "repeat"));
  }

  function drawSoon() {
    if (wall.frame) return;
    wall.frame = requestAnimationFrame(() => { wall.frame = 0; draw(); });
  }

  function posterImg(slug) {
    let im = wall.imgs.get(slug);
    if (im) return im.complete && im.naturalWidth ? im : null;
    im = new Image();
    wall.imgs.set(slug, im);
    posterFor(slug).then(([one]) => { im.onload = drawSoon; corsSrc(im, one); }).catch(() => {});
    return null;
  }

  /* Film cans (1969 and earlier), standing on edge with the lid facing
   * right, seen a little from the side, like a can on an archive shelf: the
   * rim is a band with rounded ends (the edges of the two lids are tall thin
   * ellipses), the near lid shows as an ellipse with pressed rings and four
   * triangular windows onto the reel, and the title tape wraps round the rim,
   * so its art bends away at the top and bottom. Lit from the front left. */
  // (CAN_RX, CAN_T: see isCan.) Cans stand pressed together: the next can's
  // far edge sits right on this one's lid, so a can takes only its rim's width
  // and you only see the lid of the last can in a row.
  // The lid: an ellipse centred (cx, cy), radii (rx, ry): pressed steel with
  // a rolled edge, a ring of raised segments, and stepped rings to a hub;
  // optionally with a poster pasted in the middle.
  function canLid(ctx, cx, cy, rx, ry, poster) {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(rx, ry);
    const g = ctx.createLinearGradient(-1, -1, 1, 1);
    g.addColorStop(0, "#dfe3e6");
    g.addColorStop(0.5, "#b3b9be");
    g.addColorStop(1, "#7c838a");
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(0, 0, 1, 0, Math.PI * 2); ctx.fill();
    ctx.clip(); // nothing pressed into the lid may stray past its edge
    const unit = 1 / Math.max(1, Math.min(rx, ry));
    const lw = (w) => w / Math.max(rx, ry);
    // a pressed ridge: light on its upper-left side, shadow on its lower-right
    const ridge = (r, w, a0 = 0, a1 = Math.PI * 2) => {
      ctx.lineWidth = lw(w);
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.beginPath(); ctx.arc(-unit * 0.4, -unit * 0.4, r, a0, a1); ctx.stroke();
      ctx.strokeStyle = "rgba(30,34,38,0.45)";
      ctx.beginPath(); ctx.arc(unit * 0.4, unit * 0.4, r, a0, a1); ctx.stroke();
    };
    const big = Math.max(rx, ry);
    const w = Math.max(0.5, big * 0.012);
    ridge(0.94, w);
    // the ring of raised segments
    const n = 10, gap = 0.07;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2 + gap, a1 = ((i + 1) / n) * Math.PI * 2 - gap;
      ctx.fillStyle = i % 2 ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.05)";
      ctx.beginPath(); ctx.arc(0, 0, 0.88, a0, a1); ctx.arc(0, 0, 0.72, a1, a0, true); ctx.closePath(); ctx.fill();
      ridge(0.88, w * 0.8, a0, a1);
      ridge(0.72, w * 0.8, a0, a1);
    }
    for (const r of [0.66, 0.56]) ridge(r, w);
    if (poster) {
      // pasted on, corner to corner: as big as the lid allows
      const hw = 0.5547 * 0.985, hh = 0.8321 * 0.985;
      ctx.drawImage(poster, -hw, -hh, hw * 2, hh * 2);
      ctx.strokeStyle = "rgba(0,0,0,0.3)";
      ctx.lineWidth = lw(1);
      ctx.strokeRect(-hw, -hh, hw * 2, hh * 2);
    } else {
      for (const r of [0.42, 0.28]) ridge(r, w);
      ctx.fillStyle = "rgba(255,255,255,0.18)";
      ctx.beginPath(); ctx.arc(0, 0, 0.16, 0, Math.PI * 2); ctx.fill();
      ridge(0.16, w);
    }
    // the rolled edge
    ctx.strokeStyle = "rgba(20,22,25,0.5)";
    ctx.lineWidth = lw(Math.max(0.8, big * 0.02));
    ctx.beginPath(); ctx.arc(0, 0, 0.995, 0, Math.PI * 2); ctx.stroke();
    ctx.restore();
  }
  // The rim between the two lid edges (left edge at cxL, near lid at cxR).
  function canRimPath(ctx, cxL, cxR, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(cxL, cy, rx, ry, 0, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(cxR, cy + ry);
    ctx.ellipse(cxR, cy, rx, ry, 0, Math.PI / 2, -Math.PI / 2, false);
    ctx.closePath();
  }
  const canCurve = (ctx, top, bottom) => {
    const g = ctx.createLinearGradient(0, top, 0, bottom);
    g.addColorStop(0, "rgba(10,12,14,0.75)");
    g.addColorStop(0.16, "rgba(10,12,14,0.25)");
    g.addColorStop(0.36, "rgba(255,255,255,0.18)");
    g.addColorStop(0.5, "rgba(255,255,255,0.05)");
    g.addColorStop(0.8, "rgba(10,12,14,0.3)");
    g.addColorStop(1, "rgba(10,12,14,0.8)");
    return g;
  };
  // The tape's print (logo or title, and the year), unrolled flat; cached.
  const canLabels = new Map();
  function canLabel(f, tape, lg, k, len, wide) {
    const wash = (mine.wash && mine.wash[f.slug]) || shared.wash[f.slug] || "";
    const key = `${f.slug}|${k}|${tape}|${wash}|${lg ? lg.img.src : ""}|${mine.noDates ? 0 : 1}`;
    let cv = canLabels.get(key);
    if (cv) return cv;
    if (canLabels.size > 160) [...canLabels.keys()].slice(0, 60).forEach((x) => canLabels.delete(x));
    cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(wide * k));
    cv.height = Math.max(1, Math.round(len * k));
    const x = cv.getContext("2d");
    x.scale(k, k);
    const own = colorOf(f.slug);
    const light = own ? lum(rgbOf(own)) > 0.58 : lum(rgbOf(tape.replace("#", ""))) > 0.58;
    const yearRoom = mine.noDates ? 0 : len * 0.16;
    const span = len - yearRoom - len * 0.08;
    x.translate(wide / 2, 0);
    x.rotate(Math.PI / 2); // reads top to bottom, like the boxes
    x.textAlign = "center";
    x.textBaseline = "middle";
    const mid = len * 0.04 + span / 2;
    if (lg) {
      const iw = lg.img.naturalWidth || 300, ih = lg.img.naturalHeight || 100, a = iw / ih;
      let L = Math.min(span, (wide - 1.5) * a), T = L / a;
      if (T > wide - 1.5) { T = wide - 1.5; L = T * a; }
      x.drawImage(wash ? logoInk(lg, wash) : lg.img, mid - L / 2, -T / 2, L, T);
    } else {
      const t = titleOf(f.name).toUpperCase();
      const fs = Math.min(wide * 0.62, 10);
      x.font = `700 ${fs}px "Helvetica Neue", Arial, sans-serif`;
      x.fillStyle = wash || (light ? "rgba(10,12,14,0.9)" : "rgba(255,255,255,0.92)");
      x.fillText(t, mid, 0, span);
    }
    if (!mine.noDates) {
      x.font = `600 ${YEAR_FS}px Arial, sans-serif`;
      x.fillStyle = light ? "rgba(10,12,14,0.85)" : "rgba(255,255,255,0.9)";
      x.fillText(String(f.year || ""), len - yearRoom / 2 - len * 0.02, 0);
    }
    canLabels.set(key, cv);
    return cv;
  }
  // Everything on the rim follows one curve: the left half of the lid-edge
  // ellipse, slid along the rim. A band between two slid copies of it:
  function canBand(ctx, xa, xb, cy, rx, ry) {
    ctx.beginPath();
    ctx.ellipse(xa, cy, rx, ry, 0, -Math.PI / 2, Math.PI / 2, true);
    ctx.lineTo(xb, cy + ry);
    ctx.ellipse(xb, cy, rx, ry, 0, Math.PI / 2, -Math.PI / 2, false);
    ctx.closePath();
  }
  // A rolled lip: one narrow band shaded light (left, towards the light) to
  // dark (right), so it reads as a single rounded ridge.
  function canLip(ctx, x0, w, cy, rx, ry, tones) {
    const n = tones.length, step = w / n;
    for (let i = 0; i < n; i++) {
      ctx.fillStyle = tones[i];
      canBand(ctx, x0 + i * step - 0.05, x0 + (i + 1) * step + 0.05, cy, rx, ry);
      ctx.fill();
    }
  }
  const LIP_TONES = ["#eef1f3", "#cfd4d8", "#a9afb4", "#80878d", "#5d646a"];
  function drawCan(ctx, f, top, tape, z) {
    const rx = CAN_RX, ry = f.h / 2, cy = top + ry;
    const cxL = f.x + rx, cxR = cxL + CAN_T;
    // the rim: brushed steel, showing between the lips and the tape
    ctx.fillStyle = "#a3a9ae";
    canRimPath(ctx, cxL, cxR, cy, rx, ry);
    ctx.fill();
    // the two rolled lips
    canLip(ctx, cxL, CAN_LIP, cy, rx, ry, LIP_TONES);
    canLip(ctx, cxR - CAN_LIP, CAN_LIP, cy, rx, ry, LIP_TONES);
    // the tape, wrapped round the rim between them, its print bent round the
    // curve in thin strips (more strips the closer you are)
    const off = CAN_LIP + CAN_GAP, wide = CAN_TAPE, A = 1.25, len = 2 * A * ry;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const N = Math.max(14, Math.min(72, Math.round((2 * ry * z * dpr) / 5)));
    const size = z >= 3.4 ? "w500" : z >= 1.6 ? "w300" : "w185";
    const lg = z >= LOGO_Z ? logoImg(f.slug, size) || (size !== "w185" ? logoImg(f.slug, "w185") : null) : null;
    const k = Math.min(8, 2 ** Math.ceil(Math.log2(Math.max(1, z * dpr))));
    const label = z >= TEXT ? canLabel(f, tape, lg, k, len, wide) : null;
    ctx.save();
    canBand(ctx, cxL + off, cxR - off, cy, rx, ry * 0.97);
    ctx.fillStyle = tape;
    ctx.fill();
    ctx.clip();
    if (label) {
      ctx.imageSmoothingEnabled = true;
      ctx.imageSmoothingQuality = "high";
      for (let i = 0; i < N; i++) {
        const t1 = -A + (2 * A * i) / N, t2 = -A + (2 * A * (i + 1)) / N, tm = (t1 + t2) / 2;
        const y1 = cy + ry * Math.sin(t1), y2 = cy + ry * Math.sin(t2);
        const x = cxL - rx * Math.cos(tm) + off;
        ctx.drawImage(label, 0, (label.height * i) / N, label.width, label.height / N, x - 0.3, y1, wide + 0.6, y2 - y1 + 0.25);
      }
    }
    // the channel: the left lip shades the tape's left edge a little (soft, not a line)
    for (const [d, a] of [[0, 0.22], [0.7, 0.12], [1.4, 0.05]]) {
      ctx.fillStyle = `rgba(0,0,0,${a})`;
      canBand(ctx, cxL + off + d, cxL + off + d + 0.7, cy, rx, ry);
      ctx.fill();
    }
    ctx.restore();
    // the curve: dark where it turns away top and bottom, a highlight above the middle
    ctx.save();
    canRimPath(ctx, cxL, cxR, cy, rx, ry);
    ctx.clip();
    ctx.fillStyle = canCurve(ctx, top, f.y);
    ctx.fillRect(f.x - 1, top, CAN_T + 2 * rx + 2, f.h);
    ctx.restore();
    // the near lid, in shade (it faces right, away from the light). The next
    // can along covers it; where it does, one soft crease marks the join.
    canLid(ctx, cxR, cy, rx, ry, null);
    ctx.fillStyle = "rgba(12,14,17,0.42)";
    ctx.beginPath(); ctx.ellipse(cxR, cy, rx, ry, 0, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    canBand(ctx, cxR - 0.6, cxR + 0.6, cy, rx, ry);
    ctx.fill();
  }
  // The film view's can: turned towards you (like the can on the bench), the
  // poster pasted across its lid.
  function drawCanBig(cv, poster, tape, f) {
    const x = cv.getContext("2d");
    const W = cv.width, H = cv.height;
    x.clearRect(0, 0, W, H);
    const ry = H * 0.47, rx = ry * 0.8, T = ry * 0.24, cy = H / 2;
    const cxR = W - rx - 4, cxL = cxR - T;
    // shadow on the floor
    x.fillStyle = "rgba(0,0,0,0.35)";
    x.beginPath(); x.ellipse(cxR - T / 2, cy + ry * 0.98, rx * 1.05, ry * 0.05, 0, 0, Math.PI * 2); x.fill();
    x.fillStyle = "#9aa0a6";
    canRimPath(x, cxL, cxR, cy, rx, ry);
    x.fill();
    // The tape round the rim, and its print bent round the curve, as on the
    // shelf but at this steeper angle (the rim swings much further left as it
    // turns away). Drawn in thin strips, clipped to the tape's curved edges.
    const lip = T * 0.12, wide = T - 2 * lip, A = 1.35, len = 2 * A * ry;
    x.save();
    x.beginPath();
    x.ellipse(cxL + lip, cy, rx, ry * Math.sin(A), 0, -Math.PI / 2, Math.PI / 2, true);
    x.lineTo(cxR - lip, cy + ry * Math.sin(A));
    x.ellipse(cxR - lip, cy, rx, ry * Math.sin(A), 0, Math.PI / 2, -Math.PI / 2, false);
    x.closePath();
    x.fillStyle = tape;
    x.fill();
    if (f) {
      // the label is drawn in shelf units, scaled up to this size
      const unit = wide / CAN_TAPE;
      const lg = logoImg(f.slug, "w300") || logoImg(f.slug, "w185");
      const label = canLabel(f, tape, lg, Math.min(8, Math.ceil(unit)), len / unit, CAN_TAPE);
      x.clip();
      x.imageSmoothingQuality = "high";
      const N = Math.max(30, Math.round(H / 4));
      for (let i = 0; i < N; i++) {
        const t1 = -A + (2 * A * i) / N, t2 = -A + (2 * A * (i + 1)) / N, tm = (t1 + t2) / 2;
        const y1 = cy + ry * Math.sin(t1), y2 = cy + ry * Math.sin(t2);
        const sx = cxL - rx * Math.cos(tm) + lip;
        x.drawImage(label, 0, (label.height * i) / N, label.width, label.height / N, sx - 0.4, y1, wide + 0.8, y2 - y1 + 0.3);
      }
      // the logo may still be loading: draw again when it's in
      if (!lg && logoPath(f.slug) && (cv._tries = (cv._tries || 0) + 1) < 10) setTimeout(() => cv.isConnected && drawCanBig(cv, poster, tape, f), 400);
    }
    x.restore();
    x.save();
    canRimPath(x, cxL, cxR, cy, rx, ry);
    x.clip();
    x.fillStyle = canCurve(x, cy - ry, cy + ry);
    x.fillRect(0, 0, W, H);
    // glint down the far edge
    x.strokeStyle = "rgba(255,255,255,0.5)";
    x.lineWidth = Math.max(1, T * 0.05);
    x.beginPath(); x.ellipse(cxL + T * 0.06, cy, rx, ry * 0.985, 0, Math.PI * 0.62, Math.PI * 1.38); x.stroke();
    x.restore();
    canLid(x, cxR, cy, rx, ry, poster);
    // the light catching the lid's top left
    x.save();
    x.translate(cxR, cy);
    x.scale(rx, ry);
    const g = x.createLinearGradient(-1, -1, 0.4, 0.4);
    g.addColorStop(0, "rgba(255,255,255,0.22)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    x.fillStyle = g;
    x.beginPath(); x.arc(0, 0, 1, 0, Math.PI * 2); x.fill();
    x.restore();
  }

  function draw() {
    const c = wall.canvas, L = wall.lay;
    if (!c || !L || wall.level !== "wall" || !c.isConnected) return;
    const t0 = performance.now();
    const dpr = Math.min(window.devicePixelRatio || 1, wall.lite ? 1 : 2);
    const W = c.clientWidth, H = c.clientHeight;
    if (c.width !== Math.round(W * dpr) || c.height !== Math.round(H * dpr)) { c.width = Math.round(W * dpr); c.height = Math.round(H * dpr); }
    clampCam();
    const { x: cx, y: cy, z } = wall.cam;
    const ctx = c.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#0f1317";
    ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, -cx * z * dpr, -cy * z * dpr);
    const x0 = cx, x1 = cx + W / z, y0 = cy, y1 = cy + H / z;
    const inView = [];
    for (let b = 0; b < L.bays; b++) {
      const o = L.origin(b);
      if (o.x + WU.bayW >= x0 && o.x <= x1 && o.y + ROW_H >= y0 && o.y <= y1) inView.push(b);
    }
    const seen = new Set(inView);
    const px = 1 / z; // one screen pixel in wall units
    const blk = blockedSet(); // blocked films, when hidden: their spots stay empty

    // Bays: a dark wood back panel, wood shelf boards and uprights. The
    // grain is one small tile drawn once and repeated (a pattern fill).
    const grain = woodPattern(ctx);
    for (const b of inView) {
      const { x: bx, y: by } = L.origin(b);
      const H = WU.shelves * WU.shelfH;
      ctx.fillStyle = grain;
      ctx.fillRect(bx, by + WU.sign - 10, WU.bayW, H + 10);
      ctx.fillStyle = "rgba(12,9,7,0.78)"; // the back panel sits in shadow
      ctx.fillRect(bx, by + WU.sign - 10, WU.bayW, H + 10);
      for (let s = 1; s <= WU.shelves; s++) {
        const sy = by + WU.sign + s * WU.shelfH - WU.lip;
        ctx.fillStyle = grain;
        ctx.fillRect(bx, sy, WU.bayW, WU.lip);
        ctx.fillStyle = "rgba(255,230,200,0.16)"; // the lit front edge
        ctx.fillRect(bx, sy, WU.bayW, 2);
        ctx.fillStyle = "rgba(0,0,0,0.28)";
        ctx.fillRect(bx, sy + WU.lip - 3, WU.bayW, 3);
      }
      ctx.fillStyle = grain;
      ctx.fillRect(bx - 6, by + WU.sign - 10, 10, H + 20);
      ctx.fillRect(bx + WU.bayW - 4, by + WU.sign - 10, 10, H + 20);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(bx + 2, by + WU.sign - 10, 2, H + 20);
      ctx.fillRect(bx + WU.bayW + 4, by + WU.sign - 10, 2, H + 20);
    }

    const secColor = (sec, f) => {
      if (!f) return sec.avg || `hsl(${sec.hue} 38% 34%)`;
      const own = colorOf(f.slug);
      if (own) return `#${own.slice(0, 6)}`;
      const hv = f ? hash(f.slug) : 0;
      const hue = sec.hue + ((hv % 37) - 18);
      if (!f) return `hsl(${sec.hue} 38% 34%)`;
      const fm = fmtOf(f.year);
      return fm === "vhs" || fm === "can" ? `hsl(${hue} 10% ${10 + (hv % 9)}%)` : `hsl(${hue} ${32 + (hv % 22)}% ${fm === "bluray" ? 36 + (hv % 14) : 24 + (hv % 14)}%)`;
    };

    // Franchise stickers on the back wall: a colour block the width of the
    // set, with #1's title art in the gap above the boxes.
    if (z >= FAR && L.stickers) {
      for (const st of L.stickers) {
        if (!seen.has(st.bay) || st.x1 < x0 || st.x0 > x1) continue;
        const own = st.color || colorOf(st.lead);
        // From the very top of the gap, lined up with the backs of the cases
        // (the left edge starts where the first case's back meets the wall).
        // It reaches down at most to just below DVD height; when the art is
        // as wide as the sticker can be, it stops just under the art.
        const top = st.y - (WU.shelfH - WU.lip);
        const deepest = st.y - spineH(2000) + 3;
        const sx0 = st.x0 + DEPTH_X, sx1 = st.x1 + 2;
        const bw = sx1 - sx0 - 8;
        const maxBand = deepest - 3 - DEPTH_Y - 3 - (top + 3);
        const lg = st.logo ? logoImgPath(st.logo, "w300") : logoImg(st.lead, "w300");
        let art = null;
        if (lg && maxBand >= 6) {
          const a = (lg.img.naturalWidth || 300) / (lg.img.naturalHeight || 100);
          const w = Math.min(bw, maxBand * a);
          art = { w, h: w / a };
        }
        const bottom = art ? Math.min(deepest, top + 3 + art.h + 4) : deepest;
        ctx.fillStyle = own ? `#${own.slice(0, 6)}` : "#5a4a7a";
        ctx.fillRect(sx0, top, sx1 - sx0, bottom - top);
        // Up close, #1's title art at the top; from further back, just the colour.
        if (art && z >= LOGO_Z) ctx.drawImage(lg.img, (sx0 + sx1) / 2 - art.w / 2, top + 3, art.w, art.h);
      }
    }

    {
      // Every spine in view (detail only up close).
      const near = z >= NEAR, text = z >= TEXT && !wall.lite;
      // From far away each bay's spines are flat blocks of colour: draw them
      // once into a small picture per bay and reuse it while nothing changes.
      const zd = z * dpr;
      const cacheS = !near && zd <= 0.2 ? (zd <= 0.07 ? 0.07 : 0.2) : 0;
      const sig = `${paintVer}|${blk ? blk.size : 0}|${wall.lifted || ""}`;
      for (const b of inView) {
        if (cacheS) {
          const key = `${b}:${cacheS}`;
          let e = wall.bayCache.get(key);
          if (!e || e.lay !== L || e.sig !== sig) {
            const { x: bx, y: by } = L.origin(b);
            const X = bx - 30, Y = by + WU.sign - 60, Wd = WU.bayW + 60, Hd = WU.shelves * WU.shelfH + 70;
            const cv = (e && e.cv) || document.createElement("canvas");
            cv.width = Math.ceil(Wd * cacheS); cv.height = Math.ceil(Hd * cacheS);
            const g = cv.getContext("2d");
            g.setTransform(cacheS, 0, 0, cacheS, -X * cacheS, -Y * cacheS);
            for (let s = 0; s < WU.shelves; s++) {
              for (const i of L.chunks.get(`${b}:${s}`) || []) {
                const f = L.films[i];
                if (f.slug === wall.lifted || (blk && blk.has(f.slug))) continue;
                if (f.lean) { g.save(); g.translate(f.x, f.y); g.rotate(-f.lean); g.translate(-f.x, -f.y); }
                const top = f.y - f.h, body = secColor(L.secs[f.sec], f);
                if (isCan(f.year)) { g.fillStyle = "#8f979f"; g.fillRect(f.x, top, f.w, f.h); g.fillStyle = body; g.fillRect(f.x + 2, top + PAPER_IN, f.w - 4, f.h - 2 * PAPER_IN); }
                else { g.fillStyle = body; g.fillRect(f.x, top, f.w, f.h); }
                if (f.lean) g.restore();
              }
            }
            e = { cv, lay: L, sig, X, Y, Wd, Hd };
          }
          wall.bayCache.delete(key);
          wall.bayCache.set(key, e); // most recently used last
          if (wall.bayCache.size > 500) wall.bayCache.delete(wall.bayCache.keys().next().value);
          ctx.drawImage(e.cv, e.X, e.Y, e.Wd, e.Hd);
          continue;
        }
        for (let s = 0; s < WU.shelves; s++) {
          const list = L.chunks.get(`${b}:${s}`);
          if (!list) continue;
          for (const i of list) {
            const f = L.films[i];
            if (f.x + f.w < x0 || f.x - f.h > x1 || f.slug === wall.lifted || (blk && blk.has(f.slug))) continue;
            if (f.lean) { ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(-f.lean); ctx.translate(-f.x, -f.y); }
            try {
            const top = f.y - f.h;
            const body = secColor(L.secs[f.sec], f);
            // A whisper of depth: we stand a little above and to the right,
            // so each box shows a sliver of its top and of its right-hand
            // face (the cover edge). Neighbours drawn after cover most of it.
            const can = isCan(f.year);
            if (near && !wall.lite && !can) {
              // The case as a solid: its rounded outline swept back from the
              // back face to the front, so every corner stays rounded.
              const r = Math.min(CORNER, f.w / 2);
              const plastic = caseTop(f.year);
              // (back face, the flat faces between the corners, and each
              // rounded corner swept as a capsule: one smooth solid)
              const X0 = f.x, X1 = f.x + f.w, Y0 = top, Y1 = f.y, dx = DEPTH_X, dy = DEPTH_Y;
              ctx.fillStyle = plastic;
              ctx.beginPath();
              if (ctx.roundRect) ctx.roundRect(X0 + dx, Y0 - dy, f.w, f.h, r); else ctx.rect(X0 + dx, Y0 - dy, f.w, f.h);
              ctx.fill();
              ctx.beginPath();
              ctx.moveTo(X0 + r, Y0); ctx.lineTo(X1 - r, Y0); ctx.lineTo(X1 - r + dx, Y0 - dy); ctx.lineTo(X0 + r + dx, Y0 - dy); ctx.closePath();
              ctx.moveTo(X1, Y0 + r); ctx.lineTo(X1, Y1 - r); ctx.lineTo(X1 + dx, Y1 - r - dy); ctx.lineTo(X1 + dx, Y0 + r - dy); ctx.closePath();
              ctx.fill();
              ctx.strokeStyle = plastic;
              ctx.lineWidth = 2 * r;
              ctx.lineCap = "round";
              ctx.beginPath();
              for (const [cx, cy] of [[X0 + r, Y0 + r], [X1 - r, Y0 + r], [X1 - r, Y1 - r]]) { ctx.moveTo(cx, cy); ctx.lineTo(cx + dx, cy - dy); }
              ctx.stroke();
              ctx.lineCap = "butt";
              // The right-hand face is the edge of the front cover: the same
              // plastic, laminate and paper bands as the spine, in shadow.
              const side = (ya, yb, color) => {
                ctx.fillStyle = color;
                ctx.beginPath();
                ctx.moveTo(f.x + f.w, ya); ctx.lineTo(f.x + f.w + DEPTH_X, ya - DEPTH_Y); ctx.lineTo(f.x + f.w + DEPTH_X, yb - DEPTH_Y); ctx.lineTo(f.x + f.w, yb);
                ctx.fill();
              };
              side(top + CASE_END, top + CASE_END + LAMINATE, "rgba(255,255,255,0.14)");
              side(f.y - CASE_END - LAMINATE, f.y - CASE_END, "rgba(255,255,255,0.14)");
              side(top + PAPER_TOP, f.y - PAPER_TOP, body);
              side(top + r, f.y - r, "rgba(0,0,0,0.4)");
              // the seam on top, where the two halves of the case meet (fainter on Blu-ray blue)
              ctx.strokeStyle = fmtOf(f.year) === "bluray" ? "rgba(0,0,0,0.3)" : "rgba(0,0,0,0.55)";
              ctx.lineWidth = Math.max(px, 0.6);
              ctx.beginPath();
              ctx.moveTo(f.x + f.w * 0.5, top);
              ctx.lineTo(f.x + f.w * 0.5 + DEPTH_X, top - DEPTH_Y);
              ctx.stroke();
            }
            // The case: plastic all round, the printed paper wrap inside it,
            // stopping short of each end under a strip of clear laminate.
            if (can) {
              if (near && !wall.lite) drawCan(ctx, f, top, body, z);
              else { ctx.fillStyle = "#8f979f"; ctx.fillRect(f.x, top, f.w, f.h); ctx.fillStyle = body; ctx.fillRect(f.x + 2, top + PAPER_IN, f.w - 4, f.h - 2 * PAPER_IN); }
            } else if (near && !wall.lite) {
              ctx.fillStyle = caseTop(f.year);
              if (ctx.roundRect) { ctx.beginPath(); ctx.roundRect(f.x, top, f.w, f.h, Math.min(CORNER, f.w / 2)); ctx.fill(); }
              else ctx.fillRect(f.x, top, f.w, f.h);
              ctx.fillStyle = "rgba(255,255,255,0.14)";
              ctx.fillRect(f.x, top + CASE_END, f.w, LAMINATE);
              ctx.fillRect(f.x, f.y - CASE_END - LAMINATE, f.w, LAMINATE);
              ctx.fillStyle = body;
              ctx.fillRect(f.x, top + PAPER_TOP, f.w, f.h - 2 * PAPER_TOP);
            } else {
              ctx.fillStyle = body;
              ctx.fillRect(f.x, top, f.w, f.h);
            }
            if (!near || wall.lite) continue;
            const own = colorOf(f.slug);
            // Spine print reads top to bottom (as on real spines): coordinates
            // below run down from the top of the case. Year at the bottom,
            // title or logo centred on the whole spine, clear of the year.
            // Title or logo: centred between the top of the paper and the year
            // (or the bottom of the paper, with dates turned off).
            const dates = !mine.noDates;
            const yearAt = f.h - PAPER_IN - YEAR_ZONE / 2;
            const printTop = PAPER_IN + 2, printEnd = f.h - PAPER_IN - (dates ? YEAR_ZONE : 2);
            const mid = (printTop + printEnd) / 2;
            const span = printEnd - printTop;
            const size = z >= 3.4 ? "w500" : z >= 1.6 ? "w300" : "w185";
            const lg = z >= LOGO_Z ? logoImg(f.slug, size) || (size !== "w185" ? logoImg(f.slug, "w185") : null) : null;
            const fs = Math.min(f.w * 0.76, 11);
            if (!can && (lg || text)) {
              ctx.save();
              ctx.translate(f.x + f.w / 2, top);
              ctx.rotate(Math.PI / 2);
              ctx.textBaseline = "middle";
              ctx.textAlign = "center";
              if (lg) {
                const iw = lg.img.naturalWidth || 300, ih = lg.img.naturalHeight || 100;
                const thick = f.w - 1.5;
                // Logo colour wash: off unless chosen for this film (Edit).
                const wash = (mine.wash && mine.wash[f.slug]) || shared.wash[f.slug];
                const src = wash ? logoInk(lg, wash) : lg.img;
                if (ih > iw) {
                  // Taller than wide: it already reads along the spine, so it stays upright.
                  let w = Math.min(thick, (span * iw) / ih), hh = (w * ih) / iw;
                  ctx.save();
                  ctx.translate(mid, 0);
                  ctx.rotate(-Math.PI / 2);
                  ctx.drawImage(src, -w / 2, -hh / 2, w, hh);
                  ctx.restore();
                } else {
                  const a = iw / ih;
                  let len = Math.min(span, thick * a), th = len / a;
                  if (th > thick) { th = thick; len = th * a; }
                  ctx.drawImage(src, mid - len / 2, -th / 2, len, th);
                }
              } else {
                ctx.font = `700 ${fs}px "Helvetica Neue", Arial, sans-serif`;
                const light = own && lum(rgbOf(own)) > 0.58;
                const washT = (mine.wash && mine.wash[f.slug]) || shared.wash[f.slug];
                ctx.fillStyle = washT || (light ? "rgba(10,12,14,0.9)" : "rgba(255,255,255,0.92)");
                const t = titleOf(f.name).toUpperCase();
                const tw = ctx.measureText(t).width;
                if (tw <= span) ctx.fillText(t, mid, 0);
                else {
                  // Too long: shrink to fit, starting from the top of the spine.
                  ctx.font = `700 ${Math.max(2.5, (fs * span) / tw)}px "Helvetica Neue", Arial, sans-serif`;
                  ctx.textAlign = "left";
                  ctx.fillText(t, printTop, 0, span);
                  ctx.textAlign = "center";
                }
              }
              if (text && dates) {
                ctx.font = `600 ${YEAR_FS}px Arial, sans-serif`;
                ctx.fillStyle = yearInk(own);
                ctx.fillText(String(f.year || ""), yearAt, 0);
              }
              ctx.restore();
            }
            if (can) {
              // (the can shades itself in drawCan)
            } else {
            // Light from the left, over the print too (it's on the plastic): a soft highlight down the left edge (three
            // stacked strips make a cheap gradient) and a thin shadow on the right.
            const e = f.w * 0.05;
            ctx.fillStyle = "rgba(255,255,255,0.10)";
            ctx.fillRect(f.x + 0.4, top + 1, e * 2.4, f.h - 2);
            ctx.fillStyle = "rgba(255,255,255,0.10)";
            ctx.fillRect(f.x + 0.4, top + 1, e * 1.4, f.h - 2);
            ctx.fillStyle = "rgba(255,255,255,0.14)";
            ctx.fillRect(f.x + 0.4, top + 1, e * 0.6, f.h - 2);
            ctx.fillStyle = "rgba(0,0,0,0.16)";
            ctx.fillRect(f.x + f.w - e * 1.6, top + 1, e * 1.6, f.h - 2);
            ctx.fillStyle = "rgba(0,0,0,0.2)";
            ctx.fillRect(f.x + f.w - e * 0.6, top + 1, e * 0.6, f.h - 2);
            }
            } finally { if (f.lean) ctx.restore(); }
          }
        }
      }
      // Face-out boxes at the ends of shelves.
      for (const fc of L.faces) {
        if (!seen.has(fc.bay) || fc.x + fc.w < x0 || fc.x > x1) continue;
        const top = fc.y - fc.h;
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(fc.x + 3, top + 4, fc.w, fc.h);
        const im = z >= 0.2 ? posterImg(fc.slug) : null;
        if (im) ctx.drawImage(im, fc.x, top, fc.w, fc.h);
        else { ctx.fillStyle = secColor(L.secs[fc.sec], fc); ctx.fillRect(fc.x, top, fc.w, fc.h); }
      }
    }

    // The uprights again, in front: a box hugging the end of a shelf shows its
    // side face, which must tuck behind the upright rather than over it.
    for (const b of inView) {
      const { x: bx, y: by } = L.origin(b);
      const H = WU.shelves * WU.shelfH;
      ctx.fillStyle = grain;
      ctx.fillRect(bx + WU.bayW - 4, by + WU.sign - 10, 10, H + 20);
      ctx.fillStyle = "rgba(0,0,0,0.22)";
      ctx.fillRect(bx + WU.bayW + 4, by + WU.sign - 10, 2, H + 20);
      ctx.fillStyle = "rgba(255,230,200,0.08)";
      ctx.fillRect(bx + WU.bayW - 4, by + WU.sign - 10, 1.5, H + 20);
    }

    // Where one section ends and the next begins on a shelf: a brushed
    // steel divider standing between the films (with a little thickness and
    // a top edge, like the cases), and a tab in the new section's colour.
    if (z >= FAR) {
      for (const be of L.bookends) {
        if (!be.change || !seen.has(be.bay) || be.x < x0 - 200 || be.x > x1 + 20) continue;
        const top = be.y - (WU.shelfH - WU.lip) + 8, T = 4; // T: thickness facing us
        const steel = ctx.createLinearGradient(be.x, 0, be.x + T, 0);
        steel.addColorStop(0, "#5d646c");
        steel.addColorStop(0.35, "#e9eef2");
        steel.addColorStop(0.55, "#9aa3ab");
        steel.addColorStop(1, "#4a5158");
        // side face, then the top edge, then the face
        ctx.fillStyle = "#2e3338";
        ctx.beginPath();
        ctx.moveTo(be.x + T, top); ctx.lineTo(be.x + T + DEPTH_X, top - DEPTH_Y); ctx.lineTo(be.x + T + DEPTH_X, be.y - DEPTH_Y); ctx.lineTo(be.x + T, be.y);
        ctx.fill();
        ctx.fillStyle = "#c9d0d6";
        ctx.beginPath();
        ctx.moveTo(be.x, top); ctx.lineTo(be.x + DEPTH_X, top - DEPTH_Y); ctx.lineTo(be.x + T + DEPTH_X, top - DEPTH_Y); ctx.lineTo(be.x + T, top);
        ctx.fill();
        ctx.fillStyle = steel;
        ctx.fillRect(be.x, top, T, be.y - top);
        // a soft travelling highlight sells the gloss
        const glint = ctx.createLinearGradient(0, top, 0, be.y);
        glint.addColorStop(0, "rgba(255,255,255,0)");
        glint.addColorStop(0.18, "rgba(255,255,255,0.55)");
        glint.addColorStop(0.3, "rgba(255,255,255,0)");
        ctx.fillStyle = glint;
        ctx.fillRect(be.x, top, T, be.y - top);
      }
    }

    // From afar: each piece is a block in its section's colour, named.
    // The blocks fade as you walk up, until only the spines are left.
    // (Off unless chosen in Settings: the big aisle signs do this job now.)
    const veilAt = z < FAR ? 0.82 : z < NEAR ? 0.82 * (1 - (z - FAR) / (NEAR - FAR)) : 0;
    const veil = mine.overlay || edit.on ? veilAt : 0; // edit mode moves sections as blocks
    if (veil > 0.02) {
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const r of L.runs) {
        if (!seen.has(r.bay) || r.x1 < x0 || r.x0 > x1) continue;
        const sec = L.secs[r.sec];
        const top = r.by + WU.sign + r.shelf * WU.shelfH + 8, h = WU.shelfH - WU.lip - 10;
        ctx.globalAlpha = veil;
        ctx.fillStyle = `hsl(${sec.hue} 55% 38%)`;
        ctx.fillRect(r.x0, top, r.x1 - r.x0, h);
        ctx.globalAlpha = Math.min(1, veil * 1.2);
        ctx.strokeStyle = `hsl(${sec.hue} 70% 65%)`;
        ctx.lineWidth = 2 * px;
        ctx.strokeRect(r.x0, top, r.x1 - r.x0, h);
        // The name, as big as fits (in edit mode, the block's own name).
        const label = (edit.on && r.blk && r.blk !== sec.id ? nameOf(r.blk) : sec.name).toUpperCase();
        ctx.font = `800 100px Arial, sans-serif`;
        const tw = ctx.measureText(label).width;
        const size = Math.min(h * 0.42, ((r.x1 - r.x0) * 0.86 * 100) / tw);
        if (size * z >= 5) {
          ctx.font = `800 ${size}px Arial, sans-serif`;
          ctx.fillStyle = "#fff";
          ctx.fillText(label, (r.x0 + r.x1) / 2, top + h / 2);
        }
      }
      ctx.globalAlpha = 1;
      ctx.textAlign = "left";
    }

    // Edit mode: outline the selected section's pieces.
    const selSec = edit.on && edit.sel ? L.secs.findIndex((x) => x.id === edit.sel) : -1;
    if (selSec >= 0) {
      ctx.strokeStyle = "#40bcf4";
      ctx.lineWidth = 3 * px;
      ctx.setLineDash([10 * px, 6 * px]);
      for (const r of L.runs) if (r.sec === selSec && seen.has(r.bay)) ctx.strokeRect(r.x0 - 4, r.by + WU.sign + r.shelf * WU.shelfH + 4, r.x1 - r.x0 + 8, WU.shelfH - WU.lip - 2);
      ctx.setLineDash([]);
    }
    // Where a dragged piece would land.
    for (const d of wall.dropHint ? (wall.dropHint.group ? wall.dropHint.items.map((it) => ({ ...it, ok: wall.dropHint.ok })) : [wall.dropHint]) : []) {
      const o = L.origin(d.bay);
      ctx.fillStyle = d.ok ? "rgba(64,188,244,0.25)" : "rgba(255,90,90,0.25)";
      ctx.strokeStyle = d.ok ? "#40bcf4" : "#ff5a5a";
      ctx.lineWidth = 3 * px;
      const top = o.y + WU.sign + d.shelf * WU.shelfH + 6;
      if (d.dvd) { ctx.fillStyle = d.ok ? "#40bcf4" : "#ff5a5a"; ctx.fillRect(d.x, top, Math.max(d.w, 3 * px), WU.shelfH - WU.lip - 8); }
      else {
        ctx.fillRect(d.x, top, d.w, WU.shelfH - WU.lip - 8);
        ctx.strokeRect(d.x, top, d.w, WU.shelfH - WU.lip - 8);
      }
    }

    // Up close: laminated signs hung from each shelf's front edge. They're
    // part of the wall (they zoom with it), overhang the shelf, and repeat
    // along every section. Click one for its options.
    wall.signs = [];
    if (veilAt < 0.3) {
      const fsz = 15, th = 30, spacing = 520;
      ctx.font = `800 ${fsz}px Arial, sans-serif`;
      ctx.textBaseline = "middle";
      ctx.textAlign = "left";
      const stickerSpans = new Map();
      for (const st of L.stickers || []) { const k = `${st.bay}:${st.shelf}`; (stickerSpans.get(k) || stickerSpans.set(k, []).get(k)).push([st.x0, st.x1 + DEPTH_X + 2]); }
      // One tag (repeating) per subsection along the shelf; the section's own
      // name goes up on the hanging sign above the bay.
      for (const r of L.runs) for (const pt of r.parts && r.parts.length ? r.parts : [{ sub: null, x0: r.x0, x1: r.x1 }]) {
        if (!seen.has(r.bay) || pt.x1 < x0 || pt.x0 > x1) continue;
        const sec = L.secs[r.sec];
        const mode = sortOf(sec.id);
        const subName = pt.sub && lib.subs.has(pt.sub) && !/\/general$/.test(pt.sub) ? nameOf(pt.sub) : sec.name;
        const label = subName.toUpperCase() + (mode === "year" ? " · BY YEAR" : mode === "index" ? " · INDEX" : "");
        const tw = Math.min(pt.x1 - pt.x0 - 4, ctx.measureText(label).width + 26);
        if (tw < 40) continue;
        const ty = r.by + WU.sign + (r.shelf + 1) * WU.shelfH - WU.lip + 2;
        // Tags hang down into the shelf below: never over a franchise sticker there.
        const below = stickerSpans.get(`${r.bay}:${r.shelf + 1}`) || [];
        for (let sx = pt.x0 + 2; sx + tw <= pt.x1 + 1; sx += Math.max(spacing, tw + 120)) {
          const hit = below.find(([a, b]) => sx < b + 6 && sx + tw > a - 6);
          if (hit) { sx = hit[1] + 8 - Math.max(spacing, tw + 120); continue; }
          if (sx + tw < x0 || sx > x1) continue;
          ctx.fillStyle = "rgba(0,0,0,0.45)";
          ctx.fillRect(sx + 3, ty + 3, tw, th);
          ctx.fillStyle = "#f4f1e8";
          ctx.fillRect(sx, ty, tw, th);
          ctx.fillStyle = `hsl(${sec.hue} 60% 45%)`;
          ctx.fillRect(sx, ty, 6, th);
          ctx.fillStyle = "rgba(255,255,255,0.4)"; // laminate shine
          ctx.fillRect(sx, ty, tw, th * 0.32);
          ctx.fillStyle = "rgba(220,220,200,0.55)"; // tape at the top
          ctx.fillRect(sx + tw / 2 - 16, ty - 4, 32, 9);
          ctx.fillStyle = "#14181c";
          ctx.save();
          ctx.beginPath(); ctx.rect(sx + 10, ty, tw - 14, th); ctx.clip();
          ctx.fillText(label, sx + 13, ty + th / 2 + 1);
          ctx.restore();
          wall.signs.push({ x: sx, y: ty, w: tw, h: th, sec: r.sec });
        }
      }
    }

    // At the head of each aisle (row of bays): a big sign naming its
    // categories, readable from all the way back.
    for (const a of L.aisles || []) {
      const ax = (a.x || 0) - AISLE_W - AISLE_GAP / 2, ay = a.y + WU.sign - 10, ah = WU.shelves * WU.shelfH + 10;
      if (ax + AISLE_W < x0 || ax > x1 || ay > y1 || ay + ah < y0) continue;
      ctx.fillStyle = "rgba(0,0,0,0.5)";
      ctx.fillRect(ax + 14, ay + 18, AISLE_W, ah);
      // in the store's colours: black frame, red panel, cream lettering
      ctx.fillStyle = "#17191c";
      ctx.fillRect(ax, ay, AISLE_W, ah);
      ctx.fillStyle = "#e23b2e";
      ctx.fillRect(ax + 30, ay + 30, AISLE_W - 60, ah - 60);
      ctx.fillStyle = "#f0e6cf";
      ctx.fillRect(ax + 30, ay + 170, AISLE_W - 60, 12);
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillStyle = "#f0e6cf";
      ctx.font = `800 64px "Helvetica Neue", Arial, sans-serif`;
      ctx.fillText(roomGenres().length > 1 ? `${nameOf(a.genre).toUpperCase()} · AISLE ${a.num}` : `AISLE ${a.num}`, ax + AISLE_W / 2, ay + 120, AISLE_W - 100);
      const n = a.secs.length, top = ay + 200, room = ah - 200 - 80;
      const fs = Math.min(130, (room / n) * 0.6);
      ctx.font = `800 ${fs}px "Helvetica Neue", Arial, sans-serif`;
      a.secs.forEach((si, i) => {
        const sec = L.secs[si], cy = top + (room / n) * (i + 0.5);
        ctx.fillStyle = "#fff4dc";
        ctx.fillText(sec.name.toUpperCase(), ax + AISLE_W / 2, cy, AISLE_W - 140);
        ctx.fillStyle = `hsl(${sec.hue} 60% 55%)`;
        ctx.fillRect(ax + AISLE_W / 2 - 120, cy + fs * 0.55, 240, Math.max(6, fs * 0.08));
      });
      ctx.textAlign = "left";
    }

    if (L.pile && L.pile.x < x1 && L.pile.x + L.pile.w > x0 && L.pile.y < y1 && L.pile.y + L.pile.h > y0) drawPile(ctx, L.pile, px);

    // Hanging from the ceiling over each bay: tall wooden boards naming the
    // categories on it, stacked.
    if (L.hang) {
      ctx.textBaseline = "middle";
      ctx.textAlign = "center";
      for (const bd of L.hang) {
        if (!seen.has(bd.bay)) continue;
        const o = L.origin(bd.bay);
        const w = bd.w, sx = bd.sx, SH = HANG_H, by = o.y + HANG_DROP;
        if (w < 40 || sx + w < x0 || sx > x1 || by > y1 || by + SH < y0) continue;
        // chains
        ctx.strokeStyle = "rgba(150,150,150,0.7)";
        ctx.lineWidth = 2.4;
        ctx.setLineDash([5, 3]);
        ctx.beginPath();
        for (const cx of [sx + 26, sx + w - 26]) { ctx.moveTo(cx, o.y); ctx.lineTo(cx, by + 2); }
        ctx.stroke();
        ctx.setLineDash([]);
        // the board: drop shadow, grain, a warm stain, a bevelled edge
        ctx.fillStyle = "rgba(0,0,0,0.5)";
        ctx.fillRect(sx + 6, by + 8, w, SH);
        ctx.fillStyle = grain;
        ctx.fillRect(sx, by, w, SH);
        ctx.fillStyle = "rgba(120,72,30,0.35)";
        ctx.fillRect(sx, by, w, SH);
        ctx.fillStyle = "rgba(255,225,180,0.22)";
        ctx.fillRect(sx, by, w, 3.5);
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(sx, by + SH - 4, w, 4);
        ctx.strokeStyle = "rgba(30,16,6,0.8)";
        ctx.lineWidth = 3;
        ctx.strokeRect(sx + 1.5, by + 1.5, w - 3, SH - 3);
        // each category: its name painted on, with a stripe of its colour
        const k = bd.secs.length, rowH = (SH - 24) / k;
        ctx.font = `800 ${bd.fs}px "Helvetica Neue", Arial, sans-serif`;
        bd.secs.forEach((si, i) => {
          const sec = L.secs[si];
          const label = sec.name.toUpperCase();
          const cy = by + 12 + rowH * (i + 0.5) - bd.fs * 0.08;
          ctx.save();
          ctx.beginPath(); ctx.rect(sx + 8, by, w - 16, SH); ctx.clip();
          ctx.fillStyle = "rgba(0,0,0,0.55)";
          ctx.fillText(label, sx + w / 2 + 1.6, cy + 1.6, w - 40);
          ctx.fillStyle = "#f6e7c8";
          ctx.fillText(label, sx + w / 2, cy, w - 40);
          ctx.restore();
          ctx.fillStyle = `hsl(${sec.hue} 55% 45%)`;
          const lw = Math.min(w - 60, Math.max(60, ctx.measureText(label).width * 0.6));
          ctx.fillRect(sx + w / 2 - lw / 2, cy + bd.fs * 0.52, lw, Math.max(3, bd.fs * 0.07));
        });
      }
      ctx.textAlign = "left";
    }

    // A film you jumped to blinks.
    if (wall.flash && L.films[wall.flash.i] && Math.floor(performance.now() / 300) % 2 === 0) {
      const f = L.films[wall.flash.i];
      ctx.save();
      if (f.lean) { ctx.translate(f.x, f.y); ctx.rotate(-f.lean); ctx.translate(-f.x, -f.y); }
      ctx.strokeStyle = "#ffd447";
      ctx.lineWidth = 4 * px;
      ctx.strokeRect(f.x - 2, f.y - f.h - 2, f.w + 4, f.h + 4);
      ctx.restore();
    }
    // Hovered spine
    if (wall.hover != null && z >= NEAR) {
      const f = L.films[wall.hover];
      ctx.save();
      if (f.lean) { ctx.translate(f.x, f.y); ctx.rotate(-f.lean); ctx.translate(-f.x, -f.y); }
      ctx.strokeStyle = "#40bcf4";
      ctx.lineWidth = 2 * px;
      ctx.strokeRect(f.x, f.y - f.h, f.w, f.h);
      ctx.restore();
    }

    if (z >= FAR) colorView(inView);
    // Too slow on this machine? Drop the extras (no sheen, no titles, 1x pixels).
    const ms = performance.now() - t0;
    wall.slow = ms > 28 ? wall.slow + 1 : Math.max(0, wall.slow - 1);
    if (wall.slow > 6 && !wall.lite) { wall.lite = true; toast("Simplified the shelves to keep things smooth on this computer."); drawSoon(); }
    renderStagePath();
  }

  // The pile: a heap of boxes, drawn once into a picture (redrawn when the
  // count changes), with a sign. Click it to open Uncategorized in the
  // Library; drop films on it to uncategorize them.
  function pileImage(P) {
    const key = `${P.n}|${paintVer}`;
    if (wall.pileImg && wall.pileImg.key === key) return wall.pileImg.cv;
    const S = 0.5, W = P.w * S, Hh = P.h * S;
    const cv = (wall.pileImg && wall.pileImg.cv) || document.createElement("canvas");
    cv.width = W; cv.height = Hh;
    const g = cv.getContext("2d");
    g.clearRect(0, 0, W, Hh);
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
    const films = (lib.inSub.get(UNCAT_SUB) || []).slice(0, 700);
    const cx = W / 2, base = Hh * 0.97, top = Hh * 0.42, half = W * 0.47;
    // floor shadow
    g.fillStyle = "rgba(0,0,0,0.45)";
    g.beginPath(); g.ellipse(cx, base, half * 1.02, Hh * 0.05, 0, 0, Math.PI * 2); g.fill();
    const boxes = [];
    const n = Math.min(650, 120 + Math.round(Math.sqrt(P.n) * 3));
    for (let k = 0; k < n; k++) {
      const u = (rnd() + rnd() + rnd()) / 3 * 2 - 1; // mostly towards the middle
      const x = cx + u * half;
      const surf = base - (base - top) * Math.max(0, 1 - u * u * 1.05);
      const y = surf + (base - surf) * Math.pow(rnd(), 0.55);
      const f = films[k % Math.max(1, films.length)];
      boxes.push({ x, y, a: (rnd() - 0.5) * 1.6, w: 34 + rnd() * 20, h: 50 + rnd() * 22, slug: f ? f[0] : "", year: f ? yearOf(f[1]) : 2000 });
    }
    boxes.sort((a, b) => a.y - b.y);
    for (const b of boxes) {
      g.save();
      g.translate(b.x, b.y);
      g.rotate(b.a);
      const own = b.slug && colorOf(b.slug);
      const hv = b.slug ? hash(b.slug) : 0;
      g.fillStyle = own ? `#${own.slice(0, 6)}` : `hsl(${hv % 360} ${20 + (hv % 30)}% ${18 + (hv % 18)}%)`;
      g.fillRect(-b.w / 2, -b.h / 2, b.w, b.h);
      g.fillStyle = isCan(b.year) ? "rgba(200,205,210,0.5)" : fmtOf(b.year) === "bluray" ? "rgba(40,110,200,0.55)" : "rgba(10,12,14,0.55)";
      g.fillRect(-b.w / 2, -b.h / 2, b.w, 4);
      g.fillRect(-b.w / 2, b.h / 2 - 4, b.w, 4);
      g.fillStyle = "rgba(255,255,255,0.10)";
      g.fillRect(-b.w / 2, -b.h / 2, 3, b.h);
      g.strokeStyle = "rgba(0,0,0,0.5)";
      g.lineWidth = 1;
      g.strokeRect(-b.w / 2, -b.h / 2, b.w, b.h);
      g.restore();
    }
    wall.pileImg = { key, cv };
    return cv;
  }
  function drawPile(ctx, P, px) {
    ctx.drawImage(pileImage(P), P.x, P.y, P.w, P.h);
    // a sign stuck in the top of the heap
    const sw = 1100, sh = 300, sx = P.x + P.w / 2 - sw / 2, sy = P.y + P.h * 0.42 - sh - 140;
    ctx.fillStyle = "#3a2c20";
    ctx.fillRect(P.x + P.w / 2 - 12, sy + sh, 24, 220);
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(sx + 14, sy + 18, sw, sh);
    ctx.fillStyle = "#17191c";
    ctx.fillRect(sx, sy, sw, sh);
    ctx.fillStyle = "#e23b2e";
    ctx.fillRect(sx + 24, sy + 24, sw - 48, sh - 48);
    ctx.fillStyle = "#f0e6cf";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.font = `800 110px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText("UNCATEGORIZED", sx + sw / 2, sy + 125, sw - 90);
    ctx.font = `700 58px "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(`${fmt(P.n)} film${P.n === 1 ? "" : "s"}`, sx + sw / 2, sy + 225, sw - 90);
    ctx.textAlign = "left";
    if (wall.dropHint && wall.dropHint.pile) {
      ctx.strokeStyle = "#40bcf4";
      ctx.lineWidth = Math.max(6, 3 * px);
      ctx.strokeRect(P.x, P.y, P.w, P.h);
    }
  }
  const inPile = (p) => { const P = wall.lay && wall.lay.pile; return P && p.x >= P.x && p.x <= P.x + P.w && p.y >= P.y - 400 && p.y <= P.y + P.h; };

  function bayAt(p) {
    const L = wall.lay;
    let row, rx = 0, ry;
    if (L.rowPos) {
      row = L.rowPos.findIndex((P) => P && p.y >= P.y && p.y < P.y + ROW_H && p.x >= P.x - WU.gap && p.x < P.x + L.k * (WU.bayW + WU.gap));
      if (row < 0) {
        // past the last row (edit mode's spare bays)
        const P = L.rowPos.extra(L.rowPos.length);
        row = p.x >= P.x && p.x < P.x + L.k * (WU.bayW + WU.gap) && p.y >= P.y ? L.rowPos.length + Math.floor((p.y - P.y) / ROW_H) : -1;
      }
      if (row < 0) return { b: -1, s: -1 };
      const P = L.rowPos[row] || L.rowPos.extra(row);
      rx = P.x; ry = P.y;
    } else { row = Math.floor(p.y / ROW_H); ry = row * ROW_H; }
    const col = Math.floor((p.x - rx) / (WU.bayW + WU.gap));
    if (col < 0 || col >= L.k || row < 0) return { b: -1, s: -1 };
    return { b: row * L.k + col, s: Math.floor((p.y - ry - WU.sign) / WU.shelfH) };
  }

  function filmAt(sx, sy) {
    const L = wall.lay;
    if (!L || wall.cam.z < NEAR) return null;
    const p = toWall(sx, sy);
    const { b, s } = bayAt(p);
    const list = L.chunks.get(`${b}:${s}`);
    if (!list) return null;
    const blk = blockedSet();
    for (const i of list) {
      const f = L.films[i];
      if (blk && blk.has(f.slug)) continue;
      if (f.lean) {
        const dx = p.x - f.x, dy = p.y - f.y, c = Math.cos(f.lean), s = Math.sin(f.lean);
        const lx = dx * c - dy * s, ly = dx * s + dy * c;
        if (lx >= 0 && lx <= f.w + 1 && ly >= -f.h && ly <= 0) return i;
      } else if (p.x >= f.x && p.x <= f.x + f.w + 1 && p.y >= f.y - f.h && p.y <= f.y) return i;
    }
    for (const fc of L.faces) if (fc.bay === b && fc.shelf === s && p.x >= fc.x && p.x <= fc.x + fc.w && p.y >= fc.y - fc.h && p.y <= fc.y) return L.idx.get(fc.slug) ?? null;
    return null;
  }

  function sectionAtCenter() {
    const L = wall.lay, c = wall.canvas;
    if (!L || !c) return null;
    const p = toWall(c.clientWidth / 2, c.clientHeight / 2);
    const at = bayAt(p);
    const b = at.b, s = Math.min(WU.shelves - 1, Math.max(0, at.s));
    const r = L.runs.find((r) => r.bay === b && r.shelf === s && p.x >= r.x0 - 40 && p.x <= r.x1 + 40);
    return r ? L.secs[r.sec] : null;
  }

  function renderStagePath() {
    const el = $(".lbs-stage-path", root);
    if (!el) return;
    const sec = wall.level === "wall" ? sectionAtCenter() : null;
    el.innerHTML =
      `<button type="button" class="lbs-crumb" data-act="fit" title="See the whole room">Store</button>` +
      (sec ? `<i>›</i><button type="button" class="lbs-crumb" data-act="go-genre" data-id="${esc(lib.cats.get(sec.id).genre)}">${esc(nameOf(lib.cats.get(sec.id).genre))}</button>` : "") +
      (sec ? `<i>›</i><button type="button" class="lbs-crumb" data-act="open" data-id="${esc(sec.id)}" data-drop="${esc(sec.id)}">${esc(sec.name)}</button>` : "") +
      (colorJob.total && colorJob.done < colorJob.total ? `<span class="lbs-hint">colours ${fmt(colorJob.done)} / ${fmt(colorJob.total)}</span>` : "") +
      (logoJob.running ? `<span class="lbs-hint">logos ${fmt(logoJob.done)} / ${fmt(logoJob.total)}</span>` : "");
    const credit = $(".lbs-credit", root);
    if (credit) credit.hidden = !(wall.level === "wall" && (Object.keys(logoIndex.films).length || (logoShared && Object.keys(logoShared).length)));
  }

  // The tip: poster + title for the spine under the pointer.
  function showTip(i, sx, sy) {
    const tip = $(".lbs-tip", root);
    if (!tip) return;
    if (i == null) { tip.hidden = true; return; }
    const f = wall.lay.films[i];
    const cached = posterCache.get(f.slug);
    tip.innerHTML =
      `<img src="${cached ? esc(cached[0]) : EMPTY}" alt="" width="70" height="105">` +
      `<div><b>${esc(titleOf(f.name))}</b><span>${f.year || ""}</span><small>${esc(pathOf(f.sub).join(" › "))}</small>${frFor(f.slug) ? `<small class="-fr">Franchise · ${esc(frFor(f.slug).name)}</small>` : ""}` +
      `<a href="/film/${esc(f.slug)}/" target="_blank" rel="noopener">Open on Letterboxd ↗</a><em>Drag to a folder to re-file${logoEntry(f.slug)?.[0] ? " · right-click for other logos" : ""}</em></div>`;
    if (!cached) posterFor(f.slug).then(([u]) => { const im = tip.querySelector("img"); if (im && wall.hover === i) corsSrc(im, u); }).catch(() => {});
    const st = $(".lbs-stage", root).getBoundingClientRect();
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.min(sx + 18, st.width - tw - 8)}px`;
    tip.style.top = `${Math.max(8, Math.min(sy - th / 2, st.height - th - 8))}px`;
  }

  function showStage() {
    const stage = $(".lbs-stage", root);
    if (!stage) return;
    stage.hidden = false;
    // One room: the wall is the only view.
    wall.level = "wall";
    const canvas = $(".lbs-canvas", root);
    canvas.hidden = false;
    $(".lbs-zoom", root).hidden = false;
    {
      runColorJob();
      loadSharedLogos();
      loadSharedHouse();
      loadSharedEdits();
      const fresh = wall.canvas !== canvas;
      wall.canvas = canvas;
      buildLayout();
      if (fresh) { bindCanvas(canvas); requestAnimationFrame(fit); }
      else drawSoon();
    }
    renderStagePath();
    renderTray();
  }

  function bindCanvas(c) {
    let pan = null;
    c.addEventListener("wheel", (e) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) return zoomAt(Math.exp(-e.deltaY * 0.0045), e.offsetX, e.offsetY);
      const k = e.deltaMode === 1 ? 30 : 1;
      let dx = e.deltaX * k, dy = e.deltaY * k;
      // A plain mouse wheel walks sideways when the wall already fits top to bottom.
      if (!e.deltaX && wall.lay.height * wall.cam.z <= c.clientHeight + 4) { dx = dy; dy = 0; }
      wall.cam.x += dx / wall.cam.z;
      wall.cam.y += dy / wall.cam.z;
      drawSoon();
    }, { passive: false });
    c.addEventListener("mousedown", (e) => {
      if (edit.on && e.button === 0 && wall.cam.z < NEAR) {
        const p = toWall(e.offsetX, e.offsetY);
        const { b, s: sh } = bayAt(p);
        const run = wall.lay.runs.find((r) => r.bay === b && r.shelf === sh && p.x >= r.x0 - 4 && p.x <= r.x1 + 4);
        if (run) { e.preventDefault(); wall.grabAt = p.x - run.x0; return grabDown({ kind: "piece", ref: run.ref, from: "wall" }, e); }
      }
      const i = filmAt(e.offsetX, e.offsetY);
      if (e.button === 0 && i != null) {
        // Pick the box up (our own drag, not the browser's, which drags the whole picture).
        const f = wall.lay.films[i];
        e.preventDefault();
        return grabDown({ kind: "dvd", slug: f.slug, name: f.name, from: "wall" }, e);
      }
      if (i != null) return;
      pan = { x: e.clientX, y: e.clientY, moved: 0 };
    });
    window.addEventListener("mousemove", (e) => {
      if (!pan) return;
      const dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      pan.moved += Math.abs(dx) + Math.abs(dy);
      pan.x = e.clientX; pan.y = e.clientY;
      wall.cam.x -= dx / wall.cam.z;
      wall.cam.y -= dy / wall.cam.z;
      drawSoon();
    });
    window.addEventListener("mouseup", (e) => {
      if (!pan) return;
      const clicked = pan.moved < 4 && e.target === c;
      pan = null;
      // A click on a shelf sign: choose how that section is sorted.
      if (clicked) {
        const p = toWall(e.offsetX, e.offsetY);
        const sg = (wall.signs || []).find((q) => p.x >= q.x && p.x <= q.x + q.w && p.y >= q.y && p.y <= q.y + q.h);
        if (sg) return openSortPick(wall.lay.secs[sg.sec], e.offsetX, e.offsetY);
      }
      // Edit mode: click a section to select it.
      if (clicked && edit.on) {
        const p = toWall(e.offsetX, e.offsetY);
        const { b, s: sh } = bayAt(p);
        const run = wall.lay.runs.find((r) => r.bay === b && r.shelf === sh && p.x >= r.x0 && p.x <= r.x1);
        const si = run ? run.sec : -1;
        if (si >= 0) return selectSection(wall.lay.secs[si].id);
      }
      // Click from far or middle: step in toward that spot.
      if (clicked && wall.cam.z < NEAR) {
        const p = toWall(e.offsetX, e.offsetY);
        flyTo(p.x, p.y, wall.cam.z < FAR ? 0.22 : 0.95);
      }
    });
    c.addEventListener("mousemove", (e) => {
      if (pan) return;
      const i = filmAt(e.offsetX, e.offsetY);
      c.style.cursor = i != null ? "grab" : inPile(toWall(e.offsetX, e.offsetY)) ? "pointer" : wall.cam.z < NEAR ? "zoom-in" : "default";
      if (i !== wall.hover) { wall.hover = i; drawSoon(); }
      showTip(i, e.offsetX, e.offsetY);
    });
    c.addEventListener("mouseleave", () => { wall.hover = null; showTip(null); drawSoon(); });
    c.addEventListener("contextmenu", (e) => {
      const i = filmAt(e.offsetX, e.offsetY);
      if (i == null) return;
      e.preventDefault();
      showTip(null);
      const f = wall.lay.films[i];
      openFilmMenu(f.slug, f.name, e.clientX, e.clientY);
    });
    c.addEventListener("click", (e) => {
      if (wall.dragged) { wall.dragged = false; return; }
      if (edit.on) return;
      const i = filmAt(e.offsetX, e.offsetY);
      if (i != null) {
        showTip(null);
        openFilm(wall.lay.films[i].slug, wall.lay.films[i].name);
        return;
      }
      // The pile of uncategorized films: open them in the Library.
      if (inPile(toWall(e.offsetX, e.offsetY))) return openUncategorized();
      // A franchise sticker on the back wall: edit its colour and title art.
      const p = toWall(e.offsetX, e.offsetY);
      const st = (wall.lay.stickers || []).find((q) => p.x >= q.x0 - 2 && p.x <= q.x1 + 2 && p.y <= q.y && p.y >= q.y - (WU.shelfH - WU.lip));
      if (st && st.id) { const fr = allFranchises()[st.id]; if (fr) { openFranchise(fr.films[0][0], fr.films[0][1]); ui.fr.sticker = true; renderFranchise(); } }
    });
    c.tabIndex = 0;
    c.addEventListener("keydown", (e) => {
      const k = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (k) { e.preventDefault(); wall.cam.x += (k[0] * 300) / wall.cam.z; wall.cam.y += (k[1] * 200) / wall.cam.z; drawSoon(); }
      else if (e.key === "+" || e.key === "=") zoomAt(1.4, c.clientWidth / 2, c.clientHeight / 2);
      else if (e.key === "-") zoomAt(1 / 1.4, c.clientWidth / 2, c.clientHeight / 2);
    });
    let lastK = 0;
    new ResizeObserver(() => {
      if (!wall.lay) return;
      lastK = wall.lay.k;
      buildLayout();
      if (wall.lay.k !== lastK) fit();
      else drawSoon();
    }).observe(c);
  }

  /* ---------------- browsing (everyone) ----------------
   * The wall fills the screen. Find films from the search box (top right),
   * click a spine for the full box and its details, carry films around in
   * your inventory (the tab at the bottom). Taking a film off the shelf is
   * just for you and doesn't change the store. */
  const ui = { film: null, pane: null, details: new Map(), pocket: false, sortFilm: null, sortFolder: STOCKED, sortAdding: null, findSeq: 0, card: null };

  async function filmDetails(slug) {
    if (ui.details.has(slug)) return ui.details.get(slug);
    const p = fetch(`/film/${slug}/`, { credentials: "include" })
      .then((r) => r.text())
      .then((t) => {
        const d = new DOMParser().parseFromString(t, "text/html");
        const meta = (sel) => d.querySelector(sel)?.getAttribute("content") || "";
        const dirLabel = meta('meta[name="twitter:label1"]');
        return {
          director: /direct/i.test(dirLabel) ? meta('meta[name="twitter:data1"]') : "",
          rating: meta('meta[name="twitter:data2"]').replace(" out of 5", ""),
          synopsis: meta('meta[property="og:description"]') || meta('meta[name="description"]'),
          tagline: (d.querySelector(".tagline")?.textContent || "").trim(),
          runtime: ((d.querySelector(".text-footer")?.textContent || "").match(/(\d+)\s*mins?/) || [])[1] || "",
          cast: [...d.querySelectorAll(".cast-list a.text-slug, .cast-list a")].map((a) => a.textContent.trim()).filter(Boolean).slice(0, 6),
          // The main other title: Letterboxd shows it right under the film's
          // name (the original-language title, e.g. "El habitante").
          original: (d.querySelector("h2.originalname")?.textContent || "").trim(),
          originalLang: d.querySelector("h2.originalname")?.getAttribute("lang") || "",
          // Letterboxd's ids for this film, for Watched / Like / Watchlist.
          ...(() => {
            for (const sel of ["[data-watchable]", "[data-likeable-identifier]", "[data-watchlistable-identifier]", "[data-postered-identifier]"]) {
              const el = d.querySelector(sel);
              if (!el) continue;
              try { const j = JSON.parse(el.getAttribute(sel.slice(1, -1))); if (j && j.lid) return { lid: j.lid, uid: j.uid || "" }; } catch {}
            }
            const m = t.match(/"lid":"([A-Za-z0-9]+)"[^}]*?"uid":"(film:\d+)"/);
            return m ? { lid: m[1], uid: m[2] } : {};
          })(),
        };
      })
      .catch(() => ({}));
    ui.details.set(slug, p);
    return p;
  }
  const caseName = (y) => FORMATS.find(([k]) => k === fmtOf(y))[1];
  const whereIs = (slug) => { const sub = lib.place.get(slug); return sub && lib.subs.has(sub) ? pathOf(sub) : null; };
  const filmActs = (slug, name, extra = "") => {
    const a = (act, label, cls = "") => `<button type="button" class="lbs-fact ${cls}" data-act="${act}" data-slug="${esc(slug)}" data-name="${esc(name)}">${label}</button>`;
    if (!lib.place.has(slug)) {
      const done = mine.requested && mine.requested[slug];
      return `<div class="lbs-facts">${extra}${done ? `<span class="lbs-fact -done">Addition requested ✓</span>` : a("req-add", "Request addition", "-go")}</div>`;
    }
    return `<div class="lbs-facts">${extra}${a("f-hold", "Add to inventory")}${a("f-jump", "Jump to section")}${a("f-edit", "Edit")}${a("f-sort", "Sort")}</div>`;
  };

  // The box itself: front cover facing you, spine and top in perspective.
  function boxHTML(slug, name, big) {
    const y = yearOf(name), own = colorOf(slug);
    // A film can, lid facing you: the poster pasted across the lid corner to
    // corner, the steel showing round it, and the rim curving away on the left.
    if (isCan(y)) {
      const D = big ? 330 : 170, dpr = Math.min(2, window.devicePixelRatio || 1);
      return `<canvas class="lbs-can-cv" data-can="${esc(slug)}" data-name="${esc(name)}" data-tape="${own ? `#${own.slice(0, 6)}` : "#c9b58a"}" data-big="${big ? 1 : ""}" width="${Math.round(D * 0.95 * dpr)}" height="${Math.round(D * dpr)}" style="width:${Math.round(D * 0.95)}px;height:${D}px"></canvas>`;
    }
    const spine = own ? `#${own.slice(0, 6)}` : "#2c3440";
    // The cover art (2:3) fills the paper area exactly; the case is as wide as that.
    const h = big ? 330 : 170, inset = big ? 7 : 4, w = Math.round(((h - 2 * inset) * 2) / 3), d = Math.round(({ can: 0.2, vhs: 0.2, dvd: 0.12, bluray: 0.1 })[fmtOf(y)] * w * 1.4);
    const ink = own && lum(rgbOf(own)) > 0.62 ? "#14181c" : "#fff";
    const lp = logoPath(slug);
    const wash = (mine.wash && mine.wash[slug]) || shared.wash[slug];
    const logoEl = lp
      ? wash
        ? `<span class="lbs-spine-logo -wash" data-src="${TMDB_IMG}w300/${esc(lp)}" style="--logo:url(${TMDB_IMG}w300/${esc(lp)});background:${esc(wash)}"></span>`
        : `<img class="lbs-spine-logo" data-src="${TMDB_IMG}w300/${esc(lp)}" src="${TMDB_IMG}w300/${esc(lp)}" alt="" crossorigin="anonymous">`
      : `<b${wash ? ` style="color:${esc(wash)}"` : ""}>${esc(titleOf(name))}</b>`;
    return (
      `<div class="lbs-box" style="--w:${w}px;--h:${h}px;--d:${d}px;--in:${inset}px;--spine:${spine};--top:${caseTop(y)};--ink:${ink}">` +
      `<div class="lbs-box3d">` +
      `<div class="lbs-face -front"><img data-poster="${esc(slug)}" alt=""></div>` +
      `<div class="lbs-face -spine"><div class="lbs-spine-paper">${logoEl}<span class="lbs-spine-year">${y || ""}</span></div></div>` +
      `<div class="lbs-face -top"><i></i></div>` +
      `</div></div>`
    );
  }
  function fillPosters(el, big) {
    el.querySelectorAll("img[data-poster]").forEach((im) => posterFor(im.dataset.poster).then(([a, b]) => corsSrc(im, big ? b || a : a)).catch(() => {}));
    // Film cans in the film view: draw the can, then again once the poster is in.
    el.querySelectorAll("canvas.lbs-can-cv").forEach((cv) => {
      const name = cv.dataset.name || (lib && lib.names.get(cv.dataset.can)) || cv.dataset.can;
      const f = { slug: cv.dataset.can, name, year: yearOf(name) };
      cv._f = f;
      drawCanBig(cv, null, cv.dataset.tape, f);
      posterFor(cv.dataset.can).then(([a, b]) => {
        const im = new Image();
        im.onload = () => { cv._poster = im; drawCanBig(cv, im, cv.dataset.tape, f); };
        corsSrc(im, cv.dataset.big ? b || a : a);
      }).catch(() => {});
    });
    // A spine logo that's taller than it is wide stays upright.
    el.querySelectorAll(".lbs-spine-logo[data-src]").forEach((lg) => {
      const probe = new Image();
      probe.onload = () => lg.classList.toggle("-upright", probe.naturalHeight > probe.naturalWidth);
      probe.src = lg.dataset.src;
    });
  }

  async function openFilm(slug, name) {
    ui.film = { slug, name };
    ui.pane = null;
    renderFilm();
    const det = await filmDetails(slug);
    if (ui.film && ui.film.slug === slug) renderFilm(det);
  }
  function closeFilm() {
    ui.film = null;
    const v = root && $(".lbs-filmview", root);
    if (v) v.hidden = true;
  }
  function renderFilm(det) {
    const v = $(".lbs-filmview", root);
    if (!v || !ui.film) return;
    const { slug, name } = ui.film;
    const y = yearOf(name), path = whereIs(slug);
    if (det) ui.film.det = det;
    det = ui.film.det || {};
    const e = logoEntry(slug);
    let pane = "";
    if (ui.pane === "edit") {
      const own = colorOf(slug);
      const cur = logoPath(slug);
      const list = ui.logos && ui.logos.slug === slug ? ui.logos.list : null;
      if (!list) allLogos(slug).then((l) => { ui.logos = { slug, list: l }; if (ui.film && ui.film.slug === slug && ui.pane === "edit") renderFilm(); });
      pane =
        `<div class="lbs-fpane"><b>Edit this box</b>` +
        `<label class="lbs-fcolor">Case colour ${swatchHTML("lbs-f-color", `#${own ? own.slice(0, 6) : "2c3440"}`, `data-slug="${esc(slug)}"`)}` +
        (mine.colors[slug] ? `<button type="button" data-act="f-color-reset" data-slug="${esc(slug)}">Use the poster's colour</button>` : "") + `</label>` +
        `<div class="lbs-flogos">` +
        (list ? list.map((pth, n) => `<button type="button" data-act="logo-pick" data-slug="${esc(slug)}" data-path="${esc(pth)}" class="${cur === pth ? "-on" : ""}"><img src="${TMDB_IMG}w185/${esc(pth)}" alt="Logo ${n + 1}" loading="lazy"></button>`).join("") : `<p class="lbs-fwait">Fetching every logo from TMDB…</p>`) +
        `<button type="button" data-act="logo-pick" data-slug="${esc(slug)}" data-path="-1" class="-plain${cur === null ? " -on" : ""}">Plain title</button>` +
        `</div>` +
        `<label class="lbs-fwash"><input type="checkbox" class="lbs-f-wash" data-slug="${esc(slug)}"${mine.wash && mine.wash[slug] ? " checked" : ""}> Logo colour wash ${swatchHTML("lbs-f-washc", (mine.wash && mine.wash[slug]) || "#ffffff", `data-slug="${esc(slug)}"`, !(mine.wash && mine.wash[slug]))}</label>` +
        (e && e[0] ? `<a class="lbs-fmore" href="https://www.themoviedb.org/movie/${e[0]}/images/logos" target="_blank" rel="noopener">Upload more on TMDB ↗</a>` : "") +
        `</div>`;
    }
    v.innerHTML =
      `<div class="lbs-fwrap" role="dialog" aria-label="${esc(titleOf(name))}">` +
      `<button type="button" class="lbs-fclose" data-act="f-close" aria-label="Close">${ICON_CLOSE}</button>` +
      `<div class="lbs-fbox">${boxHTML(slug, name, true)}</div>` +
      `<div class="lbs-finfo">` +
      `<h2>${esc(titleOf(name))} <span>${y || ""}</span></h2>` +
      (det.original && det.original.toLowerCase() !== titleOf(name).toLowerCase() ? `<p class="lbs-forig" lang="${esc(det.originalLang || "")}">${esc(det.original)}</p>` : "") +
      `<p class="lbs-fmeta">${[det.director && `Directed by <b>${esc(det.director)}</b>`, det.runtime && `${det.runtime} min`, det.rating && `★ ${esc(det.rating)}`, caseName(y)].filter(Boolean).join(" · ")}</p>` +
      (det.tagline ? `<p class="lbs-ftag">${esc(det.tagline)}</p>` : "") +
      (det.synopsis ? `<p class="lbs-fsyn">${esc(det.synopsis)}</p>` : !ui.film.det ? `<p class="lbs-fsyn -wait">Loading details…</p>` : "") +
      (det.cast && det.cast.length ? `<p class="lbs-fcast">With ${det.cast.map(esc).join(", ")}</p>` : "") +
      `<p class="lbs-fwhere">${path ? (path[0] === "Uncategorized" ? "In the <b>Uncategorized</b> pile" : `On the shelf in <b>${path.map(esc).join(" › ")}</b>`) : "Not in the store yet"}${frBadge(slug)}</p>` +
      lbRowHTML(slug, name, det) +
      filmActs(slug, name) +
      pane +
      `</div></div>`;
    v.hidden = false;
    fillPosters(v, true);
    if (det.lid && !ui.film.me && !ui.film.meAsked) lbState(slug, det.lid);
  }

  /* Letterboxd's own buttons, for the film you're looking at: Watched, Like,
   * Watchlist, Block (our "Not interested" list), and more on Letterboxd. */
  const signedIn = () => !document.body.classList.contains("logged-out") && !!(window.person && window.person.username || document.querySelector(".nav-account"));
  const LB_ICONS = {
    watch: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.6-6.5 10-6.5S22 12 22 12s-3.6 6.5-10 6.5S2 12 2 12z" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/></svg>`,
    like: `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5s-7.5-4.6-9.2-9.4C1.7 7.8 4 4.5 7.4 4.5c2 0 3.4 1.1 4.6 2.7 1.2-1.6 2.6-2.7 4.6-2.7 3.4 0 5.7 3.3 4.6 6.6-1.7 4.8-9.2 9.4-9.2 9.4z" fill="currentColor"/></svg>`,
    wl: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>`,
    block: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M6 6l12 12" stroke="currentColor" stroke-width="2.2"/></svg>`,
    more: `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="5.5" cy="12" r="2" fill="currentColor"/><circle cx="12" cy="12" r="2" fill="currentColor"/><circle cx="18.5" cy="12" r="2" fill="currentColor"/></svg>`,
  };
  function lbRowHTML(slug, name, det) {
    const me = (ui.film && ui.film.slug === slug && ui.film.me) || {};
    const ni = window.lbNotInterested;
    const blocked = ni && ni.isBlocked ? ni.isBlocked({ lid: det.lid, slug }) : false;
    const ok = signedIn() && det.lid;
    const b = (act, icon, label, on, cls) => `<button type="button" class="lbs-lb ${cls}${on ? " -on" : ""}" data-act="${act}" data-slug="${esc(slug)}" data-name="${esc(name)}" aria-pressed="${!!on}"${ok ? "" : " disabled"} title="${label}">${LB_ICONS[icon]}<span>${label}</span></button>`;
    return (
      `<div class="lbs-lbrow">` +
      b("lb-watch", "watch", me.watched ? "Watched" : "Watch", me.watched, "-watch") +
      b("lb-like", "like", me.liked ? "Liked" : "Like", me.liked, "-like") +
      b("lb-wl", "wl", "Watchlist", me.inWatchlist, "-wl") +
      (ni && ni.toggle ? b("lb-block", "block", blocked ? "Blocked" : "Block", blocked, "-block") : "") +
      `<span class="lbs-lb-wrap"><button type="button" class="lbs-lb -more" data-act="lb-more" aria-haspopup="menu" title="More">${LB_ICONS.more}<span>More</span></button>` +
      `<div class="lbs-lb-menu lbs-menu" role="menu" hidden>` +
      `<a href="/film/${esc(slug)}/" target="_blank" rel="noopener">Rate, review or log ↗</a>` +
      `<a href="/film/${esc(slug)}/" target="_blank" rel="noopener">Add to lists ↗</a>` +
      `<a href="/film/${esc(slug)}/" target="_blank" rel="noopener">Open on Letterboxd ↗</a>` +
      (lib.place.has(slug) ? `<button type="button" data-act="req-remove-this" data-slug="${esc(slug)}" data-name="${esc(name)}">Request removal from the store</button>` : "") +
      `</div></span>` +
      `</div>` +
      (ok || !det.lid ? "" : `<p class="lbs-lbnote">Sign in to Letterboxd to use these.</p>`)
    );
  }
  const lbCsrf = () => window.supermodelCSRF || document.querySelector("input[name='__csrf']")?.value || "";
  async function lbState(slug, lid) {
    ui.film.meAsked = true;
    try {
      const r = await fetch(`/api/v0/production/${encodeURIComponent(lid)}/me`, { credentials: "include", headers: { Accept: "application/json" } });
      const d = r.ok ? await r.json() : null;
      if (d && ui.film && ui.film.slug === slug) {
        ui.film.me = { watched: !!d.watched, liked: !!d.liked, inWatchlist: !!d.inWatchlist };
        renderFilm();
      }
    } catch {}
  }
  async function lbAction(act, btn) {
    if (!ui.film || btn.disabled) return;
    const { slug, name } = ui.film, det = ui.film.det || {};
    if (!det.lid) return;
    const me = (ui.film.me = ui.film.me || {});
    const was = { ...me };
    const form = (path, field, v) => {
      const body = new URLSearchParams();
      body.append(field, String(v));
      body.append("__csrf", lbCsrf());
      return fetch(path, { method: "POST", credentials: "include", body, headers: { "Content-Type": "application/x-www-form-urlencoded", "X-CSRF-TOKEN": lbCsrf() } });
    };
    try {
      let r;
      if (act === "lb-block") {
        btn.disabled = true;
        await window.lbNotInterested.toggle({ lid: det.lid, slug, name: titleOf(name) });
        drawSoon();
        return renderFilm();
      }
      if (act === "lb-watch") {
        me.watched = !was.watched;
        if (!me.watched) me.liked = false;
        renderFilm();
        r = await form(`/s/${det.uid}/watch/`, "watched", me.watched);
      } else if (act === "lb-like") {
        me.liked = !was.liked;
        if (me.liked) me.watched = true;
        renderFilm();
        r = await form(`/s/${det.uid}/like/`, "liked", me.liked);
      } else if (act === "lb-wl") {
        me.inWatchlist = !was.inWatchlist;
        renderFilm();
        r = await fetch(`/api/v0/me/watchlist/${encodeURIComponent(det.lid)}`, { method: "PATCH", credentials: "include", headers: { Accept: "application/json", "Content-Type": "application/json; charset=UTF-8", "X-CSRF-TOKEN": lbCsrf() }, body: JSON.stringify({ inWatchlist: me.inWatchlist }) });
      }
      if (r && !r.ok) throw new Error(`HTTP ${r.status}`);
    } catch (err) {
      ui.film.me = was;
      renderFilm();
      toast(`Letterboxd didn't take that (${err.message || "error"}). Try it on the film's page.`);
    }
  }

  // Inventory (browsing): a drawer that slides up from the tab at the bottom.
  // Each film: drag its cover anywhere (a shelf, a folder), or Put Back / Details.
  function renderPocket() {
    const pk = root && $(".lbs-pocket", root);
    const tab = root && $(".lbs-pocket-tab", root);
    if (!pk || !tab) return;
    const held = mine.held || [];
    tab.querySelector("em").textContent = held.length ? fmt(held.length) : "";
    tab.classList.toggle("-open", ui.pocket);
    pk.hidden = !ui.pocket || edit.on;
    if (pk.hidden) return;
    const b = (act, label, slug, name, cls = "") => `<button type="button" class="${cls}" data-act="${act}" data-slug="${esc(slug)}" data-name="${esc(name)}">${label}</button>`;
    pk.innerHTML =
      `<div class="lbs-pocket-top"><b>Inventory</b><span>${held.length ? "Drag a cover onto any shelf to put it there." : "Drag films off the shelves to carry them around. It doesn't change the store."}</span>` +
      `<label class="lbs-pocket-auto" title="Close the inventory when you click somewhere else"><input type="checkbox" data-set="autoCollapse"${mine.autoCollapse !== false ? " checked" : ""}> Auto collapse</label>` +
      `<button type="button" data-act="pocket">Close</button></div>` +
      `<div class="lbs-pocket-list lbs-tray-drop">` +
      held.map(([slug, name]) =>
        `<div class="lbs-pk" data-slug="${esc(slug)}" data-name="${esc(name)}" title="Drag onto a shelf">` +
        `<img data-poster="${esc(slug)}" alt="" draggable="false"><b>${esc(titleOf(name))}</b>` +
        `<div class="lbs-pk-acts">${b("f-return", "Put Back", slug, name, "-back")}${b("f-open", "Details", slug, name)}</div>` +
        `</div>`).join("") +
      `</div>`;
    fillPosters(pk, false);
  }
  // Click anywhere else and the inventory tucks itself away (unless you'd rather it didn't).
  function maybeCollapsePocket(e) {
    if (!ui.pocket || mine.autoCollapse === false || (grab && grab.live)) return;
    if (e.target.closest && e.target.closest(".lbs-pocket, .lbs-pocket-tab, .lbs-ask, .lbs-filmview, .lbs-library")) return;
    ui.pocket = false;
    renderPocket();
  }

  // The settings menu (top right).
  function renderSettings() {
    const box = root && $(".lbs-settings", root);
    if (!box || box.hidden) return;
    const chk = (key, on, label, sub) => `<label class="lbs-menu-row"><input type="checkbox" data-set="${key}"${on ? " checked" : ""}><span>${label}${sub ? `<small>${sub}</small>` : ""}</span></label>`;
    const n = Object.keys(mine.place).length;
    box.innerHTML =
      `<h6>Shelves</h6>` +
      `<div class="lbs-menu-seg" role="group" aria-label="Whose shelves"><button type="button" data-view="community" class="${mine.view !== "mine" ? "-on" : ""}">Community</button><button type="button" data-view="mine" class="${mine.view === "mine" ? "-on" : ""}">Mine${n ? ` <em>${fmt(n)}</em>` : ""}</button></div>` +
      chk("hideBlocked", !!mine.hideBlocked, "Hide blocked films", "Their spot on the shelf stays empty") +
      chk("noDates", !mine.noDates, "Years on spines", "The release year at the foot of every box") +
      chk("overlay", !!mine.overlay, "Section colours from afar", "Colour and name each section when zoomed out") +
      `<h6>Formats</h6>` + formatsHTML() +
      `<h6>Inventory</h6>` +
      chk("autoCollapse", mine.autoCollapse !== false, "Auto collapse", "Closes when you click somewhere else") +
      `<h6>Your store</h6>` +
      `<p class="lbs-menu-note">Your shelves, picks and inventory live in this browser. Back them up before clearing your browser's data.</p>` +
      `<div class="lbs-menu-btns"><button type="button" data-act="mine-save">Back up</button><label class="lbs-restore">Restore<input type="file" accept="application/json,.json" class="lbs-restore-file" hidden></label></div>` +
      (DEV_TOOLS ? `<h6>Developer</h6><div class="lbs-menu-btns"><button type="button" data-act="logo-build">${logoJob.running ? `Logos ${fmt(logoJob.done)} / ${fmt(logoJob.total)}` : "Logo builder…"}</button><button type="button" data-act="cat-build">${catJob.running ? "Catalogue: running" : "Catalogue builder…"}</button></div>` : "");
  }
  // Formats: each on or off, each with the last year it covers. The last one
  // switched on covers everything after, so its cutoff is greyed out (as is
  // the only one, when only one is on). Blu-ray never has a cutoff.
  function formatsHTML() {
    const plan = formatPlan(), last = plan[plan.length - 1][0];
    return `<div class="lbs-fmts">` + FORMATS.map(([k, label, def]) => {
      const set = (mine.formats || {})[k] || {};
      const on = set.on !== false;
      const to = set.to || def;
      const fixed = k === "bluray" || !on || k === last;
      return `<label class="lbs-fmt${on ? "" : " -off"}"><input type="checkbox" data-fmt="${k}"${on ? " checked" : ""}><span>${label}</span>` +
        (k === "bluray" ? `<em>and after</em>` : `<em>through</em><input type="number" class="lbs-fmt-to" data-fmt-to="${k}" min="1880" max="2100" step="1" value="${to}"${fixed ? " disabled" : ""}>`) +
        `</label>`;
    }).join("") + `</div>`;
  }
  function setFormat(k, patch) {
    const all = (mine.formats = mine.formats || {});
    const next = { ...(all[k] || {}), ...patch };
    // never all off
    if (next.on === false && FORMATS.filter(([x]) => x !== k && (all[x] ? all[x].on !== false : true)).length === 0) return renderSettings();
    all[k] = next;
    saveMine();
    fmtPlan = null;
    paintVer++;
    canLabels.clear();
    const was = document.activeElement && document.activeElement.dataset && document.activeElement.dataset.fmtTo;
    refresh();
    renderSettings();
    drawSoon();
    if (was) { const el = root.querySelector(`[data-fmt-to="${was}"]`); if (el && !el.disabled) el.focus(); }
  }
  function toggleMenu(sel, open) {
    root.querySelectorAll(".lbs-menu").forEach((m) => { if (!m.matches(sel)) m.hidden = true; });
    const m = $(sel, root);
    if (!m) return;
    m.hidden = open == null ? !m.hidden : !open;
    if (!m.hidden) { $(".lbs-find-list", root).hidden = true; $(".lbs-card", root).hidden = true; }
    if (sel === ".lbs-settings") renderSettings();
  }
  // Films you've blocked (the "Not interested" list), when they're hidden.
  const blockedSet = () => (mine.hideBlocked && window.lbNotInterested && window.lbNotInterested.blocked ? window.lbNotInterested.blocked() : null);

  // Your own store (shelves you moved things to, picks, franchises,
  // inventory) lives in this browser. A backup file keeps it safe.
  function backupMine() {
    const data = { app: "LetterBloxd", kind: "my-store", v: 1, at: new Date().toISOString(), mine, logoPicks };
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: "application/json" }));
    a.download = `letterbloxd-my-store-${data.at.slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }
  function restoreMine(file) {
    const rd = new FileReader();
    rd.onload = () => {
      let data;
      try { data = JSON.parse(rd.result); } catch { return toast("That file isn't a LetterBloxd backup."); }
      if (!data || data.kind !== "my-store" || !data.mine) return toast("That file isn't a LetterBloxd backup.");
      ask(`Replace your store with the backup from <b>${esc(String(data.at || "").slice(0, 10))}</b>?`, () => {
        mine = { place: {}, cats: {}, subs: {}, recent: [], view: "community", sort: {}, held: [], colors: {}, wash: {}, ...data.mine };
        saveMine();
        for (const k of Object.keys(logoPicks)) delete logoPicks[k];
        Object.assign(logoPicks, data.logoPicks || {});
        writeJSON(LOGO_PICK_KEY, logoPicks);
        refresh();
        toast("Your store is back.");
      }, "Yes, restore");
    };
    rd.readAsText(file);
  }

  function openUncategorized() {
    libUI.path = [UNCAT];
    libUI.sel = null;
    if (lv.mode === "list") { lv.f = { sgenre: { [UNCAT]: 1 } }; saveLv(); }
    setLibrary(true);
  }
  // Fly to a film on the wall and make it blink.
  function jumpTo(slug, name) {
    closeFilm();
    $(".lbs-card", root) && ($(".lbs-card", root).hidden = true);
    if (desk.mode !== "store") { desk.mode = "store"; renderDesk(); }
    if (wall.level !== "wall") { wall.level = "wall"; showStage(); }
    requestAnimationFrame(() => {
      const L = wall.lay, i = L && L.idx.get(slug);
      if (i == null && L && L.pile && lib.place.get(slug) === UNCAT_SUB) { const P = L.pile; return flyTo(P.x + P.w / 2, P.y + P.h / 2, 0.35); }
      if (i == null) return toast(`‘${titleOf(name || slug)}’ isn't on the shelves yet.`);
      const f = L.films[i];
      flyTo(f.x + f.w / 2, f.y - f.h / 2, 1.3);
      wall.flash = { i, until: performance.now() + 2400 };
      const tick = () => { drawSoon(); if (wall.flash && performance.now() < wall.flash.until) setTimeout(tick, 120); else { wall.flash = null; drawSoon(); } };
      tick();
    });
  }

  /* ---------------- the Library ----------------
   * Every folder and film in the store, in columns like a Finder window:
   * the folder you're in on the right, the one above it on the left, and a
   * back arrow to go up. Genre › Category › Subcat › Niche. Subcats list
   * their niches first, then their own films; niches list their films.
   * It stays open beside the wall (everything else shifts left). Select a
   * film, open the folder it should live in, and Move here, or drag it onto
   * a folder. Drag films into your inventory. "Sort" on any film just opens
   * the Library on that film. */
  // sel: the selected film (what Move here moves). focus: whatever you clicked
  // last, a film or a folder: that's where Jump to section takes you.
  const LIB_VMAX = 150, LIB_VROW = 42; // past this many, a column draws only the rows in view
  const libUI = { open: !!mine.libOpen, path: [STOCKED], sel: null, focus: null, adding: null };
  function kidsOf(id) {
    if (!id) return { folders: [...lib.genres.keys()], films: [] };
    if (id === UNCAT) return { folders: [], films: lib.inSub.get(UNCAT_SUB) || [] };
    if (String(id).startsWith("fr:")) { const fr = lib.frs[id.slice(3)]; return { folders: [], films: fr ? fr.films.filter(([x]) => lib.place.has(x)).map(([x, n]) => [x, lib.names.get(x) || n]) : [] }; }
    const p = partsOf(id);
    if (p.niche) return { folders: [], films: lib.inSub.get(id) || [] };
    if (p.sub) return { folders: (lib.subs.get(id).niches || []).slice(), films: lib.inSub.get(id) || [] };
    if (p.cat) return { folders: lib.cats.get(id).subs.slice(), films: [] };
    if (p.genre) return { folders: lib.genres.get(id).cats.slice(), films: [] };
    return { folders: [], films: [] };
  }
  const childLevel = (id) => { if (!id || id === UNCAT) return null; const p = partsOf(id); return p.niche ? null : p.sub ? "niche" : p.cat ? "sub" : p.genre ? "cat" : null; };
  const LEVEL_WORD = { genre: "genre", cat: "category", sub: "subcat", niche: "niche" };
  let libIo = null;

  function setLibrary(open) {
    libUI.open = open;
    mine.libOpen = open;
    saveMine();
    renderLibrary();
  }
  // Open the Library on a film: its folder open, the film highlighted.
  function openLibraryAt(slug, name) {
    lv.mode = "folders";
    const p = partsOf(lib.place.get(slug));
    libUI.path = [p.genre, p.cat, p.sub, p.niche].filter(Boolean);
    if (!libUI.path.length) libUI.path = [STOCKED];
    libUI.sel = [slug, name || lib.names.get(slug) || slug];
    libUI.focus = { film: libUI.sel };
    setLibrary(true);
    requestAnimationFrame(() => {
      const el = root.querySelector(`.lbs-library [data-film="${CSS.escape(slug)}"]`);
      if (el) return el.scrollIntoView({ block: "center" });
      // a long column: scroll to where the film's row will be drawn
      const wrap = root.querySelector('.lbs-library .lbs-lib-vwrap[data-side="right"]');
      const items = libUI.vcols.right, n = items && items.slugs ? items.slugs.indexOf(slug) : -1;
      if (wrap && n >= 0) { const ul = wrap.closest("ul"); ul.scrollTop = wrap.offsetTop + n * LIB_VROW - ul.clientHeight / 2; }
    });
  }
  function renderLibrary() {
    const box = root && $(".lbs-library", root);
    if (!box || !lib) return;
    root.classList.toggle("lbs-lib-open", libUI.open);
    root.querySelectorAll(".lbs-lib-btn").forEach((b) => b.classList.toggle("-on", libUI.open));
    box.hidden = !libUI.open;
    if (!libUI.open) return;
    if (lv.mode === "list") return renderListView(box);
    box.dataset.mode = "folders";
    libUI.path = libUI.path.filter((id) => lib.genres.has(id) || lib.cats.has(id) || lib.subs.has(id) || (String(id).startsWith("fr:") && lib.frs[id.slice(3)]));
    const path = libUI.path;
    const right = path.length ? path[path.length - 1] : null;
    const left = path.length >= 2 ? path[path.length - 2] : null;
    const held = new Set((mine.held || []).map(([x]) => x));
    const sel = libUI.sel;
    const selAt = sel ? lib.place.get(sel[0]) : null;
    const selPath = selAt ? (() => { const p = partsOf(selAt); return [p.genre, p.cat, p.sub, p.niche].filter(Boolean); })() : [];
    const canDel = (id) => edit.on && id !== UNCAT && id !== UNCAT_CAT && !/\/general$/.test(id);
    const folderRow = (id, side) =>
      `<li class="lbs-lib-row lbs-folder${path.includes(id) ? " -on" : ""}" data-act="lib-open" data-side="${side}" data-id="${esc(id)}" data-drop="${esc(id)}">` +
      `${ICON_FOLDER}<span>${esc(nameOf(id))}</span>` +
      (selPath.includes(id) ? `<em>here</em>` : "") +
      `<small>${fmt(lib.count.get(id) || 0)}</small>` +
      (canDel(id) ? `<button type="button" class="lbs-lib-del" data-act="lib-del" data-id="${esc(id)}" aria-label="Delete ${esc(nameOf(id))}" title="Delete">${ICON_CLOSE}</button>` : "") +
      `<b>›</b></li>`;
    const filmRow = ([slug, name]) =>
      `<li class="lbs-lib-row lbs-lib-film${sel && sel[0] === slug ? " -sel" : ""}" data-act="lib-film" data-film="${esc(slug)}" data-slug="${esc(slug)}" data-name="${esc(name)}" title="Drag onto a folder, the wall or your inventory">` +
      `<img data-lp="${esc(slug)}" src="${posterCache.has(slug) ? esc(posterCache.get(slug)[0]) : EMPTY}" alt="" draggable="false"><span>${esc(titleOf(name))}</span><small>${yearOf(name) || ""}</small>` +
      (held.has(slug) ? `<em class="-inv">In inventory</em>` : "") + `</li>`;
    // A franchise is a folder of its own, where its films sit, in franchise order.
    const frRow = (fid, side) => {
      const fr = lib.frs[fid], fidp = `fr:${fid}`;
      return `<li class="lbs-lib-row lbs-folder -fr${path.includes(fidp) ? " -on" : ""}" data-act="lib-open" data-side="${side}" data-id="${esc(fidp)}">` +
        `${ICON_FOLDER}<span>${esc(fr.name)}</span><em class="-frtag">Franchise</em><small>${fmt(fr.films.length)}</small><b>›</b></li>`;
    };
    // Films (and franchise folders) in a column. A long list is drawn only
    // where you're looking (Uncategorized holds tens of thousands).
    libUI.vcols = {};
    const filmItems = (id, films, side) => {
      let items, slugs;
      if (String(id).startsWith("fr:")) { items = films.map((f) => () => filmRow(f)); slugs = films.map((f) => f[0]); }
      else {
        const seen = new Set();
        items = []; slugs = [];
        for (const f of films) {
          const fid = lib.frOf.get(f[0]);
          if (!fid) { items.push(() => filmRow(f)); slugs.push(f[0]); continue; }
          if (seen.has(fid)) continue;
          seen.add(fid);
          items.push(() => frRow(fid, side)); slugs.push(f[0]);
        }
      }
      if (libUI.picking) return ""; // choosing a destination: folders only
      if (items.length <= LIB_VMAX) return items.map((x) => x()).join("");
      libUI.vcols[side] = items;
      items.slugs = slugs;
      return `<li class="lbs-lib-vwrap" data-side="${side}" style="height:${items.length * LIB_VROW}px"></li>`;
    };
    const column = (id, side) => {
      const k = kidsOf(id);
      const lvl = side === "right" || (!id && edit.on) ? (id ? childLevel(id) : edit.on ? "genre" : null) : null;
      const adding = lvl && (id ? libUI.adding === id : libUI.adding === "@root");
      return (
        `<div class="lbs-lib-col -${side}"><h5>${id ? esc(nameOf(id)) : "Genres"}${id ? `<small>${fmt(String(id).startsWith("fr:") ? k.films.length : lib.count.get(id) || 0)} films</small>` : ""}${String(id).startsWith("fr:") ? `<button type="button" class="lbs-frbadge" data-act="fr-open" data-fr="${esc(id.slice(3))}">Edit franchise</button>` : ""}</h5><ul>` +
        k.folders.map((f) => folderRow(f, side)).join("") +
        (lvl ? (adding ? `<li class="lbs-lib-new"><input type="text" class="lbs-lib-new-name" data-level="${lvl}" maxlength="40" placeholder="Name the new ${LEVEL_WORD[lvl]}"></li>` : `<li class="lbs-lib-add"><button type="button" data-act="lib-new">+ New ${LEVEL_WORD[lvl]}</button></li>`) : "") +
        (k.films.length ? (k.folders.length || lvl ? `<li class="lbs-lib-sep">${fmt(k.films.length)} film${k.films.length === 1 ? "" : "s"}</li>` : "") + filmItems(id, k.films, side) : "") +
        (!k.folders.length && !k.films.length && !lvl ? `<li class="lbs-lib-empty">Empty</li>` : "") +
        `</ul></div>`
      );
    };
    const target = right && (!lib.genres.has(right) || right === UNCAT) ? landingSub(right) : null;
    // Jump to: the last thing you clicked (a film, or a folder), else the open folder.
    const focus = libUI.focus && (libUI.focus.film ? (lib.place.has(libUI.focus.film[0]) ? libUI.focus : null) : path.includes(libUI.focus.folder) ? libUI.focus : null) || (right ? { folder: right } : null);
    const jumpOk = focus && (focus.film || inRoom(partsOf(focus.folder).genre));
    const jumpLabel = focus ? (focus.film ? titleOf(focus.film[1]) : nameOf(focus.folder)) : "";
    const jumpBtn = `<button type="button" data-act="lib-jump"${jumpOk ? "" : " disabled"} title="${jumpOk ? `Fly to ${esc(jumpLabel)} on the wall` : ""}">Jump to section</button>`;
    const canMove = sel && target && target !== selAt;
    const pick = libUI.picking;
    const pickTo = pick && right && !String(right).startsWith("fr:") ? landingSub(right) : null;
    box.innerHTML =
      `<div class="lbs-lib-head">` +
      `<button type="button" class="lbs-lib-up" data-act="lib-up" aria-label="Up a level" title="Up a level"${path.length ? "" : " disabled"}>${ICON_LEFT}</button>` + libModeHTML() +
      `<div class="lbs-lib-crumbs"><button type="button" data-act="lib-root">Library</button>${path.map((id, i) => `<i>›</i><button type="button" data-act="lib-to" data-i="${i}" data-drop="${esc(id)}" class="lbs-crumb">${esc(nameOf(id))}</button>`).join("")}</div>` +
      `<button type="button" class="lbs-lib-x" data-act="lib" aria-label="Close the Library">${ICON_CLOSE}</button></div>` +
      (pick ? `<div class="lbs-lib-pick">Moving <b>${pick.films.length === 1 ? esc(titleOf(pick.films[0][1])) : `${fmt(pick.films.length)} films`}</b>: open the folder ${pick.films.length === 1 ? "it belongs" : "they belong"} in${edit.on ? ", or make one" : ", or make a new one"}.</div>` : "") +
      `<div class="lbs-lib-cols">${column(left, "left")}${path.length ? column(right, "right") : `<div class="lbs-lib-col -right"><p class="lbs-lib-hint">Pick a genre</p></div>`}</div>` +
      `<div class="lbs-lib-foot">` +
      (pick
        ? `<div class="lbs-lib-acts"><button type="button" class="-go" data-act="lib-pick-go"${pickTo ? "" : " disabled"}>${pickTo ? `Move ${pick.films.length === 1 ? "it" : `all ${fmt(pick.films.length)}`} to ${esc(pathOf(pickTo).slice(-2).join(" › "))}` : `Open a folder to move ${pick.films.length === 1 ? "it" : "them"} into`}</button>` +
          `<button type="button" data-act="lib-pick-cancel">Cancel</button></div>`
        : sel
        ? `<div class="lbs-lib-sel"><img data-poster="${esc(sel[0])}" alt=""><div><b>${esc(titleOf(sel[1]))}</b> <span>${yearOf(sel[1]) || ""}</span><small>${selAt ? `In ${esc(pathOf(selAt).slice(1).join(" › "))}` : "Not in the store yet"}</small></div>` +
          `<button type="button" class="lbs-lib-x -small" data-act="lib-unsel" aria-label="Deselect">${ICON_CLOSE}</button></div>` +
          `<div class="lbs-lib-acts">` +
          `<button type="button" class="-go" data-act="lib-move"${canMove ? "" : " disabled"} title="${target ? `Move to ${esc(pathOf(target).slice(1).join(" › "))}` : "Open a folder to move it into"}">Move here</button>` +
          `<button type="button" data-act="f-open" data-slug="${esc(sel[0])}" data-name="${esc(sel[1])}">Details</button>` +
          `<button type="button" data-act="lib-fr">${franchiseOf(sel[0]) ? "Franchise" : "Add to franchise"}</button>` +
          jumpBtn +
          `<button type="button" class="-link" data-act="lib-remove">Request removal</button></div>`
        : `<div class="lbs-lib-acts"><p class="lbs-lib-tip">Click a film to select it, then open the folder it belongs in and Move here. Or drag it onto a folder, the wall, or your inventory.</p>` +
          jumpBtn + `</div>`) +
      `</div>`;
    fillPosters($(".lbs-lib-foot", box), false);
    // Posters in the lists load as they scroll into view.
    if (libIo) libIo.disconnect();
    libIo = "IntersectionObserver" in window ? new IntersectionObserver((entries, obs) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        obs.unobserve(e.target);
        const im = e.target;
        if (posterCache.has(im.dataset.lp)) continue;
        posterFor(im.dataset.lp).then(([u]) => corsSrc(im, u)).catch(() => {});
      }
    }, { root: null, rootMargin: "200px" }) : null;
    box.querySelectorAll("img[data-lp]").forEach((im) => libIo && libIo.observe(im));
    // long columns: draw the rows in view, and again as you scroll
    box.querySelectorAll(".lbs-lib-vwrap").forEach((wrap) => {
      const ul = wrap.closest("ul");
      const paint = () => {
        const items = libUI.vcols[wrap.dataset.side] || [];
        const top = ul.scrollTop - wrap.offsetTop;
        const a = Math.max(0, Math.floor(top / LIB_VROW) - 10), b = Math.min(items.length, Math.ceil((top + ul.clientHeight) / LIB_VROW) + 10);
        let html = "";
        for (let n = a; n < b; n++) html += items[n]().replace(/^<li /, `<li style="position:absolute;left:0;right:0;top:${n * LIB_VROW}px;height:${LIB_VROW}px;box-sizing:border-box" `);
        wrap.innerHTML = html;
        wrap.querySelectorAll("img[data-lp]").forEach((im) => libIo && libIo.observe(im));
      };
      paint();
      let raf = 0;
      ul.addEventListener("scroll", () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; paint(); }); });
    });
    const inp = $(".lbs-lib-new-name", box);
    if (inp) inp.focus();
  }
  /* ---------------- the Library's list view ----------------
   * Every film in the store in one list, with the folder it's in on the
   * right. Filters narrow it: each chip cycles include → exclude → off.
   * Inside a group, included values are "any of these"; groups combine with
   * "and"; excluded values are always out. Select films one by one or en
   * masse (bubbles; Shift/Cmd/Option-click; Shift-arrows) and move them
   * all at once. */
  const LV_ROW = 34;
  const lv = {
    mode: (mine.lv && mine.lv.mode) || "folders",
    f: (mine.lv && mine.lv.f) || {}, // group -> { value: 1 | -1 }
    all: (mine.lv && mine.lv.all) || {}, // group -> true: its included chips must ALL match (AND), not any (OR)
    y0: (mine.lv && mine.lv.y0) || "", y1: (mine.lv && mine.lv.y1) || "",
    sort: (mine.lv && mine.lv.sort) || "pop",
    q: "", showFilters: !(mine.lv && mine.lv.hideFilters), more: {}, open: new Set(),
    sel: new Set(), selecting: false, anchor: null, cursor: null,
    base: null, baseKey: null, rows: [], pos: new Map(),
  };
  const saveLv = () => { mine.lv = { mode: lv.mode, f: lv.f, all: lv.all, y0: lv.y0, y1: lv.y1, sort: lv.sort, hideFilters: !lv.showFilters }; saveMine(); };

  // What the catalogue knows about each film: genres, countries, languages,
  // and (once the builder has read film details) runtime and primary language.
  /* The store's Tags: about 150 solid, human-sized tags rolled up from TMDB's
   * hand-made keywords (catalogue.kw). Each is [id, label, pattern]; a film
   * gets the tag when any of its keywords matches the pattern (whole
   * keyword, case-insensitive). Edit freely: no rebuild needed. */
  const KW_TAGS = [
    // Crime & thrillers
    ["heist", "Heist", ".*\\b(?:heist|bank robbery|train robbery|caper|safecracker|robbery)\\b.*"],
    ["gangster", "Gangsters & Mob", "gangster|mafia|mobster|organized crime|crime boss|mafia boss|cosa nostra|the mob|crime family|gang war|crime syndicate"],
    ["yakuza", "Yakuza & Triads", "yakuza|triad|triads"],
    ["con", "Cons & Swindles", "con artist|con man|swindle|swindler|scam|grifter|confidence trick|fraud"],
    ["sexwork", "Sex Work", "prostitute|prostitution|brothel|stripper|strip club|escort|call girl|gigolo|pimp"],
    ["serialkiller", "Serial Killers", "serial killer|serial murder|killing spree"],
    ["hitman", "Hitmen & Assassins", "hitman|hit man|assassin|contract killer|assassination"],
    ["detective", "Detectives", "detective|private detective|private investigator|police detective|sleuth|amateur detective|investigation|murder investigation|criminal investigation"],
    ["whodunit", "Whodunits", "whodunit|murder mystery|locked room mystery"],
    ["noir", "Film Noir", "film noir|noir"],
    ["neonoir", "Neo-Noir", "neo-noir"],
    ["cops", "Cops & Feds", "police|police officer|cop|police corruption|corrupt cop|police procedural|lapd|nypd|undercover cop|fbi|fbi agent|federal agent|police investigation|police brutality|u\\.s\\. marshal"],
    ["buddycop", "Buddy Cops", "buddy cop"],
    ["prison", "Prison", "prison|prison escape|prison break|prisoner|jail|penitentiary|death row|women in prison"],
    ["courtroom", "Courtroom", "courtroom|courtroom drama|trial|lawyer|attorney|defense attorney|jury|legal drama"],
    ["drugs", "Drug Trade", "drug dealer|drug trafficking|drug cartel|cartel|drug lord|cocaine|drug smuggling|narcotics"],
    ["kidnap", "Kidnapping & Hostages", "kidnapping|kidnapped|hostage|hostage situation|abduction|ransom"],
    ["missing", "Missing Persons", "missing person|disappearance|missing child|missing daughter|missing son|missing wife|missing husband"],
    ["ontherun", "On the Run", "on the run|fugitive|manhunt|escaped convict|escape|prison escape|chase"],
    ["revenge", "Revenge", "revenge|vengeance|rape and revenge|revenge killing"],
    ["vigilante", "Vigilantes", "vigilante|vigilantism"],
    ["conspiracy", "Conspiracy", "conspiracy|cover-up|government conspiracy|conspiracy theory"],
    ["erotic", "Erotic Thrillers", "erotic thriller|femme fatale"],
    ["stalker", "Stalkers & Obsession", "stalker|stalking|obsession|obsessive love"],
    ["voyeur", "Voyeurism & Surveillance", "voyeurism|voyeur|surveillance|peeping tom|hidden camera|wiretap"],
    ["homeinvasion", "Home Invasion", "home invasion"],
    // Spies, war, military
    ["spy", "Spies & Espionage", "spy|espionage|secret agent|cia|central intelligence agency \\(cia\\)|kgb|mi6|double agent|british secret service|undercover agent|secret service|spy thriller"],
    ["ww2", "World War II", "world war ii|world war 2|ww2|d-day|battle of britain|pearl harbor"],
    ["ww1", "World War I", "world war i|world war 1|ww1|trench warfare"],
    ["vietnam", "Vietnam War", "vietnam war"],
    ["coldwar", "Cold War", "cold war"],
    ["civilwar", "Civil Wars", "american civil war|civil war|spanish civil war"],
    ["nazi", "Nazis & the Holocaust", "nazi|nazis|nazi germany|holocaust|holocaust \\(shoah\\)|concentration camp|third reich|hitler|adolf hitler|gestapo"],
    ["military", "Soldiers & Military", "soldier|military|army|navy|marines|u\\.s\\. marine|special forces|navy seal|platoon|boot camp"],
    ["pilots", "Pilots & Air Combat", "fighter pilot|pilot|aerial combat|dogfight|air force"],
    ["submarine", "Submarines", "submarine|u-boat"],
    ["terror", "Terrorism", "terrorism|terrorist|terrorist attack|hijacking"],
    // Action & adventure
    ["martialarts", "Martial Arts", "martial arts|kung fu|karate|taekwondo|muay thai|jiu-jitsu|shaolin|wing chun"],
    ["wuxia", "Wuxia", "wuxia|swordsman"],
    ["samurai", "Samurai", "samurai|ronin|chanbara|jidaigeki"],
    ["ninja", "Ninjas", "ninja"],
    ["superhero", "Superheroes", "superhero|superheroes|super power|superpower|superhero team|marvel cinematic universe \\(mcu\\)|dc extended universe \\(dceu\\)|dc comics|marvel comics|masked vigilante"],
    ["carchase", "Car Chases & Racing", "car chase|car race|car racing|drag racing|street racing|race car|racing|formula 1|nascar|stunt driver|getaway driver"],
    ["pirates", "Pirates", "pirate|pirates|piracy"],
    ["swashbuckler", "Swashbucklers", "swashbuckler|sword fight|musketeer|fencing|swordplay|zorro"],
    ["treasure", "Treasure Hunts", "treasure hunt|treasure|lost treasure|treasure map"],
    ["explorers", "Explorers & Expeditions", "expedition|explorer|archaeologist|archaeology|lost city|jungle expedition"],
    ["survival", "Survival", "survival|stranded|survivalist|deserted island|plane crash|shipwreck|wilderness"],
    ["disaster", "Disasters", "disaster|natural disaster|disaster movie|earthquake|tsunami|volcano|tornado|hurricane|flood|avalanche|sinking ship"],
    // Sci-fi
    ["timetravel", "Time Travel", "time travel|time machine|time traveler"],
    ["timeloop", "Time Loops", "time loop"],
    ["althistory", "Alternate History", "alternate history|alternative history|alternate timeline|counterfactual history|historical fiction"],
    ["multiverse", "Parallel Worlds", "parallel world|parallel universe|multiverse|alternate reality|alternative reality|alternate universe|alternate dimension|alternative world|alternate world"],
    ["space", "Space Travel", "space travel|spaceship|space station|astronaut|space mission|outer space|space exploration|mars|moon landing|spacecraft|space opera|space|moon"],
    ["aliens", "Aliens", "alien|aliens|alien invasion|extraterrestrial|alien life-form|ufo|first contact|alien abduction"],
    ["robots", "Robots & AI", "robot|robots|android|artificial intelligence|artificial intelligence \\(a\\.i\\.\\)|cyborg|humanoid robot"],
    ["dystopia", "Dystopias", "dystopia|dystopian|totalitarianism|totalitarian regime|police state"],
    ["postapoc", "Post-Apocalyptic", "post-apocalyptic future|post-apocalyptic|apocalypse|end of the world|nuclear war|nuclear holocaust|wasteland"],
    ["cyberpunk", "Cyberpunk", "cyberpunk|tech noir"],
    ["mindcontrol", "Mind Control & Hypnosis", "mind control|hypnosis|hypnotism|brainwashing|mind reading"],
    ["steampunk", "Steampunk", "steampunk|dieselpunk"],
    ["vr", "Virtual Reality & Simulations", "virtual reality|simulation|simulated reality|video game world"],
    ["clones", "Clones & Genetic Engineering", "clone|cloning|genetic engineering|genetic mutation|mutant|mutation"],
    ["pandemic", "Outbreaks & Pandemics", "pandemic|epidemic|virus|outbreak|plague|infection|quarantine"],
    ["kaiju", "Giant Monsters", "kaiju|giant monster|giant creature|godzilla|tokusatsu"],
    ["dinosaurs", "Dinosaurs", "dinosaur|dinosaurs|tyrannosaurus rex|prehistoric"],
    ["madscientist", "Mad Scientists", "mad scientist|scientific experiment|experiment|human experimentation"],
    // Fantasy & myth
    ["swordsorcery", "Sword & Sorcery", "sword and sorcery|high fantasy|sword and sandal|dark fantasy|epic fantasy"],
    ["dragons", "Dragons", "dragon|dragons"],
    ["witches", "Witches & Witchcraft", "witch|witches|witchcraft|coven|sorceress"],
    ["wizards", "Wizards & Magic", "wizard|magic|magician|sorcerer|spell|magical creature"],
    ["fairytale", "Fairy Tales", "fairy tale|fairy|based on fairy tale|princess|fairy godmother"],
    ["mythology", "Mythology", "mythology|greek mythology|norse mythology|greek god|gods|mythological beast|hercules|zeus|thor"],
    ["talkinganimals", "Talking Animals", "talking animal|talking dog|anthropomorphism|anthropomorphic animal"],
    ["portal", "Other Worlds", "portal|another world|other world|fantasy world|isekai|alternate world"],
    // Horror
    ["slasher", "Slashers", "slasher|masked killer|slasher flick|proto-slasher|slasher horror|slasher spoof|teen slasher"],
    ["zombies", "Zombies", "zombie|zombies|zombie apocalypse|living dead|undead"],
    ["vampires", "Vampires", "vampire|vampires|dracula|count dracula|vampire hunter"],
    ["classicmonsters", "Classic Monsters", "frankenstein|frankenstein's monster|mummy|wolf man|invisible man|creature from the black lagoon|universal monsters|bride of frankenstein"],
    ["werewolves", "Werewolves", "werewolf|werewolves|lycanthrope"],
    ["ghosts", "Ghosts", "ghost|ghosts|ghost story|haunting|poltergeist|evil spirit|paranormal|paranormal phenomena|spirit|haunted"],
    ["haunted", "Haunted Houses", "haunted house|haunted mansion|haunted hotel"],
    ["doubles", "Doubles & Doppelgängers", "doppelgänger|doppelganger|twins|twin brother|twin sister|evil twin|double life|lookalike|mistaken identity"],
    ["urbanlegend", "Urban Legends", "urban legend|folklore|based on myths, legends or folklore|legend"],
    ["cabin", "Cabin in the Woods", "cabin|cabin in the woods|woods|forest|camping|campsite|lake"],
    ["possession", "Demons & Possession", "possession|demonic possession|exorcism|exorcist|demon|demons|satanism|devil|satan|antichrist"],
    ["gothic", "Gothic", "gothic|gothic horror|gothic romance|gothic fiction"],
    ["occult", "Occult & Curses", "occult|occultism|occult horror|curse|cursed|black magic|voodoo|ritual|witch hunt|nazi occultism|satanic ritual|demonology"],
    ["cults", "Cults", ".*\\b(?:cult|cults|religious cult|cult leader|satanic cult|pagan cult|cannibal cult|cultists|sect|commune)\\b.*"],
    ["folkhorror", "Folk Horror", "folk horror|pagan|paganism|ritual sacrifice|wicker man"],
    ["bodyhorror", "Body Horror", "body horror|mutilation|body modification"],
    ["foundfootage", "Found Footage", "found footage|found footage adjacent|screenlife|computer screen"],
    ["creature", "Creature Features", "creature|creature feature|monster|sea monster|giant animal|killer animal|shark|shark attack|giant spider|animal attack|animal horror|killer shark|crocodile|alligator|snake|spider|eco-horror|nature run amok"],
    ["cannibals", "Cannibals", "cannibal|cannibalism|cannibals"],
    ["lovecraft", "Cosmic Horror", "lovecraftian|cosmic horror|cthulhu|h\\.p\\. lovecraft|eldritch"],
    ["deathgame", "Deadly Games", "death game|battle royale|survival game|deadly game|game of death|squid game"],
    ["psychhorror", "Psychological Horror", "psychological horror|psychological thriller|madness|insanity|paranoia"],
    ["splatter", "Gore & Splatter", "gore|splatter|torture|torture porn|extreme violence"],
    ["halloween", "Halloween", "halloween"],
    // Comedy flavours
    ["satire", "Satire & Dark Comedy", "satire|political satire|social satire|black comedy|dark comedy"],
    ["parody", "Parody & Spoofs", "parody|spoof|spoof movie"],
    ["mockumentary", "Mockumentaries", "mockumentary|pseudo-documentary|faux documentary"],
    ["slapstick", "Slapstick", "slapstick|slapstick comedy"],
    ["screwball", "Screwball", "screwball comedy|screwball"],
    ["romcom", "Rom-Coms", "romantic comedy|romcom"],
    ["buddy", "Buddy Comedies", "buddy comedy|buddy movie|bromance"],
    ["stoner", "Stoner Comedies", "stoner comedy|marijuana|cannabis|weed"],
    ["teencomedy", "Teen Comedies", "teen comedy|sex comedy|teen movie"],
    ["standup", "Stand-Up Comedy", "stand-up comedy|stand-up comedian|stand up comedy|comedy special"],
    // Music & show business
    ["musical", "Musicals", "musical|jukebox musical|rock musical|stage musical|broadway musical|horror musical|romance musical|musical comedy|musical theater|musical revue|musical proshot|live musical performance|movie musical|based on musical|sing-along"],
    ["vaudeville", "Vaudeville & Burlesque", "vaudeville|burlesque|music hall|cabaret|showgirl|chorus girl|revue"],
    ["dance", "Dance", "dance|dancing|dancer|ballet|ballerina|dance competition|breakdance|hip hop dance|tango|ballroom dancing|choreographer"],
    ["concert", "Music Docs & Concerts", "concert film|concert|live performance|music tour|music documentary|rockumentary"],
    ["musicians", "Musicians & Bands", "musician|band|rock band|rock and roll|rock 'n' roll|singer|songwriter|rock star|pop star|guitarist|jazz musician|jazz|hip-hop|rapper|punk rock|heavy metal|country music|blues"],
    ["hollywood", "Hollywood & Filmmaking", "hollywood|filmmaking|film making|movie business|film director|film production|movie star|actor|actress|film industry|making of"],
    ["theater", "Theatre", "theater|theatre|stage play|broadway|playwright|stage actor|drama school"],
    ["artists", "Artists & Painters", "painter|artist|painting|art world|sculptor|art forger"],
    ["writers", "Writers", "writer|novelist|author|poet|writer's block|screenwriter"],
    ["fashion", "Fashion", "fashion|fashion designer|fashion model|fashion industry|supermodel"],
    ["hotels", "Hotels & Motels", "hotel|motel|hotel room|hotel manager|grand hotel"],
    ["food", "Food & Cooking", "cooking|chef|restaurant|food|baking|cuisine|culinary"],
    // True stories & history
    ["biopic", "Biopics", "biograph.*|.*\\bbiographical\\b.*|biopic|based on real person|based on memoir or autobiography|autobiograph.*|semi[- ]autobiographical|historical figure"],
    ["truestory", "Based on a True Story", "based on true story|based on true events|true crime|based on a true story"],
    ["truecrime", "True Crime", "true crime"],
    ["royalty", "Royalty", "royalty|king|queen|monarchy|royal family|princess|prince|emperor|empress|british monarchy|tudor"],
    ["period", "Period Pieces", "period drama|costume drama|19th century|18th century|victorian era|victorian england|regency|edwardian era|georgian era|period piece"],
    ["medieval", "Medieval", "medieval|middle ages|knight|knights|crusades|king arthur|castle"],
    ["ancient", "Ancient World", "ancient rome|roman empire|ancient greece|ancient egypt|gladiator|gladiators|pharaoh|sparta|sword and sandal|biblical epic"],
    ["bible", "Bible Stories", "bible|biblical|jesus christ|christianity|old testament|new testament|moses"],
    ["western", "Westerns", "western|spaghetti western|cowboy|outlaw|gunslinger|wild west|sheriff|frontier|bounty hunter|cattle drive|revisionist western|acid western"],
    ["politics", "Politics", "politics|politician|election|election campaign|president|presidential election|white house|senator|political corruption|political thriller|u\\.s\\. president"],
    ["journalism", "Journalism", "journalism|journalist|newspaper|reporter|investigative journalism|news media"],
    ["civilrights", "Civil Rights & Racism", "civil rights|civil rights movement|racism|racial segregation|segregation|racial prejudice|black lives matter|apartheid|ku klux klan"],
    ["slavery", "Slavery", "slavery|slave|slave trade|plantation"],
    ["immigration", "Immigrants & Refugees", "immigrant|immigration|refugee|refugees|migrant|emigration|illegal immigration|diaspora"],
    ["colonial", "Colonialism", "colonialism|colonization|colony|british empire|imperialism|post-colonialism"],
    ["revolution", "Revolutions & Uprisings", "revolution|revolutionary|rebellion|uprising|protest|resistance|french revolution|russian revolution"],
    ["native", "Indigenous Stories", "native american|indigenous|first nations|aboriginal|indigenous peoples|maori|inuit"],
    // People & relationships
    ["lgbtq", "LGBTQ+", ".*\\b(?:lgbt\\w*|gay|lesbian\\w*|queer|bisexual\\w*|transgender\\w*|trans (?:woman|man|women|men)|transsexual\\w*|transvesti\\w*|homosexual\\w*|drag queen|drag king|coming out|non-binary|gender transition|gender identity|boys' love \\(bl\\)|girls' love|yuri|homophobi\\w*|transphobi\\w*|same-sex marriage)\\b.*"],
    ["feminism", "Feminism & Women's Stories", "feminism|feminist|women's rights|female empowerment|women's liberation|sexism|misogyny|patriarchy"],
    ["comingofage", "Coming of Age", "coming of age|growing up|adolescence|teenage life|first love|loss of virginity|teenage romance|young love"],
    ["highschool", "High School", "high school|high school student|teenager|prom|high school sports|school dance|japanese high school|teenage girl|teenage boy|bullying|bully"],
    ["college", "College", "college|university|college student|fraternity|sorority|campus|dorm"],
    ["school", "School & Teachers", "school|teacher|boarding school|student|classroom|elementary school|teacher student relationship"],
    ["summercamp", "Summer Camp", "summer camp|camp counselor"],
    ["family", "Family Drama", "family relationships|dysfunctional family|family conflict|family drama|father son relationship|mother daughter relationship|father daughter relationship|mother son relationship|siblings|brother brother relationship|sister sister relationship"],
    ["femalelead", "Female Leads", "female protagonist|strong female lead|female hero|heroine"],
    ["parenthood", "Parenthood", "parenthood|single parent|single mother|single father|pregnancy|pregnant|motherhood|fatherhood|adoption|foster child"],
    ["marriage", "Marriage & Divorce", "marriage|marriage crisis|divorce|husband wife relationship|wedding|infidelity|adultery|affair|unfaithfulness"],
    ["forbiddenlove", "Love Triangles & Forbidden Love", "love triangle|forbidden love|unrequited love|extramarital affair|love affair|secret love|forbidden romance|star crossed lovers"],
    ["oldage", "Old Age", "old age|aging|elderly|retirement|dementia|alzheimer's disease|nursing home|senior citizen"],
    ["grief", "Grief & Loss", "grief|mourning|death of a loved one|loss of loved one|death of wife|death of husband|death of child|death of father|death of mother|bereavement|funeral"],
    ["illness", "Illness", "illness|terminal illness|cancer|disease|hospital|disability|blindness|deaf|wheelchair"],
    ["mentalhealth", "Mental Health", "mental illness|depression|mental health|schizophrenia|bipolar disorder|psychiatric hospital|mental institution|ptsd|post-traumatic stress disorder \\(ptsd\\)|anxiety"],
    ["addiction", "Addiction", "addiction|drug addiction|alcoholism|alcoholic|heroin|drug abuse|recovery|rehab"],
    // Faith & the uncanny
    ["religion", "Religion & Faith", "religion|faith|priest|nun|catholic|catholicism|church|catholic church|christian|islam|muslim|judaism|jewish|buddhism|hinduism|monk|spirituality|religious"],
    ["afterlife", "Afterlife", "afterlife|heaven|hell|purgatory|limbo|reincarnation|life after death"],
    ["dreams", "Dreams & Surreal", "dream|dreams|surreal|surrealism|lucid dream|nightmare|hallucination"],
    ["magicrealism", "Magical Realism", "magic realism|magical realism|fabulism"],
    ["amnesia", "Amnesia & Memory", "amnesia|memory loss|lost memory"],
    ["bodyswap", "Body Swaps & Shapeshifters", "body swap|shapeshifting|shape shifter|switching bodies"],
    // Places & journeys
    ["roadtrip", "Road Trips", "road trip|road movie|on the road|cross country|hitchhiker|hitchhiking"],
    ["trains", "Trains", "train|railway|train station|subway|locomotive"],
    ["planes", "Planes & Airports", "airplane|airport|flight|plane|airline|flight attendant"],
    ["sea", "At Sea", "ship|boat|ocean|sailing|sailor|cruise ship|at sea|lighthouse|fisherman|whaling"],
    ["circus", "Circus & Carnivals", "circus|carnival|clown|amusement park|funfair|fair|freak show|evil clown"],
    ["island", "Islands", "island|desert island|tropical island|remote island"],
    ["smalltown", "Small Towns", "small town|rural area|village|countryside|farm|farmer|rural life|small-town"],
    ["nyc", "New York", "new york city|manhattan, new york city|brooklyn, new york city|new york|harlem, new york city|bronx, new york city"],
    ["la", "Los Angeles", "los angeles, california|hollywood, los angeles, california|los angeles|beverly hills"],
    ["paris", "Paris", "paris, france|paris"],
    ["london", "London", "london, england|london|london, united kingdom"],
    ["tokyo", "Tokyo", "tokyo, japan|tokyo"],
    ["vegas", "Las Vegas & Gambling", "las vegas|gambling|casino|poker|gambler|card game|betting"],
    ["snow", "Snow, Ice & Mountains", "snow|arctic|antarctica|winter|blizzard|north pole|mountain climbing|mountaineering|mountain"],
    ["jungle", "Jungles", "jungle|rainforest|amazon rainforest"],
    // Seasons & occasions
    ["christmas", "Christmas", "christmas|christmas eve|santa claus|christmas party|christmas tree|holiday season|xmas"],
    // Sports
    ["sports", "Sports", "sports|sport|athlete|coach|underdog|sports team|championship|olympic games|olympics"],
    ["boxing", "Boxing & Fighting", "boxing|boxer|boxing match|mixed martial arts|mma|wrestling|wrestler|professional wrestling|fight club|underground fighting"],
    ["baseball", "Baseball", "baseball|baseball player|major league baseball \\(mlb\\)"],
    ["football", "American Football", "american football|football player|nfl|college football|quarterback"],
    ["soccer", "Soccer", "soccer|football \\(soccer\\)|soccer player|world cup|fifa"],
    ["basketball", "Basketball", "basketball|basketball player|nba"],
    ["extremesports", "Surfing & Extreme Sports", "surfing|surfer|skateboarding|skateboard|snowboarding|skiing|rock climbing|bmx"],
    // Animals & nature
    ["dogs", "Dogs", "dog|dogs|puppy|pet dog|dog owner"],
    ["cats", "Cats", "cat|cats|kitten"],
    ["horses", "Horses", "horse|horses|horse racing|horseback riding|pony"],
    ["nature", "Nature & Wildlife", "nature|wildlife|animals|ecology|environment|environmentalism|climate change|global warming"],
    // Tech & work
    ["hackers", "Hackers & Tech", "hacker|hacking|computer|internet|social media|cyber|technology|silicon valley|computer virus|video game"],
    ["money", "Money & Wall Street", "wall street|stock market|stockbroker|banker|corporate greed|capitalism|greed|money|millionaire|billionaire|financial crisis|investment banker"],
    ["medical", "Doctors & Hospitals", "doctor|surgeon|nurse|hospital|medicine|physician|medical drama"],
    ["science", "Scientists", "scientist|science|physicist|mathematician|mathematics|genius|inventor|invention"],
    // exploitation & cult subgenres
    ["blaxploitation", "Blaxploitation", "blaxploitation.*"],
    // Christploitation: Christian imagery in camp/exploitation (Jesus Christ
    // Vampire Hunter, Killer Nun), and the rapture scare films. Needs a
    // religious keyword or title word AND an exploitation keyword.
    ["christploitation", "Christploitation", "jesus christ|jesus|christ figure|crucifixion|messiah|second coming|antichrist|apostle|blasphemy|nun|nuns|evil nun|convent \\(nunnery\\)|evangelical christianity|televangelist|christianity", {
      title: "\\b(?:jesus|christ|messiah|apostles?|nuns?|rapture)\\b",
      and: "exploitation|b movie|psychotronic|psychotronic film|grindhouse|splatter|video nasty|nunsploitation|sexploitation|shot on video|trash|so bad it's good",
      direct: "christploitation|christsploitation|rapture|the rapture|end times|left behind|tribulation",
    }],
    ["faithbased", "Faith-Based", "christian film|faith-based|faith based|christian movie|faith film|faith-based film", { studios: ["pureflix", "affirm", "kendrick", "angel", "kingdomstory"], from: 1970 }],
    ["hagsploitation", "Hagsploitation", "hagsploitation|psycho-biddy|grande dame guignol"],
    ["nunsploitation", "Nunsploitation", "nunsploitation"],
    ["nazisploitation", "Nazisploitation", "nazisploitation.*|naziploitation|nazi exploitation"],
    ["canuxploitation", "Canuxploitation", "canuxploitation|canadian tax shelter"],
    ["sharksploitation", "Sharksploitation", "sharksploitation|shark|shark attack|killer shark|great white shark|megalodon"],
    ["hicksploitation", "Hicksploitation & Backwoods", "hicksploitation|redneck|rednecks|hillbilly|hillbillies|backwoods|inbreeding|moonshine|moonshiner"],
    ["southerngothic", "Southern Gothic", "southern gothic"],
    ["bikers", "Bikers", "biker|bikers|motorcycle gang|biker gang|outlaw biker|hells angels|biker film"],
    ["delinquents", "Juvenile Delinquents", "juvenile delinquent|juvenile delinquency|reform school|juvenile detention|teen gang|juvenile hall"],
    ["wip", "Women in Prison", "women's prison|women in prison|female prisoner|female prison"],
    ["raperevenge", "Rape & Revenge", "rape and revenge|rape-revenge"],
    ["mondo", "Mondo & Shockumentary", "mondo|mondo film|shockumentary"],
    ["videonasty", "Video Nasties", "video nasty|video nasties"],
    ["sov", "Shot on Video", "shot on video|sov horror|camcorder"],
    ["pinku", "Pinku Eiga", "pink film|pinku eiga|roman porno"],
    ["softcore", "Softcore", "softcore|erotic movie|erotica|sexploitation"],
    ["giallo", "Giallo", "giallo|gialli"],
    ["spaghetti", "Spaghetti Westerns", "spaghetti western|macaroni western|euro western|eurowestern"],
    ["neowestern", "Neo-Westerns", "neo-western|contemporary western|modern western|neo western"],
    ["peplum", "Sword & Sandal", "peplum|sword and sandal"],
    ["tokusatsu", "Tokusatsu", "tokusatsu|super sentai|kamen rider|ultraman|henshin hero"],
    ["mecha", "Mecha", "mecha|giant robot|mech"],
    ["isekai", "Isekai", "isekai"],
    ["jhorror", "J-Horror", "j-horror|japanese horror|j horror"],
    // film movements
    ["germanexp", "German Expressionism", "german expressionism|expressionism|expressionist"],
    ["frenchnewwave", "French New Wave", "french new wave|nouvelle vague"],
    ["jnewwave", "Japanese New Wave", "japanese new wave"],
    ["neorealism", "Italian Neorealism", "neorealism|italian neorealism"],
    ["dogme", "Dogme 95", "dogme 95|dogma 95"],
    ["slowcinema", "Slow Cinema", "slow cinema|contemplative cinema"],
    // Form & style
    ["anthology", "Anthologies", "anthology|omnibus|segments|portmanteau"],
    ["tvadapt", "Based on TV", "based on tv series|based on tv show|based on sitcom|based on cartoon"],
    ["avantgarde", "Avant-Garde & Experimental", "avant-garde|experimental|experimental film|abstract|video art|structural film"],
    ["indie", "Indie & Low Budget", "independent film|low budget|no budget|micro budget|mumblecore"],
    ["womendir", "Directed by Women", "woman director|female director|women directors"],
    ["adultanim", "Adult Animation", "adult animation"],
    ["precode", "Pre-Code", "pre-code"],
    ["bw", "Black & White", "black and white"],
    ["stopmotion", "Stop Motion", "stop motion|claymation|puppetry|puppet"],
    ["anime", "Anime", "anime|shounen|shoujo|seinen|josei|mecha|based on manga"],
    ["silent", "Silent Films", "silent film|silent movie|black and white silent"],
    ["exploitation", "Exploitation & Grindhouse", "exploitation|grindhouse|sexploitation|blaxploitation|nunsploitation|women in prison|nazisploitation|canuxploitation|ozploitation|video nasty|pink film|pinku eiga|eurotrash"],
    ["cultclassic", "Camp & Cult", "cult film|midnight movie|campy|camp|psychotronic|so bad it's good|b movie"],
    ["nonlinear", "Nonlinear Stories", "nonlinear timeline|non-linear narrative|flashback|told in flashback|multiple storylines|hyperlink cinema|interconnected stories"],
    ["metafilm", "Movies About Movies", "meta|metafiction|breaking the fourth wall|film within a film|movie within a movie"],
    ["remake", "Remakes", "remake"],
    ["videogame", "Based on Games & Toys", "based on video game|based on toy|based on board game|based on game"],
    ["novel", "Based on Novels", "based on novel or book|based on novel|based on book|literary adaptation|based on young adult novel|based on short story|based on children's book|based on novella"],
    ["comicadapt", "Based on Comics", "based on comic|based on comic book|based on graphic novel|based on manga|based on webcomic|based on comic strip"],
    ["play", "Based on Plays", "based on play or musical|based on play|based on stage play"],
  ];

  /* Studio labels: each rolls up the TMDB company names behind one brand
   * (whole name, case-insensitive). Edit freely: no rebuild needed. */
  const STUDIOS = [
    // animation
    ["disney", "Disney", "walt disney pictures|walt disney productions|walt disney animation studios|walt disney feature animation|disneytoon studios|disney"],
    ["pixar", "Pixar", "pixar|pixar animation studios"],
    ["dwa", "DreamWorks Animation", "dreamworks animation|pdi/dreamworks"],
    ["illumination", "Illumination", "illumination|illumination entertainment"],
    ["bluesky", "Blue Sky", "blue sky studios"],
    ["sonyanim", "Sony Pictures Animation", "sony pictures animation"],
    ["wbanim", "Warner Bros. Animation", "warner bros\\. animation|warner bros\\. cartoons|warner animation group|hanna-barbera productions|hanna-barbera"],
    ["ghibli", "Studio Ghibli", "studio ghibli"],
    ["laika", "Laika", "laika|laika entertainment"],
    ["aardman", "Aardman", "aardman|aardman animations"],
    ["cartoonsaloon", "Cartoon Saloon", "cartoon saloon"],
    ["ponoc", "Studio Ponoc", "studio ponoc"],
    ["comix", "CoMix Wave", "comix wave films|comix wave"],
    ["toeianim", "Toei Animation", "toei animation"],
    ["madhouse", "Madhouse", "madhouse"],
    ["ig", "Production I.G", "production i\\.g"],
    ["kyoani", "Kyoto Animation", "kyoto animation"],
    ["sunrise", "Sunrise", "sunrise|bandai namco filmworks"],
    // the big studios
    ["wb", "Warner Bros.", "warner bros\\. pictures|warner bros\\.|warner bros\\. entertainment|warner bros\\.-first national|first national pictures|warner bros\\.-seven arts|warner bros\\. family entertainment"],
    ["universal", "Universal", "universal pictures|universal international pictures|universal studios"],
    ["paramount", "Paramount", "paramount|paramount pictures"],
    ["columbia", "Columbia", "columbia pictures|columbia pictures corporation|columbia pictures industries"],
    ["fox", "20th Century", "20th century fox|twentieth century fox|twentieth century fox film corporation|20th century studios|20th century pictures"],
    ["mgm", "MGM", "metro-goldwyn-mayer|mgm|metro-goldwyn-mayer \\(mgm\\)"],
    ["ua", "United Artists", "united artists"],
    ["rko", "RKO", "rko radio pictures|rko"],
    ["tristar", "TriStar", "tristar pictures"],
    ["touchstone", "Touchstone", "touchstone pictures"],
    ["marvel", "Marvel", "marvel studios|marvel entertainment|marvel enterprises|marvel knights"],
    ["dc", "DC", "dc entertainment|dc comics|dc films|dc studios"],
    ["lucasfilm", "Lucasfilm", "lucasfilm|lucasfilm ltd\\.|lucasfilm animation"],
    ["dreamworks", "DreamWorks Pictures", "dreamworks pictures|dreamworks skg|dreamworks"],
    // mini-majors & labels
    ["lionsgate", "Lionsgate", "lionsgate|lions gate films|lionsgate films|lions gate entertainment"],
    ["newline", "New Line", "new line cinema"],
    ["miramax", "Miramax", "miramax|miramax films"],
    ["dimension", "Dimension", "dimension films"],
    ["searchlight", "Searchlight", "fox searchlight pictures|searchlight pictures"],
    ["focus", "Focus Features", "focus features"],
    ["sonyclassics", "Sony Pictures Classics", "sony pictures classics"],
    ["a24", "A24", "a24"],
    ["neon", "Neon", "neon"],
    ["annapurna", "Annapurna", "annapurna pictures"],
    ["orion", "Orion", "orion pictures"],
    ["carolco", "Carolco", "carolco pictures"],
    ["summit", "Summit", "summit entertainment"],
    ["screengems", "Screen Gems", "screen gems"],
    ["stx", "STX", "stx entertainment|stxfilms"],
    ["relativity", "Relativity", "relativity media"],
    ["legendary", "Legendary", "legendary pictures|legendary entertainment"],
    ["skydance", "Skydance", "skydance|skydance media|skydance productions"],
    ["village", "Village Roadshow", "village roadshow pictures"],
    ["castlerock", "Castle Rock", "castle rock entertainment"],
    ["spyglass", "Spyglass", "spyglass entertainment|spyglass media group"],
    // producers' shingles
    ["amblin", "Amblin", "amblin entertainment|amblin partners|amblin television|amblin documentaries"],
    ["badrobot", "Bad Robot", "bad robot|bad robot productions"],
    ["platinumdunes", "Platinum Dunes", "platinum dunes"],
    ["bruckheimer", "Jerry Bruckheimer", "jerry bruckheimer films|simpson/bruckheimer|don simpson/jerry bruckheimer films"],
    ["imagine", "Imagine", "imagine entertainment"],
    ["syncopy", "Syncopy", "syncopy"],
    ["planb", "Plan B", "plan b entertainment"],
    ["happymadison", "Happy Madison", "happy madison productions"],
    ["apatow", "Apatow", "apatow productions"],
    ["garysanchez", "Gary Sanchez", "gary sanchez productions"],
    ["pointgrey", "Point Grey", "point grey pictures"],
    ["originalfilm", "Original Film", "original film"],
    ["dupass", "Duplass Brothers", "duplass brothers productions"],
    ["killer", "Killer Films", "killer films"],
    ["participant", "Participant", "participant|participant media|participant productions"],
    ["workingtitle", "Working Title", "working title|working title films"],
    ["monkeypaw", "Monkeypaw", "monkeypaw productions"],
    ["darkcastle", "Dark Castle", "dark castle entertainment"],
    ["ghosthouse", "Ghost House", "ghost house pictures"],
    ["atomicmonster", "Atomic Monster", "atomic monster|blumhouse atomic monster"],
    ["twisted", "Twisted Pictures", "twisted pictures"],
    ["blumhouse", "Blumhouse", "blumhouse productions|blumhouse|blumhouse television|blumhouse atomic monster|blumhouse international"],
    ["shudder", "Shudder", "shudder"],
    ["ifc", "IFC Films", "ifc films|ifc productions|ifc midnight"],
    ["oscilloscope", "Oscilloscope", "oscilloscope|oscilloscope laboratories"],
    ["xyz", "XYZ Films", "xyz films"],
    ["mubi", "MUBI", "mubi"],
    ["severin", "Severin", "severin films"],
    ["kino", "Kino Lorber", "kino lorber|kino international"],
    // genre & cult houses
    ["hammer", "Hammer", "hammer films|hammer film productions"],
    ["amicus", "Amicus", "amicus productions"],
    ["aip", "AIP", "american international pictures|american international productions"],
    ["cannon", "Cannon", "cannon films|the cannon group|cannon group"],
    ["troma", "Troma", "troma entertainment|troma"],
    ["newworld", "New World", "new world pictures"],
    ["fullmoon", "Full Moon", "full moon features|full moon entertainment|full moon pictures"],
    ["empire", "Empire Pictures", "empire pictures"],
    ["crown", "Crown International", "crown international pictures"],
    ["embassy", "Embassy", "avco embassy pictures|embassy pictures|embassy pictures corporation|embassy international pictures"],
    ["vestron", "Vestron", "vestron pictures"],
    ["hemdale", "Hemdale", "hemdale|hemdale film corporation"],
    ["corman", "Roger Corman", "concorde-new horizons|new horizons pictures|new concorde|filmgroup"],
    // international
    ["ealing", "Ealing", "ealing studios"],
    ["bbcfilms", "BBC Films", "bbc film|bbc films"],
    ["film4", "Film4", "film4 productions|film4|channel four films|channel 4 television corporation"],
    ["gaumont", "Gaumont", "gaumont|gaumont international|gaumont-british picture corporation|société l\\. gaumont et compagnie|société nouvelle des établissements gaumont \\(sneg\\)"],
    ["pathe", "Pathé", "pathé|pathe|pathé films|pathé frères|pathé renn productions|société nouvelle pathé cinéma|pathé consortium cinéma"],
    ["constantin", "Constantin", "constantin film|constantin film produktion"],
    ["mosfilm", "Mosfilm", "mosfilm"],
    ["studiocanal", "StudioCanal", "studiocanal|studiocanal uk"],
    ["toho", "Toho", "toho|toho co\\., ltd\\.|toho company"],
    ["toei", "Toei", "toei company|toei"],
    ["shochiku", "Shochiku", "shochiku"],
    ["nikkatsu", "Nikkatsu", "nikkatsu|nikkatsu corporation|nikkatsu studio"],
    ["daiei", "Daiei", "daiei film|daiei studios|daiei motion picture company"],
    ["shaw", "Shaw Brothers", "shaw brothers"],
    ["goldenharvest", "Golden Harvest", "golden harvest|golden harvest company|golden harvest productions|orange sky golden harvest"],
    ["cjent", "CJ ENM", "cj entertainment|cj enm|cj enm studios"],
    ["yashraj", "Yash Raj", "yash raj films"],
    ["dharma", "Dharma", "dharma productions"],
    // streamers & TV
    ["netflix", "Netflix", "netflix|netflix animation|netflix animation studios|netflix studios"],
    ["amazon", "Amazon", "amazon studios|amazon mgm studios|amazon prime video|amazon content services"],
    ["apple", "Apple", "apple studios|apple original films|apple tv\\+"],
    ["hbo", "HBO", "hbo|hbo films|hbo max|hbo documentary films|home box office \\(hbo\\)"],
    ["pureflix", "Pure Flix", "pure flix entertainment|pure flix|pure flix productions"],
    ["affirm", "Affirm Films", "affirm films"],
    ["kendrick", "Kendrick Brothers", "kendrick brothers|kendrick brothers productions|sherwood pictures"],
    ["angel", "Angel Studios", "angel studios|vidangel studios"],
    ["kingdomstory", "Kingdom Story Company", "kingdom story company"],
    ["hallmark", "Hallmark", "hallmark entertainment|hallmark channel|crown media|hallmark hall of fame productions"],
    ["lifetime", "Lifetime", "lifetime|lifetime television|lifetime pictures"],
    ["disneychannel", "Disney Channel", "disney channel|disney television animation|disney+"],
  ];

  const CERTS = [["G", "G"], ["PG", "PG"], ["PG-13", "PG-13"], ["R", "R"], ["NC-17", "NC-17"], ["NR", "Not rated"]];
  const certBucket = (c) => (["G", "PG", "PG-13", "R", "NC-17"].includes(c) ? c : c === "X" ? "NC-17" : c === "M" || c === "GP" ? "PG" : "NR");
  const RATING_BANDS = [["4", "4★ and up"], ["35", "3.5–4★"], ["3", "3–3.5★"], ["25", "2.5–3★"], ["0", "Under 2.5★"]];
  const ratingBand = (r) => (r >= 400 ? "4" : r >= 350 ? "35" : r >= 300 ? "3" : r >= 250 ? "25" : "0");
  const RUNTIME_BANDS = [["s", "Under 90 min"], ["m", "90 min – 2 h"], ["l", "2 – 2½ h"], ["xl", "2½ h and up"]];
  const runtimeBand = (m) => (m < 90 ? "s" : m < 120 ? "m" : m < 150 ? "l" : "xl");
  // A film's people and companies, as filter keys: d: director, c: cast, k: company
  function whoOf(C, i) {
    const out = [];
    const row = C.info && C.info[i];
    if (row && Array.isArray(row[4])) for (const d of row[4]) out.push(`d:${d}`);
    if (C.fcast && C.fcast[i]) for (const c of C.fcast[i]) out.push(`c:${c}`);
    if (C.fco && C.fco[i]) for (const k of C.fco[i]) out.push(`k:${k}`);
    return out;
  }
  function whoName(k) {
    const C = catalogue, [t, n] = [k.slice(0, 1), +k.slice(2)];
    if (!C) return k;
    if (t === "d") return `${C.people[n] || "?"} (director)`;
    if (t === "c") return `${(C.cast || [])[n] || "?"} (cast)`;
    if (t === "k") return (C.co || [])[n] || "?";
    return k;
  }

  let facts = null;
  function buildFacts() {
    if (!catalogue) return null;
    if (facts && facts.cat === catalogue) return facts;
    const C = catalogue, N = C.films.length;
    const idx = new Map(C.films.map((f, i) => [f[0], i]));
    const genre = new Uint32Array(N);
    GENRES.forEach(([g], b) => { const l = C.lists.get(`genre/${g}`); if (l) for (const i of l.set) genre[i] |= 1 << b; });
    const multi = (prefix) => {
      const keys = [], names = [], per = new Array(N);
      for (const [k, l] of C.lists) {
        if (!k.startsWith(prefix)) continue;
        const v = keys.length;
        keys.push(k.slice(prefix.length)); names.push(l.name);
        for (const i of l.set) (per[i] || (per[i] = [])).push(v);
      }
      return { keys, names, per };
    };
    const country = multi("country/");
    // Country of origin: TMDB's when we have it; otherwise a film with one
    // production country is from there, and a co-production goes to the
    // country that speaks its primary language (else it keeps them all).
    const origin = { keys: country.keys.slice(), names: country.names.slice(), per: new Array(N), exact: false };
    const at = new Map(origin.keys.map((k, n) => [k, n]));
    const keyFor = (slug, name) => { if (!at.has(slug)) { at.set(slug, origin.keys.length); origin.keys.push(slug); origin.names.push(name); } return at.get(slug); };
    const ALIAS = { us: "usa", gb: "uk", kr: "south-korea", kp: "north-korea", ru: "russia", ir: "iran", cz: "czechia", va: "vatican-city", tw: "taiwan", hk: "hong-kong", mo: "macao", ps: "palestine", bo: "bolivia", ve: "venezuela", tz: "tanzania", sy: "syria", la: "laos", vn: "vietnam", md: "moldova", mk: "north-macedonia" };
    let regionName = null;
    try { regionName = new Intl.DisplayNames(["en"], { type: "region" }); } catch {}
    const isoSlug = (iso) => {
      const lo = iso.toLowerCase();
      if (ALIAS[lo] && at.has(ALIAS[lo])) return keyFor(ALIAS[lo]);
      const nm = regionName ? regionName.of(iso.toUpperCase()) : iso;
      const sl = slugify(nm);
      return at.has(sl) ? at.get(sl) : keyFor(ALIAS[lo] || sl, nm);
    };
    const LANG_HOME = { en: ["usa", "uk", "canada", "australia", "ireland", "new-zealand"], fr: ["france", "belgium", "canada", "switzerland"], es: ["spain", "mexico", "argentina", "colombia", "chile", "cuba", "peru"], de: ["germany", "austria", "switzerland"], it: ["italy"], ja: ["japan"], ko: ["south-korea"], zh: ["china", "taiwan", "hong-kong"], cn: ["hong-kong", "china"], hi: ["india"], ta: ["india"], te: ["india"], ml: ["india"], kn: ["india"], bn: ["india", "bangladesh"], mr: ["india"], pa: ["india"], pt: ["brazil", "portugal"], ru: ["russia"], sv: ["sweden"], da: ["denmark"], no: ["norway"], nb: ["norway"], fi: ["finland"], pl: ["poland"], tr: ["turkey"], fa: ["iran"], th: ["thailand"], id: ["indonesia"], tl: ["philippines"], nl: ["netherlands", "belgium"], el: ["greece"], hu: ["hungary"], cs: ["czechia", "czech-republic"], ro: ["romania"], he: ["israel"], ar: ["egypt", "lebanon", "saudi-arabia", "tunisia", "morocco"], uk: ["ukraine"], sr: ["serbia"], hr: ["croatia"], is: ["iceland"], et: ["estonia"], ka: ["georgia"] };
    let exact = 0;
    for (let i = 0; i < N; i++) {
      const row = C.info && C.info[i];
      const lang = row && (row[2] || row[3]);
      const pref = lang && LANG_HOME[lang];
      if (row && Array.isArray(row[6]) && row[6].length) {
        // TMDB often lists a financier's country too (Regretting You: DE + US).
        // When some of the listed countries speak the film's main language,
        // keep just those.
        let t = row[6].map(isoSlug);
        if (t.length > 1 && pref) { const home = new Set(pref.map((sl) => at.get(sl)).filter((n) => n != null)); const k = t.filter((n) => home.has(n)); if (k.length) t = k; }
        origin.per[i] = t; exact++; continue;
      }
      const prod = country.per[i];
      if (!prod || prod.length <= 1) { origin.per[i] = prod; continue; }
      const pick = pref && pref.map((sl) => at.get(sl)).find((n) => n != null && prod.includes(n));
      origin.per[i] = pick != null ? [pick] : prod;
    }
    origin.exact = exact > 0;
    let lang, primary = false;
    if (C.info) {
      // one primary language per film (what Letterboxd shows as "Primary Language")
      const keys = [], names = [], per = new Array(N), at = new Map();
      C.info.forEach((x, i) => {
        const code = x && (x[2] || x[3]);
        if (!code) return;
        if (!at.has(code)) { at.set(code, keys.length); keys.push(code); names.push((C.langNames && C.langNames[code]) || code); }
        per[i] = [at.get(code)];
      });
      lang = { keys, names, per };
      primary = true;
    } else lang = multi("language/");
    // Letterboxd's own Short and TV marks (its "show only shorts / TV" filters)
    const short = (C.lists.get("type/short") || {}).set || null, tv = (C.lists.get("type/tv") || {}).set || null;
    // Letterboxd's themes (broad) and mini-themes (narrow, e.g. biopics, heists).
    const theme = multi("theme/"), mini = multi("mini-theme/");
    let studio = null;
    if (C.co && C.fco) {
      const res = STUDIOS.map(([, , pat]) => new RegExp(`^(?:${pat})$`, "i"));
      const coS = C.co.map((name) => { const out = []; res.forEach((re, t) => { if (re.test(name)) out.push(t); }); return out; });
      const per = new Array(N);
      C.fco.forEach((ks, i) => {
        if (!ks) return;
        let set = null;
        for (const k of ks) for (const t of coS[k] || []) (set || (set = new Set())).add(t);
        if (set) per[i] = [...set];
      });
      studio = { keys: STUDIOS.map(([id]) => id), names: STUDIOS.map(([, label]) => label), per };
    }
    let tags = null;
    if (C.kw && C.fkw) {
      // Most tags: any keyword matching the pattern. A tag with an "and"
      // needs one keyword (or title word) from its pattern AND one from its
      // "and"; "direct" keywords and "studios" count on their own.
      const re = (p) => new RegExp(`^(?:${p})$`, "i");
      const plain = [], both = [];
      KW_TAGS.forEach(([, , pat, o], t) => {
        o = o || {};
        if (o.and) both.push({ t, a: re(pat), b: re(o.and), title: o.title ? new RegExp(o.title, "i") : null });
        const d = o.and ? o.direct : o.direct ? `${pat}|${o.direct}` : pat;
        if (d) plain.push([t, re(d)]);
      });
      const kwTags = C.kw.map((name) => plain.filter(([, r]) => r.test(name)).map(([t]) => t));
      const kwA = both.map((x) => C.kw.map((name) => x.a.test(name)));
      const kwB = both.map((x) => C.kw.map((name) => x.b.test(name)));
      const per = new Array(N);
      const put = (i, t) => { const p = per[i] || (per[i] = []); if (!p.includes(t)) p.push(t); };
      C.fkw.forEach((ks, i) => {
        if (!ks) return;
        for (const k of ks) for (const t of kwTags[k] || []) put(i, t);
        both.forEach((x, n) => {
          if (!ks.some((k) => kwB[n][k])) return;
          if (ks.some((k) => kwA[n][k]) || (x.title && x.title.test(titleOf(C.films[i][1])))) put(i, x.t);
        });
      });
      // tags that also count a studio's films (Faith-Based: Pure Flix…)
      if (studio) KW_TAGS.forEach(([, , , o], t) => {
        if (!o || !o.studios) return;
        const want = new Set(o.studios.map((id) => STUDIOS.findIndex(([x]) => x === id)).filter((n) => n >= 0));
        studio.per.forEach((ss, i) => { if (ss && ss.some((x) => want.has(x))) put(i, t); });
      });
      // tags limited to a period (Faith-Based: the modern industry, not 1950s epics)
      KW_TAGS.forEach(([, , , o], t) => {
        if (!o || !o.from) return;
        per.forEach((ts, i) => { if (ts && ts.includes(t) && yearOf(C.films[i][1]) < o.from) per[i] = ts.filter((x) => x !== t); });
      });
      tags = { keys: KW_TAGS.map(([id]) => id), names: KW_TAGS.map(([, label]) => label), per };
    }

    facts = { cat: C, idx, genre, country, origin, lang, primary, short, tv, theme, mini, tags, studio, runtime: C.info ? (i) => (C.info[i] && C.info[i][1]) || 0 : null };
    return facts;
  }

  const LV_TYPES = [["feature", "Feature"], ["short", "Short"], ["doc", "Documentary"], ["tv", "TV"], ["anim", "Animation"]];
  const decadeOf = (y) => (y ? `${Math.floor(y / 10) * 10}s` : "");
  // Each film once, with every value each filter group can see.
  function lvBase() {
    const H = house();
    const heldList = edit.on ? [] : mine.held || [];
    const key = `${lib.place.size}|${heldList.length}|${edit.on}`;
    if (lv.base && lv.baseLib === lib && lv.baseLay === wall.lay && lv.baseKey === key) return lv.base;
    const onWall = wall.lay ? wall.lay.idx : null;
    const F = buildFacts();
    const held = new Set(heldList.map(([x]) => x));
    const byHand = new Set([...Object.keys(H.place), ...(mine.view === "mine" && !edit.on ? Object.keys(mine.place) : [])]);
    const gBit = Object.fromEntries(GENRES.map(([g], b) => [g, 1 << b]));
    if (lv.statFacts !== F) { lv.stat = new Map(); lv.statFacts = F; }
    const stat = lv.stat;
    const out = [];
    for (const [slug, sub] of lib.place) {
      const p = partsOf(sub);
      if (!p.genre) continue;
      // What never changes about a film is worked out once and kept.
      let S = stat.get(slug);
      if (!S) {
        const name = lib.names.get(slug) || slug, year = yearOf(name);
        const i = F ? F.idx.get(slug) : undefined;
        const gm = i != null ? F.genre[i] : 0;
        const type = [];
        const rt = i != null && F.runtime ? F.runtime(i) : 0;
        const isShort = i != null && (F.short ? F.short.has(i) : rt > 0 && rt < 40);
        const isTv = i != null && ((F.tv && F.tv.has(i)) || !!(gm & gBit["tv-movie"]) || !!(F.cat.info && F.cat.info[i] && F.cat.info[i][5]));
        if (isShort) type.push("short");
        else if (i != null && !isTv && (F.short || rt)) type.push("feature");
        if (gm & gBit.documentary) type.push("doc");
        if (isTv) type.push("tv");
        if (gm & gBit.animation) type.push("anim");
        S = {
          name, year, i: i == null ? 1e9 : i, key: fileKey(name),
          genre: GENRES.filter(([g]) => gm & gBit[g]).map(([g]) => g), type, decade: year ? [decadeOf(year)] : [],
          lang: i != null && F.lang.per[i] ? F.lang.per[i].map(String) : [],
          country: i != null && F.origin.per[i] ? F.origin.per[i].map(String) : [],
          pcountry: i != null && F.country.per[i] ? F.country.per[i].map(String) : [],
          tag: i != null && F.tags && F.tags.per[i] ? F.tags.per[i].map(String) : [],
          studio: i != null && F.studio && F.studio.per[i] ? F.studio.per[i].map(String) : [],
          cert: i != null && F.cat.fcert && F.cat.fcert[i] ? [certBucket(F.cat.certs[F.cat.fcert[i] - 1])] : [],
          rating: i != null ? (F.cat.films[i][2] || 0) : 0,
          rband: i != null && F.cat.films[i][2] ? [ratingBand(F.cat.films[i][2])] : [],
          rtband: i != null && F.runtime && F.runtime(i) ? [runtimeBand(F.runtime(i))] : [],
          who: i != null ? whoOf(F.cat, i) : [],
          theme: i != null && F.theme && F.theme.per[i] ? F.theme.per[i].map(String) : [],
          mini: i != null && F.mini && F.mini.per[i] ? F.mini.per[i].map(String) : [],
        };
        stat.set(slug, S);
      }
      const status = [p.genre === UNCAT ? "uncat" : "cat"];
      if (onWall && p.genre !== UNCAT) status.push(onWall.has(slug) ? "wall" : "nowall");
      if (held.has(slug)) status.push("held");
      out.push({
        slug, name: S.name, year: S.year, i: S.i, key: S.key, rating: S.rating,
        path: [p.genre, p.cat, p.sub, p.niche].filter(Boolean),
        v: { status, sgenre: [p.genre], scat: p.cat ? [p.cat] : [], ssub: [p.sub, p.niche].filter(Boolean), genre: S.genre, type: S.type, decade: S.decade, lang: S.lang, country: S.country, pcountry: S.pcountry, tag: S.tag, studio: S.studio, cert: S.cert, rband: S.rband, rtband: S.rtband, who: S.who, theme: S.theme, mini: S.mini },
      });
    }
    lv.base = out; lv.baseLib = lib; lv.baseLay = wall.lay; lv.baseKey = key;
    lv.baseMap = new Map(out.map((r) => [r.slug, r]));
    return out;
  }
  // The groups shown: store location narrows level by level.
  function lvGroups() {
    const F = buildFacts();
    const inc = (g) => Object.entries(lv.f[g] || {}).filter(([, s]) => s === 1).map(([v]) => v);
    const gs = [
      { id: "status", label: "Store", vals: [["uncat", "Uncategorized"], ["cat", "Categorized"], ["wall", "On the wall"], ["nowall", "Not on the wall"], ...(edit.on ? [] : [["held", "In inventory"]])] },
      { id: "sgenre", label: "Store genre", vals: [...lib.genres.values()].map((g) => [g.id, g.name]) },
    ];
    // Pick store genres and their categories appear; pick categories and their subcats appear.
    const sg = inc("sgenre").filter((g) => g !== UNCAT && lib.genres.has(g));
    if (sg.length) gs.push({ id: "scat", label: "Store category", vals: sg.flatMap((g) => lib.genres.get(g).cats.map((c) => [c, sg.length > 1 ? `${nameOf(g)} › ${nameOf(c)}` : nameOf(c)])) });
    const sc = inc("scat").filter((c) => lib.cats.has(c));
    if (sc.length) gs.push({ id: "ssub", label: "Store subcat", vals: sc.flatMap((c) => lib.cats.get(c).subs.flatMap((s2) => [[s2, sc.length > 1 ? `${nameOf(c)} › ${nameOf(s2)}` : nameOf(s2)], ...(lib.subs.get(s2).niches || []).map((n) => [n, `↳ ${nameOf(n)}`])])) });
    gs.push({ id: "genre", label: "Genre", vals: GENRES.map(([g, n]) => [g, n]) });
    // People and companies picked from search (only the picked ones show)
    const who = Object.keys(lv.f.who || {});
    if (who.length) gs.push({ id: "who", label: "People & companies", vals: who.map((k) => [k, whoName(k)]) });
    if (F && F.studio) gs.push({ id: "studio", label: "Studio", vals: F.studio.keys.map((k, n) => [String(n), F.studio.names[n], STUDIOS[n][2].replace(/\\/g, "").replace(/\|/g, " ").toLowerCase()]), many: true, find: "studio (try Disney, A24, Bad Robot…)" });
    if (F && F.cat.fcert) gs.push({ id: "cert", label: "Age rating (US)", vals: CERTS });
    gs.push({ id: "rband", label: "Letterboxd rating", vals: RATING_BANDS });
    if (F && F.runtime) gs.push({ id: "rtband", label: "Runtime", vals: RUNTIME_BANDS });
    // Search also matches the tag's keywords (its slug), plus a few common words.
    const THEME_WORDS = { "biography-artists-musician-songs-emotional": "biopic biographical" };
    const tagVals = (T) => T.keys.map((k, n) => [String(n), T.names[n], `${k.replace(/-/g, " ")} ${THEME_WORDS[k] || ""}`.toLowerCase()]);
    if (F && F.tags) gs.push({ id: "tag", label: "Tags", vals: F.tags.keys.map((k, n) => [String(n), F.tags.names[n], KW_TAGS[n][2].replace(/\\/g, "").replace(/\|/g, " ").toLowerCase()]), many: true, find: "tag (try LGBTQ, heist, musical…)" });
    else gs.push({ id: "tag", label: "Tags", vals: [], note: "Tags need TMDB keywords (Catalogue builder › Read TMDB keywords)" });
    if (F && F.theme && F.theme.keys.length) gs.push({ id: "theme", label: "Theme", vals: tagVals(F.theme), many: true, find: "theme" });
    if (F && F.mini && F.mini.keys.length) gs.push({ id: "mini", label: "Mini-theme", vals: tagVals(F.mini), many: true, find: "mini-theme (try biopic, heist, zombies…)" });
    gs.push({ id: "type", label: "Type", vals: LV_TYPES, note: F && (F.short || F.runtime) ? "" : "Feature and Short need film details (Catalogue builder › Film details)" });
    const decs = [];
    for (let d = 1890; d <= 2020; d += 10) decs.push([`${d}s`, `${d}s`]);
    gs.push({ id: "decade", label: "Decade", vals: decs, years: true });
    if (F) {
      gs.push({ id: "lang", label: F.primary ? "Primary language" : "Language (spoken anywhere in the film)", vals: F.lang.keys.map((k, n) => [String(n), F.lang.names[n]]), many: true });
      gs.push({ id: "country", label: "Country of origin", vals: F.origin.keys.map((k, n) => [String(n), F.origin.names[n]]), many: true, note: F.origin.exact ? "" : F.primary ? "Co-productions go to the country that speaks their language" : "Co-productions count for each of their countries until film details are read" });
    }
    return gs;
  }
  // Run the filters: the rows, and each chip's count (with every other group applied).
  function lvRun() {
    const base = lvBase();
    const groups = lvGroups();
    const act = groups.map((g) => {
      const st = lv.f[g.id] || {};
      const I = new Set(), X = new Set();
      for (const [v, s] of Object.entries(st)) (s === 1 ? I : s === -1 ? X : null)?.add(v);
      return { g, I, X, on: I.size || X.size, all: !!(lv.all && lv.all[g.id]) && I.size > 1 };
    });
    const y0 = +lv.y0 || 0, y1 = +lv.y1 || 0;
    const q = fileKey(lv.q || "").trim();
    const counts = groups.map(() => new Map());
    const rows = [];
    for (const r of base) {
      if (q && !r.key.includes(q)) continue;
      if ((y0 && (!r.year || r.year < y0)) || (y1 && (!r.year || r.year > y1))) continue;
      let fails = 0, failAt = -1;
      for (let k = 0; k < act.length; k++) {
        const a = act[k];
        if (!a.on) continue;
        const vs = r.v[a.g.id] || [];
        let ok = !a.I.size;
        if (a.all) { let hit = 0; for (const v of vs) if (a.I.has(v)) hit++; ok = hit >= a.I.size; }
        else for (const v of vs) { if (a.X.has(v)) { ok = false; break; } if (a.I.has(v)) ok = true; }
        if (a.X.size && ok) for (const v of vs) if (a.X.has(v)) { ok = false; break; }
        if (!ok) { fails++; failAt = k; if (fails > 1) break; }
      }
      if (fails > 1) continue;
      if (fails === 1) { const c = counts[failAt]; for (const v of r.v[act[failAt].g.id] || []) c.set(v, (c.get(v) || 0) + 1); continue; }
      rows.push(r);
      for (let k = 0; k < act.length; k++) { const c = counts[k]; for (const v of r.v[act[k].g.id] || []) c.set(v, (c.get(v) || 0) + 1); }
    }
    const cmp = lv.sort === "title" ? (a, b) => collator.compare(a.key, b.key) || a.year - b.year : lv.sort === "year" ? (a, b) => (b.year || 0) - (a.year || 0) || a.i - b.i : lv.sort === "rating" ? (a, b) => (b.rating || 0) - (a.rating || 0) || a.i - b.i : (a, b) => a.i - b.i;
    rows.sort(cmp);
    // A franchise is one row (it shows when any of its films match); open
    // it to see all its films beneath, the ones that don't match dimmed.
    lv.nFilms = rows.length;
    const matched = new Set(rows.map((r) => r.slug));
    const out = [], done = new Set();
    for (const r of rows) {
      const fid = lib.frOf.get(r.slug);
      if (!fid) { out.push(r); continue; }
      if (done.has(fid)) continue;
      done.add(fid);
      const fr = lib.frs[fid];
      const members = fr.films.map(([x]) => x).filter((x) => lv.baseMap.has(x));
      const lead = lv.baseMap.get(members[0]) || r;
      out.push({ fr: fid, slug: `fr:${fid}`, name: fr.name, members, path: lead.path, v: lead.v, year: 0 });
      if (lv.open.has(fid)) for (const x of members) out.push({ ...lv.baseMap.get(x), member: true, dim: !matched.has(x) });
    }
    lv.rows = out;
    lv.pos = new Map(out.map((r, n) => [r.slug, n]));
    lv.groups = groups;
    lv.counts = counts;
  }

  function lvChipsHTML() {
    const g2 = lv.groups.map((g, k) => {
      const st = lv.f[g.id] || {};
      const c = lv.counts[k];
      let vals = g.vals.slice();
      if (g.many) vals.sort((a, b) => (c.get(b[0]) || 0) - (c.get(a[0]) || 0));
      const ql = (lv.more[g.id + ":q"] || "").toLowerCase();
      if (ql) vals = vals.filter(([, n, kw]) => n.toLowerCase().includes(ql) || (kw && kw.includes(ql)));
      const shown = g.many && !lv.more[g.id] ? vals.filter(([v], n) => n < 16 || st[v]) : vals;
      const chip = ([v, label]) => {
        const s = st[v] || 0, n = c.get(v) || 0;
        return `<button type="button" class="lbs-chip${s === 1 ? " -in" : s === -1 ? " -out" : ""}${n || s ? "" : " -zero"}" data-act="lv-chip" data-g="${g.id}" data-v="${esc(v)}" title="Click: only these · again: exclude · again: off">${s === -1 ? "−" : s === 1 ? "+" : ""}${esc(label)}<em>${fmt(n)}</em></button>`;
      };
      const on = Object.keys(st).length;
      const nInc = Object.values(st).filter((x) => x === 1).length, all = !!(lv.all && lv.all[g.id]);
      const anyAll = nInc > 1 ? `<span class="lbs-lv-anyall" role="group" aria-label="Match"><button type="button" data-act="lv-anyall" data-g="${g.id}" data-v="any" class="${all ? "" : "-on"}" title="Films with any of these (OR)">Any</button><button type="button" data-act="lv-anyall" data-g="${g.id}" data-v="all" class="${all ? "-on" : ""}" title="Films with all of these (AND)">All</button></span>` : "";
      return `<div class="lbs-lv-group"><h6>${esc(g.label)}${anyAll}${on ? `<button type="button" data-act="lv-clear-g" data-g="${g.id}">clear</button>` : ""}</h6>` +
        (g.note ? `<p class="lbs-lv-note">${esc(g.note)}</p>` : "") +
        (g.many ? `<input type="search" class="lbs-lv-gq" data-g="${g.id}" placeholder="Find a ${g.find || (g.id === "lang" ? "language" : "country")}" value="${esc(lv.more[g.id + ":q"] || "")}">` : "") +
        `<div class="lbs-chips">${shown.map(chip).join("")}` +
        (g.many && vals.length > shown.length ? `<button type="button" class="lbs-chip -more" data-act="lv-more" data-g="${g.id}">${fmt(vals.length - shown.length)} more…</button>` : "") +
        (g.many && lv.more[g.id] ? `<button type="button" class="lbs-chip -more" data-act="lv-more" data-g="${g.id}">fewer</button>` : "") +
        `</div>` +
        (g.years ? `<div class="lbs-lv-years">Years <input type="number" class="lbs-lv-y" data-y="y0" min="1880" max="2100" placeholder="from" value="${esc(lv.y0)}"> – <input type="number" class="lbs-lv-y" data-y="y1" min="1880" max="2100" placeholder="to" value="${esc(lv.y1)}"></div>` : "") +
        `</div>`;
    });
    return g2.join("");
  }
  const lvActive = () => Object.values(lv.f).reduce((n, st) => n + Object.keys(st).length, 0) + (lv.y0 ? 1 : 0) + (lv.y1 ? 1 : 0);

  function renderListView(box) {
    lvRun();
    if (box.dataset.mode !== "list") {
      box.dataset.mode = "list";
      box.innerHTML =
        `<div class="lbs-lib-head">${libModeHTML()}<span class="lbs-lv-headbtns"></span><span class="lbs-lib-gap"></span>` +
        `<button type="button" class="lbs-lib-x" data-act="lib" aria-label="Close the Library">${ICON_CLOSE}</button></div>` +
        `<div class="lbs-lv-tools"><label class="lbs-lv-search">${ICON_SEARCH}<input type="search" class="lbs-lv-q" placeholder="Filter by title" autocomplete="off" spellcheck="false"></label>` +
        `<div class="lbs-seg lbs-lv-sort"></div><button type="button" class="lbs-lv-ftoggle" data-act="lv-filters"></button></div>` +
        `<div class="lbs-lv-filters"></div>` +
        `<div class="lbs-lv-meta"></div>` +
        `<div class="lbs-lv-list" tabindex="0" role="listbox" aria-multiselectable="true"><div class="lbs-lv-spacer"></div></div>` +
        `<div class="lbs-lib-foot"></div>`;
      const list = $(".lbs-lv-list", box);
      list.addEventListener("scroll", () => { if (!lv.raf) lv.raf = requestAnimationFrame(() => { lv.raf = 0; lvPaint(); }); });
      list.addEventListener("keydown", lvKey);
      $(".lbs-lv-q", box).value = lv.q;
    }
    lvChrome(box);
    $(".lbs-lv-sort", box).innerHTML = [["pop", "Popular"], ["rating", "Rating"], ["title", "Title"], ["year", "Year"]].map(([v, l]) => `<button type="button" data-act="lv-sort" data-v="${v}" class="${lv.sort === v ? "-on" : ""}">${l}</button>`).join("");
    const nAct = lvActive();
    $(".lbs-lv-ftoggle", box).innerHTML = `Filters${nAct ? ` <em>${nAct}</em>` : ""} ${lv.showFilters ? "▴" : "▾"}`;
    const fl = $(".lbs-lv-filters", box);
    fl.hidden = !lv.showFilters;
    if (lv.showFilters) {
      const keepFocus = document.activeElement && fl.contains(document.activeElement) && document.activeElement.matches("input") ? [document.activeElement.className, document.activeElement.dataset.g || document.activeElement.dataset.y, document.activeElement.selectionStart] : null;
      const st = fl.scrollTop;
      fl.innerHTML = lvChipsHTML();
      fl.scrollTop = st;
      if (keepFocus) {
        const el = [...fl.querySelectorAll("input")].find((x) => x.className === keepFocus[0] && (x.dataset.g || x.dataset.y) === keepFocus[1]);
        if (el) { el.focus(); try { el.setSelectionRange(keepFocus[2], keepFocus[2]); } catch {} }
      }
    }
    $(".lbs-lv-spacer", box).style.height = `${lv.rows.length * LV_ROW}px`;
    box._selecting = lv.selecting;
    lvPaint();
  }
  // The parts that follow the selection (cheap: no filtering, no redraw of rows).
  function lvChrome(box) {
    const allSel = lv.rows.length > 0 && lv.rows.every((r) => rowSel(r) === 2);
    const nAct = lvActive();
    $(".lbs-lv-headbtns", box).innerHTML =
      `<button type="button" class="lbs-lv-check${lv.selecting ? " -on" : ""}" data-act="lv-selmode" aria-pressed="${lv.selecting}" title="Select films (Shift- or Option-click also starts this)">✓</button>` +
      (lv.selecting ? `<button type="button" class="lbs-lv-all" data-act="${allSel ? "lv-none" : "lv-all"}">${allSel ? "Deselect all in list" : "Select all in list"}</button>` : "");
    $(".lbs-lv-meta", box).innerHTML = `<b>${fmt(lv.nFilms)}</b> film${lv.nFilms === 1 ? "" : "s"}${lv.sel.size ? ` · ${fmt(lv.sel.size)} selected` : ""}${nAct || lv.q ? ` · <button type="button" data-act="lv-reset">Clear all filters</button>` : ""}`;
    lvFoot(box);
  }
  function lvRefreshSel() {
    const box = root && $(".lbs-library", root);
    if (!box || box.dataset.mode !== "list") return renderLibrary();
    if (box._selecting !== lv.selecting) { box._selecting = lv.selecting; lvPaint(); }
    else box.querySelectorAll(".lbs-lv-row").forEach((el) => {
      const r = lv.rows[+el.dataset.n];
      const st = r ? rowSel(r) : 0, on = st === 2;
      el.classList.toggle("-sel", on);
      el.classList.toggle("-part", st === 1);
      el.classList.toggle("-cur", +el.dataset.n === lv.cursor);
      el.setAttribute("aria-selected", on);
      const bub = el.querySelector(".lbs-lv-bub");
      if (bub) { bub.classList.toggle("-on", on); bub.classList.toggle("-part", st === 1); }
    });
    lvChrome(box);
  }
  function libModeHTML() {
    return `<div class="lbs-seg lbs-lib-mode" role="group" aria-label="View"><button type="button" data-act="lib-mode" data-v="folders" class="${lv.mode === "folders" ? "-on" : ""}">Folders</button><button type="button" data-act="lib-mode" data-v="list" class="${lv.mode === "list" ? "-on" : ""}">List</button></div>`;
  }
  // Only the rows in view are drawn (there can be 80,000).
  function lvPaint() {
    const box = root && $(".lbs-library", root);
    const list = box && $(".lbs-lv-list", box);
    if (!list) return;
    const sp = $(".lbs-lv-spacer", list);
    const first = Math.max(0, Math.floor(list.scrollTop / LV_ROW) - 8);
    const last = Math.min(lv.rows.length, Math.ceil((list.scrollTop + list.clientHeight) / LV_ROW) + 8);
    let html = "";
    for (let n = first; n < last; n++) {
      const r = lv.rows[n], st = rowSel(r), on = st === 2;
      const tail = r.path[0] === UNCAT ? "" : r.path.slice(1).map(nameOf).join(" › ");
      const pslug = r.fr ? r.members[0] : r.slug;
      html +=
        `<div class="lbs-lv-row${on ? " -sel" : st ? " -part" : ""}${r.fr ? " -fr" : ""}${r.member ? " -member" : ""}${r.dim ? " -dim" : ""}${lv.cursor === n ? " -cur" : ""}" style="top:${n * LV_ROW}px" data-n="${n}" data-slug="${esc(r.slug)}" data-name="${esc(r.name)}" role="option" aria-selected="${on}">` +
        (lv.selecting ? `<span class="lbs-lv-bub${on ? " -on" : st ? " -part" : ""}" data-bub="1"></span>` : "") +
        (r.fr ? `<button type="button" class="lbs-lv-twist" data-act="lv-fr-toggle" data-fr="${esc(r.fr)}" aria-label="Show its films">${lv.open.has(r.fr) ? "▾" : "▸"}</button>` : "") +
        `<img data-lvp="${esc(pslug)}" src="${posterCache.has(pslug) ? esc(posterCache.get(pslug)[0]) : EMPTY}" alt="">` +
        (r.fr
          ? `<span class="lbs-lv-t"><b>${esc(r.name)}</b> <button type="button" class="lbs-frbadge" data-act="fr-open" data-fr="${esc(r.fr)}">Franchise · ${fmt(r.members.length)}</button></span>`
          : `<span class="lbs-lv-t">${esc(titleOf(r.name))} <i>${r.year || ""}</i></span>`) +
        (r.v.status.includes("held") ? `<em class="-inv">Inv</em>` : "") + 
        `<small title="${esc([nameOf(r.path[0]), tail].join(" › "))}"><b>${esc(nameOf(r.path[0]))}</b> ${esc(r.path.length > 1 ? tail : "")}</small></div>`;
    }
    sp.innerHTML = html;
    clearTimeout(lv.posterT);
    lv.posterT = setTimeout(() => {
      sp.querySelectorAll("img[data-lvp]").forEach((im) => { if (!posterCache.has(im.dataset.lvp)) posterFor(im.dataset.lvp).then(([u]) => corsSrc(im, u)).catch(() => {}); });
    }, 150);
  }
  const rowSlugs = (r) => (r.fr ? r.members : [r.slug]);
  const rowSel = (r) => { const xs = rowSlugs(r); const n = xs.filter((x) => lv.sel.has(x)).length; return n === 0 ? 0 : n === xs.length ? 2 : 1; };
  const lvFilms = () => [...lv.sel].filter((x) => lib.place.has(x)).map((x) => [x, lib.names.get(x) || x]);
  function lvFoot(box) {
    const foot = $(".lbs-lib-foot", box);
    const n = lv.sel.size;
    if (n > 1 || (n === 1 && lv.selecting)) {
      foot.innerHTML = `<div class="lbs-lib-acts"><b class="lbs-lv-n">${fmt(n)} selected</b>` +
        `<button type="button" class="-go" data-act="lv-move">Move to…</button>` +
        `<button type="button" data-act="lv-hold">Add to inventory</button>` +
        `<button type="button" class="-link" data-act="lv-clear">Deselect</button></div>`;
      return;
    }
    const sel = libUI.sel;
    if (!sel) { foot.innerHTML = `<div class="lbs-lib-acts"><p class="lbs-lib-tip">Click a film to select it. Shift- or Option-click (or the ✓) to pick several, then Move to… a folder. Right-click for more.</p></div>`; return; }
    const at = lib.place.get(sel[0]);
    foot.innerHTML =
      `<div class="lbs-lib-sel"><img data-poster="${esc(sel[0])}" alt=""><div><b>${esc(titleOf(sel[1]))}</b> <span>${yearOf(sel[1]) || ""}</span><small>${at ? `In ${esc(pathOf(at).join(" › "))}` : ""}</small></div>` +
      `<button type="button" class="lbs-lib-x -small" data-act="lv-clear" aria-label="Deselect">${ICON_CLOSE}</button></div>` +
      `<div class="lbs-lib-acts"><button type="button" class="-go" data-act="lv-move">Move to…</button>` +
      `<button type="button" data-act="f-open" data-slug="${esc(sel[0])}" data-name="${esc(sel[1])}">Details</button>` +
      `<button type="button" data-act="f-jump" data-slug="${esc(sel[0])}" data-name="${esc(sel[1])}">Jump to section</button>` +
      `<button type="button" data-act="lib-fr">${franchiseOf(sel[0]) ? "Franchise" : "Add to franchise"}</button></div>`;
    fillPosters(foot, false);
  }
  function lvSetSel(set) {
    lv.sel = set;
    const one = lv.sel.size === 1 ? [...lv.sel][0] : null;
    libUI.sel = one ? [one, lib.names.get(one) || one] : null;
    libUI.focus = libUI.sel ? { film: libUI.sel } : null;
  }
  function lvRange(a, b) { const out = []; for (let n = Math.min(a, b); n <= Math.max(a, b); n++) if (lv.rows[n]) out.push(...rowSlugs(lv.rows[n])); return out; }
  function lvClickRow(row, e) {
    const n = +row.dataset.n, r = lv.rows[n];
    if (!r) return;
    const xs = rowSlugs(r);
    if (e.shiftKey || e.altKey || e.metaKey || e.ctrlKey) lv.selecting = true;
    if (e.shiftKey && lv.anchor != null) {
      const s2 = new Set(lv.sel);
      for (const x of lvRange(lv.anchor, n)) s2.add(x);
      lvSetSel(s2);
    } else if (lv.selecting) {
      const s2 = new Set(lv.sel), all = rowSel(r) === 2;
      for (const x of xs) if (all) s2.delete(x); else s2.add(x);
      lvSetSel(s2);
      lv.anchor = n;
    } else {
      lvSetSel(new Set(xs));
      lv.anchor = n;
    }
    lv.cursor = n;
    lvRefreshSel();
  }
  function lvKey(e) {
    if (e.target.matches("input")) return;
    const N = lv.rows.length;
    if (!N) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === "a") { e.preventDefault(); lv.selecting = true; lvSetSel(new Set(lv.rows.flatMap(rowSlugs))); return lvRefreshSel(); }
    if (e.key === "Escape") { if (lv.selecting || lv.sel.size) { e.stopPropagation(); lv.selecting = false; lvSetSel(new Set()); lvRefreshSel(); } return; }
    if (e.key === "Enter" && lv.cursor != null) { const r = lv.rows[lv.cursor]; return r.fr ? openFranchiseById(r.fr) : openFilm(r.slug, r.name); }
    if ((e.key === "ArrowRight" || e.key === "ArrowLeft") && lv.cursor != null && lv.rows[lv.cursor].fr) {
      const fid = lv.rows[lv.cursor].fr;
      if (e.key === "ArrowRight") lv.open.add(fid); else lv.open.delete(fid);
      return renderLibrary();
    }
    if (e.key === " " && lv.cursor != null) {
      e.preventDefault();
      lv.selecting = true;
      const r = lv.rows[lv.cursor], s2 = new Set(lv.sel), all = rowSel(r) === 2;
      for (const x of rowSlugs(r)) if (all) s2.delete(x); else s2.add(x);
      lvSetSel(s2);
      return lvRefreshSel();
    }
    const step = e.key === "ArrowDown" ? 1 : e.key === "ArrowUp" ? -1 : e.key === "PageDown" ? 15 : e.key === "PageUp" ? -15 : 0;
    if (!step) return;
    e.preventDefault();
    const was = lv.cursor == null ? (step > 0 ? -1 : N) : lv.cursor;
    const n = Math.max(0, Math.min(N - 1, was + step));
    lv.cursor = n;
    if (e.shiftKey) {
      lv.selecting = true;
      if (lv.anchor == null) lv.anchor = was < 0 || was >= N ? n : was;
      const s2 = new Set(lv.sel);
      for (const x of lvRange(lv.anchor, n)) s2.add(x);
      lvSetSel(s2);
    } else if (!lv.selecting) { lvSetSel(new Set(rowSlugs(lv.rows[n]))); lv.anchor = n; }
    const list = $(".lbs-library .lbs-lv-list", root);
    if (n * LV_ROW < list.scrollTop) list.scrollTop = n * LV_ROW;
    else if ((n + 1) * LV_ROW > list.scrollTop + list.clientHeight) list.scrollTop = (n + 1) * LV_ROW - list.clientHeight;
    lvRefreshSel();
  }

  // Move to…: every folder in the store, filterable, one click to file the selection there.
  // Move to…: the Library's own folder columns, in "pick a destination"
  // mode (make or delete folders right there), then Move here.
  function openMovePick(films) {
    if (!films.length) return;
    libUI.picking = { films, back: libUI.picking ? libUI.picking.back : lv.mode };
    lv.mode = "folders";
    libUI.adding = null;
    setLibrary(true);
  }
  function closeMovePick() {
    if (!libUI.picking) return;
    lv.mode = libUI.picking.back;
    libUI.picking = null;
  }

  // Old name, same tool now: "Sort" opens the Library on the film.
  // Right-click → Sort: the same folder picker as Move to…, starting at the
  // film's current folder (or the store's top level if it's uncategorized).
  const openSort = (slug, name) => {
    const at = lib.place.get(slug);
    const p = at ? partsOf(at) : {};
    libUI.path = at && p.genre !== UNCAT ? [p.genre, p.cat, p.sub, p.niche].filter(Boolean) : [];
    const many = lv.sel.size > 1 && lv.sel.has(slug);
    openMovePick(many ? lvFilms() : [[slug, name || lib.names.get(slug) || slug]]);
  };
  const renderSortPanel = () => renderLibrary();

  /* Franchises: films that belong together on the shelf, in a set order.
   * They all sit where the first one would, as one block, with a sticker
   * on the back wall behind them. */
  const franchises = () => mine.franchises || (mine.franchises = {});
  const franchiseOf = (slug) => { for (const [id, f] of Object.entries(allFranchises())) if (f.films.some(([s]) => s === slug)) return { id, ...f }; return null; };
  function openFranchise(slug, name) {
    const fr = franchiseOf(slug);
    ui.fr = fr ? { id: fr.id, name: fr.name, films: fr.films.slice(), color: fr.color, logo: fr.logo } : { id: null, name: `${titleOf(name)} series`, films: [[slug, name]] };
    renderFranchise();
  }
  function renderFranchise() {
    const box = $(".lbs-ask", root);
    const fr = ui.fr;
    if (!fr) { box.hidden = true; return; }
    box.innerHTML =
      `<div class="lbs-fr" role="dialog" aria-label="Franchise">` +
      `<div class="lbs-fr-top"><input type="text" class="lbs-fr-name" value="${esc(fr.name)}" maxlength="60" aria-label="Franchise name"><button type="button" class="lbs-sp-x" data-act="fr-close" aria-label="Close">${ICON_CLOSE}</button></div>` +
      `<p>Drag to set the order. They'll sit together on the shelf where #1 would go.</p>` +
      `<ol class="lbs-fr-list">` +
      fr.films.map(([s, n], i) => {
        const sec = filmSection(s), home = filmSection(fr.films[0][0]);
        return `<li data-dnd="fr" data-i="${i}"${i && sec && sec !== home ? ' class="-other"' : ""}><img data-poster="${esc(s)}" alt="" draggable="false"><b>${i + 1}</b>${yearOf(n) ? `<i>${yearOf(n)}</i>` : ""}<span>${esc(titleOf(n))}<small>${sec ? esc(nameOf(sec)) : ""}${i && sec && sec !== home ? ` · moves to ${esc(nameOf(home))}` : ""}</small></span><button type="button" data-act="fr-drop" data-i="${i}" aria-label="Remove">${ICON_CLOSE}</button></li>`;
      }).join("") +
      `</ol>` +
      `<label class="lbs-fr-find">${ICON_SEARCH}<input type="search" class="lbs-fr-q" placeholder="Add a film from anywhere in the store…" autocomplete="off"></label><ul class="lbs-fr-results" hidden></ul>` +
      stickerHTML(fr) +
      `<div class="lbs-fr-foot">${fr.id ? '<button type="button" class="lbs-sp-link" data-act="fr-delete">Undo franchise</button>' : "<span></span>"}<button type="button" class="lbs-sp-move" data-act="fr-save"${fr.films.length > 1 ? "" : " disabled"}>Save franchise</button></div>` +
      `</div>`;
    box.hidden = false;
    fillPosters(box, false);
  }
  // The sticker on the back wall: its colour, and any of #1's logos.
  function stickerHTML(fr) {
    const lead = fr.films[0];
    if (!lead) return "";
    const own = fr.color || (colorOf(lead[0]) ? colorOf(lead[0]).slice(0, 6) : "5a4a7a");
    const list = ui.frLogos && ui.frLogos.slug === lead[0] ? ui.frLogos.list : null;
    if (!list) allLogos(lead[0]).then((l) => { ui.frLogos = { slug: lead[0], list: l }; if (ui.fr) renderFranchise(); });
    const cur = fr.logo || logoPath(lead[0]);
    return (
      `<div class="lbs-fr-sticker"><b>Sticker</b>` +
      `<label class="lbs-fcolor">Colour ${swatchHTML("lbs-fr-color", `#${own.replace("#", "")}`)}</label>` +
      `<div class="lbs-flogos">` +
      (list ? list.map((pth) => `<button type="button" data-act="fr-logo" data-path="${esc(pth)}" class="${cur === pth ? "-on" : ""}"><img src="${TMDB_IMG}w185/${esc(pth)}" alt="" loading="lazy"></button>`).join("") : `<p class="lbs-fwait">Fetching ${esc(titleOf(lead[1]))}'s logos…</p>`) +
      `</div></div>`
    );
  }
  function franchiseSearch(q) {
    const list = $(".lbs-fr-results", root);
    q = q.trim().toLowerCase();
    if (!q) { list.hidden = true; return; }
    // The whole store, every section: this section's films first.
    const have = new Set(ui.fr.films.map(([s]) => s));
    const home = ui.fr.films[0] && filmSection(ui.fr.films[0][0]);
    const hits = [];
    for (const [slug, name] of stock.films) {
      if (have.has(slug) || !lib.place.has(slug)) continue;
      const t = titleOf(name).toLowerCase();
      if (!t.includes(q)) continue;
      const sec = filmSection(slug);
      hits.push([(sec === home ? 0 : 2) + (t.startsWith(q) ? 0 : 1), slug, name, sec]);
      if (hits.length >= 60) break;
    }
    hits.sort((a, b) => a[0] - b[0]);
    list.innerHTML = hits.length
      ? hits.slice(0, 10).map(([, s, n, sec]) => `<li data-act="fr-add" data-slug="${esc(s)}" data-name="${esc(n)}"${sec && sec !== home ? ' class="-other"' : ""}><b>${esc(titleOf(n))}</b> <span>${yearOf(n) || ""}</span><small>${sec ? esc(nameOf(sec)) : ""}${sec && sec !== home ? " · other section" : ""}</small></li>`).join("")
      : `<li class="-none">No store films match.</li>`;
    list.hidden = false;
  }
  function saveFranchise() {
    const fr = ui.fr;
    fr.name = ($(".lbs-fr-name", root)?.value || fr.name).trim() || fr.name;
    const id = fr.id || `fr-${slugify(fr.name)}-${Date.now().toString(36)}`;
    // A film can only be in one franchise.
    for (const [oid, o] of Object.entries(franchises())) if (oid !== id) o.films = o.films.filter(([s]) => !fr.films.some(([x]) => x === s));
    franchises()[id] = { name: fr.name, films: fr.films, ...(fr.color ? { color: fr.color } : {}), ...(fr.logo ? { logo: fr.logo } : {}) };
    for (const [oid, o] of Object.entries(franchises())) if (o.films.length < 2) delete franchises()[oid];
    saveMine();
    shareEdit("franchise", id, { name: fr.name, films: fr.films.map(([s]) => s), color: fr.color || null, logo: fr.logo || null });
    ui.fr = null;
    renderFranchise();
    refresh();
    toast(`Saved “${fr.name}”: ${fr.films.length} films kept together on the shelf.`);
  }

  // Requests and shared edits: kept here, and sent to the store's log.
  function shareEdit(kind, target, value) {
    const q = mine.queue || (mine.queue = []);
    q.push({ kind, target, value, at: Date.now() });
    if (q.length > 500) q.splice(0, q.length - 500);
    saveMine();
    ext("edit", { kind, target, value }).catch(() => {});
  }
  function requestRemoval(kind, id, label) {
    ask(`Ask a moderator to remove <b>${esc(label)}</b> from the store?`, () => {
      shareEdit(`remove-${kind}`, id, null);
      toast("Thanks. A moderator will take a look.");
    }, "Yes, ask");
  }
  // Asking for a film to be added: say why, then Submit.
  function requestAddition(slug, name, btn) {
    const host = btn && btn.closest(".lbs-facts, li");
    if (btn && btn.closest(".lbs-find-list")) return showCard(slug, name, true);
    if (!host) return;
    let form = host.parentElement.querySelector(`.lbs-req[data-slug="${CSS.escape(slug)}"]`);
    if (!form) {
      form = h("div", "lbs-req", `<textarea maxlength="600" rows="3" placeholder="Why would you like this added to the store?"></textarea><div><button type="button" data-act="req-cancel">Cancel</button><button type="button" class="-go" data-act="req-send" data-slug="${esc(slug)}" data-name="${esc(name)}" disabled>Submit</button></div>`);
      form.dataset.slug = slug;
      host.after(form);
      const ta = form.querySelector("textarea"), go = form.querySelector("[data-act=req-send]");
      ta.addEventListener("input", () => (go.disabled = !ta.value.trim()));
      form.querySelector("[data-act=req-cancel]").addEventListener("click", () => form.remove());
    }
    btn.hidden = true;
    form.querySelector("textarea").focus();
  }
  function sendAddition(btn) {
    const form = btn.closest(".lbs-req");
    const why = form.querySelector("textarea").value.trim();
    if (!why) return;
    const { slug, name } = btn.dataset;
    shareEdit("add-film", slug, { name, why });
    (mine.requested || (mine.requested = {}))[slug] = Date.now();
    saveMine();
    const facts = form.previousElementSibling;
    form.remove();
    if (facts && facts.classList.contains("lbs-facts")) facts.outerHTML = filmActs(slug, name);
    toast(`Thanks. ‘${titleOf(name)}’ is on the list for a moderator to look at.`);
  }

  // Talk to the extension's background page (fetches, shared edits) through bridge.js.
  let extSeq = 0;
  function ext(type, payload) {
    return new Promise((ok, fail) => {
      const id = `x${++extSeq}${Date.now()}`;
      const on = (e) => {
        if (e.source !== window || !e.data || e.data.__lbni !== "ext-result" || e.data.id !== id) return;
        window.removeEventListener("message", on);
        clearTimeout(t);
        e.data.ok ? ok(e.data.data) : fail(new Error(e.data.reason || "failed"));
      };
      const t = setTimeout(() => { window.removeEventListener("message", on); fail(new Error("no answer")); }, 15000);
      window.addEventListener("message", on);
      window.postMessage({ __lbni: "ext", id, type, payload }, location.origin);
    });
  }

  // A small yes/no question over the store.
  function ask(text, yes, yesLabel, no) {
    const box = $(".lbs-ask", root);
    box.innerHTML = `<div class="lbs-ask-card"><p>${text}</p><div><button type="button" data-act="ask-no">No</button><button type="button" data-act="ask-yes" class="-go">${yesLabel || "Yes, change it"}</button></div></div>`;
    box.hidden = false;
    box._yes = yes;
    box._no = no || null;
  }

  function askFranchiseMove(films, target, partial) {
    const box = $(".lbs-ask", root);
    const inSet = new Set(films.map(([x]) => x));
    const extra = [];
    for (const fr of partial.values()) for (const f of fr.films) if (!inSet.has(f[0]) && !extra.some(([x]) => x === f[0])) extra.push(f);
    const frs = [...partial.values()];
    const mine1 = films.filter(([x]) => lib.frOf.get(x));
    const one = films.length === 1 && frs.length === 1;
    const where = pathOf(landingSub(target)).join(" › ");
    const text = one
      ? `‘${esc(titleOf(films[0][1]))}’ is part of <b>${esc(frs[0].name)}</b> (${frs[0].films.length} films).`
      : `${fmt(mine1.length)} of these film${mine1.length === 1 ? " is" : "s are"} in ${frs.length === 1 ? `<b>${esc(frs[0].name)}</b>` : `${frs.length} franchises (${frs.slice(0, 3).map((f) => `<b>${esc(f.name)}</b>`).join(", ")}${frs.length > 3 ? "…" : ""})`}, which ${frs.length === 1 ? "has" : "have"} ${fmt(extra.length)} more film${extra.length === 1 ? "" : "s"} not in this move.`;
    box.innerHTML =
      `<div class="lbs-ask-card"><p>${text}<br><small>Moving to ${esc(where)}.</small></p><div class="lbs-ask-col">` +
      `<button type="button" class="-go" data-act="frm-all">${one ? `Move all ${frs[0].films.length}` : `Move the whole franchise${frs.length === 1 ? "" : "s"} (+${fmt(extra.length)})`}</button>` +
      `<button type="button" data-act="frm-out">${one ? "Take it out of the franchise and move just this one" : "Take them out of their franchises and move just these"}</button>` +
      `<button type="button" data-act="ask-no">Cancel</button></div></div>`;
    box.hidden = false;
    box._yes = box._no = null;
    box._frm = { films, target, extra, partial };
  }
  // Take films out of whatever franchises they're in (a franchise left with one film is undone).
  function franchiseRemove(slugs) {
    const out = new Set(slugs);
    for (const [fid, fr] of Object.entries(allFranchises())) {
      if (!fr.films.some(([x]) => out.has(x))) continue;
      const films = fr.films.filter(([x]) => !out.has(x));
      if (films.length < 2) { delete franchises()[fid]; shareEdit("franchise", fid, null); continue; }
      franchises()[fid] = { name: fr.name, films, ...(fr.color ? { color: fr.color } : {}), ...(fr.logo ? { logo: fr.logo } : {}) };
      shareEdit("franchise", fid, { name: fr.name, films: films.map(([x]) => x), color: fr.color || null, logo: fr.logo || null });
    }
    saveMine();
  }

  // A film from your inventory dropped on the wall.
  function browseDrop(slug, name, t) {
    const from = filmSection(slug);
    const back = () => { releaseFilm(slug); renderPocket(); };
    if (!t.cid || t.cid === from) { back(); drawSoon(); return toast(`‘${titleOf(name)}’ is back on the shelf.`); }
    ask(`This is not the movie's original category${from ? ` (${esc(nameOf(from))})` : ""}. Change it to <b>${esc(nameOf(t.cid))}</b>?`, () => {
      back();
      moveFilms([[slug, name]], t.sub || `${t.cid}/general`);
    });
  }

  // The search box: matches as you type, in the store first, then all of Letterboxd.
  let findTimer = 0;
  // Search index for people and companies: directors, top-billed cast, every
  // company (2+ films) and the Studio labels, each with its film count.
  let whoIndex = null;
  function whoSearch(nq) {
    const C = catalogue;
    if (!C || nq.length < 3) return [];
    if (!whoIndex || whoIndex.cat !== C) {
      const cnt = new Map();
      const add = (k) => cnt.set(k, (cnt.get(k) || 0) + 1);
      C.films.forEach((f, i) => { for (const k of whoOf(C, i)) add(k); });
      const items = [];
      for (const [k, n] of cnt) {
        const t = k[0], name = t === "d" ? C.people[+k.slice(2)] : t === "c" ? (C.cast || [])[+k.slice(2)] : (C.co || [])[+k.slice(2)];
        if (name) items.push({ k, name, low: name.toLowerCase(), n, kind: t === "d" ? "Director" : t === "c" ? "Cast" : "Company" });
      }
      const F = buildFacts();
      if (F && F.studio) {
        const sc = new Map();
        F.studio.per.forEach((ts) => { if (ts) for (const t of ts) sc.set(t, (sc.get(t) || 0) + 1); });
        STUDIOS.forEach(([, label], t) => { if (sc.get(t)) items.push({ k: `studio:${t}`, name: label, low: label.toLowerCase(), n: sc.get(t), kind: "Studio" }); });
      }
      // a person who directs and acts is one entry per role; studios first
      whoIndex = { cat: C, items };
    }
    const hits = [];
    for (const it of whoIndex.items) {
      const at = it.low.startsWith(nq) ? 0 : it.low.includes(" " + nq) ? 1 : it.low.includes(nq) ? 2 : -1;
      if (at >= 0) hits.push([at, it.kind === "Studio" ? 0 : 1, -it.n, it]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2]);
    // a studio label hides the raw company of the same name
    const labels = new Set(hits.filter((h) => h[3].kind === "Studio").map((h) => h[3].low));
    return hits.map((h) => h[3]).filter((it) => it.kind === "Studio" || !labels.has(it.low)).slice(0, 5);
  }
  function openWho(k) {
    lv.f = k.startsWith("studio:") ? { studio: { [k.slice(7)]: 1 } } : { who: { [k]: 1 } };
    lv.y0 = lv.y1 = ""; lv.q = ""; lv.sel = new Set(); lv.sort = "pop";
    lv.mode = "list";
    saveLv();
    $(".lbs-find-list", root).hidden = true;
    $(".lbs-card", root).hidden = true;
    setLibrary(true);
  }

  function runFind(q) {
    const list = $(".lbs-find-list", root);
    q = q.trim();
    $(".lbs-card", root).hidden = true;
    if (q.length < 1) { list.hidden = true; return; }
    const nq = q.toLowerCase();
    const local = [];
    for (const [slug, name] of stock.films) {
      const t = titleOf(name).toLowerCase();
      const k = t.startsWith(nq) ? 0 : t.includes(" " + nq) ? 1 : t.includes(nq) ? 2 : -1;
      if (k >= 0) local.push([k, slug, name]);
      if (local.length > 400) break;
    }
    local.sort((a, b) => a[0] - b[0]);
    const where = (path) => (path[0] === "Uncategorized" ? "Uncategorized" : path.slice(1).join(" › "));
    const item = (slug, name, inStore, sub) => {
      const path = inStore ? whereIs(slug) : null;
      return `<li data-act="find-pick" data-slug="${esc(slug)}" data-name="${esc(name)}"${sub ? ' class="-sub"' : ""}><img data-poster="${esc(slug)}" alt=""><div><b>${esc(titleOf(name))}</b> <span>${yearOf(name) || ""}</span><small>${path ? esc(where(path)) : "Not in the store"}</small>${inStore && !sub ? frBadge(slug) : ""}</div>${path ? "" : `<button type="button" class="lbs-find-req" data-act="req-add" data-slug="${esc(slug)}" data-name="${esc(name)}">Request addition</button>`}</li>`;
    };
    // Franchises whose name matches, each with its matching films beneath it.
    const frHits = Object.entries(lib.frs || {}).filter(([, f]) => f.name.toLowerCase().includes(nq)).slice(0, 4);
    const frItem = ([fid, f]) => `<li class="-fr" data-act="fr-open" data-fr="${esc(fid)}"><img data-poster="${esc(f.films[0][0])}" alt=""><div><b>${esc(f.name)}</b> <span>Franchise · ${f.films.length} films</span><small>${esc(where(whereIs(f.films[0][0]) || []))}</small></div><button type="button" class="lbs-find-req" data-act="fr-open" data-fr="${esc(fid)}">View</button></li>`;
    const top = local.slice(0, 8);
    const used = new Set();
    let html = whoSearch(nq).map((it) => `<li class="-who" data-act="find-who" data-k="${esc(it.k)}"><span class="lbs-who-ico">${it.kind === "Studio" || it.kind === "Company" ? "🎬" : esc(it.name.split(/\s+/).map((w) => w[0]).slice(0, 2).join(""))}</span><div><b>${esc(it.name)}</b> <span>${it.kind} · ${fmt(it.n)} film${it.n === 1 ? "" : "s"}</span><small>Show in the Library list</small></div></li>`).join("");
    for (const h of frHits) {
      html += frItem(h);
      for (const [, sl, nm] of top) if (lib.frOf.get(sl) === h[0]) { html += item(sl, nm, true, true); used.add(sl); }
    }
    html += top.filter(([, sl]) => !used.has(sl)).map(([, sl, nm]) => item(sl, nm, true)).join("");
    list.innerHTML = (html || `<li class="-none">Nothing in the store matches yet.</li>`) + `<li class="-more">Searching all of Letterboxd…</li>`;
    list.hidden = false;
    fillPosters(list, false);
    const seq = ++ui.findSeq;
    clearTimeout(findTimer);
    findTimer = setTimeout(async () => {
      let more = [];
      try {
        const j = await fetch(`/s/autocompletefilm?q=${encodeURIComponent(q)}&limit=12`, { credentials: "include" }).then((r) => r.json());
        const have = new Set(top.map(([, s]) => s));
        more = (j.data || []).map((f) => [f.slug || String(f.url || "").split("/").filter(Boolean).pop(), `${f.name}${f.releaseYear ? ` (${f.releaseYear})` : ""}`]).filter(([s]) => s && !have.has(s)).slice(0, 6);
      } catch {}
      if (seq !== ui.findSeq) return;
      const m = list.querySelector(".-more");
      if (m) m.outerHTML = more.length ? `<li class="-head">All of Letterboxd</li>` + more.map(([s, n]) => item(s, n, lib.place.has(s))).join("") : "";
      fillPosters(list, false);
    }, 200);
  }
  function showCard(slug, name, openReq) {
    const card = $(".lbs-card", root);
    $(".lbs-find-list", root).hidden = true;
    const path = whereIs(slug);
    card.innerHTML =
      `<button type="button" class="lbs-card-x" data-act="card-close" aria-label="Close">${ICON_CLOSE}</button>` +
      `<div class="lbs-card-body"><button type="button" class="lbs-card-poster" data-act="f-open" data-slug="${esc(slug)}" data-name="${esc(name)}"><img data-poster="${esc(slug)}" alt=""></button>` +
      `<div><b>${esc(titleOf(name))}</b> <span>${yearOf(name) || ""}</span>` +
      `<p>${path ? `${esc(path[1] || "")}${path[2] ? ` › ${esc(path[2])}` : ""}` : "Not in the store yet"}</p>` +
      `<button type="button" class="lbs-card-more" data-act="f-open" data-slug="${esc(slug)}" data-name="${esc(name)}">See the box and details</button></div></div>` +
      filmActs(slug, name);
    card.hidden = false;
    fillPosters(card, true);
    const rq = openReq && card.querySelector("[data-act=req-add]");
    if (rq) requestAddition(slug, name, rq);
  }

  /* ---------------- editing the store (moderators) ---------------- */

  function toggleEdit(on) {
    edit.on = on;
    edit.renaming = edit.deleting = null;
    if (!on) edit.sel = null;
    root.classList.toggle("lbs-editing", on);
    root.classList.toggle("lbs-browsing", !on);
    if (!on) { desk.mode = "store"; closeFilm(); }
    const b = $(".lbs-edit-toggle", root);
    if (b) { b.setAttribute("aria-pressed", on); b.textContent = on ? "Leave dev mode" : "Dev mode"; }
    refresh();
    if (on) toast("Editing the house plan: what everyone sees. Zoom out to move sections between the shelves and your inventory.");
  }

  function renderEditBar() {
    const bar = $(".lbs-editbar", root);
    if (!bar) return;
    bar.hidden = !edit.on;
    if (!edit.on) return;
    const pending = !!houseLocal;
    bar.innerHTML =
      `<b>Dev mode</b><span>${pending ? "Unpublished changes in this browser" : "No changes yet"}</span>` +
      `<button type="button" data-act="h-undo"${edit.undo.length ? "" : " disabled"}>Undo</button>` +
      `<button type="button" data-act="h-save"${pending ? "" : " disabled"}>Download plan</button>` +
      `<button type="button" data-act="h-discard"${pending ? "" : " disabled"}>Discard</button>`;
  }

  /* The bucket: pieces that aren't on the wall. Drag them onto a shelf; drag
   * a piece off the wall (from afar, where pieces show as blocks) back here. */
  // Inventory: films you're carrying between the wall and the folders (and,
  // for a moderator, the sections still to place).
  const heldList = () => (edit.on ? house().held : mine.held || []);
  function renderTray() {
    const tray = root && $(".lbs-tray", root);
    if (!tray) return;
    const placing = edit.on && desk.mode === "store" && wall.level === "wall" && wall.lay;
    const list = placing ? wall.lay.bucket : [], held = heldList();
    const spine = ([slug, name]) => {
      const c = colors[slug];
      return `<div class="lbs-dvd" data-slug="${esc(slug)}" data-name="${esc(name)}" style="--c:${c ? `#${c.slice(0, 6)}` : "#2c3440"}" title="${esc(name)}">${esc(titleOf(name))}</div>`;
    };
    tray.innerHTML =
      `<div class="lbs-tray-top"><b>Inventory</b>${held.length ? `<span>${fmt(held.length)} film${held.length === 1 ? "" : "s"}</span>` : ""}</div>` +
      (placing
        ? `<div class="lbs-tray-tools"><span class="lbs-grabtype">Grab <button type="button" data-act="grab" data-v="one" class="${edit.grab === "one" ? "-on" : ""}">Individual</button><button type="button" data-act="grab" data-v="group" class="${edit.grab === "group" ? "-on" : ""}">Group</button></span>` +
          `<span><button type="button" data-act="w-auto">Auto-arrange</button><button type="button" data-act="w-clear">Everything down</button></span></div>` +
          `<h4>Blocks to place <select class="lbs-tray-filter" aria-label="Show blocks from"><option value="">All categories</option>${[...new Set(list.map((pc) => pc.cat))].map((c) => `<option value="${esc(c)}"${edit.filter === c ? " selected" : ""}>${esc(roomGenres().length > 1 ? pathOf(c).join(" › ") : nameOf(c))}</option>`).join("")}</select></h4>` +
          `<div class="lbs-tray-list">` +
          (list.length
            ? list.filter((pc) => !edit.filter || pc.cat === edit.filter).map((pc) => {
                const n = pc.size / CAP;
                const label = pc.sec === pc.cat ? nameOf(pc.sec) : nameOf(pc.sec);
                return `<div class="lbs-piece -sec" data-cid="${esc(pc.sec)}" style="width:${Math.round(40 + Math.min(1, n) * 200)}px;height:${Math.round(26 + Math.min(5, Math.max(0, Math.ceil(n) - 1)) * 9)}px;--h:${secHue(pc.n)}" title="${esc(pathOf(pc.sec).slice(1).join(" › "))}: ${pc.count} films still to place"><b>${esc(label)}</b><small>${esc(nameOf(pc.cat))}</small><span>${n < 0.95 ? `${Math.round(n * 100)}% shelf` : `${n.toFixed(1)} shelves`}</span></div>`;
              }).join("")
            : `<p class="lbs-tray-empty">Everything is on the wall. Drop a block on a shelf and it fills the free space there; the rest waits here.</p>`) +
          `</div><h4>Films</h4>`
        : "") +
      `<div class="lbs-tray-list -films">` +
      (held.length ? held.map(spine).join("") : `<p class="lbs-tray-empty">Drag films here to carry them between the wall and your folders.</p>`) +
      `</div>`;
  }
  // Put films in the inventory.
  function holdFilms(films) {
    const add = (list) => { for (const [slug, name] of films) if (!list.some(([x]) => x === slug)) list.push([slug, name]); };
    if (edit.on) return houseEdit(films.length === 1 ? `‘${titleOf(films[0][1])}’ is in your inventory.` : `${films.length} films in your inventory.`, (H) => add(H.held));
    add(mine.held);
    saveMine();
    renderTray();
    renderPocket();
    renderLibrary();
  }
  function releaseFilm(slug) {
    if (edit.on) return; // house moves clear it themselves
    mine.held = mine.held.filter(([x]) => x !== slug);
    saveMine();
    renderLibrary();
  }

  // A drag is either a section from the workspace (cid) or a piece on the wall (ref "bay:shelf/slot").
  const grabSize = (g) => (g.ref ? wall.refs.refU.get(g.ref) : (wall.lay.bucket.find((x) => x.sec === g.cid) || {}).size || CAP);
  const grabCid = (g) => (g.ref ? wall.refs.refCid.get(g.ref) : g.cid);
  const shelvesNow = () => JSON.parse(JSON.stringify(wall.plan.shelves || {}));

  // Where a dragged section or piece would land: it fills the free space on
  // that shelf, up to what it has.
  function dropTarget(g, sx, sy) {
    const L = wall.lay, p = toWall(sx, sy);
    const { b, s } = bayAt(p);
    if (b < 0 || b >= L.bays || s < 0 || s >= WU.shelves) return null;
    const key = `${b}:${s}`;
    const list = (wall.plan.shelves[key] || []).map((pc, i) => ({ ...pc, ref: `${key}/${i}` })).filter((pc) => pc.ref !== g.ref);
    const runs = list.map((pc) => L.runs.find((r) => r.ref === pc.ref)).filter(Boolean);
    const at = runs.filter((r) => (r.x0 + r.x1) / 2 < p.x).length;
    const free = CAP - list.reduce((n, pc) => n + pc.u, 0) - BOOKEND * list.length;
    const size = Math.min(grabSize(g), free);
    const x = at === 0 ? L.origin(b).x + WU.pad : runs[at - 1].x1 + BOOKEND;
    return { key, at, size, bay: b, shelf: s, x, w: Math.max(size, 8), ok: size >= MIN_PIECE };
  }

  function placeGrab(g, t) {
    const sh = shelvesNow();
    const cid = grabCid(g);
    let had = grabSize(g);
    if (g.ref) {
      const [k, slot] = g.ref.split("/");
      sh[k].splice(+slot, 1);
      if (!sh[k].length) delete sh[k];
    }
    (sh[t.key] ||= []).splice(t.at, 0, { c: cid, u: Math.round(t.size) });
    const rest = had - t.size;
    houseEdit(rest > 2 ? `${nameOf(cid)}: filled that space; the rest is in the inventory.` : `Placed ${nameOf(cid)}.`, (H) => setPlan(H, sh));
  }
  /* Group grab: every piece of the section moves together. Each keeps its
   * size and its position relative to the piece you picked up (in bays,
   * shelves and inches along the shelf). It only lands if every piece fits. */
  const groupRefs = (cid) => wall.lay.runs.filter((r) => wall.refs.refCid.get(r.ref) === cid && wall.plan.shelves[`${r.bay}:${r.shelf}`]);
  function groupTarget(g, sx, sy) {
    const L = wall.lay, p = toWall(sx, sy);
    const { b, s } = bayAt(p);
    if (b < 0 || s < 0 || s >= WU.shelves) return null;
    const cid = grabCid(g), perRow = L.k;
    const members = groupRefs(cid);
    const anchor = members.find((r) => r.ref === g.ref);
    if (!anchor) return null;
    const mine = new Set(members.map((r) => r.ref));
    const grid = (bay, shelf) => [bay % perRow, Math.floor(bay / perRow) * WU.shelves + shelf];
    const [ac, ar] = grid(anchor.bay, anchor.shelf), [tc, tr] = grid(b, s);
    // Shift along the shelf: where the picked-up piece's left edge would now sit.
    const shiftX = p.x - L.origin(b).x - (wall.grabAt || 0) - (anchor.x0 - L.origin(anchor.bay).x);
    const load = new Map(); // key -> units already taken (others + group pieces landing there)
    const items = [];
    let ok = true;
    for (const r of members) {
      const [c, row] = grid(r.bay, r.shelf);
      const col = c - ac + tc, rr = row - ar + tr;
      const bay = Math.floor(rr / WU.shelves) * perRow + col, shelf = rr % WU.shelves;
      const u = wall.refs.refU.get(r.ref);
      if (col < 0 || col >= perRow || rr < 0 || bay >= L.bays) { ok = false; continue; }
      const key = `${bay}:${shelf}`;
      if (!load.has(key)) {
        const others = (wall.plan.shelves[key] || []).map((pc, i) => ({ ...pc, ref: `${key}/${i}` })).filter((pc) => !mine.has(pc.ref));
        load.set(key, { used: others.reduce((n, pc) => n + pc.u, 0), n: others.length });
      }
      const ld = load.get(key);
      ld.used += u; ld.n++;
      if (ld.used + BOOKEND * (ld.n - 1) > CAP * 1.01) ok = false;
      const x = L.origin(bay).x + Math.max(WU.pad, Math.min(WU.pad + CAP - u, r.x0 - L.origin(r.bay).x + shiftX));
      items.push({ ref: r.ref, c: cid, u, key, bay, shelf, x, w: u });
    }
    return { group: true, cid, items, ok: ok && items.length === members.length };
  }
  function placeGroup(t) {
    const L = wall.lay;
    const sh = shelvesNow();
    const mine = new Set(t.items.map((it) => it.ref));
    // Take the group off, remembering where everything else sits.
    const rest = {};
    for (const [key, list] of Object.entries(sh)) {
      rest[key] = list.map((pc, i) => ({ pc, ref: `${key}/${i}` })).filter((e) => !mine.has(e.ref)).map((e) => {
        const r = L.runs.find((x) => x.ref === e.ref);
        return { pc: e.pc, x: r ? (r.x0 + r.x1) / 2 : 0 };
      });
    }
    for (const it of t.items) (rest[it.key] ||= []).push({ pc: { c: it.c, u: it.u }, x: it.x + it.u / 2 });
    const out = {};
    for (const [key, list] of Object.entries(rest)) if (list.length) out[key] = list.sort((a, b) => a.x - b.x).map((e) => e.pc);
    houseEdit(`Moved all of ${nameOf(t.cid)}.`, (H) => setPlan(H, out));
  }

  // Group grab from the inventory: pour the whole section in from where you
  // drop it, filling free space shelf by shelf (down the bay, then on).
  function pourTarget(g, sx, sy) {
    const L = wall.lay, p = toWall(sx, sy);
    let { b, s } = bayAt(p);
    if (b < 0 || b >= L.bays || s < 0 || s >= WU.shelves) return null;
    const items = (wall.leftovers && wall.leftovers.get(g.cid)) || [];
    const out = [];
    let k = 0, first = true;
    while (k < items.length && b < L.bays) {
      const key = `${b}:${s}`;
      const list = wall.plan.shelves[key] || [];
      const free = CAP - list.reduce((n, pc) => n + pc.u, 0) - BOOKEND * list.length;
      let at = 0;
      if (first) {
        const runs = list.map((_, i) => L.runs.find((r) => r.ref === `${key}/${i}`)).filter(Boolean);
        at = runs.filter((r) => (r.x0 + r.x1) / 2 < p.x).length;
      }
      let u = 0, j = k;
      while (j < items.length && u + items[j].w + 1 <= free) u += items[j++].w + 1;
      // Skip gaps too small to bother with (unless it's the last few films).
      if (u >= MIN_PIECE || (u > 0 && j >= items.length)) {
        k = j;
        const runs = list.map((_, i) => L.runs.find((r) => r.ref === `${key}/${i}`)).filter(Boolean);
        const x = at === 0 ? L.origin(b).x + WU.pad : runs[at - 1].x1 + BOOKEND;
        out.push({ key, at, u, bay: b, shelf: s, x, w: u });
      }
      first = false;
      if (++s >= WU.shelves) { s = 0; b++; }
    }
    return { group: true, pour: true, cid: g.cid, items: out, ok: k >= items.length && out.length > 0 };
  }
  function placePour(t) {
    const sh = shelvesNow();
    for (const it of t.items) (sh[it.key] ||= []).splice(it.at, 0, { c: t.cid, u: it.u });
    houseEdit(`Poured all of ${nameOf(t.cid)} onto ${t.items.length} shel${t.items.length === 1 ? "f" : "ves"}.`, (H) => setPlan(H, sh));
  }

  function unplaceGrab(g) {
    const sh = shelvesNow();
    const [k, slot] = g.ref.split("/");
    sh[k].splice(+slot, 1);
    if (!sh[k].length) delete sh[k];
    houseEdit(`Took ${nameOf(grabCid(g))} down to the inventory.`, (H) => setPlan(H, sh));
  }

  // Where a DVD dropped at (sx, sy) on the canvas would go.
  function dvdTarget(slug, sx, sy) {
    const L = wall.lay, p = toWall(sx, sy);
    const { b, s: sh } = bayAt(p);
    const run = L.runs.find((r) => r.bay === b && r.shelf === sh && p.x >= r.x0 - BOOKEND && p.x <= r.x1 + BOOKEND);
    if (!run) return null;
    const cid = L.secs[run.sec].id;
    const here = (L.chunks.get(`${b}:${sh}`) || []).map((i) => L.films[i]).filter((f) => f.sec === run.sec && f.slug !== slug && f.x >= run.x0 - 1 && f.x <= run.x1 + 1);
    let near = null, best = Infinity;
    for (const f of here) { const d = Math.abs(f.x + f.w / 2 - p.x); if (d < best) { best = d; near = f; } }
    const after = near ? p.x > near.x + near.w / 2 : true;
    const same = filmSection(slug) === cid;
    const ok = !edit.on || !same || sortOf(cid) === "index";
    const lineX = near ? (after ? near.x + near.w + 1 : near.x - 1) : run.x0;
    return { dvd: true, cid, target: near && near.slug, sub: near && near.sub, after, ok, same, bay: b, shelf: sh, x: lineX - 2, w: 4 };
  }
  const filmSection = (slug) => { const sub = lib.place.get(slug); return sub && lib.subs.has(sub) ? lib.subs.get(sub).cat : null; };

  function dropDvd(slug, name, t) {
    const cid = t.cid;
    const order = sectionOrder(cid).map((f) => f.slug).filter((x) => x !== slug);
    let at = t.target ? order.indexOf(t.target) + (t.after ? 1 : 0) : order.length;
    if (at < 0) at = order.length;
    order.splice(at, 0, slug);
    houseEdit(t.same ? `Moved ‘${titleOf(name)}’.` : `‘${titleOf(name)}’ → ${nameOf(cid)}`, (H) => {
      H.held = H.held.filter(([x]) => x !== slug);
      if (!t.same) H.place[slug] = [t.sub || `${cid}/general`, name];
      if ((H.sort[cid] || "title") === "index") H.index[cid] = order;
    });
  }

  // One drag system for pieces and DVDs: canvas, workspace and folders.
  let grab = null; // { kind: "piece"|"dvd", ref | slug+name, from: "wall"|"tray", x, y, live, ghost }
  function grabDown(g, e) { grab = { ...g, x: e.clientX, y: e.clientY, live: false }; }
  window.addEventListener("mousemove", (e) => {
    const d = grab;
    if (!d) return;
    if (!(e.buttons & 1)) return cancelAllDrags(); // released outside the window
    if (!d.live) {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 5) return;
      d.live = true;
      if (d.kind === "piece" && !d.ref && edit.grab === "group") {
        d.pour = true;
        d.ghost = h("div", "lbs-piece lbs-piece-ghost", `<b>${esc(nameOf(d.cid))}</b><span>all</span>`);
        d.ghost.style.setProperty("--h", hueOfBlock(d.cid));
      } else if (d.kind === "piece" && d.ref && edit.grab === "group") {
        const cid = grabCid(d), n = groupRefs(cid).length;
        d.group = true;
        d.ghost = h("div", "lbs-piece lbs-piece-ghost", `<b>${esc(nameOf(cid))}</b><span>all ${n}</span>`);
        d.ghost.style.setProperty("--h", hueOfBlock(cid));
      } else if (d.kind === "piece") {
        const cid = grabCid(d);
        d.ghost = h("div", "lbs-piece lbs-piece-ghost", `<b>${esc(nameOf(cid))}</b>`);
        d.ghost.style.setProperty("--h", hueOfBlock(cid));
        d.ghost.style.width = `${Math.max(30, Math.min(CAP, grabSize(d)) * wall.cam.z)}px`;
      } else if (d.films && d.films.length > 1) {
        d.ghost = h("div", "lbs-ghost", `${fmt(d.films.length)} films`);
      } else {
        // The box itself, cover facing you, follows the pointer.
        d.ghost = h("div", "lbs-box-ghost", boxHTML(d.slug, d.name, false));
        fillPosters(d.ghost, false);
        if (d.from === "wall") { wall.lifted = d.slug; drawSoon(); }
      }
      document.body.append(d.ghost);
      showTip(null);
    }
    const big = d.kind === "dvd" && !(d.films && d.films.length > 1);
    d.ghost.style.left = `${e.clientX + (big ? -40 : 12)}px`;
    d.ghost.style.top = `${e.clientY + (big ? -60 : 10)}px`;
    const c = wall.canvas, r = c.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    const onPile = over && d.kind === "dvd" && inPile(toWall(e.clientX - r.left, e.clientY - r.top));
    wall.dropHint = onPile ? { pile: true } : over ? (d.kind === "piece" ? (d.pour ? pourTarget(d, e.clientX - r.left, e.clientY - r.top) : d.group ? groupTarget(d, e.clientX - r.left, e.clientY - r.top) : dropTarget(d, e.clientX - r.left, e.clientY - r.top)) : dvdTarget(d.slug, e.clientX - r.left, e.clientY - r.top)) : null;
    root.querySelectorAll(".lbs-folder.-over").forEach((el) => el.classList.remove("-over"));
    const under = document.elementFromPoint(e.clientX, e.clientY);
    // Pulling a box down off the shelf (or over the tab) opens the inventory to drop it in.
    if (d.kind === "dvd" && !ui.pocket && !edit.on && ((d.from === "wall" && e.clientY - d.y > 8) || (under && under.closest && under.closest(".lbs-pocket-tab")))) { ui.pocket = true; renderPocket(); }
    root.querySelectorAll(".lbs-pocket.-over, .lbs-pocket-tab.-over").forEach((el) => el.classList.remove("-over"));
    const pocketOver = d.kind === "dvd" && under && under.closest && under.closest(".lbs-pocket, .lbs-pocket-tab");
    if (pocketOver) { pocketOver.classList.add("-over"); wall.dropHint = null; }
    const folder = d.kind === "dvd" && under?.closest?.(".lbs-folder[data-drop]");
    // Hold a film over a folder to open it, as when dragging.
    if (folder && folder.dataset.drop && (lib.genres.has(folder.dataset.drop) || lib.cats.has(folder.dataset.drop))) {
      if (d.spring !== folder.dataset.drop) {
        d.spring = folder.dataset.drop;
        const inSort = !!folder.closest(".lbs-library");
        clearTimeout(d.springT);
        d.springT = setTimeout(() => { if (grab !== d || inSort) return; openFolder(d.spring); }, 600);
      }
    } else { d.spring = null; clearTimeout(d.springT); }
    if (folder) folder.classList.add("-over");
    drawSoon();
  });
  window.addEventListener("mouseup", (e) => {
    const d = grab;
    if (!d) return;
    grab = null;
    if (wall.lifted) { wall.lifted = null; drawSoon(); }
    if (d.live) { wall.dragged = true; setTimeout(() => (wall.dragged = false), 0); }
    if (d.ghost) d.ghost.remove();
    const hint = wall.dropHint;
    wall.dropHint = null;
    root.querySelectorAll(".lbs-folder.-over").forEach((el) => el.classList.remove("-over"));
    if (!d.live) {
      if (d.kind === "piece" && d.from === "wall") selectSection(grabCid(d));
      return drawSoon();
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const toTray = el && el.closest && el.closest(".lbs-tray, .lbs-pocket, .lbs-pocket-tab");
    if (d.kind === "piece") {
      if (toTray && d.group) {
        const keep = new Set(groupRefs(grabCid(d)).map((r) => r.ref));
        const sh = shelvesNow();
        for (const k of Object.keys(sh)) { sh[k] = sh[k].filter((_, i) => !keep.has(`${k}/${i}`)); if (!sh[k].length) delete sh[k]; }
        return houseEdit(`Took all of ${nameOf(grabCid(d))} down.`, (H) => setPlan(H, sh));
      }
      if (toTray) { if (d.from === "wall") unplaceGrab(d); return drawSoon(); }
      if (hint && hint.pour) { if (hint.ok) return placePour(hint); toast("Not enough room from there on to fit the whole section."); return drawSoon(); }
      if (hint && hint.group) { if (hint.ok) return placeGroup(hint); toast("The whole section doesn't fit there."); return drawSoon(); }
      if (hint && hint.ok) return placeGrab(d, hint);
      if (hint) toast("No room on that shelf.");
      return drawSoon();
    }
    // A DVD (or several, from the Library's list)
    const many = d.films && d.films.length > 1 ? d.films : null;
    if (toTray) { if (d.from === "wall" || d.from === "lib") holdFilms(many || [[d.slug, d.name]]); return drawSoon(); }
    const folder = el && el.closest && el.closest(".lbs-folder[data-drop], .lbs-crumb[data-drop]");
    if (folder && folder.dataset.drop) {
      if (d.from === "tray") releaseFilm(d.slug);
      return moveFilms(many || [[d.slug, d.name]], folder.dataset.drop);
    }
    if (hint && hint.pile) return moveFilms(many || [[d.slug, d.name]], UNCAT);
    if (many) { toast("Drop a group onto a folder or your inventory, or use Move to…"); return drawSoon(); }
    if (!edit.on) { if (hint) return browseDrop(d.slug, d.name, hint); return drawSoon(); }
    if (hint && hint.ok) return dropDvd(d.slug, d.name, hint);
    if (hint && !hint.ok) toast(`To arrange ${nameOf(hint.cid)} by hand, click its sign and choose “Index”.`);
    drawSoon();
  });

  // Click a shelf sign: how this section is ordered.
  function openSortPick(sec, sx, sy) {
    const box = $(".lbs-sortpick", root);
    if (!box) return;
    const cur = sortOf(sec.id);
    const opt = (v, label) => `<button type="button" data-act="sort" data-id="${esc(sec.id)}" data-v="${v}" class="${cur === v ? "-on" : ""}">${label}</button>`;
    box.innerHTML =
      `<b>Sort ${esc(sec.name)}</b><div class="lbs-sortpick-row">${opt("title", "Title")}${opt("year", "Year")}${opt("index", "Index")}</div>` +
      `<small>${edit.on ? "Sets the default for everyone. In Index, drag DVDs along the shelf to arrange them." : "Just for you. Index is the store's own hand-made order."}</small>` +
      `<div class="lbs-sortpick-more"><a href="https://docs.google.com/forms/d/e/1FAIpQLSdimOuu93oNmPj3PoPkcWgJNrHqhD9rTCV17-gz_ba05AgPrw/viewform?usp=pp_url&entry.1491097896=${encodeURIComponent(`Sign artwork for the “${sec.name}” section (${sec.id}). Link to the image: `)}" target="_blank" rel="noopener">Upload artwork ↗</a>` +
      `<button type="button" data-act="req-remove" data-id="${esc(sec.id)}">Request removal</button></div>`;
    box.hidden = false;
    const st = $(".lbs-stage", root).getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(sx, st.width - box.offsetWidth - 8))}px`;
    box.style.top = `${Math.max(8, Math.min(sy + 40, st.height - box.offsetHeight - 8))}px`;
  }
  function setSort(cid, v) {
    $(".lbs-sortpick", root).hidden = true;
    const label = { title: "by title", year: "by year", index: "by index" }[v];
    if (edit.on) {
      const seed = sectionOrder(cid).map((f) => f.slug);
      return houseEdit(`${nameOf(cid)}: sorted ${label}.`, (H) => {
        H.sort[cid] = v;
        if (v === "index" && !H.index[cid]) H.index[cid] = seed;
      });
    }
    mine.sort[cid] = v;
    saveMine();
    refresh();
    toast(`${nameOf(cid)}: sorted ${label} (just for you).`);
  }

  // A block's (or category's) colour: its category's.
  const catOfBlock = (id) => (lib.cats.has(id) ? id : lib.subs.has(id) ? lib.subs.get(id).cat : id);
  const hueOfBlock = (id) => secHue(Math.max(0, roomCats().indexOf(catOfBlock(id))));
  function selectSection(id) {
    id = catOfBlock(id);
    edit.sel = id;
    desk.folder = id;
    renderFolders();
    drawSoon();
  }

  function renameFolder(id, name) {
    name = String(name || "").trim().replace(/\s+/g, " ");
    edit.renaming = null;
    if (!name || name === nameOf(id)) return renderFolders();
    const was = nameOf(id);
    houseEdit(`Renamed “${was}” to “${name}”.`, (H) => {
      if (H.cats[id]) H.cats[id].name = name;
      else if (H.subs[id]) H.subs[id].name = name;
      else H.names[id] = name;
    });
  }

  function deleteFolder(id) {
    const p = partsOf(id);
    const was = nameOf(id);
    edit.deleting = null;
    if (edit.sel === id) edit.sel = null;
    if (desk.folder === id || (p.cat === id && desk.folder && desk.folder.startsWith(id + "/"))) desk.folder = p.sub ? p.cat : p.genre;
    if (libUI.path.some((x) => x === id || String(x).startsWith(id + "/"))) libUI.path = libUI.path.slice(0, libUI.path.findIndex((x) => x === id || String(x).startsWith(id + "/")));
    houseEdit(`Deleted “${was}”.`, (H) => {
      if (H.genres && H.genres[id]) delete H.genres[id];
      else if (H.cats[id]) delete H.cats[id];
      else if (H.subs[id]) delete H.subs[id];
      else if (!H.hidden.includes(id)) H.hidden.push(id);
      H.order = H.order.filter((x) => x !== id);
    });
  }

  // A user's proposed folder becomes part of the house plan.
  function approveFolder(id) {
    const c = mine.cats[id], sc = mine.subs[id];
    if (!c && !sc) return;
    houseEdit(`Approved “${nameOf(id)}”.`, (H) => {
      if (c) H.cats[id] = { genre: c.genre, name: c.name };
      else H.subs[id] = { cat: sc.cat, name: sc.name };
    });
    delete mine.cats[id];
    delete mine.subs[id];
    saveMine();
    refresh();
  }

  // Reorder a folder among its siblings (before or after `target`).
  function reorderFolder(id, target, after) {
    const isCat = lib.cats.has(id);
    const parent = isCat ? lib.cats.get(id).genre : lib.subs.get(id).cat;
    const list = (isCat ? lib.genres.get(parent).cats : lib.cats.get(parent).subs).filter((x) => x !== id);
    let at = list.indexOf(target);
    if (at < 0) return;
    if (after) at++;
    list.splice(at, 0, id);
    houseEdit(`Moved “${nameOf(id)}”.`, (H) => {
      if (isCat) H.order = [...list, ...H.order.filter((x) => !list.includes(x))];
      else H.subOrder[parent] = list;
    });
  }

  // Move a subcategory, with its films, into another category.
  function reparentSub(id, cat) {
    const sc = lib.subs.get(id);
    if (!sc || sc.cat === cat || /\/general$/.test(id)) return;
    const name = sc.name;
    const films = (lib.inSub.get(id) || []).slice();
    const nid = house().subs[id] ? id : freshId(`${cat}/h-${slugify(name)}`);
    houseEdit(`Moved “${name}” into ${nameOf(cat)}.`, (H) => {
      if (H.subs[id]) H.subs[id].cat = cat;
      else { H.subs[nid] = { cat, name }; if (!H.hidden.includes(id)) H.hidden.push(id); }
      for (const [slug, n] of films) H.place[slug] = [nid, n];
    });
  }

  function downloadHouse() {
    const plan = { ...house(), at: new Date().toISOString().slice(0, 10) };
    const blob = new Blob([JSON.stringify(plan, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "house-horror.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  /* ---------------- moving films ---------------- */

  // `films` = [[slug, name]]; `target` = any folder id.
  function moveFilms(films, target, opts = {}) {
    const sub = landingSub(target);
    if (!sub || !films.length) return;
    // Moving part of a franchise: ask (move all of it, or take these out of it).
    if (!opts.fr && lib.frOf) {
      const inSet = new Set(films.map(([x]) => x));
      const partial = new Map();
      for (const [x] of films) { const fid = lib.frOf.get(x); if (fid && lib.frs[fid].films.some(([y]) => !inSet.has(y))) partial.set(fid, lib.frs[fid]); }
      if (partial.size) return askFranchiseMove(films, target, partial);
    }
    // A big batch: say so first, then do it on the next frame.
    if (films.length > 1500 && !opts.now) {
      toast(`Moving ${fmt(films.length)} films…`);
      return setTimeout(() => moveFilms(films, target, { ...opts, fr: true, now: true }), 40);
    }
    if (edit.on) {
      const label = films.length === 1 ? `‘${titleOf(films[0][1])}’` : `${films.length} films`;
      return houseEdit(`${label} → ${pathOf(sub).join(" › ")}`, (H) => {
        const moving = new Set(films.map(([slug]) => slug));
        H.held = H.held.filter(([x]) => !moving.has(x));
        for (const [slug, name] of films) H.place[slug] = [sub, name];
      });
    }
    const before = films.map(([slug]) => [slug, mine.place[slug]]);
    // (a big batch stays yours: sharing each move would be thousands of posts)
    if (films.length <= 25) for (const [slug] of films) shareEdit("place", slug, sub);
    const prevView = mine.view;
    for (const [slug, name] of films) mine.place[slug] = [sub, name];
    mine.recent = [sub, ...(mine.recent || []).filter((x) => x !== sub)].slice(0, 6);
    mine.view = "mine";
    saveMine();
    refresh();
    const label = films.length === 1 ? `‘${titleOf(films[0][1])}’` : `${films.length} films`;
    toast(
      `${label} → ${pathOf(sub).join(" › ")}${prevView === "community" ? ". Showing your shelves." : ""}`,
      () => {
        for (const [slug, prev] of before) {
          if (prev) mine.place[slug] = prev;
          else delete mine.place[slug];
        }
        mine.view = prevView;
        saveMine();
        refresh();
      }
    );
  }

  function refresh() {
    buildLibrary();
    desk.moving = null;
    desk.selected.clear();
    if (!DESK_ONLY) buildWing();
    renderDesk();
  }

  let toastTimer = 0;
  function toast(text, undo) {
    const t = $(".lbs-toast", root);
    if (!t) return;
    t.innerHTML = `<span>${esc(text)}</span>${undo ? '<button type="button" data-act="undo">Undo</button>' : ""}`;
    t.hidden = false;
    t._undo = undo || null;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => (t.hidden = true), undo ? 7000 : 4000);
  }

  /* ---------------- drag and drop ---------------- */

  let dragging = null; // [[slug, name]]
  let springTimer = 0;
  let springOn = null;

  function filmOf(el) {
    return [el.dataset.slug, el.dataset.name || el.dataset.slug];
  }

  let dragFolder = null;
  let frDrag = null;
  function onDragStart(e) {
    const fl = e.target.closest && e.target.closest(".lbs-fr-list li");
    if (fl) { frDrag = +fl.dataset.i; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", "x"); return; }
    const frow = edit.on && e.target.closest && e.target.closest(".lbs-folder[data-dnd=folder]");
    if (frow) {
      dragFolder = frow.dataset.id;
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", nameOf(dragFolder));
      root.classList.add("lbs-dragging-folder");
      return;
    }
    if (e.target === wall.canvas) {
      if (wall.hover == null) return e.preventDefault();
      const f = wall.lay.films[wall.hover];
      dragging = [[f.slug, f.name]];
      showTip(null);
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", f.name);
      root.classList.add("lbs-dragging");
      return;
    }
    const src = e.target.closest && e.target.closest(".lbs-item, .lbs-row");
    if (!src || !src.dataset.slug) return;
    if (src.classList.contains("lbs-row") && desk.selected.has(src.dataset.slug) && desk.selected.size > 1) {
      const rows = [...root.querySelectorAll(".lbs-row.-sel")];
      dragging = rows.map(filmOf);
    } else dragging = [filmOf(src)];
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", dragging.map(([, n]) => n).join("\n"));
    if (dragging.length > 1) {
      const ghost = h("div", "lbs-ghost", `${dragging.length} films`);
      document.body.append(ghost);
      e.dataTransfer.setDragImage(ghost, 20, 20);
      setTimeout(() => ghost.remove(), 0);
    }
    root.classList.add("lbs-dragging");
    // Picking a film up off the shelf slides the desk open.
    if (!desk.open && !DESK_ONLY) setTimeout(() => setDesk(true), 0);
  }

  function onDragEnd() {
    frDrag = null;
    dragging = null;
    dragFolder = null;
    root.classList.remove("lbs-dragging-folder");
    root.querySelectorAll(".-before, .-after").forEach((el) => el.classList.remove("-before", "-after"));
    clearTimeout(springTimer);
    springOn = null;
    root.classList.remove("lbs-dragging");
    root.querySelectorAll(".-over").forEach((el) => el.classList.remove("-over"));
  }

  // Where a dragged folder would go: before/after a sibling, or (a
  // subcategory) into another category.
  function folderDrop(e) {
    const t = e.target.closest && e.target.closest(".lbs-folder");
    if (!t || !dragFolder || t.dataset.id === dragFolder) return null;
    const id = t.dataset.id, isCat = lib.cats.has(dragFolder);
    const parentOf = (x) => (lib.cats.has(x) ? lib.cats.get(x).genre : lib.subs.has(x) ? lib.subs.get(x).cat : null);
    if (parentOf(id) === parentOf(dragFolder)) {
      const r = t.getBoundingClientRect();
      return { t, kind: "order", after: e.clientY > r.top + r.height / 2 };
    }
    if (!isCat && lib.cats.has(id)) return { t, kind: "into" };
    return null;
  }

  function onDragOver(e) {
    if (frDrag != null) {
      const li = e.target.closest && e.target.closest(".lbs-fr-list li");
      root.querySelectorAll(".lbs-fr-list li.-before").forEach((x) => x.classList.remove("-before"));
      if (li) { e.preventDefault(); li.classList.add("-before"); }
      return;
    }
    if (dragFolder) {
      const d = folderDrop(e);
      root.querySelectorAll(".-before, .-after, .-over").forEach((el) => el.classList.remove("-before", "-after", "-over"));
      if (!d) return;
      e.preventDefault();
      d.t.classList.add(d.kind === "into" ? "-over" : d.after ? "-after" : "-before");
      return;
    }
    if (!dragging) return;
    const t = e.target.closest && e.target.closest("[data-drop]");
    root.querySelectorAll(".-over").forEach((el) => el !== t && el.classList.remove("-over"));
    if (!t) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    t.classList.add("-over");
    // Hold over a folder to spring it open in the columns.
    if (springOn !== t) {
      springOn = t;
      clearTimeout(springTimer);
      const id = t.dataset.drop;
      if (t.classList.contains("lbs-folder") && (lib.genres.has(id) || lib.cats.has(id)) && desk.folder !== id) {
        springTimer = setTimeout(() => {
          desk.folder = id;
          desk.fq = "";
          renderFolders();
          springOn = null;
        }, 550);
      }
    }
  }

  function onDragLeave(e) {
    const t = e.target.closest && e.target.closest("[data-drop]");
    if (t && !t.contains(e.relatedTarget)) {
      t.classList.remove("-over");
      if (springOn === t) { clearTimeout(springTimer); springOn = null; }
    }
  }

  function onDrop(e) {
    if (frDrag != null) {
      const li = e.target.closest && e.target.closest(".lbs-fr-list li");
      const from = frDrag;
      frDrag = null;
      if (!li || !ui.fr) return;
      e.preventDefault();
      const to = +li.dataset.i;
      const [m] = ui.fr.films.splice(from, 1);
      ui.fr.films.splice(to, 0, m);
      return renderFranchise();
    }
    const inv = !dragFolder && dragging && e.target.closest && e.target.closest(".lbs-tray, .lbs-pocket, .lbs-pocket-tab");
    if (inv) { e.preventDefault(); const films = dragging; onDragEnd(); return holdFilms(films); }
    if (dragFolder) {
      const d = folderDrop(e), id = dragFolder;
      e.preventDefault();
      onDragEnd();
      if (!d) return;
      if (d.kind === "into") return reparentSub(id, d.t.dataset.id);
      return reorderFolder(id, d.t.dataset.id, d.after);
    }
    const t = e.target.closest && e.target.closest("[data-drop]");
    if (!dragging || !t) return;
    e.preventDefault();
    const films = dragging;
    onDragEnd();
    moveFilms(films, t.dataset.drop);
  }

  // Right-click a film: Move to…
  function onContextMenu(e) {
    const any = e.target.closest && e.target.closest(".lbs-lib-film, .lbs-lv-row, .lbs-pk, .lbs-find-list li[data-slug], .lbs-sp-chip, .lbs-dvd");
    if (any && any.dataset.slug) {
      e.preventDefault();
      // In the list, a right-click on a selected row acts on the whole selection.
      if (any.classList.contains("lbs-lv-row")) {
        const r = lv.rows[+any.dataset.n];
        if (r && r.fr) { if (rowSel(r) !== 2) { lvSetSel(new Set(r.members)); lvRefreshSel(); } return openFilmMenu(null, null, e.clientX, e.clientY, true, r.fr); }
        if (lv.sel.has(any.dataset.slug) && lv.sel.size > 1) return openFilmMenu(null, null, e.clientX, e.clientY, true);
      }
      return openFilmMenu(any.dataset.slug, any.dataset.name || lib.names.get(any.dataset.slug) || any.dataset.slug, e.clientX, e.clientY);
    }
    const src = e.target.closest && e.target.closest(".lbs-item, .lbs-row");
    if (!src || !src.dataset.slug) return;
    e.preventDefault();
    desk.moving = src.classList.contains("lbs-row") && desk.selected.has(src.dataset.slug) ? [...root.querySelectorAll(".lbs-row.-sel")].map(filmOf) : [filmOf(src)];
    if (!desk.open) setDesk(true);
    else renderDesk();
    const f = $(".lbs-dq", root);
    if (f) f.focus();
  }

  // Right-click a film (a spine, a row, a cover): what you can do with it.
  function openFilmMenu(slug, name, x, y, many, frId) {
    closeFilmMenu();
    const b = (act, label, extra = "") => `<button type="button" role="menuitem" data-act="${act}"${slug ? ` data-slug="${esc(slug)}" data-name="${esc(name)}"` : ""}${extra}>${label}</button>`;
    const held = slug && (mine.held || []).some(([s2]) => s2 === slug);
    const inStore = slug && lib.place.has(slug);
    const html = many
      ? `<b>${frId ? `${esc(lib.frs[frId].name)} · ` : ""}${fmt(lv.sel.size)} films</b>` + (frId ? `<button type="button" role="menuitem" data-act="fr-open" data-fr="${esc(frId)}">Open franchise</button>` : "") + b("lv-move", "Move to…") + b("lv-hold", "Add to inventory")+ b("lv-uncat", "Uncategorize") + b("lv-clear", "Deselect all")
      : `<b>${esc(titleOf(name))}</b>` +
        b("f-open", "Details") +
        (held ? b("f-return", "Take out of inventory") : b("f-hold", "Add to inventory", inStore ? "" : " disabled")) +
        b("f-jump", "Jump to section", inStore ? "" : " disabled") +
        b("f-editx", "Edit") +
        b("f-sort", "Sort") +
        (inStore && lib.place.get(slug) !== UNCAT_SUB ? b("f-uncat", "Uncategorize") : "") +
        b("f-fr", frFor(slug) ? `Franchise · ${esc(frFor(slug).name)}` : "Add to franchise", inStore ? "" : " disabled");
    const m = h("div", "lbs-ctx", html);
    m.setAttribute("role", "menu");
    root.append(m);
    const rr = root.getBoundingClientRect();
    m.style.left = `${Math.min(x - rr.left, rr.width - m.offsetWidth - 6)}px`;
    m.style.top = `${Math.min(y - rr.top, rr.height - m.offsetHeight - 6)}px`;
    m.querySelector("button:not([disabled])")?.focus({ preventScroll: true });
  }
  function closeFilmMenu() { root && root.querySelectorAll(".lbs-ctx").forEach((m) => m.remove()); }
  window.addEventListener("mousedown", (e) => { if (!e.target.closest || !e.target.closest(".lbs-ctx")) closeFilmMenu(); }, true);
  window.addEventListener("wheel", () => closeFilmMenu(), { passive: true, capture: true });
  window.addEventListener("keydown", (e) => {
    const m = root && $(".lbs-ctx", root);
    if (!m) return;
    if (e.key === "Escape") { e.stopPropagation(); return closeFilmMenu(); }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      const items = [...m.querySelectorAll("button:not([disabled])")];
      const i = items.indexOf(document.activeElement);
      items[(i + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length]?.focus();
    }
  }, true);

  /* Colour pickers are drawn in the page. (The system picker on macOS is a
   * separate window whose eyedropper can capture every click on the screen
   * if the page redraws under it.) A hidden input keeps the value and gets
   * the same "input" events the old colour inputs did. */
  function swatchHTML(cls, value, attrs = "", disabled = false) {
    const v = /^#[0-9a-f]{6}$/i.test(value) ? value : "#2c3440";
    return `<input type="hidden" class="${cls}" value="${esc(v)}" ${attrs}${disabled ? " disabled" : ""}><button type="button" class="lbs-swatch" data-act="cpick" style="--c:${esc(v)}"${disabled ? " disabled" : ""} aria-label="Pick a colour"></button>`;
  }
  const hexToRgb = (hx) => [1, 3, 5].map((i) => parseInt(hx.slice(i, i + 2), 16));
  const rgbToHex = (r, g, b) => "#" + [r, g, b].map((v) => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, "0")).join("");
  function rgbToHsv([r, g, b]) {
    r /= 255; g /= 255; b /= 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
    let hh = 0;
    if (d) hh = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    return [(hh * 60 + 360) % 360, mx ? d / mx : 0, mx];
  }
  function hsvToRgb(hh, sv, v) {
    const c = v * sv, x = c * (1 - Math.abs(((hh / 60) % 2) - 1)), m = v - c;
    const [r, g, b] = hh < 60 ? [c, x, 0] : hh < 120 ? [x, c, 0] : hh < 180 ? [0, c, x] : hh < 240 ? [0, x, c] : hh < 300 ? [x, 0, c] : [c, 0, x];
    return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
  }
  const CPICK_PRESETS = ["#17191c", "#2c3440", "#f0e6cf", "#ffffff", "#e23b2e", "#f08a24", "#f5c518", "#3fa34d", "#2f80c2", "#40bcf4", "#7b4bb8", "#c2185b"];
  let cpick = null; // { input, btn, h, s, v, box }
  function openColorPicker(btn) {
    closeColorPicker();
    const input = btn.previousElementSibling;
    if (!input || input.disabled) return;
    const [hh, ss, v] = rgbToHsv(hexToRgb(/^#[0-9a-f]{6}$/i.test(input.value) ? input.value : "#2c3440"));
    const box = h("div", "lbs-cpick",
      `<div class="lbs-cpick-sv"><i></i></div>` +
      `<input type="range" class="lbs-cpick-hue" min="0" max="359" step="1" aria-label="Hue">` +
      `<div class="lbs-cpick-row"><span class="lbs-cpick-now"></span><input type="text" class="lbs-cpick-hex" maxlength="7" spellcheck="false" aria-label="Hex colour"><button type="button" class="lbs-cpick-drop" title="Eyedropper: pick a colour from a poster, logo or the wall (Esc to cancel)" aria-label="Eyedropper">${ICON_DROPPER}</button><button type="button" class="lbs-cpick-done">Done</button></div>` +
      `<div class="lbs-cpick-presets">${CPICK_PRESETS.map((c) => `<button type="button" data-c="${c}" style="--c:${c}" aria-label="${c}"></button>`).join("")}</div>`);
    root.append(box);
    cpick = { input, btn, h: hh, s: ss, v, box, cls: input.className, slug: input.dataset.slug };
    // keep its own events to itself
    box.addEventListener("input", (e) => e.stopPropagation());
    box.addEventListener("click", (e) => {
      e.stopPropagation();
      const p = e.target.closest("[data-c]");
      if (p) return setPickHex(p.dataset.c);
      if (e.target.closest(".lbs-cpick-drop")) return cpick.dropping ? stopDropper() : startDropper();
      if (e.target.closest(".lbs-cpick-done")) closeColorPicker();
    });
    box.querySelector(".lbs-cpick-hue").addEventListener("input", (e) => { cpick.h = +e.target.value; pickChanged(); });
    box.querySelector(".lbs-cpick-hex").addEventListener("input", (e) => { const t = e.target.value.trim(); if (/^#?[0-9a-f]{6}$/i.test(t)) setPickHex(t[0] === "#" ? t : "#" + t, true); });
    box.querySelector(".lbs-cpick-hex").addEventListener("keydown", (e) => { e.stopPropagation(); if (e.key === "Enter" || e.key === "Escape") closeColorPicker(); });
    const sv = box.querySelector(".lbs-cpick-sv");
    const svAt = (e) => { const r = sv.getBoundingClientRect(); cpick.s = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)); cpick.v = 1 - Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)); pickChanged(); };
    sv.addEventListener("mousedown", (e) => {
      e.preventDefault();
      svAt(e);
      const move = (ev) => { if (!(ev.buttons & 1) || !cpick) return up(); svAt(ev); };
      const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); };
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    });
    const r = btn.getBoundingClientRect(), rr = root.getBoundingClientRect();
    box.style.left = `${Math.max(8, Math.min(r.left - rr.left, rr.width - 236))}px`;
    box.style.top = `${r.bottom - rr.top + 6 + 260 > rr.height ? Math.max(8, r.top - rr.top - 266) : r.bottom - rr.top + 6}px`;
    paintPick(false);
  }
  function setPickHex(hx, fromField) {
    [cpick.h, cpick.s, cpick.v] = rgbToHsv(hexToRgb(hx));
    pickChanged(fromField);
  }
  function paintPick(fromField) {
    const { box, h: hh, s: sv, v } = cpick;
    const hex = rgbToHex(...hsvToRgb(hh, sv, v));
    box.querySelector(".lbs-cpick-sv").style.setProperty("--hue", `hsl(${hh} 100% 50%)`);
    const k = box.querySelector(".lbs-cpick-sv i");
    k.style.left = `${sv * 100}%`; k.style.top = `${(1 - v) * 100}%`;
    box.querySelector(".lbs-cpick-hue").value = Math.round(hh);
    box.querySelector(".lbs-cpick-now").style.background = hex;
    if (!fromField) box.querySelector(".lbs-cpick-hex").value = hex;
    return hex;
  }
  function pickChanged(fromField) {
    if (!cpick) return;
    // The panel behind it may have been redrawn: find its new swatch.
    if (!root.contains(cpick.input)) {
      const fresh = [...root.querySelectorAll(`input.${cpick.cls}`)].find((x) => (x.dataset.slug || "") === (cpick.slug || ""));
      if (!fresh) return closeColorPicker();
      cpick.input = fresh; cpick.btn = fresh.nextElementSibling;
    }
    const hex = paintPick(fromField);
    cpick.input.value = hex;
    cpick.btn.style.setProperty("--c", hex);
    cpick.input.dispatchEvent(new Event("input", { bubbles: true }));
  }
  function closeColorPicker() {
    if (!cpick) return;
    stopDropper();
    cpick.box.remove();
    cpick = null;
  }
  window.addEventListener("mousedown", (e) => { if (cpick && !cpick.dropping && !e.target.closest(".lbs-cpick, .lbs-swatch")) closeColorPicker(); }, true);

  /* The system colour picker (with its eyedropper), made safe. What locked
   * the Mac up was the page throwing away the <input type="color"> the picker
   * belonged to (the panel re-renders) while the picker was open: the picker
   * window was left talking to nothing, holding the mouse. Now there is one
   * colour input for the whole page, outside the store, that is never removed
   * or redrawn; swatches just borrow it. Same on Windows (Chrome's own
   * picker and eyedropper). */
  let nativeColor = null, nativeFor = null; // nativeFor: { cls, slug }
  function nativeTarget() {
    if (!nativeFor || !root) return null;
    return [...root.querySelectorAll(`input.${nativeFor.cls}`)].find((x) => (x.dataset.slug || "") === (nativeFor.slug || "")) || null;
  }
  function relayNative(e) {
    const t = nativeTarget();
    if (!t || t.disabled) return;
    t.value = nativeColor.value;
    if (t.nextElementSibling) t.nextElementSibling.style.setProperty("--c", nativeColor.value);
    t.dispatchEvent(new Event("input", { bubbles: true }));
    // (no "done" here: on a Mac the picker window stays open after a change
    // and keeps sending colours; it stays tied to this swatch until another
    // swatch is clicked, and does nothing once its film is closed)
  }
  function openNativePicker(btn) {
    const input = btn.previousElementSibling;
    if (!input || input.disabled) return;
    if (!nativeColor) {
      nativeColor = document.createElement("input");
      nativeColor.type = "color";
      nativeColor.className = "lbs-native-color";
      nativeColor.tabIndex = -1;
      nativeColor.setAttribute("aria-hidden", "true");
      nativeColor.addEventListener("input", relayNative);
      nativeColor.addEventListener("change", relayNative);
      document.documentElement.append(nativeColor); // outside the store: never re-rendered
    }
    nativeFor = { cls: input.className, slug: input.dataset.slug };
    nativeColor.value = /^#[0-9a-f]{6}$/i.test(input.value) ? input.value.toLowerCase() : "#2c3440";
    const r = btn.getBoundingClientRect();
    nativeColor.style.left = `${Math.round(r.left)}px`;
    nativeColor.style.top = `${Math.round(r.bottom)}px`;
    try { nativeColor.showPicker(); } catch { nativeColor.click(); }
  }

  /* The eyedropper, drawn in the page too (the system one is what locked the
   * Mac up). It reads the pixel under the pointer from posters, logos and the
   * wall, or the colour of whatever else is there; a loupe follows the
   * pointer; click to take it, Esc / right-click / leaving the window cancels.
   * Nothing outside this tab is involved, so it can't hold the computer. */
  const dropCanvas = document.createElement("canvas");
  dropCanvas.width = dropCanvas.height = 1;
  const dropCtx = dropCanvas.getContext("2d", { willReadFrequently: true });
  const LOUPE_N = 11, LOUPE_PX = 10; // an 11x11 patch, 10x bigger
  function readable(source) {
    try { dropCtx.clearRect(0, 0, 1, 1); dropCtx.drawImage(source, 0, 0, 1, 1, 0, 0, 1, 1); dropCtx.getImageData(0, 0, 1, 1); return true; } catch { return false; }
  }
  function pixelFrom(source, sx, sy) {
    dropCtx.clearRect(0, 0, 1, 1);
    dropCtx.drawImage(source, Math.floor(sx), Math.floor(sy), 1, 1, 0, 0, 1, 1);
    const [r, g, b, a] = dropCtx.getImageData(0, 0, 1, 1).data;
    return a > 8 ? rgbToHex(r, g, b) : null;
  }
  // What's under the pointer: { hex, source, sx, sy, k } where source/sx/sy
  // say which picture and which pixel (k: picture pixels per screen pixel),
  // or { hex } for a plain coloured element, or { locked: true }.
  function sampleAt(x, y) {
    const els = document.elementsFromPoint(x, y).filter((el) => !el.closest(".lbs-cpick, .lbs-loupe"));
    let locked = false;
    for (const el of els) {
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      let source = null, sx = 0, sy = 0, k = 1;
      if (el.tagName === "CANVAS") {
        source = el; k = el.width / r.width;
        sx = (x - r.left) * k; sy = (y - r.top) * (el.height / r.height);
      } else if (el.tagName === "IMG" && el.complete && el.naturalWidth) {
        const fit = getComputedStyle(el).objectFit;
        const nw = el.naturalWidth, nh = el.naturalHeight;
        const sc = fit === "cover" ? Math.max(r.width / nw, r.height / nh) : fit === "contain" || fit === "scale-down" ? Math.min(r.width / nw, r.height / nh) : null;
        const kx = sc ? 1 / sc : nw / r.width, ky = sc ? 1 / sc : nh / r.height;
        sx = sc ? (x - r.left - (r.width - nw * sc) / 2) * kx : (x - r.left) * kx;
        sy = sc ? (y - r.top - (r.height - nh * sc) / 2) * ky : (y - r.top) * ky;
        if (sx < 0 || sy < 0 || sx >= nw || sy >= nh) continue;
        source = el; k = kx;
      }
      if (source) {
        if (!readable(source)) { locked = true; continue; }
        const hex = pixelFrom(source, sx, sy);
        if (hex) return { hex, source, sx, sy, k };
        continue; // transparent here: look underneath
      }
      const bg = getComputedStyle(el).backgroundColor;
      const m = bg && bg.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/);
      if (m && (m[4] == null || +m[4] > 0.5)) return { hex: rgbToHex(+m[1], +m[2], +m[3]), locked };
    }
    return { hex: null, locked };
  }
  let dropper = null; // { loupe, last, handlers }
  function startDropper() {
    if (!cpick || dropper) return;
    cpick.dropping = true;
    cpick.box.classList.add("-dropping");
    const before = cpick.box.querySelector(".lbs-cpick-now").style.background;
    const S = LOUPE_N * LOUPE_PX;
    const loupe = h("div", "lbs-loupe", `<canvas width="${S}" height="${S}"></canvas><div><i></i><span></span></div>`);
    document.body.append(loupe);
    const lc = loupe.querySelector("canvas").getContext("2d");
    lc.imageSmoothingEnabled = false;
    root.classList.add("lbs-dropping");
    let raf = 0, at = null;
    const paint = () => {
      raf = 0;
      if (!dropper || !at) return;
      const { x, y } = at;
      const got = sampleAt(x, y);
      dropper.last = got.hex;
      // the magnifier: the patch around the pixel, big and unsmoothed
      lc.fillStyle = "#0b1014"; lc.fillRect(0, 0, S, S);
      if (got.source) {
        const half = (LOUPE_N / 2) * got.k;
        lc.drawImage(got.source, got.sx - half, got.sy - half, LOUPE_N * got.k, LOUPE_N * got.k, 0, 0, S, S);
      } else if (got.hex) { lc.fillStyle = got.hex; lc.fillRect(0, 0, S, S); }
      lc.strokeStyle = "#fff"; lc.lineWidth = 2;
      const c0 = Math.floor(LOUPE_N / 2) * LOUPE_PX;
      lc.strokeRect(c0, c0, LOUPE_PX, LOUPE_PX);
      lc.strokeStyle = "rgba(0,0,0,.6)"; lc.lineWidth = 1;
      lc.strokeRect(c0 - 1.5, c0 - 1.5, LOUPE_PX + 3, LOUPE_PX + 3);
      loupe.querySelector("i").style.background = got.hex || "transparent";
      loupe.querySelector("span").textContent = got.hex ? got.hex : got.locked ? "can't read this picture" : "nothing here";
      // live preview in the picker (taken only when you click)
      cpick.box.querySelector(".lbs-cpick-now").style.background = got.hex || before;
      // keep the loupe on screen
      const lw = loupe.offsetWidth, lh = loupe.offsetHeight;
      const lx = x + 20 + lw > innerWidth ? x - 20 - lw : x + 20, ly = y + 20 + lh > innerHeight ? y - 20 - lh : y + 20;
      loupe.style.transform = `translate(${lx}px, ${ly}px)`;
    };
    const show = (e) => { at = { x: e.clientX, y: e.clientY }; if (!raf) raf = requestAnimationFrame(paint); };
    const block = (e) => { if (e.target.closest && e.target.closest(".lbs-cpick")) return; e.preventDefault(); e.stopPropagation(); };
    const down = (e) => {
      if (e.target.closest && e.target.closest(".lbs-cpick")) return;
      block(e);
      if (e.button !== 0) return stopDropper();
      at = { x: e.clientX, y: e.clientY }; paint();
      const hex = dropper && dropper.last;
      stopDropper();
      if (hex) setPickHex(hex);
    };
    const key = (e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); stopDropper(); } };
    const handlers = [["pointermove", show], ["pointerdown", down], ["mousedown", block], ["mouseup", block], ["click", block], ["contextmenu", block], ["keydown", key], ["blur", () => stopDropper()]];
    handlers.forEach(([t, f]) => window.addEventListener(t, f, true));
    dropper = { loupe, last: null, handlers, restore: () => { if (cpick) cpick.box.querySelector(".lbs-cpick-now").style.background = before; } };
  }
  function stopDropper() {
    if (!dropper) return;
    const d = dropper;
    dropper = null;
    d.loupe.remove();
    d.restore();
    root.classList.remove("lbs-dropping");
    // let the click that ended it finish before the page hears clicks again
    setTimeout(() => d.handlers.forEach(([t, f]) => window.removeEventListener(t, f, true)), 0);
    if (cpick) { cpick.dropping = false; cpick.box.classList.remove("-dropping"); }
  }

  /* Drags of rows, folders and franchise films, done with the mouse rather
   * than the browser's drag and drop (which can hang macOS when it goes
   * wrong). It feeds the same handlers the native events used to. */
  let mdnd = null; // { src, x, y, live, ghost, under }
  let swallowClick = false;
  const fakeDT = { setData() {}, setDragImage() {}, effectAllowed: "", dropEffect: "" };
  const dndEvent = (target, e) => ({ target, relatedTarget: null, clientX: e.clientX, clientY: e.clientY, dataTransfer: fakeDT, preventDefault() {} });
  function mouseDndDown(e) {
    if (e.button !== 0 || e.target.closest("button, a, input, textarea, select, label")) return;
    const src = e.target.closest("[data-dnd]");
    if (!src || !root.contains(src)) return;
    mdnd = { src, x: e.clientX, y: e.clientY, live: false };
  }
  function mouseDndCancel() {
    if (!mdnd) return;
    if (mdnd.ghost) mdnd.ghost.remove();
    if (mdnd.live) onDragEnd();
    mdnd = null;
  }
  window.addEventListener("mousemove", (e) => {
    const d = mdnd;
    if (!d) return;
    if (!(e.buttons & 1)) return mouseDndCancel(); // the button came up somewhere we didn't hear
    if (!d.live) {
      if (Math.abs(e.clientX - d.x) + Math.abs(e.clientY - d.y) < 5) return;
      let stopped = false;
      onDragStart({ ...dndEvent(d.src, e), preventDefault() { stopped = true; } });
      if (stopped || !(dragging || dragFolder || frDrag != null)) { mdnd = null; return; }
      d.live = true;
      const label = dragFolder ? nameOf(dragFolder) : frDrag != null ? "" : dragging.length > 1 ? `${fmt(dragging.length)} films` : titleOf(dragging[0][1]);
      d.ghost = h("div", "lbs-ghost", esc(label || "↕"));
      document.body.append(d.ghost);
    }
    e.preventDefault();
    d.ghost.style.left = `${e.clientX + 12}px`;
    d.ghost.style.top = `${e.clientY + 10}px`;
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (!under) return;
    if (d.under && d.under !== under) onDragLeave({ ...dndEvent(d.under, e), relatedTarget: under });
    d.under = under;
    onDragOver(dndEvent(under, e));
  });
  window.addEventListener("mouseup", (e) => {
    const d = mdnd;
    if (!d) return;
    mdnd = null;
    if (!d.live) return;
    if (d.ghost) d.ghost.remove();
    swallowClick = true;
    setTimeout(() => (swallowClick = false), 0);
    const under = document.elementFromPoint(e.clientX, e.clientY);
    if (under && root.contains(under)) onDrop(dndEvent(under, e));
    onDragEnd();
  });
  // Escape, or the window losing focus, drops whatever is being carried.
  function cancelAllDrags() {
    mouseDndCancel();
    if (grab) {
      if (grab.ghost) grab.ghost.remove();
      grab = null;
      wall.dropHint = null;
      if (wall.lifted) wall.lifted = null;
      root && root.querySelectorAll(".-over").forEach((el) => el.classList.remove("-over"));
      drawSoon();
    }
  }
  window.addEventListener("blur", cancelAllDrags);
  window.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    if (dropper) { e.stopPropagation(); e.preventDefault(); return stopDropper(); }
    if (cpick) { e.stopPropagation(); e.preventDefault(); return closeColorPicker(); }
    if (mdnd || grab) { e.stopPropagation(); e.preventDefault(); cancelAllDrags(); }
  }, true);

  /* ---------------- clicks, typing ---------------- */

  function onClick(e) {
    if (swallowClick) { swallowClick = false; e.preventDefault(); return; }
    if (e.target.closest(".lbs-ctx")) setTimeout(closeFilmMenu, 0);
    const pick = $(".lbs-logopick", root);
    if (pick && !pick.hidden && !e.target.closest(".lbs-logopick")) pick.hidden = true;
    const sp = $(".lbs-sortpick", root);
    if (sp && !sp.hidden && !e.target.closest(".lbs-sortpick") && e.target !== wall.canvas) sp.hidden = true;
    // Menus close when you click anywhere else.
    root.querySelectorAll(".lbs-menu:not([hidden])").forEach((m) => {
      if (!e.target.closest(".lbs-menu, [data-act=settings], [data-act=find-type], [data-act=lb-more]")) m.hidden = true;
    });
    const lvr = !e.target.closest("button") && e.target.closest(".lbs-lv-row");
    if (lvr) { $(".lbs-lv-list", root)?.focus({ preventScroll: true }); return lvClickRow(lvr, e); }
    const row = e.target.closest(".lbs-row");
    if (row && !e.target.closest("a, button")) return selectRow(row, e);
    const btn = e.target.closest("[data-act], [data-coll], [data-scope], [data-view], [data-mode]");
    if (!btn || !root.contains(btn)) return;
    if (btn.dataset.coll) {
      if (btn.getAttribute("aria-disabled") === "true") return;
      collection = btn.dataset.coll;
      return render();
    }
    if (btn.dataset.scope) {
      desk.scope = btn.dataset.scope;
      desk.shown = 150;
      if (desk.scope === "all") searchAll();
      else renderFilms();
      return $(".lbs-fq", root)?.focus();
    }
    if (btn.dataset.mode) {
      desk.mode = btn.dataset.mode;
      return renderDesk();
    }
    if (btn.dataset.view) {
      mine.view = btn.dataset.view;
      saveMine();
      refresh();
      return renderSettings();
    }
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (act === "logo-pick") {
      const v = btn.dataset.path != null ? (btn.dataset.path === "-1" ? -1 : btn.dataset.path) : +btn.dataset.n;
      pickLogo(btn.dataset.slug, v);
      if (ui.film) renderFilm();
      return;
    }
    if (act === "edit") return toggleEdit(!edit.on);
    {
      const fs = btn.dataset.slug, fn = btn.dataset.name || (ui.film && ui.film.name) || fs;
      if (act === "f-close") return closeFilm();
      if (act === "f-open") return openFilm(fs, fn);
      if (act === "f-hold") {
        if (!lib.place.has(fs)) return toast(`‘${titleOf(fn)}’ isn't in the store yet, so it can't go in your inventory.`);
        holdFilms([[fs, fn]]); ui.pocket = true; renderPocket(); return toast(`‘${titleOf(fn)}’ is in your inventory.`);
      }
      if (act === "settings") return toggleMenu(".lbs-settings");
      if (act === "lib") return setLibrary(!libUI.open);
      if (act === "lib-up") { libUI.path.pop(); libUI.adding = null; return renderLibrary(); }
      if (act === "lib-root") { libUI.path = []; libUI.adding = null; return renderLibrary(); }
      if (act === "lib-to") { libUI.path = libUI.path.slice(0, +btn.dataset.i + 1); libUI.adding = null; return renderLibrary(); }
      if (act === "lib-open") {
        if (wall.dragged) return;
        const fid = btn.dataset.id;
        libUI.adding = null;
        if (btn.dataset.side === "left") libUI.path = libUI.path.length >= 2 ? [...libUI.path.slice(0, -1), fid] : [fid];
        else libUI.path = [...libUI.path, fid];
        libUI.focus = { folder: fid };
        return renderLibrary();
      }
      if (act === "lib-film") {
        if (wall.dragged) return;
        libUI.sel = libUI.sel && libUI.sel[0] === fs ? null : [fs, fn];
        libUI.focus = libUI.sel ? { film: libUI.sel } : null;
        return renderLibrary();
      }
      if (act === "lib-unsel") { libUI.sel = null; lv.sel = new Set(); return renderLibrary(); }
      if (act === "lib-mode") { libUI.picking = null; lv.mode = btn.dataset.v; saveLv(); return renderLibrary(); }
      if (act === "lib-pick-cancel") { closeMovePick(); return renderLibrary(); }
      if (act === "lib-pick-go") {
        const right = libUI.path[libUI.path.length - 1], pk = libUI.picking;
        if (!pk || !right) return;
        closeMovePick();
        lv.selecting = false; lvSetSel(new Set());
        moveFilms(pk.films, right);
        return renderLibrary();
      }
      if (act === "lv-selmode") { lv.selecting = !lv.selecting; if (!lv.selecting) lvSetSel(libUI.sel ? new Set([libUI.sel[0]]) : new Set()); return lvRefreshSel(); }
      if (act === "lv-all") { lvSetSel(new Set([...lv.sel, ...lv.rows.flatMap(rowSlugs)])); return lvRefreshSel(); }
      if (act === "lv-none") { const s2 = new Set(lv.sel); for (const r of lv.rows) for (const x of rowSlugs(r)) s2.delete(x); lvSetSel(s2); return lvRefreshSel(); }
      if (act === "lv-fr-toggle") { const fid = btn.dataset.fr; if (lv.open.has(fid)) lv.open.delete(fid); else lv.open.add(fid); return renderLibrary(); }
      if (act === "lv-clear") { lv.selecting = false; lvSetSel(new Set()); return lvRefreshSel(); }
      if (act === "lv-sort") { lv.sort = btn.dataset.v; saveLv(); return renderLibrary(); }
      if (act === "lv-filters") { lv.showFilters = !lv.showFilters; saveLv(); return renderLibrary(); }
      if (act === "lv-chip") {
        const g = btn.dataset.g, v = btn.dataset.v, st = (lv.f[g] = lv.f[g] || {});
        const next = st[v] === 1 ? -1 : st[v] === -1 ? 0 : 1;
        if (next) st[v] = next; else delete st[v];
        // categories and subcats below follow what's still picked above
        const incl = (k) => Object.entries(lv.f[k] || {}).filter(([, x]) => x === 1).map(([x]) => x);
        if (lv.f.scat) { const gs2 = new Set(incl("sgenre")); for (const c of Object.keys(lv.f.scat)) if (!lib.cats.has(c) || !gs2.has(lib.cats.get(c).genre)) delete lv.f.scat[c]; if (!Object.keys(lv.f.scat).length) delete lv.f.scat; }
        if (lv.f.ssub) { const cs2 = new Set(incl("scat")); for (const x of Object.keys(lv.f.ssub)) if (!lib.subs.has(x) || !cs2.has(lib.subs.get(x).cat)) delete lv.f.ssub[x]; if (!Object.keys(lv.f.ssub).length) delete lv.f.ssub; }
        if (!Object.keys(st).length) delete lv.f[g];
        saveLv();
        return renderLibrary();
      }
      if (act === "lv-anyall") { lv.all = { ...(lv.all || {}), [btn.dataset.g]: btn.dataset.v === "all" }; if (!lv.all[btn.dataset.g]) delete lv.all[btn.dataset.g]; saveLv(); return renderLibrary(); }
      if (act === "lv-clear-g") { delete lv.f[btn.dataset.g]; if (btn.dataset.g === "decade") { lv.y0 = lv.y1 = ""; } saveLv(); return renderLibrary(); }
      if (act === "lv-more") { lv.more[btn.dataset.g] = !lv.more[btn.dataset.g]; return renderLibrary(); }
      if (act === "lv-reset") { lv.f = {}; lv.y0 = lv.y1 = ""; lv.q = ""; const qi = $(".lbs-lv-q", root); if (qi) qi.value = ""; saveLv(); return renderLibrary(); }
      if (act === "lv-move") return openMovePick(lv.sel.size ? lvFilms() : libUI.sel ? [libUI.sel] : []);
      if (act === "lv-hold") {
        const films = lvFilms().filter(([x]) => lib.place.has(x));
        holdFilms(films); ui.pocket = true; renderPocket();
        return toast(`${fmt(films.length)} film${films.length === 1 ? "" : "s"} in your inventory.`);
      }
      if (act === "lv-uncat") { const films = lvFilms(); lv.selecting = false; lvSetSel(new Set()); return moveFilms(films, UNCAT); }
      if (act === "lib-new") { const col = btn.closest(".lbs-lib-col"); libUI.adding = col && col.classList.contains("-left") && libUI.path.length < 2 ? "@root" : libUI.path[libUI.path.length - 1] || "@root"; return renderLibrary(); }
      if (act === "lib-del") {
        e.stopPropagation();
        const did = btn.dataset.id, n = lib.count.get(did) || 0;
        const where = lib.genres.has(did) || lib.cats.has(did) ? "Uncategorized" : `${nameOf(lib.subs.get(did)?.parent || lib.subs.get(did)?.cat)}${lib.subs.get(did)?.parent ? "" : " › General"}`;
        return ask(`Delete <b>${esc(nameOf(did))}</b>${lib.genres.has(did) ? " and every folder in it" : lib.cats.has(did) ? " and its subcats" : ""}?${n ? ` Its ${fmt(n)} film${n === 1 ? "" : "s"} go to ${esc(where)}.` : ""}`, () => deleteFolder(did), "Delete");
      }
      if (act === "lib-move") {
        const right = libUI.path[libUI.path.length - 1];
        if (!libUI.sel || !right) return;
        moveFilms([libUI.sel], right);
        return renderLibrary();
      }
      if (act === "lib-fr") return libUI.sel && openFranchise(libUI.sel[0], libUI.sel[1]);
      if (act === "lib-remove") return libUI.sel && requestRemoval("film", libUI.sel[0], titleOf(libUI.sel[1]));
      if (act === "lib-jump") {
        const fo = libUI.focus;
        if (fo && fo.film) return jumpTo(fo.film[0], fo.film[1]);
        const right = fo && fo.folder && libUI.path.includes(fo.folder) ? fo.folder : libUI.path[libUI.path.length - 1];
        if (wall.level !== "wall") { wall.level = "wall"; showStage(); }
        return requestAnimationFrame(() => flyToFolder(right));
      }
      if (act === "find-type") return toggleMenu(".lbs-find-types");
      if (act === "find-as") { toggleMenu(".lbs-find-types", false); return $(".lbs-find-q", root)?.focus(); }
      if (act === "req-send") return sendAddition(btn);
      if (act === "lb-watch" || act === "lb-like" || act === "lb-wl" || act === "lb-block") return lbAction(act, btn);
      if (act === "lb-more") { const m = btn.parentElement.querySelector(".lbs-lb-menu"); if (m) { const was = m.hidden; root.querySelectorAll(".lbs-menu").forEach((x) => (x.hidden = true)); m.hidden = !was; } return; }
      if (act === "f-jump") return jumpTo(fs, fn);
      if (act === "f-fr") { closeFilm(); return openFranchise(fs, fn); }
      if (act === "f-uncat") return moveFilms([[fs, fn]], UNCAT);
      if (act === "f-editx") { openFilm(fs, fn); ui.pane = "edit"; return renderFilm(); }
      if (act === "f-edit") { if (!ui.film || ui.film.slug !== fs) { ui.film = { slug: fs, name: fn }; filmDetails(fs).then((d) => ui.film && ui.film.slug === fs && renderFilm(d)); } ui.pane = ui.pane === "edit" ? null : "edit"; return renderFilm(); }
      if (act === "f-sort") { closeFilm(); $(".lbs-card", root).hidden = true; return openSort(fs, fn); }
      if (act === "f-return") { releaseFilm(fs); renderPocket(); drawSoon(); return toast(`‘${titleOf(fn)}’ is back on the shelf.`); }
      if (act === "f-color-reset") { delete mine.colors[fs]; saveMine(); drawSoon(); return renderFilm(); }
      if (act === "pocket") { ui.pocket = !ui.pocket; return renderPocket(); }
      if (act === "mine-save") return backupMine();
      if (act === "find-pick") return showCard(fs, fn);
      if (act === "card-close") { $(".lbs-card", root).hidden = true; return; }
      if (act === "sp-close") { ui.sortFilm = null; return renderSortPanel(); }
      if (act === "sp-cat") { ui.sortCat = id; ui.sortSub = null; ui.sortAdding = null; return renderSortPanel(); }
      if (act === "sp-sub") { ui.sortSub = id; return renderSortPanel(); }
      if (act === "sp-move") { if (!ui.sortSub) return; moveFilms([ui.sortFilm], ui.sortSub); ui.sortSub = null; return renderSortPanel(); }
      if (act === "sp-add") { ui.sortAdding = btn.dataset.level; return renderSortPanel(); }
      if (act === "fr-open") return openFranchise(ui.sortFilm[0], ui.sortFilm[1]);
      if (act === "fr-close") { ui.fr = null; return renderFranchise(); }
      if (act === "fr-drop") { ui.fr.films.splice(+btn.dataset.i, 1); return renderFranchise(); }
      if (act === "fr-add") {
        ui.fr.name = $(".lbs-fr-name", root)?.value || ui.fr.name;
        const add = () => { ui.fr.films.push([fs, fn]); renderFranchise(); $(".lbs-fr-q", root)?.focus(); };
        const home = ui.fr.films[0] && filmSection(ui.fr.films[0][0]), there = filmSection(fs);
        if (home && there && home !== there) {
          // Keep the franchise builder's state; the question box is shared with it.
          const keep = ui.fr;
          ui.fr = null;
          return ask(`‘${esc(titleOf(fn))}’ is in <b>${esc(nameOf(there))}</b>, not <b>${esc(nameOf(home))}</b>. Pull it into this franchise? It'll sit with the others in ${esc(nameOf(home))}.`, () => { ui.fr = keep; add(); }, "Yes, pull it in", () => { ui.fr = keep; renderFranchise(); });
        }
        return add();
      }
      if (act === "fr-save") return saveFranchise();
      if (act === "frm-all" || act === "frm-out") {
        const box = $(".lbs-ask", root), m = box._frm;
        box.hidden = true; box._frm = null;
        if (!m) return;
        if (act === "frm-out") { franchiseRemove(m.films.map(([x]) => x)); buildLibrary(); return moveFilms(m.films, m.target, { fr: true }); }
        return moveFilms([...m.films, ...m.extra], m.target, { fr: true });
      }
      if (act === "find-who") return openWho(btn.dataset.k);
      if (act === "fr-open") { closeFilm(); $(".lbs-find-list", root).hidden = true; $(".lbs-card", root).hidden = true; return openFranchiseById(btn.dataset.fr); }
      if (act === "fr-logo") { ui.fr.logo = btn.dataset.path; return renderFranchise(); }
      if (act === "fr-delete") { delete franchises()[ui.fr.id]; saveMine(); shareEdit("franchise", ui.fr.id, null); ui.fr = null; renderFranchise(); refresh(); return toast("Franchise undone."); }
      if (act === "req-remove-film") return requestRemoval("film", ui.sortFilm[0], titleOf(ui.sortFilm[1]));
      if (act === "req-remove-this") return requestRemoval("film", fs, titleOf(fn));
      if (act === "req-remove") { $(".lbs-sortpick", root).hidden = true; return requestRemoval("section", id, nameOf(id)); }
      if (act === "req-add") { e.stopPropagation(); return requestAddition(fs, fn, btn); }
      if (act === "ask-no" || act === "ask-yes") { const box = $(".lbs-ask", root); box.hidden = true; box._frm = null; const y = box._yes, n = box._no; box._yes = box._no = null; if (act === "ask-yes" && y) y(); else if (act === "ask-no" && n) n(); return; }
    }
    if (act === "sort") return setSort(id, btn.dataset.v);
    if (act === "grab") { edit.grab = btn.dataset.v; return renderTray(); }
    if (act === "w-clear") return houseEdit("Everything is back in the inventory.", (H) => setPlan(H, {}));
    if (act === "w-auto") return houseEdit("Auto-arranged the wall.", (H) => {
      // each genre arranged within its own region
      const all = sectionStock();
      H.walls = { ...(H.walls || {}) };
      for (const g of roomGenres()) H.walls[g] = { shelves: autoArrange(new Map([...all].filter(([, P]) => P.genre === g)), wall.plan.perRow).shelves };
      H.wall = { perRow: wall.plan.perRow };
    });
    if (act === "rename") { e.stopPropagation(); edit.renaming = id; edit.deleting = null; return renderFolders(); }
    if (act === "del") { e.stopPropagation(); edit.deleting = id; edit.renaming = null; return renderFolders(); }
    if (act === "del-yes") return deleteFolder(id);
    if (act === "del-no") { edit.deleting = null; return renderFolders(); }
    if (act === "approve") { e.stopPropagation(); return approveFolder(id); }
    if (act === "h-undo") { undoHouse(); return toast("Undone."); }
    if (act === "h-save") return downloadHouse();
    if (act === "h-discard") {
      houseLocal = null;
      edit.undo = [];
      persist(HOUSE_KEY, null);
      refresh();
      return toast("Discarded your unpublished changes.");
    }

    if (act === "cpick") return openNativePicker(btn);
    if (act === "cat-build") return openCatBuild();
    if (act === "cat-close") { $(".lbs-catbuild", root).hidden = true; return; }
    if (act === "cat-stop") { catJob.running = false; catJob.msg = "pausing after the requests in flight…"; return renderCatBuild(); }
    if (act === "cat-start") { runCatJob(); return; }
    if (act === "cat-save") return downloadCatalogue();
    if (act === "cat-details") {
      if (!catJob.st) return;
      if (catJob.st.info) catJob.st.info = catJob.st.info.map((x) => (x ? [x[0]] : null)); // read them again
      catJob.st.phase = catJob.st.info && catJob.st.info.some(Boolean) ? "details" : "lids";
      return runCatJob();
    }
    if (act === "cat-facts") { if (!catJob.st) return; catJob.st.phase = "facts"; return runCatJob(); }
    if (act === "cat-deep") { if (!catJob.st) return; catJob.st.phase = "deep"; return runCatJob(); }
    if (act === "cat-keywords") { if (!catJob.st) return; catJob.st.phase = "keywords"; return runCatJob(); }
    if (act === "cat-try") {
      // Stock the store from the finished job, in this tab only (nothing published).
      useCatalogue(JSON.parse(JSON.stringify(catalogueJSON())));
      stock = stockFromCatalogue(); defaults = null; lib = null;
      return render();
    }
    if (act === "cat-reset") { catJob.st = catBlank(); idbDel(CAT_KEY).catch(() => {}); return renderCatBuild(); }
    if (act === "logo-build") { const b = $(".lbs-logobuild", root); b.hidden = !b.hidden; return renderLogoBuild(); }
    if (act === "logo-close") { $(".lbs-logobuild", root).hidden = true; return; }
    if (act === "logo-stop") { logoJob.running = false; return renderLogoBuild(); }
    if (act === "logo-save") return downloadLogos();
    if (act === "logo-forget") { try { localStorage.removeItem(TMDB_KEY); } catch {} return renderLogoBuild(); }
    if (act === "logo-start") {
      const input = $(".lbs-tmdb-key", root);
      if (input && input.value.trim()) writeJSON(TMDB_KEY, input.value.trim());
      const key = readJSON(TMDB_KEY, "");
      if (!key) { logoJob.error = "Paste your TMDB key first."; return renderLogoBuild(); }
      runLogoJob(key);
      return renderLogoBuild();
    }
    if (act === "close") return leaveStore();
    if (act === "retry") return render();
    if (act === "desk") return setDesk(!desk.open);
    if (act === "undo") {
      const t = $(".lbs-toast", root);
      const fn = t && t._undo;
      t.hidden = true;
      if (fn) { fn(); toast("Undone."); }
      return;
    }
    if (act === "back") return walk(-1);
    if (act === "on") return walk(1);
    if (act === "goto") {
      const el = walkway?.els[+btn.dataset.n];
      if (el) walkway.track.scrollTo({ left: Math.max(0, el.offsetLeft - 12), behavior: "smooth" });
      return;
    }
    if (act === "open" && edit.on && lib.cats.has(id) && inRoom(lib.cats.get(id).genre)) { edit.sel = id; drawSoon(); }
    if (act === "open") {
      if (!desk.open) {
        desk.folder = id;
        desk.folder = id;
        return setDesk(true);
      }
      openFolder(id);
      if (desk.mode === "store") requestAnimationFrame(() => flyToFolder(id));
      return;
    }
    if (act === "aisles") return fit(); // (there's only the room now)
    if (act === "go-genre") return flyToFolder(id);
    if (act === "enter") { wall.level = "wall"; desk.folder = id; renderFolders(); return showStage(); }
    if (act === "fit") return fit();
    if (act === "zoom-in" || act === "zoom-out") {
      const c = wall.canvas;
      return c && zoomAt(act === "zoom-in" ? 1.6 : 1 / 1.6, c.clientWidth / 2, c.clientHeight / 2);
    }
    if (act === "col") { desk.folder = id || null; return renderFolders(); }
    if (act === "up") {
      const p = partsOf(desk.folder);
      return openFolder(p.sub ? p.cat : p.cat ? p.genre : null);
    }
    if (act === "more") { desk.shown += 300; return renderFilms(); }
    if (act === "add") { desk.adding = { level: btn.dataset.level, parent: btn.dataset.parent }; return renderFolders(); }
    if (act === "cancel-move") { desk.moving = null; return renderDesk(); }
    if (act === "move-here") { e.stopPropagation(); return desk.moving && moveFilms(desk.moving, id); }
  }

  function selectRow(row, e) {
    const slug = row.dataset.slug;
    const rows = [...root.querySelectorAll(".lbs-row")];
    if (e.shiftKey && desk.anchor) {
      const a = rows.findIndex((r) => r.dataset.slug === desk.anchor);
      const b = rows.indexOf(row);
      if (a >= 0) rows.slice(Math.min(a, b), Math.max(a, b) + 1).forEach((r) => desk.selected.add(r.dataset.slug));
    } else if (e.metaKey || e.ctrlKey) {
      if (desk.selected.has(slug)) desk.selected.delete(slug);
      else desk.selected.add(slug);
      desk.anchor = slug;
    } else {
      const only = desk.selected.size === 1 && desk.selected.has(slug);
      desk.selected.clear();
      if (!only) desk.selected.add(slug);
      desk.anchor = slug;
    }
    rows.forEach((r) => {
      const on = desk.selected.has(r.dataset.slug);
      r.classList.toggle("-sel", on);
      r.setAttribute("aria-selected", on);
    });
  }

  function onInput(e) {
    if (e.target.classList.contains("lbs-lv-q")) { lv.q = e.target.value; lv.cursor = null; const l = $(".lbs-lv-list", root); if (l) l.scrollTop = 0; return renderLibrary(); }
    if (e.target.classList.contains("lbs-lv-gq")) { lv.more[e.target.dataset.g + ":q"] = e.target.value; return renderLibrary(); }
    if (e.target.classList.contains("lbs-lv-y")) { lv[e.target.dataset.y] = e.target.value.length === 4 || !e.target.value ? e.target.value : lv[e.target.dataset.y]; saveLv(); return renderLibrary(); }
    if (e.target.classList.contains("lbs-tray-filter")) { edit.filter = e.target.value || null; return renderTray(); }
    if (e.target.dataset && e.target.dataset.fmt) return setFormat(e.target.dataset.fmt, { on: e.target.checked });
    if (e.target.dataset && e.target.dataset.fmtTo) {
      const v = +e.target.value;
      if (String(e.target.value).length === 4 && v >= 1880 && v <= 2100) setFormat(e.target.dataset.fmtTo, { to: v });
      return;
    }
    if (e.target.dataset && e.target.dataset.set) {
      const key = e.target.dataset.set;
      mine[key] = !!e.target.checked;
      saveMine();
      root.querySelectorAll(`input[data-set="${key}"]`).forEach((x) => (x.checked = mine[key]));
      if (key === "noDates") { mine.noDates = !e.target.checked; saveMine(); root.classList.toggle("lbs-nodates", mine.noDates); root.querySelectorAll('input[data-set="noDates"]').forEach((x) => (x.checked = !mine.noDates)); }
      if (key === "hideBlocked" || key === "overlay" || key === "noDates") drawSoon();
      return;
    }
    if (e.target.classList.contains("lbs-restore-file")) { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) restoreMine(f); return; }
    if (e.target.classList.contains("lbs-f-wash") || e.target.classList.contains("lbs-f-washc")) {
      const ws = e.target.dataset.slug, pane = e.target.closest(".lbs-fpane");
      const on = pane.querySelector(".lbs-f-wash").checked, col = pane.querySelector(".lbs-f-washc").value;
      if (on) mine.wash[ws] = col; else delete mine.wash[ws];
      pane.querySelector(".lbs-f-washc").disabled = !on;
      const sw = pane.querySelector(".lbs-f-washc + .lbs-swatch");
      if (sw) sw.disabled = !on;
      saveMine();
      drawSoon();
      const fb = $(".lbs-filmview .lbs-fbox", root);
      if (fb && ui.film) { fb.innerHTML = boxHTML(ui.film.slug, ui.film.name, true); fillPosters(fb, true); }
      clearTimeout(ui.washT);
      ui.washT = setTimeout(() => shareEdit("wash", ws, on ? col : null), 1200);
      return;
    }
    if (e.target.classList.contains("lbs-fr-q")) return franchiseSearch(e.target.value);
    if (e.target.classList.contains("lbs-fr-name")) { if (ui.fr) ui.fr.name = e.target.value; return; }
    if (e.target.classList.contains("lbs-fr-color")) { if (ui.fr) ui.fr.color = e.target.value.slice(1); return; }
    if (e.target.classList.contains("lbs-sp-genre-pick")) { ui.sortGenre = e.target.value; ui.sortCat = null; ui.sortSub = null; return renderSortPanel(); }
    if (e.target.classList.contains("lbs-find-q")) return runFind(e.target.value);
    if (e.target.classList.contains("lbs-f-color")) {
      const cs = e.target.dataset.slug;
      mine.colors[cs] = e.target.value.slice(1);
      saveMine();
      clearTimeout(ui.colorT);
      ui.colorT = setTimeout(() => shareEdit("color", cs, mine.colors[cs]), 1200);
      if (wall.lay) recolourSections();
      drawSoon();
      const box = $(".lbs-filmview .lbs-box", root);
      if (box) box.style.setProperty("--spine", e.target.value);
      // a film can's tape takes the colour too: redraw it live
      const can = $(".lbs-filmview canvas.lbs-can-cv", root);
      if (can) { can.dataset.tape = e.target.value; drawCanBig(can, can._poster || null, e.target.value, can._f); }
      return;
    }
    if (e.target.classList.contains("lbs-fq")) {
      desk.q = e.target.value;
      if (desk.mode === "store" && desk.q) desk.mode = "list";
      desk.shown = 150;
      if (desk.scope === "all") searchAll();
      else renderFilms();
    } else if (e.target.classList.contains("lbs-dq")) {
      desk.fq = e.target.value;
      renderFolders();
      e.target.focus();
    }
  }

  function onFieldKey(e) {
    if (e.target.classList.contains("lbs-find-q")) {
      const items = [...root.querySelectorAll(".lbs-find-list li[data-slug]")];
      const at = items.findIndex((li) => li.classList.contains("-on"));
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        const n = items.length ? (at + (e.key === "ArrowDown" ? 1 : -1) + items.length) % items.length : -1;
        items.forEach((li, k) => li.classList.toggle("-on", k === n));
      } else if (e.key === "Enter") {
        const li = items[at >= 0 ? at : 0];
        if (li) { e.preventDefault(); showCard(li.dataset.slug, li.dataset.name); }
      } else if (e.key === "Escape") { $(".lbs-find-list", root).hidden = true; $(".lbs-card", root).hidden = true; }
      return;
    }
    if (e.target.classList.contains("lbs-lib-new-name")) {
      if (e.key === "Enter") {
        e.preventDefault();
        const parent = libUI.adding, level = e.target.dataset.level, name = e.target.value;
        libUI.adding = null;
        if (parent && name.trim()) addFolder(level, parent, name);
        renderLibrary();
      } else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); libUI.adding = null; renderLibrary(); }
      return;
    }
    if (e.target.classList.contains("lbs-sp-new")) {
      if (e.key === "Enter") {
        e.preventDefault();
        const level = e.target.dataset.level;
        const parent = level === "cat" ? ui.sortGenre : ui.sortCat;
        addFolder(level, parent, e.target.value);
        ui.sortAdding = null;
        if (desk.folder && desk.folder !== parent) { if (level === "cat") ui.sortCat = desk.folder; else ui.sortSub = desk.folder; }
        renderSortPanel();
      } else if (e.key === "Escape") { e.preventDefault(); ui.sortAdding = null; renderSortPanel(); }
      return;
    }
    if (e.target.classList.contains("lbs-rename")) {
      if (e.key === "Enter") { e.preventDefault(); renameFolder(edit.renaming, e.target.value); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); edit.renaming = null; renderFolders(); }
      return;
    }
    if (e.target.classList.contains("lbs-new")) {
      if (e.key === "Enter") { e.preventDefault(); addFolder(desk.adding.level, desk.adding.parent, e.target.value); }
      else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); desk.adding = null; renderFolders(); }
    } else if (e.target.classList.contains("lbs-dq") && e.key === "Enter") {
      // Enter in folder search: open (or move into) the first match.
      const first = $(".lbs-hits .lbs-folder", root);
      if (!first) return;
      e.preventDefault();
      if (desk.moving) moveFilms(desk.moving, first.dataset.id);
      else openFolder(first.dataset.id);
    }
  }

  /* ---------------- ways in ---------------- */

  function syncToHash() {
    if (/^#store\b/.test(location.hash)) openStore();
    else closeStore();
  }

  function enterStore(e) {
    if (e) e.preventDefault();
    if (/^#store\b/.test(location.hash)) return openStore();
    history.pushState({ ...(history.state || {}), lbsStore: true }, "", "#store");
    openStore();
  }

  // A "Store" item in Letterboxd's main navigation, right after Films.
  function addNavItem() {
    if (document.querySelector(".lbs-nav")) return;
    const films = [...document.querySelectorAll("header a[href='/films/'], .main-nav a[href='/films/'], nav a[href='/films/']")].find((a) => a.closest("li"));
    if (!films) return;
    const li = films.closest("li");
    const item = li.cloneNode(false);
    item.classList.add("lbs-nav");
    item.classList.remove("-active", "active", "-selected");
    const a = films.cloneNode(false);
    a.removeAttribute("aria-current");
    a.href = "#store";
    a.textContent = "BLOXBUSTER";
    a.addEventListener("click", enterStore);
    item.append(a);
    li.after(item);
  }

  // On the home page: a strip that walks you in.
  function addHomeStrip() {
    if (location.pathname !== "/" || document.querySelector(".lbs-home")) return;
    const host = document.querySelector("#content .content-wrap") || document.querySelector("#content");
    if (!host) return;
    const strip = h("section", "lbs-home");
    strip.innerHTML =
      `<a class="lbs-home-door${DESK_ONLY ? " -logo" : ""}" href="#store">` +
      (DESK_ONLY ? `<span class="lbs-home-logo">${LOGO_SVG}</span>` : "") +
      (DESK_ONLY ? "" : `<span class="lbs-home-kicker">LetterBloxd video store</span>`) +
      (DESK_ONLY
        ? `<span class="lbs-home-title">BLOXBUSTER is open</span><span class="lbs-home-sub">Browse the Horror wall, carry films around, sort the shelves your way. Walk in →</span>`
        : `<span class="lbs-home-title">The Horror wing is open</span><span class="lbs-home-sub">${AISLES.length + 1} aisles, every film on one shelf, A to Z. Walk in →</span>`) +
      `</a>`;
    strip.querySelector("a").addEventListener("click", enterStore);
    // Just under "Welcome back…", above your friends' activity.
    const hero = host.querySelector(":scope > .title-hero");
    if (hero) hero.after(strip);
    else host.prepend(strip);
  }

  function boot() {
    addNavItem();
    addHomeStrip();
    syncToHash();
  }

  window.addEventListener("hashchange", syncToHash);
  window.addEventListener("popstate", syncToHash);
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape" || !root || root.hidden) return;
    if (desk.moving) { desk.moving = null; return renderDesk(); }
    if (desk.open && !DESK_ONLY) return setDesk(false);
    leaveStore();
  });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
  else boot();
  // Letterboxd sometimes redraws its header after load; keep the Store link.
  setTimeout(addNavItem, 1500);
  setTimeout(addNavItem, 5000);
})();
