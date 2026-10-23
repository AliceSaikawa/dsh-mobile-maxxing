# 開発メモ

## 構成

```
packages/rdsh-pwa/    単一のプラグイン（1パッケージ・1インストール）
  index.js            ホスト側の入口。6つの host half をここから mount する
  client.js           ブラウザ側。6つの機能を1モジュールにまとめてある
  lib/                ホスト側の各機能
  notify/             Web Push（VAPID + aes128gcm の自前実装）
  sw.js               サービスワーカー
scripts/pack-all.mjs  配布用 tarball を dist/ にまとめる
```

### なぜ1パッケージなのか

DSH のクライアントモジュールシステムは**1パッケージ＝1ブラウザモジュール**です。
別パッケージに分けると、その分だけ別モジュールとして登録され、インストール・設定・
有効化がすべて分散します。もともと別々だった4つのプラグイン（`rdsh-pwa` /
`rdsh-mobile-ux` / `rdsh-open-with` / `rdsh-session-id-copy`）と、ホスト専用だった
`rdsh-markdown-cjk` は、この理由で1つにまとめました。

`client.js` は「もとの各プラグインの `factory` 本体をそのまま関数に包んだもの」を
連結した形です。各部は自分で `{ inject, apply }` を返し、末尾の `apply` が順に呼びます。
機能を足すときは、同じ形で1ブロック足してください。

## 共通の決まり

- **ホスト側は Node 標準モジュールだけ**を使う（`@deepseek-ai/*` は DSH が提供するもののみ）
- **クライアント側**は `require("react")` / `require("react-dom/client")` /
  `require("@deepseek-ai/dsh-client-ui-primitives")` の3つだけ
- 上流の CSS Modules のハッシュ名は**直接書かない**。構造（`data-*` / `aria-label` / `role`）から
  フックを付けて、CSS はフックだけを見る（上流が変わったら標準のまま動く = fail closed）
- グローバルは自分の名前空間（`__RDSH_*`）だけを使い、読むときは `typeof` で確認する
- **任意サービスはプロパティで触らない**。cordis は未注入のサービスにプロパティアクセスすると
  例外を投げるので、`ctx.get("name")` を try で包んで読む（`lib/open-with.js` の
  `readOptionalService` を参照）

## ホスト側の mount

`index.js` は各機能を `mountPart(label, services, mount, settings)` で呼びます。

- `services` は**その機能が実際に必要なものだけ**にする（要求しすぎると、そのサービスが無い
  プロファイルで mount に失敗する）
- 1つ失敗しても他と PWA シェルは止まらない（`try/catch` で包んである）

## テスト

```sh
npm test                                  # 全部（37件）
node --test packages/rdsh-pwa/tests/plugin.test.mjs   # 1ファイルだけ
```

`tests/e2e.mjs` は実ブラウザでの確認用で、`npm test` には含めていません。

## リリース

```sh
node scripts/pack-all.mjs
gh release create v0.2.0 dist/*.tgz
```

ファイル名は `<name>-<version>.tgz` で固定です（README のインストール手順がこの名前を指しています）。

## 元になったリポジトリ

統合前の履歴は以下に残しています。

- `kuraneko1/DSH-PWA` — `rdsh-pwa` / `rdsh-mobile-ux`
- `kuraneko1/rdsh-markdown-cjk`
- ローカルのみだったもの: `rdsh-open-with` / `rdsh-session-id-copy`

`rdsh-answer-guard` と `dsh-esc-stop` は含めていません。前者は上流修正で不要になる
暫定措置で作者も単独ではないため、後者はデスクトップ向けのキーボード操作で
`hikarioyama/Smart-DSH` の作のためです。
