/**
 * rdsh-pwa — UI copy, in one place.
 *
 * The package used to ship Japanese literals in `client.js`, `sw.js` and
 * `notify/host.js` while the shell it decorates is served in `en`. This module
 * is the single source of those strings: the host half injects the table into
 * the page (`globalThis.__RDSH_PWA_COPY__`) and the service worker config, so
 * no UI copy lives in the code that renders it.
 *
 * `en` is complete. `ja` is intentionally empty: the keys are whatever
 * `COPY.en` carries (`Object.keys(COPY.en)` is the authoritative list), and a
 * later Japanese pack only has to assign the same keys. Every lookup falls
 * back to `en` per key, so a partially filled pack is safe.
 *
 * `PROBES` is different: those are *upstream* labels this plugin matches to
 * find controls, not text it renders. They stay bilingual on purpose so a
 * future `ja` shell keeps working. Do not translate them; add a locale.
 *
 * @module rdsh-pwa/copy
 */

/** Every string this package renders, keyed by namespace. */
export const COPY = {
	en: {
		// --- manifest -------------------------------------------------------
		"manifest.description": "Launch DeepSeek Harness as an app.",
		"manifest.screenshot.chat": "Chat",
		"manifest.screenshot.desktop": "Desktop view",

		// --- settings tabs --------------------------------------------------
		"tab.pwa": "App",
		"tab.mobile": "Mobile",
		"tab.input": "Input",

		// --- PWA section ----------------------------------------------------
		"pwa.install.promptable": "Install DSH as an app",
		"pwa.install.iosHint": "Add it to your Home Screen from Safari's Share menu",
		"pwa.install.button": "Install",
		"pwa.install.title": "Install as an app",
		"pwa.later": "Later",
		"pwa.update.available": "A new version is available",
		"pwa.update.reload": "Reload",
		"pwa.offline": "Offline — waiting to reconnect",
		"pwa.sw.activeUpdate": "Active (update pending)",
		"pwa.sw.active": "Active",
		"pwa.sw.unsupported": "Not supported in this browser",
		"pwa.sw.insecure": "Off (requires HTTPS or localhost)",
		"pwa.sw.shared": "Controlled by another service worker (cache off)",
		"pwa.sw.error": "Registration failed",
		"pwa.sw.pending": "Preparing",
		"pwa.install.state.standalone": "Installed (running as an app)",
		"pwa.install.state.installable": "Available",
		"pwa.install.state.ios": "Safari Share menu → Add to Home Screen",
		"pwa.install.state.insecure": "Open over HTTPS to install",
		"pwa.install.state.unsupported": "Not available in this browser",
		"pwa.install.accepted": "Installed.",
		"pwa.install.dismissed": "Cancelled.",
		"pwa.install.unavailable": "The install prompt is not available in this environment.",
		"pwa.check.noWorker": "No service worker is registered.",
		"pwa.check.available": "A new version is available.",
		"pwa.check.latest": "Up to date.",
		"pwa.check.failed": "Could not check (you may be offline).",
		"pwa.section.title": "App (PWA)",
		"pwa.section.desc": "Launches DSH in its own app window and keeps the screen available offline.",
		"pwa.row.displayMode": "Display mode",
		"pwa.row.displayMode.standalone": "App (standalone)",
		"pwa.row.displayMode.browser": "Browser",
		"pwa.row.install": "Install",
		"pwa.row.offline": "Offline launch",
		"pwa.row.build": "Build",
		"pwa.action.reloadUpdate": "Reload to update",
		"pwa.action.checking": "Checking…",
		"pwa.action.check": "Check for updates",
		"pwa.note.ios": "iPhone / iPad: choose Add to Home Screen from Safari's Share button to launch it as an app.",
		"pwa.note.insecure": "Offline launch and installation work only over HTTPS or localhost.",
		"pwa.note.swError": "Service worker registration failed: {error}",
		"pwa.note.bootError": "Boot error: {error}",

		// --- mobile settings -------------------------------------------------
		"mux.nav.scrollLeft": "Scroll settings tabs left",
		"mux.nav.scrollRight": "Scroll settings tabs right",
		"mux.stats.turn": "{count} turn",
		"mux.stats.turns": "{count} turns",
		"mux.stats.tokPerSec": "{speed} tok/s",
		"mux.stats.cacheHit": "Cache hit {percent}%",
		"mux.settingsRow": "Settings",
		"mux.fab.open": "Open session list",
		"mux.fab.openWithCount": "Open session list ({count} unread or waiting)",
		"mux.toast.noFileInput": "No file input is available for attachments",
		"mux.detail.todo": "Todo",
		"mux.detail.goal": "Goal",
		"mux.section.title": "Mobile UI",
		"mux.section.desc": "Adapts the layout and controls to phone width. Settings are stored in this browser.",
		"mux.section.plusNote": "+ opens image and file attachments only (commands start with /).",
		"mux.deviceTheme.title": "Theme (this device only)",
		"mux.deviceTheme.desc": "Pick a palette for this browser alone. The choice is saved here and does not affect your other devices.",
		"mux.deviceTheme.label": "Palette",
		"mux.deviceTheme.note": "The shared theme lives in Settings → General → Appearance. A choice here overrides it on this device only.",
		"mux.deviceTheme.custom": "A custom (registered) theme is active, so the per-device override is disabled.",
		"mux.deviceTheme.unsupported": "This DSH version could not apply a per-device palette, so the shared theme stays.",
		"mux.deviceTheme.follow": "Follow the shared theme",
		"mux.deviceTheme.light": "Light",
		"mux.deviceTheme.dark": "Dark",
		"mux.deviceTheme.system": "Match this device",
		"mux.row.layout": "Layout",
		"mux.row.layout.narrow": "Phone width (drawer)",
		"mux.row.layout.wide": "Desktop width",
		"mux.row.sessions": "Session list",
		"mux.row.sessions.open": "Open",
		"mux.row.sessions.closed": "Closed",
		"mux.row.notifications": "Notifications",
		"mux.row.build": "UI build",
		"mux.action.enable": "Enable notifications",
		"mux.action.reRegister": "Re-register notifications",
		"mux.action.test": "Test notification",
		"mux.action.disable": "Turn off notifications",
		"mux.message.enabled": "Notifications enabled.",
		"mux.message.testSent": "Test notification sent (via push).",
		"mux.message.disabled": "Notifications turned off.",
		"mux.note.blocked": "Notifications are blocked. Set Notifications to Allow in this site's browser settings.",
		"mux.sound.title": "Notification sound",
		"mux.sound.desc": "Plays while the app is open. The browser synthesises the sound, so no audio files are needed.",
		"mux.sound.preview": "Preview",
		"mux.sound.volume": "Volume",
		"mux.sound.none": "None",
		"mux.sound.chime": "Chime",
		"mux.sound.pop": "Pop",
		"mux.sound.drop": "Drop",
		"mux.sound.tick": "Tick",
		"mux.note.notifyScope": "Notifies on turn end and questions. Only the main agent, and only turns sent from this phone, are covered.",
		"mux.hidden.title": "Hidden controls",
		"mux.hidden.desc": "Hides controls that cannot work on a phone (open in editor/terminal, feedback, sign in, and so on).",
		"mux.hidden.none": "(nothing right now)",
		"mux.hidden.disable": "Stop hiding (debug)",
		"mux.hidden.extra": "Extra labels to hide (one per line)",
		"mux.hidden.save": "Save and apply",
		"mux.bootError": "Boot error: {error}",
		"mux.input.title": "Input",
		"mux.input.desc": "Choose what Enter does in the message composer.",
		"mux.input.enterToSend": "Enter sends (off means a newline)",
		"mux.input.current.enterSends": "Currently: Enter sends, Shift+Enter adds a newline.",
		"mux.input.current.enterNewline": "Currently: Enter adds a newline. Send with the send button (Shift+Enter also adds a newline).",
		"mux.liveSpeed.title": "Output speed (estimated from stream deltas)",
		"mux.liveSpeed.aria": "Estimated speed {speed} tok/s",

		// --- session frame palette ------------------------------------------
		"frame.menu": "Color frame",
		"frame.paletteAria": "Session frame color",
		"frame.paletteTitle": "Frame color",
		"frame.color.blue": "Blue",
		"frame.color.green": "Green",
		"frame.color.amber": "Amber",
		"frame.color.red": "Red",
		"frame.color.purple": "Purple",
		"frame.color.pink": "Pink",
		"frame.applied": "Frame color set to {color}",
		"frame.clear": "Remove frame",
		"frame.cleared": "Frame removed",

		// --- image crop ------------------------------------------------------
		"crop.aria": "Crop image",
		"crop.title": "Crop image",
		"crop.rotateLeft": "Rotate left 90°",
		"crop.rotateRight": "Rotate right 90°",
		"crop.close": "Close cropping",
		"crop.cancel": "Cancel",
		"crop.save": "Add to query",
		"crop.addFailed": "Could not add the image to the query",
		"crop.updated": "Updated the image in the query",
		"crop.added": "Cropped image added to the query",

		// --- notifications ---------------------------------------------------
		"notify.unsupported": "This browser does not support notifications",
		"notify.permissionMissing": "Notification permission was not granted",
		"notify.unavailable": "Push notifications are unavailable right now",
		"notify.subscribeFailed": "Could not save the subscription ({status})",
		"notify.unknownError": "Unknown error",
		"notify.rejected": "Push was rejected ({detail})",
		"notify.testTitle": "DSH test notification",
		"notify.testBody": "This banner is how it arrives while the app is open.",
		"notify.testLocalBody": "Notifications are on. Agent questions will arrive here.",
		"notify.noWorker": "No service worker is registered",
		"notify.open": "Open",
		"notify.permission.unsupported": "Not supported in this browser",
		"notify.permission.granted": "On (subscribed)",
		"notify.permission.allowed": "Allowed (not subscribed)",
		"notify.permission.blocked": "Blocked (allow notifications in browser settings)",
		"notify.permission.default": "Not allowed yet",
		"notify.hideListSaved": "Hide list saved.",
		"notify.turn.completed": "Work finished",
		"notify.turn.max-tokens": "Work finished (token limit)",
		"notify.turn.blocked": "Stopped (declined)",
		"notify.turn.error": "Stopped with an error",
		"notify.turn.aborted": "Stopped (interrupted)",
		"notify.turn.other": "Turn ended ({kind})",
		"notify.turn.detailCompleted": "The work finished.",
		"notify.turn.detailReason": "End reason: {kind}",
		"notify.questionHeader": "Confirm",
		"notify.questionMore": "(+{count} more)",
		"notify.previewQuestion": "Continue as is?",
		"notify.testPayloadBody": "Tap to open this session.",

		// --- composer / session menu ----------------------------------------
		"add.label": "Add image or file",
		"add.stock": "Add files or run commands",
		"sessionId.label": "Copy Session ID to clipboard",
		"sessionId.copied": "Session ID copied",
		"sessionId.manualPrompt": "Session ID (copy it manually)",

		// --- service worker --------------------------------------------------
		"sw.documentTitle": "Offline — DSH",
		"sw.offlineHeading": "You're offline",
		"sw.offlineBody1": "Could not reach the DSH server.",
		"sw.offlineBody2": "Check your network connection.",
		"sw.retry": "Retry",
		"sw.pushTitle": "DSH",
		"sw.pushBody": "You have a new notification",
		"sw.open": "Open",
	},

	/**
	 * Japanese pack: empty by design. Fill the keys of `COPY.en` and every
	 * `t()` call picks them up for a `ja` document; anything left out keeps the
	 * English string.
	 */
	ja: {},
};

/**
 * Upstream labels this plugin matches to find controls.
 *
 * These are never rendered: they are the vocabulary of the shell being
 * decorated. Keeping every known locale here is what makes the matching
 * language-independent — adding a language does not touch `client.js`.
 */
export const PROBES = {
	/** The account/menu button that opens Settings. */
	accountMenu: ["Account menu", "設定"],
	/** The Settings row inside that menu. */
	settingsMenu: ["Settings", "設定"],
	/** A session row's own "..." trigger. */
	actions: ["actions", "操作"],
	/** A button that stops the running turn (must not mark a phone send). */
	stop: ["stop", "停止"],
	/** The activity chip: "3 turns" / "3 steps". */
	turns: ["turns", "turn", "steps", "step", "ターン", "ステップ"],
	/** The usage chip: "Cache hit 40%". */
	cacheHit: ["cache hit", "キャッシュ"],
	/** The context chip: "40% context". */
	context: ["context", "コンテキスト"],
	/** Any aria-label that identifies the stats dock. */
	stats: ["tok", "turns", "context", "ターン", "コンテキスト"],
	/** A control that starts a new session (sidebar button, brand row, workspace "+"). */
	newSession: ["new session", "新建会话", "中新建会话"],
	/** Labels of a session that has no name yet. */
	untitled: ["new session", "new chat", "untitled", "新しいセッション", "新しいチャット", "無題", "未命名", "新会话"],
};

/** Keys the service worker needs, picked out of {@link COPY}. */
const SW_KEYS = [
	"sw.documentTitle",
	"sw.offlineHeading",
	"sw.offlineBody1",
	"sw.offlineBody2",
	"sw.retry",
	"sw.pushTitle",
	"sw.pushBody",
	"sw.open",
];

/**
 * One language's strings, falling back to English key by key.
 *
 * @param {string} [lang] - a language id such as `en` or `ja`.
 * @param {object} [table] - dictionary to read; defaults to {@link COPY}.
 * @returns {Record<string, string>} every key this package renders.
 */
export function copyFor(lang, table = COPY) {
	const base = { ...table.en };
	const extra = typeof lang === "string" && lang !== "en" && table[lang] !== undefined
		? table[lang]
		: {};
	for (const [key, value] of Object.entries(extra)) {
		if (typeof value === "string" && value !== "") base[key] = value;
	}
	return base;
}

/**
 * The subset the service worker renders, for `__RDSH_PWA_CONFIG__`.
 *
 * @param {string} [lang] - a language id.
 * @returns {Record<string, string>} offline/push copy.
 */
export function serviceWorkerCopy(lang) {
	const strings = copyFor(lang);
	return Object.fromEntries(SW_KEYS.map((key) => [key, strings[key]]));
}
