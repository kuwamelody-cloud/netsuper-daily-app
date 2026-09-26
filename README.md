# NS業務アシスト PWA

従来の業務記録・日別集計・月別集計を残したまま、任意で業務中の通知アシストを有効にできます。更新直後は業務アシストがOFFなので、既存の記録機能は従来どおり使用できます。

## 開発時の確認

- 画面・スケジュール・既存機能: `node --test tests/*.test.cjs`
- 通知バックエンド: `cd backend` の後に `pnpm install`、`pnpm test`、`pnpm dev`

本番公開には、Cloudflare Workers Freeへの通知バックエンド配置、`assistant-config.js`の接続先設定、固定音声ファイルが必要です。詳細は `IMPLEMENTATION.md` と `backend/README.md` を参照してください。

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
