import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const load = async (path) =>
  (
    await import(
      "data:text/javascript;base64," +
        Buffer.from(await readFile(path, "utf8")).toString("base64")
    )
  ).default;
const worker = await load("worker/src/index.js");
const baseline = await load(
  (process.env.BASELINE_DIR || "../baseline") + "/worker/src/index.js",
);
function database(fail = false) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      let values;
      const statement = {
        bind(...args) {
          values = args;
          return statement;
        },
        async first() {
          if (fail) throw Error("Test database failure");
          calls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
          return { id: "existing-contact" };
        },
        async run() {
          calls.push({ sql: sql.replace(/\s+/g, " ").trim(), values });
          return { success: true };
        },
      };
      return statement;
    },
  };
}
const valid = {
  name: " Test Client ",
  email: "TEST@example.com",
  description: " Project ",
  business: " Test business ",
  phone: "8085550100",
  source: "website-book-shoot",
  services: [" Drone ", null, 2, ""],
  addons: [" Photos "],
  preferredDate: "2026-10-12",
  preferredTime: "10:00",
  alternateDate: "2026-10-13",
  accessDetails: " Gate ",
  questions: " Question ",
};
const scenarios = [
  ["preflight", "OPTIONS", "/api/consultation", undefined, {}],
  [
    "availability remains unimplemented",
    "GET",
    "/api/availability?date=2026-10-12",
    undefined,
    {},
  ],
  ["unknown route", "POST", "/unknown", {}, {}],
  ["missing binding", "POST", "/api/consultation", valid, {}],
  ["malformed JSON", "POST", "/api/consultation", "{", true],
  ["missing fields", "POST", "/api/consultation", {}, true],
  [
    "invalid email",
    "POST",
    "/api/consultation",
    { ...valid, email: "bad" },
    true,
  ],
  [
    "length limit",
    "POST",
    "/api/consultation",
    { ...valid, name: "a".repeat(161) },
    true,
  ],
  [
    "shoot payload and existing-contact upsert",
    "POST",
    "/api/consultation",
    valid,
    true,
  ],
  [
    "consultation payload",
    "POST",
    "/api/consultation",
    { ...valid, source: "website-consultation" },
    true,
  ],
  ["database failure", "POST", "/api/consultation", valid, "fail"],
];
function normalize(value) {
  return JSON.parse(
    JSON.stringify(value)
      .replace(
        /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g,
        "<uuid>",
      )
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z/g, "<timestamp>"),
  );
}
for (const [name, method, path, body, db] of scenarios)
  test(name, async (context) => {
    const logged = context.mock.method(console, "error", () => {});
    const results = [];
    for (const handler of [baseline, worker]) {
      const DB = db === true || db === "fail" ? database(db === "fail") : null;
      const request = new Request("https://example.test" + path, {
        method,
        ...(body === undefined
          ? {}
          : { body: typeof body === "string" ? body : JSON.stringify(body) }),
      });
      const response = await handler.fetch(request, DB ? { DB } : {});
      const text = await response.text();
      results.push(
        normalize({
          status: response.status,
          headers: [...response.headers],
          body: text,
          calls: DB?.calls,
        }),
      );
    }
    assert.deepEqual(results[1], results[0]);
    assert.equal(logged.mock.callCount(), db === "fail" ? 2 : 0);
    if (db === true && name.includes("payload")) {
      assert.equal(results[1].status, 201);
      assert.equal(results[1].calls.length, 2);
      assert.equal(results[1].calls[0].values[3], "test@example.com");
      assert.equal(results[1].calls[1].values[1], "existing-contact");
    }
  });
