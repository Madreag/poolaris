#!/usr/bin/env python3
"""
Poolaris — server-side chemistry mirror (pure stdlib).

A faithful Python port of the parts of js/calc.js + js/insights.js that the
always-on engine (engine.py) needs to evaluate pools 24/7: FC/CYA targets,
the carry-forward "effective reading", FC burn-rate estimation, time-to-minimum
forecasting, and CSI. test_chem.py asserts these agree with the JS engine so the
server and the browser can never show different numbers.

KEEP IN SYNC with js/calc.js / js/insights.js. Any chemistry change updates both.
"""

import math

DAY_MS = 86_400_000

# ---- FC/CYA chart (mirror of data.js FC_CYA_NONSWG / FC_CYA_SWG) -------------
FC_CYA_NONSWG = {
    20: {"min": 2, "target": [3, 5], "slam": 10},
    30: {"min": 2, "target": [4, 6], "slam": 12},
    40: {"min": 3, "target": [5, 7], "slam": 16},
    50: {"min": 4, "target": [6, 8], "slam": 20},
    60: {"min": 5, "target": [7, 9], "slam": 24},
    70: {"min": 5, "target": [8, 10], "slam": 28},
    80: {"min": 6, "target": [9, 11], "slam": 31},
    90: {"min": 7, "target": [10, 12], "slam": 35},
    100: {"min": 8, "target": [11, 13], "slam": 39},
}
FC_CYA_SWG = {
    20: {"min": 2, "target": [3, 5], "slam": 10},
    30: {"min": 2, "target": [3, 6], "slam": 12},
    40: {"min": 2, "target": [3, 7], "slam": 16},
    50: {"min": 2, "target": [3, 8], "slam": 20},
    60: {"min": 3, "target": [4, 9], "slam": 24},
    70: {"min": 3, "target": [5, 10], "slam": 28},
    80: {"min": 4, "target": [6, 11], "slam": 31},
    90: {"min": 4, "target": [6, 12], "slam": 35},
    100: {"min": 5, "target": [7, 13], "slam": 39},
}
SLAM_PCT = 0.40

RKEYS = ["fc", "cc", "ph", "ta", "ch", "cya", "salt", "temp", "borate"]


def _interp(chart, cya):
    keys = sorted(chart.keys())
    if cya <= keys[0]:
        return chart[keys[0]]
    if cya >= keys[-1]:
        top = chart[keys[-1]]
        return {
            "min": top["min"],
            "target": top["target"],
            "slam": round(cya * SLAM_PCT),
        }
    lo, hi = keys[0], keys[-1]
    for i in range(len(keys) - 1):
        if keys[i] <= cya <= keys[i + 1]:
            lo, hi = keys[i], keys[i + 1]
            break
    f = (cya - lo) / (hi - lo)
    L, H = chart[lo], chart[hi]

    def lerp(x, y):
        return round((x + (y - x) * f) * 10) / 10

    return {
        "min": lerp(L["min"], H["min"]),
        "target": [
            lerp(L["target"][0], H["target"][0]),
            lerp(L["target"][1], H["target"][1]),
        ],
        "slam": lerp(L["slam"], H["slam"]),
    }


def fc_targets(cya, is_swg=False):
    cya = float(cya or 0)
    chart = FC_CYA_SWG if is_swg else FC_CYA_NONSWG
    r = _interp(chart, cya)
    return {
        "min": r["min"],
        "targetLo": r["target"][0],
        "targetHi": r["target"][1],
        "target": round(((r["target"][0] + r["target"][1]) / 2) * 10) / 10,
        "slam": round(r["slam"]),
    }


def effective_reading(log, seed=None):
    """Carry-forward: freshest non-null value of each parameter (mirror of insights.js)."""
    eff, at = {}, {}
    if seed:
        for k in RKEYS:
            v = seed.get(k)
            if v is not None:
                try:
                    eff[k] = float(v)
                    at[k] = -math.inf
                except (TypeError, ValueError):
                    pass
    for e in log or []:
        r = (e or {}).get("reading")
        if not isinstance(r, dict):
            continue
        t = e.get("t") if e.get("t") is not None else 0
        for k in RKEYS:
            v = r.get(k)
            if v is None:
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if at.get(k) is None or t >= at[k]:
                eff[k] = fv
                at[k] = t
    return eff


def expected_burn(profile, reading):
    """Daily FC burn baseline for water temp & climate (mirror of insights.js expectedBurn)."""
    t = None
    if reading and reading.get("temp") is not None:
        t = reading["temp"]
    elif profile and profile.get("tempF") is not None:
        t = profile["tempF"]
    else:
        t = 80
    if t < 60:
        base = 0.75
    elif t < 75:
        base = 1.2
    elif t < 85:
        base = 2.0
    elif t < 95:
        base = 3.5
    else:
        base = 4.5
    climate = (profile or {}).get("climate")
    if climate == "desert":
        base *= 1.6
    elif climate == "hot":
        base *= 1.25
    return base


def _fc_series(log):
    pts = []
    for e in log or []:
        r = (e or {}).get("reading") or {}
        v = r.get("fc")
        if v is None:
            continue
        try:
            pts.append({"t": e.get("t") or 0, "v": float(v)})
        except (TypeError, ValueError):
            continue
    pts.sort(key=lambda p: p["t"])
    return pts


def fc_burn(log, doses=None):
    """Median daily FC burn (mirror of insights.js fcBurn). DOSE-AWARE: chlorine added
    between two tests is added back so a top-up can't mask the true demand."""
    pts = _fc_series(log)
    samples = []

    def fc_added_between(t_a, t_b):
        if not doses:
            return 0.0
        add = 0.0
        for d in doses:
            t = d.get("t") if d.get("t") is not None else 0
            dl = d.get("deltas") or {}
            if t_a <= t < t_b and dl.get("fc", 0) > 0:
                add += dl["fc"]
        return add

    for i in range(1, len(pts)):
        gap = (pts[i]["t"] - pts[i - 1]["t"]) / DAY_MS
        added = fc_added_between(pts[i - 1]["t"], pts[i]["t"])
        burned = (pts[i - 1]["v"] + added) - pts[i]["v"]
        if burned > 0 and 0.12 <= gap <= 7:
            samples.append(burned / gap)
    if not samples:
        return {"rate": None, "n": 0}
    samples.sort()
    return {"rate": samples[len(samples) // 2], "n": len(samples)}


def days_to_min(eff, burn_rate, targets):
    """Days until FC reaches its CYA-based minimum at the current burn rate."""
    fc = eff.get("fc")
    if fc is None or not burn_rate or burn_rate <= 0:
        return None
    if fc <= targets["min"]:
        return 0
    return (fc - targets["min"]) / burn_rate


def csi(r, temp_f=None):
    """Calcite Saturation Index — exact PoolMath master formula (mirror of calc.js csi)."""
    if r.get("ph") is None or r.get("ch") is None or r.get("ta") is None:
        return None
    temp_f = 82 if temp_f is None else temp_f
    ph = float(r["ph"])
    ch = float(r["ch"])
    ta = float(r["ta"])
    cya = float(r.get("cya") or 0)
    borate = float(r.get("borate") or 0)
    salt = float(r["salt"]) if r.get("salt") is not None else 1000.0
    carb_alk = max(
        1.0,
        ta
        - (0.38772 * cya) / (1 + 10 ** (6.83 - ph))
        - (4.63 * borate) / (1 + 10 ** (9.11 - ph)),
    )
    extra_nacl = max(0.0, salt - 1.1678 * ch)
    ion = (1.5 * ch + ta) / 50045 + extra_nacl / 58440
    s_i = math.sqrt(ion)
    tc = (temp_f - 32) * 5 / 9
    val = (
        ph
        - 11.677
        + math.log10(ch)
        + math.log10(carb_alk)
        - (2.56 * s_i) / (1 + 1.65 * s_i)
        - 1412.5 / (tc + 273.15)
        + 4.7375
    )
    return round(val * 100) / 100


def min_fc(cya):
    """Approximate TFP minimum FC (~7.5% of CYA, floored to 2)."""
    if not cya:
        return 2.0
    return max(2.0, round(0.075 * cya))
