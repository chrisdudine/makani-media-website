import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { reviewScript } from "../worker/src/social-review-ui.js";
class Element {
  constructor(tag = "div") {
    this.tag = tag;
    this.children = [];
    this.value = "";
    this.hidden = false;
  }
  append(...nodes) {
    this.children.push(...nodes);
  }
  replaceChildren(...nodes) {
    this.children = nodes;
  }
  setAttribute() {}
  querySelectorAll(tag) {
    return this.children.flatMap((n) => [
      ...(n.tag === tag ? [n] : []),
      ...n.querySelectorAll(tag),
    ]);
  }
}
function setup() {
  const ids = new Map();
  const get = (id) => {
    if (!ids.has(id)) ids.set(id, new Element());
    return ids.get(id);
  };
  const pending = [];
  const context = vm.createContext({
    document: { getElementById: get, createElement: (tag) => new Element(tag) },
    window: { addEventListener() {} },
    confirm: () => true,
    fetch: () => new Promise((resolve) => pending.push(resolve)),
  });
  vm.runInContext(reviewScript, context);
  const data = {
    items: [
      {
        id: "one",
        imported_name: "Logo",
        source_file_id: "",
        summary: "Scene",
        review_notes: [],
        targets: [
          {
            id: "ig",
            platform: "instagram",
            platform_caption: "Original",
            publish_status: "draft",
            updated_at: "before",
          },
        ],
      },
    ],
    next_offset: null,
  };
  const respond = (value = data, status = 200) =>
    pending.shift()({ ok: status === 200, status, json: async () => value });
  return { get, pending, context, respond };
}
test("slow reload preserves newly typed captions and duplicate loads are ignored", async () => {
  const s = setup();
  const first = vm.runInContext("load()", s.context);
  s.respond();
  await first;
  const textarea = s.get("items").querySelectorAll("textarea")[0];
  const reload = vm.runInContext("load()", s.context);
  await vm.runInContext("load()", s.context);
  assert.equal(s.pending.length, 1);
  textarea.value = "Unsaved edit";
  textarea.oninput();
  s.respond();
  await reload;
  assert.equal(s.get("items").querySelectorAll("textarea")[0], textarea);
  assert.equal(textarea.value, "Unsaved edit");
  assert.match(s.get("message").textContent, /edits were kept/);
});
test("late unauthorized response cannot sign out a newer session", async () => {
  const s = setup();
  vm.runInContext("key='old'", s.context);
  const old = vm.runInContext("api('items').catch(()=>{})", s.context);
  vm.runInContext("lock();key='new';session++", s.context);
  s.respond({ error: "Expired" }, 401);
  await old;
  assert.equal(vm.runInContext("key", s.context), "new");
});
