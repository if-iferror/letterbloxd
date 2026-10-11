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
  const STOCKED = "horror";
  // For now the Store opens straight into the Sorting Desk; the walkable
  // aisles are switched off (set false to bring them back).
  const DESK_ONLY = true;

  // Your own moves and folders ("Mine"). Kept in this browser only.
  const MINE_KEY = `${NS}:store:mine:v1`;
  let mine = readJSON(MINE_KEY, null) || {};
  mine = { place: {}, cats: {}, subs: {}, recent: [], view: "community", sort: {}, held: [], ...mine };
  const saveMine = () => writeJSON(MINE_KEY, mine);

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
    const addSub = (s) => { subs.set(s.id, s); cats.get(s.cat).subs.push(s.id); };

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
    for (const [id, c] of Object.entries(mine.cats)) if (genres.has(c.genre) && !cats.has(id)) addCat({ id, genre: c.genre, name: c.name, own: true, order: 1 });
    for (const c of cats.values()) addSub({ id: `${c.id}/general`, cat: c.id, name: "General", order: 99 });
    for (const [id, s] of Object.entries(H.subs)) if (cats.has(s.cat) && !subs.has(id)) addSub({ id, cat: s.cat, name: s.name, house: true, order: 50 });
    for (const [id, s] of Object.entries(mine.subs)) if (cats.has(s.cat) && !subs.has(id)) addSub({ id, cat: s.cat, name: s.name, own: true, order: 50 });
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
        const c = cats.get(sc.cat);
        if (c) c.subs = c.subs.filter((x) => x !== id);
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
    if (mine.view === "mine" && !edit.on) {
      for (const [slug, [sub, name]] of Object.entries(mine.place)) {
        if (!subs.has(sub)) continue;
        place.set(slug, sub);
        if (!names.has(slug)) names.set(slug, name);
      }
    }
    // A film whose folder was deleted drops one level: to its category's
    // General, or to the genre's Everything Else.
    const home = (sub) => {
      if (subs.has(sub)) return sub;
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
      count.set(id, list.length);
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
    if (lib.subs.has(id)) { const s = lib.subs.get(id); return { genre: lib.cats.get(s.cat).genre, cat: s.cat, sub: id }; }
    return {};
  }
  const nameOf = (id) => (lib.genres.get(id) || lib.cats.get(id) || lib.subs.get(id) || {}).name || "";
  function pathOf(id) {
    const p = partsOf(id);
    return [p.genre, p.cat, p.sub].filter(Boolean).map(nameOf);
  }
  // A drop on a genre files under its Everything Else; on a category, under General.
  function landingSub(id) {
    const p = partsOf(id);
    if (p.sub) return p.sub;
    if (p.cat) return `${p.cat}/general`;
    if (p.genre) return `${p.genre}/rest/general`;
    return null;
  }
  // Films inside any folder, A-Z.
  function filmsIn(id) {
    const p = partsOf(id);
    if (p.sub) return lib.inSub.get(p.sub) || [];
    const subsOf = p.cat ? lib.cats.get(p.cat).subs : (lib.genres.get(p.genre)?.cats || []).flatMap((c) => lib.cats.get(c).subs);
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
        if (e.button !== 0) return;
        const pc = edit.on && e.target.closest(".lbs-tray .lbs-piece");
        if (pc) { e.preventDefault(); return grabDown({ kind: "piece", cid: pc.dataset.cid, from: "tray" }, e); }
        const dv = e.target.closest(".lbs-tray .lbs-dvd");
        if (dv) { e.preventDefault(); grabDown({ kind: "dvd", slug: dv.dataset.slug, name: dv.dataset.name, from: "tray" }, e); }
      });
      root.addEventListener("dblclick", (e) => {
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
    root.innerHTML =
      `<header class="lbs-top">` +
      `<div class="lbs-brand">LetterBloxd <span>video store</span></div>` +
      (DESK_ONLY
        ? `<div class="lbs-wing-sign"><b>Sorting desk</b></div>`
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
      `<div class="lbs-zoom"><button type="button" data-act="zoom-out" aria-label="Zoom out">−</button><button type="button" data-act="fit">Fit</button><button type="button" data-act="zoom-in" aria-label="Zoom in">+</button></div></div>` +
      `<div class="lbs-aisles"></div><canvas class="lbs-canvas" draggable="false" aria-label="Horror wall. Scroll to move, pinch or Ctrl-scroll to zoom, drag a spine to a folder."></canvas>` +
      `<div class="lbs-tip" hidden></div><div class="lbs-sortpick" hidden></div>` +
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
      `<div class="lbs-deskbar">` +
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
        else H.subs[hid] = { cat: parent, name };
      });
      desk.folder = hid;
      if (level === "cat") edit.sel = hid;
      return renderDesk();
    }
    if (level === "cat") mine.cats[id] = { genre: parent, name };
    else mine.subs[id] = { cat: parent, name };
    saveMine();
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
  const WU = { bayW: 1000, gap: 36, pad: 22, sign: 80, shelfH: 200, shelves: 6, lip: 14 };
  const ROW_H = WU.sign + WU.shelves * WU.shelfH + 150; // a row of bays plus the floor between rows
  const FAR = 0.09, NEAR = 0.45, TEXT = 0.8, ZMIN = 0.02, ZMAX = 2.6;
  const DEPTH_X = 4, DEPTH_Y = 5; // the sliver of top and side we see
  const BAND = 22; // colour band at the top of a spine; the year sits in it
  const yearInk = (own) => (own && lum(rgbOf(own.slice(6))) > 0.55 ? "rgba(10,12,14,0.8)" : "rgba(255,255,255,0.85)");
  const reduceMotion = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const wall = { level: "aisles", lay: null, cam: { x: 0, y: 0, z: 0.05 }, hover: null, pin: null, lite: false, slow: 0, imgs: new Map(), logos: new Map(), frame: 0 };
  const spineW = (y) => (y && y < 1990 ? 20 : y && y < 2008 ? 12 : 10);
  const spineH = (y) => (y && y < 1990 ? 168 : y && y < 2008 ? 158 : 148);
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
  const BOOKEND = 10, JUSTIFY = 0.85, MAX_LEAN = 0.42, LEAN_EACH = 48;
  const footprint = (list) => list.reduce((n, f) => n + f.w + 1, 0);
  const leanReach = (group, a) => (group.length ? group[0].h * Math.sin(a) + group.reduce((n, f) => n + f.w * (1 / Math.cos(a) - 1), 0) : 0);
  function solveLean(group, gap) {
    let lo = 0, hi = MAX_LEAN;
    for (let i = 0; i < 24; i++) { const mid = (lo + hi) / 2; if (leanReach(group, mid) < gap) lo = mid; else hi = mid; }
    return lo;
  }
  // One colour per section, spread round the wheel so neighbours never match.
  const secHue = (i) => { const n = Math.max(1, lib.genres.get(STOCKED).cats.length), step = n % 5 ? 5 : 3; return (((i * step) % n) * 360) / n + 10; };

  // Every section's films (shelf order) and its pieces' lengths.
  // How a section is ordered: your own choice, else the house's, else A-Z.
  const sortOf = (cid) => (!edit.on && mine.sort[cid]) || house().sort[cid] || "title";
  // A section's films in shelf order (held films left out).
  function sectionOrder(cid) {
    const H = house();
    const held = new Set(H.held.map(([slug]) => slug));
    const list = [];
    for (const sid of lib.cats.get(cid).subs) for (const [slug, name] of lib.inSub.get(sid) || []) if (!held.has(slug)) list.push({ slug, name, sub: sid });
    const az = (a, b) => byTitle([a.slug, a.name], [b.slug, b.name]);
    const mode = sortOf(cid);
    if (mode === "year") return list.sort((a, b) => (yearOf(a.name) || 9999) - (yearOf(b.name) || 9999) || az(a, b));
    list.sort(az);
    const index = mode === "index" && H.index[cid];
    if (!index) return list;
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
    return out;
  }

  // Every stocked section: its films in shelf order and how much shelf they need.
  function sectionStock() {
    const out = new Map();
    lib.genres.get(STOCKED).cats.forEach((cid, n) => {
      const items = sectionOrder(cid).map(({ slug, name, sub }) => {
        const y = yearOf(name);
        return { slug, name, year: y, w: spineW(y), h: spineH(y), sub, rank: lib.rank.get(slug) ?? 1e9 };
      });
      out.set(cid, { id: cid, n, items, total: footprint(items) });
    });
    return out;
  }
  const MIN_PIECE = 30; // the smallest space worth putting a section into

  // The default arrangement: sections one after another, each starting
  // right where the last one ended, down each bay and then across.
  function autoArrange(stock_, perRow) {
    const shelves = {};
    let b = 0, s = 0, used = 0;
    const next = () => { used = 0; if (++s >= WU.shelves) { s = 0; b++; } };
    for (const P of stock_.values()) {
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
        const d = Math.abs(Math.log((t * (WU.bayW + WU.gap)) / (Math.ceil(bays / t) * ROW_H) / aspect));
        if (d < best) { best = d; perRow = t; }
      }
    }
    // No plan yet: viewers get the automatic layout; a moderator starts with
    // an empty wall and every section in the workspace.
    const valid = (x) => x && typeof x === "object" && sections.has(x.c) && x.u > 0;
    const saved = H.wall && H.wall.shelves && Object.values(H.wall.shelves).flat().every(valid) ? H.wall : null;
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
      if (k < P.items.length) leftovers.set(P.id, P.items.slice(k));
    }
    const bucket = [];
    if (edit.on) {
      for (const [cid, list] of leftovers) bucket.push({ sec: cid, n: sections.get(cid).n, size: footprint(list), count: list.length, whole: list.length === sections.get(cid).items.length });
    } else if (leftovers.size) {
      const rest = autoArrange(new Map([...leftovers].map(([cid, items]) => [cid, { id: cid, items }])), perRow).shelves;
      const start = 1 + Math.max(-1, ...[...where.values()].map((w) => w.bay));
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
    const parseRef = (ref) => [refCid.get(ref)];
    wall.refs = { refCid, refU };
    wall.leftovers = leftovers;

    const films = [], chunks = new Map(), secs = [], secIndex = new Map(), runs = [], bookends = [], idx = new Map();
    for (const P of sections.values()) {
      secIndex.set(P.id, secs.length);
      secs.push({ id: P.id, name: lib.cats.get(P.id).name, hue: secHue(P.n), films: [], subs: [] });
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
            const end = Math.round(((g + 1) * list.length) / groups);
            const m = Math.min(6, Math.max(1, end - Math.round((g * list.length) / groups)));
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
        runs.push({ ref, sec: si, bay, shelf, x0: start, x1: Math.max(start + 8, x), by: o.y });
        if (ri < refs.length - 1) {
          const next = secIndex.get(parseRef(refs[ri + 1])[0]);
          bookends.push({ x: x + 1, y, bay, change: next !== si, hue: secs[next].hue });
          x += BOOKEND * squeeze;
        }
      });
    }
    for (const sec of secs) sec.highlights = [...sec.films].sort((a, b) => films[a].rank - films[b].rank).slice(0, 3);
    // Edit mode keeps an empty bay at the end to drop pieces into.
    const bays = edit.on ? Math.max(maxBay + 2, Math.ceil(totalShelves / WU.shelves) + 1) : maxBay + 1;
    const width = Math.min(bays, perRow) * (WU.bayW + WU.gap);
    const height = Math.ceil(bays / perRow) * ROW_H;
    wall.lay = { films, chunks, secs, runs, bookends, faces: [], idx, bucket, held: H.held, width, height, bays, k: perRow, origin };
    recolourSections();
    renderTray();
  }

  // Screen <-> wall coordinates.
  const toWall = (sx, sy) => ({ x: wall.cam.x + sx / wall.cam.z, y: wall.cam.y + sy / wall.cam.z });

  function fit() {
    const c = wall.canvas;
    if (!c || !wall.lay) return;
    const z = Math.min(c.clientWidth / wall.lay.width, c.clientHeight / wall.lay.height) * 0.96;
    wall.cam.z = Math.max(ZMIN, z);
    wall.cam.x = -(c.clientWidth / wall.cam.z - wall.lay.width) / 2;
    wall.cam.y = -(c.clientHeight / wall.cam.z - wall.lay.height) / 2;
    drawSoon();
  }

  function clampCam() {
    const c = wall.canvas, L = wall.lay, cam = wall.cam;
    const vw = c.clientWidth / cam.z, vh = c.clientHeight / cam.z;
    const mx = Math.max(200, vw * 0.25), my = 120;
    cam.x = vw > L.width ? -(vw - L.width) / 2 : Math.min(Math.max(cam.x, -mx), L.width - vw + mx);
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
    if (p.genre !== STOCKED || !p.cat) return fit();
    const L = wall.lay;
    const i = p.sub ? L.films.findIndex((f) => f.sub === p.sub) : L.secs.find((s) => s.id === p.cat)?.films[0];
    if (i == null || i < 0) return;
    const f = L.films[i];
    flyTo(f.x + 300, f.y - 120, p.sub ? 0.9 : 0.25);
  }

  /* Colour catalogue: each film's main + accent colour, read from its poster.
   * Built a few films at a time while the store is open and kept in this
   * browser ("RRGGBBrrggbb" per film). Later this can be seeded from a shared
   * file so nobody has to build it themselves. */
  const COLOR_KEY = `${NS}:store:colors:v1`;
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
  function logoPath(slug) {
    const e = logoEntry(slug);
    if (!e || e.length < 2) return null;
    const pick = logoPicks[slug];
    if (pick === -1) return null;
    return e[1 + (pick > 0 && pick < e.length - 1 ? pick : 0)];
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
    if (n === 0) delete logoPicks[slug];
    else logoPicks[slug] = n;
    writeJSON(LOGO_PICK_KEY, logoPicks);
    const e = logoEntry(slug);
    const list = readJSON(SUGGEST_KEY, []).filter((s) => !(s.type === "logo" && s.slug === slug));
    list.push({ type: "logo", slug, tmdb: e && e[0], path: n === -1 ? null : e && e[1 + n], at: Date.now() });
    writeJSON(SUGGEST_KEY, list.slice(-500));
    $(".lbs-logopick", root).hidden = true;
    drawSoon();
    toast(n === 0 ? "Back to the first logo." : "Saved. It'll count as your vote once community voting opens.");
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

    // Bays: back panel, shelf boards, uprights.
    for (const b of inView) {
      const { x: bx, y: by } = L.origin(b);
      ctx.fillStyle = "#171c21";
      ctx.fillRect(bx, by + WU.sign - 10, WU.bayW, WU.shelves * WU.shelfH + 10);
      ctx.fillStyle = "#2f3842";
      for (let s = 1; s <= WU.shelves; s++) ctx.fillRect(bx, by + WU.sign + s * WU.shelfH - WU.lip, WU.bayW, WU.lip);
      ctx.fillStyle = "#3a4552";
      ctx.fillRect(bx - 6, by + WU.sign - 10, 10, WU.shelves * WU.shelfH + 20);
      ctx.fillRect(bx + WU.bayW - 4, by + WU.sign - 10, 10, WU.shelves * WU.shelfH + 20);
    }

    const secColor = (sec, f) => {
      if (!f) return sec.avg || `hsl(${sec.hue} 38% 34%)`;
      const own = colors[f.slug];
      if (own) return `#${own.slice(0, 6)}`;
      const hv = f ? hash(f.slug) : 0;
      const hue = sec.hue + ((hv % 37) - 18);
      if (!f) return `hsl(${sec.hue} 38% 34%)`;
      const vhs = f.year && f.year < 1990;
      return vhs ? `hsl(${hue} 10% ${10 + (hv % 9)}%)` : `hsl(${hue} ${32 + (hv % 22)}% ${f.year >= 2008 ? 36 + (hv % 14) : 24 + (hv % 14)}%)`;
    };

    {
      // Every spine in view (detail only up close).
      const near = z >= NEAR, text = z >= TEXT && !wall.lite;
      for (const b of inView) {
        for (let s = 0; s < WU.shelves; s++) {
          const list = L.chunks.get(`${b}:${s}`);
          if (!list) continue;
          for (const i of list) {
            const f = L.films[i];
            if (f.x + f.w < x0 || f.x - f.h > x1) continue;
            if (f.lean) { ctx.save(); ctx.translate(f.x, f.y); ctx.rotate(-f.lean); ctx.translate(-f.x, -f.y); }
            try {
            const top = f.y - f.h;
            const body = secColor(L.secs[f.sec], f);
            // A whisper of depth: we stand a little above and to the right,
            // so each box shows a sliver of its top and of its right-hand
            // face (the cover edge). Neighbours drawn after cover most of it.
            if (near && !wall.lite) {
              ctx.fillStyle = body;
              ctx.beginPath();
              ctx.moveTo(f.x + f.w, top); ctx.lineTo(f.x + f.w + DEPTH_X, top - DEPTH_Y); ctx.lineTo(f.x + f.w + DEPTH_X, f.y - DEPTH_Y); ctx.lineTo(f.x + f.w, f.y);
              ctx.fill();
              ctx.fillStyle = "rgba(0,0,0,0.38)";
              ctx.fill();
              ctx.fillStyle = body;
              ctx.beginPath();
              ctx.moveTo(f.x, top); ctx.lineTo(f.x + DEPTH_X, top - DEPTH_Y); ctx.lineTo(f.x + f.w + DEPTH_X, top - DEPTH_Y); ctx.lineTo(f.x + f.w, top);
              ctx.fill();
              ctx.fillStyle = "rgba(255,255,255,0.28)";
              ctx.fill();
            }
            ctx.fillStyle = body;
            ctx.fillRect(f.x, top, f.w, f.h);
            if (!near || wall.lite) continue;
            const own = colors[f.slug];
            // the poster's accent colour as a band across the top, with the year in it
            if (own) { ctx.fillStyle = `#${own.slice(6)}`; ctx.fillRect(f.x, top, f.w, BAND); }
            // a little plastic: lit edge, VHS label band
            ctx.fillStyle = "rgba(255,255,255,0.10)";
            ctx.fillRect(f.x, top, Math.max(px, f.w * 0.18), f.h);
            if (f.year && f.year < 1990) { ctx.fillStyle = "rgba(235,232,222,0.85)"; ctx.fillRect(f.x + 2, top + 22, f.w - 4, f.h - 50); }
            // Title art from TMDB, turned on its side, when there is one.
            const vhs = f.year && f.year < 1990;
            const lg = z >= LOGO_Z ? logoImg(f.slug, z >= 1.6 ? "w300" : "w185") || (z >= 1.6 ? logoImg(f.slug, "w185") : null) : null;
            if (lg) {
              const iw = lg.img.naturalWidth || 300, ih = lg.img.naturalHeight || 100;
              const a = iw / ih;
              // Along the spine (local x, from 8 units above the shelf upward):
              // the logo sits in [s0, s1], the year near the top as before.
              const s0 = vhs ? 34 : 10, s1 = f.h - 34, room = s1 - s0, thick = f.w - (vhs ? 6 : 3);
              let len = Math.min(room, thick * a), th = len / a;
              if (th > thick) { th = thick; len = th * a; }
              const bgL = vhs ? 0.8 : own ? relLum(rgbOf(own)) : 0.03;
              const src = contrast(lg.lum, bgL) >= 2 ? lg.img : logoInk(lg, bgL > 0.35 ? "#15181b" : "#f4f1ea");
              ctx.save();
              ctx.translate(f.x + f.w / 2, f.y - 8);
              ctx.rotate(-Math.PI / 2);
              ctx.drawImage(src, s0 + (room - len) / 2, -th / 2, len, th);
              if (text) {
                ctx.font = `600 ${Math.min(f.w * 0.62, 10) * 0.8}px Arial, sans-serif`;
                ctx.textBaseline = "middle";
                ctx.fillStyle = yearInk(own);
                ctx.fillText(String(f.year || ""), f.h - BAND / 2, 0);
              }
              ctx.restore();
            } else if (text) {
              ctx.save();
              ctx.translate(f.x + f.w / 2, f.y - 8);
              ctx.rotate(-Math.PI / 2);
              const fs = Math.min(f.w * 0.62, 10);
              ctx.font = `700 ${fs}px "Helvetica Neue", Arial, sans-serif`;
              const light = own && lum(rgbOf(own)) > 0.58;
              ctx.fillStyle = f.year && f.year < 1990 ? "#1a1a1a" : light ? "rgba(10,12,14,0.9)" : "rgba(255,255,255,0.92)";
              ctx.textBaseline = "middle";
              let t = titleOf(f.name).toUpperCase();
              const vhs = f.year && f.year < 1990;
              const start = vhs ? 34 : 8; // VHS: write on the white label
              const room = f.h - start - 30;
              if (ctx.measureText(t).width > room) { while (t.length > 3 && ctx.measureText(t + "…").width > room) t = t.slice(0, -1); t += "…"; }
              ctx.fillText(t, start, 0);
              ctx.font = `600 ${fs * 0.8}px Arial, sans-serif`;
              ctx.fillStyle = yearInk(own);
              ctx.fillText(String(f.year || ""), f.h - BAND / 2, 0);
              ctx.restore();
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

    // Bookends between pieces; where the section changes, tape on the shelf edge too.
    if (z >= FAR) {
      for (const be of L.bookends) {
        if (!seen.has(be.bay) || be.x < x0 - 20 || be.x > x1 + 20) continue;
        ctx.fillStyle = "#59636e";
        ctx.fillRect(be.x, be.y - 110, BOOKEND - 3, 110);
        ctx.fillStyle = "#8a96a3";
        ctx.fillRect(be.x, be.y - 110, 2, 110);
        if (be.change) {
          ctx.fillStyle = `hsl(${be.hue} 70% 55%)`;
          ctx.fillRect(be.x - 4, be.y, BOOKEND + 5, WU.lip);
        }
      }
    }

    // From afar: each piece is a block in its section's colour, named.
    // The blocks fade as you walk up, until only the spines are left.
    const veil = z < FAR ? 0.82 : z < NEAR ? 0.82 * (1 - (z - FAR) / (NEAR - FAR)) : 0;
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
        // The name, as big as fits.
        const label = sec.name.toUpperCase();
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

    // Up close: laminated signs hung from the shelf edge, always the same
    // size on screen, repeated along each section so one is always in view.
    wall.signs = [];
    if (veil < 0.3) {
      const fsz = 13 * px, th = 22 * px, gapPx = 340 * px;
      ctx.font = `800 ${fsz}px Arial, sans-serif`;
      ctx.textBaseline = "middle";
      for (const r of L.runs) {
        if (!seen.has(r.bay) || r.x1 < x0 || r.x0 > x1) continue;
        const sec = L.secs[r.sec];
        const mode = sortOf(sec.id);
        const label = sec.name.toUpperCase() + (mode === "year" ? " · BY YEAR" : mode === "index" ? " · INDEX" : "") + " ▾";
        const tw = ctx.measureText(label).width + 16 * px;
        if (tw > r.x1 - r.x0 + 4) continue;
        const ty = r.by + WU.sign + (r.shelf + 1) * WU.shelfH - WU.lip + 3 * px; // hangs from the shelf's front edge
        const step = tw + gapPx;
        const spots = [];
        for (let k = Math.max(0, Math.floor((x0 - r.x0) / step) - 1); ; k++) {
          const sx = r.x0 + 4 * px + k * step;
          if (sx > x1 || sx + tw > r.x1) break;
          if (sx + tw >= x0) spots.push(sx);
        }
        if (!spots.length) spots.push(Math.min(Math.max(r.x0 + 4 * px, x0 + 12 * px), r.x1 - tw - 2 * px));
        for (const sx of spots) {
          ctx.fillStyle = "rgba(0,0,0,0.4)";
          ctx.fillRect(sx + 2 * px, ty + 2 * px, tw, th);
          ctx.fillStyle = "#f4f1e8";
          ctx.fillRect(sx, ty, tw, th);
          ctx.fillStyle = `hsl(${sec.hue} 60% 45%)`;
          ctx.fillRect(sx, ty, 5 * px, th);
          ctx.fillStyle = "rgba(255,255,255,0.35)"; // laminate shine
          ctx.fillRect(sx, ty, tw, th * 0.35);
          ctx.fillStyle = "rgba(0,0,0,0.25)"; // tape
          ctx.fillRect(sx + tw / 2 - 14 * px, ty - 3 * px, 28 * px, 6 * px);
          ctx.fillStyle = "#14181c";
          ctx.fillText(label, sx + 10 * px, ty + th / 2 + px);
          wall.signs.push({ x: sx, y: ty, w: tw, h: th, sec: r.sec });
        }
      }
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
    for (const i of list) {
      const f = L.films[i];
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
    const z = wall.cam.z;
    const lod = z < FAR ? "far" : z < NEAR ? "middle" : "near";
    el.innerHTML =
      `<button type="button" class="lbs-crumb" data-act="aisles">Store</button>` +
      (wall.level === "wall" ? `<i>›</i><button type="button" class="lbs-crumb" data-act="fit">Horror</button>` : "") +
      (sec ? `<i>›</i><button type="button" class="lbs-crumb" data-act="open" data-id="${esc(sec.id)}" data-drop="${esc(sec.id)}">${esc(sec.name)}</button>` : "") +
      (wall.level === "wall" ? `<span class="lbs-lod">${lod}</span>` : "") +
      (colorJob.total && colorJob.done < colorJob.total ? `<span class="lbs-hint">colours ${fmt(colorJob.done)} / ${fmt(colorJob.total)}</span>` : "") +
      (DEV_TOOLS && wall.level === "wall" ? `<button type="button" class="lbs-crumb lbs-logos-btn" data-act="logo-build">${logoJob.running ? `logos ${fmt(logoJob.done)} / ${fmt(logoJob.total)}` : "Logos…"}</button>` : "");
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
        const live = g.id === STOCKED;
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
      if (edit.on && e.button === 0 && i != null) {
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
      if (i != null && openLogoPicker(i, e.offsetX, e.offsetY)) { e.preventDefault(); showTip(null); }
    });
    c.addEventListener("dblclick", (e) => {
      const i = filmAt(e.offsetX, e.offsetY);
      if (i != null) window.open(`/film/${wall.lay.films[i].slug}/`, "_blank", "noopener");
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

  /* ---------------- editing the store (moderators) ---------------- */

  function toggleEdit(on) {
    edit.on = on;
    edit.renaming = edit.deleting = null;
    if (!on) edit.sel = null;
    root.classList.toggle("lbs-editing", on);
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
          `<h4>Sections to place</h4>` +
          `<div class="lbs-tray-list">` +
          (list.length
            ? list.map((pc) => {
                const n = pc.size / CAP;
                return `<div class="lbs-piece -sec" data-cid="${esc(pc.sec)}" style="width:${Math.round(40 + Math.min(1, n) * 200)}px;height:${Math.round(26 + Math.min(5, Math.max(0, Math.ceil(n) - 1)) * 9)}px;--h:${secHue(pc.n)}" title="${esc(nameOf(pc.sec))}: ${pc.count} films still to place"><b>${esc(nameOf(pc.sec))}</b><span>${n < 0.95 ? `${Math.round(n * 100)}% shelf` : `${n.toFixed(1)} shelves`}</span></div>`;
              }).join("")
            : `<p class="lbs-tray-empty">Everything is on the wall. Drop a section on a shelf and it fills the free space there; the rest waits here.</p>`) +
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
  }
  function releaseFilm(slug) {
    if (edit.on) return; // house moves clear it themselves
    mine.held = mine.held.filter(([x]) => x !== slug);
    saveMine();
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
    const ok = !same || sortOf(cid) === "index";
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
        d.ghost.style.setProperty("--h", secHue(lib.genres.get(STOCKED).cats.indexOf(d.cid)));
      } else if (d.kind === "piece" && d.ref && edit.grab === "group") {
        const cid = grabCid(d), n = groupRefs(cid).length;
        d.group = true;
        d.ghost = h("div", "lbs-piece lbs-piece-ghost", `<b>${esc(nameOf(cid))}</b><span>all ${n}</span>`);
        d.ghost.style.setProperty("--h", secHue(lib.genres.get(STOCKED).cats.indexOf(cid)));
      } else if (d.kind === "piece") {
        const cid = grabCid(d);
        d.ghost = h("div", "lbs-piece lbs-piece-ghost", `<b>${esc(nameOf(cid))}</b>`);
        d.ghost.style.setProperty("--h", secHue(lib.genres.get(STOCKED).cats.indexOf(cid)));
        d.ghost.style.width = `${Math.max(30, Math.min(CAP, grabSize(d)) * wall.cam.z)}px`;
      } else {
        d.ghost = h("div", "lbs-dvd lbs-piece-ghost", esc(titleOf(d.name)));
        const c = colors[d.slug];
        d.ghost.style.setProperty("--c", c ? `#${c.slice(0, 6)}` : "#2c3440");
      }
      document.body.append(d.ghost);
      showTip(null);
    }
    d.ghost.style.left = `${e.clientX + 8}px`;
    d.ghost.style.top = `${e.clientY + 8}px`;
    const c = wall.canvas, r = c.getBoundingClientRect();
    const over = e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom;
    wall.dropHint = over ? (d.kind === "piece" ? (d.pour ? pourTarget(d, e.clientX - r.left, e.clientY - r.top) : d.group ? groupTarget(d, e.clientX - r.left, e.clientY - r.top) : dropTarget(d, e.clientX - r.left, e.clientY - r.top)) : edit.on ? dvdTarget(d.slug, e.clientX - r.left, e.clientY - r.top) : null) : null;
    root.querySelectorAll(".lbs-folder.-over").forEach((el) => el.classList.remove("-over"));
    const folder = d.kind === "dvd" && document.elementFromPoint(e.clientX, e.clientY)?.closest?.(".lbs-folder[data-drop]");
    // Hold a film over a folder to open it, as when dragging.
    if (folder && folder.dataset.drop && (lib.genres.has(folder.dataset.drop) || lib.cats.has(folder.dataset.drop))) {
      if (d.spring !== folder.dataset.drop) { d.spring = folder.dataset.drop; clearTimeout(d.springT); d.springT = setTimeout(() => { if (grab === d) openFolder(d.spring); }, 600); }
    } else { d.spring = null; clearTimeout(d.springT); }
    if (folder) folder.classList.add("-over");
    drawSoon();
  });
  window.addEventListener("mouseup", (e) => {
    const d = grab;
    if (!d) return;
    grab = null;
    if (d.ghost) d.ghost.remove();
    const hint = wall.dropHint;
    wall.dropHint = null;
    root.querySelectorAll(".lbs-folder.-over").forEach((el) => el.classList.remove("-over"));
    if (!d.live) {
      if (d.kind === "piece" && d.from === "wall") selectSection(grabCid(d));
      return drawSoon();
    }
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const toTray = el && el.closest && el.closest(".lbs-tray");
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
    if (toTray) { if (d.from === "wall") holdFilms([[d.slug, d.name]]); return drawSoon(); }
    const folder = el && el.closest && el.closest(".lbs-folder[data-drop], .lbs-crumb[data-drop]");
    if (folder && folder.dataset.drop) {
      if (d.from === "tray") releaseFilm(d.slug);
      return moveFilms([[d.slug, d.name]], folder.dataset.drop);
    }
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
      `<small>${edit.on ? "Sets the default for everyone. In Index, drag DVDs along the shelf to arrange them." : "Just for you. Index is the store's own hand-made order."}</small>`;
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

  function selectSection(id) {
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
  function onDragStart(e) {
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
    const inv = !dragFolder && dragging && e.target.closest && e.target.closest(".lbs-tray");
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
      return refresh();
    }
    const act = btn.dataset.act;
    const id = btn.dataset.id;
    if (act === "logo-pick") return pickLogo(btn.dataset.slug, +btn.dataset.n);
    if (act === "edit") return toggleEdit(!edit.on);
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
    if (act === "open" && edit.on && lib.cats.has(id) && lib.cats.get(id).genre === STOCKED) { edit.sel = id; drawSoon(); }
    if (act === "open") {
      if (!desk.open) {
        desk.folder = id;
        desk.folder = id;
        return setDesk(true);
      }
      if (desk.mode === "store" && partsOf(id).genre === STOCKED && wall.level === "aisles" && id !== STOCKED) wall.level = "wall";
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
    a.textContent = "Store";
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
      `<a class="lbs-home-door" href="#store">` +
      `<span class="lbs-home-kicker">LetterBloxd video store</span>` +
      (DESK_ONLY
        ? `<span class="lbs-home-title">The Sorting Desk is open</span><span class="lbs-home-sub">File films into genres, categories and subcategories. Start with Horror →</span>`
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
