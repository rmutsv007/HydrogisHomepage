// ข้อมูลตัวอย่างวันที่ตรวจล่าสุด (ควรเชื่อมต่อ API จริงในอนาคต)
const surveyDates = [
  "13 มี.ค. 2026",
  "28 มี.ค. 2026",
  "12 เม.ย. 2026",
  "27 เม.ย. 2026",
  "11 พ.ค. 2026",
  "26 พ.ค. 2026",
  "11 มิ.ย. 2026",
  "27 มิ.ย. 2026",
  "12 ก.ค. 2026",
  "23 ก.ค. 2026",
  "12 ส.ค. 2026",
];

function renderDateCards(containerId, iconUrl, limit = 6) {
  const container = document.getElementById(containerId);
  if (!container) return;

  const latestDates = surveyDates.slice(-limit);
  container.innerHTML = latestDates
    .map(
      (date) => `
        <a class="data-card" href="https://hydrogis.surveywms.com/" target="_blank" rel="noopener">
          <img src="${iconUrl}" alt="${date}" />
          <span>${date}</span>
        </a>`
    )
    .join("");
}

renderDateCards("qualityGrid", "https://hydrogis.surveywms.com/assets/quality.png");
renderDateCards("bacteriaGrid", "https://hydrogis.surveywms.com/assets/bacteria.png");

// Mobile nav toggle
const navToggle = document.getElementById("navToggle");
const mainNav = document.querySelector(".main-nav");
navToggle?.addEventListener("click", () => {
  mainNav.classList.toggle("open");
});

// Footer year
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear() + 543; // พ.ศ.

// Weather: ask for the user's location, then fall back to Bangkok when unavailable.
const weatherConfig = {
  bangkok: { latitude: 13.7563, longitude: 100.5018, label: "กรุงเทพมหานคร" },
};

const weatherElements = {
  dashboard: document.getElementById("weatherDashboard"),
  location: document.querySelector(".weather-location"),
  label: document.querySelector(".weather-label"),
  source: document.getElementById("weatherSource"),
  icon: document.getElementById("weatherIcon"),
  temperature: document.getElementById("weatherTemperature"),
  condition: document.getElementById("weatherCondition"),
  updated: document.getElementById("weatherUpdated"),
  max: document.getElementById("weatherMax"),
  min: document.getElementById("weatherMin"),
  feels: document.getElementById("weatherFeels"),
  humidity: document.getElementById("weatherHumidity"),
  wind: document.getElementById("weatherWind"),
  rain: document.getElementById("weatherRain"),
  note: document.getElementById("weatherNote"),
};

const weatherCodes = {
  1: ["ท้องฟ้าแจ่มใส", "☀", "clear"],
  2: ["มีเมฆบางส่วน", "🌤", "partly-cloudy"],
  3: ["เมฆเป็นส่วนมาก", "☁", "cloudy"],
  4: ["มีเมฆมาก", "☁", "cloudy"],
  5: ["ฝนตกเล็กน้อย", "🌦", "rain"],
  6: ["ฝนตกปานกลาง", "🌧", "rain"],
  7: ["ฝนตกหนัก", "🌧", "rain"],
  8: ["ฝนฟ้าคะนอง", "⛈", "storm"],
  9: ["อากาศหนาวจัด", "❄", "cold"],
};

function getWeatherDescription(code) {
  return weatherCodes[code] || ["สภาพอากาศแปรปรวน", "☁", "cloudy"];
}

function setWeatherLoading(isLoading) {
  weatherElements.dashboard?.toggleAttribute("data-loading", isLoading);
}

async function getLocationName(latitude, longitude) {
  const params = new URLSearchParams({
    latitude,
    longitude,
    localityLanguage: "th",
  });

  try {
    const response = await fetch(`https://api.bigdatacloud.net/data/reverse-geocode-client?${params}`);
    if (!response.ok) throw new Error("Reverse geocoding request failed");
    const data = await response.json();
    if (data.fallback) {
      const current = data.fallback.current;
      const daily = data.fallback.daily;
      const [condition, icon, weatherTheme] = getWeatherDescription(Number(current.weather_code));
      weatherElements.icon.textContent = icon;
      weatherElements.dashboard.className = `weather-dashboard weather-state-${weatherTheme}`;
      weatherElements.temperature.textContent = Math.round(current.temperature_2m);
      weatherElements.condition.textContent = condition;
      weatherElements.updated.textContent = "อัปเดตจากข้อมูลสำรอง";
      weatherElements.max.textContent = `${Math.round(daily.temperature_2m_max[0])}°`;
      weatherElements.min.textContent = `${Math.round(daily.temperature_2m_min[0])}°`;
      weatherElements.feels.textContent = `${Math.round(current.temperature_2m)}°C`;
      weatherElements.humidity.textContent = `${Math.round(current.relative_humidity_2m)}%`;
      weatherElements.wind.textContent = `${Math.round(current.wind_speed_10m)} กม./ชม.`;
      weatherElements.rain.textContent = `${Number(current.precipitation).toFixed(1)} มม.`;
      return;
    }
    const subdistrict = data.locality || data.localityInfo?.administrative?.find((item) => item.order === 8)?.name;
    const district = data.city || data.localityInfo?.administrative?.find((item) => item.order === 7)?.name;
    const province = data.principalSubdivision || data.localityInfo?.administrative?.find((item) => item.order === 4)?.name;
    const isBangkok = province?.includes("กรุงเทพ") || data.city === "กรุงเทพมหานคร";
    const bangkokDistrict = data.localityInfo?.administrative?.find((item) => item.order === 7)?.name;
    const parts = [
      subdistrict && `${isBangkok ? "" : "ตำบล"}${subdistrict.replace(/^(ตำบล|แขวง)/, isBangkok ? "แขวง" : "")}`,
      isBangkok && bangkokDistrict ? bangkokDistrict : district && `อำเภอ${district.replace(/^อำเภอ/, "")}`,
      province && (isBangkok ? "กรุงเทพมหานคร" : `จังหวัด${province.replace(/^จังหวัด/, "")}`),
    ].filter(Boolean);

    return parts.length ? parts.join(" ") : "พื้นที่ปัจจุบัน";
  } catch (error) {
    return "พื้นที่ปัจจุบัน";
  }
}

async function loadWeather(location, source = "ตำแหน่งของคุณ") {
  if (!weatherElements.dashboard) return;
  setWeatherLoading(true);
  weatherElements.label.textContent = "ตำแหน่งปัจจุบัน";
  weatherElements.location.textContent = location.label;
  weatherElements.source.textContent = source;
  weatherElements.note.textContent = "";

  const params = new URLSearchParams({ lat: location.latitude, lon: location.longitude });
  const provinceMatch = location.label.match(/จังหวัด(.+)$/);
  if (provinceMatch) params.set("province", provinceMatch[1]);
  if (location.label.includes("กรุงเทพมหานคร")) params.set("province", "กรุงเทพมหานคร");

  try {
    const response = await fetch(`/api/weather?${params}`);
    if (!response.ok) throw new Error("Weather request failed");
    const data = await response.json();
    const current = data.hourly?.WeatherForcasts?.[0]?.forecasts?.[0] || data.hourly?.WeatherForecasts?.[0]?.forecasts?.[0];
    const today = data.daily?.WeatherForecasts?.[0]?.forecasts?.[0]
      || data.daily?.weather_forecast?.locations?.[0]?.forecasts?.[0];
    const currentData = current?.data || today?.data || {};
    const dailyData = today?.data || {};
    if (!data.observed && !current?.data && !today?.data) throw new Error("Unexpected TMD response");
    const observed = data.observed;
    const temperature = observed?.temperature ?? Number(currentData.tc);
    const humidity = observed?.humidity ?? Number(currentData.rh);
    const wind = observed?.wind ?? Number(currentData.ws10m) * 3.6;
    const rain = observed?.rain ?? Number(currentData.rain || dailyData.rain || 0);
    const [condition, icon, weatherTheme] = getWeatherDescription(Number(currentData.cond || 3));
    const updatedTime = current?.time ? new Date(current.time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "ล่าสุด";
    const windDirection = Math.round(Number(currentData.wd10m || 0));

    weatherElements.icon.textContent = icon;
    weatherElements.dashboard.className = `weather-dashboard weather-state-${weatherTheme}`;
    weatherElements.temperature.textContent = Math.round(temperature);
    weatherElements.condition.textContent = condition;
    weatherElements.updated.textContent = `อัปเดต ${updatedTime} น. · ลมทิศ ${windDirection}°`;
    weatherElements.max.textContent = Number.isFinite(Number(dailyData.tc_max)) ? `${Math.round(Number(dailyData.tc_max))}°` : "--";
    weatherElements.min.textContent = Number.isFinite(Number(dailyData.tc_min)) ? `${Math.round(Number(dailyData.tc_min))}°` : "--";
    weatherElements.feels.textContent = `${Math.round(temperature)}°C`;
    weatherElements.humidity.textContent = `${Math.round(humidity)}%`;
    weatherElements.wind.textContent = `${Math.round(wind)} กม./ชม.`;
    weatherElements.rain.textContent = `${Number(rain).toFixed(1)} มม.`;
  } catch (error) {
    weatherElements.condition.textContent = "ไม่สามารถโหลดข้อมูลได้";
    weatherElements.updated.textContent = "ลองกดอัปเดตอีกครั้งในภายหลัง";
    weatherElements.note.textContent = "การเชื่อมต่อข้อมูลสภาพอากาศไม่สำเร็จ กรุณาตรวจสอบอินเทอร์เน็ต";
  } finally {
    setWeatherLoading(false);
  }
}

function loadWeatherForUser() {
  if (!navigator.geolocation) {
    loadWeather(weatherConfig.bangkok, "ตำแหน่งของคุณ");
    return;
  }

  navigator.geolocation.getCurrentPosition(
    async ({ coords }) => {
      const label = await getLocationName(coords.latitude, coords.longitude);
      loadWeather({ latitude: coords.latitude, longitude: coords.longitude, label }, "ตำแหน่งของคุณ");
    },
    () => loadWeather(weatherConfig.bangkok, "ตำแหน่งของคุณ"),
    { enableHighAccuracy: false, timeout: 8000, maximumAge: 900000 }
  );
}

loadWeatherForUser();
setInterval(loadWeatherForUser, 10 * 60 * 1000);
