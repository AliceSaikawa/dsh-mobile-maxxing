# rdsh-open-with

dsh web GUI に表示されている **ファイルパス**・**URL** を右クリックして、
新しいタブ・デスクトップアプリ・親フォルダで開くためのプラグイン。

## できること

トランスクリプト・サイドバー・コードブロックなど、GUI 内のどこでも右クリックすると、
クリック位置・選択テキスト・リンクから対象を推定してメニューを出す。

- 選択テキストがパス/URL → それを対象にする
- `<a href>` 上 → リンクを対象にする
- それ以外 → クリックした文字位置のトークン（句読点・空白で区切られた連続）を対象にする

メニュー項目（対象の種類に応じて出し分け）:

| 対象 | 項目 |
| --- | --- |
| URL | 新しいタブで開く / URLをコピー |
| ファイル | 新しいタブで開く（previewable な型のみ）/ ダウンロード / アプリで開く / 親フォルダをアプリで開く / パスをコピー |
| ディレクトリ | フォルダをアプリで開く / パスをコピー |

末尾の `:24` / `:24-30` / `#L24` 行参照は剥がして存在確認する
（開く対象は常にファイル本体）。

### 相対パス・basename

- chat の「Edited `<name>`」chip や workspace 相対パス（`repo/foo.rs` など）も
  右クリック対象になる。`foo.rs:24` `src/main.rs#L99` `.gitignore` なども拾う
- これらは**現在表示中の Session の cwd** 基準で解決する。クライアントが
  `probe` に `root=<session cwd>` を渡し、サーバー側はそれを使って解決する
  （`config.workspaceRoot` はクライアントが root を送れないときの既定）
- 相対パスに `..` は許さない（root を出ない範囲に留める）
- 絶対パスは workspace の内外を問わず開ける
- 実在が確認できるまでメニューは出さない。確認できなければ何も出さず、
  既定のブラウザメニューも奪わない（`v0.3.3` や `example.com` のような
  地の文を候補にしないため、ディレクトリ付き or 既知の拡張子のときだけ
  basename を候補にする）

## 動作仕様

### クライアント（client.js）

- `document` の capture 段で `contextmenu` を 1 本取る
- 対象が見つからない場合・入力欄・contenteditable 上では `preventDefault` せず
  既定のブラウザメニューを残す
- 相対/basename 候補は、Session の cwd で probe が実在を確認してからメニューを出す
  （先に出して結果で閉じると「一瞬表示して消える」になるため）
- ファイルの存在・種類は `GET /api/rdsh-open-with/probe` で確認してから項目を決める
- ローカルファイルの「新しいタブで開く」は `file://` ではなく
  `GET /api/rdsh-open-with/file?path=...` 経由
  （ブラウザは http ページから file:// への遷移を止めるため）

### ホスト（index.js）

認証は `ctx.connection.requestRejection`（他の rdsh プラグインと同じ）。

- `GET /api/rdsh-open-with/probe?path=<abs>[&root=<abs>]`
  - `{ ok, exists, isDir, isFile, size, mime, inline }`
  - `root` は相対パスの解決基準（Session の cwd）。絶対パスでなければ無視する
- `GET /api/rdsh-open-with/file?path=<abs>`
  - 既知の型（html/css/js/json/画像/pdf/テキスト系）は inline で配信。
    html は `content-security-policy: sandbox` を付けて GUI origin へのアクセスを遮断。
    未知の型・サイズ超過は `attachment`。
  - 全レスポンスに `x-content-type-options: nosniff`、`cache-control: no-store`
- `POST /api/rdsh-open-with/open` `{ target: <abs>, parent?: bool }`
  - 設定の `opener`（既定 `xdg-open`）を spawn（シェルは介さず、引数は配列）。
    `parent: true` で `dirname(target)` を開く

パスは `~` を home に展開する。絶対パスのみ受け付ける（`..` は `resolve` で正規化）。
相対パス・basename は `root`（無ければ `workspaceRoot`）基準で解決する（上記）。
コロン付きファイル名が実在する場合は行参照として剥がさない
（`stat` で実在しないときだけ suffix を取り除いて再試行）。

### ホストコードの変更について

`dsh web` プロセスは ESM モジュールキャッシュを持つ。**ホスト側 (index.js) の
コード変更はプロセス再起動まで反映されない**（新規プラグイン追加時のみ即時）。
クライアント (client.js) は内容rev付きで配信されるためページリロードで更新される。

## 設定（cordis.patch.yml）

```yaml
- insert:
    - id: rdsh-open-with
      name: "rdsh-open-with"
      config:
        opener: "xdg-open"     # アプリ起動コマンド
        maxInlineBytes: 10485760 # インライン表示の上限
        # workspaceRoot: "/path" # 相対パス解決の base（既定: sandboxPolicy.workspaceRoot）
```

## セキュリティ上の注意

- エンドポイントは認証済みリクエストしか通さないが、**サーバーの権限で任意の
  ローカルファイルを読める**。単一ユーザー向けのローカル運用を前提とする。
  マルチユーザー・公開暴露面のある環境では有効にしないこと。
- HTML は sandbox CSP 付きだが、ブラウザが `sandbox` を完全に隔離とみなす
  （同一 origin のクッキー・ストレージには触れない）点に留まる。
