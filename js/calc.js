/* ============================================================================
   POOLARIS — chemistry engine
   Pure functions. All dosing is per the constants in data.js (per 10,000 US
   gallons). Volumes in US gallons, dimensions in feet, temperature in °F.
   ========================================================================== */
(function (global) {
  "use strict";
  const D = global.DATA;
  const GAL_PER_CUFT = 7.48052;

  /* ----------------------------- volume -------------------------------- */
  function volume(shape, dims, avgDepth) {
    dims = dims || {}; avgDepth = +avgDepth || 0;
    const a = +dims.a || 0, w = +dims.w || 0, b = +dims.b || 0, w2 = +dims.w2 || 0, d = +dims.d || 0;
    let surface = 0;
    switch (shape) {
      case "rectangle": surface = a * w; break;
      case "L":         surface = a * w + w2 * Math.max(0, b - w); break; // foot + upright above foot (matches the diagram)
      case "round":     surface = Math.PI * Math.pow(d / 2, 2); break;
      case "oval":      surface = Math.PI * (a / 2) * (w / 2); break;
      case "kidney":    surface = a * w * 0.85; break;
      default:          surface = a * w;
    }
    return Math.round(surface * avgDepth * GAL_PER_CUFT);
  }
  function surfaceArea(shape, dims) {
    dims = dims || {};
    const a = +dims.a || 0, w = +dims.w || 0, b = +dims.b || 0, w2 = +dims.w2 || 0, d = +dims.d || 0;
    switch (shape) {
      case "rectangle": return a * w;
      case "L":         return a * w + w2 * Math.max(0, b - w);
      case "round":     return Math.PI * Math.pow(d / 2, 2);
      case "oval":      return Math.PI * (a / 2) * (w / 2);
      case "kidney":    return a * w * 0.85;
      default:          return a * w;
    }
  }

  function perimeter(shape, dims) {
    dims = dims || {};
    const a = +dims.a || 0, w = +dims.w || 0, b = +dims.b || 0, w2 = +dims.w2 || 0, d = +dims.d || 0;
    switch (shape) {
      case "rectangle": return 2 * (a + w);
      case "L":         return 2 * (a + Math.max(b, w)); // notch edges cancel → bounding-box perimeter
      case "round":     return Math.PI * d;
      case "oval": {    const ra = a / 2, rb = w / 2; return Math.PI * (3 * (ra + rb) - Math.sqrt((3 * ra + rb) * (ra + 3 * rb))); }
      case "kidney":    return 2 * (a + w) * 1.08;
      default:          return 2 * (a + w);
    }
  }

  /* --------------------- FC / CYA targets ------------------------------ */
  function _interp(chart, cya) {
    const keys = Object.keys(chart).map(Number).sort((x, y) => x - y);
    if (cya <= keys[0]) return chart[keys[0]];
    if (cya >= keys[keys.length - 1]) {
      // extrapolate the slam via ratio for very high CYA
      const top = chart[keys[keys.length - 1]];
      return { min: top.min, target: top.target, slam: Math.round(cya * D.RATIOS.slamPct) };
    }
    let lo = keys[0], hi = keys[keys.length - 1];
    for (let i = 0; i < keys.length - 1; i++) { if (cya >= keys[i] && cya <= keys[i + 1]) { lo = keys[i]; hi = keys[i + 1]; break; } }
    const f = (cya - lo) / (hi - lo);
    const L = chart[lo], H = chart[hi];
    const lerp = (x, y) => Math.round((x + (y - x) * f) * 10) / 10;
    return {
      min: lerp(L.min, H.min),
      target: [lerp(L.target[0], H.target[0]), lerp(L.target[1], H.target[1])],
      slam: lerp(L.slam, H.slam),
    };
  }
  function fcTargets(cya, isSwg) {
    cya = +cya || 0;
    const chart = isSwg ? D.FC_CYA_SWG : D.FC_CYA_NONSWG;
    const r = _interp(chart, cya);
    return {
      min: r.min,
      targetLo: r.target[0],
      targetHi: r.target[1],
      target: Math.round(((r.target[0] + r.target[1]) / 2) * 10) / 10,
      slam: Math.round(r.slam),
      mustard: Math.round(cya * D.RATIOS.mustardPct),
    };
  }

  /* --------------------- dosing: chlorine ------------------------------ */
  // gallons of liquid chlorine to raise FC by deltaFC
  function chlorineGallons(deltaFC, vol, pct) {
    const ppmPerGalPer10k = D.DOSE.liquidChlorine[pct] || +pct || 10;
    if (deltaFC <= 0) return 0;
    return (deltaFC * (vol / 10000)) / ppmPerGalPer10k;
  }
  // how much FC one dose (gallons) gives
  function fcFromGallons(gallons, vol, pct) {
    const ppmPerGalPer10k = D.DOSE.liquidChlorine[pct] || +pct || 10;
    return gallons * ppmPerGalPer10k / (vol / 10000);
  }

  /* --------------------- dosing: acid (pH down) ------------------------ */
  // Estimate muriatic acid to move pH from cur to target. Coupled to TA AND
  // to the STARTING pH — carbonate buffering is stronger near 7.5, so the same
  // 0.1 drop needs roughly double the acid at pH 7.5 vs pH 7.8 (verified vs a
  // full carbonate-equilibrium model). Returns volume in the user's strength +
  // the TA the acid will also drop.
  function acidPHCoeff(pHavg) {
    // fl oz of 31.45% per 1.0 ΔpH per ppm-TA per 10k gal:
    // calibrated: 0.24 at start pH 7.8, 0.44 at 7.5 (each ~0.024/0.044 per 0.1 pH × TA)
    const k = 0.24 + (7.8 - pHavg) * 0.667;
    return Math.max(0.10, Math.min(0.72, k));
  }
  function acidForPH(curPH, targetPH, ta, vol, acidPct) {
    // non-finite / nonsensical inputs → no dose (NaN <= 0 is false, so it must be caught here)
    if (!(curPH > 0) || !(targetPH > 0) || !(vol > 0)) return null;
    const dpH = curPH - targetPH;
    if (dpH <= 0) return null;
    ta = ta || 80;
    const k = acidPHCoeff((curPH + targetPH) / 2);
    const flOz31per10k = ta * dpH * k;
    const flOz31 = flOz31per10k * (vol / 10000);
    const factor = D.DOSE.muriaticStrengthFactor[acidPct] || 1;
    const flOzActual = flOz31 * factor;
    const taDrop = (flOz31per10k / D.DOSE.muriatic31TAozPer10ppmPer10k) * 10;
    return { flOz: flOzActual, flOz31: flOz31, taDrop: Math.round(taDrop), acidPct: acidPct };
  }
  // acid purely to drop TA by deltaTA (acid + aeration method)
  function acidForTA(deltaTA, vol, acidPct) {
    if (deltaTA <= 0) return null;
    const flOz31 = (deltaTA / 10) * D.DOSE.muriatic31TAozPer10ppmPer10k * (vol / 10000);
    const factor = D.DOSE.muriaticStrengthFactor[acidPct] || 1;
    return { flOz: flOz31 * factor, flOz31: flOz31 };
  }
  // acid from a Taylor ACID-DEMAND titration (drop count → dose). A direct measurement
  // of the actual water, so it sidesteps the pH/TA estimate entirely.
  function acidFromDemand(drops, vol, acidPct) {
    drops = +drops || 0;
    if (drops <= 0) return null;
    const flOz31 = D.DOSE.acidDemandFlOz31per10k * drops * (vol / 10000);
    const factor = D.DOSE.muriaticStrengthFactor[acidPct] || 1;
    const dryOz = D.DOSE.acidDemandDryAcidOzPer10k * drops * (vol / 10000);
    return { flOz: flOz31 * factor, flOz31: flOz31, dryAcidOz: dryOz, drops: drops };
  }
  // soda ash from a Taylor BASE-DEMAND titration (drop count → oz of soda ash)
  function sodaAshFromDemand(drops, vol) {
    drops = +drops || 0;
    if (drops <= 0) return 0;
    return D.DOSE.baseDemandSodaAshOzPer10k * drops * (vol / 10000); // oz
  }

  /* --------------------- pump flow estimate (HP → GPM) ---------------- */
  // Estimate pump flow (GPM) from horsepower at typical residential head — for the
  // many owners who know their HP but not their GPM. Interpolates the data.js table.
  function gpmFromHp(hp) {
    hp = +hp || 0;
    if (hp <= 0) return null;
    const t = D.PUMP_GPM_BY_HP, keys = Object.keys(t).map(Number).sort((a, b) => a - b);
    if (hp <= keys[0]) return t[String(keys[0])];
    const top = keys[keys.length - 1];
    if (hp >= top) return Math.round(t[String(top)] * hp / top); // extrapolate above the table
    for (let i = 0; i < keys.length - 1; i++) {
      if (hp >= keys[i] && hp <= keys[i + 1]) {
        const f = (hp - keys[i]) / (keys[i + 1] - keys[i]);
        return Math.round(t[String(keys[i])] + (t[String(keys[i + 1])] - t[String(keys[i])]) * f);
      }
    }
    return t[String(keys[0])];
  }

  /* --------------------- dosing: dry chemicals ------------------------- */
  function bakingSodaForTA(deltaTA, vol) { return deltaTA <= 0 ? 0 : (deltaTA / 10) * D.DOSE.bakingSodaLbPer10ppmTAper10k * (vol / 10000); } // lb
  function calciumForCH(deltaCH, vol)   { return deltaCH <= 0 ? 0 : (deltaCH / 10) * D.DOSE.calciumChlorideLbPer10ppmCHper10k * (vol / 10000); } // lb
  function cyaToRaise(deltaCYA, vol)    { return deltaCYA <= 0 ? 0 : (deltaCYA / 10) * D.DOSE.cyaOzPer10ppmPer10k * (vol / 10000); } // oz
  function saltToRaise(deltaSalt, vol)  { return deltaSalt <= 0 ? 0 : deltaSalt * D.DOSE.saltLbPerPpmPer10k * (vol / 10000); } // lb

  /* --------------------- CYA dilution planner -------------------------- */
  // fraction of water to replace to go from cur -> target
  function dilutionFraction(cur, target) {
    if (cur <= 0 || target >= cur) return 0;
    return 1 - target / cur;
  }
  // cycles needed if each cycle replaces fracPerCycle of the water
  function dilutionCycles(cur, target, fracPerCycle) {
    if (cur <= target || fracPerCycle <= 0) return 0;
    return Math.ceil(Math.log(target / cur) / Math.log(1 - fracPerCycle));
  }
  // build a per-cycle projection table
  function dilutionTable(cur, fracPerCycle, target, maxCycles) {
    const rows = [{ cycle: 0, cya: Math.round(cur) }];
    let v = cur; let i = 0;
    maxCycles = maxCycles || 8;
    while (i < maxCycles && v > target) {
      v = v * (1 - fracPerCycle); i++;
      rows.push({ cycle: i, cya: Math.round(v), hit: v <= target });
    }
    return rows;
  }

  /* --------------------- CSI (saturation index) ----------------------- */
  const TEMP_TABLE = [[32, 0.0], [37, 0.1], [46, 0.2], [53, 0.3], [60, 0.4], [66, 0.5], [76, 0.6], [84, 0.7], [94, 0.8], [105, 0.9]];
  function tempFactor(f) {
    if (f <= TEMP_TABLE[0][0]) return 0;
    if (f >= TEMP_TABLE[TEMP_TABLE.length - 1][0]) return 0.9;
    for (let i = 0; i < TEMP_TABLE.length - 1; i++) {
      const [t0, v0] = TEMP_TABLE[i], [t1, v1] = TEMP_TABLE[i + 1];
      if (f >= t0 && f <= t1) return v0 + (v1 - v0) * (f - t0) / (t1 - t0);
    }
    return 0.6;
  }
  // CSI — the exact PoolMath / TFP Calcite Saturation Index master formula
  // (verified verbatim against the TFP wiki "CSI and LSI"). Reproduces the
  // wiki's own sanity check (pH 7.5, TA 70, CH 350, CYA 50, salt 1000, 80°F → −0.18).
  function csi(r, tempF) {
    if (r.ph == null || r.ch == null || r.ta == null) return null;
    tempF = tempF == null ? 82 : tempF;
    const ph = +r.ph, ch = +r.ch, ta = +r.ta, cya = +r.cya || 0, borate = +r.borate || 0;
    // CSI is undefined without positive, real pH/CH/TA — log10(≤0) is -Infinity/NaN and must
    // never leak into the plan. (A 0/blank/garbage entry returns null, i.e. "can't compute".)
    if (!(ph > 0) || !(ch > 0) || !(ta > 0)) return null;
    const salt = r.salt != null ? +r.salt : 1000; // non-salt pools still carry dissolved solids
    const carbAlk = Math.max(1, ta - (0.38772 * cya) / (1 + Math.pow(10, 6.83 - ph)) - (4.63 * borate) / (1 + Math.pow(10, 9.11 - ph)));
    const extraNaCl = Math.max(0, salt - 1.1678 * ch);
    const I = (1.5 * ch + ta) / 50045 + extraNaCl / 58440;
    const sI = Math.sqrt(I);
    const Tc = (tempF - 32) * 5 / 9;
    const val = ph - 11.677 + Math.log10(ch) + Math.log10(carbAlk) - (2.56 * sI) / (1 + 1.65 * sI) - 1412.5 / (Tc + 273.15) + 4.7375;
    return Math.round(val * 100) / 100;
  }

  /* --------------------- classify a reading --------------------------- */
  // returns 'good' | 'warn' | 'bad' | 'unknown'
  function classify(key, value, profile, reading) {
    if (value == null || value === "" || isNaN(value)) return "unknown";
    value = +value;
    const swg = profile && profile.sanitizer === "salt";
    if (key === "fc") {
      const cya = reading && reading.cya != null ? reading.cya : (profile && profile.seedReading ? profile.seedReading.cya : 40);
      const t = fcTargets(cya, swg);
      if (value < t.min) return "bad";
      if (value < t.targetLo) return "warn";
      if (value <= t.slam) return "good";
      return "warn"; // above slam — not dangerous, just very high
    }
    if (key === "csi") {
      const R = D.RANGES.csi;
      if (value >= R.ideal[0] && value <= R.ideal[1]) return "good";
      if (value >= R.ok[0] && value <= R.ok[1]) return "warn";
      return "bad";
    }
    const R = D.RANGES[key];
    if (!R) return "unknown";
    let ideal = R.ideal, ok = R.ok;
    if (key === "cya" && swg) { ideal = R.swgIdeal; ok = R.swgOk; }
    if (key === "cc") { return value <= 0 ? "good" : (value <= 0.5 ? "warn" : "bad"); }
    if (value >= ideal[0] && value <= ideal[1]) return "good";
    if (value >= ok[0] && value <= ok[1]) return "warn";
    return "bad";
  }

  /* --------------------- position on the meter (0..1) ----------------- */
  function meterPos(key, value, profile, reading) {
    const R = D.RANGES[key];
    let lo, hi;
    if (key === "fc") {
      const cya = reading && reading.cya != null ? reading.cya : 40;
      const t = fcTargets(cya, profile && profile.sanitizer === "salt");
      lo = 0; hi = Math.max(t.slam * 1.15, 10);
    } else if (key === "ph") { lo = 6.8; hi = 8.4; }
    else if (R) { lo = R.ok[0] - (R.ok[1] - R.ok[0]) * 0.3; hi = R.ok[1] + (R.ok[1] - R.ok[0]) * 0.3; }
    else { lo = 0; hi = 1; }
    return Math.max(0, Math.min(1, (value - lo) / (hi - lo)));
  }

  /* ===================================================================
     PATH TO PERFECT — the recommendation engine.
     Diffs the latest reading against the targets and emits ordered,
     prioritized, dosed actions. prio: now > soon > ok > info
     =================================================================== */
  function plan(profile, reading) {
    const vol = profile.volume || 14000;
    const swg = profile.sanitizer === "salt";
    const pct = profile.chlorinePct || "10";
    const acidPct = profile.acidPct || "31.45";
    const r = reading || {};
    const actions = [];
    const fcT = fcTargets(r.cya != null ? r.cya : 40, swg);

    const has = (v) => v != null && v !== "" && !isNaN(v);

    // ---- CYA first (drives everything) ----
    const cyaIdeal = swg ? D.RANGES.cya.swgIdeal : D.RANGES.cya.ideal;
    const cyaOk = swg ? D.RANGES.cya.swgOk : D.RANGES.cya.ok;
    if (has(r.cya)) {
      if (r.cya > cyaOk[1]) {
        const targetCYA = cyaIdeal[1];
        const frac = profile.avgDepth ? 1 / profile.avgDepth : 0.2; // one foot per cycle
        const cycles = dilutionCycles(r.cya, targetCYA, frac);
        actions.push({
          prio: r.cya > cyaOk[1] + 30 ? "now" : "soon", key: "cya",
          title: "Lower your CYA by replacing water",
          why: `CYA is ${r.cya} — for ${swg ? "a salt pool aim 60–80" : "liquid chlorine aim 30–50"}. High CYA weakens your chlorine and makes a SLAM impractical. The only way down is dilution.`,
          dose: { text: `≈ ${cycles} drain/refill cycle${cycles > 1 ? "s" : ""}`, sub: `each ~1 ft of water (~${Math.round(frac * 100)}% of the pool) → target ~${targetCYA} ppm` },
          chart: { type: "cyaStaircase", start: r.cya, frac: frac, target: targetCYA },
        });
      } else if (r.cya < cyaIdeal[0]) {
        const add = cyaToRaise(cyaIdeal[0] + 5 - r.cya, vol);
        actions.push({
          prio: "soon", key: "cya", title: "Add stabilizer (CYA)",
          why: `CYA is ${r.cya} — below the ${cyaIdeal[0]}–${cyaIdeal[1]} range, so the sun is burning your chlorine off fast.`,
          dose: { text: `${fmtLb(add / 16)} of stabilizer`, sub: "add via a sock in the skimmer; dissolves over ~a week — don't backwash for a few days" },
        });
      } else if (r.cya > cyaIdeal[1]) {
        actions.push({ prio: "tune", key: "cya", title: "CYA is a touch high", why: `CYA is ${r.cya} — just above the ${cyaIdeal[0]}–${cyaIdeal[1]} ideal${swg ? " for a salt pool" : ""}. It drifts down with normal water changes; avoid trichlor tabs/pucks (they add more CYA).`, dose: null });
      }
    } else {
      actions.push({ prio: "soon", key: "cya", title: "Test your CYA", why: "CYA sets every chlorine target — it's the most important number to know.", dose: null });
    }

    // ---- CC / algae => SLAM ----
    if (has(r.cc) && r.cc > 0.5) {
      actions.push({
        prio: "now", key: "cc", title: "Run a SLAM — you have hidden organics",
        why: `Combined chlorine is ${r.cc} (want ≤ 0.5). That means something is consuming chlorine. Hold FC at the SLAM level until it clears.`,
        dose: { text: `SLAM FC = ${fcT.slam} ppm`, sub: `add ${fmtGal(chlorineGallons(Math.max(0, fcT.slam - (r.fc || 0)), vol, pct))} of ${pct}% liquid chlorine to get there` },
      });
    }

    // ---- FC vs target ----
    if (has(r.fc)) {
      if (r.fc < fcT.min) {
        const g = chlorineGallons(fcT.target - r.fc, vol, pct);
        actions.push({
          prio: "now", key: "fc", title: "Add chlorine now — FC is too low",
          why: `FC is ${r.fc}; for CYA ${r.cya != null ? r.cya : "?"} it must stay above ${fcT.min}. Below this, algae can take hold.`,
          dose: { text: `${fmtGal(g)} of ${pct}% liquid chlorine`, sub: `${jugs(g) ? jugs(g) + " · " : ""}brings FC to the ${fcT.targetLo}–${fcT.targetHi} target` },
        });
      } else if (r.fc < fcT.targetLo) {
        const g = chlorineGallons(fcT.target - r.fc, vol, pct);
        actions.push({
          prio: "soon", key: "fc", title: "Top up your chlorine",
          why: `FC is ${r.fc}; target is ${fcT.targetLo}–${fcT.targetHi} for your CYA.`,
          dose: { text: `${fmtGal(g)} of ${pct}% liquid chlorine`, sub: `${jugs(g) ? jugs(g) + " · " : ""}dose after sunset so the sun doesn't waste it` },
        });
      } else if (r.fc > fcT.slam) {
        actions.push({ prio: "tune", key: "fc", title: "FC is very high — let it drift down", why: `FC ${r.fc} is above your SLAM level. Not dangerous, but hold off on more chlorine and let it fall below ${fcT.slam} before swimming.`, dose: null });
      }
    } else {
      actions.push({ prio: "soon", key: "fc", title: "Test your Free Chlorine", why: "FC is your active sanitizer — test it every couple of days (daily in peak summer).", dose: null });
    }

    // ---- pH ----
    if (has(r.ph)) {
      const fcInterferes = has(r.fc) && r.fc > 10; // high FC makes the pH test read falsely high (TFP)
      if (r.ph > D.RANGES.ph.ideal[1]) {           // above the 7.5–7.8 ideal band
        if (fcInterferes) {
          actions.push({
            prio: "tune", key: "ph", title: "Re-check pH once FC comes down",
            why: `pH reads ${r.ph}, but with FC at ${r.fc} the pH test runs falsely high — hold off on acid. Re-test pH after FC drops below ~10, then dose if it's still high.`,
            dose: null,
          });
        } else {
          const acid = acidForPH(r.ph, 7.6, r.ta || 80, vol, acidPct);
          actions.push({
            prio: r.ph >= D.RANGES.ph.ok[1] ? "soon" : "tune", key: "ph", title: "Bring pH down",
            why: `pH is ${r.ph} (ideal 7.5–7.8). High pH dulls chlorine and invites scale.`,
            dose: acid ? { text: `${fmtFlOz(acid.flOz)} of ${acidPct}% muriatic acid`, sub: `targets pH 7.6 (also drops TA ~${acid.taDrop}). Add ¾ first, circulate, retest.` } : null,
          });
        }
      } else if (r.ph < D.RANGES.ph.ok[0]) {
        const boraxOz = ((7.6 - r.ph) / 0.1) * D.DOSE.boraxOzPer01PHper10k * (vol / 10000);
        actions.push({ prio: "soon", key: "ph", title: "Raise pH", why: `pH is ${r.ph} — low pH is corrosive to plaster &amp; metal.`, dose: { text: `Aerate (free) — or ~${fmtLb(boraxOz / 16)} of borax`, sub: "point returns up / run a fountain to raise pH for free in 1–3 days; borax is the fast option" } });
      } else if (r.ph < D.RANGES.ph.ideal[0]) {
        actions.push({ prio: "tune", key: "ph", title: "Nudge pH up a little", why: `pH is ${r.ph} — fine, but below the 7.5–7.8 sweet spot. Aerate (point returns up / run a fountain) to raise it for free, or add a little borax.`, dose: null });
      }
    }

    // ---- TA ----
    if (has(r.ta)) {
      if (r.ta < D.RANGES.ta.ideal[0]) {
        const add = bakingSodaForTA(D.RANGES.ta.ideal[0] + 10 - r.ta, vol);
        actions.push({ prio: r.ta < D.RANGES.ta.ok[0] ? "soon" : "tune", key: "ta", title: "Nudge TA up", why: `TA is ${r.ta} — ${r.ta < D.RANGES.ta.ok[0] ? "low" : "a little low"}. TA buffers your pH against swings.`, dose: { text: `${fmtLb(add)} of baking soda`, sub: "raises TA toward 60–80" } });
      } else if (r.ta > D.RANGES.ta.ok[1]) {
        actions.push({ prio: "soon", key: "ta", title: "Lower TA (acid + aeration)", why: `TA is ${r.ta} — high TA makes pH climb constantly. Lower pH to ~7.2 with acid, then aerate to bring pH back up while TA stays down. Repeat.`, dose: null });
      } else if (r.ta > D.RANGES.ta.ideal[1]) {
        actions.push({ prio: "tune", key: "ta", title: "Ease TA down (optional)", why: `TA is ${r.ta} — acceptable, but above the 50–90 ideal, so pH may creep up. Optional: drop pH to ~7.2 with acid, then aerate back up to nudge TA toward 80.`, dose: null });
      }
    }

    // ---- CH (plaster only matters) ----
    const chMatters = profile.surface === "plaster" || profile.surface === "pebble" || profile.surface === "tile";
    if (has(r.ch) && chMatters) {
      if (r.ch < D.RANGES.ch.ideal[0]) {
        const add = calciumForCH(D.RANGES.ch.ideal[0] + 20 - r.ch, vol);
        actions.push({ prio: "soon", key: "ch", title: "Add calcium", why: `CH is ${r.ch} — low calcium can dissolve plaster &amp; grout.`, dose: { text: `${fmtLb(add)} of calcium chloride`, sub: "dissolve in a bucket first; add slowly" } });
      } else if (r.ch > D.RANGES.ch.ok[1]) {
        actions.push({ prio: "soon", key: "ch", title: "High calcium — keep it from scaling", why: `CH is ${r.ch}. You can't remove calcium cheaply (hard tap re-adds it). Keep pH &amp; TA on the low side so the water doesn't scale, or use a mobile RO service.`, dose: null });
      } else if (r.ch > D.RANGES.ch.ideal[1]) {
        actions.push({ prio: "tune", key: "ch", title: "Watch calcium (slightly high)", why: `CH is ${r.ch} — acceptable, but above the 250–450 ideal. Keep pH/TA toward the low end so CSI stays balanced and it doesn't scale.`, dose: null });
      }
    }

    // ---- CSI ----
    const csiVal = csi(r, r.temp != null ? r.temp : (profile.tempF || 82));
    if (csiVal != null) {
      if (csiVal > D.RANGES.csi.ok[1]) actions.push({ prio: "soon", key: "csi", title: "Water is scaling (CSI high)", why: `CSI is +${csiVal}. Expect cloudiness &amp; crust. Lower pH and TA to bring it toward 0.`, dose: null, chart: { type: "csi", val: csiVal } });
      else if (csiVal < D.RANGES.csi.ok[0]) actions.push({ prio: "soon", key: "csi", title: "Water is corrosive (CSI low)", why: `CSI is ${csiVal}. It can etch plaster &amp; corrode metal. Raise pH, TA, or CH toward balance.`, dose: null, chart: { type: "csi", val: csiVal } });
      else if (classify("csi", csiVal, profile) === "warn") actions.push({ prio: "tune", key: "csi", title: "Balance is drifting (CSI)", why: `CSI is ${csiVal > 0 ? "+" : ""}${csiVal} — close to balanced but not centered. Nudge pH/TA toward the middle to bring it near 0.`, dose: null, chart: { type: "csi", val: csiVal } });
    }

    // ---- salt (SWG) ----
    if (swg && has(r.salt)) {
      if (r.salt < D.RANGES.salt.ideal[0]) {
        const add = saltToRaise(D.RANGES.salt.ideal[0] + 100 - r.salt, vol);
        actions.push({ prio: r.salt < D.RANGES.salt.ok[0] ? "soon" : "tune", key: "salt", title: "Add salt", why: `Salt is ${r.salt} — ${r.salt < D.RANGES.salt.ok[0] ? "your generator needs more to make chlorine" : "a touch below the 3000–3400 ideal; top it up so the cell runs in its sweet spot"}.`, dose: { text: `${fmtLb(add)} of pool salt`, sub: "dissolves over a few hours with the pump running" } });
      } else if (r.salt > D.RANGES.salt.ok[1]) {
        actions.push({ prio: "soon", key: "salt", title: "Salt is high — dilute a little", why: `Salt is ${r.salt} — above the cell's range; too much can trip a "high salt" fault and corrode metal. Replace some water to bring it toward 3200.`, dose: null });
      } else if (r.salt > D.RANGES.salt.ideal[1]) {
        actions.push({ prio: "tune", key: "salt", title: "Salt is a touch high", why: `Salt is ${r.salt} — just above the 3000–3400 ideal. No action needed; it'll fall with normal water changes.`, dose: null });
      }
    }

    // ---- safety net: every acceptable-but-not-ideal number gets a concrete tweak ----
    // Guarantees the core invariant: health < 100% ALWAYS comes with a to-do, and an empty
    // to-do list ALWAYS means every number is ideal. Catches anything the branches above
    // didn't already cover (e.g. a trace of CC, or a value sitting in the warn band).
    const PN = { fc: "Free Chlorine", cc: "Combined Chlorine", ph: "pH", ta: "Alkalinity", ch: "Calcium (CH)", cya: "CYA", salt: "Salt" };
    const tuneHint = {
      fc: "let it settle into your target band", cc: "a trace usually clears on its own — keep FC at target",
      ph: "nudge it into 7.5–7.8", ta: "ease it toward 50–90", ch: "keep it toward 250–450",
      cya: swg ? "aim for 60–80" : "aim for 30–50", salt: "trim toward 3000–3400",
    };
    const visKeys = ["fc", "cc", "ph", "ta", "cya"].concat(chMatters ? ["ch"] : []).concat(swg ? ["salt"] : []);
    visKeys.forEach((k) => {
      if (!has(r[k]) || actions.some((a) => a.key === k)) return;
      if (classify(k, r[k], profile, r) === "warn") {
        actions.push({ prio: "tune", key: k, title: `Dial in ${PN[k]}`, why: `${PN[k]} is ${r[k]} — acceptable, but not yet ideal. To reach 100%, ${tuneHint[k]}.`, dose: null });
      }
    });

    // Any visible balance number we don't have yet → one gentle "log these" card, so a pool is
    // never called "dialed in 🎉" while tiles are still blank. (fc & cya already prompt above;
    // cc is excluded — an unmeasured CC is conventionally treated as 0, not a gap to chase.)
    const missing = visKeys.filter((k) => k !== "cc" && !has(r[k]) && !actions.some((a) => a.key === k));
    if (missing.length) {
      actions.push({ prio: "tune", key: "untested", title: `Log your ${missing.map((k) => PN[k]).join(", ")}`, why: "These haven't been measured yet — log them so your plan and health score cover every number.", dose: null });
    }

    // ---- nothing left to do? (only when there are no now/soon/tune actions) ----
    const hasToDo = actions.some((a) => a.prio === "now" || a.prio === "soon" || a.prio === "tune");
    if (!hasToDo) {
      actions.unshift({ prio: "ok", key: "ok", title: "Your water is dialed in 🎉", why: "Every number is in its ideal range and your balance (CSI) is centered. Keep testing every couple of days and top up chlorine as it's used.", dose: null });
    }

    // order — 'tune' (the optional path to 100%) sits below the must-dos but above info
    const order = { now: 0, soon: 1, tune: 2, ok: 3, info: 4 };
    actions.sort((a, b) => order[a.prio] - order[b.prio]);
    return { actions, fcTargets: fcT, csi: csiVal };
  }

  /* --------------------- overall health summary ----------------------- */
  function health(profile, reading) {
    const keys = ["fc", "cc", "ph", "ta", "cya"];
    if (profile.surface === "plaster" || profile.surface === "pebble") keys.push("ch");
    if (profile.sanitizer === "salt") keys.push("salt");
    let good = 0, total = 0, worst = "good";
    const rank = { good: 0, warn: 1, bad: 2, unknown: -1 };
    keys.forEach((k) => {
      const v = reading ? reading[k] : null;
      const c = classify(k, v, profile, reading);
      if (c === "unknown") return;
      total++; if (c === "good") good++;
      if (rank[c] > rank[worst]) worst = c;
    });
    const csiVal = csi(reading || {}, (reading && reading.temp != null) ? reading.temp : (profile.tempF || 82));
    let state = "unknown";
    if (total > 0) {
      if (worst === "bad") state = "bad";
      else if (worst === "warn") state = "warn";
      else state = "good";
    }
    return { state, good, total, csi: csiVal };
  }

  /* --------------------- formatting helpers --------------------------- */
  // closest friendly GALLON fraction for a fluid-ounce amount, so every cups/fl-oz
  // liquid dose also shows a jug-relatable gallon measure (¼, ⅓, ½, …). Returns ""
  // when no listed fraction is close enough to be honest (very small splashes).
  function galEquiv(flOz) {
    if (flOz == null || flOz <= 0) return "";
    const g = flOz / 128;
    const fr = [[1, "1"], [0.75, "3/4"], [0.6667, "2/3"], [0.6, "3/5"], [0.5, "1/2"], [0.4, "2/5"], [0.3333, "1/3"], [0.25, "1/4"], [0.2, "1/5"], [0.16667, "1/6"], [0.125, "1/8"], [0.1, "1/10"], [0.08333, "1/12"], [0.0625, "1/16"], [0.041667, "1/24"], [0.03125, "1/32"]];
    let best = fr[0], bd = Infinity;
    for (let i = 0; i < fr.length; i++) { const d = Math.abs(g - fr[i][0]); if (d < bd) { bd = d; best = fr[i]; } }
    if (Math.abs(flOz - best[0] * 128) / flOz > 0.34) return ""; // too far off to be meaningful
    return "≈ " + best[1] + " gal";
  }
  function fmtGal(g) {
    if (!g || g <= 0) return "0";
    if (g < 0.06) { const oz = g * 128; const ge = galEquiv(oz); return Math.round(oz) + " fl oz" + (ge ? " (" + ge + ")" : ""); }
    // round to friendly fraction
    const frac = nearestFraction(g);
    return frac + " gal";
  }
  function nearestFraction(x) {
    const whole = Math.floor(x);
    const rem = x - whole;
    const eighths = Math.round(rem * 8);
    const map = { 0: "", 1: "⅛", 2: "¼", 3: "⅜", 4: "½", 5: "⅝", 6: "¾", 7: "⅞", 8: "" };
    let w = whole + (eighths === 8 ? 1 : 0);
    const fr = map[eighths === 8 ? 0 : eighths];
    if (w === 0 && fr === "") return (Math.round(x * 100) / 100).toString();
    if (w === 0) return fr;
    return w + (fr ? " " + fr : "");
  }
  function fmtFlOz(oz) {
    if (oz == null) return "—";
    if (oz >= 128) return fmtGal(oz / 128);
    const ge = galEquiv(oz);
    if (oz >= 8) { const cups = Math.round((oz / 8) * 4) / 4; return cups + " cup" + (cups === 1 ? "" : "s") + " (" + Math.round(oz) + " oz" + (ge ? ", " + ge : "") + ")"; }
    return Math.round(oz) + " fl oz" + (ge ? " (" + ge + ")" : "");
  }
  function fmtLb(lb) {
    if (lb == null) return "—";
    if (lb < 0.0625) return Math.round(lb * 16) + " oz";
    if (lb < 1) { const oz = lb * 16; return (Math.round(oz * 2) / 2) + " oz"; }
    return (Math.round(lb * 10) / 10) + " lb";
  }
  function fmtVolume(g) { if (!(+g > 0)) return "—"; g = +g; return g >= 1000 ? Math.round(g / 100) / 10 + "k gal" : Math.round(g) + " gal"; }
  // retail "buy this many" hint for liquid chlorine
  function jugs(gal) {
    if (!gal || gal <= 0.05) return "";
    const b = Math.max(1, Math.ceil(gal - 0.04));
    return `≈ ${b} × 1-gal bottle${b > 1 ? "s" : ""}${gal >= 1.8 ? " (or a 2.5-gal jug)" : ""}`;
  }

  if (!Math.log10) Math.log10 = function (x) { return Math.log(x) / Math.LN10; };

  global.CALC = {
    volume, surfaceArea, perimeter, fcTargets, chlorineGallons, fcFromGallons,
    acidForPH, acidForTA, acidFromDemand, sodaAshFromDemand, bakingSodaForTA, calciumForCH, cyaToRaise, saltToRaise,
    dilutionFraction, dilutionCycles, dilutionTable, csi, tempFactor, gpmFromHp,
    classify, meterPos, plan, health,
    fmtGal, fmtFlOz, fmtLb, fmtVolume, nearestFraction, jugs, galEquiv,
  };
})(window);
