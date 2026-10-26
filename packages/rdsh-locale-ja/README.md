# rdsh-locale-ja

Foundation for the Japanese DSH locale package (stage 1 of [#80](https://github.com/kuraneko1/dsh-mobile-maxxing/issues/80)).

**Stage 1 is an extraction and snapshot package, not a translation.** It records the upstream English dictionaries and where each namespace comes from, so later stages can translate and generate the Japanese package from a stable, reviewable baseline. It does not change the existing Japanese values in `dsh-mobile-maxxing`, and it is not the mobile migration.

## Snapshot layout

```
locale/
  upstream.json                  # ownership, sources, hashes, key counts
  namespaces/en/<namespace>.json # one flat English dictionary per namespace
```

On the installed DSH `0.2.1-rc.2` runtime the snapshot contains **64 namespaces and 2906 keys**. Every namespace has both an `en` and a `zh` dictionary; the key sets and `{placeholder}` sets agree between them. The test suite enforces those numbers and that parity whenever the installed runtime matches the recorded version.

`locale/upstream.json`:

- `schemaVersion`, `snapshotLocale`, and the `@deepseek-ai/dsh` version;
- `totals` (namespace count and per-locale key counts);
- per namespace: `fileName`, `owners`, `sources` (`package`, `packageVersion`, `file`, `line`, `sha256`), a combined `sourceHash`, `locales`, `keyCounts`, and `dictionaryHashes`.

It deliberately contains no timestamp, so extraction is deterministic and `--check` is a byte comparison. It also does not contain translations.

`namespaces/ja/` is intentionally absent in stage 1. The extractor never creates, rewrites or deletes Japanese files; a later stage owns that directory and must preserve existing values.

## Running extraction

Requirements: Node.js 22 or newer and an installed DSH runtime (`@deepseek-ai/dsh`). No package needs to be installed and the tool never accesses the network.

From the repository root:

```sh
# Default: $DSH_HOME/runtime or ~/.dsh/runtime
node tools/extract-upstream.mjs

# Explicit runtime root, @deepseek-ai scope, or @deepseek-ai/dsh package
node tools/extract-upstream.mjs --dsh-root ~/.dsh/runtime
node tools/extract-upstream.mjs --dsh-root ~/.dsh/runtime/node_modules/@deepseek-ai
node tools/extract-upstream.mjs --dsh-root ~/.dsh/runtime/node_modules/@deepseek-ai/dsh

# Compare the committed snapshot with the installed sources (exit 1 on drift)
node tools/extract-upstream.mjs --check

# Write somewhere else (useful for a dry run)
node tools/extract-upstream.mjs --out /tmp/rdsh-locale-ja
```

Tests:

```sh
node --test packages/rdsh-locale-ja/test/*.test.mjs
# or
pnpm test:locale
```

The parser is an already-installed JavaScript parser. The tool uses the acorn bundled with Node first, then a project-local `acorn`, and only then `/usr/share/nodejs/acorn`. It does not add a dependency and does not install anything.

## What the extractor understands

It parses every `.js`, `.mjs` and `.cjs` file under each installed package's `lib/` directory and resolves calls to `locale.register(...)` / `ctx.locale.register(...)`:

- two-argument form `register(namespace, { en, zh })`;
- three-argument form `register(namespace, locale, dictionary)`;
- namespace and locale ids supplied through local constant bindings, template literals or string concatenation;
- multiple namespaces in one file (each `register` call owns its dictionary);
- object spreads, including spreads of dictionaries declared earlier in the same file;
- string literals, template literals, string concatenation, `[].join(...)`, `.trim()` / `.trimStart()` / `.trimEnd()`, `String(...)`, `Object.freeze(...)` / `Object.seal(...)`, and statically-decidable conditional/logical expressions;
- a three-argument registration inside `for (const [locale, dict] of [["zh", {...}], ["en", {...}]])`.

Strings and comments cannot fool the scanner: only AST call expressions are considered, so a `register` mentioned in a comment or in a dictionary value is ignored. Braces, escaped quotes and template newlines are kept as JavaScript would evaluate them.

The extractor is intentionally strict. If a registration exists but its namespace, locale id or dictionary cannot be resolved statically, extraction fails with `file:line` and the reason. Silently omitting a namespace would make a short snapshot look complete.

## Source forms that remain unsupported

If one of these shapes feeds a `register()` call, extraction fails with `file:line` instead of guessing. A file that cannot be parsed is skipped with a warning only when it never mentions `locale.register`; otherwise extraction fails.

- dictionaries imported from another module, re-exported, or loaded at runtime (the extractor does not follow a module graph; installed client bundles inline their dictionaries);
- dictionaries produced by a function call, factory, class instance or proxy;
- computed keys that are not statically resolvable string constants;
- values that are not statically reducible strings, such as runtime lookups, `Intl` formatting, user data or non-string values;
- mutation of a dictionary after its declaration;
- dynamic namespace or locale ids that depend on runtime state;
- data-driven registration tables that are not literal arrays of literal tuples (the `for...of` case above is the supported shape);
- direct dictionary mutation through the locale service instead of `register()`.

When a future rc introduces one of these shapes, the extractor stops and points at the file and line; add a supported static form deliberately rather than weakening the check.

## Updating the snapshot

1. Install the new DSH rc.
2. Run `node tools/extract-upstream.mjs`.
3. Review the diff: new/removed namespaces, `keyCounts` changes, and the English text changes.
4. Run the tests and `--check`.

The tests skip the reproducibility assertions when the installed DSH version differs from the version recorded in `upstream.json`, so an older checkout stays runnable; `--check` still fails until the snapshot is refreshed. The 64/2906 gate is specific to `0.2.1-rc.2`.
