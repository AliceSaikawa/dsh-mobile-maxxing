import z from "@deepseek-ai/schemastery";

/** Settings namespace shared with this bundle's browser half. */
const NAMESPACE = "esc-stop";

/**
 * Durable shape of the Esc-to-stop preference. One boolean, ON by default, so
 * installing the bundle already delivers the gesture and the settings row only
 * ever turns it off.
 */
const EscStopSettingsSchema = z.object({
	enabled: z.boolean().default(true).description("Esc キーで実行中のターンを停止する")
});

/**
 * Host half: register the namespace the browser half binds and the settings row
 * writes. Registration lives on this plugin's fiber, so unloading the bundle
 * removes the namespace and its observers with it.
 * @param ctx - host context that may acquire the settings service.
 */
function apply(ctx) {
	ctx.inject(["settings"], (settingsCtx) => {
		const settings = settingsCtx.settings;
		// DSH 0.1.7+ replaced namespace registration with per-plugin Config
		// forms; there is nothing to register on those hosts and the toggle row
		// degrades away on its own. Only older hosts carry `settings.register`.
		if (settings === void 0 || settings === null || typeof settings.register !== "function") return;
		try {
			settings.register(NAMESPACE, EscStopSettingsSchema);
		} catch (error) {
			// A duplicate registration (for example a double-loaded bundle) must not
			// take the agent down; the last good namespace keeps serving.
			console.warn("[esc-stop] settings registration failed", error);
		}
	});
}

export { apply };
