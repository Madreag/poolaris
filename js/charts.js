/* ============================================================================
   POOLARIS — tiny SVG charting engine (no dependencies)
   Used by the Log/Trends view to draw historical parameter trends with an
   ideal "target band" overlay so the user sees at a glance whether a reading
   is drifting out of range.
   ========================================================================== */
(function (global) {
  "use strict";

  const NS = "http://www.w3.org/2000/svg";

  function fmtDate(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + "/" + d.getDate();
  }

  /* niceNum for axis ticks */
  function niceMax(v) {
    if (v <= 0) return 1;
    const exp = Math.floor(Math.log10(v));
    const f = v / Math.pow(10, exp);
    const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
    return nf * Math.pow(10, exp);
  }
  /* nearest "nice" tick step (1,2,2.5,5,10 ×10ⁿ) for an adaptive, non-zero axis */
  function niceStep(v) {
    if (v <= 0) return 1;
    const e = Math.floor(Math.log10(v)), f = v / Math.pow(10, e);
    const nf = f < 1.5 ? 1 : f < 3 ? 2 : f < 4 ? 2.5 : f < 7 ? 5 : 10;
    return nf * Math.pow(10, e);
  }

  /**
   * trend(): single-series line chart with optional target band.
   * cfg = {
   *   points: [{t:timestamp, v:number|null}],
   *   band: {min, max, ideal} | null,   // shaded ideal zone
   *   color, unit, height, yMaxOverride
   * }
   */
  function trend(cfg) {
    const pts = (cfg.points || []).filter((p) => p && p.v != null && !isNaN(p.v));
    const W = 600, H = cfg.height || 220, pL = 40, pR = 14, pT = 16, pB = 30;
    const color = cfg.color || "#15aabf";
    if (pts.length === 0) {
      return `<svg viewBox="0 0 ${W} ${H}" xmlns="${NS}"><text x="${W/2}" y="${H/2}" text-anchor="middle" fill="var(--svg-muted)" font-size="14" font-family="Segoe UI,Arial">No readings logged yet</text></svg>`;
    }
    const vals = pts.map((p) => p.v);
    let dataMax = Math.max.apply(null, vals.concat(cfg.band ? [cfg.band.max] : []));
    let dataMin = Math.min.apply(null, vals.concat(cfg.band ? [cfg.band.min] : []));
    const dataRange = (dataMax - dataMin) || Math.abs(dataMax) || 1;
    // Adaptive y-axis with nice tick steps. We deliberately do NOT anchor to zero —
    // pinning pH/TA/CH to 0 crushes their small drifts into a flat line and hides
    // exactly the creep this view exists to surface. Pad the data range instead.
    const step = niceStep(dataRange / 3.2);
    let yMin = cfg.yMinOverride != null ? cfg.yMinOverride : Math.max(0, Math.floor((dataMin - dataRange * 0.18) / step) * step);
    let yMax = cfg.yMaxOverride || Math.ceil((dataMax + dataRange * 0.18) / step) * step;
    if (yMax - yMin < step) yMax = yMin + step;

    const t0 = pts[0].t, t1 = pts[pts.length - 1].t;
    const span = Math.max(1, t1 - t0);
    const x = (t) => pL + ((t - t0) / span) * (W - pL - pR);
    const y = (v) => pT + (1 - (v - yMin) / (yMax - yMin)) * (H - pT - pB);

    // grid + y labels (ticks land on the nice step)
    let grid = "";
    const ticks = Math.max(2, Math.min(6, Math.round((yMax - yMin) / step)));
    for (let i = 0; i <= ticks; i++) {
      const v = yMin + ((yMax - yMin) / ticks) * i;
      const yy = y(v);
      const lab = Math.abs(v) >= 100 ? Math.round(v) : Math.round(v * 10) / 10;
      grid += `<line x1="${pL}" y1="${yy}" x2="${W - pR}" y2="${yy}" stroke="var(--svg-grid)" stroke-width="1"/>
               <text x="${pL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="var(--svg-muted)">${lab}</text>`;
    }

    // target band
    let band = "";
    if (cfg.band) {
      const yb1 = y(cfg.band.max), yb2 = y(cfg.band.min);
      band = `<rect x="${pL}" y="${yb1}" width="${W - pL - pR}" height="${Math.max(2, yb2 - yb1)}" fill="rgba(32,201,151,.15)"/>
              <line x1="${pL}" y1="${yb1}" x2="${W - pR}" y2="${yb1}" stroke="#20c997" stroke-width="1" stroke-dasharray="4 3"/>
              <line x1="${pL}" y1="${yb2}" x2="${W - pR}" y2="${yb2}" stroke="#20c997" stroke-width="1" stroke-dasharray="4 3"/>
              <text x="${W - pR}" y="${yb1 - 4}" text-anchor="end" font-size="9.5" fill="#12b886" font-weight="700">ideal</text>`;
    }

    // area + line
    let d = "", area = "";
    pts.forEach((p, i) => {
      const cx = x(p.t), cy = y(p.v);
      d += (i === 0 ? "M" : "L") + cx.toFixed(1) + " " + cy.toFixed(1) + " ";
    });
    area = `M${x(pts[0].t).toFixed(1)} ${y(yMin).toFixed(1)} ` +
      pts.map((p) => "L" + x(p.t).toFixed(1) + " " + y(p.v).toFixed(1)).join(" ") +
      ` L${x(pts[pts.length - 1].t).toFixed(1)} ${y(yMin).toFixed(1)} Z`;

    // dots colored by in/out of band
    let dots = "";
    pts.forEach((p) => {
      let dc = color;
      if (cfg.band) {
        if (p.v < cfg.band.min) dc = "#e8590c";
        else if (p.v > cfg.band.max) dc = "#f08c00";
        else dc = "#12b886";
      }
      dots += `<circle cx="${x(p.t).toFixed(1)}" cy="${y(p.v).toFixed(1)}" r="4" fill="var(--svg-surface)" stroke="${dc}" stroke-width="2.4"/>`;
    });

    // x labels (first, middle, last)
    let xl = "";
    const idxs = pts.length <= 4 ? pts.map((_, i) => i) : [0, Math.floor(pts.length / 2), pts.length - 1];
    idxs.forEach((i) => {
      xl += `<text x="${x(pts[i].t).toFixed(1)}" y="${H - 8}" text-anchor="middle" font-size="10" fill="var(--svg-muted)">${fmtDate(pts[i].t)}</text>`;
    });

    const gid = "ga" + Math.floor(cfg.points.length * 97 % 9999);
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="${NS}" font-family="Segoe UI,Arial">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/>
      </linearGradient></defs>
      ${grid}${band}
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${dots}${xl}
    </svg>`;
  }

  /* sparkline — compact inline trend for cards */
  function spark(values, color, w, h) {
    values = (values || []).filter((v) => v != null && !isNaN(v));
    w = w || 120; h = h || 32;
    if (values.length < 2) return `<svg viewBox="0 0 ${w} ${h}" xmlns="${NS}"></svg>`;
    const mn = Math.min.apply(null, values), mx = Math.max.apply(null, values);
    const span = (mx - mn) || 1;
    const x = (i) => (i / (values.length - 1)) * (w - 4) + 2;
    const y = (v) => h - 3 - ((v - mn) / span) * (h - 6);
    let d = "";
    values.forEach((v, i) => { d += (i === 0 ? "M" : "L") + x(i).toFixed(1) + " " + y(v).toFixed(1) + " "; });
    return `<svg viewBox="0 0 ${w} ${h}" xmlns="${NS}"><path d="${d}" fill="none" stroke="${color || "#15aabf"}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${x(values.length - 1).toFixed(1)}" cy="${y(values[values.length - 1]).toFixed(1)}" r="3" fill="${color || "#15aabf"}"/></svg>`;
  }

  function _badge(x, y, text, color) {
    const w = (("" + text).length) * 6.3 + 12;
    return `<g><rect x="${x - w / 2}" y="${y - 10}" width="${w}" height="19" rx="9.5" fill="var(--svg-surface)" stroke="${color}" stroke-width="1.3"/><text x="${x}" y="${y + 3.5}" text-anchor="middle" font-size="10.5" font-weight="800" fill="${color}">${text}</text></g>`;
  }

  /**
   * curve(): value-vs-value line with optional shaded bands (x or y) and a
   * marker point. Used to show how a dose / index changes across a range.
   * cfg = { points:[{x,y}], color, xLabel, yLabel, bands:[{axis,from,to,color,text,label}],
   *         marker:{x,y,label}, height, fmtX, fmtY, zeroY }
   */
  function curve(cfg) {
    const pts0 = (cfg.points || []).filter((p) => p && !isNaN(p.x) && !isNaN(p.y));
    // Never build a path from an unbounded point set — decimate so a bad/huge input can't freeze
    // the UI or overflow the stack (Math.max.apply throws "call stack exceeded" past ~100k args).
    const pts = pts0.length > 1500 ? pts0.filter((_, i) => i % Math.ceil(pts0.length / 1500) === 0) : pts0;
    const W = 560, H = cfg.height || 210, pL = 48, pR = 16, pT = 18, pB = 38;
    const color = cfg.color || "#15aabf";
    const fmtX = cfg.fmtX || ((v) => Math.round(v * 10) / 10);
    const fmtY = cfg.fmtY || ((v) => Math.round(v * 10) / 10);
    if (pts.length < 2) return `<svg viewBox="0 0 ${W} ${H}" xmlns="${NS}"><text x="${W / 2}" y="${H / 2}" text-anchor="middle" fill="var(--svg-muted)" font-size="13">enter values…</text></svg>`;
    // loop-based min/max — apply() on a large array overflows the stack
    let xmin = pts[0].x, xmax = pts[0].x, ymin = pts[0].y, ymax = pts[0].y;
    for (let i = 1; i < pts.length; i++) { const p = pts[i]; if (p.x < xmin) xmin = p.x; if (p.x > xmax) xmax = p.x; if (p.y < ymin) ymin = p.y; if (p.y > ymax) ymax = p.y; }
    (cfg.bands || []).forEach((b) => { if (b.axis === "y") { ymin = Math.min(ymin, b.from); ymax = Math.max(ymax, b.to); } });
    if (cfg.marker && cfg.marker.y != null) { ymin = Math.min(ymin, cfg.marker.y); ymax = Math.max(ymax, cfg.marker.y); }
    if (cfg.zeroY !== false) ymin = Math.min(ymin, 0);
    const span = (ymax - ymin) || 1; ymax += span * 0.12; ymin -= span * 0.04;
    const X = (x) => pL + ((x - xmin) / ((xmax - xmin) || 1)) * (W - pL - pR);
    const Y = (y) => pT + (1 - (y - ymin) / ((ymax - ymin) || 1)) * (H - pT - pB);

    let grid = "";
    for (let i = 0; i <= 4; i++) { const v = ymin + (ymax - ymin) * i / 4, yy = Y(v); grid += `<line x1="${pL}" y1="${yy}" x2="${W - pR}" y2="${yy}" stroke="var(--svg-grid)" stroke-width="1"/><text x="${pL - 6}" y="${yy + 4}" text-anchor="end" font-size="10" fill="var(--svg-muted)">${fmtY(v)}</text>`; }

    let bands = "";
    (cfg.bands || []).forEach((b) => {
      if (b.axis === "x") { const x1 = X(b.from), x2 = X(b.to); bands += `<rect x="${x1}" y="${pT}" width="${Math.max(0, x2 - x1)}" height="${H - pT - pB}" fill="${b.color || "#12b88622"}"/>`; if (b.label) bands += `<text x="${(x1 + x2) / 2}" y="${pT + 12}" text-anchor="middle" font-size="9.5" font-weight="800" fill="${b.text || "#12b886"}">${b.label}</text>`; }
      else { const y1 = Y(b.to), y2 = Y(b.from); bands += `<rect x="${pL}" y="${y1}" width="${W - pL - pR}" height="${Math.max(0, y2 - y1)}" fill="${b.color || "#12b88622"}"/>`; if (b.label) bands += `<text x="${W - pR - 3}" y="${y1 + 12}" text-anchor="end" font-size="9.5" font-weight="800" fill="${b.text || "#12b886"}">${b.label}</text>`; }
    });

    let xl = "";
    [0, 0.5, 1].forEach((f) => { const v = xmin + (xmax - xmin) * f; xl += `<text x="${X(v)}" y="${H - 14}" text-anchor="middle" font-size="10" fill="var(--svg-muted)">${fmtX(v)}</text>`; });

    let d = ""; pts.forEach((p, i) => { d += (i ? "L" : "M") + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1) + " "; });
    const gid = "cv" + Math.floor(pts.length * 53 % 9999);
    const area = `M${X(pts[0].x).toFixed(1)} ${Y(ymin).toFixed(1)} ` + pts.map((p) => "L" + X(p.x).toFixed(1) + " " + Y(p.y).toFixed(1)).join(" ") + ` L${X(pts[pts.length - 1].x).toFixed(1)} ${Y(ymin).toFixed(1)} Z`;

    let marker = "";
    if (cfg.marker && !isNaN(cfg.marker.x)) {
      const mx = X(cfg.marker.x);
      marker += `<line x1="${mx}" y1="${pT}" x2="${mx}" y2="${H - pB}" stroke="${color}" stroke-width="1.4" stroke-dasharray="4 3" opacity=".75"/>`;
      if (cfg.marker.y != null) { const my = Y(cfg.marker.y); marker += `<circle cx="${mx}" cy="${my}" r="5.5" fill="${color}" stroke="var(--svg-surface)" stroke-width="2.4"/>`; if (cfg.marker.label) marker += _badge(Math.max(pL + 24, Math.min(W - pR - 24, mx)), my - 15, cfg.marker.label, color); }
    }
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="${NS}" font-family="Segoe UI,Arial">
      <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".18"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>
      ${grid}${bands}
      <line x1="${pL}" y1="${pT}" x2="${pL}" y2="${H - pB}" stroke="var(--svg-line)" stroke-width="1.4"/>
      <line x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}" stroke="var(--svg-line)" stroke-width="1.4"/>
      <path d="${area}" fill="url(#${gid})"/>
      <path d="${d}" fill="none" stroke="${color}" stroke-width="2.6" stroke-linejoin="round" stroke-linecap="round"/>
      ${marker}${xl}
      ${cfg.yLabel ? `<text x="${pL - 30}" y="${pT - 4}" font-size="10" font-weight="700" fill="var(--svg-muted)">${cfg.yLabel}</text>` : ""}
      ${cfg.xLabel ? `<text x="${(W + pL) / 2}" y="${H - 1}" text-anchor="middle" font-size="10" font-weight="700" fill="var(--svg-muted)">${cfg.xLabel} →</text>` : ""}
    </svg>`;
  }

  /** bars(): simple labeled vertical bar chart for discrete options. */
  function bars(cfg) {
    const items = cfg.items || [];
    const W = 560, H = cfg.height || 190, pL = 40, pR = 14, pT = 20, pB = 40;
    if (!items.length) return `<svg viewBox="0 0 ${W} ${H}" xmlns="${NS}"></svg>`;
    // Never let a non-finite value (e.g. a dose computed before volume is known) reach an SVG
    // coordinate — coerce to 0 so the chart degrades gracefully instead of emitting y="NaN".
    const val = (v) => (Number.isFinite(+v) ? +v : 0);
    const max = Math.max.apply(null, items.map((i) => val(i.value))) || 1;
    const bw = (W - pL - pR) / items.length;
    const fmtV = cfg.fmtV || ((v) => Math.round(v * 10) / 10);
    let out = "";
    items.forEach((it, i) => {
      const v = val(it.value);
      const x = pL + i * bw + bw * 0.18, w = bw * 0.64, h = (v / (max * 1.12)) * (H - pT - pB), y = H - pB - h;
      const col = it.color || (i === cfg.highlight ? "#15aabf" : "#9ec5d6");
      out += `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="${col}"/>
        <text x="${x + w / 2}" y="${y - 6}" text-anchor="middle" font-size="11" font-weight="800" fill="${i === cfg.highlight ? "#0e7da8" : "var(--svg-muted)"}">${fmtV(v)}</text>
        <text x="${x + w / 2}" y="${H - pB + 16}" text-anchor="middle" font-size="10" font-weight="600" fill="var(--svg-muted)">${it.label}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" xmlns="${NS}" font-family="Segoe UI,Arial">
      <line x1="${pL}" y1="${H - pB}" x2="${W - pR}" y2="${H - pB}" stroke="var(--svg-line)" stroke-width="1.4"/>
      ${cfg.yLabel ? `<text x="${pL}" y="${pT - 6}" font-size="10" font-weight="700" fill="var(--svg-muted)">${cfg.yLabel}</text>` : ""}
      ${out}</svg>`;
  }

  global.Charts = { trend, spark, curve, bars };
})(window);
