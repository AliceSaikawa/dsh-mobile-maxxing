/**
 * Static checks over the browser half.
 *
 * `client.js` is loaded verbatim, so a reference to something that no longer
 * exists is not a syntax error: it throws the first time that line runs, which
 * is usually during boot or on the first gesture. Two bulk edits here left
 * exactly that behind (`onModelFocusOut`, `textBoxOf`) while every other test
 * stayed green and only a real browser noticed. These checks are the cheap
 * substitute for that browser round trip.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const CLIENT = readFileSync(new URL("../client.js", import.meta.url), "utf8");

/** Drop comments and string/template literals, keeping the code shape. */
function stripLiterals(source) {
	const out = [];
	let index = 0;
	while (index < source.length) {
		const character = source[index];
		if (character === "/" && source[index + 1] === "/") {
			const newline = source.indexOf("\n", index);
			index = newline === -1 ? source.length : newline;
			continue;
		}
		if (character === "/" && source[index + 1] === "*") {
			const end = source.indexOf("*/", index + 2);
			index = end === -1 ? source.length : end + 2;
			continue;
		}
		if (character === '"' || character === "'" || character === "`") {
			const quote = character;
			index += 1;
			while (index < source.length) {
				if (source[index] === "\\") {
					index += 2;
					continue;
				}
				if (source[index] === quote) {
					index += 1;
					break;
				}
				index += 1;
			}
			out.push('""');
			continue;
		}
		out.push(character);
		index += 1;
	}
	return out.join("");
}

/** Every name this file brings into scope. */
function declaredNames(code) {
	const declared = new Set();
	const add = (name) => {
		if (/^[A-Za-z_$][\w$]*$/.test(name ?? "")) declared.add(name);
	};
	// A parameter list is flat (`a, b`) or a destructured object
	// (`{ sessionId, useMenuOpenState }`).
	const addParameters = (params) => {
		const text = params.trim();
		if (text.startsWith("{")) {
			for (const inner of text.replace(/^\{|\}$/g, "").split(",")) add(inner.split(":")[0].trim());
			return;
		}
		for (const part of text.split(",")) add(part.split("=")[0].trim());
	};
	for (const match of code.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) add(match[1]);
	for (const match of code.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)/g)) add(match[1]);
	// Object/class method shorthand: `name(...) {`.
	for (const match of code.matchAll(/(?:^|[\s{,])([A-Za-z_$][\w$]*)\s*\([^()]*\)\s*\{/gm)) add(match[1]);
	// Object destructuring.
	for (const match of code.matchAll(/(?:const|let|var)\s*\{([^}]*)\}/g)) {
		for (const part of match[1].split(",")) add(part.split(":")[0].trim().split("=")[0].trim());
	}
	// Array destructuring (React state pairs).
	for (const match of code.matchAll(/(?:const|let|var)\s*\[([^\]]*)\]/g)) {
		for (const part of match[1].split(",")) add(part.trim());
	}
	// Arrow parameters, parenthesised and single.
	// One level of nesting covers a default parameter that is itself a call:
	// `function f(a = read(), b = read2())`.
	for (const match of code.matchAll(/function\s*[A-Za-z_$\w]*\s*\(((?:[^()]|\([^()]*\))*)\)/g)) addParameters(match[1]);
	for (const match of code.matchAll(/\(((?:[^()]|\([^()]*\))*)\)\s*=>/g)) addParameters(match[1]);
	for (const match of code.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) add(match[1]);
	return declared;
}

/** Keywords that take a parenthesised clause rather than a call. */
const NOT_A_CALLEE = new Set([
	"if", "for", "while", "switch", "catch", "return", "typeof", "new", "function", "await", "yield",
	"delete", "void", "in", "of", "instanceof", "do", "else", "try", "throw", "case", "super", "import",
	"export", "async", "class", "extends",
]);

/** Browser and host globals a call may legitimately target. */
const GLOBALS = new Set([
	"parseInt", "parseFloat", "isNaN", "isFinite", "encodeURIComponent", "decodeURIComponent", "encodeURI", "decodeURI",
	"setTimeout", "clearTimeout", "setInterval", "clearInterval", "requestAnimationFrame", "cancelAnimationFrame",
	"queueMicrotask", "structuredClone", "fetch", "atob", "btoa", "getComputedStyle", "matchMedia",
	"Boolean", "Number", "String", "Array", "Object", "Math", "JSON", "Date", "Promise", "Map", "Set", "WeakMap",
	"WeakSet", "Symbol", "RegExp", "Error", "TypeError", "RangeError", "Uint8Array", "Uint32Array", "Intl",
	"URL", "URLSearchParams", "Element", "HTMLElement", "Node", "Event", "CustomEvent", "PointerEvent",
	"KeyboardEvent", "InputEvent", "MouseEvent", "TouchEvent", "Touch", "DataTransfer", "MessageChannel",
	"Notification", "AudioContext", "webkitAudioContext", "MutationObserver", "IntersectionObserver",
	"ResizeObserver", "AbortController", "TextEncoder", "TextDecoder", "Blob", "File", "FileReader", "Image",
	"FormData", "Headers", "Request", "Response", "Proxy", "Reflect", "BigInt", "crypto", "performance",
	"console", "localStorage", "sessionStorage", "document", "window", "navigator", "location", "screen",
	"history", "self", "globalThis", "arguments", "require",
]);

/** Identifiers called as functions that nothing declares. */
function undefinedCalls(code) {
	const declared = declaredNames(code);
	const calls = new Set();
	for (const match of code.matchAll(/(?<![.?\w$])([A-Za-z_$][\w$]*)\s*\(/g)) calls.add(match[1]);
	return [...calls]
		.filter((name) => !declared.has(name) && !NOT_A_CALLEE.has(name) && !GLOBALS.has(name))
		.sort();
}

test("no call targets an undeclared identifier", () => {
	// This is what a deleted helper looks like: the definition goes, one call
	// site stays, and nothing notices until that line runs.
	assert.deepEqual(undefinedCalls(stripLiterals(CLIENT)), []);
});

/** Names assigned without ever being declared — the state a bulk edit drops. */
function undefinedAssignments(code) {
	const declared = declaredNames(code);
	const keywords = new Set([
		"if", "for", "while", "switch", "catch", "return", "typeof", "new", "function", "await", "yield",
		"delete", "void", "in", "of", "instanceof", "do", "else", "try", "throw", "case", "super", "import",
		"export", "async", "class", "extends",
	]);
	const host = new Set(["globalThis", "window", "document", "navigator", "location", "localStorage",
		"sessionStorage", "screen", "history", "self", "console", "performance", "crypto", "module", "exports"]);
	const assigned = new Set();
	for (const match of code.matchAll(/(?<![.?\w$])([A-Za-z_$][\w$]*)\s*=(?!=)/g)) assigned.add(match[1]);
	return [...assigned].filter((name) => !declared.has(name) && !keywords.has(name) && !host.has(name)).sort();
}

test("no assignment targets an undeclared variable", () => {
	// `allowFocusElement = field` with the `let` above it deleted is a
	// ReferenceError on the first focus event, not at load time.
	assert.deepEqual(undefinedAssignments(stripLiterals(CLIENT)), []);
});

test("every addEventListener handler is defined", () => {
	const missing = [];
	for (const match of CLIENT.matchAll(/addEventListener\(\s*"[a-z]+"\s*,\s*([A-Za-z_$][\w$]*)/g)) {
		if (match[1] === "async") continue;
		if (!new RegExp(`function ${match[1]}\\b|(?:const|let|var) ${match[1]}\\s*=`).test(CLIENT)) missing.push(match[1]);
	}
	assert.deepEqual(missing, [], "a listener is registered without a definition");
});

test("the bundle registers exactly one client module", () => {
	const registrations = CLIENT.match(/window\.__ModuleLoader__\.load\(/g) ?? [];
	assert.equal(registrations.length, 1, "one package is one browser module");
	assert.match(CLIENT, /window\.__ModuleLoader__\.load\(\{\s*\n\s*id:\s*"rdsh-pwa",/);
});

test("no data attribute is styled without ever being written", () => {
	const styled = new Set();
	for (const match of CLIENT.matchAll(/\[(data-rdsh-[a-z0-9-]+)\]/g)) styled.add(match[1]);
	const missing = [];
	for (const attribute of styled) {
		const exact = new RegExp(`(?:setAttribute|toggleAttribute)\\(\\s*"${attribute}"`).test(CLIENT);
		const prefix = attribute.split("-").slice(0, -1).join("-");
		const templated = new RegExp(`(?:setAttribute|toggleAttribute)\\(\\s*\`${prefix}-\\$\\{`).test(CLIENT);
		const quoted = new RegExp("[\"'`]" + attribute + "[\"'`]").test(CLIENT.replace(/\[(data-rdsh-[a-z0-9-]+)\]/g, ""));
		if (!exact && !templated && !quoted) missing.push(attribute);
	}
	assert.deepEqual(missing, [], "styled but never written");
});


// ---------------------------------------------------------------------------
// Phone scoping: anything that dresses upstream DOM, or that assumes a finger,
// has to stay inside the phone query or a desktop session looks like a phone.
// ---------------------------------------------------------------------------

/** Both `const CSS = \`…\`` blocks, with the query interpolated in. */
function cssBlocks() {
	const blocks = [...CLIENT.matchAll(/const CSS = `([\s\S]*?)`;\n/g)].map((match) => match[1]);
	assert.ok(blocks.length >= 2, "expected the shell and the layout stylesheets");
	return blocks.map((css) => css.replace(/\$\{NARROW_QUERY\}/g, "(max-width: 767px)"));
}

/**
 * Flatten a stylesheet into one entry per declaration block.
 *
 * Comments are dropped first: this file's comments quote selectors, and a
 * brace inside prose would otherwise open a block.
 */
function cssRules(css) {
	const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = [];
	const stack = [];
	let current = "";
	for (const character of source) {
		if (character === "{") {
			stack.push(current.trim());
			if (current.trim() !== "") rules.push({ head: current.trim(), at: [...stack.slice(0, -1)] });
			current = "";
			continue;
		}
		if (character === "}") {
			stack.pop();
			current = "";
			continue;
		}
		if (character === ";") {
			current = "";
			continue;
		}
		current += character;
	}
	return rules;
}

/** The text just inside a function declaration or an arrow constant. */
function functionHead(name, length = 900) {
	const declared = CLIENT.indexOf(`function ${name}(`);
	const assigned = CLIENT.indexOf(`const ${name} = (`);
	const at = declared >= 0 ? declared : assigned;
	assert.ok(at >= 0, `${name} is missing`);
	return CLIENT.slice(at, at + length);
}

test("upstream hooks are styled only inside the phone query", () => {
	// The report behind this test: on a desktop, running sessions showed the
	// phone ring, the open row was painted with a hard-coded #232324, image
	// previews were darkened and cropped. Those rules used to sit outside the
	// media block. The safe-area rules are the only exception: they key off
	// `env()` values, which are zero on a desktop.
	const allow = [/^html\[data-rdsh-safe-(top|bottom|left|right)\]/, /^html\[data-rdsh-native-gap\]/, /^html\[data-rdsh-pwa=/];
	const phone = (at) => at.some((head) => /max-width:\s*767px/.test(head));
	const leaked = [];
	for (const css of cssBlocks()) {
		for (const rule of cssRules(css)) {
			if (!/\[data-rdsh-/.test(rule.head)) continue;
			if (phone(rule.at)) continue;
			if (allow.some((pattern) => pattern.test(rule.head))) continue;
			leaked.push(rule.head);
		}
	}
	assert.deepEqual(leaked, [], "styled outside the phone query");
});

test("the phone query covers a landscape phone", () => {
	// `(max-width: 767px)` alone drops an 844x390 phone into the desktop
	// layout: no drawer button, no swipe, stock rail. Both halves and both
	// stylesheets have to agree.
	const definitions = [...CLIENT.matchAll(/const NARROW_QUERY = "([^"]+)";/g)].map((match) => match[1]);
	assert.equal(definitions.length, 2, "one definition per half");
	for (const definition of definitions) {
		assert.match(definition, /max-width: 767px/, "the portrait rule is gone");
		assert.match(definition, /orientation: landscape/, "a landscape phone is still a phone");
		assert.match(definition, /pointer: coarse/, "a narrow desktop window is not a phone");
	}
	assert.equal(
		(CLIENT.match(/@media \(max-width: 767px\)/g) ?? []).length,
		0,
		"the stylesheets must interpolate NARROW_QUERY instead of repeating it",
	);
});

test("Enter keeps its desktop behaviour", () => {
	// The phone default (Enter inserts a newline) is the opposite of the stock
	// composer. Gating that on width killed Enter-to-send for anyone with a
	// narrow desktop window, so the guard keys off the pointer instead.
	const head = functionHead("onKeyDownCapture", 600);
	assert.match(head, /if \(!coarsePointer\(\)\) return;/, "onKeyDownCapture is not gated on a coarse pointer");
	assert.doesNotMatch(head, /if \(!narrow\(\)\) return;/, "a narrow desktop window would lose Enter");
});

test("panel-wide decorations stay off the desktop", () => {
	// Both of these reach across upstream UI: the stats dock opens the context
	// panel to read a number, and the lightbox injects a crop button.
	assert.match(functionHead("decorateStatsDock", 500), /if \(!narrow\(\)\) return;/, "decorateStatsDock is not phone-gated");
	assert.match(functionHead("decorateLightbox", 400), /if \(!narrow\(\)\) return;/, "decorateLightbox is not phone-gated");
});

test("leaving the phone layout removes its hooks", () => {
	// Attributes survive a resize on their own: the stylesheet stops applying
	// but the DOM keeps claiming a row is running, and the header title keeps
	// a hook whose sheen no longer exists.
	assert.match(CLIENT, /function clearSessionRowHooks\(\)/, "no row cleanup");
	assert.match(CLIENT, /function clearPhoneHooks\(\)/, "no header/typing cleanup");
	assert.match(
		CLIENT,
		/if \(narrow\(\)\) decorateSessionRows\(\);\s*\n\s*else if \(rowHooksActive\) clearSessionRowHooks\(\)/,
		"rows are decorated off the phone",
	);
	assert.match(CLIENT, /const onMedia = \(\) => \{\s*\n\s*emit\(\{ narrow: media\.matches \}\);\s*\n\s*if \(!media\.matches\) clearPhoneHooks\(\);/, "a resize to desktop keeps the phone hooks");
});

test("the live-speed poller only runs on a phone", () => {
	const body = functionHead("LiveSpeed", 2400);
	assert.match(body, /if \(!sessionId \|\| !phone\) \{/, "the poller runs on a desktop");
	assert.match(body, /if \(!phone \|\| speed === null\) return null;/, "the speed label renders on a desktop");
});

test("a rotation rebuilds the gesture and layout state", () => {
	// Without this, a rotation that keeps the width on the same side of the
	// breakpoint (390 <-> 667) never re-runs decorate, and a swallowed touchend
	// leaves a start point from the old orientation.
	assert.match(functionHead("resetGestures", 400), /edgeSwipe = null;\s*\n\s*touchStart = null;/, "no gesture reset");
	// There is a second `onResize` in the crop editor; anchor on the rotation
	// state that only the boot handler declares.
	const at = CLIENT.indexOf("let rotationTimer = 0;");
	assert.ok(at >= 0, "no rotation follow-up");
	const resize = CLIENT.slice(at, at + 900);
	assert.match(resize, /resetGestures\(\)/, "resize does not reset gestures");
	assert.match(resize, /measureSafeArea\(\)/, "resize does not re-measure");
	assert.match(resize, /scheduleDecorate\(\)/, "resize does not redecorate");
	assert.match(resize, /rotationTimer = window\.setTimeout\(\(\) => \{[\s\S]{0,200}?measureSafeArea\(\);[\s\S]{0,100}?scheduleDecorate\(\);[\s\S]{0,80}?\}, 350\)/, "no follow-up pass for the late safe-area values");
	assert.match(CLIENT, /visualViewport\?\.addEventListener\("resize", onResize\)/, "the visual viewport is not watched");
	assert.match(CLIENT, /attributeFilter: \[[^\]]*"data-sidebar-collapsed"/, "drawer changes are not observed");
	assert.match(CLIENT, /attributeFilter: \[[^\]]*"data-rightbar-collapsed"/, "panel changes are not observed");
});

test("the right panel is only looked for inside its own subtree", () => {
	// A hidden route keeps a 0x0 copy of the collapse button; walking up from
	// it without a boundary tagged the app frame as the panel, which then hid
	// the header and the drawer button with no way back on a phone.
	assert.match(CLIENT, /const RIGHT_PANEL_ROOT = "\[data-sidebar-right-panel\]"/, "no boundary");
	assert.match(functionHead("visibleCollapseButton", 900), /rect\.width <= 0 \|\| rect\.height <= 0/, "the 0x0 ghost is not skipped");
	assert.match(CLIENT, /const boundary = collapse\.closest\(RIGHT_PANEL_ROOT\)/, "the walk is not bounded");
	assert.match(CLIENT, /while \(node !== null && node !== boundary && node !== document\.body\)/, "the walk ignores the boundary");
	assert.match(functionHead("forgetRightPanel", 700), /querySelectorAll\("\[data-rdsh-rightpanel\]"\)/, "stale panel tags are kept");
	assert.match(CLIENT, /host\.closest\("\[hidden\]"\) === null/, "a hidden panel still counts as open");
});

test("a finger drag in the terminal becomes a wheel event", () => {
	// The bundled xterm 6.0 scrolls only on wheel events (there is no DOM
	// scroller), so this bridge is the whole fix; CSS can only get out of its
	// way.
	assert.match(CLIENT, /const XTERM_SCROLLER = "\.xterm-scrollable-element"/, "the scroller node is not named");
	assert.match(CLIENT, /wheel\.deltaMode = 0/, "the wheel delta is not pixel mode");
	assert.match(CLIENT, /wheel\.deltaY = -pixels \* TERMINAL_WHEEL_PER_PX/, "the wheel delta is not derived from the drag");
	assert.match(CLIENT, /function onTouchMove\(event\) \{\s*\n\s*if \(moveTerminalDrag\(event\)\) return;/, "the bridge does not own the gesture");
	assert.match(CLIENT, /function onTouchStart\(event\) \{\s*\n\s*startTerminalDrag\(event\);/, "no drag start");
	assert.match(CLIENT, /function onEdgeSwipeEnd\(\) \{\s*\n\s*edgeSwipe = null;\s*\n\s*endTerminalDrag\(\);/, "the drag outlives the gesture");
	// ...and the overscroll guard must stop cancelling the drags the bridge wants.
	assert.match(CLIENT, /target\.closest\("textarea, input, \.xterm"\)\) return;/, "the overscroll guard still cancels terminal drags");
	assert.match(CLIENT, /target\.closest\("input, textarea, \[contenteditable=true\], \.xterm/, "the back-swipe still claims terminal drags");
});

test("the right panel tabs are tappable on a phone", () => {
	assert.match(functionHead("decorateRightPanelTabs", 600), /querySelectorAll\('\[data-rdsh-rightpanel\] \[role="tab"\]\[data-dockkit-tab\]'\)/, "the tab selector is not attribute-based");
	assert.match(functionHead("decorateRightPanelTabs", 600), /tab\.setAttribute\("data-rdsh-rtab", ""\)/, "the tab hook is never written");
	// A tap the app turned into a drag never produces a click; replay one.
	assert.match(CLIENT, /tabReplayTimer = window\.setTimeout\(\(\) => \{[\s\S]{0,500}?tabTap\.tab\.dispatchEvent\(new MouseEvent\("click"/, "no tap replay");
	assert.match(CLIENT, /if \(tabTap\.fired \|\| !tabTap\.tab\.isConnected\) return;/, "the replay is not one-shot");
	assert.match(CLIENT, /target\.closest\("\[data-rdsh-rtab\]"\) === tabCandidate\.tab\) tabCandidate\.fired = true;/, "a real click does not cancel the replay");
	for (const rule of [
		/\[data-rdsh-rightpanel\] \[data-dockkit-tab\] \{\s*\n\s*height: 44px !important;/,
		/\[data-rdsh-rightpanel\] \[data-dockkit-strip-tabs\] \{\s*\n\s*touch-action: pan-x !important;/,
		/touch-action: manipulation !important;/,
	]) {
		assert.match(CLIENT, rule, `missing tab CSS: ${rule}`);
	}
});
