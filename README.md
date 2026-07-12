# ネットスーパー業務記録 v5 PWA

## GitHub Pagesへの更新手順
1. ZIPを展開します。
2. GitHubリポジトリ内の同名ファイルを、以下のファイルで置き換えます。
   - index.html
   - manifest.json
   - service-worker.js
   - icon-192.png
   - icon-512.png
   - apple-touch-icon.png
3. Commit changes を押します。
4. GitHub Pagesの公開URLは変更しません。

## データについて
同じGitHub Pages URLのまま更新する限り、iPhone内に保存済みの日報データは通常そのまま維持されます。
念のため、更新前にアプリの「バックアップを書き出す」からJSONファイルを保存してください。

## 更新が反映されない場合
PWAは古いキャッシュを保持することがあります。
アプリを完全終了して再起動し、それでも変わらない場合はSafariで公開URLを開いて再読み込みしてください。
