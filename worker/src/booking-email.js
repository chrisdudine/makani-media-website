const clean = (value) => (typeof value === "string" ? value.trim() : "");

const escapeHtml = (value) =>
  clean(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");

const formatHawaiiDateTime = (date, time) => {
  const instant = new Date(`${date}T${time}:00-10:00`);
  if (Number.isNaN(instant.valueOf())) return `${date} at ${time} HST`;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
};

export async function deliverBookingEmails(env, { kind, body, projectId }) {
  if (!env.EMAIL) throw new Error("EMAIL binding is not configured");

  const from = clean(env.BOOKING_EMAIL_FROM);
  if (!from) throw new Error("BOOKING_EMAIL_FROM is not configured");

  const customerEmail = clean(body.email).toLowerCase();
  const customerName = clean(body.name) || "there";
  const businessEmail = clean(env.BOOKING_NOTIFICATION_EMAIL) || "makanimediamaui@gmail.com";
  const dateTime = formatHawaiiDateTime(clean(body.preferredDate), clean(body.preferredTime));
  const isConsultation = kind === "consultation";
  const label = isConsultation ? "consultation" : "shoot request";
  const title = isConsultation ? "Consultation request received" : "Shoot request received";

  const customerText = [
    `Hi ${customerName},`,
    "",
    `We received your Makani Media ${label} for ${dateTime}.`,
    isConsultation
      ? "Your requested time has been reserved while we process the booking."
      : "We’ll review the project details and confirm the final schedule and scope with you.",
    "",
    "Thank you,",
    "Makani Media",
  ].join("\n");

  const customerHtml = `<p>Hi ${escapeHtml(customerName)},</p><p>We received your Makani Media ${escapeHtml(label)} for <strong>${escapeHtml(dateTime)}</strong>.</p><p>${isConsultation ? "Your requested time has been reserved while we process the booking." : "We’ll review the project details and confirm the final schedule and scope with you."}</p><p>Thank you,<br>Makani Media</p>`;

  const businessText = [
    title,
    `Name: ${customerName}`,
    `Email: ${customerEmail}`,
    `Phone: ${clean(body.phone) || "Not provided"}`,
    `Business: ${clean(body.business) || "Not provided"}`,
    `Requested time: ${dateTime}`,
    `Project type: ${clean(body.projectType) || "Not provided"}`,
    `Location: ${clean(body.location) || clean(body.meetingLocation) || "Not provided"}`,
    `Project ID: ${projectId}`,
    "",
    `Description: ${clean(body.description)}`,
    clean(body.questions) ? `Questions: ${clean(body.questions)}` : "",
  ].filter(Boolean).join("\n");

  const results = await Promise.allSettled([
    env.EMAIL.send({
      to: customerEmail,
      from,
      replyTo: businessEmail,
      subject: `Makani Media — ${title}`,
      text: customerText,
      html: customerHtml,
    }),
    env.EMAIL.send({
      to: businessEmail,
      from,
      replyTo: customerEmail,
      subject: `${title}: ${customerName}`,
      text: businessText,
    }),
  ]);

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    for (const failure of failures) console.error("Booking email failed", failure.reason);
    throw new Error(`Failed to send ${failures.length} booking email(s)`);
  }

  return results.map((result) => result.value?.messageId).filter(Boolean);
}
