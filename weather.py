#!/usr/bin/env python3
"""
Poolaris — server-side weather (pure stdlib).

A Python port of js/weather.js so the always-on engine can fire freeze / heat /
rain / UV warnings 24/7 — even when nobody has the app open. Uses Open-Meteo
(free, no API key) over urllib. Fully optional: every call swallows errors and
returns None, and the engine only polls weather when POOLARIS_WEATHER=1, so a
no-internet install runs exactly as before.

Threshold rules + derive math mirror js/weather.js WX_K / derive() / warnings()
so the server and browser show the same weather warnings.
"""

import json
import urllib.parse
import urllib.request

DAY_MS = 86_400_000
HTTP_TIMEOUT = 8

WX_K = {
    "rain": {"popWatch": 50, "inWatch": 0.25, "inUrgent": 0.75, "skipDoseInHrs": 12},
    "heat": {"dayMaxF": 95, "waveDays": 3, "waterHotF": 90},
    "cold": {"freezeF": 34, "hardFreezeF": 28},
    "uv": {"high": 8, "extreme": 10, "cyaFloor": 30, "cyaFloorSwg": 60},
    "wind": {"gustWatch": 30, "gustUrgent": 45},
}

STATE_ABBR = {
    "az": "arizona",
    "ca": "california",
    "tx": "texas",
    "fl": "florida",
    "nv": "nevada",
    "nm": "new mexico",
    "ut": "utah",
    "co": "colorado",
    "ga": "georgia",
    "nc": "north carolina",
    "sc": "south carolina",
    "or": "oregon",
    "wa": "washington",
    "ny": "new york",
    "il": "illinois",
    "oh": "ohio",
    "pa": "pennsylvania",
    "mi": "michigan",
    "va": "virginia",
    "tn": "tennessee",
    "la": "louisiana",
    "al": "alabama",
    "ms": "mississippi",
    "ok": "oklahoma",
    "ks": "kansas",
    "mo": "missouri",
    "ar": "arkansas",
    "in": "indiana",
    "wi": "wisconsin",
    "mn": "minnesota",
    "ma": "massachusetts",
    "ct": "connecticut",
    "nj": "new jersey",
    "md": "maryland",
    "hi": "hawaii",
    "id": "idaho",
    "mt": "montana",
    "ne": "nebraska",
    "nd": "north dakota",
    "sd": "south dakota",
    "wy": "wyoming",
    "ak": "alaska",
    "me": "maine",
    "nh": "new hampshire",
    "vt": "vermont",
    "ri": "rhode island",
    "de": "delaware",
    "wv": "west virginia",
    "ky": "kentucky",
    "ia": "iowa",
}


def _get_json(url):
    req = urllib.request.Request(url, headers={"User-Agent": "Poolaris/1.0"})
    with urllib.request.urlopen(req, timeout=HTTP_TIMEOUT) as r:
        return json.loads(r.read().decode("utf-8"))


def geocode(region):
    """Resolve a 'City, ST' string to {lat, lon, name, tz}. Returns None on failure."""
    if not region:
        return None
    try:
        name = region.split(",")[0].strip()
        st = region.split(",")[1].strip().lower() if "," in region else ""
        if not name:
            return None
        url = (
            "https://geocoding-api.open-meteo.com/v1/search?name="
            + urllib.parse.quote(name)
            + "&count=5&language=en&format=json"
        )
        j = _get_json(url)
        results = j.get("results") or []
        if not results:
            return None
        pick = results[0]
        if st:
            for x in results:
                a = (x.get("admin1") or "").lower()
                if a.startswith(st) or STATE_ABBR.get(st) == a:
                    pick = x
                    break
        return {
            "lat": pick["latitude"],
            "lon": pick["longitude"],
            "name": pick["name"]
            + (", " + pick["admin1"] if pick.get("admin1") else ""),
            "tz": pick.get("timezone"),
            "resolvedFrom": region,
        }
    except Exception:
        return None


def fetch_forecast(lat, lon):
    url = (
        "https://api.open-meteo.com/v1/forecast?latitude="
        + str(lat)
        + "&longitude="
        + str(lon)
        + "&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m,wind_gusts_10m,uv_index"
        + "&hourly=temperature_2m,precipitation,precipitation_probability,uv_index,wind_speed_10m,wind_gusts_10m,weather_code"
        + "&daily=weather_code,temperature_2m_max,temperature_2m_min,uv_index_max,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,wind_gusts_10m_max,sunrise,sunset"
        + "&temperature_unit=fahrenheit&wind_speed_unit=mph&precipitation_unit=inch&timezone=auto&forecast_days=6&past_days=1"
    )
    return _get_json(url)


def derive(raw, profile):
    """Mirror of js/weather.js derive(): normalize the forecast into a wx object."""
    try:
        d = raw["daily"]
        h = raw["hourly"]
        cur = raw["current"]
        today = (cur.get("time") or "")[:10]
        di = d["time"].index(today) if today in d["time"] else 0
        di = max(0, di)
        # current hour index
        hi = 0
        for i, t in enumerate(h["time"]):
            if t >= cur.get("time", ""):
                hi = i
                break

        def win(hrs):
            amt = 0.0
            prob = 0
            for i in range(hi, min(hi + hrs, len(h["time"]))):
                amt += h["precipitation"][i] or 0
                prob = max(prob, h["precipitation_probability"][i] or 0)
            return {"in": round(amt, 2), "prob": prob}

        def day_mean(i):
            return (d["temperature_2m_max"][i] + d["temperature_2m_min"][i]) / 2

        lo = max(0, di - 2)
        s = sum(day_mean(i) for i in range(lo, di + 1))
        n = di - lo + 1
        est = s / n - 4
        if profile and profile.get("tempF"):
            est = est * 0.6 + profile["tempF"] * 0.4
        water = round(est)
        trend = (
            "warming"
            if day_mean(di) > day_mean(max(0, di - 1))
            else "cooling"
            if day_mean(di) < day_mean(max(0, di - 1))
            else "steady"
        )

        heat_days = 0
        for i in range(di, len(d["time"])):
            if d["temperature_2m_max"][i] >= WX_K["heat"]["dayMaxF"]:
                heat_days += 1
            else:
                break

        def nn(v):
            return 999 if v is None else v

        def at(arr, i):
            return arr[i] if i < len(arr) else None

        return {
            "tz": raw.get("timezone"),
            "nowTempF": round(cur["temperature_2m"]),
            "feelsF": round(cur["apparent_temperature"]),
            "code": cur.get("weather_code"),
            "windMph": round(cur["wind_speed_10m"]),
            "gustMph": round(cur["wind_gusts_10m"]),
            "uvNow": round(cur.get("uv_index") or 0, 1),
            "todayHiF": round(d["temperature_2m_max"][di]),
            "todayLoF": round(d["temperature_2m_min"][di]),
            "uvMaxToday": round(d["uv_index_max"][di] or 0, 1),
            "waterTempF": water,
            "waterTrend": trend,
            "rain24": win(24),
            "rain48": win(48),
            "rain72": win(72),
            "minLow72": min(
                d["temperature_2m_min"][di],
                nn(at(d["temperature_2m_min"], di + 1)),
                nn(at(d["temperature_2m_min"], di + 2)),
            ),
            "heatDays": heat_days,
            "gustMax72": max(
                d["wind_gusts_10m_max"][di] or 0,
                (at(d["wind_gusts_10m_max"], di + 1) or 0),
                (at(d["wind_gusts_10m_max"], di + 2) or 0),
            ),
        }
    except Exception:
        return None


def warnings(wx, profile, latest):
    """Pool-care warnings as alert dicts the engine persists. Mirror of js warnings()."""
    if not wx:
        return []
    out = []
    profile = profile or {}
    swg = profile.get("sanitizer") == "salt"
    cya = latest.get("cya") if latest and latest.get("cya") is not None else 40
    cya_floor = WX_K["uv"]["cyaFloorSwg"] if swg else WX_K["uv"]["cyaFloor"]

    def add(
        kind, severity, title, detail, recommend, route="learn", calc=None, bucket=""
    ):
        out.append(
            {
                "kind": kind,
                "severity": severity,
                "title": title,
                "detail": detail,
                "recommend": recommend,
                "route": route,
                "calc": calc,
                "metric": "weather",
                "dedup_bucket": bucket or kind,
            }
        )

    r = wx["rain48"]
    if r["prob"] >= WX_K["rain"]["popWatch"] or r["in"] >= WX_K["rain"]["inWatch"]:
        heavy = r["in"] >= WX_K["rain"]["inUrgent"]
        add(
            "wx_rain",
            "watch" if heavy else "info",
            "Heavy rain coming — protect your chlorine"
            if heavy
            else "Rain in the forecast",
            f'About {r["in"]}" of rain at {r["prob"]}% over the next 48h. Rain dilutes FC, CYA & salt and can overflow the pool.',
            f"Top FC up before the storm and skip dosing in the {WX_K['rain']['skipDoseInHrs']}h before it hits. Re-test after.",
            route="calculators",
            calc="chlorine",
        )

    if (
        wx["heatDays"] >= WX_K["heat"]["waveDays"]
        or wx["waterTempF"] >= WX_K["heat"]["waterHotF"]
    ):
        add(
            "wx_heat",
            "watch",
            f"Heat wave — {wx['heatDays']} days of {WX_K['heat']['dayMaxF']}°F+"
            if wx["heatDays"] >= WX_K["heat"]["waveDays"]
            else "Hot water — chlorine demand is surging",
            f"Highs near {wx['todayHiF']}°F and water around {wx['waterTempF']}°F. Expect 4–6+ ppm/day FC loss and faster algae growth.",
            "Dose chlorine after sundown, aim for the top of your FC range, keep CYA high, and test daily until it breaks.",
            route="calculators",
            calc="chlorine",
        )

    if wx["minLow72"] <= WX_K["cold"]["freezeF"]:
        hard = wx["minLow72"] <= WX_K["cold"]["hardFreezeF"]
        add(
            "wx_freeze",
            "urgent" if hard else "watch",
            "Hard freeze — equipment at risk tonight"
            if hard
            else "Freeze warning overnight",
            f"Overnight lows drop to about {wx['minLow72']}°F. Standing water in pipes, pump and heater can freeze and crack.",
            "Run the pump continuously overnight and enable freeze protection on the timer."
            if hard
            else "Set the pump to run through the cold hours so nothing freezes solid.",
            route="learn",
        )

    if wx["uvMaxToday"] >= WX_K["uv"]["high"]:
        exposed = cya < cya_floor
        add(
            "wx_uv",
            "watch" if exposed else "info",
            f"UV index {wx['uvMaxToday']} — your CYA is too low to protect FC"
            if exposed
            else f"Very high UV today (index {wx['uvMaxToday']})",
            f"Strong sun destroys unprotected chlorine fast and your CYA is only {cya} (want ≥{cya_floor})."
            if exposed
            else f"UV peaks around {wx['uvMaxToday']}. Your CYA of {cya} is shielding the chlorine, but demand runs high.",
            f"Raise CYA toward {'70–80' if swg else '40–50'} and dose after sundown."
            if exposed
            else "Keep FC topped up and consider dosing in the evening.",
            route="calculators" if exposed else "learn",
            calc="cya" if exposed else None,
        )

    if wx["gustMax72"] >= WX_K["wind"]["gustWatch"]:
        storm = wx["gustMax72"] >= WX_K["wind"]["gustUrgent"]
        add(
            "wx_wind",
            "watch" if storm else "info",
            f"Dust storm winds (gusts to {wx['gustMax72']} mph)"
            if storm
            else f"Windy — debris blowing in (gusts to {wx['gustMax72']} mph)",
            "Wind drops dust, pollen and organics into the water — that load consumes chlorine and shows up as combined chlorine.",
            "After it passes: brush & skim, empty the baskets, run the filter, and test CC.",
            route="log",
        )

    return out


def water_temp_for(wx):
    """Expose the lag-aware water-temp estimate (for the engine to feed CSI/demand)."""
    return wx.get("waterTempF") if wx else None
