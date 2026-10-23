# dsh-mobile-maxxing

DeepSeek Harness（DSH）の Web UI をスマホで最大限に使い倒すための統合プラグインです。
**素の DSH にそのまま入ります** — 他の `rdsh-*` プラグインや外部 npm パッケージは不要です。

## 何が入るか

**1パッケージ・1インストール**です。中身は次の6つで、すべて `rdsh-pwa` の中で動きます。

| 機能 | 内容 |
| --- | --- |
| PWA | ホーム画面にインストール可能化、オフライン起動、更新通知 |
| 通知 | 前面ならアプリ内バナー、背面なら Web Push。通知音5種 |
| スマホUX | ドロワー、設定の1タップ表示、入力欄、コード表示の折り返し |
| CJK表示 | `**https://x**（メモ）` のような自動リンク崩れを修正 |
| 外部アプリで開く | トランスクリプトのパス/URL を右クリックして開く |
| セッションIDのコピー | セッションメニューに1行追加 |

分けていない理由は、DSH のクライアントモジュールシステムが**1パッケージ＝1ブラウザモジュール**
だからです。別々のパッケージにすると、その分だけ別モジュールとして登録され、インストールも
設定も分散します。もともと別々だったプラグインを1つにまとめた経緯は
[`packages/rdsh-pwa/README.md`](packages/rdsh-pwa/README.md) に書いてあります。

## インストール

```sh
cd ~/.dsh/profiles/web
dsh plugin add \
  https://github.com/kuraneko1/dsh-mobile-maxxing/releases/download/v0.2.0/rdsh-pwa-0.2.0.tgz
# DSH を再起動（環境に合わせて）
systemctl --user restart dsh-web.service
```

`dsh plugin add` が `package.json` の依存と `dsh.profile.bundles` の両方を更新します。

手で書く場合:

```json
{
  "dependencies": {
    "rdsh-pwa": "https://github.com/kuraneko1/dsh-mobile-maxxing/releases/download/v0.2.0/rdsh-pwa-0.2.0.tgz"
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

外すときは依存と bundle から `rdsh-pwa` を消して再起動するだけです。

## 開発

```sh
npm test                      # パッケージのテスト（37件）
node scripts/pack-all.mjs     # dist/ に tarball を作る
```

**ビルド工程はありません。** `client.js` はブラウザにそのまま配信され、`index.js` は
Node 標準モジュールだけで動きます。`client.js` は6つの機能を1つのモジュールにまとめた
ファイルで、冒頭に各部の出どころが書いてあります。

ローカルのチェックアウトをそのまま使う場合:

```sh
ln -sfn /path/to/dsh-mobile-maxxing/packages/rdsh-pwa ~/.dsh/profiles/web/node_modules/rdsh-pwa
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
にまとめています（作者名も記載）。コードの流用はしていません。

## ライセンス

MIT。[`LICENSE`](LICENSE) を参照してください。
