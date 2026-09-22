import api from "./index.js";
import { deliverBookingEmails } from "./booking-email.js";
import { createBookingCalendarEvent } from "./booking-calendar.js";
import { handleLeadEngineRequest } from "./gemini.js";

const clean = (value) => (typeof value === "string" ? value.trim() : "");
const hawaiiDateTime = (date, time) => new Date(`${date}T${time}:00-10:00`);
const addMinutes = (date, minutes) =>
  new Date(date.getTime() + minutes * 60_000);

function diagnosticResponse(env) {
  const present = (value) => Boolean(value);
  const checks = {
    DB: present(env.DB),
    EMAIL: present(env.EMAIL),
    GOOGLE_CLIENT_ID: present(env.GOOGLE_CLIENT_ID),
    GOOGLE_CLIENT_SECRET: present(env.GOOGLE_CLIENT_SECRET),
    GOOGLE_REFRESH_TOKEN: present(env.GOOGLE_REFRESH_TOKEN),
    GOOGLE_CALENDAR_ENABLED: env.GOOGLE_CALENDAR_ENABLED === "true",
    GOOGLE_CALENDAR_ID: present(env.GOOGLE_CALENDAR_ID),
    BOOKING_EMAIL_FROM: present(env.BOOKING_EMAIL_FROM),
    BOOKING_NOTIFICATION_EMAIL: present(env.BOOKING_NOTIFICATION_EMAIL),
  };

  return new Response(
    JSON.stringify({
      ok: Object.values(checks).every(Boolean),
      checks,
      calendarIdMatchesBusinessAccount:
        env.GOOGLE_CALENDAR_ID === "makanimediamaui@gmail.com",
      emailFromConfigured:
        env.BOOKING_EMAIL_FROM === "bookings@mail.makani-media.com",
      notificationEmailConfigured:
        env.BOOKING_NOTIFICATION_EMAIL === "makanimediamaui@gmail.com",
    }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": "no-store",
        "Access-Control-Allow-Origin": "*",
      },
    },
  );
}

async function automateSuccessfulBooking(env, kind, body, result) {
  const projectId = clean(result.projectId);
  const start = hawaiiDateTime(
    clean(body.preferredDate),
    clean(body.preferredTime),
  );
  const end =
    kind === "shoot"
      ? hawaiiDateTime(clean(body.preferredDate), clean(body.preferredEndTime))
      : addMinutes(start, 60);
  if (!projectId || Number.isNaN(start.valueOf()))
    throw new Error("Booking automation received invalid booking data");

  let bookingId = clean(result.consultationId);
  let calendarEvent = null;

  if (kind === "shoot") {
    bookingId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO shoot_bookings (
         id, project_id, start_time, end_time, timezone, status,
         google_calendar_event_id, created_at, updated_at
       ) VALUES (?, ?, ?, ?, 'Pacific/Honolulu', 'confirmed', '', ?, ?)`,
    )
      .bind(
        bookingId,
        projectId,
        start.toISOString(),
        end.toISOString(),
        now,
        now,
      )
      .run();
  }

  try {
    calendarEvent = await createBookingCalendarEvent(env, {
      kind,
      body,
      start,
      end,
      projectId,
    });
    if (calendarEvent?.id) {
      if (kind === "consultation") {
        await env.DB.prepare(
          `UPDATE consultations SET google_calendar_event_id = ?, updated_at = ? WHERE id = ?`,
        )
          .bind(calendarEvent.id, new Date().toISOString(), bookingId)
          .run();
      } else {
        await env.DB.prepare(
          `UPDATE shoot_bookings SET google_calendar_event_id = ?, updated_at = ? WHERE id = ?`,
        )
          .bind(calendarEvent.id, new Date().toISOString(), bookingId)
          .run();
      }
    }
  } catch (error) {
    console.error("Booking calendar automation failed", error);
  }

  let emailSent = false;
  try {
    await deliverBookingEmails(env, { kind, body, projectId });
    emailSent = true;
  } catch (error) {
    console.error("Booking email automation failed", error);
  }

  return {
    bookingId,
    calendarEventCreated: Boolean(calendarEvent?.id),
    emailSent,
  };
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const leadEngineResponse = await handleLeadEngineRequest(request, env);
    if (leadEngineResponse) return leadEngineResponse;

    if (
      request.method === "GET" &&
      url.pathname === "/api/diagnostics/booking-config"
    ) {
      return diagnosticResponse(env);
    }

    const isConsultation =
      request.method === "POST" && url.pathname === "/api/consultation";
    const isShoot =
      request.method === "POST" && url.pathname === "/api/shoot-request";

    if (!isConsultation && !isShoot) return api.fetch(request, env, ctx);

    const copy = request.clone();
    const response = await api.fetch(request, env, ctx);
    if (response.status !== 201) return response;

    let body;
    let result;
    try {
      body = await copy.json();
      result = await response.clone().json();
    } catch (error) {
      console.error(
        "Booking automation could not parse successful request",
        error,
      );
      return response;
    }

    let automation = { calendarEventCreated: false, emailSent: false };
    try {
      automation = await automateSuccessfulBooking(
        env,
        isConsultation ? "consultation" : "shoot",
        body,
        result,
      );
    } catch (error) {
      console.error("Booking automation failed", error);
    }

    return new Response(JSON.stringify({ ...result, automation }), {
      status: 201,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Access-Control-Allow-Origin": "*",
      },
    });
  },
};
