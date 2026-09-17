const clean = (value) => (typeof value === "string" ? value.trim() : "");

const PACKAGE_PRICES = {
  "Aerial Photo": 225,
  "Photo + Video": 325,
  "Signature Media": 475,
};

const ADDON_PRICES = {
  "30-45 Second Social Reel": 125,
  "30–45 Second Social Reel": 125,
  "60-90 Second Cinematic Edit": 250,
  "60–90 Second Cinematic Edit": 250,
  "Vertical Social Version": 75,
  "Raw Footage": 100,
  "24-Hour Rush": 100,
};

const INCLUDED_ADDONS = {
  "Aerial Photo": new Set(["Edited Photos"]),
  "Photo + Video": new Set([
    "Edited Photos",
    "30-45 Second Social Reel",
    "30–45 Second Social Reel",
  ]),
  "Signature Media": new Set([
    "Edited Photos",
    "30-45 Second Social Reel",
    "30–45 Second Social Reel",
    "60-90 Second Cinematic Edit",
    "60–90 Second Cinematic Edit",
    "Vertical Social Version",
  ]),
};

const money = (amount) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  }).format(amount);

export function buildShootEstimate(body) {
  const packageName = clean(body.package);
  const packagePrice = PACKAGE_PRICES[packageName];
  if (!packagePrice) throw new Error("A valid shoot package is required");

  const services = Array.isArray(body.services) ? body.services.map(clean) : [];
  const addons = Array.isArray(body.addons) ? body.addons.map(clean) : [];
  const included = INCLUDED_ADDONS[packageName] || new Set();
  const items = [
    { description: `${packageName} package`, amount: packagePrice },
  ];
  const startHour = Number(clean(body.preferredTime).slice(0, 2));
  const endHour = Number(clean(body.preferredEndTime).slice(0, 2));
  const additionalHours = Math.max(0, endHour - startHour - 1);

  if (Number.isFinite(additionalHours) && additionalHours > 0) {
    items.push({
      description: `Additional shoot time - ${additionalHours} ${additionalHours === 1 ? "hour" : "hours"} @ $150/hr`,
      amount: additionalHours * 150,
    });
  }

  for (const addon of addons) {
    if (!addon || included.has(addon)) continue;
    const amount = ADDON_PRICES[addon];
    if (amount) items.push({ description: addon, amount });
  }

  if (
    services.includes("Ground Photography") ||
    services.includes("Ground Video")
  ) {
    items.push({
      description: "Ground photo / video - estimated 1 hour",
      amount: 150,
    });
  }

  const reviewItems = [];
  if (services.includes("360 Camera Footage"))
    reviewItems.push("360 camera footage");
  if (services.includes("Ocean / Underwater Media"))
    reviewItems.push("Ocean / underwater media");
  if (clean(body.frequency) === "Recurring / Monthly")
    reviewItems.push("recurring / monthly schedule");

  return {
    packageName,
    items,
    includedAddons: addons.filter((addon) => included.has(addon)),
    reviewItems,
    subtotal: items.reduce((sum, item) => sum + item.amount, 0),
  };
}

const ascii = (value) =>
  String(value)
    .replaceAll("–", "-")
    .replaceAll("—", "-")
    .replaceAll("’", "'")
    .replaceAll("°", " degrees")
    .replace(/[^\x20-\x7E]/g, "");

const pdfEscape = (value) =>
  ascii(value)
    .replaceAll("\\", "\\\\")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");

const wrap = (value, max = 82) => {
  const words = ascii(value).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (next.length > max && line) {
      lines.push(line);
      line = word;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
};

const text = (value, x, y, size = 10, bold = false, color = "0.16 0.19 0.21") =>
  `BT ${color} rg /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfEscape(value)}) Tj ET`;

export function generateEstimatePdf(body, estimate, projectId) {
  const name = clean(body.name) || "Customer";
  const business = clean(body.business);
  const date = clean(body.preferredDate);
  const startTime = clean(body.preferredTime);
  const endTime = clean(body.preferredEndTime);
  const requestedWhen = [
    date,
    startTime && endTime ? `${startTime} - ${endTime} HST` : "",
  ]
    .filter(Boolean)
    .join(" | ");
  const location = clean(body.location) || "To be confirmed";
  const estimateNumber = `MM-${ascii(projectId).slice(0, 8).toUpperCase()}`;
  const commands = [
    "0.05 0.17 0.22 rg 0 650 612 142 re f",
    "0.12 0.67 0.63 rg 48 625 516 4 re f",
    text("MAKANI MEDIA", 48, 742, 25, true, "1 1 1"),
    text("DRONE + VISUAL MEDIA", 48, 720, 9, false, "0.68 0.88 0.86"),
    text("PRELIMINARY ESTIMATE", 356, 742, 13, true, "1 1 1"),
    text(estimateNumber, 356, 721, 9, false, "0.85 0.92 0.93"),
    text("Prepared for", 48, 596, 9, true, "0.12 0.67 0.63"),
    text(name, 48, 577, 13, true),
    ...(business ? [text(business, 48, 560, 10)] : []),
    text("Requested shoot", 330, 596, 9, true, "0.12 0.67 0.63"),
    text(requestedWhen || "Date to be confirmed", 330, 577, 11, true),
    ...wrap(location, 40)
      .slice(0, 2)
      .map((line, index) => text(line, 330, 560 - index * 14, 9)),
    "0.88 0.9 0.91 RG 48 522 516 1 re S",
    text("ESTIMATED SERVICES", 48, 496, 10, true, "0.05 0.17 0.22"),
    text("AMOUNT", 500, 496, 10, true, "0.05 0.17 0.22"),
  ];

  let y = 466;
  for (const item of estimate.items) {
    commands.push(text(item.description, 48, y, 10));
    commands.push(text(money(item.amount), 500, y, 10, true));
    commands.push(`0.93 0.94 0.95 RG 48 ${y - 9} 516 0.5 re S`);
    y -= 26;
  }

  const totalBoxY = y - 42;
  commands.push(`0.94 0.97 0.97 rg 340 ${totalBoxY} 224 58 re f`);
  commands.push(
    text("PRELIMINARY TOTAL", 358, totalBoxY + 36, 9, true, "0.05 0.17 0.22"),
  );
  commands.push(
    text(
      money(estimate.subtotal),
      438,
      totalBoxY + 13,
      18,
      true,
      "0.05 0.17 0.22",
    ),
  );

  let noteY = totalBoxY - 30;
  if (estimate.includedAddons.length) {
    commands.push(text("Included with selected package:", 48, noteY, 9, true));
    noteY -= 16;
    for (const line of wrap(estimate.includedAddons.join(", "), 88)) {
      commands.push(text(line, 48, noteY, 9));
      noteY -= 12;
    }
    noteY -= 10;
  }
  if (estimate.reviewItems.length) {
    commands.push(
      text("Items requiring review before final pricing:", 48, noteY, 9, true),
    );
    noteY -= 16;
    for (const line of wrap(estimate.reviewItems.join(", "), 88)) {
      commands.push(text(line, 48, noteY, 9));
      noteY -= 12;
    }
  }

  commands.push("0.05 0.17 0.22 rg 0 0 612 92 re f");
  commands.push(
    text(
      "This is a preliminary estimate, not a final quote.",
      48,
      62,
      9,
      true,
      "1 1 1",
    ),
  );
  commands.push(
    text(
      "Final pricing is subject to project review, location, airspace, permits, travel, scope,",
      48,
      45,
      8,
      false,
      "0.84 0.9 0.91",
    ),
  );
  commands.push(
    text(
      "operating conditions, scheduling, and any custom services. Taxes are not included.",
      48,
      32,
      8,
      false,
      "0.84 0.9 0.91",
    ),
  );
  commands.push(text("makani-media.com", 443, 62, 9, true, "0.68 0.88 0.86"));

  const stream = commands.join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
    `<< /Length ${new TextEncoder().encode(stream).length} >>\nstream\n${stream}\nendstream`,
  ];

  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(new TextEncoder().encode(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = new TextEncoder().encode(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1))
    pdf += `${String(offset).padStart(10, "0")} 00000 n \n`;
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  return new TextEncoder().encode(pdf).buffer;
}

export const formatEstimateTotal = (estimate) => money(estimate.subtotal);
