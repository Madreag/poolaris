/* ============================================================================
   POOLARIS — portal UI  (window.PORTAL)
   ---------------------------------------------------------------------------
   The multi-tenant front end that hangs off the account layer in app.js:
     • Account menu (identity, theme, pools, export, sign out)
     • Pool switcher (appbar) — multi-pool homeowners & company techs/admins
     • Messaging thread (homeowner ⟷ service company) with polling + unread badges
     • Company roster (pools by address, attention status, search/filter/sort)
     • Today's Route (phone-first tech home)
     • Tech management + join/link flows

   It reaches app.js internals through the single PoolarisApp bridge, so the
   verified offline app and chemistry engine are never touched. Everything here
   is account-mode only; in offline mode these routes simply aren't shown.
   ========================================================================== */
(function (global) {
  "use strict";
  const APP = global.PoolarisApp;
  if (!APP) return; // app.js not present (shouldn't happen) — fail safe
  const S = APP.S, API = global.API, portal = APP.portal;
  const $ = APP.$, $$ = APP.$$, esc = APP.esc;

  function go(r) { APP.go(r); }
  function toast(m, k) { APP.toast(m, k); }
  function icon(n) { return S && S.icon ? S.icon(n) : ""; }

  /* ----------------------------- helpers ------------------------------- */
  function relTime(t) {
    if (!t) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 50) return "just now";
    const m = s / 60; if (m < 60) return Math.round(m) + "m ago";
    const h = m / 60; if (h < 24) return Math.round(h) + "h ago";
    const d = h / 24; if (d < 7) return Math.round(d) + "d ago";
    return new Date(t).toLocaleDateString();
  }
  function clockTime(t) { return new Date(t).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }); }
  function dayLabel(t) {
    const d = new Date(t), today = new Date();
    if (d.toDateString() === today.toDateString()) return "Today";
    const y = new Date(today); y.setDate(y.getDate() - 1);
    if (d.toDateString() === y.toDateString()) return "Yesterday";
    return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric" });
  }
  function poolDisplayName(p) { return (p && (p.name || (p.profile && p.profile.name))) || "My Pool"; }
  // ONE canonical attention model, used by the stat tile, card border, filter, and route.
  const ATTN = { urgent: 60, watch: 40, info: 15 }; // score thresholds
  function attnLevel(score) { return score >= ATTN.urgent ? "urgent" : score >= ATTN.watch ? "watch" : score >= ATTN.info ? "info" : "good"; }
  function needsAttention(score) { return (score || 0) >= ATTN.watch; } // the "needs attention" line
  const FLAG_LABEL = {
    fc_zero: "No chlorine", fc_low: "Low FC", cc_high: "Combined chlorine", ph_out: "pH off",
    cya_high: "High CYA", slam_active: "SLAM", stale: "Test overdue", never_tested: "Never tested",
    csi_scaling: "Scaling", csi_corrosive: "Corrosive", overdue_service: "Service due",
  };

  /* ===================================================================
     ACCOUNT MENU  (appbar avatar → popover)
     =================================================================== */
  function openAccountMenu() {
    const layer = $("#modalLayer"); if (!layer) return;
    const u = portal.user || {};
    const co = (portal.companies && portal.companies[0]) || null;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet acct-sheet" role="dialog" aria-modal="true" aria-label="Account">
      <div class="acct-head">
        <span class="acct-head__av">${esc((u.name || u.email || "?").charAt(0).toUpperCase())}</span>
        <div><div class="acct-head__name">${esc(u.name || "Your account")}</div>
          <div class="acct-head__email">${esc(u.email || "")}</div>
          ${co ? `<span class="acct-head__role">${icon("setup")} ${esc(co.name)} · ${esc(co.role)}</span>` : `<span class="acct-head__role">${icon("droplet")} Homeowner</span>`}</div>
      </div>
      <div class="acct-menu">
        <button class="acct-menu__i" data-am="account">${icon("user")} <span>Account &amp; pools</span></button>
        <button class="acct-menu__i" data-am="messages">${icon("chat")} <span>Messages</span></button>
        ${co ? `<button class="acct-menu__i" data-am="roster">${icon("grid")} <span>Company roster</span></button>` : ""}
        <button class="acct-menu__i" data-am="theme">${icon("moon")} <span>Toggle theme</span></button>
        <button class="acct-menu__i" data-am="export">${icon("export")} <span>Download my data</span></button>
        <button class="acct-menu__i acct-menu__i--danger" data-am="signout">${icon("logout")} <span>Sign out</span></button>
      </div></div>`;
    closeOnBackdrop(layer);
    $$("[data-am]", layer).forEach((b) => b.addEventListener("click", () => {
      const a = b.getAttribute("data-am"); closeModal();
      if (a === "signout") APP.signOut();
      else if (a === "theme") { if (APP.toggleTheme) APP.toggleTheme(); else { const tb = document.getElementById("btnTheme"); if (tb) tb.click(); } }
      else if (a === "export") APP.exportBackup();
      else go(a);
    }));
  }
  function closeModal() { const l = $("#modalLayer"); if (l) { l.hidden = true; l.className = "overlay"; l.innerHTML = ""; } }
  function closeOnBackdrop(layer) {
    layer.addEventListener("click", (e) => { if (e.target === layer) closeModal(); });
    const onEsc = (e) => { if (e.key === "Escape") { closeModal(); document.removeEventListener("keydown", onEsc); } };
    document.addEventListener("keydown", onEsc);
  }

  /* ===================================================================
     POOL SWITCHER  (appbar)
     =================================================================== */
  function renderPoolSwitcher() {
    const host = $("#appbarStatus"); // reuse the status slot region's neighbor
    let sw = $("#poolSwitcher");
    const isCompany = portal.companies && portal.companies.length;
    // company members always get a "Jump to a pool" switcher (even with no pool loaded —
    // they have the most pools and need the fastest path). Homeowners need it only with a pool.
    if (portal.mode !== "account" || (!portal.pool && !isCompany)) { if (sw) sw.hidden = true; return; }
    if (!sw) {
      sw = document.createElement("button");
      sw.id = "poolSwitcher"; sw.className = "poolsw"; sw.type = "button";
      sw.setAttribute("aria-label", "Switch pool");
      const brand = document.querySelector(".brand");
      if (brand && brand.parentNode) brand.parentNode.insertBefore(sw, brand.nextSibling);
      sw.addEventListener("click", openPoolSheet);
    }
    sw.hidden = false;
    const multi = (portal.pools || []).length > 1 || isCompany;
    if (!portal.pool) {
      // company with no pool open → label it as a jump-to action
      sw.innerHTML = `<span class="poolsw__ic">${icon("grid")}</span><span class="poolsw__name">Jump to a pool</span><span class="poolsw__chev">${icon("arrow")}</span>`;
      sw.disabled = false; return;
    }
    const name = poolDisplayName(portal.pool);
    const swLvl = attnLevel(portal.pool.attentionScore || 0);
    sw.setAttribute("aria-label", "Switch pool — " + name + " (" + LVL_WORD[swLvl] + ")");
    sw.innerHTML = `<span class="poolsw__dot" data-state="${swLvl}" title="${LVL_WORD[swLvl]}" aria-hidden="true"></span>
      <span class="poolsw__name">${esc(name)}</span>${multi ? `<span class="poolsw__chev">${icon("arrow")}</span>` : ""}`;
    sw.disabled = !multi;
  }
  function openPoolSheet(onPick) {
    if (onPick && typeof onPick !== "function") onPick = null; // ignore a passed click event
    const isCompany = portal.companies && portal.companies.length;
    const layer = $("#modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet poolsheet" role="dialog" aria-modal="true" aria-label="Choose a pool">
      <div class="sheet__head"><h2>${icon("droplet")} ${isCompany ? "Jump to a pool" : "Your pools"}</h2><button class="iconbtn" id="psClose" aria-label="Close">${icon("close")}</button></div>
      ${isCompany ? `<input class="input" id="psSearch" placeholder="Search by address or owner…" autocomplete="off">` : ""}
      <div class="sheet__body" id="psBody"><p class="muted">Loading…</p></div>
      ${!isCompany ? `<button class="btn btn--ghost btn--block" id="psAdd" style="margin-top:10px">${icon("plus")} Add a pool</button>` : `<button class="btn btn--ghost btn--block" id="psRoster" style="margin-top:10px">${icon("grid")} View full roster</button>`}
    </div>`;
    $("#psClose").addEventListener("click", closeModal);
    closeOnBackdrop(layer);
    const add = $("#psAdd"); if (add) add.addEventListener("click", () => { closeModal(); addPoolFlow(); });
    const ros = $("#psRoster"); if (ros) ros.addEventListener("click", () => { closeModal(); go("roster"); });
    const render = (list) => {
      const body = $("#psBody"); if (!body) return;
      if (!list.length) { body.innerHTML = `<p class="muted">No pools found.</p>`; return; }
      const curId = portal.pool && portal.pool.id;
      body.innerHTML = list.map((p) => `<button class="poolrow ${p.id === curId ? "is-current" : ""}" data-pid="${p.id}">
        <span class="poolrow__dot" data-state="${attnLevel(p.attentionScore || 0)}" title="${LVL_WORD[attnLevel(p.attentionScore || 0)]}" aria-hidden="true"></span>
        <span class="poolrow__main"><span class="poolrow__name">${esc(p.name || "My Pool")}</span>
          <span class="poolrow__sub">${esc((p.address && (p.address.line1 || p.address.city)) || (p.owner ? "Owner: " + p.owner : ""))}</span></span>
        ${p.unread ? `<span class="poolrow__unread">${p.unread}</span>` : ""}
        ${p.id === curId ? `<span class="poolrow__check">${icon("check")}</span>` : ""}</button>`).join("");
      $$("[data-pid]", body).forEach((b) => b.addEventListener("click", () => { const pid = +b.getAttribute("data-pid"); closeModal(); if (typeof onPick === "function") onPick(pid); else if (!portal.pool || pid !== portal.pool.id) APP.loadPool(pid); }));
    };
    if (isCompany) {
      // company: search the roster server-side
      const cid = portal.companies[0].id;
      const load = (q) => API.roster(cid, { q: q || "", pageSize: 30, sort: "attention" }).then((d) => render((d && d.pools) || [])).catch(() => render([]));
      load("");
      const si = $("#psSearch");
      let t = null;
      if (si) { si.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => load(si.value.trim()), 250); }); si.focus(); }
    } else {
      render(portal.pools || []);
    }
  }
  function addPoolFlow() {
    if ((portal.pools || []).filter((p) => p.role === "owner" || !p.role).length >= 5) { toast("You can own up to 5 pools.", "warn"); return; }
    // reuse the onboarding wizard; finishing in account mode with no current pool creates one.
    // Here we deliberately null the current pool so commitProfile() routes to createPool.
    portal.pool = null;
    APP.state = { profile: null, log: [], doses: [], slam: null, ui: (APP.state && APP.state.ui) || { learnOpen: {} } };
    APP.openOnboarding();
    go("dashboard");
  }
  // Homeowner claims a company-created pool by entering its invite code → becomes the owner.
  function openClaimPool() {
    const layer = $("#modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet" style="width:min(400px,100%)" role="dialog" aria-modal="true" aria-label="Claim a pool">
      <div class="sheet__head"><h2>${icon("pin")} Claim a pool</h2><button class="iconbtn" id="clClose" aria-label="Close">${icon("close")}</button></div>
      <p class="muted" style="margin:-4px 0 12px">If your pool service company added your pool, they can give you an invite code. Enter it to link the pool to your account.</p>
      <div class="field"><label for="clCode">Invite code</label><input class="input" id="clCode" placeholder="Paste the code" autocomplete="off"></div>
      <div class="auth-err" id="clErr" hidden></div>
      <button class="btn btn--primary btn--block" id="clSave">Claim this pool</button></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    $("#clClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    $("#clSave").addEventListener("click", () => {
      const code = ($("#clCode") || {}).value || "";
      if (!code.trim()) { const er = $("#clErr"); er.hidden = false; er.textContent = "Paste your invite code."; return; }
      API.poolClaim(code.trim()).then((d) => {
        toast("Pool claimed! 🎉", "good"); close();
        const pid = d && d.pool && d.pool.id;
        API.pools().then((pd) => { portal.pools = (pd && pd.pools) || portal.pools; if (pid) APP.loadPool(pid).then(() => go("dashboard")); else renderAccount(); }).catch(() => renderAccount());
      }).catch((e) => { const er = $("#clErr"); er.hidden = false; er.textContent = (e && e.status === 404) ? "That code didn't match a pool." : "Couldn't claim the pool."; });
    });
  }

  /* ===================================================================
     MESSAGING  (RENDER.messages)
     =================================================================== */
  let _thread = { poolId: null, timer: null, lastId: 0 };
  function renderMessages() {
    const v = $("#view-messages");
    if (portal.mode !== "account") {
      v.innerHTML = `<div class="page-head"><span class="eyebrow">${icon("chat")} Messages</span><h1>Messages</h1>
        <p class="lead">Sign in to message your pool service company and keep everything in one place.</p>
        <button class="btn btn--primary" id="msgSignIn">${icon("setup")} Sign in or create an account</button></div>`;
      const b = $("#msgSignIn"); if (b) b.addEventListener("click", () => APP.renderAuthGate && APP.renderAuthGate({ mode: "login" }));
      return;
    }
    // Company members (admin/tech) → an INBOX of all pool threads, not a single chat.
    // After tapping a thread (portal._forceThread === current pool), show that thread
    // with a back-to-inbox link instead of the inbox.
    const isCompany = portal.companies && portal.companies.length;
    if (isCompany && !(portal._forceThread && portal.pool && portal._forceThread === portal.pool.id)) { renderInbox(v); return; }
    if (!portal.pool) {
      v.innerHTML = `<div class="page-head"><span class="eyebrow">${icon("chat")} Messages</span><h1>Messages</h1>
        <p class="lead">Add a pool to start a conversation with your pool service company.</p></div>`;
      return;
    }
    const pool = portal.pool;
    const isCompanySide = pool.role === "admin" || pool.role === "tech";
    const other = isCompanySide ? (pool.owner && pool.owner.name ? pool.owner.name : "the homeowner")
      : (pool.company && pool.company.name ? pool.company.name : null);
    v.innerHTML = `
      <div class="page-head">
        ${isCompanySide ? `<button class="btn btn--ghost btn--sm" id="msgBack" style="margin-bottom:8px">${icon("arrow")} Back to conversations</button>` : ""}
        <span class="eyebrow">${icon("chat")} ${isCompanySide ? esc(poolDisplayName(pool)) : "Messages"}</span>
        <h1>${other ? esc(other) : "Messages"}</h1>
        <p class="lead">${other
          ? (isCompanySide ? `Chat with the homeowner about ${esc(poolDisplayName(pool))}.` : `Chat with ${esc(other)} about your pool.`)
          : `Connect a pool service company to start a conversation.`}</p>
      </div>
      ${other ? `<div class="msg-thread card" id="msgThread" aria-live="polite"><div class="msg-loading muted">Loading…</div></div>
      <div class="msg-photo-preview" id="msgPhotoPreview" hidden></div>
      <form class="msg-composer" id="msgForm">
        <button type="button" class="iconbtn msg-attach" id="msgAttach" aria-label="Attach a photo" title="Attach a photo">${icon("camera")}</button>
        <input type="file" id="msgPhoto" accept="image/*" style="display:none" aria-label="Choose a photo to attach">
        <textarea class="input msg-input" id="msgInput" rows="1" placeholder="Write a message…" aria-label="Message"></textarea>
        <button class="btn btn--primary msg-send" id="msgSend" type="submit" aria-label="Send">${icon("send")}</button>
      </form>` : `<div class="card center" style="padding:40px 24px"><div class="msg-empty muted" style="max-width:400px;margin:0 auto"><div class="msg-empty__ic">${icon("chat")}</div><h2 style="margin:8px 0 4px">No company connected yet</h2><p>Link your pool to a service company on your Account page — then you'll message them, and get their updates, right here.</p><a class="btn btn--primary" href="#account" style="margin-top:12px">${icon("setup")} Connect a company</a></div></div>`}`;
    const back = $("#msgBack"); if (back) back.addEventListener("click", () => { portal._forceThread = null; renderMessages(); });
    if (!other) return;
    loadThread(true);
    const form = $("#msgForm"), input = $("#msgInput");
    form.addEventListener("submit", (e) => { e.preventDefault(); sendMsg(); });
    input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendMsg(); } });
    input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = Math.min(120, input.scrollHeight) + "px"; });
    _pendingPhoto = null; showPhotoPreview();
    const attach = $("#msgAttach"), photoInput = $("#msgPhoto");
    if (attach && photoInput) {
      attach.addEventListener("click", () => photoInput.click());
      photoInput.addEventListener("change", (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) stagePhoto(f); });
    }
    startThreadPolling();
  }

  /* company inbox — all pool conversations, tap to open that pool's thread */
  function renderInbox(v) {
    v.innerHTML = `
      <div class="page-head"><span class="eyebrow">${icon("chat")} Messages</span>
        <h1>Conversations</h1>
        <p class="lead">Messages from the homeowners whose pools you service. Tap a pool to reply.</p>
        <button class="btn btn--ghost btn--sm" id="inboxNew">${icon("send")} New message</button></div>
      <div id="inboxList"><p class="muted">Loading…</p></div>`;
    const nb = $("#inboxNew");
    if (nb) nb.addEventListener("click", () => openPoolSheet((pid) => { APP.loadPool(pid).then(() => { portal._forceThread = pid; go("messages"); }); }));
    API.inbox().then((d) => {
      const list = $("#inboxList"); if (!list) return;
      const threads = (d && d.threads) || [];
      if (!threads.length) {
        list.innerHTML = `<div class="card center" style="padding:34px"><div class="msg-empty muted">${icon("chat")}<p>No conversations yet. When a homeowner messages you about a pool you service, it'll show up here.</p></div></div>`;
        return;
      }
      list.innerHTML = threads.map((t) => `<button class="inbox-row ${t.unread ? "is-unread" : ""}" data-inbox="${t.poolId}">
        <span class="inbox-row__ic">${icon("chat")}</span>
        <span class="inbox-row__main"><span class="inbox-row__name">${esc(t.poolName || "Pool")}</span>
          <span class="inbox-row__snip">${esc(t.lastSnippet || "")}</span></span>
        <span class="inbox-row__meta">${t.lastMessageAt ? relTime(t.lastMessageAt) : ""}${t.unread ? `<span class="inbox-row__badge">${t.unread}</span>` : ""}</span>
      </button>`).join("");
      $$("[data-inbox]", list).forEach((b) => b.addEventListener("click", () => {
        const pid = +b.getAttribute("data-inbox");
        APP.loadPool(pid).then(() => { portal._forceThread = pid; go("messages"); });
      }));
    }).catch(() => { const list = $("#inboxList"); if (list) list.innerHTML = `<p class="muted">Couldn't load conversations.</p>`; });
  }
  function loadThread(scroll) {
    const pool = portal.pool; if (!pool) return;
    const isCo = pool.role === "admin" || pool.role === "tech";
    const otherName = isCo ? (pool.owner && pool.owner.name ? pool.owner.name : "the homeowner") : (pool.company && pool.company.name ? pool.company.name : null);
    API.messages(pool.id).then((d) => {
      const thread = $("#msgThread"); if (!thread) return;
      const msgs = (d && d.messages) || [];
      _thread.lastId = msgs.length ? msgs[msgs.length - 1].id : 0;
      if (!msgs.length) { thread.innerHTML = `<div class="msg-empty muted">${icon("chat")}<p>No messages yet. Say hello${otherName ? " to " + esc(otherName) : ""}!</p></div>`; }
      else {
        let html = "", lastDay = "";
        msgs.forEach((mm) => {
          const dl = dayLabel(mm.createdAt);
          if (dl !== lastDay) { html += `<div class="msg-day">${esc(dl)}</div>`; lastDay = dl; }
          html += msgBubble(mm);
        });
        thread.innerHTML = html;
      }
      if (scroll) thread.scrollTop = thread.scrollHeight;
      API.markRead(pool.id).then(() => { APP.refreshAlertBadge(); if (global.PORTAL._inbox) global.PORTAL._inbox(); }).catch(() => {});
    }).catch(() => { const thread = $("#msgThread"); if (thread) thread.innerHTML = `<div class="msg-empty muted">Couldn't load messages.</div>`; });
  }
  // where a system-message code should deep-link the reader
  const SYS_ROUTE = { FC_ZERO: { r: "log", label: "Log a test" }, FREEZE: { r: "learn", label: "Freeze tips" }, HEAT: { r: "plan", label: "See plan" }, RAIN: { r: "plan", label: "See plan" }, SLAM_STALL: { r: "slam", label: "Open SLAM" } };
  function msgBubble(mm) {
    if (mm.senderRole === "system") {
      const sev = mm.severity || "info";
      const ic = sev === "urgent" ? "warn" : sev === "watch" ? "warn" : "info";
      const link = mm.code && SYS_ROUTE[mm.code];
      return `<div class="msg-system msg-system--${sev}">${icon(ic)} <span>${esc(mm.body)}</span>${link ? `<a class="msg-system__go" href="#${link.r}">${esc(link.label)} ${icon("arrow")}</a>` : ""}</div>`;
    }
    const side = mm.mine ? "me" : "them";
    const img = mm.photo ? `<img class="msg-img" src="${esc(mm.photo)}" alt="Shared photo" loading="lazy">` : "";
    const txt = mm.body ? `<span class="msg-text">${esc(mm.body)}</span>` : "";
    return `<div class="msg-row msg-row--${side}">
      <div class="msg-bubble">${mm.mine ? "" : `<span class="msg-sender">${esc(mm.senderName)}</span>`}${img}${txt}
        <span class="msg-time">${clockTime(mm.createdAt)}</span></div></div>`;
  }
  // ---- photo attachment (client-compressed data URL, stored on the message) ----
  let _pendingPhoto = null;
  function stagePhoto(file) {
    if (!file || !/^image\//.test(file.type)) { toast("Please choose an image.", "warn"); return; }
    if (file.size > 12 * 1024 * 1024) { toast("That image is too large (max ~12MB).", "warn"); return; }
    const rd = new FileReader();
    rd.onload = () => {
      const im = new Image();
      im.onload = () => {
        const max = 1600; let w = im.width, h = im.height;
        if (w > max || h > max) { const s = Math.min(max / w, max / h); w = Math.round(w * s); h = Math.round(h * s); }
        const cv = document.createElement("canvas"); cv.width = w; cv.height = h;
        cv.getContext("2d").drawImage(im, 0, 0, w, h);
        let data = cv.toDataURL("image/jpeg", 0.72);
        if (data.length > 1100000) data = cv.toDataURL("image/jpeg", 0.5);
        if (data.length > 1100000) { toast("Couldn't shrink that photo enough — try a smaller one.", "warn"); return; }
        _pendingPhoto = data; showPhotoPreview();
      };
      im.onerror = () => toast("Couldn't read that image.", "warn");
      im.src = rd.result;
    };
    rd.onerror = () => toast("Couldn't read that file.", "warn");
    rd.readAsDataURL(file);
  }
  function showPhotoPreview() {
    const p = $("#msgPhotoPreview"); if (!p) return;
    if (!_pendingPhoto) { p.hidden = true; p.innerHTML = ""; return; }
    p.hidden = false;
    p.innerHTML = `<img src="${_pendingPhoto}" alt="Photo to send"><button type="button" class="msg-photo-x" id="msgPhotoX" aria-label="Remove photo">${icon("close")}</button>`;
    const x = $("#msgPhotoX"); if (x) x.addEventListener("click", () => { _pendingPhoto = null; showPhotoPreview(); });
  }
  function sendMsg() {
    const input = $("#msgInput"); if (!input) return;
    const body = input.value.trim();
    const photo = _pendingPhoto;
    if (!body && !photo) return;
    const pool = portal.pool;
    input.value = ""; input.style.height = "auto";
    _pendingPhoto = null; showPhotoPreview();
    const thread = $("#msgThread");
    // optimistic bubble (renders the local data URL immediately)
    const myRole = (pool.role === "admin" || pool.role === "tech") ? pool.role : "owner";
    const temp = { id: "tmp", senderName: portal.user.name, senderRole: myRole, body: body, photo: photo, createdAt: Date.now(), mine: true };
    if (thread) { if (thread.querySelector(".msg-empty")) thread.innerHTML = ""; thread.insertAdjacentHTML("beforeend", msgBubble(temp)); thread.scrollTop = thread.scrollHeight; }
    API.sendMessage(pool.id, body, photo).then(() => loadThread(true))
      .catch((e) => { if (e && e.network) { API.enqueue("POST", "/api/pools/" + pool.id + "/messages", { body: body, photo: photo }); toast("Offline — message queued.", "warn"); } else toast("Couldn't send.", "bad"); });
  }
  function startThreadPolling() {
    clearInterval(_thread.timer);
    _thread.poolId = portal.pool && portal.pool.id;
    _thread.timer = setInterval(() => {
      if (document.hidden) return;
      if ($("#view-messages").hidden) { clearInterval(_thread.timer); return; }
      const pool = portal.pool; if (!pool) return;
      API.messages(pool.id).then((d) => {
        const msgs = (d && d.messages) || [];
        const last = msgs.length ? msgs[msgs.length - 1].id : 0;
        if (last !== _thread.lastId) loadThread(true);
      }).catch(() => {});
    }, 8000);
  }

  /* ----- inbox unread polling (nav badge) ----- */
  function startInboxPolling() {
    pollInbox();
    clearInterval(global.PORTAL._inboxTimer);
    global.PORTAL._inboxTimer = setInterval(() => { if (!document.hidden) pollInbox(); }, 30000);
  }
  function pollInbox() {
    if (portal.mode !== "account") return;
    API.inbox().then((d) => { APP.msgBadge((d && d.unreadTotal) || 0); }).catch(() => {});
  }
  global.PORTAL = global.PORTAL || {};
  global.PORTAL._inbox = pollInbox;

  /* ===================================================================
     COMPANY ROSTER  (RENDER.roster)
     =================================================================== */
  let _roster = { sort: "attention", status: "", q: "" };
  function renderRoster() {
    const v = $("#view-roster");
    const co = portal.companies && portal.companies[0];
    if (!co) { v.innerHTML = emptyState("This view is for pool service companies."); return; }
    v.innerHTML = `
      <div class="page-head roster-head">
        <div><span class="eyebrow">${icon("grid")} ${esc(co.name)}</span>
        <h1>Pools you service</h1>
        <p class="lead">Every pool at a glance, sorted so the ones needing attention rise to the top.</p></div>
        <button class="btn btn--primary" id="rosAdd">${icon("plus")} Add client pool</button>
      </div>
      <div class="roster-stats" id="rosterStats"></div>
      <div class="roster-toolbar">
        <div class="roster-search-wrap">
          <span class="roster-search-ic">${icon("target")}</span>
          <input class="input roster-search" id="rosSearch" aria-label="Search pools by address or owner" placeholder="Search address or owner…" value="${esc(_roster.q)}" autocomplete="off">
          ${_roster.q ? `<button class="roster-search-x" id="rosClear" aria-label="Clear search">${icon("plus")}</button>` : ""}
        </div>
        <div class="seg roster-filter" id="rosStatus">
          ${["", "needs_attention", "stale"].map((s) => `<button data-st="${s}" class="${_roster.status === s ? "is-on" : ""}">${s === "" ? "All" : s === "needs_attention" ? "Needs attention" : "Not tested"}</button>`).join("")}
        </div>
        <select class="input roster-sort" id="rosSort" aria-label="Sort pools by">
          ${[["attention", "Attention"], ["address", "Address"], ["last_tested", "Last tested"], ["name", "Name"]].map((o) => `<option value="${o[0]}" ${_roster.sort === o[0] ? "selected" : ""}>${o[1]}</option>`).join("")}
        </select>
      </div>
      <div class="roster-count muted" id="rosterCount"></div>
      <div id="rosterList"><p class="muted">Loading…</p></div>`;
    const search = $("#rosSearch");
    let t = null;
    search.addEventListener("input", () => { clearTimeout(t); t = setTimeout(() => { _roster.q = search.value.trim(); loadRoster(); }, 250); });
    $$("#rosStatus [data-st]").forEach((b) => b.addEventListener("click", () => { _roster.status = b.getAttribute("data-st"); renderRoster(); }));
    $("#rosSort").addEventListener("change", (e) => { _roster.sort = e.target.value; loadRoster(); });
    $("#rosClear") && $("#rosClear").addEventListener("click", () => { _roster.q = ""; renderRoster(); });
    $("#rosAdd") && $("#rosAdd").addEventListener("click", openAddClient);
    loadRoster();
  }
  // Add a client pool to the company (an address/owner the company services).
  function openAddClient() {
    const co = portal.companies[0];
    const layer = $("#modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet" style="width:min(440px,100%)" role="dialog" aria-modal="true" aria-label="Add client pool">
      <div class="sheet__head"><h2>${icon("plus")} Add a client pool</h2><button class="iconbtn" id="acClose" aria-label="Close">${icon("close")}</button></div>
      <p class="muted" style="margin:-4px 0 12px">Add a pool you service. You can invite the homeowner later so they can see it too.</p>
      <div class="field"><label for="acAddr">Street address</label><input class="input" id="acAddr" placeholder="123 Main St" autocomplete="off"></div>
      <div class="grid cols-2" style="gap:10px">
        <div class="field"><label for="acCity">City</label><input class="input" id="acCity" placeholder="Anytown" autocomplete="off"></div>
        <div class="field"><label for="acZip">ZIP</label><input class="input" id="acZip" placeholder="12345" autocomplete="off"></div>
      </div>
      <div class="field"><label for="acOwner">Owner name (optional)</label><input class="input" id="acOwner" placeholder="Marisol G" autocomplete="off"></div>
      <div class="field"><label for="acVol">Pool volume (gal, optional)</label><input class="input" id="acVol" type="number" placeholder="15000"></div>
      <button class="btn btn--primary btn--block" id="acSave">Add pool to roster</button></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    $("#acClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    $("#acSave").addEventListener("click", () => {
      const addr = ($("#acAddr") || {}).value || "";
      if (!addr.trim()) { toast("Enter a street address.", "warn"); return; }
      const ownerName = ($("#acOwner") || {}).value || "";
      const vol = parseFloat(($("#acVol") || {}).value) || 15000;
      const name = addr.trim();
      API.createPool({
        profile: { name: name, volume: vol, sanitizer: "liquid", surface: "plaster", notes: ownerName ? "Owner: " + ownerName : "" },
        address: { line1: addr.trim(), city: ($("#acCity") || {}).value || "", postalCode: ($("#acZip") || {}).value || "" },
        servicingCompanyId: co.id,
      }).then((res) => {
        loadRoster();
        const pid = res && res.pool && res.pool.id;
        if (!pid) { toast("Client pool added.", "good"); close(); return; }
        // step 2: mint a shareable invite code so the homeowner can claim the pool
        API.poolInvite(pid).then((d) => {
          const code = (d && d.code) || "";
          layer.innerHTML = `<div class="sheet" style="width:min(440px,100%)" role="dialog" aria-modal="true" aria-label="Invite the homeowner">
            <div class="sheet__head"><h2>${icon("check")} Pool added</h2><button class="iconbtn" id="acClose2" aria-label="Close">${icon("close")}</button></div>
            <p class="muted" style="margin:-4px 0 12px"><b>${esc(name)}</b> is on your roster. To let the homeowner see it and message you, share this invite code — they enter it under <b>Claim a pool</b> on their account.</p>
            <div class="invite-box"><code class="invite-code" id="inviteCode">${esc(code || "—")}</code><button class="btn btn--ghost btn--sm" id="inviteCopy">${icon("export")} Copy</button></div>
            <button class="btn btn--primary btn--block" id="acDone" style="margin-top:14px">Done</button></div>`;
          $("#acClose2").addEventListener("click", close);
          $("#acDone").addEventListener("click", close);
          $("#inviteCopy").addEventListener("click", () => { try { navigator.clipboard.writeText(code); toast("Invite code copied.", "good"); } catch (e) { toast("Select the code to copy it.", "warn"); } });
        }).catch(() => { toast("Client pool added.", "good"); close(); });
      }).catch(() => toast("Couldn't add the pool.", "bad"));
    });
  }
  function loadRoster() {
    const co = portal.companies[0];
    API.company(co.id).then((d) => {
      const st = $("#rosterStats"); if (st && d && d.stats) {
        st.innerHTML = `<div class="rstat"><b>${d.stats.pools}</b><span>pools</span></div>
          <div class="rstat rstat--warn"><b>${d.stats.needAttention}</b><span>need attention</span></div>
          <div class="rstat rstat--mut"><b>${d.stats.stale}</b><span>not tested</span></div>`;
      }
    }).catch(() => {});
    API.roster(co.id, { sort: _roster.sort, status: _roster.status, q: _roster.q, pageSize: 100 }).then((d) => {
      const list = $("#rosterList"); if (!list) return;
      const pools = (d && d.pools) || [];
      const total = d && d.total != null ? d.total : pools.length;
      const cnt = $("#rosterCount"); if (cnt) cnt.textContent = pools.length ? `Showing ${pools.length}${total > pools.length ? " of " + total : ""} pool${pools.length === 1 ? "" : "s"}` : "";
      if (!pools.length) {
        list.innerHTML = `<div class="card center" style="padding:34px">${icon("grid")}<p class="muted" style="margin:10px 0 14px">${_roster.q || _roster.status ? "No pools match your filter." : "No pools yet. Add the pools you service to get started."}</p>${_roster.q || _roster.status ? `<button class="btn btn--ghost" id="rosClearEmpty">Clear filters</button>` : `<button class="btn btn--primary" id="rosAddEmpty">${icon("plus")} Add your first client pool</button>`}</div>`;
        $("#rosAddEmpty") && $("#rosAddEmpty").addEventListener("click", openAddClient);
        $("#rosClearEmpty") && $("#rosClearEmpty").addEventListener("click", () => { _roster.q = ""; _roster.status = ""; renderRoster(); });
        return;
      }
      list.innerHTML = `<div class="roster-grid">${pools.map(rosterCard).join("")}</div>`;
      const openPool = (pid, route) => APP.loadPool(pid).then(() => go(route || "dashboard"));
      $$("[data-open]", list).forEach((b) => {
        b.addEventListener("click", () => openPool(+b.getAttribute("data-open")));
        b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openPool(+b.getAttribute("data-open")); } });
      });
      $$("[data-msg]", list).forEach((b) => {
        const openMsg = (e) => { e.stopPropagation(); e.preventDefault(); openPool(+b.getAttribute("data-msg"), "messages"); };
        b.addEventListener("click", openMsg);
        b.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") openMsg(e); });
      });
    }).catch(() => { const list = $("#rosterList"); if (list) list.innerHTML = `<p class="muted">Couldn't load the roster.</p>`; });
  }
  const LVL_WORD = { urgent: "Needs attention", watch: "Keep an eye on it", info: "Minor", good: "All good" };
  function rosterCard(p) {
    const lvl = attnLevel(p.attentionScore || 0);
    const eff = p.effectiveLatest || {};
    const flags = (p.attentionFlags || []).slice(0, 3).map((f) => `<span class="rchip rchip--${lvl}">${esc(FLAG_LABEL[f] || f)}</span>`).join("");
    const addr = (p.address && (p.address.line1 || p.address.city)) ? esc([p.address.line1, p.address.city].filter(Boolean).join(", ")) : "<span class='muted'>No address</span>";
    const tested = p.lastReadingAt ? relTime(p.lastReadingAt) : "never tested";
    const num = (k, lbl) => eff[k] != null ? `<span class="rnum"><b>${eff[k]}</b><span>${lbl}</span></span>` : "";
    return `<div class="rcard rcard--${lvl}" data-open="${p.id}" role="button" tabindex="0" aria-label="${esc((p.owner || poolDisplayName(p)))} — ${LVL_WORD[lvl]}">
      <div class="rcard__top">
        <span class="rcard__dot" data-state="${lvl}" title="${LVL_WORD[lvl]}" aria-hidden="true"></span>
        <div class="rcard__addr">${addr}<span class="rcard__owner">${esc(p.owner || poolDisplayName(p))}</span></div>
        ${p.unread ? `<span class="rcard__msg" data-msg="${p.id}" role="button" tabindex="0" aria-label="${p.unread} unread messages">${icon("chat")}<span>${p.unread}</span></span>` : `<span class="rcard__msg rcard__msg--quiet" data-msg="${p.id}" role="button" tabindex="0" aria-label="Message owner">${icon("chat")}</span>`}
      </div>
      <div class="rcard__nums">${num("fc", "FC")}${num("ph", "pH")}${num("cya", "CYA")}${num("cc", "CC")}</div>
      <div class="rcard__foot"><span class="rcard__tested">${icon("clock")} ${tested}</span><div class="rcard__flags">${flags}</div></div>
    </div>`;
  }

  /* ===================================================================
     TODAY'S ROUTE  (RENDER.route) — phone-first tech home
     =================================================================== */
  function renderRoute() {
    const v = $("#view-route");
    const co = portal.companies && portal.companies[0];
    if (!co) { v.innerHTML = emptyState("This view is for pool service technicians."); return; }
    v.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">${icon("wrench")} Today's Route</span>
        <h1>Your stops</h1>
        <p class="lead">Attention-first — the pools most likely to need work are at the top.</p>
      </div>
      <div id="routeList"><p class="muted">Loading…</p></div>`;
    // Prefer the tech's explicitly-assigned stops; fall back to the attention-sorted roster.
    const fallback = () => API.roster(co.id, { sort: "attention", pageSize: 100 }).then((d) => {
      const pools = ((d && d.pools) || []).filter((p) => (p.attentionScore || 0) >= 15 || !p.lastReadingAt);
      paintRoute(pools.length ? pools : ((d && d.pools) || []).slice(0, 8), false);
    }).catch(showRouteErr);
    API.route().then((rd) => {
      const assigned = (rd && rd.stops) || [];
      if (assigned.length) paintRoute(assigned, true); else fallback();
    }).catch(fallback);
  }
  function showRouteErr() { const list = $("#routeList"); if (list) list.innerHTML = `<p class="muted">Couldn't load your route.</p>`; }
  function paintRoute(stops, assigned) {
    const list = $("#routeList"); if (!list) return;
    if (!stops.length) { list.innerHTML = `<div class="card center" style="padding:30px">${icon("check")}<p class="muted">${assigned ? "No pools assigned to you yet — an admin can assign your route." : "No pools yet. Add pools from the roster."}</p></div>`; return; }
    const dn = routeDone();
    const doneN = stops.filter((p) => dn[p.id]).length;
    list.innerHTML = `<div class="route-summary muted">${stops.length} stop${stops.length === 1 ? "" : "s"}${assigned ? " · assigned to you" : ""} · ${stops.filter((p) => needsAttention(p.attentionScore)).length} need attention${doneN ? ` · <b>${doneN} done</b>` : ""}</div>` +
      stops.map((p, i) => routeStop(p, i + 1)).join("");
    $$("[data-ropen]", list).forEach((b) => b.addEventListener("click", () => { const pid = +b.getAttribute("data-ropen"); APP.loadPool(pid).then(() => go("dashboard")); }));
    $$("[data-rlog]", list).forEach((b) => b.addEventListener("click", () => { const pid = +b.getAttribute("data-rlog"); APP.loadPool(pid).then(() => go("log")); }));
    $$("[data-rdone]", list).forEach((b) => b.addEventListener("click", () => { toggleStopDone(+b.getAttribute("data-rdone")); renderRoute(); }));
  }
  // per-day "done" marks for route stops (local until a /route endpoint exists)
  function routeDoneKey() { const d = new Date(); return "poolaris.route." + d.getFullYear() + "-" + (d.getMonth() + 1) + "-" + d.getDate(); }
  function routeDone() { try { return JSON.parse(localStorage.getItem(routeDoneKey())) || {}; } catch (e) { return {}; } }
  function toggleStopDone(pid) { const m = routeDone(); m[pid] = !m[pid]; try { localStorage.setItem(routeDoneKey(), JSON.stringify(m)); } catch (e) {} }
  function routeStop(p, n) {
    const lvl = attnLevel(p.attentionScore || 0);
    const done = !!routeDone()[p.id];
    const addr = (p.address && (p.address.line1 || p.address.city)) ? [p.address.line1, p.address.city].filter(Boolean).join(", ") : poolDisplayName(p);
    const flags = (p.attentionFlags || []).slice(0, 2).map((f) => FLAG_LABEL[f] || f).join(" · ");
    const mapsUrl = "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent(addr);
    return `<div class="stop stop--${lvl} ${done ? "is-done" : ""}">
      <button class="stop__check" data-rdone="${p.id}" aria-label="${done ? "Mark not done" : "Mark stop done"}" aria-pressed="${done}">${done ? icon("check") : ""}</button>
      <div class="stop__body">
        <div class="stop__addr">${esc(addr)} ${(p.address && (p.address.line1 || p.address.city)) ? `<a class="stop__map" href="${esc(mapsUrl)}" target="_blank" rel="noopener" aria-label="Directions" title="Directions">${icon("pin")}</a>` : ""}</div>
        <div class="stop__sub">${esc(p.owner || "")}${flags ? ` · <span class="stop__flags">${esc(flags)}</span>` : ""}${p.lastReadingAt ? " · tested " + relTime(p.lastReadingAt) : " · <b>never tested</b>"}</div>
      </div>
      <div class="stop__act">
        <button class="btn btn--sm btn--ghost" data-ropen="${p.id}">Open</button>
        <button class="btn btn--sm btn--primary" data-rlog="${p.id}">${icon("beaker")} Log</button>
      </div></div>`;
  }

  /* ===================================================================
     ACCOUNT  (RENDER.account)
     =================================================================== */
  function renderAccount() {
    const v = $("#view-account");
    if (portal.mode !== "account") {
      v.innerHTML = `<div class="page-head"><span class="eyebrow">${icon("user")} Account</span><h1>Account</h1>
        <p class="lead">Sign in to sync your pools across devices and manage your account.</p>
        <button class="btn btn--primary" id="acctSignIn">${icon("setup")} Sign in or create an account</button></div>`;
      const b = $("#acctSignIn"); if (b) b.addEventListener("click", () => APP.renderAuthGate && APP.renderAuthGate({ mode: "login" }));
      return;
    }
    const co = portal.companies && portal.companies[0];
    if (co) { renderCompanyAccount(v, co); return; }
    renderHomeownerAccount(v);
  }

  /* ---- shared account bits ---- */
  function accountDataCard() {
    return `<div class="card" style="margin-top:18px">
        <div class="card__title">${icon("export")} Your data &amp; security</div>
        <p class="muted" style="font-size:.9rem">Your account syncs across devices. Download a full backup anytime.</p>
        <div class="btnrow"><button class="btn btn--ghost btn--sm" id="acctExport">${icon("export")} Download my data</button>
          <button class="btn btn--ghost btn--sm" id="acctPw">${icon("setup")} Change password</button></div>
      </div>
      <div class="card" style="margin-top:14px;border-color:#ffd0c4">
        <div class="spread"><div><strong>Sign out</strong><div class="muted" style="font-size:.85rem">You'll need your email &amp; password to sign back in.</div></div>
        <button class="btn btn--danger" id="acctSignout">${icon("logout")} Sign out</button></div>
      </div>`;
  }
  function wireAccountCommon(v) {
    $("#acctExport", v) && $("#acctExport", v).addEventListener("click", APP.exportBackup);
    $("#acctSignout", v) && $("#acctSignout", v).addEventListener("click", APP.signOut);
    $("#acctPw", v) && $("#acctPw", v).addEventListener("click", openChangePassword);
    $("#acctEditName", v) && $("#acctEditName", v).addEventListener("click", openEditName);
  }
  function openEditName() {
    const layer = $("#modalLayer"); if (!layer) return;
    const u = portal.user || {};
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet" style="width:min(380px,100%)" role="dialog" aria-modal="true" aria-label="Your name">
      <div class="sheet__head"><h2>${icon("user")} Your name</h2><button class="iconbtn" id="enClose" aria-label="Close">${icon("close")}</button></div>
      <div class="field"><label for="enName">Display name</label><input class="input" id="enName" value="${esc(u.name || "")}" placeholder="e.g. Alex Rivera" autocomplete="name"></div>
      <button class="btn btn--primary btn--block" id="enSave">Save</button></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    $("#enClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    $("#enSave").addEventListener("click", () => {
      const name = (($("#enName") || {}).value || "").trim();
      API.updateMe({ name: name }).then((d) => { if (d && d.user) portal.user = Object.assign(portal.user || {}, { name: d.user.name }); toast("Name saved.", "good"); close(); renderAccount(); }).catch(() => toast("Couldn't save your name.", "bad"));
    });
  }
  function openChangePassword() {
    const layer = $("#modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet" style="width:min(400px,100%)" role="dialog" aria-modal="true" aria-label="Change password">
      <div class="sheet__head"><h2>${icon("setup")} Change password</h2><button class="iconbtn" id="pwClose" aria-label="Close">${icon("close")}</button></div>
      <div class="field"><label for="pwCur">Current password</label><input class="input" type="password" id="pwCur" autocomplete="current-password"></div>
      <div class="field"><label for="pwNew">New password</label><input class="input" type="password" id="pwNew" autocomplete="new-password" placeholder="At least 8 characters"></div>
      <div class="field"><label for="pwNew2">Confirm new password</label><input class="input" type="password" id="pwNew2" autocomplete="new-password" placeholder="Re-enter the new password"></div>
      <div class="auth-err" id="pwErr" hidden></div>
      <button class="btn btn--primary btn--block" id="pwSave">Update password</button></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    $("#pwClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    $("#pwSave").addEventListener("click", () => {
      const cur = ($("#pwCur") || {}).value || "", nw = ($("#pwNew") || {}).value || "", nw2 = ($("#pwNew2") || {}).value || "";
      if (nw.length < 8) { const er = $("#pwErr"); er.hidden = false; er.textContent = "New password must be at least 8 characters."; return; }
      if (nw !== nw2) { const er = $("#pwErr"); er.hidden = false; er.textContent = "The new passwords don't match."; return; }
      API.changePassword({ current: cur, next: nw }).then(() => { toast("Password updated.", "good"); close(); })
        .catch((e) => { const er = $("#pwErr"); er.hidden = false; er.textContent = (e && e.message) || "Couldn't change password — check your current one."; });
    });
  }

  /* ---- COMPANY account: company identity + technicians + join code ---- */
  function renderCompanyAccount(v, co) {
    const u = portal.user || {};
    v.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">${icon("setup")} Company account</span>
        <h1>${esc(co.name)}</h1>
        <p class="lead">${esc(u.name || "(no name)")}${u.email ? " · " + esc(u.email) : ""} · ${esc(co.role)} <button class="btn btn--ghost btn--sm" id="acctEditName">${icon("setup")} ${u.name ? "Edit name" : "Add name"}</button></p>
      </div>
      <div class="grid cols-2" style="align-items:start;gap:22px">
        <div class="card pad-lg" id="techCard">
          <div class="card__title">${icon("wrench")} Technicians</div>
          <div id="techList"><p class="muted">Loading…</p></div>
        </div>
        <div class="card pad-lg">
          <div class="card__title">${icon("grid")} Your company</div>
          <div class="callout callout--sun" style="font-size:.86rem">${icon("info")}<div>Technicians join with this code: <b class="joincode" id="joinCode">${esc(co.joinCode || "")}</b><br><button class="btn btn--ghost btn--sm" id="copyCode" style="margin-top:8px">${icon("export")} Copy code</button></div></div>
          <button class="btn btn--primary btn--block" id="acctRoster" style="margin-top:12px">${icon("grid")} Open roster</button>
          <button class="btn btn--ghost btn--block" id="acctInbox" style="margin-top:8px">${icon("chat")} Conversations</button>
          <button class="btn btn--ghost btn--block" id="acctReports" style="margin-top:8px">${icon("grid")} Reports</button>
          <button class="btn btn--ghost btn--block" id="acctLeaveCo" style="margin-top:8px;color:var(--bad)">${icon("logout")} Leave this company</button>
        </div>
      </div>
      ${accountDataCard()}`;
    $("#acctRoster").addEventListener("click", () => go("roster"));
    $("#acctInbox").addEventListener("click", () => go("messages"));
    $("#acctReports") && $("#acctReports").addEventListener("click", openReports);
    $("#acctLeaveCo") && $("#acctLeaveCo").addEventListener("click", () => {
      const doLeave = (ok) => {
        if (!ok) return;
        API.leaveCompany(co.id).then((d) => { portal.companies = (d && d.companies) || []; APP.setNavForRole(); toast("You've left " + co.name + ".", "good"); go("dashboard"); renderAccount(); })
          .catch((e) => toast((e && e.status === 409) ? "Promote another admin before you can leave." : "Couldn't leave the company.", "bad"));
      };
      if (APP.confirmDialog) APP.confirmDialog({ title: "Leave " + co.name + "?", message: "You'll lose access to this company's pools and roster.", confirm: "Leave company", danger: true }).then(doLeave);
      else doLeave(global.confirm("Leave " + co.name + "?"));
    });
    $("#copyCode").addEventListener("click", () => {
      try { navigator.clipboard.writeText(co.joinCode || ""); toast("Join code copied.", "good"); } catch (e) { toast("Couldn't copy — select it manually.", "warn"); }
    });
    wireAccountCommon(v);
    // load the technician roster
    API.company(co.id).then((d) => {
      const list = $("#techList"); if (!list) return;
      const members = (d && d.members) || [];
      const isAdmin = co.role === "admin";
      list.innerHTML = members.map((m) => `<div class="tech-row ${m.isActive ? "" : "is-inactive"}">
        <span class="tech-row__av">${esc((m.name || m.email || "?").charAt(0).toUpperCase())}</span>
        <span class="tech-row__main"><b>${esc(m.name || "—")}</b><span>${esc(m.email)}</span></span>
        <span class="tech-row__role"><span class="acct-pool__role">${esc(m.role)}${m.isActive ? "" : " · inactive"}</span></span>
        ${isAdmin && m.userId !== u.id ? `<span class="tech-row__act">
          <button class="btn btn--ghost btn--sm" data-tech-role="${m.userId}" data-newrole="${m.role === "admin" ? "tech" : "admin"}">${m.role === "admin" ? "Make tech" : "Make admin"}</button>
          <button class="btn btn--ghost btn--sm" data-tech-active="${m.userId}" data-active="${m.isActive ? 0 : 1}">${m.isActive ? "Deactivate" : "Reactivate"}</button>
        </span>` : ""}
      </div>`).join("") || `<p class="muted">Just you so far. Share your join code to add technicians.</p>`;
      $$("[data-tech-role]", list).forEach((b) => b.addEventListener("click", () => {
        API.updateMember(co.id, +b.getAttribute("data-tech-role"), { role: b.getAttribute("data-newrole") })
          .then(() => { toast("Role updated.", "good"); renderAccount(); })
          .catch((e) => toast((e && e.status === 409) ? "Promote another admin first." : "Couldn't update.", "bad"));
      }));
      $$("[data-tech-active]", list).forEach((b) => b.addEventListener("click", () => {
        API.updateMember(co.id, +b.getAttribute("data-tech-active"), { isActive: b.getAttribute("data-active") === "1" })
          .then(() => { toast("Updated.", "good"); renderAccount(); })
          .catch((e) => toast((e && e.status === 409) ? "Can't deactivate the last admin." : "Couldn't update.", "bad"));
      }));
    }).catch(() => { const list = $("#techList"); if (list) list.innerHTML = `<p class="muted">Couldn't load technicians.</p>`; });
  }

  /* ---- HOMEOWNER account ---- */
  function renderHomeownerAccount(v) {
    const u = portal.user || {};
    const co = portal.companies && portal.companies[0];
    const pools = portal.pools || [];
    v.innerHTML = `
      <div class="page-head">
        <span class="eyebrow">${icon("user")} Account</span>
        <h1>${esc(u.name || "Your account")} <button class="btn btn--ghost btn--sm" id="acctEditName" style="vertical-align:middle">${icon("setup")} ${u.name ? "Edit name" : "Add your name"}</button></h1>
        <p class="lead">${esc(u.email || "")}</p>
      </div>
      <div class="grid cols-2" style="align-items:start;gap:22px">
        <div class="card pad-lg">
          <div class="card__title">${icon("droplet")} Your pools</div>
          <div class="acct-pools">
            ${pools.length ? pools.map((p) => `<button class="acct-pool ${portal.pool && p.id === portal.pool.id ? "is-current" : ""}" data-pid="${p.id}">
              <span class="poolrow__dot" data-state="${attnLevel(p.attentionScore || 0)}" title="${LVL_WORD[attnLevel(p.attentionScore || 0)]}" aria-hidden="true"></span>
              <span>${esc(p.name || "My Pool")}${p.role && p.role !== "owner" ? ` <span class="acct-pool__role">${esc(p.role)}</span>` : ""}</span>
              ${portal.pool && p.id === portal.pool.id ? icon("check") : ""}</button>`).join("") : `<p class="muted">No pools yet.</p>`}
          </div>
          <button class="btn btn--ghost btn--block" id="acctAddPool" style="margin-top:10px">${icon("plus")} Add a pool</button>
          <button class="btn btn--ghost btn--block" id="acctClaim" style="margin-top:8px">${icon("pin")} Claim a pool with an invite code</button>
          ${portal.pool && (portal.pool.role === "owner" || !portal.pool.role) ? `<button class="btn btn--ghost btn--block" id="acctDelPool" style="margin-top:8px;color:var(--bad)">${icon("close")} Remove this pool</button>` : ""}
        </div>
        <div class="card pad-lg" id="svcCard">
          <div class="card__title">${icon("setup")} Service company</div>
          ${(portal.pool && portal.pool.company)
            ? `<p class="muted">This pool is serviced by <b>${esc(portal.pool.company.name)}</b>. They can see its readings and message you.</p>
               <button class="btn btn--ghost btn--block" id="acctSvcHist" style="margin-top:10px">${icon("clock")} Service history</button>
               <button class="btn btn--ghost btn--block" id="acctUnlink" style="margin-top:8px">${icon("leak")} Disconnect this company</button>`
            : `<p class="muted">Connect to a pool service company so they can see your pool and help you maintain it.</p>
               <div class="field" style="margin-top:10px"><label for="acctJoinCode">Company join code</label><input class="input" id="acctJoinCode" placeholder="Paste the code your pool company gave you" autocomplete="off"></div>
               <button class="btn btn--primary btn--block" id="acctJoin">${icon("setup")} Connect to my pool company</button>`}
        </div>
      </div>
      ${accountDataCard()}`;
    $$("[data-pid]", v).forEach((b) => b.addEventListener("click", () => { const pid = +b.getAttribute("data-pid"); if (!portal.pool || pid !== portal.pool.id) APP.loadPool(pid).then(() => go("dashboard")); }));
    $("#acctAddPool") && $("#acctAddPool").addEventListener("click", addPoolFlow);
    $("#acctClaim") && $("#acctClaim").addEventListener("click", openClaimPool);
    const delBtn = $("#acctDelPool");
    if (delBtn) delBtn.addEventListener("click", () => {
      const pid = portal.pool && portal.pool.id; if (!pid) return;
      const name = poolDisplayName(portal.pool);
      const doDel = (ok) => {
        if (!ok) return;
        API.deletePool(pid).then(() => {
          toast("Pool removed.", "good");
          portal.pools = (portal.pools || []).filter((x) => x.id !== pid);
          const next = portal.pools[0];
          if (next) APP.loadPool(next.id).then(() => renderAccount());
          else { portal.pool = null; portal.selectedPoolId = null; APP.setNavForRole(); renderAccount(); }
        }).catch(() => toast("Couldn't remove this pool.", "bad"));
      };
      if (APP.confirmDialog) APP.confirmDialog({ title: "Remove " + name + "?", message: "This permanently deletes the pool and all its readings from your account.", confirm: "Remove pool", danger: true }).then(doDel);
      else doDel(global.confirm("Remove this pool and all its readings?"));
    });
    wireAccountCommon(v);
    $("#acctSvcHist") && $("#acctSvcHist").addEventListener("click", () => openServiceHistory(portal.pool && portal.pool.id));
    const unlink = $("#acctUnlink");
    if (unlink) unlink.addEventListener("click", () => {
      if (!global.confirm("Disconnect your service company from this pool? They'll lose access.")) return;
      API.unlinkCompany(portal.pool.id).then(() => { toast("Disconnected.", "good"); APP.loadPool(portal.pool.id).then(renderAccount); })
        .catch(() => toast("Couldn't disconnect.", "bad"));
    });
    const joinBtn = $("#acctJoin");
    if (joinBtn) joinBtn.addEventListener("click", () => {
      const code = ($("#acctJoinCode") || {}).value || "";
      if (!code.trim()) { toast("Paste your company's join code.", "warn"); return; }
      joinBtn.disabled = true;
      // a homeowner joining via code links the CURRENT pool to that company
      const pid = portal.pool && portal.pool.id;
      const p = pid ? API.linkCompany(pid, code.trim()) : API.companyJoin(code.trim());
      p.then((d) => { toast("Connected! 🎉", "good"); if (pid) { APP.loadPool(pid).then(renderAccount); } else { portal.companies = (d && d.companies) || portal.companies; APP.setNavForRole(); renderAccount(); } })
        .catch((e) => { joinBtn.disabled = false; toast((e && e.status === 404) ? "That code didn't match a company." : "Couldn't connect.", "bad"); });
    });
  }

  function emptyState(msg) {
    return `<div class="page-head"><h1>Not available</h1><p class="lead">${esc(msg)}</p></div>`;
  }

  /* ===================================================================
     Register RENDER.* with the app + expose PORTAL API
     =================================================================== */
  /* ===================================================================
     SERVICE VISIT / REPORTS / ASSIGNMENT  (Phase 3 company depth)
     =================================================================== */
  function openVisit(pid) {
    pid = pid || (portal.pool && portal.pool.id); if (!pid) return;
    const layer = $("#modalLayer"); if (!layer) return;
    const CHECK = [["skim", "Skimmed surface"], ["brush", "Brushed walls"], ["baskets", "Emptied baskets"], ["vacuum", "Vacuumed"], ["filter", "Checked filter"], ["test", "Tested water"]];
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    API.startVisit(pid).then((d) => {
      const v = d && d.visit; if (!v) { toast("Couldn't start the visit.", "bad"); return; }
      layer.hidden = false; layer.className = "overlay is-open";
      layer.innerHTML = `<div class="sheet" style="width:min(460px,100%)" role="dialog" aria-modal="true" aria-label="Service visit">
        <div class="sheet__head"><h2>${icon("wrench")} Service visit</h2><button class="iconbtn" id="vClose" aria-label="Close">${icon("close")}</button></div>
        <p class="muted" style="margin:-4px 0 10px">Tick what you did, add a note, and finish — the homeowner gets a tidy summary.</p>
        <div class="visit-checks">${CHECK.map(([k, lbl]) => `<label class="visit-check"><input type="checkbox" data-vk="${k}"> <span>${esc(lbl)}</span></label>`).join("")}</div>
        <div class="field" style="margin-top:10px"><label for="vSummary">Summary for the homeowner</label><textarea class="input" id="vSummary" rows="3" placeholder="e.g. Water clear, added 1 gal chlorine, FC now 6."></textarea></div>
        <button class="btn btn--primary btn--block" id="vDone">${icon("check")} Complete visit</button></div>`;
      $("#vClose").addEventListener("click", close);
      layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
      $("#vDone").addEventListener("click", () => {
        const checklist = {}; $$("[data-vk]", layer).forEach((c) => { checklist[c.getAttribute("data-vk")] = c.checked; });
        const summary = ($("#vSummary") || {}).value || "";
        API.updateVisit(pid, v.id, { checklist: checklist, summary: summary, complete: true })
          .then(() => { toast("Visit logged — the homeowner was notified.", "good"); close(); })
          .catch(() => toast("Couldn't complete the visit.", "bad"));
      });
    }).catch(() => toast("Couldn't start the visit.", "bad"));
  }
  function openReports() {
    const co = portal.companies && portal.companies[0]; if (!co) return;
    const layer = $("#modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet" style="width:min(520px,100%)" role="dialog" aria-modal="true" aria-label="Reports">
      <div class="sheet__head"><h2>${icon("grid")} Reports <span class="muted" style="font-weight:600;font-size:.8rem">last 30 days</span></h2><button class="iconbtn" id="rpClose" aria-label="Close">${icon("close")}</button></div>
      <div id="rpBody"><p class="muted">Loading…</p></div></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    $("#rpClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    API.reports(co.id).then((d) => {
      const r = d && d.report; const body = $("#rpBody"); if (!body || !r) return;
      body.innerHTML = `
        <div class="grid cols-2" style="gap:10px;margin-bottom:12px">
          <div class="kpi"><b>${r.poolsTotal}</b><span>pools serviced</span></div>
          <div class="kpi"><b>${r.visitsDone30d}</b><span>visits done</span></div>
          <div class="kpi"><b style="color:var(--warn)">${r.overdue}</b><span>overdue (7d+)</span></div>
          <div class="kpi"><b>${r.perTech.length}</b><span>active techs</span></div>
        </div>
        ${r.perTech.length ? `<h3 style="margin:10px 0 6px;font-size:.95rem">Visits by tech</h3>${r.perTech.map((t) => `<div class="spread" style="padding:4px 0"><span>${esc(t.name || "—")}</span><b>${t.visits}</b></div>`).join("")}` : ""}
        ${r.chemUsage.length ? `<h3 style="margin:12px 0 6px;font-size:.95rem">Chemical usage</h3>${r.chemUsage.map((c) => `<div class="spread" style="padding:4px 0"><span>${esc(c.chem)}</span><span class="muted">${c.count} doses · ${c.amount}</span></div>`).join("")}` : `<p class="muted" style="margin-top:8px">No doses logged in this window.</p>`}
        <button class="btn btn--ghost btn--block" id="rpCsv" style="margin-top:14px">${icon("export")} Export CSV</button>`;
      $("#rpCsv").addEventListener("click", () => {
        let csv = "metric,value\npools_serviced," + r.poolsTotal + "\nvisits_30d," + r.visitsDone30d + "\noverdue," + r.overdue + "\n\ntech,visits\n";
        r.perTech.forEach((t) => { csv += '"' + (t.name || "").replace(/"/g, '""') + '",' + t.visits + "\n"; });
        csv += "\nchemical,doses,amount\n"; r.chemUsage.forEach((c) => { csv += '"' + c.chem + '",' + c.count + "," + c.amount + "\n"; });
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); a.download = "poolaris-report.csv"; a.click();
        toast("Exported poolaris-report.csv", "good");
      });
    }).catch(() => { const b = $("#rpBody"); if (b) b.innerHTML = `<p class="muted">Couldn't load the report.</p>`; });
  }
  function openAssign(pid) {
    pid = pid || (portal.pool && portal.pool.id); const co = portal.companies && portal.companies[0]; if (!pid || !co) return;
    const layer = $("#modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet" style="width:min(420px,100%)" role="dialog" aria-modal="true" aria-label="Assign technicians">
      <div class="sheet__head"><h2>${icon("wrench")} Assign technicians</h2><button class="iconbtn" id="asClose" aria-label="Close">${icon("close")}</button></div>
      <p class="muted" style="margin:-4px 0 10px">Pick who services this pool — assigned techs see it on their route.</p>
      <div id="asBody"><p class="muted">Loading…</p></div></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    $("#asClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    API.company(co.id).then((cd) => {
      const members = (cd && cd.members) || [];
      const body = $("#asBody"); if (!body) return;
      if (!members.length) { body.innerHTML = `<p class="muted">No technicians yet — share your join code first.</p>`; return; }
      body.innerHTML = members.map((mb) => `<div class="spread" style="padding:6px 0"><span>${esc(mb.name || mb.email)} <span class="acct-pool__role">${esc(mb.role)}</span></span>
        <span style="display:inline-flex;gap:6px"><button class="btn btn--ghost btn--sm" data-asg="${mb.userId}">Assign</button><button class="btn btn--ghost btn--sm" data-unasg="${mb.userId}">Remove</button></span></div>`).join("");
      $$("[data-asg]", body).forEach((b) => b.addEventListener("click", () => { API.assignTech(pid, { accountId: +b.getAttribute("data-asg") }).then(() => toast("Assigned to this pool.", "good")).catch(() => toast("Couldn't assign.", "bad")); }));
      $$("[data-unasg]", body).forEach((b) => b.addEventListener("click", () => { API.unassignTech(pid, +b.getAttribute("data-unasg")).then(() => toast("Removed.", "good")).catch(() => toast("Couldn't remove.", "bad")); }));
    }).catch(() => { const b = $("#asBody"); if (b) b.innerHTML = `<p class="muted">Couldn't load technicians.</p>`; });
  }
  // Homeowner-facing "who serviced my pool" — visits + access trail for the current pool.
  function openServiceHistory(pid) {
    pid = pid || (portal.pool && portal.pool.id); if (!pid) return;
    const layer = $("#modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    layer.innerHTML = `<div class="sheet" style="width:min(460px,100%)" role="dialog" aria-modal="true" aria-label="Service history">
      <div class="sheet__head"><h2>${icon("clock")} Service history</h2><button class="iconbtn" id="shClose" aria-label="Close">${icon("close")}</button></div>
      <div id="shBody"><p class="muted">Loading…</p></div></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    $("#shClose").addEventListener("click", close);
    layer.addEventListener("click", (e) => { if (e.target === layer) close(); });
    Promise.all([API.visits(pid).catch(() => ({})), API.accessLog(pid).catch(() => ({}))]).then((res) => {
      const visits = (res[0] && res[0].visits) || [], log = (res[1] && res[1].log) || [];
      const body = $("#shBody"); if (!body) return;
      if (!visits.length && !log.length) { body.innerHTML = `<p class="muted">No service activity yet. When your pool company logs a visit, it'll appear here.</p>`; return; }
      let html = "";
      if (visits.length) {
        html += `<h3 style="margin:4px 0 6px;font-size:.95rem">Visits</h3>` + visits.map((v) => `<div class="card" style="padding:12px;margin-bottom:8px"><div class="spread"><b>${esc(v.by || "Technician")}</b><span class="muted">${v.completedAt ? relTime(v.completedAt) : (v.status === "open" ? "in progress" : relTime(v.startedAt))}</span></div>${v.summary ? `<p class="muted" style="margin:6px 0 0">${esc(v.summary)}</p>` : ""}</div>`).join("");
      }
      if (log.length) {
        html += `<h3 style="margin:10px 0 6px;font-size:.95rem">Access log</h3>` + log.map((e) => `<div class="spread" style="padding:4px 0;font-size:.86rem"><span>${esc(e.by || "—")} <span class="muted">(${esc(e.relation || "")})</span> ${esc(e.action)}</span><span class="muted">${relTime(e.at)}</span></div>`).join("");
      }
      body.innerHTML = html;
    }).catch(() => { const b = $("#shBody"); if (b) b.innerHTML = `<p class="muted">Couldn't load service history.</p>`; });
  }

  APP.RENDER.messages = renderMessages;
  APP.RENDER.roster = renderRoster;
  APP.RENDER.route = renderRoute;
  APP.RENDER.account = renderAccount;

  Object.assign(global.PORTAL, {
    openAccountMenu: openAccountMenu,
    renderPoolSwitcher: renderPoolSwitcher,
    startInboxPolling: startInboxPolling,
    renderMessages: renderMessages,
    renderRoster: renderRoster,
    renderRoute: renderRoute,
    renderAccount: renderAccount,
    openVisit: openVisit,
    openReports: openReports,
    openAssign: openAssign,
    openServiceHistory: openServiceHistory,
  });

  // If app.js already entered account mode before this script finished loading
  // (it boots synchronously, portal.js loads right after), sync the chrome now.
  if (portal.mode === "account") {
    if (APP.setNavForRole) APP.setNavForRole();
    renderPoolSwitcher();
    startInboxPolling();
  }
})(window);
