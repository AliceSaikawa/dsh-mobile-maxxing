/**
 * #46 layering geometry in a real browser, plus the #44 CSS boundary.
 *
 * Creates its OWN incognito browser context and page target through the
 * browser-level CDP endpoint, drives only that target, and disposes both in a
 * `finally`. Existing tabs/targets are only read from `/json/list` to find the
 * new target's WebSocket URL; they are never attached to or modified.
 *
 *   node tests/boundary-layering.e2e.mjs
 *
 * Checks:
 *   - 390x844: the header stays in flow (display/visibility), its rect is
 *     identical across 10 open/close toggles, and elementFromPoint over the
 *     header hits the panel subtree (the sheet is in front).
 *   - 768x900: the phone stylesheet no longer applies (header padding, session
 *     frame, phone-only rules), without a display:none substitute.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const PORT = process.env.CDP_PORT || 9222;
const client = readFileSync(new URL("../client.js", import.meta.url), "utf8");

function cssTemplate(name) {
	const tick = String.fromCharCode(96);
	const match = client.match(new RegExp(`const ${name} = ${tick}([\\s\\S]*?)${tick};\\n`));
	assert.ok(match, `${name} exists`);
	return match[1].replace(/\$\{NARROW_QUERY\}/g, "(max-width: 767px)");
}

const css = `${cssTemplate("CSS_DEVICE")}\n@media (max-width: 767px) {\n${cssTemplate("CSS_PHONE")}\n}`;
const fixture = `<head><meta name="viewport" content="width=device-width, initial-scale=1"><style>${css}</style></head><body>
<div data-rdsh-frame style="display:grid;grid-template-columns:0 minmax(0,1fr) 0;height:100dvh">
  <div data-rdsh-center-col style="grid-column:2;display:flex;flex-direction:column;min-width:0">
    <header data-rdsh-header data-window-drag style="height:76px;flex:0 0 76px;background:#333"></header>
    <div style="flex:1 1 auto;background:#222">chat</div>
  </div>
  <div data-rdsh-rightbar-col style="grid-column:3;position:relative;overflow:visible;min-width:0">
    <div data-sidebar-right-panel="fullscreen" style="position:absolute;top:0;bottom:0;right:0;width:100vw;overflow:clip;pointer-events:none">
      <div data-rdsh-rightpanel style="height:100%;background:#555;pointer-events:auto"><span>panel</span></div>
    </div>
  </div>
</div>
<div data-row-key="session:s1" data-rdsh-session-frame style="--rdsh-session-frame:#ff6b6b;height:20px">row</div>
</body>`;

/** One CDP socket with request/response correlation. */
async function connect(webSocketUrl) {
	const socket = new WebSocket(webSocketUrl);
	await new Promise((resolve, reject) => {
		socket.onopen = resolve;
		socket.onerror = reject;
	});
	let nextId = 0;
	const pending = new Map();
	socket.onmessage = (event) => {
		const message = JSON.parse(event.data);
		if (message.id === undefined) return;
		const call = pending.get(message.id);
		pending.delete(message.id);
		if (call === undefined) return;
		if (message.error) call.reject(new Error(message.error.message));
		else call.resolve(message.result);
	};
	return {
		send(method, params = {}) {
			const id = ++nextId;
			socket.send(JSON.stringify({ id, method, params }));
			return new Promise((resolve, reject) => pending.set(id, { resolve, reject }));
		},
		close() {
			try {
				socket.close();
			} catch {
				/* already closed */
			}
		},
	};
}

const version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
assert.ok(version.webSocketDebuggerUrl, "the CDP browser endpoint is required (CDP_PORT)");

let browser = null;
let page = null;
let browserContextId = null;
let targetId = null;
let result = null;
try {
	browser = await connect(version.webSocketDebuggerUrl);
	({ browserContextId } = await browser.send("Target.createBrowserContext", { disposeOnDetach: false }));
	({ targetId } = await browser.send("Target.createTarget", { url: "about:blank", browserContextId }));

	// Read-only: the list is used only to resolve the new target's page socket.
	const targets = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
	const target = targets.find((entry) => entry.id === targetId && entry.type === "page");
	assert.ok(target, "the browser did not expose the target this test created");
	page = await connect(target.webSocketDebuggerUrl);

	const send = page.send;
	const evaluate = async (expression) => {
		const response = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (response.exceptionDetails) {
			throw new Error(response.exceptionDetails.exception?.description || response.exceptionDetails.text);
		}
		return response.result.value;
	};

	await send("Page.enable");
	await send("Runtime.enable");
	await send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
	await evaluate(`document.documentElement.innerHTML = ${JSON.stringify(fixture)}; true`);

	const measure = () => evaluate(`(() => {
  const header = document.querySelector("header[data-rdsh-header]");
  const rect = header.getBoundingClientRect();
  const hit = document.elementFromPoint(Math.round(rect.left + rect.width / 2), Math.round(rect.top + rect.height / 2));
  const style = getComputedStyle(header);
  return {
    rect: [Math.round(rect.x), Math.round(rect.y), Math.round(rect.width), Math.round(rect.height)],
    display: style.display,
    visibility: style.visibility,
    paddingLeft: style.paddingLeft,
    panelInFront: hit !== null && hit.closest("[data-sidebar-right-panel]") !== null,
    frameShadow: getComputedStyle(document.querySelector("[data-rdsh-session-frame]")).boxShadow,
  };
})()`);

	const narrow = await measure();
	assert.notEqual(narrow.display, "none", "the open panel removed the header from layout");
	assert.notEqual(narrow.visibility, "hidden", "the open panel hid the header");
	assert.equal(narrow.panelInFront, true, "the panel is not painted above the header");
	assert.equal(narrow.paddingLeft, "64px", "the phone header inset is not applied");
	assert.match(narrow.frameShadow, /255, 107, 107/, "the phone session frame is not applied");

	const rects = [];
	for (let index = 0; index < 10; index += 1) {
		await evaluate(`document.documentElement.toggleAttribute("data-rdsh-rightpanel-open", ${index % 2 === 0})`);
		await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
		rects.push((await measure()).rect.join(","));
	}
	assert.equal(new Set(rects).size, 1, "the header rect moved while the panel opened and closed");

	await send("Emulation.setDeviceMetricsOverride", { width: 768, height: 900, deviceScaleFactor: 1, mobile: false });
	await evaluate("new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
	const wide = await measure();
	assert.notEqual(wide.paddingLeft, "64px", "the phone header inset leaked to 768px");
	assert.equal(wide.frameShadow, "none", "the phone session frame leaked to 768px");
	assert.notEqual(wide.display, "none", "the header is still hidden at 768px");

	result = { narrow, rects: [...new Set(rects)], wide };
} finally {
	page?.close();
	if (browser !== null) {
		if (targetId !== null) {
			await browser.send("Target.closeTarget", { targetId }).catch(() => {});
		}
		if (browserContextId !== null) {
			await browser.send("Target.disposeBrowserContext", { browserContextId }).catch(() => {});
		}
		browser.close();
	}
}

console.log(JSON.stringify(result, null, 2));
