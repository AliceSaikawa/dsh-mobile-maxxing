/**
 * #59 safe area: a landscape notch sits on the left or the right, and in
 * portrait the status bar sits above everything. Every fixed layer has to
 * take its inset from the device (`env(safe-area-inset-*)`), and every
 * JS-positioned popover from the values `measureSafeArea()` read, because
 * neither side can see the other.
 *
 * These checks are the source contract: the mobile stylesheet carries the
 * env() declarations, the desktop sheet carries none of them (#44), and the
 * popover code clamps through `safeInset()` instead of a fixed 12px. The
 * measured values themselves are driven through the stub browser in
 * `boundary-issues.test.mjs`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

const TICK = String.fromCharCode(96);

/** Pull one `const NAME = ...;` stylesheet out of the client bundle. */
function cssTemplate(name) {
	const match = CLIENT.match(new RegExp(`const ${name} = ${TICK}([\\s\\S]*?)${TICK};\\n`));
	assert.ok(match, `${name} exists`);
	return match[1];
}

/** The body of the rule whose head is exactly `selector`. */
function ruleBody(css, selector) {
	const head = `${selector} {`;
	const start = css.indexOf(head);
	assert.notEqual(start, -1, `${selector} has no rule`);
	const end = css.indexOf("}", start);
	assert.notEqual(end, -1, `${selector} rule is unterminated`);
	return css.slice(start + head.length, end);
}

/** The source of one top-level `function name(...)` in the module. */
function functionBody(name) {
	const start = CLIENT.indexOf(`\n    function ${name}(`);
	assert.notEqual(start, -1, `${name} exists`);
	const end = CLIENT.indexOf("\n    }\n", start);
	assert.notEqual(end, -1, `${name} is terminated`);
	return CLIENT.slice(start, end);
}

test("every fixed layer pads the notch side itself", () => {
	const phone = cssTemplate("CSS_PHONE");
	const layers = [
		[".rdsh-mux-fab", ["left: calc(env(safe-area-inset-left, 0px) + 8px)"]],
		["[data-rdsh-sidebar]", [
			"padding-left: env(safe-area-inset-left, 0px)",
			"padding-right: env(safe-area-inset-right, 0px)",
		]],
		["[data-shortcut-modal=\"settings\"]", [
			"padding-left: env(safe-area-inset-left, 0px)",
			"padding-right: env(safe-area-inset-right, 0px)",
		]],
		["[data-shortcut-modal=\"settings\"] [data-rdsh-settings-close]", [
			"right: calc(env(safe-area-inset-right, 0px) + 12px) !important",
		]],
		["[data-rdsh-rightpanel]", [
			"padding-top: env(safe-area-inset-top, 0px) !important",
			"padding-left: env(safe-area-inset-left, 0px) !important",
			"padding-right: env(safe-area-inset-right, 0px) !important",
		]],
	];
	for (const [selector, declarations] of layers) {
		const body = ruleBody(phone, selector);
		for (const declaration of declarations) {
			assert.ok(body.includes(declaration), `${selector} lost: ${declaration}`);
		}
	}
});

test("the root pads the in-flow content on every side", () => {
	const phone = cssTemplate("CSS_PHONE");
	// The header, the transcript and the composer are in flow inside #root, so
	// the root padding is what moves them clear of a landscape notch.
	assert.match(ruleBody(phone, "html[data-rdsh-safe-left] #root"), /padding-left: env\(safe-area-inset-left, 0px\)/);
	assert.match(ruleBody(phone, "html[data-rdsh-safe-right] #root"), /padding-right: env\(safe-area-inset-right, 0px\)/);
	assert.match(ruleBody(phone, "html[data-rdsh-safe-top] #root"), /padding-top: env\(safe-area-inset-top, 0px\)/);
});

test("the left/right insets never reach the desktop stylesheet", () => {
	const device = cssTemplate("CSS_DEVICE");
	for (const pattern of [
		"#root",
		"[data-rdsh-sidebar]",
		".rdsh-mux-fab",
		"[data-shortcut-modal=\"settings\"]",
		"[data-rdsh-rightpanel]",
		"data-rdsh-safe-left",
		"data-rdsh-safe-right",
		"safe-area-inset-left",
		"safe-area-inset-right",
	]) {
		assert.equal(device.includes(pattern), false, `the desktop sheet gained a phone-only rule: ${pattern}`);
	}
});

test("the JS popovers clamp against the measured insets", () => {
	for (const name of ["showDetailPopover", "showTitlePopover", "queueMenuAt", "openFilesMenu"]) {
		const body = functionBody(name);
		for (const edge of ["left", "right", "top"]) {
			assert.ok(body.includes(`safeInset("${edge}")`), `${name} does not read the ${edge} inset`);
		}
		assert.equal(body.includes("Math.max(12,"), false, `${name} still clamps to a fixed 12px`);
	}
});

test("the measured values are released with the rest of the surface", () => {
	const release = functionBody("releaseSafeArea");
	assert.ok(release.includes('["top", "bottom", "left", "right"]'), "the attribute release list lost an edge");
	assert.match(release, /root\.removeAttribute\(`data-rdsh-safe-\$\{name\}`\)/, "the attribute release is gone");
	for (const edge of ["left", "right"]) {
		assert.ok(release.includes(`root.style.removeProperty("--rdsh-safe-${edge}")`), `releaseSafeArea keeps --rdsh-safe-${edge}`);
	}
	const measure = functionBody("measureSafeArea");
	for (const edge of ["left", "right"]) {
		assert.ok(measure.includes(`root.style.setProperty("--rdsh-safe-${edge}"`), `measureSafeArea does not publish --rdsh-safe-${edge}`);
	}
});
