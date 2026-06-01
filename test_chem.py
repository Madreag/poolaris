#!/usr/bin/env python3
"""
Golden cross-check: chem.py (server) MUST agree with js/calc.js + js/insights.js (browser).

Runs a battery of inputs through BOTH engines and asserts the numbers match. This is
the contract that lets the 24/7 engine and the live app show the same chemistry. If
this fails, the two engines have drifted and one of them is lying to the user.

Run:  python test_chem.py     (requires node on PATH for the JS side)
"""

import json
import subprocess
import sys
import os

import chem

HERE = os.path.dirname(os.path.abspath(__file__))

# A JS shim that loads the real engine files and emits results for the same cases.
JS = r"""
const fs = require("fs"), path = require("path");
global.window = global;
function load(f){ eval(fs.readFileSync(path.join(process.argv[1], f), "utf8")); }
["js/data.js","js/calc.js","js/insights.js"].forEach(load);
const C = global.CALC, IN = global.INSIGHTS;
const cases = JSON.parse(process.argv[2]);
const out = {};
// fc targets across CYA, non-SWG and SWG
out.fcTargets = {};
cases.cya.forEach(cya => {
  out.fcTargets["n"+cya] = (function(){ const t=C.fcTargets(cya,false); return [t.min,t.targetLo,t.targetHi,t.slam]; })();
  out.fcTargets["s"+cya] = (function(){ const t=C.fcTargets(cya,true); return [t.min,t.targetLo,t.targetHi,t.slam]; })();
});
// CSI across readings
out.csi = cases.csi.map(c => C.csi(c.r, c.temp));
// effectiveReading carry-forward
out.eff = (function(){ const e = IN.effectiveReading(cases.log, cases.seed); return e; })();
// fcBurn (naive)
out.burn = (function(){ const b = IN.fcBurn(cases.log); return b.rate; })();
// fcBurn (dose-aware)
out.burnDosed = (function(){ const b = IN.fcBurn(cases.burnLog, cases.burnDoses); return b.rate; })();
// expectedBurn
out.expBurn = cases.expBurn.map(c => {
  // replicate insights.expectedBurn via a tiny copy is not exposed; use detect-free path:
  // expectedBurn isn't exported, so compute via the documented formula through a known proxy:
  return null;
});
process.stdout.write(JSON.stringify(out));
"""

CASES = {
    "cya": [20, 30, 35, 40, 50, 60, 70, 80, 90, 100, 120],
    "csi": [
        {"r": {"ph": 7.5, "ta": 70, "ch": 350, "cya": 50, "salt": 1000}, "temp": 80},
        {"r": {"ph": 7.6, "ta": 90, "ch": 400, "cya": 60}, "temp": 85},
        {"r": {"ph": 8.0, "ta": 110, "ch": 250, "cya": 30}, "temp": 95},
        {"r": {"ph": 7.2, "ta": 50, "ch": 200, "cya": 40, "borate": 50}, "temp": 60},
    ],
    "log": [
        {"t": 1_000_000_000_000, "reading": {"fc": 8, "cya": 50, "ph": 7.6, "ta": 90}},
        {"t": 1_000_000_000_000 + 86_400_000, "reading": {"fc": 5.5, "ph": 7.7}},
        {"t": 1_000_000_000_000 + 2 * 86_400_000, "reading": {"fc": 3.0, "ch": 380}},
    ],
    "seed": {"cya": 40},
    "expBurn": [],
    # dose-aware burn: FC 8->4 over 1 day with a +3 chlorine dose between → true burn 7/day
    "burnLog": [
        {"t": 1_700_000_000_000, "reading": {"fc": 8, "cya": 50}},
        {"t": 1_700_000_000_000 + 86_400_000, "reading": {"fc": 4, "cya": 50}},
    ],
    "burnDoses": [
        {"t": 1_700_000_000_000 + 43_200_000, "chem": "chlorine", "deltas": {"fc": 3}}
    ],
}

fails = []


def chk(name, a, b, tol=0.01):
    ok = (a is None and b is None) or (
        a is not None and b is not None and abs(a - b) <= tol
    )
    print(("PASS " if ok else "FAIL ") + name + ("" if ok else f"  [py={a} js={b}]"))
    if not ok:
        fails.append(name)


def main():
    proc = subprocess.run(
        ["node", "-e", JS, HERE, json.dumps(CASES)],
        capture_output=True,
        text=True,
    )
    if proc.returncode != 0:
        print("JS engine failed to run:\n", proc.stderr)
        sys.exit(2)
    js = json.loads(proc.stdout)

    # --- FC targets ---
    for cya in CASES["cya"]:
        pt = chem.fc_targets(cya, False)
        jt = js["fcTargets"]["n" + str(cya)]
        chk(f"fcTargets non-SWG cya={cya} min", pt["min"], jt[0])
        chk(f"fcTargets non-SWG cya={cya} targetLo", pt["targetLo"], jt[1])
        chk(f"fcTargets non-SWG cya={cya} targetHi", pt["targetHi"], jt[2])
        chk(f"fcTargets non-SWG cya={cya} slam", pt["slam"], jt[3])
        ps = chem.fc_targets(cya, True)
        jss = js["fcTargets"]["s" + str(cya)]
        chk(f"fcTargets SWG cya={cya} slam", ps["slam"], jss[3])

    # --- CSI ---
    for i, c in enumerate(CASES["csi"]):
        chk(f"csi case {i}", chem.csi(c["r"], c["temp"]), js["csi"][i], tol=0.01)

    # --- effectiveReading ---
    eff = chem.effective_reading(CASES["log"], CASES["seed"])
    for k in ("fc", "cya", "ph", "ta", "ch"):
        chk(f"effectiveReading {k}", eff.get(k), js["eff"].get(k))

    # --- fcBurn ---
    chk("fcBurn rate", chem.fc_burn(CASES["log"])["rate"], js["burn"], tol=0.01)
    chk(
        "fcBurn dose-aware rate",
        chem.fc_burn(CASES["burnLog"], CASES["burnDoses"])["rate"],
        js["burnDosed"],
        tol=0.01,
    )

    print(
        "\n"
        + (
            "ALL GOLDEN CROSS-CHECKS PASSED"
            if not fails
            else f"{len(fails)} MISMATCH(ES): {fails}"
        )
    )
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
