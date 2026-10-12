import { changeForms, commonChangeFields } from "./change-forms";
import { validateNotice } from "./change-validation";
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
type Notice = {
  id: string;
  party_name: string;
  party_email: string;
  token_hash: string;
  status: string;
  payload: string | null;
  expires_at: string;
  submitted_at: string | null;
  review_note: string | null;
  effective_date: string | null;
};
async function access(env: RuntimeEnv, req: Request, verified = true) {
  const s = await env.DB.prepare(
    "SELECT * FROM sessions WHERE token_hash=? AND scope='change' AND expires_at>?",
  )
    .bind(await sha(cookie(req, "bs_change")), now())
    .first<{
      token_hash: string;
      change_id: string;
      email: string;
      verified: number;
    }>();
  if (!s || (verified && !s.verified)) fail(401, "メール確認が必要です");
  const a = await env.DB.prepare(
    "SELECT * FROM change_notices WHERE id=? AND status!='revoked' AND expires_at>?",
  )
    .bind(s.change_id, now())
    .first<Notice>();
  if (!a)
    fail(
      410,
      "届出リンクの期限が切れているか、取り消されています。事務局へご連絡ください",
    );
  return { s, a };
}
app.get("/api/changes/config", (c) =>
  c.json({ forms: changeForms, common: commonChangeFields }),
);
app.get("/api/admin/changes/:id/history", async (c) => {
  await admin(c.env, c.req.raw);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT actor,action,detail,at FROM change_events WHERE notice_id=? ORDER BY at,id",
      )
        .bind(c.req.param("id"))
        .all()
    ).results,
  );
});
app.post("/api/admin/changes/:id/review", async (c) => {
  const m = await admin(c.env, c.req.raw);
  if (m.role === "viewer") fail(403, "確認・処理権限が必要です");
  const p = z
    .object({
      status: z.enum(["reviewing", "completed", "returned"]),
      note: z.string().trim().min(1).max(2000),
      effectiveDate: z
        .string()
        .regex(/^\d{4}-\d{2}-\d{2}$/)
        .or(z.literal(""))
        .default(""),
      expectedStatus: z.enum(["submitted", "reviewing"]),
      expectedReviewedAt: z.string().nullable(),
    })
    .parse(await c.req.json());
  if (
    p.effectiveDate &&
    (isNaN(Date.parse(p.effectiveDate)) ||
      new Date(p.effectiveDate).toISOString().slice(0, 10) !== p.effectiveDate)
  )
    fail(400, "適用日を確認してください");
  const a = await c.env.DB.prepare("SELECT * FROM change_notices WHERE id=?")
    .bind(c.req.param("id"))
    .first<Notice>();
  if (!a || !a.payload || a.status !== p.expectedStatus)
    fail(409, "ほかの担当者が更新しました。再読み込みしてください");
  const formId = JSON.parse(a.payload).formId;
  if (
    p.status === "completed" &&
    ["plan", "withdrawal"].includes(formId) &&
    !p.effectiveDate
  )
    fail(400, "事務局で確認した適用日・退会日を入力してください");
  // Event insert and conditional state update run atomically; the event guard uses the same expected status.
  const stamp = now();
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO change_events(id,notice_id,actor,action,detail,at) SELECT ?,id,?,?,?,? FROM change_notices WHERE id=? AND status=? AND reviewed_at IS ?",
    ).bind(
      crypto.randomUUID(),
      m.email,
      p.status,
      canonical({ note: p.note, effectiveDate: p.effectiveDate }),
      stamp,
      a.id,
      p.expectedStatus,
      p.expectedReviewedAt,
    ),
    c.env.DB.prepare(
      "UPDATE change_notices SET status=?,review_note=?,reviewed_by=?,reviewed_at=?,effective_date=? WHERE id=? AND status=? AND reviewed_at IS ?",
    ).bind(
      p.status,
      p.note,
      m.email,
      stamp,
      p.effectiveDate,
      a.id,
      p.expectedStatus,
      p.expectedReviewedAt,
    ),
  ]);
  if (!results[1].meta.changes) fail(409, "ほかの担当者が更新しました");
  return c.json({ ok: true });
});
app.get("/api/admin/changes", async (c) => {
  await admin(c.env, c.req.raw);
  return c.json(
    (
      await c.env.DB.prepare(
        "SELECT id,party_name,party_email,status,payload,created_at,expires_at,submitted_at,review_note,reviewed_by,reviewed_at,effective_date FROM change_notices ORDER BY created_at DESC LIMIT 500",
      ).all()
    ).results,
  );
});
app.post("/api/admin/changes", async (c) => {
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
  await limit(c.env, "change-invite:" + m.email, 30, 3600);
  const id = crypto.randomUUID(),
    raw = token(),
    link = c.env.APP_ORIGIN + "/changes#" + raw;
  await c.env.DB.batch([
    c.env.DB.prepare(
      "INSERT INTO change_notices(id,party_name,party_email,token_hash,created_by,created_at,expires_at) VALUES(?,?,?,?,?,?,?)",
    ).bind(id, p.name, p.email, await sha(raw), m.email, now(), later(604800)),
    await mailStatement(
      c.env,
      null,
      p.email,
      "【ブリッジスター】諸変更届のご入力",
      `${p.name} 様\n必要な諸変更届を選び、ご入力ください。\n${link}\n有効期限：7日間\n提出内容を事務局が確認し、処理結果をご案内します。`,
    ),
  ]);
  await auditSecurity(c.env, m.email, "change_invited", { id });
  c.executionCtx.waitUntil(flushMail(c.env));
  return c.json({ id, ...(local(c.env, c.req.raw) ? { link } : {}) }, 201);
});
app.post("/api/admin/changes/:id/revoke", async (c) => {
  const m = await admin(c.env, c.req.raw);
  if (m.role === "viewer") fail(403, "作成権限が必要です");
  const r = await c.env.DB.prepare(
    "UPDATE change_notices SET status='revoked' WHERE id=? AND status='requested'",
  )
    .bind(c.req.param("id"))
    .run();
  if (!r.meta.changes) fail(409, "この案内は取消できません");
  await auditSecurity(c.env, m.email, "change_revoked", {
    id: c.req.param("id"),
  });
  return c.json({ ok: true });
});
app.post("/api/changes/exchange", async (c) => {
  await limit(
    c.env,
    "change-exchange:" + (c.req.header("CF-Connecting-IP") || "local"),
    30,
    600,
  );
  const p = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(await c.req.json());
  const a = await c.env.DB.prepare(
    "SELECT * FROM change_notices WHERE token_hash=? AND status!='revoked' AND expires_at>?",
  )
    .bind(await sha(p.token), now())
    .first<Notice>();
  if (!a) fail(410, "届出リンクの期限が切れているか、取り消されています");
  const raw = token();
  await c.env.DB.prepare(
    "INSERT INTO sessions(token_hash,email,scope,expires_at,change_id) VALUES(?,?,'change',?,?)",
  )
    .bind(await sha(raw), a.party_email, later(28800), a.id)
    .run();
  c.header(
    "Set-Cookie",
    setCookie("bs_change", raw, c.req.raw, "/api/changes"),
  );
  return c.json({ ok: true });
});
app.post("/api/changes/code", async (c) => {
  const { s, a } = await access(c.env, c.req.raw, false);
  await limit(c.env, "change-code:" + a.id, 5, 3600);
  await limit(c.env, "change-cooldown:" + a.id, 1, 60);
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
      "【ブリッジスター】諸変更届確認コード",
      `確認コード：${code}\n有効期限は10分です。他の人へ伝えないでください。`,
    ),
  ]);
  c.executionCtx.waitUntil(flushMail(c.env));
  return c.json({ challengeId: id });
});
app.post("/api/changes/verify", async (c) => {
  const { s, a } = await access(c.env, c.req.raw, false);
  await limit(c.env, "change-verify:" + a.id, 20, 3600);
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
app.get("/api/changes/form", async (c) => {
  const { a } = await access(c.env, c.req.raw);
  return c.json({
    id: a.id,
    submittedAt: a.submitted_at,
    reviewNote: a.review_note,
    effectiveDate: a.effective_date,
    name: a.party_name,
    email: a.party_email,
    status: a.status,
    payload: a.payload ? JSON.parse(a.payload) : null,
  });
});
app.post("/api/changes/submit", async (c) => {
  const { s, a } = await access(c.env, c.req.raw);
  const p = validateNotice(await c.req.json(), s.email);
  const data = canonical(p);
  if (a.payload === data) return c.json({ ok: true });
  const updated = await c.env.DB.prepare(
    "UPDATE change_notices SET status='submitted',payload=?,submitted_at=? WHERE id=? AND status='requested' AND expires_at>?",
  )
    .bind(data, now(), a.id, now())
    .run();
  if (!updated.meta.changes)
    fail(409, "提出済み、または事務局で更新されました");
  await auditSecurity(c.env, s.email, "change_submitted", {
    id: a.id,
    payload_hash: await sha(data),
  });
  return c.json({ ok: true });
});
export default app;
