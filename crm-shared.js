/* =========================================================================
   MOOVING CRM - SHARED HELPERS  (crm-shared.js)
   Loaded by: dashboard.html, Projects.html, admin.html, assign.html
   Contains:
     1. Config (Gemini key, refresh interval, retention days)
     2. Dropdown options  (Type Of Business / Type Of Asset / Asset Model)
     3. Refresh helpers   (manual button + auto refresh every 5 hours)
     4. Retention helpers (notifications / activity log auto-delete after 30 days)
     5. AI Assistant widget (Gemini) - floating chat on every page
   ========================================================================= */
(function () {
  "use strict";

  /* ---------------------------------------------------------------------
     1. CONFIG  -- edit these values
     --------------------------------------------------------------------- */
  const CFG = {
    // Get a key from https://aistudio.google.com/apikey
    // SECURITY: no API key is stored in this repository. An Admin saves the shared AI key once in
    // Profile Settings > AI Operations; it is kept in Firestore and only signed-in users can read it.
    GEMINI_API_KEY: "",                   // intentionally empty: the shared key lives in Firestore (settings/ai), never in code
    GEMINI_MODEL: "gemini-3.8-flash",     // default model (can be changed in Profile Settings)
    REFRESH_MS: 5 * 60 * 60 * 1000,       // auto refresh every 5 hours
    RETENTION_DAYS: 30                    // notifications + activity log kept for 30 days
  };

  /* ---------------------------------------------------------------------
     2. DROPDOWN OPTIONS  -- edit lists here, all pages update automatically
     --------------------------------------------------------------------- */
  const OPTIONS = {
    business: ["LTO 100Ah", "BAAS", "VAAS", "FO/COCO"],
    assets: {
      "Battery": [
        "Battery 45 AH -Inverted",
        "Battery 45 AH -Livguard",
        "Battery 45 AH -Trontek",
        "Battery 100 AH - Livguard",
        "Battery 100 AH - Trontek"
      ],
      "Charger": [
        "Charger 20A/55V Livguard",
        "Charger 25A /55V Trontek",
        "Charger 25 A Vecomocon"
      ],
      "BSS (V1 /V2 )": [
        "Software Issue",
        "Hardware Issue"
      ]
    }
  };

  const $ = (id) => document.getElementById(id);

  /* ---- lazy access to Firebase from this shared file (same module instances the pages use) ---- */
  const FB_BASE = "https://www.gstatic.com/firebasejs/10.13.2/";
  let fbPromise = null;
  function fbx() {
    if (!fbPromise) {
      fbPromise = Promise.all([import(FB_BASE + "firebase-app.js"), import(FB_BASE + "firebase-firestore.js"), import(FB_BASE + "firebase-auth.js")])
        .then((m) => { const a = m[0].getApp(); const auth = m[2].getAuth(a); return { fs: m[1], db: m[1].getFirestore(a), getUser: () => auth.currentUser }; });
    }
    return fbPromise;
  }
  // lazy third-party libraries (never block page rendering)
  const loaded = {};
  function loadScript(url) {
    if (!loaded[url]) loaded[url] = new Promise((res) => {
      const s = document.createElement("script"); s.src = url; s.async = true; s.onload = () => res(true); s.onerror = () => res(false);
      document.head.appendChild(s);
    });
    return loaded[url];
  }
  const XLSX_URL = "https://cdn.sheetjs.com/xlsx-0.20.2/package/dist/xlsx.full.min.js";
  const CHART_URL = "https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.4/chart.umd.min.js";
  const loadXlsx = () => (window.XLSX ? Promise.resolve(true) : loadScript(XLSX_URL));
  const loadChart = () => (window.Chart ? Promise.resolve(true) : loadScript(CHART_URL));

  function fillSelect(sel, values, placeholder) {
    if (!sel) return;
    sel.innerHTML = "";
    const ph = document.createElement("option");
    ph.value = "";
    ph.textContent = placeholder;
    sel.appendChild(ph);
    values.forEach((v) => {
      const o = document.createElement("option");
      o.value = v;
      o.textContent = v;
      sel.appendChild(o);
    });
  }

  // Old records may hold a value that is not in the list any more - keep it selectable.
  function ensureOption(sel, value) {
    if (!sel || !value) return;
    const exists = Array.from(sel.options).some((o) => o.value === value);
    if (!exists) {
      const o = document.createElement("option");
      o.value = value;
      o.textContent = value + " (old value)";
      sel.appendChild(o);
    }
  }

  function initAssetDropdowns(businessId, assetId, modelId) {
    const b = $(businessId), a = $(assetId), m = $(modelId);
    fillSelect(b, OPTIONS.business, "-- Select Type Of Business --");
    fillSelect(a, Object.keys(OPTIONS.assets), "-- Select Type Of Asset --");
    const updateModels = () => {
      const list = OPTIONS.assets[a.value] || [];
      fillSelect(m, list, a.value ? "-- Select Asset Model --" : "-- Select Type Of Asset first --");
      m.disabled = !a.value;
    };
    a.addEventListener("change", updateModels);
    updateModels();
  }

  function setAssetValues(businessId, assetId, modelId, business, asset, model) {
    const b = $(businessId), a = $(assetId), m = $(modelId);
    ensureOption(b, business);
    b.value = business || "";
    ensureOption(a, asset);
    a.value = asset || "";
    a.dispatchEvent(new Event("change"));   // rebuilds model list for this asset
    ensureOption(m, model);
    m.value = model || "";
    if (model) m.disabled = false;
  }

  /* ---------------------------------------------------------------------
     3. REFRESH HELPERS
     --------------------------------------------------------------------- */
  function setRefreshing(on) {
    const btn = $("refreshBtn");
    if (!btn) return;
    btn.disabled = !!on;
    btn.classList.toggle("spinning", !!on);
  }

  function markRefreshed() {
    const el = $("lastRefreshed");
    if (el) {
      el.textContent = "Updated " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
    }
  }

  // Wraps a page's refresh function: blocks double-clicks, shows spinner, stamps the time.
  function makeRefresher(fn) {
    let running = false;
    return async function (mode) {
      if (running) return;
      running = true;
      setRefreshing(true);
      const force = mode !== "init";
      try {
        if (force && window.CRM && CRM.cache) CRM.cache.clear("");      // manual / live / timer refresh = always fresh
        await fn(force);
        if (colCfg) await reloadColumns(force);
        markRefreshed();
      } catch (e) {
        console.error("Refresh failed:", e);
      } finally {
        running = false;
        setRefreshing(false);
      }
    };
  }

  function startAutoRefresh(fn) {
    setInterval(fn, CFG.REFRESH_MS);
  }

  /* ---------------------------------------------------------------------
     4. RETENTION HELPERS
     expireAt  -> set on every new notification / log so a Firestore TTL policy can delete it.
     cutoff    -> used to hide + clean-up anything older than 30 days.
     --------------------------------------------------------------------- */
  function expireAt() {
    return new Date(Date.now() + CFG.RETENTION_DAYS * 86400000);
  }
  function retentionCutoff() {
    return new Date(Date.now() - CFG.RETENTION_DAYS * 86400000);
  }

  /* ---------------------------------------------------------------------
     5. AI ASSISTANT (Gemini 3.8 Flash) - human avatars, voice in/out, settings
     --------------------------------------------------------------------- */
  const MODELS = ["gemini-3.8-flash", "gemini-flash-latest", "gemini-3.5-flash-lite"];
  const FILTERS = [
    ["Normal", "none"], ["Warm", "sepia(.25) saturate(1.3) hue-rotate(-10deg)"], ["Cool", "saturate(1.1) hue-rotate(25deg) brightness(1.03)"],
    ["Sepia", "sepia(.8)"], ["Noir", "grayscale(1) contrast(1.1)"], ["Vivid", "saturate(1.8) contrast(1.05)"],
    ["Pastel", "saturate(.65) brightness(1.12)"], ["Sunset", "sepia(.4) saturate(1.8) hue-rotate(-25deg)"], ["Ocean", "hue-rotate(160deg) saturate(1.2)"],
    ["Forest", "hue-rotate(75deg) saturate(1.1)"], ["Neon", "saturate(2.3) contrast(1.1) brightness(1.05)"], ["Vintage", "sepia(.55) contrast(.9) brightness(1.05)"]
  ];
  // 12 cute cartoon characters (6 boys, 6 girls) - big eyes, chibi proportions, transparent background
  const AVATARS = [
    { n: "Arjun", g: "m", s: "#f6c8a0", h: "#3a2a22", hs: "cap", eye: "#6b3e1f", top: "#ec6a3c", tee: "#ffffff", bot: "#8b8f95", bt: "shorts", shoe: "#ec6a3c", bag: "#3b6fd4" },
    { n: "Riya", g: "f", s: "#f8cdaa", h: "#2b1a14", hs: "pony", eye: "#5a3418", top: "#e0558a", tee: "#ffffff", bot: "#3c4a6b", bt: "skirt", shoe: "#ffffff" },
    { n: "Rohan", g: "m", s: "#dca574", h: "#3b2418", hs: "curly", eye: "#7a3b12", top: "#e8a13a", tee: "#fff3dc", bot: "#7a4a2a", bt: "pants", shoe: "#ffffff" },
    { n: "Meera", g: "f", s: "#cf9566", h: "#2a1a12", hs: "long", eye: "#3d2a1a", top: "#e9604a", tee: "#ffffff", bot: "#27313f", bt: "pants", shoe: "#f5d142", gog: 1 },
    { n: "Kabir", g: "m", s: "#e6b48c", h: "#5a3b22", hs: "short", eye: "#2f6fb5", top: "#7b4fc9", tee: "#ffffff", bot: "#9aa0a8", bt: "shorts", shoe: "#7b4fc9", bag: "#f0a030" },
    { n: "Zoya", g: "f", s: "#f6d0b0", h: "#6b3b2a", hs: "bun", eye: "#3a7a4a", top: "#f2a03d", tee: "#ffffff", bot: "#b8465a", bt: "skirt", shoe: "#b8465a" },
    { n: "Vikram", g: "m", s: "#9a6540", h: "#0d0d0d", hs: "cap", eye: "#2a1a10", top: "#2a9d5c", tee: "#ffffff", bot: "#3a3f4b", bt: "pants", shoe: "#ffffff", bag: "#444444" },
    { n: "Sara", g: "f", s: "#f7dcc4", h: "#d9962f", hs: "long", eye: "#2f7fd0", top: "#4a8fe7", tee: "#ffffff", bot: "#f2f2f2", bt: "shorts", shoe: "#4a8fe7" },
    { n: "Daniel", g: "m", s: "#f4cfaa", h: "#a9743a", hs: "short", eye: "#4a3020", top: "#c0392b", tee: "#222222", bot: "#2b3a55", bt: "pants", shoe: "#ffffff", gls: 1 },
    { n: "Kavya", g: "f", s: "#b27a50", h: "#111111", hs: "curly", eye: "#4a2a10", top: "#8e44ad", tee: "#ffffff", bot: "#2c3e50", bt: "pants", shoe: "#f39c12", gls: 1 },
    { n: "Ethan", g: "m", s: "#f7dcc4", h: "#d8b26a", hs: "short", eye: "#3b8f6a", top: "#16a085", tee: "#ffffff", bot: "#7f8c8d", bt: "shorts", shoe: "#16a085", bag: "#e67e22", gog: 1 },
    { n: "Aria", g: "f", s: "#e6b48c", h: "#3d2314", hs: "bob", eye: "#6b3e1f", top: "#e84393", tee: "#ffffff", bot: "#34495e", bt: "skirt", shoe: "#e84393" }
  ];
  // Professional (office) family: blazer, shirt, tie/scarf, name badge and a support headset
  const PRO = [
    { n: "Aryan", g: "m", s: "#f1c9a5", h: "#1f1a17", hs: "short", eye: "#4a3020", top: "#1f3a5f", tee: "#ffffff", tie: "#c0392b", bot: "#2b2f3a", bt: "pants", shoe: "#222222" },
    { n: "Priya", g: "f", s: "#f6cfae", h: "#2b1a14", hs: "bob", eye: "#5a3418", top: "#6d2e46", tee: "#ffffff", tie: "#f2c94c", bot: "#2b2f3a", bt: "skirt", shoe: "#222222" },
    { n: "Neil", g: "m", s: "#d9a06f", h: "#141414", hs: "short", eye: "#3d2a1a", top: "#34495e", tee: "#eaf2ff", tie: "#2980b9", bot: "#232832", bt: "pants", shoe: "#222222", gls: 1 },
    { n: "Anika", g: "f", s: "#cf9566", h: "#1c120d", hs: "long", eye: "#3d2a1a", top: "#0f6b5c", tee: "#ffffff", tie: "#e67e22", bot: "#232832", bt: "pants", shoe: "#222222" },
    { n: "Samir", g: "m", s: "#e6b48c", h: "#5a3b22", hs: "short", eye: "#2f6fb5", top: "#4a4a58", tee: "#ffffff", tie: "#8e44ad", bot: "#2b2f3a", bt: "pants", shoe: "#222222" },
    { n: "Nisha", g: "f", s: "#b27a50", h: "#111111", hs: "bun", eye: "#4a2a10", top: "#a23b5b", tee: "#ffffff", tie: "#ffffff", bot: "#2b2f3a", bt: "skirt", shoe: "#222222", gls: 1 },
    { n: "Omar", g: "m", s: "#9a6540", h: "#0d0d0d", hs: "short", eye: "#2a1a10", top: "#222c3c", tee: "#ffffff", tie: "#16a085", bot: "#1b212c", bt: "pants", shoe: "#222222" },
    { n: "Emma", g: "f", s: "#f7dcc4", h: "#d9962f", hs: "pony", eye: "#2f7fd0", top: "#2c5aa0", tee: "#ffffff", tie: "#e84393", bot: "#232832", bt: "pants", shoe: "#222222" },
    { n: "Leo", g: "m", s: "#f4cfaa", h: "#a9743a", hs: "short", eye: "#4a3020", top: "#5b2a2a", tee: "#fff6e6", tie: "#2c3e50", bot: "#2b2f3a", bt: "pants", shoe: "#222222", gls: 1 },
    { n: "Sofia", g: "f", s: "#e6b48c", h: "#3d2314", hs: "long", eye: "#6b3e1f", top: "#3b3f58", tee: "#ffffff", tie: "#c0392b", bot: "#232832", bt: "skirt", shoe: "#222222" },
    { n: "Ravi", g: "m", s: "#c68a5e", h: "#1a1410", hs: "curly", eye: "#4a2a10", top: "#27496d", tee: "#ffffff", tie: "#f39c12", bot: "#232832", bt: "pants", shoe: "#222222" },
    { n: "Tara", g: "f", s: "#f8cdaa", h: "#2b1a14", hs: "pony", eye: "#3a7a4a", top: "#1e8449", tee: "#ffffff", tie: "#f1c40f", bot: "#2b2f3a", bt: "pants", shoe: "#222222" }
  ];

  // st = "idle" (blink + wave + float) | "talk" (mouth moves) | "think" (head tilt + thought dots)
  function avSvg(a, crop, st) {
    st = st || "idle";
    const f = a.g === "f", pro = a.tie !== undefined;
    const circ = (list) => list.map((c) => `<circle cx="${c[0]}" cy="${c[1]}" r="${c[2]}" fill="${a.h}"/>`).join("");
    const back = a.hs === "long" ? `<path d="M26 52Q24 14 60 13Q96 14 94 52L99 104Q60 112 21 104Z" fill="${a.h}"/>`
      : a.hs === "bob" ? `<path d="M26 52Q24 14 60 13Q96 14 94 52L97 88Q60 94 23 88Z" fill="${a.h}"/>`
      : a.hs === "curly" ? circ([[28, 46, 12], [32, 30, 13], [46, 20, 14], [62, 17, 14], [78, 20, 14], [90, 30, 13], [94, 46, 12]]) : "";
    const legs = a.bt === "pants"
      ? `<rect x="44" y="110" width="14" height="30" rx="6" fill="${a.bot}"/><rect x="62" y="110" width="14" height="30" rx="6" fill="${a.bot}"/>`
      : `<rect x="46" y="124" width="10" height="17" rx="5" fill="${a.s}"/><rect x="64" y="124" width="10" height="17" rx="5" fill="${a.s}"/>`;
    const shoes = `<ellipse cx="51" cy="141" rx="10.5" ry="5.5" fill="${a.shoe}"/><ellipse cx="69" cy="141" rx="10.5" ry="5.5" fill="${a.shoe}"/><path d="M41 143Q51 147 61 143M59 143Q69 147 79 143" stroke="#fff" stroke-width="1.5" fill="none" opacity=".6"/>`;
    const bottom = a.bt === "skirt" ? `<path d="M42 110L78 110L88 131L32 131Z" fill="${a.bot}"/>`
      : a.bt === "shorts" ? `<rect x="43" y="110" width="17" height="20" rx="6" fill="${a.bot}"/><rect x="60" y="110" width="17" height="20" rx="6" fill="${a.bot}"/>`
      : `<rect x="43" y="108" width="34" height="10" rx="4" fill="${a.bot}"/>`;
    const body = pro
      ? `<rect x="41" y="84" width="38" height="33" rx="12" fill="${a.top}"/><rect x="41" y="84" width="38" height="33" rx="12" fill="url(#sh)"/><path d="M52 85L60 101L68 85Z" fill="${a.tee}"/>` +
        (f ? `<path d="M54 87Q60 96 66 87L66 90Q60 99 54 90Z" fill="${a.tie}"/>` : `<path d="M58.4 91L61.6 91L63 105L60 109L57 105Z" fill="${a.tie}"/>`) +
        `<path d="M52 85L47 103M68 85L73 103" stroke="#000" stroke-opacity=".28" stroke-width="1.6"/><rect x="44.5" y="103" width="9" height="6" rx="1" fill="#fff"/><rect x="46" y="104.6" width="4.4" height="1.3" fill="#9aa0a6"/>`
      : `<rect x="41" y="84" width="38" height="33" rx="13" fill="${a.top}"/><rect x="41" y="84" width="38" height="33" rx="13" fill="url(#sh)"/>` +
        `<rect x="53" y="86" width="14" height="29" rx="5" fill="${a.tee}"/><path d="M53 88V113M67 88V113" stroke="#000" stroke-opacity=".16" stroke-width="1.3"/>`;
    const armL = `<path d="M44 92Q33 104 39 114" stroke="${a.top}" stroke-width="10" fill="none" stroke-linecap="round"/><circle cx="39" cy="116" r="5" fill="${a.s}"/>`;
    const armR = `<g class="wv"><path d="M76 92Q93 86 95 70" stroke="${a.top}" stroke-width="10" fill="none" stroke-linecap="round"/><circle cx="95" cy="65" r="6" fill="${a.s}"/></g>`;
    const bag = a.bag ? `<rect x="38" y="86" width="44" height="36" rx="12" fill="${a.bag}"/>` : "";
    const head = `<circle cx="27" cy="57" r="6" fill="${a.s}"/><circle cx="93" cy="57" r="6" fill="${a.s}"/><ellipse cx="60" cy="50" rx="33" ry="30" fill="${a.s}"/><ellipse cx="60" cy="50" rx="33" ry="30" fill="url(#hd)"/>`;
    const fringe = `<path d="M27 52Q24 18 60 17Q96 18 93 52Q86 34 60 34Q34 34 27 52Z" fill="${a.h}"/>`;
    const bangs = `<path d="M27 50Q24 18 60 17Q96 18 93 50Q82 40 60 41Q38 40 27 50Z" fill="${a.h}"/>`;
    const hair = a.hs === "cap"
      ? `<path d="M30 52Q32 38 60 38Q88 38 90 52Q74 44 60 45Q46 44 30 52Z" fill="${a.h}"/><path d="M26 44Q28 8 60 8Q92 8 94 44Z" fill="${a.top}"/><path d="M26 44Q28 8 60 8Q92 8 94 44Z" fill="url(#sh)"/><path d="M32 40Q60 31 106 44Q98 54 32 48Z" fill="${a.top}"/><path d="M32 40Q60 31 106 44Q98 54 32 48Z" fill="#000" opacity=".2"/><circle cx="60" cy="8" r="3.2" fill="#000" opacity=".3"/>`
      : a.hs === "pony" ? `${fringe}<path d="M90 33Q116 38 109 76Q101 55 90 52Z" fill="${a.h}"/><circle cx="91" cy="38" r="3.8" fill="#f5d142"/>`
      : a.hs === "bun" ? `<circle cx="60" cy="12" r="11" fill="${a.h}"/>${fringe}<circle cx="60" cy="20" r="3.4" fill="#f5d142"/>`
      : a.hs === "curly" ? circ([[44, 30, 9], [58, 27, 9.5], [73, 30, 9], [86, 38, 8], [34, 38, 8]])
      : a.hs === "bob" || a.hs === "long" ? bangs : fringe;
    const shine = a.hs === "cap" ? "" : `<path d="M38 26Q52 17 68 20" stroke="#fff" stroke-opacity=".3" stroke-width="3.2" fill="none" stroke-linecap="round"/>`;
    const eye = (x, side) => `<ellipse cx="${x}" cy="55" rx="7.4" ry="8.4" fill="#fff"/><circle cx="${x + .5}" cy="56" r="5.6" fill="${a.eye}"/><circle cx="${x + .5}" cy="56" r="3" fill="#161616"/>` +
      `<circle cx="${x + 2.6}" cy="53.4" r="2.3" fill="#fff"/><circle cx="${x - 1.8}" cy="58.4" r="1.1" fill="#fff"/><path d="M${x - 7.6} 52Q${x} 44.6 ${x + 7.6} 52" stroke="#2a1a14" stroke-width="1.7" fill="none" stroke-linecap="round"/>` +
      (f ? `<path d="M${x + side * 7.4} 51.6l${side * 3.4} -2.6M${x + side * 6.4} 49.4l${side * 3} -3.4" stroke="#2a1a14" stroke-width="1.4" stroke-linecap="round"/>` : "");
    const brow = (x) => `<path d="M${x - 6.5} 42Q${x} 38 ${x + 6.5} 42" stroke="${a.h}" stroke-width="2.3" fill="none" stroke-linecap="round"/>`;
    const mouth = `<g class="mouth"><path d="M51 67Q60 80 69 67Z" fill="#8f2f3a"/><path d="M52.5 67.6Q60 71 67.5 67.6Q60 71.8 52.5 67.6Z" fill="#fff"/><ellipse cx="60" cy="74.4" rx="3.8" ry="1.9" fill="#e8737f"/></g>`;
    const gog = a.gog ? `<rect x="25" y="29" width="70" height="7" rx="3.5" fill="#3b3b3b"/><circle cx="45" cy="32.5" r="9.5" fill="#7fe3f0" fill-opacity=".8" stroke="#555" stroke-width="3"/><circle cx="75" cy="32.5" r="9.5" fill="#7fe3f0" fill-opacity=".8" stroke="#555" stroke-width="3"/><path d="M40 28Q44 25 49 27" stroke="#fff" stroke-width="2" fill="none" opacity=".8"/>` : "";
    const gls = a.gls ? `<circle cx="47" cy="55" r="11" fill="#fff" fill-opacity=".12" stroke="#2a2a2a" stroke-width="2"/><circle cx="73" cy="55" r="11" fill="#fff" fill-opacity=".12" stroke="#2a2a2a" stroke-width="2"/><path d="M58 54Q60 52 62 54" stroke="#2a2a2a" stroke-width="2" fill="none"/>` : "";
    const headset = pro ? `<path d="M29 50Q30 8 60 8Q90 8 91 50" stroke="#2f3640" stroke-width="3.2" fill="none"/><rect x="22" y="50" width="9" height="15" rx="4.5" fill="#2f3640"/><rect x="89" y="50" width="9" height="15" rx="4.5" fill="#2f3640"/><path d="M26 64Q30 78 50 76" stroke="#2f3640" stroke-width="2.4" fill="none"/><circle cx="52" cy="76" r="3.2" fill="#2f3640"/>` : "";
    const dots = st === "think" ? `<g class="dots"><circle class="d1" cx="98" cy="22" r="2.4" fill="#64748b"/><circle class="d2" cx="105" cy="14" r="3.2" fill="#64748b"/><circle class="d3" cx="113" cy="5" r="4.2" fill="#64748b"/></g>` : "";
    const css = `<style>.hd{animation:bob 3.4s ease-in-out infinite}@keyframes bob{50%{transform:translateY(-1.6px)}}` +
      `.eyes{transform-box:fill-box;transform-origin:center;animation:bl 4.2s infinite}@keyframes bl{0%,92%,100%{transform:scaleY(1)}95%{transform:scaleY(.08)}}` +
      (st === "idle" ? `.wv{transform-origin:76px 92px;animation:wv 2.8s ease-in-out infinite}@keyframes wv{0%,50%,100%{transform:rotate(0)}60%{transform:rotate(-18deg)}70%{transform:rotate(5deg)}80%{transform:rotate(-16deg)}90%{transform:rotate(0)}}` : "") +
      (st === "talk" ? `.mouth{transform-box:fill-box;transform-origin:center top;animation:tk .3s ease-in-out infinite}@keyframes tk{50%{transform:scaleY(.4)}}.hd{animation:bobt .6s ease-in-out infinite}@keyframes bobt{50%{transform:translateY(-2.4px)}}` : "") +
      (st === "think" ? `.hd{transform-origin:60px 82px;animation:th 2.2s ease-in-out infinite}@keyframes th{50%{transform:rotate(-5deg)}}.dots circle{opacity:0;animation:dt 1.4s infinite}.d2{animation-delay:.25s!important}.d3{animation-delay:.5s!important}@keyframes dt{0%,100%{opacity:0}40%,70%{opacity:1}}` : "") +
      `@media (prefers-reduced-motion:reduce){*{animation:none!important}}</style>`;
    const vb = crop ? "20 6 80 80" : "0 0 120 150";
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${vb}"><defs><radialGradient id="hd" cx=".36" cy=".28" r=".9"><stop offset="0" stop-color="#fff" stop-opacity=".5"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".2"/></radialGradient>` +
      `<linearGradient id="sh" x1="0" x2="1"><stop offset="0" stop-color="#fff" stop-opacity=".28"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".28"/></linearGradient></defs>${css}` +
      `<ellipse cx="60" cy="147" rx="29" ry="3.5" fill="#000" opacity=".18"/>${bag}${back}${legs}${shoes}${bottom}${body}${armL}${armR}<rect x="54" y="76" width="12" height="12" rx="4" fill="${a.s}"/>` +
      `<g class="hd">${head}${hair}${shine}<g class="eyes">${eye(47, -1)}${eye(73, 1)}</g>${brow(47)}${brow(73)}${gls}<circle cx="38" cy="66" r="5.2" fill="#ff6b7d" opacity=".35"/><circle cx="82" cy="66" r="5.2" fill="#ff6b7d" opacity=".35"/>` +
      `<path d="M60 60Q58.4 63.6 61.6 63.6" stroke="#000" stroke-opacity=".25" fill="none" stroke-linecap="round"/>${mouth}${gog}${headset}</g>${dots}</svg>`;
  }
  const svgUri = (a, crop, st) => "data:image/svg+xml;utf8," + encodeURIComponent(avSvg(a, crop, st));

  const S = Object.assign({ key: "", model: MODELS[0], family: "cute", avatar: "0", filter: "0", voiceOn: true, voiceName: "" },
    (function () { try { return JSON.parse(localStorage.getItem("crm-ai-settings") || "{}"); } catch (e) { return {}; } })());
  let DEF = {};                                   // Admin defaults for everyone (settings/aidef)
  function eff(k) { return (S.own && S.own[k]) ? S[k] : (DEF[k] !== undefined && DEF[k] !== "" ? DEF[k] : S[k]); }
  function setOwn(k, v) { S[k] = v; S.own = Object.assign({}, S.own, { [k]: true }); saveS(); syncOwn(); }
  function syncOwn() {                            // keep personal choices with the account (best effort)
    if (!window.CRM || !CRM.savePrefs) return;
    const o = {}; ["model", "family", "avatar", "filter"].forEach((k) => { if (S.own && S.own[k]) o[k] = S[k]; });
    CRM.savePrefs({ ai: o }).catch(() => { /* offline - local copy still works */ });
  }
  function resetOwn() { S.own = {}; saveS(); syncOwn(); refreshAvatars(); }
  function setAiDefaults(def, mine) {
    DEF = def || {};
    if (mine && !(S.own && Object.keys(S.own).length)) {                // new device: adopt my saved personal choices
      const own = {}; Object.keys(mine).forEach((k) => { S[k] = mine[k]; own[k] = true; }); if (Object.keys(own).length) { S.own = own; saveS(); }
    }
    refreshAvatars();
  }
  function saveS() { try { localStorage.setItem("crm-ai-settings", JSON.stringify(S)); } catch (e) { /* ignore */ } }
  function curList() { return eff("family") === "pro" ? PRO : AVATARS; }
  function curAv() { return curList()[parseInt(eff("avatar"), 10)] || curList()[0]; }
  let avState = "idle";
  function avatarSrc(crop) { return svgUri(curAv(), crop, avState); }
  function avatarName() { return curAv().n; }
  function filterCss() { return (FILTERS[parseInt(eff("filter"), 10)] || FILTERS[0])[1]; }

  const ai = { name: "", role: "", gender: "", ctxFn: null, history: [], busy: false };
  function saveUserCache(name, role, gender) { try { localStorage.setItem("crm-user", JSON.stringify({ name: name || "", role: role || "", gender: gender || "" })); } catch (e) { /* ignore */ } }
  function getRole() { return ai.role; }
  function clearUserCache() { try { localStorage.removeItem("crm-user"); } catch (e) { /* ignore */ } }
  function setUser(name, role, gender) {
    ai.name = name || ""; ai.role = role || ""; ai.gender = gender || "";
    if (name && role) saveUserCache(name, role, gender);
    if (window.CRM && CRM.applyNav && role) setTimeout(CRM.applyNav, 0);   // links follow the real permissions
    const g = $("crmAiMsgs"); if (g && !g.children.length) { /* greeting is built on first open */ }
  }
  // show the right sidebar items + name instantly from cache (no flicker while Firebase loads)
  function preloadUI() {
    let u = null;
    try { u = JSON.parse(localStorage.getItem("crm-user") || "null"); } catch (e) { u = null; }
    if (!u) return;
    const set = (id, t) => { const e = $(id); if (e && t) e.textContent = t; };
    set("userNameLabel", u.name); set("userRoleBadge", u.role); set("userAvatar", (u.name || "U").charAt(0).toUpperCase());
    if (u.role === "Admin") ["sidebarAdminLink", "sidebarAssignLink", "sidebarMineLink", "sidebarRequestsLink"].forEach((id) => { const e = $(id); if (e) e.style.display = "flex"; });
  }
  function setContextProvider(fn) { ai.ctxFn = fn; }

  function projectsToContext(list, max) {
    return (list || []).slice(0, max || 40).map((d, i) =>
      `${i + 1}. ${d.projectName || "-"} | business:${d.business || "-"} | asset:${d.assetType || "-"} / ${d.assetModel || "-"}` +
      ` | owner:${d.ownerName || d.projectOwner || "-"} | task:${d.runningTask || "-"} | status:${d.taskStatus || "-"}` +
      ` | priority:${d.taskPriority || "-"} | ${d.taskStartDate || "-"} to ${d.taskEndDate || "-"}`).join("\n");
  }
  const escHtml = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  function renderMd(text) {
    return escHtml(text).replace(/\*\*(.+?)\*\*/g, "<b>$1</b>").replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/^\s*[-*]\s+/gm, "• ").replace(/\n/g, "<br>");
  }

  /* ---- voice ---- */
  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null, listening = false;
  function pickVoice(lang, fem) {
    const vs = (window.speechSynthesis ? speechSynthesis.getVoices() : []).filter((v) => v.lang && v.lang.toLowerCase().indexOf(lang.slice(0, 2).toLowerCase()) === 0);
    const f = /female|swara|heera|neerja|kalpana|zira|ananya|google/i, m = /male|hemant|madhur|prabhat|ravi|david|mark/i;
    return vs.find((v) => (fem ? f.test(v.name) && !/(^|\s)male/i.test(v.name) : m.test(v.name))) || vs[0] || null;
  }
  function setAvState(st) { if (avState === st) return; avState = st; refreshAvatars(); }
  function setTalking(on) { setAvState(on ? "talk" : "idle"); }
  function speak(text, force) {
    if ((!S.voiceOn && !force) || !window.speechSynthesis) return;
    try {
    speechSynthesis.cancel();
    const plain = String(text).replace(/[*`#_>]/g, "").replace(/\s+/g, " ").trim().slice(0, 900);
    if (!plain) return;
    const u = new SpeechSynthesisUtterance(plain);
    u.lang = /[\u0900-\u097F]/.test(plain) ? "hi-IN" : "en-IN";
    const v = speechSynthesis.getVoices().find((x) => x.name === S.voiceName) || pickVoice(u.lang, curAv().g === "f");
    if (v) { u.voice = v; u.lang = v.lang; }
    u.onstart = () => setTalking(true);
    u.onend = u.onerror = () => setTalking(false);
    speechSynthesis.speak(u);
    } catch (e) { setTalking(false); console.warn("Voice not available:", e.message); }
  }
  function stopSpeaking() { if (window.speechSynthesis) speechSynthesis.cancel(); setTalking(false); }
  function toggleMic() {
    if (!SR) { addMsg("bot", "⚠️ Voice input is not supported in this browser. Please use Chrome or Edge."); return; }
    if (listening && rec) { rec.stop(); return; }
    stopSpeaking();
    rec = new SR();
    rec.lang = "hi-IN";
    rec.interimResults = false;
    rec.onstart = () => { listening = true; $("crmAiMic").classList.add("on"); };
    rec.onend = () => { listening = false; $("crmAiMic").classList.remove("on"); };
    rec.onerror = () => { listening = false; $("crmAiMic").classList.remove("on"); };
    rec.onresult = (e) => { $("crmAiText").value = e.results[0][0].transcript; handleSend(); };
    try { rec.start(); } catch (e) { /* already started */ }
  }

  function addMsg(role, html) {
    const box = $("crmAiMsgs");
    if (!box) return null;
    const div = document.createElement("div");
    div.className = "crm-ai-msg " + role;
    div.innerHTML = html;
    box.appendChild(div);
    box.scrollTop = box.scrollHeight;
    return div;
  }
  function greet() {
    $("crmAiMsgs").innerHTML = "";
    addMsg("bot", `Hello${ai.name ? " " + escHtml(ai.name) : ""}! 👋 I'm <b>${escHtml(avatarName())}</b>, your AI assistant.<br>Ask me anything about your CRM, tasks, reports, emails, or any other question. Type below or tap 🎤 to speak.`);
  }
  function systemPrompt() {
    let ctx = "";
    try { ctx = ai.ctxFn ? ai.ctxFn() : ""; } catch (e) { ctx = ""; }
    if (ctx.length > 7000) ctx = ctx.slice(0, 7000) + "\n...(truncated)";
    return [
      "You are Mooving AI, a friendly human-like assistant built into Mooving CRM (project & task management for a battery-swapping / smart mobility company in India).",
      "Answer ANY question: CRM usage, the user's projects/tasks, planning, drafting emails, calculations, general knowledge.",
      `Current user: ${ai.name || "unknown"} (role: ${ai.role || "unknown"}). Today: ${new Date().toDateString()}. Page: ${document.title}.`,
      `Your name is ${avatarName()} and you are a ${curAv().g === "f" ? "female" : "male"} character: when you reply in Hindi or Hinglish, use ${curAv().g === "f" ? "feminine" : "masculine"} grammar for yourself.`,
      ai.gender === "female" ? "The user is female: when replying in Hindi, address her with feminine forms." : ai.gender === "male" ? "The user is male: when replying in Hindi, address him with masculine forms." : "The user's gender is unknown: use neutral wording.",
      "Reply in English by default; if the user writes in Hindi or Hinglish, reply in that language. Keep replies short and conversational because they may be read aloud; avoid tables.",
      "Use the CRM snapshot below for questions about projects/tasks/users; if data is missing say so - never invent records.",
      "----- CRM SNAPSHOT -----", ctx || "(no data loaded on this page)"
    ].join("\n");
  }

  let sharedKey = "";
  async function resolveKey() {
    if (S.key) return S.key;
    if (sharedKey) return sharedKey;
    try { sharedKey = sessionStorage.getItem("crm-ai-shared") || ""; } catch (e) { sharedKey = ""; }
    if (sharedKey) return sharedKey;
    try {
      const x = await fbx();
      const sn = await x.fs.getDoc(x.fs.doc(x.db, "settings", "ai"));
      sharedKey = (sn.exists() && sn.data().key) || "";
      if (sharedKey) sessionStorage.setItem("crm-ai-shared", sharedKey);
    } catch (e) { console.warn("AI key not available:", e.code || e.message); }
    return sharedKey;
  }
  function clearSharedKey() { sharedKey = ""; try { sessionStorage.removeItem("crm-ai-shared"); } catch (e) { /* ignore */ } }

  async function askAI(prompt, system) {
    const key = (await resolveKey()).trim();
    if (!key) return { error: "The AI key is not set. Add it in Profile Settings → AI Operations." };
    let lastErr = "";
    for (const model of [eff("model")].concat(MODELS.filter((m) => m !== eff("model")))) {
      try {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
          method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: system || "" }] }, contents: [{ role: "user", parts: [{ text: prompt }] }] })
        });
        const data = await res.json();
        if (!res.ok) { lastErr = (data.error && data.error.message) || ("HTTP " + res.status); if ([404, 429, 503].indexOf(res.status) !== -1) continue; break; }
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const text = parts ? parts.map((p) => p.text || "").join("") : "";
        if (text) return { text }; lastErr = "empty reply";
      } catch (e) { lastErr = "Network error"; }
    }
    return { error: lastErr };
  }

  async function sendToGemini(userText) {
    const key = (await resolveKey()).trim();
    if (!key) {
      return { html: "⚠️ The AI key is not set yet. Ask an Admin to add it in Profile Settings → AI Operations (free key: aistudio.google.com/apikey)." };
    }
    ai.history.push({ role: "user", parts: [{ text: userText }] });
    const list = [eff("model")].concat(MODELS.filter((m) => m !== eff("model")));
    let lastErr = "";
    for (const model of list) {
      try {
        const res = await fetch("https://generativelanguage.googleapis.com/v1beta/models/" + encodeURIComponent(model) + ":generateContent", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-goog-api-key": key },
          body: JSON.stringify({ systemInstruction: { parts: [{ text: systemPrompt() }] }, contents: ai.history.slice(-20) })
        });
        const data = await res.json();
        if (!res.ok) {
          lastErr = (data.error && data.error.message) || ("HTTP " + res.status);
          if ([404, 429, 503].indexOf(res.status) !== -1) continue;   // try next model
          break;
        }
        const parts = data.candidates && data.candidates[0] && data.candidates[0].content && data.candidates[0].content.parts;
        const text = parts ? parts.map((p) => p.text || "").join("") : "";
        if (!text) { lastErr = "empty reply"; continue; }
        ai.history.push({ role: "model", parts: [{ text: text }] });
        return { html: renderMd(text), speech: text };
      } catch (e) { lastErr = "Network error"; }
    }
    ai.history.pop();
    return { html: "⚠️ AI error: " + escHtml(lastErr) };
  }

  async function handleSend() {
    const input = $("crmAiText");
    if (!input || ai.busy) return;
    const text = input.value.trim();
    if (!text) return;
    input.value = ""; input.style.height = "auto";
    stopSpeaking();
    addMsg("user", escHtml(text).replace(/\n/g, "<br>"));
    ai.busy = true; $("crmAiSend").disabled = true; setAvState("think");
    const typing = addMsg("bot typing", "Thinking…");
    const r = await sendToGemini(text);
    if (typing) typing.remove();
    setAvState("idle");
    try { addMsg("bot", r.html); if (r.speech) speak(r.speech); }
    finally { ai.busy = false; $("crmAiSend").disabled = false; input.focus(); }
  }

  function refreshAvatars() {
    const fab = $("crmAiFabImg"), head = $("crmAiHeadImg");
    if (fab) { fab.src = avatarSrc(false); fab.style.filter = (filterCss() === "none" ? "" : filterCss() + " ") + "drop-shadow(0 8px 8px rgba(0,0,0,.35))"; }
    if (head) { head.src = avatarSrc(true); head.style.filter = filterCss() === "none" ? "" : filterCss(); }
    const nm = $("crmAiHeadName"); if (nm) nm.textContent = avatarName();
    const sp = $("crmAiSpeaker"); if (sp) sp.textContent = S.voiceOn ? "🔊" : "🔇";
  }

  function renderAiSettings(el) {
    if (!el) return;
    let chip = "all";
    const draw = () => {
      const voices = window.speechSynthesis ? speechSynthesis.getVoices() : [];
      const list = curList().map((a, i) => [a, i]).filter((p) => chip === "all" || p[0].g === chip);
      el.innerHTML =
        `<div class="crm-set-top"><img id="crmSetPrev" src="${avatarSrc(false)}" alt="" style="filter:${filterCss()}"><div>` +
        `<div class="crm-set-name">${escHtml(avatarName())}</div><div class="crm-set-sub">${curAv().g === "f" ? "Girl" : "Boy"} · ${eff("family") === "pro" ? "Professional" : "Cute"} style</div>` +
        '<button type="button" id="crmSetTest" class="crm-mini">🔊 Test voice</button> <button type="button" id="crmSetReset" class="crm-mini" style="background:#64748b">Use the default for everyone</button></div></div>' +
        "<label>Design</label><div class=\"crm-chips\">" +
        [["cute", "Cute"], ["pro", "Professional"]].map((c) => `<button type="button" class="crm-chip crm-fam ${eff("family") === c[0] ? "on" : ""}" data-f="${c[0]}">${c[1]}</button>`).join("") + "</div>" +
        "<label>Character gender</label><div class=\"crm-chips\">" +
        [["all", "All (12)"], ["m", "Boys (6)"], ["f", "Girls (6)"]].map((c) => `<button type="button" class="crm-chip crm-gen ${chip === c[0] ? "on" : ""}" data-c="${c[0]}">${c[1]}</button>`).join("") + "</div>" +
        "<label>Choose your AI character</label><div class=\"crm-av-grid\">" +
        list.map((p) => `<button type="button" class="crm-av ${String(p[1]) === String(eff("avatar")) ? "sel" : ""}" data-i="${p[1]}" title="${p[0].n}"><img src="${svgUri(p[0], true, "idle")}" alt="${p[0].n}"><span>${p[0].n}</span></button>`).join("") + "</div>" +
        "<label>Filter style (12)</label><select id=\"crmSetFilter\">" + FILTERS.map((f, i) => `<option value="${i}" ${String(i) === String(eff("filter")) ? "selected" : ""}>${f[0]}</option>`).join("") + "</select>" +
        "<label>Voice</label><select id=\"crmSetVoice\"><option value=\"\">Automatic (matches the character)</option>" +
        voices.map((v) => `<option value="${escHtml(v.name)}" ${v.name === S.voiceName ? "selected" : ""}>${escHtml(v.name)} (${v.lang})</option>`).join("") + "</select>" +
        `<label class="crm-chk"><input type="checkbox" id="crmTgVoice" ${S.voiceOn ? "checked" : ""}> AI voice on (unmute)</label>` +
        `<label class="crm-chk"><input type="checkbox" id="crmTgWelcome" ${isWelcomeOn() ? "checked" : ""}> Welcome voice after login</label>` +
        `<label class="crm-chk"><input type="checkbox" id="crmTgLive" ${isLiveOn() ? "checked" : ""}> Live updates (see other people's changes instantly)</label>` +
        "<label>AI model</label><select id=\"crmSetModel\">" + MODELS.map((m) => `<option ${m === eff("model") ? "selected" : ""}>${m}</option>`).join("") + "</select>" +
        `<label>Personal AI key (optional - the shared key is used when this is empty)</label><input id="crmSetKey" type="password" placeholder="Paste your own key" value="${escHtml(S.key)}">`;
      el.querySelectorAll(".crm-fam").forEach((b) => b.addEventListener("click", () => { setOwn("family", b.dataset.f); refreshAvatars(); draw(); }));
      el.querySelectorAll(".crm-gen").forEach((b) => b.addEventListener("click", () => { chip = b.dataset.c; draw(); }));
      el.querySelectorAll(".crm-av").forEach((b) => b.addEventListener("click", () => { setOwn("avatar", b.dataset.i); refreshAvatars(); draw(); }));
      $("crmSetFilter").addEventListener("change", (e) => { setOwn("filter", e.target.value); refreshAvatars(); $("crmSetPrev").style.filter = filterCss(); });
      $("crmSetVoice").addEventListener("change", (e) => { S.voiceName = e.target.value; saveS(); });
      $("crmSetModel").addEventListener("change", (e) => { setOwn("model", e.target.value); });
      $("crmSetKey").addEventListener("change", (e) => { S.key = e.target.value.trim(); saveS(); });
      $("crmTgVoice").addEventListener("change", (e) => setVoiceOn(e.target.checked));
      $("crmTgWelcome").addEventListener("change", (e) => setWelcome(e.target.checked));
      $("crmTgLive").addEventListener("change", (e) => setLive(e.target.checked));
      $("crmSetTest").addEventListener("click", () => speak(`Hello${ai.name ? " " + ai.name : ""}! I'm ${avatarName()}, your AI assistant.`, true));
      $("crmSetReset").addEventListener("click", () => { resetOwn(); draw(); });
      addEyes();
    };
    draw();
    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { if (el.isConnected) draw(); };
  }
  function openAiSettings() {
    if (/profile\.html/.test(location.pathname)) { const b = $("aiSettingsBox"); if (b) b.scrollIntoView({ behavior: "smooth" }); return; }
    location.href = "profile.html#ai";
  }
  function setVoiceOn(on) { S.voiceOn = !!on; if (!on) stopSpeaking(); saveS(); refreshAvatars(); }
  function isVoiceOn() { return !!S.voiceOn; }
  function setWelcome(on) { try { localStorage.setItem("crm-welcome-voice", on ? "on" : "off"); } catch (e) { /* ignore */ } }
  function isWelcomeOn() { try { return localStorage.getItem("crm-welcome-voice") !== "off"; } catch (e) { return true; } }

  /* ---- show / hide toggle on EVERY password box ---- */
  function addEyes() {
    document.querySelectorAll('input[type="password"]').forEach((inp) => {
      if (inp.dataset.eye) return;
      inp.dataset.eye = "1";
      const cs = getComputedStyle(inp);
      const wrap = document.createElement("div");
      wrap.className = "crm-eye-wrap";
      wrap.style.margin = cs.margin;
      inp.style.margin = "0";
      inp.parentNode.insertBefore(wrap, inp);
      wrap.appendChild(inp);
      inp.style.paddingRight = "40px";
      const b = document.createElement("button");
      b.type = "button"; b.className = "crm-eye"; b.title = "Show / hide password"; b.textContent = "👁️";
      b.addEventListener("click", (e) => {
        e.preventDefault(); e.stopPropagation();
        const show = inp.type === "password";
        inp.type = show ? "text" : "password";
        b.textContent = show ? "🙈" : "👁️";
      });
      wrap.appendChild(b);
    });
  }

  /* ---- live updates: tiny "something changed" signal doc (meta/live), not whole collections ---- */
  function isLiveOn() { try { return localStorage.getItem("crm-live") !== "off"; } catch (e) { return true; } }
  function setLive(on) { try { localStorage.setItem("crm-live", on ? "on" : "off"); } catch (e) { /* ignore */ } }
  let bumpFn = null, lastBump = 0;
  function setBump(fn) { bumpFn = fn; }
  function bump(action) {
    if (!bumpFn || /^(Login|Logout)$/.test(action || "")) return;
    const now = Date.now();
    if (now - lastBump < 2000) return;
    lastBump = now;
    Promise.resolve().then(bumpFn).catch(() => { /* live signal is best-effort */ });
  }
  function startLive(subscribe, refreshFn, myUid) {
    let first = true, timer = null, lastRun = 0;
    try {
      subscribe((by) => {
        if (first) { first = false; return; }          // first callback = current state, not a change
        if (!isLiveOn() || (by && by === myUid)) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          setTimeout(() => { lastRun = Date.now(); refreshFn(); }, Math.max(0, 6000 - (Date.now() - lastRun)));
        }, 1200);
      });
    } catch (e) { console.warn("Live updates unavailable:", e.message); }
  }

  /* ---- light self-healing: one friendly message + one automatic retry per minute ---- */
  /* ---- AI change requests: issues and ideas go to an Admin for approval ---- */
  let reportedThisSession = 0;
  function cleanText(s, max) {
    return String(s || "").replace(/AIza[0-9A-Za-z_-]{20,}/g, "[redacted]").replace(/AQ\.[0-9A-Za-z_-]{20,}/g, "[redacted]")
      .replace(/[A-Za-z0-9+\/_-]{40,}/g, "[redacted]").slice(0, max);
  }
  function hashStr(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); }
  async function submitRequest(type, title, details, source, page, silent) {
    const x = await fbx();
    const u = x.getUser();
    if (!u) throw new Error("Not signed in");
    const t = cleanText(title, 200), d = cleanText(details, 4000), pg = cleanText(page || location.pathname.split("/").pop(), 80);
    const ref = source === "auto" ? x.fs.doc(x.db, "changeRequests", "auto_" + hashStr(t + "|" + pg)) : x.fs.doc(x.fs.collection(x.db, "changeRequests"));
    await x.fs.setDoc(ref, { type, title: t, details: d, page: pg, source, status: "Pending", createdBy: u.uid, createdByName: cleanText(ai.name, 80), createdAt: x.fs.serverTimestamp() });
    if (silent) return;
    // notify admins (the notification page shows every notification to admins)
    await x.fs.addDoc(x.fs.collection(x.db, "notifications"), { targetUid: "admins", title: type === "issue" ? "Issue reported" : "Change requested", message: t.slice(0, 200), read: false, createdAt: x.fs.serverTimestamp(), expireAt: expireAt() });
  }
  async function reportIssue(err) {
    try {
      const m = cleanText((err && (err.message || err.code)) || err, 300);
      if (!m || !navigator.onLine || /network|offline|failed to fetch|unavailable|ResizeObserver|Script error|AbortError/i.test(m)) return;
      if (reportedThisSession >= 3) return;
      const x = await fbx();
      const sn = await x.fs.getDoc(x.fs.doc(x.db, "settings", "aiops"));
      if (sn.exists() && sn.data().autoReport === false) return;     // admin switched detection off
      reportedThisSession++;
      const stack = cleanText((err && err.stack) || "", 700);
      await submitRequest("issue", "Auto-detected on " + location.pathname.split("/").pop() + ": " + m.slice(0, 120), "Message: " + m + "\nStack: " + stack + "\nBrowser: " + cleanText(navigator.userAgent, 120), "auto");
    } catch (e) { /* duplicates and offline cases are expected - ignore */ }
  }
  function openRequestDialog() {
    if ($("crmReqModal")) return;
    const ov = document.createElement("div");
    ov.id = "crmReqModal"; ov.className = "crm-modal";
    ov.innerHTML = '<div class="box"><h2>🛠 Report an issue / request a change</h2>' +
      '<p>This goes to an Admin for review. Nothing changes until an Admin approves it.</p>' +
      '<label>Type</label><select id="crmReqType"><option value="issue">Something is wrong</option><option value="feature">New feature / change</option></select>' +
      '<label>Short title</label><input id="crmReqTitle" maxlength="200" placeholder="e.g. Export button does nothing">' +
      '<label>Details</label><textarea id="crmReqDetails" rows="5" maxlength="4000" placeholder="What happened, or what would you like?"></textarea>' +
      '<div class="bar"><span id="crmReqMsg"></span><button type="button" class="sec" id="crmReqCancel">Cancel</button><button type="button" id="crmReqSend">Send to Admin</button></div></div>';
    document.body.appendChild(ov);
    $("crmReqCancel").addEventListener("click", () => ov.remove());
    $("crmReqSend").addEventListener("click", async () => {
      const t = $("crmReqTitle").value.trim(), d = $("crmReqDetails").value.trim(), m = $("crmReqMsg");
      if (t.length < 5) { m.textContent = "Please enter a short title."; m.style.color = "#dc2626"; return; }
      try { await submitRequest($("crmReqType").value, t, d, "user"); m.textContent = "Sent ✓"; m.style.color = "#16a34a"; setTimeout(() => ov.remove(), 900); }
      catch (e) { m.textContent = "Could not send: " + (e.code || e.message); m.style.color = "#dc2626"; }
    });
  }

  let healAt = 0;
  function toast(msg) {
    const t = document.createElement("div");
    t.className = "crm-toast"; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.remove(), 4000);
  }
  function onFail(err) {
    const m = String((err && (err.message || err.code)) || err || "");
    if (/ResizeObserver|Script error|AbortError/i.test(m)) return;
    console.error("CRM auto-heal caught:", err);
    reportIssue(err);
    const now = Date.now();
    if (now - healAt < 60000) return;
    healAt = now;
    toast("⚠️ Something went wrong — reloading the data automatically…");
    if (typeof window.manualRefresh === "function") setTimeout(() => window.manualRefresh(), 1500);
  }
  window.addEventListener("unhandledrejection", (e) => onFail(e.reason));
  window.addEventListener("error", (e) => onFail(e.error || e.message));

  function injectStyles() {
    const css = `
.crm-refresh-btn{background:var(--card-bg);color:var(--navy);border:1px solid var(--border);padding:8px 14px;border-radius:8px;cursor:pointer;font-size:12px;font-weight:700;display:inline-flex;align-items:center;gap:6px;transition:all .2s;margin:0}
.crm-refresh-btn:hover{background:var(--navy);color:#fff;border-color:var(--navy);transform:none}
.crm-refresh-btn:disabled{opacity:.6;cursor:wait}
.crm-refresh-btn.spinning .crm-refresh-ico{display:inline-block;animation:crmSpin .8s linear infinite}
@keyframes crmSpin{to{transform:rotate(360deg)}}
.crm-last-refreshed{font-size:11px;color:var(--muted);white-space:nowrap}
@media(max-width:600px){.crm-last-refreshed{display:none}}
#crmAiFab{position:fixed;right:22px;bottom:22px;width:64px;height:64px;border-radius:50%;border:3px solid #fff;background:#dbe7f5;cursor:pointer;box-shadow:0 8px 24px rgba(37,99,235,.45);z-index:150;padding:0;overflow:hidden;transition:transform .2s}
#crmAiFab:hover{transform:scale(1.08)}
#crmAiFab img{width:100%;height:100%;object-fit:cover;display:block}
#crmAiPanel{position:fixed;right:22px;bottom:100px;width:380px;max-width:calc(100vw - 32px);height:540px;max-height:calc(100vh - 120px);background:var(--card-bg);color:var(--text);border:1px solid var(--border);border-radius:16px;box-shadow:0 20px 50px rgba(0,0,0,.28);z-index:150;display:none;flex-direction:column;overflow:hidden}
#crmAiPanel.open{display:flex}
.crm-ai-head{background:linear-gradient(90deg,#1f4e79,#2563eb);color:#fff;padding:10px 12px;display:flex;justify-content:space-between;align-items:center;font-weight:800;font-size:14px}
.crm-ai-head .who{display:flex;align-items:center;gap:10px}
.crm-ai-head img{width:38px;height:38px;border-radius:50%;object-fit:cover;border:2px solid #fff;background:#dbe7f5}
.crm-ai-head button{background:rgba(255,255,255,.18);color:#fff;border:none;border-radius:6px;width:28px;height:28px;cursor:pointer;margin-left:5px;font-size:13px;padding:0}
.crm-ai-head button:hover{background:rgba(255,255,255,.32)}
#crmAiMsgs{flex:1;overflow-y:auto;padding:14px;display:flex;flex-direction:column;gap:10px;background:var(--bg)}
.crm-ai-msg{max-width:88%;padding:10px 12px;border-radius:12px;font-size:13px;line-height:1.5;word-break:break-word}
.crm-ai-msg.bot{background:var(--card-bg);border:1px solid var(--border);align-self:flex-start;border-bottom-left-radius:4px}
.crm-ai-msg.user{background:#2563eb;color:#fff;align-self:flex-end;border-bottom-right-radius:4px}
.crm-ai-msg.typing{opacity:.7;font-style:italic}
.crm-ai-msg code{background:rgba(100,116,139,.2);padding:1px 5px;border-radius:4px;font-size:12px}
.crm-ai-input{display:flex;gap:8px;padding:10px;border-top:1px solid var(--border);background:var(--card-bg);align-items:flex-end}
#crmAiText{flex:1;resize:none;max-height:100px;padding:10px 12px;border:1px solid var(--border);border-radius:10px;background:var(--bg);color:var(--text);font-size:13px;outline:none;font-family:inherit;margin:0}
#crmAiText:focus{border-color:#2563eb}
#crmAiSend,#crmAiMic{background:#2563eb;color:#fff;border:none;border-radius:10px;width:42px;height:40px;cursor:pointer;font-size:16px;padding:0;margin:0}
#crmAiMic{background:#64748b}
#crmAiMic.on{background:#dc2626;animation:crmPulse 1s infinite}
@keyframes crmPulse{50%{opacity:.55}}
#crmAiSend:disabled{opacity:.5;cursor:wait}
.crm-av-grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px}
.crm-av{background:var(--bg);border:2px solid var(--border);border-radius:10px;padding:4px;cursor:pointer;color:var(--text);font-size:10px;display:flex;flex-direction:column;align-items:center;gap:2px}
.crm-av img{width:100%;border-radius:8px}
.crm-av.sel{border-color:#2563eb;box-shadow:0 0 0 2px rgba(37,99,235,.3)}
.crm-set-actions{display:flex;gap:8px;margin-top:14px}
.crm-set-actions button{flex:1;padding:9px;border:none;border-radius:8px;cursor:pointer;font-weight:700;background:#2563eb;color:#fff}
.crm-set-actions button#crmSetCancel{background:#64748b}
#crmAiFab{width:60px;height:75px;border:none;background:transparent;border-radius:0;box-shadow:none;right:16px;bottom:10px;overflow:visible;animation:crmFloat 3.2s ease-in-out infinite}
#crmAiFab img{width:100%;height:100%;object-fit:contain;display:block}
#crmAiFab:hover{transform:none}
#crmAiFab.talking{animation:crmTalk .45s ease-in-out infinite}
@keyframes crmFloat{50%{transform:translateY(-6px)}}
@keyframes crmTalk{50%{transform:translateY(-11px) rotate(-2deg)}}
#crmAiPanel{bottom:92px;top:auto;height:min(560px,calc(100vh - 116px));max-height:calc(100vh - 116px)}
@supports(height:100dvh){#crmAiPanel{height:min(560px,calc(100dvh - 116px));max-height:calc(100dvh - 116px)}}
#crmAiMsgs{min-height:0}
.crm-aiset label{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:14px 0 5px}
.crm-aiset select,.crm-aiset input[type=password]{width:100%;padding:10px 12px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:14px}
.crm-aiset label.crm-chk{display:flex;align-items:center;gap:10px;text-transform:none;font-size:14px;color:var(--text);font-weight:600}
.crm-aiset input[type=checkbox]{width:18px!important;height:18px;flex:none;margin:0!important;padding:0!important;accent-color:#2563eb}
.crm-aiset label.crm-chk{justify-content:flex-start;cursor:pointer}
.crm-aiset .crm-av-grid{grid-template-columns:repeat(auto-fill,minmax(78px,1fr))}
.crm-set-top{display:flex;gap:16px;align-items:center}
.crm-set-top img{height:130px;width:auto}
.crm-set-name{font-size:18px;font-weight:800;color:var(--navy)}
.crm-set-sub{font-size:12px;color:var(--muted);margin-bottom:8px}
.crm-mini{background:#2563eb;color:#fff;border:none;border-radius:8px;padding:7px 12px;font-weight:700;cursor:pointer;font-size:12px}
.crm-chips{display:flex;gap:8px;flex-wrap:wrap}
.crm-chip{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:20px;padding:6px 14px;cursor:pointer;font-weight:700;font-size:12px}
.crm-chip.on{background:#2563eb;color:#fff;border-color:#2563eb}
.crm-ai-head img{background:#dbe7f5}
.crm-av img{background:#dbe7f5}
.crm-eye-wrap{position:relative;display:block}
.crm-eye{position:absolute;right:6px;top:50%;transform:translateY(-50%);background:none!important;border:none!important;cursor:pointer;font-size:16px;padding:4px 6px!important;margin:0!important;width:auto!important;height:auto!important;color:var(--muted);box-shadow:none!important}
.crm-modal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:350;display:flex;align-items:center;justify-content:center;padding:16px}
.crm-modal .box{background:var(--card-bg);color:var(--text);border:1px solid var(--border);border-radius:14px;width:480px;max-width:100%;padding:20px;max-height:90vh;overflow:auto}
.crm-modal h2{font-size:16px;color:var(--navy);margin-bottom:6px}
.crm-modal p{font-size:12px;color:var(--muted);margin-bottom:8px}
.crm-modal label{display:block;font-size:11px;font-weight:700;color:var(--muted);text-transform:uppercase;margin:12px 0 5px}
.crm-modal input,.crm-modal select,.crm-modal textarea{width:100%;padding:9px 11px;border:1px solid var(--border);border-radius:8px;background:var(--bg);color:var(--text);font-size:13px;font-family:inherit}
.crm-modal .bar{display:flex;gap:8px;align-items:center;justify-content:flex-end;margin-top:14px}
.crm-modal .bar span{margin-right:auto;font-size:12px}
.crm-modal .bar button{padding:8px 16px;border:none;border-radius:8px;font-weight:700;cursor:pointer;background:#2563eb;color:#fff}
.crm-modal .bar .sec{background:#64748b}
#crmAiFab{will-change:transform}
@media(prefers-reduced-motion:reduce){#crmAiFab{animation:none!important}}
.crm-toast{position:fixed;left:50%;bottom:26px;transform:translateX(-50%);background:#1e293b;color:#fff;padding:10px 18px;border-radius:10px;font-size:13px;z-index:500;box-shadow:0 8px 24px rgba(0,0,0,.35)}
.sidebar-nav{padding:14px 12px!important;gap:3px!important}
.sidebar-nav .nav-item{padding-top:9px!important;padding-bottom:9px!important}
@media(max-width:600px){#crmAiFab{width:48px;height:60px;right:8px}#crmAiPanel{right:10px;bottom:76px;height:min(560px,calc(100vh - 96px));max-height:calc(100vh - 96px)}}
`;
    const st = document.createElement("style"); st.textContent = css; document.head.appendChild(st);
  }

  function buildWidget() {
    const rb = $("refreshBtn");
    if (rb && !rb.querySelector(".crm-refresh-ico")) rb.innerHTML = '<span class="crm-refresh-ico">🔄</span> Refresh';

    const fab = document.createElement("button");
    fab.id = "crmAiFab"; fab.type = "button"; fab.title = "Ask AI";
    fab.innerHTML = '<img id="crmAiFabImg" alt="AI">';
    const panel = document.createElement("div");
    panel.id = "crmAiPanel";
    panel.innerHTML =
      '<div class="crm-ai-head"><span class="who"><img id="crmAiHeadImg" alt=""><span id="crmAiHeadName"></span></span><span>' +
      '<button type="button" id="crmAiReq" title="Report an issue or request a change">🛠</button>' +
      '<button type="button" id="crmAiSpeaker" title="Voice mute / unmute">🔊</button>' +
      '<button type="button" id="crmAiGear" title="AI settings (Profile Settings me)">⚙</button>' +
      '<button type="button" id="crmAiClear" title="New chat">🗑</button>' +
      '<button type="button" id="crmAiClose" title="Close">✕</button></span></div>' +
      '<div id="crmAiMsgs"></div>' +
      '<div class="crm-ai-input"><button type="button" id="crmAiMic" title="Speak your question">🎤</button>' +
      '<textarea id="crmAiText" rows="1" placeholder="Ask me anything..."></textarea>' +
      '<button type="button" id="crmAiSend" title="Send">➤</button></div>';
    document.body.appendChild(panel); document.body.appendChild(fab);
    refreshAvatars();

    let greeted = false;
    fab.addEventListener("click", () => {
      panel.classList.toggle("open");
      if (panel.classList.contains("open")) { if (!greeted) { greet(); greeted = true; } $("crmAiText").focus(); }
      else stopSpeaking();
    });
    $("crmAiClose").addEventListener("click", () => { panel.classList.remove("open"); stopSpeaking(); });
    $("crmAiClear").addEventListener("click", () => { ai.history = []; stopSpeaking(); greet(); });
    $("crmAiReq").addEventListener("click", openRequestDialog);
    $("crmAiSpeaker").addEventListener("click", () => { S.voiceOn = !S.voiceOn; if (!S.voiceOn) stopSpeaking(); saveS(); refreshAvatars(); });
    $("crmAiGear").addEventListener("click", () => openAiSettings());
    $("crmAiMic").addEventListener("click", toggleMic);
    $("crmAiSend").addEventListener("click", handleSend);
    const ta = $("crmAiText");
    ta.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSend(); } });
    ta.addEventListener("input", () => { ta.style.height = "auto"; ta.style.height = Math.min(ta.scrollHeight, 100) + "px"; });
    if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => {};
  }

  document.addEventListener("DOMContentLoaded", () => { preloadUI(); injectStyles(); buildWidget(); addEyes(); });

  /* ---------------------------------------------------------------------
     6. COLUMN NAMES  (Admin can rename every column + attach an info popup)
        Stored in Firestore: settings/columns   (read: signed-in, write: Admin only)
     --------------------------------------------------------------------- */
  const COLS = [
    ["srNo", "Sr No", ["Sr No"]], ["projectName", "Project Name", ["Project Name"]],
    ["business", "Type Of Business", ["Business", "Type Of Business"]], ["assetType", "Type Of Asset", ["Asset", "Type Of Asset"]],
    ["owner", "Project Owner", ["Owner", "Project Owner"]], ["assetModel", "Asset Model", ["Asset Model"]],
    ["runningTask", "Running Task", ["Running Task"]], ["spoc", "Project SPOC", ["SPOC", "Project SPOC"]],
    ["startDate", "Start Date", ["Start Date", "Task Start Date"]], ["endDate", "End Date", ["End Date", "Task End Date"]],
    ["status", "Status", ["Status"]], ["priority", "Priority", ["Priority"]],
    ["progress1", "Progress Update 1", ["Progress 1", "Progress Update 1"]], ["progress2", "Progress Update 2", ["Progress 2", "Progress Update 2"]],
    ["remarks", "Remarks", ["Remarks"]], ["ageing", "Ageing", ["Ageing"]], ["actions", "Actions", ["Actions"]],
    ["uName", "Name (report)", ["Name"]], ["uEmail", "Email (report)", ["Email"]], ["uRole", "Role (report)", ["Role"]],
    ["uTotal", "Total (report)", ["Total"]], ["uPending", "Pending (report)", ["Pending"]], ["uProgress", "In Progress (report)", ["In Progress"]],
    ["uDone", "Completed (report)", ["Completed"]], ["uEff", "Efficiency (report)", ["Efficiency"]]
  ];
  let colCfg = null;
  let colMap = (function () { try { return JSON.parse(localStorage.getItem("crm-cols") || "{}"); } catch (e) { return {}; } })();
  const LABEL_MAX = 40, NOTE_MAX = 300;

  function tagColumns() {
    document.querySelectorAll("th, label[for]").forEach((el) => {
      if (el.dataset.col || (el.closest && el.closest(".pf-card"))) return;
      const raw = el.textContent.trim();
      const txt = raw.replace(/\s*\*$/, "");
      const hit = COLS.find((c) => c[2].indexOf(txt) !== -1);
      if (!hit) return;
      el.dataset.col = hit[0];
      el.dataset.orig = txt;
      if (/\*$/.test(raw)) el.dataset.req = "1";
    });
  }

  function closePop() { const p = $("crmColPop"); if (p) p.remove(); }
  function showPop(anchor, note) {
    closePop();
    const p = document.createElement("div");
    p.id = "crmColPop";
    p.textContent = note;                                   // textContent => no HTML injection
    document.body.appendChild(p);
    const r = anchor.getBoundingClientRect();
    p.style.top = Math.min(window.innerHeight - p.offsetHeight - 10, r.bottom + 6) + "px";
    p.style.left = Math.max(8, Math.min(window.innerWidth - p.offsetWidth - 8, r.left - 20)) + "px";
  }

  function applyColumns() {
    document.querySelectorAll("[data-col]").forEach((el) => {
      const m = colMap[el.dataset.col] || {};
      const label = (m.label || "").trim() || el.dataset.orig;
      el.textContent = label + (el.dataset.req ? " *" : "");
      if (m.note) {
        const i = document.createElement("span");
        i.className = "crm-info"; i.textContent = " ⓘ"; i.title = "Click for info";
        i.addEventListener("click", (e) => { e.preventDefault(); e.stopPropagation(); showPop(i, m.note); });
        el.appendChild(i);
      }
    });
  }
  document.addEventListener("click", (e) => { if (!e.target.classList || !e.target.classList.contains("crm-info")) closePop(); });

  function cacheCols() { try { localStorage.setItem("crm-cols", JSON.stringify(colMap)); } catch (e) { /* ignore */ } }

  async function reloadColumns(force) {
    if (!colCfg) return;
    if (force === false) { try { const t = parseInt(localStorage.getItem("crm-cols-t") || "0", 10); if (Date.now() - t < 600000) return; } catch (e) { /* ignore */ } }
    try {
      const m = await colCfg.load();
      colMap = m && typeof m === "object" ? m : {};
      cacheCols(); try { localStorage.setItem("crm-cols-t", String(Date.now())); } catch (e) { /* ignore */ } applyColumns();
    } catch (e) { console.warn("Column names not loaded:", e.code || e.message); }
  }

  function initColumns(cfg) {
    colCfg = cfg;
    if (!$("crmColStyle")) {
      const st = document.createElement("style");
      st.id = "crmColStyle";
      st.textContent = ".crm-info{cursor:pointer;color:#38bdf8;font-weight:700;text-transform:none}" +
        "#crmColPop{position:fixed;z-index:400;max-width:280px;background:var(--card-bg);color:var(--text);border:1px solid var(--border);border-radius:10px;padding:10px 12px;font-size:12px;line-height:1.5;box-shadow:0 10px 30px rgba(0,0,0,.3);text-transform:none;font-weight:500;white-space:pre-wrap}" +
        "#crmColModal{position:fixed;inset:0;background:rgba(0,0,0,.55);z-index:350;display:flex;align-items:center;justify-content:center;padding:16px}" +
        "#crmColModal .box{background:var(--card-bg);color:var(--text);border:1px solid var(--border);border-radius:14px;width:720px;max-width:100%;max-height:90vh;display:flex;flex-direction:column}" +
        "#crmColModal h2{padding:16px 18px;font-size:16px;color:var(--navy);border-bottom:1px solid var(--border)}" +
        "#crmColModal .rows{overflow:auto;padding:10px 18px}" +
        "#crmColModal .r{display:grid;grid-template-columns:150px 1fr 1.4fr;gap:8px;align-items:start;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px}" +
        "#crmColModal input,#crmColModal textarea{width:100%;padding:7px 9px;border:1px solid var(--border);border-radius:7px;background:var(--bg);color:var(--text);font-size:12px;font-family:inherit}" +
        "#crmColModal .bar{display:flex;gap:8px;justify-content:flex-end;align-items:center;padding:12px 18px;border-top:1px solid var(--border)}" +
        "#crmColModal .bar button{padding:8px 16px;border:none;border-radius:8px;font-weight:700;cursor:pointer;background:#2563eb;color:#fff}" +
        "#crmColModal .bar .sec{background:#64748b}#crmColModal .bar .dng{background:#dc2626}" +
        "@media(max-width:600px){#crmColModal .r{grid-template-columns:1fr}}";
      document.head.appendChild(st);
    }
    tagColumns(); applyColumns();
    const btn = $("colEditBtn");
    if (btn) btn.style.display = cfg.isAdmin ? "inline-flex" : "none";
    reloadColumns(false);
  }

  function openColumnEditor() {
    if (!colCfg || !colCfg.isAdmin || $("crmColModal")) return;
    const ov = document.createElement("div");
    ov.id = "crmColModal";
    ov.innerHTML = '<div class="box"><h2>🏷 Customize Columns <span style="font-weight:500;font-size:12px;color:var(--muted)">— new name and ⓘ popup note (Admin only)</span></h2>' +
      '<div class="rows">' + COLS.map((c) =>
        `<div class="r"><b>${escHtml(c[1])}</b><input data-k="${c[0]}" data-f="label" maxlength="${LABEL_MAX}" placeholder="${escHtml(c[1])}">` +
        `<textarea data-k="${c[0]}" data-f="note" rows="2" maxlength="${NOTE_MAX}" placeholder="Popup note (optional)"></textarea></div>`).join("") +
      '</div><div class="bar"><span id="crmColMsg" style="margin-right:auto;font-size:12px"></span>' +
      '<button class="dng" type="button" id="crmColReset">Reset all</button><button class="sec" type="button" id="crmColCancel">Cancel</button><button type="button" id="crmColSave">Save</button></div></div>';
    document.body.appendChild(ov);
    ov.querySelectorAll("[data-k]").forEach((el) => { el.value = (colMap[el.dataset.k] || {})[el.dataset.f] || ""; });
    const msg = (t, ok) => { const m = $("crmColMsg"); m.textContent = t; m.style.color = ok ? "#16a34a" : "#dc2626"; };
    async function persist(map) {
      msg("Saving...", true);
      try { await colCfg.save(map); colMap = map; cacheCols(); applyColumns(); ov.remove(); }
      catch (e) { msg("Save failed: " + (e.code || e.message), false); }
    }
    $("crmColCancel").addEventListener("click", () => ov.remove());
    $("crmColReset").addEventListener("click", () => { if (confirm("Reset all column names to their defaults?")) persist({}); });
    $("crmColSave").addEventListener("click", () => {
      const map = {};
      ov.querySelectorAll("[data-k]").forEach((el) => {
        const v = el.value.trim().slice(0, el.dataset.f === "label" ? LABEL_MAX : NOTE_MAX);
        if (!v) return;
        (map[el.dataset.k] = map[el.dataset.k] || {})[el.dataset.f] = v;
      });
      persist(map);
    });
  }

  /* ---------------------------------------------------------------------
     PUBLIC API
     --------------------------------------------------------------------- */
  window.CRM = {
    CFG, OPTIONS,
    initAssetDropdowns, setAssetValues,
    makeRefresher, startAutoRefresh, markRefreshed, setRefreshing,
    expireAt, retentionCutoff,
    setUser, setContextProvider, projectsToContext,
    initColumns, openColumnEditor, reloadColumns,
    saveUserCache, clearUserCache, addEyes, openAiSettings, renderAiSettings, setVoiceOn, isVoiceOn, setWelcome, isWelcomeOn,
    isLiveOn, setLive, setBump, bump, startLive,
    getRole, setAiDefaults, aiEff: eff, fbx, loadXlsx, loadChart, loadScript, clearSharedKey, submitRequest, openRequestDialog, askAI
  };
})();
