# 🌊 Poolaris Pool Knowledge Base

*A complete, plain-English reference for keeping a pool crystal-clear the **Trouble Free Pool (TFP)** way.*

This file is the canonical rulebook behind the **Poolaris** web app (`index.html`). Every target,
formula, and dosing number here has been cross-checked against the official TFP wiki, the PoolMath
tool, Taylor Technologies, and first-principles chemistry. All volumes are **US gallons**; dosing
figures are **per 10,000 US gallons** unless stated otherwise.

> **The one idea that matters most:** In a stabilized (outdoor) pool there is *no single right
> chlorine number*. The correct Free Chlorine (FC) level is set by your Cyanuric Acid (CYA). Keep FC
> in the right band for your CYA and **never let it fall below the minimum** — do that and algae
> simply cannot take hold. Everything else is fine-tuning.

---

## Table of contents

1. [The TFP philosophy](#1-the-tfp-philosophy)
2. [Quick-reference target ranges](#2-quick-reference-target-ranges)
3. [Your 7 numbers, explained](#3-your-7-numbers-explained)
4. [The FC/CYA relationship (the cornerstone)](#4-the-fccya-relationship-the-cornerstone)
5. [Dosing & chemistry math](#5-dosing--chemistry-math)
6. [Water balance & CSI](#6-water-balance--csi)
7. [The SLAM process (killing algae)](#7-the-slam-process-killing-algae)
8. [Raising & lowering each parameter](#8-raising--lowering-each-parameter)
9. [Troubleshooting guide](#9-troubleshooting-guide)
10. [Chemicals, products & safety](#10-chemicals-products--safety)
11. [Testing & equipment](#11-testing--equipment)
12. [Circulation & filtration](#12-circulation--filtration)
13. [Desert / hard-water playbook (Arizona)](#13-desert--hard-water-playbook-arizona)
14. [Seasonal notes](#14-seasonal-notes)
15. [Pro tips & common mistakes](#15-pro-tips--common-mistakes)
16. [Glossary](#16-glossary)
17. [Sources](#17-sources)
18. [Sources](#18-sources)

---

## 1. The TFP philosophy

The Trouble Free Pool method replaces guesswork and pool-store upsells with a simple, science-based loop:

1. **Test** your own water with accurate **drop-based (FAS-DPD)** reagents — not strips, not the pool store.
2. **Keep Free Chlorine** in the right band for your CYA, **always**.
3. **Balance** pH, then Total Alkalinity and Calcium, so the water neither scales nor corrodes (CSI near zero).
4. **Use liquid chlorine** (or a salt-water generator) as your daily sanitizer so you don't secretly drive CYA up.

That's it. No "weekly shock," no mystery bottles, no algaecides-as-a-crutch. A pool run this way costs
less, stays clearer, and almost never has problems.

**Why it works:** Chlorine is the sanitizer. CYA shields chlorine from sunlight but also "holds" most of
it in reserve, leaving only a tiny active fraction (hypochlorous acid, HOCl). Keeping FC proportional to
CYA holds that active fraction roughly constant (~0.02 ppm HOCl) at every CYA level — enough to sanitize,
never enough to be harsh.

---

## 2. Quick-reference target ranges

| Parameter | Ideal | Acceptable | Notes |
|---|---|---|---|
| **FC** (Free Chlorine) | *Set by CYA — see §4* | Never below the CYA minimum | The only number you adjust constantly |
| **CC** (Combined Chlorine) | 0 | ≤ 0.5 ppm | Above 0.5 → SLAM |
| **pH** | 7.5 – 7.8 | 7.2 – 8.0 | Drifts up naturally; don't chase it |
| **TA** (Total Alkalinity) | 50 – 90 ppm | 50 – 120 ppm | SWG / aerated pools sit lower (~50–70) |
| **CH** (Calcium Hardness) | 250 – 450 ppm (plaster) | 150 – 650 ppm | Not critical for vinyl / fiberglass |
| **CYA** (Stabilizer) | 30 – 50 (liquid) · 60 – 80 (SWG) | up to 60 / 90 | Indoor pools 20–30 |
| **Salt** | per cell spec (~3000–3400) | 2700 – 3600 | Salt-generator pools only |
| **CSI** | −0.3 to +0.3 | −0.6 to +0.6 | Negative = corrosive, positive = scaling |

---

## 3. Your 7 numbers, explained

### Free Chlorine (FC)
The chlorine still available to sanitize — your active germ & algae killer. If FC hits **zero**, algae and
bacteria win. The right level depends on CYA (see §4). You raise it with liquid chlorine; sun and swimmers
use it up, so you top it up regularly.

### Combined Chlorine (CC)
Chlorine that has already reacted with sweat, sunscreen, oils, or algae — "used-up" chlorine. That sharp
"chlorine smell" and stinging eyes are **CC, not too much chlorine**. Target **0**; above 0.5 means hidden
organics and calls for a SLAM.

### pH
How acidic/basic the water is (0–14, 7 is neutral). Too low corrodes metal and etches plaster; too high
causes scale and cloudiness. Keep **7.5–7.8**. It naturally drifts **up** from aeration and liquid chlorine —
that's normal; nudge it down with muriatic acid when it passes ~7.8.

### Total Alkalinity (TA)
A buffer that keeps pH from swinging — pH's shock absorber. Too low and pH bounces; too high and pH keeps
climbing and is hard to hold down. Raise with baking soda; lower with the acid-and-aeration method.

### Calcium Hardness (CH)
Dissolved calcium. Too low can dissolve plaster and grout; too high (common with hard tap water) causes
scale. **Doesn't matter for vinyl or fiberglass.** Raise with calcium chloride; you can't remove it
chemically — only by replacing water or reverse osmosis.

### Cyanuric Acid (CYA)
Stabilizer — **sunscreen for chlorine**. It protects FC from UV. Too little and the sun burns your chlorine
off by noon; too much and you need impractically high FC to sanitize. Raise with stabilizer (slowly); the
**only** way to lower it is to replace water.

### Salt
Only relevant with a salt-water generator (SWG). The cell needs salt in a set range to make chlorine; too
low it won't produce, too high can damage the cell. Raise with pool salt; lower by replacing water.

---

## 4. The FC/CYA relationship (the cornerstone)

CYA is sunscreen for chlorine — but it also *holds onto* chlorine, so the more CYA you have, the more FC you
need for the same killing power. That's why there is no single "right" chlorine number.

**The ratio rules (from the TFP wiki, verified):**

| Level | Ratio to CYA | Meaning |
|---|---|---|
| **Minimum FC** (non-SWG) | **7.5% of CYA** | Never go below this |
| **Minimum FC** (SWG) | **5% of CYA** | Salt pools can run lower |
| **Target FC** | **~11.5% of CYA** | Day-to-day aim |
| **Mustard/yellow-algae minimum** | 15% of CYA | If you've had mustard algae |
| **SLAM FC** | **40% of CYA** | The algae-killing level you *hold* |
| **Mustard/yellow-algae SLAM** | **60% of CYA** | Stubborn algae |

### The official FC/CYA chart — liquid chlorine / manual (non-SWG)

| CYA (ppm) | Minimum FC | Target FC | SLAM FC |
|---:|---:|---:|---:|
| 20 | 2 | 3–5 | 10 |
| 30 | 2 | 4–6 | 12 |
| 40 | 3 | 5–7 | 16 |
| 50 | 4 | 6–8 | 20 |
| 60 | 5 | 7–9 | 24 |
| 70 | 5 | 8–10 | 28 |
| 80 | 6 | 9–11 | 31 |
| 90 | 7 | 10–12 | 35 |
| 100 | 8 | 11–13 | 39 |

### The FC/CYA chart — salt-water generator (SWG)

| CYA (ppm) | Minimum FC | Target FC | SLAM FC |
|---:|---:|---:|---:|
| 60 | 3 | 4–9 | 24 |
| 70 | 3 | 5–10 | 28 |
| 80 | 4 | 6–11 | 31 |
| 90 | 4 | 6–12 | 35 |
| 100 | 5 | 7–13 | 39 |

**Key facts**
- FC anywhere up to **SLAM level is safe** for swimmers, pets, the pool, and equipment.
- Above ~**90–100 CYA**, the required FC becomes impractical/expensive — fix high CYA by **diluting** (§8), not by chasing FC.
- Recommended CYA: **30–50** for liquid chlorine, **60–80** for SWG, **20–30** indoors. In a hot, sunny
  climate, the upper end (50–70) protects chlorine from the sun.

---

## 5. Dosing & chemistry math

All coefficients below are **per 10,000 US gallons**. To scale to your pool, multiply by
`(your gallons ÷ 10,000)`. Doses are estimates — **add about ¾, circulate, and re-test** before adding more.

### Chlorine (raise FC)
For sodium-hypochlorite liquid chlorine, the ppm of FC added by **1 gallon in 10,000 gallons equals the
trade percentage** (because trade % *is* the available-chlorine concentration):

| Strength | FC raised per gallon / 10k gal | To raise +1 ppm / 10k gal |
|---|---:|---:|
| 6% (household) | +6 ppm | 21.3 fl oz |
| 8.25% (bleach) | +8.25 ppm | 15.5 fl oz |
| 10% (pool-store) | +10 ppm | 12.8 fl oz |
| 12.5% (commercial) | +12.5 ppm | 10.2 fl oz |

> Example (this pool ≈ 14,000 gal, 10%): to raise FC by 8 ppm → `8 × 1.4 ÷ 10 = 1.12 gallons`.

### Acid (lower pH) — *starting-pH dependent*
Muriatic acid neutralizes the carbonate buffer, so the acid needed per 0.1 pH drop depends on **both TA and
your starting pH** (buffering is stronger near 7.5, so the same drop costs ~2× more acid there than at 7.8).

| Start pH | 31.45% muriatic per −0.1 pH (TA 80 / 100 / 120), per 10k gal |
|---|---|
| ~7.8 | 1.9 / 2.4 / 2.9 fl oz |
| ~7.5 | 3.5 / 4.4 / 5.3 fl oz |

Lowering pH also lowers TA. **Acid to lower TA directly:** `25.6 fl oz of 31.45% muriatic per −10 ppm TA / 10k gal.`

**Acid strength volume multipliers** (density-corrected, relative to 31.45%): 31% = 1.02×, 28% = 1.14×,
20% = 1.66×, 15% = 2.26×, 14.5% = 2.34×.

### Dry chemicals

| Goal | Product | Dose per 10k gal |
|---|---|---|
| Raise **TA** +10 ppm | Baking soda (sodium bicarbonate) | **1.40 lb** (22.4 oz) |
| Raise **CYA** +10 ppm | Granular stabilizer (cyanuric acid) | **13.3 oz** (0.835 lb) |
| Raise **CH** +10 ppm | Calcium chloride — dihydrate (77%) | **~19.6 oz** (anhydrous ≈ 14.8 oz) |
| Raise **Salt** +10 ppm | Pool salt (NaCl) | **0.835 lb** (50 lb → ~600 ppm) |
| Raise **pH** | Borax | ~13 oz per +0.1 pH (pH-dependent) |
| Raise **pH** | Soda ash (sodium carbonate) | ~12 oz raises 7.0→7.4 (also raises TA) |
| Raise **Borates** +10 ppm | Boric acid | **~4.8 lb** (≈ 24 lb for a full 50-ppm dose; also nudges pH down) |
| Lower **TA** −10 ppm | Muriatic 31.45% + aeration | **25.6 fl oz** (add in rounds; aerate pH back up) |

### Tablets (what they add)
- **Trichlor** (3" tab, ~8 oz): **+5.4 ppm FC and +3.3 ppm CYA** per 10k gal — i.e. **0.6 ppm CYA per 1 ppm FC**.
  This CYA never leaves; it's why tablet pools creep into the high-CYA trap.
- **Dichlor**: adds **~0.9 ppm CYA per 1 ppm FC.**
- **Cal-hypo** (73%): **+8.75 ppm FC** and **~6.2 ppm CH** per lb / 10k gal. Adds calcium, not CYA.

### Reading a cheaper (OTO) kit — Total Chlorine & demand tests

Basic kits report different numbers, but they're still usable:

- **Total Chlorine (TC).** An OTO ("yellow") chlorine test gives a *single* number, which is **TC = FC + CC**,
  **not** Free Chlorine — the #1 beginner mix-up. If you also measured FC, then **CC = TC − FC**. If TC is all
  you have, treat it as FC (a healthy pool has CC ≈ 0); if TC reads unexpectedly high, the gap *is* combined
  chlorine — an early algae signal worth a SLAM.
- **Acid Demand / Base Demand.** These aren't water *states* like pH or FC — they're a titration that hands you
  the dose directly. You add reagent drops to the pH sample until it reaches the target color, then convert the
  drop count with the Taylor treatment tables (linear in drops, per 10,000 gal):

  | Test | 1 drop adds, per 10k gal | Notes |
  |---|---|---|
  | **Acid demand** | **9.16 fl oz of 31.45% (20° Baumé) muriatic** (≈ 12.3 oz dry acid) | Lowers pH to target; also lowers TA |
  | **Base demand** | **5.13 oz soda ash (sodium carbonate)** | Raises pH to target; also raises TA a little |

  Because a demand test titrates **your** actual water, it's often **more accurate than estimating from pH + TA**.
  Poolaris accepts both paths: enter TC in the log (it derives FC/CC), or enter drop counts in the **Lower-pH** /
  **Raise-pH** calculators for a dose read straight from your pool.

---

## 6. Water balance & CSI

The **Calcite Saturation Index (CSI)** rolls pH, temperature, calcium, alkalinity, CYA (and borates) into a
single number telling you whether water will **scale** (deposit calcium — cloudy, crust) or **corrode**
(etch plaster, dissolve grout, corrode metal).

- **Ideal: −0.3 to +0.3.** Acceptable: −0.6 to +0.6.
- Interpretation: ≤ −0.6 corroding · −0.6…−0.3 potentially corrosive · −0.3…+0.3 **balanced** · +0.3…+0.6 potentially scaling · ≥ +0.6 scaling.
- **CSI moves 1:1 with pH** — a 0.2 rise in pH raises CSI by 0.2. The easiest levers are **pH and TA**; you
  rarely need to touch calcium.
- New plaster (first 2–3 weeks of a 28-day cure) deliberately runs CSI **≥ +0.5**.
- Don't chase CSI to two decimals — test-kit error is about **±0.14**.

**The exact PoolMath/TFP formula** (used by Poolaris):

```
CarbAlk  = TA − (0.38772·CYA)/(1 + 10^(6.83−pH)) − (4.63·Borate)/(1 + 10^(9.11−pH))
extra_NaCl = max(0, Salt − 1.1678·CH)
I        = (1.5·CH + TA)/50045 + extra_NaCl/58440
T_c      = (T_°F − 32)·5/9
CSI      = pH − 11.677 + log10(CH) + log10(CarbAlk)
           − (2.56·√I)/(1 + 1.65·√I) − 1412.5/(T_c + 273.15) + 4.7375
```
*(CH and CarbAlk in ppm as CaCO₃; set Borate = 0 if not dosed. Sanity check: pH 7.5, TA 70, CH 350,
CYA 50, salt 1000, 80 °F → CSI = −0.18.)*

---

## 7. The SLAM process (killing algae)

**SLAM = Shock Level And Maintain.** Not a one-time "shock" — you raise FC to **40% of your CYA** and
*hold it there*, brushing and filtering, until the algae is dead and oxidized.

**When to SLAM:** visible algae (green/cloudy), CC > 0.5, FC won't hold, or after a pump/neglect failure.

**Steps**
1. **Prep.** Test CYA & pH. If CYA is very high (> ~90), **dilute it down first** — otherwise SLAM FC is
   impractical. Lower pH to ~7.2 (you won't re-test pH until done; high FC reads pH false-high).
2. **Raise FC to SLAM level** for your CYA with liquid chlorine.
3. **Brush & filter.** Brush all surfaces; run the pump/filter **24/7**; clean/backwash the filter when
   pressure climbs ~25% over its clean baseline.
4. **Test & top up — often.** Test FC as often as practical (several times a day for green water) and add
   chlorine back to SLAM level each time. **Never let it drift down.**
5. **Run the Overnight Chlorine Loss Test (OCLT).** When the water looks clear, test FC at **dusk** and
   again at **dawn** (no sun, no swimmers).
6. **Exit when ALL THREE pass:**
   - **CC ≤ 0.5 ppm**
   - **Overnight FC loss < 1 ppm**
   - **Water is crystal clear**

   Then stop dosing high and let FC drift down to your normal target.

**Algae variants**
- **Mustard/yellow:** stubborn, hides from chlorine. SLAM at the **higher 60%-of-CYA** level, brush every
  surface, and clean anything that touched the water (toys, nets, swimsuits).
- **Black algae:** rooted in plaster. Brush hard (even a stainless brush), keep FC at SLAM level, treat spots directly.

---

## 8. Raising & lowering each parameter

| Parameter | To **raise** | To **lower** |
|---|---|---|
| **FC** | Add liquid chlorine | Let sunlight/time burn it off, or dilute |
| **pH** | Aerate (point returns up), or borax / soda ash | Muriatic acid, poured slowly over a return |
| **TA** | Baking soda | **Acid + aeration:** lower pH to ~7.0–7.2 with acid, then aerate to raise pH back while TA stays low; repeat |
| **CH** | Calcium chloride (dissolve in a bucket first) | Can't be removed chemically — replace water or use reverse osmosis |
| **CYA** | Stabilizer in a sock in the skimmer (dissolves ~1 week; don't backwash for a few days) | **Only by dilution** — drain & refill, or RO |
| **Salt** | Pool salt | Replace water |

### The CYA / dilution math
CYA never evaporates or breaks down — it only leaves with the water. Replace a fraction of the water and CYA
drops by that same fraction:

```
new CYA = old CYA × (1 − fraction replaced)
fraction to replace to reach target T from A = 1 − T/A
```
Draining **1 foot** from a pool of average depth *D* feet replaces `1/D` of the water (a 5-ft-average pool →
20% per foot). Each 20% cycle keeps 80% of the CYA: 100 → 80 → 64 → 51 → 41 → 33…

> **Tip:** Drain the old water *first*, then refill. Topping off and letting it overflow mixes fresh water in
> before you remove it, so it's less efficient per gallon.

---

## 9. Troubleshooting guide

| You see… | Likely cause | The fix |
|---|---|---|
| Green / cloudy-green water | Algae — FC was too low | **SLAM** (§7) |
| Cloudy / hazy white | High pH/CSI (scaling) or fine dead algae needing filtration; sometimes low FC | Check pH & CSI; if scaling, lower pH/TA; after a SLAM keep filtering & brushing |
| Strong chlorine smell, stinging eyes | Combined chlorine (CC) — *not* too much chlorine | Add **more** chlorine; a SLAM burns off the CC |
| FC won't hold / disappears | Algae, organics, or CYA so high FC is effectively weak | Test CYA; SLAM if algae; if CYA very high, dilute first |
| pH keeps climbing | Normal — aeration, new plaster, SWG | Dose acid when it passes ~7.8; don't chase it |
| Yellow/mustard dust on walls | Mustard algae | SLAM at 60%-of-CYA; brush; clean everything that touched the water |
| Black spots in plaster | Black algae | Brush hard, hold SLAM FC, treat spots |
| White crust at the waterline | Scale — high CSI from hard water + high pH/TA | Lower pH & TA |
| Rust / blue-green / brown stains | Metals (iron/copper), not always organic | Test first; a vitamin-C (ascorbic acid) rub that lifts the stain confirms metal — use a sequestrant |
| "Chlorine lock" (per pool stores) | **Myth** | There's no such thing; it's high CYA. Dilute CYA, hold correct FC |

---

## 10. Chemicals, products & safety

| Product | Does | Adds | Watch out |
|---|---|---|---|
| **Liquid chlorine / bleach** | Primary sanitizer | nothing | Degrades in heat — buy fresh, store cool, use within weeks |
| **Muriatic acid** | Lowers pH & TA | — | Strong acid; never mix with chlorine |
| **Baking soda** | Raises TA | a little pH | Raises TA a lot before nudging pH |
| **Stabilizer (CYA)** | Raises CYA | CYA | Dissolves slowly; don't backwash for a few days |
| **Calcium chloride** | Raises CH | calcium | Generates heat — add to a bucket first |
| **Pool salt** | Feeds SWG | salt | Use pure salt; dissolves over hours |
| **Trichlor tablets** | Slow-release chlorine | **CYA + acid** | Every puck raises CYA; not for daily use in the sun |
| **Cal-hypo** | Granular shock | calcium | Adds CH; never mix with trichlor |
| **Polyquat 60** | Algaecide (insurance) | — | Use copper-free algaecides only |

### ⚠️ Safety — non-negotiable
- **Never mix two pool chemicals** — especially **trichlor + cal-hypo** (can ignite or explode).
- **Never mix acid and chlorine** — add them to the pool separately, at different spots, pump running.
- Always add **acid to water, never water to acid.**
- **Never put tablets in the skimmer** — the acidic water corrodes your pump & heater.
- Add chemicals one at a time, re-test, and wait. Store them apart, cool and dry.
- Wear gloves & eye protection; dose outdoors, pour low and slow over a return jet.

---

## 11. Testing & equipment

Test strips and pool-store tests are too vague for the FC/CYA method. Use a **FAS-DPD drop kit** — it reads
chlorine precisely, even at SLAM levels, by counting drops (each drop = 0.5 ppm with a 10 mL sample, or
0.2 ppm with 25 mL).

**Recommended kits**
- **Taylor K-2006C** — the "C" = larger FAS-DPD reagent bottles.
- **TF-100 / TF-Pro / TF-50** (TroubleFreePool's own kits) — same Taylor reagents, better value, includes the
  SpeedStir on the Pro.

**Key reagents:** R-0870 powder + R-0871 (FAS-DPD titrant) + R-0003 for FC/CC; R-0013 for the CYA turbidity
test; acid/base reagents for pH; and the calcium/alkalinity titrants.

**The CYA test:** mix a 50/50 sample with R-0013, then slowly fill the view tube until the black dot just
disappears, reading at eye level, outdoors, with your back to the sun. For very high CYA, dilute the sample
50/50 with tap water and **double** the result.

**Cheap 6-in-1 reagent kits** (e.g. "Lupo") can do pH and a rough chlorine read, but their **CYA and
high-range chlorine** tests are weak — fine as a stopgap, not for managing a SLAM or a precise CYA dilution.

**Got an OTO / basic kit?** Its single chlorine number is **Total Chlorine** (FC + CC) — enter it in Poolaris's
*Total Chlorine* box and it splits out your combined chlorine automatically. Many basic kits (e.g. the Taylor
K-1000 / K-1003) also include **acid-demand** and **base-demand** tests: drop-count titrations that tell you
exactly how much acid or soda ash *your* water needs (conversions in §5). That's a genuinely useful capability
of the cheap kits — use the drop count in the Lower-pH / Raise-pH calculators.

---

## 12. Circulation & filtration

Your pump and filter do half the work — distributing chemicals and physically removing dead algae.

- **Run time:** enough to keep water clear and chemicals mixed — often **6–12 hrs/day**; during a SLAM, **24/7**.
  Variable-speed pumps save a lot of energy running longer at low speed.
- **Don't know your flow (GPM)?** Estimate it from your pump's **horsepower** at a typical residential head
  (~40–60 ft): **½ HP ≈ 25 · ¾ HP ≈ 35 · 1 HP ≈ 50 · 1½ HP ≈ 65 · 2 HP ≈ 80 · 2½ HP ≈ 90 · 3 HP ≈ 100 GPM.**
  It's a ballpark — pool-pump HP labels are inconsistent (uprated vs full-rated × service factor), and real flow
  depends on pipe size, filter, and head. Variable-speed pumps run slower day-to-day, so their circulation GPM is
  often far lower (you simply run more hours for the same turnover). Turnover ≈ `volume ÷ (GPM × 60)` hours.
- **Backwash on *pressure*, not a schedule** — when the gauge rises ~25% (≈ 8–10 PSI) over its clean baseline.
- **Filter types:**
  - **Sand** — backwash to clean; you can add a little DE to polish.
  - **Cartridge** — no backwash; hose off the element.
  - **D.E.** — backwash, then **re-add ~80% of a full DE charge** each time (a full charge ≈ 1 lb per ~5 ft²
    of grid area). For a heavy algae load, vacuum-to-waste first so you don't instantly clog the grids.
- **Brushing** suspends algae and debris so the filter and chlorine can finish them.

---

## 13. Desert / hard-water playbook (Arizona)

Hot, sunny, hard-water regions have their own rules:

- **Run CYA a bit higher (50–70)** so the brutal sun doesn't strip your chlorine by noon.
- **Dose liquid chlorine after sundown**, roughly **daily** in peak summer.
- **Ditch trichlor tablets as your daily chlorine.** Each tab adds CYA that never leaves; years of tablets is
  the #1 cause of the high-CYA trap that forces a drain. Use trichlor only as a *vacation backup*, and stop
  the moment CYA reaches ~50–60.
- **Calcium scale** from hard tap can't be removed cheaply (a drain just refills with hard water). Manage it
  by keeping **pH/TA on the low side (CSI near 0)**, filtering fill water, or using a **mobile reverse-osmosis
  (RO)** service for a true reset of CH/CYA/TDS.
- **Constant evaporation** concentrates CYA, calcium, and salt — expect to dilute CYA and manage hardness
  over time.
- **TDS** (total dissolved solids) is mostly a distraction — it's just the sum of everything else. Track CYA,
  CH, and CSI instead; fixing those fixes the TDS that mattered.

**The trichlor trap, in numbers:** roughly 1 trichlor puck/week in a 14k-gal pool maintains chlorine but adds
~2 ppm CYA/week (~8–10 ppm/month). Over months it climbs past 50 → 80 → 120+, weakening your chlorine until a
"green pool that won't clear" forces a drain. Liquid chlorine adds **zero** CYA and breaks the cycle.

---

## 14. Seasonal notes

- **Opening:** clear & circulate, then test and balance CYA & FC first, then pH/TA/CH. Expect to SLAM if it
  wintered uncovered or green.
- **Peak summer (hot climates):** highest chlorine demand — dose daily after sunset, keep CYA at the upper end,
  watch for evaporation concentrating everything.
- **Fall:** leaves raise organic load and chlorine demand; skim and brush often.
- **Winter (mild climates):** demand drops sharply — switch to liquid only (don't add CYA), keep FC above
  minimum, run the pump less but enough to avoid stagnation.

---

## 15. Pro tips & common mistakes

- **The #1 rule:** never let FC drop below the minimum for your CYA. Everything else is secondary.
- **Test before you dose** — guessing leads to overshooting.
- **Dose chlorine after sunset** so the sun doesn't burn it off before it works.
- **Don't chase pH** — let it ride toward 7.8 and only knock it down with acid when it passes.
- **Stop using trichlor as your daily chlorine** — it's why CYA creeps up and traps you.
- **Don't trust pool-store testing or "shock" upsells** — trust your own FAS-DPD drops.
- **Don't add chemicals you didn't test for.**
- **Add acid and chlorine separately**, never together.
- **CYA never leaves on its own** — the only way down is replacing water.
- **Calcium can't be removed chemically** — manage scale via CSI, not "reducers."
- **Borates (30–50 ppm)** are nice insurance against algae and help steady pH.
- **Keep a log** — trends tell you far more than any single reading.
- **Balance order:** CYA & FC first, then pH, then TA & CH, then confirm CSI.

---

## 16. Glossary

| Term | Meaning |
|---|---|
| **FC** | Free Chlorine — chlorine available to sanitize now |
| **CC** | Combined Chlorine — spent chlorine; source of "pool smell." Target 0 |
| **TC** | Total Chlorine = FC + CC |
| **CYA** | Cyanuric Acid / stabilizer — sunscreen for chlorine |
| **TA** | Total Alkalinity — pH's buffer |
| **CH** | Calcium Hardness — dissolved calcium |
| **CSI** | Calcite Saturation Index — scaling vs. corrosive balance |
| **SLAM** | Shock Level And Maintain — the TFP algae-kill process |
| **OCLT** | Overnight Chlorine Loss Test — proves algae is dead |
| **SWG** | Salt Water Generator — makes chlorine from salt |
| **FAS-DPD** | The accurate drop-based chlorine test |
| **OTO** | Orthotolidine — the cheap "yellow" chlorine test; reads **Total Chlorine**, not FC |
| **Acid / Base Demand** | A drop-count titration measuring how much acid (or base) to add to reach target pH |
| **ppm** | Parts per million — the unit for most measurements |
| **Turnover** | Time for the pump to circulate the whole pool once |
| **TDS** | Total Dissolved Solids — the sum of everything dissolved |

---

## 17. Sources

- **Trouble Free Pool wiki** — *CYA/Chlorine Relationship*, *Recommended Levels*, *CSI and LSI*, *SLAM*,
  *Recommended Pool Chemicals* (troublefreepool.com/wiki).
- **PoolMath** — TFP's dosing tool and FC/CYA chart (troublefreepool.com/blog).
- **Taylor Technologies** — reagent and calcium-hardness guidance, and the **acid/base-demand treatment
  tables** (K-1005 instruction manual).
- **Orenda Technologies** — CSI/LSI and pH science.
- First-principles chemistry for every dosing coefficient (stoichiometry & carbonate-equilibrium modeling),
  cross-checked against PoolMath and thepoolnerd calculators.

*All targets and formulas verified against the above as of May 2026. Doses are estimates — add ~¾, circulate,
and re-test before adding more.*
