/**
 * rdsh-pwa — notifications, host half.
 *
 * Web Push written directly against the RFCs on `node:crypto` alone:
 *
 *   - RFC 8292 — VAPID: an ES256 JWT in the `Authorization` header.
 *   - RFC 8291 — the `aes128gcm` payload: ECDH + HKDF + AES-128-GCM.
 *   - RFC 8188 — the record framing that carries the ciphertext.
 *
 * No push library is involved, so the package installs nothing beyond DSH
 * itself. The HTTP shape (`/api/rdsh-pwa/push/...`) and the service-worker
 * message contract are this package's own; the plugin this replaces
 * (`dsh-notify-push`) is credited in README.md as the reference for the
 * overall design, not as a source of code.
 *
 * @module rdsh-pwa/notify/host
 */
import {
	createCipheriv,
	createECDH,
	createPrivateKey,
	generateKeyPairSync,
	hkdfSync,
	randomBytes,
	sign,
} from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

/** How long a push stays queued when the phone is offline. */
const PUSH_TTL_SECONDS = 600;
/** VAPID tokens are short-lived on purpose; 12h is the common ceiling. */
const VAPID_TTL_SECONDS = 12 * 60 * 60;
/** A subscription older than this without a successful send is dropped. */
const MAX_SUBSCRIPTIONS = 32;

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

/** base64url without padding, the encoding every part of Web Push uses. */
export function toBase64Url(buffer) {
	return Buffer.from(buffer).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** Inverse of {@link toBase64Url}. */
export function fromBase64Url(text) {
	const padded = String(text).replace(/-/g, "+").replace(/_/g, "/");
	return Buffer.from(padded + "=".repeat((4 - (padded.length % 4)) % 4), "base64");
}

/** Write a file so a crash cannot leave a half-written state behind. */
function writeJsonAtomically(file, value) {
	mkdirSync(dirname(file), { recursive: true });
	const temporary = `${file}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(value, null, "\t")}\n`, { mode: 0o600 });
	renameSync(temporary, file);
}

/** Read JSON, or the fallback when the file is absent or unreadable. */
function readJson(file, fallback) {
	try {
		return JSON.parse(readFileSync(file, "utf8"));
	} catch {
		return fallback;
	}
}

/** Where this package keeps its state. `DSH_HOME` wins when it is set. */
export function stateDirectory() {
	const home = typeof process.env.DSH_HOME === "string" && process.env.DSH_HOME !== ""
		? process.env.DSH_HOME
		: join(homedir(), ".dsh");
	return join(home, "rdsh-pwa");
}

// ---------------------------------------------------------------------------
// VAPID (RFC 8292)
// ---------------------------------------------------------------------------

/**
 * Create the long-lived VAPID key pair.
 *
 * @returns {{publicKey: string, privateKey: string}} base64url uncompressed
 *   point for the browser, and a PKCS#8 PEM for signing.
 */
export function generateVapidKeys() {
	const { publicKey, privateKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
	// The browser wants the raw point (0x04 || X || Y); SPKI ends with it.
	const spki = publicKey.export({ type: "spki", format: "der" });
	return {
		publicKey: toBase64Url(spki.subarray(spki.length - 65)),
		privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
	};
}

/**
 * Build the `Authorization` header value for one push service origin.
 *
 * @param {object} options
 * @param {{publicKey: string, privateKey: string}} options.keys - VAPID pair.
 * @param {string} options.audience - push service origin, e.g. `https://web.push.apple.com`.
 * @param {string} options.subject - `mailto:` or `https:` contact for the operator.
 * @param {number} [options.now] - milliseconds since the epoch.
 * @returns {string} `vapid t=<jwt>, k=<public key>`.
 */
export function vapidAuthorization({ keys, audience, subject, now = Date.now() }) {
	const header = toBase64Url(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
	const claims = toBase64Url(Buffer.from(JSON.stringify({
		aud: audience,
		exp: Math.floor(now / 1000) + VAPID_TTL_SECONDS,
		sub: subject,
	})));
	const signingInput = `${header}.${claims}`;
	// JWS wants the raw r||s pair, not the DER wrapper OpenSSL defaults to.
	const signature = sign("sha256", Buffer.from(signingInput), {
		key: createPrivateKey(keys.privateKey),
		dsaEncoding: "ieee-p1363",
	});
	return `vapid t=${signingInput}.${toBase64Url(signature)}, k=${keys.publicKey}`;
}

/** The origin a subscription's endpoint belongs to. */
export function endpointAudience(endpoint) {
	try {
		return new URL(endpoint).origin;
	} catch {
		return "";
	}
}

// ---------------------------------------------------------------------------
// Payload encryption (RFC 8291 + RFC 8188)
// ---------------------------------------------------------------------------

/** The record size advertised in the framing header. */
const RECORD_SIZE = 4096;

/**
 * Encrypt one push payload for one subscription.
 *
 * @param {{keys: {p256dh: string, auth: string}}} subscription - as stored.
 * @param {string|Buffer} plaintext - the JSON the service worker will read.
 * @returns {Buffer} the complete `aes128gcm` body.
 */
export function encryptPushPayload(subscription, plaintext) {
	const userAgentPublic = fromBase64Url(subscription.keys.p256dh);
	const authSecret = fromBase64Url(subscription.keys.auth);

	// A fresh key pair per message: the RFC requires it, and it keeps the
	// ECDH secret one-shot. ECDH speaks the raw uncompressed point that the
	// subscription carries, so no DER wrapping is involved.
	const ephemeral = createECDH("prime256v1");
	ephemeral.generateKeys();
	const asPublic = ephemeral.getPublicKey();
	const sharedSecret = ephemeral.computeSecret(userAgentPublic);

	const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), userAgentPublic, asPublic]);
	const inputKeyMaterial = Buffer.from(hkdfSync("sha256", sharedSecret, authSecret, keyInfo, 32));

	const salt = randomBytes(16);
	const contentEncryptionKey = Buffer.from(hkdfSync(
		"sha256",
		inputKeyMaterial,
		salt,
		Buffer.from("Content-Encoding: aes128gcm\0"),
		16,
	));
	const nonce = Buffer.from(hkdfSync(
		"sha256",
		inputKeyMaterial,
		salt,
		Buffer.from("Content-Encoding: nonce\0"),
		12,
	));

	// One record only: append the 0x02 padding delimiter that marks the last.
	const record = Buffer.concat([Buffer.from(plaintext, "utf8"), Buffer.from([2])]);
	const cipher = createCipheriv("aes-128-gcm", contentEncryptionKey, nonce);
	const ciphertext = Buffer.concat([cipher.update(record), cipher.final(), cipher.getAuthTag()]);

	const header = Buffer.concat([
		salt,
		(() => {
			const size = Buffer.alloc(4);
			size.writeUInt32BE(RECORD_SIZE, 0);
			return size;
		})(),
		Buffer.from([asPublic.length]),
		asPublic,
	]);
	return Buffer.concat([header, ciphertext]);
}

// ---------------------------------------------------------------------------
// Sending
// ---------------------------------------------------------------------------

/**
 * Deliver one push message.
 *
 * @param {object} subscription - `{ endpoint, keys }`.
 * @param {object} payload - JSON-serializable notification.
 * @param {object} options
 * @param {{publicKey: string, privateKey: string}} options.keys - VAPID pair.
 * @param {string} options.subject - VAPID contact.
 * @returns {Promise<{ok: boolean, status: number, gone: boolean}>}
 */
export async function sendWebPush(subscription, payload, { keys, subject }) {
	const audience = endpointAudience(subscription.endpoint);
	if (audience === "") return { ok: false, status: 0, gone: true };

	let body;
	try {
		body = encryptPushPayload(subscription, JSON.stringify(payload));
	} catch {
		// A corrupt or foreign subscription key can never be encrypted for.
		return { ok: false, status: 0, gone: true };
	}

	const response = await fetch(subscription.endpoint, {
		method: "POST",
		headers: {
			authorization: vapidAuthorization({ keys, audience, subject }),
			"content-encoding": "aes128gcm",
			"content-type": "application/octet-stream",
			"content-length": String(body.length),
			ttl: String(PUSH_TTL_SECONDS),
			urgency: "high",
		},
		body,
	});
	// 404 and 410 are the two ways a push service retires a subscription.
	return { ok: response.status >= 200 && response.status < 300, status: response.status, gone: response.status === 404 || response.status === 410 };
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

/**
 * Notification copy and behaviour.
 *
 * Every string is a template. Unknown placeholders survive verbatim so a typo
 * is visible rather than silently dropped.
 */
export const NOTIFY_DEFAULTS = {
	/** Prefix exposed as `{app}`; "" drops it. */
	appName: "DSH",
	/** VAPID contact. "" means "use the app's own origin". */
	subject: "",
	/** Only tell the phone about turns the phone itself started. */
	onlyMobileTurns: true,
	turnEndTitle: "{session}",
	turnEndBody: "{detail}",
	questionTitle: "{session}",
	questionBody: "{question}",
};

/** Merge a profile's notification config over the defaults. */
export function normalizeNotifyConfig(input) {
	const source = input !== null && typeof input === "object" && !Array.isArray(input) ? input : {};
	const output = { ...NOTIFY_DEFAULTS };
	for (const key of Object.keys(NOTIFY_DEFAULTS)) {
		if (typeof source[key] === typeof NOTIFY_DEFAULTS[key]) output[key] = source[key];
	}
	return output;
}

/** Replace `{name}` tokens from a plain map. */
export function fillTemplate(template, values) {
	return String(template).replace(/\{(\w+)\}/g, (match, key) => (key in values ? String(values[key]) : match));
}

/** Title for a turn-end notification. */
export function buildTurnEndPayload(sessionId, reason, context = {}) {
	const kind = typeof reason?.kind === "string" ? reason.kind : "unknown";
	const statuses = {
		completed: "作業完了",
		"max-tokens": "作業完了 (トークン上限)",
		blocked: "停止 (拒否されました)",
		error: "エラーで停止",
		aborted: "停止 (中断)",
	};
	const status = statuses[kind] ?? `ターン終了 (${kind})`;
	const detail = kind === "completed" ? "作業が完了しました。" : `終了理由: ${kind}`;
	const copy = context.copy ?? NOTIFY_DEFAULTS;
	const values = {
		app: copy.appName,
		session: context.session ?? "",
		status,
		detail,
		reason: kind,
		header: status,
		question: "",
		count: "",
	};
	return makePayload(
		sessionId,
		"turn-end",
		fillTemplate(copy.turnEndTitle, values) || fillTemplate(copy.appName === "" ? "{status}" : "{app}: {status}", values),
		fillTemplate(copy.turnEndBody, values),
	);
}

/** Payload for one forwarded question request. */
export function buildQuestionPayload(request, context = {}) {
	const questions = Array.isArray(request?.questions) ? request.questions : [];
	const first = questions[0] ?? {};
	const header = typeof first.header === "string" && first.header !== "" ? first.header : "確認";
	const question = typeof first.question === "string" ? first.question : "";
	const count = questions.length > 1 ? `（他 ${questions.length - 1} 件）` : "";
	const copy = context.copy ?? NOTIFY_DEFAULTS;
	const values = {
		app: copy.appName,
		session: context.session ?? "",
		status: header,
		detail: question,
		reason: "",
		header,
		question,
		count,
	};
	const sessionId = typeof request?.agent?.id === "string" ? request.agent.id : "";
	return makePayload(
		sessionId,
		"question",
		fillTemplate(copy.questionTitle, values) || fillTemplate(copy.appName === "" ? "{header}" : "{app}: {header}", values),
		fillTemplate(copy.questionBody, values),
	);
}

/**
 * One notification payload.
 *
 * `sessionId` rides along so the service worker can tag per session and hand
 * the id back to a live window: the SPA has no URL routing.
 */
export function makePayload(sessionId, kind, title, body) {
	const id = typeof sessionId === "string" ? sessionId : "";
	return {
		title,
		body,
		kind,
		sessionId: id,
		url: id === "" ? "./" : `./?session=${encodeURIComponent(id)}`,
	};
}

// ---------------------------------------------------------------------------
// Store + fan-out
// ---------------------------------------------------------------------------

/** Subscriptions and the VAPID pair, persisted together. */
export class PushStore {
	/**
	 * @param {string} file - JSON file to read and write.
	 */
	constructor(file) {
		this.file = file;
		this.state = readJson(file, null) ?? { vapid: null, subscriptions: [] };
		if (this.state.vapid === null || typeof this.state.vapid.publicKey !== "string") {
			this.state.vapid = generateVapidKeys();
			this.save();
		}
		if (!Array.isArray(this.state.subscriptions)) this.state.subscriptions = [];
	}

	/** Persist the current state. */
	save() {
		writeJsonAtomically(this.file, this.state);
	}

	/** The VAPID pair, generating it on first use. */
	keys() {
		return this.state.vapid;
	}

	/** Every live subscription. */
	subscriptions() {
		return this.state.subscriptions;
	}

	/**
	 * Add or refresh one subscription.
	 *
	 * @param {object} subscription - `{ endpoint, keys }` from the browser.
	 * @param {object} [meta] - `{ label, origin }` for the VAPID contact.
	 * @returns {number} how many subscriptions are stored now.
	 */
	add(subscription, meta = {}) {
		const endpoint = subscription?.endpoint;
		if (typeof endpoint !== "string" || endpoint === "") throw new Error("subscription has no endpoint");
		if (typeof subscription?.keys?.p256dh !== "string" || typeof subscription?.keys?.auth !== "string") {
			throw new Error("subscription has no client keys");
		}
		const entry = {
			endpoint,
			keys: { p256dh: subscription.keys.p256dh, auth: subscription.keys.auth },
			label: typeof meta.label === "string" ? meta.label.slice(0, 120) : "",
			origin: typeof meta.origin === "string" ? meta.origin : "",
			addedAt: Date.now(),
		};
		this.state.subscriptions = [entry, ...this.state.subscriptions.filter((item) => item.endpoint !== endpoint)]
			.slice(0, MAX_SUBSCRIPTIONS);
		this.save();
		return this.state.subscriptions.length;
	}

	/**
	 * Drop one subscription.
	 *
	 * @param {string} endpoint - the endpoint to forget.
	 * @returns {boolean} whether anything was removed.
	 */
	remove(endpoint) {
		const before = this.state.subscriptions.length;
		this.state.subscriptions = this.state.subscriptions.filter((item) => item.endpoint !== endpoint);
		if (this.state.subscriptions.length !== before) this.save();
		return this.state.subscriptions.length !== before;
	}

	/**
	 * The VAPID contact to use.
	 *
	 * Apple rejects `mailto:root@localhost` with 403 BadJwtToken, so an https
	 * origin is the reliable fallback; the newest subscription remembers the
	 * origin the app was served from.
	 *
	 * @param {string} configured - the profile's `subject`, or "".
	 * @returns {string} a `mailto:` or `https:` contact.
	 */
	subject(configured) {
		if (typeof configured === "string" && configured !== "") return configured;
		for (const item of this.state.subscriptions) {
			if (typeof item.origin === "string" && item.origin.startsWith("https://")) return item.origin;
		}
		return "mailto:dsh@example.com";
	}
}

// ---------------------------------------------------------------------------
// Session names
// ---------------------------------------------------------------------------

/**
 * One-line session name for a notification.
 *
 * The title service is the source of truth; before a title exists the session
 * is known by its working directory, which is what the header shows too.
 *
 * @param {object} ctx - plugin context (for the optional title service).
 * @param {object} session - live session.
 * @returns {string} the name, or "" when neither source has one.
 */
export function sessionNameOf(ctx, session) {
	try {
		const title = ctx.sessionTitle?.get(session)?.title;
		if (typeof title === "string" && title.trim() !== "") return title.trim();
	} catch {
		/* the title plugin is optional */
	}
	const cwd = typeof session?.header?.cwd === "string" ? session.header.cwd : "";
	const base = cwd.split("/").filter(Boolean).pop();
	return typeof base === "string" ? base : "";
}

// ---------------------------------------------------------------------------
// Plugin half
// ---------------------------------------------------------------------------

/** Read a request body as UTF-8, refusing anything oversized. */
function readBody(req, limit = 64 * 1024) {
	return new Promise((resolve, reject) => {
		let size = 0;
		const chunks = [];
		req.on("data", (chunk) => {
			size += chunk.length;
			if (size > limit) {
				reject(new Error("body too large"));
				req.destroy();
				return;
			}
			chunks.push(chunk);
		});
		req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
		req.on("error", reject);
	});
}

/** Parse a JSON body, tolerating an empty one. */
async function readJsonBody(req) {
	try {
		const text = await readBody(req);
		return text === "" ? {} : JSON.parse(text);
	} catch {
		return {};
	}
}

/**
 * Mount notifications: routes for the browser half plus the push fan-out.
 *
 * @param {object} ctx - plugin context.
 * @param {object} config - normalized notification config.
 */
export function applyNotify(ctx, config) {
	const store = new PushStore(join(stateDirectory(), "push.json"));
	const copy = normalizeNotifyConfig(config);
	/** Sessions whose next turn was started from the phone. One-shot. */
	const mobileSendAt = new Map();
	/** Whether the turn now running in a session came from the phone. */
	const turnMobile = new Map();

	/** Send one payload to every stored subscription, pruning dead ones. */
	async function fanOut(payload) {
		const subscriptions = store.subscriptions();
		if (subscriptions.length === 0) return { ok: true, results: [] };
		const subject = store.subject(copy.subject);
		const results = [];
		for (const subscription of subscriptions) {
			try {
				const result = await sendWebPush(subscription, payload, { keys: store.keys(), subject });
				results.push({ status: result.status, ok: result.ok });
				if (result.gone) store.remove(subscription.endpoint);
			} catch (error) {
				results.push({ status: 0, ok: false, error: String(error?.message ?? error) });
			}
		}
		return { ok: results.some((item) => item.ok), subject, results };
	}

	ctx.inject(["agents"], (agentCtx) => {
		const agents = agentCtx.get("agents");
		agentCtx.on("session/event", (session, event) => {
			if (event?.type === "turn/start") {
				const at = mobileSendAt.get(session.id);
				const fromPhone = at !== undefined && Date.now() - at < 10 * 60 * 1000;
				if (at !== undefined) mobileSendAt.delete(session.id);
				turnMobile.set(session.id, fromPhone);
				return;
			}
			if (event?.type !== "turn/end") return;
			const fromPhone = turnMobile.get(session.id) === true;
			turnMobile.delete(session.id);
			if (copy.onlyMobileTurns && !fromPhone) return;
			// Root sessions only: a subagent finishing is not news.
			const agent = agents?.get(session.id);
			if (agent === undefined || !agents.roots().includes(agent)) return;
			void fanOut(buildTurnEndPayload(session.id, event.data?.reason, {
				copy,
				session: sessionNameOf(ctx, session),
			})).catch((error) => {
				console.error("[rdsh-pwa] turn-end push failed", error);
			});
		});
		agentCtx.effect(() => agentCtx.on("user-questions/request", function (request, next) {
			// Outermost listener: fire and forget, then let the real answerer run.
			const id = request?.agent?.id;
			const agent = typeof id === "string" ? agents?.get(id) : undefined;
			if (agent !== undefined && agents.roots().includes(agent)) {
				const asking = request?.agent?.session;
				void fanOut(buildQuestionPayload(request, {
					copy,
					session: asking === undefined ? "" : sessionNameOf(ctx, asking),
				})).catch((error) => {
					console.error("[rdsh-pwa] question push failed", error);
				});
			}
			return next();
		}, { prepend: true }), "rdsh-pwa: question push fan-out");
	});

	ctx.inject(["connection", "webServer"], (routeCtx) => {
		const connection = routeCtx.connection;
		const json = (res, status, value) => {
			res.writeHead(status, {
				"content-type": "application/json; charset=utf-8",
				"cache-control": "no-store",
			});
			res.end(JSON.stringify(value));
		};
		/** Refuse anyone the Web server would not have served anyway. */
		const guard = (req, res) => {
			const rejection = connection.requestRejection(req);
			if (rejection === undefined) return true;
			res.writeHead(rejection);
			res.end(rejection === 401 ? "unauthorized" : "forbidden");
			return false;
		};

		const routes = [
			{
				kind: "exact",
				path: "/api/rdsh-pwa/push/vapid",
				handler: (req, res) => {
					if (!guard(req, res)) return;
					json(res, 200, { ok: true, publicKey: store.keys().publicKey, subject: store.subject(copy.subject) });
				},
			},
			{
				kind: "exact",
				path: "/api/rdsh-pwa/push/config",
				handler: (req, res) => {
					if (!guard(req, res)) return;
					// The page renders its own in-app banners, so it needs the
					// same copy the host would have pushed.
					json(res, 200, { ok: true, copy: { ...copy, subject: store.subject(copy.subject) } });
				},
			},
			{
				kind: "exact",
				path: "/api/rdsh-pwa/push/subscribe",
				handler: async (req, res) => {
					if (!guard(req, res)) return;
					if (req.method !== "POST") {
						res.writeHead(405, { allow: "POST" });
						res.end();
						return;
					}
					const body = await readJsonBody(req);
					try {
						const count = store.add(body.subscription, { label: body.label, origin: body.origin });
						json(res, 200, { ok: true, count, subject: store.subject(copy.subject) });
					} catch (error) {
						json(res, 400, { ok: false, error: String(error?.message ?? error) });
					}
				},
			},
			{
				kind: "exact",
				path: "/api/rdsh-pwa/push/unsubscribe",
				handler: async (req, res) => {
					if (!guard(req, res)) return;
					if (req.method !== "POST") {
						res.writeHead(405, { allow: "POST" });
						res.end();
						return;
					}
					const body = await readJsonBody(req);
					const endpoint = typeof body.endpoint === "string" ? body.endpoint : body.subscription?.endpoint;
					const removed = typeof endpoint === "string" ? store.remove(endpoint) : false;
					json(res, 200, { ok: true, removed, count: store.subscriptions().length });
				},
			},
			{
				kind: "exact",
				path: "/api/rdsh-pwa/push/mobile-send",
				handler: async (req, res) => {
					if (!guard(req, res)) return;
					if (req.method !== "POST") {
						res.writeHead(405, { allow: "POST" });
						res.end();
						return;
					}
					const body = await readJsonBody(req);
					if (typeof body.sessionId === "string" && body.sessionId !== "") mobileSendAt.set(body.sessionId, Date.now());
					json(res, 200, { ok: true });
				},
			},
			{
				kind: "exact",
				path: "/api/rdsh-pwa/push/preview",
				handler: (req, res) => {
					if (!guard(req, res)) return;
					// Answers "what would you send?" without sending anything.
					const url = new URL(req.url ?? "/", "http://127.0.0.1");
					const sessionId = url.searchParams.get("sessionId") ?? "";
					const agents = ctx.get("agents");
					const session = sessionId === "" ? undefined : agents?.get(sessionId)?.session;
					const name = session === undefined ? "" : sessionNameOf(ctx, session);
					json(res, 200, {
						ok: true,
						sessionId,
						sessionName: name,
						copy,
						subject: store.subject(copy.subject),
						turnEnd: buildTurnEndPayload(sessionId, { kind: "completed" }, { copy, session: name }),
						question: buildQuestionPayload({ agent: { id: sessionId }, questions: [{ header: "確認", question: "このまま進めますか？" }] }, { copy, session: name }),
					});
				},
			},
			{
				kind: "exact",
				path: "/api/rdsh-pwa/push/test",
				handler: async (req, res) => {
					if (!guard(req, res)) return;
					if (req.method !== "POST") {
						res.writeHead(405, { allow: "POST" });
						res.end();
						return;
					}
					const body = await readJsonBody(req);
					const sessionId = typeof body.sessionId === "string" ? body.sessionId : "";
					const result = await fanOut(makePayload(sessionId, "test", "DSH テスト通知", "タップするとこのセッションが開きます。"));
					json(res, 200, { ok: result.ok, ...result, count: store.subscriptions().length });
				},
			},
		];
		for (const route of routes) routeCtx.effect(() => routeCtx.webServer.register(route), `rdsh-pwa: ${route.path}`);
	});

	return { store, fanOut };
}
