/**
 * Static checks over the browser half.
 *
 * `client.js` is loaded verbatim, so a reference to something that no longer
 * exists is not a syntax error: it throws the first time that line runs, which
 * is usually during boot or on the first gesture. Two bulk edits here left
 * exactly that behind (`onModelFocusOut`, `textBoxOf`) while every other test
 * stayed green and only a real browser noticed. These checks are the cheap
 * substitute for that browser round trip.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/** Drop comments and string/template literals, keeping the code shape. */
function stripLiterals(source) {
	const out = [];
	let index = 0;
	while (index < source.length) {
		const character = source[index];
		if (character === "/" && source[index + 1] === "/") {
			const newline = source.indexOf("\n", index);
			index = newline === -1 ? source.length : newline;
			continue;
		}
		if (character === "/" && source[index + 1] === "*") {
			const end = source.indexOf("*/", index + 2);
			index = end === -1 ? source.length : end + 2;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			const quote = character;
			index += 1;
			while (index < source.length) {
				if (source[index] === "\\") {
					index += 2;
					continue;
				}
				if (source[index] === quote) {
					index += 1;
					break;
				}
				index += 1;
			}
			out.push('""');
			continue;
		}
		out.push(character);
		index += 1;
	}
	return out.join("");
}

/** Every name this file brings into scope. */
function declaredNames(code) {
	const declared = new Set();
	const add = (name) => {
		if (/^[A-Za-z_$][\w$]*$/.test(name ?? "")) declared.add(name);
	};
	// A parameter list is flat (`a, b`) or a destructured object
	// (`{ sessionId, useMenuOpenState }`).
	const addParameters = (params) => {
		const text = params.trim();
		if (text.startsWith("{")) {
			for (const inner of text.replace(/^\{|\}$/g, "").split(",")) add(inner.split(":")[0].trim());
			return;
		}
		for (const part of text.split(",")) add(part.split("=")[0].trim());
	};
	for (const match of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) add(match[1]);
	for (const match of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(match[1]);
	// Object/class method shorthand: `name(...) {`.
	for (const match of code.matchAll(/(?:^|[\s{,])([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) add(match[1]);
	// Object destructuring.
	for (const match of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
		for (const part of match[1].split(",")) add(part.split(":")[0].trim().split("=")[0].trim());
	}
	// Array destructuring (React state pairs).
	for (const match of code.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) {
		for (const part of match[1].split(",")) add(part.trim());
	}
	// Arrow parameters, parenthesised and single.
	for (const match of code.matchAll(/function\s*[A-Za-z_$\w]*\s*\(([^()]*)\)/g)) addParameters(match[1]);
	for (const match of code.matchAll(/\(([^()]*)\)\s*=>/g)) addParameters(match[1]);
	for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(match[1]);
	return declared;
}

/** Keywords that take a parenthesised clause rather than a call. */
const NOT_A_CALLEE = new Set([
	"if", "for", "while", "switch", "catch", "return", "typeof", "new", "function", "await", "yield",
	"delete", "void", "in", "of", "instanceof", "do", "else", "try", "throw", "case", "super", "import",
	"export", "async", "class", "extends",
]);

/** Browser and host globals a call may legitimately target. */
const GLOBALS = new Set([
	"parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
	"setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
	"queueMicrotask", "structuredClone", "fetch", "atob", "btoa", "getComputedStyle", "matchMedia",
	"Boolean", "Number", "String", "Array", "Object", "Math", "JSON", "Date", "Promise", "Map", "Set", "WeakMap",
	"WeakSet", "Symbol", "RegExp", "Error", "TypeError", "RangeError", "Uint8Array", "Uint32Array", "Intl",
	"URL", "URLSearchParams", "Element", "HTMLElement", "Node", "Event", "CustomEvent", "PointerEvent",
	"KeyboardEvent", "InputEvent", "MouseEvent", "TouchEvent", "Touch", "DataTransfer", "MessageChannel",
	"Notification", "AudioContext", "webkitAudioContext", "MutationObserver", "IntersectionObserver",
	"ResizeObserver", "AbortController", "TextEncoder", "TextDecoder", "Blob", "File", "FileReader", "Image",
	"FormData", "Headers", "Request", "Response", "Proxy", "Reflect", "BigInt", "crypto", "performance",
	"console", "localStorage", "sessionStorage", "document", "window", "navigator", "location", "screen",
	"history", "self", "globalThis", "arguments", "require",
]);

/** Identifiers called as functions that nothing declares. */
function undefinedCalls(code) {
	const declared = declaredNames(code);
	const calls = new Set();
	for (const match of code.matchAll(/(?<![.?\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(match[1]);
	return [...calls]
		.filter((name) => !declared.has(name) && !NOT_A_CALLEE.has(name) && !GLOBALS.has(name))
		.sort();
}

test("no call targets an undeclared identifier", () => {
	// This is what a deleted helper looks like: the definition goes, one call
	// site stays, and nothing notices until that line runs.
	assert.deepEqual(undefinedCalls(stripLiterals(CLIENT)), []);
});

test("every addEventListener handler is defined", () => {
	const missing = [];
	for (const match of CLIENT.matchAll(/addEventListener\(\s*"[a-z]+"\s*,\s*([A-Za-z_$][\w$]*)/g)) {
		if (match[1] === "async") continue;
		if (!new RegExp(`function ${match[1]}\\b|(?:const|let|var) ${match[1]}\\s*=`).test(CLIENT)) missing.push(match[1]);
	}
	assert.deepEqual(missing, [], "a listener is registered without a definition");
});

test("the bundle registers exactly one client module", () => {
	const registrations = CLIENT.match(/window\.__ModuleLoader__\.load\(/g) ?? [];
	assert.equal(registrations.length, 1, "one package is one browser module");
	assert.match(CLIENT, /window\.__ModuleLoader__\.load\(\{\s*\n\s*id:\s*"rdsh-pwa",/);
});

test("no data attribute is styled without ever being written", () => {
	const styled = new Set();
	for (const match of CLIENT.matchAll(/\[(data-rdsh-[a-z0-9-]+)\]/g)) styled.add(match[1]);
	const missing = [];
	for (const attribute of styled) {
		const exact = new RegExp(`(?:setAttribute|toggleAttribute)\\(\\s*"${attribute}"`).test(CLIENT);
		const prefix = attribute.split("-").slice(0, -1).join("-");
		const templated = new RegExp(`(?:setAttribute|toggleAttribute)\\(\\s*\`${prefix}-\\$\\{`).test(CLIENT);
		const quoted = new RegExp("[\"'`]" + attribute + "[\"'`]").test(CLIENT.replace(/\[(data-rdsh-[a-z0-9-]+)\]/g, ""));
		if (!exact && !templated && !quoted) missing.push(attribute);
	}
	assert.deepEqual(missing, [], "styled but never written");
});
