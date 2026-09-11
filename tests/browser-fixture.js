// Only the local test server injects this file. Production HTML never loads it.
(() => {
  const OriginalDate = Date;
  window.Date = class extends OriginalDate {
    constructor(...args) {
      super(...(args.length ? args : ["2026-09-10T20:00:00Z"]));
    }
    static now() {
      return new OriginalDate("2026-09-10T20:00:00Z").valueOf();
    }
  };
  window.regression = {
    mode: "success",
    submissions: [],
    availabilityRequests: [],
    errors: [],
    pending: null,
  };
  window.addEventListener("error", (event) =>
    regression.errors.push(event.message),
  );
  window.addEventListener("unhandledrejection", (event) =>
    regression.errors.push(String(event.reason)),
  );
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (url, options) => {
    if (String(url).startsWith("/api/availability")) {
      regression.availabilityRequests.push(String(url));
      if (regression.mode === "availability-error")
        return new Response("Unavailable", { status: 503 });
      return Response.json({
        slots: [
          { time: "09:00", available: false },
          { time: "10:00", available: true },
        ],
      });
    }
    if (String(url) === "/api/consultation") {
      regression.submissions.push({
        url,
        method: options.method,
        headers: options.headers,
        body: JSON.parse(options.body),
      });
      if (regression.mode === "pending")
        return new Promise((resolve) => {
          regression.pending = () =>
            resolve(
              Response.json(
                { success: true, projectId: "fixture-only" },
                { status: 201 },
              ),
            );
        });
      if (regression.mode === "network-error")
        throw new TypeError("Failed to fetch");
      if (regression.mode === "json-error")
        return new Response("Bad response", { status: 502 });
      if (regression.mode === "error")
        return Response.json({ error: "Test rejection" }, { status: 400 });
      return Response.json(
        { success: true, projectId: "fixture-only" },
        { status: 201 },
      );
    }
    return originalFetch(url, options);
  };
})();
