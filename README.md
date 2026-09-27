# NS業務アシスト PWA

従来の業務記録・日別集計・月別集計を残したまま、業務中の通知アシストを利用できます。新規利用時は業務アシストがONです。利用者が保存済みのON/OFF設定は更新時にも維持され、OFFでは従来の記録・集計機能だけを使用できます。

## 開発時の確認

- 画面・スケジュール・既存機能: `node --test tests/*.test.cjs`
- 通知バックエンド: `cd backend` の後に `pnpm install`、`pnpm test`、`pnpm dev`

通知バックエンドはCloudflare Workers Freeへ配置済みです。Marin固定音声を追加するまでは、フォアグラウンドで短いアラート音へ自動的に切り替わります。詳細は `IMPLEMENTATION.md` と `backend/README.md` を参照してください。

## GitHub Pagesへの更新手順
1. ZIPを展開します。
2. GitHubリポジトリ内の同名ファイルを、以下のファイルで置き換えます。
   - index.html
   - manifest.json
   - service-worker.js
   - assistant-config.js
   - assistant-core.js
   - assistant-db.js
   - assistant.js
   - audio フォルダー
   - icon-192.png
   - icon-512.png
   - apple-touch-icon.png
3. Commit changes を押します。
4. GitHub Pagesの公開URLは変更しません。

## データについて
同じGitHub Pages URLのまま更新する限り、iPhone内に保存済みの日報データは通常そのまま維持されます。
念のため、更新前にアプリの「バックアップを書き出す」からJSONファイルを保存してください。
業務アシストの設定と稼働状態は、日報データとは別のIndexedDBに保存します。

## 更新が反映されない場合
PWAは古いキャッシュを保持することがあります。
アプリを完全終了して再起動し、それでも変わらない場合はSafariで公開URLを開いて再読み込みしてください。
