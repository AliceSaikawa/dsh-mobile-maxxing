# Known issues

## 修正済み: #59 横画面のナビを "More" に畳む

- 2026-10-26
- モバイルモードかつ横画面（幅 > 高さ）のときだけ、Plugins / Automation tasks / Settings の3行を1つの More 行に畳む。縦向き・PC・dispose では More を削除して元の行を復元する。
- More は `aria-haspopup="menu"`、メニューは `role="menu"` / `role="menuitem"`。クリックまたは Enter で開き、項目選択・Escape・外側クリック・回転/リサイズで閉じる。Escape は More にフォーカスを戻し、矢印/Home/End で項目を移動できる。
- 3行は DOM に残して非表示属性だけを付ける。単一の Settings 行（#87）は従来どおり再利用され、追加・重複しない。
- ドロワー幅（左右インセット込み）、右パネルとファイルツリー（上流の安定したパネル面にパディング）、ルート戻るボタンのセーフエリアも同じ #59 で修正済み。
- 実機での最終確認（回転直後・キーボード開閉後を含む）は別途行う。

## iOS 26 standalone: 下端が少し引っ張れる（未修正）

- 2026-10-22
- `body` を `100dvh` の1行グリッドにし、`overflow: hidden` / `overscroll-behavior: none` にしても、iOS 26 のホーム画面アプリでは下端で小さなラバーバンドが残る。
- iOS 26 の standalone WebView は画面（844px）よりステータスバー分（47px）短く、下に未描画の帯がある。DSH側のスクロールは本文1つにしたが、このネイティブの引っ張りはCSSでは止めきれない。
- 恒久対応は iOS/WebKit の修正、またはネイティブラッパー（Capacitor など）。
- 参考: [WebKit Bug 301994](https://bugs.webkit.org/show_bug.cgi?id=301994)
