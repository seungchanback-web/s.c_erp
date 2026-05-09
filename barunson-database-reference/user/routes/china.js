// routes/china.js — 중국 구매/단가/재고/선적 관리 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  CHINA PRICE TIERS
// ════════════════════════════════════════════════════════════════════

// GET /api/china-price-tiers — 전체 단가 조회 (product_code별 그룹핑)
router.get('/api/china-price-tiers', async (req, res, parsed) => {
  const rows = await ctx.db.prepare('SELECT * FROM china_price_tiers ORDER BY product_code, qty_tier').all();
  // product_code별로 그룹핑
  const map = {};
  for (const r of rows) {
    if (!map[r.product_code]) map[r.product_code] = { product_code: r.product_code, product_type: r.product_type, tiers: [] };
    map[r.product_code].tiers.push({ qty: r.qty_tier, price: r.unit_price });
  }
  ctx.ok(res, { products: Object.values(map), total: Object.keys(map).length });
});

// POST /api/china-price-tiers/import — 엑셀에서 단가 일괄 임포트
router.post('/api/china-price-tiers/import', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  const items = b.items || [];
  if (!items.length) { ctx.fail(res, 400, 'items 배열 필요'); return; }
  const insert = ctx.db.prepare('INSERT OR REPLACE INTO china_price_tiers (product_code, product_type, qty_tier, unit_price, currency, effective_date) VALUES (?,?,?,?,?,?)');
  const tx = ctx.db.transaction(async () => {
    let cnt = 0;
    for (const item of items) {
      await insert.run(item.product_code, item.product_type || 'Card', item.qty_tier, item.unit_price, item.currency || 'KRW', item.effective_date || '2025-05-01');
      cnt++;
    }
    return cnt;
  });
  const count = await tx();
  ctx.ok(res, { imported: count });
});

// GET /api/china-price-tiers/optimal — 최적 발주수량 계산
router.get('/api/china-price-tiers/optimal', async (req, res, parsed) => {
  const code = parsed.searchParams.get('code') || '';
  const need = parseInt(parsed.searchParams.get('need')) || 0;
  const monthlyUsage = parseInt(parsed.searchParams.get('monthly')) || 0;
  const currentStock = parseInt(parsed.searchParams.get('stock')) || 0;
  const leadTimeDays = parseInt(parsed.searchParams.get('leadtime')) || 50; // 중국 기본 50일
  const boxLimit = parseInt(parsed.searchParams.get('boxlimit')) || 500; // 선적 상자 제한

  const tiers = await ctx.db.prepare('SELECT qty_tier, unit_price FROM china_price_tiers WHERE UPPER(product_code)=UPPER(?) ORDER BY qty_tier').all(code);
  if (!tiers.length) { ctx.ok(res, { code, tiers: [], optimal: null, message: '단가 데이터 없음' }); return; }

  // 목표재고 = 월출고량에 따라 차등 (많으면 3개월, 적으면 2개월)
  const targetMonths = monthlyUsage > 10000 ? 3 : 2;
  const targetStock = monthlyUsage * targetMonths;
  const shortage = Math.max(targetStock - currentStock, 0);

  if (shortage <= 0) {
    ctx.ok(res, { code, tiers: tiers.map(t=>({qty:t.qty_tier,price:t.unit_price})), optimal: null, targetMonths, targetStock, shortage: 0, message: '재고 충분' });
    return;
  }

  // 각 단가 구간별 비용 비교
  const options = [];
  for (const t of tiers) {
    if (t.qty_tier < shortage * 0.5) continue; // 부족량의 50% 미만은 제외
    const qty = Math.max(t.qty_tier, Math.ceil(shortage / 1000) * 1000);
    const totalCost = qty * t.unit_price;
    const unitCost = t.unit_price;
    const coverMonths = monthlyUsage > 0 ? ((currentStock + qty) / monthlyUsage).toFixed(1) : '-';
    options.push({ qty: t.qty_tier, orderQty: qty, unitPrice: t.unit_price, totalCost, coverMonths });
  }
  // 부족수량 기준도 추가 (가장 가까운 구간 적용)
  let basePrice = tiers[0].unit_price;
  for (const t of tiers) { if (shortage >= t.qty_tier) basePrice = t.unit_price; }
  const baseQty = Math.ceil(shortage / 1000) * 1000;
  const baseOption = { qty: baseQty, orderQty: baseQty, unitPrice: basePrice, totalCost: baseQty * basePrice, coverMonths: monthlyUsage > 0 ? ((currentStock + baseQty) / monthlyUsage).toFixed(1) : '-', isBase: true };

  // 최적 = 단위당 비용이 가장 낮으면서 커버 기간이 적절한 것
  const allOpts = [baseOption, ...options].sort((a,b) => a.totalCost - b.totalCost);
  // 중복 제거
  const seen = new Set();
  const uniqueOpts = allOpts.filter(o => { const k = o.orderQty; if (seen.has(k)) return false; seen.add(k); return true; });
  uniqueOpts.sort((a,b) => a.orderQty - b.orderQty);

  // 최적 추천: 단가 * 수량이 가장 효율적이면서 커버 기간이 targetMonths 이상
  let optimal = uniqueOpts[0];
  for (const o of uniqueOpts) {
    if (parseFloat(o.coverMonths) >= targetMonths && o.unitPrice <= optimal.unitPrice) {
      optimal = o;
    }
  }

  ctx.ok(res, {
    code, shortage, targetMonths, targetStock, currentStock, monthlyUsage, leadTimeDays,
    tiers: tiers.map(t=>({qty:t.qty_tier,price:t.unit_price})),
    options: uniqueOpts,
    optimal,
  });
});

// POST /api/china-price-tiers/upload — 전체 단가 업로드 (기존 데이터 교체)
router.post('/api/china-price-tiers/upload', async (req, res, parsed) => {
  try {
    const b = await ctx.readJSON(req);
    const products = b.products || [];
    if (!products.length) { ctx.fail(res, 400, 'products 배열 필요'); return; }
    let totalRows = 0, totalProducts = 0;
    const txn = ctx.db.transaction(async () => {
      await ctx.db.exec('DELETE FROM china_price_tiers');
      const ins = ctx.db.prepare('INSERT INTO china_price_tiers (product_code, product_type, qty_tier, unit_price, currency, effective_date) VALUES (?,?,?,?,?,?)');
      for (const p of products) {
        if (!p.product_code || !p.tiers || !p.tiers.length) continue;
        totalProducts++;
        for (const t of p.tiers) {
          await ins.run(p.product_code, p.product_type || 'Card', t.qty || 0, t.price || 0, 'CNY', new Date().toISOString().slice(0,10));
          totalRows++;
        }
      }
    });
    await txn();
    ctx.ok(res, { imported: totalRows, products: totalProducts });
  } catch (e) {
    ctx.fail(res, 500, '단가 업로드 오류: ' + e.message);
  }
});

// GET /api/china-price-tiers/:code — 특정 품목 단가 조회
router.getP(/^\/api\/china-price-tiers\/(.+)$/, async (req, res, parsed, m) => {
  const code = decodeURIComponent(m[1]);
  const rows = await ctx.db.prepare('SELECT * FROM china_price_tiers WHERE product_code=? ORDER BY qty_tier').all(code);
  if (!rows.length) {
    // 대소문자 무시 재시도
    const rows2 = await ctx.db.prepare('SELECT * FROM china_price_tiers WHERE UPPER(product_code)=UPPER(?) ORDER BY qty_tier').all(code);
    ctx.ok(res, { product_code: code, tiers: rows2.map(r => ({ qty: r.qty_tier, price: r.unit_price })) });
  } else {
    ctx.ok(res, { product_code: code, tiers: rows.map(r => ({ qty: r.qty_tier, price: r.unit_price })) });
  }
});

// ════════════════════════════════════════════════════════════════════
//  CHINA SHIPMENT
// ════════════════════════════════════════════════════════════════════

// GET /api/china-shipment/logs — 선적 이력 목록
router.get('/api/china-shipment/logs', async (req, res, parsed) => {
  const rows = await ctx.db.prepare('SELECT * FROM china_shipment_log ORDER BY created_at DESC LIMIT 50').all();
  ctx.ok(res, rows);
});

// POST /api/china-shipment/save — 선적 이력 저장
router.post('/api/china-shipment/save', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { shipment_date, file_name, total_boxes, total_items, target_boxes, items, notes, status, bl_number, ship_date } = body;
  // eta_date = ship_date + 50일 자동 계산
  let eta_date = '';
  if (ship_date) {
    const d = new Date(ship_date);
    d.setDate(d.getDate() + 50);
    eta_date = d.toISOString().slice(0, 10);
  }
  const result = await ctx.db.prepare(`INSERT INTO china_shipment_log (shipment_date, file_name, total_boxes, total_items, target_boxes, items_json, notes, status, bl_number, ship_date, eta_date) VALUES (?,?,?,?,?,?,?,?,?,?,?)`).run(
    shipment_date || new Date().toISOString().slice(0,10),
    file_name || '',
    total_boxes || 0,
    total_items || 0,
    target_boxes || 500,
    JSON.stringify(items || []),
    notes || '',
    status || '전달',
    bl_number || '',
    ship_date || '',
    eta_date
  );
  ctx.ok(res, { id: result.lastInsertRowid });
});

// GET /api/china-shipment/logs/:id — 특정 선적 상세
router.getP(/^\/api\/china-shipment\/logs\/(\d+)$/, async (req, res, parsed, m) => {
  const row = await ctx.db.prepare('SELECT * FROM china_shipment_log WHERE id=?').get(m[1]);
  ctx.ok(res, row || null);
});

// PUT /api/china-shipment/logs/:id/status — 상태 변경
router.putP(/^\/api\/china-shipment\/logs\/(\d+)\/status$/, async (req, res, parsed, m) => {
  const body = await ctx.readJSON(req);
  await ctx.db.prepare('UPDATE china_shipment_log SET status=? WHERE id=?').run(body.status, m[1]);
  ctx.ok(res, { updated: true });
});

// DELETE /api/china-shipment/logs/:id — 선적 이력 삭제
router.delP(/^\/api\/china-shipment\/logs\/(\d+)$/, async (req, res, parsed, m) => {
  await ctx.db.prepare('DELETE FROM china_shipment_log WHERE id=?').run(m[1]);
  ctx.ok(res, { deleted: true });
});

// PATCH /api/china-shipment/:id — BL번호/선적일/상태 업데이트
router.addPattern('PATCH', /^\/api\/china-shipment\/(\d+)$/, async (req, res, parsed, m) => {
  const body = await ctx.readJSON(req);
  const id = m[1];
  const updates = [];
  const params = [];
  if (body.status !== undefined) { updates.push('status=?'); params.push(body.status); }
  if (body.bl_number !== undefined) { updates.push('bl_number=?'); params.push(body.bl_number); }
  if (body.ship_date !== undefined) {
    updates.push('ship_date=?'); params.push(body.ship_date);
    // eta_date 자동 재계산 (ship_date + 50일)
    if (body.ship_date) {
      const d = new Date(body.ship_date);
      d.setDate(d.getDate() + 50);
      updates.push('eta_date=?'); params.push(d.toISOString().slice(0, 10));
    } else {
      updates.push('eta_date=?'); params.push('');
    }
  }
  if (updates.length > 0) {
    params.push(id);
    await ctx.db.prepare(`UPDATE china_shipment_log SET ${updates.join(',')} WHERE id=?`).run(...params);
  }
  ctx.ok(res, { updated: true });
});

// ════════════════════════════════════════════════════════════════════
//  CHINA INVENTORY
// ════════════════════════════════════════════════════════════════════

// POST /api/china-inventory/upload — 중국 재고 전체 업로드 (기존 데이터 교체)
router.post('/api/china-inventory/upload', async (req, res, parsed) => {
  try {
    const b = await ctx.readJSON(req);
    const items = b.items || [];
    if (!items.length) { ctx.fail(res, 400, 'items 배열 필요'); return; }
    const txn = ctx.db.transaction(async () => {
      await ctx.db.exec('DELETE FROM china_inventory');
      const ins = ctx.db.prepare('INSERT INTO china_inventory (product_code, product_name, cn_stock, incoming_qty, incoming_date, po_no, order_qty, order_date, due_date, received_qty, unproduced_qty, is_complete) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)');
      for (const r of items) {
        await ins.run(
          r.product_code, r.product_name || '', r.cn_stock || 0, r.incoming_qty || 0, r.incoming_date || '',
          r.po_no || '', r.order_qty || 0, r.order_date || '', r.due_date || '',
          r.received_qty || 0, r.unproduced_qty || 0, r.is_complete || 'N'
        );
      }
    });
    await txn();
    ctx.ok(res, { uploaded: items.length });
  } catch (e) {
    ctx.fail(res, 500, '중국 재고 업로드 오류: ' + e.message);
  }
});

// GET /api/china-inventory — 중국 재고 목록 조회
router.get('/api/china-inventory', async (req, res, parsed) => {
  try {
    const rows = await ctx.db.prepare('SELECT * FROM china_inventory ORDER BY product_code').all();
    ctx.ok(res, rows);
  } catch (e) {
    ctx.fail(res, 500, e.message);
  }
});

module.exports = { router };
