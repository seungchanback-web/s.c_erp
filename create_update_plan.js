const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat,
        HeadingLevel, BorderStyle, WidthType, ShadingType,
        PageNumber, PageBreak, TabStopType, TabStopPosition } = require('docx');

// A4 size
const PAGE_W = 11906;
const PAGE_H = 16838;
const MARGIN = { top: 1200, right: 1200, bottom: 1200, left: 1200 };
const CONTENT_W = PAGE_W - MARGIN.left - MARGIN.right; // 9506

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const borderNone = { style: BorderStyle.NONE, size: 0 };
const bordersNone = { top: borderNone, bottom: borderNone, left: borderNone, right: borderNone };

const BLUE = "1B5E96";
const LIGHT_BLUE = "E8F4FD";
const GREEN = "059669";
const ORANGE = "D97706";
const GRAY = "64748B";
const LIGHT_GRAY = "F8FAFC";

function hCell(text, width, opts = {}) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: { fill: opts.fill || BLUE, type: ShadingType.CLEAR },
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: "center",
    children: [new Paragraph({ alignment: opts.align || AlignmentType.CENTER,
      children: [new TextRun({ text, bold: true, font: "Malgun Gothic", size: 18, color: opts.color || "FFFFFF" })] })]
  });
}

function dCell(text, width, opts = {}) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    margins: { top: 50, bottom: 50, left: 100, right: 100 },
    verticalAlign: "center",
    children: [new Paragraph({ alignment: opts.align || AlignmentType.LEFT,
      children: [new TextRun({ text, font: "Malgun Gothic", size: 17, bold: opts.bold || false, color: opts.color || "1E293B" })] })]
  });
}

function spacer(h = 100) {
  return new Paragraph({ spacing: { after: h } });
}

function heading1(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_1,
    spacing: { before: 300, after: 150 },
    border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: BLUE, space: 4 } },
    children: [new TextRun({ text, font: "Malgun Gothic", size: 26, bold: true, color: BLUE })]
  });
}

function heading2(text) {
  return new Paragraph({
    heading: HeadingLevel.HEADING_2,
    spacing: { before: 200, after: 100 },
    children: [new TextRun({ text: "  " + text, font: "Malgun Gothic", size: 22, bold: true, color: "334155" })]
  });
}

function bodyText(text, opts = {}) {
  return new Paragraph({
    spacing: { after: opts.after || 80 },
    indent: opts.indent ? { left: opts.indent } : undefined,
    children: [new TextRun({ text, font: "Malgun Gothic", size: 18, color: opts.color || "374151", ...opts })]
  });
}

// ═════════════════════════════════════════
// Features data
// ═════════════════════════════════════════

const features = [
  {
    num: "1", title: "발주 연속성 (자동 파이프라인)",
    desc: "HQ에서 원재료 업체에 PO 발송 후, 출고일정 설정만으로 후공정 업체에 자동 이메일 발송. 수동 확인 단계 제거.",
    details: [
      "원재료/후공정 2단계 파이프라인 분리 (material_status + process_status)",
      "출고일정 설정 시 자동 이메일 발송 스케줄러 (매일 9AM 체크)",
      "파이프라인 시각화: 발주카드에 원재료(파란) + 후공정(보라) 진행바 표시",
    ],
    status: "완료", statusColor: GREEN
  },
  {
    num: "2", title: "후공정 리드타임 관리",
    desc: "후공정 업체가 업체 포털에서 공정별 리드타임(소요일수)을 직접 설정. 기본값 대비 수정 시 사유 입력.",
    details: [
      "7개 공정 기본값: 접지(3일), 코팅(2일), 톰슨(1일), 박(2일), 형압(1일), 싸바리(3일), 기타(2일)",
      "업체 포털 리드타임 설정 UI (후공정 업체 전용)",
      "인증된 API: GET/POST /api/vendor-portal/lead-time",
    ],
    status: "완료", statusColor: GREEN
  },
  {
    num: "3", title: "자동발주 스케줄러",
    desc: "매일 오전 9시 재고 자동 체크. 안전재고 이하 품목 자동 PO 생성 + 자동 발송 + 이메일 + 거래명세서.",
    details: [
      "setInterval 기반 매일 9AM 스케줄러 (서버 시작 시 자동 등록)",
      "PO 생성 즉시 status='sent' (수동 확인 불필요)",
      "이메일 + Google Sheet + 거래명세서 + 활동로그 원스톱 처리",
      "수동 즉시 실행: POST /api/auto-order/run-scheduler",
    ],
    status: "완료", statusColor: GREEN
  },
  {
    num: "4", title: "OS번호 3단계 검증 (XERP 연동)",
    desc: "OS번호 등록 후 XERP poOrderItem과 자동 매칭. 품목코드 일치 시 완료, 불일치 시 재입력 요청.",
    details: [
      "3단계: 등록필요(os_pending) -> 검증대기(os_registered) -> 완료(received)",
      "XERP poOrderHeader + poOrderItem 자동 조회 (업체코드 + 원자재코드 매칭)",
      "product_info.json 원자재코드 변환 체인: PO품목 -> 원자재코드 -> XERP ItemCode",
      "불일치 시: os_pending 복귀 + 에러메시지 (OS번호와 제품코드가 다릅니다)",
    ],
    status: "완료", statusColor: GREEN
  },
  {
    num: "5", title: "거래명세서 자동화",
    desc: "PO 발송 시 거래명세서 자동 생성. 업체 단가 수정 + 사유 입력. 승인/거부 워크플로.",
    details: [
      "PO 발송 -> 거래명세서 자동 생성 (trade_document 테이블)",
      "업체 포털: 단가 수정 + 사유 입력 UI",
      "관리자: 검토대기/승인완료/수동등록 3탭 UI",
      "단가 차이 + 사유 없음 -> 자동 거부 (사유 입력 요청)",
      "승인 시 활동 로그 기록 + price_diff 표시",
    ],
    status: "완료", statusColor: GREEN
  },
  {
    num: "6", title: "목형비 자동 관리",
    desc: "신제품 첫 발주 시 목형비 자동 포함, 재발주 시 자동 제외.",
    details: [
      "products 테이블: is_new_product, first_order_done, die_cost 컬럼",
      "PO 생성 시 자동 체크: 신제품 && 첫발주 -> po_items.notes에 '목형비 포함'",
      "첫 발주 완료 후 first_order_done=1 자동 업데이트",
      "재발주 시 목형비 자동 미포함",
    ],
    status: "완료", statusColor: GREEN
  },
  {
    num: "7", title: "활동 로그 시스템",
    desc: "모든 PO 상태 변경, 거래명세서 수정/승인, 자동발주 등을 타임라인으로 기록.",
    details: [
      "po_activity_log 테이블: action, actor, from/to status 기록",
      "logPOActivity() 헬퍼 함수로 모든 상태변경 시점에 호출",
      "PO 카드에서 활동 로그 타임라인 UI (색상 코딩된 배지)",
      "전역 활동 로그 API: GET /api/activity-log",
    ],
    status: "완료", statusColor: GREEN
  },
];

// ═════════════════════════════════════════
// Build document
// ═════════════════════════════════════════

const children = [];

// ── Title page ──
children.push(spacer(2000));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
  children: [new TextRun({ text: "BARUNSON", font: "Arial", size: 20, color: GRAY, characterSpacing: 300 })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
  border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: BLUE, space: 12 } },
  children: [new TextRun({ text: "재고운영 시스템", font: "Malgun Gothic", size: 48, bold: true, color: BLUE })] }));
children.push(new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 },
  children: [new TextRun({ text: "업데이트 계획서", font: "Malgun Gothic", size: 36, color: "475569" })] }));

// Info table
const infoW = 5000;
const infoColW = [1600, 3400];
const infoData = [
  ["작성일", "2026년 3월 20일"],
  ["버전", "v2.1"],
  ["작성자", "AI 시스템팀"],
  ["시스템", "스마트재고현황 (localhost:12026)"],
];
children.push(new Table({
  width: { size: infoW, type: WidthType.DXA },
  columnWidths: infoColW,
  rows: infoData.map(([k, v]) => new TableRow({ children: [
    new TableCell({ borders: bordersNone, width: { size: infoColW[0], type: WidthType.DXA },
      children: [new Paragraph({ alignment: AlignmentType.RIGHT, children: [new TextRun({ text: k, font: "Malgun Gothic", size: 18, color: GRAY })] })] }),
    new TableCell({ borders: bordersNone, width: { size: infoColW[1], type: WidthType.DXA },
      margins: { left: 200 },
      children: [new Paragraph({ children: [new TextRun({ text: v, font: "Malgun Gothic", size: 18, bold: true, color: "1E293B" })] })] }),
  ]}))
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── Overview ──
children.push(heading1("1. 업데이트 개요"));
children.push(bodyText("본 문서는 바른컴퍼니 재고운영 시스템(스마트재고현황)의 v2.1 업데이트 내역을 정리한 계획서입니다."));
children.push(bodyText("총 7개 기능이 설계, 구현, 테스트 완료되었으며, 모든 기능이 운영 서버에 반영 가능 상태입니다."));
children.push(spacer(100));

// Summary table
const sumColW = [500, 3000, 3600, 1200, 1206];
children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: sumColW,
  rows: [
    new TableRow({ children: [
      hCell("#", sumColW[0]), hCell("기능명", sumColW[1]), hCell("설명", sumColW[2]), hCell("상태", sumColW[3]), hCell("테스트", sumColW[4])
    ]}),
    ...features.map(f => new TableRow({ children: [
      dCell(f.num, sumColW[0], { align: AlignmentType.CENTER, bold: true }),
      dCell(f.title, sumColW[1], { bold: true }),
      dCell(f.desc.slice(0, 50) + "...", sumColW[2]),
      dCell(f.status, sumColW[3], { align: AlignmentType.CENTER, bold: true, color: f.statusColor }),
      dCell("Pass", sumColW[4], { align: AlignmentType.CENTER, color: GREEN, bold: true }),
    ]}))
  ]
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── Feature Details ──
children.push(heading1("2. 기능 상세"));

for (const f of features) {
  children.push(heading2(`${f.num}. ${f.title}`));
  children.push(bodyText(f.desc, { after: 120 }));

  // Details as indented items
  for (const d of f.details) {
    children.push(bodyText(`  -  ${d}`, { indent: 300, color: "475569", after: 40 }));
  }
  children.push(spacer(80));
}

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── Architecture ──
children.push(heading1("3. 시스템 아키텍처"));

children.push(heading2("3.1 기술 스택"));
const techData = [
  ["백엔드", "Node.js (순수 http 모듈, Express 미사용)"],
  ["로컬 DB", "SQLite (better-sqlite3) - orders.db"],
  ["ERP 연동", "MSSQL Azure (XERP) - mssql 패키지"],
  ["프론트엔드", "Single-file SPA (app.html, ~6000줄)"],
  ["이메일", "Google Apps Script 웹앱 연동"],
  ["스프레드시트", "Google Sheets API (Apps Script)"],
  ["스케줄러", "setInterval 기반 (매일 9AM)"],
  ["인증", "SHA256 토큰 (이메일 + 시크릿키)"],
];
const techColW = [2000, 7506];
children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: techColW,
  rows: [
    new TableRow({ children: [hCell("구분", techColW[0]), hCell("내용", techColW[1])] }),
    ...techData.map(([k, v]) => new TableRow({ children: [
      dCell(k, techColW[0], { bold: true, fill: LIGHT_GRAY }),
      dCell(v, techColW[1]),
    ]}))
  ]
}));

children.push(spacer(200));
children.push(heading2("3.2 DB 테이블 (신규/수정)"));
const dbData = [
  ["po_header", "수정", "material_status, process_status, os_number 컬럼 추가"],
  ["products", "수정", "is_new_product, first_order_done, die_cost 컬럼 추가"],
  ["vendor_shipment_schedule", "신규", "출고일정 (po_id, ship_date, ship_time, post_vendor, auto_email_sent)"],
  ["process_lead_time", "신규", "공정 리드타임 (vendor_name, process_type, default/adjusted_days)"],
  ["trade_document", "신규", "거래명세서 (po_id, items_json, vendor_modified, price_diff, memo)"],
  ["po_activity_log", "신규", "활동 로그 (action, actor, from/to status, details)"],
  ["auto_order_items", "기존", "자동발주 설정 (product_code, min_stock, order_qty, vendor)"],
];
const dbColW = [2400, 700, 6406];
children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: dbColW,
  rows: [
    new TableRow({ children: [hCell("테이블", dbColW[0]), hCell("구분", dbColW[1]), hCell("주요 컬럼/설명", dbColW[2])] }),
    ...dbData.map(([t, g, d]) => new TableRow({ children: [
      dCell(t, dbColW[0], { bold: true }),
      dCell(g, dbColW[1], { align: AlignmentType.CENTER, color: g === "신규" ? GREEN : ORANGE }),
      dCell(d, dbColW[2]),
    ]}))
  ]
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── API Reference ──
children.push(heading1("4. 주요 API 목록"));
const apiData = [
  ["POST", "/api/auto-order/run-scheduler", "자동발주 스케줄러 수동 실행"],
  ["POST", "/api/auto-order/run-shipment-check", "출고일 이메일 체크 수동 실행"],
  ["GET", "/api/vendor-portal/lead-time", "업체 포털 리드타임 조회"],
  ["POST", "/api/vendor-portal/lead-time", "업체 포털 리드타임 저장"],
  ["POST", "/api/vendor-portal/set-shipment", "출고일정 설정"],
  ["GET", "/api/vendor-portal/trade-doc", "업체 포털 거래명세서 조회"],
  ["POST", "/api/vendor-portal/update-trade-doc", "업체 단가 수정"],
  ["GET", "/api/trade-document/review", "관리자 검토 대기 목록"],
  ["POST", "/api/trade-document/:id/approve", "거래명세서 승인"],
  ["GET", "/api/po/os-match", "XERP OS번호 자동 매칭"],
  ["PATCH", "/api/po/:id/os", "OS번호 등록 (3단계 검증)"],
  ["GET", "/api/po/:id/activity", "PO 활동 로그 조회"],
  ["GET", "/api/activity-log", "전역 활동 로그"],
];
const apiColW = [800, 3800, 4906];
children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: apiColW,
  rows: [
    new TableRow({ children: [hCell("Method", apiColW[0]), hCell("Endpoint", apiColW[1]), hCell("설명", apiColW[2])] }),
    ...apiData.map(([m, e, d]) => new TableRow({ children: [
      dCell(m, apiColW[0], { align: AlignmentType.CENTER, bold: true, color: m === "GET" ? GREEN : m === "POST" ? BLUE : ORANGE }),
      dCell(e, apiColW[1], { bold: true }),
      dCell(d, apiColW[2]),
    ]}))
  ]
}));

children.push(new Paragraph({ children: [new PageBreak()] }));

// ── Test Results ──
children.push(heading1("5. 테스트 결과"));
children.push(bodyText("모든 기능은 자동화된 Node.js 테스트 스크립트로 검증 완료되었습니다."));
children.push(spacer(100));

const testData = [
  ["test_pipeline.js", "파이프라인 상태 확인", "Pass"],
  ["test_flow.js", "PO 전체 흐름 (확인->출고->완료)", "Pass"],
  ["test_trade_doc.js", "거래명세서 전체 흐름 (생성->단가수정->승인->거부)", "Pass"],
  ["test_leadtime.js", "리드타임 API (조회/저장/인증)", "Pass"],
  ["test_shipment_dieCost.js", "출고일 이메일 + 목형비 자동관리", "Pass"],
];
const testColW = [3000, 4506, 2000];
children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: testColW,
  rows: [
    new TableRow({ children: [hCell("테스트 파일", testColW[0]), hCell("검증 내용", testColW[1]), hCell("결과", testColW[2])] }),
    ...testData.map(([f, d, r]) => new TableRow({ children: [
      dCell(f, testColW[0], { bold: true }),
      dCell(d, testColW[1]),
      dCell(r, testColW[2], { align: AlignmentType.CENTER, bold: true, color: GREEN }),
    ]}))
  ]
}));

children.push(spacer(300));

// ── PO Flow Diagram (text) ──
children.push(heading1("6. 발주 프로세스 흐름도"));
children.push(spacer(80));

const flowSteps = [
  { step: "1", label: "PO 생성 (대기)", desc: "관리자가 발주서 작성 + 품목/수량 입력" },
  { step: "2", label: "PO 발송", desc: "업체 이메일 발송 + 거래명세서 자동 생성 + Google Sheet 동기화" },
  { step: "3", label: "원재료 업체 확인", desc: "업체 포털에서 발주 확인 (material_status: confirmed)" },
  { step: "4", label: "출고일정 설정", desc: "출고일/시간/후공정업체 지정 (material_status: scheduled)" },
  { step: "5", label: "출고일 도래", desc: "스케줄러가 후공정 업체에 자동 이메일 (process_status: sent)" },
  { step: "6", label: "원재료 출고 완료", desc: "material_status: shipped" },
  { step: "7", label: "후공정 업체 확인+작업", desc: "process_status: confirmed -> working" },
  { step: "8", label: "후공정 발송 완료", desc: "process_status: completed, status: os_pending" },
  { step: "9", label: "OS번호 등록+검증", desc: "os_pending -> os_registered -> XERP 검증 -> received" },
  { step: "10", label: "거래명세서 최종 승인", desc: "단가 차이 확인 + 사유 검토 -> approved" },
];

const flowColW = [500, 2200, 6806];
children.push(new Table({
  width: { size: CONTENT_W, type: WidthType.DXA },
  columnWidths: flowColW,
  rows: [
    new TableRow({ children: [hCell("#", flowColW[0]), hCell("단계", flowColW[1]), hCell("동작", flowColW[2])] }),
    ...flowSteps.map((s, i) => new TableRow({ children: [
      dCell(s.step, flowColW[0], { align: AlignmentType.CENTER, bold: true, color: BLUE }),
      dCell(s.label, flowColW[1], { bold: true, fill: i % 2 === 0 ? LIGHT_BLUE : undefined }),
      dCell(s.desc, flowColW[2], { fill: i % 2 === 0 ? LIGHT_BLUE : undefined }),
    ]}))
  ]
}));

// ═════════════════════════════════════════
// Create Document
// ═════════════════════════════════════════

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Malgun Gothic", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Malgun Gothic", color: BLUE },
        paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Malgun Gothic", color: "334155" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 1 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: PAGE_W, height: PAGE_H },
        margin: MARGIN
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 2, color: BLUE, space: 4 } },
          children: [
            new TextRun({ text: "Barunson", font: "Arial", size: 16, color: BLUE, bold: true }),
            new TextRun("\t"),
            new TextRun({ text: "재고운영 시스템 업데이트 계획서 v2.1", font: "Malgun Gothic", size: 14, color: GRAY }),
          ],
          tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "- ", font: "Arial", size: 16, color: GRAY }),
            new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: GRAY }),
            new TextRun({ text: " -", font: "Arial", size: 16, color: GRAY }),
          ]
        })]
      })
    },
    children
  }]
});

Packer.toBuffer(doc).then(buffer => {
  const outPath = 'C:/barunson/바른컴퍼니_재고운영시스템_업데이트계획서.docx';
  fs.writeFileSync(outPath, buffer);
  console.log(`Created: ${outPath} (${Math.round(buffer.length / 1024)}KB)`);
});
