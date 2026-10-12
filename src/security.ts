import { createRemoteJWKSet, jwtVerify } from "jose";
import { HTTPException } from "hono/http-exception";
import { canonical, sha, token, now, later, type Member } from "./domain";
export type RuntimeEnv = {
  [K in keyof Env]: Env[K] extends string ? string : Env[K];
} & { RESEND_API_KEY?: string; AUTH_MODE?: string; DEMO_ACCESS_HASH?: string };
export function fail(
  status: 400 | 401 | 403 | 404 | 409 | 410 | 413 | 429 | 503,
  message: string,
): never {
  throw new HTTPException(status, { message });
}
export function local(env: RuntimeEnv, request: Request) {
  const u = new URL(request.url);
  return (
    (env.ENVIRONMENT === "local" && ["127.0.0.1", "localhost"].includes(u.hostname)) ||
    (env.ENVIRONMENT === "demo" && u.origin === env.APP_ORIGIN)
  );
}
export async function admin(env: RuntimeEnv, req: Request) {
  let email = "";
  if (local(env, req) || env.AUTH_MODE === "email") {
    const hash = await sha(cookie(req, "bs_admin"));
    const s = await env.DB.prepare(
      "SELECT email FROM sessions WHERE token_hash=? AND scope='admin' AND expires_at>?",
    )
      .bind(hash, now())
      .first<{ email: string }>();
    email = s?.email || "";
  } else {
    if (!env.ACCESS_TEAM_DOMAIN || !env.ACCESS_AUD)
      fail(503, "管理者ログインの設定が必要です");
    try {
      const issuer = "https://" + env.ACCESS_TEAM_DOMAIN;
      const { payload } = await jwtVerify(
        req.headers.get("Cf-Access-Jwt-Assertion") || "",
        createRemoteJWKSet(new URL(issuer + "/cdn-cgi/access/certs")),
        { issuer, audience: env.ACCESS_AUD, algorithms: ["RS256"] },
      );
      email =
        typeof payload.email === "string" ? payload.email.toLowerCase() : "";
    } catch {
      fail(401, "管理者ログインが必要です");
    }
  }
  const m = await env.DB.prepare(
    "SELECT * FROM members WHERE email=? AND active=1",
  )
    .bind(email)
    .first<Member>();
  if (!m) fail(403, "管理者として登録されていません");
  return m;
}
export function cookie(req: Request, name: string) {
  return (
    req.headers
      .get("Cookie")
      ?.split(";")
      .map((v) => v.trim())
      .find((v) => v.startsWith(name + "="))
      ?.slice(name.length + 1) || ""
  );
}
export function setCookie(
  name: string,
  value: string,
  req: Request,
  path = "/",
) {
  return `${name}=${value}; Path=${path}; HttpOnly; SameSite=Strict; Max-Age=28800${new URL(req.url).protocol === "https:" ? "; Secure" : ""}`;
}
export async function limit(
  env: RuntimeEnv,
  key: string,
  max: number,
  seconds: number,
) {
  const t = Date.now();
  const row = await env.DB.prepare(
    "INSERT INTO rate_limits(key,count,resets_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN resets_at<? THEN 1 ELSE count+1 END,resets_at=CASE WHEN resets_at<? THEN excluded.resets_at ELSE resets_at END RETURNING count",
  )
    .bind(key, t + seconds * 1000, t, t)
    .first<{ count: number }>();
  if (row!.count > max) fail(429, "しばらく待ってからもう一度お試しください");
}
async function key(env: RuntimeEnv) {
  if (env.TOKEN_SECRET.length < 32) fail(503, "暗号鍵の設定が必要です");
  return crypto.subtle.importKey(
    "raw",
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(env.TOKEN_SECRET),
    ),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
}
const b64 = (a: Uint8Array) => btoa(String.fromCharCode(...a));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export async function encrypt(env: RuntimeEnv, value: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const data = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    await key(env),
    new TextEncoder().encode(value),
  );
  return b64(iv) + "." + b64(new Uint8Array(data));
}
export async function decrypt(env: RuntimeEnv, value: string) {
  const [iv, data] = value.split(".");
  return new TextDecoder().decode(
    await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      await key(env),
      unb64(data),
    ),
  );
}
export async function codeHash(env: RuntimeEnv, id: string, code: string) {
  const k = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(env.TOKEN_SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return [
    ...new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        k,
        new TextEncoder().encode(id + ":" + code),
      ),
    ),
  ]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export async function auditSecurity(
  env: RuntimeEnv,
  actor: string,
  action: string,
  detail: unknown,
) {
  await env.DB.prepare("INSERT INTO security_events VALUES(?,?,?,?,?)")
    .bind(token(), actor, action, canonical(detail), now())
    .run();
}
export async function session(env: RuntimeEnv, req: Request, verified = true) {
  const hash = await sha(cookie(req, "bs_sign"));
  const row = await env.DB.prepare(
    "SELECT * FROM sessions WHERE token_hash=? AND scope='sign' AND expires_at>?",
  )
    .bind(hash, now())
    .first<{
      token_hash: string;
      contract_id: string;
      email: string;
      verified: number;
      consent_at: string | null;
      downloaded_at: string | null;
    }>();
  if (!row || (verified && !row.verified)) fail(401, "メール確認が必要です");
  return row;
}
export async function newAdminSession(env: RuntimeEnv, email: string) {
  const raw = token();
  await env.DB.prepare(
    "INSERT INTO sessions(token_hash,email,scope,expires_at,verified) VALUES(?,?,'admin',?,1)",
  )
    .bind(await sha(raw), email, later(28800))
    .run();
  return raw;
}
