import { z } from "zod";
import { changeForms, commonChangeFields } from "./change-forms";
import { fail } from "./security";
export function validateNotice(raw: unknown, email: string) {
  const base = z
    .object({
      formId: z.string(),
      values: z.record(z.string(), z.string().max(2000)),
      guardianSignature: z.string().trim().min(1).max(100),
      studentSignature: z.string().trim().min(1).max(100),
      confirmed: z.literal(true),
    })
    .parse(raw);
  const form = changeForms.find((f) => f.id === base.formId);
  if (!form) fail(400, "届出の種類を選んでください");
  const values: Record<string, string> = {};
  for (const f of [...commonChangeFields, ...form.fields]) {
    const v = (base.values[f.key] || "").trim();
    if (f.required && !v) fail(400, f.label + "を入力してください");
    if (
      v &&
      "options" in f &&
      Array.isArray(f.options) &&
      !f.options.includes(v)
    )
      fail(400, f.label + "を選び直してください");
    if (v && f.type === "email" && !z.email().safeParse(v).success)
      fail(400, f.label + "を確認してください");
    if (v && f.type === "tel" && !/^[\d+() −-]{8,25}$/.test(v))
      fail(400, f.label + "を確認してください");
    if (
      v &&
      f.type === "date" &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(v) ||
        isNaN(Date.parse(v)) ||
        new Date(v).toISOString().slice(0, 10) !== v)
    )
      fail(400, f.label + "を確認してください");
    if (v && f.type === "month" && !/^\d{4}-(0[1-9]|1[0-2])$/.test(v))
      fail(400, f.label + "を確認してください");
    values[f.key] = v;
  }
  if (["phone", "email"].includes(form.id)) {
    const suffix = form.id === "phone" ? "Phone" : "Email";
    for (const [target, key] of [
      ["塾生", "student"],
      ["保護者", "guardian"],
    ])
      if ([target, "両方"].includes(values.target) && !values[key + suffix])
        fail(400, target + "の新しい連絡先を入力してください");
  }
  if (form.id === "address" && !/^\d{3}-?\d{4}$/.test(values.postalCode))
    fail(400, "郵便番号は7桁で入力してください");
  if (
    form.id === "withdrawal" &&
    ["bank", "branch", "accountNumber", "accountName"].some((k) => values[k])
  ) {
    if (
      !["bank", "branch", "accountType", "accountNumber", "accountName"].every(
        (k) => values[k],
      ) ||
      !/^\d{7}$/.test(values.accountNumber)
    )
      fail(400, "返金口座の全項目と7桁の口座番号を確認してください");
  }
  if (
    base.guardianSignature !== values.partyName ||
    base.studentSignature !== values.studentName
  )
    fail(400, "確認欄の氏名を塾生・保護者情報と一致させてください");
  return {
    ...base,
    values,
    email,
    formName: form.name,
    notice: form.notice,
    formVersion: 1,
  };
}
