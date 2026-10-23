// rdsh-open-with — トランスクリプトやサイドバーに表示されている
// ファイルパス・URL を右クリックして「新しいタブ / アプリ / 親フォルダで開く」
// ためのポップアップメニュー。
//
// 仕組み:
//   document の capture 段 contextmenu を 1 本取り、対象を推定する。
//   推定順は (1) 選択テキスト (2) クリックした <a href> (3) クリック座標の
//   テキストノードからのトークン展開。パスらしきものが無いときは
//   preventDefault せず既定のブラウザメニューを残す。入力欄・contenteditable
//   上でも既定メニューを優先する。
//
//   対象が決まったら /api/rdsh-open-with/probe で存在・種類を確認し、
//   カーソル位置にメニューを出す。ファイル中身のタブ表示とアプリ起動は
//   ホスト半分 (index.js) のエンドポイント経由。file:// はブラウザが
//   http ページからの遷移を止めるため、ローカルファイルはホスト経由で
//   Content-Type を付けて配る。
window.__ModuleLoader__.load({
  id: "rdsh-open-with",
  factory(require) {
    const React = require("react");
    const h = React.createElement;
    const useState = React.useState;
    const useEffect = React.useEffect;
    const useCallback = React.useCallback;
    const useRef = React.useRef;
    const primitives = require("@deepseek-ai/dsh-client-ui-primitives");

    const API = "/api/rdsh-open-with";
    const MENU_CLASS = "rrow-menu";
    // HMR でモジュールが再実行されてもリスナが二重登録されないようにする。
    const ACTIVE_KEY = "__rdshOpenWithActive";
    const TOAST_HOST_ID = "rdsh-open-with-toast";
    const TOAST_ROOT_KEY = "__rdshOpenWithToastRoot";

    // トークンの切れ目。空白・引用符・括弧類・日本語の句読点で止まる。
    const STOP_CHARS = new Set(" \t\r\n\"'`<>()[]{}|,;。、，；：！？（）「」【】《》");
    const TOKEN_RE = /(?:https?:\/\/|file:\/\/|~\/|\/)[^\s"'`<>\[\]{}()|,;。、，；：！？（）「」【】《》]+/gi;
    const LINE_SUFFIX_RE = /^(.*?)(?::(\d+)(?:-(\d+))?|#L(\d+))$/;
    const URL_FULL_RE = /^https?:\/\/\S+$/i;
    const FILE_URL_RE = /^file:\/\/(\S+)$/i;
    const ABS_PATH_RE = /^~?\//;
    // 相対パス / basename 候補: セッション workspace 基準で解決する。
    // 「Edited foo.html」のような chip のテキストや、選択・トークン展開で拾う。
    const RELATIVE_RE = /^(?:[^/]*\/)*[^/]*?\.[A-Za-z0-9]{1,12}(?::\d+(?:-\d+)?|#L\d+)?$/;
    // basename を候補にしてよい拡張子。RELATIVE_RE だけだと "v0.3.3" や
    // "example.com" のような地の文まで候補になり、既定メニューを奪ったうえで
    // 何も出せない（= 右クリックが無反応になる）。ディレクトリ付きの token は
    // 形だけで判断し、この一覧は使わない。
    const KNOWN_EXT = new Set((
      "html htm xhtml css js mjs cjs ts tsx jsx json svg png jpg jpeg gif webp avif bmp ico " +
      "pdf txt text log md markdown rs py pyw c cc cpp hpp h java kt kts go rb php sh bash zsh fish " +
      "sql xml csv tsv yaml yml toml ini cfg conf env lock diff patch " +
      "zip tar gz bz2 xz 7z mp3 mp4 wav webm mov docx xlsx pptx"
    ).split(" "));
    const LINE_REF_RE = /(?::\d+(?:-\d+)?|#L\d+)$/;

    const CSS =
      ".rrow-menu{position:fixed;z-index:1000;min-width:240px;max-width:min(460px,calc(100vw - 16px));" +
        "box-sizing:border-box;padding:6px;background:rgba(24,24,28,.78);" +
        "-webkit-backdrop-filter:blur(24px) saturate(180%);backdrop-filter:blur(24px) saturate(180%);" +
        "border-radius:14px;border:0.5px solid rgba(255,255,255,.22);box-shadow:0 12px 40px rgba(0,0,0,.4);" +
        "color:#eee;font-size:13px;font-family:inherit}" +
      ".rrow-head{padding:6px 10px 8px;border-bottom:0.5px solid rgba(255,255,255,.14);" +
        "color:rgba(255,255,255,.6);font-size:12px;overflow-wrap:anywhere}" +
      ".rrow-head b{display:block;color:rgba(255,255,255,.85);font-size:12.5px;" +
        "font-family:ui-monospace,monospace;font-weight:500;margin-top:2px}" +
      ".rrow-item{display:flex;align-items:center;gap:10px;width:100%;box-sizing:border-box;" +
        "padding:7px 10px;border:0;border-radius:8px;background:none;color:#eee;" +
        "font-size:13px;text-align:left;cursor:pointer}" +
      ".rrow-item:hover{background:rgba(255,255,255,.12)}" +
      ".rrow-item:disabled{opacity:.45;cursor:default}" +
      ".rrow-item:disabled:hover{background:none}" +
      ".rrow-note{padding:6px 10px 2px;color:rgba(255,255,255,.45);font-size:12px}";

    function truncate(text, max) {
      return text.length > max ? text.slice(0, max - 1) + "…" : text;
    }

    // 相対候補として扱う条件: ディレクトリ付き（`src/main.rs`）か、
    // 拡張子が既知のファイル名（`README.md`）。地の文の右クリックを奪わない。
    function looksRelative(token) {
      if (token.includes("/")) return true;
      const name = token.replace(LINE_REF_RE, "");
      const dot = name.lastIndexOf(".");
      if (dot <= 0 || dot === name.length - 1) return false;
      return KNOWN_EXT.has(name.slice(dot + 1).toLowerCase());
    }

    // トークンを url / path に分類。path は末尾の :12 / :12-34 / #L12 を行参照として剥がす。
    function classifyToken(raw) {
      if (typeof raw !== "string") return null;
      const token = raw.trim().replace(/[.。]+$/, "");
      if (!token) return null;
      if (URL_FULL_RE.test(token)) return { kind: "url", url: token };
      const fileUrl = FILE_URL_RE.exec(token);
      if (fileUrl) {
        let path = fileUrl[1];
        try { path = decodeURIComponent(path); } catch (e) {}
        return ABS_PATH_RE.test(path) ? { kind: "path", path } : null;
      }
      if (ABS_PATH_RE.test(token)) {
        const suffix = LINE_SUFFIX_RE.exec(token);
        if (suffix && suffix[1]) {
          return { kind: "path", path: suffix[1], line: suffix[2] || suffix[4] || null };
        }
        return { kind: "path", path: token, line: null };
      }
      // basename / workspace 相対パス。存在は probe が確かめる。
      if (RELATIVE_RE.test(token) && looksRelative(token)) {
        const suffix = LINE_SUFFIX_RE.exec(token);
        if (suffix && suffix[1]) {
          return { kind: "relative", path: suffix[1], line: suffix[2] || suffix[4] || null };
        }
        return { kind: "relative", path: token, line: null };
      }
      return null;
    }

    function detectFromSelection() {
      const selection = window.getSelection();
      if (!selection || selection.isCollapsed) return null;
      const text = selection.toString().trim();
      if (!text) return null;
      // 選択全体が 1 トークン（改行くらいは許す）。
      const direct = classifyToken(text.replace(/\s+/g, ""));
      if (direct) return direct;
      const tokens = text.match(TOKEN_RE);
      return tokens ? classifyToken(tokens[0]) : null;
    }

    // クリック座標のテキストノードから、句読点まで両方向に伸ばしてトークン化する。
    function detectFromPoint(x, y) {
      if (typeof document.caretRangeFromPoint !== "function") return null;
      const range = document.caretRangeFromPoint(x, y);
      if (!range || !range.startContainer || range.startContainer.nodeType !== 3) return null;
      const data = range.startContainer.data;
      let start = range.startOffset;
      let end = range.startOffset;
      while (start > 0 && !STOP_CHARS.has(data[start - 1])) start--;
      while (end < data.length && !STOP_CHARS.has(data[end])) end++;
      const token = data.slice(start, end).trim();
      if (!token || token.length > 4096) return null;
      return classifyToken(token);
    }

    // 座標展開が無理な環境では、クリック先の要素全体がパスならそれを使う。
    // 「Edited rdsh-open-with-test.html」のような chip では最後のトークンを試す。
    function detectFromElement(target) {
      const host = target.closest("code,pre,td,li,p,span,h1,h2,h3,button,a");
      if (!host) return null;
      const text = host.textContent.trim();
      if (!text || text.length > 512) return null;
      const direct = classifyToken(text.replace(/\s+/g, ""));
      if (direct) return direct;
      const lastToken = /(\S+)$/.exec(text);
      return lastToken ? classifyToken(lastToken[1]) : null;
    }

    function detectTarget(event) {
      const target = event.target;
      if (!(target instanceof Element)) return null;
      // 入力欄・編集領域・自分のメニュー上では既定のメニューを残す。
      if (target.closest("input,textarea,select,[contenteditable]")) return null;
      if (target.closest("." + MENU_CLASS)) return null;
      const fromSelection = detectFromSelection();
      if (fromSelection) return fromSelection;
      const anchor = target.closest("a[href]");
      if (anchor) {
        const hit = classifyToken(anchor.getAttribute("href") || "");
        if (hit) return hit;
      }
      return detectFromPoint(event.clientX, event.clientY) || detectFromElement(target);
    }

    // root は相対/basename を解決する基準（現在表示中の Session の cwd）。
    // ホスト側の既定はサーバープロセスの workspace root なので、Session が
    // 別ディレクトリを開いていると相対パスが解決できない。
    async function probePath(path, root) {
      try {
        let url = API + "/probe?path=" + encodeURIComponent(path);
        if (typeof root === "string" && root) url += "&root=" + encodeURIComponent(root);
        const response = await fetch(url, { cache: "no-store" });
        if (!response.ok) return null;
        const value = await response.json();
        return value && value.ok ? value : null;
      } catch (e) {
        return null;
      }
    }

    // クリップボード: session-id-copy と同じ secure-context 対応の実装。
    async function copyText(text) {
      const clipboard = typeof navigator === "object" && navigator !== null ? navigator.clipboard : undefined;
      if (clipboard && typeof clipboard.writeText === "function") {
        try {
          await clipboard.writeText(text);
          return true;
        } catch (e) {}
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
      } catch (e) {
        return false;
      } finally {
        area?.remove();
      }
    }

    function notify(text, tone) {
      try {
        const { createRoot } = require("react-dom/client");
        let host = document.getElementById(TOAST_HOST_ID);
        if (host === null) {
          host = document.createElement("div");
          host.id = TOAST_HOST_ID;
          document.body.appendChild(host);
        }
        const root = (window[TOAST_ROOT_KEY] = window[TOAST_ROOT_KEY] ?? createRoot(host));
        root.render(h(primitives.Toast, {
          text,
          tone: tone || "success",
          onDone: () => root.render(null),
        }));
      } catch (e) {}
    }

    function openInNewTab(url) {
      window.open(url, "_blank", "noopener,noreferrer");
    }

    function fileUrl(path) {
      return API + "/file?path=" + encodeURIComponent(path);
    }

    function doCopy(text, label) {
      void copyText(text).then((copied) => {
        notify(copied ? label : "コピーできませんでした");
      });
    }

    async function doOpen(path, parent) {
      let message = "アプリで開けませんでした";
      try {
        const response = await fetch(API + "/open", {
          method: "POST",
          cache: "no-store",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ target: path, parent: parent === true }),
        });
        const value = await response.json();
        if (response.ok && value && value.ok) {
          notify(parent ? "親フォルダをアプリで開きました" : "アプリで開きました");
          return;
        }
        if (value && typeof value.message === "string" && value.message) message = value.message;
      } catch (e) {}
      notify(message);
    }

    function MenuView({ menu, onAction }) {
      const item = menu.item;
      const probed = menu.probe;
      const rows = [];
      if (item.kind === "url") {
        rows.push({ key: "tab", label: "新しいタブで開く", run: () => openInNewTab(item.url) });
        rows.push({ key: "copy", label: "URLをコピー", run: () => doCopy(item.url, "URLをコピーしました") });
      } else {
        if (!probed) {
          rows.push({ key: "wait", label: "ファイルを確認中…", disabled: true });
        } else if (probed.exists && probed.isDir) {
          rows.push({ key: "app", label: "フォルダをアプリで開く", run: () => doOpen(item.path, false) });
        } else {
          if (probed.exists) {
            rows.push({
              key: "tab",
              label: probed.inline ? "新しいタブで開く" : "ダウンロード",
              run: () => openInNewTab(fileUrl(item.path)),
            });
          }
          rows.push({ key: "app", label: "アプリで開く", run: () => doOpen(item.path, false) });
          if (probed.exists) {
            rows.push({ key: "parent", label: "親フォルダをアプリで開く", run: () => doOpen(item.path, true) });
          }
        }
        rows.push({ key: "copy", label: "パスをコピー", run: () => doCopy(item.path, "パスをコピーしました") });
      }
      // 相対/basename は probe で確定した絶対パスを見せる。
      const headline = item.kind === "url" ? item.url
        : (probed && probed.path) ? probed.path : item.path;
      return h("div", {
        className: MENU_CLASS,
        style: { left: menu.x + "px", top: menu.y + "px" },
        role: "menu",
        onContextMenu: (event) => event.preventDefault(),
      },
        h("style", null, CSS),
        h("div", { className: "rrow-head" },
          item.kind === "url" ? "リンク" : probed && probed.exists
            ? (probed.isDir ? "フォルダ" : "ファイル")
            : "パス",
          h("b", null, truncate(headline, 160) + (item.line ? ":" + item.line : ""))),
        probed && !probed.exists && item.kind === "path"
          ? h("div", { className: "rrow-note" }, "このホストでは見つかりませんでした")
          : null,
        rows.map((row) => h("button", {
          key: row.key,
          className: "rrow-item",
          role: "menuitem",
          disabled: row.disabled === true,
          onClick: () => {
            onAction();
            row.run();
          },
        }, row.label)));
    }

    // shell.overlay は root scope なので、標準 kit の useSessions が届く。
    // 届かない構成でも hook 順が変わらないよう、定数に落とす。
    const NO_SESSIONS = () => undefined;

    function OpenWithOverlay({ useSessions }) {
      const [menu, setMenu] = useState(null);
      const menuRef = useRef(null);
      const probeToken = useRef(0);
      // メイン表示中の Session の cwd が相対パス解決の基準。
      const sessionsHook = typeof useSessions === "function" ? useSessions : NO_SESSIONS;
      const sessionCwd = sessionsHook((state) => {
        const byId = state?.byId;
        if (!byId) return undefined;
        for (const session of Object.values(byId)) {
          if ((session?.retainedBy?.mainView ?? 0) > 0) return session.cwd;
        }
        return undefined;
      });
      const cwdRef = useRef(undefined);
      cwdRef.current = typeof sessionCwd === "string" && sessionCwd ? sessionCwd : undefined;

      const close = useCallback(() => setMenu(null), []);

      useEffect(() => {
        if (window[ACTIVE_KEY]) return undefined;
        window[ACTIVE_KEY] = true;

        const onContextMenu = (event) => {
          const hit = detectTarget(event);
          if (!hit) {
            setMenu(null);
            return; // 既定のブラウザメニューを残す
          }
          event.preventDefault();
          event.stopPropagation();
          const token = ++probeToken.current;
          const x = Math.max(8, Math.min(event.clientX, window.innerWidth - 240));
          const y = Math.max(8, Math.min(event.clientY, window.innerHeight - 120));
          if (hit.kind === "url") {
            setMenu({ x, y, item: hit, probe: undefined });
            return;
          }
          const root = cwdRef.current;
          if (hit.kind === "relative") {
            // 相対/basename 候補は Session の cwd で実在が確認できてから出す。
            // 先に出して probe の結果で閉じると「一瞬出て消える」になる。
            setMenu(null);
            void probePath(hit.path, root).then((value) => {
              if (probeToken.current !== token || !value || !value.exists) return;
              setMenu({ x, y, item: { ...hit, path: value.path || hit.path }, probe: value });
            });
            return;
          }
          setMenu({ x, y, item: hit, probe: null });
          void probePath(hit.path, root).then((value) => {
            if (probeToken.current !== token) return;
            setMenu((current) => current && current.item === hit
              ? { ...current, probe: value || { ok: true, exists: false } }
              : current);
          });
        };
        const onKeyDown = (event) => {
          if (event.key === "Escape") setMenu(null);
        };
        const onPointerDown = (event) => {
          if (menuRef.current && !menuRef.current.contains(event.target)) setMenu(null);
        };
        const onScroll = () => setMenu(null);

        document.addEventListener("contextmenu", onContextMenu, true);
        document.addEventListener("keydown", onKeyDown, true);
        document.addEventListener("mousedown", onPointerDown, true);
        document.addEventListener("scroll", onScroll, true);
        window.addEventListener("blur", onScroll);
        window.addEventListener("resize", onScroll);
        return () => {
          window[ACTIVE_KEY] = false;
          document.removeEventListener("contextmenu", onContextMenu, true);
          document.removeEventListener("keydown", onKeyDown, true);
          document.removeEventListener("mousedown", onPointerDown, true);
          document.removeEventListener("scroll", onScroll, true);
          window.removeEventListener("blur", onScroll);
          window.removeEventListener("resize", onScroll);
        };
      }, []);

      if (!menu) return null;
      return h("div", { ref: menuRef }, h(MenuView, { menu, onAction: close }));
    }

    return {
      inject: ["slots"],
      apply(ctx) {
        ctx.slots.inject("shell.overlay", () => ctx.slots.register({
          name: "shell.overlay", id: "rdsh-open-with", order: 80,
        }, OpenWithOverlay));
      },
    };
  },
});
