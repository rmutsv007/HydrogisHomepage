const TMD_API_BASE = "https://data.tmd.go.th/nwpapi/v1/forecast/location";
const TMD_WEATHER_TODAY = "https://data.tmd.go.th/api/WeatherToday/V2/";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function readNumber(pattern, text) {
  const match = text.match(pattern);
  return match ? Number(match[1]) : null;
}

function fetchWithTimeout(resource, options = {}, timeoutMs = 5000) {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(resource, { ...options, signal });
}

async function safeFetch(resource, options = {}, timeoutMs = 5000) {
  try {
    return await fetchWithTimeout(resource, options, timeoutMs);
  } catch (error) {
    return null;
  }
}

function xmlValue(tag, station) {
  const match = station.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return match ? match[1].trim() : null;
}

async function fetchObservedWeather(latitude, longitude, env) {
  if (!env.TMD_WEATHER_UID || !env.TMD_WEATHER_UKEY) return null;
  const params = new URLSearchParams({ uid: env.TMD_WEATHER_UID, ukey: env.TMD_WEATHER_UKEY });
  const response = await safeFetch(`${TMD_WEATHER_TODAY}?${params}`, {}, 5000);
  if (!response?.ok) return null;
  const xml = await response.text();
  const stations = [...xml.matchAll(/<Station>([\s\S]*?)<\/Station>/g)].map((match) => match[1]);
  let closest = null;

  for (const station of stations) {
    const stationLatitude = Number(xmlValue("Latitude", station));
    const stationLongitude = Number(xmlValue("Longitude", station));
    const temperature = Number(xmlValue("Temperature", station));
    if (![stationLatitude, stationLongitude, temperature].every(Number.isFinite)) continue;
    const distance = (stationLatitude - latitude) ** 2 + (stationLongitude - longitude) ** 2;
    if (!closest || distance < closest.distance) {
      closest = {
        distance,
        station: xmlValue("StationNameThai", station) || "สถานีตรวจวัดใกล้เคียง",
        observedAt: xmlValue("DateTime", station),
        temperature,
        max: Number(xmlValue("MaxTemperature", station)),
        min: Number(xmlValue("MinTemperature", station)),
        humidity: Number(xmlValue("RelativeHumidity", station)),
        wind: Number(xmlValue("WindSpeed", station)),
        windDirection: Number(xmlValue("WindDirection", station)),
        rain: Number(xmlValue("Rainfall", station)),
        pressure: Number(xmlValue("MeanSeaLevelPressure", station)),
      };
    }
  }

  return closest;
}

async function fetchFallbackWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current: "temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation",
    daily: "temperature_2m_max,temperature_2m_min",
    forecast_days: "1",
    timezone: "auto",
  });
  const response = await safeFetch(`https://api.open-meteo.com/v1/forecast?${params}`, {}, 8000);
  if (!response?.ok) return null;
  return response.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/weather") {
      if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
      if (!env.TMD_API_TOKEN && (!env.TMD_WEATHER_UID || !env.TMD_WEATHER_UKEY)) {
        return jsonResponse({ error: "TMD credentials are not configured" }, 500);
      }

      const latitude = Number(url.searchParams.get("lat"));
      const longitude = Number(url.searchParams.get("lon"));
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return jsonResponse({ error: "Valid lat and lon are required" }, 400);
      }

      const bangkokNow = new Date(new Date().toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(new Date());
      const headers = {
        accept: "application/json",
        authorization: `Bearer ${env.TMD_API_TOKEN}`,
      };
      const hourlyUrl = new URL(`${TMD_API_BASE}/hourly/at`);
      hourlyUrl.search = new URLSearchParams({
        lat: latitude,
        lon: longitude,
        date,
        hour: String(bangkokNow.getHours()),
        duration: "1",
        fields: "tc,rh,cond,rain,ws10m,wd10m",
      });
      const dailyUrl = new URL(`${TMD_API_BASE}/daily/at`);
      dailyUrl.search = new URLSearchParams({
        lat: latitude,
        lon: longitude,
        date,
        duration: "1",
        fields: "tc_min,tc_max,rh,rain,ws10m,wd10m,cond",
      });

      const [hourlyResult, dailyResult, observed] = await Promise.all([
        safeFetch(hourlyUrl, { headers }),
        safeFetch(dailyUrl, { headers }),
        fetchObservedWeather(latitude, longitude, env),
      ]);
      const hourly = hourlyResult?.ok ? await hourlyResult.json() : null;
      const daily = dailyResult?.ok ? await dailyResult.json() : null;
      if (!observed && !hourly && !daily) {
        const fallback = await fetchFallbackWeather(latitude, longitude);
        if (!fallback) return jsonResponse({ error: "Weather data unavailable" }, 502);
        return jsonResponse({ fallback, source: "fallback" });
      }
      return jsonResponse({ hourly, daily, observed, source: observed ? "station" : "forecast" });
    }

    return env.ASSETS.fetch(request);
  },
};
