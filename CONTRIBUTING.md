# 開発メモ

## 構成

```
packages/<name>/     各プラグイン（単体の npm パッケージ）
scripts/pack-all.mjs 配布用 tarball を dist/ にまとめる
```

パッケージ同士は依存しません。`rdsh-mobile-ux` は `rdsh-pwa` と併用すると
通知のアプリ内バナーが使えますが、無くても動きます。

## 共通の決まり

- **ホスト側は Node 標準モジュールだけ**を使う（`@deepseek-ai/*` は DSH が提供するもののみ）
- **クライアント側**は `require("react")` / `require("react-dom/client")` /
  `require("@deepseek-ai/dsh-client-ui-primitives")` の3つだけ
- 上流の CSS Modules のハッシュ名は**直接書かない**。構造（`data-*` / `aria-label` / `role`）から
  フックを付けて、CSS はフックだけを見る（上流が変わったら標準のまま動く = fail closed）
- グローバルは自分の名前空間（`__RDSH_*`）だけを使い、読むときは `typeof` で確認する

## テスト

```sh
pnpm test                      # 全部
cd packages/rdsh-pwa && npm test   # 1つだけ
```

`dsh-esc-stop` のホスト側テストは DSH が同梱する `@deepseek-ai/schemastery` を使うため、
DSH の外では skip になります。

## リリース

```sh
node scripts/pack-all.mjs
gh release create v0.1.0 dist/*.tgz
```

`dist/` の tarball をそのまま添付します。ファイル名は `<name>-<version>.tgz` で固定です
（各 README のインストール手順がこの名前を指しています）。

## 元になったリポジトリ

統合前の履歴は以下に残しています（このリポジトリは中身を持ち寄った新しい出発点です）。

- `kuraneko1/DSH-PWA`（`rdsh-pwa` / `rdsh-mobile-ux`）
- `kuraneko1/rdsh-markdown-cjk`
- `jimoto-no-llm/rustdsh`（`rdsh-answer-guard`）
- ローカルのみだったもの: `rdsh-open-with` / `rdsh-session-id-copy` / `dsh-esc-stop`
