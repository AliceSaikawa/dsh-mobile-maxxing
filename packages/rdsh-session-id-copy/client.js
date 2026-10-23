// rdsh-session-id-copy — a "copy this Session's ID" row in the dsh web session
// menu (the "..." button on every session row of the sidebar).
//
// The menu is a published extension point of ui-workspace:
//
//   sidebar.workspaces.session.menu.item   list, ascending `order`
//
// Its shipped rows are pin (100), rename (200), fork (300) and archive (400),
// so order 500 puts this row below them. The row renders ui-primitives'
// MenuItemButton, which owns the host styling and the role="menuitem" markup,
// so it joins the list's keyboard walk and focus return without any state
// sharing; dismissing the menu stays our decision and goes through the hook
// the slot injects (useMenuOpenState), exactly like the shipped rows.
//
// Copied text is the bare Session ID: no icon, no quotes, no label. The row
// itself carries the icon set's own copy glyph through MenuItemButton's `icon`
// seat — the same seat and the same one-pixel `currentColor` outline the
// shipped rows use, so this row needs no artwork or colors of its own.
window.__ModuleLoader__.load({
  id: "rdsh-session-id-copy",
  factory(require) {
    const React = require("react");
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");
    const h = React.createElement;

    const SLOT = "sidebar.workspaces.session.menu.item";
    const ENTRY_ID = "rdsh-session-id-copy";
    // After the shipped rows (pin 100 / rename 200 / fork 300 / archive 400).
    const ORDER = 500;
    const LABEL = "セッションIDをコピー";
    const COPIED = "セッションIDをコピーしました";
    const MANUAL_PROMPT = "セッションID（手動でコピーしてください）";
    const TOAST_HOST_ID = "rdsh-session-id-copy-toast";
    const TOAST_ROOT_KEY = "__rdshSessionIdCopyToastRoot";


    // クリップボード: `navigator.clipboard` は secure context でしか生えない
    // (127.0.0.1 は secure、Tailscale の http://100.x.y.z は非 secure)。
    // 無い・拒否された場合は選択+execCommand に落ちる。
    async function copyText(text) {
      const clipboard =
        typeof navigator === "object" && navigator !== null ? navigator.clipboard : undefined;
      if (clipboard && typeof clipboard.writeText === "function") {
        try {
          await clipboard.writeText(text);
          return true;
        } catch (error) {
          // 権限拒否・非フォーカスなど。下のフォールバックへ。
        }
      }
      let area;
      try {
        area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "");
        area.style.position = "fixed";
        area.style.top = "0";
        area.style.left = "0";
        area.style.width = "1px";
        area.style.height = "1px";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.focus();
        area.select();
        area.setSelectionRange(0, text.length);
        return typeof document.execCommand === "function" && document.execCommand("copy") === true;
      } catch (error) {
        return false;
      } finally {
        area?.remove();
      }
    }

    // Toast は body portal。host を 1 つだけ作り、多重表示は最後の 1 件に畳む。
    // root は window に置く: ライブ更新でこのモジュールが読み直されても、
    // 同じ DOM ノードに 2 つ目の root を作らないため。
    function notify(text) {
      try {
        const { createRoot } = require("react-dom/client");
        let host = document.getElementById(TOAST_HOST_ID);
        if (host === null) {
          host = document.createElement("div");
          host.id = TOAST_HOST_ID;
          document.body.appendChild(host);
        }
        const root = (window[TOAST_ROOT_KEY] = window[TOAST_ROOT_KEY] ?? createRoot(host));
        root.render(
          h(primitives.Toast, {
            text,
            tone: "success",
            onDone: () => {
              root.render(null);
            },
          }),
        );
      } catch (error) {
        // 通知が出せなくてもコピー自体は成立している。
      }
    }

    /** One "..." menu row: copy this Session's ID, then close the menu. */
    function CopySessionIdMenuItem({ sessionId, useMenuOpenState }) {
      const [, setMenuOpen] = useMenuOpenState();
      const id = String(sessionId ?? "");
      return h(primitives.MenuItemButton, {
        // Icon seat of the shipped rows; the default 16px one-pixel outline,
        // like pin / rename / fork beside it.
        icon: h(primitives.IconCopyOutlineRegular, { key: "icon" }),
        onSelect: () => {
          setMenuOpen(false);
          void copyText(id).then((copied) => {
            if (copied) {
              notify(COPIED);
              return;
            }
            // 自動コピーが両方とも塞がれている環境では、選択済みの ID を見せる。
            if (typeof window === "object" && window !== null && typeof window.prompt === "function") {
              window.prompt(MANUAL_PROMPT, id);
            }
          });
        },
        children: LABEL,
      });
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        // Wait for ui-workspace's declaration before contributing to it.
        ctx.slots.inject(SLOT, () =>
          ctx.slots.register({ name: SLOT, id: ENTRY_ID, order: ORDER, label: LABEL }, CopySessionIdMenuItem),
        );
      },
    };
  },
});
