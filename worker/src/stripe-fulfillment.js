import Stripe from "stripe";
import { sdk, reply, recipient } from "./stripe-checkout.js";
async function googleToken(env) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    body: new URLSearchParams({
      client_id: env.GOOGLE_CLIENT_ID,
      client_secret: env.GOOGLE_CLIENT_SECRET,
      refresh_token: env.GOOGLE_REFRESH_TOKEN,
      grant_type: "refresh_token",
    }),
  });
  const b = await r.json();
  if (!r.ok || !b.access_token) throw Error("CALENDAR_AUTH");
  return b.access_token;
}
async function fulfill(env, order, session, event) {
  const db = env.DB,
    body = JSON.parse(order.payload),
    now = new Date().toISOString();
  const proposedContact = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO contacts(id,name,email,source,created_at,updated_at,stripe_customer_id) VALUES(?,?,?,'stripe-test',?,?,?) ON CONFLICT(email) DO UPDATE SET updated_at=excluded.updated_at`,
    )
    .bind(
      proposedContact,
      "[STRIPE TEST] " + body.name,
      body.email,
      now,
      now,
      session.customer,
    )
    .run();
  const contact = await db
    .prepare("SELECT id FROM contacts WHERE email=?")
    .bind(body.email)
    .first();
  const ops = [
    db
      .prepare(
        `INSERT OR IGNORE INTO projects(id,contact_id,project_type,description,status,raw_submission_json,created_at,updated_at) VALUES(?,?,'stripe-test',?,'paid-test',?,?,?)`,
      )
      .bind(order.id, contact.id, body.description, order.payload, now, now),
  ];
  if (order.kind === "consultation")
    ops.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO consultations(id,contact_id,project_id,start_time,end_time,buffer_end_time,timezone,meeting_type,status,price_cents,payment_required,stripe_checkout_session_id,stripe_payment_intent_id,created_at,updated_at) VALUES(?,?,?,?,?,?,'Pacific/Honolulu','test','paid',?,1,?,?,?,?)`,
        )
        .bind(
          order.id,
          contact.id,
          order.id,
          order.start_time,
          order.end_time,
          order.block_end,
          order.amount,
          session.id,
          session.payment_intent,
          now,
          now,
        ),
    );
  else
    ops.push(
      db
        .prepare(
          `INSERT OR IGNORE INTO shoot_bookings(id,project_id,start_time,end_time,timezone,status,created_at,updated_at) VALUES(?,?,?,?,'Pacific/Honolulu','confirmed',?,?)`,
        )
        .bind(order.id, order.id, order.start_time, order.end_time, now, now),
    );
  ops.push(
    db
      .prepare(
        `UPDATE stripe_test_orders SET state='paid',contact_id=?,stripe_customer_id=?,payment_intent_id=?,invoice_id=?,event_id=?,signature_verified=1 WHERE id=?`,
      )
      .bind(
        contact.id,
        session.customer,
        session.payment_intent,
        session.invoice || null,
        event.id,
        order.id,
      ),
  );
  await db.batch(ops);
  const eventId = "m" + order.id.replaceAll("-", "");
  if (!order.calendar_id) {
    const url =
      "https://www.googleapis.com/calendar/v3/calendars/" +
      encodeURIComponent(env.GOOGLE_CALENDAR_ID) +
      "/events";
    const headers = {
      Authorization: "Bearer " + (await googleToken(env)),
      "Content-Type": "application/json",
    };
    const r = await fetch(url + "?sendUpdates=none", {
      method: "POST",
      headers,
      body: JSON.stringify({
        id: eventId,
        summary: `[STRIPE TEST — NO REAL APPOINTMENT] ${order.kind}`,
        description: `Sandbox booking ${order.id}. No real payment.`,
        start: { dateTime: order.start_time, timeZone: "Pacific/Honolulu" },
        end: { dateTime: order.end_time, timeZone: "Pacific/Honolulu" },
        extendedProperties: { private: { makaniTestOrder: order.id } },
      }),
    });
    if (r.status === 409) {
      const existing = await fetch(url + "/" + eventId, { headers });
      const data = await existing.json();
      if (
        !existing.ok ||
        data.extendedProperties?.private?.makaniTestOrder !== order.id
      )
        throw Error("CALENDAR_CONFLICT");
    } else if (!r.ok) throw Error("CALENDAR_WRITE");
    const table =
      order.kind === "consultation" ? "consultations" : "shoot_bookings";
    await db.batch([
      db
        .prepare("UPDATE stripe_test_orders SET calendar_id=? WHERE id=?")
        .bind(eventId, order.id),
      db
        .prepare(`UPDATE ${table} SET google_calendar_event_id=? WHERE id=?`)
        .bind(eventId, order.id),
    ]);
  }
  for (const kind of ["confirmation", "receipt"]) {
    const field = kind + "_id";
    if (order[field]) continue;
    const when = new Intl.DateTimeFormat("en-US", {
      timeZone: "Pacific/Honolulu",
      dateStyle: "full",
      timeStyle: "short",
    }).format(new Date(order.start_time));
    const text =
      kind === "confirmation"
        ? `TEST ONLY — Your Makani Media ${order.kind} sandbox booking is confirmed.\nBooking: ${order.id}\nStart: ${when} HST\nNo real appointment or charge.`
        : `TEST ONLY — PAID RECEIPT\nMakani Media ${order.kind}\nSimulated payment: $${(order.amount / 100).toFixed(2)} USD\nCheckout: ${session.id}\nPayment: ${session.payment_intent}\nInvoice: ${session.invoice || "pending"}\nBooking: ${order.id}\nNo money was charged. Tax treatment remains under review.`;
    const result = await env.EMAIL.send({
      from: env.BOOKING_EMAIL_FROM,
      to: body.email,
      replyTo: recipient,
      subject: `[STRIPE TEST] ${kind === "confirmation" ? "Booking confirmation" : "Separate paid receipt"} — ${order.id.slice(0, 8)}`,
      text,
    });
    if (!result?.messageId) throw Error("EMAIL_ACK_MISSING");
    await db
      .prepare(`UPDATE stripe_test_orders SET ${field}=? WHERE id=?`)
      .bind(result.messageId, order.id)
      .run();
  }
}
export async function webhook(request, env) {
  let event, stripe;
  try {
    stripe = sdk(env);
  } catch {
    return reply({ error: "Test credentials unavailable" }, 503);
  }
  try {
    event = await stripe.webhooks.constructEventAsync(
      await request.text(),
      request.headers.get("stripe-signature"),
      env.STRIPE_WEBHOOK_SECRET,
      300,
      Stripe.createSubtleCryptoProvider(),
    );
  } catch {
    return reply({ error: "Invalid Stripe signature" }, 400);
  }
  return processVerifiedEvent(event, env, stripe);
}

async function processVerifiedEvent(event, env, stripe) {
  if (event.livemode !== false)
    return reply({ error: "Live events rejected" }, 400);
  const session = event.data.object,
    id = session.metadata?.makani_test_order;
  if (!id) return reply({ received: true, ignored: true });
  let order = await env.DB.prepare(
    "SELECT * FROM stripe_test_orders WHERE id=?",
  )
    .bind(id)
    .first();
  if (!order || order.session_id !== session.id)
    return reply({ error: "Unknown checkout" }, 409);
  await env.DB.prepare(
    "INSERT OR IGNORE INTO stripe_test_events(id,type,order_id,received_at) VALUES(?,?,?,?)",
  )
    .bind(event.id, event.type, id, new Date().toISOString())
    .run();
  if (
    [
      "checkout.session.expired",
      "checkout.session.async_payment_failed",
    ].includes(event.type)
  ) {
    await env.DB.prepare(
      "UPDATE stripe_test_orders SET state='expired' WHERE id=? AND state='pending'",
    )
      .bind(id)
      .run();
    return reply({ received: true });
  }
  if (
    ![
      "checkout.session.completed",
      "checkout.session.async_payment_succeeded",
    ].includes(event.type) ||
    session.payment_status !== "paid"
  )
    return reply({ received: true, unpaid: true });
  const fresh = await stripe.checkout.sessions.retrieve(session.id);
  if (
    fresh.livemode !== false ||
    fresh.payment_status !== "paid" ||
    fresh.amount_total !== order.amount ||
    fresh.currency !== "usd" ||
    fresh.client_reference_id !== id
  )
    return reply({ error: "Payment verification failed" }, 409);
  const lease = await env.DB.prepare(
    "UPDATE stripe_test_orders SET lease_until=? WHERE id=? AND lease_until<?",
  )
    .bind(Date.now() + 120000, id, Date.now())
    .run();
  if (!lease.meta.changes) return reply({ error: "Processing; retry" }, 503);
  try {
    order = await env.DB.prepare("SELECT * FROM stripe_test_orders WHERE id=?")
      .bind(id)
      .first();
    if (order.calendar_id && order.confirmation_id && order.receipt_id)
      return reply({ received: true, duplicate: true });
    await fulfill(env, order, fresh, event);
    await env.DB.prepare(
      "UPDATE stripe_test_orders SET last_error='' WHERE id=?",
    )
      .bind(id)
      .run();
    return reply({ received: true });
  } catch (e) {
    const code = [
      "CALENDAR_AUTH",
      "CALENDAR_CONFLICT",
      "CALENDAR_WRITE",
      "EMAIL_ACK_MISSING",
    ].includes(e.message)
      ? e.message
      : "FULFILLMENT_FAILED";
    await env.DB.prepare(
      "UPDATE stripe_test_orders SET last_error=? WHERE id=?",
    )
      .bind(code, id)
      .run();
    return reply(
      { error: "Fulfillment incomplete; retry", checkpoint: code },
      503,
    );
  } finally {
    await env.DB.prepare(
      "UPDATE stripe_test_orders SET lease_until=0 WHERE id=?",
    )
      .bind(id)
      .run();
  }
}
export async function verifyCalendar(env, id) {
  const r = await fetch(
    "https://www.googleapis.com/calendar/v3/calendars/" +
      encodeURIComponent(env.GOOGLE_CALENDAR_ID) +
      "/events/" +
      encodeURIComponent(id),
    { headers: { Authorization: "Bearer " + (await googleToken(env)) } },
  );
  const event = await r.json();
  return {
    status: r.status,
    id: event.id,
    booking: event.extendedProperties?.private?.makaniTestOrder,
  };
}

// Recovery is permitted only for an event already received through the signed webhook.
// Stripe's authenticated API is used to re-read it before processing; the success URL
// and browser-supplied data can never trigger fulfillment.
export async function retryPendingPayments(env) {
  const rows = await env.DB.prepare(
    `SELECT o.id, (SELECT e2.id FROM stripe_test_events e2
      WHERE e2.order_id=o.id AND e2.type IN ('checkout.session.completed','checkout.session.async_payment_succeeded')
      ORDER BY (e2.type = 'checkout.session.async_payment_succeeded') DESC, e2.received_at DESC LIMIT 1) AS event_id
    FROM stripe_test_orders o JOIN stripe_test_events e ON e.order_id=o.id
    WHERE (o.calendar_id IS NULL OR o.confirmation_id IS NULL OR o.receipt_id IS NULL)
      AND o.state <> 'test-complete' AND o.lease_until < ?
      AND e.type IN ('checkout.session.completed','checkout.session.async_payment_succeeded')
    GROUP BY o.id ORDER BY o.created_at LIMIT 10`,
  )
    .bind(Date.now())
    .all();
  const stripe = sdk(env);
  const results = [];
  for (const row of rows.results || []) {
    try {
      const event = await stripe.events.retrieve(row.event_id);
      if (event.data.object.metadata?.makani_test_order !== row.id) {
        results.push({ id: row.id, status: 409 });
        continue;
      }
      const response = await processVerifiedEvent(event, env, stripe);
      results.push({ id: row.id, status: response.status });
    } catch {
      results.push({ id: row.id, status: 503 });
    }
  }
  return results;
}
