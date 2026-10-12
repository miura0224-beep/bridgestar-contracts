const $ = (s, root = document) => root.querySelector(s),
  $$ = (s, root = document) => [...root.querySelectorAll(s)];
const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const state = {
  config: null,
  me: null,
  contracts: [],
  templates: [],
  members: [],
  page: "dashboard",
  filter: "all",
};
const statuses = {
  draft: "下書き",
  review: "承認待ち",
  approved: "送信準備完了",
  sent: "署名待ち",
  signed: "締結済み",
  declined: "修正のご依頼",
  voided: "取消済み",
  expired: "期限切れ",
};
const actions = {
  created: "契約を作成",
  review_requested: "社内承認を依頼",
  approved: "契約内容を承認",
  returned: "社内差し戻し",
  invited: "署名依頼を送信待ちに登録",
  reinvited: "署名依頼を再登録",
  email_verified: "メールアドレスを確認",
  electronic_delivery_consented: "電子交付に同意",
  document_download_requested: "契約書の保存を要求",
  signed: "契約に同意・署名",
  declined: "修正を依頼",
  voided: "契約を取消",
  expired: "署名期限が終了",
};
const roleNames = {
  owner: "管理責任者",
  approver: "承認担当",
  editor: "作成担当",
  viewer: "閲覧担当",
};
const date = (v) =>
  v
    ? new Date(v).toLocaleString("ja-JP", {
        month: "numeric",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : "—";
const money = (v) => "¥" + Number(v).toLocaleString("ja-JP");
function toast(msg) {
  $("#toast").textContent = msg;
  $("#toast").style.display = "block";
  setTimeout(() => ($("#toast").style.display = "none"), 4500);
}
async function api(path, body) {
  const r = await fetch("/api" + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await r.json();
  if (!r.ok) throw new Error(value.error || "処理できませんでした");
  return value;
}
function bind(selector, event, fn) {
  $$(selector).forEach((el) =>
    el.addEventListener(event, async (e) => {
      try {
        await fn(e, el);
      } catch (error) {
        toast(error.message);
      }
    }),
  );
}
function buttonBusy(button, fn) {
  const controls = $$("button").map(el => [el, el.disabled]);
  const label = button.innerHTML;
  controls.forEach(([el]) => { el.disabled = true; });
  button.textContent = "処理中…";
  return Promise.resolve().then(fn).finally(() => {
    controls.forEach(([el, disabled]) => { if (el.isConnected) el.disabled = disabled; });
    if (button.isConnected) button.innerHTML = label;
  });
}
function badge(s) {
  return `<span class="badge ${s}">${statuses[s] || escape(s)}</span>`;
}
function field(name, label, type = "text", value = "", extra = "") {
  return `<div class="field"><label for="${name}">${label}</label><input id="${name}" name="${name}" type="${type}" value="${escape(value)}" ${extra}></div>`;
}
function select(name, label, options, value) {
  return `<div class="field"><label for="${name}">${label}</label><select id="${name}" name="${name}">${options.map((o) => `<option value="${escape(o.value)}" ${value === o.value ? "selected" : ""}>${escape(o.label)}</option>`).join("")}</select></div>`;
}
function shell(content) {
  $("#toast").style.display = "none";
  const nav = [
    ...(state.config.demo ? [["demo", "◇", "デモの進め方"]] : []),
    ["dashboard", "◫", "ホーム"],
    ["contracts", "▤", "契約一覧"],
    ["approvals", "✓", "入塾の承認"],
    ["applications", "◇", "入塾申込"],
    ["changes", "↺", "諸変更届"],
    ["templates", "▧", "契約のひな形"],
    ["team", "♧", "チーム"],
    ["mail", "✉", "送信状況"],
  ];
  $("#app").innerHTML =
    `<div class="layout"><aside class="sidebar"><div class="logo">bridge<b>★</b></div><div class="logo-sub">CONTRACT WORKSPACE</div><nav class="nav" aria-label="メインメニュー">${nav.map(([id, icon, label]) => `<button data-nav="${id}" class="${state.page === id ? "active" : ""}"><span class="icon" aria-hidden="true">${icon}</span>${label}</button>`).join("")}</nav><a class="btn small" href="/manual">利用マニュアル ↗</a><div class="side-bottom">大切な約束を、<br>気持ちよく、確かに。<div class="user"><span class="avatar">${escape(state.me.name[0])}</span>${escape(state.me.name)}<p class="small">${roleNames[state.me.role]}</p><button class="link" id="logout">ログアウト</button></div></div></aside><main class="main"><div class="topbar"><span>中高一貫ブリッジスター / 契約管理</span><span class="topbar-right"><span class="environment">${state.config.local ? "テスト環境・メール送信なし" : state.config.live ? "本番環境" : "設定中・送信停止"}</span><span>${new Date().toLocaleDateString("ja-JP", { month: "long", day: "numeric", weekday: "short" })}</span></span></div>${content}</main></div>`;
  bind("[data-nav]", "click", (_, el) => navigate(el.dataset.nav));
  bind("#logout", "click", async () => {
    const r = await api("/admin/logout", {});
    location.href = r.redirect;
  });
  bind("[data-new]", "click", () => wizard());
  bind("[data-open]", "click", (_, el) => detail(el.dataset.open));
}
async function load() {
  [state.contracts, state.templates, state.members] = await Promise.all([
    api("/admin/contracts"),
    api("/admin/templates"),
    api("/admin/members"),
  ]);
}
async function navigate(page) {
  if (page === "demo") { state.page = page; await load(); await demoGuide(); return; }
  if (page === "approvals") {
    state.page = page;
    history.replaceState(null, "", "/?view=approvals");
    await load();
    await approvalInbox();
    return;
  }
  if (new URLSearchParams(location.search).get("view") === "approvals") history.replaceState(null, "", "/");
  if (page === "changes") {
    state.page = page;
    await changesPage();
    return;
  }
  if (page === "applications") {
    state.page = page;
    await load();
    await applicationsPage();
    return;
  }
  state.page = page;
  await load();
  if (page === "dashboard" || page === "contracts") dashboard();
  if (page === "templates") templates();
  if (page === "team") team();
  if (page === "mail") await mailbox();
}
function table(rows) {
  if (!rows.length)
    return '<div class="empty">該当する契約はありません。<br><span class="small">新しい契約を作成すると、進み具合をここで確認できます。</span></div>';
  return `<div class="table-scroll"><table><thead><tr><th>契約 / お相手</th><th>種別</th><th>進み具合</th><th>担当者</th><th>最終更新</th><th></th></tr></thead><tbody>${rows.map((c) => `<tr><td><button class="title-button" data-open="${c.id}">${escape(c.title)}</button><div class="muted small">${escape(c.party_name)} 様</div></td><td><span class="tag">${c.kind === "student" ? "生徒・保護者" : "コーチ"}</span></td><td>${badge(c.status)}</td><td class="small">${escape(state.members.find((m) => m.email === c.assigned_to)?.name || c.assigned_to)}</td><td class="small muted">${date(c.updated_at)}</td><td><button class="btn small ghost" data-open="${c.id}" aria-label="${escape(c.title)}を開く">→</button></td></tr>`).join("")}</tbody></table></div>`;
}
function dashboard() {
  const cs = state.contracts,
    home = state.page === "dashboard";
  const waiting = cs.filter((c) => c.status === "review").length;
  const expiring = cs.filter(
    (c) =>
      c.status === "sent" && Date.parse(c.expires_at) - Date.now() < 2 * 864e5,
  ).length;
  shell(
    `<div class="heading"><div><div class="eyebrow">${home ? "YOUR WORKSPACE" : "ALL CONTRACTS"}</div><h1>${home ? "今日の契約状況" : "契約一覧"}</h1><p class="muted">${home ? "確認することを、ひとつずつ。チームで契約を進めましょう。" : "生徒・保護者とコーチの契約を、ひとつの場所で。"}</p></div>${state.me.role !== "viewer" ? '<button class="btn primary" data-new>＋ 新しい契約</button>' : ""}</div>${
      home
        ? `<section class="stats" aria-label="契約の集計">${[
            ["review", "社内の確認待ち", "チームで内容を確認"],
            ["sent", "お相手の署名待ち", "メールの送信状況も確認"],
            ["signed", "締結済み", "合意記録を保存しています"],
            ["draft", "作成中の契約", "続きから準備できます"],
          ]
            .map(
              ([s, l, n]) =>
                `<div class="stat"><div class="stat-label">${l}<span>↗</span></div><div class="stat-number">${cs.filter((c) => c.status === s).length}<small>件</small></div><div class="stat-note">${n}</div></div>`,
            )
            .join(
              "",
            )}</section><section class="hero"><div><div class="eyebrow">NEXT ACTION</div><h2>${waiting ? `${waiting}件の契約が、社内確認を待っています。` : expiring ? `${expiring}件の署名期限が近づいています。` : "契約の準備は、ひな形を選ぶところから。"}</h2><p class="muted small">${waiting ? "契約内容とお相手を確認したら、承認して次のステップへ。" : "条件を選ぶ → チームで確認 → メールで署名依頼。"}</p><div class="steps-line"><span>01 条件の選択</span><span>→</span><span>02 社内確認</span><span>→</span><span>03 ご署名・保存</span></div></div><div class="star">✳</div></section>`
        : ""
    }<section class="panel"><div class="panel-head"><h2>${home ? "契約の進み具合" : "すべての契約"} <span class="muted small">${cs.length}件</span></h2><button class="btn small" id="export-csv">一覧を保存 ↓</button></div><div class="filters"><input id="search" aria-label="契約を検索" placeholder="⌕  お名前・契約名・メールで検索"><select id="status-filter" aria-label="進み具合で絞り込み"><option value="all">すべての進み具合</option>${Object.entries(
      statuses,
    )
      .map(([v, l]) => `<option value="${v}">${l}</option>`)
      .join(
        "",
      )}</select><select id="kind-filter" aria-label="種別で絞り込み"><option value="all">すべての種別</option><option value="student">生徒・保護者</option><option value="coach">コーチ</option></select></div><div id="contract-table">${table(cs)}</div></section><p class="small muted">契約内容は送信時に固定されます。締結後は、契約書と合意の記録をセットで保存してください。</p>`,
  );
  const filter = () => {
    const q = $("#search").value.toLowerCase(),
      s = $("#status-filter").value,
      k = $("#kind-filter").value;
    $("#contract-table").innerHTML = table(
      cs.filter(
        (c) =>
          (s === "all" || c.status === s) &&
          (k === "all" || c.kind === k) &&
          `${c.title} ${c.party_name} ${c.party_email}`
            .toLowerCase()
            .includes(q),
      ),
    );
    bind("#contract-table [data-open]", "click", (_, el) =>
      detail(el.dataset.open),
    );
  };
  bind("#search", "input", filter);
  bind("#status-filter,#kind-filter", "change", filter);
  bind("#export-csv", "click", () => {
    const quote = (v) =>
      '"' +
      String(v ?? "")
        .replace(/^[=+@-]/, "'$&")
        .replace(/"/g, '""') +
      '"';
    const csv =
      "\uFEFF" +
      [
        ["契約番号", "契約名", "相手", "メール", "状態", "更新日"],
        ...cs.map((c) => [
          c.id,
          c.title,
          c.party_name,
          c.party_email,
          statuses[c.status],
          c.updated_at,
        ]),
      ]
        .map((row) => row.map(quote).join(","))
        .join("\r\n");
    download(csv, "契約一覧.csv", "text/csv;charset=utf-8");
  });
}
function download(text, name, type = "application/json") {
  const url = URL.createObjectURL(new Blob([text], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
async function ask(reason, title = "確認") {
  const d = $("#dialog");
  d.innerHTML = `<h2>${title}</h2><p>${escape(reason)}</p><form method="dialog"><div class="field"><label for="reason">理由</label><textarea id="reason" required maxlength="1000" rows="4"></textarea></div><div class="row"><button class="btn" value="cancel" formnovalidate>戻る</button><button class="btn primary" value="ok">確定する</button></div></form>`;
  d.showModal();
  return new Promise((resolve) =>
    d.addEventListener(
      "close",
      () => resolve(d.returnValue === "ok" ? $("#reason", d).value : null),
      { once: true },
    ),
  );
}
async function detail(id) {
  const d = await api("/admin/contracts/" + id),
    c = d.contract;
  const p = JSON.parse(c.payload);
  const can = state.me.role !== "viewer";
  const owner = ["owner", "approver"].includes(state.me.role);
  const buttons = [];
  if (can && c.status === "draft") buttons.push(["review", "社内承認を依頼"]);
  if (owner && c.status === "review") buttons.push(["approve", "内容を承認"]);
  if (can && c.status === "review") buttons.push(["return", "差し戻す"]);
  if (can && c.status === "approved") buttons.push(["send", "署名依頼を送信"]);
  if (can && c.status === "sent") buttons.push(["resend", "署名依頼を再送"]);
  shell(
    `<div class="heading"><div><button class="link small muted" id="back">← 契約一覧</button><h1 class="gap-top">${escape(c.title)}</h1><div class="row">${badge(c.status)}<span class="small muted">${escape(c.party_name)} 様 ・ ${escape(c.party_email)}</span></div></div><div class="row">${buttons.map(([a, l]) => `<button class="btn ${a === "return" ? "" : "primary"}" data-action="${a}">${l}</button>`).join("")}</div></div>${!state.templates.find((t) => t.id === c.template_id)?.approved ? '<div class="notice">この契約は未承認のひな形を使用しています。正式版のひな形を登録後、「修正して新しく作成」から作り直してください。</div>' : ""}${c.kind === "student" && c.status === "review" ? `<p class="notice"><a href="/?view=approvals&id=${encodeURIComponent(c.id)}">スマホ用の承認画面を開く・リンクを共有 →</a></p>` : ""}<div class="detail-grid"><div><div class="panel"><div class="panel-head"><h2>契約内容</h2><a class="btn small" href="/api/admin/contracts/${id}/pdf">PDFを保存 ↓</a></div><div class="card"><div class="row between"><span class="muted small">${c.kind === "student" ? "生徒・保護者との契約" : "コーチとの業務委託"}</span><span class="small">${escape(p.startDate)} ～ ${escape(p.endDate)}</span></div><div class="document gap-top">${escape(c.body)}</div></div></div><div class="row">${can ? '<button class="btn" id="copy-contract">修正して新しく作成</button>' : ""}${c.status === "signed" ? `<a class="btn" href="/api/admin/contracts/${id}/receipt">合意記録PDFを保存</a>` : ""}<a class="btn" href="/api/admin/contracts/${id}/evidence">詳細記録を保存</a>${can && ["draft", "review", "approved", "sent"].includes(c.status) ? '<button class="btn danger" data-action="void">契約を取り消す</button>' : ""}</div></div><aside><section class="card"><h2>これまでの記録</h2><ul class="timeline">${d.events.map((e) => `<li><strong>${actions[e.action] || escape(e.action)}</strong><div class="muted">${escape(state.members.find((m) => m.email === e.actor)?.name || e.actor)}</div><time>${date(e.at)}</time>${JSON.parse(e.detail).reason ? `<p>${escape(JSON.parse(e.detail).reason)}</p>` : ""}</li>`).join("")}</ul></section><section class="card gap-top"><h2>チームのメモ</h2><p class="muted small">お相手には表示されません。</p>${d.comments.map((m) => `<div class="comment"><strong class="small">${escape(state.members.find((x) => x.email === m.author)?.name || m.author)}</strong><p>${escape(m.body)}</p><span class="small muted">${date(m.created_at)}</span></div>`).join("") || '<p class="muted small">確認事項や引き継ぎを残せます。</p>'}${can ? '<form id="comment-form" class="gap-top"><div class="field"><label for="comment-body">メモを追加</label><textarea id="comment-body" rows="3" maxlength="2000" required></textarea></div><button class="btn small">メモを保存</button></form>' : ""}</section><section class="card gap-top"><h2>メール送信状況</h2>${d.mail.map((m) => `<p class="small">${escape(m.subject)}<br><span class="badge">${mailStatus(m.state)}</span> <span class="muted">${date(m.created_at)}</span></p>`).join("") || '<p class="small muted">まだ送信していません。</p>'}</section></aside></div>`,
  );
  bind("#back", "click", () => navigate("contracts"));
  bind("#copy-contract", "click", () =>
    wizard(2, { ...p, applicationId: undefined }),
  );
  bind("[data-action]", "click", async (_, el) => {
    const a = el.dataset.action;
    let reason = "";
    if (["return", "void"].includes(a)) {
      reason = await ask(
        a === "void"
          ? "署名リンクを無効にして、この契約を取り消します。"
          : "作成担当者へ修正内容を伝えます。",
      );
      if (reason === null) return;
    }
    await buttonBusy(el, async () => {
      await api(`/admin/contracts/${id}/action`, {
        action: a,
        version: c.version,
        reason,
      });
      await load();
      await detail(id);
      toast(a === "review" && c.kind === "student" ? "ユウキ先生への承認依頼メールを送信待ちに登録しました" : a === "approve" && c.kind === "student" ? "承認し、作成担当者への完了メールを送信待ちに登録しました" : "更新しました");
    });
  });
  bind("#comment-form", "submit", async (e) => {
    e.preventDefault();
    await api(`/admin/contracts/${id}/comment`, {
      body: $("#comment-body").value,
    });
    await detail(id);
  });
}
let draft = {};
function wizard(step = 1, initial) {
  if (initial) draft = { ...initial };
  if (step === 1) draft = {};
  state.page = "contracts";
  const header = `<div class="wizard"><div class="heading"><div><div class="eyebrow">NEW CONTRACT</div><h1>新しい契約を準備する</h1><p class="muted">必要な項目を選んで、契約書を整えましょう。</p></div></div><div class="progress">${["1 契約を選ぶ", "2 条件を入力", "3 内容を確認"].map((s, i) => `<span class="${i + 1 === step ? "active" : ""}">${s}</span>`).join("")}</div>`;
  if (step === 1) {
    shell(
      header +
        `<div class="choice-grid"><button class="choice" data-kind="student"><div class="choice-icon">♧</div><h2>生徒・保護者との契約</h2><p class="muted">入塾・受講プランのご契約。<br>保護者の方に確認・署名をお願いします。</p><span class="small">プラン選択 / 料金の自動計算 →</span></button><button class="choice" data-kind="coach"><div class="choice-icon">✧</div><h2>コーチとの契約</h2><p class="muted">指導・コーチングの業務委託。<br>報酬・指導条件を選んで作成します。</p><span class="small">報酬設定 / 業務内容の確認 →</span></button></div><button class="btn gap-top" id="cancel">契約一覧に戻る</button></div>`,
    );
    bind("[data-kind]", "click", (_, el) => {
      draft.kind = el.dataset.kind;
      wizard(2);
    });
    bind("#cancel", "click", () => navigate("contracts"));
    return;
  }
  if (step === 2) {
    const isStudent = draft.kind === "student",
      ts = state.templates.filter((t) => t.kind === draft.kind),
      today = new Date().toISOString().slice(0, 10);
    shell(
      header +
        `<form id="contract-form" class="card"><h2>${isStudent ? "生徒・保護者との契約" : "コーチとの契約"}</h2>${draft.applicationId ? '<div class="notice">保護者が入力した申込内容を引き継いでいます。条件を変更する場合は、保護者へ確認してから確定してください。</div>' : ""}<div class="fields">${field("title", "契約名", "text", draft.title || (isStudent ? "入塾・受講契約" : "講師業務委託契約"), 'required maxlength="100"')}${select(
          "templateId",
          "使用するひな形",
          ts.map((t) => ({
            value: t.id,
            label: `${t.name} v${t.version}${t.approved ? "" : "（未承認）"}`,
          })),
          draft.templateId,
        )}${field("partyName", isStudent ? "保護者氏名（署名する方）" : "コーチ氏名", "text", draft.partyName, 'required maxlength="100" autocomplete="name"')}${field("partyEmail", "署名依頼先メールアドレス", "email", draft.partyEmail, 'required autocomplete="email"')}${
          isStudent
            ? field(
                "studentName",
                "生徒氏名",
                "text",
                draft.studentName,
                'required maxlength="100"',
              ) +
              field(
                "studentKana",
                "生徒フリガナ",
                "text",
                draft.studentKana,
                'maxlength="100"',
              ) +
              field(
                "guardianKana",
                "保護者フリガナ",
                "text",
                draft.guardianKana,
                'maxlength="100"',
              ) +
              field(
                "studentBirthDate",
                "生徒生年月日（任意）",
                "date",
                draft.studentBirthDate,
              ) +
              field(
                "guardianBirthDate",
                "保護者生年月日（任意）",
                "date",
                draft.guardianBirthDate,
              ) +
              field("studentEmail", "生徒メール", "email", draft.studentEmail) +
              field(
                "studentPhone",
                "生徒携帯（任意）",
                "tel",
                draft.studentPhone,
              ) +
              field(
                "studentAddress",
                "生徒住所",
                "text",
                draft.studentAddress,
                'maxlength="180"',
              ) +
              field(
                "school",
                "在籍学校",
                "text",
                draft.school,
                'maxlength="100"',
              ) +
              select(
                "grade",
                "学年",
                ["中1", "中2", "中3", "高1", "高2", "高3", "その他"].map(
                  (v) => ({ value: v, label: v }),
                ),
                draft.grade,
              )
            : select(
                "subject",
                "指導科目",
                ["英語", "数学", "英語・数学", "コーチング"].map((v) => ({
                  value: v,
                  label: v,
                })),
                draft.subject,
              ) +
              field(
                "hourlyRate",
                "通常指導費（時給・円）",
                "number",
                draft.hourlyRate || 1800,
                'required min="1800" max="2500" step="1"',
              )
        }${field("address", "契約者の住所", "text", draft.address, 'required maxlength="180" autocomplete="street-address"')}${field("phone", "電話番号", "tel", draft.phone, 'required maxlength="25" autocomplete="tel"')}${field("startDate", "契約開始日", "date", draft.startDate || today, "required")}${field("endDate", "契約終了日", "date", draft.endDate || "2027-03-31", "required")}${select(
          "assignedTo",
          "担当者",
          state.members
            .filter((m) => m.active)
            .map((m) => ({ value: m.email, label: m.name })),
          draft.assignedTo || state.me.email,
        )}</div>${isStudent ? `<h3 class="gap-top">受講プラン</h3><div class="fields">${select("planId", "メインプラン（税別）", [...state.config.plans.map((p) => ({ value: p.id, label: `${p.name} / ${money(p.net)}` })), { value: "reading-only", label: "読書と対話（単独） / 14,800円" }, { value: "custom", label: "個別設定" }], draft.planId || "starter")}${field("customNet", "個別設定の月額（税別・円）", "number", draft.customNet || 0, 'min="0" max="1000000" step="1"')}</div><label class="check"><input type="checkbox" name="reading" ${draft.reading ? "checked" : ""}>読書と対話を追加（セット受講：月額10,000円・税別）</label><div class="summary" id="price-summary"></div><p class="muted small">通常月はコーチング4回を全額の基準とします。初月は開始日と実施可能回数に応じて変動し、契約内容に基づく請求書を別途送付します。</p>` : '<div class="summary small">試用2か月は時給1,800円 / 30分コーチング1,000円 / Slack対応200円・日 / 品質加算3,000円 / 90日継続5,000円 / オンライン研修時給1,300円</div>'}<div class="field gap-top"><label for="notes">個別合意事項（任意）</label><textarea name="notes" id="notes" maxlength="1500" rows="4">${escape(draft.notes || "")}</textarea><span class="help">お相手にも表示され、契約内容に含まれます。</span></div><div class="form-footer"><button class="btn" type="button" id="prev">戻る</button><button class="btn primary" type="submit">契約内容を確認 →</button></div></form></div>`,
    );
    const read = () => {
      const f = new FormData($("#contract-form"));
      draft = {
        ...draft,
        ...Object.fromEntries(f),
        kind: isStudent ? "student" : "coach",
        reading: f.has("reading"),
        customNet: Number(f.get("customNet") || 0),
        hourlyRate: Number(f.get("hourlyRate") || 1800),
      };
    };
    const pricing = () => {
      if (!isStudent) return;
      read();
      const net =
          (draft.planId === "reading-only"
            ? 14800
            : draft.planId === "custom"
              ? draft.customNet
              : state.config.plans.find((p) => p.id === draft.planId)?.net ||
                0) +
          (draft.reading && draft.planId !== "reading-only" ? 10000 : 0),
        gross = Math.round(net * 1.1);
      $("#price-summary").innerHTML =
        `<div class="row between"><span>毎月のお支払い（税込）</span><strong class="money">${money(gross)}</strong></div><div class="small muted">初月の請求額は別途請求書でご案内 ・ うち消費税 ${money(gross - net)}</div>`;
    };
    bind("#contract-form", "change", pricing);
    pricing();
    bind("#prev", "click", () => wizard(1));
    bind("#contract-form", "submit", (e) => {
      e.preventDefault();
      read();
      if (draft.endDate < draft.startDate)
        throw new Error("終了日は開始日以降にしてください");
      wizard(3);
    });
    return;
  }
  const t = state.templates.find((t) => t.id === draft.templateId);
  shell(
    header +
      `<section class="card"><h2>この内容で下書きを保存します</h2><div class="summary"><h3>${escape(draft.title)}</h3><p>${escape(draft.partyName)} 様 / ${escape(draft.partyEmail)}</p><p class="small">${escape(draft.startDate)} ～ ${escape(draft.endDate)}<br>担当：${escape(state.members.find((m) => m.email === draft.assignedTo)?.name)}<br>ひな形：${escape(t?.name)} v${t?.version}</p></div>${!t?.approved ? '<div class="notice">このひな形は未承認です。下書きは保存できますが、署名依頼の前に正式版で作り直す必要があります。</div>' : ""}${draft.kind === "student" ? applicationSummary(draft) : ""}<h3>契約条項</h3><div class="document">${escape(t?.body)}</div>${draft.notes ? `<h3 class="gap-top">個別合意事項</h3><p>${escape(draft.notes)}</p>` : ""}<div class="form-footer"><button class="btn" id="prev">入力内容を修正</button><button class="btn primary" id="save">下書きを保存</button></div><p class="muted small gap-top">保存後、社内承認を依頼できます。この操作ではメールは送信されません。</p></section></div>`,
  );
  bind("#prev", "click", () => wizard(2));
  bind("#save", "click", (_, el) =>
    buttonBusy(el, async () => {
      const row = await api("/admin/contracts", draft);
      await load();
      toast("下書きを保存しました");
      await detail(row.id);
    }),
  );
}
function templates() {
  shell(
    `<div class="heading"><div><div class="eyebrow">CONTRACT TEMPLATES</div><h1>契約のひな形</h1><p class="muted">条件は入力欄から。共通の条項は、承認したひな形から。</p></div></div><div class="notice">正式版への登録前に、契約期間・料金・解約条件・電子交付の手順を確認してください。新しい版を登録しても、作成済みの契約は変わりません。</div><div class="cards">${state.templates
      .map(
        (t) =>
          `<section class="card"><div class="row between"><span class="tag">${t.kind === "student" ? "生徒・保護者" : "コーチ"}</span><span class="badge ${t.approved ? "approved" : "review"}">${t.approved ? "使用承認済み" : "内容確認が必要"}</span></div><h2 class="gap-top">${escape(t.name)}</h2><p class="muted small">バージョン ${t.version}<br>出典：${escape(t.source)}</p><div class="row gap-top">${(t.kind ===
          "student"
            ? [["student-original", "契約書の原本"]]
            : [
                ["coach-explanation", "説明資料の原本"],
                ["coach-acceptance", "承諾書の原本"],
              ]
          )
            .map(
              ([id, label]) =>
                `<a class="btn small" href="/api/admin/source/${id}">${label} ↓</a>`,
            )
            .join(
              "",
            )}</div><p></p><button class="btn small" data-template="${t.id}">${state.me.role === "owner" ? "確認・新しい版を登録" : "内容を見る"} →</button></section>`,
      )
      .join("")}</div>`,
  );
  bind("[data-template]", "click", (_, el) =>
    templateEditor(state.templates.find((t) => t.id === el.dataset.template)),
  );
}
function templateEditor(t) {
  const owner = state.me.role === "owner";
  shell(
    `<div class="heading"><div><h1>${escape(t.name)}</h1><p class="muted">v${t.version} をもとに新しい版を作成します。</p></div></div><form id="template-form" class="card">${field("templateName", "ひな形の名前", "text", t.name, 'required maxlength="100"')}<div class="field"><label for="templateBody">契約条項（全文）</label><textarea id="templateBody" rows="24" maxlength="40000" required ${owner ? "" : "readonly"}>${escape(t.body)}</textarea></div>${owner ? '<label class="check"><input id="approved" type="checkbox">契約内容・電子交付手順を確認し、この版の使用を承認する</label>' : ""}<div class="notice">生徒契約の原資料には、特定商取引法ガイドと照合が必要な解約条項があります。候補版をそのまま正式版として扱わないでください。</div><div class="row"><button type="button" class="btn" id="back">戻る</button>${owner ? '<button class="btn primary">新しい版を保存</button>' : ""}</div></form>`,
  );
  bind("#back", "click", () => navigate("templates"));
  bind("#template-form", "submit", async (e) => {
    e.preventDefault();
    await api("/admin/templates", {
      kind: t.kind,
      name: $("#templateName").value,
      body: $("#templateBody").value,
      source: t.source,
      approved: $("#approved").checked,
    });
    toast("新しい版を登録しました");
    await navigate("templates");
  });
}
function team() {
  shell(
    `<div class="heading"><div><div class="eyebrow">TEAM</div><h1>チームで進める</h1><p class="muted">それぞれのアカウントでログインし、役割に応じて作業します。</p></div></div><div class="panel"><div class="table-scroll"><table><thead><tr><th>メンバー</th><th>メールアドレス</th><th>役割</th><th>状態</th><th></th></tr></thead><tbody>${state.members.map((m) => `<tr><td>${escape(m.name)}</td><td>${escape(m.email)}</td><td>${roleNames[m.role]}</td><td>${m.active ? "有効" : "無効"}</td><td>${state.me.role === "owner" ? `<button class="btn small" data-member="${escape(m.email)}">編集</button>` : ""}</td></tr>`).join("")}</tbody></table></div></div><div class="cards"><section class="card"><h2>役割ごとの操作</h2><p class="small">管理責任者：メンバー・ひな形の管理と契約操作<br>承認担当：契約の作成・承認・送信<br>作成担当：契約の作成・承認依頼・送信<br>閲覧担当：契約と履歴の確認・保存</p><p class="muted small">契約の承認は、作成者とは別の人が行います。</p></section>${
      state.me.role === "owner"
        ? `<form id="member-form" class="card"><h2>メンバーを登録・変更</h2>${field("memberName", "氏名", "text", "", "required")}${field("memberEmail", "メールアドレス", "email", "", "required")}${select(
            "memberRole",
            "役割",
            Object.entries(roleNames).map(([value, label]) => ({
              value,
              label,
            })),
            "editor",
          )}<label class="check"><input id="memberActive" type="checkbox" checked>アカウントを有効にする</label><button class="btn primary">保存する</button><p class="small muted gap-top">メールは送信されません。本番利用時はCloudflare Accessにも同じメンバーを登録してください。</p></form>`
        : ""
    }</div>`,
  );
  bind("[data-member]", "click", (_, el) => {
    const m = state.members.find((m) => m.email === el.dataset.member);
    $("#memberName").value = m.name;
    $("#memberEmail").value = m.email;
    $("#memberRole").value = m.role;
    $("#memberActive").checked = !!m.active;
    $("#memberName").focus();
  });
  bind("#member-form", "submit", async (e) => {
    e.preventDefault();
    await api("/admin/members", {
      name: $("#memberName").value,
      email: $("#memberEmail").value,
      role: $("#memberRole").value,
      active: $("#memberActive").checked ? 1 : 0,
    });
    toast("メンバーを保存しました");
    await navigate("team");
  });
}
function mailStatus(s) {
  return (
    {
      pending: state.config.local ? "テスト保管" : "送信待ち",
      sending: "送信処理中",
      sent: "送信サービス受付済み",
      failed: "送信失敗",
      cancelled: "取消済み",
    }[s] || s
  );
}
async function mailbox() {
  const messages = await api("/admin/outbox");
  shell(
    `<div class="heading"><div><div class="eyebrow">DELIVERY</div><h1>${state.config.local ? "テストメール" : "メールの送信状況"}</h1><p class="muted">${state.config.local ? "外部には送信せず、ここに保管しています。リンクと確認コードを使って動作を試せます。" : "送信待ち・失敗を確認し、お相手へのご案内を管理します。"}</p></div></div><div class="cards">${messages.map((m) => `<section class="card"><div class="row between"><span class="badge">${mailStatus(m.state)}</span><time class="small muted">${date(m.created_at)}</time></div><h3 class="gap-top">${escape(m.subject)}</h3><p class="small muted">宛先：${escape(m.recipient)}</p>${m.body ? `<pre class="small">${escape(m.body)}</pre>${m.body.match(/https?:\/\/[^\s]+\/sign#[a-f0-9]+/) ? `<a class="btn small primary" href="${escape(m.body.match(/https?:\/\/[^\s]+\/sign#[a-f0-9]+/)[0])}" target="_blank" rel="noreferrer">署名画面を試す ↗</a>` : ""}` : ""}${m.state === "failed" ? `<button class="btn small" data-retry="${m.id}">再送を試す</button>` : ""}</section>`).join("") || '<div class="empty">送信履歴はありません。</div>'}</div>`,
  );
  bind("[data-retry]", "click", async (_, el) => {
    await api("/admin/outbox/" + el.dataset.retry + "/retry", {});
    await mailbox();
  });
}

function approvalFields(p) {
  const plan = state.config.plans.find(x => x.id === p.planId)?.name || (p.planId === "reading-only" ? "読書と対話（単独）" : "個別設定");
  return `<dl class="approval-facts"><dt>生徒</dt><dd>${escape(p.studentName)} / ${escape(p.school)} / ${escape(p.grade)}</dd><dt>保護者・送信先</dt><dd>${escape(p.partyName)}<br>${escape(p.partyEmail)}</dd><dt>プラン</dt><dd>${escape(plan)}${p.reading && p.planId !== "reading-only" ? " ＋ 読書と対話" : ""}</dd><dt>通常月額（税込）</dt><dd>${money(applicationPricing(p).monthly)}</dd><dt>開始日${p.endDate ? " ～ 終了日" : "（希望）"}</dt><dd>${escape(p.startDate)}${p.endDate ? " ～ " + escape(p.endDate) : ""}</dd></dl>`;
}
async function approvalInbox() {
  const pending = state.contracts.filter(c => c.kind === "student" && c.status === "review");
  shell(`<div class="approval-wrap"><div class="heading"><div><div class="eyebrow">入塾手続き / 最終確認</div><h1>入塾の承認</h1><p>承認待ち ${pending.length}件</p></div><button class="btn" id="approval-refresh">更新</button></div><p class="notice">契約内容を確認して承認します。保護者への署名依頼は、承認後に事務局が送ります。</p><a href="/enrollment-admin.html">入塾手続きの管理者マニュアル →</a><div class="gap-top">${pending.map(c => `<section class="card gap-top"><span class="badge review">承認待ち</span><h2>${escape(JSON.parse(c.payload).studentName)} 様</h2><p>${escape(c.party_name)} 様 / ${date(c.updated_at)}</p><button class="btn primary" data-approval="${escape(c.id)}">内容を確認する →</button>${c.created_by === state.me.email ? '<p class="small muted">ご自身が作成した契約です。別の承認担当者が確認してください。</p>' : ''}</section>`).join("") || '<section class="card"><h2>承認待ちはありません</h2><p>事務局が「社内承認を依頼」を押すと、ここに表示されます。</p></section>'}</div></div>`);
  bind("#approval-refresh", "click", () => navigate("approvals"));
  bind("[data-approval]", "click", (_, el) => mobileApproval(el.dataset.approval));
}
async function mobileApproval(id) {
  const d = await api("/admin/contracts/" + encodeURIComponent(id)), c = d.contract, p = JSON.parse(c.payload);
  if (c.kind !== "student") throw new Error("入塾契約を選んでください");
  state.page = "approvals";
  history.replaceState(null, "", "/?view=approvals&id=" + encodeURIComponent(id));
  const allowed = ["owner", "approver"].includes(state.me.role) && c.created_by !== state.me.email;
  let original = "";
  if (c.application_id) {
    const apps = await api("/admin/applications"), a = apps.find(a => a.id === c.application_id);
    if (a?.payload) original = `<details class="card gap-top"><summary>保護者の申込内容と照合する</summary>${approvalFields(JSON.parse(a.payload))}</details>`;
  }
  shell(`<div class="approval-wrap"><button class="link" id="approval-back">← 承認待ち一覧</button><div class="heading gap-top"><div><div class="eyebrow">入塾契約の最終確認</div><h1>${escape(p.studentName)} 様</h1>${badge(c.status)}</div></div><section class="card"><h2>契約条件</h2>${approvalFields(p)}<p class="notice">コーチングは月4回を全額の基準とします。初月は開始日・実施可能回数に応じて、請求書を別途送付します。</p><h3>個別合意事項</h3><p class="approval-notes">${escape(p.notes || "なし")}</p><p class="small muted">作成：${escape(state.members.find(m => m.email === c.created_by)?.name || c.created_by)}</p></section>${original}<section class="card gap-top"><h2>契約書の全文</h2><p class="small muted">下までスクロールして、契約条件と本文を確認してください。</p><div class="document approval-document">${escape(c.body)}</div></section>${c.status === "review" ? allowed ? `<section class="card gap-top"><label class="check"><input type="checkbox" id="approval-confirm">宛先・プラン・料金・期間・契約全文を確認しました。</label><label class="field gap-top" for="approval-reason">修正してほしい点（差し戻す場合）<textarea id="approval-reason" rows="3" maxlength="1000" placeholder="例：保護者に確認した開始日へ修正してください"></textarea></label><div class="approval-actions"><button class="btn" id="approval-return">差し戻す</button><button class="btn primary" id="approval-submit" disabled>この内容を承認</button></div><p class="small muted">承認後、事務局が署名依頼を送ります。</p></section>` : '<p class="notice">承認には、作成者とは別の管理責任者または承認担当のログインが必要です。</p>' : `<p class="notice">${c.status === "approved" ? "承認済みです。事務局で署名依頼を送信してください。" : "現在の状態では承認操作はできません。"}</p>`}<section class="card gap-top"><button class="btn" id="approval-copy">承認画面のリンクをコピー</button><p class="small muted">リンクを開くには管理者ログインが必要です。</p><input class="approval-url" id="approval-url" readonly aria-label="承認画面のURL" value="${escape(location.href)}"></section></div>`);
  bind("#approval-back", "click", () => navigate("approvals"));
  bind("#approval-confirm", "change", (_, el) => { $("#approval-submit").disabled = !el.checked; });
  bind("#approval-copy", "click", async () => { try { await navigator.clipboard.writeText(location.href); toast("リンクをコピーしました"); } catch { $("#approval-url").select(); toast("表示されたリンクをコピーしてください"); } });
  const act = async (action, el) => {
    const reason = $("#approval-reason").value.trim();
    if (action === "approve" && !$("#approval-confirm").checked) return;
    if (action === "return" && !reason) { toast("修正してほしい点を入力してください"); $("#approval-reason").focus(); return; }
    $("#approval-submit").disabled = true; $("#approval-return").disabled = true;
    try {
      await api(`/admin/contracts/${encodeURIComponent(id)}/action`, { action, version:c.version, reason });
      await load(); await mobileApproval(id);
      toast(action === "approve" ? "承認しました。事務局担当者への完了メールを送信待ちに登録しました。" : "事務局へ差し戻しました。");
    } catch (error) {
      $("#approval-submit").disabled = !$("#approval-confirm").checked; $("#approval-return").disabled = false;
      throw error;
    }
  };
  bind("#approval-submit", "click", (_, el) => act("approve", el));
  bind("#approval-return", "click", (_, el) => act("return", el));
}


function demoMailLinks(body) {
  return [...new Set((body || "").match(/https?:\/\/[^\s]+/g) || [])].filter(raw => {try{return new URL(raw).origin === location.origin}catch{return false}}).map(raw => {
    const url=new URL(raw), label=url.pathname==="/apply"?"保護者として申込を入力":url.pathname==="/sign"?"保護者・コーチとして署名":url.searchParams.get("view")==="approvals"?"承認画面を開く":"契約画面を開く";
    return `<a class="btn small" href="${escape(raw)}" target="_blank" rel="noreferrer">${label} ↗</a>`;
  }).join(" ");
}
async function demoGuide(){
  if(!state.config.demo) return navigate("dashboard");
  const cases = state.contracts.filter(c => !c.title.startsWith("検証済み") || c.status === "signed").sort((a,b)=>a.title.localeCompare(b.title,"ja",{numeric:true}));
  const caseIds = new Set(cases.map(c => c.id));
  const mail=(await api("/admin/outbox")).filter(m => m.contract_id ? caseIds.has(m.contract_id) : !/^demo(08|10|12)@/.test(m.recipient));
  shell(`<div class="heading"><div><div class="eyebrow">DEMO / 事務局確認用</div><h1>契約フローを試す</h1><p>本番と分離した架空データです。メールはこの画面内で確認します。</p></div></div><section class="card"><h2>1. 操作する役割を選ぶ</h2><p>現在：${escape(roleNames[state.me.role])}。作成した人とは別の役割で承認してください。</p><div class="row">${[["editor","事務局（作成・送信）"],["approver","ユウキ先生役（承認）"],["owner","管理責任者"],["viewer","閲覧のみ"]].map(([id,label])=>`<button class="btn" data-demo-role="${id}">${label}</button>`).join("")}</div></section><section class="card gap-top"><h2>2. 確認するケースを選ぶ</h2><p>申込から試す場合はデモ01、途中から試す場合はデモ02以降を開いてください。</p><div class="demo-case"><h3>デモ01｜生徒｜申込から試す</h3><p>別タブで保護者の申込シートを開きます。確認コードは下のテストメールで確認できます。</p>${demoMailLinks(mail.find(m=>m.recipient==="demo01@example.test"&&m.subject.includes("入塾申込シート"))?.body)}</div>${cases.map(c=>`<div class="demo-case"><h3>${escape(c.title)}</h3><p>${badge(c.status)}　${escape(c.party_name)}</p><button class="btn small" data-open="${escape(c.id)}">契約を開く</button>${c.kind==="student"&&c.status==="review"?` <a class="btn small" href="/?view=approvals&id=${encodeURIComponent(c.id)}">スマホ用承認画面</a>`:""}</div>`).join("")}</section><section class="card gap-top"><h2>3. テストメールを開く</h2><p>申込・署名は別タブで開きます。「確認コードを送る」を押したら、この画面の「更新」で6桁コードを確認してください。</p><button class="btn" id="demo-refresh">更新</button>${mail.map(m=>`<details class="gap-top"><summary>${escape(m.subject)} ／ ${escape(m.recipient)}</summary><pre class="small demo-body">${escape(m.body||"本文なし")}</pre>${demoMailLinks(m.body)}</details>`).join("")}</section><section class="card gap-top"><h2>確認ポイント</h2><ol><li>生徒：申込 → 契約作成 → 承認メール → 承認 → 完了メール → 署名依頼 → 保護者の署名</li><li>コーチ：契約作成 → 別担当者の承認 → 署名依頼 → コーチの署名</li><li>修正：差し戻し理由が伝わるか。作り直した契約と旧契約を区別できるか。</li><li>再送：最新のメールで署名でき、古いリンクは無効になるか。</li><li>完了：契約PDF・合意記録を保存できるか。</li></ol></section>`);
  bind("[data-demo-role]","click",async(_,el)=>buttonBusy(el,async()=>{await api("/dev/login",{email:el.dataset.demoRole+"@example.test"});state.me=await api("/admin/me");await navigate("demo");toast(roleNames[state.me.role]+"に切り替えました");}));
  bind("#demo-refresh","click",()=>navigate("demo"));
}

async function login() {
  state.config = await api("/config");
  if (state.config.demoLocked) {
    $("#app").innerHTML = `<div class="login"><div class="logo">bridge★</div><h1>契約フローのデモ</h1><p>共有された確認用コードを入力してください。</p><form id="demo-unlock"><label>確認用コード<input name="code" type="password" required autocomplete="off"></label><button class="btn primary">デモを開く</button></form><p class="small muted">架空のデータで試す専用環境です。実際のメール送信・請求は行いません。</p></div>`;
    bind("#demo-unlock", "submit", async (event, form) => {event.preventDefault(); await buttonBusy($("button",form),async()=>{await api("/demo/unlock",{code:new FormData(form).get("code")});location.reload();});});
    return;
  }
  try {
    state.me = await api("/admin/me");
    if (new URLSearchParams(location.search).get("contract")) {
      await load();
      state.page = "contracts";
      await detail(new URLSearchParams(location.search).get("contract"));
    } else if (new URLSearchParams(location.search).get("view") === "approvals") {
      state.page = "approvals";
      await load();
      const id = new URLSearchParams(location.search).get("id");
      if (id) await mobileApproval(id); else await approvalInbox();
    } else await navigate(state.config.demo ? "demo" : "dashboard");
  } catch {
    $("#app").innerHTML =
      `<div class="login"><div class="logo">bridge★</div><div class="eyebrow">CONTRACT WORKSPACE</div><h1>大切な約束を、<br>ひとつの場所に。</h1><p class="muted gap-top">中高一貫ブリッジスター<br>チームの契約管理</p>${
        state.config.local
          ? `<div class="notice">テスト環境です。実在の方へのメールは送信しません。</div>${[
              ["owner@example.test", "管理責任者として試す"],
              ["approver@example.test", "承認担当として試す"],
              ["editor@example.test", "作成担当として試す"],
              ["viewer@example.test", "閲覧担当として試す"],
            ]
              .map(
                ([v, l]) =>
                  `<button class="btn ${v.startsWith("owner") ? "primary" : ""}" data-login="${v}">${l} →</button>`,
              )
              .join("")}`
          : state.config.authMode === "email"
            ? '<form id="admin-email"><label>管理者メールアドレス<input name="email" type="email" autocomplete="email" required placeholder="メールアドレスを入力"></label><button class="btn primary" type="submit">確認コードを受け取る →</button><p class="small muted">登録された担当者のみログインできます。</p></form><form id="admin-code" hidden><p class="notice">メールに届いた8桁の確認コードを入力してください。有効期限は10分です。</p><label>確認コード<input name="code" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{8}" minlength="8" maxlength="8" required></label><button class="btn primary" type="submit">ログイン →</button><button class="btn" type="button" id="login-back">メールアドレスを変更・再送</button></form>'
            : '<div class="notice">管理者ログインが必要です。Cloudflare Accessの設定とアカウント登録をご確認ください。</div><a class="btn primary" href="/cdn-cgi/access/login">管理者ログインへ</a>'
      }</div>`;
    let adminChallenge = "";
    bind("#admin-email", "submit", async (event, form) => {
      event.preventDefault();
      const result = await api("/auth/request", {
        email: new FormData(form).get("email"),
      });
      adminChallenge = result.challenge;
      form.hidden = true;
      $("#admin-code").hidden = false;
      $("#admin-code input").focus();
    });
    bind("#admin-code", "submit", async (event, form) => {
      event.preventDefault();
      await api("/auth/verify", {
        challenge: adminChallenge,
        code: new FormData(form).get("code"),
      });
      await login();
    });
    bind("#login-back", "click", () => {
      $("#admin-code").hidden = true;
      $("#admin-email").hidden = false;
    });
    bind("[data-login]", "click", async (_, el) => {
      await api("/dev/login", { email: el.dataset.login });
      await login();
    });
  }
}
function signShell(content, step = 1) {
  $("#toast").style.display = "none";
  $("#app").innerHTML =
    `<main class="sign-shell"><header class="sign-header"><span class="logo">bridge★</span><span class="small muted">中高一貫ブリッジスター</span></header><div class="progress">${["1 メール確認", "2 契約内容", "3 署名・完了"].map((t, i) => `<span class="${step === i + 1 ? "active" : ""}">${t}</span>`).join("")}</div>${content}<footer class="sign-footer">株式会社ThreeStars<br>契約内容の修正や紙での受け取りは、担当事務局へお申し出ください。</footer></main>`;
}
let challenge = "",
  signContract;
async function startSign() {
  state.config = await api("/config");
  const raw = location.hash.slice(1);
  if (raw) {
    history.replaceState(null, "", "/sign");
    try {
      await api("/sign/exchange", { token: raw });
    } catch (e) {
      signShell(
        `<section class="sign-card"><h1>リンクを確認できませんでした</h1><p class="gap-top">${escape(e.message)}</p></section>`,
      );
      return;
    }
  }
  try {
    await showSign();
  } catch {
    verifyScreen();
  }
}
function verifyScreen() {
  signShell(
    `<section class="sign-card"><div class="eyebrow">WELCOME</div><h1>メールアドレスを確認します</h1><p class="muted gap-top">契約のご案内が届いたメールアドレスに、6桁の確認コードを送ります。</p><button class="btn primary gap-top" id="send-code">確認コードを送る</button><div id="code-form-area"></div>${state.config.local ? '<div class="notice">テスト用コードは、管理画面の「送信状況」で確認できます。</div>' : ""}</section>`,
  );
  bind("#send-code", "click", (_, el) =>
    buttonBusy(el, async () => {
      const res = await api("/sign/code", {});
      challenge = res.challengeId;
      $("#code-form-area").innerHTML =
        '<form id="verify-form" class="gap-top"><div class="field"><label for="code">6桁の確認コード</label><input id="code" class="code-input" inputmode="numeric" autocomplete="one-time-code" pattern="[0-9]{6}" minlength="6" maxlength="6" required></div><button class="btn primary">確認して進む →</button></form>';
      $("#code").focus();
      el.textContent = "確認コードを再送する";
      bind("#verify-form", "submit", async (e) => {
        e.preventDefault();
        await api("/sign/verify", {
          challengeId: challenge,
          code: $("#code").value,
        });
        await showSign();
      });
      toast("確認コードをご確認ください");
    }),
  );
}
async function showSign() {
  signContract = await api("/sign/contract");
  const c = signContract;
  if (c.status === "signed") {
    signShell(
      `<section class="sign-card"><div class="success-mark">✓</div><h1>ご署名ありがとうございます。</h1><p class="muted gap-top">${escape(c.partyName)} 様の同意を記録しました。<br>契約書と合意記録を、お手元に保存してください。</p><div class="summary"><strong>${escape(c.title)}</strong><p class="small">署名日時：${date(c.signedAt)}<br>契約番号：${escape(c.id)}</p></div><div class="row"><a class="btn primary" href="/api/sign/pdf">契約PDFを保存 ↓</a><a class="btn" href="/api/sign/receipt">合意記録PDFを保存 ↓</a><a class="btn" href="/api/sign/evidence">詳細記録を保存 ↓</a></div><p class="small muted gap-top">この画面はリンクの有効期限内に再度ご利用いただけます。</p></section>`,
      3,
    );
    return;
  }
  if (!c.consent) {
    signShell(
      `<section class="sign-card"><div class="eyebrow">BEFORE YOU BEGIN</div><h1>契約書の受け取り方法</h1><p class="gap-top">契約書をPDF形式でお渡しします。スマートフォンやパソコンで開き、保存・印刷していただけます。</p><p class="muted small">紙での受け取りも選べます。電子交付を希望しない場合は、下の「紙での受け取りを相談」から事務局へお知らせください。</p><form id="consent-form"><label class="check"><input type="checkbox" required>電子データ（PDF）で契約書を受け取ることを希望します。</label><label class="check"><input type="checkbox" required>この端末でPDFを閲覧・保存でき、必要に応じて印刷できることを確認しました。</label><label class="check"><input type="checkbox" required>紙での受け取りも選べることを確認しました。</label><button class="btn primary gap-top">同意して契約内容へ →</button></form><button class="btn ghost gap-top" id="paper">紙での受け取りを相談</button></section>`,
      2,
    );
    bind("#consent-form", "submit", async (e) => {
      e.preventDefault();
      await api("/sign/consent", {
        electronic: true,
        canSave: true,
        paperOption: true,
      });
      await showSign();
    });
    bind("#paper", "click", async () => {
      await api("/sign/decline", {
        reason:
          "紙での契約書交付を希望します。事務局からの連絡をお願いします。",
      });
      signShell(
        '<section class="sign-card"><h1>ご希望を受け付けました</h1><p>事務局で内容を確認いたします。</p></section>',
        2,
      );
    });
    return;
  }
  signShell(
    `<section class="sign-card"><div class="eyebrow">REVIEW YOUR CONTRACT</div><h1>${escape(c.title)}</h1><p class="muted">${escape(c.partyName)} 様 / 署名期限 ${date(c.expiresAt)}</p><div class="document gap-top" tabindex="0">${escape(c.body)}</div><div class="summary"><h3>まず、契約書をお手元に保存してください。</h3><p class="small">PDFを開き、内容を確認したうえで保存してください。</p><a class="btn primary" id="download-pdf" href="/api/sign/pdf">契約PDFを保存 ↓</a></div><form id="sign-form"><div class="field"><label for="signature">${c.kind === "student" ? "保護者氏名（ご本人の氏名）" : "ご本人の氏名"}</label><input class="sign-name" id="signature" autocomplete="name" maxlength="100" required placeholder="${escape(c.partyName)}"></div><label class="check"><input type="checkbox" required>契約書の全文と選択した条件を確認し、その内容に同意します。</label><label class="check"><input type="checkbox" required>契約PDFを自分の端末に保存し、開けることを確認しました。</label><label class="check"><input type="checkbox" required>${c.kind === "student" ? "私は保護者として、この契約を締結する権限があります。" : "私は契約者本人であり、この契約を締結する権限があります。"}</label><button class="btn primary gap-top" type="submit">上記に同意して署名する</button></form><button class="btn ghost gap-top" id="decline">内容の修正を依頼する</button><p class="small muted gap-top">この操作で同意の氏名・日時を記録し、契約内容への承諾を確定します。</p></section>`,
    3,
  );
  bind("#sign-form", "submit", async (e) => {
    e.preventDefault();
    const btn = $("#sign-form button");
    await buttonBusy(btn, async () => {
      await api("/sign/sign", {
        name: $("#signature").value,
        contentHash: c.contentHash,
        agree: true,
        saved: true,
        authority: true,
      });
      await showSign();
    });
  });
  bind("#decline", "click", async () => {
    const reason = await ask(
      "修正してほしい内容を事務局へお知らせください。",
      "内容の修正",
    );
    if (!reason) return;
    await api("/sign/decline", { reason });
    signShell(
      '<section class="sign-card"><h1>修正のご依頼を受け付けました。</h1><p>この契約への署名は行われていません。事務局で内容を確認いたします。</p></section>',
      2,
    );
  });
}
function applicationPricing(p) {
  const net =
      (p.planId === "reading-only"
        ? 14800
        : p.planId === "custom"
          ? Number(p.customNet || 0)
          : state.config.plans.find((x) => x.id === p.planId)?.net || 0) +
      (p.reading && p.planId !== "reading-only" ? 10000 : 0),
    monthly = Math.round(net * 1.1);
  return {
    monthly,
    first: null,
  };
}
function applicationSummary(p) {
  const price = applicationPricing(p),
    plan =
      state.config.plans.find((x) => x.id === p.planId)?.name ||
      "読書と対話（単独）";
  return `<div class="summary"><h3>${escape(p.studentName)} 様の申込内容</h3><p>プラン：${escape(plan)}${p.reading && p.planId !== "reading-only" ? " ＋ 読書と対話" : ""}<br>開始希望日：${escape(p.startDate)}<br>月額（税込）：${money(price.monthly)}<br>初月の請求額は、開始日・実施可能回数を確認し、別途請求書でご案内します。</p><p class="small">学校：${escape(p.school)} ／ ${escape(p.grade)}<br>生徒フリガナ：${escape(p.studentKana)} ／ 生年月日：${escape(p.studentBirthDate || "未記入")}<br>生徒メール：${escape(p.studentEmail || "未記入")}<br>生徒携帯：${escape(p.studentPhone || "未記入")}<br>生徒住所：${escape(p.studentAddress)}<br>保護者：${escape(p.partyName)}（${escape(p.guardianKana)}）<br>生年月日：${escape(p.guardianBirthDate || "未記入")}<br>メール：${escape(p.partyEmail)}<br>電話：${escape(p.phone)}<br>住所：${escape(p.address)}</p></div>`;
}
async function applicationsPage() {
  const rows = await api("/admin/applications");
  const labels = {
    requested: "入力待ち",
    submitted: "事務局の確認待ち",
    converted: "契約書を作成済み",
    revoked: "取消済み",
  };
  shell(
    `<div class="heading"><div><div class="eyebrow">ENROLLMENT</div><h1>入塾申込</h1><p class="muted">保護者が条件を選択し、事務局が確認して契約書にします。</p></div><a class="btn" href="/manual#applications">使い方</a></div>${state.me.role !== "viewer" ? `<form id="application-invite" class="card"><h2>保護者に申込シートを案内する</h2><div class="fields">${field("name", "保護者氏名", "text", "", 'required maxlength="100"')}${field("email", "保護者のメールアドレス", "email", "", "required")}</div><p class="small muted">この宛先へ7日間有効の入力リンクをメールで送ります。</p><button class="btn primary">申込シートの案内を送る</button></form>` : ""}<div class="cards gap-top">${rows.map((a) => `<section class="card"><span class="tag">${labels[a.status]}${a.status === "requested" && a.expires_at < new Date().toISOString() ? "・期限切れ" : ""}</span><h2>${escape(a.party_name)} 様</h2><p class="small muted">${escape(a.party_email)}<br>案内：${date(a.created_at)}</p>${a.payload ? applicationSummary(JSON.parse(a.payload)) : ""}<div class="row">${a.status === "submitted" && state.me.role !== "viewer" ? `<button class="btn primary" data-convert="${a.id}">確認して契約書を作成 →</button>` : ""}${a.contract_id ? `<button class="btn" data-application-contract="${a.contract_id}">契約書を見る</button>` : ""}${["requested", "submitted"].includes(a.status) && state.me.role !== "viewer" ? `<button class="btn" data-application-revoke="${a.id}">案内・申込を取り消す</button>` : ""}</div></section>`).join("") || '<div class="empty">申込の案内はまだありません。</div>'}</div>`,
  );
  bind("#application-invite", "submit", (e, f) => {
    e.preventDefault();
    return buttonBusy(f.querySelector("button"), async () => {
      await api("/admin/applications", Object.fromEntries(new FormData(f)));
      await applicationsPage();
      toast("申込シートの案内を送信待ちに登録しました");
    });
  });
  bind("[data-convert]", "click", (_, el) => {
    const a = rows.find((a) => a.id === el.dataset.convert);
    wizard(2, {
      ...JSON.parse(a.payload),
      kind: "student",
      applicationId: a.id,
      title: "入塾・受講契約",
      assignedTo: state.me.email,
    });
  });
  bind("[data-application-contract]", "click", (_, el) =>
    detail(el.dataset.applicationContract),
  );
  bind("[data-application-revoke]", "click", async (_, el) => {
    if (
      !(await ask(
        "取り消す理由を入力してください。この申込リンクは使えなくなります。",
        "申込の取消",
      ))
    )
      return;
    await api(
      "/admin/applications/" + el.dataset.applicationRevoke + "/revoke",
      {},
    );
    await applicationsPage();
  });
}
function applyShell(content, step = 1) {
  $("#app").innerHTML =
    `<main class="sign-shell"><header class="sign-header"><span class="logo">bridge★</span><a class="small" href="/manual#parent">入力の使い方</a></header><div class="progress">${["1 メール確認", "2 申込シート", "3 送信・完了"].map((v, i) => `<span class="${step === i + 1 ? "active" : ""}">${v}</span>`).join("")}</div>${content}<footer class="sign-footer">中高一貫ブリッジスター / 株式会社ThreeStars<br>この入力だけでは契約は成立しません。確定内容は署名依頼でご案内します。</footer></main>`;
}
async function startApply() {
  state.config = await api("/config");
  const raw = location.hash.slice(1);
  if (raw) {
    history.replaceState(null, "", "/apply");
    await api("/apply/exchange", { token: raw });
  }
  try {
    await showApplication();
  } catch (e) {
    applyShell(
      `<section class="sign-card"><h1>申込シートを開きます</h1><p class="gap-top">ご案内が届いたメールアドレスへ確認コードを送ります。</p><button class="btn primary" id="apply-code">確認コードを送る</button><div id="apply-code-area"></div></section>`,
    );
    bind("#apply-code", "click", (_, button) =>
      buttonBusy(button, async () => {
        const r = await api("/apply/code", {});
        $("#apply-code-area").innerHTML =
          `<form id="apply-verify" class="gap-top">${field("applyOtp", "6桁の確認コード", "text", "", 'required pattern="[0-9]{6}" maxlength="6" inputmode="numeric" autocomplete="one-time-code"')}<button class="btn primary">確認して進む →</button></form>`;
        bind("#apply-verify", "submit", async (e) => {
          e.preventDefault();
          await api("/apply/verify", {
            challengeId: r.challengeId,
            code: $("#applyOtp").value,
          });
          await showApplication();
        });
        toast("確認コードをご確認ください");
      }),
    );
  }
}
let applicationDraft;
async function showApplication() {
  const a = await api("/apply/form");
  if (a.status !== "requested") {
    applyShell(
      `<section class="sign-card"><div class="success-mark">✓</div><h1>申込内容を受け付けました</h1><p class="gap-top">事務局が確認し、契約書の署名依頼を改めてお送りします。変更をご希望の場合は事務局へご連絡ください。</p>${a.payload ? applicationSummary(a.payload) : ""}<p class="notice">まだ契約への署名は完了していません。</p></section>`,
      3,
    );
    return;
  }
  applicationDraft = applicationDraft || {
    partyName: a.name,
    partyEmail: a.email,
    planId: "starter",
    reading: false,
    startDate: "",
  };
  renderApplicationForm();
}
function renderApplicationForm() {
  const p = applicationDraft;
  applyShell(
    `<form id="apply-form" class="sign-card"><div class="eyebrow">ENROLLMENT SHEET</div><h1>入塾申込シート</h1><p class="muted gap-top">希望するプランと開始日を選んでください。送信前に内容を確認できます。</p><h2 class="gap-top">1. 生徒情報</h2><div class="fields">${field("studentName", "生徒氏名", "text", p.studentName, 'required maxlength="100"')}${field("studentKana", "生徒フリガナ", "text", p.studentKana, 'required maxlength="100"')}${field("school", "在籍学校", "text", p.school, 'required maxlength="100"')}${select(
      "grade",
      "学年",
      ["中1", "中2", "中3", "高1", "高2", "高3", "その他"].map((v) => ({
        value: v,
        label: v,
      })),
      p.grade,
    )}${field("studentBirthDate", "生徒の生年月日（任意）", "date", p.studentBirthDate)}${field("studentEmail", "生徒のメールアドレス", "email", p.studentEmail, 'required maxlength="254"')}${field("studentPhone", "生徒の携帯番号（任意）", "tel", p.studentPhone, 'maxlength="25"')}${field("studentAddress", "生徒の住所・建物名・部屋番号", "text", p.studentAddress, 'required maxlength="180"')}</div><h2 class="gap-top">2. 保護者情報</h2><div class="fields">${field("partyName", "保護者氏名", "text", p.partyName, 'required maxlength="100"')}${field("guardianKana", "保護者フリガナ", "text", p.guardianKana, 'required maxlength="100"')}${field("guardianBirthDate", "保護者の生年月日（任意）", "date", p.guardianBirthDate)}${field("phone", "保護者の携帯番号", "tel", p.phone, 'required pattern="[0-9+() \\-]{8,25}"')}${field("partyEmail", "保護者メール（確認済み）", "email", p.partyEmail, "readonly")}${field("address", "保護者の住所", "text", p.address, 'required maxlength="180"')}</div><button type="button" class="btn small" id="same-address">生徒の住所をコピー</button><h2 class="gap-top">3. プラン・開始希望日</h2><div class="fields">${select("planId", "希望するプラン（税別）", [...state.config.plans.map((v) => ({ value: v.id, label: `${v.name} / ${money(v.net)}・月` })), { value: "reading-only", label: "読書と対話のみ / 14,800円・月" }], p.planId)}${field("startDate", "サービス提供開始希望日", "date", p.startDate, "required")}</div><label class="check"><input type="checkbox" name="reading" ${p.reading ? "checked" : ""}>読書と対話を追加（セット月額10,000円・税別）</label><div id="apply-price" class="summary"></div><p class="small muted">通常月はコーチング4回を全額の基準とします。初月は開始日と実施できる回数に応じて変動し、別途請求書でご案内します。個別プランをご希望の場合は事務局へご相談ください。</p><details class="gap-top"><summary>個人情報の取り扱い</summary><p class="small">株式会社ThreeStarsは、入力情報を申込確認、契約準備、受講に必要な指導・連絡・成績管理のために利用します。生年月日と生徒携帯番号は任意です。入力を希望しない場合は事務局へご相談ください。</p></details><label class="check"><input name="privacy" type="checkbox" required ${p.privacy ? "checked" : ""}>個人情報の取り扱いを確認しました。</label><label class="check"><input name="notContract" type="checkbox" required ${p.notContract ? "checked" : ""}>入力内容は事務局で確認され、契約書への署名は後日行うことを確認しました。</label><button class="btn primary gap-top">入力内容を確認 →</button></form>`,
    2,
  );
  const read = () => {
    const f = new FormData($("#apply-form"));
    applicationDraft = {
      ...Object.fromEntries(f),
      kind: "student",
      reading: f.has("reading"),
      privacy: f.has("privacy"),
      notContract: f.has("notContract"),
    };
    if (applicationDraft.planId === "reading-only")
      applicationDraft.reading = false;
    return applicationDraft;
  };
  const pricing = () => {
    const p = read(),
      a = applicationPricing(p);
    const box = $('[name="reading"]');
    box.disabled = p.planId === "reading-only";
    if (box.disabled) box.checked = false;
    $("#apply-price").textContent =
      `月額（税込） ${money(a.monthly)} ／ 初月は別途請求書でご案内`;
  };
  bind("#apply-form", "change", pricing);
  pricing();
  bind("#same-address", "click", () => {
    $("#address").value = $("#studentAddress").value;
  });
  bind("#apply-form", "submit", (e) => {
    e.preventDefault();
    read();
    applyShell(
      `<section class="sign-card"><h1>申込内容をご確認ください</h1>${applicationSummary(applicationDraft)}<p class="notice">この送信は申込内容の提出です。契約の署名は、事務局の確認後に改めて行います。</p><div class="row"><button class="btn" id="apply-back">修正する</button><button class="btn primary" id="apply-submit">この内容を事務局へ送る</button></div></section>`,
      3,
    );
    bind("#apply-back", "click", renderApplicationForm);
    bind("#apply-submit", "click", (_, b) =>
      buttonBusy(b, async () => {
        await api("/apply/submit", applicationDraft);
        await showApplication();
      }),
    );
  });
}

const noticeDate = (v) =>
  v
    ? new Date(v).toLocaleString("ja-JP", {
        timeZone: "Asia/Tokyo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }) + "（日本時間）"
    : "—";
const changeLabels = {
  requested: "入力待ち",
  submitted: "受付済み",
  reviewing: "事務局確認中",
  completed: "処理完了",
  returned: "再提出のご案内",
  revoked: "案内取消済み",
};
let changeConfig, changeDraft;
async function getChangeConfig() {
  return (changeConfig ||= await api("/changes/config"));
}
function changeSummary(p) {
  const form = changeConfig.forms.find((f) => f.id === p.formId);
  return `<h2>${escape(p.formName || form.name)}</h2><dl class="summary">${[
    ...changeConfig.common,
    ...form.fields,
  ]
    .filter((f) => p.values[f.key])
    .map(
      (f) => `<dt>${escape(f.label)}</dt><dd>${escape(p.values[f.key])}</dd>`,
    )
    .join(
      "",
    )}<dt>メール（確認済み）</dt><dd>${escape(p.email)}</dd><dt>保護者の確認氏名</dt><dd>${escape(p.guardianSignature)}</dd><dt>塾生の確認氏名</dt><dd>${escape(p.studentSignature)}</dd></dl><p class="notice">${escape(p.notice || form.notice)}</p>`;
}
async function changesPage() {
  await getChangeConfig();
  const rows = await api("/admin/changes");
  const can = state.me.role !== "viewer";
  shell(
    `<div class="heading"><div><div class="eyebrow">STUDENT NOTICES</div><h1>諸変更届</h1><p class="muted">保護者の提出内容を確認し、対応の結果を記録します。</p></div><a class="btn" href="/manual#changes">使い方</a></div>${can ? `<form class="card" id="change-invite"><h2>保護者へ入力リンクを送る</h2><div class="fields">${field("name", "保護者氏名", "text", "", 'required maxlength="100"')}${field("email", "確認済みの保護者メールアドレス", "email", "", "required")}</div><p class="small muted">8種類の届出から選べるリンクを送ります。有効期限は7日間です。提出済みの届出は書き換えず、修正は新しい案内で受け付けます。</p><button class="btn primary">届出の案内をメールで送る</button></form>` : ""}<div class="fields gap-top">${select("change-filter", "状態で絞り込む", [{ value: "all", label: "すべて" }, ...Object.entries(changeLabels).map(([value, label]) => ({ value, label }))])}${field("change-search", "氏名・メール・届出の種類を検索", "search")}</div><div class="cards gap-top" id="change-list"></div>`,
  );
  const render = () => {
    const query = $("#change-search").value.toLowerCase(),
      status = $("#change-filter").value;
    const found = rows.filter(
      (a) =>
        (status === "all" || a.status === status) &&
        `${a.party_name} ${a.party_email} ${a.payload ? JSON.parse(a.payload).formName : ""}`
          .toLowerCase()
          .includes(query),
    );
    $("#change-list").innerHTML =
      found
        .map(
          (a) =>
            `<section class="card"><span class="tag">${changeLabels[a.status]}${a.status === "requested" && a.expires_at < new Date().toISOString() ? "・期限切れ" : ""}</span><h2>${escape(a.party_name)} 様</h2><p class="small muted">${escape(a.party_email)}<br>案内：${date(a.created_at)} / 受付：${noticeDate(a.submitted_at)}</p>${a.payload ? `<details><summary>${escape(JSON.parse(a.payload).formName)}の提出内容を見る</summary>${changeSummary(JSON.parse(a.payload))}</details>` : ""}${a.review_note ? `<p class="notice">${escape(a.review_note)}<br>適用日：${escape(a.effective_date || "未設定")}<br>担当：${escape(a.reviewed_by)} / ${date(a.reviewed_at)}</p>` : ""}<div class="row gap-top">${can && ["submitted", "reviewing"].includes(a.status) ? `<button class="btn primary" data-change-review="${a.id}">確認・処理結果を記録</button>` : ""}${a.payload ? `<button class="btn" data-change-history="${a.id}">処理履歴</button>` : ""}${can && a.status === "requested" ? `<button class="btn" data-change-revoke="${a.id}">案内取消</button>` : ""}</div></section>`,
        )
        .join("") || '<div class="empty">該当する届出はありません。</div>';
    bind("[data-change-review]", "click", (_, el) =>
      reviewNotice(rows.find((a) => a.id === el.dataset.changeReview)),
    );
    bind("[data-change-history]", "click", async (_, el) => {
      const h = await api(
        "/admin/changes/" + el.dataset.changeHistory + "/history",
      );
      $("#dialog").innerHTML =
        `<h2>処理履歴</h2>${h.map((e) => `<p><strong>${escape(changeLabels[e.action])}</strong> / ${date(e.at)}<br>${escape(e.actor)}<br>${escape(JSON.parse(e.detail).note)}</p>`).join("") || "<p>処理記録はまだありません。提出日時は届出に保存されています。</p>"}<form method="dialog"><button class="btn">閉じる</button></form>`;
      $("#dialog").showModal();
    });
    bind("[data-change-revoke]", "click", async (_, el) => {
      await api("/admin/changes/" + el.dataset.changeRevoke + "/revoke", {});
      await changesPage();
    });
  };
  bind("#change-search", "input", render);
  bind("#change-filter", "change", render);
  render();
  bind("#change-invite", "submit", async (e) => {
    e.preventDefault();
    await buttonBusy($("#change-invite button"), async () => {
      await api("/admin/changes", Object.fromEntries(new FormData(e.target)));
      toast("案内メールを送信待ちに登録しました");
      await changesPage();
    });
  });
}
function reviewNotice(a) {
  $("#dialog").innerHTML =
    `<h2>事務局の確認結果</h2><p>登録情報の更新・決済手続き・必要な変更契約を確認してから、処理完了にしてください。メール連絡は別途行ってください。</p><form id="change-review">${select(
      "noticeStatus",
      "状態",
      ["reviewing", "completed", "returned"].map((value) => ({
        value,
        label: changeLabels[value],
      })),
      "reviewing",
    )}${field("effectiveDate", "確認した適用日・退会日（プラン変更・退会の完了時は必須）", "date", a.effective_date || "")}<div class="field"><label for="reviewNote">対応内容・保護者へのご案内（保護者にも表示）</label><textarea id="reviewNote" required maxlength="2000">${escape(a.review_note || "")}</textarea></div><p class="small muted">再提出が必要な場合、元の記録を保存したまま新しい入力リンクを送ってください。</p><div class="row"><button class="btn primary">処理結果を保存</button><button class="btn" type="button" id="close-notice">閉じる</button></div></form>`;
  $("#dialog").showModal();
  bind("#close-notice", "click", () => $("#dialog").close());
  bind("#change-review", "submit", async (e) => {
    e.preventDefault();
    await buttonBusy($("#change-review button"), async () => {
      await api("/admin/changes/" + a.id + "/review", {
        status: $("#noticeStatus").value,
        note: $("#reviewNote").value,
        effectiveDate: $("#effectiveDate").value,
        expectedStatus: a.status,
        expectedReviewedAt: a.reviewed_at,
      });
      $("#dialog").close();
      await changesPage();
    });
  });
}
function changeShell(content, step = 1) {
  $("#app").innerHTML =
    `<main class="sign-shell"><header class="sign-header"><span class="logo">bridge★</span><a href="/manual#changes">届出の使い方</a></header><div class="progress">${["1 メール確認", "2 届出を入力", "3 確認・提出"].map((v, i) => `<span class="${step === i + 1 ? "active" : ""}">${v}</span>`).join("")}</div>${content}<footer class="sign-footer">中高一貫ブリッジスター / 株式会社ThreeStars</footer></main>`;
}
async function startChanges() {
  await getChangeConfig();
  const raw = location.hash.slice(1);
  if (raw) {
    history.replaceState(null, "", "/changes");
    await api("/changes/exchange", { token: raw });
  }
  try {
    await showChangeForm();
  } catch (e) {
    changeShell(
      `<section class="sign-card"><h1>諸変更届を開きます</h1><p class="gap-top">ご案内先のメールへ確認コードを送ります。以前のメールが使えない場合は事務局にご連絡ください。</p><button class="btn primary" id="change-code">確認コードを送る</button><div id="change-verify-area"></div></section>`,
    );
    bind("#change-code", "click", (_, b) =>
      buttonBusy(b, async () => {
        const c = await api("/changes/code", {});
        $("#change-verify-area").innerHTML =
          `<form id="change-verify" class="gap-top">${field("changeOtp", "6桁の確認コード", "text", "", 'required pattern="[0-9]{6}" maxlength="6" inputmode="numeric" autocomplete="one-time-code"')}<button class="btn primary">確認して進む</button></form>`;
        bind("#change-verify", "submit", async (e) => {
          e.preventDefault();
          await api("/changes/verify", {
            challengeId: c.challengeId,
            code: $("#changeOtp").value,
          });
          await showChangeForm();
        });
        toast("確認コードを送信しました");
      }),
    );
  }
}
async function showChangeForm() {
  const a = await api("/changes/form");
  if (a.status !== "requested") {
    changeShell(
      `<section class="sign-card"><div class="success-mark">✓</div><h1>${escape(changeLabels[a.status])}</h1><p class="gap-top">受付番号：${escape(a.id)}<br>提出日時：${noticeDate(a.submittedAt)}</p><p>内容を確認し、事務局よりご案内します。提出内容の修正・追加は事務局へご連絡ください。</p>${a.reviewNote ? `<p class="notice">事務局からのご案内：${escape(a.reviewNote)}<br>適用日：${escape(a.effectiveDate || "事務局で確認")}</p>` : ""}${a.payload ? changeSummary(a.payload) : ""}</section>`,
      3,
    );
    return;
  }
  changeDraft ||= {
    formId: "address",
    values: { partyName: a.name },
    email: a.email,
  };
  renderChangeForm();
}
function changeInput(f) {
  const v = changeDraft.values[f.key] || "";
  if (f.type === "select")
    return select(
      f.key,
      f.label,
      [
        { value: "", label: "選択してください" },
        ...f.options.map((v) => ({ value: v, label: v })),
      ],
      v,
    );
  if (f.type === "textarea")
    return `<div class="field"><label for="${f.key}">${escape(f.label)}</label><textarea id="${f.key}" name="${f.key}" ${f.required ? "required" : ""} maxlength="2000">${escape(v)}</textarea></div>`;
  return field(
    f.key,
    f.label,
    f.type,
    v,
    `${f.required ? "required" : ""} maxlength="2000"`,
  );
}
function renderChangeForm() {
  const form = changeConfig.forms.find((f) => f.id === changeDraft.formId);
  changeShell(
    `<form class="sign-card" id="change-form"><div class="eyebrow">STUDENT NOTICE</div><h1>諸変更届</h1><p class="muted gap-top">必要な届出を選び、内容を入力してください。</p>${select(
      "formId",
      "届出の種類",
      changeConfig.forms.map((f) => ({ value: f.id, label: f.name })),
      form.id,
    )}<h2 class="gap-top">塾生・保護者情報</h2><div class="fields">${changeConfig.common.map(changeInput).join("")}${field("verifiedEmail", "メールアドレス（確認済み）", "email", changeDraft.email, "readonly")}</div><h2 class="gap-top">${escape(form.name)}の内容</h2><p class="notice">${escape(form.notice)}</p><div class="fields">${form.fields.map(changeInput).join("")}</div><h2 class="gap-top">内容の確認</h2><p class="small muted">塾生・保護者で内容を確認し、それぞれの氏名を入力してください。保護者のメール確認と氏名入力の記録を保存します。</p><div class="fields">${field("guardianSignature", "保護者の確認氏名", "text", changeDraft.guardianSignature, 'required maxlength="100"')}${field("studentSignature", "塾生の確認氏名", "text", changeDraft.studentSignature, 'required maxlength="100"')}</div><label class="check"><input name="confirmed" type="checkbox" required ${changeDraft.confirmed ? "checked" : ""}>内容に相違がなく、電子的な届出として事務局へ提出することを確認しました。</label><button class="btn primary gap-top">提出前に内容を確認 →</button></form>`,
    2,
  );
  const read = () => {
    const fd = new FormData($("#change-form"));
    changeDraft = {
      ...changeDraft,
      formId: fd.get("formId"),
      values: Object.fromEntries(
        [...changeConfig.common, ...form.fields].map((f) => [
          f.key,
          fd.get(f.key) || "",
        ]),
      ),
      guardianSignature: fd.get("guardianSignature"),
      studentSignature: fd.get("studentSignature"),
      confirmed: fd.has("confirmed"),
    };
  };
  bind("#formId", "change", () => {
    read();
    renderChangeForm();
  });
  bind("#change-form", "submit", (e) => {
    e.preventDefault();
    read();
    changeShell(
      `<section class="sign-card"><h1>提出内容をご確認ください</h1>${changeSummary(changeDraft)}<p class="notice">この内容を電子的な届出として提出します。受付日時を記録し、事務局が適用日や必要な手続きを確認します。</p><div class="row"><button class="btn" id="change-back">修正する</button><button class="btn primary" id="change-submit">この内容で届出を提出する</button></div></section>`,
      3,
    );
    bind("#change-back", "click", renderChangeForm);
    bind("#change-submit", "click", (_, b) =>
      buttonBusy(b, async () => {
        await api("/changes/submit", changeDraft);
        await showChangeForm();
      }),
    );
  });
}

try {
  const initialConfig = await api("/config");
  if (initialConfig.demoLocked) await login();
  else if (location.pathname === "/changes") await startChanges();
  else if (location.pathname === "/apply") await startApply();
  else if (location.pathname === "/sign") await startSign();
  else await login();
} catch (e) {
  $("#app").innerHTML =
    `<div class="login"><h1>画面を開けませんでした</h1><p>${escape(e.message)}</p><a class="btn" href="/">再読み込み</a></div>`;
}
