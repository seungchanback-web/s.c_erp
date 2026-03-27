const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, TabStopType, TabStopPosition } = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" };
const borders = { top: border, bottom: border, left: border, right: border };
const noBorder = { style: BorderStyle.NONE, size: 0 };
const noBorders = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder };
const cellMargins = { top: 60, bottom: 60, left: 120, right: 120 };
const font = "Malgun Gothic";
const W = 9360;

function h1(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing: { before: 400, after: 200 },
    children: [new TextRun({ text, font, bold: true, size: 32, color: "1B5E96" })] });
}
function h2(text) {
  return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, font, bold: true, size: 26, color: "2563EB" })] });
}
function h3(text) {
  return new Paragraph({ spacing: { before: 200, after: 100 },
    children: [new TextRun({ text, font, bold: true, size: 22, color: "1E293B" })] });
}
function p(text, opts = {}) {
  return new Paragraph({ spacing: { after: opts.after || 100 }, alignment: opts.align,
    children: [new TextRun({ text, font, size: opts.size || 20, color: opts.color || "334155", bold: opts.bold, italics: opts.italic })] });
}
function bullet(text, opts = {}) {
  return new Paragraph({ numbering: { reference: "bullets", level: opts.level || 0 }, spacing: { after: 60 },
    children: [new TextRun({ text, font, size: 20, color: "334155", bold: opts.bold })] });
}
function spacer(h = 200) {
  return new Paragraph({ spacing: { after: h }, children: [] });
}
function headerCell(text, w) {
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, margins: cellMargins,
    shading: { fill: "1B5E96", type: ShadingType.CLEAR },
    children: [new Paragraph({ children: [new TextRun({ text, font, bold: true, size: 18, color: "FFFFFF" })] })] });
}
function cell(text, w, opts = {}) {
  return new TableCell({ borders, width: { size: w, type: WidthType.DXA }, margins: cellMargins,
    shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined,
    children: [new Paragraph({ alignment: opts.align, children: [new TextRun({ text, font, size: 18, color: opts.color || "334155", bold: opts.bold })] })] });
}

// ── AS-IS 기능 테이블 데이터
const asIsFeatures = [
  ["재고", "재고현황", "XERP 연동 실시간 재고 조회, 필터링, Google Sheet 동기화", "100%"],
  ["재고", "출고현황", "XERP 출고 데이터 조회, 월별/품목별 출고 분석", "100%"],
  ["발주", "필수 자동발주", "안전재고 기반 자동 알림, 3개월 매출 기반 필요량 산출", "90%"],
  ["발주", "발주생성", "PO 수동 생성, 이메일 발송, 2단계 파이프라인(원재료+후공정)", "100%"],
  ["발주", "발주현황", "PO 상태관리, 활동 로그, 납품일정 추적", "100%"],
  ["발주", "OS등록", "외주 OS번호 등록, XERP 자동매칭 예정", "70%"],
  ["입고", "입고일정", "납품 스케줄 관리, 업체별 일정 조회", "100%"],
  ["입고", "입고관리", "입고 확인 처리, 수량 검증", "100%"],
  ["관리", "거래명세서", "업체별 거래명세서 발행/확인/승인 워크플로우", "100%"],
  ["관리", "거래처 관리", "업체 정보, 연락처, 유형별 관리", "100%"],
  ["관리", "품목관리", "제품 마스터, BOM, 원자재 매핑, 신제품 관리", "100%"],
  ["관리", "불량관리", "불량 등록→처리→완료 워크플로우, 활동 로그, 처리 발주 연결", "100%"],
  ["관리", "MRP", "자재소요계획, 부족/과잉 분석", "80%"],
  ["관리", "후공정 단가", "단가 마스터, 거래 이력, 현황→분석→액션→예상결과 대시보드", "100%"],
];

// ── TO-BE 기능 목록
const toBePhases = [
  {
    phase: "Phase 1: 자동화 완성 (v3.0)",
    period: "2026년 4Q",
    items: [
      { name: "완전 자동 발주", desc: "안전재고 → 발주 생성 → 이메일 발송 → OS등록까지 무인 운영. 사람은 예외 처리만.", priority: "최우선" },
      { name: "OS등록 XERP 자동매칭", desc: "XERP poOrderHeader/poOrderItem 연동으로 OS번호 자동 매칭 → 수동 입력 제거", priority: "최우선" },
      { name: "생산요청 워크플로우", desc: "웨딩북/리플릿 생산 과정 반자동화. Slack 수동 → 시스템 관리 전환", priority: "높음" },
      { name: "제품 스펙 마스터", desc: "웨딩북/리플릿 스펙(용지, 후가공, 인쇄 등) DB 저장 → 생산요청 시 자동 연동", priority: "높음" },
      { name: "알림 자동화", desc: "재고 부족, 납기 지연, 불량 발생 시 Slack/이메일 자동 알림", priority: "높음" },
    ]
  },
  {
    phase: "Phase 2: 지능형 ERP (v3.5)",
    period: "2027년 1Q",
    items: [
      { name: "AI 수요예측 엔진", desc: "과거 출고 데이터 + 시즌 패턴 + 웨딩 시즌 분석 → 3개월 선행 수요 예측", priority: "높음" },
      { name: "원가 최적화 엔진", desc: "후공정 단가 분석 데이터 기반 자동 단가 협상 시뮬레이션, 업체 비교 추천", priority: "중간" },
      { name: "실시간 대시보드", desc: "경영진용 한눈에 보는 KPI: 재고금액, 발주현황, 불량률, 원가율, 납기준수율", priority: "높음" },
      { name: "보고서 자동생성", desc: "월간/주간 보고서 자동 생성(Excel/PDF) → 이메일 자동 발송", priority: "중간" },
      { name: "업체 성과 평가", desc: "납기준수율, 불량률, 가격 경쟁력 종합 평가 → 업체 등급 자동 산출", priority: "중간" },
    ]
  },
  {
    phase: "Phase 3: 플랫폼 확장 (v4.0)",
    period: "2027년 3Q",
    items: [
      { name: "업체 포털", desc: "업체가 직접 PO 확인, 납품일정 입력, 거래명세서 제출. 양방향 소통", priority: "높음" },
      { name: "모바일 앱 (PWA)", desc: "창고에서 스마트폰으로 입고/출고/재고 확인. 푸시 알림", priority: "높음" },
      { name: "바코드/QR 스캔", desc: "입고 시 바코드 스캔 → 자동 수량 입력, 위치 관리", priority: "중간" },
      { name: "다중 창고 관리", desc: "본사/외부 창고 통합 재고 관리, 창고 간 이동 추적", priority: "중간" },
      { name: "API 개방", desc: "외부 시스템(쇼핑몰, 물류) 연동 REST API 제공", priority: "낮음" },
    ]
  }
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: "Malgun Gothic", size: 20 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font }, paragraph: { spacing: { before: 400, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font }, paragraph: { spacing: { before: 300, after: 150 }, outlineLevel: 1 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1080, hanging: 360 } } } }
      ]},
      { reference: "numbers", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } }
      ]}
    ]
  },
  sections: [
    // ────── 표지 ──────
    {
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children: [
        spacer(3000),
        new Paragraph({ spacing: { after: 100 }, alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "BARUNSON COMPANY", font: "Arial", size: 20, color: "64748B", characterSpacing: 300 })] }),
        new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: "1B5E96", size: 4, space: 12 } },
          spacing: { after: 200 }, alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "재고운영 시스템 v3.0", font, bold: true, size: 52, color: "1B5E96" })] }),
        new Paragraph({ spacing: { after: 100 }, alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "AS-IS / TO-BE 비전 계획서", font, size: 36, color: "475569" })] }),
        new Paragraph({ spacing: { after: 60 }, alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "\"전세계에서 가장 쓰기 편하고, 이쁘고, 자동으로 운영되는 ERP\"", font, size: 22, color: "2563EB", italics: true })] }),
        spacer(1000),
        // 표지 정보 테이블
        new Table({
          width: { size: 5000, type: WidthType.DXA }, columnWidths: [1600, 3400],
          rows: [
            ["작성일", "2026년 3월 20일"],
            ["버전", "v3.0 Vision"],
            ["작성자", "바른컴퍼니 SCM팀"],
            ["문서 유형", "AS-IS/TO-BE 전략 계획서"],
          ].map(([k, v]) => new TableRow({ children: [
            new TableCell({ borders: noBorders, width: { size: 1600, type: WidthType.DXA },
              children: [new Paragraph({ alignment: AlignmentType.RIGHT,
                children: [new TextRun({ text: k, font, size: 18, color: "64748B" })] })] }),
            new TableCell({ borders: noBorders, width: { size: 3400, type: WidthType.DXA },
              margins: { left: 200 },
              children: [new Paragraph({ children: [new TextRun({ text: v, font, bold: true, size: 18, color: "1E293B" })] })] }),
          ]}))
        }),
      ]
    },
    // ────── 본문 ──────
    {
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1200, bottom: 1440, left: 1200 } }
      },
      headers: {
        default: new Header({ children: [
          new Paragraph({ border: { bottom: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 2, space: 4 } },
            tabStops: [{ type: TabStopType.RIGHT, position: TabStopPosition.MAX }],
            children: [
              new TextRun({ text: "바른컴퍼니 재고운영 시스템 v3.0 비전", font, size: 16, color: "94A3B8" }),
              new TextRun({ text: "\tAS-IS / TO-BE", font, size: 16, color: "94A3B8" }),
            ]})
        ]})
      },
      footers: {
        default: new Footer({ children: [
          new Paragraph({ alignment: AlignmentType.CENTER,
            children: [new TextRun({ text: "- ", font, size: 16, color: "94A3B8" }),
              new TextRun({ children: [PageNumber.CURRENT], font, size: 16, color: "94A3B8" }),
              new TextRun({ text: " -", font, size: 16, color: "94A3B8" })] })
        ]})
      },
      children: [
        // ────── 1. 개요 ──────
        h1("1. 개요"),
        p("본 문서는 바른컴퍼니 재고운영 시스템의 현재 상태(AS-IS)를 정리하고, 차세대 ERP v3.0의 비전과 구현 로드맵(TO-BE)을 수립하기 위한 전략 계획서입니다."),
        spacer(100),
        h2("1.1 프로젝트 배경"),
        bullet("2026년 1월: 재고운영 시스템 v1.0 최초 구축 (재고조회 + 자동발주)"),
        bullet("2026년 3월: v2.0 완성 (14개 모듈, XERP 연동, 2단계 파이프라인, 불량관리)"),
        bullet("현재: 수동 작업 여전히 존재 (OS등록, 생산요청, 보고서 작성 등)"),
        bullet("목표: 사람은 의사결정만, 나머지는 시스템이 자동 처리하는 완전 자동화 ERP"),
        spacer(100),
        h2("1.2 비전"),
        new Paragraph({ spacing: { after: 100 }, alignment: AlignmentType.CENTER,
          border: { top: { style: BorderStyle.SINGLE, color: "2563EB", size: 2, space: 8 }, bottom: { style: BorderStyle.SINGLE, color: "2563EB", size: 2, space: 8 } },
          children: [new TextRun({ text: "\"전세계에서 가장 쓰기 편하고, 이쁘고, 심지어 자동으로 운영되는 ERP\"", font, bold: true, size: 24, color: "2563EB", italics: true })] }),
        spacer(50),
        bullet("쓰기 편한: 직관적 UI, 클릭 최소화, 모바일 대응"),
        bullet("이쁜: 데이터 시각화, 깔끔한 디자인, 인사이트 중심 대시보드"),
        bullet("자동 운영: AI 예측 → 자동 발주 → 자동 입고 → 자동 보고"),

        // ────── 2. AS-IS 현황 ──────
        new Paragraph({ children: [new PageBreak()] }),
        h1("2. AS-IS 현황 (v2.0)"),
        p("현재 시스템은 14개 모듈로 구성되며, Node.js + SQLite + XERP(MSSQL) 아키텍처로 운영 중입니다."),
        spacer(100),
        h2("2.1 시스템 아키텍처"),
        bullet("서버: Node.js HTTP Server (Express 미사용, 경량화)"),
        bullet("DB: SQLite (orders.db) + XERP MSSQL (읽기 전용)"),
        bullet("프론트엔드: Single-file SPA (app.html, ~7,500줄)"),
        bullet("외부 연동: XERP DB, Google Sheet, 이메일 (nodemailer)"),
        bullet("인프라: 로컬 서버 (포트 12026)"),
        spacer(100),
        h2("2.2 기능 현황"),
        // AS-IS 기능 테이블
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [1000, 1800, 5160, 1400],
          rows: [
            new TableRow({ children: [
              headerCell("영역", 1000), headerCell("모듈", 1800),
              headerCell("주요 기능", 5160), headerCell("완성도", 1400)
            ]}),
            ...asIsFeatures.map((r, i) => new TableRow({ children: [
              cell(r[0], 1000, { fill: i % 2 === 0 ? "F8FAFC" : undefined }),
              cell(r[1], 1800, { bold: true, fill: i % 2 === 0 ? "F8FAFC" : undefined }),
              cell(r[2], 5160, { fill: i % 2 === 0 ? "F8FAFC" : undefined }),
              cell(r[3], 1400, { align: AlignmentType.CENTER, color: r[3] === "100%" ? "16A34A" : "F59E0B", bold: true, fill: i % 2 === 0 ? "F8FAFC" : undefined }),
            ]}))
          ]
        }),
        spacer(200),

        h2("2.3 현재 한계점"),
        // 한계점 테이블
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [600, 2200, 3200, 3360],
          rows: [
            new TableRow({ children: [
              headerCell("#", 600), headerCell("영역", 2200),
              headerCell("현재 문제", 3200), headerCell("영향", 3360)
            ]}),
            ...([
              ["1", "OS등록", "수동으로 OS번호 입력", "시간 소요 + 입력 오류 가능"],
              ["2", "발주 자동화", "알림만 제공, 실제 발주는 수동 클릭", "담당자 부재 시 발주 지연"],
              ["3", "생산요청", "Slack 수동 커뮤니케이션", "이력 관리 불가, 누락 위험"],
              ["4", "수요예측", "최근 3개월 평균만 사용", "시즌 변동 대응 불가"],
              ["5", "보고서", "수동 작성 (Excel 복사/붙여넣기)", "주 2시간 이상 소요"],
              ["6", "업체 소통", "이메일 + 전화 + Slack 분산", "히스토리 추적 어려움"],
              ["7", "모바일", "미지원", "창고에서 PC 이동 필요"],
              ["8", "원가 관리", "데이터 수집만 완료", "자동 분석/추천 부재"],
            ]).map((r, i) => new TableRow({ children: [
              cell(r[0], 600, { align: AlignmentType.CENTER, fill: i % 2 === 0 ? "FEF2F2" : undefined }),
              cell(r[1], 2200, { bold: true, fill: i % 2 === 0 ? "FEF2F2" : undefined }),
              cell(r[2], 3200, { fill: i % 2 === 0 ? "FEF2F2" : undefined }),
              cell(r[3], 3360, { color: "DC2626", fill: i % 2 === 0 ? "FEF2F2" : undefined }),
            ]}))
          ]
        }),

        // ────── 3. TO-BE 비전 ──────
        new Paragraph({ children: [new PageBreak()] }),
        h1("3. TO-BE 비전 (v3.0 ~ v4.0)"),
        p("3단계 Phase로 나누어 점진적으로 구현합니다. 각 Phase는 이전 단계를 기반으로 확장됩니다."),
        spacer(100),

        // Phase별 테이블
        ...toBePhases.flatMap((phase, pi) => [
          h2(`3.${pi + 1} ${phase.phase}`),
          p(`목표 시점: ${phase.period}`, { bold: true, color: "2563EB" }),
          new Table({
            width: { size: W, type: WidthType.DXA },
            columnWidths: [2200, 4960, 1200, 1000],
            rows: [
              new TableRow({ children: [
                headerCell("기능", 2200), headerCell("상세 내용", 4960),
                headerCell("우선순위", 1200), headerCell("공수", 1000)
              ]}),
              ...phase.items.map((item, i) => new TableRow({ children: [
                cell(item.name, 2200, { bold: true, fill: i % 2 === 0 ? "F0F9FF" : undefined }),
                cell(item.desc, 4960, { fill: i % 2 === 0 ? "F0F9FF" : undefined }),
                cell(item.priority, 1200, { align: AlignmentType.CENTER,
                  color: item.priority === "최우선" ? "DC2626" : item.priority === "높음" ? "F59E0B" : "16A34A",
                  bold: true, fill: i % 2 === 0 ? "F0F9FF" : undefined }),
                cell(pi === 0 ? "2주" : pi === 1 ? "3주" : "4주", 1000, { align: AlignmentType.CENTER, fill: i % 2 === 0 ? "F0F9FF" : undefined }),
              ]}))
            ]
          }),
          spacer(200),
        ]),

        // ────── 4. 핵심 변화 비교 ──────
        new Paragraph({ children: [new PageBreak()] }),
        h1("4. 핵심 변화 비교 (Before → After)"),
        spacer(100),
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [1800, 3780, 3780],
          rows: [
            new TableRow({ children: [
              headerCell("업무", 1800), headerCell("AS-IS (현재)", 3780), headerCell("TO-BE (v3.0+)", 3780)
            ]}),
            ...([
              ["발주 프로세스", "재고 확인 → 수동 발주 생성 → 이메일 발송 → OS 수동 입력\n(소요: 30분/건)", "AI 예측 → 자동 PO 생성 → 자동 이메일 → XERP 자동 매칭\n(소요: 0분, 무인)"],
              ["생산 요청", "Slack에서 디자이너-담당자 수동 소통\n이력 관리 불가", "시스템에서 요청→승인→생산→완료\n전 과정 자동 추적"],
              ["재고 파악", "PC에서 시스템 접속 필요\n현장 확인 시 이동", "모바일 앱으로 어디서든 확인\n바코드 스캔 즉시 조회"],
              ["업체 소통", "이메일+전화+Slack 분산\n거래명세서 수동 대조", "업체 포털에서 직접 확인/제출\n자동 대사(matching)"],
              ["보고서", "Excel 수동 작성\n주 2시간 소요", "자동 생성 → 자동 이메일\n주 0분 소요"],
              ["원가 관리", "데이터 수집 + 수동 분석\n대응 지연", "AI 이상감지 → 자동 알림 → 협상 시뮬레이션\n즉시 대응"],
              ["불량 관리", "등록→처리→완료\n수동 처리 발주", "자동 원인 분석 → 업체 평가 반영\n재발 방지 패턴 추천"],
              ["의사결정", "감각 + 경험 기반\n사후 대응", "데이터 + AI 예측 기반\n선제 대응"],
            ]).map((r, i) => new TableRow({ children: [
              cell(r[0], 1800, { bold: true, fill: i % 2 === 0 ? "F8FAFC" : undefined }),
              cell(r[1], 3780, { color: "DC2626", fill: i % 2 === 0 ? "F8FAFC" : undefined }),
              cell(r[2], 3780, { color: "16A34A", fill: i % 2 === 0 ? "F8FAFC" : undefined }),
            ]}))
          ]
        }),

        // ────── 5. 기대 효과 ──────
        spacer(300),
        h1("5. 기대 효과"),
        spacer(100),
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [2340, 2340, 2340, 2340],
          rows: [
            new TableRow({ children: [
              ...[["업무 시간 절감", "70%"], ["발주 정확도", "99%"], ["불량 대응 속도", "3배"], ["원가 절감", "5~10%"]].map(([t, v]) =>
                new TableCell({ borders, width: { size: 2340, type: WidthType.DXA }, margins: { top: 200, bottom: 200, left: 120, right: 120 },
                  shading: { fill: "EFF6FF", type: ShadingType.CLEAR },
                  children: [
                    new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
                      children: [new TextRun({ text: v, font, bold: true, size: 36, color: "1B5E96" })] }),
                    new Paragraph({ alignment: AlignmentType.CENTER,
                      children: [new TextRun({ text: t, font, size: 18, color: "475569" })] }),
                  ] })
              )
            ]})
          ]
        }),
        spacer(100),
        bullet("업무 시간 절감 70%: 발주/보고서/업체소통 자동화로 주 10시간 → 3시간"),
        bullet("발주 정확도 99%: AI 수요예측 + 자동 안전재고 보정으로 과잉/부족 발주 최소화"),
        bullet("불량 대응 속도 3배: 자동 알림 + 원인 분석 + 즉시 처리 발주 생성"),
        bullet("원가 절감 5~10%: 단가 이상 감지 + 업체 비교 + 협상 시뮬레이션"),

        // ────── 6. 로드맵 ──────
        spacer(300),
        h1("6. 구현 로드맵"),
        spacer(100),
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [1500, 2000, 3360, 2500],
          rows: [
            new TableRow({ children: [
              headerCell("시기", 1500), headerCell("마일스톤", 2000),
              headerCell("주요 작업", 3360), headerCell("산출물", 2500)
            ]}),
            ...([
              ["2026 Q2", "v2.5 안정화", "OS등록 XERP 자동매칭, 자동발주 무인화", "완전 자동 발주 시스템"],
              ["2026 Q3", "v3.0 Alpha", "생산요청 워크플로우, 제품스펙마스터, 알림자동화", "생산관리 모듈"],
              ["2026 Q4", "v3.0 Release", "AI 수요예측, 실시간 대시보드, 보고서 자동화", "지능형 ERP 코어"],
              ["2027 Q1", "v3.5 Beta", "원가최적화, 업체성과평가, 고급 분석", "데이터 인텔리전스"],
              ["2027 Q2", "v3.5 Release", "업체 포털 Beta, 모바일 PWA", "외부 연동 플랫폼"],
              ["2027 Q3", "v4.0 Release", "바코드/QR, 다중창고, API 개방", "완전체 ERP 플랫폼"],
            ]).map((r, i) => new TableRow({ children: [
              cell(r[0], 1500, { bold: true, color: "2563EB", fill: i % 2 === 0 ? "F0F9FF" : undefined }),
              cell(r[1], 2000, { bold: true, fill: i % 2 === 0 ? "F0F9FF" : undefined }),
              cell(r[2], 3360, { fill: i % 2 === 0 ? "F0F9FF" : undefined }),
              cell(r[3], 2500, { fill: i % 2 === 0 ? "F0F9FF" : undefined }),
            ]}))
          ]
        }),

        // ────── 7. 기술 스택 ──────
        spacer(300),
        h1("7. 기술 스택 진화"),
        spacer(100),
        new Table({
          width: { size: W, type: WidthType.DXA },
          columnWidths: [1800, 3780, 3780],
          rows: [
            new TableRow({ children: [
              headerCell("영역", 1800), headerCell("AS-IS", 3780), headerCell("TO-BE", 3780)
            ]}),
            ...([
              ["서버", "Node.js HTTP (단일 파일)", "Node.js + Fastify (모듈화)"],
              ["DB", "SQLite + XERP MSSQL", "PostgreSQL + Redis + XERP"],
              ["프론트엔드", "Single HTML (7,500줄)", "React/Next.js + TailwindCSS"],
              ["모바일", "미지원", "PWA (Progressive Web App)"],
              ["AI/ML", "없음", "TensorFlow.js 수요예측"],
              ["인프라", "로컬 서버", "클라우드 (Azure/AWS)"],
              ["모니터링", "콘솔 로그", "Grafana + 자동 알림"],
              ["인증", "없음", "SSO + 역할 기반 권한"],
            ]).map((r, i) => new TableRow({ children: [
              cell(r[0], 1800, { bold: true, fill: i % 2 === 0 ? "F8FAFC" : undefined }),
              cell(r[1], 3780, { fill: i % 2 === 0 ? "F8FAFC" : undefined }),
              cell(r[2], 3780, { color: "16A34A", fill: i % 2 === 0 ? "F8FAFC" : undefined }),
            ]}))
          ]
        }),

        spacer(400),
        new Paragraph({ border: { top: { style: BorderStyle.SINGLE, color: "CBD5E1", size: 2, space: 12 } },
          spacing: { before: 200 }, alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: "End of Document", font: "Arial", size: 18, color: "94A3B8", italics: true })] }),
      ]
    }
  ]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('C:\\barunson\\바른컴퍼니_ERP_v3.0_비전계획서.docx', buf);
  console.log('OK - ERP v3.0 비전 계획서 생성 완료');
});
