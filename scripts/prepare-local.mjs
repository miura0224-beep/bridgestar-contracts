import { writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
if (!existsSync(".dev.vars"))
  writeFileSync(
    ".dev.vars",
    'TOKEN_SECRET="' + randomBytes(48).toString("hex") + '"\n',
    { mode: 0o600 },
  );
const q = (s) => "'" + s.replaceAll("'", "''") + "'";
const users = [
  ["owner@example.test", "管理責任者", "owner"],
  ["approver@example.test", "承認担当", "approver"],
  ["editor@example.test", "作成担当", "editor"],
  ["viewer@example.test", "閲覧担当", "viewer"],
];
let sql = users
  .map(
    (u) =>
      "INSERT OR IGNORE INTO members(email,name,role) VALUES(" +
      u.map(q).join(",") +
      ");",
  )
  .join("\n");
for (const kind of ["student", "coach"]) {
  const name =
    kind === "student" ? "動作確認用・生徒契約" : "動作確認用・コーチ契約";
  const body =
    "【動作確認専用：実際の契約には使用しません】\nこのひな形は、システムの入力・承認・メール確認・署名・保存の動作を確認するためのサンプルです。記載された氏名・住所・契約条件はすべて架空のものを使用してください。実在する生徒、保護者、コーチとの契約には、運営事業者が内容を確認し承認した正式な契約書を使用します。\n本サンプルの操作では契約の成立を意図せず、実際の業務委託や授業料の請求は行いません。\n確認する内容：選択した条件が契約書に反映されること、契約書を保存できること、署名後に合意記録を取得できること。";
  sql += `\nINSERT OR IGNORE INTO templates(id,kind,name,version,body,approved,approved_by,source) VALUES(${[q("demo-" + kind), q(kind), q(name), "1", q(body), "1", q("owner@example.test"), q("架空の動作確認専用サンプル")].join(",")});`;
}
writeFileSync("private/local-seed.sql", sql);
console.log("Local-only seed prepared.");
