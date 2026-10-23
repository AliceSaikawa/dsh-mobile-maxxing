# dsh-extensions

DeepSeek Harness（DSH）の拡張プラグイン置き場です。**素の DSH にそのまま入ります** —
他の `rdsh-*` プラグインや外部 npm パッケージは不要です。

## パッケージ

| パッケージ | 役割 | 前提 |
| --- | --- | --- |
| [`rdsh-pwa`](packages/rdsh-pwa) | Web UI をインストール可能なアプリにする。オフライン起動、通知（Web Push）、通知音 | なし |
| [`rdsh-mobile-ux`](packages/rdsh-mobile-ux) | スマホ幅のUX。ドロワー、設定、入力、コード表示、通知のアプリ内バナー | `rdsh-pwa` と併用が前提（単体でも動く） |
| [`rdsh-markdown-cjk`](packages/rdsh-markdown-cjk) | CJK の自動リンク崩れを直す（`**https://x**（メモ）` など） | なし |
| [`rdsh-open-with`](packages/rdsh-open-with) | セッションメニューに「外部アプリで開く」を足す | なし |
| [`rdsh-session-id-copy`](packages/rdsh-session-id-copy) | セッションメニューからセッションIDをコピーする | なし |
| [`rdsh-answer-guard`](packages/rdsh-answer-guard) | 推論だけ返して本文が空のターンを検出してやり直させる | なし |
| [`dsh-esc-stop`](packages/dsh-esc-stop) | Esc キーで実行中のターンを止める | なし |

## インストール

各パッケージは単体の npm パッケージです。使うものだけ入れてください。

```sh
cd ~/.dsh/profiles/web

# 例: PWA とスマホUX
dsh plugin add \
  https://github.com/kuraneko1/dsh-extensions/releases/download/v0.1.0/rdsh-pwa-0.1.0.tgz \
  https://github.com/kuraneko1/dsh-extensions/releases/download/v0.1.0/rdsh-mobile-ux-0.1.0.tgz

# DSH を再起動（環境に合わせて）
systemctl --user restart dsh-web.service
```

`dsh plugin add` が `package.json` の依存と `dsh.profile.bundles` の両方を更新します。

手で書く場合:

```json
{
  "dependencies": {
    "rdsh-pwa": "https://github.com/kuraneko1/dsh-extensions/releases/download/v0.1.0/rdsh-pwa-0.1.0.tgz"
  },
  "dsh": {
    "profile": {
      "bundles": ["...", "rdsh-pwa"]
    }
  }
}
```

```sh
npm install        # プロファイル内。pnpm でも可
```

## 開発

```sh
pnpm install          # ワークスペースの依存を解決
pnpm test             # 全パッケージのテスト
node scripts/pack-all.mjs   # dist/ に全 tarball を作る
```

各パッケージは `packages/<name>/` に閉じています。共通のビルド手順はありません
（クライアント側は生の JS をそのまま配信し、ホスト側は Node 標準モジュールだけで動きます）。

ローカルのチェックアウトをそのまま使う場合:

```sh
ln -sfn /path/to/dsh-extensions/packages/rdsh-pwa ~/.dsh/profiles/web/node_modules/rdsh-pwa
```

## 通知について

`rdsh-pwa` は Web Push（VAPID + `aes128gcm`）を `node:crypto` だけで実装しています。
通知は次のように出し分けます。

| アプリの状態 | 通知 |
| --- | --- |
| 画面に表示中 | アプリ内バナー（`rdsh-mobile-ux` が描画）。OS通知は出さない |
| 背面・終了 | Web Push による OS 通知 |

以前使っていた `dsh-notify-push` とは API もサービスワーカーも共有しません。
詳しくは [`packages/rdsh-pwa/README.md`](packages/rdsh-pwa/README.md) を参照してください。

## クレジット

設計の参考にした実装は [`packages/rdsh-pwa/README.md` のクレジット](packages/rdsh-pwa/README.md#クレジット)
にまとめています。コードの流用はしていません。

## ライセンス

MIT。[`LICENSE`](LICENSE) を参照してください。
