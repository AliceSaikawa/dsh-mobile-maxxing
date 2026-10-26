# Known issues

## 修正済み: #59 横画面のナビを "More" に畳む

- 2026-10-26
- モバイルモードかつ横画面（幅 > 高さ）のときだけ、Plugins / Automation tasks / Settings の3行を1つの More 行に畳む。縦向き・PC・dispose では More を削除して元の行を復元する。
- More は `aria-haspopup="menu"`、メニューは `role="menu"` / `role="menuitem"`。クリックまたは Enter で開き、項目選択・Escape・外側クリック・回転/リサイズで閉じる。Escape は More にフォーカスを戻し、矢印/Home/End で項目を移動できる。
- 3行は DOM に残して非表示属性だけを付ける。単一の Settings 行（#87）は従来どおり再利用され、追加・重複しない。
- ドロワー幅（左右インセット込み）、右パネルとファイルツリー（上流の安定したパネル面にパディング）、ルート戻るボタンのセーフエリアも同じ #59 で修正済み。
- 実機での最終確認（回転直後・キーボード開閉後を含む）は別途行う。

## #73 端末テーマ: 共有テーマが同期的に一瞬書かれる

- 2026-10-26
- 保存した端末テーマは `theme` サービスの解決後に適用する。初回起動だけでなく、文字サイズを変更したときにも、共有テーマ（Dark）が同期的に一瞬書かれ、その後の microtask で端末テーマ（Light）に戻る現象を観測している。rAF 時点の最終的な配色は正しい。
- 実機での物理的な flash は未検証であり、読み込み順・解決順のどこで抑えるかも未確定である。

## #76 キーボードを閉じた後の実機症状（未確認）と rc.2 で検証した DOM フック

- 2026-10-26
- iPadOS の standalone でソフトキーボードを閉じた後に、下端の空白や古いジオメトリが残るという報告がある。プラグイン側には focusout・visibilitychange・blur/focus での再計測を実装したが、報告された実機症状が解消したかは未確認・未検証である。
- [WebKit 192564](https://bugs.webkit.org/show_bug.cgi?id=192564) と [WebKit 254861](https://bugs.webkit.org/show_bug.cgi?id=254861) は症状が似た参考資料であり、この端末の同一原因を証明するものではない。iOS 26 の下端のラバーバンド（[WebKit 301994](https://bugs.webkit.org/show_bug.cgi?id=301994)）も同様に参考情報で、原因の同一性は未確認である。
- モバイル用の DOM フックは DSH `0.2.1-rc.2` で検証している。上流が変わるとフックが付かず、該当する機能が効かなくなる可能性がある（影響は機能ごとに異なる）。

## #80 翻訳パイプライン（翻訳は完了、実GUI・実profile・実機は未検証）

- 2026-10-26
- モバイルパッケージは `ja` の `addLanguage` / `register` と `__RDSH_PWA_LOCALES__` の注入を持たない。`COPY.ja` はこのパッケージ自身の UI 文言（manifest・SW・通知など）専用で、共有ロケールの辞書ではない。端末の「表示言語」は共有ロケールサービスに登録済みの言語だけを出し、PC は何も変えない。
- `rdsh-locale-ja` が `ja` の言語・名前空間の唯一の所有者である。モバイルの tarball には含まれず、依存にも bundle にも入らず、自動で有効化されない。別途ローカルの tarball から入れた場合だけ `ja` が増える。両方を入れても二重登録は起きない。共有の表示言語は書き換えず、この端末だけの投影に留める。
- 翻訳は完了している。64 名前空間 / 2906 キーのすべてにレビュー済みの日本語値があり、英語フォールバックは 0（`translation-status.json` は `complete`）。移行済みの 83 値（`common` 41、`settings` 41、`settings.locale` 1）はそのまま維持し、残りの 2823 キーは 94 バッチに分けて独立レビューしたうえでマージした。数値の正は `packages/rdsh-locale-ja/locale/translation-status.json` である。
- `scripts/pack-all.mjs` は `translation-status.json` が 64/2906・翻訳 2906・fallback 0・`complete` でない限り別の locale tarball を作らない。不完全な状態では `REFUSED` を表示して tarball を作らず、英語フォールバックの pack を黙って配布しない。`--require-locale` を付けたときだけその拒否を失敗にする。現在の status は `complete` なのでこのガードは通るが、リリース用の URL はなく、ローカルの tarball からのみ入れる。
- バッチレビューとマージは完了した（97 バッチのうち、seed 83 値を含む 3 バッチを除く 94 バッチ・2823 キーをマージ）。生成クライアントの登録は、実物の ClientModuleSystem と上流 locale bundle を使った隔離 Chrome で `modules.import` が成功し、64 名前空間 / 2906 キー / 65 disposers を確認済みである。ただし実 GUI との併用は別作業で検証中で、実 profile への導入・実機確認は未検証である。根拠はこのリポジトリのテスト・生成とこの隔離検証に置き、リリース・実 GUI・実機・本番導入の成功は主張しない。
