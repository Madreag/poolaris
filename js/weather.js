/* ============================================================================
   POOLARIS — weather engine  (window.WEATHER)
   ---------------------------------------------------------------------------
   A sibling to insights.js: turns the pool's location into a live forecast and
   emits pool-care warnings as insight objects in the EXACT shape the dashboard
   already renders ({id,category,severity,title,detail,recommend,route,calc?,icon}).
   Severity vocab matches insights.js: urgent | watch | info | good.

   Source: Open-Meteo (free, no API key, CORS-enabled). Fetched directly from the
   browser, cached in its own localStorage key, and fails silently offline so the
   app behaves exactly as before when there's no network or no location.

   The chemistry engine (calc.js/insights.js/data.js) is untouched.
   ========================================================================== */
(function (global) {
  "use strict";
  const S = global.SVG;
  const LS = "poolaris.wx.v1";
  const FX_TTL = 3 * 3600 * 1000;     // refresh forecast every 3h (water changes slowly)
  const RAIN_TTL = 60 * 60 * 1000;    // tighten to hourly when rain is imminent

  /* ----------------------------- thresholds ---------------------------- */
  const WX_K = {
    rain: { popWatch: 50, inWatch: 0.25, inUrgent: 0.75, skipDoseInHrs: 12 },
    heat: { dayMaxF: 95, waveDays: 3, waterHotF: 90 },
    cold: { freezeF: 34, hardFreezeF: 28 },
    uv: { high: 8, extreme: 10, cyaFloor: 30, cyaFloorSwg: 60 },
    wind: { gustWatch: 30, gustUrgent: 45 },
  };

  /* ----------------------------- storage ------------------------------- */
  function read() { try { return JSON.parse(localStorage.getItem(LS)) || {}; } catch (e) { return {}; } }
  function write(o) { try { localStorage.setItem(LS, JSON.stringify(o)); } catch (e) {} }

  /* ----------------------------- geocode ------------------------------- */
  const STATE_ABBR = {
    az: "arizona", ca: "california", tx: "texas", fl: "florida", nv: "nevada", nm: "new mexico",
    ut: "utah", co: "colorado", ga: "georgia", nc: "north carolina", sc: "south carolina",
    or: "oregon", wa: "washington", ny: "new york", il: "illinois", oh: "ohio", pa: "pennsylvania",
    mi: "michigan", va: "virginia", tn: "tennessee", la: "louisiana", al: "alabama", ms: "mississippi",
    ok: "oklahoma", ks: "kansas", mo: "missouri", ar: "arkansas", in: "indiana", wi: "wisconsin",
    mn: "minnesota", ma: "massachusetts", ct: "connecticut", nj: "new jersey", md: "maryland",
    hi: "hawaii", id: "idaho", mt: "montana", ne: "nebraska", nd: "north dakota", sd: "south dakota",
    wy: "wyoming", ak: "alaska", me: "maine", nh: "new hampshire", vt: "vermont", ri: "rhode island",
    de: "delaware", wv: "west virginia", ky: "kentucky", ia: "iowa",
  };
  async function geocode(region) {
    if (!region) return null;
    const name = region.split(",")[0].trim();
    const st = (region.split(",")[1] || "").trim().toLowerCase();
    if (!name) return null;
    const url = "https://geocoding-api.open-meteo.com/v1/search?name=" + encodeURIComponent(name) +
      "&count=5&language=en&format=json";
    const res = await fetch(url);
    const j = await res.json();
    const list = j.results || [];
    if (!list.length) return null;
    const pick = st
      ? (list.find((x) => { const a = (x.admin1 || "").toLowerCase(); return a.startsWith(st) || STATE_ABBR[st] === a; }) || list[0])
      : list[0];
    return {
      lat: pick.latitude, lon: pick.longitude,
      name: pick.name + (pick.admin1 ? ", " + pick.admin1 : ""),
      tz: pick.timezone, resolvedFrom: region, at: Date.now(),
    };
  }

  /* ----------------------------- forecast ------------------------------ */
  async function fetchForecast(geo) {
    const url = "https://api.open-meteo.com/v1/forecast?latitude=" + geo.lat + "&longitude=" + geo.lon +
      "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index" +
      "&hourly=temperature_2m,precipitation,precipitation_probability,uv_index,wind_speed_10m,wind_gusts_10m,weather_code" +
      "&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset" +
      "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=6&past_days=1";
    const res = await fetch(url);
    if (!res.ok) throw new Error("wx " + res.status);
    return res.json();
  }

  /* ----------------------------- derive -------------------------------- */
  function derive(raw, profile) {
    const d = raw.daily, h = raw.hourly, cur = raw.current;
    if (!d || !h || !cur) return null;
    const today = (cur.time || "").slice(0, 10);
    const di = Math.max(0, d.time.indexOf(today));
    const now = new Date(cur.time);
    let hi = h.time.findIndex((t) => new Date(t) >= now);
    if (hi < 0) hi = 0;

    const win = (hrs) => {
      let amt = 0, prob = 0;
      for (let i = hi; i < Math.min(hi + hrs, h.time.length); i++) {
        amt += h.precipitation[i] || 0;
        prob = Math.max(prob, h.precipitation_probability[i] || 0);
      }
      return { in: +amt.toFixed(2), prob: prob };
    };

    const dayMean = (i) => (d.temperature_2m_max[i] + d.temperature_2m_min[i]) / 2;
    const tw = (() => {
      const lo = Math.max(0, di - 2);
      let s = 0, n = 0;
      for (let i = lo; i <= di; i++) { s += dayMean(i); n++; }
      let est = s / n - 4; // water runs a few °F under the 3-day air mean
      if (profile && profile.tempF) est = est * 0.6 + profile.tempF * 0.4; // anchor to known
      return Math.round(est);
    })();
    const waterTrend = dayMean(di) > dayMean(Math.max(0, di - 1)) ? "warming"
      : dayMean(di) < dayMean(Math.max(0, di - 1)) ? "cooling" : "steady";

    let heatDays = 0;
    for (let i = di; i < d.time.length; i++) {
      if (d.temperature_2m_max[i] >= WX_K.heat.dayMaxF) heatDays++; else break;
    }
    const nn = (v) => (v == null ? 999 : v);

    return {
      at: Date.now(), tz: raw.timezone,
      nowTempF: Math.round(cur.temperature_2m),
      feelsF: Math.round(cur.apparent_temperature),
      humidity: cur.relative_humidity_2m,
      code: cur.weather_code,
      windMph: Math.round(cur.wind_speed_10m),
      gustMph: Math.round(cur.wind_gusts_10m),
      uvNow: +(cur.uv_index || 0).toFixed(1),
      todayHiF: Math.round(d.temperature_2m_max[di]),
      todayLoF: Math.round(d.temperature_2m_min[di]),
      uvMaxToday: +(d.uv_index_max[di] || 0).toFixed(1),
      waterTempF: tw, waterTrend: waterTrend,
      rain24: win(24), rain48: win(48), rain72: win(72),
      rainTodayIn: +(d.precipitation_sum[di] || 0).toFixed(2),
      minLow72: Math.min(d.temperature_2m_min[di], nn(d.temperature_2m_min[di + 1]), nn(d.temperature_2m_min[di + 2])),
      heatDays: heatDays,
      gustMax72: Math.max(d.wind_gusts_10m_max[di] || 0, d.wind_gusts_10m_max[di + 1] || 0, d.wind_gusts_10m_max[di + 2] || 0),
      days: d.time.slice(di, di + 6).map((t, k) => ({
        date: t, code: d.weather_code[di + k],
        hiF: Math.round(d.temperature_2m_max[di + k]),
        loF: Math.round(d.temperature_2m_min[di + k]),
        pop: d.precipitation_probability_max[di + k],
        uv: +(d.uv_index_max[di + k] || 0).toFixed(1),
        sunset: d.sunset ? d.sunset[di + k] : null,
      })),
    };
  }

  /* ----------------------------- warnings ------------------------------ */
  function warnings(wx, profile, latest) {
    if (!wx) return [];
    profile = profile || {};
    const out = [];
    const swg = profile.sanitizer === "salt";
    const cya = latest && latest.cya != null ? latest.cya : 40;
    const cyaFloor = swg ? WX_K.uv.cyaFloorSwg : WX_K.uv.cyaFloor;
    const add = (o) => out.push(Object.assign({ severity: "info", category: "weather", icon: "sun" }, o, { icon: o.icon || "sun" }));

    // RAIN
    const r = wx.rain48;
    if (r.prob >= WX_K.rain.popWatch || r.in >= WX_K.rain.inWatch) {
      const heavy = r.in >= WX_K.rain.inUrgent;
      add({
        id: "wx-rain", severity: heavy ? "watch" : "info", icon: "cloud-rain",
        title: heavy ? "Heavy rain coming — protect your chlorine" : "Rain in the forecast",
        detail: `About <b>${r.in}"</b> of rain at <b>${r.prob}%</b> over the next 48h. Rain dilutes FC, CYA &amp; salt, can overflow the pool, and shifts pH/alkalinity.${heavy ? " Heavy rain also washes in organics that eat chlorine." : ""}`,
        recommend: `Top FC up toward the high end of range <b>before</b> the storm so it can't dip below minimum, lower the water a couple inches if overflow's likely, and <b>skip dosing in the ${WX_K.rain.skipDoseInHrs}h right before it hits</b>. Re-test FC, pH &amp; TA once it clears.`,
        route: "calculators", calc: "chlorine",
      });
    }

    // HEAT WAVE
    if (wx.heatDays >= WX_K.heat.waveDays || wx.waterTempF >= WX_K.heat.waterHotF) {
      const sunset = wx.days[0] && wx.days[0].sunset ? new Date(wx.days[0].sunset).toLocaleTimeString([], { hour: "numeric" }) : "sundown";
      add({
        id: "wx-heat", severity: "watch", icon: "sun",
        title: wx.heatDays >= WX_K.heat.waveDays ? `Heat wave — ${wx.heatDays} days of ${WX_K.heat.dayMaxF}°F+` : "Hot water — chlorine demand is surging",
        detail: `Highs near <b>${wx.todayHiF}°F</b> and water around <b>${wx.waterTempF}°F</b>. Expect FC loss of 4–6+ ppm/day and faster algae growth — pools on a normal dose often crash below minimum by late afternoon.`,
        recommend: `Dose chlorine <b>after ${sunset}</b> (sun won't burn it off overnight), aim for the <b>top</b> of your FC range, keep CYA at the high end, and <b>test daily</b> until it breaks.`,
        route: "calculators", calc: "chlorine",
      });
    }

    // FREEZE
    if (wx.minLow72 <= WX_K.cold.freezeF) {
      const hard = wx.minLow72 <= WX_K.cold.hardFreezeF;
      add({
        id: "wx-freeze", severity: hard ? "urgent" : "watch", icon: "snow",
        title: hard ? "Hard freeze — equipment at risk tonight" : "Freeze warning overnight",
        detail: `Overnight lows drop to about <b>${wx.minLow72}°F</b>. Standing water in pipes, pump, filter and heater can freeze and crack — moving water won't.`,
        recommend: hard
          ? `<b>Run the pump continuously overnight</b> (and any spa/water features). Confirm freeze-protection is enabled on the timer. Consider running drips on exposed plumbing.`
          : `Set the pump to run through the cold hours (most timers have freeze protection — turn it on). Keep water circulating so nothing freezes solid.`,
        route: "learn",
      });
    }

    // HIGH UV
    if (wx.uvMaxToday >= WX_K.uv.high) {
      const exposed = cya < cyaFloor;
      add({
        id: "wx-uv", severity: exposed ? "watch" : "info", icon: "sun-uv",
        title: exposed ? `UV index ${wx.uvMaxToday} — your CYA is too low to protect FC` : `Very high UV today (index ${wx.uvMaxToday})`,
        detail: exposed
          ? `Strong sun destroys unprotected chlorine fast, and your CYA is only <b>${cya}</b> (want ≥${cyaFloor}${swg ? " for a salt pool" : ""}). Expect FC to plunge by midday.`
          : `UV peaks around <b>${wx.uvMaxToday}</b>. Your CYA of <b>${cya}</b> is shielding the chlorine, but demand still runs high on days like this.`,
        recommend: exposed
          ? `Raise CYA toward ${swg ? "70–80" : "40–50"} so the sun stops burning off your FC, and dose after sundown. Until then, keep FC at the top of range.`
          : `No action needed — just keep FC topped up and consider dosing in the evening.`,
        route: exposed ? "calculators" : "learn",
        calc: exposed ? "cya" : undefined,
      });
    }

    // WIND / DUST
    if (wx.gustMax72 >= WX_K.wind.gustWatch) {
      const storm = wx.gustMax72 >= WX_K.wind.gustUrgent;
      add({
        id: "wx-wind", severity: storm ? "watch" : "info", icon: "wind",
        title: storm ? `Dust storm winds (gusts to ${wx.gustMax72} mph)` : `Windy — debris blowing in (gusts to ${wx.gustMax72} mph)`,
        detail: `Wind drops dust, pollen, leaves and organics into the water. That load consumes chlorine and shows up as <b>combined chlorine (CC)</b> and cloudiness${storm ? " — a haboob can dump a real organic load in minutes." : "."}`,
        recommend: `After it passes: <b>brush &amp; skim</b>, empty the pump/skimmer baskets, run the filter, and <b>test CC</b>. If CC climbs above 0.5, bump FC to clear it before it gains a foothold.`,
        route: "log",
      });
    }

    return out;
  }

  /* ----------------------------- sync ---------------------------------- */
  async function sync(profile) {
    if (!profile || !profile.region) return cached();
    if (typeof navigator !== "undefined" && navigator.onLine === false) return cached();
    try {
      const store = read();
      let geo = profile.geo || store.geo;
      if (!geo || geo.resolvedFrom !== profile.region) {
        geo = await geocode(profile.region);
        if (!geo) return cached();
        store.geo = geo;
        profile.geo = geo; // app.js persists profile on save()
      }
      const ttl = (store.wx && store.wx.rain24 && store.wx.rain24.prob >= 50) ? RAIN_TTL : FX_TTL;
      if (store.wx && (Date.now() - store.wx.at) < ttl && store.geo && store.geo.resolvedFrom === profile.region) return store.wx;
      const raw = await fetchForecast(geo);
      const wx = derive(raw, profile);
      if (wx) { store.wx = wx; write(store); }
      return wx || cached();
    } catch (e) { return cached(); }
  }
  function cached() { const s = read(); return s.wx || null; }

  /* ----------------------------- widget -------------------------------- */
  function wxIcon(c) {
    if (c === 0) return "sun";
    if (c <= 3) return "cloud";
    if (c >= 45 && c <= 48) return "cloud";
    if (c >= 51 && c <= 67) return "cloud-rain";
    if (c >= 71 && c <= 77) return "snow";
    if (c >= 80 && c <= 82) return "cloud-rain";
    if (c >= 95) return "cloud-rain";
    return "cloud";
  }
  function ago(t) {
    const m = Math.max(0, (Date.now() - (t || Date.now())) / 60000);
    if (m < 1) return "just now";
    if (m < 60) return Math.round(m) + " min ago";
    const h = m / 60; if (h < 24) return Math.round(h) + " hr ago";
    return Math.round(h / 24) + " day" + (Math.round(h / 24) === 1 ? "" : "s") + " ago";
  }
  function icon(n) { return S && S.icon ? S.icon(n) : ""; }
  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

  function widget(wx, geoName) {
    if (!wx) return "";
    const day = (d) => `
      <div class="wx-day">
        <span class="wx-day__d">${new Date(d.date).toLocaleDateString([], { weekday: "short" })}</span>
        <span class="wx-day__ic">${icon(wxIcon(d.code))}</span>
        <span class="wx-day__hi">${d.hiF}°</span>
        <span class="wx-day__lo">${d.loF}°</span>
        ${d.pop >= 20 ? `<span class="wx-day__pop">${icon("cloud-rain")} ${d.pop}%</span>` : `<span class="wx-day__pop wx-day__pop--none"></span>`}
      </div>`;
    const trendArrow = wx.waterTrend === "warming" ? "↑" : wx.waterTrend === "cooling" ? "↓" : "";
    return `<div class="card wx-card" style="margin-bottom:22px">
      <div class="wx-now">
        <div class="wx-now__ic">${icon(wxIcon(wx.code))}</div>
        <div class="wx-now__main">
          <div class="wx-now__temp">${wx.nowTempF}<span>°F</span></div>
          <div class="muted wx-now__sub">Feels ${wx.feelsF}° · Water ~${wx.waterTempF}° ${trendArrow}${geoName ? " · " + esc(geoName) : ""}</div>
        </div>
        <div class="wx-now__meta">
          <span class="chip">${icon("sun-uv")} UV ${wx.uvNow}</span>
          <span class="chip">${icon("wind")} ${wx.windMph} mph</span>
          ${wx.rain24.prob >= 20 ? `<span class="chip">${icon("cloud-rain")} ${wx.rain24.prob}%</span>` : ""}
        </div>
      </div>
      <div class="wx-strip">${wx.days.slice(0, 5).map(day).join("")}</div>
      <div class="wx-foot muted">Updated ${ago(wx.at)} · Open-Meteo</div>
    </div>`;
  }

  global.WEATHER = { sync: sync, cached: cached, derive: derive, warnings: warnings, geocode: geocode, widget: widget, wxIcon: wxIcon, WX_K: WX_K };
})(window);
