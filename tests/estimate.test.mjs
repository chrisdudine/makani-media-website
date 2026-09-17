import test from "node:test";
import assert from "node:assert/strict";
import {
  buildShootEstimate,
  generateEstimatePdf,
} from "../worker/src/estimate.js";

test("calculates package, priced add-ons, inclusions, and custom review items", () => {
  const body = {
    package: "Signature Media",
    services: [
      "Ground Video",
      "360 Camera Footage",
      "Ocean / Underwater Media",
    ],
    addons: [
      "Edited Photos",
      "60–90 Second Cinematic Edit",
      "Vertical Social Version",
      "Raw Footage",
      "24-Hour Rush",
    ],
    frequency: "Recurring / Monthly",
  };
  const estimate = buildShootEstimate(body);

  assert.equal(estimate.subtotal, 825);
  assert.deepEqual(estimate.items, [
    { description: "Signature Media package", amount: 475 },
    { description: "Raw Footage", amount: 100 },
    { description: "24-Hour Rush", amount: 100 },
    { description: "Ground photo / video - estimated 1 hour", amount: 150 },
  ]);
  assert.deepEqual(estimate.reviewItems, [
    "360 camera footage",
    "Ocean / underwater media",
    "recurring / monthly schedule",
  ]);
  assert.deepEqual(estimate.includedAddons, [
    "Edited Photos",
    "60–90 Second Cinematic Edit",
    "Vertical Social Version",
  ]);

  const pdf = generateEstimatePdf(
    {
      ...body,
      name: "Test Client",
      business: "Test Business",
      preferredDate: "2026-10-12",
      location: "Wailea, Maui",
    },
    estimate,
    "12345678-project",
  );
  assert.ok(pdf.byteLength > 1_000);
  assert.equal(new TextDecoder().decode(pdf.slice(0, 8)), "%PDF-1.4");
});
