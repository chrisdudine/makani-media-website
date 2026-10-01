import test from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { resolve, extname, relative, dirname } from "node:path";
import { createHash } from "node:crypto";
import prettier from "prettier";

const root = resolve(".");
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

test("local assets exist and the shared calendar loads before booking forms", async () => {
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
      (match) => match[1].split("?")[0],
    );
    assert.deepEqual(scripts, [
      "assets/js/mobile-menu.js",
      ...(["book-shoot", "schedule-consultation"].includes(page)
        ? ["assets/js/booking-calendar.js", `assets/js/${page}.js`]
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
