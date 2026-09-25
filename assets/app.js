  // These MUST match your sheet headers exactly:
  const FIELDS = [
    "Name","PID","Alliance","City_FC_Level","Game_Power","Foundry_Power",
    "Type_Of_Infantry","Infantry_FC_Level",
    "Type_Of_Marksmen","Marksmen_FC_Level",
    "Type_Of_Lancers","Lancer_FC_Level",
    "Gender","Location","JoinDate","Avatar","State"
  ];

  // Default state/server for this alliance. Gift-code redemption now requires it.
  const DEFAULT_STATE = "603";

  // Troop tier options for the Type_Of_* columns.
  const TROOP_TIERS = ["Regular","Helios","Exalted"];
  // Alliance options. New members default to TBD (see backend upsert).
  const ALLIANCE_OPTS = ["TBD","TBC","TBA","Other"];

  // ==================================================================
  // HERO CATALOG + ACTIVE GEN
  // The full list lives in assets/heroes.js (window.HERO_CATALOG).
  // ALL_HEROES   = every hero incl. Rare/Epic (gen 0) -> avatar picker
  // HERO_CATALOG = generation heroes only (gen >= 1)  -> Edit Heroes
  // ==================================================================
  const ALL_HEROES   = Array.isArray(window.HERO_CATALOG) ? window.HERO_CATALOG : [];
  const HERO_CATALOG = ALL_HEROES.filter(h => h.gen >= 1);
  const HERO_BY_ID   = Object.fromEntries(ALL_HEROES.map(h => [h.id, h]));
  const HERO_MAX_GEN = window.HERO_MAX_GEN || Math.max(1, ...HERO_CATALOG.map(h => h.gen));
  const HERO_IMG_DIR = "images/heroes/";

  // Site-wide active gen. Loaded from the backend Settings sheet (view=settings),
  // cached in localStorage so the page paints with the right value instantly.
  let ACTIVE_GEN = (() => {
    const cached = Number(localStorage.getItem("tbd_active_gen"));
    if (cached >= 1) return Math.min(cached, HERO_MAX_GEN);
    return Math.min(window.HERO_DEFAULT_ACTIVE_GEN || HERO_MAX_GEN, HERO_MAX_GEN);
  })();
  function isGenUnlocked_(gen){ return Number(gen) <= ACTIVE_GEN; }
  function heroImg_(h){ return HERO_IMG_DIR + (h.icon || (h.id + ".webp")); }

  // Old avatar values were image filenames. Map them onto hero ids so saved
  // profiles keep their picture after the upgrade.
  const LEGACY_AVATAR_MAP = {
    "blanchette.jpg":"blanchette", "hervor.jpg":"hervor", "norah.jpg":"norah",
    "eleonora.jpg":"eleonora", "kerol.jpg":"karol", "greg.jpg":"greg",
    "jeronimo.jpg":"jeronimo", "wu-ming.jpg":"wu_ming"
  };
  // Auto-avatar pools used when a player has not picked one.
  const AVATARS_MALE   = ["karol","greg","jeronimo","wu_ming"];
  const AVATARS_FEMALE = ["blanchette","hervor","norah","eleonora"];

  function hashString_(s){
    let h = 0;
    const str = String(s || "");
    for (let i = 0; i < str.length; i++){
      h = ((h << 5) - h) + str.charCodeAt(i);
      h |= 0;
    }
    return Math.abs(h);
  }

  // Normalize whatever is stored in the Avatar column to a hero id (or "").
  function avatarHeroId_(raw){
    const v = String(raw ?? "").trim().toLowerCase();
    if (!v || v === "auto" || v === "na") return "";
    if (LEGACY_AVATAR_MAP[v]) return LEGACY_AVATAR_MAP[v];
    const id = v.replace(/\.(jpg|jpeg|png|webp)$/, "").replace(/[^a-z0-9]+/g, "_");
    return HERO_BY_ID[id] ? id : "";
  }

  // Pick a stable avatar hero for a player. Returns
  //   { hero, auto }  or  null (caller shows the placeholder)
  // Order: 1. manually picked hero  2. hash of PID -> gender pool
  function pickAvatar_(m){
    const manual = avatarHeroId_(m.Avatar);
    if (manual) return { hero: HERO_BY_ID[manual], auto: false };
    const gender = String(m.Gender ?? "").trim().toLowerCase();
    const pool = gender === "male" ? AVATARS_MALE
                : gender === "female" ? AVATARS_FEMALE
                : null;
    if (!pool) return null;
    const id = pool[hashString_(m.PID) % pool.length];
    return HERO_BY_ID[id] ? { hero: HERO_BY_ID[id], auto: true } : null;
  }

  // ==================================================================
  // ROLE-BASED ACCESS — session manager
  //
  // The user signs in once with a password. The backend identifies which
  // role that credential unlocks:
  //   VIEWER  - not signed in (read-only)
  //   PLAYER  - signed in with an existing PID; can edit only their own info
  //   ADMIN   - signed in with the admin password; can edit all players + events
  //   MASTER  - signed in with the master password; everything ADMIN can do,
  //             plus delete players and delete events
  // We keep the password + detected role in sessionStorage so it:
  //   - clears when the browser/tab is closed
  //   - persists across reloads of the same tab
  // We also track lastActivity and auto-sign-out after 2 hours of no input.
  // ==================================================================
  const SESSION_KEY = "tbd_alliance_session";
  const SESSION_INACTIVITY_MS = 2 * 60 * 60 * 1000; // 2 hours

  const ROLE_RANK = { VIEWER:0, PLAYER:1, ADMIN:2, MASTER:3 };
  // What a given signed-in role is ALLOWED to do (matches backend requireRole_).
  // Keyed by the MINIMUM role an action requires; value is the set of roles that satisfy it.
  // MASTER satisfies every requirement (it outranks ADMIN).
  const ROLE_ALLOWS = 
  {
    VIEWER: new Set(["VIEWER","PLAYER","ADMIN","MASTER"]),
    PLAYER: new Set(["PLAYER","ADMIN","MASTER"]),
    ADMIN:  new Set(["ADMIN","MASTER"]),
    MASTER: new Set(["MASTER"])
  };

  // Returns true if the current role satisfies the minimum role.
  function roleAllows(currentRole, minRole) 
  {
    const set = ROLE_ALLOWS[minRole];
    if (!set) return false;
    return set.has(currentRole);
  }

  function loadSession() {
    try {
      const raw = sessionStorage.getItem(SESSION_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !s.role || !s.password) return null;
      const age = Date.now() - (s.lastActivity || 0);
      if (age > SESSION_INACTIVITY_MS) {
        sessionStorage.removeItem(SESSION_KEY);
        return null;
      }
      return s;
    } catch (e) { return null; }
  }

  function saveSession(role, password, playerPid, playerName) 
  {
    const s = { role, password, playerPid, playerName, lastActivity: Date.now() };
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
    return s;
  }

  function currentPlayerName() 
  {
    const s = loadSession();
    return s ? (s.playerName || "") : "";
  }

  function touchSession() {
    const s = loadSession();
    if (!s) return;
    s.lastActivity = Date.now();
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(s));
  }

  function currentRole() {
    const s = loadSession();
    return s ? s.role : "VIEWER";
  }

  function currentPassword() {
    const s = loadSession();
    return s ? s.password : "";
  }

  function signOut() {
    sessionStorage.removeItem(SESSION_KEY);
    setRoleUI("VIEWER");
    setMsg("Signed out.");
  }

  // Sign-in modal controls
  function openSignIn() {
    document.getElementById("signInBackdrop").style.display = "flex";
    document.getElementById("signInMsg").textContent = "";
    const inp = document.getElementById("signInPw");
    inp.value = "";
    setTimeout(() => inp.focus(), 50);
  }

  function closeSignIn() {
    document.getElementById("signInBackdrop").style.display = "none";
  }

  async function submitSignIn() 
  {
    const pw = document.getElementById("signInPw").value || "";
    const msg = document.getElementById("signInMsg");
    if (!pw) { msg.style.color = "#ffb0b0"; msg.textContent = "Enter a password."; return; }
    msg.style.color = "var(--text-muted)"; msg.textContent = "Checking\u2026";
    const res = await apiGet({ view: "whoami", password: pw });
    if (!res.ok) {
      msg.style.color = "#ffb0b0"; msg.textContent = "Error: " + (res.error || "unknown");
      return;
    }
    if (!res.authenticated || res.role === "VIEWER") {
      msg.style.color = "#ffb0b0"; msg.textContent = "Password not recognized.";
      return;
    }
    saveSession(res.role, pw, res.playerPid || "", res.playerName || "");
    setRoleUI(res.role);
    closeSignIn();
    setMsg("Signed in as " + res.role + ".");
  }

  // Update the whole UI based on current role. Call after sign-in / sign-out.
  function setRoleUI(role) {
    // Badge text + class
    const badge = document.getElementById("roleBadge");
    if (badge) {
      badge.textContent = role;
      badge.className = "role-badge " + role;
    }
    const who = currentPlayerName();
    badge.textContent = who ? `${role} · ${who}` : role;

    // Sign in / sign out buttons
    const signInBtn  = document.getElementById("signInBtn");
    const signOutBtn = document.getElementById("signOutBtn");
    if (signInBtn && signOutBtn) {
      if (role === "VIEWER") {
        signInBtn.style.display = "";
        signOutBtn.style.display = "none";
      } else {
        signInBtn.style.display = "none";
        signOutBtn.style.display = "";
        signOutBtn.textContent = "Sign out (" + role + ")";
      }
    }
    // body class so CSS can target if ever needed
    document.body.className = document.body.className.replace(/\brole-\w+\b/g, "").trim();
    document.body.classList.add("role-" + role);

    // Hide / show elements tagged with .requires-<ROLE>
    document.querySelectorAll("[data-requires]").forEach(el => {
      const need = el.getAttribute("data-requires");
      if (roleAllows(role, need)) el.classList.remove("role-hidden");
      else el.classList.add("role-hidden");
    });

    // Lock the PID field to the player's own PID (players) or free it (admins).
    try { applyPlayerEditingState(); } catch (e) {}
  }

  // Activity listeners — refresh lastActivity on user input
  ["click","keydown","mousemove","touchstart"].forEach(evt => {
    document.addEventListener(evt, () => touchSession(), { passive: true });
  });
  // Every 30s, check if the session timed out and bounce back to VIEWER
  setInterval(() => {
    const s = loadSession();
    if (!s && currentRole() !== "VIEWER") {
      // shouldn't happen; currentRole() reads the same store. just in case.
      setRoleUI("VIEWER");
    }
    if (!s && document.body.classList.contains("role-VIEWER") === false) {
      setRoleUI("VIEWER");
    }
  }, 30000);

  // Track selected PIDs across sorts/renders
  const selectedPids = new Set();

  function setMsg(t){ document.getElementById("msg").textContent = t; }

  function setDebug(obj)
  {
    document.getElementById("debug").textContent =
      typeof obj === "string" ? obj : JSON.stringify(obj, null, 2);
  }

  let currentList = [];        // the currently RENDERED list (after tab + filters + sort)
  let sheetDefaultOrder = [];  // active roster, in sheet order (from loadAll)
  let archiveList = [];        // archived members (lazy-loaded when Archive tab is first opened)
  let archiveLoaded = false;
  let currentProfilePid = null;

  // Alliance tab + filter state
  let activeTab = "ALL";       // ALL | TBD | TBC | TBA | OTHER | SQUAD | ARCHIVE

  let sortState = { key: null, dir: 1 };

  // Normalize an alliance value into one of TBD / TBC / OTHER for tab grouping.
  // Blank/unknown alliances count as OTHER (except the dedicated tabs).
  function allianceGroup_(m){
    const a = String(m.Alliance || "").trim().toUpperCase();
    if (a === "TBD") return "TBD";
    if (a === "TBC") return "TBC";
    if (a === "TBA") return "TBA";
    return "OTHER";
  }

  // Is this player starred as part of the SVS Squad?
  // The SVS_Squad column may not exist yet on older sheets — treat missing as false.
  function isSquad_(m){
    const v = String(m.SVS_Squad ?? "").trim().toLowerCase();
    return v === "yes" || v === "true" || v === "y" || v === "1";
  }

  // Normalize a troop tier cell, translating legacy Yes/No to Helios/Regular.
  function troopTier_(v){
    const s = String(v ?? "").trim().toLowerCase();
    if (s === "yes") return "helios";
    if (s === "no")  return "regular";
    return s; // "regular" | "helios" | "exalted" | "" | "na"
  }

  // Read a troop-type cell for one of "Infantry" | "Marksmen" | "Lancers",
  // tolerating both the new Type_Of_* headers and the legacy Helios_* headers
  // (e.g. an Archive row that predates the migration). Returns the raw cell value.
  function troopCell_(m, kind){
    const map = {
      Infantry: ["Type_Of_Infantry", "Helios_Infantry"],
      Marksmen: ["Type_Of_Marksmen", "Helios_Marksmen"],
      Lancers:  ["Type_Of_Lancers", "Helios_Lancer", "Helios_Lancers"]
    };
    const keys = map[kind] || [];
    for (const k of keys){
      if (m[k] !== undefined && m[k] !== null && String(m[k]).trim() !== "") return m[k];
    }
    return "";
  }

  // Does a member match the current troop-type + tier filter?
  function matchesTroopFilter_(m){
    const troop = document.getElementById("filterTroop")?.value || "ANY";
    const tier  = document.getElementById("filterTier")?.value  || "ANY";
    if (troop === "ANY" && tier === "ANY") return true;

    const byType = {
      Infantry: troopTier_(troopCell_(m, "Infantry")),
      Marksmen: troopTier_(troopCell_(m, "Marksmen")),
      Lancers:  troopTier_(troopCell_(m, "Lancers"))
    };

    // Which troop types must satisfy the tier requirement?
    let typesToCheck;
    if (troop === "ANY")      typesToCheck = ["Infantry","Marksmen","Lancers"]; // any one is enough
    else if (troop === "ALL3") typesToCheck = ["Infantry","Marksmen","Lancers"]; // all must match
    else typesToCheck = [troop];

    const tierOk = (t) => {
      if (tier === "ANY") return t === "helios" || t === "exalted" || t === "regular";
      if (tier === "HELIOS_OR_EXALTED") return t === "helios" || t === "exalted";
      return t === tier.toLowerCase(); // "Helios" or "Exalted"
    };

    if (troop === "ALL3") return typesToCheck.every(k => tierOk(byType[k]));
    return typesToCheck.some(k => tierOk(byType[k]));
  }

  // The source list for the active tab (archive tab uses archiveList).
  function tabSourceList_(){
    if (activeTab === "ARCHIVE") return archiveList;
    return sheetDefaultOrder;
  }

  // Switch tabs. Loads the archive lazily the first time it's opened.
  async function setTab(tab){
    activeTab = tab;
    document.querySelectorAll("#allianceTabs .tab-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.tab === tab);
    });
    // Selecting across tabs would be confusing — clear selection on tab change.
    clearSelection();

    // Swap the bulk-action buttons for the tab context:
    //  - Archive tab: only "Restore Selected" makes sense.
    //  - Any other tab: "Archive Selected" + "Delete Selected".
    const isArchive = (tab === "ARCHIVE");
    const btnArchive = document.getElementById("btnArchiveSel");
    const btnDelete  = document.getElementById("btnDeleteSel");
    const btnRestore = document.getElementById("btnRestoreSel");
    if (btnArchive) btnArchive.classList.toggle("tab-hidden", isArchive);
    if (btnDelete)  btnDelete.classList.toggle("tab-hidden", isArchive);
    if (btnRestore) btnRestore.classList.toggle("tab-hidden", !isArchive);

    if (tab === "ARCHIVE" && !archiveLoaded){
      setMsg("Loading archive…");
      const res = await apiGet({ view: "archive" });
      if (res.ok){ archiveList = res.members || []; archiveLoaded = true; setMsg(`Loaded ${archiveList.length} archived player(s).`); }
      else setMsg(res.error || "Error loading archive");
    }
    // Reset sort when changing tabs so we start from natural order.
    sortState.key = null; sortState.dir = 1; updateHeaderArrows();
    applyTabAndFilters();
  }

  // Recompute currentList from the active tab + filters (+ current sort) and render.
  function applyTabAndFilters(){
    let list = tabSourceList_().slice();

    // Tab (alliance) filter — not applied to ALL or ARCHIVE.
    if (activeTab === "TBD" || activeTab === "TBC" || activeTab === "TBA" || activeTab === "OTHER"){
      list = list.filter(m => allianceGroup_(m) === activeTab);
    }

    // SVS Squad tab: only starred players.
    if (activeTab === "SQUAD"){
      list = list.filter(isSquad_);
    }

    // Troop type + tier filter (applies to every tab, including ALL/ARCHIVE).
    list = list.filter(matchesTroopFilter_);

    // Free-text search on name/PID.
    const q = (document.getElementById("filterSearch")?.value || "").trim().toLowerCase();
    if (q){
      list = list.filter(m =>
        String(m.Name || "").toLowerCase().includes(q) ||
        normPid(m.PID).toLowerCase().includes(normPid(q).toLowerCase())
      );
    }

    // Keep the active column sort if one is set.
    if (sortState.key){
      list.sort((a,b) => sortState.dir * compareValues(a,b,sortState.key));
    }

    currentList = list;
    renderTable(currentList);

    const countEl = document.getElementById("tabCount");
    if (countEl) countEl.textContent = `${currentList.length} shown`;
  }

  function clearFilters(){
    const t = document.getElementById("filterTroop"); if (t) t.value = "ANY";
    const r = document.getElementById("filterTier");  if (r) r.value = "ANY";
    const s = document.getElementById("filterSearch"); if (s) s.value = "";
    applyTabAndFilters();
  }

  function parseNumberLike(v)
  {
    if (v === null || v === undefined) return NaN;
    const s = String(v).replace(/,/g, "").trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function normPid(v)
  {
    return String(v ?? "").replace(/[\s,]/g, "").trim();
  }

  function compareValues(a, b, key)
  {
    const numericKeys = new Set([
      "Game_Power","Foundry_Power",
      "City_FC_Level","Infantry_FC_Level",
      "Marksmen_FC_Level","Lancer_FC_Level"
    ]);

    if (numericKeys.has(key))
    {
      const an = parseNumberLike(a[key]);
      const bn = parseNumberLike(b[key]);

      const aBad = !Number.isFinite(an);
      const bBad = !Number.isFinite(bn);

      if (aBad && bBad) return 0;
      if (aBad) return 1;   // blanks go to bottom
      if (bBad) return -1;

      return an - bn;
    }

    const as = (a[key] ?? "").toString().toLowerCase();
    const bs = (b[key] ?? "").toString().toLowerCase();
    return as.localeCompare(bs);
}


  function sortBy(key) 
  {
    if (sortState.key === key) sortState.dir *= -1;
    else { sortState.key = key; sortState.dir = 1; }

    // Re-run the tab + filter pipeline (which applies the current sort).
    applyTabAndFilters();
    updateHeaderArrows();
  }

  function canEditPid(targetPid)
  {
    const role = currentRole();
    if (roleAllows(role, 'ADMIN')) return true;
    if (role === 'PLAYER' && normPid(targetPid) === currentPlayerPid()) return true;
    return false;
  }

  function updateHeaderArrows()
  {
    document.querySelectorAll("th[data-sort]").forEach(th => {
      const k = th.dataset.sort;
      const base = th.dataset.base || th.textContent.replace(/[▲▼]/g,"").trim();
      th.dataset.base = base;
      th.textContent = k === sortState.key
        ? base + (sortState.dir === 1 ? " ▲" : " ▼")
        : base;
    });
  }

  function initSorting()
  {
    document.querySelectorAll("th[data-sort]").forEach(th => {
      th.style.cursor = "pointer";
      th.addEventListener("click", () => sortBy(th.dataset.sort));
    });
  }

  function saveConfig(){
    localStorage.setItem("apiUrl", document.getElementById("apiUrl").value.trim());
    localStorage.setItem("apiKey", document.getElementById("apiKey").value.trim());
    setMsg("Saved config.");
  }

  function loadConfig()
  {
    document.getElementById("apiUrl").value = localStorage.getItem("apiUrl") || "";
    document.getElementById("apiKey").value = localStorage.getItem("apiKey") || "";
  }

  function cfg(){
    return {
      url: document.getElementById("apiUrl").value.trim(),
      key: document.getElementById("apiKey").value.trim(),
    };
  }

  // ======================================================================
  // API CACHE (JavaScript Cache API)
  // ----------------------------------------------------------------------
  // Read-only GET views are stored in the browser's Cache Storage so the
  // page can paint instantly from the last known data, then refresh in the
  // background (stale-while-revalidate). Any successful write (apiPost)
  // wipes the cache so nobody edits on top of stale data.
  //
  //   apiGet(params)                       -> fresh if cache < 60s old, else network
  //   apiGet(params, { onFresh: fn })      -> returns cache immediately (any age
  //                                           up to 7 days) and calls fn(json)
  //                                           when newer data arrives
  //   apiGet(params, { cache: "network" }) -> always network (editors)
  //   apiGet(params, { cache: "network", acceptAge: 20000 })
  //                                        -> use a cached copy only if it is
  //                                           < 20s old (e.g. hover-prefetched)
  // Offline / network error: falls back to the cached copy if one exists.
  // ======================================================================
  const API_CACHE_NAME = "tbd-api-v1";
  const API_CACHE_MAX_AGE = 60 * 1000;            // "fresh" window
  const API_CACHE_KEEP    = 7 * 24 * 3600 * 1000; // never serve older than this
  const CACHEABLE_VIEWS = new Set(["", "events_list", "svs_leaderboard", "event_detail",
    "profile", "player_heroes", "gift_codes", "archive", "settings", "events", "regulars"]);
  const _inflight = new Map();
  const hasCacheApi = typeof caches !== "undefined" && window.isSecureContext;

  function apiCacheKey_(url, params){
    const u = new URL(url);
    Object.keys(params).sort().forEach(k => u.searchParams.set(k, params[k]));
    u.searchParams.set("__cache", "1");      // never collides with a live request
    return u.toString();                     // API key intentionally NOT included
  }

  async function apiCacheRead_(cacheKey){
    if (!hasCacheApi) return null;
    try {
      const c = await caches.open(API_CACHE_NAME);
      const hit = await c.match(cacheKey);
      if (!hit) return null;
      const at = Number(hit.headers.get("X-Cached-At")) || 0;
      const text = await hit.text();
      return { at, age: Date.now() - at, text, json: JSON.parse(text) };
    } catch (e) { return null; }
  }

  async function apiCacheWrite_(cacheKey, text){
    if (!hasCacheApi) return;
    try {
      const c = await caches.open(API_CACHE_NAME);
      await c.put(cacheKey, new Response(text, {
        headers: { "Content-Type": "application/json", "X-Cached-At": String(Date.now()) }
      }));
    } catch (e) { /* quota or private mode: ignore */ }
  }

  async function apiCacheClear(){
    _inflight.clear();
    if (!hasCacheApi) return;
    try { await caches.delete(API_CACHE_NAME); } catch (e) {}
  }

  // Raw network GET. Returns { json, text } and de-duplicates identical
  // requests that are already in flight (e.g. hover-prefetch + click).
  function apiNetworkGet_(url, key, params, cacheKey){
    if (_inflight.has(cacheKey)) return _inflight.get(cacheKey);
    const u = new URL(url);
    u.searchParams.set("key", key);
    Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
    const p = fetch(u.toString())
      .then(r => r.text())
      .then(text => {
        const json = JSON.parse(text);
        if (json && json.ok) apiCacheWrite_(cacheKey, text);
        return { json, text };
      })
      .finally(() => _inflight.delete(cacheKey));
    _inflight.set(cacheKey, p);
    return p;
  }

  async function apiGet(params = {}, opts = {})
  {
    try
    {
      const { url, key } = cfg();
      if (!url) return { ok: false, error: "Missing API URL" };

      const view = String(params.view || "").toLowerCase();
      const cacheable = hasCacheApi && !params.action && !params.password && CACHEABLE_VIEWS.has(view);
      if (!cacheable){
        const u = new URL(url);
        u.searchParams.set("key", key);
        Object.entries(params).forEach(([k, v]) => u.searchParams.set(k, v));
        const r = await fetch(u.toString());
        return await r.json();
      }

      const cacheKey = apiCacheKey_(url, params);
      const mode = opts.cache || (opts.onFresh ? "swr" : "fresh");
      const cached = await apiCacheRead_(cacheKey);
      const usable = cached && cached.age < API_CACHE_KEEP && cached.json && cached.json.ok;

      // 1) Stale-while-revalidate: paint now, refresh in the background.
      if (mode === "swr" && usable){
        apiNetworkGet_(url, key, params, cacheKey).then(({ json, text }) => {
          if (json && json.ok && text !== cached.text && typeof opts.onFresh === "function") opts.onFresh(json);
        }).catch(() => {});
        return Object.assign({ _fromCache: true, _age: cached.age }, cached.json);
      }
      // 2) Recent enough copy (prefetched / within the fresh window).
      const maxAge = (mode === "network") ? (opts.acceptAge || 0) : API_CACHE_MAX_AGE;
      if (usable && cached.age < maxAge){
        return Object.assign({ _fromCache: true, _age: cached.age }, cached.json);
      }
      // 3) Network, falling back to any cached copy when offline.
      try {
        const { json } = await apiNetworkGet_(url, key, params, cacheKey);
        return json;
      } catch (netErr) {
        if (usable) return Object.assign({ _fromCache: true, _offline: true, _age: cached.age }, cached.json);
        throw netErr;
      }
    }
    catch (e)
    {
      return { ok: false, error: e.message };
    }
  }

  // Fire-and-forget warm-up used by hover/idle prefetching.
  function apiPrefetch(params){
    const { url } = cfg();
    if (!url || !hasCacheApi) return;
    apiGet(params, { cache: "network", acceptAge: 30000 }).catch(() => {});
  }

  // Prefetch an event's detail when the pointer hovers View / Edit, so the
  // modal opens with no wait. Throttled per event.
  const _prefetchedEvents = new Map();
  function prefetchEventDetail(eventId){
    const last = _prefetchedEvents.get(eventId) || 0;
    if (Date.now() - last < 30000) return;
    _prefetchedEvents.set(eventId, Date.now());
    apiPrefetch({ view: "event_detail", event_id: eventId });
  }

  // Idle-time prefetch of the views people usually open next.
  function idlePrefetch_(){
    const run = () => {
      apiPrefetch({ view: "svs_leaderboard" });
      if (roleAllows(currentRole(), "ADMIN")) apiPrefetch({ view: "gift_codes" });
      // Hand the hero portraits to the service worker so they are cached
      // before anyone opens Edit Heroes or the icon picker.
      if (navigator.serviceWorker && navigator.serviceWorker.controller){
        navigator.serviceWorker.controller.postMessage({
          type: "WARM_IMAGES",
          urls: ALL_HEROES.map(h => new URL(heroImg_(h), location.href).toString())
        });
      }
    };
    if ("requestIdleCallback" in window) requestIdleCallback(run, { timeout: 4000 });
    else setTimeout(run, 2500);
  }

  async function apiPost(action, payload)
  {
    try {
      const { url, key } = cfg();
      if (!url) return { ok: false, error: "Missing API URL" };

      // Auto-attach the session password for role-gated endpoints.
      // For an ADMIN this is the admin password; for a PLAYER it is their own PID
      // (which is how the backend authorizes self-edits). Caller can still override
      // by passing an explicit adminpassword in the payload.
      const pw = currentPassword();
      const finalPayload = Object.assign({}, payload || {});
      if (pw && !finalPayload.adminpassword && !finalPayload.password && !finalPayload.rolepassword) {
        finalPayload.adminpassword = pw;
      }

      // POST the request as a JSON body. We use Content-Type text/plain so the
      // browser does NOT send a CORS preflight (OPTIONS) request — Apps Script
      // web apps don't answer preflight, which otherwise shows up as
      // "Failed to fetch". Large payloads (e.g. a full hero list) also can't fit
      // in a URL query string, so a POST body is required for those to work.
      const r = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "text/plain;charset=utf-8" },
        body: JSON.stringify({ key: key, action: action, payload: finalPayload }),
        redirect: "follow"
      });
      const out = await r.json();
      // Any successful write makes cached reads stale.
      if (out && out.ok) await apiCacheClear();
      return out;
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ---- Player state ----
  // Century Games removed /api/player in 2026, so nickname and furnace level can
  // no longer be pulled from the game. What we can still do — and what gift-code
  // redemption now requires — is record each player's State (server number).
  async function syncCurrentFromGame(){
    const pid = (document.getElementById("PID").value || "").trim();
    const stateEl = document.getElementById("State");
    const state = ((stateEl && stateEl.value) || "").replace(/[^0-9]/g, "").trim() || DEFAULT_STATE;
    const msg = document.getElementById("syncOneMsg");
    if (!pid){ msg.style.color = "#a00"; msg.textContent = "Enter or load a PID first."; return; }
    if (!roleAllows(currentRole(), "ADMIN")){
      msg.style.color = "#a00";
      msg.textContent = "Sign in as ADMIN to change a player's state.";
      openSignIn();
      return;
    }
    msg.style.color = "#555";
    msg.textContent = "Saving state…";
    const res = await apiPost("sync_game_info", { PID: pid, State: state });
    if (!res.ok){
      msg.style.color = "#a00";
      msg.textContent = "Failed: " + (res.error || "unknown");
      return;
    }
    if (stateEl) stateEl.value = res.state || state;
    msg.style.color = "#2a8e4d";
    msg.textContent = res.stateChanged
      ? `State set to ${res.state} (was ${res.oldState || "blank"}). Name and furnace level are manual now — the game no longer publishes them.`
      : `State already ${res.state}. Name and furnace level are manual now — the game no longer publishes them.`;
    try { await loadAll(); } catch (e) {}
  }

  // Fills the State column for the whole roster and reports which PIDs the game
  // has rejected during past redemption runs. Costs zero game API calls, so it
  // is instant and cannot trip the rate limit.
  // ---- Dismissible result banners ----
  // The green/red result panels stay put until you close them. The X is only
  // added on the final state of a run, never mid-run, so you cannot close a
  // banner while work is still in flight.
  function showBannerResult(boxId, innerHtml, kind){
    const box = document.getElementById(boxId);
    if (!box) return;
    const tone = kind === "error"
      ? { bg:"#fde7e7", border:"#e0a0a0", color:"#8a1f1f" }
      : { bg:"#e8f5ec", border:"#a9d9bb", color:"#1e5f34" };
    box.style.background = tone.bg;
    box.style.borderColor = tone.border;
    box.style.color = tone.color;
    box.style.display = "block";
    box.style.position = "relative";
    box.innerHTML =
      `<button type="button" class="bannerClose" onclick="dismissBanner('${boxId}')" title="Close (Esc)"
               aria-label="Close"
               style="position:absolute; top:6px; right:8px; width:24px; height:24px; line-height:1;
                      padding:0; border:none; background:transparent; color:inherit; opacity:.6;
                      font-size:18px; cursor:pointer;">&times;</button>` +
      `<div style="padding-right:26px;">${innerHtml}</div>`;
  }

  // Hide and wipe a banner so an old result never flashes on the next run.
  function dismissBanner(boxId){
    const box = document.getElementById(boxId);
    if (!box) return;
    box.style.display = "none";
    box.innerHTML = "";
  }

  // Close every open banner (used by Escape).
  function dismissAllBanners(){
    ["syncProgress","giftCodeProgress"].forEach(id => {
      const box = document.getElementById(id);
      // Only close banners that have actually finished (i.e. show an X).
      if (box && box.style.display !== "none" && box.querySelector(".bannerClose")) dismissBanner(id);
    });
  }

  // The "manual now" explainer only needs reading once.
  const MANUAL_NOTE_KEY = "wos_manual_note_dismissed";
  function manualNoteHtml_(){
    if (localStorage.getItem(MANUAL_NOTE_KEY) === "1") return "";
    return `<div id="manualNote" style="position:relative; margin-top:8px; font-size:12px; padding:8px 26px 8px 10px; background:#fff6e0; border:1px solid #e0c98a; border-radius:6px; color:#6b4e0e;">` +
      `<button type="button" onclick="dismissManualNote()" title="Don't show this again" aria-label="Dismiss"
               style="position:absolute; top:4px; right:6px; width:20px; height:20px; line-height:1; padding:0;
                      border:none; background:transparent; color:inherit; opacity:.6; font-size:16px; cursor:pointer;">&times;</button>` +
      `<b>Name and Furnace Level are manual now.</b> Century Games removed the player-info endpoint (<code>/api/player</code> returns 404), so there is no longer any public source for a player's nickname or furnace level. Gift-code redemption still works and now needs each player's State instead.` +
      `</div>`;
  }

  function dismissManualNote(){
    localStorage.setItem(MANUAL_NOTE_KEY, "1");
    const el = document.getElementById("manualNote");
    if (el) el.remove();
  }

  async function syncAllFromGame(){
    if (!roleAllows(currentRole(), "ADMIN")){
      setMsg("Sign in as ADMIN to update the roster.");
      openSignIn();
      return;
    }
    const box = document.getElementById("syncProgress");
    const input = prompt("Which state is this alliance in?", DEFAULT_STATE);
    if (input === null) return;
    const state = String(input).replace(/[^0-9]/g, "").trim() || DEFAULT_STATE;

    box.style.display = "block";
    box.style.background = "#e8f5ec"; box.style.borderColor = "#a9d9bb"; box.style.color = "#1e5f34";
    box.innerHTML = "Updating roster…";

    const res = await apiPost("sync_game_all", { state: state });
    if (!res.ok){
      showBannerResult("syncProgress", "Failed: " + esc_(res.error || "unknown"), "error");
      return;
    }

    let html = `<div style="font-weight:700; margin-bottom:4px;">Roster updated</div>`;
    html += `<div>Players: <b>${res.total || 0}</b> · State written for <b style="color:#2a8e4d">${res.updated || 0}</b> · Already correct <b>${res.unchanged || 0}</b></div>`;
    html += `<div style="margin-top:3px;">Confirmed by a past redemption: <b>${res.confirmed || 0}</b> · Rejected by the game: <b style="color:#a00">${res.flagged || 0}</b> · Never tested: <b>${res.unknown || 0}</b></div>`;

    const flagged = (res.results || []).filter(r => r.status === "REJECTED_BY_GAME");
    if (flagged.length){
      html += `<details style="margin-top:6px;"><summary style="cursor:pointer; font-weight:600; color:#8a1f1f;">Show ${flagged.length} PID(s) the game rejected</summary>` +
              `<div style="font-size:12px; margin-top:4px; max-height:200px; overflow:auto;">` +
              flagged.map(r => `<div>• <b>${esc_(r.pid)}</b> — state ${esc_(r.state || "")}: check the PID, or the player may have transferred states</div>`).join("") +
              `</div></details>`;
    }
    html += manualNoteHtml_();
    showBannerResult("syncProgress", html, "ok");

    try { await loadAll(); } catch (e) {}
  }

  // ---- Gift code redemption ----
  async function redeemGiftCodeForAlliance(){
    const code = (document.getElementById("giftCodeInput").value || "").trim();
    const msg  = document.getElementById("giftCodeMsg");
    const box  = document.getElementById("giftCodeProgress");

    if (!code){ msg.style.color = "#a00"; msg.textContent = "Enter a code."; return; }
    // Gift code redeem requires ADMIN.
    if (!roleAllows(currentRole(), "ADMIN")){
      msg.style.color = "#a00";
      msg.textContent = "Sign in as ADMIN to redeem gift codes.";
      openSignIn();
      return;
    }
    // apiPost will auto-attach the session password as adminpassword.
    const pw = currentPassword();

    const list = (currentList || []).filter(m => String(m.PID || "").trim() && String(m.PID).toLowerCase() !== "na");
    const est = Math.max(1, list.length);

    // The game now requires each player's state/server number.
    const stateIn = prompt(`Which state should "${code}" be redeemed in?\n\nPlayers with their own State set on the roster use that value; this is the fallback for everyone else.`, DEFAULT_STATE);
    if (stateIn === null) return;
    const state = String(stateIn).replace(/[^0-9]/g, "").trim() || DEFAULT_STATE;

    // One request per player now that the captcha is gone: ~2.5s each.
    const mins = Math.max(1, Math.ceil(est * 2.5 / 60));
    if (!confirm(`Redeem "${code}" for ${est || '?'} players in state ${state}?\n\nThis takes about ${mins} minute(s) — the game allows 30 requests per minute, so we pace one player every 2.5 seconds.`)) return;

    msg.style.color = "#555"; msg.textContent = "";
    box.style.display = "block";
    box.style.background = "#e8f5ec"; box.style.borderColor = "#a9d9bb"; box.style.color = "#1e5f34";
    box.innerHTML = `Redeeming <b>${esc_(code)}</b>… keep this tab open.`;

    let startIndex = 0;
    let stats = { success:0, alreadyClaimed:0, invalid:0, expired:0, errors:0, skipped:0, badPlayers:0 };
    let total = 0, totalInRoster = 0;
    const results = [];
    // Chunk size must match the backend cap. Redemption is a single request per
    // player now (no captcha), so 50 PIDs ≈ 2 min per batch.
    const CHUNK = 50;
    let stopped = null;
    const startedAt = Date.now();

    // Helper: update the progress box with elapsed time + live stats
    function renderProgress(phase){
      const secs = Math.round((Date.now() - startedAt)/1000);
      const mm = Math.floor(secs/60), ss = String(secs%60).padStart(2,"0");
      const rosterLine = totalInRoster ? ` of <b>${totalInRoster}</b>` : "";
      box.innerHTML =
        `${phase} <b>${esc_(code)}</b>… processed <b>${total}</b>${rosterLine} · ⌚ ${mm}:${ss}` +
        (total > 0
          ? `<div style="font-size:12px; margin-top:3px;">✔ ${stats.success} success · ${stats.alreadyClaimed} already claimed · ${stats.badPlayers} bad PID/state · ${stats.errors} errors</div>`
          : `<div style="font-size:12px; margin-top:3px; opacity:0.75;">First batch in flight — the game API allows 30 requests per minute.</div>`);
    }

    renderProgress("Redeeming");
    // Tick the timer while a batch is in flight so the UI doesn't look frozen.
    const ticker = setInterval(() => renderProgress("Redeeming"), 1000);

    while (true){
      const res = await apiPost("redeem_code", { code, adminpassword: pw, state, startIndex, limit: CHUNK });
      if (!res.ok){
        clearInterval(ticker);
        showBannerResult("giftCodeProgress", "Redemption failed: " + esc_(res.error || "unknown"), "error");
        return;
      }
      stats.success        += res.success || 0;
      stats.alreadyClaimed += res.alreadyClaimed || 0;
      stats.invalid        += res.invalid || 0;
      stats.expired        += res.expired || 0;
      stats.errors         += res.errors || 0;
      stats.skipped        += res.skipped || 0;
      stats.badPlayers     += res.badPlayers || 0;
      total += res.total || 0;
      totalInRoster = res.totalInRoster || totalInRoster;
      (res.results || []).forEach(r => results.push(r));

      renderProgress("Redeeming");
      if (res.stoppedEarly){ stopped = res.stopReason; break; }
      if (res.nextIndex == null) break;
      startIndex = res.nextIndex;
    }
    clearInterval(ticker);

    // Build summary
    let banner = "";
    if (stopped === "invalid")      banner = `<div style="color:#8a1f1f; font-weight:700;">Code is invalid — stopped early.</div>`;
    else if (stopped === "expired") banner = `<div style="color:#8a1f1f; font-weight:700;">Code is expired — stopped early.</div>`;
    else                            banner = `<div style="font-weight:700;">Redemption complete.</div>`;

    let html = banner +
      `<div>Code: <b>${esc_(code)}</b> · Processed <b>${total}</b> of <b>${totalInRoster}</b></div>` +
      `<div style="margin-top:4px;">` +
      `<span style="color:#2a8e4d;">✔ Success: <b>${stats.success}</b></span> · ` +
      `<span>Already claimed: <b>${stats.alreadyClaimed}</b></span> · ` +
      `<span>Skipped (prior run): <b>${stats.skipped}</b></span> · ` +
      `<span style="color:#a00;">Bad PID/state: <b>${stats.badPlayers}</b></span> · ` +
      `<span style="color:#a00;">Errors: <b>${stats.errors}</b></span>` +
      `</div>`;

    if (stats.badPlayers){
      html += `<div style="margin-top:6px; font-size:12px;">“Bad PID/state” means the game refused that player in state <b>${esc_(state)}</b>. ` +
              `They were retried once after a pause, so this is most likely a wrong PID or a player who transferred to another state.</div>`;
    }

    // Show errors inline
    const errRows = results.filter(r => r.result !== "SUCCESS" && r.result !== "ALREADY_CLAIMED" && r.result !== "SKIPPED");
    errRows.forEach(r => { if (r.state) r.name = (r.name || "") + " (state " + r.state + ")"; });
    if (errRows.length){
      html += `<details style="margin-top:6px;"><summary style="cursor:pointer;">Show ${errRows.length} issue(s)</summary>` +
              `<div style="font-size:12px; margin-top:4px; max-height:200px; overflow:auto;">` +
              errRows.map(r => `<div>• <b>${esc_(r.pid)}</b> ${esc_(r.name||'')}: ${esc_(r.result)} — ${esc_(r.message||'')}</div>`).join("") +
              `</div></details>`;
    }
    showBannerResult("giftCodeProgress", html, stopped ? "error" : "ok");

    // Refresh history table
    refreshGiftCodesTable();
  }

  async function checkWikiForNewCodes(){
    const msg = document.getElementById("giftCodeMsg");
    msg.style.color = "#555"; msg.textContent = "Checking wiki…";
    const res = await apiGet({ view: "check_wiki_codes" });
    // The POST-style action wouldn't need auth either, but wiring via action=check_wiki_codes keeps it simple:
    const r2 = await apiPost("check_wiki_codes", {});
    const data = r2.ok ? r2 : res;
    if (!data || !data.ok){
      msg.style.color = "#a00"; msg.textContent = "Wiki check failed: " + ((data && data.error) || "unknown");
      return;
    }
    const codes = data.codes || [];
    if (codes.length === 0){
      msg.style.color = "#555"; msg.textContent = "Wiki returned no codes (page may have changed layout).";
      return;
    }
    msg.style.color = "#2a8e4d";
    msg.textContent = `Found ${codes.length} active code(s) on wiki: ${codes.join(", ")}. Paste one above to redeem.`;
  }

  async function refreshGiftCodesTable(){
    const host = document.getElementById("giftCodesHistory");
    host.innerHTML = `<div class="small" style="color:var(--text-dim);">Loading history…</div>`;
    const res = await apiGet({ view: "gift_codes" });
    if (!res.ok){ host.innerHTML = `<div class="small" style="color:#a00;">Failed to load: ${esc_(res.error || 'unknown')}</div>`; return; }
    const codes = res.codes || [];
    if (codes.length === 0){
      host.innerHTML = `<div class="small" style="color:var(--text-dim);">No gift codes tried yet. Paste one above or wait for the daily auto-check.</div>`;
      return;
    }
    const fmt = v => {
      if (!v) return "";
      const d = new Date(v);
      if (isNaN(d.getTime())) return esc_(String(v));
      return d.toLocaleString(undefined, { month:'short', day:'numeric', year:'numeric', hour:'2-digit', minute:'2-digit' });
    };
    const statusChip = s => {
      const v = String(s || "active").toLowerCase();
      const map = {
        active:   { bg:'#3d8bd6', fg:'#fff', label:'Active' },
        complete: { bg:'#2a8e4d', fg:'#fff', label:'Complete' },
        invalid:  { bg:'#a00',    fg:'#fff', label:'Invalid' },
        expired:  { bg:'#777',    fg:'#fff', label:'Expired' }
      };
      const c = map[v] || map.active;
      return `<span style="background:${c.bg}; color:${c.fg}; padding:2px 8px; border-radius:10px; font-size:11px; font-weight:600;">${c.label}</span>`;
    };
    let html = `<table style="width:100%; border-collapse:collapse; font-size:13px;">` +
      `<thead><tr style="background:rgba(255,255,255,0.06); color:#cfd4e0;">` +
      `<th style="text-align:left; padding:6px 8px;">Code</th>` +
      `<th style="text-align:left; padding:6px 8px;">Status</th>` +
      `<th style="text-align:left; padding:6px 8px;">First Seen</th>` +
      `<th style="text-align:left; padding:6px 8px;">Last Tried</th>` +
      `<th style="text-align:left; padding:6px 8px;">Source</th>` +
      `<th style="text-align:right; padding:6px 8px;">✔</th>` +
      `<th style="text-align:right; padding:6px 8px;">Dup</th>` +
      `<th style="text-align:right; padding:6px 8px;">Err</th>` +
      `<th style="padding:6px 8px;"></th>` +
      `</tr></thead><tbody>`;
    codes.forEach(c => {
      html += `<tr style="border-top:1px solid rgba(255,255,255,0.08);">` +
        `<td style="padding:6px 8px; font-family:monospace; color:#eaeef6;"><b>${esc_(c.Code)}</b></td>` +
        `<td style="padding:6px 8px;">${statusChip(c.Status)}</td>` +
        `<td style="padding:6px 8px; color:var(--text-dim);">${fmt(c.FirstSeen)}</td>` +
        `<td style="padding:6px 8px; color:var(--text-dim);">${fmt(c.LastTried)}</td>` +
        `<td style="padding:6px 8px; color:var(--text-dim);">${esc_(c.Source || '')}</td>` +
        `<td style="padding:6px 8px; text-align:right; color:#38b464;"><b>${Number(c.Success)||0}</b></td>` +
        `<td style="padding:6px 8px; text-align:right; color:var(--text-dim);">${Number(c.AlreadyClaimed)||0}</td>` +
        `<td style="padding:6px 8px; text-align:right; color:#e05a5a;">${Number(c.Errors)||0}</td>` +
        `<td style="padding:6px 8px; text-align:right;">` +
          `<button class="subtle" style="font-size:11px; padding:3px 8px;" onclick="prefillCode('${esc_(c.Code).replace(/'/g,"&#39;")}')">Use</button>` +
        `</td>` +
        `</tr>`;
    });
    html += `</tbody></table>`;
    host.innerHTML = html;
  }

  function prefillCode(code){
    document.getElementById("giftCodeInput").value = code;
    document.getElementById("giftCodeInput").focus();
  }

  function clearForm(){
    FIELDS.forEach(f => {
      const el = document.getElementById(f);
      if (el) el.value = "";
    });
    setMsg("");
    updateSaveMode();
  }

  // View Profile: open the full profile page for the PID currently in the form.
  async function viewCurrentProfile(){
    const pidEl = document.getElementById("PID");
    const pid = pidEl ? normPid(pidEl.value) : "";
    if (!pid){ setMsg("Type or load a PID first."); return; }
    try {
      await showProfileForPid(pid);
    } catch (e) {
      setMsg("Could not open profile: " + e.message);
    }
  }

  // Retrieve: pull existing sheet data for the typed PID into the form,
  // so editing one field and clicking Update preserves everything else.
  function retrieveCurrentPid(){
    const pidEl = document.getElementById("PID");
    const pid = pidEl ? normPid(pidEl.value) : "";
    if (!pid){ setMsg("Type a PID first, then click Retrieve."); return; }
    const m = findMemberByPid(pid);
    if (!m){
      setMsg(`PID ${pid} is not in the roster yet. Fill the form to add them.`);
      return;
    }
    fillForm(m);
    setMsg(`Loaded saved data for ${m.Name || pid}. Edit any field and click Update.`);
  }

  function fillForm(m){
    const TROOP_FIELDS = { Type_Of_Infantry:"Infantry", Type_Of_Marksmen:"Marksmen", Type_Of_Lancers:"Lancers" };
    FIELDS.forEach(f => {
      const el = document.getElementById(f);
      if (!el) return;
      let v = (m[f] ?? "");

      // Troop-type fields: read tolerantly (Type_Of_* or legacy Helios_*) and
      // normalize legacy Yes/No into the new Regular/Helios options.
      if (TROOP_FIELDS[f]) {
        const raw = troopCell_(m, TROOP_FIELDS[f]);
        const t = troopTier_(raw); // "" | "na" | "regular" | "helios" | "exalted"
        if (t === "regular") v = "Regular";
        else if (t === "helios") v = "Helios";
        else if (t === "exalted") v = "Exalted";
        else v = ""; // blank or NA
      }

      // Treat "NA" as blank in the form for optional fields
      if (String(v).toUpperCase() === "NA") v = "";

      // Date inputs need yyyy-mm-dd format
      if (el.type === "date" && v){
        const d = (v instanceof Date) ? v : new Date(v);
        if (!isNaN(d.getTime())){
          const y = d.getFullYear();
          const mo = String(d.getMonth()+1).padStart(2,"0");
          const da = String(d.getDate()).padStart(2,"0");
          v = `${y}-${mo}-${da}`;
        } else {
          v = "";
        }
      }

      // For <select>, if the value isn't one of its options, add it so it displays
      if (el.tagName === "SELECT" && v !== "") {
        const opts = Array.from(el.options).map(o => o.value);
        if (!opts.includes(String(v))) {
          const opt = document.createElement("option");
          opt.value = String(v);
          opt.textContent = String(v);
          el.appendChild(opt);
        }
      }
      el.value = v;
    });
    updateSaveMode();
    refreshAvatarPreview();
  }

  // Smart save button: reflects whether current PID already exists in roster
  function findMemberByPid(pid){
    const p = normPid(pid);
    if (!p) return null;
    for (const m of currentList){
      if (normPid(m.PID) === p) return m;
    }
    return null;
  }

  function updateSaveMode(){
    const btn = document.getElementById("saveBtn");
    const hint = document.getElementById("saveMode");
    if (!btn) return;
    const pidEl = document.getElementById("PID");
    const pid = pidEl ? normPid(pidEl.value) : "";

    btn.classList.remove("mode-add", "mode-update");

    if (!pid){
      btn.textContent = "Add / Update";
      if (hint) hint.textContent = "";
      return;
    }

    const existing = findMemberByPid(pid);
    if (existing){
      const nm = (existing.Name || "").toString().trim() || "player";
      btn.textContent = `Update ${nm}`;
      btn.classList.add("mode-update");
      if (hint) hint.textContent = "(existing player — blanks keep current values)";
    } else {
      btn.textContent = "Add new player";
      btn.classList.add("mode-add");
      if (hint) hint.textContent = "(new player — blanks default to NA)";
    }
  }

  function readForm(){
    const obj = {};
    FIELDS.forEach(f => obj[f] = document.getElementById(f).value);
    // force PID trim
    obj["PID"] = (obj["PID"] || "").toString().trim();
    // The gift-code API requires a state/server number, so never save a blank one.
    obj["State"] = (obj["State"] || "").toString().replace(/[^0-9]/g, "").trim() || DEFAULT_STATE;
    return obj;
  }

  function renderTable(list){
    const tb = document.getElementById("tbody");
    tb.innerHTML = "";
    list.forEach(m => {
      const pid = normPid(m.PID);
      const isSelected = selectedPids.has(pid);
      const tr = document.createElement("tr");
      if (isSelected) tr.classList.add("selected");
      const starred = isSquad_(m);
      const canStar = roleAllows(currentRole(), "ADMIN");
      const starTitle = canStar
        ? (starred ? "In the SVS Squad — click to remove" : "Not in the SVS Squad — click to add")
        : (starred ? "In the SVS Squad" : "Not in the SVS Squad");
      tr.innerHTML = `
        <td class="sel-col"><input type="checkbox" class="rowSel" data-pid="${pid}" ${isSelected ? "checked" : ""}/></td>
        <td style="text-align:center;">
          <span class="squadStar" data-pid="${pid}"
                title="${starTitle}"
                style="font-size:16px; line-height:1; user-select:none;
                       color:${starred ? "#ffc83d" : "rgba(255,255,255,0.25)"};
                       cursor:${canStar ? "pointer" : "default"};">${starred ? "★" : "☆"}</span>
        </td>
        <td>${esc_(m.Name ?? "")}</td>
        <td>${esc_(m.PID ?? "")}</td>
        <td>${esc_(m.State ?? "")}</td>
        <td>${esc_(m.Alliance ?? "")}</td>
        <td>${esc_(m.City_FC_Level ?? "")}</td>
        <td>${tierBadge_(troopCell_(m, "Infantry"))}</td>
        <td>${esc_(m.Infantry_FC_Level ?? "")}</td>
        <td>${tierBadge_(troopCell_(m, "Marksmen"))}</td>
        <td>${esc_(m.Marksmen_FC_Level ?? "")}</td>
        <td>${tierBadge_(troopCell_(m, "Lancers"))}</td>
        <td>${esc_(m.Lancer_FC_Level ?? "")}</td>
        <td>${esc_(m.Game_Power ?? "")}</td>
      `;
      tr.style.cursor = "pointer";

      // Star toggles SVS Squad membership (ADMIN and MASTER only).
      const star = tr.querySelector(".squadStar");
      if (star){
        star.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!roleAllows(currentRole(), "ADMIN")){
            setMsg("Sign in as ADMIN or MASTER to change the SVS Squad.");
            openSignIn();
            return;
          }
          toggleSquad(normPid(m.PID), !starred);
        });
      }

      // Clicking the row (but not the checkbox or the star) opens the Player Profile
      tr.onclick = (e) => {
        if (e.target && (e.target.classList.contains("rowSel") || e.target.closest(".sel-col"))) return;
        if (e.target && e.target.classList.contains("squadStar")) return;
        const searchBox = document.getElementById("profileSearch");
        if (searchBox) searchBox.value = normPid(m.PID);
        setCardCollapsed("profile", false);   // open the Profile section if collapsed
        showProfileForPid(normPid(m.PID));
        const card = document.getElementById("profileBody");
        if (card && card.scrollIntoView) card.scrollIntoView({ behavior: "smooth", block: "start" });
      };

      // Hovering a row for a moment prefetches that player's profile so the
      // click feels instant. (Short delay = no request storm while scrolling.)
      let hoverTimer = null;
      tr.addEventListener("pointerenter", () => {
        hoverTimer = setTimeout(() => apiPrefetch({ view: "profile", pid: normPid(m.PID) }), 180);
      });
      tr.addEventListener("pointerleave", () => clearTimeout(hoverTimer));

      // Checkbox toggles selection set
      const cb = tr.querySelector(".rowSel");
      cb.addEventListener("click", (e) => e.stopPropagation());
      cb.addEventListener("change", (e) => {
        if (e.target.checked) selectedPids.add(pid);
        else selectedPids.delete(pid);
        tr.classList.toggle("selected", e.target.checked);
        updateSelCount();
        syncSelectAllBox();
      });

      tb.appendChild(tr);
    });
    updateSelCount();
    syncSelectAllBox();
  }

  // ---- SVS Squad star ----
  // Flips the SVS_Squad flag for one player, then patches the cached roster in
  // place so the star updates instantly without a full reload.
  async function toggleSquad(pid, next){
    setMsg(next ? "Adding to SVS Squad\u2026" : "Removing from SVS Squad\u2026");
    const r = await apiPost("svs_squad_toggle", { PID: pid, Squad: next });
    if (!r.ok){ setMsg("Error: " + (r.error || "unknown")); return; }

    const val = r.Squad ? "Yes" : "No";
    [sheetDefaultOrder, currentList, archiveList].forEach(arr => {
      if (!Array.isArray(arr)) return;
      arr.forEach(m => { if (normPid(m.PID) === normPid(pid)) m.SVS_Squad = val; });
    });

    applyTabAndFilters();
    setMsg(r.Squad ? "Added to SVS Squad." : "Removed from SVS Squad.");
  }

  function updateSelCount() {
    const el = document.getElementById("selCount");
    if (el) el.textContent = `${selectedPids.size} selected`;
  }

  function syncSelectAllBox() {
    const all = document.getElementById("selAll");
    if (!all) return;
    const boxes = document.querySelectorAll(".rowSel");
    if (boxes.length === 0) { all.checked = false; all.indeterminate = false; return; }
    const checked = Array.from(boxes).filter(b => b.checked).length;
    all.checked = (checked === boxes.length);
    all.indeterminate = (checked > 0 && checked < boxes.length);
  }

  function toggleSelectAll(master) {
    const boxes = document.querySelectorAll(".rowSel");
    boxes.forEach(b => {
      b.checked = master.checked;
      const pid = b.dataset.pid;
      if (master.checked) selectedPids.add(pid);
      else selectedPids.delete(pid);
      const tr = b.closest("tr");
      if (tr) tr.classList.toggle("selected", master.checked);
    });
    updateSelCount();
  }

  function clearSelection() {
    selectedPids.clear();
    document.querySelectorAll(".rowSel").forEach(b => b.checked = false);
    document.querySelectorAll("tbody tr.selected").forEach(tr => tr.classList.remove("selected"));
    const all = document.getElementById("selAll");
    if (all) { all.checked = false; all.indeterminate = false; }
    updateSelCount();
  }

  // Guard for gated actions. Takes the minimum role required:
  //   - "ADMIN"  for archive and all normal management actions
  //   - "MASTER" for destructive actions (delete player, delete event)
  // If the user isn't signed in at a high enough level, we prompt them to sign in.
  function requirePassword(actionLabel, minRole) {
    const need = minRole || "ADMIN";
    const role = currentRole();
    if (roleAllows(role, need)) return true;
    setMsg(`You must be signed in as ${need} to ${actionLabel}.`);
    openSignIn();
    return false;
  }

  function currentSession()
  {
    return loadSession();
  }

  function currentPlayerPid()
  {
    const s = loadSession();
    return s && s.role === 'PLAYER' ? normPid(s.playerPid) : '';
  }

  // "200" / "19:00" / "0200 utc" -> "0200 UTC" / "1900 UTC"
  function normUtc_(v)
  {
    const raw = String(v ?? "").trim().toUpperCase().replace(/UTC/g, "").replace(/[:\s]/g, "");
    if (!raw) return "";
    if (!/^\d{1,4}$/.test(raw)) return String(v).trim().toUpperCase();
    return raw.padStart(4, "0") + " UTC";
  }

  function isValidUtcTime(s)
  {
    return /^([01]\d|2[0-3])([0-5]\d)\sUTC$/.test(String(s || '').trim());
  }

  function validateEventTimes(type, payload)
  {
    ["Legion1Time","Legion2Time","EventTime"].forEach(k => { if (payload[k] !== undefined) payload[k] = normUtc_(payload[k]); });
    if (type === 'Canyon' || type === 'Foundry') 
    {
      if (!isValidUtcTime(payload.Legion1Time)) 
      {
        return 'Legion 1 Time must be in 24-hour UTC format, for example 1900 UTC.';
      }
      if (!isValidUtcTime(payload.Legion2Time)) 
      {
        return 'Legion 2 Time must be in 24-hour UTC format, for example 2100 UTC.';
      }
    } 
    else 
    {
      if (!isValidUtcTime(payload.EventTime)) 
      {
        return 'Event Time must be in 24-hour UTC format, for example 2000 UTC.';
      }
    } 
  return '';
}
  // Chunk size for bulk requests. Keeps each URL under Apps Script's ~10k char limit.
  // ~200 PIDs per batch is safe for 9-10 digit PIDs.
  const BULK_CHUNK_SIZE = 200;

  function chunk_(arr, size) {
    const out = [];
    for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
    return out;
  }

  async function bulkAction(action, label) {
    const pids = Array.from(selectedPids);
    if (pids.length === 0) { setMsg(`Select at least one player to ${label}.`); return; }

    const isDelete  = (action === "delete");
    const isRestore = (action === "restore");

    // Restore is reversible (just re-archive); archive/delete get the stern warning.
    const confirmMsg = isRestore
      ? `Restore ${pids.length} player(s) to the roster as TBD?`
      : `${label[0].toUpperCase() + label.slice(1)} ${pids.length} player(s)?\nThis cannot be undone from the site.`;
    if (!confirm(confirmMsg)) return;

    // Archive + restore are ADMIN; hard delete is MASTER only.
    const minRole = isDelete ? "MASTER" : "ADMIN";
    if (!requirePassword(label, minRole)) return;

    const bulkActionName = isDelete ? "delete_bulk" : (isRestore ? "restore_bulk" : "archive_bulk");
    const batches = chunk_(pids, BULK_CHUNK_SIZE);

    const started = performance.now();
    let processed = 0, success = 0, fail = 0;
    const errors = [];
    const notFoundAll = [];

    setMsg(`${label[0].toUpperCase() + label.slice(1)}ing ${pids.length} player(s) in ${batches.length} batch(es)...`);

    for (let i = 0; i < batches.length; i++) {
      const batch = batches[i];
      try {
        const res = await apiPost(bulkActionName, { PIDs: batch });
        if (res.ok) {
          const count = isDelete
            ? (res.rowsDeleted ?? res.totalRowsDeleted ?? batch.length)
            : (isRestore ? (res.restoredCount ?? 0) : (res.archivedCount ?? 0));
          success += count;
          if (Array.isArray(res.notFound)) notFoundAll.push(...res.notFound);
          if (Array.isArray(res.skipped) && res.skipped.length) {
            errors.push(`Already on roster (skipped): ${res.skipped.join(", ")}`);
          }
        } else {
          fail += batch.length;
          errors.push(`Batch ${i + 1}: ${res.error || "unknown"}`);
        }
      } catch (err) {
        fail += batch.length;
        errors.push(`Batch ${i + 1}: ${err.message}`);
      }
      processed += batch.length;
      if (batches.length > 1) {
        setMsg(`${label[0].toUpperCase() + label.slice(1)}ing... ${processed}/${pids.length}`);
      }
    }

    const secs = ((performance.now() - started) / 1000).toFixed(1);

    const parts = [`${label} complete in ${secs}s: ${success} succeeded`];
    if (fail)            parts.push(`${fail} failed`);
    if (notFoundAll.length) parts.push(`${notFoundAll.length} not found`);
    setMsg(parts.join(", ") + ".");

    const dbg = [];
    if (errors.length)      dbg.push("Errors:\n" + errors.join("\n"));
    if (notFoundAll.length) dbg.push("Not found PIDs:\n" + notFoundAll.join(", "));
    if (dbg.length) setDebug(dbg.join("\n\n"));

    clearSelection();

    // Restore moves rows Archive -> roster, so both lists are now stale.
    if (isRestore) archiveLoaded = false;
    await loadAll();
    // If we restored while viewing the Archive tab, refresh it so restored rows drop off.
    if (isRestore && activeTab === "ARCHIVE") { await setTab("ARCHIVE"); }
  }

  // Archive (ADMIN) is non-destructive; delete (MASTER only) is a hard delete.
  function deleteSelected()  { bulkAction("delete",  "delete");  }
  function archiveSelected() { bulkAction("archive", "archive"); }
  // Restore (ADMIN) moves archived players back onto the roster as TBD.
  function restoreSelected() { bulkAction("restore", "restore"); }

 async function loadAll(opts = {}) 
 {
  setMsg("Loading...");
  // Stale-while-revalidate: paint the last roster instantly, then swap in the
  // fresh one when it arrives. Pass {fresh:true} to skip the cache.
  const res = await apiGet({}, opts.fresh ? { cache: "network" } : {
    onFresh: fresh => { applyRoster_(fresh, true); }
  });
  if (!res.ok) return setMsg(res.error || "Error loading");
  applyRoster_(res, false);
}

 function applyRoster_(res, isBackgroundRefresh){
  // Always treat the sheet response as source of truth
  sheetDefaultOrder = res.members || [];

  // Archive cache is now stale — force a reload next time the Archive tab opens.
  archiveLoaded = false;
  archiveList = [];

  // Clear any previous column sort UI
  sortState.key = null;
  sortState.dir = 1;
  updateHeaderArrows();

  // Render through the tab + filter pipeline (honors the active tab).
  applyTabAndFilters();

  const note = res._fromCache ? (res._offline ? " (offline copy)" : " (cached \u2014 refreshing\u2026)")
             : (isBackgroundRefresh ? " (updated)" : "");
  setMsg(`Loaded ${sheetDefaultOrder.length} players.${note}`);
  updateSaveMode();
}


  async function upsert()
  {
    const data = readForm();
    if (!data.PID) return setMsg("PID is required.");

    if (!canEditPid(data.PID)) {
      setMsg("You can only edit your own profile.");
      openSignIn();
      return;
    }

    if (currentRole() === "PLAYER") {
      const lockedPid = currentPlayerPid();
      if (normPid(data.PID) !== lockedPid) {
        setMsg("Players cannot change PID.");
        return;
      }
    }

  setMsg("Saving...");
  // Debug: show exactly what we're sending
  setDebug({ sending: data });
  try{
    const res = await apiPost("upsert", data);
    // Debug: show what came back
    setDebug({ sending: data, response: res });

    if (!res.ok) {
      setMsg("Save failed: " + (res.error || "Unknown error"));
      return;
    }

    // Warn if the sheet is missing columns for some fields we sent
    if (res.warning) {
      setMsg(`⚠️ ${res.message || "Saved"} (PID ${data.PID}) — ${res.warning}`);
      setDebug(res.warning + "\n\nFix: add these columns as headers in Alliance_Data row 1 of your Google Sheet, then try again.");
    } else {
      setMsg(`✅ ${res.message || "Saved"} (PID ${data.PID})`);
    }
    await loadAll();

    // If a profile is open (or we just edited the profile player), refresh the profile too
    const pidToRefresh = currentProfilePid || normPid(data.PID);
    if (pidToRefresh){
      await showProfileForPid(pidToRefresh);
      // Scroll the profile back into view so the user sees the refreshed data
      document.getElementById("profileBody").scrollIntoView({ behavior: "smooth", block: "start" });
    }
  } catch (err){
    setMsg("Save failed (network): " + err.message);
    setDebug(String(err));
  }
}


  // Hard-delete a single player. MASTER only.
  async function deletePID(){
    const data = readForm();
    const pid = normPid(data.PID);
    if (!pid) return setMsg("PID is required to delete a player.");

    if (!requirePassword("delete a player", "MASTER")) return;

    if (!confirm(`Permanently delete player ${pid}?\nThis removes them from the roster and all related sheets and cannot be undone.`)) return;

    setMsg("Deleting...");
    try {
      const res = await apiPost("delete", { PID: pid });
      if (!res.ok) { setMsg("Delete failed: " + (res.error || "Unknown error")); return; }
      setMsg(`🗑️ Deleted player ${pid}.`);
      clearForm();
      await loadAll();
    } catch (err) {
      setMsg("Delete failed (network): " + err.message);
      setDebug(String(err));
    }
  }


 function resetToSheetOrder() 
 {
    loadAll();
    setMsg("✅ Reset to Google Sheet order.");
  }



  // ---------- Player Profile ----------
  function esc_(s){
    return String(s ?? "").replace(/[&<>"']/g, c => ({
      "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"
    }[c]));
  }

  function fmtDate_(v){
    if (!v) return "";
    const d = (v instanceof Date) ? v : new Date(v);
    if (isNaN(d.getTime())) return String(v);
    return d.toLocaleDateString();
  }

  function statusClass_(s){
    const v = String(s || "").toLowerCase();
    if (v === "attended" || v === "yes" || v === "present") return "status-attended";
    if (v === "missed" || v === "no" || v === "absent") return "status-missed";
    if (v === "not registered" || v === "notregistered") return "status-notreg";
    if (v === "not active" || v === "notactive") return "status-notactive";
    if (!v) return "status-other";
    return "status-other";
  }

  function ynBadge_(v){
    const s = String(v ?? "").trim();
    if (s.toLowerCase() === "yes") return `<span class="yes-badge">Yes</span>`;
    if (s.toLowerCase() === "no")  return `<span class="no-badge">No</span>`;
    if (!s || s.toUpperCase() === "NA") return `<span class="na-badge">—</span>`;
    return esc_(s);
  }

  // Badge for the troop tier columns (Regular / Helios / Exalted).
  // Old data may still say "Yes" (=Helios) or "No" (=Regular) until migrated.
  function tierBadge_(v){
    let s = String(v ?? "").trim();
    const low = s.toLowerCase();
    if (low === "yes") s = "Helios";
    else if (low === "no") s = "Regular";
    if (!s || s.toUpperCase() === "NA") return `<span class="na-badge">—</span>`;
    const key = s.toLowerCase();
    if (key === "exalted") return `<span class="tier-badge tier-exalted">Exalted</span>`;
    if (key === "helios")  return `<span class="tier-badge tier-helios">Helios</span>`;
    if (key === "regular") return `<span class="tier-badge tier-regular">Regular</span>`;
    return esc_(s);
  }

  function findMembersByQuery(q){
    const query = String(q || "").trim().toLowerCase();
    if (!query) return [];
    // First try exact PID match
    const exact = currentList.find(m => normPid(m.PID) === normPid(query));
    if (exact) return [exact];
    // Otherwise substring match on Name or PID
    return currentList.filter(m =>
      String(m.Name ?? "").toLowerCase().includes(query) ||
      String(m.PID ?? "").toLowerCase().includes(query)
    ).slice(0, 10);
  }

  // =========================================================================
  // HERO CATALOG — full SSR roster (Gen 1-16) + icon filenames
  // =========================================================================
  // (HERO_CATALOG / HERO_BY_ID are defined near the top from assets/heroes.js)
  const FACTION_COLORS = {
    Infantry: '#d64545',   // red
    Lancer:   '#3d8bd6',   // blue
    Marksman: '#4caf50'    // green
  };
  const MAX_STARS = 5;
  const MAX_WIDGET = 10;
  const MAX_SKILL = 5;

  // Summarize a hero row for display (stars, widget, skill icons)
  function heroSummary_(row){
    const s  = Math.max(0, Math.min(MAX_STARS,  Number(row.Stars) || 0));
    const w  = Math.max(0, Math.min(MAX_WIDGET, Number(row.WidgetLevel) || 0));
    const s1 = Math.max(0, Math.min(MAX_SKILL, Number(row.Skill1) || 0));
    const s2 = Math.max(0, Math.min(MAX_SKILL, Number(row.Skill2) || 0));
    const s3 = Math.max(0, Math.min(MAX_SKILL, Number(row.Skill3) || 0));
    const s4 = Math.max(0, Math.min(MAX_SKILL, Number(row.Skill4) || 0));
    const s5 = Math.max(0, Math.min(MAX_SKILL, Number(row.Skill5) || 0));
    const s6 = Math.max(0, Math.min(MAX_SKILL, Number(row.Skill6) || 0));
    return { stars: s, widget: w, skills: [s1, s2, s3, s4, s5, s6] };
  }

  // Is a hero at max everything? (used for "max only" filter + sort)
  function isMaxed_(row){
    const sum = heroSummary_(row);
    return sum.stars === MAX_STARS && sum.widget === MAX_WIDGET &&
           sum.skills.every(v => v === MAX_SKILL);
  }

  // Power score for sort — higher = closer to maxed
  function heroScore_(row){
    const s = heroSummary_(row);
    return s.stars*10 + s.widget*5 + s.skills.reduce((a,b)=>a+b,0);
  }

  // Skill cap derived from star count:
  //   0 stars → 0, 1★→2, 2★→3, 3★→4, 4-5★→5
  function skillCapForStars_(stars){
    const s = Math.max(0, Math.min(MAX_STARS, Number(stars) || 0));
    if (s === 0) return 0;
    if (s === 1) return 2;
    if (s === 2) return 3;
    if (s === 3) return 4;
    return MAX_SKILL; // 4 or 5 stars
  }

  async function loadProfile(){
    const q = document.getElementById("profileSearch").value.trim();
    const msg = document.getElementById("profileMsg");
    const suggest = document.getElementById("profileSuggestions");
    const body = document.getElementById("profileBody");
    suggest.innerHTML = "";
    if (!q){ msg.textContent = "Enter a PID or Name."; return; }

    const matches = findMembersByQuery(q);
    if (matches.length === 0){
      msg.textContent = "No matching player in the loaded roster.";
      body.innerHTML = "";
      return;
    }
    if (matches.length > 1){
      msg.textContent = `${matches.length} matches — pick one:`;
      suggest.innerHTML = matches.map(m =>
        `<button style="margin:2px 4px 2px 0" onclick="pickProfileMatch('${normPid(m.PID)}')">${esc_(m.Name)} (${esc_(m.PID)})</button>`
      ).join("");
      body.innerHTML = "";
      return;
    }
    await showProfileForPid(normPid(matches[0].PID));
  }

  async function pickProfileMatch(pid){
    document.getElementById("profileSearch").value = pid;
    document.getElementById("profileSuggestions").innerHTML = "";
    await showProfileForPid(pid);
  }

  async function showProfileForPid(pid){
    const msg = document.getElementById("profileMsg");
    const body = document.getElementById("profileBody");
    currentProfilePid = pid;
    msg.textContent = "Loading profile...";
    body.innerHTML = "";

    const show = p => {
      if (currentProfilePid !== pid) return;   // user already moved on
      msg.textContent = "";
      window._currentProfile = p;  // cache for hero editor
      body.innerHTML = renderProfile_(p);
    };
    const res = await apiGet({ view: "profile", pid }, { onFresh: show });
    if (!res.ok){
      msg.textContent = res.error || "Error loading profile.";
      return;
    }
    show(res);
  }

  function renderProfile_(p){
    const m = p.member || {};
    const events = Array.isArray(p.events) ? p.events : [];
    const canyon = Array.isArray(p.canyon) ? p.canyon : [];
    const foundry = Array.isArray(p.foundry) ? p.foundry : [];
    const heroes = Array.isArray(p.heroes) ? p.heroes : [];
    const playerHeroes = Array.isArray(p.player_heroes) ? p.player_heroes : [];

    // Header: avatar + name + PID + location
    const av = pickAvatar_(m);
    let avatarHtml;
    if (av){
      avatarHtml = `<img class="avatar" src="${heroImg_(av.hero)}" width="96" height="96" decoding="async" alt="${esc_(av.hero.name)}" onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'avatar avatar-placeholder',textContent:'👤'}))"/>`;
    } else {
      avatarHtml = `<div class="avatar avatar-placeholder">👤</div>`;
    }

    const locationLine = m.Location && String(m.Location).trim() && String(m.Location).toUpperCase() !== "NA"
      ? `<div class="small">📍 ${esc_(m.Location)}</div>`
      : "";

    const header = `
      <div class="profile-header">
        ${avatarHtml}
        <div class="profile-header-text">
          <h4>${esc_(m.Name) || "Unknown"}</h4>
          <div class="small">PID ${esc_(m.PID)}</div>
          ${locationLine}
        </div>
      </div>`;

    // Roster info block
    const fields = [
      ["Alliance",        esc_(m.Alliance || "")],
      ["Game Power",      esc_(m.Game_Power)],
      ["City FC Level",   esc_(m.City_FC_Level)],
      ["Foundry Power",   esc_(m.Foundry_Power)],
      ["Infantry Type",   tierBadge_(troopCell_(m, "Infantry"))],
      ["Infantry FC",     esc_(m.Infantry_FC_Level)],
      ["Marksmen Type",   tierBadge_(troopCell_(m, "Marksmen"))],
      ["Marksmen FC",     esc_(m.Marksmen_FC_Level)],
      ["Lancer Type",     tierBadge_(troopCell_(m, "Lancers"))],
      ["Lancer FC",       esc_(m.Lancer_FC_Level)],
      ["Gender",          esc_(m.Gender)],
      ["Location",        esc_(m.Location)],
      ["Avatar",          av ? esc_(av.hero.name) + (av.auto ? " (auto)" : "") : "—"],
      ["Join Date",       fmtDate_(m.JoinDate)],
      ["Leave Date",      fmtDate_(m.LeaveDate)],
    ];
    const roster = `
      ${header}
      <div class="profile-grid">
        ${fields.map(([k,v]) => `
          <div class="profile-field">
            <span class="profile-label">${esc_(k)}</span>
            <span class="profile-value">${v || "—"}</span>
          </div>`).join("")}
      </div>`;

    // Event history
    let eventsHtml;
    if (events.length === 0){
      eventsHtml = `<div class="profile-empty">No event attendance recorded.</div>`;
    } else {
      eventsHtml = `
        <table class="profile-table">
          <thead>
            <tr><th>Event</th><th>Date</th><th>Status</th><th>Notes</th></tr>
          </thead>
          <tbody>
            ${events.map(e => `
              <tr>
                <td>${esc_(e.event)}</td>
                <td>${fmtDate_(e.date)}</td>
                <td><span class="status-pill ${statusClass_(e.status)}">${esc_(e.status || "—")}</span></td>
                <td>${esc_(e.notes)}</td>
              </tr>`).join("")}
          </tbody>
        </table>`;
    }

    // Heroes roster (live, from Player_Heroes sheet)
    const heroesHtml = renderPlayerHeroes_(playerHeroes, m.PID);

    // Canyon & Foundry participation — computed from events list
    const canyonHtml  = participationHtml_(events, "Canyon");
    const foundryHtml = participationHtml_(events, "Foundry");

    return `
      ${roster}
      <div class="profile-sub-title">Event Attendance</div>
      ${eventsHtml}
      <div class="profile-sub-title" style="display:flex; justify-content:space-between; align-items:center;">
        <span>Heroes</span>
        <button class="hero-edit-btn" onclick="openHeroEditor('${esc_(m.PID)}')">✎ Edit Heroes</button>
      </div>
      ${heroesHtml}
      <div class="profile-sub-title">Canyon Participation</div>
      ${canyonHtml}
      <div class="profile-sub-title">Foundry Participation</div>
      ${foundryHtml}
    `;
  }

  function clearProfile(){
    document.getElementById("profileSearch").value = "";
    document.getElementById("profileMsg").textContent = "";
    document.getElementById("profileSuggestions").innerHTML = "";
    document.getElementById("profileBody").innerHTML = "";
    currentProfilePid = null;
  }

  // =========================================================================
  // PARTICIPATION STATS — Canyon / Foundry totals + attendance rate
  // =========================================================================
  function participationHtml_(events, type){
    // Filter to this event type. Only count rows where the player was registered
    // (so SVS prep/battle score rows won't skew things if they ever got tagged wrong).
    const mine = (events || []).filter(e =>
      String(e.event || "").toLowerCase() === type.toLowerCase() &&
      ["Attended", "No Show", "Registered"].includes(String(e.status || ""))
    );
    const total = mine.length;
    if (total === 0){
      return `<div class="profile-empty">No ${type} participation recorded yet.</div>`;
    }
    const attended  = mine.filter(e => e.status === "Attended").length;
    const missed    = mine.filter(e => e.status === "No Show").length;
    const pending   = total - attended - missed; // still Registered (event not yet past)
    const ratePct   = total > 0 ? Math.round((attended / total) * 100) : 0;

    return `
      <div class="participation-box">
        <div class="participation-stats">
          <div class="part-stat">
            <div class="part-stat-label">Registered</div>
            <div class="part-stat-value reg">${total}</div>
          </div>
          <div class="part-stat">
            <div class="part-stat-label">Attended</div>
            <div class="part-stat-value att">${attended}</div>
          </div>
          <div class="part-stat">
            <div class="part-stat-label">Missed</div>
            <div class="part-stat-value miss">${missed}</div>
          </div>
          ${pending > 0 ? `
          <div class="part-stat">
            <div class="part-stat-label">Pending</div>
            <div class="part-stat-value" style="color:var(--text-dim)">${pending}</div>
          </div>` : ""}
          <div class="part-stat">
            <div class="part-stat-label">Attendance Rate</div>
            <div class="part-stat-value rate">${ratePct}%</div>
          </div>
        </div>
        <div class="part-bar-wrap"><div class="part-bar" style="width:${ratePct}%"></div></div>
      </div>`;
  }

  // =========================================================================
  // PLAYER HEROES — profile grid + editor modal
  // =========================================================================

  // Render the Heroes section on the profile
  function renderPlayerHeroes_(rows, pid){
    // rows is an array of { HeroID, Stars, WidgetLevel, Skill1..4 }
    // Merge with HERO_CATALOG metadata so we can show icon + name + faction
    const tracked = rows.map(r => {
      const meta = HERO_BY_ID[String(r.HeroID || "").toLowerCase()];
      if (!meta) return null;
      return Object.assign({}, meta, r, heroSummary_(r));
    }).filter(Boolean);

    if (tracked.length === 0){
      return `<div class="profile-empty">No heroes tracked yet. Click “Edit Heroes” to add them.</div>`;
    }

    // Sort: maxed first, then by score desc, then by gen desc
    tracked.sort((a, b) => {
      const am = isMaxed_(a) ? 1 : 0, bm = isMaxed_(b) ? 1 : 0;
      if (am !== bm) return bm - am;
      const as = heroScore_(a), bs = heroScore_(b);
      if (as !== bs) return bs - as;
      return b.gen - a.gen;
    });

    const cards = tracked.map(h => heroCardHtml_(h)).join("");
    const maxCount = tracked.filter(isMaxed_).length;

    return `
      <div class="hero-toolbar">
        <div class="hero-filter-group" data-filter-group>
          <button class="hero-filter active" data-filter="max">Max Only (${maxCount})</button>
          <button class="hero-filter" data-filter="all">Show All (${tracked.length})</button>
          <button class="hero-filter" data-filter="Infantry"><span class="fdot" style="background:${FACTION_COLORS.Infantry}"></span>Infantry</button>
          <button class="hero-filter" data-filter="Lancer"><span class="fdot" style="background:${FACTION_COLORS.Lancer}"></span>Lancer</button>
          <button class="hero-filter" data-filter="Marksman"><span class="fdot" style="background:${FACTION_COLORS.Marksman}"></span>Marksman</button>
        </div>
      </div>
      <div id="heroGrid" class="hero-grid" data-default-filter="max">${cards}</div>
    `;
  }

  function heroCardHtml_(h){
    const s = heroSummary_(h);
    const maxed = isMaxed_(h);
    const color = FACTION_COLORS[h.faction] || '#888';
    const stars = "★".repeat(s.stars) + "☆".repeat(MAX_STARS - s.stars);
    const skillsPill = s.skills.map(v => `<span class="skill-cell ${v===MAX_SKILL?'skill-max':''}">${v}</span>`).join("");
    return `
      <div class="hero-card ${maxed?'hero-maxed':''} ${isGenUnlocked_(h.gen)?'':'hero-locked'}"
           data-faction="${h.faction}"
           data-maxed="${maxed?'1':'0'}"
           title="${esc_(h.name)} — Gen ${h.gen} ${h.faction}${isGenUnlocked_(h.gen)?'':' (locked)'}">
        <div class="hero-gen-badge" style="background:${color}">G${h.gen}</div>
        <div class="hero-icon-wrap" style="border-color:${color}">
          <img class="hero-icon" src="${heroImg_(h)}" alt="${esc_(h.name)}" width="68" height="68" loading="lazy" decoding="async"
               onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'hero-icon hero-icon-fallback',textContent:'${esc_(h.name[0])}'}))"/>
          ${maxed ? '<div class="hero-max-badge">MAX</div>' : ''}
        </div>
        <div class="hero-name">${esc_(h.name)}</div>
        <div class="hero-stars">${stars}</div>
        <div class="hero-stats">
          <div class="hero-widget">W<b>${s.widget}</b></div>
          <div class="hero-skills">${skillsPill}</div>
        </div>
      </div>`;
  }

  // Wire filter chips inside hero grid (delegated click)
  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".hero-filter");
    if (!btn) return;
    const group = btn.closest("[data-filter-group]");
    if (!group) return;
    group.querySelectorAll(".hero-filter").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const grid = document.getElementById("heroGrid");
    if (!grid) return;
    const f = btn.dataset.filter;
    grid.querySelectorAll(".hero-card").forEach(card => {
      let show = true;
      if (f === "max")           show = card.dataset.maxed === "1";
      else if (f === "all")      show = true;
      else                       show = card.dataset.faction === f;
      card.style.display = show ? "" : "none";
    });
  });

  // -------- Hero editor modal --------
  let heroEditorState = { pid: null, rows: {} }; // rows keyed by heroId

  async function openHeroEditor(pid){
    heroEditorState.pid = pid;
    heroEditorState.rows = {};
    // Seed from current profile if we have it cached
    const cached = window._currentProfile;
    if (cached && cached.member && normPid(cached.member.PID) === normPid(pid) && Array.isArray(cached.player_heroes)){
      cached.player_heroes.forEach(r => {
        const hid = String(r.HeroID || "").toLowerCase();
        if (hid) heroEditorState.rows[hid] = {
          Stars: Number(r.Stars)||0,
          WidgetLevel: Number(r.WidgetLevel)||0,
          Skill1: Number(r.Skill1)||0,
          Skill2: Number(r.Skill2)||0,
          Skill3: Number(r.Skill3)||0,
          Skill4: Number(r.Skill4)||0,
          Skill5: Number(r.Skill5)||0,
          Skill6: Number(r.Skill6)||0,
        };
      });
    }
    // Fresh pull in case the cache is stale
    try {
      const res = await apiGet({ view: "player_heroes", pid }, { cache: "network", acceptAge: 20000 });
      if (res.ok && Array.isArray(res.heroes)){
        res.heroes.forEach(r => {
          const hid = String(r.HeroID || "").toLowerCase();
          if (hid) heroEditorState.rows[hid] = {
            Stars: Number(r.Stars)||0,
            WidgetLevel: Number(r.WidgetLevel)||0,
            Skill1: Number(r.Skill1)||0,
            Skill2: Number(r.Skill2)||0,
            Skill3: Number(r.Skill3)||0,
            Skill4: Number(r.Skill4)||0,
            Skill5: Number(r.Skill5)||0,
            Skill6: Number(r.Skill6)||0,
          };
        });
      }
    } catch (e) { /* ignore, use cache */ }

    renderHeroEditor_();
    document.getElementById("heroEditorBackdrop").style.display = "flex";
  }

  function closeHeroEditor(){
    document.getElementById("heroEditorBackdrop").style.display = "none";
  }

  function renderHeroEditor_(){
    const body = document.getElementById("heroEditorBody");
    const title = document.getElementById("heroEditorTitle");
    const pid = heroEditorState.pid;
    const m = (currentList || []).find(x => normPid(x.PID) === normPid(pid));
    title.textContent = m ? `Edit Heroes — ${m.Name} (${m.PID})` : `Edit Heroes — PID ${pid}`;

    // Group by gen desc
    const byGen = {};
    HERO_CATALOG.forEach(h => { (byGen[h.gen] = byGen[h.gen] || []).push(h); });
    // Unlocked gens first (newest at top), locked gens after them, greyed out.
    const gens = Object.keys(byGen).map(Number).sort((a,b)=>{
      const la = !isGenUnlocked_(a), lb = !isGenUnlocked_(b);
      if (la !== lb) return la ? 1 : -1;
      return la ? a - b : b - a;
    });

    const lockNote = `<div class="he-gen-note">Your state is on <b>Gen ${ACTIVE_GEN}</b>. Gens ${ACTIVE_GEN + 1 <= HERO_MAX_GEN ? (ACTIVE_GEN + 1) + "\u2013" + HERO_MAX_GEN : "\u2014"} are shown greyed out until an Admin unlocks them.</div>`;
    body.innerHTML = (ACTIVE_GEN < HERO_MAX_GEN ? lockNote : "") + gens.map(gen => {
      const locked = !isGenUnlocked_(gen);
      const cards = byGen[gen].map(h => heroEditorRow_(h)).join("");
      return `
        <div class="hero-editor-gen ${locked ? "he-gen-locked" : ""}">
          <div class="hero-editor-gen-title">Generation ${gen}${locked ? ` <span class="he-lock-tag">\uD83D\uDD12 Gen ${gen} \u2013 locked</span>` : ""}</div>
          <div class="hero-editor-grid">${cards}</div>
        </div>`;
    }).join("");
  }

  function heroEditorRow_(h){
    const r = heroEditorState.rows[h.id] || {};
    const locked = !isGenUnlocked_(h.gen);
    const dis = locked ? "disabled" : "";
    const color = FACTION_COLORS[h.faction] || '#888';
    const tracked = (Number(r.Stars)||0) > 0 || (Number(r.WidgetLevel)||0) > 0 ||
                    (Number(r.Skill1)||0) > 0 || (Number(r.Skill2)||0) > 0 ||
                    (Number(r.Skill3)||0) > 0 || (Number(r.Skill4)||0) > 0 ||
                    (Number(r.Skill5)||0) > 0 || (Number(r.Skill6)||0) > 0;
    const cap = skillCapForStars_(r.Stars||0);
    const capNote = (r.Stars||0) > 0 ? `Skill cap for ${r.Stars||0}★ = ${cap}` : `Set stars to unlock skills`;
    return `
      <div class="hero-edit-card ${tracked?'he-tracked':''} ${locked?'he-locked':''}" data-hero-id="${h.id}">
        <div class="he-head" style="border-left-color:${color}">
          <img src="${heroImg_(h)}" alt="${esc_(h.name)}" class="he-icon" width="40" height="40" loading="lazy" decoding="async"
               onerror="this.replaceWith(Object.assign(document.createElement('div'),{className:'he-icon he-icon-fb',textContent:'${esc_(h.name[0])}'}))"/>
          <div>
            <div class="he-name">${esc_(h.name)}</div>
            <div class="he-sub">${h.faction} · Gen ${h.gen}</div>
          </div>
          <button class="he-max" ${dis} onclick="heroEditorQuickMax('${h.id}')" title="Set stars\u2605=5, widget=10, all 6 skills=5">MAX</button>
          <button class="he-clear" ${dis} onclick="heroEditorClear('${h.id}')" title="Clear / untrack">✕</button>
        </div>
        <div class="he-row">
          <label>Stars</label>
          <select ${dis} onchange="heroEditorSet('${h.id}','Stars',this.value)">${selectOptions_(0, MAX_STARS, r.Stars||0)}</select>
          <label>Widget</label>
          <select ${dis} onchange="heroEditorSet('${h.id}','WidgetLevel',this.value)">${selectOptions_(0, MAX_WIDGET, r.WidgetLevel||0)}</select>
        </div>
        <div class="he-cap-note">${capNote}</div>
        <div class="he-row he-skills">
          <label>S1</label>
          <select ${dis} onchange="heroEditorSet('${h.id}','Skill1',this.value)">${selectOptions_(0, MAX_SKILL, r.Skill1||0)}</select>
          <label>S2</label>
          <select ${dis} onchange="heroEditorSet('${h.id}','Skill2',this.value)">${selectOptions_(0, MAX_SKILL, r.Skill2||0)}</select>
          <label>S3</label>
          <select ${dis} onchange="heroEditorSet('${h.id}','Skill3',this.value)">${selectOptions_(0, MAX_SKILL, r.Skill3||0)}</select>
        </div>
        <div class="he-row he-skills">
          <label>S4</label>
          <select ${dis} onchange="heroEditorSet('${h.id}','Skill4',this.value)">${selectOptions_(0, MAX_SKILL, r.Skill4||0)}</select>
          <label>S5</label>
          <select ${dis} onchange="heroEditorSet('${h.id}','Skill5',this.value)">${selectOptions_(0, MAX_SKILL, r.Skill5||0)}</select>
          <label>S6</label>
          <select ${dis} onchange="heroEditorSet('${h.id}','Skill6',this.value)">${selectOptions_(0, MAX_SKILL, r.Skill6||0)}</select>
        </div>
      </div>`;
  }

  function selectOptions_(min, max, val){
    let out = "";
    for (let i = min; i <= max; i++){
      out += `<option value="${i}" ${Number(val)===i?'selected':''}>${i}</option>`;
    }
    return out;
  }

  function applyPlayerEditingState()
  {
    const pidEl = document.getElementById('PID');
    if (!pidEl) return;
    const s = currentSession();
    if (s && s.role === 'PLAYER') {
      // A player edits only their own record; the PID is fixed to their own and never editable.
      pidEl.value = s.playerPid || '';
      pidEl.readOnly = true;
      pidEl.disabled = true;
    } else {
      // ADMIN and MASTER may type a PID to add or look up a player. Note the backend
      // uses PID as the row key, so an "update" edits the matching row rather than
      // renaming it. Deleting a player is a separate MASTER-only action (Delete PID).
      pidEl.readOnly = false;
      pidEl.disabled = false;
    }
  }

  function heroLocked_(heroId){
    const h = HERO_BY_ID[heroId];
    return !!h && !isGenUnlocked_(h.gen);
  }

  function heroEditorSet(heroId, field, val){
    if (heroLocked_(heroId)) return;
    const row = heroEditorState.rows[heroId] || {};
    row[field] = Number(val) || 0;

    // Auto-apply skill cap based on stars:
    // 0★→0, 1★→2, 2★→3, 3★→4, 4-5★→5
    // Raising stars: bump all skills up to the new cap.
    // Lowering stars: clamp any skills above the new cap back down.
    if (field === "Stars"){
      const cap = skillCapForStars_(row.Stars);
      ["Skill1","Skill2","Skill3","Skill4","Skill5","Skill6"].forEach(k => {
        const cur = Number(row[k]) || 0;
        // Auto-set any skill that's lower than the cap up to the cap,
        // and clamp any skill that's higher than the cap down to it.
        if (cap === 0) row[k] = 0;
        else if (cur < cap) row[k] = cap;
        else if (cur > cap) row[k] = cap;
      });
      heroEditorState.rows[heroId] = row;
      renderHeroEditor_();
      return;
    }

    // For manual skill edits, clamp to the current star cap
    if (field.startsWith("Skill")){
      const cap = skillCapForStars_(row.Stars);
      if (Number(row[field]) > cap) row[field] = cap;
    }

    heroEditorState.rows[heroId] = row;
    const card = document.querySelector(`.hero-edit-card[data-hero-id="${heroId}"]`);
    if (card){
      const tracked = row.Stars>0 || row.WidgetLevel>0 || row.Skill1>0 || row.Skill2>0 || row.Skill3>0 || row.Skill4>0 || row.Skill5>0 || row.Skill6>0;
      card.classList.toggle("he-tracked", tracked);
    }
  }

  function heroEditorQuickMax(heroId){
    if (heroLocked_(heroId)) return;
    heroEditorState.rows[heroId] = {
      Stars: MAX_STARS, WidgetLevel: MAX_WIDGET,
      Skill1: MAX_SKILL, Skill2: MAX_SKILL, Skill3: MAX_SKILL,
      Skill4: MAX_SKILL, Skill5: MAX_SKILL, Skill6: MAX_SKILL
    };
    renderHeroEditor_();
  }

  function heroEditorClear(heroId){
    if (heroLocked_(heroId)) return;
    heroEditorState.rows[heroId] = { Stars:0, WidgetLevel:0, Skill1:0, Skill2:0, Skill3:0, Skill4:0, Skill5:0, Skill6:0 };
    renderHeroEditor_();
  }

  async function saveHeroEditor(){
    const msg = document.getElementById("heroEditorMsg");
    const pid = heroEditorState.pid;
    if (!pid) return;

    const role = currentRole();
    const ownPid = currentPlayerPid();
    // ADMIN can edit anyone's heroes; a PLAYER can only edit their own.
    const canEditOwnHeroes =
      roleAllows(role, 'ADMIN') || (role === 'PLAYER' && normPid(pid) === ownPid);

    if (!canEditOwnHeroes) 
    {
      msg.style.color = '#a00';
      msg.textContent = 'Sign in as ADMIN or with your own PID to update these heroes.';
      openSignIn();
      return;
    }

    // Build payload with only rows that are tracked OR were previously tracked (so we can delete)
    const heroes = Object.entries(heroEditorState.rows).map(([id, r]) => ({
      HeroID: id,
      Stars: Number(r.Stars)||0,
      WidgetLevel: Number(r.WidgetLevel)||0,
      Skill1: Number(r.Skill1)||0,
      Skill2: Number(r.Skill2)||0,
      Skill3: Number(r.Skill3)||0,
      Skill4: Number(r.Skill4)||0,
      Skill5: Number(r.Skill5)||0,
      Skill6: Number(r.Skill6)||0
    }));
    msg.style.color = "#888";
    msg.textContent = "Saving...";
    try {
      const res = await apiPost("player_heroes_save", { PID: pid, heroes });
      if (!res.ok){ msg.style.color = "#a00"; msg.textContent = res.error || "Save failed."; return; }
      msg.style.color = "#2a8e4d";
      msg.textContent = `Saved. Inserted ${res.inserted||0}, updated ${res.updated||0}, removed ${res.deleted||0}.`;
      // Refresh profile
      await showProfileForPid(pid);
      setTimeout(closeHeroEditor, 700);
    } catch (err){
      msg.style.color = "#a00";
      msg.textContent = String(err);
    }
  }

  function loadProfileIntoEditor(){
    if (!currentProfilePid){
      setMsg("Open a profile first.");
      return;
    }
    const m = currentList.find(x => normPid(x.PID) === normPid(currentProfilePid));
    if (!m){
      setMsg("Player not in loaded roster — click Load Players and try again.");
      return;
    }
    fillForm(m);
    setMsg(`Loaded ${m.Name || ""} (${m.PID}) into the editor.`);
    document.getElementById("PID").scrollIntoView({ behavior: "smooth", block: "center" });
  }

  // Allow Enter to submit in the profile search box
  document.addEventListener("DOMContentLoaded", () => {
    const ps = document.getElementById("profileSearch");
    if (ps){
      ps.addEventListener("keydown", (e) => {
        if (e.key === "Enter"){ e.preventDefault(); loadProfile(); }
      });
    }
  });

  // Keep the avatar preview next to the picker in sync
  function refreshAvatarPreview(){
    const inp = document.getElementById("Avatar");
    const img = document.getElementById("avatarPreviewImg");
    const lbl = document.getElementById("avatarPreviewLabel");
    if (!inp || !img || !lbl) return;
    const m = {
      PID: (document.getElementById("PID") || {}).value,
      Gender: (document.getElementById("Gender") || {}).value,
      Avatar: inp.value
    };
    const av = pickAvatar_(m);
    if (av){
      img.src = heroImg_(av.hero);
      img.style.display = "";
      lbl.textContent = av.hero.name + (av.auto ? " (auto)" : "");
    } else {
      img.style.display = "none";
      lbl.textContent = "(pick a hero or a Gender)";
    }
    // Keep the picker's selected ring in sync if it is open
    document.querySelectorAll("#avatarPickerGrid .ap-item").forEach(el => {
      el.classList.toggle("selected", el.dataset.id === avatarHeroId_(inp.value));
    });
  }

  // ---- Player icon picker: any released hero (gen <= active gen) ----
  function toggleAvatarPicker(force){
    const box = document.getElementById("avatarPicker");
    if (!box) return;
    const show = (typeof force === "boolean") ? force : box.hidden;
    box.hidden = !show;
    if (show) renderAvatarPicker();
  }

  function renderAvatarPicker(){
    const grid = document.getElementById("avatarPickerGrid");
    const note = document.getElementById("avatarPickerNote");
    if (!grid) return;
    const q = (document.getElementById("avatarPickerSearch")?.value || "").trim().toLowerCase();
    const current = avatarHeroId_(document.getElementById("Avatar")?.value);
    const list = ALL_HEROES.filter(h => !q || h.name.toLowerCase().includes(q) || String(h.gen) === q);

    // Group: unlocked gens (newest first), then Rare/Epic, then locked gens greyed out.
    const groups = {};
    list.forEach(h => { (groups[h.gen] = groups[h.gen] || []).push(h); });
    const gens = Object.keys(groups).map(Number).sort((a, b) => {
      const la = !isGenUnlocked_(a), lb = !isGenUnlocked_(b);
      if (la !== lb) return la ? 1 : -1;
      if (a === 0) return 1; if (b === 0) return -1;
      return b - a;
    });
    grid.innerHTML = gens.map(g => {
      const locked = !isGenUnlocked_(g);
      const title = g === 0 ? "Rare &amp; Epic" : `Gen ${g}${locked ? " \u2013 locked" : ""}`;
      const items = groups[g].map(h => `
        <button type="button" class="ap-item ${locked ? "locked" : ""} ${h.id === current ? "selected" : ""}"
                data-id="${h.id}" ${locked ? "disabled" : ""}
                title="${esc_(h.name)} \u2014 ${g === 0 ? h.rarity : "Gen " + g} ${h.faction}${locked ? " (not released in your state yet)" : ""}"
                onclick="pickAvatarHero('${h.id}')">
          <img src="${heroImg_(h)}" alt="" width="48" height="48" loading="lazy" decoding="async" />
          <span>${esc_(h.name)}</span>
        </button>`).join("");
      return `<div class="ap-group"><div class="ap-title">${title}</div><div class="ap-grid">${items}</div></div>`;
    }).join("") || '<div class="small">No heroes match.</div>';
    if (note) note.textContent = `Unlocked through Gen ${ACTIVE_GEN}. Greyed-out heroes unlock when an Admin raises the active gen.`;
  }

  function pickAvatarHero(id){
    const h = id ? HERO_BY_ID[id] : null;
    if (h && !isGenUnlocked_(h.gen)) return;
    const inp = document.getElementById("Avatar");
    if (!inp) return;
    // "auto" (not blank) so an Update clears a previous pick instead of keeping it.
    inp.value = h ? h.id : "auto";
    refreshAvatarPreview();
    if (h) toggleAvatarPicker(false);
  }

  // ==================== EVENTS ====================
  let EVENTS_CACHE = [];
  let CURRENT_EVENT = null; // { event, registrations, scores }

  // Color themes by event type (used by loadEvents + modals)
  const EVENT_THEMES = {
    Canyon:  { grad: "linear-gradient(135deg,#c97a1a,#7a3f00)", pill: { bg:"#ffe2bf", color:"#7a3f00" }, accent: "#c97a1a" },
    Foundry: { grad: "linear-gradient(135deg,#4b6fb0,#1f3a72)", pill: { bg:"#dce6ff", color:"#1f3a72" }, accent: "#4b6fb0" },
    SVS:     { grad: "linear-gradient(135deg,#b03a6b,#5a0f3a)", pill: { bg:"#ffd5e6", color:"#5a0f3a" }, accent: "#b03a6b" },
    _default:{ grad: "linear-gradient(135deg,#3e4a6b,#1e2538)", pill: { bg:"#d7e4ff", color:"#143a91" }, accent: "#4b6fb0" }
  };

  function esc(s){ return String(s ?? "").replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c])); }

  function fmtDate(iso){
    if (!iso) return "";
    const d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    return d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  }

  function computeStatus(ev){
    // Returns human-friendly status pill label + color class
    const raw = String(ev.Status || "").trim();
    if (raw === "Complete") return { label: "Complete", bg: "#cfe8d1", color: "#1a5b2a" };
    // SVS prep can be logged all week before any battle score exists.
    if (raw === "Prep In Progress") return { label: "Prep Logged", bg: "#e6dcff", color: "#41267a" };
    const now = new Date();
    // For SVS the meaningful deadline is battle day, not the prep start.
    const d = (ev.Type === "SVS" && ev.BattleDate) ? new Date(ev.BattleDate)
            : (ev.EventDate ? new Date(ev.EventDate) : null);
    if (d && !isNaN(d.getTime()) && d < now && d.toDateString() !== now.toDateString()){
      return ev.Type === "SVS"
        ? { label: "Awaiting Scores", bg: "#ffeccb", color: "#7a4a00" }
        : { label: "Awaiting Attendance", bg: "#ffeccb", color: "#7a4a00" };
    }
    return { label: "Upcoming", bg: "#d7e4ff", color: "#143a91" };
  }

  // Front-end guard for event actions. ADMIN (and MASTER) may create events and edit
  // event logs. Deleting an event is MASTER only. Backend enforces the same rules.
  function checkEventPassword(){
    const role = currentRole();
    if (roleAllows(role, "ADMIN")) return true;
    setMsg("You must be signed in as ADMIN to modify events.");
    openSignIn();
    return false;
  }

  // ---- Events list ----
  // loadEvents() fetches; renderEventsList() draws whatever the tab filter allows,
  // so switching tabs is instant and does not hit the API again.
  let activeEventTab = "ALL";   // ALL | Canyon | Foundry | SVS

  function setEventTab(tab){
    activeEventTab = tab;
    document.querySelectorAll("#eventTabs .tab-btn").forEach(b => {
      b.classList.toggle("active", b.dataset.etab === tab);
    });
    renderEventsList();
  }

  async function loadEvents(){
    const box = document.getElementById("eventsList");
    const msg = document.getElementById("eventsMsg");
    msg.textContent = "Loading events\u2026";
    box.innerHTML = "";
    const r = await apiGet({ view: "events_list" }, {
      onFresh: fresh => { EVENTS_CACHE = fresh.events || []; renderEventsList(); }
    });
    if (!r.ok){ msg.textContent = "Error: " + (r.error || ""); return; }
    EVENTS_CACHE = r.events || [];
    renderEventsList();
  }

  function renderEventsList(){
    const box = document.getElementById("eventsList");
    const msg = document.getElementById("eventsMsg");
    if (!box) return;

    const hideDone = !!document.getElementById("evtHideComplete")?.checked;
    let list = (EVENTS_CACHE || []).slice();
    if (activeEventTab !== "ALL") list = list.filter(ev => String(ev.Type || "") === activeEventTab);
    if (hideDone) list = list.filter(ev => computeStatus(ev).label !== "Complete");

    const totalTxt = (EVENTS_CACHE || []).length;
    msg.textContent = (list.length === totalTxt)
      ? `${totalTxt} event(s).`
      : `Showing ${list.length} of ${totalTxt} event(s).`;

    if (!list.length){
      box.innerHTML = '<div class="small" style="opacity:.7; padding:10px;">'
        + (totalTxt ? "No events match this filter." : "No events yet. Click \u201cLog New Event\u201d to create one.")
        + '</div>';
      return;
    }

    let html = '<table style="width:100%; border-collapse:collapse;"><thead><tr>'
      + '<th style="text-align:left; padding:6px; border-bottom:1px solid #333;">Type</th>'
      + '<th style="text-align:left; padding:6px; border-bottom:1px solid #333;">Date</th>'
      + '<th style="text-align:left; padding:6px; border-bottom:1px solid #333;">Time</th>'
      + '<th style="text-align:left; padding:6px; border-bottom:1px solid #333;">Status</th>'
      + '<th style="text-align:left; padding:6px; border-bottom:1px solid #333;">Notes</th>'
      + '<th style="padding:6px; border-bottom:1px solid #333;"></th>'
      + '</tr></thead><tbody>';

    list.forEach(ev => {
      const s = computeStatus(ev);
      const theme = EVENT_THEMES[ev.Type] || EVENT_THEMES._default;
      const pill = `<span style="display:inline-block; padding:2px 8px; border-radius:10px; background:${s.bg}; color:${s.color}; font-size:12px;">${esc(s.label)}</span>`;
      const typeBadge = `<span style="display:inline-block; padding:3px 10px; border-radius:10px; background:${theme.grad}; color:#fff; font-size:12px; font-weight:600;">${esc(ev.Type)}</span>`;
      let timeCell = esc(ev.EventTime || "");
      if (ev.Type === "Canyon" || ev.Type === "Foundry"){
        const l1 = esc(normUtc_(ev.Legion1Time)), l2 = esc(normUtc_(ev.Legion2Time));
        timeCell = `<div style="font-size:12px; line-height:1.4;"><b>L1:</b> ${l1 || "\u2014"}<br><b>L2:</b> ${l2 || "\u2014"}</div>`;
      }
      // SVS spans a week, so show the prep window and the battle day.
      let dateCell = esc(fmtDate(ev.EventDate));
      if (ev.Type === "SVS" && (ev.PrepStartDate || ev.BattleDate)){
        const prepFrom = esc(fmtDate(ev.PrepStartDate || ev.EventDate));
        const prepTo   = esc(fmtDate(ev.PrepEndDate || shiftIso_(ev.PrepStartDate || ev.EventDate, 4)));
        const bat      = ev.BattleDate ? esc(fmtDate(ev.BattleDate)) : "\u2014";
        dateCell = `<div style="font-size:12px; line-height:1.4;"><b>Prep:</b> ${prepFrom} \u2013 ${prepTo}<br><b>Battle:</b> ${bat}</div>`;
      }
      html += `<tr>`
        + `<td style="padding:6px; border-bottom:1px solid #222;">${typeBadge}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222;">${dateCell}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222;">${timeCell}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222;">${pill}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222;">${esc(ev.Notes || "")}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222; text-align:right; white-space:nowrap;">`
        +   `<button onclick="openEventViewer('${esc(ev.EventID)}')" onpointerenter="prefetchEventDetail('${esc(ev.EventID)}')" title="Read-only: who signed up and who showed">View</button> `
        +   `<button data-requires="ADMIN" onclick="openEventEditor('${esc(ev.EventID)}')" onpointerenter="prefetchEventDetail('${esc(ev.EventID)}')" title="Edit registrations, attendance or scores">Edit</button>`
        + `</td>`
        + `</tr>`;
    });
    html += '</tbody></table>';
    box.innerHTML = html;
    // Re-apply role visibility to the buttons we just injected.
    setRoleUI(currentRole());
  }

  function applyModalTheme(type){
    const t = EVENT_THEMES[type] || EVENT_THEMES._default;
    document.getElementById("eventModalHeader").style.background = t.grad;
    document.getElementById("eventModalType").textContent = type || "";
  }

  function openModal(title, bodyHtml, footerHtml, type){
    applyModalTheme(type);
    document.getElementById("eventModalTitle").textContent = title;
    document.getElementById("eventModalBody").innerHTML = bodyHtml;
    document.getElementById("eventModalFooter").innerHTML = footerHtml || "";
    document.getElementById("eventModalMsg").textContent = "";
    document.getElementById("eventModalBackdrop").style.display = "flex";
  }
  function closeEventModal(){
    document.getElementById("eventModalBackdrop").style.display = "none";
    CURRENT_EVENT = null;
  }
  function setModalMsg(t){ document.getElementById("eventModalMsg").textContent = t; }

  // ---- SVS leaderboard ----
  let SVS_LB_CACHE = [];

  async function loadSvsLeaderboard(){
    const msg = document.getElementById("svsLbMsg");
    msg.textContent = "Loading SVS history\u2026";
    const apply = x => {
      SVS_LB_CACHE = x.players || [];
      msg.textContent = `${x.totalSvsEvents || 0} SVS event(s) on record.`;
      renderSvsLeaderboard();
    };
    const r = await apiGet({ view: "svs_leaderboard" }, { onFresh: apply });
    if (!r.ok){ msg.textContent = "Error: " + (r.error || ""); return; }
    apply(r);
  }

  function renderSvsLeaderboard(){
    const box = document.getElementById("svsLbBox");
    if (!box) return;
    const squadOnly = !!document.getElementById("svsLbSquadOnly")?.checked;
    let rows = SVS_LB_CACHE.slice();
    if (squadOnly) rows = rows.filter(p => p.Squad);

    if (!rows.length){
      box.innerHTML = '<div class="small" style="opacity:.7; padding:10px;">'
        + (SVS_LB_CACHE.length ? "No starred players yet \u2014 click a \u2605 in the roster." : "Click \u201cLoad / Refresh\u201d to pull SVS history.")
        + '</div>';
      return;
    }

    const canStar = roleAllows(currentRole(), "ADMIN");
    const num = v => (v === null || v === undefined || v === "") ? "\u2014" : Number(v).toLocaleString(undefined,{maximumFractionDigits:0});

    let html = '<table style="width:100%; border-collapse:collapse; font-size:14px;"><thead><tr>'
      + ['\u2605','Name','Alliance','Participated','Avg Prep','Best Prep','Avg Battle','Best Battle','Last SVS']
          .map((h,i) => `<th style="text-align:${i<3?"left":"right"}; padding:6px; border-bottom:1px solid #333; white-space:nowrap;">${h}</th>`).join("")
      + '</tr></thead><tbody>';

    rows.forEach(p => {
      const rate = p.totalSvsEvents ? Math.round((p.eventsParticipated / p.totalSvsEvents) * 100) : 0;
      const rateColor = rate >= 80 ? "#2a8e4d" : (rate >= 50 ? "#b07d12" : "#a33");
      html += '<tr>'
        + `<td style="padding:6px; border-bottom:1px solid #222;">`
        +   `<span class="lbStar" data-pid="${esc(p.PID)}" title="${p.Squad ? "In the SVS Squad" : "Not in the SVS Squad"}"`
        +   ` style="color:${p.Squad ? "#ffc83d" : "rgba(255,255,255,0.25)"}; cursor:${canStar ? "pointer" : "default"};">`
        +   `${p.Squad ? "\u2605" : "\u2606"}</span></td>`
        + `<td style="padding:6px; border-bottom:1px solid #222;">${esc(p.Name || "")}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222; opacity:.8;">${esc(p.Alliance || "")}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222; text-align:right; color:${rateColor}; white-space:nowrap;">`
        +   `${p.eventsParticipated}/${p.totalSvsEvents} (${rate}%)</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222; text-align:right;">${num(p.avgPrep)}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222; text-align:right;">${num(p.bestPrep)}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222; text-align:right; font-weight:600;">${num(p.avgBattle)}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222; text-align:right;">${num(p.bestBattle)}</td>`
        + `<td style="padding:6px; border-bottom:1px solid #222; text-align:right; white-space:nowrap;">${esc(p.lastEventDate ? fmtDate(p.lastEventDate) : "\u2014")}</td>`
        + '</tr>';
    });
    html += '</tbody></table>';
    box.innerHTML = html;

    box.querySelectorAll(".lbStar").forEach(el => {
      el.addEventListener("click", async () => {
        if (!roleAllows(currentRole(), "ADMIN")){
          document.getElementById("svsLbMsg").textContent = "Sign in as ADMIN or MASTER to change the SVS Squad.";
          openSignIn();
          return;
        }
        const pid = el.getAttribute("data-pid");
        const entry = SVS_LB_CACHE.find(x => normPid(x.PID) === normPid(pid));
        const next = !(entry && entry.Squad);
        await toggleSquad(pid, next);
        if (entry) entry.Squad = next;
        renderSvsLeaderboard();
      });
    });
  }

  // ---- Date helpers for the SVS prep week ----
  // Dates are handled as plain YYYY-MM-DD strings so nothing shifts by a day
  // when the browser timezone differs from the sheet's.
  function shiftIso_(iso, days){
    if (!iso) return "";
    const parts = String(iso).slice(0,10).split("-").map(Number);
    const d = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
    if (isNaN(d.getTime())) return "";
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0,10);
  }

  function nextMondayIso_(){
    const now = new Date();
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
    const dow = d.getUTCDay();               // 0 = Sun, 1 = Mon
    const add = dow === 1 ? 0 : (8 - dow) % 7;
    d.setUTCDate(d.getUTCDate() + add);
    return d.toISOString().slice(0,10);
  }

  // Keep the battle day pinned to the Saturday of the chosen prep week.
  function syncSvsDates(){
    const start = document.getElementById("newPrepStart");
    const battle = document.getElementById("newBattleDate");
    if (!start || !battle || !start.value) return;
    battle.value = shiftIso_(start.value, 5);
  }

  // ---- New Event modal ----
  function openNewEventModal(){
    const today = new Date().toISOString().slice(0,10);
    // Default the SVS prep week to the next Monday (or today, if today is Monday).
    const nextMonday  = nextMondayIso_();
    const nextSaturday = shiftIso_(nextMonday, 5);
    const body = `
      <style>
        .evt-form label { display:block; font-size:13px; font-weight:600; color:#333; margin-bottom:4px; }
        .evt-form input, .evt-form select, .evt-form textarea {
          width:100%; padding:9px 10px; font-size:14px;
          border:1px solid #c8cad1; border-radius:7px;
          background:#fff; color:#111;
          box-sizing:border-box; transition:border-color 0.15s, box-shadow 0.15s;
        }
        .evt-form input:focus, .evt-form select:focus, .evt-form textarea:focus {
          outline:none; border-color:#4b6fb0; box-shadow:0 0 0 3px rgba(75,111,176,0.15);
        }
        .evt-form .field { background:#fafbfc; padding:12px; border-radius:8px; border:1px solid #eceef2; }
        .evt-grid2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; }
        .evt-hint { font-size:12px; color:#4b5563; margin-top:4px; font-weight:400; }
        .evt-type-preview {
          display:flex; gap:10px; margin-top:8px;
        }
        .evt-type-chip {
          flex:1; padding:10px; border-radius:8px; text-align:center; font-weight:600; font-size:13px;
          border:2px solid transparent; cursor:pointer; transition:all 0.15s;
          color:#fff; opacity:0.88;
        }
        .evt-type-chip.active { opacity:1; border-color:#111; transform:scale(1.03); }
        .evt-type-chip.canyon  { background:linear-gradient(135deg,#c97a1a,#7a3f00); }
        .evt-type-chip.foundry { background:linear-gradient(135deg,#4b6fb0,#1f3a72); }
        .evt-type-chip.svs     { background:linear-gradient(135deg,#b03a6b,#5a0f3a); }
      </style>
      <div class="evt-form" style="display:grid; gap:14px;">
        <div class="field">
          <label>Event Type</label>
          <div class="evt-type-preview">
            <div class="evt-type-chip canyon"  data-type="Canyon"  onclick="selectEventType('Canyon')">Canyon</div>
            <div class="evt-type-chip foundry" data-type="Foundry" onclick="selectEventType('Foundry')">Foundry</div>
            <div class="evt-type-chip svs"     data-type="SVS"     onclick="selectEventType('SVS')">SVS</div>
          </div>
          <input type="hidden" id="newEventType" value="" />
        </div>

        <div class="field" id="singleDateField">
          <label>Event Date</label>
          <input type="date" id="newEventDate" value="${today}" />
          <div class="evt-hint">When the event happens — used to remind you to mark attendance.</div>
        </div>

        <!-- SVS runs across a week: prep Mon–Fri, battle on Saturday -->
        <div id="svsDateField" style="display:none;">
          <div class="evt-grid2">
            <div class="field">
              <label>Prep Start (Monday)</label>
              <input type="date" id="newPrepStart" value="${nextMonday}" onchange="syncSvsDates()" />
              <div class="evt-hint">Prep runs Monday to Friday from this date.</div>
            </div>
            <div class="field">
              <label>Battle Day (Saturday)</label>
              <input type="date" id="newBattleDate" value="${nextSaturday}" />
              <div class="evt-hint">Filled in for you — change it if your battle lands elsewhere.</div>
            </div>
          </div>
        </div>

        <!-- Single time (for SVS) -->
        <div class="field" id="singleTimeField" style="display:none;">
          <label>Event Time</label>
          <input type="text" id="newEventTime" placeholder="e.g. 20:00 UTC" />
        </div>

        <!-- Split times (for Canyon / Foundry) -->
        <div id="splitTimeField" style="display:none;">
          <div class="evt-grid2">
            <div class="field">
              <label>Legion 1 Time</label>
              <select id="newLegion1Time" onchange="syncLegionSlots_('1')">
                <option value="1900 UTC">1900 UTC</option>
                <option value="0200 UTC">0200 UTC</option>
              </select>
            </div>
            <div class="field">
              <label>Legion 2 Time</label>
              <select id="newLegion2Time" onchange="syncLegionSlots_('2')">
                <option value="0200 UTC">0200 UTC</option>
                <option value="1900 UTC">1900 UTC</option>
              </select>
            </div>
          </div>
          <div class="evt-hint" id="newSlotHint">Times rotate each event &mdash; the last one is flipped for you.</div>
          <div class="evt-hint" id="newRegularsHint"></div>
        </div>

        <div class="field">
          <label>Notes (optional)</label>
          <textarea id="newEventNotes" rows="2" placeholder="Any relevant details…"></textarea>
        </div>
      </div>`;
    const footer = `
      <button onclick="closeEventModal()">Cancel</button>
      <button class="primary" onclick="createNewEvent()">Create Event</button>`;
    openModal("Log New Event", body, footer);
  }

  // Legion 1 / Legion 2 always take the two different slots.
  function syncLegionSlots_(changed){
    const a = document.getElementById("newLegion1Time"), b = document.getElementById("newLegion2Time");
    if (!a || !b) return;
    const other = v => v === "1900 UTC" ? "0200 UTC" : "1900 UTC";
    if (changed === "1") b.value = other(a.value); else a.value = other(b.value);
    updateNewEventRegularsHint_();
  }

  // Default the slots to the opposite of the last event of this type.
  function defaultLegionSlots_(type){
    const a = document.getElementById("newLegion1Time");
    if (!a) return;
    const last = (EVENTS_CACHE || [])
      .filter(ev => ev.Type === type && normUtc_(ev.Legion1Time))
      .sort((x, y) => new Date(y.EventDate) - new Date(x.EventDate))[0];
    const lastL1 = last ? normUtc_(last.Legion1Time) : "";
    a.value = lastL1 === "1900 UTC" ? "0200 UTC" : "1900 UTC";
    syncLegionSlots_("1");
    const hint = document.getElementById("newSlotHint");
    if (hint) hint.innerHTML = last
      ? `Last ${esc(type)} (${esc(fmtDate(last.EventDate))}) had Legion 1 at <b>${esc(lastL1)}</b>, so it is flipped for you. Change it if needed.`
      : "Pick which legion runs at each time.";
  }

  let _regularsForForm = null;
  async function updateNewEventRegularsHint_(){
    const el = document.getElementById("newRegularsHint");
    const type = document.getElementById("newEventType")?.value;
    if (!el || (type !== "Canyon" && type !== "Foundry")) { if (el) el.textContent = ""; return; }
    if (!_regularsForForm){
      const r = await apiGet({ view: "regulars" }, { cache: "network", acceptAge: 60000 });
      _regularsForForm = (r && r.ok) ? (r.regulars || []) : [];
    }
    const l1 = document.getElementById("newLegion1Time")?.value, l2 = document.getElementById("newLegion2Time")?.value;
    const regs = _regularsForForm.filter(x => x[type]);
    const n1 = regs.filter(x => x[type] === l1).length, n2 = regs.filter(x => x[type] === l2).length;
    el.innerHTML = regs.length
      ? `&#9733; <b>${n1 + n2}</b> ${esc(type)} regular(s) will be auto-registered: <b>${n1}</b> into Legion 1 (${esc(l1)}), <b>${n2}</b> into Legion 2 (${esc(l2)}).`
      : `No ${esc(type)} regulars set yet &mdash; use <b>&#9733; Regulars</b> on the Events card.`;
  }

  // Called by the type chips
  function selectEventType(t){
    document.getElementById("newEventType").value = t;
    document.querySelectorAll(".evt-type-chip").forEach(el => el.classList.toggle("active", el.getAttribute("data-type") === t));
    // Toggle time fields
    const isSplit = (t === "Canyon" || t === "Foundry");
    document.getElementById("splitTimeField").style.display  = isSplit ? "" : "none";
    document.getElementById("singleTimeField").style.display = isSplit ? "none" : "";
    if (isSplit){ _regularsForForm = null; defaultLegionSlots_(t); }
    // SVS uses a prep week + battle day instead of a single event date.
    const isSvs = (t === "SVS");
    document.getElementById("svsDateField").style.display    = isSvs ? "" : "none";
    document.getElementById("singleDateField").style.display = isSvs ? "none" : "";
    // Also re-theme the modal header to match
    applyModalTheme(t);
  }

  async function createNewEvent()
  {
    const type = document.getElementById('newEventType').value;
    const date = document.getElementById('newEventDate').value;
    const notes = document.getElementById('newEventNotes').value.trim();

    if (!type) return setModalMsg('Please pick an event type.');

    const payload = { Type: type, EventDate: date, Notes: notes };

    if (type === 'SVS') {
      const prepStart = document.getElementById('newPrepStart').value;
      const battle    = document.getElementById('newBattleDate').value;
      if (!prepStart) return setModalMsg('Please pick the Monday your prep week starts.');
      payload.PrepStartDate = prepStart;
      payload.PrepEndDate   = shiftIso_(prepStart, 4);
      payload.BattleDate    = battle || shiftIso_(prepStart, 5);
      payload.EventDate     = prepStart;   // keeps sorting/back-compat working
    } else if (!date) {
      return setModalMsg('Please pick a date.');
    }

    if (type === 'Canyon' || type === 'Foundry') {
      payload.Legion1Time = document.getElementById('newLegion1Time').value.trim().toUpperCase();
      payload.Legion2Time = document.getElementById('newLegion2Time').value.trim().toUpperCase();
    } else {
      payload.EventTime = document.getElementById('newEventTime').value.trim().toUpperCase();
    }

    const timeError = validateEventTimes(type, payload);
    if (timeError) return setModalMsg(timeError);

    if (!checkEventPassword()) return;
    setModalMsg('Creating…');

    const r = await apiPost('event_create', payload);
    if (!r.ok) return setModalMsg('Error: ' + r.error);

    await loadEvents();
    await openEventEditor(r.EventID);
    if (type === 'Canyon' || type === 'Foundry'){
      setModalMsg(r.autoRegistered
        ? `Event created. ${r.autoRegistered} regular(s) were auto-registered \u2014 untick anyone who did not sign up, then Save Registrations.`
        : 'Event created. No regulars matched these times.');
    }
  }

  // ---- Open editor for an existing event ----
  async function openEventEditor(eventId){
    setModalMsg("");
    // Editing: always use live data (a hover-prefetch < 20s old is fine).
    const r = await apiGet({ view: "event_detail", event_id: eventId }, { cache: "network", acceptAge: 20000 });
    if (!r.ok){ alert("Error: " + (r.error || "")); return; }
    CURRENT_EVENT = r;
    applyModalTheme(r.event.Type);
    if (r.event.Type === "SVS"){
      renderSvsEditor(r);
    } else {
      renderRegEditor(r);
    }
  }

  // ---- Read-only event viewer ----
  // Anyone (including VIEWER) can open this. It shows who was signed up and a
  // plain Yes/No for whether they showed, with no inputs and no save buttons.
  async function openEventViewer(eventId){
    setModalMsg("");
    // Names come from the roster. If it has not been loaded yet, pull it in
    // quietly so the view does not show a wall of bare PIDs.
    if (!Array.isArray(sheetDefaultOrder) || !sheetDefaultOrder.length){
      try { await loadAll(); } catch (e) {}
    }
    const r = await apiGet({ view: "event_detail", event_id: eventId });
    if (!r.ok){ alert("Error: " + (r.error || "")); return; }
    const ev = r.event;
    applyModalTheme(ev.Type);

    if (ev.Type === "SVS") { renderSvsViewer_(r); return; }
    renderRegViewer_(r);
  }

  // Canyon / Foundry: signed-up list split by legion, with attendance.
  function renderRegViewer_(detail){
    const ev = detail.event;
    const theme = EVENT_THEMES[ev.Type] || EVENT_THEMES._default;

    // Name lookup from whatever roster is loaded; falls back to the PID.
    const nameOf = pid => {
      const src = Array.isArray(sheetDefaultOrder) ? sheetDefaultOrder : [];
      const hit = src.find(m => normPid(m.PID) === normPid(pid));
      return (hit && hit.Name) ? hit.Name : "";
    };

    const regs = (detail.registrations || [])
      .filter(x => String(x.Legion || "").trim() !== "")
      .map(x => ({
        PID: x.PID,
        Name: nameOf(x.PID),
        Legion: String(x.Legion),
        // AttendedRaw blank means nobody has marked attendance yet.
        attRaw: (x.AttendedRaw === undefined ? "" : String(x.AttendedRaw).trim()),
        attended: !!x.Attended
      }))
      .sort((a,b) =>
        (a.Legion.localeCompare(b.Legion)) ||
        String(a.Name || "").localeCompare(String(b.Name || ""))
      );

    if (!regs.length){
      openModal(`${ev.Type} \u2014 ${fmtDate(ev.EventDate)}`,
        `<div class="small" style="padding:14px; opacity:.8;">Nobody is signed up for this event yet.</div>`,
        `<button onclick="closeEventModal()">Close</button>`, ev.Type);
      return;
    }

    const yes = regs.filter(r => r.attRaw !== "" && r.attended).length;
    const no  = regs.filter(r => r.attRaw !== "" && !r.attended).length;
    const unmarked = regs.filter(r => r.attRaw === "").length;

    const attCell = r => {
      if (r.attRaw === "") return '<span style="color:#8a8a8a;">Not marked</span>';
      return r.attended
        ? '<span style="color:#1a7f3c; font-weight:700;">Yes</span>'
        : '<span style="color:#a8232f; font-weight:700;">No</span>';
    };

    const rows = regs.map(r => `
      <tr data-legion="${esc(r.Legion)}" data-att="${r.attRaw === "" ? "unmarked" : (r.attended ? "yes" : "no")}">
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2;">${esc(r.Name || "\u2014")}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2; opacity:.7;">${esc(r.PID)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2; text-align:center;">
          <span style="display:inline-block; padding:2px 8px; border-radius:10px; font-size:12px;
                       background:${theme.pill.bg}; color:${theme.pill.color};">Legion ${esc(r.Legion)}</span>
        </td>
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2; text-align:center;">${attCell(r)}</td>
      </tr>`).join("");

    const l1 = regs.filter(r => r.Legion === "1").length;
    const l2 = regs.filter(r => r.Legion === "2").length;

    const body = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        ${viewerStat_("Signed up", regs.length, theme.accent, "regQuickFilter('','')")}
        ${viewerStat_("Legion 1", l1, theme.accent, "regQuickFilter('1','')")}
        ${viewerStat_("Legion 2", l2, theme.accent, "regQuickFilter('2','')")}
        ${viewerStat_("Showed up", yes, "#1a7f3c", "regQuickFilter('','yes')")}
        ${viewerStat_("No-shows", no, "#a8232f", "regQuickFilter('','no')")}
        ${unmarked ? viewerStat_("Not marked", unmarked, "#6b7280", "regQuickFilter('','unmarked')") : ""}
      </div>
      ${regFilterBarHtml_({ attendance: true, unregistered: false })}
      <div style="max-height:52vh; overflow:auto; border:1px solid #e3e3ea; border-radius:8px;">
        <table id="viewerTable" style="width:100%; border-collapse:collapse; font-size:14px;">
          <thead style="background:#f2f2f2; position:sticky; top:0;">
            <tr>
              <th style="padding:8px; text-align:left;">Name</th>
              <th style="padding:8px; text-align:left;">PID</th>
              <th style="padding:8px;">Legion</th>
              <th style="padding:8px;">Showed up</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="small" style="margin-top:8px; color:#555;">Read-only view. Use <b>Edit</b> to make changes.</div>`;

    openModal(`${ev.Type} \u2014 ${fmtDate(ev.EventDate)}`, body,
      `<button onclick="closeEventModal()">Close</button>`, ev.Type);
    applyRegFilters();
  }

  // SVS: who took part, and their prep / battle numbers.
  function renderSvsViewer_(detail){
    const ev = detail.event;
    const theme = EVENT_THEMES.SVS;

    const nameOf = pid => {
      const src = Array.isArray(sheetDefaultOrder) ? sheetDefaultOrder : [];
      const hit = src.find(m => normPid(m.PID) === normPid(pid));
      return (hit && hit.Name) ? hit.Name : "";
    };
    const isStar = pid => {
      const src = Array.isArray(sheetDefaultOrder) ? sheetDefaultOrder : [];
      const hit = src.find(m => normPid(m.PID) === normPid(pid));
      return hit ? isSquad_(hit) : false;
    };
    const num = v => {
      const n = (v === null || v === undefined || String(v).trim() === "" ||
                 String(v).trim().toUpperCase() === "NA") ? null : Number(String(v).replace(/,/g, ""));
      return (n === null || !isFinite(n)) ? '<span style="color:#8a8a8a;">\u2014</span>' : n.toLocaleString();
    };

    const scores = (detail.scores || [])
      .map(x => ({ ...x, Name: nameOf(x.PID), star: isStar(x.PID) }))
      .sort((a,b) => String(a.Name || "").localeCompare(String(b.Name || "")));

    if (!scores.length){
      openModal(`SVS \u2014 ${fmtDate(ev.PrepStartDate || ev.EventDate)}`,
        `<div class="small" style="padding:14px; opacity:.8;">No scores logged for this SVS yet.</div>`,
        `<button onclick="closeEventModal()">Close</button>`, "SVS");
      return;
    }

    const took = scores.filter(x => x.Participated === true).length;

    const rows = scores.map(x => `
      <tr data-took="${x.Participated === true ? "yes" : "no"}"
          data-battle="${esc(svsCellVal_(x.BattleScore))}" data-prep="${esc(svsCellVal_(x.PrepScore))}"
          data-name="${esc(String(x.Name || "").toLowerCase())}">
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2;">
          ${x.star ? '<span style="color:#d9a406;">\u2605</span> ' : ""}${esc(x.Name || "\u2014")}
        </td>
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2; opacity:.7;">${esc(x.PID)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2; text-align:center;">
          ${x.Participated === true
            ? '<span style="color:#1a7f3c; font-weight:700;">Yes</span>'
            : '<span style="color:#a8232f; font-weight:700;">No</span>'}
        </td>
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2; text-align:right;">${num(x.PrepScore)}</td>
        <td style="padding:6px 8px; border-bottom:1px solid #eceef2; text-align:right; font-weight:600;">${num(x.BattleScore)}</td>
      </tr>`).join("");

    const prepRange = (ev.PrepStartDate || ev.PrepEndDate)
      ? `${esc(fmtDate(ev.PrepStartDate))} \u2013 ${esc(fmtDate(ev.PrepEndDate))}`
      : esc(fmtDate(ev.EventDate));

    const body = `
      <div style="display:flex; gap:10px; flex-wrap:wrap; margin-bottom:12px;">
        ${viewerStat_("Prep week", prepRange, theme.accent)}
        ${viewerStat_("Battle day", ev.BattleDate ? esc(fmtDate(ev.BattleDate)) : "\u2014", theme.accent)}
        ${viewerStat_("Participated", `${took} of ${scores.length}`, "#1a7f3c", "svsQuickFilter('yes')")}
        ${viewerStat_("Did not", `${scores.length - took}`, "#a8232f", "svsQuickFilter('no')")}
      </div>
      ${svsFilterBarHtml_("viewerTable")}
      <div style="max-height:52vh; overflow:auto; border:1px solid #e3e3ea; border-radius:8px;">
        <table id="viewerTable" style="width:100%; border-collapse:collapse; font-size:14px;">
          <thead style="background:#f2f2f2; position:sticky; top:0;">
            <tr>
              <th style="padding:8px; text-align:left;">Name</th>
              <th style="padding:8px; text-align:left;">PID</th>
              <th style="padding:8px;">Participated</th>
              <th style="padding:8px; text-align:right;">Prep</th>
              <th style="padding:8px; text-align:right;">Battle</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
      <div class="small" style="margin-top:8px; color:#555;">Read-only view. Use <b>Edit</b> to log or change scores.</div>`;

    openModal(`SVS \u2014 ${fmtDate(ev.PrepStartDate || ev.EventDate)}`, body,
      `<button onclick="closeEventModal()">Close</button>`, "SVS");
    applySvsFilters();
  }

  // Small stat tile used by both viewers. Pass onclick to make it a quick filter.
  function viewerStat_(label, value, accent, onclick){
    const click = onclick ? ` onclick="${onclick}" role="button" tabindex="0" title="Click to filter" ` : "";
    return `<div class="viewer-stat${onclick ? " clickable" : ""}"${click} style="flex:1; min-width:110px; padding:8px 12px; border-radius:8px; background:#fff; border:1px solid ${accent};">
        <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:${accent};">${esc(label)}</div>
        <div style="font-size:15px; font-weight:700; color:#111;">${value}</div>
      </div>`;
  }

  // ======================================================================
  // EVENT FILTERS
  // Canyon / Foundry: name, PID, legion, attendance (no-shows)
  // SVS:              name, PID, participated, score range, missing score, sort
  // Works for both the read-only View modal and the Edit modal. In the Edit
  // modal the values are read live from the inputs, so filtering reflects
  // unsaved changes too.
  // ======================================================================
  function regFilterBarHtml_(opts){
    const o = Object.assign({ attendance: true, unregistered: false }, opts || {});
    return `
      <div class="evt-filters">
        <input id="regF_q" type="search" placeholder="Name or PID\u2026" oninput="applyRegFilters()" />
        <label>Legion
          <select id="regF_legion" onchange="applyRegFilters()">
            <option value="">All</option>
            <option value="1">Legion 1</option>
            <option value="2">Legion 2</option>
            ${o.unregistered ? '<option value="none">Not registered</option><option value="any">Registered (L1 + L2)</option>' : ""}
          </select>
        </label>
        ${o.attendance ? `<label>Attendance
          <select id="regF_att" onchange="applyRegFilters()">
            <option value="">All</option>
            <option value="yes">Showed up</option>
            <option value="no">No-shows</option>
            ${o.unregistered ? "" : '<option value="unmarked">Not marked</option>'}
          </select>
        </label>` : ""}
        ${o.regulars ? `<label>Regulars
          <select id="regF_regular" onchange="applyRegFilters()">
            <option value="">All</option>
            <option value="1">&#9733; Regulars only</option>
            <option value="0">Non-regulars</option>
          </select>
        </label>` : ""}
        <button type="button" onclick="clearRegFilters()">Clear</button>
        <span id="regF_count" class="small"></span>
      </div>`;
  }

  function regRowState_(tr){
    // Edit modal: read the live radio / checkbox. View modal: data attributes.
    const radio = tr.querySelector('input[type="radio"]:checked');
    const legion = radio ? radio.value : (tr.dataset.legion || "");
    const chk = tr.querySelector(".attChk");
    let att = tr.dataset.att || "";
    if (chk) att = chk.checked ? "yes" : "no";
    return { legion, att, text: tr.innerText.toLowerCase() };
  }

  function applyRegFilters(){
    const table = document.getElementById("regTable") || document.getElementById("viewerTable");
    if (!table) return;
    const q   = (document.getElementById("regF_q")?.value || "").trim().toLowerCase();
    const leg = document.getElementById("regF_legion")?.value || "";
    const att = document.getElementById("regF_att")?.value || "";
    const regular = document.getElementById("regF_regular")?.value || "";
    let shown = 0, total = 0;
    table.querySelectorAll("tbody tr").forEach(tr => {
      total++;
      const st = regRowState_(tr);
      let ok = !q || st.text.includes(q);
      if (ok && leg){
        if (leg === "none") ok = !st.legion;
        else if (leg === "any") ok = !!st.legion;
        else ok = st.legion === leg;
      }
      // Attendance only means something for registered players.
      if (ok && att) ok = !!st.legion && st.att === att;
      if (ok && regular) ok = (tr.dataset.regular || "0") === regular;
      tr.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    const c = document.getElementById("regF_count");
    if (c) c.textContent = (shown === total) ? `${total} player(s)` : `Showing ${shown} of ${total}`;
  }

  function clearRegFilters(){
    ["regF_q","regF_legion","regF_att","regF_regular"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    applyRegFilters();
  }

  function regQuickFilter(legion, att){
    const l = document.getElementById("regF_legion"); if (l) l.value = legion || "";
    const a = document.getElementById("regF_att");    if (a) a.value = att || "";
    applyRegFilters();
  }

  // Clean a score cell to a plain number string ("" when blank / NA).
  function svsCellVal_(v){
    const t = String(v ?? "").replace(/,/g, "").trim();
    if (t === "" || t.toUpperCase() === "NA") return "";
    const n = Number(t);
    return isFinite(n) ? String(n) : "";
  }

  function svsFilterBarHtml_(tableId){
    return `
      <div class="evt-filters" data-table="${tableId}">
        <input id="svsF_q" type="search" placeholder="Name or PID\u2026" oninput="applySvsFilters()" />
        <label>Participated
          <select id="svsF_took" onchange="applySvsFilters()">
            <option value="">All</option>
            <option value="yes">Yes</option>
            <option value="no">No</option>
          </select>
        </label>
        <label>Score
          <select id="svsF_field" onchange="applySvsFilters()">
            <option value="battle">Battle</option>
            <option value="prep">Prep total</option>
          </select>
        </label>
        <label>Has score
          <select id="svsF_has" onchange="applySvsFilters()">
            <option value="">Any</option>
            <option value="yes">Has score</option>
            <option value="no">Missing score</option>
          </select>
        </label>
        <label>Min <input id="svsF_min" type="number" placeholder="min" oninput="applySvsFilters()" style="width:110px;" /></label>
        <label>Max <input id="svsF_max" type="number" placeholder="max" oninput="applySvsFilters()" style="width:110px;" /></label>
        <label>Sort
          <select id="svsF_sort" onchange="applySvsFilters(true)">
            <option value="name">Name A\u2013Z</option>
            <option value="battle">Battle high \u2192 low</option>
            <option value="prep">Prep high \u2192 low</option>
          </select>
        </label>
        <button type="button" onclick="clearSvsFilters()">Clear</button>
        <span id="svsF_count" class="small"></span>
      </div>`;
  }

  function svsRowState_(tr){
    const num = v => { const t = String(v ?? "").trim(); if (t === "") return null; const n = Number(t); return isFinite(n) ? n : null; };
    const tookChk = tr.querySelector(".svsTook");
    if (tookChk){
      // Edit modal: live values
      const battle = num(tr.querySelector(".svsBattle")?.value);
      const prep = svsRecalcRow_(tr, true);
      return { took: tookChk.checked, battle, prep: (prep === null || !isFinite(prep)) ? null : prep,
               name: (tr.cells[0]?.innerText || "").toLowerCase(), text: tr.innerText.toLowerCase() };
    }
    return { took: tr.dataset.took === "yes", battle: num(tr.dataset.battle), prep: num(tr.dataset.prep),
             name: tr.dataset.name || "", text: tr.innerText.toLowerCase() };
  }

  function applySvsFilters(resort){
    const bar = document.querySelector(".evt-filters[data-table]");
    const table = document.getElementById(bar ? bar.dataset.table : "svsTable");
    if (!table) return;
    const q     = (document.getElementById("svsF_q")?.value || "").trim().toLowerCase();
    const took  = document.getElementById("svsF_took")?.value || "";
    const field = document.getElementById("svsF_field")?.value || "battle";
    const has   = document.getElementById("svsF_has")?.value || "";
    const minV  = document.getElementById("svsF_min")?.value;
    const maxV  = document.getElementById("svsF_max")?.value;
    const min = (minV === "" || minV == null) ? null : Number(minV);
    const max = (maxV === "" || maxV == null) ? null : Number(maxV);
    const tbody = table.querySelector("tbody");
    const rows = Array.from(tbody.querySelectorAll("tr"));
    let shown = 0;
    rows.forEach(tr => {
      const st = svsRowState_(tr);
      const v = field === "prep" ? st.prep : st.battle;
      let ok = !q || st.text.includes(q);
      if (ok && took) ok = (took === "yes") === st.took;
      if (ok && has)  ok = (has === "yes") ? v !== null : v === null;
      if (ok && min !== null) ok = v !== null && v >= min;
      if (ok && max !== null) ok = v !== null && v <= max;
      tr.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    if (resort){
      const sort = document.getElementById("svsF_sort")?.value || "name";
      const key = tr => svsRowState_(tr);
      rows.sort((a, b) => {
        const A = key(a), B = key(b);
        if (sort === "name") return A.name.localeCompare(B.name);
        const av = sort === "prep" ? A.prep : A.battle, bv = sort === "prep" ? B.prep : B.battle;
        if (av === null && bv === null) return A.name.localeCompare(B.name);
        if (av === null) return 1; if (bv === null) return -1;
        return bv - av;
      });
      rows.forEach(tr => tbody.appendChild(tr));
    }
    const c = document.getElementById("svsF_count");
    if (c) c.textContent = (shown === rows.length) ? `${rows.length} player(s)` : `Showing ${shown} of ${rows.length}`;
  }

  function clearSvsFilters(){
    ["svsF_q","svsF_took","svsF_has","svsF_min","svsF_max"].forEach(id => { const el = document.getElementById(id); if (el) el.value = ""; });
    const f = document.getElementById("svsF_field"); if (f) f.value = "battle";
    const so = document.getElementById("svsF_sort"); if (so) so.value = "name";
    applySvsFilters(true);
  }

  function svsQuickFilter(took){
    const t = document.getElementById("svsF_took"); if (t) t.value = took || "";
    applySvsFilters();
  }

  // Kept for backwards compatibility with any old inline handlers.
  function filterViewerTable(){ applyRegFilters(); applySvsFilters(); }

  // ---- Canyon / Foundry registration + attendance editor ----
  function renderRegEditor(detail){
    const ev = detail.event;
    const existing = {};
    (detail.registrations || []).forEach(x => { existing[normPid(x.PID)] = x; });

    // Canyon and Foundry are TBD-only events, so the editor lists TBD members
    // (plus anyone already registered for this event, even if they have since
    // moved out of TBD — otherwise saving would silently drop their row).
    // Built from the full roster, never the filtered table.
    const full = Array.isArray(sheetDefaultOrder) ? sheetDefaultOrder : [];
    const roster = full.filter(m => allianceGroup_(m) === "TBD" || existing[normPid(m.PID)]);
    if (!roster.length){
      openModal(`${ev.Type} — ${fmtDate(ev.EventDate)}`,
        '<div style="color:#a00;">Roster not loaded. Click “Load Players” first.</div>',
        `<button onclick="closeEventModal()">Close</button>`);
      return;
    }

    // Determine if attendance phase should be visible
    const now = new Date();
    const d = ev.EventDate ? new Date(ev.EventDate) : null;
    const pastEvent = d && !isNaN(d.getTime()) && d.toDateString() !== now.toDateString() && d < now;
    const showAttendance = pastEvent || String(ev.Status || "") === "Complete";

    // Regulars: stored by time slot, mapped onto whichever legion runs at that time.
    const evL1 = normUtc_(ev.Legion1Time), evL2 = normUtc_(ev.Legion2Time);
    const regSlot = {};
    (detail.regulars || []).forEach(x => { const slot = normUtc_(x[ev.Type]); if (slot) regSlot[normPid(x.PID)] = slot; });
    const slotLegion = slot => slot && slot === evL1 ? "1" : (slot && slot === evL2 ? "2" : "");
    const regCount = roster.filter(m => regSlot[normPid(m.PID)]).length;

    const rows = roster.slice().sort((a,b) => String(a.Name||"").localeCompare(String(b.Name||""))).map(m => {
      const ex = existing[normPid(m.PID)] || {};
      const inL1 = ex.Legion === "1";
      const inL2 = ex.Legion === "2";
      const att = ex.AttendedRaw === "" ? "yes" : (ex.Attended ? "yes" : "no");
      const slot = regSlot[normPid(m.PID)] || "";
      const slotLeg = slotLegion(slot);
      const regCell = slot
        ? `<span class="reg-badge" title="Regular for ${esc(ev.Type)} at ${esc(slot)}">&#9733; ${esc(slot.replace(" UTC",""))}${slotLeg ? " \u2192 L" + slotLeg : ""}</span>`
        : '<span style="opacity:.35;">\u2014</span>';
      return `
        <tr data-pid="${esc(m.PID)}" data-regular="${slot ? "1" : "0"}" data-regleg="${slotLeg}">
          <td style="padding:4px;">${esc(m.Name || "")}</td>
          <td style="padding:4px; opacity:.7;">${esc(m.PID)}</td>
          <td style="padding:4px; text-align:center;">${regCell}</td>
          <td style="padding:4px; text-align:center;"><input type="checkbox" class="regChk" title="Registered for this event \u2014 untick to remove" ${inL1 || inL2 ? "checked" : ""}/></td>
          <td style="padding:4px; text-align:center;"><input type="radio" name="leg-${esc(m.PID)}" value="1" ${inL1 ? "checked" : ""}/></td>
          <td style="padding:4px; text-align:center;"><input type="radio" name="leg-${esc(m.PID)}" value="2" ${inL2 ? "checked" : ""}/></td>
          ${showAttendance ? `<td style="padding:4px; text-align:center;"><input type="checkbox" class="attChk" ${att === "yes" ? "checked" : ""}/></td>` : ""}
        </tr>`;
    }).join("");

    const theme = EVENT_THEMES[ev.Type] || EVENT_THEMES._default;
    const l1Time = esc(normUtc_(ev.Legion1Time || ev.EventTime));
    const l2Time = esc(normUtc_(ev.Legion2Time || ev.EventTime));
    const body = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
        <div style="flex:1; min-width:180px; padding:10px 12px; border-radius:8px; background:#f7f7fa; border:1px solid #eceef2;">
          <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:#6b7280;">Date</div>
          <div style="font-size:15px; font-weight:600;">${esc(fmtDate(ev.EventDate))}</div>
        </div>
        <div style="flex:1; min-width:180px; padding:10px 12px; border-radius:8px; background:#fff; border:1px solid ${theme.accent};">
          <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:${theme.accent};">Legion 1 Time</div>
          <div style="font-size:15px; font-weight:600;">${l1Time || '<span style="opacity:.5;">—</span>'}</div>
        </div>
        <div style="flex:1; min-width:180px; padding:10px 12px; border-radius:8px; background:#fff; border:1px solid ${theme.accent};">
          <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:${theme.accent};">Legion 2 Time</div>
          <div style="font-size:15px; font-weight:600;">${l2Time || '<span style="opacity:.5;">—</span>'}</div>
        </div>
      </div>
      <div class="small" style="margin-bottom:8px; color:#555;">
        Tick <b>Registered</b> and pick <b>Legion 1</b> or <b>Legion 2</b>. Untick <b>Registered</b> to remove someone.
        <b>&#9733; Regulars</b> are added automatically when the event is created, into the legion running at their time.
        ${showAttendance ? '<br>Attendance defaults to <b>Yes</b> — uncheck no-shows.' : ""}
      </div>
      ${regFilterBarHtml_({ attendance: showAttendance, unregistered: true, regulars: true })}
      <div class="row" style="gap:8px; margin-bottom:8px; align-items:center;">
        <button type="button" class="subtle" onclick="regAddMissingRegulars()" title="Register every regular who is not on this event yet">&#9733; Add missing regulars (${regCount})</button>
        <span id="regSummary" class="small" style="color:#555;"></span>
      </div>
      <div style="max-height:50vh; overflow:auto; border:1px solid #e3e3ea; border-radius:8px;">
      <table id="regTable" style="width:100%; border-collapse:collapse; font-size:14px;">
        <thead style="background:#f2f2f2; position:sticky; top:0;">
          <tr>
            <th style="padding:8px; text-align:left;">Name</th>
            <th style="padding:8px; text-align:left;">PID</th>
            <th style="padding:8px;" title="Regular time slot for this event type">Regular</th>
            <th style="padding:8px;">Registered</th>
            <th style="padding:8px;">Legion 1<br><span style="font-weight:400; font-size:11px;">${l1Time || ""}</span></th>
            <th style="padding:8px;">Legion 2<br><span style="font-weight:400; font-size:11px;">${l2Time || ""}</span></th>
            ${showAttendance ? '<th style="padding:8px;">Attended</th>' : ""}
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>`;

    const footer = `
      <button onclick="closeEventModal()">Close</button>
      ${eventDeleteBtnHtml()}
      <button onclick="saveRegistrations()">Save Registrations</button>
      ${showAttendance ? '<button class="primary" onclick="saveAttendance()">Save Attendance</button>' : ""}`;

    openModal(`${ev.Type} — ${fmtDate(ev.EventDate)}`, body, footer, ev.Type);
    wireRegEditor_();
    applyRegFilters();
  }

  // ======================================================================
  // REGULARS MANAGER (Admin / Master)
  // A regular always plays Canyon and/or Foundry at the same UTC time.
  // Legion times rotate, so we store the TIME, and every new event puts the
  // regular into whichever legion runs at that time.
  // ======================================================================
  async function openRegularsModal(){
    if (!Array.isArray(sheetDefaultOrder) || !sheetDefaultOrder.length){
      try { await loadAll(); } catch (e) {}
    }
    setModalMsg("");
    openModal("\u2605 Canyon & Foundry Regulars", '<div class="small">Loading regulars\u2026</div>',
      `<button onclick="closeEventModal()">Close</button>`, "Canyon");
    const r = await apiGet({ view: "regulars" }, { cache: "network" });
    if (!r.ok){ setModalMsg("Error: " + (r.error || "Could not load regulars")); return; }
    const byPid = {};
    (r.regulars || []).forEach(x => { byPid[normPid(x.PID)] = x; });

    const full = Array.isArray(sheetDefaultOrder) ? sheetDefaultOrder : [];
    const roster = full.filter(m => allianceGroup_(m) === "TBD" || byPid[normPid(m.PID)])
      .sort((a, b) => String(a.Name || "").localeCompare(String(b.Name || "")));

    const sel = (cls, val) => `
      <select class="${cls}">
        <option value="" ${!val ? "selected" : ""}>\u2014 Not regular</option>
        <option value="1900 UTC" ${val === "1900 UTC" ? "selected" : ""}>1900 UTC</option>
        <option value="0200 UTC" ${val === "0200 UTC" ? "selected" : ""}>0200 UTC</option>
      </select>`;
    const rows = roster.map(m => {
      const x = byPid[normPid(m.PID)] || {};
      return `<tr data-pid="${esc(m.PID)}" data-name="${esc(m.Name || "")}">
        <td style="padding:4px 8px;">${esc(m.Name || "")}</td>
        <td style="padding:4px 8px; opacity:.7;">${esc(m.PID)}</td>
        <td style="padding:4px 8px; text-align:center;">${sel("rgCanyon", normUtc_(x.Canyon))}</td>
        <td style="padding:4px 8px; text-align:center;">${sel("rgFoundry", normUtc_(x.Foundry))}</td>
      </tr>`;
    }).join("");

    const body = `
      <div class="small" style="margin-bottom:8px; color:#555;">
        Pick the time each regular always plays. When a new Canyon or Foundry is created they are
        <b>registered automatically</b> into whichever legion runs at that time &mdash; you only confirm attendance,
        or untick anyone who did not sign up.
      </div>
      <div class="evt-filters">
        <input id="rgF_q" type="search" placeholder="Name or PID\u2026" oninput="filterRegularsTable()" />
        <label>Show
          <select id="rgF_show" onchange="filterRegularsTable()">
            <option value="">Everyone</option>
            <option value="any">Any regular</option>
            <option value="c1900">Canyon 1900</option>
            <option value="c0200">Canyon 0200</option>
            <option value="f1900">Foundry 1900</option>
            <option value="f0200">Foundry 0200</option>
            <option value="none">Not a regular</option>
          </select>
        </label>
        <button type="button" onclick="regularsCopyCanyonToFoundry()" title="For the players shown, set Foundry to the same time as Canyon">Copy Canyon \u2192 Foundry (shown)</button>
        <span id="rgF_count" class="small"></span>
      </div>
      <div style="max-height:55vh; overflow:auto; border:1px solid #e3e3ea; border-radius:8px;">
        <table id="regularsTable" style="width:100%; border-collapse:collapse; font-size:14px;">
          <thead style="background:#f2f2f2; position:sticky; top:0;">
            <tr><th style="padding:8px; text-align:left;">Name</th><th style="padding:8px; text-align:left;">PID</th>
                <th style="padding:8px;">Canyon</th><th style="padding:8px;">Foundry</th></tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>`;
    const footer = `
      <button onclick="closeEventModal()">Close</button>
      <button class="primary" onclick="saveRegulars()">Save Regulars</button>`;
    openModal("\u2605 Canyon & Foundry Regulars", body, footer, "Canyon");
    document.querySelectorAll("#regularsTable select").forEach(s => s.addEventListener("change", filterRegularsTable));
    filterRegularsTable();
  }

  function filterRegularsTable(){
    const q = (document.getElementById("rgF_q")?.value || "").trim().toLowerCase();
    const show = document.getElementById("rgF_show")?.value || "";
    let shown = 0, total = 0, regs = 0;
    document.querySelectorAll("#regularsTable tbody tr").forEach(tr => {
      total++;
      const c = tr.querySelector(".rgCanyon").value, f = tr.querySelector(".rgFoundry").value;
      if (c || f) regs++;
      let ok = !q || tr.innerText.toLowerCase().includes(q);
      if (ok && show){
        if (show === "any") ok = !!(c || f);
        else if (show === "none") ok = !c && !f;
        else {
          const want = show.slice(1) + " UTC";
          ok = (show[0] === "c" ? c : f) === want;
        }
      }
      tr.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    const el = document.getElementById("rgF_count");
    if (el) el.textContent = `${regs} regular(s) \u00b7 showing ${shown} of ${total}`;
  }

  function regularsCopyCanyonToFoundry(){
    let n = 0;
    document.querySelectorAll("#regularsTable tbody tr").forEach(tr => {
      if (tr.style.display === "none") return;
      const c = tr.querySelector(".rgCanyon").value, f = tr.querySelector(".rgFoundry");
      if (c && f.value !== c){ f.value = c; n++; }
    });
    filterRegularsTable();
    setModalMsg(n ? `Copied ${n} Canyon time(s) to Foundry. Click Save Regulars to keep it.` : "Nothing to copy.");
  }

  async function saveRegulars(){
    if (!checkEventPassword()) return;
    const list = [];
    document.querySelectorAll("#regularsTable tbody tr").forEach(tr => {
      const c = tr.querySelector(".rgCanyon").value, f = tr.querySelector(".rgFoundry").value;
      if (c || f) list.push({ PID: tr.dataset.pid, Name: tr.dataset.name, Canyon: c, Foundry: f });
    });
    setModalMsg(`Saving ${list.length} regular(s)\u2026`);
    const r = await apiPost("regulars_save", { Regulars: list });
    if (!r.ok){ setModalMsg("Error: " + (r.error || "")); return; }
    _regularsForForm = null;
    setModalMsg(`Saved ${r.count} regular(s). They will be auto-registered on the next Canyon / Foundry you create.`);
  }

  window.openRegularsModal = openRegularsModal;
  window.filterRegularsTable = filterRegularsTable;
  window.regularsCopyCanyonToFoundry = regularsCopyCanyonToFoundry;
  window.saveRegulars = saveRegulars;
  window.regAddMissingRegulars = regAddMissingRegulars;
  window.syncLegionSlots_ = syncLegionSlots_;

  // Registered checkbox <-> legion radios stay in sync.
  function wireRegEditor_(){
    document.querySelectorAll("#regTable tbody tr").forEach(tr => {
      const chk = tr.querySelector(".regChk");
      const radios = tr.querySelectorAll('input[type="radio"]');
      if (!chk) return;
      chk.addEventListener("change", () => {
        if (chk.checked){
          if (!tr.querySelector('input[type="radio"]:checked')){
            const leg = tr.dataset.regleg || "1";
            const r = tr.querySelector(`input[type="radio"][value="${leg}"]`);
            if (r) r.checked = true;
          }
        } else {
          radios.forEach(r => { r.checked = false; });
        }
        regUpdateSummary_();
      });
      radios.forEach(r => r.addEventListener("change", () => { chk.checked = true; regUpdateSummary_(); }));
      const att = tr.querySelector(".attChk");
      if (att) att.addEventListener("change", regUpdateSummary_);
    });
    regUpdateSummary_();
  }

  function regUpdateSummary_(){
    const box = document.getElementById("regSummary");
    if (!box) return;
    const rows = Array.from(document.querySelectorAll("#regTable tbody tr"));
    const reg = rows.filter(tr => tr.querySelector('input[type="radio"]:checked'));
    const l1 = reg.filter(tr => tr.querySelector('input[type="radio"]:checked').value === "1").length;
    const regs = reg.filter(tr => tr.dataset.regular === "1").length;
    const noShow = reg.filter(tr => tr.querySelector(".attChk") && !tr.querySelector(".attChk").checked).length;
    box.textContent = `${reg.length} registered (L1 ${l1} \u00b7 L2 ${reg.length - l1}) \u00b7 ${regs} regular(s)` + (document.querySelector("#regTable .attChk") ? ` \u00b7 ${noShow} no-show(s)` : "");
  }

  function regAddMissingRegulars(){
    let n = 0;
    document.querySelectorAll('#regTable tbody tr[data-regular="1"]').forEach(tr => {
      if (tr.querySelector('input[type="radio"]:checked')) return;
      const leg = tr.dataset.regleg || "1";
      const r = tr.querySelector(`input[type="radio"][value="${leg}"]`);
      if (r){ r.checked = true; tr.querySelector(".regChk").checked = true; n++; }
    });
    regUpdateSummary_();
    applyRegFilters();
    setModalMsg(n ? `Added ${n} regular(s). Click Save Registrations to keep it.` : "Every regular is already registered.");
  }

  function filterRegTable(){ applyRegFilters(); }

  async function saveRegistrations(){
    if (!CURRENT_EVENT) return;
    if (!checkEventPassword()) return;
    const regs = [];
    document.querySelectorAll("#regTable tbody tr").forEach(tr => {
      const pid = tr.getAttribute("data-pid");
      const legion = tr.querySelector(`input[name="leg-${pid}"]:checked`)?.value || "";
      if (!legion) return; // not registered
      const attChk = tr.querySelector(".attChk");
      const regObj = { PID: pid, Legion: legion, Registered: true };
      if (attChk) regObj.Attended = attChk.checked;
      regs.push(regObj);
    });
    setModalMsg(`Saving ${regs.length} registration(s)\u2026`);
    const r = await apiPost("registrations_save", { EventID: CURRENT_EVENT.event.EventID, Registrations: regs });
    if (!r.ok){ setModalMsg("Error: " + (r.error || "")); return; }
    setModalMsg(`Saved ${r.count} registration(s).`);
    await loadEvents();
  }

  async function saveAttendance(){
    if (!CURRENT_EVENT) return;
    if (!checkEventPassword()) return;
    const list = [];
    document.querySelectorAll("#regTable tbody tr").forEach(tr => {
      const pid = tr.getAttribute("data-pid");
      const legion = tr.querySelector(`input[name="leg-${pid}"]:checked`)?.value || "";
      if (!legion) return;
      const attChk = tr.querySelector(".attChk");
      if (!attChk) return;
      list.push({ PID: pid, Attended: attChk.checked });
    });
    setModalMsg(`Saving attendance for ${list.length} player(s)\u2026`);
    const r = await apiPost("attendance_save", { EventID: CURRENT_EVENT.event.EventID, Attendance: list });
    if (!r.ok){ setModalMsg("Error: " + (r.error || "")); return; }
    setModalMsg(`Updated ${r.updated} attendance row(s).`);
    await loadEvents();
  }

  // ---- SVS scores editor ----
  //
  // Prep runs Monday-Friday and can be logged two ways per player:
  //   Daily  -> five day boxes, total is calculated for you
  //   Total  -> one box for the whole prep week
  // Battle is the Saturday score. "Took part" separates a genuine zero from
  // a player who sat the SVS out entirely.
  //
  // IMPORTANT: this always builds from the FULL roster, never the filtered
  // table, and the backend merges by PID -- so saving can never wipe scores
  // for players who were not on screen.
  function renderSvsEditor(detail){
    const ev = detail.event;
    const existing = {};
    (detail.scores || []).forEach(x => { existing[normPid(x.PID)] = x; });

    const roster = svsRosterForEvent_(detail);
    if (!roster.length){
      openModal(`SVS \u2014 ${fmtDate(ev.PrepStartDate || ev.EventDate)}`,
        '<div style="color:#a00;">Roster not loaded. Click \u201cLoad Players\u201d first.</div>',
        `<button onclick="closeEventModal()">Close</button>`);
      return;
    }

    const DAY_KEYS = ["Prep_Mon","Prep_Tue","Prep_Wed","Prep_Thu","Prep_Fri"];
    const DAY_LABELS = ["Mon","Tue","Wed","Thu","Fri"];

    const rows = roster.slice()
      .sort((a,b) => String(a.Name||"").localeCompare(String(b.Name||"")))
      .map(m => {
        const ex = existing[normPid(m.PID)] || {};

        // Does this row have any per-day prep stored?
        const hasDaily = DAY_KEYS.some(k => svsCellVal_(ex[k]) !== "");
        const hasTotal = svsCellVal_(ex.PrepScore) !== "";
        const hasBattle = svsCellVal_(ex.BattleScore) !== "";

        // Mode: trust PrepMode when it is set. Rows saved before the daily
        // columns existed have a total but no days, so show them in Total mode
        // instead of dropping the number into a hidden field.
        const declared = String(ex.PrepMode || "").toLowerCase();
        let mode;
        if (declared === "total" || declared === "daily") mode = declared;
        else mode = (hasTotal && !hasDaily) ? "total" : "daily";
        if (mode === "daily" && !hasDaily && hasTotal) mode = "total";

        // Older rows have no Participated column. If a score was recorded at
        // all, they clearly took part.
        const took = (ex.Participated === true) || (ex.Participated === undefined && (hasTotal || hasBattle || hasDaily));

        // Remember whether this row started with data, so a genuine "clear it"
        // can be told apart from a row that was simply never filled in.
        const hadData = took || hasDaily || hasTotal || hasBattle;
        const star = isSquad_(m) ? '<span style="color:#ffc83d;">\u2605</span> ' : "";

        const dayInputs = DAY_KEYS.map((k, i) => {
          const v = svsCellVal_(ex[k]);
          return `<input class="svsDay" data-day="${k}" type="number" value="${esc(v)}"
                         title="${DAY_LABELS[i]} prep"
                         placeholder="${DAY_LABELS[i]}"
                         style="width:78px; padding:4px;" />`;
        }).join(" ");

        const totalVal = svsCellVal_(ex.PrepScore);

        return `
          <tr data-pid="${esc(m.PID)}" data-mode="${mode}" data-had="${hadData ? "1" : "0"}" data-squad="${isSquad_(m) ? "1" : "0"}">
            <td style="padding:6px; white-space:nowrap;">${star}${esc(m.Name || "")}</td>
            <td style="padding:6px; opacity:.7; white-space:nowrap;">${esc(m.PID)}</td>
            <td style="padding:6px; text-align:center;">
              <label class="svs-took-lbl" title="Participated in battle (score optional)">
                <input type="checkbox" class="svsTook" ${took ? "checked" : ""} />
                <span class="svs-took-txt">${took ? "Yes" : "No"}</span>
              </label>
            </td>
            <td style="padding:6px;">
              <label class="small" style="display:flex; gap:6px; align-items:center; white-space:nowrap;">
                <input type="checkbox" class="svsTotalMode" ${mode === "total" ? "checked" : ""} />
                Total only
              </label>
            </td>
            <td style="padding:6px;">
              <div class="svsDaily" style="display:${mode === "total" ? "none" : "flex"}; gap:4px; flex-wrap:wrap;">
                ${dayInputs}
              </div>
              <div class="svsTotalWrap" style="display:${mode === "total" ? "block" : "none"};">
                <input class="svsPrepTotal" type="number" value="${esc(totalVal)}" placeholder="Prep total"
                       style="width:130px; padding:4px;" />
              </div>
            </td>
            <td style="padding:6px; text-align:right; white-space:nowrap;">
              <span class="svsPrepCalc" style="font-weight:600;">\u2014</span>
            </td>
            <td style="padding:6px;">
              <input class="svsBattle" type="number" value="${esc(svsCellVal_(ex.BattleScore))}" placeholder="NA"
                     style="width:120px; padding:4px;" />
            </td>
          </tr>`;
      }).join("");

    const prepRange = (ev.PrepStartDate || ev.PrepEndDate)
      ? `${esc(fmtDate(ev.PrepStartDate))} \u2013 ${esc(fmtDate(ev.PrepEndDate))}`
      : esc(fmtDate(ev.EventDate));
    const battleTxt = ev.BattleDate ? esc(fmtDate(ev.BattleDate)) : '<span style="opacity:.5;">not set</span>';
    const theme = EVENT_THEMES.SVS;

    const body = `
      <div style="display:flex; gap:12px; flex-wrap:wrap; margin-bottom:12px;">
        <div style="flex:1; min-width:200px; padding:10px 12px; border-radius:8px; background:#fff; border:1px solid ${theme.accent};">
          <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:${theme.accent};">Prep Week (Mon\u2013Fri)</div>
          <div style="font-size:15px; font-weight:600;">${prepRange}</div>
        </div>
        <div style="flex:1; min-width:200px; padding:10px 12px; border-radius:8px; background:#fff; border:1px solid ${theme.accent};">
          <div style="font-size:11px; letter-spacing:1px; text-transform:uppercase; color:${theme.accent};">Battle Day (Sat)</div>
          <div style="font-size:15px; font-weight:600;">${battleTxt}</div>
        </div>
      </div>
      <div class="small" style="margin-bottom:8px; color:#555;">
        Tick <b>Participated</b> for everyone who joined the battle &mdash; <b>with or without a score</b>.
        Typing any score ticks it for you automatically. Log prep day by day and the total is worked out for you,
        or tick <b>Total only</b> to enter one number for the week. Blank scores stay as NA.
      </div>
      ${svsFilterBarHtml_("svsTable")}
      <div class="row" style="gap:8px; margin-bottom:8px;">
        <button type="button" class="subtle" onclick="svsCheckAllVisible(true)">Mark all shown: Participated</button>
        <button type="button" class="subtle" onclick="svsCheckAllVisible(false)">Clear all shown</button>
        <button type="button" class="subtle" onclick="svsMarkSquadParticipated()" title="Tick Participated for every ★ SVS Squad player">Mark ★ Squad participated</button>
      </div>
      <div style="max-height:52vh; overflow:auto; border:1px solid #e3e3ea; border-radius:8px;">
      <table id="svsTable" style="width:100%; border-collapse:collapse; font-size:14px;">
        <thead style="background:#f2f2f2; position:sticky; top:0; z-index:1;">
          <tr>
            <th style="padding:8px; text-align:left;">Name</th>
            <th style="padding:8px; text-align:left;">PID</th>
            <th style="padding:8px;" title="Yes = took part in battle, even if no score was logged">Participated</th>
            <th style="padding:8px;">Entry</th>
            <th style="padding:8px; text-align:left;">Prep (Mon\u2013Fri)</th>
            <th style="padding:8px; text-align:right;">Prep total</th>
            <th style="padding:8px; text-align:left;">Battle</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      </div>
      <div id="svsSummary" class="small" style="margin-top:8px; color:#555;"></div>`;

    const footer = `
      <button onclick="closeEventModal()">Close</button>
      ${eventDeleteBtnHtml()}
      <button class="primary" onclick="saveSvsScores()">Save Scores</button>`;

    openModal(`SVS \u2014 ${fmtDate(ev.PrepStartDate || ev.EventDate)}`, body, footer, "SVS");
    wireSvsEditor_();
    applySvsFilters();
  }

  // Which players should the SVS editor list? SVS covers the whole database,
  // so this is the full roster plus anyone who already has a score row.
  function svsRosterForEvent_(detail){
    const full = Array.isArray(sheetDefaultOrder) ? sheetDefaultOrder.slice() : [];
    const seen = new Set(full.map(m => normPid(m.PID)));
    (detail.scores || []).forEach(sc => {
      const pid = normPid(sc.PID);
      if (pid && !seen.has(pid)){
        // Scored previously but no longer on the roster - keep them visible so
        // their score is not silently dropped on the next save.
        full.push({ PID: sc.PID, Name: "(not on roster)" });
        seen.add(pid);
      }
    });
    return full;
  }

  // Turn a stored score cell into something an <input type=number> accepts.
  function svsCellVal_(v){
    if (v === undefined || v === null) return "";
    const s = String(v).trim();
    if (!s || s.toUpperCase() === "NA") return "";
    const n = Number(s.replace(/,/g, ""));
    return isFinite(n) ? String(n) : "";
  }

  // Live wiring: recalc prep totals, and swap between daily and total entry.
  function wireSvsEditor_(){
    const table = document.getElementById("svsTable");
    if (!table) return;

    table.querySelectorAll("tbody tr").forEach(tr => {
      const modeChk = tr.querySelector(".svsTotalMode");
      if (modeChk){
        modeChk.addEventListener("change", () => {
          const useTotal = modeChk.checked;
          tr.setAttribute("data-mode", useTotal ? "total" : "daily");
          tr.querySelector(".svsDaily").style.display = useTotal ? "none" : "flex";
          tr.querySelector(".svsTotalWrap").style.display = useTotal ? "block" : "none";
          svsRecalcRow_(tr);
        });
      }
      tr.querySelectorAll(".svsDay, .svsPrepTotal, .svsBattle").forEach(inp => {
        inp.addEventListener("input", () => svsRecalcRow_(tr));
      });
      // Entering any score implies the player took part.
      tr.querySelectorAll(".svsDay, .svsPrepTotal, .svsBattle").forEach(inp => {
        inp.addEventListener("change", () => {
          if (String(inp.value).trim() !== ""){
            const took = tr.querySelector(".svsTook");
            if (took && !took.checked){ took.checked = true; svsUpdateSummary_(); }
          }
        });
      });
      const tookChk = tr.querySelector(".svsTook");
      if (tookChk) tookChk.addEventListener("change", svsUpdateSummary_);
      svsRecalcRow_(tr, true);
    });
    svsUpdateSummary_();
  }

  // Recompute one row's prep total display.
  function svsRecalcRow_(tr, quiet){
    const out = tr.querySelector(".svsPrepCalc");
    const useTotal = tr.getAttribute("data-mode") === "total";
    let total = null;

    if (useTotal){
      const v = tr.querySelector(".svsPrepTotal").value.trim();
      total = v === "" ? null : Number(v);
    } else {
      tr.querySelectorAll(".svsDay").forEach(d => {
        const v = d.value.trim();
        if (v === "") return;
        const n = Number(v);
        if (isFinite(n)) total = (total === null ? 0 : total) + n;
      });
    }

    if (out){
      out.textContent = (total === null || !isFinite(total)) ? "\u2014" : total.toLocaleString();
      out.style.color = (total === null) ? "#999" : "#1e5f34";
    }
    if (!quiet) svsUpdateSummary_();
    return total;
  }

  // Footer summary: how many players are marked as taking part.
  function svsUpdateSummary_(){
    const box = document.getElementById("svsSummary");
    if (!box) return;
    const rows = document.querySelectorAll("#svsTable tbody tr");
    let took = 0, scored = 0;
    rows.forEach(tr => {
      if (tr.querySelector(".svsTook")?.checked) took++;
      const battle = tr.querySelector(".svsBattle").value.trim();
      if (battle !== "") scored++;
    });
    rows.forEach(tr => {
      const t = tr.querySelector(".svsTook"), lbl = tr.querySelector(".svs-took-txt");
      if (t && lbl){ lbl.textContent = t.checked ? "Yes" : "No"; lbl.style.color = t.checked ? "#1a7f3c" : "#8a8a8a"; }
    });
    const noScore = Array.from(rows).filter(tr => tr.querySelector(".svsTook")?.checked && tr.querySelector(".svsBattle").value.trim() === "").length;
    box.textContent = `${took} of ${rows.length} participated \u00b7 ${scored} battle score(s) entered` + (noScore ? ` \u00b7 ${noScore} participated without a battle score` : "") + ".";
  }

  // Bulk tick / untick "Took part" for whatever rows the filter is showing.
  function svsCheckAllVisible(state){
    document.querySelectorAll("#svsTable tbody tr").forEach(tr => {
      if (tr.style.display === "none") return;
      const chk = tr.querySelector(".svsTook");
      if (chk) chk.checked = !!state;
    });
    svsUpdateSummary_();
  }

  function filterSvsTable(){ applySvsFilters(); }

  // Tick Participated for every starred SVS Squad member (visible or not).
  function svsMarkSquadParticipated(){
    let n = 0;
    document.querySelectorAll('#svsTable tbody tr[data-squad="1"]').forEach(tr => {
      const chk = tr.querySelector(".svsTook");
      if (chk && !chk.checked){ chk.checked = true; n++; }
    });
    svsUpdateSummary_();
    setModalMsg(n ? `Marked ${n} squad player(s) as participated. Click Save Scores to keep it.` : "All squad players were already marked.");
  }

  async function saveSvsScores(){
    if (!CURRENT_EVENT) return;
    if (!checkEventPassword()) return;

    const scores = [];
    // Every row is submitted, including the ones the filter is hiding.
    document.querySelectorAll("#svsTable tbody tr").forEach(tr => {
      const pid = tr.getAttribute("data-pid");
      const useTotal = tr.getAttribute("data-mode") === "total";
      const took = !!tr.querySelector(".svsTook")?.checked;
      const battle = tr.querySelector(".svsBattle").value.trim();

      const obj = {
        PID: pid,
        Participated: took,
        PrepMode: useTotal ? "total" : "daily",
        BattleScore: battle === "" ? "" : battle
      };

      if (useTotal){
        const t = tr.querySelector(".svsPrepTotal").value.trim();
        obj.PrepScore = t === "" ? "" : t;
      } else {
        tr.querySelectorAll(".svsDay").forEach(d => {
          obj[d.getAttribute("data-day")] = d.value.trim();
        });
      }

      const hasDay = Object.keys(obj).some(k => k.indexOf("Prep_") === 0 && obj[k] !== "");
      const isEmpty = !took && !hasDay && !obj.PrepScore && !obj.BattleScore;
      const hadData = tr.getAttribute("data-had") === "1";

      if (isEmpty){
        // Only ask the backend to delete a row if this player HAD data and the
        // user has just emptied it. An empty row that was always empty is left
        // alone, so a save can never remove someone by accident.
        if (!hadData) return;
        obj.Clear = true;
      }

      scores.push(obj);
    });

    const cleared = scores.filter(o => o.Clear).length;
    const withData = scores.length - cleared;
    setModalMsg(`Saving ${withData} player row(s)${cleared ? ` and clearing ${cleared}` : ""}\u2026`);
    const r = await apiPost("svs_scores_save", { EventID: CURRENT_EVENT.event.EventID, Scores: scores });
    if (!r.ok){ setModalMsg("Error: " + (r.error || "")); return; }
    setModalMsg(`Saved ${r.count} row(s). ${r.rowsForEvent} player(s) now logged for this SVS.`);
    await loadEvents();
  }

  // Returns the Delete Event button HTML, but only for MASTER. Empty string otherwise,
  // so ADMIN never sees a delete control in the event modal.
  function eventDeleteBtnHtml(){
    return roleAllows(currentRole(), "MASTER")
      ? '<button class="warn" style="background:#b02a2a; color:#fff;" onclick="deleteEvent()">Delete Event</button>'
      : "";
  }

  // Hard-delete the currently open event (and its registrations/scores). MASTER only.
  async function deleteEvent(){
    if (!CURRENT_EVENT || !CURRENT_EVENT.event) { setModalMsg("No event is open."); return; }
    if (!requirePassword("delete an event", "MASTER")) return;

    const id = CURRENT_EVENT.event.EventID;
    if (!confirm(`Permanently delete this event (${id}) and all its registrations and scores?\nThis cannot be undone.`)) return;

    setModalMsg("Deleting event...");
    try {
      const r = await apiPost("event_delete", { EventID: id });
      if (!r.ok){ setModalMsg("Delete failed: " + (r.error || "")); return; }
      closeEventModal();
      await loadEvents();
      setMsg(`🗑️ Deleted event ${id}.`);
    } catch (err) {
      setModalMsg("Delete failed (network): " + err.message);
    }
  }

  // Expose functions used by inline onclick handlers
  window.loadEvents = loadEvents;
  window.openNewEventModal = openNewEventModal;
  window.createNewEvent = createNewEvent;
  window.openEventEditor = openEventEditor;
  window.openEventViewer = openEventViewer;
  window.filterViewerTable = filterViewerTable;
  window.setEventTab = setEventTab;
  window.renderEventsList = renderEventsList;
  window.closeEventModal = closeEventModal;
  window.saveRegistrations = saveRegistrations;
  window.saveAttendance = saveAttendance;
  window.saveSvsScores = saveSvsScores;
  window.deleteEvent = deleteEvent;
  window.filterRegTable = filterRegTable;
  window.filterSvsTable = filterSvsTable;
  window.svsCheckAllVisible = svsCheckAllVisible;
  window.syncSvsDates = syncSvsDates;
  window.toggleSquad = toggleSquad;
  window.loadSvsLeaderboard = loadSvsLeaderboard;
  window.renderSvsLeaderboard = renderSvsLeaderboard;
  window.dismissBanner = dismissBanner;
  window.dismissManualNote = dismissManualNote;
  window.selectEventType = selectEventType;
  // Hero editor
  window.openHeroEditor = openHeroEditor;
  window.closeHeroEditor = closeHeroEditor;
  window.saveHeroEditor = saveHeroEditor;
  window.heroEditorSet = heroEditorSet;
  window.heroEditorQuickMax = heroEditorQuickMax;
  window.heroEditorClear = heroEditorClear;
  // Role-based access
  window.openSignIn = openSignIn;
  window.closeSignIn = closeSignIn;
  window.submitSignIn = submitSignIn;
  window.signOut = signOut;

  // ======================================================================
  // ACTIVE HERO GEN (site-wide, saved in the "Settings" sheet)
  // Everyone reads it; ADMIN / MASTER can change it. Heroes above the active
  // gen are greyed out in Edit Heroes, the profile grid and the icon picker.
  // ======================================================================
  function renderActiveGenUI_(){
    const lbl = document.getElementById("activeGenLabel");
    if (lbl) lbl.textContent = `Gen ${ACTIVE_GEN}` + (ACTIVE_GEN < HERO_MAX_GEN ? ` of ${HERO_MAX_GEN}` : "");
    const sel = document.getElementById("activeGenSelect");
    if (sel){
      if (sel.options.length !== HERO_MAX_GEN){
        sel.innerHTML = Array.from({ length: HERO_MAX_GEN }, (_, i) =>
          `<option value="${i + 1}">Gen ${i + 1}</option>`).join("");
      }
      sel.value = String(ACTIVE_GEN);
    }
  }

  function setActiveGen_(n, rerender){
    const g = Math.max(1, Math.min(HERO_MAX_GEN, Math.floor(Number(n) || 0)));
    if (!g) return;
    const changed = g !== ACTIVE_GEN;
    ACTIVE_GEN = g;
    localStorage.setItem("tbd_active_gen", String(g));
    renderActiveGenUI_();
    if (changed && rerender){
      // Refresh anything that shows locked/unlocked heroes.
      if (window._currentProfile && document.getElementById("profileBody")?.innerHTML)
        document.getElementById("profileBody").innerHTML = renderProfile_(window._currentProfile);
      if (document.getElementById("heroEditorBody") && typeof renderHeroEditor_ === "function"
          && document.getElementById("heroEditorBackdrop")?.style.display !== "none") {
        try { renderHeroEditor_(); } catch (e) {}
      }
      const picker = document.getElementById("avatarPicker");
      if (picker && !picker.hidden) renderAvatarPicker();
    }
  }

  async function loadSettings(){
    const res = await apiGet({ view: "settings" }, {
      onFresh: fresh => { if (fresh.settings) setActiveGen_(fresh.settings.ActiveGen, true); }
    });
    if (res && res.ok && res.settings && res.settings.ActiveGen) setActiveGen_(res.settings.ActiveGen, true);
  }

  async function saveActiveGen(){
    if (!roleAllows(currentRole(), "ADMIN")) return alert("Only Admin or Master can change the active gen.");
    const sel = document.getElementById("activeGenSelect");
    const g = Number(sel && sel.value);
    if (!g) return;
    if (!confirm(`Set the active hero generation to Gen ${g} for everyone?\n\nHeroes in Gen ${g + 1}+ will be greyed out and locked.`)) {
      renderActiveGenUI_(); return;
    }
    setMsg("Saving active gen…");
    const res = await apiPost("settings_save", { ActiveGen: g });
    if (!res.ok){ setMsg(res.error || "Could not save the active gen."); renderActiveGenUI_(); return; }
    setActiveGen_(res.settings && res.settings.ActiveGen || g, true);
    setMsg(`Active hero gen set to Gen ${ACTIVE_GEN}.`);
  }

  // ======================================================================
  // COLLAPSIBLE SECTIONS
  // Any .card with data-collapse="<key>" gets a chevron on its .card-head.
  // Click the header to fold it away. State is remembered per browser.
  // ======================================================================
  const COLLAPSE_KEY = "tbd_collapsed_cards";
  function collapsedState_(){
    try { return JSON.parse(localStorage.getItem(COLLAPSE_KEY) || "{}") || {}; } catch (e) { return {}; }
  }
  function setCardCollapsed(key, collapsed){
    const card = document.querySelector(`.card[data-collapse="${key}"]`);
    if (!card) return;
    card.classList.toggle("collapsed", !!collapsed);
    const btn = card.querySelector(".collapse-btn");
    if (btn){
      btn.setAttribute("aria-expanded", collapsed ? "false" : "true");
      btn.title = collapsed ? "Expand section" : "Collapse section";
    }
    const st = collapsedState_();
    if (collapsed) st[key] = 1; else delete st[key];
    localStorage.setItem(COLLAPSE_KEY, JSON.stringify(st));
  }
  function toggleCard(key){
    const card = document.querySelector(`.card[data-collapse="${key}"]`);
    if (card) setCardCollapsed(key, !card.classList.contains("collapsed"));
  }
  function setAllCardsCollapsed(collapsed){
    document.querySelectorAll(".card[data-collapse]").forEach(c => setCardCollapsed(c.dataset.collapse, collapsed));
  }
  function initCollapsibles_(){
    const st = collapsedState_();
    document.querySelectorAll(".card[data-collapse]").forEach(card => {
      const key = card.dataset.collapse;
      const head = card.querySelector(":scope > .card-head");
      if (!head || head.querySelector(".collapse-btn")) return;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "collapse-btn";
      btn.innerHTML = '<span class="chev" aria-hidden="true">&#9662;</span>';
      btn.setAttribute("aria-label", "Toggle section");
      btn.addEventListener("click", e => { e.stopPropagation(); toggleCard(key); });
      // Put the chevron inside the title so it stays next to it in row headers.
      const target = head.matches("h1,h2,h3,h4") ? head : (head.querySelector("h1,h2,h3,h4") || head);
      target.insertBefore(btn, target.firstChild);
      // Clicking empty header space / the title also toggles, but never when
      // the click lands on a real control inside the header.
      head.addEventListener("click", e => {
        if (e.target.closest("button, a, input, select, label, textarea")) return;
        toggleCard(key);
      });
      if (st[key]) setCardCollapsed(key, true);
    });
  }

  // ======================================================================
  // SERVICE WORKER (offline app shell + image cache) — see sw.js
  // ======================================================================
  function registerServiceWorker_(){
    if (!("serviceWorker" in navigator) || !window.isSecureContext) return;
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").then(reg => {
        // When a new version is deployed, activate it on the next visit.
        reg.addEventListener("updatefound", () => {
          const nw = reg.installing;
          if (!nw) return;
          nw.addEventListener("statechange", () => {
            if (nw.state === "installed" && navigator.serviceWorker.controller) {
              setMsg("A site update is ready \u2014 it will load next time you open the page.");
            }
          });
        });
      }).catch(() => {});
    });
  }

  window.saveActiveGen = saveActiveGen;
  window.setAllCardsCollapsed = setAllCardsCollapsed;
  window.setCardCollapsed = setCardCollapsed;
  window.toggleCard = toggleCard;
  window.toggleAvatarPicker = toggleAvatarPicker;
  window.renderAvatarPicker = renderAvatarPicker;
  window.pickAvatarHero = pickAvatarHero;
  window.prefetchEventDetail = prefetchEventDetail;
  window.applyRegFilters = applyRegFilters;
  window.clearRegFilters = clearRegFilters;
  window.regQuickFilter = regQuickFilter;
  window.applySvsFilters = applySvsFilters;
  window.clearSvsFilters = clearSvsFilters;
  window.svsQuickFilter = svsQuickFilter;
  window.svsMarkSquadParticipated = svsMarkSquadParticipated;

  // Escape closes finished result banners (and the event modal if it is open).
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Escape") return;
    const backdrop = document.getElementById("eventModalBackdrop");
    if (backdrop && backdrop.style.display !== "none"){ closeEventModal(); return; }
    dismissAllBanners();
  });

  loadConfig();
  initSorting();
  // Restore role from sessionStorage (or default to VIEWER) and apply UI
  setRoleUI(currentRole());
  // Wire PID field to live-update the save button mode
  const pidInput = document.getElementById("PID");
  if (pidInput){
    pidInput.addEventListener("input", updateSaveMode);
    pidInput.addEventListener("change", updateSaveMode);
    pidInput.addEventListener("input", refreshAvatarPreview);
  }
  const genderSel = document.getElementById("Gender");
  if (genderSel) genderSel.addEventListener("change", refreshAvatarPreview);

  initCollapsibles_();
  renderActiveGenUI_();
  registerServiceWorker_();
  updateSaveMode();
  refreshAvatarPreview();
  // Roster, events and settings load in parallel (each paints from cache first).
  Promise.all([loadAll(), loadEvents(), loadSettings()])
    .catch(() => {})
    .finally(idlePrefetch_);
