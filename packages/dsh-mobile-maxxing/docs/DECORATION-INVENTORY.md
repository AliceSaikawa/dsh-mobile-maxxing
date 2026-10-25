# Desktop / mobile boundary (#44) and right-panel layering (#46)

The boundary is the **device mode**, not the window width. A host bootstrap
classifies the device once and writes `globalThis.__RDSH_DEVICE_MODE__` plus
`html[data-rdsh-device-mode]` (`"mobile"` or `"desktop"`). The client resolves
the mode in this order: a valid `__RDSH_DEVICE_MODE__`, then a valid
`data-rdsh-device-mode` attribute, then `"desktop"` (fail closed); it never
re-classifies. Phones and tablets get the mobile surface at any width; ordinary
PCs, Windows touch laptops and narrow desktop windows stay desktop. Resizing
never changes the mode. Width is geometry only (the Settings readout and
genuinely responsive sizing). This deliberately supersedes the original #44
width-only specification per direct user request.

## Stylesheets

`client.js` builds the layout from two constants:

| Constant | Contents |
| --- | --- |
| `CSS_DEVICE` | Only this plugin's own chrome: `.rdsh-mux-toast` and the Settings cards. Always present. No upstream selector. |
| `CSS_PHONE` | Every rule that reshapes upstream in mobile mode (drawer, right panel, composer, transcript, question cards, queue, workspace picker, settings navigation, animations, session colour frame, safe-area root padding). |

There is **no `@media (max-width: 767px)` wrapper**. The mobile half is a
separate `<style data-rdsh-mux-style="phone">` appended only when the
bootstrapped mode is `"mobile"`; a desktop never receives it and a resize never
adds or removes it. Sizing-only breakpoints may still live inside `CSS_PHONE`
(the 380px composer compression is the only one today). The PWA install/toast
geometry uses `html[data-rdsh-device-mode="mobile"]` instead of a width query.
`boundary-issues.test.mjs` and `pc-parity.test.mjs` pin the style split, and
fail if a width feature query or the old wrapper comes back.

## Decoration inventory

Each function is called from `decorateFast()` / `decorateSlow()` unless noted.
"Mobile only" means it returns early (and clears a previous pass) in desktop
mode. The mode never changes during a page, so the cleanup path is dispose
(plus the defensive desktop-boot sweep).

| Function | Offers on upstream DOM | Guard | Cleanup on dispose |
| --- | --- | --- | --- |
| `decorateFast` frame/columns/sidebar/drawer | `data-rdsh-frame`, `-center-col`, `-rightbar-col`, `-sidebar`, `-drawer` | mobile mode only | attributes removed |
| `decorateFast` header/crumbs/conversation | `data-rdsh-header`, `-crumbs`, `-conversation` | mobile mode only | attributes removed |
| `decorateFast` `data-rdsh-anim` | animation choice | mobile mode only | attribute removed |
| `decorateFast` `data-rdsh-hide-settings` | hidden-control switch | mobile mode only (`onPhone && !hideDisabled`) | attribute removed |
| `decorateSessionRows` | row/status/title/running/ring/open/minor hooks **and** the colour frame | mobile mode only | `clearSessionRowHooks()` removes all, including `--rdsh-session-frame` |
| `decorateEditCards` | edit card/header/row | mobile mode only | attributes removed before the scan |
| `decorateTranscript` | transcript column hooks | mobile mode only | attributes removed |
| `decorateUserBubbles` | user stack/bubble | mobile mode only | attributes removed |
| `decorateRightPanel` | panel node + `data-rdsh-rightpanel-open`, observers | mobile mode only | `forgetRightPanel()` |
| `decorateRightPanelTabs` | `data-rdsh-rtab` | mobile mode only | attribute removed |
| `decorateCodePreview` | code pre/scroll locks | mobile mode only | attributes removed |
| `decorateQuestionCards` / `decorateQuestionArrow` | question card/frame/tile + injected arrow button | mobile mode only | attributes + arrows removed |
| `decorateTodoPanel` | todo row text/status/tab/title | mobile mode only | attributes restored/removed via `clearDetailPanelHooks()` |
| `decorateGoalBar` | goal objective/actions/editing, role/tab/title | mobile mode only | same |
| `decorateHeaderTitle` | header title/running | mobile mode only | attributes removed |
| `decorateHeaderActivityChips` | chip hook, generated icon/spinner nodes | mobile mode only | generated nodes removed, native spinner attributes cleared |
| `decorateSessionTitleTyping` | typing attribute/overlay/caret | mobile mode only | controllers cancelled, overlay removed |
| `decorateToasts` | toast hook + swipe listeners | mobile mode only | listeners removed (`toastSwipeState`), inline transform/opacity cleared |
| `decorateModelSearch` | model search row/input disabled | mobile mode only | pointer listener removed, `disabled` restored |
| `installSettingsNavArrows` | arrow nodes + list observers/listeners | mobile mode only | nodes, listeners, observers and flags removed |
| `decorateStatsDock` | stat text attributes | mobile mode only | attributes removed |
| `decorateLightbox` | crop button, lightbox/swipe hooks | mobile mode only | button removed, attributes removed (WeakSet keeps swipe listeners single) |
| `decorateQueueDock` | queue dock/panel/rows, inline `margin-bottom`, preview `title`/`tabindex` | mobile mode only | inline margin cleared; upstream `title`/`tabindex` restored from a WeakMap |
| `decorateWorkspacePicker` | search row, viewport/hidden hooks | mobile mode only | `clearWorkspacePicker()` |
| `decorateComposer` | `+` label, model button, composer root/dock | mobile mode only | `clearComposerHooks()` restores only the label this module wrote |
| `decorateSidebarSettingsRow` | injected Settings row, `data-rdsh-more-row` | `phone()` | nodes/attributes removed |
| `decorateSidebarToggle` | drawer toggle hook | mobile mode only | attribute removed |
| `decorateRouteHeading` | route heading inset | mobile mode only | attribute cleared |
| `markScrollers` | scroll hooks | mobile mode only | attribute removed |
| `installDrawer` | FAB + backdrop nodes | mobile mode only (boot) | nodes removed by `removeDrawerNodes()` |
| `enforceNoZoomViewport` | viewport `content` | mobile mode only | original value restored (a missing `content` attribute is restored as missing; a meta this module created is removed) |
| `applyDeviceTheme` | per-device palette/`theme-color`/`data-rdsh-device-theme` | mobile mode only | `releaseDeviceTheme()` restores the captured baseline; never writes the shared theme |
| `measureSafeArea` | `data-rdsh-safe-*`, `data-rdsh-native-gap`, `--rdsh-safe-*`, `--rdsh-native-gap-px` | mobile mode only | `releaseSafeArea()` |

`clearPhoneHooks()` is the single transition/dispose path: it closes menus and
popovers, cancels listeners/observers, removes generated nodes, strips every
attribute in `PHONE_HOOKS`, restores inline styles and the viewport, then
releases the device palette and safe-area writes. `decorate()` also fails safe:
a MutationObserver pass on a wide window only clears, never tags.

Queued work cannot undo that cleanup: the boot effect owns a `live` flag, so a
decorate frame requested before dispose is a no-op; the theme effect keeps its
own `active` flag for its rAF and `theme/change` microtask; and
`releaseDeviceTheme()` bumps `deviceThemeCheck` so a queued verification frame
cannot retry the palette. `boundary-issues.test.mjs` disposes with those frames
still queued, flushes them, and asserts the viewport, palette, animation and
drawer state stay released.

## Deliberately device-independent (not gated)

- PWA shell: manifest, service worker, offline launch, toasts, Web Push and
  notification routing. The install card itself is shown in mobile mode at any
  width (a wide tablet is still installable).
- Host `index.js`: viewport-fit/interactive-widget injection, iOS metadata,
  dictionaries. These do not change desktop pixel layout.
- Session-id copy row, CJK autolink fix, terminal touch-to-wheel bridge,
  desktop notification opt-in (`notifyDeviceTurns`), notification diagnostics
  (`data-rdsh-badge-hook`, `-sessions-hook`, `-running-subagents`).
- The Settings → Mobile cards themselves: their own `.rdsh-mux-*` styles are
  width-independent. The palette choice they expose paints only in mobile mode.
- Touch input translation (terminal touch-to-wheel, overscroll guard): a touch
  PC may use it; it is not mobile chrome and does not change the mode.

## #46 layering

The open panel no longer sets `display: none` (or `visibility`) on the header.
The header stays in flow, so its rect is identical open/closed and the chat
does not jump. The panel's positioned column and the upstream
`[data-sidebar-right-panel]` root are raised with `z-index: 60`; the tagged
layer gets `isolation: isolate` **without** overriding upstream's `position:
absolute`. Verified in `boundary-issues.test.mjs` (source contract) and with a
real Chrome/CDP fixture: 10 open/close frames keep one header rect,
`elementFromPoint` hits the panel, and a desktop boot never receives the mobile
sheet.
