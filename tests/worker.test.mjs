import test from "node:test";
import assert from "node:assert/strict";
import worker from "../worker/src/index.js";

function database(fail = false) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      let values;
      return {
        bind(...args) {
          values = args;
          return this;
        },
        async all() {
          if (fail) throw new Error("Test database failure");
          return { results: [] };
        },
        async first() {
          calls.push({ sql, values });
          return { id: "existing-contact" };
        },
        async run() {
          calls.push({ sql, values });
          return { success: true };
        },
      };
    },
  };
}
const valid = {
  name: " Test Client ",
  email: "TEST@example.com",
  description: "Project",
  preferredDate: "2027-01-18",
  preferredTime: "10:00",
  source: "website-consultation",
};
const request = (body) =>
  new Request("https://example.test/api/consultation", {
    method: "POST",
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

test("preflight, missing binding, and unknown route retain their contracts", async () => {
  const preflight = await worker.fetch(
    new Request("https://example.test/api/consultation", { method: "OPTIONS" }),
    {},
  );
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("Access-Control-Allow-Origin"), "*");
  assert.equal((await worker.fetch(request(valid), {})).status, 500);
  assert.equal(
    (
      await worker.fetch(new Request("https://example.test/unknown"), {
        DB: database(),
      })
    ).status,
    404,
  );
});
for (const [name, body] of [
  ["malformed JSON", "{"],
  ["missing fields", {}],
  ["invalid email", { ...valid, email: "bad" }],
  ["length limit", { ...valid, name: "a".repeat(161) }],
  ["invalid time", { ...valid, preferredTime: "invalid" }],
])
  test(`${name} is rejected before writing`, async () => {
    const DB = database();
    assert.equal((await worker.fetch(request(body), { DB })).status, 400);
    assert.equal(DB.calls.length, 0);
  });

test("consultation saves contact, project and buffered booking", async () => {
  const DB = database();
  const response = await worker.fetch(request(valid), { DB });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.equal(body.success, true);
  assert.ok(body.projectId);
  assert.ok(body.consultationId);
  assert.equal(DB.calls.length, 3);
  assert.ok(DB.calls[0].values.includes("test@example.com"));
  const booking = DB.calls.find((call) =>
    call.sql.includes("INSERT INTO consultations"),
  );
  assert.ok(booking.values.includes("existing-contact"));
  assert.ok(booking.values.includes("2027-01-18T20:00:00.000Z"));
  assert.ok(booking.values.includes("2027-01-18T21:00:00.000Z"));
  assert.ok(booking.values.includes("2027-01-18T22:00:00.000Z"));
});

test("database outage fails closed without booking writes", async (t) => {
  t.mock.method(console, "error", () => {});
  const DB = database(true);
  assert.equal((await worker.fetch(request(valid), { DB })).status, 500);
  assert.equal(DB.calls.length, 0);
});
