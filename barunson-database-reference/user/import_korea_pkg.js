'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

const db = new Database('./orders.db');
const data = JSON.parse(fs.readFileSync('C:/barunson/korea_pkg_data.json', 'utf8'));

const VENDOR = '코리아패키지';

// ─────────────────────────────────────────────
// 테이블 생성 (없으면)
// ─────────────────────────────────────────────
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

// ─────────────────────────────────────────────
// 헬퍼: OS번호 / 공정명 / 규격 분리
//
// JSON 실제 구조:
//   케이스 A: process에 OS번호, spec에 공정명
//             {"process":"OS2509-B00010","spec":"톰슨"}
//   케이스 B: process에 공정명, spec에 OS번호
//             {"process":"톰슨","spec":"OS2509-B00062"}
//   케이스 C: process에 공정명, spec에 규격 또는 빈값
//             {"process":"재단","spec":"2절"}
//   케이스 D: product_code 안에 OS번호 포함
//             "ESK003_PE-OS2511-B00029"
// ─────────────────────────────────────────────
const OS_RE = /OS\d{4}-[A-Z]\d+/;

function parseRecord(r) {
  var processRaw = r.process || '';
  var specRaw    = r.spec    || '';
  var codeRaw    = r.product_code || '';

  var osNumber   = '';
  var processType = '';
  var spec       = '';
  var productCode = codeRaw;

  // product_code 안의 OS번호 추출
  var codeOsMatch = codeRaw.match(OS_RE);
  if (codeOsMatch) {
    osNumber    = codeOsMatch[0];
    // OS번호 부분 제거: 앞뒤 구분자('-', '_') 포함하여 제거
    productCode = codeRaw.replace(/[-_]?OS\d{4}-[A-Z]\d+[-_]?/, function(m) {
      // 앞뒤 구분자가 남지 않도록 정리
      return '';
    }).replace(/[-_]+$/, '').replace(/^[-_]+/, '');
  }

  // process / spec 필드에서 OS번호 및 공정명 판별
  if (OS_RE.test(processRaw)) {
    // 케이스 A: process = OS번호, spec = 공정명
    if (!osNumber) osNumber = processRaw;
    processType = specRaw;
    spec        = '';
  } else if (OS_RE.test(specRaw)) {
    // 케이스 B: process = 공정명, spec = OS번호
    if (!osNumber) osNumber = specRaw;
    processType = processRaw;
    spec        = '';
  } else {
    // 케이스 C: 일반 케이스
    processType = processRaw;
    spec        = specRaw;
  }

  return {
    productCode : productCode,
    osNumber    : osNumber,
    processType : processType,
    spec        : spec,
  };
}

// ─────────────────────────────────────────────
// 1. post_process_history 일괄 INSERT
// ─────────────────────────────────────────────
console.log('=== 1. 거래 이력 임포트 ===');

const insertHist = db.prepare(`
  INSERT OR IGNORE INTO post_process_history
    (vendor_name, month, date, product_code, process_type, spec,
     qty, product_qty, unit_price, amount, os_number, imported_from)
  VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
`);

var imported = 0;
var skipped  = 0;

db.transaction(function() {
  for (var i = 0; i < data.length; i++) {
    var r = data[i];
    var p = parseRecord(r);
    var changes = insertHist.run(
      VENDOR,
      r.month   || '',
      r.date    || '',
      p.productCode,
      p.processType,
      p.spec,
      r.qty         || '',
      r.product_qty || '',
      r.unit_price != null ? r.unit_price : null,
      r.amount  || 0,
      p.osNumber,
      'korea_pkg_excel_2025-2026'
    ).changes;
    if (changes > 0) { imported++; } else { skipped++; }
  }
})();

console.log('  ' + imported + '건 임포트 완료 (중복 스킵: ' + skipped + '건)');

// ─────────────────────────────────────────────
// 2. product_process_map UPSERT
// ─────────────────────────────────────────────
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

db.transaction(function() {
  // 월순 정렬 → last_month가 최신값으로 수렴
  var sorted = data.slice().sort(function(a, b) {
    return (a.month || '').localeCompare(b.month || '');
  });
  for (var i = 0; i < sorted.length; i++) {
    var r = sorted[i];
    var p = parseRecord(r);
    upsertMap.run(
      p.productCode,
      p.processType,
      p.spec,
      r.unit_price || 0,
      VENDOR,
      r.amount || 0,
      r.month || ''
    );
  }
})();

var mapCount = db.prepare('SELECT COUNT(*) AS c FROM product_process_map WHERE vendor_name=?').get(VENDOR).c;
console.log('  ' + mapCount + '개 매핑 생성됨');

// ─────────────────────────────────────────────
// 3. post_process_price 단가 마스터 자동 생성
// ─────────────────────────────────────────────
console.log('\n=== 3. 단가 마스터 자동 생성 ===');

const insertPrice = db.prepare(`
  INSERT OR IGNORE INTO post_process_price
    (vendor_name, process_type, price_type, price_tier,
     spec_condition, unit_price, effective_from, source, notes)
  VALUES (?,?,?,?,?,?,?,?,?)
`);

var priceCount = 0;

db.transaction(function() {

  // ── 톰슨: 실제 데이터에서 (spec, unit_price) 조합 추출 ──
  var tomsonRows = db.prepare(`
    SELECT spec, unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND process_type='톰슨' AND unit_price > 0
    GROUP BY spec, unit_price
    ORDER BY unit_price
  `).all(VENDOR);

  for (var i = 0; i < tomsonRows.length; i++) {
    var t = tomsonRows[i];
    var tier;
    if      (t.unit_price <= 24000) { tier = 'small';  }
    else if (t.unit_price <= 29000) { tier = 'medium'; }
    else if (t.unit_price <= 39000) { tier = 'large';  }
    else                            { tier = 'xlarge'; }
    var c = insertPrice.run(VENDOR, '톰슨', 'per_unit', tier, t.spec || '', t.unit_price, '2025-09', 'korea_pkg_excel', t.cnt + '건 거래').changes;
    priceCount += c;
  }

  // ── CTP ──
  priceCount += insertPrice.run(VENDOR, 'CTP', 'per_unit', 'standard', '판', 8000,  '2025-09', 'korea_pkg_excel', '일반 CTP').changes;
  priceCount += insertPrice.run(VENDOR, 'CTP', 'per_unit', 'large',    '판', 10000, '2025-09', 'korea_pkg_excel', '대형 CTP (BH0210 등)').changes;

  // ── 인쇄 ──
  priceCount += insertPrice.run(VENDOR, '인쇄', 'per_unit', 'economy',  '판', 7000,  '2025-09', 'korea_pkg_excel', '대량 인쇄').changes;
  priceCount += insertPrice.run(VENDOR, '인쇄', 'per_unit', 'standard', '판', 8000,  '2025-09', 'korea_pkg_excel', '일반 인쇄 (소량)').changes;
  priceCount += insertPrice.run(VENDOR, '인쇄', 'per_unit', 'standard', '판', 9000,  '2025-09', 'korea_pkg_excel', '일반 인쇄 (일반)').changes;
  priceCount += insertPrice.run(VENDOR, '인쇄', 'per_unit', 'premium',  '판', 10000, '2025-09', 'korea_pkg_excel', '특수/대형 인쇄').changes;

  // ── 재단 ──
  priceCount += insertPrice.run(VENDOR, '재단', 'per_unit', 'standard', '연', 5000,  '2025-09', 'korea_pkg_excel', '일반 재단').changes;
  priceCount += insertPrice.run(VENDOR, '재단', 'per_unit', 'special',  '연', 10000, '2025-09', 'korea_pkg_excel', '특수 재단').changes;
  priceCount += insertPrice.run(VENDOR, '재단', 'per_unit', 'premium',  '연', 15000, '2025-09', 'korea_pkg_excel', '대형/특수 재단').changes;

  // ── 동판+필름 (건당 고정, 제품별 상이) ──
  priceCount += insertPrice.run(VENDOR, '동판+필름', 'fixed', 'varies', '', 0, '2025-09', 'korea_pkg_excel', '건당 50,000~350,000원 (제품별 상이)').changes;

  // ── 목형비 (건당 고정, 신제품만) ──
  priceCount += insertPrice.run(VENDOR, '목형비', 'fixed', 'varies', '', 0, '2025-09', 'korea_pkg_excel', '건당 150,000~250,000원 (신제품만)').changes;

  // ── 목형 (실제 데이터 기반) ──
  priceCount += insertPrice.run(VENDOR, '목형', 'fixed', 'varies', '', 0, '2025-09', 'korea_pkg_excel', '건당 150,000~250,000원 (신제품만)').changes;

  // ── 박 (매당) ──
  priceCount += insertPrice.run(VENDOR, '박', 'per_unit', 'economy',  '매', 36, '2025-09', 'korea_pkg_excel', '경제 박').changes;
  priceCount += insertPrice.run(VENDOR, '박', 'per_unit', 'standard', '매', 48, '2025-09', 'korea_pkg_excel', '일반 박').changes;
  priceCount += insertPrice.run(VENDOR, '박', 'per_unit', 'premium',  '매', 72, '2025-09', 'korea_pkg_excel', '프리미엄 박').changes;

  // ── 타공: 실제 데이터에서 unit_price 패턴 추출 ──
  var tagonRows = db.prepare(`
    SELECT unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND process_type='타공' AND unit_price > 0
    GROUP BY unit_price ORDER BY unit_price
  `).all(VENDOR);

  for (var j = 0; j < tagonRows.length; j++) {
    var t2 = tagonRows[j];
    var tier2;
    if      (t2.unit_price <= 5)  { tier2 = 'simple';   }
    else if (t2.unit_price <= 10) { tier2 = 'standard'; }
    else                          { tier2 = 'complex';  }
    priceCount += insertPrice.run(VENDOR, '타공', 'per_unit', tier2, '매', t2.unit_price, '2025-09', 'korea_pkg_excel', t2.cnt + '건 거래').changes;
  }

  // ── 원단 / 원단비 ──
  priceCount += insertPrice.run(VENDOR, '원단',   'per_unit', 'standard', '', 0, '2025-09', 'korea_pkg_excel', '원단 구입비 (제품별 상이)').changes;
  priceCount += insertPrice.run(VENDOR, '원단비', 'per_unit', 'standard', '', 0, '2025-09', 'korea_pkg_excel', '원단비 (제품별 상이)').changes;

  // ── 디보싱 ──
  var debossingRows = db.prepare(`
    SELECT unit_price, COUNT(*) AS cnt
    FROM post_process_history
    WHERE vendor_name=? AND process_type='디보싱' AND unit_price > 0
    GROUP BY unit_price ORDER BY unit_price
  `).all(VENDOR);

  for (var k = 0; k < debossingRows.length; k++) {
    var d = debossingRows[k];
    priceCount += insertPrice.run(VENDOR, '디보싱', 'per_unit', 'standard', '', d.unit_price, '2025-09', 'korea_pkg_excel', d.cnt + '건 거래').changes;
  }

})();

console.log('  ' + priceCount + '개 단가 등록됨');

// ─────────────────────────────────────────────
// 4. trade_doc_files 거래명세서 파일 기록
// ─────────────────────────────────────────────
console.log('\n=== 4. 거래명세서 파일 기록 ===');

var files = [
  { period: '2025-09', file: '코리아패키지_9월 바른컴퍼니.xlsx'          },
  { period: '2025-10', file: '코리아패키지_10월 (주)바른컴퍼니.xlsx'     },
  { period: '2025-11', file: '코리아패키지_11월 (주)바른컴퍼니.xlsx'     },
  { period: '2025-12', file: '코리아패키지_12월 바른컴퍼니.xlsx'         },
  { period: '2026-01', file: '코리아패키지_202601 바른컴퍼니.xlsx'       },
];

const insertFile = db.prepare(`
  INSERT OR IGNORE INTO trade_doc_files
    (vendor_name, period, file_name, total_amount, item_count, parsed_at, status)
  VALUES (?,?,?,?,?,datetime('now','localtime'),'parsed')
`);

db.transaction(function() {
  for (var i = 0; i < files.length; i++) {
    var f = files[i];
    var monthData   = data.filter(function(r) { return r.month === f.period; });
    var totalAmount = monthData.reduce(function(s, r) { return s + (r.amount || 0); }, 0);
    insertFile.run(VENDOR, f.period, f.file, totalAmount, monthData.length);
    console.log('  ' + f.period + ': ' + f.file + ' (' + monthData.length + '건, ' + totalAmount.toLocaleString() + '원)');
  }
})();

// ─────────────────────────────────────────────
// 5. 검증 출력
// ─────────────────────────────────────────────
console.log('\n=== 검증 ===');
console.log('post_process_history :', db.prepare('SELECT COUNT(*) AS c FROM post_process_history').get().c, '건');
console.log('product_process_map  :', db.prepare('SELECT COUNT(*) AS c FROM product_process_map').get().c, '건');
console.log('post_process_price   :', db.prepare('SELECT COUNT(*) AS c FROM post_process_price').get().c, '건');
console.log('trade_doc_files      :', db.prepare('SELECT COUNT(*) AS c FROM trade_doc_files').get().c, '건');

console.log('\n--- 공정별 집계 ---');
db.prepare(`
  SELECT process_type, COUNT(*) AS cnt, SUM(amount) AS total
  FROM post_process_history
  WHERE vendor_name=?
  GROUP BY process_type
  ORDER BY total DESC
`).all(VENDOR).forEach(function(row) {
  console.log('  ' + row.process_type + ': ' + row.cnt + '건, ' + (row.total || 0).toLocaleString() + '원');
});

console.log('\n--- 단가 변동 감지된 제품 (상위 10) ---');
db.prepare(`
  SELECT product_code, process_type,
         MIN(unit_price) AS min_p,
         MAX(unit_price) AS max_p,
         COUNT(DISTINCT unit_price) AS price_kinds
  FROM post_process_history
  WHERE vendor_name=? AND unit_price > 0
  GROUP BY product_code, process_type
  HAVING COUNT(DISTINCT unit_price) > 1
  ORDER BY (MAX(unit_price) - MIN(unit_price)) DESC
  LIMIT 10
`).all(VENDOR).forEach(function(row) {
  console.log('  ' + row.product_code + ' [' + row.process_type + ']: '
    + row.min_p.toLocaleString() + ' ~ ' + row.max_p.toLocaleString()
    + '원 (' + row.price_kinds + '종 단가)');
});

db.close();
console.log('\n임포트 완료!');
