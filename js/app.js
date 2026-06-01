/* ============================================================================
   POOLARIS — application / UI layer
   Vanilla JS SPA. State persists to localStorage. Renders all views, the
   guided onboarding wizard, tooltips, toasts, calculators, SLAM mode, and the
   Learn knowledge base. No build step, no dependencies — opens from file://.
   ========================================================================== */
(function () {
  "use strict";
  const D = window.DATA, C = window.CALC, S = window.SVG, CH = window.Charts, IN = window.INSIGHTS;

  /* ============================ tiny DOM utils ======================== */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  function node(html) { const t = document.createElement("template"); t.innerHTML = html.trim(); return t.content.firstElementChild; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function fmt(n, d) { if (n == null || isNaN(n)) return "—"; return (+n).toFixed(d == null ? 0 : d); }

  /* ============================ store ================================= */
  const KEY = "poolaris.v1";
  let state = loadState() || { profile: null, log: [], slam: null, ui: { learnOpen: {} } };
  function loadState() { try { return JSON.parse(localStorage.getItem(KEY)); } catch (e) { return null; } }
  function saveLocal() { state.savedAt = Date.now(); try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {} window.__poolarisSlam = state.slam; }
  function save() {
    if (window.ENGAGE && state.profile) { try { ENGAGE.onSave(engageCtx()); } catch (e) {} }
    saveLocal(); if (portal.mode === "account") portalSavePool(); else serverSave();
  }
  function engageCtx() {
    return {
      state: state, profile: profile(), latest: latest(),
      health: IN.health(profile(), state.log || []),
      save: saveLocal, go: go, toast: toast, S: S,
    };
  }
  function actCtx() {
    return {
      state: state, profile: profile(), latest: latest(), log: state.log || [],
      save: save, go: go, toast: toast, S: S,
      rerender: function () { updateAppbar(); if (!$("#view-dashboard").hidden && RENDER.dashboard) RENDER.dashboard(); },
    };
  }
  function latest() {
    // Freshest non-null value of EACH parameter across the whole log (carry-forward),
    // so a partial reading never wipes out your other numbers — the smart current state.
    return IN.effectiveReading(state.log, state.profile && state.profile.seedReading);
  }
  function profile() { return state.profile || D.USER_DEFAULTS; }
  let editingIndex = null; // index of the log entry being edited (null = adding a new one)

  /* ===== PORTAL state (additive) — offline file-mode by default; account mode when signed in.
     In "offline" mode the app behaves byte-for-byte as before (localStorage + /api/state file
     shim). In "account" mode, profile/slam persist per-pool via the REST API, readings & doses
     go through their own endpoints by stable server id, and ui prefs stay device-local. */
  const portal = { mode: "offline", session: null, user: null, companies: [], role: "homeowner", pool: null, pools: [], selectedPoolId: null, serverHasAccounts: false };
  window.portal = portal;

  /* ===== server sync — durable file-based persistence when run via server.py =====
     Open the app through http://localhost:8000 and every save also writes to a real
     file on disk (data/poolaris.json). Opened directly from a file:// path, it falls
     back to localStorage silently. The server's data file is the source of truth. */
  let serverOK = false, _srvTimer = null;
  function serverLoad(cb) {
    if (location.protocol === "file:") { cb(undefined); return; }
    fetch("api/state", { cache: "no-store" })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => cb(d && d.ok ? d.state : null))
      .catch(() => cb(undefined));
  }
  function serverSaveNow() {
    if (!serverOK) return;
    try { fetch("api/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(state) }).catch(() => {}); } catch (e) {}
  }
  function serverSave() {
    if (!serverOK) return;
    clearTimeout(_srvTimer);
    _srvTimer = setTimeout(serverSaveNow, 400); // coalesce rapid saves into one write
  }
  function syncWithServer() {
    serverLoad(function (srv) {
      if (srv === undefined) { serverOK = false; return; } // no server → localStorage only
      serverOK = true;
      const hasSrv = srv && (srv.savedAt || srv.profile || (srv.log && srv.log.length));
      const localFresher = state.savedAt && (!srv || !srv.savedAt || state.savedAt > srv.savedAt);
      if (hasSrv && !localFresher) {
        state = srv; if (!state.ui) state.ui = { learnOpen: {} };
        try { localStorage.setItem(KEY, JSON.stringify(state)); } catch (e) {}
        // the file had a profile we didn't know about → close the auto-opened wizard
        if (state.profile && $("#onboarding") && !$("#onboarding").hidden) closeOnboarding();
        applyTheme(currentTheme()); updateAppbar();
        const route = (location.hash || "#dashboard").slice(1);
        if (RENDER[route]) RENDER[route]();
      } else if (state.profile || (state.log && state.log.length)) {
        serverSaveNow(); // local is newer (or server empty) → push it up to the file
      }
    });
  }

  /* ============================ theme =============================== */
  function prefersDark() { return window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches; }
  function currentTheme() { return (state.ui && state.ui.theme) || (prefersDark() ? "dark" : "light"); }
  function applyTheme(t) {
    document.documentElement.setAttribute("data-theme", t);
    const b = document.getElementById("btnTheme");
    if (b) { b.innerHTML = S.icon(t === "dark" ? "sun" : "moon"); b.title = t === "dark" ? "Switch to light mode" : "Switch to dark mode"; b.setAttribute("aria-pressed", t === "dark" ? "true" : "false"); }
    const tc = document.querySelector('meta[name="theme-color"]'); if (tc) tc.setAttribute("content", t === "dark" ? "#0a1628" : "#0e7da8");
  }
  function toggleTheme() {
    state.ui = state.ui || {};
    state.ui.theme = currentTheme() === "dark" ? "light" : "dark";
    save(); applyTheme(state.ui.theme);
  }
  // Calm / battery-saver: kills caustics, blur and animations (auto-on for reduced-motion / save-data).
  function currentCalm() {
    if (state.ui && state.ui.calm != null) return !!state.ui.calm;
    const rm = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const sd = navigator.connection && navigator.connection.saveData;
    return !!(rm || sd);
  }
  function applyCalm(on) { document.documentElement.setAttribute("data-calm", on ? "1" : ""); }
  function toggleCalm() { state.ui = state.ui || {}; state.ui.calm = !currentCalm(); save(); applyCalm(state.ui.calm); }
  function helpAction() {
    // A signed-in company admin has no homeowner profile — never drop them into the
    // homeowner setup wizard; send them to Learn instead.
    const isCompany = portal.mode === "account" && portal.companies && portal.companies.length;
    if (!state.profile && !isCompany) openOnboarding(); else go("learn");
  }
  // Appbar "…" overflow: keeps the bar uncluttered (only bell + account + more) so the
  // health pill never gets squeezed. Houses theme, help, and (offline) reset.
  function openMoreMenu() {
    const layer = $("#modalLayer"); if (!layer) return;
    const offline = portal.mode !== "account";
    const themeDark = currentTheme() === "dark";
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet acct-sheet" role="dialog" aria-modal="true" aria-label="More options">
      <div class="sheet__head"><h2>${S.icon("grid")} More</h2><button class="iconbtn" id="moreClose" aria-label="Close">${S.icon("close")}</button></div>
      <div class="acct-menu">
        <button class="acct-menu__i" data-more="theme">${S.icon(themeDark ? "sun" : "moon")} <span>${themeDark ? "Light mode" : "Dark mode"}</span></button>
        <button class="acct-menu__i" data-more="help">${S.icon("learn")} <span>Help &amp; learn</span></button>
        <button class="acct-menu__i" data-more="calm">${S.icon("droplet")} <span>Calm mode${currentCalm() ? " · on" : ""}</span></button>
        ${offline ? `<button class="acct-menu__i acct-menu__i--danger" data-more="reset">${S.icon("setup")} <span>Reset all my data</span></button>` : ""}
      </div></div>`;
    const close = () => { document.removeEventListener("keydown", onKey); layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    const onKey = (e) => { if (e.key === "Escape") close(); };
    document.addEventListener("keydown", onKey);
    $("#moreClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    $$("[data-more]", layer).forEach((b) => b.addEventListener("click", () => {
      const a = b.getAttribute("data-more"); close();
      if (a === "theme") toggleTheme();
      else if (a === "help") helpAction();
      else if (a === "calm") toggleCalm();
      else if (a === "reset") resetAll();
    }));
  }

  /* ============================ toasts =============================== */
  function toast(msg, kind) {
    const ics = { good: S.icon("check"), warn: S.icon("warn"), bad: S.icon("warn"), info: S.icon("info") };
    const t = node(`<div class="toast toast--${kind || "info"}"><span class="toast__ic">${ics[kind || "info"]}</span><div>${msg}</div></div>`);
    $("#toastWrap").appendChild(t);
    setTimeout(() => { t.classList.add("is-out"); setTimeout(() => t.remove(), 250); }, 3600);
  }
  // Accessible in-app confirm (replaces native blocking confirm at destructive sites). Returns Promise<bool>.
  function confirmDialog(opts) {
    opts = opts || {};
    return new Promise((resolve) => {
      const layer = $("#modalLayer");
      if (!layer) { resolve(window.confirm(opts.message || opts.title || "Are you sure?")); return; }
      layer.hidden = false; layer.className = "overlay is-open";
      layer.innerHTML = `<div class="sheet confirm-sheet" role="alertdialog" aria-modal="true" aria-labelledby="cd-t" aria-describedby="cd-d">
        <div class="sheet__body">
          <h2 id="cd-t" style="margin:0 0 8px">${esc(opts.title || "Are you sure?")}</h2>
          <p id="cd-d" class="muted" style="margin:0 0 18px">${opts.message || ""}</p>
          <div class="btnrow" style="justify-content:flex-end">
            <button class="btn btn--ghost" id="cd-cancel">${esc(opts.cancel || "Cancel")}</button>
            <button class="btn ${opts.danger ? "btn--danger" : "btn--primary"}" id="cd-ok">${esc(opts.confirm || "Confirm")}</button>
          </div>
        </div></div>`;
      const close = (val) => { document.removeEventListener("keydown", onKey); layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; resolve(val); };
      const onKey = (e) => { if (e.key === "Escape") close(false); else if (e.key === "Enter") close(true); };
      document.addEventListener("keydown", onKey);
      $("#cd-ok").addEventListener("click", () => close(true));
      $("#cd-cancel").addEventListener("click", () => close(false));
      layer.addEventListener("click", (e) => { if (e.target === layer) close(false); });
      const okb = $("#cd-ok"); if (okb) okb.focus();
    });
  }

  /* ============================ tooltips ============================= */
  // Rich tip registry. Reference with data-tip-id, or inline data-tip="html".
  const TIPS = {};
  D.PARAMS.forEach((p) => {
    const R = D.RANGES[p.key];
    const rangeLine = p.key === "fc" ? '<span class="tip-range">Set by your CYA (see the FC/CYA chart)</span>'
      : p.key === "cc" ? '<span class="tip-range">Ideal: 0 · act above 0.5</span>'
      : R ? `<span class="tip-range">Ideal: ${R.ideal[0]}–${R.ideal[1]}${R.unit ? " " + R.unit : ""}</span>` : "";
    TIPS[p.key] = `<strong>${p.name}${p.short && p.short !== p.name ? " (" + p.short + ")" : ""}</strong><br>${p.tip.what}<br><br><em>Why it matters:</em> ${p.tip.why}<br><br><em>How to adjust:</em> ${p.tip.how}${rangeLine ? "<br>" + rangeLine : ""}`;
  });
  Object.assign(TIPS, {
    slamfc: "<strong>SLAM level</strong><br>The high Free-Chlorine level (about 40% of your CYA) you hold continuously to kill algae — not a one-time \"shock.\"",
    minfc: "<strong>Minimum FC</strong><br>The lowest your Free Chlorine should ever go for your CYA (about 5% of CYA). Drop below this and algae can return.",
    ocl: "<strong>Overnight Chlorine Loss Test</strong><br>Test FC at dusk and again at dawn. Losing under 1 ppm overnight means nothing in the water is eating chlorine — your algae is dead.",
    csi: "<strong>CSI</strong><br>One number combining pH, temperature, calcium, alkalinity &amp; CYA. Negative water etches surfaces; positive water scales. Aim −0.3 to +0.3.",
    volume: "<strong>Pool volume</strong><br>Every dose depends on this. We estimate it from your shape, size &amp; average depth. Average depth = (shallowest + deepest) ÷ 2.",
    strength: "<strong>Chlorine strength</strong><br>Liquid chlorine is sold at different strengths (often 10% or 12.5%). Stronger = you add less. Check the jug.",
  });
  let tipTimer = null;
  function showTip(target) {
    const id = target.getAttribute("data-tip-id");
    const html = id ? TIPS[id] : target.getAttribute("data-tip");
    if (!html) return;
    const pop = $("#tooltipPop");
    pop.innerHTML = html;
    pop.hidden = false;
    const r = target.getBoundingClientRect();
    const pw = Math.min(320, window.innerWidth - 24);
    pop.style.maxWidth = pw + "px";
    let left = r.left + r.width / 2 - pw / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - pw - 12));
    let top = r.top - pop.offsetHeight - 12;
    let side = "top";
    if (top < 12) { top = r.bottom + 12; side = "bottom"; }
    pop.style.left = left + "px"; pop.style.top = top + "px";
    pop.setAttribute("data-side", side);
    pop.style.setProperty("--arrow", (r.left + r.width / 2 - left) + "px");
  }
  function hideTip() { $("#tooltipPop").hidden = true; }
  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tip-id],[data-tip]");
    if (t) { e.preventDefault(); const pop = $("#tooltipPop"); if (!pop.hidden && pop._for === t) { hideTip(); pop._for = null; } else { showTip(t); pop._for = t; } return; }
    if (!e.target.closest("#tooltipPop")) hideTip();
  });
  document.addEventListener("mouseover", (e) => { const t = e.target.closest("[data-tip-id],[data-tip]"); if (t && window.matchMedia("(hover:hover)").matches) { clearTimeout(tipTimer); showTip(t); } });
  document.addEventListener("mouseout", (e) => { const t = e.target.closest("[data-tip-id],[data-tip]"); if (t && window.matchMedia("(hover:hover)").matches) { tipTimer = setTimeout(hideTip, 120); } });
  window.addEventListener("scroll", hideTip, true);
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") { hideTip(); const pop = $("#tooltipPop"); if (pop) pop._for = null; return; }
    if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      const t = e.target.closest && e.target.closest("[data-tip-id],[data-tip]");
      if (t) { e.preventDefault(); const pop = $("#tooltipPop"); if (!pop.hidden && pop._for === t) { hideTip(); pop._for = null; } else { showTip(t); pop._for = t; } }
    }
  });
  // keyboard activation (Enter / Space) for clickable tiles that aren't native buttons
  document.addEventListener("keydown", (e) => {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    const t = e.target;
    if (t && t.matches && t.matches('.param[role="button"], .card.is-clickable[data-calc], .acc__head')) {
      e.preventDefault();
      t.click();
    }
  });
  function info(id) { return `<span class="info" data-tip-id="${id}" tabindex="0" role="button" aria-label="More info">i</span>`; }
  function infoHTML(html) { return `<span class="info" data-tip="${esc(html)}" tabindex="0" role="button" aria-label="More info">i</span>`; }

  /* ---- visual-hierarchy + guidance helpers ---- */
  function sectionHead(n, title, desc, icon) {
    return `<div class="section-head"><div class="section-head__n">${typeof n === "number" ? n : S.icon(n)}</div><div><h2 class="section-head__t">${icon ? S.icon(icon) + " " : ""}${title}</h2>${desc ? `<p class="section-head__d">${desc}</p>` : ""}</div></div>`;
  }
  function nextStep(icon, title, desc, btnLabel, href) {
    return `<a class="next-step is-clickable" href="${href}"><span class="next-step__ic">${S.icon(icon)}</span><span class="next-step__b"><b>${title}</b><p>${desc}</p></span><span class="btn btn--primary nowrap">${btnLabel} <span class="arrow-cue">${S.icon("arrow")}</span></span></a>`;
  }
  // Cap a list of pre-rendered cards, tucking the overflow behind a "+N more" disclosure
  // so a busy pool doesn't bury the numbered action system under a wall of cards.
  function cardsMore(arr, shown, label) {
    arr = (arr || []).filter(Boolean);
    if (!arr.length) return "";
    if (arr.length <= shown) return arr.join("");
    const n = arr.length - shown;
    return arr.slice(0, shown).join("") +
      `<details class="more-cards"><summary>+ ${n} more ${label}${n > 1 ? "s" : ""}</summary><div class="more-cards__body">${arr.slice(shown).join("")}</div></details>`;
  }
  // Associate any orphan <label> in a .field with its control (adds for/id) so screen
  // readers announce every calculator / log / setup input. One DRY pass beats ~60 markup edits.
  function labelFields(root) {
    if (!root) return;
    $$(".field", root).forEach((f) => {
      const lab = f.querySelector(":scope > label");
      if (!lab || lab.getAttribute("for")) return;
      const ctrl = f.querySelector("input, select, textarea");
      if (!ctrl) return;
      if (!ctrl.id) ctrl.id = "fld-" + (labelFields._n = (labelFields._n || 0) + 1);
      lab.setAttribute("for", ctrl.id);
    });
  }
  function rangeText(key) {
    if (key === "fc") return 'typical <b>0–15 ppm</b> — set by your CYA';
    if (key === "temp") return 'typical <b>50–95 °F</b>';
    const R = D.RANGES[key]; if (!R) return "";
    const u = R.unit ? " " + R.unit : "";
    if (key === "cc") return 'aim <b>0</b> — take action above 0.5';
    let ideal = R.ideal; if (key === "cya" && profile().sanitizer === "salt") ideal = R.swgIdeal;
    return `ideal <b>${ideal[0]}–${ideal[1]}${u}</b> · ok ${R.ok[0]}–${R.ok[1]}`;
  }
  function rangeHint(key) { const t = rangeText(key); return t ? `<div class="range-hint">${S.icon("info")} <span>${t}</span></div>` : ""; }

  /* ============================ status helpers ====================== */
  const STATE_LABEL = { good: "Looking great", warn: "Needs a tweak", bad: "Needs attention", slam: "SLAM in progress", unknown: "Tell me your numbers" };
  function chipFor(state) { return { good: "chip--good", warn: "chip--warn", bad: "chip--bad", unknown: "chip--muted" }[state] || "chip--muted"; }

  function updateAppbar() {
    const p = state.profile; const wrap = $("#appbarStatus");
    // company member browsing the roster (no specific pool) → no single-pool health pill
    const isCompany = portal.mode === "account" && portal.companies && portal.companies.length > 0;
    if (isCompany && !(portal.pool && portal.pool.id)) { wrap.hidden = true; return; }
    if (!p) { wrap.hidden = true; return; }
    const h = C.health(p, latest());
    let st = h.state;
    if (state.slam && state.slam.active) st = "slam";
    wrap.hidden = false;
    wrap.innerHTML = `<span class="healthpill" data-state="${st}" title="${STATE_LABEL[st]}${h.total ? ` · ${h.good}/${h.total} in range` : ""}"><span class="dot"></span><span class="healthpill__label">${STATE_LABEL[st]}</span>${h.total ? `<span class="healthpill__count"> · ${h.good}/${h.total}</span>` : ""}</span>`;
    // slam nav flag
    const slamNav = $('.nav__item--slam');
    if (slamNav) slamNav.setAttribute("data-flag", state.slam && state.slam.active ? "on" : "off");
  }

  /* ============================ router ============================== */
  const ROUTES = ["dashboard", "log", "plan", "calculators", "slam", "chem", "learn", "setup", "messages", "roster", "route", "account"];
  const RENDER = {};
  // routes that don't require a homeowner pool profile (portal/company + learn)
  const PROFILE_FREE_ROUTES = { learn: 1, messages: 1, roster: 1, route: 1, account: 1 };
  function go(route, replace) {
    editingIndex = null; // any navigation cancels an in-progress edit
    if (ROUTES.indexOf(route) < 0) route = "dashboard";
    // Force onboarding only for homeowner chemistry views with no profile — never for a
    // signed-in company member (techs/admins have no personal pool) or portal routes.
    const isCompany = portal.mode === "account" && portal.companies && portal.companies.length;
    if (!state.profile && !PROFILE_FREE_ROUTES[route] && !isCompany) { openOnboarding(); }
    go.current = route; // track the active route (weather/async re-renders check this)
    ROUTES.forEach((r) => { const v = $("#view-" + r); if (v) v.hidden = r !== route; });
    $$(".nav__item").forEach((n) => n.classList.toggle("is-active", n.getAttribute("data-route") === route));
    updateClientCtx(route);
    if (RENDER[route]) RENDER[route]();
    if (location.hash !== "#" + route) { if (replace) history.replaceState(null, "", "#" + route); else location.hash = route; }
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    hideTip();
  }
  window.addEventListener("hashchange", () => go((location.hash || "#dashboard").slice(1), true));

  // Company "servicing this client" context bar: shown when a company member is viewing a
  // pool they don't own, on a per-pool route. Gives identity + a one-tap path back to the roster.
  const PER_POOL_ROUTES = { dashboard: 1, log: 1, plan: 1, calculators: 1, slam: 1, chem: 1, setup: 1 };
  function updateClientCtx(route) {
    const bar = $("#clientCtx"); if (!bar) return;
    const isCompany = portal.mode === "account" && portal.companies && portal.companies.length;
    const pool = portal.pool;
    const owned = pool && pool.role === "owner";
    if (!(isCompany && pool && !owned && PER_POOL_ROUTES[route])) { bar.hidden = true; return; }
    const who = (pool.owner && pool.owner.name) ? pool.owner.name : "this client";
    const addr = (pool.address && (pool.address.line1 || pool.address.city)) ? [pool.address.line1, pool.address.city].filter(Boolean).join(", ") : "";
    bar.hidden = false;
    const isAdmin = portal.companies[0] && portal.companies[0].role === "admin";
    bar.innerHTML = `<button class="client-ctx__back" id="ctxBack">${S.icon("arrow")} Roster</button>
      <span class="client-ctx__who">Servicing <b>${esc(who)}</b>${addr ? " · " + esc(addr) : ""}</span>
      <span class="client-ctx__act">
        <button class="btn btn--ghost btn--sm" id="ctxVisit">${S.icon("wrench")} Log visit</button>
        ${isAdmin ? `<button class="btn btn--ghost btn--sm" id="ctxAssign">${S.icon("user")} Assign</button>` : ""}
        <a class="btn btn--ghost btn--sm" href="#messages">${S.icon("chat")} Message</a></span>`;
    const back = $("#ctxBack"); if (back) back.addEventListener("click", () => go("roster"));
    const cv = $("#ctxVisit"); if (cv) cv.addEventListener("click", () => { if (window.PORTAL && PORTAL.openVisit) PORTAL.openVisit(pool.id); });
    const ca = $("#ctxAssign"); if (ca) ca.addEventListener("click", () => { if (window.PORTAL && PORTAL.openAssign) PORTAL.openAssign(pool.id); });
  }

  /* ===================================================================
     ONBOARDING WIZARD
     =================================================================== */
  let wiz = null;
  function openOnboarding(edit) {
    wiz = {
      step: 0, edit: !!edit,
      data: edit ? JSON.parse(JSON.stringify(state.profile)) : {
        name: "My Pool", climate: "", surface: "", sanitizer: "", shape: "", dims: {}, avgDepth: 5,
        filter: "", chlorinePct: "10", acidPct: "31.45", region: "", volume: 0,
        seedReading: {}, tempF: 82,
      },
    };
    const ob = $("#onboarding");
    ob.hidden = false;
    // Escapable when the user already has a pool (editing/re-opening) — first-run setup still guides
    // them through, but they can always dismiss with Esc or a backdrop click if they have data.
    if (!ob._escWired) {
      ob._escWired = true;
      ob.addEventListener("click", (e) => { if (e.target === ob && canDismissWizard()) wizAction("skip"); });
      document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !ob.hidden && canDismissWizard()) wizAction("skip"); });
    }
    renderWizard();
  }
  function canDismissWizard() { return !!(state.profile || (state.log && state.log.length)); }
  function closeOnboarding() { $("#onboarding").hidden = true; }

  const WIZ_STEPS = ["welcome", "place", "shape", "size", "equipment", "chemicals", "firsttest", "done"];

  function renderWizard() {
    const o = $("#onboarding");
    const total = WIZ_STEPS.length;
    const stepName = WIZ_STEPS[wiz.step];
    const bars = WIZ_STEPS.map((_, i) => `<div class="wiz-step ${i < wiz.step ? "done" : i === wiz.step ? "active" : ""}"><span></span></div>`).join("");
    o.innerHTML = `<div class="sheet sheet--wide" role="document">
      ${wiz.step > 0 && wiz.step < total - 1 ? `<div class="wiz-steps">${bars}</div>` : ""}
      <div class="sheet__body" id="wizBody"></div>
      <div class="sheet__foot" id="wizFoot"></div>
    </div>`;
    const body = $("#wizBody"), foot = $("#wizFoot");
    const d = wiz.data;

    if (stepName === "welcome") {
      body.innerHTML = `
        <div class="center" style="padding:8px 4px 0">
          <div style="width:120px;margin:0 auto 6px">${S.brand()}</div>
          <span class="wiz-num">Welcome aboard</span>
          <h1 style="margin:.2em 0">Let's get your pool perfect.</h1>
          <p class="lead" style="margin:0 auto;max-width:46ch">I'm your pool copilot. In about a minute I'll learn a few things about your pool, then guide you — step by step — to crystal-clear water. <strong>No chemistry degree required.</strong></p>
          <div class="figure" style="max-width:420px;margin:18px auto 0">${S.sunscreen()}</div>
          <p class="muted" style="font-size:.85rem;max-width:48ch;margin:14px auto 0">Built on the trusted <strong>Trouble Free Pool</strong> method — the same approach that keeps tens of thousands of pools clear without the guesswork (or the pool-store upsells).</p>
        </div>`;
      foot.innerHTML = `<button class="btn btn--ghost" data-wiz="skip">I'll explore first</button><div style="flex:1"></div><button class="btn btn--primary btn--lg" data-wiz="next">Let's go ${S.icon("arrow")}</button>`;
    }

    if (stepName === "place") {
      body.innerHTML = `
        <span class="wiz-num">Step 1 · Your climate &amp; surface</span>
        <h2>Where's your pool, and what's it made of?</h2>
        <p class="muted">This tunes your chlorine targets and scale management.</p>
        <div class="field"><label>Climate ${infoHTML("Hot, sunny climates burn chlorine faster, so we aim for a bit more stabilizer (CYA).")}</label>
          ${choiceGroup("climate", [
            ["desert", "Desert / very hot", "sun", "AZ, NV, inland CA"],
            ["hot", "Hot &amp; sunny", "sun", "FL, TX, Southeast"],
            ["temperate", "Temperate", "droplet", "Most of the US"],
            ["cool", "Cool / short season", "droplet", "Northern climates"],
          ], d.climate)}
        </div>
        <div class="field"><label>Pool surface ${infoHTML("Plaster/pebble/tile pools care about calcium &amp; CSI. Vinyl &amp; fiberglass don't.")}</label>
          ${choiceGroup("surface", [
            ["plaster", "Plaster / gunite", "droplet", "Most common; cares about CSI"],
            ["pebble", "Pebble / quartz", "droplet", "Like plaster"],
            ["vinyl", "Vinyl liner", "droplet", "Calcium not critical"],
            ["fiberglass", "Fiberglass", "droplet", "Calcium not critical"],
          ], d.surface)}
        </div>
        <div class="field"><label>Region (optional)</label><input class="input" id="wiz-region" value="${esc(d.region || "")}" placeholder="e.g. Scottsdale, AZ"></div>`;
      foot.innerHTML = footNav();
    }

    if (stepName === "shape") {
      body.innerHTML = `
        <span class="wiz-num">Step 2 · Shape</span>
        <h2>What shape is your pool?</h2>
        <p class="muted">We'll use this to estimate how much water it holds.</p>
        <div class="choices" style="margin-bottom:14px">
          ${D.SHAPES.map((sh) => `<label class="choice ${d.shape === sh.key ? "is-sel" : ""}" data-choice="shape" data-val="${sh.key}">
            <span class="choice__ic" style="width:54px;height:40px">${S.poolShape(sh.key, {})}</span>
            <span><span class="choice__t">${sh.name}</span><br><span class="choice__d">${sh.desc}</span></span>
            <input type="radio" name="shape" ${d.shape === sh.key ? "checked" : ""}></label>`).join("")}
        </div>`;
      foot.innerHTML = footNav();
    }

    if (stepName === "size") {
      const shName = (D.SHAPES.find((x) => x.key === d.shape) || {}).name || "pool";
      body.innerHTML = `
        <span class="wiz-num">Step 3 · Size</span>
        <h2>Roughly how big is your ${shName.toLowerCase()}?</h2>
        <p class="muted">Type your measurements — the drawing and the math update <strong>live</strong> as you go. Close is fine; measure in feet.</p>
        <div class="size-grid">
          <div class="size-left">
            <div class="figure size-fig" id="sizeFig"></div>
            <div class="size-stats" id="sizeStats"></div>
          </div>
          <div class="size-right" id="sizeInputs"></div>
        </div>`;
      renderSizeInputs();
      foot.innerHTML = footNav();
    }

    if (stepName === "equipment") {
      body.innerHTML = `
        <span class="wiz-num">Step 4 · Equipment</span>
        <h2>How do you chlorinate &amp; filter?</h2>
        <div class="field"><label>How do you add chlorine? <span class="badge">pick all that apply</span> ${infoHTML("Lots of people use more than one — e.g. liquid chlorine day-to-day plus tablets when they travel. TFP favors liquid (adds nothing extra); tablets quietly raise CYA.")}</label>
          ${choiceMulti("sanitizers", [
            ["liquid", "Liquid chlorine", "droplet", "The TFP daily driver"],
            ["salt", "Salt system (SWG)", "salt", "Auto-generates chlorine"],
            ["tabs", "Tablets (trichlor)", "tablet", "Convenient, raises CYA"],
          ], d.sanitizers || (d.sanitizer ? [d.sanitizer] : []))}
          <div class="hint">We tune your targets to your <strong>primary</strong> method (salt or liquid take priority).</div>
        </div>
        <div class="field"><label>Filter type</label>
          ${choiceGroup("filter", [
            ["sand", "Sand", "droplet", "Backwash to clean"],
            ["cartridge", "Cartridge", "droplet", "Hose it off"],
            ["de", "D.E.", "droplet", "Backwash + recharge"],
          ], d.filter)}
        </div>`;
      foot.innerHTML = footNav();
    }

    if (stepName === "chemicals") {
      body.innerHTML = `
        <span class="wiz-num">Step 5 · Your products</span>
        <h2>What's in your chemical shelf?</h2>
        <p class="muted">So every dose we give you is in the exact strength you own.</p>
        <div class="field"><label>Liquid chlorine strength ${info("strength")}</label>
          <select class="input" id="wiz-cl">
            ${["6", "8.25", "10", "12.5"].map((p) => `<option value="${p}" ${d.chlorinePct === p ? "selected" : ""}>${p}% ${p === "10" ? "(common pool-store)" : p === "8.25" ? "(household bleach)" : p === "12.5" ? "(commercial)" : ""}</option>`).join("")}
          </select></div>
        <div class="field"><label>Muriatic acid strength</label>
          <select class="input" id="wiz-acid">
            ${ACID_STRENGTHS.map((p) => `<option value="${p}" ${d.acidPct === p ? "selected" : ""}>${p}% ${p === "31.45" ? "(full strength)" : p.indexOf("1") === 0 ? "(low-fume / safer)" : ""}</option>`).join("")}
          </select></div>`;
      foot.innerHTML = footNav();
    }

    if (stepName === "firsttest") {
      const r = d.seedReading || {};
      const fld = (k, label, ph, tip) => `<div class="field"><label>${label} ${info(tip || k)}</label>
        <div class="input-group"><input class="input" type="number" step="any" inputmode="decimal" id="seed-${k}" value="${r[k] != null ? r[k] : ""}" placeholder="${ph}"><span class="input-suffix">${D.RANGES[k] ? D.RANGES[k].unit || "ppm" : "ppm"}</span></div><div class="range-hint" id="livew-${k}">${rangeText(k) ? `${S.icon("info")} <span>${rangeText(k)}</span>` : ""}</div></div>`;
      body.innerHTML = `
        <span class="wiz-num">Step 6 · Your first test</span>
        <h2>What are your numbers today?</h2>
        <p class="muted">Enter whatever you have — skip anything you haven't tested. You can always add the rest later. <strong>CYA and FC matter most.</strong></p>
        <div class="callout callout--sun" style="margin-bottom:16px">${S.icon("info")}<div>No test kit yet? Get an <b>FAS-DPD drop kit</b> — a <b>Taylor K-2006C</b> or the TFP-favourite <b>TF-100 / TF-Pro</b> (test strips are too vague). For now, tap <b>“Skip for now”</b> below and we'll assume CYA 40.</div></div>
        <div class="grid cols-2">
          ${fld("fc", "Free Chlorine", "e.g. 3")}
          ${fld("cc", "Combined Chlorine", "e.g. 0")}
          <div class="field"><label>Total Chlorine ${infoHTML("Only if your kit gives a single chlorine number (an OTO/yellow test). That's TC = FC + CC — we'll split it for you. Skip it if you tested FC above.")}</label>
            <div class="input-group"><input class="input" type="number" step="any" inputmode="decimal" id="seed-tc" placeholder="OTO kits"><span class="input-suffix">ppm</span></div>
            <div class="range-hint" id="livew-tc">${S.icon("info")} <span>only if your kit gives one chlorine number</span></div></div>
          ${fld("ph", "pH", "e.g. 7.6", "ph")}
          ${fld("cya", "Cyanuric Acid (CYA)", "e.g. 50")}
          ${fld("ta", "Total Alkalinity", "e.g. 70")}
          ${fld("ch", "Calcium Hardness", "e.g. 350")}
          ${d.sanitizer === "salt" ? fld("salt", "Salt", "e.g. 3200") : ""}
          <div class="field"><label>Water temp (°F)</label><div class="input-group"><input class="input" type="number" id="seed-temp" value="${d.tempF || ""}" placeholder="82"><span class="input-suffix">°F</span></div></div>
        </div>`;
      foot.innerHTML = `<button class="btn btn--ghost" data-wiz="back">Back</button><div style="flex:1"></div>
        <button class="btn btn--ghost" data-wiz="skiptest">${S.icon("skip")} Skip for now</button>
        <button class="btn btn--primary btn--lg" data-wiz="next">See my plan ${S.icon("arrow")}</button>`;
    }

    if (stepName === "done") {
      // finalize already happened; show celebration
      body.innerHTML = `<div class="center" style="padding:6px 4px">
        <div class="figure" style="max-width:220px;margin:0 auto">${S.celebrate()}</div>
        <h1 style="margin:.1em 0">You're all set!</h1>
        <p class="lead" style="max-width:42ch;margin:0 auto">Your pool profile is saved. Head to your <strong>Dashboard</strong> to see exactly what to do next.</p>
      </div>`;
      foot.innerHTML = `<div style="flex:1"></div><button class="btn btn--primary btn--lg" data-wiz="finish">Open my dashboard ${S.icon("arrow")}</button>`;
    }

    wireWizard();
  }

  function footNav(nextLabel) {
    return `<button class="btn btn--ghost" data-wiz="back">Back</button><div style="flex:1"></div>
      <button class="btn btn--primary btn--lg" data-wiz="next">${nextLabel || "Continue"} ${S.icon("arrow")}</button>`;
  }
  function choiceGroup(field, opts, sel) {
    return `<div class="choices">${opts.map((o) => `<label class="choice ${sel === o[0] ? "is-sel" : ""}" data-choice="${field}" data-val="${o[0]}">
      <span class="choice__ic">${S.icon(o[2])}</span>
      <span><span class="choice__t">${o[1]}</span><br><span class="choice__d">${o[3] || ""}</span></span>
      <input type="radio" name="${field}" ${sel === o[0] ? "checked" : ""}></label>`).join("")}</div>`;
  }
  function primarySanitizer(sel) {
    sel = sel || [];
    return sel.indexOf("salt") >= 0 ? "salt" : sel.indexOf("liquid") >= 0 ? "liquid" : sel[0] || "";
  }
  function choiceMulti(field, opts, sel) {
    sel = sel || [];
    const primary = primarySanitizer(sel);
    return `<div class="choices">${opts.map((o) => `<label class="choice ${sel.indexOf(o[0]) >= 0 ? "is-sel" : ""}" data-mchoice="${field}" data-val="${o[0]}">
      <span class="choice__ic">${S.icon(o[2])}</span>
      <span><span class="choice__t">${o[1]}${primary === o[0] ? ' <span class="badge" style="background:var(--aqua);color:#fff">primary</span>' : ""}</span><br><span class="choice__d">${o[3] || ""}</span></span>
      <input type="checkbox" ${sel.indexOf(o[0]) >= 0 ? "checked" : ""}></label>`).join("")}</div>`;
  }
  // dimension field metadata per shape
  function dimFields(shape) {
    if (shape === "L") return [
      { k: "a", label: "Long arm — length", tip: "The longer leg of the L, end to end." },
      { k: "w", label: "Long arm — width", tip: "How wide that long leg is." },
      { k: "b", label: "Short arm — length", tip: "The shorter leg of the L." },
      { k: "w2", label: "Short arm — width", tip: "How wide the short leg is (often the same)." },
    ];
    if (shape === "round") return [{ k: "d", label: "Diameter", tip: "Straight across the middle." }];
    if (shape === "oval") return [{ k: "a", label: "Length (long way)", tip: "The longest measurement." }, { k: "w", label: "Width (short way)", tip: "The widest across the short way." }];
    return [{ k: "a", label: "Length", tip: "The longer side." }, { k: "w", label: "Width", tip: "The shorter side." }];
  }
  function renderSizeInputs() {
    const d = wiz.data; const shape = d.shape || "rectangle";
    if (d.shallow == null) d.shallow = 3.5;
    if (d.deep == null) d.deep = d.avgDepth ? Math.max(d.avgDepth, 6) : 6.5;
    let html = `<div class="size-section"><div class="size-section__h">${S.icon("ruler")} Measurements</div>`;
    dimFields(shape).forEach((f) => {
      html += `<div class="field"><label>${f.label} (ft) ${infoHTML(f.tip)}</label><div class="input-group"><input class="input" type="number" step="any" inputmode="decimal" data-dim="${f.k}" value="${d.dims[f.k] != null ? d.dims[f.k] : ""}" placeholder="0"><span class="input-suffix">ft</span></div></div>`;
    });
    html += `</div><div class="size-section"><div class="size-section__h">${S.icon("droplet")} Depth ${infoHTML("Average depth drives the volume. If you only know one number, put it in both.")}</div>
      <div class="field-row">
        <div class="field"><label>Shallow end (ft)</label><div class="input-group"><input class="input" type="number" step="any" id="size-shallow" value="${d.shallow}"><span class="input-suffix">ft</span></div></div>
        <div class="field"><label>Deep end (ft)</label><div class="input-group"><input class="input" type="number" step="any" id="size-deep" value="${d.deep}"><span class="input-suffix">ft</span></div></div>
      </div>
      <div class="figure" id="sizeDepthFig" style="margin-top:4px"></div>
    </div>`;
    $("#sizeInputs").innerHTML = html;
    $$("#sizeInputs [data-dim]").forEach((i) => i.addEventListener("input", recalcSize));
    $("#size-shallow").addEventListener("input", recalcSize);
    $("#size-deep").addEventListener("input", recalcSize);
    recalcSize();
  }
  function recalcSize() {
    const d = wiz.data; const shape = d.shape || "rectangle";
    dimFields(shape).forEach((f) => { const i = $(`#sizeInputs [data-dim="${f.k}"]`); if (i) d.dims[f.k] = parseFloat(i.value) || 0; });
    const sh = parseFloat(($("#size-shallow") || {}).value), dp = parseFloat(($("#size-deep") || {}).value);
    if (!isNaN(sh)) d.shallow = sh; if (!isNaN(dp)) d.deep = dp;
    d.avgDepth = Math.round(((d.shallow + d.deep) / 2) * 10) / 10;
    d.volume = C.volume(shape, d.dims, d.avgDepth);
    const area = Math.round(C.surfaceArea(shape, d.dims));
    const perim = Math.round(C.perimeter(shape, d.dims));
    const fillHrs = d.volume ? d.volume / 12 / 60 : 0; // one ~12 GPM hose
    // live diagram
    $("#sizeFig").innerHTML = S.poolDimDiagram(shape, d.dims);
    $("#sizeDepthFig") && ($("#sizeDepthFig").innerHTML = S.poolDepth(d.shallow, d.deep));
    // stats
    const stat = (label, val) => `<div class="size-stat"><span>${label}</span><b>${val}</b></div>`;
    let breakdown = "";
    if (shape === "L" && d.dims.a && d.dims.w && d.dims.b > d.dims.w) {
      breakdown = `<div class="size-stat size-stat--note">${S.icon("info")} Long arm ${d.dims.a}×${d.dims.w} + short-arm overhang ${d.dims.w2}×${Math.round(d.dims.b - d.dims.w)} = <b>${area} ft²</b></div>`;
    }
    $("#sizeStats").innerHTML =
      `<div class="size-stat size-vol"><span>Estimated volume</span><b>${d.volume ? d.volume.toLocaleString() + " gal" : "—"}</b><em>${d.volume ? "≈ " + (fillHrs < 1 ? Math.round(fillHrs * 60) + " min" : (Math.round(fillHrs * 10) / 10) + " hrs") + " to fill with one garden hose" : "enter your sizes →"}</em></div>` +
      stat("Surface area", area ? area + " ft²" : "—") +
      stat("Perimeter", perim ? perim + " ft" : "—") +
      stat("Avg depth", d.avgDepth ? d.avgDepth + " ft" : "—") +
      stat("Shape", (D.SHAPES.find((x) => x.key === shape) || {}).name || "—") +
      breakdown;
  }

  function wireWizard() {
    const o = $("#onboarding");
    $$("[data-choice]", o).forEach((ch) => ch.addEventListener("click", () => {
      const f = ch.getAttribute("data-choice"), v = ch.getAttribute("data-val");
      wiz.data[f] = v;
      $$(`[data-choice="${f}"]`, o).forEach((x) => x.classList.toggle("is-sel", x === ch));
      const rb = $("input", ch); if (rb) rb.checked = true;
    }));
    // multi-select (chlorination methods)
    $$("[data-mchoice]", o).forEach((ch) => ch.addEventListener("click", (e) => {
      e.preventDefault();
      const f = ch.getAttribute("data-mchoice"), v = ch.getAttribute("data-val");
      wiz.data[f] = wiz.data[f] || [];
      const arr = wiz.data[f], i = arr.indexOf(v);
      if (i >= 0) arr.splice(i, 1); else arr.push(v);
      renderWizard(); // re-render so the "daily" badge & order update
    }));
    // live feedback on the first-test step
    $$("[id^='seed-']", o).forEach((i) => i.addEventListener("input", liveWizUpdate));
    if ($("#seed-fc")) liveWizUpdate();
    // buttons
    $$("[data-wiz]", o).forEach((b) => b.addEventListener("click", () => wizAction(b.getAttribute("data-wiz"))));
  }

  function wizAction(act) {
    const d = wiz.data;
    if (act === "skip") { closeOnboarding(); go("learn"); return; }
    if (act === "skiptest") {
      d.seedReading = {};
      const tmp = $("#seed-temp"); if (tmp && tmp.value) d.tempF = parseFloat(tmp.value);
      commitProfile(); wiz.step++; renderWizard(); return;
    }
    if (act === "back") { wiz.step = Math.max(0, wiz.step - 1); renderWizard(); return; }
    if (act === "finish") { closeOnboarding(); go("dashboard"); return; }
    if (act === "next") {
      // capture per-step
      const stepName = WIZ_STEPS[wiz.step];
      if (stepName === "place") { const reg = $("#wiz-region"); if (reg) d.region = reg.value.trim(); if (!d.climate || !d.surface) { toast("Pick a climate and surface to continue.", "warn"); return; } }
      if (stepName === "shape") { if (!d.shape) { toast("Choose a shape.", "warn"); return; } }
      if (stepName === "size") { recalcSize(); if (!d.volume) { toast("Add your sizes so I can estimate the volume.", "warn"); return; } }
      if (stepName === "equipment") {
        if (!(d.sanitizers && d.sanitizers.length) || !d.filter) { toast("Pick at least one chlorine method and your filter.", "warn"); return; }
        d.sanitizer = primarySanitizer(d.sanitizers);
      }
      if (stepName === "chemicals") { const cl = $("#wiz-cl"), ac = $("#wiz-acid"); if (cl) d.chlorinePct = cl.value; if (ac) d.acidPct = ac.value; }
      if (stepName === "firsttest") {
        const r = {};
        ["fc", "cc", "ph", "ta", "ch", "cya", "salt"].forEach((k) => { const i = $("#seed-" + k); if (i && i.value !== "") r[k] = parseFloat(i.value); });
        const tcS = $("#seed-tc"); if (tcS && tcS.value !== "") applyTC(r, parseFloat(tcS.value)); // OTO/total-chlorine → FC/CC
        const tmp = $("#seed-temp"); if (tmp && tmp.value) { d.tempF = parseFloat(tmp.value); r.temp = d.tempF; }
        d.seedReading = r;
        commitProfile();
      }
      wiz.step++;
      renderWizard();
    }
  }
  function commitProfile() {
    const d = wiz.data;
    state.profile = JSON.parse(JSON.stringify(d));
    // seed the log with the first reading if numbers were given
    if (!wiz.edit && d.seedReading && Object.keys(d.seedReading).length) {
      state.log = state.log || [];
      if (!state.log.length) state.log.push({ t: Date.now(), reading: d.seedReading, note: "Initial readings" });
    }
    // Account mode with no pool yet → create it on the server now, then future saves sync to it.
    if (portal.mode === "account" && !portal.pool) { portalCreatePool(); return; }
    save(); updateAppbar();
  }
  // Create a new pool on the account from the current local `state` (first-run in account mode).
  function portalCreatePool() {
    saveLocal();
    setSyncChip("saving");
    API.createPool({ profile: state.profile, slam: state.slam })
      .then((res) => {
        if (!res || !res.pool) return;
        portal.pool = res.pool; portal.selectedPoolId = res.pool.id;
        portal.pools.push({ id: res.pool.id, name: res.pool.name, profile: state.profile, role: "owner", lastReadingAt: null, attentionScore: 0, attentionFlags: [], unread: 0 });
        try { localStorage.setItem(PORTAL_KEY, JSON.stringify({ uid: portal.user && portal.user.id, pid: res.pool.id })); } catch (e) {}
        // push the seed reading(s) we just created locally
        (state.log || []).forEach((entry) => { if (entry.id == null) portalAddReading(entry); });
        API.updateMe({ prefs: { selectedPoolId: res.pool.id } }).catch(() => {});
        updateAppbar(); setSyncChip("saved");
      })
      .catch((e) => { setSyncChip(e && e.network ? "offline" : "error"); toast("Couldn't save your pool to your account — it's saved on this device.", "warn"); });
  }

  // count a number up to its value (delight); respects calm mode + reduced-motion
  function countUp(el, to) {
    if (!el || to == null || isNaN(to)) return;
    if (document.documentElement.getAttribute("data-calm") === "1" || (window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches)) { el.textContent = to; return; }
    const start = performance.now(), dur = 700;
    const tick = (now) => { const k = Math.min(1, (now - start) / dur); el.textContent = Math.round(to * (1 - Math.pow(1 - k, 3))); if (k < 1) requestAnimationFrame(tick); else el.textContent = to; };
    requestAnimationFrame(tick);
  }
  // Predictive 7-day FC outlook: projects chlorine forward from the measured burn rate
  // (weather-adjusted), flags when it crosses the minimum, and sizes a top-up dose.
  function sevenDayOutlook(p, r) {
    if (!(state.log && state.log.length >= 2) || r.fc == null) return "";
    const burn = IN.fcBurn(state.log, state.doses || []);
    const rate = burn && burn.rate;
    if (!rate) return "";
    const swg = p.sanitizer === "salt";
    const t = C.fcTargets(r.cya != null ? r.cya : 40, swg);
    const wx = (window.WEATHER && WEATHER.cached) ? WEATHER.cached() : null;
    let daily = rate, wxNote = "";
    if (wx && (wx.heatDays >= 2 || (wx.waterTempF || 0) >= 88)) { daily = Math.max(rate * 1.3, 4); wxNote = ", heat-adjusted"; }
    const vol = p.volume || 14000;
    const days = []; let fc = +r.fc, crossDay = null;
    for (let d = 0; d <= 7; d++) { days.push({ d: d, fc: Math.max(0, fc) }); if (crossDay == null && fc < t.min) crossDay = d; fc -= daily; }
    const maxFc = Math.max(t.slam, +r.fc, t.targetHi) || 10;
    const bars = days.map((x) => {
      const st = x.fc >= t.targetLo ? "good" : x.fc >= t.min ? "warn" : "bad";
      const h = Math.max(4, Math.round((x.fc / maxFc) * 100));
      return `<div class="fc7__col"><div class="fc7__bar fc7__bar--${st}" style="height:${h}%" title="Day ${x.d}: ~${Math.round(x.fc * 10) / 10} ppm"></div><span class="fc7__lbl">${x.d === 0 ? "now" : "+" + x.d}</span></div>`;
    }).join("");
    const dose = C.chlorineGallons(t.target - (+r.fc), vol, p.chlorinePct);
    const lead = crossDay != null
      ? `At ~<b>${Math.round(daily * 10) / 10} ppm/day${wxNote}</b>, FC drops below the minimum (${t.min}) in about <b>${crossDay === 0 ? "today" : crossDay + " day" + (crossDay > 1 ? "s" : "")}</b>.`
      : `At ~<b>${Math.round(daily * 10) / 10} ppm/day${wxNote}</b>, you're covered for the next 7 days. 👍`;
    return `<div class="card pad-lg fc7-card">
      <div class="card__title">${S.icon("plan")} 7-day chlorine outlook</div>
      <p class="muted" style="margin:-2px 0 10px;font-size:.88rem">${lead}</p>
      <div class="fc7">${bars}</div>
      <div class="fc7__legend muted"><span><i class="fc7__dot fc7__dot--good"></i> in range</span><span><i class="fc7__dot fc7__dot--warn"></i> low</span><span><i class="fc7__dot fc7__dot--bad"></i> below min</span></div>
      ${crossDay != null && dose ? `<div class="callout" style="margin-top:10px;font-size:.86rem">${S.icon("droplet")}<div>Add <b>${C.fmtGal(dose)}</b> of ${p.chlorinePct}% chlorine now to reach your target (${t.target}). <a href="#chem">Track it</a></div></div>` : ""}
    </div>`;
  }
  // Evaporation / top-off estimate from current weather (desert-friendly heuristic).
  function evapCard(p, wx) {
    if (!wx) return "";
    const area = C.surfaceArea ? C.surfaceArea(p.shape, p.dims || {}) : 0;
    if (!area) return "";
    const tw = wx.waterTempF || wx.todayHiF || 80, wind = wx.windMph || 0, hum = wx.humidity != null ? wx.humidity : 40;
    let evapIn = 0.05 + (tw - 65) * 0.0045 + wind * 0.006 - (hum - 30) * 0.0014;
    evapIn = Math.max(0.03, Math.min(0.5, evapIn));
    const gal = Math.round((evapIn / 12) * area * 7.48);
    return `<div class="card pad-lg">
      <div class="card__title">${S.icon("droplet")} Evaporation &amp; top-off</div>
      <p class="muted" style="margin:-2px 0 8px;font-size:.88rem">About <b>${evapIn.toFixed(2)} in/day</b> (~<b>${gal} gal</b>) is evaporating in today's conditions — top off with fresh water to hold your level.</p>
      <p class="muted" style="font-size:.82rem">Evaporation leaves minerals behind, slowly concentrating <b>CH, CYA &amp; salt</b> (and tap top-offs add a little calcium). Re-test those after big top-offs.</p>
    </div>`;
  }

  /* ===================================================================
     DASHBOARD
     =================================================================== */
  RENDER.dashboard = function () {
    // A company member with no specific pool open has no personal pool to show — their
    // home is the roster. Redirect rather than render a confusing "your pool" hero.
    if (portal.mode === "account" && portal.companies && portal.companies.length && !(portal.pool && portal.pool.id)) {
      go("roster", true); return;
    }
    const p = profile(); const r = latest();
    const v = $("#view-dashboard");
    const h = IN.health(p, state.log || []);
    const pl = C.plan(p, r);
    const topActions = pl.actions.filter((a) => a.prio === "now" || a.prio === "soon").slice(0, 3);
    const okState = topActions.length === 0;
    const perfect = okState && h.state === "good";
    // No real test logged yet → the numbers shown are setup estimates, not measured data.
    const noRealTest = !(state.log && state.log.length);
    const fcT = pl.fcTargets;
    const chemObs = (window.CHEM && CHEM.observations) ? CHEM.observations(chemCtx()) : [];
    const baseInsights = chemObs.concat(IN.detect(p, state.log || [], Date.now(), state.doses || []));
    // weather: merge pool-care warnings into the same "What I'm noticing" list (same object shape)
    const wx = (window.WEATHER && WEATHER.cached) ? WEATHER.cached() : null;
    const wxWarn = wx ? WEATHER.warnings(wx, p, r) : [];
    const SEV = { urgent: 0, watch: 1, info: 2, good: 3 };
    let allObs = baseInsights.concat(wxWarn).sort((a, b) => (SEV[a.severity] - SEV[b.severity]));
    // ACTIVITIES: reinterpret observations given what the user told us they're doing
    // (aerating, lowering TA, draining, away…) — suppress conflicting advice, add status
    // banners, and surface "are you doing X?" prompts the chemistry can't infer alone.
    let actBanners = [], actPrompts = [];
    if (window.ACTIVITIES) {
      const ri = ACTIVITIES.reinterpret(allObs, actCtx());
      allObs = ri.observations; actBanners = ri.banners; actPrompts = ri.prompts;
    }
    const insights = allObs;
    const urgentWx = wxWarn.find((o) => o.severity === "urgent");
    const wxBanner = urgentWx ? `<div class="callout callout--bad" style="margin-bottom:16px">${S.icon(urgentWx.icon)}<div><b>${urgentWx.title}.</b> ${urgentWx.recommend}</div></div>` : "";

    // Company member viewing a client's pool → service-oriented hero, not "your pool".
    const servicing = portal.mode === "account" && portal.companies && portal.companies.length && portal.pool && portal.pool.role !== "owner";
    const clientName = servicing && portal.pool.owner && portal.pool.owner.name ? portal.pool.owner.name : null;
    // Ambient widgets (weather, chem mixing, quick-context) grouped under one labeled band
    // so they read as a "snapshot" rather than an un-headed wall before the numbered actions.
    const ambient = [
      (window.WEATHER && wx) ? WEATHER.widget(wx, p.geo && p.geo.name) : "",
      sevenDayOutlook(p, r),
      (window.WEATHER && wx) ? evapCard(p, wx) : "",
      (window.CHEM && CHEM.dashboardWidget) ? CHEM.dashboardWidget(chemCtx()) : "",
      (window.ACTIVITIES && state.log && state.log.length) ? ACTIVITIES.quickRow(actCtx()) : "",
    ].filter(Boolean).join("");
    const ambientBand = ambient
      ? `${sectionHead("cloud", "Today around your pool", "Live conditions and context — at a glance.")}<div class="ambient-band">${ambient}</div>`
      : "";
    v.innerHTML = `
      ${wxBanner}
      <div class="hero" style="margin-bottom:22px">
        <div class="hero__copy hero__copy--dash" style="position:relative;z-index:1">
          <span class="eyebrow" style="color:#bdf0fa">${p.name || "My Pool"}${p.region ? " · " + esc(p.region) : ""}</span>
          <h1>${noRealTest && !servicing ? "Welcome to your pool. 🏊"
            : servicing
            ? (perfect ? `${clientName ? esc(clientName) + "'s" : "This"} water is dialed in. 🎉` : okState ? "Looking good — minor tweaks." : "Here's this pool, right now.")
            : (perfect ? "Your water is dialed in. 🎉" : okState ? "Looking good — just fine-tuning." : "Here's your pool, right now.")}</h1>
          <p>${noRealTest && !servicing
            ? "Log your first water test and I'll turn it into an exact, step-by-step plan. The numbers below are just typical starting values until then."
            : perfect ? `Every key number is in its ideal range.${servicing ? "" : " Keep testing every couple of days and top up chlorine as it's used."}` : okState ? `${h.total ? `${h.good} of ${h.total} numbers are spot-on, the rest are acceptable.` : ""} Nothing urgent — see the optional tweaks below.` : `${h.total ? `${h.good} of ${h.total} key numbers are in range.` : "Log a test to see exactly what to do."} ${servicing ? "Here are the service moves." : "I've laid out your next moves below."}`}</p>
          <div class="btnrow" style="margin-top:6px">
            <a class="btn btn--sun btn--lg" href="#log">${S.icon("beaker")} ${noRealTest ? "Log my first test" : "Log a test"}</a>
            ${noRealTest ? "" : `<a class="btn btn--ghost btn--lg" href="#plan" style="border-color:rgba(255,255,255,.4);color:#fff">Full plan ${S.icon("arrow")}</a>`}
          </div>
        </div>
        <div class="hero__art">${S.heroScene()}</div>
      </div>

      ${(window.ENGAGE && (state.log && state.log.length)) ? ENGAGE.heroStrip(engageCtx()) : ""}
      ${(window.ACTIVITIES && actPrompts.length) ? cardsMore(actPrompts.map((x) => ACTIVITIES.promptCard(x)), 2, "prompt") : ""}
      ${(window.ACTIVITIES && actBanners.length) ? cardsMore(actBanners.map((b) => ACTIVITIES.bannerHTML(b)), 2, "update") : ""}
      ${state.slam && state.slam.active ? slamBanner() : ""}
      ${ambientBand}

      ${sectionHead(1, "Do this now", "Your next moves — most urgent first. Every dose is calculated for your pool.", "plan")}
      <div class="grid cols-3" style="margin-bottom:22px;align-items:start">
        <div class="do-now-main">
          <div class="stack" id="dashActions">
            ${(okState ? [pl.actions[0]] : topActions).map((a, i) => actionCard(a, i + 1)).join("")}
          </div>
          ${pl.actions.length > (okState ? 1 : topActions.length) ? `<a class="btn btn--ghost" href="#plan" style="margin-top:12px">See ${okState ? "optional tweaks" : "all " + pl.actions.length + " steps"} ${S.icon("arrow")}</a>` : ""}
        </div>
        <div>
          <div class="card pad-lg" style="text-align:center">
            <div class="card__title" style="justify-content:center">Pool health ${infoHTML("A quick read on how many of your key numbers are in their ideal range right now.")}</div>
            <div style="max-width:150px;margin:6px auto">${S.waterOrb(h.score != null ? h.score / 100 : 0, h.state === "good" ? "#20c997" : h.state === "warn" ? "#f59f00" : h.state === "bad" ? "#fa5252" : "#8ba3ac", h.score != null ? h.score : "?", h.score != null ? "health" : "no data")}</div>
            <span class="chip ${chipFor(h.state)}">${STATE_LABEL[h.state]}</span>
            ${h.total ? `<div class="muted" style="margin-top:8px;font-size:.82rem">${h.good}/${h.total} numbers ideal${h.trendDir === "improving" ? ' · <span style="color:var(--good);font-weight:700">↑ improving</span>' : h.trendDir === "declining" ? ' · <span style="color:var(--warn);font-weight:700">↓ slipping</span>' : ""}</div>` : ""}
            ${pl.csi != null ? `<div class="muted" style="margin-top:4px;font-size:.82rem">CSI ${pl.csi > 0 ? "+" : ""}${pl.csi} · ${C.classify("csi", pl.csi, p) === "good" ? "balanced ✓" : C.classify("csi", pl.csi, p) === "warn" ? "drifting" : "out of range"}</div>` : ""}
          </div>
        </div>
      </div>

      ${insights.length ? `${sectionHead("learn", "What I'm noticing", "Smart observations from your test history — trends, forecasts &amp; root causes.")}
      <div class="grid cols-2" style="margin-bottom:${insights.length > 4 ? "12" : "24"}px" id="insightGrid">
        ${insights.slice(0, 4).map(insightCard).join("")}
      </div>
      ${insights.length > 4 ? `<details class="more-insights" style="margin-bottom:24px"><summary>+ ${insights.length - 4} more observation${insights.length - 4 > 1 ? "s" : ""}</summary><div class="grid cols-2" style="margin-top:12px">${insights.slice(4).map(insightCard).join("")}</div></details>` : ""}` : ""}

      ${sectionHead(2, "Your numbers", noRealTest ? "Typical starting values — log a test to replace these with your real numbers." : "Tap any tile to log a fresh value. Green = ideal, amber = acceptable, red = needs action. The arrow shows the trend.", "target")}
      ${noRealTest ? `<div class="callout callout--sun" style="margin-bottom:14px">${S.icon("info")}<div>These are <b>estimates</b> from your setup, not a real test. <a href="#log">Log your first test</a> for numbers tuned to your pool.</div></div>` : ""}
      <div class="param-grid ${noRealTest ? "is-estimate" : ""}" style="margin-bottom:24px" id="paramGrid">
        ${dashParams(p, r).join("")}
      </div>

      <div class="wave-divider" aria-hidden="true">${S.waveDivider()}</div>

      ${sectionHead(3, "Why these targets?", "The one relationship that runs every number in your pool.", "learn")}
      <div class="card pad-lg spotlight-card" style="margin-bottom:8px">
        <div class="grid cols-2" style="align-items:center;gap:24px">
          <div>
            <div class="card__title">${S.icon("droplet")} The one ratio that runs your pool ${infoHTML("In a stabilized (outdoor) pool, the right chlorine level is set by your CYA — not a fixed number. This is the core of the TFP method.")}</div>
            <p class="muted">Your chlorine target rides on your <strong>CYA</strong> (stabilizer). ${r.cya != null ? `Right now your CYA is <strong>${r.cya}</strong>, which sets:` : `You haven't tested CYA yet — these assume <strong>CYA 40</strong>. <a href="#log">Test it</a> to dial them in:`}</p>
            <div class="grid cols-3" style="gap:10px">
              <div class="kpi"><b style="color:var(--bad)">${fcT.min}</b><span>minimum FC ${info("minfc")}</span></div>
              <div class="kpi"><b style="color:var(--good)">${fcT.targetLo}–${fcT.targetHi}</b><span>daily target</span></div>
              <div class="kpi"><b style="color:var(--warn)">${fcT.slam}</b><span>SLAM level ${info("slamfc")}</span></div>
            </div>
            <a class="btn btn--ghost btn--sm" href="#learn" style="margin-top:14px">Why? Learn the FC/CYA rule ${S.icon("arrow")}</a>
          </div>
          <div class="figure">${S.fcCyaChart(r.cya != null ? r.cya : null)}<figcaption>As CYA rises, every chlorine target rises with it${r.cya != null ? " — your CYA is highlighted" : ""}.</figcaption></div>
        </div>
      </div>
    `;
    wireDash();
    // kick a background weather refresh; when it returns, persist profile.geo and re-render once
    if (window.WEATHER && p.region) {
      WEATHER.sync(p).then((fresh) => {
        if (!fresh) return;
        const had = wx && wx.at;
        if (!had || fresh.at !== had) { save(); if (go.current === "dashboard") RENDER.dashboard(); }
      }).catch(() => {});
    }
  };

  function actMap(p, r) {
    const m = {};
    try { C.plan(p, r).actions.forEach((a) => { if (a && a.key && !m[a.key]) m[a.key] = a; }); } catch (e) {}
    return m;
  }
  function calcForAction(k, act) {
    if (k === "fc") return "chlorine";
    if (k === "cc") return "slamcalc";
    if (k === "cya") return "cya";
    if (k === "ch") return "ch";
    if (k === "salt") return "salt";
    if (k === "csi") return "csi";
    if (k === "ph") return act && /raise/i.test(act.title) ? "phup" : "acid";
    if (k === "ta") return act && /lower/i.test(act.title) ? "taDown" : "ta";
    return null;
  }
  function dashParams(p, r, acts) {
    acts = acts || actMap(p, r);
    const keys = ["fc", "cc", "ph", "ta", "cya"];
    if (p.surface === "plaster" || p.surface === "pebble" || p.surface === "tile") keys.push("ch");
    if (p.sanitizer === "salt") keys.push("salt");
    return keys.map((k) => {
      const param = D.PARAMS.find((x) => x.key === k);
      const val = r[k];
      const st = C.classify(k, val, p, r);
      const swg = p.sanitizer === "salt";
      let targetTxt = "", ideal = null;
      if (k === "fc") { const t = C.fcTargets(r.cya != null ? r.cya : 40, swg); targetTxt = `aim ${t.targetLo}–${t.targetHi}`; ideal = [t.targetLo, t.targetHi]; }
      else if (D.RANGES[k]) { let id = D.RANGES[k].ideal; if (k === "cya" && swg) id = D.RANGES[k].swgIdeal; ideal = id; targetTxt = k === "cc" ? "aim 0" : `aim ${id[0]}–${id[1]}`; }
      // 7-day trend chip
      let trendChip = "";
      if (state.log && state.log.length >= 2) {
        const tr = IN.trend(state.log, k);
        if (tr.direction !== "steady" && tr.n >= 2) {
          const arrow = tr.direction === "rising" ? "↑" : "↓";
          let cls = "";
          if (ideal) {
            const toward = (tr.latest < ideal[0] && tr.direction === "rising") || (tr.latest > ideal[1] && tr.direction === "falling");
            const away = (tr.latest > ideal[1] && tr.direction === "rising") || (tr.latest < ideal[0] && tr.direction === "falling");
            cls = toward ? "trend-chip--good" : away ? "trend-chip--warn" : "";
          }
          const rate = Math.abs(tr.perWeek);
          const rstr = rate >= 1 ? Math.round(rate) : Math.round(rate * 100) / 100;
          trendChip = `<span class="trend-chip ${cls}" title="7-day trend (~${rstr} ${param.unit || "ppm"}/week ${tr.direction})">${arrow} ${rstr}/wk</span>`;
        }
      }
      const pos = val != null && !isNaN(val) ? C.meterPos(k, +val, p, r) : null;
      const bandColor = st === "good" ? "var(--good-2)" : st === "warn" ? "var(--warn-2)" : st === "bad" ? "var(--bad-2)" : "var(--ink-4)";
      // Shade the ideal band on the meter track so position (in/out of range) is legible
      // without relying on needle color — a non-color cue for color-blind users.
      let idealBand = "";
      if (ideal && C.meterPos) {
        const lo = C.meterPos(k, ideal[0], p, r), hi = C.meterPos(k, ideal[1], p, r);
        if (lo != null && hi != null) { const a = Math.max(0, Math.min(lo, hi) * 100), b = Math.min(100, Math.max(lo, hi) * 100); idealBand = `<span class="meter__ideal" style="left:${a}%;width:${Math.max(3, b - a)}%" aria-hidden="true"></span>`; }
      }
      const needleTitle = st === "good" ? "in the ideal band" : st === "warn" ? "just outside ideal" : st === "bad" ? "out of range" : "";
      const act = (st === "bad" || st === "warn") ? acts[k] : null;
      const fixText = act ? (act.dose ? act.dose.text : act.title.replace(/^(Lower|Bring|Raise|Run a|Nudge) /i, (m) => m).slice(0, 60)) : "";
      const fix = fixText ? `<div class="param__fix" title="${esc((act.dose ? act.dose.text + (act.dose.sub ? " — " + act.dose.sub : "") : act.why || "").replace(/<[^>]+>/g, ""))}">${S.icon("arrow")} ${fixText}</div>` : "";
      const unknown = val == null || isNaN(val);
      const calcId = (act && !unknown && st !== "good") ? calcForAction(k, act) : null;
      const goAttr = unknown || st === "good" ? `data-go="log"` : calcId ? `data-go="calc" data-calc="${calcId}"` : `data-go="plan"`;
      return `<div class="param" data-state="${st}" role="button" tabindex="0" ${goAttr} title="${unknown ? "Tap to add a reading" : st === "good" ? "In range — tap to re-test" : "Tap to fix it"}">
        <div class="param__top">
          <span class="param__name">${param.name} ${info(k)}</span>
          <span class="chip ${chipFor(st)}" style="padding:2px 8px;font-size:.7rem">${st === "unknown" ? "—" : st === "good" ? "good" : st === "warn" ? "ok" : "act"}</span>
        </div>
        <div><span class="param__val">${unknown ? "?" : fmt(val, D.RANGES[k] ? D.RANGES[k].decimals : 1)}</span><span class="param__unit">${param.unit}</span></div>
        <div class="param__trendrow"><span class="param__target">${targetTxt}</span>${trendChip}</div>
        ${pos != null ? `<div class="param__bar"><div class="meter">${idealBand}<div class="meter__needle" style="left:${pos * 100}%;background:${bandColor}" title="${needleTitle}"></div></div></div>` : `<div class="param__target" style="color:var(--ink-4)">tap to add</div>`}
        ${fix}
      </div>`;
    });
  }
  function wireParamTiles(root) {
    $$(".param[data-go]", root).forEach((el) => el.addEventListener("click", (e) => {
      if (e.target.closest(".info")) return;
      const target = el.getAttribute("data-go") || "log";
      if (target === "calc") { state.ui.lastCalc = el.getAttribute("data-calc"); save(); go("calculators"); }
      else go(target);
    }));
  }
  function wireDash() {
    wireParamTiles($("#view-dashboard"));
    wireInsights($("#view-dashboard"));
    $$("#view-dashboard [data-act]").forEach((b) => b.addEventListener("click", onActionClick));
    $$("#view-dashboard .more-insights summary").forEach((s) => s.addEventListener("click", () => setTimeout(() => wireInsights($("#view-dashboard")), 0)));
    if (window.ENGAGE && ENGAGE.wireHeroStrip) ENGAGE.wireHeroStrip($("#view-dashboard"), engageCtx());
    if (window.ACTIVITIES && ACTIVITIES.wire) ACTIVITIES.wire($("#view-dashboard"), actCtx());
    const orbVal = $("#view-dashboard .orb-val"); if (orbVal) { const n = parseInt(orbVal.textContent, 10); if (!isNaN(n)) countUp(orbVal, n); }
  }

  function actionCard(a, n) {
    if (!a) return "";
    let chart = "";
    if (a.chart && a.chart.type === "cyaStaircase") chart = `<div class="figure" style="margin-top:12px">${S.cyaStaircase(a.chart.start, a.chart.frac, a.chart.target)}</div>`;
    if (a.chart && a.chart.type === "csi") chart = `<div class="figure" style="margin-top:12px">${S.csiScale(a.chart.val)}</div>`;
    const timing = { now: "Today", soon: "This week", info: "When you're ready", ok: "" }[a.prio] || "";
    const isSlam = a.key === "cc" || (a.title && a.title.indexOf("SLAM") > -1);
    const calcId = (a.key && a.prio !== "ok" && !isSlam) ? calcForAction(a.key, a) : null;
    // "Test your X" cards (no dose, just measure) → link straight to the log form
    const isTestCard = !a.dose && a.title && /^test\b/i.test(a.title);
    let btn = "";
    if (isSlam) btn = `<button class="btn btn--sm btn--danger" data-act="slam">${S.icon("slam")} Open guided SLAM</button>`;
    else if (isTestCard) btn = `<button class="btn btn--sm" data-act="log">${S.icon("beaker")} Log this reading ${S.icon("arrow")}</button>`;
    else if (calcId) btn = `<button class="btn btn--sm" data-act="calc" data-calc="${calcId}">${S.icon("calc")} ${a.dose ? "Fine-tune in calculator" : "Plan it"} ${S.icon("arrow")}</button>`;
    return `<div class="action" data-prio="${a.prio}">
      <div class="action__num">${a.prio === "ok" ? S.icon("check") : a.prio === "now" ? "!" : n}</div>
      <div class="action__body">
        <div class="action__title">${a.title}${timing ? ` <span class="timing timing--${a.prio}">${timing}</span>` : ""}</div>
        <div class="action__why">${a.why}</div>
        ${a.dose ? `<div class="action__dose">${S.icon("droplet")}<div><b>${a.dose.text}</b>${a.dose.sub ? `<br><span class="muted" style="font-size:.82rem">${a.dose.sub}</span>` : ""}</div></div>` : ""}
        ${chart}
        ${btn ? `<div style="margin-top:10px">${btn}</div>` : ""}
      </div>
    </div>`;
  }
  function onActionClick(e) {
    const act = e.currentTarget.getAttribute("data-act");
    if (act === "slam") go("slam");
    else if (act === "log") go("log");
    else if (act === "calc") { state.ui.lastCalc = e.currentTarget.getAttribute("data-calc"); save(); go("calculators"); }
  }

  function insightCard(ins) {
    const cta = ins.calc ? "Open calculator" : ins.route === "slam" ? "Open SLAM" : ins.route === "log" ? "Log a test" : ins.route === "learn" ? "Learn more" : ins.route === "plan" ? "See plan" : ins.route === "calculators" ? "Open calculator" : "Open";
    return `<div class="insight insight--${ins.severity}">
      <span class="insight__ic">${S.icon(ins.icon)}</span>
      <div class="insight__body">
        <div class="insight__title">${ins.title}</div>
        <div class="insight__detail">${ins.detail}</div>
        ${ins.evidence ? `<div class="insight__evid" title="recent readings">${esc(ins.evidence)}</div>` : ""}
        <div class="insight__rec">${S.icon("arrow")}<span>${ins.recommend}</span></div>
        ${ins.route ? `<button class="btn btn--sm" data-ins-route="${ins.route}" data-ins-calc="${ins.calc || ""}">${cta} ${S.icon("arrow")}</button>` : ""}
      </div>
    </div>`;
  }
  function wireInsights(root) {
    $$("[data-ins-route]", root).forEach((b) => b.addEventListener("click", () => {
      const route = b.getAttribute("data-ins-route"), calc = b.getAttribute("data-ins-calc");
      if (calc) { state.ui.lastCalc = calc; save(); go("calculators"); }
      else go(route);
    }));
  }

  function slamBanner() {
    const p = profile(); const r = latest();
    const t = C.fcTargets(r.cya != null ? r.cya : 40, p.sanitizer === "salt");
    return `<div class="card pad-lg" style="margin-bottom:22px;border:2px solid var(--crit);background:var(--crit-bg)">
      <div class="spread">
        <div><div class="card__title" style="color:var(--crit)">${S.icon("slam")} SLAM in progress</div>
        <p class="muted" style="margin:0">Hold FC at <strong>${t.slam} ppm</strong>. Keep testing &amp; topping up until all 3 exit tests pass.</p></div>
        <a class="btn btn--danger" href="#slam">Open SLAM ${S.icon("arrow")}</a>
      </div></div>`;
  }

  /* ===================================================================
     LOG & TRENDS
     =================================================================== */
  // format a timestamp for a <input type="datetime-local"> (local time, minute precision)
  function toLocalInput(ms) {
    const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }

  RENDER.log = function () {
    const p = profile(); const v = $("#view-log");
    const r = latest();
    const editR = (editingIndex != null && state.log[editingIndex]) ? state.log[editingIndex].reading : null;
    const fldRow = (k, label) => {
      const param = D.PARAMS.find((x) => x.key === k) || { name: label, unit: "ppm" };
      const ev = editR && editR[k] != null ? editR[k] : "";
      return `<div class="field"><label>${param.name} ${info(k)}</label>
        <div class="input-group"><input class="input" type="number" step="any" inputmode="decimal" id="log-${k}" value="${ev}" aria-label="${param.name}${param.unit ? " in " + param.unit : ""}" placeholder="${r[k] != null ? "last: " + r[k] : ""}"><span class="input-suffix">${param.unit || "ppm"}</span></div>
        <div class="range-hint" id="live-${k}">${rangeText(k) ? `${S.icon("info")} <span>${rangeText(k)}</span>` : ""}</div></div>`;
    };
    v.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">${S.icon("log")} Test &amp; Log</span>
        <h1>Log today's test</h1>
        <p class="lead">Enter the numbers from your test kit below — leave blank anything you didn't measure. Each save updates your dashboard, plan &amp; trends. The green hints show the healthy range for each.</p>
      </div>
      ${sectionHead(1, "Enter your readings", "Only the ones you tested. CYA &amp; FC matter most.", "beaker")}
      <div class="grid cols-2" style="align-items:start;gap:22px">
        <div class="card pad-lg">
          <form id="logForm" novalidate>
          ${editR ? `<div class="callout callout--warn" style="margin-bottom:14px">${S.icon("info")}<div>Editing your reading from <b>${new Date(state.log[editingIndex].t).toLocaleString([], { dateStyle: "medium", timeStyle: "short" })}</b> — change any values and hit <b>Update</b>.</div></div>` : ""}
          <div class="grid cols-2" style="gap:12px">
            ${fldRow("fc")}${fldRow("cc")}
            <div class="field"><label>Total Chlorine ${infoHTML("Cheap OTO kits give a single chlorine number — that's <b>Total Chlorine</b> (FC + CC), not Free Chlorine. Enter it and we'll work out the rest. Leave blank if your kit reads FC directly.")}</label>
              <div class="input-group"><input class="input" type="number" step="any" inputmode="decimal" id="log-tc" aria-label="Total Chlorine in ppm" placeholder="OTO kits"><span class="input-suffix">ppm</span></div>
              <div class="range-hint" id="live-tc">${S.icon("info")} <span>only if your kit gives one chlorine number</span></div></div>
            ${fldRow("ph")}${fldRow("cya")}${fldRow("ta")}${fldRow("ch")}
            ${p.sanitizer === "salt" ? fldRow("salt") : ""}
            <div class="field"><label>Water temp</label><div class="input-group"><input class="input" type="number" id="log-temp" value="${editR && editR.temp != null ? editR.temp : ""}" placeholder="${p.tempF || 82}"><span class="input-suffix">°F</span></div><div class="range-hint" id="live-temp">${S.icon("info")} <span>typical <b>50–95 °F</b></span></div></div>
          </div>
          <div class="field"><label>Date &amp; time of this test ${infoHTML("When you actually took this reading. Defaults to now — change it to back-date a test you ran earlier, or to fix a timestamp.")}</label><input class="input" type="datetime-local" id="log-when" aria-label="Date and time of this test" value="${toLocalInput(editR ? state.log[editingIndex].t : Date.now())}"></div>
          <div class="field"><label>Note (optional)</label><input class="input" id="log-note" value="${editR ? esc(state.log[editingIndex].note || "") : ""}" placeholder="e.g. after adding 1 gal chlorine"></div>
          <button type="submit" class="btn btn--primary btn--block btn--lg" id="saveReading">${S.icon("check")} ${editR ? "Update this reading" : "Save reading &amp; update my plan"}</button>
          ${editR ? `<button type="button" class="btn btn--ghost btn--block" id="cancelEdit" style="margin-top:8px">Cancel edit</button>` : ""}
          ${!editR && state.log && state.log.length ? `<div class="btnrow" style="margin-top:10px"><button type="button" class="btn btn--ghost btn--sm" id="prefillLast">${S.icon("clock")} Prefill from last test</button><button type="button" class="btn btn--ghost btn--sm" id="clearLog">Clear</button></div>` : ""}
          </form>
        </div>
        <div>
          <div class="card" id="logResultCard">${logInstantFeedback(p, r)}</div>
        </div>
      </div>

      ${sectionHead(2, "Trends over time", "See chlorine drift, pH creep, and your CYA coming down — patterns tell you more than any single test.", "plan")}
      <div id="trendsWrap">${state.log && state.log.length > 1 ? trendsBlock(p) : `<div class="card center" style="padding:30px"><div class="figure" style="max-width:200px;margin:0 auto">${S.emptyState()}</div><p class="muted">Log a couple of tests and your trends will appear here automatically.</p></div>`}</div>

      ${state.log && state.log.length ? historyTable() : ""}
    `;
    wireLog(p);
  };

  function logInstantFeedback(p, r) {
    const pl = C.plan(p, r);
    const noReal = !(state.log && state.log.length);
    const top = pl.actions.find((a) => a.prio === "now" || a.prio === "soon");
    const banner = top
      ? `<div class="callout callout--${top.prio === "now" ? "bad" : "warn"}" style="margin-bottom:14px">${S.icon(top.prio === "now" ? "warn" : "info")}<div><b>Do this first:</b> ${top.title}${top.dose ? ` — <b>${top.dose.text}</b>` : ""}</div></div>`
      : `<div class="callout callout--good" style="margin-bottom:14px">${S.icon("check")}<div><b>Nothing urgent</b> — your water's in good shape. Keep testing every couple of days.</div></div>`;
    return `<div class="card__title">${S.icon("target")} Where you stand</div>
      <p class="muted" style="margin-bottom:14px">Based on your ${noReal ? "setup estimates — no test logged yet" : "latest reading"}.</p>
      ${noReal
        ? `<div class="callout callout--sun" style="margin-bottom:14px">${S.icon("info")}<div>These are <b>setup estimates</b>, not a measured test. Enter your readings to replace them with numbers tuned to your pool.</div></div>`
        : banner}
      <div class="param-grid ${noReal ? "is-estimate" : ""}" style="grid-template-columns:1fr 1fr">
        ${dashParams(p, r).join("")}
      </div>
      <a class="btn btn--primary btn--block" href="#plan" style="margin-top:14px">See my full plan ${S.icon("arrow")}</a>`;
  }

  /* ---- LIVE input feedback: react to each value as it's typed ---- */
  const SANE = { fc: [0, 100], cc: [0, 20], ph: [5.5, 9], ta: [0, 400], ch: [0, 2000], cya: [0, 300], salt: [0, 8000], temp: [33, 115] };
  function fieldVerdict(k, val, reading, p) {
    if (val == null || val === "" || isNaN(val)) return null;
    val = +val;
    if (SANE[k] && (val < SANE[k][0] || val > SANE[k][1])) return { state: "bad", msg: "That's outside the normal range — double-check the value." };
    const swg = p.sanitizer === "salt";
    if (k === "fc") {
      const cya = reading.cya != null ? reading.cya : 40;
      const t = C.fcTargets(cya, swg);
      if (val < t.min) return { state: "bad", msg: `Below the minimum (${t.min}) for CYA ${cya} — algae risk. Add chlorine.` };
      if (val < t.targetLo) return { state: "warn", msg: `A little low — aim ${t.targetLo}–${t.targetHi} for CYA ${cya}.` };
      if (val <= t.slam) return { state: "good", msg: `Good for CYA ${cya} (target ${t.targetLo}–${t.targetHi}).` };
      return { state: "warn", msg: "Above SLAM level — not harmful, just let it drift down before swimming." };
    }
    if (k === "cc") {
      if (val === 0) return { state: "good", msg: "Perfect — no combined chlorine." };
      if (val <= 0.5) return { state: "warn", msg: "Just a trace — keep an eye on it." };
      return { state: "bad", msg: "High — that's organics/algae. A SLAM clears it." };
    }
    if (k === "ph") {
      if (val < 7.2) return { state: "bad", msg: "Low — corrosive to plaster &amp; metal. Aerate or add base." };
      if (val <= 7.8) return { state: "good", msg: "Right in the sweet spot." };
      if (val <= 8.0) return { state: "warn", msg: "A touch high — add a little acid when handy." };
      return { state: "bad", msg: "High — add muriatic acid." };
    }
    if (k === "temp") {
      if (val < 60) return { state: "info", msg: `${val}°F — algae is dormant; low chlorine demand.` };
      if (val >= 92) return { state: "warn", msg: `${val}°F — heat-wave demand; dose more, test daily.` };
      return { state: "info", msg: `${val}°F — algae active; normal summer demand.` };
    }
    const cls = C.classify(k, val, p, reading);
    const R = D.RANGES[k];
    if (!R) return { state: cls === "unknown" ? "info" : cls, msg: "" };
    let ideal = (k === "cya" && swg) ? R.swgIdeal : R.ideal;
    const msg = cls === "good" ? "In range ✓" : cls === "warn" ? `Acceptable — ideal is ${ideal[0]}–${ideal[1]}.` : (val < ideal[0] ? `Low — ideal ${ideal[0]}–${ideal[1]}.` : `High — ideal ${ideal[0]}–${ideal[1]}.`);
    return { state: cls, msg: msg };
  }

  /* Total Chlorine → derive FC/CC. OTO kits give ONE chlorine number (TC = FC + CC).
     If FC is known, CC = TC − FC; otherwise treat TC as FC (assumes CC≈0). Mutates r. */
  function applyTC(r, tcVal) {
    if (tcVal == null || isNaN(tcVal)) return;
    if (r.fc != null && !isNaN(r.fc)) { if (r.cc == null || isNaN(r.cc)) r.cc = Math.max(0, Math.round((tcVal - r.fc) * 10) / 10); }
    else { r.fc = tcVal; }
  }

  function liveUpdate(p) {
    const r = {};
    ["fc", "cc", "ph", "ta", "ch", "cya", "salt"].forEach((k) => { const i = $("#log-" + k); if (i && i.value !== "") r[k] = parseFloat(i.value); });
    const tmp = $("#log-temp"); if (tmp && tmp.value !== "") r.temp = parseFloat(tmp.value);
    const tcEl = $("#log-tc"); const tcVal = (tcEl && tcEl.value !== "") ? parseFloat(tcEl.value) : null;
    const tcHint = $("#live-tc");
    if (tcHint) {
      if (tcVal == null || isNaN(tcVal)) { tcHint.className = "range-hint"; tcHint.innerHTML = `${S.icon("info")} <span>only if your kit gives one chlorine number</span>`; }
      else if (r.fc != null && !isNaN(r.fc)) { const cc = Math.max(0, Math.round((tcVal - r.fc) * 10) / 10); const st = cc <= 0 ? "good" : cc <= 0.5 ? "warn" : "bad"; tcHint.className = "range-hint is-" + st; tcHint.innerHTML = `${S.icon(st === "good" ? "check" : "warn")} <span>Combined chlorine = TC − FC = <b>${cc}</b>${cc > 0.5 ? " — that's organics/algae; a SLAM clears it" : ""}.</span>`; }
      else { tcHint.className = "range-hint is-info"; tcHint.innerHTML = `${S.icon("info")} <span>We'll treat this as Free Chlorine (assumes CC≈0). Add your FC reading to split out combined chlorine.</span>`; }
    }
    applyTC(r, tcVal);
    const anyEntered = Object.keys(r).length > 0;
    const prev = latest();
    const eff = Object.assign({}, r);
    if (eff.cya == null && prev.cya != null) eff.cya = prev.cya;
    // per-field verdict (updates the range-hint line live, with color)
    ["fc", "cc", "ph", "ta", "ch", "cya", "salt", "temp"].forEach((k) => {
      const el = $("#live-" + k); if (!el) return;
      const v = fieldVerdict(k, r[k], eff, p);
      if (v) { const ic = v.state === "good" ? "check" : v.state === "bad" ? "warn" : v.state === "warn" ? "warn" : "info"; el.className = "range-hint is-" + v.state; el.innerHTML = `${S.icon(ic)} <span>${v.msg}</span>`; }
      else { el.className = "range-hint"; el.innerHTML = rangeText(k) ? `${S.icon("info")} <span>${rangeText(k)}</span>` : (k === "temp" ? `${S.icon("info")} <span>typical <b>50–95 °F</b></span>` : ""); }
    });
    const card = $("#logResultCard");
    if (card) { card.innerHTML = anyEntered ? livePreview(p, eff, r, prev) : logInstantFeedback(p, prev); wireParamTiles(card); }
  }

  function liveWizUpdate() {
    const d = wiz && wiz.data; if (!d) return;
    const r = {};
    ["fc", "cc", "ph", "ta", "ch", "cya", "salt"].forEach((k) => { const i = $("#seed-" + k); if (i && i.value !== "") r[k] = parseFloat(i.value); });
    ["fc", "cc", "ph", "ta", "ch", "cya", "salt"].forEach((k) => {
      const el = $("#livew-" + k); if (!el) return;
      const v = fieldVerdict(k, r[k], r, d);
      if (v) { const ic = v.state === "good" ? "check" : v.state === "info" ? "info" : "warn"; el.className = "range-hint is-" + v.state; el.innerHTML = `${S.icon(ic)} <span>${v.msg}</span>`; }
      else { el.className = "range-hint"; el.innerHTML = rangeText(k) ? `${S.icon("info")} <span>${rangeText(k)}</span>` : ""; }
    });
    // Total Chlorine derivation hint (mirrors the Log form)
    const tcEl = $("#seed-tc"); const tcVal = (tcEl && tcEl.value !== "") ? parseFloat(tcEl.value) : null;
    const tw = $("#livew-tc");
    if (tw) {
      if (tcVal == null || isNaN(tcVal)) { tw.className = "range-hint"; tw.innerHTML = `${S.icon("info")} <span>only if your kit gives one chlorine number</span>`; }
      else if (r.fc != null && !isNaN(r.fc)) { const cc = Math.max(0, Math.round((tcVal - r.fc) * 10) / 10); const st = cc <= 0 ? "good" : cc <= 0.5 ? "warn" : "bad"; tw.className = "range-hint is-" + st; tw.innerHTML = `${S.icon(st === "good" ? "check" : "warn")} <span>Combined chlorine = TC − FC = <b>${cc}</b>${cc > 0.5 ? " — organics/algae" : ""}.</span>`; }
      else { tw.className = "range-hint is-info"; tw.innerHTML = `${S.icon("info")} <span>We'll treat this as Free Chlorine (assumes CC≈0).</span>`; }
    }
  }
  function livePreview(p, eff, entered, prev) {
    const tabs = (p.sanitizers && p.sanitizers.indexOf("tabs") >= 0) || p.sanitizer === "tabs";
    const flags = [];
    // smart, live plausibility / test-error checks vs the last saved reading
    if (entered.cya != null && prev.cya != null) {
      const d = entered.cya - prev.cya;
      if (Math.abs(d) >= 25 && !(d > 0 && tabs)) flags.push(`CYA ${d > 0 ? "jumped +" + Math.round(d) : "dropped " + Math.round(-d)} from last (${prev.cya}). CYA can't ${d > 0 ? "rise without adding stabilizer/tablets" : "fall fast without replacing water"} — re-check this reading (the black-dot test is easy to misread).`);
    }
    if (entered.fc != null && entered.fc > 10 && entered.ph != null) flags.push(`With FC at ${entered.fc}, the pH test reads <b>falsely high</b> — don't trust this pH (or dose acid) until FC drops below ~10.`);
    if (entered.cc != null && entered.fc != null && entered.cc > 0.5 && entered.fc >= C.fcTargets(eff.cya != null ? eff.cya : 40, p.sanitizer === "salt").min) flags.push(`CC is up even though FC is adequate — that points to an organic load or weak circulation, not too little chlorine.`);
    // synthesized "if you save this"
    const pl = C.plan(p, eff);
    const top = pl.actions.find((a) => a.prio === "now" || a.prio === "soon");
    const csiV = (entered.ph != null && entered.ta != null && entered.ch != null) ? C.csi(eff, entered.temp != null ? entered.temp : (p.tempF || 82)) : null;
    const fcLine = (eff.cya != null && entered.fc != null) ? (() => { const t = C.fcTargets(eff.cya, p.sanitizer === "salt"); return `<div class="muted" style="font-size:.82rem;margin-top:8px">For CYA ${eff.cya}: min ${t.min} · target ${t.targetLo}–${t.targetHi} · SLAM ${t.slam}</div>`; })() : "";
    return `<div class="card__title">${S.icon("target")} Live preview <span class="live-badge">${S.icon("beaker")} not saved yet</span></div>
      ${flags.map((f) => `<div class="callout callout--warn" style="margin-bottom:10px;font-size:.85rem">${S.icon("warn")}<div>${f}</div></div>`).join("")}
      ${top ? `<div class="callout callout--${top.prio === "now" ? "bad" : "warn"}" style="margin-bottom:12px">${S.icon(top.prio === "now" ? "warn" : "info")}<div><b>If you save this:</b> ${top.title}${top.dose ? ` — <b>${top.dose.text}</b>` : ""}</div></div>` : `<div class="callout callout--good" style="margin-bottom:12px">${S.icon("check")}<div>Looks good — nothing urgent in what you've entered so far.</div></div>`}
      <div class="param-grid" style="grid-template-columns:1fr 1fr">${dashParams(p, eff).join("")}</div>
      ${fcLine}
      ${csiV != null ? `<div class="muted" style="font-size:.82rem;margin-top:4px">Live CSI: ${csiV > 0 ? "+" : ""}${csiV} · ${C.classify("csi", csiV, p) === "good" ? "balanced ✓" : csiV > 0.3 ? "tending to scale" : "tending corrosive"}</div>` : ""}`;
  }

  function trendsBlock(p) {
    const series = {};
    ["fc", "ph", "cya", "ta", "ch"].forEach((k) => { series[k] = state.log.map((e) => ({ t: e.t, v: e.reading[k] != null ? e.reading[k] : null })); });
    const cur = state.ui.trendKey || "fc";
    const bandFor = (k) => {
      if (k === "fc") { const r = latest(); const t = C.fcTargets(r.cya != null ? r.cya : 40, p.sanitizer === "salt"); return { min: t.targetLo, max: t.targetHi }; }
      if (D.RANGES[k]) { let id = D.RANGES[k].ideal; if (k === "cya" && p.sanitizer === "salt") id = D.RANGES[k].swgIdeal; return { min: id[0], max: id[1] }; }
      return null;
    };
    const colors = { fc: "#15aabf", ph: "#f08c00", cya: "#845ef7", ta: "#4263eb", ch: "#868e96" };
    return `<div class="card pad-lg">
      <div class="seg" style="margin-bottom:14px" id="trendSeg">
        ${["fc", "ph", "cya", "ta", "ch"].map((k) => `<button data-k="${k}" class="${cur === k ? "is-on" : ""}">${(D.PARAMS.find((x) => x.key === k) || {}).short || k.toUpperCase()}</button>`).join("")}
      </div>
      <div class="figure">${CH.trend({ points: series[cur], band: bandFor(cur), color: colors[cur], height: 240 })}</div>
      ${trendReadout(p, cur)}
    </div>`;
  }
  function trendReadout(p, key) {
    const tr = IN.trend(state.log, key);
    if (tr.n < 2) return "";
    const param = D.PARAMS.find((x) => x.key === key) || {};
    const unit = param.unit || "ppm";
    const dirWord = tr.direction === "rising" ? "rising" : tr.direction === "falling" ? "falling" : "holding steady";
    const arrow = tr.direction === "rising" ? "↑" : tr.direction === "falling" ? "↓" : "→";
    let extra = "";
    if (key === "fc") {
      const burn = IN.fcBurn(state.log); const r = latest(); const t = C.fcTargets(r.cya != null ? r.cya : 40, p.sanitizer === "salt");
      if (burn.rate && r.fc != null && r.fc > t.min) { const days = (r.fc - t.min) / burn.rate; if (days > 0 && days < 14) extra = `Burning ~<b>${burn.rate.toFixed(1)} ppm/day</b> → reaches the minimum (${t.min}) in ~${days < 1 ? Math.round(days * 24) + " hrs" : Math.round(days * 10) / 10 + " days"}.`; else extra = burn.rate ? `Burning ~<b>${burn.rate.toFixed(1)} ppm/day</b>.` : ""; }
    } else if (tr.direction !== "steady") { const rate = Math.abs(tr.perWeek); extra = `Moving ~<b>${rate >= 1 ? Math.round(rate) : Math.round(rate * 100) / 100} ${unit}/week</b>.`; }
    const cls = tr.direction === "steady" ? "callout--good" : "callout";
    return `<div class="${cls}" style="margin-top:12px;font-size:.88rem">${S.icon("plan")}<div><b>${arrow} ${param.name} is ${dirWord}.</b> ${extra} <span class="muted">(${tr.n} tests over ${Math.round(tr.spanDays)} days)</span></div></div>`;
  }

  function historyTable() {
    const rows = state.log.slice().reverse();
    return `<h2 style="margin-top:28px;display:flex;align-items:center;gap:8px;flex-wrap:wrap">${S.icon("clock")} History
      <span style="margin-left:auto;display:inline-flex;gap:8px">
        <button class="btn btn--ghost btn--sm" id="importCsvBtn">${S.icon("clock")} Import CSV</button>
        <button class="btn btn--ghost btn--sm" id="exportCsv">${S.icon("export")} Export CSV</button>
      </span>
      <input type="file" id="importCsvFile" accept=".csv,text/csv" style="display:none" aria-label="Choose a CSV file to import"></h2>
    <div class="tbl-wrap"><table class="tbl"><thead><tr>
      <th>Date</th><th class="num">FC</th><th class="num">CC</th><th class="num">pH</th><th class="num">TA</th><th class="num">CH</th><th class="num">CYA</th><th>Note</th><th></th>
    </tr></thead><tbody>
    ${rows.map((e, i) => { const idx = state.log.length - 1 - i; const r = e.reading; const d = new Date(e.t);
      return `<tr><td>${d.toLocaleDateString()} <span class="muted" style="font-size:.78rem">${d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></td>
      <td class="num">${r.fc != null ? r.fc : "·"}</td><td class="num">${r.cc != null ? r.cc : "·"}</td><td class="num">${r.ph != null ? r.ph : "·"}</td>
      <td class="num">${r.ta != null ? r.ta : "·"}</td><td class="num">${r.ch != null ? r.ch : "·"}</td><td class="num">${r.cya != null ? r.cya : "·"}</td>
      <td class="muted" style="font-size:.82rem">${esc(e.note || "")}</td>
      <td><div style="display:flex;gap:6px">
        <button class="iconbtn" data-edit="${idx}" title="Edit this reading" aria-label="Edit this reading" style="width:36px;height:36px"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" focusable="false"><path d="M4 20h4L18 10l-4-4L4 16v4ZM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="iconbtn" data-del="${idx}" title="Delete this reading" aria-label="Delete this reading" style="width:36px;height:36px"><svg viewBox="0 0 24 24" width="17" height="17" aria-hidden="true" focusable="false"><path d="M6 7h12M9 7V5h6v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div></td></tr>`;
    }).join("")}
    </tbody></table></div>`;
  }

  function wireLog(p) {
    const logForm = $("#logForm");
    logForm && logForm.addEventListener("submit", (e) => {
      e.preventDefault();
      const r = {};
      ["fc", "cc", "ph", "ta", "ch", "cya", "salt"].forEach((k) => { const i = $("#log-" + k); if (i && i.value !== "") r[k] = parseFloat(i.value); });
      const tcEl = $("#log-tc"); if (tcEl && tcEl.value !== "") applyTC(r, parseFloat(tcEl.value)); // OTO/total-chlorine → FC/CC
      const tmp = $("#log-temp"); if (tmp && tmp.value) { p.tempF = parseFloat(tmp.value); state.profile.tempF = p.tempF; r.temp = p.tempF; }
      const note = $("#log-note") ? $("#log-note").value.trim() : "";
      const whenEl = $("#log-when"); const whenMs = (whenEl && whenEl.value && !isNaN(new Date(whenEl.value).getTime())) ? new Date(whenEl.value).getTime() : null;
      if (Object.keys(r).length === 0) { toast("Enter at least one value to save.", "warn"); return; }
      // EDIT mode → update the existing entry in place (values, note, AND date/time)
      if (editingIndex != null && state.log[editingIndex]) {
        const entry = state.log[editingIndex];
        entry.reading = r;
        entry.note = note;
        if (whenMs != null) entry.t = whenMs;
        editingIndex = null;
        state.log.sort((a, b) => a.t - b.t); // keep the log in chronological order
        save(); updateAppbar(); toast("Reading updated.", "good");
        if (portal.mode === "account") portalUpdateReading(entry);
        RENDER.log(); return;
      }
      // carry forward CYA (changes slowly) if not entered, so FC targets stay correct
      const prev = latest();
      if (r.cya == null && prev.cya != null) r.cya = prev.cya;
      const entry = { t: whenMs != null ? whenMs : Date.now(), reading: r, note: note };
      state.log.push(entry);
      state.log.sort((a, b) => a.t - b.t); // keep the log in chronological order
      save(); updateAppbar();
      if (portal.mode === "account") portalAddReading(entry);
      toast(state.log.length === 1 ? "🎉 First test logged! Your plan is ready." : "Reading saved — dashboard &amp; plan updated.", "good");
      RENDER.log();
      const fb = $("#logResultCard"); if (fb) fb.scrollIntoView({ behavior: "smooth", block: "nearest" });
    });
    wireParamTiles($("#view-log"));
    // live feedback as the user types each value
    ["fc", "cc", "tc", "ph", "ta", "ch", "cya", "salt", "temp"].forEach((k) => { const i = $("#log-" + k); if (i) i.addEventListener("input", () => liveUpdate(p)); });
    wireTrendSeg(p);
    $$("#view-log [data-del]").forEach((b) => b.addEventListener("click", () => {
      const i = +b.getAttribute("data-del");
      confirmDialog({ title: "Delete this reading?", message: "This permanently removes the logged test.", confirm: "Delete", danger: true }).then((ok) => {
        if (!ok) return;
        const removed = state.log[i]; if (editingIndex === i) editingIndex = null; state.log.splice(i, 1); save(); updateAppbar(); if (portal.mode === "account" && removed) portalDeleteReading(removed); RENDER.log();
      });
    }));
    $$("#view-log [data-edit]").forEach((b) => b.addEventListener("click", () => {
      editingIndex = +b.getAttribute("data-edit"); RENDER.log(); window.scrollTo({ top: 0, behavior: "smooth" });
    }));
    $("#cancelEdit") && $("#cancelEdit").addEventListener("click", () => { editingIndex = null; RENDER.log(); });
    $("#exportCsv") && $("#exportCsv").addEventListener("click", exportCsv);
    $("#prefillLast") && $("#prefillLast").addEventListener("click", () => {
      const L = latest();
      ["fc", "cc", "ph", "ta", "ch", "cya", "salt"].forEach((k) => { const i = $("#log-" + k); if (i) i.value = (L[k] != null ? L[k] : ""); });
      const t = $("#log-temp"); if (t) t.value = (L.temp != null ? L.temp : (p.tempF || ""));
      liveUpdate(p); toast("Prefilled from your last test — adjust what changed.", "info");
    });
    $("#clearLog") && $("#clearLog").addEventListener("click", () => {
      ["fc", "cc", "tc", "ph", "ta", "ch", "cya", "salt", "temp"].forEach((k) => { const i = $("#log-" + k); if (i) i.value = ""; });
      const n = $("#log-note"); if (n) n.value = ""; liveUpdate(p);
    });
    $("#importCsvBtn") && $("#importCsvBtn").addEventListener("click", () => { const f = $("#importCsvFile"); if (f) f.click(); });
    $("#importCsvFile") && $("#importCsvFile").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0]; e.target.value = "";
      if (!f) return;
      const rd = new FileReader(); rd.onload = () => importCsv(rd.result); rd.onerror = () => toast("Couldn't read that file.", "warn"); rd.readAsText(f);
    });
    labelFields($("#view-log"));
  }
  function wireTrendSeg(p) {
    const seg = $("#trendSeg"); if (!seg) return;
    $$("button", seg).forEach((b) => b.addEventListener("click", () => {
      state.ui.trendKey = b.getAttribute("data-k"); save();
      const w = $("#trendsWrap"); if (w && state.log && state.log.length > 1) { w.innerHTML = trendsBlock(p); wireTrendSeg(p); }
    }));
  }
  // Parse one CSV line, honoring simple double-quote quoting (used for the note column).
  function parseCsvLine(line) {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (q) { if (c === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
    out.push(cur); return out;
  }
  // Import readings from a CSV matching exportCsv's columns (date,fc,cc,ph,ta,ch,cya,salt,note).
  function importCsv(text) {
    const lines = String(text).split(/\r?\n/).filter((l) => l.trim() !== "");
    if (lines.length < 2) { toast("That CSV looks empty.", "warn"); return; }
    const header = parseCsvLine(lines[0]).map((h) => h.trim().toLowerCase());
    const di = header.indexOf("date");
    const col = {}; ["fc", "cc", "ph", "ta", "ch", "cya", "salt", "note"].forEach((k) => { col[k] = header.indexOf(k); });
    const fresh = [];
    for (let i = 1; i < lines.length; i++) {
      const cells = parseCsvLine(lines[i]);
      const t = di >= 0 && cells[di] ? new Date(cells[di].trim()).getTime() : NaN;
      if (isNaN(t)) continue;
      const reading = {};
      ["fc", "cc", "ph", "ta", "ch", "cya", "salt"].forEach((k) => { const c = col[k] >= 0 ? (cells[col[k]] || "").trim() : ""; if (c !== "" && !isNaN(parseFloat(c))) reading[k] = parseFloat(c); });
      const note = col.note >= 0 ? (cells[col.note] || "").trim() : "";
      if (!Object.keys(reading).length && !note) continue;
      fresh.push({ t: t, reading: reading, note: note });
    }
    if (!fresh.length) { toast("No valid rows found — expected columns: date,fc,cc,ph,ta,ch,cya,salt,note.", "warn"); return; }
    fresh.forEach((entry) => { state.log.push(entry); if (portal.mode === "account") portalAddReading(entry); });
    state.log.sort((a, b) => a.t - b.t);
    save(); updateAppbar();
    toast("Imported " + fresh.length + " reading" + (fresh.length > 1 ? "s" : "") + ".", "good");
    RENDER.log();
  }
  function exportCsv() {
    const cols = ["date", "fc", "cc", "ph", "ta", "ch", "cya", "salt", "note"];
    let csv = cols.join(",") + "\n";
    state.log.forEach((e) => {
      const r = e.reading;
      csv += [new Date(e.t).toISOString(), r.fc, r.cc, r.ph, r.ta, r.ch, r.cya, r.salt, '"' + (e.note || "").replace(/"/g, '""') + '"'].map((x) => x == null ? "" : x).join(",") + "\n";
    });
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = "poolaris-log.csv"; a.click();
    toast("Exported poolaris-log.csv", "good");
  }

  /* ===================================================================
     PATH TO PERFECT
     =================================================================== */
  RENDER.plan = function () {
    const p = profile(); const r = latest(); const v = $("#view-plan");
    const pl = C.plan(p, r);
    // all-clear = no must-do (now/soon) actions, only ok/info reference cards
    const allClear = !pl.actions.some((a) => a.prio === "now" || a.prio === "soon");
    v.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">${S.icon("plan")} Path to Perfect</span>
        <h1>${allClear ? "You're all caught up" : "Your step-by-step plan"}</h1>
        <p class="lead">${allClear
          ? `Nothing needs doing right now — your water's in good shape. Keep up the easy routine below and re-test in a couple of days.`
          : `Ordered by urgency. Do them top to bottom — each step is calculated for <strong>your</strong> ${C.fmtVolume(p.volume)} pool and the products you own. Re-test after each change.`}</p>
      </div>
      ${allClear ? `<div class="card pad-lg center" style="margin-bottom:18px;background:var(--good-bg);border:1px solid var(--good)">
        <div style="max-width:180px;margin:0 auto 6px">${S.celebrate ? S.celebrate() : S.icon("check")}</div>
        <h2 style="margin:.1em 0">Water's dialed in 🎉</h2>
        <p class="muted" style="max-width:42ch;margin:0 auto">No must-do steps today. The maintenance routine below keeps it that way.</p>
      </div>
      ${sectionHead(1, "Easy maintenance", "Your simple keep-it-clear routine — no urgency.", "check")}` : `
      ${sectionHead(1, "Do these in order", "Top to bottom — red first, then amber. Re-test after each change.", "plan")}
      <div class="flex wrap" style="gap:14px;margin:-4px 0 14px;font-size:.82rem;color:var(--ink-3)">
        <span class="flex" style="gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:var(--crit)"></span>Today — water safety</span>
        <span class="flex" style="gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:var(--warn-2)"></span>This week — important</span>
        <span class="flex" style="gap:6px"><span style="width:11px;height:11px;border-radius:3px;background:var(--good-2)"></span>Optional fine-tuning</span>
      </div>
      ${(C.classify("cya", r.cya, p, r) === "bad") ? `<div class="callout callout--warn" style="margin-bottom:14px">${S.icon("info")}<div><strong>Fix CYA first.</strong> Your stabilizer sets every chlorine target — adjust it before dosing chlorine, or you'll waste it.</div></div>` : ""}`}
      <div class="stack">${pl.actions.map((a, i) => actionCard(a, i + 1)).join("")}</div>

      ${nextStep("log", "Made a change?", "Re-test in a few hours and log it — your plan recalculates automatically.", "Log a test", "#log")}

      <div class="card pad-lg" style="margin-top:8px;background:var(--foam-2)">
        <div class="card__title">${S.icon("learn")} The right order to balance</div>
        <p class="muted">When several things are off, fix them in this order so you don't chase your tail:</p>
        <ol style="color:var(--ink-2);line-height:1.9;margin:0;padding-left:20px">
          <li><strong>CYA</strong> — it sets every chlorine target. Get it in range first (dilute if high).</li>
          <li><strong>Free Chlorine</strong> — get to your CYA-based target and never let it fall below minimum.</li>
          <li><strong>pH</strong> — bring into 7.5–7.8.</li>
          <li><strong>TA</strong> then <strong>CH</strong> — fine-tune the buffers and (for plaster) calcium.</li>
          <li><strong>CSI</strong> — confirm the water isn't scaling or corroding.</li>
        </ol>
      </div>`;
    $$("#view-plan [data-act]").forEach((b) => b.addEventListener("click", onActionClick));
  };

  /* ===================================================================
     CALCULATORS
     =================================================================== */
  const CALCS = [
    { id: "chlorine", cat: "Chlorine & sanitizing", name: "Chlorine dose", icon: "droplet", desc: "Liquid chlorine to hit a target FC" },
    { id: "slamcalc", cat: "Chlorine & sanitizing", name: "SLAM calculator", icon: "slam", desc: "Algae-kill level + gallons to get there" },
    { id: "oclt", cat: "Chlorine & sanitizing", name: "Overnight test (OCLT)", icon: "clock", desc: "Dusk→dawn FC loss: pass / fail" },
    { id: "calhypo", cat: "Chlorine & sanitizing", name: "Granular shock (cal-hypo)", icon: "beaker", desc: "Cal-hypo dose + calcium it adds" },
    { id: "trichlor", cat: "Chlorine & sanitizing", name: "Tablet (trichlor) effect", icon: "tablet", desc: "FC &amp; CYA a puck adds over time" },
    { id: "dichlor", cat: "Chlorine & sanitizing", name: "Dichlor shock effect", icon: "beaker", desc: "FC &amp; the CYA dichlor adds" },
    { id: "acid", cat: "Water balance", name: "Lower pH (acid)", icon: "flask", desc: "Muriatic acid to bring pH down" },
    { id: "phup", cat: "Water balance", name: "Raise pH", icon: "arrow", desc: "Soda ash / borax / aeration" },
    { id: "ta", cat: "Water balance", name: "Raise alkalinity (TA)", icon: "beaker", desc: "Baking soda to raise TA" },
    { id: "taDown", cat: "Water balance", name: "Lower alkalinity (TA)", icon: "flask", desc: "The acid + aeration method" },
    { id: "ch", cat: "Water balance", name: "Raise calcium (CH)", icon: "salt", desc: "Calcium chloride (plaster pools)" },
    { id: "csi", cat: "Water balance", name: "CSI / scale check", icon: "target", desc: "Scaling vs corrosive — and the fix" },
    { id: "borates", cat: "Water balance", name: "Borates", icon: "droplet", desc: "Raise borates (algae insurance)" },
    { id: "stabilizer", cat: "Stabilizer & water swaps", name: "Add stabilizer (CYA)", icon: "sun", desc: "Granular CYA to raise stabilizer" },
    { id: "cya", cat: "Stabilizer & water swaps", name: "Dilution planner", icon: "leak", desc: "Drain cycles to lower CYA / CH / salt" },
    { id: "salt", cat: "Stabilizer & water swaps", name: "Salt", icon: "salt", desc: "Salt to reach your SWG target" },
    { id: "volume", cat: "Pool basics", name: "Pool volume", icon: "calc", desc: "Estimate gallons from shape &amp; size" },
    { id: "fill", cat: "Pool basics", name: "Fill / drain time", icon: "clock", desc: "Hose time per foot or full" },
    { id: "turnover", cat: "Pool basics", name: "Pump run-time", icon: "clock", desc: "Turnover &amp; hours/day to run" },
  ];
  const CALC_CATS = ["Chlorine & sanitizing", "Water balance", "Stabilizer & water swaps", "Pool basics"];
  function suggestedCalcs() {
    const pl = C.plan(profile(), latest()); const ids = [];
    const map = { cya: "cya", fc: "chlorine", cc: "slamcalc", ph: "acid", ta: "ta", ch: "ch", csi: "csi", salt: "salt" };
    pl.actions.forEach((a) => { if (a.prio === "ok" || a.prio === "info") return; let id = map[a.key]; if (a.key === "ph" && a.title && /raise/i.test(a.title)) id = "phup"; if (id && ids.indexOf(id) < 0) ids.push(id); });
    return ids.slice(0, 3);
  }
  RENDER.calculators = function () {
    const v = $("#view-calculators");
    const card = (c, sug) => `<div class="card is-clickable ${sug ? "calc-suggest" : ""}" data-calc="${c.id}" role="button" tabindex="0">
      <div class="flex"><span class="card__icon">${S.icon(c.icon)}</span><div><div class="card__title" style="margin:0;font-size:1rem">${c.name}</div><div class="card__sub">${c.desc}</div></div></div></div>`;
    const sug = suggestedCalcs();
    v.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">${S.icon("calc")} Calculators</span>
        <h1>The toolbox</h1>
        <p class="lead">Every tool is pre-filled for your pool and shows a graph or table so you can see the whole picture — not just one number. Doses are estimates: add about ¾, circulate, then re-test.</p>
      </div>
      ${sug.length ? `${sectionHead("target", "Suggested for you", "Based on your latest reading, start with these.", "")}
        <div class="grid auto" style="margin-bottom:6px">${sug.map((id) => card(CALCS.find((c) => c.id === id), true)).join("")}</div>` : ""}
      ${CALC_CATS.map((cat) => `<div class="cat-head">${S.icon("droplet")} ${cat}</div>
        <div class="grid auto">${CALCS.filter((c) => c.cat === cat).map((c) => card(c, false)).join("")}</div>`).join("")}
      <div id="calcPanel" style="margin-top:22px"></div>`;
    $$("#view-calculators [data-calc]").forEach((c) => c.addEventListener("click", () => { openCalc(c.getAttribute("data-calc")); }));
    if (state.ui.lastCalc) openCalc(state.ui.lastCalc);
  };

  function openCalc(id) {
    state.ui.lastCalc = id; save();
    const panel = $("#calcPanel");
    panel.innerHTML = `<div class="card pad-lg" id="calcCard"></div>`;
    const card = $("#calcCard");
    const p = profile(); const r = latest();
    const builders = {
      volume: calcVolume, chlorine: calcChlorine, slamcalc: calcSlam, oclt: calcOclt, acid: calcAcid,
      cya: calcCya, stabilizer: calcStab, ta: calcTa, ch: calcCh, salt: calcSalt, csi: calcCsi, fill: calcFill,
      calhypo: calcCalhypo, trichlor: calcTrichlor, dichlor: calcDichlor, phup: calcPhup, taDown: calcTaDown, borates: calcBorates, turnover: calcTurnover,
    };
    (builders[id] || calcVolume)(card, p, r);
    labelFields(card);
    // shared "then what?" footer for dosing tools that produce an amount to add
    const dosing = ["chlorine", "slamcalc", "calhypo", "trichlor", "acid", "phup", "ta", "taDown", "ch", "borates", "stabilizer", "salt"];
    if (dosing.indexOf(id) >= 0) {
      const chemId = CALC_TO_CHEM[id];
      card.insertAdjacentHTML("beforeend", `<div class="callout" style="margin-top:16px;font-size:.88rem">${S.icon("arrow")}<div><b>Then what?</b> Add it slowly with the pump running${chemId ? `, then <a href="#" id="trackDose">track it in Dosing</a> to watch it mix in` : ""}, and <a href="#log">log a new test</a> afterward — your dashboard &amp; plan update automatically.</div></div>`);
      const td = $("#trackDose");
      if (td) td.addEventListener("click", (e) => { e.preventDefault(); state.ui = state.ui || {}; state.ui.dosePrefill = { chem: chemId }; save(); go("chem"); });
    }
    card.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function calcHead(name, icon, desc) { return `<div class="card__title">${S.icon(icon)} ${name}</div><p class="muted">${desc}</p>`; }
  function out(html) { return `<div class="callout callout--good" style="font-size:1rem;margin-top:6px" id="calcOut">${html}</div>`; }
  // One canonical muriatic-acid strength list, shared by the acid calc, TA-down calc, the
  // onboarding wizard and Dosing (chem.js mirrors these values) so a saved strength always preselects.
  const ACID_STRENGTHS = ["31.45", "31", "28", "15", "14.5"];
  // map a dosing calculator → the matching Dosing-tracker chemical, for "track this addition"
  const CALC_TO_CHEM = { chlorine: "chlorine", slamcalc: "chlorine", calhypo: "calhypo", trichlor: "trichlor", acid: "acid", taDown: "acid", phup: "sodaAsh", ta: "bakingSoda", ch: "calcium", stabilizer: "cya", salt: "salt" };

  function calcVolume(card, p) {
    const d = JSON.parse(JSON.stringify(p));
    card.innerHTML = calcHead("Pool volume", "calc", "Change the shape or sizes to re-estimate.") + `
      <div class="grid cols-2" style="align-items:start;gap:20px">
        <div>
          <div class="field"><label>Shape</label><select class="input" id="cv-shape">${D.SHAPES.map((s) => `<option value="${s.key}" ${d.shape === s.key ? "selected" : ""}>${s.name}</option>`).join("")}</select></div>
          <div id="cv-dims"></div>
        </div>
        <div class="card" style="background:var(--foam-2)"><div class="figure" id="cv-fig"></div>
          <div class="center" style="margin-top:8px"><div class="muted" style="font-size:.8rem">Estimated volume</div><div style="font-size:2.2rem;font-weight:800;color:var(--ink-accent)" id="cv-vol">—</div>
          <button class="btn btn--primary btn--sm" id="cv-save" style="margin-top:8px">Use this for my pool</button></div>
        </div>
      </div>`;
    const dims = JSON.parse(JSON.stringify(p.dims || {}));
    let depth = p.avgDepth || 5; let shape = p.shape || "rectangle";
    function renderDims() {
      const sh = D.SHAPES.find((x) => x.key === shape) || D.SHAPES[0];
      const labels = { a: shape === "L" ? "Leg 1 length" : "Length", w: shape === "L" ? "Leg 1 width" : "Width", b: "Leg 2 length", w2: "Leg 2 width", d: "Diameter" };
      $("#cv-dims").innerHTML = sh.needs.map((k) => `<div class="field"><label>${labels[k]} (ft)</label><div class="input-group"><input class="input" type="number" step="any" data-dim="${k}" value="${dims[k] != null ? dims[k] : ""}"><span class="input-suffix">ft</span></div></div>`).join("") +
        `<div class="field"><label>Average depth (ft) ${info("volume")}</label><div class="input-group"><input class="input" type="number" step="any" id="cv-depth" value="${depth}"><span class="input-suffix">ft</span></div></div>`;
      $$("#cv-dims [data-dim]").forEach((i) => i.addEventListener("input", upd));
      $("#cv-depth").addEventListener("input", upd);
      labelFields($("#cv-dims"));
      upd();
    }
    function upd() {
      const sh = D.SHAPES.find((x) => x.key === shape) || D.SHAPES[0];
      sh.needs.forEach((k) => { const i = $(`#cv-dims [data-dim="${k}"]`); if (i) dims[k] = parseFloat(i.value) || 0; });
      const di = $("#cv-depth"); if (di) depth = parseFloat(di.value) || 0;
      const vol = C.volume(shape, dims, depth);
      $("#cv-vol").textContent = vol ? vol.toLocaleString() + " gal" : "—";
      $("#cv-fig").innerHTML = S.poolShape(shape, { a: dims.a ? dims.a + "'" : "", w: dims.w ? dims.w + "'" : "", b: dims.b ? dims.b + "'" : "" });
      card._vol = vol; card._shape = shape; card._dims = dims; card._depth = depth;
    }
    $("#cv-shape").addEventListener("change", (e) => { shape = e.target.value; renderDims(); });
    $("#cv-save").addEventListener("click", () => { state.profile.shape = card._shape; state.profile.dims = card._dims; state.profile.avgDepth = card._depth; state.profile.volume = card._vol; save(); updateAppbar(); toast("Saved — all calculators now use " + card._vol.toLocaleString() + " gal.", "good"); });
    renderDims();
  }

  function calcChlorine(card, p, r) {
    card.innerHTML = calcHead("Chlorine dose", "droplet", "Liquid chlorine needed to reach a target Free Chlorine. The graph shows the gallons for any FC target.") + `
      <div class="grid cols-4" style="gap:14px">
        <div class="field"><label>Current FC ${info("fc")}</label><input class="input" type="number" step="any" id="cc-cur" value="${r.fc != null ? r.fc : 0}">${rangeHint("fc")}</div>
        <div class="field"><label>Target FC</label><input class="input" type="number" step="any" id="cc-tgt" value="${C.fcTargets(r.cya != null ? r.cya : 40, p.sanitizer === "salt").target}"><div class="range-hint">${S.icon("target")} <span>your target: <b>${C.fcTargets(r.cya != null ? r.cya : 40, p.sanitizer === "salt").targetLo}–${C.fcTargets(r.cya != null ? r.cya : 40, p.sanitizer === "salt").targetHi}</b></span></div></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="cc-vol" value="${p.volume}"></div>
        <div class="field"><label>Strength ${info("strength")}</label><select class="input" id="cc-pct">${["6", "8.25", "10", "12.5"].map((x) => `<option ${p.chlorinePct === x ? "selected" : ""}>${x}%</option>`).join("")}</select></div>
      </div>
      <div id="cc-out"></div><div id="cc-viz"></div>`;
    function upd() {
      const cur = parseFloat($("#cc-cur").value) || 0, tgt = parseFloat($("#cc-tgt").value) || 0;
      const vol = parseFloat($("#cc-vol").value) || p.volume; const pct = ($("#cc-pct").value || "10").replace("%", "");
      const cya = r.cya != null ? r.cya : 40, t = C.fcTargets(cya, p.sanitizer === "salt");
      const g = C.chlorineGallons(tgt - cur, vol, pct);
      $("#cc-out").innerHTML = tgt > cur ? out(`Add <b>${C.fmtGal(g)}</b> of ${pct}% liquid chlorine to raise FC from ${cur} to ${tgt} ppm.<br><span class="muted" style="font-size:.85rem">${C.jugs(g) ? "<b>" + C.jugs(g) + "</b> · " : ""}≈ ${Math.round(g * 128)} fl oz. Dose after sunset; circulate, then re-test.</span>`) : `<div class="callout" style="margin-top:6px">FC is already at or above your target — no chlorine needed.</div>`;
      const top = Math.max(t.slam, tgt, cur + 1), pts = [];
      for (let fc = Math.max(0, cur); fc <= top + 0.01; fc += Math.max(0.5, (top - Math.max(0, cur)) / 24)) pts.push({ x: fc, y: C.chlorineGallons(Math.max(0, fc - cur), vol, pct) });
      const chart = CH.curve({ points: pts, color: "#15aabf", xLabel: "target Free Chlorine (ppm)", yLabel: "gallons",
        bands: [{ axis: "x", from: t.targetLo, to: t.targetHi, color: "#12b88622", label: "daily target", text: "#12b886" }],
        marker: { x: tgt, y: Math.max(0, g), label: C.fmtGal(g) + " gal" }, fmtY: (v) => Math.round(v * 100) / 100 });
      const row = (lab, fc, gg) => `<tr><td>${lab}</td><td class="num">${fc}</td><td class="num">${C.fmtGal(Math.max(0, gg))}</td></tr>`;
      $("#cc-viz").innerHTML = `<div class="figure" style="margin-top:8px">${chart}</div>
        <div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>To reach (for CYA ${cya})</th><th class="num">FC ppm</th><th class="num">${pct}% chlorine</th></tr></thead><tbody>
        ${row("Minimum", t.min, C.chlorineGallons(t.min - cur, vol, pct))}
        ${row("Daily target", t.targetLo + "–" + t.targetHi, C.chlorineGallons(t.target - cur, vol, pct))}
        ${row("SLAM level", t.slam, C.chlorineGallons(t.slam - cur, vol, pct))}
        </tbody></table></div>`;
    }
    $$("#calcCard input,#calcCard select").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcSlam(card, p, r) {
    card.innerHTML = calcHead("SLAM calculator", "slam", "The level to hold to kill algae — and how much chlorine to get there.") + `
      <div class="grid cols-2" style="gap:16px">
        <div class="field"><label>Your CYA (ppm) ${info("cya")}</label><input class="input" type="number" id="cs-cya" value="${r.cya != null ? r.cya : 40}"></div>
        <div class="field"><label>Current FC (ppm)</label><input class="input" type="number" step="any" id="cs-fc" value="${r.fc != null ? r.fc : 0}"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="cs-vol" value="${p.volume}"></div>
        <div class="field"><label>Chlorine strength</label><select class="input" id="cs-pct">${["6", "8.25", "10", "12.5"].map((x) => `<option ${p.chlorinePct === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      </div>
      <div id="cs-out"></div>
      <div class="callout callout--warn" style="margin-top:12px">${S.icon("warn")}<div><strong>Buy double.</strong> Algae eats chlorine fast — you'll re-dose to SLAM level many times a day. Buy about twice your initial-dose amount to start.</div></div>
      <div id="cs-viz"></div>`;
    function upd() {
      const cya = parseFloat($("#cs-cya").value) || 0, fc = parseFloat($("#cs-fc").value) || 0;
      const vol = parseFloat($("#cs-vol").value) || p.volume, pct = $("#cs-pct").value;
      const t = C.fcTargets(cya, p.sanitizer === "salt");
      const g = C.chlorineGallons(t.slam - fc, vol, pct);
      $("#cs-out").innerHTML = out(`SLAM level for CYA ${cya} is <b>${t.slam} ppm FC</b>.<br>From ${fc} ppm, add <b>${C.fmtGal(g)}</b> of ${pct}% chlorine to get there now.<br><span class="muted" style="font-size:.85rem">Mustard/yellow algae? Hold the higher <b>${t.mustard} ppm</b>. Then keep re-dosing back to SLAM until the 3 exit tests pass.</span>`) +
        `<div style="margin-top:12px"><a class="btn btn--danger btn--sm" href="#slam">${S.icon("slam")} Open guided SLAM mode</a></div>`;
      if (cya > 90) $("#cs-out").innerHTML += `<div class="callout callout--bad" style="margin-top:10px">${S.icon("warn")}<div>CYA ${cya} is high — SLAM FC is impractical. <a href="#" data-open-calc="cya">Dilute CYA down first</a>.</div></div>`;
      $$("#cs-out [data-open-calc]").forEach((a) => a.addEventListener("click", (e) => { e.preventDefault(); openCalc("cya"); }));
      // SLAM gallons vs CYA — shows why high CYA is so expensive to SLAM
      const pts = [];
      for (let cy = 20; cy <= 100.01; cy += 5) { const tt = C.fcTargets(cy, p.sanitizer === "salt"); pts.push({ x: cy, y: C.chlorineGallons(tt.slam - fc, vol, pct) }); }
      const chart = CH.curve({ points: pts, color: "#e8590c", xLabel: "your CYA (ppm)", yLabel: "gallons to SLAM",
        bands: [{ axis: "x", from: 30, to: 50, color: "#12b88622", label: "ideal CYA", text: "#12b886" }],
        marker: { x: cya, y: Math.max(0, g), label: C.fmtGal(g) + " gal" }, fmtY: (v) => Math.round(v * 10) / 10 });
      $("#cs-viz").innerHTML = `<div class="figure" style="margin-top:10px">${chart}</div>
        <div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>Hold at</th><th class="num">FC ppm</th><th class="num">${pct}% chlorine now</th></tr></thead><tbody>
        <tr><td>Daily target</td><td class="num">${t.targetLo}–${t.targetHi}</td><td class="num">${C.fmtGal(C.chlorineGallons(t.target - fc, vol, pct))}</td></tr>
        <tr><td><strong>SLAM</strong></td><td class="num">${t.slam}</td><td class="num">${C.fmtGal(g)}</td></tr>
        <tr><td>Mustard SLAM</td><td class="num">${t.mustard}</td><td class="num">${C.fmtGal(C.chlorineGallons(t.mustard - fc, vol, pct))}</td></tr>
        </tbody></table></div><p class="muted center" style="font-size:.8rem;margin-top:6px">Lower CYA → far less chlorine to SLAM. That's the whole point of diluting first.</p>`;
    }
    $$("#calcCard input,#calcCard select").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcOclt(card, p, r) {
    card.innerHTML = calcHead("Overnight chlorine loss test (OCLT)", "clock", "The gold-standard “is the algae dead?” check. Measure FC at dusk (after the sun is off the water) and again at dawn before sunrise — healthy water loses less than 1 ppm.") + `
      <div class="grid cols-2" style="gap:16px">
        <div class="field"><label>FC at dusk</label><input class="input" type="number" step="any" id="oc-dusk" placeholder="e.g. 12"></div>
        <div class="field"><label>FC at dawn</label><input class="input" type="number" step="any" id="oc-dawn" placeholder="e.g. 11.5"></div>
      </div>
      <div id="oc-out"></div>`;
    function upd() {
      const dusk = parseFloat($("#oc-dusk").value), dawn = parseFloat($("#oc-dawn").value);
      if (isNaN(dusk) || isNaN(dawn)) { $("#oc-out").innerHTML = ""; return; }
      if (dawn > dusk) { $("#oc-out").innerHTML = `<div class="callout callout--warn" style="margin-top:8px">${S.icon("warn")}<div>Dawn FC (<b>${dawn}</b>) is higher than dusk (<b>${dusk}</b>) — chlorine can't rise overnight. Did you swap the readings?</div></div>`; return; }
      const loss = Math.round((dusk - dawn) * 10) / 10;
      const pass = loss < 1;
      $("#oc-out").innerHTML = `<div class="callout ${pass ? "callout--good" : "callout--warn"}" style="margin-top:8px">${S.icon(pass ? "check" : "warn")}<div>Overnight loss: <b>${loss} ppm</b> — ${pass ? "<b>PASS ✓</b> nothing's eating your chlorine overnight (the algae is dead). With CC ≤ 0.5 and clear water, your SLAM is complete." : "<b>not yet</b> — something is still consuming chlorine. Hold your SLAM level and test again tomorrow night."}</div></div>${state.slam && state.slam.active ? `<div style="margin-top:10px"><a class="btn btn--ghost btn--sm" href="#slam">${S.icon("slam")} Back to SLAM mode</a></div>` : ""}`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcAcid(card, p, r) {
    card.innerHTML = calcHead("Acid / pH down", "flask", "Muriatic acid to lower pH (it lowers TA a little too).") + `
      <div class="grid cols-2" style="gap:16px">
        <div class="field"><label>Current pH ${info("ph")}</label><input class="input" type="number" step="0.1" id="ca-cur" value="${r.ph != null ? r.ph : 7.8}"></div>
        <div class="field"><label>Target pH</label><input class="input" type="number" step="0.1" id="ca-tgt" value="7.6"></div>
        <div class="field"><label>Total Alkalinity ${info("ta")}</label><input class="input" type="number" id="ca-ta" value="${r.ta != null ? r.ta : 80}"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="ca-vol" value="${p.volume}"></div>
        <div class="field"><label>Acid strength</label><select class="input" id="ca-pct">${ACID_STRENGTHS.map((x) => `<option ${p.acidPct === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      </div>
      <div class="field" style="margin-top:2px"><label>Or — Taylor acid-demand drops <span class="badge">optional · more accurate</span> ${infoHTML("If your test kit has an <b>acid demand</b> test, add reagent drops to the pH sample until it hits target, then enter the drop count. It titrates <b>your</b> water, so it beats the pH+TA estimate. Taylor table: 1 drop ≈ 9.16 fl oz of 31.45% muriatic per 10,000 gal.")}</label>
        <div class="input-group" style="max-width:240px"><input class="input" type="number" step="any" inputmode="decimal" id="ca-drops" placeholder="e.g. 3"><span class="input-suffix">drops</span></div></div>
      <div id="ca-demand"></div>
      <div id="ca-out"></div><div id="ca-viz"></div>`;
    function upd() {
      const cur = parseFloat($("#ca-cur").value), tgt = parseFloat($("#ca-tgt").value), ta = parseFloat($("#ca-ta").value) || 80, vol = parseFloat($("#ca-vol").value) || p.volume, pct = $("#ca-pct").value;
      const a = C.acidForPH(cur, tgt, ta, vol, pct);
      // Taylor acid-demand titration (overrides the estimate when present — it's measured from the real water)
      const drops = parseFloat($("#ca-drops").value);
      const dm = (drops > 0) ? C.acidFromDemand(drops, vol, pct) : null;
      $("#ca-demand").innerHTML = dm ? `<div class="callout callout--good" style="margin-top:10px">${S.icon("target")}<div><b>From your ${drops}-drop acid-demand test:</b> add <b>${C.fmtFlOz(dm.flOz)}</b> of ${pct}% muriatic acid (or ~<b>${C.fmtLb(dm.dryAcidOz / 16)}</b> of dry acid). <span class="muted">Titrated from your actual water — trust this over the pH-based estimate below. Add ¾, circulate, re-test.</span></div></div>` : "";
      $("#ca-out").innerHTML = a ? out(`Add about <b>${C.fmtFlOz(a.flOz)}</b> of ${pct}% muriatic acid to go from pH ${cur} to ${tgt}.<br><span class="muted" style="font-size:.85rem">This also lowers TA by ~${a.taDrop} ppm. Pour slowly over a return with the pump on. Add ¾, circulate 30 min, re-test.</span>`) : `<div class="callout" style="margin-top:6px">pH is already at or below target — no acid needed.</div>`;
      const pts = [];
      for (let ph = 7.0; ph <= cur - 0.001; ph += 0.05) { const aa = C.acidForPH(cur, ph, ta, vol, pct); if (aa) pts.push({ x: ph, y: aa.flOz }); }
      const chart = pts.length > 1 ? CH.curve({ points: pts.reverse(), color: "#f08c00", xLabel: "target pH", yLabel: "fl oz",
        bands: [{ axis: "x", from: 7.5, to: 7.8, color: "#12b88622", label: "ideal pH", text: "#12b886" }],
        marker: a ? { x: tgt, y: a.flOz, label: Math.round(a.flOz) + " oz" } : null, fmtX: (v) => (Math.round(v * 10) / 10).toFixed(1) }) : "";
      const taRow = [60, 80, 100, 120].map((tt) => { const aa = C.acidForPH(cur, tgt, tt, vol, pct); return `<tr><td>TA ${tt}</td><td class="num">${aa ? C.fmtFlOz(aa.flOz) : "—"}</td></tr>`; }).join("");
      $("#ca-viz").innerHTML = (chart ? `<div class="figure" style="margin-top:8px">${chart}</div>` : "") +
        `<div class="callout callout--warn" style="margin-top:10px;font-size:.85rem">${S.icon("info")}<div>Acid-per-pH depends on your <b>alkalinity</b> &amp; starting pH — buffering is stronger near 7.5, so the last bit costs more. Same drop (${isNaN(cur) ? "?" : cur}→${isNaN(tgt) ? "?" : tgt}) at different TA:</div></div>
        <div class="tbl-wrap" style="margin-top:8px"><table class="tbl"><thead><tr><th>If TA is…</th><th class="num">${pct}% muriatic</th></tr></thead><tbody>${taRow}</tbody></table></div>`;
    }
    $$("#calcCard input,#calcCard select").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcCya(card, p, r) {
    const PARAMS = {
      cya: { name: "CYA", unit: "ppm", cur: r.cya != null ? r.cya : 80, tgt: p.sanitizer === "salt" ? 70 : 40, fill: 0, note: "Tap water has zero CYA, so every drain fully counts." },
      ch: { name: "Calcium (CH)", unit: "ppm", cur: r.ch != null ? r.ch : 600, tgt: 350, fill: 250, note: "Your <b>fill water already contains calcium</b>, so draining only helps down toward the tap level — a mobile <b>reverse-osmosis</b> service is the real fix for very hard water." },
      salt: { name: "Salt", unit: "ppm", cur: r.salt != null ? r.salt : 4000, tgt: 3200, fill: 0, note: "Fresh water has almost no salt, so draining works well." },
    };
    const frac0 = p.avgDepth ? Math.round((1 / p.avgDepth) * 100) : 20;
    card.innerHTML = calcHead("Dilution planner", "leak", "Some things (CYA, calcium, salt, TDS) can only come DOWN by replacing water. Plan your drain/refill cycles.") + `
      <div class="field"><label>What do you want to lower? ${infoHTML("CYA, calcium &amp; salt don't break down or evaporate — the only way down is swapping water (or reverse osmosis).")}</label>
        <div class="seg" id="cy-which">${Object.keys(PARAMS).map((k, i) => `<button data-w="${k}" class="${i === 0 ? "is-on" : ""}">${PARAMS[k].name}</button>`).join("")}</div></div>
      <div class="grid cols-4" style="gap:14px" id="cy-inputs"></div>
      <div id="cy-out"></div>`;
    let which = (state.ui.dilWhich && PARAMS[state.ui.dilWhich]) ? state.ui.dilWhich : "cya";
    function renderInputs() {
      const P = PARAMS[which];
      $("#cy-inputs").innerHTML = `
        <div class="field"><label>Current (${P.unit})</label><input class="input" type="number" id="cy-cur" value="${P.cur}"></div>
        <div class="field"><label>Target (${P.unit})</label><input class="input" type="number" id="cy-tgt" value="${P.tgt}"></div>
        <div class="field"><label>Fill-water level ${infoHTML("How much of this is already in your tap/fill water. CYA &amp; salt are ~0; calcium can be high in hard water.")}</label><input class="input" type="number" id="cy-fill" value="${P.fill}"></div>
        <div class="field"><label>Replaced per cycle (%) ${infoHTML("Draining 1 ft from a 5-ft-average pool swaps ~20%. = 1 ÷ average depth.")}</label><input class="input" type="number" id="cy-frac" value="${frac0}"></div>`;
      $$("#cy-inputs input").forEach((i) => i.addEventListener("input", upd));
      labelFields($("#cy-inputs"));
      upd();
    }
    function upd() {
      const P = PARAMS[which];
      const cur = parseFloat($("#cy-cur").value) || 0, tgt = parseFloat($("#cy-tgt").value) || 0, fill = parseFloat($("#cy-fill").value) || 0;
      const frac = (parseFloat($("#cy-frac").value) || 20) / 100;
      if (!(cur > tgt)) { $("#cy-out").innerHTML = `<div class="callout" style="margin-top:6px">${P.name} is already at/below target — nothing to dilute.</div>`; return; }
      if (tgt <= fill) { $("#cy-out").innerHTML = `<div class="callout callout--warn" style="margin-top:6px">${S.icon("warn")}<div>Your fill water is ~${fill} ${P.unit} — draining &amp; refilling can't get below that. ${P.note} For a true reset, use a <b>mobile reverse-osmosis</b> service.</div></div>`; return; }
      const cycles = Math.ceil(Math.log((tgt - fill) / (cur - fill)) / Math.log(1 - frac));
      const rows = []; let v = cur; for (let i = 0; i <= Math.min(10, cycles + 2); i++) { rows.push(v); v = fill + (v - fill) * (1 - frac); }
      const reach = rows.findIndex((x) => x <= tgt);
      const totalFrac = 1 - Math.pow(1 - frac, cycles);
      const chart = CH.bars({ items: rows.map((x, i) => ({ label: i === 0 ? "now" : "" + i, value: Math.max(0, Math.round(x)), color: x <= tgt ? "#20c997" : "#15aabf" })), highlight: reach, yLabel: P.unit, fmtV: (vv) => Math.round(vv) });
      const totalGal = Math.round(cycles * frac * (p.volume || 14000) / 100) * 100;
      $("#cy-out").innerHTML = out(`About <b>${cycles} drain/refill cycle${cycles > 1 ? "s" : ""}</b> (replacing ${Math.round(frac * 100)}% each) to bring ${P.name} from ${cur} to ~${tgt} ${P.unit}.<br><span class="muted" style="font-size:.85rem">Roughly <b>${Math.round(totalFrac * 100)}%</b> of your water — about <b>${totalGal.toLocaleString()} gal</b> total. Drain the old water <em>first</em>, then refill.</span>`) +
        `<div class="callout callout--warn" style="margin-top:10px;font-size:.85rem">${S.icon("info")}<div>${P.note} ${totalGal > 8000 ? "<b>Check your local drain/sewer &amp; drought rules</b> before draining this much." : ""}</div></div>
         <div class="figure" style="margin-top:10px">${chart}</div>`;
    }
    $$("#cy-which button").forEach((b) => b.addEventListener("click", () => { which = b.getAttribute("data-w"); state.ui.dilWhich = which; save(); $$("#cy-which button").forEach((x) => x.classList.toggle("is-on", x === b)); renderInputs(); }));
    renderInputs();
  }

  function calcStab(card, p, r) {
    card.innerHTML = calcHead("Add stabilizer (CYA up)", "sun", "Granular cyanuric acid to raise CYA.") + `
      <div class="grid cols-2" style="gap:16px">
        <div class="field"><label>Current CYA</label><input class="input" type="number" id="st-cur" value="${r.cya != null ? r.cya : 20}"></div>
        <div class="field"><label>Target CYA</label><input class="input" type="number" id="st-tgt" value="${p.sanitizer === "salt" ? 70 : 40}"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="st-vol" value="${p.volume}"></div>
      </div><div id="st-out"></div><div id="st-viz"></div>`;
    function upd() {
      const cur = parseFloat($("#st-cur").value) || 0, tgt = parseFloat($("#st-tgt").value) || 0, vol = parseFloat($("#st-vol").value) || p.volume;
      const oz = C.cyaToRaise(tgt - cur, vol);
      $("#st-out").innerHTML = tgt > cur ? out(`Add <b>${C.fmtLb(oz / 16)}</b> of granular stabilizer to raise CYA from ${cur} to ${tgt}.<br><span class="muted" style="font-size:.85rem">Put it in a sock in the skimmer basket; it dissolves over ~a week. Don't backwash for a few days.</span>`) : `<div class="callout" style="margin-top:6px">CYA already at target.</div>`;
      $("#st-viz").innerHTML = `<div class="figure" style="margin-top:8px">${CH.bars({ items: [30, 40, 50, 60, 70].map((tt) => ({ label: "→" + tt, value: Math.max(0, C.cyaToRaise(tt - cur, vol) / 16), color: tt === tgt ? "#845ef7" : "#cbb8fc" })), highlight: [30, 40, 50, 60, 70].indexOf(tgt), yLabel: "lb stabilizer", fmtV: (v) => v < 1 ? Math.round(v * 16) + "oz" : (Math.round(v * 10) / 10) + "#" })}</div><p class="muted center" style="font-size:.8rem">lb of stabilizer to reach each CYA, from your current ${cur}</p>`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcTa(card, p, r) {
    card.innerHTML = calcHead("Alkalinity (TA) up", "beaker", "Baking soda to raise Total Alkalinity.") + `
      <div class="grid cols-2" style="gap:16px">
        <div class="field"><label>Current TA</label><input class="input" type="number" id="ta-cur" value="${r.ta != null ? r.ta : 50}"></div>
        <div class="field"><label>Target TA</label><input class="input" type="number" id="ta-tgt" value="70"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="ta-vol" value="${p.volume}"></div>
      </div><div id="ta-out"></div>
      <div class="callout callout--warn" style="margin-top:10px">${S.icon("info")}<div>To <strong>lower</strong> TA there's no chemical — use the acid + aeration method (see Learn).</div></div>
      <div id="ta-viz"></div>`;
    function upd() {
      const cur = parseFloat($("#ta-cur").value) || 0, tgt = parseFloat($("#ta-tgt").value) || 0, vol = parseFloat($("#ta-vol").value) || p.volume;
      const lb = C.bakingSodaForTA(tgt - cur, vol);
      $("#ta-out").innerHTML = tgt > cur ? out(`Add <b>${C.fmtLb(lb)}</b> of baking soda (sodium bicarbonate) to raise TA from ${cur} to ${tgt}.<br><span class="muted" style="font-size:.85rem">Broadcast over the pool with the pump running. It nudges pH up slightly too.</span>`) : `<div class="callout" style="margin-top:6px">TA already at/above target.</div>`;
      $("#ta-viz").innerHTML = `<div class="figure" style="margin-top:8px">${CH.bars({ items: [60, 70, 80, 90].map((tt) => ({ label: "→" + tt, value: Math.max(0, C.bakingSodaForTA(tt - cur, vol)), color: tt === tgt ? "#4263eb" : "#a5b4fc" })), highlight: [60, 70, 80, 90].indexOf(tgt), yLabel: "lb baking soda", fmtV: (v) => (Math.round(v * 10) / 10) + "#" })}</div><p class="muted center" style="font-size:.8rem">lb of baking soda to reach each TA, from your current ${cur}</p>`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcCh(card, p, r) {
    card.innerHTML = calcHead("Calcium (CH) up", "salt", "Calcium chloride to raise Calcium Hardness (plaster pools).") + `
      <div class="grid cols-2" style="gap:16px">
        <div class="field"><label>Current CH</label><input class="input" type="number" id="ch-cur" value="${r.ch != null ? r.ch : 150}"></div>
        <div class="field"><label>Target CH</label><input class="input" type="number" id="ch-tgt" value="300"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="ch-vol" value="${p.volume}"></div>
      </div><div id="ch-out"></div>
      <div class="callout" style="margin-top:10px">${S.icon("info")}<div>Can't lower calcium chemically — only by replacing water or reverse osmosis. In hard water, manage scale via <b>CSI</b> instead.</div></div>
      <div id="ch-viz"></div>`;
    function upd() {
      const cur = parseFloat($("#ch-cur").value) || 0, tgt = parseFloat($("#ch-tgt").value) || 0, vol = parseFloat($("#ch-vol").value) || p.volume;
      const lb = C.calciumForCH(tgt - cur, vol);
      $("#ch-out").innerHTML = tgt > cur ? out(`Add <b>${C.fmtLb(lb)}</b> of calcium chloride to raise CH from ${cur} to ${tgt}.<br><span class="muted" style="font-size:.85rem">Dissolve in a bucket of water first (it gets hot), then pour in slowly.</span>`) : `<div class="callout" style="margin-top:6px">CH already at/above target.</div>`;
      $("#ch-viz").innerHTML = `<div class="figure" style="margin-top:8px">${CH.bars({ items: [250, 300, 350, 400].map((tt) => ({ label: "→" + tt, value: Math.max(0, C.calciumForCH(tt - cur, vol)), color: tt === tgt ? "#868e96" : "#ced4da" })), highlight: [250, 300, 350, 400].indexOf(tgt), yLabel: "lb calcium chloride", fmtV: (v) => (Math.round(v * 10) / 10) + "#" })}</div><p class="muted center" style="font-size:.8rem">lb of calcium chloride to reach each CH, from your current ${cur}</p>`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcSalt(card, p, r) {
    card.innerHTML = calcHead("Salt", "salt", "Pool salt to reach your SWG's target.") + `
      <div class="grid cols-2" style="gap:16px">
        <div class="field"><label>Current salt</label><input class="input" type="number" id="sa-cur" value="${r.salt != null ? r.salt : 2800}"></div>
        <div class="field"><label>Target salt</label><input class="input" type="number" id="sa-tgt" value="3200"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="sa-vol" value="${p.volume}"></div>
      </div><div id="sa-out"></div><div id="sa-viz"></div>`;
    function upd() {
      const cur = parseFloat($("#sa-cur").value) || 0, tgt = parseFloat($("#sa-tgt").value) || 0, vol = parseFloat($("#sa-vol").value) || p.volume;
      const lb = C.saltToRaise(tgt - cur, vol);
      $("#sa-out").innerHTML = tgt > cur ? out(`Add <b>${C.fmtLb(lb)}</b> of pool salt (≈ ${Math.ceil(lb / 40)} × 40-lb bags) to go from ${cur} to ${tgt} ppm.<br><span class="muted" style="font-size:.85rem">Pour across the pool, brush to dissolve, run the pump several hours before testing.</span>`) : `<div class="callout" style="margin-top:6px">Salt already at/above target. To lower it, replace water.</div>`;
      $("#sa-viz").innerHTML = `<div class="figure" style="margin-top:8px">${CH.bars({ items: [3000, 3200, 3400].map((tt) => ({ label: "→" + tt, value: Math.max(0, Math.ceil(C.saltToRaise(tt - cur, vol) / 40)), color: tt === tgt ? "#15aabf" : "#9ec5d6" })), highlight: [3000, 3200, 3400].indexOf(tgt), yLabel: "40-lb bags", fmtV: (v) => v + " bag" + (v === 1 ? "" : "s") })}</div><p class="muted center" style="font-size:.8rem">40-lb bags to reach each salt level, from your current ${cur}</p>`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcCsi(card, p, r) {
    card.innerHTML = calcHead("CSI / scale check", "target", "Is your water balanced, scaling, or corrosive?") + `
      <div class="grid cols-3" style="gap:14px">
        <div class="field"><label>pH</label><input class="input" type="number" step="0.1" id="ci-ph" value="${r.ph != null ? r.ph : 7.6}"></div>
        <div class="field"><label>TA</label><input class="input" type="number" id="ci-ta" value="${r.ta != null ? r.ta : 70}"></div>
        <div class="field"><label>CH</label><input class="input" type="number" id="ci-ch" value="${r.ch != null ? r.ch : 350}"></div>
        <div class="field"><label>CYA</label><input class="input" type="number" id="ci-cya" value="${r.cya != null ? r.cya : 40}"></div>
        <div class="field"><label>Temp (°F) ${infoHTML("Warmer water scales more easily. If you don't test temperature, estimate by season.")}</label><input class="input" type="number" id="ci-t" value="${p.tempF || 82}"><div class="range-hint">${S.icon("info")} <span>spring ~65 · summer ~82 · fall ~72</span></div></div>
      </div>
      <div id="ci-out"></div><div id="ci-viz"></div>`;
    function upd() {
      const rr = { ph: parseFloat($("#ci-ph").value), ta: parseFloat($("#ci-ta").value), ch: parseFloat($("#ci-ch").value), cya: parseFloat($("#ci-cya").value) };
      const t = parseFloat($("#ci-t").value) || 82;
      const val = C.csi(rr, t);
      const cls = C.classify("csi", val, p);
      const verdict = val == null ? "Need pH, TA &amp; CH." : cls === "good" ? "Balanced — your water is happy. ✓" : val > 0.3 ? "Scaling — expect cloudiness &amp; crust. Lower pH and/or TA." : "Corrosive — can etch plaster &amp; corrode metal. Raise pH, TA, or CH.";
      $("#ci-out").innerHTML = `<div class="figure" style="margin-top:8px">${S.csiScale(val || 0)}</div>
        <div class="callout ${cls === "good" ? "callout--good" : cls === "warn" ? "callout--warn" : "callout--bad"}" style="margin-top:8px"><div><b style="font-size:1.2rem">CSI ${val == null ? "—" : (val > 0 ? "+" : "") + val}</b><br>${verdict}</div></div>`;
      // CSI vs pH — the most useful lever
      if (rr.ta && rr.ch) {
        const pts = [];
        for (let ph = 7.0; ph <= 8.2001; ph += 0.05) { const v = C.csi({ ph: ph, ta: rr.ta, ch: rr.ch, cya: rr.cya }, t); if (v != null) pts.push({ x: ph, y: v }); }
        const chart = CH.curve({ points: pts, color: "#12b886", xLabel: "pH", yLabel: "CSI",
          bands: [{ axis: "y", from: -0.3, to: 0.3, color: "#12b88622", label: "balanced" }],
          marker: (!isNaN(rr.ph) && val != null) ? { x: rr.ph, y: val, label: (val > 0 ? "+" : "") + val } : null,
          fmtX: (v) => (Math.round(v * 10) / 10).toFixed(1), fmtY: (v) => (Math.round(v * 100) / 100), zeroY: false });
        // suggest a pH to hit balance
        let suggest = "";
        if (val != null && (val > 0.3 || val < -0.3)) {
          let best = null; pts.forEach((pp) => { if (pp.y >= -0.3 && pp.y <= 0.3 && (best == null || Math.abs(pp.y) < Math.abs(best.y))) best = pp; });
          if (best) suggest = `<div class="callout callout--good" style="margin-top:8px;font-size:.88rem">${S.icon("target")}<div>Adjust pH to about <b>${(Math.round(best.x * 10) / 10).toFixed(1)}</b> and your CSI lands near <b>0</b> (balanced) — without touching calcium.</div></div>`;
        }
        $("#ci-viz").innerHTML = `<div class="figure" style="margin-top:10px">${chart}</div><p class="muted center" style="font-size:.8rem;margin-top:4px">CSI moves 1:1 with pH — the easiest lever.</p>${suggest}`;
      } else $("#ci-viz").innerHTML = "";
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcFill(card, p) {
    card.innerHTML = calcHead("Fill / drain time", "clock", "How long a garden hose takes — handy for refills during CYA dilution.") + `
      <div class="grid cols-2" style="gap:16px">
        <div class="field"><label>What are we filling?</label><select class="input" id="fl-mode"><option value="foot">One foot of water</option><option value="full">The whole pool</option><option value="gal">A set number of gallons</option></select></div>
        <div class="field" id="fl-galwrap" style="display:none"><label>Gallons</label><input class="input" type="number" id="fl-gal" value="3000"></div>
        <div class="field"><label>Hose flow (GPM) ${infoHTML("Time a 5-gal bucket: 25 sec = 12 GPM. Typical garden hose is 9–17 GPM. Two hoses ≈ double.")}</label><input class="input" type="number" id="fl-gpm" value="12"></div>
        <div class="field"><label>Number of hoses</label><input class="input" type="number" id="fl-hoses" value="1"></div>
      </div><div id="fl-out"></div><div id="fl-viz"></div>`;
    function upd() {
      const mode = $("#fl-mode").value;
      $("#fl-galwrap").style.display = mode === "gal" ? "" : "none";
      let gal;
      if (mode === "full") gal = p.volume;
      else if (mode === "gal") gal = parseFloat($("#fl-gal").value) || 0;
      else gal = Math.round(C.surfaceArea(p.shape, p.dims) * 1 * 7.48); // one foot
      const baseGpm = parseFloat($("#fl-gpm").value) || 12;
      const nh = Math.max(1, parseFloat($("#fl-hoses").value) || 1);
      const gpm = baseGpm * nh;
      const hrs = gal / gpm / 60;
      const fmtT = (h) => h < 1 ? Math.round(h * 60) + " min" : (Math.round(h * 10) / 10) + " hrs";
      $("#fl-out").innerHTML = out(`That's about <b>${gal.toLocaleString()} gallons</b> → <b>${fmtT(hrs)}</b> at ${gpm} GPM.<br><span class="muted" style="font-size:.85rem">${mode === "foot" ? "≈ one drain/refill cycle for CYA dilution. " : ""}A second hose on a different spigot roughly halves it.</span>`);
      const chart = CH.bars({ items: [1, 2, 3].map((n) => ({ label: n + (n === 1 ? " hose" : " hoses"), value: Math.round((gal / (baseGpm * n) / 60) * 10) / 10, color: n === nh ? "#15aabf" : "#9ec5d6" })), highlight: nh - 1, yLabel: "hours", fmtV: (v) => v < 1 ? Math.round(v * 60) + "m" : v + "h" });
      $("#fl-viz").innerHTML = `<div class="figure" style="margin-top:8px">${chart}</div><p class="muted center" style="font-size:.8rem">More hoses on separate spigots = proportionally faster.</p>`;
    }
    $$("#calcCard input,#calcCard select").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcCalhypo(card, p, r) {
    card.innerHTML = calcHead("Granular shock (cal-hypo)", "beaker", "Calcium-hypochlorite powder to raise FC. It also adds calcium — fine occasionally, watch it in hard water.") + `
      <div class="callout callout--bad" style="margin:4px 0 14px">${S.icon("warn")}<div><b>Fire hazard:</b> never add cal-hypo to a feeder, floater, or bucket that has held trichlor tablets — they can react and ignite. Use a fresh, clean container.</div></div>
      <div class="grid cols-4" style="gap:14px">
        <div class="field"><label>Current FC</label><input class="input" type="number" step="any" id="hy-cur" value="${r.fc != null ? r.fc : 0}">${rangeHint("fc")}</div>
        <div class="field"><label>Target FC</label><input class="input" type="number" step="any" id="hy-tgt" value="${C.fcTargets(r.cya != null ? r.cya : 40, p.sanitizer === "salt").slam}"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="hy-vol" value="${p.volume}"></div>
        <div class="field"><label>Cal-hypo % ${infoHTML("The available-chlorine percentage on the bag — usually 47–73%.")}</label><select class="input" id="hy-pct"><option>73</option><option>65</option><option>53</option><option>48</option></select></div>
      </div><div id="hy-out"></div>`;
    function upd() {
      const cur = parseFloat($("#hy-cur").value) || 0, tgt = parseFloat($("#hy-tgt").value) || 0, vol = parseFloat($("#hy-vol").value) || p.volume, pct = parseFloat($("#hy-pct").value) || 73;
      const fcPerLb = pct * D.DOSE.calhypoFCperLbPerPct;
      const lb = tgt > cur ? ((tgt - cur) / fcPerLb) * (vol / 10000) : 0;
      const ch = (tgt - cur) * D.DOSE.calhypoCHperFC;
      $("#hy-out").innerHTML = tgt > cur ? out(`Add <b>${C.fmtLb(lb)}</b> of ${pct}% cal-hypo to raise FC by ${Math.round((tgt - cur) * 10) / 10} ppm.<br><span class="muted" style="font-size:.85rem">Heads-up: this also adds ~<b>${Math.round(ch)} ppm calcium</b>. Pre-dissolve in a bucket. ⚠ Never add cal-hypo to a feeder/floater that held trichlor — it can ignite.</span>`) : `<div class="callout" style="margin-top:6px">FC already at/above target.</div>`;
    }
    $$("#calcCard input,#calcCard select").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcTrichlor(card, p, r) {
    card.innerHTML = calcHead("Tablet (trichlor) effect", "tablet", "See exactly how much chlorine — and how much permanent CYA — your tablets add. This is the trap behind most high-CYA pools.") + `
      <div class="grid cols-3" style="gap:14px">
        <div class="field"><label>3&quot; tabs per week</label><input class="input" type="number" step="any" id="tr-n" value="1"><div class="range-hint">${S.icon("info")} <span>typical <b>1–2</b> in summer</span></div></div>
        <div class="field"><label>Weeks</label><input class="input" type="number" id="tr-wk" value="12"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="tr-vol" value="${p.volume}"></div>
      </div><div id="tr-out"></div><div id="tr-viz"></div>`;
    function upd() {
      const n = parseFloat($("#tr-n").value) || 0, wk = parseFloat($("#tr-wk").value) || 0, vol = parseFloat($("#tr-vol").value) || p.volume, f = vol / 10000;
      const fcPerWeek = n * D.DOSE.trichlorFCperTab8oz / f, cyaPerWeek = n * D.DOSE.trichlorCYAperTab8oz / f;
      const startCya = r.cya != null ? r.cya : 30, totalCya = cyaPerWeek * wk;
      $("#tr-out").innerHTML = out(`Each week, ${n} tab${n === 1 ? "" : "s"} delivers ~<b>${Math.round(fcPerWeek * 10) / 10} ppm FC</b> and adds ~<b>${Math.round(cyaPerWeek * 10) / 10} ppm CYA</b> that never leaves.<br><span class="muted" style="font-size:.85rem">Over ${wk} weeks that's <b>+${Math.round(totalCya)} ppm CYA</b> — from ${startCya} up to ~<b>${Math.round(startCya + totalCya)}</b>.</span>`);
      const pts = []; for (let w = 0; w <= wk; w++) pts.push({ x: w, y: startCya + cyaPerWeek * w });
      const bands = (startCya + totalCya > 60) ? [{ axis: "y", from: 60, to: startCya + totalCya + 2, color: "#fa525222", label: "trouble zone (>60)", text: "#e03131" }] : [];
      const chart = CH.curve({ points: pts, color: "#e8590c", xLabel: "weeks on tablets", yLabel: "CYA ppm", bands: bands, marker: { x: wk, y: startCya + totalCya, label: Math.round(startCya + totalCya) + " ppm" }, fmtX: (v) => Math.round(v) });
      $("#tr-viz").innerHTML = `<div class="figure" style="margin-top:10px">${chart}</div><p class="muted center" style="font-size:.8rem">This is why TFP uses liquid chlorine day-to-day and saves tablets for trips.</p>`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcDichlor(card, p, r) {
    card.innerHTML = calcHead("Dichlor shock effect", "beaker", "Dichlor granular shock raises FC fast — but adds CYA (0.9 ppm per 1 ppm FC). See the consequence before you use it.") + `
      <div class="grid cols-3" style="gap:14px">
        <div class="field"><label>Raise FC by (ppm)</label><input class="input" type="number" step="any" id="di-fc" value="10"></div>
        <div class="field"><label>Current CYA</label><input class="input" type="number" id="di-cya" value="${r.cya != null ? r.cya : 40}">${rangeHint("cya")}</div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="di-vol" value="${p.volume}"></div>
      </div><div id="di-out"></div>`;
    function upd() {
      const fc = parseFloat($("#di-fc").value) || 0, cya = parseFloat($("#di-cya").value) || 0;
      const cyaAdd = fc * D.DOSE.dichlorCYAperFC;
      $("#di-out").innerHTML = out(`Raising FC by <b>${fc} ppm</b> with dichlor adds about <b>+${Math.round(cyaAdd * 10) / 10} ppm CYA</b> — taking CYA from ${cya} to ~<b>${Math.round(cya + cyaAdd)}</b>.<br><span class="muted" style="font-size:.85rem">CYA never leaves on its own. Use dichlor sparingly — for a big FC boost, liquid chlorine adds zero CYA.</span>`) +
        `<div class="tbl-wrap" style="margin-top:10px"><table class="tbl"><thead><tr><th>Product</th><th class="num">CYA / 10 ppm FC</th><th>Trade-off</th></tr></thead><tbody>
          <tr><td><b>Liquid chlorine</b></td><td class="num">0</td><td class="muted">nothing — the TFP default</td></tr>
          <tr><td>Dichlor</td><td class="num">+9</td><td class="muted">fast, but raises CYA</td></tr>
          <tr><td>Trichlor tab</td><td class="num">+6</td><td class="muted">raises CYA &amp; is acidic</td></tr>
          <tr><td>Cal-hypo</td><td class="num">0</td><td class="muted">adds calcium instead</td></tr>
        </tbody></table></div>`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcPhup(card, p, r) {
    card.innerHTML = calcHead("Raise pH", "arrow", "Borax or soda ash to bring pH up — or just aerate, which is free.") + `
      <div class="grid cols-3" style="gap:14px">
        <div class="field"><label>Current pH ${info("ph")}</label><input class="input" type="number" step="0.1" id="pu-cur" value="${r.ph != null ? r.ph : 7.2}">${rangeHint("ph")}</div>
        <div class="field"><label>Target pH</label><input class="input" type="number" step="0.1" id="pu-tgt" value="7.6"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="pu-vol" value="${p.volume}"></div>
      </div>
      <div class="field" style="margin-top:2px"><label>Or — Taylor base-demand drops <span class="badge">optional · measured</span> ${infoHTML("If your kit has a <b>base demand</b> test, add reagent drops to the pH sample until it reaches target, then enter the count. Taylor table: 1 drop ≈ 5.13 oz soda ash per 10,000 gal. Soda ash raises TA a little too.")}</label>
        <div class="input-group" style="max-width:240px"><input class="input" type="number" step="any" inputmode="decimal" id="pu-drops" placeholder="e.g. 3"><span class="input-suffix">drops</span></div></div>
      <div id="pu-demand"></div><div id="pu-out"></div>`;
    function upd() {
      const cur = parseFloat($("#pu-cur").value), tgt = parseFloat($("#pu-tgt").value), vol = parseFloat($("#pu-vol").value) || p.volume, d = tgt - cur;
      const boraxOz = d > 0 ? (d / 0.1) * D.DOSE.boraxOzPer01PHper10k * (vol / 10000) : 0;
      const drops = parseFloat($("#pu-drops").value);
      const sodaOz = drops > 0 ? C.sodaAshFromDemand(drops, vol) : 0;
      $("#pu-demand").innerHTML = sodaOz > 0 ? `<div class="callout callout--good" style="margin-top:10px">${S.icon("target")}<div><b>From your ${drops}-drop base-demand test:</b> add <b>${C.fmtLb(sodaOz / 16)}</b> of soda ash (sodium carbonate) to reach target pH. <span class="muted">Measured from your water. Note: soda ash also nudges TA up — if TA's already fine, aerate instead (free).</span></div></div>` : "";
      $("#pu-out").innerHTML = d > 0 ? out(`Add about <b>${C.fmtLb(boraxOz / 16)}</b> of borax to raise pH from ${cur} to ${tgt}.<br><span class="muted" style="font-size:.85rem">Or <b>aerate for free</b> — point returns up, run a spillover/fountain and pH rises on its own. Soda ash also works but bumps TA up. pH-up is approximate — add ¾ and retest.</span>`) : `<div class="callout" style="margin-top:6px">pH is already at/above target — no need to raise it.</div>`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcTaDown(card, p, r) {
    card.innerHTML = calcHead("Lower alkalinity (TA)", "flask", "There's no 'TA reducer' — you lower TA with the acid + aeration method. Here's the acid and the steps.") + `
      <div class="grid cols-4" style="gap:14px">
        <div class="field"><label>Current TA</label><input class="input" type="number" id="td-cur" aria-label="Current TA" value="${r.ta != null ? r.ta : 120}">${rangeHint("ta")}</div>
        <div class="field"><label>Target TA</label><input class="input" type="number" id="td-tgt" aria-label="Target TA" value="70"></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="td-vol" aria-label="Pool volume in gallons" value="${p.volume}"></div>
        <div class="field"><label>Acid strength</label><select class="input" id="td-pct" aria-label="Acid strength">${ACID_STRENGTHS.map((x) => `<option ${p.acidPct === x ? "selected" : ""}>${x}</option>`).join("")}</select></div>
      </div><div id="td-out"></div>`;
    function upd() {
      const cur = parseFloat($("#td-cur").value) || 0, tgt = parseFloat($("#td-tgt").value) || 0, vol = parseFloat($("#td-vol").value) || p.volume, pct = $("#td-pct").value;
      const a = C.acidForTA(cur - tgt, vol, pct);
      $("#td-out").innerHTML = (cur > tgt && a) ? out(`Total acid to drop TA from ${cur} to ${tgt}: about <b>${C.fmtFlOz(a.flOz)}</b> of ${pct}% muriatic — but add it in rounds, not all at once.`) +
        `<div class="card" style="margin-top:12px;background:var(--foam-2)"><strong>${"❶"} The acid + aeration method</strong><ol style="margin:8px 0 0;padding-left:18px;color:var(--ink-2);line-height:1.85">
          <li>Add some acid to bring pH down to <b>~7.0–7.2</b> (this is what lowers TA).</li>
          <li><b>Aerate</b> — point returns up, run a fountain/spillover/spa. pH climbs back up <em>without</em> raising TA.</li>
          <li>Re-test. Repeat until TA reaches ${tgt}. Expect <b>several rounds over 1–3 weeks</b> — that's normal. <b>Never dump all the acid at once</b> (it would crash your pH).</li>
        </ol></div>` : `<div class="callout" style="margin-top:6px">TA already at/below target.</div>`;
    }
    $$("#calcCard input,#calcCard select").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcBorates(card, p, r) {
    card.innerHTML = calcHead("Borates", "droplet", "An optional 30–50 ppm of borates adds algae insurance and helps steady pH. Raise with boric acid.") + `
      <div class="grid cols-3" style="gap:14px">
        <div class="field"><label>Current borate</label><input class="input" type="number" id="bo-cur" value="0"><div class="range-hint">${S.icon("info")} <span>most pools <b>0</b></span></div></div>
        <div class="field"><label>Target borate</label><input class="input" type="number" id="bo-tgt" value="40"><div class="range-hint">${S.icon("info")} <span>ideal <b>30–50 ppm</b></span></div></div>
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="bo-vol" value="${p.volume}"></div>
      </div><div id="bo-out"></div>`;
    function upd() {
      const cur = parseFloat($("#bo-cur").value) || 0, tgt = parseFloat($("#bo-tgt").value) || 0, vol = parseFloat($("#bo-vol").value) || p.volume;
      const lb = tgt > cur ? ((tgt - cur) / 10) * D.DOSE.boricAcidLbPer10ppmPer10k * (vol / 10000) : 0;
      $("#bo-out").innerHTML = tgt > cur ? out(`Add <b>${C.fmtLb(lb)}</b> of boric acid to reach ${tgt} ppm borate.<br><span class="muted" style="font-size:.85rem">Boric acid is mildly acidic, so it nudges pH down a touch — re-check pH after. Borates suppress algae and buffer pH; they don't replace chlorine.</span>`) : `<div class="callout" style="margin-top:6px">Already at/above target.</div>`;
    }
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  function calcTurnover(card, p) {
    const hp0 = "1.5"; // most common residential size
    card.innerHTML = calcHead("Pump run-time", "clock", "How long to run your pump. 'Turnover' is the time to circulate your whole pool once.") + `
      <div class="grid cols-4" style="gap:14px">
        <div class="field"><label>Volume (gal)</label><input class="input" type="number" id="to-vol" value="${p.volume}"></div>
        <div class="field"><label>Pump size (HP) ${infoHTML("Most people know their pump's <b>horsepower</b>, not its flow — so pick the HP and we'll estimate GPM at typical pool plumbing &amp; head. It's a ballpark: pool-pump HP labels vary (uprated vs full-rated × service factor) and real flow depends on your pipe size, filter and head. Variable-speed pumps run slower day-to-day (lower GPM, more hours).")}</label>
          <select class="input" id="to-hp">${["0.5", "0.75", "1", "1.5", "2", "2.5", "3"].map((h) => `<option value="${h}" ${h === hp0 ? "selected" : ""}>${h} HP — ≈ ${D.PUMP_GPM_BY_HP[h]} GPM</option>`).join("")}</select>
          <div class="range-hint">${S.icon("info")} <span>don't know GPM? pick your HP</span></div></div>
        <div class="field"><label>Pump flow (GPM)</label><input class="input" type="number" id="to-gpm" value="${D.PUMP_GPM_BY_HP[hp0]}"><div class="range-hint" id="to-gpmhint">${S.icon("info")} <span>est. from ${hp0} HP — edit if you know it</span></div></div>
        <div class="field"><label>Turnovers / day</label><input class="input" type="number" step="any" id="to-tn" value="1"><div class="range-hint">${S.icon("info")} <span>1–2 is plenty</span></div></div>
      </div><div id="to-out"></div>`;
    function estFromHp() {
      const hp = $("#to-hp").value, g = C.gpmFromHp(hp);
      if (g) { $("#to-gpm").value = Math.round(g); const h = $("#to-gpmhint"); if (h) h.innerHTML = `${S.icon("info")} <span>est. from ${hp} HP at typical head — override if you know your exact flow</span>`; }
    }
    function upd() {
      const vol = parseFloat($("#to-vol").value) || p.volume, gpm = parseFloat($("#to-gpm").value) || 50, tn = parseFloat($("#to-tn").value) || 1;
      const oneTurn = vol / (gpm * 60), hrs = oneTurn * tn;
      $("#to-out").innerHTML = out(`One turnover takes about <b>${Math.round(oneTurn * 10) / 10} hours</b> at ${Math.round(gpm)} GPM. Running ${tn} turnover${tn === 1 ? "" : "s"}/day ≈ <b>${Math.round(hrs * 10) / 10} hours/day</b>.<br><span class="muted" style="font-size:.85rem">TFP rule: run enough to keep water clear &amp; chemicals mixed — often <b>6–12 hrs/day</b>. During a SLAM, run <b>24/7</b>. Variable-speed pumps save money running longer at low speed (lower GPM means more hours, same result).</span>`);
    }
    $("#to-hp").addEventListener("change", () => { estFromHp(); upd(); });
    $("#to-gpm").addEventListener("input", () => { const h = $("#to-gpmhint"); if (h) h.innerHTML = `${S.icon("info")} <span>using your entered value</span>`; });
    $$("#calcCard input").forEach((i) => i.addEventListener("input", upd)); upd();
  }

  /* ===================================================================
     SLAM MODE
     =================================================================== */
  RENDER.slam = function () {
    const p = profile(); const r = latest(); const v = $("#view-slam");
    const cya = r.cya != null ? r.cya : 40;
    const t = C.fcTargets(cya, p.sanitizer === "salt");
    const slamCurFC = r.fc != null ? r.fc : 0;
    const slamNeed = t.slam - slamCurFC;
    const slamGal = C.chlorineGallons(Math.max(0, slamNeed), p.volume, p.chlorinePct);
    const slamLb = slamNeed > 0 ? (slamNeed / (73 * D.DOSE.calhypoFCperLbPerPct)) * (p.volume / 10000) : 0;
    const sl = state.slam || {};
    if (!sl.active) {
      v.innerHTML = `
        <div class="page-head"><span class="eyebrow">${S.icon("slam")} SLAM Mode</span>
          <h1>Clear an algae bloom — the SLAM way</h1>
          <p class="lead">SLAM = <strong>S</strong>hock <strong>L</strong>evel <strong>A</strong>nd <strong>M</strong>aintain. You hold Free Chlorine high (about 40% of your CYA) and keep it there until three tests prove the algae is dead. It's a process, not a one-time dump of chemicals.</p></div>
        <div class="callout" style="margin-bottom:18px">${S.icon("info")}<div><b>Not sure you even have algae?</b> Run the overnight test first (FC at dusk vs. dawn). If FC drops <b>less than 1 ppm overnight</b>, your water is clean — you can skip the whole SLAM.</div></div>
        <div class="grid cols-2" style="align-items:start;gap:22px">
          <div class="card pad-lg">
            <div class="card__title">${S.icon("info")} How it works</div>
            <div class="figure" style="margin:6px 0 14px">${S.slamFlow()}</div>
            <p class="muted">You're done only when <strong>all three</strong> pass:</p>
            <div class="figure">${S.exitCriteria()}</div>
          </div>
          <div class="card pad-lg">
            <div class="card__title">${S.icon("target")} Your SLAM target</div>
            <p class="muted">For your CYA of <strong>${cya}</strong>:</p>
            <div class="kpi" style="margin:6px 0"><b style="color:var(--warn);font-size:2.4rem">${t.slam} ppm</b><span>hold Free Chlorine here</span></div>
            ${slamNeed <= 0
              ? `<div class="callout callout--good" style="margin:10px 0">${S.icon("check")}<div>Your FC (<b>${slamCurFC}</b>) is already at SLAM level — just hold it here and keep testing.</div></div>`
              : `<div class="callout callout--good" style="margin:10px 0">${S.icon("droplet")}<div>To get from your current FC of <b>${slamCurFC}</b> up to <b>${t.slam} ppm</b>, add about:
                  <div style="font-size:1.25rem;margin-top:7px;font-weight:800;color:var(--ink-accent)">${C.fmtGal(slamGal)} of ${p.chlorinePct}% liquid chlorine</div>
                  <div class="muted" style="font-size:.85rem;margin-top:4px">…or ~<b>${C.fmtLb(slamLb)}</b> of cal-hypo shock (≈ <b>${Math.ceil(slamLb)}</b> × 1-lb bag${Math.ceil(slamLb) > 1 ? "s" : ""}). Liquid is preferred — cal-hypo adds calcium.</div></div></div>
                <div class="callout callout--warn" style="margin-bottom:4px;font-size:.85rem">${S.icon("warn")}<div><b>Buy about double</b> — algae burns through chlorine, so you'll re-dose back to ${t.slam} ppm several times a day until it clears.</div></div>`}
            ${cya > 90 ? `<div class="callout callout--bad">${S.icon("warn")}<div>Your CYA (${cya}) is high — holding ${t.slam} ppm is hard &amp; expensive. <a href="#" id="slam-dilute">Dilute CYA down first</a>.</div></div>` : ""}
            <p class="muted" style="margin-top:12px">Before you start: lower pH to ~7.2 and make sure your filter is running 24/7.</p>
            <button class="btn btn--danger btn--block btn--lg" id="startSlam">${S.icon("slam")} Start SLAM</button>
            <p class="hint center" style="margin-top:8px">Poolaris will track your FC top-ups, the overnight test, and the exit criteria.</p>
          </div>
        </div>
        <div class="card pad-lg" style="margin-top:22px">
          <div class="card__title">${S.icon("learn")} The steps</div>
          <div class="stack" style="margin-top:8px">${D.SLAM_STEPS.map((s, i) => `<div class="action" data-prio="info"><div class="action__num">${i + 1}</div><div class="action__body"><div class="action__title">${s.t}</div><div class="action__why">${s.d}</div></div></div>`).join("")}</div>
        </div>`;
      $("#startSlam") && $("#startSlam").addEventListener("click", () => {
        state.slam = { active: true, started: Date.now(), cya: cya, target: t.slam, ocl: {}, exit: { cc: false, ocl: false, clear: false }, doses: [] };
        save(); updateAppbar(); toast("SLAM started. Hold FC at " + t.slam + " ppm.", "info"); RENDER.slam();
      });
      $("#slam-dilute") && $("#slam-dilute").addEventListener("click", (e) => { e.preventDefault(); go("calculators"); setTimeout(() => openCalc("cya"), 50); });
      return;
    }
    // active SLAM
    const days = Math.max(1, Math.ceil((Date.now() - sl.started) / 86400000));
    v.innerHTML = `
      <div class="page-head"><span class="eyebrow" style="color:var(--crit)">${S.icon("slam")} SLAM · day ${days}</span>
        <h1>Hold FC at ${sl.target} ppm</h1>
        <p class="lead">Keep Free Chlorine pinned at ${sl.target}. Brush daily, filter 24/7, and clean the filter when pressure climbs ~25% over clean.</p></div>
      <div class="callout callout--sun" style="margin-bottom:18px">${S.icon("clock")}<div><b>Day ${days}.</b> While the water's green, test &amp; top up <b>3–5× a day</b> (every 2–3 hrs in daylight) — never let FC drift down, even a couple of low hours can restart the bloom. Most pools clear by <b>day 3–5</b>, then the overnight test starts passing.${days >= 4 ? " <b>Water looking clear? Run the overnight test →</b>" : ""}</div></div>
      <div class="grid cols-2" style="align-items:start;gap:22px">
        <div class="card pad-lg">
          <div class="card__title">${S.icon("droplet")} Top up now</div>
          <div class="field"><label>FC you just measured</label><input class="input" type="number" step="any" id="slam-fc" placeholder="e.g. ${Math.round(sl.target * 0.6)}"></div>
          <div id="slam-dose"></div>
        </div>
        <div class="card pad-lg">
          <div class="card__title">${S.icon("clock")} Overnight test (OCLT) ${info("ocl")}</div>
          <div class="grid cols-2" style="gap:12px">
            <div class="field"><label>FC at dusk</label><input class="input" type="number" step="any" id="ocl-dusk" value="${sl.ocl.dusk != null ? sl.ocl.dusk : ""}"></div>
            <div class="field"><label>FC at dawn</label><input class="input" type="number" step="any" id="ocl-dawn" value="${sl.ocl.dawn != null ? sl.ocl.dawn : ""}"></div>
          </div>
          <button class="btn btn--ghost btn--block" id="ocl-check">Check overnight loss</button>
          <div id="ocl-out" style="margin-top:10px"></div>
        </div>
      </div>
      <div class="card pad-lg" style="margin-top:22px">
        <div class="card__title">${S.icon("check")} Exit criteria — all three must pass</div>
        <div class="grid cols-3" style="gap:14px;margin-top:8px">
          <div class="card" style="text-align:left;border:1.5px solid ${sl.exit.cc ? "var(--good)" : "var(--line)"};background:${sl.exit.cc ? "var(--good-bg)" : "#fff"}" role="group" aria-label="Combined chlorine exit test">
            <div class="flex"><span class="card__icon" style="background:${sl.exit.cc ? "var(--good)" : "var(--foam)"};color:${sl.exit.cc ? "#fff" : "var(--deep-2)"}">${S.icon("check")}</span>
            <div><div style="font-weight:750">CC ≤ 0.5 ppm</div><div class="muted" style="font-size:.8rem">Enter your measured CC</div></div></div>
            <div class="input-group" style="margin-top:10px;max-width:150px"><input class="input" type="number" step="any" inputmode="decimal" id="slam-cc" value="${sl.cc != null ? sl.cc : ""}" placeholder="e.g. 0" aria-label="Measured combined chlorine"><span class="input-suffix">ppm</span></div>
            <span class="chip ${sl.exit.cc ? "chip--good" : "chip--muted"}" style="margin-top:8px;font-size:.7rem" id="slam-cc-state">${sl.exit.cc ? "✓ Met" : sl.cc != null ? "Too high — keep going" : "Not yet"}</span>
          </div>
          ${exitCheck("ocl", "Overnight loss < 1 ppm", "Auto-set by the OCLT", sl.exit.ocl)}
          ${exitCheck("clear", "Water is crystal clear", "You can see the bottom drain", sl.exit.clear)}
        </div>
        <div id="slam-finish" style="margin-top:16px"></div>
      </div>
      <div style="margin-top:16px"><button class="btn btn--ghost btn--sm" id="slam-stop">Stop SLAM</button></div>`;
    // wire
    const upd = () => {
      const fc = parseFloat($("#slam-fc").value);
      if (isNaN(fc)) { $("#slam-dose").innerHTML = ""; return; }
      const g = C.chlorineGallons(sl.target - fc, p.volume, p.chlorinePct);
      $("#slam-dose").innerHTML = fc < sl.target ? out(`Add <b>${C.fmtGal(g)}</b> of ${p.chlorinePct}% chlorine${C.jugs(g) ? " (" + C.jugs(g) + ")" : ""} to get back to ${sl.target} ppm.`) : `<div class="callout callout--good" style="margin-top:6px">You're at SLAM level. ✓ Re-test in a few hours.</div>`;
    };
    $("#slam-fc") && $("#slam-fc").addEventListener("input", upd);
    $("#ocl-check") && $("#ocl-check").addEventListener("click", () => {
      const dusk = parseFloat($("#ocl-dusk").value), dawn = parseFloat($("#ocl-dawn").value);
      if (isNaN(dusk) || isNaN(dawn)) { toast("Enter both dusk and dawn FC.", "warn"); return; }
      const loss = dusk - dawn;
      if (loss < 0) { $("#ocl-out").innerHTML = `<div class="callout callout--warn">${S.icon("warn")}<div>Dawn FC (<b>${dawn}</b>) is higher than dusk (<b>${dusk}</b>) — chlorine can't rise overnight. Did you swap the two readings?</div></div>`; return; }
      sl.ocl = { dusk: dusk, dawn: dawn };
      sl.exit.ocl = loss < 1;
      save();
      const diag = loss < 1
        ? "<b>PASS ✓</b> — nothing is eating your chlorine overnight, so the algae is dead. (Now confirm CC ≤ 0.5 and clear water.)"
        : loss <= 5
          ? "Algae is still consuming chlorine — not done yet. Hold SLAM FC and run the test again tomorrow night."
          : "Unusually high — beyond algae, check for a <b>fouled filter</b> (backwash if pressure is &gt;25% over clean) and make sure you tested after the sun was off the water.";
      $("#ocl-out").innerHTML = `<div class="callout ${sl.exit.ocl ? "callout--good" : "callout--warn"}">${S.icon(sl.exit.ocl ? "check" : "warn")}<div>Overnight loss: <b>${(Math.round(loss * 10) / 10)} ppm</b> — ${diag}</div></div>`;
      RENDER.slam();
    });
    $$("#view-slam [data-exit]").forEach((b) => b.addEventListener("click", () => {
      const k = b.getAttribute("data-exit"); sl.exit[k] = !sl.exit[k]; save(); RENDER.slam();
    }));
    // CC exit gate is a measured input (not an honor-system toggle): auto-pass when CC ≤ 0.5.
    const ccEl = $("#slam-cc");
    if (ccEl) {
      ccEl.addEventListener("input", () => {
        const cc = parseFloat(ccEl.value);
        sl.cc = isNaN(cc) ? null : cc; sl.exit.cc = !isNaN(cc) && cc <= 0.5;
        const chip = $("#slam-cc-state"); if (chip) { chip.className = "chip " + (sl.exit.cc ? "chip--good" : "chip--muted"); chip.textContent = sl.exit.cc ? "✓ Met" : (!isNaN(cc) ? "Too high — keep going" : "Not yet"); }
      });
      ccEl.addEventListener("change", () => { save(); RENDER.slam(); });
    }
    $("#slam-stop") && $("#slam-stop").addEventListener("click", () => { if (confirm("Stop the SLAM? You can restart anytime.")) { state.slam.active = false; save(); updateAppbar(); RENDER.slam(); } });
    // finish
    const allPass = sl.exit.cc && sl.exit.ocl && sl.exit.clear;
    $("#slam-finish").innerHTML = allPass ? `<div class="callout callout--good">${S.icon("check")}<div><strong>All three pass — your SLAM is complete!</strong> Let FC drift down to your normal target (${t.targetLo}–${t.targetHi}). <button class="btn btn--primary btn--sm" id="slam-done" style="margin-top:8px">Finish SLAM</button></div></div>` : `<p class="muted">Tick each box as it passes. The overnight test sets itself when you run it above.</p>`;
    $("#slam-done") && $("#slam-done").addEventListener("click", () => {
      state.slam.active = false;
      if (window.ENGAGE) { ENGAGE.awardBadge(state, "slam-survivor"); }
      save(); updateAppbar();
      if (window.ENGAGE && ENGAGE.celebrate) ENGAGE.celebrate({ title: "SLAM complete! 🎉", msg: "You beat the algae and got your water clear. That's the hardest job in pool care — well done.", sub: "🏅 SLAM Survivor badge earned" });
      else toast("🎉 SLAM complete! Back to easy maintenance.", "good");
      go("dashboard");
    });
    upd();
  };
  function exitCheck(key, title, sub, on) {
    return `<button class="card is-clickable" data-exit="${key}" role="checkbox" aria-checked="${on ? "true" : "false"}" style="text-align:left;border:1.5px solid ${on ? "var(--good)" : "var(--line)"};background:${on ? "var(--good-bg)" : "#fff"}">
      <div class="flex"><span class="card__icon" style="background:${on ? "var(--good)" : "var(--foam)"};color:${on ? "#fff" : "var(--deep-2)"}">${S.icon("check")}</span>
      <div><div style="font-weight:750">${title}</div><div class="muted" style="font-size:.8rem">${sub}</div>
      <span class="chip ${on ? "chip--good" : "chip--muted"}" style="margin-top:6px;font-size:.7rem">${on ? "✓ Met" : "Not yet"}</span></div></div></button>`;
  }

  /* ===================================================================
     LEARN  (knowledge base)
     =================================================================== */
  const LEARN = [
    { id: "method", t: "The Trouble Free Pool method in 60 seconds", fig: () => S.balanceWheel(), body: () => `
      <p>Most pool trouble comes from one thing: <strong>letting chlorine drop too low for your stabilizer level</strong>. The TFP method fixes that with a simple loop:</p>
      <ol><li><strong>Test</strong> your own water with accurate drops (not strips).</li>
      <li><strong>Keep Free Chlorine</strong> in the right band for your CYA — always.</li>
      <li><strong>Adjust</strong> pH, then TA &amp; calcium, to keep the water balanced (CSI near zero).</li>
      <li><strong>Use liquid chlorine</strong> (or salt) so you're not secretly raising CYA.</li></ol>
      <p>Do that and algae literally can't get a foothold. No "weekly shock," no mystery additives, no upsells.</p>` },
    { id: "fccya", t: "The FC/CYA rule — the heart of it all", fig: () => S.fcCyaChart(), body: () => `
      <p><strong>CYA (cyanuric acid)</strong> is sunscreen for chlorine — it shields Free Chlorine from being destroyed by UV. But there's a catch: CYA also <em>holds onto</em> chlorine, so the more CYA you have, the more FC you need for the same killing power.</p>
      <div class="figure" style="margin:14px 0">${S.sunscreen()}</div>
      <p>That's why there's no single "right" chlorine number. Instead (per the TFP chart):</p>
      <ul><li><strong>Minimum FC ≈ 7.5% of CYA</strong> — never go below this (salt pools can run 5%).</li>
      <li><strong>Target FC ≈ 11.5% of CYA</strong> — your day-to-day aim.</li>
      <li><strong>SLAM FC = 40% of CYA</strong> — the algae-killing level you hold during a SLAM.</li></ul>
      <p>Example: at CYA 50, that's a minimum of ~4, target ~6–8, SLAM 20. The chart on the Dashboard does this math for you.</p>` },
    { id: "ph", t: "pH & why you shouldn't chase it", fig: () => S.hoclPh(), body: () => `
      <p>pH controls how much of your chlorine is in its strongest form. Lower pH = stronger chlorine — but in a stabilized pool, <strong>CYA matters far more than pH</strong> for killing power.</p>
      <p>So keep pH in the comfortable <strong>7.5–7.8</strong> band (good for swimmers and equipment) and stop there. pH naturally drifts <em>up</em> from aeration and liquid chlorine — that's normal. Just bring it down with a little muriatic acid when it passes ~7.8.</p>` },
    { id: "numbers", t: "Your 7 numbers, in plain English", fig: () => S.balanceWheel(), body: () => `
      ${D.PARAMS.map((p) => `<p><strong>${p.name} (${p.short})</strong> — ${p.tip.what} <em>${p.tip.why}</em></p>`).join("")}` },
    { id: "slam", t: "SLAM & the overnight test", fig: () => S.slamFlow(), body: () => `
      <p>When algae wins (green, cloudy, or chlorine won't hold), you <strong>SLAM</strong>: raise FC to ~40% of your CYA and <em>hold it there</em>, brushing and filtering, until three tests pass:</p>
      <div class="figure" style="margin:12px 0">${S.exitCriteria()}</div>
      <p>The <strong>overnight chlorine loss test</strong> is the clincher: test FC at dusk and dawn — if you lose less than 1 ppm overnight, nothing's eating chlorine, so the algae is truly dead.</p>` },
    { id: "cya", t: "Lowering CYA (the only way)", fig: () => S.drainRefill(), body: () => `
      <p>CYA never evaporates or breaks down — it only leaves with the water. So the <strong>only</strong> reliable way to lower it is to drain some water and refill with fresh.</p>
      <p>The math is simple: replace 20% of the water and CYA drops 20%. Each cycle keeps the rest:</p>
      <div class="figure" style="margin:12px 0">${S.cyaStaircase(100, 0.2, 40)}</div>
      <p>Drain the old water <em>first</em>, then refill — it's more efficient than topping off and overflowing. Use the <a href="#calculators">CYA dilution planner</a> to count your cycles.</p>` },
    { id: "csi", t: "CSI — scaling vs. corrosion", fig: () => S.csiScale(0), body: () => `
      <p>Hard water + high pH makes scale (cloudy water, white crust). Soft water + low pH eats plaster and metal. <strong>CSI</strong> rolls pH, temperature, calcium, alkalinity and CYA into one number so you know which way you're leaning.</p>
      <div class="figure" style="margin:12px 0">${S.csiScale(0)}</div>
      <p>Aim for <strong>−0.3 to +0.3</strong>. The easiest levers are pH and TA — you rarely need to touch calcium. Check yours in the <a href="#calculators">CSI calculator</a>.</p>` },
    { id: "trouble", t: "Troubleshooting — symptom → fix", fig: () => S.icon("warn"), body: () => `
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>You see…</th><th>Likely cause</th><th>The fix</th></tr></thead><tbody>
      ${D.TROUBLE.map((t) => `<tr><td><strong>${t.sym}</strong></td><td class="muted">${t.cause}</td><td>${t.fix}</td></tr>`).join("")}
      </tbody></table></div>` },
    { id: "products", t: "Chemicals & safety", fig: () => S.chem("liquid"), body: () => `
      <div class="grid cols-2" style="gap:12px;margin-bottom:14px">${D.PRODUCTS.map((p) => `<div class="card"><div class="flex"><span style="width:44px;flex:0 0 44px">${S.chem(p.kind)}</span><div><strong>${p.name}</strong><div class="muted" style="font-size:.82rem">${p.role} · adds ${p.adds}</div></div></div><div class="muted" style="font-size:.85rem;margin-top:8px">✓ ${p.good}<br>⚠ ${p.watch}</div></div>`).join("")}</div>
      <div class="callout callout--bad">${S.icon("warn")}<div><strong>Safety first</strong><ul style="margin:8px 0 0;padding-left:18px">${D.SAFETY.map((s) => `<li>${s}</li>`).join("")}</ul></div></div>` },
    { id: "filter", t: "Circulation & filters", fig: () => S.filterTypes(), body: () => `
      <p>Your pump &amp; filter do half the work — they distribute chemicals and physically remove dead algae. Run the pump enough to keep water clear (often 6–12 hrs/day; during a SLAM, 24/7).</p>
      <div class="figure" style="margin:12px 0">${S.filterTypes()}</div>
      <ul><li><strong>Sand</strong> — backwash when pressure rises ~25% over clean.</li>
      <li><strong>Cartridge</strong> — no backwash; hose off the element.</li>
      <li><strong>D.E.</strong> — backwash, then re-add ~80% of a full DE charge each time.</li></ul>
      <p>Golden rule: backwash on <em>pressure</em>, not a schedule.</p>` },
    { id: "testing", t: "Testing the right way", fig: () => S.icon("beaker"), body: () => `
      <p>Test strips and pool-store tests are too vague for the FC/CYA method. Use a <strong>FAS-DPD drop kit</strong> — it reads chlorine precisely, even at SLAM levels.</p>
      <p>Recommended: a <strong>Taylor K-2006C</strong>, or the TFP-favorite <strong>TF-100 / TF-Pro</strong> (same reagents, better value). Cheaper 6-in-1 reagent kits can do pH and rough chlorine, but their CYA and high-range chlorine tests are weak.</p>
      <p><strong>Got a cheaper (OTO) kit?</strong> The yellow chlorine test reads <strong>Total Chlorine</strong>, not Free Chlorine — that's FC + CC. Pop it in the <a href="#log">Total Chlorine</a> box when you log and Poolaris splits out your combined chlorine for you (or treats it as FC if that's all you have). Many basic kits also include <strong>acid-demand</strong> and <strong>base-demand</strong> tests — drop-count titrations that measure exactly how much acid or soda ash <em>your</em> water needs. Enter the drop count in the <a href="#calculators">Lower-pH</a> or <a href="#calculators">Raise-pH</a> calculator for a dose read straight from your pool — often more accurate than any formula.</p>
      <p><strong>The CYA test:</strong> mix a 50/50 sample, then fill the view tube slowly until the black dot just disappears — read at eye level, outdoors, back to the sun. For very high CYA, dilute the sample 50/50 with tap and double the result.</p>` },
    { id: "az", t: "Desert / hard-water playbook (Arizona)", fig: () => S.desertSun(), body: () => `
      <div class="figure" style="margin-bottom:12px">${S.desertSun()}</div>
      <p>Hot, sunny, hard-water regions like Arizona have their own rules:</p>
      <ul><li><strong>Run CYA a bit higher (50–70)</strong> so the brutal sun doesn't strip your chlorine by noon.</li>
      <li><strong>Dose liquid chlorine after sundown</strong>, roughly daily in peak summer.</li>
      <li><strong>Ditch trichlor tablets as your daily chlorine</strong> — they're the #1 cause of the high-CYA trap that forces a drain.</li>
      <li><strong>Calcium scale</strong> from hard tap can't be removed cheaply — manage it by keeping pH/TA on the low side (CSI near 0), filtering fill water, or using a mobile RO service.</li>
      <li>Constant evaporation concentrates everything — expect to dilute CYA &amp; manage hardness over time.</li></ul>
      <div class="figure" style="margin:12px 0">${S.trichlorTrap()}</div>
      <p class="muted">↑ How tablet pools creep into the high-CYA "trouble zone" over months.</p>` },
    { id: "tips", t: "Pro tips & common mistakes", fig: () => S.icon("info"), body: () => `
      <ul style="line-height:2">${D.TIPS.map((t) => `<li>${t}</li>`).join("")}</ul>` },
    { id: "glossary", t: "Glossary", fig: () => S.icon("learn"), body: () => `
      <div class="tbl-wrap"><table class="tbl"><tbody>${D.GLOSSARY.map((g) => `<tr><td style="font-weight:750;white-space:nowrap">${g[0]}</td><td class="muted">${g[1]}</td></tr>`).join("")}</tbody></table></div>` },
  ];
  RENDER.learn = function () {
    const v = $("#view-learn");
    const stripTags = (h) => String(h).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ");
    v.innerHTML = `
      <div class="page-head"><span class="eyebrow">${S.icon("learn")} Learn</span>
        <h1>Understand your pool</h1>
        <p class="lead">Short, friendly explainers with diagrams. You don't need all of it — but when you wonder "why?", the answer's here. ${state.profile ? "" : `<a href="#" id="learn-start">Set up your pool →</a>`}</p></div>
      <div class="learn-toolbar">
        <input class="input" type="search" id="learnSearch" placeholder="Search topics — CSI, overnight test, CYA…" aria-label="Search learn topics">
        <button class="btn btn--ghost btn--sm" id="learnExpand">Expand all</button>
      </div>
      <div id="learnList">
      ${LEARN.map((c) => `<div class="acc ${state.ui.learnOpen && state.ui.learnOpen[c.id] ? "is-open" : ""}" data-acc="${c.id}" data-search="${esc((c.t + " " + stripTags(c.body())).toLowerCase())}">
        <div class="acc__head" role="button" tabindex="0" aria-expanded="${state.ui.learnOpen && state.ui.learnOpen[c.id] ? "true" : "false"}"><span class="card__icon">${typeof c.fig === "function" && c.fig().indexOf("viewBox=\"0 0 24") > -1 ? c.fig() : S.icon("learn")}</span>${c.t}<span class="acc__chev">${S.icon("arrow")}</span></div>
        <div class="acc__body"><div style="padding-top:14px">${c.body()}</div></div>
      </div>`).join("")}
      </div>
      <p class="muted center" id="learnNoResults" hidden style="margin:12px 0">No topics match — try another word.</p>
      ${state.profile ? nextStep("plan", "Ready to put it into practice?", "Your plan turns all of this into exact, ordered steps for your pool.", "See my plan", "#plan") : nextStep("setup", "Want a plan for your pool?", "Set up your pool in about a minute and get exact, personalized steps.", "Set up my pool", "#dashboard")}
      <div class="card pad-lg" style="margin-top:8px;background:var(--foam-2)">
        <div class="card__title">${S.icon("export")} The full rulebook</div>
        <p class="muted">Everything here (and more — exact dosing math, derivations, and sources) lives in the full rulebook, so you have a permanent offline copy.</p>
        <a class="btn btn--ghost btn--sm" href="pool-knowledge-base.md" download rel="noopener" style="margin-top:8px">${S.icon("export")} Download the full rulebook</a>
      </div>`;
    const toggleAcc = (h) => {
      const acc = h.parentElement; const id = acc.getAttribute("data-acc");
      acc.classList.toggle("is-open");
      h.setAttribute("aria-expanded", acc.classList.contains("is-open"));
      state.ui.learnOpen = state.ui.learnOpen || {}; state.ui.learnOpen[id] = acc.classList.contains("is-open"); save();
    };
    $$("#view-learn .acc__head").forEach((h) => {
      h.addEventListener("click", () => toggleAcc(h));
      h.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggleAcc(h); } });
    });
    const list = $("#learnList"), search = $("#learnSearch"), noRes = $("#learnNoResults");
    if (search) search.addEventListener("input", () => {
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      $$(".acc", list).forEach((acc) => {
        const match = !q || (acc.getAttribute("data-search") || "").indexOf(q) >= 0;
        acc.hidden = !match; if (match) shown++;
        if (q && match) { acc.classList.add("is-open"); const hd = acc.querySelector(".acc__head"); if (hd) hd.setAttribute("aria-expanded", "true"); }
      });
      if (noRes) noRes.hidden = shown > 0;
    });
    const exp = $("#learnExpand");
    if (exp) exp.addEventListener("click", () => {
      let anyClosed = false;
      $$(".acc", list).forEach((a) => { if (!a.hidden && !a.classList.contains("is-open")) anyClosed = true; });
      state.ui.learnOpen = state.ui.learnOpen || {};
      $$(".acc", list).forEach((a) => { if (a.hidden) return; a.classList.toggle("is-open", anyClosed); const hd = a.querySelector(".acc__head"); if (hd) hd.setAttribute("aria-expanded", anyClosed ? "true" : "false"); state.ui.learnOpen[a.getAttribute("data-acc")] = anyClosed; });
      exp.textContent = anyClosed ? "Collapse all" : "Expand all";
      save();
    });
    $("#learn-start") && $("#learn-start").addEventListener("click", (e) => { e.preventDefault(); openOnboarding(); });
  };

  /* ===================================================================
     SETUP / MY POOL
     =================================================================== */
  RENDER.setup = function () {
    const v = $("#view-setup"); const p = profile();
    const acct = portal.mode === "account";
    v.innerHTML = `
      <div class="page-head"><span class="eyebrow">${S.icon("setup")} My Pool</span>
        <h1>${esc(p.name || "My Pool")}</h1>
        <p class="lead">Your saved profile. Every calculation uses these. Edit anytime.</p></div>
      <div class="grid cols-2" style="align-items:start;gap:22px">
        <div class="card pad-lg">
          <div class="figure">${S.poolDimDiagram(p.shape || "rectangle", p.dims || {})}</div>
          <div class="grid cols-2" style="margin-top:14px;gap:10px">
            <div class="kpi"><b>${C.fmtVolume(p.volume)}</b><span>volume</span></div>
            <div class="kpi"><b>${Math.round(C.surfaceArea(p.shape, p.dims || {}))} ft²</b><span>surface</span></div>
            <div class="kpi"><b>${p.avgDepth || "—"} ft</b><span>avg depth</span></div>
            <div class="kpi"><b>${(D.SHAPES.find((s) => s.key === p.shape) || {}).name || "—"}</b><span>shape</span></div>
          </div>
        </div>
        <div class="card pad-lg">
          <div class="card__title">${S.icon("setup")} Details</div>
          <div class="tbl-wrap"><table class="tbl"><tbody>
            <tr><td>Region</td><td>${esc(p.region || "—")}</td></tr>
            <tr><td>Climate</td><td>${esc(p.climate || "—")}</td></tr>
            <tr><td>Surface</td><td>${esc(p.surface || "—")}</td></tr>
            <tr><td>Chlorine source</td><td>${p.sanitizers && p.sanitizers.length ? p.sanitizers.map((s) => ({ liquid: "Liquid chlorine", salt: "Salt system", tabs: "Tablets" }[s] || s)).join(", ") : (p.sanitizer === "liquid" ? "Liquid chlorine" : p.sanitizer === "salt" ? "Salt system" : "Tablets")}</td></tr>
            <tr><td>Chlorine strength</td><td>${esc(p.chlorinePct)}%</td></tr>
            <tr><td>Acid strength</td><td>${esc(p.acidPct)}%</td></tr>
            <tr><td>Filter</td><td>${(p.filter || "—").toUpperCase()}</td></tr>
          </tbody></table></div>
          <button class="btn btn--primary btn--block" id="editProfile" style="margin-top:14px">${S.icon("setup")} Edit my pool</button>
        </div>
      </div>
      ${p.notes ? `<div class="callout callout--sun" style="margin-top:18px">${S.icon("info")}<div><strong>Notes:</strong> ${esc(p.notes)}</div></div>` : ""}
      <div class="card" style="margin-top:18px">
        <div class="card__title">${S.icon("flask")} Quick adjust — seasonal strengths</div>
        <p class="muted" style="font-size:.9rem">Chlorine &amp; acid strengths change with what's on the shelf. Update them here without re-running setup — every calculator and dose updates instantly.</p>
        <div class="grid cols-2" style="gap:14px">
          <div class="field"><label for="qa-cl">Chlorine strength</label><select class="input" id="qa-cl">${["6", "8.25", "10", "12.5"].map((x) => `<option value="${x}" ${String(p.chlorinePct) === x ? "selected" : ""}>${x}%</option>`).join("")}</select></div>
          <div class="field"><label for="qa-acid">Acid strength</label><select class="input" id="qa-acid">${ACID_STRENGTHS.map((x) => `<option value="${x}" ${String(p.acidPct) === x ? "selected" : ""}>${x}%</option>`).join("")}</select></div>
        </div>
        <button class="btn btn--primary btn--sm" id="qa-save" style="margin-top:6px">${S.icon("check")} Save strengths</button>
      </div>
      <div style="margin-top:18px">${nextStep("plan", "All set — what now?", "Head to your plan for exact next steps, or log a fresh test.", "See my plan", "#plan")}</div>
      <div class="callout" style="margin-top:14px;font-size:.88rem">${S.icon("info")}<div>Pool conditions shift with the seasons — CYA creeps up in summer, pH drifts. If your pool starts behaving differently, re-check these details with <b>Edit my pool</b>.</div></div>
      ${acct ? `
      <div class="card" style="margin-top:18px">
        <div class="card__title">${S.icon("export")} Your data &amp; backups</div>
        <p class="muted" style="font-size:.9rem">This pool is <b>synced to your account</b> and stored on the server, so it's safe across devices — just sign in. Download a full copy, change your password, or sign out from your Account page.</p>
        <a class="btn btn--ghost btn--sm" href="#account" style="margin-top:4px">${S.icon("user")} Go to Account</a>
      </div>` : `
      <div class="card" style="margin-top:18px">
        <div class="card__title">${S.icon("export")} Your data &amp; backups</div>
        <p class="muted" style="font-size:.9rem">Poolaris keeps everything in <b>this browser</b> — clearing your browser data, or switching devices/browsers, loses it. <b>Download a backup file</b> to keep your history safe and carry it anywhere; restore it on any device.</p>
        <div class="btnrow">
          <button class="btn btn--primary btn--sm" id="exportBackup">${S.icon("export")} Download backup</button>
          <button class="btn btn--ghost btn--sm" id="importBackupBtn">${S.icon("clock")} Restore from backup</button>
        </div>
        <input type="file" id="importBackupFile" aria-label="Choose a backup file to restore" accept="application/json,.json" style="display:none">
      </div>
      <div class="card" style="margin-top:14px;border-color:#ffd0c4">
        <div class="spread"><div><strong>Reset everything</strong><div class="muted" style="font-size:.85rem">Clears your profile and all logged tests from this browser. <b>Download a backup first!</b></div></div>
        <button class="btn btn--danger" id="resetAll">Reset</button></div>
      </div>`}`;
    $("#editProfile").addEventListener("click", () => openOnboarding(true));
    $("#resetAll") && $("#resetAll").addEventListener("click", resetAll);
    $("#qa-save") && $("#qa-save").addEventListener("click", () => {
      state.profile.chlorinePct = $("#qa-cl").value;
      state.profile.acidPct = $("#qa-acid").value;
      save(); updateAppbar();
      toast("Strengths updated — calculators and doses now use them.", "good");
      RENDER.setup();
    });
    $("#exportBackup") && $("#exportBackup").addEventListener("click", exportBackup);
    $("#importBackupBtn") && $("#importBackupBtn").addEventListener("click", () => $("#importBackupFile").click());
    $("#importBackupFile") && $("#importBackupFile").addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f && confirm("Restore this backup? It replaces your current profile and log.")) importBackup(f);
      e.target.value = "";
    });
  };

  function resetAll() {
    if (!confirm("Reset Poolaris? This erases your pool profile and all logged tests.")) return;
    localStorage.removeItem(KEY);
    state = { profile: null, log: [], slam: null, ui: { learnOpen: {} } };
    editingIndex = null;
    updateAppbar(); openOnboarding(); toast("Reset complete.", "info");
  }

  /* ---- file-based backup / restore (durable, portable persistence) ---- */
  function exportBackup() {
    try {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
      const a = document.createElement("a");
      a.href = URL.createObjectURL(blob);
      a.download = "poolaris-backup-" + new Date().toISOString().slice(0, 10) + ".json";
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
      toast("Backup downloaded — keep it somewhere safe.", "good");
    } catch (e) { toast("Couldn't create the backup.", "bad"); }
  }
  function importBackup(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!data || typeof data !== "object" || (!data.profile && !(data.log && data.log.length))) throw new Error("not a backup");
        state = Object.assign({ profile: null, log: [], slam: null, ui: { learnOpen: {} } }, data);
        if (!state.ui) state.ui = { learnOpen: {} };
        editingIndex = null;
        save(); updateAppbar(); applyTheme(currentTheme());
        toast("Backup restored. 🎉", "good");
        go("dashboard");
      } catch (e) { toast("That file isn't a valid Poolaris backup.", "bad"); }
    };
    reader.onerror = () => toast("Couldn't read that file.", "bad");
    reader.readAsText(file);
  }

  /* ===================================================================
     CHEMICAL DOSING  (engine in js/chem.js)
     =================================================================== */
  RENDER.chem = function () {
    state.doses = state.doses || [];
    const v = $("#view-chem");
    if (window.CHEM && CHEM.renderDosing) CHEM.renderDosing(v, chemCtx());
    else v.innerHTML = '<div class="card pad-lg"><p class="muted">Dosing module unavailable.</p></div>';
  };
  function chemCtx() {
    state.doses = state.doses || [];
    return {
      state: state,
      profile: profile(),
      measured: latest(),
      now: Date.now(),
      save: save,
      go: go,
      toast: toast,
      rerender: function () { updateAppbar(); if (!$("#view-chem").hidden && RENDER.chem) RENDER.chem(); },
      refreshDash: function () { if (!$("#view-dashboard").hidden && RENDER.dashboard) RENDER.dashboard(); },
      // account mode: mirror dose writes to the server (no-op in offline file-mode)
      onDoseSaved: portalDoseSaved,
      onDoseDeleted: portalDoseDeleted,
    };
  }
  // When signed in to an account, persist a dose to its pool and adopt the server id.
  // In offline/file-mode (no portal session) these are inert — save() already persisted it.
  function portalDoseSaved(rec, wasEditing, adopt) {
    if (!(window.portal && portal.session && portal.pool && window.API)) return;
    const pid = portal.pool.id;
    const payload = { t: rec.t, chem: rec.chem, amount: rec.amount, unit: rec.unit, pct: rec.pct, note: rec.note, mixMin: rec.mixMin, deltas: rec.deltas, baseline: rec.baseline };
    const numericId = /^\d+$/.test(String(rec.id));
    const p = (wasEditing && numericId) ? API.updateDose(pid, rec.id, payload) : API.addDose(pid, payload);
    p.then(function (res) { if (res && res.dose && adopt) adopt(res.dose.id); })
     .catch(function (e) { if (e && e.network) { API.enqueue("POST", "/api/pools/" + pid + "/doses", payload); } });
  }
  function portalDoseDeleted(id) {
    if (!(window.portal && portal.session && portal.pool && window.API)) return;
    if (!/^\d+$/.test(String(id))) return; // never persisted server-side (temp id)
    API.deleteDose(portal.pool.id, id).catch(function () { /* best-effort */ });
  }

  /* ===================================================================
     PORTAL — accounts, multi-pool sync, auth gate  (additive layer)
     Offline file-mode is the default and is untouched. Account mode kicks
     in only when a real session exists; then per-pool data syncs via REST.
     =================================================================== */
  const PORTAL_KEY = "poolaris.account.v1"; // remembers the last signed-in selected pool (device-local)

  function isHttp() { return location.protocol === "http:" || location.protocol === "https:"; }

  // ---- per-pool persistence (account mode) ----
  let _poolSaveTimer = null;
  function portalSavePool() {
    if (portal.mode !== "account" || !portal.pool) return;
    clearTimeout(_poolSaveTimer);
    _poolSaveTimer = setTimeout(portalSavePoolNow, 500); // coalesce rapid profile/slam edits
    // ui prefs (theme/learnOpen/trendKey) are device-local; mirror selectedPool to the account
  }
  function portalSavePoolNow() {
    if (portal.mode !== "account" || !portal.pool) return;
    const pid = portal.pool.id;
    API.savePool(pid, { profile: state.profile, slam: state.slam, version: portal.pool.version })
      .then((res) => { if (res && res.pool && res.pool.version != null) portal.pool.version = res.pool.version; setSyncChip("saved"); })
      .catch((e) => {
        if (e && e.status === 409) { setSyncChip("conflict"); toast("This pool changed on another device — reloading the latest.", "warn"); loadPool(pid); }
        else if (e && e.network) { setSyncChip("offline"); }
        else { setSyncChip("error"); }
      });
  }

  // ---- reading sync (account mode), by stable server id ----
  function portalAddReading(entry) {
    const pid = portal.pool && portal.pool.id; if (!pid) return;
    setSyncChip("saving");
    API.addReading(pid, { t: entry.t, reading: entry.reading, note: entry.note })
      .then((res) => { if (res && res.reading) { entry.id = res.reading.id; saveLocal(); } applyRollup(res && res.pool); setSyncChip("saved"); })
      .catch((e) => { if (e && e.network) { API.enqueue("POST", "/api/pools/" + pid + "/readings", { t: entry.t, reading: entry.reading, note: entry.note }); setSyncChip("offline"); } else setSyncChip("error"); });
  }
  function portalUpdateReading(entry) {
    const pid = portal.pool && portal.pool.id; if (!pid) return;
    if (entry.id == null) return portalAddReading(entry); // never synced → create it
    setSyncChip("saving");
    API.updateReading(pid, entry.id, { t: entry.t, reading: entry.reading, note: entry.note })
      .then((res) => { applyRollup(res && res.pool); setSyncChip("saved"); })
      .catch((e) => { setSyncChip(e && e.network ? "offline" : "error"); });
  }
  function portalDeleteReading(entry) {
    const pid = portal.pool && portal.pool.id; if (!pid || entry.id == null) return;
    API.deleteReading(pid, entry.id).then((res) => applyRollup(res && res.pool)).catch(() => {});
  }
  function applyRollup(pool) { if (pool && portal.pool) { if (pool.version != null) portal.pool.version = pool.version; } }

  // ---- load a pool into `state` (account mode) ----
  function loadPool(pid) {
    if (!pid) return Promise.resolve();
    setSyncChip("saving");
    return API.pool(pid).then((d) => {
      if (!d || !d.pool) return;
      portal.pool = d.pool;
      portal.selectedPoolId = pid;
      try { localStorage.setItem(PORTAL_KEY, JSON.stringify({ uid: portal.user && portal.user.id, pid: pid })); } catch (e) {}
      // map the server shape onto the in-memory `state` the whole app reads
      state = {
        profile: (d.pool.profile && Object.keys(d.pool.profile).length) ? d.pool.profile : null,
        log: (d.log || []).map((e) => ({ id: e.id, t: e.t, reading: e.reading, note: e.note, source: e.source })),
        doses: d.doses || [],
        slam: d.pool.slam || null,
        ui: localUi(),                    // ui prefs are device-local, not from the server
        savedAt: d.pool.savedAt || Date.now(),
      };
      window.__poolarisSlam = state.slam;
      // remember the selection on the account (best-effort)
      API.updateMe({ prefs: { selectedPoolId: pid } }).catch(() => {});
      applyTheme(currentTheme());
      updateAppbar();
      setNavForRole(); // company member now has a pool → reveal the per-pool tool nav
      if (window.PORTAL && PORTAL.renderPoolSwitcher) PORTAL.renderPoolSwitcher();
      rerenderCurrentRoute();
      setSyncChip("saved");
    }).catch((e) => { setSyncChip(e && e.network ? "offline" : "error"); });
  }
  function localUi() { // keep per-device ui prefs (theme etc.) across pool switches
    try { const u = JSON.parse(localStorage.getItem(KEY)); if (u && u.ui) return u.ui; } catch (e) {}
    return { learnOpen: {} };
  }
  function rerenderCurrentRoute() {
    const route = (location.hash || "#dashboard").slice(1);
    if (RENDER[route]) RENDER[route](); else if (RENDER.dashboard) RENDER.dashboard();
  }

  // ---- sync status chip in the appbar ----
  function setSyncChip(stateName) {
    const el = $("#syncChip"); if (!el) return;
    const map = {
      saving: { t: "Saving…", c: "muted" }, saved: { t: "Synced", c: "good" },
      offline: { t: "Offline", c: "warn" }, error: { t: "Save failed", c: "bad" },
      conflict: { t: "Reloading…", c: "warn" },
    };
    const m = map[stateName] || map.saved;
    el.className = "syncchip syncchip--" + m.c;
    el.innerHTML = `<span class="syncchip__dot"></span>${m.t}`;
    el.hidden = portal.mode !== "account";
  }

  // ---- the auth gate ----
  function renderAuthGate(opts) {
    opts = opts || {};
    let mode = opts.mode || "login"; // 'login' | 'signup'
    let role = "homeowner";
    const layer = $("#authLayer");
    layer.hidden = false;
    document.body.classList.add("auth-open");
    function draw() {
      layer.innerHTML = `
        <div class="auth-card" role="dialog" aria-modal="true" aria-label="Sign in to Poolaris">
          <div class="auth-brand">${S.brand()}<span>Poolaris</span></div>
          <div class="auth-seg" role="tablist">
            <button role="tab" data-am="login" class="${mode === "login" ? "is-on" : ""}">Sign in</button>
            <button role="tab" data-am="signup" class="${mode === "signup" ? "is-on" : ""}">Create account</button>
          </div>
          <p class="auth-lead">${mode === "signup"
            ? "Create your Poolaris account to sync this pool across devices and connect your pool service company — or keep using it offline on just this device."
            : "Welcome back — sign in to sync your pools across devices."}</p>
          ${mode === "signup" ? `
            <div class="auth-roles">
              <button type="button" class="auth-role ${role === "homeowner" ? "is-sel" : ""}" data-role="homeowner">${S.icon("droplet")}<b>I'm a homeowner</b><span>Care for my own pool(s)</span></button>
              <button type="button" class="auth-role ${role === "company_admin" ? "is-sel" : ""}" data-role="company_admin">${S.icon("setup")}<b>Pool service company</b><span>Manage pools I service</span></button>
            </div>` : ""}
          <form id="authForm" autocomplete="on">
            ${mode === "signup" ? `<div class="field"><label>Your name</label><input class="input" id="auth-name" autocomplete="name" placeholder="Jane Smith"></div>` : ""}
            ${mode === "signup" && role === "company_admin" ? `<div class="field"><label>Company name</label><input class="input" id="auth-company" placeholder="Blue Wave Pools"></div>` : ""}
            <div class="field"><label>Email</label><input class="input" id="auth-email" type="email" autocomplete="email" inputmode="email" placeholder="you@example.com"></div>
            <div class="field"><label>Password</label><input class="input" id="auth-pass" type="password" autocomplete="${mode === "signup" ? "new-password" : "current-password"}" placeholder="${mode === "signup" ? "At least 8 characters" : "Your password"}"></div>
            <label class="auth-remember"><input type="checkbox" id="auth-remember" checked> Keep me signed in</label>
            <div class="auth-err" id="authErr" hidden></div>
            <button class="btn btn--primary btn--block btn--lg" type="submit" id="authSubmit">${mode === "signup" ? "Create account" : "Sign in"} ${S.icon("arrow")}</button>
          </form>
          <button class="auth-offline" id="authOffline">${S.icon("leak")} Use Poolaris offline on just this device</button>
        </div>`;
      $$("[data-am]", layer).forEach((b) => b.addEventListener("click", () => { mode = b.getAttribute("data-am"); draw(); }));
      $$("[data-role]", layer).forEach((b) => b.addEventListener("click", () => { role = b.getAttribute("data-role"); draw(); }));
      $("#authOffline", layer).addEventListener("click", enterOfflineMode);
      $("#authForm", layer).addEventListener("submit", (e) => { e.preventDefault(); submitAuth(mode, role); });
      const ef = $("#auth-email", layer); if (ef) ef.focus();
    }
    draw();
  }
  function authError(msg) { const e = $("#authErr"); if (e) { e.hidden = false; e.textContent = msg; } const s = $("#authSubmit"); if (s) { s.disabled = false; } }
  function submitAuth(mode, role) {
    const email = ($("#auth-email") || {}).value || "";
    const pass = ($("#auth-pass") || {}).value || "";
    const remember = !!($("#auth-remember") && $("#auth-remember").checked);
    const submit = $("#authSubmit"); if (submit) submit.disabled = true;
    if (!email || !pass) { authError("Enter your email and password."); return; }
    let p;
    if (mode === "signup") {
      const name = ($("#auth-name") || {}).value || "";
      const companyName = ($("#auth-company") || {}).value || "";
      if (pass.length < 8) { authError("Password must be at least 8 characters."); return; }
      p = API.signup({ email, name, password: pass, role, companyName, remember });
    } else {
      p = API.login({ email, password: pass, remember });
    }
    p.then((d) => onAuthSuccess(d, mode)).catch((e) => authError((e && e.message) || "Something went wrong — try again."));
  }
  function onAuthSuccess(d, mode) {
    portal.session = true; portal.user = d.user; portal.companies = d.companies || [];
    portal.role = (portal.companies.length ? "company_admin" : "homeowner");
    closeAuthGate();
    // offer to migrate existing offline data into the new account
    const hasLocal = localHasData();
    if (mode === "signup" && hasLocal) { offerMigration(); return; }
    enterAccountMode(d.selectedPoolId);
  }
  function closeAuthGate() { const l = $("#authLayer"); if (l) { l.hidden = true; l.innerHTML = ""; } document.body.classList.remove("auth-open"); }

  function localHasData() {
    try { const u = JSON.parse(localStorage.getItem(KEY)); return !!(u && (u.profile || (u.log && u.log.length))); } catch (e) { return false; }
  }
  function offerMigration() {
    const layer = $("#authLayer"); layer.hidden = false; document.body.classList.add("auth-open");
    layer.innerHTML = `
      <div class="auth-card" role="dialog" aria-modal="true" aria-label="Import your pool">
        <div class="auth-brand">${S.brand()}<span>Welcome to Poolaris</span></div>
        <h2 style="margin:.2em 0 .1em">Bring your pool with you?</h2>
        <p class="auth-lead">You've been using Poolaris on this device. Import that pool — profile, full test history${(() => { try { const u = JSON.parse(localStorage.getItem(KEY)); return u && u.doses && u.doses.length ? " and chemical log" : ""; } catch (e) { return ""; } })()} — into your new account so it syncs everywhere?</p>
        <div class="btnrow" style="flex-direction:column;gap:10px">
          <button class="btn btn--primary btn--block btn--lg" id="mig-yes">${S.icon("export")} Import my pool</button>
          <button class="btn btn--ghost btn--block" id="mig-no">Start fresh instead</button>
        </div>
      </div>`;
    $("#mig-yes").addEventListener("click", doMigration);
    $("#mig-no").addEventListener("click", () => { closeAuthGate(); enterAccountMode(null); });
  }
  function doMigration() {
    let local; try { local = JSON.parse(localStorage.getItem(KEY)); } catch (e) { local = null; }
    if (!local) { closeAuthGate(); enterAccountMode(null); return; }
    const importKey = "device-" + (local.savedAt || Date.now());
    const btn = $("#mig-yes"); if (btn) { btn.disabled = true; btn.innerHTML = "Importing…"; }
    API.importState({ profile: local.profile, log: local.log, doses: local.doses, slam: local.slam }, importKey)
      .then((res) => {
        try { localStorage.setItem("poolaris.v1.bak", JSON.stringify(local)); localStorage.removeItem(KEY); } catch (e) {}
        toast("Your pool was imported. 🎉", "good");
        closeAuthGate();
        enterAccountMode(res && res.pool && res.pool.id);
      })
      .catch((e) => { toast("Import failed — staying on this account; your offline backup is safe.", "bad"); closeAuthGate(); enterAccountMode(null); });
  }

  // ---- enter account mode: load pools, pick one, render ----
  function enterAccountMode(preferredPoolId) {
    portal.mode = "account";
    startAlertPolling();
    setNavForRole();
    if (window.PORTAL && PORTAL.startInboxPolling) PORTAL.startInboxPolling();
    API.pools().then((d) => {
      portal.pools = (d && d.pools) || [];
      updateAppbar();
      setNavForRole();
      const isCompany = portal.companies && portal.companies.length;
      if (!portal.pools.length) {
        // Company account with no owned pool → land on the roster (phone-first techs → route),
        // NOT the homeowner setup wizard. Homeowner with no pool → run onboarding.
        state = { profile: null, log: [], doses: [], slam: null, ui: localUi() };
        if (isCompany) {
          const home = portal.companies[0].role === "tech" ? "route" : "roster";
          go(home, true);
        } else {
          openOnboarding(); go("dashboard", true);
        }
        return;
      }
      let pid = preferredPoolId;
      if (!pid) { try { const r = JSON.parse(localStorage.getItem(PORTAL_KEY)); if (r && r.uid === portal.user.id) pid = r.pid; } catch (e) {} }
      if (!pid || !portal.pools.some((p) => p.id === pid)) pid = portal.pools[0].id;
      loadPool(pid).then(() => {
        // company members default to the roster; homeowners to their pool dashboard
        const hash = (location.hash || "").slice(1);
        const start = hash || (isCompany ? "roster" : "dashboard");
        go(start, true);
      });
    }).catch(() => { setSyncChip("offline"); enterOfflineMode(); });
  }

  // ---- stay offline (file/local mode) — the original behavior ----
  function enterOfflineMode() {
    closeAuthGate();
    stopAlertPolling();
    portal.mode = "offline";
    setNavForRole();
    state = loadState() || { profile: null, log: [], slam: null, ui: { learnOpen: {} } };
    window.__poolarisSlam = state.slam;
    applyTheme(currentTheme());
    updateAppbar();
    if (!state.profile) { openOnboarding(); go("dashboard", true); }
    else { go((location.hash || "#dashboard").slice(1), true); }
    syncWithServer(); // legacy /api/state file shim (only active while server has no accounts)
  }

  function signOut() {
    API.logout().catch(() => {}).then(() => {
      portal.mode = "offline"; portal.session = null; portal.user = null; portal.pool = null; portal.pools = []; portal.companies = [];
      try { localStorage.removeItem(PORTAL_KEY); } catch (e) {}
      state = { profile: null, log: [], slam: null, ui: localUi() };
      renderAuthGate({ mode: "login" });
    });
  }
  window.__poolarisSignOut = signOut;

  /* ===================================================================
     NOTIFICATION BELL + ALERT CENTER (surfaces the 24/7 engine)
     =================================================================== */
  let _alertPoll = null;
  let _alertSummary = { urgent: 0, watch: 0, info: 0, total: 0 };

  function startAlertPolling() {
    if (portal.mode !== "account" || !window.API) return;
    const bell = $("#btnAlerts"); if (bell) { bell.hidden = false; if (!bell._wired) { bell._wired = true; bell.addEventListener("click", openAlertCenter); } }
    refreshAlertBadge();
    clearInterval(_alertPoll);
    _alertPoll = setInterval(() => { if (!document.hidden) refreshAlertBadge(); }, 60000); // 60s
  }
  function stopAlertPolling() { clearInterval(_alertPoll); const bell = $("#btnAlerts"); if (bell) bell.hidden = true; }
  function refreshAlertBadge() {
    if (portal.mode !== "account" || !window.API) return;
    API.alertsSummary().then((s) => {
      if (!s || !s.ok) return;
      _alertSummary = s;
      const badge = $("#alertBadge"); if (!badge) return;
      if (s.total > 0) {
        badge.hidden = false;
        badge.textContent = s.total > 9 ? "9+" : String(s.total);
        badge.className = "bell__badge" + (s.urgent > 0 ? " bell__badge--urgent" : s.watch > 0 ? " bell__badge--watch" : "");
        const bell = $("#btnAlerts"); if (bell) bell.setAttribute("aria-label", s.total + " alert" + (s.total === 1 ? "" : "s"));
      } else { badge.hidden = true; }
    }).catch(() => {});
  }
  function alertAgo(t) {
    const m = Math.max(0, (Date.now() - (t || Date.now())) / 60000);
    if (m < 1) return "just now"; if (m < 60) return Math.round(m) + "m ago";
    const h = m / 60; if (h < 24) return Math.round(h) + "h ago"; return Math.round(h / 24) + "d ago";
  }
  function openAlertCenter() {
    const layer = $("#modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet alert-center" role="dialog" aria-modal="true" aria-label="Alerts">
      <div class="sheet__head"><h2>${S.icon("clock")} Watching your pool 24/7</h2><button class="iconbtn" id="acClose" aria-label="Close">${S.icon("close")}</button></div>
      <div class="sheet__body" id="acBody"><p class="muted">Loading…</p></div></div>`;
    $("#acClose").addEventListener("click", closeAlertCenter);
    layer.addEventListener("click", (e) => { if (e.target === layer) closeAlertCenter(); });
    const onKey = (e) => { if (e.key === "Escape") closeAlertCenter(); };
    document.addEventListener("keydown", onKey); layer._acKey = onKey;
    const multi = portal.pools && portal.pools.length > 1;
    API.alerts(multi ? null : (portal.pool && portal.pool.id)).then((d) => {
      const body = $("#acBody"); if (!body) return;
      const alerts = (d && d.alerts) || [];
      if (!alerts.length) {
        body.innerHTML = `<div class="ac-empty">${S.icon("check")}<p><b>All clear.</b> Nothing needs your attention right now — Poolaris is watching around the clock and will flag anything that comes up.</p></div>`;
        return;
      }
      const poolName = (pid) => { const p = (portal.pools || []).find((x) => x.id === pid); return p ? p.name : ""; };
      body.innerHTML = alerts.map((a) => `
        <div class="ac-item ac-item--${a.severity}" data-aid="${a.id}">
          <span class="ac-item__ic">${S.icon(a.severity === "urgent" ? "warn" : a.severity === "watch" ? "info" : "clock")}</span>
          <div class="ac-item__body">
            <div class="ac-item__title">${esc(a.title)}${multi && poolName(a.poolId) ? ` <span class="ac-item__pool">${esc(poolName(a.poolId))}</span>` : ""}<span class="ac-item__time">${alertAgo(a.updatedAt)}</span></div>
            <div class="ac-item__detail">${a.detail}</div>
            <div class="ac-item__rec">${S.icon("arrow")} ${a.recommend}</div>
            <div class="ac-item__actions">
              ${a.route ? `<button class="btn btn--sm btn--primary" data-acgo="${a.route}" data-accalc="${a.calc || ""}" data-acpool="${a.poolId}">Fix it ${S.icon("arrow")}</button>` : ""}
              <button class="btn btn--sm btn--ghost" data-acsnooze="${a.id}">Snooze 1d</button>
              <button class="btn btn--sm btn--ghost" data-acdismiss="${a.id}">Dismiss</button>
            </div>
          </div>
        </div>`).join("");
      $$("[data-acsnooze]", body).forEach((b) => b.addEventListener("click", () => { API.snoozeAlert(+b.getAttribute("data-acsnooze"), 24).then(() => { openAlertCenter(); refreshAlertBadge(); }); }));
      $$("[data-acdismiss]", body).forEach((b) => b.addEventListener("click", () => { API.resolveAlert(+b.getAttribute("data-acdismiss")).then(() => { openAlertCenter(); refreshAlertBadge(); }); }));
      $$("[data-acgo]", body).forEach((b) => b.addEventListener("click", () => {
        const route = b.getAttribute("data-acgo"), calc = b.getAttribute("data-accalc"), apid = +b.getAttribute("data-acpool");
        closeAlertCenter();
        const nav = () => { if (calc) { state.ui.lastCalc = calc; save(); go("calculators"); } else go(route); };
        if (multi && apid && portal.pool && apid !== portal.pool.id) loadPool(apid).then(nav); else nav();
      }));
    }).catch(() => { const body = $("#acBody"); if (body) body.innerHTML = `<p class="muted">Couldn't load alerts right now.</p>`; });
  }
  function closeAlertCenter() { const l = $("#modalLayer"); if (l) { if (l._acKey) { document.removeEventListener("keydown", l._acKey); l._acKey = null; } l.hidden = true; l.className = "overlay"; l.innerHTML = ""; } }

  /* ===================================================================
     BOOT
     =================================================================== */
  function boot() {
    // theme first (avoids a flash)
    applyTheme(currentTheme());
    applyCalm(currentCalm());
    window.__poolarisSlam = state.slam;
    // brand + nav icons
    $("#brandMark").innerHTML = S.brand();
    $$(".nav__icon").forEach((n) => { n.innerHTML = S.icon(n.getAttribute("data-icon")); });
    // skip-link focuses the main region without triggering the hash router
    const skip = document.querySelector(".skip-link");
    if (skip) skip.addEventListener("click", (e) => { e.preventDefault(); const m = $("#main"); if (m) m.focus(); });
    // register the PWA service worker (http only — file:// can't use one). Offline shell.
    if ("serviceWorker" in navigator && location.protocol.indexOf("http") === 0) {
      navigator.serviceWorker.register("sw.js").catch(() => {});
    }
    // header buttons
    const bt = $("#btnTheme"); if (bt) bt.addEventListener("click", toggleTheme);
    $("#btnHelp") && $("#btnHelp").addEventListener("click", helpAction);
    $("#btnReset") && $("#btnReset").addEventListener("click", resetAll);
    $("#btnMore") && $("#btnMore").addEventListener("click", openMoreMenu);
    if (window.API) API.setUnauthorizedHandler(() => { if (portal.mode === "account") { portal.mode = "offline"; renderAuthGate({ mode: "login" }); } });

    // Decide offline vs account. Only http(s) + a reachable API can do accounts.
    if (isHttp() && window.API) {
      API.session().then((sess) => {
        if (sess && sess.user) {
          portal.session = true; portal.user = sess.user; portal.companies = sess.companies || [];
          portal.role = (portal.companies.length ? "company_admin" : "homeowner");
          enterAccountMode(sess.selectedPoolId);
        } else {
          // No session. Keep the friendly offline-first experience, but surface a
          // "Sign in / Create account" affordance so multi-device sync is one tap away.
          bootOfflineWithSignIn();
        }
      }).catch(() => bootOfflineWithSignIn());
    } else {
      bootOfflineFirst();
    }
  }
  function bootOfflineFirst() {
    updateAppbar();
    if (!state.profile) { openOnboarding(); go("dashboard", true); }
    else { go((location.hash || "#dashboard").slice(1), true); }
    syncWithServer();
  }
  function bootOfflineWithSignIn() {
    portal.mode = "offline";
    bootOfflineFirst();
    // surface a non-intrusive "Sign in / Create account" affordance in the appbar
    showSignInAffordance();
  }
  function showSignInAffordance() {
    const host = $("#appbarAccount"); if (!host) return;
    host.hidden = false;
    host.innerHTML = `<button class="btn btn--ghost btn--sm" id="goSignIn">${S.icon("setup")} Sign in</button>`;
    const b = $("#goSignIn"); if (b) b.addEventListener("click", () => renderAuthGate({ mode: localHasData() ? "signup" : "login" }));
  }

  /* ===================================================================
     Role-aware navigation: show/hide persona nav items + account menu.
     Called whenever portal mode/role changes (from app + portal.js).
     =================================================================== */
  // homeowner chemistry-tool routes — for a company member these are per-pool drill-in
  // tools (shown only once they've opened a specific pool), not primary nav.
  const POOL_TOOL_ROUTES = { log: 1, plan: 1, calculators: 1, slam: 1, chem: 1, setup: 1 };
  function setNavForRole() {
    const account = portal.mode === "account";
    const isCompany = account && portal.companies && portal.companies.length > 0;
    const hasPool = !!(portal.pool && portal.pool.id);
    portal.role = isCompany ? "company_admin" : "homeowner";
    $$(".nav__item[data-persona]").forEach((n) => {
      const persona = n.getAttribute("data-persona");
      let show = false;
      if (account) {
        if (persona === "any") show = true;
        else if (persona === "company") show = isCompany;
      }
      n.hidden = !show;
    });
    // company members only see chemistry tools once they've drilled into a pool;
    // homeowners always see them. Dashboard/Learn stay visible for everyone.
    $$(".nav__item").forEach((n) => {
      const route = n.getAttribute("data-route");
      if (POOL_TOOL_ROUTES[route]) {
        if (isCompany && !hasPool) n.hidden = true;
        else if (!n.hasAttribute("data-persona")) n.hidden = false;
      }
    });
    // account menu button in the appbar
    const host = $("#appbarAccount");
    if (host) {
      if (account && portal.user) {
        host.hidden = false;
        const initial = (portal.user.name || portal.user.email || "?").trim().charAt(0).toUpperCase();
        host.innerHTML = `<button class="acctbtn" id="acctBtn" aria-label="Account menu" title="Account"><span class="acctbtn__av">${esc(initial)}</span></button>`;
        const b = $("#acctBtn");
        if (b) b.addEventListener("click", () => { if (window.PORTAL && PORTAL.openAccountMenu) PORTAL.openAccountMenu(); else go("account"); });
      } else if (!account) {
        showSignInAffordance();
      }
    }
    // the "reset all my data" button only makes sense offline (it wipes localStorage);
    // in account mode it's meaningless and dangerous — hide it (account data lives on Account).
    const rb = $("#btnReset"); if (rb) rb.hidden = account;
    // company members manage many pools — a single-pool health pill is wrong; hide it.
    // (it shows again when they drill into a specific pool.)
    const statusWrap = $("#appbarStatus"); if (statusWrap) statusWrap.dataset.companyNoPool = (isCompany && !hasPool) ? "1" : "";
    // pool switcher in the appbar status slot region
    if (window.PORTAL && PORTAL.renderPoolSwitcher) PORTAL.renderPoolSwitcher();
  }

  /* ===== Bridge: lets js/portal.js (messaging, roster, route, account, switcher)
     reach the app internals without a big refactor. Single, explicit surface. ===== */
  window.PoolarisApp = {
    portal: portal,
    S: S, $: $, $$: $$, esc: esc, node: node, fmt: fmt,
    get state() { return state; },
    set state(v) { state = v; },
    profile: profile, latest: latest, save: save, saveLocal: saveLocal,
    go: go, toast: toast, RENDER: RENDER, ROUTES: ROUTES,
    updateAppbar: updateAppbar, applyTheme: applyTheme, currentTheme: currentTheme, toggleTheme: toggleTheme,
    confirmDialog: confirmDialog,
    loadPool: function (pid) { return loadPool(pid); },
    selectPool: function (pid) { return loadPool(pid); },
    setNavForRole: setNavForRole,
    refreshAlertBadge: function () { if (typeof refreshAlertBadge === "function") refreshAlertBadge(); },
    signOut: signOut,
    renderAuthGate: renderAuthGate,
    sectionHead: sectionHead,
    openOnboarding: openOnboarding,
    exportBackup: exportBackup,
    msgBadge: function (n) { const b = $("#msgNavBadge"); if (!b) return; if (n > 0) { b.hidden = false; b.textContent = n > 9 ? "9+" : String(n); } else b.hidden = true; },
  };

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot); else boot();
})();
