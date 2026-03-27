const fs = require('fs');
const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell,
  Header, Footer, AlignmentType, LevelFormat, HeadingLevel, BorderStyle,
  WidthType, ShadingType, PageNumber, PageBreak, TabStopType, TabStopPosition } = require('docx');

const bdr = { style: BorderStyle.SINGLE, size: 1, color: "CBD5E1" };
const borders = { top: bdr, bottom: bdr, left: bdr, right: bdr };
const cm = { top: 50, bottom: 50, left: 100, right: 100 };
const F = "Malgun Gothic";
const W = 9840; // wider margins for more content

function h1(t) { return new Paragraph({ heading: HeadingLevel.HEADING_1, spacing:{before:400,after:200}, children:[new TextRun({text:t,font:F,bold:true,size:32,color:"1B5E96"})]}); }
function h2(t) { return new Paragraph({ heading: HeadingLevel.HEADING_2, spacing:{before:300,after:150}, children:[new TextRun({text:t,font:F,bold:true,size:26,color:"2563EB"})]}); }
function h3(t) { return new Paragraph({ spacing:{before:200,after:100}, children:[new TextRun({text:t,font:F,bold:true,size:22,color:"1E293B"})]}); }
function p(t,o={}) { return new Paragraph({ spacing:{after:o.after||80}, alignment:o.align, children:[new TextRun({text:t,font:F,size:o.size||19,color:o.color||"334155",bold:o.bold,italics:o.italic})]}); }
function bullet(t,o={}) { return new Paragraph({ numbering:{reference:"bullets",level:o.level||0}, spacing:{after:50}, children:[new TextRun({text:t,font:F,size:18,color:o.color||"334155",bold:o.bold})]}); }
function spacer(h=150) { return new Paragraph({ spacing:{after:h}, children:[] }); }

function hCell(t,w) { return new TableCell({ borders, width:{size:w,type:WidthType.DXA}, margins:cm,
  shading:{fill:"1B5E96",type:ShadingType.CLEAR},
  children:[new Paragraph({children:[new TextRun({text:t,font:F,bold:true,size:16,color:"FFFFFF"})]})] }); }
function tCell(t,w,o={}) { return new TableCell({ borders, width:{size:w,type:WidthType.DXA}, margins:cm,
  shading: o.fill?{fill:o.fill,type:ShadingType.CLEAR}:undefined,
  children:[new Paragraph({alignment:o.align, children:[new TextRun({text:String(t),font:F,size:o.size||16,color:o.color||"334155",bold:o.bold})]})] }); }

function makeTable(headers, rows, colWidths) {
  return new Table({
    width:{size:W,type:WidthType.DXA}, columnWidths: colWidths,
    rows: [
      new TableRow({ children: headers.map((h,i) => hCell(h, colWidths[i])) }),
      ...rows.map((r,ri) => new TableRow({ children: r.map((c,ci) =>
        tCell(c, colWidths[ci], { fill: ri%2===0?'F8FAFC':undefined, bold: ci===0 })
      )}))
    ]
  });
}

// ── 데이터 정의 ──

const modules = [
  ['재고','재고현황','XERP 연동 실시간 재고 조회, 안전재고 알림, 원산지별/상태별 필터링, 일괄 발주','100%'],
  ['재고','출고현황','XERP 출고 데이터 조회, 월별 출고 분석, 출고예정 관리','100%'],
  ['발주','필수 자동발주','안전재고 기반 자동 알림, 3개월 매출 기반 필요량 산출, 업체/수량 설정, 스케줄러 연동','100%'],
  ['발주','발주생성','원재료/후공정 PO 생성, 이메일 발송, 거래명세서 자동생성, 2단계 파이프라인','100%'],
  ['발주','발주현황','PO 상태관리(대기→발송→확인→입고), 활동 로그, 원재료/후공정 상태 분리','100%'],
  ['발주','OS등록','외주 OS번호 등록, XERP 자동매칭 예정','70%'],
  ['입고','입고일정','납품 스케줄 관리, 자동 이메일 발송, 업체간 릴레이 납품','100%'],
  ['입고','입고관리','입고 확인 처리, 수량/불량 검증, PO 상태 자동 변경','100%'],
  ['관리','거래명세서','업체별 거래명세서 발행/확인/승인 워크플로우, 업체 수정 추적','100%'],
  ['관리','거래처 관리','업체 마스터(코드/연락처/유형), 업체 포털 링크','100%'],
  ['관리','품목관리','제품 마스터, BOM, 원자재 매핑, 신제품 관리, 일괄 업로드','100%'],
  ['관리','불량관리','불량 등록→처리→완료, 활동 로그, 클레임 금액, 처리 발주 자동생성','100%'],
  ['관리','MRP','BOM 관리, 생산계획, MRP 전개(소요량 계산), MRP→발주 자동생성','80%'],
  ['관리','후공정 단가','단가 마스터, 거래 이력, 현황→분석→액션→예상결과 대시보드','100%'],
  ['관리','생산요청','칸반보드(요청→디자인→데이터→생산→완료), 활동 이력, 스펙 마스터','100%'],
  ['관리','미팅일지','업체별 미팅/이슈 기록, 검색, 유형별 분류','100%'],
  ['시스템','업체 포털','업체가 직접 PO 확인, 납품일정 입력, 거래명세서 확인/수정','100%'],
  ['시스템','설정','발주 가이드(매출 기준/안전재고 가중치), XERP 연결 상태','100%'],
];

const dbTables = [
  ['vendors','업체 마스터','vendor_id, vendor_code, name, type, contact, phone, email, kakao, memo'],
  ['po_header','발주 헤더','po_id, po_number, po_type, vendor_name, status, material_status, process_status, os_number, defect_id'],
  ['po_items','발주 품목','item_id, po_id, product_code, brand, process_type, ordered_qty, received_qty, spec'],
  ['products','제품 마스터','id, product_code, product_name, brand, origin, category, material_code, is_new_product'],
  ['auto_order_items','자동발주 설정','id, product_code, min_stock, order_qty, vendor_name, enabled, last_ordered_at'],
  ['receipts','입고 기록','receipt_id, po_id, receipt_date, received_by, notes'],
  ['receipt_items','입고 품목','receipt_item_id, receipt_id, po_item_id, product_code, received_qty, defect_qty'],
  ['invoices','송장/인보이스','invoice_id, po_id, vendor_name, invoice_no, amount, file_path, status'],
  ['bom_header','BOM 헤더','bom_id, product_code, product_name, brand, version'],
  ['bom_items','BOM 품목','bom_item_id, bom_id, item_type, material_code, vendor_name, qty_per, unit'],
  ['production_plan','생산계획','plan_id, plan_month, product_code, planned_qty, confirmed'],
  ['mrp_result','MRP 결과','result_id, plan_month, product_code, material_code, gross_req, net_req, order_qty, status'],
  ['vendor_shipment_schedule','납품 스케줄','id, po_id, vendor_name, ship_date, ship_time, post_vendor_name, auto_email_sent'],
  ['process_lead_time','공정 리드타임','id, vendor_name, process_type, default_days, adjusted_days'],
  ['trade_document','거래명세서','id, po_id, vendor_name, items_json, vendor_modified_json, price_diff, status'],
  ['post_process_price','후공정 단가','id, vendor_name, process_type, unit_price, effective_from, spec_condition'],
  ['post_process_history','후공정 이력','id, vendor_name, month, product_code, process_type, unit_price, amount'],
  ['product_process_map','제품-공정 매핑','id, product_code, process_type, vendor_name, occurrence, last_amount'],
  ['defects','불량 관리','id, defect_number, vendor_name, product_code, defect_type, severity, status'],
  ['defect_logs','불량 로그','id, defect_id, action, from_status, to_status, actor, details'],
  ['production_requests','생산요청','id, request_number, product_type, product_name, status, priority, due_date'],
  ['production_request_logs','생산요청 로그','id, request_id, action, from_status, to_status, actor'],
  ['product_spec_master','스펙 마스터','id, product_type, spec_name, paper_cover, paper_inner, binding, post_process, is_template'],
  ['po_activity_log','활동 로그','id, po_id, action, actor, actor_type, from_status, to_status, details'],
  ['trade_doc_files','거래명세서 파일','id, vendor_name, period, file_name, total_amount, item_count'],
  ['order_history','주문 이력','history_id, order_date, product_code, actual_qty, material_code, vendor_code'],
];

const apis = [
  ['제품/재고','GET /api/products','제품 목록 조회'],
  ['제품/재고','POST /api/products','제품 등록'],
  ['제품/재고','PUT /api/products/:id','제품 수정'],
  ['제품/재고','DELETE /api/products/:id','제품 삭제'],
  ['제품/재고','POST /api/products/bulk','제품 일괄 업로드'],
  ['제품/재고','GET /api/xerp-inventory','XERP 재고 조회 (캐시 30분)'],
  ['제품/재고','GET /api/xerp-monthly-usage','XERP 월별 출고량'],
  ['제품/재고','GET /api/refresh','데이터 새로고침 (JSON/Excel)'],
  ['발주','GET /api/po','발주 목록 (필터: status, vendor_name)'],
  ['발주','POST /api/po','발주 생성 + 이메일 발송 + 거래명세서'],
  ['발주','GET /api/po/:id','발주 상세 (품목 포함)'],
  ['발주','PATCH /api/po/:id','발주 상태/정보 수정'],
  ['발주','DELETE /api/po/:id','발주 삭제 (대기 상태만)'],
  ['발주','GET /api/po/stats','발주 통계 (상태별 건수)'],
  ['발주','GET /api/po/os-pending','OS 미등록 PO 목록'],
  ['발주','GET /api/po/os-match','OS-PO 매칭 상태'],
  ['자동발주','GET /api/auto-order','자동발주 설정 목록'],
  ['자동발주','POST /api/auto-order','자동발주 항목 추가'],
  ['자동발주','POST /api/auto-order/check','자동발주 필요 항목 체크'],
  ['자동발주','POST /api/auto-order/run-scheduler','수동 스케줄러 실행'],
  ['업체','GET /api/vendors','업체 목록'],
  ['업체','POST /api/vendors','업체 등록'],
  ['업체','PUT /api/vendors/:id','업체 수정'],
  ['업체','DELETE /api/vendors/:id','업체 삭제'],
  ['입고','GET /api/receipts','입고 기록 목록'],
  ['입고','POST /api/receipts','입고 등록 (PO 상태 자동 변경)'],
  ['거래명세서','GET /api/trade-document','거래명세서 목록'],
  ['거래명세서','POST /api/trade-document','거래명세서 생성'],
  ['후공정','GET /api/post-process/prices','단가 마스터 조회'],
  ['후공정','POST /api/post-process/prices','단가 등록/수정'],
  ['후공정','GET /api/post-process/history','거래 이력 조회'],
  ['후공정','GET /api/post-process/summary','분석 대시보드 데이터'],
  ['후공정','GET /api/post-process/estimate','원가 추정'],
  ['BOM/MRP','GET /api/bom','BOM 목록'],
  ['BOM/MRP','POST /api/bom','BOM 등록'],
  ['BOM/MRP','GET /api/plans','생산계획 조회'],
  ['BOM/MRP','POST /api/plans','생산계획 등록'],
  ['BOM/MRP','POST /api/mrp/run','MRP 전개 실행'],
  ['BOM/MRP','POST /api/mrp/create-po','MRP→발주 생성'],
  ['불량','GET /api/defects','불량 목록'],
  ['불량','POST /api/defects','불량 등록'],
  ['불량','PUT /api/defects/:id','불량 수정/상태변경'],
  ['불량','POST /api/defects/:id/create-po','불량 처리 발주 생성'],
  ['생산요청','GET /api/production-requests','생산요청 목록'],
  ['생산요청','POST /api/production-requests','생산요청 등록'],
  ['생산요청','PUT /api/production-requests/:id','생산요청 수정/상태변경'],
  ['생산요청','POST /api/production-requests/:id/log','활동 로그 추가'],
  ['스펙','GET /api/specs','스펙 마스터 조회'],
  ['스펙','POST /api/specs','스펙 등록'],
  ['스펙','PUT /api/specs/:id','스펙 수정'],
  ['스펙','DELETE /api/specs/:id','스펙 삭제'],
  ['업체포털','GET /api/vendor-portal','업체 PO 목록 (토큰 인증)'],
  ['업체포털','POST /api/vendor-portal/material-shipped','원재료 수령 확인'],
  ['업체포털','POST /api/vendor-portal/set-shipment','납품 일정 설정'],
  ['업체포털','POST /api/vendor-portal/update-trade-doc','거래명세서 확인/수정'],
  ['시스템','GET /api/stats','대시보드 통계'],
  ['시스템','GET /api/activity-log','활동 로그'],
  ['시스템','GET /api/notes','미팅일지 조회'],
  ['시스템','POST /api/notes','미팅일지 등록'],
];

const workflows = [
  { name: '일반 재고 발주 플로우', steps: [
    '안전재고 부족 감지 (자동/수동)',
    '자동발주: 스케줄러가 매일 9시 체크 → PO 자동생성 → 이메일 발송',
    '수동발주: 재고현황에서 품목 선택 → 발주생성 페이지 → PO 생성',
    '업체 확인: 업체 포털에서 PO 확인 → 원재료 수령 확인',
    '납품 스케줄: 업체가 출고일/시간 설정 → 후가공 업체에 자동 이메일',
    '입고: 입고관리에서 수량 확인 → PO 상태 자동 변경',
    '거래명세서: 업체가 확인/수정 → 승인 처리',
  ]},
  { name: '웨딩북/리플릿 생산 플로우', steps: [
    '생산요청 등록: 제품유형, 수량, 스펙, 디자이너, 납기일 지정',
    '디자인확인: 디자이너가 시안 완성 → 디자인확인 단계로 이동',
    '데이터확인: 리파인 데이터(인쇄용 최종 파일) 검수 완료',
    '생산진행: 인쇄소/후가공 발주 생성 → 생산 시작',
    '완료: 납품 확인 → 생산요청 완료 처리',
  ]},
  { name: '불량 처리 플로우', steps: [
    '불량 등록: 업체, 제품, 수량, 유형, 심각도, 사진 등록',
    '조사: 원인 분석, 클레임 금액 산정',
    '처리 발주: [처리 발주 생성] 버튼 → 자동 PO 생성 (불량 연결)',
    '완료: 처리 결과 기록, 해결일 입력',
  ]},
  { name: '후공정 단가 관리 플로우', steps: [
    '거래명세서 임포트: Excel 파싱 → 이력/단가/매핑 자동 등록',
    '현황 체크: KPI 카드 (이번달 총액, 전월 대비, 거래 건수)',
    '분석: 월별 추이, 공정 점유율, 업체 비교',
    '액션 제안: 단가 인상 감지 → 긴급/주의 알림 → 권장 조치',
    '예상 결과: 다음달 예측, 절감 시뮬레이션, 집중도 분석',
  ]},
];

const doc = new Document({
  styles: {
    default: { document: { run: { font: F, size: 19 } } },
    paragraphStyles: [
      { id:"Heading1",name:"Heading 1",basedOn:"Normal",next:"Normal",quickFormat:true,
        run:{size:32,bold:true,font:F},paragraph:{spacing:{before:400,after:200},outlineLevel:0}},
      { id:"Heading2",name:"Heading 2",basedOn:"Normal",next:"Normal",quickFormat:true,
        run:{size:26,bold:true,font:F},paragraph:{spacing:{before:300,after:150},outlineLevel:1}},
    ]
  },
  numbering: { config: [
    { reference:"bullets", levels:[
      { level:0,format:LevelFormat.BULLET,text:"\u2022",alignment:AlignmentType.LEFT,
        style:{paragraph:{indent:{left:720,hanging:360}}}},
      { level:1,format:LevelFormat.BULLET,text:"\u25E6",alignment:AlignmentType.LEFT,
        style:{paragraph:{indent:{left:1080,hanging:360}}}},
    ]},
  ]},
  sections: [
    // ── 표지 ──
    {
      properties: { page: { size:{width:12240,height:15840}, margin:{top:1440,right:1200,bottom:1440,left:1200} } },
      children: [
        spacer(2500),
        new Paragraph({spacing:{after:100},alignment:AlignmentType.CENTER,
          children:[new TextRun({text:"BARUNSON COMPANY",font:"Arial",size:20,color:"64748B",characterSpacing:300})]}),
        new Paragraph({border:{bottom:{style:BorderStyle.SINGLE,color:"1B5E96",size:4,space:12}},
          spacing:{after:200},alignment:AlignmentType.CENTER,
          children:[new TextRun({text:"재고운영 시스템",font:F,bold:true,size:52,color:"1B5E96"})]}),
        new Paragraph({spacing:{after:100},alignment:AlignmentType.CENTER,
          children:[new TextRun({text:"PRD (Product Requirements Document)",font:"Arial",size:32,color:"475569"})]}),
        new Paragraph({spacing:{after:60},alignment:AlignmentType.CENTER,
          children:[new TextRun({text:"전체 시스템 기능 요구사항 정의서",font:F,size:24,color:"64748B"})]}),
        spacer(800),
        new Table({
          width:{size:5000,type:WidthType.DXA}, columnWidths:[1600,3400],
          rows: [
            ["작성일","2026년 3월 20일"],["버전","v2.0"],["작성자","바른컴퍼니 SCM팀"],
            ["문서 유형","PRD (제품 요구사항 정의서)"],["시스템","재고운영 & 발주관리 ERP"],
          ].map(([k,v]) => new TableRow({ children: [
            new TableCell({borders:{top:{style:BorderStyle.NONE,size:0},bottom:{style:BorderStyle.NONE,size:0},left:{style:BorderStyle.NONE,size:0},right:{style:BorderStyle.NONE,size:0}},
              width:{size:1600,type:WidthType.DXA},
              children:[new Paragraph({alignment:AlignmentType.RIGHT,children:[new TextRun({text:k,font:F,size:18,color:"64748B"})]})]}),
            new TableCell({borders:{top:{style:BorderStyle.NONE,size:0},bottom:{style:BorderStyle.NONE,size:0},left:{style:BorderStyle.NONE,size:0},right:{style:BorderStyle.NONE,size:0}},
              width:{size:3400,type:WidthType.DXA},margins:{left:200},
              children:[new Paragraph({children:[new TextRun({text:v,font:F,bold:true,size:18,color:"1E293B"})]})]}),
          ]}))
        }),
      ]
    },
    // ── 본문 ──
    {
      properties: { page: { size:{width:12240,height:15840}, margin:{top:1440,right:1200,bottom:1440,left:1200} } },
      headers: { default: new Header({ children: [
        new Paragraph({ border:{bottom:{style:BorderStyle.SINGLE,color:"CBD5E1",size:2,space:4}},
          tabStops:[{type:TabStopType.RIGHT,position:TabStopPosition.MAX}],
          children:[
            new TextRun({text:"바른컴퍼니 재고운영 시스템 PRD",font:F,size:16,color:"94A3B8"}),
            new TextRun({text:"\tv2.0",font:F,size:16,color:"94A3B8"}),
          ]})
      ]})},
      footers: { default: new Footer({ children: [
        new Paragraph({ alignment:AlignmentType.CENTER,
          children:[new TextRun({text:"- ",font:F,size:16,color:"94A3B8"}),
            new TextRun({children:[PageNumber.CURRENT],font:F,size:16,color:"94A3B8"}),
            new TextRun({text:" -",font:F,size:16,color:"94A3B8"})]})
      ]})},
      children: [
        // 1. 개요
        h1("1. 시스템 개요"),
        p("바른컴퍼니 재고운영 시스템은 청첩장/봉투/웨딩북/리플릿 제조업의 재고관리, 발주, 입고, 품질관리, 원가관리를 통합하는 ERP 시스템입니다."),
        spacer(100),
        h2("1.1 시스템 아키텍처"),
        makeTable(['구성요소','기술 스택','설명'],[
          ['서버','Node.js HTTP Server','Express 미사용 경량 서버, 포트 12026'],
          ['로컬 DB','SQLite (better-sqlite3)','WAL 모드, orders.db (26개 테이블)'],
          ['외부 DB','MSSQL (XERP)','재고/출고 데이터 읽기 전용, 풀 5개, 캐시 30분'],
          ['프론트엔드','Single-file SPA (app.html)','Vanilla JS, ~8,000줄, 18개 페이지'],
          ['이메일','Gmail OAuth + nodemailer','발주서 이메일, 자동 납품 알림'],
          ['외부 연동','Google Sheets (Apps Script)','발주 이력 기록, 이메일 발송 대행'],
          ['인증','SHA256 토큰','업체 포털 접근용 (이메일+시크릿 해시)'],
        ],[2000,2500,5340]),
        spacer(100),

        h2("1.2 사용자 역할"),
        makeTable(['역할','접근 범위','주요 활동'],[
          ['SCM 담당자','전체 시스템','발주 생성/관리, 재고 모니터링, 불량 처리, 생산요청'],
          ['디자이너','생산요청 (알림)','디자인 시안 완성 확인, 리파인 데이터 전달'],
          ['원재료 업체','업체 포털','PO 확인, 원재료 수령 확인, 출고일 설정, 거래명세서 확인'],
          ['후가공 업체','업체 포털','PO 확인, 가공 완료 보고, 거래명세서 확인/수정'],
          ['경영진','대시보드 (읽기)','KPI 모니터링, 보고서 확인'],
        ],[2000,2500,5340]),

        // 2. 기능 모듈
        new Paragraph({children:[new PageBreak()]}),
        h1("2. 기능 모듈 (18개)"),
        p("현재 시스템은 18개 모듈로 구성되며, 각 모듈의 완성도와 주요 기능은 다음과 같습니다."),
        spacer(100),
        makeTable(['영역','모듈','주요 기능','완성도'],
          modules.map(m => m),
          [800,1400,6240,1400]
        ),

        // 3. 핵심 워크플로우
        new Paragraph({children:[new PageBreak()]}),
        h1("3. 핵심 비즈니스 워크플로우"),
        ...workflows.flatMap((wf,wi) => [
          h2(`3.${wi+1} ${wf.name}`),
          ...wf.steps.map((s,i) => bullet(`Step ${i+1}: ${s}`)),
          spacer(100),
        ]),

        // 4. 데이터 모델
        new Paragraph({children:[new PageBreak()]}),
        h1("4. 데이터 모델 (26개 테이블)"),
        p("SQLite 데이터베이스(orders.db)에 26개 테이블이 정의되어 있으며, 외래키 제약조건 없이 애플리케이션 레벨에서 관계를 관리합니다."),
        spacer(100),
        makeTable(['테이블명','용도','주요 컬럼'],
          dbTables.map(t => t),
          [2400,1600,5840]
        ),

        // 5. API 명세
        new Paragraph({children:[new PageBreak()]}),
        h1("5. API 명세 (58개 엔드포인트)"),
        p("모든 API는 JSON 형식으로 응답하며, 성공 시 {ok: true, data: ...}, 실패 시 {ok: false, error: \"메시지\"} 형태입니다."),
        spacer(100),
        makeTable(['영역','엔드포인트','설명'],
          apis.map(a => a),
          [1400,3500,4940]
        ),

        // 6. 자동화
        new Paragraph({children:[new PageBreak()]}),
        h1("6. 자동화 시스템"),
        h2("6.1 자동발주 스케줄러"),
        bullet("실행: 매일 오전 9시 (서울 시간)"),
        bullet("로직: auto_order_items 테이블의 enabled=1 품목 순회"),
        bullet("조건: 현재 재고 < min_stock → PO 자동 생성"),
        bullet("동작: PO 생성 → 이메일 발송 → Google Sheet 기록 → 활동 로그"),
        bullet("중복 방지: last_ordered_at 기준 24시간 내 재발주 방지"),
        spacer(100),
        h2("6.2 납품 이메일 자동 발송"),
        bullet("실행: 매일 오전 9시 (자동발주와 동시)"),
        bullet("대상: vendor_shipment_schedule에서 당일 출고 예정 건"),
        bullet("동작: 후가공 업체에 납품 안내 이메일 발송 → auto_email_sent=1"),
        spacer(100),
        h2("6.3 XERP 데이터 동기화"),
        bullet("방식: 요청 시 실시간 조회 (캐시 30분)"),
        bullet("재고: /api/xerp-inventory → 품목별 현재 재고"),
        bullet("출고: /api/xerp-monthly-usage → 월별 출고 실적"),
        bullet("연결: MSSQL 풀 5개, 타임아웃 120초"),

        // 7. 업체 포털
        spacer(200),
        h1("7. 업체 포털"),
        p("업체가 이메일 링크를 통해 직접 접근하는 고객용 인터페이스입니다."),
        spacer(100),
        h2("7.1 인증"),
        bullet("방식: 이메일 + SHA256 토큰 (비밀번호 없음)"),
        bullet("토큰 생성: SHA256(email + PORTAL_SECRET).slice(0, 16)"),
        bullet("접근 URL: /receiver?email=xxx&token=xxx"),
        spacer(100),
        h2("7.2 업체 기능"),
        makeTable(['기능','설명','API'],[
          ['PO 조회','자사에 할당된 발주서 목록 확인','GET /api/vendor-portal'],
          ['수령 확인','원재료 수령 완료 보고','POST /api/vendor-portal/material-shipped'],
          ['납품 설정','출고일/시간 + 다음 업체 지정','POST /api/vendor-portal/set-shipment'],
          ['리드타임','공정별 기본 소요일 관리','GET/POST /api/vendor-portal/lead-time'],
          ['거래명세서','명세서 확인, 수정 요청, 메모 첨부','POST /api/vendor-portal/update-trade-doc'],
        ],[2000,4340,3500]),

        // 8. 비기능 요구사항
        spacer(200),
        h1("8. 비기능 요구사항"),
        h2("8.1 성능"),
        bullet("API 응답 시간: 200ms 이내 (SQLite 쿼리)"),
        bullet("XERP 조회: 30분 캐시로 반복 조회 방지"),
        bullet("동시 접속: 5명 이내 (로컬 서버 기준)"),
        spacer(100),
        h2("8.2 데이터 무결성"),
        bullet("SQLite WAL 모드: 읽기/쓰기 동시성 보장"),
        bullet("트랜잭션: 발주 생성, 입고 처리 등 복합 작업에 사용"),
        bullet("활동 로그: 모든 상태 변경 기록 (po_activity_log, defect_logs 등)"),
        spacer(100),
        h2("8.3 보안"),
        bullet("개인정보 마스킹: 이름(홍*임), 이메일(use****@****.com), 전화(010-****-5678)"),
        bullet("업체 포털: 토큰 기반 접근 제어"),
        bullet("파일 업로드: 지정 디렉토리 내 격리"),
        spacer(100),
        h2("8.4 운영"),
        bullet("배포: 로컬 Node.js 서버 (향후 클라우드 이전 예정)"),
        bullet("백업: SQLite 파일 기반 (orders.db)"),
        bullet("모니터링: 콘솔 로그 (향후 Grafana 연동 예정)"),

        spacer(400),
        new Paragraph({border:{top:{style:BorderStyle.SINGLE,color:"CBD5E1",size:2,space:12}},
          spacing:{before:200},alignment:AlignmentType.CENTER,
          children:[new TextRun({text:"End of Document",font:"Arial",size:18,color:"94A3B8",italics:true})]}),
      ]
    }
  ]
});

Packer.toBuffer(doc).then(buf => {
  fs.writeFileSync('C:\\barunson\\바른컴퍼니_재고운영시스템_PRD.docx', buf);
  console.log('OK - PRD 문서 생성 완료 (' + buf.length + ' bytes)');
});
