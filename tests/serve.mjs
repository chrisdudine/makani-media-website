import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, extname, sep } from "node:path";

const root = resolve(".");
const baseline = resolve(process.env.BASELINE_DIR || "../baseline");
const output = resolve(process.env.TEST_OUTPUT || "../redo-results");
const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};
const server = createServer(async (request, response) => {
  const url = new URL(request.url, "http://localhost");
  if (url.pathname === "/") {
    response.setHeader("Content-Type", mime[".html"]);
    response.end(
      '<!doctype html><meta charset="utf-8"><title>Makani Media regression tests</title><pre>Starting…</pre><div id="frames"></div><script src="/tests/browser-runner.js"></script>',
    );
    return;
  }
  if (url.pathname === "/test-results" && request.method === "POST") {
    let body = "";
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 50_000_000) {
        response.writeHead(413).end();
        return;
      }
    }
    JSON.parse(body);
    await mkdir(output, { recursive: true });
    await writeFile(resolve(output, "browser-results.json"), body);
    response.end("saved");
    return;
  }
  // Local fixtures intercept API calls; never forward requests to production.
  if (request.method !== "GET") {
    response.writeHead(405).end();
    return;
  }
  const side = url.pathname.startsWith("/before/")
    ? "before"
    : url.pathname.startsWith("/after/")
      ? "after"
      : null;
  const base = side === "before" ? baseline : root;
  const path = resolve(
    base,
    decodeURIComponent(
      side ? url.pathname.slice(side.length + 2) : url.pathname.slice(1),
    ),
  );
  if (!path.startsWith(base + sep)) {
    response.writeHead(403).end();
    return;
  }
  try {
    let data = await readFile(path);
    if (extname(path) === ".html" && side) {
      data = Buffer.from(
        data
          .toString("utf8")
          .replace(
            "<head>",
            '<head><script src="/tests/browser-fixture.js"></script>',
          ),
      );
    }
    response.setHeader(
      "Content-Type",
      mime[extname(path)] || "text/plain; charset=utf-8",
    );
    response.setHeader("Cache-Control", "no-store");
    response.end(data);
  } catch {
    response.writeHead(404).end();
  }
});
server.listen(Number(process.env.PORT || 4183), "127.0.0.1", () =>
  console.log(`Regression server: http://127.0.0.1:${server.address().port}`),
);
