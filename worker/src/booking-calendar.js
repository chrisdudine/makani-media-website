const clean = (value) => (typeof value === "string" ? value.trim() : "");

async function accessToken(env) {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  if (!response.ok)
    throw new Error(`Google token request failed (${response.status})`);
  const data = await response.json();
  if (!data.access_token) throw new Error("Google access token missing");
  return data.access_token;
}

export async function createBookingCalendarEvent(
  env,
  { kind, body, start, end, projectId },
) {
  if (env.GOOGLE_CALENDAR_ENABLED !== "true") return null;
  if (
    !env.GOOGLE_CALENDAR_ID ||
    !env.GOOGLE_CLIENT_ID ||
    !env.GOOGLE_CLIENT_SECRET ||
    !env.GOOGLE_REFRESH_TOKEN
  ) {
    throw new Error("Google Calendar is not fully configured");
  }

  const customerName = clean(body.name) || "Website customer";
  const isConsultation = kind === "consultation";
  const summary = isConsultation
    ? `Makani Media Consultation — ${customerName}`
    : `Makani Media Shoot — ${customerName}`;
  const description = [
    `Project ID: ${projectId}`,
    `Customer: ${customerName}`,
    `Email: ${clean(body.email)}`,
    `Phone: ${clean(body.phone) || "Not provided"}`,
    `Business: ${clean(body.business) || "Not provided"}`,
    `Project type: ${clean(body.projectType) || "Not provided"}`,
    isConsultation
      ? `Meeting type: ${clean(body.meetingType) === "in-person" ? "In person" : "Zoom"}`
      : "",
    isConsultation && clean(body.meetingType) === "in-person"
      ? `Meeting address: ${clean(body.meetingLocation)}`
      : "",
    isConsultation && clean(body.meetingType) === "zoom"
      ? "Zoom link: Include in the customer confirmation email"
      : "",
    !isConsultation && clean(body.package)
      ? `Package: ${clean(body.package)}`
      : "",
    clean(body.description) ? `Description: ${clean(body.description)}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const event = {
    summary,
    description,
    location:
      isConsultation && clean(body.meetingType) === "zoom"
        ? "Zoom"
        : clean(body.meetingLocation) || clean(body.location),
    start: { dateTime: start.toISOString(), timeZone: "Pacific/Honolulu" },
    end: { dateTime: end.toISOString(), timeZone: "Pacific/Honolulu" },
  };

  const response = await fetch(
    `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(env.GOOGLE_CALENDAR_ID)}/events?sendUpdates=none`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${await accessToken(env)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(event),
    },
  );

  if (!response.ok) {
    const detail = await response.text();
    console.error(
      "Google Calendar event creation failed",
      response.status,
      detail.slice(0, 500),
    );
    throw new Error(
      `Google Calendar event creation failed (${response.status})`,
    );
  }
  return response.json();
}
