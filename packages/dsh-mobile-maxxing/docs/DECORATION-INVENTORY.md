# Desktop / mobile boundary (#44) and right-panel layering (#46)

This package is width-only: at **≤767px** the phone layout owns the surface; at
**≥768px** upstream's DOM, styles and viewport are left alone. The boundary is
not a device test — a narrow desktop window is a phone and a landscape phone
wider than 767px is a desktop.

## Stylesheets

`client.js` builds the layout stylesheet from two constants:

| Constant | Contents |
| --- | --- |
| `CSS_DEVICE` | Only this plugin's own chrome: `.rdsh-mux-toast` and the Settings cards. No upstream selector. |
| `CSS_PHONE` | Every rule that reshapes upstream (drawer, right panel, composer, transcript, question cards, queue, workspace picker, settings navigation, animations, session colour frame, safe-area root padding). |

`phoneStyles()` wraps `CSS_PHONE` in `@media (max-width: 767px)` mechanically;
no mobile selector is hand-written inside an `@media`. `boundary-issues.test.mjs`
parses the result and fails if a rule escapes the wrapper or if `CSS_DEVICE`
grows an upstream selector.

## Decoration inventory

Each function is called from `decorateFast()` / `decorateSlow()` unless noted.
"Phone only" means it returns early (and clears a previous pass) at ≥768px.

| Function | Offers on upstream DOM | Guard | Cleanup on 768px / dispose |
| --- | --- | --- | --- |
| `decorateFast` frame/columns/sidebar/drawer | `data-rdsh-frame`, `-center-col`, `-rightbar-col`, `-sidebar`, `-drawer` | phone only | attributes removed |
| `decorateFast` header/crumbs/conversation | `data-rdsh-header`, `-crumbs`, `-conversation` | phone only | attributes removed |
| `decorateFast` `data-rdsh-anim` | animation choice | phone only | attribute removed |
| `decorateFast` `data-rdsh-hide-settings` | hidden-control switch | phone only (`onPhone && !hideDisabled`) | attribute removed |
| `decorateSessionRows` | row/status/title/running/ring/open/minor hooks **and** the colour frame | phone only | `clearSessionRowHooks()` removes all, including `--rdsh-session-frame` |
| `decorateEditCards` | edit card/header/row | phone only | attributes removed before the scan |
| `decorateTranscript` | transcript column hooks | phone only | attributes removed |
| `decorateUserBubbles` | user stack/bubble | phone only | attributes removed |
| `decorateRightPanel` | panel node + `data-rdsh-rightpanel-open`, observers | phone only | `forgetRightPanel()` |
| `decorateRightPanelTabs` | `data-rdsh-rtab` | phone only | attribute removed |
| `decorateCodePreview` | code pre/scroll locks | phone only | attributes removed |
| `decorateQuestionCards` / `decorateQuestionArrow` | question card/frame/tile + injected arrow button | phone only | attributes + arrows removed |
| `decorateTodoPanel` | todo row text/status/tab/title | phone only | attributes restored/removed via `clearDetailPanelHooks()` |
| `decorateGoalBar` | goal objective/actions/editing, role/tab/title | phone only | same |
| `decorateHeaderTitle` | header title/running | phone only | attributes removed |
| `decorateHeaderActivityChips` | chip hook, generated icon/spinner nodes | phone only | generated nodes removed, native spinner attributes cleared |
| `decorateSessionTitleTyping` | typing attribute/overlay/caret | phone only | controllers cancelled, overlay removed |
| `decorateToasts` | toast hook + swipe listeners | phone only | listeners removed (`toastSwipeState`), inline transform/opacity cleared |
| `decorateModelSearch` | model search row/input disabled | phone only | pointer listener removed, `disabled` restored |
| `installSettingsNavArrows` | arrow nodes + list observers/listeners | phone only | nodes, listeners, observers and flags removed |
| `decorateStatsDock` | stat text attributes | phone only | attributes removed |
| `decorateLightbox` | crop button, lightbox/swipe hooks | phone only | button removed, attributes removed (WeakSet keeps swipe listeners single) |
| `decorateQueueDock` | queue dock/panel/rows, inline `margin-bottom`, preview `title`/`tabindex` | phone only | inline margin cleared; upstream `title`/`tabindex` restored from a WeakMap |
| `decorateWorkspacePicker` | search row, viewport/hidden hooks | phone only | `clearWorkspacePicker()` |
| `decorateComposer` | `+` label, model button, composer root/dock | phone only | `clearComposerHooks()` restores only the label this module wrote |
| `decorateSidebarSettingsRow` | injected Settings row, `data-rdsh-more-row` | `phone()` | nodes/attributes removed |
| `decorateSidebarToggle` | drawer toggle hook | phone only | attribute removed |
| `decorateRouteHeading` | route heading inset | phone only | attribute cleared |
| `markScrollers` | scroll hooks | phone only | attribute removed |
| `installDrawer` | FAB + backdrop nodes | phone only (boot and each entry) | nodes removed by `removeDrawerNodes()` |
| `enforceNoZoomViewport` | viewport `content` | phone only | original value restored (a missing `content` attribute is restored as missing; a meta this module created is removed) |
| `applyDeviceTheme` | per-device palette/`theme-color`/`data-rdsh-device-theme` | phone only | `releaseDeviceTheme()` restores the captured baseline; never writes the shared theme |
| `measureSafeArea` | `data-rdsh-safe-*`, `data-rdsh-native-gap`, `--rdsh-safe-*`, `--rdsh-native-gap-px` | phone only | `releaseSafeArea()` |

`clearPhoneHooks()` is the single transition/dispose path: it closes menus and
popovers, cancels listeners/observers, removes generated nodes, strips every
attribute in `PHONE_HOOKS`, restores inline styles and the viewport, then
releases the device palette and safe-area writes. `decorate()` also fails safe:
a MutationObserver pass on a wide window only clears, never tags.

## Deliberately device-independent (not gated)

- PWA shell: manifest, service worker, offline launch, install card, toasts,
  Web Push and notification routing.
- Host `index.js`: viewport-fit/interactive-widget injection, iOS metadata,
  dictionaries. These do not change desktop pixel layout.
- Session-id copy row, CJK autolink fix, terminal touch-to-wheel bridge,
  desktop notification opt-in (`notifyDeviceTurns`), notification diagnostics
  (`data-rdsh-badge-hook`, `-sessions-hook`, `-running-subagents`).
- The Settings → Mobile cards themselves: their own `.rdsh-mux-*` styles are
  width-independent. The palette choice they expose only paints at phone width.

## #46 layering

The open panel no longer sets `display: none` (or `visibility`) on the header.
The header stays in flow, so its rect is identical open/closed and the chat
does not jump. The panel's positioned column and the upstream
`[data-sidebar-right-panel]` root are raised with `z-index: 60`; the tagged
layer gets `isolation: isolate` **without** overriding upstream's `position:
absolute`. Verified in `boundary-issues.test.mjs` (source contract) and with a
real Chrome/CDP fixture: 10 open/close frames keep one header rect,
`elementFromPoint` hits the panel, and at 768px the phone rules stop applying.
