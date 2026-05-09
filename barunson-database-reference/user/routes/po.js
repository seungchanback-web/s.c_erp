// routes/po.js — 발주(PO) 관리 라우트 모듈
// 통합발주관리, 한국/중국/더기프트 워크플로우, PO CRUD, 발주서(po-drafts)
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  통합발주관리 API (한국/중국/더기프트 origin별 워크플로우)
// ════════════════════════════════════════════════════════════════════

// GET /api/procurement/dashboard — origin별 파이프라인 요약 (entity 필터 지원)
router.get('/api/procurement/dashboard', async (req, res, parsed) => {
  const db = ctx.db;
  const entity = parsed.searchParams.get('entity') || 'all';
  const _useEnt = ctx._hasEntity.po_header && entity && entity !== 'all';
  const entityClause = _useEnt ? ' AND legal_entity=?' : '';
  const entityParams = _useEnt ? [entity] : [];
  const origins = (entity === 'dd') ? ['한국', '중국'] : ['한국', '중국', '더기프트'];
  const result = {};
  for (const org of origins) {
    const total = await db.prepare(`SELECT COUNT(*) AS c FROM po_header WHERE origin=?${entityClause}`).get(org, ...entityParams);
    const byStatus = await db.prepare(`SELECT status, COUNT(*) AS c FROM po_header WHERE origin=?${entityClause} GROUP BY status`).all(org, ...entityParams);
    const partial = await db.prepare(`SELECT COUNT(*) AS c FROM po_header WHERE origin=? AND status='partial'${entityClause}`).get(org, ...entityParams);
    const overdue = await db.prepare(`SELECT COUNT(*) AS c FROM po_header WHERE origin=? AND status NOT IN ('received','cancelled','completed') AND due_date != '' AND due_date::date < CURRENT_DATE${entityClause}`).get(org, ...entityParams);
    const _recentCols = ctx._hasEntity.po_header
      ? 'po_id, po_number, vendor_name, status, due_date as expected_date, po_date, total_qty, legal_entity'
      : 'po_id, po_number, vendor_name, status, due_date as expected_date, po_date, total_qty';
    const recentPo = await db.prepare(`SELECT ${_recentCols} FROM po_header WHERE origin=?${entityClause} ORDER BY created_at DESC LIMIT 5`).all(org, ...entityParams);
    const rcvRate = await db.prepare(`
      SELECT COALESCE(SUM(i.received_qty),0) AS received, COALESCE(SUM(i.ordered_qty),0) AS ordered
      FROM po_items i JOIN po_header h ON h.po_id=i.po_id WHERE h.origin=? AND h.status NOT IN ('cancelled','draft')${entityClause.replace('legal_entity','h.legal_entity')}
    `).get(org, ...entityParams);
    result[org] = {
      total: Number(total.c),
      by_status: Object.fromEntries(byStatus.map(r => [r.status, Number(r.c)])),
      partial: Number(partial.c),
      overdue: Number(overdue.c),
      receive_rate: rcvRate.ordered > 0 ? Math.round(rcvRate.received / rcvRate.ordered * 100) : 0,
      recent: recentPo
    };
  }
  // 법인별 합계 (컬럼 있을 때만)
  const entityTotals = { barunson: 0, dd: 0 };
  if (ctx._hasEntity.po_header) {
    for (const ent of ['barunson', 'dd']) {
      const r = await db.prepare("SELECT COUNT(*) AS c FROM po_header WHERE legal_entity=?").get(ent);
      entityTotals[ent] = Number(r.c);
    }
  }
  // 중국 선적/더기프트 포장 (바른컴퍼니 전용)
  const shipments = (entity === 'dd') ? [] : await db.prepare("SELECT * FROM china_shipment_log WHERE status NOT IN ('completed','cancelled') ORDER BY eta_date ASC LIMIT 10").all();
  const assemblies = (entity === 'dd') ? [] : await db.prepare("SELECT * FROM gift_assembly WHERE status NOT IN ('completed','cancelled') ORDER BY created_at DESC LIMIT 10").all();
  ctx.ok(res, { origins: result, shipments, assemblies, entity_totals: entityTotals, entity });
});

// GET /api/procurement/po-receive-status — PO별 아이템 입고현황 (분할입고 추적)
router.get('/api/procurement/po-receive-status', async (req, res, parsed) => {
  const db = ctx.db;
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const origin = qs.get('origin') || '';
  const status = qs.get('status') || '';
  const entity = qs.get('entity') || '';
  let where = "WHERE 1=1";
  const params = [];
  if (origin) { where += " AND h.origin=?"; params.push(origin); }
  if (entity && entity !== 'all' && ctx._hasEntity.po_header) { where += " AND h.legal_entity=?"; params.push(entity); }
  if (status) { where += " AND h.status=?"; params.push(status); }
  else { where += " AND h.status NOT IN ('cancelled','draft')"; }
  const rows = await db.prepare(`
    SELECT h.po_id, h.po_number, h.origin, h.vendor_name, h.status, h.po_date, h.due_date as expected_date,
           h.po_type, h.material_status, h.process_status, h.process_step, h.notes,
           i.item_id, i.product_code, i.brand, i.process_type, i.ordered_qty, i.received_qty, i.spec
    FROM po_header h JOIN po_items i ON h.po_id = i.po_id ${where}
    ORDER BY h.created_at DESC
  `).all(...params);
  // Group by PO
  const poMap = new Map();
  for (const r of rows) {
    if (!poMap.has(r.po_id)) {
      poMap.set(r.po_id, {
        po_id: r.po_id, po_number: r.po_number, origin: r.origin,
        vendor_name: r.vendor_name, status: r.status, po_date: r.po_date,
        expected_date: r.expected_date, po_type: r.po_type,
        material_status: r.material_status, process_status: r.process_status,
        process_step: r.process_step, notes: r.notes,
        items: [], total_ordered: 0, total_received: 0
      });
    }
    const po = poMap.get(r.po_id);
    po.items.push({ item_id: r.item_id, product_code: r.product_code, brand: r.brand, process_type: r.process_type, ordered_qty: r.ordered_qty, received_qty: r.received_qty, spec: r.spec, progress: r.ordered_qty > 0 ? Math.round(r.received_qty / r.ordered_qty * 100) : 0 });
    po.total_ordered += r.ordered_qty;
    po.total_received += r.received_qty;
  }
  const data = Array.from(poMap.values()).map(po => ({ ...po, progress: po.total_ordered > 0 ? Math.round(po.total_received / po.total_ordered * 100) : 0 }));
  ctx.ok(res, data);
});

// POST /api/procurement/receive — 분할입고 (아이템 단위)
router.post('/api/procurement/receive', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.po_id) { ctx.fail(res, 400, 'po_id required'); return; }
  const items = body.items || []; // [{po_item_id, product_code, received_qty, defect_qty, notes}]
  if (!items.length) { ctx.fail(res, 400, 'items required'); return; }
  const tx = db.transaction(async () => {
    const rInfo = await db.prepare("INSERT INTO receipts (po_id, receipt_date, received_by, notes) VALUES (?, ?, ?, ?)").run(
      body.po_id, body.receipt_date || new Date().toISOString().slice(0,10), body.received_by || '', body.notes || '');
    const receiptId = rInfo.lastInsertRowid;
    const riStmt = db.prepare("INSERT INTO receipt_items (receipt_id, po_item_id, product_code, received_qty, defect_qty, notes) VALUES (?,?,?,?,?,?)");
    const updItem = db.prepare("UPDATE po_items SET received_qty = received_qty + ? WHERE item_id = ?");
    for (const it of items) {
      await riStmt.run(receiptId, it.po_item_id || null, it.product_code || '', it.received_qty || 0, it.defect_qty || 0, it.notes || '');
      if (it.po_item_id && it.received_qty) await updItem.run(it.received_qty, it.po_item_id);
    }
    // PO 상태 자동 갱신 (±tolerance% 허용 로직)
    const poHeader = await db.prepare('SELECT tolerance_pct, origin FROM po_header WHERE po_id=?').get(body.po_id);
    const tolerancePct = poHeader?.tolerance_pct || 5.0;
    const poItems = await db.prepare('SELECT ordered_qty, received_qty FROM po_items WHERE po_id=?').all(body.po_id);
    const totalOrdered = poItems.reduce((s, pi) => s + pi.ordered_qty, 0);
    const totalReceived = poItems.reduce((s, pi) => s + pi.received_qty, 0);
    const lowerBound = totalOrdered * (1 - tolerancePct / 100);
    const upperBound = totalOrdered * (1 + tolerancePct / 100);
    const allExact = poItems.length > 0 && poItems.every(pi => pi.received_qty >= pi.ordered_qty);
    const withinTolerance = totalReceived >= lowerBound && totalReceived <= upperBound;
    const anyDone = poItems.some(pi => pi.received_qty > 0);
    let autoCompleted = false;
    if (allExact || (withinTolerance && totalReceived >= lowerBound)) {
      await db.prepare("UPDATE po_header SET status='received', process_status='completed', material_status='received', updated_at=datetime('now','localtime') WHERE po_id=?").run(body.po_id);
      autoCompleted = true;
      if (withinTolerance && !allExact) {
        await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)").run(
          body.po_id, 'auto_complete_tolerance', 'system',
          `±${tolerancePct}% 허용범위 자동완료 (발주:${totalOrdered}, 입고:${totalReceived}, 범위:${Math.round(lowerBound)}~${Math.round(upperBound)})`);
      }
    } else if (anyDone) {
      await db.prepare("UPDATE po_header SET status='partial', process_status='working', updated_at=datetime('now','localtime') WHERE po_id=?").run(body.po_id);
    }
    // 입고 활동 로그
    await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)").run(
      body.po_id, 'receive', body.received_by || 'system',
      JSON.stringify(items.map(i => ({ code: i.product_code, qty: i.received_qty })))
    );
    // ── 입고 → 창고재고(warehouse_inventory) 자동 연동 ──
    const defaultWh = await db.prepare("SELECT id FROM warehouses WHERE is_default=1 LIMIT 1").get();
    if (defaultWh) {
      for (const it of items) {
        if (!it.product_code || !it.received_qty) continue;
        const pName = (await db.prepare('SELECT product_name FROM products WHERE product_code=?').get(it.product_code))?.product_name || '';
        const existing = await db.prepare('SELECT id, quantity FROM warehouse_inventory WHERE warehouse_id=? AND product_code=?').get(defaultWh.id, it.product_code);
        if (existing) {
          await db.prepare('UPDATE warehouse_inventory SET quantity=quantity+?, updated_at=datetime(\'now\',\'localtime\') WHERE id=?').run(it.received_qty, existing.id);
        } else {
          await db.prepare('INSERT INTO warehouse_inventory (warehouse_id, product_code, product_name, quantity) VALUES (?,?,?,?)').run(defaultWh.id, it.product_code, pName, it.received_qty);
        }
      }
    }
    // 선적 연결 (중국인 경우)
    if (body.shipment_id) {
      const spStmt = db.prepare("INSERT OR REPLACE INTO shipment_po_items (shipment_id, po_id, po_item_id, product_code, shipped_qty, received_qty) VALUES (?,?,?,?,?,?)");
      for (const it of items) {
        await spStmt.run(body.shipment_id, body.po_id, it.po_item_id || null, it.product_code || '', it.shipped_qty || it.received_qty, it.received_qty || 0);
      }
    }
    return receiptId;
  });
  const receiptId = await tx();
  // 알림
  const po = await db.prepare("SELECT po_number, origin, vendor_name FROM po_header WHERE po_id=?").get(body.po_id);
  if (po) ctx.createNotification(null, 'po', `입고완료: ${po.po_number}`, `${po.vendor_name} - ${items.length}건 입고`, 'procurement');
  // 자동 전표 생성 훅 (입고→매입전표)
  if (global._hookReceiveJournal) {
    try { global._hookReceiveJournal(body.po_id, items, body.received_by || ''); }
    catch(e) { console.error('전표 자동생성 오류:', e.message); }
  }
  if (req._currentUser) ctx.auditLog(req._currentUser.userId, req._currentUser.username, 'receipt_create', 'receipts', receiptId, `입고: PO ${body.po_id}, ${items.length}건`, req._clientIP);
  ctx.ok(res, { receipt_id: receiptId });
});

// GET /api/procurement/receive-history/:poId — PO의 입고이력
router.getP(/^\/api\/procurement\/receive-history\/(\d+)$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const poId = m[1];
  const receipts = await db.prepare(`
    SELECT r.id, r.receipt_date, r.received_by, r.notes AS receipt_notes,
           ri.product_code, ri.received_qty, ri.defect_qty, ri.notes AS item_notes
    FROM receipts r JOIN receipt_items ri ON r.id = ri.receipt_id
    WHERE r.po_id = ? ORDER BY r.receipt_date DESC
  `).all(poId);
  ctx.ok(res, receipts);
});

// ── 중국 선적 ↔ PO 연결 ──

// POST /api/procurement/shipment-link — 선적에 PO 아이템 연결
router.post('/api/procurement/shipment-link', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.shipment_id || !body.items?.length) { ctx.fail(res, 400, 'shipment_id + items required'); return; }
  const stmt = db.prepare("INSERT OR REPLACE INTO shipment_po_items (shipment_id, po_id, po_item_id, product_code, product_name, shipped_qty, notes) VALUES (?,?,?,?,?,?,?)");
  const tx = db.transaction(async () => {
    for (const it of body.items) {
      await stmt.run(body.shipment_id, it.po_id, it.po_item_id || null, it.product_code || '', it.product_name || '', it.shipped_qty || 0, it.notes || '');
    }
  });
  await tx();
  ctx.ok(res, { linked: body.items.length });
});

// GET /api/procurement/shipment-items/:shipmentId — 선적에 포함된 PO 아이템
router.getP(/^\/api\/procurement\/shipment-items\/(\d+)$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const rows = await db.prepare(`
    SELECT s.*, h.po_number, h.vendor_name, h.origin
    FROM shipment_po_items s
    JOIN po_header h ON h.po_id = s.po_id
    WHERE s.shipment_id = ?
  `).all(m[1]);
  ctx.ok(res, rows);
});

// ── 더기프트 포장작업 ──

// GET /api/procurement/assembly — 포장작업 목록
router.get('/api/procurement/assembly', async (req, res, parsed) => {
  const db = ctx.db;
  const rows = await db.prepare("SELECT * FROM gift_assembly ORDER BY created_at DESC").all();
  for (const r of rows) {
    r.materials = await db.prepare("SELECT * FROM gift_assembly_materials WHERE assembly_id=?").all(r.id);
  }
  ctx.ok(res, rows);
});

// POST /api/procurement/assembly — 포장작업 생성
router.post('/api/procurement/assembly', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.product_code || !body.target_qty) { ctx.fail(res, 400, 'product_code + target_qty required'); return; }
  const no = 'GA-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String(Math.random()).slice(2,5);
  const info = await db.prepare("INSERT INTO gift_assembly (assembly_no, product_code, product_name, target_qty, assembly_date, worker_name, notes) VALUES (?,?,?,?,?,?,?)").run(
    no, body.product_code, body.product_name || '', body.target_qty, body.assembly_date || new Date().toISOString().slice(0,10), body.worker_name || '', body.notes || '');
  const asmId = info.lastInsertRowid;
  // 자재 등록
  if (body.materials?.length) {
    const stmt = db.prepare("INSERT INTO gift_assembly_materials (assembly_id, item_code, item_name, required_qty) VALUES (?,?,?,?)");
    for (const m of body.materials) await stmt.run(asmId, m.item_code, m.item_name || '', m.required_qty || 0);
  }
  ctx.ok(res, { id: asmId, assembly_no: no });
});

// POST /api/procurement/assembly/:id/complete — 포장완료
router.postP(/^\/api\/procurement\/assembly\/(\d+)\/complete$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  const id = m[1];
  await db.prepare("UPDATE gift_assembly SET status='completed', completed_qty=?, completed_date=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?").run(body.completed_qty || 0, id);
  const asm = await db.prepare("SELECT * FROM gift_assembly WHERE id=?").get(id);
  if (asm) {
    ctx.createNotification(null, 'po', `포장완료: ${asm.assembly_no}`, `${asm.product_name} ${body.completed_qty}개 포장 완료`, 'procurement');
    // 생산재고 연동: gift_sets에 매칭되는 세트가 있으면 assembly 트랜잭션 기록
    const matchedSet = await db.prepare("SELECT id, set_name FROM gift_sets WHERE set_code=? OR set_name=?").get(asm.product_code, asm.product_name);
    if (matchedSet) {
      await db.prepare("INSERT INTO gift_set_transactions (set_id, tx_type, qty, operator, memo) VALUES (?,?,?,?,?)").run(
        matchedSet.id, 'assembly', body.completed_qty || 0, asm.worker_name || '', `포장작업 연동: ${asm.assembly_no}`);
    }
  }
  ctx.ok(res, { completed: true });
});

// POST /api/procurement/force-complete — 허용범위 미달 시 관리자 강제완료
router.post('/api/procurement/force-complete', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.po_id) { ctx.fail(res, 400, 'po_id required'); return; }
  const po = await db.prepare('SELECT * FROM po_header WHERE po_id=?').get(body.po_id);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  const poItems = await db.prepare('SELECT ordered_qty, received_qty FROM po_items WHERE po_id=?').all(body.po_id);
  const totalOrdered = poItems.reduce((s, pi) => s + pi.ordered_qty, 0);
  const totalReceived = poItems.reduce((s, pi) => s + pi.received_qty, 0);
  await db.prepare("UPDATE po_header SET status='received', process_status='completed', material_status='received', force_completed=1, force_completed_by=?, force_completed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE po_id=?")
    .run(body.completed_by || 'admin', body.po_id);
  await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)").run(
    body.po_id, 'force_complete', body.completed_by || 'admin',
    `강제완료 (발주:${totalOrdered}, 입고:${totalReceived}, 사유:${body.reason || '관리자 승인'})`);
  ctx.createNotification(null, 'po', `강제완료: ${po.po_number}`, `${po.vendor_name} - 관리자 강제완료 (${totalReceived}/${totalOrdered})`, 'procurement');
  ctx.ok(res, { force_completed: true, ordered: totalOrdered, received: totalReceived });
});

// POST /api/procurement/confirm-material-date — 제지사가 후공정 업체에 자재 보내는 날짜 확정
router.post('/api/procurement/confirm-material-date', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.po_id || !body.material_send_date) { ctx.fail(res, 400, 'po_id + material_send_date required'); return; }
  const po = await db.prepare('SELECT * FROM po_header WHERE po_id=?').get(body.po_id);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  await db.prepare("UPDATE po_header SET material_send_date=?, material_confirmed_at=datetime('now','localtime'), material_status='confirmed', updated_at=datetime('now','localtime') WHERE po_id=?")
    .run(body.material_send_date, body.po_id);
  await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)").run(
    body.po_id, 'material_date_confirmed', body.actor || 'vendor',
    `자재 출고일 확정: ${body.material_send_date}`);
  // 후공정 업체에 이메일 자동 발송 (자재 출고일 확정 시)
  const _senderCompany = (po.legal_entity === 'dd') ? '바른디자인' : '바른컴퍼니';
  let emailResult = null;
  const processVendor = po.process_vendor_name || '';
  if (processVendor) {
    const vendor = await db.prepare('SELECT * FROM vendors WHERE name=?').get(processVendor);
    const smtpTransporter = ctx.getSmtpTransporter();
    if (vendor && vendor.email && smtpTransporter) {
      const items = await db.prepare('SELECT * FROM po_items WHERE po_id=?').all(body.po_id);
      const itemsList = items.map(i => `<tr><td>${i.product_code}</td><td>${i.brand||''}</td><td>${i.ordered_qty}</td><td>${i.spec||''}</td></tr>`).join('');
      const html = `<h3>${_senderCompany} - 자재 출고 안내</h3>
        <p>발주번호: <b>${po.po_number}</b></p>
        <p>원재료 업체(${po.material_vendor_name||po.vendor_name})에서 <b>${body.material_send_date}</b>에 자재를 출고합니다.</p>
        <table border="1" cellpadding="6" style="border-collapse:collapse"><thead><tr><th>품목코드</th><th>브랜드</th><th>수량</th><th>규격</th></tr></thead><tbody>${itemsList}</tbody></table>
        <p>작업 일정 확인 부탁드립니다.</p>`;
      try {
        await smtpTransporter.sendMail({ from: `${_senderCompany} <${ctx.SMTP_FROM}>`, to: vendor.email, cc: vendor.email_cc || undefined, subject: `[${_senderCompany}] 자재 출고 안내 - ${po.po_number}`, html });
        await db.prepare("UPDATE po_header SET process_email_sent=1 WHERE po_id=?").run(body.po_id);
        emailResult = { sent: true, to: vendor.email };
      } catch(e) { emailResult = { sent: false, error: e.message }; }
    }
  }
  ctx.createNotification(null, 'po', `자재출고 확정: ${po.po_number}`, `${body.material_send_date} 후공정(${processVendor})으로 출고`, 'procurement');
  ctx.ok(res, { confirmed: true, material_send_date: body.material_send_date, email: emailResult });
});

// POST /api/procurement/confirm-delivery-date — 거래처가 입고일 확정 (후공정 업체가 입고일 클릭)
router.post('/api/procurement/confirm-delivery-date', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.po_id || !body.confirmed_date) { ctx.fail(res, 400, 'po_id + confirmed_date required'); return; }
  const po = await db.prepare('SELECT * FROM po_header WHERE po_id=?').get(body.po_id);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  await db.prepare("UPDATE po_header SET vendor_confirmed_date=?, vendor_confirmed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE po_id=?")
    .run(body.confirmed_date, body.po_id);
  await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)").run(
    body.po_id, 'delivery_date_confirmed', body.actor || 'vendor',
    `입고일 확정: ${body.confirmed_date}`);
  ctx.createNotification(null, 'po', `입고일 확정: ${po.po_number}`, `${po.vendor_name} → ${body.confirmed_date} 입고 확정`, 'procurement');
  ctx.ok(res, { confirmed: true, vendor_confirmed_date: body.confirmed_date });
});

// POST /api/procurement/create-korea-po — 한국 후공정 PO 생성 (제지사+후공정 2단계)
router.post('/api/procurement/create-korea-po', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.material_vendor || !body.process_vendor || !body.items?.length) {
    ctx.fail(res, 400, 'material_vendor, process_vendor, items required'); return;
  }
  const poNum = 'PO-KR-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String(Math.random()).slice(2,5);
  const totalQty = body.items.reduce((s, i) => s + (i.ordered_qty || 0), 0);
  const info = await db.prepare(`INSERT INTO po_header (po_number, po_type, vendor_name, material_vendor_name, process_vendor_name, status, due_date, total_qty, notes, origin, po_date, tolerance_pct) VALUES (?,?,?,?,?,?,?,?,?,?,date('now','localtime'),?)`)
    .run(poNum, '후공정', body.material_vendor, body.material_vendor, body.process_vendor, 'sent', body.expected_date || '', totalQty, body.notes || '', '한국', body.tolerance_pct || 5.0);
  const poId = info.lastInsertRowid;
  const stmt = db.prepare("INSERT INTO po_items (po_id, product_code, brand, process_type, ordered_qty, spec) VALUES (?,?,?,?,?,?)");
  for (const it of body.items) await stmt.run(poId, it.product_code, it.brand || '', it.process_type || '', it.ordered_qty || 0, it.spec || '');
  // 거래명세서 자동 생성
  await db.prepare("INSERT INTO trade_document (po_id, po_number, vendor_name, vendor_type, items_json, status) VALUES (?,?,?,?,?,'sent')")
    .run(poId, poNum, body.material_vendor, 'material', JSON.stringify(body.items));
  await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)").run(
    poId, 'created', body.actor || 'system', `한국 후공정 PO 생성 (원재료:${body.material_vendor}, 후공정:${body.process_vendor})`);
  if (req._currentUser) ctx.auditLog(req._currentUser.userId, req._currentUser.username, 'po_create', 'po_header', poId, `발주생성: ${poNum}, 원재료:${body.material_vendor}, 후공정:${body.process_vendor}`, req._clientIP);
  ctx.ok(res, { po_id: poId, po_number: poNum });
});

// ════════════════════════════════════════════════════════════════════
//  한국 발주 마법사 관련 API (3단계: 품목 → 원재료업체 → 후가공업체)
// ════════════════════════════════════════════════════════════════════

// GET /api/po/latest-by-product?codes=A,B,C — 품목별 최근 PO 설정 (마법사 기본값)
router.get('/api/po/latest-by-product', async (req, res, parsed) => {
  const db = ctx.db;
  try {
    const codesParam = parsed.searchParams.get('product_codes') || parsed.searchParams.get('codes') || '';
    const codes = codesParam.split(',').map(s => s.trim()).filter(Boolean);
    if (!codes.length) { ctx.ok(res, {}); return; }
    const placeholders = codes.map(() => '?').join(',');
    const rows = await db.prepare(`
      SELECT poi.product_code, poh.po_id, poh.po_date,
             poh.material_vendor_name, poh.process_vendor_name,
             poh.process_chain, poh.po_type
      FROM po_items poi
      JOIN po_header poh ON poh.po_id = poi.po_id
      WHERE poi.product_code IN (${placeholders})
        AND poh.origin = '한국'
        AND poh.status NOT IN ('cancelled','draft')
      ORDER BY poi.product_code, poh.po_date DESC, poh.po_id DESC
    `).all(...codes);
    // 품목당 첫 행만 채택
    const result = {};
    for (const r of rows) {
      if (result[r.product_code]) continue;
      let chain = [];
      try { if (r.process_chain) chain = JSON.parse(r.process_chain); } catch(_) {}
      result[r.product_code] = {
        material_vendor: r.material_vendor_name || '',
        process_vendor: r.process_vendor_name || '',
        process_chain: Array.isArray(chain) ? chain : [],
        po_date: r.po_date || ''
      };
    }
    ctx.ok(res, result);
  } catch (e) {
    console.error('[latest-by-product] 실패:', e.message);
    ctx.fail(res, 500, '최근 PO 조회 실패: ' + e.message);
  }
});

// POST /api/po/korea-wizard — 마법사 확정 (원재료 PO N장 + 후가공 PO M장 생성)
router.post('/api/po/korea-wizard', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) { ctx.fail(res, 400, 'items required'); return; }
  // 각 품목은 {product_code, ordered_qty, material_vendor, material_code, material_name, process_chain:[{step,process,vendor}], spec}
  // 검증
  for (const it of items) {
    if (!it.product_code) { ctx.fail(res, 400, `product_code 누락: ${JSON.stringify(it)}`); return; }
    if (!it.material_vendor) { ctx.fail(res, 400, `${it.product_code}: material_vendor 미지정`); return; }
    if (!Array.isArray(it.process_chain) || !it.process_chain.length) {
      ctx.fail(res, 400, `${it.product_code}: process_chain 미지정 (최소 1개 공정 필요)`); return;
    }
    for (const s of it.process_chain) {
      if (!s.vendor || !s.process) {
        ctx.fail(res, 400, `${it.product_code}: process_chain에 process와 vendor 모두 필요`); return;
      }
    }
  }

  const expectedDate = body.expected_date || '';
  const notes = body.notes || '';
  const tolerancePct = body.tolerance_pct != null ? Number(body.tolerance_pct) : 5.0;
  const actorName = body.actor || (req._currentUser ? req._currentUser.username : 'system');

  // product_code 정제
  for (const it of items) {
    it.product_code = (it.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
  }

  // ─ 1) 원재료 업체별 그룹 ─
  const materialGroups = {};
  for (const it of items) {
    const key = it.material_vendor;
    if (!materialGroups[key]) materialGroups[key] = [];
    materialGroups[key].push(it);
  }

  // ─ 2) 후가공: 1단계 업체별로 그룹 ─
  const materialPos = [];
  const processPos = [];

  try {
    for (const [matVendor, matItems] of Object.entries(materialGroups)) {
      const matPoNumber = await ctx.generatePoNumber();
      const matTotalQty = matItems.reduce((s, i) => s + (Number(i.ordered_qty) || 0), 0);
      const matNotes = notes || `원재료 발주 (${matVendor})`;
      const repChain = matItems[0].process_chain || [];
      const matInfo = await db.prepare(`INSERT INTO po_header
        (po_number, po_type, vendor_name, material_vendor_name, process_vendor_name, status,
         due_date, total_qty, notes, origin, po_date, tolerance_pct, process_chain, process_step)
        VALUES (?,?,?,?,?,?,?,?,?,?,date('now','localtime'),?,?,?)`)
        .run(matPoNumber, '원재료', matVendor, matVendor, '', 'sent',
             expectedDate, matTotalQty, matNotes, '한국', tolerancePct,
             JSON.stringify(repChain), 0);
      const matPoId = matInfo.lastInsertRowid;

      const insItem = db.prepare(`INSERT INTO po_items
        (po_id, product_code, brand, process_type, ordered_qty, spec, notes)
        VALUES (?,?,?,?,?,?,?)`);
      for (const it of matItems) {
        await insItem.run(matPoId, it.product_code, it.brand || '', '원재료',
          Number(it.ordered_qty) || 0, it.spec || '',
          `용지:${it.material_name || ''} / 공정체인:${JSON.stringify(it.process_chain)}`);
      }

      await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)")
        .run(matPoId, 'created', actorName, `마법사 생성: 원재료 PO (${matVendor}, ${matItems.length}품목)`);

      materialPos.push({ po_id: matPoId, po_number: matPoNumber, vendor: matVendor, items: matItems.length, total_qty: matTotalQty });

      // ─ 동일 원재료 그룹의 1단계 후가공을 (업체, 공정) 조합별로 수집 → 각 조합마다 별도 PO ─
      const postStep1ByVendorProcess = {};
      for (const it of matItems) {
        const step1 = it.process_chain[0];
        if (!step1 || !step1.vendor || !step1.process) continue;
        const key = step1.vendor + '||' + step1.process;
        if (!postStep1ByVendorProcess[key]) postStep1ByVendorProcess[key] = { vendor: step1.vendor, process: step1.process, items: [] };
        postStep1ByVendorProcess[key].items.push(it);
      }
      for (const info of Object.values(postStep1ByVendorProcess)) {
        const postVendor = info.vendor;
        const postPoNumber = await ctx.generatePoNumber();
        const postTotalQty = info.items.reduce((s, i) => s + (Number(i.ordered_qty) || 0), 0);
        const postInfo = await db.prepare(`INSERT INTO po_header
          (po_number, po_type, vendor_name, material_vendor_name, process_vendor_name, status,
           due_date, total_qty, notes, origin, po_date, tolerance_pct, process_chain, process_step, parent_po_id)
          VALUES (?,?,?,?,?,?,?,?,?,?,date('now','localtime'),?,?,?,?)`)
          .run(postPoNumber, '후공정', postVendor, matVendor, postVendor, 'draft',
               expectedDate, postTotalQty, `후가공(${info.process}) 대기 - 원재료 입고 후 발송`, '한국', tolerancePct,
               JSON.stringify(info.items[0].process_chain || []), 1, matPoId);
        const postPoId = postInfo.lastInsertRowid;
        for (const it of info.items) {
          await insItem.run(postPoId, it.product_code, it.brand || '', info.process,
            Number(it.ordered_qty) || 0, it.spec || '',
            `원재료:${it.material_name || ''} / 전체체인:${JSON.stringify(it.process_chain)}`);
        }
        await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)")
          .run(postPoId, 'created', actorName, `마법사 생성: 후가공 PO (${postVendor}, ${info.process}, 원재료 PO: ${matPoNumber})`);
        processPos.push({ po_id: postPoId, po_number: postPoNumber, vendor: postVendor, process: info.process, items: info.items.length, total_qty: postTotalQty, parent_po_id: matPoId });
      }
    }

    // ─ 이메일 발송 (비동기, 실패해도 응답은 성공) ─
    (async () => {
      for (const m of materialPos) {
        try {
          const vendorRow = await db.prepare("SELECT email, email_cc FROM vendors WHERE name=?").get(m.vendor);
          if (vendorRow?.email) {
            const matPo = await db.prepare("SELECT * FROM po_header WHERE po_id=?").get(m.po_id);
            const matItems = await db.prepare("SELECT * FROM po_items WHERE po_id=?").all(m.po_id);
            await ctx.sendPOEmail(matPo, matItems, vendorRow.email, m.vendor, false, vendorRow.email_cc);
          }
        } catch (e) { console.warn(`[korea-wizard] 원재료 이메일 실패 (${m.vendor}):`, e.message); }
      }
    })().catch(e => console.error('[korea-wizard] 비동기 이메일 오류:', e.message));

    if (req._currentUser) ctx.auditLog(req._currentUser.userId, req._currentUser.username, 'po_create_wizard', 'po_header', null,
      `한국 마법사 발주: 원재료 ${materialPos.length}장 + 후가공 ${processPos.length}장`, req._clientIP);

    ctx.ok(res, { material_pos: materialPos, process_pos: processPos });
  } catch (e) {
    console.error('[korea-wizard] 실패:', e.message, e.stack);
    ctx.fail(res, 500, '마법사 발주 생성 실패: ' + e.message);
  }
});

// POST /api/procurement/assembly/:id/ship — 더기프트 출고 등록
router.postP(/^\/api\/procurement\/assembly\/(\d+)\/ship$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  const id = m[1];
  await db.prepare(`UPDATE gift_assembly SET delivery_status=?, tracking_number=?, carrier=?, shipped_date=?, delivery_address=?, recipient_name=?, updated_at=datetime('now','localtime') WHERE id=?`)
    .run(body.delivery_status || 'shipped', body.tracking_number || '', body.carrier || '', body.shipped_date || new Date().toISOString().slice(0,10), body.delivery_address || '', body.recipient_name || '', id);
  const asm = await db.prepare("SELECT * FROM gift_assembly WHERE id=?").get(id);
  if (asm) ctx.createNotification(null, 'po', `출고: ${asm.assembly_no}`, `${asm.product_name} 출고 (${body.carrier||''} ${body.tracking_number||''})`, 'procurement');
  ctx.ok(res, { shipped: true });
});

// POST /api/procurement/assembly/:id/deliver — 더기프트 배송완료
router.postP(/^\/api\/procurement\/assembly\/(\d+)\/deliver$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = m[1];
  await db.prepare("UPDATE gift_assembly SET delivery_status='delivered', delivered_date=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?").run(id);
  ctx.ok(res, { delivered: true });
});

// GET /api/procurement/korea-detail/:poId — 한국 PO 상세 (2단계 flow 포함)
router.getP(/^\/api\/procurement\/korea-detail\/(\d+)$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const poId = m[1];
  const po = await db.prepare('SELECT * FROM po_header WHERE po_id=?').get(poId);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  const items = await db.prepare('SELECT * FROM po_items WHERE po_id=?').all(poId);
  const totalOrdered = items.reduce((s, i) => s + i.ordered_qty, 0);
  const totalReceived = items.reduce((s, i) => s + i.received_qty, 0);
  const tolerancePct = po.tolerance_pct || 5;
  const lowerBound = Math.round(totalOrdered * (1 - tolerancePct / 100));
  const upperBound = Math.round(totalOrdered * (1 + tolerancePct / 100));
  const needsForceApprove = totalReceived > 0 && totalReceived < lowerBound && po.status !== 'received';
  const tradeDocs = await db.prepare('SELECT * FROM trade_document WHERE po_id=? ORDER BY created_at DESC').all(poId);
  const logs = await db.prepare('SELECT * FROM po_activity_log WHERE po_id=? ORDER BY id DESC LIMIT 20').all(poId);
  ctx.ok(res, { po, items, totalOrdered, totalReceived, tolerancePct, lowerBound, upperBound, needsForceApprove, tradeDocs, logs });
});

// GET /api/procurement/china-shipments — 중국 합선적 현황 (여러 PO 합선적)
router.get('/api/procurement/china-shipments', async (req, res, parsed) => {
  const db = ctx.db;
  const shipments = await db.prepare(`SELECT * FROM china_shipment_log ORDER BY created_at DESC LIMIT 50`).all();
  for (const s of shipments) {
    s.po_items = await db.prepare(`SELECT sp.*, h.po_number, h.vendor_name, h.order_type FROM shipment_po_items sp JOIN po_header h ON h.po_id=sp.po_id WHERE sp.shipment_id=?`).all(s.id);
  }
  ctx.ok(res, shipments);
});

// POST /api/procurement/china-shipment-link — 중국 합선적에 여러 PO 연결
router.post('/api/procurement/china-shipment-link', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.shipment_id || !body.po_items?.length) { ctx.fail(res, 400, 'shipment_id + po_items required'); return; }
  const stmt = db.prepare("INSERT OR REPLACE INTO shipment_po_items (shipment_id, po_id, po_item_id, product_code, product_name, shipped_qty, notes) VALUES (?,?,?,?,?,?,?)");
  const tx = db.transaction(async () => {
    for (const it of body.po_items) {
      await stmt.run(body.shipment_id, it.po_id, it.po_item_id || null, it.product_code || '', it.product_name || '', it.shipped_qty || 0, it.notes || '');
    }
  });
  await tx();
  // 연결된 PO들 선적 상태 업데이트
  const poIds = [...new Set(body.po_items.map(i => i.po_id))];
  for (const pid of poIds) {
    await db.prepare("UPDATE po_header SET status='shipped', process_status='shipped', updated_at=datetime('now','localtime') WHERE po_id=? AND status NOT IN ('received','cancelled')").run(pid);
  }
  ctx.ok(res, { linked: body.po_items.length, shipment_id: body.shipment_id });
});

// GET /api/procurement/pipeline — origin별 워크플로우 단계 현황
router.get('/api/procurement/pipeline', async (req, res, parsed) => {
  const db = ctx.db;
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const origin = qs.get('origin') || '';
  const pipeEntity = qs.get('entity') || 'all';
  const _pipeUseEnt = ctx._hasEntity.po_header && pipeEntity && pipeEntity !== 'all';
  const pipeEntityClause = _pipeUseEnt ? ' AND legal_entity=?' : '';
  const pipeEntityParams = _pipeUseEnt ? [pipeEntity] : [];
  const stages = {
    '한국': ['draft','sent','자재지급','가공중','partial','received'],
    '중국': ['draft','sent','제작중','선적','통관','partial','received'],
    '더기프트': ['draft','sent','partial','received','포장','출고']
  };
  if (origin && stages[origin]) {
    const pos = await db.prepare(`
      SELECT po_id, po_number, vendor_name, status, material_status, process_status,
             due_date as expected_date, po_date, total_qty, notes, process_step,
             material_vendor_name, process_vendor_name, material_send_date,
             material_confirmed_at, process_email_sent, force_completed,
             tolerance_pct, order_type, vendor_confirmed_date
      FROM po_header WHERE origin=? AND status != 'cancelled'${pipeEntityClause}
      ORDER BY created_at DESC LIMIT 100
    `).all(origin, ...pipeEntityParams);
    // Map PO to pipeline stage
    for (const po of pos) {
      if (origin === '한국') {
        if (po.status === 'received') po.stage = 'received';
        else if (po.status === 'partial') po.stage = 'partial';
        else if (po.process_status === 'processing' || po.process_status === 'in_progress') po.stage = '가공중';
        else if (po.material_status === 'sent') po.stage = '자재지급';
        else if (po.status === 'sent') po.stage = 'sent';
        else po.stage = 'draft';
      } else if (origin === '중국') {
        if (po.status === 'received') po.stage = 'received';
        else if (po.status === 'partial') po.stage = 'partial';
        else if (po.process_status === 'customs') po.stage = '통관';
        else if (po.status === 'shipped' || po.shipped_at) po.stage = '선적';
        else if (po.process_status === 'processing' || po.process_status === 'in_progress') po.stage = '제작중';
        else if (po.status === 'sent') po.stage = 'sent';
        else po.stage = 'draft';
      } else {
        if (po.process_status === 'shipped') po.stage = '출고';
        else if (po.process_status === 'assembly') po.stage = '포장';
        else if (po.status === 'received') po.stage = 'received';
        else if (po.status === 'partial') po.stage = 'partial';
        else if (po.status === 'sent') po.stage = 'sent';
        else po.stage = 'draft';
      }
      // 입고율 + 강제완료 필요 여부
      const items = await db.prepare("SELECT COALESCE(SUM(ordered_qty),0) AS ord, COALESCE(SUM(received_qty),0) AS rcv FROM po_items WHERE po_id=?").get(po.po_id);
      po.progress = items.ord > 0 ? Math.round(items.rcv / items.ord * 100) : 0;
      po.total_ordered = items.ord;
      po.total_received = items.rcv;
      const tol = po.tolerance_pct || 5;
      const lb = items.ord * (1 - tol / 100);
      po.needs_force_approve = items.rcv > 0 && items.rcv < lb && po.status !== 'received';
    }
    ctx.ok(res, { origin, stages: stages[origin], orders: pos }); return;
  }
  ctx.ok(res, { stages });
});

// POST /api/procurement/update-stage — PO 워크플로우 단계 전환
router.post('/api/procurement/update-stage', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  if (!body.po_id || !body.stage) { ctx.fail(res, 400, 'po_id + stage required'); return; }
  const po = await db.prepare("SELECT * FROM po_header WHERE po_id=?").get(body.po_id);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  const updates = [];
  const params = [];
  const stageMap = {
    'draft': { status: 'draft' },
    'sent': { status: 'sent' },
    '자재지급': { material_status: 'sent', status: 'sent' },
    '가공중': { process_status: 'processing', status: 'sent' },
    '제작중': { process_status: 'processing', status: 'sent' },
    '선적': { status: 'shipped' },
    '통관': { process_status: 'customs' },
    'partial': { status: 'partial' },
    'received': { status: 'received' },
    '포장': { process_status: 'assembly' },
    '출고': { process_status: 'shipped' }
  };
  const mapping = stageMap[body.stage];
  if (mapping) {
    for (const [k, v] of Object.entries(mapping)) {
      updates.push(`${k}=?`); params.push(v);
    }
  }
  updates.push("updated_at=datetime('now','localtime')");
  params.push(body.po_id);
  await db.prepare(`UPDATE po_header SET ${updates.join(',')} WHERE po_id=?`).run(...params);
  // Activity log
  await db.prepare("INSERT INTO po_activity_log (po_id, po_number, action, actor, from_status, to_status, details) VALUES (?,?,?,?,?,?,?)").run(
    body.po_id, po.po_number, 'stage_change', body.actor || 'system', po.status, body.stage, body.notes || '');
  if (req._currentUser) ctx.auditLog(req._currentUser.userId, req._currentUser.username, 'po_stage_change', 'po_header', body.po_id, `발주단계변경: ${po.po_number} ${po.status}→${body.stage}`, req._clientIP);
  ctx.ok(res, { updated: true, stage: body.stage });
});

// ════════════════════════════════════════════════════════════════════
//  PO 엑셀/OS 매칭/통계
// ════════════════════════════════════════════════════════════════════

// GET /api/po/raw-material-export — 원재료 PO 마감용 엑셀 다운로드
router.get('/api/po/raw-material-export', async (req, res, parsed) => {
  const db = ctx.db;
  const today = new Date();
  const ym = today.toISOString().slice(0, 7);
  const defaultFrom = `${ym}-01`;
  const nextMonth = new Date(today.getFullYear(), today.getMonth() + 1, 1);
  const defaultTo = nextMonth.toISOString().slice(0, 10);
  const from = parsed.searchParams.get('from') || defaultFrom;
  const to   = parsed.searchParams.get('to')   || defaultTo;
  const vendor = (parsed.searchParams.get('vendor') || '').trim();
  try {
    const vendorFilter = vendor ? "AND h.vendor_name LIKE ?" : "";
    const params = vendor ? [from, to, '%' + vendor + '%'] : [from, to];
    const rows = await db.prepare(`
      SELECT
        h.po_number, h.po_date, h.vendor_name, h.notes, h.status AS po_status,
        i.item_id, i.product_code, i.spec, i.os_number,
        i.ordered_qty, i.received_qty,
        p.material_code, p.material_name, p.cut_spec, p.jopan
      FROM po_header h
      JOIN po_items i ON h.po_id = i.po_id
      LEFT JOIN products p ON i.product_code = p.product_code
      WHERE h.po_type = '원재료'
        AND h.status NOT IN ('cancelled','draft')
        AND h.po_date >= ? AND h.po_date < ?
        ${vendorFilter}
      ORDER BY h.po_date DESC, h.vendor_name, h.po_number, i.item_id
    `).all(...params);

    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const aoa = [
      [`원재료 PO 마감 ${from} ~ ${to}  (${rows.length} 항목)`],
      [],
      ['PO번호','발주일','거래처','제품코드','원재료코드','원재료명','용지규격','수량(R)','낱개수량','절','OS번호','OS등록여부','입고상태','PO비고']
    ];
    let osMissing = 0;
    for (const r of rows) {
      const cut = parseFloat(r.cut_spec) || 1;
      const jop = parseFloat(r.jopan) || 1;
      const reams = (r.ordered_qty || 0) / 500 / cut / jop;
      const reamsStr = isFinite(reams) ? (reams % 1 === 0 ? String(reams) : reams.toFixed(1)) : '';
      const hasOs = r.os_number && String(r.os_number).trim() ? true : false;
      if (!hasOs) osMissing++;
      const osStatus = hasOs ? '✅ 등록' : '❌ 미등록';
      const recvStatus = (r.received_qty || 0) >= (r.ordered_qty || 0) ? '입고완료'
        : (r.received_qty || 0) > 0 ? `부분입고 (${r.received_qty}/${r.ordered_qty})` : '미입고';
      aoa.push([
        r.po_number || '', r.po_date || '', r.vendor_name || '',
        r.product_code || '', r.material_code || '', r.material_name || '',
        r.spec || '', reamsStr, r.ordered_qty || 0, r.cut_spec || '',
        r.os_number || '', osStatus, recvStatus, r.notes || ''
      ]);
    }
    // 합계 행
    aoa.push([]);
    aoa.push(['합계', '', '', '', '', '', '', '', '', '', '', `미등록 ${osMissing}/${rows.length}`, '', '']);

    const ws = XLSX.utils.aoa_to_sheet(aoa);
    ws['!cols'] = [
      {wch:16},{wch:12},{wch:16},{wch:14},{wch:12},{wch:20},
      {wch:14},{wch:8},{wch:12},{wch:6},{wch:14},{wch:14},{wch:18},{wch:24}
    ];
    XLSX.utils.book_append_sheet(wb, ws, '원재료 PO');
    const buf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

    const fileName = encodeURIComponent(`원재료PO마감_${from}_${to}.xlsx`);
    res.writeHead(200, {
      'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'Content-Disposition': `attachment; filename*=UTF-8''${fileName}`,
      'Content-Length': buf.length,
    });
    res.end(buf);
    console.log(`[raw-material-export] ${from}~${to}: 총 ${rows.length} 항목 (OS 미등록 ${osMissing}, ${buf.length} bytes)`);
  } catch (e) {
    console.error('[raw-material-export] 실패:', e.message);
    ctx.fail(res, 500, '엑셀 export 실패: ' + e.message);
  }
});

// GET /api/po/os-pending — OS등록 대기 PO 목록
router.get('/api/po/os-pending', async (req, res, parsed) => {
  const db = ctx.db;
  const rows = await db.prepare(`SELECT * FROM po_header WHERE status IN ('os_pending','os_registered') ORDER BY po_date DESC`).all();
  for (const r of rows) {
    r.status = ctx.PO_STATUS_EN_TO_KO[r.status] || r.status;
    r.items = await db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(r.po_id);
  }
  ctx.ok(res, rows);
});

// GET /api/po/os-match — XERP OS번호 자동 매칭
router.get('/api/po/os-match', async (req, res, parsed) => {
  const db = ctx.db;
  if (!await ctx.ensureXerpPool()) { ctx.fail(res, 503, 'XERP 데이터베이스 미연결 (재연결 시도 중)'); return; }
  const xerpPool = ctx.getXerpPool();
  const sql = ctx.sql;
  try {
    // 1. 모든 PO 가져오기
    const allPOs = await db.prepare(`SELECT * FROM po_header ORDER BY po_date DESC`).all();
    const itemStmt = db.prepare('SELECT * FROM po_items WHERE po_id = ?');
    for (const po of allPOs) po.items = await itemStmt.all(po.po_id);

    // 2. 분류: 진행중 / 완료 / 취소
    const pending = allPOs.filter(p => p.status !== 'received' && p.status !== 'cancelled' && !p.os_number);
    const completed = allPOs.filter(p => p.status === 'received' || p.os_number).slice(0, 50);
    const cancelled = allPOs.filter(p => p.status === 'cancelled').slice(0, 30);
    const productCodes = [...new Set(pending.flatMap(po => po.items.map(i => (i.product_code || '').trim())).filter(Boolean))];

    // 3. XERP에서 제품코드로 OS 매칭 (최근 2개월)
    let xerpMatches = {};
    if (productCodes.length && xerpPool) {
      const start2m = new Date(); start2m.setMonth(start2m.getMonth() - 2);
      const fmt = d => d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');

      for (let i = 0; i < productCodes.length; i += 200) {
        const batch = productCodes.slice(i, i + 200);
        const placeholders = batch.map((_, j) => `@p${i+j}`).join(',');
        const xreq = xerpPool.request();
        xreq.input('startDate', sql.NChar(16), fmt(start2m));
        batch.forEach((c, j) => xreq.input(`p${i+j}`, sql.NChar(40), c));

        const result = await xreq.query(`
          SELECT RTRIM(i.ItemCode) AS item_code, RTRIM(h.OrderNo) AS os_number,
                 h.OrderDate AS order_date, i.OrderQty AS qty, RTRIM(h.CsCode) AS vendor_code
          FROM poOrderHeader h WITH (NOLOCK)
          JOIN poOrderItem i WITH (NOLOCK) ON h.SiteCode=i.SiteCode AND h.OrderNo=i.OrderNo
          WHERE h.SiteCode = '${ctx.XERP_SITE_CODE}' AND h.OrderDate >= @startDate
            AND RTRIM(i.ItemCode) IN (${placeholders})
          ORDER BY h.OrderDate DESC
        `);

        for (const row of result.recordset) {
          const code = (row.item_code || '').trim();
          if (!xerpMatches[code]) xerpMatches[code] = [];
          xerpMatches[code].push({
            os_number: (row.os_number || '').trim(),
            order_date: (row.order_date || '').trim(),
            qty: row.qty || 0,
            vendor_code: (row.vendor_code || '').trim()
          });
        }
      }
    }

    // 4. 매칭 결과 분류
    const matched = [];
    const unmatched = [];
    for (const po of pending) {
      po.status = ctx.PO_STATUS_EN_TO_KO[po.status] || po.status;
      let poMatched = false;
      const matchedItems = [];

      for (const item of po.items) {
        const code = (item.product_code || '').trim();
        const matches = xerpMatches[code];
        if (matches && matches.length) {
          matchedItems.push({ ...item, xerp_os: matches[0] });
          poMatched = true;
        } else {
          matchedItems.push(item);
        }
      }

      po.items = matchedItems;
      if (poMatched) {
        po._matched_os = matchedItems.find(i => i.xerp_os)?.xerp_os?.os_number || '';
        matched.push(po);
      } else {
        unmatched.push(po);
      }
    }

    // 5. os_registered PO 검증
    const registeredPOs = await db.prepare(
      "SELECT h.*, GROUP_CONCAT(i.product_code) as product_codes FROM po_header h LEFT JOIN po_items i ON h.po_id=i.po_id WHERE h.status='os_registered' GROUP BY h.po_id"
    ).all();

    const verified = [];
    const mismatched = [];

    if (registeredPOs.length) {
      const xerpByOrderNo = {};
      const osNumbers = registeredPOs.filter(r => r.os_number).map(r => r.os_number.trim());
      if (osNumbers.length && xerpPool) {
        const start2m = new Date(); start2m.setMonth(start2m.getMonth() - 2);
        const fmt2 = d => d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
        for (let i = 0; i < osNumbers.length; i += 100) {
          const batch = osNumbers.slice(i, i + 100);
          const placeholders = batch.map((_, j) => `@o${i+j}`).join(',');
          const xreq = xerpPool.request();
          xreq.input('startDate', sql.NChar(16), fmt2(start2m));
          batch.forEach((o, j) => xreq.input(`o${i+j}`, sql.NChar(40), o));
          try {
            const xresult = await xreq.query(`
              SELECT RTRIM(h.OrderNo) AS OrderNo, RTRIM(i.ItemCode) AS ItemCode
              FROM poOrderHeader h WITH (NOLOCK)
              JOIN poOrderItem i WITH (NOLOCK) ON h.SiteCode=i.SiteCode AND h.OrderNo=i.OrderNo
              WHERE h.SiteCode = '${ctx.XERP_SITE_CODE}' AND h.OrderDate >= @startDate
                AND RTRIM(h.OrderNo) IN (${placeholders})
            `);
            for (const row of xresult.recordset) {
              const on = (row.OrderNo || '').trim();
              if (!xerpByOrderNo[on]) xerpByOrderNo[on] = { items: [] };
              xerpByOrderNo[on].items.push({ ItemCode: (row.ItemCode || '').trim() });
            }
          } catch (xe) { console.error('os_registered XERP 조회 오류:', xe.message); }
        }
      }

      const productInfoMap = ctx.getProductInfo();

      for (const rpo of registeredPOs) {
        if (!rpo.os_number) {
          await db.prepare("UPDATE po_header SET status='os_pending', updated_at=datetime('now','localtime') WHERE po_id=?").run(rpo.po_id);
          mismatched.push({ ...rpo, error: 'OS번호가 누락되었습니다' });
          continue;
        }

        const xerpMatch = xerpByOrderNo[rpo.os_number.trim()];
        if (!xerpMatch) {
          verified.push({ ...rpo, status: 'OS검증대기', xerp_status: 'XERP 미확인 (대기중)' });
          continue;
        }

        const poProductCodes = (rpo.product_codes || '').split(',').map(c => c.trim()).filter(Boolean);
        const xerpItemCodes = xerpMatch.items.map(i => i.ItemCode);

        const materialCodes = poProductCodes.map(pc => {
          const pInfo = productInfoMap[pc];
          return pInfo ? (pInfo.material_code || pInfo['원자재코드'] || pc) : pc;
        }).filter(Boolean);

        const hasMatch = materialCodes.some(mc => xerpItemCodes.includes(mc));

        if (hasMatch) {
          await db.prepare("UPDATE po_header SET status='received', process_status='completed', material_status='received', updated_at=datetime('now','localtime') WHERE po_id=?").run(rpo.po_id);
          verified.push({ ...rpo, status: 'OS검증대기', xerp_status: '검증완료', auto_completed: true });
        } else {
          await db.prepare("UPDATE po_header SET status='os_pending', os_number='', updated_at=datetime('now','localtime') WHERE po_id=?").run(rpo.po_id);
          mismatched.push({
            ...rpo,
            error: `OS번호와 제품코드가 다릅니다 (OS: ${rpo.os_number}, XERP품목: ${xerpItemCodes.join(',')}, PO원자재: ${materialCodes.join(',')})`
          });
        }
      }
    }

    // 완료/취소 PO도 한글 변환
    for (const po of completed) po.status = ctx.PO_STATUS_EN_TO_KO[po.status] || po.status;
    for (const po of cancelled) po.status = ctx.PO_STATUS_EN_TO_KO[po.status] || po.status;

    ctx.ok(res, { matched, unmatched, completed, cancelled, verified, mismatched, xerp_match_count: Object.keys(xerpMatches).length });
  } catch (e) {
    console.error('OS 매칭 오류:', e.message);
    ctx.fail(res, 500, 'OS 매칭 오류: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  거래처 통계 (vendor-summary, vendor-performance)
// ════════════════════════════════════════════════════════════════════

// GET /api/stats/vendor-summary — 거래처별 발주 통계
router.get('/api/stats/vendor-summary', async (req, res, parsed) => {
  const db = ctx.db;
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const from = qs.get('from') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = qs.get('to') || new Date().toISOString().slice(0, 10);
  const rows = await db.prepare(`
    SELECT vendor_name,
      COUNT(*) as order_count,
      COALESCE(SUM(total_qty), 0) as total_qty,
      COALESCE(SUM(CASE WHEN status IN ('received','os_pending') THEN 1 ELSE 0 END), 0) as completed_count
    FROM po_header
    WHERE po_date >= ? AND po_date <= ? AND status != 'cancelled'
    GROUP BY vendor_name
    ORDER BY order_count DESC
  `).all(from, to);

  const result = await Promise.all(rows.map(async r => {
    const ltRows = await db.prepare(`
      SELECT po_date, updated_at, due_date as expected_date FROM po_header
      WHERE vendor_name = ? AND po_date >= ? AND po_date <= ?
        AND status IN ('received','os_pending') AND po_date IS NOT NULL AND updated_at IS NOT NULL
    `).all(r.vendor_name, from, to);
    let totalLT = 0, ltCount = 0, onTimeCount = 0;
    ltRows.forEach(p => {
      const d1 = new Date(p.po_date), d2 = new Date(p.updated_at);
      if (d1 && d2 && d2 > d1) {
        const days = Math.round((d2 - d1) / 86400000);
        if (days > 0 && days < 90) { totalLT += days; ltCount++; }
      }
      if (p.expected_date && p.updated_at <= p.expected_date + ' 23:59:59') onTimeCount++;
    });
    return {
      vendor_name: r.vendor_name,
      order_count: r.order_count,
      total_qty: r.total_qty,
      avg_lead_time: ltCount > 0 ? Math.round(totalLT / ltCount * 10) / 10 : 0,
      on_time_rate: ltRows.length > 0 ? Math.round(onTimeCount / ltRows.length * 100) : 0
    };
  }));
  ctx.ok(res, result);
});

// GET /api/vendor-performance — 업체 종합 성과 (납기준수율 + 불량률 + 종합점수)
router.get('/api/vendor-performance', async (req, res, parsed) => {
  const db = ctx.db;
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10);
  const from = qs.get('from') || defaultFrom;
  const to = qs.get('to') || today.toISOString().slice(0, 10);
  const minOrders = parseInt(qs.get('min_orders') || '1', 10);

  // 1) 발주 통계 (업체별)
  const poStats = await db.prepare(`
    SELECT vendor_name,
      COUNT(*) as order_count,
      COALESCE(SUM(total_qty), 0) as total_qty,
      COALESCE(SUM(CASE WHEN status IN ('received','os_pending') THEN 1 ELSE 0 END), 0) as completed_count,
      COALESCE(SUM(CASE WHEN status='cancelled' THEN 1 ELSE 0 END), 0) as cancel_count
    FROM po_header
    WHERE po_date >= ? AND po_date <= ? AND vendor_name IS NOT NULL AND vendor_name != ''
    GROUP BY vendor_name
  `).all(from, to);

  // 2) 납기 준수율 + 평균 리드타임 (업체별)
  const ltMap = {};
  for (const r of poStats) {
    const ltRows = await db.prepare(`
      SELECT po_date, updated_at, due_date as expected_date FROM po_header
      WHERE vendor_name = ? AND po_date >= ? AND po_date <= ?
        AND status IN ('received','os_pending') AND po_date IS NOT NULL AND updated_at IS NOT NULL
    `).all(r.vendor_name, from, to);
    let totalLT = 0, ltCount = 0, onTimeCount = 0, withExpected = 0;
    ltRows.forEach(p => {
      const d1 = new Date(p.po_date), d2 = new Date(p.updated_at);
      if (d1 && d2 && d2 > d1) {
        const days = Math.round((d2 - d1) / 86400000);
        if (days > 0 && days < 90) { totalLT += days; ltCount++; }
      }
      if (p.expected_date) {
        withExpected++;
        if (p.updated_at <= p.expected_date + ' 23:59:59') onTimeCount++;
      }
    });
    ltMap[r.vendor_name] = {
      avg_lead_time: ltCount > 0 ? Math.round(totalLT / ltCount * 10) / 10 : 0,
      on_time_rate: withExpected > 0 ? Math.round(onTimeCount / withExpected * 100) : null
    };
  }

  // 3) 불량 통계 (업체별)
  const defectStats = await db.prepare(`
    SELECT vendor_name,
      COUNT(*) as defect_count,
      COALESCE(SUM(defect_qty), 0) as total_defect_qty,
      COALESCE(SUM(claim_amount), 0) as total_claim_amount,
      COALESCE(SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END), 0) as resolved_count
    FROM defects
    WHERE defect_date >= ? AND defect_date <= ?
    GROUP BY vendor_name
  `).all(from, to);
  const defectMap = {};
  defectStats.forEach(d => { defectMap[d.vendor_name] = d; });

  // 4) 결합 + 종합 점수
  const result = poStats
    .map(r => ({
      vendor_name: r.vendor_name,
      order_count: Number(r.order_count) || 0,
      total_qty: Number(r.total_qty) || 0,
      completed_count: Number(r.completed_count) || 0,
      cancel_count: Number(r.cancel_count) || 0
    }))
    .filter(r => r.order_count >= minOrders)
    .map(r => {
      const lt = ltMap[r.vendor_name] || { avg_lead_time: 0, on_time_rate: null };
      const dfRaw = defectMap[r.vendor_name] || { defect_count: 0, total_defect_qty: 0, total_claim_amount: 0, resolved_count: 0 };
      const df = {
        defect_count: Number(dfRaw.defect_count) || 0,
        total_defect_qty: Number(dfRaw.total_defect_qty) || 0,
        total_claim_amount: Number(dfRaw.total_claim_amount) || 0,
        resolved_count: Number(dfRaw.resolved_count) || 0
      };
      const defectRate = r.total_qty > 0 ? Math.round(df.total_defect_qty / r.total_qty * 1000) / 10 : 0;
      const onTime = lt.on_time_rate != null ? lt.on_time_rate : 80;
      const quality = Math.max(0, Math.min(100, 100 - defectRate * 5));
      const score = Math.round(onTime * 0.5 + quality * 0.5);
      let grade = 'D';
      if (score >= 90) grade = 'A';
      else if (score >= 75) grade = 'B';
      else if (score >= 60) grade = 'C';
      return {
        vendor_name: r.vendor_name,
        order_count: r.order_count,
        total_qty: r.total_qty,
        completed_count: r.completed_count,
        cancel_count: r.cancel_count,
        completion_rate: r.order_count > 0 ? Math.round(r.completed_count / r.order_count * 100) : 0,
        avg_lead_time: lt.avg_lead_time,
        on_time_rate: lt.on_time_rate,
        defect_count: df.defect_count,
        total_defect_qty: df.total_defect_qty,
        total_claim_amount: df.total_claim_amount,
        defect_resolved: df.resolved_count,
        defect_rate: defectRate,
        score,
        grade
      };
    })
    .sort((a, b) => b.score - a.score);

  // 요약 통계
  const summary = {
    total_vendors: result.length,
    grade_a: result.filter(r => r.grade === 'A').length,
    grade_b: result.filter(r => r.grade === 'B').length,
    grade_c: result.filter(r => r.grade === 'C').length,
    grade_d: result.filter(r => r.grade === 'D').length,
    avg_score: result.length > 0 ? Math.round(result.reduce((s, r) => s + r.score, 0) / result.length) : 0,
    avg_on_time: (() => {
      const v = result.filter(r => r.on_time_rate != null);
      return v.length > 0 ? Math.round(v.reduce((s, r) => s + r.on_time_rate, 0) / v.length) : 0;
    })(),
    total_defects: result.reduce((s, r) => s + r.defect_count, 0),
    total_claim: result.reduce((s, r) => s + r.total_claim_amount, 0),
    from, to
  };

  ctx.ok(res, { summary, vendors: result });
});

// ════════════════════════════════════════════════════════════════════
//  PO CRUD (목록/상세/생성/수정/삭제)
// ════════════════════════════════════════════════════════════════════

// GET /api/po/stats — 대시보드 전용 통계
router.get('/api/po/stats', async (req, res, parsed) => {
  const db = ctx.db;
  const allPO = await db.prepare('SELECT * FROM po_header ORDER BY po_date DESC, po_id DESC').all();
  for (const r of allPO) r.status = ctx.PO_STATUS_EN_TO_KO[r.status] || r.status;

  // 파이프라인
  const pipeline = {}, pipelineQty = {};
  for (const s of ['대기','발송','확인','수령중','완료','취소']) { pipeline[s] = 0; pipelineQty[s] = 0; }
  for (const r of allPO) { pipeline[r.status] = (pipeline[r.status]||0) + 1; pipelineQty[r.status] = (pipelineQty[r.status]||0) + (r.total_qty||0); }

  // 입고율
  const itemStats = await db.prepare('SELECT COALESCE(SUM(ordered_qty),0) as ordered, COALESCE(SUM(received_qty),0) as received FROM po_items').get();
  const totalOrdered = itemStats.ordered;
  const totalReceived = itemStats.received;
  const receiveRate = totalOrdered > 0 ? Math.round(totalReceived / totalOrdered * 1000) / 10 : 0;

  // 취소율
  const totalCount = allPO.length;
  const cancelCount = pipeline['취소'] || 0;
  const cancelRate = totalCount > 0 ? Math.round(cancelCount / totalCount * 1000) / 10 : 0;

  // 거래처별 TOP5
  const vendorMap = {};
  for (const r of allPO) {
    const v = r.vendor_name || '(미지정)';
    if (!vendorMap[v]) vendorMap[v] = { vendor: v, count: 0, qty: 0 };
    vendorMap[v].count++;
    vendorMap[v].qty += (r.total_qty || 0);
  }
  const vendorTop = Object.values(vendorMap).sort((a, b) => b.count - a.count).slice(0, 5);

  // 최근 5건
  const recentPOs = allPO.slice(0, 5).map(r => ({
    po_number: r.po_number, vendor_name: r.vendor_name, status: r.status,
    total_qty: r.total_qty, po_date: r.po_date, po_type: r.po_type
  }));

  // KPI
  const thisMonth = new Date().toISOString().slice(0, 7);
  const monthPOCount = allPO.filter(r => (r.po_date || '').startsWith(thisMonth)).length;
  const pendingCount = allPO.filter(r => r.status !== '완료' && r.status !== '취소').length;

  ctx.ok(res, { pipeline, pipelineQty, totalOrdered, totalReceived, receiveRate,
    cancelRate, cancelCount, totalCount, vendorTop, recentPOs, monthPOCount, pendingCount });
});

// GET /api/po — PO 목록
router.get('/api/po', async (req, res, parsed) => {
  const db = ctx.db;
  let sqlStr = 'SELECT * FROM po_header WHERE 1=1';
  const params = [];
  const status = parsed.searchParams.get('status');
  const vendor = parsed.searchParams.get('vendor');
  const from = parsed.searchParams.get('from');
  const to = parsed.searchParams.get('to');
  const origin = parsed.searchParams.get('origin');
  const entity = parsed.searchParams.get('entity');
  if (status) { sqlStr += ' AND status = ?'; params.push(status); }
  if (vendor) { sqlStr += ' AND vendor_name LIKE ?'; params.push('%' + vendor + '%'); }
  if (from) { sqlStr += ' AND po_date >= ?'; params.push(from); }
  if (to) { sqlStr += ' AND po_date <= ?'; params.push(to); }
  if (origin) { sqlStr += ' AND origin = ?'; params.push(origin); }
  if (entity && entity !== 'all' && ctx._hasEntity.po_header) { sqlStr += ' AND legal_entity = ?'; params.push(entity); }
  sqlStr += ' ORDER BY po_date DESC, po_id DESC';
  const rows = await db.prepare(sqlStr).all(...params);
  // 상태 영→한 정규화
  for (const row of rows) {
    row.status = ctx.PO_STATUS_EN_TO_KO[row.status] || row.status;
  }
  // include=items / include=progress 지원
  const includeParam = parsed.searchParams.get('include') || '';
  if (includeParam === 'items' || includeParam.includes('items')) {
    const itemStmt = db.prepare('SELECT * FROM po_items WHERE po_id = ?');
    for (const row of rows) {
      row.items = await itemStmt.all(row.po_id);
    }
  }
  if (includeParam === 'progress' || includeParam.includes('progress')) {
    const rootIds = rows.filter(r => !r.parent_po_id).map(r => r.po_id);
    const childrenByParent = {};
    if (rootIds.length) {
      const placeholders = rootIds.map(() => '?').join(',');
      const children = await db.prepare(
        `SELECT po_id, parent_po_id, process_step, status, po_type, vendor_name, process_vendor_name, shipped_at FROM po_header WHERE parent_po_id IN (${placeholders}) ORDER BY process_step ASC, po_id ASC`
      ).all(...rootIds);
      for (const c of children) {
        if (!childrenByParent[c.parent_po_id]) childrenByParent[c.parent_po_id] = [];
        childrenByParent[c.parent_po_id].push({
          po_id: c.po_id,
          step: c.process_step || 0,
          status: ctx.PO_STATUS_EN_TO_KO[c.status] || c.status,
          raw_status: c.status,
          vendor: c.process_vendor_name || c.vendor_name || '',
          shipped_at: c.shipped_at || ''
        });
      }
    }
    for (const row of rows) {
      row._children = childrenByParent[row.po_id] || [];
    }
  }
  ctx.ok(res, rows);
});

// GET /api/po/:id
router.getP(/^\/api\/po\/(\d+)$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = parseInt(m[1]);
  const po = await db.prepare('SELECT * FROM po_header WHERE po_id = ?').get(id);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  po.items = await db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(id);
  ctx.ok(res, po);
});

// POST /api/po/bulk-import — 엑셀 일괄 발주
router.post('/api/po/bulk-import', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  const items = body.items || [];
  if (!items.length) { ctx.fail(res, 400, '항목이 없습니다'); return; }

  // vendor_name별 그룹핑
  const vendorGroups = {};
  for (const it of items) {
    const vName = it.vendor_name || '';
    if (!vName) continue;
    if (!vendorGroups[vName]) vendorGroups[vName] = [];
    vendorGroups[vName].push(it);
  }

  const created = [];
  const errors = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const [vendorName, vendorItems] of Object.entries(vendorGroups)) {
    try {
      const poNumber = await ctx.generatePoNumber();
      const totalQty = vendorItems.reduce((s, it) => s + (parseInt(it.qty) || 0), 0);
      const _bulkFirstProd = await db.prepare(`SELECT ${ctx._hasEntity.products ? 'origin, legal_entity' : 'origin'} FROM products WHERE product_code=?`).get(vendorItems[0].product_code || '');
      const _bulkOrigin = (_bulkFirstProd && _bulkFirstProd.origin) || '';
      const _bulkEntity = (_bulkFirstProd && _bulkFirstProd.legal_entity === 'dd') ? 'dd' : 'barunson';
      const tx = db.transaction(async () => {
        const hdr = ctx._hasEntity.po_header
          ? await db.prepare(`INSERT INTO po_header (po_number, po_type, vendor_name, status, total_qty, notes, material_status, process_status, origin, legal_entity, po_date)
              VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
              poNumber, '원재료', vendorName, 'draft', totalQty, '엑셀 일괄 발주', 'sent', 'waiting', _bulkOrigin, _bulkEntity, today)
          : await db.prepare(`INSERT INTO po_header (po_number, po_type, vendor_name, status, total_qty, notes, material_status, process_status, origin, po_date)
              VALUES (?,?,?,?,?,?,?,?,?,?)`).run(
              poNumber, '원재료', vendorName, 'draft', totalQty, '엑셀 일괄 발주', 'sent', 'waiting', _bulkOrigin, today);
        for (const it of vendorItems) {
          await db.prepare('INSERT INTO po_items (po_id, product_code, ordered_qty, notes) VALUES (?,?,?,?)').run(
            hdr.lastInsertRowid, it.product_code || '', parseInt(it.qty) || 0, '엑셀 일괄'
          );
        }
        return { po_id: Number(hdr.lastInsertRowid), po_number: poNumber };
      });
      const result = await tx();
      created.push({ po_number: result.po_number, vendor: vendorName, items_count: vendorItems.length });
    } catch (e) {
      errors.push({ vendor: vendorName, error: e.message });
    }
  }

  // vendor_name이 없는 항목 에러 처리
  const noVendor = items.filter(it => !it.vendor_name);
  if (noVendor.length) {
    errors.push({ vendor: '(미지정)', error: `거래처 미지정 ${noVendor.length}건`, items: noVendor.map(it => it.product_code) });
  }

  ctx.ok(res, { created, errors });
});

// POST /api/slack/manual-po-notify — 수동 일괄 발주 완료 알림
router.post('/api/slack/manual-po-notify', async (req, res, parsed) => {
  try {
    const body = await ctx.readJSON(req);
    const savedVendors = Array.isArray(body.saved_vendors) ? body.saved_vendors : [];
    const emailOk = Array.isArray(body.email_ok) ? body.email_ok : [];
    const emailFail = Array.isArray(body.email_fail) ? body.email_fail : [];
    const origin = body.origin || '';
    const totalQty = Number(body.total_qty || 0);
    if (ctx._slackWebhookUrl && savedVendors.length) {
      const lines = [];
      lines.push(`📮 *수동 발주 완료* (${origin || '국가미지정'})`);
      lines.push(`저장: ${savedVendors.length}건 / 수량합: ${totalQty.toLocaleString()}`);
      lines.push(`• ${savedVendors.join(', ')}`);
      if (emailOk.length) lines.push(`✅ 이메일 발송 (${emailOk.length}): ${emailOk.join(', ')}`);
      if (emailFail.length) lines.push(`⚠️ 이메일 미발송 (${emailFail.length}): ${emailFail.join(', ')}`);
      ctx.sendSlack(lines.join('\n')).catch(()=>{});
    }
    ctx.ok(res, { notified: !!ctx._slackWebhookUrl });
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

// POST /api/po — PO 생성
router.post('/api/po', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  const items = body.items || [];
  const totalQty = items.reduce((s, it) => s + (it.ordered_qty || 0), 0);

  // vendor_id로 vendor_name 자동 조회
  let vendorName = body.vendor_name || '';
  if (!vendorName && body.vendor_id) {
    const v = await db.prepare('SELECT name FROM vendors WHERE vendor_id = ?').get(body.vendor_id);
    if (v) vendorName = v.name;
  }

  // origin 결정
  let poOrigin = body.origin || '';
  let poEntity = body.legal_entity || '';
  if ((!poOrigin || !poEntity) && items.length) {
    const _selCols = ctx._hasEntity.products ? 'origin, legal_entity' : 'origin';
    const firstProd = await db.prepare(`SELECT ${_selCols} FROM products WHERE product_code=?`).get(items[0].product_code || '');
    if (firstProd) {
      if (!poOrigin && firstProd.origin) poOrigin = firstProd.origin;
      if (!poEntity && firstProd.legal_entity) poEntity = firstProd.legal_entity;
    }
  }
  if (poEntity !== 'dd') poEntity = 'barunson';

  // 중복 발주 방지
  if (vendorName && items.length) {
    const today = new Date().toISOString().slice(0, 10);
    const productCodes = items.map(it => it.product_code).filter(Boolean).sort().join(',');
    const dupCheck = await db.prepare(`SELECT po_id, po_number FROM po_header WHERE vendor_name = ? AND po_date::text >= ? AND status != 'cancelled' ORDER BY po_id DESC LIMIT 1`).get(vendorName, today);
    if (dupCheck) {
      const dupItems = await db.prepare('SELECT product_code FROM po_items WHERE po_id = ? ORDER BY product_code').all(dupCheck.po_id);
      const existingCodes = dupItems.map(r => r.product_code).filter(Boolean).sort().join(',');
      if (existingCodes === productCodes) {
        ctx.fail(res, 409, `중복 발주: 오늘 동일 거래처(${vendorName})에 같은 품목으로 이미 발주(${dupCheck.po_number})가 생성되었습니다.`);
        return;
      }
    }
  }

  const poNumber = await ctx.generatePoNumber();

  const tx = db.transaction(async () => {
    const _poSql = ctx._hasEntity.po_header
      ? `INSERT INTO po_header (po_number, po_type, vendor_name, status, due_date, total_qty, notes, process_step, parent_po_id, process_chain, origin, legal_entity, po_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now','localtime'))`
      : `INSERT INTO po_header (po_number, po_type, vendor_name, status, due_date, total_qty, notes, process_step, parent_po_id, process_chain, origin, po_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, date('now','localtime'))`;
    const _poArgs = [
      poNumber,
      body.po_type || 'material',
      vendorName,
      body.status || '대기',
      body.expected_date || body.due_date || '',
      totalQty,
      body.notes || '',
      body.process_step || 0,
      body.parent_po_id || null,
      body.process_chain || '',
      poOrigin
    ];
    if (ctx._hasEntity.po_header) _poArgs.push(poEntity);
    const info = await db.prepare(_poSql).run(..._poArgs);
    const poId = info.lastInsertRowid;
    const itemStmt = db.prepare(`INSERT INTO po_items (po_id, product_code, brand, process_type, ordered_qty, spec, notes) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    for (const it of items) {
      await itemStmt.run(poId, it.product_code || '', it.brand || '', it.process_type || '', it.ordered_qty || 0, it.spec || '', it.notes || '');
    }
    // 규격 자동 보정
    try { await db.prepare(`UPDATE po_items SET spec = COALESCE((SELECT spec FROM products WHERE product_code = po_items.product_code), '') WHERE po_id = ? AND (spec IS NULL OR spec = '')`).run(poId); } catch(_){}
    return poId;
  });
  const poId = await tx();

  // 후공정 체인 자동 설정
  if (!body.process_chain && items.length) {
    try {
      const pInfo = ctx.getProductInfo();
      const postCols = await ctx.getPostProcessTypes();
      const info = pInfo[items[0].product_code] || {};
      let chainSteps = [];
      if (info._steps && info._steps.length) {
        chainSteps = info._steps.map((s, i) => ({ step: i + 1, process: s.process, vendor: s.vendor }));
      } else {
        let stepNum = 1;
        postCols.forEach(col => {
          if (info[col] && info[col] !== '0') {
            chainSteps.push({ step: stepNum, process: col, vendor: info[col] });
            stepNum++;
          }
        });
      }
      if (chainSteps.length > 0) {
        const myStep = chainSteps.findIndex(s => {
          const vn = vendorName.replace('패키지','').replace('봉투','');
          return s.vendor.startsWith(vn.slice(0,2)) || vendorName.startsWith(s.vendor.slice(0,2));
        });
        const processStep = myStep >= 0 ? chainSteps[myStep].step : 1;
        await db.prepare("UPDATE po_header SET process_chain=?, process_step=? WHERE po_id=?")
          .run(JSON.stringify(chainSteps), processStep, poId);
        console.log(`[공정체인] PO ${poNumber}: ${chainSteps.map(s=>s.vendor+'('+s.process+')').join(' → ')}, 현재 step=${processStep}`);
      }
    } catch(e) { console.warn('[공정체인 자동설정 실패]', e.message); }
  }

  // 목형비 자동 처리
  for (const item of items) {
    const prod = await db.prepare('SELECT is_new_product, first_order_done, die_cost FROM products WHERE product_code=?').get(item.product_code);
    if (prod && prod.is_new_product === 1 && prod.first_order_done === 0) {
      await db.prepare("UPDATE po_items SET notes = CASE WHEN notes='' THEN '목형비 포함' ELSE notes || ' | 목형비 포함' END WHERE po_id=? AND product_code=?")
        .run(poId, item.product_code);
      await db.prepare("UPDATE products SET first_order_done=1 WHERE product_code=?").run(item.product_code);
      ctx.logPOActivity(poId, 'die_cost_included', {
        actor_type: 'system',
        details: `신제품 최초 발주 → 목형비 포함 마킹: ${item.product_code}`
      });
      console.log(`[목형비] ${item.product_code} 첫 발주 → 목형비 포함 마킹`);
    }
  }

  ctx.ok(res, { po_id: poId, po_number: poNumber });
});

// PUT /api/po/:id/items — 발주서 품목 추가/수정 (발송 후에도 admin 가능)
router.putP(/^\/api\/po\/(\d+)\/items$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const poId = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  const po = await db.prepare('SELECT * FROM po_header WHERE po_id=?').get(poId);
  if (!po) { ctx.fail(res, 404, '발주서 없음'); return; }

  const currentUser = req._currentUser;
  const isAdmin = currentUser && currentUser.role === 'admin';
  const lockedStatuses = ['received', 'cancelled'];
  const materialShipped = po.material_status === 'shipped' || po.material_status === 'received';
  if (!isAdmin && (lockedStatuses.includes(po.status) || materialShipped)) {
    ctx.fail(res, 403, '원재료가 이미 발송된 발주서는 수정할 수 없습니다. 관리자에게 요청하세요.'); return;
  }
  if (lockedStatuses.includes(po.status) && !isAdmin) {
    ctx.fail(res, 403, '완료/취소된 발주서는 수정 불가'); return;
  }

  const addItems = body.add || [];
  const removeItemIds = body.remove || [];
  const updateItems = body.update || [];
  let added = 0, removed = 0, updated = 0;

  const tx = db.transaction(async () => {
    for (const it of addItems) {
      if (!it.product_code || !it.ordered_qty) continue;
      await db.prepare('INSERT INTO po_items (po_id, product_code, brand, process_type, ordered_qty, spec, notes) VALUES (?,?,?,?,?,?,?)')
        .run(poId, it.product_code, it.brand||'', it.process_type||'', it.ordered_qty||0, it.spec||'', it.notes||'');
      added++;
    }
    for (const itemId of removeItemIds) {
      await db.prepare('DELETE FROM po_items WHERE item_id=? AND po_id=?').run(itemId, poId);
      removed++;
    }
    for (const it of updateItems) {
      if (!it.item_id) continue;
      const sets = [], vals = [];
      if (it.ordered_qty !== undefined) { sets.push('ordered_qty=?'); vals.push(it.ordered_qty); }
      if (it.spec !== undefined) { sets.push('spec=?'); vals.push(it.spec); }
      if (it.notes !== undefined) { sets.push('notes=?'); vals.push(it.notes); }
      if (it.process_type !== undefined) { sets.push('process_type=?'); vals.push(it.process_type); }
      if (sets.length) { vals.push(it.item_id, poId); await db.prepare(`UPDATE po_items SET ${sets.join(',')} WHERE item_id=? AND po_id=?`).run(...vals); updated++; }
    }
    // po_header 업데이트 (업체명 변경 등)
    if (body.vendor_name) {
      if (po.po_type === '원재료') {
        await db.prepare("UPDATE po_header SET vendor_name=?, material_vendor_name=?, updated_at=datetime('now','localtime') WHERE po_id=?").run(body.vendor_name, body.vendor_name, poId);
        try {
          await db.prepare("UPDATE po_header SET material_vendor_name=?, updated_at=datetime('now','localtime') WHERE parent_po_id=?").run(body.vendor_name, poId);
        } catch(_) {}
      } else if (po.po_type === '후공정') {
        await db.prepare("UPDATE po_header SET vendor_name=?, process_vendor_name=?, updated_at=datetime('now','localtime') WHERE po_id=?").run(body.vendor_name, body.vendor_name, poId);
      } else {
        await db.prepare("UPDATE po_header SET vendor_name=?, updated_at=datetime('now','localtime') WHERE po_id=?").run(body.vendor_name, poId);
      }
    }
    // total_qty 갱신
    const total = await db.prepare('SELECT COALESCE(SUM(ordered_qty),0) AS t FROM po_items WHERE po_id=?').get(poId);
    await db.prepare("UPDATE po_header SET total_qty=?, updated_at=datetime('now','localtime') WHERE po_id=?").run(total.t, poId);
  });
  await tx();

  // 이력 기록
  const details = [];
  if (added) details.push(`${added}건 추가`);
  if (removed) details.push(`${removed}건 삭제`);
  if (updated) details.push(`${updated}건 수정`);
  ctx.logPOActivity(poId, 'items_modified', {
    actor: currentUser?.username || 'unknown',
    actor_type: isAdmin ? 'admin' : 'user',
    details: `품목변경: ${details.join(', ')}${body.reason ? ' | 사유: '+body.reason : ''}`
  });
  if (currentUser) ctx.auditLog(currentUser.userId, currentUser.username, 'po_items_modify', 'po_items', poId, `PO ${po.po_number} 품목변경: ${details.join(', ')}${body.reason?' 사유:'+body.reason:''}`, req._clientIP);

  ctx.ok(res, { po_id: poId, added, removed, updated });
});

// POST /api/po/:matPoId/add-postprocess — 원재료 PO 에서 자식 후공정 PO 에 항목 추가
router.postP(/^\/api\/po\/(\d+)\/add-postprocess$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const matPoId = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  const matPo = await db.prepare('SELECT * FROM po_header WHERE po_id=?').get(matPoId);
  if (!matPo) { ctx.fail(res, 404, '원재료 PO 없음'); return; }
  if (matPo.po_type !== '원재료') { ctx.fail(res, 400, '원재료 PO 가 아님 (po_type=' + matPo.po_type + ')'); return; }

  const productCodes = Array.isArray(body.product_codes) ? body.product_codes : [];
  const processType = (body.process_type || '').trim();
  const postVendor = (body.post_vendor || '').trim();
  if (!productCodes.length) { ctx.fail(res, 400, '품목 미선택'); return; }
  if (!processType) { ctx.fail(res, 400, '공정명 미입력'); return; }
  if (!postVendor) { ctx.fail(res, 400, '후공정 업체 미입력'); return; }

  const matItems = await db.prepare('SELECT * FROM po_items WHERE po_id=? AND product_code IN (' + productCodes.map(() => '?').join(',') + ')').all(matPoId, ...productCodes);
  const qtyByCode = {};
  for (const it of matItems) qtyByCode[it.product_code] = (qtyByCode[it.product_code] || 0) + (it.ordered_qty || 0);

  let postPo = await db.prepare(`SELECT h.* FROM po_header h
    WHERE h.parent_po_id=? AND h.po_type='후공정' AND h.vendor_name=? AND h.status NOT IN ('완료','취소')
      AND EXISTS (SELECT 1 FROM po_items WHERE po_id=h.po_id AND process_type=?)
    ORDER BY h.po_id DESC LIMIT 1`).get(matPoId, postVendor, processType);
  let postPoId, postPoNumber;
  let createdNew = false;
  if (postPo) {
    postPoId = postPo.po_id;
    postPoNumber = postPo.po_number;
  } else {
    postPoNumber = await ctx.generatePoNumber();
    const totalQty = productCodes.reduce((s, c) => s + (qtyByCode[c] || 0), 0);
    const info = await db.prepare(`INSERT INTO po_header
      (po_number, po_type, vendor_name, material_vendor_name, process_vendor_name, status,
       due_date, total_qty, notes, origin, po_date, process_step, parent_po_id)
      VALUES (?,?,?,?,?,?,?,?,?,?,date('now','localtime'),?,?)`)
      .run(postPoNumber, '후공정', postVendor, matPo.vendor_name || '', postVendor, 'draft',
           matPo.due_date || '', totalQty, '사후추가: ' + processType, matPo.origin || '한국', 1, matPoId);
    postPoId = info.lastInsertRowid;
    createdNew = true;
    try { await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)").run(postPoId, 'created', req._currentUser?.username || 'system', `사후 추가: 후공정 PO (${postVendor}, ${processType}, 원재료 PO: ${matPo.po_number})`); } catch(_) {}
  }

  // 후공정 PO 에 항목 추가
  let added = 0, skipped = 0;
  const insItem = db.prepare('INSERT INTO po_items (po_id, product_code, brand, process_type, ordered_qty, spec, notes) VALUES (?,?,?,?,?,?,?)');
  for (const code of productCodes) {
    const exists = await db.prepare('SELECT item_id FROM po_items WHERE po_id=? AND product_code=? AND process_type=? LIMIT 1').get(postPoId, code, processType);
    if (exists) { skipped++; continue; }
    const qty = qtyByCode[code] || 0;
    try {
      await insItem.run(postPoId, code, '', processType, qty, processType, '사후 추가 (원재료 PO ' + matPo.po_number + ')');
      added++;
    } catch (_) {}
  }
  // total_qty 재계산
  try {
    const t = await db.prepare('SELECT COALESCE(SUM(ordered_qty),0) AS t FROM po_items WHERE po_id=?').get(postPoId);
    await db.prepare("UPDATE po_header SET total_qty=?, updated_at=datetime('now','localtime') WHERE po_id=?").run(t.t, postPoId);
  } catch(_) {}
  try { await db.prepare("INSERT INTO po_activity_log (po_id, action, actor, details) VALUES (?,?,?,?)").run(postPoId, 'items_modified', req._currentUser?.username || 'system', `사후 후공정 ${added}건 추가 (${processType}): ${productCodes.join(',')}`); } catch(_) {}

  ctx.ok(res, { post_po_id: postPoId, post_po_number: postPoNumber, added, skipped, created_new: createdNew });
});

// PUT /api/po/:id/status
router.putP(/^\/api\/po\/(\d+)\/status$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  const validStatuses = ['draft', 'sent', 'confirmed', 'partial', 'received', 'cancelled', 'os_pending', 'os_registered'];
  if (!validStatuses.includes(body.status)) { ctx.fail(res, 400, 'Invalid status. Allowed: ' + validStatuses.join(', ')); return; }
  await db.prepare(`UPDATE po_header SET status = ?, updated_at = datetime('now','localtime') WHERE po_id = ?`).run(body.status, id);
  ctx.ok(res, { po_id: id, status: body.status });
});

// PATCH /api/po/:id — 상태 변경 (프론트엔드 호출용)
router.addPattern('PATCH', /^\/api\/po\/(\d+)$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  const newStatus = body.status;
  const dbStatus = ctx.PO_STATUS_KO_TO_EN[newStatus] || newStatus;
  const poBeforePatch = await db.prepare('SELECT status, material_status, process_status FROM po_header WHERE po_id=?').get(id);
  await db.prepare(`UPDATE po_header SET status = ?, updated_at = datetime('now','localtime') WHERE po_id = ?`).run(dbStatus, id);

  // 발송 시 파이프라인 서브상태 초기화
  if (newStatus === '발송' || dbStatus === 'sent') {
    await db.prepare("UPDATE po_header SET material_status='sent', process_status='waiting' WHERE po_id=?").run(id);
  }

  ctx.logPOActivity(id, 'status_change', {
    actor_type: 'admin',
    from_status: poBeforePatch ? poBeforePatch.status : '',
    to_status: dbStatus,
    details: `상태 변경: ${poBeforePatch ? poBeforePatch.status : ''} → ${dbStatus}`
  });

  // 발송(발주확인) 시 Google Sheet + 업체 이메일 발송
  let sheetResult = null;
  let emailResult = null;
  console.log(`[PATCH] po_id=${id}, newStatus='${newStatus}', dbStatus='${dbStatus}'`);
  if (newStatus === '발송' || dbStatus === 'sent') {
    const po = await db.prepare('SELECT * FROM po_header WHERE po_id = ?').get(id);
    const items = await db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(id);

    // Google Sheet 동기화
    if (items.length) {
      sheetResult = await ctx.appendToGoogleSheet(items.map(it => ({
        order_date: po ? po.po_date : '',
        product_code: it.product_code || '',
        product_name: it.brand || '',
        material_name: it.spec || '',
        paper_maker: po ? po.vendor_name : '',
        order_qty: it.ordered_qty || 0,
        product_spec: it.spec || ''
      })));
      console.log('Google Sheet 발송 동기화:', sheetResult);
    }

    // 업체 이메일 발송
    if (po) {
      const vendor = await db.prepare('SELECT * FROM vendors WHERE name = ?').get(po.vendor_name);
      const isPost = vendor ? vendor.type === '후공정' : (po.po_type === '후공정');
      const forceEmail = body.force_email === true;
      if (vendor && vendor.email && (!isPost || forceEmail)) {
        emailResult = await ctx.sendPOEmail(po, items, vendor.email, vendor.name, isPost, vendor.email_cc);
        console.log(`발주확인 이메일 발송: ${po.po_number} → ${vendor.name} (${vendor.email})`, emailResult);
      } else if (isPost && !forceEmail) {
        console.log(`후공정 PO ${po.po_number}: 이메일 보류 (원재료 출고 시 자동 발송)`);
        emailResult = { ok: true, skipped: true, reason: '후공정 — 원재료 출고 시 자동 발송' };
      } else {
        console.warn(`발주확인: 업체 이메일 없음 (${po.vendor_name})`);
      }
    }

    // 발송 시 거래명세서 자동 생성
    if (po) {
      const poForDoc = await db.prepare('SELECT * FROM po_header WHERE po_id=?').get(id);
      const itemsForDoc = await db.prepare('SELECT * FROM po_items WHERE po_id=?').all(id);
      const piMap = ctx.getProductInfo();
      const docItems = [];
      for (const item of itemsForDoc) {
        const pi = piMap[item.product_code] || {};
        const lastPrice = await ctx.getLastVendorPrice(poForDoc.vendor_name, item.product_code);
        docItems.push({
          product_code: item.product_code,
          product_name: item.brand || '',
          qty: item.ordered_qty,
          unit_price: lastPrice,
          amount: lastPrice * (item.ordered_qty || 0),
          spec: item.spec || '',
          cut: pi['절'] || '',
          imposition: pi['조판'] || '',
          material_name: pi['원재료용지명'] || '',
          process_name: item.spec || '',
          last_price: lastPrice
        });
      }
      const vendorRow = await db.prepare('SELECT type FROM vendors WHERE name=?').get(poForDoc.vendor_name);
      const vendorType = vendorRow ? vendorRow.type : 'material';
      await db.prepare(`INSERT INTO trade_document (po_id, po_number, vendor_name, vendor_type, items_json, status) VALUES (?,?,?,?,?,'sent')`)
        .run(id, poForDoc.po_number, poForDoc.vendor_name, vendorType === '후공정' ? 'process' : 'material', JSON.stringify(docItems));
      ctx.logPOActivity(id, 'trade_doc_created', { actor_type: 'system', details: '거래명세서 자동 생성' });
    }
  }

  // 취소 시 Google Sheet에 취소선 + 빨간글씨 적용
  if (newStatus === '취소' || dbStatus === 'cancelled') {
    const items = await db.prepare('SELECT product_code FROM po_items WHERE po_id = ?').all(id);
    const po = await db.prepare('SELECT po_date FROM po_header WHERE po_id = ?').get(id);
    const codes = items.map(i => i.product_code).filter(Boolean);
    if (codes.length) {
      sheetResult = await ctx.cancelInGoogleSheet(codes, po ? po.po_date : '');
      console.log('Google Sheet 취소 포맷:', sheetResult);
    }
  }

  const emailFailed = emailResult && !emailResult.ok;
  if (req._currentUser) ctx.auditLog(req._currentUser.userId, req._currentUser.username, 'po_update', 'po_header', id, `발주수정: PO#${id} 상태→${dbStatus}`, req._clientIP);
  ctx.ok(res, { updated: true, po_id: id, status: dbStatus, google_sheet: sheetResult, email: emailResult, email_failed: emailFailed });
});

// POST /api/po/:id/resend — 이메일 재발송
router.postP(/^\/api\/po\/(\d+)\/resend$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = parseInt(m[1]);
  const po = await db.prepare('SELECT * FROM po_header WHERE po_id = ?').get(id);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  const items = await db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(id);
  const vendor = await db.prepare('SELECT * FROM vendors WHERE name = ?').get(po.vendor_name);
  if (!vendor || !vendor.email) { ctx.fail(res, 400, '업체 이메일 미등록'); return; }
  try {
    const isPost = po.po_type === '후공정';
    const emailResult = await ctx.sendPOEmail(po, items, vendor.email, vendor.name, isPost, vendor.email_cc || '');
    try { await db.prepare('INSERT INTO po_activity_log (po_id, action, details) VALUES (?, ?, ?)').run(id, '이메일 재발송', emailResult.ok ? '성공: ' + vendor.email : '실패: ' + (emailResult.error||'')); } catch(e){}
    ctx.ok(res, { email: emailResult });
  } catch(e) {
    ctx.ok(res, { email: { ok: false, error: e.message } });
  }
});

// DELETE /api/po/:id
router.delP(/^\/api\/po\/(\d+)$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = parseInt(m[1]);
  const po = await db.prepare('SELECT po_id, po_number, status FROM po_header WHERE po_id = ?').get(id);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  try { await db.prepare('DELETE FROM receipt_items WHERE receipt_id IN (SELECT receipt_id FROM receipts WHERE po_id = ?)').run(id); } catch(_){}
  try { await db.prepare('DELETE FROM receipts WHERE po_id = ?').run(id); } catch(_){}
  await db.prepare('DELETE FROM po_items WHERE po_id = ?').run(id);
  try { await db.prepare('DELETE FROM activity_log WHERE po_id = ?').run(id); } catch(_){}
  await db.prepare('DELETE FROM po_header WHERE po_id = ?').run(id);
  console.log(`PO 삭제: ${po.po_number} (ID: ${id}, 상태: ${po.status})`);
  ctx.ok(res, { deleted: id, po_number: po.po_number });
});

// ════════════════════════════════════════════════════════════════════
//  발주서(po-drafts) 관리
// ════════════════════════════════════════════════════════════════════

// GET /api/po-drafts — 발주서 목록
router.get('/api/po-drafts', async (req, res, parsed) => {
  const db = ctx.db;
  const rows = await db.prepare(`SELECT * FROM po_drafts ORDER BY created_at DESC`).all();
  ctx.ok(res, rows);
});

// POST /api/po-drafts — 발주서 저장
router.post('/api/po-drafts', async (req, res, parsed) => {
  const db = ctx.db;
  const body = await ctx.readJSON(req);
  const { po_number, po_date, due_date, vendor_id, vendor_name, vendor_contact, vendor_phone, vendor_email,
          issuer_name, issuer_contact, issuer_phone, issuer_email, payment_terms, remark,
          items, total_supply, total_tax, total_amount } = body;
  const legal_entity = (body.legal_entity === 'dd') ? 'dd' : 'barunson';
  const result = await db.prepare(`INSERT INTO po_drafts
    (po_number,po_date,due_date,vendor_id,vendor_name,vendor_contact,vendor_phone,vendor_email,
     issuer_name,issuer_contact,issuer_phone,issuer_email,payment_terms,remark,
     items,total_supply,total_tax,total_amount,legal_entity)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    po_number||'', po_date||'', due_date||'', vendor_id||0, vendor_name||'',
    vendor_contact||'', vendor_phone||'', vendor_email||'',
    issuer_name||'바른컴퍼니', issuer_contact||'', issuer_phone||'', issuer_email||'',
    payment_terms||'', remark||'',
    typeof items === 'string' ? items : JSON.stringify(items||[]),
    total_supply||0, total_tax||0, total_amount||0, legal_entity
  );
  ctx.ok(res, { id: result.lastInsertRowid });
});

// POST /api/po-drafts/:id/email — 발주서 이메일 발송
router.postP(/^\/api\/po-drafts\/(\d+)\/email$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = parseInt(m[1]);
  const draft = await db.prepare('SELECT * FROM po_drafts WHERE id=?').get(id);
  if (!draft) { ctx.fail(res, 404, '발주서 없음'); return; }
  const smtpTransporter = ctx.getSmtpTransporter();
  if (!smtpTransporter) { ctx.fail(res, 503, 'SMTP 미설정 — .env에 SMTP_USER, SMTP_PASS 추가 필요'); return; }
  const body = await ctx.readJSON(req);
  const to = body.to || draft.vendor_email || '';
  const cc = body.cc || '';
  const subject = body.subject || `[발주서] ${draft.po_number} - 바른컴퍼니`;
  if (!to) { ctx.fail(res, 400, '수신 이메일을 입력하세요'); return; }
  const items = (() => { try { return JSON.parse(draft.items||'[]'); } catch { return []; } })();
  const fN = n => (n||0).toLocaleString();
  const itemsHTML = items.filter(x=>x.name).map((it,i) => `
    <tr style="border-bottom:1px solid #f0f0f0">
      <td style="padding:8px 12px;text-align:center;color:#888;font-size:12px">${i+1}</td>
      <td style="padding:8px 12px;font-weight:600">${it.name||''}</td>
      <td style="padding:8px 12px;color:#555;font-size:12px">${it.spec||''}</td>
      <td style="padding:8px 12px;text-align:center;font-size:12px">${it.unit||'EA'}</td>
      <td style="padding:8px 12px;text-align:right">${fN(it.qty)}</td>
      <td style="padding:8px 12px;text-align:right">${fN(it.price)}</td>
      <td style="padding:8px 12px;text-align:right;font-weight:700;color:#0f172a">${fN(it.supply)}</td>
      <td style="padding:8px 12px;text-align:right;color:#666">${fN(it.tax)}</td>
    </tr>`).join('');
  const html = `<!DOCTYPE html><html><head><meta charset="utf-8"></head>
<body style="font-family:'Malgun Gothic',Arial,sans-serif;background:#f8fafc;margin:0;padding:24px">
<div style="max-width:700px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 12px rgba(0,0,0,0.10)">
  <div style="background:linear-gradient(135deg,#1e293b,#0f172a);padding:22px 32px;color:#fff">
    <div style="font-size:10px;color:#94a3b8;letter-spacing:2px;margin-bottom:2px">BARUN COMPANY</div>
    <div style="font-size:30px;font-weight:700;letter-spacing:8px;margin-bottom:10px">발 주 서</div>
    <div style="font-size:12px;color:#cbd5e1;display:flex;gap:20px">
      <span>발주번호 <b style="color:#fff">${draft.po_number}</b></span>
      <span>발주일 <b style="color:#fff">${draft.po_date||''}</b></span>
      ${draft.due_date?`<span>납기예정 <b style="color:#fff">${draft.due_date}</b></span>`:''}
    </div>
  </div>
  <div style="display:flex;padding:18px 32px;gap:24px;background:#f8fafc;border-bottom:1px solid #e2e8f0">
    <div style="flex:1">
      <div style="font-size:10px;font-weight:700;color:#1d4ed8;background:#eff6ff;border:1px solid #bfdbfe;display:inline-block;padding:2px 8px;border-radius:3px;margin-bottom:8px">수 신</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">${draft.vendor_name||''}</div>
      ${draft.vendor_contact?`<div style="font-size:13px;color:#555">담당자: ${draft.vendor_contact}</div>`:''}
      ${draft.vendor_phone?`<div style="font-size:13px;color:#555">연락처: ${draft.vendor_phone}</div>`:''}
      ${draft.payment_terms?`<div style="font-size:12px;color:#888;margin-top:4px">결제조건: ${draft.payment_terms}</div>`:''}
    </div>
    <div style="flex:1">
      <div style="font-size:10px;font-weight:700;color:#16a34a;background:#f0fdf4;border:1px solid #bbf7d0;display:inline-block;padding:2px 8px;border-radius:3px;margin-bottom:8px">발 주</div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">${draft.issuer_name||'바른컴퍼니'}</div>
      ${draft.issuer_contact?`<div style="font-size:13px;color:#555">담당자: ${draft.issuer_contact}</div>`:''}
      ${draft.issuer_phone?`<div style="font-size:13px;color:#555">연락처: ${draft.issuer_phone}</div>`:''}
    </div>
  </div>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="background:#1e293b;color:#e2e8f0">
      <th style="padding:9px 12px;font-weight:600;width:36px">No</th>
      <th style="padding:9px 12px;font-weight:600;text-align:left">품목명</th>
      <th style="padding:9px 12px;font-weight:600;text-align:left">규격</th>
      <th style="padding:9px 12px;font-weight:600;width:48px">단위</th>
      <th style="padding:9px 12px;font-weight:600;text-align:right;width:64px">수량</th>
      <th style="padding:9px 12px;font-weight:600;text-align:right;width:80px">단가</th>
      <th style="padding:9px 12px;font-weight:600;text-align:right;width:96px">공급가액</th>
      <th style="padding:9px 12px;font-weight:600;text-align:right;width:80px">세액</th>
    </tr></thead>
    <tbody>${itemsHTML}</tbody>
    <tfoot><tr style="background:#f1f5f9;font-weight:700;border-top:2px solid #e2e8f0">
      <td colspan="4" style="padding:9px 12px;text-align:center;color:#555;font-size:12px">합 계</td>
      <td style="padding:9px 12px;text-align:right">${fN(items.reduce((s,x)=>s+(x.qty||0),0))}</td>
      <td></td>
      <td style="padding:9px 12px;text-align:right">${fN(draft.total_supply)}</td>
      <td style="padding:9px 12px;text-align:right">${fN(draft.total_tax)}</td>
    </tr></tfoot>
  </table>
  <div style="display:flex;justify-content:flex-end;padding:16px 32px;background:#f8fafc;border-top:1px solid #e2e8f0">
    <div style="width:260px">
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e9ecef"><span style="font-size:12px;color:#64748b">공급가액 합계</span><span style="font-size:13px;font-weight:700">${fN(draft.total_supply)} 원</span></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid #e9ecef"><span style="font-size:12px;color:#64748b">세액 합계</span><span style="font-size:13px;font-weight:700">${fN(draft.total_tax)} 원</span></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0;border-top:2px solid #1e293b;margin-top:4px"><span style="font-size:14px;font-weight:700">청 구 합 계</span><span style="font-size:18px;font-weight:800;color:#dc2626">${fN(draft.total_amount)} 원</span></div>
    </div>
  </div>
  ${draft.remark?`<div style="padding:14px 32px;border-top:1px solid #e2e8f0"><div style="font-size:11px;font-weight:700;color:#64748b;margin-bottom:6px">비 고</div><div style="font-size:13px;color:#374151;background:#f8fafc;border-radius:6px;padding:10px 12px">${draft.remark}</div></div>`:''}
  ${body.message?`<div style="padding:14px 32px;border-top:1px solid #e2e8f0"><div style="font-size:13px;color:#374151;white-space:pre-line">${body.message}</div></div>`:''}
  <div style="padding:12px 32px;background:#f1f5f9;border-top:1px solid #e2e8f0;font-size:11px;color:#94a3b8;text-align:center">본 발주서는 바른컴퍼니 ERP에서 발송되었습니다.</div>
</div></body></html>`;
  try {
    await smtpTransporter.sendMail({ from:`바른컴퍼니 <${ctx.SMTP_FROM}>`, to, cc:cc||undefined, subject, html });
    ctx.ok(res, { sent: true, to });
  } catch(e) {
    console.error('발주서 이메일 오류:', e.message);
    ctx.fail(res, 500, '이메일 발송 실패: ' + e.message);
  }
});

// PATCH /api/po-drafts/:id/status — 발주서 완료/복원
router.addPattern('PATCH', /^\/api\/po-drafts\/(\d+)\/status$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  if (body.action === 'complete') {
    await db.prepare("UPDATE po_drafts SET status='completed', completed_at=datetime('now','localtime') WHERE id=?").run(id);
  } else if (body.action === 'restore') {
    await db.prepare("UPDATE po_drafts SET status='sent', completed_at=NULL WHERE id=?").run(id);
  }
  ctx.ok(res, { updated: true });
});

// DELETE /api/po-drafts/:id — 발주서 삭제
router.delP(/^\/api\/po-drafts\/(\d+)$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const id = parseInt(m[1]);
  await db.prepare(`DELETE FROM po_drafts WHERE id=?`).run(id);
  ctx.ok(res, { deleted: true });
});

module.exports = { router };
