import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const worker = (
  await import(
    "data:text/javascript;base64," +
      Buffer.from(await readFile("worker/src/index.js")).toString("base64")
  )
).default;
const cal = "makanimediamaui@gmail.com";
const db = {
  prepare(sql) {
    return {
      bind() {
        return this;
      },
      async all() {
        return {
          results: sql.includes("FROM consultations")
            ? [
                {
                  start_time: "2027-01-18T20:00:00Z",
                  buffer_end_time: "2027-01-18T22:00:00Z",
                  status: "confirmed",
                },
              ]
            : [],
        };
      },
    };
  },
};
const env = {
  DB: db,
  GOOGLE_CALENDAR_ENABLED: "true",
  GOOGLE_CALENDAR_ID: cal,
  GOOGLE_CLIENT_ID: "test",
  GOOGLE_CLIENT_SECRET: "test",
  GOOGLE_REFRESH_TOKEN: "test",
};
function google(ctx, fail = false) {
  ctx.mock.method(globalThis, "fetch", async (url) =>
    String(url).includes("oauth2")
      ? Response.json({ access_token: "test" })
      : fail
        ? Response.json({ error: "failed" }, { status: 503 })
        : Response.json({
            calendars: {
              [cal]: {
                busy: [
                  {
                    start: "2027-01-18T23:00:00Z",
                    end: "2027-01-19T00:00:00Z",
                  },
                  {
                    start: "2027-01-20T10:00:00Z",
                    end: "2027-01-21T10:00:00Z",
                  },
                ],
              },
            },
          }),
  );
}
test("month and day share Google blocks and consultation buffer", async (ctx) => {
  google(ctx);
  const day = await (
    await worker.fetch(
      new Request("https://site/api/availability?date=2027-01-18"),
      env,
    )
  ).json();
  for (const time of ["10:00", "11:00", "13:00"])
    assert.equal(day.slots.find((s) => s.time === time).available, false);
  assert.equal(day.slots[0].available, true);
  const month = await (
    await worker.fetch(
      new Request("https://site/api/availability?month=2027-01"),
      env,
    )
  ).json();
  assert.equal(Object.keys(month.days).length, 31);
  assert.deepEqual(month.days["2027-01-18"], day.slots);
  assert.ok(month.days["2027-01-20"].every((s) => !s.available));
  assert.ok(month.days["2027-01-23"].some((s) => s.available));
});
test("outage never returns available slots", async (ctx) => {
  google(ctx, true);
  ctx.mock.method(console, "error", () => {});
  assert.equal(
    (
      await worker.fetch(
        new Request("https://site/api/availability?month=2027-01"),
        env,
      )
    ).status,
    503,
  );
});
test("blocked shoot is rejected before any insert", async (ctx) => {
  google(ctx);
  const r = await worker.fetch(
    new Request("https://site/api/shoot-request", {
      method: "POST",
      body: JSON.stringify({
        name: "Test",
        email: "test@example.com",
        description: "Test",
        package: "Aerial Photo",
        preferredDate: "2027-01-20",
        preferredTime: "08:00",
      }),
    }),
    env,
  );
  assert.equal(r.status, 409);
});
test("existing blackout applies on server too", async (ctx) => {
  google(ctx);
  const r = await (
    await worker.fetch(
      new Request("https://site/api/availability?date=2026-12-15"),
      env,
    )
  ).json();
  assert.ok(r.slots.every((s) => !s.available));
});
