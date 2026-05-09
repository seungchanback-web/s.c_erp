// routes/accounting.js — 회계/재무 라우트 모듈
// purchase-closing, receipts, invoices, ledger-map, settlements,
// tax-invoice, acct(복식부기), closing-verify, closing-vendor-items
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ── 모듈 로컬 캐시 ──
let acctStatsCache = null, acctStatsCacheTime = 0;
let trialBalanceCache = null, trialBalanceCacheTime = 0;
const ACCT_CACHE_TTL = 30 * 60 * 1000; // 30분

// ── 계정 분류 헬퍼 ──
function classifyAccount(code) {
  const c = code.replace(/\s/g, '');
  const first = c.charAt(0);
  const first2 = c.substring(0, 2);
  let acc_type = '', acc_group = '', sort_order = 0;
  if (first === '1') {
    acc_type = 'asset';
    if (first2 === '11') { acc_group = '유동자산'; sort_order = 1000; }
    else { acc_group = '비유동자산'; sort_order = 2000; }
  } else if (first === '2') {
    acc_type = 'liability';
    if (first2 === '21') { acc_group = '유동부채'; sort_order = 3000; }
    else { acc_group = '비유동부채'; sort_order = 4000; }
  } else if (first === '3') {
    acc_type = 'equity'; acc_group = '자본'; sort_order = 5000;
  } else if (first === '4' || first2 === '61') {
    acc_type = 'revenue'; acc_group = '매출'; sort_order = 6000;
  } else if (first === '5' || first2 === '51') {
    acc_type = 'expense'; acc_group = '매출원가'; sort_order = 7000;
  } else if (first2 === '64') {
    acc_type = 'revenue'; acc_group = '영업외수익'; sort_order = 6500;
  } else if (first === '6') {
    acc_type = 'revenue'; acc_group = '매출'; sort_order = 6000;
  } else if (first2 === '71' || first2 === '72' || first2 === '73') {
    acc_type = 'expense'; acc_group = '판매비와관리비'; sort_order = 8000;
  } else if (first2 === '74') {
    acc_type = 'expense'; acc_group = '영업외비용'; sort_order = 8500;
  } else if (first === '7') {
    acc_type = 'expense'; acc_group = '비용'; sort_order = 8000;
  } else if (first === '8') {
    acc_type = 'expense'; acc_group = '법인세비용'; sort_order = 9000;
  } else {
    acc_type = 'other'; acc_group = '기타'; sort_order = 9999;
  }
  const parent_code = c.substring(0, 5);
  const depth = c.length <= 5 ? 1 : (c.length <= 6 ? 2 : 3);
  const name = (ctx.KNOWN_ACCOUNTS || {})[c] || '';
  return { acc_type, acc_group, parent_code, depth, sort_order, acc_name: name };
}

// ════════════════════════════════════════════════════════════════════
//  구매마감 API (Purchase Closing)
// ════════════════════════════════════════════════════════════════════

// GET /api/purchase-closing — 월별 업체별 마감 데이터 조회
router.get('/api/purchase-closing', async (req, res, parsed) => {
  const { db, ok, fail } = ctx;
  try {
    const year = parseInt(parsed.searchParams.get('year')) || new Date().getFullYear();
    const month = parseInt(parsed.searchParams.get('month')) || new Date().getMonth() + 1;
    const entity = parsed.searchParams.get('entity') || 'all';
    const monthStr = `${year}-${String(month).padStart(2,'0')}`;
    const nextMonth = month === 12 ? `${year+1}-01` : `${year}-${String(month+1).padStart(2,'0')}`;

    let entityWhere = '';
    if (entity === 'barunson') entityWhere = "AND h.legal_entity = 'barunson'";
    else if (entity === 'dd') entityWhere = "AND h.legal_entity = 'dd'";

    let hasAmountCol = false;
    try { await db.prepare('SELECT amount FROM po_items LIMIT 1').get(); hasAmountCol = true; } catch(e) {}

    const amtSelect = hasAmountCol
      ? ', SUM(COALESCE(i.amount,0)) AS sys_amount, SUM(COALESCE(i.tax_amount,0)) AS sys_tax'
      : ', 0 AS sys_amount, 0 AS sys_tax';

    const rows = await db.prepare(`
      SELECT h.vendor_name,
             h.legal_entity,
             h.po_type,
             COUNT(DISTINCT h.po_id) AS po_count,
             SUM(i.ordered_qty) AS total_ordered,
             SUM(COALESCE(i.received_qty,0)) AS total_received,
             SUM(COALESCE(i.produced_qty,0)) AS total_produced,
             SUM(COALESCE(i.defect_qty,0)) AS total_defect
             ${amtSelect}
      FROM po_header h
      JOIN po_items i ON h.po_id = i.po_id
      WHERE h.status NOT IN ('cancelled','draft')
        AND h.po_date >= ? AND h.po_date < ?
        ${entityWhere}
      GROUP BY h.vendor_name, h.legal_entity, h.po_type
      ORDER BY h.legal_entity, h.vendor_name
    `).all(monthStr + '-01', nextMonth + '-01');

    // 거래명세서에서 금액 가져오기
    const amountRaw = await db.prepare(`
      SELECT td.vendor_name, h.legal_entity, td.items_json
      FROM trade_document td
      JOIN po_header h ON td.po_id = h.po_id
      WHERE h.po_date >= ? AND h.po_date < ?
        AND td.status NOT IN ('cancelled','rejected')
        ${entityWhere}
    `).all(monthStr + '-01', nextMonth + '-01');
    const amountMap = {};
    for (const r of amountRaw) {
      const key = `${r.vendor_name}|${r.legal_entity}`;
      let amt = 0;
      try {
        if (r.items_json) {
          const items = JSON.parse(r.items_json);
          if (Array.isArray(items)) items.forEach(it => { amt += Number(it.amount) || 0; });
        }
      } catch(e) {}
      amountMap[key] = (amountMap[key] || 0) + amt;
    }

    // 기존 마감 상태
    const closingMap = {};
    try {
      const closings = await db.prepare(`
        SELECT * FROM purchase_closing
        WHERE closing_year = ? AND closing_month = ?
        ${entity !== 'all' ? "AND legal_entity = '" + entity + "'" : ''}
      `).all(year, month);
      for (const c of closings) {
        closingMap[`${c.vendor_name}|${c.legal_entity}`] = c;
      }
    } catch(e) {}

    // 첨부파일 금액
    const uploadAmtMap = {};
    try {
      const uploadRows = await db.prepare(`SELECT vendor_name, legal_entity, SUM(parsed_total) AS vendor_total, SUM(parsed_tax) AS vendor_tax FROM purchase_closing_files WHERE closing_year=? AND closing_month=? GROUP BY vendor_name, legal_entity`).all(year, month);
      for (const u of uploadRows) { uploadAmtMap[`${u.vendor_name}|${u.legal_entity}`] = { total: u.vendor_total||0, tax: u.vendor_tax||0 }; }
    } catch(e) {}

    const vendors = rows.map(r => {
      const key = `${r.vendor_name}|${r.legal_entity}`;
      const closing = closingMap[key] || null;
      const upload = uploadAmtMap[key] || null;
      const sysAmt = parseFloat(r.sys_amount) || 0;
      const sysTax = parseFloat(r.sys_tax) || 0;
      const vendorAmt = upload ? parseFloat(upload.total) : 0;
      const vendorTax = upload ? parseFloat(upload.tax) : 0;
      return {
        vendor_name: r.vendor_name,
        legal_entity: r.legal_entity,
        po_type: r.po_type,
        po_count: r.po_count,
        total_ordered: r.total_ordered || 0,
        total_received: r.total_received || 0,
        total_produced: r.total_produced || 0,
        total_defect: r.total_defect || 0,
        sys_amount: sysAmt,
        sys_tax: sysTax,
        vendor_amount: vendorAmt,
        vendor_tax: vendorTax,
        diff_amount: sysAmt > 0 && vendorAmt > 0 ? sysAmt - vendorAmt : 0,
        has_upload: !!upload,
        total_amount: amountMap[key] || 0,
        closing_status: closing ? closing.status : 'open',
        closing_id: closing ? closing.id : null,
        confirmed_at: closing ? closing.confirmed_at : '',
        final_amount: closing ? closing.final_amount : sysAmt,
        adjustment_amount: closing ? closing.adjustment_amount : 0,
        notes: closing ? closing.notes : ''
      };
    });

    ok(res, { vendors, year, month, entity });
  } catch(e) {
    console.error('구매마감 조회 오류:', e.message);
    ctx.fail(res, 500, '구매마감 조회 오류: ' + e.message);
  }
});

// GET /api/purchase-closing/detail — 업체별 상세 PO 품목 목록
router.get('/api/purchase-closing/detail', async (req, res, parsed) => {
  const { db, ok, fail } = ctx;
  try {
    const year = parseInt(parsed.searchParams.get('year')) || new Date().getFullYear();
    const month = parseInt(parsed.searchParams.get('month')) || new Date().getMonth() + 1;
    const vendorName = parsed.searchParams.get('vendor');
    const entity = parsed.searchParams.get('entity') || 'barunson';
    if (!vendorName) { fail(res, 400, '거래처명 필수'); return; }

    const monthStr = `${year}-${String(month).padStart(2,'0')}`;
    const nextMonth = month === 12 ? `${year+1}-01` : `${year}-${String(month+1).padStart(2,'0')}`;

    let _hasAmt = false;
    try { await db.prepare('SELECT amount FROM po_items LIMIT 1').get(); _hasAmt = true; } catch(e) {}

    const priceSelect = _hasAmt
      ? ', COALESCE(i.unit_price,0) AS unit_price, COALESCE(i.amount,0) AS amount, COALESCE(i.tax_amount,0) AS tax_amount, COALESCE(i.received_date,\'\') AS received_date'
      : ', 0 AS unit_price, 0 AS amount, 0 AS tax_amount, \'\' AS received_date';

    const pos = await db.prepare(`
      SELECT h.po_id, h.po_number, h.po_type, h.status, h.po_date, h.total_qty,
             i.item_id, i.product_code, i.brand, i.process_type, i.spec,
             i.ordered_qty, COALESCE(i.received_qty,0) AS received_qty,
             COALESCE(i.produced_qty,0) AS produced_qty,
             COALESCE(i.defect_qty,0) AS defect_qty,
             i.ship_date
             ${priceSelect}
      FROM po_header h
      JOIN po_items i ON h.po_id = i.po_id
      WHERE h.vendor_name = ? AND h.legal_entity = ?
        AND h.status NOT IN ('cancelled','draft')
        AND h.po_date >= ? AND h.po_date < ?
      ORDER BY h.po_date DESC, h.po_id DESC, i.item_id
    `).all(vendorName, entity, monthStr + '-01', nextMonth + '-01');

    // 품목명 보충
    const xerpItemNameCache = ctx.xerpItemNameCache || {};
    for (const p of pos) {
      const code = (p.product_code||'').trim();
      p.product_name = (xerpItemNameCache[code]) || '';
      if (!p.product_name) {
        try {
          const lp = await db.prepare('SELECT product_name, material_name FROM products WHERE product_code=?').get(code);
          if (lp) p.product_name = (lp.product_name||'').trim() || (lp.material_name||'').trim();
        } catch(e) {}
      }
    }

    // 첨부파일 목록
    let files = [];
    try {
      files = await db.prepare(`SELECT * FROM purchase_closing_files WHERE closing_year=? AND closing_month=? AND vendor_name=? AND legal_entity=? ORDER BY uploaded_at DESC`).all(year, month, vendorName, entity);
    } catch(e) {}

    let sysTotal = 0, sysTax = 0;
    for (const p of pos) {
      sysTotal += parseFloat(p.amount) || 0;
      sysTax += parseFloat(p.tax_amount) || 0;
    }

    ok(res, { items: pos, vendor_name: vendorName, entity, year, month, files, sys_total: sysTotal, sys_tax: sysTax });
  } catch(e) {
    fail(res, 500, '구매마감 상세 오류: ' + e.message);
  }
});

// POST /api/purchase-closing/update-price — 품목별 단가/금액 수정
router.post('/api/purchase-closing/update-price', async (req, res, parsed) => {
  const { db, ok, fail, readJSON } = ctx;
  try {
    const body = await readJSON(req);
    const { item_id, unit_price, amount, tax_amount, received_date } = body;
    if (!item_id) { fail(res, 400, 'item_id 필수'); return; }
    const up = parseFloat(unit_price) || 0;
    const amt = parseFloat(amount) || 0;
    const tax = parseFloat(tax_amount) || 0;
    const rd = received_date || '';
    await db.prepare(`UPDATE po_items SET unit_price=?, amount=?, tax_amount=?, received_date=? WHERE item_id=?`).run(up, amt, tax, rd, item_id);
    ok(res, { message: '단가 수정 완료', item_id, unit_price: up, amount: amt, tax_amount: tax });
  } catch(e) {
    fail(res, 500, '단가 수정 오류: ' + e.message);
  }
});

// POST /api/purchase-closing/upload — 세금계산서/거래명세서 파일 업로드
router.post('/api/purchase-closing/upload', async (req, res, parsed) => {
  const { db, ok, fail, path } = ctx;
  try {
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) {
      fail(res, 400, 'multipart/form-data 필요'); return;
    }
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) { fail(res, 400, 'boundary 없음'); return; }

    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    const sep = Buffer.from('--' + boundary);

    // 파트 파싱
    const fields = {};
    let fileData = null, fileName = '', fileType = '';
    const parts = [];
    let start = 0;
    while (true) {
      const idx = buf.indexOf(sep, start);
      if (idx === -1) break;
      if (start > 0) parts.push(buf.slice(start, idx - 2));
      start = idx + sep.length + 2;
    }
    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const header = part.slice(0, headerEnd).toString('utf8');
      const body = part.slice(headerEnd + 4);
      const nameMatch = header.match(/name="([^"]+)"/);
      const fileMatch = header.match(/filename="([^"]+)"/);
      if (nameMatch) {
        if (fileMatch) {
          fileData = body;
          fileName = fileMatch[1];
          const ctMatch = header.match(/Content-Type:\s*(.+)/i);
          fileType = ctMatch ? ctMatch[1].trim() : '';
        } else {
          fields[nameMatch[1]] = body.toString('utf8').trim();
        }
      }
    }

    if (!fileData || !fileName) { fail(res, 400, '파일이 없습니다'); return; }
    const vendor = fields.vendor_name || '';
    const entity = fields.legal_entity || 'barunson';
    const yr = parseInt(fields.year) || new Date().getFullYear();
    const mo = parseInt(fields.month) || new Date().getMonth() + 1;
    if (!vendor) { fail(res, 400, 'vendor_name 필수'); return; }

    // 파일 저장
    const uploadDir = process.env.UPLOAD_DIR || path.join(ctx.__dir, 'uploads');
    const closingDir = path.join(uploadDir, 'closing', `${yr}-${String(mo).padStart(2,'0')}`);
    const fs = require('fs');
    if (!fs.existsSync(closingDir)) fs.mkdirSync(closingDir, { recursive: true });
    const safeName = `${entity}_${vendor}_${Date.now()}_${fileName.replace(/[^a-zA-Z0-9가-힣._-]/g, '_')}`;
    const filePath = path.join(closingDir, safeName);
    fs.writeFileSync(filePath, fileData);

    // 엑셀 파싱 시도
    let parsedTotal = 0, parsedTax = 0, parsedData = [];
    const ext = path.extname(fileName).toLowerCase();
    if (ext === '.xlsx' || ext === '.xls') {
      try {
        const XLSX = require('xlsx');
        const wb = XLSX.read(fileData, { type: 'buffer' });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: '' });
        const amtKeys = ['금액','공급가액','공급가','amount','supply_amount','합계금액'];
        const taxKeys = ['세액','부가세','vat','tax','tax_amount'];
        for (const row of rows) {
          let amt = 0, tax = 0;
          for (const [k,v] of Object.entries(row)) {
            const kl = k.toLowerCase().replace(/\s/g,'');
            if (amtKeys.some(a => kl.includes(a))) amt = parseFloat(String(v).replace(/,/g,'')) || 0;
            if (taxKeys.some(t => kl.includes(t))) tax = parseFloat(String(v).replace(/,/g,'')) || 0;
          }
          if (amt > 0 || tax > 0) {
            parsedTotal += amt;
            parsedTax += tax;
            parsedData.push(row);
          }
        }
      } catch(e) { console.warn('엑셀 파싱 실패:', e.message); }
    }

    // DB 저장
    await db.prepare(`INSERT INTO purchase_closing_files (closing_year, closing_month, legal_entity, vendor_name, file_name, file_path, file_type, file_size, parsed_total, parsed_tax, parsed_data) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
      yr, mo, entity, vendor, fileName, filePath, fileType, fileData.length,
      parsedTotal, parsedTax, JSON.stringify(parsedData)
    );

    ok(res, { message: '파일 업로드 완료', file_name: fileName, parsed_total: parsedTotal, parsed_tax: parsedTax, parsed_rows: parsedData.length });
  } catch(e) {
    console.error('파일 업로드 오류:', e.message);
    fail(res, 500, '파일 업로드 오류: ' + e.message);
  }
});

// DELETE /api/purchase-closing/file/:id — 첨부파일 삭제
router.delP(/^\/api\/purchase-closing\/file\/(\d+)$/, async (req, res, parsed, m) => {
  const { db, ok, fail } = ctx;
  try {
    const fileId = parseInt(m[1]);
    if (!fileId) { fail(res, 400, 'file id 필수'); return; }
    const f = await db.prepare('SELECT file_path FROM purchase_closing_files WHERE id=?').get(fileId);
    if (f && f.file_path) {
      const fs = require('fs');
      try { fs.unlinkSync(f.file_path); } catch(e) {}
    }
    await db.prepare('DELETE FROM purchase_closing_files WHERE id=?').run(fileId);
    ok(res, { message: '파일 삭제 완료' });
  } catch(e) {
    fail(res, 500, '파일 삭제 오류: ' + e.message);
  }
});

// POST /api/purchase-closing/confirm — 마감 확정
router.post('/api/purchase-closing/confirm', async (req, res, parsed) => {
  const { db, ok, fail, readJSON } = ctx;
  try {
    const body = await readJSON(req);
    const { vendor_name, legal_entity, year, month, notes } = body;
    if (!vendor_name || !year || !month) { fail(res, 400, '필수 값 누락'); return; }
    const ent = legal_entity || 'barunson';

    const monthStr = `${year}-${String(month).padStart(2,'0')}`;
    const nextMonth = month === 12 ? `${year+1}-01` : `${year}-${String(month+1).padStart(2,'0')}`;

    const agg = await db.prepare(`
      SELECT COUNT(DISTINCT h.po_id) AS po_count,
             SUM(i.ordered_qty) AS total_ordered,
             SUM(COALESCE(i.received_qty,0)) AS total_received,
             SUM(COALESCE(i.defect_qty,0)) AS total_defect
      FROM po_header h JOIN po_items i ON h.po_id = i.po_id
      WHERE h.vendor_name = ? AND h.legal_entity = ?
        AND h.status NOT IN ('cancelled','draft')
        AND h.po_date >= ? AND h.po_date < ?
    `).get(vendor_name, ent, monthStr + '-01', nextMonth + '-01');

    const amtRaw = await db.prepare(`
      SELECT td.items_json FROM trade_document td
      JOIN po_header h ON td.po_id = h.po_id
      WHERE td.vendor_name = ? AND h.legal_entity = ?
        AND h.po_date >= ? AND h.po_date < ?
        AND td.status NOT IN ('cancelled','rejected')
    `).all(vendor_name, ent, monthStr + '-01', nextMonth + '-01');
    let totalAmount = 0;
    for (const ar of amtRaw) {
      try {
        if (ar.items_json) {
          const items = JSON.parse(ar.items_json);
          if (Array.isArray(items)) items.forEach(it => { totalAmount += Number(it.amount) || 0; });
        }
      } catch(e) {}
    }

    await db.prepare(`
      INSERT INTO purchase_closing (legal_entity, vendor_name, closing_year, closing_month,
        po_count, total_ordered_qty, total_received_qty, total_defect_qty,
        total_amount, final_amount, status, confirmed_at, notes)
      VALUES (?,?,?,?,?,?,?,?,?,?,'confirmed',datetime('now','localtime'),?)
      ON CONFLICT(legal_entity, vendor_name, closing_year, closing_month)
      DO UPDATE SET po_count=excluded.po_count, total_ordered_qty=excluded.total_ordered_qty,
        total_received_qty=excluded.total_received_qty, total_defect_qty=excluded.total_defect_qty,
        total_amount=excluded.total_amount, final_amount=excluded.final_amount,
        status='confirmed', confirmed_at=datetime('now','localtime'),
        notes=excluded.notes, updated_at=datetime('now','localtime')
    `).run(ent, vendor_name, year, month,
      agg.po_count||0, agg.total_ordered||0, agg.total_received||0, agg.total_defect||0,
      totalAmount, totalAmount, notes||'');

    ok(res, { message: '마감 확정 완료' });
  } catch(e) {
    fail(res, 500, '마감 확정 오류: ' + e.message);
  }
});

// POST /api/purchase-closing/reopen — 마감 해제
router.post('/api/purchase-closing/reopen', async (req, res, parsed) => {
  const { db, ok, fail, readJSON } = ctx;
  try {
    const body = await readJSON(req);
    const { closing_id } = body;
    if (!closing_id) { fail(res, 400, 'closing_id 필수'); return; }
    await db.prepare(`UPDATE purchase_closing SET status='open', updated_at=datetime('now','localtime') WHERE id=?`).run(closing_id);
    ok(res, { message: '마감 해제 완료' });
  } catch(e) {
    fail(res, 500, '마감 해제 오류: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  입고 API (Receipts)
// ════════════════════════════════════════════════════════════════════

// GET /api/receipts
router.get('/api/receipts', async (req, res, parsed) => {
  const { db, ok } = ctx;
  const qs = Object.fromEntries(new URL(req.url, 'http://localhost').searchParams);

  // legal_entity 컬럼 존재 여부
  let _rcvEntCol = '';
  try { await db.prepare('SELECT legal_entity FROM po_header LIMIT 1').get(); _rcvEntCol = ', h.legal_entity'; } catch(e) {}

  let sql = `
    SELECT r.id as receipt_id, r.po_id, r.receipt_date, r.received_by, r.notes, r.created_at,
           r.batch_no, h.po_number, h.vendor_name, h.origin${_rcvEntCol}
    FROM receipts r
    LEFT JOIN po_header h ON r.po_id = h.po_id
  `;
  const conditions = [];
  const params = [];
  if (qs.po_id) { conditions.push('r.po_id = $' + (params.length+1)); params.push(parseInt(qs.po_id)); }
  if (qs.origin) { conditions.push('h.origin = $' + (params.length+1)); params.push(qs.origin); }
  if (qs.entity && qs.entity !== 'all' && _rcvEntCol) { conditions.push('h.legal_entity = $' + (params.length+1)); params.push(qs.entity); }
  if (conditions.length) sql += ' WHERE ' + conditions.join(' AND ');
  sql += ' ORDER BY r.created_at DESC';
  const rows = params.length ? await db.prepare(sql).all(...params) : await db.prepare(sql).all();
  const itemStmt = db.prepare('SELECT * FROM receipt_items WHERE receipt_id = $1');
  for (const r of rows) {
    r.items = await itemStmt.all(r.receipt_id);
  }
  ok(res, rows);
});

// POST /api/receipts
router.post('/api/receipts', async (req, res, parsed) => {
  const { db, ok, fail, readJSON } = ctx;
  const body = await readJSON(req);
  if (!body.po_id) { fail(res, 400, 'po_id required'); return; }
  const items = body.items || [];

  const tx = db.transaction(async () => {
    const rInfo = await db.prepare(`INSERT INTO receipts (po_id, received_by, notes, batch_no) VALUES (?, ?, ?, ?)`).run(
      body.po_id, body.received_by || '', body.notes || '', body.batch_no || 1
    );
    const receiptId = rInfo.lastInsertRowid;

    const riStmt = db.prepare(`INSERT INTO receipt_items (receipt_id, po_item_id, product_code, received_qty, defect_qty, notes) VALUES (?, ?, ?, ?, ?, ?)`);
    const updatePoItem = db.prepare(`UPDATE po_items SET received_qty = received_qty + ? WHERE item_id = ?`);

    for (const it of items) {
      let poItemId = it.po_item_id || null;
      if (!poItemId && it.product_code && body.po_id) {
        const match = await db.prepare('SELECT item_id FROM po_items WHERE po_id=? AND product_code=? LIMIT 1').get(body.po_id, it.product_code);
        if (match) poItemId = match.item_id;
      }
      await riStmt.run(receiptId, poItemId, it.product_code || '', it.received_qty || 0, it.defect_qty || 0, it.notes || '');
      if (poItemId && it.received_qty) {
        await updatePoItem.run(it.received_qty, poItemId);
      }
    }

    const poItems = await db.prepare('SELECT ordered_qty, received_qty FROM po_items WHERE po_id = ?').all(body.po_id);
    const allReceived = poItems.length > 0 && poItems.every(pi => pi.received_qty >= pi.ordered_qty);
    const anyReceived = poItems.some(pi => pi.received_qty > 0);

    if (allReceived) {
      await db.prepare(`UPDATE po_header SET status = 'received', process_status = 'completed', material_status = 'received', updated_at = datetime('now','localtime') WHERE po_id = ?`).run(body.po_id);
    } else if (anyReceived) {
      await db.prepare(`UPDATE po_header SET status = 'partial', process_status = 'working', updated_at = datetime('now','localtime') WHERE po_id = ?`).run(body.po_id);
    }

    return receiptId;
  });
  const receiptId = await tx();

  // XERP 캐시 무효화
  ctx.xerpInventoryCacheTime = 0;

  ok(res, { receipt_id: receiptId });
});

// ════════════════════════════════════════════════════════════════════
//  송장 API (Invoices)
// ════════════════════════════════════════════════════════════════════

// GET /api/invoices
router.get('/api/invoices', async (req, res, parsed) => {
  const { db, ok } = ctx;
  const rows = await db.prepare('SELECT * FROM invoices ORDER BY created_at DESC').all();
  for (const inv of rows) {
    inv.items = await db.prepare('SELECT * FROM invoice_items WHERE invoice_id = ?').all(inv.invoice_id);
  }
  ok(res, rows);
});

// POST /api/invoices
router.post('/api/invoices', async (req, res, parsed) => {
  const { db, ok, fail, readBody, path, fs } = ctx;
  const ct = req.headers['content-type'] || '';
  const boundaryMatch = ct.match(/boundary=(.+)/);
  if (!boundaryMatch) { fail(res, 400, 'Multipart boundary required'); return; }

  const buf = await readBody(req);
  const parts = ctx.parseMultipart(buf, boundaryMatch[1]);

  let filePath = '';
  let fileName = '';

  const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ctx.__dir, 'uploads');
  const UPLOAD_ROOT = path.join(UPLOAD_DIR, 'invoices');

  if (parts.file && parts.file.data) {
    const now = new Date();
    const ym = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    const dir = path.join(UPLOAD_ROOT, ym);
    fs.mkdirSync(dir, { recursive: true });

    const ts = Date.now();
    const ext = path.extname(parts.file.filename) || '';
    const safeName = ts + ext;
    const fullPath = path.join(dir, safeName);
    fs.writeFileSync(fullPath, parts.file.data);
    filePath = path.relative(UPLOAD_DIR, fullPath).replace(/\\/g, '/');
    fileName = parts.file.filename;
  }

  let items = [];
  try { if (parts.items) items = JSON.parse(parts.items); } catch(_) {}

  const tx = db.transaction(async () => {
    const info = await db.prepare(`INSERT INTO invoices (po_id, vendor_name, invoice_no, invoice_date, amount, file_path, file_name, notes) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
      parts.po_id ? parseInt(parts.po_id) : null,
      parts.vendor_name || '',
      parts.invoice_no || '',
      parts.invoice_date || '',
      parts.amount ? parseFloat(parts.amount) : 0,
      filePath,
      fileName,
      parts.notes || ''
    );
    const invId = info.lastInsertRowid;
    if (items.length) {
      const stmt = db.prepare(`INSERT INTO invoice_items (invoice_id, product_code, product_name, qty, unit_price, amount, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
      for (const it of items) {
        await stmt.run(invId, it.product_code || '', it.product_name || '', it.qty || 0, it.unit_price || 0, it.amount || 0, it.notes || '');
      }
    }
    return invId;
  });
  const invId = await tx();
  ok(res, { invoice_id: invId, file_path: filePath });
});

// GET /api/invoices/:id/file
router.getP(/^\/api\/invoices\/(\d+)\/file$/, async (req, res, parsed, m) => {
  const { db, ok, fail, path, fs, CORS, MIME } = ctx;
  const id = parseInt(m[1]);
  const inv = await db.prepare('SELECT file_path, file_name FROM invoices WHERE invoice_id = ?').get(id);
  if (!inv || !inv.file_path) { fail(res, 404, 'File not found'); return; }
  const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ctx.__dir, 'uploads');
  const fullPath = path.join(UPLOAD_DIR, inv.file_path);
  if (!fs.existsSync(fullPath)) { fail(res, 404, 'File missing from disk'); return; }
  const ext = path.extname(inv.file_name || inv.file_path);
  const ct2 = MIME[ext.toLowerCase()] || 'application/octet-stream';
  res.writeHead(200, {
    'Content-Type': ct2,
    'Content-Disposition': `inline; filename="${encodeURIComponent(inv.file_name || 'file')}"`,
    ...CORS,
  });
  fs.createReadStream(fullPath).pipe(res);
});

// DELETE /api/invoices/:id
router.delP(/^\/api\/invoices\/(\d+)$/, async (req, res, parsed, m) => {
  const { db, ok, fail, path, fs } = ctx;
  const id = parseInt(m[1]);
  const inv = await db.prepare('SELECT file_path FROM invoices WHERE invoice_id = ?').get(id);
  if (!inv) { fail(res, 404, 'Invoice not found'); return; }
  if (inv.file_path) {
    const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(ctx.__dir, 'uploads');
    const fullPath = path.join(UPLOAD_DIR, inv.file_path);
    try { fs.unlinkSync(fullPath); } catch (_) {}
  }
  await db.prepare('DELETE FROM invoice_items WHERE invoice_id = ?').run(id);
  await db.prepare('DELETE FROM invoices WHERE invoice_id = ?').run(id);
  ok(res, { deleted: id });
});

// ════════════════════════════════════════════════════════════════════
//  원장 매핑 API (Ledger Code Map)
// ════════════════════════════════════════════════════════════════════

// GET /api/ledger-map
router.get('/api/ledger-map', async (req, res, parsed) => {
  const { db, ok, fail } = ctx;
  try {
    const vendorCode = parsed.searchParams.get('vendor_code') || '';
    let rows;
    if (vendorCode) {
      rows = await db.prepare('SELECT * FROM ledger_code_map WHERE vendor_code=? ORDER BY vendor_item_code').all(vendorCode);
    } else {
      rows = await db.prepare('SELECT * FROM ledger_code_map ORDER BY vendor_code, vendor_item_code').all();
    }
    ok(res, rows);
  } catch (e) { fail(res, 500, e.message); }
});

// POST /api/ledger-map
router.post('/api/ledger-map', async (req, res, parsed) => {
  const { db, ok, fail, readJSON } = ctx;
  try {
    const b = await readJSON(req);
    const items = b.items || [];
    for (const it of items) {
      if (!it.vendor_code || !it.vendor_item_code || !it.xerp_item_code) continue;
      await db.prepare("INSERT INTO ledger_code_map (vendor_code, vendor_item_code, vendor_item_name, xerp_item_code, xerp_item_name) VALUES (?,?,?,?,?) ON CONFLICT(vendor_code, vendor_item_code) DO UPDATE SET xerp_item_code=excluded.xerp_item_code, xerp_item_name=excluded.xerp_item_name, vendor_item_name=excluded.vendor_item_name").run(
        it.vendor_code, it.vendor_item_code, it.vendor_item_name || '', it.xerp_item_code, it.xerp_item_name || ''
      );
    }
    ok(res, { saved: items.length });
  } catch (e) { fail(res, 500, e.message); }
});

// DELETE /api/ledger-map
router.del('/api/ledger-map', async (req, res, parsed) => {
  const { db, ok, fail, readJSON } = ctx;
  try {
    const b = await readJSON(req);
    await db.prepare('DELETE FROM ledger_code_map WHERE vendor_code=? AND vendor_item_code=?').run(b.vendor_code, b.vendor_item_code);
    ok(res, { deleted: true });
  } catch (e) { fail(res, 500, e.message); }
});

// ════════════════════════════════════════════════════════════════════
//  매입금액 검증 API (Closing Verify)
// ════════════════════════════════════════════════════════════════════

// GET /api/closing-verify — XERP 실데이터 vs 화면 데이터 비교
router.get('/api/closing-verify', async (req, res, parsed) => {
  const { db, ok, fail, sql } = ctx;
  if (!await ctx.ensureXerpPool()) { fail(res, 503, 'XERP 미연결'); return; }
  try {
    const xerpPool = ctx.getXerpPool();
    const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
    const year = parsed.searchParams.get('year') || '2026';
    const month = parsed.searchParams.get('month') || '2';
    const prevYear = (parseInt(year) - 1).toString();
    const moStr = month.padStart(2, '0');

    const xReq = xerpPool.request();
    xReq.input('fromDate', sql.NChar(16), prevYear + '0101');
    xReq.input('toDate', sql.NChar(16), year + moStr + '31');

    const result = await xReq.query(`
      SELECT RTRIM(h.CsCode) AS vendor_code,
             LEFT(h.OrderDate,4) AS yr,
             SUBSTRING(h.OrderDate,5,2) AS mo,
             SUM(i.OrderAmnt) AS amt
      FROM poOrderHeader h WITH (NOLOCK)
      JOIN poOrderItem i WITH (NOLOCK) ON h.SiteCode=i.SiteCode AND h.OrderNo=i.OrderNo
      WHERE h.SiteCode = '${XERP_SITE_CODE}'
        AND h.OrderDate >= @fromDate AND h.OrderDate <= @toDate
      GROUP BY RTRIM(h.CsCode), LEFT(h.OrderDate,4), SUBSTRING(h.OrderDate,5,2)
      ORDER BY RTRIM(h.CsCode), LEFT(h.OrderDate,4), SUBSTRING(h.OrderDate,5,2)
    `);

    const vendors = {};
    for (const r of result.recordset) {
      const vc = (r.vendor_code || '').trim();
      const yr = (r.yr || '').trim();
      const moIdx = parseInt(r.mo) - 1;
      if (!vendors[vc]) vendors[vc] = {};
      if (!vendors[vc][yr]) vendors[vc][yr] = new Array(12).fill(0);
      vendors[vc][yr][moIdx] += Math.round(r.amt || 0);
    }

    ok(res, { year, month, prev_year: prevYear, vendors });
  } catch (e) {
    console.error('closing-verify 오류:', e.message);
    fail(res, 500, e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  거래처별 품목 상세 API (Closing Vendor Items)
// ════════════════════════════════════════════════════════════════════

// GET /api/closing-vendor-items — 거래처별 품목 상세
router.get('/api/closing-vendor-items', async (req, res, parsed) => {
  const { db, ok, fail, sql } = ctx;
  if (!await ctx.ensureXerpPool()) { fail(res, 503, 'XERP 미연결'); return; }
  try {
    const xerpPool = ctx.getXerpPool();
    const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
    const vendorCode = parsed.searchParams.get('vendor_code') || '';
    const year = parsed.searchParams.get('year') || '2026';
    const month = parsed.searchParams.get('month') || '2';
    const prevYear = (parseInt(year) - 1).toString();
    const moStr = month.padStart(2, '0');

    const xReq = xerpPool.request();
    xReq.input('vendorCode', sql.NChar(16), vendorCode);
    xReq.input('fromDate', sql.NChar(16), prevYear + '0101');
    xReq.input('toDate', sql.NChar(16), year + moStr + '31');

    const result = await xReq.query(`
      SELECT RTRIM(i.ItemCode) AS item_code,
             MAX(RTRIM(i.ItemSpec)) AS item_spec,
             LEFT(h.OrderDate,4) AS yr,
             SUBSTRING(h.OrderDate,5,2) AS mo,
             SUM(i.OrderAmnt) AS amt,
             SUM(i.OrderQty) AS qty
      FROM poOrderHeader h WITH (NOLOCK)
      JOIN poOrderItem i WITH (NOLOCK) ON h.SiteCode=i.SiteCode AND h.OrderNo=i.OrderNo
      WHERE h.SiteCode = '${XERP_SITE_CODE}'
        AND h.CsCode = @vendorCode
        AND h.OrderDate >= @fromDate AND h.OrderDate <= @toDate
      GROUP BY RTRIM(i.ItemCode), LEFT(h.OrderDate,4), SUBSTRING(h.OrderDate,5,2)
      ORDER BY RTRIM(i.ItemCode), LEFT(h.OrderDate,4), SUBSTRING(h.OrderDate,5,2)
    `);

    // 품목명 조회
    const itemCodes = [...new Set(result.recordset.map(r => (r.item_code || '').trim()).filter(Boolean))];
    const itemNameMap = {};
    const pi = ctx.getProductInfo();
    if (pi && typeof pi === 'object') {
      for (const [, info] of Object.entries(pi)) {
        const matCode = (info['원자재코드'] || '').trim();
        const matName = (info['원재료용지명'] || info['원재료명'] || '').trim();
        if (matCode && matName && !itemNameMap[matCode]) {
          itemNameMap[matCode] = matName;
        }
      }
    }

    const items = {};
    for (const r of result.recordset) {
      const code = (r.item_code || '').trim();
      const yr = (r.yr || '').trim();
      const mo = parseInt(r.mo) - 1;
      if (!items[code]) items[code] = { code, name: itemNameMap[code] || '', spec: (r.item_spec || '').trim(), years: {} };
      if (!items[code].years[yr]) items[code].years[yr] = new Array(12).fill(0);
      items[code].years[yr][mo] += Math.round(r.amt || 0);
    }

    const moIdx = parseInt(month) - 1;
    const sorted = Object.values(items).sort((a, b) => {
      const aAmt = (a.years[year] || [])[moIdx] || 0;
      const bAmt = (b.years[year] || [])[moIdx] || 0;
      return bAmt - aAmt;
    });

    let monthTotal = 0;
    sorted.forEach(it => { monthTotal += (it.years[year] || [])[moIdx] || 0; });

    const rows = sorted.map(it => {
      const currMonth = (it.years[year] || [])[moIdx] || 0;
      const pct = monthTotal > 0 ? (currMonth / monthTotal * 100) : 0;
      return {
        code: it.code,
        name: it.name,
        spec: it.spec,
        curr_year: it.years[year] || new Array(12).fill(0),
        prev_year: it.years[prevYear] || new Array(12).fill(0),
        curr_month_amt: currMonth,
        curr_month_pct: Math.round(pct * 10) / 10,
        is_major: pct >= 50
      };
    });

    ok(res, { vendor_code: vendorCode, year, month, rows, month_total: monthTotal });
  } catch (e) {
    console.error('closing-vendor-items 오류:', e.message);
    fail(res, 500, e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  정산 API (Settlements)
// ════════════════════════════════════════════════════════════════════

// GET /api/settlements — 정산 목록
router.get('/api/settlements', async (req, res, parsed) => {
  const { db, ok } = ctx;
  const sp = parsed.searchParams;
  let q = 'SELECT * FROM defect_settlements WHERE 1=1';
  const args = [];
  if (sp.get('vendor_name')) { q += ' AND vendor_name=?'; args.push(sp.get('vendor_name')); }
  if (sp.get('status'))      { q += ' AND status=?';      args.push(sp.get('status')); }
  q += ' ORDER BY status ASC, created_at DESC LIMIT 500';
  const rows = await db.prepare(q).all(...args);
  rows.forEach(r => {
    r.claim_amount = Number(r.claim_amount) || 0;
    r.settled_amount = Number(r.settled_amount) || 0;
    r.balance = Number(r.balance) || 0;
  });
  ok(res, rows);
});

// GET /api/settlements/summary — 업체별 미정산 합계
router.get('/api/settlements/summary', async (req, res, parsed) => {
  const { db, ok } = ctx;
  const byVendor = await db.prepare(`
    SELECT vendor_name,
      COUNT(*) FILTER (WHERE status IN ('open','partial')) as open_count,
      COALESCE(SUM(CASE WHEN status IN ('open','partial') THEN balance ELSE 0 END), 0) as open_balance,
      COALESCE(SUM(claim_amount), 0) as total_claim,
      COALESCE(SUM(settled_amount), 0) as total_settled
    FROM defect_settlements
    GROUP BY vendor_name
    HAVING COUNT(*) FILTER (WHERE status IN ('open','partial')) > 0
    ORDER BY open_balance DESC
  `).all().catch(async () => {
    // 폴백 (FILTER 미지원 환경)
    const rows = await db.prepare(`
      SELECT vendor_name, status, claim_amount, settled_amount, balance FROM defect_settlements
    `).all();
    const map = {};
    rows.forEach(r => {
      const v = r.vendor_name;
      if (!map[v]) map[v] = { vendor_name: v, open_count: 0, open_balance: 0, total_claim: 0, total_settled: 0 };
      map[v].total_claim += Number(r.claim_amount) || 0;
      map[v].total_settled += Number(r.settled_amount) || 0;
      if (r.status === 'open' || r.status === 'partial') {
        map[v].open_count++;
        map[v].open_balance += Number(r.balance) || 0;
      }
    });
    return Object.values(map).filter(x => x.open_count > 0).sort((a, b) => b.open_balance - a.open_balance);
  });
  byVendor.forEach(r => {
    r.open_count = Number(r.open_count) || 0;
    r.open_balance = Number(r.open_balance) || 0;
    r.total_claim = Number(r.total_claim) || 0;
    r.total_settled = Number(r.total_settled) || 0;
  });
  const totals = {
    vendors: byVendor.length,
    open_count: byVendor.reduce((s, r) => s + r.open_count, 0),
    open_balance: byVendor.reduce((s, r) => s + r.open_balance, 0)
  };
  ok(res, { totals, byVendor });
});

// POST /api/settlements/sync — defects.claim_amount > 0 중 누락분 일괄 생성
router.post('/api/settlements/sync', async (req, res, parsed) => {
  const { db, ok } = ctx;
  const missing = await db.prepare(`
    SELECT d.id, d.defect_number, d.vendor_name, d.claim_amount, d.claim_type, d.description
    FROM defects d
    WHERE COALESCE(d.claim_amount,0) > 0
      AND NOT EXISTS (SELECT 1 FROM defect_settlements s WHERE s.defect_id = d.id)
  `).all();
  let created = 0;
  for (const d of missing) {
    const amt = Number(d.claim_amount) || 0;
    if (amt <= 0) continue;
    await db.prepare(`INSERT INTO defect_settlements
      (defect_id, defect_number, vendor_name, claim_amount, settled_amount, balance, status, notes)
      VALUES (?,?,?,?,0,?,?,?)`).run(
      d.id, d.defect_number || '', d.vendor_name || '',
      amt, amt, 'open',
      `sync 자동생성: ${d.claim_type || ''} ${d.description || ''}`.trim()
    );
    created++;
  }
  ok(res, { created, scanned: missing.length });
});

// POST /api/settlements/:id/apply — 정산 적용
router.postP(/^\/api\/settlements\/(\d+)\/apply$/, async (req, res, parsed, m) => {
  const { db, ok, fail, readJSON } = ctx;
  const id = parseInt(m[1]);
  const body = await readJSON(req);
  const settle = await db.prepare('SELECT * FROM defect_settlements WHERE id=?').get(id);
  if (!settle) { fail(res, 404, '정산 건 없음'); return; }
  const balance = Number(settle.balance) || 0;
  if (balance <= 0 || settle.status === 'closed' || settle.status === 'cancelled') {
    fail(res, 400, '이미 정산 완료/취소된 건입니다'); return;
  }
  const applyAmt = Math.min(Number(body.amount) || balance, balance);
  if (applyAmt <= 0) { fail(res, 400, '정산 금액 오류'); return; }
  const newSettled = (Number(settle.settled_amount) || 0) + applyAmt;
  const newBalance = (Number(settle.claim_amount) || 0) - newSettled;
  const newStatus = newBalance <= 0.01 ? 'closed' : 'partial';
  await db.prepare(`UPDATE defect_settlements
    SET settled_amount=?, balance=?, status=?,
        applied_po_id=COALESCE(?, applied_po_id),
        applied_po_number=COALESCE(?, applied_po_number),
        applied_at=datetime('now','localtime'),
        applied_by=?,
        notes=CASE WHEN ?='' THEN notes ELSE notes || ' | ' || ? END,
        updated_at=datetime('now','localtime')
    WHERE id=?`).run(
    newSettled, newBalance, newStatus,
    body.po_id || null, body.po_number || null,
    body.actor || 'system',
    body.notes || '', body.notes || '',
    id
  );
  if (settle.defect_id) {
    await db.prepare(`INSERT INTO defect_logs
      (defect_id, defect_number, action, from_status, to_status, actor, details)
      VALUES (?,?,?,?,?,?,?)`).run(
      settle.defect_id, settle.defect_number,
      '정산 적용', settle.status, newStatus,
      body.actor || 'system',
      `${applyAmt.toLocaleString()}원 정산` + (body.po_number ? ` (PO ${body.po_number})` : '')
    );
  }
  ok(res, { id, applied: applyAmt, new_balance: newBalance, new_status: newStatus });
});

// POST /api/settlements/:id/cancel — 정산 취소
router.postP(/^\/api\/settlements\/(\d+)\/cancel$/, async (req, res, parsed, m) => {
  const { db, ok, fail, readJSON } = ctx;
  const id = parseInt(m[1]);
  const body = await readJSON(req).catch(() => ({}));
  const settle = await db.prepare('SELECT * FROM defect_settlements WHERE id=?').get(id);
  if (!settle) { fail(res, 404, '정산 건 없음'); return; }
  await db.prepare(`UPDATE defect_settlements SET status='cancelled', updated_at=datetime('now','localtime'),
    notes=notes || ' | 취소: ' || ? WHERE id=?`).run(body.reason || '', id);
  ok(res, { id, cancelled: true });
});

// ════════════════════════════════════════════════════════════════════
//  세금계산서 API (Tax Invoice)
// ════════════════════════════════════════════════════════════════════

// GET /api/tax-invoice/list — 세금계산서 목록
router.get('/api/tax-invoice/list', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const from = qs.get('from') || (() => { const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10).replace(/-/g,''); })();
  const to = qs.get('to') || new Date().toISOString().slice(0,10).replace(/-/g,'');
  const arAp = qs.get('type') || '';
  const search = qs.get('search') || '';
  const offset = parseInt(qs.get('offset') || '0', 10);
  const limit = Math.min(parseInt(qs.get('limit') || '100', 10), 500);
  const sources = { xerp: 'unknown' };
  let invoices = [], totalCount = 0;
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    let whereExtra = '';
    const cReq = pool.request().input('from', from).input('to', to);
    const dReq = pool.request().input('from', from).input('to', to).input('offset', offset).input('limit', limit);
    if (arAp) { whereExtra += ' AND h.ArApGubun = @arAp'; cReq.input('arAp', arAp); dReq.input('arAp', arAp); }
    if (search) { whereExtra += " AND (h.InvoiceNo LIKE @search OR h.CsCode LIKE @search)"; cReq.input('search', '%'+search+'%'); dReq.input('search', '%'+search+'%'); }
    const countR = await cReq.query(`SELECT COUNT(*) AS cnt FROM rpInvoiceHeader h WITH(NOLOCK) WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.InvoiceDate >= @from AND h.InvoiceDate <= @to ${whereExtra}`);
    totalCount = countR.recordset[0].cnt;
    const dataR = await dReq.query(`
      SELECT RTRIM(h.InvoiceNo) AS invoice_no, h.InvoiceDate, h.ArApGubun,
             RTRIM(h.CsCode) AS cs_code, RTRIM(h.CsRegNo) AS cs_reg_no,
             ISNULL(h.SupplyAmnt,0) AS supply_amt, ISNULL(h.VatAmnt,0) AS vat_amt,
             h.TaxCode, RTRIM(h.DocNo) AS doc_no, h.EseroUp, h.RelCheck, h.BillCheck,
             RTRIM(h.CsEmail) AS cs_email
      FROM rpInvoiceHeader h WITH(NOLOCK)
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.InvoiceDate >= @from AND h.InvoiceDate <= @to ${whereExtra}
      ORDER BY h.InvoiceDate DESC, h.InvoiceNo DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
    invoices = dataR.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  const totals = {
    count: totalCount,
    supply: invoices.reduce((s,r) => s + (r.supply_amt||0), 0),
    vat: invoices.reduce((s,r) => s + (r.vat_amt||0), 0),
    electronic: invoices.filter(r => (r.EseroUp||'').trim() === 'Y').length,
  };
  ok(res, { invoices, totalCount, offset, limit, totals, sources });
});

// GET /api/tax-invoice/detail/:invoiceNo — 세금계산서 상세
router.getP(/^\/api\/tax-invoice\/detail\/(.+)$/, async (req, res, parsed, m) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const invoiceNo = decodeURIComponent(m[1]);
  const sources = { xerp: 'unknown' };
  let header = null, items = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const hR = await pool.request().input('no', invoiceNo).query(`
      SELECT RTRIM(h.InvoiceNo) AS invoice_no, h.InvoiceDate, h.ArApGubun,
             RTRIM(h.CsCode) AS cs_code, RTRIM(h.CsRegNo) AS cs_reg_no,
             RTRIM(h.OurRegNo) AS our_reg_no,
             ISNULL(h.SupplyAmnt,0) AS supply_amt, ISNULL(h.VatAmnt,0) AS vat_amt,
             h.TaxCode, RTRIM(h.DocNo) AS doc_no, h.EseroUp, h.RelCheck,
             RTRIM(h.CsEmail) AS cs_email, RTRIM(h.CsMobile) AS cs_mobile
      FROM rpInvoiceHeader h WITH(NOLOCK) WHERE h.SiteCode='${XERP_SITE_CODE}' AND RTRIM(h.InvoiceNo)=@no
    `);
    if (hR.recordset.length > 0) header = hR.recordset[0];
    const iR = await pool.request().input('no', invoiceNo).query(`
      SELECT i.InvoiceSerNo, i.ItemDate, RTRIM(i.ItemName) AS item_name,
             ISNULL(i.ItemQty,0) AS qty, ISNULL(i.ItemPrice,0) AS price,
             ISNULL(i.ItemAmnt,0) AS amt, ISNULL(i.ItemVatAmnt,0) AS vat
      FROM rpInvoiceItem i WITH(NOLOCK)
      WHERE i.SiteCode='${XERP_SITE_CODE}' AND RTRIM(i.InvoiceNo)=@no
      ORDER BY i.InvoiceSerNo
    `);
    items = iR.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  ok(res, { header, items, sources });
});

// GET /api/tax-invoice/summary — 월별 세금계산서 집계
router.get('/api/tax-invoice/summary', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const year = qs.get('year') || new Date().getFullYear().toString();
  const sources = { xerp: 'unknown' };
  let monthly = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const r = await pool.request().input('yearStart', year+'0101').input('yearEnd', year+'1231').query(`
      SELECT LEFT(h.InvoiceDate,6) AS ym, h.ArApGubun,
             COUNT(*) AS cnt,
             ISNULL(SUM(h.SupplyAmnt),0) AS supply,
             ISNULL(SUM(h.VatAmnt),0) AS vat,
             SUM(CASE WHEN RTRIM(h.EseroUp)='Y' THEN 1 ELSE 0 END) AS electronic
      FROM rpInvoiceHeader h WITH(NOLOCK)
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.InvoiceDate >= @yearStart AND h.InvoiceDate <= @yearEnd
      GROUP BY LEFT(h.InvoiceDate,6), h.ArApGubun
      ORDER BY LEFT(h.InvoiceDate,6), h.ArApGubun
    `);
    monthly = r.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  ok(res, { year, monthly, sources });
});

// POST /api/tax-invoice/upload — 홈택스 엑셀 업로드
router.post('/api/tax-invoice/upload', async (req, res, parsed) => {
  const { db, ok, fail, readJSON, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  try {
    const body = await readJSON(req);
    const rows = body.rows;
    if (!rows || !Array.isArray(rows) || rows.length === 0) { fail(res, 400, '업로드 데이터 없음'); return; }
    const stmt = db.prepare(`INSERT OR IGNORE INTO hometax_invoices
      (invoice_no, invoice_date, ar_ap, cs_name, cs_reg_no, supply_amt, vat_amt, total_amt, item_name, remark, electronic, uploaded_by)
      VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
    let inserted = 0, skipped = 0;
    const txn = db.transaction(async (items) => {
      for (const r of items) {
        const info = await stmt.run(
          (r.invoice_no||'').trim(), (r.invoice_date||'').replace(/-/g,'').trim(),
          (r.ar_ap||'AP').trim(), (r.cs_name||'').trim(), (r.cs_reg_no||'').replace(/-/g,'').trim(),
          parseFloat(r.supply_amt)||0, parseFloat(r.vat_amt)||0, parseFloat(r.total_amt)||0,
          (r.item_name||'').trim(), (r.remark||'').trim(),
          (r.electronic||'Y').trim(), decoded.name || decoded.email || ''
        );
        if (info.changes > 0) inserted++; else skipped++;
      }
    });
    await txn(rows);
    ok(res, { inserted, skipped, total: rows.length });
  } catch (e) { fail(res, 500, e.message); }
});

// GET /api/tax-invoice/hometax — 홈택스 업로드 세금계산서 목록
router.get('/api/tax-invoice/hometax', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const from = qs.get('from') || (() => { const d = new Date(); d.setMonth(d.getMonth()-1); return d.toISOString().slice(0,10).replace(/-/g,''); })();
  const to = qs.get('to') || new Date().toISOString().slice(0,10).replace(/-/g,'');
  const arAp = qs.get('type') || '';
  const search = qs.get('search') || '';
  const offset = parseInt(qs.get('offset') || '0', 10);
  const limit = Math.min(parseInt(qs.get('limit') || '100', 10), 500);
  let where = 'invoice_date >= ? AND invoice_date <= ?';
  const params = [from, to];
  if (arAp) { where += ' AND ar_ap = ?'; params.push(arAp); }
  if (search) { where += ' AND (invoice_no LIKE ? OR cs_name LIKE ? OR cs_reg_no LIKE ?)'; params.push('%'+search+'%','%'+search+'%','%'+search+'%'); }
  const totalCount = (await db.prepare('SELECT COUNT(*) AS cnt FROM hometax_invoices WHERE ' + where).get(...params)).cnt;
  const invoices = await db.prepare('SELECT * FROM hometax_invoices WHERE ' + where + ' ORDER BY invoice_date DESC, id DESC LIMIT ? OFFSET ?').all(...params, limit, offset);
  const totals = {
    count: totalCount,
    supply: invoices.reduce((s,r) => s + (r.supply_amt||0), 0),
    vat: invoices.reduce((s,r) => s + (r.vat_amt||0), 0),
  };
  ok(res, { invoices, totalCount, offset, limit, totals, sources: { hometax: 'ok' } });
});

// DELETE /api/tax-invoice/hometax — 홈택스 데이터 삭제 (기간)
router.del('/api/tax-invoice/hometax', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const from = qs.get('from'), to = qs.get('to');
  if (!from || !to) { fail(res, 400, 'from/to 필수'); return; }
  const info = await db.prepare('DELETE FROM hometax_invoices WHERE invoice_date >= ? AND invoice_date <= ?').run(from, to);
  ok(res, { deleted: info.changes });
});

// ════════════════════════════════════════════════════════════════════
//  복식부기 회계 API (Double-Entry Bookkeeping)
// ════════════════════════════════════════════════════════════════════

// GET /api/acct/seed-accounts — XERP에서 계정코드 추출 → SQLite 시드
router.get('/api/acct/seed-accounts', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const sources = { xerp: 'unknown', sqlite: 'ok' };
  let seeded = 0;
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const result = await pool.request().query(`
      SELECT DISTINCT RTRIM(AccCode) AS acc_code
      FROM glDocItem WITH (NOLOCK)
      WHERE SiteCode = '${XERP_SITE_CODE}' AND AccCode IS NOT NULL AND RTRIM(AccCode) != ''
    `);
    const upsert = db.prepare(`INSERT INTO gl_account_map (acc_code, acc_name, acc_type, acc_group, parent_code, depth, sort_order, updated_at)
      VALUES (?,?,?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(acc_code) DO UPDATE SET
        acc_name=CASE WHEN excluded.acc_name!='' THEN excluded.acc_name ELSE gl_account_map.acc_name END,
        acc_type=excluded.acc_type, acc_group=excluded.acc_group,
        parent_code=excluded.parent_code, depth=excluded.depth, sort_order=excluded.sort_order,
        updated_at=datetime('now','localtime')`);
    const tx = db.transaction(async () => {
      for (const row of result.recordset) {
        const code = row.acc_code.trim();
        if (!code) continue;
        const cls = classifyAccount(code);
        await upsert.run(code, cls.acc_name, cls.acc_type, cls.acc_group, cls.parent_code, cls.depth, cls.sort_order);
        seeded++;
      }
    });
    await tx();
  } catch (e) {
    sources.xerp = 'error: ' + e.message;
  }
  const total = (await db.prepare('SELECT COUNT(*) AS cnt FROM gl_account_map').get()).cnt;
  ok(res, { seeded, total, sources });
});

// GET /api/acct/accounts — 계정과목 트리
router.get('/api/acct/accounts', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const accounts = await db.prepare(`SELECT acc_code, acc_name, acc_type, acc_group, parent_code, depth, sort_order, is_active
    FROM gl_account_map ORDER BY sort_order, acc_code`).all();
  ok(res, { accounts, total: accounts.length });
});

// PUT /api/acct/accounts/:code — 계정명 수정
router.putP(/^\/api\/acct\/accounts\/(.+)$/, async (req, res, parsed, m) => {
  const { db, ok, fail, readJSON, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const code = decodeURIComponent(m[1]);
  const body = await readJSON(req);
  if (body.acc_name !== undefined) {
    await db.prepare(`UPDATE gl_account_map SET acc_name=?, updated_at=datetime('now','localtime') WHERE acc_code=?`).run(body.acc_name, code);
  }
  ok(res, { message: '계정 수정 완료' });
});

// GET /api/acct/account-stats — XERP 계정별 거래 통계
router.get('/api/acct/account-stats', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const year = qs.get('year') || new Date().getFullYear().toString();
  const cacheKey = 'acctStats_' + year;
  if (acctStatsCache && acctStatsCache._key === cacheKey && Date.now() - acctStatsCacheTime < ACCT_CACHE_TTL && !qs.get('refresh')) {
    ok(res, acctStatsCache); return;
  }
  const sources = { xerp: 'unknown', sqlite: 'ok' };
  let stats = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const fromDate = year + '0101';
    const toDate = year + '1231';
    const result = await pool.request()
      .input('fromDate', fromDate).input('toDate', toDate)
      .query(`
        SELECT RTRIM(i.AccCode) AS acc_code,
               COUNT(*) AS txn_count,
               SUM(CASE WHEN i.DrCr = 'D' THEN i.DocAmnt ELSE 0 END) AS total_dr,
               SUM(CASE WHEN i.DrCr = 'C' THEN i.DocAmnt ELSE 0 END) AS total_cr
        FROM glDocHeader h WITH (NOLOCK)
        JOIN glDocItem i WITH (NOLOCK) ON h.SiteCode = i.SiteCode AND h.DocNo = i.DocNo
        WHERE h.SiteCode = '${XERP_SITE_CODE}' AND h.RelCheck = 'Y'
          AND h.RelDate >= @fromDate AND h.RelDate <= @toDate
        GROUP BY RTRIM(i.AccCode)
        ORDER BY SUM(i.DocAmnt) DESC
      `);
    stats = result.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  const accMap = {};
  (await db.prepare('SELECT acc_code, acc_name, acc_type, acc_group FROM gl_account_map').all()).forEach(a => { accMap[a.acc_code] = a; });
  stats = stats.map(s => ({
    ...s,
    acc_name: (accMap[s.acc_code] || {}).acc_name || '',
    acc_type: (accMap[s.acc_code] || {}).acc_type || '',
    acc_group: (accMap[s.acc_code] || {}).acc_group || ''
  }));
  const resp = { year, stats, sources, _key: cacheKey };
  acctStatsCache = resp; acctStatsCacheTime = Date.now();
  ok(res, resp);
});

// GET /api/acct/vouchers — 분개장 전표 목록
router.get('/api/acct/vouchers', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const from = qs.get('from') || (() => { const d = new Date(); d.setDate(d.getDate()-30); return d.toISOString().slice(0,10).replace(/-/g,''); })();
  const to = qs.get('to') || new Date().toISOString().slice(0,10).replace(/-/g,'');
  const status = qs.get('status') || 'Y';
  const offset = parseInt(qs.get('offset') || '0', 10);
  const limit = Math.min(parseInt(qs.get('limit') || '100', 10), 500);
  const search = qs.get('search') || '';
  const sources = { xerp: 'unknown' };
  let vouchers = [], totalCount = 0;
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    let whereExtra = '';
    const req2 = pool.request().input('fromDate', from).input('toDate', to).input('offset', offset).input('limit', limit);
    if (status) { whereExtra += ' AND h.RelCheck = @status'; req2.input('status', status); }
    if (search) { whereExtra += " AND (h.DocNo LIKE @search OR h.DocDescr LIKE @search)"; req2.input('search', '%' + search + '%'); }
    const countResult = await req2.query(`
      SELECT COUNT(*) AS cnt FROM glDocHeader h WITH (NOLOCK)
      WHERE h.SiteCode = '${XERP_SITE_CODE}' AND h.RelDate >= @fromDate AND h.RelDate <= @toDate ${whereExtra}
    `);
    totalCount = countResult.recordset[0].cnt;
    const req3 = pool.request().input('fromDate', from).input('toDate', to).input('offset', offset).input('limit', limit);
    if (status) req3.input('status', status);
    if (search) req3.input('search', '%' + search + '%');
    const result = await req3.query(`
      SELECT h.DocNo, h.DocDate, h.DocGubun, h.DocDescr, h.RelCheck, h.RelDate, h.OriginNo,
        (SELECT SUM(CASE WHEN i2.DrCr='D' THEN i2.DocAmnt ELSE 0 END)
         FROM glDocItem i2 WITH(NOLOCK) WHERE i2.SiteCode=h.SiteCode AND i2.DocNo=h.DocNo) AS total_debit,
        (SELECT SUM(CASE WHEN i2.DrCr='C' THEN i2.DocAmnt ELSE 0 END)
         FROM glDocItem i2 WITH(NOLOCK) WHERE i2.SiteCode=h.SiteCode AND i2.DocNo=h.DocNo) AS total_credit,
        (SELECT COUNT(*) FROM glDocItem i3 WITH(NOLOCK) WHERE i3.SiteCode=h.SiteCode AND i3.DocNo=h.DocNo) AS line_count
      FROM glDocHeader h WITH(NOLOCK)
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.RelDate >= @fromDate AND h.RelDate <= @toDate ${whereExtra}
      ORDER BY h.RelDate DESC, h.DocNo DESC
      OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY
    `);
    vouchers = result.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  ok(res, { vouchers, totalCount, offset, limit, sources });
});

// GET /api/acct/voucher/:docNo — 전표 상세
router.getP(/^\/api\/acct\/voucher\/(.+)$/, async (req, res, parsed, m) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const docNo = decodeURIComponent(m[1]);
  const sources = { xerp: 'unknown' };
  let header = null, items = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const hResult = await pool.request().input('docNo', docNo).query(`
      SELECT h.DocNo, h.DocDate, h.DocGubun, h.DocType, h.DocDescr,
             h.RelCheck, h.RelDate, h.EmpCode, h.OriginNo, h.DeptCode
      FROM glDocHeader h WITH(NOLOCK)
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.DocNo=@docNo
    `);
    if (hResult.recordset.length > 0) header = hResult.recordset[0];
    const iResult = await pool.request().input('docNo', docNo).query(`
      SELECT i.DocSerNo, RTRIM(i.AccCode) AS acc_code, i.DrCr, i.DocAmnt,
             i.DocDescr, RTRIM(i.CsCode) AS cs_code, i.VatBillNo, i.TeCode
      FROM glDocItem i WITH(NOLOCK)
      WHERE i.SiteCode='${XERP_SITE_CODE}' AND i.DocNo=@docNo
      ORDER BY i.DocSerNo
    `);
    items = iResult.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  const accMap = {};
  (await db.prepare('SELECT acc_code, acc_name FROM gl_account_map').all()).forEach(a => { accMap[a.acc_code] = a.acc_name; });
  const csMap = {};
  (await db.prepare('SELECT cs_code, cs_name FROM cs_code_cache').all()).forEach(c => { csMap[c.cs_code] = c.cs_name; });
  items = items.map(it => ({
    ...it,
    acc_name: accMap[it.acc_code] || '',
    cs_name: csMap[it.cs_code] || ''
  }));
  const totalDr = items.filter(i => i.DrCr === 'D').reduce((s, i) => s + (i.DocAmnt || 0), 0);
  const totalCr = items.filter(i => i.DrCr === 'C').reduce((s, i) => s + (i.DocAmnt || 0), 0);
  const balanced = Math.abs(totalDr - totalCr) < 1;
  ok(res, { header, items, totalDr, totalCr, balanced, sources });
});

// GET /api/acct/gl — 총계정원장
router.get('/api/acct/gl', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const acc = qs.get('acc');
  if (!acc) { fail(res, 400, 'acc 파라미터 필요'); return; }
  const from = qs.get('from') || (() => { const d = new Date(); return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + '01'; })();
  const to = qs.get('to') || new Date().toISOString().slice(0,10).replace(/-/g,'');
  const csFilter = qs.get('cs') || '';
  const sources = { xerp: 'unknown' };
  let openingDr = 0, openingCr = 0, transactions = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const openReq = pool.request().input('acc', acc).input('fromDate', from);
    const openResult = await openReq.query(`
      SELECT SUM(CASE WHEN i.DrCr='D' THEN i.DocAmnt ELSE 0 END) AS total_dr,
             SUM(CASE WHEN i.DrCr='C' THEN i.DocAmnt ELSE 0 END) AS total_cr
      FROM glDocHeader h WITH(NOLOCK)
      JOIN glDocItem i WITH(NOLOCK) ON h.SiteCode=i.SiteCode AND h.DocNo=i.DocNo
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.RelCheck='Y'
        AND RTRIM(i.AccCode)=@acc AND h.RelDate < @fromDate
    `);
    if (openResult.recordset[0]) {
      openingDr = openResult.recordset[0].total_dr || 0;
      openingCr = openResult.recordset[0].total_cr || 0;
    }
    const txReq = pool.request().input('acc', acc).input('fromDate', from).input('toDate', to);
    let csWhere = '';
    if (csFilter) { csWhere = " AND RTRIM(i.CsCode) LIKE @csFilter"; txReq.input('csFilter', '%' + csFilter + '%'); }
    const txResult = await txReq.query(`
      SELECT h.DocNo, h.DocDate, h.DocDescr AS header_descr,
             i.DocSerNo, i.DrCr, i.DocAmnt, i.DocDescr AS item_descr,
             RTRIM(i.CsCode) AS cs_code, i.VatBillNo
      FROM glDocHeader h WITH(NOLOCK)
      JOIN glDocItem i WITH(NOLOCK) ON h.SiteCode=i.SiteCode AND h.DocNo=i.DocNo
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.RelCheck='Y'
        AND RTRIM(i.AccCode)=@acc
        AND h.RelDate >= @fromDate AND h.RelDate <= @toDate ${csWhere}
      ORDER BY h.RelDate, h.DocNo, i.DocSerNo
    `);
    transactions = txResult.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  const accInfo = await db.prepare('SELECT acc_type, acc_name FROM gl_account_map WHERE acc_code=?').get(acc) || {};
  const isDebitNature = ['asset', 'expense'].includes(accInfo.acc_type);
  const openingBalance = isDebitNature ? (openingDr - openingCr) : (openingCr - openingDr);
  let rb = openingBalance;
  transactions = transactions.map(t => {
    if (isDebitNature) rb += (t.DrCr === 'D' ? t.DocAmnt : -t.DocAmnt);
    else rb += (t.DrCr === 'C' ? t.DocAmnt : -t.DocAmnt);
    return { ...t, balance: rb };
  });
  const closingBalance = rb;
  const periodDr = transactions.filter(t => t.DrCr === 'D').reduce((s, t) => s + (t.DocAmnt || 0), 0);
  const periodCr = transactions.filter(t => t.DrCr === 'C').reduce((s, t) => s + (t.DocAmnt || 0), 0);
  ok(res, { acc, acc_name: accInfo.acc_name || '', acc_type: accInfo.acc_type || '',
    openingBalance, closingBalance, periodDr, periodCr, isDebitNature,
    transactions, count: transactions.length, sources });
});

// GET /api/acct/trial-balance — 시산표
router.get('/api/acct/trial-balance', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const year = qs.get('year') || new Date().getFullYear().toString();
  const month = qs.get('month') || String(new Date().getMonth() + 1);
  const fromDate = year + String(month).padStart(2, '0') + '01';
  const lastDay = new Date(parseInt(year), parseInt(month), 0).getDate();
  const toDate = year + String(month).padStart(2, '0') + String(lastDay);
  const fiscalStart = year + '0101';
  const cacheKey = 'tb_' + fromDate;
  if (trialBalanceCache && trialBalanceCache._key === cacheKey && Date.now() - trialBalanceCacheTime < ACCT_CACHE_TTL && !qs.get('refresh')) {
    ok(res, trialBalanceCache); return;
  }
  const sources = { xerp: 'unknown', sqlite: 'ok' };
  let periodData = [], priorData = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const pResult = await pool.request().input('fromDate', fromDate).input('toDate', toDate).query(`
      SELECT RTRIM(i.AccCode) AS acc_code,
             SUM(CASE WHEN i.DrCr='D' THEN i.DocAmnt ELSE 0 END) AS period_dr,
             SUM(CASE WHEN i.DrCr='C' THEN i.DocAmnt ELSE 0 END) AS period_cr
      FROM glDocHeader h WITH(NOLOCK)
      JOIN glDocItem i WITH(NOLOCK) ON h.SiteCode=i.SiteCode AND h.DocNo=i.DocNo
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.RelCheck='Y'
        AND h.RelDate >= @fromDate AND h.RelDate <= @toDate
      GROUP BY RTRIM(i.AccCode)
    `);
    periodData = pResult.recordset;
    if (fromDate !== fiscalStart) {
      const beforeDate = fromDate;
      const oResult = await pool.request().input('fiscalStart', fiscalStart).input('beforeDate', beforeDate).query(`
        SELECT RTRIM(i.AccCode) AS acc_code,
               SUM(CASE WHEN i.DrCr='D' THEN i.DocAmnt ELSE 0 END) AS prior_dr,
               SUM(CASE WHEN i.DrCr='C' THEN i.DocAmnt ELSE 0 END) AS prior_cr
        FROM glDocHeader h WITH(NOLOCK)
        JOIN glDocItem i WITH(NOLOCK) ON h.SiteCode=i.SiteCode AND h.DocNo=i.DocNo
        WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.RelCheck='Y'
          AND h.RelDate >= @fiscalStart AND h.RelDate < @beforeDate
        GROUP BY RTRIM(i.AccCode)
      `);
      priorData = oResult.recordset;
    }
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  const accMap = {};
  await db.prepare('SELECT acc_code, acc_name, acc_type, acc_group, sort_order FROM gl_account_map').all()
    .forEach(a => { accMap[a.acc_code] = a; });
  const allCodes = new Set([...periodData.map(p => p.acc_code), ...priorData.map(p => p.acc_code)]);
  const priorMap = {}; priorData.forEach(p => { priorMap[p.acc_code] = p; });
  const periodMap = {}; periodData.forEach(p => { periodMap[p.acc_code] = p; });
  const rows = [];
  for (const code of allCodes) {
    const info = accMap[code] || classifyAccount(code);
    const prior = priorMap[code] || { prior_dr: 0, prior_cr: 0 };
    const period = periodMap[code] || { period_dr: 0, period_cr: 0 };
    const isDebitNature = ['asset', 'expense'].includes(info.acc_type);
    const openBal = isDebitNature ? (prior.prior_dr - prior.prior_cr) : (prior.prior_cr - prior.prior_dr);
    const periodNet = isDebitNature ? (period.period_dr - period.period_cr) : (period.period_cr - period.period_dr);
    const closeBal = openBal + periodNet;
    rows.push({
      acc_code: code,
      acc_name: info.acc_name || '',
      acc_type: info.acc_type || '',
      acc_group: info.acc_group || '',
      sort_order: info.sort_order || 9999,
      opening_dr: prior.prior_dr || 0, opening_cr: prior.prior_cr || 0,
      period_dr: period.period_dr || 0, period_cr: period.period_cr || 0,
      closing_dr: (prior.prior_dr || 0) + (period.period_dr || 0),
      closing_cr: (prior.prior_cr || 0) + (period.period_cr || 0),
      opening_balance: openBal, closing_balance: closeBal
    });
  }
  rows.sort((a, b) => (a.sort_order - b.sort_order) || a.acc_code.localeCompare(b.acc_code));
  const totals = {
    opening_dr: rows.reduce((s, r) => s + r.opening_dr, 0),
    opening_cr: rows.reduce((s, r) => s + r.opening_cr, 0),
    period_dr: rows.reduce((s, r) => s + r.period_dr, 0),
    period_cr: rows.reduce((s, r) => s + r.period_cr, 0),
    closing_dr: rows.reduce((s, r) => s + r.closing_dr, 0),
    closing_cr: rows.reduce((s, r) => s + r.closing_cr, 0),
  };
  totals.balanced = Math.abs(totals.period_dr - totals.period_cr) < 1;
  const resp = { year, month, rows, totals, count: rows.length, sources, _key: cacheKey };
  trialBalanceCache = resp; trialBalanceCacheTime = Date.now();
  // 캐시 저장
  const upsertBal = db.prepare(`INSERT INTO gl_balance_cache (acc_code,year_month,opening_dr,opening_cr,period_dr,period_cr,closing_dr,closing_cr)
    VALUES (?,?,?,?,?,?,?,?) ON CONFLICT(acc_code,year_month) DO UPDATE SET
    opening_dr=excluded.opening_dr,opening_cr=excluded.opening_cr,
    period_dr=excluded.period_dr,period_cr=excluded.period_cr,
    closing_dr=excluded.closing_dr,closing_cr=excluded.closing_cr,
    cached_at=datetime('now','localtime')`);
  const txBal = db.transaction(async () => {
    const ym = year + String(month).padStart(2, '0');
    for (const r of rows) { await upsertBal.run(r.acc_code, ym, r.opening_dr, r.opening_cr, r.period_dr, r.period_cr, r.closing_dr, r.closing_cr); }
  });
  try { await txBal(); } catch (e) { /* 캐시 저장 실패는 무시 */ }
  ok(res, resp);
});

// GET /api/acct/financial-statements — 재무제표 (BS + IS)
router.get('/api/acct/financial-statements', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const year = qs.get('year') || new Date().getFullYear().toString();
  const month = qs.get('month') || String(new Date().getMonth() + 1);
  const compare = qs.get('compare') || '';
  const sources = { xerp: 'unknown', sqlite: 'ok' };

  async function getTrialData(y, m) {
    const fromDate = y + String(m).padStart(2, '0') + '01';
    const lastDay = new Date(parseInt(y), parseInt(m), 0).getDate();
    const toDate = y + String(m).padStart(2, '0') + String(lastDay);
    const fiscalStart = y + '0101';
    try {
      const pool = await ctx.ensureXerpPool();
      sources.xerp = 'ok';
      const [pRes, oRes] = await Promise.all([
        pool.request().input('f', fromDate).input('t', toDate).query(`
          SELECT RTRIM(i.AccCode) AS acc_code,
                 SUM(CASE WHEN i.DrCr='D' THEN i.DocAmnt ELSE 0 END) AS pd,
                 SUM(CASE WHEN i.DrCr='C' THEN i.DocAmnt ELSE 0 END) AS pc
          FROM glDocHeader h WITH(NOLOCK)
          JOIN glDocItem i WITH(NOLOCK) ON h.SiteCode=i.SiteCode AND h.DocNo=i.DocNo
          WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.RelCheck='Y' AND h.RelDate>=@f AND h.RelDate<=@t
          GROUP BY RTRIM(i.AccCode)`),
        fromDate !== fiscalStart ?
          pool.request().input('fs', fiscalStart).input('bf', fromDate).query(`
            SELECT RTRIM(i.AccCode) AS acc_code,
                   SUM(CASE WHEN i.DrCr='D' THEN i.DocAmnt ELSE 0 END) AS od,
                   SUM(CASE WHEN i.DrCr='C' THEN i.DocAmnt ELSE 0 END) AS oc
            FROM glDocHeader h WITH(NOLOCK)
            JOIN glDocItem i WITH(NOLOCK) ON h.SiteCode=i.SiteCode AND h.DocNo=i.DocNo
            WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.RelCheck='Y' AND h.RelDate>=@fs AND h.RelDate<@bf
            GROUP BY RTRIM(i.AccCode)`)
          : Promise.resolve({ recordset: [] })
      ]);
      return { period: pRes.recordset, prior: oRes.recordset };
    } catch (e) { sources.xerp = 'error: ' + e.message; return { period: [], prior: [] }; }
  }

  const accMap = {};
  await db.prepare('SELECT acc_code, acc_name, acc_type, acc_group, sort_order FROM gl_account_map').all()
    .forEach(a => { accMap[a.acc_code] = a; });

  function buildStatement(periodArr, priorArr) {
    const priorMap = {}; priorArr.forEach(p => { priorMap[p.acc_code] = p; });
    const bs = { assets: [], liabilities: [], equity: [], totalAssets: 0, totalLiabilities: 0, totalEquity: 0 };
    const is = { revenue: [], expense: [], totalRevenue: 0, totalExpense: 0, netIncome: 0 };
    const allCodes = new Set([...periodArr.map(p => p.acc_code), ...priorArr.map(p => p.acc_code)]);
    for (const code of allCodes) {
      const info = accMap[code] || classifyAccount(code);
      const prior = priorMap[code] || { od: 0, oc: 0 };
      const period = periodArr.find(p => p.acc_code === code) || { pd: 0, pc: 0 };
      const isDebitNature = ['asset', 'expense'].includes(info.acc_type);
      const totalDr = (prior.od || 0) + (period.pd || 0);
      const totalCr = (prior.oc || 0) + (period.pc || 0);
      const balance = isDebitNature ? (totalDr - totalCr) : (totalCr - totalDr);
      const periodOnly = isDebitNature ? ((period.pd||0) - (period.pc||0)) : ((period.pc||0) - (period.pd||0));
      const row = { acc_code: code, acc_name: info.acc_name || code, acc_group: info.acc_group || '', balance, periodOnly, sort_order: info.sort_order || 9999 };
      if (info.acc_type === 'asset') { bs.assets.push(row); bs.totalAssets += balance; }
      else if (info.acc_type === 'liability') { bs.liabilities.push(row); bs.totalLiabilities += balance; }
      else if (info.acc_type === 'equity') { bs.equity.push(row); bs.totalEquity += balance; }
      else if (info.acc_type === 'revenue') { is.revenue.push(row); is.totalRevenue += periodOnly; }
      else if (info.acc_type === 'expense') { is.expense.push(row); is.totalExpense += periodOnly; }
    }
    is.netIncome = is.totalRevenue - is.totalExpense;
    bs.totalEquity += is.netIncome;
    bs.assets.sort((a, b) => a.sort_order - b.sort_order);
    bs.liabilities.sort((a, b) => a.sort_order - b.sort_order);
    bs.equity.sort((a, b) => a.sort_order - b.sort_order);
    is.revenue.sort((a, b) => a.sort_order - b.sort_order);
    is.expense.sort((a, b) => a.sort_order - b.sort_order);
    bs.balanced = Math.abs(bs.totalAssets - (bs.totalLiabilities + bs.totalEquity)) < 100;
    return { bs, is };
  }

  const current = await getTrialData(year, month);
  const stmt = buildStatement(current.period, current.prior);
  let compareStmt = null, compareLabel = '';
  if (compare === 'mom') {
    let cm = parseInt(month) - 1, cy = parseInt(year);
    if (cm < 1) { cm = 12; cy--; }
    const prev = await getTrialData(String(cy), String(cm));
    compareStmt = buildStatement(prev.period, prev.prior);
    compareLabel = cy + '년 ' + cm + '월';
  } else if (compare === 'yoy') {
    const prev = await getTrialData(String(parseInt(year) - 1), month);
    compareStmt = buildStatement(prev.period, prev.prior);
    compareLabel = (parseInt(year) - 1) + '년 ' + month + '월';
  }
  ok(res, { year, month, current: stmt, compare: compareStmt, compareLabel, sources });
});

// GET /api/acct/ar-summary — 채권/채무 요약
router.get('/api/acct/ar-summary', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const from = qs.get('from') || (() => { const d = new Date(); return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + '01'; })();
  const to = qs.get('to') || new Date().toISOString().slice(0,10).replace(/-/g,'');
  const arAp = qs.get('type') || 'AR';
  const sources = { xerp: 'unknown' };
  let summary = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const result = await pool.request().input('from', from).input('to', to).input('arAp', arAp).query(`
      SELECT RTRIM(h.CsCode) AS cs_code,
             COUNT(*) AS bill_count,
             ISNULL(SUM(h.BillAmnt),0) AS total_billed,
             ISNULL(SUM(h.VatAmnt),0) AS total_vat,
             ISNULL(SUM(h.MoneySumAmnt),0) AS total_collected
      FROM rpBillHeader h WITH(NOLOCK)
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND h.ArApGubun=@arAp
        AND h.BillDate >= @from AND h.BillDate <= @to
      GROUP BY RTRIM(h.CsCode)
      ORDER BY SUM(h.BillAmnt) DESC
    `);
    summary = result.recordset.map(r => ({
      ...r,
      outstanding: (r.total_billed + r.total_vat) - r.total_collected
    }));
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  const totals = {
    total_billed: summary.reduce((s, r) => s + r.total_billed, 0),
    total_vat: summary.reduce((s, r) => s + r.total_vat, 0),
    total_collected: summary.reduce((s, r) => s + r.total_collected, 0),
    outstanding: summary.reduce((s, r) => s + r.outstanding, 0),
  };
  ok(res, { type: arAp, summary, totals, sources });
});

// GET /api/acct/aging — 채권 에이징 분석
router.get('/api/acct/aging', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const sources = { xerp: 'unknown' };
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, '');
  const d30 = (() => { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0,10).replace(/-/g,''); })();
  const d60 = (() => { const d = new Date(); d.setDate(d.getDate() - 60); return d.toISOString().slice(0,10).replace(/-/g,''); })();
  const d90 = (() => { const d = new Date(); d.setDate(d.getDate() - 90); return d.toISOString().slice(0,10).replace(/-/g,''); })();
  let aging = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const result = await pool.request()
      .input('today', today).input('d30', d30).input('d60', d60).input('d90', d90)
      .query(`
        SELECT RTRIM(me.CsCode) AS cs_code,
          SUM(CASE WHEN me.ExpectDate >= @today THEN me.ExpectRemainAmnt ELSE 0 END) AS current_amt,
          SUM(CASE WHEN me.ExpectDate < @today AND me.ExpectDate >= @d30 THEN me.ExpectRemainAmnt ELSE 0 END) AS days_30,
          SUM(CASE WHEN me.ExpectDate < @d30 AND me.ExpectDate >= @d60 THEN me.ExpectRemainAmnt ELSE 0 END) AS days_60,
          SUM(CASE WHEN me.ExpectDate < @d60 AND me.ExpectDate >= @d90 THEN me.ExpectRemainAmnt ELSE 0 END) AS days_90,
          SUM(CASE WHEN me.ExpectDate < @d90 THEN me.ExpectRemainAmnt ELSE 0 END) AS over_90,
          SUM(me.ExpectRemainAmnt) AS total_outstanding
        FROM rpMoneyExpect me WITH(NOLOCK)
        WHERE me.SiteCode='${XERP_SITE_CODE}' AND me.ExpectRemainAmnt > 0
        GROUP BY RTRIM(me.CsCode)
        HAVING SUM(me.ExpectRemainAmnt) > 0
        ORDER BY SUM(me.ExpectRemainAmnt) DESC
      `);
    aging = result.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  const totals = {
    current_amt: aging.reduce((s, r) => s + (r.current_amt || 0), 0),
    days_30: aging.reduce((s, r) => s + (r.days_30 || 0), 0),
    days_60: aging.reduce((s, r) => s + (r.days_60 || 0), 0),
    days_90: aging.reduce((s, r) => s + (r.days_90 || 0), 0),
    over_90: aging.reduce((s, r) => s + (r.over_90 || 0), 0),
    total: aging.reduce((s, r) => s + (r.total_outstanding || 0), 0),
  };
  ok(res, { aging, totals, sources });
});

// GET /api/acct/ar-detail — 거래처별 채권/채무 상세
router.get('/api/acct/ar-detail', async (req, res, parsed) => {
  const { ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const cs = qs.get('cs');
  if (!cs) { fail(res, 400, 'cs 파라미터 필요'); return; }
  const from = qs.get('from') || (() => { const d = new Date(); d.setMonth(d.getMonth()-3); return d.toISOString().slice(0,10).replace(/-/g,''); })();
  const to = qs.get('to') || new Date().toISOString().slice(0,10).replace(/-/g,'');
  const sources = { xerp: 'unknown' };
  let bills = [], payments = [];
  try {
    const pool = await ctx.ensureXerpPool();
    sources.xerp = 'ok';
    const bResult = await pool.request().input('cs', cs).input('from', from).input('to', to).query(`
      SELECT h.BillNo, h.BillDate, h.ArApGubun,
             ISNULL(h.BillAmnt,0) AS bill_amt, ISNULL(h.VatAmnt,0) AS vat_amt,
             ISNULL(h.MoneySumAmnt,0) AS collected, h.BillDescr
      FROM rpBillHeader h WITH(NOLOCK)
      WHERE h.SiteCode='${XERP_SITE_CODE}' AND RTRIM(h.CsCode)=@cs
        AND h.BillDate >= @from AND h.BillDate <= @to
      ORDER BY h.BillDate DESC
    `);
    bills = bResult.recordset;
    const pResult = await pool.request().input('cs', cs).query(`
      SELECT ma.OriginNo, ma.AllocDate, ISNULL(ma.AllocAmnt,0) AS alloc_amt, ma.PayCode, me.ArApGubun
      FROM rpExpectMoneyAlloc ma WITH(NOLOCK)
      JOIN rpMoneyExpect me WITH(NOLOCK) ON ma.SiteCode=me.SiteCode AND ma.OriginNo=me.OriginNo AND ma.OriginSerNo=me.OriginSerNo
      WHERE me.SiteCode='${XERP_SITE_CODE}' AND RTRIM(me.CsCode)=@cs
      ORDER BY ma.AllocDate DESC
      OFFSET 0 ROWS FETCH NEXT 200 ROWS ONLY
    `);
    payments = pResult.recordset;
  } catch (e) { sources.xerp = 'error: ' + e.message; }
  ok(res, { cs_code: cs, bills, payments, sources });
});

// POST /api/acct/journal-entry — 수동 분개 생성
router.post('/api/acct/journal-entry', async (req, res, parsed) => {
  const { db, ok, fail, readJSON, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  try {
    const body = await readJSON(req);
    const { entry_date, description, lines } = body;
    if (!entry_date) { fail(res, 400, '전표일자를 입력하세요'); return; }
    if (!lines || !Array.isArray(lines) || lines.length === 0) { fail(res, 400, '분개 라인을 입력하세요'); return; }
    let totalDebit = 0, totalCredit = 0;
    for (const ln of lines) {
      if (!ln.acc_code) { fail(res, 400, '계정코드가 누락된 라인이 있습니다'); return; }
      totalDebit += (parseFloat(ln.debit) || 0);
      totalCredit += (parseFloat(ln.credit) || 0);
    }
    if (Math.abs(totalDebit - totalCredit) > 0.5) { fail(res, 400, '차변합계와 대변합계가 일치하지 않습니다 (차변: ' + totalDebit + ', 대변: ' + totalCredit + ')'); return; }
    const dateStr = entry_date.replace(/-/g, '');
    const prefix = 'JE-' + dateStr + '-';
    const createEntry = db.transaction(async () => {
      const last = await db.prepare("SELECT entry_no FROM journal_entries WHERE entry_no LIKE ? ORDER BY entry_no DESC LIMIT 1").get(prefix + '%');
      let seq = 1;
      if (last && last.entry_no) {
        const parts = last.entry_no.split('-');
        seq = parseInt(parts[parts.length - 1], 10) + 1;
      }
      const entry_no = prefix + String(seq).padStart(3, '0');
      const ins = db.prepare("INSERT INTO journal_entries (entry_no, entry_date, description, total_amount, status, created_by) VALUES (?,?,?,?,?,?)");
      const result = await ins.run(entry_no, entry_date, description || '', totalDebit, 'posted', decoded.name || decoded.username || '');
      const entryId = result.lastInsertRowid;
      const insLine = db.prepare("INSERT INTO journal_entry_lines (entry_id, line_no, acc_code, acc_name, debit, credit, description) VALUES (?,?,?,?,?,?,?)");
      for (let i = 0; i < lines.length; i++) {
        const ln = lines[i];
        await insLine.run(entryId, i + 1, ln.acc_code, ln.acc_name || '', parseFloat(ln.debit) || 0, parseFloat(ln.credit) || 0, ln.description || '');
      }
      return { id: entryId, entry_no, total_amount: totalDebit };
    });
    const entryResult = await createEntry();
    ok(res, entryResult);
  } catch (e) { fail(res, 500, '수동 분개 생성 실패: ' + e.message); }
});

// GET /api/acct/journal-entries — 수동 분개 목록
router.get('/api/acct/journal-entries', async (req, res, parsed) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  try {
    const qs = new URL(req.url, 'http://localhost').searchParams;
    const from = qs.get('from') || '';
    const to = qs.get('to') || '';
    let sql = "SELECT e.*, (SELECT COUNT(*) FROM journal_entry_lines WHERE entry_id=e.id) AS line_count FROM journal_entries e WHERE 1=1";
    const params = [];
    if (from) { sql += " AND e.entry_date >= ?"; params.push(from); }
    if (to) { sql += " AND e.entry_date <= ?"; params.push(to); }
    sql += " ORDER BY e.entry_date DESC, e.id DESC";
    const entries = await db.prepare(sql).all(...params);
    if (entries.length > 0) {
      const entryIds = entries.map(e => e.id);
      const placeholders = entryIds.map(() => '?').join(',');
      const allLines = await db.prepare("SELECT * FROM journal_entry_lines WHERE entry_id IN (" + placeholders + ") ORDER BY entry_id, line_no").all(...entryIds);
      const linesMap = {};
      for (const ln of allLines) {
        if (!linesMap[ln.entry_id]) linesMap[ln.entry_id] = [];
        linesMap[ln.entry_id].push(ln);
      }
      for (const e of entries) { e.lines = linesMap[e.id] || []; }
    } else {
      for (const e of entries) { e.lines = []; }
    }
    ok(res, { entries });
  } catch (e) { fail(res, 500, '수동 분개 조회 실패: ' + e.message); }
});

// DELETE /api/acct/journal-entries/:id — 수동 분개 삭제
router.delP(/^\/api\/acct\/journal-entries\/(\d+)$/, async (req, res, parsed, m) => {
  const { db, ok, fail, extractToken, verifyToken } = ctx;
  const token = extractToken(req); const decoded = token ? verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증 필요'); return; }
  try {
    const id = parseInt(m[1], 10);
    const entry = await db.prepare("SELECT * FROM journal_entries WHERE id=?").get(id);
    if (!entry) { fail(res, 404, '분개 전표를 찾을 수 없습니다'); return; }
    if (entry.status !== 'posted') { fail(res, 400, '삭제할 수 없는 상태입니다: ' + entry.status); return; }
    await db.prepare("DELETE FROM journal_entry_lines WHERE entry_id=?").run(id);
    await db.prepare("DELETE FROM journal_entries WHERE id=?").run(id);
    ok(res, { deleted: id });
  } catch (e) { fail(res, 500, '수동 분개 삭제 실패: ' + e.message); }
});

module.exports = { router };
