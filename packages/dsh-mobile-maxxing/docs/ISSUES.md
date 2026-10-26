# Known issues

## #59 横画面のナビを "more" に畳む（未実装・設計項目）

- 2026-10-26
- 横画面で Plugins / Automation tasks / Settings のナビが幅を取りすぎる、という実機報告。
- 上流に既存の overflow / more メニューが無いため、行の移動・開閉状態・キーボード操作・現在地表示まで設計が必要。セーフエリアの修正とは分離し、実機で幅と操作を確認してから別 issue にする。
- 今回の #59 修正は、ドロワー幅（左右インセット込み）、右パネルとファイルツリー（上流の安定したパネル面にパディング）、ルート戻るボタンのインセットまで。

## iOS 26 standalone: 下端が少し引っ張れる（未修正）

- 2026-10-22
- `body` を `100dvh` の1行グリッドにし、`overflow: hidden` / `overscroll-behavior: none` にしても、iOS 26 のホーム画面アプリでは下端で小さなラバーバンドが残る。
- iOS 26 の standalone WebView は画面（844px）よりステータスバー分（47px）短く、下に未描画の帯がある。DSH側のスクロールは本文1つにしたが、このネイティブの引っ張りはCSSでは止めきれない。
- 恒久対応は iOS/WebKit の修正、またはネイティブラッパー（Capacitor など）。
- 参考: [WebKit Bug 301994](https://bugs.webkit.org/show_bug.cgi?id=301994)
