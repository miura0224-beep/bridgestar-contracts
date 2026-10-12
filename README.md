# ブリッジスター契約管理

中高一貫ブリッジスターの入塾・コーチ契約を、申込、事務局確認、社内承認、署名依頼、電子署名、保存まで管理するシステムです。Cloudflare Pages / Workers、D1、R2、Resendを使用しています。

- [本サイト](https://contracts.bridgestar.jp/)
- [事務局向け入塾手続きマニュアル](https://contracts.bridgestar.jp/enrollment-admin)
- [保護者向け入塾手続き動画](https://vimeo.com/1226538164/982c64d8e0)
- [共有デモ](https://bridgestar-contract-demo.pages.dev/)：確認用コードは事務局から別途案内します。

## 主な機能

- 保護者によるプラン・開始日の選択と入塾申込
- 事務局による契約作成、別担当者による承認・差し戻し
- 入塾契約の承認依頼メール、スマートフォンでの承認、作成担当への完了通知
- コーチ契約の作成・承認・署名
- メール確認、契約PDF、電子署名、合意記録・操作履歴の保存
- 再送時の旧リンク無効化、送信再試行、署名期限処理
- 塾生向け諸変更届
- 管理責任者・承認担当・作成担当・閲覧担当の権限分離

承認後の署名依頼は事務局が送信します。請求書は契約内容に基づき別途送付する運用です。第三者電子証明書・認定タイムスタンプ・PAdES署名は接続していません。

## ローカル起動

Node.js 22以上を使用します。

```sh
npm ci
mkdir -p private qa
node scripts/prepare-local.mjs
npx wrangler d1 migrations apply bridgestar-contracts --local
npx wrangler d1 execute bridgestar-contracts --local --file=private/local-seed.sql
npm run dev
```

http://127.0.0.1:8792/ を開き、作成担当としてログインします。架空の生徒・保護者・コーチと、動作確認用ひな形で操作できます。承認時には承認担当へ切り替えてください。ローカルとデモではメールを外部送信しません。送信状況に表示されるリンクと確認コードで署名を試せます。

## 検証

```sh
npm run check
npm run build:pages
npm test
node tests/browser.mjs
node tests/mobile-approval.mjs
```

`npm test` とブラウザーテストは、初期化済みローカルサーバーを使用します。ブラウザーテストはGoogle Chromeを使用します。テストは架空のデータを作成します。共有デモ用の検証スクリプトには別途、非公開の設定ファイルが必要です。

## 配備設定

実際の環境設定・秘密情報はリポジトリに含めません。既存環境の更新では、運用担当者が保管する設定を使用してください。新しい環境では以下の設定例を複製し、その環境のD1・R2・ドメイン・送信者を設定します。

- `production/wrangler.example.jsonc` → `production/wrangler.jsonc`
- `demo/wrangler.example.jsonc` → `demo/wrangler.jsonc`
- `wrangler.scheduler.example.jsonc` → `wrangler.scheduler.jsonc`

本番とデモは別のD1・R2を使用します。`TOKEN_SECRET`、本番の`RESEND_API_KEY`、デモの`DEMO_ACCESS_HASH`はCloudflare Secretsで設定します。デモ用ハッシュは確認用コードのSHA-256です。正式な契約ひな形と管理メンバーは各環境に登録します。

本番メール送信は、送信元認証と宛先を確認してから`LIVE_SEND_ENABLED`を有効にします。入塾承認の宛先は現在、`src/index.ts`の承認依頼処理にある運用責任者アドレスです。別組織への配備時は変更してください。

```sh
npm run check
npm run build:pages
node scripts/check-production.mjs
npx wrangler pages deploy --cwd production --project-name bridgestar-contract-workspace --branch main
npx wrangler deploy --config wrangler.scheduler.jsonc
```

GitHubへの登録とサイトの配備は別操作です。このリポジトリには、共有デモで確認した最新コードを収録しています。本番に配備済みの版と必ずしも一致しません。

## 公開対象

アプリ本体、DBスキーマ、テスト、画面マニュアル、設定例を収録しています。契約原本、締結済み文書、顧客データ、APIキー、確認コード、DB内容、動画制作ファイルは含めません。

契約PDFで使用するNoto Sans JPは、`public/fonts/LICENSE.txt`のSIL Open Font Licenseに従います。
