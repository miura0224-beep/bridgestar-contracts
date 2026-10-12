import test from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
const base = "http://127.0.0.1:8792";
function client() {
  let cookie = "";
  return {
    async req(path, body, opts = {}) {
      const r = await fetch(base + "/api" + path, {
        method: body === undefined ? "GET" : "POST",
        headers: {
          Cookie: cookie,
          ...(body === undefined
            ? {}
            : { Origin: base, "Content-Type": "application/json" }),
          ...opts.headers,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      if (r.headers.get("set-cookie"))
        cookie = r.headers.get("set-cookie").split(";")[0];
      const data = r.headers.get("content-type")?.includes("application/json")
        ? await r.json()
        : new Uint8Array(await r.arrayBuffer());
      return { status: r.status, data, headers: r.headers };
    },
    async login(email) {
      const r = await this.req("/dev/login", { email });
      assert.equal(r.status, 200);
    },
  };
}
const owner = client(),
  approver = client(),
  viewer = client();
let contract;
const input = {
  kind: "student",
  title: "【架空テスト】入塾・受講契約",
  partyName: "テスト 保護者",
  partyEmail: "parent@example.test",
  templateId: "demo-student",
  assignedTo: "owner@example.test",
  startDate: "2026-09-16",
  endDate: "2027-03-31",
  studentName: "テスト 生徒",
  school: "サンプル中学校",
  grade: "中1",
  address: "東京都 サンプル住所 1-2-3",
  phone: "09000000000",
  planId: "starter",
  reading: true,
};
await test("Contract workflow and security", async (t) => {
  await owner.login("owner@example.test");
  await approver.login("approver@example.test");
  await viewer.login("viewer@example.test");
  await t.test("reject unauthenticated reads", async () =>
    assert.equal((await client().req("/admin/contracts")).status, 403),
  );
  await t.test("reject cross-origin mutation", async () =>
    assert.equal(
      (
        await owner.req("/admin/contracts", input, {
          headers: { Origin: "https://attacker.example" },
        })
      ).status,
      403,
    ),
  );
  await t.test("viewer cannot create", async () =>
    assert.equal((await viewer.req("/admin/contracts", input)).status, 403),
  );
  await t.test("invalid dates rejected", async () =>
    assert.equal(
      (
        await owner.req("/admin/contracts", {
          ...input,
          startDate: "2026-02-30",
        })
      ).status,
      400,
    ),
  );
  await t.test("create with normal monthly tax and separate initial invoice", async () => {
    const r = await owner.req("/admin/contracts", input);
    assert.equal(r.status, 201, JSON.stringify(r.data));
    contract = r.data;
    assert.match(contract.body, /43,780円/);
    assert.match(contract.body, /請求書を別途送付/);
    assert.doesNotMatch(contract.body, /初月：21,890円/);
  });
  await t.test("review then reject self approval", async () => {
    let r = await owner.req(`/admin/contracts/${contract.id}/action`, {
      action: "review",
      version: contract.version,
    });
    assert.equal(r.status, 200);
    contract = r.data;
    r = await owner.req(`/admin/contracts/${contract.id}/action`, {
      action: "approve",
      version: contract.version,
    });
    assert.equal(r.status, 403);
  });
  await t.test("second admin approves and freezes PDF", async () => {
    const r = await approver.req(`/admin/contracts/${contract.id}/action`, {
      action: "approve",
      version: contract.version,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    contract = r.data;
    assert.equal(contract.status, "approved");
    assert.equal(contract.pdf_hash.length, 64);
    const pdf = await owner.req(`/admin/contracts/${contract.id}/pdf`);
    assert.equal(pdf.status, 200);
    writeFileSync("qa/student.pdf", pdf.data);
  });
  await t.test("stale writes rejected", async () =>
    assert.equal(
      (
        await owner.req(`/admin/contracts/${contract.id}/action`, {
          action: "send",
          version: contract.version - 1,
        })
      ).status,
      409,
    ),
  );
  let raw,
    signer = client();
  await t.test("invitation queues mail only", async () => {
    const r = await owner.req(`/admin/contracts/${contract.id}/action`, {
      action: "send",
      version: contract.version,
    });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    contract = r.data;
    const mailbox = (await owner.req("/admin/outbox")).data;
    const mail = mailbox.find(
      (m) => m.contract_id === contract.id && m.subject.includes("ご確認"),
    );
    assert.equal(mail.state, "pending");
    raw = mail.body.match(/\/sign#([a-f0-9]+)/)[1];
  });
  await t.test(
    "token exchange does not expose contract without code",
    async () => {
      assert.equal(
        (await signer.req("/sign/exchange", { token: raw })).status,
        200,
      );
      assert.equal((await signer.req("/sign/contract")).status, 401);
    },
  );
  await t.test("wrong OTP rejected; correct OTP verified", async () => {
    const r = await signer.req("/sign/code", {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const challengeId = r.data.challengeId;
    assert.equal(
      (await signer.req("/sign/verify", { challengeId, code: "xxxxxx" }))
        .status,
      400,
    );
    const mails = (await owner.req("/admin/outbox")).data;
    const mail = mails.find(
      (m) => m.contract_id === contract.id && m.subject.includes("確認コード"),
    );
    const code = mail.body.match(/\d{6}/)[0];
    assert.equal(
      (await signer.req("/sign/verify", { challengeId, code })).status,
      200,
    );
    assert.equal(
      (await signer.req("/sign/verify", { challengeId, code })).status,
      400,
    );
  });
  await t.test("cannot sign without consent or download", async () => {
    assert.equal(
      (
        await signer.req("/sign/sign", {
          name: input.partyName,
          contentHash: contract.content_hash,
          agree: true,
          saved: true,
          authority: true,
        })
      ).status,
      400,
    );
  });
  await t.test(
    "record electronic delivery and retrieve immutable PDF",
    async () => {
      assert.equal(
        (
          await signer.req("/sign/consent", {
            electronic: true,
            canSave: true,
            paperOption: true,
          })
        ).status,
        200,
      );
      const r = await signer.req("/sign/pdf");
      assert.equal(r.status, 200);
      const hash = Buffer.from(
        await crypto.subtle.digest("SHA-256", r.data),
      ).toString("hex");
      assert.equal(hash, contract.pdf_hash);
    },
  );
  await t.test("wrong content and wrong signer rejected", async () => {
    assert.equal(
      (
        await signer.req("/sign/sign", {
          name: input.partyName,
          contentHash: "0".repeat(64),
          agree: true,
          saved: true,
          authority: true,
        })
      ).status,
      409,
    );
    assert.equal(
      (
        await signer.req("/sign/sign", {
          name: "別の人",
          contentHash: contract.content_hash,
          agree: true,
          saved: true,
          authority: true,
        })
      ).status,
      400,
    );
  });
  await t.test("sign and idempotent repeat", async () => {
    for (let i = 0; i < 2; i++)
      assert.equal(
        (
          await signer.req("/sign/sign", {
            name: input.partyName,
            contentHash: contract.content_hash,
            agree: true,
            saved: true,
            authority: true,
          })
        ).status,
        200,
      );
  });
  await t.test(
    "evidence chain matches and only one signature recorded",
    async () => {
      const r = await owner.req(`/admin/contracts/${contract.id}/evidence`);
      assert.equal(r.status, 200);
      assert.equal(r.data.integrity.valid, true);
      assert.equal(
        r.data.events.filter((e) => e.action === "signed").length,
        1,
      );
      writeFileSync("qa/evidence.json", JSON.stringify(r.data, null, 2));
      const e = await signer.req("/sign/evidence");
      assert.equal(e.status, 200);
      assert.equal(e.data.contract.signature_name, input.partyName);
      assert.equal("assigned_to" in e.data.contract, false);
    },
  );
  await t.test("signed contract cannot be voided", async () => {
    const row = (await owner.req("/admin/contracts/" + contract.id)).data
      .contract;
    assert.equal(
      (
        await owner.req(`/admin/contracts/${contract.id}/action`, {
          action: "void",
          version: row.version,
          reason: "test",
        })
      ).status,
      409,
    );
  });
  await t.test("unapproved template cannot be approved", async () => {
    const candidate = await owner.req("/admin/templates", {
      kind: "student",
      name: "未承認テスト",
      body: "これは承認されていない動作確認用のひな形です。".repeat(8),
      source: "automated test",
      approved: false,
    });
    let r = await owner.req("/admin/contracts", {
      ...input,
      templateId: candidate.data.id,
    });
    let row = r.data;
    r = await owner.req(`/admin/contracts/${row.id}/action`, {
      action: "review",
      version: row.version,
    });
    row = r.data;
    r = await approver.req(`/admin/contracts/${row.id}/action`, {
      action: "approve",
      version: row.version,
    });
    assert.equal(r.status, 409);
  });
});
