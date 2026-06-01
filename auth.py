#!/usr/bin/env python3
"""
Poolaris portal — security & data core (pure Python stdlib).

Holds: the SQLite schema, DB connection helpers, password hashing (pbkdf2),
DB-backed sessions + session-bound CSRF, login rate-limiting, the per-pool
authorization model (effective_access / authorize), and the server-side
rollup computation (effective-latest carry-forward + attention scoring).

server.py imports this. No third-party packages.
"""

import sqlite3
import hashlib
import hmac
import secrets
import base64
import re
import json
import time

# ----------------------------------------------------------------------------- constants
DAY = 86_400_000
HOUR = 3_600_000
SESSION_ABSOLUTE = 30 * DAY  # hard cap from creation
SESSION_SLIDING = 14 * DAY  # each use extends expiry to now+this (capped by absolute)
SESSION_IDLE = 12 * HOUR  # logged out if unused longer than this
PBKDF2_ROUNDS = 600_000
RESET_TTL = HOUR  # password-reset token lifetime
INVITE_TTL = 14 * DAY
LOGIN_WINDOW = 15 * 60 * 1000  # rate-limit window (15 min)
LOGIN_MAX_PER_PAIR = 8  # failed (email AND ip) attempts before lockout
LOGIN_MAX_PER_IP = 50  # global per-ip ceiling in the window
HOMEOWNER_POOL_CAP = 5

RKEYS = ["fc", "cc", "ph", "ta", "ch", "cya", "salt", "temp", "borate"]


def now_ms():
    return int(time.time() * 1000)


# ----------------------------------------------------------------------------- schema
SCHEMA = """
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_display TEXT NOT NULL,
  email_norm TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  phone TEXT,
  pw_hash TEXT NOT NULL,
  prefs_json TEXT NOT NULL DEFAULT '{}',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  last_login_at INTEGER
);

CREATE TABLE IF NOT EXISTS companies (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  join_code TEXT NOT NULL UNIQUE,
  phone TEXT, email TEXT, region TEXT,
  settings_json TEXT NOT NULL DEFAULT '{}',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS company_members (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'tech',
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (company_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_members_user ON company_members(user_id, is_active);
CREATE INDEX IF NOT EXISTS idx_members_company ON company_members(company_id, is_active);

CREATE TABLE IF NOT EXISTS pools (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT 'My Pool',
  owner_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  servicing_company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  profile_json TEXT NOT NULL DEFAULT '{}',
  slam_json TEXT,
  address_line1 TEXT, address_line2 TEXT, city TEXT, state TEXT, postal_code TEXT,
  lat REAL, lon REAL, timezone TEXT,
  service_schedule_json TEXT NOT NULL DEFAULT '{}',
  last_reading_at INTEGER,
  last_visit_at INTEGER,
  effective_latest_json TEXT NOT NULL DEFAULT '{}',
  attention_score INTEGER NOT NULL DEFAULT 0,
  attention_flags_json TEXT NOT NULL DEFAULT '[]',
  engagement_id INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  is_archived INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pools_owner ON pools(owner_user_id);
CREATE INDEX IF NOT EXISTS idx_pools_company ON pools(servicing_company_id, is_archived);
CREATE INDEX IF NOT EXISTS idx_pools_attention ON pools(servicing_company_id, attention_score DESC, last_reading_at);
CREATE INDEX IF NOT EXISTS idx_pools_postal ON pools(servicing_company_id, postal_code);

CREATE TABLE IF NOT EXISTS pool_access (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE CASCADE,
  relation TEXT NOT NULL,
  can_log_reading INTEGER NOT NULL DEFAULT 1,
  can_edit_profile INTEGER NOT NULL DEFAULT 0,
  can_message INTEGER NOT NULL DEFAULT 1,
  granted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_at INTEGER NOT NULL,
  CHECK (user_id IS NOT NULL OR company_id IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_user_pool ON pool_access(pool_id, user_id) WHERE user_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_access_company_pool ON pool_access(pool_id, company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_access_user ON pool_access(user_id);
CREATE INDEX IF NOT EXISTS idx_access_company ON pool_access(company_id);

CREATE TABLE IF NOT EXISTS readings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  taken_at INTEGER NOT NULL,
  reading_json TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'owner',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_readings_pool_time ON readings(pool_id, taken_at DESC);

CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  engagement_id INTEGER NOT NULL DEFAULT 0,
  sender_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  sender_name TEXT NOT NULL DEFAULT '',
  sender_role TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_messages_pool ON messages(pool_id, created_at);

CREATE TABLE IF NOT EXISTS message_reads (
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  last_read_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (pool_id, user_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_secret TEXT NOT NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  remember INTEGER NOT NULL DEFAULT 0,
  user_agent TEXT, ip TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS login_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  email_norm TEXT, ip TEXT, ok INTEGER NOT NULL, ts INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts ON login_attempts(email_norm, ip, ts);

CREATE TABLE IF NOT EXISTS imports (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  import_key TEXT NOT NULL,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, import_key)
);

CREATE TABLE IF NOT EXISTS doses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  added_at INTEGER NOT NULL,
  chem TEXT NOT NULL,
  amount REAL NOT NULL,
  unit TEXT NOT NULL,
  pct TEXT,
  note TEXT NOT NULL DEFAULT '',
  mix_min INTEGER NOT NULL DEFAULT 30,
  deltas_json TEXT NOT NULL DEFAULT '{}',
  baseline_json TEXT NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'owner',
  created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  created_by_name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_doses_pool_time ON doses(pool_id, added_at DESC);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info','watch','urgent')),
  title TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  recommend TEXT NOT NULL DEFAULT '',
  metric TEXT,
  route TEXT,
  calc TEXT,
  dedup_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','ack','snoozed','resolved')),
  snooze_until INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  resolved_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_dedup ON alerts(pool_id, dedup_hash) WHERE status IN ('active','snoozed');
CREATE INDEX IF NOT EXISTS idx_alerts_pool ON alerts(pool_id, status, severity);

CREATE TABLE IF NOT EXISTS engine_status (
  k TEXT PRIMARY KEY,
  last_run_at INTEGER,
  last_ok_at INTEGER,
  pools_evaluated INTEGER NOT NULL DEFAULT 0,
  alerts_active INTEGER NOT NULL DEFAULT 0,
  last_error TEXT
);

-- per-pool weather cache, refreshed by the engine's weather poller (server-side, no key)
CREATE TABLE IF NOT EXISTS weather_cache (
  pool_id INTEGER PRIMARY KEY REFERENCES pools(id) ON DELETE CASCADE,
  fetched_at INTEGER NOT NULL,
  geo_json TEXT NOT NULL DEFAULT '{}',
  wx_json TEXT NOT NULL DEFAULT '{}',
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS schema_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL);

-- per-tech pool assignments (company "route"); additive — does not gate base access
CREATE TABLE IF NOT EXISTS pool_assignments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  company_id INTEGER NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  account_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  day_of_week INTEGER,
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  UNIQUE (pool_id, account_id)
);
CREATE INDEX IF NOT EXISTS idx_assign_tech ON pool_assignments(account_id, active);
CREATE INDEX IF NOT EXISTS idx_assign_company ON pool_assignments(company_id, active);

-- service-visit records (checklist -> test -> dose -> summary), auto-posts on complete
CREATE TABLE IF NOT EXISTS visits (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  company_id INTEGER REFERENCES companies(id) ON DELETE SET NULL,
  account_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  account_name TEXT NOT NULL DEFAULT '',
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  checklist_json TEXT NOT NULL DEFAULT '{}',
  dosed_json TEXT NOT NULL DEFAULT '[]',
  reading_id INTEGER,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','completed','skipped')),
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_visits_pool ON visits(pool_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_visits_company ON visits(company_id, started_at DESC);

-- "who serviced my pool" audit trail (meaningful actions only, not every request)
CREATE TABLE IF NOT EXISTS access_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pool_id INTEGER NOT NULL REFERENCES pools(id) ON DELETE CASCADE,
  account_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  account_name TEXT NOT NULL DEFAULT '',
  relation TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_pool ON access_log(pool_id, at DESC);
"""

# Columns added after v1 — applied idempotently in init_db (CREATE TABLE IF NOT EXISTS
# never alters an existing table). Each (table, column, ddl).
_MIGRATIONS = [
    (
        "messages",
        "kind",
        "ALTER TABLE messages ADD COLUMN kind TEXT NOT NULL DEFAULT 'user'",
    ),
    ("messages", "code", "ALTER TABLE messages ADD COLUMN code TEXT"),
    ("messages", "severity", "ALTER TABLE messages ADD COLUMN severity TEXT"),
    ("messages", "dedupe_key", "ALTER TABLE messages ADD COLUMN dedupe_key TEXT"),
    ("messages", "photo", "ALTER TABLE messages ADD COLUMN photo TEXT"),
    ("pools", "invite_code", "ALTER TABLE pools ADD COLUMN invite_code TEXT"),
]


def connect(db_path):
    conn = sqlite3.connect(db_path, timeout=10)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 8000")
    # WAL lets the HTTP handler and the always-on engine thread share the DB without
    # "database is locked" stalls; NORMAL sync is the standard WAL durability tradeoff.
    try:
        conn.execute("PRAGMA journal_mode = WAL")
        conn.execute("PRAGMA synchronous = NORMAL")
    except sqlite3.Error:
        pass  # some filesystems don't support WAL; busy_timeout still applies
    return conn


def _column_exists(conn, table, column):
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def init_db(db_path):
    conn = connect(db_path)
    try:
        conn.executescript(SCHEMA)
        conn.execute("INSERT OR IGNORE INTO schema_meta(k, v) VALUES ('version', '1')")
        # idempotent post-v1 column additions
        for table, column, ddl in _MIGRATIONS:
            if not _column_exists(conn, table, column):
                conn.execute(ddl)
        conn.commit()
    finally:
        conn.close()


# ----------------------------------------------------------------------------- email / passwords
def norm_email(s):
    return (s or "").strip().lower()


EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


def valid_email(s):
    s = (s or "").strip()
    return bool(EMAIL_RE.match(s)) and len(s) <= 254


def _b64(x):
    return base64.b64encode(x).decode()


def hash_password(pw, rounds=PBKDF2_ROUNDS):
    if not isinstance(pw, str) or not (8 <= len(pw) <= 256):
        raise ValueError("password must be 8..256 chars")
    salt = secrets.token_bytes(16)
    dk = hashlib.pbkdf2_hmac("sha256", pw.encode("utf-8"), salt, rounds)
    return f"pbkdf2_sha256${rounds}${_b64(salt)}${_b64(dk)}"


def verify_password(pw, stored):
    try:
        algo, rounds, s, h = stored.split("$")
        if algo != "pbkdf2_sha256":
            return False
        dk = hashlib.pbkdf2_hmac(
            "sha256", (pw or "").encode("utf-8"), base64.b64decode(s), int(rounds)
        )
        return hmac.compare_digest(dk, base64.b64decode(h))
    except Exception:
        return False


def needs_rehash(stored):
    try:
        _, rounds, _, _ = stored.split("$")
        return int(rounds) < PBKDF2_ROUNDS
    except Exception:
        return True


# ----------------------------------------------------------------------------- tokens / codes
def gen_token():
    return secrets.token_urlsafe(32)


def token_hash(raw):
    return hashlib.sha256((raw or "").encode("utf-8")).hexdigest()


_SLUG_RE = re.compile(r"[^a-z0-9]+")


def slugify(name):
    base = _SLUG_RE.sub("-", (name or "").strip().lower()).strip("-") or "company"
    return base[:40]


def unique_slug(db, name):
    base = slugify(name)
    slug = base
    n = 1
    while db.execute("SELECT 1 FROM companies WHERE slug=?", (slug,)).fetchone():
        n += 1
        slug = f"{base}-{n}"
    return slug


_B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567"


def gen_join_code(db):
    while True:
        code = "".join(secrets.choice(_B32) for _ in range(16))  # 80 bits
        if not db.execute(
            "SELECT 1 FROM companies WHERE join_code=?", (code,)
        ).fetchone():
            return code


def gen_invite_code(db):
    while True:
        code = "".join(secrets.choice(_B32) for _ in range(10))  # 50 bits, shareable
        if not db.execute(
            "SELECT 1 FROM pools WHERE invite_code=?", (code,)
        ).fetchone():
            return code


# A small embedded denylist of the most-common passwords (lowercased). Not exhaustive,
# but blocks the obvious ones with no network call or wordlist file.
_COMMON_PW = frozenset(
    """
password password1 password123 passw0rd p@ssw0rd 12345678 123456789 1234567890
123456 12345 1234567 qwerty qwerty123 qwertyuiop 1q2w3e4r 1qaz2wsx zaq12wsx
admin admin123 letmein welcome welcome1 monkey dragon master sunshine princess
football baseball iloveyou abc123 abcd1234 111111 000000 123123 654321 superman
batman trustno1 whatever changeme login starwars hottie freedom computer secret
shadow ginger pool123 poolpool swimming chlorine summer winter spring 11111111
00000000 asdfghjk asdfasdf test1234 testtest
""".split()
)


def weak_password(pw):
    return (pw or "").strip().lower() in _COMMON_PW


# ----------------------------------------------------------------------------- sessions + csrf
def create_session(db, user_id, remember=False, ua=None, ip=None):
    raw = gen_token()
    th = token_hash(raw)
    csrf_secret = secrets.token_urlsafe(24)
    now = now_ms()
    expires = now + SESSION_SLIDING
    db.execute(
        "INSERT INTO sessions(token_hash, csrf_secret, user_id, created_at, expires_at, "
        "last_seen_at, remember, user_agent, ip) VALUES (?,?,?,?,?,?,?,?,?)",
        (
            th,
            csrf_secret,
            user_id,
            now,
            expires,
            now,
            1 if remember else 0,
            (ua or "")[:300],
            ip,
        ),
    )
    db.commit()
    row = db.execute("SELECT * FROM sessions WHERE token_hash=?", (th,)).fetchone()
    return raw, row


def session_from_token(db, raw):
    """Validate a raw cookie token; enforce idle/absolute/sliding caps; slide expiry."""
    if not raw:
        return None
    row = db.execute(
        "SELECT * FROM sessions WHERE token_hash=?", (token_hash(raw),)
    ).fetchone()
    if not row:
        return None
    now = now_ms()
    if (
        now > row["expires_at"]
        or now > row["created_at"] + SESSION_ABSOLUTE
        or now - row["last_seen_at"] > SESSION_IDLE
    ):
        db.execute("DELETE FROM sessions WHERE id=?", (row["id"],))
        db.commit()
        return None
    new_exp = min(row["created_at"] + SESSION_ABSOLUTE, now + SESSION_SLIDING)
    db.execute(
        "UPDATE sessions SET last_seen_at=?, expires_at=? WHERE id=?",
        (now, new_exp, row["id"]),
    )
    db.commit()
    return db.execute("SELECT * FROM sessions WHERE id=?", (row["id"],)).fetchone()


def delete_session(db, raw):
    db.execute("DELETE FROM sessions WHERE token_hash=?", (token_hash(raw),))
    db.commit()


def csrf_token(sess_row):
    return hmac.new(
        sess_row["csrf_secret"].encode(),
        sess_row["token_hash"].encode(),
        hashlib.sha256,
    ).hexdigest()


def check_csrf(sess_row, sent):
    if not sess_row or not sent:
        return False
    return hmac.compare_digest(sent, csrf_token(sess_row))


# ----------------------------------------------------------------------------- rate limiting
def login_locked(db, email_norm, ip):
    cutoff = now_ms() - LOGIN_WINDOW
    pair = db.execute(
        "SELECT COUNT(*) c FROM login_attempts WHERE email_norm=? AND ip=? AND ok=0 AND ts>?",
        (email_norm, ip, cutoff),
    ).fetchone()["c"]
    perip = db.execute(
        "SELECT COUNT(*) c FROM login_attempts WHERE ip=? AND ok=0 AND ts>?",
        (ip, cutoff),
    ).fetchone()["c"]
    return pair >= LOGIN_MAX_PER_PAIR or perip >= LOGIN_MAX_PER_IP


def record_login(db, email_norm, ip, ok):
    db.execute(
        "INSERT INTO login_attempts(email_norm, ip, ok, ts) VALUES (?,?,?,?)",
        (email_norm, ip, 1 if ok else 0, now_ms()),
    )
    # opportunistic prune
    db.execute("DELETE FROM login_attempts WHERE ts < ?", (now_ms() - 7 * DAY,))
    db.commit()


def rate_limited(db, bucket, ip, max_count, window_ms):
    """Generic per-IP throttle for non-login actions (signup, messages, joins).
    Reuses login_attempts with an 'rl:<bucket>' pseudo-email so no new table is needed."""
    cutoff = now_ms() - window_ms
    n = db.execute(
        "SELECT COUNT(*) c FROM login_attempts WHERE email_norm=? AND ip=? AND ok=0 AND ts>?",
        ("rl:" + bucket, ip, cutoff),
    ).fetchone()["c"]
    return n >= max_count


def rate_record(db, bucket, ip):
    db.execute(
        "INSERT INTO login_attempts(email_norm, ip, ok, ts) VALUES (?,?,0,?)",
        ("rl:" + bucket, ip, now_ms()),
    )
    db.commit()


# ----------------------------------------------------------------------------- authorization
def company_role(db, user_id, company_id):
    if not company_id or not user_id:
        return None
    m = db.execute(
        "SELECT role FROM company_members WHERE company_id=? AND user_id=? AND is_active=1",
        (company_id, user_id),
    ).fetchone()
    return m["role"] if m else None


def effective_access(db, user, pool):
    """THIS user's live capabilities on THIS pool, or None (default-deny)."""
    if user is None or not user["is_active"] or pool is None:
        return None
    uid = user["id"]
    if pool["owner_user_id"] == uid:
        return {
            "relation": "owner",
            "view": 1,
            "edit_profile": 1,
            "log": 1,
            "message": 1,
            "delete": 1,
        }
    pa = db.execute(
        "SELECT * FROM pool_access WHERE pool_id=? AND user_id=?", (pool["id"], uid)
    ).fetchone()
    if pa:
        return {
            "relation": pa["relation"],
            "view": 1,
            "edit_profile": pa["can_edit_profile"],
            "log": pa["can_log_reading"],
            "message": pa["can_message"],
            "delete": 0,
        }
    co = pool["servicing_company_id"]
    if co is not None:
        role = company_role(db, uid, co)
        if role == "admin":
            return {
                "relation": "admin",
                "view": 1,
                "edit_profile": 1,
                "log": 1,
                "message": 1,
                "delete": 0,
            }
        if role == "tech":
            has_assign = db.execute(
                "SELECT 1 FROM pool_access WHERE pool_id=? AND relation='tech_assigned' LIMIT 1",
                (pool["id"],),
            ).fetchone()
            if not has_assign:
                return {
                    "relation": "tech",
                    "view": 1,
                    "edit_profile": 0,
                    "log": 1,
                    "message": 1,
                    "delete": 0,
                }
            assigned = db.execute(
                "SELECT 1 FROM pool_access WHERE pool_id=? AND user_id=? AND relation='tech_assigned'",
                (pool["id"], uid),
            ).fetchone()
            if assigned:
                return {
                    "relation": "tech",
                    "view": 1,
                    "edit_profile": 0,
                    "log": 1,
                    "message": 1,
                    "delete": 0,
                }
    # company-wide pool_access grant (rare; e.g., another company invited as viewer)
    pac = db.execute(
        "SELECT pa.* FROM pool_access pa JOIN company_members cm ON cm.company_id=pa.company_id "
        "WHERE pa.pool_id=? AND cm.user_id=? AND cm.is_active=1 LIMIT 1",
        (pool["id"], uid),
    ).fetchone()
    if pac:
        return {
            "relation": pac["relation"],
            "view": 1,
            "edit_profile": pac["can_edit_profile"],
            "log": pac["can_log_reading"],
            "message": pac["can_message"],
            "delete": 0,
        }
    return None


_ACTION_CAP = {
    "pool:view": "view",
    "pool:log_reading": "log",
    "pool:message": "message",
    "pool:edit_profile": "edit_profile",
    "pool:delete": "delete",
}


def authorize(db, user, pool, action):
    acc = effective_access(db, user, pool)
    if acc is None:
        return False
    cap = _ACTION_CAP.get(action)
    return bool(cap and acc.get(cap))


# ----------------------------------------------------------------------------- rollups
def effective_latest(readings):
    """Port of the JS effectiveReading() carry-forward: freshest non-null value of each
    parameter by timestamp. `readings` = iterable of (taken_at, reading_dict)."""
    eff, at = {}, {}
    for taken_at, r in readings:
        if not isinstance(r, dict):
            continue
        t = taken_at if taken_at is not None else 0
        for k in RKEYS:
            v = r.get(k)
            if v is None:
                continue
            try:
                fv = float(v)
            except (TypeError, ValueError):
                continue
            if k not in at or t >= at[k]:
                eff[k] = fv
                at[k] = t
    return eff


def _min_fc(cya):
    """Approximate TFP minimum FC (~7.5% of CYA, floored to the chart)."""
    if not cya:
        return 2.0
    return max(2.0, round(0.075 * cya))


_FLAG_WEIGHT = {
    "fc_zero": 100,
    "never_tested": 45,
    "fc_low": 60,
    "slam_active": 50,
    "cc_high": 40,
    "stale": 30,
    "ph_out": 22,
    "csi_scaling": 18,
    "csi_corrosive": 22,
    "cya_high": 12,
    "overdue_service": 25,
}


def compute_attention(profile, eff, last_reading_at, slam, interval_days, now=None):
    now = now or now_ms()
    flags = []
    fc = eff.get("fc")
    cya = eff.get("cya")
    cc = eff.get("cc")
    ph = eff.get("ph")
    if fc is not None:
        if fc <= 0.5:
            flags.append("fc_zero")
        elif fc < _min_fc(cya):
            flags.append("fc_low")
    if cc is not None and cc > 0.5:
        flags.append("cc_high")
    if ph is not None and (ph < 7.2 or ph > 8.0):
        flags.append("ph_out")
    if cya is not None and cya > 90:
        flags.append("cya_high")
    if slam and isinstance(slam, dict) and slam.get("active"):
        flags.append("slam_active")
    if last_reading_at is None:
        flags.append("never_tested")
    elif interval_days and now - last_reading_at > interval_days * DAY:
        flags.append("stale")
    score = min(100, sum(_FLAG_WEIGHT.get(f, 0) for f in flags))
    return score, flags


def recompute_rollups(db, pool_id):
    """Recompute and persist a pool's roster rollups after any readings/slam/profile write."""
    pool = db.execute(
        "SELECT profile_json, slam_json, servicing_company_id FROM pools WHERE id=?",
        (pool_id,),
    ).fetchone()
    if not pool:
        return
    rows = db.execute(
        "SELECT taken_at, reading_json FROM readings WHERE pool_id=? ORDER BY taken_at",
        (pool_id,),
    ).fetchall()
    parsed = []
    last_reading_at = None
    for row in rows:
        try:
            rd = json.loads(row["reading_json"])
        except Exception:
            rd = {}
        parsed.append((row["taken_at"], rd))
        last_reading_at = (
            row["taken_at"]
            if last_reading_at is None
            else max(last_reading_at, row["taken_at"])
        )
    eff = effective_latest(parsed)
    try:
        slam = json.loads(pool["slam_json"]) if pool["slam_json"] else None
    except Exception:
        slam = None
    interval = 14
    if pool["servicing_company_id"]:
        co = db.execute(
            "SELECT settings_json FROM companies WHERE id=?",
            (pool["servicing_company_id"],),
        ).fetchone()
        if co:
            try:
                interval = int(
                    json.loads(co["settings_json"]).get("serviceIntervalDays", 14)
                )
            except Exception:
                interval = 14
    score, flags = compute_attention(None, eff, last_reading_at, slam, interval)
    db.execute(
        "UPDATE pools SET last_reading_at=?, effective_latest_json=?, attention_score=?, "
        "attention_flags_json=?, updated_at=? WHERE id=?",
        (last_reading_at, json.dumps(eff), score, json.dumps(flags), now_ms(), pool_id),
    )
    db.commit()


# ----------------------------------------------------------------------------- meta
def meta_get(db, k, default=None):
    row = db.execute("SELECT v FROM schema_meta WHERE k=?", (k,)).fetchone()
    return row["v"] if row else default


def meta_set(db, k, v):
    db.execute(
        "INSERT INTO schema_meta(k, v) VALUES (?, ?) ON CONFLICT(k) DO UPDATE SET v=excluded.v",
        (k, str(v)),
    )
    db.commit()
