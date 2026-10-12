export const changeForms = [
  {
    id: "withdrawal",
    name: "退会届",
    notice:
      "原書式の案内：退会希望月の前月10日（必着）までに提出。期日を過ぎた申請は翌月末での処理と記載されています。退会日・精算額は適用中の契約と提出日時に基づき事務局からご案内します。提出時点で受付を記録し、事務局の確認を待つ間も提出日は保持します。原書式では、返金は特定商取引法および入塾規約第4条第3項に基づき精算し、振込手数料は受講者様負担と記載されています。",
    fields: [
      {
        key: "month",
        label: "退会希望月（月末で退会）",
        type: "month",
        required: true,
      },
      {
        key: "reason",
        label: "退会理由",
        type: "select",
        required: true,
        options: [
          "受験終了",
          "学習方針変更",
          "費用負担",
          "通信・端末環境",
          "サービス内容",
          "講師との相性",
          "その他",
        ],
      },
      {
        key: "details",
        label: "理由の詳細（任意）",
        type: "textarea",
        required: false,
      },
      {
        key: "bank",
        label: "返金がある場合：金融機関名",
        type: "text",
        required: false,
      },
      {
        key: "branch",
        label: "支店名",
        type: "text",
        required: false,
      },
      {
        key: "accountType",
        label: "口座種別",
        type: "select",
        required: false,
        options: ["普通", "当座"],
      },
      {
        key: "accountNumber",
        label: "口座番号（返金がある場合のみ）",
        type: "text",
        required: false,
      },
      {
        key: "accountName",
        label: "口座名義（カナ）",
        type: "text",
        required: false,
      },
    ],
  },
  {
    id: "plan",
    name: "プラン変更届",
    notice:
      "原書式の案内：変更希望月の前月10日（必着）までに提出。期日を過ぎた申請は翌々月1日から適用と記載されています。実際の適用日・契約手続きは事務局が確認してご案内します。請求書は別途送付します。",
    fields: [
      {
        key: "month",
        label: "変更希望月（1日から適用）",
        type: "month",
        required: true,
      },
      {
        key: "beforePlan",
        label: "変更前プラン",
        type: "select",
        required: true,
        options: [
          "習慣プラン（税別19,800円）",
          "スタータープラン（税別29,800円）",
          "PLAN A（税別39,800円）",
          "PLAN B（税別49,800円）",
          "PLAN C（税別59,800円）",
          "PLAN D（税別69,800円）",
          "読書と対話のみ（税別14,800円）",
          "その他（詳細欄に記入）",
        ],
      },
      {
        key: "beforeOption",
        label: "変更前オプション",
        type: "select",
        required: true,
        options: ["なし", "読書と対話（セット）", "読書と対話（単独）"],
      },
      {
        key: "afterPlan",
        label: "変更後プラン",
        type: "select",
        required: true,
        options: [
          "習慣プラン（税別19,800円）",
          "スタータープラン（税別29,800円）",
          "PLAN A（税別39,800円）",
          "PLAN B（税別49,800円）",
          "PLAN C（税別59,800円）",
          "PLAN D（税別69,800円）",
          "読書と対話のみ（税別14,800円）",
          "その他（詳細欄に記入）",
        ],
      },
      {
        key: "afterOption",
        label: "変更後オプション",
        type: "select",
        required: true,
        options: ["なし・解除", "読書と対話（セット）", "読書と対話（単独）"],
      },
      {
        key: "details",
        label: "変更理由・その他プランの詳細",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "address",
    name: "住所変更届",
    notice: "変更後は速やかにご提出ください。",
    fields: [
      {
        key: "target",
        label: "変更の対象",
        type: "select",
        required: true,
        options: ["塾生", "保護者", "両方"],
      },
      {
        key: "effectiveDate",
        label: "変更日",
        type: "date",
        required: true,
      },
      {
        key: "postalCode",
        label: "新住所の郵便番号",
        type: "text",
        required: true,
      },
      {
        key: "address",
        label: "新住所（都道府県～番地）",
        type: "text",
        required: true,
      },
      {
        key: "building",
        label: "建物名・棟・部屋番号（任意）",
        type: "text",
        required: false,
      },
    ],
  },
  {
    id: "phone",
    name: "電話番号変更届",
    notice:
      "変更後は速やかにご提出ください。対象者の新しい番号を入力してください。",
    fields: [
      {
        key: "target",
        label: "変更の対象",
        type: "select",
        required: true,
        options: ["塾生", "保護者", "両方"],
      },
      {
        key: "effectiveDate",
        label: "変更日",
        type: "date",
        required: true,
      },
      {
        key: "studentPhone",
        label: "新電話番号（塾生）",
        type: "tel",
        required: false,
      },
      {
        key: "guardianPhone",
        label: "新電話番号（保護者）",
        type: "tel",
        required: false,
      },
    ],
  },
  {
    id: "email",
    name: "メールアドレス変更届",
    notice:
      "変更後は速やかにご提出ください。LINE・チャット等のID変更は別途事務局へご連絡ください。新しいメールアドレスは事務局で確認後に使用します。この届出だけでは契約書の宛先は変更されません。",
    fields: [
      {
        key: "target",
        label: "変更の対象",
        type: "select",
        required: true,
        options: ["塾生", "保護者", "両方"],
      },
      {
        key: "effectiveDate",
        label: "変更日",
        type: "date",
        required: true,
      },
      {
        key: "studentEmail",
        label: "新メールアドレス（塾生）",
        type: "email",
        required: false,
      },
      {
        key: "guardianEmail",
        label: "新メールアドレス（保護者）",
        type: "email",
        required: false,
      },
    ],
  },
  {
    id: "school",
    name: "在籍学校・学年変更届",
    notice: "進学・転校等の変更後は速やかにご提出ください。",
    fields: [
      {
        key: "effectiveDate",
        label: "変更日",
        type: "date",
        required: true,
      },
      {
        key: "beforeSchool",
        label: "変更前の学校・学年",
        type: "text",
        required: true,
      },
      {
        key: "afterSchool",
        label: "変更後の学校・学年",
        type: "text",
        required: true,
      },
    ],
  },
  {
    id: "payment",
    name: "保護者氏名・支払情報変更届",
    notice:
      "口座番号・カード番号・暗証番号は入力しないでください。支払口座・カード情報の登録は、事務局からご案内する専用の決済リンクでお手続きください。",
    fields: [
      {
        key: "item",
        label: "変更項目",
        type: "select",
        required: true,
        options: [
          "保護者氏名",
          "支払方法",
          "支払口座／カード",
          "複数項目（内容欄に記入）",
        ],
      },
      {
        key: "effectiveDate",
        label: "変更日",
        type: "date",
        required: true,
      },
      {
        key: "details",
        label: "変更内容（口座番号・カード番号は記入しない）",
        type: "textarea",
        required: true,
      },
    ],
  },
  {
    id: "other",
    name: "その他変更届",
    notice:
      "他の届出に該当しない変更・連絡をご記入ください。内容により別途手続きをご案内する場合があります。",
    fields: [
      {
        key: "effectiveDate",
        label: "変更日",
        type: "date",
        required: true,
      },
      {
        key: "details",
        label: "変更・連絡内容",
        type: "textarea",
        required: true,
      },
    ],
  },
];
export const commonChangeFields = [
  {
    key: "studentName",
    label: "塾生氏名",
    type: "text",
    required: true,
  },
  {
    key: "studentKana",
    label: "フリガナ",
    type: "text",
    required: true,
  },
  {
    key: "school",
    label: "在籍学校・学年",
    type: "text",
    required: true,
  },
  {
    key: "partyName",
    label: "保護者氏名",
    type: "text",
    required: true,
  },
  {
    key: "phone",
    label: "連絡先の電話番号",
    type: "tel",
    required: true,
  },
];
