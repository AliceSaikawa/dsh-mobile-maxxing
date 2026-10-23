/**
 * Host half of the rdsh session-ID copy bundle.
 *
 * Everything this plugin does happens in the browser: `client.js` contributes
 * one row to the session menu slot `sidebar.workspaces.session.menu.item`.
 * The host row exists only so the package composes as a plugin entry with a
 * client half; it registers no route, no service and no hook.
 */
export function apply() {}
