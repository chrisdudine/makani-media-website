const output = document.querySelector("pre");
const params = new URLSearchParams(location.search);
const widths = params.has("width")
  ? [Number(params.get("width"))]
  : [390, 620, 720, 850, 1050, 1100, 1440];
const files = [
  "index.html",
  "pricing.html",
  "book-shoot.html",
  "schedule-consultation.html",
].filter((file) => !params.has("page") || file === params.get("page"));
const results = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(predicate, message) {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error(message);
}
async function settle(win) {
  // Compare completed states, rather than different frames of the same transition.
  await delay(400);
  await Promise.all(
    win.document
      .getAnimations()
      .map((animation) => animation.finished.catch(() => {})),
  );
}
function capture(win) {
  const properties = [
    "display",
    "position",
    "color",
    "backgroundColor",
    "backgroundImage",
    "fontFamily",
    "fontSize",
    "fontWeight",
    "lineHeight",
    "letterSpacing",
    "textTransform",
    "whiteSpace",
    "borderTop",
    "borderRadius",
    "padding",
    "margin",
    "gap",
    "gridTemplateColumns",
    "overflow",
    "zIndex",
    "opacity",
    "outline",
    "boxShadow",
  ];
  return [...win.document.body.querySelectorAll("*")]
    .filter((element) => !["SCRIPT", "STYLE", "LINK"].includes(element.tagName))
    .map((element) => {
      const style = win.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      const rendered = rect.width > 0 && rect.height > 0;
      const header = element.closest("header");
      // Hidden options have zero rectangles; do not add a page scroll offset to them.
      const geometry = rendered
        ? [
            rect.x + (header ? 0 : win.scrollX),
            rect.y + (header ? 0 : win.scrollY),
            rect.width,
            rect.height,
          ]
        : [0, 0, 0, 0];
      return {
        tag: element.tagName,
        attributes: [...element.attributes]
          .filter(
            (attribute) =>
              !(element.tagName === "IMG" && attribute.name === "src"),
          )
          .map((attribute) => [
            attribute.name,
            attribute.name === "style"
              ? element.style.cssText
              : attribute.value,
          ])
          .sort(),
        text: element.children.length
          ? ""
          : element.textContent.replace(/\s+/g, " ").trim(),
        value: element.value,
        checked: element.checked,
        disabled: element.disabled,
        rect: geometry.map((value) => Math.round(value * 100) / 100),
        style: Object.fromEntries(
          properties.map((property) => [
            property,
            style[property].replace(/\/(before|after)\//g, "/site/"),
          ]),
        ),
      };
    });
}
async function run(side, file, width) {
  output.textContent = `Testing ${side}: ${file} at ${width}px\n${results.map((result) => result.label).join("\n")}`;
  const frame = document.createElement("iframe");
  frame.width = width;
  frame.height = 900;
  frame.style.border = "0";
  document.querySelector("#frames").append(frame);
  await new Promise((resolve) => {
    frame.onload = resolve;
    frame.src = `/${side}/${file}`;
  });
  const win = frame.contentWindow;
  const doc = win.document;
  const snapshots = {};
  const save = async (name) => {
    await settle(win);
    snapshots[name] = capture(win);
  };
  const click = (selector) => {
    const element = doc.querySelector(selector);
    assert(element, `${file}: missing ${selector}`);
    element.click();
  };
  try {
    await doc.fonts.ready;
    await Promise.all(
      [...doc.images].map((image) => image.decode().catch(() => {})),
    );
    await save("initial");
    const toggle = doc.querySelector(".menu-toggle");
    const menu = doc.querySelector("#mobile-menu");
    const breakpoint =
      file === "index.html" ? 1100 : file === "pricing.html" ? 1050 : 720;
    if (width <= breakpoint) {
      assert(
        win.getComputedStyle(toggle).display !== "none",
        "Mobile toggle missing",
      );
      toggle.click();
      assert(
        toggle.getAttribute("aria-expanded") === "true",
        "Menu did not expand",
      );
      for (const link of menu.querySelectorAll("a"))
        assert(link.getBoundingClientRect().height > 0, "Menu link hidden");
      await save("menu-open");
      doc.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape" }));
      assert(
        toggle.getAttribute("aria-expanded") === "false",
        "Escape did not close menu",
      );
      toggle.click();
      toggle.click();
      assert(
        toggle.getAttribute("aria-expanded") === "false",
        "Toggle did not close menu",
      );
      toggle.click();
      const link = menu.querySelector("a");
      link.addEventListener("click", (event) => event.preventDefault(), {
        once: true,
      });
      link.click();
      assert(
        toggle.getAttribute("aria-expanded") === "false",
        "Link did not close menu",
      );
      toggle.click();
      frame.width = breakpoint + 1;
      await until(
        () => toggle.getAttribute("aria-expanded") === "false",
        "Resize did not close menu",
      );
      frame.width = width;
      await settle(win);
    } else
      assert(
        win.getComputedStyle(toggle).display === "none",
        "Desktop shows mobile toggle",
      );
    win.scrollTo({ top: 700, behavior: "instant" });
    await save("scrolled");
    assert(
      Math.abs(doc.querySelector("header").getBoundingClientRect().top) < 1,
      "Sticky header moved",
    );
    win.scrollTo({ top: 0, behavior: "instant" });
    if (file === "schedule-consultation.html") {
      const title = doc.querySelector("#calendar-title").textContent;
      click("#previous-month");
      assert(
        doc.querySelector("#calendar-title").textContent === title,
        "Calendar moved before current month",
      );
      click("#next-month");
      await save("next-month");
      click("#previous-month");
      await save("previous-month");
      click(".calendar-day:not([disabled])");
      await until(
        () => doc.querySelectorAll(".time-slot").length === 9,
        "Times not rendered",
      );
      assert(
        doc.querySelectorAll(".time-slot")[1].disabled,
        "Blocked time selectable",
      );
      click(".time-slot:not([disabled])");
      await save("date-and-time-selected");
      win.regression.mode = "availability-error";
      click(".calendar-day:not([disabled])");
      await until(
        () => doc.querySelectorAll(".time-slot").length === 9,
        "Availability fallback not rendered",
      );
      assert(
        [...doc.querySelectorAll(".time-slot")].every(
          (button) => !button.disabled,
        ),
        "Availability fallback changed",
      );
      await save("availability-fallback");
      click(".time-slot");
    }
    if (file === "book-shoot.html" || file === "schedule-consultation.html") {
      const fill = () => {
        for (const [id, value] of Object.entries({
          name: " Test Client ",
          email: "test@example.com",
          description: " Test project ",
          business: " Test business ",
          phone: "8085550100",
          location: " Test location ",
          questions: " Test question ",
          accessDetails: " Test access ",
        })) {
          const field = doc.querySelector(`form [name="${id}"]`);
          if (field) field.value = value;
        }
        doc.querySelector('[name="projectType"]').selectedIndex = 1;
        click('label[for="s1"]');
        click('label[for="a1"]');
        if (file === "book-shoot.html") {
          doc.querySelector("#preferredDate").value = "2026-10-12";
          doc.querySelector("#preferredTime").value = "10:00";
          doc.querySelector("#alternateDate").value = "2026-10-13";
        }
      };
      const form = doc.querySelector("form");
      const submit = doc.querySelector('button[type="submit"]');
      const status = doc.querySelector("#form-status");
      assert(!form.checkValidity(), "Empty required form is valid");
      fill();
      await save("form-filled");
      for (const mode of ["error", "network-error", "json-error"]) {
        win.regression.mode = mode;
        form.requestSubmit();
        await until(
          () => !submit.disabled && status.textContent !== "Sending…",
          "Submission did not finish",
        );
        assert(status.classList.contains("error"), "Missing form error");
        assert(
          doc.querySelector('[name="name"]').value === " Test Client ",
          "Error reset input",
        );
        await save(mode);
      }
      win.regression.mode = "pending";
      form.requestSubmit();
      await until(
        () => win.regression.pending !== null,
        "No pending submission",
      );
      assert(
        submit.disabled && status.textContent === "Sending…",
        "Pending feedback changed",
      );
      await save("pending");
      win.regression.pending();
      await until(
        () => !submit.disabled && status.classList.contains("success"),
        "Success not displayed",
      );
      assert(
        doc.querySelector('[name="name"]').value === "",
        "Success did not reset form",
      );
      await save("success");
      if (file === "schedule-consultation.html") {
        fill();
        // Hidden inputs retain their value attributes after native form.reset().
        // Explicitly exercise the original missing-selection validation branch.
        doc.querySelector("#preferredDate").value = "";
        doc.querySelector("#preferredTime").value = "";
        form.requestSubmit();
        assert(
          status.textContent ===
            "Please select an available consultation date and time.",
          "Missing date feedback changed",
        );
        await save("missing-date");
      }
      assert(
        win.regression.submissions.length === 4,
        "Unexpected request count",
      );
    }
    assert(
      win.regression.errors.length === 0,
      win.regression.errors.join("\n"),
    );
    return {
      snapshots,
      submissions: win.regression.submissions,
      availabilityRequests: win.regression.availabilityRequests,
    };
  } finally {
    frame.remove();
  }
}
async function main() {
  try {
    for (const file of files)
      for (const width of widths) {
        const before = await run("before", file, width);
        const after = await run("after", file, width);
        if (JSON.stringify(before) !== JSON.stringify(after)) {
          const differences = [];
          for (const state of Object.keys(before.snapshots)) {
            const a = before.snapshots[state],
              b = after.snapshots[state];
            for (let index = 0; index < Math.max(a.length, b.length); index++) {
              if (JSON.stringify(a[index]) !== JSON.stringify(b[index]))
                differences.push({
                  state,
                  index,
                  before: a[index],
                  after: b[index],
                });
            }
          }
          await fetch("/test-results", {
            method: "POST",
            body: JSON.stringify({
              passed: false,
              file,
              width,
              differences,
              beforeSubmissions: before.submissions,
              afterSubmissions: after.submissions,
              results,
            }),
          });
          throw new Error(
            `${file} ${width}px: ${differences.length} differences (saved locally)`,
          );
        }
        results.push({
          label: `PASS ${file} ${width}px`,
          states: Object.keys(before.snapshots),
        });
      }
    output.textContent = `PASS: ${results.length} complete page/viewport comparisons\n${results.map((result) => result.label).join("\n")}`;
    await fetch("/test-results", {
      method: "POST",
      body: JSON.stringify({ passed: true, results }),
    });
  } catch (error) {
    output.textContent = `FAIL: ${error.message}\n${results.map((result) => result.label).join("\n")}`;
  }
}
main();
