// routes/auto-order.js — 자동발주(Auto-Order) 라우트 모듈
// 전략발주 등록/검색/일괄추가/최적수량 계산/실행/스케줄러
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  전략발주 최적수량 계산 공통 함수
// ════════════════════════════════════════════════════════════════════

async function calculateOptimalOrder(productCode, invData, origin) {
  const avail = typeof invData['가용재고'] === 'number' ? invData['가용재고'] : 0;
  const daily = invData['_xerpDaily'] || 0;
  const monthly = invData['_xerpMonthly'] || (invData._xerpTotal3m ? Math.round(invData._xerpTotal3m / 3) : 0);
  if (monthly <= 0) return { skip: true, reason: '월출고량 없음' };

  // 1. 리드타임 결정: 품목별 > 생산지별 기본값 (중국 50일)
  const prod = await ctx.db.prepare('SELECT lead_time_days FROM products WHERE product_code=?').get(productCode);
  const leadDays = (prod && prod.lead_time_days > 0) ? prod.lead_time_days : (ctx.ORIGIN_LEAD_TIME[origin] || 7);

  // 2. 리드타임 동안 소진량
  const leadTimeUsage = Math.round(daily * leadDays);

  // 3. 안전재고: 중국은 리드타임이 길어서 2개월분, 한국 0.5개월
  const safetyStock = origin === '중국' ? Math.round(monthly * 2) : Math.round(monthly * 0.5);

  // 4. 목표재고 = 리드타임소진 + 안전재고
  const targetStock = leadTimeUsage + safetyStock;

  // 5. 부족수량
  const shortage = Math.max(targetStock - avail, 0);
  if (shortage <= 0) return { skip: true, reason: `재고 충분 (${avail.toLocaleString()} >= 목표 ${targetStock.toLocaleString()})`, targetStock, leadDays };

  const remainDays = daily > 0 ? Math.round(avail / daily) : 9999;

  // 6. 단가 구간 최적화 (china_price_tiers가 있는 경우)
  const tiers = await ctx.db.prepare('SELECT qty_tier, unit_price FROM china_price_tiers WHERE UPPER(product_code)=UPPER(?) ORDER BY qty_tier').all(productCode);
  let orderQty, unitPrice = 0, tierAnalysis = [];

  if (tiers.length && origin === '중국') {
    // 중국 전략발주: 총비용 효율 비교
    const baseQty = Math.ceil(shortage / 1000) * 1000;

    // 각 단가 구간별 시나리오 분석
    for (const t of tiers) {
      const qty = Math.max(t.qty_tier, baseQty);
      const cost = qty * t.unit_price;
      const excess = qty - shortage;
      const excessDays = daily > 0 ? Math.round(excess / daily) : 9999;
      const maxExcess = monthly * 3;
      const isViable = excess <= maxExcess;

      tierAnalysis.push({
        tierQty: t.qty_tier, orderQty: qty, unitPrice: t.unit_price,
        totalCost: cost, excess, excessDays, isViable,
        costPerUnit: t.unit_price
      });
    }

    // 실현 가능한 옵션만 필터
    const viable = tierAnalysis.filter(t => t.isViable);
    if (viable.length) {
      viable.sort((a, b) => a.totalCost - b.totalCost || a.orderQty - b.orderQty);
      const best = viable[0];

      // 다음 구간이 총비용이 더 낮으면 올리기 (손익분기점 체크)
      let finalBest = best;
      for (const opt of viable) {
        if (opt.totalCost <= finalBest.totalCost && opt.orderQty >= finalBest.orderQty) {
          finalBest = opt;
        }
      }
      orderQty = finalBest.orderQty;
      unitPrice = finalBest.unitPrice;
    } else {
      // 모든 구간이 초과분 과다 → 최소 구간 사용
      orderQty = baseQty;
      unitPrice = tiers[0].unit_price;
    }
  } else if (tiers.length) {
    // 한국 등: 단가 구간이 있으면 해당 수량의 단가 적용
    const baseQty = Math.ceil(shortage / 1000) * 1000;
    orderQty = baseQty;
    for (const t of tiers) { if (baseQty >= t.qty_tier) unitPrice = t.unit_price; }
  } else {
    orderQty = Math.ceil(shortage / 1000) * 1000;
  }

  return {
    skip: false, orderQty, unitPrice, shortage, targetStock, leadDays,
    leadTimeUsage, safetyStock, monthly, daily, avail, remainDays,
    totalCost: orderQty * unitPrice, tierAnalysis
  };
}

// ════════════════════════════════════════════════════════════════════
//  라우트 등록
// ════════════════════════════════════════════════════════════════════

// GET /api/auto-order — 자동발주 품목 목록
router.get('/api/auto-order', async (req, res, parsed) => {
  const rows = await ctx.db.prepare(`SELECT a.*, COALESCE(p.origin,'') as origin FROM auto_order_items a LEFT JOIN products p ON a.product_code=p.product_code ORDER BY a.id`).all();
  ctx.ok(res, rows);
});

// GET /api/auto-order/search?q=... — 품목 검색 (XERP 재고+products DB)
router.get('/api/auto-order/search', async (req, res, parsed) => {
  const q = (parsed.searchParams.get('q') || '').trim();
  if (!q) { ctx.ok(res, []); return; }
  // products DB에서 검색
  const dbRows = await ctx.db.prepare(`SELECT product_code, product_name, brand, origin FROM products WHERE product_code LIKE ? OR product_name LIKE ? LIMIT 20`).all(`%${q}%`, `%${q}%`);
  // 이미 등록된 품목 체크
  const existingCodes = new Set((await ctx.db.prepare('SELECT product_code FROM auto_order_items').all()).map(r => r.product_code));
  const results = dbRows.map(r => ({ ...r, already_added: existingCodes.has(r.product_code) }));
  // XERP 캐시에서도 검색
  if (ctx.xerpInventoryCache && ctx.xerpInventoryCache.products) {
    const dbCodes = new Set(results.map(r => r.product_code));
    for (const p of ctx.xerpInventoryCache.products) {
      const code = p['제품코드'] || '';
      if (!dbCodes.has(code) && (code.toLowerCase().includes(q.toLowerCase()) || (p['품목명']||'').includes(q))) {
        results.push({ product_code: code, product_name: p['품목명']||'', brand: p['브랜드']||'', origin: p['생산지']||'', already_added: existingCodes.has(code) });
        dbCodes.add(code);
      }
    }
  }
  ctx.ok(res, results.slice(0, 30));
});

// POST /api/auto-order — 자동발주 품목 등록
router.post('/api/auto-order', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  if (!b.product_code) { ctx.fail(res, 400, 'product_code required'); return; }
  // origin 자동 판별: products DB → XERP 캐시 → 기본값
  let origin = b.origin || '';
  if (!origin) {
    const prod = await ctx.db.prepare('SELECT origin FROM products WHERE product_code=?').get(b.product_code);
    if (prod) origin = prod.origin || '';
  }
  if (!origin && ctx.xerpInventoryCache && ctx.xerpInventoryCache.products) {
    const xp = ctx.xerpInventoryCache.products.find(p => (p['제품코드']||'') === b.product_code);
    if (xp) origin = xp['생산지'] || '';
  }
  if (!origin) origin = '한국'; // 기본값
  // products 테이블에 origin 없으면 업데이트
  const existProd = await ctx.db.prepare('SELECT id, origin FROM products WHERE product_code=?').get(b.product_code);
  if (existProd && !existProd.origin) {
    await ctx.db.prepare('UPDATE products SET origin=? WHERE id=?').run(origin, existProd.id);
  }
  try {
    const info = await ctx.db.prepare('INSERT INTO auto_order_items (product_code, min_stock, order_qty, vendor_name) VALUES (?,?,?,?)').run(
      b.product_code, b.min_stock || 0, b.order_qty || 0, b.vendor_name || ''
    );
    ctx.ok(res, { id: info.lastInsertRowid, origin });
  } catch (e) {
    ctx.fail(res, 400, e.message.includes('UNIQUE') ? '이미 등록된 품목입니다' : e.message);
  }
});

// PUT /api/auto-order/:id — 자동발주 품목 수정
router.putP(/^\/api\/auto-order\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  const b = await ctx.readJSON(req);
  const existing = await ctx.db.prepare('SELECT * FROM auto_order_items WHERE id=?').get(id);
  if (!existing) { ctx.fail(res, 404, 'not found'); return; }
  await ctx.db.prepare('UPDATE auto_order_items SET min_stock=?, order_qty=?, vendor_name=?, enabled=? WHERE id=?').run(
    b.min_stock !== undefined ? b.min_stock : existing.min_stock,
    b.order_qty !== undefined ? b.order_qty : existing.order_qty,
    b.vendor_name !== undefined ? b.vendor_name : existing.vendor_name,
    b.enabled !== undefined ? b.enabled : existing.enabled,
    id
  );
  ctx.ok(res, { updated: true });
});

// DELETE /api/auto-order/:id — 자동발주 품목 삭제
router.delP(/^\/api\/auto-order\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  await ctx.db.prepare('DELETE FROM auto_order_items WHERE id=?').run(id);
  ctx.ok(res, { deleted: true });
});

// POST /api/auto-order/bulk-add — 재고현황에서 특정 생산지 품목 일괄 추가
router.post('/api/auto-order/bulk-add', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  const origin = b.origin || '중국';
  // products DB에서 해당 origin 품목 가져오기
  const prodsByOrigin = await ctx.db.prepare('SELECT product_code FROM products WHERE origin=?').all(origin);
  // XERP 재고에서도 (생산지가 있는 경우)
  const xerpCodes = new Set();
  let inv = ctx.xerpInventoryCache && ctx.xerpInventoryCache.products ? ctx.xerpInventoryCache.products : [];
  for (const p of inv) { if ((p['생산지']||'') === origin) xerpCodes.add(p['제품코드']); }
  // XERP 재고에 있는 품목만 (재고 데이터가 있어야 의미)
  const invCodes = new Set(inv.map(p => p['제품코드'] || ''));
  const targetCodes = new Set([...prodsByOrigin.map(p => p.product_code).filter(c => invCodes.has(c)), ...xerpCodes]);

  const existing = new Set((await ctx.db.prepare('SELECT product_code FROM auto_order_items').all()).map(r => r.product_code));
  const insert = ctx.db.prepare('INSERT OR IGNORE INTO auto_order_items (product_code, min_stock, order_qty, vendor_name, enabled) VALUES (?,?,?,?,1)');
  let added = 0, skipped = 0;
  const tx = ctx.db.transaction(async () => {
    for (const code of targetCodes) {
      if (!code) continue;
      if (existing.has(code)) { skipped++; continue; }
      await insert.run(code, 0, 0, '');
      added++;
    }
  });
  await tx();
  ctx.ok(res, { added, skipped, origin, total: targetCodes.size });
});

// POST /api/auto-order/check — 자동발주 실행
router.post('/api/auto-order/check', async (req, res, parsed) => {
  const items = await ctx.db.prepare('SELECT * FROM auto_order_items WHERE enabled=1').all();
  // XERP 캐시 또는 API에서 재고+출고 데이터 로드
  let inv = [];
  if (ctx.xerpInventoryCache && ctx.xerpInventoryCache.products) {
    inv = ctx.xerpInventoryCache.products;
  } else {
    // 폴백: JSON 파일
    try {
      const raw = JSON.parse(ctx.fs.readFileSync(ctx.path.join(ctx.__dir, 'erp_smart_inventory.json'), 'utf8'));
      inv = raw.products || raw.data || (Array.isArray(raw) ? raw : []);
    } catch(e2) {}
  }
  const invMap = {};
  for (const p of inv) { invMap[p['제품코드'] || p['품목코드']] = p; }

  // 예상 소진일 기준 정렬 (빠른 순 = 긴급한 것 먼저)
  items.sort((a, b) => {
    const pa = invMap[a.product_code] || invMap[(a.product_code||'').toUpperCase()];
    const pb = invMap[b.product_code] || invMap[(b.product_code||'').toUpperCase()];
    const dailyA = pa ? (pa['_xerpDaily'] || 0) : 0;
    const dailyB = pb ? (pb['_xerpDaily'] || 0) : 0;
    const availA = pa ? (typeof pa['가용재고'] === 'number' ? pa['가용재고'] : 0) : 0;
    const availB = pb ? (typeof pb['가용재고'] === 'number' ? pb['가용재고'] : 0) : 0;
    const remainA = dailyA > 0 ? availA / dailyA : 9999;
    const remainB = dailyB > 0 ? availB / dailyB : 9999;
    return remainA - remainB;
  });

  const today = new Date().toISOString().slice(0, 10);
  const created = [];
  const skipped = [];

  // 이번 주 월요일 구하기
  const now = new Date();
  const dayOfWeek = now.getDay() || 7; // 일요일=7
  const monday = new Date(now); monday.setDate(now.getDate() - dayOfWeek + 1); monday.setHours(0,0,0,0);
  const mondayStr = monday.toISOString().slice(0, 10);
  // 거래처별 이번 주 발주 건수 캐시
  const weeklyVendorCount = {};

  for (const item of items) {
    const p = invMap[item.product_code] || invMap[(item.product_code||'').toUpperCase()];
    if (!p || typeof p['가용재고'] !== 'number') { skipped.push({ product_code: item.product_code, reason: '재고 데이터 없음' }); continue; }

    // 생산지 결정
    const origin = p['생산지'] || item.origin || '한국';

    // 전략발주 최적수량 계산
    const calc = await calculateOptimalOrder(item.product_code, p, origin);
    if (calc.skip) { skipped.push({ product_code: item.product_code, reason: calc.reason }); continue; }

    const { orderQty, remainDays } = calc;
    const isUrgent = remainDays <= 14;
    const isDanger = remainDays <= 21;

    // 안전 품목은 발주 안 함 (잔여일 > 21일)
    if (!isDanger) { skipped.push({ product_code: item.product_code, reason: `안전 (잔여 ${Math.round(remainDays)}일, 목표재고 ${(calc.targetStock||0).toLocaleString()})` }); continue; }

    // 거래처별 주간 6건 제한 (긴급은 한도 무시)
    const vendor = item.vendor_name || '';
    if (vendor && !isUrgent) {
      if (!(vendor in weeklyVendorCount)) {
        weeklyVendorCount[vendor] = (await ctx.db.prepare(`SELECT COUNT(*) as cnt FROM po_header WHERE vendor_name=? AND po_date>=? AND status!='cancelled' AND status!='취소'`).get(vendor, mondayStr)).cnt;
      }
      if (weeklyVendorCount[vendor] >= 6) {
        skipped.push({ product_code: item.product_code, reason: `${vendor} 주간 한도 초과 (${weeklyVendorCount[vendor]}/6건)` });
        continue;
      }
    }

    // 미완료 PO가 있는 품목 스킵 (중복발주 방지)
    const pendingPO = await ctx.db.prepare(`
      SELECT h.po_number, h.status FROM po_header h
      JOIN po_items i ON i.po_id = h.po_id
      WHERE i.product_code = ? AND h.status IN ('draft','sent','confirmed','partial','os_pending',
        'draft','발송','확인','수령중','OS등록대기')
      LIMIT 1
    `).get(item.product_code);
    if (pendingPO) { skipped.push({ product_code: item.product_code, reason: `미완료 PO (${pendingPO.po_number})` }); continue; }
    // 입고완료 but XERP 미동기화 (OS번호 미등록) → 스킵
    const receivedNotSynced = await ctx.db.prepare(`
      SELECT h.po_number, SUM(COALESCE(i.received_qty,0)) as recv_qty FROM po_header h
      JOIN po_items i ON i.po_id = h.po_id
      WHERE i.product_code = ? AND h.status = 'received'
        AND (h.os_number IS NULL OR h.os_number = '')
      GROUP BY h.po_number LIMIT 1
    `).get(item.product_code);
    if (receivedNotSynced) { skipped.push({ product_code: item.product_code, reason: `입고완료 XERP미동기화 (${receivedNotSynced.po_number}, ${receivedNotSynced.recv_qty}개)` }); continue; }
    // 거래처 결정: auto_order_items.vendor_name > products.paper_maker 매핑
    let resolvedVendor = vendor;
    if (!resolvedVendor) {
      const prodInfo = await ctx.db.prepare('SELECT paper_maker FROM products WHERE product_code=?').get(item.product_code);
      if (prodInfo && prodInfo.paper_maker) {
        resolvedVendor = ctx.resolveVendor(prodInfo.paper_maker) || '';
      }
    }

    // PO 생성
    const poNumber = await ctx.generatePoNumber();
    // origin 결정
    const _aoOriginProd = await ctx.db.prepare(`SELECT ${ctx._hasEntity.products ? 'origin, legal_entity' : 'origin'} FROM products WHERE product_code=?`).get(item.product_code);
    const _aoOrigin = (_aoOriginProd && _aoOriginProd.origin) || '한국';
    const _aoEntity = (_aoOriginProd && _aoOriginProd.legal_entity === 'dd') ? 'dd' : 'barunson';
    const tx = ctx.db.transaction(async () => {
      const hdr = ctx._hasEntity.po_header
        ? await ctx.db.prepare('INSERT INTO po_header (po_number, po_type, vendor_name, status, total_qty, notes, origin, legal_entity, po_date) VALUES (?,?,?,?,?,?,?,?,date(\'now\',\'localtime\'))').run(
            poNumber, '자동발주', resolvedVendor, 'draft', orderQty, '필수 자동발주', _aoOrigin, _aoEntity)
        : await ctx.db.prepare('INSERT INTO po_header (po_number, po_type, vendor_name, status, total_qty, notes, origin, po_date) VALUES (?,?,?,?,?,?,?,date(\'now\',\'localtime\'))').run(
            poNumber, '자동발주', resolvedVendor, 'draft', orderQty, '필수 자동발주', _aoOrigin);
      await ctx.db.prepare('INSERT INTO po_items (po_id, product_code, brand, process_type, ordered_qty, spec, notes) VALUES (?,?,?,?,?,?,?)').run(
        hdr.lastInsertRowid, item.product_code, p['브랜드'] || '', '', orderQty, '', '자동발주'
      );
      await ctx.db.prepare('UPDATE auto_order_items SET last_ordered_at=? WHERE id=?').run(new Date().toISOString(), item.id);
      // auto_order_items에 vendor_name도 업데이트 (다음번부터 사용)
      if (resolvedVendor && !vendor) {
        await ctx.db.prepare('UPDATE auto_order_items SET vendor_name=? WHERE id=?').run(resolvedVendor, item.id);
      }
      return { po_id: hdr.lastInsertRowid, po_number: poNumber };
    });
    const result = await tx();
    if (resolvedVendor) weeklyVendorCount[resolvedVendor] = (weeklyVendorCount[resolvedVendor] || 0) + 1;

    // 거래처 이메일이 있으면 자동 발송
    let emailSent = false;
    if (resolvedVendor) {
      const vendorInfo = await ctx.db.prepare('SELECT * FROM vendors WHERE name=?').get(resolvedVendor);
      if (vendorInfo && vendorInfo.email) {
        try {
          const po = await ctx.db.prepare('SELECT * FROM po_header WHERE po_id=?').get(result.po_id);
          const poItems = await ctx.db.prepare('SELECT * FROM po_items WHERE po_id=?').all(result.po_id);
          await ctx.sendPOEmail(po, poItems, vendorInfo.email, vendorInfo.name, false, vendorInfo.email_cc || '');
          await ctx.db.prepare("UPDATE po_header SET status='sent' WHERE po_id=?").run(result.po_id);
          emailSent = true;
        } catch (emailErr) {
          console.warn(`자동발주 이메일 실패 (${item.product_code}):`, emailErr.message);
        }
      }
    }

    created.push({ product_code: item.product_code, ...result, order_qty: orderQty, vendor: resolvedVendor, email_sent: emailSent });
  }
  ctx.ok(res, { created, skipped, checked: items.length });
});

// POST /api/auto-order/run-scheduler — 자동발주 스케줄러 수동 즉시 실행
router.post('/api/auto-order/run-scheduler', async (req, res, parsed) => {
  try {
    await ctx.runAutoOrderScheduler();
    ctx.ok(res, { success: true, message: '자동발주 스케줄러 수동 실행 완료' });
  } catch(e) {
    ctx.fail(res, 500, '스케줄러 실행 실패: ' + e.message);
  }
});

// POST /api/auto-order/run-shipment-check — 출고일 이메일 체크 수동 실행
router.post('/api/auto-order/run-shipment-check', async (req, res, parsed) => {
  try {
    await ctx.runShipmentEmailCheck();
    ctx.ok(res, { success: true, message: '출고일 이메일 체크 완료' });
  } catch(e) {
    ctx.fail(res, 500, '출고일 체크 실패: ' + e.message);
  }
});

module.exports = { router };
