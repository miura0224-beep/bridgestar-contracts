import { chromium } from "@playwright/test";
import assert from "node:assert/strict";
const browser = await chromium.launch({
  headless: true,
  executablePath:
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
});
const context = await browser.newContext({
  viewport: { width: 1440, height: 1000 },
});
const page = await context.newPage();
const errors = [];
page.on("pageerror", (e) => errors.push(e.message));
await page.goto("http://127.0.0.1:8792");
await page.getByRole("button", { name: "管理責任者として試す" }).click();
await page.getByRole("heading", { name: "今日の契約状況" }).waitFor();
await page.screenshot({ path: "qa/dashboard-desktop.png", fullPage: true });
await page.getByRole("button", { name: "＋ 新しい契約" }).click();
await page.getByRole("button", { name: /コーチとの契約/ }).click();
await page.getByLabel("使用するひな形").selectOption("demo-coach");
await page.getByLabel("コーチ氏名").fill("サンプル コーチ");
await page.getByLabel("署名依頼先メールアドレス").fill("coach@example.test");
await page.getByLabel("契約者の住所").fill("東京都 テスト住所 1-2");
await page.getByLabel("電話番号").fill("09000000000");
await page.getByRole("button", { name: "契約内容を確認" }).click();
await page.getByRole("button", { name: "下書きを保存" }).click();
await page
  .getByRole("heading", { name: "講師業務委託契約", exact: true })
  .waitFor();
await page.screenshot({ path: "qa/contract-desktop.png", fullPage: true });
await page.getByRole("button", { name: "社内承認を依頼" }).click();
await page.getByText("社内承認を依頼", { exact: true }).waitFor();
await page.getByRole("button", { name: "ログアウト" }).click();
await page.getByRole("button", { name: "承認担当として試す" }).click();
await page
  .getByRole("button", { name: "講師業務委託契約", exact: true })
  .first()
  .click();
await page.getByRole("button", { name: "内容を承認" }).click();
await page
  .getByRole("button", { name: "署名依頼を送信", exact: true })
  .waitFor();
await page.getByRole("button", { name: "署名依頼を送信", exact: true }).click();
await page.getByRole("button", { name: "署名依頼を再送" }).waitFor();
await page.getByRole("button", { name: "送信状況", exact: true }).click();
await page.getByRole("heading", { name: "テストメール" }).waitFor();
const urls = await page
  .getByRole("link", { name: "署名画面を試す" })
  .evaluateAll((els) => els.map((e) => e.href));
const signer = await browser.newContext({
  viewport: { width: 390, height: 844 },
});
const sp = await signer.newPage();
sp.on("pageerror", (e) => errors.push(e.message));
sp.on("response", async (r) => {
  if (r.status() >= 400 && r.url().includes("/api/"))
    console.log(r.status(), r.url().split("/api/")[1], await r.text());
});
await sp.goto(urls[0]);
await sp.getByRole("button", { name: "確認コードを送る", exact: true }).click();
await sp.getByLabel("6桁の確認コード").waitFor();
await page.getByRole("button", { name: "送信状況", exact: true }).click();
await page.waitForFunction(() =>
  document.querySelector("pre")?.textContent.startsWith("確認コード："),
);
const code = (await page.locator("pre").first().innerText()).match(
  /確認コード：(\d{6})/,
)[1];
await sp.getByLabel("6桁の確認コード").fill(code);
await sp.getByRole("button", { name: "確認して進む" }).click();
await sp.getByRole("heading", { name: "契約書の受け取り方法" }).waitFor();
await sp.screenshot({ path: "qa/sign-mobile-consent.png", fullPage: true });
for (const box of await sp.getByRole("checkbox").all()) await box.check();
await sp.getByRole("button", { name: "同意して契約内容へ" }).click();
await sp.getByRole("heading", { name: "講師業務委託契約" }).waitFor();
await sp.screenshot({ path: "qa/sign-mobile.png", fullPage: true });
const dl = sp.waitForEvent("download");
await sp.getByRole("link", { name: "契約PDFを保存" }).click();
await (await dl).saveAs("qa/coach.pdf");
await sp.getByLabel("ご本人の氏名", { exact: true }).fill("サンプル コーチ");
for (const box of await sp.getByRole("checkbox").all()) await box.check();
await sp.getByRole("button", { name: "上記に同意して署名する" }).click();
await sp
  .getByRole("heading", { name: "ご署名ありがとうございます。" })
  .waitFor();
await sp.screenshot({ path: "qa/sign-mobile-complete.png", fullPage: true });
const receiptDownload = sp.waitForEvent("download");
await sp.getByRole("link", { name: "合意記録PDFを保存" }).click();
await (await receiptDownload).saveAs("qa/receipt.pdf");
assert.equal(
  await sp.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
await page.setViewportSize({ width: 390, height: 844 });
await page.getByRole("button", { name: "ホーム", exact: true }).click();
await page.getByRole("heading", { name: "今日の契約状況" }).waitFor();
await page.screenshot({ path: "qa/dashboard-mobile.png", fullPage: true });
assert.equal(
  await page.evaluate(() => document.documentElement.scrollWidth > innerWidth),
  false,
);
assert.deepEqual(errors, []);
console.log(
  "Browser passed: coach creation, independent approval, mobile verification, consent, PDF download, signature, responsive layouts, zero JS errors.",
);
await browser.close();
