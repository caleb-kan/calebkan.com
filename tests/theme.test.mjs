import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const boot = readFileSync(
  new URL("../js/theme-boot.js", import.meta.url),
  "utf8",
);
const toggleScript = readFileSync(
  new URL("../js/theme-toggle.js", import.meta.url),
  "utf8",
);

function loadTheme(saved, storageBlocked = false) {
  const classes = new Set(["dark"]);
  const meta = new Map();
  const attributes = new Map([["aria-label", "Dark mode"]]);
  let click;
  const root = {
    classList: {
      contains: (name) => classes.has(name),
      toggle: (name, enabled) =>
        enabled ? classes.add(name) : classes.delete(name),
    },
  };
  const button = {
    setAttribute: (key, value) => attributes.set(key, value),
    addEventListener: (event, handler) => {
      if (event === "click") click = handler;
    },
  };
  const context = vm.createContext({
    console: { warn() {} },
    document: {
      documentElement: root,
      querySelector: (selector) =>
        selector === ".theme-toggle"
          ? button
          : {
              setAttribute: (key, value) => meta.set(selector, value),
            },
    },
    localStorage: {
      getItem: () => {
        if (storageBlocked) throw new Error("Storage blocked");
        return saved;
      },
      setItem: (key, value) => {
        if (storageBlocked) throw new Error("Storage blocked");
        saved = value;
      },
    },
  });
  vm.runInContext(boot, context);
  const bootDark = classes.has("dark");
  vm.runInContext(toggleScript, context);
  return {
    classes,
    meta,
    attributes,
    bootDark,
    button,
    click: () => click(),
    saved: () => saved,
  };
}

for (const [saved, dark] of [
  [null, true],
  ["dark", true],
  ["light", false],
  ["invalid", true],
  ["", true],
]) {
  test(`saved theme ${JSON.stringify(saved)} stays consistent from boot to interactive page`, () => {
    const page = loadTheme(saved);
    assert.equal(page.bootDark, dark);
    assert.equal(page.classes.has("dark"), dark);
    assert.equal(page.attributes.get("aria-pressed"), String(dark));
    assert.equal(page.attributes.get("aria-label"), "Dark mode");
  });
}

test("theme toggle works in both directions and saves the selected theme", () => {
  const page = loadTheme(null);
  page.click();
  assert.equal(page.saved(), "light");
  assert.equal(page.attributes.get("aria-pressed"), "false");
  assert.equal(page.meta.get('meta[name="theme-color"]'), "#ffffff");
  page.click();
  assert.equal(page.saved(), "dark");
  assert.equal(page.attributes.get("aria-label"), "Dark mode");
});

test("blocked storage never prevents changing the theme", () => {
  const page = loadTheme(null, true);
  page.click();
  assert.equal(page.classes.has("dark"), false);
});
