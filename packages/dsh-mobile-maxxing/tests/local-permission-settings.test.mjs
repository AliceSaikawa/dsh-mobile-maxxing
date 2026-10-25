import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

const source = readFileSync(new URL("../client.js", import.meta.url), "utf8");
const START = "    const LOCAL_PERMISSION_KEY";
const END = "\n    // ---------------------------------------------------------------------\n    // Per-device theme";
const start = source.indexOf(START);
const end = source.indexOf(END, start);
assert(start > 0 && end > start, "the per-device permission block is missing or moved");
const block = source.slice(start, end);

/** VM-created objects carry another realm's prototypes; compare their data. */
const plain = (value) => JSON.parse(JSON.stringify(value));

function harness({ stored = null, command = async () => ({ ok: true, value: { matched: true } }), catalog = null } = {}) {
  const values = new Map();
  if (stored !== null) values.set("rdsh-mobile-ux:local-permission", stored);
  const emitted = [];
  const warnings = [];
  const commands = [];
  const sandbox = {
    localStorage: {
      getItem: (key) => (values.has(key) ? values.get(key) : null),
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
    },
    emit: (patch) => emitted.push(patch),
    t: (key, vars) => (vars === undefined ? key : `${key}:${JSON.stringify(vars)}`),
    console: { warn: (...args) => warnings.push(args) },
  };
  const remote = {
    permissionPresets: {
      catalog: async () =>
        catalog === null
          ? { ok: false, error: { code: "unavailable", message: "no catalog" } }
          : { ok: true, value: catalog },
    },
  };
  const sessions = {
    using: async (sessionId, options, operation) => {
      commands.push({ sessionId, source: options.source });
      return operation({
        binding: { session: { command: (text) => { commands.push({ text }); return command(text); } } },
      });
    },
  };
  const api = vm.runInNewContext(
    `(() => {${block}\nreturn { readLocalPermission, writeLocalPermission, applyLocalPermissionToSession, installLocalPermissionDefault, loadPermissionCatalog }; })()`,
    sandbox,
  );
  return { api, values, emitted, warnings, commands, sandbox, remote, sessions };
}

test("an unset choice never touches a new session", async () => {
  const h = harness();
  assert.equal(h.api.readLocalPermission(), null);
  await h.api.applyLocalPermissionToSession(h.sessions, "s1");
  assert.deepEqual(h.commands, []);
});

test("the chosen preset is applied with the session's own command", async () => {
  const h = harness({ stored: "workspace-write" });
  await h.api.applyLocalPermissionToSession(h.sessions, "s1");
  assert.deepEqual(h.commands[0], { sessionId: "s1", source: "mobilePermissionDefault" });
  assert.deepEqual(h.commands[1], { text: "/permission workspace-write" });
});

test("a missing preset id is skipped rather than sent blank", async () => {
  const h = harness({ stored: "read-only" });
  await h.api.applyLocalPermissionToSession(h.sessions, "");
  assert.deepEqual(h.commands, []);
});

test("follow-the-shared-default clears the stored key", () => {
  const h = harness({ stored: "read-only" });
  h.api.writeLocalPermission("");
  assert.equal(h.values.has("rdsh-mobile-ux:local-permission"), false);
  assert.deepEqual(plain(h.emitted.at(-1)), { localPermission: null });
  h.api.writeLocalPermission("auto");
  assert.equal(h.values.get("rdsh-mobile-ux:local-permission"), "auto");
  assert.deepEqual(plain(h.emitted.at(-1)), { localPermission: "auto" });
});

test("a refused or missing command is reported, not thrown", async () => {
  const refused = harness({ stored: "read-only", command: async () => ({ ok: false, error: { code: "denied", message: "nope" } }) });
  await refused.api.applyLocalPermissionToSession(refused.sessions, "s1");
  assert.equal(refused.warnings.length, 1);
  assert.match(refused.emitted.at(-1).permissionError, /applyFailed/);

  const unmatched = harness({ stored: "read-only", command: async () => ({ ok: true, value: { matched: false } }) });
  await unmatched.api.applyLocalPermissionToSession(unmatched.sessions, "s1");
  assert.match(unmatched.emitted.at(-1).permissionError, /applyFailed/);
});

test("the wrapper keeps the caller's beforeOpen and is restored on dispose", async () => {
  const h = harness({ stored: "read-only" });
  const disposers = [];
  const scope = { effect: (fn) => disposers.push(fn()) };
  const calls = [];
  class Workspace {
    openWorkspaceSession(workspaceId, beforeOpen, reuse) {
      calls.push({ workspaceId, reuse });
      beforeOpen?.("new-session");
      return "result";
    }
  }
  const workspace = new Workspace();
  h.api.installLocalPermissionDefault(scope, workspace, h.sessions);
  const seen = [];
  const returned = workspace.openWorkspaceSession("w1", (id) => seen.push(id), { agentPreset: "x" });
  assert.equal(returned, "result");
  assert.deepEqual(seen, ["new-session"]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(h.commands.at(-1), { text: "/permission read-only" });

  // A second install must not stack another wrapper.
  h.api.installLocalPermissionDefault(scope, workspace, h.sessions);
  workspace.openWorkspaceSession("w1", undefined, undefined);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.commands.filter((entry) => entry.text !== undefined).length, 2);

  disposers[0]();
  assert.equal(Object.hasOwn(workspace, "openWorkspaceSession"), false);
});

test("the catalog feeds the card and a failed read is reported", async () => {
  const ok = harness({
    catalog: {
      options: [{ value: "read-only", name: "read-only" }],
      defaultOptions: [{ value: "read-only", name: "read-only" }],
      defaultPreset: "read-only",
    },
  });
  await ok.api.loadPermissionCatalog(ok.remote);
  assert.deepEqual(plain(ok.emitted.at(-1)), {
    permissionOptions: [{ value: "read-only", name: "read-only", description: "" }],
    permissionSharedDefault: "read-only",
    permissionError: "",
  });

  const failed = harness();
  await failed.api.loadPermissionCatalog(failed.remote);
  assert.match(failed.emitted.at(-1).permissionError, /unavailableDetail/);
});

test("the block never writes host settings", () => {
  assert.doesNotMatch(block, /remote\.settings/);
  assert.doesNotMatch(block, /\.mutate\(/);
  assert.doesNotMatch(block, /configForms/);
  assert.doesNotMatch(block, /setTranscriptView|setPerformanceUsage|setBusyEnter/);
});
