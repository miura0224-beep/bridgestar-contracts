import {
  canonical,
  sha,
  now,
  token,
  type Contract,
  type Status,
} from "./domain";
import { fail, encrypt, decrypt, type RuntimeEnv } from "./security";
export async function getContract(env: RuntimeEnv, id: string) {
  const c = await env.DB.prepare("SELECT * FROM contracts WHERE id=?")
    .bind(id)
    .first<Contract>();
  if (!c) fail(404, "契約が見つかりません");
  return c;
}
export async function mutate(
  env: RuntimeEnv,
  c: Contract,
  action: string,
  actor: string,
  detail: unknown,
  changes: Partial<
    Pick<
      Contract,
      | "status"
      | "approved_by"
      | "expires_at"
      | "signed_at"
      | "signature_name"
      | "pdf_key"
      | "pdf_hash"
    >
  > = {},
  extra: D1PreparedStatement[] = [],
) {
  const at = now();
  const version = c.version + 1;
  const record = {
    contract_id: c.id,
    version,
    action,
    actor,
    at,
    detail: canonical(detail),
    previous_hash: c.audit_head,
  };
  const hash = await sha(canonical(record));
  const keys = Object.keys(changes) as (keyof typeof changes)[];
  // Insert the unique next event before updating. A concurrent writer causes the whole batch to roll back.
  try {
    await env.DB.batch([
      env.DB.prepare(
        "INSERT INTO events(id,contract_id,version,action,actor,at,detail,previous_hash,hash) VALUES(?,?,?,?,?,?,?,?,?)",
      ).bind(
        token(),
        c.id,
        version,
        action,
        actor,
        at,
        record.detail,
        c.audit_head,
        hash,
      ),
      env.DB.prepare(
        `UPDATE contracts SET version=?,updated_at=?,audit_head=?${keys.map((k) => "," + k + "=?").join("")} WHERE id=? AND version=?`,
      ).bind(
        version,
        at,
        hash,
        ...keys.map((k) => changes[k] ?? null),
        c.id,
        c.version,
      ),
      ...extra,
    ]);
  } catch (e) {
    if (String(e).includes("UNIQUE"))
      fail(409, "別の担当者が更新しました。再読み込みしてください");
    throw e;
  }
  return getContract(env, c.id);
}
export async function mailStatement(
  env: RuntimeEnv,
  contractId: string | null,
  to: string,
  subject: string,
  body: string,
) {
  return env.DB.prepare(
    "INSERT INTO outbox(id,contract_id,recipient,subject,encrypted_body,created_at) VALUES(?,?,?,?,?,?)",
  ).bind(token(), contractId, to, subject, await encrypt(env, body), now());
}
export async function flushMail(env: RuntimeEnv) {
  if (
    env.ENVIRONMENT !== "production" ||
    env.LIVE_SEND_ENABLED !== "true" ||
    !env.MAIL_FROM
  )
    return;
  const rows = await env.DB.prepare(
    "SELECT * FROM outbox WHERE (state='pending' OR (state='sending' AND lease_until<?)) AND attempts<5 ORDER BY created_at LIMIT 10",
  )
    .bind(now())
    .all<{
      id: string;
      recipient: string;
      subject: string;
      encrypted_body: string;
    }>();
  for (const m of rows.results) {
    const lock = await env.DB.prepare(
      "UPDATE outbox SET state='sending',attempts=attempts+1,lease_until=? WHERE id=? AND (state='pending' OR (state='sending' AND lease_until<?))",
    )
      .bind(new Date(Date.now() + 120000).toISOString(), m.id, now())
      .run();
    if (!lock.meta.changes) continue;
    try {
      if (!env.RESEND_API_KEY) throw new Error("mail_configuration");
      const text = await decrypt(env, m.encrypted_body);
      const html = approvalMailHtml(env.APP_ORIGIN, m.subject, text);
      const response = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.RESEND_API_KEY}`,
          "Content-Type": "application/json",
          "Idempotency-Key": `bridge-contract-${m.id}`,
        },
        body: JSON.stringify({
          to: [m.recipient],
          from: env.MAIL_FROM,
          subject: m.subject,
          text,
          ...(html ? { html } : {}),
        }),
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) throw new Error("mail_provider_error");
      const result = (await response.json()) as { id?: string };
      if (!result.id) throw new Error("mail_provider_response");
      await env.DB.prepare(
        "UPDATE outbox SET state='sent',sent_at=?,encrypted_body='',error=NULL,provider_id=? WHERE id=?",
      )
        .bind(now(), result.id, m.id)
        .run();
    } catch {
      await env.DB.prepare(
        "UPDATE outbox SET state=CASE WHEN attempts>=5 THEN 'failed' ELSE 'pending' END,error='メール送信に失敗しました' WHERE id=?",
      )
        .bind(m.id)
        .run();
    }
  }
}
export async function maintenance(env: RuntimeEnv) {
  const cs = await env.DB.prepare(
    "SELECT * FROM contracts WHERE status='sent' AND expires_at<? LIMIT 100",
  )
    .bind(now())
    .all<Contract>();
  for (const c of cs.results) {
    try {
      await mutate(env, c, "expired", "system", {}, { status: "expired" }, [
        env.DB.prepare(
          "UPDATE invitations SET revoked=1 WHERE contract_id=?",
        ).bind(c.id),
      ]);
    } catch (e) {
      if (!(e instanceof Error) || !e.message.includes("別の担当者")) throw e;
    }
  }
  await env.DB.batch([
    env.DB.prepare("DELETE FROM admin_challenges WHERE expires_at<?").bind(
      now(),
    ),
    env.DB.prepare("DELETE FROM challenges WHERE expires_at<?").bind(now()),
    env.DB.prepare("DELETE FROM sessions WHERE expires_at<?").bind(now()),
    env.DB.prepare("DELETE FROM rate_limits WHERE resets_at<?").bind(
      Date.now(),
    ),
  ]);
  await flushMail(env);
}
export async function evidence(env: RuntimeEnv, c: Contract) {
  const events = await env.DB.prepare(
    "SELECT * FROM events WHERE contract_id=? ORDER BY version",
  )
    .bind(c.id)
    .all<{
      version: number;
      action: string;
      actor: string;
      at: string;
      detail: string;
      previous_hash: string;
      hash: string;
    }>();
  let previous = "GENESIS";
  let valid = true;
  for (const e of events.results) {
    const hash = await sha(
      canonical({
        contract_id: c.id,
        version: e.version,
        action: e.action,
        actor: e.actor,
        at: e.at,
        detail: e.detail,
        previous_hash: e.previous_hash,
      }),
    );
    if (previous !== e.previous_hash || hash !== e.hash) valid = false;
    previous = e.hash;
  }
  if (previous !== c.audit_head || (await sha(c.body)) !== c.content_hash)
    valid = false;
  let pdfValid: boolean | null = null;
  if (c.pdf_key && c.pdf_hash) {
    const file = await env.DOCUMENTS.get(c.pdf_key);
    pdfValid =
      !!file &&
      file.size <= 20000000 &&
      (await sha(await file.arrayBuffer())) === c.pdf_hash;
    if (!pdfValid) valid = false;
  }
  return {
    schema: "bridgestar-evidence-v1",
    statement:
      "自社システムによる合意記録。第三者の電子証明書・認定タイムスタンプは付与していません。",
    contract: c,
    events: events.results,
    integrity: { valid, pdfValid, algorithm: "SHA-256" },
    exported_at: now(),
  };
}

// Escape all user-entered text; only the configured app origin becomes a button.
export function approvalMailHtml(origin: string, subject: string, text: string) {
  const request = subject === "【ブリッジスター】入塾契約の承認依頼";
  if (!request && subject !== "【ブリッジスター】入塾契約の承認が完了しました") return undefined;
  const link = text.split("\n").find(line => line.startsWith(origin + "/?"));
  if (!link) return undefined;
  const url = new URL(link);
  if (url.origin !== new URL(origin).origin || url.pathname !== "/") return undefined;
  const escape = (s: string) => s.replace(/[&<>"']/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]!));
  return `<div lang="ja" style="font-family:sans-serif;line-height:1.8;color:#233e34;max-width:600px;margin:auto;padding:24px"><h2>${escape(subject)}</h2><p style="white-space:pre-wrap">${escape(text)}</p><p><a href="${escape(link)}" style="display:inline-block;background:#245c48;color:white;padding:16px 24px;border-radius:8px;text-decoration:none">${request ? "内容を確認して承認する" : "契約を開いて署名依頼を送る"}</a></p><p style="font-size:13px">ブリッジスター事務局 / このメールへの返信では手続きは完了しません。</p></div>`;
}
