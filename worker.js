const TMD_API_BASE = "https://data.tmd.go.th/nwpapi/v1/forecast/location";
const provinceSlugs = {
  กรุงเทพมหานคร: "bangkok",
  สงขลา: "songkhla",
  ปัตตานี: "pattani",
  ภูเก็ต: "phuket",
  เชียงใหม่: "chiangmai",
  นครราชสีมา: "nakhonratchasima",
};

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

async function fetchObservedWeather(province) {
  const slug = provinceSlugs[province] || "songkhla";
  const response = await fetch(`https://www.tmd.go.th/weather/province/${slug}`);
  if (!response.ok) return null;
  const text = (await response.text()).replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  const stationSection = text.split("สภาพอากาศปัจจุบันจากสถานีอุตุนิยมวิทยา")[1] || text;
  const temperature = readNumber(/อุณหภูมิ\s+([0-9.]+)\s*°C/, stationSection);
  const humidity = readNumber(/ความชื้นสัมพัทธ์\s+([0-9.]+)\s*%/, stationSection);
  const wind = readNumber(/ลม\s+[^-]{0,60}-\s*([0-9.]+)\s*กม\.\/ชม\./, stationSection);
  const rain = readNumber(/ฝนสะสมวันนี้[^0-9]*([0-9.]+)\s*มม\./, stationSection);
  const pressure = readNumber(/ความกดอากาศ\s+([0-9.]+)\s*hPa/, stationSection);
  if (temperature === null) return null;
  return { temperature, humidity, wind, rain, pressure };
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
  const response = await fetch(`https://api.open-meteo.com/v1/forecast?${params}`);
  if (!response.ok) return null;
  return response.json();
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/weather") {
      if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
      if (!env.TMD_API_TOKEN) return jsonResponse({ error: "TMD API token is not configured" }, 500);

      const latitude = Number(url.searchParams.get("lat"));
      const longitude = Number(url.searchParams.get("lon"));
      const province = url.searchParams.get("province") || "สงขลา";
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
        fetch(hourlyUrl, { headers }),
        fetch(dailyUrl, { headers }),
        fetchObservedWeather(province).catch(() => null),
      ]);
      const hourly = hourlyResult.ok ? await hourlyResult.json() : null;
      const daily = dailyResult.ok ? await dailyResult.json() : null;
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
