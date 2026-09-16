const calendarStyles = document.createElement("link");
calendarStyles.rel = "stylesheet";
calendarStyles.href = "assets/css/schedule-consultation.css";
document.head.appendChild(calendarStyles);

const preferredDateField = document.getElementById("preferredDate")?.closest(".field");
const preferredTimeField = document.getElementById("preferredTime")?.closest(".field");
const alternateDateField = document.getElementById("alternateDate")?.closest(".field");

if (preferredDateField && preferredTimeField) {
  const calendarWrap = document.createElement("div");
  calendarWrap.className = "field full shoot-calendar-field";
  calendarWrap.innerHTML = `
    <label>Preferred shoot date and time <span class="req">*</span></label>
    <div class="booking-calendar">
      <div class="calendar-panel">
        <div class="calendar-head">
          <button class="month-button" id="previous-month" type="button" aria-label="Previous month">‹</button>
          <div class="calendar-title" id="calendar-title"></div>
          <button class="month-button" id="next-month" type="button" aria-label="Next month">›</button>
        </div>
        <div class="calendar-weekdays" aria-hidden="true">
          <span>Sun</span><span>Mon</span><span>Tue</span><span>Wed</span><span>Thu</span><span>Fri</span><span>Sat</span>
        </div>
        <div class="calendar-days" id="calendar-days" role="grid" aria-label="Shoot dates"></div>
        <div class="calendar-legend">
          <span class="legend-item"><span class="legend-dot available"></span>Available</span>
          <span class="legend-item"><span class="legend-dot selected"></span>Selected</span>
          <span class="legend-item"><span class="legend-dot"></span>Unavailable</span>
        </div>
      </div>
      <div class="time-panel">
        <div class="time-title">Available times</div>
        <div class="time-date" id="time-date">Select a date</div>
        <p class="time-help">Choose your preferred shoot start time. We’ll confirm the final schedule, scope, and flight conditions before the booking is finalized.</p>
        <div class="time-slots" id="time-slots"></div>
        <div class="selection-summary" id="selection-summary"></div>
      </div>
    </div>
    <input type="hidden" id="calendarPreferredDate" name="preferredDate" required />
    <input type="hidden" id="calendarPreferredTime" name="preferredTime" required />`;
  preferredDateField.parentNode.insertBefore(calendarWrap, preferredDateField);
  preferredDateField.remove();
  preferredTimeField.remove();
  if (alternateDateField) alternateDateField.remove();
}

const calendarTitle = document.getElementById("calendar-title"),
  calendarDays = document.getElementById("calendar-days"),
  timeDate = document.getElementById("time-date"),
  timeSlots = document.getElementById("time-slots"),
  selectedDateInput = document.getElementById("calendarPreferredDate"),
  selectedTimeInput = document.getElementById("calendarPreferredTime"),
  selectionSummary = document.getElementById("selection-summary");

const hawaiiToday = new Date(
  new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }),
);
hawaiiToday.setHours(0, 0, 0, 0);
const blockedThrough = new Date(2026, 11, 15);
blockedThrough.setHours(23, 59, 59, 999);
let visibleMonth = new Date(hawaiiToday.getFullYear(), hawaiiToday.getMonth(), 1),
  selectedDate = "";

const dateKey = (date) =>
  `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const dateLabel = (date) =>
  date.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

function renderCalendar() {
  if (!calendarTitle || !calendarDays) return;
  calendarTitle.textContent = visibleMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  calendarDays.innerHTML = "";
  const first = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1),
    start = new Date(first);
  start.setDate(1 - first.getDay());
  for (let i = 0; i < 42; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = dateKey(day),
      past = day < hawaiiToday,
      manuallyBlocked = day <= blockedThrough,
      other = day.getMonth() !== visibleMonth.getMonth(),
      button = document.createElement("button");
    button.type = "button";
    button.className = `calendar-day${other ? " other" : ""}${past || manuallyBlocked ? " blocked" : ""}${key === selectedDate ? " selected" : ""}${key === dateKey(hawaiiToday) ? " today" : ""}`;
    button.textContent = day.getDate();
    button.disabled = past || manuallyBlocked || other;
    button.setAttribute("aria-label", `${dateLabel(day)}${button.disabled ? ", unavailable" : ", available"}`);
    if (!button.disabled) button.addEventListener("click", () => selectDay(day));
    calendarDays.appendChild(button);
  }
}

async function selectDay(day) {
  selectedDate = dateKey(day);
  selectedDateInput.value = selectedDate;
  selectedTimeInput.value = "";
  selectionSummary.classList.remove("visible");
  renderCalendar();
  timeDate.textContent = dateLabel(new Date(`${selectedDate}T12:00:00Z`));
  timeSlots.innerHTML = '<span class="hint">Loading availability…</span>';
  let availability = {};
  try {
    const response = await fetch(`/api/availability?date=${encodeURIComponent(selectedDate)}`);
    if (response.ok) {
      const data = await response.json();
      (data.slots || []).forEach((slot) => (availability[slot.time] = slot.available !== false));
    }
  } catch (error) {}
  renderTimes(availability);
}

function renderTimes(availability) {
  timeSlots.innerHTML = "";
  for (let hour = 8; hour <= 16; hour++) {
    const value = `${String(hour).padStart(2, "0")}:00`,
      label = new Date(`2000-01-01T${value}:00`).toLocaleTimeString("en-US", {
        hour: "numeric",
        minute: "2-digit",
      }),
      button = document.createElement("button");
    button.type = "button";
    button.className = "time-slot";
    button.textContent = label;
    button.disabled = availability[value] === false;
    button.setAttribute("aria-label", `${label}${button.disabled ? ", unavailable" : ", available"}`);
    button.addEventListener("click", () => selectTime(value, label, button));
    timeSlots.appendChild(button);
  }
}

function selectTime(value, label, button) {
  selectedTimeInput.value = value;
  timeSlots.querySelectorAll(".time-slot").forEach((slot) => slot.classList.remove("selected"));
  button.classList.add("selected");
  selectionSummary.textContent = `${timeDate.textContent} at ${label} HST · preferred shoot start time`;
  selectionSummary.classList.add("visible");
}

document.getElementById("previous-month")?.addEventListener("click", () => {
  const previous = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() - 1, 1);
  if (previous >= new Date(hawaiiToday.getFullYear(), hawaiiToday.getMonth(), 1)) {
    visibleMonth = previous;
    renderCalendar();
  }
});
document.getElementById("next-month")?.addEventListener("click", () => {
  visibleMonth = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 1);
  renderCalendar();
});
renderCalendar();

const form = document.getElementById("shoot-form"),
  statusEl = document.getElementById("form-status"),
  submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedDateInput?.value || !selectedTimeInput?.value) {
    statusEl.className = "form-status error";
    statusEl.textContent = "Please select an available shoot date and time.";
    document.querySelector(".booking-calendar")?.scrollIntoView({ behavior: "smooth", block: "center" });
    return;
  }
  statusEl.className = "form-status";
  statusEl.textContent = "Sending…";
  submitBtn.disabled = true;
  const fd = new FormData(form);
  const payload = {
    name: String(fd.get("name") || "").trim(),
    business: String(fd.get("business") || "").trim(),
    email: String(fd.get("email") || "").trim(),
    phone: String(fd.get("phone") || "").trim(),
    projectType: String(fd.get("projectType") || "").trim(),
    location: String(fd.get("location") || "").trim(),
    preferredDate: String(fd.get("preferredDate") || "").trim(),
    preferredTime: String(fd.get("preferredTime") || "").trim(),
    alternateDate: "",
    frequency: String(fd.get("frequency") || "").trim(),
    services: fd.getAll("services"),
    addons: fd.getAll("addons"),
    description: String(fd.get("description") || "").trim(),
    accessDetails: String(fd.get("accessDetails") || "").trim(),
    questions: String(fd.get("questions") || "").trim(),
    budget: String(fd.get("budget") || "").trim(),
    source: "website-book-shoot",
  };
  try {
    const response = await fetch("/api/shoot-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "Unable to submit your request.");
    form.reset();
    selectedDate = "";
    selectionSummary?.classList.remove("visible");
    if (timeDate) timeDate.textContent = "Select a date";
    if (timeSlots) timeSlots.innerHTML = "";
    renderCalendar();
    statusEl.className = "form-status success";
    statusEl.textContent = "Thank you. Your shoot request has been received. We’ll follow up to confirm availability and pricing.";
  } catch (error) {
    statusEl.className = "form-status error";
    statusEl.textContent = error.message || "Something went wrong. Please try again.";
  } finally {
    submitBtn.disabled = false;
  }
});
