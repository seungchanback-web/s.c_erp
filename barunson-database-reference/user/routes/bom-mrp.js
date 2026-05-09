// routes/bom-mrp.js — BOM / 생산계획 / MRP 라우트 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  BOM API
// ════════════════════════════════════════════════════════════════════

// GET /api/bom — BOM 전체 목록
router.get('/api/bom', async (req, res, parsed) => {
  const rows = await ctx.db.prepare(`SELECT b.*, (SELECT COUNT(*) FROM bom_items WHERE bom_id=b.bom_id) as item_count FROM bom_header b ORDER BY b.product_code`).all();
  ctx.ok(res, rows);
});

// GET /api/bom/export — BOM 전체를 플랫 CSV용 데이터로
router.get('/api/bom/export', async (req, res, parsed) => {
  const headers = await ctx.db.prepare('SELECT * FROM bom_header ORDER BY product_code').all();
  const processes = await ctx.getPostProcessTypes();
  const rows = await Promise.all(headers.map(async h => {
    const items = await ctx.db.prepare('SELECT * FROM bom_items WHERE bom_id=? ORDER BY sort_order').all(h.bom_id);
    const mat = items.find(i => i.item_type === 'material') || {};
    const row = {
      product_code: h.product_code, product_name: h.product_name||'', brand: h.brand||'',
      material_code: mat.material_code||'', material_name: mat.material_name||'',
      vendor_name: mat.vendor_name||'', cut_spec: mat.cut_spec||'', plate_spec: mat.plate_spec||''
    };
    processes.forEach(p => { const proc = items.find(i => i.process_type === p); row[p] = proc ? proc.vendor_name : ''; });
    return row;
  }));
  ctx.ok(res, rows);
});

// POST /api/bom/bulk-upload — CSV 파싱 결과 일괄 등록
router.post('/api/bom/bulk-upload', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const rows = body.rows || [];
  const processes = await ctx.getPostProcessTypes();
  let updated = 0, created = 0;
  const txn = ctx.db.transaction(async () => {
    for (const r of rows) {
      if (!r.product_code) continue;
      let header = await ctx.db.prepare('SELECT bom_id FROM bom_header WHERE product_code=?').get(r.product_code);
      if (header) {
        await ctx.db.prepare('UPDATE bom_header SET product_name=?, brand=?, updated_at=datetime(\'now\',\'localtime\') WHERE bom_id=?').run(r.product_name||'', r.brand||'', header.bom_id);
        await ctx.db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(header.bom_id);
        updated++;
      } else {
        const ins = await ctx.db.prepare('INSERT INTO bom_header (product_code, product_name, brand) VALUES (?,?,?)').run(r.product_code, r.product_name||'', r.brand||'');
        header = { bom_id: ins.lastInsertRowid };
        created++;
      }
      const insItem = ctx.db.prepare('INSERT INTO bom_items (bom_id, item_type, material_code, material_name, vendor_name, process_type, qty_per, cut_spec, plate_spec, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)');
      let sort = 0;
      if (r.material_code) {
        await insItem.run(header.bom_id, 'material', r.material_code, r.material_name||'', r.vendor_name||'', '원재료', 1, r.cut_spec||'', r.plate_spec||'', sort++);
      }
      processes.forEach(async p => {
        if (r[p]) await insItem.run(header.bom_id, 'process', '', '', r[p], p, 1, '', '', sort++);
      });
    }
  });
  await txn();
  ctx.ok(res, { created, updated, total: created + updated });
});

// GET /api/bom/:code — BOM 상세 조회
router.getP(/^\/api\/bom\/(.+)$/, async (req, res, parsed, m) => {
  if (m[1] === 'import' || m[1] === 'export' || m[1] === 'bulk-upload') return false;
  const code = decodeURIComponent(m[1]);
  const header = await ctx.db.prepare('SELECT * FROM bom_header WHERE product_code = ? OR bom_id = ?').get(code, parseInt(code)||0);
  if (!header) { res.writeHead(404); res.end(JSON.stringify({error:'not found'})); return; }
  const items = await ctx.db.prepare('SELECT * FROM bom_items WHERE bom_id = ? ORDER BY sort_order, bom_item_id').all(header.bom_id);
  ctx.ok(res, { ...header, items });
});

// POST /api/bom — BOM 신규 등록
router.post('/api/bom', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  const ins = ctx.db.prepare('INSERT INTO bom_header (product_code, product_name, brand, notes, default_order_qty, finished_w, finished_h) VALUES (?,?,?,?,?,?,?)');
  const insItem = ctx.db.prepare(`INSERT INTO bom_items (bom_id, item_type, material_code, material_name, vendor_name, process_type, qty_per, cut_spec, plate_spec, unit, notes, sort_order,
    material_type, paper_standard, paper_type, gsm, finished_w, finished_h, bleed, grip, loss_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?)`);
  const txn = ctx.db.transaction(async () => {
    const r = await ins.run(b.product_code, b.product_name||'', b.brand||'', b.notes||'', b.default_order_qty||1000, b.finished_w||0, b.finished_h||0);
    const bomId = r.lastInsertRowid;
    for (let i = 0; i < (b.items||[]).length; i++) { const it = (b.items||[])[i];
      await insItem.run(bomId, it.item_type||'material', it.material_code||'', it.material_name||'', it.vendor_name||'', it.process_type||'', it.qty_per||1, it.cut_spec||'', it.plate_spec||'', it.unit||'EA', it.notes||'', i,
        it.material_type||'IMPOSITION', it.paper_standard||'', it.paper_type||'', it.gsm||0, it.finished_w||0, it.finished_h||0, it.bleed??3, it.grip??10, it.loss_rate??5);
    }
    return bomId;
  });
  const bomId = await txn();
  ctx.ok(res, { bom_id: bomId });
});

// PUT /api/bom/:id — BOM 수정
router.putP(/^\/api\/bom\/(\d+)$/, async (req, res, parsed, m) => {
  const bomId = parseInt(m[1]);
  const b = await ctx.readJSON(req);
  const txn = ctx.db.transaction(async () => {
    if (b.product_name !== undefined) await ctx.db.prepare("UPDATE bom_header SET product_name=?, brand=?, notes=?, default_order_qty=?, finished_w=?, finished_h=?, updated_at=datetime('now','localtime') WHERE bom_id=?").run(b.product_name||'', b.brand||'', b.notes||'', b.default_order_qty||1000, b.finished_w||0, b.finished_h||0, bomId);
    if (b.items) {
      await ctx.db.prepare('DELETE FROM bom_items WHERE bom_id=?').run(bomId);
      const insItem = ctx.db.prepare(`INSERT INTO bom_items (bom_id, item_type, material_code, material_name, vendor_name, process_type, qty_per, cut_spec, plate_spec, unit, notes, sort_order,
        material_type, paper_standard, paper_type, gsm, finished_w, finished_h, bleed, grip, loss_rate) VALUES (?,?,?,?,?,?,?,?,?,?,?,?, ?,?,?,?,?,?,?,?,?)`);
      for (let i = 0; i < b.items.length; i++) { const it = b.items[i];
        await insItem.run(bomId, it.item_type||'material', it.material_code||'', it.material_name||'', it.vendor_name||'', it.process_type||'', it.qty_per||1, it.cut_spec||'', it.plate_spec||'', it.unit||'EA', it.notes||'', i,
          it.material_type||'IMPOSITION', it.paper_standard||'', it.paper_type||'', it.gsm||0, it.finished_w||0, it.finished_h||0, it.bleed??3, it.grip??10, it.loss_rate??5);
      }
    }
  });
  await txn();
  ctx.ok(res, { updated: bomId });
});

// DELETE /api/bom/:id — BOM 삭제
router.delP(/^\/api\/bom\/(\d+)$/, async (req, res, parsed, m) => {
  await ctx.db.prepare('DELETE FROM bom_header WHERE bom_id=?').run(parseInt(m[1]));
  ctx.ok(res, { deleted: parseInt(m[1]) });
});

// POST /api/bom/import — product_info.json에서 BOM 가져오기
router.post('/api/bom/import', async (req, res, parsed) => {
  const piPath = ctx.path.join(ctx.__dir, 'product_info.json');
  let pi;
  try { pi = JSON.parse(ctx.fs.readFileSync(piPath, 'utf8')); } catch(e) { res.writeHead(500); res.end(JSON.stringify({error:'product_info.json not found'})); return; }
  const processes = await ctx.getPostProcessTypes();
  const insH = ctx.db.prepare('INSERT INTO bom_header (product_code, product_name, brand) VALUES (?,?,?) ON CONFLICT (product_code) DO NOTHING');
  const insI = ctx.db.prepare('INSERT INTO bom_items (bom_id, item_type, material_code, material_name, vendor_name, process_type, qty_per, cut_spec, plate_spec, sort_order) VALUES (?,?,?,?,?,?,?,?,?,?)');
  let count = 0;
  const txn = ctx.db.transaction(async () => {
    for (const [code, info] of Object.entries(pi)) {
      const r = await insH.run(code, info['제품사양']||'', '');
      const bomId = r.lastInsertRowid || await ctx.db.prepare('SELECT bom_id FROM bom_header WHERE product_code=?').get(code)?.bom_id;
      if (!bomId) continue;
      // skip if already has items
      const existing = await ctx.db.prepare('SELECT COUNT(*) as c FROM bom_items WHERE bom_id=?').get(bomId);
      if (existing.c > 0) continue;
      let sort = 0;
      // raw material
      if (info['제지사'] || info['원자재코드']) {
        await insI.run(bomId, 'material', info['원자재코드']||'', info['원재료용지명']||'', info['제지사']||'', '원재료', 1, info['절']||'', info['조판']||'', sort++);
      }
      // post-processes
      for (const proc of processes) {
        if (info[proc]) {
          await insI.run(bomId, 'process', '', '', info[proc], proc, 1, '', '', sort++);
        }
      }
      count++;
    }
  });
  await txn();
  ctx.ok(res, { imported: count });
});

// ════════════════════════════════════════════════════════════════════
//  PRODUCTION PLAN API
// ════════════════════════════════════════════════════════════════════

// GET /api/plans — 생산계획 조회
router.get('/api/plans', async (req, res, parsed) => {
  const month = parsed.searchParams.get('month') || '';
  let q = 'SELECT * FROM production_plan';
  const params = [];
  if (month) { q += ' WHERE plan_month = ?'; params.push(month); }
  q += ' ORDER BY product_code';
  const plans = await ctx.db.prepare(q).all(...params);

  // 2024-2025 이력 데이터 첨부
  const mm = month ? month.split('-')[1] : '';
  let histProducts = {};
  try {
    const hd = JSON.parse(ctx.fs.readFileSync(ctx.path.join(ctx.__dir, 'product_monthly_sales.json'), 'utf8'));
    histProducts = hd.products || {};
  } catch(e) {}

  for (const p of plans) {
    const hist = histProducts[p.product_code];
    p.sales_2024 = (hist && hist['2024'] && hist['2024'][mm]) || 0;
    p.sales_2025 = (hist && hist['2025'] && hist['2025'][mm]) || 0;
  }

  ctx.ok(res, plans);
});

// POST /api/plans — 생산계획 저장 (upsert)
router.post('/api/plans', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  const items = b.items || [b];
  const upsert = ctx.db.prepare('INSERT INTO production_plan (plan_month, product_code, product_name, brand, planned_qty, confirmed, notes) VALUES (?,?,?,?,?,?,?) ON CONFLICT(plan_month, product_code) DO UPDATE SET planned_qty=excluded.planned_qty, confirmed=excluded.confirmed, notes=excluded.notes, updated_at=datetime(\'now\',\'localtime\')');
  const txn = ctx.db.transaction(async () => {
    for (const it of items) {
      await upsert.run(it.plan_month, it.product_code, it.product_name||'', it.brand||'', it.planned_qty||0, it.confirmed||0, it.notes||'');
    }
  });
  await txn();
  ctx.ok(res, { saved: items.length });
});

// PUT /api/plans/:id — 생산계획 개별 수정
router.putP(/^\/api\/plans\/(\d+)$/, async (req, res, parsed, m) => {
  const b = await ctx.readJSON(req);
  const sets = []; const vals = [];
  for (const k of ['planned_qty','confirmed','notes','product_name','brand']) {
    if (b[k] !== undefined) { sets.push(k+'=?'); vals.push(b[k]); }
  }
  if (sets.length) {
    sets.push("updated_at=datetime('now','localtime')");
    vals.push(parseInt(m[1]));
    await ctx.db.prepare(`UPDATE production_plan SET ${sets.join(',')} WHERE plan_id=?`).run(...vals);
  }
  ctx.ok(res, { updated: parseInt(m[1]) });
});

// DELETE /api/plans?month=YYYY-MM — 월별 초기화
router.del('/api/plans', async (req, res, parsed) => {
  const month = parsed.searchParams.get('month');
  if (month) {
    const r = await ctx.db.prepare('DELETE FROM production_plan WHERE plan_month=?').run(month);
    ctx.ok(res, { deleted: r.changes, month });
  } else {
    const r = await ctx.db.prepare('DELETE FROM production_plan').run();
    ctx.ok(res, { deleted: r.changes });
  }
});

// DELETE /api/plans/:id — 생산계획 개별 삭제
router.delP(/^\/api\/plans\/(\d+)$/, async (req, res, parsed, m) => {
  await ctx.db.prepare('DELETE FROM production_plan WHERE plan_id=?').run(parseInt(m[1]));
  ctx.ok(res, { deleted: parseInt(m[1]) });
});

// POST /api/plans/from-sales — 판매이력 기반 자동 생성
router.post('/api/plans/from-sales', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  const month = b.plan_month;
  if (!month) { ctx.fail(res, 400, 'plan_month required'); return; }
  const mm = month.split('-')[1]; // '04' 등

  // 1) 품목별 월별 판매 이력 로드 (2024-2025)
  let histProducts = {};
  const histPath = ctx.path.join(ctx.__dir, 'product_monthly_sales.json');
  try {
    const hd = JSON.parse(ctx.fs.readFileSync(histPath, 'utf8'));
    histProducts = hd.products || {};
  } catch(e) { /* 파일 없으면 폴백 */ }
  const hasHist = Object.keys(histProducts).length > 0;

  // 2) ERP 스마트재고현황 로드 (브랜드/품명 + 폴백 수량)
  const erpPath = process.env.ERP_EXCEL_PATH || ctx.path.join(ctx.DATA_DIR, 'erp_smart_inventory.json');
  const jsonPath = erpPath.endsWith('.json') ? erpPath : ctx.path.join(ctx.__dir, 'erp_smart_inventory.json');
  let erpProducts = [];
  try {
    const d = JSON.parse(ctx.fs.readFileSync(jsonPath, 'utf8'));
    erpProducts = d.products || d.data || d;
  } catch(e) {}

  const w2024 = 0.4, w2025 = 0.6; // 연도별 가중치
  const upsert = ctx.db.prepare('INSERT INTO production_plan (plan_month, product_code, product_name, brand, planned_qty, notes) VALUES (?,?,?,?,?,?) ON CONFLICT(plan_month, product_code) DO UPDATE SET planned_qty=excluded.planned_qty, notes=excluded.notes, updated_at=datetime(\'now\',\'localtime\')');
  let count = 0;
  let methodUsed = hasHist ? 'weighted_history' : 'fallback_rolling';

  const txn = ctx.db.transaction(async () => {
    for (const p of erpProducts) {
      const code = p['품목코드'];
      const brand = p['브랜드'] || '';
      if (brand.includes('D_') || brand.includes('(D')) continue;

      let planned = 0;
      let note = '';
      const hist = histProducts[code];

      if (hasHist && hist) {
        const s24 = (hist['2024'] && hist['2024'][mm]) || 0;
        const s25 = (hist['2025'] && hist['2025'][mm]) || 0;
        if (s24 > 0 && s25 > 0) {
          planned = Math.round(s24 * w2024 + s25 * w2025);
          note = `24:${s24} 25:${s25}`;
        } else if (s25 > 0) {
          planned = s25;
          note = `25:${s25}`;
        } else if (s24 > 0) {
          planned = s24;
          note = `24:${s24}`;
        }
      }

      // 이력 없으면 기존 폴백 (12개월매출/12)
      if (planned <= 0) {
        const sales12 = p['12개월매출'] || 0;
        planned = Math.round(sales12 / 12);
        if (planned > 0) note = 'fallback';
      }

      if (planned <= 0) continue;
      await upsert.run(month, code, '', brand, planned, note);
      count++;
    }
  });
  await txn();
  ctx.ok(res, { generated: count, month, method: methodUsed });
});

// ════════════════════════════════════════════════════════════════════
//  MRP API
// ════════════════════════════════════════════════════════════════════

// POST /api/mrp/run — MRP 실행 (생산계획 기반)
router.post('/api/mrp/run', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const b = await ctx.readJSON(req);
  const month = b.plan_month;
  if (!month) { res.writeHead(400); res.end(JSON.stringify({error:'plan_month required'})); return; }
  // Load ERP inventory for on_hand lookup
  const jsonPath = ctx.path.join(ctx.__dir, 'erp_smart_inventory.json');
  let erpMap = {};
  try {
    const d = JSON.parse(ctx.fs.readFileSync(jsonPath, 'utf8'));
    (d.products || d.data || d).forEach(p => { erpMap[p['품목코드']] = p; });
  } catch(e) {}
  const roundUnit = b.round_unit || 50;
  const useHistoryFilter = b.filter_by_history !== false; // 기본 활성화
  // 발주이력 필터: order_history 테이블에 있는 품목코드만 포함
  let histCodes = null;
  if (useHistoryFilter) {
    const hRows = await ctx.db.prepare('SELECT DISTINCT product_code FROM order_history').all();
    if (hRows.length > 0) {
      histCodes = new Set(hRows.map(r => r.product_code));
    }
  }
  // Get plans for the month
  let plans = await ctx.db.prepare('SELECT * FROM production_plan WHERE plan_month=? AND planned_qty>0').all(month);
  if (histCodes) {
    const before = plans.length;
    plans = plans.filter(p => histCodes.has(p.product_code));
    console.log(`MRP 발주이력 필터: ${before} → ${plans.length} (${before - plans.length}개 제외)`);
  }
  // Clear previous results for this month
  await ctx.db.prepare('DELETE FROM mrp_result WHERE plan_month=?').run(month);
  const insR = ctx.db.prepare('INSERT INTO mrp_result (plan_month, product_code, material_code, material_name, vendor_name, process_type, gross_req, on_hand, on_order, net_req, order_qty, unit) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
  let resultCount = 0;
  const txn = ctx.db.transaction(async () => {
    for (const plan of plans) {
      const bom = await ctx.db.prepare('SELECT bi.* FROM bom_items bi JOIN bom_header bh ON bi.bom_id=bh.bom_id WHERE bh.product_code=? ORDER BY bi.sort_order').all(plan.product_code);
      if (!bom.length) continue;
      for (const item of bom) {
        const gross = plan.planned_qty * (item.qty_per || 1);
        // on_hand: for material, look up by material_code in ERP; for process, 0
        let onHand = 0;
        if (item.item_type === 'material' && item.material_code) {
          // find products using this material and sum their available stock
          const relatedBoms = await ctx.db.prepare('SELECT bh.product_code FROM bom_header bh JOIN bom_items bi ON bh.bom_id=bi.bom_id WHERE bi.material_code=?').all(item.material_code);
          // Use the current product's ERP available stock as proxy
          const erpItem = erpMap[plan.product_code];
          onHand = erpItem ? Math.max(0, erpItem['가용재고'] || 0) : 0;
        }
        // on_order: sum of outstanding PO qty for this material/product
        let onOrder = 0;
        const lookupCode = item.material_code || plan.product_code;
        const poRows = await ctx.db.prepare("SELECT SUM(pi.ordered_qty - pi.received_qty) as pending FROM po_items pi JOIN po_header ph ON pi.po_id=ph.po_id WHERE pi.product_code=? AND ph.status NOT IN ('완료','취소')").get(lookupCode);
        onOrder = poRows?.pending || 0;
        const net = Math.max(0, gross - onHand - onOrder);
        const orderQty = net > 0 ? Math.ceil(net / roundUnit) * roundUnit : 0;
        await insR.run(month, plan.product_code, item.material_code||'', item.material_name||'', item.vendor_name||'', item.process_type||'', gross, onHand, onOrder, net, orderQty, item.unit||'EA');
        resultCount++;
      }
    }
  });
  await txn();
  ctx.ok(res, { plan_month: month, results: resultCount, history_filter: histCodes ? histCodes.size : 0 });
});

// GET /api/mrp/results — MRP 결과 조회
router.get('/api/mrp/results', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const month = parsed.searchParams.get('month') || '';
  let q = 'SELECT * FROM mrp_result';
  const params = [];
  if (month) { q += ' WHERE plan_month=?'; params.push(month); }
  q += ' ORDER BY vendor_name, product_code';
  ctx.ok(res, await ctx.db.prepare(q).all(...params));
});

// DELETE /api/mrp/results — MRP 결과 초기화
router.del('/api/mrp/results', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const month = parsed.searchParams.get('month');
  if (month) {
    const r = await ctx.db.prepare('DELETE FROM mrp_result WHERE plan_month=?').run(month);
    ctx.ok(res, { deleted: r.changes, month });
  } else {
    const r = await ctx.db.prepare('DELETE FROM mrp_result').run();
    ctx.ok(res, { deleted: r.changes });
  }
});

// POST /api/mrp/calculate — MRP 계산 (BOM Explosion from Work Orders + Sales Orders)
router.post('/api/mrp/calculate', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const b = await ctx.readJSON(req);
  const roundUnit = b.round_unit || 1;

  // 1) Pending work orders (not completed/cancelled)
  const pendingWOs = await ctx.db.prepare(
    "SELECT wo_id, product_code, product_name, ordered_qty, produced_qty FROM work_orders WHERE status NOT IN ('completed','cancelled')"
  ).all();

  // 2) Confirmed / in_production sales orders with their items
  const confirmedSOs = await ctx.db.prepare(
    "SELECT so.id, soi.product_code, soi.product_name, soi.qty FROM sales_orders so JOIN sales_order_items soi ON so.id=soi.order_id WHERE so.status IN ('confirmed','in_production') AND soi.qty > 0"
  ).all();

  // 3) Build gross requirements per material via BOM explosion
  const grossMap = {}; // material_code -> { product_name, gross_req }

  const explodeBOM = async (productCode, productName, qty) => {
    const bomRows = await ctx.db.prepare(
      "SELECT bi.material_code, bi.material_name, bi.qty_per, bi.unit FROM bom_items bi JOIN bom_header bh ON bi.bom_id=bh.bom_id WHERE bh.product_code=? AND bi.item_type='material' AND bi.material_code IS NOT NULL AND bi.material_code != '' ORDER BY bi.sort_order"
    ).all(productCode);
    if (!bomRows.length) return;
    for (const bi of bomRows) {
      const need = qty * (bi.qty_per || 1);
      if (!grossMap[bi.material_code]) {
        grossMap[bi.material_code] = { product_name: bi.material_name || '', unit: bi.unit || 'EA', gross_req: 0 };
      }
      grossMap[bi.material_code].gross_req += need;
    }
  };

  // Explode from work orders (remaining qty = ordered - produced)
  for (const wo of pendingWOs) {
    const remaining = Math.max(0, (wo.ordered_qty || 0) - (wo.produced_qty || 0));
    if (remaining > 0 && wo.product_code) {
      await explodeBOM(wo.product_code, wo.product_name, remaining);
    }
  }

  // Explode from sales orders
  for (const so of confirmedSOs) {
    if (so.qty > 0 && so.product_code) {
      await explodeBOM(so.product_code, so.product_name, so.qty);
    }
  }

  // 4) Get on-hand inventory per material (sum across all warehouses)
  const invRows = await ctx.db.prepare(
    "SELECT product_code, SUM(quantity) AS total_qty FROM warehouse_inventory GROUP BY product_code"
  ).all();
  const invMap = {};
  for (const r of invRows) { invMap[r.product_code] = r.total_qty || 0; }

  // 5) Get on-order (pending PO) per material
  const poRows = await ctx.db.prepare(
    "SELECT pi.product_code, SUM(pi.ordered_qty - pi.received_qty) AS pending FROM po_items pi JOIN po_header ph ON pi.po_id=ph.po_id WHERE ph.status NOT IN ('완료','취소','cancelled','received') AND pi.ordered_qty > pi.received_qty GROUP BY pi.product_code"
  ).all();
  const poMap = {};
  for (const r of poRows) { poMap[r.product_code] = r.pending || 0; }

  // 6) Build result array
  const materials = [];
  let shortageCount = 0;
  for (const [matCode, info] of Object.entries(grossMap)) {
    const onHand = invMap[matCode] || 0;
    const onOrder = poMap[matCode] || 0;
    const netReq = Math.max(0, info.gross_req - onHand - onOrder);
    const orderQty = netReq > 0 && roundUnit > 1 ? Math.ceil(netReq / roundUnit) * roundUnit : netReq;
    const status = netReq > 0 ? 'shortage' : 'sufficient';
    if (netReq > 0) shortageCount++;
    materials.push({
      product_code: matCode,
      product_name: info.product_name,
      unit: info.unit,
      gross_req: info.gross_req,
      on_hand: onHand,
      on_order: onOrder,
      net_req: netReq,
      order_qty: orderQty,
      status
    });
  }

  // Sort: shortages first, then by net_req descending
  materials.sort((a, b) => (b.net_req - a.net_req) || a.product_code.localeCompare(b.product_code));

  ctx.ok(res, {
    materials,
    summary: { total_materials: materials.length, shortage_count: shortageCount },
    sources: { work_orders: pendingWOs.length, sales_orders: confirmedSOs.length }
  });
});

// GET /api/mrp/shortage — 부족 자재만 조회
router.get('/api/mrp/shortage', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const pendingWOs = await ctx.db.prepare(
    "SELECT wo_id, product_code, product_name, ordered_qty, produced_qty FROM work_orders WHERE status NOT IN ('completed','cancelled')"
  ).all();
  const confirmedSOs = await ctx.db.prepare(
    "SELECT so.id, soi.product_code, soi.product_name, soi.qty FROM sales_orders so JOIN sales_order_items soi ON so.id=soi.order_id WHERE so.status IN ('confirmed','in_production') AND soi.qty > 0"
  ).all();

  const grossMap = {};
  const explodeBOM = async (productCode, qty) => {
    const bomRows = await ctx.db.prepare(
      "SELECT bi.material_code, bi.material_name, bi.qty_per, bi.unit FROM bom_items bi JOIN bom_header bh ON bi.bom_id=bh.bom_id WHERE bh.product_code=? AND bi.item_type='material' AND bi.material_code IS NOT NULL AND bi.material_code != '' ORDER BY bi.sort_order"
    ).all(productCode);
    for (const bi of bomRows) {
      const need = qty * (bi.qty_per || 1);
      if (!grossMap[bi.material_code]) {
        grossMap[bi.material_code] = { product_name: bi.material_name || '', unit: bi.unit || 'EA', gross_req: 0 };
      }
      grossMap[bi.material_code].gross_req += need;
    }
  };

  for (const wo of pendingWOs) {
    const remaining = Math.max(0, (wo.ordered_qty || 0) - (wo.produced_qty || 0));
    if (remaining > 0 && wo.product_code) await explodeBOM(wo.product_code, remaining);
  }
  for (const so of confirmedSOs) {
    if (so.qty > 0 && so.product_code) await explodeBOM(so.product_code, so.qty);
  }

  const invRows = await ctx.db.prepare("SELECT product_code, SUM(quantity) AS total_qty FROM warehouse_inventory GROUP BY product_code").all();
  const invMap = {};
  for (const r of invRows) { invMap[r.product_code] = r.total_qty || 0; }

  const poRows = await ctx.db.prepare(
    "SELECT pi.product_code, SUM(pi.ordered_qty - pi.received_qty) AS pending FROM po_items pi JOIN po_header ph ON pi.po_id=ph.po_id WHERE ph.status NOT IN ('완료','취소','cancelled','received') AND pi.ordered_qty > pi.received_qty GROUP BY pi.product_code"
  ).all();
  const poMap = {};
  for (const r of poRows) { poMap[r.product_code] = r.pending || 0; }

  const shortages = [];
  for (const [matCode, info] of Object.entries(grossMap)) {
    const onHand = invMap[matCode] || 0;
    const onOrder = poMap[matCode] || 0;
    const netReq = Math.max(0, info.gross_req - onHand - onOrder);
    if (netReq > 0) {
      shortages.push({
        product_code: matCode,
        product_name: info.product_name,
        unit: info.unit,
        gross_req: info.gross_req,
        on_hand: onHand,
        on_order: onOrder,
        net_req: netReq,
        status: 'shortage'
      });
    }
  }
  shortages.sort((a, b) => (b.net_req - a.net_req) || a.product_code.localeCompare(b.product_code));

  ctx.ok(res, {
    materials: shortages,
    summary: { total_materials: shortages.length, shortage_count: shortages.length }
  });
});

// POST /api/mrp/create-po — MRP 결과에서 발주서 자동 생성
router.post('/api/mrp/create-po', async (req, res, parsed) => {
  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증 필요'); return; }
  const b = await ctx.readJSON(req);
  const ids = b.result_ids || [];
  if (!ids.length) { res.writeHead(400); res.end(JSON.stringify({error:'result_ids required'})); return; }
  const results = await ctx.db.prepare(`SELECT * FROM mrp_result WHERE result_id IN (${ids.map(()=>'?').join(',')}) AND order_qty > 0`).all(...ids);
  // Group by vendor + process_type
  const groups = {};
  for (const r of results) {
    const key = (r.vendor_name||'미지정') + '|' + (r.process_type === '원재료' ? '원재료' : '후공정');
    if (!groups[key]) groups[key] = [];
    groups[key].push(r);
  }
  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const cnt = await ctx.db.prepare("SELECT COUNT(*) as c FROM po_header WHERE po_number LIKE ?").get('PO-'+today+'%');
  let seq = (cnt?.c || 0) + 1;
  const created = [];
  const txn = ctx.db.transaction(async () => {
    for (const [key, items] of Object.entries(groups)) {
      const [vendor, poType] = key.split('|');
      const poNum = `PO-${today}-${String(seq++).padStart(3,'0')}`;
      const totalQty = items.reduce((s,i) => s + i.order_qty, 0);
      // origin/legal_entity: 첫 번째 품목 기준
      const _mrpSelCols = ctx._hasEntity.products ? 'origin, legal_entity' : 'origin';
      const _mrpFirstProd = await ctx.db.prepare(`SELECT ${_mrpSelCols} FROM products WHERE product_code=?`).get(items[0].product_code || '');
      const _mrpOrigin = (_mrpFirstProd && _mrpFirstProd.origin) || '';
      const _mrpEntity = (_mrpFirstProd && _mrpFirstProd.legal_entity === 'dd') ? 'dd' : 'barunson';
      const r = ctx._hasEntity.po_header
        ? await ctx.db.prepare('INSERT INTO po_header (po_number, po_type, vendor_name, status, total_qty, notes, origin, legal_entity, po_date) VALUES (?,?,?,?,?,?,?,?,date(\'now\',\'localtime\'))').run(poNum, poType, vendor, '대기', totalQty, 'MRP 자동생성', _mrpOrigin, _mrpEntity)
        : await ctx.db.prepare('INSERT INTO po_header (po_number, po_type, vendor_name, status, total_qty, notes, origin, po_date) VALUES (?,?,?,?,?,?,?,date(\'now\',\'localtime\'))').run(poNum, poType, vendor, '대기', totalQty, 'MRP 자동생성', _mrpOrigin);
      const poId = r.lastInsertRowid;
      for (const item of items) {
        await ctx.db.prepare('INSERT INTO po_items (po_id, product_code, brand, process_type, ordered_qty, spec) VALUES (?,?,?,?,?,?)').run(poId, item.product_code, '', item.process_type, item.order_qty, item.material_name);
        await ctx.db.prepare('UPDATE mrp_result SET status=? WHERE result_id=?').run('ordered', item.result_id);
      }
      created.push({ po_number: poNum, vendor, po_type: poType, items: items.length });
    }
  });
  await txn();
  ctx.ok(res, { created });
});

module.exports = { router };
