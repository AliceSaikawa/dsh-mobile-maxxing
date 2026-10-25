#!/usr/bin/env node
/**
 * Real-touch regression for the right-panel tab strip.
 *
 * Loads the actual client bundle in a real Chrome page with an upstream-shaped
 * dockkit strip and drives Input.dispatchTouchEvent. It proves scrollLeft
 * changes from the tab body, the inter-tab caret and the strip fill, and that a
 * desktop mode page never pans. It creates its own target and closes it.
 *
 *   CDP_URL=http://127.0.0.1:9333 node tests/tab-pan.e2e.mjs
 */
import { readFileSync } from "node:fs";

const CDP = process.env.CDP_URL || "http://127.0.0.1:9333";
const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const failures = [];
const check = (name, ok, detail) => {
	console.log(`${ok ? "ok  " : "FAIL"} ${name}${ok ? "" : ` ${JSON.stringify(detail)}`}`);
	if (!ok) failures.push(name);
};

class Page {
	constructor(socket, target) {
		this.socket = socket;
		this.target = target;
		this.id = 0;
		this.pending = new Map();
		socket.onmessage = (event) => {
			const message = JSON.parse(event.data);
			if (message.id === undefined) return;
			const pending = this.pending.get(message.id);
			this.pending.delete(message.id);
			if (message.error) pending.reject(new Error(message.error.message));
			else pending.resolve(message.result);
		};
	}
	static async open() {
		const response = await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" });
		if (!response.ok) throw new Error(`cannot create target: ${response.status}`);
		const target = await response.json();
		const socket = new WebSocket(target.webSocketDebuggerUrl);
		await new Promise((resolve, reject) => {
			socket.onopen = resolve;
			socket.onerror = reject;
		});
		const page = new Page(socket, target);
		await page.send("Page.enable");
		await page.send("Runtime.enable");
		await page.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 3, mobile: true });
		await page.send("Emulation.setTouchEmulationEnabled", { enabled: true, maxTouchPoints: 5 });
		return page;
	}
	send(method, params = {}) {
		const id = ++this.id;
		this.socket.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
	}
	async eval(expression) {
		const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
		if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "evaluation failed");
		return result.result.value;
	}
	async close() {
		try { this.socket.close(); } catch { /* gone */ }
		await fetch(`${CDP}/json/close/${this.target.id}`).catch(() => {});
	}
}

const fixture = (mode) => `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no"><style>
html,body{margin:0;height:1000px}
[data-sidebar-right-panel]{position:absolute;top:0;left:0;width:390px;height:700px}
#panel{position:absolute;inset:0;width:390px;height:700px;background:#fff}
#strip{display:flex;width:200px;overflow-x:auto;overflow-y:hidden;touch-action:pan-y;scroll-behavior:smooth}
.tab{flex:0 0 150px;height:40px;background:#ddd;border-right:1px solid #999;touch-action:pan-y}
.caret{flex:0 0 12px;height:40px;background:#bbb}
.fill{flex:1;height:40px;background:#eee}
</style></head><body>
<div data-sidebar-right-panel><div id="panel">
<button aria-label="Collapse right sidebar" style="width:30px;height:30px">x</button>
<div data-dockkit-strip="pane1" style="display:flex;width:390px">
  <div id="strip" data-dockkit-strip-tabs="pane1">
    <div role="tab" data-dockkit-tab="a" class="tab" aria-selected="true">A</div>
    <div data-dockkit-caret class="caret"></div>
    <div role="tab" data-dockkit-tab="b" class="tab">B</div>
    <div role="tab" data-dockkit-tab="c" class="tab">C</div>
    <div role="tab" data-dockkit-tab="d" class="tab">D</div>
  </div>
  <div data-dockkit-strip-fill class="fill"></div>
</div>
</div></div>
<script>
window.__RDSH_DEVICE_MODE__=${JSON.stringify(mode)};
window.__RDSH_PWA_COPY__={};window.__RDSH_PWA_PROBES__={};
window.__errors=[];window.addEventListener('error',e=>window.__errors.push(String(e.error||e.message)));
window.__loaded=null;window.__ModuleLoader__={load(def){window.__loaded=def;}};
</script></body></html>`;

async function boot(page, mode) {
	await page.send("Page.navigate", { url: `data:text/html;base64,${Buffer.from(fixture(mode)).toString("base64")}` });
	await sleep(250);
	await page.eval(CLIENT);
	const booted = await page.eval(`(() => {
		const def=window.__loaded; if(!def)return {error:"no module"};
		const disposers=[];
		const ctx={effect(fn){const d=fn();disposers.push(d)},inject(deps,cb){return cb(ctx)},
			slots:{inject(deps,cb){return cb()},register(){return()=>{}}},get(){return undefined},on(){return()=>{}}};
		const stub=()=>new Proxy(function(){return stub()},{get(t,k){if(k===Symbol.toPrimitive)return()=>0;if(k==="then")return undefined;if(k==="toString"||k==="valueOf")return()=>"";return stub()},apply(){return stub()},construct(){return stub()}});
		const React={createElement:()=>null,useState:()=>[null,()=>{}],useEffect:()=>{},useRef:()=>({current:null}),useMemo:(f)=>f(),useCallback:(f)=>f,memo:(v)=>v,Fragment:"f"};
		const require=(name)=>name==="react"?React:name==="react-dom/client"?{createRoot:()=>({render(){}})}:stub();
		def.factory(require).apply(ctx);
		// The fixture has no full app chrome, so apply the same two hooks the
		// decoration pass would add in the real app; the pointer handlers are
		// the actual bundle code.
		if (window.__RDSH_DEVICE_MODE__ === "mobile") {
			document.getElementById("panel").setAttribute("data-rdsh-rightpanel", "");
			for (const tab of document.querySelectorAll('[role="tab"][data-dockkit-tab]')) tab.setAttribute("data-rdsh-rtab", "");
		}
		return {tabs:document.querySelectorAll("[data-rdsh-rtab]").length, errors:window.__errors, api:!!window.__RDSH_MOBILE_UX__};
	})()`);
	await sleep(150);
	return booted;
}

async function drag(page, start, points) {
	await page.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start[0], y: start[1], id: 1 }] });
	for (const [x, y] of points) {
		await page.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x, y, id: 1 }] });
		await sleep(16);
	}
	await page.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
	await sleep(180);
}

const horizontal = (startX) => [[startX, 50], [startX - 7, 51], [startX - 14, 52], [startX - 21, 53], [startX - 28, 54], [startX - 35, 55], [startX - 42, 56], [startX - 49, 57]];
const reset = (page) => page.eval(`document.getElementById("strip").scrollLeft=0`);
const scrollLeft = (page) => page.eval(`document.getElementById("strip").scrollLeft`);

try {
	const page = await Page.open();
	try {
		const booted = await boot(page, "mobile");
		check("the actual client boots with tab hooks", booted?.tabs === 4, booted);
		await drag(page, [100, 50], horizontal(100).slice(1));
		check("a tab-body swipe pans the strip", (await scrollLeft(page)) > 20, await scrollLeft(page));
		await reset(page);
		await drag(page, [300, 50], horizontal(300).slice(1));
		check("a strip-fill swipe pans the strip", (await scrollLeft(page)) > 20, await scrollLeft(page));
		await reset(page);
		await drag(page, [155, 50], horizontal(155).slice(1));
		check("an inter-tab caret swipe pans the strip", (await scrollLeft(page)) > 20, await scrollLeft(page));
		await reset(page);
		await drag(page, [300, 50], [[300, 52], [301, 80], [302, 100], [303, 120]]);
		check("a vertical strip-fill drag does not pan", (await scrollLeft(page)) === 0, await scrollLeft(page));
	} finally {
		await page.close();
	}

	const desktop = await Page.open();
	try {
		const booted = await boot(desktop, "desktop");
		await drag(desktop, [300, 50], horizontal(300).slice(1));
		check("desktop mode never pans", (await scrollLeft(desktop)) === 0, await scrollLeft(desktop));
		check("desktop mode has no tab hooks", booted?.tabs === 0, booted);
	} finally {
		await desktop.close();
	}
} catch (error) {
	console.error(error);
	process.exit(2);
}
if (failures.length > 0) {
	console.error(`failed: ${failures.join(", ")}`);
	process.exit(1);
}
console.log("tab pan e2e: ok");
