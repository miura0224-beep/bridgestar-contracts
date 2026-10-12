import { z } from "zod";
export const plans = [
  { id: "habit", name: "習慣プラン", net: 19800 },
  { id: "starter", name: "スタータープラン", net: 29800 },
  { id: "a", name: "PLAN A", net: 39800 },
  { id: "b", name: "PLAN B", net: 49800 },
  { id: "c", name: "PLAN C", net: 59800 },
  { id: "d", name: "PLAN D", net: 69800 },
];
const text = z.string().trim().min(1).max(100);
const date = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine(
    (v) =>
      !isNaN(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v,
    "日付を確認してください",
  );
export const contractInput = z
  .object({
    kind: z.enum(["student", "coach"]),
    title: text,
    partyName: text,
    partyEmail: z
      .email()
      .max(254)
      .transform((v) => v.toLowerCase()),
    templateId: text,
    assignedTo: z.email().transform((v) => v.toLowerCase()),
    startDate: date,
    endDate: date,
    applicationId: z.string().max(100).optional(),
    studentKana: z.string().trim().max(100).default(""),
    guardianKana: z.string().trim().max(100).default(""),
    studentBirthDate: z.union([date, z.literal("")]).default(""),
    guardianBirthDate: z.union([date, z.literal("")]).default(""),
    studentEmail: z.union([z.email().max(254), z.literal("")]).default(""),
    studentPhone: z.string().max(25).default(""),
    studentAddress: z.string().max(180).default(""),
    studentName: z.string().trim().max(100).default(""),
    school: z.string().max(100).default(""),
    grade: z.string().max(20).default(""),
    address: z.string().trim().min(1).max(180),
    phone: z.string().regex(/^[0-9+() -]{8,25}$/),
    planId: z
      .enum(["habit", "starter", "a", "b", "c", "d", "reading-only", "custom"])
      .default("starter"),
    customNet: z.number().int().min(0).max(1000000).default(0),
    reading: z.boolean().default(false),
    hourlyRate: z.number().int().min(1800).max(2500).default(1800),
    subject: z
      .enum(["英語", "数学", "英語・数学", "コーチング"])
      .default("英語"),
    notes: z.string().max(1500).default(""),
  })
  .refine((v) => v.endDate >= v.startDate, "終了日は開始日以降にしてください")
  .refine(
    (v) => v.kind !== "student" || v.studentName.length > 0,
    "生徒氏名が必要です",
  );
export type ContractInput = z.infer<typeof contractInput>;
export function amounts(p: ContractInput) {
  const net =
    (p.planId === "reading-only"
      ? 14800
      : p.planId === "custom"
        ? p.customNet
        : plans.find((x) => x.id === p.planId)!.net) +
    (p.reading && p.planId !== "reading-only" ? 10000 : 0);
  const monthly = Math.round(net * 1.1);
  return {
    net,
    tax: monthly - net,
    monthly,
    firstMonth: null,
  };
}
export function canonical(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
  const o = value as Record<string, unknown>;
  return (
    "{" +
    Object.keys(o)
      .sort()
      .map((k) => JSON.stringify(k) + ":" + canonical(o[k]))
      .join(",") +
    "}"
  );
}
export async function sha(value: string | ArrayBuffer | Uint8Array) {
  const data =
    typeof value === "string" ? new TextEncoder().encode(value) : value;
  return [...new Uint8Array(await crypto.subtle.digest("SHA-256", data))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export function token() {
  return [...crypto.getRandomValues(new Uint8Array(32))]
    .map((x) => x.toString(16).padStart(2, "0"))
    .join("");
}
export const now = () => new Date().toISOString();
export const later = (seconds: number) =>
  new Date(Date.now() + seconds * 1000).toISOString();
export type Status =
  | "draft"
  | "review"
  | "approved"
  | "sent"
  | "signed"
  | "declined"
  | "voided"
  | "expired";
export type Role = "owner" | "approver" | "editor" | "viewer";
export interface Member {
  email: string;
  name: string;
  role: Role;
  active: number;
}
export interface Contract {
  id: string;
  kind: "student" | "coach";
  title: string;
  party_name: string;
  party_email: string;
  payload: string;
  template_id: string;
  body: string;
  content_hash: string;
  pdf_key: string | null;
  pdf_hash: string | null;
  status: Status;
  version: number;
  created_by: string;
  approved_by: string | null;
  assigned_to: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
  signed_at: string | null;
  signature_name: string | null;
  audit_head: string;
}
export interface Template {
  id: string;
  kind: string;
  name: string;
  version: number;
  body: string;
  approved: number;
  approved_by: string | null;
  source: string;
}
export function renderTerms(p: ContractInput, base: string) {
  const a = amounts(p);
  const general = `${p.title}\n\n委託者・運営事業者：株式会社ThreeStars\n代表者：三浦 祐輝\n契約相手：${p.partyName}\nメール：${p.partyEmail}\n住所：${p.address}\n電話：${p.phone}\n契約期間：${p.startDate} ～ ${p.endDate}\n`;
  const selected =
    p.kind === "student"
      ? `\n生徒：${p.studentName}　学校：${p.school}　学年：${p.grade}\n生徒フリガナ：${p.studentKana || "未記入"}　生年月日：${p.studentBirthDate || "未記入"}\n生徒メール：${p.studentEmail || "未記入"}　生徒携帯：${p.studentPhone || "未記入"}\n生徒住所：${p.studentAddress || p.address}\n保護者フリガナ：${p.guardianKana || "未記入"}　生年月日：${p.guardianBirthDate || "未記入"}\n契約・署名者：保護者 ${p.partyName}\n選択プラン：${plans.find((x) => x.id === p.planId)?.name || (p.planId === "reading-only" ? "読書と対話（単独受講）" : "個別設定")}\n読書と対話：${p.planId === "reading-only" ? "単独受講" : p.reading ? "あり（セット受講）" : "なし"}\n月額：${a.monthly.toLocaleString("ja-JP")}円（税込、うち税額${a.tax.toLocaleString("ja-JP")}円）\n通常月のコーチング回数：月4回を全額の基準とする。\n初月請求：契約開始日と当月に実施できるコーチング回数に応じて変動する。契約内容に基づく請求書を別途送付する。\n`
      : `\n指導科目：${p.subject}\n通常指導費：時給${p.hourlyRate}円\n試用期間：契約開始から2か月、指導費時給1,800円\nコーチング30分：1回1,000円\nSlack対応：実施日1日当たり200円\n稼働品質加算：提出率80%以上で3,000円／名／月\n継続手当：90日継続で5,000円／名、1回限り\nオンライン研修：時給1,300円\n支払い：月末締め翌月25日払い\n`;
  return (
    general +
    selected +
    (p.notes ? "\n個別合意事項\n" + p.notes + "\n" : "") +
    "\n契約条項\n" +
    base
      .replaceAll("{{startDate}}", p.startDate)
      .replaceAll("{{endDate}}", p.endDate)
  );
}
