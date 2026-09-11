const json = (data, status = 200, headers = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", ...headers },
  });

const text = (value) => (typeof value === "string" ? value.trim() : "");
const list = (value) =>
  Array.isArray(value)
    ? value
        .filter((v) => typeof v === "string")
        .map((v) => v.trim())
        .filter(Boolean)
    : [];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^(0[8-9]|1[0-6]):00$/;
const ACTIVE_CONSULTATION_STATUSES = new Set(["pending", "confirmed", "paid"]);

const hawaiiDateTime = (date, time) => new Date(`${date}T${time}:00-10:00`);
const addMinutes = (date, minutes) => new Date(date.getTime() + minutes * 60_000);
const overlaps = (startA, endA, startB, endB) => startA < endB && endA > startB;
const isSaturday = (date) => hawaiiDateTime(date, "12:00").getUTCDay() === 6;

async function getAvailability(env, date) {
  if (!DATE_RE.test(date)) return null;

  const slots = Array.from({ length: 9 }, (_, index) => {
    const hour = index + 8;
    return { time: `${String(hour).padStart(2, "0")}:00`, available: !isSaturday(date) };
  });

  if (isSaturday(date)) return slots;

  const dayStart = hawaiiDateTime(date, "00:00");
  const dayEnd = addMinutes(dayStart, 24 * 60);
  const queryStart = addMinutes(dayStart, -120).toISOString();
  const queryEnd = dayEnd.toISOString();

  const consultationResult = await env.DB.prepare(
    `SELECT start_time, end_time, buffer_end_time, status
     FROM consultations
     WHERE start_time < ? AND COALESCE(buffer_end_time, end_time) > ?`,
  )
    .bind(queryEnd, queryStart)
    .all();

  const shootResult = await env.DB.prepare(
    `SELECT start_time, end_time
     FROM shoot_bookings
     WHERE status = 'confirmed' AND start_time < ? AND end_time > ?`,
  )
    .bind(queryEnd, dayStart.toISOString())
    .all();

  const calendarResult = await env.DB.prepare(
    `SELECT start_time, end_time
     FROM calendar_blocks
     WHERE start_time < ? AND end_time > ?`,
  )
    .bind(queryEnd, dayStart.toISOString())
    .all();

  const blocks = [];
  for (const row of consultationResult.results || []) {
    if (!ACTIVE_CONSULTATION_STATUSES.has(row.status)) continue;
    const start = new Date(row.start_time);
    const end = new Date(row.buffer_end_time || row.end_time);
    if (!Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf())) blocks.push([start, end]);
  }
  for (const row of [...(shootResult.results || []), ...(calendarResult.results || [])]) {
    const start = new Date(row.start_time);
    const end = new Date(row.end_time);
    if (!Number.isNaN(start.valueOf()) && !Number.isNaN(end.valueOf())) blocks.push([start, end]);
  }

  return slots.map((slot) => {
    const slotStart = hawaiiDateTime(date, slot.time);
    const slotEnd = addMinutes(slotStart, 60);
    return {
      ...slot,
      available: slot.available && !blocks.some(([start, end]) => overlaps(slotStart, slotEnd, start, end)),
    };
  });
}

async function upsertContact(env, body, now) {
  const contactId = crypto.randomUUID();
  const contact = await env.DB.prepare(
    `INSERT INTO contacts (id, name, business, email, phone, source, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(email) DO UPDATE SET
       name = excluded.name,
       business = CASE WHEN excluded.business <> '' THEN excluded.business ELSE contacts.business END,
       phone = CASE WHEN excluded.phone <> '' THEN excluded.phone ELSE contacts.phone END,
       updated_at = excluded.updated_at
     RETURNING id`,
  )
    .bind(
      contactId,
      text(body.name),
      text(body.business),
      text(body.email).toLowerCase(),
      text(body.phone),
      text(body.source) || "website",
      now,
      now,
    )
    .first();
  return contact?.id || contactId;
}

async function createProject(env, body, contactId, now, status = "new") {
  const projectId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO projects (
       id, contact_id, project_type, location, preferred_date, frequency,
       services_json, addons_json, budget, description, questions, status,
       raw_submission_json, ai_status, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  )
    .bind(
      projectId,
      contactId,
      text(body.projectType),
      text(body.location),
      text(body.preferredDate),
      text(body.frequency),
      JSON.stringify(list(body.services)),
      JSON.stringify(list(body.addons)),
      text(body.budget),
      text(body.description),
      text(body.questions),
      status,
      JSON.stringify(body),
      now,
      now,
    )
    .run();
  return projectId;
}

const validContactPayload = (body) => {
  const name = text(body.name);
  const email = text(body.email).toLowerCase();
  const description = text(body.description);
  if (!name || !email || !description)
    return "Name, email, and project description are required.";
  if (!/^\S+@\S+\.\S+$/.test(email)) return "Please enter a valid email address.";
  if (name.length > 160 || email.length > 320 || description.length > 5000)
    return "One or more fields are too long.";
  return "";
};

const authorizedInternalRequest = (request, env) => {
  const expected = text(env.ADMIN_API_KEY);
  const supplied = text(request.headers.get("X-Admin-Key"));
  return Boolean(expected && supplied && expected === supplied);
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type,X-Admin-Key",
        },
      });
    }

    if (!env.DB) return json({ error: "Database binding is not configured." }, 500);

    if (request.method === "GET" && url.pathname === "/api/availability") {
      const date = text(url.searchParams.get("date"));
      if (!DATE_RE.test(date)) return json({ error: "A valid date is required." }, 400);
      try {
        const slots = await getAvailability(env, date);
        return json({ date, timezone: "Pacific/Honolulu", slots });
      } catch (error) {
        console.error("Availability lookup failed", error);
        return json({ error: "Availability is temporarily unavailable." }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/consultation") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON request." }, 400);
      }

      const validationError = validContactPayload(body);
      if (validationError) return json({ error: validationError }, 400);

      const preferredDate = text(body.preferredDate);
      const preferredTime = text(body.preferredTime);
      if (!DATE_RE.test(preferredDate) || !TIME_RE.test(preferredTime))
        return json({ error: "Please select a valid consultation date and time." }, 400);
      if (isSaturday(preferredDate))
        return json({ error: "Consultations are not available on Saturdays." }, 400);

      try {
        const slots = await getAvailability(env, preferredDate);
        const selected = slots.find((slot) => slot.time === preferredTime);
        if (!selected?.available)
          return json({ error: "That time is no longer available. Please choose another time." }, 409);

        const now = new Date().toISOString();
        const contactId = await upsertContact(env, body, now);
        const projectId = await createProject(env, body, contactId, now, "consultation-request");
        const consultationId = crypto.randomUUID();
        const start = hawaiiDateTime(preferredDate, preferredTime);
        const end = addMinutes(start, 60);
        const bufferEnd = addMinutes(start, 120);

        await env.DB.prepare(
          `INSERT INTO consultations (
             id, contact_id, project_id, start_time, end_time, buffer_end_time,
             timezone, meeting_type, meeting_location, status, price_cents,
             payment_required, created_at, updated_at
           ) VALUES (?, ?, ?, ?, ?, ?, 'Pacific/Honolulu', ?, ?, 'pending', 0, 0, ?, ?)`,
        )
          .bind(
            consultationId,
            contactId,
            projectId,
            start.toISOString(),
            end.toISOString(),
            bufferEnd.toISOString(),
            text(body.meetingType) || "phone",
            text(body.meetingLocation) || text(body.location),
            now,
            now,
          )
          .run();

        return json({ success: true, projectId, consultationId }, 201);
      } catch (error) {
        console.error("Consultation submission failed", error);
        return json({ error: "We could not save your request. Please try again." }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/shoot-request") {
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON request." }, 400);
      }
      const validationError = validContactPayload(body);
      if (validationError) return json({ error: validationError }, 400);

      try {
        const now = new Date().toISOString();
        const contactId = await upsertContact(env, body, now);
        const projectId = await createProject(env, body, contactId, now, "shoot-request");
        return json({ success: true, projectId }, 201);
      } catch (error) {
        console.error("Shoot request failed", error);
        return json({ error: "We could not save your request. Please try again." }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/internal/shoot-booking") {
      if (!authorizedInternalRequest(request, env)) return json({ error: "Unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON request." }, 400);
      }
      const start = new Date(text(body.startTime));
      const end = new Date(text(body.endTime));
      if (Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start)
        return json({ error: "Valid startTime and endTime are required." }, 400);
      const now = new Date().toISOString();
      const id = crypto.randomUUID();
      try {
        await env.DB.prepare(
          `INSERT INTO shoot_bookings (
             id, project_id, start_time, end_time, timezone, status,
             google_calendar_event_id, created_at, updated_at
           ) VALUES (?, ?, ?, ?, 'Pacific/Honolulu', 'confirmed', ?, ?, ?)`,
        )
          .bind(
            id,
            text(body.projectId) || null,
            start.toISOString(),
            end.toISOString(),
            text(body.googleCalendarEventId),
            now,
            now,
          )
          .run();
        return json({ success: true, bookingId: id }, 201);
      } catch (error) {
        console.error("Shoot confirmation failed", error);
        return json({ error: "Could not confirm shoot booking." }, 500);
      }
    }

    if (request.method === "POST" && url.pathname === "/api/internal/calendar-blocks") {
      if (!authorizedInternalRequest(request, env)) return json({ error: "Unauthorized" }, 401);
      let body;
      try {
        body = await request.json();
      } catch {
        return json({ error: "Invalid JSON request." }, 400);
      }
      const blocks = Array.isArray(body.blocks) ? body.blocks : [];
      const now = new Date().toISOString();
      try {
        for (const block of blocks) {
          const start = new Date(text(block.startTime));
          const end = new Date(text(block.endTime));
          const externalId = text(block.externalId);
          if (!externalId || Number.isNaN(start.valueOf()) || Number.isNaN(end.valueOf()) || end <= start)
            continue;
          await env.DB.prepare(
            `INSERT INTO calendar_blocks (
               id, source, external_id, title, start_time, end_time, created_at, updated_at
             ) VALUES (?, 'google-calendar', ?, ?, ?, ?, ?, ?)
             ON CONFLICT(source, external_id) DO UPDATE SET
               title = excluded.title,
               start_time = excluded.start_time,
               end_time = excluded.end_time,
               updated_at = excluded.updated_at`,
          )
            .bind(
              crypto.randomUUID(),
              externalId,
              text(block.title),
              start.toISOString(),
              end.toISOString(),
              now,
              now,
            )
            .run();
        }
        return json({ success: true, synced: blocks.length });
      } catch (error) {
        console.error("Calendar block sync failed", error);
        return json({ error: "Could not sync calendar blocks." }, 500);
      }
    }

    return json({ error: "Not found" }, 404);
  },
};
