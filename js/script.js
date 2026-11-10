function formatQualityDate(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return "วันที่ไม่ระบุ";
  const year = Number(match[1]);
  const date = new Date(Date.UTC(year > 2400 ? year - 543 : year, Number(match[2]) - 1, Number(match[3])));
  return new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(date);
}

function formatQualityTime(value) {
  const match = String(value || "").match(/T?(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]} น.` : "เวลาไม่ระบุ";
}

function getQualityRowValues(properties) {
  return {
    time: formatQualityTime(properties.time),
    location: properties.location,
    waterColor: properties["สีของน้ำ"],
    smell: properties["กลิ่น"],
    sediment: properties["ตะกอน"],
    ph: properties["ค่าความเป็นกรด-ด่าง"],
    oil: properties["คราบน้ำมัน"],
    ecoli: properties["E.Coli"],
    coliform: properties.Coliform ?? properties.Colifrom,
    note: properties["หมายเหตุ"],
  };
}

function formatQualityCellValue(value) {
  return value === null || value === undefined || value === "" ? "—" : String(value);
}

function getQualityCellTone(column, rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "") return null;
  const text = String(rawValue).trim();
  if (!text || text === "—" || text === "-") return null;

  if (column === "ph") {
    const num = Number(text);
    if (!Number.isFinite(num)) return null;
    if (num >= 6.5 && num <= 8.5) return "ok";
    if (num >= 6.0 && num <= 9.0) return "warn";
    return "danger";
  }

  if (column === "ecoli") {
    if (/ไม่พบ|ไม่มี|< ?1/i.test(text)) return "ok";
    const num = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(num)) return null;
    if (num <= 100) return "ok";
    if (num <= 1000) return "warn";
    return "danger";
  }

  if (column === "coliform") {
    if (/ไม่พบ|ไม่มี|< ?1/i.test(text)) return "ok";
    const num = Number(text.replace(/,/g, ""));
    if (!Number.isFinite(num)) return null;
    if (num <= 1000) return "ok";
    if (num <= 5000) return "warn";
    return "danger";
  }

  if (column === "oil") {
    if (/ไม่พบ|ไม่มี|ปกติ/.test(text)) return "ok";
    return "warn";
  }

  return null;
}

const qualityColumnLabels = {
  time: "เวลา",
  location: "จุดเก็บตัวอย่าง",
  waterColor: "สีของน้ำ",
  smell: "กลิ่น",
  sediment: "ตะกอน",
  ph: "pH",
  oil: "คราบน้ำมัน",
  ecoli: "E. coli",
  coliform: "Coliform",
  note: "หมายเหตุ",
};

const qualitySortIconSource = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAYAAADgdz34AAABNUlEQVR4AdyUvWoCQRSFd5M2eYOQpEuZHwiEQKqUySOkyKOlyCNoaSWIYKGWdiq+gba6fgdHmL3u+rMzIij37J173TkfM8zORXLk3+kBWZbdoFu7UHpv6NX2bb3PCv6Y9I9sNGg0gTySS2MfQNnkgfujtg0SApgB6KNLVC+DhADwTaY8vlCKBHki5yIUkKRp2sXxGxVCggEY+xCVuQMRBSBXt5J3xloNaRXRALIDMkJDjdeKClib+vnMAHws9+jOX2Lo2G5RDcMWkGdylLCAH1wzpPslCiQH4Ij1MNc5FkSf/gt1UOQAcnIQ3S8Lam3ZNblybADkBES3pCBzat33V+RKUQiQk4Nou1Q+6FFFpQCZOcgH409kQwfi1zZtvRWgl4F0UFtjX/TGaOL3isY7AUWTDuktAQAA//8acUEnAAAABklEQVQDAChOTjGWxC7EAAAAAElFTkSuQmCC";
let activeQualitySortColumn = "time";
let qualitySortDirection = "ascending";

const qualityValueCollator = new Intl.Collator("th", { numeric: true, sensitivity: "base" });
let bacteriaChart;
let activeBacteriaMetric = "ecoli";

if (typeof Chart !== "undefined" && typeof ChartZoom !== "undefined") {
  Chart.register(ChartZoom);
}

const bacteriaMetricLabels = {
  ecoli: "E. coli",
  coliform: "Coliform",
};

const bacteriaResetZoomBtn = document.getElementById("bacteriaResetZoom");
bacteriaResetZoomBtn?.addEventListener("click", () => {
  bacteriaChart?.resetZoom();
  bacteriaResetZoomBtn.hidden = true;
});

function renderBacteriaTrend(surveys) {
  const canvas = document.getElementById("bacteriaChart");
  const status = document.getElementById("bacteriaChartStatus");
  if (!canvas || !status) return;
  if (typeof Chart === "undefined") {
    status.textContent = "ไม่สามารถโหลดกราฟแนวโน้ม E. coli ได้";
    return;
  }

  const locations = [...new Set(surveys.flatMap((survey) =>
    survey.features.map((feature) => feature.properties?.location).filter(Boolean)
  ))];
  const colors = ["#0071e3", "#ff9500", "#34c759", "#af52de", "#ff3b30", "#32ade6", "#5856d6"];
  const chartFontFamily = '-apple-system, BlinkMacSystemFont, "SF Pro Text", "Sukhumvit Set", "Sarabun", sans-serif';
  const datasets = locations.map((location, index) => ({
    label: location,
    data: surveys.map((survey) => {
      const sample = survey.features.find((feature) => feature.properties?.location === location);
      const properties = sample?.properties || {};
      const sourceValue = activeBacteriaMetric === "ecoli"
        ? properties["E.Coli"]
        : properties.Coliform ?? properties.Colifrom;
      const value = Number(sourceValue);
      return Number.isFinite(value) ? value : null;
    }),
    borderColor: colors[index % colors.length],
    backgroundColor: colors[index % colors.length],
    borderWidth: 2.2,
    pointHitRadius: 14,
    pointRadius: 3.5,
    pointHoverRadius: 5.5,
    pointBackgroundColor: "#ffffff",
    pointBorderWidth: 2,
    tension: 0.3,
    spanGaps: false,
  }));

  bacteriaChart?.destroy();
  if (bacteriaResetZoomBtn) bacteriaResetZoomBtn.hidden = true;
  const chartDescription = `กราฟแนวโน้มผลตรวจ ${bacteriaMetricLabels[activeBacteriaMetric]} แยกตามจุดเก็บตัวอย่าง`;
  canvas.setAttribute("aria-label", chartDescription);
  canvas.textContent = chartDescription;
  bacteriaChart = new Chart(canvas, {
    type: "line",
    data: {
      labels: surveys.map((survey) => formatQualityDate(survey.date)),
      datasets,
    },
    options: {
      maintainAspectRatio: false,
      responsive: true,
      interaction: { axis: "x", intersect: true, mode: "index" },
      plugins: {
        zoom: {
          limits: { x: { min: "original", max: "original", minRange: 2 } },
          pan: { enabled: false },
          zoom: {
            mode: "x",
            pinch: { enabled: true },
            wheel: { enabled: true, modifierKey: "ctrl" },
            onZoomComplete: ({ chart }) => {
              if (bacteriaResetZoomBtn) {
                bacteriaResetZoomBtn.hidden = !(chart.isZoomedOrPanned?.() ?? true);
              }
            },
          },
        },
        legend: {
          position: "bottom",
          labels: {
            boxHeight: 8,
            boxWidth: 8,
            color: "#1d1d1f",
            font: { family: chartFontFamily, size: 12, weight: "500" },
            padding: 18,
            pointStyle: "circle",
            usePointStyle: true,
          },
        },
        tooltip: {
          axis: "x",
          backgroundColor: "rgba(255, 255, 255, 0.96)",
          titleColor: "#1d1d1f",
          bodyColor: "#3a3a3c",
          borderColor: "rgba(0, 0, 0, 0.08)",
          borderWidth: 1,
          cornerRadius: 12,
          padding: 12,
          caretPadding: 10,
          intersect: true,
          mode: "index",
          titleFont: { family: chartFontFamily, size: 13, weight: "600" },
          bodyFont: { family: chartFontFamily, size: 12 },
          callbacks: {
            label: (context) => `${context.dataset.label}: ${bacteriaMetricLabels[activeBacteriaMetric]} ${new Intl.NumberFormat("th-TH").format(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          title: { display: true, text: "วันที่สำรวจ", color: "#6e6e73", font: { family: chartFontFamily, size: 12, weight: "500" } },
          grid: { display: false },
          border: { color: "rgba(0, 0, 0, 0.08)" },
          ticks: { color: "#6e6e73", font: { family: chartFontFamily, size: 11 }, maxRotation: 45, minRotation: 0 },
        },
        y: {
          beginAtZero: true,
          title: { display: true, text: bacteriaMetricLabels[activeBacteriaMetric], color: "#6e6e73", font: { family: chartFontFamily, size: 12, weight: "500" } },
          border: { display: false },
          ticks: { color: "#6e6e73", font: { family: chartFontFamily, size: 11 }, callback: (value) => new Intl.NumberFormat("th-TH").format(value) },
          grid: { color: "rgba(0, 0, 0, 0.05)" },
        },
      },
    },
  });
  status.textContent = `ผลตรวจ ${bacteriaMetricLabels[activeBacteriaMetric]} · ${surveys.length} วัน · ${locations.length} จุดตรวจ`;
}

function selectBacteriaMetric(metric) {
  if (!bacteriaMetricLabels[metric]) return;
  activeBacteriaMetric = metric;
  document.querySelectorAll(".bacteria-chart-mode").forEach((button) => {
    button.setAttribute("aria-pressed", String(button.dataset.bacteriaMetric === metric));
  });
  renderBacteriaTrend(waterQualitySurveys);
}

function updateQualitySortButtons() {
  document.querySelectorAll(".quality-column-sort").forEach((button) => {
    const column = button.dataset.qualityColumn;
    const isActive = activeQualitySortColumn === column;
    const directionLabel = qualitySortDirection === "ascending" ? "A-Z" : "Z-A";
    button.setAttribute("aria-pressed", String(isActive));
    button.setAttribute("aria-label", isActive ? `เรียง ${directionLabel} ตาม${qualityColumnLabels[column]}` : `เรียงตาม${qualityColumnLabels[column]}`);
    button.title = button.getAttribute("aria-label");
    const icon = button.querySelector(".quality-sort-icon");
    icon.style.setProperty("--quality-sort-icon-mask", `url("${qualitySortIconSource}")`);
    icon.classList.add("quality-sort-icon-image");
    icon.textContent = "";
    button.closest("th").setAttribute("aria-sort", isActive ? qualitySortDirection : "none");
  });
}

function sortQualityByColumn(column) {
  if (activeQualitySortColumn === column) {
    qualitySortDirection = qualitySortDirection === "ascending" ? "descending" : "ascending";
  } else {
    activeQualitySortColumn = column;
    qualitySortDirection = "ascending";
  }
  renderSelectedWaterQuality();
}

function renderSelectedWaterQuality() {
  const dateSelect = document.getElementById("qualityDateSelect");
  const tableBody = document.getElementById("qualityTableBody");
  const status = document.getElementById("qualityStatus");
  const survey = waterQualitySurveys.find((item) => item.layer === dateSelect?.value);
  if (!survey || !tableBody || !status) return;

  const sortedFeatures = [...survey.features];
  if (activeQualitySortColumn) {
    sortedFeatures.sort((first, second) => {
      const firstValue = getQualityRowValues(first.properties || {})[activeQualitySortColumn];
      const secondValue = getQualityRowValues(second.properties || {})[activeQualitySortColumn];
      const firstMissing = firstValue === null || firstValue === undefined || firstValue === "";
      const secondMissing = secondValue === null || secondValue === undefined || secondValue === "";
      if (firstMissing || secondMissing) return firstMissing === secondMissing ? 0 : firstMissing ? 1 : -1;
      const comparison = qualityValueCollator.compare(String(firstValue), String(secondValue));
      return qualitySortDirection === "ascending" ? comparison : -comparison;
    });
  }
  updateQualitySortButtons();

  const rows = sortedFeatures.map((feature) => {
    const values = getQualityRowValues(feature.properties || {});
    const row = document.createElement("tr");
    Object.entries(values).forEach(([column, value]) => {
      const cell = document.createElement("td");
      const formatted = formatQualityCellValue(value);
      const tone = getQualityCellTone(column, value);
      if (tone && formatted !== "—") {
        const pill = document.createElement("span");
        pill.className = `quality-pill quality-pill-${tone}`;
        pill.textContent = formatted;
        cell.append(pill);
      } else {
        cell.textContent = formatted;
      }
      if (formatted !== "—") cell.title = formatted;
      row.append(cell);
    });
    return row;
  });

  if (!rows.length) {
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 10;
    cell.textContent = "ไม่พบข้อมูลที่ตรงกับตัวกรอง";
    row.append(cell);
    rows.push(row);
  }

  tableBody.replaceChildren(...rows);
  status.textContent = `${survey.features.length} จุดตรวจ · ${formatQualityDate(survey.date)}`;
}

let waterQualitySurveys = [];

async function loadWaterQuality() {
  const dateSelect = document.getElementById("qualityDateSelect");
  const tableBody = document.getElementById("qualityTableBody");
  const status = document.getElementById("qualityStatus");
  if (!dateSelect || !tableBody || !status) return;

  try {
    const response = await fetch("/api/water-quality");
    if (!response.ok) throw new Error("Water quality request failed");
    const data = await response.json();
    waterQualitySurveys = data.surveys || [];
    if (!waterQualitySurveys.length) throw new Error("No water quality records");
    document.querySelectorAll(".bacteria-chart-mode").forEach((button) => {
      button.disabled = false;
      button.addEventListener("click", () => selectBacteriaMetric(button.dataset.bacteriaMetric));
    });
    renderBacteriaTrend(waterQualitySurveys);
    dateSelect.replaceChildren(...waterQualitySurveys.map((survey) => {
      const option = document.createElement("option");
      option.value = survey.layer;
      option.textContent = formatQualityDate(survey.date);
      return option;
    }));
    dateSelect.disabled = false;
    dateSelect.addEventListener("change", renderSelectedWaterQuality);
    document.querySelectorAll(".quality-column-sort").forEach((button) => {
      button.addEventListener("click", () => {
        sortQualityByColumn(button.dataset.qualityColumn);
      });
    });
    renderSelectedWaterQuality();
  } catch (error) {
    status.textContent = "ไม่สามารถโหลดข้อมูลคุณภาพน้ำได้ กรุณาลองใหม่ภายหลัง";
    const bacteriaStatus = document.getElementById("bacteriaChartStatus");
    if (bacteriaStatus) bacteriaStatus.textContent = "ไม่สามารถโหลดแนวโน้ม E. coli ได้";
    const row = document.createElement("tr");
    const cell = document.createElement("td");
    cell.colSpan = 10;
    cell.textContent = status.textContent;
    row.append(cell);
    tableBody.replaceChildren(row);
  }
}

loadWaterQuality();

// Mobile nav toggle
const navToggle = document.getElementById("navToggle");
const mainNav = document.querySelector(".main-nav");
navToggle?.addEventListener("click", () => {
  const isExpanded = navToggle.getAttribute("aria-expanded") === "true";
  navToggle.setAttribute("aria-expanded", String(!isExpanded));
  navToggle.setAttribute("aria-label", isExpanded ? "เปิดเมนู" : "ปิดเมนู");
  mainNav?.classList.toggle("open", !isExpanded);
});

// Footer year
const yearEl = document.getElementById("year");
if (yearEl) yearEl.textContent = new Date().getFullYear() + 543; // พ.ศ.

// macOS Quick Look Lightbox for media cards
const quicklookModal = document.getElementById("quicklookModal");
const quicklookImage = document.getElementById("quicklookImage");
const quicklookTitle = document.getElementById("quicklookTitle");
const quicklookOpen = document.getElementById("quicklookOpen");
const quicklookClose = document.getElementById("quicklookClose");

function openQuickLook(src, title, href) {
  if (!quicklookModal || !quicklookImage || !quicklookTitle) return;
  quicklookImage.src = src;
  quicklookImage.alt = title;
  quicklookTitle.textContent = title;
  if (quicklookOpen) {
    quicklookOpen.href = href || src;
    quicklookOpen.hidden = false;
  }
  quicklookModal.showModal();
}

if (quicklookModal) {
  document.querySelectorAll(".media-card").forEach((card) => {
    const img = card.querySelector("img");
    const caption = card.querySelector("span");
    if (!img) return;
    if (card.tagName !== "A") {
      card.setAttribute("role", "button");
      card.setAttribute("tabindex", "0");
    }
    const triggerPreview = (event) => {
      event.preventDefault();
      const title = caption?.textContent?.replace(/\s+/g, " ").trim() || img.alt || "พรีวิวรูปภาพ";
      const href = card.getAttribute("href") || img.src;
      openQuickLook(img.src, title, href);
    };
    card.addEventListener("click", triggerPreview);
    card.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        triggerPreview(event);
      }
    });
  });

  quicklookClose?.addEventListener("click", () => quicklookModal.close());
  quicklookModal.addEventListener("click", (event) => {
    if (event.target === quicklookModal) quicklookModal.close();
  });
}

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

function formatFeelsLike(apparentTemperature, temperature, humidity, windSpeedKmh) {
  const apparentValue = Number(apparentTemperature);
  if (apparentTemperature !== null && apparentTemperature !== undefined && Number.isFinite(apparentValue)) {
    return `${Math.round(apparentValue)}°C`;
  }

  const values = [temperature, humidity, windSpeedKmh];
  if (values.some((value) => value === null || value === undefined || !Number.isFinite(Number(value)))) {
    return "--°C";
  }

  const temperatureValue = Number(temperature);
  const vaporPressure = (Number(humidity) / 100) * 6.105
    * Math.exp((17.27 * temperatureValue) / (237.7 + temperatureValue));
  const windSpeedMs = Number(windSpeedKmh) / 3.6;
  const feelsLike = temperatureValue + 0.33 * vaporPressure - 0.70 * windSpeedMs - 4;
  return `${Math.round(feelsLike)}°C`;
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
      weatherElements.feels.textContent = formatFeelsLike(
        current.apparent_temperature,
        current.temperature_2m,
        current.relative_humidity_2m,
        current.wind_speed_10m
      );
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
    if (data.fallback) {
      const current = data.fallback.current;
      const daily = data.fallback.daily;
      const [condition, icon, weatherTheme] = getWeatherDescription(Number(current.weather_code));
      weatherElements.icon.textContent = icon;
      weatherElements.dashboard.className = `weather-dashboard weather-state-${weatherTheme}`;
      weatherElements.temperature.textContent = Math.round(current.temperature_2m);
      weatherElements.condition.textContent = condition;
      weatherElements.updated.textContent = "อัปเดตล่าสุดจากข้อมูลสำรอง";
      weatherElements.max.textContent = `${Math.round(daily.temperature_2m_max[0])}°`;
      weatherElements.min.textContent = `${Math.round(daily.temperature_2m_min[0])}°`;
      weatherElements.feels.textContent = formatFeelsLike(
        current.apparent_temperature,
        current.temperature_2m,
        current.relative_humidity_2m,
        current.wind_speed_10m
      );
      weatherElements.humidity.textContent = `${Math.round(current.relative_humidity_2m)}%`;
      weatherElements.wind.textContent = `${Math.round(current.wind_speed_10m)} กม./ชม.`;
      weatherElements.rain.textContent = `${Number(current.precipitation).toFixed(1)} มม.`;
      return;
    }
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
    const feelsLike = formatFeelsLike(null, temperature, humidity, wind);
    const rain = observed?.rain ?? Number(currentData.rain || dailyData.rain || 0);
    const [condition, icon, weatherTheme] = getWeatherDescription(Number(currentData.cond || 3));
    const updatedTime = observed?.observedAt
      ? new Date(observed.observedAt.replace(" ", "T") + "+07:00").toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" })
      : current?.time ? new Date(current.time).toLocaleTimeString("th-TH", { hour: "2-digit", minute: "2-digit" }) : "ล่าสุด";
    const windDirection = Math.round(Number(observed?.windDirection ?? currentData.wd10m ?? 0));

    weatherElements.icon.textContent = icon;
    weatherElements.dashboard.className = `weather-dashboard weather-state-${weatherTheme}`;
    weatherElements.temperature.textContent = Math.round(temperature);
    weatherElements.condition.textContent = condition;
    weatherElements.updated.textContent = `อัปเดต ${updatedTime} น. · ลมทิศ ${windDirection}°`;
    const maxTemperature = observed?.max ?? Number(dailyData.tc_max);
    const minTemperature = observed?.min ?? Number(dailyData.tc_min);
    weatherElements.max.textContent = Number.isFinite(Number(maxTemperature)) ? `${Math.round(Number(maxTemperature))}°` : "--";
    weatherElements.min.textContent = Number.isFinite(Number(minTemperature)) ? `${Math.round(Number(minTemperature))}°` : "--";
    weatherElements.feels.textContent = feelsLike;
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

if (weatherElements.dashboard) {
  loadWeatherForUser();
  setInterval(loadWeatherForUser, 10 * 60 * 1000);
}
