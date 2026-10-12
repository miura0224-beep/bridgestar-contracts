import { Hono } from "hono";
import { z } from "zod";
import {
  admin,
  fail,
  local,
  cookie,
  setCookie,
  limit,
  codeHash,
  auditSecurity,
  type RuntimeEnv,
} from "./security";
import {
  token,
  sha,
  now,
  later,
  canonical,
  amounts,
  contractInput,
} from "./domain";
import { mailStatement, flushMail } from "./store";
const app = new Hono<{ Bindings: RuntimeEnv }>();
const applicationInput = z
  .object(contractInput.shape)
  .omit({
    title: true,
    templateId: true,
    assignedTo: true,
    endDate: true,
    applicationId: true,
    hourlyRate: true,
    subject: true,
    customNet: true,
    notes: true,
  })
  .extend({
    kind: z.literal("student"),
    studentName: z.string().trim().min(1).max(100),
    studentKana: z.string().trim().min(1).max(100),
    guardianKana: z.string().trim().min(1).max(100),
    studentAddress: z.string().trim().min(1).max(180),
    school: z.string().trim().min(1).max(100),
    studentEmail: z.email().max(254),
    planId: z.enum(["habit", "starter", "a", "b", "c", "d", "reading-only"]),
    privacy: z.literal(true),
    notContract: z.literal(true),
  });
type Application = {
  id: string;
  party_name: string;
  party_email: string;
  token_hash: string;
  status: string;
  payload: string | null;
  expires_at: string;
  contract_id: string | null;
};
async function access(env: RuntimeEnv, req: Request, verified = true) {
  const s = await env.DB.prepare(
    "SELECT * FROM sessions WHERE token_hash=? AND scope='application' AND expires_at>?",
  )
    .bind(await sha(cookie(req, "bs_apply")), now())
    .first<{
      token_hash: string;
      application_id: string;
      email: string;
      verified: number;
    }>();
  if (!s || (verified && !s.verified)) fail(401, "メール確認が必要です");
  const a = await env.DB.prepare(
    "SELECT * FROM applications WHERE id=? AND status!='revoked' AND expires_at>?",
  )
    .bind(s.application_id, now())
    .first<Application>();
  if (!a)
    fail(
      410,
      "申込リンクの期限が切れているか、取り消されています。事務局へご連絡ください",
    );
  return { s, a };
}
app.get("/api/admin/applications", async (c) => {
  await admin(c.env, c.req.raw);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,party_name,party_email,status,payload,created_at,expires_at,submitted_at,contract_id FROM applications ORDER BY created_at DESC LIMIT 500",
      ).all()
    ).results,
  );
});
app.post("/api/admin/applications", async (c) => {
  const m = await admin(c.env, c.req.raw);
  if (m.role === "viewer") fail(403, "作成権限が必要です");
  const p = z
    .object({
      name: z.string().trim().min(1).max(100),
      email: z
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
    })
    .parse(await c.req.json());
  await limit(c.env, "application-invite:" + m.email, 30, 3600);
  const id = crypto.randomUUID(),
    raw = token(),
    link = c.env.APP_ORIGIN + "/apply#" + raw;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO applications(id,party_name,party_email,token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(id, p.name, p.email, await sha(raw), m.email, now(), later(604800)),
    await mailStatement(
      c.env,
      null,
      p.email,
      "【ブリッジスター】入塾申込シートのご入力",
      `${p.name} 様\n入塾申込シートをご入力ください。\n${link}\n有効期限：7日間\nプラン・開始希望日などを入力し、事務局が確認します。この入力のみで契約は成立しません。契約内容は後日、署名依頼で改めてご確認いただきます。`,
    ),
  ]);
  await auditSecurity(c.env, m.email, "application_invited", { id });
  c.executionCtx.waitUntil(flushMail(c.env));
  return c.json({ id, ...(local(c.env, c.req.raw) ? { link } : {}) }, 201);
});
app.post("/api/admin/applications/:id/revoke", async (c) => {
  const m = await admin(c.env, c.req.raw);
  if (m.role === "viewer") fail(403, "作成権限が必要です");
  const r = await c.env.DB.prepare(
    "UPDATE applications SET status='revoked' WHERE id=? AND status IN ('requested','submitted')",
  )
    .bind(c.req.param("id"))
    .run();
  if (!r.meta.changes) fail(409, "この申込は取消できません");
  await auditSecurity(c.env, m.email, "application_revoked", {
    id: c.req.param("id"),
  });
  return c.json({ ok: true });
});
app.post("/api/apply/exchange", async (c) => {
  await limit(
    c.env,
    "apply-exchange:" + (c.req.header("CF-Connecting-IP") || "local"),
    30,
    600,
  );
  const p = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(await c.req.json());
  const a = await c.env.DB.prepare(
    "SELECT * FROM applications WHERE token_hash=? AND status!='revoked' AND expires_at>?",
  )
    .bind(await sha(p.token), now())
    .first<Application>();
  if (!a) fail(410, "申込リンクの期限が切れているか、取り消されています");
  const raw = token();
  await c.env.DB.prepare(
    "INSERT INTO sessions(token_hash,email,scope,expires_at,application_id) VALUES(?,?,'application',?,?)",
  )
    .bind(await sha(raw), a.party_email, later(28800), a.id)
    .run();
  c.header("Set-Cookie", setCookie("bs_apply", raw, c.req.raw, "/api/apply"));
  return c.json({ ok: true });
});
app.post("/api/apply/code", async (c) => {
  const { s, a } = await access(c.env, c.req.raw, false);
  await limit(c.env, "apply-code:" + a.id, 5, 3600);
  await limit(c.env, "apply-cooldown:" + a.id, 1, 60);
  const id = token();
  let n = crypto.getRandomValues(new Uint32Array(1))[0];
  while (n >= 4294000000) n = crypto.getRandomValues(new Uint32Array(1))[0];
  const code = String(n % 1000000).padStart(6, "0");
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE challenges SET consumed=1 WHERE session_hash=?",
    ).bind(s.token_hash),
    c.env.DB.prepare("INSERT INTO challenges VALUES(?,?,?,?,0,0,?)").bind(
      id,
      s.token_hash,
      await codeHash(c.env, id, code),
      later(600),
      now(),
    ),
    await mailStatement(
      c.env,
      null,
      s.email,
      "【ブリッジスター】申込シート確認コード",
      `確認コード：${code}\n有効期限は10分です。他の人へ伝えないでください。`,
    ),
  ]);
  c.executionCtx.waitUntil(flushMail(c.env));
  return c.json({ challengeId: id });
});
app.post("/api/apply/verify", async (c) => {
  const { s, a } = await access(c.env, c.req.raw, false);
  await limit(c.env, "apply-verify:" + a.id, 20, 3600);
  const p = z
    .object({
      challengeId: z.string().length(64),
      code: z.string().regex(/^\d{6}$/),
    })
    .parse(await c.req.json());
  const r = await c.env.DB.prepare(
    "UPDATE challenges SET attempts=attempts+1 WHERE id=? AND session_hash=? AND expires_at>? AND consumed=0 AND attempts<5 RETURNING code_hash",
  )
    .bind(p.challengeId, s.token_hash, now())
    .first<{ code_hash: string }>();
  if (!r || r.code_hash !== (await codeHash(c.env, p.challengeId, p.code)))
    fail(400, "確認コードが違うか、有効期限が切れています");
  const used = await c.env.DB.prepare(
    "UPDATE challenges SET consumed=1 WHERE id=? AND consumed=0",
  )
    .bind(p.challengeId)
    .run();
  if (!used.meta.changes) fail(409, "使用済みのコードです");
  await c.env.DB.prepare("UPDATE sessions SET verified=1 WHERE token_hash=?")
    .bind(s.token_hash)
    .run();
  return c.json({ ok: true });
});
app.get("/api/apply/form", async (c) => {
  const { a } = await access(c.env, c.req.raw);
  return c.json({
    name: a.party_name,
    email: a.party_email,
    status: a.status,
    payload: a.payload ? JSON.parse(a.payload) : null,
  });
});
app.post("/api/apply/submit", async (c) => {
  const { s, a } = await access(c.env, c.req.raw);
  const p = applicationInput.parse({
    ...(await c.req.json()),
    kind: "student",
    partyEmail: s.email,
  });
  if (
    (p.studentBirthDate && p.studentBirthDate > now().slice(0, 10)) ||
    (p.guardianBirthDate && p.guardianBirthDate > now().slice(0, 10))
  )
    fail(400, "生年月日を確認してください");
  const data = canonical({
    ...p,
    reading: p.planId === "reading-only" ? false : p.reading,
  });
  if (a.status === "submitted" && a.payload === data)
    return c.json({ ok: true });
  const updated = await c.env.DB.prepare(
    "UPDATE applications SET status='submitted',payload=?,submitted_at=? WHERE id=? AND status='requested' AND expires_at>?",
  )
    .bind(data, now(), a.id, now())
    .run();
  if (!updated.meta.changes)
    fail(409, "送信済み、または事務局で更新されました");
  await auditSecurity(c.env, s.email, "application_submitted", {
    id: a.id,
    payload_hash: await sha(data),
  });
  return c.json({ ok: true });
});
export default app;
