/* ============================================================================
   POOLARIS — chemical DOSING tracker  (window.CHEM)
   ---------------------------------------------------------------------------
   "What did I just add, and where will the water land once it mixes in?"

   The user logs a chemical addition (e.g. ¼ gallon of muriatic acid). This
   module projects its effect on the water using the SAME engine the rest of
   the app trusts (window.CALC / window.DATA — never modified here), models the
   time it takes to circulate/dissolve ("mixing in"), and shows the expected
   values once it's fully mixed. It also feeds gentle, time-aware notes back
   into the dashboard so the app won't tell you to re-dose something that's
   still mixing.

   Persistence: additions live on state.doses and ride the normal save() path
   (localStorage + the server's data file), so they're saved like everything else.
   Integration contract with app.js (all via a small ctx object):
     ctx = { state, profile, measured, now, save, go, toast, rerender, refreshDash }
   app.js calls: CHEM.renderDosing(viewEl, ctx)   — the "Dosing" page
                 CHEM.dashboardWidget(ctx)         — the "mixing in" card (HTML or "")
                 CHEM.observations(ctx)            — insight-shaped notes to merge
   ========================================================================== */
(function (global) {
  "use strict";
  const D = global.DATA, C = global.CALC, S = global.SVG, IN = global.INSIGHTS;

  /* ----------------------------- tiny utils ---------------------------- */
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.prototype.slice.call((r || document).querySelectorAll(s));
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function icon(n) { return S && S.icon ? S.icon(n) : ""; }
  function chemIcon(kind) { return S && S.chem ? S.chem(kind) : icon("droplet"); }
  const RKEYS = ["fc", "cc", "ph", "ta", "ch", "cya", "salt", "temp", "borate"];
  const DAY = 86400000;

  /* per-parameter display metadata */
  const DEC = { fc: 1, cc: 1, ph: 1, ta: 0, ch: 0, cya: 0, salt: 0, borate: 0, temp: 0 };
  const PSHORT = { fc: "FC", cc: "CC", ph: "pH", ta: "TA", ch: "CH", cya: "CYA", salt: "Salt", borate: "Borate", temp: "Temp" };
  const PUNIT = { fc: "ppm", cc: "ppm", ph: "", ta: "ppm", ch: "ppm", cya: "ppm", salt: "ppm", borate: "ppm", temp: "°F" };

  /* ----------------------------- unit maps ----------------------------- */
  // canonical: volume → fl oz, weight → oz, tablet → count
  const VOL = { gal: 128, qt: 32, pt: 16, cup: 8, floz: 1 };
  const WT = { lb: 16, oz: 1, bag: 640 };           // bag = 40-lb bag of salt
  const TAB = { tab: 1 };
  const UNIT_LABEL = { gal: "gal", qt: "qt", pt: "pt", cup: "cup", floz: "fl oz", lb: "lb", oz: "oz", bag: "40-lb bag", tab: "8-oz tab" };

  /* =====================================================================
     ENGINE-CONSISTENT EFFECT MATH
     Every number below comes from window.DATA.DOSE or an exported CALC
     function — so the dose tracker can never drift from the rest of the app.
     ===================================================================== */

  // Muriatic acid: invert CALC.acidForPH by binary-searching the target pH whose
  // required dose equals what was actually added. This re-uses the engine's own
  // pH/TA model verbatim (no constants copied here).
  function acidEffect(flOzActual, pct, vol, b) {
    if (!(flOzActual > 0)) return {};
    const ph0 = (b && b.ph != null && !isNaN(b.ph)) ? +b.ph : 7.8;
    const ta = (b && b.ta != null && !isNaN(b.ta)) ? +b.ta : 80;
    let lo = 5.5, hi = ph0;                 // f(lo)=lots of acid, f(hi)=0
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      const need = C.acidForPH(ph0, mid, ta, vol, pct);
      const f = need ? need.flOz : 0;
      if (f > flOzActual) lo = mid; else hi = mid;  // too much acid → raise target
    }
    const target = (lo + hi) / 2;
    const need = C.acidForPH(ph0, target, ta, vol, pct);
    if (!need) return {};
    return { ph: target - ph0, ta: -(need.taDrop || 0) };
  }

  const CHEMS = [
    {
      id: "chlorine", name: "Liquid chlorine", noun: "liquid chlorine", kind: "liquid",
      measure: "vol", units: ["gal", "qt", "cup", "floz"], defUnit: "gal",
      strength: { options: ["6", "8.25", "10", "12.5"], label: "% strength", def: (p) => String(p.chlorinePct || "10") },
      mixMin: 30, affects: ["fc"],
      tip: "Pour slowly over a return jet with the pump running. Dose after sunset so the sun doesn't waste it.",
      effect: (floz, pct, vol) => ({ fc: C.fcFromGallons(floz / 128, vol, pct) }),
    },
    {
      id: "acid", name: "Muriatic acid", noun: "muriatic acid", kind: "acid",
      measure: "vol", units: ["gal", "qt", "cup", "floz"], defUnit: "gal",
      strength: { options: ["31.45", "31", "28", "15", "14.5"], label: "% strength", def: (p) => String(p.acidPct || "31.45") },
      mixMin: 30, affects: ["ph", "ta"],
      warn: "Always add acid TO the water (never water to acid), pour low &amp; slow over a return jet, and never mix it with chlorine.",
      tip: "Add about ¾ of the dose first, circulate ~30 min, then retest before adding the rest.",
      effect: (floz, pct, vol, b) => acidEffect(floz, pct, vol, b),
    },
    {
      id: "calhypo", name: "Cal-hypo (granular)", noun: "cal-hypo", kind: "puck",
      measure: "wt", units: ["lb", "oz"], defUnit: "lb",
      strength: { options: ["73", "65", "53"], label: "% avail. Cl", def: () => "73" },
      mixMin: 60, affects: ["fc", "ch"],
      warn: "Never mix cal-hypo with any other chemical. Pre-dissolve in a bucket or broadcast over the deep end.",
      tip: "Adds calcium as well as chlorine — handy for low-CH plaster pools, watch it if your CH is already high.",
      effect: (oz, pct, vol) => { const lb = oz / 16; const fc = lb * D.DOSE.calhypoFCperLbPerPct * (+pct || 73) / (vol / 10000); return { fc: fc, ch: fc * D.DOSE.calhypoCHperFC }; },
    },
    {
      id: "trichlor", name: "Trichlor tablets", noun: "trichlor tabs", kind: "puck",
      measure: "tab", units: ["tab"], defUnit: "tab", slow: true,
      mixMin: 2880, affects: ["fc", "cya"],
      tip: "Tablets dissolve slowly over days and quietly raise CYA — great for a trip, not for daily use in the sun.",
      effect: (tabs, _p, vol) => ({ fc: tabs * D.DOSE.trichlorFCperTab8oz / (vol / 10000), cya: tabs * D.DOSE.trichlorCYAperTab8oz / (vol / 10000) }),
    },
    {
      id: "bakingSoda", name: "Baking soda", noun: "baking soda", kind: "base",
      measure: "wt", units: ["lb", "oz"], defUnit: "lb",
      mixMin: 360, affects: ["ta"],
      tip: "Raises alkalinity (your pH buffer). Dissolves quickly — retest TA after it circulates a few hours.",
      effect: (oz, _p, vol) => ({ ta: (oz / 16) / (D.DOSE.bakingSodaLbPer10ppmTAper10k * (vol / 10000)) * 10 }),
    },
    {
      id: "sodaAsh", name: "Soda ash (pH up)", noun: "soda ash", kind: "base",
      measure: "wt", units: ["lb", "oz"], defUnit: "lb", approx: true,
      mixMin: 360, affects: ["ph"],
      tip: "Raises pH (and a little TA). Pre-dissolve and add slowly — too much at once can cloud the water.",
      effect: (oz, _p, vol) => ({ ph: (oz / D.DOSE.sodaAshOzFor7to74per10k) * 0.4 / (vol / 10000) }),
    },
    {
      id: "borax", name: "Borax (pH up)", noun: "borax", kind: "base",
      measure: "wt", units: ["lb", "oz"], defUnit: "lb", approx: true,
      mixMin: 360, affects: ["ph"],
      tip: "Raises pH more gently than soda ash, with less effect on TA.",
      effect: (oz, _p, vol) => ({ ph: (oz / D.DOSE.boraxOzPer01PHper10k) * 0.1 / (vol / 10000) }),
    },
    {
      id: "calcium", name: "Calcium chloride", noun: "calcium chloride", kind: "cal",
      measure: "wt", units: ["lb", "oz"], defUnit: "lb",
      mixMin: 360, affects: ["ch"],
      warn: "Generates heat as it dissolves — add it TO a bucket of water (not the reverse) and pour slowly.",
      tip: "Raises calcium hardness — for low-CH plaster / pebble pools.",
      effect: (oz, _p, vol) => ({ ch: (oz / 16) / (D.DOSE.calciumChlorideLbPer10ppmCHper10k * (vol / 10000)) * 10 }),
    },
    {
      id: "cya", name: "Stabilizer (CYA)", noun: "stabilizer", kind: "cya",
      measure: "wt", units: ["lb", "oz"], defUnit: "lb", slow: true,
      mixMin: 10080, affects: ["cya"],
      tip: "Dissolves slowly over about a week — add via a sock in the skimmer and don't backwash for a few days. Your CYA test won't read right until it's fully dissolved.",
      effect: (oz, _p, vol) => ({ cya: oz / (D.DOSE.cyaOzPer10ppmPer10k * (vol / 10000)) * 10 }),
    },
    {
      id: "salt", name: "Pool salt", noun: "pool salt", kind: "salt",
      measure: "wt", units: ["bag", "lb"], defUnit: "bag", slow: true,
      mixMin: 1440, affects: ["salt"],
      tip: "For salt-water generators. Takes hours to dissolve — brush it off the floor and keep the pump running.",
      effect: (oz, _p, vol) => ({ salt: (oz / 16) / (D.DOSE.saltLbPerPpmPer10k * (vol / 10000)) }),
    },
  ];
  function chemById(id) { return CHEMS.find((c) => c.id === id) || null; }

  /* ----------------------------- conversions --------------------------- */
  function toCanon(chem, amount, unit) {
    const map = chem.measure === "vol" ? VOL : chem.measure === "wt" ? WT : TAB;
    return (+amount || 0) * (map[unit] || 0);
  }
  function computeDeltas(chem, amount, unit, pct, vol, baseline) {
    if (!chem) return {};
    const canon = toCanon(chem, amount, unit);
    if (!(canon > 0) || !(vol > 0)) return {};
    let raw = {};
    try { raw = chem.effect(canon, pct, vol, baseline || {}) || {}; } catch (e) { raw = {}; }
    const out = {};
    Object.keys(raw).forEach((k) => { const v = raw[k]; if (v != null && !isNaN(v) && Math.abs(v) >= 0.005) out[k] = +v; });
    return out;
  }

  /* ----------------------------- mix model ----------------------------- */
  function mixMs(d) { return Math.max(0, (d.mixMin || 30)) * 60000; }
  function mixProgress(d, now) { const m = mixMs(d); if (m <= 0) return 1; const p = (now - (d.t || now)) / m; return p < 0 ? 0 : p > 1 ? 1 : p; }
  function minutesLeft(d, now) { return Math.max(0, (d.mixMin || 30) - (now - (d.t || now)) / 60000); }
  function hasDeltas(d) { return d && d.deltas && Object.keys(d.deltas).length > 0; }

  // freshest MEASURED timestamp per parameter (from the test log + seed)
  function measuredAts(state, profile) {
    const at = {};
    RKEYS.forEach((k) => { at[k] = -Infinity; });
    const seed = profile && profile.seedReading;
    if (seed) RKEYS.forEach((k) => { if (seed[k] != null && !isNaN(seed[k])) at[k] = -Infinity; });
    (state.log || []).forEach((e) => {
      const r = e && e.reading; if (!r) return; const t = e.t != null ? e.t : 0;
      RKEYS.forEach((k) => { if (r[k] != null && !isNaN(r[k]) && t >= at[k]) at[k] = t; });
    });
    return at;
  }

  // Working reading = measured truth + pending dose effects (only where no test
  // has superseded the dose). mode "mixed" = full effect, "now" = effect×progress.
  function projected(ctx, mode) {
    const now = ctx.now || Date.now();
    const profile = ctx.profile || {};
    const measured = ctx.measured || IN.effectiveReading(ctx.state.log || [], profile.seedReading);
    const at = measuredAts(ctx.state, profile);
    const out = Object.assign({}, measured);
    const doses = (ctx.state.doses || []).filter(hasDeltas).slice().sort((a, b) => (a.t || 0) - (b.t || 0));
    doses.forEach((d) => {
      const prog = mode === "mixed" ? 1 : mixProgress(d, now);
      if (prog <= 0) return;
      Object.keys(d.deltas).forEach((k) => {
        if ((at[k] != null ? at[k] : -Infinity) > (d.t || 0)) return;  // a real test already supersedes it
        const base = out[k] != null && !isNaN(out[k]) ? +out[k] : 0;
        out[k] = base + d.deltas[k] * prog;
      });
    });
    return out;
  }

  // is this (settled) dose still unconfirmed by a later test?
  function unconfirmed(d, at) {
    return Object.keys(d.deltas || {}).some((k) => (at[k] != null ? at[k] : -Infinity) <= (d.t || 0));
  }

  /* ----------------------------- formatters ---------------------------- */
  function fmtVal(k, v) { if (v == null || isNaN(v)) return "—"; return (+v).toFixed(DEC[k] == null ? 1 : DEC[k]); }
  function fmtAmt(amount, unit) {
    const n = +amount || 0;
    if (unit === "gal" && C && C.nearestFraction) return C.nearestFraction(n);
    if (Math.abs(n - Math.round(n)) < 1e-9) return String(Math.round(n));
    return String(Math.round(n * 100) / 100);
  }
  function prettyAmount(d) { const c = chemById(d.chem); return fmtAmt(d.amount, d.unit) + " " + (UNIT_LABEL[d.unit] || d.unit) + (+d.amount === 1 || d.unit === "gal" ? "" : "") + " " + (c ? c.noun : d.chem); }
  function ago(t, now) {
    const s = Math.max(0, (now - (t || now)) / 1000);
    if (s < 45) return "just now";
    const m = s / 60; if (m < 60) return Math.round(m) + " min ago";
    const h = m / 60; if (h < 24) return (Math.round(h * 10) / 10) + " hr ago";
    return Math.round(h / 24) + " day" + (Math.round(h / 24) === 1 ? "" : "s") + " ago";
  }
  function fmtDur(min) {
    if (min < 1) return "under a minute";
    if (min < 90) return Math.round(min) + " min";
    const h = min / 60; if (h < 36) return (Math.round(h * 10) / 10) + " hr";
    return (Math.round(h / 24 * 10) / 10) + " days";
  }
  function deltaLine(d) {
    const base = d.baseline || {};
    return Object.keys(d.deltas || {}).map((k) => {
      const from = base[k] != null && !isNaN(base[k]) ? +base[k] : null;
      const to = (from != null ? from : 0) + d.deltas[k];
      const arrow = d.deltas[k] < 0 ? "▼" : "▲";
      return `<span class="dose-d"><b>${PSHORT[k] || k}</b> ${from != null ? fmtVal(k, from) + " → " : "≈ "}${fmtVal(k, to)} <span class="dose-d__a ${d.deltas[k] < 0 ? "is-dn" : "is-up"}">${arrow}${Math.abs(d.deltas[k]).toFixed(DEC[k] == null ? 1 : DEC[k])}</span></span>`;
    }).join("");
  }
  function projChips(reading, keys) {
    return keys.map((k) => `<span class="dose-chip"><span>${PSHORT[k] || k}</span><b>${fmtVal(k, reading[k])}${PUNIT[k] ? " " + PUNIT[k] : ""}</b></span>`).join("");
  }

  /* =====================================================================
     OBSERVATIONS  (merge into the dashboard's "What I'm noticing")
     ===================================================================== */
  function observations(ctx) {
    const now = ctx.now || Date.now();
    const out = [];
    const doses = (ctx.state.doses || []).filter(hasDeltas);
    if (!doses.length) return out;
    const at = measuredAts(ctx.state, ctx.profile || {});
    const active = doses.filter((d) => mixProgress(d, now) < 1).sort((a, b) => (a.t || 0) - (b.t || 0));

    if (active.length) {
      const soonest = active.slice().sort((a, b) => minutesLeft(a, now) - minutesLeft(b, now))[0];
      const mixedKeys = [];
      active.forEach((d) => Object.keys(d.deltas).forEach((k) => { if (mixedKeys.indexOf(k) < 0) mixedKeys.push(k); }));
      const proj = projected(ctx, "mixed");
      const title = active.length === 1 ? capitalize(prettyAmount(active[0])) + " is mixing in" : active.length + " chemicals are mixing in";
      out.push({
        id: "dose-mixing", category: "trend", severity: "info", icon: "clock",
        title: title,
        detail: `Still circulating — fully mixed in about <b>${fmtDur(minutesLeft(soonest, now))}</b>. Expected once settled: ${mixedKeys.map((k) => `${PSHORT[k]} ~${fmtVal(k, proj[k])}`).join(", ")}.`,
        recommend: "Let it circulate before you add anything else, then retest to confirm.",
        route: "chem",
      });
    }

    // settled but not yet confirmed by a test → nudge a retest (don't nag past ~2 days)
    const settled = doses.filter((d) => {
      if (mixProgress(d, now) < 1) return false;
      const settledAt = (d.t || 0) + mixMs(d);
      return (now - settledAt) <= 2 * DAY && unconfirmed(d, at);
    }).sort((a, b) => (b.t || 0) - (a.t || 0));
    if (settled.length && !active.length) {
      const d = settled[0];
      out.push({
        id: "dose-confirm", category: "data", severity: "info", icon: "beaker",
        title: "Confirm your " + (chemById(d.chem) ? chemById(d.chem).noun : "dose") + " worked",
        detail: `Your ${esc(prettyAmount(d))} from ${ago(d.t, now)} should be fully mixed now. I haven't seen a test since to confirm the change.`,
        recommend: "Run a quick test of the affected numbers and log it.",
        route: "log",
      });
    }
    return out;
  }
  function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

  /* =====================================================================
     DASHBOARD WIDGET  ("Chemicals mixing in")
     ===================================================================== */
  function dashboardWidget(ctx) {
    const now = ctx.now || Date.now();
    const doses = (ctx.state.doses || []).filter(hasDeltas);
    const active = doses.filter((d) => mixProgress(d, now) < 1).sort((a, b) => (b.t || 0) - (a.t || 0));
    if (!active.length) return "";
    const proj = projected(ctx, "mixed");
    const keys = [];
    active.forEach((d) => Object.keys(d.deltas).forEach((k) => { if (keys.indexOf(k) < 0) keys.push(k); }));
    const rows = active.slice(0, 3).map((d) => {
      const pr = Math.round(mixProgress(d, now) * 100);
      return `<div class="mix-row">
        <span class="mix-row__ic">${chemIcon((chemById(d.chem) || {}).kind || "liquid")}</span>
        <div class="mix-row__main">
          <div class="mix-row__top"><b>${esc(capitalize(prettyAmount(d)))}</b><span class="muted">${esc(ago(d.t, now))} · ~${esc(fmtDur(minutesLeft(d, now)))} left</span></div>
          <div class="mix-bar" title="${pr}% mixed"><div class="mix-bar__fill" style="width:${pr}%"></div></div>
          <div class="mix-row__d">${deltaLine(d)}</div>
        </div></div>`;
    }).join("");
    return `<div class="card pad-lg mix-card" style="margin-bottom:22px">
      <div class="card__title">${icon("clock")} Chemicals mixing in
        <span class="live-badge" style="margin-left:auto">${icon("droplet")} circulating</span></div>
      <p class="muted" style="margin:-2px 0 12px;font-size:.86rem">These haven't fully mixed yet — here's where your water is headed. Hold off on re-dosing until you retest.</p>
      ${rows}
      ${active.length > 3 ? `<div class="muted" style="font-size:.82rem;margin-top:6px">+ ${active.length - 3} more mixing</div>` : ""}
      <div class="mix-foot">
        <div><span class="muted" style="font-size:.8rem">Expected once everything's mixed</span><div class="dose-chips">${projChips(proj, keys)}</div></div>
        <div class="btnrow"><a class="btn btn--ghost btn--sm" href="#chem">${icon("flask")} Dosing</a><a class="btn btn--primary btn--sm" href="#log">${icon("beaker")} Log a test</a></div>
      </div>
    </div>`;
  }

  /* =====================================================================
     DOSING PAGE  (RENDER.chem → CHEM.renderDosing)
     ===================================================================== */
  let form = null;        // { chem, unit, pct, amount, when, note }
  let editingId = null;

  function toLocalInput(ms) {
    const d = new Date(ms), p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function defaultForm(profile) {
    const c = CHEMS[0];
    return { chem: c.id, unit: c.defUnit, pct: c.strength ? c.strength.def(profile) : null, amount: "", when: Date.now(), note: "" };
  }

  function renderDosing(view, ctx) {
    injectCSS();
    const profile = ctx.profile || {};
    const vol = profile.volume || 14000;
    if (!form) form = defaultForm(profile);
    // deep-link prefill: a calculator's "track this addition" preselects the chemical + strength here
    const pre = ctx.state.ui && ctx.state.ui.dosePrefill;
    if (pre && pre.chem && chemById(pre.chem)) {
      const pc = chemById(pre.chem);
      form = { chem: pc.id, unit: pre.unit || pc.defUnit, pct: pre.pct != null ? pre.pct : (pc.strength ? pc.strength.def(profile) : null), amount: pre.amount != null ? pre.amount : "", when: Date.now(), note: "" };
      editingId = null;
      ctx.state.ui.dosePrefill = null;
    }
    const now = ctx.now || Date.now();
    const doses = (ctx.state.doses || []).slice().sort((a, b) => (b.t || 0) - (a.t || 0));
    const at = measuredAts(ctx.state, profile);

    const picker = CHEMS.map((c) => `<button type="button" class="chem-pick__b ${form.chem === c.id ? "is-sel" : ""}" data-chem="${c.id}">
      <span class="chem-pick__ic">${chemIcon(c.kind)}</span>
      <span class="chem-pick__t">${c.name}<br><span class="muted">${c.affects.map((k) => PSHORT[k]).join(" · ")}</span></span></button>`).join("");

    const chem = chemById(form.chem) || CHEMS[0];
    const unitOpts = chem.units.map((u) => `<option value="${u}" ${form.unit === u ? "selected" : ""}>${UNIT_LABEL[u]}</option>`).join("");
    const strengthField = chem.strength ? `<div class="field"><label>${chem.strength.label}</label>
      <select class="input" id="dose-pct" aria-label="${esc(chem.strength.label)}">${chem.strength.options.map((o) => `<option value="${o}" ${String(form.pct) === String(o) ? "selected" : ""}>${o}${chem.strength.label.indexOf("%") === 0 || chem.strength.label.indexOf("%") > -1 ? "%" : ""}</option>`).join("")}</select></div>` : "";

    view.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">${icon("flask")} Dosing</span>
        <h1>Track what you add</h1>
        <p class="lead">Tell me what you poured in and I'll show exactly where your water is headed once it mixes in — calculated for your ${C.fmtVolume(vol)} pool with the products you own. Everything is saved.</p>
      </div>

      <div class="grid cols-2" style="align-items:start;gap:22px">
        <div class="card pad-lg">
          <div class="card__title">${icon("plus")} ${editingId ? "Edit this addition" : "Add a chemical"}</div>
          <label class="dose-lbl">What did you add?</label>
          <div class="chem-pick">${picker}</div>

          <div class="grid cols-2" style="gap:12px;margin-top:14px">
            <div class="field"><label>Amount</label>
              <div class="input-group"><input class="input" type="number" step="any" inputmode="decimal" id="dose-amt" aria-label="Amount added" value="${form.amount !== "" && form.amount != null ? esc(form.amount) : ""}" placeholder="e.g. ${chem.measure === "tab" ? "2" : chem.measure === "wt" ? "1" : "0.25"}"><span class="input-suffix"><select class="bare-select" id="dose-unit" aria-label="Unit">${unitOpts}</select></span></div>
              <div class="range-hint" id="dose-canon"></div>
            </div>
            ${strengthField || `<div class="field"><label>When</label><input class="input" type="datetime-local" id="dose-when" aria-label="When added" value="${toLocalInput(form.when || now)}"></div>`}
          </div>
          ${strengthField ? `<div class="field"><label>When did you add it? ${infoTip("Defaults to now. Back-date it if you poured it in earlier — the mixing clock and projections use this time.")}</label><input class="input" type="datetime-local" id="dose-when" aria-label="When added" value="${toLocalInput(form.when || now)}"></div>` : ""}
          <div class="field"><label>Note (optional)</label><input class="input" id="dose-note" aria-label="Note" value="${esc(form.note || "")}" placeholder="e.g. near the deep-end return"></div>

          <div id="dose-proj" class="dose-proj"></div>

          <button class="btn btn--primary btn--block btn--lg" id="dose-save" style="margin-top:6px">${icon("check")} ${editingId ? "Update addition" : "Save addition"}</button>
          ${editingId ? `<button class="btn btn--ghost btn--block" id="dose-cancel" style="margin-top:8px">Cancel edit</button>` : ""}
        </div>

        <div>
          <div class="card" id="dose-mixing-card">${mixingPanel(ctx)}</div>
        </div>
      </div>

      ${doses.length ? `<h2 style="margin-top:28px;display:flex;align-items:center;gap:8px">${icon("clock")} Recent additions</h2>
      <div class="tbl-wrap"><table class="tbl"><thead><tr><th>When</th><th>What</th><th>Effect</th><th>Status</th><th></th></tr></thead><tbody>
      ${doses.map((d) => doseRow(d, now, at)).join("")}
      </tbody></table></div>` : `<div class="card center" style="margin-top:24px;padding:30px"><p class="muted">No additions logged yet. Add your first one above — even a past one — and I'll track how it changes your water.</p></div>`}

      <div class="callout callout--sun" style="margin-top:18px">${icon("info")}<div>These are <b>estimates</b> based on your pool volume and the dose — real water has surprises. Always retest after a dose has mixed in, and trust your test kit over the projection.</div></div>
    `;
    bindForm(view, ctx);
    updateProjection(view, ctx);
  }
  function infoTip(html) { return `<span class="info" data-tip="${esc(html)}" tabindex="0" role="button" aria-label="More info">i</span>`; }

  function mixingPanel(ctx) {
    const now = ctx.now || Date.now();
    const active = (ctx.state.doses || []).filter(hasDeltas).filter((d) => mixProgress(d, now) < 1).sort((a, b) => (b.t || 0) - (a.t || 0));
    if (!active.length) {
      const measured = ctx.measured || {};
      const keys = ["fc", "ph", "ta", "cya"].filter((k) => measured[k] != null);
      return `<div class="card__title">${icon("target")} Where you stand</div>
        <p class="muted" style="font-size:.88rem">Nothing is mixing in right now. Your latest measured numbers:</p>
        <div class="dose-chips">${keys.length ? projChips(measured, keys) : '<span class="muted">Log a test to see your numbers.</span>'}</div>
        <p class="muted" style="font-size:.84rem;margin-top:12px">When you add a chemical above, this panel shows the live "mixing in" countdown and the expected result.</p>`;
    }
    const proj = projected(ctx, "mixed");
    const keys = [];
    active.forEach((d) => Object.keys(d.deltas).forEach((k) => { if (keys.indexOf(k) < 0) keys.push(k); }));
    return `<div class="card__title">${icon("clock")} Mixing in now</div>
      ${active.map((d) => { const pr = Math.round(mixProgress(d, now) * 100); return `<div class="mix-row">
        <span class="mix-row__ic">${chemIcon((chemById(d.chem) || {}).kind || "liquid")}</span>
        <div class="mix-row__main">
          <div class="mix-row__top"><b>${esc(capitalize(prettyAmount(d)))}</b><span class="muted">~${esc(fmtDur(minutesLeft(d, now)))} left</span></div>
          <div class="mix-bar"><div class="mix-bar__fill" style="width:${pr}%"></div></div>
          <div class="mix-row__d">${deltaLine(d)}</div>
        </div></div>`; }).join("")}
      <div class="mix-foot"><div><span class="muted" style="font-size:.8rem">Expected once mixed</span><div class="dose-chips">${projChips(proj, keys)}</div></div></div>`;
  }

  function doseRow(d, now, at) {
    const c = chemById(d.chem) || { noun: d.chem, kind: "liquid" };
    const prog = mixProgress(d, now);
    let status;
    if (prog < 1) status = `<span class="chip chip--warn">mixing ${Math.round(prog * 100)}%</span>`;
    else if (unconfirmed(d, at)) status = `<span class="chip chip--muted">mixed · confirm</span>`;
    else status = `<span class="chip chip--good">confirmed ✓</span>`;
    const dt = new Date(d.t || now);
    return `<tr>
      <td>${dt.toLocaleDateString()} <span class="muted" style="font-size:.78rem">${dt.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}</span></td>
      <td><span style="display:inline-flex;align-items:center;gap:6px"><span style="width:18px;display:inline-block">${chemIcon(c.kind)}</span>${esc(capitalize(prettyAmount(d)))}</span>${d.note ? `<div class="muted" style="font-size:.78rem">${esc(d.note)}</div>` : ""}</td>
      <td style="font-size:.82rem">${deltaLine(d) || "—"}</td>
      <td>${status}</td>
      <td><div style="display:flex;gap:2px">
        <button class="iconbtn" data-dedit="${d.id}" title="Edit" style="width:30px;height:30px"><svg viewBox="0 0 24 24" width="15" height="15"><path d="M4 20h4L18 10l-4-4L4 16v4ZM14 6l4 4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
        <button class="iconbtn" data-ddel="${d.id}" title="Delete" style="width:30px;height:30px"><svg viewBox="0 0 24 24" width="16" height="16"><path d="M6 7h12M9 7V5h6v2M8 7l1 13h6l1-13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></button>
      </div></td></tr>`;
  }

  /* ----------------------------- form wiring --------------------------- */
  function readForm(view) {
    const amtEl = $("#dose-amt", view), unitEl = $("#dose-unit", view), pctEl = $("#dose-pct", view), whenEl = $("#dose-when", view), noteEl = $("#dose-note", view);
    if (amtEl) form.amount = amtEl.value;
    if (unitEl) form.unit = unitEl.value;
    if (pctEl) form.pct = pctEl.value;
    if (noteEl) form.note = noteEl.value;
    if (whenEl && whenEl.value && !isNaN(new Date(whenEl.value).getTime())) form.when = new Date(whenEl.value).getTime();
  }
  function bindForm(view, ctx) {
    $$(".chem-pick__b", view).forEach((b) => b.addEventListener("click", () => {
      readForm(view);
      const c = chemById(b.getAttribute("data-chem")); if (!c) return;
      form.chem = c.id;
      if (c.units.indexOf(form.unit) < 0) form.unit = c.defUnit;
      form.pct = c.strength ? c.strength.def(ctx.profile || {}) : null;
      renderDosing(view, ctx);                 // re-render to swap unit/strength controls
    }));
    const live = () => { readForm(view); updateProjection(view, ctx); };
    ["dose-amt", "dose-unit", "dose-pct", "dose-when"].forEach((id) => { const el = $("#" + id, view); if (el) el.addEventListener("input", live); });
    const save = $("#dose-save", view); if (save) save.addEventListener("click", () => saveDose(view, ctx));
    const cancel = $("#dose-cancel", view); if (cancel) cancel.addEventListener("click", () => { editingId = null; form = defaultForm(ctx.profile || {}); renderDosing(view, ctx); });
    $$("[data-dedit]", view).forEach((b) => b.addEventListener("click", () => startEdit(b.getAttribute("data-dedit"), view, ctx)));
    $$("[data-ddel]", view).forEach((b) => b.addEventListener("click", () => deleteDose(b.getAttribute("data-ddel"), view, ctx)));
  }

  function updateProjection(view, ctx) {
    const box = $("#dose-proj", view); if (!box) return;
    const profile = ctx.profile || {}, vol = profile.volume || 14000;
    const chem = chemById(form.chem) || CHEMS[0];
    const canon = toCanon(chem, form.amount, form.unit);
    // canonical readout (e.g. "= 32 fl oz")
    const canonEl = $("#dose-canon", view);
    if (canonEl) {
      if (canon > 0 && chem.measure === "vol" && form.unit !== "floz") canonEl.innerHTML = `${icon("info")} <span>= ${Math.round(canon)} fl oz</span>`;
      else if (canon > 0 && chem.measure === "wt" && form.unit !== "oz") canonEl.innerHTML = `${icon("info")} <span>= ${Math.round(canon)} oz</span>`;
      else canonEl.innerHTML = "";
    }
    if (!(canon > 0)) {
      box.innerHTML = `<div class="callout" style="margin-top:6px;font-size:.86rem">${icon("info")}<div>Pick a chemical and enter how much you added — I'll show the expected result and how long it takes to mix in.</div></div>`;
      return;
    }
    const baseline = ctx.measured || IN.effectiveReading(ctx.state.log || [], profile.seedReading);
    const deltas = computeDeltas(chem, form.amount, form.unit, form.pct, vol, baseline);
    if (!Object.keys(deltas).length) {
      box.innerHTML = `<div class="callout callout--warn" style="margin-top:6px;font-size:.86rem">${icon("warn")}<div>That amount is too small to move your water measurably${chem.id === "acid" && (baseline.ph == null) ? " — log a pH test first so I can project the drop accurately" : ""}.</div></div>`;
      return;
    }
    const tmp = { chem: chem.id, amount: form.amount, unit: form.unit, deltas: deltas, baseline: baseline };
    // any affected parameter with no real starting reading → the "from" is a guess
    const noRealTest = !(ctx.state.log && ctx.state.log.length);
    const guessedKeys = Object.keys(deltas).filter((k) => baseline[k] == null || noRealTest);
    const rows = Object.keys(deltas).map((k) => {
      const from = baseline[k] != null && !isNaN(baseline[k]) ? +baseline[k] : null;
      const to = (from != null ? from : 0) + deltas[k];
      return `<tr><td><b>${PSHORT[k]}</b></td><td class="num">${from != null ? fmtVal(k, from) : "—"}</td><td class="dose-arrow">→</td><td class="num"><b>${fmtVal(k, to)}</b></td><td class="dose-d__a ${deltas[k] < 0 ? "is-dn" : "is-up"}">${deltas[k] < 0 ? "▼" : "▲"}${Math.abs(deltas[k]).toFixed(DEC[k] == null ? 1 : DEC[k])}${PUNIT[k] ? " " + PUNIT[k] : ""}</td></tr>`;
    }).join("");
    box.innerHTML = `<div class="dose-proj__card">
      <div class="dose-proj__h">${icon("target")} Expected once mixed <span class="live-badge">~${fmtDur(chem.mixMin)} to mix</span></div>
      <table class="dose-proj__t"><tbody>${rows}</tbody></table>
      ${noRealTest ? `<div class="callout callout--warn" style="margin-top:8px;font-size:.8rem">${icon("warn")}<div>Starting values are setup estimates — <b>log a test</b> first for an accurate "after" number.</div></div>` : ""}
      ${chem.approx ? `<div class="muted" style="font-size:.78rem;margin-top:6px">pH moves depend on your starting water — treat this as a guide and retest.</div>` : ""}
      ${chem.slow ? `<div class="muted" style="font-size:.78rem;margin-top:6px">${icon("clock")} Dissolves slowly — don't retest ${PSHORT[chem.affects[chem.affects.length - 1]]} until it's fully in.</div>` : ""}
      ${chem.warn ? `<div class="callout callout--bad" style="margin-top:8px;font-size:.82rem">${icon("warn")}<div>${chem.warn}</div></div>` : chem.tip ? `<div class="callout callout--sun" style="margin-top:8px;font-size:.82rem">${icon("info")}<div>${chem.tip}</div></div>` : ""}
    </div>`;
  }

  function saveDose(view, ctx) {
    readForm(view);
    const profile = ctx.profile || {}, vol = profile.volume || 14000;
    const chem = chemById(form.chem); if (!chem) return;
    if (!(toCanon(chem, form.amount, form.unit) > 0)) { ctx.toast("Enter how much you added.", "warn"); return; }
    ctx.state.doses = ctx.state.doses || [];
    let baseline;
    if (editingId) {
      const ex = ctx.state.doses.find((d) => String(d.id) === String(editingId));
      baseline = (ex && ex.baseline) || ctx.measured || IN.effectiveReading(ctx.state.log || [], profile.seedReading);
    } else {
      baseline = IN.effectiveReading(ctx.state.log || [], profile.seedReading);
    }
    const deltas = computeDeltas(chem, form.amount, form.unit, form.pct, vol, baseline);
    if (!Object.keys(deltas).length) { ctx.toast("That dose is too small to track.", "warn"); return; }
    const rec = {
      id: editingId || (Date.now() + "-" + Math.random().toString(36).slice(2, 7)),
      t: form.when || Date.now(),
      chem: chem.id, amount: +form.amount, unit: form.unit, pct: form.pct || null,
      note: form.note || "", mixMin: chem.mixMin, deltas: deltas, baseline: baseline,
    };
    const wasEditing = !!editingId;
    if (editingId) {
      const i = ctx.state.doses.findIndex((d) => String(d.id) === String(editingId));
      if (i >= 0) ctx.state.doses[i] = rec; else ctx.state.doses.push(rec);
      editingId = null;
    } else {
      ctx.state.doses.push(rec);
    }
    ctx.state.doses.sort((a, b) => (a.t || 0) - (b.t || 0));
    ctx.save();
    // account mode: persist this dose server-side and adopt its real DB id
    if (ctx.onDoseSaved) {
      try {
        ctx.onDoseSaved(rec, wasEditing, function (realId) {
          if (realId != null && realId !== rec.id) { rec.id = realId; if (ctx.save) ctx.save(); }
        });
      } catch (e) { /* offline / non-fatal — local copy already saved */ }
    }
    ctx.toast(wasEditing ? "Addition updated." : capitalize(prettyAmount(rec)) + " logged — watch it mix in.", "good");
    form = defaultForm(profile);
    renderDosing(view, ctx);
    if (ctx.refreshDash) ctx.refreshDash();
  }
  function startEdit(id, view, ctx) {
    const d = (ctx.state.doses || []).find((x) => String(x.id) === String(id)); if (!d) return;
    editingId = d.id;
    form = { chem: d.chem, unit: d.unit, pct: d.pct, amount: d.amount, when: d.t, note: d.note || "" };
    renderDosing(view, ctx);
    view.scrollIntoView ? view.scrollIntoView({ behavior: "smooth", block: "start" }) : window.scrollTo(0, 0);
  }
  function deleteDose(id, view, ctx) {
    const proceed = () => {
      ctx.state.doses = (ctx.state.doses || []).filter((d) => String(d.id) !== String(id));
      if (String(editingId) === String(id)) { editingId = null; form = defaultForm(ctx.profile || {}); }
      ctx.save();
      if (ctx.onDoseDeleted) { try { ctx.onDoseDeleted(id); } catch (e) { /* offline — local delete already applied */ } }
      renderDosing(view, ctx);
      if (ctx.refreshDash) ctx.refreshDash();
    };
    // Prefer the app's in-modal confirm dialog (accessible, themed); fall back to native confirm.
    const cd = global.PoolarisApp && global.PoolarisApp.confirmDialog;
    if (cd) cd({ title: "Delete this addition?", message: "This removes it from your dosing history.", confirm: "Delete", danger: true }).then((ok) => { if (ok) proceed(); });
    else if (global.confirm("Delete this addition?")) proceed();
  }

  /* ----------------------------- CSS (injected) ------------------------ */
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return; cssDone = true;
    const css = `
    .chem-pick{display:grid;grid-template-columns:repeat(auto-fill,minmax(140px,1fr));gap:8px;margin-top:6px}
    .chem-pick__b{display:flex;align-items:center;gap:9px;padding:9px 11px;border:1.5px solid var(--line);border-radius:13px;background:transparent;cursor:pointer;text-align:left;font:inherit;color:inherit;transition:border-color .15s,background .15s}
    .chem-pick__b:hover{border-color:var(--aqua)}
    .chem-pick__b.is-sel{border-color:var(--aqua);background:var(--foam)}
    .chem-pick__ic{width:24px;height:30px;flex:0 0 24px;display:flex;align-items:center;justify-content:center}
    .chem-pick__ic svg{width:24px;height:30px}
    .chem-pick__t{font-size:.84rem;font-weight:650;line-height:1.2}
    .chem-pick__t .muted{font-weight:500;font-size:.72rem}
    .dose-lbl{display:block;font-weight:650;font-size:.82rem;color:var(--ink-2);margin-bottom:4px}
    .bare-select{border:none;background:transparent;font:inherit;color:var(--ink-3);cursor:pointer;outline:none}
    .dose-proj{margin:14px 0}
    .dose-proj__card{border:1.5px solid var(--line);border-radius:14px;padding:12px 14px;background:var(--foam-2,var(--foam))}
    .dose-proj__h{display:flex;align-items:center;gap:8px;font-weight:750;margin-bottom:8px}
    .dose-proj__h svg{width:18px;height:18px}
    .dose-proj__t{width:100%;border-collapse:collapse}
    .dose-proj__t td{padding:3px 6px;font-size:.92rem}
    .dose-proj__t td.num{text-align:right;font-variant-numeric:tabular-nums}
    .dose-arrow{color:var(--ink-4);text-align:center;width:24px}
    .dose-d__a{font-weight:700;font-size:.82rem;white-space:nowrap}
    .dose-d__a.is-dn{color:var(--aqua)}
    .dose-d__a.is-up{color:var(--warn,#f08c00)}
    .mix-card .card__title{display:flex;align-items:center}
    .mix-row{display:flex;gap:11px;padding:10px 0;border-top:1px solid var(--line)}
    .mix-row:first-of-type{border-top:none}
    .mix-row__ic{width:26px;height:32px;flex:0 0 26px;display:flex;align-items:center;justify-content:center}
    .mix-row__ic svg{width:26px;height:32px}
    .mix-row__main{flex:1;min-width:0}
    .mix-row__top{display:flex;justify-content:space-between;gap:8px;font-size:.9rem;align-items:baseline}
    .mix-row__top .muted{font-size:.78rem;white-space:nowrap}
    .mix-bar{height:7px;border-radius:999px;background:var(--line);overflow:hidden;margin:6px 0}
    .mix-bar__fill{height:100%;background:linear-gradient(90deg,#22b8cf,#0b6e99);border-radius:999px;transition:width .4s}
    .mix-row__d{display:flex;flex-wrap:wrap;gap:10px;font-size:.82rem}
    .dose-d{white-space:nowrap}
    .mix-foot{display:flex;justify-content:space-between;align-items:flex-end;gap:12px;flex-wrap:wrap;margin-top:12px;padding-top:12px;border-top:1px solid var(--line)}
    .dose-chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:4px}
    .dose-chip{display:inline-flex;flex-direction:column;align-items:center;padding:4px 10px;border-radius:10px;background:var(--foam);min-width:54px}
    .dose-chip span{font-size:.68rem;color:var(--ink-3);text-transform:uppercase;letter-spacing:.03em}
    .dose-chip b{font-size:.95rem;font-variant-numeric:tabular-nums}
    `;
    const el = document.createElement("style"); el.id = "chem-css"; el.textContent = css;
    document.head.appendChild(el);
  }

  global.CHEM = {
    CHEMS: CHEMS,
    computeDeltas: computeDeltas,
    projected: projected,
    mixProgress: mixProgress,
    observations: observations,
    dashboardWidget: dashboardWidget,
    renderDosing: renderDosing,
  };
})(window);
