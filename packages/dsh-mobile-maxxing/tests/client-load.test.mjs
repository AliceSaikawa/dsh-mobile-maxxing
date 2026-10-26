/**
 * Browser-half smoke test: does the module body and its `apply` run at all?
 *
 * The client bundle is loaded verbatim, so a reference to something that no
 * longer exists is not a syntax error — it throws the first time that line
 * runs, which is usually during boot. Bulk edits here twice left such a
 * reference behind while every other test stayed green, and only a real
 * browser noticed. This runs the module against a stub environment so a
 * ReferenceError fails the suite instead.
 *
 * The stub is a recursive Proxy: any property read answers "something", and
 * any call answers another stub. That is enough for the layout code's many
 * incidental DOM reads, while a genuinely undeclared identifier still raises
 * ReferenceError because that is a scope lookup, not a property read.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";
import { COPY, LOCALE_PACKS, PROBES } from "../lib/copy.js";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

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

/** A DOM element stand-in: every method answers, attributes start empty. */
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

/**
 * A localStorage that remembers, for tests that boot with a saved choice.
 *
 * The plain stub answers every call, which is enough for code that only checks
 * for a missing key but cannot express "this browser opted in".
 */
function memoryStorage(initial = {}) {
	const map = new Map(Object.entries(initial));
	return {
		getItem: (key) => (map.has(key) ? map.get(key) : null),
		setItem: (key, value) => {
			map.set(key, String(value));
		},
		removeItem: (key) => {
			map.delete(key);
		},
		clear: () => map.clear(),
		key: (index) => [...map.keys()][index] ?? null,
		get length() {
			return map.size;
		},
	};
}

/**
 * Evaluate the bundle in a stub browser and run the plugin's `apply`.
 *
 * `mode` is the canonical host bootstrap value (`"mobile"` or `"desktop"`);
 * `narrow` answers only the window-width media query. They are deliberately
 * independent: pass `mode` explicitly when a test is about the device contract.
 * `standalone` answers the display-mode query, `storage` supplies remembered
 * localStorage entries, `configureDocument` lets a test wire up the few DOM
 * nodes it cares about, and `schedule` replaces setTimeout. `requireImpl`
 * replaces the module table the bundle loads (the default answers every name
 * with a stub), `services` supplies named client services through `ctx.get`,
 * `globals` seeds the sandbox with the flags a test seam reads before load,
 * and `log` replaces the sandbox console.
 */
function bootClient({
	mode = null,
	narrow = false,
	injectMode = true,
	standalone = false,
	storage = null,
	configureDocument = () => {},
	schedule = () => 0,
	frame = () => 0,
	frames = null,
	failFirstSlot = false,
	windowAdd = null,
	windowRemove = null,
	lang = undefined,
	copy = null,
	fetchImpl = null,
	navigator = null,
	computedStyle = () => stub(),
	theme = null,
	locale = null,
	requireImpl = null,
	services = {},
	globals = null,
	log = console,
	localePacks = LOCALE_PACKS,
} = {}) {
	let definition;
	const disposers = [];
	const sandbox = {
		// index.js injects the probe table into the page; the stub needs the same
		// vocabulary or the bilingual upstream-label matching falls back to
		// English and the Chinese cases never match.
		__RDSH_PWA_PROBES__: PROBES,
		window: {
			__ModuleLoader__: {
				load(value) {
					definition = value;
				},
			},
		},
		document: (() => {
			const doc = element();
			doc.baseURI = "http://localhost/";
			doc.visibilityState = "visible";
			doc.activeElement = null;
			doc.head = element();
			doc.body = element();
			doc.documentElement = element();
			doc.createElement = () => element();
			doc.styleSheets = [];
			configureDocument(doc);
			return doc;
		})(),
		navigator: navigator ?? stub(),
		location: stub(),
		localStorage: storage === null ? stub() : memoryStorage(storage),
		sessionStorage: stub(),
		matchMedia: (query) => ({
			matches: Boolean(
				(narrow && query.includes("max-width: 767px"))
				|| (standalone && query.includes("display-mode:")),
			),
			addEventListener() {},
			removeEventListener() {},
		}),
		addEventListener: windowAdd ?? (() => {}),
		removeEventListener: windowRemove ?? (() => {}),
		setTimeout: schedule,
		clearTimeout() {},
		setInterval: () => 0,
		clearInterval() {},
		requestAnimationFrame: frames !== null ? (callback) => { frames.push(callback); return 0; } : frame,
		cancelAnimationFrame() {},
		MutationObserver: class {
			observe() {}
			disconnect() {}
		},
		IntersectionObserver: class {
			observe() {}
			disconnect() {}
		},
		getComputedStyle: computedStyle,
		console: log,
		// Real globals the layout code legitimately uses.
		URL,
		URLSearchParams,
		Intl,
		TextEncoder,
		TextDecoder,
		AbortController,
		structuredClone,
		fetch: fetchImpl ?? (() => Promise.resolve(stub())),
		// DOM classes: `instanceof` needs a callable right-hand side.
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
		innerWidth: narrow ? 390 : 1024,
		innerHeight: 844,
		devicePixelRatio: 3,
		performance: { now: () => 0 },
		queueMicrotask,
		globalThis: undefined,
	};
	sandbox.globalThis = sandbox;
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
	sandbox.window.innerWidth = narrow ? 390 : 1024;
	sandbox.window.innerHeight = 844;
	if (lang !== undefined) sandbox.__RDSH_PWA_LANG__ = lang;
	if (copy !== null) sandbox.__RDSH_PWA_COPY__ = copy;
	if (localePacks !== null) sandbox.__RDSH_PWA_LOCALES__ = localePacks;
	// The canonical host bootstrap value. Null means "let the harness derive
	// the legacy default"; contract tests pass it explicitly. `injectMode:
	// false` models an old/absent bootstrap and must fail closed to desktop.
	if (injectMode) sandbox.__RDSH_DEVICE_MODE__ = mode ?? (narrow ? "mobile" : "desktop");
	if (globals !== null && typeof globals === "object") Object.assign(sandbox, globals);
	vm.createContext(sandbox);

	vm.runInContext(CLIENT, sandbox, { filename: "client.js" });
	assert.ok(definition !== undefined, "the module registered itself");

	const plugin = definition.factory(requireImpl ?? ((name) => stub()));
	assert.equal(typeof plugin.apply, "function", "the module returns a plugin");

	// `apply` is what boot() runs from. It touches a lot of DOM; the stub
	// absorbs that, and an undeclared identifier still throws.
	const eventHandlers = new Map();
	const emitted = [];
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
				if (failFirstSlot) {
					failFirstSlot = false;
					throw new Error("first slot registration failed");
				}
				return () => {};
			},
		},
		get(name) {
			if (name === "theme") return theme ?? undefined;
			if (name === "locale") return locale ?? undefined;
			return services[name];
		},
		on(event, handler) {
			let list = eventHandlers.get(event);
			if (list === undefined) {
				list = new Set();
				eventHandlers.set(event, list);
			}
			list.add(handler);
			return () => list.delete(handler);
		},
		emit(event, payload) {
			emitted.push({ event, payload });
			for (const handler of [...(eventHandlers.get(event) ?? [])]) handler(payload);
		},
		locale: locale ?? undefined,
	};
	plugin.apply(ctx);
	return {
		definition,
		plugin,
		sandbox,
		ctx,
		disposers,
		emitted,
		emit: (event, payload) => ctx.emit(event, payload),
		disposeAll() {
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

test("the browser module registers and boots without a ReferenceError", () => {
	let booted;
	assert.doesNotThrow(() => {
		booted = bootClient();
	}, "the module body must evaluate and apply must not throw a ReferenceError");
	assert.equal(booted.definition.id, "dsh-mobile-maxxing");
});

/**
 * Boot the client with an open drawer, tap a button carrying `label`, and say
 * whether the drawer's own collapse button was pressed once timers settled.
 */
function drawerClosedAfterTapping(label, { narrow = true, mode = "mobile" } = {}) {
	const timers = [];
	const clickHandlers = [];
	let collapsePresses = 0;
	const collapse = element();
	collapse.click = () => {
		collapsePresses += 1;
	};
	const drawerFrame = element();
	const root = element();
	root.firstElementChild = { firstElementChild: drawerFrame };

	bootClient({
		mode,
		narrow,
		schedule: (callback) => timers.push(callback),
		configureDocument(doc) {
			doc.getElementById = (id) => (id === "root" ? root : null);
			doc.querySelector = (selector) => (selector === '[aria-label="Collapse sidebar"]' ? collapse : null);
			doc.addEventListener = (type, handler) => {
				if (type === "click") clickHandlers.push(handler);
			};
		},
	});
	// Desktop builds no plugin at all, so it must not install the click listener.
	assert.equal(clickHandlers.length, mode === "mobile" ? 1 : 0, "the client listens for clicks exactly on mobile");
	if (clickHandlers.length === 0) return false;
	timers.length = 0;

	const button = element();
	button.setAttribute("aria-label", label);
	const target = { closest: (selector) => (selector === "button[aria-label]" ? button : null) };
	clickHandlers[0]({ target, preventDefault() {}, stopImmediatePropagation() {} });
	for (const callback of timers.splice(0)) callback();
	return collapsePresses === 1;
}

test("tapping a New session button on a phone closes the drawer", () => {
	assert.equal(drawerClosedAfterTapping("New session"), true, "sidebar button");
	assert.equal(drawerClosedAfterTapping("New session in my-repo"), true, "workspace button");
	assert.equal(drawerClosedAfterTapping("新建会话"), true, "zh sidebar button");
	assert.equal(drawerClosedAfterTapping("在“my-repo”中新建会话"), true, "zh workspace button");
});

test("other buttons leave the drawer open, and so does a wide screen", () => {
	assert.equal(drawerClosedAfterTapping("Session actions"), false);
	assert.equal(drawerClosedAfterTapping("New session", { narrow: false, mode: "desktop" }), false);
});

/**
 * The device predicate is the #17 fix, so it is exposed on the diagnostics
 * object the boot already publishes (`globalThis.__RDSH_MOBILE_UX__`).
 */
function phoneOf(options = {}) {
	const { sandbox } = bootClient(options);
	const diagnostics = sandbox.__RDSH_MOBILE_UX__;
	const mode = options.mode ?? (options.narrow === true ? "mobile" : "desktop");
	if (mode !== "mobile") {
		// Desktop is a hard no-op: no plugin, so no diagnostics to ask.
		assert.equal(diagnostics, undefined, "a desktop boot published mobile diagnostics");
		return false;
	}
	assert.ok(diagnostics !== undefined, "the mobile half booted and published its diagnostics");
	assert.equal(typeof diagnostics.phone, "function", "phone() is observable");
	return diagnostics.phone();
}

test("phone() is the bootstrapped device mode, not the width or pointer", () => {
	// The host classifier fixes the mode before this bundle runs. A narrow
	// desktop stays desktop; a wide tablet stays mobile.
	assert.equal(phoneOf({ mode: "desktop", narrow: false }), false, "a desktop is not mobile");
	assert.equal(phoneOf({ mode: "desktop", narrow: true }), false, "a narrow desktop window is still PC");
	assert.equal(phoneOf({ mode: "mobile", narrow: true }), true, "a mobile phone is mobile");
	assert.equal(phoneOf({ mode: "mobile", narrow: false }), true, "a mobile tablet at 1024px is still mobile");
	assert.equal(phoneOf({ mode: "desktop", standalone: true, narrow: false }), false, "an installed desktop app is not mobile");
	assert.equal(phoneOf({ mode: "mobile", standalone: true, narrow: false }), true, "an installed tablet is mobile");
	assert.equal(phoneOf({ mode: "bogus", narrow: true }), false, "an invalid bootstrap fails closed to desktop");
});

test("a missing bootstrap fails closed to a desktop no-op without touching the page", () => {
	const { sandbox } = bootClient({ injectMode: false, narrow: true });
	assert.equal(sandbox.__RDSH_MOBILE_UX__, undefined, "an absent bootstrap booted the mobile half");
	assert.equal(sandbox.document.documentElement.getAttribute("data-rdsh-device-mode"), null, "the client wrote a marker it does not own");
});

test("a valid mode attribute is the fallback when the global is invalid", () => {
	const { sandbox, disposeAll } = bootClient({
		mode: "bogus",
		narrow: false,
		configureDocument(doc) {
			doc.documentElement.setAttribute("data-rdsh-device-mode", "mobile");
		},
	});
	assert.equal(sandbox.__RDSH_MOBILE_UX__.state.mode, "mobile", "the valid attribute fallback was ignored");
	assert.equal(sandbox.__RDSH_MOBILE_UX__.phone(), true, "the valid attribute fallback did not enable mobile");
	assert.equal(sandbox.document.documentElement.getAttribute("data-rdsh-device-mode"), "mobile", "the marker was not kept");
	assert.deepEqual(disposeAll(), []);
});

test("a valid desktop global wins over a mobile attribute and leaves the host marker alone", () => {
	const { sandbox, disposeAll } = bootClient({
		mode: "desktop",
		narrow: false,
		configureDocument(doc) {
			doc.documentElement.setAttribute("data-rdsh-device-mode", "mobile");
		},
	});
	assert.equal(sandbox.__RDSH_MOBILE_UX__, undefined, "the contradictory attribute booted the mobile half");
	assert.equal(sandbox.document.documentElement.getAttribute("data-rdsh-device-mode"), "mobile", "the client rewrote a marker it does not own");
	assert.deepEqual(disposeAll(), []);
});

test("PC 390px stays undecorated and a 1024px tablet stays mobile", () => {
	const pc = bootClient({ mode: "desktop", narrow: true });
	assert.equal(pc.sandbox.__RDSH_MOBILE_UX__, undefined, "a narrow PC booted the mobile half");
	assert.equal(pc.sandbox.document.documentElement.hasAttribute("data-rdsh-anim"), false, "a narrow PC got the mobile animation");
	assert.equal(pc.sandbox.document.documentElement.hasAttribute("data-rdsh-drawer"), false, "a narrow PC got the drawer state");

	const tablet = bootClient({ mode: "mobile", narrow: false });
	assert.equal(tablet.sandbox.__RDSH_MOBILE_UX__.phone(), true, "a 1024px tablet lost mobile mode");
	assert.equal(tablet.sandbox.document.documentElement.getAttribute("data-rdsh-anim"), "outline", "a tablet did not get the mobile surface");
	assert.equal(tablet.sandbox.__RDSH_MOBILE_UX__.state.narrow, false, "the tablet geometry readout is wrong");
});

test("the store reports the mode separately from the layout", () => {
	const mobileWide = bootClient({ mode: "mobile", narrow: false });
	const state = mobileWide.sandbox.__RDSH_MOBILE_UX__.state;
	assert.equal(state.mode, "mobile", "the bootstrapped mode is in the store");
	assert.equal(state.narrow, false, "the layout still measures width");
	assert.equal(state.phone, true, "a wide mobile device keeps the mobile UI");
	const desktopNarrow = bootClient({ mode: "desktop", narrow: true });
	assert.equal(desktopNarrow.sandbox.__RDSH_MOBILE_UX__, undefined, "a narrow desktop built a mobile store");
});

test("the saved Enter-sends choice is read when the page loads", () => {
	// The store is built while the module body runs, so a key constant declared
	// below it is still uninitialised then. The read is wrapped in try/catch,
	// which turned that into "off" on every reload without a visible error.
	const off = bootClient({ mode: "mobile" });
	assert.equal(off.sandbox.__RDSH_MOBILE_UX__.state.enterToSend, false, "Enter inserts a newline by default");
	const on = bootClient({ mode: "mobile", storage: { "rdsh-mobile-ux:enter-to-send": "1" } });
	assert.equal(on.sandbox.__RDSH_MOBILE_UX__.state.enterToSend, true, "the saved choice survives a reload");
});

test("an iPhone desktop-site UA still advertises the iOS install path", () => {
	// Safari has no beforeinstallprompt, so the welcome card is the only A2HS
	// guidance. A desktop-site iPhone keeps a Macintosh UA but reports
	// platform "iPhone"; isIos() and the card must still see it.
	const { sandbox, disposeAll } = bootClient({
		mode: "mobile",
		narrow: false,
		navigator: {
			userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15",
			platform: "iPhone",
			maxTouchPoints: 0,
			onLine: true,
			serviceWorker: stub(),
		},
		configureDocument(doc) {
			const header = element();
			header.className = "_headerBlank";
			doc.querySelector = (selector) => (selector === "header[data-window-drag]" ? header : null);
		},
	});
	const pwa = sandbox.__RDSH_PWA__;
	assert.equal(pwa.state.ios, true, "the desktop-site iPhone lost the iOS hint");
	assert.equal(pwa.state.mode, "mobile", "the device mode is wrong");
	assert.equal(pwa.showInstallPrompt(), true, "the welcome-screen A2HS card is not offered");
	assert.deepEqual(disposeAll(), []);
});

test("isIos trusts Apple platform strings but not Windows or Android", () => {
	const iosOf = (fields) => {
		const booted = bootClient({
			mode: "mobile",
			narrow: false,
			navigator: { onLine: true, serviceWorker: stub(), ...fields },
		});
		const value = booted.sandbox.__RDSH_PWA__.state.ios;
		booted.disposeAll();
		return value;
	};
	const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Version/18.0 Safari/605.1.15";
	assert.equal(iosOf({ userAgent: mac, platform: "iPad", maxTouchPoints: 0 }), true, "a desktop-site iPad lost the iOS hint");
	assert.equal(iosOf({ userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120 Safari/537.36", platform: "Win32", maxTouchPoints: 10 }), false, "a Windows touch PC was treated as iOS");
	assert.equal(iosOf({ userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) Chrome/120 Mobile Safari/537.36", platform: "Linux armv8l", maxTouchPoints: 5 }), false, "an Android phone was treated as iOS");
});

test("the device-turn opt-in is read on mobile and never boots a desktop", () => {
	const off = bootClient({ mode: "mobile" });
	assert.equal(off.sandbox.__RDSH_MOBILE_UX__.state.notifyDeviceTurns, false, "phone-only stays the default");
	const on = bootClient({ mode: "mobile", storage: { "rdsh-mobile-ux:notify-device-turns": "1" } });
	assert.equal(on.sandbox.__RDSH_MOBILE_UX__.state.notifyDeviceTurns, true, "the saved opt-in is read");
	// Saved opt-ins must not resurrect the plugin on a PC.
	const desktop = bootClient({
		mode: "desktop",
		storage: { "rdsh-mobile-ux:notify-device-turns": "1", "dsh-mobile-maxxing:device-theme": "dark" },
	});
	assert.equal(desktop.sandbox.__RDSH_MOBILE_UX__, undefined, "a desktop with saved opt-ins booted the mobile half");
});

test("the legacy hide list applies at phone width even with a fine pointer", () => {
	const frames = [];
	const button = element();
	button.setAttribute("aria-label", "More actions");
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		frames,
		configureDocument(doc) {
			doc.querySelectorAll = (selector) => (selector === "button[aria-label], [role='menuitem']" ? [button] : []);
			doc.querySelector = () => null;
		},
	});
	for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
	assert.equal(button.hasAttribute("data-rdsh-hidden"), true, "a mobile phone hides the stock control");
	booted.disposeAll();

	const wideButton = element();
	wideButton.setAttribute("aria-label", "More actions");
	const wide = bootClient({
		mode: "desktop",
		narrow: false,
		frames: [],
		configureDocument(doc) {
			doc.querySelectorAll = (selector) => (selector === "button[aria-label], [role='menuitem']" ? [wideButton] : []);
			doc.querySelector = () => null;
		},
	});
	assert.equal(wideButton.hasAttribute("data-rdsh-hidden"), false, "a desktop hides nothing");
	wide.disposeAll();
});

test("the effect disposer tears down without a ReferenceError or a stale listener", () => {
	const adds = [];
	const removes = [];
	const booted = bootClient({
		mode: "mobile",
		configureDocument(doc) {
			const add = doc.addEventListener;
			const remove = doc.removeEventListener;
			doc.addEventListener = (type, handler, options) => {
				adds.push(handler);
				add.call(doc, type, handler, options);
			};
			doc.removeEventListener = (type, handler, options) => {
				removes.push(handler);
				remove.call(doc, type, handler, options);
			};
		},
	});
	assert.ok(booted.sandbox.__RDSH_MOBILE_UX__ !== undefined, "the mobile half booted");
	assert.ok(booted.disposers.length > 0, "the boot registered effects");
	const errors = booted.disposeAll();
	assert.deepEqual(errors.map((error) => String(error)), [], "teardown threw (displayMedia was the old ReferenceError)");
	assert.equal(booted.sandbox.__RDSH_MOBILE_UX__, undefined, "the diagnostics object was not removed");
	const stale = adds.filter((handler) => !removes.includes(handler));
	assert.deepEqual(stale, [], "a document listener outlived its effect");
});

test("a height-only resize keeps an in-flight swipe; a width change drops it", () => {
	const windowHandlers = [];
	const documentHandlers = [];
	const open = element();
	let presses = 0;
	open.click = () => {
		presses += 1;
	};
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		windowAdd: (type, handler) => windowHandlers.push([type, handler]),
		windowRemove() {},
		configureDocument(doc) {
			doc.addEventListener = (type, handler) => documentHandlers.push([type, handler]);
			doc.querySelector = (selector) => (selector.includes("Open sidebar") ? open : null);
		},
	});
	const handler = (type, name) => [...documentHandlers].reverse()
		.find(([registered, fn]) => registered === type && fn.name === name)?.[1];
	const start = handler("touchstart", "onEdgeSwipeStart");
	const move = handler("touchmove", "onEdgeSwipeMove");
	const end = handler("touchend", "onEdgeSwipeEnd");
	assert.equal(typeof start, "function", "the edge swipe start is registered");
	assert.equal(typeof move, "function", "the edge swipe move is registered");
	assert.equal(typeof end, "function", "the edge swipe end is registered");
	const onResize = [...windowHandlers].filter(([type]) => type === "resize").at(-1)?.[1];
	assert.equal(typeof onResize, "function", "the boot resize handler is registered");

	const touch = (x) => ({ cancelable: true, preventDefault() {}, touches: [{ clientX: x, clientY: 200 }] });
	start({ touches: [{ clientX: 10, clientY: 200 }], target: {} });
	move(touch(40));
	// A keyboard / URL-bar resize changes height only: the gesture must live.
	onResize();
	move(touch(90));
	assert.equal(presses, 1, "a height-only resize cancelled the swipe");

	start({ touches: [{ clientX: 10, clientY: 200 }], target: {} });
	move(touch(40));
	// A real width change invalidates the stored start point.
	booted.sandbox.innerWidth = 320;
	booted.sandbox.window.innerWidth = 320;
	onResize();
	move(touch(90));
	assert.equal(presses, 1, "a width change did not reset the gesture");

	start({ touches: [{ clientX: 10, clientY: 200 }], target: {} });
	move(touch(40));
	end();
	move(touch(90));
	assert.equal(presses, 1, "touchend did not clear the gesture");
	booted.disposeAll();
});

test("the injected language wins over the shell document language", () => {
	const shellLang = (value) => (doc) => {
		doc.documentElement.lang = value;
	};
	// The host default (ja) must restore the reference UI even when the shell
	// document stays lang="en"; an explicit en must equally win over a ja
	// shell. The document language is only the fallback.
	assert.equal(bootClient({ mode: "mobile", lang: "ja", configureDocument: shellLang("en") }).sandbox.__RDSH_MOBILE_UX__.lang, "ja");
	assert.equal(bootClient({ mode: "mobile", lang: "en", configureDocument: shellLang("ja") }).sandbox.__RDSH_MOBILE_UX__.lang, "en");
	assert.equal(bootClient({ mode: "mobile", lang: "ja-JP", configureDocument: shellLang("en") }).sandbox.__RDSH_MOBILE_UX__.lang, "ja");
	assert.equal(bootClient({ mode: "mobile", configureDocument: shellLang("ja") }).sandbox.__RDSH_MOBILE_UX__.lang, "ja");
	assert.equal(bootClient({ mode: "mobile", configureDocument: shellLang("en") }).sandbox.__RDSH_MOBILE_UX__.lang, "en");
	assert.equal(bootClient({ mode: "mobile" }).sandbox.__RDSH_MOBILE_UX__.lang, "en", "no signals falls back to English");
});

test("one failing part does not stop the other client halves", () => {
	const errors = [];
	const original = console.error;
	console.error = (...args) => errors.push(args);
	try {
		const booted = bootClient({ mode: "mobile", failFirstSlot: true });
		assert.ok(booted.sandbox.__RDSH_MOBILE_UX__ !== undefined, "mobile UX died with the PWA part");
		assert.ok(
			errors.some(([message]) => String(message).includes("pwa client half failed to apply")),
			"the failure was not logged with the part name",
		);
		booted.disposeAll();
	} finally {
		console.error = original;
	}
});

test("the detail popover dismisses inside/outside/Escape and dispose leaves nothing", () => {
	const timers = [];
	const documentHandlers = [];
	const removedHandlers = [];
	const pop = element();
	const inside = { id: "inside" };
	const outside = { id: "outside" };
	let currentPop = null;
	let popConnected = false;
	pop.isConnected = false;
	pop.contains = (target) => target === inside || target === pop;
	pop.remove = () => {
		popConnected = false;
		pop.isConnected = false;
		currentPop = null;
	};
	const todo = element();
	todo.setAttribute("data-rdsh-todo-text", "A long todo item");
	todo.setAttribute("data-rdsh-todo-status", "in_progress");
	const booted = bootClient({
		narrow: true,
		schedule: (callback) => timers.push(callback),
		configureDocument(doc) {
			let armed = false;
			let created = 0;
			doc.createElement = () => {
				if (armed && created === 0) {
					created += 1;
					currentPop = pop;
					popConnected = true;
					pop.isConnected = true;
					return pop;
				}
				return element();
			};
			doc.querySelector = (selector) => (selector === ".rdsh-mux-detail" ? currentPop : null);
			doc.addEventListener = (type, handler) => {
				if (type === "click" && handler.name === "onClickCapture") armed = true;
				documentHandlers.push([type, handler]);
			};
			doc.removeEventListener = (type, handler) => removedHandlers.push([type, handler]);
			doc.__resetPopover = () => {
				created = 0;
			};
		},
	});
	timers.length = 0;
	const click = [...documentHandlers].find(([type, handler]) => type === "click" && handler.name === "onClickCapture")?.[1];
	assert.equal(typeof click, "function", "the click handler is registered");
	const target = {
		closest: (selector) => (selector === "[data-rdsh-todo-item]" ? todo : null),
	};
	const open = () => {
		booted.sandbox.document.__resetPopover();
		click({ target, preventDefault() {}, stopImmediatePropagation() {} });
		assert.equal(currentPop, pop, "the popover was not created");
		assert.equal(popConnected, true);
		for (const callback of timers.splice(0)) callback();
		const pointer = [...documentHandlers].filter(([type, handler]) => type === "pointerdown" && handler.name === "dismiss").at(-1)?.[1];
		const key = [...documentHandlers].filter(([type, handler]) => type === "keydown" && handler.name === "dismissKey").at(-1)?.[1];
		assert.equal(typeof pointer, "function", "the pointer dismiss listener was not attached");
		assert.equal(typeof key, "function", "the Escape listener was not attached");
		return { pointer, key };
	};

	let { pointer, key } = open();
	// A tap inside the popover must not retire the outside dismissal.
	pointer({ target: inside });
	assert.equal(popConnected, true, "an inside tap closed the popover");
	assert.equal(removedHandlers.some(([, handler]) => handler === pointer), false, "the pointer listener was removed on an inside tap");
	pointer({ target: outside });
	assert.equal(popConnected, false, "an outside tap did not close the popover");
	assert.equal(removedHandlers.some(([, handler]) => handler === pointer), true, "the outside dismissal leaked its listener");
	assert.equal(removedHandlers.some(([, handler]) => handler === key), true, "the Escape listener leaked after an outside tap");

	({ pointer, key } = open());
	key({ key: "Escape" });
	assert.equal(popConnected, false, "Escape did not close the popover");
	assert.equal(removedHandlers.some(([, handler]) => handler === pointer), true, "Escape leaked the pointer listener");
	assert.equal(removedHandlers.some(([, handler]) => handler === key), true, "Escape leaked its own listener");

	({ pointer, key } = open());
	booted.disposeAll();
	assert.equal(popConnected, false, "dispose left the popover in the DOM");
	assert.equal(removedHandlers.some(([, handler]) => handler === pointer), true, "dispose leaked the pointer listener");
	assert.equal(removedHandlers.some(([, handler]) => handler === key), true, "dispose leaked the Escape listener");
});

test("the session colour frame is a phone-only hook", () => {
	// #44: the frame is phone layout now. A wide window must leave the row
	// exactly as upstream rendered it; 390px paints the chosen colour.
	const frameRow = (narrow) => {
		const frames = [];
		const row = element();
		row.setAttribute("data-row-key", "session:s1");
		let frameColor = null;
		row.style = {
			setProperty(name, value) { if (name === "--rdsh-session-frame") frameColor = value; },
			removeProperty(name) { if (name === "--rdsh-session-frame") frameColor = null; },
		};
		const booted = bootClient({
			narrow,
			frames,
			storage: { "rdsh-mobile-ux:session-frames": JSON.stringify({ s1: "#ff6b6b" }) },
			configureDocument(doc) {
				doc.querySelectorAll = (selector) => (selector === '[data-row-key^="session:"]' ? [row] : []);
				doc.querySelector = () => null;
			},
		});
		for (let index = 0; index < 20 && frames.length > 0; index += 1) frames.shift()();
		return { row, frameColor, booted };
	};

	const wide = frameRow(false);
	assert.equal(wide.row.hasAttribute("data-rdsh-session"), false, "a desktop row was decorated");
	assert.equal(wide.row.hasAttribute("data-rdsh-session-frame"), false, "a desktop row got the phone frame hook");
	assert.equal(wide.frameColor, null, "a desktop row got the frame colour");
	wide.booted.disposeAll();

	const phone = frameRow(true);
	assert.equal(phone.row.hasAttribute("data-rdsh-session"), true, "the phone row was not decorated");
	assert.equal(phone.row.hasAttribute("data-rdsh-session-frame"), true, "the phone colour frame hook was not generated");
	assert.equal(phone.frameColor, "#ff6b6b", "the phone frame colour was not written");
	phone.booted.disposeAll();
});

test("a rightward swipe closes an open right panel from the left edge too", () => {
	const documentHandlers = [];
	const collapse = element();
	const panel = element();
	let closes = 0;
	collapse.getBoundingClientRect = () => ({ width: 24, height: 24, top: 0, left: 0, right: 24, bottom: 24 });
	collapse.closest = (selector) => (selector === "[data-sidebar-right-panel]" ? panel : null);
	collapse.click = () => {
		closes += 1;
	};
	const booted = bootClient({
		narrow: true,
		configureDocument(doc) {
			doc.documentElement.setAttribute("data-rdsh-rightpanel-open", "");
			doc.addEventListener = (type, handler) => documentHandlers.push([type, handler]);
			doc.querySelector = () => null;
			doc.querySelectorAll = (selector) => (selector === '[aria-label="Collapse right sidebar"]' ? [collapse] : []);
		},
	});
	const handler = (type, name) => [...documentHandlers].reverse()
		.find(([registered, fn]) => registered === type && fn.name === name)?.[1];
	const start = handler("touchstart", "onEdgeSwipeStart");
	const move = handler("touchmove", "onEdgeSwipeMove");
	const touch = (x) => ({ cancelable: true, preventDefault() {}, touches: [{ clientX: x, clientY: 200 }] });
	for (const from of [10, 200]) {
		start({ touches: [{ clientX: from, clientY: 200 }], target: {} });
		move(touch(from + 90));
	}
	assert.equal(closes, 2, "the panel did not close from one of the start positions");
	booted.disposeAll();
});

test("the four-row drawer survives decoration when the upstream nav exists", () => {
	// The reference drawer's four rows are New Session (stock), Plugins and
	// Automation tasks (stock `sidebar.panellist` rows), and the Settings row
	// this plugin injects into that nav. If upstream renders no nav at all
	// (panels list empty), there is nowhere to inject. This pins the part this
	// package owns: decoration keeps the three stock rows visible and adds the
	// fourth after Automation tasks, even when no account menu is signed in.
	const frames = [];
	const nav = element();
	const newSession = element();
	const plugins = element();
	const auto = element();
	newSession.setAttribute("aria-label", "New Session");
	plugins.setAttribute("aria-label", "Plugins");
	auto.setAttribute("aria-label", "Automation tasks");
	let afterNode = null;
	auto.after = (node) => {
		afterNode = node;
		node.parentElement = nav;
		auto.nextElementSibling = node;
		nav.lastElementChild = node;
	};
	nav.contains = (node) => node.parentElement === nav;
	nav.querySelector = (selector) => {
		if (selector === 'button[aria-label="Automation tasks"]') return auto;
		if (selector === 'button[aria-label="Plugins"]') return plugins;
		if (selector === "[data-rdsh-settings-row]") return null;
		return null;
	};
	const created = [];
	const booted = bootClient({
		narrow: true,
		frames,
		configureDocument(doc) {
			const create = doc.createElement;
			doc.createElement = (tag) => {
				const node = create(tag);
				created.push(node);
				return node;
			};
			doc.querySelector = (selector) => (selector === "nav.hHd-Xa_panelList" ? nav : null);
			doc.querySelectorAll = (selector) => {
				if (selector === "[data-rdsh-settings-row], .rdsh-mux-settings-row") {
					return afterNode === null ? [] : [afterNode];
				}
				if (selector === "button[aria-label], [role='menuitem']") {
					return [newSession, plugins, auto, ...(afterNode === null ? [] : [afterNode])];
				}
				if (selector === "button") return [newSession, plugins, auto];
				return [];
			};
		},
	});
	for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
	const row = afterNode ?? created.find((node) => node.hasAttribute?.("data-rdsh-settings-row"));
	assert.ok(row, "the Settings row was not inserted");
	for (const control of [newSession, plugins, auto]) {
		assert.equal(control.hasAttribute("data-rdsh-hidden"), false, "a stock drawer row was hidden");
	}
	assert.equal(row.hasAttribute("data-rdsh-settings-row"), true);
	assert.equal(afterNode, row, "the row was appended instead of following Automation tasks");
	assert.equal(auto.nextElementSibling, row, "the Settings row is not the fourth visible row");
	assert.match(row.getAttribute("aria-label"), /^(?:Settings|mux\.settingsRow)$/);
	assert.deepEqual(
		[newSession, plugins, auto, row].map((control) => control.hasAttribute("data-rdsh-hidden")),
		[false, false, false, false],
		"one of the four drawer rows is hidden",
	);
	booted.disposeAll();
});

test("a localized Settings row is never mistaken for the account menu", () => {
	// Regression: COPY.ja used to render the injected row with aria-label
	// "設定", which is also one of PROBES.accountMenu. On the second decorate
	// pass `querySelector` returned that row, its parent nav was tagged with
	// `data-rdsh-more-row`, and the stylesheet hid the whole panel list (the
	// three rows collapsed to 0x0, as the QA screenshots show). The account
	// lookup must exclude the row this function just created, and must clear a
	// stale nav tag from an earlier pass.
	const frames = [];
	const nav = element();
	const footer = element();
	footer.className = "yHnPSG_anchor";
	const account = element();
	const newSession = element();
	const plugins = element();
	const auto = element();
	const createdButtons = [];
	newSession.setAttribute("aria-label", "New Session");
	plugins.setAttribute("aria-label", "Plugins");
	auto.setAttribute("aria-label", "Automation tasks");
	account.setAttribute("aria-label", "Account menu");
	account.closest = (selector) => (selector.includes("yHnPSG_anchor") ? footer : null);
	const settingsRow = () => createdButtons.find((button) => button.hasAttribute("data-rdsh-settings-row")) ?? null;
	const allButtons = () => [newSession, plugins, auto, ...(settingsRow() === null ? [] : [settingsRow()]), account];
	auto.after = (node) => {
		node.parentElement = nav;
		auto.nextElementSibling = node;
		nav.lastElementChild = node;
	};
	nav.contains = (node) => node.parentElement === nav;
	nav.querySelector = (selector) => {
		if (selector === 'button[aria-label="Automation tasks"]') return auto;
		if (selector === 'button[aria-label="Plugins"]') return plugins;
		if (selector === "[data-rdsh-settings-row]") return settingsRow();
		return null;
	};
	const booted = bootClient({
		narrow: true,
		frames,
		lang: "ja",
		copy: { ...COPY, ja: { ...COPY.ja, "mux.settingsRow": "設定" } },
		configureDocument(doc) {
			const create = doc.createElement;
			doc.createElement = (tag) => {
				const node = create(tag);
				if (tag === "button") createdButtons.push(node);
				return node;
			};
			doc.querySelector = (selector) => {
				if (selector === "nav.hHd-Xa_panelList") return nav;
				if (selector.includes('aria-label="Account menu"')) return settingsRow() ?? account;
				return null;
			};
			doc.querySelectorAll = (selector) => {
				if (selector === "[data-rdsh-settings-row], .rdsh-mux-settings-row") {
					return settingsRow() === null ? [] : [settingsRow()];
				}
				if (selector.includes('aria-label="Account menu"')) {
					return settingsRow() === null ? [account] : [settingsRow(), account];
				}
				if (selector === "button") return allButtons();
				if (selector === "button[aria-label], [role='menuitem']") return allButtons();
				if (selector === "[data-rdsh-more-row]") {
					return [nav, footer, ...(settingsRow() === null ? [] : [settingsRow()])]
						.filter((element) => element.hasAttribute("data-rdsh-more-row"));
				}
				return [];
			};
		},
	});
	for (let pass = 0; pass < 3; pass += 1) {
		for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
		booted.sandbox.__RDSH_MOBILE_UX__.decorate();
	}
	const row = settingsRow();
	assert.ok(row, "the Settings row was not created");
	assert.equal(row.getAttribute("aria-label"), "設定");
	assert.equal(nav.hasAttribute("data-rdsh-more-row"), false, "the nav was tagged as the account row and hidden");
	assert.equal(footer.hasAttribute("data-rdsh-more-row"), true, "the real account footer lost its hidden-row tag");
	assert.equal(auto.nextElementSibling, row, "the Settings row did not stay after Automation tasks");
	for (const control of [newSession, plugins, auto, row]) {
		assert.equal(control.hasAttribute("data-rdsh-hidden"), false, "one of the four rows is hidden");
	}
	booted.disposeAll();
});

test("re-applying the Settings row decoration never duplicates the row (#87)", () => {
	// The legacy teardown removed only `data-rdsh-settings-row` from the
	// button. The <button> stayed in the nav, the next pass found no tagged
	// row and appended another one, so every plugin re-apply (one per iOS
	// page restore) left one more Settings row.
	const nav = element();
	const newSession = element();
	const plugins = element();
	const auto = element();
	newSession.setAttribute("aria-label", "New Session");
	plugins.setAttribute("aria-label", "Plugins");
	auto.setAttribute("aria-label", "Automation tasks");
	const children = [newSession, plugins, auto];
	const frames = [];
	nav.lastElementChild = auto;
	nav.contains = (node) => children.includes(node);
	nav.append = (node) => {
		if (!children.includes(node)) children.push(node);
		node.parentElement = nav;
		nav.lastElementChild = node;
	};
	nav.querySelector = (selector) => {
		if (selector === 'button[aria-label="Automation tasks"]') return auto;
		if (selector === 'button[aria-label="Plugins"]') return plugins;
		return null;
	};
	auto.after = (node) => {
		if (!children.includes(node)) {
			const at = children.indexOf(auto);
			children.splice(at < 0 ? children.length : at + 1, 0, node);
		}
		node.parentElement = nav;
		auto.nextElementSibling = node;
	};
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		frames,
		configureDocument(doc) {
			const create = doc.createElement;
			doc.createElement = (tag) => {
				const node = create(tag);
				if (tag === "button") {
					node.remove = () => {
						const at = children.indexOf(node);
						if (at >= 0) children.splice(at, 1);
						node.parentElement = null;
					};
				}
				return node;
			};
			doc.querySelector = (selector) => (selector === "nav.hHd-Xa_panelList" ? nav : null);
			doc.querySelectorAll = (selector) => {
				if (selector === "[data-rdsh-settings-row], .rdsh-mux-settings-row") {
					return children.filter((node) => node.hasAttribute("data-rdsh-settings-row")
						|| String(node.className).includes("rdsh-mux-settings-row"));
				}
				if (selector === "[data-rdsh-more-row]") return children.filter((node) => node.hasAttribute("data-rdsh-more-row"));
				if (selector === "button") return children;
				if (selector === "button[aria-label], [role='menuitem']") return children;
				return [];
			};
		},
	});
	// Three stock rows are in the nav; everything else appended to it is an
	// injected Settings row, tagged or not.
	const rowCount = () => children.length - 3;
	const settle = () => {
		for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
	};
	settle();
	assert.equal(rowCount(), 1, "the first apply did not inject exactly one row");

	// A legacy teardown: clearOwnedAttribute was applied to the row attribute.
	// The node itself survived, so the next pass must adopt it, not duplicate.
	for (const node of children) node.removeAttribute("data-rdsh-settings-row");
	booted.sandbox.__RDSH_MOBILE_UX__.decorateNow();
	assert.equal(rowCount(), 1, "an attribute-only teardown left a duplicate row");

	// A full dispose + apply cycle, twice.
	for (let cycle = 0; cycle < 2; cycle += 1) {
		booted.disposeAll();
		assert.equal(rowCount(), 0, `dispose ${cycle + 1} left the injected row behind`);
		booted.plugin.apply(booted.ctx);
		settle();
		assert.equal(rowCount(), 1, `re-apply ${cycle + 1} duplicated the Settings row`);
	}

	// Guard: the row is a node, not an attribute cleanup hook.
	const hooks = CLIENT.match(/const PHONE_HOOKS = \[([\s\S]*?)\n    \];/);
	assert.ok(hooks, "PHONE_HOOKS exists");
	assert.doesNotMatch(hooks[1], /"data-rdsh-settings-row"/, "the Settings row tag is back in the attribute cleanup list");
});

test("tapping Plugins or Automation tasks closes the phone drawer, never a desktop sidebar", () => {
	// Both rows open a full-screen route. On a phone the drawer must leave the
	// screen; on a desktop-width window the stock sidebar is not ours to close.
	assert.equal(drawerClosedAfterTapping("Plugins"), true, "Plugins left the drawer open");
	assert.equal(drawerClosedAfterTapping("Automation tasks"), true, "Automation tasks left the drawer open");
	assert.equal(drawerClosedAfterTapping("Plugins", { narrow: false, mode: "desktop" }), false, "a desktop sidebar was closed");
	assert.equal(drawerClosedAfterTapping("Automation tasks", { narrow: false, mode: "desktop" }), false, "a desktop sidebar was closed");
	// Existing rows keep their behaviour.
	assert.equal(drawerClosedAfterTapping("New session"), true);
	assert.equal(drawerClosedAfterTapping("Settings"), false);
});

test("a left-edge swipe opens the drawer even when it starts on a route row", () => {
	const windowHandlers = [];
	const documentHandlers = [];
	const open = element();
	let presses = 0;
	open.click = () => {
		presses += 1;
	};
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		windowAdd: (type, handler) => windowHandlers.push([type, handler]),
		windowRemove() {},
		configureDocument(doc) {
			doc.addEventListener = (type, handler) => documentHandlers.push([type, handler]);
			doc.querySelector = (selector) => (selector.includes("Open sidebar") ? open : null);
		},
	});
	const handler = (type, name) => [...documentHandlers].reverse()
		.find(([registered, fn]) => registered === type && fn.name === name)?.[1];
	const start = handler("touchstart", "onEdgeSwipeStart");
	const move = handler("touchmove", "onEdgeSwipeMove");
	assert.equal(typeof start, "function");
	assert.equal(typeof move, "function");
	const touch = (x) => ({ cancelable: true, preventDefault() {}, touches: [{ clientX: x, clientY: 420 }] });
	const RouteRow = booted.sandbox.Element;
	const row = new RouteRow();
	row.closest = (selector) => (selector.includes("button") ? {} : null);

	// x=8 is inside the route's full-width row. A rightward drag must still
	// become the drawer gesture rather than being rejected by the button guard.
	start({ touches: [{ clientX: 8, clientY: 420 }], target: row });
	move(touch(120));
	assert.equal(presses, 1, "the route row swallowed the left-edge swipe");

	// A non-edge start over the same row keeps the old button rule.
	start({ touches: [{ clientX: 200, clientY: 420 }], target: row });
	move(touch(320));
	assert.equal(presses, 1, "a non-edge button swipe opened the drawer");
	booted.disposeAll();
});

test("closeDrawer clears a stale open attribute when the route has no frame", () => {
	const booted = bootClient({
		narrow: true,
		configureDocument(doc) {
			doc.getElementById = () => null;
			doc.querySelector = () => null;
		},
	});
	booted.sandbox.document.documentElement.setAttribute("data-rdsh-drawer", "open");
	booted.sandbox.__RDSH_MOBILE_UX__.closeDrawer();
	assert.equal(booted.sandbox.document.documentElement.getAttribute("data-rdsh-drawer"), "closed");
	assert.equal(booted.sandbox.__RDSH_MOBILE_UX__.state.drawerOpen, false);
	booted.disposeAll();
});

test("a route heading is tagged for the FAB inset only on a phone route", () => {
	const frames = [];
	const center = element();
	const wrapper = element();
	const heading = element();
	heading.parentElement = wrapper;
	heading.closest = () => null;
	heading.getBoundingClientRect = () => ({ x: 24, y: 30, top: 30, left: 24, width: 153, height: 28, right: 177, bottom: 58 });
	center.querySelectorAll = (selector) => (selector === "h1" ? [heading] : []);
	const booted = bootClient({
		narrow: true,
		frames,
		configureDocument(doc) {
			doc.querySelector = (selector) => {
				if (selector === "[data-rdsh-center-col]") return center;
				if (selector === "[data-rdsh-conversation]") return null;
				return null;
			};
			doc.querySelectorAll = () => [];
		},
	});
	for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
	assert.equal(wrapper.hasAttribute("data-rdsh-route-heading"), true, "the route heading was not tagged");
	booted.disposeAll();

	// The chat surface owns its own H1 (welcome card); it must not be treated
	// as a full-screen route heading.
	const chatFrames = [];
	const chatConversation = element();
	chatConversation.getBoundingClientRect = () => ({ x: 0, y: 0, top: 0, left: 0, width: 390, height: 844, right: 390, bottom: 844 });
	const chatHeading = element();
	const chatWrapper = element();
	chatHeading.parentElement = chatWrapper;
	chatHeading.closest = () => null;
	chatHeading.getBoundingClientRect = () => ({ x: 24, y: 300, top: 300, left: 24, width: 200, height: 28, right: 224, bottom: 328 });
	center.querySelectorAll = (selector) => (selector === "h1" ? [chatHeading] : []);
	const chat = bootClient({
		narrow: true,
		frames: chatFrames,
		configureDocument(doc) {
			doc.querySelector = (selector) => {
				if (selector === "[data-rdsh-center-col]") return center;
				if (selector === "[data-rdsh-conversation]") return chatConversation;
				return null;
			};
			doc.querySelectorAll = () => [];
		},
	});
	for (let index = 0; index < 10 && chatFrames.length > 0; index += 1) chatFrames.shift()();
	assert.equal(chatWrapper.hasAttribute("data-rdsh-route-heading"), false, "a chat H1 was tagged as a route heading");
	chat.disposeAll();

	// Desktop is untouched: it builds nothing, so a marker left by the earlier
	// boot in this process has to be cleared by the test, not by the plugin.
	wrapper.removeAttribute("data-rdsh-route-heading");
	const wideFrames = [];
	const wide = bootClient({
		narrow: false,
		frames: wideFrames,
		configureDocument(doc) {
			doc.querySelector = (selector) => {
				if (selector === "[data-rdsh-center-col]") return center;
				if (selector === "[data-rdsh-conversation]") return null;
				return null;
			};
			doc.querySelectorAll = (selector) => (selector === "[data-rdsh-route-heading]" ? [wrapper] : []);
		},
	});
	for (let index = 0; index < 10 && wideFrames.length > 0; index += 1) wideFrames.shift()();
	assert.equal(wrapper.hasAttribute("data-rdsh-route-heading"), false, "a desktop route heading was tagged");
	wide.disposeAll();
});

/**
 * Boot a phone or a desktop against a full-screen route's detail.
 *
 * The stub records the nodes the client creates, so the back button is the
 * element whose class is `rdsh-mux-route-back` and its click runs the handler
 * the plugin registered (the plain stub swallows listeners).
 */
function detailBoot({ mode = "mobile", narrow = true, container = null, page = null } = {}) {
	const frames = [];
	const created = [];
	const booted = bootClient({
		mode,
		narrow,
		frames,
		configureDocument(doc) {
			doc.createElement = () => {
				const node = element();
				const listeners = new Map();
				node.addEventListener = (type, handler) => listeners.set(type, handler);
				node.click = () => listeners.get("click")?.();
				created.push(node);
				return node;
			};
			doc.querySelector = (selector) => (selector === '[data-testid="task-manager-page"]' ? page : null);
			doc.querySelectorAll = (selector) => {
				if (selector === "[data-plugin-detail], [data-plugin-item-detail]") return container === null ? [] : [container];
				if (selector === "[data-rdsh-route-detail]") {
					const marked = [container, page].filter((node) => node !== null && node.hasAttribute("data-rdsh-route-detail"));
					return marked;
				}
				return [];
			};
		},
	});
	for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
	const back = created.find((node) => node.className === "rdsh-mux-route-back") ?? null;
	return { booted, back };
}

/** A laid-out box, so the route predicates see the node as on screen. */
const laidOutRect = (x, y, width, height) => () => ({ x, y, top: y, left: x, width, height, right: x + width, bottom: y + height });

test("a plugin detail retires the drawer button and leaves its breadcrumb free", () => {
	const container = element();
	container.getBoundingClientRect = laidOutRect(24, 0, 342, 667);
	const { booted, back } = detailBoot({ container });
	assert.equal(container.getAttribute("data-rdsh-route-detail"), "detail", "the plugin detail was not marked");
	assert.equal(back?.hasAttribute("data-visible"), false, "a plugin detail got the task detail's back button");
	booted.disposeAll();
});

test("a task detail whose list is gone gets a back button that closes it", () => {
	const page = element();
	page.getBoundingClientRect = laidOutRect(0, 0, 390, 844);
	const listPane = element();
	// Upstream hides the list below 760px: a 0x0 box is the signal.
	listPane.getBoundingClientRect = laidOutRect(0, 0, 0, 0);
	const detailPane = element();
	detailPane.getBoundingClientRect = laidOutRect(0, 0, 390, 844);
	detailPane.parentElement = page;
	const close = element();
	close.setAttribute("aria-label", "Close details");
	close.getBoundingClientRect = laidOutRect(354, 8, 28, 28);
	close.parentElement = detailPane;
	let closes = 0;
	close.click = () => {
		closes += 1;
	};
	page.children = [listPane, detailPane];
	page.querySelectorAll = (selector) => (selector === "button[aria-label]" ? [close] : []);

	const { booted, back } = detailBoot({ page });
	assert.equal(page.getAttribute("data-rdsh-route-detail"), "back", "the task detail was not marked for the back button");
	assert.equal(back?.hasAttribute("data-visible"), true, "the task detail got no back button");
	back.click();
	assert.equal(closes, 1, "the back button did not press the detail's own close control");

	// The detail closes: the marker and the button go with it.
	page.querySelectorAll = () => [];
	booted.sandbox.__RDSH_MOBILE_UX__.decorateNow();
	assert.equal(page.hasAttribute("data-rdsh-route-detail"), false, "the marker outlived the detail");
	assert.equal(back.hasAttribute("data-visible"), false, "the back button outlived the detail");
	booted.disposeAll();
});

test("a task detail with the list still beside it keeps the stock layout", () => {
	const page = element();
	page.getBoundingClientRect = laidOutRect(0, 0, 1024, 844);
	const listPane = element();
	listPane.getBoundingClientRect = laidOutRect(0, 0, 542, 844);
	const detailPane = element();
	detailPane.getBoundingClientRect = laidOutRect(542, 0, 482, 844);
	detailPane.parentElement = page;
	const close = element();
	close.setAttribute("aria-label", "Close details");
	close.getBoundingClientRect = laidOutRect(988, 8, 28, 28);
	close.parentElement = detailPane;
	page.children = [listPane, detailPane];
	page.querySelectorAll = (selector) => (selector === "button[aria-label]" ? [close] : []);

	const { booted, back } = detailBoot({ page, narrow: false });
	assert.equal(page.hasAttribute("data-rdsh-route-detail"), false, "a two-pane task page was treated as a detail-only screen");
	assert.equal(back?.hasAttribute("data-visible"), false, "a two-pane task page got a back button");
	booted.disposeAll();
});

test("a desktop boot builds no route back control", () => {
	const container = element();
	container.getBoundingClientRect = laidOutRect(24, 0, 342, 667);
	const { booted, back } = detailBoot({ mode: "desktop", narrow: false, container });
	assert.equal(back, null, "a desktop boot created the route back button");
	assert.equal(container.hasAttribute("data-rdsh-route-detail"), false, "a desktop boot wrote the route detail marker");
	assert.equal(booted.sandbox.__RDSH_MOBILE_UX__, undefined, "a desktop boot built the mobile half");
});

test("boot records this page's push origin so a restart cannot double-fan-out", () => {
	const urls = [];
	const booted = bootClient({
		mode: "mobile",
		fetchImpl: (url) => {
			urls.push(String(url));
			return Promise.resolve(stub());
		},
	});
	assert.ok(
		urls.some((url) => url.endsWith("api/dsh-mobile-maxxing/push/config")),
		`boot did not call the push config route: ${JSON.stringify(urls)} ${JSON.stringify(booted.sandbox.__RDSH_MOBILE_UX__?.state?.bootError)}`,
	);
	booted.disposeAll();
});

test("mobile-send carries the page origin so the host can route the turn back", () => {
	const calls = [];
	const booted = bootClient({
		narrow: true,
		fetchImpl: (url, options) => {
			calls.push({ url: String(url), body: options?.body });
			return Promise.resolve(stub());
		},
	});
	booted.sandbox.location = { origin: "https://app.example:8446", href: "https://app.example:8446/" };
	booted.sandbox.window.location = booted.sandbox.location;
	booted.sandbox.__RDSH_MOBILE_UX__.markMobileSession("session-1");
	const call = calls.find((entry) => entry.url.endsWith("api/dsh-mobile-maxxing/push/mobile-send"));
	assert.ok(call, "mobile-send was not called");
	assert.deepEqual(JSON.parse(call.body), { sessionId: "session-1", origin: "https://app.example:8446" });
	booted.disposeAll();
});

/**
 * A module table for the notification path.
 *
 * `Toast` and `createRoot` record what the banner renders; `state.primitives`
 * can be switched to `"missing"` or `"no-toast"` after boot to model an older
 * shell without changing the module tables the rest of the bundle needs.
 */
function noticeRequire(state) {
	return (name) => {
		if (name === "react") {
			return {
				createElement: (type, props) => ({ type, props }),
				useState: (initial) => [typeof initial === "function" ? initial() : initial, () => {}],
				useEffect: () => {},
				useRef: () => ({ current: null }),
				useMemo: (factory) => factory(),
				useCallback: (factory) => factory,
				Fragment: "fragment",
			};
		}
		if (name === "@deepseek-ai/dsh-client-ui-primitives") {
			if (state.primitives === "missing") throw new Error("Cannot find module '@deepseek-ai/dsh-client-ui-primitives'");
			if (state.primitives === "no-toast") return {};
			return { Toast: function Toast() {} };
		}
		if (name === "react-dom/client") {
			return { createRoot: () => ({ render: (node) => state.renders.push(node) }) };
		}
		return stub();
	};
}

/**
 * Boot the client with a captured service-worker listener and a banner module
 * table, then offer `send()` to deliver one message the way the worker does.
 */
function bootWorkerMessages({ visible = true, services = {} } = {}) {
	const state = { primitives: "ok", renders: [], acks: [], appended: [], warnings: [] };
	const messages = [];
	const navigator = {
		onLine: true,
		userAgent: "test",
		serviceWorker: {
			addEventListener(type, handler) {
				if (type === "message") messages.push(handler);
			},
			removeEventListener() {},
			getRegistration: async () => undefined,
			controller: null,
		},
	};
	const booted = bootClient({
		mode: "mobile",
		navigator,
		services,
		requireImpl: noticeRequire(state),
		log: { ...console, warn: (...args) => state.warnings.push(args) },
		configureDocument(doc) {
			doc.visibilityState = visible ? "visible" : "hidden";
			doc.body.append = (...nodes) => state.appended.push(...nodes);
		},
	});
	// No audio in the sandbox: soundContext() would otherwise build an instance
	// of the empty AudioContext stub and playNoticeSound would throw.
	booted.sandbox.AudioContext = undefined;
	const send = (data) => {
		const event = { data, ports: [{ postMessage: (message) => state.acks.push(message) }] };
		for (const handler of messages) handler(event);
	};
	return { ...booted, state, send };
}

test("a notification hand-off from the current or old worker name renders one banner and acks", () => {
	for (const type of ["dsh-mobile-maxxing:notify", "rdsh-pwa:notify"]) {
		const booted = bootWorkerMessages();
		booted.send({ type, title: "Session A", body: "Turn finished", sessionId: "s1", kind: "turn-end" });
		assert.deepEqual(booted.state.acks, ["shown"], type + " was not acknowledged exactly once");
		assert.equal(booted.state.renders.length, 1, type + " did not render exactly one banner");
		assert.equal(booted.state.renders[0].props.text, "Session A — Turn finished");
		const host = booted.state.appended.find((node) => node.getAttribute?.("data-rdsh-notice-host") === "");
		assert.ok(host, "the banner host was not attached to the body");
		assert.deepEqual(booted.state.warnings, [], "a shown banner warned");
		booted.disposeAll();
	}
});

test("a hidden page takes no hand-off and logs the skip once", () => {
	for (const type of ["dsh-mobile-maxxing:notify", "rdsh-pwa:notify"]) {
		const booted = bootWorkerMessages({ visible: false });
		const message = { type, title: "Session A", body: "", sessionId: "", kind: "notice" };
		booted.send(message);
		booted.send(message);
		assert.deepEqual(booted.state.acks, [], type + " was acknowledged while hidden");
		assert.equal(booted.state.renders.length, 0, type + " rendered a banner while hidden");
		assert.equal(booted.state.warnings.length, 1, type + " was skipped silently or logged repeatedly");
		assert.match(String(booted.state.warnings[0][0]), /page is not visible/);
		booted.disposeAll();
	}
});

test("a banner that cannot render says why once and does not ack", () => {
	for (const primitives of ["missing", "no-toast"]) {
		const booted = bootWorkerMessages();
		booted.state.primitives = primitives;
		const message = { type: "rdsh-pwa:notify", title: "Session A", body: "", sessionId: "", kind: "notice" };
		booted.send(message);
		booted.send(message);
		assert.deepEqual(booted.state.acks, [], primitives + " was acknowledged without a banner");
		assert.equal(booted.state.renders.length, 0, primitives + " rendered a banner");
		assert.equal(booted.state.warnings.length, 1, primitives + " was not explained exactly once");
		assert.match(
			String(booted.state.warnings[0][0]),
			primitives === "missing" ? /primitives are unavailable/ : /no Toast primitive/,
		);
		booted.disposeAll();
	}
});

test("the current and both previous open-session names still open the session", () => {
	const opened = [];
	const booted = bootWorkerMessages({ services: { uiWorkspace: { openSession: (id) => opened.push(id) } } });
	booted.send({ type: "dsh-notify-push:open-session", sessionId: "push" });
	booted.send({ type: "rdsh-pwa:open-session", sessionId: "old" });
	booted.send({ type: "dsh-mobile-maxxing:open-session", sessionId: "new" });
	assert.deepEqual(opened, ["push", "old", "new"], "a previous worker's tap was ignored");
	assert.deepEqual(booted.state.acks, [], "a tap was acknowledged as a notification");
	assert.equal(booted.state.renders.length, 0, "a tap rendered a banner");
	booted.disposeAll();
});

test("the queue dock gets stable hooks for the compact/attached row UI", () => {
	const frames = [];
	const dock = element();
	const panel = element();
	const row = element();
	const preview = element();
	preview.textContent = "  A fixed queued message  ";
	dock.querySelector = (selector) => (selector === '[class*="_panel"]' ? panel : null);
	dock.querySelectorAll = (selector) => (selector === "li" ? [row] : []);
	row.querySelector = (selector) => (selector === '[class*="_preview"]' ? preview : null);
	const booted = bootClient({
		narrow: true,
		frames,
		configureDocument(doc) {
			doc.querySelector = (selector) => (selector === "[data-queue-dock]" ? dock : null);
			doc.querySelectorAll = () => [];
		},
	});
	for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
	assert.equal(dock.hasAttribute("data-rdsh-queue-dock"), true);
	assert.equal(panel.hasAttribute("data-rdsh-queue-panel"), true);
	assert.equal(row.hasAttribute("data-rdsh-queue-row"), true);
	assert.equal(preview.hasAttribute("data-rdsh-queue-preview"), true);
	assert.equal(preview.getAttribute("data-rdsh-queue-text"), "A fixed queued message");
	assert.equal(preview.getAttribute("tabindex"), "0");
	booted.disposeAll();
});

test("the queue bridge paints the queue ::before colour and tears down", () => {
	const QUEUE = "rgba(67, 69, 74, 0.45)";
	const COMPOSER = "rgb(255, 255, 255)";
	const style = () => ({
		setProperty(name, value) { this[name] = value; },
		removeProperty(name) {
			delete this[name];
			delete this[String(name).replace(/-([a-z])/g, (_match, letter) => letter.toUpperCase())];
		},
		getPropertyValue(name) { return this[name] ?? ""; },
	});
	const tracked = (tag) => {
		const node = element();
		node.tagName = tag.toUpperCase();
		node.children = [];
		node.append = (...items) => {
			for (const item of items) {
				item._parent = node;
				node.children.push(item);
			}
		};
		node.replaceChildren = (...items) => {
			node.children = [];
			node.append(...items);
		};
		node.remove = () => {
			if (node._parent === undefined) return;
			node._parent.children = node._parent.children.filter((child) => child !== node);
			node._parent = undefined;
		};
		return node;
	};
	const fixture = () => {
		const card = element();
		card.style = style();
		card.setAttribute("data-qa-composer", "keep");
		card.getBoundingClientRect = () => ({ x: 16, y: 700, top: 700, left: 16, right: 374, bottom: 796, width: 358, height: 96 });
		const editor = element();
		editor.closest = (selector) => (String(selector).includes("_card") ? card : null);
		const panel = tracked("div");
		panel.style = style();
		panel.getBoundingClientRect = () => ({ x: 16, y: 600, top: 600, left: 16, right: 374, bottom: 701, width: 358, height: 101 });
		const parent = element();
		parent.getBoundingClientRect = () => ({ x: 16, y: 500, top: 500, left: 16, right: 374, bottom: 600, width: 358, height: 100 });
		const dock = tracked("div");
		dock.style = style();
		dock.parentElement = parent;
		dock.getBoundingClientRect = () => ({ x: 16, y: 500, top: 500, left: 16, right: 374, bottom: 600, width: 358, height: 100 });
		dock.querySelector = (selector) => {
			const text = String(selector);
			if (text.includes("_panel")) return panel;
			if (text.includes("data-rdsh-queue-join")) return dock.children.find((child) => child.hasAttribute("data-rdsh-queue-join")) ?? null;
			return null;
		};
		dock.querySelectorAll = () => [];
		return { card, editor, panel, parent, dock };
	};
	const boot = (mode) => {
		const frames = [];
		const nodes = fixture();
		const booted = bootClient({
			mode,
			narrow: mode === "mobile",
			frames,
			computedStyle(node, pseudo) {
				if (node === nodes.panel && pseudo === "::before") return { backgroundColor: QUEUE };
				if (node === nodes.panel) return { backgroundColor: "rgba(0, 0, 0, 0)" };
				if (node === nodes.card) return { backgroundColor: COMPOSER, borderTopLeftRadius: "24px", borderTopRightRadius: "24px" };
				if (node === nodes.parent) return { rowGap: "6px" };
				return stub();
			},
			configureDocument(doc) {
				doc.querySelector = (selector) => {
					const text = String(selector);
					if (text.includes("data-composer-input")) return nodes.editor;
					if (text.includes("data-queue-dock")) return nodes.dock;
					return null;
				};
				doc.querySelectorAll = (selector) => {
					const text = String(selector);
					if (text === "[data-rdsh-queue-join]") return nodes.dock.children.filter((child) => child.hasAttribute("data-rdsh-queue-join"));
					if (text === "[data-rdsh-queue-dock]") return [nodes.dock];
					return [];
				};
				doc.createElementNS = (_namespace, tag) => tracked(tag);
			},
		});
		for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
		return { booted, nodes };
	};

	const mobile = boot("mobile");
	const bridge = mobile.nodes.dock.children.find((child) => child.hasAttribute("data-rdsh-queue-join"));
	assert.ok(bridge, "the mobile queue bridge was not created");
	assert.ok(bridge.children.length > 0, "the bridge has no corner paths");
	for (const path of bridge.children) assert.equal(path.getAttribute("fill"), QUEUE, "the bridge used the composer colour instead of the queue ::before colour");
	assert.equal(mobile.nodes.dock.style.marginBottom, "-7px", "the measured seam was not applied");
	assert.equal(mobile.nodes.card.getAttribute("data-qa-composer"), "keep", "the composer attribute changed");
	for (const property of ["background", "backgroundColor", "borderTopLeftRadius", "borderTopRightRadius", "clipPath"]) {
		assert.equal(mobile.nodes.card.style[property], undefined, `the bridge mutated the composer ${property}`);
	}

	mobile.booted.disposeAll();
	assert.equal(mobile.nodes.dock.children.includes(bridge), false, "dispose kept the bridge node");
	assert.equal(mobile.nodes.dock.style.marginBottom, undefined, "dispose kept the seam margin");

	const desktop = boot("desktop");
	assert.equal(desktop.nodes.dock.children.some((child) => child.hasAttribute("data-rdsh-queue-join")), false, "a desktop got the queue bridge");
	assert.equal(desktop.nodes.dock.style.marginBottom, undefined, "a desktop got the seam margin");
	desktop.booted.disposeAll();
});

test("device-local display projects font/locale and restores the Host snapshots", async () => {
	const writes = [];
	const hostTheme = {
		preference: "system",
		revision: 4,
		fontSizes: { text: 14, code: 11, terminal: 13 },
		fontFamilies: { text: "", code: "", terminal: "" },
		active: { id: "light", colorScheme: "light", tokens: {} },
		themes: [],
	};
	const theme = {
		snapshot: hostTheme,
		getTheme() { return this.snapshot; },
		setFontSize(role, px) { writes.push(["font", role, px]); },
	};
	const listeners = new Set();
	const hostLocale = {
		active: "zh",
		revision: 2,
		locales: [
			{ id: "zh", label: "中文", fallback: "en" },
			{ id: "en", label: "English" },
		],
	};
	const locale = {
		snapshot: hostLocale,
		listeners,
		getSnapshot() { return this.snapshot; },
		getLocale() { return this.snapshot; },
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
		setLocale(id) { writes.push(["locale", id]); },
	};
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		theme,
		locale,
		configureDocument(doc) { doc.documentElement.lang = "zh-CN"; },
		storage: {
			"rdsh-mobile-ux:local-display": JSON.stringify({
				fonts: { text: 18, code: 13, terminal: 15 },
				language: "en",
			}),
		},
	});
	const state = booted.sandbox.__RDSH_MOBILE_UX__.state;
	assert.equal(state.localDisplay.fonts.text, 18);
	assert.equal(state.localDisplay.language, "en");
	assert.equal(theme.snapshot.fontSizes.text, 18, "the local font size was not projected");
	assert.equal(theme.snapshot.fontSizes.code, 13);
	assert.equal(theme.snapshot.fontSizes.terminal, 15);
	// The sidebar terminal subscribes to theme/change and reads
	// theme.fontSizes.terminal (#66): the projected snapshot must reach it.
	const terminalEvent = booted.emitted.find((entry) => entry.event === "theme/change"
		&& entry.payload?.fontSizes?.terminal === 15);
	assert.ok(terminalEvent, "the terminal font size did not ride theme/change");
	assert.equal(locale.snapshot.active, "en", "the local locale was not projected");
	assert.equal(booted.sandbox.document.documentElement.lang, "en");
	assert.deepEqual(writes, [], "a shared Host writer was called");

	// A Host sync must not win over the device-local projection.
	booted.emit("theme/change", {
		...hostTheme,
		revision: 8,
		fontSizes: { text: 20, code: 12, terminal: 14 },
	});
	booted.emit("locale/change", { ...hostLocale, active: "zh", revision: 6 });
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(theme.snapshot.fontSizes.text, 18, "the Host theme overwrote the local size");
	assert.equal(locale.snapshot.active, "en", "the Host locale overwrote the local choice");
	assert.deepEqual(writes, [], "a Host sync caused a shared write");

	booted.disposeAll();
	assert.equal(theme.snapshot.fontSizes.text, 20, "the latest Host theme was not restored");
	assert.equal(locale.snapshot.active, "zh", "the Host locale was not restored");
	assert.equal(booted.sandbox.document.documentElement.lang, "zh-CN");
	assert.deepEqual(writes, [], "dispose wrote a shared setting");
});

test("every accepted terminal size reaches theme/change (#66)", () => {
	for (const terminal of [10, 13, 20]) {
		const hostTheme = {
			preference: "system",
			revision: 3,
			fontSizes: { text: 14, code: 11, terminal: 13 },
			fontFamilies: { text: "", code: "", terminal: "" },
			active: { id: "light", colorScheme: "light", tokens: {} },
			themes: [],
		};
		const theme = {
			snapshot: hostTheme,
			getTheme() { return this.snapshot; },
			setFontSize() { throw new Error("the shared font writer was called"); },
		};
		const booted = bootClient({
			mode: "mobile",
			narrow: true,
			theme,
			storage: {
				"rdsh-mobile-ux:local-display": JSON.stringify({
					fonts: { text: 16, code: 12, terminal },
					language: "",
				}),
			},
		});
		assert.equal(booted.sandbox.__RDSH_MOBILE_UX__.state.localDisplay.fonts.terminal, terminal);
		assert.equal(theme.snapshot.fontSizes.terminal, terminal, `terminal ${terminal} was not projected`);
		const event = booted.emitted.find((entry) => entry.event === "theme/change"
			&& entry.payload?.fontSizes?.terminal === terminal);
		assert.ok(event, `terminal ${terminal} did not reach the terminal's theme subscription`);
		assert.equal(event.payload.fontSizes.text, 16);
		booted.disposeAll();
	}
});

/** A locale service with the public language-pack API, recording registrations. */
function japaneseLocale() {
	const registered = [];
	const removed = [];
	const listeners = new Set();
	const service = {
		snapshot: {
			active: "zh",
			revision: 2,
			locales: [{ id: "zh", label: "中文", fallback: "en" }, { id: "en", label: "English" }],
		},
		listeners,
		getSnapshot() { return this.snapshot; },
		addLanguage(input) {
			registered.push({ kind: "language", input: { ...input } });
			this.snapshot = {
				...this.snapshot,
				revision: this.snapshot.revision + 1,
				locales: [...this.snapshot.locales, input],
			};
			return () => { removed.push("language"); };
		},
		register(namespace, lang, dictionary) {
			registered.push({ kind: "dictionary", namespace, lang, keys: Object.keys(dictionary).length });
			return () => { removed.push(`${namespace}:${lang}`); };
		},
		setLocale() { throw new Error("the shared locale writer was called"); },
	};
	return { service, registered, removed };
}

test("a phone gains ja in the display-language picker from the injected pack (#64)", () => {
	const { service, registered, removed } = japaneseLocale();
	const booted = bootClient({ mode: "mobile", narrow: true, locale: service });
	const state = booted.sandbox.__RDSH_MOBILE_UX__.state;
	assert.equal(state.localDisplay.available.language, true);
	assert.deepEqual(state.localDisplay.languages.map((entry) => entry.id), ["zh", "en", "ja"],
		"ja did not join the registered catalog");
	const language = registered.find((entry) => entry.kind === "language");
	assert.ok(language, "addLanguage was not called");
	assert.deepEqual(language.input, { id: "ja", label: "日本語", fallback: "en" });
	assert.deepEqual(
		registered.filter((entry) => entry.kind === "dictionary").map((entry) => entry.namespace),
		["common", "settings", "settings.locale"],
		"the pack translated the wrong namespaces",
	);
	assert.ok(registered.find((entry) => entry.namespace === "common").keys >= 40, "common is incomplete");
	booted.disposeAll();
	assert.ok(removed.includes("language"), "the language definition was not released");
	assert.ok(removed.includes("common:ja"), "a dictionary was not released");
});

test("a desktop never registers the ja pack (#44)", () => {
	const { service, registered } = japaneseLocale();
	bootClient({ mode: "desktop", locale: service });
	assert.deepEqual(registered, [], "a desktop changed its locale catalog");
});

test("a shell without the injected pack or addLanguage offers no ja (#64)", () => {
	const missingPack = japaneseLocale();
	const withoutPack = bootClient({ mode: "mobile", narrow: true, locale: missingPack.service, localePacks: null });
	assert.deepEqual(withoutPack.sandbox.__RDSH_MOBILE_UX__.state.localDisplay.languages.map((entry) => entry.id), ["zh", "en"]);
	assert.deepEqual(missingPack.registered, [], "registrations ran without a pack");

	const listeners = new Set();
	const noApi = {
		snapshot: {
			active: "en",
			revision: 1,
			locales: [{ id: "en", label: "English" }, { id: "zh", label: "中文" }],
		},
		listeners,
		getSnapshot() { return this.snapshot; },
	};
	const withoutApi = bootClient({ mode: "mobile", narrow: true, locale: noApi });
	assert.deepEqual(withoutApi.sandbox.__RDSH_MOBILE_UX__.state.localDisplay.languages.map((entry) => entry.id), ["en", "zh"]);
});

test("font and language availability are independent and fail soft", () => {
	const fontTheme = {
		snapshot: { preference: "system", revision: 1, fontSizes: { text: 14, code: 11, terminal: 13 }, fontFamilies: {}, active: {}, themes: [] },
		getTheme() { return this.snapshot; },
		setFontSize() { throw new Error("shared font writer was called"); },
	};
	const fontOnly = bootClient({
		mode: "mobile",
		narrow: true,
		theme: fontTheme,
		storage: {
			"rdsh-mobile-ux:local-display": JSON.stringify({ fonts: { text: 20, code: 12, terminal: 14 }, language: "en" }),
		},
	});
	const fontState = fontOnly.sandbox.__RDSH_MOBILE_UX__.state;
	assert.equal(fontState.localDisplay.available.fonts, true);
	assert.equal(fontState.localDisplay.available.language, false);
	assert.equal(fontState.localDisplay.reason.language, "locale-missing");
	assert.equal(fontTheme.snapshot.fontSizes.text, 20, "fonts were not projected with only the theme service");
	fontOnly.disposeAll();

	const listeners = new Set();
	const localeOnlyService = {
		snapshot: {
			active: "zh",
			revision: 1,
			locales: [{ id: "en", label: "English" }, { id: "zh", label: "中文" }],
		},
		listeners,
		getSnapshot() { return this.snapshot; },
		getLocale() { return this.snapshot; },
		subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
		setLocale() { throw new Error("shared locale writer was called"); },
	};
	const localeOnly = bootClient({
		mode: "mobile",
		narrow: true,
		locale: localeOnlyService,
		configureDocument(doc) { doc.documentElement.lang = "zh-CN"; },
		storage: {
			"rdsh-mobile-ux:local-display": JSON.stringify({ fonts: { text: 20, code: 12, terminal: 14 }, language: "en" }),
		},
	});
	const localeState = localeOnly.sandbox.__RDSH_MOBILE_UX__.state;
	assert.equal(localeState.localDisplay.available.fonts, false);
	assert.equal(localeState.localDisplay.available.language, true);
	assert.equal(localeState.localDisplay.reason.fonts, "theme-missing");
	assert.equal(localeOnlyService.snapshot.active, "en", "the locale was not projected with only the locale service");
	assert.equal(localeOnly.sandbox.document.documentElement.lang, "en");
	localeOnly.disposeAll();
	assert.equal(localeOnlyService.snapshot.active, "zh");
	assert.equal(localeOnly.sandbox.document.documentElement.lang, "zh-CN");
});

/**
 * Push-independent local banners.
 *
 * `__RDSH_NOTICE_TEST__` exposes the same closures the overlay watcher runs:
 * the pure status diff, the thin emit that renders through `notifyUser`, and
 * the worker-message handler that must not stack a second banner. The require
 * table is a tiny React: `createElement` keeps the props so the fake root can
 * write the banner text into the real notice host.
 */
function localNoticeHarness() {
	const rendered = [];
	const roots = [];
	const react = {
		createElement: (type, props) => ({ type, props }),
		useState: (initial) => [initial, () => {}],
		useEffect: () => {},
		useRef: (initial) => ({ current: initial }),
	};
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		lang: "en",
		copy: COPY,
		globals: { __RDSH_NOTICE_TEST__: {} },
		requireImpl(name) {
			if (name === "react") return react;
			if (name === "react-dom/client") {
				return {
					createRoot(container) {
						roots.push(container);
						return {
							render(node) {
								if (node === null || node === undefined) return;
								const text = node.props?.text ?? "";
								rendered.push(text);
								container.textContent = text;
							},
						};
					},
				};
			}
			if (name === "@deepseek-ai/dsh-client-ui-primitives") return { Toast: function Toast() {} };
			return stub();
		},
	});
	const notice = booted.sandbox.__RDSH_NOTICE_TEST__?.notice;
	assert.ok(notice, "the local notice test seam was not installed");
	return { booted, notice, rendered, roots };
}

test("a finished root turn raises one local banner and push does not stack", () => {
	const { booted, notice, rendered, roots } = localNoticeHarness();
	const byId = { "root-1": { title: "Main" } };
	const running = new Map([["root-1", { running: true }]]);
	const idle = new Map([["root-1", { running: false }]]);

	// The very first render has no baseline and must stay silent.
	notice.emitLocalNotices(null, running, byId);
	assert.equal(rendered.length, 0, "the baseline render raised a banner");

	notice.emitLocalNotices(running, idle, byId);
	assert.equal(rendered.length, 1, "a finished root turn raised no banner");
	assert.equal(rendered[0], "Main — The work finished.", "title and body reached the toast");
	assert.equal(roots.length, 1, "one banner root");
	assert.equal(roots[0].getAttribute("data-rdsh-notice-host"), "", "the banner rendered into the notice host");
	assert.equal(roots[0].textContent, "Main — The work finished.", "the notice host carries the banner text");

	// The worker's hand-off for the same event arrives inside the 4s window.
	notice.onWorkerMessage({
		data: { type: "dsh-mobile-maxxing:notify", title: "Main", body: "done", sessionId: "root-1", kind: "turn-end" },
	});
	assert.equal(rendered.length, 1, "the push hand-off stacked a second banner");
	booted.disposeAll();
});

test("a subagent turn end and a first render raise no local banner", () => {
	const { booted, notice, rendered } = localNoticeHarness();
	const byId = { "child-1": { origin: "subagent", title: "Child" } };
	const running = new Map([["child-1", { running: true }]]);
	const idle = new Map([["child-1", { running: false }]]);

	notice.emitLocalNotices(null, running, byId);
	assert.equal(rendered.length, 0, "the first render notified");
	notice.emitLocalNotices(running, idle, byId);
	assert.equal(rendered.length, 0, "a subagent turn end notified");
	// Missing fields must not throw either.
	assert.doesNotThrow(() => notice.emitLocalNotices(
		new Map([["root-x", null]]),
		new Map([["root-x", { running: false }]]),
		null,
	));
	booted.disposeAll();
});



/**
 * Boot the mobile client with a real-enough push registration so the
 * visibility reporter can be observed: every fetch is recorded, and the
 * heartbeat's setInterval/clearInterval are captured instead of dropped by the
 * default stub.
 */
function bootVisibilityClient({ endpoint = "", initialVisibility = "visible" } = {}) {
	const calls = [];
	const intervals = [];
	const cleared = [];
	const listeners = new Set();
	const registration = {
		active: null,
		waiting: null,
		installing: null,
		update: async () => {},
		addEventListener() {},
		removeEventListener() {},
		pushManager: { getSubscription: async () => (endpoint === "" ? null : { endpoint }) },
	};
	let timer = 0;
	const navigator = {
		onLine: true,
		userAgent: "test",
		platform: "test",
		maxTouchPoints: 0,
		standalone: false,
		serviceWorker: {
			ready: Promise.resolve(registration),
			controller: null,
			getRegistration: async () => registration,
			register: async () => registration,
			addEventListener() {},
			removeEventListener() {},
		},
	};
	const booted = bootClient({
		mode: "mobile",
		navigator,
		globals: {
			location: { origin: "https://app.example:8446", href: "https://app.example:8446/" },
			setInterval(callback, ms) {
				timer += 1;
				intervals.push({ id: timer, ms, callback });
				return timer;
			},
			clearInterval(id) {
				cleared.push(id);
			},
		},
		fetchImpl: async (url, options) => {
			calls.push({ url: String(url), options });
			return { status: 200, ok: true, json: async () => ({ ok: true }) };
		},
		configureDocument(doc) {
			doc.visibilityState = initialVisibility;
			doc.addEventListener = (type, handler) => {
				if (type === "visibilitychange") listeners.add(handler);
			};
			doc.removeEventListener = (type, handler) => {
				if (type === "visibilitychange") listeners.delete(handler);
			};
		},
	});
	const settle = async () => {
		for (let index = 0; index < 6; index += 1) await new Promise((resolve) => setImmediate(resolve));
	};
	const fireVisibility = () => {
		for (const handler of [...listeners]) handler();
	};
	const visibilityPosts = () => calls.filter((call) => call.url.endsWith("/push/visibility"));
	// The PWA shell also polls for updates with setInterval; only the 20s one
	// is the visibility heartbeat.
	const heartbeats = () => intervals.filter((entry) => entry.ms === 20_000);
	return { ...booted, calls, intervals, cleared, heartbeats, visibilityPosts, settle, fireVisibility };
}

test("the visibility reporter runs on boot, change and heartbeat only with an endpoint", async () => {
	const endpoint = "https://web.push.apple.com/device";
	const booted = bootVisibilityClient({ endpoint });
	await booted.settle();
	const bootPosts = booted.visibilityPosts();
	assert.equal(bootPosts.length, 1, "boot must report visibility exactly once");
	assert.equal(bootPosts[0].url, "api/dsh-mobile-maxxing/push/visibility");
	assert.equal(bootPosts[0].options.method, "POST");
	assert.equal(bootPosts[0].options.keepalive, true);
	assert.deepEqual(JSON.parse(bootPosts[0].options.body), {
		visible: true,
		endpoint,
		origin: "https://app.example:8446",
	});
	assert.deepEqual(booted.heartbeats().map((entry) => entry.ms), [20_000], "a visible page starts one heartbeat");

	// The heartbeat re-sends the lease while the page stays visible.
	booted.heartbeats()[0].callback();
	await booted.settle();
	assert.equal(booted.visibilityPosts().length, 2, "the heartbeat did not refresh the lease");
	assert.equal(JSON.parse(booted.visibilityPosts()[1].options.body).visible, true);

	// Hidden: report false and stop the heartbeat.
	booted.sandbox.document.visibilityState = "hidden";
	booted.fireVisibility();
	await booted.settle();
	assert.equal(JSON.parse(booted.visibilityPosts()[2].options.body).visible, false, "hiding must release the lease");
	assert.deepEqual(booted.cleared, [booted.heartbeats()[0].id], "the heartbeat kept running while hidden");
	assert.equal(booted.heartbeats().length, 1, "a hidden page must not start another heartbeat");

	// Visible again: report true and restart the heartbeat.
	booted.sandbox.document.visibilityState = "visible";
	booted.fireVisibility();
	await booted.settle();
	assert.equal(JSON.parse(booted.visibilityPosts()[3].options.body).visible, true);
	assert.equal(booted.heartbeats().length, 2, "returning to the page did not restart the heartbeat");
	assert.deepEqual(booted.disposeAll(), []);
});

test("no push endpoint means no visibility request at all", async () => {
	const booted = bootVisibilityClient({ endpoint: "" });
	await booted.settle();
	assert.equal(booted.visibilityPosts().length, 0, "a page without a subscription has nothing to gate");
	booted.sandbox.document.visibilityState = "hidden";
	booted.fireVisibility();
	booted.sandbox.document.visibilityState = "visible";
	booted.fireVisibility();
	await booted.settle();
	assert.equal(booted.visibilityPosts().length, 0, "visibility changes must stay silent without an endpoint");
	assert.equal(booted.heartbeats().length, 2, "the heartbeat still runs (and restarts), but it sends nothing");
	assert.deepEqual(booted.cleared, [booted.heartbeats()[0].id], "hiding did not stop the endpoint-less heartbeat");
	// The helper on the diagnostics seam is silent too.
	await assert.doesNotReject(booted.sandbox.__RDSH_MOBILE_UX__.reportVisibility(true));
	assert.deepEqual(booted.disposeAll(), []);
});

test("a hidden boot releases the lease without starting a heartbeat", async () => {
	const booted = bootVisibilityClient({ endpoint: "https://web.push.apple.com/device", initialVisibility: "hidden" });
	await booted.settle();
	assert.equal(booted.visibilityPosts().length, 1);
	assert.equal(JSON.parse(booted.visibilityPosts()[0].options.body).visible, false, "a hidden boot must not hold a lease");
	assert.equal(booted.heartbeats().length, 0, "a hidden boot started a heartbeat");
	booted.disposeAll();
});

test("a new pending interaction raises a question banner once", () => {
	const { booted, notice, rendered } = localNoticeHarness();
	const byId = { "root-2": { title: "Ask" } };
	const running = new Map([["root-2", { running: true }]]);
	const asked = new Map([["root-2", { running: true, pendingInteraction: { kind: "question" } }]]);

	notice.emitLocalNotices(null, running, byId);
	assert.equal(rendered.length, 0, "the first render notified");
	notice.emitLocalNotices(running, asked, byId);
	assert.equal(rendered.length, 1, "a new question raised no banner");
	assert.equal(rendered[0], "Ask — Confirm");
	// The same map identity is not a transition.
	notice.emitLocalNotices(asked, asked, byId);
	assert.equal(rendered.length, 1, "an unchanged map raised another banner");
	booted.disposeAll();
});
