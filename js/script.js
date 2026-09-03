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
