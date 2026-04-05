// routes/report-engine.js — 동적 리포트 엔진 모듈
// 리포트 템플릿 관리, 동적 리포트 생성, CSV 내보내기, 드릴다운
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

/* ────────────────────────────────────────────
   테이블 초기화
   ──────────────────────────────────────────── */
function initTables() {
  const { db } = ctx;
  if (!db) return;

  db.exec(`CREATE TABLE IF NOT EXISTS report_templates (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    report_type TEXT NOT NULL,
    description TEXT DEFAULT '',
    config TEXT DEFAULT '{}',
    created_by TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS report_schedules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    template_id INTEGER,
    schedule_type TEXT DEFAULT 'manual',
    last_run TEXT,
    next_run TEXT,
    enabled INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_rpt_tmpl_type ON report_templates(report_type)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_rpt_sched_tmpl ON report_schedules(template_id)`);
}

/* ────────────────────────────────────────────
   인증 헬퍼
   ──────────────────────────────────────────── */
function auth(req, res) {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증이 필요합니다'); return null; }
  return decoded;
}

/* ────────────────────────────────────────────
   리포트 타입 정의
   ──────────────────────────────────────────── */
const REPORT_TYPES = [
  {
    type: 'purchase_summary', name: '매입 현황', description: '기간별 매입/입고 현황',
    filters: ['dateRange', 'vendor', 'origin'],
    columns: ['vendor_name', 'product_code', 'product_name', 'qty', 'unit_price', 'amount', 'date'],
    chartTypes: ['bar', 'pie', 'line'],
  },
  {
    type: 'sales_analysis', name: '매출 분석', description: '매출 데이터 분석',
    filters: ['dateRange', 'customer'],
    columns: ['date', 'customer_name', 'order_type', 'amount', 'qty', 'avg_price'],
    chartTypes: ['bar', 'line', 'area'],
  },
  {
    type: 'inventory_status', name: '재고 현황', description: '현재 재고 상태',
    filters: ['warehouse', 'product'],
    columns: ['product_code', 'product_name', 'warehouse_name', 'quantity', 'status'],
    chartTypes: ['bar', 'pie'],
  },
  {
    type: 'vendor_comparison', name: '거래처 비교', description: '거래처별 거래 비교',
    filters: ['dateRange', 'vendors'],
    columns: ['vendor_name', 'total_orders', 'total_qty', 'avg_lead_time'],
    chartTypes: ['bar', 'radar'],
  },
  {
    type: 'production_summary', name: '생산 현황', description: '생산실적/작업지시 현황',
    filters: ['dateRange', 'status'],
    columns: ['work_order_no', 'product_name', 'planned_qty', 'actual_qty', 'yield_rate', 'status'],
    chartTypes: ['bar', 'line'],
  },
  {
    type: 'financial_overview', name: '재무 개요', description: '자동분개 기반 계정별 차변/대변 요약',
    filters: ['dateRange', 'accountGroup'],
    columns: ['account', 'debit', 'credit', 'balance', 'tx_count'],
    chartTypes: ['bar', 'pie', 'line'],
  },
];

/* ────────────────────────────────────────────
   컬럼 메타데이터 (key → label, type)
   ──────────────────────────────────────────── */
const COLUMN_META = {
  vendor_name:    { label: '거래처명', type: 'string' },
  product_code:   { label: '제품코드', type: 'string' },
  product_name:   { label: '제품명', type: 'string' },
  qty:            { label: '수량', type: 'number' },
  unit_price:     { label: '단가', type: 'number' },
  amount:         { label: '금액', type: 'number' },
  date:           { label: '일자', type: 'date' },
  customer_name:  { label: '고객명', type: 'string' },
  order_type:     { label: '유형', type: 'string' },
  avg_price:      { label: '평균단가', type: 'number' },
  warehouse_name: { label: '창고', type: 'string' },
  quantity:       { label: '수량', type: 'number' },
  status:         { label: '상태', type: 'string' },
  total_orders:   { label: '총주문수', type: 'number' },
  total_amount:   { label: '총금액', type: 'number' },
  total_qty:      { label: '총수량', type: 'number' },
  avg_lead_time:  { label: '평균리드타임(일)', type: 'number' },
  work_order_no:  { label: '작업지시번호', type: 'string' },
  planned_qty:    { label: '계획수량', type: 'number' },
  actual_qty:     { label: '실적수량', type: 'number' },
  yield_rate:     { label: '수율(%)', type: 'number' },
  account:        { label: '계정과목', type: 'string' },
  debit:          { label: '차변', type: 'number' },
  credit:         { label: '대변', type: 'number' },
  balance:        { label: '잔액', type: 'number' },
  tx_count:       { label: '건수', type: 'number' },
};

/* ────────────────────────────────────────────
   SQL 인젝션 방지: 허용 컬럼 화이트리스트
   ──────────────────────────────────────────── */
const ALLOWED_COLUMNS = new Set([
  // 원시 컬럼
  'h.vendor_name', 'h.po_date', 'h.po_id', 'h.status', 'h.expected_date',
  'i.product_code', 'i.ordered_qty', 'i.received_qty',
  'p.product_name',
  'order_date', 'customer_name', 'order_type', 'status', 'total_amount', 'total_qty',
  'wi.product_code', 'wi.product_name', 'wi.quantity',
  'w.name', 'w.start_date', 'w.wo_number', 'w.product_name', 'w.ordered_qty', 'w.status',
  'j.created_at', 'j.debit_account', 'j.credit_account', 'j.amount',
  // 앨리어스 / 집계 결과
  'vendor_name', 'product_code', 'product_name', 'qty', 'unit_price', 'amount', 'date',
  'avg_price', 'warehouse_name', 'quantity',
  'total_orders', 'total_qty', 'avg_lead_time',
  'work_order_no', 'planned_qty', 'actual_qty', 'yield_rate',
  'account', 'debit', 'credit', 'balance', 'tx_count',
]);

const ALLOWED_DIRECTIONS = new Set(['ASC', 'DESC']);

/**
 * sortBy/groupBy 문자열을 화이트리스트에 대해 검증한다.
 * 유효하지 않은 토큰이 있으면 null을 반환 → 호출부에서 기본값 사용.
 */
function sanitizeSqlColumns(input, allowDirection) {
  if (!input || typeof input !== 'string') return null;

  const parts = input.split(',').map(s => s.trim()).filter(Boolean);
  if (parts.length === 0) return null;

  for (const part of parts) {
    const tokens = part.split(/\s+/);
    const col = tokens[0];
    if (!ALLOWED_COLUMNS.has(col)) return null;

    if (allowDirection && tokens.length > 1) {
      const dir = tokens[1].toUpperCase();
      if (!ALLOWED_DIRECTIONS.has(dir)) return null;
      if (tokens.length > 2) return null; // 추가 토큰 불허
    } else if (!allowDirection && tokens.length > 1) {
      return null;
    }
  }
  return input;
}

/* ────────────────────────────────────────────
   동적 쿼리 빌더
   ──────────────────────────────────────────── */

function buildPurchaseSummary(filters, groupBy, sortBy, limit) {
  let where = '1=1';
  const params = [];

  if (filters.dateFrom) { where += ' AND h.po_date >= ?'; params.push(filters.dateFrom); }
  if (filters.dateTo) { where += ' AND h.po_date <= ?'; params.push(filters.dateTo); }
  if (filters.vendor) { where += ' AND h.vendor_name LIKE ?'; params.push('%' + filters.vendor + '%'); }
  if (filters.origin) { where += ' AND h.origin = ?'; params.push(filters.origin); }

  const groupCol = sanitizeSqlColumns(groupBy, false) || 'h.vendor_name, i.product_code';
  const orderCol = sanitizeSqlColumns(sortBy, true) || 'qty DESC';
  const lim = Math.min(limit || 100, 5000);

  const sql = `
    SELECT h.vendor_name, i.product_code, COALESCE(p.product_name, i.product_code) AS product_name,
           SUM(i.ordered_qty) AS qty, 0 AS unit_price,
           0 AS amount,
           h.po_date AS date
    FROM po_header h JOIN po_items i ON h.po_id = i.po_id
    LEFT JOIN products p ON p.product_code = i.product_code
    WHERE ${where}
    GROUP BY ${groupCol}
    ORDER BY ${orderCol}
    LIMIT ?
  `;
  params.push(lim);
  return { sql, params };
}

function buildSalesAnalysis(filters, groupBy, sortBy, limit) {
  let where = '1=1';
  const params = [];

  if (filters.dateFrom) { where += ' AND order_date >= ?'; params.push(filters.dateFrom); }
  if (filters.dateTo) { where += ' AND order_date <= ?'; params.push(filters.dateTo); }
  if (filters.customer) { where += ' AND customer_name LIKE ?'; params.push('%' + filters.customer + '%'); }
  if (filters.status) { where += ' AND status = ?'; params.push(filters.status); }

  const groupCol = sanitizeSqlColumns(groupBy, false) || 'order_date, customer_name';
  const orderCol = sanitizeSqlColumns(sortBy, true) || 'amount DESC';
  const lim = Math.min(limit || 100, 5000);

  const sql = `
    SELECT order_date AS date, customer_name, order_type AS type, status,
           SUM(total_amount) AS amount, SUM(total_qty) AS qty,
           CASE WHEN SUM(total_qty) > 0 THEN ROUND(SUM(total_amount) * 1.0 / SUM(total_qty), 0) ELSE 0 END AS avg_price
    FROM sales_orders
    WHERE ${where}
    GROUP BY ${groupCol}
    ORDER BY ${orderCol}
    LIMIT ?
  `;
  params.push(lim);
  return { sql, params };
}

function buildInventoryStatus(filters, groupBy, sortBy, limit) {
  let where = '1=1';
  const params = [];

  if (filters.warehouse) { where += ' AND w.name LIKE ?'; params.push('%' + filters.warehouse + '%'); }
  if (filters.product) { where += ' AND (wi.product_code LIKE ? OR wi.product_name LIKE ?)'; params.push('%' + filters.product + '%', '%' + filters.product + '%'); }

  const orderCol = sanitizeSqlColumns(sortBy, true) || 'wi.product_code ASC';
  const lim = Math.min(limit || 100, 5000);

  const sql = `
    SELECT wi.product_code, wi.product_name, COALESCE(w.name, '미지정') AS warehouse_name,
           wi.quantity,
           CASE
             WHEN wi.quantity <= 0 THEN '품절'
             WHEN wi.quantity < 10 THEN '부족'
             ELSE '정상'
           END AS status
    FROM warehouse_inventory wi
    LEFT JOIN warehouses w ON w.id = wi.warehouse_id
    WHERE ${where}
    ORDER BY ${orderCol}
    LIMIT ?
  `;
  params.push(lim);
  return { sql, params };
}

function buildVendorComparison(filters, groupBy, sortBy, limit) {
  let where = '1=1';
  const params = [];

  if (filters.dateFrom) { where += ' AND h.po_date >= ?'; params.push(filters.dateFrom); }
  if (filters.dateTo) { where += ' AND h.po_date <= ?'; params.push(filters.dateTo); }
  if (filters.vendors) {
    const vendorList = Array.isArray(filters.vendors) ? filters.vendors : [filters.vendors];
    if (vendorList.length > 0) {
      where += ' AND h.vendor_name IN (' + vendorList.map(() => '?').join(',') + ')';
      params.push(...vendorList);
    }
  }

  const orderCol = sanitizeSqlColumns(sortBy, true) || 'total_orders DESC';
  const lim = Math.min(limit || 100, 5000);

  const sql = `
    SELECT h.vendor_name,
           COUNT(DISTINCT h.po_id) AS total_orders,
           SUM(i.ordered_qty) AS total_qty,
           ROUND(AVG(CASE WHEN h.expected_date IS NOT NULL THEN JULIANDAY(h.expected_date) - JULIANDAY(h.po_date) ELSE NULL END), 1) AS avg_lead_time
    FROM po_header h LEFT JOIN po_items i ON h.po_id = i.po_id
    WHERE ${where}
    GROUP BY h.vendor_name
    ORDER BY ${orderCol}
    LIMIT ?
  `;
  params.push(lim);
  return { sql, params };
}

function buildProductionSummary(filters, groupBy, sortBy, limit) {
  let where = '1=1';
  const params = [];

  if (filters.dateFrom) { where += ' AND w.start_date >= ?'; params.push(filters.dateFrom); }
  if (filters.dateTo) { where += ' AND w.start_date <= ?'; params.push(filters.dateTo); }
  if (filters.status) { where += ' AND w.status = ?'; params.push(filters.status); }

  const orderCol = sanitizeSqlColumns(sortBy, true) || 'w.start_date DESC';
  const lim = Math.min(limit || 100, 5000);

  const sql = `
    SELECT w.wo_number AS work_order_no, w.product_name,
           w.ordered_qty AS planned_qty,
           COALESCE(r.good_total, 0) AS actual_qty,
           CASE WHEN w.ordered_qty > 0
                THEN ROUND(COALESCE(r.good_total, 0) * 100.0 / w.ordered_qty, 1)
                ELSE 0 END AS yield_rate,
           w.status
    FROM work_orders w
    LEFT JOIN (
      SELECT work_order_id, SUM(good_qty) AS good_total
      FROM work_order_results
      GROUP BY work_order_id
    ) r ON w.wo_id = r.work_order_id
    WHERE ${where}
    ORDER BY ${orderCol}
    LIMIT ?
  `;
  params.push(lim);
  return { sql, params };
}

function buildFinancialOverview(filters, groupBy, sortBy, limit) {
  let where = "j.status = 'created'";
  const whereParams = [];

  if (filters.dateFrom) { where += ' AND j.created_at >= ?'; whereParams.push(filters.dateFrom); }
  if (filters.dateTo) { where += ' AND j.created_at <= ?'; whereParams.push(filters.dateTo + ' 23:59:59'); }
  if (filters.accountGroup) { where += ' AND (j.debit_account LIKE ? OR j.credit_account LIKE ?)'; whereParams.push('%' + filters.accountGroup + '%', '%' + filters.accountGroup + '%'); }

  const lim = Math.min(limit || 100, 5000);

  const sql = `
    SELECT account,
           SUM(debit) AS debit,
           SUM(credit) AS credit,
           SUM(debit) - SUM(credit) AS balance,
           COUNT(*) AS tx_count
    FROM (
      SELECT j.debit_account AS account, j.amount AS debit, 0 AS credit
      FROM journal_auto_log j WHERE ${where}
      UNION ALL
      SELECT j.credit_account AS account, 0 AS debit, j.amount AS credit
      FROM journal_auto_log j WHERE ${where}
    )
    GROUP BY account
    ORDER BY ${sanitizeSqlColumns(sortBy, true) || 'balance DESC'}
    LIMIT ?
  `;
  const params = [...whereParams, ...whereParams, lim];
  return { sql, params };
}

/* ────────────────────────────────────────────
   쿼리 빌더 매핑
   ──────────────────────────────────────────── */
const QUERY_BUILDERS = {
  purchase_summary: buildPurchaseSummary,
  sales_analysis: buildSalesAnalysis,
  inventory_status: buildInventoryStatus,
  vendor_comparison: buildVendorComparison,
  production_summary: buildProductionSummary,
  financial_overview: buildFinancialOverview,
};

/* ────────────────────────────────────────────
   요약 계산 헬퍼
   ──────────────────────────────────────────── */
function computeSummary(rows, reportType) {
  const totals = {};
  const typeDef = REPORT_TYPES.find(t => t.type === reportType);
  if (!typeDef || rows.length === 0) return { totalRows: rows.length, totals };

  for (const col of typeDef.columns) {
    const meta = COLUMN_META[col];
    if (meta && meta.type === 'number') {
      let sum = 0;
      for (const row of rows) {
        const v = Number(row[col]);
        if (!isNaN(v)) sum += v;
      }
      totals[col] = Math.round(sum * 100) / 100;
    }
  }
  return { totalRows: rows.length, totals };
}

/* ────────────────────────────────────────────
   차트 데이터 빌더
   ──────────────────────────────────────────── */
function buildChartData(rows, reportType) {
  if (rows.length === 0) return null;

  const typeDef = REPORT_TYPES.find(t => t.type === reportType);
  if (!typeDef) return null;

  // 라벨 컬럼: 첫 번째 string 컬럼
  const labelCol = typeDef.columns.find(c => {
    const m = COLUMN_META[c];
    return m && (m.type === 'string' || m.type === 'date');
  });
  // 값 컬럼: 첫 번째 number 컬럼 (amount 우선)
  const valueCol = typeDef.columns.includes('amount') ? 'amount'
    : typeDef.columns.includes('total_amount') ? 'total_amount'
    : typeDef.columns.find(c => { const m = COLUMN_META[c]; return m && m.type === 'number'; });

  if (!labelCol || !valueCol) return null;

  const top = rows.slice(0, 20); // 차트는 상위 20개
  return {
    labels: top.map(r => r[labelCol] || ''),
    datasets: [{
      label: (COLUMN_META[valueCol] || {}).label || valueCol,
      data: top.map(r => Number(r[valueCol]) || 0),
    }],
  };
}

/* ────────────────────────────────────────────
   CSV 변환 헬퍼
   ──────────────────────────────────────────── */
function rowsToCsv(rows, columns) {
  if (rows.length === 0) return '';

  const cols = columns || Object.keys(rows[0]);
  const headers = cols.map(c => {
    const meta = COLUMN_META[c];
    return meta ? meta.label : c;
  });

  const escapeCsv = (val) => {
    if (val == null) return '';
    const s = String(val);
    if (s.includes(',') || s.includes('"') || s.includes('\n')) {
      return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
  };

  const lines = [headers.map(escapeCsv).join(',')];
  for (const row of rows) {
    lines.push(cols.map(c => escapeCsv(row[c])).join(','));
  }
  return '\uFEFF' + lines.join('\r\n');
}

/* ────────────────────────────────────────────
   드릴다운 쿼리 빌더
   ──────────────────────────────────────────── */
function buildDrillDown(type, rowKey, rowValue, filters) {
  const params = [];
  let sql = '';

  switch (type) {
    case 'purchase_summary': {
      let where = '1=1';
      if (rowKey === 'vendor_name') { where += ' AND h.vendor_name = ?'; params.push(rowValue); }
      if (rowKey === 'product_code') { where += ' AND i.product_code = ?'; params.push(rowValue); }
      if (filters.dateFrom) { where += ' AND h.po_date >= ?'; params.push(filters.dateFrom); }
      if (filters.dateTo) { where += ' AND h.po_date <= ?'; params.push(filters.dateTo); }
      sql = `
        SELECT h.po_id, h.po_number, h.po_date, h.vendor_name, h.status,
               i.product_code, COALESCE(p.product_name, i.product_code) AS product_name,
               i.ordered_qty, i.received_qty
        FROM po_header h JOIN po_items i ON h.po_id = i.po_id
        LEFT JOIN products p ON p.product_code = i.product_code
        WHERE ${where}
        ORDER BY h.po_date DESC LIMIT 200
      `;
      break;
    }
    case 'sales_analysis': {
      let where = '1=1';
      if (rowKey === 'customer_name') { where += ' AND customer_name = ?'; params.push(rowValue); }
      if (rowKey === 'date') { where += ' AND order_date = ?'; params.push(rowValue); }
      if (filters.dateFrom) { where += ' AND order_date >= ?'; params.push(filters.dateFrom); }
      if (filters.dateTo) { where += ' AND order_date <= ?'; params.push(filters.dateTo); }
      sql = `
        SELECT id, order_no, order_date, order_type, status, total_qty, total_amount, customer_name
        FROM sales_orders
        WHERE ${where}
        ORDER BY order_date DESC LIMIT 200
      `;
      break;
    }
    case 'inventory_status': {
      let where = '1=1';
      if (rowKey === 'product_code') { where += ' AND wi.product_code = ?'; params.push(rowValue); }
      if (rowKey === 'warehouse_name') { where += ' AND w.name = ?'; params.push(rowValue); }
      sql = `
        SELECT wi.id, wi.product_code, wi.product_name, COALESCE(w.name, '미지정') AS warehouse_name,
               wi.quantity, wi.memo, wi.updated_at
        FROM warehouse_inventory wi
        LEFT JOIN warehouses w ON w.id = wi.warehouse_id
        WHERE ${where}
        ORDER BY wi.product_code LIMIT 200
      `;
      break;
    }
    case 'vendor_comparison': {
      let where = 'h.vendor_name = ?';
      params.push(rowValue);
      if (filters.dateFrom) { where += ' AND h.po_date >= ?'; params.push(filters.dateFrom); }
      if (filters.dateTo) { where += ' AND h.po_date <= ?'; params.push(filters.dateTo); }
      sql = `
        SELECT h.po_id, h.po_number, h.po_date, h.status, h.expected_date,
               SUM(i.ordered_qty) AS total_qty
        FROM po_header h LEFT JOIN po_items i ON h.po_id = i.po_id
        WHERE ${where}
        GROUP BY h.po_id
        ORDER BY h.po_date DESC LIMIT 200
      `;
      break;
    }
    case 'production_summary': {
      let where = '1=1';
      if (rowKey === 'work_order_no') { where += ' AND w.wo_number = ?'; params.push(rowValue); }
      if (rowKey === 'status') { where += ' AND w.status = ?'; params.push(rowValue); }
      sql = `
        SELECT w.wo_id, w.wo_number, w.product_code, w.product_name, w.ordered_qty, w.status, w.start_date,
               r.good_qty AS result_qty, r.result_date
        FROM work_orders w
        LEFT JOIN work_order_results r ON w.wo_id = r.work_order_id
        WHERE ${where}
        ORDER BY w.start_date DESC LIMIT 200
      `;
      break;
    }
    case 'financial_overview': {
      let where = "status = 'created'";
      if (rowKey === 'account') { where += ' AND (debit_account = ? OR credit_account = ?)'; params.push(rowValue, rowValue); }
      if (filters.dateFrom) { where += ' AND created_at >= ?'; params.push(filters.dateFrom); }
      if (filters.dateTo) { where += ' AND created_at <= ?'; params.push(filters.dateTo + ' 23:59:59'); }
      sql = `
        SELECT id, created_at, event_type, ref_number, debit_account, credit_account, amount
        FROM journal_auto_log
        WHERE ${where}
        ORDER BY created_at DESC LIMIT 200
      `;
      break;
    }
    default:
      return null;
  }

  return { sql, params };
}

/* ════════════════════════════════════════════
   API 라우트
   ════════════════════════════════════════════ */

/* ────────────────────────────────────────────
   1. GET /api/report-engine/types — 리포트 타입 목록
   ──────────────────────────────────────────── */
router.get('/api/report-engine/types', async (req, res) => {
  if (!auth(req, res)) return;
  ctx.ok(res, REPORT_TYPES);
});

/* ────────────────────────────────────────────
   2. POST /api/report-engine/generate — 동적 리포트 생성
   Body: { type, filters, groupBy, sortBy, limit }
   ──────────────────────────────────────────── */
router.post('/api/report-engine/generate', async (req, res) => {
  const decoded = auth(req, res);
  if (!decoded) return;

  try {
    const body = await ctx.readJSON(req);
    const { type, filters = {}, groupBy, sortBy, limit } = body;

    if (!type) {
      ctx.fail(res, 400, 'type은 필수입니다');
      return;
    }

    const builder = QUERY_BUILDERS[type];
    if (!builder) {
      ctx.fail(res, 400, '지원하지 않는 리포트 타입: ' + type);
      return;
    }

    const typeDef = REPORT_TYPES.find(t => t.type === type);
    const { sql, params } = builder(filters, groupBy, sortBy, limit);

    let rows = [];
    try {
      rows = ctx.db.prepare(sql).all(...params);
    } catch (e) {
      // 테이블이 없을 수 있음
      ctx.fail(res, 400, '쿼리 실행 실패: ' + e.message);
      return;
    }

    const columns = (typeDef ? typeDef.columns : Object.keys(rows[0] || {})).map(key => ({
      key,
      label: (COLUMN_META[key] || {}).label || key,
      type: (COLUMN_META[key] || {}).type || 'string',
    }));

    const summary = computeSummary(rows, type);
    const chartData = buildChartData(rows, type);

    ctx.ok(res, { columns, rows, summary, chartData });
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

/* ────────────────────────────────────────────
   3. GET /api/report-engine/templates — 템플릿 목록
   ──────────────────────────────────────────── */
router.get('/api/report-engine/templates', async (req, res) => {
  if (!auth(req, res)) return;

  try {
    const rows = ctx.db.prepare(
      'SELECT * FROM report_templates ORDER BY updated_at DESC'
    ).all();

    // config JSON 파싱
    const items = rows.map(r => {
      let config = {};
      try { config = JSON.parse(r.config || '{}'); } catch (_) {}
      return { ...r, config };
    });

    ctx.ok(res, items);
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

/* ────────────────────────────────────────────
   4. POST /api/report-engine/templates — 템플릿 저장
   Body: { name, report_type, description, config }
   ──────────────────────────────────────────── */
router.post('/api/report-engine/templates', async (req, res) => {
  const decoded = auth(req, res);
  if (!decoded) return;

  try {
    const body = await ctx.readJSON(req);
    const { name, report_type, description, config } = body;

    if (!name || !report_type) {
      ctx.fail(res, 400, 'name과 report_type은 필수입니다');
      return;
    }

    const validType = REPORT_TYPES.find(t => t.type === report_type);
    if (!validType) {
      ctx.fail(res, 400, '지원하지 않는 리포트 타입: ' + report_type);
      return;
    }

    const configJson = JSON.stringify(config || {});
    const createdBy = decoded.name || decoded.email || '';

    const info = ctx.db.prepare(`
      INSERT INTO report_templates (name, report_type, description, config, created_by)
      VALUES (?, ?, ?, ?, ?)
    `).run(name, report_type, description || '', configJson, createdBy);

    ctx.ok(res, {
      id: Number(info.lastInsertRowid),
      message: '템플릿이 저장되었습니다',
    });
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

/* ────────────────────────────────────────────
   5. PUT /api/report-engine/templates/:id — 템플릿 수정
   ──────────────────────────────────────────── */
router.putP(/^\/api\/report-engine\/templates\/(\d+)$/, async (req, res, parsed, match) => {
  const decoded = auth(req, res);
  if (!decoded) return;

  try {
    const id = parseInt(match[1], 10);
    const body = await ctx.readJSON(req);
    const { name, report_type, description, config } = body;

    const existing = ctx.db.prepare('SELECT id FROM report_templates WHERE id = ?').get(id);
    if (!existing) {
      ctx.fail(res, 404, '템플릿을 찾을 수 없습니다');
      return;
    }

    if (report_type) {
      const validType = REPORT_TYPES.find(t => t.type === report_type);
      if (!validType) {
        ctx.fail(res, 400, '지원하지 않는 리포트 타입: ' + report_type);
        return;
      }
    }

    // 동적 UPDATE 빌드
    const sets = [];
    const params = [];

    if (name !== undefined) { sets.push('name = ?'); params.push(name); }
    if (report_type !== undefined) { sets.push('report_type = ?'); params.push(report_type); }
    if (description !== undefined) { sets.push('description = ?'); params.push(description); }
    if (config !== undefined) { sets.push('config = ?'); params.push(JSON.stringify(config)); }
    sets.push("updated_at = datetime('now','localtime')");

    if (sets.length === 1) {
      // updated_at만 있으면 변경할 내용 없음
      ctx.fail(res, 400, '변경할 내용이 없습니다');
      return;
    }

    params.push(id);
    ctx.db.prepare(`UPDATE report_templates SET ${sets.join(', ')} WHERE id = ?`).run(...params);

    ctx.ok(res, { id, message: '템플릿이 수정되었습니다' });
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

/* ────────────────────────────────────────────
   6. DELETE /api/report-engine/templates/:id — 템플릿 삭제
   ──────────────────────────────────────────── */
router.delP(/^\/api\/report-engine\/templates\/(\d+)$/, async (req, res, parsed, match) => {
  if (!auth(req, res)) return;

  try {
    const id = parseInt(match[1], 10);

    const existing = ctx.db.prepare('SELECT id FROM report_templates WHERE id = ?').get(id);
    if (!existing) {
      ctx.fail(res, 404, '템플릿을 찾을 수 없습니다');
      return;
    }

    ctx.db.prepare('DELETE FROM report_templates WHERE id = ?').run(id);
    // 연관 스케줄도 삭제
    try {
      ctx.db.prepare('DELETE FROM report_schedules WHERE template_id = ?').run(id);
    } catch (_) {}

    ctx.ok(res, { id, message: '템플릿이 삭제되었습니다' });
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

/* ────────────────────────────────────────────
   7. POST /api/report-engine/export-csv — CSV 내보내기
   Body: { type, filters, groupBy, sortBy, limit }
   ──────────────────────────────────────────── */
router.post('/api/report-engine/export-csv', async (req, res) => {
  const decoded = auth(req, res);
  if (!decoded) return;

  try {
    const body = await ctx.readJSON(req);
    const { type, filters = {}, groupBy, sortBy, limit } = body;

    if (!type) {
      ctx.fail(res, 400, 'type은 필수입니다');
      return;
    }

    const builder = QUERY_BUILDERS[type];
    if (!builder) {
      ctx.fail(res, 400, '지원하지 않는 리포트 타입: ' + type);
      return;
    }

    const typeDef = REPORT_TYPES.find(t => t.type === type);
    const { sql, params } = builder(filters, groupBy, sortBy, limit);

    let rows = [];
    try {
      rows = ctx.db.prepare(sql).all(...params);
    } catch (e) {
      ctx.fail(res, 400, '쿼리 실행 실패: ' + e.message);
      return;
    }

    const columns = typeDef ? typeDef.columns : Object.keys(rows[0] || {});
    const csv = rowsToCsv(rows, columns);

    const now = new Date().toISOString().slice(0, 10);
    const filename = `report_${type}_${now}.csv`;

    res.writeHead(200, {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    });
    res.end(csv);
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

/* ────────────────────────────────────────────
   8. POST /api/report-engine/drill-down — 드릴다운 상세
   Body: { type, row_key, row_value, filters }
   ──────────────────────────────────────────── */
router.post('/api/report-engine/drill-down', async (req, res) => {
  const decoded = auth(req, res);
  if (!decoded) return;

  try {
    const body = await ctx.readJSON(req);
    const { type, row_key, row_value, filters = {} } = body;

    if (!type || !row_key || row_value === undefined) {
      ctx.fail(res, 400, 'type, row_key, row_value는 필수입니다');
      return;
    }

    const query = buildDrillDown(type, row_key, row_value, filters);
    if (!query) {
      ctx.fail(res, 400, '지원하지 않는 드릴다운 타입: ' + type);
      return;
    }

    let rows = [];
    try {
      rows = ctx.db.prepare(query.sql).all(...query.params);
    } catch (e) {
      ctx.fail(res, 400, '드릴다운 쿼리 실행 실패: ' + e.message);
      return;
    }

    ctx.ok(res, {
      type,
      row_key,
      row_value,
      totalRows: rows.length,
      rows,
    });
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

module.exports = { router, initTables };
