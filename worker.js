const TMD_API_BASE = "https://data.tmd.go.th/nwpapi/v1/forecast/location";

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/weather") {
      if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
      if (!env.TMD_API_TOKEN) return jsonResponse({ error: "TMD API token is not configured" }, 500);

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

      const [hourlyResponse, dailyResponse] = await Promise.all([
        fetch(hourlyUrl, { headers }),
        fetch(dailyUrl, { headers }),
      ]);
      if (!hourlyResponse.ok || !dailyResponse.ok) {
        return jsonResponse({ error: "TMD API request failed" }, hourlyResponse.status === 401 || dailyResponse.status === 401 ? 401 : 502);
      }

      const [hourly, daily] = await Promise.all([hourlyResponse.json(), dailyResponse.json()]);
      return jsonResponse({ hourly, daily });
    }

    return env.ASSETS.fetch(request);
  },
};
