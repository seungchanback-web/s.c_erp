const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, HeadingLevel, BorderStyle, WidthType,
  ShadingType, PageNumber, PageBreak, LevelFormat } = require('docx');
const fs = require('fs');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const thShading = { fill: "1E3A5F", type: ShadingType.CLEAR };
const thFont = { font: "Arial", bold: true, color: "FFFFFF", size: 20 };
const tdFont = { font: "Arial", size: 20 };
const cellMargins = { top: 60, bottom: 60, left: 100, right: 100 };

function th(text, width) {
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading: thShading, margins: cellMargins,
    verticalAlign: "center",
    children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ ...thFont, text })] })]
  });
}

function td(text, width, opts = {}) {
  const align = opts.center ? AlignmentType.CENTER : (opts.right ? AlignmentType.RIGHT : AlignmentType.LEFT);
  const shading = opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR } : undefined;
  return new TableCell({
    borders, width: { size: width, type: WidthType.DXA },
    shading, margins: cellMargins,
    children: [new Paragraph({ alignment: align, children: [
      new TextRun({ ...tdFont, text: String(text), bold: !!opts.bold, color: opts.color || "333333" })
    ] })]
  });
}

function heading(text, level = HeadingLevel.HEADING_1) {
  return new Paragraph({ heading: level, spacing: { before: 300, after: 150 },
    children: [new TextRun({ text, font: "Arial", bold: true, size: level === HeadingLevel.HEADING_1 ? 32 : (level === HeadingLevel.HEADING_2 ? 26 : 22) })]
  });
}

function para(text, opts = {}) {
  return new Paragraph({ spacing: { after: opts.after || 120 }, indent: opts.indent ? { left: opts.indent } : undefined,
    children: [new TextRun({ text, font: "Arial", size: opts.size || 21, color: opts.color || "333333", bold: !!opts.bold })]
  });
}

function bullet(text, opts = {}) {
  return new Paragraph({
    numbering: { reference: "bullets", level: opts.level || 0 },
    spacing: { after: 60 },
    children: [new TextRun({ text, font: "Arial", size: 20, color: "333333", bold: !!opts.bold })]
  });
}

const TW = 9360; // table width

// 평가 데이터
const scores = [
  ["기준정보 관리", "품목/BOM/협력사 마스터", 75, 85, "분류체계 보강, 코드 자동채번"],
  ["구매/발주 관리", "PO 생성~입고~정산", 80, 85, "승인 워크플로우, 발주서 양식"],
  ["재고 관리", "현재고/입출고/실사", 70, 85, "안전재고 알림, LOT추적, 재고조정"],
  ["생산/MRP", "생산계획~작업지시~실적", 55, 85, "작업지시서, 공정진척, 생산실적"],
  ["품질 관리", "검사/불량/부적합", 40, 85, "수입검사, 공정검사, 부적합처리"],
  ["회계/정산", "매입/원가/세금계산서", 15, 85, "매입장, 원가계산, 미지급금, 세계"],
  ["보고서/BI", "대시보드/차트/리포트", 30, 85, "경영대시보드, 차트, PDF보고서"],
  ["보안/권한", "인증/RBAC/감사", 15, 85, "로그인, 역할관리, 감사로그"],
  ["시스템 안정성", "백업/모니터링/에러", 35, 85, "자동백업, 에러로깅, 헬스체크"],
  ["사용성/UX", "반응형/검색/단축키", 65, 85, "반응형, 글로벌검색, 키보드단축키"],
];

// 로드맵 데이터
const roadmap = [
  ["S1", "1~2주", "로그인/권한 + DB 백업 + 에러 로깅", "48→55", "🔴 즉시"],
  ["S2", "2~3주", "회계 기초 (매입/원가/미지급금)", "55→65", "🔴 즉시"],
  ["S3", "2~3주", "BI 대시보드 (Chart.js) + 보고서 자동생성", "65→72", "🟡 1개월"],
  ["S4", "2주", "품질관리 고도화 (검사/부적합 워크플로우)", "72→78", "🟡 1개월"],
  ["S5", "2주", "MRP 고도화 (작업지시/생산실적)", "78→82", "🟢 2개월"],
  ["S6", "1~2주", "재고 실사 + 안전재고 + UX 마무리", "82→85+", "🟢 2개월"],
];

// S1~S6 상세
const phases = [
  {
    title: "S1: 보안/권한 + 시스템 안정성 기초",
    period: "1~2주",
    items: [
      "JWT 기반 사용자 인증 (로그인/로그아웃/세션관리)",
      "역할(Role) 정의: 관리자 / 구매담당 / 생산담당 / 업체(뷰어)",
      "페이지별 접근 제어 (미인증 → 로그인 페이지 리다이렉트)",
      "API 미들웨어: 토큰 검증 + 권한 체크",
      "감사 로그 (Audit Trail): 누가 언제 무엇을 변경했는지 전수 기록",
      "SQLite 자동 백업: 매일 00:00 + 서버 시작 시 (최근 7일 보관)",
      "글로벌 에러 핸들러 + 에러 로그 테이블 (error_logs)",
      "헬스체크 API (/api/health): DB, XERP, SMTP 상태 확인",
    ],
    score: "15→55 (보안), 35→60 (안정성)"
  },
  {
    title: "S2: 회계/정산 기초",
    period: "2~3주",
    items: [
      "매입 관리: PO 입고 → 매입전표 자동 생성",
      "거래처 원장: 업체별 미지급금/지급 이력 관리",
      "제품 원가 계산: 원재료비 + 후공정비 + 부속품비 = 총원가",
      "세금계산서 관리: 수취/발행 기록, 전자세금계산서 연동 준비",
      "월별 매입 집계 자동화",
      "결제 스케줄 관리: 업체별 결제일/결제조건",
    ],
    score: "15→70 (회계)"
  },
  {
    title: "S3: BI 대시보드 + 보고서",
    period: "2~3주",
    items: [
      "Chart.js 기반 경영 대시보드 (매출/매입/재고 추이 차트)",
      "KPI 카드: 월매입액, 재고회전율, 발주 리드타임, 불량률",
      "월간 경영보고서 자동 생성 (PDF/Excel)",
      "커스텀 리포트 빌더 (날짜/품목/업체 필터)",
      "데이터 내보내기: 전체 모듈 Excel/CSV 지원",
      "알림 센터: 안전재고 미달, 납기 초과, 미승인 PO 알림",
    ],
    score: "30→85 (보고서)"
  },
  {
    title: "S4: 품질관리 고도화",
    period: "2주",
    items: [
      "수입검사: 입고 시 품질 체크리스트 (합격/조건부합격/불합격)",
      "공정검사: 후공정 완료 시 검사 기록",
      "부적합 처리 워크플로우: 발생→원인분석→시정조치→종결",
      "불량 통계 강화: 파레토 차트, 불량 유형별 추이",
      "협력사 평가: 납기준수율, 불량률, 가격경쟁력 자동 산출",
    ],
    score: "40→85 (품질)"
  },
  {
    title: "S5: MRP/생산 고도화",
    period: "2주",
    items: [
      "작업지시서 생성: MRP 결과 → 공정별 작업지시 자동 생성",
      "공정 진척률 추적: 인쇄→후공정→검수→포장 단계별 진행 현황",
      "생산 실적 입력: 실제 생산량, 불량수, 소요시간 기록",
      "생산 실적 → 재고 자동 반영 (완제품 입고)",
      "생산성 분석: 업체별/제품별 생산 효율 지표",
    ],
    score: "55→85 (생산)"
  },
  {
    title: "S6: 재고 정밀화 + UX 마무리",
    period: "1~2주",
    items: [
      "안전재고 설정 + 미달 알림 (대시보드 + 이메일)",
      "재고 실사: 실사 입력 → 차이 분석 → 재고 조정 승인",
      "LOT 추적: 입고 LOT번호 → 출고 연결 (추적성 확보)",
      "글로벌 검색: 모든 모듈 통합 검색 (Ctrl+K)",
      "키보드 단축키: 자주 쓰는 기능 핫키",
      "반응형 개선: 태블릿 최적화 (현장 사용)",
    ],
    score: "70→85 (재고), 65→85 (UX)"
  },
];

const doc = new Document({
  numbering: {
    config: [{
      reference: "bullets",
      levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ]
    }]
  },
  styles: {
    default: { document: { run: { font: "Arial", size: 21 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 32, bold: true, font: "Arial", color: "1E3A5F" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 26, bold: true, font: "Arial", color: "2D5F8A" },
        paragraph: { spacing: { before: 240, after: 150 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 22, bold: true, font: "Arial", color: "3A7CA5" },
        paragraph: { spacing: { before: 200, after: 100 }, outlineLevel: 2 } },
    ]
  },
  sections: [{
    properties: {
      page: {
        size: { width: 12240, height: 15840 },
        margin: { top: 1440, right: 1200, bottom: 1440, left: 1200 }
      }
    },
    headers: {
      default: new Header({
        children: [new Paragraph({
          alignment: AlignmentType.RIGHT,
          children: [new TextRun({ text: "바른컴퍼니 재고운영시스템 업데이트 계획서", font: "Arial", size: 16, color: "999999" })]
        })]
      })
    },
    footers: {
      default: new Footer({
        children: [new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [
            new TextRun({ text: "바른컴퍼니 | ", font: "Arial", size: 16, color: "999999" }),
            new TextRun({ children: [PageNumber.CURRENT], font: "Arial", size: 16, color: "999999" }),
          ]
        })]
      })
    },
    children: [
      // ── 표지 ──
      new Paragraph({ spacing: { before: 2400 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 },
        children: [new TextRun({ text: "바른컴퍼니", font: "Arial", size: 52, bold: true, color: "1E3A5F" })]
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 },
        children: [new TextRun({ text: "재고운영시스템 업데이트 계획서", font: "Arial", size: 36, bold: true, color: "2D5F8A" })]
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 80 },
        children: [new TextRun({ text: "전문 ERP 85점 달성 로드맵", font: "Arial", size: 24, color: "666666" })]
      }),
      new Paragraph({ spacing: { before: 600 } }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 60 },
        children: [new TextRun({ text: "v2.0 → v3.0 업그레이드", font: "Arial", size: 22, color: "F97316", bold: true })]
      }),
      new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 400 },
        children: [new TextRun({ text: "2026년 3월 20일", font: "Arial", size: 20, color: "888888" })]
      }),

      // 기본 정보 테이블
      new Table({
        width: { size: 5000, type: WidthType.DXA },
        columnWidths: [2000, 3000],
        rows: [
          ["문서 버전", "1.0"],
          ["작성일", "2026-03-20"],
          ["목표", "전문 ERP 대비 85점 이상"],
          ["예상 기간", "10~14주 (2.5~3.5개월)"],
          ["현재 수준", "48점 / 100점"],
        ].map(([k, v]) => new TableRow({
          children: [
            td(k, 2000, { bold: true, fill: "F3F4F6" }),
            td(v, 3000),
          ]
        }))
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 1장: 현황 평가 ──
      heading("1. 현황 평가 (AS-IS)", HeadingLevel.HEADING_1),
      para("전문 ERP(SAP Business One, 이카운트, 더존) 10개 핵심 영역 기준으로 현재 시스템을 평가합니다."),

      heading("1.1 영역별 점수", HeadingLevel.HEADING_2),
      new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: [400, 1600, 2400, 800, 800, 800, 2560],
        rows: [
          new TableRow({ children: [th("#", 400), th("영역", 1600), th("범위", 2400), th("현재", 800), th("목표", 800), th("갭", 800), th("핵심 부족 사항", 2560)] }),
          ...scores.map(([area, scope, cur, target, gap], i) => {
            const diff = cur - target;
            const color = cur >= 70 ? "22C55E" : cur >= 50 ? "F59E0B" : "EF4444";
            return new TableRow({ children: [
              td(String(i + 1), 400, { center: true }),
              td(area, 1600, { bold: true }),
              td(scope, 2400),
              td(String(cur), 800, { center: true, bold: true, color }),
              td(String(target), 800, { center: true }),
              td(String(diff), 800, { center: true, color: "EF4444", bold: true }),
              td(gap, 2560),
            ]});
          }),
          new TableRow({ children: [
            td("", 400), td("종합", 1600, { bold: true }), td("", 2400),
            td("48", 800, { center: true, bold: true, color: "EF4444" }),
            td("85", 800, { center: true, bold: true }),
            td("-37", 800, { center: true, color: "EF4444", bold: true }),
            td("6개 단계 업그레이드 필요", 2560, { bold: true }),
          ]})
        ]
      }),

      heading("1.2 현재 시스템 보유 기능", HeadingLevel.HEADING_2),
      para("현재 v2.0은 다음 기능을 보유하고 있습니다:"),
      bullet("70+ API 엔드포인트, 18개 페이지, 29개 DB 테이블"),
      bullet("XERP 실시간 연동 (재고/출고 현황)"),
      bullet("자동발주 스케줄러 (최소재고 기반)"),
      bullet("MRP 기초 (소요량 계산 → PO 자동 생성)"),
      bullet("협력사 포털 (토큰 인증, 납기 확인)"),
      bullet("후공정 단가/리드타임 관리"),
      bullet("BOM 관리 (부속품 포함)"),
      bullet("불량관리 기초"),
      bullet("거래명세서 자동 생성"),
      bullet("이메일 발송 (SMTP + Apps Script)"),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 2장: 목표 ──
      heading("2. 목표 (TO-BE)", HeadingLevel.HEADING_1),
      para("전문 ERP 대비 85점 이상 달성을 목표로, 6단계에 걸쳐 시스템을 업그레이드합니다.", { bold: true }),

      heading("2.1 핵심 목표", HeadingLevel.HEADING_2),
      bullet("보안/권한: 로그인 없는 시스템 → JWT 인증 + 4단계 역할 기반 접근 제어", { bold: false }),
      bullet("회계/정산: 매입 제로 → 매입관리 + 원가계산 + 미지급금 + 세금계산서 관리"),
      bullet("보고서/BI: 숫자 나열 → Chart.js 대시보드 + 월간 경영보고서 자동 생성"),
      bullet("품질관리: 불량 기록만 → 수입검사 + 공정검사 + 부적합 워크플로우"),
      bullet("생산관리: MRP 기초 → 작업지시서 + 공정진척 + 생산실적 연동"),
      bullet("시스템 안정성: 백업 없음 → 자동 백업 + 에러 로깅 + 헬스체크"),

      heading("2.2 점수 목표 추이", HeadingLevel.HEADING_2),
      new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: [1560, 1560, 1560, 1560, 1560, 1560],
        rows: [
          new TableRow({ children: ["시작 (현재)", "S1 완료", "S2 완료", "S3 완료", "S4+S5 완료", "S6 완료"].map(t => th(t, 1560)) }),
          new TableRow({ children: [
            td("48점", 1560, { center: true, bold: true, color: "EF4444" }),
            td("55점", 1560, { center: true, bold: true, color: "F59E0B" }),
            td("65점", 1560, { center: true, bold: true, color: "F59E0B" }),
            td("72점", 1560, { center: true, bold: true, color: "F59E0B" }),
            td("82점", 1560, { center: true, bold: true, color: "22C55E" }),
            td("85점+", 1560, { center: true, bold: true, color: "22C55E", fill: "DCFCE7" }),
          ]})
        ]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 3장: 실행 로드맵 ──
      heading("3. 실행 로드맵", HeadingLevel.HEADING_1),

      new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: [700, 900, 3800, 1200, 1200, 1560],
        rows: [
          new TableRow({ children: [th("단계", 700), th("기간", 900), th("핵심 작업", 3800), th("점수", 1200), th("우선순위", 1200), th("상태", 1560)] }),
          ...roadmap.map(([stage, period, work, score, priority]) => new TableRow({ children: [
            td(stage, 700, { center: true, bold: true }),
            td(period, 900, { center: true }),
            td(work, 3800),
            td(score, 1200, { center: true }),
            td(priority, 1200, { center: true }),
            td(stage === "S1" ? "진행 중" : "대기", 1560, { center: true, fill: stage === "S1" ? "FEF3C7" : "F3F4F6" }),
          ]}))
        ]
      }),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 4장~9장: S1~S6 상세 ──
      ...phases.flatMap((phase, idx) => [
        heading(`${4 + idx}. ${phase.title}`, HeadingLevel.HEADING_1),
        para(`기간: ${phase.period} | 점수 변화: ${phase.score}`, { bold: true, color: "F97316" }),
        heading(`${4 + idx}.1 구현 항목`, HeadingLevel.HEADING_2),
        ...phase.items.map(item => bullet(item)),
        ...(idx < phases.length - 1 ? [new Paragraph({ children: [new PageBreak()] })] : []),
      ]),

      new Paragraph({ children: [new PageBreak()] }),

      // ── 10장: 기대효과 ──
      heading("10. 기대효과", HeadingLevel.HEADING_1),

      heading("10.1 정량적 효과", HeadingLevel.HEADING_2),
      new Table({
        width: { size: TW, type: WidthType.DXA },
        columnWidths: [2400, 3480, 3480],
        rows: [
          new TableRow({ children: [th("항목", 2400), th("현재", 3480), th("개선 후", 3480)] }),
          ...[
            ["ERP 수준", "48점 (이카운트 60% 수준)", "85점+ (이카운트 동급)"],
            ["보안", "인증 없음 (누구나 접근)", "JWT + RBAC (역할별 접근)"],
            ["회계", "매입 기록 0건", "자동 매입전표 + 원가 분석"],
            ["보고서", "텍스트 숫자만", "차트 대시보드 + 자동 보고서"],
            ["장애 대응", "백업 없음", "일일 자동백업 + 에러 추적"],
            ["다중 사용자", "미지원", "4역할 동시 접속 지원"],
          ].map(([k, before, after]) => new TableRow({ children: [
            td(k, 2400, { bold: true }),
            td(before, 3480, { color: "EF4444" }),
            td(after, 3480, { color: "22C55E" }),
          ]}))
        ]
      }),

      heading("10.2 정성적 효과", HeadingLevel.HEADING_2),
      bullet("경영진: 실시간 경영 현황 파악 → 빠른 의사결정"),
      bullet("구매팀: 원가 분석 기반 협력사 협상력 강화"),
      bullet("생산팀: 작업지시→실적 연결로 생산 효율 가시화"),
      bullet("품질팀: 검사 이력 체계화 → 불량률 지속 감소"),
      bullet("IT: 백업/모니터링으로 장애 예방 → 운영 안정성 확보"),

      new Paragraph({ spacing: { before: 600 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: "— 끝 —", font: "Arial", size: 20, color: "999999" })]
      }),
    ]
  }]
});

const outPath = 'C:\\barunson\\바른컴퍼니_재고운영시스템_업데이트계획서.docx';
Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync(outPath, buffer);
  console.log('✅ 업데이트 계획서 생성 완료:', outPath);
});
