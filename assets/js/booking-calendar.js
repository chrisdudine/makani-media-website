window.initBookingCalendar = function ({
  dateInput = "preferredDate",
  timeInput = "preferredTime",
  summary = "60-minute consultation",
} = {}) {
  const calendarTitle = document.getElementById("calendar-title"),
    calendarDays = document.getElementById("calendar-days"),
    timeDate = document.getElementById("time-date"),
    timeSlots = document.getElementById("time-slots"),
    selectedDateInput = document.getElementById(dateInput),
    selectedTimeInput = document.getElementById(timeInput),
    selectionSummary = document.getElementById("selection-summary");
  const hawaiiToday = new Date(
    new Date().toLocaleString("en-US", { timeZone: "Pacific/Honolulu" }),
  );
  hawaiiToday.setHours(0, 0, 0, 0);
  const blockedThrough = new Date(2026, 11, 15);
  blockedThrough.setHours(23, 59, 59, 999);
  let requestId = 0;
  const monthAvailability = new Map();
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
        past = day < hawaiiToday,
        manuallyBlocked =
          day <= blockedThrough || monthAvailability.get(key) === false,
        other = day.getMonth() !== visibleMonth.getMonth(),
        button = document.createElement("button");
      button.type = "button";
      button.className = `calendar-day${other ? " other" : ""}${past || manuallyBlocked ? " blocked" : ""}${key === selectedDate ? " selected" : ""}${key === dateKey(hawaiiToday) ? " today" : ""}`;
      button.textContent = day.getDate();
      button.disabled = past || manuallyBlocked || other;
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
    const thisRequest = ++requestId;
    const requestedDate = selectedDate;
    let availability = {};
    try {
      const response = await fetch(
        `/api/availability?date=${encodeURIComponent(selectedDate)}`,
      );
      if (!response.ok) throw new Error("Availability unavailable");
      const data = await response.json();
      if (!Array.isArray(data.slots))
        throw new Error("Availability incomplete");
      data.slots.forEach(
        (slot) => (availability[slot.time] = slot.available === true),
      );
      if (thisRequest !== requestId || requestedDate !== selectedDate) return;
      monthAvailability.set(
        requestedDate,
        data.slots.some((slot) => slot.available === true),
      );
      renderCalendar();
    } catch (error) {
      if (thisRequest !== requestId) return;
      timeSlots.innerHTML =
        '<span class="hint">Availability could not be loaded. Please select the date again to retry.</span>';
      return;
    }
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
      button.disabled = availability[value] !== true;
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
    selectionSummary.textContent = `${timeDate.textContent} at ${label} HST · ${summary}`;
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
      loadMonth();
    }
  });
  document.getElementById("next-month").addEventListener("click", () => {
    visibleMonth = new Date(
      visibleMonth.getFullYear(),
      visibleMonth.getMonth() + 1,
      1,
    );
    renderCalendar();
    loadMonth();
  });
  renderCalendar();

  async function loadMonth() {
    const month = dateKey(visibleMonth).slice(0, 7);
    try {
      const response = await fetch(`/api/availability?month=${month}`, {
        cache: "no-store",
      });
      if (!response.ok) return;
      const data = await response.json();
      for (const [date, slots] of Object.entries(data.days || {}))
        monthAvailability.set(
          date,
          slots.some((slot) => slot.available === true),
        );
      if (dateKey(visibleMonth).startsWith(month)) renderCalendar();
    } catch {}
  }
  loadMonth();
  return {
    reset() {
      requestId++;
      selectedDate = "";
      selectedDateInput.value = "";
      selectedTimeInput.value = "";
      selectionSummary.classList.remove("visible");
      timeDate.textContent = "Select a date";
      timeSlots.innerHTML = "";
      monthAvailability.clear();
      renderCalendar();
      loadMonth();
    },
  };
};
