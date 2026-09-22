import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import test from "node:test";

const boot = readFileSync(
  new URL("../dist/client/theme-boot.js", import.meta.url),
  "utf8",
);
function loadTheme(saved: string | null, storageBlocked = false) {
  const classes = new Set(["dark"]);
  const meta = new Map<string, string>();
  const root = {
    classList: {
      contains: (name: string) => classes.has(name),
      toggle: (name: string, enabled: boolean) =>
        enabled ? classes.add(name) : classes.delete(name),
    },
  };
  const context = vm.createContext({
    console: { warn() {} },
    document: {
      documentElement: root,
      querySelector: (selector: string) => ({
        setAttribute: (_key: string, value: string) =>
          meta.set(selector, value),
      }),
    },
    localStorage: {
      getItem: () => {
        if (storageBlocked) throw new Error("Storage blocked");
        return saved;
      },
    },
  });
  vm.runInContext(boot, context);
  return {
    classes,
    meta,
  };
}

const preferences: [string | null, boolean][] = [
  [null, true],
  ["dark", true],
  ["light", false],
  ["invalid", true],
  ["", true],
];
for (const [saved, dark] of preferences) {
  test(`saved theme ${JSON.stringify(saved)} is resolved before the page renders`, () => {
    const page = loadTheme(saved);
    assert.equal(page.classes.has("dark"), dark);
    assert.equal(
      page.meta.get('meta[name="color-scheme"]'),
      dark ? "dark" : "light",
    );
    assert.equal(
      page.meta.get('meta[name="theme-color"]'),
      dark ? "#0b0b0b" : "#ffffff",
    );
  });
}

test("blocked storage defaults to dark without breaking boot", () => {
  const page = loadTheme(null, true);
  assert.equal(page.classes.has("dark"), true);
  assert.equal(page.meta.get('meta[name="theme-color"]'), "#0b0b0b");
});
