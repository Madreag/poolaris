/* ============================================================================
   POOLARIS — intelligence engine
   Turns the raw test LOG into smart, time-aware observations: trends,
   rate-of-change, forecasts (time-to-threshold), anomalies, cross-parameter
   ROOT-CAUSE diagnosis, recurring-pattern detection, data-staleness flags,
   testing/dose reminders, seasonal context, SLAM progress, and positives.

   plan() (in calc.js) answers "what do I add right now"; this engine answers
   "what should I be noticing about how my pool is behaving over time."

   Constants are grounded in TFP/PoolMath norms (see pool-intelligence research).
   ========================================================================== */
(function (global) {
  "use strict";
  const D = global.DATA, C = global.CALC;
  const DAY = 86400000;

  /* ---- tunable constants (grounded in the TFP intelligence research) ---- */
  const K = {
    fcCrashFactor: 2.2,    // latest drop vs typical burn → crash anomaly
    fcDemandMult: 2,       // burn > expected×this → rising demand (watch)
    fcBloomMult: 3,        // burn > expected×this (and ≥8) → likely bloom (urgent)
    fcBloomAbs: 8,         // ppm/day absolute bloom floor
    phRiseFastPerWeek: 0.3,  // ~0.04/day; high-TA pools rise 0.05–0.15/day
    cyaClimbPerWeekWarn: 2.5,
    chCreepPerWeek: 5,     // desert CH rise ~15–45 ppm/month (≈4–10/week)
    chDiluteThreshold: 650, // plaster scale-risk dilution trigger
    saltDriftPerWeek: 60,
    saltHighSwg: 4000, saltLowSwg: 2600,
    noTestDays: 3,         // FC/pH move fast — nudge after 3 days
    cyaStaleDays: 28,      // CYA older than ~4 weeks undermines FC targets (14 if tablets)
    cyaCeiling: 80, cyaCeilingSwg: 90, // over-stabilized → dilute before SLAM
    algaeWaterTemp: 60,    // °F: algae dormant below, grows above
    heatwaveTemp: 92,      // water temp signalling heatwave demand
    forecastHorizon: 10,   // days ahead we bother forecasting
    minSamplesTrend: 3,
    taHighForPh: 90,       // TA at/above this is the usual root cause of a persistent pH climb
    scaleCSI: 0.3,         // CSI above this → water is tending to scale (top of the balanced band)
    corrodeCSI: -0.3,      // CSI below this → water is tending to be aggressive/etching
  };
  // expected daily FC burn for the water temp & climate (FC_LOSS_BY_WATERTEMP, desert ×~1.6)
  function expectedBurn(profile, reading) {
    const t = (reading && reading.temp != null ? reading.temp : (profile.tempF || 80));
    let base = t < 60 ? 0.75 : t < 75 ? 1.2 : t < 85 ? 2.0 : t < 95 ? 3.5 : 4.5;
    if (profile.climate === "desert") base *= 1.6; else if (profile.climate === "hot") base *= 1.25;
    return base;
  }

  /* ============================ primitives ============================= */
  // The "current" reading = the most recent non-null value of EACH parameter across
  // the whole log (falling back to the seed). So a partial entry (e.g. CH only) never
  // blanks out your other numbers — the app always works from the freshest of each.
  const RKEYS = ["fc", "cc", "ph", "ta", "ch", "cya", "salt", "temp", "borate"];
  function effectiveReading(log, seed) {
    const eff = {}, at = {}; // at[k] = timestamp of the value currently held for k
    if (seed) RKEYS.forEach((k) => { if (seed[k] != null && !isNaN(seed[k])) { eff[k] = +seed[k]; at[k] = -Infinity; } });
    (log || []).forEach((e) => {
      const r = e && e.reading; if (!r) return;
      const t = e.t != null ? e.t : 0;
      RKEYS.forEach((k) => { if (r[k] != null && !isNaN(r[k]) && (at[k] == null || t >= at[k])) { eff[k] = +r[k]; at[k] = t; } });
    });
    return eff;
  }
  function series(log, key) {
    const pts = [];
    (log || []).forEach((e) => { const v = e.reading && e.reading[key]; if (v != null && !isNaN(v)) pts.push({ t: e.t, v: +v }); });
    pts.sort((a, b) => a.t - b.t);
    const t0 = pts.length ? pts[0].t : 0;
    pts.forEach((p) => { p.d = (p.t - t0) / DAY; });
    return pts;
  }
  function regress(pts) {
    const n = pts.length;
    if (n < 2) return { n: n, slope: 0, intercept: n ? pts[0].v : 0, r2: 0 };
    let sx = 0, sy = 0, sxx = 0, sxy = 0, syy = 0;
    pts.forEach((p) => { sx += p.d; sy += p.v; sxx += p.d * p.d; sxy += p.d * p.v; syy += p.v * p.v; });
    const den = n * sxx - sx * sx;
    const slope = den === 0 ? 0 : (n * sxy - sx * sy) / den;
    const intercept = (sy - slope * sx) / n;
    const rden = Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
    const r2 = rden === 0 ? 0 : Math.pow((n * sxy - sx * sy) / rden, 2);
    return { n: n, slope: slope, intercept: intercept, r2: r2 };
  }
  function trend(log, key) {
    const pts = series(log, key);
    const latest = pts.length ? pts[pts.length - 1].v : null;
    if (pts.length < 2) return { n: pts.length, latest: latest, first: latest, slope: 0, perDay: 0, perWeek: 0, direction: "steady", spanDays: 0, r2: 0, totalChange: 0, pts: pts };
    const r = regress(pts);
    const spanDays = pts[pts.length - 1].d - pts[0].d;
    const first = pts[0].v;
    const R = D.RANGES[key];
    const scale = R ? Math.max(1, R.ok[1] - R.ok[0]) : (Math.abs(latest) || 1);
    const perWeek = r.slope * 7;
    let direction = "steady";
    if (Math.abs(perWeek) > scale * 0.06) direction = perWeek > 0 ? "rising" : "falling";
    return { n: pts.length, latest: latest, first: first, slope: r.slope, perDay: r.slope, perWeek: perWeek, direction: direction, spanDays: spanDays, r2: r.r2, totalChange: latest - first, pts: pts };
  }
  // estimate FC burn (ppm/day). DOSE-AWARE: if `doses` is given, chlorine added between two
  // tests is added back to the measured drop, so a top-up dose can't mask the true demand.
  // Without doses it falls back to the conservative "any drop = decay" lower bound.
  function fcBurn(log, doses) {
    const pts = series(log, "fc");
    const samples = [];
    const t0 = pts.length ? pts[0].t : 0;
    // FC added by chlorine doses inside [tA, tB) (ppm), from the dose ledger
    const fcAddedBetween = (tA, tB) => {
      if (!doses || !doses.length) return 0;
      let add = 0;
      doses.forEach((d) => {
        const t = d.t != null ? d.t : 0;
        if (t >= tA && t < tB && d.deltas && d.deltas.fc > 0) add += d.deltas.fc;
      });
      return add;
    };
    for (let i = 1; i < pts.length; i++) {
      const gap = pts[i].d - pts[i - 1].d;
      const added = fcAddedBetween(pts[i - 1].t, pts[i].t);
      // true consumption = (start + what you added) − end
      const burned = (pts[i - 1].v + added) - pts[i].v;
      if (burned > 0 && gap >= 0.12 && gap <= 7) samples.push(burned / gap);
    }
    if (!samples.length) return { rate: null, n: 0, max: null };
    const s = samples.slice().sort((a, b) => a - b);
    return { rate: s[Math.floor(s.length / 2)], n: s.length, max: s[s.length - 1] };
  }
  function lastTested(log, key, now) {
    now = now || Date.now();
    for (let i = (log || []).length - 1; i >= 0; i--) { const v = log[i].reading[key]; if (v != null && !isNaN(v)) return (now - log[i].t) / DAY; }
    return null;
  }
  function daysSinceLog(log, now) { now = now || Date.now(); return (log && log.length) ? (now - log[log.length - 1].t) / DAY : null; }
  function countOut(log, key, profile, predicate) {
    let c = 0; (log || []).forEach((e) => { const v = e.reading[key]; if (v != null && predicate(C.classify(key, v, profile, e.reading), +v)) c++; }); return c;
  }

  /* ============================ health score ========================== */
  function health(profile, log) {
    const r = effectiveReading(log, profile.seedReading);
    const weights = { fc: 3, cc: 2, cya: 2, ph: 2, ta: 1, ch: 1, csi: 1, salt: 1 };
    const keys = ["fc", "cc", "ph", "ta", "cya"];
    if (profile.surface === "plaster" || profile.surface === "pebble" || profile.surface === "tile") keys.push("ch");
    if (profile.sanitizer === "salt") keys.push("salt");
    let wSum = 0, wGood = 0, good = 0, total = 0, worst = 0;
    const rank = { good: 0, warn: 1, bad: 2 };
    const csiVal = C.csi(r, r.temp != null ? r.temp : (profile.tempF || 82));
    const allKeys = keys.concat(csiVal != null ? ["csi"] : []);
    allKeys.forEach((k) => {
      const v = k === "csi" ? csiVal : r[k];
      const cls = C.classify(k, v, profile, r);
      if (cls === "unknown") return;
      const w = weights[k] || 1; wSum += w; total++;
      const partial = cls === "good" ? 1 : cls === "warn" ? 0.5 : 0;
      wGood += w * partial; if (cls === "good") good++;
      worst = Math.max(worst, rank[cls] || 0);
    });
    const score = wSum ? Math.round((wGood / wSum) * 100) : null;
    // trend: in-range share of last 3 vs prior 3 readings
    let trendDir = "steady";
    if (log && log.length >= 4) {
      const inRange = (e) => keys.filter((k) => C.classify(k, e.reading[k], profile, e.reading) === "good").length / keys.length;
      const recent = log.slice(-3).map(inRange).reduce((a, b) => a + b, 0) / 3;
      const prior = log.slice(-6, -3).map(inRange).reduce((a, b) => a + b, 0) / Math.max(1, Math.min(3, log.length - 3));
      if (recent > prior + 0.12) trendDir = "improving";
      else if (recent < prior - 0.12) trendDir = "declining";
    }
    const state = total === 0 ? "unknown" : worst === 2 ? "bad" : worst === 1 ? "warn" : "good";
    return { score: score, good: good, total: total, state: state, csi: csiVal, trendDir: trendDir };
  }

  /* ============================ insight detection ===================== */
  const ICON = { safety: "warn", trend: "plan", forecast: "clock", rootcause: "target", pattern: "plan", anomaly: "warn", data: "beaker", seasonal: "sun", progress: "check", good: "check" };

  function detect(profile, log, now, doses) {
    now = now || Date.now();
    log = log || [];
    const p = profile || {};
    const swg = p.sanitizer === "salt";
    const tabs = (p.sanitizers && p.sanitizers.indexOf("tabs") >= 0) || p.sanitizer === "tabs";
    const latest = effectiveReading(log, p.seedReading);
    const cya = latest.cya != null ? latest.cya : 40;
    const fcT = C.fcTargets(cya, swg);
    const out = [];
    const burn = fcBurn(log, doses);
    const fmtDate = (days) => { const d = new Date(now + days * DAY); return (d.getMonth() + 1) + "/" + d.getDate(); };
    const fmtIn = (days) => days < 1 ? "~" + Math.max(1, Math.round(days * 24)) + " hrs" : "~" + (Math.round(days * 10) / 10) + " days";
    const evid = (key, n) => { const s = series(log, key).slice(-(n || 4)); return s.length ? s.map((x) => x.v).join(" → ") : ""; };
    const add = (o) => out.push(Object.assign({ severity: "info", category: "trend", icon: ICON[o.category || "trend"] }, o, { icon: o.icon || ICON[o.category || "trend"] }));
    const has = (v) => v != null && !isNaN(v);
    const Tcya = trend(log, "cya"), Tph = trend(log, "ph"), Tch = trend(log, "ch"), Tta = trend(log, "ta"), Tsalt = trend(log, "salt");

    /* ---------- FC burn + forecast (chlorine demand vs temp baseline) ---------- */
    const expBurn = expectedBurn(p, latest);
    const wTemp = latest.temp != null ? latest.temp : (p.tempF || 80);
    if (burn.rate != null) {
      const rate = burn.rate;
      if (rate >= Math.max(K.fcBloomAbs, expBurn * K.fcBloomMult)) add({ id: "fc-burn-vhigh", category: "anomaly", severity: "urgent", title: "Your pool is eating chlorine fast", detail: `FC is dropping ~<b>${rate.toFixed(1)} ppm/day</b> — far above the ~${expBurn.toFixed(1)} expected for your water temp. That's the signature of an active algae bloom or heavy organic load, often before the water looks green.`, evidence: evid("fc"), recommend: "Test CC and start a SLAM — during a bloom FC can crash to zero within hours, so dose &amp; re-test several times a day.", route: "slam" });
      else if (rate >= expBurn * K.fcDemandMult + 0.5) add({ id: "fc-burn-high", category: "trend", severity: "watch", title: "Chlorine demand is climbing", detail: `You're burning ~<b>${rate.toFixed(1)} ppm/day</b> vs the ~${expBurn.toFixed(1)} expected for ${Math.round(wTemp)}°F${p.climate === "desert" ? " desert" : ""} water. Rising demand with no obvious cause is how algae announces itself before it's visible.`, evidence: evid("fc"), recommend: "Hold FC at the upper target, brush, empty the baskets, and run an overnight test tonight.", route: "slam" });
    }
    if (has(latest.fc) && burn.rate != null && burn.rate > 0.3 && latest.fc > fcT.min) {
      const days = (latest.fc - fcT.min) / burn.rate;
      if (days > 0 && days < K.forecastHorizon) add({ id: "fc-forecast", category: "forecast", severity: days < 1.5 ? "watch" : "info", title: "Chlorine will run low soon", detail: `At ~${burn.rate.toFixed(1)} ppm/day, FC will reach its minimum (${fcT.min}) around <b>${fmtDate(days)}</b> (${fmtIn(days)}).`, recommend: "Dose chlorine before then so it never dips below the safe minimum.", route: "calculators", calc: "chlorine" });
    }

    /* ---------- pH rise + root cause ---------- */
    if (Tph.n >= K.minSamplesTrend && Tph.direction === "rising") {
      const wk = Tph.perWeek;
      if (has(latest.ta) && latest.ta >= K.taHighForPh) {
        add({ id: "ph-rootcause-ta", category: "rootcause", severity: "watch", title: "Your pH keeps climbing — TA is why", detail: `pH has been rising ~<b>${wk.toFixed(2)}/week</b>, and your TA is <b>${latest.ta}</b> (high). High alkalinity is the usual root cause — you'll keep adding acid every week until you bring TA down.`, evidence: "pH: " + evid("ph"), recommend: "Lower TA with the acid + aeration method to fix the cause, not the symptom.", route: "calculators", calc: "taDown" });
      } else if (wk >= K.phRiseFastPerWeek) {
        const days = has(latest.ph) ? (8.0 - latest.ph) / Tph.perDay : null;
        add({ id: "ph-rising", category: "forecast", severity: "info", title: "pH is drifting up", detail: `pH is rising ~<b>${wk.toFixed(2)}/week</b>${days && days > 0 && days < 30 ? ` and will pass 8.0 around <b>${fmtDate(days)}</b>` : ""}. That's normal from aeration &amp; liquid chlorine.`, evidence: "pH: " + evid("ph"), recommend: "Keep muriatic acid handy and knock pH down when it passes 7.8.", route: "calculators", calc: "acid" });
      }
    }

    /* ---------- CYA climbing (tablet trap) or falling (dilution working) ---------- */
    if (Tcya.n >= K.minSamplesTrend && Tcya.spanDays >= 7) {
      if (Tcya.perWeek >= K.cyaClimbPerWeekWarn) {
        const target = swg ? 80 : 50;
        const daysToTrouble = Tcya.latest < (swg ? 90 : 60) ? ((swg ? 90 : 60) - Tcya.latest) / Tcya.perDay : 0;
        add({ id: "cya-climb", category: "rootcause", severity: "watch", title: "Your CYA is creeping up" + (tabs ? " — it's the tablets" : ""), detail: `CYA has risen about <b>${Math.round(Tcya.totalChange)} ppm</b> over ${Math.round(Tcya.spanDays)} days${tabs ? " — trichlor tablets are the cause (each adds CYA that never leaves)" : ""}.${daysToTrouble > 0 && daysToTrouble < 120 ? ` At this pace you'll hit the trouble zone (~${swg ? 90 : 60}) around <b>${fmtDate(daysToTrouble)}</b>.` : ""}`, evidence: "CYA: " + evid("cya"), recommend: tabs ? "Switch daily chlorination to liquid (zero CYA) and save tablets for trips." : "Find what's adding CYA; the only way back down is diluting water.", route: "learn" });
      } else if (Tcya.direction === "falling" && Tcya.latest > (swg ? 80 : 50)) {
        const target = swg ? 70 : 45;
        add({ id: "cya-falling", category: "progress", severity: "good", title: "Your CYA dilution is working", detail: `CYA is down about <b>${Math.round(-Tcya.totalChange)} ppm</b> — nice. ${Tcya.latest > target ? `Roughly ${Math.max(1, Math.ceil((Tcya.latest - target) / Math.max(1, -Tcya.perWeek)))} more weeks at this rate to reach ~${target}.` : "You're in range now — you can stop diluting."}`, evidence: "CYA: " + evid("cya"), recommend: Tcya.latest > target ? "Keep going, then switch to maintaining with liquid chlorine." : "Switch to maintaining — don't drain further.", route: "calculators", calc: "cya" });
      }
    }
    const cyaAge = lastTested(log, "cya", now);
    const cyaStaleLimit = tabs ? 14 : K.cyaStaleDays;
    if (cyaAge != null && cyaAge > cyaStaleLimit && log.length >= 3) {
      add({ id: "cya-stale", category: "data", severity: "info", title: "Time to re-check CYA", detail: `You haven't tested CYA in about <b>${Math.round(cyaAge)} days</b>. CYA sets every chlorine target${tabs ? ", and your tablets quietly raise it" : ""} — if it has drifted, your FC aim is off.`, recommend: `Re-test CYA (${tabs ? "every ~2 weeks on tablets" : "monthly is plenty"}).`, route: "log" });
    }

    /* ---------- CH / salt creep (evaporation concentration) ---------- */
    if (Tch.n >= K.minSamplesTrend && Tch.perWeek >= K.chCreepPerWeek && Tch.spanDays >= 10) {
      add({ id: "ch-creep", category: "trend", severity: (p.climate === "desert" || p.climate === "hot") ? "watch" : "info", title: "Calcium is creeping up", detail: `Calcium hardness has risen ~<b>${Math.round(Tch.totalChange)} ppm</b> — evaporation concentrating your hard fill water.${p.climate === "desert" ? " Classic desert pattern." : ""}`, evidence: "CH: " + evid("ch"), recommend: "Keep pH &amp; TA on the low side so it doesn't scale; check your CSI.", route: "calculators", calc: "csi" });
    }
    if (swg && Tsalt.n >= K.minSamplesTrend && Math.abs(Tsalt.perWeek) >= K.saltDriftPerWeek) {
      add({ id: "salt-drift", category: "trend", severity: "info", title: "Salt is " + (Tsalt.direction === "rising" ? "creeping up" : "drifting down"), detail: `Salt has moved ~<b>${Math.round(Tsalt.totalChange)} ppm</b>. ${Tsalt.direction === "rising" ? "Evaporation concentrates it; only water replacement lowers it." : "Splash-out &amp; rain dilute it; top up to your cell's range."}`, evidence: "Salt: " + evid("salt"), recommend: "Keep salt in your generator's spec range.", route: "calculators", calc: "salt" });
    }

    /* ---------- CC / algae early-warning ---------- */
    if (has(latest.cc) && latest.cc > 0.5) {
      add({ id: "cc-present", category: "safety", severity: latest.cc >= 1 ? "watch" : "info", title: "Combined chlorine showed up", detail: `CC is <b>${latest.cc}</b> (want 0). That's spent chlorine — an early sign of organics or algae taking hold, and the cause of any “chlorine smell”.`, recommend: "Catch it early with a SLAM before it becomes a green pool.", route: "slam" });
    }

    /* ---------- FC crash anomaly ---------- */
    if (burn.rate != null && burn.max != null && log.length >= 3) {
      const pts = series(log, "fc");
      const lastDrop = pts.length >= 2 ? (pts[pts.length - 2].v - pts[pts.length - 1].v) / Math.max(0.2, pts[pts.length - 1].d - pts[pts.length - 2].d) : 0;
      if (lastDrop > burn.rate * K.fcCrashFactor && lastDrop >= Math.max(4, expBurn * 2)) {
        add({ id: "fc-crash", category: "anomaly", severity: "watch", title: "FC just dropped faster than usual", detail: `Your latest FC fell ~<b>${lastDrop.toFixed(1)} ppm/day</b> — well above your normal ${burn.rate.toFixed(1)}. Something is suddenly consuming chlorine.`, evidence: "FC: " + evid("fc"), recommend: "Test CC and watch the water; an overnight test will confirm if it's algae.", route: "slam" });
      }
    }

    /* ---------- scaling / corrosion (CSI) ---------- */
    const csiVal = C.csi(latest, latest.temp != null ? latest.temp : (p.tempF || 82));
    if (csiVal != null) {
      if (csiVal > K.scaleCSI && (p.surface === "plaster" || p.surface === "pebble" || p.surface === "tile")) {
        add({ id: "csi-scale", category: "rootcause", severity: csiVal > 0.6 ? "watch" : "info", title: "Water is tending to scale", detail: `Your CSI is <b>+${csiVal}</b> — over time that means cloudy water and crusty deposits, especially on a plaster/tile surface in hard water.`, recommend: "Lower pH and/or TA to bring CSI toward zero — you rarely need to touch calcium.", route: "calculators", calc: "csi" });
      } else if (csiVal < K.corrodeCSI) {
        add({ id: "csi-corrode", category: "rootcause", severity: csiVal < -0.6 ? "watch" : "info", title: "Water is a little aggressive", detail: `Your CSI is <b>${csiVal}</b> — slightly corrosive, which can etch plaster and dull metal over time.`, recommend: "Nudge pH, TA, or calcium up to balance it.", route: "calculators", calc: "csi" });
      }
    }

    /* ---------- recurring patterns ---------- */
    if (log.length >= 4) {
      const fcLow = countOut(log, "fc", p, (cls) => cls === "bad");
      if (fcLow >= 3 && cya < (swg ? 75 : 60)) add({ id: "pat-fc-low", category: "pattern", severity: "watch", title: "FC keeps dipping too low", detail: `Free chlorine has fallen below its safe minimum on <b>${fcLow}</b> of your tests. Each dip is a chance for algae to start.`, recommend: "Dose a bit more each time, dose more often, or raise CYA slightly so chlorine lasts longer.", route: "calculators", calc: "chlorine" });
      const phHigh = countOut(log, "ph", p, (cls, v) => v > 7.8);
      if (phHigh >= 3 && !out.some((o) => o.id === "ph-rootcause-ta")) add({ id: "pat-ph-high", category: "pattern", severity: "info", title: "pH runs high a lot", detail: `pH has been above 7.8 on <b>${phHigh}</b> tests. If you're adding acid often, high TA is usually the underlying cause.`, recommend: "Check your TA — lowering it stops the constant pH climb.", route: "calculators", calc: "taDown" });
    }

    /* ---------- data quality / reminders ---------- */
    const sinceLog = daysSinceLog(log, now);
    const noTestLimit = swg ? 5 : K.noTestDays;
    if (sinceLog != null && sinceLog > noTestLimit) add({ id: "test-due", category: "data", severity: sinceLog > 9 ? "watch" : "info", title: "Time to test the water", detail: `It's been about <b>${Math.round(sinceLog)} days</b> since your last test. Chlorine and pH move fast — a few days is enough to drift below safe levels.`, recommend: "Run a quick FC &amp; pH test and log it.", route: "log" });
    if (!has(latest.cya) && log.length >= 1) add({ id: "no-cya", category: "data", severity: "watch", title: "We don't know your CYA", detail: "Without CYA we're assuming 40 — but it drives every chlorine target. A wrong guess means wrong FC.", recommend: "Test CYA once; it only changes slowly after that.", route: "log" });

    /* ---------- test-error / sanity ---------- */
    if (Tcya.n >= 3 && !tabs) {
      const jump = Tcya.latest - Tcya.pts[Tcya.pts.length - 2].v;
      if (jump >= 25) add({ id: "cya-jump", category: "anomaly", severity: "info", title: "That CYA reading looks off", detail: `CYA jumped <b>+${Math.round(jump)}</b> with no tablets in use — CYA can't rise on its own. It may have been a test slip (the black-dot test is easy to misread).`, recommend: "Re-run the CYA test outdoors, in shade, at eye level to confirm.", route: "log" });
    }
    if (has(latest.fc) && has(latest.ph) && latest.fc > 10) add({ id: "ph-fc-interfere", category: "data", severity: "info", title: "Your pH reading may read high", detail: `With FC at <b>${latest.fc}</b> (very high), the pH test reads falsely high. Don't chase pH until FC drops back near normal.`, recommend: "Re-check pH once FC is back in the normal range.", route: "learn" });

    /* ---------- SLAM progress ---------- */
    if (global.__poolarisSlam && global.__poolarisSlam.active && global.__poolarisSlam.ocl && global.__poolarisSlam.ocl.dawn != null) {
      const loss = global.__poolarisSlam.ocl.dusk - global.__poolarisSlam.ocl.dawn;
      if (loss < 1) add({ id: "slam-pass", category: "progress", severity: "good", title: "Overnight test passed", detail: `Your overnight loss is <b>${(Math.round(loss * 10) / 10)} ppm</b> — under 1, so the algae is dead. Confirm CC ≤ 0.5 and clear water to finish.`, recommend: "Tick the exit criteria and finish your SLAM.", route: "slam" });
    }

    /* ---------- seasonal / contextual ---------- */
    const month = new Date(now).getMonth(); // 0=Jan
    const summer = month >= 4 && month <= 8;
    if (summer && (p.climate === "desert" || p.climate === "hot") && log.length >= 1 && wTemp < K.heatwaveTemp) {
      add({ id: "season-summer", category: "seasonal", severity: "info", title: "Peak season — demand is highest now", detail: "Hot, sunny months burn chlorine fastest. Test more often, dose after sundown, and keep CYA at the upper end so the sun doesn't strip your FC by noon.", recommend: "Bump your testing to every 1–2 days through the heat.", route: "learn" });
    } else if ((month <= 1 || month === 11) && p.climate !== "desert" && log.length >= 1) {
      add({ id: "season-winter", category: "seasonal", severity: "info", title: "Low-demand season", detail: "Cool months use far less chlorine. You can test less often — and don't add CYA now (it'll just linger).", recommend: "Keep FC above minimum and enjoy the break.", route: "learn" });
    }

    /* ---------- FC critically low + warm (bloom clock) ---------- */
    if (has(latest.fc) && latest.fc < fcT.min * 0.8 && wTemp > K.algaeWaterTemp) {
      add({ id: "fc-critical-warm", category: "safety", severity: "urgent", title: "Chlorine is way low and the water's warm", detail: `FC is <b>${latest.fc}</b> — well under the ${fcT.min} minimum for CYA ${cya} — and at ${Math.round(wTemp)}°F algae grows fast. The clock is now running on a bloom, even while the water still looks clear.`, recommend: "Raise FC to the upper target now and run an overnight test tonight. If you see any dullness or CC, start a precautionary SLAM — it's a 1–2 day job now vs a week once it greens.", route: "calculators", calc: "chlorine" });
    }

    /* ---------- CYA too HIGH → chlorine effectively weak ---------- */
    const fcWeakCount = countOut(log, "fc", p, (cls) => cls === "bad");
    if (cya >= (swg ? 75 : 60) && fcWeakCount >= 2 && has(latest.fc)) {
      add({ id: "cya-fc-weak", category: "rootcause", severity: "watch", title: "Your chlorine is weak for your CYA", detail: `FC keeps falling below its minimum even though the number can look 'normal'. The active sanitizer depends on the FC-to-CYA <b>ratio</b>, and at CYA ${cya} your FC needs to stay above ${fcT.min}. This is the #1 cause of 'my chlorine won't hold'.`, recommend: "Two real fixes: raise your FC target to the right band for your CYA, or (better long-term) lower CYA by partial drain. Small top-up doses just treat the symptom.", route: "calculators", calc: "cya" });
    }

    /* ---------- CYA too LOW → sun destroying chlorine ---------- */
    if (burn.rate != null && burn.rate >= 4 && has(latest.cya) && latest.cya <= 20) {
      add({ id: "cya-low-noprot", category: "rootcause", severity: "watch", title: "Too little stabilizer — the sun is eating your chlorine", detail: `FC is burning ~${burn.rate.toFixed(1)} ppm/day and your CYA is only <b>${latest.cya}</b>. Outdoor pools can lose most of their chlorine in a couple of hours with no stabilizer to shield it.`, recommend: "Raise CYA to your target (30–50 liquid, 60–80 salt). Demand should drop sharply once it dissolves.", route: "calculators", calc: "stabilizer" });
    }

    /* ---------- CYA crash → possible ammonia ---------- */
    if (Tcya.n >= 2) {
      const cyaDrop = Tcya.pts[Tcya.pts.length - 2].v - Tcya.latest;
      if (cyaDrop >= 20 && burn.rate != null && burn.rate >= 6) {
        add({ id: "cya-ammonia", category: "rootcause", severity: "urgent", title: "Possible ammonia — CYA crashed &amp; chlorine won't hold", detail: `CYA fell <b>${Math.round(cyaDrop)} ppm</b> and chlorine is being consumed very fast. When FC reaches zero, bacteria can turn CYA into ammonia, which then devours chlorine until you reach breakpoint.`, recommend: "Run a full SLAM-level chlorination to break through — expect to add far more chlorine than usual. Re-test CYA after; it may need rebuilding. Never let FC reach zero again.", route: "slam" });
      }
    }

    /* ---------- pH+TA both falling on tablets ---------- */
    if (tabs && Tph.n >= 3 && Tph.direction === "falling" && Tta.n >= 3 && Tta.direction === "falling") {
      add({ id: "ph-ta-erode", category: "rootcause", severity: "watch", title: "Tablets are eroding your pH buffer", detail: `Both pH and alkalinity are drifting down — trichlor/dichlor are acidic and consume alkalinity as they sanitize. Left alone this can push CSI negative and etch plaster.`, evidence: "TA: " + evid("ta"), recommend: "Raise TA with baking soda and re-balance pH — and consider moving daily chlorination to liquid/SWG.", route: "calculators", calc: "ta" });
    }

    /* ---------- TA too low → bouncy pH ---------- */
    if (has(latest.ta) && latest.ta < 50) {
      add({ id: "ta-too-low", category: "safety", severity: "watch", title: "Alkalinity is low — pH can get bouncy", detail: `TA is <b>${latest.ta}</b>. Below ~50 there's little buffer, so pH swings around and the water can trend corrosive (negative CSI), dissolving plaster, grout and metal.`, recommend: "Raise TA toward 60–70 with baking soda, and/or add ~50 ppm borates for extra pH stability. Re-check CSI.", route: "calculators", calc: "ta" });
    }

    /* ---------- CH too high → plan a dilution / RO ---------- */
    if (has(latest.ch) && latest.ch > K.chDiluteThreshold && (p.surface === "plaster" || p.surface === "pebble" || p.surface === "tile")) {
      add({ id: "ch-too-high", category: "safety", severity: csiVal != null && csiVal > 0.3 ? "watch" : "info", title: "Calcium is getting high", detail: `CH is <b>${latest.ch}</b>. As it climbs you can't hold CSI balanced without pushing pH/TA to extremes, and scale forms on tile, the heater and (for salt pools) the cell.`, recommend: "Keep CSI in check with low-ish pH/TA for now; when CH crosses ~650–800 plan a partial drain or a mobile RO service (your hard fill water is the floor a plain drain can reach).", route: "calculators", calc: "cya" });
    }

    /* ---------- salt out of SWG range ---------- */
    if (swg && has(latest.salt)) {
      if (latest.salt > K.saltHighSwg) add({ id: "salt-high", category: "safety", severity: "watch", title: "Salt is above your cell's safe range", detail: `Salt is <b>${latest.salt}</b> — at/above the usual 4000–4500 ceiling. High salt raises corrosion risk and can make the cell throttle down.`, recommend: "Replace some water to bring salt back near ~3200. Confirm with a drop test, not just the cell's display.", route: "calculators", calc: "salt" });
      else if (latest.salt < K.saltLowSwg) add({ id: "salt-low", category: "safety", severity: "watch", title: "Salt is too low — the cell can't keep up", detail: `Salt is <b>${latest.salt}</b>, below the healthy window, so your generator makes little chlorine — and unmet demand means algae risk.`, recommend: "Add salt to your cell's target (~3200), let it mix ~4 hrs, then re-test.", route: "calculators", calc: "salt" });
    }

    /* ---------- heatwave context ---------- */
    if (wTemp >= K.heatwaveTemp && log.length >= 1) {
      add({ id: "heatwave", category: "seasonal", severity: "watch", title: "Heat-wave chlorine demand", detail: `Your water is ${Math.round(wTemp)}°F. Expect 4–5+ ppm/day FC loss and faster algae growth — pools that coast on normal dosing often crash below minimum by late afternoon.`, recommend: "Raise the daily FC target toward the top of range, dose in the evening, and test daily until the heat breaks.", route: "calculators", calc: "chlorine" });
    }

    /* ---------- rate-plausibility (test-error) checks ---------- */
    if (Tph.n >= 2) { const phJump = Math.abs(Tph.latest - Tph.pts[Tph.pts.length - 2].v); const gap = Tph.pts[Tph.pts.length - 1].d - Tph.pts[Tph.pts.length - 2].d; if (phJump > 1.0 && gap <= 2) add({ id: "ph-implausible", category: "anomaly", severity: "info", title: "That pH reading looks off", detail: `pH moved <b>${phJump.toFixed(1)}</b> in ${gap < 1 ? "under a day" : Math.round(gap) + " days"} — more than chemistry usually allows without a big addition. A lone wild value is often a test slip (or high FC fooling the pH dye).`, recommend: "Re-test before acting on it.", route: "log" }); }
    if (swg && Tsalt.n >= 2) { const sJump = Math.abs(Tsalt.latest - Tsalt.pts[Tsalt.pts.length - 2].v); if (sJump > 1000) add({ id: "salt-implausible", category: "anomaly", severity: "info", title: "That salt reading jumped a lot", detail: `Salt changed <b>${Math.round(sJump)} ppm</b> between tests — bigger than adding/diluting usually explains. Salt strips are notoriously inaccurate (±500).`, recommend: "Re-test with a drop test or take it to a shop meter.", route: "log" }); }

    /* ---------- SLAM in progress reminder ---------- */
    if (global.__poolarisSlam && global.__poolarisSlam.active) {
      const ex = global.__poolarisSlam.exit || {};
      if (!(ex.cc && ex.ocl && ex.clear)) add({ id: "slam-progress", category: "progress", severity: "info", title: "Your SLAM isn't finished yet", detail: `Hold FC at shock level until <b>all three</b> pass: CC ≤ 0.5, overnight loss &lt; 1 ppm, and clear water. Stopping early lets the algae rebound.`, recommend: "Keep dosing back to SLAM level several times a day, brush, filter 24/7, and re-run the overnight test nightly.", route: "slam" });
    }

    /* ---------- not enough data yet ---------- */
    if (log.length < 2) {
      add({ id: "need-data", category: "data", severity: "info", title: "Log a few tests to unlock the smart stuff", detail: "With a couple of readings over a week or two, I can start spotting trends, forecasting when chlorine runs low, and catching demand changes before they become problems.", recommend: "Test every couple of days and log it — even partial readings help.", route: "log" });
    }

    /* ---------- positives ---------- */
    const h = health(p, log);
    if (h.state === "good" && log.length >= 3 && out.filter((o) => o.severity === "urgent" || o.severity === "watch").length === 0) {
      add({ id: "all-stable", category: "good", severity: "good", title: "Your water is dialed in &amp; steady", detail: `Everything's in range and your last few tests have been stable${h.trendDir === "improving" ? " and improving" : ""}. This is exactly where you want to be.`, recommend: "Keep your routine — test every couple of days and top up chlorine.", route: "log" });
    } else if (h.trendDir === "improving" && log.length >= 4) {
      add({ id: "improving", category: "progress", severity: "good", title: "You're trending in the right direction", detail: "Your recent tests show more numbers landing in range than before — your routine is working.", recommend: "Keep it up.", route: "log" });
    }

    // sort by severity then category importance
    const sev = { urgent: 0, watch: 1, info: 2, good: 3 };
    out.sort((a, b) => (sev[a.severity] - sev[b.severity]) || 0);
    return out;
  }

  global.INSIGHTS = { series: series, regress: regress, trend: trend, fcBurn: fcBurn, lastTested: lastTested, daysSinceLog: daysSinceLog, health: health, detect: detect, effectiveReading: effectiveReading, K: K };
})(window);
