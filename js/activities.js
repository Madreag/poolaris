/* ============================================================================
   POOLARIS — activities & context  (window.ACTIVITIES)
   ---------------------------------------------------------------------------
   The "tell the app what you're doing so it stops fighting you" layer.

   The chemistry engine only knows the STATE of the water (test results). It can't
   see the ACTIONS and PROCESSES in flight — so when you aerate to raise pH, it
   sees pH climbing and tells you to add acid (the opposite of your intent).

   This module lets the user declare ongoing processes & point events. It then:
     • REINTERPRETS the observation list — suppresses/rewrites advice that
       conflicts with what you're doing, and adds a status line for the activity.
     • DETECTS signatures the chemistry can't explain on its own and asks a
       one-tap question ("Your pH rose with no base added — are you aerating?").
   The verified engine (calc.js/insights.js) is never modified — we post-process
   its output. Activities persist on `state.activities` (rides the save path) so
   the 24/7 server engine can respect them too.

   Integration (via app.js):
     ACTIVITIES.reinterpret(observations, ctx) -> { observations, banners, prompts }
     ACTIVITIES.quickRow(ctx)        -> HTML for the dashboard "what are you up to?" row
     ACTIVITIES.wire(root, ctx)      -> wires quick row + prompt buttons
     ACTIVITIES.start(state,id,opts) / stop(state,id) / dismiss(state,promptId)
   ctx = { state, profile, latest, log, save, go, toast, rerender, S }
   ========================================================================== */
(function (global) {
  "use strict";
  const S = global.SVG, IN = global.INSIGHTS;
  const DAY = 86400000;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function icon(n) { return S && S.icon ? S.icon(n) : ""; }
  function now() { return Date.now(); }

  /* ----------------------------- catalog ------------------------------- */
  // type: "ongoing" (a process over time) | "event" (a point-in-time thing that just happened)
  // suppress: insight/alert ids (or id-prefixes via *) to hide while active
  // The reinterpret logic uses `id` to apply tailored rewrites.
  const CATALOG = [
    {
      id: "aerating", name: "Aerating", short: "Aerating", icon: "droplet", type: "ongoing",
      blurb: "Running features/jets to raise pH",
      ask: "Your pH is climbing with no base added — are you aerating to raise it?",
      suppress: ["ph-rising", "ph-rootcause-ta", "ph-implausible", "wx-uv"], suppressAlert: ["ph_out"],
      status: (ctx) => {
        const ph = ctx.latest && ctx.latest.ph;
        return {
          title: "Aerating to raise pH",
          detail: ph != null
            ? `pH is at <b>${ph}</b> and rising as planned — aeration drives off CO₂ and pushes pH up <b>without</b> touching your alkalinity.`
            : "Aeration raises pH by off-gassing CO₂ — no chemicals needed. Log a pH test to track progress.",
          recommend: "Keep aerating until pH reaches ~7.8, then turn features off. This is the 'up' half of lowering TA.",
        };
      },
    },
    {
      id: "lowering-ta", name: "Lowering alkalinity", short: "Lowering TA", icon: "flask", type: "ongoing",
      blurb: "Acid + aeration to bring TA down",
      ask: "You added acid to drop pH while TA is high — are you running the acid-and-aeration method to lower TA?",
      suppress: ["ph-rising", "ph-rootcause-ta", "ph-fc-interfere", "wx-uv"], suppressAlert: ["ph_out", "csi_corrosive"],
      guided: true,
      status: (ctx) => {
        const r = ctx.latest || {}; const a = activeOpts(ctx.state, "lowering-ta");
        const target = (a && a.targetTA) || 70;
        const cur = r.ta != null ? r.ta : null;
        const cycle = (a && a.cycle) || 1;
        let line;
        if (cur == null) line = "Log a TA test to see how far you've come.";
        else if (cur <= target) line = `TA is <b>${cur}</b> — you've hit your target of ${target}. You can stop and re-balance pH.`;
        else line = `TA is <b>${cur}</b>, target <b>${target}</b>. Each cycle: drop pH to ~7.2 with acid, then aerate back to ~7.8. You're on cycle ${cycle}.`;
        return {
          title: "Lowering TA (acid + aeration)",
          detail: line,
          recommend: cur != null && cur > target
            ? `Where's your pH now? If it's near 7.2, switch features ON to aerate up. If near 7.8, add acid to drop it again.`
            : "Done — turn off aeration and let pH settle into 7.5–7.8.",
          guided: true,
        };
      },
    },
    {
      id: "draining", name: "Draining & refilling", short: "Draining", icon: "leak", type: "ongoing",
      blurb: "Replacing water to lower CYA / CH / salt",
      ask: "Your CYA is dropping — are you draining and refilling to lower it?",
      suppress: ["cya-jump", "salt-implausible", "ch-too-high"], suppressAlert: [],
      status: (ctx) => {
        const r = ctx.latest || {};
        const bits = [];
        if (r.cya != null) bits.push(`CYA ${r.cya}`);
        if (r.ch != null) bits.push(`CH ${r.ch}`);
        if (r.salt != null) bits.push(`salt ${r.salt}`);
        return {
          title: "Replacing water (dilution)",
          detail: `You're swapping water to bring levels down${bits.length ? " — currently " + bits.join(", ") : ""}. Each 20% of water replaced drops these ~20%. Falling numbers here are progress, not test errors.`,
          recommend: "Drain the old water first, then refill — more efficient than overflowing. Re-test CYA/CH after it mixes.",
          route: "calculators", calc: "cya",
        };
      },
    },
    {
      id: "cover-on", name: "Solar cover on", short: "Cover on", icon: "sun", type: "ongoing",
      blurb: "Cover cuts chlorine burn & evaporation",
      suppress: ["season-summer"], suppressAlert: [],
      status: () => ({
        title: "Solar cover is on",
        detail: "A cover blocks UV, so your chlorine lasts much longer (often ~50% less burn) and evaporation nearly stops.",
        recommend: "You can dose a little less FC and test a bit less often while it's on. Watch for higher water temp.",
      }),
    },
    {
      id: "away", name: "Away / vacation", short: "Away", icon: "clock", type: "ongoing",
      blurb: "Pause test reminders while you travel",
      suppress: ["test-due", "cya-stale"], suppressAlert: ["overdue_test", "never_tested"],
      status: (ctx) => {
        const a = activeOpts(ctx.state, "away");
        return {
          title: "You're away",
          detail: "Test reminders are paused while you travel." + (a && a.tabs ? " Tablets in a floater will hold FC but slowly raise CYA." : ""),
          recommend: "When you're back, run a full test first thing — especially FC and CYA.",
        };
      },
    },
    {
      id: "new-plaster", name: "New plaster", short: "New plaster", icon: "droplet", type: "ongoing",
      blurb: "Fresh surface — different chemistry for ~a month",
      ask: "Is this a new plaster/pebble surface? The startup chemistry is different for the first month.",
      suppress: ["ph-rising", "ph-rootcause-ta", "ch-creep", "csi-scale"], suppressAlert: ["ph_out", "csi_scaling"],
      status: () => ({
        title: "New plaster startup",
        detail: "Fresh plaster leaches calcium and pushes pH up fast for the first ~28 days — that's expected, not a problem.",
        recommend: "Brush daily, keep pH ~7.2–7.6 with acid, don't chase CH yet, and avoid a SLAM on green-tinted new plaster.",
      }),
    },
    {
      id: "leak", name: "Known leak", short: "Leak", icon: "leak", type: "ongoing",
      blurb: "Constant refill is diluting the water",
      suppress: ["cya-jump"], suppressAlert: [],
      status: () => ({
        title: "Leak + constant refill",
        detail: "Auto-fill or topping off a leak steadily dilutes everything — CYA, salt and CH drift down, and FC gets diluted between tests.",
        recommend: "Expect to top up chlorine more often. Fixing the leak stabilizes your chemistry (and water bill).",
      }),
    },
    // ----- events (point-in-time) -----
    {
      id: "party", name: "Pool party happened", short: "Party", icon: "droplet", type: "event",
      blurb: "Heavy bather load — explains a CC/FC swing",
      ask: "Did a lot of people swim recently? That explains a chlorine drop and combined-chlorine spike.",
      suppress: ["fc-crash", "cc-present"], suppressAlert: ["cc_high"],
      ttlDays: 3,
      status: () => ({
        title: "Recent heavy bather load",
        detail: "Lots of swimmers dump sweat, sunscreen and organics — FC drops and combined chlorine (CC) rises. That's expected, not an algae bloom.",
        recommend: "Raise FC toward the top of range to burn off the CC; if CC stays above 0.5 for days, then consider a SLAM.",
        route: "calculators", calc: "chlorine",
      }),
    },
    {
      id: "refill", name: "Big refill / top-off", short: "Refilled", icon: "droplet", type: "event",
      blurb: "Fresh water diluted everything at once",
      suppress: ["cya-jump", "salt-implausible"], suppressAlert: [],
      ttlDays: 2,
      status: () => ({
        title: "Fresh water added",
        detail: "A big top-off dilutes everything proportionally — a drop in CYA/CH/salt right after is dilution, not a bad test.",
        recommend: "Re-test once it's mixed (a few hours with the pump running).",
      }),
    },
  ];
  function byId(id) { return CATALOG.find((a) => a.id === id) || null; }

  /* ----------------------------- state mgmt ----------------------------
     Activities live on profile.activities so they persist with the profile in
     BOTH offline (state blob) and account mode (savePool sends profile whole) and
     are visible to the 24/7 server engine, which already reads profile_json. */
  function store(state) {
    if (!state.profile) { state.profile = {}; }
    if (!state.profile.activities) state.profile.activities = { active: [], dismissed: {} };
    const a = state.profile.activities;
    if (!a.active) a.active = []; if (!a.dismissed) a.dismissed = {};
    return a;
  }
  function ensure(state) { return store(state); }
  function activeList(state) { const a = ensure(state); prune(state); return a.active; }
  function isActive(state, id) { return activeList(state).some((x) => x.id === id); }
  function activeOpts(state, id) { return activeList(state).find((x) => x.id === id) || null; }
  function prune(state) {
    const a = ensure(state); const t = now();
    a.active = a.active.filter((x) => {
      const def = byId(x.id); if (!def) return false;
      if (def.ttlDays && x.startedAt && (t - x.startedAt) > def.ttlDays * DAY) return false; // event auto-expires
      return true;
    });
  }
  function start(state, id, opts) {
    const a = ensure(state); const def = byId(id); if (!def) return;
    const ex = a.active.find((x) => x.id === id);
    if (ex) { Object.assign(ex, opts || {}); ex.startedAt = ex.startedAt || now(); }
    else a.active.push(Object.assign({ id: id, startedAt: now() }, opts || {}));
  }
  function stop(state, id) { const a = ensure(state); a.active = a.active.filter((x) => x.id !== id); }
  function dismissPrompt(state, promptId) { const a = ensure(state); a.dismissed[promptId] = now(); }
  function promptDismissed(state, promptId) {
    const a = ensure(state); const t = a.dismissed[promptId];
    if (!t) return false;
    return (now() - t) < 5 * DAY; // re-ask after 5 days if the signature persists
  }

  /* ===================================================================
     REINTERPRET — the core: rewrite the observation list given what's active
     =================================================================== */
  function reinterpret(observations, ctx) {
    const state = ctx.state;
    const active = activeList(state);
    let obs = (observations || []).slice();
    const banners = [];

    // 1. suppress observations that conflict with active activities
    active.forEach((act) => {
      const def = byId(act.id); if (!def) return;
      const sup = def.suppress || [];
      obs = obs.filter((o) => !sup.some((s) => s.endsWith("*") ? (o.id || "").indexOf(s.slice(0, -1)) === 0 : o.id === s));
      // add the activity's status as a friendly observation/banner
      const st = def.status ? def.status(ctx) : null;
      if (st) {
        banners.push({
          id: "act-" + def.id, activityId: def.id, category: "activity", severity: "good", icon: def.icon,
          title: st.title, detail: st.detail, recommend: st.recommend, route: st.route, calc: st.calc,
          guided: !!(st.guided || def.guided), type: def.type,
        });
      }
    });

    // 2. detect signatures the chemistry can't explain → "are you doing X?" prompts
    const prompts = detectPrompts(ctx, active);

    return { observations: obs, banners: banners, prompts: prompts };
  }

  /* ----------------------------- detection ----------------------------- */
  // Each detector returns a prompt {id, activityId, q} when its signature fires
  // and the activity isn't already active or recently dismissed.
  function detectPrompts(ctx, active) {
    const state = ctx.state, log = ctx.log || state.log || [];
    if (!IN || log.length < 2) return [];
    const out = [];
    const activeIds = active.map((a) => a.id);
    const consider = (activityId, fired) => {
      if (activeIds.indexOf(activityId) >= 0) return;
      const pid = "ask-" + activityId;
      if (!fired || promptDismissed(state, pid)) return;
      const def = byId(activityId); if (!def || !def.ask) return;
      out.push({ id: pid, activityId: activityId, q: def.ask, name: def.short });
    };

    const Tph = IN.trend(log, "ph");
    const Tcya = IN.trend(log, "cya");
    const Tta = IN.trend(log, "ta");
    const latest = ctx.latest || {};
    const tabs = (ctx.profile && ((ctx.profile.sanitizers || []).indexOf("tabs") >= 0 || ctx.profile.sanitizer === "tabs"));

    // pH rising meaningfully with no acid expected → aerating? (or new plaster)
    const phRising = Tph.n >= 2 && Tph.direction === "rising" && Tph.perWeek >= 0.25;
    consider("aerating", phRising);

    // acid logged (pH dropped) AND TA high AND pH bouncing → lowering TA?
    const taHigh = latest.ta != null && latest.ta >= 90;
    const phVolatile = Tph.n >= 3 && Math.abs(Tph.totalChange) >= 0.3;
    consider("lowering-ta", taHigh && phVolatile && !isActive(state, "aerating"));

    // CYA (or CH/salt) trending DOWN without obvious cause → draining?
    const cyaFalling = Tcya.n >= 2 && Tcya.direction === "falling" && Tcya.totalChange <= -10;
    consider("draining", cyaFalling);

    // CC present + recent FC drop, warm season → party? (only if not already a known bloom)
    const cc = latest.cc; const ccUp = cc != null && cc > 0.5 && cc < 2;
    consider("party", ccUp);

    return out.slice(0, 2); // never nag with more than 2 at once
  }

  /* ===================================================================
     UI — dashboard "what are you up to?" quick row + prompt cards
     =================================================================== */
  function quickRow(ctx) {
    injectCSS();
    const state = ctx.state;
    const active = activeList(state);
    const quick = ["aerating", "lowering-ta", "draining", "cover-on", "away"];
    const chips = quick.map((id) => {
      const def = byId(id); const on = isActive(state, id);
      return `<button class="act-chip ${on ? "is-on" : ""}" data-act-toggle="${id}" aria-pressed="${on}">
        <span class="act-chip__ic">${icon(def.icon)}</span>${esc(def.short)}${on ? " " + icon("check") : ""}</button>`;
    }).join("");
    return `<div class="act-quick">
      <div class="act-quick__label">${icon("wand")} What are you up to?<span class="muted"> tap so Poolaris reads your water right</span></div>
      <div class="act-quick__row">${chips}<button class="act-chip act-chip--more" data-act-more="1">${icon("plus")} More</button></div>
    </div>`;
  }

  function promptCard(p) {
    return `<div class="act-prompt" data-prompt="${p.id}" data-act="${p.activityId}">
      <span class="act-prompt__ic">${icon("wand")}</span>
      <div class="act-prompt__body">
        <div class="act-prompt__q">${esc(p.q)}</div>
        <div class="act-prompt__btns">
          <button class="btn btn--sm btn--primary" data-prompt-yes="${p.activityId}" data-prompt-id="${p.id}">Yes, ${esc(p.name.toLowerCase())}</button>
          <button class="btn btn--sm btn--ghost" data-prompt-no="${p.id}">No</button>
        </div>
      </div></div>`;
  }

  function wire(root, ctx) {
    root = root || document;
    root.querySelectorAll("[data-act-toggle]").forEach((b) => b.addEventListener("click", () => {
      const id = b.getAttribute("data-act-toggle");
      if (isActive(ctx.state, id)) { stop(ctx.state, id); ctx.toast && ctx.toast(byId(id).short + " off", "info"); }
      else { startWithOpts(id, ctx); }
      ctx.save && ctx.save(); ctx.rerender && ctx.rerender();
    }));
    root.querySelectorAll("[data-act-more]").forEach((b) => b.addEventListener("click", () => openActivitySheet(ctx)));
    root.querySelectorAll("[data-prompt-yes]").forEach((b) => b.addEventListener("click", () => {
      const id = b.getAttribute("data-prompt-yes");
      startWithOpts(id, ctx); ctx.save && ctx.save(); ctx.rerender && ctx.rerender();
    }));
    root.querySelectorAll("[data-prompt-no]").forEach((b) => b.addEventListener("click", () => {
      dismissPrompt(ctx.state, b.getAttribute("data-prompt-no")); ctx.save && ctx.save(); ctx.rerender && ctx.rerender();
    }));
    // activity status banner actions (stop / guided next-step)
    root.querySelectorAll("[data-act-stop]").forEach((b) => b.addEventListener("click", () => {
      stop(ctx.state, b.getAttribute("data-act-stop")); ctx.save && ctx.save(); ctx.toast && ctx.toast("Stopped — thanks for the update", "good"); ctx.rerender && ctx.rerender();
    }));
    root.querySelectorAll("[data-act-guide]").forEach((b) => b.addEventListener("click", () => {
      const id = b.getAttribute("data-act-guide");
      if (id === "lowering-ta") openTaCampaign(ctx);
    }));
  }

  function startWithOpts(id, ctx) {
    const def = byId(id);
    // a couple of activities benefit from a target; keep it one-tap with a sane default
    if (id === "lowering-ta") {
      const cur = ctx.latest && ctx.latest.ta;
      start(ctx.state, id, { targetTA: 70, startTA: cur != null ? cur : null, cycle: 1 });
      ctx.toast && ctx.toast("Got it — I'll guide your acid + aeration cycles and stop nagging about pH.", "good");
    } else if (id === "away") {
      start(ctx.state, id, { tabs: !!(ctx.profile && ((ctx.profile.sanitizers || []).indexOf("tabs") >= 0)) });
      ctx.toast && ctx.toast("Have a great trip — reminders paused.", "good");
    } else {
      start(ctx.state, id);
      ctx.toast && ctx.toast(def.short + " — Poolaris will read your water accordingly.", "good");
    }
  }

  function openActivitySheet(ctx) {
    const layer = document.getElementById("modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    const rows = CATALOG.map((def) => {
      const on = isActive(ctx.state, def.id);
      return `<button class="act-row ${on ? "is-on" : ""}" data-act-toggle="${def.id}">
        <span class="act-row__ic">${icon(def.icon)}</span>
        <span class="act-row__main"><b>${esc(def.name)}</b><span>${esc(def.blurb)}</span></span>
        <span class="act-row__tgl">${on ? icon("check") : icon("plus")}</span></button>`;
    }).join("");
    layer.innerHTML = `<div class="sheet act-sheet" role="dialog" aria-modal="true" aria-label="What are you doing?">
      <div class="sheet__head"><h2>${icon("wand")} Tell Poolaris what you're doing</h2><button class="iconbtn" id="actClose" aria-label="Close">${icon("arrow")}</button></div>
      <p class="muted" style="margin:-4px 0 12px">Turn these on so the app interprets your numbers correctly — and stops giving advice that fights what you're already doing.</p>
      <div class="act-rows">${rows}</div></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    document.getElementById("actClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    layer.querySelectorAll("[data-act-toggle]").forEach((b) => b.addEventListener("click", () => {
      const id = b.getAttribute("data-act-toggle");
      if (isActive(ctx.state, id)) stop(ctx.state, id); else startWithOpts(id, ctx);
      ctx.save && ctx.save(); openActivitySheet(ctx); ctx.rerender && ctx.rerender();
    }));
  }

  // activity status banner (rendered by app.js from the `banners` returned by reinterpret)
  function bannerHTML(b) {
    const def = byId(b.activityId) || {};
    return `<div class="act-banner act-banner--${b.type === "event" ? "event" : "ongoing"}">
      <span class="act-banner__ic">${icon(b.icon || "wand")}</span>
      <div class="act-banner__body">
        <div class="act-banner__title">${esc(b.title)}${def.type === "ongoing" ? `<span class="act-banner__live">● live</span>` : ""}</div>
        <div class="act-banner__detail">${b.detail}</div>
        ${b.recommend ? `<div class="act-banner__rec">${icon("arrow")} <span>${b.recommend}</span></div>` : ""}
        <div class="act-banner__acts">
          ${b.guided ? `<button class="btn btn--sm btn--primary" data-act-guide="${b.activityId}">${icon("wand")} Guide me</button>` : ""}
          ${b.route ? `<button class="btn btn--sm btn--ghost" data-ins-route="${b.route}" data-ins-calc="${b.calc || ""}">Open ${icon("arrow")}</button>` : ""}
          ${def.type === "ongoing" ? `<button class="btn btn--sm btn--ghost" data-act-stop="${b.activityId}">${icon("check")} Done</button>` : ""}
        </div>
      </div></div>`;
  }

  /* ===================================================================
     GUIDED TA-LOWERING CAMPAIGN  (acid + aeration, cycle by cycle)
     The method: drop pH 7.8→7.2 with acid (acid also lowers TA), then aerate
     pH back to ~7.8 (TA stays down). Repeat until TA reaches target. Every dose
     is computed with the verified CALC.acidForPH so the numbers can't drift.
     State lives on the activity row: { targetTA, startTA, cycle, phase }.
       phase: 'acid' (add acid, drop pH) | 'aerate' (run features, pH back up)
     =================================================================== */
  const C = global.CALC;
  const TA_PH_HIGH = 7.8;   // pH we aerate back up to before each acid round
  const TA_PH_LOW = 7.2;    // pH we drop to with acid each round

  function taState(ctx) {
    const a = activeOpts(ctx.state, "lowering-ta");
    if (!a) return null;
    if (!a.targetTA) a.targetTA = 70;
    if (!a.cycle) a.cycle = 1;
    if (!a.phase) a.phase = "acid";
    return a;
  }

  function openTaCampaign(ctx) {
    if (!isActive(ctx.state, "lowering-ta")) start(ctx.state, "lowering-ta", { targetTA: 70, cycle: 1, phase: "acid" });
    renderTaCampaign(ctx);
  }

  function renderTaCampaign(ctx) {
    const layer = document.getElementById("modalLayer"); if (!layer) return;
    const a = taState(ctx); if (!a) return;
    const profile = ctx.profile || {};
    const vol = profile.volume || 14000;
    const acidPct = profile.acidPct || "31.45";
    const r = ctx.latest || {};
    const ta = r.ta != null ? +r.ta : null;
    const ph = r.ph != null ? +r.ph : null;
    const target = a.targetTA;
    const done = ta != null && ta <= target;

    // exact acid dose for THIS round: drop pH from where it is (or 7.8) to 7.2
    const fromPh = ph != null ? Math.max(ph, TA_PH_LOW + 0.05) : TA_PH_HIGH;
    const acid = C && C.acidForPH ? C.acidForPH(fromPh, TA_PH_LOW, ta != null ? ta : 90, vol, acidPct) : null;
    const acidTxt = acid ? C.fmtFlOz(acid.flOz) : "about ¼–½ gal";
    const taDropPerRound = acid ? acid.taDrop : 10;
    const roundsLeft = (ta != null && taDropPerRound > 0) ? Math.max(0, Math.ceil((ta - target) / taDropPerRound)) : null;

    layer.hidden = false; layer.className = "overlay is-open";
    let body;
    if (done) {
      body = `<div class="ta-done">${icon("check")}
        <h2>TA is down to ${ta} 🎉</h2>
        <p class="muted">You hit your target of ${target}. Turn off aeration and let pH settle into 7.5–7.8. Your alkalinity is now where it buffers pH without driving it up.</p>
        <button class="btn btn--primary btn--block" id="taFinish">${icon("check")} Finish — I'm done</button></div>`;
    } else {
      const pct = (a.startTA && a.startTA > target) ? Math.max(0, Math.min(100, Math.round(((a.startTA - (ta != null ? ta : a.startTA)) / (a.startTA - target)) * 100))) : 0;
      const acidPhase = a.phase === "acid";
      body = `
        <div class="ta-head">
          <div class="ta-prog"><div class="ta-prog__bar"><div class="ta-prog__fill" style="width:${pct}%"></div></div>
            <div class="ta-prog__nums"><span>TA ${ta != null ? ta : "?"}</span><span class="muted">→ target ${target}</span></div></div>
          ${roundsLeft != null ? `<div class="ta-rounds muted">About <b>${roundsLeft}</b> more round${roundsLeft === 1 ? "" : "s"} · cycle ${a.cycle}</div>` : `<div class="ta-rounds muted">Cycle ${a.cycle}</div>`}
        </div>
        <div class="ta-cycle">
          <div class="ta-step ${acidPhase ? "is-now" : "is-done"}">
            <span class="ta-step__n">${acidPhase ? "1" : icon("check")}</span>
            <div><b>Add acid — drop pH to ~7.2</b>
              ${acidPhase ? `<div class="ta-step__dose">${icon("flask")} <b>${acidTxt}</b> of ${esc(acidPct)}% muriatic acid${acid && acid.taDrop ? ` <span class="muted">(also drops TA ~${acid.taDrop})</span>` : ""}</div>
              <div class="ta-step__hint muted">Pour slowly over a return with the pump running. Add about ¾, circulate ~30 min, then retest pH before the rest.</div>
              <button class="btn btn--sm btn--primary" data-ta="acid-done" style="margin-top:8px">${icon("check")} Added the acid — pH is ~7.2</button>` : `<div class="ta-step__hint muted">Done this round.</div>`}
            </div>
          </div>
          <div class="ta-step ${!acidPhase ? "is-now" : ""}">
            <span class="ta-step__n">2</span>
            <div><b>Aerate — bring pH back to ~7.8</b>
              ${!acidPhase ? `<div class="ta-step__hint muted">Point returns up, run a spa/fountain/waterfall, or add air — anything that agitates the surface. This off-gasses CO₂ and raises pH <b>without</b> raising TA. Takes a few hours to a day.</div>
              <button class="btn btn--sm btn--primary" data-ta="aerate-done" style="margin-top:8px">${icon("check")} pH is back near 7.8</button>` : `<div class="ta-step__hint muted">Next: aerate pH back up so you can drop it again.</div>`}
            </div>
          </div>
          <div class="ta-step">
            <span class="ta-step__n">3</span>
            <div><b>Retest TA &amp; repeat</b>
              <div class="ta-step__hint muted">Log a fresh TA test — if it's still above ${target}, start the next round. The progress bar above updates as you go.</div>
              <button class="btn btn--sm btn--ghost" data-ta="log" style="margin-top:8px">${icon("beaker")} Log a TA test</button>
            </div>
          </div>
        </div>
        ${ta == null ? `<div class="callout callout--warn" style="margin-top:10px;font-size:.84rem">${icon("warn")}<div>I don't have a current TA reading — <b>log a test</b> so I can size the acid dose and track progress.</div></div>` : ""}
        <div class="ta-foot"><button class="btn btn--ghost btn--sm" id="taStop">Stop the campaign</button><span class="muted" style="font-size:.78rem">Don't test pH while FC is above ~10 — it reads false-high.</span></div>`;
    }
    layer.innerHTML = `<div class="sheet ta-sheet" role="dialog" aria-modal="true" aria-label="Lower your alkalinity">
      <div class="sheet__head"><h2>${icon("flask")} Lower your alkalinity</h2><button class="iconbtn" id="taClose" aria-label="Close">${icon("close")}</button></div>
      <p class="muted" style="margin:-4px 0 14px">High TA keeps pushing your pH up. The fix is a few rounds of <b>acid then aeration</b> — I'll size each dose and track TA to your target. ${target}-ppm goal.</p>
      ${body}</div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    document.getElementById("taClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });

    const finish = document.getElementById("taFinish");
    if (finish) finish.addEventListener("click", () => { stop(ctx.state, "lowering-ta"); ctx.save && ctx.save(); ctx.toast && ctx.toast("Nice — alkalinity sorted. 🎉", "good"); close(); ctx.rerender && ctx.rerender(); });
    const stopBtn = document.getElementById("taStop");
    if (stopBtn) stopBtn.addEventListener("click", () => { stop(ctx.state, "lowering-ta"); ctx.save && ctx.save(); close(); ctx.rerender && ctx.rerender(); });

    layer.querySelectorAll("[data-ta]").forEach((b) => b.addEventListener("click", () => {
      const act = b.getAttribute("data-ta");
      const a2 = taState(ctx);
      if (!a2) return;
      if (a2.startTA == null && ctx.latest && ctx.latest.ta != null) a2.startTA = +ctx.latest.ta;
      if (act === "acid-done") { a2.phase = "aerate"; ctx.save && ctx.save(); renderTaCampaign(ctx); }
      else if (act === "aerate-done") { a2.phase = "acid"; a2.cycle = (a2.cycle || 1) + 1; ctx.save && ctx.save(); renderTaCampaign(ctx); ctx.toast && ctx.toast("Round done — retest TA and keep going.", "good"); }
      else if (act === "log") { close(); ctx.go && ctx.go("log"); }
    }));
  }
  global.PORTAL_TA_CAMPAIGN = openTaCampaign; // (exposed for tests)

  /* ----------------------------- CSS ----------------------------------- */
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return; cssDone = true;
    const css = `
    .act-quick{margin-bottom:22px}
    .act-quick__label{font-size:.84rem;font-weight:650;color:var(--ink-2);margin-bottom:8px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}
    .act-quick__label .muted{font-weight:400;font-size:.8rem}
    .act-quick__row{display:flex;gap:8px;flex-wrap:wrap}
    .act-chip{display:inline-flex;align-items:center;gap:6px;padding:8px 13px;border:1.5px solid var(--line);border-radius:999px;background:var(--card);font:inherit;font-size:.84rem;font-weight:600;color:var(--ink-2);cursor:pointer;transition:border-color .12s,background .12s}
    .act-chip:hover{border-color:var(--aqua)}
    .act-chip.is-on{border-color:var(--aqua);background:var(--foam);color:var(--deep)}
    .act-chip__ic{display:inline-flex;color:var(--aqua)} .act-chip__ic svg{width:16px;height:16px}
    .act-chip--more{border-style:dashed;color:var(--ink-3)}
    .act-prompt{display:flex;gap:11px;align-items:flex-start;padding:13px 15px;border:1.5px solid var(--aqua);border-radius:14px;background:var(--foam);margin-bottom:12px}
    .act-prompt__ic{color:var(--aqua);flex:none}.act-prompt__ic svg{width:22px;height:22px}
    .act-prompt__q{font-weight:650;margin-bottom:8px}
    .act-prompt__btns{display:flex;gap:7px;flex-wrap:wrap}
    .act-banner{display:flex;gap:11px;padding:13px 15px;border-radius:14px;background:var(--good-bg);border:1px solid var(--good);margin-bottom:12px}
    .act-banner--event{background:var(--foam);border-color:var(--line-2)}
    .act-banner__ic{flex:none;color:var(--good)}.act-banner--event .act-banner__ic{color:var(--aqua)}.act-banner__ic svg{width:24px;height:24px}
    .act-banner__title{font-weight:750;display:flex;align-items:center;gap:8px}
    .act-banner__live{font-size:.66rem;font-weight:800;color:var(--good);text-transform:uppercase;letter-spacing:.04em}
    .act-banner__detail{font-size:.88rem;color:var(--ink-2);margin:3px 0;line-height:1.45}
    .act-banner__rec{font-size:.84rem;color:var(--ink-3);display:flex;gap:6px;align-items:flex-start}
    .act-banner__rec svg{color:var(--aqua);flex:none;margin-top:2px}
    .act-banner__acts{display:flex;gap:6px;margin-top:8px;flex-wrap:wrap}
    .act-sheet{width:min(480px,100%)}
    .act-rows{display:flex;flex-direction:column;gap:6px}
    .act-row{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line);border-radius:13px;background:transparent;cursor:pointer;font:inherit;color:inherit;text-align:left}
    .act-row:hover{border-color:var(--aqua)} .act-row.is-on{border-color:var(--aqua);background:var(--foam)}
    .act-row__ic{width:34px;height:34px;border-radius:10px;background:var(--foam);display:flex;align-items:center;justify-content:center;color:var(--aqua);flex:none}
    .act-row.is-on .act-row__ic{background:var(--aqua);color:#fff}
    .act-row__main{flex:1;display:flex;flex-direction:column}
    .act-row__main b{font-size:.92rem}.act-row__main span{font-size:.78rem;color:var(--ink-3)}
    .act-row__tgl{color:var(--ink-3)}.act-row.is-on .act-row__tgl{color:var(--good)}
    .ta-sheet{width:min(500px,100%)}
    .ta-head{margin-bottom:14px}
    .ta-prog__bar{height:10px;border-radius:999px;background:var(--line);overflow:hidden}
    .ta-prog__fill{height:100%;background:linear-gradient(90deg,#f08c00,#20c997);border-radius:999px;transition:width .4s}
    .ta-prog__nums{display:flex;justify-content:space-between;font-size:.82rem;font-weight:650;margin-top:5px}
    .ta-rounds{font-size:.8rem;margin-top:4px}
    .ta-cycle{display:flex;flex-direction:column;gap:2px}
    .ta-step{display:flex;gap:12px;padding:13px 0;border-top:1px solid var(--line)}
    .ta-step:first-child{border-top:none}
    .ta-step__n{width:28px;height:28px;flex:none;border-radius:50%;background:var(--foam);color:var(--ink-3);display:flex;align-items:center;justify-content:center;font-weight:800;font-size:.9rem}
    .ta-step.is-now .ta-step__n{background:var(--aqua);color:#fff}
    .ta-step.is-done{opacity:.6}.ta-step.is-done .ta-step__n{background:var(--good);color:#fff}
    .ta-step__dose{margin:6px 0;font-size:.92rem;display:flex;align-items:center;gap:6px}
    .ta-step__dose svg{color:var(--warn)}
    .ta-step__hint{font-size:.82rem;margin-top:3px;line-height:1.45}
    .ta-foot{display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap;margin-top:14px;padding-top:12px;border-top:1px solid var(--line)}
    .ta-done{text-align:center;padding:14px 6px}.ta-done svg{width:46px;height:46px;color:var(--good)}
    .ta-done h2{margin:.2em 0}
    `;
    const el = document.createElement("style"); el.id = "act-css"; el.textContent = css; document.head.appendChild(el);
  }
  injectCSS();

  global.ACTIVITIES = {
    CATALOG: CATALOG, reinterpret: reinterpret, quickRow: quickRow, promptCard: promptCard,
    bannerHTML: bannerHTML, wire: wire, start: start, stop: stop, isActive: isActive,
    activeList: activeList, ensure: ensure, byId: byId, openTaCampaign: openTaCampaign,
  };
})(window);
