/**
 * #44 desktop/mobile boundary and #46 right-panel layering.
 *
 * The regex checks in `client-integrity.test.mjs` pin the source shape. This
 * file drives the actual transition instead: the module is booted in a stub
 * browser, the width predicate is flipped 767→768→767, `syncWidth()` is
 * called exactly as the media-query listener calls it, and the resulting DOM
 * is inspected. It also parses the two stylesheets the browser receives and
 * proves the phone half is wrapped mechanically.
 *
 * The browser geometry check for #46 lives in `boundary-layering.e2e.mjs`
 * (run with the CDP endpoint); this file cannot measure layout.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { COPY, PROBES } from "../lib/copy.js";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/* ------------------------------------------------------------------ */
/* Stylesheet parsing                                                  */
/* ------------------------------------------------------------------ */

function cssTemplate(name) {
	const tick = String.fromCharCode(96);
	const match = CLIENT.match(new RegExp(`const ${name} = ${tick}([\\s\\S]*?)${tick};\\n`));
	assert.ok(match, `${name} exists`);
	return match[1].replace(/\$\{NARROW_QUERY\}/g, "(max-width: 767px)");
}

function cssBlocks() {
	return [
		cssTemplate("CSS"),
		`${cssTemplate("CSS_DEVICE")}\n@media (max-width: 767px) {\n${cssTemplate("CSS_PHONE")}\n}`,
	];
}

/** One entry per declaration block, with the chain of enclosing at-rules. */
function cssRules(css) {
	const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = [];
	const stack = [];
	let current = "";
	for (const character of source) {
		if (character === "{") {
			stack.push(current.trim());
			if (current.trim() !== "") rules.push({ head: current.trim(), at: [...stack.slice(0, -1)] });
			current = "";
			continue;
		}
		if (character === "}") {
			stack.pop();
			current = "";
			continue;
		}
		current += character;
	}
	return rules;
}

const inPhone = (rule) => rule.at.some((head) => /max-width:\s*767px/.test(head));

test("the phone stylesheet is mechanically wrapped in the 767px query", () => {
	const phone = cssRules(`@media (max-width: 767px) {\n${cssTemplate("CSS_PHONE")}\n}`);
	const leaked = phone.filter((rule) => rule.head !== "@media (max-width: 767px)" && !inPhone(rule));
	assert.deepEqual(leaked.map((rule) => rule.head), [], "a mobile rule escaped the phone wrapper");
	// The source itself has no hand-written width query left: the wrapper and
	// the two NARROW_QUERY definitions are the only places the width exists.
	assert.equal((CLIENT.match(/@media \(max-width: 767px\)/g) ?? []).length, 0, "a literal width query was hand-written");
});

test("the device stylesheet only contains self-owned rules", () => {
	// The desktop half is the plugin's own Settings/toast chrome. Safe-area
	// rules are not here: env() is non-zero on a wide iPad in standalone mode,
	// so even those are phone-only under the #44 width contract.
	const allowed = [/^\.rdsh-mux-/];
	const upstream = cssRules(cssTemplate("CSS_DEVICE")).filter((rule) => !rule.at.some((head) => head.startsWith("@")));
	const leaked = upstream.filter((rule) => !allowed.some((pattern) => pattern.test(rule.head)));
	assert.deepEqual(leaked.map((rule) => rule.head), [], "a desktop stylesheet rule targets upstream layout");
	// The session colour frame is phone-only now; #44 does not keep a desktop
	// frame exception.
	const frame = cssRules(cssBlocks()[1]).find((rule) => rule.head === "[data-rdsh-session-frame]");
	assert.ok(frame, "the frame rule is missing");
	assert.ok(inPhone(frame), "the session colour frame is still painted on a desktop");
});

test("#46 keeps the header in flow and lifts the panel's column", () => {
	const phone = cssBlocks()[1];
	assert.equal(
		/header\[data-rdsh-header\]\s*\{[^}]*display:\s*none/.test(phone),
		false,
		"the open panel still removes the header from layout",
	);
	assert.equal(
		/header\[data-rdsh-header\]\s*\{[^}]*visibility:\s*hidden/.test(phone),
		false,
		"the open panel hides the header with visibility instead of layering",
	);
	const column = cssRules(phone).find((rule) => rule.head === "[data-rdsh-frame] [data-rdsh-rightbar-col]");
	assert.ok(column, "the right column is not lifted");
	assert.match(phone, /\[data-rdsh-frame\] \[data-rdsh-rightbar-col\] \{ z-index: 60; \}/, "the panel column has no stacking order above the header");
	assert.match(
		phone,
		/\[data-rdsh-frame\] \[data-sidebar-right-panel\] \{ z-index: 60; \}/,
		"the upstream panel root is not lifted",
	);
	const panel = phone.slice(phone.indexOf("[data-rdsh-rightpanel] {"), phone.indexOf("[data-rdsh-rightpanel] table"));
	assert.match(panel, /isolation: isolate;/, "the panel layer has no stacking context");
	assert.equal(/position:/.test(panel), false, "the panel layer overrides upstream's own position");
	assert.match(phone, /html\[data-rdsh-rightpanel-open\] \.rdsh-mux-fab \{ display: none !important; \}/, "the FAB still sits over the open panel");
});

/* ------------------------------------------------------------------ */
/* A tiny real DOM, enough for a width transition                      */
/* ------------------------------------------------------------------ */

class FakeStyle {
	constructor() {
		this.properties = new Map();
		this.colorScheme = "";
	}
	setProperty(name, value) {
		this.properties.set(name, String(value));
	}
	removeProperty(name) {
		this.properties.delete(name);
	}
	getPropertyValue(name) {
		return this.properties.get(name) ?? "";
	}
	get marginBottom() {
		return this.getPropertyValue("margin-bottom");
	}
	set marginBottom(value) {
		this.setProperty("margin-bottom", value);
	}
}

class FakeNode {
	constructor(tag = "div") {
		this.tagName = String(tag).toUpperCase();
		this.attributes = new Map();
		this.children = [];
		this.parentNode = null;
		this.style = new FakeStyle();
		this.dataset = {};
		this.className = "";
		this.value = "";
		this.disabled = false;
		this.textContent = "";
		this.innerHTML = "";
		this.hidden = false;
		this.isConnected = false;
	}
	setAttribute(name, value) {
		this.attributes.set(name, String(value));
	}
	getAttribute(name) {
		return this.attributes.has(name) ? this.attributes.get(name) : null;
	}
	hasAttribute(name) {
		return this.attributes.has(name);
	}
	removeAttribute(name) {
		this.attributes.delete(name);
	}
	toggleAttribute(name, force) {
		if (force === true) this.attributes.set(name, "");
		else if (force === false || force === undefined) this.attributes.delete(name);
	}
	append(...nodes) {
		for (const node of nodes) {
			if (node === null || node === undefined) continue;
			node.parentNode = this;
			node.markConnected(this.isConnected || this.tagName === "BODY");
			this.children.push(node);
		}
	}
	prepend(node) {
		node.parentNode = this;
		node.markConnected(this.isConnected || this.tagName === "BODY");
		this.children.unshift(node);
	}
	appendChild(node) {
		this.append(node);
		return node;
	}
	remove() {
		if (this.parentNode === null) return;
		const index = this.parentNode.children.indexOf(this);
		if (index !== -1) this.parentNode.children.splice(index, 1);
		this.parentNode = null;
		this.markConnected(false);
	}
	markConnected(value) {
		this.isConnected = value;
		for (const child of this.children) child.markConnected(value);
	}
	querySelectorAll(selector) {
		return selectAll(this, selector);
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	closest() {
		return null;
	}
	contains(node) {
		if (node === this) return true;
		return this.children.some((child) => child.contains(node));
	}
	addEventListener() {}
	removeEventListener() {}
	focus() {}
	blur() {}
	click() {}
	getBoundingClientRect() {
		return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
	}
}

/** The last compound of each comma branch, then every simple token on it. */
function selectorMatcher(selector) {
	const branches = selector.split(",").map((branch) => branch.trim()).filter((branch) => branch !== "");
	const compounds = branches.map((branch) => {
		const parts = [];
		let current = "";
		let quote = null;
		let depth = 0;
		for (const character of branch) {
			if (quote !== null) {
				current += character;
				if (character === quote) quote = null;
				continue;
			}
			if (character === '"' || character === "'") {
				quote = character;
				current += character;
				continue;
			}
			if (character === "[") depth += 1;
			else if (character === "]") depth -= 1;
			if (/\s/.test(character) && depth === 0) {
				if (current !== "") parts.push(current);
				current = "";
				continue;
			}
			current += character;
		}
		if (current !== "") parts.push(current);
		return parts[parts.length - 1] ?? "";
	});
	return (node) => compounds.some((compound) => matchesCompound(node, compound));
}

function matchesCompound(node, compound) {
	if (compound === "") return false;
	const classMatch = compound.match(/^\.([A-Za-z0-9_-]+)/);
	if (classMatch !== null) {
		if (!String(node.className).split(/\s+/).includes(classMatch[1])) return false;
		compound = compound.slice(classMatch[0].length);
	}
	const tagMatch = compound.match(/^[A-Za-z][A-Za-z0-9-]*/);
	if (tagMatch !== null) {
		if (node.tagName !== tagMatch[0].toUpperCase()) return false;
		compound = compound.slice(tagMatch[0].length);
	}
	const attributes = [...compound.matchAll(/\[([A-Za-z0-9_-]+)(?:([~^$*|]?=)(?:"([^"]*)"|'([^']*)'))?\]/g)];
	for (const [, name, operator, doubleQuoted, singleQuoted] of attributes) {
		if (!node.hasAttribute(name)) return false;
		if (operator === undefined) continue;
		const value = doubleQuoted ?? singleQuoted ?? "";
		const actual = node.getAttribute(name);
		if (operator === "=" && actual !== value) return false;
		if (operator === "^=" && !actual.startsWith(value)) return false;
		if (operator === "*=" && !actual.includes(value)) return false;
	}
	return attributes.length > 0 || classMatch !== null || tagMatch !== null;
}

function selectAll(root, selector, includeRoot = false) {
	const match = selectorMatcher(selector);
	const out = [];
	const walk = (node) => {
		if ((includeRoot || node !== root) && match(node)) out.push(node);
		for (const child of node.children) walk(child);
	};
	walk(root);
	return out;
}

function makeDocument() {
	const html = new FakeNode("html");
	const head = new FakeNode("head");
	const body = new FakeNode("body");
	html.markConnected(true);
	html.append(head, body);
	const doc = {
		documentElement: html,
		head,
		body,
		activeElement: null,
		visibilityState: "visible",
		styleSheets: [],
		querySelectorAll: (selector) => selectAll(html, selector, true),
		querySelector: (selector) => selectAll(html, selector, true)[0] ?? null,
		getElementById: () => null,
		createElement: (tag) => new FakeNode(tag),
		addEventListener() {},
		removeEventListener() {},
		execCommand: () => false,
	};
	return doc;
}

function memoryStorage(seed = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => map.set(key, String(value)),
		removeItem: (key) => map.delete(key),
		clear: () => map.clear(),
	};
}

function stub(depth = 0) {
	const value = function stubbed() {
		return depth > 4 ? undefined : stub(depth + 1);
	};
	return new Proxy(value, {
		get(target, key) {
			if (key === Symbol.toPrimitive) return () => 0;
			if (key === Symbol.iterator) return function* empty() {};
			if (key === "then") return undefined;
			if (key === "toString" || key === "valueOf") return () => "";
			if (depth > 4) return undefined;
			return stub(depth + 1);
		},
		apply() {
			return depth > 4 ? undefined : stub(depth + 1);
		},
		construct() {
			return depth > 4 ? undefined : stub(depth + 1);
		},
		set() {
			return true;
		},
		has() {
			return true;
		},
	});
}

/**
 * Boot the module with a mutable width.
 *
 * Animation frames are queued instead of run, so a test can dispose first and
 * then flush the frames a boot/decorate/theme pass left behind. The assertions
 * are about the boundary path itself: `syncWidth()` is what the media listener
 * calls.
 */
function bootBoundary({ narrow = true, seed = {}, safeTop = 0 } = {}) {
	const viewport = { narrow };
	const document = makeDocument();
	const disposers = [];
	const frames = [];
	const meta = new FakeNode("meta");
	meta.setAttribute("name", "viewport");
	meta.setAttribute("content", "width=device-width, initial-scale=1");
	document.head.append(meta);
	const theme = { getTheme: () => ({ preference: "light", active: { colorScheme: "light", tokens: {} } }) };
	let definition;
	const windowListeners = new Map();
	const sandbox = {
		__RDSH_PWA_COPY__: COPY,
		__RDSH_PWA_PROBES__: PROBES,
		window: {
			__ModuleLoader__: { load(value) { definition = value; } },
			addEventListener(type, handler) { windowListeners.set(type, handler); },
			removeEventListener(type) { windowListeners.delete(type); },
		},
		document,
		navigator: stub(),
		location: stub(),
		localStorage: memoryStorage(seed),
		sessionStorage: memoryStorage(),
		matchMedia: (query) => ({
			matches: viewport.narrow && String(query).includes("max-width: 767px"),
			addEventListener() {},
			removeEventListener() {},
		}),
		addEventListener() {},
		removeEventListener() {},
		setTimeout: () => 0,
		clearTimeout() {},
		setInterval: () => 0,
		clearInterval() {},
		requestAnimationFrame: (callback) => { frames.push(callback); return frames.length; },
		cancelAnimationFrame() {},
		MutationObserver: class {
			observe() {}
			disconnect() {}
		},
		IntersectionObserver: class {
			observe() {}
			disconnect() {}
		},
		getComputedStyle: () => ({ paddingTop: `${safeTop}px`, paddingBottom: "0px", paddingLeft: "0px", paddingRight: "0px", overflowY: "", overflowX: "", visibility: "visible", backgroundColor: "", rowGap: "0", getPropertyValue: () => "" }),
		console,
		URL,
		URLSearchParams,
		Intl,
		TextEncoder,
		TextDecoder,
		AbortController,
		structuredClone,
		fetch: () => Promise.resolve(stub()),
		Element: class Element {},
		HTMLElement: class HTMLElement {},
		Node: class Node {},
		Event: class Event {},
		CustomEvent: class CustomEvent {},
		PointerEvent: class PointerEvent {},
		KeyboardEvent: class KeyboardEvent {},
		TouchEvent: class TouchEvent {},
		Touch: class Touch {},
		MessageChannel: class MessageChannel {},
		Notification: stub(),
		AudioContext: class AudioContext {},
		screen: stub(),
		innerWidth: 390,
		innerHeight: 844,
		devicePixelRatio: 3,
		performance: { now: () => 0 },
		queueMicrotask,
		globalThis: undefined,
	};
	sandbox.globalThis = sandbox;
	for (const name of ["document", "matchMedia", "setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "location", "navigator", "localStorage", "screen", "performance", "innerWidth", "innerHeight", "addEventListener", "removeEventListener"]) {
		sandbox.window[name] = sandbox[name];
	}
	vm.createContext(sandbox);
	vm.runInContext(CLIENT, sandbox, { filename: "client.js" });
	assert.ok(definition !== undefined, "the module registered itself");

	const plugin = definition.factory((name) => stub());
	const ctx = {
		effect(fn) {
			const dispose = fn();
			if (typeof dispose === "function") disposers.push(dispose);
			return typeof dispose === "function" ? dispose : () => {};
		},
		inject(deps, callback) {
			return callback(ctx);
		},
		slots: {
			inject(deps, callback) {
				if (typeof callback === "function") return callback();
				return undefined;
			},
			register() {
				return () => {};
			},
		},
		get: (name) => (name === "theme" ? theme : undefined),
		on: () => () => {},
	};
	plugin.apply(ctx);
	const api = sandbox.__RDSH_MOBILE_UX__;
	assert.ok(api !== undefined, "the diagnostics surface is live");
	return {
		api,
		document,
		meta,
		viewport,
		disposers,
		theme,
		html: document.documentElement,
		body: document.body,
		setWidth(next) {
			viewport.narrow = next;
			api.syncWidth();
		},
		/** Run every queued frame, including ones queued while flushing. */
		flushFrames() {
			const pending = frames.splice(0);
			for (const callback of pending) callback();
			if (frames.length > 0) {
				const next = frames.splice(0);
				for (const callback of next) callback();
			}
		},
		dispose() {
			const errors = [];
			for (const dispose of disposers.splice(0).reverse()) {
				try {
					dispose();
				} catch (error) {
					errors.push(error);
				}
			}
			return errors;
		},
	};
}

/** Attach a node to the body so `document.querySelectorAll` can see it. */
function seed(booted, tag, attributes = {}) {
	const node = new FakeNode(tag);
	for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
	booted.body.append(node);
	return node;
}

const PHONE_SAMPLE = {
	"[data-rdsh-header]": "header",
	"[data-rdsh-frame]": "div",
	"[data-rdsh-rightpanel]": "div",
	"[data-rdsh-session]": "div",
	"[data-rdsh-session-frame]": "div",
	"[data-rdsh-question-card]": "div",
	"[data-rdsh-todo-item]": "li",
	"[data-rdsh-transcript]": "div",
	"[data-rdsh-queue-dock]": "div",
	"[data-rdsh-settings-nav-arrow]": "button",
	"[data-rdsh-activity-icon]": "span",
	"[data-rdsh-typing-layer]": "span",
	"[data-rdsh-crop-button]": "button",
	"[data-rdsh-toast]": "div",
	"[data-rdsh-model-search]": "input",
	"[data-rdsh-stat-text]": "button",
	"[data-rdsh-hide-settings]": "html",
};

test("767→768 removes every owned hook, node and inline style", () => {
	const booted = bootBoundary({ narrow: true, seed: { "dsh-mobile-maxxing:device-theme": "dark" } });
	// A narrow boot installed the drawer and, on the first sync, the lock.
	booted.setWidth(true);
	assert.equal(booted.body.querySelectorAll(".rdsh-mux-fab").length, 1, "the phone drawer button was not created");
	assert.match(booted.meta.getAttribute("content"), /maximum-scale=1/, "the phone viewport lock was not applied");
	assert.equal(booted.html.getAttribute("data-rdsh-anim"), "outline", "the animation attribute was not written");
	assert.equal(booted.body.hasAttribute("data-ds-dark-theme"), true, "the phone palette was not applied");

	const seeded = [];
	for (const [selector, tag] of Object.entries(PHONE_SAMPLE)) {
		if (selector === "[data-rdsh-hide-settings]") {
			booted.html.setAttribute("data-rdsh-hide-settings", "");
			continue;
		}
		seeded.push([selector, seed(booted, tag, { [selector.slice(1, -1)]: "" })]);
	}
	const row = seeded.find(([selector]) => selector === "[data-rdsh-session-frame]")[1];
	row.setAttribute("data-row-key", "session:s1");
	row.style.setProperty("--rdsh-session-frame", "#ff6b6b");
	const dock = seeded.find(([selector]) => selector === "[data-rdsh-queue-dock]")[1];
	dock.style.marginBottom = "-7px";
	const add = seed(booted, "button", { "aria-label": COPY.en["add.label"] });
	const upstreamOnly = seed(booted, "button", { "aria-label": "Upstream control", title: "keep me" });
	upstreamOnly.style.color = "red";

	booted.setWidth(false);

	assert.equal(booted.body.querySelectorAll(".rdsh-mux-fab").length, 0, "the drawer button survived the transition");
	assert.equal(booted.body.querySelectorAll(".rdsh-mux-backdrop").length, 0, "the drawer backdrop survived the transition");
	assert.equal(booted.html.hasAttribute("data-rdsh-anim"), false, "the animation attribute survived");
	assert.equal(booted.html.hasAttribute("data-rdsh-hide-settings"), false, "the hide-settings attribute survived");
	assert.equal(booted.html.hasAttribute("data-rdsh-drawer"), false, "the drawer state survived");
	assert.equal(booted.body.hasAttribute("data-ds-dark-theme"), false, "the phone palette survived");
	assert.equal(booted.html.getAttribute("data-rdsh-device-theme"), null, "the device-theme attribute survived");
	assert.equal(booted.meta.getAttribute("content"), "width=device-width, initial-scale=1", "the original viewport was not restored");
	for (const [selector, node] of seeded) {
		const attribute = selector.slice(1, -1);
		assert.equal(
			node.hasAttribute(attribute) && node.isConnected,
			false,
			`${attribute} survived the transition`,
		);
	}
	assert.equal(row.style.getPropertyValue("--rdsh-session-frame"), "", "the row frame colour survived");
	assert.equal(dock.style.marginBottom, "", "the queue dock inline margin survived");
	assert.equal(add.getAttribute("aria-label"), COPY.en["add.stock"], "the + label was not restored");
	// Nothing upstream-owned is removed: title/aria/style on an untouched node.
	assert.equal(upstreamOnly.getAttribute("title"), "keep me", "an upstream title was removed");
	assert.equal(upstreamOnly.style.color, "red", "an upstream inline style was removed");
	assert.equal(booted.body.querySelectorAll("[data-rdsh-typing-layer]").length, 0, "the typing overlay survived");
	assert.equal(booted.body.querySelectorAll("[data-rdsh-crop-button]").length, 0, "the crop button survived");
	assert.equal(booted.body.querySelectorAll("[data-rdsh-activity-icon]").length, 0, "the activity icon survived");
	assert.deepEqual(booted.dispose(), [], "dispose threw");
});

test("768→767 re-installs the phone surface, and dispose restores desktop", () => {
	const booted = bootBoundary({ narrow: false, seed: { "dsh-mobile-maxxing:device-theme": "dark" } });
	// A wide boot injects nothing and leaves the viewport alone.
	assert.equal(booted.body.querySelectorAll(".rdsh-mux-fab").length, 0, "a wide boot created the drawer button");
	assert.equal(booted.meta.getAttribute("content"), "width=device-width, initial-scale=1", "a wide boot touched the viewport");
	assert.equal(booted.html.getAttribute("data-rdsh-anim"), null, "a wide boot wrote the animation attribute");

	booted.setWidth(true);
	assert.equal(booted.body.querySelectorAll(".rdsh-mux-fab").length, 1, "entering the phone width did not create the drawer");
	assert.match(booted.meta.getAttribute("content"), /user-scalable=no/, "entering the phone width did not lock zoom");
	assert.equal(booted.html.getAttribute("data-rdsh-anim"), "outline", "entering the phone width did not set the animation");
	assert.equal(booted.body.hasAttribute("data-ds-dark-theme"), true, "entering the phone width did not apply the palette");

	booted.setWidth(false);
	assert.equal(booted.meta.getAttribute("content"), "width=device-width, initial-scale=1", "the round trip lost the original viewport");

	booted.setWidth(true);
	assert.deepEqual(booted.dispose(), [], "dispose threw");
	assert.equal(booted.body.querySelectorAll(".rdsh-mux-fab").length, 0, "dispose left the drawer button behind");
	assert.equal(booted.body.querySelectorAll(".rdsh-mux-backdrop").length, 0, "dispose left the backdrop behind");
	assert.equal(booted.meta.getAttribute("content"), "width=device-width, initial-scale=1", "dispose left the phone viewport");
	assert.equal(booted.html.hasAttribute("data-rdsh-anim"), false, "dispose left the animation attribute");
	assert.equal(booted.html.hasAttribute("data-rdsh-drawer"), false, "dispose left the drawer state");
});

test("the viewport meta this module created is removed, not rewritten", () => {
	const booted = bootBoundary({ narrow: true });
	booted.meta.remove();
	booted.setWidth(true);
	const created = booted.document.head.querySelectorAll('meta[name="viewport"]');
	assert.equal(created.length, 1, "no viewport meta was created");
	assert.match(created[0].getAttribute("content"), /maximum-scale=1/);
	booted.setWidth(false);
	assert.equal(booted.document.head.querySelectorAll('meta[name="viewport"]').length, 0, "the owned viewport meta survived");
});

test("a viewport with no content attribute gets that absence back", () => {
	// The baseline can be "no content attribute", which is not the string "".
	// Restoring it must remove the attribute, not leave the phone lock behind.
	const booted = bootBoundary({ narrow: true });
	booted.meta.removeAttribute("content");
	booted.setWidth(true);
	assert.match(booted.meta.getAttribute("content"), /maximum-scale=1/, "the phone lock was not applied");
	booted.setWidth(false);
	assert.equal(booted.meta.hasAttribute("content"), false, "the phone lock content survived as an attribute");
});

test("safe-area root padding and style are phone-only", () => {
	// env() is non-zero on a wide iPad in standalone mode, so #44 cannot leave
	// the safe-area root rules or the measured style on a desktop.
	const booted = bootBoundary({ narrow: true, safeTop: 47 });
	booted.setWidth(true);
	assert.equal(booted.html.hasAttribute("data-rdsh-safe-top"), true, "the phone inset attribute was not written");
	assert.equal(booted.html.style.getPropertyValue("--rdsh-safe-top"), "47px", "the phone inset variable was not written");
	booted.setWidth(false);
	assert.equal(booted.html.hasAttribute("data-rdsh-safe-top"), false, "the safe-area attribute survived");
	assert.equal(booted.html.style.getPropertyValue("--rdsh-safe-top"), "", "the safe-area variable survived");
	assert.equal(booted.html.style.getPropertyValue("--rdsh-native-gap-px"), "", "the native-gap variable survived");
});

test("a queued frame cannot resurrect the phone surface after dispose", () => {
	// A decorate/theme pass can leave an animation frame queued. Disposing in
	// between must invalidate that frame: otherwise it re-locks the viewport,
	// re-applies the per-device palette and re-adds the drawer after the
	// cleanup contract already ran.
	const booted = bootBoundary({ narrow: true, seed: { "dsh-mobile-maxxing:device-theme": "dark" } });
	booted.setWidth(true);
	assert.equal(booted.body.querySelectorAll(".rdsh-mux-fab").length, 1, "the drawer was not installed");
	assert.match(booted.meta.getAttribute("content"), /maximum-scale=1/, "the phone lock was not applied");
	assert.equal(booted.body.hasAttribute("data-ds-dark-theme"), true, "the phone palette was not applied");

	assert.deepEqual(booted.dispose(), [], "dispose threw");
	assert.equal(booted.meta.getAttribute("content"), "width=device-width, initial-scale=1", "dispose did not restore the viewport");
	assert.equal(booted.body.hasAttribute("data-ds-dark-theme"), false, "dispose did not release the palette");

	// The frames queued by boot/decorate/theme are now stale. They must be no-ops.
	booted.flushFrames();
	assert.equal(booted.meta.getAttribute("content"), "width=device-width, initial-scale=1", "a stale frame re-locked the viewport");
	assert.equal(booted.body.hasAttribute("data-ds-dark-theme"), false, "a stale frame re-applied the phone palette");
	assert.equal(booted.html.getAttribute("data-rdsh-device-theme"), null, "a stale frame re-added the device-theme attribute");
	assert.equal(booted.html.hasAttribute("data-rdsh-anim"), false, "a stale frame re-added the animation attribute");
	assert.equal(booted.html.hasAttribute("data-rdsh-drawer"), false, "a stale frame re-added the drawer state");
	assert.equal(booted.body.querySelectorAll(".rdsh-mux-fab").length, 0, "a stale frame re-created the drawer button");
});
