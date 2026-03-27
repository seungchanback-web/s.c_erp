'use strict';

/**
 * import_pandacom.js
 * 팬다콤 (Pandacom) 인쇄후공정 거래명세서/견적서 데이터를 SQLite에 임포트
 *
 * 데이터 소스: C:/barunson/pandacom_data.json
 * 대상 DB: ./orders.db
 *
 * 임포트 항목:
 *   1. post_process_history   - 거래 이력 (199건)
 *   2. product_process_map    - 제품별 후공정 매핑
 *   3. post_process_price     - 단가 마스터
 *   4. trade_doc_files        - 거래명세서 파일 기록
 */

const Database = require('better-sqlite3');
const fs       = require('fs');

const db   = new Database('./orders.db');
const data = JSON.parse(fs.readFileSync('C:/barunson/pandacom_data.json', 'utf8'));

const VENDOR = '팬다콤';

// ─────────────────────────────────────────────────────────────
// 테이블 생성 (없으면)
// ─────────────────────────────────────────────────────────────
db.exec(`
  CREATE TABLE IF NOT EXISTS post_process_history (
    id               INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_name      TEXT    NOT NULL,
    month            TEXT    NOT NULL,
    date             TEXT    NOT NULL DEFAULT '',
    product_code     TEXT    NOT NULL DEFAULT '',
    process_type     TEXT    NOT NULL DEFAULT '',
    spec             TEXT    NOT NULL DEFAULT '',
    qty              TEXT    NOT NULL DEFAULT '',
    product_qty      TEXT    NOT NULL DEFAULT '',
    unit_price       REAL,
    amount           REAL    NOT NULL DEFAULT 0,
    os_number        TEXT    NOT NULL DEFAULT '',
    imported_from    TEXT    NOT NULL DEFAULT '',
    created_at       TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(vendor_name, month, date, product_code, process_type, spec, qty)
  );

  CREATE TABLE IF NOT EXISTS product_process_map (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code   TEXT    NOT NULL,
    process_type   TEXT    NOT NULL,
    default_spec   TEXT    NOT NULL DEFAULT '',
    default_price  REAL    NOT NULL DEFAULT 0,
    vendor_name    TEXT    NOT NULL,
    occurrence     INTEGER NOT NULL DEFAULT 0,
    last_amount    REAL    NOT NULL DEFAULT 0,
    last_month     TEXT    NOT NULL DEFAULT '',
    updated_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(product_code, process_type, vendor_name)
  );

  CREATE TABLE IF NOT EXISTS post_process_price (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_name    TEXT    NOT NULL,
    process_type   TEXT    NOT NULL,
    price_type     TEXT    NOT NULL DEFAULT 'per_unit',
    price_tier     TEXT    NOT NULL DEFAULT 'standard',
    spec_condition TEXT    NOT NULL DEFAULT '',
    unit_price     REAL    NOT NULL DEFAULT 0,
    effective_from TEXT    NOT NULL DEFAULT '',
    source         TEXT    NOT NULL DEFAULT '',
    notes          TEXT    NOT NULL DEFAULT '',
    created_at     TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    UNIQUE(vendor_name, process_type, price_tier, spec_condition, unit_price)
  );

  CREATE TABLE IF NOT EXISTS trade_doc_files (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_name  TEXT    NOT NULL,
    period       TEXT    NOT NULL,
    file_name    TEXT    NOT NULL,
    total_amount REAL    NOT NULL DEFAULT 0,
    item_count   INTEGER NOT NULL DEFAULT 0,
    parsed_at    TEXT    NOT NULL DEFAULT (datetime('now','localtime')),
    status       TEXT    NOT NULL DEFAULT 'parsed',
    UNIQUE(vendor_name, period, file_name)
  );
`);

// ─────────────────────────────────────────────────────────────
// 헬퍼: OS번호 / 제품코드 분리
// 팬다콤 데이터는 product_name 안에 OS번호가 들어있는 경우가 있음
// 예: "BH8257_OS2509-B00004", "leafet_disney_b OS2507-B00003"
// ─────────────────────────────────────────────────────────────
const OS_RE = /OS\d{4}-[A-Z]\d+/;

function parseRecord(r) {
  var productNameRaw = r.product_name || '';
  var processRaw     = r.process_type || '';
  var specRaw        = r.spec         || '';

  var osNumber    = '';
  var productCode = productNameRaw;

  // product_name 안에 OS번호가 있으면 추출
  var osMatch = productNameRaw.match(OS_RE);
  if (osMatch) {
    osNumber = osMatch[0];
    // OS번호 부분 제거하고 앞 코드만 남김
    productCode = productNameRaw
      .replace(/[-_\s]?OS\d{4}-[A-Z]\d+[-_\s]?/g, '')
      .replace(/[-_\s]+$/, '')
      .replace(/^[-_\s]+/, '')
      .trim();
  }

  // process_type에 OS번호가 있으면 추출 (견적서 케이스)
  if (!osNumber && OS_RE.test(processRaw)) {
    osNumber = processRaw.match(OS_RE)[0];
  }

  return {
    productCode : productCode || productNameRaw,
    osNumber    : osNumber,
    processType : processRaw,
    spec        : specRaw,
  };
}

// ─────────────────────────────────────────────────────────────
// 1. post_process_history 일괄 INSERT
// ─────────────────────────────────────────────────────────────
console.log('=== 1. 거래 이력 임포트 ===');

const insertHist = db.prepare(`
  INSERT OR IGNORE INTO post_process_history
    (vendor_name, month, date, product_code, process_type, spec,
     qty, product_qty, unit_price, amount, os_number, imported_from)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
`);

var imported = 0;
var skipped  = 0;

db.transaction(function () {
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var p = parseRecord(r);
    var qtyStr = r.qty != null ? String(r.qty) : '';
    var changes = insertHist.run(
      VENDOR,
      r.year_month  || '',
      r.date        || '',
      p.productCode,
      p.processType,
      p.spec,
      qtyStr,
      '',                                        // product_qty (not available in this format)
      r.unit_price != null ? r.unit_price : null,
      r.amount || 0,
      p.osNumber,
      'pandacom_excel_2025'
    ).changes;
    if (changes > 0) { imported++; } else { skipped++; }
  }
})();

console.log('  ' + imported + '건 임포트 완료 (중복 스킵: ' + skipped + '건)');

// ─────────────────────────────────────────────────────────────
// 2. product_process_map UPSERT
// ─────────────────────────────────────────────────────────────
console.log('\n=== 2. 제품별 후공정 매핑 생성 ===');

const upsertMap = db.prepare(`
  INSERT INTO product_process_map
    (product_code, process_type, default_spec, default_price, vendor_name,
     occurrence, last_amount, last_month)
  VALUES (?,?,?,?,?,1,?,?)
  ON CONFLICT(product_code, process_type, vendor_name) DO UPDATE SET
    occurrence    = occurrence + 1,
    default_price = CASE WHEN excluded.default_price > 0
                         THEN excluded.default_price
                         ELSE default_price END,
    default_spec  = CASE WHEN excluded.default_spec != ''
                         THEN excluded.default_spec
                         ELSE default_spec END,
    last_amount   = excluded.last_amount,
    last_month    = CASE WHEN excluded.last_month > last_month
                         THEN excluded.last_month
                         ELSE last_month END,
    updated_at    = datetime('now','localtime')
`);

db.transaction(function () {
  // 월순 정렬 → last_month가 최신값으로 수렴
  var sorted = data.slice().sort(function (a, b) {
    return (a.year_month || '').localeCompare(b.year_month || '');
  });
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i];
    var p = parseRecord(r);
    if (!p.processType) continue;
    upsertMap.run(
      p.productCode,
      p.processType,
      p.spec,
      r.unit_price || 0,
      VENDOR,
      r.amount || 0,
      r.year_month || ''
    );
  }
})();

var mapCount = db.prepare(
  'SELECT COUNT(*) AS c FROM product_process_map WHERE vendor_name=?'
).get(VENDOR).c;
console.log('  ' + mapCount + '개 매핑 생성됨');

// ─────────────────────────────────────────────────────────────
// 3. post_process_price 단가 마스터
// 팬다콤 인쇄후공정 단가 분석 결과:
//   CTP판:   8,000원/판 (표준), 10,000원/판 (견적서)
//   인쇄비:  5,000~9,000원/판 (용지/수량별 상이)
//   접지:    38~40원/매 (4단접지)
//   제본:    무선제본 = 125원/권
//   박(별박): 80,000원/R (일반), 100,000원/R (특수)
//   박스:    1,100~1,500원/개
//   포장/납품: 100,000원/회 (배송 포함)
// ─────────────────────────────────────────────────────────────
console.log('\n=== 3. 단가 마스터 자동 생성 ===');

const insertPrice = db.prepare(`
  INSERT OR IGNORE INTO post_process_price
    (vendor_name, process_type, price_type, price_tier,
     spec_condition, unit_price, effective_from, source, notes)
  VALUES (?,?,?,?,?,?,?,?,?)
`);

var priceCount = 0;

db.transaction(function () {

  // ── CTP판 ──
  // 데이터에서 일관되게 8,000원/판 (견적서는 10,000원)
  priceCount += insertPrice.run(VENDOR, 'CTP판',  'per_unit', 'standard', '판', 8000,  '2025-03', 'pandacom_excel', '일반 CTP판 (표준)').changes;
  priceCount += insertPrice.run(VENDOR, 'CTP판',  'per_unit', 'premium',  '판', 10000, '2026-01', 'pandacom_excel', '견적서 기준 CTP판').changes;
  // 파생: 실제 데이터에서 CTP 관련 공정타입 패턴 추출
  var ctpRows = db.prepare(`
    SELECT process_type, unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND process_type LIKE 'CTP%' AND unit_price > 0
    GROUP BY process_type, unit_price
    ORDER BY cnt DESC
  `).all(VENDOR);
  for (var i = 0; i < ctpRows.length; i++) {
    var row = ctpRows[i];
    priceCount += insertPrice.run(
      VENDOR, row.process_type, 'per_unit', 'standard', '판',
      row.unit_price, '2025-03', 'pandacom_excel', row.cnt + '건 거래'
    ).changes;
  }

  // ── 인쇄비 ──
  // 5,000~9,000원/판 범위. 실제 데이터에서 패턴 추출
  var printRows = db.prepare(`
    SELECT process_type, unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND (
      process_type LIKE '인쇄%'
      OR process_type LIKE '표지-인쇄%'
      OR process_type LIKE '본문-인쇄%'
      OR process_type LIKE '%인쇄 (%'
      OR process_type LIKE '%-인쇄%'
    ) AND unit_price > 0
    GROUP BY process_type, unit_price
    ORDER BY unit_price
  `).all(VENDOR);
  for (var j = 0; j < printRows.length; j++) {
    var r2 = printRows[j];
    var tier = r2.unit_price <= 5000 ? 'economy' :
               r2.unit_price <= 7000 ? 'standard' :
               r2.unit_price <= 8000 ? 'premium' : 'xlarge';
    priceCount += insertPrice.run(
      VENDOR, r2.process_type, 'per_unit', tier, '판',
      r2.unit_price, '2025-03', 'pandacom_excel', r2.cnt + '건 거래'
    ).changes;
  }

  // ── 접지 (4단접지/포지접지 등) ──
  // 38~40원/매
  var folderRows = db.prepare(`
    SELECT process_type, unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND process_type LIKE '%접지%' AND unit_price > 0
    GROUP BY process_type, unit_price
    ORDER BY unit_price
  `).all(VENDOR);
  for (var k = 0; k < folderRows.length; k++) {
    var r3 = folderRows[k];
    priceCount += insertPrice.run(
      VENDOR, r3.process_type, 'per_unit', 'standard', '매',
      r3.unit_price, '2025-03', 'pandacom_excel', r3.cnt + '건 거래'
    ).changes;
  }
  // 기본값 (데이터 없는 경우 대비)
  priceCount += insertPrice.run(VENDOR, '4단접지', 'per_unit', 'standard', '매', 38, '2025-03', 'pandacom_excel', '4단접지 기본 단가').changes;

  // ── 무선제본 / 제본 ──
  // 125원/권 (공책 기준)
  var bindingRows = db.prepare(`
    SELECT process_type, unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND (
      process_type LIKE '%제본%' OR process_type LIKE '%묶음%'
    ) AND unit_price > 0
    GROUP BY process_type, unit_price
    ORDER BY unit_price
  `).all(VENDOR);
  for (var m = 0; m < bindingRows.length; m++) {
    var r4 = bindingRows[m];
    priceCount += insertPrice.run(
      VENDOR, r4.process_type, 'per_unit', 'standard', '권',
      r4.unit_price, '2025-03', 'pandacom_excel', r4.cnt + '건 거래'
    ).changes;
  }
  priceCount += insertPrice.run(VENDOR, '무선제본', 'per_unit', 'standard', '권', 125, '2025-03', 'pandacom_excel', '무선제본 기본 단가').changes;

  // ── 별박 / 박 ──
  // 80,000원/R (표준), 100,000원/R (특수)
  var foilRows = db.prepare(`
    SELECT process_type, unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND (
      process_type LIKE '%박%' OR process_type LIKE '별박%'
    ) AND unit_price > 0
    GROUP BY process_type, unit_price
    ORDER BY unit_price
  `).all(VENDOR);
  for (var n = 0; n < foilRows.length; n++) {
    var r5 = foilRows[n];
    var tier5 = r5.unit_price <= 80000 ? 'standard' : 'premium';
    priceCount += insertPrice.run(
      VENDOR, r5.process_type, 'per_unit', tier5, 'R',
      r5.unit_price, '2025-03', 'pandacom_excel', r5.cnt + '건 거래'
    ).changes;
  }

  // ── 박스 ──
  // 1,100원/개 (표준), 1,500원/개 (대형)
  var boxRows = db.prepare(`
    SELECT process_type, unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND process_type LIKE '%박스%' AND unit_price > 0
    GROUP BY process_type, unit_price
    ORDER BY unit_price
  `).all(VENDOR);
  for (var o = 0; o < boxRows.length; o++) {
    var r6 = boxRows[o];
    var tier6 = r6.unit_price <= 1200 ? 'standard' : 'large';
    priceCount += insertPrice.run(
      VENDOR, r6.process_type, 'per_unit', tier6, '개',
      r6.unit_price, '2025-03', 'pandacom_excel', r6.cnt + '건 거래'
    ).changes;
  }
  priceCount += insertPrice.run(VENDOR, '박스', 'per_unit', 'standard', '개', 1100, '2025-03', 'pandacom_excel', '박스 기본 단가').changes;

  // ── 포장비/운반(납품) ──
  // 100,000원/회 고정
  var delivRows = db.prepare(`
    SELECT process_type, unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND (
      process_type LIKE '%포장%' OR process_type LIKE '%납품%' OR process_type LIKE '%운반%'
    ) AND unit_price > 0
    GROUP BY process_type, unit_price
    ORDER BY unit_price
  `).all(VENDOR);
  for (var p2 = 0; p2 < delivRows.length; p2++) {
    var r7 = delivRows[p2];
    priceCount += insertPrice.run(
      VENDOR, r7.process_type, 'fixed', 'standard', '회',
      r7.unit_price, '2025-03', 'pandacom_excel', r7.cnt + '건 거래'
    ).changes;
  }
  priceCount += insertPrice.run(VENDOR, '포장비',    'fixed', 'standard', '회', 100000, '2025-03', 'pandacom_excel', '포장/납품 기본 단가').changes;
  priceCount += insertPrice.run(VENDOR, '운반(납품)', 'fixed', 'standard', '회', 100000, '2025-03', 'pandacom_excel', '운반/납품 기본 단가').changes;

  // ── 용지대 (종이비용) ── 수량별 상이, 0으로 등록
  priceCount += insertPrice.run(VENDOR, '용지대',       'per_unit', 'varies', '', 0, '2025-03', 'pandacom_excel', '용지비 (제품별 상이)').changes;
  priceCount += insertPrice.run(VENDOR, '용지 표지',    'per_unit', 'varies', '', 0, '2025-03', 'pandacom_excel', '표지 용지비').changes;
  priceCount += insertPrice.run(VENDOR, '용지 본문',    'per_unit', 'varies', '', 0, '2025-03', 'pandacom_excel', '본문 용지비').changes;
  priceCount += insertPrice.run(VENDOR, '제판대',       'per_unit', 'varies', '', 0, '2025-03', 'pandacom_excel', '제판비 (건당 상이)').changes;

  // ── 견적서 기반 단가 (더기프트 리플릿 2026-01) ──
  // CTP: 10,000원/판, 인쇄: 3,500원/판, 4단접지: 35원/매
  priceCount += insertPrice.run(VENDOR, 'CTP',          'per_unit', 'standard', '판', 10000, '2026-01', 'pandacom_quotation', '견적서 기준').changes;
  priceCount += insertPrice.run(VENDOR, '인쇄비 (견적)', 'per_unit', 'standard', '판',  3500, '2026-01', 'pandacom_quotation', '대량 인쇄 견적가').changes;
  priceCount += insertPrice.run(VENDOR, '4단 접지',      'per_unit', 'standard', '매',    35, '2026-01', 'pandacom_quotation', '4단 접지 견적가').changes;
  priceCount += insertPrice.run(VENDOR, '박스',          'per_unit', 'premium',  '개',  1500, '2026-01', 'pandacom_quotation', '박스 견적가 (50000매 기준)').changes;
  priceCount += insertPrice.run(VENDOR, '납품비',        'fixed',    'standard', '회', 220000, '2026-01', 'pandacom_quotation', '납품비 견적가').changes;
  priceCount += insertPrice.run(VENDOR, '제작비 기타',   'per_unit', 'standard', '%', 0, '2026-01', 'pandacom_quotation', '기타 잡비 10% 가산').changes;

})();

console.log('  ' + priceCount + '개 단가 등록됨');

// ─────────────────────────────────────────────────────────────
// 4. trade_doc_files 거래명세서 파일 기록
// ─────────────────────────────────────────────────────────────
console.log('\n=== 4. 거래명세서 파일 기록 ===');

var docFiles = [
  { period: '2025-03', file: '팬다콤_바른컴퍼니-3월분.XLSX' },
  { period: '2025-04', file: '팬다콤_바른컴퍼니-4월분.XLSX' },
  { period: '2025-05', file: '팬다콤_바른컴퍼니-5월분.XLSX' },
  { period: '2025-06', file: '팬다콤_바른컴퍼니-6월분.XLSX' },
  { period: '2025-07', file: '팬다콤_바른컴퍼니-7월분.XLSX' },
  { period: '2025-08', file: '팬다콤_바른컴퍼니-8월분명세서.XLSX' },
  { period: '2025-09', file: '팬다콤_바른컴퍼니-9월분.XLSX' },
  { period: '2025-10', file: '팬다콤_바른컴퍼니-10월분.XLSX' },
  { period: '2025-11', file: '팬다콤_바른컴퍼니-11월 명세표.xlsx' },
  { period: '2026-01', file: '팬다콤_더 기프트 4단 리플릿 견적서.XLSX' },
];

const insertFile = db.prepare(`
  INSERT OR IGNORE INTO trade_doc_files
    (vendor_name, period, file_name, total_amount, item_count, parsed_at, status)
  VALUES (?,?,?,?,?,datetime('now','localtime'),'parsed')
`);

db.transaction(function () {
  for (var i = 0; i < docFiles.length; i++) {
    var f = docFiles[i];
    var monthData   = data.filter(function (r) {
      return r.year_month === f.period && r.source_file === f.file;
    });
    var totalAmount = monthData.reduce(function (s, r) { return s + (r.amount || 0); }, 0);
    insertFile.run(VENDOR, f.period, f.file, totalAmount, monthData.length);
    console.log('  ' + f.period + ': ' + f.file + ' (' + monthData.length + '건, ' + Math.round(totalAmount).toLocaleString() + '원)');
  }
})();

// ─────────────────────────────────────────────────────────────
// 5. 검증 출력
// ─────────────────────────────────────────────────────────────
console.log('\n=== 검증 ===');
console.log('post_process_history :', db.prepare('SELECT COUNT(*) AS c FROM post_process_history WHERE vendor_name=?').get(VENDOR).c, '건 (팬다콤)');
console.log('product_process_map  :', db.prepare('SELECT COUNT(*) AS c FROM product_process_map  WHERE vendor_name=?').get(VENDOR).c, '건 (팬다콤)');
console.log('post_process_price   :', db.prepare('SELECT COUNT(*) AS c FROM post_process_price   WHERE vendor_name=?').get(VENDOR).c, '건 (팬다콤)');
console.log('trade_doc_files      :', db.prepare('SELECT COUNT(*) AS c FROM trade_doc_files      WHERE vendor_name=?').get(VENDOR).c, '건 (팬다콤)');

console.log('\n--- 월별 거래금액 집계 ---');
db.prepare(`
  SELECT month, COUNT(*) AS cnt, SUM(amount) AS total
  FROM post_process_history
  WHERE vendor_name=?
  GROUP BY month
  ORDER BY month
`).all(VENDOR).forEach(function (row) {
  console.log('  ' + row.month + ': ' + row.cnt + '건, ' + Math.round(row.total || 0).toLocaleString() + '원');
});

console.log('\n--- 제품별 후공정 빈도 (상위 20) ---');
db.prepare(`
  SELECT product_code, COUNT(DISTINCT process_type) AS proc_types,
         COUNT(*) AS cnt, SUM(amount) AS total
  FROM post_process_history
  WHERE vendor_name=?
  GROUP BY product_code
  ORDER BY cnt DESC
  LIMIT 20
`).all(VENDOR).forEach(function (row) {
  console.log('  [' + row.cnt + '건] ' + row.product_code.substring(0, 40)
    + ' | 공정' + row.proc_types + '종 | '
    + Math.round(row.total || 0).toLocaleString() + '원');
});

console.log('\n--- 공정별 단가 변동 감지 (단가 2종 이상) ---');
db.prepare(`
  SELECT process_type,
         MIN(unit_price) AS min_p,
         MAX(unit_price) AS max_p,
         COUNT(DISTINCT unit_price) AS price_kinds,
         COUNT(*) AS cnt
  FROM post_process_history
  WHERE vendor_name=? AND unit_price > 0
  GROUP BY process_type
  HAVING COUNT(DISTINCT unit_price) > 1
  ORDER BY (MAX(unit_price) - MIN(unit_price)) DESC
  LIMIT 15
`).all(VENDOR).forEach(function (row) {
  console.log('  ' + row.process_type.substring(0, 40)
    + ': ' + row.min_p.toLocaleString() + ' ~ ' + row.max_p.toLocaleString()
    + '원 (' + row.price_kinds + '종, ' + row.cnt + '건)');
});

db.close();
console.log('\n팬다콤 임포트 완료!');
