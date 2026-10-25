import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const helper = source.match(/    function decorateMobileSettingsTabs\(modal\) \{[\s\S]*?\n    \}/)[0];

function fixture(label, active = label, mobileMode = true) {
  const tabs = [label, "モバイル", "Models"].map((textContent) => {
    const attrs = new Map(textContent === active ? [["aria-current", "true"]] : []);
    return { textContent, clicks: 0, focused: false,
      toggleAttribute(key, value) { if (value) attrs.set(key, ""); else attrs.delete(key); },
      getAttribute(key) { return attrs.get(key) ?? null; },
      hasAttribute(key) { return attrs.has(key); },
      click() { this.clicks++; for (const tab of tabs) tab.toggleAttribute("aria-current", false); attrs.set("aria-current", "true"); },
      focus() { this.focused = true; },
    };
  });
  const decorate = vm.runInNewContext(`(${helper.trim()})`, {
    phone: () => mobileMode,
    t: () => "モバイル",
    labelOf: (button) => button.textContent,
    readGeneralSettingsLabel: () => label,
  });
  return { tabs, run: () => decorate({ querySelectorAll: () => tabs }) };
}

for (const label of ["General", "一般", "一般設定", "通用设置"]) {
  test(`hides ${label} and switches its active content to Mobile`, () => {
    const f = fixture(label); f.run();
    assert(f.tabs[0].hasAttribute("data-rdsh-settings-tab-hidden"));
    assert.equal(f.tabs[1].clicks, 1);
    assert.equal(f.tabs[1].focused, true);
    assert(!f.tabs[1].hasAttribute("data-rdsh-settings-tab-hidden"));
    f.run(); assert.equal(f.tabs[1].clicks, 1, "must not repeatedly steal selection");
  });
}

test("preserves an existing Models selection", () => {
  const f = fixture("General", "Models"); f.run();
  assert.equal(f.tabs[1].clicks, 0);
  assert.equal(f.tabs[2].getAttribute("aria-current"), "true");
});

test("does not touch desktop tabs", () => {
  const f = fixture("General", "General", false); f.run();
  assert(!f.tabs[0].hasAttribute("data-rdsh-settings-tab-hidden"));
  assert.equal(f.tabs[1].clicks, 0);
});

test("Mobile sorts before the stock General order of zero", () => {
  assert.match(source, /id: "mobile-ux",\s+order: -1,/);
});
