const selectedDateInput = document.getElementById("preferredDate"),
  selectedTimeInput = document.getElementById("preferredTime");
const bookingCalendar = window.initBookingCalendar({
  dateInput: "preferredDate",
  timeInput: "preferredTime",
  summary: "60-minute consultation",
});
const form = document.getElementById("consultation-form");
const statusEl = document.getElementById("form-status");
const submitBtn = form.querySelector('button[type="submit"]');
const meetingTypeInputs = form.querySelectorAll('input[name="meetingType"]');
const addressWrap = document.getElementById("in-person-address");
const addressInput = document.getElementById("meetingLocation");
const zoomNote = document.getElementById("zoom-note");

function updateMeetingDetails() {
  const selected = form.querySelector(
    'input[name="meetingType"]:checked',
  )?.value;
  const inPerson = selected === "in-person";
  addressWrap.hidden = !inPerson;
  addressInput.required = inPerson;
  zoomNote.hidden = selected !== "zoom";
  if (!inPerson) addressInput.value = "";
}

meetingTypeInputs.forEach((input) =>
  input.addEventListener("change", updateMeetingDetails),
);

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
  const selectedMeetingType = form.querySelector(
    'input[name="meetingType"]:checked',
  )?.value;
  if (!selectedMeetingType) {
    statusEl.className = "form-status error";
    statusEl.textContent = "Please choose an in-person or Zoom consultation.";
    document
      .getElementById("meeting-method")
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
    meetingType: String(fd.get("meetingType") || "").trim(),
    meetingLocation: String(fd.get("meetingLocation") || "").trim(),
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
    if (result.url) {
      const checkoutUrl = new URL(result.url);
      if (checkoutUrl.origin !== "https://checkout.stripe.com")
        throw new Error(
          "Unexpected payment destination. Please contact Makani Media.",
        );
      statusEl.textContent = "Opening secure payment…";
      window.location.assign(checkoutUrl.href);
      return;
    }
    form.reset();
    bookingCalendar.reset();
    updateMeetingDetails();
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
