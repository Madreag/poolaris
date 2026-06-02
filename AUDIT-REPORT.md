# Poolaris — Dashboard Consistency Fix & Exhaustive E2E Audit

_Audit run: 2026-06-01. All chemistry/UI logic exercised against the real browser engines (`data.js` + `calc.js` + `insights.js`) and the live app in headless Edge. No production data touched — every run used an isolated server, DB, and file-mode store._

## TL;DR

- **The dashboard's self-contradiction is fixed at the root.** There is now a single source of truth: the X/Y "numbers ideal" count, the health orb, the appbar pill, and the visible tiles all agree, and **"100% / dialed in" happens if and only if the to-do list is empty.**
- **If the water isn't perfect, the app now always tells you exactly what to do to reach 100%** — every acceptable-but-not-ideal number produces a concrete "Dial in to 100%" tweak with a calculated dose.
- **Both originally reported bugs are fixed** (pH 8.0 → no recommendation; no "I'm lowering pH" activity).
- **71,885 checks executed, all passing:** 71,400 chemistry-logic cases + 198 targeted scenario/edge cases + 56 per-persona browser route-checks + 231 render-safety route-checks.
- **The audit found and fixed 4 latent crashes/NaN bugs** the reported issue had been masking (see §4).

## 1. The two originally reported bugs

| # | Report | Root cause | Fix | Verified |
|---|--------|-----------|-----|----------|
| 1 | "I had a pH of 8 and no recommendation" | `plan()` only acted on pH **above 8.0** (`> ok[1]`); 8.0 sat exactly on the boundary and fell through. | pH now acts above the **ideal** ceiling 7.8, with graduated urgency and a guard for when high FC makes the pH test read falsely high. | pH 8.0 → "Bring pH down — 1.5 cups (12 oz) of 31.45% muriatic acid" (This week). |
| 2 | "No way to tell it I'm lowering pH (adding acid)" | No such activity existed in the context layer. | Added a "Lowering pH (acid)" activity + auto-detection (pH falling) + a quick-chip, and an engine alert-suppression mapping. | Activity present in `activities.js`; engine suppression in `engine.py`. |

## 2. The root-cause fix: one model for health, recommendations & counts

The dashboard contradicted itself in two ways. Both are now structurally impossible:

**(a) Two different counts ("5/6" vs "5/7").** The health score counted CSI as a 7th item, but the grid only shows 6 tiles. `insights.js health()` now **excludes CSI from the X/Y count** (CSI still shapes the score and state) so the count equals the visible tiles — proven below: plaster pool → **/6**, salt pool → **/7**, vinyl → **/5**, always matching the grid.

**(b) Health < 100% with an empty to-do list.** Partial-credit health dropped below 100 for "acceptable" numbers, but `plan()` produced no action for them — so the app said "you're not perfect" while showing nothing to do. `plan()` now has a **`tune` tier**: every number that is acceptable-but-not-ideal (and CSI drift, and untested numbers) yields a concrete "Dial in to 100%" recommendation. The "dialed in 🎉" hero fires **only** when there are no now/soon/tune actions.

**The invariant, now enforced and exhaustively verified:**

```
health.state === "good"  ⟺  health.score === 100  ⟺  zero to-do items  ⟺  "dialed in 🎉"
every number classified warn/bad  ⟹  a matching recommendation exists
the X/Y count  ===  the number of visible tiles for that pool type
```

## 3. Invariants checked on every one of the 71,400 logic cases

- **I0** — plan() never throws; every action has a valid priority (now/soon/tune/ok/info); actions are sorted; no NaN/undefined/Infinity in any title, reason, or dose
- **I1** — health.total === number of visible tiles; health.good === number classified ideal; score within 0–100; valid state
- **I2** — every visible number that is warn/bad has a matching action; no action nags about an already-ideal number
- **I3** — CSI warn/bad ⟹ a CSI action; CSI ideal ⟹ no CSI action
- **I4** — dialed-in (no now/soon/tune) ⟺ health.state === good
- **I5** — dialed-in ⟺ health.score === 100
- **I7** — the 🎉 card exists iff dialed-in and sorts first
- **I8** — at most one action per visible number
- **I9** — health and plan agree on CSI

## 4. Bugs the audit discovered and fixed (beyond the reported ones)

These were latent crashes/NaN that real users could hit with edge inputs; the exhaustive sweep surfaced them:

| Bug | Trigger | Symptom | Fix |
|-----|---------|---------|-----|
| CSI = −Infinity | CH or TA entered as 0 / blank-coerced-to-0 | `log10(0)` leaked "CSI is -Infinity" into advice; **Python `chem.py` actually raised**, which would crash the 24/7 engine's CSI path | `csi()` (both JS & Python) returns null for non-positive pH/CH/TA |
| Chart NaN coordinates | Any dose computed before volume is known (TA/CH/CYA/Salt calculators) | 100+ `<rect y="NaN">` SVG errors | `charts.js bars()` coerces every value to a finite number |
| SLAM page NaN | Brand-new pool (no readings) → SLAM page | "~NaN lb of cal-hypo" (the `x != null` test passes NaN through) | guard with `!isNaN` + volume fallback |
| "NaN gal" volume | Incomplete profile reaching the plan/calculators | `fmtVolume(undefined)` → "NaN gal"; calculators' `|| p.volume` had no final fallback | `fmtVolume` null-safe; calculators fall back to 14,000 gal |

## 5. Test campaign — results

| Suite | What it does | Cases | Result |
|-------|--------------|------:|--------|
| Chemistry-logic sweep | Cartesian product of FC×pH×TA×CYA×CH×CC×Salt across 6 pool personas, 9 invariants each | 71,400 | ✅ 71400/71,400 pass |
| Scenario & edge cases | reported bugs, partial/blank readings, garbage & out-of-range input, decimals, temperature sweep, SWG-vs-non-SWG | 198 | ✅ 198/198 pass |
| Per-persona browser render | fresh Edge per persona; every route + every calculator tab; console errors / NaN | 56 | ✅ 56/56 pass |
| Render-safety sweep | every route + 18 calculators across 7 seeded states | 231 | ✅ 231/231 pass |
| Golden cross-check | `chem.py` (server) numerically equals `calc.js` (browser) | 70 | ✅ all pass |

**Logic sweep per persona** (tiles = the X/Y denominator for that pool type):

| Persona | Cases | Tiles | Failures |
|---------|------:|------:|---------:|
| plaster+liquid | 10,500 | 6 | 0 |
| plaster+salt | 31,500 | 7 | 0 |
| pebble+liquid | 10,500 | 6 | 0 |
| tile+liquid | 10,500 | 6 | 0 |
| vinyl+liquid | 2,100 | 5 | 0 |
| fiberglass+salt | 6,300 | 6 | 0 |

## 6. Per-persona browser evidence

Each persona booted in a fresh headless-Edge profile with seeded data; the hero + health pill prove the count matches the tiles and that "dialed in" only appears when truly perfect:

| Persona | Hero | Health pill | Routes OK |
|---------|------|-------------|----------:|
| perfect (every number ideal) | Your water is dialed in. 🎉 | Looking great · 6/6 | 8/8 |
| tune-only (all acceptable, some not ideal) | Looking good — just fine-tuning. | Needs a tweak · 4/6 | 8/8 |
| messy (many out of range) | Here's your pool, right now. | Needs attention · 0/6 | 8/8 |
| ph-high (pH 8.0 (the reported bug)) | Here's your pool, right now. | Needs a tweak · 5/6 | 8/8 |
| salt-low (salt pool, salt low + CYA salt-ideal) | Here's your pool, right now. | Needs attention · 5/7 | 8/8 |
| vinyl (vinyl (no CH tile)) | Your water is dialed in. 🎉 | Looking great · 5/5 | 8/8 |
| fresh (brand new (onboarding)) | Welcome to your pool. 🏊 | — | 8/8 |

Screenshots of each persona's dashboard and plan page are in `__showcaseshots/`.

## 7. Files changed

- `js/calc.js` — plan(): tune tier + every-non-ideal-number-gets-an-action + untested-number prompt + ordering; csi() guards non-positive inputs; fmtVolume() null-safe
- `js/insights.js` — health(): CSI excluded from the X/Y count (still in score/state)
- `js/app.js` — dashboard 'Dial in to 100%' section + perfect gate; plan page 3-state; live previews + action card support tune; SLAM NaN guards; calculator volume fallbacks
- `js/charts.js` — bars(): coerce every value to finite — never emit NaN coordinates
- `js/engage.js` — isPerfect(): require an empty to-do list (single source of truth with the dashboard)
- `styles.css` — styling for the new 'tune' priority (cards, number badge, timing chip)
- `chem.py` — csi(): mirror the non-positive-input guard (prevents an engine crash)

## 8. How to reproduce

```bash
# numeric contract (browser engine == server engine)
python test_chem.py
# exhaustive chemistry/UI-logic invariants (writes __audit_logic_detail.txt)
node __audit_logic.js
# targeted scenarios + edge cases
node __audit_scenarios.js
# per-page browser render audit (needs the isolated server running)
node __showcase.js
```

## Appendix A — every scenario & edge case (198, one per line)

```
#1 [A:pH-bug] pH 8.0 FC 3 → acid rec :: PASS — soon:Bring pH down
#2 [A:pH-bug] pH 8.0 FC 5 → acid rec :: PASS — soon:Bring pH down
#3 [A:pH-bug] pH 8.0 FC 8 → acid rec :: PASS — soon:Bring pH down
#4 [A:pH-bug] pH 8.0 FC 10 → acid rec :: PASS — soon:Bring pH down
#5 [A:pH-bug] pH 8.0 FC 14 → re-check (tune, no acid yet) :: PASS — tune:Re-check pH once FC comes down
#6 [A:pH-bug] pH 8.4 → soon :: PASS — soon
#7 [A:pH-bug] pH 7.6 → no pH action :: PASS
#8 [A:pH-bug] pH 7.3 → tune nudge up :: PASS — tune:Nudge pH up a little
#9 [A:pH-bug] pH 7.0 → soon raise :: PASS — soon:Raise pH
#10 [B:activity] activities.js defines 'lowering-ph' :: PASS
#11 [B:activity] lowering-ph has a detection prompt :: PASS
#12 [B:activity] engine maps lowering-ph → suppress ph alert :: PASS
#13 [C:partial] empty {} → no crash :: PASS
#14 [C:partial] empty {} → not 'dialed in' :: PASS — soon:cya soon:fc tune:untested
#15 [C:partial] only fc → no crash :: PASS
#16 [C:partial] only fc → not 'dialed in' :: PASS — soon:cya tune:untested
#17 [C:partial] only ph → no crash :: PASS
#18 [C:partial] only ph → not 'dialed in' :: PASS — soon:cya soon:fc tune:untested
#19 [C:partial] fc+ph → no crash :: PASS
#20 [C:partial] fc+ph → not 'dialed in' :: PASS — soon:cya tune:untested
#21 [C:partial] all but ch → no crash :: PASS
#22 [C:partial] all but ch → not 'dialed in' :: PASS — tune:untested
#23 [C:partial] all but ta → no crash :: PASS
#24 [C:partial] all but ta → not 'dialed in' :: PASS — tune:untested
#25 [C:partial] health([]) → no crash, total 0 :: PASS — {"score":null,"good":0,"total":0,"state":"unknown","csi":null,"trendDir":"steady"}
#26 [D:garbage] fc=-100 → clean plan :: PASS
#27 [D:garbage] classify fc=-100 → valid label :: PASS — bad
#28 [D:garbage] fc=-1 → clean plan :: PASS
#29 [D:garbage] classify fc=-1 → valid label :: PASS — bad
#30 [D:garbage] fc=0 → clean plan :: PASS
#31 [D:garbage] classify fc=0 → valid label :: PASS — bad
#32 [D:garbage] fc=0.0001 → clean plan :: PASS
#33 [D:garbage] classify fc=0.0001 → valid label :: PASS — bad
#34 [D:garbage] fc=7.55 → clean plan :: PASS
#35 [D:garbage] classify fc=7.55 → valid label :: PASS — good
#36 [D:garbage] fc=99999 → clean plan :: PASS
#37 [D:garbage] classify fc=99999 → valid label :: PASS — warn
#38 [D:garbage] fc=NaN → clean plan :: PASS
#39 [D:garbage] classify fc=NaN → valid label :: PASS — unknown
#40 [D:garbage] fc=null → clean plan :: PASS
#41 [D:garbage] classify fc=null → valid label :: PASS — unknown
#42 [D:garbage] fc=undefined → clean plan :: PASS
#43 [D:garbage] classify fc=undefined → valid label :: PASS — unknown
#44 [D:garbage] fc= → clean plan :: PASS
#45 [D:garbage] classify fc= → valid label :: PASS — unknown
#46 [D:garbage] fc=abc → clean plan :: PASS
#47 [D:garbage] classify fc=abc → valid label :: PASS — unknown
#48 [D:garbage] ph=-100 → clean plan :: PASS
#49 [D:garbage] classify ph=-100 → valid label :: PASS — bad
#50 [D:garbage] ph=-1 → clean plan :: PASS
#51 [D:garbage] classify ph=-1 → valid label :: PASS — bad
#52 [D:garbage] ph=0 → clean plan :: PASS
#53 [D:garbage] classify ph=0 → valid label :: PASS — bad
#54 [D:garbage] ph=0.0001 → clean plan :: PASS
#55 [D:garbage] classify ph=0.0001 → valid label :: PASS — bad
#56 [D:garbage] ph=7.55 → clean plan :: PASS
#57 [D:garbage] classify ph=7.55 → valid label :: PASS — good
#58 [D:garbage] ph=99999 → clean plan :: PASS
#59 [D:garbage] classify ph=99999 → valid label :: PASS — bad
#60 [D:garbage] ph=NaN → clean plan :: PASS
#61 [D:garbage] classify ph=NaN → valid label :: PASS — unknown
#62 [D:garbage] ph=null → clean plan :: PASS
#63 [D:garbage] classify ph=null → valid label :: PASS — unknown
#64 [D:garbage] ph=undefined → clean plan :: PASS
#65 [D:garbage] classify ph=undefined → valid label :: PASS — unknown
#66 [D:garbage] ph= → clean plan :: PASS
#67 [D:garbage] classify ph= → valid label :: PASS — unknown
#68 [D:garbage] ph=abc → clean plan :: PASS
#69 [D:garbage] classify ph=abc → valid label :: PASS — unknown
#70 [D:garbage] ta=-100 → clean plan :: PASS
#71 [D:garbage] classify ta=-100 → valid label :: PASS — bad
#72 [D:garbage] ta=-1 → clean plan :: PASS
#73 [D:garbage] classify ta=-1 → valid label :: PASS — bad
#74 [D:garbage] ta=0 → clean plan :: PASS
#75 [D:garbage] classify ta=0 → valid label :: PASS — bad
#76 [D:garbage] ta=0.0001 → clean plan :: PASS
#77 [D:garbage] classify ta=0.0001 → valid label :: PASS — bad
#78 [D:garbage] ta=7.55 → clean plan :: PASS
#79 [D:garbage] classify ta=7.55 → valid label :: PASS — bad
#80 [D:garbage] ta=99999 → clean plan :: PASS
#81 [D:garbage] classify ta=99999 → valid label :: PASS — bad
#82 [D:garbage] ta=NaN → clean plan :: PASS
#83 [D:garbage] classify ta=NaN → valid label :: PASS — unknown
#84 [D:garbage] ta=null → clean plan :: PASS
#85 [D:garbage] classify ta=null → valid label :: PASS — unknown
#86 [D:garbage] ta=undefined → clean plan :: PASS
#87 [D:garbage] classify ta=undefined → valid label :: PASS — unknown
#88 [D:garbage] ta= → clean plan :: PASS
#89 [D:garbage] classify ta= → valid label :: PASS — unknown
#90 [D:garbage] ta=abc → clean plan :: PASS
#91 [D:garbage] classify ta=abc → valid label :: PASS — unknown
#92 [D:garbage] cya=-100 → clean plan :: PASS
#93 [D:garbage] classify cya=-100 → valid label :: PASS — bad
#94 [D:garbage] cya=-1 → clean plan :: PASS
#95 [D:garbage] classify cya=-1 → valid label :: PASS — bad
#96 [D:garbage] cya=0 → clean plan :: PASS
#97 [D:garbage] classify cya=0 → valid label :: PASS — bad
#98 [D:garbage] cya=0.0001 → clean plan :: PASS
#99 [D:garbage] classify cya=0.0001 → valid label :: PASS — bad
#100 [D:garbage] cya=7.55 → clean plan :: PASS
#101 [D:garbage] classify cya=7.55 → valid label :: PASS — bad
#102 [D:garbage] cya=99999 → clean plan :: PASS
#103 [D:garbage] classify cya=99999 → valid label :: PASS — bad
#104 [D:garbage] cya=NaN → clean plan :: PASS
#105 [D:garbage] classify cya=NaN → valid label :: PASS — unknown
#106 [D:garbage] cya=null → clean plan :: PASS
#107 [D:garbage] classify cya=null → valid label :: PASS — unknown
#108 [D:garbage] cya=undefined → clean plan :: PASS
#109 [D:garbage] classify cya=undefined → valid label :: PASS — unknown
#110 [D:garbage] cya= → clean plan :: PASS
#111 [D:garbage] classify cya= → valid label :: PASS — unknown
#112 [D:garbage] cya=abc → clean plan :: PASS
#113 [D:garbage] classify cya=abc → valid label :: PASS — unknown
#114 [D:garbage] ch=-100 → clean plan :: PASS
#115 [D:garbage] classify ch=-100 → valid label :: PASS — bad
#116 [D:garbage] ch=-1 → clean plan :: PASS
#117 [D:garbage] classify ch=-1 → valid label :: PASS — bad
#118 [D:garbage] ch=0 → clean plan :: PASS
#119 [D:garbage] classify ch=0 → valid label :: PASS — bad
#120 [D:garbage] ch=0.0001 → clean plan :: PASS
#121 [D:garbage] classify ch=0.0001 → valid label :: PASS — bad
#122 [D:garbage] ch=7.55 → clean plan :: PASS
#123 [D:garbage] classify ch=7.55 → valid label :: PASS — bad
#124 [D:garbage] ch=99999 → clean plan :: PASS
#125 [D:garbage] classify ch=99999 → valid label :: PASS — bad
#126 [D:garbage] ch=NaN → clean plan :: PASS
#127 [D:garbage] classify ch=NaN → valid label :: PASS — unknown
#128 [D:garbage] ch=null → clean plan :: PASS
#129 [D:garbage] classify ch=null → valid label :: PASS — unknown
#130 [D:garbage] ch=undefined → clean plan :: PASS
#131 [D:garbage] classify ch=undefined → valid label :: PASS — unknown
#132 [D:garbage] ch= → clean plan :: PASS
#133 [D:garbage] classify ch= → valid label :: PASS — unknown
#134 [D:garbage] ch=abc → clean plan :: PASS
#135 [D:garbage] classify ch=abc → valid label :: PASS — unknown
#136 [D:garbage] cc=-100 → clean plan :: PASS
#137 [D:garbage] classify cc=-100 → valid label :: PASS — good
#138 [D:garbage] cc=-1 → clean plan :: PASS
#139 [D:garbage] classify cc=-1 → valid label :: PASS — good
#140 [D:garbage] cc=0 → clean plan :: PASS
#141 [D:garbage] classify cc=0 → valid label :: PASS — good
#142 [D:garbage] cc=0.0001 → clean plan :: PASS
#143 [D:garbage] classify cc=0.0001 → valid label :: PASS — warn
#144 [D:garbage] cc=7.55 → clean plan :: PASS
#145 [D:garbage] classify cc=7.55 → valid label :: PASS — bad
#146 [D:garbage] cc=99999 → clean plan :: PASS
#147 [D:garbage] classify cc=99999 → valid label :: PASS — bad
#148 [D:garbage] cc=NaN → clean plan :: PASS
#149 [D:garbage] classify cc=NaN → valid label :: PASS — unknown
#150 [D:garbage] cc=null → clean plan :: PASS
#151 [D:garbage] classify cc=null → valid label :: PASS — unknown
#152 [D:garbage] cc=undefined → clean plan :: PASS
#153 [D:garbage] classify cc=undefined → valid label :: PASS — unknown
#154 [D:garbage] cc= → clean plan :: PASS
#155 [D:garbage] classify cc= → valid label :: PASS — unknown
#156 [D:garbage] cc=abc → clean plan :: PASS
#157 [D:garbage] classify cc=abc → valid label :: PASS — unknown
#158 [D:garbage] salt=-100 → clean plan :: PASS
#159 [D:garbage] classify salt=-100 → valid label :: PASS — bad
#160 [D:garbage] salt=-1 → clean plan :: PASS
#161 [D:garbage] classify salt=-1 → valid label :: PASS — bad
#162 [D:garbage] salt=0 → clean plan :: PASS
#163 [D:garbage] classify salt=0 → valid label :: PASS — bad
#164 [D:garbage] salt=0.0001 → clean plan :: PASS
#165 [D:garbage] classify salt=0.0001 → valid label :: PASS — bad
#166 [D:garbage] salt=7.55 → clean plan :: PASS
#167 [D:garbage] classify salt=7.55 → valid label :: PASS — bad
#168 [D:garbage] salt=99999 → clean plan :: PASS
#169 [D:garbage] classify salt=99999 → valid label :: PASS — bad
#170 [D:garbage] salt=NaN → clean plan :: PASS
#171 [D:garbage] classify salt=NaN → valid label :: PASS — unknown
#172 [D:garbage] salt=null → clean plan :: PASS
#173 [D:garbage] classify salt=null → valid label :: PASS — unknown
#174 [D:garbage] salt=undefined → clean plan :: PASS
#175 [D:garbage] classify salt=undefined → valid label :: PASS — unknown
#176 [D:garbage] salt= → clean plan :: PASS
#177 [D:garbage] classify salt= → valid label :: PASS — unknown
#178 [D:garbage] salt=abc → clean plan :: PASS
#179 [D:garbage] classify salt=abc → valid label :: PASS — unknown
#180 [E:csi-temp] csi @ 33°F finite :: PASS — -0.58
#181 [E:csi-temp] csi @ 50°F finite :: PASS — -0.41
#182 [E:csi-temp] csi @ 60°F finite :: PASS — -0.31
#183 [E:csi-temp] csi @ 70°F finite :: PASS — -0.22
#184 [E:csi-temp] csi @ 80°F finite :: PASS — -0.13
#185 [E:csi-temp] csi @ 90°F finite :: PASS — -0.04
#186 [E:csi-temp] csi @ 100°F finite :: PASS — 0.04
#187 [E:csi-temp] csi @ 115°F finite :: PASS — 0.16
#188 [E:csi-temp] csi(100°F) > csi(50°F) :: PASS — -0.27 -> 0.18
#189 [F:swg] CYA 70 liquid → has action (too high) :: PASS — soon:Lower your CYA by replacing water
#190 [F:swg] CYA 70 salt → NO action (ideal) :: PASS
#191 [F:swg] classify CYA 70 liquid=warn/bad :: PASS — bad
#192 [F:swg] classify CYA 70 salt=good :: PASS — good
#193 [F:swg] salt 2500 (low) salt-pool → add salt :: PASS
#194 [F:swg] salt ignored for liquid pool :: PASS
#195 [G:to100] TA 100 → tune action exists :: PASS — Ease TA down (optional)
#196 [G:to100] TA 100 → NOT dialed in :: PASS
#197 [G:to100] TA 100 → health < 100 (so the tweak is justified) :: PASS — score=96
#198 [G:to100] ideal water → dialed in + ok card + score 100 :: PASS — score=100 ok=true
```

## Appendix B — chemistry-logic cases (representative 1-in-35 sample of the 71,400 executed; full enumeration in `__audit_logic_detail.txt`)

```
#1 [plaster+liquid] fc=0,cc=0,ph=7,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=21 bad csi=-1.32 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#36 [plaster+liquid] fc=0,cc=0.6,ph=7,ta=40,cya=70,ch=400,temp=85 :: H 1/6 score=8 bad csi=-1.07 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi] | PASS
#71 [plaster+liquid] fc=0,cc=0,ph=7,ta=60,cya=50,ch=150,temp=85 :: H 3/6 score=46 bad csi=-1.19 | A[now:fc soon:ph soon:ch soon:csi] | PASS
#106 [plaster+liquid] fc=0,cc=0.6,ph=7,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=21 bad csi=-0.58 | A[now:cc now:fc soon:cya soon:ph tune:csi] | PASS
#141 [plaster+liquid] fc=0,cc=0,ph=7,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=29 bad csi=-1.1 | A[now:fc soon:cya soon:ph soon:ch soon:csi] | PASS
#176 [plaster+liquid] fc=0,cc=0.6,ph=7,ta=100,cya=50,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.51 | A[now:cc now:fc soon:ph tune:ta tune:csi] | PASS
#211 [plaster+liquid] fc=0,cc=0,ph=7,ta=130,cya=40,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.79 | A[now:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#246 [plaster+liquid] fc=0,cc=0.6,ph=7,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=-0.42 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#281 [plaster+liquid] fc=0,cc=0,ph=7.4,ta=40,cya=70,ch=150,temp=85 :: H 1/6 score=29 bad csi=-1.2 | A[now:fc soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#316 [plaster+liquid] fc=0,cc=0.6,ph=7.4,ta=60,cya=40,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.37 | A[now:cc now:fc tune:ph tune:csi] | PASS
#351 [plaster+liquid] fc=0,cc=0,ph=7.4,ta=80,cya=20,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.6 | A[now:fc soon:cya soon:ch tune:ph tune:csi] | PASS
#386 [plaster+liquid] fc=0,cc=0.6,ph=7.4,ta=80,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.28 | A[now:cc now:fc soon:cya tune:ph] | PASS
#421 [plaster+liquid] fc=0,cc=0,ph=7.4,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=54 bad csi=-0.55 | A[now:fc soon:ch tune:ph tune:ta tune:csi] | PASS
#456 [plaster+liquid] fc=0,cc=0.6,ph=7.4,ta=130,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.04 | A[now:cc now:fc soon:cya soon:ta tune:ph] | PASS
#491 [plaster+liquid] fc=0,cc=0,ph=7.4,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=33 bad csi=-0.46 | A[now:fc soon:cya soon:ta soon:ch tune:ph tune:csi] | PASS
#526 [plaster+liquid] fc=0,cc=0.6,ph=7.6,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.48 | A[now:cc now:fc soon:ta tune:csi] | PASS
#561 [plaster+liquid] fc=0,cc=0,ph=7.6,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=67 bad csi=-0.6 | A[now:fc soon:ch tune:csi] | PASS
#596 [plaster+liquid] fc=0,cc=0.6,ph=7.6,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=38 bad csi=-0.37 | A[now:cc now:fc soon:cya tune:csi] | PASS
#631 [plaster+liquid] fc=0,cc=0,ph=7.6,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.52 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#666 [plaster+liquid] fc=0,cc=0.6,ph=7.6,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.08 | A[now:cc now:fc tune:ta] | PASS
#701 [plaster+liquid] fc=0,cc=0,ph=7.6,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.18 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#736 [plaster+liquid] fc=0,cc=0.6,ph=7.6,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.17 | A[now:cc now:fc soon:cya soon:ta] | PASS
#771 [plaster+liquid] fc=0,cc=0,ph=7.8,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=-0.72 | A[now:fc soon:ta soon:ch soon:csi] | PASS
#806 [plaster+liquid] fc=0,cc=0.6,ph=7.8,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=42 bad csi=0.07 | A[now:cc now:fc soon:cya] | PASS
#841 [plaster+liquid] fc=0,cc=0,ph=7.8,ta=60,cya=90,ch=150,temp=85 :: H 3/6 score=46 bad csi=-0.62 | A[now:fc soon:cya soon:ch soon:csi] | PASS
#876 [plaster+liquid] fc=0,cc=0.6,ph=7.8,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=58 bad csi=0.14 | A[now:cc now:fc] | PASS
#911 [plaster+liquid] fc=0,cc=0,ph=7.8,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.14 | A[now:fc soon:ch tune:ta] | PASS
#946 [plaster+liquid] fc=0,cc=0.6,ph=7.8,ta=100,cya=90,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.18 | A[now:cc now:fc soon:cya tune:ta] | PASS
#981 [plaster+liquid] fc=0,cc=0,ph=7.8,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.05 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#1016 [plaster+liquid] fc=0,cc=0.6,ph=8,ta=40,cya=40,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.04 | A[now:cc now:fc soon:ph soon:ta] | PASS
#1051 [plaster+liquid] fc=0,cc=0,ph=8,ta=60,cya=20,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.15 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#1086 [plaster+liquid] fc=0,cc=0.6,ph=8,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.09 | A[now:cc now:fc soon:cya soon:ph] | PASS
#1121 [plaster+liquid] fc=0,cc=0,ph=8,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.08 | A[now:fc soon:ph soon:ch] | PASS
#1156 [plaster+liquid] fc=0,cc=0.6,ph=8,ta=100,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.51 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#1191 [plaster+liquid] fc=0,cc=0,ph=8,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.05 | A[now:fc soon:cya soon:ph soon:ch tune:ta] | PASS
#1226 [plaster+liquid] fc=0,cc=0.6,ph=8,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.59 | A[now:cc now:fc soon:ph soon:ta tune:csi] | PASS
#1261 [plaster+liquid] fc=0,cc=0,ph=8.3,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.17 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#1296 [plaster+liquid] fc=0,cc=0.6,ph=8.3,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=-0.35 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#1331 [plaster+liquid] fc=0,cc=0,ph=8.3,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.04 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#1366 [plaster+liquid] fc=0,cc=0.6,ph=8.3,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=33 bad csi=0.66 | A[now:cc now:fc soon:ph soon:csi] | PASS
#1401 [plaster+liquid] fc=0,cc=0,ph=8.3,ta=100,cya=20,ch=150,temp=85 :: H 1/6 score=29 bad csi=0.39 | A[now:fc soon:cya soon:ph soon:ch tune:ta tune:csi] | PASS
#1436 [plaster+liquid] fc=0,cc=0.6,ph=8.3,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=13 bad csi=0.71 | A[now:cc now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#1471 [plaster+liquid] fc=0,cc=0,ph=8.3,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=42 bad csi=0.47 | A[now:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#1506 [plaster+liquid] fc=2,cc=0.6,ph=7,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=21 bad csi=-0.9 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi] | PASS
#1541 [plaster+liquid] fc=2,cc=0,ph=7,ta=40,cya=90,ch=150,temp=85 :: H 1/6 score=21 bad csi=-1.59 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#1576 [plaster+liquid] fc=2,cc=0.6,ph=7,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=33 bad csi=-0.77 | A[now:cc now:fc soon:ph soon:csi] | PASS
#1611 [plaster+liquid] fc=2,cc=0,ph=7,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=46 bad csi=-1.02 | A[now:fc soon:ph soon:ch soon:csi] | PASS
#1646 [plaster+liquid] fc=2,cc=0.6,ph=7,ta=80,cya=90,ch=400,temp=85 :: H 2/6 score=17 bad csi=-0.68 | A[now:cc now:fc soon:cya soon:ph soon:csi] | PASS
#1681 [plaster+liquid] fc=2,cc=0,ph=7,ta=100,cya=70,ch=150,temp=85 :: H 1/6 score=25 bad csi=-0.95 | A[now:fc soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#1716 [plaster+liquid] fc=2,cc=0.6,ph=7,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.37 | A[now:cc now:fc soon:ph soon:ta tune:csi] | PASS
#1751 [plaster+liquid] fc=2,cc=0,ph=7.4,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.94 | A[soon:cya soon:fc soon:ta soon:ch soon:csi tune:ph] | PASS
#1786 [plaster+liquid] fc=2,cc=0.6,ph=7.4,ta=40,cya=70,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.78 | A[now:cc now:fc soon:cya soon:ta soon:csi tune:ph] | PASS
#1821 [plaster+liquid] fc=2,cc=0,ph=7.4,ta=60,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=-0.82 | A[now:fc soon:ch soon:csi tune:ph] | PASS
#1856 [plaster+liquid] fc=2,cc=0.6,ph=7.4,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.18 | A[now:cc soon:cya soon:fc tune:ph] | PASS
#1891 [plaster+liquid] fc=2,cc=0,ph=7.4,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.75 | A[now:fc soon:cya soon:ch soon:csi tune:ph] | PASS
#1926 [plaster+liquid] fc=2,cc=0.6,ph=7.4,ta=100,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.13 | A[now:cc now:fc tune:ph tune:ta] | PASS
#1961 [plaster+liquid] fc=2,cc=0,ph=7.4,ta=130,cya=40,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.4 | A[now:fc soon:ta soon:ch tune:ph tune:csi] | PASS
#1996 [plaster+liquid] fc=2,cc=0.6,ph=7.4,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=25 bad csi=-0.04 | A[now:cc now:fc soon:cya soon:ta tune:ph] | PASS
#2031 [plaster+liquid] fc=2,cc=0,ph=7.6,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-1.04 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#2066 [plaster+liquid] fc=2,cc=0.6,ph=7.6,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=58 bad csi=-0.18 | A[now:cc now:fc] | PASS
#2101 [plaster+liquid] fc=2,cc=0,ph=7.6,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.41 | A[soon:cya soon:fc soon:ch tune:csi] | PASS
#2136 [plaster+liquid] fc=2,cc=0.6,ph=7.6,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.1 | A[now:cc now:fc soon:cya] | PASS
#2171 [plaster+liquid] fc=2,cc=0,ph=7.6,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.35 | A[now:fc soon:ch tune:ta tune:csi] | PASS
#2206 [plaster+liquid] fc=2,cc=0.6,ph=7.6,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.24 | A[now:cc soon:cya soon:fc soon:ta] | PASS
#2241 [plaster+liquid] fc=2,cc=0,ph=7.6,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.27 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#2276 [plaster+liquid] fc=2,cc=0.6,ph=7.8,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.3 | A[now:cc now:fc soon:ta] | PASS
#2311 [plaster+liquid] fc=2,cc=0,ph=7.8,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=67 bad csi=-0.41 | A[now:fc soon:ch tune:csi] | PASS
#2346 [plaster+liquid] fc=2,cc=0.6,ph=7.8,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.2 | A[now:cc now:fc soon:cya] | PASS
#2381 [plaster+liquid] fc=2,cc=0,ph=7.8,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.33 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#2416 [plaster+liquid] fc=2,cc=0.6,ph=7.8,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.28 | A[now:cc now:fc tune:ta] | PASS
#2451 [plaster+liquid] fc=2,cc=0,ph=7.8,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.02 | A[soon:cya soon:fc soon:ta soon:ch] | PASS
#2486 [plaster+liquid] fc=2,cc=0.6,ph=7.8,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.37 | A[now:cc now:fc soon:cya soon:ta tune:csi] | PASS
#2521 [plaster+liquid] fc=2,cc=0,ph=8,ta=40,cya=50,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.53 | A[now:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#2556 [plaster+liquid] fc=2,cc=0.6,ph=8,ta=60,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.27 | A[now:cc soon:cya soon:fc soon:ph] | PASS
#2591 [plaster+liquid] fc=2,cc=0,ph=8,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.43 | A[now:fc soon:cya soon:ph soon:ch tune:csi] | PASS
#2626 [plaster+liquid] fc=2,cc=0.6,ph=8,ta=80,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.34 | A[now:cc now:fc soon:ph tune:csi] | PASS
#2661 [plaster+liquid] fc=2,cc=0,ph=8,ta=100,cya=40,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.06 | A[now:fc soon:ph soon:ch tune:ta] | PASS
#2696 [plaster+liquid] fc=2,cc=0.6,ph=8,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.37 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#2731 [plaster+liquid] fc=2,cc=0,ph=8,ta=130,cya=70,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.14 | A[now:fc soon:cya soon:ph soon:ta soon:ch] | PASS
#2766 [plaster+liquid] fc=2,cc=0.6,ph=8.3,ta=40,cya=40,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.25 | A[now:cc now:fc soon:ph soon:ta] | PASS
#2801 [plaster+liquid] fc=2,cc=0,ph=8.3,ta=60,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.15 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#2836 [plaster+liquid] fc=2,cc=0.6,ph=8.3,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=21 bad csi=0.38 | A[now:cc now:fc soon:cya soon:ph tune:csi] | PASS
#2871 [plaster+liquid] fc=2,cc=0,ph=8.3,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=0.21 | A[now:fc soon:ph soon:ch] | PASS
#2906 [plaster+liquid] fc=2,cc=0.6,ph=8.3,ta=100,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.81 | A[now:cc soon:cya soon:fc soon:ph soon:csi tune:ta] | PASS
#2941 [plaster+liquid] fc=2,cc=0,ph=8.3,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=33 bad csi=0.25 | A[now:fc soon:cya soon:ph soon:ch tune:ta] | PASS
#2976 [plaster+liquid] fc=2,cc=0.6,ph=8.3,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=25 bad csi=0.89 | A[now:cc now:fc soon:ph soon:ta soon:csi] | PASS
#3011 [plaster+liquid] fc=3,cc=0,ph=7,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=50 bad csi=-1.38 | A[soon:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#3046 [plaster+liquid] fc=3,cc=0.6,ph=7,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=8 bad csi=-1.17 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi] | PASS
#3081 [plaster+liquid] fc=3,cc=0,ph=7,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=29 bad csi=-1.23 | A[now:fc soon:cya soon:ph soon:ch soon:csi] | PASS
#3116 [plaster+liquid] fc=3,cc=0.6,ph=7,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.6 | A[now:cc soon:fc soon:ph tune:csi] | PASS
#3151 [plaster+liquid] fc=3,cc=0,ph=7,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.89 | A[soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#3186 [plaster+liquid] fc=3,cc=0.6,ph=7,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.53 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#3221 [plaster+liquid] fc=3,cc=0,ph=7,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.8 | A[now:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#3256 [plaster+liquid] fc=3,cc=0.6,ph=7.4,ta=40,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.52 | A[now:cc soon:cya soon:ta tune:ph tune:csi] | PASS
#3291 [plaster+liquid] fc=3,cc=0,ph=7.4,ta=40,cya=90,ch=150,temp=85 :: H 1/6 score=29 bad csi=-1.37 | A[now:fc soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#3326 [plaster+liquid] fc=3,cc=0.6,ph=7.4,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.4 | A[now:cc now:fc tune:ph tune:csi] | PASS
#3361 [plaster+liquid] fc=3,cc=0,ph=7.4,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.64 | A[soon:fc soon:ch soon:csi tune:ph] | PASS
#3396 [plaster+liquid] fc=3,cc=0.6,ph=7.4,ta=80,cya=90,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.33 | A[now:cc now:fc soon:cya tune:ph tune:csi] | PASS
#3431 [plaster+liquid] fc=3,cc=0,ph=7.4,ta=100,cya=70,ch=150,temp=85 :: H 1/6 score=38 bad csi=-0.58 | A[now:fc soon:cya soon:ch tune:ph tune:ta tune:csi] | PASS
#3466 [plaster+liquid] fc=3,cc=0.6,ph=7.4,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=54 bad csi=0.02 | A[now:cc soon:fc soon:ta tune:ph] | PASS
#3501 [plaster+liquid] fc=3,cc=0,ph=7.6,ta=40,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.75 | A[soon:cya soon:ta soon:ch soon:csi] | PASS
#3536 [plaster+liquid] fc=3,cc=0.6,ph=7.6,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=25 bad csi=-0.63 | A[now:cc now:fc soon:cya soon:ta soon:csi] | PASS
#3571 [plaster+liquid] fc=3,cc=0,ph=7.6,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=63 bad csi=-0.63 | A[now:fc soon:ch soon:csi] | PASS
#3606 [plaster+liquid] fc=3,cc=0.6,ph=7.6,ta=80,cya=20,ch=400,temp=85 :: H 4/6 score=67 bad csi=0.01 | A[now:cc soon:cya] | PASS
#3641 [plaster+liquid] fc=3,cc=0,ph=7.6,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.57 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#3676 [plaster+liquid] fc=3,cc=0.6,ph=7.6,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.07 | A[now:cc now:fc tune:ta] | PASS
#3711 [plaster+liquid] fc=3,cc=0,ph=7.6,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.21 | A[soon:fc soon:ta soon:ch] | PASS
#3746 [plaster+liquid] fc=3,cc=0.6,ph=7.6,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.15 | A[now:cc now:fc soon:cya soon:ta] | PASS
#3781 [plaster+liquid] fc=3,cc=0,ph=7.8,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.88 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#3816 [plaster+liquid] fc=3,cc=0.6,ph=7.8,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=0.01 | A[now:cc soon:fc] | PASS
#3851 [plaster+liquid] fc=3,cc=0,ph=7.8,ta=80,cya=20,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.21 | A[soon:cya soon:ch] | PASS
#3886 [plaster+liquid] fc=3,cc=0.6,ph=7.8,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=0.09 | A[now:cc now:fc soon:cya] | PASS
#3921 [plaster+liquid] fc=3,cc=0,ph=7.8,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.16 | A[now:fc soon:ch tune:ta] | PASS
#3956 [plaster+liquid] fc=3,cc=0.6,ph=7.8,ta=130,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.43 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#3991 [plaster+liquid] fc=3,cc=0,ph=7.8,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.08 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#4026 [plaster+liquid] fc=3,cc=0.6,ph=8,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.11 | A[now:cc now:fc soon:ph soon:ta] | PASS
#4061 [plaster+liquid] fc=3,cc=0,ph=8,ta=60,cya=40,ch=150,temp=85 :: H 3/6 score=75 warn csi=-0.21 | A[soon:fc soon:ph soon:ch] | PASS
#4096 [plaster+liquid] fc=3,cc=0.6,ph=8,ta=60,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.02 | A[now:cc now:fc soon:cya soon:ph] | PASS
#4131 [plaster+liquid] fc=3,cc=0,ph=8,ta=80,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.14 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#4166 [plaster+liquid] fc=3,cc=0.6,ph=8,ta=100,cya=40,ch=400,temp=85 :: H 2/6 score=54 bad csi=0.48 | A[now:cc soon:fc soon:ph tune:ta tune:csi] | PASS
#4201 [plaster+liquid] fc=3,cc=0,ph=8,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=0.21 | A[soon:cya soon:ph soon:ta soon:ch] | PASS
#4236 [plaster+liquid] fc=3,cc=0.6,ph=8,ta=130,cya=70,ch=400,temp=85 :: H 1/6 score=21 bad csi=0.56 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#4271 [plaster+liquid] fc=3,cc=0,ph=8.3,ta=40,cya=50,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.24 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#4306 [plaster+liquid] fc=3,cc=0.6,ph=8.3,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.57 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#4341 [plaster+liquid] fc=3,cc=0,ph=8.3,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.15 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#4376 [plaster+liquid] fc=3,cc=0.6,ph=8.3,ta=80,cya=50,ch=400,temp=85 :: H 3/6 score=33 bad csi=0.63 | A[now:cc now:fc soon:ph soon:csi] | PASS
#4411 [plaster+liquid] fc=3,cc=0,ph=8.3,ta=100,cya=40,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.36 | A[soon:fc soon:ph soon:ch tune:ta tune:csi] | PASS
#4446 [plaster+liquid] fc=3,cc=0.6,ph=8.3,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=0.67 | A[now:cc now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#4481 [plaster+liquid] fc=3,cc=0,ph=8.3,ta=130,cya=70,ch=150,temp=85 :: H 1/6 score=25 bad csi=0.44 | A[now:fc soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#4516 [plaster+liquid] fc=5,cc=0.6,ph=7,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.96 | A[now:cc soon:ph soon:ta soon:csi] | PASS
#4551 [plaster+liquid] fc=5,cc=0,ph=7,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=54 bad csi=-1.13 | A[soon:cya soon:ph soon:ch soon:csi] | PASS
#4586 [plaster+liquid] fc=5,cc=0.6,ph=7,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.81 | A[now:cc soon:cya soon:fc soon:ph soon:csi] | PASS
#4621 [plaster+liquid] fc=5,cc=0,ph=7,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=58 bad csi=-1.04 | A[soon:fc soon:ph soon:ch soon:csi] | PASS
#4656 [plaster+liquid] fc=5,cc=0.6,ph=7,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.47 | A[now:cc soon:cya soon:ph tune:ta tune:csi] | PASS
#4691 [plaster+liquid] fc=5,cc=0,ph=7,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=25 bad csi=-0.97 | A[now:fc soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#4726 [plaster+liquid] fc=5,cc=0.6,ph=7,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.38 | A[now:cc soon:fc soon:ph soon:ta tune:csi] | PASS
#4761 [plaster+liquid] fc=5,cc=0,ph=7.4,ta=40,cya=40,ch=150,temp=85 :: H 3/6 score=71 bad csi=-1.03 | A[soon:ta soon:ch soon:csi tune:ph] | PASS
#4796 [plaster+liquid] fc=5,cc=0.6,ph=7.4,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.95 | A[now:cc now:fc soon:cya soon:ta soon:csi tune:ph] | PASS
#4831 [plaster+liquid] fc=5,cc=0,ph=7.4,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.88 | A[soon:cya soon:fc soon:ch soon:csi tune:ph] | PASS
#4866 [plaster+liquid] fc=5,cc=0.6,ph=7.4,ta=80,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=-0.22 | A[now:cc tune:ph] | PASS
#4901 [plaster+liquid] fc=5,cc=0,ph=7.4,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.5 | A[soon:cya soon:ch tune:ph tune:ta tune:csi] | PASS
#4936 [plaster+liquid] fc=5,cc=0.6,ph=7.4,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=42 bad csi=-0.16 | A[now:cc soon:cya soon:fc tune:ph tune:ta] | PASS
#4971 [plaster+liquid] fc=5,cc=0,ph=7.4,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.42 | A[soon:fc soon:ta soon:ch tune:ph tune:csi] | PASS
#5006 [plaster+liquid] fc=5,cc=0.6,ph=7.6,ta=40,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.33 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#5041 [plaster+liquid] fc=5,cc=0,ph=7.6,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-1.26 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#5076 [plaster+liquid] fc=5,cc=0.6,ph=7.6,ta=60,cya=50,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.21 | A[now:cc soon:fc] | PASS
#5111 [plaster+liquid] fc=5,cc=0,ph=7.6,ta=80,cya=40,ch=150,temp=85 :: H 5/6 score=92 warn csi=-0.45 | A[soon:ch tune:csi] | PASS
#5146 [plaster+liquid] fc=5,cc=0.6,ph=7.6,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.15 | A[now:cc now:fc soon:cya] | PASS
#5181 [plaster+liquid] fc=5,cc=0,ph=7.6,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.39 | A[soon:cya soon:fc soon:ch tune:ta tune:csi] | PASS
#5216 [plaster+liquid] fc=5,cc=0.6,ph=7.6,ta=130,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.21 | A[now:cc soon:ta] | PASS
#5251 [plaster+liquid] fc=5,cc=0,ph=7.8,ta=40,cya=20,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.55 | A[soon:cya soon:ta soon:ch tune:csi] | PASS
#5286 [plaster+liquid] fc=5,cc=0.6,ph=7.8,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.46 | A[now:cc soon:cya soon:fc soon:ta tune:csi] | PASS
#5321 [plaster+liquid] fc=5,cc=0,ph=7.8,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=79 warn csi=-0.44 | A[soon:fc soon:ch tune:csi] | PASS
#5356 [plaster+liquid] fc=5,cc=0.6,ph=7.8,ta=80,cya=20,ch=400,temp=85 :: H 4/6 score=67 bad csi=0.21 | A[now:cc soon:cya] | PASS
#5391 [plaster+liquid] fc=5,cc=0,ph=7.8,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.39 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#5426 [plaster+liquid] fc=5,cc=0.6,ph=7.8,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0.26 | A[now:cc soon:fc tune:ta] | PASS
#5461 [plaster+liquid] fc=5,cc=0,ph=7.8,ta=130,cya=40,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.01 | A[soon:ta soon:ch] | PASS
#5496 [plaster+liquid] fc=5,cc=0.6,ph=7.8,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.34 | A[now:cc now:fc soon:cya soon:ta tune:csi] | PASS
#5531 [plaster+liquid] fc=5,cc=0,ph=8,ta=40,cya=70,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.71 | A[soon:cya soon:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#5566 [plaster+liquid] fc=5,cc=0.6,ph=8,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.21 | A[now:cc soon:ph] | PASS
#5601 [plaster+liquid] fc=5,cc=0,ph=8,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.01 | A[soon:cya soon:ph soon:ch] | PASS
#5636 [plaster+liquid] fc=5,cc=0.6,ph=8,ta=80,cya=70,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.28 | A[now:cc soon:cya soon:fc soon:ph] | PASS
#5671 [plaster+liquid] fc=5,cc=0,ph=8,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=71 warn csi=0.04 | A[soon:fc soon:ph soon:ch tune:ta] | PASS
#5706 [plaster+liquid] fc=5,cc=0.6,ph=8,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=0.63 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#5741 [plaster+liquid] fc=5,cc=0,ph=8,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.11 | A[now:fc soon:cya soon:ph soon:ta soon:ch] | PASS
#5776 [plaster+liquid] fc=5,cc=0.6,ph=8.3,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.18 | A[now:cc soon:fc soon:ph soon:ta] | PASS
#5811 [plaster+liquid] fc=5,cc=0,ph=8.3,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=0.08 | A[soon:ph soon:ch] | PASS
#5846 [plaster+liquid] fc=5,cc=0.6,ph=8.3,ta=60,cya=90,ch=400,temp=85 :: H 2/6 score=25 bad csi=0.27 | A[now:cc now:fc soon:cya soon:ph] | PASS
#5881 [plaster+liquid] fc=5,cc=0,ph=8.3,ta=80,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.16 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#5916 [plaster+liquid] fc=5,cc=0.6,ph=8.3,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.78 | A[now:cc soon:ph soon:csi tune:ta] | PASS
#5951 [plaster+liquid] fc=5,cc=0,ph=8.3,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.51 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#5986 [plaster+liquid] fc=5,cc=0.6,ph=8.3,ta=130,cya=70,ch=400,temp=85 :: H 1/6 score=21 bad csi=0.86 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi] | PASS
#6021 [plaster+liquid] fc=8,cc=0,ph=7,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-1.42 | A[soon:ph soon:ta soon:ch soon:csi] | PASS
#6056 [plaster+liquid] fc=8,cc=0.6,ph=7,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.71 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#6091 [plaster+liquid] fc=8,cc=0,ph=7,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=42 bad csi=-1.28 | A[soon:cya soon:fc soon:ph soon:ch soon:csi] | PASS
#6126 [plaster+liquid] fc=8,cc=0.6,ph=7,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=58 bad csi=-0.62 | A[now:cc soon:ph soon:csi] | PASS
#6161 [plaster+liquid] fc=8,cc=0,ph=7,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.92 | A[soon:ph soon:ch soon:csi tune:ta] | PASS
#6196 [plaster+liquid] fc=8,cc=0.6,ph=7,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=29 bad csi=-0.56 | A[now:cc soon:cya soon:fc soon:ph tune:ta tune:csi] | PASS
#6231 [plaster+liquid] fc=8,cc=0,ph=7,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.82 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#6266 [plaster+liquid] fc=8,cc=0.6,ph=7.4,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.61 | A[now:cc soon:ta soon:csi tune:ph] | PASS
#6301 [plaster+liquid] fc=8,cc=0,ph=7.4,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.74 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#6336 [plaster+liquid] fc=8,cc=0.6,ph=7.4,ta=60,cya=70,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.47 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#6371 [plaster+liquid] fc=8,cc=0,ph=7.4,ta=80,cya=50,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.66 | A[soon:ch soon:csi tune:ph] | PASS
#6406 [plaster+liquid] fc=8,cc=0.6,ph=7.4,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=54 bad csi=-0.08 | A[now:cc soon:cya tune:ph tune:ta] | PASS
#6441 [plaster+liquid] fc=8,cc=0,ph=7.4,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=46 bad csi=-0.61 | A[soon:cya soon:fc soon:ch soon:csi tune:ph tune:ta] | PASS
#6476 [plaster+liquid] fc=8,cc=0.6,ph=7.4,ta=130,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0 | A[now:cc soon:ta tune:ph] | PASS
#6511 [plaster+liquid] fc=8,cc=0,ph=7.6,ta=40,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.84 | A[soon:ta soon:ch soon:csi] | PASS
#6546 [plaster+liquid] fc=8,cc=0.6,ph=7.6,ta=40,cya=90,ch=400,temp=85 :: H 2/6 score=38 bad csi=-0.84 | A[now:cc soon:cya soon:fc soon:ta soon:csi] | PASS
#6581 [plaster+liquid] fc=8,cc=0,ph=7.6,ta=60,cya=70,ch=150,temp=85 :: H 4/6 score=71 bad csi=-0.71 | A[soon:cya soon:ch soon:csi] | PASS
#6616 [plaster+liquid] fc=8,cc=0.6,ph=7.6,ta=80,cya=40,ch=400,temp=85 :: H 5/6 score=83 bad csi=-0.03 | A[now:cc] | PASS
#6651 [plaster+liquid] fc=8,cc=0,ph=7.6,ta=100,cya=20,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.3 | A[soon:cya soon:ch tune:ta] | PASS
#6686 [plaster+liquid] fc=8,cc=0.6,ph=7.6,ta=100,cya=70,ch=400,temp=85 :: H 3/6 score=63 bad csi=0.03 | A[now:cc soon:cya tune:ta] | PASS
#6721 [plaster+liquid] fc=8,cc=0,ph=7.6,ta=130,cya=50,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.22 | A[soon:ta soon:ch] | PASS
#6756 [plaster+liquid] fc=8,cc=0.6,ph=7.8,ta=40,cya=20,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.13 | A[now:cc soon:cya soon:ta] | PASS
#6791 [plaster+liquid] fc=8,cc=0,ph=7.8,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=50 bad csi=-1.14 | A[soon:cya soon:fc soon:ta soon:ch soon:csi] | PASS
#6826 [plaster+liquid] fc=8,cc=0.6,ph=7.8,ta=60,cya=50,ch=400,temp=85 :: H 5/6 score=83 bad csi=-0.02 | A[now:cc] | PASS
#6861 [plaster+liquid] fc=8,cc=0,ph=7.8,ta=80,cya=40,ch=150,temp=85 :: H 5/6 score=96 warn csi=-0.25 | A[soon:ch] | PASS
#6896 [plaster+liquid] fc=8,cc=0.6,ph=7.8,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.03 | A[now:cc soon:cya soon:fc] | PASS
#6931 [plaster+liquid] fc=8,cc=0,ph=7.8,ta=100,cya=70,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.2 | A[soon:cya soon:ch tune:ta] | PASS
#6966 [plaster+liquid] fc=8,cc=0.6,ph=7.8,ta=130,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=0.41 | A[now:cc soon:ta tune:csi] | PASS
#7001 [plaster+liquid] fc=8,cc=0,ph=8,ta=40,cya=20,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.35 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#7036 [plaster+liquid] fc=8,cc=0.6,ph=8,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=-0.29 | A[now:cc soon:cya soon:ph soon:ta] | PASS
#7071 [plaster+liquid] fc=8,cc=0,ph=8,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=88 warn csi=-0.25 | A[soon:ph soon:ch] | PASS
#7106 [plaster+liquid] fc=8,cc=0.6,ph=8,ta=80,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.41 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#7141 [plaster+liquid] fc=8,cc=0,ph=8,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.2 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#7176 [plaster+liquid] fc=8,cc=0.6,ph=8,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0.46 | A[now:cc soon:ph tune:ta tune:csi] | PASS
#7211 [plaster+liquid] fc=8,cc=0,ph=8,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=79 bad csi=0.19 | A[soon:ph soon:ta soon:ch] | PASS
#7246 [plaster+liquid] fc=8,cc=0.6,ph=8,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=33 bad csi=0.53 | A[now:cc soon:cya soon:fc soon:ph soon:ta tune:csi] | PASS
#7281 [plaster+liquid] fc=8,cc=0,ph=8.3,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.43 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#7316 [plaster+liquid] fc=8,cc=0.6,ph=8.3,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=63 bad csi=0.5 | A[now:cc soon:ph tune:csi] | PASS
#7351 [plaster+liquid] fc=8,cc=0,ph=8.3,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=0.29 | A[soon:cya soon:ph soon:ch] | PASS
#7386 [plaster+liquid] fc=8,cc=0.6,ph=8.3,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.58 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#7421 [plaster+liquid] fc=8,cc=0,ph=8.3,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=71 bad csi=0.34 | A[soon:ph soon:ch tune:ta tune:csi] | PASS
#7456 [plaster+liquid] fc=8,cc=0.6,ph=8.3,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.93 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#7491 [plaster+liquid] fc=8,cc=0,ph=8.3,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.41 | A[soon:cya soon:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#7526 [plaster+liquid] fc=12,cc=0.6,ph=7,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=-1 | A[now:cc soon:ph soon:ta soon:csi] | PASS
#7561 [plaster+liquid] fc=12,cc=0,ph=7,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=71 bad csi=-1.17 | A[soon:ph soon:ch soon:csi] | PASS
#7596 [plaster+liquid] fc=12,cc=0.6,ph=7,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.86 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#7631 [plaster+liquid] fc=12,cc=0,ph=7,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=54 bad csi=-1.07 | A[soon:cya soon:ph soon:ch soon:csi] | PASS
#7666 [plaster+liquid] fc=12,cc=0.6,ph=7,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.5 | A[now:cc soon:ph tune:ta tune:csi] | PASS
#7701 [plaster+liquid] fc=12,cc=0,ph=7,ta=130,cya=20,ch=150,temp=85 :: H 1/6 score=33 bad csi=-0.78 | A[soon:cya soon:ph soon:ta soon:ch soon:csi tune:fc] | PASS
#7736 [plaster+liquid] fc=12,cc=0.6,ph=7,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=38 bad csi=-0.4 | A[now:cc soon:cya soon:ph soon:ta tune:csi] | PASS
#7771 [plaster+liquid] fc=12,cc=0,ph=7.4,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=71 bad csi=-1.08 | A[soon:ta soon:ch soon:csi tune:ph] | PASS
#7806 [plaster+liquid] fc=12,cc=0.6,ph=7.4,ta=60,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.32 | A[now:cc soon:cya tune:fc tune:ph tune:csi] | PASS
#7841 [plaster+liquid] fc=12,cc=0,ph=7.4,ta=60,cya=90,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.96 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#7876 [plaster+liquid] fc=12,cc=0.6,ph=7.4,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=-0.24 | A[now:cc tune:ph] | PASS
#7911 [plaster+liquid] fc=12,cc=0,ph=7.4,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=79 warn csi=-0.53 | A[soon:ch tune:ph tune:ta tune:csi] | PASS
#7946 [plaster+liquid] fc=12,cc=0.6,ph=7.4,ta=100,cya=90,ch=400,temp=85 :: H 2/6 score=54 bad csi=-0.19 | A[now:cc soon:cya tune:ph tune:ta] | PASS
#7981 [plaster+liquid] fc=12,cc=0,ph=7.4,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.44 | A[soon:cya soon:ta soon:ch tune:ph tune:csi] | PASS
#8016 [plaster+liquid] fc=12,cc=0.6,ph=7.6,ta=40,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.42 | A[now:cc soon:ta tune:csi] | PASS
#8051 [plaster+liquid] fc=12,cc=0,ph=7.6,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.54 | A[soon:cya soon:ch tune:fc tune:csi] | PASS
#8086 [plaster+liquid] fc=12,cc=0.6,ph=7.6,ta=60,cya=70,ch=400,temp=85 :: H 4/6 score=67 bad csi=-0.29 | A[now:cc soon:cya] | PASS
#8121 [plaster+liquid] fc=12,cc=0,ph=7.6,ta=80,cya=50,ch=150,temp=85 :: H 5/6 score=92 warn csi=-0.47 | A[soon:ch tune:csi] | PASS
#8156 [plaster+liquid] fc=12,cc=0.6,ph=7.6,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=50 bad csi=0.12 | A[now:cc soon:cya tune:fc tune:ta] | PASS
#8191 [plaster+liquid] fc=12,cc=0,ph=7.6,ta=100,cya=90,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.43 | A[soon:cya soon:ch tune:ta tune:csi] | PASS
#8226 [plaster+liquid] fc=12,cc=0.6,ph=7.6,ta=130,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.2 | A[now:cc soon:ta] | PASS
#8261 [plaster+liquid] fc=12,cc=0,ph=7.8,ta=40,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.66 | A[soon:ta soon:ch soon:csi] | PASS
#8296 [plaster+liquid] fc=12,cc=0.6,ph=7.8,ta=40,cya=90,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.72 | A[now:cc soon:cya soon:ta soon:csi] | PASS
#8331 [plaster+liquid] fc=12,cc=0,ph=7.8,ta=60,cya=70,ch=150,temp=85 :: H 4/6 score=75 bad csi=-0.52 | A[soon:cya soon:ch tune:csi] | PASS
#8366 [plaster+liquid] fc=12,cc=0.6,ph=7.8,ta=80,cya=40,ch=400,temp=85 :: H 5/6 score=83 bad csi=0.17 | A[now:cc] | PASS
#8401 [plaster+liquid] fc=12,cc=0,ph=7.8,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.1 | A[soon:cya soon:ch tune:fc tune:ta] | PASS
#8436 [plaster+liquid] fc=12,cc=0.6,ph=7.8,ta=100,cya=70,ch=400,temp=85 :: H 3/6 score=63 bad csi=0.22 | A[now:cc soon:cya tune:ta] | PASS
#8471 [plaster+liquid] fc=12,cc=0,ph=7.8,ta=130,cya=50,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.02 | A[soon:ta soon:ch] | PASS
#8506 [plaster+liquid] fc=12,cc=0.6,ph=8,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=38 bad csi=0.06 | A[now:cc soon:cya soon:ta tune:fc tune:ph] | PASS
#8541 [plaster+liquid] fc=12,cc=0,ph=8,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=54 bad csi=-1.01 | A[soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#8576 [plaster+liquid] fc=12,cc=0.6,ph=8,ta=60,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.17 | A[now:cc tune:ph] | PASS
#8611 [plaster+liquid] fc=12,cc=0,ph=8,ta=80,cya=40,ch=150,temp=85 :: H 4/6 score=88 warn csi=-0.06 | A[soon:ch tune:ph] | PASS
#8646 [plaster+liquid] fc=12,cc=0.6,ph=8,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.22 | A[now:cc soon:cya tune:ph] | PASS
#8681 [plaster+liquid] fc=12,cc=0,ph=8,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=67 bad csi=0 | A[soon:cya soon:ch tune:ph tune:ta] | PASS
#8716 [plaster+liquid] fc=12,cc=0.6,ph=8,ta=130,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.61 | A[now:cc soon:ta soon:csi tune:ph] | PASS
#8751 [plaster+liquid] fc=12,cc=0,ph=8.3,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.06 | A[soon:cya soon:ta soon:ch tune:fc tune:ph] | PASS
#8786 [plaster+liquid] fc=12,cc=0.6,ph=8.3,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.01 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#8821 [plaster+liquid] fc=12,cc=0,ph=8.3,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=79 bad csi=0.04 | A[soon:ch tune:ph] | PASS
#8856 [plaster+liquid] fc=12,cc=0.6,ph=8.3,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.71 | A[now:cc soon:cya soon:csi tune:fc tune:ph] | PASS
#8891 [plaster+liquid] fc=12,cc=0,ph=8.3,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=63 bad csi=0.09 | A[soon:cya soon:ch tune:ph] | PASS
#8926 [plaster+liquid] fc=12,cc=0.6,ph=8.3,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.76 | A[now:cc soon:csi tune:ph tune:ta] | PASS
#8961 [plaster+liquid] fc=12,cc=0,ph=8.3,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=0.49 | A[soon:ta soon:ch tune:ph tune:csi] | PASS
#8996 [plaster+liquid] fc=12,cc=0.6,ph=8.3,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.83 | A[now:cc soon:cya soon:ta soon:csi tune:ph] | PASS
#9031 [plaster+liquid] fc=25,cc=0,ph=7,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-1.49 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#9066 [plaster+liquid] fc=25,cc=0.6,ph=7,ta=60,cya=40,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.75 | A[now:cc soon:ph soon:csi tune:fc] | PASS
#9101 [plaster+liquid] fc=25,cc=0,ph=7,ta=80,cya=20,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.99 | A[soon:cya soon:ph soon:ch soon:csi tune:fc] | PASS
#9136 [plaster+liquid] fc=25,cc=0.6,ph=7,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.65 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#9171 [plaster+liquid] fc=25,cc=0,ph=7,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=54 bad csi=-0.93 | A[soon:ph soon:ch soon:csi tune:fc tune:ta] | PASS
#9206 [plaster+liquid] fc=25,cc=0.6,ph=7,ta=130,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=-0.36 | A[now:cc soon:cya soon:ph soon:ta tune:fc tune:csi] | PASS
#9241 [plaster+liquid] fc=25,cc=0,ph=7,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.84 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#9276 [plaster+liquid] fc=25,cc=0.6,ph=7.4,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.66 | A[now:cc soon:ta soon:csi tune:fc tune:ph] | PASS
#9311 [plaster+liquid] fc=25,cc=0,ph=7.4,ta=60,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.79 | A[soon:ch soon:csi tune:fc tune:ph] | PASS
#9346 [plaster+liquid] fc=25,cc=0.6,ph=7.4,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.54 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#9381 [plaster+liquid] fc=25,cc=0,ph=7.4,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.7 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#9416 [plaster+liquid] fc=25,cc=0.6,ph=7.4,ta=100,cya=40,ch=400,temp=85 :: H 2/6 score=58 bad csi=-0.11 | A[now:cc tune:fc tune:ph tune:ta] | PASS
#9451 [plaster+liquid] fc=25,cc=0,ph=7.4,ta=130,cya=20,ch=150,temp=85 :: H 1/6 score=46 bad csi=-0.38 | A[soon:cya soon:ta soon:ch tune:fc tune:ph tune:csi] | PASS
#9486 [plaster+liquid] fc=25,cc=0.6,ph=7.4,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=-0.02 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#9521 [plaster+liquid] fc=25,cc=0,ph=7.6,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.9 | A[soon:ta soon:ch soon:csi tune:fc] | PASS
#9556 [plaster+liquid] fc=25,cc=0.6,ph=7.6,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.12 | A[now:cc soon:cya tune:fc] | PASS
#9591 [plaster+liquid] fc=25,cc=0,ph=7.6,ta=60,cya=90,ch=150,temp=85 :: H 4/6 score=71 bad csi=-0.79 | A[soon:cya soon:ch soon:csi] | PASS
#9626 [plaster+liquid] fc=25,cc=0.6,ph=7.6,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.05 | A[now:cc tune:fc] | PASS
#9661 [plaster+liquid] fc=25,cc=0,ph=7.6,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=75 warn csi=-0.34 | A[soon:ch tune:fc tune:ta tune:csi] | PASS
#9696 [plaster+liquid] fc=25,cc=0.6,ph=7.6,ta=100,cya=90,ch=400,temp=85 :: H 3/6 score=63 bad csi=-0.01 | A[now:cc soon:cya tune:ta] | PASS
#9731 [plaster+liquid] fc=25,cc=0,ph=7.6,ta=130,cya=70,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.25 | A[soon:cya soon:ta soon:ch] | PASS
#9766 [plaster+liquid] fc=25,cc=0.6,ph=7.8,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=63 bad csi=-0.24 | A[now:cc soon:ta tune:fc] | PASS
#9801 [plaster+liquid] fc=25,cc=0,ph=7.8,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.35 | A[soon:cya soon:ch tune:fc tune:csi] | PASS
#9836 [plaster+liquid] fc=25,cc=0.6,ph=7.8,ta=60,cya=70,ch=400,temp=85 :: H 4/6 score=67 bad csi=-0.1 | A[now:cc soon:cya] | PASS
#9871 [plaster+liquid] fc=25,cc=0,ph=7.8,ta=80,cya=50,ch=150,temp=85 :: H 4/6 score=83 warn csi=-0.28 | A[soon:ch tune:fc] | PASS
#9906 [plaster+liquid] fc=25,cc=0.6,ph=7.8,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.31 | A[now:cc soon:cya tune:fc tune:ta tune:csi] | PASS
#9941 [plaster+liquid] fc=25,cc=0,ph=7.8,ta=100,cya=90,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.24 | A[soon:cya soon:ch tune:ta] | PASS
#9976 [plaster+liquid] fc=25,cc=0.6,ph=7.8,ta=130,cya=50,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.4 | A[now:cc soon:ta tune:fc tune:csi] | PASS
#10011 [plaster+liquid] fc=25,cc=0,ph=8,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.46 | A[soon:ta soon:ch tune:fc tune:ph tune:csi] | PASS
#10046 [plaster+liquid] fc=25,cc=0.6,ph=8,ta=40,cya=90,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.59 | A[now:cc soon:cya soon:ta tune:ph tune:csi] | PASS
#10081 [plaster+liquid] fc=25,cc=0,ph=8,ta=60,cya=70,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.33 | A[soon:cya soon:ch tune:ph tune:csi] | PASS
#10116 [plaster+liquid] fc=25,cc=0.6,ph=8,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.36 | A[now:cc tune:fc tune:ph tune:csi] | PASS
#10151 [plaster+liquid] fc=25,cc=0,ph=8,ta=100,cya=20,ch=150,temp=85 :: H 1/6 score=54 bad csi=0.09 | A[soon:cya soon:ch tune:fc tune:ph tune:ta] | PASS
#10186 [plaster+liquid] fc=25,cc=0.6,ph=8,ta=100,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=0.42 | A[now:cc soon:cya tune:ph tune:ta tune:csi] | PASS
#10221 [plaster+liquid] fc=25,cc=0,ph=8,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=67 bad csi=0.17 | A[soon:ta soon:ch tune:fc tune:ph] | PASS
#10256 [plaster+liquid] fc=25,cc=0.6,ph=8.3,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.36 | A[now:cc soon:cya soon:ta tune:fc tune:ph tune:csi] | PASS
#10291 [plaster+liquid] fc=25,cc=0,ph=8.3,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.77 | A[soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#10326 [plaster+liquid] fc=25,cc=0.6,ph=8.3,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=0.46 | A[now:cc tune:fc tune:ph tune:csi] | PASS
#10361 [plaster+liquid] fc=25,cc=0,ph=8.3,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=0.24 | A[soon:ch tune:fc tune:ph] | PASS
#10396 [plaster+liquid] fc=25,cc=0.6,ph=8.3,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.51 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#10431 [plaster+liquid] fc=25,cc=0,ph=8.3,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.29 | A[soon:cya soon:ch tune:ph tune:ta] | PASS
#10466 [plaster+liquid] fc=25,cc=0.6,ph=8.3,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.91 | A[now:cc soon:ta soon:csi tune:fc tune:ph] | PASS
#10501 [plaster+salt] fc=0,cc=0,ph=7,ta=40,cya=20,ch=150,salt=2500,temp=85 :: H 1/7 score=19 bad csi=-1.29 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#10536 [plaster+salt] fc=0,cc=0.6,ph=7,ta=40,cya=40,ch=150,salt=3700,temp=85 :: H 0/7 score=4 bad csi=-1.4 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#10571 [plaster+salt] fc=0,cc=0.6,ph=7,ta=40,cya=50,ch=300,salt=3200,temp=85 :: H 2/7 score=15 bad csi=-1.12 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi] | PASS
#10606 [plaster+salt] fc=0,cc=0.6,ph=7,ta=40,cya=70,ch=400,salt=2500,temp=85 :: H 2/7 score=23 bad csi=-1.04 | A[now:cc now:fc soon:ph soon:ta soon:csi soon:salt] | PASS
#10641 [plaster+salt] fc=0,cc=0,ph=7,ta=40,cya=90,ch=500,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-1.1 | A[now:fc soon:ph soon:ta soon:csi soon:salt tune:cya tune:ch] | PASS
#10676 [plaster+salt] fc=0,cc=0,ph=7,ta=60,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.47 | A[now:fc soon:cya soon:ph soon:ch tune:csi] | PASS
#10711 [plaster+salt] fc=0,cc=0,ph=7,ta=60,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=27 bad csi=-1.15 | A[now:fc soon:cya soon:ph soon:ch soon:csi soon:salt] | PASS
#10746 [plaster+salt] fc=0,cc=0.6,ph=7,ta=60,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=27 bad csi=-1.25 | A[now:cc now:fc soon:ph soon:ch soon:csi soon:salt] | PASS
#10781 [plaster+salt] fc=0,cc=0.6,ph=7,ta=60,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=31 bad csi=-0.98 | A[now:cc now:fc soon:ph soon:csi tune:cya] | PASS
#10816 [plaster+salt] fc=0,cc=0.6,ph=7,ta=80,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=19 bad csi=-0.54 | A[now:cc now:fc soon:cya soon:ph soon:salt tune:csi] | PASS
#10851 [plaster+salt] fc=0,cc=0,ph=7,ta=80,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=31 bad csi=-0.53 | A[now:fc soon:cya soon:ph soon:salt tune:ch tune:csi] | PASS
#10886 [plaster+salt] fc=0,cc=0,ph=7,ta=80,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.38 | A[now:fc soon:cya soon:ph soon:ch tune:csi] | PASS
#10921 [plaster+salt] fc=0,cc=0,ph=7,ta=80,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=35 bad csi=-1.06 | A[now:fc soon:ph soon:ch soon:csi soon:salt tune:cya] | PASS
#10956 [plaster+salt] fc=0,cc=0.6,ph=7,ta=100,cya=20,ch=150,salt=3700,temp=85 :: H 0/7 score=8 bad csi=-0.92 | A[now:cc now:fc soon:cya soon:ph soon:ch soon:csi soon:salt tune:ta] | PASS
#10991 [plaster+salt] fc=0,cc=0.6,ph=7,ta=100,cya=40,ch=300,salt=3200,temp=85 :: H 2/7 score=19 bad csi=-0.62 | A[now:cc now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#11026 [plaster+salt] fc=0,cc=0.6,ph=7,ta=100,cya=50,ch=400,salt=2500,temp=85 :: H 1/7 score=15 bad csi=-0.47 | A[now:cc now:fc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#11061 [plaster+salt] fc=0,cc=0,ph=7,ta=100,cya=70,ch=500,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.46 | A[now:fc soon:ph soon:salt tune:ta tune:ch tune:csi] | PASS
#11096 [plaster+salt] fc=0,cc=0,ph=7,ta=100,cya=90,ch=700,salt=3200,temp=85 :: H 2/7 score=38 bad csi=-0.32 | A[now:fc soon:ph soon:ch tune:cya tune:ta tune:csi] | PASS
#11131 [plaster+salt] fc=0,cc=0,ph=7,ta=130,cya=40,ch=150,salt=2500,temp=85 :: H 1/7 score=19 bad csi=-0.76 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#11166 [plaster+salt] fc=0,cc=0.6,ph=7,ta=130,cya=50,ch=150,salt=3700,temp=85 :: H 0/7 score=4 bad csi=-0.82 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#11201 [plaster+salt] fc=0,cc=0.6,ph=7,ta=130,cya=70,ch=300,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.52 | A[now:cc now:fc soon:ph soon:ta tune:csi] | PASS
#11236 [plaster+salt] fc=0,cc=0.6,ph=7,ta=130,cya=90,ch=400,salt=2500,temp=85 :: H 1/7 score=19 bad csi=-0.38 | A[now:cc now:fc soon:ph soon:ta soon:salt tune:cya tune:csi] | PASS
#11271 [plaster+salt] fc=0,cc=0,ph=7.4,ta=40,cya=20,ch=500,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.45 | A[now:fc soon:cya soon:ta soon:salt tune:ph tune:ch tune:csi] | PASS
#11306 [plaster+salt] fc=0,cc=0,ph=7.4,ta=40,cya=40,ch=700,salt=3200,temp=85 :: H 2/7 score=35 bad csi=-0.37 | A[now:fc soon:cya soon:ta soon:ch tune:ph tune:csi] | PASS
#11341 [plaster+salt] fc=0,cc=0,ph=7.4,ta=40,cya=70,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-1.16 | A[now:fc soon:ta soon:ch soon:csi soon:salt tune:ph] | PASS
#11376 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=40,cya=90,ch=150,salt=3700,temp=85 :: H 0/7 score=19 bad csi=-1.4 | A[now:cc now:fc soon:ta soon:ch soon:csi soon:salt tune:cya tune:ph] | PASS
#11411 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=60,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.44 | A[now:cc now:fc soon:cya tune:ph tune:csi] | PASS
#11446 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=60,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=27 bad csi=-0.34 | A[now:cc now:fc soon:cya soon:salt tune:ph tune:csi] | PASS
#11481 [plaster+salt] fc=0,cc=0,ph=7.4,ta=60,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=38 bad csi=-0.33 | A[now:fc soon:cya soon:salt tune:ph tune:ch tune:csi] | PASS
#11516 [plaster+salt] fc=0,cc=0,ph=7.4,ta=60,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=-0.23 | A[now:fc soon:ch tune:ph] | PASS
#11551 [plaster+salt] fc=0,cc=0,ph=7.4,ta=80,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=38 bad csi=-0.57 | A[now:fc soon:cya soon:ch soon:salt tune:ph tune:csi] | PASS
#11586 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=80,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=19 bad csi=-0.66 | A[now:cc now:fc soon:cya soon:ch soon:csi soon:salt tune:ph] | PASS
#11621 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=80,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.36 | A[now:cc now:fc soon:cya tune:ph tune:csi] | PASS
#11656 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=80,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=46 bad csi=-0.25 | A[now:cc now:fc soon:salt tune:ph] | PASS
#11691 [plaster+salt] fc=0,cc=0,ph=7.4,ta=80,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.26 | A[now:fc soon:salt tune:cya tune:ph tune:ch] | PASS
#11726 [plaster+salt] fc=0,cc=0,ph=7.4,ta=100,cya=20,ch=700,salt=3200,temp=85 :: H 2/7 score=42 bad csi=0.15 | A[now:fc soon:cya soon:ch tune:ph tune:ta] | PASS
#11761 [plaster+salt] fc=0,cc=0,ph=7.4,ta=100,cya=50,ch=150,salt=2500,temp=85 :: H 1/7 score=35 bad csi=-0.51 | A[now:fc soon:cya soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#11796 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=100,cya=70,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.6 | A[now:cc now:fc soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#11831 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=100,cya=90,ch=300,salt=3200,temp=85 :: H 2/7 score=38 bad csi=-0.32 | A[now:cc now:fc tune:cya tune:ph tune:ta tune:csi] | PASS
#11866 [plaster+salt] fc=0,cc=0.6,ph=7.4,ta=130,cya=20,ch=400,salt=2500,temp=85 :: H 1/7 score=23 bad csi=0.07 | A[now:cc now:fc soon:cya soon:ta soon:salt tune:ph] | PASS
#11901 [plaster+salt] fc=0,cc=0,ph=7.4,ta=130,cya=40,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=0.09 | A[now:fc soon:cya soon:ta soon:salt tune:ph tune:ch] | PASS
#11936 [plaster+salt] fc=0,cc=0,ph=7.4,ta=130,cya=50,ch=700,salt=3200,temp=85 :: H 2/7 score=38 bad csi=0.24 | A[now:fc soon:cya soon:ta soon:ch tune:ph] | PASS
#11971 [plaster+salt] fc=0,cc=0,ph=7.4,ta=130,cya=90,ch=150,salt=2500,temp=85 :: H 1/7 score=38 bad csi=-0.43 | A[now:fc soon:ta soon:ch soon:salt tune:cya tune:ph tune:csi] | PASS
#12006 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=40,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=19 bad csi=-0.77 | A[now:cc now:fc soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#12041 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=40,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.55 | A[now:cc now:fc soon:cya soon:ta tune:csi] | PASS
#12076 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=40,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=27 bad csi=-0.45 | A[now:cc now:fc soon:cya soon:ta soon:salt tune:csi] | PASS
#12111 [plaster+salt] fc=0,cc=0,ph=7.6,ta=40,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=54 bad csi=-0.55 | A[now:fc soon:ta soon:salt tune:ch tune:csi] | PASS
#12146 [plaster+salt] fc=0,cc=0,ph=7.6,ta=40,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=46 bad csi=-0.61 | A[now:fc soon:ta soon:ch soon:csi tune:cya] | PASS
#12181 [plaster+salt] fc=0,cc=0,ph=7.6,ta=60,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=46 bad csi=-0.57 | A[now:fc soon:cya soon:ch soon:salt tune:csi] | PASS
#12216 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=60,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=27 bad csi=-0.66 | A[now:cc now:fc soon:cya soon:ch soon:csi soon:salt] | PASS
#12251 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=60,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=58 bad csi=-0.41 | A[now:cc now:fc tune:csi] | PASS
#12286 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=60,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=42 bad csi=-0.34 | A[now:cc now:fc soon:salt tune:cya tune:csi] | PASS
#12321 [plaster+salt] fc=0,cc=0,ph=7.6,ta=80,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=50 bad csi=0.09 | A[now:fc soon:cya soon:salt tune:ch] | PASS
#12356 [plaster+salt] fc=0,cc=0,ph=7.6,ta=80,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=54 bad csi=0.21 | A[now:fc soon:cya soon:ch] | PASS
#12391 [plaster+salt] fc=0,cc=0,ph=7.6,ta=80,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=62 bad csi=-0.48 | A[now:fc soon:ch soon:salt tune:csi] | PASS
#12426 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=80,cya=90,ch=150,salt=3700,temp=85 :: H 2/7 score=38 bad csi=-0.59 | A[now:cc now:fc soon:ch soon:salt tune:cya tune:csi] | PASS
#12461 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=100,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=42 bad csi=-0.01 | A[now:cc now:fc soon:cya tune:ta] | PASS
#12496 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=100,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=35 bad csi=0.12 | A[now:cc now:fc soon:cya soon:salt tune:ta] | PASS
#12531 [plaster+salt] fc=0,cc=0,ph=7.6,ta=100,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=46 bad csi=0.14 | A[now:fc soon:cya soon:salt tune:ta tune:ch] | PASS
#12566 [plaster+salt] fc=0,cc=0,ph=7.6,ta=100,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.27 | A[now:fc soon:ch tune:ta] | PASS
#12601 [plaster+salt] fc=0,cc=0,ph=7.6,ta=130,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.15 | A[now:fc soon:cya soon:ta soon:ch soon:salt] | PASS
#12636 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=130,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-0.23 | A[now:cc now:fc soon:cya soon:ta soon:ch soon:salt] | PASS
#12671 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=130,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=0.08 | A[now:cc now:fc soon:cya soon:ta] | PASS
#12706 [plaster+salt] fc=0,cc=0.6,ph=7.6,ta=130,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=46 bad csi=0.21 | A[now:cc now:fc soon:ta soon:salt] | PASS
#12741 [plaster+salt] fc=0,cc=0,ph=7.6,ta=130,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=0.22 | A[now:fc soon:ta soon:salt tune:cya tune:ch] | PASS
#12776 [plaster+salt] fc=0,cc=0,ph=7.8,ta=40,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=46 bad csi=0.1 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#12811 [plaster+salt] fc=0,cc=0,ph=7.8,ta=40,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=35 bad csi=-0.68 | A[now:fc soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#12846 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=40,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=35 bad csi=-0.9 | A[now:cc now:fc soon:ta soon:ch soon:csi soon:salt] | PASS
#12881 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=40,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=-0.84 | A[now:cc now:fc soon:ta soon:csi tune:cya] | PASS
#12916 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=60,cya=20,ch=400,salt=2500,temp=85 :: H 3/7 score=38 bad csi=0.11 | A[now:cc now:fc soon:cya soon:salt] | PASS
#12951 [plaster+salt] fc=0,cc=0,ph=7.8,ta=60,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=50 bad csi=0.08 | A[now:fc soon:cya soon:salt tune:ch] | PASS
#12986 [plaster+salt] fc=0,cc=0,ph=7.8,ta=60,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=54 bad csi=0.21 | A[now:fc soon:cya soon:ch] | PASS
#13021 [plaster+salt] fc=0,cc=0,ph=7.8,ta=60,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.58 | A[now:fc soon:ch soon:salt tune:cya tune:csi] | PASS
#13056 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=80,cya=20,ch=150,salt=3700,temp=85 :: H 2/7 score=35 bad csi=-0.23 | A[now:cc now:fc soon:cya soon:ch soon:salt] | PASS
#13091 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=80,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=46 bad csi=0.04 | A[now:cc now:fc soon:cya] | PASS
#13126 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=80,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=38 bad csi=0.18 | A[now:cc now:fc soon:cya soon:salt] | PASS
#13161 [plaster+salt] fc=0,cc=0,ph=7.8,ta=80,cya=70,ch=500,salt=3700,temp=85 :: H 4/7 score=65 bad csi=0.16 | A[now:fc soon:salt tune:ch] | PASS
#13196 [plaster+salt] fc=0,cc=0,ph=7.8,ta=80,cya=90,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.27 | A[now:fc soon:ch tune:cya] | PASS
#13231 [plaster+salt] fc=0,cc=0,ph=7.8,ta=100,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.1 | A[now:fc soon:cya soon:ch soon:salt tune:ta] | PASS
#13266 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=100,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.18 | A[now:cc now:fc soon:cya soon:ch soon:salt tune:ta] | PASS
#13301 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=100,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=0.1 | A[now:cc now:fc tune:ta] | PASS
#13336 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=100,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=0.22 | A[now:cc now:fc soon:salt tune:cya tune:ta] | PASS
#13371 [plaster+salt] fc=0,cc=0,ph=7.8,ta=130,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=38 bad csi=0.51 | A[now:fc soon:cya soon:ta soon:salt tune:ch tune:csi] | PASS
#13406 [plaster+salt] fc=0,cc=0,ph=7.8,ta=130,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=38 bad csi=0.64 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#13441 [plaster+salt] fc=0,cc=0,ph=7.8,ta=130,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.02 | A[now:fc soon:ta soon:ch soon:salt] | PASS
#13476 [plaster+salt] fc=0,cc=0.6,ph=7.8,ta=130,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.1 | A[now:cc now:fc soon:ta soon:ch soon:salt tune:cya] | PASS
#13511 [plaster+salt] fc=0,cc=0.6,ph=8,ta=40,cya=20,ch=300,salt=3200,temp=85 :: H 2/7 score=31 bad csi=-0.06 | A[now:cc now:fc soon:cya soon:ph soon:ta] | PASS
#13546 [plaster+salt] fc=0,cc=0.6,ph=8,ta=40,cya=40,ch=400,salt=2500,temp=85 :: H 1/7 score=23 bad csi=-0.01 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:salt] | PASS
#13581 [plaster+salt] fc=0,cc=0,ph=8,ta=40,cya=50,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.04 | A[now:fc soon:cya soon:ph soon:ta soon:salt tune:ch] | PASS
#13616 [plaster+salt] fc=0,cc=0,ph=8,ta=40,cya=70,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.05 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#13651 [plaster+salt] fc=0,cc=0,ph=8,ta=60,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.11 | A[now:fc soon:cya soon:ph soon:ch soon:salt] | PASS
#13686 [plaster+salt] fc=0,cc=0.6,ph=8,ta=60,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-0.24 | A[now:cc now:fc soon:cya soon:ph soon:ch soon:salt] | PASS
#13721 [plaster+salt] fc=0,cc=0.6,ph=8,ta=60,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=0.05 | A[now:cc now:fc soon:cya soon:ph] | PASS
#13756 [plaster+salt] fc=0,cc=0.6,ph=8,ta=60,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=46 bad csi=0.12 | A[now:cc now:fc soon:ph soon:salt] | PASS
#13791 [plaster+salt] fc=0,cc=0,ph=8,ta=60,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=0.06 | A[now:fc soon:ph soon:salt tune:cya tune:ch] | PASS
#13826 [plaster+salt] fc=0,cc=0,ph=8,ta=80,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=38 bad csi=0.64 | A[now:fc soon:cya soon:ph soon:ch soon:csi] | PASS
#13861 [plaster+salt] fc=0,cc=0,ph=8,ta=80,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.05 | A[now:fc soon:cya soon:ph soon:ch soon:salt] | PASS
#13896 [plaster+salt] fc=0,cc=0.6,ph=8,ta=80,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.16 | A[now:cc now:fc soon:ph soon:ch soon:salt] | PASS
#13931 [plaster+salt] fc=0,cc=0.6,ph=8,ta=80,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=46 bad csi=0.1 | A[now:cc now:fc soon:ph tune:cya] | PASS
#13966 [plaster+salt] fc=0,cc=0.6,ph=8,ta=100,cya=20,ch=400,salt=2500,temp=85 :: H 1/7 score=23 bad csi=0.55 | A[now:cc now:fc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#14001 [plaster+salt] fc=0,cc=0,ph=8,ta=100,cya=40,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=0.55 | A[now:fc soon:cya soon:ph soon:salt tune:ta tune:ch tune:csi] | PASS
#14036 [plaster+salt] fc=0,cc=0,ph=8,ta=100,cya=50,ch=700,salt=3200,temp=85 :: H 2/7 score=35 bad csi=0.69 | A[now:fc soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#14071 [plaster+salt] fc=0,cc=0,ph=8,ta=100,cya=90,ch=150,salt=2500,temp=85 :: H 1/7 score=46 bad csi=-0.01 | A[now:fc soon:ph soon:ch soon:salt tune:cya tune:ta] | PASS
#14106 [plaster+salt] fc=0,cc=0.6,ph=8,ta=130,cya=20,ch=150,salt=3700,temp=85 :: H 0/7 score=19 bad csi=0.19 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#14141 [plaster+salt] fc=0,cc=0.6,ph=8,ta=130,cya=40,ch=300,salt=3200,temp=85 :: H 2/7 score=27 bad csi=0.48 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#14176 [plaster+salt] fc=0,cc=0.6,ph=8,ta=130,cya=50,ch=400,salt=2500,temp=85 :: H 1/7 score=15 bad csi=0.63 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#14211 [plaster+salt] fc=0,cc=0,ph=8,ta=130,cya=70,ch=500,salt=3700,temp=85 :: H 2/7 score=42 bad csi=0.64 | A[now:fc soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#14246 [plaster+salt] fc=0,cc=0,ph=8,ta=130,cya=90,ch=700,salt=3200,temp=85 :: H 2/7 score=38 bad csi=0.77 | A[now:fc soon:ph soon:ta soon:ch soon:csi tune:cya] | PASS
#14281 [plaster+salt] fc=0,cc=0,ph=8.3,ta=40,cya=40,ch=150,salt=2500,temp=85 :: H 1/7 score=27 bad csi=-0.14 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#14316 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=40,cya=50,ch=150,salt=3700,temp=85 :: H 0/7 score=12 bad csi=-0.26 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#14351 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=40,cya=70,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=-0.13 | A[now:cc now:fc soon:ph soon:ta] | PASS
#14386 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=40,cya=90,ch=400,salt=2500,temp=85 :: H 1/7 score=19 bad csi=-0.32 | A[now:cc now:fc soon:ph soon:ta soon:salt tune:cya tune:csi] | PASS
#14421 [plaster+salt] fc=0,cc=0,ph=8.3,ta=60,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=27 bad csi=0.64 | A[now:fc soon:cya soon:ph soon:csi soon:salt tune:ch] | PASS
#14456 [plaster+salt] fc=0,cc=0,ph=8.3,ta=60,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=31 bad csi=0.74 | A[now:fc soon:cya soon:ph soon:ch soon:csi] | PASS
#14491 [plaster+salt] fc=0,cc=0,ph=8.3,ta=60,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-0.01 | A[now:fc soon:ph soon:ch soon:salt] | PASS
#14526 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=60,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-0.17 | A[now:cc now:fc soon:ph soon:ch soon:salt tune:cya] | PASS
#14561 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=80,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=27 bad csi=0.59 | A[now:cc now:fc soon:cya soon:ph tune:csi] | PASS
#14596 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=80,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=15 bad csi=0.69 | A[now:cc now:fc soon:cya soon:ph soon:csi soon:salt] | PASS
#14631 [plaster+salt] fc=0,cc=0,ph=8.3,ta=80,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=27 bad csi=0.71 | A[now:fc soon:cya soon:ph soon:csi soon:salt tune:ch] | PASS
#14666 [plaster+salt] fc=0,cc=0,ph=8.3,ta=80,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=46 bad csi=0.81 | A[now:fc soon:ph soon:ch soon:csi] | PASS
#14701 [plaster+salt] fc=0,cc=0,ph=8.3,ta=100,cya=20,ch=150,salt=2500,temp=85 :: H 1/7 score=27 bad csi=0.43 | A[now:fc soon:cya soon:ph soon:ch soon:salt tune:ta tune:csi] | PASS
#14736 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=100,cya=40,ch=150,salt=3700,temp=85 :: H 0/7 score=12 bad csi=0.33 | A[now:cc now:fc soon:cya soon:ph soon:ch soon:salt tune:ta tune:csi] | PASS
#14771 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=100,cya=50,ch=300,salt=3200,temp=85 :: H 2/7 score=19 bad csi=0.63 | A[now:cc now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#14806 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=100,cya=70,ch=400,salt=2500,temp=85 :: H 2/7 score=27 bad csi=0.75 | A[now:cc now:fc soon:ph soon:csi soon:salt tune:ta] | PASS
#14841 [plaster+salt] fc=0,cc=0,ph=8.3,ta=100,cya=90,ch=500,salt=3700,temp=85 :: H 1/7 score=31 bad csi=0.74 | A[now:fc soon:ph soon:csi soon:salt tune:cya tune:ta tune:ch] | PASS
#14876 [plaster+salt] fc=0,cc=0,ph=8.3,ta=130,cya=20,ch=700,salt=3200,temp=85 :: H 2/7 score=23 bad csi=1.17 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#14911 [plaster+salt] fc=0,cc=0,ph=8.3,ta=130,cya=50,ch=150,salt=2500,temp=85 :: H 1/7 score=23 bad csi=0.51 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#14946 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=130,cya=70,ch=150,salt=3700,temp=85 :: H 1/7 score=23 bad csi=0.42 | A[now:cc now:fc soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#14981 [plaster+salt] fc=0,cc=0.6,ph=8.3,ta=130,cya=90,ch=300,salt=3200,temp=85 :: H 2/7 score=23 bad csi=0.71 | A[now:cc now:fc soon:ph soon:ta soon:csi tune:cya] | PASS
#15016 [plaster+salt] fc=2,cc=0.6,ph=7,ta=40,cya=20,ch=400,salt=2500,temp=85 :: H 1/7 score=19 bad csi=-0.87 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi soon:salt] | PASS
#15051 [plaster+salt] fc=2,cc=0,ph=7,ta=40,cya=40,ch=500,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.89 | A[soon:cya soon:fc soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#15086 [plaster+salt] fc=2,cc=0,ph=7,ta=40,cya=50,ch=700,salt=3200,temp=85 :: H 2/7 score=35 bad csi=-0.76 | A[soon:cya soon:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#15121 [plaster+salt] fc=2,cc=0,ph=7,ta=40,cya=90,ch=150,salt=2500,temp=85 :: H 1/7 score=27 bad csi=-1.55 | A[now:fc soon:ph soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#15156 [plaster+salt] fc=2,cc=0.6,ph=7,ta=60,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=23 bad csi=-1.15 | A[now:cc soon:cya soon:fc soon:ph soon:ch soon:csi soon:salt] | PASS
#15191 [plaster+salt] fc=2,cc=0.6,ph=7,ta=60,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.87 | A[now:cc soon:cya soon:fc soon:ph soon:csi] | PASS
#15226 [plaster+salt] fc=2,cc=0.6,ph=7,ta=60,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=27 bad csi=-0.73 | A[now:cc soon:cya soon:fc soon:ph soon:csi soon:salt] | PASS
#15261 [plaster+salt] fc=2,cc=0,ph=7,ta=60,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=42 bad csi=-0.74 | A[now:fc soon:ph soon:csi soon:salt tune:ch] | PASS
#15296 [plaster+salt] fc=2,cc=0,ph=7,ta=60,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=38 bad csi=-0.62 | A[now:fc soon:ph soon:ch soon:csi tune:cya] | PASS
#15331 [plaster+salt] fc=2,cc=0,ph=7,ta=80,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=38 bad csi=-0.99 | A[soon:cya soon:fc soon:ph soon:ch soon:csi soon:salt] | PASS
#15366 [plaster+salt] fc=2,cc=0.6,ph=7,ta=80,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=23 bad csi=-1.06 | A[now:cc soon:cya soon:fc soon:ph soon:ch soon:csi soon:salt] | PASS
#15401 [plaster+salt] fc=2,cc=0.6,ph=7,ta=80,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=38 bad csi=-0.77 | A[now:cc now:fc soon:ph soon:csi] | PASS
#15436 [plaster+salt] fc=2,cc=0.6,ph=7,ta=80,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=23 bad csi=-0.65 | A[now:cc now:fc soon:ph soon:csi soon:salt tune:cya] | PASS
#15471 [plaster+salt] fc=2,cc=0,ph=7,ta=100,cya=20,ch=500,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.4 | A[soon:cya soon:fc soon:ph soon:salt tune:ta tune:ch tune:csi] | PASS
#15506 [plaster+salt] fc=2,cc=0,ph=7,ta=100,cya=40,ch=700,salt=3200,temp=85 :: H 2/7 score=46 bad csi=-0.26 | A[soon:cya soon:fc soon:ph soon:ch tune:ta] | PASS
#15541 [plaster+salt] fc=2,cc=0,ph=7,ta=100,cya=70,ch=150,salt=2500,temp=85 :: H 2/7 score=38 bad csi=-0.91 | A[now:fc soon:ph soon:ch soon:csi soon:salt tune:ta] | PASS
#15576 [plaster+salt] fc=2,cc=0.6,ph=7,ta=100,cya=90,ch=150,salt=3700,temp=85 :: H 0/7 score=15 bad csi=-1 | A[now:cc now:fc soon:ph soon:ch soon:csi soon:salt tune:cya tune:ta] | PASS
#15611 [plaster+salt] fc=2,cc=0.6,ph=7,ta=130,cya=20,ch=300,salt=3200,temp=85 :: H 2/7 score=31 bad csi=-0.48 | A[now:cc soon:cya soon:fc soon:ph soon:ta tune:csi] | PASS
#15646 [plaster+salt] fc=2,cc=0.6,ph=7,ta=130,cya=40,ch=400,salt=2500,temp=85 :: H 1/7 score=23 bad csi=-0.34 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:salt tune:csi] | PASS
#15681 [plaster+salt] fc=2,cc=0,ph=7,ta=130,cya=50,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.31 | A[soon:cya soon:fc soon:ph soon:ta soon:salt tune:ch tune:csi] | PASS
#15716 [plaster+salt] fc=2,cc=0,ph=7,ta=130,cya=70,ch=700,salt=3200,temp=85 :: H 3/7 score=46 bad csi=-0.16 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#15751 [plaster+salt] fc=2,cc=0,ph=7.4,ta=40,cya=20,ch=150,salt=2500,temp=85 :: H 1/7 score=38 bad csi=-0.9 | A[soon:cya soon:fc soon:ta soon:ch soon:csi soon:salt tune:ph] | PASS
#15786 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=40,cya=40,ch=150,salt=3700,temp=85 :: H 0/7 score=23 bad csi=-1.05 | A[now:cc soon:cya soon:fc soon:ta soon:ch soon:csi soon:salt tune:ph] | PASS
#15821 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=40,cya=50,ch=300,salt=3200,temp=85 :: H 2/7 score=35 bad csi=-0.78 | A[now:cc soon:cya soon:fc soon:ta soon:csi tune:ph] | PASS
#15856 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=40,cya=70,ch=400,salt=2500,temp=85 :: H 2/7 score=31 bad csi=-0.75 | A[now:cc now:fc soon:ta soon:csi soon:salt tune:ph] | PASS
#15891 [plaster+salt] fc=2,cc=0,ph=7.4,ta=40,cya=90,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.88 | A[now:fc soon:ta soon:csi soon:salt tune:cya tune:ph tune:ch] | PASS
#15926 [plaster+salt] fc=2,cc=0,ph=7.4,ta=60,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=-0.09 | A[soon:cya soon:fc soon:ch tune:ph] | PASS
#15961 [plaster+salt] fc=2,cc=0,ph=7.4,ta=60,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.78 | A[soon:cya soon:fc soon:ch soon:csi soon:salt tune:ph] | PASS
#15996 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=60,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=35 bad csi=-0.91 | A[now:cc now:fc soon:ch soon:csi soon:salt tune:ph] | PASS
#16031 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=60,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=-0.66 | A[now:cc now:fc soon:csi tune:cya tune:ph] | PASS
#16066 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=80,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.15 | A[now:cc soon:cya soon:fc soon:salt tune:ph] | PASS
#16101 [plaster+salt] fc=2,cc=0,ph=7.4,ta=80,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.15 | A[soon:cya soon:fc soon:salt tune:ph tune:ch] | PASS
#16136 [plaster+salt] fc=2,cc=0,ph=7.4,ta=80,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=-0.01 | A[soon:cya soon:fc soon:ch tune:ph] | PASS
#16171 [plaster+salt] fc=2,cc=0,ph=7.4,ta=80,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.72 | A[now:fc soon:ch soon:csi soon:salt tune:cya tune:ph] | PASS
#16206 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=100,cya=20,ch=150,salt=3700,temp=85 :: H 0/7 score=31 bad csi=-0.52 | A[now:cc soon:cya soon:fc soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#16241 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=100,cya=40,ch=300,salt=3200,temp=85 :: H 2/7 score=46 bad csi=-0.23 | A[now:cc soon:cya soon:fc tune:ph tune:ta] | PASS
#16276 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=100,cya=50,ch=400,salt=2500,temp=85 :: H 1/7 score=38 bad csi=-0.09 | A[now:cc soon:cya soon:fc soon:salt tune:ph tune:ta] | PASS
#16311 [plaster+salt] fc=2,cc=0,ph=7.4,ta=100,cya=70,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.09 | A[now:fc soon:salt tune:ph tune:ta tune:ch] | PASS
#16346 [plaster+salt] fc=2,cc=0,ph=7.4,ta=100,cya=90,ch=700,salt=3200,temp=85 :: H 2/7 score=50 bad csi=0.04 | A[now:fc soon:ch tune:cya tune:ph tune:ta] | PASS
#16381 [plaster+salt] fc=2,cc=0,ph=7.4,ta=130,cya=40,ch=150,salt=2500,temp=85 :: H 1/7 score=42 bad csi=-0.37 | A[soon:cya soon:fc soon:ta soon:ch soon:salt tune:ph tune:csi] | PASS
#16416 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=130,cya=50,ch=150,salt=3700,temp=85 :: H 0/7 score=27 bad csi=-0.44 | A[now:cc soon:cya soon:fc soon:ta soon:ch soon:salt tune:ph tune:csi] | PASS
#16451 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=130,cya=70,ch=300,salt=3200,temp=85 :: H 3/7 score=46 bad csi=-0.14 | A[now:cc now:fc soon:ta tune:ph] | PASS
#16486 [plaster+salt] fc=2,cc=0.6,ph=7.4,ta=130,cya=90,ch=400,salt=2500,temp=85 :: H 1/7 score=31 bad csi=-0.01 | A[now:cc now:fc soon:ta soon:salt tune:cya tune:ph] | PASS
#16521 [plaster+salt] fc=2,cc=0,ph=7.6,ta=40,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.25 | A[soon:cya soon:fc soon:ta soon:salt tune:ch] | PASS
#16556 [plaster+salt] fc=2,cc=0,ph=7.6,ta=40,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=-0.19 | A[soon:cya soon:fc soon:ta soon:ch] | PASS
#16591 [plaster+salt] fc=2,cc=0,ph=7.6,ta=40,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-1.01 | A[now:fc soon:ta soon:ch soon:csi soon:salt] | PASS
#16626 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=40,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-1.28 | A[now:cc now:fc soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#16661 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=60,cya=20,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.25 | A[now:cc soon:cya soon:fc] | PASS
#16696 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=60,cya=40,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-0.15 | A[now:cc soon:cya soon:fc soon:salt] | PASS
#16731 [plaster+salt] fc=2,cc=0,ph=7.6,ta=60,cya=50,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=-0.14 | A[soon:cya soon:fc soon:salt tune:ch] | PASS
#16766 [plaster+salt] fc=2,cc=0,ph=7.6,ta=60,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=69 bad csi=-0.05 | A[now:fc soon:ch] | PASS
#16801 [plaster+salt] fc=2,cc=0,ph=7.6,ta=80,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.37 | A[soon:cya soon:fc soon:ch soon:salt tune:csi] | PASS
#16836 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=80,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.47 | A[now:cc soon:cya soon:fc soon:ch soon:salt tune:csi] | PASS
#16871 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=80,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.17 | A[now:cc soon:cya soon:fc] | PASS
#16906 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=80,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=54 bad csi=-0.06 | A[now:cc now:fc soon:salt] | PASS
#16941 [plaster+salt] fc=2,cc=0,ph=7.6,ta=80,cya=90,ch=500,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-0.08 | A[now:fc soon:salt tune:cya tune:ch] | PASS
#16976 [plaster+salt] fc=2,cc=0,ph=7.6,ta=100,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=0.35 | A[soon:cya soon:fc soon:ch tune:ta tune:csi] | PASS
#17011 [plaster+salt] fc=2,cc=0,ph=7.6,ta=100,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=54 bad csi=-0.32 | A[soon:cya soon:fc soon:ch soon:salt tune:ta tune:csi] | PASS
#17046 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=100,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.41 | A[now:cc now:fc soon:ch soon:salt tune:ta tune:csi] | PASS
#17081 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=100,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=-0.13 | A[now:cc now:fc tune:cya tune:ta] | PASS
#17116 [plaster+salt] fc=2,cc=0.6,ph=7.6,ta=130,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=0.27 | A[now:cc soon:cya soon:fc soon:ta soon:salt] | PASS
#17151 [plaster+salt] fc=2,cc=0,ph=7.6,ta=130,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=0.29 | A[soon:cya soon:fc soon:ta soon:salt tune:ch] | PASS
#17186 [plaster+salt] fc=2,cc=0,ph=7.6,ta=130,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.43 | A[soon:cya soon:fc soon:ta soon:ch tune:csi] | PASS
#17221 [plaster+salt] fc=2,cc=0,ph=7.6,ta=130,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-0.24 | A[now:fc soon:ta soon:ch soon:salt tune:cya] | PASS
#17256 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=40,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.57 | A[now:cc soon:cya soon:fc soon:ta soon:ch soon:salt tune:csi] | PASS
#17291 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=40,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=46 bad csi=-0.36 | A[now:cc soon:cya soon:fc soon:ta tune:csi] | PASS
#17326 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=40,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.26 | A[now:cc soon:cya soon:fc soon:ta soon:salt] | PASS
#17361 [plaster+salt] fc=2,cc=0,ph=7.8,ta=40,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=54 bad csi=-0.39 | A[now:fc soon:ta soon:salt tune:ch tune:csi] | PASS
#17396 [plaster+salt] fc=2,cc=0,ph=7.8,ta=40,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=50 bad csi=-0.49 | A[now:fc soon:ta soon:ch tune:cya tune:csi] | PASS
#17431 [plaster+salt] fc=2,cc=0,ph=7.8,ta=60,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.37 | A[soon:cya soon:fc soon:ch soon:salt tune:csi] | PASS
#17466 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=60,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.46 | A[now:cc soon:cya soon:fc soon:ch soon:salt tune:csi] | PASS
#17501 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=60,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=62 bad csi=-0.22 | A[now:cc now:fc] | PASS
#17536 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=60,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=46 bad csi=-0.16 | A[now:cc now:fc soon:salt tune:cya] | PASS
#17571 [plaster+salt] fc=2,cc=0,ph=7.8,ta=80,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=0.28 | A[soon:cya soon:fc soon:salt tune:ch] | PASS
#17606 [plaster+salt] fc=2,cc=0,ph=7.8,ta=80,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.4 | A[soon:cya soon:fc soon:ch tune:csi] | PASS
#17641 [plaster+salt] fc=2,cc=0,ph=7.8,ta=80,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=65 bad csi=-0.29 | A[now:fc soon:ch soon:salt] | PASS
#17676 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=80,cya=90,ch=150,salt=3700,temp=85 :: H 2/7 score=38 bad csi=-0.41 | A[now:cc now:fc soon:ch soon:salt tune:cya tune:csi] | PASS
#17711 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=100,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.19 | A[now:cc soon:cya soon:fc tune:ta] | PASS
#17746 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=100,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=0.31 | A[now:cc soon:cya soon:fc soon:salt tune:ta tune:csi] | PASS
#17781 [plaster+salt] fc=2,cc=0,ph=7.8,ta=100,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=0.34 | A[soon:cya soon:fc soon:salt tune:ta tune:ch tune:csi] | PASS
#17816 [plaster+salt] fc=2,cc=0,ph=7.8,ta=100,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.46 | A[now:fc soon:ch tune:ta tune:csi] | PASS
#17851 [plaster+salt] fc=2,cc=0,ph=7.8,ta=130,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=54 bad csi=0.05 | A[soon:cya soon:fc soon:ta soon:ch soon:salt] | PASS
#17886 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=130,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.03 | A[now:cc soon:cya soon:fc soon:ta soon:ch soon:salt] | PASS
#17921 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=130,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.27 | A[now:cc soon:cya soon:fc soon:ta] | PASS
#17956 [plaster+salt] fc=2,cc=0.6,ph=7.8,ta=130,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=42 bad csi=0.4 | A[now:cc now:fc soon:ta soon:salt tune:csi] | PASS
#17991 [plaster+salt] fc=2,cc=0,ph=7.8,ta=130,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=46 bad csi=0.41 | A[now:fc soon:ta soon:salt tune:cya tune:ch tune:csi] | PASS
#18026 [plaster+salt] fc=2,cc=0,ph=8,ta=40,cya=20,ch=700,salt=3200,temp=85 :: H 2/7 score=50 bad csi=0.3 | A[soon:cya soon:fc soon:ph soon:ta soon:ch] | PASS
#18061 [plaster+salt] fc=2,cc=0,ph=8,ta=40,cya=50,ch=150,salt=2500,temp=85 :: H 1/7 score=42 bad csi=-0.49 | A[soon:cya soon:fc soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#18096 [plaster+salt] fc=2,cc=0.6,ph=8,ta=40,cya=70,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-0.73 | A[now:cc now:fc soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#18131 [plaster+salt] fc=2,cc=0.6,ph=8,ta=40,cya=90,ch=300,salt=3200,temp=85 :: H 2/7 score=31 bad csi=-0.71 | A[now:cc now:fc soon:ph soon:ta soon:csi tune:cya] | PASS
#18166 [plaster+salt] fc=2,cc=0.6,ph=8,ta=60,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=0.3 | A[now:cc soon:cya soon:fc soon:ph soon:salt] | PASS
#18201 [plaster+salt] fc=2,cc=0,ph=8,ta=60,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=0.28 | A[soon:cya soon:fc soon:ph soon:salt tune:ch] | PASS
#18236 [plaster+salt] fc=2,cc=0,ph=8,ta=60,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.4 | A[soon:cya soon:fc soon:ph soon:ch tune:csi] | PASS
#18271 [plaster+salt] fc=2,cc=0,ph=8,ta=60,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.4 | A[now:fc soon:ph soon:ch soon:salt tune:cya tune:csi] | PASS
#18306 [plaster+salt] fc=2,cc=0.6,ph=8,ta=80,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.03 | A[now:cc soon:cya soon:fc soon:ph soon:ch soon:salt] | PASS
#18341 [plaster+salt] fc=2,cc=0.6,ph=8,ta=80,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.24 | A[now:cc soon:cya soon:fc soon:ph] | PASS
#18376 [plaster+salt] fc=2,cc=0.6,ph=8,ta=80,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.37 | A[now:cc soon:cya soon:fc soon:ph soon:salt tune:csi] | PASS
#18411 [plaster+salt] fc=2,cc=0,ph=8,ta=80,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=54 bad csi=0.36 | A[now:fc soon:ph soon:salt tune:ch tune:csi] | PASS
#18446 [plaster+salt] fc=2,cc=0,ph=8,ta=80,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.46 | A[now:fc soon:ph soon:ch tune:cya tune:csi] | PASS
#18481 [plaster+salt] fc=2,cc=0,ph=8,ta=100,cya=40,ch=150,salt=2500,temp=85 :: H 1/7 score=50 bad csi=0.09 | A[soon:cya soon:fc soon:ph soon:ch soon:salt tune:ta] | PASS
#18516 [plaster+salt] fc=2,cc=0.6,ph=8,ta=100,cya=50,ch=150,salt=3700,temp=85 :: H 0/7 score=35 bad csi=0.02 | A[now:cc soon:cya soon:fc soon:ph soon:ch soon:salt tune:ta] | PASS
#18551 [plaster+salt] fc=2,cc=0.6,ph=8,ta=100,cya=70,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.3 | A[now:cc now:fc soon:ph tune:ta] | PASS
#18586 [plaster+salt] fc=2,cc=0.6,ph=8,ta=100,cya=90,ch=400,salt=2500,temp=85 :: H 1/7 score=31 bad csi=0.41 | A[now:cc now:fc soon:ph soon:salt tune:cya tune:ta tune:csi] | PASS
#18621 [plaster+salt] fc=2,cc=0,ph=8,ta=130,cya=20,ch=500,salt=3700,temp=85 :: H 1/7 score=38 bad csi=0.71 | A[soon:cya soon:fc soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#18656 [plaster+salt] fc=2,cc=0,ph=8,ta=130,cya=40,ch=700,salt=3200,temp=85 :: H 2/7 score=42 bad csi=0.84 | A[soon:cya soon:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#18691 [plaster+salt] fc=2,cc=0,ph=8,ta=130,cya=70,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=0.18 | A[now:fc soon:ph soon:ta soon:ch soon:salt] | PASS
#18726 [plaster+salt] fc=2,cc=0.6,ph=8,ta=130,cya=90,ch=150,salt=3700,temp=85 :: H 0/7 score=27 bad csi=0.09 | A[now:cc now:fc soon:ph soon:ta soon:ch soon:salt tune:cya] | PASS
#18761 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=40,cya=20,ch=300,salt=3200,temp=85 :: H 2/7 score=35 bad csi=0.24 | A[now:cc soon:cya soon:fc soon:ph soon:ta] | PASS
#18796 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=40,cya=40,ch=400,salt=2500,temp=85 :: H 1/7 score=27 bad csi=0.28 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:salt] | PASS
#18831 [plaster+salt] fc=2,cc=0,ph=8.3,ta=40,cya=50,ch=500,salt=3700,temp=85 :: H 1/7 score=38 bad csi=0.25 | A[soon:cya soon:fc soon:ph soon:ta soon:salt tune:ch] | PASS
#18866 [plaster+salt] fc=2,cc=0,ph=8.3,ta=40,cya=70,ch=700,salt=3200,temp=85 :: H 3/7 score=46 bad csi=0.22 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#18901 [plaster+salt] fc=2,cc=0,ph=8.3,ta=60,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.18 | A[soon:cya soon:fc soon:ph soon:ch soon:salt] | PASS
#18936 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=60,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=0.06 | A[now:cc soon:cya soon:fc soon:ph soon:ch soon:salt] | PASS
#18971 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=60,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=0.34 | A[now:cc soon:cya soon:fc soon:ph tune:csi] | PASS
#19006 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=60,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=35 bad csi=0.41 | A[now:cc now:fc soon:ph soon:salt tune:csi] | PASS
#19041 [plaster+salt] fc=2,cc=0,ph=8.3,ta=60,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=38 bad csi=0.34 | A[now:fc soon:ph soon:salt tune:cya tune:ch tune:csi] | PASS
#19076 [plaster+salt] fc=2,cc=0,ph=8.3,ta=80,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=42 bad csi=0.94 | A[soon:cya soon:fc soon:ph soon:ch soon:csi] | PASS
#19111 [plaster+salt] fc=2,cc=0,ph=8.3,ta=80,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.25 | A[soon:cya soon:fc soon:ph soon:ch soon:salt] | PASS
#19146 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=80,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=35 bad csi=0.14 | A[now:cc now:fc soon:ph soon:ch soon:salt] | PASS
#19181 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=80,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=35 bad csi=0.39 | A[now:cc now:fc soon:ph tune:cya tune:csi] | PASS
#19216 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=100,cya=20,ch=400,salt=2500,temp=85 :: H 1/7 score=23 bad csi=0.85 | A[now:cc soon:cya soon:fc soon:ph soon:csi soon:salt tune:ta] | PASS
#19251 [plaster+salt] fc=2,cc=0,ph=8.3,ta=100,cya=40,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=0.85 | A[soon:cya soon:fc soon:ph soon:csi soon:salt tune:ta tune:ch] | PASS
#19286 [plaster+salt] fc=2,cc=0,ph=8.3,ta=100,cya=50,ch=700,salt=3200,temp=85 :: H 2/7 score=38 bad csi=0.99 | A[soon:cya soon:fc soon:ph soon:ch soon:csi tune:ta] | PASS
#19321 [plaster+salt] fc=2,cc=0,ph=8.3,ta=100,cya=90,ch=150,salt=2500,temp=85 :: H 1/7 score=38 bad csi=0.28 | A[now:fc soon:ph soon:ch soon:salt tune:cya tune:ta] | PASS
#19356 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=130,cya=20,ch=150,salt=3700,temp=85 :: H 0/7 score=19 bad csi=0.49 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#19391 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=130,cya=40,ch=300,salt=3200,temp=85 :: H 2/7 score=27 bad csi=0.78 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi] | PASS
#19426 [plaster+salt] fc=2,cc=0.6,ph=8.3,ta=130,cya=50,ch=400,salt=2500,temp=85 :: H 1/7 score=19 bad csi=0.92 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi soon:salt] | PASS
#19461 [plaster+salt] fc=2,cc=0,ph=8.3,ta=130,cya=70,ch=500,salt=3700,temp=85 :: H 2/7 score=35 bad csi=0.93 | A[now:fc soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#19496 [plaster+salt] fc=2,cc=0,ph=8.3,ta=130,cya=90,ch=700,salt=3200,temp=85 :: H 2/7 score=31 bad csi=1.06 | A[now:fc soon:ph soon:ta soon:ch soon:csi tune:cya] | PASS
#19531 [plaster+salt] fc=3,cc=0,ph=7,ta=40,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-1.35 | A[soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#19566 [plaster+salt] fc=3,cc=0.6,ph=7,ta=40,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-1.44 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#19601 [plaster+salt] fc=3,cc=0.6,ph=7,ta=40,cya=70,ch=300,salt=3200,temp=85 :: H 3/7 score=42 bad csi=-1.2 | A[now:cc soon:fc soon:ph soon:ta soon:csi] | PASS
#19636 [plaster+salt] fc=3,cc=0.6,ph=7,ta=40,cya=90,ch=400,salt=2500,temp=85 :: H 1/7 score=15 bad csi=-1.13 | A[now:cc now:fc soon:ph soon:ta soon:csi soon:salt tune:cya] | PASS
#19671 [plaster+salt] fc=3,cc=0,ph=7,ta=60,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=50 bad csi=-0.64 | A[soon:cya soon:ph soon:csi soon:salt tune:ch] | PASS
#19706 [plaster+salt] fc=3,cc=0,ph=7,ta=60,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.51 | A[soon:cya soon:ph soon:ch tune:csi] | PASS
#19741 [plaster+salt] fc=3,cc=0,ph=7,ta=60,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-1.19 | A[soon:fc soon:ph soon:ch soon:csi soon:salt] | PASS
#19776 [plaster+salt] fc=3,cc=0.6,ph=7,ta=60,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=19 bad csi=-1.3 | A[now:cc now:fc soon:ph soon:ch soon:csi soon:salt tune:cya] | PASS
#19811 [plaster+salt] fc=3,cc=0.6,ph=7,ta=80,cya=20,ch=300,salt=3200,temp=85 :: H 4/7 score=46 bad csi=-0.7 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#19846 [plaster+salt] fc=3,cc=0.6,ph=7,ta=80,cya=40,ch=400,salt=2500,temp=85 :: H 3/7 score=42 bad csi=-0.57 | A[now:cc soon:cya soon:ph soon:salt tune:csi] | PASS
#19881 [plaster+salt] fc=3,cc=0,ph=7,ta=80,cya=50,ch=500,salt=3700,temp=85 :: H 3/7 score=54 bad csi=-0.54 | A[soon:cya soon:ph soon:salt tune:ch tune:csi] | PASS
#19916 [plaster+salt] fc=3,cc=0,ph=7,ta=80,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=-0.41 | A[soon:fc soon:ph soon:ch tune:csi] | PASS
#19951 [plaster+salt] fc=3,cc=0,ph=7,ta=100,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.86 | A[soon:cya soon:ph soon:ch soon:csi soon:salt tune:ta] | PASS
#19986 [plaster+salt] fc=3,cc=0.6,ph=7,ta=100,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.94 | A[now:cc soon:cya soon:ph soon:ch soon:csi soon:salt tune:ta] | PASS
#20021 [plaster+salt] fc=3,cc=0.6,ph=7,ta=100,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=42 bad csi=-0.63 | A[now:cc soon:cya soon:ph soon:csi tune:ta] | PASS
#20056 [plaster+salt] fc=3,cc=0.6,ph=7,ta=100,cya=70,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.5 | A[now:cc soon:fc soon:ph soon:salt tune:ta tune:csi] | PASS
#20091 [plaster+salt] fc=3,cc=0,ph=7,ta=100,cya=90,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.48 | A[now:fc soon:ph soon:salt tune:cya tune:ta tune:ch tune:csi] | PASS
#20126 [plaster+salt] fc=3,cc=0,ph=7,ta=130,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.12 | A[soon:cya soon:ph soon:ta soon:ch] | PASS
#20161 [plaster+salt] fc=3,cc=0,ph=7,ta=130,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.77 | A[soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#20196 [plaster+salt] fc=3,cc=0.6,ph=7,ta=130,cya=70,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.84 | A[now:cc soon:fc soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#20231 [plaster+salt] fc=3,cc=0.6,ph=7,ta=130,cya=90,ch=300,salt=3200,temp=85 :: H 2/7 score=27 bad csi=-0.54 | A[now:cc now:fc soon:ph soon:ta tune:cya tune:csi] | PASS
#20266 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=40,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.49 | A[now:cc soon:cya soon:ta soon:salt tune:ph tune:csi] | PASS
#20301 [plaster+salt] fc=3,cc=0,ph=7.4,ta=40,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.53 | A[soon:cya soon:ta soon:salt tune:ph tune:ch tune:csi] | PASS
#20336 [plaster+salt] fc=3,cc=0,ph=7.4,ta=40,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=-0.42 | A[soon:cya soon:ta soon:ch tune:ph tune:csi] | PASS
#20371 [plaster+salt] fc=3,cc=0,ph=7.4,ta=40,cya=90,ch=150,salt=2500,temp=85 :: H 1/7 score=35 bad csi=-1.34 | A[now:fc soon:ta soon:ch soon:csi soon:salt tune:cya tune:ph] | PASS
#20406 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=60,cya=20,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.76 | A[now:cc soon:cya soon:ch soon:csi soon:salt tune:ph] | PASS
#20441 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=60,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.49 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#20476 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=60,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-0.37 | A[now:cc soon:cya soon:salt tune:ph tune:csi] | PASS
#20511 [plaster+salt] fc=3,cc=0,ph=7.4,ta=60,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.39 | A[soon:fc soon:salt tune:ph tune:ch tune:csi] | PASS
#20546 [plaster+salt] fc=3,cc=0,ph=7.4,ta=60,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.3 | A[now:fc soon:ch tune:cya tune:ph] | PASS
#20581 [plaster+salt] fc=3,cc=0,ph=7.4,ta=80,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.61 | A[soon:cya soon:ch soon:csi soon:salt tune:ph] | PASS
#20616 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=80,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.68 | A[now:cc soon:cya soon:ch soon:csi soon:salt tune:ph] | PASS
#20651 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=80,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=-0.41 | A[now:cc soon:fc tune:ph tune:csi] | PASS
#20686 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=80,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=-0.3 | A[now:cc now:fc soon:salt tune:cya tune:ph] | PASS
#20721 [plaster+salt] fc=3,cc=0,ph=7.4,ta=100,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=62 bad csi=-0.01 | A[soon:cya soon:salt tune:ph tune:ta tune:ch] | PASS
#20756 [plaster+salt] fc=3,cc=0,ph=7.4,ta=100,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=65 bad csi=0.12 | A[soon:cya soon:ch tune:ph tune:ta] | PASS
#20791 [plaster+salt] fc=3,cc=0,ph=7.4,ta=100,cya=70,ch=150,salt=2500,temp=85 :: H 2/7 score=62 bad csi=-0.54 | A[soon:fc soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#20826 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=100,cya=90,ch=150,salt=3700,temp=85 :: H 0/7 score=23 bad csi=-0.63 | A[now:cc now:fc soon:ch soon:csi soon:salt tune:cya tune:ph tune:ta] | PASS
#20861 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=130,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.08 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#20896 [plaster+salt] fc=3,cc=0.6,ph=7.4,ta=130,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.05 | A[now:cc soon:cya soon:ta soon:salt tune:ph] | PASS
#20931 [plaster+salt] fc=3,cc=0,ph=7.4,ta=130,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=58 bad csi=0.08 | A[soon:cya soon:ta soon:salt tune:ph tune:ch] | PASS
#20966 [plaster+salt] fc=3,cc=0,ph=7.4,ta=130,cya=70,ch=700,salt=3200,temp=85 :: H 3/7 score=65 bad csi=0.22 | A[soon:fc soon:ta soon:ch tune:ph] | PASS
#21001 [plaster+salt] fc=3,cc=0,ph=7.6,ta=40,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.71 | A[soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#21036 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=40,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.87 | A[now:cc soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#21071 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=40,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.6 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#21106 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=40,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.59 | A[now:cc soon:fc soon:ta soon:salt tune:csi] | PASS
#21141 [plaster+salt] fc=3,cc=0,ph=7.6,ta=40,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.77 | A[now:fc soon:ta soon:csi soon:salt tune:cya tune:ch] | PASS
#21176 [plaster+salt] fc=3,cc=0,ph=7.6,ta=60,cya=20,ch=700,salt=3200,temp=85 :: H 5/7 score=77 bad csi=0.11 | A[soon:cya soon:ch] | PASS
#21211 [plaster+salt] fc=3,cc=0,ph=7.6,ta=60,cya=50,ch=150,salt=2500,temp=85 :: H 4/7 score=69 bad csi=-0.6 | A[soon:cya soon:ch soon:salt tune:csi] | PASS
#21246 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=60,cya=70,ch=150,salt=3700,temp=85 :: H 3/7 score=54 bad csi=-0.73 | A[now:cc soon:fc soon:ch soon:csi soon:salt] | PASS
#21281 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=60,cya=90,ch=300,salt=3200,temp=85 :: H 4/7 score=50 bad csi=-0.49 | A[now:cc now:fc tune:cya tune:csi] | PASS
#21316 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=80,cya=20,ch=400,salt=2500,temp=85 :: H 4/7 score=62 bad csi=0.05 | A[now:cc soon:cya soon:salt] | PASS
#21351 [plaster+salt] fc=3,cc=0,ph=7.6,ta=80,cya=40,ch=500,salt=3700,temp=85 :: H 4/7 score=73 bad csi=0.04 | A[soon:cya soon:salt tune:ch] | PASS
#21386 [plaster+salt] fc=3,cc=0,ph=7.6,ta=80,cya=50,ch=700,salt=3200,temp=85 :: H 5/7 score=77 bad csi=0.18 | A[soon:cya soon:ch] | PASS
#21421 [plaster+salt] fc=3,cc=0,ph=7.6,ta=80,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.54 | A[now:fc soon:ch soon:salt tune:cya tune:csi] | PASS
#21456 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=100,cya=20,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.33 | A[now:cc soon:cya soon:ch soon:salt tune:ta tune:csi] | PASS
#21491 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=100,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=-0.04 | A[now:cc soon:cya tune:ta] | PASS
#21526 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=100,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=58 bad csi=0.1 | A[now:cc soon:cya soon:salt tune:ta] | PASS
#21561 [plaster+salt] fc=3,cc=0,ph=7.6,ta=100,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=73 bad csi=0.1 | A[soon:fc soon:salt tune:ta tune:ch] | PASS
#21596 [plaster+salt] fc=3,cc=0,ph=7.6,ta=100,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=0.23 | A[now:fc soon:ch tune:cya tune:ta] | PASS
#21631 [plaster+salt] fc=3,cc=0,ph=7.6,ta=130,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.17 | A[soon:cya soon:ta soon:ch soon:salt] | PASS
#21666 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=130,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.24 | A[now:cc soon:cya soon:ta soon:ch soon:salt] | PASS
#21701 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=130,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.05 | A[now:cc soon:fc soon:ta] | PASS
#21736 [plaster+salt] fc=3,cc=0.6,ph=7.6,ta=130,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.18 | A[now:cc now:fc soon:ta soon:salt tune:cya] | PASS
#21771 [plaster+salt] fc=3,cc=0,ph=7.8,ta=40,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.06 | A[soon:cya soon:ta soon:salt tune:ch] | PASS
#21806 [plaster+salt] fc=3,cc=0,ph=7.8,ta=40,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=0 | A[soon:cya soon:ta soon:ch] | PASS
#21841 [plaster+salt] fc=3,cc=0,ph=7.8,ta=40,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=62 bad csi=-0.84 | A[soon:fc soon:ta soon:ch soon:csi soon:salt] | PASS
#21876 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=40,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-1.16 | A[now:cc now:fc soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#21911 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=60,cya=20,ch=300,salt=3200,temp=85 :: H 5/7 score=69 bad csi=-0.05 | A[now:cc soon:cya] | PASS
#21946 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=60,cya=40,ch=400,salt=2500,temp=85 :: H 4/7 score=62 bad csi=0.05 | A[now:cc soon:cya soon:salt] | PASS
#21981 [plaster+salt] fc=3,cc=0,ph=7.8,ta=60,cya=50,ch=500,salt=3700,temp=85 :: H 4/7 score=73 bad csi=0.05 | A[soon:cya soon:salt tune:ch] | PASS
#22016 [plaster+salt] fc=3,cc=0,ph=7.8,ta=60,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=81 bad csi=0.13 | A[soon:fc soon:ch] | PASS
#22051 [plaster+salt] fc=3,cc=0,ph=7.8,ta=80,cya=20,ch=150,salt=2500,temp=85 :: H 4/7 score=73 bad csi=-0.17 | A[soon:cya soon:ch soon:salt] | PASS
#22086 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=80,cya=40,ch=150,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-0.27 | A[now:cc soon:cya soon:ch soon:salt] | PASS
#22121 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=80,cya=50,ch=300,salt=3200,temp=85 :: H 5/7 score=69 bad csi=0.02 | A[now:cc soon:cya] | PASS
#22156 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=80,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=65 bad csi=0.13 | A[now:cc soon:fc soon:salt] | PASS
#22191 [plaster+salt] fc=3,cc=0,ph=7.8,ta=80,cya=90,ch=500,salt=3700,temp=85 :: H 3/7 score=58 bad csi=0.11 | A[now:fc soon:salt tune:cya tune:ch] | PASS
#22226 [plaster+salt] fc=3,cc=0,ph=7.8,ta=100,cya=20,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=0.55 | A[soon:cya soon:ch tune:ta tune:csi] | PASS
#22261 [plaster+salt] fc=3,cc=0,ph=7.8,ta=100,cya=50,ch=150,salt=2500,temp=85 :: H 3/7 score=69 bad csi=-0.12 | A[soon:cya soon:ch soon:salt tune:ta] | PASS
#22296 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=100,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=58 bad csi=-0.22 | A[now:cc soon:fc soon:ch soon:salt tune:ta] | PASS
#22331 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=100,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.06 | A[now:cc now:fc tune:cya tune:ta] | PASS
#22366 [plaster+salt] fc=3,cc=0.6,ph=7.8,ta=130,cya=20,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=0.47 | A[now:cc soon:cya soon:ta soon:salt tune:csi] | PASS
#22401 [plaster+salt] fc=3,cc=0,ph=7.8,ta=130,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=0.48 | A[soon:cya soon:ta soon:salt tune:ch tune:csi] | PASS
#22436 [plaster+salt] fc=3,cc=0,ph=7.8,ta=130,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.63 | A[soon:cya soon:ta soon:ch soon:csi] | PASS
#22471 [plaster+salt] fc=3,cc=0,ph=7.8,ta=130,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-0.05 | A[now:fc soon:ta soon:ch soon:salt tune:cya] | PASS
#22506 [plaster+salt] fc=3,cc=0.6,ph=8,ta=40,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.38 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#22541 [plaster+salt] fc=3,cc=0.6,ph=8,ta=40,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.17 | A[now:cc soon:cya soon:ph soon:ta] | PASS
#22576 [plaster+salt] fc=3,cc=0.6,ph=8,ta=40,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.08 | A[now:cc soon:cya soon:ph soon:ta soon:salt] | PASS
#22611 [plaster+salt] fc=3,cc=0,ph=8,ta=40,cya=70,ch=500,salt=3700,temp=85 :: H 2/7 score=62 bad csi=-0.21 | A[soon:fc soon:ph soon:ta soon:salt tune:ch] | PASS
#22646 [plaster+salt] fc=3,cc=0,ph=8,ta=40,cya=90,ch=700,salt=3200,temp=85 :: H 2/7 score=42 bad csi=-0.35 | A[now:fc soon:ph soon:ta soon:ch tune:cya tune:csi] | PASS
#22681 [plaster+salt] fc=3,cc=0,ph=8,ta=60,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.18 | A[soon:cya soon:ph soon:ch soon:salt] | PASS
#22716 [plaster+salt] fc=3,cc=0.6,ph=8,ta=60,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.27 | A[now:cc soon:cya soon:ph soon:ch soon:salt] | PASS
#22751 [plaster+salt] fc=3,cc=0.6,ph=8,ta=60,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=-0.04 | A[now:cc soon:fc soon:ph] | PASS
#22786 [plaster+salt] fc=3,cc=0.6,ph=8,ta=60,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.02 | A[now:cc now:fc soon:ph soon:salt tune:cya] | PASS
#22821 [plaster+salt] fc=3,cc=0,ph=8,ta=80,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=0.48 | A[soon:cya soon:ph soon:salt tune:ch tune:csi] | PASS
#22856 [plaster+salt] fc=3,cc=0,ph=8,ta=80,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.6 | A[soon:cya soon:ph soon:ch tune:csi] | PASS
#22891 [plaster+salt] fc=3,cc=0,ph=8,ta=80,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=69 bad csi=-0.1 | A[soon:fc soon:ph soon:ch soon:salt] | PASS
#22926 [plaster+salt] fc=3,cc=0.6,ph=8,ta=80,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.22 | A[now:cc now:fc soon:ph soon:ch soon:salt tune:cya] | PASS
#22961 [plaster+salt] fc=3,cc=0.6,ph=8,ta=100,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.39 | A[now:cc soon:cya soon:ph tune:ta tune:csi] | PASS
#22996 [plaster+salt] fc=3,cc=0.6,ph=8,ta=100,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.51 | A[now:cc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#23031 [plaster+salt] fc=3,cc=0,ph=8,ta=100,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=58 bad csi=0.53 | A[soon:cya soon:ph soon:salt tune:ta tune:ch tune:csi] | PASS
#23066 [plaster+salt] fc=3,cc=0,ph=8,ta=100,cya=70,ch=700,salt=3200,temp=85 :: H 3/7 score=62 bad csi=0.65 | A[soon:fc soon:ph soon:ch soon:csi tune:ta] | PASS
#23101 [plaster+salt] fc=3,cc=0,ph=8,ta=130,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=58 bad csi=0.25 | A[soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#23136 [plaster+salt] fc=3,cc=0.6,ph=8,ta=130,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=42 bad csi=0.17 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#23171 [plaster+salt] fc=3,cc=0.6,ph=8,ta=130,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.47 | A[now:cc soon:cya soon:ph soon:ta tune:csi] | PASS
#23206 [plaster+salt] fc=3,cc=0.6,ph=8,ta=130,cya=70,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.6 | A[now:cc soon:fc soon:ph soon:ta soon:salt tune:csi] | PASS
#23241 [plaster+salt] fc=3,cc=0,ph=8,ta=130,cya=90,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=0.61 | A[now:fc soon:ph soon:ta soon:csi soon:salt tune:cya tune:ch] | PASS
#23276 [plaster+salt] fc=3,cc=0,ph=8.3,ta=40,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.6 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#23311 [plaster+salt] fc=3,cc=0,ph=8.3,ta=40,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-0.21 | A[soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#23346 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=40,cya=70,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.45 | A[now:cc soon:fc soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#23381 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=40,cya=90,ch=300,salt=3200,temp=85 :: H 2/7 score=27 bad csi=-0.48 | A[now:cc now:fc soon:ph soon:ta tune:cya tune:csi] | PASS
#23416 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=60,cya=20,ch=400,salt=2500,temp=85 :: H 3/7 score=42 bad csi=0.6 | A[now:cc soon:cya soon:ph soon:salt tune:csi] | PASS
#23451 [plaster+salt] fc=3,cc=0,ph=8.3,ta=60,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=54 bad csi=0.57 | A[soon:cya soon:ph soon:salt tune:ch tune:csi] | PASS
#23486 [plaster+salt] fc=3,cc=0,ph=8.3,ta=60,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=54 bad csi=0.7 | A[soon:cya soon:ph soon:ch soon:csi] | PASS
#23521 [plaster+salt] fc=3,cc=0,ph=8.3,ta=60,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.12 | A[now:fc soon:ph soon:ch soon:salt tune:cya] | PASS
#23556 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=80,cya=20,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=0.27 | A[now:cc soon:cya soon:ph soon:ch soon:salt] | PASS
#23591 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=80,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=50 bad csi=0.54 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#23626 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=80,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=38 bad csi=0.67 | A[now:cc soon:cya soon:ph soon:csi soon:salt] | PASS
#23661 [plaster+salt] fc=3,cc=0,ph=8.3,ta=80,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=54 bad csi=0.65 | A[soon:fc soon:ph soon:csi soon:salt tune:ch] | PASS
#23696 [plaster+salt] fc=3,cc=0,ph=8.3,ta=80,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=38 bad csi=0.75 | A[now:fc soon:ph soon:ch soon:csi tune:cya] | PASS
#23731 [plaster+salt] fc=3,cc=0,ph=8.3,ta=100,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=0.39 | A[soon:cya soon:ph soon:ch soon:salt tune:ta tune:csi] | PASS
#23766 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=100,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=0.31 | A[now:cc soon:cya soon:ph soon:ch soon:salt tune:ta tune:csi] | PASS
#23801 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=100,cya=70,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.59 | A[now:cc soon:fc soon:ph tune:ta tune:csi] | PASS
#23836 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=100,cya=90,ch=400,salt=2500,temp=85 :: H 1/7 score=19 bad csi=0.7 | A[now:cc now:fc soon:ph soon:csi soon:salt tune:cya tune:ta] | PASS
#23871 [plaster+salt] fc=3,cc=0,ph=8.3,ta=130,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=42 bad csi=1.01 | A[soon:cya soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#23906 [plaster+salt] fc=3,cc=0,ph=8.3,ta=130,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=46 bad csi=1.14 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#23941 [plaster+salt] fc=3,cc=0,ph=8.3,ta=130,cya=70,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=0.48 | A[soon:fc soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#23976 [plaster+salt] fc=3,cc=0.6,ph=8.3,ta=130,cya=90,ch=150,salt=3700,temp=85 :: H 0/7 score=15 bad csi=0.39 | A[now:cc now:fc soon:ph soon:ta soon:ch soon:salt tune:cya tune:csi] | PASS
#24011 [plaster+salt] fc=5,cc=0.6,ph=7,ta=40,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=-1.02 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#24046 [plaster+salt] fc=5,cc=0.6,ph=7,ta=40,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=31 bad csi=-0.93 | A[now:cc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#24081 [plaster+salt] fc=5,cc=0,ph=7,ta=40,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.92 | A[soon:cya soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#24116 [plaster+salt] fc=5,cc=0,ph=7,ta=40,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=-0.84 | A[soon:ph soon:ta soon:ch soon:csi] | PASS
#24151 [plaster+salt] fc=5,cc=0,ph=7,ta=60,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-1.09 | A[soon:cya soon:ph soon:ch soon:csi soon:salt] | PASS
#24186 [plaster+salt] fc=5,cc=0.6,ph=7,ta=60,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=35 bad csi=-1.19 | A[now:cc soon:cya soon:ph soon:ch soon:csi soon:salt] | PASS
#24221 [plaster+salt] fc=5,cc=0.6,ph=7,ta=60,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=46 bad csi=-0.89 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#24256 [plaster+salt] fc=5,cc=0.6,ph=7,ta=60,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=54 bad csi=-0.78 | A[now:cc soon:ph soon:csi soon:salt] | PASS
#24291 [plaster+salt] fc=5,cc=0,ph=7,ta=60,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=46 bad csi=-0.79 | A[soon:fc soon:ph soon:csi soon:salt tune:cya tune:ch] | PASS
#24326 [plaster+salt] fc=5,cc=0,ph=7,ta=80,cya=20,ch=700,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.34 | A[soon:cya soon:ph soon:ch tune:csi] | PASS
#24361 [plaster+salt] fc=5,cc=0,ph=7,ta=80,cya=50,ch=150,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-1 | A[soon:cya soon:ph soon:ch soon:csi soon:salt] | PASS
#24396 [plaster+salt] fc=5,cc=0.6,ph=7,ta=80,cya=70,ch=150,salt=3700,temp=85 :: H 3/7 score=50 bad csi=-1.09 | A[now:cc soon:ph soon:ch soon:csi soon:salt] | PASS
#24431 [plaster+salt] fc=5,cc=0.6,ph=7,ta=80,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=42 bad csi=-0.8 | A[now:cc soon:fc soon:ph soon:csi tune:cya] | PASS
#24466 [plaster+salt] fc=5,cc=0.6,ph=7,ta=100,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=-0.44 | A[now:cc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#24501 [plaster+salt] fc=5,cc=0,ph=7,ta=100,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.42 | A[soon:cya soon:ph soon:salt tune:ta tune:ch tune:csi] | PASS
#24536 [plaster+salt] fc=5,cc=0,ph=7,ta=100,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=-0.27 | A[soon:cya soon:ph soon:ch tune:ta] | PASS
#24571 [plaster+salt] fc=5,cc=0,ph=7,ta=100,cya=90,ch=150,salt=2500,temp=85 :: H 1/7 score=42 bad csi=-0.94 | A[soon:fc soon:ph soon:ch soon:csi soon:salt tune:cya tune:ta] | PASS
#24606 [plaster+salt] fc=5,cc=0.6,ph=7,ta=130,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-0.8 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#24641 [plaster+salt] fc=5,cc=0.6,ph=7,ta=130,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=42 bad csi=-0.5 | A[now:cc soon:cya soon:ph soon:ta tune:csi] | PASS
#24676 [plaster+salt] fc=5,cc=0.6,ph=7,ta=130,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=35 bad csi=-0.35 | A[now:cc soon:cya soon:ph soon:ta soon:salt tune:csi] | PASS
#24711 [plaster+salt] fc=5,cc=0,ph=7,ta=130,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=-0.33 | A[soon:ph soon:ta soon:salt tune:ch tune:csi] | PASS
#24746 [plaster+salt] fc=5,cc=0,ph=7,ta=130,cya=90,ch=700,salt=3200,temp=85 :: H 2/7 score=50 bad csi=-0.18 | A[soon:fc soon:ph soon:ta soon:ch tune:cya] | PASS
#24781 [plaster+salt] fc=5,cc=0,ph=7.4,ta=40,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-0.99 | A[soon:cya soon:ta soon:ch soon:csi soon:salt tune:ph] | PASS
#24816 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=40,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-1.1 | A[now:cc soon:cya soon:ta soon:ch soon:csi soon:salt tune:ph] | PASS
#24851 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=40,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=-0.9 | A[now:cc soon:ta soon:csi tune:ph] | PASS
#24886 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=40,cya=90,ch=400,salt=2500,temp=85 :: H 1/7 score=35 bad csi=-0.92 | A[now:cc soon:fc soon:ta soon:csi soon:salt tune:cya tune:ph] | PASS
#24921 [plaster+salt] fc=5,cc=0,ph=7.4,ta=60,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.25 | A[soon:cya soon:salt tune:ph tune:ch] | PASS
#24956 [plaster+salt] fc=5,cc=0,ph=7.4,ta=60,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=-0.14 | A[soon:cya soon:ch tune:ph] | PASS
#24991 [plaster+salt] fc=5,cc=0,ph=7.4,ta=60,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=73 bad csi=-0.85 | A[soon:ch soon:csi soon:salt tune:ph] | PASS
#25026 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=60,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.98 | A[now:cc soon:fc soon:ch soon:csi soon:salt tune:cya tune:ph] | PASS
#25061 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=80,cya=20,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.31 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#25096 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=80,cya=40,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.19 | A[now:cc soon:cya soon:salt tune:ph] | PASS
#25131 [plaster+salt] fc=5,cc=0,ph=7.4,ta=80,cya=50,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.17 | A[soon:cya soon:salt tune:ph tune:ch] | PASS
#25166 [plaster+salt] fc=5,cc=0,ph=7.4,ta=80,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=85 bad csi=-0.05 | A[soon:ch tune:ph] | PASS
#25201 [plaster+salt] fc=5,cc=0,ph=7.4,ta=100,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=58 bad csi=-0.47 | A[soon:cya soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#25236 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=100,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=42 bad csi=-0.55 | A[now:cc soon:cya soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#25271 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=100,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=58 bad csi=-0.25 | A[now:cc soon:cya tune:ph tune:ta] | PASS
#25306 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=100,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.12 | A[now:cc soon:salt tune:ph tune:ta] | PASS
#25341 [plaster+salt] fc=5,cc=0,ph=7.4,ta=100,cya=90,ch=500,salt=3700,temp=85 :: H 1/7 score=58 bad csi=-0.12 | A[soon:fc soon:salt tune:cya tune:ph tune:ta tune:ch] | PASS
#25376 [plaster+salt] fc=5,cc=0,ph=7.4,ta=130,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=62 bad csi=0.27 | A[soon:cya soon:ta soon:ch tune:ph] | PASS
#25411 [plaster+salt] fc=5,cc=0,ph=7.4,ta=130,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=54 bad csi=-0.38 | A[soon:cya soon:ta soon:ch soon:salt tune:ph tune:csi] | PASS
#25446 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=130,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.46 | A[now:cc soon:ta soon:ch soon:salt tune:ph tune:csi] | PASS
#25481 [plaster+salt] fc=5,cc=0.6,ph=7.4,ta=130,cya=90,ch=300,salt=3200,temp=85 :: H 2/7 score=50 bad csi=-0.17 | A[now:cc soon:fc soon:ta tune:cya tune:ph] | PASS
#25516 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=40,cya=20,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.29 | A[now:cc soon:cya soon:ta soon:salt] | PASS
#25551 [plaster+salt] fc=5,cc=0,ph=7.6,ta=40,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=-0.35 | A[soon:cya soon:ta soon:salt tune:ch tune:csi] | PASS
#25586 [plaster+salt] fc=5,cc=0,ph=7.6,ta=40,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=-0.25 | A[soon:cya soon:ta soon:ch] | PASS
#25621 [plaster+salt] fc=5,cc=0,ph=7.6,ta=40,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=54 bad csi=-1.23 | A[soon:fc soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#25656 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=60,cya=20,ch=150,salt=3700,temp=85 :: H 3/7 score=54 bad csi=-0.57 | A[now:cc soon:cya soon:ch soon:salt tune:csi] | PASS
#25691 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=60,cya=40,ch=300,salt=3200,temp=85 :: H 5/7 score=69 bad csi=-0.3 | A[now:cc soon:cya] | PASS
#25726 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=60,cya=50,ch=400,salt=2500,temp=85 :: H 4/7 score=62 bad csi=-0.18 | A[now:cc soon:cya soon:salt] | PASS
#25761 [plaster+salt] fc=5,cc=0,ph=7.6,ta=60,cya=70,ch=500,salt=3700,temp=85 :: H 5/7 score=88 bad csi=-0.21 | A[soon:salt tune:ch] | PASS
#25796 [plaster+salt] fc=5,cc=0,ph=7.6,ta=60,cya=90,ch=700,salt=3200,temp=85 :: H 4/7 score=73 bad csi=-0.14 | A[soon:fc soon:ch tune:cya] | PASS
#25831 [plaster+salt] fc=5,cc=0,ph=7.6,ta=80,cya=40,ch=150,salt=2500,temp=85 :: H 4/7 score=69 bad csi=-0.41 | A[soon:cya soon:ch soon:salt tune:csi] | PASS
#25866 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=80,cya=50,ch=150,salt=3700,temp=85 :: H 3/7 score=54 bad csi=-0.49 | A[now:cc soon:cya soon:ch soon:salt tune:csi] | PASS
#25901 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=80,cya=70,ch=300,salt=3200,temp=85 :: H 6/7 score=85 bad csi=-0.22 | A[now:cc] | PASS
#25936 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=80,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.12 | A[now:cc soon:fc soon:salt tune:cya] | PASS
#25971 [plaster+salt] fc=5,cc=0,ph=7.6,ta=100,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=69 bad csi=0.19 | A[soon:cya soon:salt tune:ta tune:ch] | PASS
#26006 [plaster+salt] fc=5,cc=0,ph=7.6,ta=100,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=0.32 | A[soon:cya soon:ch tune:ta tune:csi] | PASS
#26041 [plaster+salt] fc=5,cc=0,ph=7.6,ta=100,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=81 bad csi=-0.35 | A[soon:ch soon:salt tune:ta tune:csi] | PASS
#26076 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=100,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=46 bad csi=-0.45 | A[now:cc soon:fc soon:ch soon:salt tune:cya tune:ta tune:csi] | PASS
#26111 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=130,cya=20,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.11 | A[now:cc soon:cya soon:ta] | PASS
#26146 [plaster+salt] fc=5,cc=0.6,ph=7.6,ta=130,cya=40,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=0.25 | A[now:cc soon:cya soon:ta soon:salt] | PASS
#26181 [plaster+salt] fc=5,cc=0,ph=7.6,ta=130,cya=50,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=0.27 | A[soon:cya soon:ta soon:salt tune:ch] | PASS
#26216 [plaster+salt] fc=5,cc=0,ph=7.6,ta=130,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=81 bad csi=0.41 | A[soon:ta soon:ch tune:csi] | PASS
#26251 [plaster+salt] fc=5,cc=0,ph=7.8,ta=40,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=62 bad csi=-0.52 | A[soon:cya soon:ta soon:ch soon:salt tune:csi] | PASS
#26286 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=40,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.68 | A[now:cc soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#26321 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=40,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.42 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#26356 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=40,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=65 bad csi=-0.43 | A[now:cc soon:ta soon:salt tune:csi] | PASS
#26391 [plaster+salt] fc=5,cc=0,ph=7.8,ta=40,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.65 | A[soon:fc soon:ta soon:csi soon:salt tune:cya tune:ch] | PASS
#26426 [plaster+salt] fc=5,cc=0,ph=7.8,ta=60,cya=20,ch=700,salt=3200,temp=85 :: H 5/7 score=73 bad csi=0.31 | A[soon:cya soon:ch tune:csi] | PASS
#26461 [plaster+salt] fc=5,cc=0,ph=7.8,ta=60,cya=50,ch=150,salt=2500,temp=85 :: H 4/7 score=69 bad csi=-0.41 | A[soon:cya soon:ch soon:salt tune:csi] | PASS
#26496 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=60,cya=70,ch=150,salt=3700,temp=85 :: H 4/7 score=69 bad csi=-0.54 | A[now:cc soon:ch soon:salt tune:csi] | PASS
#26531 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=60,cya=90,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=-0.32 | A[now:cc soon:fc tune:cya tune:csi] | PASS
#26566 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=80,cya=20,ch=400,salt=2500,temp=85 :: H 4/7 score=62 bad csi=0.24 | A[now:cc soon:cya soon:salt] | PASS
#26601 [plaster+salt] fc=5,cc=0,ph=7.8,ta=80,cya=40,ch=500,salt=3700,temp=85 :: H 4/7 score=73 bad csi=0.24 | A[soon:cya soon:salt tune:ch] | PASS
#26636 [plaster+salt] fc=5,cc=0,ph=7.8,ta=80,cya=50,ch=700,salt=3200,temp=85 :: H 5/7 score=73 bad csi=0.38 | A[soon:cya soon:ch tune:csi] | PASS
#26671 [plaster+salt] fc=5,cc=0,ph=7.8,ta=80,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.35 | A[soon:fc soon:ch soon:salt tune:cya tune:csi] | PASS
#26706 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=100,cya=20,ch=150,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.13 | A[now:cc soon:cya soon:ch soon:salt tune:ta] | PASS
#26741 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=100,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.16 | A[now:cc soon:cya tune:ta] | PASS
#26776 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=100,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=58 bad csi=0.3 | A[now:cc soon:cya soon:salt tune:ta] | PASS
#26811 [plaster+salt] fc=5,cc=0,ph=7.8,ta=100,cya=70,ch=500,salt=3700,temp=85 :: H 4/7 score=85 bad csi=0.3 | A[soon:salt tune:ta tune:ch] | PASS
#26846 [plaster+salt] fc=5,cc=0,ph=7.8,ta=100,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=65 bad csi=0.42 | A[soon:fc soon:ch tune:cya tune:ta tune:csi] | PASS
#26881 [plaster+salt] fc=5,cc=0,ph=7.8,ta=130,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=0.02 | A[soon:cya soon:ta soon:ch soon:salt] | PASS
#26916 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=130,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.05 | A[now:cc soon:cya soon:ta soon:ch soon:salt] | PASS
#26951 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=130,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=77 bad csi=0.25 | A[now:cc soon:ta] | PASS
#26986 [plaster+salt] fc=5,cc=0.6,ph=7.8,ta=130,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.37 | A[now:cc soon:fc soon:ta soon:salt tune:cya tune:csi] | PASS
#27021 [plaster+salt] fc=5,cc=0,ph=8,ta=40,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=58 bad csi=0.14 | A[soon:cya soon:ph soon:ta soon:salt tune:ch] | PASS
#27056 [plaster+salt] fc=5,cc=0,ph=8,ta=40,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=62 bad csi=0.19 | A[soon:cya soon:ph soon:ta soon:ch] | PASS
#27091 [plaster+salt] fc=5,cc=0,ph=8,ta=40,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.67 | A[soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#27126 [plaster+salt] fc=5,cc=0.6,ph=8,ta=40,cya=90,ch=150,salt=3700,temp=85 :: H 0/7 score=31 bad csi=-1.03 | A[now:cc soon:fc soon:ph soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#27161 [plaster+salt] fc=5,cc=0.6,ph=8,ta=60,cya=20,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.15 | A[now:cc soon:cya soon:ph] | PASS
#27196 [plaster+salt] fc=5,cc=0.6,ph=8,ta=60,cya=40,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=0.24 | A[now:cc soon:cya soon:ph soon:salt] | PASS
#27231 [plaster+salt] fc=5,cc=0,ph=8,ta=60,cya=50,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=0.24 | A[soon:cya soon:ph soon:salt tune:ch] | PASS
#27266 [plaster+salt] fc=5,cc=0,ph=8,ta=60,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=81 bad csi=0.32 | A[soon:ph soon:ch tune:csi] | PASS
#27301 [plaster+salt] fc=5,cc=0,ph=8,ta=80,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=0.03 | A[soon:cya soon:ph soon:ch soon:salt] | PASS
#27336 [plaster+salt] fc=5,cc=0.6,ph=8,ta=80,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.08 | A[now:cc soon:cya soon:ph soon:ch soon:salt] | PASS
#27371 [plaster+salt] fc=5,cc=0.6,ph=8,ta=80,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.22 | A[now:cc soon:cya soon:ph] | PASS
#27406 [plaster+salt] fc=5,cc=0.6,ph=8,ta=80,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=65 bad csi=0.32 | A[now:cc soon:ph soon:salt tune:csi] | PASS
#27441 [plaster+salt] fc=5,cc=0,ph=8,ta=80,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=62 bad csi=0.3 | A[soon:fc soon:ph soon:salt tune:cya tune:ch] | PASS
#27476 [plaster+salt] fc=5,cc=0,ph=8,ta=100,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=0.75 | A[soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#27511 [plaster+salt] fc=5,cc=0,ph=8,ta=100,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=62 bad csi=0.08 | A[soon:cya soon:ph soon:ch soon:salt tune:ta] | PASS
#27546 [plaster+salt] fc=5,cc=0.6,ph=8,ta=100,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=62 bad csi=-0.02 | A[now:cc soon:ph soon:ch soon:salt tune:ta] | PASS
#27581 [plaster+salt] fc=5,cc=0.6,ph=8,ta=100,cya=90,ch=300,salt=3200,temp=85 :: H 2/7 score=54 bad csi=0.25 | A[now:cc soon:fc soon:ph tune:cya tune:ta] | PASS
#27616 [plaster+salt] fc=5,cc=0.6,ph=8,ta=130,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.67 | A[now:cc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#27651 [plaster+salt] fc=5,cc=0,ph=8,ta=130,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=0.68 | A[soon:cya soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#27686 [plaster+salt] fc=5,cc=0,ph=8,ta=130,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.83 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#27721 [plaster+salt] fc=5,cc=0,ph=8,ta=130,cya=90,ch=150,salt=2500,temp=85 :: H 1/7 score=54 bad csi=0.15 | A[soon:fc soon:ph soon:ta soon:ch soon:salt tune:cya] | PASS
#27756 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=40,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.08 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#27791 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=40,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=46 bad csi=0.12 | A[now:cc soon:cya soon:ph soon:ta] | PASS
#27826 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=40,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.21 | A[now:cc soon:cya soon:ph soon:ta soon:salt] | PASS
#27861 [plaster+salt] fc=5,cc=0,ph=8.3,ta=40,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=0.06 | A[soon:ph soon:ta soon:salt tune:ch] | PASS
#27896 [plaster+salt] fc=5,cc=0,ph=8.3,ta=40,cya=90,ch=700,salt=3200,temp=85 :: H 2/7 score=50 bad csi=-0.12 | A[soon:fc soon:ph soon:ta soon:ch tune:cya] | PASS
#27931 [plaster+salt] fc=5,cc=0,ph=8.3,ta=60,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=0.12 | A[soon:cya soon:ph soon:ch soon:salt] | PASS
#27966 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=60,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=0.02 | A[now:cc soon:cya soon:ph soon:ch soon:salt] | PASS
#28001 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=60,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=69 bad csi=0.25 | A[now:cc soon:ph] | PASS
#28036 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=60,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=0.3 | A[now:cc soon:fc soon:ph soon:salt tune:cya] | PASS
#28071 [plaster+salt] fc=5,cc=0,ph=8.3,ta=80,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=50 bad csi=0.78 | A[soon:cya soon:ph soon:csi soon:salt tune:ch] | PASS
#28106 [plaster+salt] fc=5,cc=0,ph=8.3,ta=80,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=54 bad csi=0.9 | A[soon:cya soon:ph soon:ch soon:csi] | PASS
#28141 [plaster+salt] fc=5,cc=0,ph=8.3,ta=80,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=73 bad csi=0.19 | A[soon:ph soon:ch soon:salt] | PASS
#28176 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=80,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=0.07 | A[now:cc soon:fc soon:ph soon:ch soon:salt tune:cya] | PASS
#28211 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=100,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=42 bad csi=0.69 | A[now:cc soon:cya soon:ph soon:csi tune:ta] | PASS
#28246 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=100,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=35 bad csi=0.81 | A[now:cc soon:cya soon:ph soon:csi soon:salt tune:ta] | PASS
#28281 [plaster+salt] fc=5,cc=0,ph=8.3,ta=100,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=46 bad csi=0.83 | A[soon:cya soon:ph soon:csi soon:salt tune:ta tune:ch] | PASS
#28316 [plaster+salt] fc=5,cc=0,ph=8.3,ta=100,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.95 | A[soon:ph soon:ch soon:csi tune:ta] | PASS
#28351 [plaster+salt] fc=5,cc=0,ph=8.3,ta=130,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.55 | A[soon:cya soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#28386 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=130,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=0.46 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#28421 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=130,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=0.77 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#28456 [plaster+salt] fc=5,cc=0.6,ph=8.3,ta=130,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=46 bad csi=0.89 | A[now:cc soon:ph soon:ta soon:csi soon:salt] | PASS
#28491 [plaster+salt] fc=5,cc=0,ph=8.3,ta=130,cya=90,ch=500,salt=3700,temp=85 :: H 1/7 score=38 bad csi=0.9 | A[soon:fc soon:ph soon:ta soon:csi soon:salt tune:cya tune:ch] | PASS
#28526 [plaster+salt] fc=8,cc=0,ph=7,ta=40,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=46 bad csi=-0.67 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#28561 [plaster+salt] fc=8,cc=0,ph=7,ta=40,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-1.38 | A[soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#28596 [plaster+salt] fc=8,cc=0.6,ph=7,ta=40,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-1.52 | A[now:cc soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#28631 [plaster+salt] fc=8,cc=0.6,ph=7,ta=40,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=46 bad csi=-1.29 | A[now:cc soon:ph soon:ta soon:csi tune:cya] | PASS
#28666 [plaster+salt] fc=8,cc=0.6,ph=7,ta=60,cya=20,ch=400,salt=2500,temp=85 :: H 3/7 score=38 bad csi=-0.67 | A[now:cc soon:cya soon:ph soon:csi soon:salt] | PASS
#28701 [plaster+salt] fc=8,cc=0,ph=7,ta=60,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=50 bad csi=-0.67 | A[soon:cya soon:ph soon:csi soon:salt tune:ch] | PASS
#28736 [plaster+salt] fc=8,cc=0,ph=7,ta=60,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.53 | A[soon:cya soon:ph soon:ch tune:csi] | PASS
#28771 [plaster+salt] fc=8,cc=0,ph=7,ta=60,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-1.24 | A[soon:ph soon:ch soon:csi soon:salt tune:cya] | PASS
#28806 [plaster+salt] fc=8,cc=0.6,ph=7,ta=80,cya=20,ch=150,salt=3700,temp=85 :: H 2/7 score=35 bad csi=-1.02 | A[now:cc soon:cya soon:ph soon:ch soon:csi soon:salt] | PASS
#28841 [plaster+salt] fc=8,cc=0.6,ph=7,ta=80,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=46 bad csi=-0.73 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#28876 [plaster+salt] fc=8,cc=0.6,ph=7,ta=80,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=42 bad csi=-0.58 | A[now:cc soon:cya soon:ph soon:salt tune:csi] | PASS
#28911 [plaster+salt] fc=8,cc=0,ph=7,ta=80,cya=70,ch=500,salt=3700,temp=85 :: H 4/7 score=69 bad csi=-0.57 | A[soon:ph soon:salt tune:ch tune:csi] | PASS
#28946 [plaster+salt] fc=8,cc=0,ph=7,ta=80,cya=90,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=-0.45 | A[soon:ph soon:ch tune:cya tune:csi] | PASS
#28981 [plaster+salt] fc=8,cc=0,ph=7,ta=100,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.88 | A[soon:cya soon:ph soon:ch soon:csi soon:salt tune:ta] | PASS
#29016 [plaster+salt] fc=8,cc=0.6,ph=7,ta=100,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.95 | A[now:cc soon:cya soon:ph soon:ch soon:csi soon:salt tune:ta] | PASS
#29051 [plaster+salt] fc=8,cc=0.6,ph=7,ta=100,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.65 | A[now:cc soon:ph soon:csi tune:ta] | PASS
#29086 [plaster+salt] fc=8,cc=0.6,ph=7,ta=100,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.52 | A[now:cc soon:ph soon:salt tune:cya tune:ta tune:csi] | PASS
#29121 [plaster+salt] fc=8,cc=0,ph=7,ta=130,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.28 | A[soon:cya soon:ph soon:ta soon:salt tune:ch] | PASS
#29156 [plaster+salt] fc=8,cc=0,ph=7,ta=130,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.14 | A[soon:cya soon:ph soon:ta soon:ch] | PASS
#29191 [plaster+salt] fc=8,cc=0,ph=7,ta=130,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.78 | A[soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#29226 [plaster+salt] fc=8,cc=0.6,ph=7,ta=130,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.86 | A[now:cc soon:ph soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#29261 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=40,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=46 bad csi=-0.64 | A[now:cc soon:cya soon:ta soon:csi tune:ph] | PASS
#29296 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=40,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.57 | A[now:cc soon:cya soon:ta soon:salt tune:ph tune:csi] | PASS
#29331 [plaster+salt] fc=8,cc=0,ph=7.4,ta=40,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.58 | A[soon:cya soon:ta soon:salt tune:ph tune:ch tune:csi] | PASS
#29366 [plaster+salt] fc=8,cc=0,ph=7.4,ta=40,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=73 bad csi=-0.55 | A[soon:ta soon:ch tune:ph tune:csi] | PASS
#29401 [plaster+salt] fc=8,cc=0,ph=7.4,ta=60,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.7 | A[soon:cya soon:ch soon:csi soon:salt tune:ph] | PASS
#29436 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=60,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.81 | A[now:cc soon:cya soon:ch soon:csi soon:salt tune:ph] | PASS
#29471 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=60,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.52 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#29506 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=60,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=65 bad csi=-0.43 | A[now:cc soon:salt tune:ph tune:csi] | PASS
#29541 [plaster+salt] fc=8,cc=0,ph=7.4,ta=60,cya=90,ch=500,salt=3700,temp=85 :: H 3/7 score=69 bad csi=-0.47 | A[soon:salt tune:cya tune:ph tune:ch tune:csi] | PASS
#29576 [plaster+salt] fc=8,cc=0,ph=7.4,ta=80,cya=20,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=0.05 | A[soon:cya soon:ch tune:ph] | PASS
#29611 [plaster+salt] fc=8,cc=0,ph=7.4,ta=80,cya=50,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.63 | A[soon:cya soon:ch soon:csi soon:salt tune:ph] | PASS
#29646 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=80,cya=70,ch=150,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-0.73 | A[now:cc soon:ch soon:csi soon:salt tune:ph] | PASS
#29681 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=80,cya=90,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=-0.45 | A[now:cc tune:cya tune:ph tune:csi] | PASS
#29716 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=100,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-0.05 | A[now:cc soon:cya soon:salt tune:ph tune:ta] | PASS
#29751 [plaster+salt] fc=8,cc=0,ph=7.4,ta=100,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=62 bad csi=-0.04 | A[soon:cya soon:salt tune:ph tune:ta tune:ch] | PASS
#29786 [plaster+salt] fc=8,cc=0,ph=7.4,ta=100,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=65 bad csi=0.11 | A[soon:cya soon:ch tune:ph tune:ta] | PASS
#29821 [plaster+salt] fc=8,cc=0,ph=7.4,ta=100,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=65 bad csi=-0.58 | A[soon:ch soon:salt tune:cya tune:ph tune:ta tune:csi] | PASS
#29856 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=130,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.4 | A[now:cc soon:cya soon:ta soon:ch soon:salt tune:ph tune:csi] | PASS
#29891 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=130,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.11 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#29926 [plaster+salt] fc=8,cc=0.6,ph=7.4,ta=130,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.04 | A[now:cc soon:cya soon:ta soon:salt tune:ph] | PASS
#29961 [plaster+salt] fc=8,cc=0,ph=7.4,ta=130,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=73 bad csi=0.05 | A[soon:ta soon:salt tune:ph tune:ch] | PASS
#29996 [plaster+salt] fc=8,cc=0,ph=7.4,ta=130,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=69 bad csi=0.19 | A[soon:ta soon:ch tune:cya tune:ph] | PASS
#30031 [plaster+salt] fc=8,cc=0,ph=7.6,ta=40,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.81 | A[soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#30066 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=40,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.92 | A[now:cc soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#30101 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=40,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=69 bad csi=-0.75 | A[now:cc soon:ta soon:csi] | PASS
#30136 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=40,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.81 | A[now:cc soon:ta soon:csi soon:salt tune:cya] | PASS
#30171 [plaster+salt] fc=8,cc=0,ph=7.6,ta=60,cya=20,ch=500,salt=3700,temp=85 :: H 4/7 score=73 bad csi=-0.05 | A[soon:cya soon:salt tune:ch] | PASS
#30206 [plaster+salt] fc=8,cc=0,ph=7.6,ta=60,cya=40,ch=700,salt=3200,temp=85 :: H 5/7 score=77 bad csi=0.05 | A[soon:cya soon:ch] | PASS
#30241 [plaster+salt] fc=8,cc=0,ph=7.6,ta=60,cya=70,ch=150,salt=2500,temp=85 :: H 5/7 score=81 bad csi=-0.67 | A[soon:ch soon:csi soon:salt] | PASS
#30276 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=60,cya=90,ch=150,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-0.81 | A[now:cc soon:ch soon:csi soon:salt tune:cya] | PASS
#30311 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=80,cya=20,ch=300,salt=3200,temp=85 :: H 5/7 score=69 bad csi=-0.11 | A[now:cc soon:cya] | PASS
#30346 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=80,cya=40,ch=400,salt=2500,temp=85 :: H 4/7 score=62 bad csi=0.01 | A[now:cc soon:cya soon:salt] | PASS
#30381 [plaster+salt] fc=8,cc=0,ph=7.6,ta=80,cya=50,ch=500,salt=3700,temp=85 :: H 4/7 score=73 bad csi=0.02 | A[soon:cya soon:salt tune:ch] | PASS
#30416 [plaster+salt] fc=8,cc=0,ph=7.6,ta=80,cya=70,ch=700,salt=3200,temp=85 :: H 6/7 score=92 bad csi=0.14 | A[soon:ch] | PASS
#30451 [plaster+salt] fc=8,cc=0,ph=7.6,ta=100,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=69 bad csi=-0.27 | A[soon:cya soon:ch soon:salt tune:ta] | PASS
#30486 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=100,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.36 | A[now:cc soon:cya soon:ch soon:salt tune:ta tune:csi] | PASS
#30521 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=100,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=-0.05 | A[now:cc soon:cya tune:ta] | PASS
#30556 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=100,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=73 bad csi=0.07 | A[now:cc soon:salt tune:ta] | PASS
#30591 [plaster+salt] fc=8,cc=0,ph=7.6,ta=100,cya=90,ch=500,salt=3700,temp=85 :: H 3/7 score=77 bad csi=0.07 | A[soon:salt tune:cya tune:ta tune:ch] | PASS
#30626 [plaster+salt] fc=8,cc=0,ph=7.6,ta=130,cya=20,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.47 | A[soon:cya soon:ta soon:ch tune:csi] | PASS
#30661 [plaster+salt] fc=8,cc=0,ph=7.6,ta=130,cya=50,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.19 | A[soon:cya soon:ta soon:ch soon:salt] | PASS
#30696 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=130,cya=70,ch=150,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.27 | A[now:cc soon:ta soon:ch soon:salt] | PASS
#30731 [plaster+salt] fc=8,cc=0.6,ph=7.6,ta=130,cya=90,ch=300,salt=3200,temp=85 :: H 4/7 score=69 bad csi=0.02 | A[now:cc soon:ta tune:cya] | PASS
#30766 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=40,cya=20,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.1 | A[now:cc soon:cya soon:ta soon:salt] | PASS
#30801 [plaster+salt] fc=8,cc=0,ph=7.8,ta=40,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.16 | A[soon:cya soon:ta soon:salt tune:ch] | PASS
#30836 [plaster+salt] fc=8,cc=0,ph=7.8,ta=40,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=-0.06 | A[soon:cya soon:ta soon:ch] | PASS
#30871 [plaster+salt] fc=8,cc=0,ph=7.8,ta=40,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-1.11 | A[soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#30906 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=60,cya=20,ch=150,salt=3700,temp=85 :: H 3/7 score=54 bad csi=-0.37 | A[now:cc soon:cya soon:ch soon:salt tune:csi] | PASS
#30941 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=60,cya=40,ch=300,salt=3200,temp=85 :: H 5/7 score=69 bad csi=-0.11 | A[now:cc soon:cya] | PASS
#30976 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=60,cya=50,ch=400,salt=2500,temp=85 :: H 4/7 score=62 bad csi=0.01 | A[now:cc soon:cya soon:salt] | PASS
#31011 [plaster+salt] fc=8,cc=0,ph=7.8,ta=60,cya=70,ch=500,salt=3700,temp=85 :: H 5/7 score=88 bad csi=-0.03 | A[soon:salt tune:ch] | PASS
#31046 [plaster+salt] fc=8,cc=0,ph=7.8,ta=60,cya=90,ch=700,salt=3200,temp=85 :: H 5/7 score=85 bad csi=0.04 | A[soon:ch tune:cya] | PASS
#31081 [plaster+salt] fc=8,cc=0,ph=7.8,ta=80,cya=40,ch=150,salt=2500,temp=85 :: H 4/7 score=73 bad csi=-0.22 | A[soon:cya soon:ch soon:salt] | PASS
#31116 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=80,cya=50,ch=150,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-0.3 | A[now:cc soon:cya soon:ch soon:salt] | PASS
#31151 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=80,cya=70,ch=300,salt=3200,temp=85 :: H 6/7 score=85 bad csi=-0.03 | A[now:cc] | PASS
#31186 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=80,cya=90,ch=400,salt=2500,temp=85 :: H 4/7 score=69 bad csi=0.07 | A[now:cc soon:salt tune:cya] | PASS
#31221 [plaster+salt] fc=8,cc=0,ph=7.8,ta=100,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=0.39 | A[soon:cya soon:salt tune:ta tune:ch tune:csi] | PASS
#31256 [plaster+salt] fc=8,cc=0,ph=7.8,ta=100,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=0.52 | A[soon:cya soon:ch tune:ta tune:csi] | PASS
#31291 [plaster+salt] fc=8,cc=0,ph=7.8,ta=100,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=85 bad csi=-0.16 | A[soon:ch soon:salt tune:ta] | PASS
#31326 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=100,cya=90,ch=150,salt=3700,temp=85 :: H 2/7 score=62 bad csi=-0.26 | A[now:cc soon:ch soon:salt tune:cya tune:ta] | PASS
#31361 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=130,cya=20,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=0.31 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#31396 [plaster+salt] fc=8,cc=0.6,ph=7.8,ta=130,cya=40,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=0.44 | A[now:cc soon:cya soon:ta soon:salt tune:csi] | PASS
#31431 [plaster+salt] fc=8,cc=0,ph=7.8,ta=130,cya=50,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=0.47 | A[soon:cya soon:ta soon:salt tune:ch tune:csi] | PASS
#31466 [plaster+salt] fc=8,cc=0,ph=7.8,ta=130,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=81 bad csi=0.6 | A[soon:ta soon:ch tune:csi] | PASS
#31501 [plaster+salt] fc=8,cc=0,ph=8,ta=40,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=54 bad csi=-0.32 | A[soon:cya soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#31536 [plaster+salt] fc=8,cc=0.6,ph=8,ta=40,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.49 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#31571 [plaster+salt] fc=8,cc=0.6,ph=8,ta=40,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.23 | A[now:cc soon:cya soon:ph soon:ta] | PASS
#31606 [plaster+salt] fc=8,cc=0.6,ph=8,ta=40,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=62 bad csi=-0.25 | A[now:cc soon:ph soon:ta soon:salt] | PASS
#31641 [plaster+salt] fc=8,cc=0,ph=8,ta=40,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=62 bad csi=-0.51 | A[soon:ph soon:ta soon:salt tune:cya tune:ch tune:csi] | PASS
#31676 [plaster+salt] fc=8,cc=0,ph=8,ta=60,cya=20,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.51 | A[soon:cya soon:ph soon:ch tune:csi] | PASS
#31711 [plaster+salt] fc=8,cc=0,ph=8,ta=60,cya=50,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.21 | A[soon:cya soon:ph soon:ch soon:salt] | PASS
#31746 [plaster+salt] fc=8,cc=0.6,ph=8,ta=60,cya=70,ch=150,salt=3700,temp=85 :: H 3/7 score=62 bad csi=-0.35 | A[now:cc soon:ph soon:ch soon:salt tune:csi] | PASS
#31781 [plaster+salt] fc=8,cc=0.6,ph=8,ta=60,cya=90,ch=300,salt=3200,temp=85 :: H 4/7 score=69 bad csi=-0.14 | A[now:cc soon:ph tune:cya] | PASS
#31816 [plaster+salt] fc=8,cc=0.6,ph=8,ta=80,cya=20,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=0.44 | A[now:cc soon:cya soon:ph soon:salt tune:csi] | PASS
#31851 [plaster+salt] fc=8,cc=0,ph=8,ta=80,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=0.44 | A[soon:cya soon:ph soon:salt tune:ch tune:csi] | PASS
#31886 [plaster+salt] fc=8,cc=0,ph=8,ta=80,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.57 | A[soon:cya soon:ph soon:ch tune:csi] | PASS
#31921 [plaster+salt] fc=8,cc=0,ph=8,ta=80,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=73 bad csi=-0.16 | A[soon:ph soon:ch soon:salt tune:cya] | PASS
#31956 [plaster+salt] fc=8,cc=0.6,ph=8,ta=100,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=46 bad csi=0.07 | A[now:cc soon:cya soon:ph soon:ch soon:salt tune:ta] | PASS
#31991 [plaster+salt] fc=8,cc=0.6,ph=8,ta=100,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.36 | A[now:cc soon:cya soon:ph tune:ta tune:csi] | PASS
#32026 [plaster+salt] fc=8,cc=0.6,ph=8,ta=100,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.49 | A[now:cc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#32061 [plaster+salt] fc=8,cc=0,ph=8,ta=100,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=73 bad csi=0.49 | A[soon:ph soon:salt tune:ta tune:ch tune:csi] | PASS
#32096 [plaster+salt] fc=8,cc=0,ph=8,ta=100,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=65 bad csi=0.61 | A[soon:ph soon:ch soon:csi tune:cya tune:ta] | PASS
#32131 [plaster+salt] fc=8,cc=0,ph=8,ta=130,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=58 bad csi=0.22 | A[soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#32166 [plaster+salt] fc=8,cc=0.6,ph=8,ta=130,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=42 bad csi=0.15 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:salt] | PASS
#32201 [plaster+salt] fc=8,cc=0.6,ph=8,ta=130,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.44 | A[now:cc soon:ph soon:ta tune:csi] | PASS
#32236 [plaster+salt] fc=8,cc=0.6,ph=8,ta=130,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=50 bad csi=0.57 | A[now:cc soon:ph soon:ta soon:salt tune:cya tune:csi] | PASS
#32271 [plaster+salt] fc=8,cc=0,ph=8.3,ta=40,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=46 bad csi=0.43 | A[soon:cya soon:ph soon:ta soon:salt tune:ch tune:csi] | PASS
#32306 [plaster+salt] fc=8,cc=0,ph=8.3,ta=40,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.48 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#32341 [plaster+salt] fc=8,cc=0,ph=8.3,ta=40,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=62 bad csi=-0.4 | A[soon:ph soon:ta soon:ch soon:salt tune:csi] | PASS
#32376 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=40,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.8 | A[now:cc soon:ph soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#32411 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=60,cya=20,ch=300,salt=3200,temp=85 :: H 4/7 score=50 bad csi=0.45 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#32446 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=60,cya=40,ch=400,salt=2500,temp=85 :: H 3/7 score=42 bad csi=0.54 | A[now:cc soon:cya soon:ph soon:salt tune:csi] | PASS
#32481 [plaster+salt] fc=8,cc=0,ph=8.3,ta=60,cya=50,ch=500,salt=3700,temp=85 :: H 3/7 score=54 bad csi=0.54 | A[soon:cya soon:ph soon:salt tune:ch tune:csi] | PASS
#32516 [plaster+salt] fc=8,cc=0,ph=8.3,ta=60,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=69 bad csi=0.61 | A[soon:ph soon:ch soon:csi] | PASS
#32551 [plaster+salt] fc=8,cc=0,ph=8.3,ta=80,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=54 bad csi=0.32 | A[soon:cya soon:ph soon:ch soon:salt tune:csi] | PASS
#32586 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=80,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=0.22 | A[now:cc soon:cya soon:ph soon:ch soon:salt] | PASS
#32621 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=80,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=50 bad csi=0.51 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#32656 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=80,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=54 bad csi=0.61 | A[now:cc soon:ph soon:csi soon:salt] | PASS
#32691 [plaster+salt] fc=8,cc=0,ph=8.3,ta=80,cya=90,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=0.59 | A[soon:ph soon:salt tune:cya tune:ch tune:csi] | PASS
#32726 [plaster+salt] fc=8,cc=0,ph=8.3,ta=100,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=50 bad csi=1.05 | A[soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#32761 [plaster+salt] fc=8,cc=0,ph=8.3,ta=100,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=0.37 | A[soon:cya soon:ph soon:ch soon:salt tune:ta tune:csi] | PASS
#32796 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=100,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=54 bad csi=0.27 | A[now:cc soon:ph soon:ch soon:salt tune:ta] | PASS
#32831 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=100,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.54 | A[now:cc soon:ph tune:cya tune:ta tune:csi] | PASS
#32866 [plaster+salt] fc=8,cc=0.6,ph=8.3,ta=130,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=31 bad csi=0.97 | A[now:cc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#32901 [plaster+salt] fc=8,cc=0,ph=8.3,ta=130,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=42 bad csi=0.98 | A[soon:cya soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#32936 [plaster+salt] fc=8,cc=0,ph=8.3,ta=130,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=46 bad csi=1.13 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#32971 [plaster+salt] fc=8,cc=0,ph=8.3,ta=130,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=54 bad csi=0.44 | A[soon:ph soon:ta soon:ch soon:salt tune:cya tune:csi] | PASS
#33006 [plaster+salt] fc=12,cc=0.6,ph=7,ta=40,cya=20,ch=150,salt=3700,temp=85 :: H 0/7 score=15 bad csi=-1.34 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt tune:fc] | PASS
#33041 [plaster+salt] fc=12,cc=0.6,ph=7,ta=40,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=-1.09 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#33076 [plaster+salt] fc=12,cc=0.6,ph=7,ta=40,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=31 bad csi=-0.96 | A[now:cc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#33111 [plaster+salt] fc=12,cc=0,ph=7,ta=40,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-1 | A[soon:ph soon:ta soon:csi soon:salt tune:ch] | PASS
#33146 [plaster+salt] fc=12,cc=0,ph=7,ta=40,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-0.93 | A[soon:ph soon:ta soon:ch soon:csi tune:cya] | PASS
#33181 [plaster+salt] fc=12,cc=0,ph=7,ta=60,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-1.13 | A[soon:cya soon:ph soon:ch soon:csi soon:salt] | PASS
#33216 [plaster+salt] fc=12,cc=0.6,ph=7,ta=60,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=35 bad csi=-1.21 | A[now:cc soon:cya soon:ph soon:ch soon:csi soon:salt] | PASS
#33251 [plaster+salt] fc=12,cc=0.6,ph=7,ta=60,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=62 bad csi=-0.93 | A[now:cc soon:ph soon:csi] | PASS
#33286 [plaster+salt] fc=12,cc=0.6,ph=7,ta=60,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=46 bad csi=-0.82 | A[now:cc soon:ph soon:csi soon:salt tune:cya] | PASS
#33321 [plaster+salt] fc=12,cc=0,ph=7,ta=80,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.5 | A[soon:cya soon:ph soon:salt tune:fc tune:ch tune:csi] | PASS
#33356 [plaster+salt] fc=12,cc=0,ph=7,ta=80,cya=40,ch=700,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.37 | A[soon:cya soon:ph soon:ch tune:csi] | PASS
#33391 [plaster+salt] fc=12,cc=0,ph=7,ta=80,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=65 bad csi=-1.03 | A[soon:ph soon:ch soon:csi soon:salt] | PASS
#33426 [plaster+salt] fc=12,cc=0.6,ph=7,ta=80,cya=90,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-1.12 | A[now:cc soon:ph soon:ch soon:csi soon:salt tune:cya] | PASS
#33461 [plaster+salt] fc=12,cc=0.6,ph=7,ta=100,cya=20,ch=300,salt=3200,temp=85 :: H 2/7 score=35 bad csi=-0.6 | A[now:cc soon:cya soon:ph tune:fc tune:ta tune:csi] | PASS
#33496 [plaster+salt] fc=12,cc=0.6,ph=7,ta=100,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=-0.46 | A[now:cc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#33531 [plaster+salt] fc=12,cc=0,ph=7,ta=100,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.43 | A[soon:cya soon:ph soon:salt tune:ta tune:ch tune:csi] | PASS
#33566 [plaster+salt] fc=12,cc=0,ph=7,ta=100,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=73 bad csi=-0.3 | A[soon:ph soon:ch tune:ta] | PASS
#33601 [plaster+salt] fc=12,cc=0,ph=7,ta=130,cya=20,ch=150,salt=2500,temp=85 :: H 1/7 score=31 bad csi=-0.74 | A[soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt tune:fc] | PASS
#33636 [plaster+salt] fc=12,cc=0.6,ph=7,ta=130,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=27 bad csi=-0.81 | A[now:cc soon:cya soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#33671 [plaster+salt] fc=12,cc=0.6,ph=7,ta=130,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=42 bad csi=-0.5 | A[now:cc soon:cya soon:ph soon:ta tune:csi] | PASS
#33706 [plaster+salt] fc=12,cc=0.6,ph=7,ta=130,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-0.37 | A[now:cc soon:ph soon:ta soon:salt tune:csi] | PASS
#33741 [plaster+salt] fc=12,cc=0,ph=7,ta=130,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.34 | A[soon:ph soon:ta soon:salt tune:cya tune:ch tune:csi] | PASS
#33776 [plaster+salt] fc=12,cc=0,ph=7.4,ta=40,cya=20,ch=700,salt=3200,temp=85 :: H 2/7 score=50 bad csi=-0.29 | A[soon:cya soon:ta soon:ch tune:fc tune:ph] | PASS
#33811 [plaster+salt] fc=12,cc=0,ph=7.4,ta=40,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-1.04 | A[soon:cya soon:ta soon:ch soon:csi soon:salt tune:ph] | PASS
#33846 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=40,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-1.22 | A[now:cc soon:ta soon:ch soon:csi soon:salt tune:ph] | PASS
#33881 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=40,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=54 bad csi=-1.08 | A[now:cc soon:ta soon:csi tune:cya tune:ph] | PASS
#33916 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=60,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.29 | A[now:cc soon:cya soon:salt tune:fc tune:ph] | PASS
#33951 [plaster+salt] fc=12,cc=0,ph=7.4,ta=60,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.3 | A[soon:cya soon:salt tune:ph tune:ch] | PASS
#33986 [plaster+salt] fc=12,cc=0,ph=7.4,ta=60,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=-0.17 | A[soon:cya soon:ch tune:ph] | PASS
#34021 [plaster+salt] fc=12,cc=0,ph=7.4,ta=60,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.92 | A[soon:ch soon:csi soon:salt tune:cya tune:ph] | PASS
#34056 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=80,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.63 | A[now:cc soon:cya soon:ch soon:csi soon:salt tune:fc tune:ph] | PASS
#34091 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=80,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.34 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#34126 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=80,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.21 | A[now:cc soon:cya soon:salt tune:ph] | PASS
#34161 [plaster+salt] fc=12,cc=0,ph=7.4,ta=80,cya=70,ch=500,salt=3700,temp=85 :: H 4/7 score=81 bad csi=-0.21 | A[soon:salt tune:ph tune:ch] | PASS
#34196 [plaster+salt] fc=12,cc=0,ph=7.4,ta=80,cya=90,ch=700,salt=3200,temp=85 :: H 4/7 score=77 bad csi=-0.1 | A[soon:ch tune:cya tune:ph] | PASS
#34231 [plaster+salt] fc=12,cc=0,ph=7.4,ta=100,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=58 bad csi=-0.49 | A[soon:cya soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#34266 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=100,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=42 bad csi=-0.57 | A[now:cc soon:cya soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#34301 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=100,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=73 bad csi=-0.28 | A[now:cc tune:ph tune:ta] | PASS
#34336 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=100,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=58 bad csi=-0.16 | A[now:cc soon:salt tune:cya tune:ph tune:ta] | PASS
#34371 [plaster+salt] fc=12,cc=0,ph=7.4,ta=130,cya=20,ch=500,salt=3700,temp=85 :: H 1/7 score=46 bad csi=0.11 | A[soon:cya soon:ta soon:salt tune:fc tune:ph tune:ch] | PASS
#34406 [plaster+salt] fc=12,cc=0,ph=7.4,ta=130,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=62 bad csi=0.25 | A[soon:cya soon:ta soon:ch tune:ph] | PASS
#34441 [plaster+salt] fc=12,cc=0,ph=7.4,ta=130,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=69 bad csi=-0.4 | A[soon:ta soon:ch soon:salt tune:ph tune:csi] | PASS
#34476 [plaster+salt] fc=12,cc=0.6,ph=7.4,ta=130,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=46 bad csi=-0.49 | A[now:cc soon:ta soon:ch soon:salt tune:cya tune:ph tune:csi] | PASS
#34511 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=40,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=46 bad csi=-0.45 | A[now:cc soon:cya soon:ta tune:fc tune:csi] | PASS
#34546 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=40,cya=40,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-0.39 | A[now:cc soon:cya soon:ta soon:salt tune:csi] | PASS
#34581 [plaster+salt] fc=12,cc=0,ph=7.6,ta=40,cya=50,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=-0.41 | A[soon:cya soon:ta soon:salt tune:ch tune:csi] | PASS
#34616 [plaster+salt] fc=12,cc=0,ph=7.6,ta=40,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=81 bad csi=-0.39 | A[soon:ta soon:ch tune:csi] | PASS
#34651 [plaster+salt] fc=12,cc=0,ph=7.6,ta=60,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.51 | A[soon:cya soon:ch soon:salt tune:fc tune:csi] | PASS
#34686 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=60,cya=40,ch=150,salt=3700,temp=85 :: H 3/7 score=50 bad csi=-0.62 | A[now:cc soon:cya soon:ch soon:csi soon:salt] | PASS
#34721 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=60,cya=50,ch=300,salt=3200,temp=85 :: H 5/7 score=65 bad csi=-0.34 | A[now:cc soon:cya tune:csi] | PASS
#34756 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=60,cya=70,ch=400,salt=2500,temp=85 :: H 5/7 score=77 bad csi=-0.25 | A[now:cc soon:salt] | PASS
#34791 [plaster+salt] fc=12,cc=0,ph=7.6,ta=60,cya=90,ch=500,salt=3700,temp=85 :: H 4/7 score=81 bad csi=-0.3 | A[soon:salt tune:cya tune:ch] | PASS
#34826 [plaster+salt] fc=12,cc=0,ph=7.6,ta=80,cya=20,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.25 | A[soon:cya soon:ch tune:fc] | PASS
#34861 [plaster+salt] fc=12,cc=0,ph=7.6,ta=80,cya=50,ch=150,salt=2500,temp=85 :: H 4/7 score=69 bad csi=-0.43 | A[soon:cya soon:ch soon:salt tune:csi] | PASS
#34896 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=80,cya=70,ch=150,salt=3700,temp=85 :: H 4/7 score=69 bad csi=-0.54 | A[now:cc soon:ch soon:salt tune:csi] | PASS
#34931 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=80,cya=90,ch=300,salt=3200,temp=85 :: H 5/7 score=77 bad csi=-0.27 | A[now:cc tune:cya] | PASS
#34966 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=100,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.15 | A[now:cc soon:cya soon:salt tune:fc tune:ta] | PASS
#35001 [plaster+salt] fc=12,cc=0,ph=7.6,ta=100,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=69 bad csi=0.16 | A[soon:cya soon:salt tune:ta tune:ch] | PASS
#35036 [plaster+salt] fc=12,cc=0,ph=7.6,ta=100,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=73 bad csi=0.3 | A[soon:cya soon:ch tune:ta] | PASS
#35071 [plaster+salt] fc=12,cc=0,ph=7.6,ta=100,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=73 bad csi=-0.39 | A[soon:ch soon:salt tune:cya tune:ta tune:csi] | PASS
#35106 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=130,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.21 | A[now:cc soon:cya soon:ta soon:ch soon:salt tune:fc] | PASS
#35141 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=130,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.09 | A[now:cc soon:cya soon:ta] | PASS
#35176 [plaster+salt] fc=12,cc=0.6,ph=7.6,ta=130,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=0.23 | A[now:cc soon:cya soon:ta soon:salt] | PASS
#35211 [plaster+salt] fc=12,cc=0,ph=7.6,ta=130,cya=70,ch=500,salt=3700,temp=85 :: H 4/7 score=81 bad csi=0.25 | A[soon:ta soon:salt tune:ch] | PASS
#35246 [plaster+salt] fc=12,cc=0,ph=7.6,ta=130,cya=90,ch=700,salt=3200,temp=85 :: H 4/7 score=73 bad csi=0.38 | A[soon:ta soon:ch tune:cya tune:csi] | PASS
#35281 [plaster+salt] fc=12,cc=0,ph=7.8,ta=40,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.62 | A[soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#35316 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=40,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.74 | A[now:cc soon:cya soon:ta soon:ch soon:csi soon:salt] | PASS
#35351 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=40,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=73 bad csi=-0.58 | A[now:cc soon:ta tune:csi] | PASS
#35386 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=40,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=-0.69 | A[now:cc soon:ta soon:csi soon:salt tune:cya] | PASS
#35421 [plaster+salt] fc=12,cc=0,ph=7.8,ta=60,cya=20,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=0.15 | A[soon:cya soon:salt tune:fc tune:ch] | PASS
#35456 [plaster+salt] fc=12,cc=0,ph=7.8,ta=60,cya=40,ch=700,salt=3200,temp=85 :: H 5/7 score=77 bad csi=0.25 | A[soon:cya soon:ch] | PASS
#35491 [plaster+salt] fc=12,cc=0,ph=7.8,ta=60,cya=70,ch=150,salt=2500,temp=85 :: H 5/7 score=85 bad csi=-0.49 | A[soon:ch soon:salt tune:csi] | PASS
#35526 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=60,cya=90,ch=150,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-0.64 | A[now:cc soon:ch soon:csi soon:salt tune:cya] | PASS
#35561 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=80,cya=20,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=0.09 | A[now:cc soon:cya tune:fc] | PASS
#35596 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=80,cya=40,ch=400,salt=2500,temp=85 :: H 4/7 score=62 bad csi=0.2 | A[now:cc soon:cya soon:salt] | PASS
#35631 [plaster+salt] fc=12,cc=0,ph=7.8,ta=80,cya=50,ch=500,salt=3700,temp=85 :: H 4/7 score=73 bad csi=0.22 | A[soon:cya soon:salt tune:ch] | PASS
#35666 [plaster+salt] fc=12,cc=0,ph=7.8,ta=80,cya=70,ch=700,salt=3200,temp=85 :: H 6/7 score=88 bad csi=0.33 | A[soon:ch tune:csi] | PASS
#35701 [plaster+salt] fc=12,cc=0,ph=7.8,ta=100,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=58 bad csi=-0.07 | A[soon:cya soon:ch soon:salt tune:fc tune:ta] | PASS
#35736 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=100,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.16 | A[now:cc soon:cya soon:ch soon:salt tune:ta] | PASS
#35771 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=100,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.14 | A[now:cc soon:cya tune:ta] | PASS
#35806 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=100,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=73 bad csi=0.26 | A[now:cc soon:salt tune:ta] | PASS
#35841 [plaster+salt] fc=12,cc=0,ph=7.8,ta=100,cya=90,ch=500,salt=3700,temp=85 :: H 3/7 score=77 bad csi=0.25 | A[soon:salt tune:cya tune:ta tune:ch] | PASS
#35876 [plaster+salt] fc=12,cc=0,ph=7.8,ta=130,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.67 | A[soon:cya soon:ta soon:ch soon:csi tune:fc] | PASS
#35911 [plaster+salt] fc=12,cc=0,ph=7.8,ta=130,cya=50,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=0.01 | A[soon:cya soon:ta soon:ch soon:salt] | PASS
#35946 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=130,cya=70,ch=150,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.07 | A[now:cc soon:ta soon:ch soon:salt] | PASS
#35981 [plaster+salt] fc=12,cc=0.6,ph=7.8,ta=130,cya=90,ch=300,salt=3200,temp=85 :: H 4/7 score=69 bad csi=0.22 | A[now:cc soon:ta tune:cya] | PASS
#36016 [plaster+salt] fc=12,cc=0.6,ph=8,ta=40,cya=20,ch=400,salt=2500,temp=85 :: H 1/7 score=35 bad csi=0.1 | A[now:cc soon:cya soon:ta soon:salt tune:fc tune:ph] | PASS
#36051 [plaster+salt] fc=12,cc=0,ph=8,ta=40,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=58 bad csi=0.03 | A[soon:cya soon:ta soon:salt tune:ph tune:ch] | PASS
#36086 [plaster+salt] fc=12,cc=0,ph=8,ta=40,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=62 bad csi=0.12 | A[soon:cya soon:ta soon:ch tune:ph] | PASS
#36121 [plaster+salt] fc=12,cc=0,ph=8,ta=40,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=58 bad csi=-0.97 | A[soon:ta soon:ch soon:csi soon:salt tune:cya tune:ph] | PASS
#36156 [plaster+salt] fc=12,cc=0.6,ph=8,ta=60,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.17 | A[now:cc soon:cya soon:ch soon:salt tune:fc tune:ph] | PASS
#36191 [plaster+salt] fc=12,cc=0.6,ph=8,ta=60,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.08 | A[now:cc soon:cya tune:ph] | PASS
#36226 [plaster+salt] fc=12,cc=0.6,ph=8,ta=60,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=0.2 | A[now:cc soon:cya soon:salt tune:ph] | PASS
#36261 [plaster+salt] fc=12,cc=0,ph=8,ta=60,cya=70,ch=500,salt=3700,temp=85 :: H 4/7 score=81 bad csi=0.16 | A[soon:salt tune:ph tune:ch] | PASS
#36296 [plaster+salt] fc=12,cc=0,ph=8,ta=60,cya=90,ch=700,salt=3200,temp=85 :: H 4/7 score=77 bad csi=0.22 | A[soon:ch tune:cya tune:ph] | PASS
#36331 [plaster+salt] fc=12,cc=0,ph=8,ta=80,cya=40,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=-0.02 | A[soon:cya soon:ch soon:salt tune:ph] | PASS
#36366 [plaster+salt] fc=12,cc=0.6,ph=8,ta=80,cya=50,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.1 | A[now:cc soon:cya soon:ch soon:salt tune:ph] | PASS
#36401 [plaster+salt] fc=12,cc=0.6,ph=8,ta=80,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=77 bad csi=0.16 | A[now:cc tune:ph] | PASS
#36436 [plaster+salt] fc=12,cc=0.6,ph=8,ta=80,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=62 bad csi=0.26 | A[now:cc soon:salt tune:cya tune:ph] | PASS
#36471 [plaster+salt] fc=12,cc=0,ph=8,ta=100,cya=20,ch=500,salt=3700,temp=85 :: H 1/7 score=46 bad csi=0.59 | A[soon:cya soon:salt tune:fc tune:ph tune:ta tune:ch tune:csi] | PASS
#36506 [plaster+salt] fc=12,cc=0,ph=8,ta=100,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=0.71 | A[soon:cya soon:ch soon:csi tune:ph tune:ta] | PASS
#36541 [plaster+salt] fc=12,cc=0,ph=8,ta=100,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=77 bad csi=0.03 | A[soon:ch soon:salt tune:ph tune:ta] | PASS
#36576 [plaster+salt] fc=12,cc=0.6,ph=8,ta=100,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=54 bad csi=-0.07 | A[now:cc soon:ch soon:salt tune:cya tune:ph tune:ta] | PASS
#36611 [plaster+salt] fc=12,cc=0.6,ph=8,ta=130,cya=20,ch=300,salt=3200,temp=85 :: H 2/7 score=38 bad csi=0.51 | A[now:cc soon:cya soon:ta tune:fc tune:ph tune:csi] | PASS
#36646 [plaster+salt] fc=12,cc=0.6,ph=8,ta=130,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.64 | A[now:cc soon:cya soon:ta soon:csi soon:salt tune:ph] | PASS
#36681 [plaster+salt] fc=12,cc=0,ph=8,ta=130,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=0.67 | A[soon:cya soon:ta soon:csi soon:salt tune:ph tune:ch] | PASS
#36716 [plaster+salt] fc=12,cc=0,ph=8,ta=130,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=69 bad csi=0.8 | A[soon:ta soon:ch soon:csi tune:ph] | PASS
#36751 [plaster+salt] fc=12,cc=0,ph=8.3,ta=40,cya=20,ch=150,salt=2500,temp=85 :: H 1/7 score=38 bad csi=-0.02 | A[soon:cya soon:ta soon:ch soon:salt tune:fc tune:ph] | PASS
#36786 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=40,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-0.19 | A[now:cc soon:cya soon:ta soon:ch soon:salt tune:ph] | PASS
#36821 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=40,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=46 bad csi=0.05 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#36856 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=40,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=54 bad csi=0.02 | A[now:cc soon:ta soon:salt tune:ph] | PASS
#36891 [plaster+salt] fc=12,cc=0,ph=8.3,ta=40,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=58 bad csi=-0.28 | A[soon:ta soon:salt tune:cya tune:ph tune:ch] | PASS
#36926 [plaster+salt] fc=12,cc=0,ph=8.3,ta=60,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=42 bad csi=0.8 | A[soon:cya soon:ch soon:csi tune:fc tune:ph] | PASS
#36961 [plaster+salt] fc=12,cc=0,ph=8.3,ta=60,cya=50,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=0.08 | A[soon:cya soon:ch soon:salt tune:ph] | PASS
#36996 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=60,cya=70,ch=150,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-0.07 | A[now:cc soon:ch soon:salt tune:ph] | PASS
#37031 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=60,cya=90,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.14 | A[now:cc tune:cya tune:ph] | PASS
#37066 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=80,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=27 bad csi=0.74 | A[now:cc soon:cya soon:csi soon:salt tune:fc tune:ph] | PASS
#37101 [plaster+salt] fc=12,cc=0,ph=8.3,ta=80,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=50 bad csi=0.73 | A[soon:cya soon:csi soon:salt tune:ph tune:ch] | PASS
#37136 [plaster+salt] fc=12,cc=0,ph=8.3,ta=80,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=54 bad csi=0.87 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#37171 [plaster+salt] fc=12,cc=0,ph=8.3,ta=80,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=0.13 | A[soon:ch soon:salt tune:cya tune:ph] | PASS
#37206 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=100,cya=20,ch=150,salt=3700,temp=85 :: H 0/7 score=23 bad csi=0.37 | A[now:cc soon:cya soon:ch soon:salt tune:fc tune:ph tune:ta tune:csi] | PASS
#37241 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=100,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=42 bad csi=0.65 | A[now:cc soon:cya soon:csi tune:ph tune:ta] | PASS
#37276 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=100,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=35 bad csi=0.79 | A[now:cc soon:cya soon:csi soon:salt tune:ph tune:ta] | PASS
#37311 [plaster+salt] fc=12,cc=0,ph=8.3,ta=100,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=0.79 | A[soon:csi soon:salt tune:ph tune:ta tune:ch] | PASS
#37346 [plaster+salt] fc=12,cc=0,ph=8.3,ta=100,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=0.9 | A[soon:ch soon:csi tune:cya tune:ph tune:ta] | PASS
#37381 [plaster+salt] fc=12,cc=0,ph=8.3,ta=130,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.52 | A[soon:cya soon:ta soon:ch soon:salt tune:ph tune:csi] | PASS
#37416 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=130,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=0.45 | A[now:cc soon:cya soon:ta soon:ch soon:salt tune:ph tune:csi] | PASS
#37451 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=130,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=54 bad csi=0.74 | A[now:cc soon:ta soon:csi tune:ph] | PASS
#37486 [plaster+salt] fc=12,cc=0.6,ph=8.3,ta=130,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.86 | A[now:cc soon:ta soon:csi soon:salt tune:cya tune:ph] | PASS
#37521 [plaster+salt] fc=25,cc=0,ph=7,ta=40,cya=20,ch=500,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.83 | A[soon:cya soon:ph soon:ta soon:csi soon:salt tune:fc tune:ch] | PASS
#37556 [plaster+salt] fc=25,cc=0,ph=7,ta=40,cya=40,ch=700,salt=3200,temp=85 :: H 2/7 score=35 bad csi=-0.73 | A[soon:cya soon:ph soon:ta soon:ch soon:csi tune:fc] | PASS
#37591 [plaster+salt] fc=25,cc=0,ph=7,ta=40,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-1.46 | A[soon:ph soon:ta soon:ch soon:csi soon:salt] | PASS
#37626 [plaster+salt] fc=25,cc=0.6,ph=7,ta=40,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=35 bad csi=-1.61 | A[now:cc soon:ph soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#37661 [plaster+salt] fc=25,cc=0.6,ph=7,ta=60,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.83 | A[now:cc soon:cya soon:ph soon:csi tune:fc] | PASS
#37696 [plaster+salt] fc=25,cc=0.6,ph=7,ta=60,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=27 bad csi=-0.71 | A[now:cc soon:cya soon:ph soon:csi soon:salt tune:fc] | PASS
#37731 [plaster+salt] fc=25,cc=0,ph=7,ta=60,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=38 bad csi=-0.69 | A[soon:cya soon:ph soon:csi soon:salt tune:fc tune:ch] | PASS
#37766 [plaster+salt] fc=25,cc=0,ph=7,ta=60,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=73 bad csi=-0.58 | A[soon:ph soon:ch tune:csi] | PASS
#37801 [plaster+salt] fc=25,cc=0,ph=7,ta=80,cya=20,ch=150,salt=2500,temp=85 :: H 2/7 score=38 bad csi=-0.96 | A[soon:cya soon:ph soon:ch soon:csi soon:salt tune:fc] | PASS
#37836 [plaster+salt] fc=25,cc=0.6,ph=7,ta=80,cya=40,ch=150,salt=3700,temp=85 :: H 1/7 score=23 bad csi=-1.04 | A[now:cc soon:cya soon:ph soon:ch soon:csi soon:salt tune:fc] | PASS
#37871 [plaster+salt] fc=25,cc=0.6,ph=7,ta=80,cya=50,ch=300,salt=3200,temp=85 :: H 3/7 score=35 bad csi=-0.74 | A[now:cc soon:cya soon:ph soon:csi tune:fc] | PASS
#37906 [plaster+salt] fc=25,cc=0.6,ph=7,ta=80,cya=70,ch=400,salt=2500,temp=85 :: H 4/7 score=54 bad csi=-0.61 | A[now:cc soon:ph soon:csi soon:salt] | PASS
#37941 [plaster+salt] fc=25,cc=0,ph=7,ta=80,cya=90,ch=500,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-0.61 | A[soon:ph soon:csi soon:salt tune:cya tune:ch] | PASS
#37976 [plaster+salt] fc=25,cc=0,ph=7,ta=100,cya=20,ch=700,salt=3200,temp=85 :: H 2/7 score=46 bad csi=-0.24 | A[soon:cya soon:ph soon:ch tune:fc tune:ta] | PASS
#38011 [plaster+salt] fc=25,cc=0,ph=7,ta=100,cya=50,ch=150,salt=2500,temp=85 :: H 1/7 score=35 bad csi=-0.89 | A[soon:cya soon:ph soon:ch soon:csi soon:salt tune:fc tune:ta] | PASS
#38046 [plaster+salt] fc=25,cc=0.6,ph=7,ta=100,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=46 bad csi=-0.97 | A[now:cc soon:ph soon:ch soon:csi soon:salt tune:ta] | PASS
#38081 [plaster+salt] fc=25,cc=0.6,ph=7,ta=100,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=-0.68 | A[now:cc soon:ph soon:csi tune:cya tune:ta] | PASS
#38116 [plaster+salt] fc=25,cc=0.6,ph=7,ta=130,cya=20,ch=400,salt=2500,temp=85 :: H 1/7 score=23 bad csi=-0.32 | A[now:cc soon:cya soon:ph soon:ta soon:salt tune:fc tune:csi] | PASS
#38151 [plaster+salt] fc=25,cc=0,ph=7,ta=130,cya=40,ch=500,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.3 | A[soon:cya soon:ph soon:ta soon:salt tune:fc tune:ch] | PASS
#38186 [plaster+salt] fc=25,cc=0,ph=7,ta=130,cya=50,ch=700,salt=3200,temp=85 :: H 2/7 score=42 bad csi=-0.15 | A[soon:cya soon:ph soon:ta soon:ch tune:fc] | PASS
#38221 [plaster+salt] fc=25,cc=0,ph=7,ta=130,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-0.8 | A[soon:ph soon:ta soon:ch soon:csi soon:salt tune:cya] | PASS
#38256 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=40,cya=20,ch=150,salt=3700,temp=85 :: H 0/7 score=23 bad csi=-0.96 | A[now:cc soon:cya soon:ta soon:ch soon:csi soon:salt tune:fc tune:ph] | PASS
#38291 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=40,cya=40,ch=300,salt=3200,temp=85 :: H 2/7 score=35 bad csi=-0.73 | A[now:cc soon:cya soon:ta soon:csi tune:fc tune:ph] | PASS
#38326 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=40,cya=50,ch=400,salt=2500,temp=85 :: H 1/7 score=27 bad csi=-0.62 | A[now:cc soon:cya soon:ta soon:csi soon:salt tune:fc tune:ph] | PASS
#38361 [plaster+salt] fc=25,cc=0,ph=7.4,ta=40,cya=70,ch=500,salt=3700,temp=85 :: H 3/7 score=65 bad csi=-0.71 | A[soon:ta soon:csi soon:salt tune:ph tune:ch] | PASS
#38396 [plaster+salt] fc=25,cc=0,ph=7.4,ta=40,cya=90,ch=700,salt=3200,temp=85 :: H 3/7 score=62 bad csi=-0.72 | A[soon:ta soon:ch soon:csi tune:cya tune:ph] | PASS
#38431 [plaster+salt] fc=25,cc=0,ph=7.4,ta=60,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.76 | A[soon:cya soon:ch soon:csi soon:salt tune:fc tune:ph] | PASS
#38466 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=60,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=-0.84 | A[now:cc soon:cya soon:ch soon:csi soon:salt tune:fc tune:ph] | PASS
#38501 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=60,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=73 bad csi=-0.59 | A[now:cc tune:ph tune:csi] | PASS
#38536 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=60,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.51 | A[now:cc soon:salt tune:cya tune:ph tune:csi] | PASS
#38571 [plaster+salt] fc=25,cc=0,ph=7.4,ta=80,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.11 | A[soon:cya soon:salt tune:fc tune:ph tune:ch] | PASS
#38606 [plaster+salt] fc=25,cc=0,ph=7.4,ta=80,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=0.01 | A[soon:cya soon:ch tune:fc tune:ph] | PASS
#38641 [plaster+salt] fc=25,cc=0,ph=7.4,ta=80,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=73 bad csi=-0.67 | A[soon:ch soon:csi soon:salt tune:ph] | PASS
#38676 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=80,cya=90,ch=150,salt=3700,temp=85 :: H 2/7 score=50 bad csi=-0.77 | A[now:cc soon:ch soon:csi soon:salt tune:cya tune:ph] | PASS
#38711 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=100,cya=20,ch=300,salt=3200,temp=85 :: H 2/7 score=46 bad csi=-0.2 | A[now:cc soon:cya tune:fc tune:ph tune:ta] | PASS
#38746 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=100,cya=40,ch=400,salt=2500,temp=85 :: H 1/7 score=38 bad csi=-0.08 | A[now:cc soon:cya soon:salt tune:fc tune:ph tune:ta] | PASS
#38781 [plaster+salt] fc=25,cc=0,ph=7.4,ta=100,cya=50,ch=500,salt=3700,temp=85 :: H 1/7 score=50 bad csi=-0.05 | A[soon:cya soon:salt tune:fc tune:ph tune:ta tune:ch] | PASS
#38816 [plaster+salt] fc=25,cc=0,ph=7.4,ta=100,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=81 bad csi=0.08 | A[soon:ch tune:ph tune:ta] | PASS
#38851 [plaster+salt] fc=25,cc=0,ph=7.4,ta=130,cya=20,ch=150,salt=2500,temp=85 :: H 1/7 score=42 bad csi=-0.35 | A[soon:cya soon:ta soon:ch soon:salt tune:fc tune:ph tune:csi] | PASS
#38886 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=130,cya=40,ch=150,salt=3700,temp=85 :: H 0/7 score=27 bad csi=-0.43 | A[now:cc soon:cya soon:ta soon:ch soon:salt tune:fc tune:ph tune:csi] | PASS
#38921 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=130,cya=50,ch=300,salt=3200,temp=85 :: H 2/7 score=42 bad csi=-0.12 | A[now:cc soon:cya soon:ta tune:fc tune:ph] | PASS
#38956 [plaster+salt] fc=25,cc=0.6,ph=7.4,ta=130,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=62 bad csi=0.01 | A[now:cc soon:ta soon:salt tune:ph] | PASS
#38991 [plaster+salt] fc=25,cc=0,ph=7.4,ta=130,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=65 bad csi=0.03 | A[soon:ta soon:salt tune:cya tune:ph tune:ch] | PASS
#39026 [plaster+salt] fc=25,cc=0,ph=7.6,ta=40,cya=20,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=-0.09 | A[soon:cya soon:ta soon:ch tune:fc] | PASS
#39061 [plaster+salt] fc=25,cc=0,ph=7.6,ta=40,cya=50,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=-0.86 | A[soon:cya soon:ta soon:ch soon:csi soon:salt tune:fc] | PASS
#39096 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=40,cya=70,ch=150,salt=3700,temp=85 :: H 3/7 score=58 bad csi=-1.07 | A[now:cc soon:ta soon:ch soon:csi soon:salt] | PASS
#39131 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=40,cya=90,ch=300,salt=3200,temp=85 :: H 4/7 score=62 bad csi=-0.97 | A[now:cc soon:ta soon:csi tune:cya] | PASS
#39166 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=60,cya=20,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-0.09 | A[now:cc soon:cya soon:salt tune:fc] | PASS
#39201 [plaster+salt] fc=25,cc=0,ph=7.6,ta=60,cya=40,ch=500,salt=3700,temp=85 :: H 3/7 score=62 bad csi=-0.11 | A[soon:cya soon:salt tune:fc tune:ch] | PASS
#39236 [plaster+salt] fc=25,cc=0,ph=7.6,ta=60,cya=50,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.02 | A[soon:cya soon:ch tune:fc] | PASS
#39271 [plaster+salt] fc=25,cc=0,ph=7.6,ta=60,cya=90,ch=150,salt=2500,temp=85 :: H 4/7 score=73 bad csi=-0.76 | A[soon:ch soon:csi soon:salt tune:cya] | PASS
#39306 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=80,cya=20,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.43 | A[now:cc soon:cya soon:ch soon:salt tune:fc tune:csi] | PASS
#39341 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=80,cya=40,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.15 | A[now:cc soon:cya tune:fc] | PASS
#39376 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=80,cya=50,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=-0.02 | A[now:cc soon:cya soon:salt tune:fc] | PASS
#39411 [plaster+salt] fc=25,cc=0,ph=7.6,ta=80,cya=70,ch=500,salt=3700,temp=85 :: H 5/7 score=88 bad csi=-0.03 | A[soon:salt tune:ch] | PASS
#39446 [plaster+salt] fc=25,cc=0,ph=7.6,ta=80,cya=90,ch=700,salt=3200,temp=85 :: H 5/7 score=85 bad csi=0.08 | A[soon:ch tune:cya] | PASS
#39481 [plaster+salt] fc=25,cc=0,ph=7.6,ta=100,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=58 bad csi=-0.3 | A[soon:cya soon:ch soon:salt tune:fc tune:ta] | PASS
#39516 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=100,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.37 | A[now:cc soon:cya soon:ch soon:salt tune:fc tune:ta tune:csi] | PASS
#39551 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=100,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=81 bad csi=-0.09 | A[now:cc tune:ta] | PASS
#39586 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=100,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=65 bad csi=0.03 | A[now:cc soon:salt tune:cya tune:ta] | PASS
#39621 [plaster+salt] fc=25,cc=0,ph=7.6,ta=130,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=0.31 | A[soon:cya soon:ta soon:salt tune:fc tune:ch tune:csi] | PASS
#39656 [plaster+salt] fc=25,cc=0,ph=7.6,ta=130,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.45 | A[soon:cya soon:ta soon:ch tune:fc tune:csi] | PASS
#39691 [plaster+salt] fc=25,cc=0,ph=7.6,ta=130,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=81 bad csi=-0.21 | A[soon:ta soon:ch soon:salt] | PASS
#39726 [plaster+salt] fc=25,cc=0.6,ph=7.6,ta=130,cya=90,ch=150,salt=3700,temp=85 :: H 2/7 score=58 bad csi=-0.3 | A[now:cc soon:ta soon:ch soon:salt tune:cya] | PASS
#39761 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=40,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=-0.25 | A[now:cc soon:cya soon:ta tune:fc] | PASS
#39796 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=40,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=-0.2 | A[now:cc soon:cya soon:ta soon:salt tune:fc] | PASS
#39831 [plaster+salt] fc=25,cc=0,ph=7.8,ta=40,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.23 | A[soon:cya soon:ta soon:salt tune:fc tune:ch] | PASS
#39866 [plaster+salt] fc=25,cc=0,ph=7.8,ta=40,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=85 bad csi=-0.23 | A[soon:ta soon:ch] | PASS
#39901 [plaster+salt] fc=25,cc=0,ph=7.8,ta=60,cya=20,ch=150,salt=2500,temp=85 :: H 3/7 score=58 bad csi=-0.31 | A[soon:cya soon:ch soon:salt tune:fc tune:csi] | PASS
#39936 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=60,cya=40,ch=150,salt=3700,temp=85 :: H 2/7 score=42 bad csi=-0.43 | A[now:cc soon:cya soon:ch soon:salt tune:fc tune:csi] | PASS
#39971 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=60,cya=50,ch=300,salt=3200,temp=85 :: H 4/7 score=58 bad csi=-0.15 | A[now:cc soon:cya tune:fc] | PASS
#40006 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=60,cya=70,ch=400,salt=2500,temp=85 :: H 5/7 score=77 bad csi=-0.07 | A[now:cc soon:salt] | PASS
#40041 [plaster+salt] fc=25,cc=0,ph=7.8,ta=60,cya=90,ch=500,salt=3700,temp=85 :: H 4/7 score=81 bad csi=-0.12 | A[soon:salt tune:cya tune:ch] | PASS
#40076 [plaster+salt] fc=25,cc=0,ph=7.8,ta=80,cya=20,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=0.45 | A[soon:cya soon:ch tune:fc tune:csi] | PASS
#40111 [plaster+salt] fc=25,cc=0,ph=7.8,ta=80,cya=50,ch=150,salt=2500,temp=85 :: H 3/7 score=62 bad csi=-0.24 | A[soon:cya soon:ch soon:salt tune:fc] | PASS
#40146 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=80,cya=70,ch=150,salt=3700,temp=85 :: H 4/7 score=69 bad csi=-0.35 | A[now:cc soon:ch soon:salt tune:csi] | PASS
#40181 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=80,cya=90,ch=300,salt=3200,temp=85 :: H 5/7 score=77 bad csi=-0.09 | A[now:cc tune:cya] | PASS
#40216 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=100,cya=20,ch=400,salt=2500,temp=85 :: H 2/7 score=42 bad csi=0.35 | A[now:cc soon:cya soon:salt tune:fc tune:ta tune:csi] | PASS
#40251 [plaster+salt] fc=25,cc=0,ph=7.8,ta=100,cya=40,ch=500,salt=3700,temp=85 :: H 2/7 score=54 bad csi=0.35 | A[soon:cya soon:salt tune:fc tune:ta tune:ch tune:csi] | PASS
#40286 [plaster+salt] fc=25,cc=0,ph=7.8,ta=100,cya=50,ch=700,salt=3200,temp=85 :: H 3/7 score=58 bad csi=0.5 | A[soon:cya soon:ch tune:fc tune:ta tune:csi] | PASS
#40321 [plaster+salt] fc=25,cc=0,ph=7.8,ta=100,cya=90,ch=150,salt=2500,temp=85 :: H 3/7 score=77 bad csi=-0.2 | A[soon:ch soon:salt tune:cya tune:ta] | PASS
#40356 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=130,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=38 bad csi=-0.01 | A[now:cc soon:cya soon:ta soon:ch soon:salt tune:fc] | PASS
#40391 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=130,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.29 | A[now:cc soon:cya soon:ta tune:fc] | PASS
#40426 [plaster+salt] fc=25,cc=0.6,ph=7.8,ta=130,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.43 | A[now:cc soon:cya soon:ta soon:salt tune:fc tune:csi] | PASS
#40461 [plaster+salt] fc=25,cc=0,ph=7.8,ta=130,cya=70,ch=500,salt=3700,temp=85 :: H 4/7 score=77 bad csi=0.44 | A[soon:ta soon:salt tune:ch tune:csi] | PASS
#40496 [plaster+salt] fc=25,cc=0,ph=7.8,ta=130,cya=90,ch=700,salt=3200,temp=85 :: H 4/7 score=73 bad csi=0.57 | A[soon:ta soon:ch tune:cya tune:csi] | PASS
#40531 [plaster+salt] fc=25,cc=0,ph=8,ta=40,cya=40,ch=150,salt=2500,temp=85 :: H 1/7 score=42 bad csi=-0.43 | A[soon:cya soon:ta soon:ch soon:salt tune:fc tune:ph tune:csi] | PASS
#40566 [plaster+salt] fc=25,cc=0.6,ph=8,ta=40,cya=50,ch=150,salt=3700,temp=85 :: H 0/7 score=27 bad csi=-0.55 | A[now:cc soon:cya soon:ta soon:ch soon:salt tune:fc tune:ph tune:csi] | PASS
#40601 [plaster+salt] fc=25,cc=0.6,ph=8,ta=40,cya=70,ch=300,salt=3200,temp=85 :: H 4/7 score=65 bad csi=-0.41 | A[now:cc soon:ta tune:ph tune:csi] | PASS
#40636 [plaster+salt] fc=25,cc=0.6,ph=8,ta=40,cya=90,ch=400,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-0.55 | A[now:cc soon:ta soon:salt tune:cya tune:ph tune:csi] | PASS
#40671 [plaster+salt] fc=25,cc=0,ph=8,ta=60,cya=20,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=0.34 | A[soon:cya soon:salt tune:fc tune:ph tune:ch tune:csi] | PASS
#40706 [plaster+salt] fc=25,cc=0,ph=8,ta=60,cya=40,ch=700,salt=3200,temp=85 :: H 3/7 score=54 bad csi=0.44 | A[soon:cya soon:ch tune:fc tune:ph tune:csi] | PASS
#40741 [plaster+salt] fc=25,cc=0,ph=8,ta=60,cya=70,ch=150,salt=2500,temp=85 :: H 4/7 score=81 bad csi=-0.3 | A[soon:ch soon:salt tune:ph] | PASS
#40776 [plaster+salt] fc=25,cc=0.6,ph=8,ta=60,cya=90,ch=150,salt=3700,temp=85 :: H 2/7 score=54 bad csi=-0.46 | A[now:cc soon:ch soon:salt tune:cya tune:ph tune:csi] | PASS
#40811 [plaster+salt] fc=25,cc=0.6,ph=8,ta=80,cya=20,ch=300,salt=3200,temp=85 :: H 3/7 score=50 bad csi=0.29 | A[now:cc soon:cya tune:fc tune:ph] | PASS
#40846 [plaster+salt] fc=25,cc=0.6,ph=8,ta=80,cya=40,ch=400,salt=2500,temp=85 :: H 2/7 score=38 bad csi=0.4 | A[now:cc soon:cya soon:salt tune:fc tune:ph tune:csi] | PASS
#40881 [plaster+salt] fc=25,cc=0,ph=8,ta=80,cya=50,ch=500,salt=3700,temp=85 :: H 2/7 score=50 bad csi=0.41 | A[soon:cya soon:salt tune:fc tune:ph tune:ch tune:csi] | PASS
#40916 [plaster+salt] fc=25,cc=0,ph=8,ta=80,cya=70,ch=700,salt=3200,temp=85 :: H 5/7 score=81 bad csi=0.52 | A[soon:ch tune:ph tune:csi] | PASS
#40951 [plaster+salt] fc=25,cc=0,ph=8,ta=100,cya=20,ch=150,salt=2500,temp=85 :: H 1/7 score=50 bad csi=0.13 | A[soon:cya soon:ch soon:salt tune:fc tune:ph tune:ta] | PASS
#40986 [plaster+salt] fc=25,cc=0.6,ph=8,ta=100,cya=40,ch=150,salt=3700,temp=85 :: H 0/7 score=35 bad csi=0.04 | A[now:cc soon:cya soon:ch soon:salt tune:fc tune:ph tune:ta] | PASS
#41021 [plaster+salt] fc=25,cc=0.6,ph=8,ta=100,cya=50,ch=300,salt=3200,temp=85 :: H 2/7 score=42 bad csi=0.34 | A[now:cc soon:cya tune:fc tune:ph tune:ta tune:csi] | PASS
#41056 [plaster+salt] fc=25,cc=0.6,ph=8,ta=100,cya=70,ch=400,salt=2500,temp=85 :: H 3/7 score=62 bad csi=0.45 | A[now:cc soon:salt tune:ph tune:ta tune:csi] | PASS
#41091 [plaster+salt] fc=25,cc=0,ph=8,ta=100,cya=90,ch=500,salt=3700,temp=85 :: H 2/7 score=65 bad csi=0.45 | A[soon:salt tune:cya tune:ph tune:ta tune:ch tune:csi] | PASS
#41126 [plaster+salt] fc=25,cc=0,ph=8,ta=130,cya=20,ch=700,salt=3200,temp=85 :: H 2/7 score=42 bad csi=0.87 | A[soon:cya soon:ta soon:ch soon:csi tune:fc tune:ph] | PASS
#41161 [plaster+salt] fc=25,cc=0,ph=8,ta=130,cya=50,ch=150,salt=2500,temp=85 :: H 1/7 score=46 bad csi=0.21 | A[soon:cya soon:ta soon:ch soon:salt tune:fc tune:ph] | PASS
#41196 [plaster+salt] fc=25,cc=0.6,ph=8,ta=130,cya=70,ch=150,salt=3700,temp=85 :: H 2/7 score=58 bad csi=0.12 | A[now:cc soon:ta soon:ch soon:salt tune:ph] | PASS
#41231 [plaster+salt] fc=25,cc=0.6,ph=8,ta=130,cya=90,ch=300,salt=3200,temp=85 :: H 3/7 score=58 bad csi=0.41 | A[now:cc soon:ta tune:cya tune:ph tune:csi] | PASS
#41266 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=40,cya=20,ch=400,salt=2500,temp=85 :: H 1/7 score=23 bad csi=0.4 | A[now:cc soon:cya soon:ta soon:salt tune:fc tune:ph tune:csi] | PASS
#41301 [plaster+salt] fc=25,cc=0,ph=8.3,ta=40,cya=40,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=0.32 | A[soon:cya soon:ta soon:salt tune:fc tune:ph tune:ch tune:csi] | PASS
#41336 [plaster+salt] fc=25,cc=0,ph=8.3,ta=40,cya=50,ch=700,salt=3200,temp=85 :: H 2/7 score=38 bad csi=0.41 | A[soon:cya soon:ta soon:ch tune:fc tune:ph tune:csi] | PASS
#41371 [plaster+salt] fc=25,cc=0,ph=8.3,ta=40,cya=90,ch=150,salt=2500,temp=85 :: H 2/7 score=50 bad csi=-0.74 | A[soon:ta soon:ch soon:csi soon:salt tune:cya tune:ph] | PASS
#41406 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=60,cya=20,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=0.13 | A[now:cc soon:cya soon:ch soon:salt tune:fc tune:ph] | PASS
#41441 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=60,cya=40,ch=300,salt=3200,temp=85 :: H 3/7 score=38 bad csi=0.38 | A[now:cc soon:cya tune:fc tune:ph tune:csi] | PASS
#41476 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=60,cya=50,ch=400,salt=2500,temp=85 :: H 2/7 score=31 bad csi=0.5 | A[now:cc soon:cya soon:salt tune:fc tune:ph tune:csi] | PASS
#41511 [plaster+salt] fc=25,cc=0,ph=8.3,ta=60,cya=70,ch=500,salt=3700,temp=85 :: H 4/7 score=69 bad csi=0.45 | A[soon:salt tune:ph tune:ch tune:csi] | PASS
#41546 [plaster+salt] fc=25,cc=0,ph=8.3,ta=60,cya=90,ch=700,salt=3200,temp=85 :: H 4/7 score=65 bad csi=0.5 | A[soon:ch tune:cya tune:ph tune:csi] | PASS
#41581 [plaster+salt] fc=25,cc=0,ph=8.3,ta=80,cya=40,ch=150,salt=2500,temp=85 :: H 2/7 score=46 bad csi=0.28 | A[soon:cya soon:ch soon:salt tune:fc tune:ph] | PASS
#41616 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=80,cya=50,ch=150,salt=3700,temp=85 :: H 1/7 score=31 bad csi=0.19 | A[now:cc soon:cya soon:ch soon:salt tune:fc tune:ph] | PASS
#41651 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=80,cya=70,ch=300,salt=3200,temp=85 :: H 5/7 score=65 bad csi=0.46 | A[now:cc tune:ph tune:csi] | PASS
#41686 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=80,cya=90,ch=400,salt=2500,temp=85 :: H 3/7 score=50 bad csi=0.55 | A[now:cc soon:salt tune:cya tune:ph tune:csi] | PASS
#41721 [plaster+salt] fc=25,cc=0,ph=8.3,ta=100,cya=20,ch=500,salt=3700,temp=85 :: H 1/7 score=35 bad csi=0.89 | A[soon:cya soon:csi soon:salt tune:fc tune:ph tune:ta tune:ch] | PASS
#41756 [plaster+salt] fc=25,cc=0,ph=8.3,ta=100,cya=40,ch=700,salt=3200,temp=85 :: H 2/7 score=38 bad csi=1.01 | A[soon:cya soon:ch soon:csi tune:fc tune:ph tune:ta] | PASS
#41791 [plaster+salt] fc=25,cc=0,ph=8.3,ta=100,cya=70,ch=150,salt=2500,temp=85 :: H 3/7 score=65 bad csi=0.33 | A[soon:ch soon:salt tune:ph tune:ta tune:csi] | PASS
#41826 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=100,cya=90,ch=150,salt=3700,temp=85 :: H 1/7 score=46 bad csi=0.23 | A[now:cc soon:ch soon:salt tune:cya tune:ph tune:ta] | PASS
#41861 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=130,cya=20,ch=300,salt=3200,temp=85 :: H 2/7 score=27 bad csi=0.81 | A[now:cc soon:cya soon:ta soon:csi tune:fc tune:ph] | PASS
#41896 [plaster+salt] fc=25,cc=0.6,ph=8.3,ta=130,cya=40,ch=400,salt=2500,temp=85 :: H 1/7 score=19 bad csi=0.94 | A[now:cc soon:cya soon:ta soon:csi soon:salt tune:fc tune:ph] | PASS
#41931 [plaster+salt] fc=25,cc=0,ph=8.3,ta=130,cya=50,ch=500,salt=3700,temp=85 :: H 1/7 score=31 bad csi=0.96 | A[soon:cya soon:ta soon:csi soon:salt tune:fc tune:ph tune:ch] | PASS
#41966 [plaster+salt] fc=25,cc=0,ph=8.3,ta=130,cya=70,ch=700,salt=3200,temp=85 :: H 4/7 score=62 bad csi=1.1 | A[soon:ta soon:ch soon:csi tune:ph] | PASS
#42001 [pebble+liquid] fc=0,cc=0,ph=7,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=21 bad csi=-1.32 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#42036 [pebble+liquid] fc=0,cc=0.6,ph=7,ta=40,cya=70,ch=400,temp=85 :: H 1/6 score=8 bad csi=-1.07 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi] | PASS
#42071 [pebble+liquid] fc=0,cc=0,ph=7,ta=60,cya=50,ch=150,temp=85 :: H 3/6 score=46 bad csi=-1.19 | A[now:fc soon:ph soon:ch soon:csi] | PASS
#42106 [pebble+liquid] fc=0,cc=0.6,ph=7,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=21 bad csi=-0.58 | A[now:cc now:fc soon:cya soon:ph tune:csi] | PASS
#42141 [pebble+liquid] fc=0,cc=0,ph=7,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=29 bad csi=-1.1 | A[now:fc soon:cya soon:ph soon:ch soon:csi] | PASS
#42176 [pebble+liquid] fc=0,cc=0.6,ph=7,ta=100,cya=50,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.51 | A[now:cc now:fc soon:ph tune:ta tune:csi] | PASS
#42211 [pebble+liquid] fc=0,cc=0,ph=7,ta=130,cya=40,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.79 | A[now:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#42246 [pebble+liquid] fc=0,cc=0.6,ph=7,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=-0.42 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#42281 [pebble+liquid] fc=0,cc=0,ph=7.4,ta=40,cya=70,ch=150,temp=85 :: H 1/6 score=29 bad csi=-1.2 | A[now:fc soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#42316 [pebble+liquid] fc=0,cc=0.6,ph=7.4,ta=60,cya=40,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.37 | A[now:cc now:fc tune:ph tune:csi] | PASS
#42351 [pebble+liquid] fc=0,cc=0,ph=7.4,ta=80,cya=20,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.6 | A[now:fc soon:cya soon:ch tune:ph tune:csi] | PASS
#42386 [pebble+liquid] fc=0,cc=0.6,ph=7.4,ta=80,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.28 | A[now:cc now:fc soon:cya tune:ph] | PASS
#42421 [pebble+liquid] fc=0,cc=0,ph=7.4,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=54 bad csi=-0.55 | A[now:fc soon:ch tune:ph tune:ta tune:csi] | PASS
#42456 [pebble+liquid] fc=0,cc=0.6,ph=7.4,ta=130,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.04 | A[now:cc now:fc soon:cya soon:ta tune:ph] | PASS
#42491 [pebble+liquid] fc=0,cc=0,ph=7.4,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=33 bad csi=-0.46 | A[now:fc soon:cya soon:ta soon:ch tune:ph tune:csi] | PASS
#42526 [pebble+liquid] fc=0,cc=0.6,ph=7.6,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.48 | A[now:cc now:fc soon:ta tune:csi] | PASS
#42561 [pebble+liquid] fc=0,cc=0,ph=7.6,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=67 bad csi=-0.6 | A[now:fc soon:ch tune:csi] | PASS
#42596 [pebble+liquid] fc=0,cc=0.6,ph=7.6,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=38 bad csi=-0.37 | A[now:cc now:fc soon:cya tune:csi] | PASS
#42631 [pebble+liquid] fc=0,cc=0,ph=7.6,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.52 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#42666 [pebble+liquid] fc=0,cc=0.6,ph=7.6,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.08 | A[now:cc now:fc tune:ta] | PASS
#42701 [pebble+liquid] fc=0,cc=0,ph=7.6,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.18 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#42736 [pebble+liquid] fc=0,cc=0.6,ph=7.6,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.17 | A[now:cc now:fc soon:cya soon:ta] | PASS
#42771 [pebble+liquid] fc=0,cc=0,ph=7.8,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=-0.72 | A[now:fc soon:ta soon:ch soon:csi] | PASS
#42806 [pebble+liquid] fc=0,cc=0.6,ph=7.8,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=42 bad csi=0.07 | A[now:cc now:fc soon:cya] | PASS
#42841 [pebble+liquid] fc=0,cc=0,ph=7.8,ta=60,cya=90,ch=150,temp=85 :: H 3/6 score=46 bad csi=-0.62 | A[now:fc soon:cya soon:ch soon:csi] | PASS
#42876 [pebble+liquid] fc=0,cc=0.6,ph=7.8,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=58 bad csi=0.14 | A[now:cc now:fc] | PASS
#42911 [pebble+liquid] fc=0,cc=0,ph=7.8,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.14 | A[now:fc soon:ch tune:ta] | PASS
#42946 [pebble+liquid] fc=0,cc=0.6,ph=7.8,ta=100,cya=90,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.18 | A[now:cc now:fc soon:cya tune:ta] | PASS
#42981 [pebble+liquid] fc=0,cc=0,ph=7.8,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.05 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#43016 [pebble+liquid] fc=0,cc=0.6,ph=8,ta=40,cya=40,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.04 | A[now:cc now:fc soon:ph soon:ta] | PASS
#43051 [pebble+liquid] fc=0,cc=0,ph=8,ta=60,cya=20,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.15 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#43086 [pebble+liquid] fc=0,cc=0.6,ph=8,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.09 | A[now:cc now:fc soon:cya soon:ph] | PASS
#43121 [pebble+liquid] fc=0,cc=0,ph=8,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.08 | A[now:fc soon:ph soon:ch] | PASS
#43156 [pebble+liquid] fc=0,cc=0.6,ph=8,ta=100,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.51 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#43191 [pebble+liquid] fc=0,cc=0,ph=8,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.05 | A[now:fc soon:cya soon:ph soon:ch tune:ta] | PASS
#43226 [pebble+liquid] fc=0,cc=0.6,ph=8,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.59 | A[now:cc now:fc soon:ph soon:ta tune:csi] | PASS
#43261 [pebble+liquid] fc=0,cc=0,ph=8.3,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.17 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#43296 [pebble+liquid] fc=0,cc=0.6,ph=8.3,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=-0.35 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#43331 [pebble+liquid] fc=0,cc=0,ph=8.3,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.04 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#43366 [pebble+liquid] fc=0,cc=0.6,ph=8.3,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=33 bad csi=0.66 | A[now:cc now:fc soon:ph soon:csi] | PASS
#43401 [pebble+liquid] fc=0,cc=0,ph=8.3,ta=100,cya=20,ch=150,temp=85 :: H 1/6 score=29 bad csi=0.39 | A[now:fc soon:cya soon:ph soon:ch tune:ta tune:csi] | PASS
#43436 [pebble+liquid] fc=0,cc=0.6,ph=8.3,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=13 bad csi=0.71 | A[now:cc now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#43471 [pebble+liquid] fc=0,cc=0,ph=8.3,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=42 bad csi=0.47 | A[now:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#43506 [pebble+liquid] fc=2,cc=0.6,ph=7,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=21 bad csi=-0.9 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi] | PASS
#43541 [pebble+liquid] fc=2,cc=0,ph=7,ta=40,cya=90,ch=150,temp=85 :: H 1/6 score=21 bad csi=-1.59 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#43576 [pebble+liquid] fc=2,cc=0.6,ph=7,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=33 bad csi=-0.77 | A[now:cc now:fc soon:ph soon:csi] | PASS
#43611 [pebble+liquid] fc=2,cc=0,ph=7,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=46 bad csi=-1.02 | A[now:fc soon:ph soon:ch soon:csi] | PASS
#43646 [pebble+liquid] fc=2,cc=0.6,ph=7,ta=80,cya=90,ch=400,temp=85 :: H 2/6 score=17 bad csi=-0.68 | A[now:cc now:fc soon:cya soon:ph soon:csi] | PASS
#43681 [pebble+liquid] fc=2,cc=0,ph=7,ta=100,cya=70,ch=150,temp=85 :: H 1/6 score=25 bad csi=-0.95 | A[now:fc soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#43716 [pebble+liquid] fc=2,cc=0.6,ph=7,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.37 | A[now:cc now:fc soon:ph soon:ta tune:csi] | PASS
#43751 [pebble+liquid] fc=2,cc=0,ph=7.4,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.94 | A[soon:cya soon:fc soon:ta soon:ch soon:csi tune:ph] | PASS
#43786 [pebble+liquid] fc=2,cc=0.6,ph=7.4,ta=40,cya=70,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.78 | A[now:cc now:fc soon:cya soon:ta soon:csi tune:ph] | PASS
#43821 [pebble+liquid] fc=2,cc=0,ph=7.4,ta=60,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=-0.82 | A[now:fc soon:ch soon:csi tune:ph] | PASS
#43856 [pebble+liquid] fc=2,cc=0.6,ph=7.4,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.18 | A[now:cc soon:cya soon:fc tune:ph] | PASS
#43891 [pebble+liquid] fc=2,cc=0,ph=7.4,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.75 | A[now:fc soon:cya soon:ch soon:csi tune:ph] | PASS
#43926 [pebble+liquid] fc=2,cc=0.6,ph=7.4,ta=100,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.13 | A[now:cc now:fc tune:ph tune:ta] | PASS
#43961 [pebble+liquid] fc=2,cc=0,ph=7.4,ta=130,cya=40,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.4 | A[now:fc soon:ta soon:ch tune:ph tune:csi] | PASS
#43996 [pebble+liquid] fc=2,cc=0.6,ph=7.4,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=25 bad csi=-0.04 | A[now:cc now:fc soon:cya soon:ta tune:ph] | PASS
#44031 [pebble+liquid] fc=2,cc=0,ph=7.6,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-1.04 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#44066 [pebble+liquid] fc=2,cc=0.6,ph=7.6,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=58 bad csi=-0.18 | A[now:cc now:fc] | PASS
#44101 [pebble+liquid] fc=2,cc=0,ph=7.6,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.41 | A[soon:cya soon:fc soon:ch tune:csi] | PASS
#44136 [pebble+liquid] fc=2,cc=0.6,ph=7.6,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.1 | A[now:cc now:fc soon:cya] | PASS
#44171 [pebble+liquid] fc=2,cc=0,ph=7.6,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.35 | A[now:fc soon:ch tune:ta tune:csi] | PASS
#44206 [pebble+liquid] fc=2,cc=0.6,ph=7.6,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.24 | A[now:cc soon:cya soon:fc soon:ta] | PASS
#44241 [pebble+liquid] fc=2,cc=0,ph=7.6,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.27 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#44276 [pebble+liquid] fc=2,cc=0.6,ph=7.8,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.3 | A[now:cc now:fc soon:ta] | PASS
#44311 [pebble+liquid] fc=2,cc=0,ph=7.8,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=67 bad csi=-0.41 | A[now:fc soon:ch tune:csi] | PASS
#44346 [pebble+liquid] fc=2,cc=0.6,ph=7.8,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.2 | A[now:cc now:fc soon:cya] | PASS
#44381 [pebble+liquid] fc=2,cc=0,ph=7.8,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.33 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#44416 [pebble+liquid] fc=2,cc=0.6,ph=7.8,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.28 | A[now:cc now:fc tune:ta] | PASS
#44451 [pebble+liquid] fc=2,cc=0,ph=7.8,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.02 | A[soon:cya soon:fc soon:ta soon:ch] | PASS
#44486 [pebble+liquid] fc=2,cc=0.6,ph=7.8,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.37 | A[now:cc now:fc soon:cya soon:ta tune:csi] | PASS
#44521 [pebble+liquid] fc=2,cc=0,ph=8,ta=40,cya=50,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.53 | A[now:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#44556 [pebble+liquid] fc=2,cc=0.6,ph=8,ta=60,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.27 | A[now:cc soon:cya soon:fc soon:ph] | PASS
#44591 [pebble+liquid] fc=2,cc=0,ph=8,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.43 | A[now:fc soon:cya soon:ph soon:ch tune:csi] | PASS
#44626 [pebble+liquid] fc=2,cc=0.6,ph=8,ta=80,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.34 | A[now:cc now:fc soon:ph tune:csi] | PASS
#44661 [pebble+liquid] fc=2,cc=0,ph=8,ta=100,cya=40,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.06 | A[now:fc soon:ph soon:ch tune:ta] | PASS
#44696 [pebble+liquid] fc=2,cc=0.6,ph=8,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.37 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#44731 [pebble+liquid] fc=2,cc=0,ph=8,ta=130,cya=70,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.14 | A[now:fc soon:cya soon:ph soon:ta soon:ch] | PASS
#44766 [pebble+liquid] fc=2,cc=0.6,ph=8.3,ta=40,cya=40,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.25 | A[now:cc now:fc soon:ph soon:ta] | PASS
#44801 [pebble+liquid] fc=2,cc=0,ph=8.3,ta=60,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.15 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#44836 [pebble+liquid] fc=2,cc=0.6,ph=8.3,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=21 bad csi=0.38 | A[now:cc now:fc soon:cya soon:ph tune:csi] | PASS
#44871 [pebble+liquid] fc=2,cc=0,ph=8.3,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=0.21 | A[now:fc soon:ph soon:ch] | PASS
#44906 [pebble+liquid] fc=2,cc=0.6,ph=8.3,ta=100,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.81 | A[now:cc soon:cya soon:fc soon:ph soon:csi tune:ta] | PASS
#44941 [pebble+liquid] fc=2,cc=0,ph=8.3,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=33 bad csi=0.25 | A[now:fc soon:cya soon:ph soon:ch tune:ta] | PASS
#44976 [pebble+liquid] fc=2,cc=0.6,ph=8.3,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=25 bad csi=0.89 | A[now:cc now:fc soon:ph soon:ta soon:csi] | PASS
#45011 [pebble+liquid] fc=3,cc=0,ph=7,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=50 bad csi=-1.38 | A[soon:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#45046 [pebble+liquid] fc=3,cc=0.6,ph=7,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=8 bad csi=-1.17 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi] | PASS
#45081 [pebble+liquid] fc=3,cc=0,ph=7,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=29 bad csi=-1.23 | A[now:fc soon:cya soon:ph soon:ch soon:csi] | PASS
#45116 [pebble+liquid] fc=3,cc=0.6,ph=7,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.6 | A[now:cc soon:fc soon:ph tune:csi] | PASS
#45151 [pebble+liquid] fc=3,cc=0,ph=7,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.89 | A[soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#45186 [pebble+liquid] fc=3,cc=0.6,ph=7,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.53 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#45221 [pebble+liquid] fc=3,cc=0,ph=7,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.8 | A[now:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#45256 [pebble+liquid] fc=3,cc=0.6,ph=7.4,ta=40,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.52 | A[now:cc soon:cya soon:ta tune:ph tune:csi] | PASS
#45291 [pebble+liquid] fc=3,cc=0,ph=7.4,ta=40,cya=90,ch=150,temp=85 :: H 1/6 score=29 bad csi=-1.37 | A[now:fc soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#45326 [pebble+liquid] fc=3,cc=0.6,ph=7.4,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.4 | A[now:cc now:fc tune:ph tune:csi] | PASS
#45361 [pebble+liquid] fc=3,cc=0,ph=7.4,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.64 | A[soon:fc soon:ch soon:csi tune:ph] | PASS
#45396 [pebble+liquid] fc=3,cc=0.6,ph=7.4,ta=80,cya=90,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.33 | A[now:cc now:fc soon:cya tune:ph tune:csi] | PASS
#45431 [pebble+liquid] fc=3,cc=0,ph=7.4,ta=100,cya=70,ch=150,temp=85 :: H 1/6 score=38 bad csi=-0.58 | A[now:fc soon:cya soon:ch tune:ph tune:ta tune:csi] | PASS
#45466 [pebble+liquid] fc=3,cc=0.6,ph=7.4,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=54 bad csi=0.02 | A[now:cc soon:fc soon:ta tune:ph] | PASS
#45501 [pebble+liquid] fc=3,cc=0,ph=7.6,ta=40,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.75 | A[soon:cya soon:ta soon:ch soon:csi] | PASS
#45536 [pebble+liquid] fc=3,cc=0.6,ph=7.6,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=25 bad csi=-0.63 | A[now:cc now:fc soon:cya soon:ta soon:csi] | PASS
#45571 [pebble+liquid] fc=3,cc=0,ph=7.6,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=63 bad csi=-0.63 | A[now:fc soon:ch soon:csi] | PASS
#45606 [pebble+liquid] fc=3,cc=0.6,ph=7.6,ta=80,cya=20,ch=400,temp=85 :: H 4/6 score=67 bad csi=0.01 | A[now:cc soon:cya] | PASS
#45641 [pebble+liquid] fc=3,cc=0,ph=7.6,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.57 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#45676 [pebble+liquid] fc=3,cc=0.6,ph=7.6,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.07 | A[now:cc now:fc tune:ta] | PASS
#45711 [pebble+liquid] fc=3,cc=0,ph=7.6,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.21 | A[soon:fc soon:ta soon:ch] | PASS
#45746 [pebble+liquid] fc=3,cc=0.6,ph=7.6,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.15 | A[now:cc now:fc soon:cya soon:ta] | PASS
#45781 [pebble+liquid] fc=3,cc=0,ph=7.8,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.88 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#45816 [pebble+liquid] fc=3,cc=0.6,ph=7.8,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=0.01 | A[now:cc soon:fc] | PASS
#45851 [pebble+liquid] fc=3,cc=0,ph=7.8,ta=80,cya=20,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.21 | A[soon:cya soon:ch] | PASS
#45886 [pebble+liquid] fc=3,cc=0.6,ph=7.8,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=0.09 | A[now:cc now:fc soon:cya] | PASS
#45921 [pebble+liquid] fc=3,cc=0,ph=7.8,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.16 | A[now:fc soon:ch tune:ta] | PASS
#45956 [pebble+liquid] fc=3,cc=0.6,ph=7.8,ta=130,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.43 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#45991 [pebble+liquid] fc=3,cc=0,ph=7.8,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.08 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#46026 [pebble+liquid] fc=3,cc=0.6,ph=8,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.11 | A[now:cc now:fc soon:ph soon:ta] | PASS
#46061 [pebble+liquid] fc=3,cc=0,ph=8,ta=60,cya=40,ch=150,temp=85 :: H 3/6 score=75 warn csi=-0.21 | A[soon:fc soon:ph soon:ch] | PASS
#46096 [pebble+liquid] fc=3,cc=0.6,ph=8,ta=60,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.02 | A[now:cc now:fc soon:cya soon:ph] | PASS
#46131 [pebble+liquid] fc=3,cc=0,ph=8,ta=80,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.14 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#46166 [pebble+liquid] fc=3,cc=0.6,ph=8,ta=100,cya=40,ch=400,temp=85 :: H 2/6 score=54 bad csi=0.48 | A[now:cc soon:fc soon:ph tune:ta tune:csi] | PASS
#46201 [pebble+liquid] fc=3,cc=0,ph=8,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=0.21 | A[soon:cya soon:ph soon:ta soon:ch] | PASS
#46236 [pebble+liquid] fc=3,cc=0.6,ph=8,ta=130,cya=70,ch=400,temp=85 :: H 1/6 score=21 bad csi=0.56 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#46271 [pebble+liquid] fc=3,cc=0,ph=8.3,ta=40,cya=50,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.24 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#46306 [pebble+liquid] fc=3,cc=0.6,ph=8.3,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.57 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#46341 [pebble+liquid] fc=3,cc=0,ph=8.3,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.15 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#46376 [pebble+liquid] fc=3,cc=0.6,ph=8.3,ta=80,cya=50,ch=400,temp=85 :: H 3/6 score=33 bad csi=0.63 | A[now:cc now:fc soon:ph soon:csi] | PASS
#46411 [pebble+liquid] fc=3,cc=0,ph=8.3,ta=100,cya=40,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.36 | A[soon:fc soon:ph soon:ch tune:ta tune:csi] | PASS
#46446 [pebble+liquid] fc=3,cc=0.6,ph=8.3,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=0.67 | A[now:cc now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#46481 [pebble+liquid] fc=3,cc=0,ph=8.3,ta=130,cya=70,ch=150,temp=85 :: H 1/6 score=25 bad csi=0.44 | A[now:fc soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#46516 [pebble+liquid] fc=5,cc=0.6,ph=7,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.96 | A[now:cc soon:ph soon:ta soon:csi] | PASS
#46551 [pebble+liquid] fc=5,cc=0,ph=7,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=54 bad csi=-1.13 | A[soon:cya soon:ph soon:ch soon:csi] | PASS
#46586 [pebble+liquid] fc=5,cc=0.6,ph=7,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.81 | A[now:cc soon:cya soon:fc soon:ph soon:csi] | PASS
#46621 [pebble+liquid] fc=5,cc=0,ph=7,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=58 bad csi=-1.04 | A[soon:fc soon:ph soon:ch soon:csi] | PASS
#46656 [pebble+liquid] fc=5,cc=0.6,ph=7,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.47 | A[now:cc soon:cya soon:ph tune:ta tune:csi] | PASS
#46691 [pebble+liquid] fc=5,cc=0,ph=7,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=25 bad csi=-0.97 | A[now:fc soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#46726 [pebble+liquid] fc=5,cc=0.6,ph=7,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.38 | A[now:cc soon:fc soon:ph soon:ta tune:csi] | PASS
#46761 [pebble+liquid] fc=5,cc=0,ph=7.4,ta=40,cya=40,ch=150,temp=85 :: H 3/6 score=71 bad csi=-1.03 | A[soon:ta soon:ch soon:csi tune:ph] | PASS
#46796 [pebble+liquid] fc=5,cc=0.6,ph=7.4,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.95 | A[now:cc now:fc soon:cya soon:ta soon:csi tune:ph] | PASS
#46831 [pebble+liquid] fc=5,cc=0,ph=7.4,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.88 | A[soon:cya soon:fc soon:ch soon:csi tune:ph] | PASS
#46866 [pebble+liquid] fc=5,cc=0.6,ph=7.4,ta=80,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=-0.22 | A[now:cc tune:ph] | PASS
#46901 [pebble+liquid] fc=5,cc=0,ph=7.4,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.5 | A[soon:cya soon:ch tune:ph tune:ta tune:csi] | PASS
#46936 [pebble+liquid] fc=5,cc=0.6,ph=7.4,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=42 bad csi=-0.16 | A[now:cc soon:cya soon:fc tune:ph tune:ta] | PASS
#46971 [pebble+liquid] fc=5,cc=0,ph=7.4,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.42 | A[soon:fc soon:ta soon:ch tune:ph tune:csi] | PASS
#47006 [pebble+liquid] fc=5,cc=0.6,ph=7.6,ta=40,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.33 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#47041 [pebble+liquid] fc=5,cc=0,ph=7.6,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-1.26 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#47076 [pebble+liquid] fc=5,cc=0.6,ph=7.6,ta=60,cya=50,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.21 | A[now:cc soon:fc] | PASS
#47111 [pebble+liquid] fc=5,cc=0,ph=7.6,ta=80,cya=40,ch=150,temp=85 :: H 5/6 score=92 warn csi=-0.45 | A[soon:ch tune:csi] | PASS
#47146 [pebble+liquid] fc=5,cc=0.6,ph=7.6,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.15 | A[now:cc now:fc soon:cya] | PASS
#47181 [pebble+liquid] fc=5,cc=0,ph=7.6,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.39 | A[soon:cya soon:fc soon:ch tune:ta tune:csi] | PASS
#47216 [pebble+liquid] fc=5,cc=0.6,ph=7.6,ta=130,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.21 | A[now:cc soon:ta] | PASS
#47251 [pebble+liquid] fc=5,cc=0,ph=7.8,ta=40,cya=20,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.55 | A[soon:cya soon:ta soon:ch tune:csi] | PASS
#47286 [pebble+liquid] fc=5,cc=0.6,ph=7.8,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.46 | A[now:cc soon:cya soon:fc soon:ta tune:csi] | PASS
#47321 [pebble+liquid] fc=5,cc=0,ph=7.8,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=79 warn csi=-0.44 | A[soon:fc soon:ch tune:csi] | PASS
#47356 [pebble+liquid] fc=5,cc=0.6,ph=7.8,ta=80,cya=20,ch=400,temp=85 :: H 4/6 score=67 bad csi=0.21 | A[now:cc soon:cya] | PASS
#47391 [pebble+liquid] fc=5,cc=0,ph=7.8,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.39 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#47426 [pebble+liquid] fc=5,cc=0.6,ph=7.8,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0.26 | A[now:cc soon:fc tune:ta] | PASS
#47461 [pebble+liquid] fc=5,cc=0,ph=7.8,ta=130,cya=40,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.01 | A[soon:ta soon:ch] | PASS
#47496 [pebble+liquid] fc=5,cc=0.6,ph=7.8,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.34 | A[now:cc now:fc soon:cya soon:ta tune:csi] | PASS
#47531 [pebble+liquid] fc=5,cc=0,ph=8,ta=40,cya=70,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.71 | A[soon:cya soon:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#47566 [pebble+liquid] fc=5,cc=0.6,ph=8,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.21 | A[now:cc soon:ph] | PASS
#47601 [pebble+liquid] fc=5,cc=0,ph=8,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.01 | A[soon:cya soon:ph soon:ch] | PASS
#47636 [pebble+liquid] fc=5,cc=0.6,ph=8,ta=80,cya=70,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.28 | A[now:cc soon:cya soon:fc soon:ph] | PASS
#47671 [pebble+liquid] fc=5,cc=0,ph=8,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=71 warn csi=0.04 | A[soon:fc soon:ph soon:ch tune:ta] | PASS
#47706 [pebble+liquid] fc=5,cc=0.6,ph=8,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=0.63 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#47741 [pebble+liquid] fc=5,cc=0,ph=8,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.11 | A[now:fc soon:cya soon:ph soon:ta soon:ch] | PASS
#47776 [pebble+liquid] fc=5,cc=0.6,ph=8.3,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.18 | A[now:cc soon:fc soon:ph soon:ta] | PASS
#47811 [pebble+liquid] fc=5,cc=0,ph=8.3,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=0.08 | A[soon:ph soon:ch] | PASS
#47846 [pebble+liquid] fc=5,cc=0.6,ph=8.3,ta=60,cya=90,ch=400,temp=85 :: H 2/6 score=25 bad csi=0.27 | A[now:cc now:fc soon:cya soon:ph] | PASS
#47881 [pebble+liquid] fc=5,cc=0,ph=8.3,ta=80,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.16 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#47916 [pebble+liquid] fc=5,cc=0.6,ph=8.3,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.78 | A[now:cc soon:ph soon:csi tune:ta] | PASS
#47951 [pebble+liquid] fc=5,cc=0,ph=8.3,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.51 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#47986 [pebble+liquid] fc=5,cc=0.6,ph=8.3,ta=130,cya=70,ch=400,temp=85 :: H 1/6 score=21 bad csi=0.86 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi] | PASS
#48021 [pebble+liquid] fc=8,cc=0,ph=7,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-1.42 | A[soon:ph soon:ta soon:ch soon:csi] | PASS
#48056 [pebble+liquid] fc=8,cc=0.6,ph=7,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.71 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#48091 [pebble+liquid] fc=8,cc=0,ph=7,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=42 bad csi=-1.28 | A[soon:cya soon:fc soon:ph soon:ch soon:csi] | PASS
#48126 [pebble+liquid] fc=8,cc=0.6,ph=7,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=58 bad csi=-0.62 | A[now:cc soon:ph soon:csi] | PASS
#48161 [pebble+liquid] fc=8,cc=0,ph=7,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.92 | A[soon:ph soon:ch soon:csi tune:ta] | PASS
#48196 [pebble+liquid] fc=8,cc=0.6,ph=7,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=29 bad csi=-0.56 | A[now:cc soon:cya soon:fc soon:ph tune:ta tune:csi] | PASS
#48231 [pebble+liquid] fc=8,cc=0,ph=7,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.82 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#48266 [pebble+liquid] fc=8,cc=0.6,ph=7.4,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.61 | A[now:cc soon:ta soon:csi tune:ph] | PASS
#48301 [pebble+liquid] fc=8,cc=0,ph=7.4,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.74 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#48336 [pebble+liquid] fc=8,cc=0.6,ph=7.4,ta=60,cya=70,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.47 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#48371 [pebble+liquid] fc=8,cc=0,ph=7.4,ta=80,cya=50,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.66 | A[soon:ch soon:csi tune:ph] | PASS
#48406 [pebble+liquid] fc=8,cc=0.6,ph=7.4,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=54 bad csi=-0.08 | A[now:cc soon:cya tune:ph tune:ta] | PASS
#48441 [pebble+liquid] fc=8,cc=0,ph=7.4,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=46 bad csi=-0.61 | A[soon:cya soon:fc soon:ch soon:csi tune:ph tune:ta] | PASS
#48476 [pebble+liquid] fc=8,cc=0.6,ph=7.4,ta=130,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0 | A[now:cc soon:ta tune:ph] | PASS
#48511 [pebble+liquid] fc=8,cc=0,ph=7.6,ta=40,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.84 | A[soon:ta soon:ch soon:csi] | PASS
#48546 [pebble+liquid] fc=8,cc=0.6,ph=7.6,ta=40,cya=90,ch=400,temp=85 :: H 2/6 score=38 bad csi=-0.84 | A[now:cc soon:cya soon:fc soon:ta soon:csi] | PASS
#48581 [pebble+liquid] fc=8,cc=0,ph=7.6,ta=60,cya=70,ch=150,temp=85 :: H 4/6 score=71 bad csi=-0.71 | A[soon:cya soon:ch soon:csi] | PASS
#48616 [pebble+liquid] fc=8,cc=0.6,ph=7.6,ta=80,cya=40,ch=400,temp=85 :: H 5/6 score=83 bad csi=-0.03 | A[now:cc] | PASS
#48651 [pebble+liquid] fc=8,cc=0,ph=7.6,ta=100,cya=20,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.3 | A[soon:cya soon:ch tune:ta] | PASS
#48686 [pebble+liquid] fc=8,cc=0.6,ph=7.6,ta=100,cya=70,ch=400,temp=85 :: H 3/6 score=63 bad csi=0.03 | A[now:cc soon:cya tune:ta] | PASS
#48721 [pebble+liquid] fc=8,cc=0,ph=7.6,ta=130,cya=50,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.22 | A[soon:ta soon:ch] | PASS
#48756 [pebble+liquid] fc=8,cc=0.6,ph=7.8,ta=40,cya=20,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.13 | A[now:cc soon:cya soon:ta] | PASS
#48791 [pebble+liquid] fc=8,cc=0,ph=7.8,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=50 bad csi=-1.14 | A[soon:cya soon:fc soon:ta soon:ch soon:csi] | PASS
#48826 [pebble+liquid] fc=8,cc=0.6,ph=7.8,ta=60,cya=50,ch=400,temp=85 :: H 5/6 score=83 bad csi=-0.02 | A[now:cc] | PASS
#48861 [pebble+liquid] fc=8,cc=0,ph=7.8,ta=80,cya=40,ch=150,temp=85 :: H 5/6 score=96 warn csi=-0.25 | A[soon:ch] | PASS
#48896 [pebble+liquid] fc=8,cc=0.6,ph=7.8,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.03 | A[now:cc soon:cya soon:fc] | PASS
#48931 [pebble+liquid] fc=8,cc=0,ph=7.8,ta=100,cya=70,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.2 | A[soon:cya soon:ch tune:ta] | PASS
#48966 [pebble+liquid] fc=8,cc=0.6,ph=7.8,ta=130,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=0.41 | A[now:cc soon:ta tune:csi] | PASS
#49001 [pebble+liquid] fc=8,cc=0,ph=8,ta=40,cya=20,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.35 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#49036 [pebble+liquid] fc=8,cc=0.6,ph=8,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=-0.29 | A[now:cc soon:cya soon:ph soon:ta] | PASS
#49071 [pebble+liquid] fc=8,cc=0,ph=8,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=88 warn csi=-0.25 | A[soon:ph soon:ch] | PASS
#49106 [pebble+liquid] fc=8,cc=0.6,ph=8,ta=80,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.41 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#49141 [pebble+liquid] fc=8,cc=0,ph=8,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.2 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#49176 [pebble+liquid] fc=8,cc=0.6,ph=8,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0.46 | A[now:cc soon:ph tune:ta tune:csi] | PASS
#49211 [pebble+liquid] fc=8,cc=0,ph=8,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=79 bad csi=0.19 | A[soon:ph soon:ta soon:ch] | PASS
#49246 [pebble+liquid] fc=8,cc=0.6,ph=8,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=33 bad csi=0.53 | A[now:cc soon:cya soon:fc soon:ph soon:ta tune:csi] | PASS
#49281 [pebble+liquid] fc=8,cc=0,ph=8.3,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.43 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#49316 [pebble+liquid] fc=8,cc=0.6,ph=8.3,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=63 bad csi=0.5 | A[now:cc soon:ph tune:csi] | PASS
#49351 [pebble+liquid] fc=8,cc=0,ph=8.3,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=0.29 | A[soon:cya soon:ph soon:ch] | PASS
#49386 [pebble+liquid] fc=8,cc=0.6,ph=8.3,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.58 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#49421 [pebble+liquid] fc=8,cc=0,ph=8.3,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=71 bad csi=0.34 | A[soon:ph soon:ch tune:ta tune:csi] | PASS
#49456 [pebble+liquid] fc=8,cc=0.6,ph=8.3,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.93 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#49491 [pebble+liquid] fc=8,cc=0,ph=8.3,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.41 | A[soon:cya soon:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#49526 [pebble+liquid] fc=12,cc=0.6,ph=7,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=-1 | A[now:cc soon:ph soon:ta soon:csi] | PASS
#49561 [pebble+liquid] fc=12,cc=0,ph=7,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=71 bad csi=-1.17 | A[soon:ph soon:ch soon:csi] | PASS
#49596 [pebble+liquid] fc=12,cc=0.6,ph=7,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.86 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#49631 [pebble+liquid] fc=12,cc=0,ph=7,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=54 bad csi=-1.07 | A[soon:cya soon:ph soon:ch soon:csi] | PASS
#49666 [pebble+liquid] fc=12,cc=0.6,ph=7,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.5 | A[now:cc soon:ph tune:ta tune:csi] | PASS
#49701 [pebble+liquid] fc=12,cc=0,ph=7,ta=130,cya=20,ch=150,temp=85 :: H 1/6 score=33 bad csi=-0.78 | A[soon:cya soon:ph soon:ta soon:ch soon:csi tune:fc] | PASS
#49736 [pebble+liquid] fc=12,cc=0.6,ph=7,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=38 bad csi=-0.4 | A[now:cc soon:cya soon:ph soon:ta tune:csi] | PASS
#49771 [pebble+liquid] fc=12,cc=0,ph=7.4,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=71 bad csi=-1.08 | A[soon:ta soon:ch soon:csi tune:ph] | PASS
#49806 [pebble+liquid] fc=12,cc=0.6,ph=7.4,ta=60,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.32 | A[now:cc soon:cya tune:fc tune:ph tune:csi] | PASS
#49841 [pebble+liquid] fc=12,cc=0,ph=7.4,ta=60,cya=90,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.96 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#49876 [pebble+liquid] fc=12,cc=0.6,ph=7.4,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=-0.24 | A[now:cc tune:ph] | PASS
#49911 [pebble+liquid] fc=12,cc=0,ph=7.4,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=79 warn csi=-0.53 | A[soon:ch tune:ph tune:ta tune:csi] | PASS
#49946 [pebble+liquid] fc=12,cc=0.6,ph=7.4,ta=100,cya=90,ch=400,temp=85 :: H 2/6 score=54 bad csi=-0.19 | A[now:cc soon:cya tune:ph tune:ta] | PASS
#49981 [pebble+liquid] fc=12,cc=0,ph=7.4,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.44 | A[soon:cya soon:ta soon:ch tune:ph tune:csi] | PASS
#50016 [pebble+liquid] fc=12,cc=0.6,ph=7.6,ta=40,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.42 | A[now:cc soon:ta tune:csi] | PASS
#50051 [pebble+liquid] fc=12,cc=0,ph=7.6,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.54 | A[soon:cya soon:ch tune:fc tune:csi] | PASS
#50086 [pebble+liquid] fc=12,cc=0.6,ph=7.6,ta=60,cya=70,ch=400,temp=85 :: H 4/6 score=67 bad csi=-0.29 | A[now:cc soon:cya] | PASS
#50121 [pebble+liquid] fc=12,cc=0,ph=7.6,ta=80,cya=50,ch=150,temp=85 :: H 5/6 score=92 warn csi=-0.47 | A[soon:ch tune:csi] | PASS
#50156 [pebble+liquid] fc=12,cc=0.6,ph=7.6,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=50 bad csi=0.12 | A[now:cc soon:cya tune:fc tune:ta] | PASS
#50191 [pebble+liquid] fc=12,cc=0,ph=7.6,ta=100,cya=90,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.43 | A[soon:cya soon:ch tune:ta tune:csi] | PASS
#50226 [pebble+liquid] fc=12,cc=0.6,ph=7.6,ta=130,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.2 | A[now:cc soon:ta] | PASS
#50261 [pebble+liquid] fc=12,cc=0,ph=7.8,ta=40,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.66 | A[soon:ta soon:ch soon:csi] | PASS
#50296 [pebble+liquid] fc=12,cc=0.6,ph=7.8,ta=40,cya=90,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.72 | A[now:cc soon:cya soon:ta soon:csi] | PASS
#50331 [pebble+liquid] fc=12,cc=0,ph=7.8,ta=60,cya=70,ch=150,temp=85 :: H 4/6 score=75 bad csi=-0.52 | A[soon:cya soon:ch tune:csi] | PASS
#50366 [pebble+liquid] fc=12,cc=0.6,ph=7.8,ta=80,cya=40,ch=400,temp=85 :: H 5/6 score=83 bad csi=0.17 | A[now:cc] | PASS
#50401 [pebble+liquid] fc=12,cc=0,ph=7.8,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.1 | A[soon:cya soon:ch tune:fc tune:ta] | PASS
#50436 [pebble+liquid] fc=12,cc=0.6,ph=7.8,ta=100,cya=70,ch=400,temp=85 :: H 3/6 score=63 bad csi=0.22 | A[now:cc soon:cya tune:ta] | PASS
#50471 [pebble+liquid] fc=12,cc=0,ph=7.8,ta=130,cya=50,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.02 | A[soon:ta soon:ch] | PASS
#50506 [pebble+liquid] fc=12,cc=0.6,ph=8,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=38 bad csi=0.06 | A[now:cc soon:cya soon:ta tune:fc tune:ph] | PASS
#50541 [pebble+liquid] fc=12,cc=0,ph=8,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=54 bad csi=-1.01 | A[soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#50576 [pebble+liquid] fc=12,cc=0.6,ph=8,ta=60,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.17 | A[now:cc tune:ph] | PASS
#50611 [pebble+liquid] fc=12,cc=0,ph=8,ta=80,cya=40,ch=150,temp=85 :: H 4/6 score=88 warn csi=-0.06 | A[soon:ch tune:ph] | PASS
#50646 [pebble+liquid] fc=12,cc=0.6,ph=8,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.22 | A[now:cc soon:cya tune:ph] | PASS
#50681 [pebble+liquid] fc=12,cc=0,ph=8,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=67 bad csi=0 | A[soon:cya soon:ch tune:ph tune:ta] | PASS
#50716 [pebble+liquid] fc=12,cc=0.6,ph=8,ta=130,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.61 | A[now:cc soon:ta soon:csi tune:ph] | PASS
#50751 [pebble+liquid] fc=12,cc=0,ph=8.3,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.06 | A[soon:cya soon:ta soon:ch tune:fc tune:ph] | PASS
#50786 [pebble+liquid] fc=12,cc=0.6,ph=8.3,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.01 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#50821 [pebble+liquid] fc=12,cc=0,ph=8.3,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=79 bad csi=0.04 | A[soon:ch tune:ph] | PASS
#50856 [pebble+liquid] fc=12,cc=0.6,ph=8.3,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.71 | A[now:cc soon:cya soon:csi tune:fc tune:ph] | PASS
#50891 [pebble+liquid] fc=12,cc=0,ph=8.3,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=63 bad csi=0.09 | A[soon:cya soon:ch tune:ph] | PASS
#50926 [pebble+liquid] fc=12,cc=0.6,ph=8.3,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.76 | A[now:cc soon:csi tune:ph tune:ta] | PASS
#50961 [pebble+liquid] fc=12,cc=0,ph=8.3,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=0.49 | A[soon:ta soon:ch tune:ph tune:csi] | PASS
#50996 [pebble+liquid] fc=12,cc=0.6,ph=8.3,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.83 | A[now:cc soon:cya soon:ta soon:csi tune:ph] | PASS
#51031 [pebble+liquid] fc=25,cc=0,ph=7,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-1.49 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#51066 [pebble+liquid] fc=25,cc=0.6,ph=7,ta=60,cya=40,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.75 | A[now:cc soon:ph soon:csi tune:fc] | PASS
#51101 [pebble+liquid] fc=25,cc=0,ph=7,ta=80,cya=20,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.99 | A[soon:cya soon:ph soon:ch soon:csi tune:fc] | PASS
#51136 [pebble+liquid] fc=25,cc=0.6,ph=7,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.65 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#51171 [pebble+liquid] fc=25,cc=0,ph=7,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=54 bad csi=-0.93 | A[soon:ph soon:ch soon:csi tune:fc tune:ta] | PASS
#51206 [pebble+liquid] fc=25,cc=0.6,ph=7,ta=130,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=-0.36 | A[now:cc soon:cya soon:ph soon:ta tune:fc tune:csi] | PASS
#51241 [pebble+liquid] fc=25,cc=0,ph=7,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.84 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#51276 [pebble+liquid] fc=25,cc=0.6,ph=7.4,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.66 | A[now:cc soon:ta soon:csi tune:fc tune:ph] | PASS
#51311 [pebble+liquid] fc=25,cc=0,ph=7.4,ta=60,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.79 | A[soon:ch soon:csi tune:fc tune:ph] | PASS
#51346 [pebble+liquid] fc=25,cc=0.6,ph=7.4,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.54 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#51381 [pebble+liquid] fc=25,cc=0,ph=7.4,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.7 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#51416 [pebble+liquid] fc=25,cc=0.6,ph=7.4,ta=100,cya=40,ch=400,temp=85 :: H 2/6 score=58 bad csi=-0.11 | A[now:cc tune:fc tune:ph tune:ta] | PASS
#51451 [pebble+liquid] fc=25,cc=0,ph=7.4,ta=130,cya=20,ch=150,temp=85 :: H 1/6 score=46 bad csi=-0.38 | A[soon:cya soon:ta soon:ch tune:fc tune:ph tune:csi] | PASS
#51486 [pebble+liquid] fc=25,cc=0.6,ph=7.4,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=-0.02 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#51521 [pebble+liquid] fc=25,cc=0,ph=7.6,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.9 | A[soon:ta soon:ch soon:csi tune:fc] | PASS
#51556 [pebble+liquid] fc=25,cc=0.6,ph=7.6,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.12 | A[now:cc soon:cya tune:fc] | PASS
#51591 [pebble+liquid] fc=25,cc=0,ph=7.6,ta=60,cya=90,ch=150,temp=85 :: H 4/6 score=71 bad csi=-0.79 | A[soon:cya soon:ch soon:csi] | PASS
#51626 [pebble+liquid] fc=25,cc=0.6,ph=7.6,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.05 | A[now:cc tune:fc] | PASS
#51661 [pebble+liquid] fc=25,cc=0,ph=7.6,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=75 warn csi=-0.34 | A[soon:ch tune:fc tune:ta tune:csi] | PASS
#51696 [pebble+liquid] fc=25,cc=0.6,ph=7.6,ta=100,cya=90,ch=400,temp=85 :: H 3/6 score=63 bad csi=-0.01 | A[now:cc soon:cya tune:ta] | PASS
#51731 [pebble+liquid] fc=25,cc=0,ph=7.6,ta=130,cya=70,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.25 | A[soon:cya soon:ta soon:ch] | PASS
#51766 [pebble+liquid] fc=25,cc=0.6,ph=7.8,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=63 bad csi=-0.24 | A[now:cc soon:ta tune:fc] | PASS
#51801 [pebble+liquid] fc=25,cc=0,ph=7.8,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.35 | A[soon:cya soon:ch tune:fc tune:csi] | PASS
#51836 [pebble+liquid] fc=25,cc=0.6,ph=7.8,ta=60,cya=70,ch=400,temp=85 :: H 4/6 score=67 bad csi=-0.1 | A[now:cc soon:cya] | PASS
#51871 [pebble+liquid] fc=25,cc=0,ph=7.8,ta=80,cya=50,ch=150,temp=85 :: H 4/6 score=83 warn csi=-0.28 | A[soon:ch tune:fc] | PASS
#51906 [pebble+liquid] fc=25,cc=0.6,ph=7.8,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.31 | A[now:cc soon:cya tune:fc tune:ta tune:csi] | PASS
#51941 [pebble+liquid] fc=25,cc=0,ph=7.8,ta=100,cya=90,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.24 | A[soon:cya soon:ch tune:ta] | PASS
#51976 [pebble+liquid] fc=25,cc=0.6,ph=7.8,ta=130,cya=50,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.4 | A[now:cc soon:ta tune:fc tune:csi] | PASS
#52011 [pebble+liquid] fc=25,cc=0,ph=8,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.46 | A[soon:ta soon:ch tune:fc tune:ph tune:csi] | PASS
#52046 [pebble+liquid] fc=25,cc=0.6,ph=8,ta=40,cya=90,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.59 | A[now:cc soon:cya soon:ta tune:ph tune:csi] | PASS
#52081 [pebble+liquid] fc=25,cc=0,ph=8,ta=60,cya=70,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.33 | A[soon:cya soon:ch tune:ph tune:csi] | PASS
#52116 [pebble+liquid] fc=25,cc=0.6,ph=8,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.36 | A[now:cc tune:fc tune:ph tune:csi] | PASS
#52151 [pebble+liquid] fc=25,cc=0,ph=8,ta=100,cya=20,ch=150,temp=85 :: H 1/6 score=54 bad csi=0.09 | A[soon:cya soon:ch tune:fc tune:ph tune:ta] | PASS
#52186 [pebble+liquid] fc=25,cc=0.6,ph=8,ta=100,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=0.42 | A[now:cc soon:cya tune:ph tune:ta tune:csi] | PASS
#52221 [pebble+liquid] fc=25,cc=0,ph=8,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=67 bad csi=0.17 | A[soon:ta soon:ch tune:fc tune:ph] | PASS
#52256 [pebble+liquid] fc=25,cc=0.6,ph=8.3,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.36 | A[now:cc soon:cya soon:ta tune:fc tune:ph tune:csi] | PASS
#52291 [pebble+liquid] fc=25,cc=0,ph=8.3,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.77 | A[soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#52326 [pebble+liquid] fc=25,cc=0.6,ph=8.3,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=0.46 | A[now:cc tune:fc tune:ph tune:csi] | PASS
#52361 [pebble+liquid] fc=25,cc=0,ph=8.3,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=0.24 | A[soon:ch tune:fc tune:ph] | PASS
#52396 [pebble+liquid] fc=25,cc=0.6,ph=8.3,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.51 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#52431 [pebble+liquid] fc=25,cc=0,ph=8.3,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.29 | A[soon:cya soon:ch tune:ph tune:ta] | PASS
#52466 [pebble+liquid] fc=25,cc=0.6,ph=8.3,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.91 | A[now:cc soon:ta soon:csi tune:fc tune:ph] | PASS
#52501 [tile+liquid] fc=0,cc=0,ph=7,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=21 bad csi=-1.32 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#52536 [tile+liquid] fc=0,cc=0.6,ph=7,ta=40,cya=70,ch=400,temp=85 :: H 1/6 score=8 bad csi=-1.07 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi] | PASS
#52571 [tile+liquid] fc=0,cc=0,ph=7,ta=60,cya=50,ch=150,temp=85 :: H 3/6 score=46 bad csi=-1.19 | A[now:fc soon:ph soon:ch soon:csi] | PASS
#52606 [tile+liquid] fc=0,cc=0.6,ph=7,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=21 bad csi=-0.58 | A[now:cc now:fc soon:cya soon:ph tune:csi] | PASS
#52641 [tile+liquid] fc=0,cc=0,ph=7,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=29 bad csi=-1.1 | A[now:fc soon:cya soon:ph soon:ch soon:csi] | PASS
#52676 [tile+liquid] fc=0,cc=0.6,ph=7,ta=100,cya=50,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.51 | A[now:cc now:fc soon:ph tune:ta tune:csi] | PASS
#52711 [tile+liquid] fc=0,cc=0,ph=7,ta=130,cya=40,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.79 | A[now:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#52746 [tile+liquid] fc=0,cc=0.6,ph=7,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=-0.42 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#52781 [tile+liquid] fc=0,cc=0,ph=7.4,ta=40,cya=70,ch=150,temp=85 :: H 1/6 score=29 bad csi=-1.2 | A[now:fc soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#52816 [tile+liquid] fc=0,cc=0.6,ph=7.4,ta=60,cya=40,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.37 | A[now:cc now:fc tune:ph tune:csi] | PASS
#52851 [tile+liquid] fc=0,cc=0,ph=7.4,ta=80,cya=20,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.6 | A[now:fc soon:cya soon:ch tune:ph tune:csi] | PASS
#52886 [tile+liquid] fc=0,cc=0.6,ph=7.4,ta=80,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.28 | A[now:cc now:fc soon:cya tune:ph] | PASS
#52921 [tile+liquid] fc=0,cc=0,ph=7.4,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=54 bad csi=-0.55 | A[now:fc soon:ch tune:ph tune:ta tune:csi] | PASS
#52956 [tile+liquid] fc=0,cc=0.6,ph=7.4,ta=130,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.04 | A[now:cc now:fc soon:cya soon:ta tune:ph] | PASS
#52991 [tile+liquid] fc=0,cc=0,ph=7.4,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=33 bad csi=-0.46 | A[now:fc soon:cya soon:ta soon:ch tune:ph tune:csi] | PASS
#53026 [tile+liquid] fc=0,cc=0.6,ph=7.6,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.48 | A[now:cc now:fc soon:ta tune:csi] | PASS
#53061 [tile+liquid] fc=0,cc=0,ph=7.6,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=67 bad csi=-0.6 | A[now:fc soon:ch tune:csi] | PASS
#53096 [tile+liquid] fc=0,cc=0.6,ph=7.6,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=38 bad csi=-0.37 | A[now:cc now:fc soon:cya tune:csi] | PASS
#53131 [tile+liquid] fc=0,cc=0,ph=7.6,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.52 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#53166 [tile+liquid] fc=0,cc=0.6,ph=7.6,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.08 | A[now:cc now:fc tune:ta] | PASS
#53201 [tile+liquid] fc=0,cc=0,ph=7.6,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.18 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#53236 [tile+liquid] fc=0,cc=0.6,ph=7.6,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.17 | A[now:cc now:fc soon:cya soon:ta] | PASS
#53271 [tile+liquid] fc=0,cc=0,ph=7.8,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=-0.72 | A[now:fc soon:ta soon:ch soon:csi] | PASS
#53306 [tile+liquid] fc=0,cc=0.6,ph=7.8,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=42 bad csi=0.07 | A[now:cc now:fc soon:cya] | PASS
#53341 [tile+liquid] fc=0,cc=0,ph=7.8,ta=60,cya=90,ch=150,temp=85 :: H 3/6 score=46 bad csi=-0.62 | A[now:fc soon:cya soon:ch soon:csi] | PASS
#53376 [tile+liquid] fc=0,cc=0.6,ph=7.8,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=58 bad csi=0.14 | A[now:cc now:fc] | PASS
#53411 [tile+liquid] fc=0,cc=0,ph=7.8,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.14 | A[now:fc soon:ch tune:ta] | PASS
#53446 [tile+liquid] fc=0,cc=0.6,ph=7.8,ta=100,cya=90,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.18 | A[now:cc now:fc soon:cya tune:ta] | PASS
#53481 [tile+liquid] fc=0,cc=0,ph=7.8,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.05 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#53516 [tile+liquid] fc=0,cc=0.6,ph=8,ta=40,cya=40,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.04 | A[now:cc now:fc soon:ph soon:ta] | PASS
#53551 [tile+liquid] fc=0,cc=0,ph=8,ta=60,cya=20,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.15 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#53586 [tile+liquid] fc=0,cc=0.6,ph=8,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.09 | A[now:cc now:fc soon:cya soon:ph] | PASS
#53621 [tile+liquid] fc=0,cc=0,ph=8,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.08 | A[now:fc soon:ph soon:ch] | PASS
#53656 [tile+liquid] fc=0,cc=0.6,ph=8,ta=100,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.51 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#53691 [tile+liquid] fc=0,cc=0,ph=8,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.05 | A[now:fc soon:cya soon:ph soon:ch tune:ta] | PASS
#53726 [tile+liquid] fc=0,cc=0.6,ph=8,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.59 | A[now:cc now:fc soon:ph soon:ta tune:csi] | PASS
#53761 [tile+liquid] fc=0,cc=0,ph=8.3,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.17 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#53796 [tile+liquid] fc=0,cc=0.6,ph=8.3,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=-0.35 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#53831 [tile+liquid] fc=0,cc=0,ph=8.3,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.04 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#53866 [tile+liquid] fc=0,cc=0.6,ph=8.3,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=33 bad csi=0.66 | A[now:cc now:fc soon:ph soon:csi] | PASS
#53901 [tile+liquid] fc=0,cc=0,ph=8.3,ta=100,cya=20,ch=150,temp=85 :: H 1/6 score=29 bad csi=0.39 | A[now:fc soon:cya soon:ph soon:ch tune:ta tune:csi] | PASS
#53936 [tile+liquid] fc=0,cc=0.6,ph=8.3,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=13 bad csi=0.71 | A[now:cc now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#53971 [tile+liquid] fc=0,cc=0,ph=8.3,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=42 bad csi=0.47 | A[now:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#54006 [tile+liquid] fc=2,cc=0.6,ph=7,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=21 bad csi=-0.9 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi] | PASS
#54041 [tile+liquid] fc=2,cc=0,ph=7,ta=40,cya=90,ch=150,temp=85 :: H 1/6 score=21 bad csi=-1.59 | A[now:fc soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#54076 [tile+liquid] fc=2,cc=0.6,ph=7,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=33 bad csi=-0.77 | A[now:cc now:fc soon:ph soon:csi] | PASS
#54111 [tile+liquid] fc=2,cc=0,ph=7,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=46 bad csi=-1.02 | A[now:fc soon:ph soon:ch soon:csi] | PASS
#54146 [tile+liquid] fc=2,cc=0.6,ph=7,ta=80,cya=90,ch=400,temp=85 :: H 2/6 score=17 bad csi=-0.68 | A[now:cc now:fc soon:cya soon:ph soon:csi] | PASS
#54181 [tile+liquid] fc=2,cc=0,ph=7,ta=100,cya=70,ch=150,temp=85 :: H 1/6 score=25 bad csi=-0.95 | A[now:fc soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#54216 [tile+liquid] fc=2,cc=0.6,ph=7,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.37 | A[now:cc now:fc soon:ph soon:ta tune:csi] | PASS
#54251 [tile+liquid] fc=2,cc=0,ph=7.4,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.94 | A[soon:cya soon:fc soon:ta soon:ch soon:csi tune:ph] | PASS
#54286 [tile+liquid] fc=2,cc=0.6,ph=7.4,ta=40,cya=70,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.78 | A[now:cc now:fc soon:cya soon:ta soon:csi tune:ph] | PASS
#54321 [tile+liquid] fc=2,cc=0,ph=7.4,ta=60,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=-0.82 | A[now:fc soon:ch soon:csi tune:ph] | PASS
#54356 [tile+liquid] fc=2,cc=0.6,ph=7.4,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.18 | A[now:cc soon:cya soon:fc tune:ph] | PASS
#54391 [tile+liquid] fc=2,cc=0,ph=7.4,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.75 | A[now:fc soon:cya soon:ch soon:csi tune:ph] | PASS
#54426 [tile+liquid] fc=2,cc=0.6,ph=7.4,ta=100,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.13 | A[now:cc now:fc tune:ph tune:ta] | PASS
#54461 [tile+liquid] fc=2,cc=0,ph=7.4,ta=130,cya=40,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.4 | A[now:fc soon:ta soon:ch tune:ph tune:csi] | PASS
#54496 [tile+liquid] fc=2,cc=0.6,ph=7.4,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=25 bad csi=-0.04 | A[now:cc now:fc soon:cya soon:ta tune:ph] | PASS
#54531 [tile+liquid] fc=2,cc=0,ph=7.6,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-1.04 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#54566 [tile+liquid] fc=2,cc=0.6,ph=7.6,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=58 bad csi=-0.18 | A[now:cc now:fc] | PASS
#54601 [tile+liquid] fc=2,cc=0,ph=7.6,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.41 | A[soon:cya soon:fc soon:ch tune:csi] | PASS
#54636 [tile+liquid] fc=2,cc=0.6,ph=7.6,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.1 | A[now:cc now:fc soon:cya] | PASS
#54671 [tile+liquid] fc=2,cc=0,ph=7.6,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.35 | A[now:fc soon:ch tune:ta tune:csi] | PASS
#54706 [tile+liquid] fc=2,cc=0.6,ph=7.6,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.24 | A[now:cc soon:cya soon:fc soon:ta] | PASS
#54741 [tile+liquid] fc=2,cc=0,ph=7.6,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.27 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#54776 [tile+liquid] fc=2,cc=0.6,ph=7.8,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.3 | A[now:cc now:fc soon:ta] | PASS
#54811 [tile+liquid] fc=2,cc=0,ph=7.8,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=67 bad csi=-0.41 | A[now:fc soon:ch tune:csi] | PASS
#54846 [tile+liquid] fc=2,cc=0.6,ph=7.8,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.2 | A[now:cc now:fc soon:cya] | PASS
#54881 [tile+liquid] fc=2,cc=0,ph=7.8,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.33 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#54916 [tile+liquid] fc=2,cc=0.6,ph=7.8,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.28 | A[now:cc now:fc tune:ta] | PASS
#54951 [tile+liquid] fc=2,cc=0,ph=7.8,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.02 | A[soon:cya soon:fc soon:ta soon:ch] | PASS
#54986 [tile+liquid] fc=2,cc=0.6,ph=7.8,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.37 | A[now:cc now:fc soon:cya soon:ta tune:csi] | PASS
#55021 [tile+liquid] fc=2,cc=0,ph=8,ta=40,cya=50,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.53 | A[now:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#55056 [tile+liquid] fc=2,cc=0.6,ph=8,ta=60,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.27 | A[now:cc soon:cya soon:fc soon:ph] | PASS
#55091 [tile+liquid] fc=2,cc=0,ph=8,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.43 | A[now:fc soon:cya soon:ph soon:ch tune:csi] | PASS
#55126 [tile+liquid] fc=2,cc=0.6,ph=8,ta=80,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.34 | A[now:cc now:fc soon:ph tune:csi] | PASS
#55161 [tile+liquid] fc=2,cc=0,ph=8,ta=100,cya=40,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.06 | A[now:fc soon:ph soon:ch tune:ta] | PASS
#55196 [tile+liquid] fc=2,cc=0.6,ph=8,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.37 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#55231 [tile+liquid] fc=2,cc=0,ph=8,ta=130,cya=70,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.14 | A[now:fc soon:cya soon:ph soon:ta soon:ch] | PASS
#55266 [tile+liquid] fc=2,cc=0.6,ph=8.3,ta=40,cya=40,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.25 | A[now:cc now:fc soon:ph soon:ta] | PASS
#55301 [tile+liquid] fc=2,cc=0,ph=8.3,ta=60,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.15 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#55336 [tile+liquid] fc=2,cc=0.6,ph=8.3,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=21 bad csi=0.38 | A[now:cc now:fc soon:cya soon:ph tune:csi] | PASS
#55371 [tile+liquid] fc=2,cc=0,ph=8.3,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=54 bad csi=0.21 | A[now:fc soon:ph soon:ch] | PASS
#55406 [tile+liquid] fc=2,cc=0.6,ph=8.3,ta=100,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.81 | A[now:cc soon:cya soon:fc soon:ph soon:csi tune:ta] | PASS
#55441 [tile+liquid] fc=2,cc=0,ph=8.3,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=33 bad csi=0.25 | A[now:fc soon:cya soon:ph soon:ch tune:ta] | PASS
#55476 [tile+liquid] fc=2,cc=0.6,ph=8.3,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=25 bad csi=0.89 | A[now:cc now:fc soon:ph soon:ta soon:csi] | PASS
#55511 [tile+liquid] fc=3,cc=0,ph=7,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=50 bad csi=-1.38 | A[soon:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#55546 [tile+liquid] fc=3,cc=0.6,ph=7,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=8 bad csi=-1.17 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi] | PASS
#55581 [tile+liquid] fc=3,cc=0,ph=7,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=29 bad csi=-1.23 | A[now:fc soon:cya soon:ph soon:ch soon:csi] | PASS
#55616 [tile+liquid] fc=3,cc=0.6,ph=7,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.6 | A[now:cc soon:fc soon:ph tune:csi] | PASS
#55651 [tile+liquid] fc=3,cc=0,ph=7,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.89 | A[soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#55686 [tile+liquid] fc=3,cc=0.6,ph=7,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.53 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#55721 [tile+liquid] fc=3,cc=0,ph=7,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.8 | A[now:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#55756 [tile+liquid] fc=3,cc=0.6,ph=7.4,ta=40,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.52 | A[now:cc soon:cya soon:ta tune:ph tune:csi] | PASS
#55791 [tile+liquid] fc=3,cc=0,ph=7.4,ta=40,cya=90,ch=150,temp=85 :: H 1/6 score=29 bad csi=-1.37 | A[now:fc soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#55826 [tile+liquid] fc=3,cc=0.6,ph=7.4,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.4 | A[now:cc now:fc tune:ph tune:csi] | PASS
#55861 [tile+liquid] fc=3,cc=0,ph=7.4,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.64 | A[soon:fc soon:ch soon:csi tune:ph] | PASS
#55896 [tile+liquid] fc=3,cc=0.6,ph=7.4,ta=80,cya=90,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.33 | A[now:cc now:fc soon:cya tune:ph tune:csi] | PASS
#55931 [tile+liquid] fc=3,cc=0,ph=7.4,ta=100,cya=70,ch=150,temp=85 :: H 1/6 score=38 bad csi=-0.58 | A[now:fc soon:cya soon:ch tune:ph tune:ta tune:csi] | PASS
#55966 [tile+liquid] fc=3,cc=0.6,ph=7.4,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=54 bad csi=0.02 | A[now:cc soon:fc soon:ta tune:ph] | PASS
#56001 [tile+liquid] fc=3,cc=0,ph=7.6,ta=40,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.75 | A[soon:cya soon:ta soon:ch soon:csi] | PASS
#56036 [tile+liquid] fc=3,cc=0.6,ph=7.6,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=25 bad csi=-0.63 | A[now:cc now:fc soon:cya soon:ta soon:csi] | PASS
#56071 [tile+liquid] fc=3,cc=0,ph=7.6,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=63 bad csi=-0.63 | A[now:fc soon:ch soon:csi] | PASS
#56106 [tile+liquid] fc=3,cc=0.6,ph=7.6,ta=80,cya=20,ch=400,temp=85 :: H 4/6 score=67 bad csi=0.01 | A[now:cc soon:cya] | PASS
#56141 [tile+liquid] fc=3,cc=0,ph=7.6,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.57 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#56176 [tile+liquid] fc=3,cc=0.6,ph=7.6,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.07 | A[now:cc now:fc tune:ta] | PASS
#56211 [tile+liquid] fc=3,cc=0,ph=7.6,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.21 | A[soon:fc soon:ta soon:ch] | PASS
#56246 [tile+liquid] fc=3,cc=0.6,ph=7.6,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.15 | A[now:cc now:fc soon:cya soon:ta] | PASS
#56281 [tile+liquid] fc=3,cc=0,ph=7.8,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.88 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#56316 [tile+liquid] fc=3,cc=0.6,ph=7.8,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=0.01 | A[now:cc soon:fc] | PASS
#56351 [tile+liquid] fc=3,cc=0,ph=7.8,ta=80,cya=20,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.21 | A[soon:cya soon:ch] | PASS
#56386 [tile+liquid] fc=3,cc=0.6,ph=7.8,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=0.09 | A[now:cc now:fc soon:cya] | PASS
#56421 [tile+liquid] fc=3,cc=0,ph=7.8,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.16 | A[now:fc soon:ch tune:ta] | PASS
#56456 [tile+liquid] fc=3,cc=0.6,ph=7.8,ta=130,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.43 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#56491 [tile+liquid] fc=3,cc=0,ph=7.8,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.08 | A[now:fc soon:cya soon:ta soon:ch] | PASS
#56526 [tile+liquid] fc=3,cc=0.6,ph=8,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.11 | A[now:cc now:fc soon:ph soon:ta] | PASS
#56561 [tile+liquid] fc=3,cc=0,ph=8,ta=60,cya=40,ch=150,temp=85 :: H 3/6 score=75 warn csi=-0.21 | A[soon:fc soon:ph soon:ch] | PASS
#56596 [tile+liquid] fc=3,cc=0.6,ph=8,ta=60,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=-0.02 | A[now:cc now:fc soon:cya soon:ph] | PASS
#56631 [tile+liquid] fc=3,cc=0,ph=8,ta=80,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.14 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#56666 [tile+liquid] fc=3,cc=0.6,ph=8,ta=100,cya=40,ch=400,temp=85 :: H 2/6 score=54 bad csi=0.48 | A[now:cc soon:fc soon:ph tune:ta tune:csi] | PASS
#56701 [tile+liquid] fc=3,cc=0,ph=8,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=0.21 | A[soon:cya soon:ph soon:ta soon:ch] | PASS
#56736 [tile+liquid] fc=3,cc=0.6,ph=8,ta=130,cya=70,ch=400,temp=85 :: H 1/6 score=21 bad csi=0.56 | A[now:cc now:fc soon:cya soon:ph soon:ta tune:csi] | PASS
#56771 [tile+liquid] fc=3,cc=0,ph=8.3,ta=40,cya=50,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.24 | A[now:fc soon:ph soon:ta soon:ch] | PASS
#56806 [tile+liquid] fc=3,cc=0.6,ph=8.3,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.57 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#56841 [tile+liquid] fc=3,cc=0,ph=8.3,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-0.15 | A[now:fc soon:cya soon:ph soon:ch] | PASS
#56876 [tile+liquid] fc=3,cc=0.6,ph=8.3,ta=80,cya=50,ch=400,temp=85 :: H 3/6 score=33 bad csi=0.63 | A[now:cc now:fc soon:ph soon:csi] | PASS
#56911 [tile+liquid] fc=3,cc=0,ph=8.3,ta=100,cya=40,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.36 | A[soon:fc soon:ph soon:ch tune:ta tune:csi] | PASS
#56946 [tile+liquid] fc=3,cc=0.6,ph=8.3,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=13 bad csi=0.67 | A[now:cc now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#56981 [tile+liquid] fc=3,cc=0,ph=8.3,ta=130,cya=70,ch=150,temp=85 :: H 1/6 score=25 bad csi=0.44 | A[now:fc soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#57016 [tile+liquid] fc=5,cc=0.6,ph=7,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.96 | A[now:cc soon:ph soon:ta soon:csi] | PASS
#57051 [tile+liquid] fc=5,cc=0,ph=7,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=54 bad csi=-1.13 | A[soon:cya soon:ph soon:ch soon:csi] | PASS
#57086 [tile+liquid] fc=5,cc=0.6,ph=7,ta=60,cya=70,ch=400,temp=85 :: H 2/6 score=29 bad csi=-0.81 | A[now:cc soon:cya soon:fc soon:ph soon:csi] | PASS
#57121 [tile+liquid] fc=5,cc=0,ph=7,ta=80,cya=50,ch=150,temp=85 :: H 3/6 score=58 bad csi=-1.04 | A[soon:fc soon:ph soon:ch soon:csi] | PASS
#57156 [tile+liquid] fc=5,cc=0.6,ph=7,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.47 | A[now:cc soon:cya soon:ph tune:ta tune:csi] | PASS
#57191 [tile+liquid] fc=5,cc=0,ph=7,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=25 bad csi=-0.97 | A[now:fc soon:cya soon:ph soon:ch soon:csi tune:ta] | PASS
#57226 [tile+liquid] fc=5,cc=0.6,ph=7,ta=130,cya=50,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.38 | A[now:cc soon:fc soon:ph soon:ta tune:csi] | PASS
#57261 [tile+liquid] fc=5,cc=0,ph=7.4,ta=40,cya=40,ch=150,temp=85 :: H 3/6 score=71 bad csi=-1.03 | A[soon:ta soon:ch soon:csi tune:ph] | PASS
#57296 [tile+liquid] fc=5,cc=0.6,ph=7.4,ta=40,cya=90,ch=400,temp=85 :: H 1/6 score=17 bad csi=-0.95 | A[now:cc now:fc soon:cya soon:ta soon:csi tune:ph] | PASS
#57331 [tile+liquid] fc=5,cc=0,ph=7.4,ta=60,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.88 | A[soon:cya soon:fc soon:ch soon:csi tune:ph] | PASS
#57366 [tile+liquid] fc=5,cc=0.6,ph=7.4,ta=80,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=-0.22 | A[now:cc tune:ph] | PASS
#57401 [tile+liquid] fc=5,cc=0,ph=7.4,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.5 | A[soon:cya soon:ch tune:ph tune:ta tune:csi] | PASS
#57436 [tile+liquid] fc=5,cc=0.6,ph=7.4,ta=100,cya=70,ch=400,temp=85 :: H 1/6 score=42 bad csi=-0.16 | A[now:cc soon:cya soon:fc tune:ph tune:ta] | PASS
#57471 [tile+liquid] fc=5,cc=0,ph=7.4,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.42 | A[soon:fc soon:ta soon:ch tune:ph tune:csi] | PASS
#57506 [tile+liquid] fc=5,cc=0.6,ph=7.6,ta=40,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.33 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#57541 [tile+liquid] fc=5,cc=0,ph=7.6,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=38 bad csi=-1.26 | A[now:fc soon:cya soon:ta soon:ch soon:csi] | PASS
#57576 [tile+liquid] fc=5,cc=0.6,ph=7.6,ta=60,cya=50,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.21 | A[now:cc soon:fc] | PASS
#57611 [tile+liquid] fc=5,cc=0,ph=7.6,ta=80,cya=40,ch=150,temp=85 :: H 5/6 score=92 warn csi=-0.45 | A[soon:ch tune:csi] | PASS
#57646 [tile+liquid] fc=5,cc=0.6,ph=7.6,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.15 | A[now:cc now:fc soon:cya] | PASS
#57681 [tile+liquid] fc=5,cc=0,ph=7.6,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.39 | A[soon:cya soon:fc soon:ch tune:ta tune:csi] | PASS
#57716 [tile+liquid] fc=5,cc=0.6,ph=7.6,ta=130,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.21 | A[now:cc soon:ta] | PASS
#57751 [tile+liquid] fc=5,cc=0,ph=7.8,ta=40,cya=20,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.55 | A[soon:cya soon:ta soon:ch tune:csi] | PASS
#57786 [tile+liquid] fc=5,cc=0.6,ph=7.8,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.46 | A[now:cc soon:cya soon:fc soon:ta tune:csi] | PASS
#57821 [tile+liquid] fc=5,cc=0,ph=7.8,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=79 warn csi=-0.44 | A[soon:fc soon:ch tune:csi] | PASS
#57856 [tile+liquid] fc=5,cc=0.6,ph=7.8,ta=80,cya=20,ch=400,temp=85 :: H 4/6 score=67 bad csi=0.21 | A[now:cc soon:cya] | PASS
#57891 [tile+liquid] fc=5,cc=0,ph=7.8,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=50 bad csi=-0.39 | A[now:fc soon:cya soon:ch tune:csi] | PASS
#57926 [tile+liquid] fc=5,cc=0.6,ph=7.8,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0.26 | A[now:cc soon:fc tune:ta] | PASS
#57961 [tile+liquid] fc=5,cc=0,ph=7.8,ta=130,cya=40,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.01 | A[soon:ta soon:ch] | PASS
#57996 [tile+liquid] fc=5,cc=0.6,ph=7.8,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.34 | A[now:cc now:fc soon:cya soon:ta tune:csi] | PASS
#58031 [tile+liquid] fc=5,cc=0,ph=8,ta=40,cya=70,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.71 | A[soon:cya soon:fc soon:ph soon:ta soon:ch soon:csi] | PASS
#58066 [tile+liquid] fc=5,cc=0.6,ph=8,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.21 | A[now:cc soon:ph] | PASS
#58101 [tile+liquid] fc=5,cc=0,ph=8,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.01 | A[soon:cya soon:ph soon:ch] | PASS
#58136 [tile+liquid] fc=5,cc=0.6,ph=8,ta=80,cya=70,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.28 | A[now:cc soon:cya soon:fc soon:ph] | PASS
#58171 [tile+liquid] fc=5,cc=0,ph=8,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=71 warn csi=0.04 | A[soon:fc soon:ph soon:ch tune:ta] | PASS
#58206 [tile+liquid] fc=5,cc=0.6,ph=8,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=0.63 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#58241 [tile+liquid] fc=5,cc=0,ph=8,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.11 | A[now:fc soon:cya soon:ph soon:ta soon:ch] | PASS
#58276 [tile+liquid] fc=5,cc=0.6,ph=8.3,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.18 | A[now:cc soon:fc soon:ph soon:ta] | PASS
#58311 [tile+liquid] fc=5,cc=0,ph=8.3,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=0.08 | A[soon:ph soon:ch] | PASS
#58346 [tile+liquid] fc=5,cc=0.6,ph=8.3,ta=60,cya=90,ch=400,temp=85 :: H 2/6 score=25 bad csi=0.27 | A[now:cc now:fc soon:cya soon:ph] | PASS
#58381 [tile+liquid] fc=5,cc=0,ph=8.3,ta=80,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.16 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#58416 [tile+liquid] fc=5,cc=0.6,ph=8.3,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.78 | A[now:cc soon:ph soon:csi tune:ta] | PASS
#58451 [tile+liquid] fc=5,cc=0,ph=8.3,ta=130,cya=20,ch=150,temp=85 :: H 2/6 score=50 bad csi=0.51 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#58486 [tile+liquid] fc=5,cc=0.6,ph=8.3,ta=130,cya=70,ch=400,temp=85 :: H 1/6 score=21 bad csi=0.86 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi] | PASS
#58521 [tile+liquid] fc=8,cc=0,ph=7,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=63 bad csi=-1.42 | A[soon:ph soon:ta soon:ch soon:csi] | PASS
#58556 [tile+liquid] fc=8,cc=0.6,ph=7,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.71 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#58591 [tile+liquid] fc=8,cc=0,ph=7,ta=60,cya=90,ch=150,temp=85 :: H 2/6 score=42 bad csi=-1.28 | A[soon:cya soon:fc soon:ph soon:ch soon:csi] | PASS
#58626 [tile+liquid] fc=8,cc=0.6,ph=7,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=58 bad csi=-0.62 | A[now:cc soon:ph soon:csi] | PASS
#58661 [tile+liquid] fc=8,cc=0,ph=7,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.92 | A[soon:ph soon:ch soon:csi tune:ta] | PASS
#58696 [tile+liquid] fc=8,cc=0.6,ph=7,ta=100,cya=90,ch=400,temp=85 :: H 1/6 score=29 bad csi=-0.56 | A[now:cc soon:cya soon:fc soon:ph tune:ta tune:csi] | PASS
#58731 [tile+liquid] fc=8,cc=0,ph=7,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.82 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#58766 [tile+liquid] fc=8,cc=0.6,ph=7.4,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.61 | A[now:cc soon:ta soon:csi tune:ph] | PASS
#58801 [tile+liquid] fc=8,cc=0,ph=7.4,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.74 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#58836 [tile+liquid] fc=8,cc=0.6,ph=7.4,ta=60,cya=70,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.47 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#58871 [tile+liquid] fc=8,cc=0,ph=7.4,ta=80,cya=50,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.66 | A[soon:ch soon:csi tune:ph] | PASS
#58906 [tile+liquid] fc=8,cc=0.6,ph=7.4,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=54 bad csi=-0.08 | A[now:cc soon:cya tune:ph tune:ta] | PASS
#58941 [tile+liquid] fc=8,cc=0,ph=7.4,ta=100,cya=90,ch=150,temp=85 :: H 1/6 score=46 bad csi=-0.61 | A[soon:cya soon:fc soon:ch soon:csi tune:ph tune:ta] | PASS
#58976 [tile+liquid] fc=8,cc=0.6,ph=7.4,ta=130,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0 | A[now:cc soon:ta tune:ph] | PASS
#59011 [tile+liquid] fc=8,cc=0,ph=7.6,ta=40,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.84 | A[soon:ta soon:ch soon:csi] | PASS
#59046 [tile+liquid] fc=8,cc=0.6,ph=7.6,ta=40,cya=90,ch=400,temp=85 :: H 2/6 score=38 bad csi=-0.84 | A[now:cc soon:cya soon:fc soon:ta soon:csi] | PASS
#59081 [tile+liquid] fc=8,cc=0,ph=7.6,ta=60,cya=70,ch=150,temp=85 :: H 4/6 score=71 bad csi=-0.71 | A[soon:cya soon:ch soon:csi] | PASS
#59116 [tile+liquid] fc=8,cc=0.6,ph=7.6,ta=80,cya=40,ch=400,temp=85 :: H 5/6 score=83 bad csi=-0.03 | A[now:cc] | PASS
#59151 [tile+liquid] fc=8,cc=0,ph=7.6,ta=100,cya=20,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.3 | A[soon:cya soon:ch tune:ta] | PASS
#59186 [tile+liquid] fc=8,cc=0.6,ph=7.6,ta=100,cya=70,ch=400,temp=85 :: H 3/6 score=63 bad csi=0.03 | A[now:cc soon:cya tune:ta] | PASS
#59221 [tile+liquid] fc=8,cc=0,ph=7.6,ta=130,cya=50,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.22 | A[soon:ta soon:ch] | PASS
#59256 [tile+liquid] fc=8,cc=0.6,ph=7.8,ta=40,cya=20,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.13 | A[now:cc soon:cya soon:ta] | PASS
#59291 [tile+liquid] fc=8,cc=0,ph=7.8,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=50 bad csi=-1.14 | A[soon:cya soon:fc soon:ta soon:ch soon:csi] | PASS
#59326 [tile+liquid] fc=8,cc=0.6,ph=7.8,ta=60,cya=50,ch=400,temp=85 :: H 5/6 score=83 bad csi=-0.02 | A[now:cc] | PASS
#59361 [tile+liquid] fc=8,cc=0,ph=7.8,ta=80,cya=40,ch=150,temp=85 :: H 5/6 score=96 warn csi=-0.25 | A[soon:ch] | PASS
#59396 [tile+liquid] fc=8,cc=0.6,ph=7.8,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.03 | A[now:cc soon:cya soon:fc] | PASS
#59431 [tile+liquid] fc=8,cc=0,ph=7.8,ta=100,cya=70,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.2 | A[soon:cya soon:ch tune:ta] | PASS
#59466 [tile+liquid] fc=8,cc=0.6,ph=7.8,ta=130,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=0.41 | A[now:cc soon:ta tune:csi] | PASS
#59501 [tile+liquid] fc=8,cc=0,ph=8,ta=40,cya=20,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.35 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#59536 [tile+liquid] fc=8,cc=0.6,ph=8,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=-0.29 | A[now:cc soon:cya soon:ph soon:ta] | PASS
#59571 [tile+liquid] fc=8,cc=0,ph=8,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=88 warn csi=-0.25 | A[soon:ph soon:ch] | PASS
#59606 [tile+liquid] fc=8,cc=0.6,ph=8,ta=80,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.41 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#59641 [tile+liquid] fc=8,cc=0,ph=8,ta=80,cya=90,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.2 | A[soon:cya soon:fc soon:ph soon:ch] | PASS
#59676 [tile+liquid] fc=8,cc=0.6,ph=8,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=67 bad csi=0.46 | A[now:cc soon:ph tune:ta tune:csi] | PASS
#59711 [tile+liquid] fc=8,cc=0,ph=8,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=79 bad csi=0.19 | A[soon:ph soon:ta soon:ch] | PASS
#59746 [tile+liquid] fc=8,cc=0.6,ph=8,ta=130,cya=90,ch=400,temp=85 :: H 1/6 score=33 bad csi=0.53 | A[now:cc soon:cya soon:fc soon:ph soon:ta tune:csi] | PASS
#59781 [tile+liquid] fc=8,cc=0,ph=8.3,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=50 bad csi=-0.43 | A[soon:cya soon:ph soon:ta soon:ch tune:csi] | PASS
#59816 [tile+liquid] fc=8,cc=0.6,ph=8.3,ta=60,cya=40,ch=400,temp=85 :: H 4/6 score=63 bad csi=0.5 | A[now:cc soon:ph tune:csi] | PASS
#59851 [tile+liquid] fc=8,cc=0,ph=8.3,ta=80,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=0.29 | A[soon:cya soon:ph soon:ch] | PASS
#59886 [tile+liquid] fc=8,cc=0.6,ph=8.3,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.58 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#59921 [tile+liquid] fc=8,cc=0,ph=8.3,ta=100,cya=50,ch=150,temp=85 :: H 3/6 score=71 bad csi=0.34 | A[soon:ph soon:ch tune:ta tune:csi] | PASS
#59956 [tile+liquid] fc=8,cc=0.6,ph=8.3,ta=130,cya=20,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.93 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#59991 [tile+liquid] fc=8,cc=0,ph=8.3,ta=130,cya=90,ch=150,temp=85 :: H 1/6 score=38 bad csi=0.41 | A[soon:cya soon:fc soon:ph soon:ta soon:ch tune:csi] | PASS
#60026 [tile+liquid] fc=12,cc=0.6,ph=7,ta=40,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=-1 | A[now:cc soon:ph soon:ta soon:csi] | PASS
#60061 [tile+liquid] fc=12,cc=0,ph=7,ta=60,cya=40,ch=150,temp=85 :: H 4/6 score=71 bad csi=-1.17 | A[soon:ph soon:ch soon:csi] | PASS
#60096 [tile+liquid] fc=12,cc=0.6,ph=7,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.86 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#60131 [tile+liquid] fc=12,cc=0,ph=7,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=54 bad csi=-1.07 | A[soon:cya soon:ph soon:ch soon:csi] | PASS
#60166 [tile+liquid] fc=12,cc=0.6,ph=7,ta=100,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=-0.5 | A[now:cc soon:ph tune:ta tune:csi] | PASS
#60201 [tile+liquid] fc=12,cc=0,ph=7,ta=130,cya=20,ch=150,temp=85 :: H 1/6 score=33 bad csi=-0.78 | A[soon:cya soon:ph soon:ta soon:ch soon:csi tune:fc] | PASS
#60236 [tile+liquid] fc=12,cc=0.6,ph=7,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=38 bad csi=-0.4 | A[now:cc soon:cya soon:ph soon:ta tune:csi] | PASS
#60271 [tile+liquid] fc=12,cc=0,ph=7.4,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=71 bad csi=-1.08 | A[soon:ta soon:ch soon:csi tune:ph] | PASS
#60306 [tile+liquid] fc=12,cc=0.6,ph=7.4,ta=60,cya=20,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.32 | A[now:cc soon:cya tune:fc tune:ph tune:csi] | PASS
#60341 [tile+liquid] fc=12,cc=0,ph=7.4,ta=60,cya=90,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.96 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#60376 [tile+liquid] fc=12,cc=0.6,ph=7.4,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=-0.24 | A[now:cc tune:ph] | PASS
#60411 [tile+liquid] fc=12,cc=0,ph=7.4,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=79 warn csi=-0.53 | A[soon:ch tune:ph tune:ta tune:csi] | PASS
#60446 [tile+liquid] fc=12,cc=0.6,ph=7.4,ta=100,cya=90,ch=400,temp=85 :: H 2/6 score=54 bad csi=-0.19 | A[now:cc soon:cya tune:ph tune:ta] | PASS
#60481 [tile+liquid] fc=12,cc=0,ph=7.4,ta=130,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=-0.44 | A[soon:cya soon:ta soon:ch tune:ph tune:csi] | PASS
#60516 [tile+liquid] fc=12,cc=0.6,ph=7.6,ta=40,cya=40,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.42 | A[now:cc soon:ta tune:csi] | PASS
#60551 [tile+liquid] fc=12,cc=0,ph=7.6,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.54 | A[soon:cya soon:ch tune:fc tune:csi] | PASS
#60586 [tile+liquid] fc=12,cc=0.6,ph=7.6,ta=60,cya=70,ch=400,temp=85 :: H 4/6 score=67 bad csi=-0.29 | A[now:cc soon:cya] | PASS
#60621 [tile+liquid] fc=12,cc=0,ph=7.6,ta=80,cya=50,ch=150,temp=85 :: H 5/6 score=92 warn csi=-0.47 | A[soon:ch tune:csi] | PASS
#60656 [tile+liquid] fc=12,cc=0.6,ph=7.6,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=50 bad csi=0.12 | A[now:cc soon:cya tune:fc tune:ta] | PASS
#60691 [tile+liquid] fc=12,cc=0,ph=7.6,ta=100,cya=90,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.43 | A[soon:cya soon:ch tune:ta tune:csi] | PASS
#60726 [tile+liquid] fc=12,cc=0.6,ph=7.6,ta=130,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.2 | A[now:cc soon:ta] | PASS
#60761 [tile+liquid] fc=12,cc=0,ph=7.8,ta=40,cya=40,ch=150,temp=85 :: H 4/6 score=79 bad csi=-0.66 | A[soon:ta soon:ch soon:csi] | PASS
#60796 [tile+liquid] fc=12,cc=0.6,ph=7.8,ta=40,cya=90,ch=400,temp=85 :: H 3/6 score=50 bad csi=-0.72 | A[now:cc soon:cya soon:ta soon:csi] | PASS
#60831 [tile+liquid] fc=12,cc=0,ph=7.8,ta=60,cya=70,ch=150,temp=85 :: H 4/6 score=75 bad csi=-0.52 | A[soon:cya soon:ch tune:csi] | PASS
#60866 [tile+liquid] fc=12,cc=0.6,ph=7.8,ta=80,cya=40,ch=400,temp=85 :: H 5/6 score=83 bad csi=0.17 | A[now:cc] | PASS
#60901 [tile+liquid] fc=12,cc=0,ph=7.8,ta=100,cya=20,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.1 | A[soon:cya soon:ch tune:fc tune:ta] | PASS
#60936 [tile+liquid] fc=12,cc=0.6,ph=7.8,ta=100,cya=70,ch=400,temp=85 :: H 3/6 score=63 bad csi=0.22 | A[now:cc soon:cya tune:ta] | PASS
#60971 [tile+liquid] fc=12,cc=0,ph=7.8,ta=130,cya=50,ch=150,temp=85 :: H 4/6 score=88 bad csi=-0.02 | A[soon:ta soon:ch] | PASS
#61006 [tile+liquid] fc=12,cc=0.6,ph=8,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=38 bad csi=0.06 | A[now:cc soon:cya soon:ta tune:fc tune:ph] | PASS
#61041 [tile+liquid] fc=12,cc=0,ph=8,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=54 bad csi=-1.01 | A[soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#61076 [tile+liquid] fc=12,cc=0.6,ph=8,ta=60,cya=50,ch=400,temp=85 :: H 4/6 score=75 bad csi=0.17 | A[now:cc tune:ph] | PASS
#61111 [tile+liquid] fc=12,cc=0,ph=8,ta=80,cya=40,ch=150,temp=85 :: H 4/6 score=88 warn csi=-0.06 | A[soon:ch tune:ph] | PASS
#61146 [tile+liquid] fc=12,cc=0.6,ph=8,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.22 | A[now:cc soon:cya tune:ph] | PASS
#61181 [tile+liquid] fc=12,cc=0,ph=8,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=67 bad csi=0 | A[soon:cya soon:ch tune:ph tune:ta] | PASS
#61216 [tile+liquid] fc=12,cc=0.6,ph=8,ta=130,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.61 | A[now:cc soon:ta soon:csi tune:ph] | PASS
#61251 [tile+liquid] fc=12,cc=0,ph=8.3,ta=40,cya=20,ch=150,temp=85 :: H 1/6 score=42 bad csi=-0.06 | A[soon:cya soon:ta soon:ch tune:fc tune:ph] | PASS
#61286 [tile+liquid] fc=12,cc=0.6,ph=8.3,ta=40,cya=70,ch=400,temp=85 :: H 2/6 score=42 bad csi=-0.01 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#61321 [tile+liquid] fc=12,cc=0,ph=8.3,ta=60,cya=50,ch=150,temp=85 :: H 4/6 score=79 bad csi=0.04 | A[soon:ch tune:ph] | PASS
#61356 [tile+liquid] fc=12,cc=0.6,ph=8.3,ta=80,cya=20,ch=400,temp=85 :: H 2/6 score=29 bad csi=0.71 | A[now:cc soon:cya soon:csi tune:fc tune:ph] | PASS
#61391 [tile+liquid] fc=12,cc=0,ph=8.3,ta=80,cya=90,ch=150,temp=85 :: H 3/6 score=63 bad csi=0.09 | A[soon:cya soon:ch tune:ph] | PASS
#61426 [tile+liquid] fc=12,cc=0.6,ph=8.3,ta=100,cya=50,ch=400,temp=85 :: H 3/6 score=54 bad csi=0.76 | A[now:cc soon:csi tune:ph tune:ta] | PASS
#61461 [tile+liquid] fc=12,cc=0,ph=8.3,ta=130,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=0.49 | A[soon:ta soon:ch tune:ph tune:csi] | PASS
#61496 [tile+liquid] fc=12,cc=0.6,ph=8.3,ta=130,cya=90,ch=400,temp=85 :: H 2/6 score=33 bad csi=0.83 | A[now:cc soon:cya soon:ta soon:csi tune:ph] | PASS
#61531 [tile+liquid] fc=25,cc=0,ph=7,ta=40,cya=70,ch=150,temp=85 :: H 2/6 score=46 bad csi=-1.49 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#61566 [tile+liquid] fc=25,cc=0.6,ph=7,ta=60,cya=40,ch=400,temp=85 :: H 3/6 score=46 bad csi=-0.75 | A[now:cc soon:ph soon:csi tune:fc] | PASS
#61601 [tile+liquid] fc=25,cc=0,ph=7,ta=80,cya=20,ch=150,temp=85 :: H 2/6 score=42 bad csi=-0.99 | A[soon:cya soon:ph soon:ch soon:csi tune:fc] | PASS
#61636 [tile+liquid] fc=25,cc=0.6,ph=7,ta=80,cya=70,ch=400,temp=85 :: H 3/6 score=42 bad csi=-0.65 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#61671 [tile+liquid] fc=25,cc=0,ph=7,ta=100,cya=50,ch=150,temp=85 :: H 2/6 score=54 bad csi=-0.93 | A[soon:ph soon:ch soon:csi tune:fc tune:ta] | PASS
#61706 [tile+liquid] fc=25,cc=0.6,ph=7,ta=130,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=-0.36 | A[now:cc soon:cya soon:ph soon:ta tune:fc tune:csi] | PASS
#61741 [tile+liquid] fc=25,cc=0,ph=7,ta=130,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.84 | A[soon:cya soon:ph soon:ta soon:ch soon:csi] | PASS
#61776 [tile+liquid] fc=25,cc=0.6,ph=7.4,ta=40,cya=50,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.66 | A[now:cc soon:ta soon:csi tune:fc tune:ph] | PASS
#61811 [tile+liquid] fc=25,cc=0,ph=7.4,ta=60,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.79 | A[soon:ch soon:csi tune:fc tune:ph] | PASS
#61846 [tile+liquid] fc=25,cc=0.6,ph=7.4,ta=60,cya=90,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.54 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#61881 [tile+liquid] fc=25,cc=0,ph=7.4,ta=80,cya=70,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.7 | A[soon:cya soon:ch soon:csi tune:ph] | PASS
#61916 [tile+liquid] fc=25,cc=0.6,ph=7.4,ta=100,cya=40,ch=400,temp=85 :: H 2/6 score=58 bad csi=-0.11 | A[now:cc tune:fc tune:ph tune:ta] | PASS
#61951 [tile+liquid] fc=25,cc=0,ph=7.4,ta=130,cya=20,ch=150,temp=85 :: H 1/6 score=46 bad csi=-0.38 | A[soon:cya soon:ta soon:ch tune:fc tune:ph tune:csi] | PASS
#61986 [tile+liquid] fc=25,cc=0.6,ph=7.4,ta=130,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=-0.02 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#62021 [tile+liquid] fc=25,cc=0,ph=7.6,ta=40,cya=50,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.9 | A[soon:ta soon:ch soon:csi tune:fc] | PASS
#62056 [tile+liquid] fc=25,cc=0.6,ph=7.6,ta=60,cya=20,ch=400,temp=85 :: H 3/6 score=54 bad csi=-0.12 | A[now:cc soon:cya tune:fc] | PASS
#62091 [tile+liquid] fc=25,cc=0,ph=7.6,ta=60,cya=90,ch=150,temp=85 :: H 4/6 score=71 bad csi=-0.79 | A[soon:cya soon:ch soon:csi] | PASS
#62126 [tile+liquid] fc=25,cc=0.6,ph=7.6,ta=80,cya=50,ch=400,temp=85 :: H 4/6 score=71 bad csi=-0.05 | A[now:cc tune:fc] | PASS
#62161 [tile+liquid] fc=25,cc=0,ph=7.6,ta=100,cya=40,ch=150,temp=85 :: H 3/6 score=75 warn csi=-0.34 | A[soon:ch tune:fc tune:ta tune:csi] | PASS
#62196 [tile+liquid] fc=25,cc=0.6,ph=7.6,ta=100,cya=90,ch=400,temp=85 :: H 3/6 score=63 bad csi=-0.01 | A[now:cc soon:cya tune:ta] | PASS
#62231 [tile+liquid] fc=25,cc=0,ph=7.6,ta=130,cya=70,ch=150,temp=85 :: H 3/6 score=71 bad csi=-0.25 | A[soon:cya soon:ta soon:ch] | PASS
#62266 [tile+liquid] fc=25,cc=0.6,ph=7.8,ta=40,cya=40,ch=400,temp=85 :: H 3/6 score=63 bad csi=-0.24 | A[now:cc soon:ta tune:fc] | PASS
#62301 [tile+liquid] fc=25,cc=0,ph=7.8,ta=60,cya=20,ch=150,temp=85 :: H 3/6 score=63 bad csi=-0.35 | A[soon:cya soon:ch tune:fc tune:csi] | PASS
#62336 [tile+liquid] fc=25,cc=0.6,ph=7.8,ta=60,cya=70,ch=400,temp=85 :: H 4/6 score=67 bad csi=-0.1 | A[now:cc soon:cya] | PASS
#62371 [tile+liquid] fc=25,cc=0,ph=7.8,ta=80,cya=50,ch=150,temp=85 :: H 4/6 score=83 warn csi=-0.28 | A[soon:ch tune:fc] | PASS
#62406 [tile+liquid] fc=25,cc=0.6,ph=7.8,ta=100,cya=20,ch=400,temp=85 :: H 2/6 score=46 bad csi=0.31 | A[now:cc soon:cya tune:fc tune:ta tune:csi] | PASS
#62441 [tile+liquid] fc=25,cc=0,ph=7.8,ta=100,cya=90,ch=150,temp=85 :: H 3/6 score=75 bad csi=-0.24 | A[soon:cya soon:ch tune:ta] | PASS
#62476 [tile+liquid] fc=25,cc=0.6,ph=7.8,ta=130,cya=50,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.4 | A[now:cc soon:ta tune:fc tune:csi] | PASS
#62511 [tile+liquid] fc=25,cc=0,ph=8,ta=40,cya=40,ch=150,temp=85 :: H 2/6 score=63 bad csi=-0.46 | A[soon:ta soon:ch tune:fc tune:ph tune:csi] | PASS
#62546 [tile+liquid] fc=25,cc=0.6,ph=8,ta=40,cya=90,ch=400,temp=85 :: H 2/6 score=46 bad csi=-0.59 | A[now:cc soon:cya soon:ta tune:ph tune:csi] | PASS
#62581 [tile+liquid] fc=25,cc=0,ph=8,ta=60,cya=70,ch=150,temp=85 :: H 3/6 score=67 bad csi=-0.33 | A[soon:cya soon:ch tune:ph tune:csi] | PASS
#62616 [tile+liquid] fc=25,cc=0.6,ph=8,ta=80,cya=40,ch=400,temp=85 :: H 3/6 score=58 bad csi=0.36 | A[now:cc tune:fc tune:ph tune:csi] | PASS
#62651 [tile+liquid] fc=25,cc=0,ph=8,ta=100,cya=20,ch=150,temp=85 :: H 1/6 score=54 bad csi=0.09 | A[soon:cya soon:ch tune:fc tune:ph tune:ta] | PASS
#62686 [tile+liquid] fc=25,cc=0.6,ph=8,ta=100,cya=70,ch=400,temp=85 :: H 2/6 score=50 bad csi=0.42 | A[now:cc soon:cya tune:ph tune:ta tune:csi] | PASS
#62721 [tile+liquid] fc=25,cc=0,ph=8,ta=130,cya=50,ch=150,temp=85 :: H 2/6 score=67 bad csi=0.17 | A[soon:ta soon:ch tune:fc tune:ph] | PASS
#62756 [tile+liquid] fc=25,cc=0.6,ph=8.3,ta=40,cya=20,ch=400,temp=85 :: H 1/6 score=25 bad csi=0.36 | A[now:cc soon:cya soon:ta tune:fc tune:ph tune:csi] | PASS
#62791 [tile+liquid] fc=25,cc=0,ph=8.3,ta=40,cya=90,ch=150,temp=85 :: H 2/6 score=46 bad csi=-0.77 | A[soon:cya soon:ta soon:ch soon:csi tune:ph] | PASS
#62826 [tile+liquid] fc=25,cc=0.6,ph=8.3,ta=60,cya=50,ch=400,temp=85 :: H 3/6 score=50 bad csi=0.46 | A[now:cc tune:fc tune:ph tune:csi] | PASS
#62861 [tile+liquid] fc=25,cc=0,ph=8.3,ta=80,cya=40,ch=150,temp=85 :: H 3/6 score=67 bad csi=0.24 | A[soon:ch tune:fc tune:ph] | PASS
#62896 [tile+liquid] fc=25,cc=0.6,ph=8.3,ta=80,cya=90,ch=400,temp=85 :: H 3/6 score=46 bad csi=0.51 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#62931 [tile+liquid] fc=25,cc=0,ph=8.3,ta=100,cya=70,ch=150,temp=85 :: H 2/6 score=58 bad csi=0.29 | A[soon:cya soon:ch tune:ph tune:ta] | PASS
#62966 [tile+liquid] fc=25,cc=0.6,ph=8.3,ta=130,cya=40,ch=400,temp=85 :: H 2/6 score=38 bad csi=0.91 | A[now:cc soon:ta soon:csi tune:fc tune:ph] | PASS
#63001 [vinyl+liquid] fc=0,cc=0,ph=7,ta=40,cya=20,temp=85 :: H 1/5 score=18 bad csi=-0.9 | A[now:fc soon:cya soon:ph soon:ta soon:csi] | PASS
#63036 [vinyl+liquid] fc=0,cc=0.6,ph=7,ta=100,cya=50,temp=85 :: H 1/5 score=27 bad csi=-0.51 | A[now:cc now:fc soon:ph tune:ta tune:csi] | PASS
#63071 [vinyl+liquid] fc=0,cc=0,ph=7.4,ta=80,cya=20,temp=85 :: H 2/5 score=45 bad csi=-0.18 | A[now:fc soon:cya tune:ph] | PASS
#63106 [vinyl+liquid] fc=0,cc=0.6,ph=7.6,ta=40,cya=50,temp=85 :: H 2/5 score=41 bad csi=-0.48 | A[now:cc now:fc soon:ta tune:csi] | PASS
#63141 [vinyl+liquid] fc=0,cc=0,ph=7.6,ta=130,cya=20,temp=85 :: H 2/5 score=45 bad csi=0.24 | A[now:fc soon:cya soon:ta] | PASS
#63176 [vinyl+liquid] fc=0,cc=0.6,ph=7.8,ta=80,cya=50,temp=85 :: H 3/5 score=55 bad csi=0.14 | A[now:cc now:fc] | PASS
#63211 [vinyl+liquid] fc=0,cc=0,ph=8,ta=60,cya=20,temp=85 :: H 2/5 score=45 bad csi=0.27 | A[now:fc soon:cya soon:ph] | PASS
#63246 [vinyl+liquid] fc=0,cc=0.6,ph=8,ta=130,cya=50,temp=85 :: H 1/5 score=32 bad csi=0.59 | A[now:cc now:fc soon:ph soon:ta tune:csi] | PASS
#63281 [vinyl+liquid] fc=0,cc=0,ph=8.3,ta=100,cya=20,temp=85 :: H 1/5 score=23 bad csi=0.81 | A[now:fc soon:cya soon:ph soon:csi tune:ta] | PASS
#63316 [vinyl+liquid] fc=2,cc=0.6,ph=7,ta=60,cya=50,temp=85 :: H 2/5 score=27 bad csi=-0.77 | A[now:cc now:fc soon:ph soon:csi] | PASS
#63351 [vinyl+liquid] fc=2,cc=0,ph=7.4,ta=40,cya=20,temp=85 :: H 1/5 score=45 bad csi=-0.52 | A[soon:cya soon:fc soon:ta tune:ph tune:csi] | PASS
#63386 [vinyl+liquid] fc=2,cc=0.6,ph=7.4,ta=100,cya=50,temp=85 :: H 1/5 score=41 bad csi=-0.13 | A[now:cc now:fc tune:ph tune:ta] | PASS
#63421 [vinyl+liquid] fc=2,cc=0,ph=7.6,ta=80,cya=20,temp=85 :: H 3/5 score=68 bad csi=0.01 | A[soon:cya soon:fc] | PASS
#63456 [vinyl+liquid] fc=2,cc=0.6,ph=7.8,ta=40,cya=50,temp=85 :: H 2/5 score=45 bad csi=-0.3 | A[now:cc now:fc soon:ta] | PASS
#63491 [vinyl+liquid] fc=2,cc=0,ph=7.8,ta=130,cya=20,temp=85 :: H 2/5 score=55 bad csi=0.43 | A[soon:cya soon:fc soon:ta tune:csi] | PASS
#63526 [vinyl+liquid] fc=2,cc=0.6,ph=8,ta=80,cya=50,temp=85 :: H 2/5 score=41 bad csi=0.34 | A[now:cc now:fc soon:ph tune:csi] | PASS
#63561 [vinyl+liquid] fc=2,cc=0,ph=8.3,ta=60,cya=20,temp=85 :: H 2/5 score=45 bad csi=0.57 | A[soon:cya soon:fc soon:ph tune:csi] | PASS
#63596 [vinyl+liquid] fc=2,cc=0.6,ph=8.3,ta=130,cya=50,temp=85 :: H 1/5 score=18 bad csi=0.89 | A[now:cc now:fc soon:ph soon:ta soon:csi] | PASS
#63631 [vinyl+liquid] fc=3,cc=0,ph=7,ta=100,cya=20,temp=85 :: H 2/5 score=55 bad csi=-0.47 | A[soon:cya soon:ph tune:ta tune:csi] | PASS
#63666 [vinyl+liquid] fc=3,cc=0.6,ph=7.4,ta=60,cya=50,temp=85 :: H 2/5 score=41 bad csi=-0.4 | A[now:cc now:fc tune:ph tune:csi] | PASS
#63701 [vinyl+liquid] fc=3,cc=0,ph=7.6,ta=40,cya=20,temp=85 :: H 3/5 score=68 bad csi=-0.33 | A[soon:cya soon:ta tune:csi] | PASS
#63736 [vinyl+liquid] fc=3,cc=0.6,ph=7.6,ta=100,cya=50,temp=85 :: H 2/5 score=50 bad csi=0.07 | A[now:cc now:fc tune:ta] | PASS
#63771 [vinyl+liquid] fc=3,cc=0,ph=7.8,ta=80,cya=20,temp=85 :: H 4/5 score=82 bad csi=0.21 | A[soon:cya] | PASS
#63806 [vinyl+liquid] fc=3,cc=0.6,ph=8,ta=40,cya=50,temp=85 :: H 1/5 score=36 bad csi=-0.11 | A[now:cc now:fc soon:ph soon:ta] | PASS
#63841 [vinyl+liquid] fc=3,cc=0,ph=8,ta=130,cya=20,temp=85 :: H 2/5 score=55 bad csi=0.63 | A[soon:cya soon:ph soon:ta soon:csi] | PASS
#63876 [vinyl+liquid] fc=3,cc=0.6,ph=8.3,ta=80,cya=50,temp=85 :: H 2/5 score=27 bad csi=0.63 | A[now:cc now:fc soon:ph soon:csi] | PASS
#63911 [vinyl+liquid] fc=5,cc=0,ph=7,ta=60,cya=20,temp=85 :: H 3/5 score=55 bad csi=-0.71 | A[soon:cya soon:ph soon:csi] | PASS
#63946 [vinyl+liquid] fc=5,cc=0.6,ph=7,ta=130,cya=50,temp=85 :: H 1/5 score=36 bad csi=-0.38 | A[now:cc soon:fc soon:ph soon:ta tune:csi] | PASS
#63981 [vinyl+liquid] fc=5,cc=0,ph=7.4,ta=100,cya=20,temp=85 :: H 2/5 score=68 bad csi=-0.08 | A[soon:cya tune:ph tune:ta] | PASS
#64016 [vinyl+liquid] fc=5,cc=0.6,ph=7.6,ta=60,cya=50,temp=85 :: H 3/5 score=68 bad csi=-0.21 | A[now:cc soon:fc] | PASS
#64051 [vinyl+liquid] fc=5,cc=0,ph=7.8,ta=40,cya=20,temp=85 :: H 3/5 score=73 bad csi=-0.13 | A[soon:cya soon:ta] | PASS
#64086 [vinyl+liquid] fc=5,cc=0.6,ph=7.8,ta=100,cya=50,temp=85 :: H 2/5 score=64 bad csi=0.26 | A[now:cc soon:fc tune:ta] | PASS
#64121 [vinyl+liquid] fc=5,cc=0,ph=8,ta=80,cya=20,temp=85 :: H 3/5 score=68 bad csi=0.41 | A[soon:cya soon:ph tune:csi] | PASS
#64156 [vinyl+liquid] fc=5,cc=0.6,ph=8.3,ta=40,cya=50,temp=85 :: H 1/5 score=41 bad csi=0.18 | A[now:cc soon:fc soon:ph soon:ta] | PASS
#64191 [vinyl+liquid] fc=5,cc=0,ph=8.3,ta=130,cya=20,temp=85 :: H 2/5 score=45 bad csi=0.93 | A[soon:cya soon:ph soon:ta soon:csi] | PASS
#64226 [vinyl+liquid] fc=8,cc=0.6,ph=7,ta=80,cya=50,temp=85 :: H 3/5 score=55 bad csi=-0.62 | A[now:cc soon:ph soon:csi] | PASS
#64261 [vinyl+liquid] fc=8,cc=0,ph=7.4,ta=60,cya=20,temp=85 :: H 3/5 score=68 bad csi=-0.32 | A[soon:cya tune:ph tune:csi] | PASS
#64296 [vinyl+liquid] fc=8,cc=0.6,ph=7.4,ta=130,cya=50,temp=85 :: H 2/5 score=64 bad csi=0 | A[now:cc soon:ta tune:ph] | PASS
#64331 [vinyl+liquid] fc=8,cc=0,ph=7.6,ta=100,cya=20,temp=85 :: H 3/5 score=77 bad csi=0.12 | A[soon:cya tune:ta] | PASS
#64366 [vinyl+liquid] fc=8,cc=0.6,ph=7.8,ta=60,cya=50,temp=85 :: H 4/5 score=82 bad csi=-0.02 | A[now:cc] | PASS
#64401 [vinyl+liquid] fc=8,cc=0,ph=8,ta=40,cya=20,temp=85 :: H 2/5 score=64 bad csi=0.06 | A[soon:cya soon:ph soon:ta] | PASS
#64436 [vinyl+liquid] fc=8,cc=0.6,ph=8,ta=100,cya=50,temp=85 :: H 2/5 score=64 bad csi=0.46 | A[now:cc soon:ph tune:ta tune:csi] | PASS
#64471 [vinyl+liquid] fc=8,cc=0,ph=8.3,ta=80,cya=20,temp=85 :: H 3/5 score=55 bad csi=0.71 | A[soon:cya soon:ph soon:csi] | PASS
#64506 [vinyl+liquid] fc=12,cc=0.6,ph=7,ta=40,cya=50,temp=85 :: H 2/5 score=45 bad csi=-1 | A[now:cc soon:ph soon:ta soon:csi] | PASS
#64541 [vinyl+liquid] fc=12,cc=0,ph=7,ta=130,cya=20,temp=85 :: H 1/5 score=36 bad csi=-0.36 | A[soon:cya soon:ph soon:ta tune:fc tune:csi] | PASS
#64576 [vinyl+liquid] fc=12,cc=0.6,ph=7.4,ta=80,cya=50,temp=85 :: H 3/5 score=73 bad csi=-0.24 | A[now:cc tune:ph] | PASS
#64611 [vinyl+liquid] fc=12,cc=0,ph=7.6,ta=60,cya=20,temp=85 :: H 3/5 score=68 bad csi=-0.12 | A[soon:cya tune:fc] | PASS
#64646 [vinyl+liquid] fc=12,cc=0.6,ph=7.6,ta=130,cya=50,temp=85 :: H 3/5 score=73 bad csi=0.2 | A[now:cc soon:ta] | PASS
#64681 [vinyl+liquid] fc=12,cc=0,ph=7.8,ta=100,cya=20,temp=85 :: H 2/5 score=59 bad csi=0.31 | A[soon:cya tune:fc tune:ta tune:csi] | PASS
#64716 [vinyl+liquid] fc=12,cc=0.6,ph=8,ta=60,cya=50,temp=85 :: H 3/5 score=73 bad csi=0.17 | A[now:cc tune:ph] | PASS
#64751 [vinyl+liquid] fc=12,cc=0,ph=8.3,ta=40,cya=20,temp=85 :: H 1/5 score=36 bad csi=0.36 | A[soon:cya soon:ta tune:fc tune:ph tune:csi] | PASS
#64786 [vinyl+liquid] fc=12,cc=0.6,ph=8.3,ta=100,cya=50,temp=85 :: H 2/5 score=50 bad csi=0.76 | A[now:cc soon:csi tune:ph tune:ta] | PASS
#64821 [vinyl+liquid] fc=25,cc=0,ph=7,ta=80,cya=20,temp=85 :: H 2/5 score=45 bad csi=-0.58 | A[soon:cya soon:ph tune:fc tune:csi] | PASS
#64856 [vinyl+liquid] fc=25,cc=0.6,ph=7.4,ta=40,cya=50,temp=85 :: H 1/5 score=41 bad csi=-0.66 | A[now:cc soon:ta soon:csi tune:fc tune:ph] | PASS
#64891 [vinyl+liquid] fc=25,cc=0,ph=7.4,ta=130,cya=20,temp=85 :: H 1/5 score=50 bad csi=0.04 | A[soon:cya soon:ta tune:fc tune:ph] | PASS
#64926 [vinyl+liquid] fc=25,cc=0.6,ph=7.6,ta=80,cya=50,temp=85 :: H 3/5 score=68 bad csi=-0.05 | A[now:cc tune:fc] | PASS
#64961 [vinyl+liquid] fc=25,cc=0,ph=7.8,ta=60,cya=20,temp=85 :: H 3/5 score=68 bad csi=0.07 | A[soon:cya tune:fc] | PASS
#64996 [vinyl+liquid] fc=25,cc=0.6,ph=7.8,ta=130,cya=50,temp=85 :: H 2/5 score=55 bad csi=0.4 | A[now:cc soon:ta tune:fc tune:csi] | PASS
#65031 [vinyl+liquid] fc=25,cc=0,ph=8,ta=100,cya=20,temp=85 :: H 1/5 score=50 bad csi=0.51 | A[soon:cya tune:fc tune:ph tune:ta tune:csi] | PASS
#65066 [vinyl+liquid] fc=25,cc=0.6,ph=8.3,ta=60,cya=50,temp=85 :: H 2/5 score=45 bad csi=0.46 | A[now:cc tune:fc tune:ph tune:csi] | PASS
#65101 [fiberglass+salt] fc=0,cc=0,ph=7,ta=40,cya=20,salt=2500,temp=85 :: H 1/6 score=17 bad csi=-0.87 | A[now:fc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#65136 [fiberglass+salt] fc=0,cc=0.6,ph=7,ta=60,cya=20,salt=3700,temp=85 :: H 1/6 score=8 bad csi=-0.73 | A[now:cc now:fc soon:cya soon:ph soon:csi soon:salt] | PASS
#65171 [fiberglass+salt] fc=0,cc=0.6,ph=7,ta=80,cya=40,salt=3200,temp=85 :: H 2/6 score=21 bad csi=-0.6 | A[now:cc now:fc soon:cya soon:ph tune:csi] | PASS
#65206 [fiberglass+salt] fc=0,cc=0.6,ph=7,ta=100,cya=50,salt=2500,temp=85 :: H 0/6 score=8 bad csi=-0.47 | A[now:cc now:fc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#65241 [fiberglass+salt] fc=0,cc=0,ph=7,ta=130,cya=70,salt=3700,temp=85 :: H 2/6 score=38 bad csi=-0.42 | A[now:fc soon:ph soon:ta soon:salt tune:csi] | PASS
#65276 [fiberglass+salt] fc=0,cc=0,ph=7.4,ta=40,cya=90,salt=3200,temp=85 :: H 2/6 score=42 bad csi=-0.95 | A[now:fc soon:ta soon:csi tune:cya tune:ph] | PASS
#65311 [fiberglass+salt] fc=0,cc=0,ph=7.4,ta=80,cya=20,salt=2500,temp=85 :: H 2/6 score=42 bad csi=-0.15 | A[now:fc soon:cya soon:salt tune:ph] | PASS
#65346 [fiberglass+salt] fc=0,cc=0.6,ph=7.4,ta=100,cya=20,salt=3700,temp=85 :: H 0/6 score=21 bad csi=-0.1 | A[now:cc now:fc soon:cya soon:salt tune:ph tune:ta] | PASS
#65381 [fiberglass+salt] fc=0,cc=0.6,ph=7.4,ta=130,cya=40,salt=3200,temp=85 :: H 1/6 score=25 bad csi=0.02 | A[now:cc now:fc soon:cya soon:ta tune:ph] | PASS
#65416 [fiberglass+salt] fc=0,cc=0.6,ph=7.6,ta=40,cya=50,salt=2500,temp=85 :: H 1/6 score=21 bad csi=-0.45 | A[now:cc now:fc soon:cya soon:ta soon:salt tune:csi] | PASS
#65451 [fiberglass+salt] fc=0,cc=0,ph=7.6,ta=60,cya=70,salt=3700,temp=85 :: H 4/6 score=63 bad csi=-0.31 | A[now:fc soon:salt tune:csi] | PASS
#65486 [fiberglass+salt] fc=0,cc=0,ph=7.6,ta=80,cya=90,salt=3200,temp=85 :: H 4/6 score=67 bad csi=-0.15 | A[now:fc tune:cya] | PASS
#65521 [fiberglass+salt] fc=0,cc=0,ph=7.6,ta=130,cya=20,salt=2500,temp=85 :: H 2/6 score=42 bad csi=0.27 | A[now:fc soon:cya soon:ta soon:salt] | PASS
#65556 [fiberglass+salt] fc=0,cc=0.6,ph=7.8,ta=40,cya=20,salt=3700,temp=85 :: H 1/6 score=25 bad csi=-0.15 | A[now:cc now:fc soon:cya soon:ta soon:salt] | PASS
#65591 [fiberglass+salt] fc=0,cc=0.6,ph=7.8,ta=60,cya=40,salt=3200,temp=85 :: H 3/6 score=42 bad csi=0.01 | A[now:cc now:fc soon:cya] | PASS
#65626 [fiberglass+salt] fc=0,cc=0.6,ph=7.8,ta=80,cya=50,salt=2500,temp=85 :: H 2/6 score=33 bad csi=0.18 | A[now:cc now:fc soon:cya soon:salt] | PASS
#65661 [fiberglass+salt] fc=0,cc=0,ph=7.8,ta=100,cya=70,salt=3700,temp=85 :: H 3/6 score=63 bad csi=0.2 | A[now:fc soon:salt tune:ta] | PASS
#65696 [fiberglass+salt] fc=0,cc=0,ph=7.8,ta=130,cya=90,salt=3200,temp=85 :: H 3/6 score=54 bad csi=0.34 | A[now:fc soon:ta tune:cya tune:csi] | PASS
#65731 [fiberglass+salt] fc=0,cc=0,ph=8,ta=60,cya=20,salt=2500,temp=85 :: H 2/6 score=42 bad csi=0.3 | A[now:fc soon:cya soon:ph soon:salt] | PASS
#65766 [fiberglass+salt] fc=0,cc=0.6,ph=8,ta=80,cya=20,salt=3700,temp=85 :: H 1/6 score=21 bad csi=0.39 | A[now:cc now:fc soon:cya soon:ph soon:salt tune:csi] | PASS
#65801 [fiberglass+salt] fc=0,cc=0.6,ph=8,ta=100,cya=40,salt=3200,temp=85 :: H 1/6 score=25 bad csi=0.48 | A[now:cc now:fc soon:cya soon:ph tune:ta tune:csi] | PASS
#65836 [fiberglass+salt] fc=0,cc=0.6,ph=8,ta=130,cya=50,salt=2500,temp=85 :: H 0/6 score=8 bad csi=0.63 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#65871 [fiberglass+salt] fc=0,cc=0,ph=8.3,ta=40,cya=70,salt=3700,temp=85 :: H 2/6 score=42 bad csi=-0.03 | A[now:fc soon:ph soon:ta soon:salt] | PASS
#65906 [fiberglass+salt] fc=0,cc=0,ph=8.3,ta=60,cya=90,salt=3200,temp=85 :: H 3/6 score=50 bad csi=0.27 | A[now:fc soon:ph tune:cya] | PASS
#65941 [fiberglass+salt] fc=0,cc=0,ph=8.3,ta=100,cya=20,salt=2500,temp=85 :: H 1/6 score=21 bad csi=0.85 | A[now:fc soon:cya soon:ph soon:csi soon:salt tune:ta] | PASS
#65976 [fiberglass+salt] fc=0,cc=0.6,ph=8.3,ta=130,cya=20,salt=3700,temp=85 :: H 0/6 score=0 bad csi=0.91 | A[now:cc now:fc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#66011 [fiberglass+salt] fc=2,cc=0.6,ph=7,ta=40,cya=40,salt=3200,temp=85 :: H 1/6 score=21 bad csi=-0.96 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi] | PASS
#66046 [fiberglass+salt] fc=2,cc=0.6,ph=7,ta=60,cya=50,salt=2500,temp=85 :: H 1/6 score=21 bad csi=-0.73 | A[now:cc soon:cya soon:fc soon:ph soon:csi soon:salt] | PASS
#66081 [fiberglass+salt] fc=2,cc=0,ph=7,ta=80,cya=70,salt=3700,temp=85 :: H 3/6 score=42 bad csi=-0.67 | A[now:fc soon:ph soon:csi soon:salt] | PASS
#66116 [fiberglass+salt] fc=2,cc=0,ph=7,ta=100,cya=90,salt=3200,temp=85 :: H 2/6 score=42 bad csi=-0.56 | A[now:fc soon:ph tune:cya tune:ta tune:csi] | PASS
#66151 [fiberglass+salt] fc=2,cc=0,ph=7.4,ta=40,cya=20,salt=2500,temp=85 :: H 1/6 score=42 bad csi=-0.49 | A[soon:cya soon:fc soon:ta soon:salt tune:ph tune:csi] | PASS
#66186 [fiberglass+salt] fc=2,cc=0.6,ph=7.4,ta=60,cya=20,salt=3700,temp=85 :: H 1/6 score=33 bad csi=-0.34 | A[now:cc soon:cya soon:fc soon:salt tune:ph tune:csi] | PASS
#66221 [fiberglass+salt] fc=2,cc=0.6,ph=7.4,ta=80,cya=40,salt=3200,temp=85 :: H 2/6 score=46 bad csi=-0.22 | A[now:cc soon:cya soon:fc tune:ph] | PASS
#66256 [fiberglass+salt] fc=2,cc=0.6,ph=7.4,ta=100,cya=50,salt=2500,temp=85 :: H 0/6 score=33 bad csi=-0.09 | A[now:cc soon:cya soon:fc soon:salt tune:ph tune:ta] | PASS
#66291 [fiberglass+salt] fc=2,cc=0,ph=7.4,ta=130,cya=70,salt=3700,temp=85 :: H 2/6 score=50 bad csi=-0.04 | A[now:fc soon:ta soon:salt tune:ph] | PASS
#66326 [fiberglass+salt] fc=2,cc=0,ph=7.6,ta=40,cya=90,salt=3200,temp=85 :: H 3/6 score=50 bad csi=-0.84 | A[now:fc soon:ta soon:csi tune:cya] | PASS
#66361 [fiberglass+salt] fc=2,cc=0,ph=7.6,ta=80,cya=20,salt=2500,temp=85 :: H 3/6 score=63 bad csi=0.05 | A[soon:cya soon:fc soon:salt] | PASS
#66396 [fiberglass+salt] fc=2,cc=0.6,ph=7.6,ta=100,cya=20,salt=3700,temp=85 :: H 1/6 score=42 bad csi=0.09 | A[now:cc soon:cya soon:fc soon:salt tune:ta] | PASS
#66431 [fiberglass+salt] fc=2,cc=0.6,ph=7.6,ta=130,cya=40,salt=3200,temp=85 :: H 2/6 score=46 bad csi=0.21 | A[now:cc soon:cya soon:fc soon:ta] | PASS
#66466 [fiberglass+salt] fc=2,cc=0.6,ph=7.8,ta=40,cya=50,salt=2500,temp=85 :: H 1/6 score=38 bad csi=-0.26 | A[now:cc soon:cya soon:fc soon:ta soon:salt] | PASS
#66501 [fiberglass+salt] fc=2,cc=0,ph=7.8,ta=60,cya=70,salt=3700,temp=85 :: H 4/6 score=67 bad csi=-0.12 | A[now:fc soon:salt] | PASS
#66536 [fiberglass+salt] fc=2,cc=0,ph=7.8,ta=80,cya=90,salt=3200,temp=85 :: H 4/6 score=67 bad csi=0.03 | A[now:fc tune:cya] | PASS
#66571 [fiberglass+salt] fc=2,cc=0,ph=7.8,ta=130,cya=20,salt=2500,temp=85 :: H 2/6 score=50 bad csi=0.47 | A[soon:cya soon:fc soon:ta soon:salt tune:csi] | PASS
#66606 [fiberglass+salt] fc=2,cc=0.6,ph=8,ta=40,cya=20,salt=3700,temp=85 :: H 0/6 score=29 bad csi=0.04 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:salt] | PASS
#66641 [fiberglass+salt] fc=2,cc=0.6,ph=8,ta=60,cya=40,salt=3200,temp=85 :: H 2/6 score=46 bad csi=0.21 | A[now:cc soon:cya soon:fc soon:ph] | PASS
#66676 [fiberglass+salt] fc=2,cc=0.6,ph=8,ta=80,cya=50,salt=2500,temp=85 :: H 1/6 score=33 bad csi=0.37 | A[now:cc soon:cya soon:fc soon:ph soon:salt tune:csi] | PASS
#66711 [fiberglass+salt] fc=2,cc=0,ph=8,ta=100,cya=70,salt=3700,temp=85 :: H 2/6 score=50 bad csi=0.4 | A[now:fc soon:ph soon:salt tune:ta tune:csi] | PASS
#66746 [fiberglass+salt] fc=2,cc=0,ph=8,ta=130,cya=90,salt=3200,temp=85 :: H 2/6 score=46 bad csi=0.53 | A[now:fc soon:ph soon:ta tune:cya tune:csi] | PASS
#66781 [fiberglass+salt] fc=2,cc=0,ph=8.3,ta=60,cya=20,salt=2500,temp=85 :: H 2/6 score=42 bad csi=0.6 | A[soon:cya soon:fc soon:ph soon:salt tune:csi] | PASS
#66816 [fiberglass+salt] fc=2,cc=0.6,ph=8.3,ta=80,cya=20,salt=3700,temp=85 :: H 1/6 score=21 bad csi=0.69 | A[now:cc soon:cya soon:fc soon:ph soon:csi soon:salt] | PASS
#66851 [fiberglass+salt] fc=2,cc=0.6,ph=8.3,ta=100,cya=40,salt=3200,temp=85 :: H 1/6 score=25 bad csi=0.78 | A[now:cc soon:cya soon:fc soon:ph soon:csi tune:ta] | PASS
#66886 [fiberglass+salt] fc=2,cc=0.6,ph=8.3,ta=130,cya=50,salt=2500,temp=85 :: H 0/6 score=13 bad csi=0.92 | A[now:cc soon:cya soon:fc soon:ph soon:ta soon:csi soon:salt] | PASS
#66921 [fiberglass+salt] fc=3,cc=0,ph=7,ta=40,cya=70,salt=3700,temp=85 :: H 2/6 score=46 bad csi=-1.1 | A[soon:fc soon:ph soon:ta soon:csi soon:salt] | PASS
#66956 [fiberglass+salt] fc=3,cc=0,ph=7,ta=60,cya=90,salt=3200,temp=85 :: H 3/6 score=42 bad csi=-0.86 | A[now:fc soon:ph soon:csi tune:cya] | PASS
#66991 [fiberglass+salt] fc=3,cc=0,ph=7,ta=100,cya=20,salt=2500,temp=85 :: H 2/6 score=50 bad csi=-0.44 | A[soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#67026 [fiberglass+salt] fc=3,cc=0.6,ph=7,ta=130,cya=20,salt=3700,temp=85 :: H 1/6 score=29 bad csi=-0.38 | A[now:cc soon:cya soon:ph soon:ta soon:salt tune:csi] | PASS
#67061 [fiberglass+salt] fc=3,cc=0.6,ph=7.4,ta=40,cya=40,salt=3200,temp=85 :: H 2/6 score=42 bad csi=-0.61 | A[now:cc soon:cya soon:ta soon:csi tune:ph] | PASS
#67096 [fiberglass+salt] fc=3,cc=0.6,ph=7.4,ta=60,cya=50,salt=2500,temp=85 :: H 2/6 score=46 bad csi=-0.37 | A[now:cc soon:cya soon:salt tune:ph tune:csi] | PASS
#67131 [fiberglass+salt] fc=3,cc=0,ph=7.4,ta=80,cya=70,salt=3700,temp=85 :: H 3/6 score=67 bad csi=-0.31 | A[soon:fc soon:salt tune:ph tune:csi] | PASS
#67166 [fiberglass+salt] fc=3,cc=0,ph=7.4,ta=100,cya=90,salt=3200,temp=85 :: H 2/6 score=54 bad csi=-0.19 | A[now:fc tune:cya tune:ph tune:ta] | PASS
#67201 [fiberglass+salt] fc=3,cc=0,ph=7.6,ta=40,cya=20,salt=2500,temp=85 :: H 3/6 score=67 bad csi=-0.29 | A[soon:cya soon:ta soon:salt] | PASS
#67236 [fiberglass+salt] fc=3,cc=0.6,ph=7.6,ta=60,cya=20,salt=3700,temp=85 :: H 3/6 score=58 bad csi=-0.15 | A[now:cc soon:cya soon:salt] | PASS
#67271 [fiberglass+salt] fc=3,cc=0.6,ph=7.6,ta=80,cya=40,salt=3200,temp=85 :: H 4/6 score=67 bad csi=-0.03 | A[now:cc soon:cya] | PASS
#67306 [fiberglass+salt] fc=3,cc=0.6,ph=7.6,ta=100,cya=50,salt=2500,temp=85 :: H 2/6 score=54 bad csi=0.1 | A[now:cc soon:cya soon:salt tune:ta] | PASS
#67341 [fiberglass+salt] fc=3,cc=0,ph=7.6,ta=130,cya=70,salt=3700,temp=85 :: H 3/6 score=71 bad csi=0.15 | A[soon:fc soon:ta soon:salt] | PASS
#67376 [fiberglass+salt] fc=3,cc=0,ph=7.8,ta=40,cya=90,salt=3200,temp=85 :: H 3/6 score=50 bad csi=-0.72 | A[now:fc soon:ta soon:csi tune:cya] | PASS
#67411 [fiberglass+salt] fc=3,cc=0,ph=7.8,ta=80,cya=20,salt=2500,temp=85 :: H 4/6 score=75 bad csi=0.24 | A[soon:cya soon:salt] | PASS
#67446 [fiberglass+salt] fc=3,cc=0.6,ph=7.8,ta=100,cya=20,salt=3700,temp=85 :: H 2/6 score=54 bad csi=0.29 | A[now:cc soon:cya soon:salt tune:ta] | PASS
#67481 [fiberglass+salt] fc=3,cc=0.6,ph=7.8,ta=130,cya=40,salt=3200,temp=85 :: H 3/6 score=54 bad csi=0.41 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#67516 [fiberglass+salt] fc=3,cc=0.6,ph=8,ta=40,cya=50,salt=2500,temp=85 :: H 1/6 score=42 bad csi=-0.08 | A[now:cc soon:cya soon:ph soon:ta soon:salt] | PASS
#67551 [fiberglass+salt] fc=3,cc=0,ph=8,ta=60,cya=70,salt=3700,temp=85 :: H 3/6 score=71 bad csi=0.07 | A[soon:fc soon:ph soon:salt] | PASS
#67586 [fiberglass+salt] fc=3,cc=0,ph=8,ta=80,cya=90,salt=3200,temp=85 :: H 3/6 score=58 bad csi=0.22 | A[now:fc soon:ph tune:cya] | PASS
#67621 [fiberglass+salt] fc=3,cc=0,ph=8,ta=130,cya=20,salt=2500,temp=85 :: H 2/6 score=50 bad csi=0.67 | A[soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#67656 [fiberglass+salt] fc=3,cc=0.6,ph=8.3,ta=40,cya=20,salt=3700,temp=85 :: H 1/6 score=29 bad csi=0.34 | A[now:cc soon:cya soon:ph soon:ta soon:salt tune:csi] | PASS
#67691 [fiberglass+salt] fc=3,cc=0.6,ph=8.3,ta=60,cya=40,salt=3200,temp=85 :: H 3/6 score=46 bad csi=0.5 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#67726 [fiberglass+salt] fc=3,cc=0.6,ph=8.3,ta=80,cya=50,salt=2500,temp=85 :: H 2/6 score=33 bad csi=0.67 | A[now:cc soon:cya soon:ph soon:csi soon:salt] | PASS
#67761 [fiberglass+salt] fc=3,cc=0,ph=8.3,ta=100,cya=70,salt=3700,temp=85 :: H 2/6 score=50 bad csi=0.69 | A[soon:fc soon:ph soon:csi soon:salt tune:ta] | PASS
#67796 [fiberglass+salt] fc=3,cc=0,ph=8.3,ta=130,cya=90,salt=3200,temp=85 :: H 2/6 score=33 bad csi=0.83 | A[now:fc soon:ph soon:ta soon:csi tune:cya] | PASS
#67831 [fiberglass+salt] fc=5,cc=0,ph=7,ta=60,cya=20,salt=2500,temp=85 :: H 3/6 score=50 bad csi=-0.67 | A[soon:cya soon:ph soon:csi soon:salt] | PASS
#67866 [fiberglass+salt] fc=5,cc=0.6,ph=7,ta=80,cya=20,salt=3700,temp=85 :: H 2/6 score=38 bad csi=-0.6 | A[now:cc soon:cya soon:ph soon:salt tune:csi] | PASS
#67901 [fiberglass+salt] fc=5,cc=0.6,ph=7,ta=100,cya=40,salt=3200,temp=85 :: H 2/6 score=42 bad csi=-0.5 | A[now:cc soon:cya soon:ph tune:ta tune:csi] | PASS
#67936 [fiberglass+salt] fc=5,cc=0.6,ph=7,ta=130,cya=50,salt=2500,temp=85 :: H 1/6 score=29 bad csi=-0.35 | A[now:cc soon:cya soon:ph soon:ta soon:salt tune:csi] | PASS
#67971 [fiberglass+salt] fc=5,cc=0,ph=7.4,ta=40,cya=70,salt=3700,temp=85 :: H 3/6 score=67 bad csi=-0.8 | A[soon:ta soon:csi soon:salt tune:ph] | PASS
#68006 [fiberglass+salt] fc=5,cc=0,ph=7.4,ta=60,cya=90,salt=3200,temp=85 :: H 3/6 score=67 warn csi=-0.54 | A[soon:fc tune:cya tune:ph tune:csi] | PASS
#68041 [fiberglass+salt] fc=5,cc=0,ph=7.4,ta=100,cya=20,salt=2500,temp=85 :: H 2/6 score=63 bad csi=-0.05 | A[soon:cya soon:salt tune:ph tune:ta] | PASS
#68076 [fiberglass+salt] fc=5,cc=0.6,ph=7.4,ta=130,cya=20,salt=3700,temp=85 :: H 1/6 score=42 bad csi=0.02 | A[now:cc soon:cya soon:ta soon:salt tune:ph] | PASS
#68111 [fiberglass+salt] fc=5,cc=0.6,ph=7.6,ta=40,cya=40,salt=3200,temp=85 :: H 3/6 score=54 bad csi=-0.42 | A[now:cc soon:cya soon:ta tune:csi] | PASS
#68146 [fiberglass+salt] fc=5,cc=0.6,ph=7.6,ta=60,cya=50,salt=2500,temp=85 :: H 3/6 score=58 bad csi=-0.18 | A[now:cc soon:cya soon:salt] | PASS
#68181 [fiberglass+salt] fc=5,cc=0,ph=7.6,ta=80,cya=70,salt=3700,temp=85 :: H 5/6 score=92 bad csi=-0.12 | A[soon:salt] | PASS
#68216 [fiberglass+salt] fc=5,cc=0,ph=7.6,ta=100,cya=90,salt=3200,temp=85 :: H 3/6 score=75 warn csi=-0.01 | A[soon:fc tune:cya tune:ta] | PASS
#68251 [fiberglass+salt] fc=5,cc=0,ph=7.8,ta=40,cya=20,salt=2500,temp=85 :: H 3/6 score=67 bad csi=-0.1 | A[soon:cya soon:ta soon:salt] | PASS
#68286 [fiberglass+salt] fc=5,cc=0.6,ph=7.8,ta=60,cya=20,salt=3700,temp=85 :: H 3/6 score=58 bad csi=0.05 | A[now:cc soon:cya soon:salt] | PASS
#68321 [fiberglass+salt] fc=5,cc=0.6,ph=7.8,ta=80,cya=40,salt=3200,temp=85 :: H 4/6 score=67 bad csi=0.17 | A[now:cc soon:cya] | PASS
#68356 [fiberglass+salt] fc=5,cc=0.6,ph=7.8,ta=100,cya=50,salt=2500,temp=85 :: H 2/6 score=54 bad csi=0.3 | A[now:cc soon:cya soon:salt tune:ta] | PASS
#68391 [fiberglass+salt] fc=5,cc=0,ph=7.8,ta=130,cya=70,salt=3700,temp=85 :: H 4/6 score=79 bad csi=0.35 | A[soon:ta soon:salt tune:csi] | PASS
#68426 [fiberglass+salt] fc=5,cc=0,ph=8,ta=40,cya=90,salt=3200,temp=85 :: H 2/6 score=58 bad csi=-0.59 | A[soon:fc soon:ph soon:ta tune:cya tune:csi] | PASS
#68461 [fiberglass+salt] fc=5,cc=0,ph=8,ta=80,cya=20,salt=2500,temp=85 :: H 3/6 score=63 bad csi=0.44 | A[soon:cya soon:ph soon:salt tune:csi] | PASS
#68496 [fiberglass+salt] fc=5,cc=0.6,ph=8,ta=100,cya=20,salt=3700,temp=85 :: H 1/6 score=42 bad csi=0.49 | A[now:cc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#68531 [fiberglass+salt] fc=5,cc=0.6,ph=8,ta=130,cya=40,salt=3200,temp=85 :: H 2/6 score=42 bad csi=0.61 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#68566 [fiberglass+salt] fc=5,cc=0.6,ph=8.3,ta=40,cya=50,salt=2500,temp=85 :: H 1/6 score=33 bad csi=0.21 | A[now:cc soon:cya soon:ph soon:ta soon:salt] | PASS
#68601 [fiberglass+salt] fc=5,cc=0,ph=8.3,ta=60,cya=70,salt=3700,temp=85 :: H 4/6 score=71 bad csi=0.35 | A[soon:ph soon:salt tune:csi] | PASS
#68636 [fiberglass+salt] fc=5,cc=0,ph=8.3,ta=80,cya=90,salt=3200,temp=85 :: H 3/6 score=58 bad csi=0.51 | A[soon:fc soon:ph tune:cya tune:csi] | PASS
#68671 [fiberglass+salt] fc=5,cc=0,ph=8.3,ta=130,cya=20,salt=2500,temp=85 :: H 2/6 score=42 bad csi=0.97 | A[soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#68706 [fiberglass+salt] fc=8,cc=0.6,ph=7,ta=40,cya=20,salt=3700,temp=85 :: H 1/6 score=25 bad csi=-0.92 | A[now:cc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#68741 [fiberglass+salt] fc=8,cc=0.6,ph=7,ta=60,cya=40,salt=3200,temp=85 :: H 3/6 score=42 bad csi=-0.75 | A[now:cc soon:cya soon:ph soon:csi] | PASS
#68776 [fiberglass+salt] fc=8,cc=0.6,ph=7,ta=80,cya=50,salt=2500,temp=85 :: H 2/6 score=38 bad csi=-0.58 | A[now:cc soon:cya soon:ph soon:salt tune:csi] | PASS
#68811 [fiberglass+salt] fc=8,cc=0,ph=7,ta=100,cya=70,salt=3700,temp=85 :: H 3/6 score=67 bad csi=-0.55 | A[soon:ph soon:salt tune:ta tune:csi] | PASS
#68846 [fiberglass+salt] fc=8,cc=0,ph=7,ta=130,cya=90,salt=3200,temp=85 :: H 3/6 score=63 bad csi=-0.42 | A[soon:ph soon:ta tune:cya tune:csi] | PASS
#68881 [fiberglass+salt] fc=8,cc=0,ph=7.4,ta=60,cya=20,salt=2500,temp=85 :: H 3/6 score=67 bad csi=-0.29 | A[soon:cya soon:salt tune:ph] | PASS
#68916 [fiberglass+salt] fc=8,cc=0.6,ph=7.4,ta=80,cya=20,salt=3700,temp=85 :: H 2/6 score=50 bad csi=-0.21 | A[now:cc soon:cya soon:salt tune:ph] | PASS
#68951 [fiberglass+salt] fc=8,cc=0.6,ph=7.4,ta=100,cya=40,salt=3200,temp=85 :: H 2/6 score=54 bad csi=-0.11 | A[now:cc soon:cya tune:ph tune:ta] | PASS
#68986 [fiberglass+salt] fc=8,cc=0.6,ph=7.4,ta=130,cya=50,salt=2500,temp=85 :: H 1/6 score=42 bad csi=0.04 | A[now:cc soon:cya soon:ta soon:salt tune:ph] | PASS
#69021 [fiberglass+salt] fc=8,cc=0,ph=7.6,ta=40,cya=70,salt=3700,temp=85 :: H 4/6 score=75 bad csi=-0.65 | A[soon:ta soon:csi soon:salt] | PASS
#69056 [fiberglass+salt] fc=8,cc=0,ph=7.6,ta=60,cya=90,salt=3200,temp=85 :: H 5/6 score=88 warn csi=-0.37 | A[tune:cya tune:csi] | PASS
#69091 [fiberglass+salt] fc=8,cc=0,ph=7.6,ta=100,cya=20,salt=2500,temp=85 :: H 3/6 score=71 bad csi=0.15 | A[soon:cya soon:salt tune:ta] | PASS
#69126 [fiberglass+salt] fc=8,cc=0.6,ph=7.6,ta=130,cya=20,salt=3700,temp=85 :: H 2/6 score=50 bad csi=0.21 | A[now:cc soon:cya soon:ta soon:salt] | PASS
#69161 [fiberglass+salt] fc=8,cc=0.6,ph=7.8,ta=40,cya=40,salt=3200,temp=85 :: H 3/6 score=58 bad csi=-0.24 | A[now:cc soon:cya soon:ta] | PASS
#69196 [fiberglass+salt] fc=8,cc=0.6,ph=7.8,ta=60,cya=50,salt=2500,temp=85 :: H 3/6 score=58 bad csi=0.01 | A[now:cc soon:cya soon:salt] | PASS
#69231 [fiberglass+salt] fc=8,cc=0,ph=7.8,ta=80,cya=70,salt=3700,temp=85 :: H 5/6 score=92 bad csi=0.07 | A[soon:salt] | PASS
#69266 [fiberglass+salt] fc=8,cc=0,ph=7.8,ta=100,cya=90,salt=3200,temp=85 :: H 4/6 score=88 warn csi=0.18 | A[tune:cya tune:ta] | PASS
#69301 [fiberglass+salt] fc=8,cc=0,ph=8,ta=40,cya=20,salt=2500,temp=85 :: H 2/6 score=58 bad csi=0.1 | A[soon:cya soon:ph soon:ta soon:salt] | PASS
#69336 [fiberglass+salt] fc=8,cc=0.6,ph=8,ta=60,cya=20,salt=3700,temp=85 :: H 2/6 score=50 bad csi=0.25 | A[now:cc soon:cya soon:ph soon:salt] | PASS
#69371 [fiberglass+salt] fc=8,cc=0.6,ph=8,ta=80,cya=40,salt=3200,temp=85 :: H 3/6 score=54 bad csi=0.36 | A[now:cc soon:cya soon:ph tune:csi] | PASS
#69406 [fiberglass+salt] fc=8,cc=0.6,ph=8,ta=100,cya=50,salt=2500,temp=85 :: H 1/6 score=42 bad csi=0.49 | A[now:cc soon:cya soon:ph soon:salt tune:ta tune:csi] | PASS
#69441 [fiberglass+salt] fc=8,cc=0,ph=8,ta=130,cya=70,salt=3700,temp=85 :: H 3/6 score=71 bad csi=0.54 | A[soon:ph soon:ta soon:salt tune:csi] | PASS
#69476 [fiberglass+salt] fc=8,cc=0,ph=8.3,ta=40,cya=90,salt=3200,temp=85 :: H 3/6 score=63 bad csi=-0.35 | A[soon:ph soon:ta tune:cya tune:csi] | PASS
#69511 [fiberglass+salt] fc=8,cc=0,ph=8.3,ta=80,cya=20,salt=2500,temp=85 :: H 3/6 score=50 bad csi=0.74 | A[soon:cya soon:ph soon:csi soon:salt] | PASS
#69546 [fiberglass+salt] fc=8,cc=0.6,ph=8.3,ta=100,cya=20,salt=3700,temp=85 :: H 1/6 score=29 bad csi=0.79 | A[now:cc soon:cya soon:ph soon:csi soon:salt tune:ta] | PASS
#69581 [fiberglass+salt] fc=8,cc=0.6,ph=8.3,ta=130,cya=40,salt=3200,temp=85 :: H 2/6 score=33 bad csi=0.91 | A[now:cc soon:cya soon:ph soon:ta soon:csi] | PASS
#69616 [fiberglass+salt] fc=12,cc=0.6,ph=7,ta=40,cya=50,salt=2500,temp=85 :: H 1/6 score=25 bad csi=-0.96 | A[now:cc soon:cya soon:ph soon:ta soon:csi soon:salt] | PASS
#69651 [fiberglass+salt] fc=12,cc=0,ph=7,ta=60,cya=70,salt=3700,temp=85 :: H 4/6 score=67 bad csi=-0.83 | A[soon:ph soon:csi soon:salt] | PASS
#69686 [fiberglass+salt] fc=12,cc=0,ph=7,ta=80,cya=90,salt=3200,temp=85 :: H 4/6 score=67 bad csi=-0.68 | A[soon:ph soon:csi tune:cya] | PASS
#69721 [fiberglass+salt] fc=12,cc=0,ph=7,ta=130,cya=20,salt=2500,temp=85 :: H 1/6 score=33 bad csi=-0.32 | A[soon:cya soon:ph soon:ta soon:salt tune:fc tune:csi] | PASS
#69756 [fiberglass+salt] fc=12,cc=0.6,ph=7.4,ta=40,cya=20,salt=3700,temp=85 :: H 0/6 score=25 bad csi=-0.54 | A[now:cc soon:cya soon:ta soon:salt tune:fc tune:ph tune:csi] | PASS
#69791 [fiberglass+salt] fc=12,cc=0.6,ph=7.4,ta=60,cya=40,salt=3200,temp=85 :: H 3/6 score=54 bad csi=-0.37 | A[now:cc soon:cya tune:ph tune:csi] | PASS
#69826 [fiberglass+salt] fc=12,cc=0.6,ph=7.4,ta=80,cya=50,salt=2500,temp=85 :: H 2/6 score=50 bad csi=-0.21 | A[now:cc soon:cya soon:salt tune:ph] | PASS
#69861 [fiberglass+salt] fc=12,cc=0,ph=7.4,ta=100,cya=70,salt=3700,temp=85 :: H 3/6 score=79 bad csi=-0.18 | A[soon:salt tune:ph tune:ta] | PASS
#69896 [fiberglass+salt] fc=12,cc=0,ph=7.4,ta=130,cya=90,salt=3200,temp=85 :: H 3/6 score=75 bad csi=-0.04 | A[soon:ta tune:cya tune:ph] | PASS
#69931 [fiberglass+salt] fc=12,cc=0,ph=7.6,ta=60,cya=20,salt=2500,temp=85 :: H 3/6 score=63 bad csi=-0.09 | A[soon:cya soon:salt tune:fc] | PASS
#69966 [fiberglass+salt] fc=12,cc=0.6,ph=7.6,ta=80,cya=20,salt=3700,temp=85 :: H 2/6 score=46 bad csi=-0.01 | A[now:cc soon:cya soon:salt tune:fc] | PASS
#70001 [fiberglass+salt] fc=12,cc=0.6,ph=7.6,ta=100,cya=40,salt=3200,temp=85 :: H 3/6 score=63 bad csi=0.08 | A[now:cc soon:cya tune:ta] | PASS
#70036 [fiberglass+salt] fc=12,cc=0.6,ph=7.6,ta=130,cya=50,salt=2500,temp=85 :: H 2/6 score=50 bad csi=0.23 | A[now:cc soon:cya soon:ta soon:salt] | PASS
#70071 [fiberglass+salt] fc=12,cc=0,ph=7.8,ta=40,cya=70,salt=3700,temp=85 :: H 4/6 score=79 bad csi=-0.48 | A[soon:ta soon:salt tune:csi] | PASS
#70106 [fiberglass+salt] fc=12,cc=0,ph=7.8,ta=60,cya=90,salt=3200,temp=85 :: H 5/6 score=92 warn csi=-0.2 | A[tune:cya] | PASS
#70141 [fiberglass+salt] fc=12,cc=0,ph=7.8,ta=100,cya=20,salt=2500,temp=85 :: H 2/6 score=54 bad csi=0.35 | A[soon:cya soon:salt tune:fc tune:ta tune:csi] | PASS
#70176 [fiberglass+salt] fc=12,cc=0.6,ph=7.8,ta=130,cya=20,salt=3700,temp=85 :: H 1/6 score=33 bad csi=0.41 | A[now:cc soon:cya soon:ta soon:salt tune:fc tune:csi] | PASS
#70211 [fiberglass+salt] fc=12,cc=0.6,ph=8,ta=40,cya=40,salt=3200,temp=85 :: H 2/6 score=50 bad csi=-0.04 | A[now:cc soon:cya soon:ta tune:ph] | PASS
#70246 [fiberglass+salt] fc=12,cc=0.6,ph=8,ta=60,cya=50,salt=2500,temp=85 :: H 2/6 score=50 bad csi=0.2 | A[now:cc soon:cya soon:salt tune:ph] | PASS
#70281 [fiberglass+salt] fc=12,cc=0,ph=8,ta=80,cya=70,salt=3700,temp=85 :: H 4/6 score=83 bad csi=0.26 | A[soon:salt tune:ph] | PASS
#70316 [fiberglass+salt] fc=12,cc=0,ph=8,ta=100,cya=90,salt=3200,temp=85 :: H 3/6 score=75 warn csi=0.37 | A[tune:cya tune:ph tune:ta tune:csi] | PASS
#70351 [fiberglass+salt] fc=12,cc=0,ph=8.3,ta=40,cya=20,salt=2500,temp=85 :: H 1/6 score=33 bad csi=0.4 | A[soon:cya soon:ta soon:salt tune:fc tune:ph tune:csi] | PASS
#70386 [fiberglass+salt] fc=12,cc=0.6,ph=8.3,ta=60,cya=20,salt=3700,temp=85 :: H 1/6 score=25 bad csi=0.55 | A[now:cc soon:cya soon:salt tune:fc tune:ph tune:csi] | PASS
#70421 [fiberglass+salt] fc=12,cc=0.6,ph=8.3,ta=80,cya=40,salt=3200,temp=85 :: H 3/6 score=42 bad csi=0.66 | A[now:cc soon:cya soon:csi tune:ph] | PASS
#70456 [fiberglass+salt] fc=12,cc=0.6,ph=8.3,ta=100,cya=50,salt=2500,temp=85 :: H 1/6 score=29 bad csi=0.79 | A[now:cc soon:cya soon:csi soon:salt tune:ph tune:ta] | PASS
#70491 [fiberglass+salt] fc=12,cc=0,ph=8.3,ta=130,cya=70,salt=3700,temp=85 :: H 3/6 score=58 bad csi=0.84 | A[soon:ta soon:csi soon:salt tune:ph] | PASS
#70526 [fiberglass+salt] fc=25,cc=0,ph=7,ta=40,cya=90,salt=3200,temp=85 :: H 3/6 score=58 bad csi=-1.17 | A[soon:ph soon:ta soon:csi tune:cya] | PASS
#70561 [fiberglass+salt] fc=25,cc=0,ph=7,ta=80,cya=20,salt=2500,temp=85 :: H 2/6 score=42 bad csi=-0.54 | A[soon:cya soon:ph soon:salt tune:fc tune:csi] | PASS
#70596 [fiberglass+salt] fc=25,cc=0.6,ph=7,ta=100,cya=20,salt=3700,temp=85 :: H 0/6 score=21 bad csi=-0.5 | A[now:cc soon:cya soon:ph soon:salt tune:fc tune:ta tune:csi] | PASS
#70631 [fiberglass+salt] fc=25,cc=0.6,ph=7,ta=130,cya=40,salt=3200,temp=85 :: H 1/6 score=25 bad csi=-0.37 | A[now:cc soon:cya soon:ph soon:ta tune:fc tune:csi] | PASS
#70666 [fiberglass+salt] fc=25,cc=0.6,ph=7.4,ta=40,cya=50,salt=2500,temp=85 :: H 0/6 score=21 bad csi=-0.62 | A[now:cc soon:cya soon:ta soon:csi soon:salt tune:fc tune:ph] | PASS
#70701 [fiberglass+salt] fc=25,cc=0,ph=7.4,ta=60,cya=70,salt=3700,temp=85 :: H 4/6 score=79 bad csi=-0.49 | A[soon:salt tune:ph tune:csi] | PASS
#70736 [fiberglass+salt] fc=25,cc=0,ph=7.4,ta=80,cya=90,salt=3200,temp=85 :: H 4/6 score=79 warn csi=-0.33 | A[tune:cya tune:ph tune:csi] | PASS
#70771 [fiberglass+salt] fc=25,cc=0,ph=7.4,ta=130,cya=20,salt=2500,temp=85 :: H 1/6 score=46 bad csi=0.07 | A[soon:cya soon:ta soon:salt tune:fc tune:ph] | PASS
#70806 [fiberglass+salt] fc=25,cc=0.6,ph=7.6,ta=40,cya=20,salt=3700,temp=85 :: H 1/6 score=33 bad csi=-0.35 | A[now:cc soon:cya soon:ta soon:salt tune:fc tune:csi] | PASS
#70841 [fiberglass+salt] fc=25,cc=0.6,ph=7.6,ta=60,cya=40,salt=3200,temp=85 :: H 3/6 score=54 bad csi=-0.18 | A[now:cc soon:cya tune:fc] | PASS
#70876 [fiberglass+salt] fc=25,cc=0.6,ph=7.6,ta=80,cya=50,salt=2500,temp=85 :: H 2/6 score=46 bad csi=-0.02 | A[now:cc soon:cya soon:salt tune:fc] | PASS
#70911 [fiberglass+salt] fc=25,cc=0,ph=7.6,ta=100,cya=70,salt=3700,temp=85 :: H 4/6 score=88 bad csi=0.01 | A[soon:salt tune:ta] | PASS
#70946 [fiberglass+salt] fc=25,cc=0,ph=7.6,ta=130,cya=90,salt=3200,temp=85 :: H 4/6 score=83 bad csi=0.15 | A[soon:ta tune:cya] | PASS
#70981 [fiberglass+salt] fc=25,cc=0,ph=7.8,ta=60,cya=20,salt=2500,temp=85 :: H 3/6 score=63 bad csi=0.11 | A[soon:cya soon:salt tune:fc] | PASS
#71016 [fiberglass+salt] fc=25,cc=0.6,ph=7.8,ta=80,cya=20,salt=3700,temp=85 :: H 2/6 score=46 bad csi=0.19 | A[now:cc soon:cya soon:salt tune:fc] | PASS
#71051 [fiberglass+salt] fc=25,cc=0.6,ph=7.8,ta=100,cya=40,salt=3200,temp=85 :: H 2/6 score=50 bad csi=0.28 | A[now:cc soon:cya tune:fc tune:ta] | PASS
#71086 [fiberglass+salt] fc=25,cc=0.6,ph=7.8,ta=130,cya=50,salt=2500,temp=85 :: H 1/6 score=33 bad csi=0.43 | A[now:cc soon:cya soon:ta soon:salt tune:fc tune:csi] | PASS
#71121 [fiberglass+salt] fc=25,cc=0,ph=8,ta=40,cya=70,salt=3700,temp=85 :: H 3/6 score=71 bad csi=-0.31 | A[soon:ta soon:salt tune:ph tune:csi] | PASS
#71156 [fiberglass+salt] fc=25,cc=0,ph=8,ta=60,cya=90,salt=3200,temp=85 :: H 4/6 score=83 warn csi=-0.02 | A[tune:cya tune:ph] | PASS
#71191 [fiberglass+salt] fc=25,cc=0,ph=8,ta=100,cya=20,salt=2500,temp=85 :: H 1/6 score=46 bad csi=0.55 | A[soon:cya soon:salt tune:fc tune:ph tune:ta tune:csi] | PASS
#71226 [fiberglass+salt] fc=25,cc=0.6,ph=8,ta=130,cya=20,salt=3700,temp=85 :: H 0/6 score=21 bad csi=0.61 | A[now:cc soon:cya soon:ta soon:csi soon:salt tune:fc tune:ph] | PASS
#71261 [fiberglass+salt] fc=25,cc=0.6,ph=8.3,ta=40,cya=40,salt=3200,temp=85 :: H 1/6 score=29 bad csi=0.25 | A[now:cc soon:cya soon:ta tune:fc tune:ph] | PASS
#71296 [fiberglass+salt] fc=25,cc=0.6,ph=8.3,ta=60,cya=50,salt=2500,temp=85 :: H 1/6 score=25 bad csi=0.5 | A[now:cc soon:cya soon:salt tune:fc tune:ph tune:csi] | PASS
#71331 [fiberglass+salt] fc=25,cc=0,ph=8.3,ta=80,cya=70,salt=3700,temp=85 :: H 4/6 score=71 bad csi=0.56 | A[soon:salt tune:ph tune:csi] | PASS
#71366 [fiberglass+salt] fc=25,cc=0,ph=8.3,ta=100,cya=90,salt=3200,temp=85 :: H 3/6 score=63 bad csi=0.67 | A[soon:csi tune:cya tune:ph tune:ta] | PASS
```

## Appendix C — per-persona browser route checks (56, one per line)

```
[perfect] dashboard :: PASS — view-dashboard 42517c
[perfect] log :: PASS — view-log 23476c
[perfect] plan :: PASS — view-plan 6689c
[perfect] calculators :: PASS — view-calculators 14861c
[perfect] chem :: PASS — view-chem 12407c
[perfect] learn :: PASS — view-learn 70974c
[perfect] slam :: PASS — view-slam 12987c
[perfect] account :: PASS — view-account 1155c
[tune-only] dashboard :: PASS — view-dashboard 51514c
[tune-only] log :: PASS — view-log 24564c
[tune-only] plan :: PASS — view-plan 10656c
[tune-only] calculators :: PASS — view-calculators 17651c
[tune-only] chem :: PASS — view-chem 12408c
[tune-only] learn :: PASS — view-learn 70974c
[tune-only] slam :: PASS — view-slam 12987c
[tune-only] account :: PASS — view-account 1155c
[messy] dashboard :: PASS — view-dashboard 63724c
[messy] log :: PASS — view-log 26473c
[messy] plan :: PASS — view-plan 23700c
[messy] calculators :: PASS — view-calculators 17375c
[messy] chem :: PASS — view-chem 12408c
[messy] learn :: PASS — view-learn 70974c
[messy] slam :: PASS — view-slam 12989c
[messy] account :: PASS — view-account 1155c
[ph-high] dashboard :: PASS — view-dashboard 46465c
[ph-high] log :: PASS — view-log 24107c
[ph-high] plan :: PASS — view-plan 10234c
[ph-high] calculators :: PASS — view-calculators 16836c
[ph-high] chem :: PASS — view-chem 12407c
[ph-high] learn :: PASS — view-learn 70974c
[ph-high] slam :: PASS — view-slam 12987c
[ph-high] account :: PASS — view-account 1155c
[salt-low] dashboard :: PASS — view-dashboard 47175c
[salt-low] log :: PASS — view-log 26235c
[salt-low] plan :: PASS — view-plan 8273c
[salt-low] calculators :: PASS — view-calculators 16780c
[salt-low] chem :: PASS — view-chem 12407c
[salt-low] learn :: PASS — view-learn 70974c
[salt-low] slam :: PASS — view-slam 12989c
[salt-low] account :: PASS — view-account 1155c
[vinyl] dashboard :: PASS — view-dashboard 41380c
[vinyl] log :: PASS — view-log 22590c
[vinyl] plan :: PASS — view-plan 6689c
[vinyl] calculators :: PASS — view-calculators 14861c
[vinyl] chem :: PASS — view-chem 12407c
[vinyl] learn :: PASS — view-learn 70974c
[vinyl] slam :: PASS — view-slam 12989c
[vinyl] account :: PASS — view-account 1155c
[fresh] dashboard :: PASS — view-dashboard 34177c
[fresh] log :: PASS — view-log 17997c
[fresh] plan :: PASS — view-plan 7304c
[fresh] calculators :: PASS — view-calculators 16820c
[fresh] chem :: PASS — view-chem 12230c
[fresh] learn :: PASS — view-learn 70974c
[fresh] slam :: PASS — view-slam 12996c
[fresh] account :: PASS — view-account 1155c
```
