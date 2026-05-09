// routes/manufacturing.js — 생산/품질/창고/작업지시/설비/원가카드/RBAC/Lot/안전재고/재고실사 라우트 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  DEFECT / QUALITY MANAGEMENT (불량 관리)
// ════════════════════════════════════════════════════════════════════

router.get('/api/defects/summary', async (req, res, parsed) => {
  const byStatus = await ctx.db.prepare(`SELECT status, COUNT(*) as count FROM defects GROUP BY status`).all();
  const byVendor = await ctx.db.prepare(`SELECT vendor_name, COUNT(*) as defect_count, SUM(defect_qty) as total_defect_qty FROM defects GROUP BY vendor_name ORDER BY defect_count DESC`).all();
  const byType = await ctx.db.prepare(`SELECT defect_type, COUNT(*) as count FROM defects WHERE defect_type != '' GROUP BY defect_type ORDER BY count DESC`).all();
  const since30 = new Date(); since30.setDate(since30.getDate() - 30);
  const since30str = since30.toISOString().slice(0, 10);
  const recent30 = await ctx.db.prepare(`SELECT COUNT(*) as total, SUM(defect_qty) as total_qty, SUM(CASE WHEN status='resolved' THEN 1 ELSE 0 END) as resolved, SUM(CASE WHEN status='registered' THEN 1 ELSE 0 END) as registered, SUM(CASE WHEN status='in_progress' THEN 1 ELSE 0 END) as in_progress FROM defects WHERE defect_date >= ?`).get(since30str);
  ctx.ok(res, { byStatus, byVendor, byType, recent30days: recent30 });
});

router.get('/api/defects', async (req, res, parsed) => {
  const sp = parsed.searchParams;
  let q = 'SELECT * FROM defects WHERE 1=1';
  const args = [];
  if (sp.get('status'))       { q += ' AND status=?';       args.push(sp.get('status')); }
  if (sp.get('vendor_name'))  { q += ' AND vendor_name=?';  args.push(sp.get('vendor_name')); }
  if (sp.get('product_code')) { q += ' AND product_code=?'; args.push(sp.get('product_code')); }
  if (sp.get('from_date'))    { q += ' AND defect_date>=?'; args.push(sp.get('from_date')); }
  if (sp.get('to_date'))      { q += ' AND defect_date<=?'; args.push(sp.get('to_date')); }
  if (sp.get('entity') && sp.get('entity') !== 'all' && ctx._hasEntity.defects) { q += ' AND legal_entity=?'; args.push(sp.get('entity')); }
  q += ' ORDER BY defect_date DESC, created_at DESC LIMIT 200';
  ctx.ok(res, await ctx.db.prepare(q).all(...args));
});

// ════════════════════════════════════════════════════════════════════
//  INCOMING INSPECTION (수입검사)
// ════════════════════════════════════════════════════════════════════

router.get('/api/inspections', async (req, res, parsed) => {
  try {
    const rows = await ctx.db.prepare('SELECT * FROM incoming_inspections ORDER BY created_at DESC LIMIT 200').all();
    ctx.ok(res, rows);
  } catch (e) {
    if (e.message.includes('does not exist')) ctx.ok(res, []);
    else ctx.fail(res, 500, e.message);
  }
});

router.post('/api/inspections', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const passRate = body.total_qty > 0 ? Math.round(body.pass_qty / body.total_qty * 1000) / 10 : 0;
  const result = body.fail_qty > 0 ? (passRate < 90 ? 'rejected' : 'conditional') : 'passed';
  let info;
  try {
    info = await ctx.db.prepare(`INSERT INTO incoming_inspections (po_id, po_number, vendor_name, inspection_date, inspector, result, items_json, total_qty, pass_qty, fail_qty, pass_rate, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`).run(
      body.po_id || null, body.po_number || '', body.vendor_name || '',
      body.inspection_date || new Date().toISOString().slice(0, 10),
      body.inspector || '', result, JSON.stringify(body.items || []),
      body.total_qty || 0, body.pass_qty || 0, body.fail_qty || 0, passRate, body.notes || ''
    );
    if (result === 'rejected' || result === 'conditional') {
      const ncrNum = 'NCR' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + String(info.lastInsertRowid).padStart(3, '0');
      await ctx.db.prepare(`INSERT INTO ncr (ncr_number, inspection_id, po_id, vendor_name, product_code, ncr_type, description, status, severity) VALUES (?,?,?,?,?,?,?,?,?)`).run(
        ncrNum, info.lastInsertRowid, body.po_id || null, body.vendor_name || '',
        body.product_code || '', 'incoming',
        `수입검사 ${result === 'rejected' ? '불합격' : '조건부합격'}: 불량 ${body.fail_qty}건 / 전체 ${body.total_qty}건 (합격률 ${passRate}%)`,
        'open', result === 'rejected' ? 'critical' : 'minor'
      );
    }
    const currentUser = ctx._currentUser;
    if (currentUser) ctx.auditLog(currentUser.userId, currentUser.username, 'inspection_create', 'inspections', info.lastInsertRowid, `수입검사: ${body.po_number || ''} → ${result}`, ctx.clientIP);
    ctx.ok(res, { inspection_id: info.lastInsertRowid, result, pass_rate: passRate });
  } catch (e) {
    if (e.message.includes('does not exist')) ctx.fail(res, 500, 'incoming_inspections 테이블이 없습니다. DB 관리자에게 테이블 생성을 요청하세요.');
    else ctx.fail(res, 500, e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  NCR (부적합 처리)
// ════════════════════════════════════════════════════════════════════

router.get('/api/ncr', async (req, res, parsed) => {
  const status = parsed.searchParams.get('status');
  let sqlStr = 'SELECT * FROM ncr';
  const params = [];
  if (status) { sqlStr += ' WHERE status = ?'; params.push(status); }
  sqlStr += ' ORDER BY created_at DESC LIMIT 200';
  ctx.ok(res, await ctx.db.prepare(sqlStr).all(...params));
});

router.post('/api/ncr', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const ncrNum = 'NCR' + new Date().toISOString().slice(2, 10).replace(/-/g, '') + '-' + String(Date.now()).slice(-4);
  const info = await ctx.db.prepare(`INSERT INTO ncr (ncr_number, defect_id, inspection_id, po_id, vendor_name, product_code, ncr_type, description, severity, responsible, due_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    ncrNum, body.defect_id || null, body.inspection_id || null, body.po_id || null,
    body.vendor_name || '', body.product_code || '', body.ncr_type || 'process',
    body.description || '', body.severity || 'minor', body.responsible || '', body.due_date || ''
  );
  await ctx.db.prepare("INSERT INTO ncr_logs (ncr_id, action, to_status, actor, details) VALUES (?,'created','open',?,?)").run(info.lastInsertRowid, body.actor || '', 'NCR 생성');
  ctx.ok(res, { ncr_id: info.lastInsertRowid, ncr_number: ncrNum });
});

router.putP(/^\/api\/ncr\/(\d+)$/, async (req, res, parsed, m) => {
  const ncrId = parseInt(m[1]);
  const ncr = await ctx.db.prepare('SELECT * FROM ncr WHERE ncr_id=?').get(ncrId);
  if (!ncr) { ctx.fail(res, 404, 'NCR not found'); return; }
  const body = await ctx.readJSON(req);
  const sets = [], vals = [];
  ['status','root_cause','corrective_action','preventive_action','responsible','due_date','severity','description'].forEach(f => {
    if (body[f] !== undefined) { sets.push(`${f}=?`); vals.push(body[f]); }
  });
  if (body.status === 'closed' && !ncr.closed_at) { sets.push("closed_at=NOW()"); }
  sets.push("updated_at=NOW()");
  vals.push(ncrId);
  await ctx.db.prepare(`UPDATE ncr SET ${sets.join(',')} WHERE ncr_id=?`).run(...vals);
  if (body.status && body.status !== ncr.status) {
    const labels = { analysis: '원인분석 중', action: '시정조치 중', closed: '종결' };
    await ctx.db.prepare("INSERT INTO ncr_logs (ncr_id, action, from_status, to_status, actor, details) VALUES (?,?,?,?,?,?)").run(
      ncrId, labels[body.status] || '상태변경', ncr.status, body.status, body.actor || '', body.details || ''
    );
  }
  ctx.ok(res, { ncr_id: ncrId, status: body.status || ncr.status });
});

router.getP(/^\/api\/ncr\/(\d+)$/, async (req, res, parsed, m) => {
  const ncr = await ctx.db.prepare('SELECT * FROM ncr WHERE ncr_id=?').get(parseInt(m[1]));
  if (!ncr) { ctx.fail(res, 404, 'NCR not found'); return; }
  ncr.logs = await ctx.db.prepare('SELECT * FROM ncr_logs WHERE ncr_id=? ORDER BY created_at ASC').all(ncr.ncr_id);
  ctx.ok(res, ncr);
});

// ════════════════════════════════════════════════════════════════════
//  VENDOR SCORECARD (협력사 평가)
// ════════════════════════════════════════════════════════════════════

router.get('/api/vendor-scorecard', async (req, res, parsed) => {
  const vendor = parsed.searchParams.get('vendor');
  if (vendor) {
    ctx.ok(res, await ctx.db.prepare('SELECT * FROM vendor_scorecard WHERE vendor_name=? ORDER BY eval_month DESC').all(vendor));
  } else {
    const latest = await ctx.db.prepare('SELECT MAX(eval_month) as m FROM vendor_scorecard').get();
    if (latest && latest.m) {
      ctx.ok(res, await ctx.db.prepare('SELECT * FROM vendor_scorecard WHERE eval_month=? ORDER BY total_score DESC').all(latest.m));
    } else { ctx.ok(res, []); }
  }
});

router.post('/api/vendor-scorecard/calculate', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const month = body.month || new Date().toISOString().slice(0, 7);
  const monthLike = month + '%';
  const vendors = await ctx.db.prepare('SELECT DISTINCT vendor_name FROM po_header WHERE po_date LIKE ? AND vendor_name IS NOT NULL').all(monthLike);
  const results = [];
  for (const { vendor_name } of vendors) {
    if (!vendor_name) continue;
    const totalPO = (await ctx.db.prepare("SELECT COUNT(*) as cnt FROM po_header WHERE vendor_name=? AND po_date LIKE ? AND status != 'cancelled'").get(vendor_name, monthLike)).cnt;
    const ontimePO = (await ctx.db.prepare("SELECT COUNT(*) as cnt FROM po_header WHERE vendor_name=? AND po_date LIKE ? AND status IN ('received','os_pending') AND (due_date IS NULL OR updated_at <= due_date || ' 23:59:59')").get(vendor_name, monthLike)).cnt;
    const deliveryScore = totalPO > 0 ? Math.round(ontimePO / totalPO * 100) : 100;
    const defectCount = (await ctx.db.prepare("SELECT COUNT(*) as cnt FROM defects WHERE vendor_name=? AND defect_date LIKE ?").get(vendor_name, monthLike)).cnt;
    const qualityScore = Math.max(0, 100 - defectCount * 10);
    const totalScore = Math.round(deliveryScore * 0.5 + qualityScore * 0.4 + 80 * 0.1);
    await ctx.db.prepare(`INSERT OR REPLACE INTO vendor_scorecard (vendor_name, eval_month, delivery_score, quality_score, price_score, total_score, total_po, ontime_po, total_defects) VALUES (?,?,?,?,80,?,?,?,?)`).run(vendor_name, month, deliveryScore, qualityScore, totalScore, totalPO, ontimePO, defectCount);
    results.push({ vendor_name, delivery_score: deliveryScore, quality_score: qualityScore, total_score: totalScore });
  }
  ctx.ok(res, { month, calculated: results.length, results });
});

// ════════════════════════════════════════════════════════════════════
//  PRODUCTION REQUEST (생산요청)
// ════════════════════════════════════════════════════════════════════

router.get('/api/production-requests', async (req, res, parsed) => {
  const status = parsed.searchParams.get('status') || '';
  const type = parsed.searchParams.get('type') || '';
  let where = '1=1';
  const vals = [];
  if (status) { where += ' AND status=?'; vals.push(status); }
  if (type) { where += ' AND product_type=?'; vals.push(type); }
  const rows = await ctx.db.prepare(`SELECT * FROM production_requests WHERE ${where} ORDER BY created_at DESC`).all(...vals);
  const byStatus = await ctx.db.prepare(`SELECT status, COUNT(*) as count FROM production_requests GROUP BY status`).all();
  ctx.ok(res, { list: rows, byStatus });
});

router.post('/api/production-requests', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  if (!body.product_type || !body.product_name) { ctx.fail(res, 400, 'product_type, product_name 필수'); return; }
  const num = 'PR' + new Date().toISOString().slice(2,10).replace(/-/g,'') + '-' + String(Math.floor(Math.random()*10000)).padStart(4,'0');
  const info = ctx.db.prepare(`INSERT INTO production_requests (request_number, product_type, product_name, brand, requested_qty, spec_json, requester, designer, printer_vendor, post_vendor, priority, due_date, notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    num, body.product_type, body.product_name, body.brand || '', body.requested_qty || 0, body.spec_json || '{}',
    body.requester || '', body.designer || '', body.printer_vendor || '', body.post_vendor || '',
    body.priority || 'normal', body.due_date || '', body.notes || ''
  );
  await ctx.db.prepare(`INSERT INTO production_request_logs (request_id, request_number, action, from_status, to_status, actor, details) VALUES (?,?,?,?,?,?,?)`).run(info.lastInsertRowid, num, '생산요청 등록', '', 'requested', body.requester || 'system', `${body.product_name} ${body.requested_qty || 0}부`);
  ctx.ok(res, { id: info.lastInsertRowid, request_number: num });
});

router.getP(/^\/api\/production-requests\/(\d+)$/, async (req, res, parsed, m) => {
  const prId = parseInt(m[1]);
  const pr = await ctx.db.prepare('SELECT * FROM production_requests WHERE id=?').get(prId);
  if (!pr) { ctx.fail(res, 404, '요청 없음'); return; }
  const logs = await ctx.db.prepare('SELECT * FROM production_request_logs WHERE request_id=? ORDER BY created_at ASC').all(prId);
  ctx.ok(res, { ...pr, logs });
});

router.putP(/^\/api\/production-requests\/(\d+)$/, async (req, res, parsed, m) => {
  const prId = parseInt(m[1]);
  const pr = await ctx.db.prepare('SELECT * FROM production_requests WHERE id=?').get(prId);
  if (!pr) { ctx.fail(res, 404, '요청 없음'); return; }
  const body = await ctx.readJSON(req);
  const sets = [], vals = [];
  const allowed = ['product_type','product_name','brand','requested_qty','spec_json','requester','designer','printer_vendor','post_vendor','status','priority','due_date','notes'];
  for (const f of allowed) { if (body[f] !== undefined) { sets.push(`${f}=?`); vals.push(body[f]); } }
  const statusChanged = body.status !== undefined && body.status !== pr.status;
  if (statusChanged) {
    const now = new Date().toISOString().slice(0,19).replace('T',' ');
    if (body.status === 'design_confirmed') { sets.push('design_confirmed_at=?'); vals.push(now); }
    if (body.status === 'data_confirmed') { sets.push('data_confirmed_at=?'); vals.push(now); }
    if (body.status === 'in_production') { sets.push('production_started_at=?'); vals.push(now); }
    if (body.status === 'completed') { sets.push('completed_at=?'); vals.push(now); }
  }
  if (sets.length === 0) { ctx.fail(res, 400, '수정 항목 없음'); return; }
  sets.push("updated_at=datetime('now','localtime')");
  vals.push(prId);
  await ctx.db.prepare(`UPDATE production_requests SET ${sets.join(',')} WHERE id=?`).run(...vals);
  if (statusChanged) {
    const statusNames = { requested:'요청등록', design_confirmed:'디자인확인', data_confirmed:'데이터확인', in_production:'생산진행', completed:'완료', cancelled:'취소' };
    await ctx.db.prepare(`INSERT INTO production_request_logs (request_id, request_number, action, from_status, to_status, actor, details) VALUES (?,?,?,?,?,?,?)`).run(prId, pr.request_number, `상태변경: ${statusNames[body.status] || body.status}`, pr.status, body.status, body.actor || 'system', body.log_details || '');
  }
  ctx.ok(res, { updated: true });
});

router.postP(/^\/api\/production-requests\/(\d+)\/log$/, async (req, res, parsed, m) => {
  const prId = parseInt(m[1]);
  const pr = await ctx.db.prepare('SELECT * FROM production_requests WHERE id=?').get(prId);
  if (!pr) { ctx.fail(res, 404, '요청 없음'); return; }
  const body = await ctx.readJSON(req);
  await ctx.db.prepare(`INSERT INTO production_request_logs (request_id, request_number, action, from_status, to_status, actor, details) VALUES (?,?,?,?,?,?,?)`).run(prId, pr.request_number, body.action || '메모', pr.status, pr.status, body.actor || '', body.details || '');
  ctx.ok(res, { added: true });
});

// ════════════════════════════════════════════════════════════════════
//  PRODUCT SPEC MASTER (제품 스펙)
// ════════════════════════════════════════════════════════════════════

router.get('/api/specs', async (req, res, parsed) => {
  const type = parsed.searchParams.get('type') || '';
  const templateOnly = parsed.searchParams.get('template') === '1';
  let where = '1=1';
  const vals = [];
  if (type) { where += ' AND product_type=?'; vals.push(type); }
  if (templateOnly) { where += ' AND is_template=1'; }
  const rows = await ctx.db.prepare(`SELECT * FROM product_spec_master WHERE ${where} ORDER BY product_type, spec_name`).all(...vals);
  ctx.ok(res, rows);
});

router.post('/api/specs', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  if (!b.spec_name) { ctx.fail(res, 400, 'spec_name 필수'); return; }
  const info = ctx.db.prepare(`INSERT INTO product_spec_master (product_type, spec_name, brand, paper_cover, paper_inner, print_method, print_color, binding, post_process, size, pages, weight, extras, notes, is_template) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    b.product_type||'', b.spec_name, b.brand||'', b.paper_cover||'', b.paper_inner||'', b.print_method||'', b.print_color||'', b.binding||'', b.post_process||'', b.size||'', b.pages||0, b.weight||'', b.extras||'', b.notes||'', b.is_template ? 1 : 0
  );
  ctx.ok(res, { id: info.lastInsertRowid });
});

router.putP(/^\/api\/specs\/(\d+)$/, async (req, res, parsed, m) => {
  const specId = parseInt(m[1]);
  const b = await ctx.readJSON(req);
  const sets = [], vals = [];
  const allowed = ['product_type','spec_name','brand','paper_cover','paper_inner','print_method','print_color','binding','post_process','size','pages','weight','extras','notes','is_template'];
  for (const f of allowed) { if (b[f] !== undefined) { sets.push(`${f}=?`); vals.push(b[f]); } }
  if (!sets.length) { ctx.fail(res, 400, '수정 항목 없음'); return; }
  sets.push("updated_at=datetime('now','localtime')");
  vals.push(specId);
  await ctx.db.prepare(`UPDATE product_spec_master SET ${sets.join(',')} WHERE id=?`).run(...vals);
  ctx.ok(res, { updated: true });
});

router.delP(/^\/api\/specs\/(\d+)$/, async (req, res, parsed, m) => {
  const specId = parseInt(m[1]);
  await ctx.db.prepare('DELETE FROM product_spec_master WHERE id=?').run(specId);
  ctx.ok(res, { deleted: true });
});

// ════════════════════════════════════════════════════════════════════
//  ACCESSORIES (부속품)
// ════════════════════════════════════════════════════════════════════

router.get('/api/accessories', async (req, res, parsed) => {
  const q = parsed.searchParams.get('q');
  const type = parsed.searchParams.get('type');
  let sqlStr = `SELECT a.*, (SELECT COUNT(*) FROM product_accessories pa WHERE pa.acc_id=a.id) AS product_count FROM accessories a WHERE 1=1`;
  const params = [];
  if (q) { sqlStr += ` AND (a.acc_name LIKE ? OR a.acc_code LIKE ?)`; params.push('%'+q+'%','%'+q+'%'); }
  if (type) { sqlStr += ` AND a.acc_type=?`; params.push(type); }
  sqlStr += ` ORDER BY a.acc_type, a.acc_name`;
  ctx.ok(res, await ctx.db.prepare(sqlStr).all(...params));
});

router.post('/api/accessories', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  const info = await ctx.db.prepare(`INSERT INTO accessories (acc_code,acc_name,acc_type,current_stock,min_stock,unit,vendor,memo,origin) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    b.acc_code||'', b.acc_name||'', b.acc_type||'기타', b.current_stock||0, b.min_stock||0, b.unit||'개', b.vendor||'', b.memo||'', b.origin||'한국'
  );
  ctx.ok(res, { id: info.lastInsertRowid });
});

router.putP(/^\/api\/accessories\/(\d+)$/, async (req, res, parsed, m) => {
  const b = await ctx.readJSON(req);
  const id = m[1];
  const fields = [], values = [];
  for (const col of ['acc_code','acc_name','acc_type','current_stock','min_stock','unit','vendor','memo','origin']) {
    if (b[col] !== undefined) { fields.push(`${col}=?`); values.push(b[col]); }
  }
  fields.push(`updated_at=datetime('now','localtime')`);
  values.push(id);
  await ctx.db.prepare(`UPDATE accessories SET ${fields.join(',')} WHERE id=?`).run(...values);
  ctx.ok(res, { updated: true });
});

router.delP(/^\/api\/accessories\/(\d+)$/, async (req, res, parsed, m) => {
  await ctx.db.prepare('DELETE FROM product_accessories WHERE acc_id=?').run(m[1]);
  await ctx.db.prepare('DELETE FROM accessories WHERE id=?').run(m[1]);
  ctx.ok(res, { deleted: true });
});

router.getP(/^\/api\/accessories\/(\d+)\/products$/, async (req, res, parsed, m) => {
  const rows = await ctx.db.prepare(`SELECT p.product_code, p.product_name, pa.qty_per, pa.id AS pa_id FROM product_accessories pa LEFT JOIN products p ON p.product_code=pa.product_code WHERE pa.acc_id=? ORDER BY pa.product_code`).all(m[1]);
  ctx.ok(res, rows);
});

router.getP(/^\/api\/products\/([^/]+)\/accessories$/, async (req, res, parsed, m) => {
  const code = decodeURIComponent(m[1]);
  const rows = await ctx.db.prepare(`SELECT a.*, pa.qty_per, pa.id AS link_id FROM accessories a JOIN product_accessories pa ON a.id=pa.acc_id WHERE pa.product_code=? ORDER BY a.acc_type, a.acc_name`).all(code);
  ctx.ok(res, rows);
});

router.postP(/^\/api\/products\/([^/]+)\/accessories$/, async (req, res, parsed, m) => {
  const code = decodeURIComponent(m[1]);
  const b = await ctx.readJSON(req);
  try {
    const info = await ctx.db.prepare(`INSERT OR REPLACE INTO product_accessories (product_code, acc_id, qty_per) VALUES (?,?,?)`).run(code, b.acc_id, b.qty_per||1);
    ctx.ok(res, { id: info.lastInsertRowid });
  } catch(e) { ctx.fail(res, 400, e.message); }
});

router.delP(/^\/api\/product-accessories\/(\d+)$/, async (req, res, parsed, m) => {
  await ctx.db.prepare('DELETE FROM product_accessories WHERE id=?').run(m[1]);
  ctx.ok(res, { deleted: true });
});

// ════════════════════════════════════════════════════════════════════
//  TASKS (업무관리)
// ════════════════════════════════════════════════════════════════════

router.get('/api/tasks', async (req, res, parsed) => {
  const s = parsed.searchParams.get('status');
  const category = parsed.searchParams.get('category');
  const assignee = parsed.searchParams.get('assignee');
  const priority = parsed.searchParams.get('priority');
  const q = parsed.searchParams.get('q');
  let where = '1=1';
  const vals = [];
  if (s && s !== 'all') { where += ' AND status=?'; vals.push(s); }
  if (category && category !== 'all') { where += ' AND category=?'; vals.push(category); }
  if (assignee) { where += ' AND assignee LIKE ?'; vals.push('%' + assignee + '%'); }
  if (priority && priority !== 'all') { where += ' AND priority=?'; vals.push(priority); }
  if (q) { where += ' AND (title LIKE ? OR description LIKE ?)'; vals.push('%'+q+'%', '%'+q+'%'); }
  const rows = await ctx.db.prepare(`SELECT * FROM tasks WHERE ${where} ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'normal' THEN 3 WHEN 'low' THEN 4 ELSE 5 END, due_date ASC, created_at DESC`).all(...vals);
  ctx.ok(res, rows);
});

router.getP(/^\/api\/tasks\/(\d+)$/, async (req, res, parsed, m) => {
  const row = await ctx.db.prepare('SELECT * FROM tasks WHERE id=?').get(parseInt(m[1]));
  if (!row) { ctx.fail(res, 404, 'Not found'); return; }
  const comments = await ctx.db.prepare('SELECT * FROM task_comments WHERE task_id=? ORDER BY created_at ASC').all(row.id);
  ctx.ok(res, { ...row, comments });
});

router.post('/api/tasks', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  if (!b.title) { ctx.fail(res, 400, 'title 필수'); return; }
  const today = new Date();
  const num = 'TASK-' + today.getFullYear().toString().slice(2) + String(today.getMonth()+1).padStart(2,'0') + String(today.getDate()).padStart(2,'0') + '-' + String((await ctx.db.prepare("SELECT COUNT(*) as c FROM tasks").get()).c + 1).padStart(3,'0');
  const info = ctx.db.prepare(`INSERT INTO tasks (task_number,title,description,category,status,priority,assignee,due_date,start_date,related_po,related_vendor,tags,created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    num, b.title, b.description||'', b.category||'기타', b.status||'todo', b.priority||'normal', b.assignee||'', b.due_date||'', b.start_date||'', b.related_po||'', b.related_vendor||'', b.tags||'', b.created_by||''
  );
  const currentUser = ctx._currentUser;
  if (currentUser) ctx.auditLog(currentUser.userId, currentUser.username, 'task_create', 'tasks', info.lastInsertRowid, `업무 생성: ${b.title}`, ctx.clientIP);
  ctx.ok(res, { id: info.lastInsertRowid, task_number: num });
});

router.putP(/^\/api\/tasks\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  const b = await ctx.readJSON(req);
  const sets = [], vals2 = [];
  ['title','description','category','status','priority','assignee','due_date','start_date','related_po','related_vendor','tags'].forEach(f => {
    if (b[f] !== undefined) { sets.push(`${f}=?`); vals2.push(b[f]); }
  });
  if (b.status === 'done') { sets.push("completed_at=datetime('now','localtime')"); }
  else if (b.status && b.status !== 'done') { sets.push("completed_at=''"); }
  sets.push("updated_at=datetime('now','localtime')");
  vals2.push(id);
  await ctx.db.prepare(`UPDATE tasks SET ${sets.join(',')} WHERE id=?`).run(...vals2);
  const currentUser = ctx._currentUser;
  if (currentUser) ctx.auditLog(currentUser.userId, currentUser.username, 'task_update', 'tasks', id, `업무 수정: ${b.status ? '상태→'+b.status : ''}${b.title ? ' 제목→'+b.title : ''}`, ctx.clientIP);
  ctx.ok(res, { updated: true });
});

router.delP(/^\/api\/tasks\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  await ctx.db.prepare('DELETE FROM task_comments WHERE task_id=?').run(id);
  await ctx.db.prepare('DELETE FROM tasks WHERE id=?').run(id);
  const currentUser = ctx._currentUser;
  if (currentUser) ctx.auditLog(currentUser.userId, currentUser.username, 'task_delete', 'tasks', id, `업무 삭제`, ctx.clientIP);
  ctx.ok(res, { deleted: true });
});

router.getP(/^\/api\/tasks\/(\d+)\/comments$/, async (req, res, parsed, m) => {
  const rows = await ctx.db.prepare('SELECT * FROM task_comments WHERE task_id=? ORDER BY created_at ASC').all(parseInt(m[1]));
  ctx.ok(res, rows);
});

router.postP(/^\/api\/tasks\/(\d+)\/comments$/, async (req, res, parsed, m) => {
  const b = await ctx.readJSON(req);
  if (!b.content) { ctx.fail(res, 400, 'content 필수'); return; }
  const info = await ctx.db.prepare('INSERT INTO task_comments (task_id, author, content) VALUES (?,?,?)').run(parseInt(m[1]), b.author||'', b.content);
  ctx.ok(res, { id: info.lastInsertRowid });
});

router.get('/api/task-templates', async (req, res, parsed) => {
  const templates = ctx.TASK_TEMPLATES || {};
  ctx.ok(res, Object.entries(templates).map(([id, t]) => ({ id, name: t.name, category: t.category, step_count: t.steps.length })));
});

router.postP(/^\/api\/tasks\/(\d+)\/steps\/init$/, async (req, res, parsed, m) => {
  const taskId = parseInt(m[1]);
  const b = await ctx.readJSON(req);
  const templates = ctx.TASK_TEMPLATES || {};
  const tpl = templates[b.template_id];
  if (!tpl) { ctx.fail(res, 400, '템플릿 없음'); return; }
  await ctx.db.prepare('DELETE FROM task_steps WHERE task_id=?').run(taskId);
  const steps = b.custom_steps && b.custom_steps.length ? b.custom_steps : tpl.steps;
  const insert = ctx.db.prepare('INSERT INTO task_steps (task_id, step_order, step_name, step_type) VALUES (?,?,?,?)');
  for (let i = 0; i < steps.length; i++) { const s2 = steps[i]; await insert.run(taskId, i, s2.name, s2.type || 'text'); }
  await ctx.db.prepare("UPDATE tasks SET template_id=? WHERE id=?").run(b.template_id, taskId);
  ctx.ok(res, { created: steps.length });
});

router.getP(/^\/api\/tasks\/(\d+)\/steps$/, async (req, res, parsed, m) => {
  const rows = await ctx.db.prepare('SELECT * FROM task_steps WHERE task_id=? ORDER BY step_order').all(parseInt(m[1]));
  ctx.ok(res, rows);
});

router.putP(/^\/api\/task-steps\/(\d+)$/, async (req, res, parsed, m) => {
  const stepId = parseInt(m[1]);
  const b = await ctx.readJSON(req);
  const sets = [], vals = [];
  if (b.value !== undefined) { sets.push('value=?'); vals.push(b.value); }
  if (b.note !== undefined) { sets.push('note=?'); vals.push(b.note); }
  if (b.is_done !== undefined) {
    sets.push('is_done=?'); vals.push(b.is_done ? 1 : 0);
    sets.push('done_at=?'); vals.push(b.is_done ? new Date().toLocaleString('ko-KR') : '');
  }
  if (!sets.length) { ctx.fail(res, 400, '변경 없음'); return; }
  vals.push(stepId);
  await ctx.db.prepare(`UPDATE task_steps SET ${sets.join(',')} WHERE id=?`).run(...vals);
  const step = await ctx.db.prepare('SELECT task_id FROM task_steps WHERE id=?').get(stepId);
  if (step) {
    const total = (await ctx.db.prepare('SELECT COUNT(*) as c FROM task_steps WHERE task_id=?').get(step.task_id)).c;
    const done = (await ctx.db.prepare("SELECT COUNT(*) as c FROM task_steps WHERE task_id=? AND is_done=1").get(step.task_id)).c;
    if (total > 0 && done === total) {
      await ctx.db.prepare("UPDATE tasks SET status='done', completed_at=datetime('now','localtime') WHERE id=?").run(step.task_id);
    } else if (done > 0) {
      await ctx.db.prepare("UPDATE tasks SET status='in_progress' WHERE id=? AND status='todo'").run(step.task_id);
    }
  }
  ctx.ok(res, { updated: true });
});

// ════════════════════════════════════════════════════════════════════
//  WAREHOUSES (다중 창고 관리)
// ════════════════════════════════════════════════════════════════════

router.get('/api/warehouses', async (req, res, parsed) => {
  const entity = parsed.searchParams.get('entity');
  let sqlStr = "SELECT * FROM warehouses";
  const args = [];
  if (entity === 'barunson' || entity === 'dd') { sqlStr += " WHERE legal_entity=?"; args.push(entity); }
  sqlStr += " ORDER BY is_default DESC, id ASC";
  ctx.ok(res, await ctx.db.prepare(sqlStr).all(...args));
});

router.post('/api/warehouses', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { code, name, location, description, legal_entity } = body;
  if (!code || !name) { ctx.fail(res, 400, '창고코드와 이름은 필수입니다'); return; }
  const entity = (legal_entity === 'dd') ? 'dd' : 'barunson';
  try {
    await ctx.db.prepare("INSERT INTO warehouses (code, name, location, description, legal_entity) VALUES (?, ?, ?, ?, ?)").run(code, name, location || '', description || '', entity);
    ctx.ok(res, { message: '창고 등록 완료' });
  } catch (e) {
    if (e.message.includes('UNIQUE') || e.message.includes('duplicate key') || e.message.includes('unique constraint')) ctx.fail(res, 409, '이미 존재하는 창고코드입니다');
    else ctx.fail(res, 500, e.message);
  }
});

router.putP(/^\/api\/warehouses\/(\d+)$/, async (req, res, parsed, m) => {
  const body = await ctx.readJSON(req);
  const whId = parseInt(m[1]);
  const { name, location, description, status, legal_entity } = body;
  const fields = [], vals = [];
  if (name !== undefined) { fields.push('name=?'); vals.push(name); }
  if (location !== undefined) { fields.push('location=?'); vals.push(location); }
  if (description !== undefined) { fields.push('description=?'); vals.push(description); }
  if (status !== undefined) { fields.push('status=?'); vals.push(status); }
  if (legal_entity !== undefined) { fields.push('legal_entity=?'); vals.push(legal_entity === 'dd' ? 'dd' : 'barunson'); }
  if (fields.length === 0) { ctx.fail(res, 400, '수정할 내용이 없습니다'); return; }
  fields.push("updated_at=datetime('now','localtime')");
  vals.push(whId);
  await ctx.db.prepare(`UPDATE warehouses SET ${fields.join(', ')} WHERE id=?`).run(...vals);
  ctx.ok(res, { message: '창고 수정 완료' });
});

router.delP(/^\/api\/warehouses\/(\d+)$/, async (req, res, parsed, m) => {
  const whId = parseInt(m[1]);
  const wh = await ctx.db.prepare("SELECT * FROM warehouses WHERE id=?").get(whId);
  if (!wh) { ctx.fail(res, 404, '창고를 찾을 수 없습니다'); return; }
  if (wh.is_default) { ctx.fail(res, 400, '기본 창고는 삭제할 수 없습니다'); return; }
  const invCount = await ctx.db.prepare("SELECT COUNT(*) as cnt FROM warehouse_inventory WHERE warehouse_id=? AND quantity>0").get(whId);
  if (invCount.cnt > 0) { ctx.fail(res, 400, '재고가 남아있는 창고는 삭제할 수 없습니다. 먼저 재고를 이동해주세요.'); return; }
  await ctx.db.prepare("DELETE FROM warehouse_inventory WHERE warehouse_id=?").run(whId);
  await ctx.db.prepare("DELETE FROM warehouses WHERE id=?").run(whId);
  ctx.ok(res, { message: '창고 삭제 완료' });
});

router.get('/api/warehouses/inventory', async (req, res, parsed) => {
  const warehouseId = parsed.searchParams.get('warehouse_id');
  const search = parsed.searchParams.get('search') || '';
  let rows;
  if (warehouseId) {
    let sqlStr = `SELECT wi.*, w.name as warehouse_name, w.code as warehouse_code FROM warehouse_inventory wi JOIN warehouses w ON wi.warehouse_id=w.id WHERE wi.warehouse_id=?`;
    const args = [warehouseId];
    if (search) { sqlStr += " AND (wi.product_code LIKE ? OR wi.product_name LIKE ?)"; args.push(`%${search}%`, `%${search}%`); }
    sqlStr += " ORDER BY wi.product_code";
    rows = await ctx.db.prepare(sqlStr).all(...args);
  } else {
    let sqlStr = `SELECT wi.product_code, wi.product_name, SUM(wi.quantity) as total_qty, GROUP_CONCAT(w.name || ':' || wi.quantity, ' | ') as breakdown FROM warehouse_inventory wi JOIN warehouses w ON wi.warehouse_id=w.id`;
    const args = [];
    if (search) { sqlStr += " WHERE wi.product_code LIKE ? OR wi.product_name LIKE ?"; args.push(`%${search}%`, `%${search}%`); }
    sqlStr += " GROUP BY wi.product_code, wi.product_name ORDER BY wi.product_code";
    rows = await ctx.db.prepare(sqlStr).all(...args);
  }
  ctx.ok(res, rows);
});

router.post('/api/warehouses/inventory', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { warehouse_id, product_code, product_name, quantity } = body;
  if (!warehouse_id || !product_code) { ctx.fail(res, 400, '창고ID와 제품코드는 필수입니다'); return; }
  const qty = parseInt(quantity) || 0;
  const existing = await ctx.db.prepare("SELECT * FROM warehouse_inventory WHERE warehouse_id=? AND product_code=?").get(warehouse_id, product_code);
  if (existing) {
    await ctx.db.prepare("UPDATE warehouse_inventory SET quantity=?, product_name=?, updated_at=datetime('now','localtime') WHERE id=?").run(qty, product_name || existing.product_name, existing.id);
  } else {
    await ctx.db.prepare("INSERT INTO warehouse_inventory (warehouse_id, product_code, product_name, quantity) VALUES (?, ?, ?, ?)").run(warehouse_id, product_code, product_name || '', qty);
  }
  ctx.ok(res, { message: '재고 저장 완료' });
});

router.post('/api/warehouses/inventory/bulk', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { warehouse_id, items } = body;
  if (!warehouse_id || !Array.isArray(items)) { ctx.fail(res, 400, '창고ID와 items 배열 필수'); return; }
  const upsert = ctx.db.prepare(`INSERT INTO warehouse_inventory (warehouse_id, product_code, product_name, quantity) VALUES (?, ?, ?, ?) ON CONFLICT(warehouse_id, product_code) DO UPDATE SET quantity=excluded.quantity, product_name=excluded.product_name, updated_at=datetime('now','localtime')`);
  const tx = ctx.db.transaction(async (list) => { let cnt = 0; for (const it of list) { await upsert.run(warehouse_id, it.product_code, it.product_name || '', parseInt(it.quantity) || 0); cnt++; } return cnt; });
  const count = await tx(items);
  ctx.ok(res, { message: `${count}건 저장 완료` });
});

router.post('/api/warehouses/transfer', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { from_warehouse, to_warehouse, product_code, product_name, quantity, operator, memo } = body;
  if (!from_warehouse || !to_warehouse || !product_code || !quantity) { ctx.fail(res, 400, '출발창고, 도착창고, 제품코드, 수량은 필수입니다'); return; }
  if (from_warehouse === to_warehouse) { ctx.fail(res, 400, '같은 창고로는 이동할 수 없습니다'); return; }
  const qty = parseInt(quantity);
  if (qty <= 0) { ctx.fail(res, 400, '이동 수량은 1 이상이어야 합니다'); return; }
  const fromInv = await ctx.db.prepare("SELECT * FROM warehouse_inventory WHERE warehouse_id=? AND product_code=?").get(from_warehouse, product_code);
  if (!fromInv || fromInv.quantity < qty) { ctx.fail(res, 400, `출발 창고 재고 부족 (현재: ${fromInv ? fromInv.quantity : 0})`); return; }
  const fromWh = await ctx.db.prepare("SELECT name FROM warehouses WHERE id=?").get(from_warehouse);
  const toWh = await ctx.db.prepare("SELECT name FROM warehouses WHERE id=?").get(to_warehouse);
  const now = new Date().toISOString().slice(0, 10);
  const autoMemo = memo || `${now} ${qty}개 ${fromWh ? fromWh.name : ''}→${toWh ? toWh.name : ''}`;
  const tx = ctx.db.transaction(async () => {
    const fromMemo = `${now} ${qty}개 출고→${toWh ? toWh.name : ''}`;
    await ctx.db.prepare("UPDATE warehouse_inventory SET quantity=quantity-?, memo=?, updated_at=datetime('now','localtime') WHERE warehouse_id=? AND product_code=?").run(qty, fromMemo, from_warehouse, product_code);
    const toMemo = `${now} ${qty}개 입고←${fromWh ? fromWh.name : ''}`;
    const toInv = await ctx.db.prepare("SELECT * FROM warehouse_inventory WHERE warehouse_id=? AND product_code=?").get(to_warehouse, product_code);
    if (toInv) {
      await ctx.db.prepare("UPDATE warehouse_inventory SET quantity=quantity+?, memo=?, updated_at=datetime('now','localtime') WHERE warehouse_id=? AND product_code=?").run(qty, toMemo, to_warehouse, product_code);
    } else {
      await ctx.db.prepare("INSERT INTO warehouse_inventory (warehouse_id, product_code, product_name, quantity, memo) VALUES (?, ?, ?, ?, ?)").run(to_warehouse, product_code, product_name || fromInv.product_name || '', qty, toMemo);
    }
    await ctx.db.prepare("INSERT INTO warehouse_transfers (from_warehouse, to_warehouse, product_code, product_name, quantity, operator, memo) VALUES (?, ?, ?, ?, ?, ?, ?)").run(from_warehouse, to_warehouse, product_code, product_name || fromInv.product_name || '', qty, operator || '', autoMemo);
  });
  await tx();
  ctx.ok(res, { message: `${qty}개 이동 완료` });
});

router.post('/api/warehouses/adjust', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { warehouse_id, product_code, product_name, new_quantity, reason, operator } = body;
  if (!warehouse_id || !product_code || new_quantity === undefined) { ctx.fail(res, 400, '창고ID, 제품코드, 조정수량은 필수입니다'); return; }
  const newQty = parseInt(new_quantity);
  const existing = await ctx.db.prepare("SELECT * FROM warehouse_inventory WHERE warehouse_id=? AND product_code=?").get(warehouse_id, product_code);
  const beforeQty = existing ? existing.quantity : 0;
  const diff = newQty - beforeQty;
  const adjType = diff > 0 ? 'increase' : diff < 0 ? 'decrease' : 'no_change';
  const tx = ctx.db.transaction(async () => {
    if (existing) { await ctx.db.prepare("UPDATE warehouse_inventory SET quantity=?, updated_at=datetime('now','localtime') WHERE id=?").run(newQty, existing.id); }
    else { await ctx.db.prepare("INSERT INTO warehouse_inventory (warehouse_id, product_code, product_name, quantity) VALUES (?, ?, ?, ?)").run(warehouse_id, product_code, product_name || '', newQty); }
    await ctx.db.prepare("INSERT INTO warehouse_adjustments (warehouse_id, product_code, product_name, adj_type, before_qty, after_qty, diff_qty, reason, operator) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)").run(warehouse_id, product_code, product_name || (existing ? existing.product_name : ''), adjType, beforeQty, newQty, diff, reason || '', operator || '');
  });
  await tx();
  ctx.ok(res, { message: `재고 조정 완료 (${beforeQty} → ${newQty}, ${diff > 0 ? '+' : ''}${diff})` });
});

// ════════════════════════════════════════════════════════════════════
//  WORK ORDERS (작업지시)
// ════════════════════════════════════════════════════════════════════

router.get('/api/work-orders', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const status = qs.get('status') || '';
  const search = qs.get('search') || '';
  let where = '1=1';
  if (status) where += " AND status = '" + status.replace(/'/g, '') + "'";
  if (search) where += " AND (wo_number LIKE '%" + search.replace(/'/g, '') + "%' OR product_name LIKE '%" + search.replace(/'/g, '') + "%')";
  const orders = await ctx.db.prepare(`SELECT * FROM work_orders WHERE ${where} ORDER BY created_at DESC LIMIT 200`).all();
  const summary = await ctx.db.prepare(`SELECT status, COUNT(*) AS cnt FROM work_orders GROUP BY status`).all();
  const statusMap = {}; summary.forEach(s2 => { statusMap[s2.status] = s2.cnt; });
  ctx.ok(res, { orders, summary: statusMap, total: orders.length });
});

router.post('/api/work-orders', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const body = await ctx.readJSON(req);
  const now = new Date();
  const woNum = 'WO' + now.getFullYear().toString().slice(2) + String(now.getMonth()+1).padStart(2,'0') + String(now.getDate()).padStart(2,'0') + '-' + String(Math.floor(Math.random()*9999)).padStart(4,'0');
  const result = await ctx.db.prepare(`INSERT INTO work_orders (wo_number, request_id, product_code, product_name, brand, ordered_qty, status, priority, start_date, due_date, printer_vendor, post_vendor, paper_type, notes, created_by) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
    woNum, body.request_id||null, body.product_code||'', body.product_name||'', body.brand||'', body.ordered_qty||0, 'planned', body.priority||'normal', body.start_date||now.toISOString().slice(0,10), body.due_date||'', body.printer_vendor||'', body.post_vendor||'', body.paper_type||'', body.notes||'', decoded.username||'');
  await ctx.db.prepare(`INSERT INTO work_order_logs (wo_id, wo_number, action, to_status, actor, details) VALUES (?,?,?,?,?,?)`).run(result.lastInsertRowid, woNum, 'created', 'planned', decoded.username||'', '작업지시 생성');
  ctx.ok(res, { wo_id: result.lastInsertRowid, wo_number: woNum });
});

router.getP(/^\/api\/work-orders\/(\d+)$/, async (req, res, parsed, m) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const id = parseInt(m[1]);
  const wo = await ctx.db.prepare('SELECT * FROM work_orders WHERE wo_id = ?').get(id);
  if (!wo) { ctx.fail(res, 404, '작업지시 없음'); return; }
  const logs = await ctx.db.prepare('SELECT * FROM work_order_logs WHERE wo_id = ? ORDER BY created_at DESC').all(id);
  ctx.ok(res, { order: wo, logs });
});

router.putP(/^\/api\/work-orders\/(\d+)$/, async (req, res, parsed, m) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const id = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  const wo = await ctx.db.prepare('SELECT * FROM work_orders WHERE wo_id = ?').get(id);
  if (!wo) { ctx.fail(res, 404, '작업지시 없음'); return; }
  const oldStatus = wo.status;
  const updates = [], params = [];
  if (body.status) { updates.push('status=?'); params.push(body.status); }
  if (body.produced_qty !== undefined) { updates.push('produced_qty=?'); params.push(body.produced_qty); }
  if (body.defect_qty !== undefined) { updates.push('defect_qty=?'); params.push(body.defect_qty); }
  if (body.cost_material !== undefined) { updates.push('cost_material=?'); params.push(body.cost_material); }
  if (body.cost_labor !== undefined) { updates.push('cost_labor=?'); params.push(body.cost_labor); }
  if (body.cost_overhead !== undefined) { updates.push('cost_overhead=?'); params.push(body.cost_overhead); }
  if (body.notes !== undefined) { updates.push('notes=?'); params.push(body.notes); }
  if (body.status === 'in_progress' && !wo.start_date) { updates.push("start_date=date('now','localtime')"); }
  if (body.status === 'completed') { updates.push("completed_date=datetime('now','localtime')"); }
  const cm = body.cost_material !== undefined ? body.cost_material : wo.cost_material;
  const cl = body.cost_labor !== undefined ? body.cost_labor : wo.cost_labor;
  const co = body.cost_overhead !== undefined ? body.cost_overhead : wo.cost_overhead;
  updates.push('cost_total=?'); params.push((cm||0) + (cl||0) + (co||0));
  updates.push("updated_at=datetime('now','localtime')");
  params.push(id);
  if (updates.length > 1) { await ctx.db.prepare(`UPDATE work_orders SET ${updates.join(',')} WHERE wo_id=?`).run(...params); }
  let action = 'updated', details = '';
  if (body.status && body.status !== oldStatus) { action = 'status_change'; details = oldStatus + ' → ' + body.status; }
  else if (body.produced_qty !== undefined) { action = 'production_report'; details = '생산수량: ' + body.produced_qty + ', 불량: ' + (body.defect_qty||0); }
  else if (body.cost_material !== undefined || body.cost_labor !== undefined) { action = 'cost_update'; details = '원가 업데이트'; }
  await ctx.db.prepare(`INSERT INTO work_order_logs (wo_id, wo_number, action, from_status, to_status, qty_change, actor, details) VALUES (?,?,?,?,?,?,?,?)`).run(id, wo.wo_number, action, oldStatus, body.status||oldStatus, body.produced_qty||0, decoded.username||'', details);
  ctx.ok(res, { message: '업데이트 완료' });
});

router.get('/api/work-orders/stats', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const statusSummary = await ctx.db.prepare(`SELECT status, COUNT(*) AS cnt, SUM(ordered_qty) AS total_ordered, SUM(produced_qty) AS total_produced, SUM(defect_qty) AS total_defect, SUM(cost_total) AS total_cost FROM work_orders GROUP BY status`).all();
  const monthlyOrders = await ctx.db.prepare(`SELECT TO_CHAR(created_at::timestamp, 'YYYY-MM') AS ym, COUNT(*) AS cnt, SUM(ordered_qty) AS total_qty FROM work_orders GROUP BY TO_CHAR(created_at::timestamp, 'YYYY-MM') ORDER BY ym DESC LIMIT 12`).all();
  const recentCompleted = await ctx.db.prepare(`SELECT * FROM work_orders WHERE status='completed' ORDER BY completed_date DESC LIMIT 10`).all();
  ctx.ok(res, { statusSummary, monthlyOrders, recentCompleted });
});

router.get('/api/work-orders/daily-report', async (req, res, parsed) => {
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const date = qs.get('date') || new Date().toISOString().slice(0,10);
  const rows = await ctx.db.prepare("SELECT r.*, w.wo_number, w.product_name FROM work_order_results r JOIN work_orders w ON w.wo_id=r.work_order_id WHERE r.result_date=? ORDER BY r.created_at DESC").all(date);
  const summary = await ctx.db.prepare("SELECT COUNT(*) AS cnt, COALESCE(SUM(good_qty),0) AS good, COALESCE(SUM(defect_qty),0) AS defect, COALESCE(SUM(work_hours),0) AS hours FROM work_order_results WHERE result_date=?").get(date);
  ctx.ok(res, { total_good: summary.good, total_defect: summary.defect, total_hours: summary.hours, order_count: summary.cnt, results: rows });
});

router.postP(/^\/api\/work-orders\/(\d+)\/result$/, async (req, res, parsed, m) => {
  const woid = m[1];
  const body = await ctx.readJSON(req);
  await ctx.db.prepare("INSERT INTO work_order_results (work_order_id,result_date,good_qty,defect_qty,worker_name,work_hours,notes) VALUES (?,?,?,?,?,?,?)").run(
    woid, body.result_date||new Date().toISOString().slice(0,10), body.good_qty||0, body.defect_qty||0, body.worker_name||'', body.work_hours||0, body.notes||'');
  const totals = await ctx.db.prepare("SELECT COALESCE(SUM(good_qty),0) AS good, COALESCE(SUM(defect_qty),0) AS defect FROM work_order_results WHERE work_order_id=?").get(woid);
  await ctx.db.prepare("UPDATE work_orders SET produced_qty=?, defect_qty=?, updated_at=datetime('now','localtime') WHERE wo_id=?").run(totals.good, totals.defect, woid);
  ctx.ok(res, { saved: true, total_good: totals.good, total_defect: totals.defect });
});

router.getP(/^\/api\/work-orders\/(\d+)\/results$/, async (req, res, parsed, m) => {
  const rows = await ctx.db.prepare("SELECT * FROM work_order_results WHERE work_order_id=? ORDER BY result_date DESC").all(m[1]);
  ctx.ok(res, rows);
});

// ════════════════════════════════════════════════════════════════════
//  SAFETY STOCK + CYCLE COUNT
// ════════════════════════════════════════════════════════════════════

router.get('/api/safety-stock', async (req, res, parsed) => {
  const rules = await ctx.db.prepare("SELECT * FROM safety_stock_rules ORDER BY product_code").all();
  const result = await Promise.all(rules.map(async r => {
    const stock = await ctx.db.prepare("SELECT COALESCE(SUM(current_qty),0) AS qty FROM batch_master WHERE product_code=? AND quality_status='GOOD'").get(r.product_code);
    return { ...r, current_qty: stock ? stock.qty : 0, is_below: stock ? stock.qty < r.min_qty : false };
  }));
  ctx.ok(res, result);
});

router.post('/api/safety-stock', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const items = body.items || [body];
  const upsert = ctx.db.prepare("INSERT INTO safety_stock_rules (product_code,product_name,min_qty,reorder_qty,reorder_point,lead_time_days,warehouse,auto_po,vendor_name) VALUES (?,?,?,?,?,?,?,?,?) ON CONFLICT(product_code) DO UPDATE SET product_name=excluded.product_name, min_qty=excluded.min_qty, reorder_qty=excluded.reorder_qty, reorder_point=excluded.reorder_point, lead_time_days=excluded.lead_time_days, warehouse=excluded.warehouse, auto_po=excluded.auto_po, vendor_name=excluded.vendor_name, updated_at=datetime('now','localtime')");
  for (const it of items) { await upsert.run(it.product_code, it.product_name||'', it.min_qty||0, it.reorder_qty||0, it.reorder_point||0, it.lead_time_days||7, it.warehouse||'', it.auto_po?1:0, it.vendor_name||''); }
  ctx.ok(res, { saved: items.length });
});

router.post('/api/safety-stock/check', async (req, res, parsed) => {
  const rules = await ctx.db.prepare("SELECT * FROM safety_stock_rules").all();
  const alerts = [];
  for (const r of rules) {
    const stock = await ctx.db.prepare("SELECT COALESCE(SUM(current_qty),0) AS qty FROM batch_master WHERE product_code=? AND quality_status='GOOD'").get(r.product_code);
    const qty = stock ? stock.qty : 0;
    if (qty <= r.reorder_point || qty < r.min_qty) {
      alerts.push({ product_code: r.product_code, product_name: r.product_name, current_qty: qty, min_qty: r.min_qty, reorder_point: r.reorder_point, shortage: r.min_qty - qty });
      ctx.createNotification(null, 'alert', '안전재고 부족: ' + (r.product_name||r.product_code), r.product_code + ' 현재 ' + qty + '개 (최소 ' + r.min_qty + '개)', 'safety-stock');
    }
  }
  ctx.ok(res, { checked: rules.length, alerts });
});

router.post('/api/safety-stock/import-from-xerp', async (req, res, parsed) => {
  try {
    const pool = await ctx.ensureXerpPool();
    const r = await pool.request().query(`SELECT RTRIM(ItemCode) AS code, RTRIM(ItemName) AS name, OhQty FROM mmInventory WITH(NOLOCK) WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND OhQty > 0`);
    const upsert = ctx.db.prepare("INSERT OR IGNORE INTO safety_stock_rules (product_code,product_name,min_qty,reorder_qty,reorder_point) VALUES (?,?,?,?,?)");
    let cnt = 0;
    for (const row of r.recordset||[]) {
      const minQ = Math.max(1, Math.round(row.OhQty * 0.3));
      await upsert.run(row.code, row.name, minQ, Math.round(row.OhQty * 0.5), Math.round(row.OhQty * 0.4));
      cnt++;
    }
    ctx.ok(res, { imported: cnt });
  } catch(e) { ctx.fail(res, 503, 'XERP 연결 실패: ' + e.message); }
});

router.get('/api/cycle-count', async (req, res, parsed) => {
  const plans = await ctx.db.prepare("SELECT * FROM cycle_count_plans ORDER BY created_at DESC").all();
  const result = await Promise.all(plans.map(async p => {
    const items = await ctx.db.prepare("SELECT COUNT(*) AS total, SUM(CASE WHEN counted_qty IS NOT NULL THEN 1 ELSE 0 END) AS counted, SUM(ABS(variance)) AS total_variance FROM cycle_count_items WHERE plan_id=?").get(p.id);
    return { ...p, item_count: items.total||0, counted_count: items.counted||0, total_variance: items.total_variance||0 };
  }));
  ctx.ok(res, result);
});

router.post('/api/cycle-count', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const planNo = 'CC-' + new Date().toISOString().slice(0,10).replace(/-/g,'') + '-' + String(Math.floor(Math.random()*900)+100);
  const r = await ctx.db.prepare("INSERT INTO cycle_count_plans (plan_no,plan_date,warehouse,note,created_by) VALUES (?,?,?,?,?)").run(planNo, body.plan_date||new Date().toISOString().slice(0,10), body.warehouse||'', body.note||'', body.created_by||'');
  const planId = r.lastInsertRowid;
  const stocks = await ctx.db.prepare("SELECT product_code, product_name, COALESCE(SUM(current_qty),0) AS sys_qty FROM batch_master WHERE current_qty > 0 " + (body.warehouse ? "AND warehouse=?" : "") + " GROUP BY product_code").all(...(body.warehouse ? [body.warehouse] : []));
  const ins = ctx.db.prepare("INSERT INTO cycle_count_items (plan_id,product_code,product_name,system_qty) VALUES (?,?,?,?)");
  for (const s2 of stocks) { await ins.run(planId, s2.product_code, s2.product_name, s2.sys_qty); }
  ctx.ok(res, { plan_id: planId, plan_no: planNo, items: stocks.length });
});

router.getP(/^\/api\/cycle-count\/(\d+)$/, async (req, res, parsed, m) => {
  const id = m[1];
  const plan = await ctx.db.prepare("SELECT * FROM cycle_count_plans WHERE id=?").get(id);
  if (!plan) { ctx.fail(res, 404, 'Not Found'); return; }
  const items = await ctx.db.prepare("SELECT * FROM cycle_count_items WHERE plan_id=? ORDER BY product_code").all(id);
  ctx.ok(res, { ...plan, items });
});

router.postP(/^\/api\/cycle-count\/(\d+)\/count$/, async (req, res, parsed, m) => {
  const id = m[1];
  const body = await ctx.readJSON(req);
  const items = body.items || [];
  const upd = ctx.db.prepare("UPDATE cycle_count_items SET counted_qty=?, variance=?-system_qty, note=? WHERE plan_id=? AND product_code=?");
  for (const it of items) { await upd.run(it.counted_qty, it.counted_qty, it.note||'', id, it.product_code); }
  ctx.ok(res, { updated: items.length });
});

router.postP(/^\/api\/cycle-count\/(\d+)\/complete$/, async (req, res, parsed, m) => {
  const id = m[1];
  const items = await ctx.db.prepare("SELECT * FROM cycle_count_items WHERE plan_id=? AND counted_qty IS NOT NULL AND variance != 0").all(id);
  for (const it of items) {
    const batch = await ctx.db.prepare("SELECT batch_id, current_qty FROM batch_master WHERE product_code=? AND quality_status='GOOD' ORDER BY received_date DESC LIMIT 1").get(it.product_code);
    if (batch) {
      const newQty = batch.current_qty + it.variance;
      await ctx.db.prepare("UPDATE batch_master SET current_qty=?, updated_at=datetime('now','localtime') WHERE batch_id=?").run(Math.max(0, newQty), batch.batch_id);
      await ctx.db.prepare("INSERT INTO batch_transactions (batch_id,batch_number,txn_type,txn_date,product_code,qty,qty_before,qty_after,reference_no,actor,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?)").run(batch.batch_id, '', 'adjust', new Date().toISOString().slice(0,10), it.product_code, Math.abs(it.variance), batch.current_qty, Math.max(0, newQty), 'CC-'+id, '', '재고실사 조정');
      await ctx.db.prepare("UPDATE cycle_count_items SET adjusted=1 WHERE id=?").run(it.id);
    }
  }
  await ctx.db.prepare("UPDATE cycle_count_plans SET status='completed', completed_at=datetime('now','localtime') WHERE id=?").run(id);
  ctx.createNotification(null, 'system', '재고실사 완료', 'CC-'+id+' 실사 완료, '+items.length+'건 조정', 'cycle-count');
  ctx.ok(res, { adjusted: items.length });
});

// ════════════════════════════════════════════════════════════════════
//  MFG COST (제조원가)
// ════════════════════════════════════════════════════════════════════

router.get('/api/mfg-cost/rates', async (req, res, parsed) => {
  const rates = await ctx.db.prepare("SELECT * FROM cost_rates ORDER BY rate_type, rate_key").all();
  ctx.ok(res, rates);
});

router.post('/api/mfg-cost/rates', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const items = body.items || [body];
  const upsert = ctx.db.prepare("INSERT INTO cost_rates (rate_type,rate_key,rate_value,unit,notes) VALUES (?,?,?,?,?) ON CONFLICT(rate_type,rate_key) DO UPDATE SET rate_value=excluded.rate_value, unit=excluded.unit, notes=excluded.notes, updated_at=NOW()");
  for (const it of items) { await upsert.run(it.rate_type, it.rate_key, it.rate_value||0, it.unit||'', it.notes||''); }
  ctx.ok(res, { saved: items.length });
});

router.get('/api/mfg-cost/cards', async (req, res, parsed) => {
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const from = qs.get('from') || new Date(Date.now()-90*86400000).toISOString().slice(0,10);
  const cards = await ctx.db.prepare("SELECT * FROM mfg_cost_cards WHERE calc_date >= ? ORDER BY calc_date DESC, product_code").all(from);
  ctx.ok(res, cards);
});

router.get('/api/mfg-cost/summary', async (req, res, parsed) => {
  const latest = await ctx.db.prepare(`SELECT product_code, MAX(product_name) AS product_name, MAX(calc_date) AS calc_date, MAX(material_cost) AS material_cost, MAX(labor_cost) AS labor_cost, MAX(overhead_cost) AS overhead_cost, MAX(outsource_cost) AS outsource_cost, MAX(total_cost) AS total_cost, MAX(unit_cost) AS unit_cost, MAX(qty) AS qty FROM mfg_cost_cards GROUP BY product_code ORDER BY MAX(product_name)`).all();
  const totals = await ctx.db.prepare(`SELECT COALESCE(SUM(material_cost),0) AS material, COALESCE(SUM(labor_cost),0) AS labor, COALESCE(SUM(overhead_cost),0) AS overhead, COALESCE(SUM(outsource_cost),0) AS outsource, COALESCE(SUM(total_cost),0) AS total FROM (SELECT product_code, MAX(material_cost) AS material_cost, MAX(labor_cost) AS labor_cost, MAX(overhead_cost) AS overhead_cost, MAX(outsource_cost) AS outsource_cost, MAX(total_cost) AS total_cost FROM mfg_cost_cards WHERE calc_date = (SELECT MAX(calc_date) FROM mfg_cost_cards c2 WHERE c2.product_code=mfg_cost_cards.product_code) GROUP BY product_code) sub`).get();
  ctx.ok(res, { cards: latest, totals: totals||{} });
});

router.post('/api/mfg-cost/calculate-all', async (req, res, parsed) => {
  const boms = await ctx.db.prepare("SELECT product_code, product_name FROM bom_header").all();
  let calculated = 0;
  const laborRate = (await ctx.db.prepare("SELECT rate_value FROM cost_rates WHERE rate_type='labor' AND rate_key='default'").get()||{}).rate_value || 25000;
  const overheadRate = (await ctx.db.prepare("SELECT rate_value FROM cost_rates WHERE rate_type='overhead' AND rate_key='rate'").get()||{}).rate_value || 15;
  const calcDate = new Date().toISOString().slice(0,10);
  const tx = ctx.db.transaction(async () => {
    for (const bom of boms) {
      const items = await ctx.db.prepare("SELECT * FROM bom_items WHERE bom_id=(SELECT bom_id FROM bom_header WHERE product_code=?)").all(bom.product_code);
      let mat = 0, out = 0;
      for (const it of items) {
        if (it.item_type === 'material') { const p = await ctx.db.prepare("SELECT apply_price FROM material_prices WHERE product_code=? ORDER BY apply_month DESC LIMIT 1").get(it.material_code||it.product_code); mat += (p ? p.apply_price : 0) * (it.qty_per||1); }
        else if (it.item_type === 'process') { const p = await ctx.db.prepare("SELECT unit_price FROM post_process_price WHERE vendor_name=? AND process_type=? ORDER BY effective_from DESC LIMIT 1").get(it.vendor_name||'', it.process_type||''); out += (p ? p.unit_price : 0) * (it.qty_per||1); }
      }
      const wo = await ctx.db.prepare("SELECT COALESCE(SUM(work_hours),0) AS h, COALESCE(SUM(good_qty),0) AS g FROM work_order_results r JOIN work_orders w ON w.wo_id=r.work_order_id WHERE w.product_code=?").get(bom.product_code);
      const lab = wo && wo.g > 0 ? (wo.h/wo.g)*laborRate : laborRate*0.5;
      const oh = (mat+lab)*overheadRate/100;
      const total = mat+lab+oh+out;
      await ctx.db.prepare("INSERT INTO mfg_cost_cards (product_code,product_name,calc_date,material_cost,labor_cost,overhead_cost,outsource_cost,total_cost,unit_cost,qty,source) VALUES (?,?,?,?,?,?,?,?,?,1,'batch') ON CONFLICT(product_code,calc_date) DO UPDATE SET material_cost=excluded.material_cost, labor_cost=excluded.labor_cost, overhead_cost=excluded.overhead_cost, outsource_cost=excluded.outsource_cost, total_cost=excluded.total_cost, unit_cost=excluded.unit_cost").run(bom.product_code, bom.product_name, calcDate, mat, lab, oh, out, total, Math.round(total));
      calculated++;
    }
  });
  await tx();
  ctx.ok(res, { calculated });
});

// ════════════════════════════════════════════════════════════════════
//  RBAC (권한관리)
// ════════════════════════════════════════════════════════════════════

router.get('/api/rbac/roles', async (req, res, parsed) => {
  const roles = (await ctx.db.prepare("SELECT DISTINCT role FROM role_permissions ORDER BY role").all()).map(r => r.role);
  const result = await Promise.all(roles.map(async role => {
    const perms = await ctx.db.prepare("SELECT permission, resource FROM role_permissions WHERE role=? AND granted=1").all(role);
    const userCount = (await ctx.db.prepare("SELECT COUNT(*) AS c FROM users WHERE role=?").get(role)||{}).c||0;
    return { role, permissions: perms, user_count: userCount };
  }));
  ctx.ok(res, result);
});

router.post('/api/rbac/roles', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  if (!body.role) { ctx.fail(res, 400, 'role 필수'); return; }
  await ctx.db.prepare("DELETE FROM role_permissions WHERE role=?").run(body.role);
  const ins = ctx.db.prepare("INSERT INTO role_permissions (role,permission,resource) VALUES (?,?,?)");
  for (const p of (body.permissions || [])) { await ins.run(body.role, p.permission||'read', p.resource||'*'); }
  ctx.ok(res, { saved: true });
});

router.get('/api/rbac/permissions', async (req, res, parsed) => {
  const resources = (ctx.ALL_PAGES || []).map(p => p.id);
  const permissions = ['read', 'write', 'delete', 'approve', 'export'];
  ctx.ok(res, { resources, permissions });
});

router.get('/api/rbac/user-permissions', async (req, res, parsed) => {
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const userId = qs.get('user_id');
  if (!userId) { ctx.fail(res, 400, 'user_id 필수'); return; }
  const user = await ctx.db.prepare("SELECT user_id, username, display_name, role FROM users WHERE user_id=?").get(userId);
  if (!user) { ctx.fail(res, 404, 'User not found'); return; }
  const perms = await ctx.db.prepare("SELECT permission, resource FROM role_permissions WHERE role=? AND granted=1").all(user.role);
  ctx.ok(res, { user, permissions: perms });
});

router.post('/api/rbac/check', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const perms = await ctx.db.prepare("SELECT * FROM role_permissions WHERE role=? AND granted=1 AND (resource=? OR resource='*') AND (permission=? OR permission='*')").get(body.role||'', body.resource||'', body.permission||'read');
  ctx.ok(res, { allowed: !!perms });
});

// ════════════════════════════════════════════════════════════════════
//  PROCESS ROUTING + EQUIPMENT
// ════════════════════════════════════════════════════════════════════

router.get('/api/process-routing', async (req, res, parsed) => {
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const productCode = qs.get('product_code');
  if (productCode) {
    const routes = await ctx.db.prepare("SELECT r.*, e.eq_name FROM process_routing r LEFT JOIN equipment e ON e.id=r.equipment_id WHERE r.product_code=? ORDER BY r.step_no").all(productCode);
    ctx.ok(res, routes);
  } else {
    const all = await ctx.db.prepare("SELECT product_code, COUNT(*) AS step_count, GROUP_CONCAT(process_name,' → ') AS flow FROM process_routing GROUP BY product_code ORDER BY product_code").all();
    ctx.ok(res, all);
  }
});

router.post('/api/process-routing', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  if (!body.product_code || !body.steps) { ctx.fail(res, 400, 'product_code, steps 필수'); return; }
  await ctx.db.prepare("DELETE FROM process_routing WHERE product_code=?").run(body.product_code);
  const ins = ctx.db.prepare("INSERT INTO process_routing (product_code,step_no,process_name,process_type,equipment_id,vendor_name,std_time_min,setup_time_min,notes) VALUES (?,?,?,?,?,?,?,?,?)");
  for (let i = 0; i < body.steps.length; i++) { const s2 = body.steps[i]; await ins.run(body.product_code, i+1, s2.process_name, s2.process_type||'internal', s2.equipment_id||null, s2.vendor_name||'', s2.std_time_min||0, s2.setup_time_min||0, s2.notes||''); }
  ctx.ok(res, { saved: body.steps.length });
});

router.post('/api/process-routing/import-from-bom', async (req, res, parsed) => {
  const boms = await ctx.db.prepare("SELECT DISTINCT bom_id, product_code FROM bom_header").all();
  let imported = 0;
  const ins = ctx.db.prepare("INSERT OR IGNORE INTO process_routing (product_code,step_no,process_name,process_type,vendor_name,std_time_min) VALUES (?,?,?,?,?,?)");
  for (const b of boms) {
    const procs = await ctx.db.prepare("SELECT * FROM bom_items WHERE bom_id=? AND item_type='process' ORDER BY sort_order").all(b.bom_id);
    for (let i = 0; i < procs.length; i++) {
      const p = procs[i];
      await ins.run(b.product_code, i+1, p.process_type||p.material_name||'공정'+(i+1), p.vendor_name?'outsource':'internal', p.vendor_name||'', 30);
      imported++;
    }
  }
  ctx.ok(res, { imported });
});

router.post('/api/process-results', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  await ctx.db.prepare("INSERT INTO process_results (wo_id,routing_id,step_no,process_name,equipment_id,start_time,end_time,good_qty,defect_qty,worker_name,status,notes) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)").run(
    body.wo_id, body.routing_id||null, body.step_no, body.process_name, body.equipment_id||null, body.start_time||'', body.end_time||'', body.good_qty||0, body.defect_qty||0, body.worker_name||'', body.status||'completed', body.notes||'');
  if (body.equipment_id && body.start_time && body.end_time) {
    const start = new Date(body.start_time); const end = new Date(body.end_time);
    const duration = (end - start) / 60000;
    if (duration > 0) {
      await ctx.db.prepare("INSERT INTO equipment_logs (equipment_id,log_date,log_type,start_time,end_time,duration_min,reason,worker_name) VALUES (?,?,?,?,?,?,?,?)").run(body.equipment_id, (body.start_time||'').slice(0,10), 'production', body.start_time, body.end_time, duration, body.process_name||'', body.worker_name||'');
    }
  }
  const routing = await ctx.db.prepare("SELECT COUNT(*) AS total FROM process_routing WHERE product_code=(SELECT product_code FROM work_orders WHERE wo_id=?)").get(body.wo_id);
  const completed = await ctx.db.prepare("SELECT COUNT(DISTINCT step_no) AS done FROM process_results WHERE wo_id=? AND status='completed'").get(body.wo_id);
  if (routing && completed && routing.total > 0 && completed.done >= routing.total) {
    const totalGood = (await ctx.db.prepare("SELECT MIN(good_qty) AS g FROM process_results WHERE wo_id=? AND status='completed'").get(body.wo_id)||{}).g||0;
    await ctx.db.prepare("UPDATE work_orders SET status='completed', produced_qty=?, completed_date=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE wo_id=?").run(totalGood, body.wo_id);
    ctx.createNotification(null, 'system', '작업지시 완료', 'WO-'+body.wo_id+' 모든 공정 완료', 'work-order');
  }
  ctx.ok(res, { saved: true });
});

router.get('/api/process-results', async (req, res, parsed) => {
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const woId = qs.get('wo_id');
  if (woId) {
    const results = await ctx.db.prepare("SELECT pr.*, e.eq_name FROM process_results pr LEFT JOIN equipment e ON e.id=pr.equipment_id WHERE pr.wo_id=? ORDER BY pr.step_no").all(woId);
    ctx.ok(res, results);
  } else {
    const results = await ctx.db.prepare("SELECT pr.*, w.wo_number, w.product_name, e.eq_name FROM process_results pr JOIN work_orders w ON w.wo_id=pr.wo_id LEFT JOIN equipment e ON e.id=pr.equipment_id ORDER BY pr.created_at DESC LIMIT 100").all();
    ctx.ok(res, results);
  }
});

router.get('/api/equipment', async (req, res, parsed) => {
  const eqs = await ctx.db.prepare("SELECT * FROM equipment ORDER BY eq_code").all();
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0,10);
  const result = await Promise.all(eqs.map(async eq => {
    const logs = await ctx.db.prepare("SELECT log_type, COALESCE(SUM(duration_min),0) AS total_min FROM equipment_logs WHERE equipment_id=? AND log_date >= ? GROUP BY log_type").all(eq.id, monthStart);
    const stats = {}; logs.forEach(l => stats[l.log_type] = l.total_min);
    const prodMin = stats.production || 0;
    const downMin = stats.downtime || 0;
    const maintMin = stats.maintenance || 0;
    const totalMin = prodMin + downMin + maintMin;
    const availability = totalMin > 0 ? Math.round(prodMin / totalMin * 1000) / 10 : 0;
    return { ...eq, stats: { production_min: prodMin, downtime_min: downMin, maintenance_min: maintMin, availability } };
  }));
  ctx.ok(res, result);
});

router.post('/api/equipment', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  if (body.id) {
    await ctx.db.prepare("UPDATE equipment SET eq_name=?,eq_type=?,location=?,status=?,manufacturer=?,model=?,capacity_per_hour=?,notes=?,updated_at=datetime('now','localtime') WHERE id=?").run(
      body.eq_name, body.eq_type||'', body.location||'', body.status||'active', body.manufacturer||'', body.model||'', body.capacity_per_hour||0, body.notes||'', body.id);
    ctx.ok(res, { updated: true }); return;
  }
  const code = body.eq_code || 'EQ-' + String(Date.now()).slice(-6);
  await ctx.db.prepare("INSERT INTO equipment (eq_code,eq_name,eq_type,location,status,purchase_date,manufacturer,model,capacity_per_hour,notes) VALUES (?,?,?,?,?,?,?,?,?,?)").run(
    code, body.eq_name||'', body.eq_type||'', body.location||'', body.status||'active', body.purchase_date||'', body.manufacturer||'', body.model||'', body.capacity_per_hour||0, body.notes||'');
  ctx.ok(res, { created: true, eq_code: code });
});

module.exports = { router };
