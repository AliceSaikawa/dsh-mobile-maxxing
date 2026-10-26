# dsh-mobile-maxxing

DeepSeek Harness（DSH）の Web UI をスマホで最大限に使い倒すための統合プラグインです。
PWA・通知・モバイルUX・セッションIDのコピーを1パッケージにまとめています。
CJK表示の修正は、PC 側の描画を変えない方針のため別パッケージ `rdsh-markdown-cjk` に分離しています。
**素の DSH にそのまま入ります** — コア機能に他の `rdsh-*` プラグインや外部 npm パッケージは不要です。

> English: [Jump to the English section](#english)

## インストール


```sh
dsh plugin --profile web add https://github.com/kuraneko1/dsh-mobile-maxxing
# DSH を再起動して読み込む（例: systemctl --user restart dsh-web.service）
```

これだけです。`dsh plugin --profile web add` が依存と bundle の両方を更新します
（`--profile` は必須で、`cd ~/.dsh/profiles/web` は要りません）。
追加のプラグインも、通知用ライブラリも要りません。

## できること

| 機能 | 内容 |
| --- | --- |
| インストール可能な PWA | ホーム画面に追加、オフライン起動、更新のお知らせ |
| 通知 | アプリを見ている間はアプリ内バナー、それ以外は Web Push |
| 通知音 | 合成した5種類。音量も設定可。音声ファイルは同梱しません |
| スマホ/タブレットのレイアウト | サイドバーがドロワーに、設定は1タップ、コードは既定で折り返し（解除可）。幅ではなく端末で判定 |
| チャット表示（この端末のみ） | 作業の詳細・完了ターンの折りたたみ・実行中の Enter・性能表示を、この端末だけ上書き（共有設定は変更しない） |
| モバイル操作の細部 | ターミナルだけダーク、上端スクロールで過去ログを自動読み込み、Trajectory タブの非表示、右パネルの見出し、ファイル検索のクリア、モデルメニューのセーフエリア、左端スワイプで戻る |
| CJK 表示の修正（任意） | 別パッケージ `rdsh-markdown-cjk` を入れた場合のみ。このパッケージ本体は PC 側を変えないため、Markdown レンダラを書き換えません |
| セッションIDのコピー | セッションメニューに1行追加 |

## もっと詳しく

- **日本語**: [`packages/dsh-mobile-maxxing/docs/USAGE.ja.md`](packages/dsh-mobile-maxxing/docs/USAGE.ja.md)
- **English**: [`packages/dsh-mobile-maxxing/docs/USAGE.en.md`](packages/dsh-mobile-maxxing/docs/USAGE.en.md)

パッケージ単体の説明は [`packages/dsh-mobile-maxxing/README.md`](packages/dsh-mobile-maxxing/README.md) です。

## 開発

```sh
npm test                    # Node.js のテスト + 任意の Chrome CSS fixture 3件
node scripts/pack-all.mjs   # dist/ に tarball を作る
```

各パッケージは `packages/<name>/` に閉じています。共通のビルド工程はありません
（クライアント側は生の JS をそのまま配信し、ホスト側は Node 標準モジュールだけで動きます）。

チェックアウトをそのまま使う場合（依存と bundle の両方が入ります）:

```sh
dsh plugin --profile web add link:/path/to/dsh-mobile-maxxing
```

## リリース

```sh
node scripts/pack-all.mjs
gh release create vX.Y.Z dist/*.tgz
```

`dist/` には版付き（`dsh-mobile-maxxing-<version>.tgz`）と版なし（`dsh-mobile-maxxing.tgz`）の両方ができます。

**README が指すのは版付きの URL です。** 版なしの `releases/latest/download/dsh-mobile-maxxing.tgz` は
人が手で落とすには便利ですが、`dsh plugin --profile web add`（pnpm）は URL 単位でキャッシュするため、
同じ URL のまま更新すると古い tarball が入ります。版付き URL ならリリースごとに別 URL になり、
この問題が起きません。

README の URL は `node scripts/pack-all.mjs` が `package.json` の版に合わせて書き換えます。

---

# English

One integrated plugin that makes the DSH (DeepSeek Harness) Web UI pleasant on phones and tablets:
installable PWA, notifications, a phone/tablet layout chosen by device mode and a session-id copy row.
The CJK autolink fix stays a separate package (`rdsh-markdown-cjk`) because this package deliberately
leaves the PC renderer untouched. **It installs on a stock DSH** — the core needs no other `rdsh-*`
plugin and no external npm package.

## Install


```sh
dsh plugin --profile web add https://github.com/kuraneko1/dsh-mobile-maxxing
# then restart DSH to load it (e.g. systemctl --user restart dsh-web.service)
```

That is all: `dsh plugin --profile web add` updates both the dependency and the bundle list
(`--profile` is required; the `cd ~/.dsh/profiles/web` is not). No companion plugin and no
push library are needed.

## What it does

| Feature | Detail |
| --- | --- |
| Installable PWA | Add to home screen, offline launch, update notice |
| Notifications | In-app banner while the app is on screen, Web Push otherwise |
| Notification sounds | Five synthesised presets with a volume control; no audio files ship |
| Mobile layout | Sidebar becomes a drawer, settings open in one tap, code wraps by default (toggle available) |
| Chat view (this device) | Work-details verbosity, turn collapse, Enter while a turn runs and performance detail overridden for this browser only; the Host setting is untouched |
| Mobile polish | Terminal-only dark, older history on scroll-to-top, hidden Trajectory tab, right-panel heading, file-search clear, model-menu safe area, left-edge swipe back |
| CJK rendering (optional) | Only with the separate `rdsh-markdown-cjk` package; this package leaves the Markdown renderer stock to avoid changing the PC |
| Session id copy | One row in the session row menu |

## More detail

- **English**: [`packages/dsh-mobile-maxxing/docs/USAGE.en.md`](packages/dsh-mobile-maxxing/docs/USAGE.en.md)
- **日本語**: [`packages/dsh-mobile-maxxing/docs/USAGE.ja.md`](packages/dsh-mobile-maxxing/docs/USAGE.ja.md)

## Development

```sh
npm test                    # Node.js tests + optional Chrome CSS fixture tests (3)
node scripts/pack-all.mjs   # build the tarballs into dist/
```

There is no shared build step: the browser halves are served verbatim and the host halves use
only Node built-ins.

## Release

```sh
node scripts/pack-all.mjs
gh release create vX.Y.Z dist/*.tgz
```

`dist/` holds both a versioned tarball (`dsh-mobile-maxxing-<version>.tgz`) and a version-free alias
(`dsh-mobile-maxxing.tgz`).

**The READMEs link the versioned URL.** The alias
(`releases/latest/download/dsh-mobile-maxxing.tgz`) is handy for a manual download, but
`dsh plugin --profile web add` (pnpm) caches by URL, so updating behind the same URL installs the old
tarball. A versioned URL changes every release and avoids that.

`node scripts/pack-all.mjs` rewrites the URLs in the READMEs to match `package.json`.

## License

MIT. See [LICENSE](LICENSE).
