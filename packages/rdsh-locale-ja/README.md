# rdsh-locale-ja

Separate Japanese locale package for DSH, implementing stage 2 of
[#80](https://github.com/kuraneko1/dsh-mobile-maxxing/issues/80).

**Stage 2 is not a complete translation.** It ships a safe package skeleton,
the 83 existing Japanese values, and development-only English fallbacks for
every other key. Selecting `ja` currently shows Japanese only in `common`,
`settings` and `settings.locale`; the rest of the UI stays English.

## What stage 2 contains

- the stage-1 English snapshot: **64 namespaces / 2906 keys** from DSH
  `0.2.1-rc.2`, unchanged;
- **83 Japanese values** moved byte-for-byte from
  `packages/dsh-mobile-maxxing/lib/copy.js` (`LOCALE_PACKS.ja.dictionaries`):
  `common` 41, `settings` 41, `settings.locale` 1;
- **2823 development-only English fallbacks** for the remaining keys. They
  repeat the English snapshot verbatim so every namespace can register a
  complete `ja` dictionary; they are not translations and are marked in
  `locale/translation-status.json` and the generated `client.js`;
- a generated package manifest, host entry and browser client;
- a reviewable batch manifest with **97 batches** of 40-50 keys (small
  namespaces and final remainders may be shorter);
- `tools/build-client.mjs` and `tools/merge-batches.mjs`.

The mobile package still owns its #64 Japanese pack. Stage 2 does not change
mobile code, and the two packs must not be enabled at the same time: both call
`addLanguage({ id: "ja" })` and the second registration throws. Removing the
mobile pack is a later stage.

## Layout

```
package.json                 generated from locale/package-meta.json
index.js                     generated host half (intentionally empty)
client.js                    generated browser half (one addLanguage, 64 registers)
locale/
  upstream.json              stage-1 ownership, sources, hashes, key counts
  package-meta.json          source data for the generated manifest
  batches.json               generated batch manifest
  translation-status.json    generated complete/incomplete accounting
  namespaces/en/*.json       stage-1 English snapshot (read-only here)
  namespaces/ja/*.json       reviewed Japanese values only (currently 3 files)
test/
  extract-upstream.test.mjs  stage-1 extraction/reproducibility tests
  stage2.test.mjs            generation, registration, parity and merge tests
work/                        local batch inputs/outputs, gitignored and not shipped
```

The English files are the key/value source of truth. A Japanese source file
may be absent or partial; a missing key becomes the development-only English
fallback at generation time. `locale/translation-status.json` reports
`translated` and `fallback` counts per namespace and names the policy
`development-only-english`.

## Generating the package

From the repository root:

```sh
node tools/build-client.mjs           # regenerate the five generated files
node tools/build-client.mjs --check   # exit 1 on a stale generated file
```

Generated files are `package.json`, `index.js`, `client.js`,
`locale/batches.json` and `locale/translation-status.json`. Do not edit them
by hand. The generator reads the English snapshot and the Japanese source
files, verifies the stage-1 dictionary hashes, checks key sets, duplicate JSON
keys, blank values (allowed only where the English source is blank) and
placeholder sets, then writes only those five paths. It never writes an
English file.

The generated client exports:

- `language`: `{ id: "ja", label: "日本語", fallback: "en" }`;
- `dictionaries`: all 64 complete `ja` dictionaries;
- `inject`: `["locale"]`;
- `apply(ctx)`: exactly one `ctx.locale.addLanguage(language)` and 64
  `ctx.effect(() => ctx.locale.register(namespace, "ja", dictionary), label)`
  calls, so every registration has an owner-owned disposer.

## Batch translation workflow

`locale/batches.json` assigns every English key to exactly one batch. Each
batch has an `id`, one `namespace`, the namespace `sourceHash` from
`upstream.json`, and its `keys`. Read the English values from
`locale/namespaces/en/<fileName>`, where `fileName` comes from
`locale/upstream.json`.

A worker writes **only** `work/out/<batch-id>.json`:

```json
{
  "schemaVersion": 1,
  "batch": "approval-01",
  "namespace": "approval",
  "sourceHash": "sha256:...",
  "values": {
    "approve": "承認",
    "reject": "拒否"
  }
}
```

`values` must cover exactly the batch's key list: no missing keys, no extra
keys, strings with the same blankness as English (a blank value is allowed
only where the English value is blank too), and the same `{placeholder}`
names as English. Do not write English files, generated files, or another
batch's output. `work/` is gitignored and is not in the package `files` list.

A guessed translation is not a reviewed translation. A reviewer records the
exact batch hash they reviewed in `work/reviewed.json`:

```json
{
  "schemaVersion": 1,
  "reviewed": {
    "approval-01": "sha256:..."
  }
}
```

Then, from the repository root:

```sh
node tools/merge-batches.mjs --check   # validate reviewed batches, write nothing
node tools/merge-batches.mjs           # atomically update locale/namespaces/ja
node tools/build-client.mjs            # regenerate client and status
node --test packages/rdsh-locale-ja/test/stage2.test.mjs
```

The merge accepts only batch ids present in `work/reviewed.json`. It rejects
a stale reviewed hash, a stale output hash, a wrong namespace, missing/extra
keys, blank values for non-blank English text, and placeholder changes. Every
reviewed batch is validated before the first write; writes are temp-file
renames under `locale/namespaces/ja/`, with the previous files restored if a
rename fails. Unreviewed outputs are ignored with a warning. The English
snapshot is never a write target. The merge does not run the generator
automatically, so the generated client stays stale until `build-client.mjs`
succeeds.

Duplicate translated values are reported as warnings (for example two
different English strings intentionally sharing one Japanese word). Duplicate
JSON keys are hard errors.

## Status and limits

- **Incomplete by design:** 83 of 2906 values are Japanese; 3 namespaces are
  translated, 61 are English fallback, and 0 are partial. Do not describe this
  package as a completed Japanese localization.
- **Fallback is not translation:** the 2823 English values under `ja` are a
  development aid so the locale can be selected and the namespace registration
  can be exercised. They may be replaced batch by batch.
- **Transitional ownership:** the mobile pack still registers `ja` for #64.
  Enable either the mobile pack or this package, not both. Stage 2 deliberately
  leaves mobile code, issues, releases, profiles and the server untouched.
- **Not yet installed:** stage 2 verifies the package by tests and generation;
  it does not install the package into a live DSH profile or run a browser
  acceptance test.
- **Batch sizing:** namespaces with at least 40 keys use 40-50 key chunks except
  the final remainder; namespaces below 40 keys stay in one short batch so a
  worker always owns one namespace per output file.
- `work/` is for local translation/review only. Keep it out of commits and
  releases; the generated manifest ships only runtime files.

## Stage 1: English snapshot and extractor

The stage-1 tool records the upstream English dictionaries and where each
namespace comes from. It does not translate anything and never creates,
rewrites or deletes Japanese files.

```sh
# Default: $DSH_HOME/runtime or ~/.dsh/runtime
node tools/extract-upstream.mjs

# Explicit runtime root, @deepseek-ai scope, or @deepseek-ai/dsh package
node tools/extract-upstream.mjs --dsh-root ~/.dsh/runtime
node tools/extract-upstream.mjs --dsh-root ~/.dsh/runtime/node_modules/@deepseek-ai

# Compare the committed snapshot with the installed sources (exit 1 on drift)
node tools/extract-upstream.mjs --check
```

`locale/upstream.json` contains `schemaVersion`, `snapshotLocale`, the
`@deepseek-ai/dsh` version, totals, and per namespace `fileName`, `owners`,
`sources` (`package`, `packageVersion`, `file`, `line`, `sha256`), a
combined `sourceHash`, `locales`, `keyCounts` and `dictionaryHashes`. It has
no timestamp, so extraction is deterministic and `--check` is a byte
comparison. It contains no translations.

The parser is an already-installed JavaScript parser: the acorn bundled with
Node first, then a project-local `acorn`, then `/usr/share/nodejs/acorn`. No
dependency is added and nothing is installed. It resolves `register()` calls
through local constants, templates, concatenation, `join`, `trim`,
`Object.freeze`, spreads and literal three-argument locale tables, and fails
with `file:line` rather than guessing when a registration cannot be resolved
statically. Imported/re-exported dictionaries, computed keys, runtime values
and data-driven tables outside the supported literal shape remain unsupported.

When a new DSH rc is installed: run the extractor, review namespace/key/text
diffs, update the Japanese source files only through reviewed batches, run
`build-client.mjs`, and run both test files plus `--check`. The 64/2906 gate
is specific to `0.2.1-rc.2`; tests skip the installed-runtime reproducibility
assertions when the installed version differs, while `--check` still fails.

## Tests

```sh
node --test packages/rdsh-locale-ja/test/*.test.mjs
# or
pnpm test:locale
```

`stage2.test.mjs` covers single ownership, 64 registrations with disposers,
byte-for-byte migration of the 83 values, en/ja parity with the incomplete
status explicit, intentional-blank acceptance and ordinary-blank rejection,
placeholder preservation, duplicate-key/value checks, batch coverage/hashes,
reviewed merge, stale hashes, all-or-nothing validation, generated `--check`
drift, and that `work/` is gitignored and absent from the package files.
