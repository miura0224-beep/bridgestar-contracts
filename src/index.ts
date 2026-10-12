import changes from "./changes";
import applications from "./applications";
import { sourceDocuments } from "./sources";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { HTTPException } from "hono/http-exception";
import { z } from "zod";
import {
  contractInput,
  amounts,
  canonical,
  renderTerms,
  sha,
  token,
  now,
  later,
  plans,
  type Member,
  type Contract,
  type Template,
} from "./domain";
import {
  admin,
  cookie,
  local,
  fail,
  setCookie,
  session,
  limit,
  codeHash,
  decrypt,
  auditSecurity,
  newAdminSession,
  type RuntimeEnv,
} from "./security";
import {
  getContract,
  mutate,
  mailStatement,
  flushMail,
  maintenance,
  evidence,
} from "./store";
import { createPDF, receiptPDF } from "./pdf";
const app = new Hono<{ Bindings: RuntimeEnv; Variables: { member: Member } }>();
app.use(
  "*",
  bodyLimit({
    maxSize: 150000,
    onError: (c) => c.json({ error: "入力が長すぎます" }, 413),
  }),
);
app.use("*", async (c, next) => {
  c.header("X-Content-Type-Options", "nosniff");
  c.header("Referrer-Policy", "no-referrer");
  c.header("X-Frame-Options", "DENY");
  c.header("Cache-Control", "no-store");
  c.header(
    "Content-Security-Policy",
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
  );
  if (new URL(c.req.url).protocol === "https:")
    c.header("Strict-Transport-Security", "max-age=31536000");
  if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
    if (c.req.header("Origin") !== new URL(c.req.url).origin)
      fail(403, "別のサイトからの操作は受け付けられません");
    if (Number(c.req.header("Content-Length") || 0) > 150000)
      fail(413, "入力が長すぎます");
    const body = await c.req.text();
    if (new TextEncoder().encode(body).length > 150000)
      fail(413, "入力が長すぎます");
  }
  await next();
});
app.onError((e, c) => {
  if (e instanceof HTTPException) return c.json({ error: e.message }, e.status);
  if (e instanceof z.ZodError)
    return c.json({ error: e.issues.map((i) => i.message).join(" / ") }, 400);
  console.error(JSON.stringify({ event: "request_error", name: e.name }));
  return c.json(
    { error: "処理できませんでした。再読み込みして状態をご確認ください。" },
    500,
  );
});
// Demo access is checked before every API, including simulated role login and signing.
async function demoAccess(env: RuntimeEnv, req: Request) {
  const raw = cookie(req, "bs_demo");
  if (!raw) return false;
  return !!await env.DB.prepare("SELECT token_hash FROM sessions WHERE token_hash=? AND scope='demo_gate' AND expires_at>?")
    .bind(await sha(raw), now()).first();
}
app.use("/api/*", async (c, next) => {
  if (c.env.ENVIRONMENT === "demo" && !["/api/config", "/api/demo/unlock"].includes(c.req.path) && !await demoAccess(c.env, c.req.raw))
    fail(401, "デモの確認用コードを入力してください");
  await next();
});
app.post("/api/demo/unlock", async (c) => {
  if (c.env.ENVIRONMENT !== "demo" || !c.env.DEMO_ACCESS_HASH) fail(404, "Not found");
  const gateLimitKey = "demo-gate:" + (c.req.header("CF-Connecting-IP") || "local");
  await limit(c.env, gateLimitKey, 10, 600);
  const { code } = z.object({ code: z.string().max(100) }).parse(await c.req.json());
  if (await sha(code.trim()) !== c.env.DEMO_ACCESS_HASH) fail(403, "確認用コードが違います");
  await c.env.DB.prepare("UPDATE rate_limits SET count=MAX(0,count-1) WHERE key=?").bind(gateLimitKey).run();
  const raw = token();
  await c.env.DB.prepare("INSERT INTO sessions(token_hash,email,scope,expires_at,verified) VALUES(?,?,'demo_gate',?,1)")
    .bind(await sha(raw), "demo@example.test", later(8 * 3600)).run();
  c.header("Set-Cookie", setCookie("bs_demo", raw, c.req.raw));
  return c.json({ ok: true });
});
app.route("/", applications);
app.route("/", changes);
app.get("/api/config", async (c) =>
  c.json({
    demo: c.env.ENVIRONMENT === "demo",
    demoLocked: c.env.ENVIRONMENT === "demo" && !await demoAccess(c.env, c.req.raw),
    local: local(c.env, c.req.raw),
    authMode: c.env.AUTH_MODE || "access",
    live: c.env.LIVE_SEND_ENABLED === "true",
    plans,
    organization: "株式会社ThreeStars",
  }),
);
app.post("/api/dev/login", async (c) => {
  if (!local(c.env, c.req.raw)) fail(404, "Not found");
  const { email } = z.object({ email: z.email() }).parse(await c.req.json());
  const m = await c.env.DB.prepare(
    "SELECT * FROM members WHERE email=? AND active=1",
  )
    .bind(email)
    .first<Member>();
  if (!m) fail(403, "デモの管理者を選んでください");
  c.header(
    "Set-Cookie",
    setCookie("bs_admin", await newAdminSession(c.env, email), c.req.raw),
  );
  return c.json({ ok: true });
});
app.post("/api/auth/request", async (c) => {
  if (c.env.AUTH_MODE !== "email" && !local(c.env, c.req.raw))
    fail(404, "Not found");
  const { email } = z
    .object({
      email: z
        .email()
        .max(254)
        .transform((v) => v.toLowerCase()),
    })
    .parse(await c.req.json());
  await limit(
    c.env,
    "admin-ip:" + (c.req.header("CF-Connecting-IP") || "local"),
    12,
    900,
  );
  await limit(c.env, "admin-email:" + (await sha(email)), 4, 600);
  const id = token();
  const m = await c.env.DB.prepare(
    "SELECT email FROM members WHERE email=? AND active=1",
  )
    .bind(email)
    .first();
  if (m) {
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    const code = String(random % 100000000).padStart(8, "0");
    await c.env.DB.batch([
      c.env.DB.prepare(
        "UPDATE admin_challenges SET consumed=1 WHERE email=?",
      ).bind(email),
      c.env.DB.prepare(
        "INSERT INTO admin_challenges(id,email,code_hash,expires_at) VALUES(?,?,?,?)",
      ).bind(id, email, await codeHash(c.env, id, code), later(600)),
      await mailStatement(
        c.env,
        null,
        email,
        "【ブリッジスター契約管理】ログイン確認コード",
        `確認コード：${code}\n有効期限は10分です。\nこのコードは他の方へ伝えないでください。\nログイン先：${c.env.APP_ORIGIN}\n心当たりのない場合は、このメールを破棄してください。`,
      ),
    ]);
    c.executionCtx.waitUntil(flushMail(c.env));
  }
  return c.json({
    challenge: id,
    message: "登録済みのメールアドレスに確認コードをお送りしました。",
  });
});
app.post("/api/auth/verify", async (c) => {
  if (c.env.AUTH_MODE !== "email" && !local(c.env, c.req.raw))
    fail(404, "Not found");
  const p = z
    .object({
      challenge: z.string().min(20).max(100),
      code: z.string().regex(/^\d{8}$/),
    })
    .parse(await c.req.json());
  await limit(
    c.env,
    "admin-verify:" + (c.req.header("CF-Connecting-IP") || "local"),
    30,
    600,
  );
  const row = await c.env.DB.prepare(
    "UPDATE admin_challenges SET attempts=attempts+1 WHERE id=? AND consumed=0 AND expires_at>? AND attempts<5 RETURNING email,code_hash",
  )
    .bind(p.challenge, now())
    .first<{ email: string; code_hash: string }>();
  if (!row || row.code_hash !== (await codeHash(c.env, p.challenge, p.code)))
    fail(401, "確認コードが違うか、有効期限が切れています");
  const claim = await c.env.DB.prepare(
    "UPDATE admin_challenges SET consumed=1 WHERE id=? AND consumed=0",
  )
    .bind(p.challenge)
    .run();
  if (!claim.meta.changes) fail(401, "この確認コードは使用済みです");
  const active = await c.env.DB.prepare(
    "SELECT email FROM members WHERE email=? AND active=1",
  )
    .bind(row.email)
    .first();
  if (!active) fail(403, "管理者として登録されていません");
  await c.env.DB.prepare(
    "DELETE FROM sessions WHERE token_hash=? AND scope='admin'",
  )
    .bind(await sha(cookie(c.req.raw, "bs_admin")))
    .run();
  c.header(
    "Set-Cookie",
    setCookie("bs_admin", await newAdminSession(c.env, row.email), c.req.raw),
  );
  await auditSecurity(c.env, row.email, "admin_login", {});
  return c.json({ ok: true });
});
app.use("/api/admin/*", async (c, next) => {
  c.set("member", await admin(c.env, c.req.raw));
  await next();
});
app.get("/api/admin/me", (c) => c.json(c.get("member")));
app.post("/api/admin/logout", async (c) => {
  await c.env.DB.prepare(
    "DELETE FROM sessions WHERE token_hash=? AND scope='admin'",
  )
    .bind(await sha(cookie(c.req.raw, "bs_admin")))
    .run();
  c.header(
    "Set-Cookie",
    "bs_admin=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
  );
  return c.json({
    redirect:
      local(c.env, c.req.raw) || c.env.AUTH_MODE === "email"
        ? "/"
        : "/cdn-cgi/access/logout",
  });
});
app.get("/api/admin/members", async (c) =>
  c.json(
    (await c.env.DB.prepare("SELECT * FROM members ORDER BY name").all())
      .results,
  ),
);
app.post("/api/admin/members", async (c) => {
  if (c.get("member").role !== "owner") fail(403, "管理者の管理権限が必要です");
  const m = z
    .object({
      email: z.email().transform((v) => v.toLowerCase()),
      name: z.string().trim().min(1).max(100),
      role: z.enum(["owner", "approver", "editor", "viewer"]),
      active: z.number().int().min(0).max(1),
    })
    .parse(await c.req.json());
  if (m.email === c.get("member").email && (m.role !== "owner" || !m.active))
    fail(400, "自分の管理権限は解除できません");
  await c.env.DB.prepare(
    "INSERT INTO members VALUES(?,?,?,?) ON CONFLICT(email) DO UPDATE SET name=excluded.name,role=excluded.role,active=excluded.active",
  )
    .bind(m.email, m.name, m.role, m.active)
    .run();
  await auditSecurity(c.env, c.get("member").email, "member_updated", m);
  return c.json({ ok: true });
});
app.get("/api/admin/templates", async (c) =>
  c.json(
    (
      await c.env.DB.prepare(
        "SELECT * FROM templates ORDER BY kind,version DESC",
      ).all()
    ).results,
  ),
);
app.get("/api/admin/source/:id", async (c) => {
  const source = sourceDocuments.find((s) => s.id === c.req.param("id"));
  if (!source) fail(404, "原本が見つかりません");
  const file = await c.env.DOCUMENTS.get(source.key);
  if (!file) fail(404, "原本が登録されていません");
  c.header("Content-Type", "application/pdf");
  c.header("Content-Disposition", `attachment; filename="${source.id}.pdf"`);
  return c.body(file.body);
});
app.post("/api/admin/templates", async (c) => {
  if (c.get("member").role !== "owner") fail(403, "ひな形の管理権限が必要です");
  const p = z
    .object({
      kind: z.enum(["student", "coach"]),
      name: z.string().trim().min(1).max(100),
      body: z.string().trim().min(100).max(40000),
      source: z.string().max(500),
      approved: z.boolean(),
    })
    .parse(await c.req.json());
  const version = (await c.env.DB.prepare(
    "SELECT COALESCE(MAX(version),0)+1 AS n FROM templates WHERE kind=?",
  )
    .bind(p.kind)
    .first<{ n: number }>())!.n;
  const id = token().slice(0, 24);
  await c.env.DB.prepare(
    "INSERT INTO templates(id,kind,name,version,body,approved,approved_by,source) VALUES(?,?,?,?,?,?,?,?)",
  )
    .bind(
      id,
      p.kind,
      p.name,
      version,
      p.body,
      p.approved ? 1 : 0,
      p.approved ? c.get("member").email : null,
      p.source,
    )
    .run();
  await auditSecurity(c.env, c.get("member").email, "template_created", {
    id,
    approved: p.approved,
  });
  return c.json({ id });
});
app.get("/api/admin/contracts", async (c) => {
  const cs = await c.env.DB.prepare(
    "SELECT * FROM contracts ORDER BY updated_at DESC LIMIT 500",
  ).all<Contract>();
  return c.json(cs.results.map(({ body, ...x }) => x));
});
app.post("/api/admin/contracts", async (c) => {
  if (c.get("member").role === "viewer") fail(403, "作成権限が必要です");
  const p = contractInput.parse(await c.req.json());
  const t = await c.env.DB.prepare("SELECT * FROM templates WHERE id=?")
    .bind(p.templateId)
    .first<Template>();
  if (!t || t.kind !== p.kind) fail(400, "契約種別とひな形を確認してください");
  if (p.kind === "student" && /16日以降[\s\S]{0,80}半額/.test(t.body))
    fail(
      400,
      "この旧ひな形には初月半額の条項が残っています。回数に応じた別途請求の版を選んでください",
    );
  if (
    !(await c.env.DB.prepare(
      "SELECT email FROM members WHERE email=? AND active=1",
    )
      .bind(p.assignedTo)
      .first())
  )
    fail(400, "担当者が登録されていません");
  if (p.applicationId) {
    const a = await c.env.DB.prepare(
      "SELECT status FROM applications WHERE id=?",
    )
      .bind(p.applicationId)
      .first<{ status: string }>();
    if (p.kind !== "student" || a?.status !== "submitted")
      fail(409, "この申込は契約作成済み、または取消されています");
  }
  const id = crypto.randomUUID();
  const at = now();
  const body = renderTerms(p, t.body);
  const insert = c.env.DB.prepare(
    "INSERT INTO contracts(id,kind,title,party_name,party_email,payload,template_id,body,content_hash,status,created_by,assigned_to,created_at,updated_at,application_id) VALUES(?,?,?,?,?,?,?,?,?,'draft',?,?,?,?,?)",
  ).bind(
    id,
    p.kind,
    p.title,
    p.partyName,
    p.partyEmail,
    canonical(p),
    t.id,
    body,
    await sha(body),
    c.get("member").email,
    p.assignedTo,
    at,
    at,
    p.applicationId || null,
  );
  try {
    await c.env.DB.batch([
      insert,
      ...(p.applicationId
        ? [
            c.env.DB.prepare(
              "UPDATE applications SET status='converted',contract_id=? WHERE id=? AND status='submitted'",
            ).bind(id, p.applicationId),
          ]
        : []),
    ]);
  } catch (e) {
    if (p.applicationId && /application|UNIQUE/.test(String(e)))
      fail(409, "この申込は別の担当者が更新しました");
    throw e;
  }

  const row = await mutate(
    c.env,
    await getContract(c.env, id),
    "created",
    c.get("member").email,
    { template_version: t.version, application_id: p.applicationId || null },
  );
  return c.json(row, 201);
});
app.get("/api/admin/contracts/:id", async (c) => {
  const contract = await getContract(c.env, c.req.param("id"));
  const [events, comments, mail] = await Promise.all([
    c.env.DB.prepare(
      "SELECT action,actor,at,detail,version FROM events WHERE contract_id=? ORDER BY version",
    )
      .bind(contract.id)
      .all(),
    c.env.DB.prepare(
      "SELECT * FROM comments WHERE contract_id=? ORDER BY created_at",
    )
      .bind(contract.id)
      .all(),
    c.env.DB.prepare(
      "SELECT id,recipient,subject,state,created_at,sent_at,error FROM outbox WHERE contract_id=? ORDER BY created_at",
    )
      .bind(contract.id)
      .all(),
  ]);
  return c.json({
    contract,
    events: events.results,
    comments: comments.results,
    mail: mail.results,
  });
});
app.post("/api/admin/contracts/:id/comment", async (c) => {
  if (c.get("member").role === "viewer") fail(403, "編集権限が必要です");
  const row = await getContract(c.env, c.req.param("id"));
  const { body } = z
    .object({ body: z.string().trim().min(1).max(2000) })
    .parse(await c.req.json());
  await c.env.DB.prepare("INSERT INTO comments VALUES(?,?,?,?,?)")
    .bind(token(), row.id, c.get("member").email, body, now())
    .run();
  return c.json({ ok: true });
});
app.post("/api/admin/contracts/:id/action", async (c) => {
  const m = c.get("member");
  if (m.role === "viewer") fail(403, "編集権限が必要です");
  const p = z
    .object({
      action: z.enum(["review", "approve", "return", "send", "resend", "void"]),
      version: z.number().int(),
      reason: z.string().max(1000).default(""),
    })
    .parse(await c.req.json());
  const row = await getContract(c.env, c.req.param("id"));
  if (row.version !== p.version)
    fail(409, "更新されています。再読み込みしてください");
  if (p.action === "review") {
    if (row.status !== "draft") fail(409, "下書きのみ承認依頼できます");
    const notifications: D1PreparedStatement[] = [];
    if (row.kind === "student") {
      const recipient = local(c.env, c.req.raw) ? "approver@example.test" : "miura0224@gmail.com";
      const approver = await c.env.DB.prepare("SELECT email FROM members WHERE email=? AND active=1 AND role IN ('owner','approver')")
        .bind(recipient).first<{ email: string }>();
      if (!approver) fail(409, "承認依頼先の管理責任者アカウントを確認してください");
      if (row.created_by === recipient) fail(409, "ユウキ先生ご本人が作成した契約です。事務局のアカウントで作成してください");
      notifications.push(await mailStatement(c.env, row.id, recipient,
        "【ブリッジスター】入塾契約の承認依頼",
        `入塾契約の確認をお願いします。\n契約名：${row.title}\n作成担当：${m.name}\n\n内容を確認して承認する：\n${c.env.APP_ORIGIN}/?view=approvals&id=${encodeURIComponent(row.id)}\n\n管理者ログイン後、契約内容を確認して承認してください。リンクを開くだけでは承認されません。承認すると、契約を作成した事務局担当者へメールでお知らせします。`));
    }
    const result = await mutate(c.env, row, "review_requested", m.email, {}, { status: "review" }, notifications);
    c.executionCtx.waitUntil(flushMail(c.env));
    return c.json(result);
  }
  if (
    ["approve", "send"].includes(p.action) &&
    row.kind === "student" &&
    /16日以降[\s\S]{0,80}半額/.test(row.body)
  )
    fail(
      400,
      "旧半額条項が残っています。回数に応じた別途請求のひな形で作り直してください",
    );
  if (p.action === "approve") {
    if (!["owner", "approver"].includes(m.role))
      fail(403, "承認権限が必要です");
    if (row.created_by === m.email)
      fail(403, "作成者とは別の担当者が承認してください");
    if (row.status !== "review") fail(409, "承認待ちの契約を選んでください");
    const template = await c.env.DB.prepare(
      "SELECT approved FROM templates WHERE id=?",
    )
      .bind(row.template_id)
      .first<{ approved: number }>();
    if (!template?.approved)
      fail(409, "正式に承認されたひな形で作り直してください");
    const bytes = await createPDF(c.env, { ...row, status: "approved" });
    const hash = await sha(bytes);
    const key = `contracts/${row.id}/${hash}.pdf`;
    await c.env.DOCUMENTS.put(key, bytes, {
      httpMetadata: { contentType: "application/pdf" },
    });
    const notifications: D1PreparedStatement[] = [];
    if (row.kind === "student") {
      const office = await c.env.DB.prepare("SELECT email FROM members WHERE email=? AND active=1")
        .bind(row.created_by).first<{ email: string }>();
      if (!office) fail(409, "契約作成担当者が無効です。管理責任者に確認してください");
      notifications.push(await mailStatement(c.env, row.id, office.email,
        "【ブリッジスター】入塾契約の承認が完了しました",
        `入塾契約が承認されました。\n契約名：${row.title}\n承認者：${m.name}\n\n契約を開く：\n${c.env.APP_ORIGIN}/?contract=${encodeURIComponent(row.id)}\n\n保護者への署名依頼はまだ送信していません。宛先と契約PDFを確認し、「署名依頼を送信」を押してください。`));
    }
    const result = await mutate(c.env, row, "approved", m.email, { pdf_hash: hash }, {
      status: "approved", approved_by: m.email, pdf_key: key, pdf_hash: hash,
    }, notifications);
    c.executionCtx.waitUntil(flushMail(c.env));
    return c.json(result);
  }
  if (p.action === "return") {
    if (row.status !== "review") fail(409, "承認待ちの契約を選んでください");
    if (!p.reason.trim()) fail(400, "差し戻し理由を記入してください");
    return c.json(
      await mutate(
        c.env,
        row,
        "returned",
        m.email,
        { reason: p.reason },
        { status: "draft" },
      ),
    );
  }
  if (p.action === "void") {
    if (!["draft", "review", "approved", "sent"].includes(row.status))
      fail(409, "この契約は取り消せません");
    if (!p.reason.trim()) fail(400, "取消理由を記入してください");
    return c.json(
      await mutate(
        c.env,
        row,
        "voided",
        m.email,
        { reason: p.reason },
        { status: "voided" },
        [
          c.env.DB.prepare(
            "UPDATE invitations SET revoked=1 WHERE contract_id=?",
          ).bind(row.id),
          c.env.DB.prepare(
            "UPDATE outbox SET state='cancelled',encrypted_body='' WHERE contract_id=? AND state='pending'",
          ).bind(row.id),
        ],
      ),
    );
  }
  if (p.action === "send" || p.action === "resend") {
    if (row.status !== (p.action === "send" ? "approved" : "sent"))
      fail(409, "この状態では送信できません");
    if (!local(c.env, c.req.raw) && c.env.LIVE_SEND_ENABLED !== "true")
      fail(503, "本番のメール送信設定が完了していません");
    if (!row.pdf_key) fail(409, "契約PDFがありません");
    await limit(c.env, "send:" + row.id, 5, 3600);
    const secret = token();
    const expires = later(7 * 86400);
    const link = `${c.env.APP_ORIGIN}/sign#${secret}`;
    const msg = await mailStatement(
      c.env,
      row.id,
      row.party_email,
      "【ブリッジスター】契約内容のご確認・署名のお願い",
      `${row.party_name} 様\n\n契約内容の確認をお願いします。\n${link}\n\n有効期限：${expires}\nメール確認後、契約書を保存し、内容に同意して署名してください。修正が必要な場合は画面から差し戻せます。\n株式会社ThreeStars`,
    );
    const updated = await mutate(
      c.env,
      row,
      p.action === "send" ? "invited" : "reinvited",
      m.email,
      { expires_at: expires },
      { status: "sent", expires_at: expires },
      [
        c.env.DB.prepare(
          "UPDATE invitations SET revoked=1 WHERE contract_id=?",
        ).bind(row.id),
        c.env.DB.prepare(
          "DELETE FROM sessions WHERE contract_id=? AND scope='sign'",
        ).bind(row.id),
        c.env.DB.prepare("INSERT INTO invitations VALUES(?,?,?,?,0)").bind(
          token(),
          row.id,
          await sha(secret),
          expires,
        ),
        msg,
      ],
    );
    c.executionCtx.waitUntil(flushMail(c.env));
    return c.json(updated);
  }
  return c.json({ error: "無効な操作" }, 400);
});
app.get("/api/admin/contracts/:id/pdf", async (c) => {
  const row = await getContract(c.env, c.req.param("id"));
  const bytes = row.pdf_key ? await c.env.DOCUMENTS.get(row.pdf_key) : null;
  c.header("Content-Type", "application/pdf");
  c.header(
    "Content-Disposition",
    `attachment; filename="contract-${row.id}.pdf"`,
  );
  return bytes
    ? c.body(bytes.body)
    : c.body(new Uint8Array(await createPDF(c.env, row)).buffer);
});
app.get("/api/admin/contracts/:id/receipt", async (c) => {
  const row = await getContract(c.env, c.req.param("id"));
  if (row.status !== "signed") fail(409, "署名後に保存できます");
  c.header("Content-Type", "application/pdf");
  c.header(
    "Content-Disposition",
    `attachment; filename="agreement-${row.id}.pdf"`,
  );
  return c.body(new Uint8Array(await receiptPDF(c.env, row)).buffer);
});
app.get("/api/admin/contracts/:id/evidence", async (c) => {
  const row = await getContract(c.env, c.req.param("id"));
  c.header(
    "Content-Disposition",
    `attachment; filename="evidence-${row.id}.json"`,
  );
  return c.json(await evidence(c.env, row));
});
app.get("/api/admin/outbox", async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT * FROM outbox ORDER BY created_at DESC LIMIT 100",
  ).all<{
    id: string;
    recipient: string;
    subject: string;
    encrypted_body: string;
    state: string;
    created_at: string;
  }>();
  return c.json(
    await Promise.all(
      rows.results.map(async ({ encrypted_body, ...m }) => ({
        ...m,
        body:
          local(c.env, c.req.raw) && encrypted_body
            ? await decrypt(c.env, encrypted_body)
            : undefined,
      })),
    ),
  );
});
app.post("/api/admin/outbox/:id/retry", async (c) => {
  if (!["owner", "approver"].includes(c.get("member").role))
    fail(403, "承認権限が必要です");
  await c.env.DB.prepare(
    "UPDATE outbox SET state='pending',attempts=0,error=NULL WHERE id=? AND state='failed' AND (contract_id IS NULL OR contract_id IN (SELECT id FROM contracts WHERE status IN ('sent','signed')))",
  )
    .bind(c.req.param("id"))
    .run();
  c.executionCtx.waitUntil(flushMail(c.env));
  return c.json({ ok: true });
});
app.post("/api/sign/exchange", async (c) => {
  await limit(
    c.env,
    "exchange:" + (await sha(c.req.header("CF-Connecting-IP") || "local")),
    30,
    600,
  );
  const { token: raw } = z
    .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
    .parse(await c.req.json());
  const inv = await c.env.DB.prepare(
    "SELECT * FROM invitations WHERE token_hash=? AND revoked=0 AND expires_at>?",
  )
    .bind(await sha(raw), now())
    .first<{ contract_id: string }>();
  if (!inv)
    fail(
      410,
      "リンクの期限が切れているか、無効になっています。事務局に再送をご依頼ください",
    );
  const row = await getContract(c.env, inv.contract_id);
  if (!["sent", "signed"].includes(row.status))
    fail(410, "この契約は現在、確認できません");
  const secret = token();
  await c.env.DB.prepare(
    "INSERT INTO sessions(token_hash,contract_id,email,scope,expires_at) VALUES(?,?,?,'sign',?)",
  )
    .bind(await sha(secret), row.id, row.party_email, later(28800))
    .run();
  c.header("Set-Cookie", setCookie("bs_sign", secret, c.req.raw, "/api/sign"));
  return c.json({
    emailHint: row.party_email.replace(/^(.).+(@.*)$/, "$1***$2"),
  });
});
app.post("/api/sign/code", async (c) => {
  const s = await session(c.env, c.req.raw, false);
  await limit(c.env, "otp:" + s.contract_id, 5, 3600);
  await limit(c.env, "otp-cooldown:" + s.contract_id, 1, 60);
  const row = await getContract(c.env, s.contract_id);
  if (!["sent", "signed"].includes(row.status) || row.expires_at! < now())
    fail(410, "有効期限が切れています");
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
      row.id,
      s.email,
      "【ブリッジスター】確認コード",
      `確認コード：${code}\n10分以内に入力してください。他の人には教えないでください。`,
    ),
  ]);
  c.executionCtx.waitUntil(flushMail(c.env));
  return c.json({ challengeId: id });
});
app.post("/api/sign/verify", async (c) => {
  const s = await session(c.env, c.req.raw, false);
  await limit(c.env, "verify:" + s.contract_id, 20, 3600);
  const p = z
    .object({
      challengeId: z.string().length(64),
      code: z.string().regex(/^\d{6}$/),
    })
    .parse(await c.req.json());
  const code = await codeHash(c.env, p.challengeId, p.code);
  const attempt = await c.env.DB.prepare(
    "UPDATE challenges SET attempts=attempts+1 WHERE id=? AND session_hash=? AND consumed=0 AND expires_at>? AND attempts<5 RETURNING code_hash",
  )
    .bind(p.challengeId, s.token_hash, now())
    .first<{ code_hash: string }>();
  if (
    !attempt ||
    !crypto.subtle.timingSafeEqual(
      new TextEncoder().encode(attempt.code_hash),
      new TextEncoder().encode(code),
    )
  )
    fail(400, "コードが異なるか、有効期限が切れています");
  const used = await c.env.DB.prepare(
    "UPDATE challenges SET consumed=1 WHERE id=? AND consumed=0 RETURNING id",
  )
    .bind(p.challengeId)
    .first();
  if (!used) fail(409, "この確認コードは使用済みです");
  await c.env.DB.prepare("UPDATE sessions SET verified=1 WHERE token_hash=?")
    .bind(s.token_hash)
    .run();
  const row = await getContract(c.env, s.contract_id);
  await mutate(c.env, row, "email_verified", s.email, { method: "email_code" });
  return c.json({ ok: true });
});
app.get("/api/sign/contract", async (c) => {
  const s = await session(c.env, c.req.raw);
  const row = await getContract(c.env, s.contract_id);
  if (!["sent", "signed"].includes(row.status) || row.expires_at! < now())
    fail(410, "この契約は現在、確認できません");
  return c.json({
    id: row.id,
    title: row.title,
    kind: row.kind,
    body: row.body,
    contentHash: row.content_hash,
    pdfHash: row.pdf_hash,
    status: row.status,
    partyName: row.party_name,
    expiresAt: row.expires_at,
    signedAt: row.signed_at,
    consent: !!s.consent_at,
    downloaded: !!s.downloaded_at,
  });
});
app.post("/api/sign/consent", async (c) => {
  const s = await session(c.env, c.req.raw);
  const p = z
    .object({
      electronic: z.literal(true),
      canSave: z.literal(true),
      paperOption: z.literal(true),
    })
    .parse(await c.req.json());
  const row = await getContract(c.env, s.contract_id);
  if (row.status !== "sent" || row.expires_at! < now())
    fail(410, "署名の受付は終了しています");
  await mutate(c.env, row, "electronic_delivery_consented", s.email, p, {}, [
    c.env.DB.prepare(
      "UPDATE sessions SET consent_at=? WHERE token_hash=?",
    ).bind(now(), s.token_hash),
  ]);
  return c.json({ ok: true });
});
app.get("/api/sign/pdf", async (c) => {
  const s = await session(c.env, c.req.raw);
  const row = await getContract(c.env, s.contract_id);
  if (!s.consent_at) fail(403, "電子交付への同意が必要です");
  if (!["sent", "signed"].includes(row.status) || row.expires_at! < now())
    fail(410, "受付は終了しています");
  const file = row.pdf_key ? await c.env.DOCUMENTS.get(row.pdf_key) : null;
  if (!file) fail(404, "契約PDFがありません");
  await mutate(
    c.env,
    row,
    "document_download_requested",
    s.email,
    { pdf_hash: row.pdf_hash },
    {},
    [
      c.env.DB.prepare(
        "UPDATE sessions SET downloaded_at=? WHERE token_hash=?",
      ).bind(now(), s.token_hash),
    ],
  );
  c.header("Content-Type", "application/pdf");
  c.header(
    "Content-Disposition",
    `attachment; filename="contract-${row.id}.pdf"`,
  );
  return c.body(file.body);
});
app.post("/api/sign/sign", async (c) => {
  const s = await session(c.env, c.req.raw);
  const p = z
    .object({
      name: z.string().trim().min(1).max(100),
      contentHash: z.string().length(64),
      agree: z.literal(true),
      saved: z.literal(true),
      authority: z.literal(true),
    })
    .parse(await c.req.json());
  const row = await getContract(c.env, s.contract_id);
  if (row.status === "signed") return c.json({ ok: true, alreadySigned: true });
  if (row.status !== "sent" || row.expires_at! < now())
    fail(410, "署名の受付は終了しています");
  if (!s.consent_at || !s.downloaded_at)
    fail(400, "電子交付に同意し、契約PDFを保存してください");
  if (p.contentHash !== row.content_hash) fail(409, "契約内容が一致しません");
  if (p.name.replace(/\s/g, "") !== row.party_name.replace(/\s/g, ""))
    fail(
      400,
      "宛名と同じ氏名で署名してください。修正が必要な場合は差し戻してください",
    );
  const at = now();
  const receipt = await mailStatement(
    c.env,
    row.id,
    s.email,
    "【ブリッジスター】契約への同意を受け付けました",
    `${p.name} 様\n\n「${row.title}」への同意を受け付けました。\n同意日時：${at}\n契約番号：${row.id}\n元のご案内リンクから、有効期限内に契約PDFと合意記録を保存できます。期限後の再交付は事務局へお問い合わせください。\n株式会社ThreeStars`,
  );
  await mutate(
    c.env,
    row,
    "signed",
    s.email,
    {
      signature: p.name,
      content_hash: row.content_hash,
      pdf_hash: row.pdf_hash,
      consent_at: s.consent_at,
      download_requested_at: s.downloaded_at,
      save_confirmed: true,
      authority_confirmed: true,
      ip: c.req.header("CF-Connecting-IP") || "local",
      user_agent: (c.req.header("User-Agent") || "").slice(0, 300),
    },
    { status: "signed", signed_at: at, signature_name: p.name },
    [receipt],
  );
  c.executionCtx.waitUntil(flushMail(c.env));
  return c.json({ ok: true });
});
app.post("/api/sign/decline", async (c) => {
  const s = await session(c.env, c.req.raw);
  const p = z
    .object({ reason: z.string().trim().min(1).max(1000) })
    .parse(await c.req.json());
  const row = await getContract(c.env, s.contract_id);
  if (row.status !== "sent" || row.expires_at! < now())
    fail(410, "受付は終了しています");
  await mutate(c.env, row, "declined", s.email, p, { status: "declined" }, [
    c.env.DB.prepare(
      "UPDATE invitations SET revoked=1 WHERE contract_id=?",
    ).bind(row.id),
  ]);
  return c.json({ ok: true });
});
app.get("/api/sign/receipt", async (c) => {
  const sessionRow = await session(c.env, c.req.raw);
  const row = await getContract(c.env, sessionRow.contract_id);
  if (row.status !== "signed" || row.expires_at! < now())
    fail(403, "合意記録は署名後に保存できます");
  c.header("Content-Type", "application/pdf");
  c.header(
    "Content-Disposition",
    `attachment; filename="agreement-${row.id}.pdf"`,
  );
  return c.body(new Uint8Array(await receiptPDF(c.env, row)).buffer);
});
app.get("/api/sign/evidence", async (c) => {
  const s = await session(c.env, c.req.raw);
  const row = await getContract(c.env, s.contract_id);
  if (row.status !== "signed" || row.expires_at! < now())
    fail(403, "合意記録は署名後に保存できます");
  const e = await evidence(c.env, row);
  c.header(
    "Content-Disposition",
    `attachment; filename="agreement-${row.id}.json"`,
  );
  return c.json({
    schema: e.schema,
    statement: e.statement,
    contract: {
      id: row.id,
      title: row.title,
      body: row.body,
      content_hash: row.content_hash,
      pdf_hash: row.pdf_hash,
      signature_name: row.signature_name,
      signed_at: row.signed_at,
    },
    events: e.events
      .filter((x) =>
        [
          "signed",
          "approved",
          "electronic_delivery_consented",
          "document_download_requested",
          "email_verified",
        ].includes(x.action),
      )
      .map(({ action, at, detail }) => ({ action, at, detail })),
    exported_at: e.exported_at,
  });
});
app.get("*", async (c) => {
  const path = new URL(c.req.url).pathname;
  if (path.startsWith("/api/")) return c.json({ error: "Not found" }, 404);
  const asset = ["/sign", "/apply", "/changes"].includes(path) ? "/" : path;
  return c.env.ASSETS.fetch(new Request(new URL(asset, c.req.url), c.req.raw));
});
export default {
  fetch: app.fetch,
  async scheduled(_event, env) {
    await maintenance(env);
  },
} satisfies ExportedHandler<RuntimeEnv>;
