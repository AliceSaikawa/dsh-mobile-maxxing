/**
 * Behavioural checks for the interaction issues #31, #32 and #38.
 *
 * These do not need a browser: the client bundle is evaluated in a stub DOM
 * with real event dispatch, timer and animation-frame queues. The assertions
 * are about the contract with upstream:
 *
 * - #31: dockkit arms a tab drag on `pointerdown` and starts it after 4px.
 *   Until the 450ms hold, our capture listener stops every `pointermove` for
 *   that touch, so a tap and a sideways pan never reorder. The hold releases
 *   the gate and lets dockkit's own drag (and therefore its own tab order)
 *   finish the reorder.
 * - #32: a swipe that starts on the tab strip or its chrome is not a
 *   panel-close gesture; the body swipe and the ✕ keep working.
 * - #38: the terminal's mount node is shrunk to the visual viewport band so
 *   the app's ResizeObserver runs the real xterm fit. No scroll event is
 *   synthesised: xterm 6's SmoothScrollableElement is an internal model, its
 *   DOM wrapper has no overflow, and a wheel would be application input.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { COPY, PROBES } from "../lib/copy.js";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/* ---------------------------------------------------------------------- */
/* A small, real-enough DOM                                               */
/* ---------------------------------------------------------------------- */

class FakeEvent {
	constructor(type, init = {}) {
		this.type = type;
		this.bubbles = init.bubbles === true;
		this.cancelable = init.cancelable === true;
		this.defaultPrevented = false;
		this.propagationStopped = false;
	}
	preventDefault() {
		this.defaultPrevented = true;
	}
	stopPropagation() {
		this.propagationStopped = true;
	}
	stopImmediatePropagation() {
		this.propagationStopped = true;
		this.immediateStopped = true;
	}
}

class FakeMouseEvent extends FakeEvent {
	constructor(type, init = {}) {
		super(type, init);
		this.view = init.view ?? null;
	}
}

function makeStyle() {
	return {
		setProperty(name, value) {
			this[name] = String(value);
		},
		removeProperty(name) {
			delete this[name];
		},
		getPropertyValue(name) {
			return typeof this[name] === "string" ? this[name] : "";
		},
	};
}

class FakeElement {
	constructor(tag = "div") {
		this.tagName = String(tag).toUpperCase();
		this.nodeType = 1;
		this.attributes = new Map();
		this.children = [];
		this.childNodes = [];
		this.parentElement = null;
		this.isConnected = true;
		this.style = makeStyle();
		this.classList = {
			add() {},
			remove() {},
			toggle() {},
			contains: () => false,
		};
		this.dataset = {};
		this.dispatched = [];
		this.clicks = 0;
		this.scrollLeft = 0;
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
		const next = force === undefined ? !this.attributes.has(name) : Boolean(force);
		if (next) this.attributes.set(name, "");
		else this.attributes.delete(name);
		return next;
	}
	closest(selector) {
		if (typeof this._closest === "function") return this._closest.call(this, selector) ?? null;
		return null;
	}
	matches(selector) {
		return this.closest(selector) === this;
	}
	querySelector(selector) {
		if (typeof this._querySelector === "function") return this._querySelector.call(this, selector) ?? null;
		return null;
	}
	querySelectorAll(selector) {
		if (typeof this._querySelectorAll === "function") return this._querySelectorAll.call(this, selector) ?? [];
		return [];
	}
	getBoundingClientRect() {
		if (typeof this._rect === "function") return this._rect.call(this);
		return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 };
	}
	dispatchEvent(event) {
		this.dispatched.push(event);
		return true;
	}
	click() {
		this.clicks += 1;
	}
	append() {}
	appendChild(node) {
		this.children.push(node);
		node.parentElement = this;
		return node;
	}
	removeChild(node) {
		this.children = this.children.filter((child) => child !== node);
		return node;
	}
	insertBefore(node) {
		this.children.push(node);
		node.parentElement = this;
		return node;
	}
	remove() {
		this.isConnected = false;
	}
	replaceChildren() {
		this.children = [];
	}
	after() {}
	before() {}
	prepend() {}
	addEventListener() {}
	removeEventListener() {}
	focus() {}
	blur() {}
	contains(node) {
		return node === this;
	}
	get innerHTML() {
		return "";
	}
	set innerHTML(_value) {}
	get textContent() {
		return "";
	}
	set textContent(_value) {}
}

/** A value that answers every operation without doing anything. */
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

/* ---------------------------------------------------------------------- */
/* Boot                                                                   */
/* ---------------------------------------------------------------------- */

function bootGestures({ narrow = true, mode = narrow ? "mobile" : "desktop", width = narrow ? 390 : 1024, configureDocument = () => {} } = {}) {
	let definition;
	const disposers = [];
	const timers = new Map();
	let nextTimer = 1;
	const frames = new Map();
	let nextFrame = 1;
	const documentHandlers = [];
	const windowHandlers = [];
	const vvHandlers = [];
	const schedule = (callback, delay) => {
		const id = nextTimer++;
		timers.set(id, { callback, delay });
		return id;
	};
	const cancel = (id) => {
		timers.delete(id);
	};
	const requestFrame = (callback) => {
		const id = nextFrame++;
		frames.set(id, callback);
		return id;
	};
	const cancelFrame = (id) => {
		frames.delete(id);
	};
	const visualViewport = {
		height: 844,
		offsetTop: 0,
		addEventListener(type, handler) {
			vvHandlers.push([type, handler]);
		},
		removeEventListener() {},
	};

	const doc = new FakeElement("#document");
	doc.baseURI = "http://localhost/";
	doc.documentElement = new FakeElement("html");
	doc.head = new FakeElement("head");
	doc.body = new FakeElement("body");
	doc.activeElement = null;
	doc.visibilityState = "visible";
	doc.styleSheets = [];
	doc.createElement = (tag) => new FakeElement(tag);
	doc.getElementById = () => null;
	doc.querySelector = () => null;
	doc.querySelectorAll = () => [];
	doc.addEventListener = (type, handler) => {
		documentHandlers.push([type, handler]);
	};
	doc.removeEventListener = () => {};
	configureDocument(doc);

	const sandbox = {
		__RDSH_PWA_PROBES__: PROBES,
		__RDSH_PWA_COPY__: COPY,
		__RDSH_DEVICE_MODE__: mode,
		window: {
			__ModuleLoader__: {
				load(value) {
					definition = value;
				},
			},
			document: doc,
			matchMedia: makeMatchMedia(narrow),
			setTimeout: schedule,
			clearTimeout: cancel,
			requestAnimationFrame: requestFrame,
			cancelAnimationFrame: cancelFrame,
			addEventListener: (type, handler) => {
				windowHandlers.push([type, handler]);
			},
			removeEventListener: () => {},
			location: { href: "http://localhost/" },
			navigator: stub(),
			localStorage: stub(),
			screen: { height: 844 },
			performance: { now: () => 0 },
			innerWidth: width,
			innerHeight: 844,
			visualViewport,
		},
		document: doc,
		navigator: stub(),
		location: { href: "http://localhost/" },
		localStorage: stub(),
		sessionStorage: stub(),
		matchMedia: makeMatchMedia(narrow),
		addEventListener: () => {},
		removeEventListener: () => {},
		setTimeout: schedule,
		clearTimeout: cancel,
		setInterval: () => 0,
		clearInterval: () => {},
		requestAnimationFrame: requestFrame,
		cancelAnimationFrame: cancelFrame,
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
		Element: FakeElement,
		HTMLElement: FakeElement,
		Node: FakeElement,
		Event: FakeEvent,
		MouseEvent: FakeMouseEvent,
		PointerEvent: FakeEvent,
		KeyboardEvent: FakeEvent,
		TouchEvent: FakeEvent,
		Touch: class Touch {},
		MessageChannel: class MessageChannel {},
		Notification: stub(),
		AudioContext: class AudioContext {},
		screen: { height: 844 },
		innerWidth: width,
		innerHeight: 844,
		devicePixelRatio: 3,
		performance: { now: () => 0 },
	};
	sandbox.globalThis = sandbox;
	sandbox.window.document = doc;
	sandbox.window.matchMedia = sandbox.matchMedia;
	sandbox.window.setTimeout = schedule;
	sandbox.window.clearTimeout = cancel;
	sandbox.window.setInterval = sandbox.setInterval;
	sandbox.window.clearInterval = sandbox.clearInterval;
	sandbox.window.requestAnimationFrame = requestFrame;
	sandbox.window.cancelAnimationFrame = cancelFrame;
	sandbox.window.addEventListener = sandbox.window.addEventListener;
	sandbox.window.removeEventListener = sandbox.window.removeEventListener;
	sandbox.window.location = sandbox.location;
	sandbox.window.navigator = sandbox.navigator;
	sandbox.window.localStorage = sandbox.localStorage;
	sandbox.window.screen = sandbox.screen;
	sandbox.window.performance = sandbox.performance;

	vm.createContext(sandbox);
	vm.runInContext(CLIENT, sandbox, { filename: "client.js" });
	assert.ok(definition !== undefined, "the module registered itself");
	const plugin = definition.factory(() => stub());
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
				return typeof callback === "function" ? callback() : undefined;
			},
			register() {
				return () => {};
			},
		},
		get: () => undefined,
		on: () => () => {},
	};
	plugin.apply(ctx);

	const drainFrames = (limit = 40) => {
		for (let index = 0; index < limit; index += 1) {
			if (frames.size === 0) return;
			const batch = [...frames.values()];
			frames.clear();
			for (const callback of batch) callback();
		}
	};
	const runTimers = (delay) => {
		const batch = [...timers.entries()].filter(([, timer]) => delay === undefined || timer.delay === delay);
		for (const [id, timer] of batch) {
			timers.delete(id);
			timer.callback();
		}
	};
	const handler = (type, name) => [...documentHandlers].reverse()
		.find(([registered, fn]) => registered === type && fn.name === name)?.[1];

	return {
		sandbox,
		doc,
		visualViewport,
		timers,
		frames,
		vvHandlers,
		windowHandlers,
		drainFrames,
		runTimers,
		handler,
		disposeAll() {
			for (const dispose of disposers.splice(0).reverse()) dispose();
		},
	};
}

function makeMatchMedia(narrow) {
	return (query) => ({
		matches: Boolean(narrow && query.includes("max-width: 767px")),
		addEventListener() {},
		removeEventListener() {},
	});
}

/** A pointer event with the fields the gesture code reads. */
function pointerEvent(target, x, y, { type = "touch", id = 7, primary = true } = {}) {
	return {
		target,
		pointerType: type,
		pointerId: id,
		isPrimary: primary,
		button: 0,
		clientX: x,
		clientY: y,
		cancelable: true,
		prevented: 0,
		stopped: 0,
		preventDefault() {
			this.prevented += 1;
		},
		stopImmediatePropagation() {
			this.stopped += 1;
		},
		stopPropagation() {
			this.stopped += 1;
		},
	};
}

/** A tab whose strip is @param strip. */
function tabFixture() {
	const strip = new FakeElement("div");
	strip.setAttribute("data-dockkit-strip-tabs", "");
	strip.scrollLeft = 100;
	const tab = new FakeElement("div");
	tab.setAttribute("data-rdsh-rtab", "");
	tab._closest = (selector) => {
		if (selector.includes("data-dockkit-strip-tabs")) return strip;
		if (selector.includes("[data-rdsh-rtab]") || selector.includes("[data-dockkit-tab]")) return tab;
		return null;
	};
	const target = new FakeElement("div");
	target._closest = (selector) => {
		if (selector === "[data-rdsh-rtab]") return tab;
		if (selector.includes("data-dockkit-tab-close")) return null;
		return null;
	};
	return { tab, strip, target };
}

function hasTimer(booted, delay) {
	return [...booted.timers.values()].some((timer) => timer.delay === delay);
}

/* ---------------------------------------------------------------------- */
/* #31: hold before the upstream tab drag                                 */
/* ---------------------------------------------------------------------- */

test("a touch tab stays blocked until the 450ms hold opens dockkit's drag", () => {
	const booted = bootGestures({ narrow: true });
	booted.drainFrames();
	const down = booted.handler("pointerdown", "onPointerDown");
	const move = booted.handler("pointermove", "onPointerMove");
	const up = booted.handler("pointerup", "onPointerUp");
	assert.equal(typeof down, "function", "pointerdown handler registered");
	assert.equal(typeof move, "function", "pointermove handler registered");
	assert.equal(typeof up, "function", "pointerup handler registered");
	const { tab, target } = tabFixture();

	down(pointerEvent(target, 100, 50));
	assert.equal(hasTimer(booted, 450), true, "the hold is scheduled at 450ms");
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), false, "nothing is lifted yet");

	const early = pointerEvent(target, 104, 52);
	move(early);
	assert.equal(early.stopped, 1, "a pre-hold move is stopped before dockkit's 4px drag");
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), false);

	booted.runTimers(450);
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), true, "the hold lifts the tab");

	const afterHold = pointerEvent(target, 130, 52);
	move(afterHold);
	assert.equal(afterHold.stopped, 0, "the hold releases pointermove to the upstream drag");

	up(pointerEvent(target, 130, 52));
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), false, "the lift is cleared on release");

	// The release can still synthesise a click on the tab that was dragged;
	// that click is a reorder artefact, not a tab switch.
	const click = {
		target,
		prevented: 0,
		stopped: 0,
		preventDefault() {
			this.prevented += 1;
		},
		stopImmediatePropagation() {
			this.stopped += 1;
		},
	};
	booted.handler("click", "onClickCapture")(click);
	assert.equal(click.prevented, 1, "a post-drag click is cancelled");
	assert.equal(click.stopped, 1, "the tab's own onClick never runs for that click");
	booted.disposeAll();
});

test("mouse and pen tabs: mouse is unchanged, pen waits for the same hold", () => {
	const booted = bootGestures({ narrow: true });
	booted.drainFrames();
	const down = booted.handler("pointerdown", "onPointerDown");
	const move = booted.handler("pointermove", "onPointerMove");
	const { tab, target } = tabFixture();

	booted.runTimers();
	down(pointerEvent(target, 40, 40, { type: "mouse", id: 1 }));
	assert.equal(hasTimer(booted, 450), false, "a mouse press does not arm the hold");
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), false);

	down(pointerEvent(target, 40, 40, { type: "pen", id: 2 }));
	assert.equal(hasTimer(booted, 450), true, "a pen press arms the hold");
	const early = pointerEvent(target, 45, 41, { type: "pen", id: 2 });
	move(early);
	assert.equal(early.stopped, 1, "a pen move before the hold is blocked");
	booted.disposeAll();
});

test("a second finger cannot replace the primary tab gesture", () => {
	const booted = bootGestures({ narrow: true });
	booted.drainFrames();
	const down = booted.handler("pointerdown", "onPointerDown");
	const up = booted.handler("pointerup", "onPointerUp");
	const { tab, target } = tabFixture();
	const otherTab = new FakeElement("div");
	otherTab.setAttribute("data-rdsh-rtab", "");
	otherTab._closest = (selector) => (selector.includes("[data-rdsh-rtab]") ? otherTab : null);
	const otherTarget = new FakeElement("div");
	otherTarget._closest = (selector) => (selector === "[data-rdsh-rtab]" ? otherTab : null);

	down(pointerEvent(target, 100, 50, { id: 7 }));
	down(pointerEvent(otherTarget, 200, 50, { id: 8, primary: false }));
	booted.runTimers(450);
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), true, "the primary tab owns the hold");
	assert.equal(otherTab.hasAttribute("data-rdsh-tab-hold"), false, "the secondary pointer did not start a gesture");

	// A secondary pointer's release must not clear the primary's hold.
	up(pointerEvent(otherTarget, 200, 50, { id: 8, primary: false }));
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), true, "the secondary release did not cancel the hold");
	up(pointerEvent(target, 100, 50, { id: 7 }));
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), false, "the primary release clears it");
	booted.disposeAll();
});

test("sideways movement pans the strip and cancels the hold; vertical does not pan", () => {
	const booted = bootGestures({ narrow: true });
	booted.drainFrames();
	const down = booted.handler("pointerdown", "onPointerDown");
	const move = booted.handler("pointermove", "onPointerMove");
	const up = booted.handler("pointerup", "onPointerUp");
	const { tab, strip, target } = tabFixture();

	down(pointerEvent(target, 100, 50));
	const sideways = pointerEvent(target, 80, 52);
	move(sideways);
	assert.equal(sideways.stopped, 1, "a cancelling move is still blocked from upstream");
	assert.equal(strip.scrollLeft, 120, "the strip pans by the finger delta");
	booted.runTimers(450);
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), false, "movement cancels the hold");
	up(pointerEvent(target, 80, 52));
	assert.equal(hasTimer(booted, 250), false, "a pan is not replayed as a tab tap");

	strip.scrollLeft = 100;
	down(pointerEvent(target, 100, 50));
	const vertical = pointerEvent(target, 102, 90);
	move(vertical);
	assert.equal(strip.scrollLeft, 100, "a vertical drag does not pan the strip");
	booted.runTimers(450);
	assert.equal(tab.hasAttribute("data-rdsh-tab-hold"), false, "vertical movement also cancels the hold");
	booted.disposeAll();
});

test("a touch pan that starts on the strip gutter or fill scrolls without arming a hold", () => {
	const booted = bootGestures({ narrow: true });
	booted.drainFrames();
	const down = booted.handler("pointerdown", "onPointerDown");
	const move = booted.handler("pointermove", "onPointerMove");
	const up = booted.handler("pointerup", "onPointerUp");

	const strip = new FakeElement("div");
	strip.setAttribute("data-dockkit-strip-tabs", "");
	strip.scrollLeft = 100;
	strip.clientWidth = 200;
	strip.scrollWidth = 400;
	const outer = new FakeElement("div");
	outer.setAttribute("data-dockkit-strip", "");
	outer._querySelector = (selector) => (selector === "[data-dockkit-strip-tabs]" ? strip : null);
	const rightPanel = new FakeElement("div");
	rightPanel.setAttribute("data-sidebar-right-panel", "");
	const gutter = new FakeElement("div");
	gutter._closest = (selector) => {
		if (selector.includes("data-sidebar-right-panel")) return rightPanel;
		if (selector.includes("data-dockkit-strip-tabs")) return strip;
		return null;
	};
	const fill = new FakeElement("div");
	fill._closest = (selector) => {
		if (selector.includes("data-sidebar-right-panel")) return rightPanel;
		if (selector.includes("data-dockkit-strip-fill")) return fill;
		if (selector.includes("data-dockkit-strip-tabs")) return null;
		if (selector === "[data-dockkit-strip]") return outer;
		return null;
	};
	const outside = new FakeElement("div");
	outside._closest = (selector) => (selector.includes("data-dockkit-strip-tabs") ? strip : null);

	down(pointerEvent(gutter, 300, 50));
	assert.equal(hasTimer(booted, 450), false, "the gutter does not arm a tab hold");
	const sideways = pointerEvent(gutter, 280, 52);
	move(sideways);
	assert.equal(strip.scrollLeft, 120, "the gutter pan did not move the strip");
	up(pointerEvent(gutter, 280, 52));
	assert.equal(hasTimer(booted, 250), false, "the gutter pan was replayed as a tap");

	strip.scrollLeft = 100;
	down(pointerEvent(fill, 300, 50));
	move(pointerEvent(fill, 270, 51));
	assert.equal(strip.scrollLeft, 130, "the strip-fill pan did not move the strip");
	up(pointerEvent(fill, 270, 51));

	strip.scrollLeft = 100;
	down(pointerEvent(gutter, 300, 50));
	move(pointerEvent(gutter, 302, 90));
	assert.equal(strip.scrollLeft, 100, "a vertical gutter drag panned the strip");
	up(pointerEvent(gutter, 302, 90));

	// A left/other dockkit strip is not the right panel: no manual pan.
	strip.scrollLeft = 100;
	down(pointerEvent(outside, 300, 50));
	move(pointerEvent(outside, 270, 50));
	assert.equal(strip.scrollLeft, 100, "a non-right-panel strip was panned");
	up(pointerEvent(outside, 270, 50));

	// pointercancel and dispose both restore the strip's scroll-behavior.
	const cancel = booted.handler("pointercancel", "onPointerCancel");
	strip.style.scrollBehavior = "smooth";
	down(pointerEvent(gutter, 300, 50));
	assert.equal(strip.style.scrollBehavior, "auto", "the pan did not force auto scroll");
	cancel();
	assert.equal(strip.style.scrollBehavior, "smooth", "pointercancel did not restore scroll-behavior");

	strip.style.scrollBehavior = "smooth";
	down(pointerEvent(gutter, 300, 50));
	assert.equal(strip.style.scrollBehavior, "auto");
	booted.disposeAll();
	assert.equal(strip.style.scrollBehavior, "smooth", "dispose did not restore scroll-behavior");

	const desktop = bootGestures({ mode: "desktop", width: 390, narrow: true });
	desktop.drainFrames();
	const desktopDown = desktop.handler("pointerdown", "onPointerDown");
	const desktopMove = desktop.handler("pointermove", "onPointerMove");
	assert.equal(desktopDown, undefined, "desktop must not install a gutter pointerdown handler");
	assert.equal(desktopMove, undefined, "desktop must not install a gutter pointermove handler");
	desktop.disposeAll();
});

test("a new primary strip pan drops a stale tab replay, stale pan and secondary cancel", () => {
	const booted = bootGestures({ narrow: true });
	booted.drainFrames();
	const down = booted.handler("pointerdown", "onPointerDown");
	const up = booted.handler("pointerup", "onPointerUp");
	const move = booted.handler("pointermove", "onPointerMove");
	const cancel = booted.handler("pointercancel", "onPointerCancel");

	const { tab, target } = tabFixture();
	down(pointerEvent(target, 100, 50));
	up(pointerEvent(target, 100, 51));
	assert.equal(hasTimer(booted, 250), true, "the tab tap did not schedule a replay");

	const rightPanel = new FakeElement("div");
	rightPanel.setAttribute("data-sidebar-right-panel", "");
	const strip = new FakeElement("div");
	strip.setAttribute("data-dockkit-strip-tabs", "");
	strip.scrollLeft = 100;
	strip.clientWidth = 200;
	strip.scrollWidth = 400;
	strip.style.scrollBehavior = "smooth";
	const gutter = new FakeElement("div");
	gutter._closest = (selector) => {
		if (selector.includes("data-sidebar-right-panel")) return rightPanel;
		if (selector.includes("data-dockkit-strip-tabs")) return strip;
		return null;
	};

	down(pointerEvent(gutter, 300, 50));
	assert.equal(hasTimer(booted, 250), false, "the gutter down kept the old tab replay");
	booted.runTimers(250);
	assert.equal(tab.dispatched.length, 0, "the old tab click fired during the pan");
	assert.equal(strip.style.scrollBehavior, "auto", "the pan did not force auto scroll");

	// A duplicate primary down without an up releases the old candidate before
	// storing its scroll-behavior, so the strip can return to smooth.
	down(pointerEvent(gutter, 300, 50));
	assert.equal(strip.style.scrollBehavior, "auto");
	up(pointerEvent(gutter, 300, 51));
	assert.equal(strip.style.scrollBehavior, "smooth", "the stale candidate restored auto");

	// A secondary pointercancel must not stop the primary pan.
	strip.scrollLeft = 100;
	strip.style.scrollBehavior = "smooth";
	down(pointerEvent(gutter, 300, 50));
	move(pointerEvent(gutter, 290, 50));
	assert.equal(strip.scrollLeft, 110, "the primary pan did not start");
	cancel(pointerEvent(gutter, 290, 50, { id: 9, primary: false }));
	move(pointerEvent(gutter, 280, 50));
	assert.equal(strip.scrollLeft, 120, "a secondary cancel stopped the primary pan");
	up(pointerEvent(gutter, 280, 50));
	assert.equal(strip.style.scrollBehavior, "smooth");
	booted.disposeAll();
});

test("a plain tap still switches through the one-shot click replay", () => {
	const booted = bootGestures({ narrow: true });
	booted.drainFrames();
	const down = booted.handler("pointerdown", "onPointerDown");
	const up = booted.handler("pointerup", "onPointerUp");
	const { tab, target } = tabFixture();

	down(pointerEvent(target, 100, 50));
	up(pointerEvent(target, 100, 51));
	assert.equal(hasTimer(booted, 250), true, "a tap schedules the replay");
	booted.runTimers(250);
	assert.equal(tab.dispatched.length, 1, "the replay dispatched one click");
	assert.equal(tab.dispatched[0].type, "click");
	booted.disposeAll();
});

/* ---------------------------------------------------------------------- */
/* #32: the panel close swipe ignores its tab strip and header            */
/* ---------------------------------------------------------------------- */

function panelFixture(doc, width = 390) {
	const root = new FakeElement("div");
	const panel = new FakeElement("div");
	const collapse = new FakeElement("button");
	panel._closest = (selector) => (selector === "[data-sidebar-right-panel]" ? root : null);
	panel._rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: width, bottom: 800, width, height: 800 });
	collapse.setAttribute("aria-label", "Collapse right sidebar");
	collapse._closest = (selector) => (selector === "[data-sidebar-right-panel]" ? root : null);
	collapse._rect = () => ({ x: width - 90, y: 10, top: 10, left: width - 90, right: width - 66, bottom: 34, width: 24, height: 24 });
	collapse.parentElement = panel;
	doc.querySelectorAll = (selector) => (selector === '[aria-label="Collapse right sidebar"]' ? [collapse] : []);
	return { root, panel, collapse };
}

test("a swipe that starts on the tab strip or header does not close the panel", () => {
	const booted = bootGestures({ narrow: true });
	const { collapse } = panelFixture(booted.doc);
	booted.drainFrames();
	assert.equal(booted.doc.documentElement.hasAttribute("data-rdsh-rightpanel-open"), true, "the panel is open");

	const start = booted.handler("touchstart", "onEdgeSwipeStart");
	const move = booted.handler("touchmove", "onEdgeSwipeMove");
	const touch = (x, y = 200) => ({ cancelable: true, prevented: 0, preventDefault() { this.prevented += 1; }, touches: [{ clientX: x, clientY: y }] });

	const tablist = new FakeElement("div");
	const chrome = new FakeElement("div");
	chrome._closest = (selector) => (selector.includes('[role="tablist"]') ? tablist : null);
	start({ touches: [{ clientX: 300, clientY: 30 }], target: chrome });
	move(touch(390, 30));
	assert.equal(collapse.clicks, 0, "the tab strip is not a close gesture");

	const header = new FakeElement("div");
	header._closest = (selector) => (selector.includes("header") ? header : null);
	start({ touches: [{ clientX: 300, clientY: 30 }], target: header });
	move(touch(390, 30));
	assert.equal(collapse.clicks, 0, "the panel header is not a close gesture");

	// The body keeps the existing rightward close (dx >= 64), and a leftward
	// swipe still does nothing; the issue text had the sign backwards.
	const body = new FakeElement("div");
	body._closest = () => null;
	start({ touches: [{ clientX: 200, clientY: 400 }], target: body });
	move(touch(300, 400));
	assert.equal(collapse.clicks, 1, "the body swipe still closes the panel");

	start({ touches: [{ clientX: 300, clientY: 400 }], target: body });
	move(touch(200, 400));
	assert.equal(collapse.clicks, 1, "the close stays rightward-only");

	// The ✕ itself is a plain button click, not a swipe.
	collapse.click();
	assert.equal(collapse.clicks, 2, "the collapse button still closes");
	booted.disposeAll();
});

test("a long press on a tab does not open the text callout menu", () => {
	const booted = bootGestures({ narrow: true });
	booted.drainFrames();
	const context = booted.handler("contextmenu", "onSessionContextMenu");
	assert.equal(typeof context, "function", "contextmenu handler registered");
	const { tab } = tabFixture();
	const target = new FakeElement("div");
	target._closest = (selector) => (selector.includes("[data-rdsh-rtab]") ? tab : null);
	const event = {
		target,
		prevented: 0,
		preventDefault() {
			this.prevented += 1;
		},
	};
	context(event);
	assert.equal(event.prevented, 1, "the hold's callout is suppressed on a tab");
	const other = new FakeElement("div");
	other._closest = () => null;
	const neutral = { target: other, prevented: 0, preventDefault() { this.prevented += 1; } };
	context(neutral);
	assert.equal(neutral.prevented, 0, "a context menu outside the tab is untouched");
	booted.disposeAll();
});

/* ---------------------------------------------------------------------- */
/* #38: terminal fit follows the visual viewport                          */
/* ---------------------------------------------------------------------- */
function terminalFixture(doc, collapseFixture) {
	const section = new FakeElement("section");
	section.setAttribute("data-sidebar-terminal", "");
	const screen = new FakeElement("div");
	screen._rect = () => ({ x: 0, y: 44, top: 44, left: 0, right: 390, bottom: 744, width: 390, height: 700 });
	const xterm = new FakeElement("div");
	xterm.parentElement = screen;
	const scroller = new FakeElement("div");
	scroller.setAttribute("class", "xterm-scrollable-element");
	section._querySelector = (selector) => (selector === ".xterm" ? xterm : null);
	screen.parentElement = section;
	screen._querySelector = (selector) => {
		if (selector === ".xterm-scrollable-element") return scroller;
		if (selector === ".xterm-screen") return null;
		return null;
	};
	doc.querySelectorAll = (selector) => {
		if (selector === "[data-sidebar-terminal]") return [section];
		if (selector === "[data-rdsh-terminal-fit]") return screen.hasAttribute("data-rdsh-terminal-fit") ? [screen] : [];
		if (selector === '[aria-label="Collapse right sidebar"]') return [collapseFixture.collapse];
		if (selector === "[data-rdsh-rightpanel]") return [];
		return [];
	};
	return { section, screen, xterm, scroller };
}

function visualViewportHandler(booted, type = "resize") {
	return [...booted.vvHandlers].reverse().find(([registered]) => registered === type)?.[1];
}

test("the terminal mount shrinks to the visual viewport without synthesising input", () => {
	const booted = bootGestures({ narrow: true });
	const collapseFixture = panelFixture(booted.doc);
	const terminal = terminalFixture(booted.doc, collapseFixture);
	booted.drainFrames();
	assert.equal(booted.doc.documentElement.hasAttribute("data-rdsh-rightpanel-open"), true, "the panel is open");

	const resize = visualViewportHandler(booted);
	assert.equal(typeof resize, "function", "the visual viewport resize is watched");
	assert.equal(typeof visualViewportHandler(booted, "scroll"), "function", "the visual viewport scroll is watched too");

	booted.visualViewport.height = 544;
	resize();
	// Five events before the frame coalesce into one fit.
	booted.drainFrames();
	assert.equal(terminal.screen.style.height, "500px", "the mount follows 544px minus its 44px top");
	assert.equal(terminal.screen.style.flex, "0 0 auto", "the mount is not grown back by flex");
	assert.equal(terminal.screen.hasAttribute("data-rdsh-terminal-fit"), true);
	assert.equal(terminal.screen.style.rows, undefined, "no fake rows attribute is written");
	assert.equal(terminal.screen.hasAttribute("rows"), false);
	// No wheel, key or mouse event may be sent to the terminal: a wheel is
	// input to a mouse-tracking/alternate-buffer program.
	assert.equal(terminal.scroller.dispatched.length, 0, "the fit does not synthesise a terminal event");

	// A decoration pass with the same geometry must not write again either.
	const before = terminal.screen.style.height;
	resize();
	booted.drainFrames();
	assert.equal(terminal.screen.style.height, before, "an unchanged fit keeps the same height");
	assert.equal(terminal.scroller.dispatched.length, 0, "an unchanged fit still sends no terminal event");

	booted.visualViewport.height = 844;
	resize();
	booted.drainFrames();
	assert.equal(terminal.screen.style.height, undefined, "closing the keyboard removes the fitted height");
	assert.equal(terminal.screen.hasAttribute("data-rdsh-terminal-fit"), false, "the fit hook is cleared");
	booted.disposeAll();
});

test("keyboard open/close cycles leave no stale height, and rotation refits", () => {
	const booted = bootGestures({ narrow: true });
	const collapseFixture = panelFixture(booted.doc);
	const terminal = terminalFixture(booted.doc, collapseFixture);
	booted.drainFrames();
	const resize = visualViewportHandler(booted);

	for (let cycle = 0; cycle < 5; cycle += 1) {
		booted.visualViewport.height = 544;
		resize();
		booted.drainFrames();
		assert.equal(terminal.screen.style.height, "500px", `cycle ${cycle + 1} did not fit`);
		booted.visualViewport.height = 844;
		resize();
		booted.drainFrames();
		assert.equal(terminal.screen.style.height, undefined, `cycle ${cycle + 1} left a gap`);
	}

	// Five resize events in one frame schedule exactly one fit.
	booted.visualViewport.height = 544;
	for (let index = 0; index < 5; index += 1) resize();
	const fits = [...booted.frames.values()].filter((callback) => callback.name === "applyTerminalFit");
	assert.equal(fits.length, 1, "the fit is coalesced into one frame");
	booted.drainFrames();

	booted.visualViewport.height = 390;
	const orientation = [...booted.windowHandlers].reverse().find(([type]) => type === "orientationchange")?.[1];
	assert.equal(typeof orientation, "function", "rotation is watched");
	orientation();
	booted.drainFrames();
	assert.equal(terminal.screen.style.height, "346px", "a rotation runs the same fit path");
	booted.disposeAll();
});

test("a visual-viewport scroll (offsetTop change) refits without touching the terminal", () => {
	const booted = bootGestures({ narrow: true });
	const collapseFixture = panelFixture(booted.doc);
	const terminal = terminalFixture(booted.doc, collapseFixture);
	booted.drainFrames();

	booted.visualViewport.height = 544;
	booted.visualViewport.offsetTop = 120;
	visualViewportHandler(booted, "scroll")();
	booted.drainFrames();
	assert.equal(terminal.screen.style.height, "620px", "the band bottom, not the visible height, drives the mount");
	assert.equal(terminal.scroller.dispatched.length, 0, "a moved band still sends no terminal event");
	booted.disposeAll();
});

test("a closed panel or a desktop width clears the terminal fit", () => {
	const booted = bootGestures({ narrow: true });
	const collapseFixture = panelFixture(booted.doc);
	const terminal = terminalFixture(booted.doc, collapseFixture);
	booted.drainFrames();
	const resize = visualViewportHandler(booted);

	booted.visualViewport.height = 544;
	resize();
	booted.drainFrames();
	assert.equal(terminal.screen.style.height, "500px");

	// Make the panel measure as gone: the next decorate drops the open state.
	collapseFixture.panel._rect = () => ({ x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
	resize();
	booted.drainFrames();
	assert.equal(booted.doc.documentElement.hasAttribute("data-rdsh-rightpanel-open"), false, "the closed panel is noticed");
	assert.equal(terminal.screen.style.height, undefined, "a closed panel keeps no inline height");
	booted.disposeAll();

	// A 390px desktop window builds no plugin: no visual-viewport handler is
	// installed and no fit is ever attempted.
	const desktop = bootGestures({ mode: "desktop", width: 390 });
	assert.equal(visualViewportHandler(desktop), undefined, "a desktop installed a visual-viewport handler");
	const desktopCollapse = panelFixture(desktop.doc);
	const desktopTerminal = terminalFixture(desktop.doc, desktopCollapse);
	desktop.drainFrames();
	desktop.visualViewport.height = 544;
	desktop.drainFrames();
	assert.equal(desktopTerminal.screen.style.height, undefined, "a desktop window never fits");
	assert.equal(desktop.doc.documentElement.hasAttribute("data-rdsh-rightpanel-open"), false, "a desktop wrote mobile panel state");
	desktop.disposeAll();

	// A 1024px mobile tablet keeps the fit feature.
	const tablet = bootGestures({ mode: "mobile", width: 1024 });
	const tabletCollapse = panelFixture(tablet.doc, 1024);
	const tabletTerminal = terminalFixture(tablet.doc, tabletCollapse);
	tablet.drainFrames();
	tablet.visualViewport.height = 544;
	visualViewportHandler(tablet)();
	tablet.drainFrames();
	assert.equal(tabletTerminal.screen.style.height, "500px", "a wide mobile tablet lost the fit");
	tablet.disposeAll();
});

test("the phone stylesheet reopens the vertical axis on every dockkit tab layer", () => {
	// touch-action is the intersection of the hit tab, its strip and the
	// scroller up to the scroll container; leaving the tab at `none` keeps
	// vertical scrolling blocked even when the two strip layers are reopened.
	assert.match(
		CLIENT,
		/\[data-sidebar-right-panel\] \[data-dockkit-strip\],\s*\n\s*\[data-sidebar-right-panel\] \[data-dockkit-strip-tabs\],\s*\n\s*\[data-sidebar-right-panel\] \[data-dockkit-strip-fill\],\s*\n\s*\[data-sidebar-right-panel\] \[data-dockkit-tab\] \{ touch-action: pan-y; \}/,
		"the tab layer is still touch-action: none",
	);
});

test("the terminal fit never synthesises a wheel or other terminal event", () => {
	// xterm 6's SmoothScrollableElement is not a DOM scroller: its wrapper has
	// no overflow and its scrollTop is unrelated. A wheel is application input
	// for alternate-buffer / mouse-tracking programs, so fit only.
	const start = CLIENT.indexOf("Terminal: keep the screen inside the visual viewport");
	const end = CLIENT.indexOf("function scrollableAncestor", start);
	assert.ok(start !== -1 && end > start, "the terminal fit block is present");
	const block = CLIENT.slice(start, end);
	assert.doesNotMatch(block, /dispatchEvent/, "the fit dispatches an event");
	assert.doesNotMatch(block, /new Event\("wheel"\)/, "the fit creates a wheel");
	assert.doesNotMatch(CLIENT, /deltaY = 1e7/, "the huge wheel fallback is back");
});
