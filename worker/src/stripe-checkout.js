import Stripe from "stripe";
import legacy from "./booking-wrapper.js";
import { buildShootEstimate } from "./estimate.js";
export const origin = "https://makani-media.com";
export const recipient = "makanimediamaui@gmail.com";
export const reply = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export function sdk(env) {
  if (!/^(sk|rk)_test_/.test(env.STRIPE_SECRET_KEY || ""))
    throw Error("TEST_KEY_REQUIRED");
  return new Stripe(env.STRIPE_SECRET_KEY, {
    apiVersion: "2026-07-29.dahlia",
    httpClient: Stripe.createFetchHttpClient(),
    maxNetworkRetries: 2,
  });
}
export function priceOrder(body) {
  if (body.kind === "consultation") return 10366;
  if (body.kind !== "shoot") throw Error("Select consultation or shoot");
  const services = [
    "Drone Photography",
    "Drone Video",
    "Ground Photography",
    "Ground Video",
    "360 Camera Footage",
    "Ocean / Underwater Media",
  ];
  const addons = [
    "Edited Photos",
    "30–45 Second Social Reel",
    "60–90 Second Cinematic Edit",
    "Vertical Social Version",
    "Raw Footage",
    "24-Hour Rush",
  ];
  if (
    (body.services || []).some((x) => !services.includes(x)) ||
    (body.addons || []).some((x) => !addons.includes(x))
  )
    throw Error("Unknown service or add-on");
  const estimate = buildShootEstimate({
    ...body,
    addons: [...new Set(body.addons || [])],
  });
  if (estimate.reviewItems.length)
    throw Error("Custom services require an approved quote before Checkout");
  return Math.round(estimate.subtotal * 100);
}
export function validate(body) {
  if (!body || typeof body !== "object") throw Error("Invalid request");
  if (
    typeof body.name !== "string" ||
    !body.name.trim() ||
    body.name.length > 160
  )
    throw Error("Name required");
  if (body.email !== recipient)
    throw Error("Sandbox emails must go to the Makani Media test mailbox");
  if (
    typeof body.description !== "string" ||
    !body.description.trim() ||
    body.description.length > 5000
  )
    throw Error("Project description required");
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(body.preferredDate) ||
    !/^(0[8-9]|1[0-6]):00$/.test(body.preferredTime)
  )
    throw Error("Invalid date or time");
  if (body.kind === "shoot" && !/^(09|1[0-7]):00$/.test(body.preferredEndTime))
    throw Error("Invalid shoot end time");
  const start = new Date(
    `${body.preferredDate}T${body.preferredTime}:00-10:00`,
  );
  const end =
    body.kind === "consultation"
      ? new Date(+start + 3600000)
      : new Date(`${body.preferredDate}T${body.preferredEndTime}:00-10:00`);
  if (
    !Number.isFinite(+start) ||
    !Number.isFinite(+end) ||
    start <= new Date() ||
    end <= start ||
    end - start > 8 * 3600000 ||
    new Date(body.preferredDate + "T12:00:00Z").toISOString().slice(0, 10) !==
      body.preferredDate
  )
    throw Error("Invalid booking time");
  for (const field of ["services", "addons"])
    if (body[field] && (!Array.isArray(body[field]) || body[field].length > 20))
      throw Error("Invalid selections");
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    blockEnd: new Date(
      +end + (body.kind === "consultation" ? 3600000 : 0),
    ).toISOString(),
    amount: priceOrder(body),
  };
}
export async function checkout(request, env) {
  if (!env.STRIPE_WEBHOOK_SECRET?.startsWith("whsec_"))
    return reply({ error: "Webhook secret missing" }, 503);
  const raw = await request.text();
  if (raw.length > 20000) return reply({ error: "Request too large" }, 413);
  let body, values;
  try {
    body = JSON.parse(raw);
    values = validate(body);
  } catch (e) {
    return reply({ error: e.message }, 400);
  }
  const availability = await legacy.fetch(
    new Request(`${origin}/api/availability?date=${body.preferredDate}`),
    env,
  );
  if (!availability.ok)
    return reply({ error: "Availability unavailable" }, 503);
  const slots = (await availability.json()).slots;
  for (
    let h = +new Date(values.start);
    h < +new Date(values.end);
    h += 3600000
  ) {
    const hour = new Date(h - 10 * 3600000).toISOString().slice(11, 16);
    if (!slots?.some((s) => s.time === hour && s.available))
      return reply({ error: "Time unavailable" }, 409);
  }
  const id = crypto.randomUUID(),
    now = new Date().toISOString(),
    expires = Math.floor(Date.now() / 1000) + 1860;
  const insert = await env.DB.prepare(
    `INSERT INTO stripe_test_orders(id,kind,payload,amount,start_time,end_time,block_end,expires_at,created_at)
 SELECT ?,?,?,?,?,?,?,?,? WHERE NOT EXISTS (SELECT 1 FROM stripe_test_orders WHERE start_time < ? AND block_end > ? AND (state='paid' OR (state='pending' AND expires_at > ?)))`,
  )
    .bind(
      id,
      body.kind,
      JSON.stringify(body),
      values.amount,
      values.start,
      values.end,
      values.blockEnd,
      expires,
      now,
      values.blockEnd,
      values.start,
      Math.floor(Date.now() / 1000),
    )
    .run();
  if (!insert.meta.changes) return reply({ error: "Time already held" }, 409);
  try {
    const stripe = sdk(env);
    const session = await stripe.checkout.sessions.create(
      {
        mode: "payment",
        customer_creation: "always",
        customer_email: recipient,
        client_reference_id: id,
        metadata: { makani_test_order: id },
        integration_identifier:
          "makani_test_" +
          crypto
            .randomUUID()
            .replace(/[^a-f]/g, "")
            .padEnd(8, "a")
            .slice(0, 8),
        line_items: [
          {
            quantity: 1,
            price_data: {
              currency: "usd",
              unit_amount: values.amount,
              product_data: { name: `TEST — Makani Media ${body.kind}` },
            },
          },
        ],
        invoice_creation: { enabled: true },
        expires_at: expires,
        success_url: origin + "/api/stripe/test-booking?order=" + id,
        cancel_url: origin + "/api/stripe/test-booking?cancelled=1",
      },
      { idempotencyKey: "makani-test-" + id },
    );
    if (session.livemode !== false) throw Error("LIVE_MODE_REJECTED");
    await env.DB.prepare(
      "UPDATE stripe_test_orders SET session_id=? WHERE id=?",
    )
      .bind(session.id, id)
      .run();
    return reply(
      {
        id,
        sessionId: session.id,
        url: session.url,
        amount: values.amount,
        livemode: false,
      },
      201,
    );
  } catch (e) {
    await env.DB.prepare(
      "UPDATE stripe_test_orders SET last_error=? WHERE id=?",
    )
      .bind(e.code || e.type || "checkout_failed", id)
      .run();
    return reply(
      {
        error: "Checkout could not be created; no booking confirmed",
        code: e.code || e.type || "checkout_failed",
      },
      502,
    );
  }
}
