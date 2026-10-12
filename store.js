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
  const EVERYTHING = { id: "rest", name: "Everything Else", q: "genre/horror", one: "Horror", many: "Horror" };

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
  const fileKey = (name) =>
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
  const roomGenres = () => (lib ? GENRES.map(([id]) => id).filter((g) => lib.genres.has(g) && (lib.count.get(g) || 0) > 0) : [STOCKED]);
  const inRoom = (genreId) => roomGenres().includes(genreId);
  const roomCats = () => roomGenres().flatMap((g) => lib.genres.get(g).cats);
  // For now the Store opens straight into the Sorting Desk; the walkable
  // aisles are switched off (set false to bring them back).
  const DESK_ONLY = true;

  // Your own moves and folders ("Mine"). Kept in this browser only.
  const MINE_KEY = `${NS}:store:mine:v1`;
  let mine = readJSON(MINE_KEY, null) || {};
  mine = { place: {}, cats: {}, subs: {}, recent: [], view: "community", sort: {}, held: [], colors: {}, wash: {}, ...mine };
  const saveMine = () => writeJSON(MINE_KEY, mine);

  /* What everyone has changed (the store's shared edits), folded by the
   * backend into one small state file and fetched once per visit. Layers:
   * built-in defaults < house plan < shared edits < your own edits. */
  let shared = { place: {}, logo: {}, color: {}, wash: {}, franchises: {}, cats: {}, subs: {} };
  function applySharedState(data) {
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
  const blankHouse = () => ({ v: 1, names: {}, hidden: [], cats: {}, subs: {}, place: {}, order: [], subOrder: {}, index: {}, sort: {}, held: [], wall: null });
  const fullHouse = (x) => ({ ...blankHouse(), ...(x || {}) });
  let houseShared = null;
  let houseLocal = readJSON(HOUSE_KEY, null);
  const house = () => fullHouse(houseLocal || houseShared);
  // grab: "one" moves a single piece; "group" moves every piece of that section, keeping its shape.
  const edit = { on: false, sel: null, renaming: null, deleting: null, undo: [], grab: "one" };
  const isFixed = (id) => !id || lib.genres.has(id) || /\/(rest|general)$/.test(id);
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
  function houseEdit(label, fn) {
    edit.undo.push(JSON.stringify(houseLocal));
    if (edit.undo.length > 60) edit.undo.shift();
    houseLocal = fullHouse(JSON.parse(JSON.stringify(house())));
    fn(houseLocal);
    writeJSON(HOUSE_KEY, houseLocal);
    refresh();
    if (label) toast(label, undoHouse);
  }
  function undoHouse() {
    if (!edit.undo.length) return;
    houseLocal = JSON.parse(edit.undo.pop());
    if (houseLocal) writeJSON(HOUSE_KEY, houseLocal);
    else try { localStorage.removeItem(HOUSE_KEY); } catch {}
    refresh();
  }

  // The house placement for every stocked film: aisle, then the first shelf
  // rule it matches (rules with fewer than MIN_SHELF films fall through).
  function houseDefaults() {
    const out = new Map();
    const tagSets = Object.entries(stock.tags || {}).map(([t, list]) => [t, new Set(list)]);
    for (const a of [...AISLES, EVERYTHING]) {
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

    for (const [id, name] of GENRES) genres.set(id, { id, name, cats: [] });
    // Every genre has "Everything Else", and every category has "General".
    for (const [g] of GENRES) {
      if (g === STOCKED) continue;
      addCat({ id: `${g}/rest`, genre: g, name: "Everything Else", order: 2 });
    }
    for (const a of [...AISLES, EVERYTHING]) {
      const id = `${STOCKED}/${a.id}`;
      addCat({ id, genre: STOCKED, name: a.name, aisle: a, order: a === EVERYTHING ? 2 : 1 });
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
    // Deleted folders (never a genre, "Everything Else" or "General").
    for (const id of H.hidden) {
      if (genres.has(id) || /\/(rest|general)$/.test(id)) continue;
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
    // Franchises: every film sits where #1 sits.
    for (const fr of Object.values(allFranchises())) {
      const lead = fr.films.find(([s]) => place.has(s));
      if (!lead) continue;
      const at = place.get(lead[0]);
      for (const [s, n] of fr.films) { place.set(s, at); if (!names.has(s)) names.set(s, n); }
    }
    // A film whose folder was deleted drops one level: to its category's
    // General, or to the genre's Everything Else.
    const home = (sub) => {
      if (subs.has(sub)) return sub;
      // A deleted niche's films go back to its subcat.
      const up = String(sub).split("/").slice(0, -1).join("/");
      if (up.split("/").length >= 3 && subs.has(up)) return up;
      const parts = String(sub).split("/");
      const cat = parts.slice(0, 2).join("/");
      return cats.has(cat) ? `${cat}/general` : `${parts[0]}/rest/general`;
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
    genres.get(STOCKED).cats.sort((a, b) => wallKey(a) - wallKey(b));
    for (const g of genres.values()) if (g.id !== STOCKED && g.cats.some((c) => H.order.includes(c))) g.cats.sort((a, b) => wallKey(a) - wallKey(b));
    for (const c of cats.values()) {
      const o = H.subOrder[c.id];
      const k = (id) => { const i = o ? o.indexOf(id) : -1; return i < 0 ? 1e6 : i; };
      c.subs.sort((a, b) => k(a) - k(b) || byName(subs)(a, b));
      for (const sid of c.subs) { const o2 = H.subOrder[sid]; const k2 = (id) => { const i = o2 ? o2.indexOf(id) : -1; return i < 0 ? 1e6 : i; }; subs.get(sid).niches.sort((a, b) => k2(a) - k2(b) || byName(subs)(a, b)); }
    }
    const rank = (lib && lib.rank) || new Map(stock.films.map(([slug], i) => [slug, i]));
    lib = { genres, cats, subs, place, names, inSub, count, rank };
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
  const nameOf = (id) => (lib.genres.get(id) || lib.cats.get(id) || lib.subs.get(id) || {}).name || "";
  function pathOf(id) {
    const p = partsOf(id);
    return [p.genre, p.cat, p.sub, p.niche].filter(Boolean).map(nameOf);
  }
  // A drop on a genre files under its Everything Else; on a category, under General.
  function landingSub(id) {
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

  function fillPoster(el) {
    const img = el.querySelector("img");
    posterFor(el.dataset.slug)
      .then(([one, two]) => {
        img.src = one;
        img.srcset = `${one} 1x, ${two} 2x`;
        el.classList.add("lbs-loaded");
      })
      .catch(() => el.classList.add("lbs-noposter"));
  }
  const imgAttrs = (slug) => {
    const c = posterCache.get(slug);
    return c ? `src="${esc(c[0])}" srcset="${esc(c[0])} 1x, ${esc(c[1])} 2x"` : `src="${EMPTY}"`;
  };

  function posterHTML([slug, name], tag) {
    return (
      `<li class="lbs-item${posterCache.has(slug) ? " lbs-loaded" : ""}" data-slug="${esc(slug)}" data-name="${esc(name)}" draggable="true">` +
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
  const ICON_SEARCH = `<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="2.2"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

  function openStore() {
    if (!document.body) return;
    if (!root) {
      root = h("div", "lbs-root");
      root.setAttribute("role", "dialog");
      root.setAttribute("aria-label", "LetterBloxd Video Store");
      document.body.append(root);
      root.addEventListener("click", onClick);
      root.addEventListener("input", onInput);
      root.addEventListener("keydown", onFieldKey);
      root.addEventListener("dragstart", onDragStart);
      root.addEventListener("dragend", onDragEnd);
      root.addEventListener("dragover", onDragOver);
      root.addEventListener("dragleave", onDragLeave);
      root.addEventListener("drop", onDrop);
      root.addEventListener("contextmenu", onContextMenu);
      root.addEventListener("mousedown", (e) => {
        maybeCollapsePocket(e);
        if (e.button !== 0) return;
        const pc = edit.on && e.target.closest(".lbs-tray .lbs-piece");
        if (pc) { e.preventDefault(); return grabDown({ kind: "piece", cid: pc.dataset.cid, from: "tray" }, e); }
        const dv = e.target.closest(".lbs-tray .lbs-dvd, .lbs-pk, .lbs-sp-chip, .lbs-lib-film");
        if (dv && !e.target.closest("button")) { e.preventDefault(); grabDown({ kind: "dvd", slug: dv.dataset.slug, name: dv.dataset.name, from: dv.classList.contains("lbs-lib-film") ? "lib" : dv.classList.contains("lbs-sp-chip") ? "card" : "tray" }, e); }
      });
      root.addEventListener("dblclick", (e) => {
        const lf = e.target.closest(".lbs-lib-film");
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
    stock = stock || loadStock();
    const total = stock ? stock.films.length : COLLECTIONS[0].count;
    root.classList.toggle("lbs-nodates", !!mine.noDates);
    root.innerHTML =
      `<header class="lbs-top">` +
      (DESK_ONLY ? "" : `<div class="lbs-brand">LetterBloxd <span>video store</span></div>`) +
      (DESK_ONLY
        ? `<div class="lbs-logo">${LOGO_SVG}</div><button type="button" class="lbs-lib-btn" data-act="lib" aria-label="Library: every folder and film">${ICON_FOLDER}<span>Library</span></button>`
        : `<div class="lbs-wing-sign"><b>Horror</b><span>wing</span></div>`) +
      `<nav class="lbs-collections" aria-label="Collections"${DESK_ONLY ? " hidden" : ""}>` +
      COLLECTIONS.map((c) =>
        `<button type="button" class="lbs-coll${c.id === collection ? " -on" : ""}${c.open ? "" : " -soon"}" data-coll="${c.id}"${c.open ? "" : ' aria-disabled="true"'}>` +
        `${c.name} <span>${fmt(c.id === "main" ? total : c.count)}</span>${c.open ? "" : "<em>soon</em>"}</button>`
      ).join("") +
      `</nav>` +
      (DEV_TOOLS ? `<button type="button" class="lbs-edit-toggle" data-act="edit" aria-pressed="false">Edit store</button>` : "") +
      `<button type="button" class="lbs-close" data-act="close" aria-label="Leave the store">${ICON_CLOSE}</button>` +
      `</header>` +
      `<div class="lbs-hall"></div>`;

    const hall = $(".lbs-hall", root);
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
      `<div class="lbs-aisles"></div><canvas class="lbs-canvas" draggable="false" aria-label="Horror wall. Scroll to move, pinch or Ctrl-scroll to zoom, drag a spine to a folder."></canvas>` +
      `<div class="lbs-tip" hidden></div><div class="lbs-sortpick" hidden></div>` +
      `<div class="lbs-find">` +
      `<div class="lbs-find-box">${ICON_SEARCH}<input type="search" class="lbs-find-q" placeholder="Find a movie in the store" autocomplete="off" spellcheck="false">` +
      `<button type="button" class="lbs-find-type" data-act="find-type" aria-haspopup="menu" aria-label="Search for">Movie<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button></div>` +
      `<button type="button" class="lbs-gear" data-act="settings" aria-haspopup="menu" aria-label="Settings" title="Settings">${ICON_GEAR}</button>` +
      `<ul class="lbs-find-types lbs-menu" role="menu" hidden><li><button type="button" data-act="find-as" data-v="film" class="-on">Movie</button></li><li><button type="button" disabled>Actor <em>soon</em></button></li><li><button type="button" disabled>Director <em>soon</em></button></li><li><button type="button" disabled>Crew <em>soon</em></button></li></ul>` +
      `<div class="lbs-settings lbs-menu" role="menu" hidden></div>` +
      `<ul class="lbs-find-list" hidden></ul><div class="lbs-card" hidden></div></div>` +
      `<div class="lbs-logopick" hidden></div><div class="lbs-logobuild" hidden></div>` +
      `<p class="lbs-credit" hidden>Title logos from <a href="https://www.themoviedb.org/" target="_blank" rel="noopener">TMDB</a>. This product uses the TMDB API but is not endorsed or certified by TMDB.</p>` +
      `</div>` +
      `<ul class="lbs-rows" role="listbox" aria-multiselectable="true"></ul>` +
      `</div>` +
      `<div class="lbs-folders lbs-inv">` +
      `<div class="lbs-editbar" hidden></div>` +
      `<div class="lbs-tray" data-drop="@inv"></div>` +
      `</div>` +
      `</section>` +
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
            `<li class="lbs-row${desk.selected.has(slug) ? " -sel" : ""}${posterCache.has(slug) ? " lbs-loaded" : ""}" data-slug="${esc(slug)}" data-name="${esc(name)}" draggable="true" role="option" aria-selected="${desk.selected.has(slug)}">` +
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
      return `<li class="lbs-confirm">Delete <b>${esc(nameOf(id))}</b>?${n ? ` Its ${fmt(n)} film${n === 1 ? "" : "s"} go to ${lib.cats.has(id) ? "Everything Else" : "General"}.` : ""} <button type="button" data-act="del-yes" data-id="${esc(id)}">Delete</button><button type="button" data-act="del-no">Keep</button></li>`;
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
      `<li class="lbs-folder${edit.on && edit.sel === id ? " -editsel" : ""}" data-act="open" data-id="${esc(id)}" data-drop="${esc(id)}"${edit.on && !lib.genres.has(id) ? ' draggable="true"' : ""}>` +
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

  const wall = { level: "aisles", lay: null, cam: { x: 0, y: 0, z: 0.05 }, hover: null, pin: null, lite: false, slow: 0, imgs: new Map(), logos: new Map(), frame: 0 };
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
    // No plan yet: viewers get the automatic layout; a moderator starts with
    // an empty wall and every section in the workspace.
    const valid = (x) => x && typeof x === "object" && sections.has(x.c) && x.u > 0;
    // A plan from before blocks is converted; pieces of folders that no
    // longer exist are simply left out.
    const saved = H.wall && H.wall.shelves && Object.keys(H.wall.shelves).length ? { ...H.wall, shelves: migratePlan(H.wall.shelves, sections) } : null;
    const plan = saved || (edit.on ? { perRow, shelves: {} } : autoArrange(sections, perRow));
    wall.plan = { perRow, shelves: plan.shelves };
    const origin = (b) => ({ x: (b % perRow) * (WU.bayW + WU.gap), y: Math.floor(b / perRow) * ROW_H });

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
      const rest = autoArrange(new Map([...leftovers].map(([cid, items]) => [cid, { id: cid, items, genre: sections.get(cid).genre }])), perRow).shelves;
      let start = 1 + Math.max(-1, ...[...where.values()].map((w) => w.bay));
      // A different genre than the wall's last starts on a fresh row.
      const lastGenre = [...refCid].map(([r, c]) => [where.get(r), c]).sort((a, b) => b[0].bay - a[0].bay)[0];
      const firstLeft = sections.get([...leftovers.keys()][0]);
      if (lastGenre && firstLeft && sections.get(lastGenre[1]) && sections.get(lastGenre[1]).genre !== firstLeft.genre) start = Math.ceil(start / perRow) * perRow;
      const fed = new Map([...leftovers].map(([cid]) => [cid, 0]));
      for (const [key, list] of Object.entries(rest)) {
        const [b0, sh] = key.split(":").map(Number);
        const nk = `${b0 + start}:${sh}`;
        const keep = [];
        for (const pc of list) {
          const ref = `${nk}/${keep.length}`;
          where.set(ref, { bay: b0 + start, shelf: sh, slot: keep.length });
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
    const bays = edit.on ? Math.max(maxBay + 2, Math.ceil(totalShelves / WU.shelves) + 1) : maxBay + 1;
    const width = Math.min(bays, perRow) * (WU.bayW + WU.gap);
    const height = Math.ceil(bays / perRow) * ROW_H;
    // Each row of bays is an aisle; its sign names the categories along it.
    const aisles = [];
    for (const r of [...runs].sort((a, c) => a.bay - c.bay || a.shelf - c.shelf || a.x0 - c.x0)) {
      const row = Math.floor(r.bay / perRow);
      const a = aisles[row] || (aisles[row] = { row, y: row * ROW_H, secs: [], genre: lib.cats.get(secs[r.sec].id).genre });
      if (!a.secs.includes(r.sec)) a.secs.push(r.sec);
    }
    // Aisles are numbered within their genre.
    { const seen = new Map(); for (const a of aisles.filter(Boolean)) { const n = (seen.get(a.genre) || 0) + 1; seen.set(a.genre, n); a.num = n; } }
    wall.lay = { films, chunks, secs, runs, bookends, stickers, hang, aisles: aisles.filter(Boolean), left: -AISLE_W - AISLE_GAP, faces: [], idx, bucket, held: H.held, width, height, bays, k: perRow, origin };
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
      im.onload = () => { try { colors[slug] = measure(im); } catch {} ok(); };
      im.onerror = () => ok();
      im.src = url;
    })).catch(() => {});
  }

  async function runColorJob() {
    if (colorJob.running || !stock) return;
    colorJob.running = true;
    const todo = stock.films.map(([slug]) => slug).filter((s) => !colors[s]);
    colorJob.total = stock.films.length;
    colorJob.done = colorJob.total - todo.length;
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
  const LOGO_FILE = "https://raw.githubusercontent.com/if-iferror/letterbloxd/dev/data/horror-logos.json";
  const TMDB_IMG = "https://image.tmdb.org/t/p/";
  const LOGO_Z = 0.7; // logos appear from this zoom in
  let logoIndex = readJSON(LOGO_KEY, null) || { v: 1, films: {} };
  let logoShared = null; // the published index, once fetched
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
    if (logoShared) return;
    logoShared = {};
    fetch(LOGO_FILE, { cache: "no-cache" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => { if (j && j.films) { logoShared = j.films; drawSoon(); renderStagePath(); } })
      .catch(() => {});
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
    const todo = stock.films.filter(([slug]) => !logoIndex.films[slug]);
    logoJob.total = stock.films.length;
    logoJob.done = logoJob.total - todo.length;
    logoJob.found = Object.values(logoIndex.films).filter((e) => e.length > 1).length;
    let n = 0;
    const save = () => { logoIndex.at = Date.now(); writeJSON(LOGO_KEY, logoIndex); };
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
    const counted = Object.keys(logoIndex.films).length;
    if (!logoJob.running) logoJob.found = Object.values(logoIndex.films).filter((e) => e.length > 1).length;
    box.innerHTML =
      `<b>Title logos from TMDB</b>` +
      `<p>Matches each Horror film to TMDB and keeps its first logo. Your TMDB key stays in this browser; it's only used for this.</p>` +
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
    const films = Object.fromEntries(Object.entries(logoIndex.films).filter(([, e]) => e[0]).sort());
    const blob = new Blob([JSON.stringify({ v: 1, at: new Date().toISOString().slice(0, 10), source: "TMDB", films })], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "horror-logos.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
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
    posterFor(slug).then(([one]) => { im.onload = drawSoon; im.src = one; }).catch(() => {});
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
      for (const b of inView) {
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
      const ax = -AISLE_W - AISLE_GAP / 2, ay = a.y + WU.sign - 10, ah = WU.shelves * WU.shelfH + 10;
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

    // Too slow on this machine? Drop the extras (no sheen, no titles, 1x pixels).
    const ms = performance.now() - t0;
    wall.slow = ms > 28 ? wall.slow + 1 : Math.max(0, wall.slow - 1);
    if (wall.slow > 6 && !wall.lite) { wall.lite = true; toast("Simplified the shelves to keep things smooth on this computer."); drawSoon(); }
    renderStagePath();
  }

  function bayAt(p) {
    const L = wall.lay;
    const col = Math.floor(p.x / (WU.bayW + WU.gap)), row = Math.floor(p.y / ROW_H);
    if (col < 0 || col >= L.k || row < 0) return { b: -1, s: -1 };
    return { b: row * L.k + col, s: Math.floor((p.y - row * ROW_H - WU.sign) / WU.shelfH) };
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
      `<button type="button" class="lbs-crumb" data-act="aisles">Store</button>` +
      (wall.level === "wall" ? `<i>›</i><button type="button" class="lbs-crumb" data-act="fit">Horror</button>` : "") +
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
      `<div><b>${esc(titleOf(f.name))}</b><span>${f.year || ""}</span><small>${esc(pathOf(f.sub).join(" › "))}</small>` +
      `<a href="/film/${esc(f.slug)}/" target="_blank" rel="noopener">Open on Letterboxd ↗</a><em>Drag to a folder to re-file${logoEntry(f.slug)?.[0] ? " · right-click for other logos" : ""}</em></div>`;
    if (!cached) posterFor(f.slug).then(([u]) => { const im = tip.querySelector("img"); if (im && wall.hover === i) im.src = u; }).catch(() => {});
    const st = $(".lbs-stage", root).getBoundingClientRect();
    tip.hidden = false;
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    tip.style.left = `${Math.min(sx + 18, st.width - tw - 8)}px`;
    tip.style.top = `${Math.max(8, Math.min(sy - th / 2, st.height - th - 8))}px`;
  }

  // The aisles: one box per genre, Horror stocked.
  function renderAisles() {
    const box = $(".lbs-aisles", root);
    const top3 = stock.films.slice(0, 3).map(([s]) => s);
    box.innerHTML = [...lib.genres.values()]
      .map((g) => {
        const n = lib.count.get(g.id) || 0;
        const live = n > 0;
        return (
          `<button type="button" class="lbs-aisle-box${live ? " -live" : ""}" data-act="${live ? "enter" : "open"}" data-id="${esc(g.id)}" data-drop="${esc(g.id)}">` +
          `<span class="lbs-aisle-sign">${esc(g.name)}</span>` +
          (live ? `<span class="lbs-aisle-posters">${top3.map((s) => `<img data-slug="${esc(s)}" src="${posterCache.has(s) ? esc(posterCache.get(s)[0]) : EMPTY}" alt="">`).join("")}</span>` : `<span class="lbs-aisle-empty">not stocked yet</span>`) +
          `<span class="lbs-aisle-n">${fmt(n)} film${n === 1 ? "" : "s"}</span></button>`
        );
      })
      .join("");
    box.querySelectorAll("img[data-slug]").forEach((im) => posterFor(im.dataset.slug).then(([u]) => (im.src = u)).catch(() => {}));
  }

  function showStage() {
    const stage = $(".lbs-stage", root);
    if (!stage) return;
    stage.hidden = false;
    const aisles = $(".lbs-aisles", root), canvas = $(".lbs-canvas", root);
    aisles.hidden = wall.level !== "aisles";
    canvas.hidden = wall.level !== "wall";
    $(".lbs-zoom", root).hidden = wall.level !== "wall";
    if (wall.level === "aisles") renderAisles();
    else {
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
        if (run) { c.draggable = false; e.preventDefault(); wall.grabAt = p.x - run.x0; return grabDown({ kind: "piece", ref: run.ref, from: "wall" }, e); }
      }
      const i = filmAt(e.offsetX, e.offsetY);
      if (e.button === 0 && i != null) {
        // Pick the box up (our own drag, not the browser's, which drags the whole picture).
        const f = wall.lay.films[i];
        c.draggable = false;
        e.preventDefault();
        return grabDown({ kind: "dvd", slug: f.slug, name: f.name, from: "wall" }, e);
      }
      c.draggable = i != null; // on a spine: pick it up; elsewhere: pan
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
      c.style.cursor = i != null ? "grab" : wall.cam.z < NEAR ? "zoom-in" : "default";
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
      openFilm(f.slug, f.name);
      ui.pane = "edit";
      renderFilm();
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
    el.querySelectorAll("img[data-poster]").forEach((im) => posterFor(im.dataset.poster).then(([a, b]) => (im.src = big ? b || a : a)).catch(() => {}));
    // Film cans in the film view: draw the can, then again once the poster is in.
    el.querySelectorAll("canvas.lbs-can-cv").forEach((cv) => {
      const name = cv.dataset.name || (lib && lib.names.get(cv.dataset.can)) || cv.dataset.can;
      const f = { slug: cv.dataset.can, name, year: yearOf(name) };
      cv._f = f;
      drawCanBig(cv, null, cv.dataset.tape, f);
      posterFor(cv.dataset.can).then(([a, b]) => {
        const im = new Image();
        im.onload = () => { cv._poster = im; drawCanBig(cv, im, cv.dataset.tape, f); };
        im.src = cv.dataset.big ? b || a : a;
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
        `<label class="lbs-fcolor">Case colour <input type="color" class="lbs-f-color" value="#${own ? own.slice(0, 6) : "2c3440"}" data-slug="${esc(slug)}">` +
        (mine.colors[slug] ? `<button type="button" data-act="f-color-reset" data-slug="${esc(slug)}">Use the poster's colour</button>` : "") + `</label>` +
        `<div class="lbs-flogos">` +
        (list ? list.map((pth, n) => `<button type="button" data-act="logo-pick" data-slug="${esc(slug)}" data-path="${esc(pth)}" class="${cur === pth ? "-on" : ""}"><img src="${TMDB_IMG}w185/${esc(pth)}" alt="Logo ${n + 1}" loading="lazy"></button>`).join("") : `<p class="lbs-fwait">Fetching every logo from TMDB…</p>`) +
        `<button type="button" data-act="logo-pick" data-slug="${esc(slug)}" data-path="-1" class="-plain${cur === null ? " -on" : ""}">Plain title</button>` +
        `</div>` +
        `<label class="lbs-fwash"><input type="checkbox" class="lbs-f-wash" data-slug="${esc(slug)}"${mine.wash && mine.wash[slug] ? " checked" : ""}> Logo colour wash <input type="color" class="lbs-f-washc" data-slug="${esc(slug)}" value="${esc((mine.wash && mine.wash[slug]) || "#ffffff")}"${mine.wash && mine.wash[slug] ? "" : " disabled"}></label>` +
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
      `<p class="lbs-fwhere">${path ? `On the shelf in <b>${path.map(esc).join(" › ")}</b>` : "Not in the store yet"}</p>` +
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
      (DEV_TOOLS ? `<h6>Developer</h6><div class="lbs-menu-btns"><button type="button" data-act="logo-build">${logoJob.running ? `Logos ${fmt(logoJob.done)} / ${fmt(logoJob.total)}` : "Logo builder…"}</button></div>` : "");
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

  // Fly to a film on the wall and make it blink.
  function jumpTo(slug, name) {
    closeFilm();
    $(".lbs-card", root) && ($(".lbs-card", root).hidden = true);
    if (desk.mode !== "store") { desk.mode = "store"; renderDesk(); }
    if (wall.level !== "wall") { wall.level = "wall"; showStage(); }
    requestAnimationFrame(() => {
      const L = wall.lay, i = L && L.idx.get(slug);
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
  const libUI = { open: !!mine.libOpen, path: [STOCKED], sel: null, focus: null, adding: null };
  function kidsOf(id) {
    if (!id) return { folders: [...lib.genres.keys()], films: [] };
    const p = partsOf(id);
    if (p.niche) return { folders: [], films: lib.inSub.get(id) || [] };
    if (p.sub) return { folders: (lib.subs.get(id).niches || []).slice(), films: lib.inSub.get(id) || [] };
    if (p.cat) return { folders: lib.cats.get(id).subs.slice(), films: [] };
    if (p.genre) return { folders: lib.genres.get(id).cats.slice(), films: [] };
    return { folders: [], films: [] };
  }
  const childLevel = (id) => { if (!id) return null; const p = partsOf(id); return p.niche ? null : p.sub ? "niche" : p.cat ? "sub" : p.genre ? "cat" : null; };
  const LEVEL_WORD = { cat: "category", sub: "subcat", niche: "niche" };
  let libIo = null;

  function setLibrary(open) {
    libUI.open = open;
    mine.libOpen = open;
    saveMine();
    renderLibrary();
  }
  // Open the Library on a film: its folder open, the film highlighted.
  function openLibraryAt(slug, name) {
    const p = partsOf(lib.place.get(slug));
    libUI.path = [p.genre, p.cat, p.sub, p.niche].filter(Boolean);
    if (!libUI.path.length) libUI.path = [STOCKED];
    libUI.sel = [slug, name || lib.names.get(slug) || slug];
    libUI.focus = { film: libUI.sel };
    setLibrary(true);
    requestAnimationFrame(() => root.querySelector(`.lbs-library [data-film="${CSS.escape(slug)}"]`)?.scrollIntoView({ block: "center" }));
  }
  function renderLibrary() {
    const box = root && $(".lbs-library", root);
    if (!box || !lib) return;
    root.classList.toggle("lbs-lib-open", libUI.open);
    $(".lbs-lib-btn", root)?.classList.toggle("-on", libUI.open);
    box.hidden = !libUI.open;
    if (!libUI.open) return;
    libUI.path = libUI.path.filter((id) => lib.genres.has(id) || lib.cats.has(id) || lib.subs.has(id));
    const path = libUI.path;
    const right = path.length ? path[path.length - 1] : null;
    const left = path.length >= 2 ? path[path.length - 2] : null;
    const held = new Set((mine.held || []).map(([x]) => x));
    const sel = libUI.sel;
    const selAt = sel ? lib.place.get(sel[0]) : null;
    const selPath = selAt ? (() => { const p = partsOf(selAt); return [p.genre, p.cat, p.sub, p.niche].filter(Boolean); })() : [];
    const folderRow = (id, side) =>
      `<li class="lbs-lib-row lbs-folder${path.includes(id) ? " -on" : ""}" data-act="lib-open" data-side="${side}" data-id="${esc(id)}" data-drop="${esc(id)}">` +
      `${ICON_FOLDER}<span>${esc(nameOf(id))}</span>` +
      (selPath.includes(id) ? `<em>here</em>` : "") +
      `<small>${fmt(lib.count.get(id) || 0)}</small><b>›</b></li>`;
    const filmRow = ([slug, name]) =>
      `<li class="lbs-lib-row lbs-lib-film${sel && sel[0] === slug ? " -sel" : ""}" data-act="lib-film" data-film="${esc(slug)}" data-slug="${esc(slug)}" data-name="${esc(name)}" title="Drag onto a folder, the wall or your inventory">` +
      `<img data-lp="${esc(slug)}" src="${posterCache.has(slug) ? esc(posterCache.get(slug)[0]) : EMPTY}" alt="" draggable="false"><span>${esc(titleOf(name))}</span><small>${yearOf(name) || ""}</small>` +
      (held.has(slug) ? `<em class="-inv">In inventory</em>` : "") + `</li>`;
    const column = (id, side) => {
      const k = kidsOf(id);
      const lvl = side === "right" ? childLevel(id) : null;
      const adding = lvl && libUI.adding === id;
      return (
        `<div class="lbs-lib-col -${side}"><h5>${id ? esc(nameOf(id)) : "Genres"}${id ? `<small>${fmt(lib.count.get(id) || 0)} films</small>` : ""}</h5><ul>` +
        k.folders.map((f) => folderRow(f, side)).join("") +
        (lvl ? (adding ? `<li class="lbs-lib-new"><input type="text" class="lbs-lib-new-name" data-level="${lvl}" maxlength="40" placeholder="Name the new ${LEVEL_WORD[lvl]}"></li>` : `<li class="lbs-lib-add"><button type="button" data-act="lib-new">+ New ${LEVEL_WORD[lvl]}</button></li>`) : "") +
        (k.films.length ? (k.folders.length || lvl ? `<li class="lbs-lib-sep">${fmt(k.films.length)} film${k.films.length === 1 ? "" : "s"}</li>` : "") + k.films.map(filmRow).join("") : "") +
        (!k.folders.length && !k.films.length && !lvl ? `<li class="lbs-lib-empty">Empty</li>` : "") +
        `</ul></div>`
      );
    };
    const target = right && !lib.genres.has(right) ? landingSub(right) : null;
    // Jump to: the last thing you clicked (a film, or a folder), else the open folder.
    const focus = libUI.focus && (libUI.focus.film ? (lib.place.has(libUI.focus.film[0]) ? libUI.focus : null) : path.includes(libUI.focus.folder) ? libUI.focus : null) || (right ? { folder: right } : null);
    const jumpOk = focus && (focus.film || inRoom(partsOf(focus.folder).genre));
    const jumpLabel = focus ? (focus.film ? titleOf(focus.film[1]) : nameOf(focus.folder)) : "";
    const jumpBtn = `<button type="button" data-act="lib-jump"${jumpOk ? "" : " disabled"} title="${jumpOk ? `Fly to ${esc(jumpLabel)} on the wall` : ""}">Jump to section</button>`;
    const canMove = sel && target && target !== selAt;
    box.innerHTML =
      `<div class="lbs-lib-head">` +
      `<button type="button" class="lbs-lib-up" data-act="lib-up" aria-label="Up a level" title="Up a level"${path.length ? "" : " disabled"}>${ICON_LEFT}</button>` +
      `<div class="lbs-lib-crumbs"><button type="button" data-act="lib-root">Library</button>${path.map((id, i) => `<i>›</i><button type="button" data-act="lib-to" data-i="${i}" data-drop="${esc(id)}" class="lbs-crumb">${esc(nameOf(id))}</button>`).join("")}</div>` +
      `<button type="button" class="lbs-lib-x" data-act="lib" aria-label="Close the Library">${ICON_CLOSE}</button></div>` +
      `<div class="lbs-lib-cols">${column(left, "left")}${path.length ? column(right, "right") : `<div class="lbs-lib-col -right"><p class="lbs-lib-hint">Pick a genre</p></div>`}</div>` +
      `<div class="lbs-lib-foot">` +
      (sel
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
        posterFor(im.dataset.lp).then(([u]) => (im.src = u)).catch(() => {});
      }
    }, { root: null, rootMargin: "200px" }) : null;
    box.querySelectorAll("img[data-lp]").forEach((im) => libIo && libIo.observe(im));
    const inp = $(".lbs-lib-new-name", box);
    if (inp) inp.focus();
  }
  // Old name, same tool now: "Sort" opens the Library on the film.
  const openSort = (slug, name) => openLibraryAt(slug, name);
  const renderSortPanel = () => renderLibrary();

  /* Franchises: films that belong together on the shelf, in a set order.
   * They all sit where the first one would, as one block, with a sticker
   * on the back wall behind them. */
  const franchises = () => mine.franchises || (mine.franchises = {});
  const franchiseOf = (slug) => { for (const [id, f] of Object.entries(franchises())) if (f.films.some(([s]) => s === slug)) return { id, ...f }; return null; };
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
        return `<li draggable="true" data-i="${i}"${i && sec && sec !== home ? ' class="-other"' : ""}><img data-poster="${esc(s)}" alt="" draggable="false"><b>${i + 1}</b>${yearOf(n) ? `<i>${yearOf(n)}</i>` : ""}<span>${esc(titleOf(n))}<small>${sec ? esc(nameOf(sec)) : ""}${i && sec && sec !== home ? ` · moves to ${esc(nameOf(home))}` : ""}</small></span><button type="button" data-act="fr-drop" data-i="${i}" aria-label="Remove">${ICON_CLOSE}</button></li>`;
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
      `<label class="lbs-fcolor">Colour <input type="color" class="lbs-fr-color" value="#${esc(own.replace("#", ""))}"></label>` +
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
    const item = (slug, name, inStore) => {
      const path = inStore ? whereIs(slug) : null;
      return `<li data-act="find-pick" data-slug="${esc(slug)}" data-name="${esc(name)}"><img data-poster="${esc(slug)}" alt=""><div><b>${esc(titleOf(name))}</b> <span>${yearOf(name) || ""}</span><small>${path ? esc(path.slice(1).join(" › ")) : "Not in the store"}</small></div>${path ? "" : `<button type="button" class="lbs-find-req" data-act="req-add" data-slug="${esc(slug)}" data-name="${esc(name)}">Request addition</button>`}</li>`;
    };
    const top = local.slice(0, 8);
    list.innerHTML = (top.length ? top.map(([, s, n]) => item(s, n, true)).join("") : `<li class="-none">Nothing in the store matches yet.</li>`) + `<li class="-more">Searching all of Letterboxd…</li>`;
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
    if (b) { b.setAttribute("aria-pressed", on); b.textContent = on ? "Done editing" : "Edit store"; }
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
      `<b>Editing the store</b><span>${pending ? "Unpublished changes in this browser" : "No changes yet"}</span>` +
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
          `<h4>Blocks to place <select class="lbs-tray-filter" aria-label="Show blocks from"><option value="">All categories</option>${[...new Set(list.map((pc) => pc.cat))].map((c) => `<option value="${esc(c)}"${edit.filter === c ? " selected" : ""}>${esc(nameOf(c))}</option>`).join("")}</select></h4>` +
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
    houseEdit(rest > 2 ? `${nameOf(cid)}: filled that space; the rest is in the inventory.` : `Placed ${nameOf(cid)}.`, (H) => { H.wall = { perRow: wall.plan.perRow, shelves: sh }; });
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
    houseEdit(`Moved all of ${nameOf(t.cid)}.`, (H) => { H.wall = { perRow: wall.plan.perRow, shelves: out }; });
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
    houseEdit(`Poured all of ${nameOf(t.cid)} onto ${t.items.length} shel${t.items.length === 1 ? "f" : "ves"}.`, (H) => { H.wall = { perRow: wall.plan.perRow, shelves: sh }; });
  }

  function unplaceGrab(g) {
    const sh = shelvesNow();
    const [k, slot] = g.ref.split("/");
    sh[k].splice(+slot, 1);
    if (!sh[k].length) delete sh[k];
    houseEdit(`Took ${nameOf(grabCid(g))} down to the inventory.`, (H) => { H.wall = { perRow: wall.plan.perRow, shelves: sh }; });
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
      } else {
        // The box itself, cover facing you, follows the pointer.
        d.ghost = h("div", "lbs-box-ghost", boxHTML(d.slug, d.name, false));
        fillPosters(d.ghost, false);
        if (d.from === "wall") { wall.lifted = d.slug; drawSoon(); }
      }
      document.body.append(d.ghost);
      showTip(null);
    }
    d.ghost.style.left = `${e.clientX + (d.kind === "dvd" ? -40 : 8)}px`;
    d.ghost.style.top = `${e.clientY + (d.kind === "dvd" ? -60 : 8)}px`;
    const c = wall.canvas, r = c.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    wall.dropHint = over ? (d.kind === "piece" ? (d.pour ? pourTarget(d, e.clientX - r.left, e.clientY - r.top) : d.group ? groupTarget(d, e.clientX - r.left, e.clientY - r.top) : dropTarget(d, e.clientX - r.left, e.clientY - r.top)) : dvdTarget(d.slug, e.clientX - r.left, e.clientY - r.top)) : null;
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
        return houseEdit(`Took all of ${nameOf(grabCid(d))} down.`, (H) => { H.wall = { perRow: wall.plan.perRow, shelves: sh }; });
      }
      if (toTray) { if (d.from === "wall") unplaceGrab(d); return drawSoon(); }
      if (hint && hint.pour) { if (hint.ok) return placePour(hint); toast("Not enough room from there on to fit the whole section."); return drawSoon(); }
      if (hint && hint.group) { if (hint.ok) return placeGroup(hint); toast("The whole section doesn't fit there."); return drawSoon(); }
      if (hint && hint.ok) return placeGrab(d, hint);
      if (hint) toast("No room on that shelf.");
      return drawSoon();
    }
    // A DVD
    if (toTray) { if (d.from === "wall" || d.from === "lib") holdFilms([[d.slug, d.name]]); return drawSoon(); }
    const folder = el && el.closest && el.closest(".lbs-folder[data-drop], .lbs-crumb[data-drop]");
    if (folder && folder.dataset.drop) {
      if (d.from === "tray") releaseFilm(d.slug);
      return moveFilms([[d.slug, d.name]], folder.dataset.drop);
    }
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
    houseEdit(`Deleted “${was}”.`, (H) => {
      if (H.cats[id]) delete H.cats[id];
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
  function moveFilms(films, target) {
    const sub = landingSub(target);
    if (!sub || !films.length) return;
    if (edit.on) {
      const label = films.length === 1 ? `‘${titleOf(films[0][1])}’` : `${films.length} films`;
      return houseEdit(`${label} → ${pathOf(sub).join(" › ")}`, (H) => {
        const moving = new Set(films.map(([slug]) => slug));
        H.held = H.held.filter(([x]) => !moving.has(x));
        for (const [slug, name] of films) H.place[slug] = [sub, name];
      });
    }
    const before = films.map(([slug]) => [slug, mine.place[slug]]);
    for (const [slug] of films) shareEdit("place", slug, sub);
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
    const frow = edit.on && e.target.closest && e.target.closest(".lbs-folder[draggable=true]");
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
    const src = e.target.closest && e.target.closest(".lbs-item, .lbs-row");
    if (!src || !src.dataset.slug) return;
    e.preventDefault();
    desk.moving = src.classList.contains("lbs-row") && desk.selected.has(src.dataset.slug) ? [...root.querySelectorAll(".lbs-row.-sel")].map(filmOf) : [filmOf(src)];
    if (!desk.open) setDesk(true);
    else renderDesk();
    const f = $(".lbs-dq", root);
    if (f) f.focus();
  }

  /* ---------------- clicks, typing ---------------- */

  function onClick(e) {
    const pick = $(".lbs-logopick", root);
    if (pick && !pick.hidden && !e.target.closest(".lbs-logopick")) pick.hidden = true;
    const sp = $(".lbs-sortpick", root);
    if (sp && !sp.hidden && !e.target.closest(".lbs-sortpick") && e.target !== wall.canvas) sp.hidden = true;
    // Menus close when you click anywhere else.
    root.querySelectorAll(".lbs-menu:not([hidden])").forEach((m) => {
      if (!e.target.closest(".lbs-menu, [data-act=settings], [data-act=find-type], [data-act=lb-more]")) m.hidden = true;
    });
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
      if (act === "lib-unsel") { libUI.sel = null; return renderLibrary(); }
      if (act === "lib-new") { libUI.adding = libUI.path[libUI.path.length - 1]; return renderLibrary(); }
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
      if (act === "fr-logo") { ui.fr.logo = btn.dataset.path; return renderFranchise(); }
      if (act === "fr-delete") { delete franchises()[ui.fr.id]; saveMine(); shareEdit("franchise", ui.fr.id, null); ui.fr = null; renderFranchise(); refresh(); return toast("Franchise undone."); }
      if (act === "req-remove-film") return requestRemoval("film", ui.sortFilm[0], titleOf(ui.sortFilm[1]));
      if (act === "req-remove-this") return requestRemoval("film", fs, titleOf(fn));
      if (act === "req-remove") { $(".lbs-sortpick", root).hidden = true; return requestRemoval("section", id, nameOf(id)); }
      if (act === "req-add") { e.stopPropagation(); return requestAddition(fs, fn, btn); }
      if (act === "ask-no" || act === "ask-yes") { const box = $(".lbs-ask", root); box.hidden = true; const y = box._yes, n = box._no; box._yes = box._no = null; if (act === "ask-yes" && y) y(); else if (act === "ask-no" && n) n(); return; }
    }
    if (act === "sort") return setSort(id, btn.dataset.v);
    if (act === "grab") { edit.grab = btn.dataset.v; return renderTray(); }
    if (act === "w-clear") return houseEdit("Everything is back in the inventory.", (H) => { H.wall = { perRow: wall.plan.perRow, shelves: {} }; });
    if (act === "w-auto") return houseEdit("Auto-arranged the wall.", (H) => { H.wall = autoArrange(sectionStock(), wall.plan.perRow); });
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
      try { localStorage.removeItem(HOUSE_KEY); } catch {}
      refresh();
      return toast("Discarded your unpublished changes.");
    }

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
      if (desk.mode === "store" && inRoom(partsOf(id).genre) && wall.level === "aisles" && !lib.genres.has(id)) wall.level = "wall";
      openFolder(id);
      if (desk.mode === "store") requestAnimationFrame(() => flyToFolder(id));
      return;
    }
    if (act === "aisles") { wall.level = "aisles"; return showStage(); }
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
