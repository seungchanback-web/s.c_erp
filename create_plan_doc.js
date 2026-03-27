const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
        Header, Footer, AlignmentType, LevelFormat,
        HeadingLevel, BorderStyle, WidthType, ShadingType,
        PageNumber, PageBreak } = require('docx');

const border = { style: BorderStyle.SINGLE, size: 1, color: "CCCCCC" };
const borders = { top: border, bottom: border, left: border, right: border };
const headerBorder = { style: BorderStyle.SINGLE, size: 1, color: "2E5090" };
const headerBorders = { top: headerBorder, bottom: headerBorder, left: headerBorder, right: headerBorder };

function cell(text, width, opts = {}) {
  const runs = Array.isArray(text) ? text : [new TextRun({ text, size: opts.headerSize || 20, bold: opts.bold, font: "맑은 고딕", color: opts.color })];
  return new TableCell({
    borders: opts.headerCell ? headerBorders : borders,
    width: { size: width, type: WidthType.DXA },
    shading: opts.shading ? { fill: opts.shading, type: ShadingType.CLEAR } : undefined,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
    verticalAlign: "center",
    children: [new Paragraph({ alignment: opts.align || AlignmentType.LEFT, children: runs })]
  });
}

function headerCell(text, width) {
  return cell(text, width, { bold: true, shading: "2E5090", color: "FFFFFF", headerCell: true, align: AlignmentType.CENTER, headerSize: 20 });
}

function statusCell(status, width) {
  const map = { "완료": "4CAF50", "진행중": "FF9800", "미착수": "9E9E9E", "긴급": "F44336", "테스트필요": "2196F3" };
  const color = map[status] || "9E9E9E";
  return cell(status, width, { shading: color, color: "FFFFFF", bold: true, align: AlignmentType.CENTER });
}

function makeRow(cells) { return new TableRow({ children: cells }); }

const doc = new Document({
  styles: {
    default: { document: { run: { font: "맑은 고딕", size: 22 } } },
    paragraphStyles: [
      { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 36, bold: true, font: "맑은 고딕", color: "1A3764" },
        paragraph: { spacing: { before: 360, after: 200 }, outlineLevel: 0 } },
      { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 28, bold: true, font: "맑은 고딕", color: "2E5090" },
        paragraph: { spacing: { before: 280, after: 160 }, outlineLevel: 1 } },
      { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
        run: { size: 24, bold: true, font: "맑은 고딕", color: "3A6DB5" },
        paragraph: { spacing: { before: 200, after: 120 }, outlineLevel: 2 } },
    ]
  },
  numbering: {
    config: [
      { reference: "bullets", levels: [
        { level: 0, format: LevelFormat.BULLET, text: "\u2022", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
        { level: 1, format: LevelFormat.BULLET, text: "\u25E6", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 1440, hanging: 360 } } } },
      ]},
      { reference: "numbers", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ]},
      { reference: "phase1", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ]},
      { reference: "phase2", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ]},
      { reference: "phase3", levels: [
        { level: 0, format: LevelFormat.DECIMAL, text: "%1.", alignment: AlignmentType.LEFT,
          style: { paragraph: { indent: { left: 720, hanging: 360 } } } },
      ]},
    ]
  },
  sections: [
    // ─── COVER PAGE ───
    {
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } }
      },
      children: [
        new Paragraph({ spacing: { before: 3000 }, alignment: AlignmentType.CENTER, children: [] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [
          new TextRun({ text: "바른컴퍼니", size: 52, bold: true, font: "맑은 고딕", color: "1A3764" })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: "재고운영 시스템", size: 44, bold: true, font: "맑은 고딕", color: "2E5090" })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 600 }, children: [
          new TextRun({ text: "업데이트 계획서", size: 40, font: "맑은 고딕", color: "3A6DB5" })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: "2E5090", space: 1 } }, spacing: { after: 400 }, children: [] }),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { before: 400, after: 100 }, children: [
          new TextRun({ text: "버전: v2.1", size: 24, font: "맑은 고딕", color: "666666" })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: "작성일: 2026-03-19", size: 24, font: "맑은 고딕", color: "666666" })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: "접속: http://192.168.200.74:12026", size: 24, font: "맑은 고딕", color: "666666" })
        ]}),
        new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 100 }, children: [
          new TextRun({ text: "서버: Node.js + SQLite + XERP(MSSQL)", size: 24, font: "맑은 고딕", color: "666666" })
        ]}),
      ]
    },
    // ─── MAIN CONTENT ───
    {
      properties: {
        page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1200, bottom: 1440, left: 1200 } }
      },
      headers: {
        default: new Header({ children: [
          new Paragraph({ alignment: AlignmentType.RIGHT, border: { bottom: { style: BorderStyle.SINGLE, size: 4, color: "2E5090", space: 4 } },
            children: [new TextRun({ text: "바른컴퍼니 재고운영 시스템 업데이트 계획서", size: 16, color: "999999", font: "맑은 고딕" })] })
        ]})
      },
      footers: {
        default: new Footer({ children: [
          new Paragraph({ alignment: AlignmentType.CENTER, children: [
            new TextRun({ text: "- ", size: 16, color: "999999" }),
            new TextRun({ children: [PageNumber.CURRENT], size: 16, color: "999999" }),
            new TextRun({ text: " -", size: 16, color: "999999" }),
          ]})
        ]})
      },
      children: [
        // ─── 1. 현재 시스템 현황 ───
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("1. 현재 시스템 현황")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("1.1 완성된 핵심 기능")] }),
        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [2800, 4240, 1400, 1400],
          rows: [
            makeRow([headerCell("기능", 2800), headerCell("상세", 4240), headerCell("상태", 1400), headerCell("비고", 1400)]),
            makeRow([cell("재고현황", 2800, {bold:true}), cell("XERP 실시간 재고 + 3개월 출고 분석, 6탭 분류", 4240), statusCell("완료", 1400), cell("캐시 10분", 1400)]),
            makeRow([cell("출고현황", 2800, {bold:true}), cell("XERP 출고완료/출고예정 실시간 조회", 4240), statusCell("완료", 1400), cell("캐시 1시간", 1400)]),
            makeRow([cell("발주 프로세스", 2800, {bold:true}), cell("생성 > 발송(이메일+PDF) > 확인 > OS등록 > 완료", 4240), statusCell("완료", 1400), cell("", 1400)]),
            makeRow([cell("입고일정 캘린더", 2800, {bold:true}), cell("확정일(초록) / 예상일(주황) 캘린더 표시", 4240), statusCell("완료", 1400), cell("", 1400)]),
            makeRow([cell("품목관리", 2800, {bold:true}), cell("한국/중국/더기프트 탭, 엑셀 일괄업로드", 4240), statusCell("완료", 1400), cell("236개 등록", 1400)]),
            makeRow([cell("필수 자동발주", 2800, {bold:true}), cell("최소재고 이하 자동 PO 생성 (4품목)", 4240), statusCell("완료", 1400), cell("수동 트리거", 1400)]),
            makeRow([cell("업체 포털", 2800, {bold:true}), cell("업체별 발주 확인 포털 (URL 토큰 인증)", 4240), statusCell("완료", 1400), cell("", 1400)]),
            makeRow([cell("구글시트 연동", 2800, {bold:true}), cell("Apps Script 이메일 + 시트 동기화", 4240), statusCell("완료", 1400), cell("clasp 인증 필요", 1400)]),
            makeRow([cell("재발주(취소PO)", 2800, {bold:true}), cell("취소된 PO 재발주 버튼 + 이메일 재발송", 4240), statusCell("완료", 1400), cell("", 1400)]),
          ]
        }),

        new Paragraph({ spacing: { before: 200 }, children: [] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("1.2 발주 수량 공식")] }),
        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [3200, 6640],
          rows: [
            makeRow([headerCell("항목", 3200), headerCell("공식", 6640)]),
            makeRow([cell("월평균출고", 3200, {bold:true}), cell("XERP 3개월 출고 합계 / 3", 6640)]),
            makeRow([cell("안전재고", 3200, {bold:true}), cell("월평균출고 x 1개월", 6640)]),
            makeRow([cell("리드타임재고", 3200, {bold:true}), cell("월평균출고 x (리드타임일수 / 30)", 6640)]),
            makeRow([cell("발주점", 3200, {bold:true}), cell("안전재고 + 리드타임재고", 6640)]),
            makeRow([cell("발주수량", 3200, {bold:true}), cell("MAX( 올림(목표재고 - 가용재고, 10000), 10000 )", 6640)]),
            makeRow([cell("연(R) 환산", 3200, {bold:true}), cell("낱개발주수량 / 500 / 절 / 조판", 6640)]),
          ]
        }),

        new Paragraph({ children: [new PageBreak()] }),

        // ─── 2. 미완료 / 개선 항목 ───
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("2. 미완료 및 개선 필요 항목")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("2.1 우선순위별 정리")] }),
        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [800, 2600, 3640, 1400, 1400],
          rows: [
            makeRow([headerCell("순위", 800), headerCell("항목", 2600), headerCell("상세", 3640), headerCell("상태", 1400), headerCell("난이도", 1400)]),
            makeRow([cell("P0", 800, {bold:true, color:"F44336"}), cell("후공정 업체 드롭다운", 2600, {bold:true}), cell("발주 시 후공정 업체 직접 선택, 리오더 시 자동", 3640), statusCell("진행중", 1400), cell("중", 1400)]),
            makeRow([cell("P0", 800, {bold:true, color:"F44336"}), cell("OS등록 XERP 자동매칭", 2600, {bold:true}), cell("XERP poOrderItem 원자재코드 매칭 -> OS번호 자동", 3640), statusCell("미착수", 1400), cell("상", 1400)]),
            makeRow([cell("P1", 800, {bold:true, color:"FF9800"}), cell("실제 품목 데이터 전환", 2600, {bold:true}), cell("예시 품목 삭제 -> 실제 한국/중국/더기프트 업로드", 3640), statusCell("미착수", 1400), cell("하", 1400)]),
            makeRow([cell("P1", 800, {bold:true, color:"FF9800"}), cell("부속품(BOM) 등록", 2600, {bold:true}), cell("제품별 부속품 목록 + 연동 발주", 3640), statusCell("미착수", 1400), cell("중", 1400)]),
            makeRow([cell("P1", 800, {bold:true, color:"FF9800"}), cell("포털 출고지 표시", 2600, {bold:true}), cell("업체 포털에 다음 출고지(파주/후공정) 표시", 3640), statusCell("진행중", 1400), cell("하", 1400)]),
            makeRow([cell("P2", 800, {bold:true, color:"2196F3"}), cell("자동발주 스케줄러", 2600, {bold:true}), cell("10분마다 재고 체크 -> 자동 PO -> 자동 이메일", 3640), statusCell("미착수", 1400), cell("상", 1400)]),
            makeRow([cell("P2", 800, {bold:true, color:"2196F3"}), cell("대시보드/홈 개선", 2600, {bold:true}), cell("KPI 로딩 딜레이 개선, UI 구분 강화", 3640), statusCell("테스트필요", 1400), cell("하", 1400)]),
            makeRow([cell("P3", 800, {bold:true, color:"9E9E9E"}), cell("알림 시스템", 2600, {bold:true}), cell("재고 부족/발주 완료 등 알림 (향후)", 3640), statusCell("미착수", 1400), cell("중", 1400)]),
          ]
        }),

        new Paragraph({ children: [new PageBreak()] }),

        // ─── 3. 단계별 실행 계획 ───
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("3. 단계별 실행 계획")] }),

        // Phase 1
        new Paragraph({ heading: HeadingLevel.HEADING_2, spacing: { before: 200 }, children: [
          new TextRun({ text: "Phase 1: 서비스 오픈 준비 ", color: "1A3764" }),
          new TextRun({ text: "(1주차)", size: 22, color: "999999" })
        ]}),
        new Paragraph({ spacing: { after: 100 }, children: [
          new TextRun({ text: "목표: ", bold: true, size: 22 }),
          new TextRun({ text: "실제 데이터 전환 + 핵심 버그 제로 + 후공정 발주 가능", size: 22 })
        ]}),

        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [600, 3000, 3440, 1400, 1400],
          rows: [
            makeRow([headerCell("#", 600), headerCell("작업", 3000), headerCell("상세 내용", 3440), headerCell("담당", 1400), headerCell("검증", 1400)]),
            makeRow([cell("1", 600, {align:AlignmentType.CENTER}), cell("예시 품목 전체 삭제", 3000), cell("products 테이블 초기화, 관련 PO 정리", 3440), cell("개발팀", 1400), cell("DB 확인", 1400)]),
            makeRow([cell("2", 600, {align:AlignmentType.CENTER}), cell("실제 품목 엑셀 업로드", 3000), cell("한국/중국/더기프트 3카테고리 품목 등록", 3440), cell("운영팀+개발팀", 1400), cell("품목수 대조", 1400)]),
            makeRow([cell("3", 600, {align:AlignmentType.CENTER}), cell("후공정 업체 드롭다운 완성", 3000), cell("발주생성 시 후공정 업체 선택 UI, 저장/조회", 3440), cell("개발팀", 1400), cell("발주 테스트", 1400)]),
            makeRow([cell("4", 600, {align:AlignmentType.CENTER}), cell("업체 포털 출고지 표시", 3000), cell("next_destination 필드 연동, 포털에 표시", 3440), cell("개발팀", 1400), cell("포털 확인", 1400)]),
            makeRow([cell("5", 600, {align:AlignmentType.CENTER}), cell("E2E 발주 테스트", 3000), cell("발주생성>이메일>포털확인>OS등록>완료 전체 흐름", 3440), cell("운영팀", 1400), cell("실제 이메일", 1400)]),
          ]
        }),

        new Paragraph({ spacing: { before: 100, after: 60 }, children: [
          new TextRun({ text: "검증 기준:", bold: true, size: 20, color: "F44336" })
        ]}),
        new Paragraph({ numbering: { reference: "phase1", level: 0 }, children: [new TextRun({ text: "실제 품목 236개 이상 정상 로딩 확인", size: 20 })] }),
        new Paragraph({ numbering: { reference: "phase1", level: 0 }, children: [new TextRun({ text: "발주 이메일이 올바른 업체에게 정상 발송됨", size: 20 })] }),
        new Paragraph({ numbering: { reference: "phase1", level: 0 }, children: [new TextRun({ text: "업체 포털에서 해당 업체 발주만 표시됨", size: 20 })] }),
        new Paragraph({ numbering: { reference: "phase1", level: 0 }, children: [new TextRun({ text: "후공정 업체 선택 저장/조회 정상 동작", size: 20 })] }),

        new Paragraph({ spacing: { before: 300 }, children: [] }),

        // Phase 2
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [
          new TextRun({ text: "Phase 2: XERP 연동 고도화 ", color: "1A3764" }),
          new TextRun({ text: "(2주차)", size: 22, color: "999999" })
        ]}),
        new Paragraph({ spacing: { after: 100 }, children: [
          new TextRun({ text: "목표: ", bold: true, size: 22 }),
          new TextRun({ text: "OS 자동매칭 + 부속품(BOM) 등록 + 대시보드 안정화", size: 22 })
        ]}),

        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [600, 3000, 3440, 1400, 1400],
          rows: [
            makeRow([headerCell("#", 600), headerCell("작업", 3000), headerCell("상세 내용", 3440), headerCell("담당", 1400), headerCell("검증", 1400)]),
            makeRow([cell("1", 600, {align:AlignmentType.CENTER}), cell("OS등록 XERP 자동매칭 API", 3000), cell("poOrderItem 원자재코드 매칭, /api/po/os-match", 3440), cell("개발팀", 1400), cell("API 응답 확인", 1400)]),
            makeRow([cell("2", 600, {align:AlignmentType.CENTER}), cell("OS등록 3탭 UI 재설계", 3000), cell("대기 | 매칭완료 | 완료 탭 + 수동입력 유지", 3440), cell("개발팀", 1400), cell("UI 테스트", 1400)]),
            makeRow([cell("3", 600, {align:AlignmentType.CENTER}), cell("부속품(BOM) 데이터 구조", 3000), cell("product_bom 테이블 + 엑셀 업로드 기능", 3440), cell("개발팀", 1400), cell("BOM 조회", 1400)]),
            makeRow([cell("4", 600, {align:AlignmentType.CENTER}), cell("대시보드 KPI 안정화", 3000), cell("로딩 딜레이 제거, 캐시 전략 개선", 3440), cell("개발팀", 1400), cell("새로고침 5회", 1400)]),
            makeRow([cell("5", 600, {align:AlignmentType.CENTER}), cell("통합 테스트", 3000), cell("전체 기능 크로스체크, 엣지케이스 확인", 3440), cell("운영팀+개발팀", 1400), cell("체크리스트", 1400)]),
          ]
        }),

        new Paragraph({ spacing: { before: 100, after: 60 }, children: [
          new TextRun({ text: "검증 기준:", bold: true, size: 20, color: "F44336" })
        ]}),
        new Paragraph({ numbering: { reference: "phase2", level: 0 }, children: [new TextRun({ text: "XERP OS매칭 API가 실제 OS번호를 정상 반환", size: 20 })] }),
        new Paragraph({ numbering: { reference: "phase2", level: 0 }, children: [new TextRun({ text: "매칭완료 탭에서 [완료처리] 클릭 시 status 정상 변경", size: 20 })] }),
        new Paragraph({ numbering: { reference: "phase2", level: 0 }, children: [new TextRun({ text: "대시보드 진입 시 2022 데이터 플래시 없음", size: 20 })] }),

        new Paragraph({ children: [new PageBreak()] }),

        // Phase 3
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [
          new TextRun({ text: "Phase 3: 자동화 완성 ", color: "1A3764" }),
          new TextRun({ text: "(3-4주차)", size: 22, color: "999999" })
        ]}),
        new Paragraph({ spacing: { after: 100 }, children: [
          new TextRun({ text: "목표: ", bold: true, size: 22 }),
          new TextRun({ text: "무인 자동발주 + 모니터링 + 서비스 안정화", size: 22 })
        ]}),

        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [600, 3000, 3440, 1400, 1400],
          rows: [
            makeRow([headerCell("#", 600), headerCell("작업", 3000), headerCell("상세 내용", 3440), headerCell("담당", 1400), headerCell("검증", 1400)]),
            makeRow([cell("1", 600, {align:AlignmentType.CENTER}), cell("자동발주 스케줄러", 3000), cell("10분 주기 재고 체크, 발주점 이하 자동 PO 생성", 3440), cell("개발팀", 1400), cell("로그 확인", 1400)]),
            makeRow([cell("2", 600, {align:AlignmentType.CENTER}), cell("자동 이메일 발송", 3000), cell("PO 생성 즉시 업체 이메일 자동 발송", 3440), cell("개발팀", 1400), cell("메일 수신", 1400)]),
            makeRow([cell("3", 600, {align:AlignmentType.CENTER}), cell("OS 자동매칭 배치", 3000), cell("10분마다 XERP 조회, OS번호 자동 매칭 처리", 3440), cell("개발팀", 1400), cell("매칭 로그", 1400)]),
            makeRow([cell("4", 600, {align:AlignmentType.CENTER}), cell("모니터링/알림", 3000), cell("서버 상태, XERP 연결, 발주 실패 알림", 3440), cell("개발팀", 1400), cell("장애 시뮬레이션", 1400)]),
            makeRow([cell("5", 600, {align:AlignmentType.CENTER}), cell("운영 매뉴얼 작성", 3000), cell("시스템 사용법, 장애 대응, FAQ", 3440), cell("운영팀", 1400), cell("리뷰", 1400)]),
          ]
        }),

        new Paragraph({ spacing: { before: 100, after: 60 }, children: [
          new TextRun({ text: "검증 기준:", bold: true, size: 20, color: "F44336" })
        ]}),
        new Paragraph({ numbering: { reference: "phase3", level: 0 }, children: [new TextRun({ text: "24시간 무인 운영 시 발주 누락 0건", size: 20 })] }),
        new Paragraph({ numbering: { reference: "phase3", level: 0 }, children: [new TextRun({ text: "XERP 연결 끊김 시 자동 재연결 + 알림 발송", size: 20 })] }),
        new Paragraph({ numbering: { reference: "phase3", level: 0 }, children: [new TextRun({ text: "전체 플로우: 재고부족 감지 > PO생성 > 이메일 > 업체확인 > OS매칭 > 완료 자동화", size: 20 })] }),

        new Paragraph({ children: [new PageBreak()] }),

        // ─── 4. 기술 아키텍처 ───
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("4. 시스템 아키텍처")] }),

        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("4.1 기술 스택")] }),
        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [2400, 3600, 3840],
          rows: [
            makeRow([headerCell("구분", 2400), headerCell("기술", 3600), headerCell("비고", 3840)]),
            makeRow([cell("Frontend", 2400, {bold:true}), cell("app.html (SPA, 5,300+ lines)", 3600), cell("HTML/CSS/JS 단일파일", 3840)]),
            makeRow([cell("Backend", 2400, {bold:true}), cell("serve_inv2.js (Node.js, 2,500+ lines)", 3600), cell("http 모듈, 포트 12026", 3840)]),
            makeRow([cell("DB (Local)", 2400, {bold:true}), cell("SQLite (orders.db, 17 tables)", 3600), cell("better-sqlite3", 3840)]),
            makeRow([cell("DB (ERP)", 2400, {bold:true}), cell("MSSQL Azure (XERP)", 3600), cell("mssql 패키지, 자동재연결", 3840)]),
            makeRow([cell("이메일", 2400, {bold:true}), cell("Google Apps Script (GmailApp)", 3600), cell("clasp 배포, PDF 첨부", 3840)]),
            makeRow([cell("시트 연동", 2400, {bold:true}), cell("Google Sheets API (Apps Script)", 3600), cell("발주 로그 자동 기록", 3840)]),
          ]
        }),

        new Paragraph({ spacing: { before: 300 }, children: [] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("4.2 XERP 핵심 테이블")] }),
        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [3200, 3200, 3440],
          rows: [
            makeRow([headerCell("테이블", 3200), headerCell("용도", 3200), headerCell("핵심 필드", 3440)]),
            makeRow([cell("mmInventory", 3200, {bold:true}), cell("현재고 조회", 3200), cell("ItemCode, OhQty", 3440)]),
            makeRow([cell("mmInoutItem", 3200, {bold:true}), cell("출고 이력 (3개월)", 3200), cell("InoutGubun='SO', InoutDate", 3440)]),
            makeRow([cell("poOrderHeader", 3200, {bold:true}), cell("OS 주문 헤더", 3200), cell("OrderNo, CsCode, OrderDate", 3440)]),
            makeRow([cell("poOrderItem", 3200, {bold:true}), cell("OS 주문 품목", 3200), cell("OrderNo, ItemCode, OrderQty", 3440)]),
            makeRow([cell("bar_shop1.S2_Card", 3200, {bold:true}), cell("품목명 매핑", 3200), cell("Card_Code, Card_Name", 3440)]),
          ]
        }),

        new Paragraph({ spacing: { before: 300 }, children: [] }),
        new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun("4.3 데이터 흐름도")] }),
        new Paragraph({ spacing: { after: 100 }, children: [
          new TextRun({ text: "재고 부족 감지 > 발주 생성 흐름:", bold: true, size: 20 })
        ]}),

        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [1640, 1640, 1640, 1640, 1640, 1640],
          rows: [
            makeRow([
              cell("XERP 재고조회", 1640, {shading: "E3F2FD", bold: true, align: AlignmentType.CENTER}),
              cell(">", 1640, {align: AlignmentType.CENTER}),
              cell("발주점 비교", 1640, {shading: "FFF3E0", bold: true, align: AlignmentType.CENTER}),
              cell(">", 1640, {align: AlignmentType.CENTER}),
              cell("PO 자동생성", 1640, {shading: "E8F5E9", bold: true, align: AlignmentType.CENTER}),
              cell(">", 1640, {align: AlignmentType.CENTER}),
            ]),
            makeRow([
              cell("이메일 발송", 1640, {shading: "FCE4EC", bold: true, align: AlignmentType.CENTER}),
              cell(">", 1640, {align: AlignmentType.CENTER}),
              cell("업체 포털 확인", 1640, {shading: "F3E5F5", bold: true, align: AlignmentType.CENTER}),
              cell(">", 1640, {align: AlignmentType.CENTER}),
              cell("OS 자동매칭", 1640, {shading: "E0F7FA", bold: true, align: AlignmentType.CENTER}),
              cell(">  완료", 1640, {shading: "E8F5E9", bold: true, align: AlignmentType.CENTER}),
            ]),
          ]
        }),

        new Paragraph({ children: [new PageBreak()] }),

        // ─── 5. 수정 파일 목록 ───
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("5. 수정 대상 파일")] }),
        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [4000, 2840, 3000],
          rows: [
            makeRow([headerCell("파일", 4000), headerCell("Phase", 2840), headerCell("수정 내용", 3000)]),
            makeRow([cell("serve_inv2.js", 4000, {bold:true}), cell("Phase 1, 2, 3", 2840), cell("후공정API, OS매칭API, 스케줄러", 3000)]),
            makeRow([cell("app.html", 4000, {bold:true}), cell("Phase 1, 2", 2840), cell("후공정UI, OS등록3탭, 대시보드", 3000)]),
            makeRow([cell("orders.db", 4000, {bold:true}), cell("Phase 1, 2", 2840), cell("product_bom 테이블, 데이터 전환", 3000)]),
            makeRow([cell("apps-script/Code.js", 4000, {bold:true}), cell("Phase 1", 2840), cell("이메일 템플릿 개선", 3000)]),
            makeRow([cell("product_info.json", 4000, {bold:true}), cell("Phase 2", 2840), cell("원자재코드 매핑 검증", 3000)]),
          ]
        }),

        new Paragraph({ spacing: { before: 400 }, children: [] }),

        // ─── 6. 리스크 및 대응 ───
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("6. 리스크 및 대응 방안")] }),
        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [2800, 2200, 2440, 2400],
          rows: [
            makeRow([headerCell("리스크", 2800), headerCell("영향도", 2200), headerCell("대응방안", 2440), headerCell("상태", 2400)]),
            makeRow([cell("XERP 연결 타임아웃", 2800), cell("높음 - 재고조회 불가", 2200), cell("자동재연결 + WHERE IN 최적화", 2440), cell("해결완료", 2400, {color: "4CAF50"})]),
            makeRow([cell("clasp 인증 만료", 2800), cell("중간 - 이메일 발송 불가", 2200), cell("주기적 clasp login 재인증", 2440), cell("관리중", 2400, {color: "FF9800"})]),
            makeRow([cell("업체 이메일 동일", 2800), cell("높음 - 잘못된 업체 표시", 2200), cell("vendor_name 파라미터 추가 완료", 2440), cell("해결완료", 2400, {color: "4CAF50"})]),
            makeRow([cell("SPA 메모리 잔존", 2800), cell("중간 - 잘못된 KPI 표시", 2200), cell("페이지 전환 시 데이터 초기화", 2440), cell("해결완료", 2400, {color: "4CAF50"})]),
            makeRow([cell("자동발주 오발주", 2800), cell("높음 - 비용 손실", 2200), cell("발주전 승인 단계 + 상한선 설정", 2440), cell("Phase 3 대응", 2400, {color: "2196F3"})]),
          ]
        }),

        new Paragraph({ spacing: { before: 400 }, children: [] }),

        // ─── 7. 작업 프로세스 ───
        new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun("7. 작업 프로세스 (단계별 보고)")] }),
        new Paragraph({ spacing: { after: 60 }, children: [
          new TextRun({ text: "각 작업 항목은 아래 프로세스를 따릅니다:", size: 22 })
        ]}),

        new Table({
          width: { size: 9840, type: WidthType.DXA },
          columnWidths: [1200, 2640, 3000, 3000],
          rows: [
            makeRow([headerCell("단계", 1200), headerCell("활동", 2640), headerCell("산출물", 3000), headerCell("담당", 3000)]),
            makeRow([cell("1. 설계", 1200, {bold:true, shading: "E3F2FD"}), cell("기능 설계서 작성", 2640), cell("설계 문서 + DB스키마", 3000), cell("아키텍트(AI)", 3000)]),
            makeRow([cell("2. 코딩", 1200, {bold:true, shading: "E8F5E9"}), cell("코드 구현", 2640), cell("serve_inv2.js / app.html 변경", 3000), cell("개발팀(AI Agent)", 3000)]),
            makeRow([cell("3. 검증", 1200, {bold:true, shading: "FFF3E0"}), cell("코드리뷰 + 기능테스트", 2640), cell("테스트 결과 보고", 3000), cell("아키텍트(AI)", 3000)]),
            makeRow([cell("4. 보고", 1200, {bold:true, shading: "F3E5F5"}), cell("변경사항 보고 + 스크린샷", 2640), cell("보고서", 3000), cell("아키텍트(AI)", 3000)]),
            makeRow([cell("5. 반영", 1200, {bold:true, shading: "FCE4EC"}), cell("사용자 확인 후 서버 재시작", 2640), cell("라이브 배포", 3000), cell("운영팀(사용자)", 3000)]),
          ]
        }),

        new Paragraph({ spacing: { before: 300, after: 100 }, children: [
          new TextRun({ text: "원칙: ", bold: true, size: 22, color: "F44336" }),
          new TextRun({ text: "혼자 진행하지 않고, 각 단계 완료 시 보고 후 다음 단계 진행", size: 22 })
        ]}),
      ]
    }
  ]
});

Packer.toBuffer(doc).then(buffer => {
  fs.writeFileSync("C:\\barunson\\바른컴퍼니_재고운영시스템_업데이트계획서.docx", buffer);
  console.log("문서 생성 완료: C:\\barunson\\바른컴퍼니_재고운영시스템_업데이트계획서.docx");
});
