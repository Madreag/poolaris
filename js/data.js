/* ============================================================================
   POOLARIS — knowledge & chemistry data layer
   Single source of truth for: the FC/CYA chart, target ranges, dosing
   coefficients (all per 10,000 US gallons unless noted), plain-English
   tooltips, products, glossary, troubleshooting, SLAM steps, learn cards,
   and the user's personalized pool defaults.

   All numbers follow the Trouble Free Pool (TFP) / PoolMath conventions and
   are derived from sanitation chemistry (see pool-knowledge-base.md for the
   derivations & citations).
   ========================================================================== */
(function (global) {
  "use strict";

  /* ---------------- FC / CYA CHART (the cornerstone of TFP) -------------- */
  // For manual / liquid-chlorine ("non-SWG") pools.
  // min = never let FC fall below this. target = day-to-day aim. slam = algae-kill level.
  const FC_CYA_NONSWG = {
    20:  { min: 2, target: [3, 5],  slam: 10 },
    30:  { min: 2, target: [4, 6],  slam: 12 },
    40:  { min: 3, target: [5, 7],  slam: 16 },
    50:  { min: 4, target: [6, 8],  slam: 20 },
    60:  { min: 5, target: [7, 9],  slam: 24 },
    70:  { min: 5, target: [8, 10], slam: 28 },
    80:  { min: 6, target: [9, 11], slam: 31 },
    90:  { min: 7, target: [10, 12],slam: 35 },
    100: { min: 8, target: [11, 13],slam: 39 },
  };
  // For salt-water-generator (SWG) pools — higher CYA, lower FC targets.
  // Verified against the TFP FC/CYA tool's Salt Water table (May 2026). SLAM is
  // the SAME as the non-SWG chart (you turn the SWG off and dose liquid to 40% of CYA).
  const FC_CYA_SWG = {
    20:  { min: 2, target: [3, 5],  slam: 10 },
    30:  { min: 2, target: [3, 6],  slam: 12 },
    40:  { min: 2, target: [3, 7],  slam: 16 },
    50:  { min: 2, target: [3, 8],  slam: 20 },
    60:  { min: 3, target: [4, 9],  slam: 24 },
    70:  { min: 3, target: [5, 10], slam: 28 },
    80:  { min: 4, target: [6, 11], slam: 31 },
    90:  { min: 4, target: [6, 12], slam: 35 },
    100: { min: 5, target: [7, 13], slam: 39 },
  };

  // Verified against the TFP wiki "CYA Chlorine Relationship" (last edited Apr 2026).
  const RATIOS = {
    minPct: 0.075,     // minimum FC ≈ 7.5% of CYA (non-SWG). SWG minimum is 5%.
    minPctSwg: 0.05,   // SWG minimum FC ≈ 5% of CYA
    targetPct: 0.115,  // daily target FC ≈ 11.5% of CYA (chart midpoint-ish)
    slamPct: 0.40,     // SLAM FC ≈ 40% of CYA
    mustardMinPct: 0.15, // mustard/yellow algae minimum ≈ 15% of CYA
    mustardPct: 0.60,  // mustard/yellow algae SLAM ≈ 60% of CYA
  };

  /* ---------------- TARGET RANGES (non-FC parameters) ------------------- */
  // green = ideal band; ok = acceptable; outside = act.
  const RANGES = {
    cc:   { key: "cc",   name: "Combined Chlorine", unit: "ppm", ideal: [0, 0],  ok: [0, 0.5], hardMax: 0.5, decimals: 1 },
    ph:   { key: "ph",   name: "pH",                unit: "",    ideal: [7.5, 7.8], ok: [7.2, 8.0], decimals: 1 },
    ta:   { key: "ta",   name: "Total Alkalinity",  unit: "ppm", ideal: [50, 90],  ok: [50, 120], decimals: 0 },
    ch:   { key: "ch",   name: "Calcium Hardness",  unit: "ppm", ideal: [250, 450], ok: [150, 650], decimals: 0, note: "Plaster/pebble/tile pools. Vinyl & fiberglass: any value < ~650 is fine." },
    cya:  { key: "cya",  name: "Cyanuric Acid",     unit: "ppm", ideal: [30, 50],  ok: [30, 60], decimals: 0, swgIdeal: [60, 80], swgOk: [60, 90] },
    salt: { key: "salt", name: "Salt",              unit: "ppm", ideal: [3000, 3400], ok: [2700, 3600], decimals: 0, note: "Only for salt-water-generator pools — follow your cell's spec." },
    csi:  { key: "csi",  name: "CSI (scale index)", unit: "",    ideal: [-0.3, 0.3], ok: [-0.6, 0.6], decimals: 2 },
  };

  /* ---------------- DOSING COEFFICIENTS (per 10,000 US gallons) ---------- */
  // ppmFCPerGalPer10k: adding 1 US gallon of this strength to 10,000 gal raises FC by N ppm.
  const DOSE = {
    // liquid chlorine / bleach, keyed by trade % (available chlorine)
    liquidChlorine: { "6": 6, "8.25": 8.25, "10": 10, "12.5": 12.5 },
    // ^ chemistry: 1 gal of X% in 10,000 gal raises FC by ~X ppm (X% = % available chlorine).
    cyaOzPer10ppmPer10k: 13.3,      // oz granular stabilizer to raise CYA 10 ppm / 10k gal (0.835 lb)
    bakingSodaLbPer10ppmTAper10k: 1.40, // lb sodium bicarbonate to raise TA 10 ppm / 10k gal
    sodaAshOzFor7to74per10k: 12,       // oz sodium carbonate raises pH 7.0→7.4 (starting-pH dependent)
    boraxOzPer01PHper10k: 13,          // oz borax per +0.1 pH / 10k gal (pH-dependent, approx)
    calciumChlorideLbPer10ppmCHper10k: 1.22, // dihydrate (19.6 oz) to raise CH 10 ppm / 10k gal (anhydrous ≈ 0.93)
    saltLbPerPpmPer10k: 0.0835,        // lb pool salt to raise salinity 1 ppm / 10k gal (50 lb → ~600 ppm)
    // muriatic acid to LOWER total alkalinity: fl oz of 31.45% per 10 ppm TA drop / 10k gal (stoichiometric)
    muriatic31TAozPer10ppmPer10k: 25.6,
    // density-corrected volume scaling for muriatic acid (relative volume vs 31.45%)
    muriaticStrengthFactor: { "31.45": 1, "31": 1.02, "28": 1.14, "20": 1.66, "15": 2.26, "14.5": 2.34 },
    // trichlor: canonical 0.6 ppm CYA per 1 ppm FC; an 8 oz 3" tab ≈ +5.4 FC & +3.3 CYA / 10k gal
    trichlorCYAperFC: 0.6,
    trichlorFCperTab8oz: 5.4,
    trichlorCYAperTab8oz: 3.3,
    // dichlor: raises CYA ~0.9 ppm per 1 ppm FC
    dichlorCYAperFC: 0.9,
    // cal-hypo (73%): +8.75 ppm FC per lb; adds ~6.2 ppm CH per lb / 10k gal
    calhypoFCperLb73: 8.75,
    calhypoCHperLb73: 6.2,
    calhypoFCperLbPerPct: 0.11985, // ppm FC per lb per 1% available chlorine / 10k gal
    calhypoCHperFC: 0.708,         // ppm CH added per ppm FC from cal-hypo
    // boric acid to raise borates: lb per 10 ppm borate / 10k gal (also slightly lowers pH)
    // 4.77 lb/10 ppm ⇒ ~24 lb for a full 50-ppm dose / 10k (PoolMath const 1309.52; label "1 lb → 2 ppm").
    boricAcidLbPer10ppmPer10k: 4.77,
    // Taylor acid/base-DEMAND titration → dose (linear in drops, per 10k gal). From the
    // Taylor treatment tables (K-1005 manual). A "demand" reading is a direct titration of
    // YOUR water, so it's often more accurate than estimating from pH + TA.
    acidDemandFlOz31per10k: 9.16,    // 1 drop ≈ 9.16 fl oz of 31.45% (20°Bé) muriatic / 10k gal
    acidDemandDryAcidOzPer10k: 12.3, // 1 drop ≈ 12.3 oz dry acid (sodium bisulfate 93.2%) / 10k gal
    baseDemandSodaAshOzPer10k: 5.13, // 1 drop ≈ 5.13 oz soda ash (sodium carbonate) / 10k gal
  };

  /* ---------------- PUMP FLOW ESTIMATE (HP → GPM) ---------------------- */
  // Most owners know their pump's horsepower, not its flow. Rough GPM at a TYPICAL
  // residential total dynamic head (~40–60 ft), single-speed / full speed. Mid-range
  // values verified against Pentair/Hayward pump curves & pool-industry references.
  // Caveat: pool-pump HP labels vary (uprated vs full-rated × service factor) and real
  // flow depends on pipe size, filter & head — so it's a ballpark, not a spec.
  const PUMP_GPM_BY_HP = { "0.5": 25, "0.75": 35, "1": 50, "1.5": 65, "2": 80, "2.5": 90, "3": 100 };

  /* ---------------- PARAMETERS (display + tooltips) --------------------- */
  // Friendly, jargon-free explanations. Order = how they appear on the dashboard.
  const PARAMS = [
    {
      key: "fc", name: "Free Chlorine", short: "FC", unit: "ppm",
      tip: {
        what: "The chlorine that's still available to sanitize — your pool's active germ &amp; algae killer.",
        why: "If FC ever hits zero, algae and bacteria take over. The right level depends entirely on your CYA (see below).",
        how: "Raise it by adding liquid chlorine. It's used up by sun and swimmers, so you top it up regularly.",
      },
    },
    {
      key: "cc", name: "Combined Chlorine", short: "CC", unit: "ppm",
      tip: {
        what: "Chlorine that has already reacted with sweat, sunscreen, or algae — \"used-up\" chlorine.",
        why: "That sharp \"chlorine smell\" and stinging eyes? That's CC, not too much chlorine. You want it at 0.",
        how: "If CC is above 0.5, it usually means hidden organics — a SLAM clears it.",
      },
    },
    {
      key: "ph", name: "pH", short: "pH", unit: "",
      tip: {
        what: "How acidic or basic the water is, on a 0–14 scale. 7 is neutral.",
        why: "Too low corrodes metal &amp; etches surfaces; too high causes scale and cloudy water. 7.5–7.8 is the comfort zone.",
        how: "Lower it with muriatic acid. It naturally drifts up over time — that's normal.",
      },
    },
    {
      key: "ta", name: "Total Alkalinity", short: "TA", unit: "ppm",
      tip: {
        what: "A buffer that keeps pH from swinging wildly. Think of it as pH's shock absorber.",
        why: "Too low and pH bounces around; too high and pH keeps climbing and is hard to hold down.",
        how: "Raise with baking soda. Lower with the acid + aeration method.",
      },
    },
    {
      key: "ch", name: "Calcium Hardness", short: "CH", unit: "ppm",
      tip: {
        what: "How much dissolved calcium is in the water.",
        why: "Too low can dissolve plaster &amp; grout; too high (common with hard tap water) causes scale. Doesn't matter much for vinyl/fiberglass.",
        how: "Raise with calcium chloride. You can't remove it chemically — only by swapping water (or reverse osmosis).",
      },
    },
    {
      key: "cya", name: "Cyanuric Acid", short: "CYA", unit: "ppm",
      tip: {
        what: "Stabilizer — it's sunscreen for your chlorine, protecting FC from being burned off by UV.",
        why: "Too little and the sun eats your chlorine by noon. Too much and you need impractically high FC to keep water safe.",
        how: "Raise with stabilizer (slowly). The ONLY way to lower it is to drain &amp; replace water.",
      },
    },
    {
      key: "salt", name: "Salt", short: "Salt", unit: "ppm",
      tip: {
        what: "Dissolved salt — only relevant if you have a salt-water chlorine generator (SWG).",
        why: "Your generator needs salt in a specific range to make chlorine. Too low it won't produce; too high can damage the cell.",
        how: "Raise with pool salt. Lower by replacing water.",
      },
    },
    {
      key: "csi", name: "CSI", short: "CSI", unit: "",
      tip: {
        what: "Calcite Saturation Index — one number that tells you if your water will scale up or eat your surfaces.",
        why: "Negative = corrosive/etching. Positive = scaling/cloudy. Keep it near zero (−0.3 to +0.3).",
        how: "It's calculated from pH, temperature, CH, TA &amp; CYA. The easiest levers are pH and TA.",
      },
    },
  ];

  /* ---------------- POOL SHAPES (for volume wizard) --------------------- */
  const SHAPES = [
    { key: "rectangle", name: "Rectangle", icon: "rectangle", needs: ["a", "w"], desc: "Length &amp; width" },
    { key: "L",         name: "L-shaped",  icon: "L",         needs: ["a", "w", "b", "w2"], desc: "Two rectangles" },
    { key: "oval",      name: "Oval",      icon: "oval",      needs: ["a", "w"], desc: "Length &amp; width" },
    { key: "round",     name: "Round",     icon: "round",     needs: ["d"], desc: "Diameter" },
    { key: "kidney",    name: "Kidney / Freeform", icon: "kidney", needs: ["a", "w"], desc: "Roughly length &amp; width" },
  ];

  /* ---------------- PRODUCTS ------------------------------------------- */
  const PRODUCTS = [
    { kind: "liquid", name: "Liquid chlorine / bleach", role: "Primary sanitizer", adds: "Nothing extra", good: "The TFP daily driver. Zero CYA, zero calcium.", watch: "Degrades in heat — buy fresh, store cool, use within weeks." },
    { kind: "acid",   name: "Muriatic acid", role: "Lowers pH &amp; TA", adds: "—", good: "Cleanest way to bring pH down.", watch: "Strong acid. Add to water, never water to acid. Never mix with chlorine." },
    { kind: "base",   name: "Baking soda (sodium bicarbonate)", role: "Raises TA", adds: "A little pH", good: "Gentle, forgiving.", watch: "Raises TA a lot before it nudges pH." },
    { kind: "cya",    name: "Stabilizer (cyanuric acid)", role: "Raises CYA", adds: "CYA", good: "Protects chlorine from the sun.", watch: "Dissolves slowly (a week). Don't backwash for a few days after adding." },
    { kind: "cal",    name: "Calcium chloride", role: "Raises CH", adds: "Calcium", good: "For low-calcium plaster pools.", watch: "Generates heat dissolving — add slowly to a bucket." },
    { kind: "salt",   name: "Pool salt (NaCl)", role: "Feeds SWG", adds: "Salt", good: "For salt systems.", watch: "Use pure salt; takes hours to dissolve." },
    { kind: "puck",   name: "Trichlor tablets / pucks", role: "Slow-release chlorine", adds: "CYA + acid", good: "Convenient for a week away.", watch: "Every puck raises CYA. The #1 cause of the high-CYA trap — not for daily use in the sun." },
  ];

  /* ---------------- SAFETY RULES --------------------------------------- */
  const SAFETY = [
    "Never mix two pool chemicals together — especially trichlor + cal-hypo (can catch fire or explode).",
    "Never mix acid and chlorine. Add them to the pool separately, at different spots, with the pump running.",
    "Always add acid TO water, never water to acid.",
    "Never put chlorine tablets in the skimmer — the acidic water corrodes your pump &amp; heater.",
    "Add chemicals one at a time, retest, and wait before the next. Store them apart, cool and dry.",
    "Wear gloves &amp; eye protection. Dose outdoors, pour low and slow over a return jet.",
  ];

  /* ---------------- TROUBLESHOOTING ----------------------------------- */
  const TROUBLE = [
    { sym: "Water is green / cloudy green", cause: "Algae bloom — chlorine has been too low.", fix: "Run a SLAM: hold FC at your CYA's SLAM level, brush &amp; filter until the 3 exit tests pass.", icon: "slam" },
    { sym: "Water is cloudy / hazy white", cause: "Often high pH/CSI (scaling) or fine dead algae that needs filtering — sometimes low FC.", fix: "Check pH &amp; CSI; if scaling, lower pH/TA. If after a SLAM, keep filtering &amp; brushing — it clears.", icon: "droplet" },
    { sym: "Strong chlorine smell, stings eyes", cause: "Combined chlorine (CC), not too much chlorine.", fix: "Counter-intuitively, you need MORE chlorine — a SLAM burns off the CC.", icon: "beaker" },
    { sym: "Chlorine won't hold / disappears", cause: "Algae, organics, or CYA so high your FC is effectively too weak.", fix: "Test CYA. SLAM if algae. If CYA is very high, dilute it down first.", icon: "clock" },
    { sym: "pH keeps climbing", cause: "Normal — aeration, new plaster, and SWGs push pH up.", fix: "Just dose acid when it passes ~7.8. Don't chase it constantly.", icon: "arrow" },
    { sym: "Yellow/mustard dust on walls", cause: "Mustard algae — stubborn, hides from chlorine.", fix: "SLAM at the higher mustard level (~60% of CYA), brush every surface, clean anything that touched the water.", icon: "warn" },
    { sym: "Black spots in plaster", cause: "Black algae rooted in the surface.", fix: "Brush hard (even with a stainless brush), keep FC at SLAM level, treat spots directly.", icon: "warn" },
    { sym: "Scale / white crust at waterline", cause: "High CSI from hard water + high pH/TA.", fix: "Lower pH &amp; TA to bring CSI down; you can't remove the calcium itself cheaply.", icon: "target" },
    { sym: "Rust / blue-green / brown stains", cause: "Metals (iron/copper) in the water, not always organic.", fix: "Test before treating. A vitamin-C (ascorbic acid) rub that lifts the stain confirms metal; use a sequestrant.", icon: "info" },
  ];

  /* ---------------- SLAM STEPS ---------------------------------------- */
  const SLAM_STEPS = [
    { t: "Test &amp; set the stage", d: "Test CYA and pH. If CYA is very high (&gt;~90), dilute it down first — otherwise SLAM FC is impractical. Set pH to ~7.2 (you won't test pH again until the SLAM is done; high FC makes it read false-high)." },
    { t: "Raise FC to SLAM level", d: "Add liquid chlorine to hit the SLAM FC for your CYA. Poolaris calculates the exact gallons." },
    { t: "Brush &amp; filter", d: "Brush all surfaces to suspend algae. Run the pump &amp; filter 24/7. Clean/backwash the filter whenever pressure climbs ~25% over clean." },
    { t: "Test &amp; top up — often", d: "Test FC as often as you can (several times a day for green water) and add chlorine back up to SLAM level each time. Never let it drift down." },
    { t: "Run the overnight test (OCLT)", d: "When the water looks clear, test FC at dusk and again at dawn (no sun, no swimmers). A loss under 1 ppm means the algae is dead." },
    { t: "Confirm all 3 exit tests", d: "You're done only when ALL pass: CC ≤ 0.5, overnight FC loss &lt; 1 ppm, and the water is crystal clear. Then let FC drift back to your normal target." },
  ];

  /* ---------------- TIPS ---------------------------------------------- */
  const TIPS = [
    "The #1 rule: never let FC drop below the minimum for your CYA. Everything else is secondary.",
    "Test before you dose — guessing leads to overshooting.",
    "Add chlorine after sunset so the sun doesn't burn it off before it works.",
    "Don't chase pH. Let it ride up toward 7.8 and only knock it down with acid when it passes.",
    "Stop using trichlor pucks as your daily chlorine — they're why CYA creeps up and traps you.",
    "Pool-store water tests &amp; \"shock\" advice often lead to upsells. Trust your own FAS-DPD drops.",
    "Cyanuric acid never leaves on its own — the only way down is replacing water.",
    "Keep a log. Trends tell you far more than any single reading.",
    "Balance order: get CYA &amp; FC right first, then pH, then TA &amp; CH.",
    "Borates (30–50 ppm) are nice insurance against algae and help steady pH.",
  ];

  /* ---------------- GLOSSARY ------------------------------------------ */
  const GLOSSARY = [
    ["FC", "Free Chlorine — chlorine available to sanitize right now."],
    ["CC", "Combined Chlorine — spent chlorine; the source of \"pool smell.\" Target 0."],
    ["TC", "Total Chlorine = FC + CC."],
    ["CYA", "Cyanuric Acid / stabilizer — sunscreen for chlorine."],
    ["TA", "Total Alkalinity — pH's buffer / shock absorber."],
    ["CH", "Calcium Hardness — dissolved calcium."],
    ["CSI", "Calcite Saturation Index — scaling vs. corrosive balance."],
    ["SLAM", "Shock Level And Maintain — the TFP process to kill algae."],
    ["OCLT", "Overnight Chlorine Loss Test — proves algae is dead."],
    ["SWG", "Salt Water Generator — makes chlorine from salt."],
    ["FAS-DPD", "The accurate drop-based chlorine test (vs. unreliable strips)."],
    ["ppm", "Parts per million — the unit for most pool measurements."],
    ["Turnover", "Time for the pump to circulate the whole pool's volume once."],
  ];

  /* ---------------- Default example pool ------------------------------- */
  // A neutral, generic example so a fresh install shows sensible placeholders. The moment
  // the user completes setup, their own profile replaces this — nothing here is personal.
  const USER_DEFAULTS = {
    name: "My Pool",
    shape: "rectangle",
    dims: { a: 32, w: 16 }, // ~512 ft²
    avgDepth: 5,
    volume: 19000,
    climate: "temperate",
    surface: "plaster",
    sanitizer: "liquid",
    filter: "cartridge",
    chlorinePct: "10",
    acidPct: "31.45",
    region: "",
    notes: "",
    // typical balanced starting values, shown as estimates until a real test is logged
    seedReading: { fc: 4, cc: 0, ph: 7.6, ta: 80, ch: 300, cya: 40 },
  };

  global.DATA = {
    FC_CYA_NONSWG, FC_CYA_SWG, RATIOS, RANGES, DOSE, PUMP_GPM_BY_HP, PARAMS, SHAPES,
    PRODUCTS, SAFETY, TROUBLE, SLAM_STEPS, TIPS, GLOSSARY, USER_DEFAULTS,
  };
})(window);
