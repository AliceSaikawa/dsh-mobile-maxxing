/**
 * Static checks for the phone/desktop split (#17, #15).
 *
 * The behaviour these guard is "what happens on a narrow desktop window":
 * nothing may be hidden, relabelled or hijacked there, and the settings tabs
 * may not be duplicated. That is hard to assert without a browser, but the
 * decision points are few and their shape is the contract, so checking the
 * source is enough to catch a regression that reverts a gate to `narrow()`.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const HOST = readFileSync(new URL("../notify/host.js", import.meta.url), "utf8");

/** One top-level helper, from its declaration to its closing brace. */
function functionBody(name) {
	const start = CLIENT.indexOf(`function ${name}(`);
	assert.notEqual(start, -1, `${name} exists`);
	const close = CLIENT.indexOf("\n    }\n", start);
	return CLIENT.slice(start, close === -1 ? undefined : close);
}

/** The lines of one `const NAME = [ ... ];` array literal. */
function arrayLiteral(name) {
	const start = CLIENT.indexOf(`const ${name} = [`);
	assert.notEqual(start, -1, `${name} exists`);
	const end = CLIENT.indexOf("];", start);
	return CLIENT.slice(start, end === -1 ? undefined : end);
}

test("hiding is decided by the device, not by the window width", () => {
	// #17: a 683px desktop window has a mouse, a keyboard and local editors,
	// so every control it can use has to stay. Only the phone predicate gates
	// the hide list; `narrow()` is left for the layout.
	const body = functionBody("applyHideList");
	assert.match(body, /const hideOnThisDevice = !disabled && phone\(\);/, "the hide decision ignores the device");
	assert.match(body, /if \(hideOnThisDevice && shouldHide\(label, labels\)\)/, "buttons are hidden without asking the device");
	assert.match(body, /modal !== null && narrow\(\) && phone\(\)/, "the PWA/Input tab merge no longer follows the phone layout");
	assert.doesNotMatch(body, /!disabled && narrow\(\)/, "a narrow desktop window would hide controls again");
});

test("the hide-settings attribute follows the device", () => {
	assert.match(CLIENT, /const onPhone = phone\(\);/, "decorateFast does not ask the device");
	assert.match(
		CLIENT,
		/document\.documentElement\.toggleAttribute\("data-rdsh-hide-settings", !hideListDisabled && onPhone\);/,
		"the settings-hiding attribute is still gated on the width",
	);
	// The CSS that consumes it may live outside the phone media block only
	// because the attribute is a phone-only signal; make both halves agree.
	assert.match(CLIENT, /html\[data-rdsh-hide-settings\] \[data-rdsh-setting-hidden\]/);
});

test("label rewrites and the plus hijack stay on phones", () => {
	// #17: these changed what a narrow desktop window does, not just how it
	// looks: the account menu vanished, "+" stopped opening commands, and the
	// composer lost its stock label.
	const sidebar = functionBody("decorateSidebarSettingsRow");
	assert.match(sidebar, /if \(!phone\(\)\) \{/, "the sidebar Settings row is still width-gated");
	assert.match(sidebar, /removeAttribute\("data-rdsh-more-row"\)/, "leaving the phone layout leaves the account row hidden");
	assert.match(functionBody("decorateComposer"), /if \(phone\(\)\) \{/, "the composer label is still width-gated");
	assert.match(functionBody("onMouseDownCapture"), /if \(!phone\(\)\) return;/, "the mousedown guard is still width-gated");
	assert.match(functionBody("onClickCapture"), /addButtonOf\(target\) !== null && phone\(\)/, "the + hijack is still width-gated");
});

test("only controls that dead-end on a phone are hidden by default", () => {
	// Fail open: anything that works on a phone, or is a design judgement,
	// stays. The three named by #17 plus the menu items a phone can use.
	const defaults = arrayLiteral("HIDE_DEFAULT");
	for (const label of [
		"Built-in plugins",
		"Show coding view",
		"Keyboard shortcuts",
		"Feedback",
		"Sign in",
		"More actions",
		"More ways to open",
		"Desktop notifications",
	]) {
		assert.equal(defaults.includes(label), false, `${label} is hidden without a phone-only reason`);
	}
	assert.match(defaults, /"Open configuration file"/, "the host-side action moved out of its own rule");
});

test("the mobile tab only inlines the other sections at phone width", () => {
	// #15: on a desktop, "App" and "Input" are their own visible tabs. The
	// Mobile tab inlining them as well printed both headings twice.
	const body = functionBody("MobileSection");
	assert.match(body, /const onPhone = s\.phone === true;/, "the section still keys off the layout");
	assert.match(body, /s\.narrow && onPhone \? h\(InputSection\) : null/, "InputSection is inlined on a narrow desktop window");
	assert.match(
		body,
		/s\.narrow && onPhone && typeof globalThis\.__RDSH_PWA_SETTINGS_SECTION__ === "function"/,
		"the PWA section is inlined on a narrow desktop window",
	);
	assert.doesNotMatch(body, /^\s+h\(InputSection\),$/m, "the old unconditional InputSection call is back");
	// Both tabs must still exist for the wide layout.
	assert.match(CLIENT, /id: "pwa",/, "the App tab is gone");
	assert.match(CLIENT, /id: "mobile-ux-input",/, "the Input tab is gone");
});

test("the phone-only settings cards are not shown on a desktop", () => {
	const body = functionBody("MobileSection");
	assert.match(body, /onPhone \? t\("mux\.section\.desc"\) : t\("mux\.section\.desc\.desktop"\)/, "the desktop description is missing");
	assert.match(body, /onPhone \? h\("p", \{ className: "rdsh-mux-note" \}, t\("mux\.section\.plusNote"\)\) : null/, "the + note is shown on a desktop");
	assert.match(body, /onPhone\s*\n\s*\? h\(/, "the hidden-controls card is not gated on the device");
	assert.match(body, /t\("mux\.hidden\.title"\)/, "the hidden-controls card disappeared entirely");
});

test("a desktop send can opt into phone-style notifications", () => {
	// #15: `onlyMobileTurns: true` stays the host default; the client marks its
	// own sends through the endpoint a phone uses once this browser opts in.
	assert.match(HOST, /onlyMobileTurns: true/, "the host default must stay phone-only");
	assert.match(CLIENT, /const NOTIFY_DEVICE_TURNS_KEY = "rdsh-mobile-ux:notify-device-turns";/);
	assert.match(functionBody("readNotifyDeviceTurns"), /NOTIFY_DEVICE_TURNS_KEY/);
	const mark = functionBody("markMobileSession");
	assert.match(mark, /if \(!phone\(\) && !notifyDeviceTurns\(\)\) return;/, "markMobileSession ignores the opt-in (or is still width-gated)");
	// Both send paths have to honour it, or only one kind of send is notified.
	assert.match(functionBody("onKeyDownCapture"), /if \(!finger && !notifyDeviceTurns\(\)\) return;/, "Enter sends are not marked on a desktop");
	assert.match(functionBody("onClickCapture"), /if \(phone\(\) \|\| notifyDeviceTurns\(\)\)/, "button sends are not marked on a desktop");
	assert.match(functionBody("MobileSection"), /writeNotifyDeviceTurns\(event\.target\.checked\)/, "the setting has no control");
});
