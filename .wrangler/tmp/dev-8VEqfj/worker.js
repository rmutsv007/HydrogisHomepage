var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// worker.js
var TMD_API_BASE = "https://data.tmd.go.th/nwpapi/v1/forecast/location";
var TMD_WEATHER_TODAY = "https://data.tmd.go.th/api/WeatherToday/V2/";
function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });
}
__name(jsonResponse, "jsonResponse");
function fetchWithTimeout(resource, options = {}, timeoutMs = 5e3) {
  const signal = AbortSignal.timeout(timeoutMs);
  return fetch(resource, { ...options, signal });
}
__name(fetchWithTimeout, "fetchWithTimeout");
async function safeFetch(resource, options = {}, timeoutMs = 5e3) {
  try {
    return await fetchWithTimeout(resource, options, timeoutMs);
  } catch (error) {
    return null;
  }
}
__name(safeFetch, "safeFetch");
function xmlValue(tag, station) {
  const match = station.match(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`));
  return match ? match[1].trim() : null;
}
__name(xmlValue, "xmlValue");
async function fetchObservedWeather(latitude, longitude, env) {
  if (!env.TMD_WEATHER_UID || !env.TMD_WEATHER_UKEY) return null;
  const params = new URLSearchParams({ uid: env.TMD_WEATHER_UID, ukey: env.TMD_WEATHER_UKEY });
  const response = await safeFetch(`${TMD_WEATHER_TODAY}?${params}`, {}, 5e3);
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
        station: xmlValue("StationNameThai", station) || "\u0E2A\u0E16\u0E32\u0E19\u0E35\u0E15\u0E23\u0E27\u0E08\u0E27\u0E31\u0E14\u0E43\u0E01\u0E25\u0E49\u0E40\u0E04\u0E35\u0E22\u0E07",
        observedAt: xmlValue("DateTime", station),
        temperature,
        max: Number(xmlValue("MaxTemperature", station)),
        min: Number(xmlValue("MinTemperature", station)),
        humidity: Number(xmlValue("RelativeHumidity", station)),
        wind: Number(xmlValue("WindSpeed", station)),
        windDirection: Number(xmlValue("WindDirection", station)),
        rain: Number(xmlValue("Rainfall", station)),
        pressure: Number(xmlValue("MeanSeaLevelPressure", station))
      };
    }
  }
  return closest;
}
__name(fetchObservedWeather, "fetchObservedWeather");
async function fetchFallbackWeather(latitude, longitude) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    current: "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation",
    daily: "temperature_2m_max,temperature_2m_min",
    forecast_days: "1",
    timezone: "auto"
  });
  const response = await safeFetch(`https://api.open-meteo.com/v1/forecast?${params}`, {}, 8e3);
  if (!response?.ok) return null;
  return response.json();
}
__name(fetchFallbackWeather, "fetchFallbackWeather");
async function fetchWaterQualitySurveys() {
  const endpoint = "https://map.surveywms.com/geoserver/ChalatatSongkhla/ows";
  const capabilitiesUrl = new URL(endpoint);
  capabilitiesUrl.search = new URLSearchParams({
    service: "WFS",
    version: "1.0.0",
    request: "GetCapabilities"
  });
  const capabilitiesResponse = await safeFetch(capabilitiesUrl, {}, 1e4);
  if (!capabilitiesResponse?.ok) return null;
  const capabilities = await capabilitiesResponse.text();
  const layers = [...capabilities.matchAll(/<FeatureType\b[^>]*>([\s\S]*?)<\/FeatureType>/g)].map((match) => match[1].match(/<Name>(?:[^<]*:)?(WaterQuality_\d{8})<\/Name>/)?.[1]).filter(Boolean).map((name) => ({
    name,
    date: name.match(/WaterQuality_(\d{2})(\d{2})(\d{4})/).slice(1).reverse().join("-")
  })).sort((first, second) => first.date.localeCompare(second.date));
  if (!layers.length) return null;
  const surveys = [];
  for (let index = 0; index < layers.length; index += 4) {
    const batch = await Promise.all(layers.slice(index, index + 4).map(async (layer) => {
      const featureUrl = new URL(endpoint);
      featureUrl.search = new URLSearchParams({
        service: "WFS",
        version: "1.0.0",
        request: "GetFeature",
        typeName: `ChalatatSongkhla:${layer.name}`,
        outputFormat: "application/json"
      });
      const featureResponse = await safeFetch(featureUrl, {}, 1e4);
      if (!featureResponse?.ok) return null;
      const data = await featureResponse.json();
      const features = data.features || [];
      if (!features.length) return null;
      return {
        layer: layer.name,
        date: features[0].properties?.date || layer.date,
        features
      };
    }));
    surveys.push(...batch.filter(Boolean));
  }
  return surveys.length ? { surveys } : null;
}
__name(fetchWaterQualitySurveys, "fetchWaterQualitySurveys");
var worker_default = {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/water-quality") {
      if (request.method !== "GET") return jsonResponse({ error: "Method not allowed" }, 405);
      const data = await fetchWaterQualitySurveys();
      if (!data) return jsonResponse({ error: "Water quality data unavailable" }, 502);
      return jsonResponse(data);
    }
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
      const bangkokNow = new Date((/* @__PURE__ */ new Date()).toLocaleString("en-US", { timeZone: "Asia/Bangkok" }));
      const date = new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Bangkok",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(/* @__PURE__ */ new Date());
      const headers = {
        accept: "application/json",
        authorization: `Bearer ${env.TMD_API_TOKEN}`
      };
      const hourlyUrl = new URL(`${TMD_API_BASE}/hourly/at`);
      hourlyUrl.search = new URLSearchParams({
        lat: latitude,
        lon: longitude,
        date,
        hour: String(bangkokNow.getHours()),
        duration: "1",
        fields: "tc,rh,cond,rain,ws10m,wd10m"
      });
      const dailyUrl = new URL(`${TMD_API_BASE}/daily/at`);
      dailyUrl.search = new URLSearchParams({
        lat: latitude,
        lon: longitude,
        date,
        duration: "1",
        fields: "tc_min,tc_max,rh,rain,ws10m,wd10m,cond"
      });
      const [hourlyResult, dailyResult, observed] = await Promise.all([
        safeFetch(hourlyUrl, { headers }),
        safeFetch(dailyUrl, { headers }),
        fetchObservedWeather(latitude, longitude, env)
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
  }
};

// node_modules/wrangler/templates/middleware/middleware-ensure-req-body-drained.ts
var drainBody = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } finally {
    try {
      if (request.body !== null && !request.bodyUsed) {
        const reader = request.body.getReader();
        while (!(await reader.read()).done) {
        }
      }
    } catch (e) {
      console.error("Failed to drain the unused request body.", e);
    }
  }
}, "drainBody");
var middleware_ensure_req_body_drained_default = drainBody;

// node_modules/wrangler/templates/middleware/middleware-miniflare3-json-error.ts
function reduceError(e) {
  return {
    name: e?.name,
    message: e?.message ?? String(e),
    stack: e?.stack,
    cause: e?.cause === void 0 ? void 0 : reduceError(e.cause)
  };
}
__name(reduceError, "reduceError");
var jsonError = /* @__PURE__ */ __name(async (request, env, _ctx, middlewareCtx) => {
  try {
    return await middlewareCtx.next(request, env);
  } catch (e) {
    const error = reduceError(e);
    const body = JSON.stringify(error);
    const headers = {
      "Content-Type": "application/json",
      "MF-Experimental-Error-Stack": "true"
    };
    const encoded = encodeURIComponent(body);
    if (encoded.length <= 8192) {
      headers["MF-Experimental-Error-Stack-Payload"] = encoded;
    }
    return new Response(body, { status: 500, headers });
  }
}, "jsonError");
var middleware_miniflare3_json_error_default = jsonError;

// .wrangler/tmp/bundle-OdZpyx/middleware-insertion-facade.js
var __INTERNAL_WRANGLER_MIDDLEWARE__ = [
  middleware_ensure_req_body_drained_default,
  middleware_miniflare3_json_error_default
];
var middleware_insertion_facade_default = worker_default;

// node_modules/wrangler/templates/middleware/common.ts
var __facade_middleware__ = [];
function __facade_register__(...args) {
  __facade_middleware__.push(...args.flat());
}
__name(__facade_register__, "__facade_register__");
function __facade_invokeChain__(request, env, ctx, dispatch, middlewareChain) {
  const [head, ...tail] = middlewareChain;
  const middlewareCtx = {
    dispatch,
    next(newRequest, newEnv) {
      return __facade_invokeChain__(newRequest, newEnv, ctx, dispatch, tail);
    }
  };
  return head(request, env, ctx, middlewareCtx);
}
__name(__facade_invokeChain__, "__facade_invokeChain__");
function __facade_invoke__(request, env, ctx, dispatch, finalMiddleware) {
  return __facade_invokeChain__(request, env, ctx, dispatch, [
    ...__facade_middleware__,
    finalMiddleware
  ]);
}
__name(__facade_invoke__, "__facade_invoke__");

// .wrangler/tmp/bundle-OdZpyx/middleware-loader.entry.ts
var __Facade_ScheduledController__ = class ___Facade_ScheduledController__ {
  constructor(scheduledTime, cron, noRetry) {
    this.scheduledTime = scheduledTime;
    this.cron = cron;
    this.#noRetry = noRetry;
  }
  scheduledTime;
  cron;
  static {
    __name(this, "__Facade_ScheduledController__");
  }
  #noRetry;
  noRetry() {
    if (!(this instanceof ___Facade_ScheduledController__)) {
      throw new TypeError("Illegal invocation");
    }
    this.#noRetry();
  }
};
function wrapExportedHandler(worker) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return worker;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  const fetchDispatcher = /* @__PURE__ */ __name(function(request, env, ctx) {
    if (worker.fetch === void 0) {
      throw new Error("Handler does not export a fetch() function.");
    }
    return worker.fetch(request, env, ctx);
  }, "fetchDispatcher");
  return {
    ...worker,
    fetch(request, env, ctx) {
      const dispatcher = /* @__PURE__ */ __name(function(type, init) {
        if (type === "scheduled" && worker.scheduled !== void 0) {
          const controller = new __Facade_ScheduledController__(
            Date.now(),
            init.cron ?? "",
            () => {
            }
          );
          return worker.scheduled(controller, env, ctx);
        }
      }, "dispatcher");
      return __facade_invoke__(request, env, ctx, dispatcher, fetchDispatcher);
    }
  };
}
__name(wrapExportedHandler, "wrapExportedHandler");
function wrapWorkerEntrypoint(klass) {
  if (__INTERNAL_WRANGLER_MIDDLEWARE__ === void 0 || __INTERNAL_WRANGLER_MIDDLEWARE__.length === 0) {
    return klass;
  }
  for (const middleware of __INTERNAL_WRANGLER_MIDDLEWARE__) {
    __facade_register__(middleware);
  }
  return class extends klass {
    #fetchDispatcher = /* @__PURE__ */ __name((request, env, ctx) => {
      this.env = env;
      this.ctx = ctx;
      if (super.fetch === void 0) {
        throw new Error("Entrypoint class does not define a fetch() function.");
      }
      return super.fetch(request);
    }, "#fetchDispatcher");
    #dispatcher = /* @__PURE__ */ __name((type, init) => {
      if (type === "scheduled" && super.scheduled !== void 0) {
        const controller = new __Facade_ScheduledController__(
          Date.now(),
          init.cron ?? "",
          () => {
          }
        );
        return super.scheduled(controller);
      }
    }, "#dispatcher");
    fetch(request) {
      return __facade_invoke__(
        request,
        this.env,
        this.ctx,
        this.#dispatcher,
        this.#fetchDispatcher
      );
    }
  };
}
__name(wrapWorkerEntrypoint, "wrapWorkerEntrypoint");
var WRAPPED_ENTRY;
if (typeof middleware_insertion_facade_default === "object") {
  WRAPPED_ENTRY = wrapExportedHandler(middleware_insertion_facade_default);
} else if (typeof middleware_insertion_facade_default === "function") {
  WRAPPED_ENTRY = wrapWorkerEntrypoint(middleware_insertion_facade_default);
}
var middleware_loader_entry_default = WRAPPED_ENTRY;
export {
  __INTERNAL_WRANGLER_MIDDLEWARE__,
  middleware_loader_entry_default as default
};
//# sourceMappingURL=worker.js.map
