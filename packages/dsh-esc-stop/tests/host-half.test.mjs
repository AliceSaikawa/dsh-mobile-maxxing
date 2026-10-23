// Host-half checks for dsh-esc-stop: the settings namespace it registers.
import { test } from "node:test";
import assert from "node:assert/strict";

const registered = [];

/**
 * The host half imports `@deepseek-ai/schemastery`, which DSH itself provides.
 * Outside a DSH install (a bare checkout without the workspace linked) it is
 * absent, so the suite reports a skip instead of a failure.
 */
const available = await import("@deepseek-ai/schemastery").then(() => true, () => false);
const skip = available ? false : "needs @deepseek-ai/schemastery (shipped with DSH)";
const mod = available ? await import("../lib/index.js") : undefined;

/** Minimal settings provider: records registrations. */
function provider() {
	return {
		settings: {
			register(ns, schema) {
				registered.push({ ns, schema });
				return { get: () => ({}), watch: () => () => {} };
			}
		}
	};
}

/** Run `fn` with console.warn captured, so contained failures stay asserted. */
function captureWarnings(fn) {
	const warnings = [];
	const original = console.warn;
	console.warn = (...args) => warnings.push(args);
	try {
		fn();
	} finally {
		console.warn = original;
	}
	return warnings;
}

test("registers the esc-stop namespace with an ON default", { skip }, () => {
	mod.apply({ inject: (_names, fn) => fn(provider()) });
	assert.equal(registered.length, 1);
	const { ns, schema } = registered[0];
	assert.equal(ns, "esc-stop");
	assert.equal(schema({}).enabled, true);
	assert.equal(schema({ enabled: false }).enabled, false);
	assert.equal(schema({ enabled: true }).enabled, true);
});

test("an absent settings service is a silent no-op, not a failure", { skip }, () => {
	const warnings = captureWarnings(() => {
		assert.doesNotThrow(() => mod.apply({ inject: (_names, fn) => fn({}) }));
	});
	assert.equal(warnings.length, 0);
});

test("a settings service without register (DSH 0.1.7+) is a silent no-op", { skip }, () => {
	const before = registered.length;
	const warnings = captureWarnings(() => {
		assert.doesNotThrow(() => mod.apply({ inject: (_names, fn) => fn({ settings: {} }) }));
	});
	assert.equal(warnings.length, 0);
	assert.equal(registered.length, before);
});

test("a duplicate registration never throws", { skip }, () => {
	const warnings = captureWarnings(() => {
		assert.doesNotThrow(() => mod.apply({
			inject: (_names, fn) => fn({ settings: { register: () => { throw new Error("duplicate"); } } })
		}));
	});
	assert.equal(warnings.length, 1);
});
