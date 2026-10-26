# Known issues

## iOS 27 standalone: 上端のブラー（`appleStatusBarStyle: "default"` でのみ解消）

- 2026-10-26
- 上端に高さ 11px の固定要素を置き、`background-clip: text` で何も描かずに WebKit の上端判定だけを満たす（詳細は USAGE.ja.md「iOS 27 の上端ブラー」）。
- iPhone 実機（iOS 27.2）では、既定の `black-translucent` のままだとブラーは消えない。`"default"` にしてアイコンを追加し直すと消える。既定値は `black-translucent` のままで、変えるかは未決定である。
- ライトモードでのステータスバーの文字色と、iOS 26 で `"default"` にしたときの表示は未確認である。

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

## #80 翻訳パイプライン（翻訳は完了、本番profile導入・実機は未確認）

- 2026-10-26
- モバイルパッケージは `ja` の `addLanguage` / `register` と `__RDSH_PWA_LOCALES__` の注入を持たない。`COPY.ja` はこのパッケージ自身の UI 文言（manifest・SW・通知など）専用で、共有ロケールの辞書ではない。端末の「表示言語」は共有ロケールサービスに登録済みの言語だけを出し、PC は何も変えない。
- `rdsh-locale-ja` が `ja` の言語・名前空間の唯一の所有者である。モバイルの tarball には含まれず、依存にも bundle にも入らず、自動で有効化されない。別途ローカルの tarball から入れた場合だけ `ja` が増える。両方を入れても二重登録は起きない。共有の表示言語は書き換えず、この端末だけの投影に留める。
- 翻訳は完了している。64 名前空間 / 2906 キーのすべてにレビュー済みの日本語値があり、英語フォールバックは 0（`translation-status.json` は `complete`）。移行済みの 83 値（`common` 41、`settings` 41、`settings.locale` 1）はそのまま維持し、残りの 2823 キーは 94 バッチに分けて独立レビューしたうえでマージした。数値の正は `packages/rdsh-locale-ja/locale/translation-status.json` である。
- モバイル側の ja 表示は実辞書で回帰固定している。idle のサブエージェント件数は名詞先（「サブエージェント 3 件」）、phone で隠すコントロールと分割（「分割」）はコミット済み ja 名前空間のラベルで照合し、デスクトップでは hide が no-op であることもテストで固定する。
- profile 順で `rdsh-locale-ja` が後から有効になっても、`locale/change` に加えて公開 `localeService.subscribe()` の store の再publish で追従する。カタログ・端末の選択意思・dispose を保全し、取り下げは System へ戻して再追加で再適用、dispose は最新の Host 表示だけを復元する（外部で取り下げた `ja` を復活させない）。
- Host がこの端末の投影言語へ通知なしに切り替わると `LocaleRuntime.adopt` はイベントを出さない。復元は DSH 0.2.1-rc.2 の `resolveActive()`（runtime-callable だが d.ts では private）を読み取り専用で参照する。この関数が不在・throw・未登録 ID を返す場合は最後に publish された baseline に fallback するため、無通知の変化は検知できない。`write`/`setLocale` は呼ばず、将来の SDK がこの内部 API を保証する前提も置かない。
- 投影 revision は Host の数値（125）のまま `Object(125)` の identity token として公開し、revision の同一性で再描画する mounted text/slot cache を更新する。`<=`・`+ 1`・JSON は数値と同じで、System/dispose では primitive な Host snapshot に戻す。SDK の public 型 `number` から object への局所 adapter であり、rc.2 の実 consumer は検証済みだが `typeof number` / `Number.isInteger` を前提とする第三者・将来 SDK には非互換で、一般保証はしない。Host への write・偽 `locale/change`・数値 revision の増加は行わず、source の `SHORTCUT(#80)` にも明記している。
- `scripts/pack-all.mjs` は `translation-status.json` が 64/2906・翻訳 2906・fallback 0・`complete` でない限り別の locale tarball を作らない。不完全な状態では `REFUSED` を表示して tarball を作らず、英語フォールバックの pack を黙って配布しない。`--require-locale` を付けたときだけその拒否を失敗にする。現在の status は `complete` なのでこのガードは通るが、リリース用の URL はなく、ローカルの tarball からのみ入れる。
- バッチレビューとマージは完了した（97 バッチのうち、seed 83 値を含む 3 バッチを除く 94 バッチ・2823 キーをマージ）。生成クライアントの登録は、実物の ClientModuleSystem と上流 locale bundle を使った隔離 Chrome で `modules.import` が成功し、64 名前空間 / 2906 キー / 65 disposers を確認済みである。GUI での確認は隔離した source 置換の証跡として #70 で別管理し、本番 profile への導入・実機確認とは区別する。この文書はリリース・本番導入・実機の成功を主張しない。
