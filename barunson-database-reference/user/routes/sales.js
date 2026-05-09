// routes/sales.js — 매출/출고/주문이력/DD/배송 라우트
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ── 모듈 로컬 캐시 ───────────────────────────────────────────────────
let salesKpiCache = null, salesKpiCacheTime = 0;
const SALES_CACHE_TTL = 30 * 60 * 1000; // 30분

// ── 헬퍼 ─────────────────────────────────────────────────────────────

async function withBarShop1Pool(callback) {
  let pool = null;
  try {
    pool = new ctx.sql.ConnectionPool(ctx.barShopConfig);
    await pool.connect();
    return await callback(pool);
  } finally {
    if (pool) { try { await pool.close(); } catch (_) {} }
  }
}

function toYMD(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

function getMonthChunks(startYMD, endYMD) {
  const chunks = [];
  const sy = parseInt(startYMD.slice(0, 4)), sm = parseInt(startYMD.slice(4, 6)) - 1;
  const ey = parseInt(endYMD.slice(0, 4)), em = parseInt(endYMD.slice(4, 6)) - 1, ed = parseInt(endYMD.slice(6, 8));
  let cur = new Date(sy, sm, 1);
  const endDate = new Date(ey, em, ed);
  while (cur <= endDate) {
    const mStart = toYMD(cur);
    const lastDay = new Date(cur.getFullYear(), cur.getMonth() + 1, 0);
    const mEnd = toYMD(lastDay);
    chunks.push({ start: mStart < startYMD ? startYMD : mStart, end: mEnd > endYMD ? endYMD : mEnd });
    cur = new Date(cur.getFullYear(), cur.getMonth() + 1, 1);
  }
  return chunks;
}

async function queryXerpSales(pool, startYMD, endYMD) {
  const r = await pool.request()
    .input('startDate', ctx.sql.NVarChar(16), startYMD)
    .input('endDate', ctx.sql.NVarChar(16), endYMD)
    .query(`SELECT COUNT(DISTINCT h_orderid) AS order_count,
                   ISNULL(SUM(h_sumPrice),0) AS total_sales,
                   ISNULL(SUM(h_offerPrice),0) AS total_supply,
                   ISNULL(SUM(h_superTax),0) AS total_vat,
                   ISNULL(SUM(FeeAmnt),0) AS total_fee
            FROM ERP_SalesData WITH (NOLOCK)
            WHERE h_date >= @startDate AND h_date <= @endDate`);
  return r.recordset[0] || { order_count: 0, total_sales: 0, total_supply: 0, total_vat: 0, total_fee: 0 };
}

async function queryDdSales(pool, startDate, endDate) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS order_count, IFNULL(SUM(paid_money),0) AS total_sales
     FROM orders WHERE created_at >= ? AND created_at < ? AND order_state != 'C'`,
    [startDate, endDate]);
  return rows[0] || { order_count: 0, total_sales: 0 };
}

async function queryGiftSales(pool, startYMD, endYMD) {
  const giftSets = await ctx.db.prepare("SELECT xerp_code, set_name FROM gift_sets WHERE status='active' AND xerp_code != ''").all();
  if (!giftSets.length) return { order_count: 0, total_sales: 0, total_qty: 0, items: 0 };
  const xerpCodes = giftSets.map(g => g.xerp_code.trim()).filter(Boolean);
  if (!xerpCodes.length) return { order_count: 0, total_sales: 0, total_qty: 0, items: 0 };
  const req = pool.request();
  req.input('startDate', ctx.sql.NVarChar(16), startYMD);
  req.input('endDate', ctx.sql.NVarChar(16), endYMD);
  const placeholders = (await Promise.all(xerpCodes.map(async (c, i) => { req.input(`gc${i}`, ctx.sql.VarChar(50), c); return `@gc${i}`; }))).join(',');
  const r = await req.query(`
    SELECT COUNT(DISTINCT InoutNo) AS order_count,
           ISNULL(SUM(InoutAmnt),0) AS total_sales,
           ISNULL(SUM(InoutQty),0) AS total_qty,
           COUNT(DISTINCT RTRIM(ItemCode)) AS items
    FROM mmInoutItem WITH (NOLOCK)
    WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND InoutGubun='SO'
      AND InoutDate >= @startDate AND InoutDate <= @endDate
      AND RTRIM(ItemCode) IN (${placeholders})`);
  const row = r.recordset[0] || {};
  return { order_count: row.order_count || 0, total_sales: Number(row.total_sales || 0), total_qty: Number(row.total_qty || 0), items: row.items || 0 };
}

async function queryGiftDailySales(pool, startYMD, endYMD) {
  const giftSets = await ctx.db.prepare("SELECT xerp_code FROM gift_sets WHERE status='active' AND xerp_code != ''").all();
  const xerpCodes = giftSets.map(g => g.xerp_code.trim()).filter(Boolean);
  if (!xerpCodes.length) return [];
  const req = pool.request();
  req.input('startDate', ctx.sql.NVarChar(16), startYMD);
  req.input('endDate', ctx.sql.NVarChar(16), endYMD);
  const placeholders = (await Promise.all(xerpCodes.map(async (c, i) => { req.input(`gc${i}`, ctx.sql.VarChar(50), c); return `@gc${i}`; }))).join(',');
  const r = await req.query(`
    SELECT RTRIM(InoutDate) AS inout_date,
           COUNT(DISTINCT InoutNo) AS order_count,
           ISNULL(SUM(InoutAmnt),0) AS total_sales,
           ISNULL(SUM(InoutQty),0) AS total_qty
    FROM mmInoutItem WITH (NOLOCK)
    WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND InoutGubun='SO'
      AND InoutDate >= @startDate AND InoutDate <= @endDate
      AND RTRIM(ItemCode) IN (${placeholders})
    GROUP BY RTRIM(InoutDate) ORDER BY RTRIM(InoutDate)`);
  return r.recordset.map(row => ({
    date: (row.inout_date || '').trim(),
    sales: Number(row.total_sales || 0),
    orders: row.order_count || 0,
    qty: Number(row.total_qty || 0)
  }));
}

async function queryGiftProductSales(pool, startYMD, endYMD) {
  const giftSets = await ctx.db.prepare("SELECT xerp_code, set_name FROM gift_sets WHERE status='active' AND xerp_code != ''").all();
  const xerpCodes = giftSets.map(g => g.xerp_code.trim()).filter(Boolean);
  if (!xerpCodes.length) return [];
  const codeNameMap = {};
  giftSets.forEach(g => { codeNameMap[g.xerp_code.trim()] = g.set_name; });
  const req = pool.request();
  req.input('startDate', ctx.sql.NVarChar(16), startYMD);
  req.input('endDate', ctx.sql.NVarChar(16), endYMD);
  const placeholders = (await Promise.all(xerpCodes.map(async (c, i) => { req.input(`gc${i}`, ctx.sql.VarChar(50), c); return `@gc${i}`; }))).join(',');
  const r = await req.query(`
    SELECT RTRIM(ItemCode) AS item_code, RTRIM(ItemName) AS item_name,
           COUNT(DISTINCT InoutNo) AS order_count,
           ISNULL(SUM(InoutAmnt),0) AS total_sales,
           ISNULL(SUM(InoutQty),0) AS total_qty
    FROM mmInoutItem WITH (NOLOCK)
    WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND InoutGubun='SO'
      AND InoutDate >= @startDate AND InoutDate <= @endDate
      AND RTRIM(ItemCode) IN (${placeholders})
    GROUP BY RTRIM(ItemCode), RTRIM(ItemName)
    ORDER BY SUM(InoutAmnt) DESC`);
  return r.recordset.map((row, i) => ({
    rank: i + 1,
    code: (row.item_code || '').trim(),
    name: codeNameMap[(row.item_code || '').trim()] || (row.item_name || '').trim(),
    sales: Number(row.total_sales || 0),
    orders: row.order_count || 0,
    qty: Number(row.total_qty || 0)
  }));
}

// ════════════════════════════════════════════════════════════════════
//  SHIPMENTS (출고현황 - XERP 실시간 조회)
// ════════════════════════════════════════════════════════════════════

router.get('/api/shipments', async (req, res, parsed) => {
  const { ok, fail } = ctx;
  const xerpPool = await ctx.ensureXerpPool();
  if (!xerpPool) { fail(res, 503, 'XERP 데이터베이스 미연결 (재연결 시도 중)'); return; }
  try {
    const qFrom = parsed.searchParams.get('from');
    const qTo = parsed.searchParams.get('to');
    const qGubun = parsed.searchParams.get('gubun');

    const today = new Date();
    const fmt = d => d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
    const todayStr = fmt(today);

    let startStr = qFrom || (() => { const d = new Date(today); d.setMonth(d.getMonth() - 1); return fmt(d); })();
    let endStr = qTo || fmt(today);
    const endNext = new Date(parseInt(endStr.slice(0,4)), parseInt(endStr.slice(4,6))-1, parseInt(endStr.slice(6,8))+1);
    const endNextStr = fmt(endNext);

    const gubunList = qGubun ? qGubun.split(',').map(g => g.trim()) : ['SO','MO','SI','MI'];
    const gubunPlaceholders = gubunList.map((_, i) => `@gb${i}`).join(',');

    const xReq = xerpPool.request()
      .input('startDate', ctx.sql.NChar(16), startStr)
      .input('endDate', ctx.sql.NChar(16), endNextStr);
    gubunList.forEach((g, i) => xReq.input(`gb${i}`, ctx.sql.VarChar(4), g));

    const result = await xReq.query(`
      SELECT RTRIM(ItemCode) AS item_code, MAX(RTRIM(ItemName)) AS item_name,
             RTRIM(InoutDate) AS InoutDate, RTRIM(InoutGubun) AS gubun,
             SUM(InoutQty) AS qty, SUM(InoutAmnt) AS amnt
      FROM mmInoutItem WITH (NOLOCK)
      WHERE SiteCode = '${ctx.XERP_SITE_CODE}'
        AND InoutGubun IN (${gubunPlaceholders})
        AND InoutDate >= @startDate AND InoutDate < @endDate
      GROUP BY RTRIM(ItemCode), RTRIM(InoutDate), RTRIM(InoutGubun)
      ORDER BY RTRIM(InoutDate) DESC, RTRIM(ItemCode)
    `);

    // bar_shop1에서 품목명 매핑 가져오기 (별도 연결)
    let itemNames = {};
    try {
      const bar1Pool = new ctx.sql.ConnectionPool(ctx.barShopConfig);
      await bar1Pool.connect();
      const itemCodes = [...new Set(result.recordset.map(r => (r.item_code || '').trim()).filter(Boolean))];
      if (itemCodes.length) {
        for (let i = 0; i < itemCodes.length; i += 500) {
          const batch = itemCodes.slice(i, i + 500);
          const placeholders = batch.map((_, j) => `@c${i+j}`).join(',');
          const nameReq = bar1Pool.request();
          batch.forEach((c, j) => nameReq.input(`c${i+j}`, ctx.sql.VarChar(30), c));
          const nameResult = await nameReq.query(`SELECT Card_Code, Card_Name FROM S2_Card WHERE Card_Code IN (${placeholders})`);
          nameResult.recordset.forEach(r => { itemNames[(r.Card_Code || '').trim()] = (r.Card_Name || '').trim(); });
        }
      }
      await bar1Pool.close();
    } catch (nameErr) {
      console.warn('품목명 조회 실패:', nameErr.message);
    }

    const gubunLabel = { SO: '매출출고', SI: '매출입고(반품)', MO: '원자재출고', MI: '원자재입고' };
    const rows = [];
    for (const row of result.recordset) {
      const dateStr = (row.InoutDate || '').trim();
      const code = (row.item_code || '').trim();
      rows.push({
        item_code: code,
        item_name: itemNames[code] || (row.item_name || '').trim(),
        date: dateStr ? `${dateStr.slice(0,4)}-${dateStr.slice(4,6)}-${dateStr.slice(6,8)}` : '',
        gubun: row.gubun || 'SO',
        gubun_label: gubunLabel[row.gubun] || row.gubun,
        qty: row.qty || 0,
        amnt: row.amnt || 0
      });
    }

    const summary = {};
    for (const g of ['SO','MO','SI','MI']) {
      const items = rows.filter(r => r.gubun === g);
      summary[g] = { label: gubunLabel[g], count: items.length, totalQty: items.reduce((s,r) => s + r.qty, 0), totalAmnt: items.reduce((s,r) => s + r.amnt, 0) };
    }

    ok(res, { rows, summary, range: { start: startStr, end: endStr, today: todayStr } });
  } catch (e) {
    console.error('출고현황 조회 오류:', e.message);
    fail(res, 500, '출고현황 조회 오류: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  GET /api/purchases — 월별 업체별 품목별 매입 집계
// ════════════════════════════════════════════════════════════════════

router.get('/api/purchases', async (req, res, parsed) => {
  const { ok } = ctx;
  const year = parsed.searchParams.get('year') || new Date().getFullYear().toString();
  const rows = await ctx.db.prepare(`
    SELECT i.vendor_name, ii.product_code, ii.product_name,
           substr(i.invoice_date, 6, 2) as month,
           SUM(ii.qty) as total_qty, SUM(ii.amount) as total_amount
    FROM invoices i
    JOIN invoice_items ii ON i.invoice_id = ii.invoice_id
    WHERE substr(i.invoice_date, 1, 4) = ?
    GROUP BY i.vendor_name, ii.product_code, substr(i.invoice_date, 6, 2)
    ORDER BY i.vendor_name, ii.product_code, month
  `).all(year);
  ok(res, rows);
});

// ════════════════════════════════════════════════════════════════════
//  VENDOR NOTES (미팅일지/특이사항)
// ════════════════════════════════════════════════════════════════════

router.get('/api/notes', async (req, res, parsed) => {
  const { ok } = ctx;
  let sqlStr = 'SELECT * FROM vendor_notes WHERE 1=1';
  const params = [];
  const vid = parsed.searchParams.get('vendor_id');
  const ntype = parsed.searchParams.get('note_type');
  const from = parsed.searchParams.get('from');
  const to = parsed.searchParams.get('to');
  const q = parsed.searchParams.get('q');
  if (vid) { sqlStr += ' AND vendor_id = ?'; params.push(parseInt(vid)); }
  if (ntype) { sqlStr += ' AND note_type = ?'; params.push(ntype); }
  if (from) { sqlStr += ' AND note_date >= ?'; params.push(from); }
  if (to) { sqlStr += ' AND note_date <= ?'; params.push(to); }
  if (q) { sqlStr += ' AND (title LIKE ? OR content LIKE ?)'; params.push('%'+q+'%', '%'+q+'%'); }
  sqlStr += ' ORDER BY note_date DESC, id DESC';
  const rows = await ctx.db.prepare(sqlStr).all(...params);
  rows.forEach(r => { if(!r.note_id) r.note_id = r.id; });
  ok(res, rows);
});

router.getP(/^\/api\/notes\/(\d+)$/, async (req, res, parsed, m) => {
  const { ok, fail } = ctx;
  const id = parseInt(m[1]);
  const note = await ctx.db.prepare('SELECT * FROM vendor_notes WHERE id = ?').get(id);
  if (!note) { fail(res, 404, 'Note not found'); return; }
  ok(res, note);
});

router.post('/api/notes', async (req, res, parsed) => {
  const { ok, fail, readJSON } = ctx;
  const body = await readJSON(req);
  if (!body.vendor_id) { fail(res, 400, 'vendor_id는 필수입니다'); return; }
  const info = await ctx.db.prepare(`INSERT INTO vendor_notes (vendor_id, vendor_name, title, content, note_type, note_date) VALUES (?, ?, ?, ?, ?, ?)`).run(
    body.vendor_id,
    body.vendor_name || '',
    body.title || '',
    body.content || '',
    body.note_type || 'meeting',
    body.note_date || new Date().toISOString().slice(0, 10)
  );
  ok(res, { note_id: info.lastInsertRowid });
});

router.putP(/^\/api\/notes\/(\d+)$/, async (req, res, parsed, m) => {
  const { ok, fail, readJSON } = ctx;
  const id = parseInt(m[1]);
  const body = await readJSON(req);
  const fields = [];
  const values = [];
  for (const col of ['vendor_id', 'vendor_name', 'title', 'content', 'note_type', 'note_date', 'status']) {
    if (body[col] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(body[col]);
    }
  }
  if (fields.length === 0) { fail(res, 400, 'No fields to update'); return; }
  fields.push(`updated_at = datetime('now','localtime')`);
  values.push(id);
  await ctx.db.prepare(`UPDATE vendor_notes SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  ok(res, { note_id: id });
});

router.delP(/^\/api\/notes\/(\d+)$/, async (req, res, parsed, m) => {
  const { ok } = ctx;
  const id = parseInt(m[1]);
  try { await ctx.db.prepare('DELETE FROM note_comments WHERE note_id = ?').run(id); } catch(_) {}
  await ctx.db.prepare('DELETE FROM vendor_notes WHERE id = ?').run(id);
  ok(res, { deleted: id });
});

router.getP(/^\/api\/notes\/(\d+)\/comments$/, async (req, res, parsed, m) => {
  const { ok } = ctx;
  const rows = await ctx.db.prepare('SELECT * FROM note_comments WHERE note_id=? ORDER BY created_at ASC').all(m[1]);
  ok(res, rows);
});

router.postP(/^\/api\/notes\/(\d+)\/comments$/, async (req, res, parsed, m) => {
  const { ok, fail, readJSON } = ctx;
  const b = await readJSON(req);
  if (!b.content?.trim()) { fail(res, 400, 'content required'); return; }
  const info = await ctx.db.prepare('INSERT INTO note_comments (note_id, author, content) VALUES (?,?,?)').run(
    parseInt(m[1]), b.author||'', b.content.trim()
  );
  ok(res, { id: info.lastInsertRowid });
});

router.delP(/^\/api\/note-comments\/(\d+)$/, async (req, res, parsed, m) => {
  const { ok } = ctx;
  await ctx.db.prepare('DELETE FROM note_comments WHERE id=?').run(m[1]);
  ok(res, { deleted: true });
});

// ════════════════════════════════════════════════════════════════════
//  DD (디얼디어) 품목 동기화
// ════════════════════════════════════════════════════════════════════

router.get('/api/dd/sync-status', async (req, res) => {
  ctx.fail(res, 410, 'DD 자동 동기화는 비활성화되었습니다. 품목관리에서 디디 법인 품목을 직접 등록하세요.');
});

router.post('/api/dd/sync', async (req, res) => {
  ctx.fail(res, 410, 'DD 자동 동기화는 비활성화되었습니다. 품목관리에서 디디 법인 품목을 직접 등록하세요.');
});

router.get('/api/dd/sales', async (req, res, parsed) => {
  const { ok, fail } = ctx;
  const pool = await ctx.getDdPool();
  if (!pool) { fail(res, 503, 'DD 데이터베이스 미연결'); return; }
  try {
    const days = parseInt(parsed.searchParams.get('days')) || 1;
    const startDate = new Date(); startDate.setDate(startDate.getDate() - days + 1);
    const startStr = startDate.toISOString().slice(0, 10);
    const [rows] = await pool.query(
      `SELECT product_code, product_name, COUNT(*) as order_count, SUM(qty) as total_qty
       FROM order_items WHERE created_at >= ? GROUP BY product_code, product_name ORDER BY total_qty DESC LIMIT 20`,
      [startStr]
    );
    ok(res, rows);
  } catch(e) { fail(res, 500, 'DD 판매 조회 실패: ' + e.message); }
});

// ════════════════════════════════════════════════════════════════════
//  XERP 출고 트렌드 분석
// ════════════════════════════════════════════════════════════════════

router.get('/api/stats/usage-trend', async (req, res, parsed) => {
  const { ok, fail } = ctx;
  const xerpPool = await ctx.ensureXerpPool();
  if (!xerpPool) { fail(res, 503, 'XERP 데이터베이스 미연결'); return; }
  const code = parsed.searchParams.get('code') || '';
  const months = parseInt(parsed.searchParams.get('months')) || 6;
  if (!code) { fail(res, 400, 'code 파라미터 필요'); return; }
  try {
    const today = new Date();
    const start = new Date(today); start.setMonth(start.getMonth() - months);
    const fmt = d => d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
    const result = await xerpPool.request()
      .input('code', ctx.sql.NVarChar(30), code)
      .input('startD', ctx.sql.NChar(16), fmt(start))
      .input('endD', ctx.sql.NChar(16), fmt(today))
      .query(`
        SELECT LEFT(RTRIM(InoutDate),6) AS ym, SUM(InoutQty) AS qty
        FROM mmInoutItem WITH (NOLOCK)
        WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND InoutGubun='SO'
          AND RTRIM(ItemCode)=@code
          AND InoutDate>=@startD AND InoutDate<@endD
        GROUP BY LEFT(RTRIM(InoutDate),6)
        ORDER BY ym
      `);
    const monthsData = result.recordset.map(r => ({
      month: r.ym.slice(0,4) + '-' + r.ym.slice(4,6),
      qty: Math.round(r.qty || 0)
    }));
    ok(res, { product_code: code, months: monthsData });
  } catch (e) {
    fail(res, 500, '출고 트렌드 조회 오류: ' + e.message);
  }
});

router.get('/api/stats/usage-trend-all', async (req, res, parsed) => {
  const { ok, fail } = ctx;
  const xerpPool = await ctx.ensureXerpPool();
  if (!xerpPool) { fail(res, 503, 'XERP 데이터베이스 미연결'); return; }
  const months = parseInt(parsed.searchParams.get('months')) || 6;
  try {
    const today = new Date();
    const start = new Date(today); start.setMonth(start.getMonth() - months);
    const fmt = d => d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
    const result = await xerpPool.request()
      .input('startD', ctx.sql.NChar(16), fmt(start))
      .input('endD', ctx.sql.NChar(16), fmt(today))
      .query(`
        SELECT TOP 20 RTRIM(ItemCode) AS item_code, SUM(InoutQty) AS total_qty
        FROM mmInoutItem WITH (NOLOCK)
        WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND InoutGubun='SO'
          AND InoutDate>=@startD AND InoutDate<@endD
        GROUP BY RTRIM(ItemCode)
        ORDER BY SUM(InoutQty) DESC
      `);
    const topCodes = result.recordset.map(r => (r.item_code||'').trim()).filter(Boolean);
    if (!topCodes.length) { ok(res, { months: [], products: [] }); return; }
    const safeList = topCodes.filter(c => /^[A-Za-z0-9_\-]+$/.test(c)).map(c => `'${c}'`).join(',');
    const detailResult = await xerpPool.request()
      .input('startD2', ctx.sql.NChar(16), fmt(start))
      .input('endD2', ctx.sql.NChar(16), fmt(today))
      .query(`
        SELECT RTRIM(ItemCode) AS item_code, LEFT(RTRIM(InoutDate),6) AS ym, SUM(InoutQty) AS qty
        FROM mmInoutItem WITH (NOLOCK)
        WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND InoutGubun='SO'
          AND InoutDate>=@startD2 AND InoutDate<@endD2
          AND RTRIM(ItemCode) IN (${safeList})
        GROUP BY RTRIM(ItemCode), LEFT(RTRIM(InoutDate),6)
        ORDER BY RTRIM(ItemCode), ym
      `);
    const monthSet = new Set();
    detailResult.recordset.forEach(r => monthSet.add(r.ym));
    const monthList = [...monthSet].sort().map(ym => ym.slice(0,4)+'-'+ym.slice(4,6));
    const prodMap = {};
    detailResult.recordset.forEach(r => {
      const c = (r.item_code||'').trim();
      if (!prodMap[c]) prodMap[c] = {};
      prodMap[c][r.ym.slice(0,4)+'-'+r.ym.slice(4,6)] = Math.round(r.qty||0);
    });
    const nameRows = await ctx.db.prepare(`SELECT product_code, product_name FROM products WHERE product_code IN (${topCodes.map(()=>'?').join(',')})`).all(...topCodes);
    const nameMap = {};
    nameRows.forEach(r => nameMap[r.product_code] = r.product_name);
    const products = topCodes.map(code => ({
      code,
      name: nameMap[code] || code,
      data: monthList.map(m => (prodMap[code]||{})[m] || 0)
    }));
    ok(res, { months: monthList, products });
  } catch (e) {
    fail(res, 500, '전체 출고 트렌드 조회 오류: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  발주이력 (Order History) API
// ════════════════════════════════════════════════════════════════════

router.get('/api/order-history', async (req, res, parsed) => {
  const { ok } = ctx;
  const mode = parsed.searchParams.get('mode') || 'full';
  if (mode === 'codes') {
    const rows = await ctx.db.prepare('SELECT DISTINCT product_code FROM order_history ORDER BY product_code').all();
    ok(res, rows.map(r => r.product_code));
  } else if (mode === 'today') {
    const today = new Date().toISOString().slice(0,10).replace(/-/g,'-');
    const rows = await ctx.db.prepare('SELECT product_code, SUM(order_qty) as total_qty FROM order_history WHERE order_date = ? GROUP BY product_code').all(today);
    const map = {};
    rows.forEach(r => { map[r.product_code] = r.total_qty; });
    ok(res, map);
  } else {
    const rows = await ctx.db.prepare('SELECT * FROM order_history ORDER BY order_date DESC, history_id DESC LIMIT 5000').all();
    ok(res, rows);
  }
});

router.get('/api/order-history/stats', async (req, res) => {
  const { ok } = ctx;
  const total = (await ctx.db.prepare('SELECT COUNT(*) as cnt FROM order_history').get()).cnt;
  const codes = (await ctx.db.prepare('SELECT COUNT(DISTINCT product_code) as cnt FROM order_history').get()).cnt;
  const sheets = (await ctx.db.prepare("SELECT DISTINCT source_sheet FROM order_history WHERE source_sheet != ''").all()).map(r => r.source_sheet);
  ok(res, { total_rows: total, unique_codes: codes, sheets });
});

router.post('/api/order-history/import', async (req, res) => {
  const { ok, fail, readJSON } = ctx;
  const b = await readJSON(req);
  const rows = b.rows || [];
  const sourceSheet = b.source_sheet || '';
  const clearExisting = b.clear_existing || false;

  if (!rows.length) { fail(res, 400, 'rows required'); return; }

  const ins = ctx.db.prepare(`INSERT INTO order_history
    (order_date, os_no, warehouse_order, product_name, product_code, actual_qty,
     material_code, material_name, paper_maker, vendor_code, qty, cut_spec,
     plate_spec, cutting, printing, foil_emboss, thomson, envelope_proc,
     seari, laser, silk, outsource, order_qty, product_spec, source_sheet)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`);

  const txn = ctx.db.transaction(async () => {
    if (clearExisting) {
      await ctx.db.prepare('DELETE FROM order_history').run();
    }
    let count = 0;
    for (const r of rows) {
      const code = (r.product_code || r[5] || '').toString().trim();
      if (!code) continue;
      await ins.run(
        r.order_date || r[0] || '',
        r.os_no || r[2] || '',
        r.warehouse_order || r[3] || '',
        r.product_name || r[4] || '',
        code,
        parseInt(r.actual_qty || r[6] || 0) || 0,
        r.material_code || r[7] || '',
        r.material_name || r[8] || '',
        r.paper_maker || r[9] || '',
        r.vendor_code || r[10] || '',
        parseFloat(r.qty || r[11] || 0) || 0,
        r.cut_spec || r[12] || '',
        r.plate_spec || r[13] || '',
        r.cutting || r[14] || '',
        r.printing || r[15] || '',
        r.foil_emboss || r[16] || '',
        r.thomson || r[17] || '',
        r.envelope_proc || r[18] || '',
        r.seari || r[19] || '',
        r.laser || r[20] || '',
        r.silk || r[21] || '',
        r.outsource || r[22] || '',
        parseInt(r.order_qty || r[23] || 0) || 0,
        r.product_spec || r[24] || '',
        sourceSheet
      );
      count++;
    }
    return count;
  });
  const imported = await txn();

  // Google Sheet 동기화 (비동기, DB 저장 후 실행)
  let sheetResult = null;
  if (b.sync_to_sheet !== false) {
    const sheetRows = rows.filter(r => (r.product_code || r[5] || '').toString().trim());
    sheetResult = await ctx.appendToGoogleSheet(sheetRows.map(r => ({
      order_date: r.order_date || r[0] || '',
      os_no: r.os_no || r[2] || '',
      warehouse_order: r.warehouse_order || r[3] || '',
      product_name: r.product_name || r[4] || '',
      product_code: (r.product_code || r[5] || '').toString().trim(),
      actual_qty: parseInt(r.actual_qty || r[6] || 0) || 0,
      material_code: r.material_code || r[7] || '',
      material_name: r.material_name || r[8] || '',
      paper_maker: r.paper_maker || r[9] || '',
      vendor_code: r.vendor_code || r[10] || '',
      qty: parseFloat(r.qty || r[11] || 0) || 0,
      cut_spec: r.cut_spec || r[12] || '',
      plate_spec: r.plate_spec || r[13] || '',
      cutting: r.cutting || r[14] || '',
      printing: r.printing || r[15] || '',
      foil_emboss: r.foil_emboss || r[16] || '',
      thomson: r.thomson || r[17] || '',
      envelope_proc: r.envelope_proc || r[18] || '',
      seari: r.seari || r[19] || '',
      laser: r.laser || r[20] || '',
      silk: r.silk || r[21] || '',
      outsource: r.outsource || r[22] || '',
      order_qty: parseInt(r.order_qty || r[23] || 0) || 0,
      product_spec: r.product_spec || r[24] || ''
    })));
  }

  ok(res, { imported, source_sheet: sourceSheet, google_sheet: sheetResult });
});

router.del('/api/order-history', async (req, res) => {
  const { ok, readJSON } = ctx;
  const b = await readJSON(req).catch(() => ({}));
  if (b.source_sheets && Array.isArray(b.source_sheets) && b.source_sheets.length) {
    const ph = b.source_sheets.map(() => '?').join(',');
    const r = await ctx.db.prepare(`DELETE FROM order_history WHERE source_sheet IN (${ph})`).run(...b.source_sheets);
    ok(res, { deleted: r.changes, source_sheets: b.source_sheets });
  } else {
    await ctx.db.prepare('DELETE FROM order_history').run();
    ok(res, { deleted: true });
  }
});

// ════════════════════════════════════════════════════════════════════
//  SALES KPI / DAILY / MONTHLY / BY-CHANNEL / BY-PRODUCT / BY-BRAND / TREND / ORDER-STATUS
// ════════════════════════════════════════════════════════════════════

// ── GET /api/sales/kpi ──
router.get('/api/sales/kpi', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken, logError } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const forceRefresh = parsed.searchParams.get('refresh') === '1';
  if (!forceRefresh && salesKpiCache && Date.now() - salesKpiCacheTime < SALES_CACHE_TTL) {
    ok(res, salesKpiCache); return;
  }
  const result = { today: {}, thisMonth: {}, lastMonth: {}, sameMonthLastYear: {}, momChange: {}, yoyChange: {}, sources: {} };
  const now = new Date();
  const todayYMD = toYMD(now);
  const monthStart = now.getFullYear() + String(now.getMonth() + 1).padStart(2, '0') + '01';
  const monthEnd = todayYMD;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lmStart = toYMD(lastMonthDate);
  const lmEnd = toYMD(new Date(now.getFullYear(), now.getMonth(), 0));
  const sylyDate = new Date(now.getFullYear() - 1, now.getMonth(), 1);
  const sylyStart = toYMD(sylyDate);
  const sylyEnd = toYMD(new Date(now.getFullYear() - 1, now.getMonth() + 1, 0));

  // XERP
  try {
    const pool = await ctx.ensureXerpPool();
    if (!pool) throw new Error('XERP pool unavailable');
    const [xToday, xThisMonth, xLastMonth, xSameLY] = await Promise.all([
      queryXerpSales(pool, todayYMD, todayYMD),
      queryXerpSales(pool, monthStart, monthEnd),
      queryXerpSales(pool, lmStart, lmEnd),
      queryXerpSales(pool, sylyStart, sylyEnd)
    ]);
    let xTodayFinal = xToday;
    if (xToday.order_count === 0) {
      const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
      const yYMD = toYMD(yesterday);
      xTodayFinal = await queryXerpSales(pool, yYMD, yYMD);
      xTodayFinal._dateUsed = yYMD;
    }
    result.today.xerp = { sales: Number(xTodayFinal.total_sales), orders: xTodayFinal.order_count, dateUsed: xTodayFinal._dateUsed || todayYMD };
    result.thisMonth.xerp = { sales: Number(xThisMonth.total_sales), orders: xThisMonth.order_count, supply: Number(xThisMonth.total_supply), vat: Number(xThisMonth.total_vat), fee: Number(xThisMonth.total_fee) };
    result.lastMonth.xerp = { sales: Number(xLastMonth.total_sales), orders: xLastMonth.order_count };
    result.sameMonthLastYear.xerp = { sales: Number(xSameLY.total_sales), orders: xSameLY.order_count };
    result.sources.xerp = 'connected';
  } catch (e) {
    console.error('Sales KPI XERP error:', e.message);
    logError('warn', 'Sales KPI XERP: ' + e.message, e.stack, req.url, req.method);
    result.sources.xerp = (e.message.includes('permission') || e.message.includes('denied') || e.number === 229) ? 'access_denied' : 'error';
    result.today.xerp = { sales: 0, orders: 0 };
    result.thisMonth.xerp = { sales: 0, orders: 0, supply: 0, vat: 0, fee: 0 };
    result.lastMonth.xerp = { sales: 0, orders: 0 };
    result.sameMonthLastYear.xerp = { sales: 0, orders: 0 };
  }

  // DD
  const todayISO = now.toISOString().slice(0, 10);
  const tomorrowISO = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().slice(0, 10);
  const mStartISO = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-01';
  const lmStartISO = lastMonthDate.toISOString().slice(0, 10);
  const lmEndISO = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().slice(0, 10);
  const sylyStartISO = sylyDate.toISOString().slice(0, 10);
  const sylyEndISO = new Date(now.getFullYear() - 1, now.getMonth() + 1, 1).toISOString().slice(0, 10);
  try {
    const pool = await ctx.getDdPool();
    if (!pool) throw new Error('DD pool unavailable');
    const [dToday, dThisMonth, dLastMonth, dSameLY] = await Promise.all([
      queryDdSales(pool, todayISO, tomorrowISO),
      queryDdSales(pool, mStartISO, tomorrowISO),
      queryDdSales(pool, lmStartISO, lmEndISO),
      queryDdSales(pool, sylyStartISO, sylyEndISO)
    ]);
    result.today.dd = { sales: Number(dToday.total_sales), orders: dToday.order_count };
    result.thisMonth.dd = { sales: Number(dThisMonth.total_sales), orders: dThisMonth.order_count };
    result.lastMonth.dd = { sales: Number(dLastMonth.total_sales), orders: dLastMonth.order_count };
    result.sameMonthLastYear.dd = { sales: Number(dSameLY.total_sales), orders: dSameLY.order_count };
    result.sources.dd = 'connected';
  } catch (e) {
    console.error('Sales KPI DD error:', e.message);
    logError('warn', 'Sales KPI DD: ' + e.message, e.stack, req.url, req.method);
    result.sources.dd = 'error';
    result.today.dd = { sales: 0, orders: 0 };
    result.thisMonth.dd = { sales: 0, orders: 0 };
    result.lastMonth.dd = { sales: 0, orders: 0 };
    result.sameMonthLastYear.dd = { sales: 0, orders: 0 };
  }

  // 더기프트 (XERP mmInoutItem 출고)
  try {
    const pool = await ctx.ensureXerpPool();
    if (!pool) throw new Error('XERP pool unavailable');
    const [gToday, gThisMonth, gLastMonth, gSameLY] = await Promise.all([
      queryGiftSales(pool, todayYMD, todayYMD),
      queryGiftSales(pool, monthStart, monthEnd),
      queryGiftSales(pool, lmStart, lmEnd),
      queryGiftSales(pool, sylyStart, sylyEnd)
    ]);
    let gTodayFinal = gToday;
    if (gToday.order_count === 0) {
      const yesterday = new Date(now); yesterday.setDate(yesterday.getDate() - 1);
      gTodayFinal = await queryGiftSales(pool, toYMD(yesterday), toYMD(yesterday));
    }
    result.today.gift = { sales: gTodayFinal.total_sales, orders: gTodayFinal.order_count, qty: gTodayFinal.total_qty };
    result.thisMonth.gift = { sales: gThisMonth.total_sales, orders: gThisMonth.order_count, qty: gThisMonth.total_qty };
    result.lastMonth.gift = { sales: gLastMonth.total_sales, orders: gLastMonth.order_count, qty: gLastMonth.total_qty };
    result.sameMonthLastYear.gift = { sales: gSameLY.total_sales, orders: gSameLY.order_count, qty: gSameLY.total_qty };
    result.sources.gift = 'connected';
  } catch (e) {
    console.error('Sales KPI Gift error:', e.message);
    logError('warn', 'Sales KPI Gift: ' + e.message, e.stack, req.url, req.method);
    result.sources.gift = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
    result.today.gift = { sales: 0, orders: 0, qty: 0 };
    result.thisMonth.gift = { sales: 0, orders: 0, qty: 0 };
    result.lastMonth.gift = { sales: 0, orders: 0, qty: 0 };
    result.sameMonthLastYear.gift = { sales: 0, orders: 0, qty: 0 };
  }

  // 법인별 분리 합산 (바른손 = XERP + 더기프트, 디얼디어 = DD)
  result.today.barunson = { sales: (result.today.xerp.sales||0) + (result.today.gift.sales||0), orders: (result.today.xerp.orders||0) + (result.today.gift.orders||0) };
  result.today.deardear = { sales: result.today.dd.sales||0, orders: result.today.dd.orders||0 };
  result.thisMonth.barunson = { sales: (result.thisMonth.xerp.sales||0) + (result.thisMonth.gift.sales||0), orders: (result.thisMonth.xerp.orders||0) + (result.thisMonth.gift.orders||0) };
  result.thisMonth.deardear = { sales: result.thisMonth.dd.sales||0, orders: result.thisMonth.dd.orders||0 };
  result.lastMonth.barunson = { sales: (result.lastMonth.xerp.sales||0) + (result.lastMonth.gift.sales||0), orders: (result.lastMonth.xerp.orders||0) + (result.lastMonth.gift.orders||0) };
  result.lastMonth.deardear = { sales: result.lastMonth.dd.sales||0, orders: result.lastMonth.dd.orders||0 };
  result.today.total = { sales: result.today.barunson.sales + result.today.deardear.sales, orders: result.today.barunson.orders + result.today.deardear.orders };
  result.thisMonth.total = { sales: result.thisMonth.barunson.sales + result.thisMonth.deardear.sales, orders: result.thisMonth.barunson.orders + result.thisMonth.deardear.orders };
  result.lastMonth.total = { sales: result.lastMonth.barunson.sales + result.lastMonth.deardear.sales, orders: result.lastMonth.barunson.orders + result.lastMonth.deardear.orders };
  result.sameMonthLastYear.total = { sales: (result.sameMonthLastYear.xerp.sales || 0) + (result.sameMonthLastYear.dd.sales || 0) + (result.sameMonthLastYear.gift.sales || 0), orders: (result.sameMonthLastYear.xerp.orders || 0) + (result.sameMonthLastYear.dd.orders || 0) + (result.sameMonthLastYear.gift.orders || 0) };
  const tmSales = result.thisMonth.total.sales, lmSales = result.lastMonth.total.sales;
  const sylySales = result.sameMonthLastYear.total.sales;
  result.momChange = { salesPct: lmSales > 0 ? Math.round((tmSales - lmSales) / lmSales * 1000) / 10 : 0, salesDiff: tmSales - lmSales };
  result.yoyChange = { salesPct: sylySales > 0 ? Math.round((tmSales - sylySales) / sylySales * 1000) / 10 : 0, salesDiff: tmSales - sylySales };
  const daysInMonth = now.getDate();
  result.dailyAvg = daysInMonth > 0 ? Math.round(tmSales / daysInMonth) : 0;
  result.cachedAt = new Date().toISOString();
  salesKpiCache = result; salesKpiCacheTime = Date.now();
  ok(res, result);
});

// ── GET /api/sales/daily ──
router.get('/api/sales/daily', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken, logError } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const startParam = parsed.searchParams.get('start') || '';
  const endParam = parsed.searchParams.get('end') || '';
  const source = parsed.searchParams.get('source') || 'all';
  if (!startParam.match(/^\d{8}$/) || !endParam.match(/^\d{8}$/)) { fail(res, 400, 'start/end는 YYYYMMDD 형식'); return; }
  if (parseInt(endParam) - parseInt(startParam) > 3660000) { fail(res, 400, '최대 366일 범위'); return; }

  const dateMap = {};
  const result = { rows: [], summary: {}, sources: {} };

  // XERP
  if (source === 'all' || source === 'xerp') {
    try {
      const pool = await ctx.ensureXerpPool();
      if (!pool) throw new Error('XERP pool unavailable');
      const chunks = getMonthChunks(startParam, endParam);
      for (const chunk of chunks) {
        const r = await pool.request()
          .input('s', ctx.sql.NVarChar(16), chunk.start)
          .input('e', ctx.sql.NVarChar(16), chunk.end)
          .query(`SELECT h_date,
                         COUNT(DISTINCT h_orderid) AS order_count,
                         ISNULL(SUM(h_sumPrice),0) AS total_sales,
                         ISNULL(SUM(h_offerPrice),0) AS total_supply,
                         ISNULL(SUM(h_superTax),0) AS total_vat,
                         ISNULL(SUM(FeeAmnt),0) AS total_fee
                  FROM ERP_SalesData WITH (NOLOCK)
                  WHERE h_date >= @s AND h_date <= @e
                  GROUP BY h_date ORDER BY h_date`);
        for (const row of r.recordset) {
          const d = (row.h_date || '').trim();
          if (!d) continue;
          const isoDate = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
          if (!dateMap[isoDate]) dateMap[isoDate] = { date: isoDate, xerp_sales: 0, xerp_orders: 0, xerp_supply: 0, xerp_vat: 0, xerp_fee: 0, dd_sales: 0, dd_orders: 0, gift_sales: 0, gift_orders: 0, gift_qty: 0 };
          dateMap[isoDate].xerp_sales = Number(row.total_sales);
          dateMap[isoDate].xerp_orders = row.order_count;
          dateMap[isoDate].xerp_supply = Number(row.total_supply);
          dateMap[isoDate].xerp_vat = Number(row.total_vat);
          dateMap[isoDate].xerp_fee = Number(row.total_fee);
        }
      }
      result.sources.xerp = 'connected';
    } catch (e) {
      console.error('Sales daily XERP error:', e.message);
      logError('warn', 'Sales daily XERP: ' + e.message, e.stack, req.url, req.method);
      result.sources.xerp = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
    }
  }

  // DD
  if (source === 'all' || source === 'dd') {
    try {
      const pool = await ctx.getDdPool();
      if (!pool) throw new Error('DD pool unavailable');
      const startISO = startParam.slice(0, 4) + '-' + startParam.slice(4, 6) + '-' + startParam.slice(6, 8);
      const endD = new Date(parseInt(endParam.slice(0, 4)), parseInt(endParam.slice(4, 6)) - 1, parseInt(endParam.slice(6, 8)) + 1);
      const endISO = endD.toISOString().slice(0, 10);
      const [rows] = await pool.query(
        `SELECT DATE(created_at) AS sale_date, COUNT(*) AS order_count, IFNULL(SUM(paid_money),0) AS total_sales
         FROM orders WHERE created_at >= ? AND created_at < ? AND order_state != 'C'
         GROUP BY DATE(created_at) ORDER BY sale_date`, [startISO, endISO]);
      for (const row of rows) {
        const d = typeof row.sale_date === 'string' ? row.sale_date : row.sale_date.toISOString().slice(0, 10);
        if (!dateMap[d]) dateMap[d] = { date: d, xerp_sales: 0, xerp_orders: 0, xerp_supply: 0, xerp_vat: 0, xerp_fee: 0, dd_sales: 0, dd_orders: 0, gift_sales: 0, gift_orders: 0, gift_qty: 0 };
        dateMap[d].dd_sales = Number(row.total_sales);
        dateMap[d].dd_orders = row.order_count;
      }
      result.sources.dd = 'connected';
    } catch (e) {
      console.error('Sales daily DD error:', e.message);
      logError('warn', 'Sales daily DD: ' + e.message, e.stack, req.url, req.method);
      result.sources.dd = 'error';
    }
  }

  // 더기프트
  if (source === 'all' || source === 'gift') {
    try {
      const pool = await ctx.ensureXerpPool();
      if (!pool) throw new Error('XERP pool unavailable');
      const gRows = await queryGiftDailySales(pool, startParam, endParam);
      for (const row of gRows) {
        const d = row.date;
        if (!d) continue;
        const isoDate = d.slice(0, 4) + '-' + d.slice(4, 6) + '-' + d.slice(6, 8);
        if (!dateMap[isoDate]) dateMap[isoDate] = { date: isoDate, xerp_sales: 0, xerp_orders: 0, xerp_supply: 0, xerp_vat: 0, xerp_fee: 0, dd_sales: 0, dd_orders: 0, gift_sales: 0, gift_orders: 0, gift_qty: 0 };
        dateMap[isoDate].gift_sales = row.sales;
        dateMap[isoDate].gift_orders = row.orders;
        dateMap[isoDate].gift_qty = row.qty;
      }
      result.sources.gift = 'connected';
    } catch (e) {
      console.error('Sales daily Gift error:', e.message);
      logError('warn', 'Sales daily Gift: ' + e.message, e.stack, req.url, req.method);
      result.sources.gift = 'error';
    }
  }

  result.rows = Object.values(dateMap).sort((a, b) => a.date.localeCompare(b.date));
  result.rows.forEach(r => { r.total_sales = (r.xerp_sales||0) + (r.dd_sales||0) + (r.gift_sales||0); r.total_orders = (r.xerp_orders||0) + (r.dd_orders||0) + (r.gift_orders||0); });
  const totalSales = result.rows.reduce((s, r) => s + r.total_sales, 0);
  const totalOrders = result.rows.reduce((s, r) => s + r.total_orders, 0);
  result.summary = { total_sales: totalSales, total_orders: totalOrders, avg_daily_sales: result.rows.length > 0 ? Math.round(totalSales / result.rows.length) : 0, days: result.rows.length };
  result.cachedAt = new Date().toISOString();
  ok(res, result);
});

// ── GET /api/sales/monthly ──
router.get('/api/sales/monthly', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const months = parseInt(parsed.searchParams.get('months') || '12');
  const source = parsed.searchParams.get('source') || 'all';
  const now = new Date();
  const startDate = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const startYMD = toYMD(startDate);
  const endYMD = toYMD(now);
  const monthMap = {};
  const result = { rows: [], sources: {} };

  if (source === 'all' || source === 'xerp') {
    try {
      const pool = await ctx.ensureXerpPool();
      if (!pool) throw new Error('XERP pool unavailable');
      const chunks = getMonthChunks(startYMD, endYMD);
      for (const chunk of chunks) {
        const r = await pool.request()
          .input('s', ctx.sql.NVarChar(16), chunk.start)
          .input('e', ctx.sql.NVarChar(16), chunk.end)
          .query(`SELECT LEFT(h_date,6) AS sale_month,
                         COUNT(DISTINCT h_orderid) AS order_count,
                         ISNULL(SUM(h_sumPrice),0) AS total_sales,
                         ISNULL(SUM(h_offerPrice),0) AS total_supply,
                         ISNULL(SUM(h_superTax),0) AS total_vat,
                         ISNULL(SUM(FeeAmnt),0) AS total_fee
                  FROM ERP_SalesData WITH (NOLOCK)
                  WHERE h_date >= @s AND h_date <= @e
                  GROUP BY LEFT(h_date,6) ORDER BY sale_month`);
        for (const row of r.recordset) {
          const m = (row.sale_month || '').trim();
          if (!m) continue;
          const key = m.slice(0, 4) + '-' + m.slice(4, 6);
          if (!monthMap[key]) monthMap[key] = { month: key, xerp_sales: 0, xerp_orders: 0, xerp_supply: 0, xerp_vat: 0, xerp_fee: 0, dd_sales: 0, dd_orders: 0, gift_sales: 0, gift_orders: 0, gift_qty: 0 };
          monthMap[key].xerp_sales += Number(row.total_sales);
          monthMap[key].xerp_orders += row.order_count;
          monthMap[key].xerp_supply += Number(row.total_supply);
          monthMap[key].xerp_vat += Number(row.total_vat);
          monthMap[key].xerp_fee += Number(row.total_fee);
        }
      }
      result.sources.xerp = 'connected';
    } catch (e) {
      console.error('Sales monthly XERP error:', e.message);
      result.sources.xerp = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
    }
  }

  if (source === 'all' || source === 'dd') {
    try {
      const pool = await ctx.getDdPool();
      if (!pool) throw new Error('DD pool unavailable');
      const startISO = startDate.toISOString().slice(0, 10);
      const endISO = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).toISOString().slice(0, 10);
      const [rows] = await pool.query(
        `SELECT DATE_FORMAT(created_at, '%Y-%m') AS sale_month, COUNT(*) AS order_count, IFNULL(SUM(paid_money),0) AS total_sales
         FROM orders WHERE created_at >= ? AND created_at < ? AND order_state != 'C'
         GROUP BY DATE_FORMAT(created_at, '%Y-%m') ORDER BY sale_month`, [startISO, endISO]);
      for (const row of rows) {
        const m = row.sale_month;
        if (!monthMap[m]) monthMap[m] = { month: m, xerp_sales: 0, xerp_orders: 0, xerp_supply: 0, xerp_vat: 0, xerp_fee: 0, dd_sales: 0, dd_orders: 0, gift_sales: 0, gift_orders: 0, gift_qty: 0 };
        monthMap[m].dd_sales = Number(row.total_sales);
        monthMap[m].dd_orders = row.order_count;
      }
      result.sources.dd = 'connected';
    } catch (e) {
      console.error('Sales monthly DD error:', e.message);
      result.sources.dd = 'error';
    }
  }

  // 더기프트
  if (source === 'all' || source === 'gift') {
    try {
      const pool = await ctx.ensureXerpPool();
      if (!pool) throw new Error('XERP pool unavailable');
      const giftSets = await ctx.db.prepare("SELECT xerp_code FROM gift_sets WHERE status='active' AND xerp_code != ''").all();
      const xerpCodes = giftSets.map(g => g.xerp_code.trim()).filter(Boolean);
      if (xerpCodes.length) {
        const req2 = pool.request();
        req2.input('s', ctx.sql.NVarChar(16), startYMD);
        req2.input('e', ctx.sql.NVarChar(16), endYMD);
        const ph = (await Promise.all(xerpCodes.map(async (c, i) => { req2.input(`gc${i}`, ctx.sql.VarChar(50), c); return `@gc${i}`; }))).join(',');
        const r = await req2.query(`
          SELECT LEFT(RTRIM(InoutDate),6) AS sale_month,
                 COUNT(DISTINCT InoutNo) AS order_count,
                 ISNULL(SUM(InoutAmnt),0) AS total_sales,
                 ISNULL(SUM(InoutQty),0) AS total_qty
          FROM mmInoutItem WITH (NOLOCK)
          WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND InoutGubun='SO'
            AND InoutDate >= @s AND InoutDate <= @e
            AND RTRIM(ItemCode) IN (${ph})
          GROUP BY LEFT(RTRIM(InoutDate),6) ORDER BY sale_month`);
        for (const row of r.recordset) {
          const m0 = (row.sale_month || '').trim();
          if (!m0) continue;
          const key = m0.slice(0, 4) + '-' + m0.slice(4, 6);
          if (!monthMap[key]) monthMap[key] = { month: key, xerp_sales: 0, xerp_orders: 0, xerp_supply: 0, xerp_vat: 0, xerp_fee: 0, dd_sales: 0, dd_orders: 0, gift_sales: 0, gift_orders: 0, gift_qty: 0 };
          monthMap[key].gift_sales += Number(row.total_sales);
          monthMap[key].gift_orders += row.order_count;
          monthMap[key].gift_qty += Number(row.total_qty);
        }
      }
      result.sources.gift = 'connected';
    } catch (e) {
      console.error('Sales monthly Gift error:', e.message);
      result.sources.gift = 'error';
    }
  }

  result.rows = Object.values(monthMap).sort((a, b) => a.month.localeCompare(b.month));
  result.rows.forEach(r => { r.total_sales = (r.xerp_sales||0) + (r.dd_sales||0) + (r.gift_sales||0); r.total_orders = (r.xerp_orders||0) + (r.dd_orders||0) + (r.gift_orders||0); });
  ok(res, result);
});

// ── GET /api/sales/by-channel ──
router.get('/api/sales/by-channel', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const startParam = parsed.searchParams.get('start') || '';
  const endParam = parsed.searchParams.get('end') || '';
  if (!startParam.match(/^\d{8}$/) || !endParam.match(/^\d{8}$/)) { fail(res, 400, 'start/end는 YYYYMMDD 형식'); return; }
  const result = { channels: [], total: {}, sources: {} };
  try {
    const pool = await ctx.ensureXerpPool();
    if (!pool) throw new Error('XERP pool unavailable');
    const r = await pool.request()
      .input('s', ctx.sql.NVarChar(16), startParam)
      .input('e', ctx.sql.NVarChar(16), endParam)
      .query(`SELECT RTRIM(DeptGubun) AS channel,
                     COUNT(DISTINCT h_orderid) AS order_count,
                     ISNULL(SUM(h_sumPrice),0) AS total_sales,
                     ISNULL(SUM(h_offerPrice),0) AS total_supply,
                     ISNULL(SUM(FeeAmnt),0) AS total_fee
              FROM ERP_SalesData WITH (NOLOCK)
              WHERE h_date >= @s AND h_date <= @e
              GROUP BY RTRIM(DeptGubun) ORDER BY SUM(h_sumPrice) DESC`);
    const grandTotal = r.recordset.reduce((s, row) => s + Number(row.total_sales), 0);
    result.channels = r.recordset.map(row => ({
      code: (row.channel || '').trim(),
      name: ctx.DEPT_GUBUN_LABELS[(row.channel || '').trim()] || (row.channel || '').trim(),
      orders: row.order_count,
      sales: Number(row.total_sales),
      supply: Number(row.total_supply),
      fee: Number(row.total_fee),
      pct: grandTotal > 0 ? Math.round(Number(row.total_sales) / grandTotal * 1000) / 10 : 0
    }));
    result.total = { orders: r.recordset.reduce((s, row) => s + row.order_count, 0), sales: grandTotal };
    result.sources.xerp = 'connected';
  } catch (e) {
    console.error('Sales by-channel error:', e.message);
    result.sources.xerp = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
  }
  result.period = { start: startParam, end: endParam };
  ok(res, result);
});

// ── GET /api/sales/by-product ──
router.get('/api/sales/by-product', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const startParam = parsed.searchParams.get('start') || '';
  const endParam = parsed.searchParams.get('end') || '';
  const limit = parseInt(parsed.searchParams.get('limit') || '50');
  const source = parsed.searchParams.get('source') || 'all';
  if (!startParam.match(/^\d{8}$/) || !endParam.match(/^\d{8}$/)) { fail(res, 400, 'start/end는 YYYYMMDD 형식'); return; }
  const products = [];
  const result = { products: [], total: {}, sources: {} };

  // XERP
  if (source === 'all' || source === 'xerp') {
    try {
      const pool = await ctx.ensureXerpPool();
      if (!pool) throw new Error('XERP pool unavailable');
      const r = await pool.request()
        .input('s', ctx.sql.NVarChar(16), startParam)
        .input('e', ctx.sql.NVarChar(16), endParam)
        .input('lim', ctx.sql.Int, limit)
        .query(`SELECT TOP (@lim) RTRIM(b_goodCode) AS product_code,
                       COUNT(DISTINCT h_orderid) AS order_count,
                       ISNULL(SUM(b_OrderNum),0) AS total_qty,
                       ISNULL(SUM(b_sumPrice),0) AS total_sales
                FROM ERP_SalesData WITH (NOLOCK)
                WHERE h_date >= @s AND h_date <= @e
                  AND b_goodCode IS NOT NULL AND LTRIM(RTRIM(b_goodCode)) != ''
                GROUP BY RTRIM(b_goodCode) ORDER BY SUM(b_sumPrice) DESC`);
      const codes = r.recordset.map(row => (row.product_code || '').trim()).filter(Boolean);
      let nameMap = {};
      if (codes.length > 0) {
        try {
          nameMap = await withBarShop1Pool(async (bar1) => {
            const map = {};
            for (let i = 0; i < codes.length; i += 500) {
              const batch = codes.slice(i, i + 500);
              const safeCodes = batch.filter(c => /^[A-Za-z0-9_\-]+$/.test(c)).map(c => "'" + c + "'").join(',');
              if (!safeCodes) continue;
              const nr = await bar1.request().query(`SELECT RTRIM(Card_Code) AS Card_Code, Card_Name, RTRIM(CardBrand) AS CardBrand FROM S2_Card WHERE RTRIM(Card_Code) IN (${safeCodes})`);
              nr.recordset.forEach(n => { map[(n.Card_Code || '').trim()] = { name: (n.Card_Name || '').trim(), brand: (n.CardBrand || '').trim() }; });
            }
            return map;
          });
        } catch (_) {}
      }
      for (const row of r.recordset) {
        const code = (row.product_code || '').trim();
        const info = nameMap[code] || {};
        products.push({ code, name: info.name || code, brand: ctx.BRAND_LABELS[info.brand] || info.brand || '', orders: row.order_count, qty: Number(row.total_qty), sales: Number(row.total_sales), source: 'xerp' });
      }
      result.sources.xerp = 'connected';
      result.sources.bar_shop1 = Object.keys(nameMap).length > 0 ? 'connected' : 'no_data';
    } catch (e) {
      console.error('Sales by-product XERP error:', e.message);
      result.sources.xerp = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
    }
  }

  // DD
  if (source === 'all' || source === 'dd') {
    try {
      const pool = await ctx.getDdPool();
      if (!pool) throw new Error('DD pool unavailable');
      const startISO = startParam.slice(0, 4) + '-' + startParam.slice(4, 6) + '-' + startParam.slice(6, 8);
      const endD = new Date(parseInt(endParam.slice(0, 4)), parseInt(endParam.slice(4, 6)) - 1, parseInt(endParam.slice(6, 8)) + 1);
      const endISO = endD.toISOString().slice(0, 10);
      const [rows] = await pool.query(
        `SELECT oi.product_code, oi.product_name, COUNT(DISTINCT oi.order_id) AS order_count,
                SUM(oi.qty) AS total_qty, SUM(oi.total_money) AS total_sales
         FROM order_items oi INNER JOIN orders o ON oi.order_id = o.id
         WHERE o.created_at >= ? AND o.created_at < ? AND o.order_state != 'C'
           AND oi.product_code IS NOT NULL AND oi.product_code != ''
         GROUP BY oi.product_code, oi.product_name ORDER BY total_sales DESC LIMIT ?`, [startISO, endISO, limit]);
      for (const row of rows) {
        products.push({ code: row.product_code, name: row.product_name || row.product_code, brand: 'DD', orders: row.order_count, qty: Number(row.total_qty), sales: Number(row.total_sales), source: 'dd' });
      }
      result.sources.dd = 'connected';
    } catch (e) {
      console.error('Sales by-product DD error:', e.message);
      result.sources.dd = 'error';
    }
  }

  products.sort((a, b) => b.sales - a.sales);
  result.products = products.slice(0, limit).map((p, i) => ({ ...p, rank: i + 1 }));
  result.total = { count: result.products.length, sales: result.products.reduce((s, p) => s + p.sales, 0) };
  result.period = { start: startParam, end: endParam };
  ok(res, result);
});

// ── GET /api/sales/by-brand ──
router.get('/api/sales/by-brand', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const startParam = parsed.searchParams.get('start') || '';
  const endParam = parsed.searchParams.get('end') || '';
  if (!startParam.match(/^\d{8}$/) || !endParam.match(/^\d{8}$/)) { fail(res, 400, 'start/end는 YYYYMMDD 형식'); return; }
  const result = { brands: [], total: {}, sources: {} };
  try {
    const pool = await ctx.ensureXerpPool();
    if (!pool) throw new Error('XERP pool unavailable');
    const r = await pool.request()
      .input('s', ctx.sql.NVarChar(16), startParam)
      .input('e', ctx.sql.NVarChar(16), endParam)
      .query(`SELECT RTRIM(b_goodCode) AS product_code,
                     COUNT(DISTINCT h_orderid) AS order_count,
                     ISNULL(SUM(b_OrderNum),0) AS total_qty,
                     ISNULL(SUM(b_sumPrice),0) AS total_sales
              FROM ERP_SalesData WITH (NOLOCK)
              WHERE h_date >= @s AND h_date <= @e
                AND b_goodCode IS NOT NULL AND LTRIM(RTRIM(b_goodCode)) != ''
              GROUP BY RTRIM(b_goodCode)`);
    const codes = r.recordset.map(row => (row.product_code || '').trim()).filter(Boolean);
    let brandMap = {};
    if (codes.length > 0) {
      try {
        brandMap = await withBarShop1Pool(async (bar1) => {
          const map = {};
          for (let i = 0; i < codes.length; i += 500) {
            const batch = codes.slice(i, i + 500);
            const safeCodes = batch.filter(c => /^[A-Za-z0-9_\-]+$/.test(c)).map(c => "'" + c + "'").join(',');
            if (!safeCodes) continue;
            const nr = await bar1.request().query(`SELECT RTRIM(Card_Code) AS Card_Code, RTRIM(CardBrand) AS CardBrand FROM S2_Card WHERE RTRIM(Card_Code) IN (${safeCodes})`);
            nr.recordset.forEach(n => { map[(n.Card_Code || '').trim()] = (n.CardBrand || '').trim(); });
          }
          return map;
        });
      } catch (_) {}
    }
    const brandAgg = {};
    for (const row of r.recordset) {
      const code = (row.product_code || '').trim();
      const brand = brandMap[code] || '기타';
      if (!brandAgg[brand]) brandAgg[brand] = { brand, orders: 0, qty: 0, sales: 0, products: 0 };
      brandAgg[brand].orders += row.order_count;
      brandAgg[brand].qty += Number(row.total_qty);
      brandAgg[brand].sales += Number(row.total_sales);
      brandAgg[brand].products++;
    }
    const grandTotal = Object.values(brandAgg).reduce((s, b) => s + b.sales, 0);
    result.brands = Object.values(brandAgg)
      .map(b => ({ ...b, brandName: ctx.BRAND_LABELS[b.brand] || b.brand, pct: grandTotal > 0 ? Math.round(b.sales / grandTotal * 1000) / 10 : 0 }))
      .sort((a, b) => b.sales - a.sales);
    result.total = { sales: grandTotal };
    result.sources.xerp = 'connected';
    result.sources.bar_shop1 = Object.keys(brandMap).length > 0 ? 'connected' : 'no_data';
  } catch (e) {
    console.error('Sales by-brand error:', e.message);
    result.sources.xerp = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
  }
  result.period = { start: startParam, end: endParam };
  ok(res, result);
});

// ── GET /api/sales/trend ──
router.get('/api/sales/trend', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const months = parseInt(parsed.searchParams.get('months') || '12');
  const now = new Date();
  const result = { thisYear: [], lastYear: [], yoyChanges: [], sources: {} };

  const tyStart = new Date(now.getFullYear(), now.getMonth() - months + 1, 1);
  const lyStart = new Date(now.getFullYear() - 1, now.getMonth() - months + 1, 1);
  const lyEnd = new Date(now.getFullYear() - 1, now.getMonth() + 1, 0);

  try {
    const pool = await ctx.ensureXerpPool();
    if (!pool) throw new Error('XERP pool unavailable');
    const tyChunks = getMonthChunks(toYMD(tyStart), toYMD(now));
    const lyChunks = getMonthChunks(toYMD(lyStart), toYMD(lyEnd));
    const tyMap = {}, lyMap = {};
    for (const chunk of tyChunks) {
      const r = await pool.request().input('s', ctx.sql.NVarChar(16), chunk.start).input('e', ctx.sql.NVarChar(16), chunk.end)
        .query(`SELECT LEFT(h_date,6) AS m, COUNT(DISTINCT h_orderid) AS cnt, ISNULL(SUM(h_sumPrice),0) AS sales FROM ERP_SalesData WITH (NOLOCK) WHERE h_date>=@s AND h_date<=@e GROUP BY LEFT(h_date,6)`);
      for (const row of r.recordset) { const k = row.m.slice(0,4)+'-'+row.m.slice(4,6); tyMap[k] = { sales: Number(row.sales), orders: row.cnt }; }
    }
    for (const chunk of lyChunks) {
      const r = await pool.request().input('s', ctx.sql.NVarChar(16), chunk.start).input('e', ctx.sql.NVarChar(16), chunk.end)
        .query(`SELECT LEFT(h_date,6) AS m, COUNT(DISTINCT h_orderid) AS cnt, ISNULL(SUM(h_sumPrice),0) AS sales FROM ERP_SalesData WITH (NOLOCK) WHERE h_date>=@s AND h_date<=@e GROUP BY LEFT(h_date,6)`);
      for (const row of r.recordset) { const k = row.m.slice(0,4)+'-'+row.m.slice(4,6); lyMap[k] = { sales: Number(row.sales), orders: row.cnt }; }
    }
    for (let i = 0; i < months; i++) {
      const d = new Date(now.getFullYear(), now.getMonth() - months + 1 + i, 1);
      const tyKey = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      const lyD = new Date(d.getFullYear() - 1, d.getMonth(), 1);
      const lyKey = lyD.getFullYear() + '-' + String(lyD.getMonth() + 1).padStart(2, '0');
      const tyData = tyMap[tyKey] || { sales: 0, orders: 0 };
      const lyData = lyMap[lyKey] || { sales: 0, orders: 0 };
      result.thisYear.push({ month: tyKey, sales: tyData.sales, orders: tyData.orders });
      result.lastYear.push({ month: lyKey, sales: lyData.sales, orders: lyData.orders });
      result.yoyChanges.push({ monthLabel: String(d.getMonth() + 1).padStart(2, '0'), changePct: lyData.sales > 0 ? Math.round((tyData.sales - lyData.sales) / lyData.sales * 1000) / 10 : 0, changeAmt: tyData.sales - lyData.sales });
    }
    result.sources.xerp = 'connected';
  } catch (e) {
    console.error('Sales trend error:', e.message);
    result.sources.xerp = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
  }
  ok(res, result);
});

// ── GET /api/sales/order-status ──
router.get('/api/sales/order-status', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const startParam = parsed.searchParams.get('start') || '';
  const endParam = parsed.searchParams.get('end') || '';
  const result = { bar_shop1: {}, dd: {}, sources: {} };

  // bar_shop1
  try {
    const data = await withBarShop1Pool(async (bar1) => {
      const [byStatus, bySite, byPay] = await Promise.all([
        bar1.request().input('s', ctx.sql.DateTime, startParam).input('e', ctx.sql.DateTime, endParam)
          .query(`SELECT status_seq, COUNT(*) AS cnt FROM custom_order WITH (NOLOCK) WHERE order_date >= @s AND order_date < @e AND status_seq >= 1 GROUP BY status_seq ORDER BY status_seq`),
        bar1.request().input('s', ctx.sql.DateTime, startParam).input('e', ctx.sql.DateTime, endParam)
          .query(`SELECT RTRIM(site_gubun) AS site_gubun, COUNT(*) AS cnt FROM custom_order WITH (NOLOCK) WHERE order_date >= @s AND order_date < @e AND status_seq >= 1 GROUP BY RTRIM(site_gubun)`),
        bar1.request().input('s', ctx.sql.DateTime, startParam).input('e', ctx.sql.DateTime, endParam)
          .query(`SELECT RTRIM(pay_Type) AS pay_type, COUNT(*) AS cnt FROM custom_order WITH (NOLOCK) WHERE order_date >= @s AND order_date < @e AND status_seq >= 1 GROUP BY RTRIM(pay_Type) ORDER BY COUNT(*) DESC`)
      ]);
      return {
        total: byStatus.recordset.reduce((s, r) => s + r.cnt, 0),
        byStatus: byStatus.recordset.map(r => ({ status_seq: r.status_seq, count: r.cnt })),
        bySite: bySite.recordset.map(r => ({ site_gubun: r.site_gubun, count: r.cnt })),
        byPayType: byPay.recordset.map(r => ({ pay_type: r.pay_type, count: r.cnt }))
      };
    });
    result.bar_shop1 = data;
    result.sources.bar_shop1 = 'connected';
  } catch (e) {
    console.error('Sales order-status bar_shop1 error:', e.message);
    result.sources.bar_shop1 = 'error';
  }

  // DD
  try {
    const pool = await ctx.getDdPool();
    if (!pool) throw new Error('DD pool unavailable');
    const [[byState], [byShipping]] = await Promise.all([
      pool.query(`SELECT order_state, COUNT(*) AS cnt FROM orders WHERE created_at >= ? AND created_at < ? GROUP BY order_state`, [startParam, endParam]),
      pool.query(`SELECT shipping_state, COUNT(*) AS cnt FROM orders WHERE created_at >= ? AND created_at < ? AND order_state != 'C' GROUP BY shipping_state`, [startParam, endParam])
    ]);
    const stateLabels = { 'B': '대기', 'P': '결제완료', 'D': '배송중', 'C': '취소', 'F': '완료' };
    result.dd = {
      total: byState.reduce((s, r) => s + r.cnt, 0),
      byState: byState.map(r => ({ state: r.order_state, label: stateLabels[r.order_state] || r.order_state, count: r.cnt })),
      byShipping: byShipping.map(r => ({ state: r.shipping_state, label: stateLabels[r.shipping_state] || r.shipping_state, count: r.cnt }))
    };
    result.sources.dd = 'connected';
  } catch (e) {
    console.error('Sales order-status DD error:', e.message);
    result.sources.dd = 'error';
  }
  ok(res, result);
});

// ── GET /api/sales/dd ──
router.get('/api/sales/dd', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const startParam = parsed.searchParams.get('start') || '';
  const endParam = parsed.searchParams.get('end') || '';
  const result = { summary: {}, daily: [], topProducts: [], byPayType: [], sources: {} };
  try {
    const pool = await ctx.getDdPool();
    if (!pool) throw new Error('DD pool unavailable');
    const endNext = endParam ? new Date(new Date(endParam).getTime() + 86400000).toISOString().slice(0, 10) : '';
    const [[summaryRows], [dailyRows], [prodRows], [payRows]] = await Promise.all([
      pool.query(`SELECT COUNT(*) AS total_orders, IFNULL(SUM(total_money),0) AS total_sales,
                  IFNULL(SUM(paid_money),0) AS total_paid, IFNULL(SUM(delivery_price),0) AS total_delivery,
                  IFNULL(SUM(discount_money),0) AS total_discount, ROUND(AVG(paid_money)) AS avg_order
                  FROM orders WHERE created_at >= ? AND created_at < ? AND order_state != 'C'`, [startParam, endNext]),
      pool.query(`SELECT DATE(created_at) AS sale_date, COUNT(*) AS order_count, IFNULL(SUM(paid_money),0) AS total_sales
                  FROM orders WHERE created_at >= ? AND created_at < ? AND order_state != 'C'
                  GROUP BY DATE(created_at) ORDER BY sale_date`, [startParam, endNext]),
      pool.query(`SELECT oi.product_code, oi.product_name, COUNT(DISTINCT oi.order_id) AS order_count,
                  SUM(oi.qty) AS total_qty, SUM(oi.total_money) AS total_sales
                  FROM order_items oi INNER JOIN orders o ON oi.order_id = o.id
                  WHERE o.created_at >= ? AND o.created_at < ? AND o.order_state != 'C'
                    AND oi.product_code IS NOT NULL AND oi.product_code != ''
                  GROUP BY oi.product_code, oi.product_name ORDER BY total_sales DESC LIMIT 20`, [startParam, endNext]),
      pool.query(`SELECT pay_type, pg_name, COUNT(*) AS order_count, IFNULL(SUM(paid_money),0) AS total_sales
                  FROM orders WHERE created_at >= ? AND created_at < ? AND order_state != 'C'
                  GROUP BY pay_type, pg_name ORDER BY total_sales DESC`, [startParam, endNext])
    ]);
    const s = summaryRows[0] || {};
    result.summary = { total_orders: s.total_orders || 0, total_sales: Number(s.total_sales || 0), total_paid: Number(s.total_paid || 0), total_delivery: Number(s.total_delivery || 0), total_discount: Number(s.total_discount || 0), avg_order: Number(s.avg_order || 0) };
    result.daily = dailyRows.map(r => ({ date: typeof r.sale_date === 'string' ? r.sale_date : r.sale_date.toISOString().slice(0, 10), orders: r.order_count, sales: Number(r.total_sales) }));
    result.topProducts = prodRows.map((r, i) => ({ rank: i + 1, code: r.product_code, name: r.product_name || '', orders: r.order_count, qty: Number(r.total_qty), sales: Number(r.total_sales) }));
    result.byPayType = payRows.map(r => ({ pay_type: r.pay_type || '', pg_name: r.pg_name || '', orders: r.order_count, sales: Number(r.total_sales) }));
    result.sources.dd = 'connected';
  } catch (e) {
    console.error('Sales DD error:', e.message);
    result.sources.dd = 'error';
  }
  ok(res, result);
});

// ── GET /api/sales/barun ──
router.get('/api/sales/barun', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const startParam = parsed.searchParams.get('start') || '';
  const endParam = parsed.searchParams.get('end') || '';
  if (!startParam.match(/^\d{8}$/) || !endParam.match(/^\d{8}$/)) { fail(res, 400, 'start/end는 YYYYMMDD 형식'); return; }
  const result = { summary: {}, daily: [], channels: [], brands: [], orderPipeline: {}, sources: {} };

  try {
    const pool = await ctx.ensureXerpPool();
    if (!pool) throw new Error('XERP pool unavailable');
    const [summaryR, dailyR, channelR] = await Promise.all([
      pool.request().input('s', ctx.sql.NVarChar(16), startParam).input('e', ctx.sql.NVarChar(16), endParam)
        .query(`SELECT COUNT(DISTINCT h_orderid) AS order_count, ISNULL(SUM(h_sumPrice),0) AS total_sales,
                ISNULL(SUM(h_offerPrice),0) AS total_supply, ISNULL(SUM(h_superTax),0) AS total_vat, ISNULL(SUM(FeeAmnt),0) AS total_fee
                FROM ERP_SalesData WITH (NOLOCK) WHERE h_date >= @s AND h_date <= @e`),
      pool.request().input('s', ctx.sql.NVarChar(16), startParam).input('e', ctx.sql.NVarChar(16), endParam)
        .query(`SELECT h_date, COUNT(DISTINCT h_orderid) AS order_count, ISNULL(SUM(h_sumPrice),0) AS total_sales
                FROM ERP_SalesData WITH (NOLOCK) WHERE h_date >= @s AND h_date <= @e GROUP BY h_date ORDER BY h_date`),
      pool.request().input('s', ctx.sql.NVarChar(16), startParam).input('e', ctx.sql.NVarChar(16), endParam)
        .query(`SELECT RTRIM(DeptGubun) AS channel, COUNT(DISTINCT h_orderid) AS order_count, ISNULL(SUM(h_sumPrice),0) AS total_sales
                FROM ERP_SalesData WITH (NOLOCK) WHERE h_date >= @s AND h_date <= @e GROUP BY RTRIM(DeptGubun) ORDER BY SUM(h_sumPrice) DESC`)
    ]);
    const s = summaryR.recordset[0] || {};
    result.summary = { orders: s.order_count || 0, sales: Number(s.total_sales || 0), supply: Number(s.total_supply || 0), vat: Number(s.total_vat || 0), fee: Number(s.total_fee || 0) };
    result.daily = dailyR.recordset.map(r => { const d = (r.h_date||'').trim(); return { date: d.slice(0,4)+'-'+d.slice(4,6)+'-'+d.slice(6,8), orders: r.order_count, sales: Number(r.total_sales) }; });
    const grandTotal = channelR.recordset.reduce((s, r) => s + Number(r.total_sales), 0);
    result.channels = channelR.recordset.map(r => ({ code: (r.channel||'').trim(), name: ctx.DEPT_GUBUN_LABELS[(r.channel||'').trim()] || r.channel, orders: r.order_count, sales: Number(r.total_sales), pct: grandTotal > 0 ? Math.round(Number(r.total_sales) / grandTotal * 1000) / 10 : 0 }));
    result.sources.xerp = 'connected';
  } catch (e) {
    console.error('Sales barun XERP error:', e.message);
    result.sources.xerp = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
  }

  // bar_shop1 주문 파이프라인
  try {
    const startISO = startParam.slice(0,4)+'-'+startParam.slice(4,6)+'-'+startParam.slice(6,8);
    const endISO = endParam.slice(0,4)+'-'+endParam.slice(4,6)+'-'+endParam.slice(6,8);
    result.orderPipeline = await withBarShop1Pool(async (bar1) => {
      const [bySite, byPay] = await Promise.all([
        bar1.request().input('s', ctx.sql.DateTime, startISO).input('e', ctx.sql.DateTime, endISO)
          .query(`SELECT RTRIM(site_gubun) AS site_gubun, COUNT(*) AS cnt FROM custom_order WITH (NOLOCK) WHERE order_date >= @s AND order_date < DATEADD(day,1,@e) AND status_seq >= 1 GROUP BY RTRIM(site_gubun)`),
        bar1.request().input('s', ctx.sql.DateTime, startISO).input('e', ctx.sql.DateTime, endISO)
          .query(`SELECT RTRIM(pay_Type) AS pay_type, COUNT(*) AS cnt FROM custom_order WITH (NOLOCK) WHERE order_date >= @s AND order_date < DATEADD(day,1,@e) AND status_seq >= 1 GROUP BY RTRIM(pay_Type) ORDER BY COUNT(*) DESC`)
      ]);
      return { bySite: bySite.recordset.map(r => ({ site: r.site_gubun, count: r.cnt })), byPayType: byPay.recordset.map(r => ({ type: r.pay_type, count: r.cnt })) };
    });
    result.sources.bar_shop1 = 'connected';
  } catch (e) {
    console.error('Sales barun bar_shop1 error:', e.message);
    result.sources.bar_shop1 = 'error';
  }
  result.period = { start: startParam, end: endParam };
  ok(res, result);
});

// ── GET /api/sales/gift ──
router.get('/api/sales/gift', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken, logError } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const startParam = parsed.searchParams.get('start') || '';
  const endParam = parsed.searchParams.get('end') || '';
  if (!startParam.match(/^\d{8}$/) || !endParam.match(/^\d{8}$/)) { fail(res, 400, 'start/end는 YYYYMMDD 형식'); return; }
  const result = { summary: {}, daily: [], products: [], sources: {} };

  try {
    const pool = await ctx.ensureXerpPool();
    if (!pool) throw new Error('XERP pool unavailable');
    const [summaryData, dailyData, productData] = await Promise.all([
      queryGiftSales(pool, startParam, endParam),
      queryGiftDailySales(pool, startParam, endParam),
      queryGiftProductSales(pool, startParam, endParam)
    ]);
    result.summary = {
      total_sales: summaryData.total_sales,
      total_orders: summaryData.order_count,
      total_qty: summaryData.total_qty,
      total_items: summaryData.items,
      avg_order: summaryData.order_count > 0 ? Math.round(summaryData.total_sales / summaryData.order_count) : 0
    };
    result.daily = dailyData.map(r => ({
      date: r.date.slice(0,4)+'-'+r.date.slice(4,6)+'-'+r.date.slice(6,8),
      sales: r.sales, orders: r.orders, qty: r.qty
    }));
    result.products = productData;
    result.sources.gift = 'connected';
  } catch (e) {
    console.error('Sales gift error:', e.message);
    logError('warn', 'Sales gift: ' + e.message, e.stack, req.url, req.method);
    result.sources.gift = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
  }
  result.period = { start: startParam, end: endParam };
  ok(res, result);
});

// ── GET /api/diag/item-monthly ──
router.get('/api/diag/item-monthly', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const code = (parsed.searchParams.get('code') || '').trim();
  const ym = (parsed.searchParams.get('ym') || '').trim();
  if (!code || !/^[A-Za-z0-9_\-]+$/.test(code)) { fail(res, 400, '제품코드(code)가 잘못되었습니다'); return; }
  if (!/^\d{6}$/.test(ym)) { fail(res, 400, 'ym 은 YYYYMM 형식이어야 합니다 (예: 202605)'); return; }
  const yyyy = parseInt(ym.slice(0,4), 10);
  const mm = parseInt(ym.slice(4,6), 10);
  const start = ym + '01';
  const lastDay = new Date(yyyy, mm, 0).getDate();
  const end = ym + String(lastDay).padStart(2, '0');
  const nextMonth = new Date(yyyy, mm, 1);
  const endExclusive = nextMonth.getFullYear() + String(nextMonth.getMonth() + 1).padStart(2, '0') + '01';

  const xerpPool = await ctx.ensureXerpPool();
  if (!xerpPool) { fail(res, 503, 'XERP 데이터베이스 미연결'); return; }
  const result = { code, ym, period: { start, end, endExclusive }, sources: {} };

  // 1) ERP_SalesData
  try {
    const sumR = await xerpPool.request()
      .input('s', ctx.sql.NVarChar(16), start).input('e', ctx.sql.NVarChar(16), end).input('c', ctx.sql.VarChar(50), code)
      .query(`SELECT COUNT(*) AS row_count, ISNULL(SUM(b_OrderNum),0) AS sum_qty, ISNULL(SUM(b_sumPrice),0) AS sum_price, COUNT(DISTINCT h_orderid) AS distinct_orders
              FROM ERP_SalesData WITH (NOLOCK) WHERE h_date >= @s AND h_date <= @e AND RTRIM(b_goodCode) = @c`);
    const dailyR = await xerpPool.request()
      .input('s', ctx.sql.NVarChar(16), start).input('e', ctx.sql.NVarChar(16), end).input('c', ctx.sql.VarChar(50), code)
      .query(`SELECT RTRIM(h_date) AS d, COUNT(*) AS rows, ISNULL(SUM(b_OrderNum),0) AS qty, ISNULL(SUM(b_sumPrice),0) AS price
              FROM ERP_SalesData WITH (NOLOCK) WHERE h_date >= @s AND h_date <= @e AND RTRIM(b_goodCode) = @c
              GROUP BY RTRIM(h_date) ORDER BY RTRIM(h_date)`);
    const sampleR = await xerpPool.request()
      .input('s', ctx.sql.NVarChar(16), start).input('e', ctx.sql.NVarChar(16), end).input('c', ctx.sql.VarChar(50), code)
      .query(`SELECT TOP 10 RTRIM(h_date) AS h_date, RTRIM(h_orderid) AS h_orderid, b_seq, RTRIM(b_goodCode) AS b_goodCode,
                     b_OrderNum AS qty, b_sumPrice AS price, RTRIM(DeptGubun) AS DeptGubun, h_offerPrice, h_superTax, FeeAmnt
              FROM ERP_SalesData WITH (NOLOCK) WHERE h_date >= @s AND h_date <= @e AND RTRIM(b_goodCode) = @c
              ORDER BY h_date DESC, b_seq`);
    const sum = sumR.recordset[0] || {};
    result.sources.erp_sales_data = {
      table: 'ERP_SalesData', meaning: '매출(주문) 데이터 — h_date 기준',
      sum_qty: Number(sum.sum_qty || 0), sum_price: Number(sum.sum_price || 0),
      row_count: Number(sum.row_count || 0), distinct_orders: Number(sum.distinct_orders || 0),
      daily: dailyR.recordset.map(r => ({ date: r.d, rows: Number(r.rows||0), qty: Number(r.qty||0), price: Number(r.price||0) })),
      sample: sampleR.recordset
    };
  } catch (e) {
    result.sources.erp_sales_data = { error: e.message };
  }

  // 2) mmInoutItem
  try {
    const sumR = await xerpPool.request()
      .input('s', ctx.sql.NChar(16), start).input('e', ctx.sql.NChar(16), endExclusive).input('c', ctx.sql.VarChar(50), code)
      .query(`SELECT RTRIM(InoutGubun) AS gubun, COUNT(*) AS row_count, ISNULL(SUM(InoutQty),0) AS sum_qty, ISNULL(SUM(InoutAmnt),0) AS sum_amnt
              FROM mmInoutItem WITH (NOLOCK) WHERE SiteCode = '${ctx.XERP_SITE_CODE}' AND InoutDate >= @s AND InoutDate < @e AND RTRIM(ItemCode) = @c
              GROUP BY RTRIM(InoutGubun)`);
    const dailyR = await xerpPool.request()
      .input('s', ctx.sql.NChar(16), start).input('e', ctx.sql.NChar(16), endExclusive).input('c', ctx.sql.VarChar(50), code)
      .query(`SELECT RTRIM(InoutDate) AS d, RTRIM(InoutGubun) AS gubun, COUNT(*) AS rows, ISNULL(SUM(InoutQty),0) AS qty, ISNULL(SUM(InoutAmnt),0) AS amnt
              FROM mmInoutItem WITH (NOLOCK) WHERE SiteCode = '${ctx.XERP_SITE_CODE}' AND InoutDate >= @s AND InoutDate < @e AND RTRIM(ItemCode) = @c
              GROUP BY RTRIM(InoutDate), RTRIM(InoutGubun) ORDER BY RTRIM(InoutDate), RTRIM(InoutGubun)`);
    const sampleR = await xerpPool.request()
      .input('s', ctx.sql.NChar(16), start).input('e', ctx.sql.NChar(16), endExclusive).input('c', ctx.sql.VarChar(50), code)
      .query(`SELECT TOP 15 RTRIM(InoutDate) AS InoutDate, RTRIM(InoutNo) AS InoutNo, InoutSeq, RTRIM(InoutGubun) AS InoutGubun,
                     RTRIM(WhCode) AS WhCode, RTRIM(ItemCode) AS ItemCode, RTRIM(ItemName) AS ItemName, InoutQty, InoutAmnt
              FROM mmInoutItem WITH (NOLOCK) WHERE SiteCode = '${ctx.XERP_SITE_CODE}' AND InoutDate >= @s AND InoutDate < @e AND RTRIM(ItemCode) = @c
              ORDER BY InoutDate DESC, InoutSeq`);
    const byGubun = {};
    for (const g of ['SO','MO','SI','MI']) byGubun[g] = { row_count: 0, sum_qty: 0, sum_amnt: 0 };
    sumR.recordset.forEach(r => {
      const g = (r.gubun || '').trim();
      if (byGubun[g]) byGubun[g] = { row_count: Number(r.row_count||0), sum_qty: Number(r.sum_qty||0), sum_amnt: Number(r.sum_amnt||0) };
    });
    result.sources.mm_inout_item = {
      table: 'mmInoutItem', meaning: '실제 입출고 트랜잭션 — InoutDate 기준',
      site: ctx.XERP_SITE_CODE, by_gubun: byGubun,
      gubun_label: { SO: '매출출고', MO: '원자재출고', SI: '매출입고(반품)', MI: '원자재입고' },
      daily: dailyR.recordset.map(r => ({ date: (r.d||'').trim(), gubun: (r.gubun||'').trim(), rows: Number(r.rows||0), qty: Number(r.qty||0), amnt: Number(r.amnt||0) })),
      sample: sampleR.recordset
    };
  } catch (e) {
    result.sources.mm_inout_item = { error: e.message };
  }

  // 3) 비교 요약
  const sales = result.sources.erp_sales_data || {};
  const inout = result.sources.mm_inout_item || {};
  const soQty = ((inout.by_gubun||{}).SO || {}).sum_qty || 0;
  const salesQty = sales.sum_qty || 0;
  result.comparison = {
    erp_sales_qty: salesQty, mm_so_qty: soQty, diff: soQty - salesQty,
    diff_pct: salesQty > 0 ? Math.round((soQty - salesQty) / salesQty * 1000) / 10 : null,
    hint: soQty > salesQty
      ? '출고(SO) > 매출 — 무상출고/사은품/덤 가능성 또는 매출 미확정 출고'
      : (soQty < salesQty ? '매출 > 출고(SO) — 분할 출고 미완료 또는 다음달 출고 예정 가능성' : '동일')
  };

  ok(res, result);
});

// ════════════════════════════════════════════════════════════════════
//  SALES PIVOT / SHIPMENTS PIVOT
// ════════════════════════════════════════════════════════════════════

// ── GET /api/sales/pivot ──
router.get('/api/sales/pivot', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const now = new Date();
  const yearsParam = (parsed.searchParams.get('years') || '').trim();
  let years = yearsParam ? yearsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(y => y >= 2000 && y <= 2100) : null;
  if (!years || years.length === 0) {
    const cy = now.getFullYear(); years = [cy - 2, cy - 1, cy];
  }
  years = [...new Set(years)].sort();
  const source = parsed.searchParams.get('source') || 'all';
  const limit = Math.min(parseInt(parsed.searchParams.get('limit') || '100', 10) || 100, 500);
  const search = (parsed.searchParams.get('search') || '').trim().toLowerCase();
  const yMin = years[0], yMax = years[years.length - 1];
  const startYMD = String(yMin) + '0101';
  const endYMD = String(yMax) + '1231';

  const productMap = {};
  const monthlyTotals = {};
  const sources = {};
  const xerpCodes = new Set();

  function addRow(code, qty, sales, ym, src) {
    if (!code) return;
    if (!productMap[code]) productMap[code] = { code, name: code, brand: '', source: src, monthly: {} };
    const m = productMap[code].monthly;
    if (!m[ym]) m[ym] = { qty: 0, sales: 0 };
    m[ym].qty += Number(qty || 0);
    m[ym].sales += Number(sales || 0);
    if (!monthlyTotals[ym]) monthlyTotals[ym] = { qty: 0, sales: 0 };
    monthlyTotals[ym].qty += Number(qty || 0);
    monthlyTotals[ym].sales += Number(sales || 0);
  }

  // XERP
  if (source === 'all' || source === 'xerp' || source === 'gift') {
    try {
      const pool = await ctx.ensureXerpPool();
      if (!pool) throw new Error('XERP pool unavailable');
      const chunks = getMonthChunks(startYMD, endYMD);
      for (const chunk of chunks) {
        const r = await pool.request()
          .input('s', ctx.sql.NVarChar(16), chunk.start)
          .input('e', ctx.sql.NVarChar(16), chunk.end)
          .query(`SELECT LEFT(h_date,6) AS ym, RTRIM(b_goodCode) AS code,
                         ISNULL(SUM(b_OrderNum),0) AS qty,
                         ISNULL(SUM(b_sumPrice),0) AS sales
                  FROM ERP_SalesData WITH (NOLOCK)
                  WHERE h_date >= @s AND h_date <= @e
                    AND b_goodCode IS NOT NULL AND LTRIM(RTRIM(b_goodCode)) != ''
                  GROUP BY LEFT(h_date,6), RTRIM(b_goodCode)`);
        for (const row of r.recordset) {
          const ym0 = (row.ym || '').trim();
          if (!ym0 || ym0.length < 6) continue;
          const ym = ym0.slice(0,4) + '-' + ym0.slice(4,6);
          const code = (row.code || '').trim();
          xerpCodes.add(code);
          addRow(code, row.qty, row.sales, ym, 'xerp');
        }
      }
      sources.xerp = 'connected';
    } catch (e) {
      console.error('Sales pivot XERP error:', e.message);
      sources.xerp = (e.message.includes('permission') || e.message.includes('denied')) ? 'access_denied' : 'error';
    }
  }

  // DD
  if (source === 'all' || source === 'dd') {
    try {
      const pool = await ctx.getDdPool();
      if (!pool) throw new Error('DD pool unavailable');
      const startISO = String(yMin) + '-01-01';
      const endISO = String(yMax + 1) + '-01-01';
      const [rows] = await pool.query(
        `SELECT DATE_FORMAT(o.created_at, '%Y-%m') AS ym, oi.product_code AS code,
                MAX(oi.product_name) AS name, IFNULL(SUM(oi.qty),0) AS qty,
                IFNULL(SUM(oi.total_money),0) AS sales
         FROM order_items oi INNER JOIN orders o ON oi.order_id = o.id
         WHERE o.created_at >= ? AND o.created_at < ? AND o.order_state != 'C'
           AND oi.product_code IS NOT NULL AND oi.product_code != ''
         GROUP BY DATE_FORMAT(o.created_at, '%Y-%m'), oi.product_code`, [startISO, endISO]);
      for (const row of rows) {
        const code = (row.code || '').trim();
        if (!productMap[code]) productMap[code] = { code, name: row.name || code, brand: 'DD', source: 'dd', monthly: {} };
        else if (!productMap[code].name || productMap[code].name === code) productMap[code].name = row.name || code;
        addRow(code, row.qty, row.sales, row.ym, 'dd');
      }
      sources.dd = 'connected';
    } catch (e) {
      console.error('Sales pivot DD error:', e.message);
      sources.dd = 'error';
    }
  }

  // bar_shop1 XERP 품목명/브랜드 매핑
  if (xerpCodes.size > 0) {
    try {
      await withBarShop1Pool(async (bar1) => {
        const codes = [...xerpCodes];
        for (let i = 0; i < codes.length; i += 500) {
          const batch = codes.slice(i, i + 500).filter(c => /^[A-Za-z0-9_\-]+$/.test(c));
          if (!batch.length) continue;
          const safe = batch.map(c => "'" + c + "'").join(',');
          const nr = await bar1.request().query(
            `SELECT RTRIM(Card_Code) AS Card_Code, Card_Name, RTRIM(CardBrand) AS CardBrand
             FROM S2_Card WHERE RTRIM(Card_Code) IN (${safe})`);
          nr.recordset.forEach(n => {
            const c = (n.Card_Code || '').trim();
            if (productMap[c]) {
              productMap[c].name = (n.Card_Name || '').trim() || c;
              productMap[c].brand = ctx.BRAND_LABELS[(n.CardBrand || '').trim()] || (n.CardBrand || '').trim() || '';
            }
          });
        }
      });
      sources.bar_shop1 = 'connected';
    } catch (e) {
      sources.bar_shop1 = 'error';
    }
  }

  let products = Object.values(productMap);
  if (search) products = products.filter(p =>
    (p.code || '').toLowerCase().includes(search) ||
    (p.name || '').toLowerCase().includes(search) ||
    (p.brand || '').toLowerCase().includes(search));
  products.forEach(p => {
    let qty = 0, sales = 0;
    const yearTotals = {};
    for (const y of years) yearTotals[y] = { qty: 0, sales: 0 };
    for (const ym of Object.keys(p.monthly)) {
      const y = parseInt(ym.slice(0, 4), 10);
      const cell = p.monthly[ym];
      qty += cell.qty; sales += cell.sales;
      if (yearTotals[y]) { yearTotals[y].qty += cell.qty; yearTotals[y].sales += cell.sales; }
    }
    p.totals = { qty, sales };
    p.yearTotals = yearTotals;
  });
  products.sort((a, b) => b.totals.sales - a.totals.sales);
  const truncated = products.length > limit;
  products = products.slice(0, limit).map((p, i) => ({ ...p, rank: i + 1 }));

  const grandTotals = { qty: 0, sales: 0, byYear: {}, byYM: monthlyTotals };
  for (const y of years) grandTotals.byYear[y] = { qty: 0, sales: 0 };
  for (const ym of Object.keys(monthlyTotals)) {
    const y = parseInt(ym.slice(0, 4), 10);
    grandTotals.qty += monthlyTotals[ym].qty;
    grandTotals.sales += monthlyTotals[ym].sales;
    if (grandTotals.byYear[y]) {
      grandTotals.byYear[y].qty += monthlyTotals[ym].qty;
      grandTotals.byYear[y].sales += monthlyTotals[ym].sales;
    }
  }

  ok(res, { years, months: [1,2,3,4,5,6,7,8,9,10,11,12], products, grandTotals, truncated, totalProducts: Object.keys(productMap).length, sources });
});

// ── GET /api/shipments/pivot ──
router.get('/api/shipments/pivot', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const xerpPool = await ctx.ensureXerpPool();
  if (!xerpPool) { fail(res, 503, 'XERP 데이터베이스 미연결'); return; }
  const now = new Date();
  const yearsParam = (parsed.searchParams.get('years') || '').trim();
  let years = yearsParam ? yearsParam.split(',').map(s => parseInt(s.trim(), 10)).filter(y => y >= 2000 && y <= 2100) : null;
  if (!years || years.length === 0) {
    const cy = now.getFullYear(); years = [cy - 2, cy - 1, cy];
  }
  years = [...new Set(years)].sort();
  const qGubun = parsed.searchParams.get('gubun') || 'SO';
  const gubunList = qGubun.split(',').map(g => g.trim()).filter(g => ['SO','MO','SI','MI'].includes(g));
  if (gubunList.length === 0) gubunList.push('SO');
  const limit = Math.min(parseInt(parsed.searchParams.get('limit') || '100', 10) || 100, 500);
  const search = (parsed.searchParams.get('search') || '').trim().toLowerCase();
  const startYMD = String(years[0]) + '0101';
  const endYMD = String(years[years.length - 1] + 1) + '0101';

  const productMap = {};
  const monthlyTotals = {};
  const sources = {};
  const codeSet = new Set();

  function addRow(code, qty, amnt, ym, name) {
    if (!code) return;
    if (!productMap[code]) productMap[code] = { code, name: name || code, brand: '', monthly: {} };
    else if ((!productMap[code].name || productMap[code].name === code) && name) productMap[code].name = name;
    const m = productMap[code].monthly;
    if (!m[ym]) m[ym] = { qty: 0, sales: 0 };
    m[ym].qty += Number(qty || 0);
    m[ym].sales += Number(amnt || 0);
    if (!monthlyTotals[ym]) monthlyTotals[ym] = { qty: 0, sales: 0 };
    monthlyTotals[ym].qty += Number(qty || 0);
    monthlyTotals[ym].sales += Number(amnt || 0);
  }

  try {
    const req2 = xerpPool.request()
      .input('s', ctx.sql.NChar(16), startYMD)
      .input('e', ctx.sql.NChar(16), endYMD);
    gubunList.forEach((g, i) => req2.input('gb' + i, ctx.sql.VarChar(4), g));
    const ph = gubunList.map((_, i) => '@gb' + i).join(',');
    const r = await req2.query(`
      SELECT LEFT(RTRIM(InoutDate),6) AS ym,
             RTRIM(ItemCode) AS code,
             MAX(RTRIM(ItemName)) AS name,
             ISNULL(SUM(InoutQty),0) AS qty,
             ISNULL(SUM(InoutAmnt),0) AS amnt
      FROM mmInoutItem WITH (NOLOCK)
      WHERE SiteCode = '${ctx.XERP_SITE_CODE}'
        AND InoutGubun IN (${ph})
        AND InoutDate >= @s AND InoutDate < @e
      GROUP BY LEFT(RTRIM(InoutDate),6), RTRIM(ItemCode)
    `);
    for (const row of r.recordset) {
      const ym0 = (row.ym || '').trim();
      if (!ym0 || ym0.length < 6) continue;
      const ym = ym0.slice(0, 4) + '-' + ym0.slice(4, 6);
      const code = (row.code || '').trim();
      codeSet.add(code);
      addRow(code, row.qty, row.amnt, ym, (row.name || '').trim());
    }
    sources.xerp = 'connected';
  } catch (e) {
    console.error('Shipments pivot XERP error:', e.message);
    sources.xerp = 'error';
    fail(res, 500, '출고현황 피벗 조회 오류: ' + e.message);
    return;
  }

  // bar_shop1 품목명/브랜드 매핑
  if (codeSet.size > 0) {
    try {
      await withBarShop1Pool(async (bar1) => {
        const codes = [...codeSet];
        for (let i = 0; i < codes.length; i += 500) {
          const batch = codes.slice(i, i + 500).filter(c => /^[A-Za-z0-9_\-]+$/.test(c));
          if (!batch.length) continue;
          const safe = batch.map(c => "'" + c + "'").join(',');
          const nr = await bar1.request().query(
            `SELECT RTRIM(Card_Code) AS Card_Code, Card_Name, RTRIM(CardBrand) AS CardBrand
             FROM S2_Card WHERE RTRIM(Card_Code) IN (${safe})`);
          nr.recordset.forEach(n => {
            const c = (n.Card_Code || '').trim();
            if (productMap[c]) {
              const nm = (n.Card_Name || '').trim();
              if (nm) productMap[c].name = nm;
              productMap[c].brand = ctx.BRAND_LABELS[(n.CardBrand || '').trim()] || (n.CardBrand || '').trim() || '';
            }
          });
        }
      });
      sources.bar_shop1 = 'connected';
    } catch (e) {
      sources.bar_shop1 = 'error';
    }
  }

  let products = Object.values(productMap);
  if (search) products = products.filter(p =>
    (p.code || '').toLowerCase().includes(search) ||
    (p.name || '').toLowerCase().includes(search) ||
    (p.brand || '').toLowerCase().includes(search));
  products.forEach(p => {
    let qty = 0, sales = 0;
    const yearTotals = {};
    for (const y of years) yearTotals[y] = { qty: 0, sales: 0 };
    for (const ym of Object.keys(p.monthly)) {
      const y = parseInt(ym.slice(0, 4), 10);
      const cell = p.monthly[ym];
      qty += cell.qty; sales += cell.sales;
      if (yearTotals[y]) { yearTotals[y].qty += cell.qty; yearTotals[y].sales += cell.sales; }
    }
    p.totals = { qty, sales };
    p.yearTotals = yearTotals;
  });
  products.sort((a, b) => b.totals.qty - a.totals.qty);
  const truncated = products.length > limit;
  products = products.slice(0, limit).map((p, i) => ({ ...p, rank: i + 1 }));

  const grandTotals = { qty: 0, sales: 0, byYear: {}, byYM: monthlyTotals };
  for (const y of years) grandTotals.byYear[y] = { qty: 0, sales: 0 };
  for (const ym of Object.keys(monthlyTotals)) {
    const y = parseInt(ym.slice(0, 4), 10);
    grandTotals.qty += monthlyTotals[ym].qty;
    grandTotals.sales += monthlyTotals[ym].sales;
    if (grandTotals.byYear[y]) {
      grandTotals.byYear[y].qty += monthlyTotals[ym].qty;
      grandTotals.byYear[y].sales += monthlyTotals[ym].sales;
    }
  }

  ok(res, { years, months: [1,2,3,4,5,6,7,8,9,10,11,12], gubun: gubunList, products, grandTotals, truncated, totalProducts: Object.keys(productMap).length, sources });
});

// ── POST /api/sales/cache/refresh ──
router.post('/api/sales/cache/refresh', async (req, res) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { fail(res, 403, '관리자 권한이 필요합니다'); return; }
  salesKpiCache = null; salesKpiCacheTime = 0;
  const d1 = await ctx.db.prepare("DELETE FROM sales_daily_cache WHERE sale_date >= date('now', '-7 days')").run();
  const d2 = await ctx.db.prepare("DELETE FROM sales_monthly_cache WHERE sale_month >= TO_CHAR(CURRENT_DATE - INTERVAL '2 months', 'YYYY-MM')").run();
  const d3 = await ctx.db.prepare("DELETE FROM sales_product_cache WHERE sale_month >= TO_CHAR(CURRENT_DATE - INTERVAL '2 months', 'YYYY-MM')").run();
  ok(res, { message: '매출 캐시 초기화 완료', deleted: { daily: d1.changes, monthly: d2.changes, product: d3.changes } });
});

// ════════════════════════════════════════════════════════════════════
//  배송추적 API (Shipping Tracking)
// ════════════════════════════════════════════════════════════════════

// ── GET /api/shipping/summary ──
router.get('/api/shipping/summary', async (req, res, parsed) => {
  const { ok } = ctx;
  const sources = { bar_shop1: 'unknown', dd: 'unknown' };
  const now = new Date();
  const fmtD = d => d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
  const s = parsed.searchParams.get('start') || fmtD(new Date(now.getFullYear(), now.getMonth(), 1));
  const e = parsed.searchParams.get('end') || fmtD(now);

  let barShipping = { total: 0, by_status: [], recent: [] };
  let ddShipping = { total: 0, by_state: [] };

  try {
    await withBarShop1Pool(async (pool) => {
      const r1 = await pool.request().input('s', s).input('e', e + ' 23:59:59')
        .query(`SELECT o.status_seq, COUNT(*) AS cnt
                FROM custom_order o WITH (NOLOCK)
                WHERE o.order_date >= @s AND o.order_date <= @e AND o.status_seq >= 1
                GROUP BY o.status_seq ORDER BY o.status_seq`);
      barShipping.by_status = r1.recordset || [];
      barShipping.total = barShipping.by_status.reduce((a,b) => a + b.cnt, 0);

      const r2 = await pool.request().input('s', s).input('e', e + ' 23:59:59')
        .query(`SELECT TOP 50 o.order_seq, o.order_date, o.status_seq, o.total_price,
                RTRIM(o.site_gubun) AS site,
                d.NAME AS recipient, d.ADDR AS address
                FROM custom_order o WITH (NOLOCK)
                LEFT JOIN DELIVERY_INFO d WITH (NOLOCK) ON o.order_seq = d.ORDER_SEQ AND d.DELIVERY_SEQ = 1
                WHERE o.order_date >= @s AND o.order_date <= @e AND o.status_seq >= 3
                ORDER BY o.order_date DESC`);
      barShipping.recent = r2.recordset || [];
    });
    sources.bar_shop1 = 'ok';
  } catch(ex) { sources.bar_shop1 = 'error'; }

  try {
    const ddPool = await ctx.getDdPool();
    if (ddPool) {
      const sDate = s.substring(0,4)+'-'+s.substring(4,6)+'-'+s.substring(6,8);
      const eDate = e.substring(0,4)+'-'+e.substring(4,6)+'-'+e.substring(6,8);
      const [rows] = await ddPool.query(`SELECT shipping_state, COUNT(*) AS cnt FROM orders
        WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND order_state != 'C'
        GROUP BY shipping_state`, [sDate, eDate]);
      ddShipping.by_state = rows || [];
      ddShipping.total = rows.reduce((a,b) => a + (b.cnt||0), 0);
      sources.dd = 'ok';
    } else { sources.dd = 'unavailable'; }
  } catch(ex) { sources.dd = 'error'; }

  const pipeline = {};
  barShipping.by_status.forEach(st => { pipeline[st.status_seq] = (pipeline[st.status_seq] || 0) + st.cnt; });

  ok(res, {
    sources, period: { start: s, end: e },
    kpi: {
      total_orders: barShipping.total + ddShipping.total,
      bar_total: barShipping.total,
      dd_total: ddShipping.total,
      shipped: (pipeline[5] || 0) + (pipeline[6] || 0),
      in_production: (pipeline[3] || 0) + (pipeline[4] || 0),
      pending: (pipeline[1] || 0) + (pipeline[2] || 0)
    },
    pipeline,
    bar_shop1: barShipping,
    dd: ddShipping
  });
});

// ── GET /api/shipping/list ──
router.get('/api/shipping/list', async (req, res, parsed) => {
  const { ok } = ctx;
  const sources = { bar_shop1: 'unknown' };
  const start = parsed.searchParams.get('start') || '';
  const end = parsed.searchParams.get('end') || '';
  const status = parsed.searchParams.get('status') || '';
  const search = parsed.searchParams.get('q') || '';
  const limit = Math.min(parseInt(parsed.searchParams.get('limit') || '100'), 500);

  const now = new Date();
  const fmtD = d => d.getFullYear() + '-' + String(d.getMonth()+1).padStart(2,'0') + '-' + String(d.getDate()).padStart(2,'0');
  const s = start || fmtD(new Date(now.getFullYear(), now.getMonth(), 1));
  const e = end || fmtD(now);

  let rows = [];
  try {
    await withBarShop1Pool(async (pool) => {
      let where = "o.order_date >= @s AND o.order_date <= @e AND o.status_seq >= 1";
      const request = pool.request().input('s', s).input('e', e + ' 23:59:59');
      if (status) { where += " AND o.status_seq = @st"; request.input('st', parseInt(status)); }
      if (search) { where += " AND (CAST(o.order_seq AS VARCHAR) LIKE @q OR d.NAME LIKE @q)"; request.input('q', '%'+search+'%'); }

      const r = await request.query(`SELECT TOP ${limit} o.order_seq, o.order_date, o.status_seq, o.total_price,
        RTRIM(o.site_gubun) AS site, RTRIM(o.pay_Type) AS pay_type,
        d.NAME AS recipient, RTRIM(d.ADDR) AS address, d.HPHONE AS phone,
        (SELECT COUNT(*) FROM custom_order_item i WITH (NOLOCK) WHERE i.order_seq = o.order_seq) AS item_count
        FROM custom_order o WITH (NOLOCK)
        LEFT JOIN DELIVERY_INFO d WITH (NOLOCK) ON o.order_seq = d.ORDER_SEQ AND d.DELIVERY_SEQ = 1
        WHERE ${where} ORDER BY o.order_date DESC`);
      rows = r.recordset || [];
    });
    sources.bar_shop1 = 'ok';
  } catch(ex) { sources.bar_shop1 = 'error'; }

  ok(res, { sources, rows });
});

// ── GET /api/shipping/dd-list ──
router.get('/api/shipping/dd-list', async (req, res, parsed) => {
  const { ok } = ctx;
  const sources = { dd: 'unknown' };
  const start = parsed.searchParams.get('start') || '';
  const end = parsed.searchParams.get('end') || '';
  const limit = Math.min(parseInt(parsed.searchParams.get('limit') || '100'), 500);
  let rows = [];
  try {
    const ddPool = await ctx.getDdPool();
    if (ddPool) {
      const now = new Date();
      const s = start || (now.getFullYear()+'-'+String(now.getMonth()+1).padStart(2,'0')+'-01');
      const e = end || now.toISOString().slice(0,10);
      const [r] = await ddPool.query(`SELECT id, order_number, order_state, shipping_state,
        total_money, created_at, cj_invoice_numbers
        FROM orders WHERE created_at >= ? AND created_at < DATE_ADD(?, INTERVAL 1 DAY) AND order_state != 'C'
        ORDER BY created_at DESC LIMIT ?`, [s, e, limit]);
      rows = r || [];
      sources.dd = 'ok';
    } else { sources.dd = 'unavailable'; }
  } catch(ex) { sources.dd = 'error'; }

  ok(res, { sources, rows });
});

module.exports = { router };
