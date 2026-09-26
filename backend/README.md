# Cloudflare notification backend

NS業務アシストの通知バックエンドです。Cloudflare Workers Free、SQLite-backed Durable Object、Durable Object Alarm、Cron Triggerで動作します。店舗パスワード、メモ、走行距離、給油額、日報の件数・個数は受信しません。

## 構成

- Worker: PWA用HTTPS APIとCORS
- SQLite Durable Object: Push購読、稼働、完了、再通知状態
- Alarm: 指定時刻通知と5分後の1回再通知
- Cron Trigger: 15分ごとに次回Alarmを再確認
- Web Crypto: VAPID署名とWeb Push暗号化

## ローカル確認

1. `pnpm install`
2. `pnpm test`
3. `pnpm keygen`
4. 出力値を `.dev.vars` に保存
5. `npm run dev`

`.dev.vars` の形式:

```
VAPID_PUBLIC_KEY=...
VAPID_PRIVATE_JWK={...}
REGISTRATION_CODE=...
```

ローカルPWAで試す場合は、`wrangler.jsonc` の `ALLOWED_ORIGIN` をローカルURLへ一時的に変更します。本番値は `https://kuwamelody-cloud.github.io` です。

## Cloudflareへ設定

`pnpm keygen` で一度だけ鍵を作り、次をCloudflare Secretへ登録します。

```
npx wrangler secret put VAPID_PRIVATE_JWK
npx wrangler secret put REGISTRATION_CODE
```

`VAPID_PUBLIC_KEY` は秘密情報ではないため、`wrangler.jsonc` の `vars` またはCloudflare Dashboardで設定します。その後 `pnpm deploy` を実行し、発行された `workers.dev` URLをPWAの `assistant-config.js` に設定します。

VAPID鍵を変更すると既存のPush購読を作り直す必要があります。秘密値と `.dev.vars` はリポジトリへ追加しません。
