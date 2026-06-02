#!/usr/bin/env python3
"""
Poolaris portal server (pure Python stdlib). Serves the static app and the
multi-tenant REST API backed by SQLite (see auth.py for schema/crypto/authz).

Run:  python server.py        (or run-poolaris.bat)
Open: http://localhost:8000

Security posture: same-origin only (no CORS *), httpOnly `sid` cookie + session-
bound CSRF on every mutation + Origin check, parameterized SQL, per-pool authz,
column whitelists, bound to 127.0.0.1 unless POOLARIS_BIND_ALL=1.
"""

import http.server
import socketserver
import json
import os
import re
import socket
import threading
import webbrowser
import pathlib
from urllib.parse import urlparse, parse_qs

import auth

ROOT = pathlib.Path(__file__).resolve().parent
DATA_DIR = ROOT / "data"
DB_PATH = os.environ.get("POOLARIS_DB") or str(DATA_DIR / "poolaris.db")
# the offline file-mode store; overridable so tests never touch the real user file
LEGACY_FILE = pathlib.Path(
    os.environ.get("POOLARIS_LEGACY_FILE") or str(DATA_DIR / "poolaris.json")
)
PORT = int(os.environ.get("POOLARIS_PORT", "8000"))
BIND = "0.0.0.0" if os.environ.get("POOLARIS_BIND_ALL") == "1" else "127.0.0.1"
# Content-Security-Policy sent on every HTTP response. Open-Meteo is allowed for the
# client-side weather widget; everything else is same-origin. (file:// runs without CSP.)
CSP = (
    "default-src 'self'; "
    "img-src 'self' data:; "
    "style-src 'self' 'unsafe-inline'; "
    "script-src 'self'; "
    "connect-src 'self' https://api.open-meteo.com https://geocoding-api.open-meteo.com; "
    "frame-ancestors 'none'; base-uri 'none'; form-action 'self'"
)
DEV = os.environ.get("POOLARIS_DEV") == "1"
MAX_BODY = 2_000_000  # 2MB cap on request bodies
DUMMY_HASH = auth.hash_password("x" * 12)  # equalize login timing for unknown users

DATA_DIR.mkdir(exist_ok=True)
auth.init_db(DB_PATH)

# ---- rotating file log under data/ (never web-served; the static allowlist blocks data/) ----
import logging
import logging.handlers

LOG = logging.getLogger("poolaris")
if not LOG.handlers:
    LOG.setLevel(logging.INFO)
    try:
        _h = logging.handlers.RotatingFileHandler(
            str(DATA_DIR / "poolaris.log"),
            maxBytes=1_000_000,
            backupCount=5,
            encoding="utf-8",
        )
        _h.setFormatter(logging.Formatter("%(asctime)s %(levelname)s %(message)s"))
        LOG.addHandler(_h)
    except Exception:
        pass


def backup_db():
    """integrity_check + a timestamped online backup snapshot to data/backups (keep last ~14)."""
    import sqlite3
    import time
    import glob

    bdir = DATA_DIR / "backups"
    bdir.mkdir(exist_ok=True)
    src = auth.connect(DB_PATH)
    try:
        row = src.execute("PRAGMA integrity_check").fetchone()
        if not (row and row[0] == "ok"):
            LOG.error("integrity_check: %s", row and row[0])
        dest_path = str(bdir / ("poolaris-" + time.strftime("%Y%m%d-%H%M%S") + ".db"))
        dest = sqlite3.connect(dest_path)
        try:
            src.backup(dest)
        finally:
            dest.close()
    finally:
        src.close()
    for old in sorted(glob.glob(str(bdir / "poolaris-*.db")))[:-14]:
        try:
            os.remove(old)
        except OSError:
            pass


RKEYS = auth.RKEYS

# Static allowlist — the ONLY files the web server will hand out. Add new front-end
# assets here explicitly; nothing else (transcripts, .md, configs, DB, source) is servable.
_STATIC_FILES = {
    "index.html",
    "styles.css",
    "favicon.ico",
    "manifest.webmanifest",
    "sw.js",
    "icon.svg",
    "pool-knowledge-base.md",  # the app's offline rulebook — intentionally downloadable
}
_STATIC_DIRS = ("js/",)  # everything under js/ that ends in an allowed asset extension
_STATIC_EXTS = (".js", ".css", ".svg", ".png", ".webmanifest", ".ico", ".woff2", ".map")
import mimetypes

mimetypes.add_type("application/manifest+json", ".webmanifest")
mimetypes.add_type("image/svg+xml", ".svg")
mimetypes.add_type("text/javascript", ".js")


def _static_allowed(rel):
    rel = rel.replace("\\", "/")
    if rel in _STATIC_FILES:
        return True
    if rel.startswith(_STATIC_DIRS) and rel.endswith(_STATIC_EXTS):
        # only one directory deep (js/foo.js), no nested traversal tricks
        return rel.count("/") == 1
    return False


# =========================================================================== helpers
def reading_row_to_log(r):
    try:
        rd = json.loads(r["reading_json"])
    except Exception:
        rd = {}
    return {
        "id": r["id"],
        "t": r["taken_at"],
        "reading": rd,
        "note": r["note"] or "",
        "source": r["source"],
        "createdByName": r["created_by_name"] or "",
    }


def clean_reading(rd):
    """Whitelist reading keys; coerce to float; drop junk."""
    out = {}
    if not isinstance(rd, dict):
        return out
    for k in RKEYS:
        v = rd.get(k)
        if v is None or v == "":
            continue
        try:
            out[k] = float(v)
        except (TypeError, ValueError):
            continue
    return out


def derive_pool_meta(profile):
    """Server-derived (never client-trusted) name/address from the profile blob."""
    name = (profile.get("name") if isinstance(profile, dict) else None) or "My Pool"
    region = (profile.get("region") if isinstance(profile, dict) else None) or ""
    return str(name)[:120], str(region)[:200]


def companies_for(db, user_id):
    rows = db.execute(
        "SELECT c.id, c.name, c.slug, c.join_code, m.role FROM company_members m "
        "JOIN companies c ON c.id=m.company_id WHERE m.user_id=? AND m.is_active=1 ORDER BY c.name",
        (user_id,),
    ).fetchall()
    return [
        {
            "id": r["id"],
            "name": r["name"],
            "slug": r["slug"],
            "role": r["role"],
            "joinCode": r["join_code"],
        }
        for r in rows
    ]


def unread_count(db, pool_id, user_id):
    mr = db.execute(
        "SELECT last_read_at FROM message_reads WHERE pool_id=? AND user_id=?",
        (pool_id, user_id),
    ).fetchone()
    last = mr["last_read_at"] if mr else 0
    return db.execute(
        "SELECT COUNT(*) c FROM messages WHERE pool_id=? AND created_at>? AND (sender_id IS NULL OR sender_id<>?)",
        (pool_id, last, user_id),
    ).fetchone()["c"]


def pool_public(db, pool, acc, user):
    """The /pools/:id pool object (no readings)."""
    profile = json.loads(pool["profile_json"] or "{}")
    slam = json.loads(pool["slam_json"]) if pool["slam_json"] else None
    owner = None
    if pool["owner_user_id"]:
        o = db.execute(
            "SELECT name, email_display FROM users WHERE id=?", (pool["owner_user_id"],)
        ).fetchone()
        if o:
            owner = {"name": o["name"], "email": o["email_display"]}
    company = None
    if pool["servicing_company_id"]:
        c = db.execute(
            "SELECT id, name FROM companies WHERE id=?", (pool["servicing_company_id"],)
        ).fetchone()
        if c:
            company = {"id": c["id"], "name": c["name"]}
    return {
        "id": pool["id"],
        "name": pool["name"],
        "profile": profile,
        "slam": slam,
        "address": {
            "line1": pool["address_line1"],
            "city": pool["city"],
            "state": pool["state"],
            "postalCode": pool["postal_code"],
        },
        "lat": pool["lat"],
        "lon": pool["lon"],
        "timezone": pool["timezone"],
        "role": acc["relation"],
        "canEditProfile": bool(acc["edit_profile"]),
        "canMessage": bool(acc["message"]),
        "canDelete": bool(acc["delete"]),
        "version": pool["version"],
        "engagementId": pool["engagement_id"],
        "owner": owner,
        "company": company,
        "lastReadingAt": pool["last_reading_at"],
        "lastVisitAt": pool["last_visit_at"],
        "attentionScore": pool["attention_score"],
        "attentionFlags": json.loads(pool["attention_flags_json"] or "[]"),
        "effectiveLatest": json.loads(pool["effective_latest_json"] or "{}"),
    }


# =========================================================================== handler
class Handler(http.server.SimpleHTTPRequestHandler):
    server_version = "Poolaris/1.0"

    def __init__(self, *a, **k):
        super().__init__(*a, directory=str(ROOT), **k)

    # ---- low-level io ----
    def _json(self, code, obj):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for c in getattr(self, "_set_cookies", []):
            self.send_header("Set-Cookie", c)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def end_headers(self):
        # Security headers on EVERY response (JSON API + static files alike).
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Content-Security-Policy", CSP)
        if self._is_https():
            self.send_header(
                "Strict-Transport-Security", "max-age=31536000; includeSubDomains"
            )
        # Static assets (js/css/html/sw) must always revalidate so a code update is picked up on
        # the next load instead of serving a stale cached app.js. (API responses already send
        # no-store via _json.) This is what makes edits show up without a hard-refresh.
        if not self.path.startswith("/api"):
            self.send_header("Cache-Control", "no-cache")
        super().end_headers()

    def _read_json(self):
        try:
            n = int(self.headers.get("Content-Length", 0))
        except ValueError:
            return None
        if n <= 0:
            return {}
        if n > MAX_BODY:
            self._json(413, {"ok": False, "error": "too_large"})
            return "ERR"
        try:
            return json.loads(self.rfile.read(n).decode("utf-8"))
        except Exception:
            return None

    # ---- cookies / session ----
    def _cookie(self, name):
        raw = self.headers.get("Cookie", "")
        for part in raw.split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                if k == name:
                    return v
        return None

    def _is_local(self):
        ip = self.client_address[0]
        return ip in ("127.0.0.1", "::1", "localhost")

    def _client_ip(self):
        # Behind the Cloudflare tunnel every request's direct peer is loopback; trust a
        # forwarded client IP ONLY from a loopback peer (never from an arbitrary remote).
        peer = self.client_address[0]
        if peer in ("127.0.0.1", "::1"):
            cf = self.headers.get("CF-Connecting-IP")
            if cf:
                return cf.strip()
            xff = self.headers.get("X-Forwarded-For")
            if xff:
                return xff.split(",")[0].strip()
        return peer

    def _is_https(self):
        # Cloudflare terminates TLS and sets X-Forwarded-Proto on the origin request.
        return (self.headers.get("X-Forwarded-Proto") or "").lower() == "https"

    def _set_cookie(self, raw, remember):
        secure = " Secure;" if self._is_https() else ""
        maxage = f" Max-Age={30 * 86400};" if remember else ""
        self._set_cookies = getattr(self, "_set_cookies", [])
        self._set_cookies.append(
            f"sid={raw}; Path=/; HttpOnly; SameSite=Lax;{secure}{maxage}".strip()
        )

    def _clear_cookie(self):
        self._set_cookies = getattr(self, "_set_cookies", [])
        self._set_cookies.append("sid=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0")

    def _resolve_session(self, db):
        self.session = auth.session_from_token(db, self._cookie("sid"))
        self.user = None
        if self.session:
            self.user = db.execute(
                "SELECT * FROM users WHERE id=?", (self.session["user_id"],)
            ).fetchone()
            if self.user and not self.user["is_active"]:
                self.user = None

    def _origin_ok(self):
        host = self.headers.get("Host", "")
        src = self.headers.get("Origin") or self.headers.get("Referer") or ""
        if not src:
            return False
        try:
            netloc = urlparse(src).netloc
        except Exception:
            return False
        if netloc == host:
            return True
        # Only trust a bare localhost Origin when actually bound to loopback; otherwise a
        # LAN/0.0.0.0 deployment could be CSRF'd with a forged localhost Origin header.
        if BIND in ("127.0.0.1", "::1", "localhost"):
            return netloc.split(":")[0] in ("localhost", "127.0.0.1")
        return False

    def require_session(self):
        if not self.user:
            self._json(401, {"ok": False, "error": "auth_required"})
            return False
        return True

    def require_csrf(self):
        if not self._origin_ok():
            self._json(403, {"ok": False, "error": "bad_origin"})
            return False
        if not auth.check_csrf(self.session, self.headers.get("X-Poolaris-CSRF", "")):
            self._json(403, {"ok": False, "error": "csrf"})
            return False
        return True

    def require_pool(self, db, pid, action):
        pool = db.execute("SELECT * FROM pools WHERE id=?", (pid,)).fetchone()
        acc = auth.effective_access(db, self.user, pool) if pool else None
        if pool is None or acc is None:
            self._json(404, {"ok": False, "error": "not_found"})
            return None, None
        if not auth.authorize(db, self.user, pool, action):
            self._json(403, {"ok": False, "error": "forbidden"})
            return None, None
        return pool, acc

    # ---- dispatch ----
    def _dispatch(self, method):
        path = urlparse(self.path).path
        if not path.startswith("/api/") and path != "/api":
            return self._serve_static(method, path)
        body = None
        if method in ("POST", "PATCH", "PUT", "DELETE"):
            body = self._read_json()
            if body == "ERR":
                return
            if body is None:
                return self._json(400, {"ok": False, "error": "bad_json"})
        self.body = body or {}
        db = auth.connect(DB_PATH)
        try:
            self._resolve_session(db)
            for m, rx, fn in ROUTES:
                if m != method:
                    continue
                mm = rx.match(path)
                if mm:
                    return fn(self, db, mm.groups())
            self._json(404, {"ok": False, "error": "no_route"})
        except Exception:
            import traceback

            LOG.error("dispatch %s %s\n%s", method, path, traceback.format_exc())
            try:
                self._json(500, {"ok": False, "error": "server_error"})
            except Exception:
                pass
        finally:
            db.close()

    def do_GET(self):
        self._dispatch("GET")

    def do_POST(self):
        self._dispatch("POST")

    def do_PATCH(self):
        self._dispatch("PATCH")

    def do_DELETE(self):
        self._dispatch("DELETE")

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def _serve_static(self, method, path):
        # ALLOWLIST: only real app assets are downloadable. Everything else (transcripts,
        # markdown, configs, the DB, the .py source, anything new someone drops in the
        # folder) 404s by default — far safer than a blocklist that has to anticipate
        # every sensitive extension.
        if method != "GET":
            return self._json(405, {"ok": False, "error": "method"})
        # decode percent-escapes BEFORE matching, so %2e%2e and friends can't slip through
        try:
            from urllib.parse import unquote

            decoded = unquote(path)
        except Exception:
            decoded = path
        if ".." in decoded or "\\" in decoded or "\x00" in decoded:
            return self._json(404, {"ok": False, "error": "not_found"})
        rel = decoded.lstrip("/")
        if rel == "" or rel == "index.html":
            rel = "index.html"
        if not _static_allowed(rel):
            return self._json(404, {"ok": False, "error": "not_found"})
        # final defense-in-depth: the resolved real path must live inside ROOT
        try:
            target = (ROOT / rel).resolve()
            target.relative_to(ROOT.resolve())
        except Exception:
            return self._json(404, {"ok": False, "error": "not_found"})
        if not target.is_file():
            return self._json(404, {"ok": False, "error": "not_found"})
        return super().do_GET()

    def log_message(self, format, *args):  # noqa: A002 (match base signature)
        pass


# =========================================================================== endpoints
def _users_empty(db):
    return db.execute("SELECT 1 FROM users LIMIT 1").fetchone() is None


# ---- auth ----
def ep_signup(h, db, m):
    if not h._origin_ok():
        return h._json(403, {"ok": False, "error": "bad_origin"})
    ip = h._client_ip()
    # throttle BEFORE the 600k-round pbkdf2 hash so signup can't be a CPU-exhaustion vector
    if auth.rate_limited(db, "signup", ip, 5, 3600_000):
        return h._json(
            429,
            {
                "ok": False,
                "error": "rate_limited",
                "message": "Too many sign-up attempts — try again later.",
            },
        )
    auth.rate_record(db, "signup", ip)
    b = h.body
    email = (b.get("email") or "").strip()
    name = (b.get("name") or "").strip()[:120]
    pw = b.get("password") or ""
    role = b.get("role") or "homeowner"
    if not auth.valid_email(email):
        return h._json(400, {"ok": False, "error": "bad_email"})
    if not (8 <= len(pw) <= 256):
        return h._json(
            400,
            {
                "ok": False,
                "error": "bad_password",
                "message": "Password must be 8+ characters.",
            },
        )
    if auth.weak_password(pw):
        return h._json(
            400,
            {
                "ok": False,
                "error": "weak_password",
                "message": "That password is too common — pick something less guessable.",
            },
        )
    if role not in ("homeowner", "company_admin"):
        return h._json(400, {"ok": False, "error": "bad_role"})
    en = auth.norm_email(email)
    if pw.split("@")[0] == en.split("@")[0] and "@" in pw:
        return h._json(400, {"ok": False, "error": "weak_password"})
    if db.execute("SELECT 1 FROM users WHERE email_norm=?", (en,)).fetchone():
        return h._json(
            409,
            {
                "ok": False,
                "error": "email_taken",
                "message": "That email already has an account.",
            },
        )
    now = auth.now_ms()
    cur = db.execute(
        "INSERT INTO users(email_display, email_norm, name, pw_hash, prefs_json, created_at, updated_at, last_login_at)"
        " VALUES (?,?,?,?,?,?,?,?)",
        (
            email,
            en,
            name,
            auth.hash_password(pw),
            json.dumps({"ui": {"learnOpen": {}}}),
            now,
            now,
            now,
        ),
    )
    uid = cur.lastrowid
    if role == "company_admin":
        cname = (b.get("companyName") or name or "My Pool Service").strip()[:120]
        slug = auth.unique_slug(db, cname)
        code = auth.gen_join_code(db)
        cc = db.execute(
            "INSERT INTO companies(name, slug, join_code, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?)",
            (cname, slug, code, uid, now, now),
        )
        db.execute(
            "INSERT INTO company_members(company_id, user_id, role, created_at) VALUES (?,?,?,?)",
            (cc.lastrowid, uid, "admin", now),
        )
    db.commit()
    raw, sess = auth.create_session(
        db,
        uid,
        bool(b.get("remember")),
        h.headers.get("User-Agent"),
        h._client_ip(),
    )
    h._set_cookie(raw, bool(b.get("remember")))
    return h._json(
        200,
        {
            "ok": True,
            "user": _user_public(db, uid),
            "companies": companies_for(db, uid),
            "csrf": auth.csrf_token(sess),
        },
    )


def _user_public(db, uid):
    u = db.execute("SELECT * FROM users WHERE id=?", (uid,)).fetchone()
    prefs = json.loads(u["prefs_json"] or "{}")
    return {
        "id": u["id"],
        "email": u["email_display"],
        "name": u["name"],
        "phone": u["phone"],
        "prefs": prefs,
    }


def ep_login(h, db, m):
    if not h._origin_ok():
        return h._json(403, {"ok": False, "error": "bad_origin"})
    b = h.body
    en = auth.norm_email(b.get("email"))
    pw = b.get("password") or ""
    ip = h._client_ip()
    if auth.login_locked(db, en, ip):
        return h._json(
            429,
            {
                "ok": False,
                "error": "locked",
                "message": "Too many attempts — wait a few minutes.",
            },
        )
    u = db.execute("SELECT * FROM users WHERE email_norm=?", (en,)).fetchone()
    ok = bool(u) and u["is_active"] and auth.verify_password(pw, u["pw_hash"])
    if not ok:
        auth.verify_password(pw, DUMMY_HASH)  # keep timing similar for unknown users
        auth.record_login(db, en, ip, False)
        return h._json(
            401,
            {
                "ok": False,
                "error": "bad_credentials",
                "message": "Email or password is incorrect.",
            },
        )
    auth.record_login(db, en, ip, True)
    if auth.needs_rehash(u["pw_hash"]):
        db.execute(
            "UPDATE users SET pw_hash=? WHERE id=?", (auth.hash_password(pw), u["id"])
        )
    db.execute("UPDATE users SET last_login_at=? WHERE id=?", (auth.now_ms(), u["id"]))
    db.commit()
    raw, sess = auth.create_session(
        db, u["id"], bool(b.get("remember")), h.headers.get("User-Agent"), ip
    )
    h._set_cookie(raw, bool(b.get("remember")))
    return h._json(
        200,
        {
            "ok": True,
            "user": _user_public(db, u["id"]),
            "companies": companies_for(db, u["id"]),
            "csrf": auth.csrf_token(sess),
        },
    )


def ep_logout(h, db, m):
    if h.session:
        auth.delete_session(db, h._cookie("sid"))
    h._clear_cookie()
    return h._json(200, {"ok": True})


def ep_me(h, db, m):
    if not h.require_session():
        return
    uid = h.user["id"]
    prefs = json.loads(h.user["prefs_json"] or "{}")
    # unread across visible pools (owned + access)
    rows = db.execute(
        "SELECT DISTINCT p.id FROM pools p LEFT JOIN pool_access a ON a.pool_id=p.id AND a.user_id=? "
        "WHERE (p.owner_user_id=? OR a.user_id=?) AND p.is_archived=0",
        (uid, uid, uid),
    ).fetchall()
    unread_total = sum(unread_count(db, r["id"], uid) for r in rows)
    return h._json(
        200,
        {
            "ok": True,
            "user": _user_public(db, uid),
            "companies": companies_for(db, uid),
            "csrf": auth.csrf_token(h.session),
            "unreadTotal": unread_total,
            "selectedPoolId": prefs.get("selectedPoolId"),
        },
    )


def ep_me_update(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    b = h.body
    fields, vals = [], []
    if "name" in b:
        fields.append("name=?")
        vals.append(str(b["name"])[:120])
    if "phone" in b:
        fields.append("phone=?")
        vals.append((str(b["phone"])[:40]) if b["phone"] else None)
    if "prefs" in b and isinstance(b["prefs"], dict):
        prefs = json.loads(h.user["prefs_json"] or "{}")
        prefs.update(b["prefs"])  # shallow merge
        fields.append("prefs_json=?")
        vals.append(json.dumps(prefs))
    if fields:
        fields.append("updated_at=?")
        vals.append(auth.now_ms())
        vals.append(h.user["id"])
        db.execute(f"UPDATE users SET {','.join(fields)} WHERE id=?", vals)
        db.commit()
    return h._json(200, {"ok": True, "user": _user_public(db, h.user["id"])})


def ep_password(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    b = h.body
    if not auth.verify_password(b.get("current") or "", h.user["pw_hash"]):
        return h._json(403, {"ok": False, "error": "bad_password"})
    nxt = b.get("next") or ""
    if not (8 <= len(nxt) <= 256):
        return h._json(400, {"ok": False, "error": "bad_password"})
    if auth.weak_password(nxt):
        return h._json(
            400,
            {
                "ok": False,
                "error": "weak_password",
                "message": "That password is too common.",
            },
        )
    db.execute(
        "UPDATE users SET pw_hash=?, updated_at=? WHERE id=?",
        (auth.hash_password(nxt), auth.now_ms(), h.user["id"]),
    )
    # revoke other sessions, keep current
    db.execute(
        "DELETE FROM sessions WHERE user_id=? AND id<>?",
        (h.user["id"], h.session["id"]),
    )
    db.commit()
    return h._json(200, {"ok": True})


# ---- pools ----
def _visible_owned_pools(db, uid):
    return db.execute(
        "SELECT DISTINCT p.* FROM pools p LEFT JOIN pool_access a ON a.pool_id=p.id AND a.user_id=? "
        "WHERE (p.owner_user_id=? OR a.user_id=?) AND p.is_archived=0 ORDER BY p.created_at",
        (uid, uid, uid),
    ).fetchall()


def ep_pools_list(h, db, m):
    if not h.require_session():
        return
    uid = h.user["id"]
    out = []
    for p in _visible_owned_pools(db, uid):
        acc = auth.effective_access(db, h.user, p)
        out.append(
            {
                "id": p["id"],
                "name": p["name"],
                "profile": json.loads(p["profile_json"] or "{}"),
                "address": {"city": p["city"], "postalCode": p["postal_code"]},
                "role": acc["relation"] if acc else "viewer",
                "lastReadingAt": p["last_reading_at"],
                "attentionScore": p["attention_score"],
                "attentionFlags": json.loads(p["attention_flags_json"] or "[]"),
                "unread": unread_count(db, p["id"], uid),
                "company": p["servicing_company_id"],
            }
        )
    return h._json(200, {"ok": True, "pools": out})


def _create_pool(
    db, profile, slam, owner_id, created_by, company_id=None, address=None
):
    now = auth.now_ms()
    name, region = derive_pool_meta(profile)
    # structured address (line1/city/state/postal) when provided; else fall back to region
    addr = address if isinstance(address, dict) else {}
    line1 = (str(addr.get("line1"))[:200] if addr.get("line1") else None) or region
    city = str(addr.get("city"))[:120] if addr.get("city") else None
    state = str(addr.get("state"))[:80] if addr.get("state") else None
    postal = str(addr.get("postalCode"))[:20] if addr.get("postalCode") else None
    cur = db.execute(
        "INSERT INTO pools(name, owner_user_id, servicing_company_id, created_by_user_id, profile_json, slam_json, "
        "address_line1, city, state, postal_code, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            name,
            owner_id,
            company_id,
            created_by,
            json.dumps(profile),
            json.dumps(slam) if slam else None,
            line1,
            city,
            state,
            postal,
            now,
            now,
        ),
    )
    pid = cur.lastrowid
    if owner_id:
        db.execute(
            "INSERT INTO pool_access(pool_id, user_id, relation, can_log_reading, can_edit_profile, "
            "can_message, granted_by, created_at) VALUES (?,?,?,1,1,1,?,?)",
            (pid, owner_id, "owner", created_by, now),
        )
    if company_id:
        db.execute(
            "INSERT INTO pool_access(pool_id, company_id, relation, can_log_reading, can_edit_profile, "
            "can_message, granted_by, created_at) VALUES (?,?,?,1,0,1,?,?)",
            (pid, company_id, "company", created_by, now),
        )
    db.commit()
    return pid


def ep_pools_create(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    b = h.body
    profile = b.get("profile") if isinstance(b.get("profile"), dict) else {}
    uid = h.user["id"]
    company_id = None
    owner_id = uid
    scid = b.get("servicingCompanyId")
    if scid:
        if not auth.company_role(db, uid, scid):
            return h._json(403, {"ok": False, "error": "not_company_member"})
        company_id = scid
        owner_id = None  # client pool starts unclaimed; the homeowner claims it via an invite code
    cap = db.execute(
        "SELECT COUNT(*) c FROM pools WHERE owner_user_id=? AND is_archived=0", (uid,)
    ).fetchone()["c"]
    if cap >= auth.HOMEOWNER_POOL_CAP and not company_id:
        return h._json(
            409,
            {
                "ok": False,
                "error": "pool_limit",
                "message": f"You can own up to {auth.HOMEOWNER_POOL_CAP} pools.",
            },
        )
    pid = _create_pool(
        db, profile, b.get("slam"), owner_id, uid, company_id, b.get("address")
    )
    auth.recompute_rollups(db, pid)
    pool = db.execute("SELECT * FROM pools WHERE id=?", (pid,)).fetchone()
    acc = auth.effective_access(db, h.user, pool)
    return h._json(200, {"ok": True, "pool": pool_public(db, pool, acc, h.user)})


def ep_pool_get(h, db, m):
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    rows = db.execute(
        "SELECT * FROM readings WHERE pool_id=? ORDER BY taken_at", (pool["id"],)
    ).fetchall()
    log = [reading_row_to_log(r) for r in rows]
    drows = db.execute(
        "SELECT * FROM doses WHERE pool_id=? ORDER BY added_at", (pool["id"],)
    ).fetchall()
    obj = pool_public(db, pool, acc, h.user)
    return h._json(
        200,
        {
            "ok": True,
            "pool": obj,
            "log": log,
            "doses": [dose_row_to_obj(r) for r in drows],
            "unread": unread_count(db, pool["id"], h.user["id"]),
        },
    )


def ep_pool_update(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:edit_profile")
    if not pool:
        return
    b = h.body
    if "version" in b and int(b["version"]) != pool["version"]:
        return h._json(
            409,
            {
                "ok": False,
                "error": "stale",
                "message": "This pool changed elsewhere — reload.",
            },
        )
    sets, vals = [], []
    if isinstance(b.get("profile"), dict):
        name, region = derive_pool_meta(b["profile"])
        sets += ["profile_json=?", "name=?", "address_line1=?"]
        vals += [json.dumps(b["profile"]), name, region]
    if "slam" in b:
        sets.append("slam_json=?")
        vals.append(json.dumps(b["slam"]) if b["slam"] else None)
    sets += ["version=version+1", "updated_at=?"]
    vals += [auth.now_ms(), pool["id"]]
    db.execute(f"UPDATE pools SET {','.join(sets)} WHERE id=?", vals)
    db.commit()
    auth.recompute_rollups(db, pool["id"])
    pool = db.execute("SELECT * FROM pools WHERE id=?", (pool["id"],)).fetchone()
    return h._json(
        200,
        {
            "ok": True,
            "pool": pool_public(
                db, pool, auth.effective_access(db, h.user, pool), h.user
            ),
        },
    )


def ep_pool_delete(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    hard = parse_qs(urlparse(h.path).query).get("hard", ["0"])[0] == "1"
    if hard:
        if not acc["delete"]:
            return h._json(
                403,
                {
                    "ok": False,
                    "error": "forbidden",
                    "message": "Only the owner can delete a pool.",
                },
            )
        db.execute("DELETE FROM pools WHERE id=?", (pool["id"],))
    else:
        if acc["relation"] not in ("owner", "admin"):
            return h._json(403, {"ok": False, "error": "forbidden"})
        db.execute(
            "UPDATE pools SET is_archived=1, updated_at=? WHERE id=?",
            (auth.now_ms(), pool["id"]),
        )
    db.commit()
    return h._json(200, {"ok": True})


def ep_pool_location(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:edit_profile")
    if not pool:
        return
    b = h.body
    db.execute(
        "UPDATE pools SET lat=?, lon=?, timezone=?, updated_at=? WHERE id=?",
        (
            b.get("lat"),
            b.get("lon"),
            (str(b.get("timezone"))[:60] if b.get("timezone") else None),
            auth.now_ms(),
            pool["id"],
        ),
    )
    db.commit()
    return h._json(200, {"ok": True})


def ep_link_company(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:edit_profile")
    if not pool:
        return
    code = (h.body.get("joinCode") or "").strip().upper()
    co = db.execute("SELECT * FROM companies WHERE join_code=?", (code,)).fetchone()
    if not co:
        return h._json(
            404,
            {
                "ok": False,
                "error": "bad_code",
                "message": "No company found for that code.",
            },
        )
    eng = pool["engagement_id"] + 1
    db.execute(
        "UPDATE pools SET servicing_company_id=?, engagement_id=?, updated_at=? WHERE id=?",
        (co["id"], eng, auth.now_ms(), pool["id"]),
    )
    db.execute(
        "INSERT OR REPLACE INTO pool_access(pool_id, company_id, relation, can_log_reading, "
        "can_edit_profile, can_message, granted_by, created_at) VALUES (?,?,?,1,0,1,?,?)",
        (pool["id"], co["id"], "company", h.user["id"], auth.now_ms()),
    )
    db.execute(
        "INSERT INTO messages(pool_id, engagement_id, sender_role, sender_name, body, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (
            pool["id"],
            eng,
            "system",
            "Poolaris",
            f"{co['name']} is now connected to this pool.",
            auth.now_ms(),
        ),
    )
    db.commit()
    pool = db.execute("SELECT * FROM pools WHERE id=?", (pool["id"],)).fetchone()
    return h._json(
        200,
        {
            "ok": True,
            "pool": pool_public(
                db, pool, auth.effective_access(db, h.user, pool), h.user
            ),
            "company": {"id": co["id"], "name": co["name"]},
        },
    )


def ep_unlink_company(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    is_owner = acc["relation"] == "owner"
    is_admin = acc["relation"] == "admin"
    if not (is_owner or is_admin):
        return h._json(403, {"ok": False, "error": "forbidden"})
    eng = pool["engagement_id"] + 1
    db.execute(
        "UPDATE pools SET servicing_company_id=NULL, engagement_id=?, updated_at=? WHERE id=?",
        (eng, auth.now_ms(), pool["id"]),
    )
    db.execute(
        "DELETE FROM pool_access WHERE pool_id=? AND (company_id IS NOT NULL OR relation='tech_assigned')",
        (pool["id"],),
    )
    db.execute(
        "INSERT INTO messages(pool_id, engagement_id, sender_role, sender_name, body, created_at) "
        "VALUES (?,?,?,?,?,?)",
        (
            pool["id"],
            eng,
            "system",
            "Poolaris",
            "The service company was disconnected from this pool.",
            auth.now_ms(),
        ),
    )
    db.commit()
    pool = db.execute("SELECT * FROM pools WHERE id=?", (pool["id"],)).fetchone()
    return h._json(
        200,
        {
            "ok": True,
            "pool": pool_public(
                db, pool, auth.effective_access(db, h.user, pool), h.user
            ),
        },
    )


# ---- readings ----
def _rollup_resp(db, pid):
    p = db.execute(
        "SELECT last_reading_at, attention_score, attention_flags_json, effective_latest_json, version "
        "FROM pools WHERE id=?",
        (pid,),
    ).fetchone()
    return {
        "lastReadingAt": p["last_reading_at"],
        "attentionScore": p["attention_score"],
        "attentionFlags": json.loads(p["attention_flags_json"] or "[]"),
        "effectiveLatest": json.loads(p["effective_latest_json"] or "{}"),
        "version": p["version"],
    }


def ep_readings_list(h, db, m):
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    rows = db.execute(
        "SELECT * FROM readings WHERE pool_id=? ORDER BY taken_at", (pool["id"],)
    ).fetchall()
    return h._json(200, {"ok": True, "readings": [reading_row_to_log(r) for r in rows]})


def ep_reading_create(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:log_reading")
    if not pool:
        return
    b = h.body
    rd = clean_reading(b.get("reading"))
    if not rd:
        return h._json(400, {"ok": False, "error": "empty_reading"})
    now = auth.now_ms()
    t = int(b["t"]) if b.get("t") else now
    src = "tech" if acc["relation"] in ("admin", "tech") else "owner"
    cur = db.execute(
        "INSERT INTO readings(pool_id, taken_at, reading_json, note, source, created_by, created_by_name, "
        "created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
        (
            pool["id"],
            t,
            json.dumps(rd),
            (b.get("note") or "")[:1000],
            src,
            h.user["id"],
            h.user["name"],
            now,
            now,
        ),
    )
    auth.recompute_rollups(db, pool["id"])
    r = db.execute("SELECT * FROM readings WHERE id=?", (cur.lastrowid,)).fetchone()
    return h._json(
        200,
        {
            "ok": True,
            "reading": reading_row_to_log(r),
            "pool": _rollup_resp(db, pool["id"]),
        },
    )


def ep_reading_update(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:log_reading")
    if not pool:
        return
    rid = int(m[1])
    r = db.execute(
        "SELECT * FROM readings WHERE id=? AND pool_id=?", (rid, pool["id"])
    ).fetchone()
    if not r:
        return h._json(404, {"ok": False, "error": "not_found"})
    b = h.body
    sets, vals = [], []
    if "reading" in b:
        sets.append("reading_json=?")
        vals.append(json.dumps(clean_reading(b["reading"])))
    if "t" in b and b["t"]:
        sets.append("taken_at=?")
        vals.append(int(b["t"]))
    if "note" in b:
        sets.append("note=?")
        vals.append((b["note"] or "")[:1000])
    if sets:
        sets.append("updated_at=?")
        vals.append(auth.now_ms())
        vals += [rid, pool["id"]]
        db.execute(
            f"UPDATE readings SET {','.join(sets)} WHERE id=? AND pool_id=?", vals
        )
        auth.recompute_rollups(db, pool["id"])
    r = db.execute("SELECT * FROM readings WHERE id=?", (rid,)).fetchone()
    return h._json(
        200,
        {
            "ok": True,
            "reading": reading_row_to_log(r),
            "pool": _rollup_resp(db, pool["id"]),
        },
    )


def ep_reading_delete(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:log_reading")
    if not pool:
        return
    db.execute("DELETE FROM readings WHERE id=? AND pool_id=?", (int(m[1]), pool["id"]))
    db.commit()
    auth.recompute_rollups(db, pool["id"])
    return h._json(200, {"ok": True, "pool": _rollup_resp(db, pool["id"])})


# ---- doses (chemical additions) ----
def dose_row_to_obj(r):
    try:
        deltas = json.loads(r["deltas_json"])
    except Exception:
        deltas = {}
    try:
        baseline = json.loads(r["baseline_json"])
    except Exception:
        baseline = {}
    return {
        "id": r["id"],
        "t": r["added_at"],
        "chem": r["chem"],
        "amount": r["amount"],
        "unit": r["unit"],
        "pct": r["pct"],
        "note": r["note"] or "",
        "mixMin": r["mix_min"],
        "deltas": deltas,
        "baseline": baseline,
        "source": r["source"],
        "createdByName": r["created_by_name"] or "",
    }


def _dose_fields(b):
    """Extract + whitelist a dose payload (parallels clean_reading for readings)."""
    chem = str(b.get("chem") or "")[:40]
    try:
        amount = float(b.get("amount"))
    except (TypeError, ValueError):
        amount = 0.0
    unit = str(b.get("unit") or "")[:16]
    pct = b.get("pct")
    pct = str(pct)[:16] if pct not in (None, "") else None
    note = (b.get("note") or "")[:1000]
    try:
        mix_min = int(b.get("mixMin") or 30)
    except (TypeError, ValueError):
        mix_min = 30
    mix_min = max(0, min(mix_min, 60 * 24 * 14))  # cap at 14 days
    deltas = clean_reading(
        b.get("deltas")
    )  # whitelist RKEYS -> float (deltas may be negative)
    baseline = clean_reading(b.get("baseline"))
    t = int(b["t"]) if b.get("t") else auth.now_ms()
    return chem, amount, unit, pct, note, mix_min, deltas, baseline, t


def ep_doses_list(h, db, m):
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    rows = db.execute(
        "SELECT * FROM doses WHERE pool_id=? ORDER BY added_at", (pool["id"],)
    ).fetchall()
    return h._json(200, {"ok": True, "doses": [dose_row_to_obj(r) for r in rows]})


def ep_dose_create(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:log_reading")
    if not pool:
        return
    chem, amount, unit, pct, note, mix_min, deltas, baseline, t = _dose_fields(h.body)
    if not chem or amount <= 0:
        return h._json(400, {"ok": False, "error": "bad_dose"})
    now = auth.now_ms()
    src = "tech" if acc["relation"] in ("admin", "tech") else "owner"
    cur = db.execute(
        "INSERT INTO doses(pool_id, added_at, chem, amount, unit, pct, note, mix_min, deltas_json, "
        "baseline_json, source, created_by, created_by_name, created_at, updated_at) "
        "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            pool["id"],
            t,
            chem,
            amount,
            unit,
            pct,
            note,
            mix_min,
            json.dumps(deltas),
            json.dumps(baseline),
            src,
            h.user["id"],
            h.user["name"],
            now,
            now,
        ),
    )
    db.commit()
    r = db.execute("SELECT * FROM doses WHERE id=?", (cur.lastrowid,)).fetchone()
    return h._json(200, {"ok": True, "dose": dose_row_to_obj(r)})


def ep_dose_update(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:log_reading")
    if not pool:
        return
    did = int(m[1])
    r = db.execute(
        "SELECT * FROM doses WHERE id=? AND pool_id=?", (did, pool["id"])
    ).fetchone()
    if not r:
        return h._json(404, {"ok": False, "error": "not_found"})
    b = h.body
    sets, vals = [], []
    if "chem" in b:
        sets.append("chem=?")
        vals.append(str(b.get("chem") or "")[:40])
    if "amount" in b:
        try:
            amt = float(b["amount"])
        except (TypeError, ValueError):
            amt = 0.0
        sets.append("amount=?")
        vals.append(amt)
    if "unit" in b:
        sets.append("unit=?")
        vals.append(str(b.get("unit") or "")[:16])
    if "pct" in b:
        pct = b.get("pct")
        sets.append("pct=?")
        vals.append(str(pct)[:16] if pct not in (None, "") else None)
    if "note" in b:
        sets.append("note=?")
        vals.append((b.get("note") or "")[:1000])
    if "mixMin" in b:
        try:
            mm = int(b["mixMin"])
        except (TypeError, ValueError):
            mm = 30
        sets.append("mix_min=?")
        vals.append(max(0, min(mm, 60 * 24 * 14)))
    if "deltas" in b:
        sets.append("deltas_json=?")
        vals.append(json.dumps(clean_reading(b["deltas"])))
    if "baseline" in b:
        sets.append("baseline_json=?")
        vals.append(json.dumps(clean_reading(b["baseline"])))
    if "t" in b and b["t"]:
        sets.append("added_at=?")
        vals.append(int(b["t"]))
    if sets:
        sets.append("updated_at=?")
        vals.append(auth.now_ms())
        vals += [did, pool["id"]]
        db.execute(f"UPDATE doses SET {','.join(sets)} WHERE id=? AND pool_id=?", vals)
        db.commit()
    r = db.execute("SELECT * FROM doses WHERE id=?", (did,)).fetchone()
    return h._json(200, {"ok": True, "dose": dose_row_to_obj(r)})


def ep_dose_delete(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:log_reading")
    if not pool:
        return
    db.execute("DELETE FROM doses WHERE id=? AND pool_id=?", (int(m[1]), pool["id"]))
    db.commit()
    return h._json(200, {"ok": True})


# ---- alerts (written by the 24/7 engine, surfaced here) ----
def alert_row_to_obj(r):
    return {
        "id": r["id"],
        "poolId": r["pool_id"],
        "kind": r["kind"],
        "severity": r["severity"],
        "title": r["title"],
        "detail": r["detail"],
        "recommend": r["recommend"],
        "metric": r["metric"],
        "route": r["route"],
        "calc": r["calc"],
        "status": r["status"],
        "createdAt": r["created_at"],
        "updatedAt": r["updated_at"],
        "snoozeUntil": r["snooze_until"],
    }


def _visible_pool_ids(db, uid):
    """All pool ids this user can view (owned + per-user access + company membership)."""
    rows = db.execute(
        "SELECT DISTINCT p.id FROM pools p "
        "LEFT JOIN pool_access a ON a.pool_id=p.id AND a.user_id=? "
        "LEFT JOIN company_members cm ON cm.company_id=p.servicing_company_id AND cm.user_id=? AND cm.is_active=1 "
        "WHERE p.is_archived=0 AND (p.owner_user_id=? OR a.user_id=? OR cm.user_id IS NOT NULL)",
        (uid, uid, uid, uid),
    ).fetchall()
    return [r["id"] for r in rows]


def ep_alerts_list(h, db, m):
    if not h.require_session():
        return
    uid = h.user["id"]
    q = parse_qs(urlparse(h.path).query)
    pool_filter = q.get("poolId", [None])[0]
    ids = _visible_pool_ids(db, uid)
    if pool_filter:
        # a scoped request for a pool the caller can't see is a 404 (no existence leak),
        # checked BEFORE the empty-set shortcut so IDOR is consistently denied
        try:
            pf = int(pool_filter)
        except ValueError:
            return h._json(400, {"ok": False, "error": "bad_pool"})
        if pf not in ids:
            return h._json(404, {"ok": False, "error": "not_found"})
        ids = [pf]
    if not ids:
        return h._json(200, {"ok": True, "alerts": []})
    ph = ",".join("?" for _ in ids)
    rows = db.execute(
        f"SELECT * FROM alerts WHERE pool_id IN ({ph}) AND status IN ('active','snoozed','ack') "
        "ORDER BY CASE severity WHEN 'urgent' THEN 0 WHEN 'watch' THEN 1 ELSE 2 END, updated_at DESC",
        ids,
    ).fetchall()
    return h._json(200, {"ok": True, "alerts": [alert_row_to_obj(r) for r in rows]})


def ep_alerts_summary(h, db, m):
    """Cheap counts for the appbar bell badge."""
    if not h.require_session():
        return
    ids = _visible_pool_ids(db, h.user["id"])
    if not ids:
        return h._json(
            200, {"ok": True, "urgent": 0, "watch": 0, "info": 0, "total": 0}
        )
    ph = ",".join("?" for _ in ids)
    rows = db.execute(
        f"SELECT severity, COUNT(*) c FROM alerts WHERE pool_id IN ({ph}) AND status='active' GROUP BY severity",
        ids,
    ).fetchall()
    counts = {"urgent": 0, "watch": 0, "info": 0}
    for r in rows:
        counts[r["severity"]] = r["c"]
    counts["total"] = counts["urgent"] + counts["watch"] + counts["info"]
    counts["ok"] = True
    return h._json(200, counts)


def _alert_action(h, db, m, action):
    if not h.require_session() or not h.require_csrf():
        return
    aid = int(m[0])
    row = db.execute("SELECT * FROM alerts WHERE id=?", (aid,)).fetchone()
    if not row or row["pool_id"] not in _visible_pool_ids(db, h.user["id"]):
        return h._json(404, {"ok": False, "error": "not_found"})
    now = auth.now_ms()
    if action == "ack":
        db.execute(
            "UPDATE alerts SET status='ack', updated_at=? WHERE id=?", (now, aid)
        )
    elif action == "resolve":
        db.execute(
            "UPDATE alerts SET status='resolved', resolved_at=?, updated_at=? WHERE id=?",
            (now, now, aid),
        )
    elif action == "snooze":
        try:
            hrs = float(h.body.get("hours") or 24)
        except (TypeError, ValueError):
            hrs = 24
        until = now + int(max(1, min(hrs, 24 * 30)) * 3_600_000)
        db.execute(
            "UPDATE alerts SET status='snoozed', snooze_until=?, updated_at=? WHERE id=?",
            (until, now, aid),
        )
    db.commit()
    return h._json(200, {"ok": True})


def ep_alert_ack(h, db, m):
    return _alert_action(h, db, m, "ack")


def ep_alert_snooze(h, db, m):
    return _alert_action(h, db, m, "snooze")


def ep_alert_resolve(h, db, m):
    return _alert_action(h, db, m, "resolve")


def ep_engine_status(h, db, m):
    if not h.require_session():
        return
    s = db.execute("SELECT * FROM engine_status WHERE k='engine'").fetchone()
    if not s:
        return h._json(200, {"ok": True, "running": False})
    return h._json(
        200,
        {
            "ok": True,
            "running": True,
            "lastRunAt": s["last_run_at"],
            "lastOkAt": s["last_ok_at"],
            "poolsEvaluated": s["pools_evaluated"],
            "alertsActive": s["alerts_active"],
            "lastError": s["last_error"],
        },
    )


# ---- messages ----
def ep_messages_list(h, db, m):
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    uid = h.user["id"]
    company_side = acc["relation"] in ("admin", "tech")
    if company_side:
        rows = db.execute(
            "SELECT * FROM messages WHERE pool_id=? AND engagement_id=? ORDER BY created_at",
            (pool["id"], pool["engagement_id"]),
        ).fetchall()
    else:
        rows = db.execute(
            "SELECT * FROM messages WHERE pool_id=? ORDER BY created_at", (pool["id"],)
        ).fetchall()
    msgs = [
        {
            "id": r["id"],
            "senderId": r["sender_id"],
            "senderName": r["sender_name"],
            "senderRole": r["sender_role"],
            "body": r["body"],
            "photo": (r["photo"] if "photo" in r.keys() else None),
            "createdAt": r["created_at"],
            "mine": r["sender_id"] == uid,
            "code": (r["code"] if "code" in r.keys() else None),
            "severity": (r["severity"] if "severity" in r.keys() else None),
        }
        for r in rows
    ]
    return h._json(
        200, {"ok": True, "messages": msgs, "unread": unread_count(db, pool["id"], uid)}
    )


def ep_message_create(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:message")
    if not pool:
        return
    body = (h.body.get("body") or "").strip()[:4000]
    photo = h.body.get("photo")
    if photo is not None:
        photo = str(photo)
        # accept only an image data URL, already client-compressed; cap well under MAX_BODY
        if not photo.startswith("data:image/") or len(photo) > 1_200_000:
            photo = None
    if not body and not photo:
        return h._json(400, {"ok": False, "error": "empty"})
    ip = h._client_ip()
    if auth.rate_limited(db, "msg", ip, 30, 60_000):
        return h._json(
            429,
            {"ok": False, "error": "rate_limited", "message": "Slow down a moment."},
        )
    auth.rate_record(db, "msg", ip)
    role = (
        "owner"
        if acc["relation"] == "owner"
        else ("admin" if acc["relation"] == "admin" else "tech")
    )
    now = auth.now_ms()
    cur = db.execute(
        "INSERT INTO messages(pool_id, engagement_id, sender_id, sender_name, sender_role, body, photo, "
        "created_at) VALUES (?,?,?,?,?,?,?,?)",
        (
            pool["id"],
            pool["engagement_id"],
            h.user["id"],
            h.user["name"],
            role,
            body,
            photo,
            now,
        ),
    )
    db.execute(
        "INSERT INTO message_reads(pool_id, user_id, last_read_at) VALUES (?,?,?) "
        "ON CONFLICT(pool_id, user_id) DO UPDATE SET last_read_at=excluded.last_read_at",
        (pool["id"], h.user["id"], now),
    )
    db.commit()
    r = db.execute("SELECT * FROM messages WHERE id=?", (cur.lastrowid,)).fetchone()
    return h._json(
        200,
        {
            "ok": True,
            "message": {
                "id": r["id"],
                "senderId": r["sender_id"],
                "senderName": r["sender_name"],
                "senderRole": r["sender_role"],
                "body": r["body"],
                "photo": (r["photo"] if "photo" in r.keys() else None),
                "createdAt": r["created_at"],
                "mine": True,
            },
        },
    )


def ep_messages_read(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    now = auth.now_ms()
    db.execute(
        "INSERT INTO message_reads(pool_id, user_id, last_read_at) VALUES (?,?,?) "
        "ON CONFLICT(pool_id, user_id) DO UPDATE SET last_read_at=excluded.last_read_at",
        (pool["id"], h.user["id"], now),
    )
    db.commit()
    return h._json(200, {"ok": True, "unread": 0})


def ep_inbox(h, db, m):
    if not h.require_session():
        return
    uid = h.user["id"]
    # visible pools = owned/access + any pool of a company the user is an active member of
    pools = db.execute(
        "SELECT DISTINCT p.id, p.name FROM pools p "
        "LEFT JOIN pool_access a ON a.pool_id=p.id AND a.user_id=? "
        "LEFT JOIN company_members cm ON cm.company_id=p.servicing_company_id AND cm.user_id=? AND cm.is_active=1 "
        "WHERE (p.owner_user_id=? OR a.user_id=? OR cm.user_id=?) AND p.is_archived=0",
        (uid, uid, uid, uid, uid),
    ).fetchall()
    threads, total = [], 0
    for p in pools:
        u = unread_count(db, p["id"], uid)
        last = db.execute(
            "SELECT body, created_at FROM messages WHERE pool_id=? ORDER BY created_at DESC LIMIT 1",
            (p["id"],),
        ).fetchone()
        if last:
            total += u
            threads.append(
                {
                    "poolId": p["id"],
                    "poolName": p["name"],
                    "unread": u,
                    "lastMessageAt": last["created_at"],
                    "lastSnippet": (last["body"] or "")[:80],
                }
            )
    threads.sort(key=lambda t: t["lastMessageAt"], reverse=True)
    return h._json(200, {"ok": True, "threads": threads, "unreadTotal": total})


# ---- companies / roster ----
def ep_company_get(h, db, m):
    if not h.require_session():
        return
    cid = int(m[0])
    role = auth.company_role(db, h.user["id"], cid)
    if not role:
        return h._json(403, {"ok": False, "error": "forbidden"})
    c = db.execute("SELECT * FROM companies WHERE id=?", (cid,)).fetchone()
    if not c:
        return h._json(404, {"ok": False, "error": "not_found"})
    members = [
        dict(
            userId=r["user_id"],
            name=r["name"],
            email=r["email_display"],
            role=r["role"],
            isActive=bool(r["is_active"]),
        )
        for r in db.execute(
            "SELECT cm.user_id, cm.role, cm.is_active, u.name, u.email_display FROM company_members cm "
            "JOIN users u ON u.id=cm.user_id WHERE cm.company_id=? ORDER BY cm.role, u.name",
            (cid,),
        ).fetchall()
    ]
    stats = db.execute(
        "SELECT COUNT(*) pools, SUM(CASE WHEN attention_score>=40 THEN 1 ELSE 0 END) attn, "
        "SUM(CASE WHEN last_reading_at IS NULL THEN 1 ELSE 0 END) stale "
        "FROM pools WHERE servicing_company_id=? AND is_archived=0",
        (cid,),
    ).fetchone()
    return h._json(
        200,
        {
            "ok": True,
            "company": {
                "id": c["id"],
                "name": c["name"],
                "slug": c["slug"],
                "joinCode": c["join_code"],
                "phone": c["phone"],
                "email": c["email"],
                "region": c["region"],
                "settings": json.loads(c["settings_json"] or "{}"),
                "myRole": role,
            },
            "members": members,
            "stats": {
                "pools": stats["pools"] or 0,
                "needAttention": stats["attn"] or 0,
                "stale": stats["stale"] or 0,
            },
        },
    )


_SORT_MAP = {
    "attention": "attention_score DESC, last_reading_at",
    "address": "postal_code, address_line1",
    "last_tested": "last_reading_at DESC",
    "name": "name COLLATE NOCASE",
}


def ep_roster(h, db, m):
    if not h.require_session():
        return
    cid = int(m[0])
    if not auth.company_role(db, h.user["id"], cid):
        return h._json(403, {"ok": False, "error": "forbidden"})
    q = parse_qs(urlparse(h.path).query)
    sort = _SORT_MAP.get((q.get("sort", ["attention"])[0]), _SORT_MAP["attention"])
    status = q.get("status", [""])[0]
    search = (q.get("q", [""])[0] or "").strip()
    try:
        page = max(1, int(q.get("page", ["1"])[0]))
        size = min(100, max(1, int(q.get("pageSize", ["50"])[0])))
    except ValueError:
        page, size = 1, 50
    where = ["servicing_company_id=?", "is_archived=0"]
    args = [cid]
    if search:
        where.append(
            "(name LIKE ? OR address_line1 LIKE ? OR city LIKE ? OR postal_code LIKE ?)"
        )
        args += [f"%{search}%"] * 4
    if status == "needs_attention":
        where.append("attention_score>=40")
    elif status == "stale":
        where.append("last_reading_at IS NULL")
    total = db.execute(
        f"SELECT COUNT(*) c FROM pools WHERE {' AND '.join(where)}", args
    ).fetchone()["c"]
    rows = db.execute(
        f"SELECT * FROM pools WHERE {' AND '.join(where)} ORDER BY {sort} LIMIT ? OFFSET ?",
        args + [size, (page - 1) * size],
    ).fetchall()
    uid = h.user["id"]
    pools = []
    for p in rows:
        owner = None
        if p["owner_user_id"]:
            o = db.execute(
                "SELECT name FROM users WHERE id=?", (p["owner_user_id"],)
            ).fetchone()
            owner = o["name"] if o else None
        pools.append(
            {
                "id": p["id"],
                "name": p["name"],
                "owner": owner,
                "address": {
                    "line1": p["address_line1"],
                    "city": p["city"],
                    "postalCode": p["postal_code"],
                },
                "lastReadingAt": p["last_reading_at"],
                "lastVisitAt": p["last_visit_at"],
                "attentionScore": p["attention_score"],
                "attentionFlags": json.loads(p["attention_flags_json"] or "[]"),
                "effectiveLatest": json.loads(p["effective_latest_json"] or "{}"),
                "unread": unread_count(db, p["id"], uid),
            }
        )
    return h._json(200, {"ok": True, "total": total, "page": page, "pools": pools})


def ep_company_join(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    ip = h._client_ip()
    if auth.rate_limited(db, "join", ip, 10, 60_000):
        return h._json(
            429,
            {
                "ok": False,
                "error": "rate_limited",
                "message": "Too many attempts — try again shortly.",
            },
        )
    auth.rate_record(db, "join", ip)
    code = (h.body.get("code") or "").strip().upper()
    co = db.execute("SELECT * FROM companies WHERE join_code=?", (code,)).fetchone()
    if not co:
        return h._json(404, {"ok": False, "error": "bad_code"})
    db.execute(
        "INSERT INTO company_members(company_id, user_id, role, created_at) VALUES (?,?,?,?) "
        "ON CONFLICT(company_id, user_id) DO UPDATE SET is_active=1",
        (co["id"], h.user["id"], "tech", auth.now_ms()),
    )
    db.commit()
    return h._json(200, {"ok": True, "companies": companies_for(db, h.user["id"])})


def ep_company_leave(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    cid = int(m[0])
    uid = h.user["id"]
    mem = db.execute(
        "SELECT role FROM company_members WHERE company_id=? AND user_id=?",
        (cid, uid),
    ).fetchone()
    if not mem:
        return h._json(404, {"ok": False, "error": "not_member"})
    if mem["role"] == "admin":
        admins = db.execute(
            "SELECT COUNT(*) c FROM company_members WHERE company_id=? AND role='admin' AND is_active=1",
            (cid,),
        ).fetchone()["c"]
        if admins <= 1:
            return h._json(
                409,
                {
                    "ok": False,
                    "error": "last_admin",
                    "message": "Promote another admin before you leave.",
                },
            )
    db.execute(
        "DELETE FROM company_members WHERE company_id=? AND user_id=?", (cid, uid)
    )
    try:
        db.execute(
            "DELETE FROM pool_assignments WHERE company_id=? AND account_id=?",
            (cid, uid),
        )
    except Exception:
        pass  # pool_assignments table may not exist yet
    db.commit()
    return h._json(200, {"ok": True, "companies": companies_for(db, uid)})


def ep_pool_invite(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    uid = h.user["id"]
    is_owner = pool["owner_user_id"] == uid
    is_admin = (
        bool(pool["servicing_company_id"])
        and auth.company_role(db, uid, pool["servicing_company_id"]) == "admin"
    )
    if not (is_owner or is_admin):
        return h._json(403, {"ok": False, "error": "forbidden"})
    code = pool["invite_code"] if "invite_code" in pool.keys() else None
    if not code:
        code = auth.gen_invite_code(db)
        db.execute(
            "UPDATE pools SET invite_code=?, updated_at=? WHERE id=?",
            (code, auth.now_ms(), pool["id"]),
        )
        db.commit()
    return h._json(200, {"ok": True, "code": code})


def ep_pool_claim(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    ip = h._client_ip()
    if auth.rate_limited(db, "claim", ip, 10, 60_000):
        return h._json(
            429,
            {
                "ok": False,
                "error": "rate_limited",
                "message": "Too many attempts — try again shortly.",
            },
        )
    auth.rate_record(db, "claim", ip)
    code = (h.body.get("code") or "").strip().upper()
    if not code:
        return h._json(400, {"ok": False, "error": "bad_code"})
    pool = db.execute(
        "SELECT * FROM pools WHERE invite_code=? AND is_archived=0", (code,)
    ).fetchone()
    if not pool:
        return h._json(404, {"ok": False, "error": "bad_code"})
    uid = h.user["id"]
    now = auth.now_ms()
    old_owner = pool["owner_user_id"]
    db.execute(
        "UPDATE pools SET owner_user_id=?, invite_code=NULL, updated_at=? WHERE id=?",
        (uid, now, pool["id"]),
    )
    if old_owner and old_owner != uid:
        db.execute(
            "DELETE FROM pool_access WHERE pool_id=? AND user_id=? AND relation='owner'",
            (pool["id"], old_owner),
        )
    existing = db.execute(
        "SELECT id FROM pool_access WHERE pool_id=? AND user_id=?", (pool["id"], uid)
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE pool_access SET relation='owner', can_log_reading=1, can_edit_profile=1, can_message=1 WHERE id=?",
            (existing["id"],),
        )
    else:
        db.execute(
            "INSERT INTO pool_access(pool_id, user_id, relation, can_log_reading, can_edit_profile, can_message, granted_by, created_at) "
            "VALUES (?,?,?,1,1,1,?,?)",
            (pool["id"], uid, "owner", uid, now),
        )
    db.commit()
    try:
        auth.recompute_rollups(db, pool["id"])
        db.commit()
    except Exception:
        pass
    return h._json(200, {"ok": True, "pool": {"id": pool["id"], "name": pool["name"]}})


def ep_member_update(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    cid, target = int(m[0]), int(m[1])
    if auth.company_role(db, h.user["id"], cid) != "admin":
        return h._json(403, {"ok": False, "error": "forbidden"})
    b = h.body
    # last-admin guard
    if b.get("role") == "tech" or b.get("isActive") is False:
        admins = db.execute(
            "SELECT COUNT(*) c FROM company_members WHERE company_id=? AND role='admin' AND is_active=1",
            (cid,),
        ).fetchone()["c"]
        tgt = db.execute(
            "SELECT role, is_active FROM company_members WHERE company_id=? AND user_id=?",
            (cid, target),
        ).fetchone()
        if tgt and tgt["role"] == "admin" and tgt["is_active"] and admins <= 1:
            return h._json(
                409,
                {
                    "ok": False,
                    "error": "last_admin",
                    "message": "Promote another admin before changing the last one.",
                },
            )
    sets, vals = [], []
    if b.get("role") in ("admin", "tech"):
        sets.append("role=?")
        vals.append(b["role"])
    if "isActive" in b:
        sets.append("is_active=?")
        vals.append(1 if b["isActive"] else 0)
    if sets:
        vals += [cid, target]
        db.execute(
            f"UPDATE company_members SET {','.join(sets)} WHERE company_id=? AND user_id=?",
            vals,
        )
        db.commit()
    return h._json(200, {"ok": True})


# ---- import / export / legacy state ----
def _import_state(db, state, owner_id, import_key=None):
    profile = state.get("profile") if isinstance(state.get("profile"), dict) else {}
    if import_key:
        ex = db.execute(
            "SELECT pool_id FROM imports WHERE user_id=? AND import_key=?",
            (owner_id, import_key),
        ).fetchone()
        if ex:
            return ex["pool_id"], 0
    pid = _create_pool(db, profile, state.get("slam"), owner_id, owner_id, None)
    n = 0
    name = db.execute("SELECT name FROM users WHERE id=?", (owner_id,)).fetchone()[
        "name"
    ]
    now = auth.now_ms()
    for e in state.get("log") or []:
        rd = clean_reading(e.get("reading"))
        db.execute(
            "INSERT INTO readings(pool_id, taken_at, reading_json, note, source, created_by, "
            "created_by_name, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?)",
            (
                pid,
                int(e.get("t") or now),
                json.dumps(rd),
                (e.get("note") or "")[:1000],
                "import",
                owner_id,
                name,
                now,
                now,
            ),
        )
        n += 1
    for d in state.get("doses") or []:
        try:
            amount = float(d.get("amount") or 0)
        except (TypeError, ValueError):
            amount = 0.0
        if amount <= 0 or not d.get("chem"):
            continue
        pctv = d.get("pct")
        db.execute(
            "INSERT INTO doses(pool_id, added_at, chem, amount, unit, pct, note, mix_min, deltas_json, "
            "baseline_json, source, created_by, created_by_name, created_at, updated_at) "
            "VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
            (
                pid,
                int(d.get("t") or now),
                str(d.get("chem"))[:40],
                amount,
                str(d.get("unit") or "")[:16],
                (str(pctv)[:16] if pctv not in (None, "") else None),
                (d.get("note") or "")[:1000],
                int(d.get("mixMin") or 30),
                json.dumps(clean_reading(d.get("deltas"))),
                json.dumps(clean_reading(d.get("baseline"))),
                "import",
                owner_id,
                name,
                now,
                now,
            ),
        )
    if import_key:
        db.execute(
            "INSERT OR IGNORE INTO imports(user_id, import_key, pool_id, created_at) VALUES (?,?,?,?)",
            (owner_id, import_key, pid, now),
        )
    db.commit()
    auth.recompute_rollups(db, pid)
    return pid, n


def ep_import(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    state = h.body.get("state")
    if not isinstance(state, dict):
        return h._json(400, {"ok": False, "error": "bad_state"})
    cap = db.execute(
        "SELECT COUNT(*) c FROM pools WHERE owner_user_id=? AND is_archived=0",
        (h.user["id"],),
    ).fetchone()["c"]
    if cap >= auth.HOMEOWNER_POOL_CAP:
        return h._json(409, {"ok": False, "error": "pool_limit"})
    pid, n = _import_state(db, state, h.user["id"], h.body.get("importKey"))
    pool = db.execute("SELECT * FROM pools WHERE id=?", (pid,)).fetchone()
    return h._json(
        200,
        {
            "ok": True,
            "pool": pool_public(
                db, pool, auth.effective_access(db, h.user, pool), h.user
            ),
            "readingsImported": n,
        },
    )


def _pool_state(db, pool):
    rows = db.execute(
        "SELECT * FROM readings WHERE pool_id=? ORDER BY taken_at", (pool["id"],)
    ).fetchall()
    drows = db.execute(
        "SELECT * FROM doses WHERE pool_id=? ORDER BY added_at", (pool["id"],)
    ).fetchall()
    return {
        "profile": json.loads(pool["profile_json"] or "{}"),
        "log": [reading_row_to_log(r) for r in rows],
        "doses": [dose_row_to_obj(r) for r in drows],
        "slam": json.loads(pool["slam_json"]) if pool["slam_json"] else None,
        "savedAt": pool["updated_at"],
    }


def ep_export(h, db, m):
    if not h.require_session():
        return
    rows = db.execute(
        "SELECT * FROM pools WHERE owner_user_id=? AND is_archived=0", (h.user["id"],)
    ).fetchall()
    return h._json(200, {"ok": True, "pools": [_pool_state(db, p) for p in rows]})


def ep_pool_export(h, db, m):
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    return h._json(200, {"ok": True, "state": _pool_state(db, pool)})


def _default_pool(db, uid, create=False):
    p = db.execute(
        "SELECT * FROM pools WHERE owner_user_id=? AND is_archived=0 ORDER BY created_at LIMIT 1",
        (uid,),
    ).fetchone()
    if p or not create:
        return p
    pid = _create_pool(db, {"name": "My Pool"}, None, uid, uid, None)
    return db.execute("SELECT * FROM pools WHERE id=?", (pid,)).fetchone()


def ep_state_get(h, db, m):
    # legacy shim: file mode while there are no accounts (keeps the offline app working)
    if _users_empty(db):
        if LEGACY_FILE.exists():
            try:
                return h._json(
                    200,
                    {
                        "ok": True,
                        "state": json.loads(LEGACY_FILE.read_text(encoding="utf-8")),
                    },
                )
            except Exception:
                pass
        return h._json(200, {"ok": True, "state": None})
    if not h.require_session():
        return
    pool = _default_pool(db, h.user["id"])
    return h._json(200, {"ok": True, "state": _pool_state(db, pool) if pool else None})


def ep_state_post(h, db, m):
    if _users_empty(db):
        try:
            LEGACY_FILE.write_text(json.dumps(h.body, indent=2), encoding="utf-8")
        except Exception:
            pass
        return h._json(200, {"ok": True})
    if not h.require_session() or not h.require_csrf():
        return
    pool = _default_pool(db, h.user["id"], create=True)
    db.execute(
        "UPDATE pools SET profile_json=?, slam_json=?, updated_at=? WHERE id=?",
        (
            json.dumps(h.body.get("profile") or {}),
            json.dumps(h.body.get("slam")) if h.body.get("slam") else None,
            auth.now_ms(),
            pool["id"],
        ),
    )
    db.commit()
    auth.recompute_rollups(db, pool["id"])
    return h._json(200, {"ok": True})


# --------------------------------------------------------------------------- service visits, assignments, route, reports, audit (Phase 3)
def _log_access(db, pid, h, relation, action):
    try:
        db.execute(
            "INSERT INTO access_log(pool_id, account_id, account_name, relation, action, at) VALUES (?,?,?,?,?,?)",
            (pid, h.user["id"], h.user["name"], relation or "", action, auth.now_ms()),
        )
        db.commit()
    except Exception:
        pass


def _visit_public(r):
    return {
        "id": r["id"],
        "poolId": r["pool_id"],
        "by": r["account_name"],
        "startedAt": r["started_at"],
        "completedAt": r["completed_at"],
        "checklist": json.loads(r["checklist_json"] or "{}"),
        "dosed": json.loads(r["dosed_json"] or "[]"),
        "summary": r["summary"],
        "status": r["status"],
    }


def ep_visits_list(h, db, m):
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    rows = db.execute(
        "SELECT * FROM visits WHERE pool_id=? ORDER BY started_at DESC LIMIT 50",
        (pool["id"],),
    ).fetchall()
    return h._json(200, {"ok": True, "visits": [_visit_public(r) for r in rows]})


def ep_visit_create(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:log_reading")
    if not pool:
        return
    now = auth.now_ms()
    cur = db.execute(
        "INSERT INTO visits(pool_id, company_id, account_id, account_name, started_at, status, created_at) "
        "VALUES (?,?,?,?,?, 'open', ?)",
        (
            pool["id"],
            pool["servicing_company_id"],
            h.user["id"],
            h.user["name"],
            now,
            now,
        ),
    )
    db.commit()
    _log_access(db, pool["id"], h, acc["relation"], "started a visit")
    r = db.execute("SELECT * FROM visits WHERE id=?", (cur.lastrowid,)).fetchone()
    return h._json(200, {"ok": True, "visit": _visit_public(r)})


def ep_visit_update(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:log_reading")
    if not pool:
        return
    vid = int(m[1])
    v = db.execute(
        "SELECT * FROM visits WHERE id=? AND pool_id=?", (vid, pool["id"])
    ).fetchone()
    if not v:
        return h._json(404, {"ok": False, "error": "not_found"})
    b = h.body
    checklist = json.dumps(
        b.get("checklist")
        if isinstance(b.get("checklist"), (dict, list))
        else json.loads(v["checklist_json"] or "{}")
    )
    dosed = json.dumps(
        b.get("dosed")
        if isinstance(b.get("dosed"), list)
        else json.loads(v["dosed_json"] or "[]")
    )
    summary = (b.get("summary") or v["summary"] or "")[:2000]
    now = auth.now_ms()
    if b.get("complete"):
        db.execute(
            "UPDATE visits SET checklist_json=?, dosed_json=?, summary=?, status='completed', completed_at=? WHERE id=?",
            (checklist, dosed, summary, now, vid),
        )
        db.execute("UPDATE pools SET last_visit_at=? WHERE id=?", (now, pool["id"]))
        role = (
            "admin"
            if acc["relation"] == "admin"
            else ("tech" if acc["relation"] == "tech" else "owner")
        )
        body = "✅ Service visit complete." + ((" " + summary) if summary else "")
        db.execute(
            "INSERT INTO messages(pool_id, engagement_id, sender_id, sender_name, sender_role, body, kind, created_at) "
            "VALUES (?,?,?,?,?,?, 'user', ?)",
            (
                pool["id"],
                pool["engagement_id"],
                h.user["id"],
                h.user["name"],
                role,
                body,
                now,
            ),
        )
        db.commit()
        _log_access(db, pool["id"], h, acc["relation"], "completed a visit")
    else:
        db.execute(
            "UPDATE visits SET checklist_json=?, dosed_json=?, summary=? WHERE id=?",
            (checklist, dosed, summary, vid),
        )
        db.commit()
    r = db.execute("SELECT * FROM visits WHERE id=?", (vid,)).fetchone()
    return h._json(200, {"ok": True, "visit": _visit_public(r)})


def ep_pool_assign(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    cid = pool["servicing_company_id"]
    if not cid or auth.company_role(db, h.user["id"], cid) != "admin":
        return h._json(403, {"ok": False, "error": "forbidden"})
    b = h.body
    tech_id = b.get("accountId")
    if not tech_id or not auth.company_role(db, tech_id, cid):
        return h._json(400, {"ok": False, "error": "bad_tech"})
    dow = b.get("dayOfWeek")
    order = int(b.get("sortOrder") or 0)
    now = auth.now_ms()
    existing = db.execute(
        "SELECT id FROM pool_assignments WHERE pool_id=? AND account_id=?",
        (pool["id"], tech_id),
    ).fetchone()
    if existing:
        db.execute(
            "UPDATE pool_assignments SET day_of_week=?, sort_order=?, active=1 WHERE id=?",
            (dow, order, existing["id"]),
        )
    else:
        db.execute(
            "INSERT INTO pool_assignments(pool_id, company_id, account_id, day_of_week, sort_order, active, created_at) "
            "VALUES (?,?,?,?,?,1,?)",
            (pool["id"], cid, tech_id, dow, order, now),
        )
    db.commit()
    return h._json(200, {"ok": True})


def ep_pool_unassign(h, db, m):
    if not h.require_session() or not h.require_csrf():
        return
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    cid = pool["servicing_company_id"]
    if not cid or auth.company_role(db, h.user["id"], cid) != "admin":
        return h._json(403, {"ok": False, "error": "forbidden"})
    db.execute(
        "DELETE FROM pool_assignments WHERE pool_id=? AND account_id=?",
        (pool["id"], int(m[1])),
    )
    db.commit()
    return h._json(200, {"ok": True})


def ep_route(h, db, m):
    if not h.require_session():
        return
    rows = db.execute(
        "SELECT p.* FROM pool_assignments a JOIN pools p ON p.id=a.pool_id "
        "WHERE a.account_id=? AND a.active=1 AND p.is_archived=0 "
        "ORDER BY a.sort_order, p.attention_score DESC",
        (h.user["id"],),
    ).fetchall()
    stops = [
        {
            "id": p["id"],
            "name": p["name"],
            "address": {
                "line1": p["address_line1"],
                "city": p["city"],
                "postalCode": p["postal_code"],
            },
            "attentionScore": p["attention_score"],
            "attentionFlags": json.loads(p["attention_flags_json"] or "[]"),
            "lastReadingAt": p["last_reading_at"],
            "lastVisitAt": p["last_visit_at"],
        }
        for p in rows
    ]
    return h._json(200, {"ok": True, "stops": stops})


def ep_company_reports(h, db, m):
    if not h.require_session():
        return
    cid = int(m[0])
    if auth.company_role(db, h.user["id"], cid) != "admin":
        return h._json(403, {"ok": False, "error": "forbidden"})
    now = auth.now_ms()
    cutoff = now - 30 * 86400000
    week = now - 7 * 86400000
    q = lambda sql, args: db.execute(sql, args).fetchone()["c"]
    pools_total = q(
        "SELECT COUNT(*) c FROM pools WHERE servicing_company_id=? AND is_archived=0",
        (cid,),
    )
    overdue = q(
        "SELECT COUNT(*) c FROM pools WHERE servicing_company_id=? AND is_archived=0 AND (last_reading_at IS NULL OR last_reading_at < ?)",
        (cid, week),
    )
    visits_done = q(
        "SELECT COUNT(*) c FROM visits WHERE company_id=? AND status='completed' AND completed_at>=?",
        (cid, cutoff),
    )
    per_tech = db.execute(
        "SELECT account_name, COUNT(*) c FROM visits WHERE company_id=? AND status='completed' AND completed_at>=? GROUP BY account_id ORDER BY c DESC",
        (cid, cutoff),
    ).fetchall()
    chem = db.execute(
        "SELECT d.chem, COUNT(*) n, SUM(d.amount) amt FROM doses d JOIN pools p ON p.id=d.pool_id "
        "WHERE p.servicing_company_id=? AND d.added_at>=? GROUP BY d.chem ORDER BY n DESC",
        (cid, cutoff),
    ).fetchall()
    return h._json(
        200,
        {
            "ok": True,
            "report": {
                "poolsTotal": pools_total,
                "overdue": overdue,
                "visitsDone30d": visits_done,
                "perTech": [
                    {"name": r["account_name"], "visits": r["c"]} for r in per_tech
                ],
                "chemUsage": [
                    {
                        "chem": r["chem"],
                        "count": r["n"],
                        "amount": round(r["amt"] or 0, 2),
                    }
                    for r in chem
                ],
            },
        },
    )


def ep_access_log(h, db, m):
    pool, acc = h.require_pool(db, int(m[0]), "pool:view")
    if not pool:
        return
    rows = db.execute(
        "SELECT * FROM access_log WHERE pool_id=? ORDER BY at DESC LIMIT 50",
        (pool["id"],),
    ).fetchall()
    return h._json(
        200,
        {
            "ok": True,
            "log": [
                {
                    "by": r["account_name"],
                    "relation": r["relation"],
                    "action": r["action"],
                    "at": r["at"],
                }
                for r in rows
            ],
        },
    )


# =========================================================================== routes
def R(method, pattern):
    return (method, re.compile("^" + pattern + "$"))


ROUTES = [
    R("POST", r"/api/auth/signup") + (ep_signup,),
    R("POST", r"/api/auth/login") + (ep_login,),
    R("POST", r"/api/auth/logout") + (ep_logout,),
    R("GET", r"/api/auth/me") + (ep_me,),
    R("PATCH", r"/api/auth/me") + (ep_me_update,),
    R("POST", r"/api/auth/password") + (ep_password,),
    R("GET", r"/api/pools") + (ep_pools_list,),
    R("POST", r"/api/pools") + (ep_pools_create,),
    R("GET", r"/api/pools/(\d+)") + (ep_pool_get,),
    R("PATCH", r"/api/pools/(\d+)") + (ep_pool_update,),
    R("DELETE", r"/api/pools/(\d+)") + (ep_pool_delete,),
    R("PATCH", r"/api/pools/(\d+)/location") + (ep_pool_location,),
    R("POST", r"/api/pools/(\d+)/link-company") + (ep_link_company,),
    R("POST", r"/api/pools/(\d+)/unlink-company") + (ep_unlink_company,),
    R("GET", r"/api/pools/(\d+)/readings") + (ep_readings_list,),
    R("POST", r"/api/pools/(\d+)/readings") + (ep_reading_create,),
    R("PATCH", r"/api/pools/(\d+)/readings/(\d+)") + (ep_reading_update,),
    R("DELETE", r"/api/pools/(\d+)/readings/(\d+)") + (ep_reading_delete,),
    R("GET", r"/api/pools/(\d+)/doses") + (ep_doses_list,),
    R("POST", r"/api/pools/(\d+)/doses") + (ep_dose_create,),
    R("PATCH", r"/api/pools/(\d+)/doses/(\d+)") + (ep_dose_update,),
    R("DELETE", r"/api/pools/(\d+)/doses/(\d+)") + (ep_dose_delete,),
    R("GET", r"/api/alerts") + (ep_alerts_list,),
    R("GET", r"/api/alerts/summary") + (ep_alerts_summary,),
    R("POST", r"/api/alerts/(\d+)/ack") + (ep_alert_ack,),
    R("POST", r"/api/alerts/(\d+)/snooze") + (ep_alert_snooze,),
    R("POST", r"/api/alerts/(\d+)/resolve") + (ep_alert_resolve,),
    R("GET", r"/api/engine/status") + (ep_engine_status,),
    R("GET", r"/api/pools/(\d+)/messages") + (ep_messages_list,),
    R("POST", r"/api/pools/(\d+)/messages") + (ep_message_create,),
    R("POST", r"/api/pools/(\d+)/messages/read") + (ep_messages_read,),
    R("GET", r"/api/pools/(\d+)/export") + (ep_pool_export,),
    R("GET", r"/api/inbox") + (ep_inbox,),
    R("GET", r"/api/companies/(\d+)") + (ep_company_get,),
    R("GET", r"/api/companies/(\d+)/pools") + (ep_roster,),
    R("PATCH", r"/api/companies/(\d+)/members/(\d+)") + (ep_member_update,),
    R("POST", r"/api/companies/join") + (ep_company_join,),
    R("POST", r"/api/companies/(\d+)/leave") + (ep_company_leave,),
    R("POST", r"/api/pools/claim") + (ep_pool_claim,),
    R("POST", r"/api/pools/(\d+)/invite") + (ep_pool_invite,),
    R("GET", r"/api/pools/(\d+)/visits") + (ep_visits_list,),
    R("POST", r"/api/pools/(\d+)/visits") + (ep_visit_create,),
    R("PATCH", r"/api/pools/(\d+)/visits/(\d+)") + (ep_visit_update,),
    R("POST", r"/api/pools/(\d+)/assign") + (ep_pool_assign,),
    R("DELETE", r"/api/pools/(\d+)/assign/(\d+)") + (ep_pool_unassign,),
    R("GET", r"/api/pools/(\d+)/access-log") + (ep_access_log,),
    R("GET", r"/api/route") + (ep_route,),
    R("GET", r"/api/companies/(\d+)/reports") + (ep_company_reports,),
    R("POST", r"/api/import") + (ep_import,),
    R("GET", r"/api/export") + (ep_export,),
    R("GET", r"/api/state") + (ep_state_get,),
    R("POST", r"/api/state") + (ep_state_post,),
]


# =========================================================================== boot
def lan_ip():
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


class Server(socketserver.ThreadingTCPServer):
    allow_reuse_address = True
    daemon_threads = True


if __name__ == "__main__":
    ip = lan_ip()
    print("=" * 60)
    print("  Poolaris portal is running.")
    print(f"  On this computer:   http://localhost:{PORT}")
    if ip and BIND == "0.0.0.0":
        print(f"  On your phone/LAN:  http://{ip}:{PORT}")
    print(f"  Database:           {DB_PATH}")
    print(
        f"  Bind:               {BIND}  ({'LAN-exposed' if BIND == '0.0.0.0' else 'localhost only — set POOLARIS_BIND_ALL=1 for LAN'})"
    )
    print("  Press Ctrl+C to stop.")
    print("=" * 60)

    # Start the always-on smart engine (24/7 pool watcher). Crash-isolated:
    # a failure in the watcher can never take down the HTTP server. Disable with
    # POOLARIS_ENGINE=0 (e.g. for a pure static/offline deployment).
    engine_stop = None
    if os.environ.get("POOLARIS_ENGINE", "1") != "0":
        try:
            import engine

            tick = int(os.environ.get("POOLARIS_ENGINE_TICK", str(engine.TICK_SECONDS)))
            _, engine_stop = engine.start_engine(DB_PATH, tick_seconds=tick)
            print(
                f"  Smart engine:       on (sweeps every {tick}s) — watching pools 24/7"
            )
        except Exception as e:
            print(
                f"  Smart engine:       failed to start ({e}); the app runs without it"
            )
    else:
        print("  Smart engine:       off (POOLARIS_ENGINE=0)")

    # integrity check + backup snapshot on startup, then a daily one for long-running hosts
    try:
        backup_db()
        print("  Backups:            data/backups/ (integrity OK, last 14 kept)")
    except Exception as e:
        print(f"  Backups:            skipped ({e})")

    def _backup_loop():
        import time

        while True:
            time.sleep(24 * 3600)
            try:
                backup_db()
            except Exception:
                LOG.exception("daily backup failed")

    threading.Thread(target=_backup_loop, daemon=True).start()
    print("=" * 60)

    # auto-open a browser only for local desktop use; a hosted/headless run can opt out
    if not os.environ.get("POOLARIS_NO_BROWSER"):
        try:
            threading.Timer(
                0.8, lambda: webbrowser.open(f"http://localhost:{PORT}")
            ).start()
        except Exception:
            pass
    with Server((BIND, PORT), Handler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nStopping…")
        finally:
            if engine_stop:
                engine_stop.set()
