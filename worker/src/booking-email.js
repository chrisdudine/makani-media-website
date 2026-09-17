import {
  buildShootEstimate,
  formatEstimateTotal,
  generateEstimatePdf,
} from "./estimate.js";

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

const formatHawaiiTime = (date, time) => {
  const instant = new Date(`${date}T${time}:00-10:00`);
  if (Number.isNaN(instant.valueOf())) return `${time} HST`;
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "Pacific/Honolulu",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(instant);
};

const list = (value) => {
  if (!Array.isArray(value)) return clean(value) || "Not provided";
  const items = value.map(clean).filter(Boolean);
  return items.length ? items.join(", ") : "Not provided";
};

export async function deliverBookingEmails(env, { kind, body, projectId }) {
  if (!env.EMAIL) throw new Error("EMAIL binding is not configured");

  const from = clean(env.BOOKING_EMAIL_FROM);
  if (!from) throw new Error("BOOKING_EMAIL_FROM is not configured");

  const customerEmail = clean(body.email).toLowerCase();
  const customerName = clean(body.name) || "there";
  const businessEmail =
    clean(env.BOOKING_NOTIFICATION_EMAIL) || "makanimediamaui@gmail.com";
  const dateTime = formatHawaiiDateTime(
    clean(body.preferredDate),
    clean(body.preferredTime),
  );
  const isConsultation = kind === "consultation";
  const bookingDateTime = isConsultation
    ? dateTime
    : `${dateTime}–${formatHawaiiTime(clean(body.preferredDate), clean(body.preferredEndTime))}`;
  const label = isConsultation ? "consultation" : "shoot request";
  const title = isConsultation ? "Consultation Booking" : "Shoot Request";
  const estimate = isConsultation ? null : buildShootEstimate(body);

  const customerText = isConsultation
    ? [
        `Hi ${customerName},`,
        "",
        `We received your Makani Media ${label} for ${bookingDateTime}.`,
        "Your requested time has been reserved while we process the booking.",
        "",
        "Thank you,",
        "Makani Media",
      ].join("\n")
    : [
        `Hi ${customerName},`,
        "",
        "Thank you for choosing Makani Media and for taking the time to tell us about your project. We truly appreciate the opportunity to work with you and help bring your vision to life.",
        "",
        `We’ve received your shoot request for ${bookingDateTime}. We’ll review your project details, location, requested services, and scheduling requirements, then follow up to confirm the final scope and availability.`,
        "",
        `Your preliminary estimate is ${formatEstimateTotal(estimate)}.`,
        "",
        "A detailed estimate is attached for your review. Please note that this is a preliminary estimate; final pricing may be adjusted after we review the location, airspace, permits, travel requirements, operating conditions, scheduling, and any custom services.",
        "",
        "Thank you again for considering Makani Media. We’re grateful for the opportunity to support your project and look forward to creating something exceptional with you.",
        "",
        "Warmly,",
        "",
        "Makani Media",
        "Drone + Visual Media",
        "Maui, Hawaiʻi",
        "makanimediamaui@gmail.com",
        "makani-media.com",
      ].join("\n");

  const customerHtml = isConsultation
    ? `<p>Hi ${escapeHtml(customerName)},</p><p>We received your Makani Media ${escapeHtml(label)} for <strong>${escapeHtml(bookingDateTime)}</strong>.</p><p>Your requested time has been reserved while we process the booking.</p><p>Thank you,<br>Makani Media</p>`
    : `<p>Hi ${escapeHtml(customerName)},</p><p>Thank you for choosing Makani Media and for taking the time to tell us about your project. We truly appreciate the opportunity to work with you and help bring your vision to life.</p><p>We’ve received your shoot request for <strong>${escapeHtml(bookingDateTime)}</strong>. We’ll review your project details, location, requested services, and scheduling requirements, then follow up to confirm the final scope and availability.</p><p><strong>Your preliminary estimate is ${escapeHtml(formatEstimateTotal(estimate))}.</strong></p><p>A detailed estimate is attached for your review. Please note that this is a preliminary estimate; final pricing may be adjusted after we review the location, airspace, permits, travel requirements, operating conditions, scheduling, and any custom services.</p><p>Thank you again for considering Makani Media. We’re grateful for the opportunity to support your project and look forward to creating something exceptional with you.</p><p>Warmly,</p><p><strong>Makani Media</strong><br>Drone + Visual Media<br>Maui, Hawaiʻi<br><a href="mailto:makanimediamaui@gmail.com">makanimediamaui@gmail.com</a><br><a href="https://makani-media.com">makani-media.com</a></p>`;

  const businessText = [
    `New ${title} — ${customerName}`,
    "",
    "APPOINTMENT",
    `Requested time: ${bookingDateTime}`,
    `Meeting / location: ${clean(body.meetingMethod) || clean(body.location) || clean(body.meetingLocation) || "Not provided"}`,
    "",
    "CUSTOMER",
    `Name: ${customerName}`,
    `Email: ${customerEmail}`,
    `Phone: ${clean(body.phone) || "Not provided"}`,
    `Business: ${clean(body.business) || "Not provided"}`,
    "",
    "PROJECT",
    `Package: ${clean(body.package) || "Not provided"}`,
    `Project type: ${clean(body.projectType) || "Not provided"}`,
    `Frequency: ${clean(body.frequency) || "Not provided"}`,
    `Services: ${list(body.services)}`,
    `Add-ons: ${list(body.addons)}`,
    `Budget: ${clean(body.budget) || "Not provided"}`,
    `Access details: ${clean(body.accessDetails) || "Not provided"}`,
    `Project ID: ${projectId}`,
    "",
    "DESCRIPTION",
    clean(body.description) || "Not provided",
    "",
    "QUESTIONS / NOTES",
    clean(body.questions) || "None",
    ...(estimate
      ? ["", `Preliminary estimate: ${formatEstimateTotal(estimate)}`]
      : []),
  ].join("\n");

  const customerAttachments = estimate
    ? [
        {
          filename: `makani-media-estimate-${projectId.slice(0, 8)}.pdf`,
          content: generateEstimatePdf(body, estimate, projectId),
          type: "application/pdf",
          disposition: "attachment",
        },
      ]
    : undefined;

  const results = await Promise.allSettled([
    env.EMAIL.send({
      to: customerEmail,
      from,
      replyTo: businessEmail,
      subject: `Makani Media — ${title}`,
      text: customerText,
      html: customerHtml,
      ...(customerAttachments ? { attachments: customerAttachments } : {}),
    }),
    env.EMAIL.send({
      to: businessEmail,
      from,
      replyTo: customerEmail,
      subject: `New ${title} — ${customerName} — ${clean(body.preferredDate)}`,
      text: businessText,
    }),
  ]);

  const failures = results.filter((result) => result.status === "rejected");
  if (failures.length) {
    for (const failure of failures)
      console.error("Booking email failed", failure.reason);
    throw new Error(`Failed to send ${failures.length} booking email(s)`);
  }

  return results.map((result) => result.value?.messageId).filter(Boolean);
}
