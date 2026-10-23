# rdsh-session-id-copy

Session-ID copy row for the dsh web session menu, for
[rdsh](https://github.com/jimoto-no-llm/rustdsh).

The "..." button on every sidebar session row opens a menu whose shipped rows are
pin, rename, fork and archive. This bundle adds one row below them — the icon
set's own copy glyph plus **セッションIDをコピー** — that puts the Session ID on
the clipboard and closes the menu.

Copied text is the bare ID: no icon, no label, no quotes, so it can be pasted
straight into a CLI or an API call.

## How it attaches

`client.js` contributes to `sidebar.workspaces.session.menu.item`, the list slot
[`ui-workspace` declares](https://github.com/deepseek-ai/deepseek-harness) for
exactly this menu. The row is rendered through ui-primitives' `MenuItemButton`,
so it carries the host styling, `role="menuitem"`, the menu's keyboard walk and
its post-selection focus return; it dismisses the menu through the slot-injected
`useMenuOpenState` hook, like the shipped rows.

The glyph goes in the same `icon` seat the shipped rows use, and it is
ui-primitives' `IconCopyOutlineRegular` — the set's default 16px, one-pixel
`currentColor` outline. The row therefore draws no artwork, picks no color and
follows the active theme like pin / rename / fork beside it;
`tests/session-id-copy.test.mjs` fails if a hand-drawn glyph or a hardcoded color
comes back.

Entry shape: `{ id: "rdsh-session-id-copy", order: 500 }`. The id is
namespaced: reusing a shipped id (`pin`, `rename`, `fork`, `archive`) would
replace that row instead of adding one, and the order keeps this row last.
`tests/session-id-copy.test.mjs` pins both properties.

## Clipboard behaviour

1. `navigator.clipboard.writeText` when the page is a secure context.
2. Otherwise — for example the GUI reached over a plain-http Tailscale address —
   a hidden textarea plus `document.execCommand("copy")`.
3. If both are blocked, the ID is shown in a prompt already selected, for a
   manual copy.

A successful copy raises the host success toast (セッションIDをコピーしました).
The toast is best-effort: a copy that worked stays a copy even if the
notification cannot render.

## Install

From this repository, the bundled installer links the copy in `plugins/` into a
Web profile and wires exactly one activation:

```sh
./install-session-id-copy.sh --profile=web
```

It links `node_modules/rdsh-session-id-copy`, then appends the insert below to
the profile's `cordis.patch.yml` — except when the profile already selects this
bundle, where its own patch layer provides the same insert.

An installed original DSH can also take the pnpm route, where `dsh plugin`
forwards to pnpm inside the profile:

```sh
dsh plugin --profile web add "$PWD/plugins/rdsh-session-id-copy"
```

The package declares `dsh.bundle.patch` (`cordis.patch.yml`), so the GUI's plugin
manager additionally selects the new bundle (`dsh.profile.bundles` in the profile
manifest) and composes that patch layer into the running tree: verified on DSH
`0.2.0-rc.2`, where the added entry loaded live — the browser picked up the new
client module through the module graph update, with no dsh restart.

A profile managed by hand instead of by the plugin manager composes the layer
from its own `cordis.patch.yml`, which is watched the same way:

```yaml
- insert:
    - id: rdsh-session-id-copy
      name: "rdsh-session-id-copy"
      config: {}
```

Use one or the other, never both: selecting the bundle already inserts this
entry, and two inserts of the same id collide at the next start.
`install-session-id-copy.sh` enforces that split. Measured on `0.2.0-rc.2`:
adding an insert to the watched patch layer loads the entry live, while
*removing* one does not unmount the entry that is already mounted — a removal
takes effect on the next start.

## Tests

```sh
node --test tests/session-id-copy.test.mjs                                   # unit
RDSH_HARNESS_BIN=/path/to/dsh npm run test:session-id --prefix tests/e2e     # real GUI
```

The unit test boots the real `client.js` in a stubbed browser context and asserts
the row registers into the documented slot (not over a shipped row), that the
copied string is the Session ID alone, that the row draws no artwork or colours
of its own, and that both clipboard fallbacks behave.

The harness e2e (`tests/e2e/session-id-copy.mjs`) starts a throwaway DSH Web
profile — temporary HOME, seeded workspace store, one fixture turn that fails
without credentials — and drives the real session menu in a real browser. It
asserts the menu order, that the row's icon geometry, stroke width and paint
equal the shipped row beside it, the exact copied string, the real clipboard
readback in a secure context, the toast and the menu closing; the captures and
`verification.json` it writes are the ones committed under
[`docs/evidence/session-id-copy/`](../../docs/evidence/session-id-copy/README.md).

