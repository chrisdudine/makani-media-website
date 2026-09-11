const form = document.getElementById("shoot-form"),
  statusEl = document.getElementById("form-status"),
  submitBtn = form.querySelector('button[type="submit"]');
form.addEventListener("submit", async (event) => {
  event.preventDefault();
  statusEl.className = "form-status";
  statusEl.textContent = "Sending…";
  submitBtn.disabled = true;
  const fd = new FormData(form);
  const preferredDate = String(fd.get("preferredDate") || "").trim();
  const preferredTime = String(fd.get("preferredTime") || "").trim();
  const payload = {
    name: String(fd.get("name") || "").trim(),
    business: String(fd.get("business") || "").trim(),
    email: String(fd.get("email") || "").trim(),
    phone: String(fd.get("phone") || "").trim(),
    projectType: String(fd.get("projectType") || "").trim(),
    location: String(fd.get("location") || "").trim(),
    preferredDate,
    preferredTime,
    alternateDate: String(fd.get("alternateDate") || "").trim(),
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
