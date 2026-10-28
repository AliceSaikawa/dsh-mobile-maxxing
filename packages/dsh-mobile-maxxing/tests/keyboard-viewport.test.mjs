/**
 * iOS Safari ignores `interactive-widget=resizes-content`: with the keyboard up
 * only the visual viewport shrinks, and Safari pans the page to the caret. The
 * header then scrolls away and the composer's send button ends up under the
 * keyboard's floating form bar. The app must be pinned to the visual viewport
 * instead.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/** Run the pin against a fake window and report what it published. */
function pinFor(viewport, { phone = true, innerHeight = 800, dvh = 800, dialog = false, innerWidth = 390 } = {}) {
	const start = CLIENT.indexOf("    let heightProbe = null;");
	const end = CLIENT.indexOf("    function measureSafeArea()");
	assert.ok(start !== -1 && end > start, "keyboardOpen and fitVisualViewport are in the bundle");
	const attributes = new Map();
	const properties = new Map();
	const root = {
		toggleAttribute(name, force) { if (force) attributes.set(name, ""); else attributes.delete(name); },
		style: { setProperty(name, value) { properties.set(name, value); } },
	};
	const probe = { style: {}, isConnected: false, setAttribute() {}, remove() { this.isConnected = false; }, getBoundingClientRect: () => ({ height: dvh }) };
	const body = { append(node) { node.isConnected = true; } };
	const document = { documentElement: root, body, createElement: () => probe, querySelector: () => dialog ? {} : null };
	const sandbox = { window: { visualViewport: viewport, innerHeight, innerWidth }, document, Math, phone: () => phone };
	vm.runInNewContext(`${CLIENT.slice(start, end)}\nfitVisualViewport();`, sandbox);
	return { attributes: [...attributes.keys()], properties: Object.fromEntries(properties) };
}

test("with the keyboard up the app is pinned to the visual viewport", () => {
	// 800px layout, 480px left above the keyboard, panned 150px down by Safari.
	const open = pinFor({ height: 480, offsetTop: 150, scale: 1 });
	assert.deepEqual(open.attributes, ["data-rdsh-keyboard"]);
	assert.deepEqual(open.properties, { "--rdsh-vv-top": "150px", "--rdsh-vv-height": "480px" });
});

test("the pin works when the browser shrinks innerHeight with the keyboard", () => {
	// innerHeight follows the keyboard (480) but 100dvh keeps the web view height.
	const open = pinFor({ height: 480, offsetTop: 0, scale: 1 }, { innerHeight: 480, dvh: 800 });
	assert.deepEqual(open.attributes, ["data-rdsh-keyboard"]);
	assert.equal(open.properties["--rdsh-vv-height"], "480px");
	// Everything shrank together: the layout already fits, nothing to pin.
	assert.deepEqual(pinFor({ height: 480, offsetTop: 0, scale: 1 }, { innerHeight: 480, dvh: 480 }).attributes, []);
});

test("a pinch zoom, a closed keyboard or a desktop does not pin the app", () => {
	assert.deepEqual(pinFor({ height: 480, offsetTop: 0, scale: 2 }).attributes, [], "zoom shrinks the visual viewport too");
	assert.deepEqual(pinFor({ height: 790, offsetTop: 0, scale: 1 }).attributes, [], "a small inset is not a keyboard");
	assert.deepEqual(pinFor(undefined).attributes, [], "no visualViewport support");
	assert.deepEqual(pinFor({ height: 480, offsetTop: 150, scale: 1 }, { phone: false }).attributes, [], "desktop stays stock");
});

test("a landscape composer keeps its own keyboard and scroll geometry", () => {
	assert.deepEqual(pinFor({ height: 200, offsetTop: 0, scale: 1 }, { innerWidth: 844, innerHeight: 390, dvh: 390 }).attributes, []);
});

test("a dialog keeps its own keyboard and scroll geometry", () => {
	assert.deepEqual(pinFor({ height: 480, offsetTop: 150, scale: 1 }, { dialog: true }).attributes, []);
});

test("the pin is torn down with the phone hooks", () => {
	const release = CLIENT.slice(CLIENT.indexOf("    function releaseSafeArea()"), CLIENT.indexOf("    let heightProbe = null;"));
	assert.match(release, /removeAttribute\("data-rdsh-keyboard"\)/);
	assert.match(release, /removeProperty\("--rdsh-vv-height"\)/);
});
