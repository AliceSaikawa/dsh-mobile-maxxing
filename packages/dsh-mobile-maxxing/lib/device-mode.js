/**
 * dsh-mobile-maxxing — the one device-mode decision.
 *
 * One shared index document is served to every browser (`tapIndex` sees the
 * HTML string and nothing else — there is no request-aware index hook), so the
 * mode is decided inside the document at the top of `<head>`, before the module
 * loader and the app bundle run. This module *is* that decision:
 * {@link classifyDevice} is serialized by {@link earlyModeScript} into a single
 * inline script, and the browser half only reads the resulting global.
 *
 * Width is deliberately absent. A narrow desktop window stays desktop, a wide
 * phone or tablet stays mobile; responsive breakpoints remain layout-only.
 *
 * @module dsh-mobile-maxxing/device-mode
 */

/** `<html>` attribute carrying the decided mode. */
export const MODE_ATTRIBUTE = "data-rdsh-device-mode";

/** Global carrying the same string; the browser half reads only this. */
export const MODE_GLOBAL = "__RDSH_DEVICE_MODE__";

/**
 * Which UI this browser should get.
 *
 * `nav` is a `navigator`-shaped object. Only same-document signals count: the
 * legacy UA string, `navigator.platform`, `navigator.maxTouchPoints` and the
 * low-entropy `navigator.userAgentData.mobile` / `.platform`. High-entropy
 * client hints are asynchronous, so they cannot decide the first paint.
 *
 * Phones and tablets both answer `"mobile"`: the mode picks the interaction
 * model, the width only picks geometry. Everything unidentified answers
 * `"desktop"` — upstream's own layout — so an unknown browser is never given
 * the phone surface by accident. A Windows touch PC lands there too: a touch
 * screen is not a tablet signal.
 *
 * Self-contained by contract: `earlyModeScript` inlines this function with
 * `Function.prototype.toString()`, so the body may not reference module scope.
 *
 * @param {object} [nav] - the browser's navigator.
 * @returns {"mobile" | "desktop"} the mode for this document.
 */
export function classifyDevice(nav) {
	const source = nav !== null && typeof nav === "object" ? nav : {};
	const ua = typeof source.userAgent === "string" ? source.userAgent : "";
	const platform = typeof source.platform === "string" ? source.platform : "";
	const touch = typeof source.maxTouchPoints === "number" && source.maxTouchPoints > 1;
	let data;
	try {
		data = source.userAgentData;
	} catch {
		data = undefined;
	}
	const hints = data !== null && typeof data === "object" ? data : {};
	const hintsPlatform = typeof hints.platform === "string" ? hints.platform : "";
	// Chromium client hints, and only a positive answer means anything: a
	// desktop-site toggle or an Android tablet reports mobile:false without
	// being a desktop.
	if (hints.mobile === true) return "mobile";
	// iPhone and iPod; also the iPad UA that "Request Mobile Website" sends, and
	// a device that asked for a desktop site and kept the Apple platform string
	// ("iPhone"/"iPad") while the UA turned into a Macintosh one. Platform is a
	// positive device signal on its own, so it does not need touch points.
	if (/iPhone|iPod|iPad/i.test(ua) || /iPhone|iPod|iPad/i.test(platform)) return "mobile";
	// iPadOS asks for the desktop site by default and sends a Macintosh UA.
	// Touch points are then the only same-document signal left, and no Mac has
	// them. This also covers an iPad that overrode "Request Desktop Site".
	if (platform === "MacIntel" && touch) return "mobile";
	// Android phones and tablets (the tablet UA drops "Mobile"); the hint
	// covers the reduced UA that carries neither token.
	if (/Android/i.test(ua) || hintsPlatform === "Android") return "mobile";
	return "desktop";
}

/**
 * The inline script that decides and publishes the mode.
 *
 * A classic (not module) script, so it runs while `<head>` is parsed: the app
 * bundle is a deferred module and the loader script comes later in the same
 * head, so no mode-dependent style or hook can be applied before this has run.
 * Every failure path leaves `"desktop"`, and a failure while writing the
 * attribute or the global is contained: the document keeps upstream's layout
 * rather than half-applying the phone surface.
 *
 * @returns {string} one `<script>` element carrying the classifier.
 */
export function earlyModeScript() {
	const source = classifyDevice.toString();
	// Our own source, but it lands inside a script element: a body that could
	// close the element is a broken build, not something to render. The script
	// then still publishes the fail-closed answer instead of guessing.
	const inline = /<\/script|<!--/i.test(source) ? "" : source;
	const decide = inline === ""
		? ""
		: `try{m=(${inline})(navigator)==="mobile"?"mobile":"desktop"}catch(e){}`;
	return `<script>(function(){var m="desktop";${decide}try{var d=document.documentElement;if(d)d.setAttribute(${JSON.stringify(MODE_ATTRIBUTE)},m)}catch(e){}try{globalThis.${MODE_GLOBAL}=m}catch(e){}})()<\/script>`;
}
