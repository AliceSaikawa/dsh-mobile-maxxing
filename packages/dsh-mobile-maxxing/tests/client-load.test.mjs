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
import { COPY, PROBES } from "../lib/copy.js";

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
	config = null,
	fetchImpl = null,
	navigator = null,
	computedStyle = () => stub(),
	theme = null,
	locale = null,
	requireImpl = null,
	services = {},
	slotsEntries = null,
	log = console,
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
	if (config !== null) sandbox.__RDSH_MOBILE_UX_CONFIG__ = config;
	// The canonical host bootstrap value. Null means "let the harness derive
	// the legacy default"; contract tests pass it explicitly. `injectMode:
	// false` models an old/absent bootstrap and must fail closed to desktop.
	if (injectMode) sandbox.__RDSH_DEVICE_MODE__ = mode ?? (narrow ? "mobile" : "desktop");
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
			entries(name) {
				return typeof slotsEntries === "function" ? slotsEntries(name) : undefined;
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
	// Reviewed ja labels: the stock sidebar action and a workspace's "+".
	assert.equal(drawerClosedAfterTapping("新しいセッションを作成"), true, "ja sidebar button");
	assert.equal(drawerClosedAfterTapping("my-repo で新しいセッション"), true, "ja workspace button");
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

/** One committed ja namespace, as the full translation ships it. */
function jaNamespace(name) {
	return JSON.parse(readFileSync(new URL(`../../rdsh-locale-ja/locale/namespaces/ja/${name}.json`, import.meta.url), "utf8"));
}

test("#80 the default hide list matches the committed ja labels", () => {
	// The visible ja renderings of HIDE_DEFAULT, read from the reviewed
	// catalogue rather than written out here.
	const settings = jaNamespace("settings");
	const shortcuts = jaNamespace("shortcuts");
	const account = jaNamespace("settings.account");
	const plugins = jaNamespace("settings.plugins");
	const command = jaNamespace("command");
	const sessionLog = jaNamespace("session-log-download");
	const labels = [
		settings.openDocument,
		sessionLog["header.more"],
		command["label.feedback"],
		account.signIn,
		shortcuts.settings,
		settings["developerTools.title"],
		plugins.title,
	];
	const controls = labels.map((label) => {
		const button = element();
		button.setAttribute("aria-label", label);
		return button;
	});
	const frames = [];
	const config = {};
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		lang: "ja",
		frames,
		config,
		configureDocument(doc) {
			doc.querySelectorAll = (selector) => (selector === "button[aria-label], [role='menuitem']" ? controls : []);
			doc.querySelector = () => null;
		},
	});
	const flush = () => {
		for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
	};
	flush();
	for (const [index, control] of controls.entries()) {
		assert.equal(control.hasAttribute("data-rdsh-hidden"), true, `${labels[index]} stayed visible on a phone`);
	}
	assert.equal(booted.sandbox.document.documentElement.hasAttribute("data-rdsh-hide-settings"), true);

	// The console switch turns hiding off, and the same pass cleans every hook.
	config.showHiddenControls = true;
	booted.sandbox.__RDSH_MOBILE_UX__.decorate();
	flush();
	for (const control of controls) assert.equal(control.hasAttribute("data-rdsh-hidden"), false, "turning hiding off left a tag behind");
	assert.equal(booted.sandbox.document.documentElement.hasAttribute("data-rdsh-hide-settings"), false);

	// ...and back on: the ja entries are still in the default list.
	config.showHiddenControls = false;
	booted.sandbox.__RDSH_MOBILE_UX__.decorate();
	flush();
	for (const control of controls) assert.equal(control.hasAttribute("data-rdsh-hidden"), true, "the ja entries left the default list");
	booted.disposeAll();

	// A profile's own custom entries keep their exact/prefix semantics along
	// with the localized defaults.
	const custom = element();
	custom.setAttribute("aria-label", "Custom control: keep out");
	const customFrames = [];
	const customBoot = bootClient({
		mode: "mobile",
		narrow: true,
		frames: customFrames,
		config: { hideLabels: ["Custom control"] },
		configureDocument(doc) {
			doc.querySelectorAll = (selector) => (selector === "button[aria-label], [role='menuitem']" ? [custom] : []);
			doc.querySelector = () => null;
		},
	});
	for (let index = 0; index < 10 && customFrames.length > 0; index += 1) customFrames.shift()();
	assert.equal(custom.hasAttribute("data-rdsh-hidden"), true, "the profile hide entry stopped matching");
	customBoot.disposeAll();

	// A desktop with the same ja labels is a hard no-op.
	const desktopControls = labels.map((label) => {
		const button = element();
		button.setAttribute("aria-label", label);
		return button;
	});
	const desktop = bootClient({
		mode: "desktop",
		narrow: false,
		lang: "ja",
		frames: [],
		configureDocument(doc) {
			doc.querySelectorAll = () => desktopControls;
			doc.querySelector = () => null;
		},
	});
	for (const control of desktopControls) assert.equal(control.hasAttribute("data-rdsh-hidden"), false, "a desktop hid a ja control");
	desktop.disposeAll();
});

/* ------------------------------------------------------------------ */
/* #75: the Trajectory Conversation view tab on a phone                */
/* ------------------------------------------------------------------ */

/** The shipped Conversation tab strip: a marker div with plain tab buttons. */
function conversationTabs(labels = ["Chat", "Trajectory", "Dashboard"], selected = "Chat") {
	const tabs = [];
	const strip = element();
	for (const label of labels) {
		const tab = element();
		tab.tagName = "BUTTON";
		tab.textContent = label;
		tab.querySelector = () => null;
		tab.setAttribute("role", "tab");
		tab.setAttribute("aria-selected", String(label === selected));
		tab.clicks = 0;
		tab.focused = false;
		tab.click = () => {
			tab.clicks += 1;
			for (const other of tabs) other.setAttribute("aria-selected", String(other === tab));
		};
		tab.focus = () => {
			tab.focused = true;
		};
		tabs.push(tab);
	}
	strip.querySelectorAll = (selector) => (selector === '[role="tab"]' ? tabs : []);
	return { strip, tabs };
}

/** Boot client.js against one Conversation tab strip and run a decorate pass. */
function bootConversationTabs({ mode = "mobile", fixture = conversationTabs(), slotsEntries = null } = {}) {
	const frames = [];
	const booted = bootClient({
		mode,
		narrow: mode === "mobile",
		frames,
		slotsEntries,
		configureDocument(doc) {
			doc.querySelector = (selector) => (selector === "[data-conversation-tabs]" ? fixture.strip : null);
			doc.querySelectorAll = (selector) => {
				if (selector === "[data-conversation-tabs]") return [fixture.strip];
				const exactAttribute = /^\[([\w-]+)\]$/.exec(selector);
				return exactAttribute === null ? [] : fixture.tabs.filter((tab) => tab.hasAttribute(exactAttribute[1]));
			};
		},
	});
	for (let index = 0; index < 10 && frames.length > 0; index += 1) frames.shift()();
	return { ...fixture, booted, frames };
}

test("#75 hides the Trajectory conversation tab on a phone and keeps every other tab", () => {
	const { tabs, booted } = bootConversationTabs();
	const [chat, trajectory, dashboard] = tabs;
	assert.equal(trajectory.hasAttribute("data-rdsh-trajectory-tab-hidden"), true, "Trajectory was not hidden");
	assert.equal(chat.hasAttribute("data-rdsh-trajectory-tab-hidden"), false, "Chat was hidden");
	assert.equal(dashboard.hasAttribute("data-rdsh-trajectory-tab-hidden"), false, "Dashboard was hidden");
	assert.equal(chat.clicks + dashboard.clicks, 0, "a non-active Trajectory pass changed the selection");
	booted.disposeAll();
});

test("#75 the hide rule is in the phone sheet and not the desktop one", () => {
	const phone = CLIENT.match(/const CSS_PHONE = `([\s\S]*?)`;/)[1];
	const device = CLIENT.match(/const CSS_DEVICE = `([\s\S]*?)`;/)[1];
	assert.match(
		phone,
		/html\[data-rdsh-hide-settings\] \[data-conversation-tabs\] \[data-rdsh-trajectory-tab-hidden\] \{ display: none !important; \}/,
		"the hidden Trajectory tab has no phone rule",
	);
	assert.doesNotMatch(device, /trajectory-tab-hidden/, "the desktop sheet hides a phone tab");
});

test("#75 falls back to Chat before hiding an active Trajectory tab, and only once", () => {
	const fixture = conversationTabs(["Chat", "Trajectory", "Dashboard"], "Trajectory");
	const [chat, trajectory] = fixture.tabs;
	let hiddenAtClick = null;
	const click = chat.click;
	chat.click = () => {
		hiddenAtClick = trajectory.hasAttribute("data-rdsh-trajectory-tab-hidden");
		click();
	};
	const { booted } = bootConversationTabs({ fixture });
	assert.equal(chat.clicks, 1, "Chat was not selected");
	assert.equal(chat.focused, true, "focus did not follow the fallback");
	assert.equal(hiddenAtClick, false, "Trajectory was hidden before the fallback");
	assert.equal(chat.getAttribute("aria-selected"), "true", "Chat is not selected");
	assert.equal(trajectory.hasAttribute("data-rdsh-trajectory-tab-hidden"), true, "Trajectory is visible");
	booted.sandbox.__RDSH_MOBILE_UX__.decorateNow();
	assert.equal(chat.clicks, 1, "a second pass stole the selection again");
	booted.disposeAll();
});

test("#75 leaves another active view selected while hiding Trajectory", () => {
	const fixture = conversationTabs(["Chat", "Trajectory", "Dashboard"], "Dashboard");
	const [chat, trajectory, dashboard] = fixture.tabs;
	const { booted } = bootConversationTabs({ fixture });
	assert.equal(trajectory.hasAttribute("data-rdsh-trajectory-tab-hidden"), true, "Trajectory was not hidden");
	assert.equal(chat.clicks, 0, "Chat was selected over the active Dashboard");
	assert.equal(dashboard.clicks, 0, "the active Dashboard tab was clicked");
	assert.equal(dashboard.getAttribute("aria-selected"), "true", "the active Dashboard view was lost");
	booted.disposeAll();
});

test("#75 is a no-op on a desktop", () => {
	const fixture = conversationTabs(["Chat", "Trajectory"], "Trajectory");
	const { tabs, booted } = bootConversationTabs({ mode: "desktop", fixture });
	assert.equal(booted.sandbox.__RDSH_MOBILE_UX__, undefined, "the mobile half booted on a desktop");
	assert.equal(tabs[1].hasAttribute("data-rdsh-trajectory-tab-hidden"), false, "a desktop hid Trajectory");
	assert.equal(tabs[0].clicks, 0, "a desktop changed the selection");
	assert.equal(tabs[1].getAttribute("aria-selected"), "true", "a desktop lost its active view");
	booted.disposeAll();
});

test("#75 removes the tab hook on dispose", () => {
	const fixture = conversationTabs();
	const { tabs, booted } = bootConversationTabs({ fixture });
	assert.equal(tabs[1].hasAttribute("data-rdsh-trajectory-tab-hidden"), true, "the phone hook is missing before dispose");
	booted.disposeAll();
	assert.equal(tabs[1].hasAttribute("data-rdsh-trajectory-tab-hidden"), false, "dispose left the tab hidden");
});

for (const label of ["Trajectory", "軌跡", "轨迹", "トラジェクトリ"]) {
	test(`#75 recognizes the ${label} Trajectory label`, () => {
		const fixture = conversationTabs(["Chat", label, "Dashboard"], "Chat");
		const { tabs, booted } = bootConversationTabs({ fixture });
		assert.equal(tabs[1].hasAttribute("data-rdsh-trajectory-tab-hidden"), true, `${label} was not hidden`);
		assert.equal(tabs[0].hasAttribute("data-rdsh-trajectory-tab-hidden"), false, "Chat was hidden");
		assert.equal(tabs[2].hasAttribute("data-rdsh-trajectory-tab-hidden"), false, "Dashboard was hidden");
		booted.disposeAll();
	});
}

test("#75 reads the localized label through the stable trajectory slot id", () => {
	const fixture = conversationTabs(["Chat", "Parcours"], "Chat");
	const entries = [
		{ options: { id: "chat", order: 0, label: () => "Chat" } },
		{ options: { id: "trajectory", order: 10, label: () => "Parcours" } },
	];
	const { tabs, booted } = bootConversationTabs({
		fixture,
		slotsEntries: (name) => (name === "conversation.view" ? entries : undefined),
	});
	assert.equal(tabs[1].hasAttribute("data-rdsh-trajectory-tab-hidden"), true, "the slot label did not identify Trajectory");
	assert.equal(tabs[0].hasAttribute("data-rdsh-trajectory-tab-hidden"), false, "Chat was hidden");
	booted.disposeAll();
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
		if (selector.includes('aria-label="Automation tasks"')) return auto;
		if (selector.includes('aria-label="Plugins"')) return plugins;
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
		if (selector.includes('aria-label="Automation tasks"')) return auto;
		if (selector.includes('aria-label="Plugins"')) return plugins;
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
		if (selector.includes('aria-label="Automation tasks"')) return auto;
		if (selector.includes('aria-label="Plugins"')) return plugins;
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
	// Reviewed ja labels for the same two folded rows.
	assert.equal(drawerClosedAfterTapping("プラグイン"), true, "ja Plugins left the drawer open");
	assert.equal(drawerClosedAfterTapping("自動化タスク"), true, "ja Automation tasks left the drawer open");
	assert.equal(drawerClosedAfterTapping("プラグイン", { narrow: false, mode: "desktop" }), false, "a desktop ja sidebar was closed");
	assert.equal(drawerClosedAfterTapping("自動化タスク", { narrow: false, mode: "desktop" }), false, "a desktop ja sidebar was closed");
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
 * the plugin registered (the plain stub swallows listeners). `crumb` is the
 * upstream plugin breadcrumb, found in the detail the same way the client does.
 */
function detailBoot({ mode = "mobile", narrow = true, container = null, page = null, crumb = null } = {}) {
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
			if (container !== null) {
				container.querySelectorAll = (selector) => (selector === 'button[class*="_crumb"]' && crumb !== null ? [crumb] : []);
			}
			doc.querySelectorAll = (selector) => {
				if (selector === "[data-plugin-detail], [data-plugin-item-detail], [data-plugin-row-detail]") return container === null ? [] : [container];
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
	const crumb = element();
	crumb.setAttribute("class", "X_2TxG_crumb");
	crumb.setAttribute("aria-label", "Back to plugins");
	crumb.getBoundingClientRect = laidOutRect(24, 28, 82, 20);
	const { booted, back } = detailBoot({ container, crumb });
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

test("device-local projections keep Host revisions so rows keep updating (#73/#64)", async () => {
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
		setTheme(id) { writes.push(["theme", id]); },
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
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const state = api.state;
	// Upstream Appearance/font and Language row stores mirror the Host snapshot
	// and ignore a revision that is not newer than the one they stored.
	const rows = {
		themeRevision: hostTheme.revision,
		fontSizes: hostTheme.fontSizes,
		localeRevision: hostLocale.revision,
		active: hostLocale.active,
	};
	booted.ctx.on("theme/change", (snapshot) => {
		if (snapshot === null || snapshot === undefined || snapshot.revision <= rows.themeRevision) return;
		rows.themeRevision = snapshot.revision;
		rows.fontSizes = snapshot.fontSizes;
	});
	listeners.add(() => {
		const snapshot = locale.getSnapshot();
		if (snapshot === null || snapshot === undefined || snapshot.revision <= rows.localeRevision) return;
		rows.localeRevision = snapshot.revision;
		rows.active = snapshot.active;
	});
	// The mounted terminal reads theme.getTheme() through its snapshot
	// subscription; locale consumers read LocaleFace getSnapshot().
	const terminal = { rendered: theme.getTheme(), fonts: [] };
	booted.ctx.on("theme/change", () => {
		queueMicrotask(() => {
			const snapshot = theme.getTheme();
			if (snapshot === terminal.rendered) return;
			terminal.rendered = snapshot;
			terminal.fonts.push(snapshot.fontSizes.text);
		});
	});
	const localeReads = [];
	locale.subscribe(() => {
		localeReads.push(locale.getSnapshot());
	});

	// Drive the same applyTheme/applyLocale path the local controls use.
	state.localDisplay.fonts = { text: 19, code: 12, terminal: 16 };
	state.localDisplay.fontsLocal = true;
	booted.emit("theme/change", theme.getTheme());
	state.localDisplay.language = "en";
	booted.emit("locale/change", locale.getSnapshot());
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(theme.snapshot.fontSizes.text, 19, "the local font size was not projected");
	assert.equal(theme.snapshot.revision, hostTheme.revision, "the font projection inflated the Host revision");
	assert.notEqual(theme.snapshot, hostTheme, "the font projection reused the Host identity");
	assert.equal(locale.snapshot.active, "en", "the local language was not projected");
	assert.equal(locale.snapshot.revision, hostLocale.revision, "the locale projection inflated the Host revision");
	assert.notEqual(locale.snapshot, hostLocale, "the locale projection reused the Host identity");
	assert.equal(booted.sandbox.document.documentElement.lang, "en");
	assert.deepEqual(terminal.fonts, [19], "the local font projection did not reach the mounted terminal");
	assert.equal(localeReads.at(-1)?.active, "en", "the local language did not reach locale readers");
	assert.equal(rows.themeRevision, hostTheme.revision, "the font projection was adopted by the row stores");
	assert.equal(rows.localeRevision, hostLocale.revision, "the locale projection was adopted by the row store");
	assert.equal(rows.fontSizes.text, 14, "the shared font row stopped showing the Host value");
	assert.equal(rows.active, "zh", "the shared language row stopped showing the Host value");

	// A later Host theme and locale snapshot with ordinary revisions must land,
	// while the device-local font and language survive.
	const nextTheme = { ...hostTheme, revision: 5, fontSizes: { text: 20, code: 12, terminal: 14 } };
	theme.snapshot = nextTheme;
	booted.emit("theme/change", nextTheme);
	const nextLocale = { ...hostLocale, revision: 3, active: "zh" };
	locale.snapshot = nextLocale;
	booted.emit("locale/change", nextLocale);
	for (const listener of [...listeners]) listener();
	await Promise.resolve();
	await Promise.resolve();

	assert.equal(rows.themeRevision, 5, "the font rows froze after a device-local projection");
	assert.equal(rows.fontSizes.text, 20, "the font rows did not take the Host snapshot");
	assert.equal(theme.snapshot.fontSizes.text, 19, "the Host theme change reverted the device-local font");
	assert.equal(theme.snapshot.revision, 5, "the Host revision was left inflated");
	assert.equal(rows.localeRevision, 3, "the language row froze after a device-local projection");
	assert.equal(rows.active, "zh", "the language row did not take the Host snapshot");
	assert.equal(locale.snapshot.active, "en", "the Host locale change reverted the device-local language");
	assert.equal(locale.snapshot.revision, 3, "the Host locale revision was left inflated");
	assert.equal(localeReads.at(-1)?.active, "en", "locale readers lost the local language after a Host change");

	// "System" restores the Host language.
	state.localDisplay.language = "";
	booted.emit("locale/change", nextLocale);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(locale.snapshot, nextLocale, "resetting the local language did not restore the Host snapshot");
	assert.equal(localeReads.at(-1)?.active, "zh", "locale readers kept the local language after reset");
	assert.equal(booted.sandbox.document.documentElement.lang, "zh-CN");
	assert.equal(rows.active, "zh");

	// #79's terminal repaint must keep the device-local fonts and revision.
	api.writeTerminalDark(true);
	assert.equal(theme.snapshot.fontSizes.text, 19, "terminal dark reverted the device-local font");
	assert.equal(theme.snapshot.revision, nextTheme.revision, "terminal dark inflated the Host revision");
	api.writeTerminalDark(false);
	assert.equal(theme.snapshot.fontSizes.text, 19, "terminal dark off reverted the device-local font");
	assert.equal(theme.snapshot.revision, nextTheme.revision, "terminal dark off inflated the Host revision");

	assert.deepEqual(writes, [], "a shared Host writer was called");
	booted.disposeAll();
	assert.equal(theme.snapshot, nextTheme, "dispose did not restore the latest Host theme");
	assert.equal(locale.snapshot, nextLocale, "dispose did not restore the latest Host locale");
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

test("terminal-only dark is off by default, device-local and asks for a terminal repaint (#79)", () => {
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
		setTheme(id) { writes.push(["theme", id]); },
		setFontSize(role, px) { writes.push(["font", role, px]); },
	};
	const booted = bootClient({ mode: "mobile", narrow: true, theme, storage: {} });
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	const key = "rdsh-mobile-ux:terminal-dark";
	assert.equal(api.state.terminalDark, false, "the preference defaults to off");
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), false, "the scoped palette was painted by default");
	assert.equal(booted.sandbox.localStorage.getItem(key), null, "a default boot wrote storage");

	const observed = [];
	booted.ctx.on("theme/change", (snapshot) => observed.push(snapshot));
	api.writeTerminalDark(true);
	assert.equal(api.state.terminalDark, true);
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), true, "the scoped palette was not painted");
	assert.equal(booted.sandbox.localStorage.getItem(key), "1", "the choice was not stored locally");
	assert.ok(observed.length > 0, "no theme/change was sent for the terminal to reread");
	const repaint = observed[observed.length - 1];
	assert.equal(repaint.active, hostTheme.active, "the repaint changed the shared tokens");
	assert.equal(repaint.preference, hostTheme.preference, "the repaint changed the shared preference");
	assert.deepEqual(repaint.fontSizes, hostTheme.fontSizes, "the repaint changed the shared fonts");
	assert.equal(repaint.revision, hostTheme.revision,
		"the repaint fabricated a revision the Appearance/font row stores would adopt");
	assert.deepEqual(writes, [], "a shared theme writer was called");

	api.writeTerminalDark(false);
	assert.equal(api.state.terminalDark, false);
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), false, "turning off left the scoped palette");
	assert.equal(booted.sandbox.localStorage.getItem(key), null, "turning off left the stored choice");
	assert.equal(observed.length, 2, "turning off did not ask the terminal to reread");
	assert.deepEqual(writes, [], "turning off called a shared theme writer");
	booted.disposeAll();
});

test("a terminal-dark repaint keeps the device-local font projection (#79)", () => {
	const hostTheme = {
		preference: "light",
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
				fonts: { text: 17, code: 13, terminal: 16 },
				language: "",
			}),
		},
	});
	assert.equal(theme.snapshot.fontSizes.text, 17);
	assert.equal(theme.snapshot.fontSizes.code, 13);
	assert.equal(theme.snapshot.fontSizes.terminal, 16);
	booted.sandbox.__RDSH_MOBILE_UX__.writeTerminalDark(true);
	assert.equal(theme.snapshot.fontSizes.text, 17, "the terminal repaint dropped the device-local font sizes");
	assert.equal(theme.snapshot.fontSizes.code, 13, "the terminal repaint dropped the device-local font sizes");
	assert.equal(theme.snapshot.fontSizes.terminal, 16, "the terminal repaint dropped the device-local font sizes");
	booted.sandbox.__RDSH_MOBILE_UX__.writeTerminalDark(false);
	assert.equal(theme.snapshot.fontSizes.text, 17, "turning terminal dark off reverted the device-local font sizes");
	assert.equal(theme.snapshot.fontSizes.code, 13, "turning terminal dark off reverted the device-local font sizes");
	assert.equal(theme.snapshot.fontSizes.terminal, 16, "turning terminal dark off reverted the device-local font sizes");
	booted.disposeAll();
	assert.equal(theme.snapshot.fontSizes.text, 14, "dispose did not restore the Host font sizes");
	assert.equal(theme.snapshot.fontSizes.code, 11, "dispose did not restore the Host font sizes");
	assert.equal(theme.snapshot.fontSizes.terminal, 13, "dispose did not restore the Host font sizes");
});

test("terminal-dark repaints keep Host revisions so later rows still update (#79)", async () => {
	const hostTheme = {
		preference: "light",
		revision: 4,
		fontSizes: { text: 14, code: 11, terminal: 13 },
		fontFamilies: { text: "", code: "", terminal: "" },
		active: { id: "light", colorScheme: "light", tokens: {} },
		themes: [],
	};
	const theme = {
		snapshot: hostTheme,
		getTheme() { return this.snapshot; },
		setTheme(id) { throw new Error("the shared theme writer was called: " + id); },
		setFontSize(role, px) { throw new Error("the shared font writer was called: " + role + " " + px); },
	};
	let documentElement;
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		theme,
		computedStyle: () => ({
			backgroundColor: documentElement.hasAttribute("data-rdsh-terminal-dark") ? "#151517" : "#f9fafb",
			color: documentElement.hasAttribute("data-rdsh-terminal-dark") ? "#f9fafb" : "#1b1b1c",
		}),
		configureDocument(doc) {
			documentElement = doc.documentElement;
		},
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	// Upstream Appearance/font row stores mirror the Host snapshot and ignore a
	// revision that is not newer than the one they stored.
	const rows = {
		revision: hostTheme.revision,
		preference: hostTheme.preference,
		fontSizes: hostTheme.fontSizes,
	};
	booted.ctx.on("theme/change", (snapshot) => {
		if (snapshot === null || snapshot === undefined || snapshot.revision <= rows.revision) return;
		rows.revision = snapshot.revision;
		rows.preference = snapshot.preference;
		rows.fontSizes = snapshot.fontSizes;
	});
	// A mounted terminal subscribes through the theme store's getSnapshot and
	// reruns getComputedStyle only when the rendered snapshot object changed.
	const terminal = { rendered: theme.getTheme(), repaints: 0, backgrounds: [] };
	booted.ctx.on("theme/change", () => {
		queueMicrotask(() => {
			const snapshot = theme.getTheme();
			if (snapshot === terminal.rendered) return;
			terminal.rendered = snapshot;
			terminal.repaints += 1;
			terminal.backgrounds.push(booted.sandbox.getComputedStyle(documentElement).backgroundColor);
		});
	});

	api.writeTerminalDark(true);
	await Promise.resolve();
	assert.equal(terminal.repaints, 1, "turning terminal dark on did not repaint the mounted terminal");
	assert.deepEqual(terminal.backgrounds, ["#151517"], "the terminal did not reread the dark surface");
	assert.equal(theme.snapshot.revision, hostTheme.revision, "the repaint inflated the Host revision");
	assert.equal(rows.revision, hostTheme.revision, "the repaint was adopted by the row stores");

	api.writeTerminalDark(false);
	await Promise.resolve();
	assert.equal(terminal.repaints, 2, "turning terminal dark off did not repaint the mounted terminal");
	assert.deepEqual(terminal.backgrounds, ["#151517", "#f9fafb"], "the terminal did not reread the light surface");
	assert.equal(theme.snapshot.revision, hostTheme.revision, "turning terminal dark off left an inflated revision");
	assert.equal(rows.revision, hostTheme.revision, "the repaint was adopted by the row stores");

	// A later Host theme change with an ordinary revision must still land.
	const nextTheme = {
		...hostTheme,
		revision: hostTheme.revision + 1,
		preference: "dark",
		active: { id: "dark", colorScheme: "dark", tokens: {} },
	};
	theme.snapshot = nextTheme;
	booted.emit("theme/change", nextTheme);
	await Promise.resolve();
	assert.equal(rows.revision, nextTheme.revision, "the Appearance row froze after a terminal-dark toggle");
	assert.equal(rows.preference, "dark", "the Appearance row kept the stale preference");

	// A later Host font snapshot must still reach the font row store.
	const fontTheme = {
		...nextTheme,
		revision: nextTheme.revision + 1,
		fontSizes: { text: 18, code: 12, terminal: 15 },
	};
	theme.snapshot = fontTheme;
	booted.emit("theme/change", fontTheme);
	await Promise.resolve();
	assert.equal(rows.revision, fontTheme.revision, "the font rows froze after a terminal-dark toggle");
	assert.deepEqual(rows.fontSizes, fontTheme.fontSizes, "the font rows kept the stale Host sizes");
	assert.equal(theme.snapshot.revision, fontTheme.revision, "the Host revision stayed inflated");
	assert.equal(theme.snapshot.fontSizes.text, 18, "the Host font snapshot did not land");
	booted.disposeAll();
});

test("a saved terminal-dark choice survives reload and a Host theme change (#79)", async () => {
	const hostTheme = {
		preference: "light",
		revision: 2,
		fontSizes: { text: 14, code: 11, terminal: 13 },
		fontFamilies: { text: "", code: "", terminal: "" },
		active: { id: "light", colorScheme: "light", tokens: {} },
		themes: [],
	};
	const theme = {
		snapshot: hostTheme,
		getTheme() { return this.snapshot; },
		setTheme(id) { throw new Error(`shared theme writer called: ${id}`); },
	};
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		theme,
		storage: { "rdsh-mobile-ux:terminal-dark": "1" },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(api.state.terminalDark, true, "the stored choice was not read");
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), true, "the stored choice was not painted");
	assert.notEqual(theme.snapshot, hostTheme, "the stored choice sent no repaint at boot");
	assert.equal(theme.snapshot.active, hostTheme.active, "the boot repaint changed the shared tokens");
	assert.equal(theme.snapshot.revision, hostTheme.revision, "the boot repaint inflated the Host revision");

	const nextHost = {
		...hostTheme,
		revision: 20,
		fontSizes: { text: 16, code: 12, terminal: 14 },
		active: { id: "dark", colorScheme: "dark", tokens: {} },
	};
	booted.emit("theme/change", nextHost);
	await Promise.resolve();
	await Promise.resolve();
	assert.equal(api.state.terminalDark, true, "a Host theme change dropped the local choice");
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), true, "a Host theme change removed the scoped palette");
	assert.equal(theme.snapshot, nextHost, "the Host snapshot was not adopted after a shared theme change");
	booted.disposeAll();
});

test("disposing terminal dark restores the Host snapshot and stops reapplying it (#79)", () => {
	const hostTheme = {
		preference: "light",
		revision: 1,
		fontSizes: { text: 14, code: 11, terminal: 13 },
		fontFamilies: { text: "", code: "", terminal: "" },
		active: { id: "light", colorScheme: "light", tokens: {} },
		themes: [],
	};
	const theme = {
		snapshot: hostTheme,
		getTheme() { return this.snapshot; },
	};
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		theme,
		storage: { "rdsh-mobile-ux:terminal-dark": "1" },
	});
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), true);
	assert.notEqual(theme.snapshot, hostTheme, "the test did not start from a projected snapshot");
	booted.disposeAll();
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), false, "dispose left the scoped palette");
	assert.equal(theme.snapshot, hostTheme, "dispose did not restore the Host snapshot");
	booted.emit("theme/change", { ...hostTheme, revision: 99 });
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), false, "a later theme change repainted after dispose");
});

test("without a usable theme pathway the terminal is not half-painted (#79)", () => {
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		storage: { "rdsh-mobile-ux:terminal-dark": "1" },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(api.state.terminalDark, true, "the saved choice was not read");
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), false,
		"the scoped background was painted without the theme repaint path");
	api.writeTerminalDark(true);
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), false,
		"turning on painted a terminal that cannot reread its palette");
	booted.disposeAll();
});

test("a saved terminal-dark choice never wakes the desktop half (#79)", () => {
	const booted = bootClient({
		mode: "desktop",
		storage: { "rdsh-mobile-ux:terminal-dark": "1" },
	});
	assert.equal(booted.sandbox.__RDSH_MOBILE_UX__, undefined, "the desktop built the mobile half");
	assert.equal(booted.sandbox.document.documentElement.hasAttribute("data-rdsh-terminal-dark"), false,
		"the desktop painted the mobile terminal palette");
	assert.equal(booted.sandbox.localStorage.getItem("rdsh-mobile-ux:terminal-dark"), "1",
		"the desktop rewrote the saved choice");
});

/**
 * A locale service with the public language-pack API and a recording catalog.
 *
 * `addLanguage` and its disposer mirror `LocaleRuntime.publishCatalog`:
 * they publish the *resolved* Host active (so a removed language falls back
 * before the mobile reads the snapshot) and notify the LocaleFace listeners.
 * The real runtime emits `locale/change` before those listeners for an
 * active switch (same frozen snapshot object); this fake only notifies the
 * listeners, and a test emits the event itself when the order matters.
 * `register` mirrors the runtime republishing `this.snapshot.active`, which
 * a device-local projection can have replaced.
 *
 * `hostSelect` is a Host switch that publishes (setLocale); `silentHostSelect`
 * is the durable preference change `LocaleRuntime.adopt` makes without a
 * publish when the resolved active already equals `snapshot.active` (the
 * device projection), so no locale/change is emitted at all. `resolveActive`
 * mirrors the runtime's pure durable-preference resolver; `withResolver:
 * false` models an older runtime that does not expose it, while the catalog
 * publish still uses the same internal resolution.
 */
function localeService({ locales = [
	{ id: "zh", label: "中文", fallback: "en" },
	{ id: "en", label: "English" },
], active = "zh", withResolver = true } = {}) {
	const registered = [];
	const removed = [];
	const listeners = new Set();
	let revision = 2;
	let catalog = [...locales];
	/** The Host's own selection; catalog changes re-resolve to this value. */
	let hostActive = active;
	/** LocaleRuntime.resolveActive, also used by the catalog publish. */
	const resolveHostActive = () => {
		if (catalog.some((entry) => entry.id === hostActive)) return hostActive;
		return catalog.some((entry) => entry.id === "en") ? "en" : (catalog[0]?.id ?? "");
	};
	const publish = (localeActive) => {
		revision += 1;
		service.snapshot = Object.freeze({
			active: localeActive,
			revision,
			locales: Object.freeze([...catalog]),
		});
		for (const listener of [...listeners]) listener();
	};
	const service = {
		snapshot: Object.freeze({ active, revision, locales: Object.freeze([...locales]) }),
		listeners,
		getSnapshot() { return this.snapshot; },
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/** LocaleRuntime.resolveActive: durable preference, else provisional. */
		resolveActive() {
			return resolveHostActive();
		},
		addLanguage(input) {
			registered.push({ kind: "language", input: { ...input } });
			catalog = [...catalog, input];
			publish(resolveHostActive());
			return () => {
				removed.push("language");
				catalog = catalog.filter((entry) => entry.id !== input.id);
				publish(resolveHostActive());
			};
		},
		/** Test-only Host selection that publishes: the caller emits locale/change. */
		hostSelect(id) {
			hostActive = id;
			publish(id);
		},
		/** Test-only silent durable Host switch (`adopt` early return, no event). */
		silentHostSelect(id) {
			hostActive = id;
		},
		register(namespace, lang, dictionary) {
			registered.push({ kind: "dictionary", namespace, lang, keys: Object.keys(dictionary).length });
			publish(service.snapshot.active);
			return () => {
				removed.push(`${namespace}:${lang}`);
				publish(service.snapshot.active);
			};
		},
		setLocale() { throw new Error("the shared locale writer was called"); },
	};
	if (!withResolver) delete service.resolveActive;
	return { service, registered, removed };
}

test("a phone lists only the shared catalog and never adds ja itself (#64/#80)", () => {
	const { service, registered, removed } = localeService();
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const state = booted.sandbox.__RDSH_MOBILE_UX__.state;
	assert.equal(state.localDisplay.available.language, true);
	assert.deepEqual(state.localDisplay.languages.map((entry) => entry.id), ["zh", "en"],
		"the picker invented a language the catalog does not have");
	assert.equal(state.localDisplay.language, "", "a stored ja was accepted without an owner");
	assert.deepEqual(registered, [], "the mobile package registered a locale definition");
	booted.disposeAll();
	assert.deepEqual(removed, [], "the mobile package removed a locale definition it never owned");
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en"]);
});

test("a separately installed ja owner appears in the picker and survives mobile dispose (#80)", () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service, registered, removed } = localeService({
		locales: [
			{ id: "zh", label: "中文", fallback: "en" },
			{ id: "en", label: "English" },
			ja,
		],
	});
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const state = booted.sandbox.__RDSH_MOBILE_UX__.state;
	assert.deepEqual(state.localDisplay.languages.map((entry) => entry.id), ["zh", "en", "ja"],
		"an owner-registered ja is missing from the picker");
	assert.equal(state.localDisplay.language, "ja", "the stored choice was not accepted from the catalog");
	assert.deepEqual(registered, [], "mobile must not duplicate the separate owner's registration");
	assert.equal(service.snapshot.active, "ja", "the device-local projection was not applied");
	const hostLocales = service.snapshot.locales;
	booted.disposeAll();
	assert.equal(service.snapshot.active, "zh", "dispose did not restore the Host language");
	assert.deepEqual(service.snapshot.locales, hostLocales, "mobile dispose removed the separate owner's ja");
	assert.deepEqual(removed, [], "mobile disposed a definition owned by the separate package");
});

/** Drain the projection microtasks the locale listeners queue. */
async function settleLocale() {
	for (let index = 0; index < 4; index += 1) await Promise.resolve();
}

test("#80 an owner that activates after the mobile attach reaches the picker and keeps the stored ja", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service, registered, removed } = localeService();
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	assert.deepEqual(api.state.localDisplay.languages.map((entry) => entry.id), ["zh", "en"]);
	assert.equal(api.state.localDisplay.language, "", "ja cannot be selected before its owner exists");

	// rdsh-locale-ja activates late: addLanguage publishes the catalog through
	// the LocaleFace listeners only, because the active locale stays zh.
	const releaseJa = service.addLanguage(ja);
	await settleLocale();

	assert.deepEqual(api.state.localDisplay.languages.map((entry) => entry.id), ["zh", "en", "ja"],
		"a catalog-only publish never reached the picker");
	assert.equal(api.state.localDisplay.language, "ja",
		"the stored choice was not restored when its owner arrived");
	assert.equal(service.snapshot.active, "ja", "the late catalog was not projected");
	assert.equal(service.snapshot.revision, 3, "the projection inflated the Host revision");
	assert.deepEqual(registered, [{ kind: "language", input: { ...ja } }],
		"the mobile package registered a language of its own");

	// The picker can move between the late language and System afterwards.
	api.setLanguage("");
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "", "System was not selectable after the late arrival");
	assert.equal(service.snapshot.active, "zh");
	api.setLanguage("ja");
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "ja", "the late language was not selectable");
	assert.equal(service.snapshot.active, "ja");

	booted.disposeAll();
	assert.equal(service.snapshot.active, "zh", "dispose did not restore the Host active locale");
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en", "ja"],
		"dispose dropped the externally owned ja from the restored snapshot");
	assert.equal(service.snapshot.revision, 3, "dispose changed the Host revision");
	assert.deepEqual(removed, [], "the mobile package withdrew a definition it does not own");
});

test("#80 a withdrawn ja is unprojected without forgetting the device choice, and re-adding restores it", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service } = localeService();
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const releaseJa = service.addLanguage(ja);
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "ja");
	assert.equal(service.snapshot.active, "ja", "the test did not start from a projection");

	releaseJa();
	await settleLocale();
	assert.deepEqual(api.state.localDisplay.languages.map((entry) => entry.id), ["zh", "en"],
		"the picker kept a language the catalog withdrew");
	assert.equal(api.state.localDisplay.language, "", "a withdrawn language stayed selected");
	assert.equal(service.snapshot.active, "zh", "the withdrawn language was not unprojected");
	assert.equal(service.snapshot.locales.some((entry) => entry.id === "ja"), false);
	assert.equal(
		JSON.parse(booted.sandbox.localStorage.getItem("rdsh-mobile-ux:local-display")).language,
		"ja",
		"the stored device choice was discarded with the definition",
	);

	const reAdd = service.addLanguage(ja);
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "ja", "the stored choice did not come back with the definition");
	assert.equal(service.snapshot.active, "ja");

	booted.disposeAll();
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en", "ja"],
		"dispose dropped the external definition");
	assert.equal(service.snapshot.active, "zh");
	reAdd();
});

test("#80 disposing after the external owner withdrew ja never resurrects it", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service } = localeService();
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const releaseJa = service.addLanguage(ja);
	await settleLocale();
	assert.equal(service.snapshot.active, "ja");
	releaseJa();
	await settleLocale();
	assert.equal(service.snapshot.active, "zh");

	booted.disposeAll();
	assert.equal(service.snapshot.locales.some((entry) => entry.id === "ja"), false,
		"dispose wrote a withdrawn ja back into the Host snapshot");
	assert.equal(service.snapshot.active, "zh", "dispose restored a stale active locale");
	assert.equal(service.snapshot.revision, 4, "dispose changed the Host revision");
});

test("#80 a later Host locale change keeps the device language and disposes to the newest Host view", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service } = localeService({
		locales: [
			{ id: "zh", label: "中文", fallback: "en" },
			{ id: "en", label: "English" },
			ja,
		],
	});
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		storage: {
			"rdsh-mobile-ux:local-display": JSON.stringify({
				fonts: { text: 18, code: 13, terminal: 15 },
				language: "ja",
			}),
		},
		configureDocument(doc) { doc.documentElement.lang = "zh-CN"; },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(service.snapshot.active, "ja");

	// The Host switches to en on its own: a normal locale/change with a newer
	// revision. The device keeps ja and its font projection.
	service.hostSelect("en");
	const next = service.snapshot;
	booted.emit("locale/change", next);
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "ja", "the Host change won over the device choice");
	assert.equal(service.snapshot.active, "ja", "the Host change dropped the device projection");
	assert.equal(service.snapshot.revision, 3, "the projection did not keep the new Host revision");
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en", "ja"]);
	assert.equal(docEl.lang, "ja", "the Host change dropped the device document language");

	// "System" restores the newest Host view and forgets the remembered choice.
	api.setLanguage("");
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "", "System did not clear the device choice");
	assert.equal(service.snapshot, next, "System did not restore the Host snapshot");
	assert.equal(docEl.lang, "en", "System restored the boot document language over the Host change");

	// A catalog publish after the explicit System choice must not bring ja back.
	service.addLanguage({ id: "ko", label: "한국어", fallback: "en" });
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "", "a catalog change revived a cleared choice");

	booted.disposeAll();
	assert.equal(service.snapshot.active, "en", "dispose restored an older Host active locale");
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en", "ja", "ko"]);
	assert.equal(docEl.lang, "en", "dispose restored the boot document language over the Host change");
});

test("#80 a dictionary republish while a device language is projected is not a Host active change", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service } = localeService({
		locales: [
			{ id: "zh", label: "中文", fallback: "en" },
			{ id: "en", label: "English" },
			ja,
		],
	});
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		configureDocument(doc) { doc.documentElement.lang = "zh-CN"; },
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(service.snapshot.active, "ja");

	// LocaleRuntime.register republishes this.snapshot.active, which is the
	// device projection here; adopting it as the Host active would both lose
	// the shared locale and restore the device choice on dispose.
	service.register("late", "ja", { hello: "こんにちは" });
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "ja", "the device choice was dropped");
	assert.equal(service.snapshot.active, "ja", "the projection was lost");
	assert.equal(docEl.lang, "ja", "the store republish disturbed the document language");

	booted.disposeAll();
	assert.equal(service.snapshot.active, "zh", "the device choice was restored as the Host active locale");
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en", "ja"]);
	assert.equal(docEl.lang, "zh-CN",
		"a normalised store republish was treated as a Host language change");
});

test("#80 a silent Host switch to the projected language survives System and dispose", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service } = localeService({
		locales: [
			{ id: "zh", label: "中文", fallback: "en" },
			{ id: "en", label: "English" },
			ja,
		],
	});
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		configureDocument(doc) { doc.documentElement.lang = "zh-CN"; },
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(service.snapshot.active, "ja", "the test did not start from a projection");
	assert.equal(docEl.lang, "ja", "the device projection did not set the document language");

	// LocaleRuntime.adopt returns early because the resolved Host active (ja)
	// already equals the projected snapshot.active: no publish, no revision
	// bump and no locale/change. Only the runtime's durable-preference
	// resolver can see this Host switch.
	service.silentHostSelect("ja");
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "ja");
	assert.equal(service.snapshot.revision, 2, "a silent Host switch bumped the Host revision");

	// System restores the Host's ja, not the previous zh baseline.
	api.setLanguage("");
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "", "System did not clear the device choice");
	assert.equal(service.snapshot.active, "ja", "System restored a stale Host active locale");
	assert.equal(service.snapshot.revision, 2, "System changed the Host revision");
	assert.equal(docEl.lang, "ja", "System restored the boot document language over the Host switch");

	// Re-selecting ja and disposing keeps the silent Host switch as baseline.
	api.setLanguage("ja");
	await settleLocale();
	assert.equal(docEl.lang, "ja");
	booted.disposeAll();
	assert.equal(service.snapshot.active, "ja", "dispose reverted the silent Host switch");
	assert.equal(service.snapshot.revision, 2, "dispose changed the Host revision");
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en", "ja"]);
	assert.equal(docEl.lang, "ja", "dispose restored the boot document language over the Host switch");
});

test("#80 an authoritative locale/change naming the projected language is not normalised", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	// No resolver: the store heuristic is the only source, so the event
	// boundary is what keeps this authoritative switch.
	const { service } = localeService({
		locales: [
			{ id: "zh", label: "中文", fallback: "en" },
			{ id: "en", label: "English" },
			ja,
		],
		withResolver: false,
	});
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		configureDocument(doc) { doc.documentElement.lang = "zh-CN"; },
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(service.snapshot.active, "ja");

	// The Host switches to ja: the store notification republishes the
	// projection's active, then publish(..., true) emits the authoritative
	// locale/change with the same active and catalog.
	service.hostSelect("ja");
	const next = service.snapshot;
	booted.emit("locale/change", next);
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "ja");
	assert.equal(service.snapshot.active, "ja");
	assert.equal(service.snapshot.revision, 3, "the projection inflated the Host revision");

	api.setLanguage("");
	await settleLocale();
	assert.equal(service.snapshot.active, "ja", "System restored a stale Host active locale");
	assert.equal(service.snapshot.revision, 3);
	assert.equal(docEl.lang, "ja", "System restored the boot document language over the Host switch");

	booted.disposeAll();
	assert.equal(service.snapshot.active, "ja", "dispose reverted the authoritative Host switch");
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en", "ja"]);
	assert.equal(docEl.lang, "ja", "dispose restored the boot document language over the Host switch");
});

test("#80 without the Host-active resolver a silent switch falls back to the published baseline", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service } = localeService({
		locales: [
			{ id: "zh", label: "中文", fallback: "en" },
			{ id: "en", label: "English" },
			ja,
		],
		withResolver: false,
	});
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		configureDocument(doc) { doc.documentElement.lang = "zh-CN"; },
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(service.snapshot.active, "ja");

	// Documented limitation: without resolveActive the module cannot see a
	// durable preference change that emitted no locale/change, so it restores
	// the last published Host baseline (zh) rather than the silent ja. The
	// document language stays the boot one because the Host active it belongs
	// to did not observably change.
	service.silentHostSelect("ja");
	await settleLocale();
	api.setLanguage("");
	await settleLocale();
	assert.equal(service.snapshot.active, "zh", "the published-baseline fallback changed its contract");
	assert.equal(docEl.lang, "zh-CN");
	booted.disposeAll();
	assert.equal(service.snapshot.active, "zh");
	assert.equal(docEl.lang, "zh-CN");
});

test("#80 an externally removed language follows the Host fallback document language", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
	const { service } = localeService();
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		locale: service,
		configureDocument(doc) { doc.documentElement.lang = "zh-CN"; },
		storage: { "rdsh-mobile-ux:local-display": JSON.stringify({ language: "ja" }) },
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	const releaseJa = service.addLanguage(ja);
	await settleLocale();
	assert.equal(service.snapshot.active, "ja");
	assert.equal(docEl.lang, "ja");

	// The Host preference had moved to ja; removing ja makes the runtime
	// resolve its provisional language (en here) and publish that fallback.
	service.silentHostSelect("ja");
	await settleLocale();
	releaseJa();
	await settleLocale();
	assert.equal(api.state.localDisplay.language, "");
	assert.equal(service.snapshot.active, "en", "the Host fallback was not restored");
	assert.equal(docEl.lang, "en", "the document language did not follow the Host fallback");

	booted.disposeAll();
	assert.equal(service.snapshot.active, "en");
	assert.equal(docEl.lang, "en");
});

test("#80 a catalog publish leaves the device font projection untouched", async () => {
	const ja = { id: "ja", label: "日本語", fallback: "en" };
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
	};
	const { service } = localeService();
	const booted = bootClient({
		mode: "mobile",
		narrow: true,
		theme,
		locale: service,
		storage: {
			"rdsh-mobile-ux:local-display": JSON.stringify({
				fonts: { text: 18, code: 13, terminal: 15 },
				language: "",
			}),
		},
	});
	const api = booted.sandbox.__RDSH_MOBILE_UX__;
	const docEl = booted.sandbox.document.documentElement;
	assert.equal(theme.snapshot.fontSizes.text, 18);
	assert.equal(api.state.localDisplay.fontsLocal, true);
	api.writeTerminalDark(true);
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), true);

	service.addLanguage(ja);
	await settleLocale();
	assert.equal(theme.snapshot.fontSizes.text, 18, "the catalog publish reverted the device font");
	assert.equal(theme.snapshot.revision, hostTheme.revision, "the catalog publish inflated the theme revision");
	assert.deepEqual(api.state.localDisplay.languages.map((entry) => entry.id), ["zh", "en", "ja"]);
	assert.equal(api.state.localDisplay.language, "", "an untouched device stayed on System");
	assert.equal(docEl.hasAttribute("data-rdsh-terminal-dark"), true,
		"the catalog publish dropped the terminal-only palette");

	// A font step while the language owner is inactive keeps the stored choice.
	api.setFont("text", 1);
	assert.equal(
		JSON.parse(booted.sandbox.localStorage.getItem("rdsh-mobile-ux:local-display")).language,
		"",
		"a font step invented a language choice",
	);
	api.writeTerminalDark(false);
	booted.disposeAll();
	assert.equal(theme.snapshot, hostTheme);
});

test("a desktop never touches the locale catalog (#44/#80)", () => {
	const { service, registered, removed } = localeService();
	const booted = bootClient({ mode: "desktop", locale: service });
	assert.equal(booted.sandbox.__RDSH_MOBILE_UX__, undefined, "the desktop built the mobile half");
	assert.deepEqual(registered, [], "a desktop changed its locale catalog");
	booted.disposeAll();
	assert.deepEqual(removed, []);
	assert.deepEqual(service.snapshot.locales.map((entry) => entry.id), ["zh", "en"]);
});

test("without a language-pack API the picker reads the catalog without inventing ja (#80)", () => {
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
	const booted = bootClient({ mode: "mobile", narrow: true, locale: noApi });
	assert.deepEqual(booted.sandbox.__RDSH_MOBILE_UX__.state.localDisplay.languages.map((entry) => entry.id), ["en", "zh"]);
	booted.disposeAll();
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

/* ---------------------------------------------------------------------- */
/* #59: landscape drawer nav folds into one accessible More row           */
/* ---------------------------------------------------------------------- */

/** A small element with the event/children support the More menu needs. */
function navNode(doc, tag = "div") {
	const node = element();
	const listeners = new Map();
	node.tagName = String(tag).toUpperCase();
	node.children = [];
	node.parentElement = null;
	node.className = "";
	node.textContent = "";
	node.addEventListener = (type, handler) => {
		if (!listeners.has(type)) listeners.set(type, []);
		listeners.get(type).push(handler);
	};
	node.removeEventListener = (type, handler) => {
		const list = listeners.get(type);
		if (list === undefined) return;
		const at = list.indexOf(handler);
		if (at >= 0) list.splice(at, 1);
	};
	node.dispatchNav = (type, props = {}) => {
		const event = {
			type,
			target: node,
			currentTarget: node,
			defaultPrevented: false,
			propagationStopped: false,
			preventDefault() { this.defaultPrevented = true; },
			stopPropagation() { this.propagationStopped = true; },
			stopImmediatePropagation() { this.propagationStopped = true; },
			...props,
		};
		for (const handler of [...(listeners.get(type) ?? [])]) handler.call(node, event);
		return event;
	};
	node.click = () => node.dispatchNav("click");
	node.focus = () => { doc.activeElement = node; };
	node.appendChild = (child) => {
		if (child.parentElement !== null) child.remove();
		child.parentElement = node;
		node.children.push(child);
		return child;
	};
	node.append = (...children) => {
		for (const child of children) node.appendChild(child);
	};
	node.insertBefore = (child, reference) => {
		if (child.parentElement !== null) child.remove();
		const at = node.children.indexOf(reference);
		child.parentElement = node;
		if (at < 0) node.children.push(child);
		else node.children.splice(at, 0, child);
		return child;
	};
	node.after = (sibling) => {
		const parent = node.parentElement;
		if (parent === null) return;
		parent.insertBefore(sibling, node.nextElementSibling);
	};
	node.remove = () => {
		const parent = node.parentElement;
		if (parent === null) return;
		const at = parent.children.indexOf(node);
		if (at >= 0) parent.children.splice(at, 1);
		node.parentElement = null;
	};
	node.contains = (target) => target === node || node.children.some((child) => child.contains(target));
	node.querySelectorAll = (selector) => {
		const found = [];
		const walk = (current) => {
			for (const child of current.children) {
				if (navMatches(child, selector)) found.push(child);
				walk(child);
			}
		};
		walk(node);
		return found;
	};
	node.querySelector = (selector) => node.querySelectorAll(selector)[0] ?? null;
	Object.defineProperty(node, "nextElementSibling", {
		get() {
			if (node.parentElement === null) return null;
			const siblings = node.parentElement.children;
			return siblings[siblings.indexOf(node) + 1] ?? null;
		},
	});
	Object.defineProperty(node, "lastElementChild", {
		get() { return node.children[node.children.length - 1] ?? null; },
	});
	return node;
}

/** The tiny selector language the nav fixture and the menu use. */
function navMatches(node, selector) {
	for (const branch of selector.split(",")) {
		const part = branch.trim();
		if (part === "") continue;
		const tag = (part.match(/^([A-Za-z][\w-]*)/) ?? [])[1];
		if (tag !== undefined && node.tagName !== tag.toUpperCase()) continue;
		const classMatch = part.match(/\.([A-Za-z0-9_-]+)/);
		if (classMatch !== null && !String(node.className).split(/\s+/).includes(classMatch[1])) continue;
		const attributes = [...part.matchAll(/\[([A-Za-z0-9_-]+)(?:=(?:"([^"]*)"|'([^']*)'))?\]/g)];
		if (attributes.length === 0) {
			if (tag !== undefined || classMatch !== null) return true;
			continue;
		}
		if (attributes.every(([, name, doubleQuoted, singleQuoted]) => node.hasAttribute(name)
			&& ((doubleQuoted ?? singleQuoted) === undefined || node.getAttribute(name) === (doubleQuoted ?? singleQuoted)))) return true;
	}
	return false;
}

function navBoot({ mode = "mobile", narrow = false, lang = undefined, labels = {} } = {}) {
	const label = (name, fallback) => labels[name] ?? fallback;
	const frames = [];
	const docListeners = [];
	const windowListeners = [];
	const created = [];
	const counts = { plugins: 0, automation: 0, settings: 0 };
	let nav = null;
	let body = null;
	let newSession = null;
	let plugins = null;
	let automation = null;
	const booted = bootClient({
		mode,
		narrow,
		lang,
		copy: COPY,
		frames,
		windowAdd(type, handler) { windowListeners.push({ type, handler }); },
		windowRemove(type, handler) {
			const at = windowListeners.findIndex((entry) => entry.type === type && entry.handler === handler);
			if (at >= 0) windowListeners.splice(at, 1);
		},
		configureDocument(doc) {
			body = navNode(doc, "body");
			nav = navNode(doc, "nav");
			nav.className = "hHd-Xa_panelList";
			newSession = navNode(doc, "button");
			plugins = navNode(doc, "button");
			automation = navNode(doc, "button");
			newSession.setAttribute("aria-label", label("newSession", "New Session"));
			plugins.setAttribute("aria-label", label("plugins", "Plugins"));
			automation.setAttribute("aria-label", label("automation", "Automation tasks"));
			nav.append(newSession, plugins, automation);
			body.append(nav);
			doc.body = body;
			doc.createElement = (tag) => {
				const node = navNode(doc, tag);
				created.push(node);
				return node;
			};
			doc.querySelector = (selector) => {
				if (selector === "nav.hHd-Xa_panelList") return nav;
				if (selector === "[data-rdsh-settings-row]"
					|| selector === "[data-rdsh-settings-row], .rdsh-mux-settings-row") return nav.querySelector("[data-rdsh-settings-row]");
				if (selector === "[data-rdsh-nav-more]") return nav.querySelector("[data-rdsh-nav-more]");
				return null;
			};
			doc.querySelectorAll = (selector) => {
				if (selector === "[data-rdsh-settings-row], .rdsh-mux-settings-row"
					|| selector === "[data-rdsh-nav-more]"
					|| selector === "[data-rdsh-nav-more-hidden]"
					|| selector === "[data-rdsh-more-row]") return nav.querySelectorAll(selector);
				return [];
			};
			doc.addEventListener = (type, handler, options) => {
				const capture = options === true || (options !== undefined && options !== null && options.capture === true);
				docListeners.push({ type, handler, capture });
			};
			doc.removeEventListener = (type, handler, options) => {
				const capture = options === true || (options !== undefined && options !== null && options.capture === true);
				const at = docListeners.findIndex((entry) => entry.type === type && entry.handler === handler && entry.capture === capture);
				if (at >= 0) docListeners.splice(at, 1);
			};
		},
	});
	const run = () => {
		while (frames.length > 0) frames.shift()();
	};
	run();
	return {
		booted,
		doc: booted.sandbox.document,
		sandbox: booted.sandbox,
		nav,
		body,
		newSession,
		plugins,
		automation,
		created,
		docListeners,
		windowListeners,
		counts,
		run,
		settingsRow: () => nav.querySelector("[data-rdsh-settings-row]"),
		more: () => nav.querySelector("[data-rdsh-nav-more]"),
		menus: () => body.querySelectorAll(".rdsh-mux-nav-more-menu"),
		items: () => body.querySelectorAll("button[role='menuitem']"),
	};
}

test("#59 landscape folds the three nav rows into one More row", () => {
	const fixture = navBoot();
	const more = fixture.more();
	assert.ok(more, "the landscape More row was not created");
	assert.equal(more.getAttribute("aria-haspopup"), "menu");
	assert.equal(more.getAttribute("aria-expanded"), "false");
	assert.equal(more.getAttribute("aria-label"), COPY.en["mux.navMore"]);
	assert.equal(more.className.includes("rdsh-mux-nav-more"), true);
	assert.equal(more.nextElementSibling, fixture.plugins, "More is not in the first folded row's slot");
	for (const row of [fixture.plugins, fixture.automation, fixture.settingsRow()]) {
		assert.equal(row.hasAttribute("data-rdsh-nav-more-hidden"), true, "a folded row is still visible");
	}
	assert.equal(fixture.nav.querySelectorAll("[data-rdsh-settings-row]").length, 1, "the Settings row was duplicated");

	// Repainting must not duplicate the More row or the single #87 Settings row.
	for (let pass = 0; pass < 3; pass += 1) fixture.booted.sandbox.__RDSH_MOBILE_UX__.decorateNow();
	assert.equal(fixture.nav.querySelectorAll("[data-rdsh-nav-more]").length, 1);
	assert.equal(fixture.nav.querySelectorAll("[data-rdsh-settings-row]").length, 1);
	assert.equal(fixture.nav.querySelectorAll("[data-rdsh-nav-more-hidden]").length, 3);
	fixture.booted.disposeAll();
});

test("#59 the More menu focuses and activates each folded row", () => {
	const fixture = navBoot();
	const settingsRow = fixture.settingsRow();
	fixture.plugins.click = () => { fixture.counts.plugins += 1; };
	fixture.automation.click = () => { fixture.counts.automation += 1; };
	settingsRow.click = () => { fixture.counts.settings += 1; };
	const more = fixture.more();

	for (const [index, countKey] of [[0, "plugins"], [1, "automation"], [2, "settings"]]) {
		more.click();
		const menus = fixture.menus();
		assert.equal(menus.length, 1, "More did not open exactly one menu");
		const menu = menus[0];
		assert.equal(menu.getAttribute("role"), "menu");
		assert.equal(menu.getAttribute("aria-label"), COPY.en["mux.navMore.menu"]);
		const items = fixture.items();
		assert.deepEqual(items.map((item) => item.textContent), ["Plugins", "Automation tasks", "Settings"]);
		assert.equal(fixture.doc.activeElement, items[0], "the first menu item did not receive focus");
		// ArrowDown moves focus without leaving the menu.
		items[0].dispatchNav("keydown", { key: "ArrowDown" });
		assert.equal(fixture.doc.activeElement, items[1], "ArrowDown did not move focus");
		items[1].dispatchNav("keydown", { key: "ArrowUp" });
		assert.equal(fixture.doc.activeElement, items[0], "ArrowUp did not move focus");
		assert.equal(more.getAttribute("aria-expanded"), "true");
		items[index].click();
		assert.equal(fixture.counts[countKey], 1, `the ${countKey} row did not run`);
		assert.equal(menu.parentElement, null, "the menu stayed after item selection");
		assert.equal(more.getAttribute("aria-expanded"), "false");
		assert.equal(more.hasAttribute("aria-controls"), false);
	}
	fixture.booted.disposeAll();
});

test("#59 the More menu dismisses on Escape, outside press, Tab and resize", () => {
	const fixture = navBoot();
	const more = fixture.more();
	const lastDoc = (type) => [...fixture.docListeners].reverse().find((entry) => entry.type === type && entry.capture);
	const lastWindow = (type) => [...fixture.windowListeners].reverse().find((entry) => entry.type === type);

	more.click();
	let menu = fixture.menus()[0];
	assert.ok(menu, "the menu did not open");
	lastDoc("pointerdown").handler({ target: fixture.body });
	assert.equal(menu.parentElement, null, "an outside press did not close the menu");
	assert.equal(more.getAttribute("aria-expanded"), "false");

	more.click();
	menu = fixture.menus()[0];
	const escape = { key: "Escape", prevented: 0, stopped: 0, preventDefault() { this.prevented += 1; }, stopPropagation() { this.stopped += 1; } };
	lastDoc("keydown").handler(escape);
	assert.equal(menu.parentElement, null, "Escape did not close the menu");
	assert.equal(escape.prevented, 1, "Escape was not consumed");
	assert.equal(fixture.doc.activeElement, more, "Escape did not restore focus to More");

	more.click();
	menu = fixture.menus()[0];
	fixture.items()[0].dispatchNav("keydown", { key: "Tab" });
	assert.equal(menu.parentElement, null, "Tab left the menu behind");

	more.click();
	menu = fixture.menus()[0];
	lastWindow("resize").handler();
	assert.equal(menu.parentElement, null, "a resize did not close the menu");
	assert.equal(more.getAttribute("aria-expanded"), "false");

	// Rotating back to portrait removes More and restores the stock rows.
	fixture.sandbox.innerWidth = 390;
	fixture.sandbox.window.innerWidth = 390;
	fixture.booted.sandbox.__RDSH_MOBILE_UX__.decorateNow();
	assert.equal(fixture.more(), null, "portrait kept the landscape More row");
	for (const row of [fixture.plugins, fixture.automation, fixture.settingsRow()]) {
		assert.equal(row.hasAttribute("data-rdsh-nav-more-hidden"), false, "portrait kept a folded row hidden");
	}
	assert.equal(fixture.nav.querySelectorAll("[data-rdsh-settings-row]").length, 1);
	fixture.booted.disposeAll();
});

test("#59 the More row is mobile-landscape only and is removed on dispose", () => {
	const portrait = navBoot({ narrow: true });
	assert.equal(portrait.more(), null, "a portrait phone got the landscape More row");
	assert.equal(portrait.nav.querySelectorAll("[data-rdsh-nav-more-hidden]").length, 0);
	assert.ok(portrait.settingsRow(), "the portrait Settings row is missing");
	portrait.booted.disposeAll();

	const desktop = navBoot({ mode: "desktop", narrow: false });
	assert.equal(desktop.more(), null, "a desktop got the landscape More row");
	assert.equal(desktop.nav.querySelectorAll("[data-rdsh-nav-more-hidden]").length, 0);
	assert.equal(desktop.newSession.hasAttribute("aria-label"), true, "the desktop nav was rewritten");
	desktop.booted.disposeAll();

	const landscape = navBoot();
	const more = landscape.more();
	more.click();
	assert.equal(landscape.menus().length, 1);
	landscape.booted.disposeAll();
	assert.equal(landscape.more(), null, "dispose left the More row");
	assert.equal(landscape.menus().length, 0, "dispose left the More menu");
	assert.equal(landscape.nav.querySelectorAll("[data-rdsh-nav-more-hidden]").length, 0, "dispose left folded rows hidden");
	assert.equal(landscape.nav.children.includes(landscape.plugins), true, "dispose removed a stock row");
	assert.equal(landscape.nav.children.includes(landscape.automation), true, "dispose removed a stock row");
	assert.equal(landscape.settingsRow(), null, "dispose kept the injected Settings row");
});

test("#80 a full ja shell folds the three rows and runs every More action", () => {
	const labels = { newSession: "新しいセッションを作成", plugins: "プラグイン", automation: "自動化タスク" };
	const fixture = navBoot({ lang: "ja", labels });
	const more = fixture.more();
	assert.ok(more, "the ja landscape More row was not created");
	const settingsRow = fixture.settingsRow();
	assert.ok(settingsRow, "the ja Settings row was not injected");
	for (const row of [fixture.plugins, fixture.automation, settingsRow]) {
		assert.equal(row.hasAttribute("data-rdsh-nav-more-hidden"), true, "a ja folded row is still visible");
	}
	// The injected row still follows Automation tasks when its label is ja.
	assert.equal(fixture.automation.nextElementSibling, settingsRow, "the ja Settings row did not follow Automation tasks");

	fixture.plugins.click = () => { fixture.counts.plugins += 1; };
	fixture.automation.click = () => { fixture.counts.automation += 1; };
	settingsRow.click = () => { fixture.counts.settings += 1; };

	more.click();
	const items = fixture.items();
	assert.deepEqual(
		items.map((item) => item.textContent),
		["プラグイン", "自動化タスク", COPY.ja["mux.settingsRow"]],
		"the ja More menu does not list the three folded rows",
	);
	for (const item of items) item.click();
	assert.deepEqual(fixture.counts, { plugins: 1, automation: 1, settings: 1 }, "a ja More item did not run its stock row");
	assert.equal(fixture.menus().length, 0, "the ja More menu stayed open");
	fixture.booted.disposeAll();
});

test("#80 a full ja desktop keeps the stock nav and installs no phone controls", () => {
	const labels = { newSession: "新しいセッションを作成", plugins: "プラグイン", automation: "自動化タスク" };
	const fixture = navBoot({ mode: "desktop", narrow: false, lang: "ja", labels });
	assert.equal(fixture.more(), null, "a ja desktop got the landscape More row");
	assert.equal(fixture.settingsRow(), null, "a ja desktop got the injected Settings row");
	assert.equal(fixture.nav.querySelectorAll("[data-rdsh-nav-more-hidden]").length, 0, "a ja desktop folded a row");
	assert.equal(fixture.plugins.getAttribute("aria-label"), "プラグイン", "a ja desktop nav was rewritten");
	assert.equal(fixture.docListeners.length, 0, "a ja desktop installed the mobile click listener");
	fixture.booted.disposeAll();
});
