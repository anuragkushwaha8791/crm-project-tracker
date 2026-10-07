/* =========================================================================
   MOOVING CRM - CORE (crm-core.js)  - loaded after crm-shared.js
   1. Permissions     : who may do what (Admins + per-user grants)
   2. Access loading  : permissions + personal prefs in ONE cached read
   3. Pins            : up to 20 pinned tasks per person
   4. Cache           : tiny session cache (pages open instantly, fewer Firestore reads)
   5. SVG charts      : professional donut / bars, no external library
   6. Copy protection : deterrent for people who may not export data
   7. Small helpers   : today's date, sticker fallback, click-outside close
   ========================================================================= */
(function () {
  "use strict";
  const CRM = window.CRM;
  const $ = (id) => document.getElementById(id);
  const MAIN_EMAIL = "operations194@mooving.com";

  /* ------------------------------ 1. permissions ------------------------------ */
  const PERMS = [
    ["viewAll", "See every project, the dashboard filter and all notifications"],
    ["assign", "Assign tasks to any user"],
    ["deleteProjects", "Delete projects"],
    ["activityLog", "View the activity log"],
    ["requests", "Review AI change requests"],
    ["columns", "Rename columns"],
    ["aiOps", "Manage the shared AI key and AI defaults"],
    ["adminPanel", "Open the Admin Panel (view only)"],
    ["export", "Download / export data"],
    ["aiCode", "AI Code Studio (let the AI change the code)"]
  ];
  const MAIN_ONLY = { export: 1, aiCode: 1 };          // admins do NOT get these automatically
  let me = { uid: "", email: "", role: "" };
  let perms = {};
  let prefs = {};
  let aiDef = {};

  function isMain() { return !!me.email && me.email.toLowerCase() === MAIN_EMAIL; }
  function isAdmin() { return me.role === "Admin"; }
  function can(p) {
    if (isMain()) return true;
    if (MAIN_ONLY[p]) return perms[p] === true;
    return isAdmin() || perms[p] === true;
  }

  /* ------------------------------ 4. cache ------------------------------ */
  function ck(k) { return "crmc:" + (me.uid || "x") + ":" + k; }
  function plain(v) {
    if (v === null || typeof v !== "object") return v;
    if (typeof v.toMillis === "function") return { __ms: v.toMillis() };
    if (Array.isArray(v)) return v.map(plain);
    const o = {}; Object.keys(v).forEach((k) => { o[k] = plain(v[k]); }); return o;
  }
  function revive(v) {
    if (v === null || typeof v !== "object") return v;
    if (Array.isArray(v)) return v.map(revive);
    if (typeof v.__ms === "number") { const ms = v.__ms; return { seconds: Math.floor(ms / 1000), toMillis: () => ms, toDate: () => new Date(ms) }; }
    const o = {}; Object.keys(v).forEach((k) => { o[k] = revive(v[k]); }); return o;
  }
  const cache = {
    get(key, maxAgeMs) {
      try {
        const raw = sessionStorage.getItem(ck(key)); if (!raw) return null;
        const o = JSON.parse(raw);
        if (Date.now() - o.t > (maxAgeMs || 180000)) return null;
        return revive(o.d);
      } catch (e) { return null; }
    },
    set(key, data) { try { sessionStorage.setItem(ck(key), JSON.stringify({ t: Date.now(), d: plain(data) })); } catch (e) { /* quota */ } },
    clear(prefix) { try { Object.keys(sessionStorage).filter((k) => k.indexOf("crmc:" + (me.uid || "x") + ":" + (prefix || "")) === 0).forEach((k) => sessionStorage.removeItem(k)); } catch (e) { /* ignore */ } }
  };

  /* ------------------------------ 2. access loading ------------------------------ */
  function applyNav() {
    const show = (id, on) => { const e = $(id); if (e) e.style.display = on ? "flex" : "none"; };
    show("sidebarAdminLink", isAdmin() || can("adminPanel"));
    show("sidebarAssignLink", can("assign"));
    show("sidebarMineLink", can("viewAll"));
    show("sidebarRequestsLink", can("requests"));
    show("sidebarCodeLink", can("aiCode"));
  }
  function readLocalAccess() {
    try {
      const a = JSON.parse(localStorage.getItem("crm-access") || "null");
      if (a) { me = Object.assign(me, a.me || {}); perms = a.perms || {}; }
    } catch (e) { /* ignore */ }
  }
  function saveLocalAccess() { try { localStorage.setItem("crm-access", JSON.stringify({ me, perms, t: Date.now() })); } catch (e) { /* ignore */ } }

  async function loadAccess(force) {
    const role = CRM.getRole ? CRM.getRole() : "";
    const x = await CRM.fbx();
    const u = x.getUser();
    me = { uid: u ? u.uid : me.uid, email: u ? (u.email || "") : me.email, role: role || me.role };
    const hit = !force && cache.get("access", 300000);
    if (hit) { perms = hit.perms || {}; prefs = hit.prefs || {}; aiDef = hit.aiDef || {}; }
    else {
      const fs = x.fs;
      const rd = async (col, id) => { try { const s = await fs.getDoc(fs.doc(x.db, col, id)); return s.exists() ? s.data() : {}; } catch (e) { return {}; } };
      const [p, pr, def] = await Promise.all([rd("permissions", me.uid), rd("userPrefs", me.uid), rd("settings", "aidef")]);
      perms = (p && p.perms) || {}; prefs = pr || {}; aiDef = def || {};
      cache.set("access", { perms, prefs, aiDef });
    }
    if (CRM.setAiDefaults) CRM.setAiDefaults(aiDef, prefs.ai);
    saveLocalAccess(); applyNav(); applyNoCopy(); applyLook();
    return { me, perms };
  }

  async function savePrefs(patch) {
    prefs = Object.assign({}, prefs, patch);
    cache.set("access", { perms, prefs, aiDef });
    const x = await CRM.fbx(); const fs = x.fs;
    await fs.setDoc(fs.doc(x.db, "userPrefs", me.uid), Object.assign({}, prefs, { updatedAt: fs.serverTimestamp() }));
  }

  /* ------------------------------ 3. pins ------------------------------ */
  const MAX_PINS = 20;
  function pins() { return Array.isArray(prefs.pinned) ? prefs.pinned.slice() : []; }
  function isPinned(id) { return pins().indexOf(id) !== -1; }
  async function togglePin(id) {
    const list = pins(); const i = list.indexOf(id);
    if (i === -1) { if (list.length >= MAX_PINS) return { ok: false, msg: "You can pin at most " + MAX_PINS + " tasks. Unpin one first." }; list.push(id); }
    else list.splice(i, 1);
    await savePrefs({ pinned: list });
    return { ok: true, pinned: i === -1 };
  }

  /* ------------------------------ 5. svg charts ------------------------------ */
  const PALETTE = ["#2f6fae", "#f39c12", "#1e8449", "#c0392b", "#8e44ad", "#16a085", "#e67e22", "#34495e"];
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  function donut(el, items, opt) {
    if (!el) return; opt = opt || {};
    const total = items.reduce((a, b) => a + (b.value || 0), 0);
    const R = 62, C = 2 * Math.PI * R; let off = 0;
    const segs = total ? items.map((it, i) => {
      const len = (it.value / total) * C; const col = it.color || PALETTE[i % PALETTE.length];
      const s = `<circle r="${R}" cx="90" cy="90" fill="none" stroke="${col}" stroke-width="26" stroke-dasharray="${len} ${C - len}" stroke-dashoffset="${-off}" transform="rotate(-90 90 90)"><title>${esc(it.label)}: ${it.value}</title></circle>`;
      off += len; return s;
    }).join("") : `<circle r="${R}" cx="90" cy="90" fill="none" stroke="var(--border)" stroke-width="26"/>`;
    const legend = items.map((it, i) => `<div class="crm-lg"><i style="background:${it.color || PALETTE[i % PALETTE.length]}"></i><span>${esc(it.label)}</span><b>${it.value}${total ? " · " + Math.round(it.value * 100 / total) + "%" : ""}</b></div>`).join("");
    el.innerHTML = (opt.title ? `<div class="crm-ct">${esc(opt.title)}</div>` : "") +
      `<div class="crm-donut"><svg viewBox="0 0 180 180" role="img" aria-label="${esc(opt.title || "chart")}">${segs}<text x="90" y="86" text-anchor="middle" class="crm-big">${total}</text><text x="90" y="104" text-anchor="middle" class="crm-small">${esc(opt.center || "Total")}</text></svg><div class="crm-legend">${legend}</div></div>`;
  }
  function bars(el, items, opt) {
    if (!el) return; opt = opt || {};
    const max = opt.max || Math.max(1, ...items.map((i) => i.value || 0));
    el.innerHTML = (opt.title ? `<div class="crm-ct">${esc(opt.title)}</div>` : "") +
      '<div class="crm-bars">' + (items.length ? items.map((it, i) => `<div class="crm-bar"><span class="crm-bl" title="${esc(it.label)}">${esc(it.label)}</span><div class="crm-bt"><div class="crm-bf" style="width:${Math.max(2, Math.round((it.value || 0) * 100 / max))}%;background:${it.color || PALETTE[i % PALETTE.length]}"></div></div><b>${it.value}${opt.unit || ""}</b></div>`).join("") : '<div class="crm-empty">No data yet</div>') + "</div>";
  }

  /* ------------------------------ 6. copy protection (deterrent) ------------------------------ */
  let nocopyOn = false;
  function applyNoCopy() {
    const want = !isAdmin() && !can("export");
    document.body && document.body.classList.toggle("crm-nocopy", want);
    if (want && !nocopyOn) {
      nocopyOn = true;
      const inField = (e) => e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName);
      ["copy", "cut", "dragstart"].forEach((ev) => document.addEventListener(ev, (e) => { if (document.body.classList.contains("crm-nocopy") && !inField(e)) e.preventDefault(); }));
      document.addEventListener("contextmenu", (e) => { if (document.body.classList.contains("crm-nocopy") && !inField(e)) e.preventDefault(); });
      document.addEventListener("keydown", (e) => {
        if (!document.body.classList.contains("crm-nocopy")) return;
        const k = (e.key || "").toLowerCase();
        if (e.key === "F12" || ((e.ctrlKey || e.metaKey) && (["s", "u", "p"].indexOf(k) !== -1 || (e.shiftKey && ["i", "j", "c"].indexOf(k) !== -1)))) e.preventDefault();
      });
    }
  }

  /* ------------------------------ 7. helpers ------------------------------ */
  function todayStr() { const d = new Date(); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  // the AI chat closes when you click anywhere else (or press Escape)
  function closeChatOnOutside() {
    document.addEventListener("mousedown", (e) => {
      const p = $("crmAiPanel"); if (!p || !p.classList.contains("open")) return;
      if (p.contains(e.target) || ($("crmAiFab") && $("crmAiFab").contains(e.target)) || e.target.closest(".crm-modal")) return;
      p.classList.remove("open");
    });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape") { const p = $("crmAiPanel"); if (p) p.classList.remove("open"); } });
  }
  function injectCss() {
    const st = document.createElement("style");
    st.textContent = ".crm-nocopy,.crm-nocopy *{-webkit-user-select:none;user-select:none}.crm-nocopy input,.crm-nocopy textarea,.crm-nocopy select{-webkit-user-select:text;user-select:text}" +
      ".crm-ct{font-size:13px;font-weight:800;color:var(--navy);margin-bottom:10px}.crm-donut{display:flex;gap:18px;align-items:center;flex-wrap:wrap}.crm-donut svg{width:170px;height:170px;flex:none}" +
      ".crm-donut circle{transition:stroke-dasharray .6s ease}.crm-big{font-size:30px;font-weight:800;fill:var(--text)}.crm-small{font-size:11px;fill:var(--muted)}" +
      ".crm-legend{display:flex;flex-direction:column;gap:7px;min-width:150px}.crm-lg{display:flex;align-items:center;gap:8px;font-size:12px}.crm-lg i{width:11px;height:11px;border-radius:3px;flex:none}.crm-lg span{color:var(--muted);flex:1}.crm-lg b{color:var(--text)}" +
      ".crm-bars{display:flex;flex-direction:column;gap:9px}.crm-bar{display:grid;grid-template-columns:96px 1fr 54px;gap:10px;align-items:center;font-size:12px}.crm-bl{color:var(--muted);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}" +
      ".crm-bt{height:12px;border-radius:8px;background:var(--border);overflow:hidden}.crm-bf{height:100%;border-radius:8px;transition:width .7s ease}.crm-bar b{text-align:right;color:var(--text)}.crm-empty{color:var(--muted);font-size:12px}" +
      ".crm-chartgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:18px;margin:6px 0 22px}.crm-chartcard{background:var(--card-bg);border:1px solid var(--border);border-radius:14px;padding:18px}" +
      ".crm-pinbtn{background:none!important;border:none!important;cursor:pointer;font-size:16px;padding:2px 4px!important;margin:0!important;opacity:.45;filter:grayscale(1)}.crm-pinbtn.on{opacity:1;filter:none}";
    document.head.appendChild(st);
  }


  /* ------------------------------ 8. appearance (3 UI styles + options) ------------------------------ */
  const LOOK_DEFAULT = { ui: "classic", accent: "blue", density: "comfortable", font: "medium", corners: "round", motion: "on", bg: "aurora", navtext: "full" };
  const LOOK_KEYS = Object.keys(LOOK_DEFAULT);
  function ownLook() { try { return JSON.parse(localStorage.getItem("crm-look") || "{}") || {}; } catch (e) { return {}; } }
  function look() { return Object.assign({}, LOOK_DEFAULT, aiDef.look || {}, ownLook()); }
  function applyLook() {
    const l = look(), h = document.documentElement;
    LOOK_KEYS.forEach((k) => h.setAttribute("data-" + k, l[k]));
  }
  function setLook(k, v) {
    const o = ownLook(); o[k] = v;
    try { localStorage.setItem("crm-look", JSON.stringify(o)); } catch (e) { /* ignore */ }
    applyLook();
    savePrefs({ look: o }).catch(() => { /* local copy still applies */ });
  }
  function resetLook() {
    try { localStorage.removeItem("crm-look"); } catch (e) { /* ignore */ }
    applyLook(); savePrefs({ look: {} }).catch(() => {});
  }
  async function setLookDefault(on) {                      // Admin: make the current look the default for everyone
    const x = await CRM.fbx(); const fs = x.fs;
    const cur = look();
    const ref = fs.doc(x.db, "settings", "aidef");
    const sn = await fs.getDoc(ref); const old = sn.exists() ? sn.data() : {};
    const next = Object.assign({}, old, { look: on ? cur : {}, updatedBy: me.uid, updatedAt: fs.serverTimestamp() });
    await fs.setDoc(ref, next);
    aiDef = Object.assign({}, aiDef, { look: on ? cur : {} }); cache.clear("access");
  }
  function renderLookSettings(el) {
    if (!el) return;
    const l = look();
    const TILES = [
      ["classic", "Classic", "The familiar layout: dark left sidebar, clean cards."],
      ["glass", "Modern Glass", "Floating glass sidebar, soft aurora background, rounded pill buttons."],
      ["pro", "Pro Top-Nav", "Menu across the top, denser tables, more data on one screen."]
    ];
    const SW = [["blue", "#2563eb"], ["purple", "#7c3aed"], ["teal", "#0d9488"], ["orange", "#ea580c"], ["rose", "#e11d48"], ["emerald", "#059669"]];
    const sel = (k, opts) => `<select data-look="${k}">` + opts.map((o) => `<option value="${o[0]}" ${l[k] === o[0] ? "selected" : ""}>${o[1]}</option>`).join("") + "</select>";
    el.innerHTML =
      '<label>Choose how the CRM looks</label><div class="look-tiles">' +
      TILES.map((t) => `<button type="button" class="look-tile ${l.ui === t[0] ? "sel" : ""}" data-ui="${t[0]}"><div class="look-prev lp-${t[0]}"><i class="sb"></i><i class="b1"></i><i class="b2"></i><i class="b3"></i></div><b>${t[1]}</b><small>${t[2]}</small></button>`).join("") + "</div>" +
      '<label>Accent colour</label><div class="look-swatches">' + SW.map((s) => `<button type="button" class="look-sw ${l.accent === s[0] ? "sel" : ""}" data-accent="${s[0]}" title="${s[0]}" style="background:${s[1]}"></button>`).join("") + "</div>" +
      "<label>Spacing</label>" + sel("density", [["comfortable", "Comfortable"], ["compact", "Compact (more on screen)"]]) +
      "<label>Text size</label>" + sel("font", [["small", "Small"], ["medium", "Medium"], ["large", "Large"]]) +
      "<label>Corners</label>" + sel("corners", [["round", "Rounded"], ["square", "Square"]]) +
      "<label>Animations</label>" + sel("motion", [["on", "On"], ["off", "Off (faster on old computers)"]]) +
      (l.ui === "glass" ? "<label>Glass background</label>" + sel("bg", [["aurora", "Aurora"], ["sunset", "Sunset"], ["ocean", "Ocean"]]) : "") +
      (l.ui === "pro" ? "<label>Top menu</label>" + sel("navtext", [["full", "Icons and text"], ["icons", "Icons only"]]) : "") +
      '<div class="crm-set-actions" style="margin-top:14px"><button type="button" id="lookReset" class="crm-mini" style="background:#64748b">Reset my look</button>' +
      (can("aiOps") ? ' <button type="button" id="lookDefault" class="crm-mini">Make this the default for everyone</button> <button type="button" id="lookDefaultOff" class="crm-mini" style="background:#64748b">Clear the default</button>' : "") +
      '</div><div id="lookMsg" class="pf-msg"></div>';
    const redraw = () => renderLookSettings(el);
    el.querySelectorAll(".look-tile").forEach((b) => b.addEventListener("click", () => { setLook("ui", b.dataset.ui); redraw(); }));
    el.querySelectorAll(".look-sw").forEach((b) => b.addEventListener("click", () => { setLook("accent", b.dataset.accent); redraw(); }));
    el.querySelectorAll("select[data-look]").forEach((s) => s.addEventListener("change", () => { setLook(s.dataset.look, s.value); redraw(); }));
    $("lookReset").addEventListener("click", () => { resetLook(); redraw(); });
    const msg = (t, ok) => { const m = $("lookMsg"); if (m) { m.textContent = t; m.style.color = ok ? "var(--success)" : "var(--danger)"; } };
    if ($("lookDefault")) {
      $("lookDefault").addEventListener("click", async () => { try { await setLookDefault(true); msg("Saved. People who have not chosen their own look will now see this one.", true); } catch (e) { msg("Could not save: " + (e.code || e.message)); } });
      $("lookDefaultOff").addEventListener("click", async () => { try { await setLookDefault(false); msg("Default cleared.", true); } catch (e) { msg("Could not save: " + (e.code || e.message)); } });
    }
  }


  /* ------------------------------ 9. pager: 10 at a time, cached, survives a missing Firestore index ------------------------------ */
  function pager(opt) {
    const step = opt.step || 10;
    const st = { rows: [], last: null, more: false, fb: false, pool: [], shown: 0, lost: false, loaded: false };
    const done = () => opt.render(st.rows, st.more, st);
    const save = () => { if (opt.key) cache.set(opt.key, { rows: st.rows, more: st.more, fb: st.fb, pool: st.pool, shown: st.shown }); };
    async function load(reset, useCache) {
      if (reset !== false) {
        st.rows = []; st.last = null; st.more = false; st.fb = false; st.pool = []; st.shown = 0; st.lost = false;
        if (useCache && opt.key) {
          const c = cache.get(opt.key, 180000);
          if (c) { Object.assign(st, c, { lost: !c.fb, loaded: true }); done(); return; }
        }
      }
      if (st.fb) { st.shown += step; st.rows = st.pool.slice(0, st.shown); st.more = st.pool.length > st.shown; save(); done(); return; }
      try {
        const n = st.lost ? st.rows.length + step : step;
        const snap = await opt.query(st.lost ? null : st.last, n);
        const rows = []; snap.forEach((d) => rows.push(opt.map(d)));
        st.rows = st.lost ? rows : st.rows.concat(rows);
        if (snap.docs.length) st.last = snap.docs[snap.docs.length - 1];
        st.more = snap.docs.length === n; st.lost = false;
      } catch (e) {
        if (!opt.fallback) throw e;
        console.warn("Using the simple query (an index is missing):", e.code || e.message);
        const pool = await opt.fallback();
        st.fb = true; st.pool = pool; st.shown = Math.min(step, pool.length); st.rows = pool.slice(0, st.shown); st.more = pool.length > st.shown;
      }
      st.loaded = true; save(); done();
    }
    return { st, load };
  }

  readLocalAccess();
  applyLook();
  document.addEventListener("DOMContentLoaded", () => { injectCss(); applyNav(); closeChatOnOutside(); });

  Object.assign(CRM, {
    MAIN_EMAIL, PERMS, MAIN_ONLY, MAX_PINS,
    can, isMain, loadAccess, applyNav, savePrefs, getPrefs: () => prefs, getPerms: () => perms,
    pins, isPinned, togglePin, cache, plain, revive, chart: { donut, bars }, todayStr, applyNoCopy,
    look, setLook, resetLook, renderLookSettings, applyLook, pager
  });
})();
