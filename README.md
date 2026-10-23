# dsh-mobile-maxxing

DeepSeek Harness（DSH）の Web UI をスマホで最大限に使い倒すための統合プラグインです。
PWA・通知・モバイルUX・CJK表示の修正・セッションIDのコピーを1パッケージにまとめています。
**素の DSH にそのまま入ります** — 他の `rdsh-*` プラグインや外部 npm パッケージは不要です。

> English: [Jump to the English section](#english)

## インストール

```sh
cd ~/.dsh/profiles/web
dsh plugin add https://github.com/kuraneko1/dsh-mobile-maxxing/releases/latest/download/rdsh-pwa.tgz
# DSH を再起動（例: systemctl --user restart dsh-web.service）
```

これだけです。`dsh plugin add` が依存と bundle の両方を更新します。
追加のプラグインも、通知用ライブラリも要りません。

## できること

| 機能 | 内容 |
| --- | --- |
| インストール可能な PWA | ホーム画面に追加、オフライン起動、更新のお知らせ |
| 通知 | アプリを見ている間はアプリ内バナー、それ以外は Web Push |
| 通知音 | 合成した5種類。音量も設定可。音声ファイルは同梱しません |
| スマホ幅のレイアウト | サイドバーがドロワーに、設定は1タップ、コードは折り返し |
| CJK 表示の修正 | `**https://x**（メモ）` の太字とリンクが壊れない |
| セッションIDのコピー | セッションメニューに1行追加 |

## もっと詳しく

- **日本語**: [`packages/rdsh-pwa/docs/USAGE.ja.md`](packages/rdsh-pwa/docs/USAGE.ja.md)
- **English**: [`packages/rdsh-pwa/docs/USAGE.en.md`](packages/rdsh-pwa/docs/USAGE.en.md)

パッケージ単体の説明は [`packages/rdsh-pwa/README.md`](packages/rdsh-pwa/README.md) です。

## 開発

```sh
npm test                    # テスト46件（ブラウザ不要）
node scripts/pack-all.mjs   # dist/ に tarball を作る
```

各パッケージは `packages/<name>/` に閉じています。共通のビルド工程はありません
（クライアント側は生の JS をそのまま配信し、ホスト側は Node 標準モジュールだけで動きます）。

チェックアウトをそのまま使う場合:

```sh
ln -sfn /path/to/dsh-mobile-maxxing/packages/rdsh-pwa ~/.dsh/profiles/web/node_modules/rdsh-pwa
```

## リリース

```sh
node scripts/pack-all.mjs
gh release create vX.Y.Z dist/*.tgz
```

`dist/` には版付き（`rdsh-pwa-0.2.4.tgz`）と版なし（`rdsh-pwa.tgz`）の両方ができます。
README は**版なし**を指しているので、`releases/latest/download/rdsh-pwa.tgz` が常に最新を返します。

---

# English

One integrated plugin that makes the DSH (DeepSeek Harness) Web UI pleasant on a phone:
installable PWA, notifications, phone-width layout, a CJK rendering fix and a session-id copy
row. **It installs on a stock DSH** — no other `rdsh-*` plugin and no external npm package.

## Install

```sh
cd ~/.dsh/profiles/web
dsh plugin add https://github.com/kuraneko1/dsh-mobile-maxxing/releases/latest/download/rdsh-pwa.tgz
# then restart DSH (e.g. systemctl --user restart dsh-web.service)
```

That is all: `dsh plugin add` updates both the dependency and the bundle list. No companion
plugin and no push library are needed.

## What it does

| Feature | Detail |
| --- | --- |
| Installable PWA | Add to home screen, offline launch, update notice |
| Notifications | In-app banner while the app is on screen, Web Push otherwise |
| Notification sounds | Five synthesised presets with a volume control; no audio files ship |
| Phone layout | Sidebar becomes a drawer, settings open in one tap, code wraps |
| CJK rendering | `**https://x**（memo）` keeps its bold and its link |
| Session id copy | One row in the session row menu |

## More detail

- **English**: [`packages/rdsh-pwa/docs/USAGE.en.md`](packages/rdsh-pwa/docs/USAGE.en.md)
- **日本語**: [`packages/rdsh-pwa/docs/USAGE.ja.md`](packages/rdsh-pwa/docs/USAGE.ja.md)

## Development

```sh
npm test                    # 46 tests, no browser required
node scripts/pack-all.mjs   # build the tarballs into dist/
```

There is no shared build step: the browser halves are served verbatim and the host halves use
only Node built-ins.

## Release

```sh
node scripts/pack-all.mjs
gh release create vX.Y.Z dist/*.tgz
```

`dist/` holds both a versioned tarball (`rdsh-pwa-0.2.4.tgz`) and a version-free alias
(`rdsh-pwa.tgz`). The READMEs link the alias, so `releases/latest/download/rdsh-pwa.tgz`
always serves the newest build.

## License

MIT. See [LICENSE](LICENSE).
