/* ============================================================================
   POOLARIS — API client  (window.API)
   ---------------------------------------------------------------------------
   Thin, same-origin fetch wrapper for the portal backend (see server.py).
   - Session rides an httpOnly `sid` cookie (credentials: same-origin).
   - Mutations send the session-bound CSRF token in `X-Poolaris-CSRF`
     (obtained from /api/auth/me) and are retried once if the token is stale.
   - 401 → the registered onUnauthorized handler (the auth gate) is invoked.
   - A durable localStorage OUTBOX queues reading/dose/message writes made while
     offline and replays them in order on reconnect (poolside resilience).

   This file only DEFINES window.API; it does nothing until app/auth call it.
   ========================================================================== */
(function (global) {
  "use strict";

  let _csrf = null;
  let _onUnauth = null;
  let _online = (typeof navigator === "undefined") || navigator.onLine !== false;

  function setUnauthorizedHandler(fn) { _onUnauth = fn; }
  function csrf() { return _csrf; }
  function setCsrf(t) { if (t) _csrf = t; }

  /* ----------------------------- core request -------------------------- */
  async function request(method, path, body, opts) {
    opts = opts || {};
    const headers = {};
    let payload;
    if (body !== undefined && body !== null && !(body instanceof (global.FormData || function () {}))) {
      headers["Content-Type"] = "application/json";
      payload = JSON.stringify(body);
    } else {
      payload = body == null ? undefined : body;
    }
    if (method !== "GET" && method !== "HEAD" && _csrf) headers["X-Poolaris-CSRF"] = _csrf;

    let res;
    try {
      res = await fetch(path, { method: method, headers: headers, body: payload, credentials: "same-origin", cache: "no-store" });
    } catch (e) {
      const err = new Error("network"); err.network = true; throw err;
    }

    let data = null;
    const ct = res.headers.get("content-type") || "";
    if (ct.indexOf("application/json") >= 0) { try { data = await res.json(); } catch (e) { data = null; } }

    if (res.status === 401 && !opts.noAuthRedirect) { if (_onUnauth) _onUnauth(); }

    if (!res.ok) {
      // one automatic retry if the CSRF token went stale
      if (res.status === 403 && data && data.error === "csrf" && !opts._retried) {
        await refreshCsrf();
        return request(method, path, body, Object.assign({}, opts, { _retried: true }));
      }
      const err = new Error((data && (data.message || data.error)) || ("http_" + res.status));
      err.status = res.status; err.data = data; throw err;
    }
    return data;
  }
  async function refreshCsrf() {
    try { const me = await request("GET", "/api/auth/me", null, { noAuthRedirect: true }); if (me && me.csrf) _csrf = me.csrf; } catch (e) { /* ignore */ }
  }

  /* ----------------------------- auth ---------------------------------- */
  async function session() {
    try {
      const d = await request("GET", "/api/auth/me", null, { noAuthRedirect: true });
      if (d && d.ok) { if (d.csrf) _csrf = d.csrf; return d; }
      return null;
    } catch (e) { if (e.status === 401) return null; throw e; }
  }
  async function signup(payload) { const d = await request("POST", "/api/auth/signup", payload, { noAuthRedirect: true }); if (d && d.csrf) _csrf = d.csrf; return d; }
  async function login(payload) { const d = await request("POST", "/api/auth/login", payload, { noAuthRedirect: true }); if (d && d.csrf) _csrf = d.csrf; return d; }
  async function logout() { const d = await request("POST", "/api/auth/logout", {}, { noAuthRedirect: true }); _csrf = null; return d; }
  function updateMe(payload) { return request("PATCH", "/api/auth/me", payload); }
  function changePassword(payload) { return request("POST", "/api/auth/password", payload); }

  /* ----------------------------- pools --------------------------------- */
  function pools() { return request("GET", "/api/pools"); }
  function createPool(payload) { return request("POST", "/api/pools", payload); }
  function pool(id) { return request("GET", "/api/pools/" + id); }
  function savePool(id, payload) { return request("PATCH", "/api/pools/" + id, payload); }
  function deletePool(id, hard) { return request("DELETE", "/api/pools/" + id + (hard ? "?hard=1" : "")); }
  function setLocation(id, payload) { return request("POST", "/api/pools/" + id + "/location", payload); }
  function linkCompany(id, joinCode, replace) { return request("POST", "/api/pools/" + id + "/link-company" + (replace ? "?replace=1" : ""), { joinCode: joinCode }); }
  function unlinkCompany(id) { return request("POST", "/api/pools/" + id + "/unlink-company", {}); }

  /* ----------------------------- readings ------------------------------ */
  function readings(id, params) { return request("GET", "/api/pools/" + id + "/readings" + qs(params)); }
  function addReading(id, entry) { return request("POST", "/api/pools/" + id + "/readings", entry); }
  function updateReading(id, rid, entry) { return request("PATCH", "/api/pools/" + id + "/readings/" + rid, entry); }
  function deleteReading(id, rid) { return request("DELETE", "/api/pools/" + id + "/readings/" + rid); }

  /* ----------------------------- doses (chemical additions) ------------ */
  function doses(id) { return request("GET", "/api/pools/" + id + "/doses"); }
  function addDose(id, dose) { return request("POST", "/api/pools/" + id + "/doses", dose); }
  function updateDose(id, did, dose) { return request("PATCH", "/api/pools/" + id + "/doses/" + did, dose); }
  function deleteDose(id, did) { return request("DELETE", "/api/pools/" + id + "/doses/" + did); }

  /* ----------------------------- alerts (24/7 engine) ------------------ */
  function alerts(poolId) { return request("GET", "/api/alerts" + (poolId ? "?poolId=" + poolId : "")); }
  function alertsSummary() { return request("GET", "/api/alerts/summary", null, { noAuthRedirect: true }); }
  function ackAlert(id) { return request("POST", "/api/alerts/" + id + "/ack", {}); }
  function snoozeAlert(id, hours) { return request("POST", "/api/alerts/" + id + "/snooze", { hours: hours || 24 }); }
  function resolveAlert(id) { return request("POST", "/api/alerts/" + id + "/resolve", {}); }
  function engineStatus() { return request("GET", "/api/engine/status", null, { noAuthRedirect: true }); }

  /* ----------------------------- messages ------------------------------ */
  function messages(id, since) { return request("GET", "/api/pools/" + id + "/messages" + qs(since != null ? { since: since } : null)); }
  function sendMessage(id, body, photo) { return request("POST", "/api/pools/" + id + "/messages", { body: body, photo: photo || null }); }
  function markRead(id, at) { return request("POST", "/api/pools/" + id + "/messages/read", { at: at || null }); }
  function inbox() { return request("GET", "/api/inbox"); }

  /* ----------------------------- companies ----------------------------- */
  function company(cid) { return request("GET", "/api/companies/" + cid); }
  function roster(cid, params) { return request("GET", "/api/companies/" + cid + "/pools" + qs(params)); }
  function companyJoin(code) { return request("POST", "/api/companies/join", { code: code }); }
  function leaveCompany(cid) { return request("POST", "/api/companies/" + cid + "/leave", {}); }
  function updateMember(cid, uid, payload) { return request("PATCH", "/api/companies/" + cid + "/members/" + uid, payload); }
  function poolInvite(id) { return request("POST", "/api/pools/" + id + "/invite", {}); }
  function poolClaim(code) { return request("POST", "/api/pools/claim", { code: code }); }
  function visits(id) { return request("GET", "/api/pools/" + id + "/visits"); }
  function startVisit(id) { return request("POST", "/api/pools/" + id + "/visits", {}); }
  function updateVisit(id, vid, payload) { return request("PATCH", "/api/pools/" + id + "/visits/" + vid, payload); }
  function assignTech(id, payload) { return request("POST", "/api/pools/" + id + "/assign", payload); }
  function unassignTech(id, accountId) { return request("DELETE", "/api/pools/" + id + "/assign/" + accountId); }
  function route() { return request("GET", "/api/route"); }
  function reports(cid) { return request("GET", "/api/companies/" + cid + "/reports"); }
  function accessLog(id) { return request("GET", "/api/pools/" + id + "/access-log"); }

  /* ----------------------------- data / legacy ------------------------- */
  function importState(state, importKey) { return request("POST", "/api/import", { state: state, importKey: importKey || null }); }
  function exportAll() { return request("GET", "/api/export"); }
  function poolExport(id) { return request("GET", "/api/pools/" + id + "/export"); }
  function getState() { return request("GET", "/api/state", null, { noAuthRedirect: true }); }
  function saveState(state) { return request("POST", "/api/state", { state: state }, { noAuthRedirect: true }); }

  /* ----------------------------- offline OUTBOX ------------------------ */
  // Durable queue of pending writes; replayed in order when back online.
  const OB_KEY = "poolaris.outbox.v1";
  function obLoad() { try { return JSON.parse(localStorage.getItem(OB_KEY)) || []; } catch (e) { return []; } }
  function obSave(q) { try { localStorage.setItem(OB_KEY, JSON.stringify(q)); } catch (e) { /* quota */ } }
  function enqueue(method, path, body, meta) {
    const q = obLoad();
    q.push({ id: Date.now() + "-" + Math.random().toString(36).slice(2, 7), method: method, path: path, body: body, meta: meta || null });
    obSave(q);
    return q[q.length - 1].id;
  }
  async function flush() {
    let q = obLoad();
    while (q.length) {
      const it = q[0];
      try { await request(it.method, it.path, it.body, {}); }
      catch (e) { if (e.network) break; /* non-network (e.g. 4xx) → drop poison item */ }
      q.shift(); obSave(q);
    }
    return obLoad().length;
  }
  function pending() { return obLoad().length; }

  /* ----------------------------- helpers ------------------------------- */
  function qs(params) {
    if (!params) return "";
    const parts = [];
    Object.keys(params).forEach((k) => { const v = params[k]; if (v !== undefined && v !== null && v !== "") parts.push(encodeURIComponent(k) + "=" + encodeURIComponent(v)); });
    return parts.length ? "?" + parts.join("&") : "";
  }
  if (typeof global.addEventListener === "function") {
    global.addEventListener("online", () => { _online = true; flush(); });
    global.addEventListener("offline", () => { _online = false; });
  }

  global.API = {
    request: request, setUnauthorizedHandler: setUnauthorizedHandler, csrf: csrf, setCsrf: setCsrf, refreshCsrf: refreshCsrf,
    session: session, signup: signup, login: login, logout: logout, updateMe: updateMe, changePassword: changePassword,
    pools: pools, createPool: createPool, pool: pool, savePool: savePool, deletePool: deletePool, setLocation: setLocation,
    linkCompany: linkCompany, unlinkCompany: unlinkCompany,
    readings: readings, addReading: addReading, updateReading: updateReading, deleteReading: deleteReading,
    doses: doses, addDose: addDose, updateDose: updateDose, deleteDose: deleteDose,
    alerts: alerts, alertsSummary: alertsSummary, ackAlert: ackAlert, snoozeAlert: snoozeAlert, resolveAlert: resolveAlert, engineStatus: engineStatus,
    messages: messages, sendMessage: sendMessage, markRead: markRead, inbox: inbox,
    company: company, roster: roster, companyJoin: companyJoin, leaveCompany: leaveCompany, updateMember: updateMember,
    poolInvite: poolInvite, poolClaim: poolClaim,
    visits: visits, startVisit: startVisit, updateVisit: updateVisit,
    assignTech: assignTech, unassignTech: unassignTech, route: route, reports: reports, accessLog: accessLog,
    importState: importState, exportAll: exportAll, poolExport: poolExport, getState: getState, saveState: saveState,
    enqueue: enqueue, flush: flush, pending: pending,
    isOnline: function () { return _online; },
  };
})(window);
