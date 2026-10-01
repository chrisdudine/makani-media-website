import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, extname, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import prettier from "prettier";

const root = resolve(".");
const baseline = resolve(process.env.BASELINE_DIR || "../baseline");
const decoder = new TextDecoder("utf-8", { fatal: true });
const parser = {
  ".html": "html",
  ".css": "css",
  ".js": "babel",
  ".mjs": "babel",
  ".json": "json",
  ".md": "markdown",
};
async function files(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const result = [];
  for (const entry of entries) {
    if (["node_modules", ".git", ".wrangler"].includes(entry.name)) continue;
    const path = resolve(directory, entry.name);
    result.push(...(entry.isDirectory() ? await files(path) : [path]));
  }
  return result;
}
const sourceFiles = (await files(root)).filter((file) => parser[extname(file)]);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

test("every HTML, CSS, JS, JSON and Markdown file is readable and parses", async () => {
  const hashes = new Map();
  for (const file of sourceFiles) {
    const bytes = await readFile(file);
    const source = decoder.decode(bytes);
    const name = relative(root, file);
    assert(source.trim().length > 0, `${name}: empty source`);
    assert(
      !source.includes("\uFFFD") && !source.includes("\0"),
      `${name}: corrupt text`,
    );
    assert(
      !source.startsWith("xcode-select: error:"),
      `${name}: command error stored as source`,
    );
    const digest = hash(bytes);
    assert(
      !hashes.has(digest),
      `${name} unexpectedly duplicates ${hashes.get(digest)}`,
    );
    hashes.set(digest, name);
    await assert.doesNotReject(
      prettier.format(source, { parser: parser[extname(file)] }),
      `${name}: parse failure`,
    );
    if (extname(file) === ".json") JSON.parse(source);
    if (extname(file) === ".html")
      assert(/<!doctype html>/i.test(source), `${name}: not an HTML document`);
  }
});

test("page text, navigation and form markup are unchanged after source extraction", async () => {
  const stripAssets = (html) =>
    html
      .replace(/<!doctype html>/i, "<!doctype html>")
      .replace(/<style[^>]*>[\s\S]*?<\/style>/g, "")
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/g, "")
      .replace(/<link\b[^>]*href="assets\/css\/[^>]*>/g, "")
      .replace(
        /data:image\/png;base64,[A-Za-z0-9+/=]+/g,
        "assets/images/hero-logo.png",
      );
  for (const page of [
    "index",
    "pricing",
    "book-shoot",
    "schedule-consultation",
  ]) {
    const before = stripAssets(
      await readFile(resolve(baseline, page + ".html"), "utf8"),
    );
    const after = stripAssets(
      await readFile(resolve(root, page + ".html"), "utf8"),
    );
    const options = { parser: "html", htmlWhitespaceSensitivity: "strict" };
    assert.equal(
      await prettier.format(after, options),
      await prettier.format(before, options),
      page,
    );
  }
});

test("all stylesheet declarations and order match main", async () => {
  for (const page of [
    "index",
    "pricing",
    "book-shoot",
    "schedule-consultation",
  ]) {
    const html = await readFile(resolve(baseline, page + ".html"), "utf8");
    const css = [...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)]
      .map((match) => match[1])
      .join("\n")
      .replace(/url\('assets\//g, "url('../");
    const current = await readFile(
      resolve(root, "assets/css", page + ".css"),
      "utf8",
    );
    assert.equal(current, await prettier.format(css, { parser: "css" }), page);
  }
});

test("form, calendar, and Worker logic match main apart from formatting", async () => {
  for (const [page, marker] of [
    ["book-shoot", "const form="],
    ["schedule-consultation", "const calendarTitle="],
  ]) {
    const html = await readFile(resolve(baseline, page + ".html"), "utf8");
    const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
    const original = script.slice(script.indexOf(marker));
    assert.equal(
      await readFile(resolve(root, "assets/js", page + ".js"), "utf8"),
      await prettier.format(original, { parser: "babel" }),
      page,
    );
  }
  assert.equal(
    await readFile(resolve(root, "worker/src/index.js"), "utf8"),
    await prettier.format(
      await readFile(resolve(baseline, "worker/src/index.js"), "utf8"),
      { parser: "babel" },
    ),
  );
});

test("homepage image bytes, database migrations and deployment configuration match main", async () => {
  const original = await readFile(resolve(baseline, "index.html"), "utf8");
  const bytes = Buffer.from(
    original.match(/data:image\/png;base64,([A-Za-z0-9+/=]+)/)[1],
    "base64",
  );
  assert.deepEqual(await readFile("assets/images/hero-logo.png"), bytes);
  for (const file of [
    "assets/contact-background-clean.png",
    "wrangler.toml",
    "worker/wrangler.toml",
    "worker/wrangler.example.toml",
    "worker/migrations/0001_initial.sql",
    "worker/migrations/0002_consultation_booking.sql",
    ".github/workflows/pages.yml",
  ]) {
    assert.deepEqual(
      await readFile(resolve(root, file)),
      await readFile(resolve(baseline, file)),
      file,
    );
  }
});

test("extracted local assets exist and are loaded in the original script order", async () => {
  for (const page of [
    "index",
    "pricing",
    "book-shoot",
    "schedule-consultation",
  ]) {
    const html = await readFile(page + ".html", "utf8");
    for (const [, asset] of html.matchAll(
      /(?:href|src)="(assets\/[^"#?]+)"/g,
    )) {
      assert((await readFile(asset)).length > 0, asset);
    }
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map(
      (match) => match[1],
    );
    assert.deepEqual(scripts, [
      "assets/js/mobile-menu.js",
      ...(["book-shoot", "schedule-consultation"].includes(page)
        ? [`assets/js/${page}.js`]
        : []),
    ]);
    const css = await readFile(`assets/css/${page}.css`, "utf8");
    for (const [, asset] of css.matchAll(/url\(["']?(\.\.\/[^"')]+)["']?\)/g)) {
      assert(
        (await readFile(resolve(dirname(`assets/css/${page}.css`), asset)))
          .length > 0,
        asset,
      );
    }
  }
});
