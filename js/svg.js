/* ============================================================================
   POOLARIS — SVG illustration & icon library
   Everything is generated inline (no image files, fully offline). Each function
   returns an SVG markup string. Neutral colors reference CSS custom properties
   (var(--svg-*)) so every diagram adapts automatically to light / dark mode.
   Diagrams teach concepts visually; they are core to the UX, not decoration.
   ========================================================================== */
(function (global) {
  "use strict";

  // theme-aware neutral palette (resolved live from CSS variables)
  const T = {
    surf: "var(--svg-surface)",
    ink: "var(--svg-ink)",
    line: "var(--svg-line)",
    grid: "var(--svg-grid)",
    mut: "var(--svg-muted)",
    deck: "var(--svg-deck)",
    coping: "var(--svg-coping)",
  };

  const DEFS = `
  <defs>
    <linearGradient id="g-water" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#22b8cf"/><stop offset="1" stop-color="#0b6e99"/>
    </linearGradient>
    <linearGradient id="g-water2" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#15aabf"/><stop offset="1" stop-color="#0e7da8"/>
    </linearGradient>
    <linearGradient id="g-sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#eaf9fc"/><stop offset="1" stop-color="#cdeef4"/>
    </linearGradient>
    <linearGradient id="g-sun" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#ffe066"/><stop offset="1" stop-color="#f59f00"/>
    </linearGradient>
    <linearGradient id="g-good" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0" stop-color="#20c997"/><stop offset="1" stop-color="#12b886"/>
    </linearGradient>
    <radialGradient id="g-drop" cx="35%" cy="28%" r="80%">
      <stop offset="0" stop-color="#5fd6e6"/><stop offset="60%" stop-color="#15aabf"/><stop offset="1" stop-color="#0b6e99"/>
    </radialGradient>
  </defs>`;

  function wrap(vb, inner, extra) {
    return `<svg viewBox="${vb}" xmlns="http://www.w3.org/2000/svg" ${extra || ""}>${inner}</svg>`;
  }

  /* ----------------------------- brand mark ----------------------------- */
  function brand() {
    return wrap("0 0 48 48", `${DEFS}
      <path d="M24 4C24 4 9 20 9 31a15 15 0 0 0 30 0C39 20 24 4 24 4Z" fill="url(#g-drop)"/>
      <path d="M24 4C24 4 9 20 9 31a15 15 0 0 0 30 0C39 20 24 4 24 4Z" fill="none" stroke="#ffffff" stroke-opacity=".35" stroke-width="1.4"/>
      <g transform="translate(24 30)">
        <path d="M0 -9 L2.1 -2.1 L9 0 L2.1 2.1 L0 9 L-2.1 2.1 L-9 0 L-2.1 -2.1 Z" fill="#fff"/>
        <circle r="2.1" fill="#eafbff"/>
      </g>
      <ellipse cx="18.5" cy="20" rx="3.4" ry="2" fill="#ffffff" opacity=".5"/>`);
  }

  /* ----------------------------- nav / ui icons ------------------------- */
  const ICONS = {
    dashboard: `<rect x="3" y="3" width="8" height="8" rx="2.2" fill="currentColor"/><rect x="13" y="3" width="8" height="5" rx="2" fill="none" stroke="currentColor" stroke-width="2"/><rect x="13" y="10" width="8" height="11" rx="2" fill="currentColor" opacity=".55"/><rect x="3" y="13" width="8" height="8" rx="2.2" fill="none" stroke="currentColor" stroke-width="2"/>`,
    log: `<path d="M5 4h11l4 4v12a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 11h8M8 15h5M8 8h4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    plan: `<path d="M5 6h14M5 12h9M5 18h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="19" cy="18" r="2.4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M18 18l.8.8 1.5-1.7" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
    calc: `<rect x="4" y="3" width="16" height="18" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><rect x="7" y="6" width="10" height="3.4" rx="1.2" fill="currentColor" opacity=".5"/><g fill="currentColor"><circle cx="8.5" cy="13" r="1.2"/><circle cx="12" cy="13" r="1.2"/><circle cx="15.5" cy="13" r="1.2"/><circle cx="8.5" cy="17" r="1.2"/><circle cx="12" cy="17" r="1.2"/><circle cx="15.5" cy="17" r="1.2"/></g>`,
    slam: `<path d="M13 2 4 14h6l-1 8 9-12h-6l1-8Z" fill="currentColor"/>`,
    learn: `<path d="M3 6.5C6 5 9 5 12 6.5 15 5 18 5 21 6.5V19c-3-1.5-6-1.5-9 0-3-1.5-6-1.5-9 0V6.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 6.5V19" stroke="currentColor" stroke-width="2"/>`,
    setup: `<path d="M12 2.5l2 .9 2.1-.5 1.2 1.8 2 .8.1 2.2 1.5 1.6-.8 2 .8 2-1.5 1.6-.1 2.2-2 .8-1.2 1.8-2.1-.5-2 .9-2-.9-2.1.5-1.2-1.8-2-.8-.1-2.2L3 14.2l.8-2-.8-2 1.5-1.6.1-2.2 2-.8L8 3.8l2.1.5 2-.9Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="currentColor"/>`,
    droplet: `<path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12Z" fill="currentColor"/>`,
    beaker: `<path d="M9 3h6M10 3v6l-4.5 8.5A2 2 0 0 0 7.3 21h9.4a2 2 0 0 0 1.8-3.5L14 9V3" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M7.5 15h9" stroke="currentColor" stroke-width="2"/>`,
    check: `<path d="M5 12.5l4.5 4.5L19 7" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/>`,
    warn: `<path d="M12 3.5 22 20H2L12 3.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M12 9v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="17.3" r="1.3" fill="currentColor"/>`,
    info: `<circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 11v5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="12" cy="7.7" r="1.3" fill="currentColor"/>`,
    plus: `<path d="M12 5v14M5 12h14" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"/>`,
    arrow: `<path d="M5 12h13M13 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`,
    sun: `<circle cx="12" cy="12" r="4.5" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2"/></g>`,
    moon: `<path d="M20 14.5A8 8 0 0 1 9.5 4 8 8 0 1 0 20 14.5Z" fill="currentColor"/>`,
    flask: `<path d="M10 3h4v5l4 9a2 2 0 0 1-1.8 3H7.8A2 2 0 0 1 6 17l4-9V3Z" fill="currentColor"/>`,
    leak: `<path d="M12 3s7 7.5 7 12a7 7 0 0 1-14 0c0-4.5 7-12 7-12Z" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 14a3 3 0 0 0 6 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    target: `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" stroke-width="2"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`,
    clock: `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M12 7.5V12l3 2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    export: `<path d="M12 15V4m0 0L8 8m4-4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 14v4a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    salt: `<path d="M8 8h8l-1 11a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1L8 8Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M9.5 4.5h5l.5 3.5h-6l.5-3.5Z" fill="currentColor"/>`,
    skip: `<path d="M5 5l9 7-9 7V5ZM18 5v14" fill="currentColor" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>`,
    ruler: `<rect x="3" y="8" width="18" height="8" rx="1.6" fill="none" stroke="currentColor" stroke-width="2"/><g stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M7 8v3M11 8v4M15 8v3M19 8v3"/></g>`,
    tablet: `<circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="2"/><path d="M8 12h8" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    wand: `<path d="M5 19l9-9M14 4l1.4 1.4M19 9l1.4 1.4M16.5 6.5 19 9 9 19l-2.5-2.5Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/><path d="M5 5l.7 1.6L7.3 7l-1.6.7L5 9.3 4.3 7.7 2.7 7l1.6-.4Z" fill="currentColor"/>`,
    cloud: `<path d="M7 18a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A4 4 0 0 1 17 18H7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    "cloud-rain": `<path d="M7 15a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A4 4 0 0 1 17 15H7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 18l-1 2.5M12 18l-1 2.5M16 18l-1 2.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    snow: `<path d="M7 14a4 4 0 0 1-.5-7.97 5.5 5.5 0 0 1 10.6-1.06A4 4 0 0 1 17 14H7Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M9 18v.01M12 19v.01M15 18v.01M10.5 21v.01M13.5 21v.01"/></g>`,
    wind: `<path d="M3 8h10a2.5 2.5 0 1 0-2.5-2.5M3 12h15a2.5 2.5 0 1 1-2.5 2.5M3 16h9a2.5 2.5 0 1 1-2.5 2.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    "sun-uv": `<circle cx="12" cy="12" r="4" fill="currentColor"/><g stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8"/></g>`,
    chat: `<path d="M4 5h16a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9l-4 4v-4H4a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M8 10h8M8 13h5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    grid: `<g fill="none" stroke="currentColor" stroke-width="2"><rect x="3.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.6"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.6"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.6"/></g>`,
    wrench: `<path d="M14.7 6.3a4 4 0 0 0-5.4 5l-6 6a1.5 1.5 0 0 0 2.1 2.1l6-6a4 4 0 0 0 5-5.4l-2.4 2.4-2.1-.6-.6-2.1 2.4-2.4Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    user: `<circle cx="12" cy="8" r="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`,
    send: `<path d="M4 12 20 4l-6 16-3-7-7-1Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/>`,
    logout: `<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4M10 12H3m0 0 4-4m-4 4 4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`,
    pin: `<path d="M12 22s7-7.5 7-13a7 7 0 1 0-14 0c0 5.5 7 13 7 13Z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="12" cy="9" r="2.5" fill="currentColor"/>`,
    close: `<path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`,
    camera: `<path d="M3 8.6A1.6 1.6 0 0 1 4.6 7h2L7.7 5.4A1 1 0 0 1 8.5 5h7a1 1 0 0 1 .8.4L17.4 7h2A1.6 1.6 0 0 1 21 8.6v8.8A1.6 1.6 0 0 1 19.4 19H4.6A1.6 1.6 0 0 1 3 17.4Z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><circle cx="12" cy="13" r="3.2" fill="none" stroke="currentColor" stroke-width="1.8"/>`,
  };
  function icon(name, attrs) {
    // Injected icons are decorative by default → hide from the a11y tree unless the
    // caller explicitly passes aria-/role attributes (icon-only buttons label the button).
    const a11y = (attrs && /aria-|role=/.test(attrs)) ? "" : 'aria-hidden="true" focusable="false" ';
    return wrap("0 0 24 24", ICONS[name] || ICONS.info, a11y + (attrs ? attrs + " " : "") + 'width="1em" height="1em" style="vertical-align:-0.16em;flex:none"');
  }

  /* ----------------------- chemical bottle icons ------------------------ */
  function chem(kind) {
    const map = {
      liquid: { body: "#15aabf", label: "Cl", cap: "#0b6e99" },
      acid: { body: "#f0a020", label: "pH", cap: "#c97a00" },
      puck: { body: "#9ec5d6", label: "", cap: "#6aa3bb" },
      base: { body: "#74c0fc", label: "TA", cap: "#4a90c0" },
      cya: { body: "#b197fc", label: "CYA", cap: "#845ef7" },
      cal: { body: "#cfd6db", label: "CH", cap: "#9aa6ad" },
      salt: { body: "#dee2e6", label: "NaCl", cap: "#adb5bd" },
    };
    const c = map[kind] || map.liquid;
    if (kind === "puck") {
      return wrap("0 0 48 48", `
        <ellipse cx="24" cy="34" rx="15" ry="5.5" fill="${c.body}"/>
        <rect x="9" y="16" width="30" height="18" fill="${c.body}"/>
        <ellipse cx="24" cy="16" rx="15" ry="5.5" fill="${c.cap}"/>
        <ellipse cx="24" cy="16" rx="7" ry="2.4" fill="#ffffff" opacity=".5"/>`);
    }
    if (kind === "salt" || kind === "cal" || kind === "base" || kind === "cya") {
      return wrap("0 0 48 48", `
        <path d="M13 14h22l-2 27a2 2 0 0 1-2 1.8H17A2 2 0 0 1 15 41L13 14Z" fill="${c.body}"/>
        <path d="M16 8h16l1 6H15l1-6Z" fill="${c.cap}"/>
        <rect x="17" y="20" width="14" height="13" rx="2" fill="#fff" opacity=".9"/>
        <text x="24" y="29.5" font-family="Segoe UI,Arial" font-size="8" font-weight="800" fill="${c.cap}" text-anchor="middle">${c.label}</text>`);
    }
    return wrap("0 0 48 48", `
      <rect x="18" y="5" width="12" height="7" rx="2" fill="${c.cap}"/>
      <path d="M15 14h18a3 3 0 0 1 3 3v22a4 4 0 0 1-4 4H16a4 4 0 0 1-4-4V17a3 3 0 0 1 3-3Z" fill="${c.body}"/>
      <rect x="16" y="22" width="16" height="15" rx="2.5" fill="#fff" opacity=".9"/>
      <text x="24" y="32.5" font-family="Segoe UI,Arial" font-size="9" font-weight="800" fill="${c.cap}" text-anchor="middle">${c.label}</text>
      <rect x="15" y="16" width="5" height="24" rx="2" fill="#fff" opacity=".18"/>`);
  }

  /* --------------------------- POOL SHAPES (simple thumbnail) ----------- */
  function poolShape(shape, opts) {
    opts = opts || {};
    const a = opts.a, b = opts.b, w = opts.w;
    const water = "url(#g-water)";
    let body = "";
    if (shape === "rectangle") {
      body = `<rect x="40" y="40" width="220" height="140" rx="14" fill="${T.coping}"/><rect x="48" y="48" width="204" height="124" rx="10" fill="${water}"/>`;
    } else if (shape === "L") {
      body = `<path d="M40 40 H210 a8 8 0 0 1 8 8 V108 H250 a8 8 0 0 1 8 8 V172 a8 8 0 0 1-8 8 H48 a8 8 0 0 1-8-8 Z" fill="${T.coping}"/>
              <path d="M50 50 H204 V112 a6 6 0 0 0 6 6 H248 V170 H50 Z" fill="${water}"/>`;
    } else if (shape === "round") {
      body = `<circle cx="150" cy="110" r="78" fill="${T.coping}"/><circle cx="150" cy="110" r="70" fill="${water}"/>`;
    } else if (shape === "oval") {
      body = `<ellipse cx="150" cy="110" rx="115" ry="72" fill="${T.coping}"/><ellipse cx="150" cy="110" rx="107" ry="64" fill="${water}"/>`;
    } else {
      body = `<path d="M70 60c40-24 110-22 140 8 26 26 8 56-18 64-22 7-26 22-52 28-44 10-92-12-94-54-1-30 20-38 24-44Z" fill="${T.coping}"/>
              <path d="M78 68c36-20 100-18 128 8 22 22 6 48-16 55-20 6-24 20-48 25-38 9-80-10-82-46-1-26 18-34 18-47Z" fill="${water}"/>`;
    }
    const shimmer = `<g stroke="#ffffff" stroke-opacity=".35" stroke-width="2" stroke-linecap="round" fill="none"><path d="M70 80q14-6 28 0t28 0"/><path d="M150 130q14-6 28 0t28 0"/></g>`;
    const labels = `${a ? `<text x="150" y="32" text-anchor="middle" font-size="12" font-weight="700" fill="#0e7da8">${a}</text>` : ""}${w ? `<text x="24" y="112" text-anchor="middle" font-size="12" font-weight="700" fill="#0e7da8" transform="rotate(-90 24 112)">${w}</text>` : ""}${b ? `<text x="234" y="200" text-anchor="middle" font-size="12" font-weight="700" fill="#0e7da8">${b}</text>` : ""}`;
    return wrap("0 0 300 220", `${DEFS}<rect width="300" height="220" fill="${T.deck}" rx="18"/>${body}${shimmer}${labels}`);
  }

  /* ============ INTERACTIVE DIMENSION DIAGRAM (wizard size step) ========= */
  // Draws the actual pool to scale with architectural dimension lines + labels,
  // updating live as the user types. The star of the size step.
  function poolDimDiagram(shape, dims) {
    dims = dims || {};
    const VBW = 440, VBH = 320, pad = 52;
    const aw = VBW - pad * 2, ah = VBH - pad * 2;
    const A = +dims.a || 0, W = +dims.w || 0, B = +dims.b || 0, W2 = +dims.w2 || 0, Dd = +dims.d || 0;

    // real bounding box (feet)
    let rw, rh;
    if (shape === "round") { rw = rh = Dd || 1; }
    else if (shape === "L") { rw = Math.max(A, W2) || 1; rh = Math.max(B, W) || 1; }
    else { rw = A || 1; rh = W || 1; }
    const sc = Math.min(aw / rw, ah / rh) || 1;
    const dw = rw * sc, dh = rh * sc;
    const ox = (VBW - dw) / 2, oy = (VBH - dh) / 2;
    const X = (fx) => ox + fx * sc, Y = (fy) => oy + fy * sc;
    const water = "url(#g-water2)";

    const shimmer = (cx, cy) => `<g stroke="#fff" stroke-opacity=".4" stroke-width="2" fill="none" stroke-linecap="round"><path d="M${cx - 22} ${cy}q11-6 22 0t22 0"/></g>`;
    function badge(cx, cy, text, accent) {
      const wd = (("" + text).length) * 6.6 + 14;
      return `<g><rect x="${cx - wd / 2}" y="${cy - 10}" width="${wd}" height="20" rx="10" fill="${T.surf}" stroke="${accent || "#15aabf"}" stroke-width="1.4"/><text x="${cx}" y="${cy + 4.5}" text-anchor="middle" font-size="11.5" font-weight="800" fill="${accent || "#0e7da8"}">${text}</text></g>`;
    }
    function dimH(x1, x2, y, text, accent) {
      return `<g stroke="${accent || "#9ec5d6"}" stroke-width="1.5"><line x1="${x1}" y1="${y}" x2="${x2}" y2="${y}"/><line x1="${x1}" y1="${y - 5}" x2="${x1}" y2="${y + 5}"/><line x1="${x2}" y1="${y - 5}" x2="${x2}" y2="${y + 5}"/></g>${badge((x1 + x2) / 2, y, text, accent)}`;
    }
    function dimV(y1, y2, x, text, accent) {
      return `<g stroke="${accent || "#9ec5d6"}" stroke-width="1.5"><line x1="${x}" y1="${y1}" x2="${x}" y2="${y2}"/><line x1="${x - 5}" y1="${y1}" x2="${x + 5}" y2="${y1}"/><line x1="${x - 5}" y1="${y2}" x2="${x + 5}" y2="${y2}"/></g>${badge(x, (y1 + y2) / 2, text, accent)}`;
    }
    const ft = (n) => (n ? n + "'" : "?");

    let pool = "", dimsSvg = "";
    if (shape === "L") {
      // polygon: (0,0)(A,0)(A,W)(W2,W)(W2,B)(0,B)
      const pts = [[0, 0], [A, 0], [A, W], [W2, W], [W2, B], [0, B]].map((p) => `${X(p[0])},${Y(p[1])}`).join(" ");
      pool = `<polygon points="${pts}" fill="${water}"/><polygon points="${pts}" fill="none" stroke="#fff" stroke-opacity=".25" stroke-width="2"/>${shimmer(X(W2 / 2 + (A - W2) / 4) || X(A / 2), Y(W / 2))}`;
      dimsSvg =
        dimH(X(0), X(A), oy - 22, ft(A), "#15aabf") +            // top: arm1 length
        dimV(Y(0), Y(W), X(A) + 24, ft(W), "#f08c00") +          // right: arm1 width
        dimV(Y(0), Y(B), ox - 24, ft(B), "#15aabf") +            // left: arm2 length
        dimH(X(0), X(W2), Y(B) + 22, ft(W2), "#f08c00") +        // bottom: arm2 width
        // derived inner segment hints
        (A && W2 ? `<text x="${X((A + W2) / 2)}" y="${Y(W) - 7}" text-anchor="middle" font-size="9.5" font-weight="700" fill="${T.mut}">${(A - W2) > 0 ? (A - W2) + "' notch" : ""}</text>` : "");
    } else if (shape === "round") {
      pool = `<circle cx="${X(Dd / 2)}" cy="${Y(Dd / 2)}" r="${(Dd / 2) * sc}" fill="${water}"/>${shimmer(X(Dd / 2), Y(Dd / 2))}`;
      dimsSvg = dimH(X(0), X(Dd), Y(Dd / 2), ft(Dd), "#15aabf");
    } else if (shape === "oval") {
      pool = `<ellipse cx="${X(A / 2)}" cy="${Y(W / 2)}" rx="${(A / 2) * sc}" ry="${(W / 2) * sc}" fill="${water}"/>${shimmer(X(A / 2), Y(W / 2))}`;
      dimsSvg = dimH(X(0), X(A), oy - 22, ft(A), "#15aabf") + dimV(Y(0), Y(W), ox - 24, ft(W), "#f08c00");
    } else if (shape === "kidney") {
      const x0 = ox, y0 = oy, kw = dw, kh = dh;
      pool = `<path d="M${x0 + kw * .1} ${y0 + kh * .35}
        C${x0 + kw * .15} ${y0 - kh * .05}, ${x0 + kw * .55} ${y0}, ${x0 + kw * .62} ${y0 + kh * .28}
        C${x0 + kw * .67} ${y0 + kh * .5}, ${x0 + kw} ${y0 + kh * .35}, ${x0 + kw * .95} ${y0 + kh * .68}
        C${x0 + kw * .9} ${y0 + kh}, ${x0 + kw * .4} ${y0 + kh * 1.02}, ${x0 + kw * .22} ${y0 + kh * .82}
        C${x0 + kw * .05} ${y0 + kh * .68}, ${x0 + kw * .04} ${y0 + kh * .55}, ${x0 + kw * .1} ${y0 + kh * .35} Z"
        fill="${water}"/>${shimmer(X(A / 2), Y(W / 2))}`;
      dimsSvg = dimH(X(0), X(A), oy - 22, ft(A), "#15aabf") + dimV(Y(0), Y(W), ox - 24, ft(W), "#f08c00");
    } else { // rectangle
      pool = `<rect x="${X(0)}" y="${Y(0)}" width="${dw}" height="${dh}" rx="${Math.min(14, dw / 8)}" fill="${water}"/>${shimmer(X(A / 2), Y(W / 2))}`;
      dimsSvg = dimH(X(0), X(A), oy - 22, ft(A), "#15aabf") + dimV(Y(0), Y(W), ox - 24, ft(W), "#f08c00");
    }
    return wrap(`0 0 ${VBW} ${VBH}`, `${DEFS}
      <rect width="${VBW}" height="${VBH}" rx="20" fill="${T.deck}"/>
      <g opacity=".5">${[0.25, 0.5, 0.75].map((f) => `<line x1="${ox + dw * f}" y1="${oy}" x2="${ox + dw * f}" y2="${oy + dh}" stroke="${T.line}" stroke-width="1" stroke-dasharray="3 5"/>`).join("")}</g>
      ${pool}${dimsSvg}`);
  }

  /* ---------------- pool CROSS-SECTION (depth) -------------------------- */
  function poolDepth(shallow, deep) {
    shallow = shallow || 3; deep = deep || 6;
    const maxD = 9; const sY = 40 + (shallow / maxD) * 110; const dY = 40 + (deep / maxD) * 110;
    return wrap("0 0 320 200", `${DEFS}
      <rect width="320" height="40" fill="url(#g-sky)"/>
      <path d="M20 ${sY} H140 L300 ${dY} V180 H20 Z" fill="url(#g-water)"/>
      <path d="M20 ${sY} H140 L300 ${dY}" fill="none" stroke="#ffffff" stroke-opacity=".5" stroke-width="2"/>
      <g stroke="#0e7da8" stroke-width="1.4" stroke-dasharray="4 4"><line x1="60" y1="${sY}" x2="60" y2="180"/><line x1="270" y1="${dY}" x2="270" y2="180"/></g>
      <text x="60" y="${(sY + 180) / 2}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${shallow}'</text>
      <text x="270" y="${(dY + 180) / 2}" font-size="12" font-weight="700" fill="#fff" text-anchor="middle">${deep}'</text>
      <text x="80" y="32" font-size="11" fill="#0b6e99" font-weight="600">shallow</text>
      <text x="248" y="32" font-size="11" fill="#0b6e99" font-weight="600">deep</text>`);
  }

  /* --------------- FC / CYA relationship -------------------------------- */
  function fcCyaChart(markCya) {
    const rows = [
      { cya: 30, min: 2, tgt: 6, slam: 12 },
      { cya: 50, min: 4, tgt: 8, slam: 20 },
      { cya: 70, min: 5, tgt: 10, slam: 28 },
      { cya: 90, min: 7, tgt: 12, slam: 35 },
    ];
    const W = 440, H = 270, padL = 46, padR = 14, padB = 38, padT = 46;
    const plotH = H - padB - padT, plotW = W - padL - padR, maxFC = 44, bw = plotW / rows.length;
    const yb = padT + plotH;
    // legend strip across the top (no overlap with bars)
    const leg = (x, c, t) => `<rect x="${x}" y="14" width="11" height="11" rx="2.5" fill="${c}"/><text x="${x + 16}" y="23.5" font-size="10.5" font-weight="700" fill="${T.mut}">${t}</text>`;
    let bars = "";
    rows.forEach((r, i) => {
      const x = padL + i * bw + bw * 0.18, bwi = bw * 0.64;
      const h = (v) => (v / maxFC) * plotH;
      const hot = markCya != null && Math.abs(r.cya - markCya) <= 10;
      bars += `${hot ? `<rect x="${x - 6}" y="${yb - h(r.slam) - 9}" width="${bwi + 12}" height="${h(r.slam) + 9}" rx="6" fill="#15aabf" fill-opacity=".16"/>` : ""}
        <rect x="${x}" y="${yb - h(r.slam)}" width="${bwi}" height="${h(r.slam)}" rx="3" fill="#ffd8cc"/>
        <rect x="${x}" y="${yb - h(r.tgt)}" width="${bwi}" height="${h(r.tgt)}" rx="3" fill="url(#g-good)"/>
        <rect x="${x}" y="${yb - h(r.min)}" width="${bwi}" height="${h(r.min)}" rx="3" fill="#0e7da8"/>
        <text x="${x + bwi / 2}" y="${yb + 16}" font-size="11" text-anchor="middle" fill="${hot ? "#0e7da8" : T.mut}" font-weight="${hot ? 800 : 700}">${r.cya}</text>
        <text x="${x + bwi / 2}" y="${yb - h(r.slam) - 5}" font-size="10" text-anchor="middle" fill="#e8590c" font-weight="800">${r.slam}</text>`;
    });
    return wrap(`0 0 ${W} ${H}`, `${DEFS}
      ${leg(padL, "#0e7da8", "min FC")}${leg(padL + 96, "#20c997", "target FC")}${leg(padL + 206, "#ffd8cc", "SLAM FC")}
      <text x="${padL}" y="${padT - 6}" font-size="11" fill="${T.mut}" font-weight="700">FC (ppm)</text>
      <line x1="${padL}" y1="${padT}" x2="${padL}" y2="${yb}" stroke="${T.line}" stroke-width="1.5"/>
      <line x1="${padL}" y1="${yb}" x2="${W - padR}" y2="${yb}" stroke="${T.line}" stroke-width="1.5"/>
      ${bars}
      <text x="${W / 2}" y="${H - 6}" font-size="11" text-anchor="middle" fill="${T.mut}" font-weight="700">CYA / stabilizer (ppm) →</text>`);
  }

  /* --------------- "chlorine + CYA = sunscreen" ------------------------- */
  function sunscreen() {
    return wrap("0 0 440 220", `${DEFS}
      <circle cx="60" cy="48" r="26" fill="url(#g-sun)"/>
      <g stroke="#f59f00" stroke-width="3" stroke-linecap="round"><path d="M60 8v10M60 78v6M20 48h10M94 48h-6M30 18l7 7M84 71l-7-7M90 18l-7 7M37 71l-7-7"/></g>
      <g stroke="#f59f00" stroke-width="2.4" stroke-dasharray="3 6" stroke-linecap="round" opacity=".7"><path d="M78 66 L150 150"/><path d="M92 56 L210 150"/><path d="M104 70 L270 150"/></g>
      <path d="M120 120 q100 -34 210 0 q-8 34 -105 44 q-97 -10 -105 -44Z" fill="#b197fc" opacity=".35"/>
      <path d="M120 120 q100 -34 210 0" fill="none" stroke="#845ef7" stroke-width="2.4"/>
      <text x="225" y="116" text-anchor="middle" font-size="13" font-weight="800" fill="#6741d9">CYA = sunscreen</text>
      <rect x="110" y="150" width="290" height="56" rx="12" fill="url(#g-water)"/>
      <g fill="#eafbff"><circle cx="150" cy="178" r="6"/><circle cx="200" cy="184" r="5"/><circle cx="250" cy="176" r="6"/><circle cx="300" cy="184" r="5"/><circle cx="350" cy="178" r="6"/></g>
      <text x="255" y="182" text-anchor="middle" font-size="11" font-weight="700" fill="#063a4f">free chlorine, protected from the sun</text>`);
  }

  /* --------------- HOCl vs OCl- across pH ------------------------------- */
  function hoclPh() {
    const W = 420, H = 210, pL = 40, pB = 34, ph0 = 6.5, ph1 = 8.5;
    const x = (p) => pL + ((p - ph0) / (ph1 - ph0)) * (W - pL - 12);
    const hocl = (p) => 1 / (1 + Math.pow(10, (p - 7.54)));
    let path = "";
    for (let p = ph0; p <= ph1; p += 0.05) { const yy = (H - pB) - hocl(p) * (H - pB - 14); path += (p === ph0 ? `M` : `L`) + x(p) + ` ${yy} `; }
    return wrap(`0 0 ${W} ${H}`, `${DEFS}
      <line x1="${pL}" y1="${H - pB}" x2="${W - 8}" y2="${H - pB}" stroke="${T.line}" stroke-width="1.5"/>
      <line x1="${pL}" y1="14" x2="${pL}" y2="${H - pB}" stroke="${T.line}" stroke-width="1.5"/>
      <rect x="${x(7.4)}" y="14" width="${x(7.8) - x(7.4)}" height="${H - pB - 14}" fill="#12b88622"/>
      <path d="${path}" fill="none" stroke="url(#g-water2)" stroke-width="3"/>
      <text x="${x(7.6)}" y="26" text-anchor="middle" font-size="10" font-weight="800" fill="#12b886">ideal pH</text>
      <text x="${pL - 6}" y="20" text-anchor="end" font-size="10" fill="${T.mut}" font-weight="700">% HOCl</text>
      <g font-size="10" fill="${T.mut}" font-weight="700">
        <text x="${x(6.5)}" y="${H - 12}" text-anchor="middle">6.5</text>
        <text x="${x(7.5)}" y="${H - 12}" text-anchor="middle">7.5</text>
        <text x="${x(8.5)}" y="${H - 12}" text-anchor="middle">8.5</text>
        <text x="${W / 2}" y="${H - 1}" text-anchor="middle">pH →</text></g>
      <text x="${x(6.8)}" y="60" font-size="10" fill="#0e7da8" font-weight="700">strong killer ↑</text>`);
  }

  /* --------------------------- SLAM flow -------------------------------- */
  function slamFlow() {
    const box = (x, y, w, t, fill, tc) => `<rect x="${x}" y="${y}" width="${w}" height="44" rx="10" fill="${fill}"/><text x="${x + w / 2}" y="${y + 27}" text-anchor="middle" font-size="11.5" font-weight="700" fill="${tc || "#063a4f"}">${t}</text>`;
    const arrow = (x1, y1, x2, y2) => `<path d="M${x1} ${y1} L${x2} ${y2}" stroke="#9ec5d6" stroke-width="2.4" marker-end="url(#ah)"/>`;
    return wrap("0 0 460 300", `${DEFS}
      <marker id="ah" markerWidth="8" markerHeight="8" refX="6" refY="3.2" orient="auto"><path d="M0 0L7 3.2L0 6.4Z" fill="#9ec5d6"/></marker>
      ${box(20, 16, 180, "Algae? FC won't hold?", "#fff4e2")}
      ${arrow(110, 60, 110, 84)}
      ${box(20, 84, 180, "Lower CYA if &gt; ~60", "#e7f5ff")}
      ${arrow(110, 128, 110, 152)}
      ${box(20, 152, 180, "Raise FC to SLAM level", "#d3f9d8", "#0b6e99")}
      ${arrow(200, 174, 236, 174)}
      ${box(248, 152, 190, "Brush • Filter 24/7 • Re-test", "#e7f5ff")}
      ${arrow(343, 196, 343, 220)}
      ${box(248, 220, 190, "All 3 exit tests pass?", "#fff4e2")}
      ${arrow(248, 242, 220, 242)}
      ${box(20, 220, 200, "Done → maintain target FC", "url(#g-good)", "#fff")}
      <path d="M438 242 q14 0 14 -20 V186" fill="none" stroke="#9ec5d6" stroke-width="2.4" stroke-dasharray="4 4" marker-end="url(#ah)"/>
      <text x="450" y="206" font-size="9" fill="${T.mut}" transform="rotate(90 450 206)">if no, keep going</text>`);
  }

  /* --------------------------- 3 exit criteria ------------------------- */
  function exitCriteria() {
    const b = (x, big, small, ic) => `<g transform="translate(${x} 0)">
      <rect x="0" y="0" width="128" height="120" rx="16" fill="${T.surf}" stroke="${T.line}"/>
      <circle cx="64" cy="40" r="22" fill="#12b88622"/>
      <g transform="translate(50 26)" color="#12b886">${ic}</g>
      <text x="64" y="84" text-anchor="middle" font-size="13" font-weight="800" fill="${T.ink}">${big}</text>
      <text x="64" y="103" text-anchor="middle" font-size="10.5" fill="${T.mut}">${small}</text></g>`;
    return wrap("0 0 420 120", `${b(0, "CC ≤ 0.5", "combined chlorine", ICONS.beaker)}${b(146, "FC loss &lt; 1", "overnight test", ICONS.clock)}${b(292, "Water clear", "see the bottom", ICONS.droplet)}`);
  }

  /* --------------------------- CYA dilution staircase ------------------ */
  function cyaStaircase(start, frac, target) {
    start = start || 100; frac = frac || 0.2; target = target || 40;
    const W = 420, H = 210, pL = 40, pB = 30, steps = 6;
    const maxV = start * 1.05, y = (v) => (H - pB) - (v / maxV) * (H - pB - 20);
    let bars = "", v = start; const bw = (W - pL - 12) / (steps + 1);
    for (let i = 0; i <= steps; i++) {
      const x = pL + i * bw + bw * 0.12, hw = bw * 0.7, good = v <= target;
      bars += `<rect x="${x}" y="${y(v)}" width="${hw}" height="${(H - pB) - y(v)}" rx="3" fill="${good ? "#20c997" : "#15aabf"}"/>
        <text x="${x + hw / 2}" y="${y(v) - 5}" text-anchor="middle" font-size="10" font-weight="800" fill="${good ? "#12b886" : "#0e7da8"}">${Math.round(v)}</text>
        <text x="${x + hw / 2}" y="${H - 12}" text-anchor="middle" font-size="10" fill="${T.mut}" font-weight="600">${i === 0 ? "now" : i}</text>`;
      v = v * (1 - frac);
    }
    const ty = y(target);
    return wrap(`0 0 ${W} ${H}`, `${DEFS}
      <line x1="${pL}" y1="${ty}" x2="${W - 8}" y2="${ty}" stroke="#12b886" stroke-width="1.6" stroke-dasharray="5 4"/>
      <text x="${W - 10}" y="${ty - 5}" text-anchor="end" font-size="10" font-weight="800" fill="#12b886">target ${target}</text>
      <line x1="${pL}" y1="20" x2="${pL}" y2="${H - pB}" stroke="${T.line}" stroke-width="1.5"/>
      <line x1="${pL}" y1="${H - pB}" x2="${W - 8}" y2="${H - pB}" stroke="${T.line}" stroke-width="1.5"/>
      ${bars}
      <text x="${pL}" y="14" font-size="10" fill="${T.mut}" font-weight="700">CYA (ppm)</text>
      <text x="${W / 2}" y="${H - 1}" text-anchor="middle" font-size="10" fill="${T.mut}" font-weight="700">drain &amp; refill cycles →</text>`);
  }

  /* --------------------------- CSI balance scale ----------------------- */
  function csiScale(val) {
    val = (val == null ? 0 : val);
    const W = 420, H = 120, cx = W / 2, clamp = Math.max(-1, Math.min(1, val / 0.6));
    const px = cx + clamp * 150;
    return wrap(`0 0 ${W} ${H}`, `${DEFS}
      <rect x="40" y="50" width="${(W - 80) / 2}" height="16" fill="#ffd8a8"/>
      <rect x="${cx - 50}" y="50" width="100" height="16" fill="#b2f2bb"/>
      <rect x="${cx + 50}" y="50" width="${(W - 80) / 2 - 50}" height="16" fill="#bac8ff"/>
      <text x="80" y="40" font-size="11" font-weight="800" fill="#e8590c" text-anchor="middle">CORROSIVE</text>
      <text x="${cx}" y="40" font-size="11" font-weight="800" fill="#12b886" text-anchor="middle">BALANCED</text>
      <text x="${W - 80}" y="40" font-size="11" font-weight="800" fill="#4263eb" text-anchor="middle">SCALING</text>
      <text x="80" y="86" font-size="9" fill="${T.mut}" text-anchor="middle">etches plaster</text>
      <text x="${cx}" y="86" font-size="9" fill="${T.mut}" text-anchor="middle">−0.3 to +0.3</text>
      <text x="${W - 80}" y="86" font-size="9" fill="${T.mut}" text-anchor="middle">cloudy / deposits</text>
      <g transform="translate(${px} 0)"><path d="M0 30 L8 46 L-8 46 Z" fill="${T.ink}"/><circle cx="0" cy="58" r="5" fill="${T.ink}"/></g>`);
  }

  /* --------------------------- dosing flow ------------------------------ */
  function dosingFlow() {
    const step = (x, t, ic) => `<g transform="translate(${x} 0)"><circle cx="34" cy="34" r="30" fill="#e7f5ff"/><g transform="translate(22 22)" color="#0e7da8">${ic}</g><text x="34" y="86" text-anchor="middle" font-size="10.5" font-weight="700" fill="${T.ink}">${t}</text></g>`;
    const ar = (x) => `<path d="M${x} 34 H${x + 24}" stroke="#9ec5d6" stroke-width="2.4" marker-end="url(#ah2)"/>`;
    return wrap("0 0 470 100", `${DEFS}
      <marker id="ah2" markerWidth="8" markerHeight="8" refX="6" refY="3.2" orient="auto"><path d="M0 0L7 3.2L0 6.4Z" fill="#9ec5d6"/></marker>
      ${step(0, "Test", "<svg width='24' height='24'>" + ICONS.beaker + "</svg>")}
      ${ar(70)} ${step(96, "Calculate", "<svg width='24' height='24'>" + ICONS.calc + "</svg>")}
      ${ar(166)} ${step(192, "Add at return", "<svg width='24' height='24'>" + ICONS.droplet + "</svg>")}
      ${ar(262)} ${step(288, "Circulate", "<svg width='24' height='24'>" + ICONS.clock + "</svg>")}
      ${ar(358)} ${step(384, "Re-test", "<svg width='24' height='24'>" + ICONS.check + "</svg>")}`);
  }

  /* --------------------------- filter types ----------------------------- */
  function filterTypes() {
    const tank = (x, label, inner) => `<g transform="translate(${x} 0)">
      <rect x="6" y="20" width="92" height="120" rx="22" fill="${T.coping}"/>
      <rect x="14" y="30" width="76" height="100" rx="16" fill="url(#g-water)"/>${inner}
      <rect x="40" y="8" width="24" height="16" rx="4" fill="#9ec5d6"/>
      <text x="52" y="158" text-anchor="middle" font-size="12" font-weight="800" fill="${T.ink}">${label}</text></g>`;
    const sand = `<g fill="#ffe8a3">${[18, 34, 50, 66, 28, 44, 60, 76, 22, 40, 58, 70, 30, 52, 68, 36, 48, 64, 24, 56].map((cx, i) => `<circle cx="${cx}" cy="${72 + (i % 5) * 11}" r="2.4"/>`).join("")}</g>`;
    const cart = `<g stroke="#fff" stroke-width="3" opacity=".7">${[0, 1, 2, 3, 4, 5, 6].map((i) => `<path d="M${22 + i * 9} 36 v88"/>`).join("")}</g>`;
    const de = `<g fill="#fff" opacity=".75">${[0, 1, 2, 3, 4].map((i) => `<rect x="${22 + i * 13}" y="40" width="7" height="84" rx="3"/>`).join("")}</g>`;
    return wrap("0 0 360 170", `${DEFS}${tank(0, "Sand", sand)}${tank(120, "Cartridge", cart)}${tank(240, "D.E.", de)}`);
  }

  /* --------------------------- balance wheel ---------------------------- */
  function balanceWheel() {
    const items = [["CYA", "#845ef7"], ["FC", "#15aabf"], ["pH", "#f08c00"], ["TA", "#4263eb"], ["CH", "#868e96"], ["CSI", "#12b886"]];
    const cx = 130, cy = 130, R = 92;
    let nodes = "", ring = "";
    items.forEach((it, i) => {
      const ang = (-90 + i * 60) * Math.PI / 180, x = cx + Math.cos(ang) * R, y = cy + Math.sin(ang) * R;
      nodes += `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="${T.line}" stroke-width="2"/><circle cx="${x}" cy="${y}" r="26" fill="${it[1]}"/><text x="${x}" y="${y + 4}" text-anchor="middle" font-size="12" font-weight="800" fill="#fff">${it[0]}</text>`;
      const a2 = (-90 + (i + 1) * 60) * Math.PI / 180;
      ring += `<line x1="${cx + Math.cos(ang) * R}" y1="${cy + Math.sin(ang) * R}" x2="${cx + Math.cos(a2) * R}" y2="${cy + Math.sin(a2) * R}" stroke="${T.line}" stroke-width="2"/>`;
    });
    return wrap("0 0 260 260", `${DEFS}${ring}${nodes}
      <circle cx="${cx}" cy="${cy}" r="34" fill="url(#g-water2)"/>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">balanced</text>
      <text x="${cx}" y="${cy + 12}" text-anchor="middle" font-size="9" fill="#eafbff">water</text>`);
  }

  /* --------------------------- drain / refill --------------------------- */
  function drainRefill() {
    return wrap("0 0 420 200", `${DEFS}
      <rect x="30" y="70" width="160" height="110" rx="12" fill="${T.coping}"/>
      <rect x="38" y="110" width="144" height="62" rx="8" fill="url(#g-water)"/>
      <text x="110" y="146" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">drain old water</text>
      <text x="110" y="60" text-anchor="middle" font-size="11" font-weight="700" fill="#0e7da8">high CYA / hardness ↓</text>
      <path d="M198 120 H236" stroke="#9ec5d6" stroke-width="3" marker-end="url(#ah3)"/>
      <marker id="ah3" markerWidth="9" markerHeight="9" refX="6" refY="3.5" orient="auto"><path d="M0 0L7 3.5L0 7Z" fill="#9ec5d6"/></marker>
      <rect x="244" y="70" width="160" height="110" rx="12" fill="${T.coping}"/>
      <rect x="252" y="86" width="144" height="86" rx="8" fill="url(#g-water)"/>
      <text x="324" y="132" text-anchor="middle" font-size="11" font-weight="800" fill="#fff">refill fresh</text>
      <text x="324" y="60" text-anchor="middle" font-size="11" font-weight="700" fill="#12b886">lower CYA ✓</text>
      <g stroke="#74c0fc" stroke-width="3" stroke-linecap="round"><path d="M300 30 v40"/><path d="M324 24 v46"/><path d="M348 30 v40"/></g>`);
  }

  /* --------------------------- trichlor trap ---------------------------- */
  function trichlorTrap() {
    const W = 420, H = 200, pL = 36, pB = 30;
    const y = (v) => (H - pB) - (v / 160) * (H - pB - 16);
    const pts = [20, 38, 55, 70, 84, 96, 108, 118, 127, 135];
    let path = "M" + pL + " " + y(20) + " ";
    pts.forEach((v, i) => { path += `L${pL + i * ((W - pL - 14) / (pts.length - 1))} ${y(v)} `; });
    return wrap(`0 0 ${W} ${H}`, `${DEFS}
      <line x1="${pL}" y1="14" x2="${pL}" y2="${H - pB}" stroke="${T.line}" stroke-width="1.5"/>
      <line x1="${pL}" y1="${H - pB}" x2="${W - 8}" y2="${H - pB}" stroke="${T.line}" stroke-width="1.5"/>
      <rect x="${pL}" y="14" width="${W - pL - 8}" height="${y(50) - 14}" fill="#fa525222"/>
      <line x1="${pL}" y1="${y(50)}" x2="${W - 8}" y2="${y(50)}" stroke="#fa5252" stroke-width="1.4" stroke-dasharray="5 4"/>
      <text x="${W - 10}" y="${y(50) - 5}" text-anchor="end" font-size="10" font-weight="800" fill="#e03131">trouble zone</text>
      <path d="${path}" fill="none" stroke="#e8590c" stroke-width="3"/>
      <g fill="#e8590c">${pts.map((v, i) => `<circle cx="${pL + i * ((W - pL - 14) / (pts.length - 1))}" cy="${y(v)}" r="3"/>`).join("")}</g>
      <text x="${pL}" y="10" font-size="10" fill="${T.mut}" font-weight="700">CYA (ppm)</text>
      <text x="${W / 2}" y="${H - 2}" text-anchor="middle" font-size="10" fill="${T.mut}" font-weight="700">months on trichlor tablets →</text>`);
  }

  /* --------------------------- AZ sun ----------------------------------- */
  function desertSun() {
    return wrap("0 0 300 180", `${DEFS}
      <rect width="300" height="180" rx="16" fill="url(#g-sky)"/>
      <circle cx="150" cy="56" r="34" fill="url(#g-sun)"/>
      <g stroke="#f59f00" stroke-width="4" stroke-linecap="round"><path d="M150 4v16M150 92v8M86 56h16M198 56h16M104 10l11 11M185 91l11 11M196 10l-11 11M115 91l-11 11"/></g>
      <path d="M0 130 q40 -22 80 0 t80 0 t80 0 t60 0 V180 H0Z" fill="url(#g-water)"/>
      <g fill="#fff" opacity=".5"><circle cx="60" cy="150" r="4"/><circle cx="140" cy="156" r="3"/><circle cx="220" cy="150" r="4"/></g>
      <text x="150" y="120" text-anchor="middle" font-size="11" font-weight="800" fill="#0b6e99">high UV burns chlorine fast</text>`);
  }

  /* --------------------------- radial gauge ----------------------------- */
  function radialGauge(pct, color, label, value) {
    pct = Math.max(0, Math.min(1, pct || 0));
    const r = 52, c = 2 * Math.PI * r;
    color = color || "#15aabf";
    return wrap("0 0 140 140", `
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="${T.line}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${c * 0.75} ${c}" transform="rotate(135 70 70)"/>
      <circle cx="70" cy="70" r="${r}" fill="none" stroke="${color}" stroke-width="13" stroke-linecap="round" stroke-dasharray="${c * 0.75 * pct} ${c}" transform="rotate(135 70 70)"/>
      <text x="70" y="68" text-anchor="middle" font-size="26" font-weight="800" fill="${T.ink}">${value != null ? value : Math.round(pct * 100)}</text>
      <text x="70" y="88" text-anchor="middle" font-size="11" font-weight="600" fill="${T.mut}">${label || ""}</text>`);
  }

  /* --------------------------- WATER-FILL ORB (health) ------------------ */
  // A pool-shaped orb that fills with water to the health percentage — a more
  // on-theme alternative to the ring gauge.
  function waterOrb(pct, color, value, label) {
    pct = Math.max(0, Math.min(1, pct || 0));
    color = color || "#15aabf";
    const R = 58, cx = 70, cy = 70;
    const level = cy + R - pct * (R * 2); // y of the water surface
    const id = "orb" + Math.round(pct * 997 % 9999);
    // wave path across the orb at the water level
    const wave = `M${cx - R} ${level} q ${R / 2} -10 ${R} 0 t ${R} 0 V${cy + R} H${cx - R} Z`;
    return wrap("0 0 140 150", `${DEFS}
      <defs><clipPath id="${id}"><circle cx="${cx}" cy="${cy}" r="${R}"/></clipPath>
      <linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}"/><stop offset="1" stop-color="${color}" stop-opacity=".7"/></linearGradient></defs>
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="${T.grid}" stroke="${T.line}" stroke-width="2"/>
      <g clip-path="url(#${id})">
        <path d="${wave}" fill="url(#${id}f)"/>
        <path d="M${cx - R} ${level + 6} q ${R / 2} 8 ${R} 0 t ${R} 0 V${cy + R} H${cx - R} Z" fill="${color}" opacity=".35"/>
      </g>
      <circle cx="${cx}" cy="${cy}" r="${R}" fill="none" stroke="${T.line}" stroke-width="2"/>
      <text x="${cx}" y="${cy + 2}" text-anchor="middle" font-size="30" font-weight="800" class="orb-val" fill="${pct > 0.5 ? "#fff" : T.ink}">${value != null ? value : Math.round(pct * 100)}</text>
      <text x="${cx}" y="${cy + 22}" text-anchor="middle" font-size="11" font-weight="700" fill="${pct > 0.55 ? "#eafbff" : T.mut}">${label || ""}</text>`);
  }

  /* --------------------------- wave divider ----------------------------- */
  function waveDivider(flip) {
    return wrap("0 0 1200 48", `<path d="M0 24 C 150 48 300 0 450 20 S 750 48 900 24 1050 4 1200 22 L1200 48 L0 48 Z" fill="${T.grid}" opacity=".7"/>
      <path d="M0 28 C 200 50 350 6 520 26 S 820 46 1000 26 1140 12 1200 26" fill="none" stroke="${T.line}" stroke-width="2" opacity=".8"/>`,
      flip ? 'style="transform:scaleY(-1)"' : "");
  }

  /* --------------------------- hero scene ------------------------------- */
  // A distinctive, custom desert-pool vignette for the dashboard hero corner.
  function heroScene() {
    return wrap("0 0 360 280", `${DEFS}
      <circle cx="300" cy="58" r="30" fill="url(#g-sun)" opacity=".95"/>
      <g stroke="#ffe066" stroke-width="3.4" stroke-linecap="round" opacity=".85"><path d="M300 14v12M300 90v8M256 58h12M332 58h8M270 28l8 8M322 80l8 8M330 28l-8 8M278 80l-8 8"/></g>
      <!-- palm -->
      <path d="M70 250 C66 200 60 170 58 150" stroke="#2b8a6b" stroke-width="7" fill="none" stroke-linecap="round"/>
      <g fill="#20c997"><path d="M58 150 C40 130 18 128 6 138 30 138 44 146 58 152Z"/><path d="M58 150 C72 126 94 120 110 128 86 130 72 140 58 152Z"/><path d="M58 150 C44 124 40 100 48 88 56 108 58 128 58 150Z"/><path d="M58 150 C76 134 100 132 112 144 88 142 72 146 58 152Z"/></g>
      <!-- pool -->
      <path d="M40 250 Q180 210 340 250 L340 280 L40 280 Z" fill="url(#g-water)"/>
      <path d="M40 250 Q180 210 340 250" fill="none" stroke="#9ce0ee" stroke-width="2" opacity=".6"/>
      <g stroke="#eafbff" stroke-opacity=".55" stroke-width="2.4" fill="none" stroke-linecap="round"><path d="M90 262 q16 -6 32 0t32 0"/><path d="M210 268 q16 -6 32 0t32 0"/></g>
      <!-- floating ring -->
      <g transform="translate(250 244)"><ellipse cx="0" cy="0" rx="26" ry="11" fill="#ff8787"/><ellipse cx="0" cy="-1" rx="12" ry="5" fill="url(#g-water)"/><path d="M-26 0a26 11 0 0 1 52 0" fill="none" stroke="#fff" stroke-width="3" opacity=".5"/></g>
      <!-- sun glint on water -->
      <path d="M300 250 q6 -16 12 0 q-6 12 -12 0Z" fill="#ffe066" opacity=".5"/>`);
  }

  /* --------------------------- empty / success -------------------------- */
  function emptyState() {
    return wrap("0 0 220 160", `${DEFS}
      <ellipse cx="110" cy="140" rx="70" ry="10" fill="${T.grid}"/>
      <rect x="40" y="40" width="140" height="90" rx="14" fill="${T.deck}"/>
      <rect x="48" y="48" width="124" height="74" rx="9" fill="url(#g-water)"/>
      <g stroke="#fff" stroke-opacity=".5" stroke-width="3" fill="none" stroke-linecap="round"><path d="M64 78q14-7 28 0t28 0"/><path d="M64 98q14-7 28 0t28 0"/></g>
      <circle cx="150" cy="44" r="20" fill="${T.surf}"/><g transform="translate(140 34)" color="#15aabf"><svg width="20" height="20">${ICONS.plus}</svg></g>`);
  }
  function celebrate() {
    return wrap("0 0 200 140", `${DEFS}
      <circle cx="100" cy="70" r="44" fill="#12b88622"/>
      <g transform="translate(78 48)" color="#12b886"><svg width="44" height="44">${ICONS.check}</svg></g>
      <g><rect x="30" y="24" width="8" height="8" rx="2" fill="#ffd43b" transform="rotate(20 34 28)"/>
      <rect x="160" y="30" width="8" height="8" rx="2" fill="#22b8cf" transform="rotate(-15 164 34)"/>
      <circle cx="44" cy="96" r="4" fill="#fa5252"/><circle cx="158" cy="92" r="4" fill="#845ef7"/>
      <rect x="150" y="110" width="7" height="7" rx="2" fill="#20c997"/></g>`);
  }

  global.SVG = {
    brand, icon, chem, poolShape, poolDimDiagram, poolDepth, fcCyaChart, sunscreen, hoclPh,
    slamFlow, exitCriteria, cyaStaircase, csiScale, dosingFlow, filterTypes,
    balanceWheel, drainRefill, trichlorTrap, desertSun, radialGauge, waterOrb,
    waveDivider, heroScene, emptyState, celebrate, ICONS,
  };
})(window);
