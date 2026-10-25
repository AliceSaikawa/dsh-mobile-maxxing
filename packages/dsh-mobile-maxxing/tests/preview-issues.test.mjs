/**
 * Behavioural checks for #33 / #34 / #35.
 *
 * The browser half is a single bundle with no exports, so this file boots it
 * against a small in-memory DOM and drives the same decoration pass the app
 * runs. The point is to exercise the decisions (auto-click once, remember a
 * user OFF across a rerender, open/close/return focus, remove the kebab when
 * the window widens), not just to grep the source.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { COPY } from "../lib/copy.js";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/** A recursive stub, used only for incidental reads (navigator, fetch, ...). */
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

const ATTRIBUTE = /\[\s*([\w-]+)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+)))?\s*\]/g;

/** Parse `tag[a][b="c"]`; unsupported pseudo selectors simply never match. */
function parseSimple(part) {
	let rest = part.trim();
	let tag = null;
	const tagMatch = rest.match(/^[a-zA-Z][\w-]*/);
	if (tagMatch !== null) {
		tag = tagMatch[0].toLowerCase();
		rest = rest.slice(tagMatch[0].length);
	}
	const attributes = [];
	let consumed = "";
	for (const match of rest.matchAll(ATTRIBUTE)) {
		attributes.push({
			name: match[1].toLowerCase(),
			value: match[2] ?? match[3] ?? match[4] ?? null,
		});
		consumed += match[0];
	}
	if (rest.replace(ATTRIBUTE, "") !== "") return null;
	if (tag === null && attributes.length === 0) return null;
	return { tag, attributes };
}

function matchesSimple(element, part) {
	const parsed = parseSimple(part);
	if (parsed === null) return false;
	if (parsed.tag !== null && element.tagName.toLowerCase() !== parsed.tag) return false;
	for (const attribute of parsed.attributes) {
		if (!element.hasAttribute(attribute.name)) return false;
		if (attribute.value !== null && element.getAttribute(attribute.name) !== attribute.value) return false;
	}
	return true;
}

/** Split a selector on whitespace, keeping spaces inside quoted values. */
function selectorParts(group) {
	const parts = [];
	let buffer = "";
	let quote = null;
	for (const character of group.trim()) {
		if (quote !== null) {
			buffer += character;
			if (character === quote) quote = null;
			continue;
		}
		if (character === '"' || character === "'") {
			quote = character;
			buffer += character;
			continue;
		}
		if (/\s/.test(character)) {
			if (buffer !== "") parts.push(buffer);
			buffer = "";
			continue;
		}
		buffer += character;
	}
	if (buffer !== "") parts.push(buffer);
	return parts;
}

function matches(element, selector) {
	for (const group of selector.split(",")) {
		const parts = selectorParts(group);
		if (parts.length === 0) continue;
		if (!matchesSimple(element, parts[parts.length - 1])) continue;
		let at = parts.length - 2;
		let node = element.parentElement;
		while (at >= 0) {
			if (node === null) break;
			if (matchesSimple(node, parts[at])) at -= 1;
			node = node.parentElement;
		}
		if (at < 0) return true;
	}
	return false;
}

/** The minimal element the decoration code touches, with real event dispatch. */
class FakeElement {
	constructor(document, tagName) {
		this.ownerDocument = document;
		this.tagName = tagName.toUpperCase();
		this.attributes = new Map();
		this.children = [];
		this.parentElement = null;
		this.listeners = new Map();
		this.style = {
			setProperty() {},
			removeProperty() {},
			getPropertyValue: () => "",
		};
		this.dataset = {};
		this.classList = {
			add: (...names) => {
				const current = new Set((this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
				for (const name of names) current.add(name);
				this.setAttribute("class", [...current].join(" "));
			},
			remove: (...names) => {
				const current = new Set((this.getAttribute("class") ?? "").split(/\s+/).filter(Boolean));
				for (const name of names) current.delete(name);
				this.setAttribute("class", [...current].join(" "));
			},
			contains: (name) => (this.getAttribute("class") ?? "").split(/\s+/).includes(name),
			toggle: (name, force) => {
				const has = this.classList.contains(name);
				const next = force === undefined ? !has : force;
				if (next) this.classList.add(name);
				else this.classList.remove(name);
				return next;
			},
		};
		this.textContentValue = "";
		this.innerHTMLValue = "";
		this.disabled = false;
		this.type = "";
		this.id = "";
		this.className = "";
	}
	get isConnected() {
		let node = this;
		while (node.parentElement !== null) node = node.parentElement;
		return node === this.ownerDocument || node === this.ownerDocument.body || node === this.ownerDocument.head || node === this.ownerDocument.documentElement;
	}
	get textContent() {
		return this.textContentValue + this.children.map((child) => child.textContent).join("");
	}
	set textContent(value) {
		this.children = [];
		this.textContentValue = String(value ?? "");
	}
	get innerHTML() {
		return this.innerHTMLValue;
	}
	set innerHTML(value) {
		this.innerHTMLValue = String(value ?? "");
	}
	get elements() {
		return this.children;
	}
	getBoundingClientRect() {
		return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
	}
	getAttribute(name) {
		return this.attributes.has(name) ? this.attributes.get(name) : null;
	}
	setAttribute(name, value) {
		this.attributes.set(name, String(value));
		if (name === "class") this.className = String(value);
		if (name === "id") this.id = String(value);
	}
	hasAttribute(name) {
		return this.attributes.has(name);
	}
	removeAttribute(name) {
		this.attributes.delete(name);
	}
	toggleAttribute(name, force) {
		const next = force === undefined ? !this.hasAttribute(name) : force === true;
		if (next) this.setAttribute(name, "");
		else this.removeAttribute(name);
		return next;
	}
	append(...nodes) {
		for (const node of nodes) {
			if (typeof node === "string") {
				const text = this.ownerDocument.createElement("#text");
				text.textContent = node;
				this.children.push(text);
				text.parentElement = this;
				continue;
			}
			node.parentElement?.removeChild?.(node);
			this.children.push(node);
			node.parentElement = this;
		}
	}
	appendChild(node) {
		this.append(node);
		return node;
	}
	insertBefore(node, before) {
		this.append(node);
		const at = this.children.indexOf(node);
		const target = this.children.indexOf(before);
		if (at !== -1 && target !== -1) {
			this.children.splice(at, 1);
			this.children.splice(target, 0, node);
		}
		return node;
	}
	after(node) {
		if (this.parentElement === null) return;
		const at = this.parentElement.children.indexOf(this);
		node.parentElement?.removeChild?.(node);
		this.parentElement.children.splice(at + 1, 0, node);
		node.parentElement = this.parentElement;
	}
	removeChild(node) {
		const at = this.children.indexOf(node);
		if (at !== -1) this.children.splice(at, 1);
		if (node.parentElement === this) node.parentElement = null;
	}
	remove() {
		this.parentElement?.removeChild(this);
	}
	contains(node) {
		if (node === this) return true;
		return this.children.some((child) => child.contains(node));
	}
	querySelectorAll(selector) {
		const results = [];
		const visit = (node) => {
			for (const child of node.children) {
				if (matches(child, selector)) results.push(child);
				visit(child);
			}
		};
		visit(this);
		return results;
	}
	querySelector(selector) {
		return this.querySelectorAll(selector)[0] ?? null;
	}
	closest(selector) {
		let node = this;
		while (node !== null) {
			if (node instanceof FakeElement && matches(node, selector)) return node;
			node = node.parentElement;
		}
		return null;
	}
	matches(selector) {
		return matches(this, selector);
	}
	addEventListener(type, fn) {
		if (!this.listeners.has(type)) this.listeners.set(type, []);
		this.listeners.get(type).push(fn);
	}
	removeEventListener(type, fn) {
		const list = this.listeners.get(type);
		if (list === undefined) return;
		const at = list.indexOf(fn);
		if (at !== -1) list.splice(at, 1);
	}
	dispatchEvent(event) {
		event.target ??= this;
		let node = this;
		while (node !== null && event.stopped !== true) {
			for (const fn of [...(node.listeners?.get(event.type) ?? [])]) {
				try {
					fn(event);
				} catch {
					/* a boot-time listener with a richer event shape must not stop the feature under test */
				}
			}
			node = node.parentElement ?? null;
		}
		return !event.defaultPrevented;
	}
	focus() {
		this.ownerDocument.activeElement = this;
	}
	blur() {
		if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null;
	}
	click() {
		if (this.disabled === true) return;
		this.dispatchEvent(fakeEvent("click", { target: this }));
	}
}

function fakeEvent(type, properties = {}) {
	return {
		type,
		target: null,
		isTrusted: false,
		defaultPrevented: false,
		preventDefault() {
			this.defaultPrevented = true;
		},
		stopPropagation() {
			this.stopped = true;
		},
		stopImmediatePropagation() {
			this.stopped = true;
		},
		...properties,
	};
}

class FakeDocument extends FakeElement {
	constructor() {
		super(null, "#document");
		this.ownerDocument = this;
		this.activeElement = null;
		this.visibilityState = "visible";
		this.styleSheets = [];
		this.documentElement = new FakeElement(this, "html");
		this.head = new FakeElement(this, "head");
		this.body = new FakeElement(this, "body");
		this.documentElement.parentElement = this;
		this.body.parentElement = this.documentElement;
		this.head.parentElement = this.documentElement;
		this.children = [this.documentElement];
		this.documentElement.children = [this.head, this.body];
		this.documentElement.lang = "en";
		this.baseURI = "http://localhost/";
	}
	get isConnected() {
		return true;
	}
	getElementById() {
		return null;
	}
	createElement(tag) {
		return new FakeElement(this, tag);
	}
	addEventListener(type, fn) {
		super.addEventListener(type, fn);
	}
	removeEventListener(type, fn) {
		super.removeEventListener(type, fn);
	}
	listenerCount(type) {
		return (this.listeners.get(type) ?? []).length;
	}
}

function memoryStorage(initial = {}) {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => map.set(key, String(value)),
		removeItem: (key) => map.delete(key),
		clear: () => map.clear(),
		key: (index) => [...map.keys()][index] ?? null,
		get length() {
			return map.size;
		},
	};
}

/** Boot the client half against the fake DOM and return its test surface. */
function boot({ storage = {}, narrow = true } = {}) {
	let definition;
	const document = new FakeDocument();
	const window = {
		addEventListener() {},
		removeEventListener() {},
		innerWidth: narrow ? 390 : 1024,
		innerHeight: 844,
		matchMedia: (query) => ({
			matches: query.includes("max-width: 767px") ? narrow : false,
			addEventListener() {},
			removeEventListener() {},
		}),
	};
	const sandbox = {
		window,
		document,
		navigator: stub(),
		location: stub(),
		localStorage: memoryStorage(storage),
		sessionStorage: memoryStorage(),
		matchMedia: window.matchMedia,
		addEventListener: window.addEventListener,
		removeEventListener: window.removeEventListener,
		setTimeout,
		clearTimeout,
		setInterval: () => 0,
		clearInterval() {},
		requestAnimationFrame: () => 0,
		cancelAnimationFrame() {},
		MutationObserver: class {
			observe() {}
			disconnect() {}
		},
		IntersectionObserver: class {
			observe() {}
			disconnect() {}
		},
		ResizeObserver: class {
			observe() {}
			disconnect() {}
		},
		getComputedStyle: () => ({
			overflowX: "visible",
			overflowY: "visible",
			visibility: "visible",
			display: "block",
			paddingLeft: "0px",
			paddingRight: "0px",
			getPropertyValue: () => "",
		}),
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
		innerWidth: window.innerWidth,
		innerHeight: window.innerHeight,
		devicePixelRatio: 3,
		performance: { now: () => 0 },
		__RDSH_PWA_LANG__: "en",
		__RDSH_PWA_COPY__: COPY,
		__RDSH_PWA_PROBES__: {},
	};
	window.__ModuleLoader__ = {
		load(value) {
			definition = value;
		},
	};
	window.document = document;
	window.setTimeout = sandbox.setTimeout;
	window.clearTimeout = sandbox.clearTimeout;
	window.setInterval = sandbox.setInterval;
	window.clearInterval = sandbox.clearInterval;
	window.requestAnimationFrame = sandbox.requestAnimationFrame;
	window.cancelAnimationFrame = sandbox.cancelAnimationFrame;
	window.navigator = sandbox.navigator;
	window.localStorage = sandbox.localStorage;
	window.screen = sandbox.screen;
	window.performance = sandbox.performance;
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(CLIENT, sandbox, { filename: "client.js" });
	assert.ok(definition !== undefined, "the module registered itself");
	const plugin = definition.factory((name) => stub());
	const disposers = [];
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
		get: () => undefined,
		on: () => () => {},
	};
	plugin.apply(ctx);
	const api = sandbox.__RDSH_MOBILE_UX__;
	assert.ok(api !== undefined, "the diagnostics surface is present");
	return {
		sandbox,
		document,
		window,
		api,
		dispose() {
			for (const dispose of disposers.splice(0).reverse()) dispose();
		},
	};
}

/** A right panel with one text preview header. */
function makePreview(env, { secondary = ["Reload", "Save"], hidden = true } = {}) {
	const { document } = env;
	const panel = document.createElement("div");
	panel.setAttribute("data-rdsh-rightpanel", "");
	const header = document.createElement("div");
	const path = document.createElement("span");
	path.setAttribute("data-textpreview-path", "");
	path.setAttribute("title", "/tmp/example.js");
	header.append(path);

	const viewer = document.createElement("button");
	viewer.setAttribute("data-document-viewer-menu", "");
	viewer.setAttribute("aria-label", "Open with");
	viewer.textContent = "Code";
	header.append(viewer);

	const wrap = document.createElement("button");
	wrap.setAttribute("data-textpreview-tool", "wrap");
	wrap.setAttribute("aria-label", "Toggle line wrap");
	wrap.textContent = "Wrap";
	header.append(wrap);

	const openTarget = document.createElement("div");
	openTarget.setAttribute("data-open-target", "file");
	const openButton = document.createElement("button");
	openButton.setAttribute("data-open-path-open", "");
	openButton.setAttribute("aria-label", "Open in Chrome");
	openButton.textContent = "Open";
	openTarget.append(openButton);
	header.append(openTarget);

	const actions = new Map();
	for (const label of secondary) {
		const button = document.createElement("button");
		button.setAttribute("aria-label", label);
		if (label === "Reload") button.setAttribute("data-textpreview-tool", "reload");
		button.textContent = label;
		button.addEventListener("click", () => {
			actions.set(label, (actions.get(label) ?? 0) + 1);
		});
		header.append(button);
	}

	if (hidden) {
		const hiddenSpan = document.createElement("span");
		hiddenSpan.setAttribute("hidden", "");
		const autoRefresh = document.createElement("button");
		autoRefresh.setAttribute("data-textpreview-tool", "auto-refresh");
		autoRefresh.setAttribute("aria-label", "Auto refresh");
		hiddenSpan.append(autoRefresh);
		header.append(hiddenSpan);
	}

	panel.append(header);
	// Foundation #44 re-discovers the right panel from a laid-out collapse
	// button. The fake DOM gives it the same minimal geometry a real docked
	// panel has, so a phone -> desktop -> phone fixture can be tagged again
	// instead of staying an inert div.
	panel.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 844, width: 390, height: 844 });
	const collapse = document.createElement("button");
	collapse.setAttribute("aria-label", "Collapse right sidebar");
	collapse.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 30, bottom: 30, width: 30, height: 30 });
	panel.append(collapse);
	const boundary = document.createElement("div");
	boundary.setAttribute("data-sidebar-right-panel", "");
	boundary.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 390, bottom: 844, width: 390, height: 844 });
	boundary.append(panel);
	document.body.append(boundary);
	return { panel, header, path, viewer, wrap, openTarget, openButton, actions };
}

/** A review surface inside a dockkit pane. */
function makeReview(env, { pressed = false, tab = "tab-a", replace = false } = {}) {
	const { document } = env;
	const existingPane = document.querySelector("[data-dockkit-pane]");
	// Reuse the pane's own panel even after a desktop pass removed the
	// phone-only marker: decorateRightPanel re-tags it at phone width.
	const panel = existingPane?.parentElement ?? document.querySelector("[data-rdsh-rightpanel]") ?? (() => {
		const created = document.createElement("div");
		created.setAttribute("data-rdsh-rightpanel", "");
		document.body.append(created);
		return created;
	})();
	let pane = existingPane;
	if (pane === null) {
		pane = document.createElement("div");
		pane.setAttribute("data-dockkit-pane", "pane-1");
		panel.append(pane);
	}
	// dockkit's two-tab strip: reviewSurfaceKey reads the active tab id.
	if (pane.querySelector("[data-dockkit-tab]") === null) {
		for (const id of ["tab-a", "tab-b"]) {
			const tabElement = document.createElement("div");
			tabElement.setAttribute("data-dockkit-tab", id);
			tabElement.setAttribute("aria-selected", id === "tab-a" ? "true" : "false");
			pane.append(tabElement);
		}
	}
	for (const element of pane.querySelectorAll("[data-dockkit-tab]")) {
		element.setAttribute("aria-selected", element.getAttribute("data-dockkit-tab") === tab ? "true" : "false");
	}
	if (replace) {
		for (const oldRoot of pane.querySelectorAll("[data-changes-review]")) oldRoot.remove();
	}
	const root = document.createElement("div");
	root.setAttribute("data-changes-review", "");
	const file = document.createElement("button");
	file.setAttribute("data-review-file", "src/app.js");
	file.textContent = "src/app.js";
	const wrap = document.createElement("button");
	wrap.setAttribute("data-review-tool", "wrap");
	wrap.setAttribute("aria-label", "Line wrap");
	wrap.setAttribute("aria-pressed", pressed ? "true" : "false");
	const state = { clicks: 0 };
	wrap.addEventListener("click", () => {
		state.clicks += 1;
		wrap.setAttribute("aria-pressed", wrap.getAttribute("aria-pressed") === "true" ? "false" : "true");
	});
	root.append(file, wrap);
	pane.append(root);
	return { panel, pane, root, wrap, state };
}

function switchReviewTab(env, tab) {
	const pane = env.document.querySelector("[data-dockkit-pane]");
	let found = false;
	for (const element of pane.querySelectorAll("[data-dockkit-tab]")) {
		const active = element.getAttribute("data-dockkit-tab") === tab;
		element.setAttribute("aria-selected", active ? "true" : "false");
		found ||= active;
	}
	if (!found) {
		const element = env.document.createElement("div");
		element.setAttribute("data-dockkit-tab", tab);
		element.setAttribute("aria-selected", "true");
		pane.append(element);
	}
}

function setViewport(env, narrow) {
	env.sandbox.matchMedia = (query) => ({
		matches: query.includes("max-width: 767px") ? narrow : false,
		addEventListener() {},
		removeEventListener() {},
	});
	env.window.matchMedia = env.sandbox.matchMedia;
	env.window.innerWidth = narrow ? 390 : 1024;
}

function keydown(env, key) {
	env.document.dispatchEvent(fakeEvent("keydown", { key }));
}

test("no DBG debug output is left in the browser bundle", () => {
	assert.doesNotMatch(CLIENT, /DBG\s+note/, "a DBG note survived in client.js");
	assert.doesNotMatch(CLIENT, /console\.(?:log|warn|error)\(\s*["'`]DBG/, "a DBG console call survived in client.js");
});

test("#35 adds the kebab and moves only secondary preview actions", () => {
	const env = boot();
	const preview = makePreview(env);
	env.api.decorateNow();
	assert.equal(preview.header.hasAttribute("data-rdsh-preview-header"), true, "header was not tagged");
	const kebab = preview.header.querySelector("[data-rdsh-preview-kebab]");
	assert.notEqual(kebab, null, "no kebab in the phone header");
	assert.equal(kebab.getAttribute("aria-label"), "More preview actions");
	assert.equal(kebab.getAttribute("aria-haspopup"), "menu");
	assert.equal(kebab.getAttribute("aria-expanded"), "false");

	const moved = preview.header.querySelectorAll("[data-rdsh-preview-secondary]");
	assert.deepEqual(moved.map((button) => button.getAttribute("aria-label")), ["Reload", "Save"]);
	assert.equal(preview.viewer.hasAttribute("data-rdsh-preview-secondary"), false, "the viewer picker was moved out");
	assert.equal(preview.wrap.hasAttribute("data-rdsh-preview-secondary"), false, "the forced-wrap toggle was offered");
	assert.equal(preview.openButton.hasAttribute("data-rdsh-preview-secondary"), false, "#33 open target leaked into the kebab");
	assert.equal(preview.header.querySelector('[data-textpreview-tool="auto-refresh"]').hasAttribute("data-rdsh-preview-secondary"), false, "the hidden auto-refresh was offered");
	env.dispose();
});

test("#35 menu calls the original button and returns focus", () => {
	const env = boot();
	const preview = makePreview(env);
	env.api.decorateNow();
	const kebab = preview.header.querySelector("[data-rdsh-preview-kebab]");
	kebab.click();
	const menu = env.document.body.querySelector("[data-rdsh-preview-menu]");
	assert.notEqual(menu, null, "the menu did not open");
	assert.equal(menu.getAttribute("role"), "menu");
	assert.deepEqual(menu.querySelectorAll('[role="menuitem"]').map((item) => item.textContent), ["Reload", "Save"]);
	assert.equal(kebab.getAttribute("aria-expanded"), "true");
	assert.equal(env.document.activeElement, menu.querySelectorAll('[role="menuitem"]')[0], "focus is not on the first item");

	menu.querySelectorAll('[role="menuitem"]')[1].click();
	assert.equal(preview.actions.get("Save"), 1, "the original Save button was not clicked");
	assert.equal(env.document.body.querySelector("[data-rdsh-preview-menu]"), null, "the menu stayed open");
	assert.equal(kebab.getAttribute("aria-expanded"), "false");
	assert.equal(env.document.activeElement, kebab, "focus did not return to the kebab");
	env.dispose();
});

test("#35 arrows, Home, End and Escape work and listeners are disposed", () => {
	const env = boot();
	const preview = makePreview(env, { secondary: ["Reload", "Save", "Copy"] });
	env.api.decorateNow();
	const kebab = preview.header.querySelector("[data-rdsh-preview-kebab]");
	const before = env.document.listenerCount("pointerdown");
	const beforeKeys = env.document.listenerCount("keydown");
	kebab.dispatchEvent(fakeEvent("keydown", { key: "ArrowDown" }));
	const menu = env.document.body.querySelector("[data-rdsh-preview-menu]");
	assert.notEqual(menu, null, "ArrowDown did not open the menu");
	const items = menu.querySelectorAll('[role="menuitem"]');
	assert.equal(env.document.activeElement, items[0]);
	keydown(env, "ArrowDown");
	assert.equal(env.document.activeElement, items[1]);
	keydown(env, "End");
	assert.equal(env.document.activeElement, items[2]);
	keydown(env, "Home");
	assert.equal(env.document.activeElement, items[0]);
	keydown(env, "Escape");
	assert.equal(env.document.body.querySelector("[data-rdsh-preview-menu]"), null, "Escape did not close the menu");
	assert.equal(env.document.activeElement, kebab, "Escape did not return focus");
	assert.equal(env.document.listenerCount("pointerdown"), before, "the pointerdown listener leaked");
	assert.equal(env.document.listenerCount("keydown"), beforeKeys, "the keydown listener leaked");
	env.dispose();
});

test("#35 outside pointerdown closes the menu", () => {
	const env = boot();
	const preview = makePreview(env);
	env.api.decorateNow();
	const kebab = preview.header.querySelector("[data-rdsh-preview-kebab]");
	kebab.click();
	assert.notEqual(env.document.body.querySelector("[data-rdsh-preview-menu]"), null);
	env.document.body.dispatchEvent(fakeEvent("pointerdown", { target: env.document.body }));
	assert.equal(env.document.body.querySelector("[data-rdsh-preview-menu]"), null, "an outside tap left the menu open");
	env.dispose();
});

test("#35 disabled state syncs and a rerender rebuilds without an orphan menu", () => {
	const env = boot();
	const preview = makePreview(env);
	env.api.decorateNow();
	const reload = preview.header.querySelectorAll("[data-rdsh-preview-secondary]")[0];
	const kebab = preview.header.querySelector("[data-rdsh-preview-kebab]");
	kebab.click();
	let items = env.document.body.querySelectorAll('[role="menuitem"]');
	assert.equal(items[0].disabled, false);
	reload.disabled = true;
	env.api.decorateNow();
	items = env.document.body.querySelectorAll('[role="menuitem"]');
	assert.equal(env.document.body.querySelector("[data-rdsh-preview-menu]") !== null, true, "a disable rerender closed the menu instead of syncing it");
	assert.equal(items[0].disabled, true, "the disabled state did not reach the menu item");
	assert.equal(items[0].getAttribute("aria-disabled"), "true");
	env.dispose();
});

test("#35 widening removes the kebab, menu and hooks; narrowing rebuilds", () => {
	const env = boot();
	const preview = makePreview(env);
	makeReview(env);
	env.api.decorateNow();
	preview.header.querySelector("[data-rdsh-preview-kebab]").click();
	assert.notEqual(env.document.body.querySelector("[data-rdsh-preview-menu]"), null);
	env.window.innerWidth = 1024;
	env.sandbox.matchMedia = (query) => ({ matches: query.includes("max-width: 767px") ? false : false, addEventListener() {}, removeEventListener() {} });
	env.window.matchMedia = env.sandbox.matchMedia;
	env.api.decorateNow();
	assert.equal(env.document.querySelectorAll("[data-rdsh-preview-kebab]").length, 0, "a desktop width kept the kebab");
	assert.equal(preview.header.hasAttribute("data-rdsh-preview-header"), false, "the header hook survived a desktop width");
	assert.equal(env.document.body.querySelector("[data-rdsh-preview-menu]"), null, "the menu survived a desktop width");
	assert.equal(env.document.querySelectorAll("[data-rdsh-preview-secondary]").length, 0, "the moved-action hooks survived a desktop width");
	// #34 is phone-only too: a review opened at desktop width must not be
	// clicked behind the user's back.
	const desktopReview = makeReview(env);
	env.api.decorateNow();
	assert.equal(desktopReview.state.clicks, 0, "desktop width auto-enabled review wrap");
	assert.equal(desktopReview.wrap.getAttribute("aria-pressed"), "false");

	env.sandbox.matchMedia = (query) => ({ matches: query.includes("max-width: 767px") ? true : false, addEventListener() {}, removeEventListener() {} });
	env.window.matchMedia = env.sandbox.matchMedia;
	env.window.innerWidth = 390;
	env.api.decorateNow();
	assert.notEqual(preview.header.querySelector("[data-rdsh-preview-kebab]"), null, "the kebab did not come back at phone width");
	env.dispose();
});

test("#34 a fresh review turns wrap on once through the real button", () => {
	const env = boot();
	makePreview(env);
	const review = makeReview(env);
	env.api.decorateNow();
	assert.equal(review.wrap.getAttribute("aria-pressed"), "true", "the default did not turn wrap on");
	assert.equal(review.state.clicks, 1, "the upstream wrap button was not clicked exactly once");
	env.api.decorateNow();
	assert.equal(review.root.hasAttribute("data-rdsh-review-wrap"), true, "the wrapped layout hook is missing");
	env.api.decorateNow();
	assert.equal(review.state.clicks, 1, "decoration clicked the toggle again");
	env.dispose();
});

test("#34 an explicit user OFF wins across a rerender of the same surface", async () => {
	const env = boot();
	makePreview(env);
	const review = makeReview(env);
	env.api.decorateNow();
	assert.equal(review.wrap.getAttribute("aria-pressed"), "true");
	// The user turns it off: a trusted click on the upstream button.
	review.wrap.dispatchEvent(fakeEvent("click", { target: review.wrap, isTrusted: true }));
	assert.equal(review.wrap.getAttribute("aria-pressed"), "false");
	await new Promise((resolve) => setTimeout(resolve, 10));
	env.api.decorateNow();
	assert.equal(review.state.clicks, 2, "decoration re-enabled wrap after the user turned it off");
	assert.equal(review.root.hasAttribute("data-rdsh-review-off"), true);
	// React replaces the review root inside the same pane; the pane key keeps
	// the user's choice.
	const replacement = makeReview(env, { pressed: false });
	env.api.decorateNow();
	assert.equal(replacement.wrap.getAttribute("aria-pressed"), "false", "a rerendered surface ignored the user's OFF");
	assert.equal(replacement.state.clicks, 0);
	env.dispose();
});

test("#34 wrap default is per diff tab while an explicit OFF stays with its tab", async () => {
	const env = boot();
	makePreview(env);
	const first = makeReview(env, { tab: "tab-a" });
	env.api.decorateNow();
	assert.equal(first.wrap.getAttribute("aria-pressed"), "true", "tab A did not get the default");
	assert.equal(first.state.clicks, 1);

	// User turns tab A off; the choice belongs to tab A.
	first.wrap.dispatchEvent(fakeEvent("click", { target: first.wrap, isTrusted: true }));
	assert.equal(first.wrap.getAttribute("aria-pressed"), "false");
	await new Promise((resolve) => setTimeout(resolve, 10));
	env.api.decorateNow();
	assert.equal(first.state.clicks, 2);

	// A different diff tab in the same pane is a fresh surface and must get
	// the default once, even though the pane was already auto-fired.
	switchReviewTab(env, "tab-b");
	const second = makeReview(env, { tab: "tab-b", replace: true });
	env.api.decorateNow();
	assert.equal(second.wrap.getAttribute("aria-pressed"), "true", "the next tab in the same pane was skipped");
	assert.equal(second.state.clicks, 1, "the next tab was not clicked exactly once");

	// React may reuse the same review root element for a third tab. The tab key
	// must decide, not a marker left on that root by the previous tab.
	switchReviewTab(env, "tab-c");
	second.wrap.setAttribute("aria-pressed", "false");
	env.api.decorateNow();
	assert.equal(second.wrap.getAttribute("aria-pressed"), "true", "a reused root hid the third tab's default");
	assert.equal(second.state.clicks, 2, "the reused root was not clicked for the third tab");

	// Coming back to tab A must keep the explicit OFF.
	switchReviewTab(env, "tab-a");
	const again = makeReview(env, { tab: "tab-a", replace: true });
	env.api.decorateNow();
	assert.equal(again.wrap.getAttribute("aria-pressed"), "false", "tab A's explicit OFF was overwritten");
	assert.equal(again.state.clicks, 0, "tab A was clicked again after the user turned it off");
	assert.equal(again.root.hasAttribute("data-rdsh-review-off"), true);
	env.dispose();
});

test("#34 an explicit phone OFF survives a phone -> desktop -> phone round trip", async () => {
	const env = boot();
	makePreview(env);
	const first = makeReview(env, { tab: "tab-a" });
	env.api.decorateNow();
	assert.equal(first.wrap.getAttribute("aria-pressed"), "true");
	first.wrap.dispatchEvent(fakeEvent("click", { target: first.wrap, isTrusted: true }));
	assert.equal(first.wrap.getAttribute("aria-pressed"), "false");
	await new Promise((resolve) => setTimeout(resolve, 10));
	env.api.decorateNow();
	assert.equal(first.state.clicks, 2);
	assert.equal(first.root.hasAttribute("data-rdsh-review-off"), true);

	// Width cleanup removes the phone hooks, but it must not forget the choice.
	setViewport(env, false);
	env.api.decorateNow();
	assert.equal(env.document.querySelectorAll("[data-rdsh-review-off]").length, 0, "desktop kept a phone hook");

	// Same pane/tab, new root: the in-memory OFF still wins.
	setViewport(env, true);
	const again = makeReview(env, { tab: "tab-a", replace: true, pressed: false });
	env.api.decorateNow();
	assert.equal(again.wrap.getAttribute("aria-pressed"), "false", "the round trip lost the user's OFF");
	assert.equal(again.state.clicks, 0);
	assert.equal(again.root.hasAttribute("data-rdsh-review-off"), true, "the phone hook was not repainted after the round trip");
	env.dispose();
});

test("#34 the default applies again after a width round trip with no user choice", () => {
	const env = boot();
	makePreview(env);
	const first = makeReview(env, { tab: "tab-a" });
	env.api.decorateNow();
	assert.equal(first.wrap.getAttribute("aria-pressed"), "true");
	assert.equal(first.state.clicks, 1);

	setViewport(env, false);
	env.api.decorateNow();
	// Remount with upstream's fresh state; the user never chose anything, so
	// the phone default must be allowed to fire once more.
	const remounted = makeReview(env, { tab: "tab-a", replace: true, pressed: false });
	setViewport(env, true);
	env.api.decorateNow();
	assert.equal(remounted.wrap.getAttribute("aria-pressed"), "true", "the default did not re-apply after a round trip");
	assert.equal(remounted.state.clicks, 1, "the remounted surface was not clicked exactly once");
	env.dispose();
});

test("#34 a desktop OFF is remembered without writing phone hooks", async () => {
	const env = boot({ narrow: false });
	makePreview(env);
	const review = makeReview(env, { tab: "tab-a", pressed: true });
	env.api.decorateNow();
	assert.equal(review.state.clicks, 0, "desktop auto-enabled review wrap");

	// The user turns wrap off at desktop width. That is a real choice too; only
	// the memory is recorded, and no phone attribute may appear.
	review.wrap.dispatchEvent(fakeEvent("click", { target: review.wrap, isTrusted: true }));
	assert.equal(review.wrap.getAttribute("aria-pressed"), "false");
	await new Promise((resolve) => setTimeout(resolve, 10));
	const userClicks = review.state.clicks;
	assert.equal(userClicks, 1, "the trusted desktop click did not run");
	assert.equal(env.document.querySelectorAll("[data-rdsh-review]").length, 0, "desktop click painted a review hook");
	assert.equal(env.document.querySelectorAll("[data-rdsh-review-off]").length, 0, "desktop click painted an OFF hook");
	assert.equal(env.document.querySelectorAll("[data-rdsh-review-auto]").length, 0, "desktop click painted an auto hook");
	assert.equal(env.document.querySelectorAll("[data-rdsh-review-wrap]").length, 0, "desktop click painted a wrap hook");

	// Moving to phone width must not override that explicit OFF with the default.
	setViewport(env, true);
	env.api.decorateNow();
	assert.equal(review.wrap.getAttribute("aria-pressed"), "false", "the phone default overwrote a desktop OFF");
	assert.equal(review.state.clicks, userClicks, "the phone default clicked a desktop-off surface");
	assert.equal(review.root.hasAttribute("data-rdsh-review-off"), true);
	env.dispose();
});

test("#34 long-token CSS is scoped to the upstream wrap state, not forced globally", () => {
	const start = CLIENT.indexOf("[data-rdsh-rightpanel] [data-changes-review] [data-review-wrap] [data-diff-line]");
	assert.notEqual(start, -1, "the diff long-token rule is missing");
	const rule = CLIENT.slice(start, CLIENT.indexOf("}", start));
	assert.match(rule, /overflow-wrap: anywhere !important/, "long tokens do not wrap");
	assert.match(rule, /\[data-review-wrap\]/, "the rule is not gated on upstream's wrap state");
	// The plugin must not make the split/unified choice for the user.
	assert.doesNotMatch(CLIENT, /data-review-tool="split"\)[^;]*\.click\(\)/s, "the plugin clicks the split toggle");
});
