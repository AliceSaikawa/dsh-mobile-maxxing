/**
 * The per-device theme override, driven through the same stub environment as
 * `client-load.test.mjs`.
 *
 * Issue #5: the theme is a profile setting, so picking one on a phone changes
 * every connected browser. The override must therefore stay browser-local:
 * store a value in localStorage, repaint the DOM contract the upstream
 * presenter owns, and never reach for `theme.setTheme()` or the settings
 * document (that write is what propagates).
 *
 * These checks pin the two halves that are testable without a browser:
 * nothing is painted when there is no theme service to fall back from, and a
 * stored choice survives an upstream `theme/change` that arrives after it.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

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

function element() {
	const store = new Map();
	return new Proxy({
		baseURI: "http://localhost/",
		attributes: [],
		children: [],
		childNodes: [],
		classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
		dataset: {},
		style: { setProperty() {}, removeProperty() {}, getPropertyValue: () => "" },
		querySelector: () => null,
		querySelectorAll: () => [],
		closest: () => null,
		contains: () => false,
		append() {},
		appendChild() {},
		remove() {},
		removeChild() {},
		insertBefore() {},
		addEventListener() {},
		removeEventListener() {},
		setAttribute(name, value) { store.set(name, String(value)); },
		getAttribute: (name) => (store.has(name) ? store.get(name) : null),
		hasAttribute: (name) => store.has(name),
		removeAttribute(name) { store.delete(name); },
		toggleAttribute(name, force) { if (force === true) store.set(name, ""); else store.delete(name); },
		getBoundingClientRect: () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }),
		focus() {},
		blur() {},
		click() {},
		matches: () => false,
		get innerHTML() { return ""; },
		set innerHTML(_value) {},
		textContent: "",
	}, {
		get(target, key) {
			if (key in target) return target[key];
			return stub();
		},
		set(target, key, value) {
			target[key] = value;
			return true;
		},
	});
}

/** A localStorage that behaves like the real one for one key at a time. */
function storage(seed = {}) {
	const map = new Map(Object.entries(seed));
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => { map.set(key, String(value)); },
		removeItem: (key) => { map.delete(key); },
		clear: () => map.clear(),
	};
}

/**
 * Boot the module against the stub DOM.
 * @param {object} options - theme service (or null), initial storage, width.
 */
function boot({ theme = null, seed = {}, narrow = true, mode = null } = {}) {
	let definition;
	const listeners = new Map();
	const body = element();
	const documentElement = element();
	const sandbox = {
		window: { __ModuleLoader__: { load(value) { definition = value; } } },
		document: (() => {
			const doc = element();
			doc.baseURI = "http://localhost/";
			doc.visibilityState = "visible";
			doc.activeElement = null;
			doc.head = element();
			doc.body = body;
			doc.documentElement = documentElement;
			doc.createElement = () => element();
			doc.styleSheets = [];
			return doc;
		})(),
		navigator: stub(),
		location: stub(),
		localStorage: storage(seed),
		sessionStorage: storage(),
		matchMedia: (query) => ({ matches: narrow && String(query).includes("max-width: 767px"), addEventListener() {}, removeEventListener() {} }),
		addEventListener() {},
		removeEventListener() {},
		setTimeout: () => 0,
		clearTimeout() {},
		setInterval: () => 0,
		clearInterval() {},
		requestAnimationFrame: () => 0,
		cancelAnimationFrame() {},
		MutationObserver: class { observe() {} disconnect() {} },
		IntersectionObserver: class { observe() {} disconnect() {} },
		getComputedStyle: () => stub(),
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
	sandbox.__RDSH_DEVICE_MODE__ = mode ?? (narrow ? "mobile" : "desktop");
	sandbox.window.document = sandbox.document;
	sandbox.window.matchMedia = sandbox.matchMedia;
	sandbox.window.setTimeout = sandbox.setTimeout;
	sandbox.window.clearTimeout = sandbox.clearTimeout;
	sandbox.window.setInterval = sandbox.setInterval;
	sandbox.window.clearInterval = sandbox.clearInterval;
	sandbox.window.requestAnimationFrame = sandbox.requestAnimationFrame;
	sandbox.window.addEventListener = sandbox.addEventListener;
	sandbox.window.removeEventListener = sandbox.removeEventListener;
	sandbox.window.location = sandbox.location;
	sandbox.window.navigator = sandbox.navigator;
	sandbox.window.localStorage = sandbox.localStorage;
	sandbox.window.screen = sandbox.screen;
	sandbox.window.performance = sandbox.performance;
	sandbox.window.innerWidth = 390;
	sandbox.window.innerHeight = 844;
	vm.createContext(sandbox);
	vm.runInContext(CLIENT, sandbox, { filename: "client.js" });

	const plugin = definition.factory((name) => stub());
	const ctx = {
		effect(fn) {
			const dispose = fn();
			return typeof dispose === "function" ? dispose : () => {};
		},
		inject(deps, callback) {
			return callback(ctx);
		},
		slots: {
			inject() {},
			register() {
				return () => {};
			},
		},
		get: (name) => (name === "theme" && theme !== null ? theme : undefined),
		on(event, listener) {
			listeners.set(event, listener);
			return () => listeners.delete(event);
		},
	};
	plugin.apply(ctx);
	return { sandbox, body, documentElement, listeners, api: sandbox.__RDSH_MOBILE_UX__ };
}

test("without a theme service nothing is painted and nothing throws", () => {
	const { api, body, documentElement, sandbox } = boot({
		theme: null,
		seed: { "dsh-mobile-maxxing:device-theme": "dark" },
	});
	assert.ok(api !== undefined, "the debug surface is live");
	assert.equal(body.hasAttribute("data-ds-dark-theme"), false, "the shared palette is untouched");
	assert.equal(documentElement.getAttribute("data-rdsh-device-theme"), null);
	assert.equal(sandbox.document.documentElement.style.colorScheme, undefined);
});

test("a stored choice repaints the palette and survives a later theme/change", async () => {
	const snapshot = { preference: "light", active: { colorScheme: "light", tokens: {} } };
	const { api, body, documentElement, listeners, sandbox } = boot({
		theme: { getTheme: () => snapshot },
		seed: { "dsh-mobile-maxxing:device-theme": "dark" },
	});
	assert.equal(body.hasAttribute("data-ds-dark-theme"), true, "dark choice is applied at boot");
	assert.equal(documentElement.getAttribute("data-rdsh-device-theme"), "dark");
	assert.equal(sandbox.document.documentElement.style.colorScheme, "dark");

	// The PC switches the shared theme; the device choice must still win.
	listeners.get("theme/change")({ preference: "light", active: { colorScheme: "light", tokens: {} } });
	await Promise.resolve();
	assert.equal(body.hasAttribute("data-ds-dark-theme"), true, "the device override wins after the presenter");
	assert.equal(api.state.deviceTheme, "dark");
});

test("choosing the shared theme gives the palette back", async () => {
	const snapshot = { preference: "light", active: { colorScheme: "light", tokens: {} } };
	const { api, body, documentElement, sandbox } = boot({
		theme: { getTheme: () => snapshot },
		seed: { "dsh-mobile-maxxing:device-theme": "dark" },
	});
	assert.equal(body.hasAttribute("data-ds-dark-theme"), true);

	api.writeDeviceTheme("");
	assert.equal(body.hasAttribute("data-ds-dark-theme"), false, "the recorded baseline is restored");
	assert.equal(documentElement.getAttribute("data-rdsh-device-theme"), null);
	assert.equal(sandbox.document.documentElement.style.colorScheme, "");
	assert.equal(sandbox.localStorage.getItem("dsh-mobile-maxxing:device-theme"), null);
});

test("a registered palette turns the override off instead of mixing tokens", () => {
	const snapshot = { preference: "custom", active: { colorScheme: "dark", tokens: { "--dsw-alias-bg-base": "#101010" } } };
	const { api, body, documentElement } = boot({
		theme: { getTheme: () => snapshot },
		seed: { "dsh-mobile-maxxing:device-theme": "light" },
	});
	assert.equal(body.hasAttribute("data-ds-dark-theme"), false, "the shared registered theme's palette stands");
	assert.equal(documentElement.getAttribute("data-rdsh-device-theme"), null);
	assert.equal(api.state.deviceThemeNote, "custom");
});

test("a desktop never applies the mobile palette", () => {
	// A desktop keeps upstream's palette. The choice stays in storage for a
	// later mobile visit, but nothing is painted in desktop mode.
	const snapshot = { preference: "light", active: { colorScheme: "light", tokens: {} } };
	const { api, body, documentElement, sandbox } = boot({
		theme: { getTheme: () => snapshot },
		seed: { "dsh-mobile-maxxing:device-theme": "dark" },
		mode: "desktop",
		narrow: false,
	});
	assert.equal(body.hasAttribute("data-ds-dark-theme"), false, "a desktop got the phone palette");
	assert.equal(documentElement.getAttribute("data-rdsh-device-theme"), null);
	// Desktop builds no plugin: the saved choice is neither read nor applied.
	assert.equal(api, undefined, "a desktop booted the theme half");
	assert.equal(sandbox.localStorage.getItem("dsh-mobile-maxxing:device-theme"), "dark", "the saved choice was rewritten on desktop");
});

test("an empty store reads as the shared theme", () => {
	const { api } = boot({
		theme: { getTheme: () => ({ preference: "light", active: { colorScheme: "light", tokens: {} } }) },
	});
	assert.equal(api.readDeviceTheme(), "");
});
