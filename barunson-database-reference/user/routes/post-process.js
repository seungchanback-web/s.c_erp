// routes/post-process.js — 후공정/거래명세서 라우트 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  PROCESS LEAD TIME API (공정 리드타임)
// ════════════════════════════════════════════════════════════════════

// GET /api/process-lead-time — 공정 리드타임 조회
router.get('/api/process-lead-time', async (req, res, parsed) => {
  const vn = parsed.searchParams.get('vendor_name');
  if (vn) {
    const rows = await ctx.db.prepare('SELECT * FROM process_lead_time WHERE vendor_name=?').all(vn);
    ctx.ok(res, rows);
  } else {
    const rows = await ctx.db.prepare('SELECT * FROM process_lead_time ORDER BY vendor_name, process_type').all();
    ctx.ok(res, rows);
  }
});

// POST /api/process-lead-time — 공정 리드타임 등록/수정
router.post('/api/process-lead-time', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { vendor_name, process_type, default_days, adjusted_days, adjusted_reason } = body;
  if (!vendor_name || !process_type) { ctx.fail(res, 400, '필수 항목 누락'); return; }
  await ctx.db.prepare(`INSERT INTO process_lead_time (vendor_name, process_type, default_days, adjusted_days, adjusted_reason)
    VALUES (?,?,?,?,?)
    ON CONFLICT(vendor_name, process_type) DO UPDATE SET
      default_days=COALESCE(excluded.default_days, default_days),
      adjusted_days=excluded.adjusted_days,
      adjusted_reason=excluded.adjusted_reason,
      updated_at=datetime('now','localtime')
  `).run(vendor_name, process_type, default_days || 1, adjusted_days || null, adjusted_reason || '');
  ctx.ok(res, { vendor_name, process_type });
});

// ════════════════════════════════════════════════════════════════════
//  POST PROCESS COST API (후공정 단가 관리)
// ════════════════════════════════════════════════════════════════════

// GET /api/post-process/prices — 단가 마스터 조회
router.get('/api/post-process/prices', async (req, res, parsed) => {
  const vendor = parsed.searchParams.get('vendor_name');
  const process = parsed.searchParams.get('process_type');
  let sql = 'SELECT * FROM post_process_price WHERE 1=1';
  const params = [];
  if (vendor) { sql += ' AND vendor_name=?'; params.push(vendor); }
  if (process) { sql += ' AND process_type=?'; params.push(process); }
  sql += ' ORDER BY process_type, spec_condition, unit_price';
  ctx.ok(res, await ctx.db.prepare(sql).all(...params));
});

// POST /api/post-process/prices — 단가 등록/수정
router.post('/api/post-process/prices', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { vendor_name, process_type, price_type, price_tier, spec_condition, unit_price, effective_from, notes } = body;
  if (!vendor_name || !process_type) { ctx.fail(res, 400, '필수 항목 누락'); return; }
  const info = ctx.db.prepare(`INSERT INTO post_process_price (vendor_name, process_type, price_type, price_tier, spec_condition, unit_price, effective_from, notes)
    VALUES (?,?,?,?,?,?,?,?)`).run(
    vendor_name, process_type, price_type||'per_unit', price_tier||'', spec_condition||'', unit_price||0, effective_from||'', notes||''
  );
  ctx.ok(res, { id: info.lastInsertRowid });
});

// ════════════════════════════════════════════════════════════════════
//  PROCESS ASSIGNEE (공정 담당자 마스터) — 후공정 PO 이메일 CC 자동 라우팅
// ════════════════════════════════════════════════════════════════════

// GET /api/process-assignees?vendor=&process=&active=1 — 목록
router.get('/api/process-assignees', async (req, res, parsed) => {
  const vendor = parsed.searchParams.get('vendor');
  const process = parsed.searchParams.get('process');
  const activeOnly = parsed.searchParams.get('active') === '1';
  let sql = 'SELECT * FROM process_assignee WHERE 1=1';
  const params = [];
  if (vendor)  { sql += ' AND vendor_name=?'; params.push(vendor); }
  if (process) { sql += ' AND process_type=?'; params.push(process); }
  if (activeOnly) sql += ' AND is_active=1';
  sql += ' ORDER BY vendor_name, process_type, assignee_name';
  ctx.ok(res, await ctx.db.prepare(sql).all(...params));
});

// POST /api/process-assignees — 신규 등록 (vendor+process+email UNIQUE 충돌 시 이름/연락처 갱신)
router.post('/api/process-assignees', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const vendor_name = (body.vendor_name || '').trim();
  const process_type = (body.process_type || '').trim();
  const assignee_email = (body.assignee_email || '').trim();
  const assignee_name = (body.assignee_name || '').trim();
  const phone = (body.phone || '').trim();
  const notes = (body.notes || '').trim();
  if (!vendor_name || !process_type) { ctx.fail(res, 400, 'vendor_name, process_type 필수'); return; }
  if (!assignee_name && !assignee_email) { ctx.fail(res, 400, '담당자명 또는 이메일 중 하나는 필수'); return; }
  try {
    const info = await ctx.db.prepare(`INSERT INTO process_assignee
      (vendor_name, process_type, assignee_name, assignee_email, phone, notes, is_active)
      VALUES (?,?,?,?,?,?,1)`).run(vendor_name, process_type, assignee_name, assignee_email, phone, notes);
    ctx.ok(res, { id: info.lastInsertRowid });
  } catch (e) {
    if (String(e.message || '').includes('UNIQUE')) {
      await ctx.db.prepare(`UPDATE process_assignee
        SET assignee_name=?, phone=?, notes=?, is_active=1, updated_at=datetime('now','localtime')
        WHERE vendor_name=? AND process_type=? AND assignee_email=?`)
        .run(assignee_name, phone, notes, vendor_name, process_type, assignee_email);
      const row = await ctx.db.prepare(`SELECT id FROM process_assignee WHERE vendor_name=? AND process_type=? AND assignee_email=?`)
        .get(vendor_name, process_type, assignee_email);
      ctx.ok(res, { id: row?.id, upserted: true });
    } else {
      ctx.fail(res, 500, e.message);
    }
  }
});

// PUT /api/process-assignees/:id — 수정
router.putP(/^\/api\/process-assignees\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1], 10);
  const body = await ctx.readJSON(req);
  const fields = [];
  const vals = [];
  for (const k of ['vendor_name','process_type','assignee_name','assignee_email','phone','notes']) {
    if (body[k] !== undefined) { fields.push(`${k}=?`); vals.push(String(body[k] || '').trim()); }
  }
  if (body.is_active !== undefined) { fields.push('is_active=?'); vals.push(body.is_active ? 1 : 0); }
  if (!fields.length) { ctx.fail(res, 400, '수정할 필드 없음'); return; }
  fields.push(`updated_at=datetime('now','localtime')`);
  vals.push(id);
  await ctx.db.prepare(`UPDATE process_assignee SET ${fields.join(',')} WHERE id=?`).run(...vals);
  ctx.ok(res, { id });
});

// DELETE /api/process-assignees/:id — 삭제
router.delP(/^\/api\/process-assignees\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1], 10);
  await ctx.db.prepare('DELETE FROM process_assignee WHERE id=?').run(id);
  ctx.ok(res, { id, deleted: true });
});

// GET /api/post-process/history — 거래 이력 조회
router.get('/api/post-process/history', async (req, res, parsed) => {
  const vendor = parsed.searchParams.get('vendor_name');
  const product = parsed.searchParams.get('product_code');
  const month = parsed.searchParams.get('month');
  const process = parsed.searchParams.get('process_type');
  let sql = 'SELECT * FROM post_process_history WHERE 1=1';
  const params = [];
  if (vendor) { sql += ' AND vendor_name=?'; params.push(vendor); }
  if (product) { sql += ' AND product_code=?'; params.push(product); }
  if (month) { sql += ' AND month=?'; params.push(month); }
  if (process) { sql += ' AND process_type=?'; params.push(process); }
  sql += ' ORDER BY month DESC, date DESC LIMIT 500';
  ctx.ok(res, await ctx.db.prepare(sql).all(...params));
});

// GET /api/post-process/product-map — 제품별 후공정 매핑
router.get('/api/post-process/product-map', async (req, res, parsed) => {
  const product = parsed.searchParams.get('product_code');
  const vendor = parsed.searchParams.get('vendor_name');
  let sql = 'SELECT * FROM product_process_map WHERE 1=1';
  const params = [];
  if (product) { sql += ' AND product_code=?'; params.push(product); }
  if (vendor) { sql += ' AND vendor_name=?'; params.push(vendor); }
  sql += ' ORDER BY product_code, process_type';
  ctx.ok(res, await ctx.db.prepare(sql).all(...params));
});

// GET /api/post-process/summary — 후공정 단가 요약 (대시보드용)
router.get('/api/post-process/summary', async (req, res, parsed) => {
  const vendor = parsed.searchParams.get('vendor_name') || '코리아패키지';
  const isAll = !parsed.searchParams.get('vendor_name');
  const whereVendor = isAll ? '1=1' : 'vendor_name=?';
  const vendorParam = isAll ? [] : [vendor];

  // 월별 총액
  const monthly = await ctx.db.prepare(`SELECT month, SUM(amount) as total, COUNT(*) as cnt FROM post_process_history WHERE ${whereVendor} GROUP BY month ORDER BY month`).all(...vendorParam);

  // 공정별 총액
  const byProcess = await ctx.db.prepare(`SELECT process_type, SUM(amount) as total, COUNT(*) as cnt, AVG(unit_price) as avg_price FROM post_process_history WHERE ${whereVendor} AND unit_price>0 GROUP BY process_type ORDER BY total DESC`).all(...vendorParam);

  // 단가 변동 감지 (같은 제품+공정인데 단가가 다른 경우)
  const priceChanges = await ctx.db.prepare(`
    SELECT product_code, process_type,
      MIN(unit_price) as min_price, MAX(unit_price) as max_price,
      COUNT(DISTINCT unit_price) as price_count,
      GROUP_CONCAT(DISTINCT month) as months
    FROM post_process_history
    WHERE ${whereVendor} AND unit_price > 0
    GROUP BY product_code, process_type
    HAVING COUNT(DISTINCT unit_price) > 1
    ORDER BY (MAX(unit_price) - MIN(unit_price)) DESC
    LIMIT 20
  `).all(...vendorParam);

  // 제품별 후공정 원가 TOP 15
  const topProducts = await ctx.db.prepare(`
    SELECT product_code, SUM(amount) as total, COUNT(DISTINCT process_type) as process_count,
      GROUP_CONCAT(DISTINCT process_type) as processes, GROUP_CONCAT(DISTINCT month) as months
    FROM post_process_history WHERE ${whereVendor}
    GROUP BY product_code ORDER BY total DESC LIMIT 15
  `).all(...vendorParam);

  // ── 추가 분석 데이터 ──────────────────────────────────────────────

  // 1. 전월 대비 변화율 (MoM)
  let momChange = null;
  if (monthly.length >= 2) {
    const cur = monthly[monthly.length - 1];
    const prev = monthly[monthly.length - 2];
    const changePct = prev.total > 0 ? Math.round(((cur.total - prev.total) / prev.total) * 1000) / 10 : 0;
    momChange = {
      current_month: cur.month,
      current_total: cur.total,
      prev_month: prev.month,
      prev_total: prev.total,
      change_pct: changePct,
      change_amount: cur.total - prev.total
    };
  } else if (monthly.length === 1) {
    const cur = monthly[0];
    momChange = { current_month: cur.month, current_total: cur.total, prev_month: null, prev_total: 0, change_pct: 0, change_amount: 0 };
  }

  // 2. 공정별 비중 (processShare)
  const grandTotal = byProcess.reduce((s, r) => s + (r.total || 0), 0);
  const processShare = byProcess.map(r => ({
    process_type: r.process_type,
    total: r.total,
    share_pct: grandTotal > 0 ? Math.round((r.total / grandTotal) * 1000) / 10 : 0
  }));

  // 3. 업체 비교 (전체 조회 시)
  let vendorComparison = null;
  if (isAll) {
    const vendorStats = await ctx.db.prepare(`
      SELECT vendor_name, SUM(amount) as total, COUNT(DISTINCT month) as months
      FROM post_process_history
      GROUP BY vendor_name
      ORDER BY total DESC
    `).all();
    vendorComparison = vendorStats.map(v => ({
      vendor_name: v.vendor_name,
      total: v.total,
      months: v.months,
      avg_monthly: v.months > 0 ? Math.round(v.total / v.months) : 0
    }));
  }

  // 4. 자동 알림 생성 (alerts)
  const alerts = [];

  // price_up: 단가 10% 이상 인상된 제품
  priceChanges.forEach(r => {
    if (r.min_price > 0 && r.max_price > r.min_price * 1.1) {
      const pct = Math.round(((r.max_price - r.min_price) / r.min_price) * 1000) / 10;
      alerts.push({
        type: 'price_up',
        message: `${r.product_code} ${r.process_type} 단가 ${r.min_price.toLocaleString()}→${r.max_price.toLocaleString()}원 (${pct}% 인상)`,
        severity: pct >= 30 ? 'critical' : 'warning',
        action: '업체 단가 협의 필요'
      });
    }
  });

  // high_cost: 최근 월이 이전 월 평균 대비 20% 이상 높음
  if (monthly.length >= 3) {
    const recent = monthly[monthly.length - 1];
    const prevMonths = monthly.slice(0, -1);
    const prevAvg = prevMonths.reduce((s, r) => s + r.total, 0) / prevMonths.length;
    if (recent.total > prevAvg * 1.2) {
      const pct = Math.round(((recent.total - prevAvg) / prevAvg) * 1000) / 10;
      alerts.push({
        type: 'high_cost',
        message: `${recent.month} 후공정 비용 ${recent.total.toLocaleString()}원 (전월 평균 대비 +${pct}%)`,
        severity: pct >= 50 ? 'warning' : 'info',
        action: '비용 증가 원인 확인'
      });
    }
  }

  // vendor_gap: 동일 공정에서 업체간 단가 차이 20% 이상
  if (isAll) {
    const vendorGapRows = await ctx.db.prepare(`
      SELECT process_type, vendor_name, AVG(unit_price) as avg_price
      FROM post_process_history
      WHERE unit_price > 0
      GROUP BY process_type, vendor_name
    `).all();
    const byProcVendor = {};
    vendorGapRows.forEach(r => {
      if (!byProcVendor[r.process_type]) byProcVendor[r.process_type] = [];
      byProcVendor[r.process_type].push(r);
    });
    Object.entries(byProcVendor).forEach(([proc, vendors]) => {
      if (vendors.length < 2) return;
      const prices = vendors.map(v => v.avg_price).sort((a, b) => a - b);
      const lo = prices[0], hi = prices[prices.length - 1];
      if (lo > 0 && hi > lo * 1.2) {
        const pct = Math.round(((hi - lo) / lo) * 1000) / 10;
        const loV = vendors.find(v => v.avg_price === lo);
        const hiV = vendors.find(v => v.avg_price === hi);
        alerts.push({
          type: 'vendor_gap',
          message: `${proc} 공정 업체간 단가 차이 ${pct}% (${loV.vendor_name} ${Math.round(lo).toLocaleString()}원 vs ${hiV.vendor_name} ${Math.round(hi).toLocaleString()}원)`,
          severity: 'info',
          action: '저가 업체 우선 발주 검토'
        });
      }
    });
  }

  // severity 정렬: critical > warning > info, 최대 10개
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => (severityOrder[a.severity] || 2) - (severityOrder[b.severity] || 2));
  const alertsTop10 = alerts.slice(0, 10);

  ctx.ok(res, { monthly, byProcess, priceChanges, topProducts, momChange, processShare, vendorComparison, alerts: alertsTop10 });
});

// GET /api/post-process/estimate — PO 예상 후공정 비용 산출
router.get('/api/post-process/estimate', async (req, res, parsed) => {
  const productCode = parsed.searchParams.get('product_code');
  if (!productCode) { ctx.fail(res, 400, 'product_code 필수'); return; }

  const mapping = await ctx.db.prepare(
    'SELECT * FROM product_process_map WHERE product_code=? ORDER BY process_type'
  ).all(productCode);

  let estimatedTotal = 0;
  const details = mapping.map(m => {
    estimatedTotal += m.last_amount || 0;
    return {
      process_type: m.process_type,
      vendor_name: m.vendor_name,
      default_spec: m.default_spec,
      estimated_price: m.default_price,
      last_amount: m.last_amount,
      occurrence: m.occurrence,
      last_month: m.last_month,
    };
  });

  ctx.ok(res, { product_code: productCode, estimated_total: estimatedTotal, processes: details });
});

// ════════════════════════════════════════════════════════════════════
//  TRADE DOCUMENT API (거래명세서)
// ════════════════════════════════════════════════════════════════════

// POST /api/trade-document — 거래명세서 생성
router.post('/api/trade-document', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { po_id, vendor_name, vendor_type, items } = body;
  if (!po_id) { ctx.fail(res, 400, 'po_id 필수'); return; }
  const po = await ctx.db.prepare('SELECT po_number FROM po_header WHERE po_id=?').get(po_id);
  if (!po) { ctx.fail(res, 404, 'PO 없음'); return; }
  const r = await ctx.db.prepare(`INSERT INTO trade_document (po_id, po_number, vendor_name, vendor_type, items_json, status) VALUES (?,?,?,?,?,'sent')`)
    .run(po_id, po.po_number, vendor_name || '', vendor_type || 'material', JSON.stringify(items || []));
  ctx.ok(res, { id: r.lastInsertRowid });
});

// GET /api/trade-document — 거래명세서 목록 조회 (필터링)
router.get('/api/trade-document', async (req, res, parsed) => {
  let q = 'SELECT * FROM trade_document WHERE 1=1';
  const args = [];
  if (parsed.searchParams.get('status')) { q += ' AND status=?'; args.push(parsed.searchParams.get('status')); }
  if (parsed.searchParams.get('vendor_name')) { q += ' AND vendor_name=?'; args.push(parsed.searchParams.get('vendor_name')); }
  if (parsed.searchParams.get('po_id')) { q += ' AND po_id=?'; args.push(parsed.searchParams.get('po_id')); }
  const _tdEnt = parsed.searchParams.get('entity');
  if (_tdEnt && _tdEnt !== 'all' && ctx._hasEntity.trade_document) { q += ' AND legal_entity=?'; args.push(_tdEnt); }
  q += ' ORDER BY created_at DESC';
  ctx.ok(res, await ctx.db.prepare(q).all(...args));
});

// PATCH /api/trade-document/:id — 거래명세서 수정 (업체 확인, 관리자 승인 등)
router.addPattern('PATCH', /^\/api\/trade-document\/(\d+)$/, async (req, res, parsed, m) => {
  const docId = m[1];
  const doc = await ctx.db.prepare('SELECT * FROM trade_document WHERE id=?').get(docId);
  if (!doc) { ctx.fail(res, 404, '문서 없음'); return; }
  const body = await ctx.readJSON(req);
  const sets = [];
  const vals = [];
  if (body.vendor_modified_json !== undefined) {
    sets.push('vendor_modified_json=?');
    vals.push(typeof body.vendor_modified_json === 'string' ? body.vendor_modified_json : JSON.stringify(body.vendor_modified_json));
  }
  if (body.vendor_memo !== undefined) { sets.push('vendor_memo=?'); vals.push(body.vendor_memo); }
  if (body.status !== undefined) {
    sets.push('status=?'); vals.push(body.status);
    if (body.status === 'vendor_confirmed') { sets.push("confirmed_at=datetime('now','localtime')"); }
    if (body.status === 'approved') { sets.push("approved_at=datetime('now','localtime')"); }
  }
  if (body.price_diff !== undefined) { sets.push('price_diff=?'); vals.push(body.price_diff ? 1 : 0); }
  if (sets.length === 0) { ctx.fail(res, 400, '수정 항목 없음'); return; }
  sets.push("updated_at=datetime('now','localtime')");
  vals.push(docId);
  await ctx.db.prepare(`UPDATE trade_document SET ${sets.join(',')} WHERE id=?`).run(...vals);
  ctx.ok(res, { id: parseInt(docId) });
});

// GET /api/trade-document/review — 검토 대기 목록 (vendor_confirmed)
router.get('/api/trade-document/review', async (req, res, parsed) => {
  const docs = await ctx.db.prepare(`SELECT * FROM trade_document WHERE status='vendor_confirmed' ORDER BY confirmed_at DESC`).all();
  docs.forEach(d => {
    d.items = JSON.parse(d.items_json || '[]');
    d.vendor_modified = d.vendor_modified_json ? JSON.parse(d.vendor_modified_json) : null;
  });
  ctx.ok(res, docs);
});

// POST /api/trade-document/:id/approve — 거래명세서 승인 (재고 등록 연동)
router.postP(/^\/api\/trade-document\/(\d+)\/approve$/, async (req, res, parsed, m) => {
  const docId = parseInt(m[1]);
  const doc = await ctx.db.prepare('SELECT * FROM trade_document WHERE id=?').get(docId);
  if (!doc) { ctx.fail(res, 404, '문서 없음'); return; }

  if (doc.price_diff && !doc.vendor_memo) {
    ctx.fail(res, 400, '단가 차이가 있으나 수정 사유가 없습니다. 업체에 사유 입력을 요청하세요.');
    return;
  }

  await ctx.db.prepare(`UPDATE trade_document SET status='approved', approved_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`).run(docId);

  ctx.logPOActivity(doc.po_id, 'trade_doc_approved', {
    actor_type: 'admin',
    details: doc.price_diff ? `거래명세서 승인 (단가 수정 있음, 사유: ${doc.vendor_memo})` : '거래명세서 승인'
  });

  ctx.ok(res, { doc_id: docId, status: 'approved' });
});

// POST /api/trade-document/:id/create-po — 거래명세서 → 신규 발주서 역변환
router.postP(/^\/api\/trade-document\/(\d+)\/create-po$/, async (req, res, parsed, m) => {
  const docId = parseInt(m[1]);
  const body = await ctx.readJSON(req).catch(() => ({}));
  const doc = await ctx.db.prepare('SELECT * FROM trade_document WHERE id=?').get(docId);
  if (!doc) { ctx.fail(res, 404, '거래명세서 없음'); return; }
  // 우선순위: 사용자 전달 items > vendor_modified > items_json
  let items = [];
  try {
    if (body.items && Array.isArray(body.items)) items = body.items;
    else if (doc.vendor_modified_json) items = JSON.parse(doc.vendor_modified_json) || [];
    else items = JSON.parse(doc.items_json || '[]');
  } catch (e) { ctx.fail(res, 400, '명세서 items 파싱 실패: ' + e.message); return; }
  if (!items.length) { ctx.fail(res, 400, 'items가 비어있습니다'); return; }
  const vendor = body.vendor_name || doc.vendor_name || '';
  if (!vendor) { ctx.fail(res, 400, 'vendor_name 없음'); return; }
  const poType = body.po_type || (doc.vendor_type === 'process' ? '후공정' : '원재료');
  const totalQty = items.reduce((s, i) => s + (Number(i.ordered_qty || i.qty || 0)), 0);
  const totalAmt = items.reduce((s, i) => s + (Number(i.ordered_qty || i.qty || 0) * Number(i.unit_price || 0)), 0);
  const poNum = 'PO-RV-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String(Math.floor(Math.random()*900)+100);
  const notes = (body.notes || `거래명세서 #${docId} 역변환`) + (totalAmt ? ` (예상금액 ${Math.round(totalAmt).toLocaleString()}원)` : '');

  const tx = ctx.db.transaction(async () => {
    const info = await ctx.db.prepare(`INSERT INTO po_header
      (po_number, po_type, vendor_name, status, due_date, total_qty, notes, parent_po_id, origin, po_date)
      VALUES (?,?,?,?,?,?,?,?,?,date('now','localtime'))`).run(
      poNum, poType, vendor, 'draft',
      body.due_date || '', totalQty, notes,
      doc.po_id || null, '거래명세서역변환'
    );
    const newPoId = info.lastInsertRowid;
    const stmt = ctx.db.prepare(`INSERT INTO po_items
      (po_id, product_code, brand, process_type, ordered_qty, spec, notes)
      VALUES (?,?,?,?,?,?,?)`);
    for (const it of items) {
      const unitPrice = Number(it.unit_price || 0);
      const noteParts = [];
      if (it.product_name) noteParts.push(it.product_name);
      if (unitPrice) noteParts.push(`@${unitPrice.toLocaleString()}`);
      await stmt.run(
        newPoId,
        it.product_code || '',
        it.brand || '',
        it.process_type || '',
        Number(it.ordered_qty || it.qty || 0),
        it.spec || '',
        noteParts.join(' ')
      );
    }
    await ctx.db.prepare(`INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)`).run(
      newPoId, 'created_from_trade_doc', body.actor || 'system',
      `거래명세서 #${docId} (${doc.po_number || ''}) 에서 역변환 생성`
    );
    if (doc.po_id) {
      await ctx.db.prepare(`INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)`).run(
        doc.po_id, 'reverse_po_created', body.actor || 'system',
        `거래명세서 #${docId} → 신규 PO ${poNum}`
      );
    }
    return newPoId;
  });
  const newPoId = await tx();
  ctx.ok(res, { po_id: newPoId, po_number: poNum, total_qty: totalQty, total_amount: totalAmt, items_count: items.length });
});

// GET /api/trade-document/management — 거래명세서 관리 (업체별+월별 그룹, 가격변동 감지)
router.get('/api/trade-document/management', async (req, res, parsed) => {
  const from = parsed.searchParams.get('from') || '';
  const to = parsed.searchParams.get('to') || '';
  const vendor = parsed.searchParams.get('vendor') || '';

  let q = `SELECT td.*, ph.po_date FROM trade_document td LEFT JOIN po_header ph ON td.po_id=ph.po_id WHERE td.status IN ('sent','vendor_confirmed','approved')`;
  const args = [];
  if (from) { q += ` AND ph.po_date >= ?`; args.push(from); }
  if (to) { q += ` AND ph.po_date <= ?`; args.push(to); }
  if (vendor) { q += ` AND td.vendor_name = ?`; args.push(vendor); }
  q += ` ORDER BY ph.po_date DESC, td.id DESC`;

  const docs = await ctx.db.prepare(q).all(...args);

  // 가격변동 감지를 위해 업체+품목별 가격 이력 구축
  const priceHistory = {};

  const results = docs.map(doc => {
    const items = JSON.parse(doc.items_json || '[]');
    const modified = doc.vendor_modified_json ? JSON.parse(doc.vendor_modified_json) : null;
    let totalAmount = 0;
    let hasPriceChange = false;

    const enrichedItems = items.map((item, i) => {
      const mod = modified && modified[i] ? modified[i] : null;
      const currentPrice = mod ? mod.unit_price : item.unit_price;
      const qty = mod ? (mod.qty || item.qty) : item.qty;
      const amount = Math.round((currentPrice || 0) * (qty || 0));
      totalAmount += amount;

      const key = `${doc.vendor_name}::${item.product_code}`;
      if (!priceHistory[key]) priceHistory[key] = [];
      const prev = priceHistory[key].length > 0 ? priceHistory[key][priceHistory[key].length - 1] : null;
      let priceChangeRate = 0;
      if (prev !== null && prev > 0 && currentPrice > 0 && currentPrice !== prev) {
        priceChangeRate = ((currentPrice - prev) / prev * 100);
        hasPriceChange = true;
      }
      priceHistory[key].push(currentPrice || 0);

      return {
        product_code: item.product_code,
        product_name: item.product_name || '',
        material_name: item.material_name || '',
        qty: qty || 0,
        cut: item.cut || '',
        imposition: item.imposition || '',
        unit_price: currentPrice || 0,
        last_price: item.last_price || 0,
        amount,
        price_change_rate: Math.round(priceChangeRate * 10) / 10,
        modified: !!mod && mod.unit_price !== item.unit_price
      };
    });

    return {
      id: doc.id,
      po_id: doc.po_id,
      po_number: doc.po_number,
      po_date: doc.po_date || '',
      vendor_name: doc.vendor_name,
      vendor_type: doc.vendor_type,
      status: doc.status,
      confirmed_at: doc.confirmed_at || '',
      approved_at: doc.approved_at || '',
      vendor_memo: doc.vendor_memo || '',
      price_diff: doc.price_diff || 0,
      items: enrichedItems,
      total_amount: totalAmount,
      tax: Math.round(totalAmount * 0.1),
      has_price_change: hasPriceChange
    };
  });

  const vendorList = (await ctx.db.prepare(`SELECT DISTINCT vendor_name FROM trade_document WHERE status IN ('sent','vendor_confirmed','approved') ORDER BY vendor_name`).all()).map(r => r.vendor_name);

  ctx.ok(res, { docs: results, vendors: vendorList });
});

// GET /api/trade-document/export — 엑셀 다운로드
router.get('/api/trade-document/export', async (req, res, parsed) => {
  const from = parsed.searchParams.get('from') || '';
  const to = parsed.searchParams.get('to') || '';
  const vendor = parsed.searchParams.get('vendor') || '';

  let q = `SELECT td.*, ph.po_date FROM trade_document td LEFT JOIN po_header ph ON td.po_id=ph.po_id WHERE td.status IN ('vendor_confirmed','approved')`;
  const args = [];
  if (from) { q += ` AND ph.po_date >= ?`; args.push(from); }
  if (to) { q += ` AND ph.po_date <= ?`; args.push(to); }
  if (vendor) { q += ` AND td.vendor_name = ?`; args.push(vendor); }
  q += ` ORDER BY td.vendor_name, ph.po_date DESC`;

  const docs = await ctx.db.prepare(q).all(...args);
  const piMap = ctx.getProductInfo();

  // CSV 생성 (엑셀 호환)
  const BOM = '\uFEFF';
  let csv = BOM + '일자,PO번호,업체명,유형,품목코드,품명/원재료,수량,R(연),단가,금액,세액,합계,상태,가격변동\n';

  for (const doc of docs) {
    const items = JSON.parse(doc.items_json || '[]');
    const modified = doc.vendor_modified_json ? JSON.parse(doc.vendor_modified_json) : null;
    const statusLabel = doc.status === 'approved' ? '승인' : doc.status === 'vendor_confirmed' ? '확인' : '발송';
    const typeLabel = doc.vendor_type === 'process' ? '후공정' : '원재료';

    items.forEach((item, i) => {
      const mod = modified && modified[i] ? modified[i] : null;
      const price = mod ? mod.unit_price : item.unit_price;
      const qty = item.qty || 0;
      const amount = Math.round((price || 0) * qty);
      const tax = Math.round(amount * 0.1);
      const pi = piMap[item.product_code] || {};
      const cut = parseFloat(item.cut || pi['절']) || 0;
      const imp = parseFloat(item.imposition || pi['조판']) || 0;
      const ream = (cut && imp) ? (qty / 500 / cut / imp).toFixed(1) : '';
      const priceChanged = mod && mod.unit_price !== item.unit_price;
      const changePct = item.last_price && item.last_price > 0 && price !== item.last_price
        ? ((price - item.last_price) / item.last_price * 100).toFixed(1) + '%' : '';

      csv += `${doc.po_date || ''},${doc.po_number},${doc.vendor_name},${typeLabel},${item.product_code},${item.material_name || item.product_name || ''},${qty},${ream},${price || 0},${amount},${tax},${amount + tax},${statusLabel},${priceChanged ? '변동' : ''}${changePct}\n`;
    });
  }

  res.writeHead(200, {
    'Content-Type': 'text/csv; charset=utf-8',
    'Content-Disposition': `attachment; filename="trade_docs_${from||'all'}_${to||'all'}.csv"`
  });
  res.end(csv);
});

module.exports = { router };
