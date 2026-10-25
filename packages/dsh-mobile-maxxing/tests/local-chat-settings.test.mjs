/**
 * Device-local chat preferences (work details, collapse, busy Enter, performance).
 *
 * The four upstream policies keep their live value in a client snapshot store
 * that upstream's own Settings rows receive as a slot hook. This bundle writes
 * that store only: the Host configuration form and the upstream `set*`
 * functions (which persist to the Host) must never be called.
 *
 * The fake slot entries below mirror the real shape of the three upstream
 * registrations (`options.id`, `options.inject()` → `hooks[...]` plus the host
 * setters), and every host setter throws if it is ever touched.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import vm from "node:vm";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/** A synchronous snapshot store, the shape `createSnapshotStore` exposes. */
function snapshotStore(initial) {
	let value = initial;
	const listeners = new Set();
	const writes = [];
	return {
		getSnapshot: () => value,
		set(next) {
			value = next;
			writes.push(next);
			for (const listener of [...listeners]) listener();
		},
		subscribe(listener) {
			listeners.add(listener);
			return () => listeners.delete(listener);
		},
		/** Test-only: an accepted Host value arriving from upstream. */
		adopt(next) {
			value = next;
			for (const listener of [...listeners]) listener();
		},
		writes,
		listenerCount: () => listeners.size,
	};
}

/** Load the bundle and hand back the local-chat runtime from its test seam. */
function boot({ entries = [], storage = null } = {}) {
	let definition;
	const store = new Map(Object.entries(storage ?? {}));
	const slotListeners = new Set();
	const sandbox = {
		window: {
			__ModuleLoader__: {
				load(value) {
					definition = value;
				},
			},
		},
		document: {
			documentElement: { getAttribute: () => null, setAttribute() {}, removeAttribute() {}, hasAttribute: () => false },
		},
		localStorage: {
			getItem: (key) => (store.has(key) ? store.get(key) : null),
			setItem: (key, value) => store.set(key, String(value)),
			removeItem: (key) => store.delete(key),
		},
		console,
		// The runtime sits below the desktop gate: the harness is a mobile page.
		__RDSH_DEVICE_MODE__: "mobile",
		__RDSH_LOCAL_CHAT_TEST__: {},
	};
	sandbox.globalThis = sandbox;
	vm.createContext(sandbox);
	vm.runInContext(CLIENT, sandbox, { filename: "client.js" });
	// The seam lives below the desktop gate but before the parts are built, so
	// the factory is enough: no boot, no DOM, and a desktop page never sees it.
	const plugin = definition.factory(() => ({}));
	assert.equal(typeof plugin.apply, "function", "the module returns a plugin");
	const runtime = sandbox.__RDSH_LOCAL_CHAT_TEST__.localChat;
	assert.ok(runtime !== undefined, "the local chat seam was not installed");
	const ctx = {
		slots: {
			entries: (name) => (name === "settings.general.item" ? entries.value : []),
			subscribe: (name, listener) => {
				assert.equal(name, "settings.general.item");
				slotListeners.add(listener);
				return () => slotListeners.delete(listener);
			},
		},
		effect(fn) {
			const dispose = fn();
			sandbox.__dispose = dispose;
			return dispose;
		},
	};
	return { runtime, ctx, store, entries, slotListeners, sandbox };
}

/** The three upstream settings entries, with throwing Host setters. */
function upstreamEntries() {
	const hostSetter = (name) => () => {
		throw new Error(`${name} must never be called (it writes the Host configuration)`);
	};
	const transcript = snapshotStore("detailed");
	const collapse = snapshotStore("completion");
	const performance = snapshotStore("detailed");
	const busyEnter = snapshotStore("queue");
	const entries = [
		{
			options: {
				id: "transcript-view",
				inject: () => ({
					hooks: { transcriptView: transcript, collapseTiming: collapse },
					setTranscriptView: hostSetter("setTranscriptView"),
					setCollapseTiming: hostSetter("setCollapseTiming"),
				}),
			},
		},
		{
			options: {
				id: "performance-usage",
				inject: () => ({ hooks: { performanceUsage: performance }, setPerformanceUsage: hostSetter("setPerformanceUsage") }),
			},
		},
		{
			options: {
				id: "composer-enter",
				inject: () => ({ hooks: { busyEnter }, setBusyEnter: hostSetter("setBusyEnter") }),
			},
		},
	];
	return { entries, transcript, collapse, performance, busyEnter };
}

test("a device choice writes the live store and never the Host", () => {
	const up = upstreamEntries();
	const { runtime, ctx, store } = boot({ entries: { value: up.entries } });
	runtime.attachLocalChat(ctx);

	assert.equal(runtime.setLocalChatValue("workDetails", "verbose"), true);
	assert.equal(up.transcript.getSnapshot(), "verbose", "the live work-details store was not updated");
	assert.equal(runtime.setLocalChatValue("collapse", "next-input"), true);
	assert.equal(up.collapse.getSnapshot(), "next-input");
	assert.equal(runtime.setLocalChatValue("busyEnter", "steer"), true);
	assert.equal(up.busyEnter.getSnapshot(), "steer");
	assert.equal(runtime.setLocalChatValue("performance", "compact"), true);
	assert.equal(up.performance.getSnapshot(), "compact");
	// The host setters would have thrown if the runtime had reached for them.
	assert.equal(JSON.parse(store.get(runtime.key)).performance, "compact", "the device choice was not saved");
});

test("no device choice leaves the Host value alone", () => {
	const up = upstreamEntries();
	const { runtime, ctx } = boot({ entries: { value: up.entries } });
	runtime.attachLocalChat(ctx);
	assert.equal(up.transcript.writes.length, 0, "binding wrote a store without a device choice");
	assert.equal(runtime.status().local.workDetails, undefined);
});

test("an accepted Host value becomes the baseline and reset restores it", () => {
	const up = upstreamEntries();
	const { runtime, ctx } = boot({ entries: { value: up.entries } });
	runtime.attachLocalChat(ctx);
	runtime.setLocalChatValue("workDetails", "compact");
	assert.equal(up.transcript.getSnapshot(), "compact");

	// Upstream adopt()s a new Host value while the device override is active.
	up.transcript.adopt("verbose");
	assert.equal(up.transcript.getSnapshot(), "compact", "the device override did not survive a Host push");

	assert.equal(runtime.resetLocalChat("workDetails"), true);
	assert.equal(up.transcript.getSnapshot(), "verbose", "reset did not restore the latest Host baseline");
	assert.equal(runtime.status().local.workDetails, undefined, "the device choice was not cleared");
});

test("dispose restores the latest Host baseline and drops every subscription", () => {
	const up = upstreamEntries();
	const { runtime, ctx, slotListeners } = boot({ entries: { value: up.entries } });
	runtime.attachLocalChat(ctx);
	runtime.setLocalChatValue("busyEnter", "steer");
	// The Host accepts a different value while the device override is active.
	up.busyEnter.adopt("queue");
	assert.equal(up.busyEnter.getSnapshot(), "steer", "the device override did not survive a Host push");

	runtime.disposeLocalChat();
	assert.equal(up.busyEnter.getSnapshot(), "queue", "dispose did not restore the latest Host baseline");
	assert.equal(up.busyEnter.listenerCount(), 0, "a store subscription outlived dispose");
	assert.equal(slotListeners.size, 1, "the slot subscription is owned by the caller effect, not dispose");
});

test("a missing entry or hook is reported unavailable and never fakes a save", () => {
	const up = upstreamEntries();
	const withoutBusy = up.entries.filter((entry) => entry.options.id !== "composer-enter");
	const { runtime, ctx, store } = boot({ entries: { value: withoutBusy } });
	runtime.attachLocalChat(ctx);
	const status = runtime.status();
	assert.equal(status.available.busyEnter, false, "a missing entry looked adjustable");
	assert.equal(status.reason.busyEnter, "entry-missing");
	assert.equal(runtime.setLocalChatValue("busyEnter", "steer"), false, "a missing entry accepted a value");
	assert.equal(store.has(runtime.key), false, "an unavailable row saved a value");
	assert.equal(status.available.workDetails, true, "the other rows stopped working");
});

test("a hook-less inject is reported as hook-missing", () => {
	const { runtime, ctx } = boot({
		entries: { value: [{ options: { id: "performance-usage", inject: () => ({}) } }] },
	});
	runtime.attachLocalChat(ctx);
	const status = runtime.status();
	assert.equal(status.available.performance, false);
	assert.equal(status.reason.performance, "hook-missing");
});

test("a late settings entry re-binds through the slot subscription", () => {
	const up = upstreamEntries();
	const entries = { value: [] };
	const { runtime, ctx, slotListeners } = boot({ entries });
	runtime.attachLocalChat(ctx);
	assert.equal(runtime.status().available.workDetails, false, "the row bound before the entry existed");
	entries.value = up.entries;
	assert.equal(slotListeners.size, 1, "the slot subscription was not installed");
	for (const listener of [...slotListeners]) listener();
	assert.equal(runtime.status().available.workDetails, true, "the late entry was not bound");
	assert.equal(runtime.setLocalChatValue("workDetails", "compact"), true);
	assert.equal(up.transcript.getSnapshot(), "compact");
});

test("the effect disposer unsubscribes the slot listener and restores values", () => {
	const up = upstreamEntries();
	const { runtime, ctx, sandbox, slotListeners } = boot({ entries: { value: up.entries } });
	runtime.attachLocalChat(ctx);
	runtime.setLocalChatValue("collapse", "next-input");
	assert.equal(slotListeners.size, 1);
	const dispose = sandbox.__dispose;
	assert.equal(typeof dispose, "function", "attachLocalChat did not register an effect");
	dispose();
	assert.equal(slotListeners.size, 0, "the slot subscription survived the effect disposer");
	assert.equal(up.collapse.getSnapshot(), "completion", "the Host value was not restored on teardown");
});

test("the runtime never reaches the Host configuration transport", () => {
	// Public-ABI dependency, deliberately narrow: the slots service and the
	// live snapshot stores only. No configForms, no remote.settings.mutate.
	const start = CLIENT.indexOf("const LOCAL_CHAT_KEY");
	const end = CLIENT.indexOf("// Shared clipboard + toast", start);
	assert.notEqual(start, -1);
	assert.notEqual(end, -1);
	const block = CLIENT.slice(start, end);
	assert.ok(block.length > 500, "the runtime slice is empty");
	assert.equal(/configForms|remote\.settings|\.mutate\(|chatSettings/.test(block), false, "the local chat runtime reaches the Host settings transport");
	assert.match(block, /\.store\.set\(/, "the runtime no longer writes the live store");
	assert.match(block, /options\?\.inject/, "the runtime no longer reads the upstream entry shape");
});
