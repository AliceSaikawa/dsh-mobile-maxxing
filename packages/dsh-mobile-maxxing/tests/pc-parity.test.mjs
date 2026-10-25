/**
 * Static checks for the device-mode / desktop split.
 *
 * The contract is the host bootstrap value `__RDSH_DEVICE_MODE__`, consumed
 * by client.js. A narrow desktop window stays desktop; a wide phone/tablet
 * stays mobile. Width is geometry only, and the mobile stylesheet is enabled
 * by mode rather than by a max-width wrapper. These checks pin the decision
 * points and add a few negative controls against the old width rule.
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

test("hiding follows the device mode, not the window width", () => {
	const body = functionBody("applyHideList");
	assert.match(body, /const hideOnThisDevice = !disabled && phone\(\);/, "the hide decision ignores the mode");
	assert.match(body, /if \(hideOnThisDevice && shouldHide\(label, labels\)\)/, "buttons are hidden without asking the mode");
	assert.match(body, /modal !== null && phone\(\)/, "the PWA/Input tab merge no longer follows the mode");
	assert.doesNotMatch(body, /!disabled && narrow\(\)/, "the hide list is width-gated again");
});

test("the hide-settings attribute follows the mobile mode", () => {
	assert.match(CLIENT, /const onPhone = phone\(\);/, "decorateFast does not ask the device");
	assert.match(
		CLIENT,
		/document\.documentElement\.toggleAttribute\("data-rdsh-hide-settings", onPhone && !hideListDisabled\);/,
		"the settings-hiding attribute is not mode-gated",
	);
	assert.match(CLIENT, /html\[data-rdsh-hide-settings\] \[data-rdsh-setting-hidden\]/);
});

test("label rewrites and the plus hijack follow phone()", () => {
	assert.match(functionBody("phone"), /return DEVICE_MODE === "mobile";/, "phone() is not the bootstrapped mode");
	const sidebar = functionBody("decorateSidebarSettingsRow");
	assert.match(sidebar, /if \(!phone\(\)\) \{/, "the sidebar Settings row is not mode-gated");
	assert.match(sidebar, /removeAttribute\("data-rdsh-more-row"\)/, "leaving the mobile mode leaves the account row hidden");
	const composer = functionBody("decorateComposer");
	assert.match(composer, /if \(!phone\(\)\) \{/, "the composer decoration is not mode-gated");
	assert.match(composer, /clearComposerHooks\(\)/, "leaving the mobile mode does not restore the stock composer");
	assert.match(functionBody("onMouseDownCapture"), /if \(!phone\(\)\) return;/, "the mousedown guard is not mode-gated");
	assert.match(functionBody("onClickCapture"), /addButtonOf\(target\) !== null && phone\(\)/, "the + hijack is not mode-gated");
});

test("the reference 13-label hide list is restored", () => {
	const defaults = arrayLiteral("HIDE_DEFAULT");
	for (const label of [
		"Open in Files",
		"More ways to open",
		"More actions",
		"Feedback",
		"Sign in",
		"Keyboard shortcuts",
		"Desktop notifications",
		"Show coding view",
		"Built-in plugins",
		"Open in Text Editor",
		"Open in editor",
		"Open in Explorer",
		"Reveal in Finder",
	]) {
		assert.equal(defaults.includes(`"${label}"`), true, `${label} is missing from the hide list`);
	}
	assert.match(defaults, /"Open configuration file"/, "the merged-build addition was dropped");
});

test("the mobile tab inlines the other sections by mode, not by width", () => {
	const body = functionBody("MobileSection");
	assert.match(body, /const onPhone = s\.phone === true;/, "the section still keys off the device");
	assert.match(body, /onPhone \? h\(InputSection\) : null/, "InputSection is not inlined in mobile mode");
	assert.match(
		body,
		/onPhone && typeof globalThis\.__RDSH_PWA_SETTINGS_SECTION__ === "function"/,
		"the PWA section is not inlined in mobile mode",
	);
	assert.doesNotMatch(body, /s\.narrow && onPhone/, "the inline decision is still width-gated");
	assert.match(CLIENT, /id: "pwa",/, "the App tab is gone");
	assert.match(CLIENT, /id: "mobile-ux-input",/, "the Input tab is gone");
});

test("the mobile-only settings cards follow the device mode", () => {
	const body = functionBody("MobileSection");
	assert.match(body, /onPhone \? t\("mux\.section\.desc"\) : t\("mux\.section\.desc\.desktop"\)/, "the desktop description is missing");
	assert.match(body, /onPhone \? h\("p", \{ className: "rdsh-mux-note" \}, t\("mux\.section\.plusNote"\)\) : null/, "the + note is shown on a desktop");
	assert.match(body, /onPhone\s*\n\s*\? h\(/, "the hidden-controls card is not gated on the device");
	assert.match(body, /t\("mux\.hidden\.title"\)/, "the hidden-controls card disappeared entirely");
});

test("a desktop stays stock unless it opts into mobile notifications", () => {
	assert.match(HOST, /onlyMobileTurns: true/, "the host default must stay mobile-only");
	assert.match(CLIENT, /const NOTIFY_DEVICE_TURNS_KEY = "rdsh-mobile-ux:notify-device-turns";/);
	assert.match(functionBody("readNotifyDeviceTurns"), /NOTIFY_DEVICE_TURNS_KEY/);
	const mark = functionBody("markMobileSession");
	assert.match(mark, /if \(!phone\(\) && !notifyDeviceTurns\(\)\) return;/, "markMobileSession ignores the opt-in");
	assert.match(functionBody("onKeyDownCapture"), /const finger = phone\(\);/, "Enter no longer follows the device mode");
	assert.match(functionBody("onKeyDownCapture"), /if \(!finger && !notifyDeviceTurns\(\)\) return;/, "Enter ignores the desktop opt-in");
	assert.match(functionBody("onClickCapture"), /if \(phone\(\) \|\| notifyDeviceTurns\(\)\)/, "button sends are not marked on a desktop");
	assert.match(functionBody("MobileSection"), /writeNotifyDeviceTurns\(event\.target\.checked\)/, "the setting has no control");
});

test("the bootstrap is the only mode source and width never selects it", () => {
	// Client consumes the canonical string. It must not rebuild the decision
	// from UA, touch points, pointer media or the window width.
	assert.match(CLIENT, /globalThis\.__RDSH_DEVICE_MODE__/, "the canonical bootstrap global is not read");
	assert.match(CLIENT, /data-rdsh-device-mode/, "the canonical HTML attribute is not used");
	assert.doesNotMatch(CLIENT, /userAgentData|pointer:\s*coarse|hover:\s*none/, "client re-classifies the device");
	assert.doesNotMatch(CLIENT, /if \(!narrow\(\)\)[\s\S]{0,80}clearPhoneHooks/, "a width crossing still tears the mobile surface down");
	assert.match(CLIENT, /const applyWidthBoundary = \(\) => \{\s*\n\s*emit\(\{ narrow: narrow\(\) \}\);/, "syncWidth does not stay geometry-only");
});

test("the mobile stylesheet is enabled by mode, not by a max-width wrapper", () => {
	assert.doesNotMatch(CLIENT, /phoneStyles\s*=/, "the max-width wrapper still exists");
	assert.doesNotMatch(CLIENT, /@media \(max-width: 767px\)/, "a hand-written 767px feature query exists");
	assert.match(CLIENT, /setAttribute\("data-rdsh-mux-style", "phone"\)/, "the mobile stylesheet is not a separate mode-scoped style");
	assert.match(CLIENT, /if \(phone\(\)\) \{\s*\n\s*phoneStyle = document\.createElement\("style"\)/, "the mobile stylesheet is not mode-gated");
	// The PWA install/toast geometry follows the same attribute.
	assert.match(CLIENT, /html\[data-rdsh-device-mode="mobile"\] \.dsh-mobile-maxxing-toasts/, "the PWA mobile CSS is not mode-scoped");
	// A genuine small-viewport sizing tweak may remain.
	assert.match(CLIENT, /@media \(max-width: 380px\)/, "the existing small-phone sizing rule was lost");
	// The install card follows the device, so a wide tablet still offers it.
	assert.match(CLIENT, /if \(state\.mode !== "mobile"\) return false;/, "the install card is not mobile-mode gated");
	assert.match(CLIENT, /mode: DEVICE_MODE,/, "the PWA store does not expose the bootstrapped mode");
});
