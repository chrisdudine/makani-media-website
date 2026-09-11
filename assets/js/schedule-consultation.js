const calendarTitle = document.getElementById("calendar-title"),
  calendarDays = document.getElementById("calendar-days"),
  timeDate = document.getElementById("time-date"),
  timeSlots = document.getElementById("time-slots"),
  selectedDateInput = document.getElementById("preferredDate"),
  selectedTimeInput = document.getElementById("preferredTime"),
  selectionSummary = document.getElementById("selection-summary");
const hawaiiToday = new Date(
  new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }),
);
hawaiiToday.setHours(0, 0, 0, 0);
let visibleMonth = new Date(
    hawaiiToday.getFullYear(),
    hawaiiToday.getMonth(),
    1,
  ),
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
  calendarTitle.textContent = visibleMonth.toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
  });
  calendarDays.innerHTML = "";
  const first = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth(),
      1,
    ),
    start = new Date(first);
  start.setDate(1 - first.getDay());
  for (let i = 0; i < 42; i++) {
    const day = new Date(start);
    day.setDate(start.getDate() + i);
    const key = dateKey(day),
      weekend = day.getDay() === 0 || day.getDay() === 6,
      past = day < hawaiiToday,
      other = day.getMonth() !== visibleMonth.getMonth(),
      button = document.createElement("button");
    button.type = "button";
    button.className = `calendar-day${other ? " other" : ""}${weekend || past ? " blocked" : ""}${key === selectedDate ? " selected" : ""}${key === dateKey(hawaiiToday) ? " today" : ""}`;
    button.textContent = day.getDate();
    button.disabled = weekend || past || other;
    button.setAttribute(
      "aria-label",
      `${dateLabel(day)}${button.disabled ? ", unavailable" : ", available"}`,
    );
    if (!button.disabled)
      button.addEventListener("click", () => selectDay(day));
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
    const response = await fetch(
      `/api/availability?date=${encodeURIComponent(selectedDate)}`,
    );
    if (response.ok) {
      const data = await response.json();
      (data.slots || []).forEach(
        (slot) => (availability[slot.time] = slot.available !== false),
      );
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
    button.setAttribute(
      "aria-label",
      `${label}${button.disabled ? ", unavailable" : ", available"}`,
    );
    button.addEventListener("click", () => selectTime(value, label, button));
    timeSlots.appendChild(button);
  }
}
function selectTime(value, label, button) {
  selectedTimeInput.value = value;
  timeSlots
    .querySelectorAll(".time-slot")
    .forEach((slot) => slot.classList.remove("selected"));
  button.classList.add("selected");
  selectionSummary.textContent = `${timeDate.textContent} at ${label} HST · 60-minute consultation`;
  selectionSummary.classList.add("visible");
}
document.getElementById("previous-month").addEventListener("click", () => {
  const previous = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() - 1,
    1,
  );
  if (
    previous >= new Date(hawaiiToday.getFullYear(), hawaiiToday.getMonth(), 1)
  ) {
    visibleMonth = previous;
    renderCalendar();
  }
});
document.getElementById("next-month").addEventListener("click", () => {
  visibleMonth = new Date(
    visibleMonth.getFullYear(),
    visibleMonth.getMonth() + 1,
    1,
  );
  renderCalendar();
});
renderCalendar();
const form = document.getElementById("consultation-form");
const statusEl = document.getElementById("form-status");
const submitBtn = form.querySelector('button[type="submit"]');
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!selectedDateInput.value || !selectedTimeInput.value) {
    statusEl.className = "form-status error";
    statusEl.textContent =
      "Please select an available consultation date and time.";
    document
      .querySelector(".booking-calendar")
      .scrollIntoView({ behavior: "smooth", block: "center" });
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
    frequency: String(fd.get("frequency") || "").trim(),
    services: fd.getAll("services"),
    addons: fd.getAll("addons"),
    description: String(fd.get("description") || "").trim(),
    questions: String(fd.get("questions") || "").trim(),
    budget: String(fd.get("budget") || "").trim(),
    source: "website-consultation",
  };
  try {
    const response = await fetch("/api/consultation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok)
      throw new Error(result.error || "Unable to submit your request.");
    form.reset();
    selectedDate = "";
    selectionSummary.classList.remove("visible");
    timeDate.textContent = "Select a weekday";
    timeSlots.innerHTML = "";
    renderCalendar();
    statusEl.className = "form-status success";
    statusEl.textContent =
      "Thank you. Your consultation request has been received.";
  } catch (error) {
    statusEl.className = "form-status error";
    statusEl.textContent =
      error.message || "Something went wrong. Please try again.";
  } finally {
    submitBtn.disabled = false;
  }
});
