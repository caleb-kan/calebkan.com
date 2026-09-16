import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { setImmediate } from "node:timers/promises";
import vm from "node:vm";
import test from "node:test";

const source = readFileSync(
  new URL("../js/github-calendar.js", import.meta.url),
  "utf8",
);

// Minimal SVG boundary: the production calendar builds and updates these nodes.
class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.attributes = new Map();
    this.style = {};
    this.textContent = "";
  }
  setAttribute(key, value) {
    this.attributes.set(key, String(value));
  }
  getAttribute(key) {
    return this.attributes.get(key);
  }
  appendChild(child) {
    this.children.push(child);
  }
  replaceChildren(...children) {
    this.children = children;
  }
  querySelector(tag) {
    return this.children.find((child) => child.tag === tag);
  }
  querySelectorAll() {
    return this.children.filter((child) => child.tag === "rect");
  }
}

async function calendarPage({
  now = "2026-09-19T23:59:00Z",
  fetchData = () => ({ contributions: [] }),
} = {}) {
  const container = new Element("div");
  let currentTime = Date.parse(now),
    requestCount = 0;
  const timers = new Map();
  let nextTimer = 0;
  let visibility;
  class Clock extends Date {
    constructor(...args) {
      super(...(args.length ? args : [currentTime]));
    }
    static now() {
      return currentTime;
    }
  }
  const document = {
    hidden: false,
    documentElement: { classList: { contains: () => true } },
    getElementById: () => container,
    createElementNS: (ns, tag) => new Element(tag),
    addEventListener: (name, handler) => {
      if (name === "visibilitychange") visibility = handler;
    },
  };
  const context = vm.createContext({
    Date: Clock,
    AbortController,
    document,
    console: { warn() {}, error() {} },
    MutationObserver: class {
      observe() {}
    },
    setTimeout: (callback, delay) => {
      const id = ++nextTimer;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    fetch: async () => {
      requestCount++;
      const data = fetchData();
      return { ok: true, json: async () => data };
    },
  });
  vm.runInContext(source, context);
  await setImmediate();
  return {
    container,
    requests: () => requestCount,
    async poll(at) {
      currentTime = Date.parse(at);
      const entry = timers.entries().next().value;
      assert.ok(entry, "A next poll must be scheduled");
      timers.delete(entry[0]);
      entry[1].callback();
      await setImmediate();
    },
    async visible() {
      document.hidden = false;
      visibility();
      await setImmediate();
    },
    titles: () =>
      container
        .querySelector("svg")
        ?.children.filter((e) => e.tag === "rect")
        .map((e) => e.children[0].textContent),
  };
}

test("calendar advances its date window at UTC midnight even if counts are unchanged", async () => {
  const page = await calendarPage();
  assert.ok(page.titles().at(-1).endsWith("2026-09-19"));
  await page.poll("2026-09-20T00:00:01Z");
  assert.ok(page.titles().at(-1).endsWith("2026-09-20"));
  assert.ok(page.titles()[0].endsWith("2025-09-21"));
});

test("calendar keeps the existing SVG when data and date have not changed", async () => {
  const page = await calendarPage();
  const svg = page.container.querySelector("svg");
  await page.poll("2026-09-19T23:59:30Z");
  assert.equal(page.container.querySelector("svg"), svg);
});

test("calendar stops after repeated failures and stays stopped after tab restore", async () => {
  const page = await calendarPage({
    fetchData: () => {
      throw new Error("Offline");
    },
  });
  for (let i = 1; i < 5; i++) await page.poll(`2026-09-20T00:0${i}:00Z`);
  assert.equal(page.requests(), 5);
  await page.visible();
  assert.equal(page.requests(), 5);
});
