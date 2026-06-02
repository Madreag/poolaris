#!/usr/bin/env python3
"""
Poolaris — always-on smart engine (pure stdlib).

A crash-isolated background daemon that re-evaluates EVERY pool on a schedule,
so the app is smart 24/7 — not only when a user types a value in the browser.
It forecasts FC depletion, flags overdue tests and stalled SLAMs, watches CSI
drift and rising CC, and writes deduplicated, snoozable alerts that the API
surfaces as a notification bell + Alert Center.

Design guarantees (per the overhaul roadmap):
  * Its OWN sqlite connection (WAL + busy_timeout) — never shares the HTTP
    handler's connection, so no "database is locked".
  * Every per-pool evaluation is wrapped in try/except — one bad pool can never
    crash the loop, and the loop can never crash the HTTP server.
  * Writes an engine_status heartbeat every cycle so a silently-dead engine is
    detectable (GET /api/engine/status).
  * Cooperative shutdown via a threading.Event, started/stopped from server.py.

Chemistry comes from chem.py, which test_chem.py proves matches js/calc.js.
"""

import json
import os
import threading
import hashlib
import traceback

import auth
import chem

DAY_MS = 86_400_000
HOUR_MS = 3_600_000

TICK_SECONDS = 900  # full sweep cadence (15 min); cheap, pools change slowly
MAX_ACTIVE_PER_POOL = 8  # cap alert noise per pool
WEATHER_ENABLED = os.environ.get("POOLARIS_WEATHER", "1") != "0"
WEATHER_TTL = (
    3 * HOUR_MS
)  # refresh a pool's forecast at most every 3h (1h if rain near)

# Alert kinds that are important enough to also auto-post into the pool's message thread
# (so a linked homeowner/company sees them even outside the app). Mirror of the JS taxonomy.
SYSTEM_MSG_KINDS = {
    "fc_zero": ("FC_ZERO", "urgent"),
    "wx_freeze": ("FREEZE", "urgent"),
    "wx_heat": ("HEAT", "watch"),
    "wx_rain": ("RAIN", "info"),
    "slam_stall": ("SLAM_STALL", "watch"),
}

# Overdue thresholds (days since last reading)
OVERDUE_WARN_DAYS = 4
OVERDUE_URGENT_DAYS = 7
OVERDUE_SLAM_DAYS = 1  # during a SLAM you should test constantly


# Which alert KINDS each user-declared activity silences. Mirror of the
# `suppressAlert` fields in js/activities.js — keep the two in sync. When the user
# tells the app "I'm aerating", the 24/7 engine must not fire a pH-out alert.
_ACTIVITY_SUPPRESS = {
    "aerating": {"ph_out"},
    "lowering-ph": {"ph_out"},
    "lowering-ta": {"ph_out", "csi_corrosive"},
    "away": {"overdue_test", "never_tested", "slam_stall"},
    "new-plaster": {"ph_out", "csi_scaling"},
    "party": {"cc_high"},
    "cover-on": set(),
    "draining": set(),
    "leak": set(),
    "refill": set(),
}


def _suppressed_kinds(profile):
    """Set of alert kinds to skip given the pool's active user activities."""
    out = set()
    acts = (profile or {}).get("activities") or {}
    for a in acts.get("active") or []:
        aid = a.get("id") if isinstance(a, dict) else a
        out |= _ACTIVITY_SUPPRESS.get(aid, set())
    return out


def _dedup(pool_id, kind, bucket=""):
    return hashlib.sha256(f"{pool_id}|{kind}|{bucket}".encode()).hexdigest()[:24]


def _alert(
    pool_id,
    kind,
    severity,
    title,
    detail,
    recommend,
    dedup_bucket="",
    metric=None,
    route=None,
    calc=None,
):
    return {
        "pool_id": pool_id,
        "kind": kind,
        "severity": severity,
        "title": title,
        "detail": detail,
        "recommend": recommend,
        "metric": metric,
        "route": route,
        "calc": calc,
        "dedup_hash": _dedup(pool_id, kind, dedup_bucket),
    }


# --------------------------------------------------------------------------- rules
def evaluate_pool(pool, log, now, wx=None, doses=None):
    """Pure function: given a pool row + its reading log (+ optional derived weather + dose
    ledger), return a list of alert dicts. No DB writes here — the caller persists/dedups.
    Mirrors the JS watch logic."""
    alerts = []
    profile = {}
    try:
        profile = json.loads(pool["profile_json"] or "{}")
    except Exception:
        profile = {}
    try:
        slam = json.loads(pool["slam_json"]) if pool["slam_json"] else None
    except Exception:
        slam = None

    swg = profile.get("sanitizer") == "salt"
    seed = profile.get("seedReading")
    eff = chem.effective_reading(log, seed)
    cya = eff.get("cya") if eff.get("cya") is not None else 40
    targets = chem.fc_targets(cya, swg)
    last_reading_at = max((e.get("t") or 0 for e in log), default=None) if log else None

    # ---- FC below minimum / zero (water-safety) ----
    fc = eff.get("fc")
    if fc is not None:
        if fc <= 0.5:
            alerts.append(
                _alert(
                    pool["id"],
                    "fc_zero",
                    "urgent",
                    "Chlorine is effectively zero",
                    f"Free chlorine is {round(fc, 1)} ppm — at or near zero, the water is unsanitized and algae/bacteria can take hold within hours.",
                    "Add chlorine now to reach your target, then re-test. If it won't hold, you may be heading into a SLAM.",
                    dedup_bucket="zero",
                    metric="fc",
                    route="calculators",
                    calc="chlorine",
                )
            )
        elif fc < targets["min"]:
            alerts.append(
                _alert(
                    pool["id"],
                    "fc_below_min",
                    "watch",
                    "Chlorine dropped below minimum",
                    f"FC is {round(fc, 1)} ppm but for CYA {round(cya)} it should stay above {targets['min']}. Below the minimum, algae can start even while the water looks clear.",
                    f"Dose chlorine up to the {targets['targetLo']}–{targets['targetHi']} target range.",
                    dedup_bucket="below",
                    metric="fc",
                    route="calculators",
                    calc="chlorine",
                )
            )

    # ---- FC depletion forecast (predict the go-below-minimum day) ----
    burn = chem.fc_burn(log, doses)
    rate = burn.get("rate")
    if rate and fc is not None and fc > targets["min"]:
        d = chem.days_to_min(eff, rate, targets)
        if d is not None and 0 < d <= 7:
            when = (
                "today"
                if d < 1
                else (f"in about {round(d)} day" + ("s" if round(d) != 1 else ""))
            )
            alerts.append(
                _alert(
                    pool["id"],
                    "fc_forecast",
                    "watch" if d < 2 else "info",
                    "Chlorine will run low soon",
                    f"At about {round(rate, 1)} ppm/day, your FC reaches its minimum ({targets['min']}) {when}.",
                    "Dose chlorine before then so it never dips below the safe minimum.",
                    dedup_bucket="fc",
                    metric="fc",
                    route="calculators",
                    calc="chlorine",
                )
            )

    # ---- CC rising / present (organics → SLAM early-warning) ----
    cc = eff.get("cc")
    if cc is not None and cc > 0.5:
        alerts.append(
            _alert(
                pool["id"],
                "cc_high",
                "watch" if cc >= 1 else "info",
                "Combined chlorine is present",
                f"CC is {round(cc, 1)} ppm (you want 0). That's spent chlorine — an early sign of organics or algae taking hold, and the cause of any 'chlorine smell'.",
                "Catch it early with a SLAM before it becomes a green pool.",
                dedup_bucket="cc",
                metric="cc",
                route="slam",
            )
        )

    # ---- pH high — needs acid (skip if a high FC is making the pH test read falsely high) ----
    ph = eff.get("ph")
    fc_for_ph = eff.get("fc")
    if ph is not None and ph > 7.8 and not (fc_for_ph is not None and fc_for_ph > 10):
        alerts.append(
            _alert(
                pool["id"],
                "ph_out",
                "watch" if ph >= 8.0 else "info",
                "pH is high — add acid",
                f"pH is {round(ph, 1)} (ideal 7.5-7.8). High pH dulls your chlorine and can cloud the water or scale surfaces.",
                "Add muriatic acid to bring pH to ~7.6 (the acid calculator sizes it), then re-test.",
                dedup_bucket="ph",
                metric="ph",
                route="calculators",
                calc="acid",
            )
        )

    # ---- overdue test ----
    if last_reading_at is None:
        alerts.append(
            _alert(
                pool["id"],
                "never_tested",
                "info",
                "No test logged yet",
                "Log your first water test so Poolaris can start guiding you to perfect water.",
                "Run an FC and pH test and log it.",
                dedup_bucket="never",
                route="log",
            )
        )
    else:
        days = (now - last_reading_at) / DAY_MS
        slam_active = bool(slam and isinstance(slam, dict) and slam.get("active"))
        if slam_active and days > OVERDUE_SLAM_DAYS:
            alerts.append(
                _alert(
                    pool["id"],
                    "slam_stall",
                    "watch",
                    "Your SLAM has stalled",
                    f"You're in a SLAM but haven't logged a test in {round(days)} days. A SLAM only works if you hold FC at shock level and re-test several times a day.",
                    "Test FC now, dose back up to SLAM level, and run the overnight test tonight.",
                    dedup_bucket="slam",
                    route="slam",
                )
            )
        elif days > OVERDUE_URGENT_DAYS:
            alerts.append(
                _alert(
                    pool["id"],
                    "overdue_test",
                    "watch",
                    "Time to test the water",
                    f"It's been about {round(days)} days since your last test. Chlorine and pH move fast — a week is plenty of time to drift out of range.",
                    "Run a quick FC & pH test and log it.",
                    dedup_bucket="overdue",
                    route="log",
                )
            )
        elif days > OVERDUE_WARN_DAYS:
            alerts.append(
                _alert(
                    pool["id"],
                    "overdue_test",
                    "info",
                    "A test is due soon",
                    f"About {round(days)} days since your last reading. Staying on a rhythm keeps surprises away.",
                    "Log a quick test when you get a chance.",
                    dedup_bucket="overdue",
                    route="log",
                )
            )

    # ---- CSI drift (scaling / corrosive) ----
    temp = eff.get("temp") if eff.get("temp") is not None else profile.get("tempF", 82)
    csi = chem.csi(eff, temp)
    surface = profile.get("surface")
    if csi is not None:
        if csi > 0.6 and surface in ("plaster", "pebble", "tile"):
            alerts.append(
                _alert(
                    pool["id"],
                    "csi_scaling",
                    "watch",
                    "Water is tending to scale",
                    f"Your CSI is +{csi} — over time that means cloudy water and crusty calcium deposits, especially on a plaster/tile surface.",
                    "Lower pH and/or TA to bring CSI toward zero.",
                    dedup_bucket="scale",
                    metric="csi",
                    route="calculators",
                    calc="csi",
                )
            )
        elif csi < -0.6:
            alerts.append(
                _alert(
                    pool["id"],
                    "csi_corrosive",
                    "watch",
                    "Water is aggressive (corrosive)",
                    f"Your CSI is {csi} — corrosive water etches plaster and dulls metal over time.",
                    "Nudge pH, TA, or calcium up to balance it.",
                    dedup_bucket="corrode",
                    metric="csi",
                    route="calculators",
                    calc="csi",
                )
            )

    # weather warnings (freeze/heat/rain/UV/wind) — computed server-side so they fire
    # 24/7 even when nobody has the app open. Each carries its own kind/severity.
    if wx:
        try:
            import weather as _wx

            for w in _wx.warnings(wx, profile, eff):
                alerts.append(
                    _alert(
                        pool["id"],
                        w["kind"],
                        w["severity"],
                        w["title"],
                        w["detail"],
                        w["recommend"],
                        dedup_bucket=w.get("dedup_bucket", w["kind"]),
                        metric=w.get("metric"),
                        route=w.get("route"),
                        calc=w.get("calc"),
                    )
                )
        except Exception:
            traceback.print_exc()

    # respect what the user told us they're doing — don't fire alerts that fight
    # an active process (e.g. no "pH out of range" while they're aerating to raise it)
    suppressed = _suppressed_kinds(profile)
    if suppressed:
        alerts = [a for a in alerts if a["kind"] not in suppressed]
    # safety + weather first, then by severity
    sev_order = {"urgent": 0, "watch": 1, "info": 2}
    alerts.sort(key=lambda a: sev_order.get(a["severity"], 3))
    return alerts[:MAX_ACTIVE_PER_POOL]


# --------------------------------------------------------------------------- persistence
def _persist(db, pool_id, fresh, now):
    """Upsert fresh alerts and auto-resolve active ones not re-emitted this cycle."""
    fresh_hashes = {a["dedup_hash"] for a in fresh}
    existing = db.execute(
        "SELECT id, dedup_hash, status FROM alerts WHERE pool_id=? AND status IN ('active','snoozed','ack')",
        (pool_id,),
    ).fetchall()
    existing_by_hash = {r["dedup_hash"]: r for r in existing}

    for a in fresh:
        ex = existing_by_hash.get(a["dedup_hash"])
        if ex:
            # refresh content but preserve user status (ack/snoozed); reactivate nothing
            db.execute(
                "UPDATE alerts SET severity=?, title=?, detail=?, recommend=?, metric=?, route=?, calc=?, updated_at=? WHERE id=?",
                (
                    a["severity"],
                    a["title"],
                    a["detail"],
                    a["recommend"],
                    a["metric"],
                    a["route"],
                    a["calc"],
                    now,
                    ex["id"],
                ),
            )
        else:
            db.execute(
                "INSERT INTO alerts(pool_id, kind, severity, title, detail, recommend, metric, route, calc, "
                "dedup_hash, status, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)",
                (
                    pool_id,
                    a["kind"],
                    a["severity"],
                    a["title"],
                    a["detail"],
                    a["recommend"],
                    a["metric"],
                    a["route"],
                    a["calc"],
                    a["dedup_hash"],
                    "active",
                    now,
                    now,
                ),
            )
    # auto-resolve: active/ack alerts whose condition cleared (not in fresh this cycle)
    for r in existing:
        if r["dedup_hash"] not in fresh_hashes and r["status"] in ("active", "ack"):
            db.execute(
                "UPDATE alerts SET status='resolved', resolved_at=?, updated_at=? WHERE id=?",
                (now, now, r["id"]),
            )
    # expire snoozes whose time has passed → back to active (will be refreshed next cycle)
    db.execute(
        "UPDATE alerts SET status='active', snooze_until=NULL, updated_at=? "
        "WHERE pool_id=? AND status='snoozed' AND snooze_until IS NOT NULL AND snooze_until<=?",
        (now, pool_id, now),
    )


def _pool_weather(db, pool, profile, now):
    """Return a derived wx object for the pool, using a cached forecast (refreshed per TTL).
    Geocodes from profile.region the first time. All failures → None (degrade silently)."""
    if not WEATHER_ENABLED:
        return None
    region = (profile or {}).get("region")
    lat, lon = pool["lat"], pool["lon"]
    if not region and lat is None:
        return None
    try:
        import weather as _wx
    except Exception:
        return None
    cache = db.execute(
        "SELECT * FROM weather_cache WHERE pool_id=?", (pool["id"],)
    ).fetchone()
    # serve cache if fresh (tighten TTL when rain is near)
    if cache:
        try:
            cached_wx = json.loads(cache["wx_json"]) or None
        except Exception:
            cached_wx = None
        ttl = WEATHER_TTL
        if cached_wx and cached_wx.get("rain24", {}).get("prob", 0) >= 50:
            ttl = HOUR_MS
        if cached_wx and (now - cache["fetched_at"]) < ttl:
            return cached_wx
    # need to (re)fetch
    geo = None
    if cache and cache["geo_json"]:
        try:
            geo = json.loads(cache["geo_json"]) or None
        except Exception:
            geo = None
    if lat is not None and lon is not None:
        geo = {"lat": lat, "lon": lon}
    if (not geo or geo.get("resolvedFrom") != region) and region:
        geo = _wx.geocode(region) or geo
    if not geo or geo.get("lat") is None:
        return None
    try:
        raw = _wx.fetch_forecast(geo["lat"], geo["lon"])
        wx = _wx.derive(raw, profile)
    except Exception:
        wx = None
    db.execute(
        "INSERT INTO weather_cache(pool_id, fetched_at, geo_json, wx_json, last_error) VALUES (?,?,?,?,?) "
        "ON CONFLICT(pool_id) DO UPDATE SET fetched_at=excluded.fetched_at, geo_json=excluded.geo_json, "
        "wx_json=excluded.wx_json, last_error=excluded.last_error",
        (
            pool["id"],
            now,
            json.dumps(geo),
            json.dumps(wx or {}),
            None if wx else "derive_failed",
        ),
    )
    # persist lat/lon onto the pool so future cycles skip geocoding
    if pool["lat"] is None and geo.get("lat") is not None:
        db.execute(
            "UPDATE pools SET lat=?, lon=? WHERE id=?",
            (geo["lat"], geo["lon"], pool["id"]),
        )
    return wx


def _post_system_messages(db, pool, fresh, now):
    """Auto-post newly-active critical alerts into the pool's message thread (deduped),
    so a linked homeowner/company sees them even outside the app."""
    for a in fresh:
        meta = SYSTEM_MSG_KINDS.get(a["kind"])
        if not meta:
            continue
        code, sev = meta
        dedupe = f"sys:{a['kind']}:{a['dedup_hash']}"
        seen = db.execute(
            "SELECT 1 FROM messages WHERE pool_id=? AND dedupe_key=? LIMIT 1",
            (pool["id"], dedupe),
        ).fetchone()
        if seen:
            continue
        body = a["title"] + (" — " + a["recommend"] if a.get("recommend") else "")
        db.execute(
            "INSERT INTO messages(pool_id, engagement_id, sender_id, sender_name, sender_role, body, "
            "kind, code, severity, dedupe_key, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
            (
                pool["id"],
                pool["engagement_id"],
                None,
                "Poolaris",
                "system",
                body,
                "system",
                code,
                sev,
                dedupe,
                now,
            ),
        )


def run_cycle(db_path):
    """One full sweep over all non-archived pools. Returns (pools_evaluated, alerts_active)."""
    db = auth.connect(db_path)
    evaluated = 0
    try:
        now = auth.now_ms()
        pools = db.execute("SELECT * FROM pools WHERE is_archived=0").fetchall()
        for pool in pools:
            try:
                rows = db.execute(
                    "SELECT taken_at, reading_json FROM readings WHERE pool_id=? ORDER BY taken_at",
                    (pool["id"],),
                ).fetchall()
                log = []
                for r in rows:
                    try:
                        log.append(
                            {
                                "t": r["taken_at"],
                                "reading": json.loads(r["reading_json"]),
                            }
                        )
                    except Exception:
                        continue
                # dose ledger (for dose-aware burn) — table may be absent on very old DBs
                doses = []
                try:
                    drows = db.execute(
                        "SELECT added_at, deltas_json FROM doses WHERE pool_id=? ORDER BY added_at",
                        (pool["id"],),
                    ).fetchall()
                    for dr in drows:
                        try:
                            doses.append(
                                {
                                    "t": dr["added_at"],
                                    "deltas": json.loads(dr["deltas_json"]),
                                }
                            )
                        except Exception:
                            continue
                except Exception:
                    doses = []
                try:
                    profile = json.loads(pool["profile_json"] or "{}")
                except Exception:
                    profile = {}
                wx = None
                try:
                    wx = _pool_weather(db, pool, profile, now)
                except Exception:
                    traceback.print_exc()
                fresh = evaluate_pool(pool, log, now, wx, doses)
                _persist(db, pool["id"], fresh, now)
                try:
                    _post_system_messages(db, pool, fresh, now)
                except Exception:
                    traceback.print_exc()
                evaluated += 1
            except Exception:
                # one bad pool must never abort the sweep
                traceback.print_exc()
        db.commit()
        active = db.execute(
            "SELECT COUNT(*) c FROM alerts WHERE status='active'"
        ).fetchone()["c"]
        _heartbeat(db, now, evaluated, active, None)
        return evaluated, active
    except Exception as e:
        try:
            _heartbeat(db, auth.now_ms(), evaluated, 0, str(e)[:500])
        except Exception:
            pass
        raise
    finally:
        db.close()


def _heartbeat(db, now, evaluated, active, err):
    db.execute(
        "INSERT INTO engine_status(k, last_run_at, last_ok_at, pools_evaluated, alerts_active, last_error) "
        "VALUES ('engine', ?, ?, ?, ?, ?) "
        "ON CONFLICT(k) DO UPDATE SET last_run_at=excluded.last_run_at, "
        "last_ok_at=CASE WHEN excluded.last_error IS NULL THEN excluded.last_ok_at ELSE engine_status.last_ok_at END, "
        "pools_evaluated=excluded.pools_evaluated, alerts_active=excluded.alerts_active, last_error=excluded.last_error",
        (now, (now if err is None else None), evaluated, active, err),
    )
    db.commit()


# --------------------------------------------------------------------------- daemon
def start_engine(db_path, stop_event=None, tick_seconds=TICK_SECONDS):
    """Start the watcher on a daemon thread. Returns (thread, stop_event)."""
    stop_event = stop_event or threading.Event()

    def loop():
        # small initial delay so the HTTP server is up first
        if stop_event.wait(2):
            return
        while not stop_event.is_set():
            try:
                run_cycle(db_path)
            except Exception:
                traceback.print_exc()  # never let the loop die
            stop_event.wait(tick_seconds)

    t = threading.Thread(target=loop, name="poolaris-engine", daemon=True)
    t.start()
    return t, stop_event


if __name__ == "__main__":
    # manual one-shot for testing: python engine.py [db_path]
    import sys

    path = sys.argv[1] if len(sys.argv) > 1 else "data/poolaris.db"
    auth.init_db(path)
    ev, ac = run_cycle(path)
    print(f"cycle done: {ev} pools evaluated, {ac} active alerts")
