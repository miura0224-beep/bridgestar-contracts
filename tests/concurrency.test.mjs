import test from "node:test";
import assert from "node:assert/strict";
const origin = "http://127.0.0.1:8792";
function user() {
  let cookie = "";
  return async function req(path, body) {
    const r = await fetch(origin + "/api" + path, {
      method: body === undefined ? "GET" : "POST",
      headers: {
        Origin: origin,
        "Content-Type": "application/json",
        Cookie: cookie,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (r.headers.get("set-cookie"))
      cookie = r.headers.get("set-cookie").split(";")[0];
    return { status: r.status, data: await r.json() };
  };
}
await test("Concurrency, revocation and role boundaries", async (t) => {
  const owner = user(),
    approver = user();
  await owner("/dev/login", { email: "owner@example.test" });
  await approver("/dev/login", { email: "approver@example.test" });
  const input = {
    kind: "coach",
    title: "【架空テスト】同時更新とリンク取消",
    partyName: "テスト コーチ",
    partyEmail: "revocation@example.test",
    templateId: "demo-coach",
    assignedTo: "owner@example.test",
    startDate: "2026-09-14",
    endDate: "2027-03-31",
    address: "東京都 テスト住所",
    phone: "09000000000",
  };
  let c = (await owner("/admin/contracts", input)).data;
  await t.test(
    "concurrent review produces exactly one transition",
    async () => {
      const results = await Promise.all([
        owner(`/admin/contracts/${c.id}/action`, {
          action: "review",
          version: c.version,
        }),
        owner(`/admin/contracts/${c.id}/action`, {
          action: "review",
          version: c.version,
        }),
      ]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 409]);
      c = results.find((r) => r.status === 200).data;
      const detail = (await owner("/admin/contracts/" + c.id)).data;
      assert.equal(
        detail.events.filter((e) => e.action === "review_requested").length,
        1,
      );
    },
  );
  await t.test(
    "approver cannot add administrators or approve templates",
    async () => {
      assert.equal(
        (
          await approver("/admin/members", {
            email: "new@example.test",
            name: "Test",
            role: "owner",
            active: 1,
          })
        ).status,
        403,
      );
      assert.equal(
        (
          await approver("/admin/templates", {
            kind: "coach",
            name: "Test",
            body: "x".repeat(200),
            source: "test",
            approved: true,
          })
        ).status,
        403,
      );
    },
  );
  await t.test("resend invalidates old link and signing session", async () => {
    c = (
      await approver(`/admin/contracts/${c.id}/action`, {
        action: "approve",
        version: c.version,
      })
    ).data;
    c = (
      await owner(`/admin/contracts/${c.id}/action`, {
        action: "send",
        version: c.version,
      })
    ).data;
    let mails = (await owner("/admin/outbox")).data;
    const old = mails
      .find((m) => m.contract_id === c.id)
      .body.match(/\/sign#([a-f0-9]+)/)[1];
    const signer = user();
    assert.equal((await signer("/sign/exchange", { token: old })).status, 200);
    c = (
      await owner(`/admin/contracts/${c.id}/action`, {
        action: "resend",
        version: c.version,
      })
    ).data;
    assert.equal((await user()("/sign/exchange", { token: old })).status, 410);
    assert.equal((await signer("/sign/code", {})).status, 401);
  });
  await t.test(
    "void invalidates latest link; audit remains valid",
    async () => {
      const mail = (await owner("/admin/outbox")).data.find(
        (m) => m.contract_id === c.id,
      );
      const raw = mail.body.match(/\/sign#([a-f0-9]+)/)[1];
      c = (
        await owner(`/admin/contracts/${c.id}/action`, {
          action: "void",
          version: c.version,
          reason: "架空テストの終了",
        })
      ).data;
      assert.equal(c.status, "voided");
      assert.equal(
        (await user()("/sign/exchange", { token: raw })).status,
        410,
      );
      assert.equal(
        (await owner(`/admin/contracts/${c.id}/evidence`)).data.integrity.valid,
        true,
      );
    },
  );
});
