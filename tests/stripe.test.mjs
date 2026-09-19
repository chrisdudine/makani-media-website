import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import Stripe from "stripe";
import { priceOrder, validate, sdk } from "../worker/src/stripe-checkout.js";
import { webhook } from "../worker/src/stripe-fulfillment.js";
const body = {
  kind: "consultation",
  name: "Test",
  email: "makanimediamaui@gmail.com",
  description: "Sandbox",
  preferredDate: "2026-12-18",
  preferredTime: "08:00",
};
test("fixed consultation total ignores client supplied amount", () =>
  assert.equal(priceOrder({ ...body, amount: 1 }), 10366));
test("shoot service and duration pricing is calculated server-side", () =>
  assert.equal(
    priceOrder({
      ...body,
      kind: "shoot",
      package: "Aerial Photo",
      preferredEndTime: "10:00",
      services: ["Ground Photography"],
      addons: ["Raw Footage", "Raw Footage"],
    }),
    62500,
  ));
test("custom quote and unknown services cannot be undercharged", () => {
  assert.throws(() =>
    priceOrder({
      ...body,
      kind: "shoot",
      package: "Aerial Photo",
      services: ["Ocean / Underwater Media"],
    }),
  );
  assert.throws(() =>
    priceOrder({
      ...body,
      kind: "shoot",
      package: "Aerial Photo",
      addons: ["unknown"],
    }),
  );
});
test("input guards enforce valid dates and controlled test recipient", () => {
  assert.throws(() => validate({ ...body, email: "outside@example.com" }));
  assert.throws(() => validate({ ...body, preferredDate: "2027-02-30" }));
  assert.throws(() =>
    validate({ ...body, kind: "shoot", preferredEndTime: "07:00" }),
  );
  assert.equal(validate(body).amount, 10366);
});
test("live keys are rejected before network access", () =>
  assert.throws(() => sdk({ STRIPE_SECRET_KEY: "sk_live_dummy" })));
const secret = "whsec_unit_test_only";
const session = {
  id: "cs_test_unit",
  object: "checkout.session",
  livemode: false,
  metadata: { makani_test_order: "11111111-1111-4111-8111-111111111111" },
  client_reference_id: "11111111-1111-4111-8111-111111111111",
  payment_status: "paid",
  amount_total: 10366,
  currency: "usd",
  customer: "cus_test",
  payment_intent: "pi_test",
  invoice: "in_test",
};
function signed(
  event,
  wrong = false,
  timestamp = Math.floor(Date.now() / 1000),
) {
  const payload = JSON.stringify(event),
    signature = Stripe.webhooks.generateTestHeaderString({
      payload,
      secret: wrong ? "whsec_wrong" : secret,
      timestamp,
    });
  return new Request("https://makani-media.com/api/stripe/webhook", {
    method: "POST",
    headers: { "stripe-signature": signature },
    body: payload,
  });
}
function database() {
  const sql = new DatabaseSync(":memory:");
  for (const name of [
    "0001_initial.sql",
    "0002_consultation_booking.sql",
    "0003_availability_and_shoots.sql",
    "0004_stripe_test.sql",
  ])
    sql.exec(readFileSync("worker/migrations/" + name, "utf8"));
  const db = {
    prepare(query) {
      let args = [];
      const stmt = {
        bind(...values) {
          args = values;
          return stmt;
        },
        async first() {
          return sql.prepare(query).get(...args) || null;
        },
        async all() {
          return { results: sql.prepare(query).all(...args) };
        },
        async run() {
          const r = sql.prepare(query).run(...args);
          return { success: true, meta: { changes: Number(r.changes) } };
        },
      };
      return stmt;
    },
    async batch(stmts) {
      sql.exec("BEGIN");
      try {
        const r = [];
        for (const s of stmts) r.push(await s.run());
        sql.exec("COMMIT");
        return r;
      } catch (e) {
        sql.exec("ROLLBACK");
        throw e;
      }
    },
  };
  const values = validate(body);
  sql
    .prepare(
      "INSERT INTO stripe_test_orders(id,kind,payload,amount,start_time,end_time,block_end,expires_at,created_at,session_id) VALUES(?,?,?,?,?,?,?,?,?,?)",
    )
    .run(
      session.client_reference_id,
      body.kind,
      JSON.stringify(body),
      10366,
      values.start,
      values.end,
      values.blockEnd,
      2000000000,
      new Date().toISOString(),
      session.id,
    );
  return { db, sql };
}
test("webhook authenticates payment, persists booking, retries delivery, and avoids duplicate completed effects", async () => {
  const { db, sql } = database();
  const sent = [];
  let calendarWrites = 0,
    failReceipt = true;
  const env = {
    DB: db,
    STRIPE_SECRET_KEY: "sk_test_unit",
    STRIPE_WEBHOOK_SECRET: secret,
    GOOGLE_CALENDAR_ID: "makanimediamaui@gmail.com",
    EMAIL: {
      async send(message) {
        if (message.subject.includes("receipt") && failReceipt) {
          failReceipt = false;
          throw Error("provider failure");
        }
        sent.push(message);
        return { messageId: "email-" + sent.length };
      },
    },
    BOOKING_EMAIL_FROM: "bookings@mail.makani-media.com",
  };
  const event = {
    id: "evt_test",
    livemode: false,
    type: "checkout.session.completed",
    data: { object: session },
  };
  const original = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = typeof input === "string" ? input : input.url;
    if (url.includes("api.stripe.com")) return Response.json(session);
    if (url.includes("oauth2.googleapis.com"))
      return Response.json({ access_token: "unit-token" });
    if (url.includes("www.googleapis.com")) {
      calendarWrites++;
      return Response.json({ id: "calendar-test" });
    }
    throw Error("Unexpected URL");
  };
  try {
    assert.equal((await webhook(signed(event, true), env)).status, 400);
    assert.equal((await webhook(signed(event, false, 1), env)).status, 400);
    assert.equal(
      (await webhook(signed({ ...event, livemode: true }), env)).status,
      400,
    );
    assert.equal(sql.prepare("SELECT count(*) AS n FROM contacts").get().n, 0);
    const unpaid = {
      ...event,
      data: { object: { ...session, payment_status: "unpaid" } },
    };
    assert.equal((await webhook(signed(unpaid), env)).status, 200);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM contacts").get().n, 0);
    assert.equal((await webhook(signed(event), env)).status, 503);
    assert.equal(sent.length, 1);
    assert.equal((await webhook(signed(event), env)).status, 200);
    assert.equal((await webhook(signed(event), env)).status, 200);
    assert.equal(calendarWrites, 1);
    assert.equal(sent.length, 2);
    assert.equal(
      sql.prepare("SELECT count(*) AS n FROM consultations").get().n,
      1,
    );
    const order = sql.prepare("SELECT * FROM stripe_test_orders").get();
    assert.equal(order.signature_verified, 1);
    assert.ok(order.receipt_id);
    assert.ok(order.confirmation_id);
    assert.equal(order.amount, 10366);
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});
test("canonical Stripe amount mismatch never fulfills", async () => {
  const { db, sql } = database(),
    original = globalThis.fetch;
  globalThis.fetch = async () => Response.json({ ...session, amount_total: 1 });
  try {
    const r = await webhook(
      signed({
        id: "evt_amount",
        livemode: false,
        type: "checkout.session.completed",
        data: { object: session },
      }),
      {
        DB: db,
        STRIPE_SECRET_KEY: "sk_test_unit",
        STRIPE_WEBHOOK_SECRET: secret,
      },
    );
    assert.equal(r.status, 409);
    assert.equal(sql.prepare("SELECT count(*) AS n FROM contacts").get().n, 0);
  } finally {
    globalThis.fetch = original;
    sql.close();
  }
});
