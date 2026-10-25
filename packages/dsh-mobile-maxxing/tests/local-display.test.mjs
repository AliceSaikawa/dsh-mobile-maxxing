/**
 * Device-local display settings: font sizes and UI language.
 *
 * Static contract checks only. The runtime behaviour is covered by the
 * existing desktop-noop recorder (desktop never reaches this code) and by the
 * mobile Settings section tests; this file pins the two new controls to
 * localStorage, the public read APIs, and the absence of shared writers.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const COPY = readFileSync(new URL("../lib/copy.js", import.meta.url), "utf8");

function block(start, end) {
	const at = CLIENT.indexOf(start);
	assert.notEqual(at, -1, `${start} exists`);
	const close = CLIENT.indexOf(end, at);
	assert.notEqual(close, -1, `${end} follows ${start}`);
	return CLIENT.slice(at, close);
}

test("local display copy exists in both shipped packs", () => {
	const keys = [
		"localDisplay.title",
		"localDisplay.desc",
		"localDisplay.text",
		"localDisplay.code",
		"localDisplay.terminal",
		"localDisplay.language",
		"localDisplay.language.system",
		"localDisplay.language.note",
		"localDisplay.note",
		"localDisplay.unavailable",
		"localDisplay.reason.themeMissing",
		"localDisplay.reason.themeShape",
		"localDisplay.reason.localeMissing",
		"localDisplay.reason.localeShape",
		"localDisplay.reason.noLocales",
	];
	const en = COPY.slice(COPY.indexOf("en: {"), COPY.indexOf("ja: {"));
	const ja = COPY.slice(COPY.indexOf("ja: {"));
	for (const key of keys) {
		assert.match(en, new RegExp(`"${key.replace(".", "\\.")}":\\s*"`), `${key} missing from en`);
		assert.match(ja, new RegExp(`"${key.replace(".", "\\.")}":\\s*"`), `${key} missing from ja`);
	}
});

test("the Mobile section owns the independent LocalDisplaySettingsSection", () => {
	const body = block("function MobileSection(", "function InputSection(");
	assert.match(body, /onPhone \? h\(LocalDisplaySettingsSection\) : null/);
	assert.match(body, /onPhone \? h\(InputSection\) : null/,
		"the existing Input section was displaced");
	assert.match(CLIENT, /function LocalDisplaySettingsSection\(\)/, "the independent component is gone");
	assert.match(CLIENT, /function setLocalDisplayFont\(role, delta\)/);
	assert.match(CLIENT, /function setLocalDisplayLanguage\(id\)/);
});

test("display choices are device-local and use only localStorage", () => {
	const body = block("function readLocalDisplaySettings()", "function clampLocalFont(");
	assert.match(body, /LOCAL_DISPLAY_KEY/);
	assert.match(body, /localStorage\.getItem/);
	assert.match(body, /JSON\.parse/);
	assert.match(CLIENT, /const LOCAL_DISPLAY_KEY = "rdsh-mobile-ux:local-display";/);
	const codeOnly = CLIENT.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
	assert.doesNotMatch(codeOnly, /ctx\.settings|configForms|api\.remote|dsh-api-remotes/,
		"a shared settings/remote API was introduced");
});

test("font sizes use the published theme variables and exact roles", () => {
	for (const [role, variable] of [
		["text", "--dsh-content-font-size"],
		["code", "--dsh-code-font-size"],
		["terminal", "--dsh-terminal-font-size"],
	]) {
		assert.match(CLIENT, new RegExp(`\\b${role}: \\{ min: \\d+, max: \\d+, default: \\d+, variable: "${variable}" \\}`));
	}
	const body = block("function attachLocalDisplay(ctx) {", "function localeOptions(");
	assert.match(body, /theme\.getTheme\(\)|themeService\?\.getTheme\(\)/);
	assert.match(body, /locale\.getSnapshot\(\)|localeService\?\.getSnapshot\(\)/);
	assert.match(body, /themeService\.snapshot = hostTheme/, "the Host theme is not restored");
	assert.match(body, /localeService\.snapshot = hostLocale/, "the Host locale is not restored");
	assert.doesNotMatch(body, /\.setFontSize\(|\.setLocale\(/, "a shared writer is called");
});

test("the ja pack is registered through the locale API, not guessed into the list (#64)", () => {
	assert.match(COPY, /export const LOCALE_PACKS = \{/);
	assert.match(COPY, /language: \{ id: "ja", label: "日本語", fallback: "en" \}/,
		"the pack must declare its own id, label and fallback");
	for (const namespace of ["common", "settings", "settings.locale"]) {
		const key = namespace.replace(".", "\\.");
		assert.match(COPY, new RegExp(`\\n\\t\\t\\t"?${key}"?: \\{`),
			`${namespace} has no ja dictionary`);
	}
	const installer = block(
		"function installJapaneseLocale(localeService) {",
		"    /** Read only this browser's display choices",
	);
	assert.match(installer, /addLanguage\(pack\.language\)/, "addLanguage was not used");
	assert.match(installer, /register\(namespace, "ja", dictionary\)/, "the dictionaries were not registered");
	assert.match(installer, /if \(!phone\(\)/, "the pack is not gated to the mobile surface");
	assert.doesNotMatch(installer, /"zh"|"en"/, "the pack touched a shipped locale");
	assert.match(CLIENT, /const JA_LOCALE_PACK = globalThis\.__RDSH_PWA_LOCALES__\?\.ja \?\? null;/);
});

test("language options are the locale service's registered list, never a guessed ja", () => {
	const body = block("function localeOptions(localeService) {", "function normalizeCommandContribution(");
	assert.match(body, /localeService\?\.getSnapshot\?\.\(\)/);
	assert.match(body, /snapshot\?\.locales/);
	assert.doesNotMatch(body, /"ja"|'ja'/, "a Japanese locale was invented");
	// The DSH UI follows the local snapshot; plugin copy follows currentLang.
	assert.match(CLIENT, /localDisplayLanguage/, "the copy language hook is missing");
	assert.match(CLIENT, /const local = knownLang\(localDisplayLanguage\);/);
});
