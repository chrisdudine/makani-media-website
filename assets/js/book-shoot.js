const calendarStyles = document.createElement("link");
calendarStyles.rel = "stylesheet";
calendarStyles.href = "assets/css/schedule-consultation.css";
document.head.appendChild(calendarStyles);

const preferredDateField = document
  .getElementById("preferredDate")
  ?.closest(".field");
const preferredTimeField = document
  .getElementById("preferredTime")
  ?.closest(".field");
const alternateDateField = document
  .getElementById("alternateDate")
  ?.closest(".field");

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

const selectedDateInput = document.getElementById("calendarPreferredDate"),
  selectedTimeInput = document.getElementById("calendarPreferredTime");
const bookingCalendar = window.initBookingCalendar({
  dateInput: "calendarPreferredDate",
  timeInput: "calendarPreferredTime",
  summary: "preferred shoot start time",
});
const form = document.getElementById("shoot-form"),
  statusEl = document.getElementById("form-status"),
  submitBtn = form.querySelector('button[type="submit"]');

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedDateInput?.value || !selectedTimeInput?.value) {
    statusEl.className = "form-status error";
    statusEl.textContent = "Please select an available shoot date and time.";
    document
      .querySelector(".booking-calendar")
      ?.scrollIntoView({ behavior: "smooth", block: "center" });
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
    package: String(fd.get("package") || "").trim(),
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
    if (!response.ok)
      throw new Error(result.error || "Unable to submit your request.");
    form.reset();
    bookingCalendar.reset();
    statusEl.className = "form-status success";
    statusEl.textContent =
      "Thank you. Your shoot request has been received. We’ll follow up to confirm availability and pricing.";
  } catch (error) {
    statusEl.className = "form-status error";
    statusEl.textContent =
      error.message || "Something went wrong. Please try again.";
  } finally {
    submitBtn.disabled = false;
  }
});
