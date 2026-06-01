/* ============================================================================
   POOLARIS — engagement layer  (window.ENGAGE)
   ---------------------------------------------------------------------------
   The "makes you want to come back" layer: a testing streak, Perfect-Water
   celebrations with a confetti burst, a weekly 3-ring goal, earned badges, and
   lifetime stats (tests, perfect days, money saved). Everything hangs off one
   `state.engagement` object that rides the existing save() path — so it works
   in offline AND account mode with no new plumbing, and never touches the
   verified chemistry engine.

   Integration (all via a small ctx from app.js):
     ENGAGE.onSave(ctx)        — call inside save(): advances streak, fires
                                  celebration when the day first goes perfect.
     ENGAGE.heroStrip(ctx)     — HTML for the dashboard streak/goal/badges strip.
     ENGAGE.statsCard(ctx)     — HTML for the lifetime-stats card (account/setup).
     ENGAGE.celebrate(opts)    — full-screen confetti + message (also used on
                                  SLAM completion, milestones).
   ctx = { state, profile, latest, health, plan, save, go, S }
   ========================================================================== */
(function (global) {
  "use strict";
  const S = global.SVG;
  const DAY = 86400000;
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }
  function icon(n) { return S && S.icon ? S.icon(n) : ""; }
  function isoDay(t) { const d = new Date(t); return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0"); }
  function todayISO() { return isoDay(Date.now()); }
  function daysBetween(a, b) { return Math.round((new Date(b + "T12:00") - new Date(a + "T12:00")) / DAY); }

  function ensure(state) {
    if (!state.engagement) state.engagement = {};
    const e = state.engagement;
    if (!e.streak) e.streak = { count: 0, longest: 0, lastTestISO: null };
    if (!e.perfectDays) e.perfectDays = [];
    if (!e.badges) e.badges = {};
    if (!e.week) e.week = { startISO: null, tested: 0, perfectToday: false, actionDone: false };
    if (e.monthlyCost == null) e.monthlyCost = 120; // assumed pro service cost for "money saved"
    if (!e.celebratedDays) e.celebratedDays = [];
    return e;
  }

  /* ----------------------------- streak -------------------------------- */
  function advanceStreak(e) {
    const today = todayISO();
    if (e.streak.lastTestISO === today) return; // already counted today
    if (!e.streak.lastTestISO) { e.streak.count = 1; }
    else {
      const gap = daysBetween(e.streak.lastTestISO, today);
      if (gap === 1) e.streak.count += 1;
      else if (gap > 1) e.streak.count = 1;     // missed a day → reset (gently, see copy)
      // gap <= 0 shouldn't happen (back-dated) — leave count
    }
    e.streak.lastTestISO = today;
    if (e.streak.count > e.streak.longest) e.streak.longest = e.streak.count;
  }
  function streakAlive(e) {
    if (!e.streak.lastTestISO) return false;
    return daysBetween(e.streak.lastTestISO, todayISO()) <= 1;
  }

  /* ----------------------------- weekly goal --------------------------- */
  function weekStartISO() {
    const d = new Date(); const day = (d.getDay() + 6) % 7; // Monday=0
    d.setDate(d.getDate() - day); return isoDay(d.getTime());
  }
  function rollWeek(e) {
    const ws = weekStartISO();
    if (e.week.startISO !== ws) e.week = { startISO: ws, tested: 0, perfectToday: false, actionDone: false };
  }
  function weekGoals(e) {
    return [
      { key: "test", label: "Test 3×", icon: "beaker", done: e.week.tested >= 3, n: Math.min(3, e.week.tested), of: 3 },
      { key: "perfect", label: "Hit perfect", icon: "check", done: !!e.week.perfectToday, n: e.week.perfectToday ? 1 : 0, of: 1 },
      { key: "balanced", label: "Stay in range", icon: "target", done: !!e.week.actionDone || !!e.week.perfectToday, n: (e.week.actionDone || e.week.perfectToday) ? 1 : 0, of: 1 },
    ];
  }

  /* ----------------------------- badges -------------------------------- */
  const BADGES = [
    { id: "first-drop", name: "First Drop", icon: "droplet", desc: "Logged your first test", test: (c) => (c.state.log || []).length >= 1 },
    { id: "balanced", name: "Balanced", icon: "target", desc: "Every key number in range", test: (c) => c.health && c.health.state === "good" && c.health.total >= 4 },
    { id: "week-streak", name: "Week Warrior", icon: "clock", desc: "7-day testing streak", test: (c) => c.e.streak.longest >= 7 },
    { id: "month-streak", name: "Dedicated", icon: "clock", desc: "30-day testing streak", test: (c) => c.e.streak.longest >= 30 },
    { id: "ten-tests", name: "Getting the Hang", icon: "beaker", desc: "Logged 10 tests", test: (c) => (c.state.log || []).length >= 10 },
    { id: "fifty-tests", name: "Pool Pro", icon: "beaker", desc: "Logged 50 tests", test: (c) => (c.state.log || []).length >= 50 },
    { id: "perfect-week", name: "Perfect Week", icon: "check", desc: "A full week with perfect water", test: (c) => (c.e.perfectDays || []).length >= 7 },
    { id: "slam-survivor", name: "SLAM Survivor", icon: "slam", desc: "Completed a SLAM", test: (c) => !!(c.e.badges && c.e.badges["slam-survivor"]) },
    { id: "cya-whisperer", name: "CYA Whisperer", icon: "sun", desc: "Brought CYA into range", test: (c) => { const r = c.latest; return r && r.cya != null && r.cya >= 30 && r.cya <= 60; } },
    { id: "storm-ready", name: "Storm Ready", icon: "cloud-rain", desc: "Prepped before a storm", test: (c) => !!(c.e.badges && c.e.badges["storm-ready"]) },
    { id: "budget-brain", name: "Budget Brain", icon: "export", desc: "Saved $500 doing it yourself", test: (c) => moneySaved(c.e) >= 500 },
  ];
  function evalBadges(ctx) {
    const e = ctx.e; const newly = [];
    BADGES.forEach((b) => {
      if (e.badges[b.id]) return;
      try { if (b.test(ctx)) { e.badges[b.id] = Date.now(); newly.push(b); } } catch (x) {}
    });
    return newly;
  }
  function awardBadge(state, id) { const e = ensure(state); if (!e.badges[id]) e.badges[id] = Date.now(); }

  /* ----------------------------- money saved --------------------------- */
  function moneySaved(e) {
    // months maintained × assumed pro cost, from the first perfect/test day
    const first = (e.perfectDays && e.perfectDays[0]) || e.streak.lastTestISO;
    if (!first) return 0;
    const months = Math.max(0, daysBetween(first, todayISO())) / 30;
    return Math.round(months * (e.monthlyCost || 120));
  }

  /* ----------------------------- perfect detection --------------------- */
  function isPerfect(ctx) {
    const h = ctx.health;
    if (!h || h.state !== "good" || h.total < 4) return false;
    // require CSI sane too when known
    if (h.csi != null && Math.abs(h.csi) > 0.5) return false;
    return true;
  }

  /* ===================================================================
     onSave — the heartbeat: advances streak/goal, fires celebration once/day
     =================================================================== */
  function onSave(ctx) {
    const state = ctx.state; const e = ensure(state);
    rollWeek(e);
    // streak + weekly test count advance only when a NEW reading exists today
    const log = state.log || [];
    const last = log.length ? log[log.length - 1] : null;
    const testedToday = last && isoDay(last.t) === todayISO();
    if (testedToday && e.streak.lastTestISO !== todayISO()) {
      e.week.tested += 1;
    }
    if (testedToday) advanceStreak(e);

    const perfect = isPerfect(ctx);
    const today = todayISO();
    if (perfect) {
      e.week.perfectToday = true;
      if ((e.perfectDays || []).indexOf(today) < 0) e.perfectDays.push(today);
    }
    // fire the celebration the first time the day becomes perfect
    let celebrated = false;
    if (perfect && (e.celebratedDays || []).indexOf(today) < 0) {
      e.celebratedDays.push(today);
      celebrate({
        title: "Perfect water! 🎉",
        msg: "Every key number is dialed in. This is exactly where you want to be — nice work.",
        sub: e.perfectDays.length > 1 ? `That's ${e.perfectDays.length} perfect days logged.` : "Your first perfect day!",
      });
      celebrated = true;
    }
    // badges
    const newly = evalBadges({ e: e, state: state, latest: ctx.latest, health: ctx.health });
    if (newly.length && !celebrated && ctx.toast) {
      newly.forEach((b) => ctx.toast(`🏅 Badge unlocked: ${b.name}`, "good"));
    }
    return { perfect: perfect, celebrated: celebrated, newBadges: newly };
  }

  /* ===================================================================
     dashboard hero strip — streak · weekly rings · perfect days
     =================================================================== */
  function heroStrip(ctx) {
    const e = ensure(ctx.state);
    rollWeek(e);
    const alive = streakAlive(e);
    const goals = weekGoals(e);
    const doneN = goals.filter((g) => g.done).length;
    const saved = moneySaved(e);
    const badgeCount = Object.keys(e.badges || {}).length;
    return `<div class="eng-strip">
      <button class="eng-stat eng-streak ${alive && e.streak.count > 0 ? "is-on" : ""}" data-eng="streak" title="Testing streak">
        <span class="eng-stat__ic">${flameSvg()}</span>
        <span class="eng-stat__v">${e.streak.count}</span>
        <span class="eng-stat__l">day streak</span>
      </button>
      <button class="eng-stat" data-eng="week" title="This week's goal">
        <span class="eng-rings">${ringsSvg(goals)}</span>
        <span class="eng-stat__v">${doneN}/3</span>
        <span class="eng-stat__l">weekly goal</span>
      </button>
      <button class="eng-stat" data-eng="perfect" title="Perfect-water days">
        <span class="eng-stat__ic" style="color:var(--good)">${icon("check")}</span>
        <span class="eng-stat__v">${(e.perfectDays || []).length}</span>
        <span class="eng-stat__l">perfect days</span>
      </button>
      <button class="eng-stat" data-eng="badges" title="Badges earned">
        <span class="eng-stat__ic" style="color:var(--sun)">${icon("target")}</span>
        <span class="eng-stat__v">${badgeCount}</span>
        <span class="eng-stat__l">badge${badgeCount === 1 ? "" : "s"}</span>
      </button>
      ${saved > 0 ? `<button class="eng-stat" data-eng="badges" title="Estimated savings vs a pro service">
        <span class="eng-stat__ic" style="color:var(--good)">${icon("export")}</span>
        <span class="eng-stat__v">$${saved}</span>
        <span class="eng-stat__l">saved</span>
      </button>` : ""}
    </div>`;
  }

  function wireHeroStrip(root, ctx) {
    (root || document).querySelectorAll("[data-eng]").forEach((b) => b.addEventListener("click", () => openEngSheet(b.getAttribute("data-eng"), ctx)));
  }

  /* engagement detail sheet (streak calendar, weekly goals, badge grid) */
  function openEngSheet(which, ctx) {
    const e = ensure(ctx.state);
    const layer = document.getElementById("modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open";
    let body = "";
    if (which === "week") {
      const goals = weekGoals(e);
      body = `<h2>${icon("target")} This week</h2>
        <p class="muted">Three simple goals. Hit all three for a Perfect Week badge.</p>
        <div class="eng-goals">${goals.map((g) => `<div class="eng-goal ${g.done ? "is-done" : ""}">
          <span class="eng-goal__ic">${icon(g.done ? "check" : g.icon)}</span>
          <div><b>${g.label}</b><span class="eng-goal__p">${g.n}/${g.of}</span></div></div>`).join("")}</div>`;
    } else if (which === "badges") {
      body = `<h2>${icon("target")} Your badges</h2>
        <div class="eng-badges">${BADGES.map((b) => { const got = !!e.badges[b.id]; return `<div class="eng-badge ${got ? "is-got" : "is-locked"}">
          <span class="eng-badge__ic">${icon(b.icon)}</span><b>${esc(b.name)}</b><span>${esc(b.desc)}</span></div>`; }).join("")}</div>`;
    } else if (which === "streak") {
      body = `<h2>${flameSvg()} ${e.streak.count}-day streak</h2>
        <p class="muted">${streakAlive(e) ? "You're on a roll — test again tomorrow to keep it going." : "Your streak is resting. Log a test to start a fresh one — pools forgive."}</p>
        <div class="eng-streak-stat"><div><b>${e.streak.count}</b><span>current</span></div><div><b>${e.streak.longest}</b><span>longest</span></div><div><b>${(e.perfectDays || []).length}</b><span>perfect days</span></div></div>`;
    } else {
      body = `<h2>${icon("check")} ${(e.perfectDays || []).length} perfect days</h2><p class="muted">Days where every key number was in its ideal range. Keep testing to grow the count.</p>`;
    }
    layer.innerHTML = `<div class="sheet eng-sheet" role="dialog" aria-modal="true">
      <button class="iconbtn eng-sheet__close" id="engClose" aria-label="Close">${icon("close")}</button>${body}</div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    document.getElementById("engClose").addEventListener("click", close);
    layer.addEventListener("click", (ev) => { if (ev.target === layer) close(); });
  }

  /* ----------------------------- stats card ---------------------------- */
  function statsCard(ctx) {
    const e = ensure(ctx.state);
    const tests = (ctx.state.log || []).length;
    const saved = moneySaved(e);
    return `<div class="card pad-lg">
      <div class="card__title">${icon("target")} Your progress</div>
      <div class="eng-statgrid">
        <div class="eng-sg"><b>${tests}</b><span>tests logged</span></div>
        <div class="eng-sg"><b>${e.streak.longest}</b><span>longest streak</span></div>
        <div class="eng-sg"><b>${(e.perfectDays || []).length}</b><span>perfect days</span></div>
        <div class="eng-sg"><b>${Object.keys(e.badges || {}).length}</b><span>badges</span></div>
        ${saved > 0 ? `<div class="eng-sg"><b>$${saved}</b><span>saved vs a pro</span></div>` : ""}
      </div>
    </div>`;
  }

  /* ===================================================================
     celebrate — full-screen confetti + message (no library, ~canvas)
     =================================================================== */
  function celebrate(opts) {
    opts = opts || {};
    const layer = document.getElementById("modalLayer"); if (!layer) return;
    layer.hidden = false; layer.className = "overlay is-open eng-celebrate";
    layer.innerHTML = `<div class="celebrate-card">
      <canvas class="celebrate-canvas" id="confettiCanvas"></canvas>
      <div class="celebrate-inner">
        <div class="celebrate-art">${(S && S.celebrate) ? S.celebrate() : icon("check")}</div>
        <h1>${esc(opts.title || "Nice work!")}</h1>
        <p>${esc(opts.msg || "")}</p>
        ${opts.sub ? `<p class="celebrate-sub">${esc(opts.sub)}</p>` : ""}
        <button class="btn btn--primary btn--lg" id="celebrateClose">Keep it up ${icon("arrow")}</button>
      </div></div>`;
    const close = () => { layer.hidden = true; layer.className = "overlay"; layer.innerHTML = ""; };
    document.getElementById("celebrateClose").addEventListener("click", close);
    if (!global.matchMedia || !global.matchMedia("(prefers-reduced-motion: reduce)").matches) confetti();
  }
  function confetti() {
    const cv = document.getElementById("confettiCanvas"); if (!cv) return;
    const card = cv.parentElement; cv.width = card.offsetWidth; cv.height = card.offsetHeight;
    const ctx = cv.getContext("2d");
    const colors = ["#15aabf", "#20c997", "#ffd43b", "#ff8787", "#845ef7", "#22b8cf"];
    const N = 110, parts = [];
    for (let i = 0; i < N; i++) parts.push({ x: cv.width / 2, y: cv.height * 0.38, vx: (Math.cos(i) * 2 + (i % 7 - 3)) * 1.6, vy: (-6 - (i % 5)) * 1.1, c: colors[i % colors.length], r: 3 + (i % 4), rot: i, vr: (i % 3 - 1) * 0.2 });
    let frames = 0;
    (function tick() {
      frames++; ctx.clearRect(0, 0, cv.width, cv.height);
      parts.forEach((p) => { p.vy += 0.16; p.x += p.vx; p.y += p.vy; p.rot += p.vr; ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot); ctx.fillStyle = p.c; ctx.fillRect(-p.r, -p.r, p.r * 2, p.r * 2.6); ctx.restore(); });
      if (frames < 140) global.requestAnimationFrame(tick);
    })();
  }

  /* ----------------------------- small svgs ---------------------------- */
  function flameSvg() { return `<svg viewBox="0 0 24 24" width="1em" height="1em" style="vertical-align:-0.16em"><path d="M12 2c1 3-2 4-2 7a2 2 0 0 0 4 0c0-1 0-1 0-1 2 2 3 4 3 6a5 5 0 0 1-10 0c0-4 4-5 5-12Z" fill="currentColor"/></svg>`; }
  function ringsSvg(goals) {
    const cols = ["#15aabf", "#20c997", "#ffd43b"];
    return `<svg viewBox="0 0 36 36" width="1.4em" height="1.4em">${goals.map((g, i) => { const rad = 15 - i * 4.5; const c = 2 * Math.PI * rad; const frac = g.of ? g.n / g.of : 0; return `<circle cx="18" cy="18" r="${rad}" fill="none" stroke="var(--line)" stroke-width="3"/><circle cx="18" cy="18" r="${rad}" fill="none" stroke="${cols[i]}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - frac)}" transform="rotate(-90 18 18)"/>`; }).join("")}</svg>`;
  }

  /* ----------------------------- CSS injection ------------------------- */
  let cssDone = false;
  function injectCSS() {
    if (cssDone) return; cssDone = true;
    const css = `
    .eng-strip{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:22px}
    .eng-stat{display:flex;flex-direction:column;align-items:center;gap:1px;min-width:78px;padding:11px 14px;border:1px solid var(--line);border-radius:15px;background:var(--card);cursor:pointer;font:inherit;color:inherit;transition:transform .12s,border-color .12s}
    .eng-stat:hover{transform:translateY(-2px);border-color:var(--aqua)}
    .eng-stat__ic{font-size:1.3rem;line-height:1;display:flex}
    .eng-stat__v{font-size:1.3rem;font-weight:800;font-variant-numeric:tabular-nums;line-height:1.1}
    .eng-stat__l{font-size:.68rem;color:var(--ink-3);text-transform:uppercase;letter-spacing:.03em}
    .eng-streak .eng-stat__ic{color:var(--ink-4)}
    .eng-streak.is-on .eng-stat__ic{color:#ff8c42}
    .eng-rings{display:flex}
    .eng-sheet{width:min(460px,100%);position:relative}
    .eng-sheet__close{position:absolute;top:12px;right:12px} .eng-sheet__close svg{transform:rotate(180deg)}
    .eng-goals{display:flex;flex-direction:column;gap:10px;margin-top:12px}
    .eng-goal{display:flex;align-items:center;gap:12px;padding:12px;border:1px solid var(--line);border-radius:13px}
    .eng-goal.is-done{border-color:var(--good);background:var(--good-bg)}
    .eng-goal__ic{width:30px;height:30px;display:flex;align-items:center;justify-content:center;border-radius:50%;background:var(--foam);color:var(--ink-3)}
    .eng-goal.is-done .eng-goal__ic{background:var(--good);color:#fff}
    .eng-goal__p{display:block;font-size:.78rem;color:var(--ink-3)}
    .eng-badges{display:grid;grid-template-columns:repeat(auto-fill,minmax(120px,1fr));gap:10px;margin-top:12px}
    .eng-badge{display:flex;flex-direction:column;align-items:center;gap:3px;text-align:center;padding:14px 8px;border:1px solid var(--line);border-radius:14px}
    .eng-badge__ic{font-size:1.7rem}
    .eng-badge.is-locked{opacity:.42;filter:grayscale(1)}
    .eng-badge.is-got{border-color:var(--sun);background:var(--sun-bg,transparent)}
    .eng-badge b{font-size:.84rem} .eng-badge span{font-size:.7rem;color:var(--ink-3)}
    .eng-streak-stat,.eng-statgrid{display:flex;gap:16px;margin-top:14px}
    .eng-streak-stat>div,.eng-sg{display:flex;flex-direction:column}
    .eng-streak-stat b,.eng-sg b{font-size:1.5rem;font-weight:800;font-variant-numeric:tabular-nums}
    .eng-streak-stat span,.eng-sg span{font-size:.74rem;color:var(--ink-3)}
    .eng-statgrid{flex-wrap:wrap;gap:20px}
    .eng-celebrate{display:grid;place-items:center}
    .celebrate-card{position:relative;width:min(440px,92vw);min-height:380px;background:var(--card);border-radius:24px;overflow:hidden;box-shadow:0 30px 80px rgba(0,0,0,.4)}
    .celebrate-canvas{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}
    .celebrate-inner{position:relative;z-index:1;padding:34px 28px;text-align:center}
    .celebrate-art{max-width:160px;margin:0 auto 6px}
    .celebrate-inner h1{margin:.1em 0}
    .celebrate-sub{color:var(--aqua);font-weight:700}
    `;
    const el = document.createElement("style"); el.id = "engage-css"; el.textContent = css; document.head.appendChild(el);
  }
  injectCSS();

  global.ENGAGE = {
    onSave: onSave, heroStrip: heroStrip, wireHeroStrip: wireHeroStrip, statsCard: statsCard,
    celebrate: celebrate, awardBadge: awardBadge, ensure: ensure, moneySaved: moneySaved,
  };
})(window);
