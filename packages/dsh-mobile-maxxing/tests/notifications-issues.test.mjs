/**
 * Behavioural regression tests for the notification issues #27 and #28.
 *
 * The setup is deliberately the awkward one: two DSH processes share one
 * `DSH_HOME` (therefore one `push.json`) and serve two different origins.
 * Every test drives the real route handlers and the real `PushStore`; only
 * `fetch` is stubbed, so the assertions are about routing and pruning, not
 * about the Web Push wire format (that lives in notify.test.mjs).
 * The writes are sequential: a concurrent read-modify-write race between two
 * processes is a documented risk and is not asserted to be safe here.
 *
 * The last block loads `sw.js` in a `node:vm` sandbox with a fake CacheStorage
 * to pin the assumptions behind "the two apps' caches cannot interfere":
 * CacheStorage is per origin, and the worker only touches its own origin.
 *
 * No test here changes notification policy. The unknown-origin fallback is
 * asserted exactly as it is intended today (send to every stored
 * subscription) because suppressing it would drop background notifications;
 * #27 is a product-policy decision, not something a test may quietly decide.
 */

import assert from "node:assert/strict";
import { createECDH, randomBytes } from "node:crypto";
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { Readable } from "node:stream";
import { test } from "node:test";
import vm from "node:vm";
import { applyNotify, PushStore, toBase64Url } from "../notify/host.js";

const NEW_ORIGIN = "https://app.example:8446";
const OLD_ORIGIN = "https://app.example:8444";
const INTERNAL_ORIGIN = "http://127.0.0.1:3207";
const WAIT_MS = 40;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/**
 * Remove only a throwaway directory this test file created with `mkdtemp`.
 *
 * `rmSync` is recursive, so verify the target twice before touching it: the
 * resolved directory must sit directly under the OS tmpdir and keep the
 * `rdsh-issues-notify-` prefix `mkdtemp` generated. Anything else (a user
 * directory, a symlinked path, a vanished temp dir) is left alone.
 */
function removeTemporaryHome(home) {
	try {
		if (typeof home !== "string" || home === "") return;
		const root = realpathSync(tmpdir());
		const target = realpathSync(home);
		if (dirname(target) !== root) return;
		if (!basename(target).startsWith("rdsh-issues-notify-")) return;
		if (!lstatSync(target).isDirectory()) return;
		rmSync(target, { recursive: true, force: true });
	} catch {
		/* already removed, or never created: nothing to clean */
	}
}

/** A throwaway home with an empty push store; the env and directory go after. */
function withHome(run) {
	return async () => {
		const home = mkdtempSync(join(tmpdir(), "rdsh-issues-notify-"));
		const previous = process.env.DSH_HOME;
		process.env.DSH_HOME = home;
		try {
			await run(home, join(home, "dsh-mobile-maxxing", "push.json"));
		} finally {
			if (previous === undefined) delete process.env.DSH_HOME;
			else process.env.DSH_HOME = previous;
			removeTemporaryHome(home);
		}
	};
}

/** A browser-shaped subscription for one push endpoint. */
function subscription(endpoint) {
	const ecdh = createECDH("prime256v1");
	ecdh.generateKeys();
	return {
		endpoint,
		keys: { p256dh: toBase64Url(ecdh.getPublicKey()), auth: toBase64Url(randomBytes(16)) },
	};
}

/** A seed subscription already stored under one origin. */
function seed(file, endpoint, origin) {
	const store = new PushStore(file);
	store.add(subscription(endpoint), { label: "seed", origin });
	return store;
}

/**
 * One plugin process: its own routes, listeners and `ownOrigins` set, all
 * reading the shared state file through `DSH_HOME`.
 */
function makeInstance({ getOrigin = INTERNAL_ORIGIN } = {}) {
	const listeners = new Map();
	const routes = new Map();
	const agentsById = new Map();
	const roots = [];
	const agents = {
		get: (id) => agentsById.get(id),
		roots: () => roots,
	};
	const services = {
		agents,
		connection: { requestRejection: () => undefined },
		webServer: {
			register(route) {
				routes.set(route.path, route);
				return () => routes.delete(route.path);
			},
			tapIndex() {
				return () => {};
			},
			getOrigin: () => getOrigin,
		},
	};
	const scope = {
		...services,
		get: (name) => services[name],
		on(event, handler) {
			listeners.set(event, handler);
			return () => listeners.delete(event);
		},
		effect(fn) {
			const dispose = fn();
			return typeof dispose === "function" ? dispose : () => {};
		},
	};
	const ctx = {
		inject(deps, callback) {
			return callback(scope);
		},
		get: (name) => services[name],
		on(event, handler) {
			listeners.set(event, handler);
			return () => {};
		},
		effect: (fn) => scope.effect(fn),
	};
	applyNotify(ctx, { onlyMobileTurns: true });
	return {
		listeners,
		routes,
		addRoot(id) {
			const agent = { id, header: { cwd: "/tmp/qa" }, session: { id, header: { cwd: "/tmp/qa" } } };
			agentsById.set(id, agent);
			roots.push(agent);
			return agent;
		},
	};
}

/** Call one registered route with an optional browser origin. */
async function request(instance, path, { method = "POST", body, origin, referer } = {}) {
	const route = instance.routes.get(path);
	assert.ok(route !== undefined, `${path} is registered`);
	const text = body === undefined ? "" : JSON.stringify(body);
	const req = Readable.from(text === "" ? [] : [Buffer.from(text)]);
	req.method = method;
	req.url = path;
	req.headers = {};
	if (origin !== undefined) req.headers.origin = origin;
	if (referer !== undefined) req.headers.referer = referer;
	let status = 0;
	let responseBody = "";
	await route.handler(req, {
		writeHead(code) {
			status = code;
		},
		end(chunk) {
			if (typeof chunk === "string") responseBody += chunk;
		},
	});
	let json = null;
	try {
		json = responseBody === "" ? null : JSON.parse(responseBody);
	} catch {
		/* the status is what matters when a route answers plain text */
	}
	return { status, json };
}

/** Let the fire-and-forget `fanOut` promises settle. */
function settle() {
	return new Promise((resolve) => setTimeout(resolve, WAIT_MS));
}

/** Fire the plugin's session event for a turn. */
function turn(instance, id, type) {
	const listener = instance.listeners.get("session/event");
	assert.ok(listener !== undefined, "the session listener is mounted");
	listener({ id }, { type, data: { reason: { kind: "completed" } } });
}

/** Fire the plugin's question listener. */
function question(instance, id) {
	const listener = instance.listeners.get("user-questions/request");
	assert.ok(listener !== undefined, "the question listener is mounted");
	listener({
		agent: { id, session: { id, header: { cwd: "/tmp/qa" } } },
		questions: [{ header: "Confirm", question: "Continue?" }],
	}, () => {});
}

/** Replace global fetch and record every push endpoint it is asked to hit. */
function withFetch(handler) {
	const previous = globalThis.fetch;
	const calls = [];
	globalThis.fetch = async (url) => {
		const target = String(url);
		calls.push(target);
		return handler(target);
	};
	return { calls, restore: () => { globalThis.fetch = previous; } };
}

// ---------------------------------------------------------------------------
// #28: two stores, one DSH_HOME
// ---------------------------------------------------------------------------

test("sequential writes from independent stores preserve existing subscriptions", withHome(async (home, file) => {
	// Two store instances alternate writes over the same file. This covers the
	// sequential interleaving that reload-before-save handles; it does NOT
	// claim two processes writing concurrently are safe. The read-modify-write
	// window between another process's reload and save is a documented risk,
	// not something this test can rule out.
	mkdirSync(dirname(file), { recursive: true });
	const first = new PushStore(file);
	const second = new PushStore(file);

	const phone = subscription("https://web.push.apple.com/phone");
	const old = subscription("https://web.push.apple.com/old");
	const desktop = subscription("https://web.push.apple.com/desktop");

	first.add(phone, { origin: NEW_ORIGIN });
	second.add(old, { origin: OLD_ORIGIN });
	// Re-reading before the third write is what keeps the second store's
	// entry: a blind save would drop it.
	first.add(desktop, { origin: NEW_ORIGIN });

	assert.deepEqual(
		second.subscriptions().map((item) => item.endpoint).sort(),
		[phone.endpoint, old.endpoint, desktop.endpoint].sort(),
		"a later write erased a subscription the other store had written",
	);
	assert.equal(
		first.keys().publicKey,
		second.keys().publicKey,
		"the shared store must present one VAPID key to every instance",
	);

	// Removing through one store is visible to the other without a restart.
	second.remove(old.endpoint);
	assert.deepEqual(
		first.subscriptions().map((item) => item.endpoint).sort(),
		[phone.endpoint, desktop.endpoint].sort(),
		"a removal made by the other store was not picked up",
	);
	assert.equal(home, process.env.DSH_HOME, "the test ran against its throwaway home");
}));

test("a subscribe without body.origin falls back to the request origin", withHome(async (home, file) => {
	mkdirSync(dirname(file), { recursive: true });
	const newApp = makeInstance();
	const oldApp = makeInstance();
	const phone = subscription("https://web.push.apple.com/phone");
	const old = subscription("https://web.push.apple.com/old");

	// Defensive fallback, not a known client regression: every current and
	// known legacy client sends `body.origin`. A hand-rolled request or a
	// future client that omits it still has the browser's Origin header, so
	// the entry stays addressable by origin-scoped routing.
	assert.equal(
		(await request(newApp, "/api/dsh-mobile-maxxing/push/subscribe", { body: { subscription: phone, label: "phone" }, origin: NEW_ORIGIN })).status,
		200,
	);
	assert.equal(
		(await request(oldApp, "/api/dsh-mobile-maxxing/push/subscribe", { body: { subscription: old, label: "old" }, origin: OLD_ORIGIN })).status,
		200,
	);

	const stored = new PushStore(file).subscriptions();
	assert.deepEqual(
		stored.map((item) => [item.endpoint, item.origin]).sort(),
		[[phone.endpoint, NEW_ORIGIN], [old.endpoint, OLD_ORIGIN]].sort(),
		"an origin-less subscribe was stored as a legacy, unroutable entry",
	);

	const fetchRecorder = withFetch(() => ({ status: 201, ok: true }));
	try {
		fetchRecorder.calls.length = 0;
		assert.equal((await request(newApp, "/api/dsh-mobile-maxxing/push/test", { body: {}, origin: NEW_ORIGIN })).status, 200);
		await settle();
		assert.deepEqual(fetchRecorder.calls, [phone.endpoint], "the new app's test push reached the wrong app or none");

		fetchRecorder.calls.length = 0;
		assert.equal((await request(oldApp, "/api/dsh-mobile-maxxing/push/test", { body: {}, origin: OLD_ORIGIN })).status, 200);
		await settle();
		assert.deepEqual(fetchRecorder.calls, [old.endpoint], "the old app's test push reached the wrong app or none");

		// No usable origin and no request-derived origin either: the historical
		// all-subscriptions fallback must stay, or a background notification is
		// dropped (#27). Use a third process that has seen no request, because
		// `newApp` already learned its origin above.
		const coldApp = makeInstance();
		fetchRecorder.calls.length = 0;
		assert.equal((await request(coldApp, "/api/dsh-mobile-maxxing/push/test", { body: {} })).status, 200);
		await settle();
		assert.deepEqual(fetchRecorder.calls.sort(), [phone.endpoint, old.endpoint].sort(), "the unknown-origin fallback was silently suppressed");
	} finally {
		fetchRecorder.restore();
	}
	assert.equal(home, process.env.DSH_HOME);
}));

test("an explicit body.origin wins over a proxy's inner request origin", withHome(async (home, file) => {
	mkdirSync(dirname(file), { recursive: true });
	const app = makeInstance();
	const phone = subscription("https://web.push.apple.com/phone");

	// A reverse proxy (or the host's own --public-url setup) can present the
	// inner http origin in Origin/Referer while the page still reports the
	// public https origin in the body. Overwriting the body with the header
	// would store the wrong owner and misroute later pushes.
	const registered = await request(app, "/api/dsh-mobile-maxxing/push/subscribe", {
		body: { subscription: phone, label: "proxy", origin: NEW_ORIGIN },
		origin: INTERNAL_ORIGIN,
	});
	assert.equal(registered.status, 200);

	const stored = new PushStore(file).subscriptions();
	assert.deepEqual(
		stored.map((item) => [item.endpoint, item.origin]),
		[[phone.endpoint, NEW_ORIGIN]],
		"the inner proxy origin overwrote the page's public origin",
	);

	const fetchRecorder = withFetch(() => ({ status: 201, ok: true }));
	try {
		assert.equal((await request(app, "/api/dsh-mobile-maxxing/push/test", { body: {}, origin: NEW_ORIGIN })).status, 200);
		await settle();
		assert.deepEqual(fetchRecorder.calls, [phone.endpoint], "the public-origin test push could not find the subscription");
	} finally {
		fetchRecorder.restore();
	}
	assert.equal(home, process.env.DSH_HOME);
}));

test("a new subscription with a non-canonical origin still receives exact-origin pushes", withHome(async (home, file) => {
	mkdirSync(dirname(file), { recursive: true });
	const app = makeInstance();
	const slash = subscription("https://web.push.apple.com/slash-new");
	const defaultPort = subscription("https://web.push.apple.com/default-port-new");

	// The body origin is valid but not canonical (`/` or an explicit `:443`).
	// Storing it verbatim would miss exact-origin routing, which compares
	// against the request's normalized URL.origin.
	assert.equal(
		(await request(app, "/api/dsh-mobile-maxxing/push/subscribe", {
			body: { subscription: slash, label: "slash", origin: `${NEW_ORIGIN}/` },
			origin: INTERNAL_ORIGIN,
		})).status,
		200,
	);
	assert.equal(
		(await request(app, "/api/dsh-mobile-maxxing/push/subscribe", {
			body: { subscription: defaultPort, label: "port", origin: "https://app.example:443" },
			origin: INTERNAL_ORIGIN,
		})).status,
		200,
	);

	assert.deepEqual(
		new PushStore(file).subscriptions().map((item) => [item.endpoint, item.origin]).sort(),
		[[slash.endpoint, NEW_ORIGIN], [defaultPort.endpoint, "https://app.example"]].sort(),
		"a non-canonical origin was stored verbatim",
	);

	const fetchRecorder = withFetch(() => ({ status: 201, ok: true }));
	try {
		assert.equal((await request(app, "/api/dsh-mobile-maxxing/push/test", { body: {}, origin: NEW_ORIGIN })).status, 200);
		await settle();
		assert.deepEqual(fetchRecorder.calls, [slash.endpoint], "the trailing-slash subscription was not delivered to");

		fetchRecorder.calls.length = 0;
		assert.equal((await request(app, "/api/dsh-mobile-maxxing/push/test", { body: {}, origin: "https://app.example" })).status, 200);
		await settle();
		assert.deepEqual(fetchRecorder.calls, [defaultPort.endpoint], "the :443 subscription was not delivered to");
	} finally {
		fetchRecorder.restore();
	}

	// An origin that cannot be parsed is kept as text for compatibility.
	const unusual = subscription("https://web.push.apple.com/unusual");
	new PushStore(file).add(unusual, { origin: "not an origin" });
	assert.equal(
		new PushStore(file).subscriptions().find((item) => item.endpoint === unusual.endpoint).origin,
		"not an origin",
		"an unparsable origin was rewritten or dropped",
	);
	assert.equal(home, process.env.DSH_HOME);
}));

// ---------------------------------------------------------------------------
// #27: startup before config, known origins, unknown fallback
// ---------------------------------------------------------------------------

test("before any page talks to a process, a question keeps the all-subscriptions fallback", withHome(async (home, file) => {
	mkdirSync(dirname(file), { recursive: true });
	const phone = subscription("https://web.push.apple.com/phone");
	const old = subscription("https://web.push.apple.com/old");
	seed(file, phone.endpoint, NEW_ORIGIN);
	seed(file, old.endpoint, OLD_ORIGIN);

	const newApp = makeInstance();
	const oldApp = makeInstance();
	newApp.addRoot("session-1");
	oldApp.addRoot("session-1");

	const fetchRecorder = withFetch(() => ({ status: 201, ok: true }));
	try {
		// No /config, /vapid, /test or mobile-send has arrived yet: neither
		// process knows its own origin. Today both subscriptions receive the
		// question. That is the hole issue #27 describes; the test pins the
		// current intention instead of turning it into a silent drop.
		question(newApp, "session-1");
		await settle();
		assert.deepEqual(
			fetchRecorder.calls.sort(),
			[phone.endpoint, old.endpoint].sort(),
			"the startup fallback changed without a product decision",
		);

		// A boot-time /config is what fixes it for the requesting process.
		assert.equal((await request(newApp, "/api/dsh-mobile-maxxing/push/config", { method: "GET", origin: NEW_ORIGIN })).status, 200);
		fetchRecorder.calls.length = 0;
		question(newApp, "session-1");
		await settle();
		assert.deepEqual(fetchRecorder.calls, [phone.endpoint], "the learned origin did not scope the question");

		// The other process has still seen no request, so its own question
		// keeps the fallback. Origins must not leak between processes that
		// share DSH_HOME.
		fetchRecorder.calls.length = 0;
		question(oldApp, "session-1");
		await settle();
		assert.deepEqual(
			fetchRecorder.calls.sort(),
			[phone.endpoint, old.endpoint].sort(),
			"one process adopted the other process's origin",
		);

		assert.equal((await request(oldApp, "/api/dsh-mobile-maxxing/push/config", { method: "GET", origin: OLD_ORIGIN })).status, 200);
		fetchRecorder.calls.length = 0;
		question(oldApp, "session-1");
		await settle();
		assert.deepEqual(fetchRecorder.calls, [old.endpoint], "the second process's learned origin is not honoured");
	} finally {
		fetchRecorder.restore();
	}
	assert.equal(home, process.env.DSH_HOME);
}));

test("a phone turn only notifies the app that started it, even with the other app configured", withHome(async (home, file) => {
	mkdirSync(dirname(file), { recursive: true });
	const phone = subscription("https://web.push.apple.com/phone");
	const old = subscription("https://web.push.apple.com/old");
	seed(file, phone.endpoint, NEW_ORIGIN);
	seed(file, old.endpoint, OLD_ORIGIN);

	const newApp = makeInstance();
	const oldApp = makeInstance();
	newApp.addRoot("session-1");
	oldApp.addRoot("session-1");
	await request(newApp, "/api/dsh-mobile-maxxing/push/config", { method: "GET", origin: NEW_ORIGIN });
	await request(oldApp, "/api/dsh-mobile-maxxing/push/config", { method: "GET", origin: OLD_ORIGIN });

	const fetchRecorder = withFetch(() => ({ status: 201, ok: true }));
	try {
		assert.equal(
			(await request(newApp, "/api/dsh-mobile-maxxing/push/mobile-send", { body: { sessionId: "session-1" }, origin: NEW_ORIGIN })).status,
			200,
		);
		turn(newApp, "session-1", "turn/start");
		turn(newApp, "session-1", "turn/end");
		await settle();
		assert.deepEqual(fetchRecorder.calls, [phone.endpoint], "turn-end was pushed to the other app as well");

		// A question in that session keeps following the turn's origin.
		fetchRecorder.calls.length = 0;
		question(newApp, "session-1");
		await settle();
		assert.deepEqual(fetchRecorder.calls, [phone.endpoint], "the question did not follow the turn origin");

		// A desktop turn stays silent under the default onlyMobileTurns.
		fetchRecorder.calls.length = 0;
		turn(oldApp, "session-1", "turn/start");
		turn(oldApp, "session-1", "turn/end");
		await settle();
		assert.deepEqual(fetchRecorder.calls, [], "a desktop turn was notified even though onlyMobileTurns is true");
	} finally {
		fetchRecorder.restore();
	}
	assert.equal(home, process.env.DSH_HOME);
}));

// ---------------------------------------------------------------------------
// #28: unsubscribe and dead-subscription pruning
// ---------------------------------------------------------------------------

test("unsubscribe drops only that endpoint; 404/410 prune retired ones", withHome(async (home, file) => {
	mkdirSync(dirname(file), { recursive: true });
	const liveNew = subscription("https://web.push.apple.com/live-new");
	const liveOld = subscription("https://web.push.apple.com/live-old");
	const gone410 = subscription("https://web.push.apple.com/gone-410");
	const gone404 = subscription("https://web.push.apple.com/gone-404");
	seed(file, liveNew.endpoint, NEW_ORIGIN);
	seed(file, liveOld.endpoint, OLD_ORIGIN);
	seed(file, gone410.endpoint, NEW_ORIGIN);
	seed(file, gone404.endpoint, NEW_ORIGIN);

	const newApp = makeInstance();
	const oldApp = makeInstance();

	const fetchRecorder = withFetch((url) => {
		if (url.endsWith("/gone-410")) return { status: 410, ok: false };
		if (url.endsWith("/gone-404")) return { status: 404, ok: false };
		return { status: 201, ok: true };
	});
	try {
		// One app cannot retire the other app's subscription even if it names
		// the endpoint: the store is shared, so the delete is origin-scoped.
		const crossOrigin = await request(oldApp, "/api/dsh-mobile-maxxing/push/unsubscribe", {
			body: { endpoint: liveNew.endpoint },
			origin: OLD_ORIGIN,
		});
		assert.equal(crossOrigin.status, 200);
		assert.equal(crossOrigin.json.removed, false, "the old app deleted the new app's subscription");
		assert.equal(
			new PushStore(file).subscriptions().some((item) => item.endpoint === liveNew.endpoint),
			true,
			"a cross-origin unsubscribe pruned a live subscription",
		);

		// Unsubscribing the new app's own endpoint must leave the old app's
		// subscription untouched (they share one file).
		const removed = await request(newApp, "/api/dsh-mobile-maxxing/push/unsubscribe", {
			body: { endpoint: liveNew.endpoint },
			origin: NEW_ORIGIN,
		});
		assert.equal(removed.status, 200);
		assert.equal(removed.json.removed, true);
		assert.deepEqual(
			new PushStore(file).subscriptions().map((item) => item.endpoint).sort(),
			[liveOld.endpoint, gone410.endpoint, gone404.endpoint].sort(),
			"unsubscribe removed something other than the named endpoint",
		);

		// A push to a retired endpoint is the only signal the host gets when
		// an app is deleted without calling /unsubscribe. 404/410 must prune
		// that endpoint and still report the live one.
		const testPush = await request(newApp, "/api/dsh-mobile-maxxing/push/test", { body: {}, origin: NEW_ORIGIN });
		assert.equal(testPush.status, 200);
		await settle();
		assert.deepEqual(
			fetchRecorder.calls.sort(),
			[gone410.endpoint, gone404.endpoint].sort(),
			"the live new-app subscription is missing or the retired ones were skipped",
		);
		const statuses = (testPush.json.results ?? []).map((item) => item.status).sort((a, b) => a - b);
		assert.deepEqual(statuses, [404, 410], "the prune results do not surface the push-service status");
		assert.deepEqual(
			new PushStore(file).subscriptions().map((item) => item.endpoint).sort(),
			[liveOld.endpoint].sort(),
			"404/410 subscriptions were not pruned from the shared store",
		);

		// The other app still receives its own notification afterwards.
		fetchRecorder.calls.length = 0;
		assert.equal((await request(oldApp, "/api/dsh-mobile-maxxing/push/test", { body: {}, origin: OLD_ORIGIN })).status, 200);
		await settle();
		assert.deepEqual(fetchRecorder.calls, [liveOld.endpoint], "pruning in one app broke the other app's delivery");

		// A subscription written before origins existed must still be
		// removable, or an upgrade can never clean it up.
		const legacy = subscription("https://web.push.apple.com/legacy");
		new PushStore(file).add(legacy, {});
		const cleaned = await request(newApp, "/api/dsh-mobile-maxxing/push/unsubscribe", {
			body: { endpoint: legacy.endpoint },
			origin: NEW_ORIGIN,
		});
		assert.equal(cleaned.json.removed, true, "a legacy origin-less subscription can no longer be removed");
		assert.equal(new PushStore(file).subscriptions().some((item) => item.endpoint === legacy.endpoint), false);

		// Older entries may carry a trailing slash or an explicit default port.
		// Their own app must still be able to remove them; normalization must
		// not make a same-origin comparison fail.
		const slash = subscription("https://web.push.apple.com/slash");
		new PushStore(file).add(slash, { origin: `${NEW_ORIGIN}/` });
		const slashRemoved = await request(newApp, "/api/dsh-mobile-maxxing/push/unsubscribe", {
			body: { endpoint: slash.endpoint },
			origin: NEW_ORIGIN,
		});
		assert.equal(slashRemoved.json.removed, true, "a trailing-slash origin cannot remove its own subscription");

		const defaultPort = subscription("https://web.push.apple.com/default-port");
		new PushStore(file).add(defaultPort, { origin: "https://app.example:443" });
		const portRemoved = await request(newApp, "/api/dsh-mobile-maxxing/push/unsubscribe", {
			body: { endpoint: defaultPort.endpoint },
			origin: "https://app.example",
		});
		assert.equal(portRemoved.json.removed, true, "an explicit default port cannot remove its own subscription");

		// Normalization must not blur two different origins.
		const otherSlash = subscription("https://web.push.apple.com/other-slash");
		new PushStore(file).add(otherSlash, { origin: `${OLD_ORIGIN}/` });
		const crossSlash = await request(newApp, "/api/dsh-mobile-maxxing/push/unsubscribe", {
			body: { endpoint: otherSlash.endpoint },
			origin: NEW_ORIGIN,
		});
		assert.equal(crossSlash.json.removed, false, "normalizing a trailing slash crossed the origin boundary");
		assert.equal(new PushStore(file).subscriptions().some((item) => item.endpoint === otherSlash.endpoint), true);
	} finally {
		fetchRecorder.restore();
	}
	assert.equal(home, process.env.DSH_HOME);
}));

// ---------------------------------------------------------------------------
// #28: service-worker cache isolation assumptions
// ---------------------------------------------------------------------------

const SW_SOURCE = readFileSync(new URL("../sw.js", import.meta.url), "utf8");

class FakeCache {
	constructor(origin, name) {
		this.origin = origin;
		this.name = name;
		this.entries = new Map();
	}

	key(request) {
		return typeof request === "string" ? new URL(request, this.origin).href : request.url;
	}

	async put(request, response) {
		this.entries.set(this.key(request), response);
	}

	async match(request) {
		return this.entries.get(this.key(request));
	}

	async keys() {
		return [...this.entries.keys()].map((url) => ({ url }));
	}

	async delete(request) {
		return this.entries.delete(this.key(request));
	}
}

/** The browser gives every origin its own CacheStorage; model exactly that. */
class FakeCacheStorage {
	constructor(origin) {
		this.origin = origin;
		this.caches = new Map();
	}

	async open(name) {
		let cache = this.caches.get(name);
		if (cache === undefined) {
			cache = new FakeCache(this.origin, name);
			this.caches.set(name, cache);
		}
		return cache;
	}

	async keys() {
		return [...this.caches.keys()];
	}

	async delete(name) {
		return this.caches.delete(name);
	}
}

/** Load sw.js into a sandbox that looks like one service-worker global. */
function loadServiceWorker({ origin, build = "build-a", cacheStorage, network = "ok" }) {
	const listeners = new Map();
	const self = {
		registration: { scope: `${origin}/`, showNotification: async () => {} },
		location: { origin },
		clients: { matchAll: async () => [], claim: async () => {} },
		addEventListener(type, handler) {
			listeners.set(type, handler);
		},
		skipWaiting() {},
		__RDSH_PWA_BUILD__: build,
		__RDSH_PWA_CONFIG__: {},
	};
	const context = {
		self,
		caches: cacheStorage,
		URL,
		Response: class {
			static error() {
				return { error: true };
			}
		},
		fetch: async (url) => {
			if (network !== "ok") throw new Error("network down");
			return { ok: true, type: "basic", clone() { return this; }, url: String(url) };
		},
		console,
		setTimeout,
		clearTimeout,
	};
	vm.createContext(context);
	new vm.Script(SW_SOURCE, { filename: "sw.js" }).runInContext(context);
	return { listeners, self };
}

/** Run one lifecycle event and wait for its work. */
async function fire(listeners, type) {
	const work = [];
	const listener = listeners.get(type);
	assert.ok(listener !== undefined, `the ${type} listener is mounted`);
	listener({ waitUntil(promise) { work.push(promise); } });
	await Promise.all(work);
}

/** A request-like object the worker's fetch handler understands. */
function fetchEvent(url, { method = "GET", mode = "no-cors", cache = "default", range = null } = {}) {
	return {
		request: {
			url,
			method,
			mode,
			cache,
			headers: { get: (name) => (name === "range" ? range : null) },
		},
		respondWith(promise) {
			this.responded = true;
			this.response = promise;
		},
	};
}

test("the worker never intercepts another origin or live state", () => {
	const origin = "https://app.example:8446";
	const storage = new FakeCacheStorage(origin);
	const { listeners } = loadServiceWorker({ origin, cacheStorage: storage });

	const crossOrigin = fetchEvent("https://other.example/assets/app.js");
	listeners.get("fetch")(crossOrigin);
	assert.notEqual(crossOrigin.responded, true, "a cross-origin request must stay with the browser");

	const api = fetchEvent(`${origin}/api/dsh-mobile-maxxing/push/config`);
	listeners.get("fetch")(api);
	assert.notEqual(api.responded, true, "live API state must never be served from cache");

	const hmr = fetchEvent(`${origin}/hmr/client.js`);
	listeners.get("fetch")(hmr);
	assert.notEqual(hmr.responded, true, "HMR must not be intercepted");

	const post = fetchEvent(`${origin}/assets/app.js`, { method: "POST" });
	listeners.get("fetch")(post);
	assert.notEqual(post.responded, true, "only GET is cacheable");

	const ranged = fetchEvent(`${origin}/assets/app.js`, { range: "bytes=0-10" });
	listeners.get("fetch")(ranged);
	assert.notEqual(ranged.responded, true, "a ranged asset must reach the server");

	const asset = fetchEvent(`${origin}/assets/app.js`);
	listeners.get("fetch")(asset);
	assert.equal(asset.responded, true, "a same-origin static asset should use the cache path");

	const navigation = fetchEvent(`${origin}/`, { mode: "navigate" });
	listeners.get("fetch")(navigation);
	assert.equal(navigation.responded, true, "a navigation should use the shell path");
});

test("install seeds the shell and activate retires only this app's stale builds", async () => {
	const origin = "https://app.example:8446";
	const storage = new FakeCacheStorage(origin);
	// A previous build of this app, plus a cache that belongs to something
	// else on the same origin.
	await storage.open("dsh-mobile-maxxing-previous");
	await storage.open("someone-elses-cache");
	const { listeners } = loadServiceWorker({ origin, cacheStorage: storage });

	await fire(listeners, "install");
	assert.deepEqual(
		(await storage.keys()).sort(),
		["dsh-mobile-maxxing-build-a", "dsh-mobile-maxxing-previous", "someone-elses-cache"].sort(),
	);
	const shell = await (await storage.open("dsh-mobile-maxxing-build-a")).keys();
	assert.deepEqual(
		shell.map((item) => item.url).sort(),
		[`${origin}/`, `${origin}/manifest.webmanifest`].sort(),
		"the offline shell and manifest are not cached under the scope",
	);

	await fire(listeners, "activate");
	assert.deepEqual(
		(await storage.keys()).sort(),
		["dsh-mobile-maxxing-build-a", "someone-elses-cache"].sort(),
		"activate did not retire the previous build, or it deleted a foreign cache",
	);
});

test("two origins keep independent caches and cannot share entries", async () => {
	// CacheStorage is origin-scoped in the browser, so this models two
	// deployments of the same build: 8444 (old app) and 8446 (new app).
	//
	// Known limit, not fixed here: two instances served from the SAME origin
	// under different sub-paths share one CacheStorage, and `activate` retires
	// every `dsh-mobile-maxxing-*` cache it finds there. #28's two apps are distinct
	// origins (the supported case); the same-origin sub-path deployment is
	// recorded as a risk in the handoff rather than guessed at.
	const oldOrigin = "https://app.example:8444";
	const newOrigin = "https://app.example:8446";
	const oldStorage = new FakeCacheStorage(oldOrigin);
	const newStorage = new FakeCacheStorage(newOrigin);
	const oldWorker = loadServiceWorker({ origin: oldOrigin, build: "build-a", cacheStorage: oldStorage });
	const newWorker = loadServiceWorker({ origin: newOrigin, build: "build-a", cacheStorage: newStorage });

	await fire(oldWorker.listeners, "install");
	await fire(newWorker.listeners, "install");
	await oldStorage.open("dsh-mobile-maxxing-stale-old");
	await newStorage.open("dsh-mobile-maxxing-stale-new");

	await fire(newWorker.listeners, "activate");
	assert.deepEqual(
		(await newStorage.keys()).sort(),
		["dsh-mobile-maxxing-build-a"].sort(),
		"the new origin's activation did not clean its own stale build",
	);
	// The old origin is a different CacheStorage: nothing the new worker did
	// can retire (or otherwise touch) either of its caches.
	assert.deepEqual(
		(await oldStorage.keys()).sort(),
		["dsh-mobile-maxxing-build-a", "dsh-mobile-maxxing-stale-old"].sort(),
		"activating one origin deleted the other origin's cache",
	);

	const oldPaths = (await (await oldStorage.open("dsh-mobile-maxxing-build-a")).keys()).map((item) => item.url);
	const newPaths = (await (await newStorage.open("dsh-mobile-maxxing-build-a")).keys()).map((item) => item.url);
	assert.ok(oldPaths.every((url) => url.startsWith(oldOrigin)), "an old-app cache entry points at another origin");
	assert.ok(newPaths.every((url) => url.startsWith(newOrigin)), "a new-app cache entry points at another origin");
});

test("an offline launch falls back to the cached shell, not the network error", async () => {
	const origin = "https://app.example:8446";
	const storage = new FakeCacheStorage(origin);
	const worker = loadServiceWorker({ origin, cacheStorage: storage });
	await fire(worker.listeners, "install");

	// Same worker, now offline: re-loading the module would drop the cache,
	// so the second instance shares the storage object but fails every fetch.
	const offline = loadServiceWorker({ origin, cacheStorage: storage, network: "down" });
	const navigation = fetchEvent(`${origin}/`, { mode: "navigate" });
	offline.listeners.get("fetch")(navigation);
	assert.equal(navigation.responded, true, "the navigation was not handled at all");
	const response = await navigation.response;
	assert.notEqual(response?.error, true, "the offline launch fell through to Response.error() despite a cached shell");
});
