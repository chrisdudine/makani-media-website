import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const worker = (
  await import(
    "data:text/javascript;base64," +
      Buffer.from(await readFile("worker/src/index.js", "utf8")).toString(
        "base64",
      )
  )
).default;

const DB = {
  prepare() {
    return {
      bind() {
        return this;
      },
      async all() {
        return { results: [] };
      },
      async first() {
        return { id: "contact-1" };
      },
      async run() {
        return { success: true };
      },
    };
  },
};
const env = {
  DB,
  GOOGLE_CALENDAR_ENABLED: "true",
  GOOGLE_CALENDAR_ID: "makanimediamaui@gmail.com",
  GOOGLE_CLIENT_ID: "test-client",
  GOOGLE_CLIENT_SECRET: "test-secret",
  GOOGLE_REFRESH_TOKEN: "test-refresh",
};

test("availability honors business calendar busy times and closes Saturdays", async (t) => {
  const requests = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    requests.push({ url, options });
    if (url.includes("oauth2"))
      return Response.json({ access_token: "test-token" });
    return Response.json({
      calendars: {
        "makanimediamaui@gmail.com": {
          busy: [
            { start: "2026-09-14T19:00:00Z", end: "2026-09-14T20:00:00Z" },
          ],
        },
      },
    });
  });
  const response = await worker.fetch(
    new Request("https://test.example/api/availability?date=2026-09-14"),
    env,
  );
  assert.equal(response.status, 200);
  const result = await response.json();
  assert.equal(
    result.slots.find((slot) => slot.time === "09:00").available,
    false,
  );
  assert.equal(
    result.slots.find((slot) => slot.time === "08:00").available,
    true,
  );
  assert.equal(
    JSON.parse(requests[1].options.body).items[0].id,
    "makanimediamaui@gmail.com",
  );
  const saturday = await worker.fetch(
    new Request("https://test.example/api/availability?date=2026-09-19"),
    env,
  );
  assert.deepEqual((await saturday.json()).slots, []);
});

test("calendar errors do not show available slots", async (t) => {
  t.mock.method(
    globalThis,
    "fetch",
    async () => new Response(null, { status: 503 }),
  );
  t.mock.method(console, "error", () => {});
  const response = await worker.fetch(
    new Request("https://test.example/api/availability?date=2026-09-14"),
    env,
  );
  assert.equal(response.status, 500);
});

test("consultation creates an event on the business calendar", async (t) => {
  const calls = [];
  t.mock.method(globalThis, "fetch", async (url, options) => {
    calls.push({ url, options });
    if (url.includes("oauth2"))
      return Response.json({ access_token: "test-token" });
    if (url.includes("freeBusy"))
      return Response.json({
        calendars: {
          "makanimediamaui@gmail.com": { busy: [] },
        },
      });
    return Response.json({ id: "created-event" });
  });
  const body = {
    name: "Client",
    email: "client@example.com",
    description: "Aerial footage",
    preferredDate: "2026-09-14",
    preferredTime: "10:00",
  };
  const response = await worker.fetch(
    new Request("https://test.example/api/consultation", {
      method: "POST",
      body: JSON.stringify(body),
    }),
    env,
  );
  assert.equal(response.status, 201);
  const event = calls.find((call) => call.url.includes("/events"));
  assert.ok(event.url.includes("makanimediamaui%40gmail.com"));
  assert.equal(
    JSON.parse(event.options.body).start.dateTime,
    "2026-09-14T20:00:00.000Z",
  );
});
