// routes/inventory.js — 재고/XERP 관련 라우트 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ── 모듈 로컬 상태 (캐시, 동기화 플래그) ──
let xerpInventoryCaches = {};   // {company: {data, time}}
let xerpInventoryCache = null;
let xerpInventoryCacheTime = 0;
let xerpUsageCache = null;
let xerpUsageCacheTime = 0;
let inMemorySyncState = { running: false, done_at: null, count: 0, error: null };

// ── 헬퍼 ──
function _fmtYMD(d) {
  return d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
}

// ════════════════════════════════════════════════════════════════════
//  XERP 실시간 재고 API (mmInventory + 월출고 통합)
// ════════════════════════════════════════════════════════════════════

router.get('/api/xerp-inventory', async (req, res, parsed) => {
  const db = ctx.db;
  const sql = ctx.sql;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;

  // 법인 파라미터 (all/barunson/dd)
  const company = parsed.searchParams.get('company') || 'all';
  const forceRefresh = parsed.searchParams.get('refresh') === '1';

  // ★ 1단계: Snapshot 우선 조회 (2026-04 재도입)
  let snapTableExists = true;
  if (!forceRefresh) {
    try {
      const snapCount = await db.prepare("SELECT COUNT(*) AS cnt FROM inventory_snapshot").get();
      if (snapCount && snapCount.cnt > 0) {
        // entity 필터
        let entityFilter = '';
        if (company === 'barunson') entityFilter = " AND legal_entity = 'barunson'";
        else if (company === 'dd') entityFilter = " AND legal_entity = 'dd'";

        const snapRows = await db.prepare(`SELECT * FROM inventory_snapshot WHERE 1=1${entityFilter}`).all();
        const snapMap = {};
        for (const s of snapRows) snapMap[s.product_code] = s;

        // Local products 로 메타 보강
        const productFilterParts = ["status IN ('active','inactive')"];
        if (company === 'barunson') productFilterParts.push("(product_code NOT LIKE 'DD%' AND origin != 'DD')");
        else if (company === 'dd') productFilterParts.push("(product_code LIKE 'DD%' OR origin = 'DD')");
        const productFilter = productFilterParts.join(' AND ');
        const products = await db.prepare(
          `SELECT product_code, product_name, brand, origin, material_code, material_name, cut_spec, jopan, paper_maker, post_vendor, spec FROM products WHERE ${productFilter}`
        ).all();

        const out = [];
        let latestSync = '';
        for (const p of products) {
          const code = (p.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
          const s = snapMap[code] || {};
          if (s.synced_at && (!latestSync || s.synced_at > latestSync)) latestSync = s.synced_at;
          const isDD = (code.startsWith('DD') || p.origin === 'DD');
          out.push({
            '제품코드': code,
            '품목명': p.product_name || s.item_name || '',
            '브랜드': p.brand || '',
            '생산지': p.origin || '',
            '현재고': s.current_stock || 0,
            '가용재고': s.current_stock || 0,
            '요청량': 0,
            '_xerpMonthly': s.monthly_out || 0,
            '_xerpDaily': s.daily_out || 0,
            '_xerpTotal3m': s.total_3m || 0,
            '_원자재코드': p.material_code || '',
            '_원재료용지명': p.material_name || '',
            '_절': p.cut_spec || '',
            '_조판': p.jopan || '',
            '_원지사': p.paper_maker || '',
            '_후공정업체': p.post_vendor || '',
            '_규격': p.spec || '',
            '_warehouses': (() => { try { return s.warehouses_json ? JSON.parse(s.warehouses_json) || {} : {}; } catch (_) { return {}; } })(),
            'legal_entity': isDD ? 'dd' : 'barunson',
            '_invSource': s.synced_at ? 'snapshot' : 'no-sync',
            '_siteCode': s.site_code || (isDD ? 'BHC2' : 'BK10'),
            '_snapshotAt': s.synced_at || ''
          });
        }
        console.log(`[xerp-inventory] snapshot 조회: ${out.length}개 반환 (snap 보유 ${snapRows.length}, 최종 sync: ${latestSync || '-'})`);
        ok(res, { products: out, updated: latestSync || new Date().toISOString(), count: out.length, source: 'snapshot' });
        return;
      }
      // 테이블은 있는데 비어있음 → products-only fallback
      console.log('[xerp-inventory] snapshot 테이블 비어있음 — products-only fallback 로 목록 표시');
      try {
        const _emptyFilterParts = ["status IN ('active','inactive')"];
        if (company === 'barunson') _emptyFilterParts.push("(product_code NOT LIKE 'DD%' AND origin != 'DD')");
        else if (company === 'dd') _emptyFilterParts.push("(product_code LIKE 'DD%' OR origin = 'DD')");
        const _emptyRows = await db.prepare(
          `SELECT product_code, product_name, brand, origin, material_code, material_name, cut_spec, jopan, paper_maker, post_vendor, spec FROM products WHERE ${_emptyFilterParts.join(' AND ')}`
        ).all();
        const _emptyOut = _emptyRows.map(p => {
          const code = (p.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
          const isDD = code.startsWith('DD') || p.origin === 'DD';
          return {
            '제품코드': code, '품목명': p.product_name || '', '브랜드': p.brand || '',
            '생산지': p.origin || '', '현재고': 0, '가용재고': 0, '요청량': 0,
            '_xerpMonthly': 0, '_xerpDaily': 0, '_xerpTotal3m': 0,
            '_원자재코드': p.material_code || '', '_원재료용지명': p.material_name || '',
            '_절': p.cut_spec || '', '_조판': p.jopan || '', '_원지사': p.paper_maker || '',
            '_후공정업체': p.post_vendor || '', '_규격': p.spec || '', '_warehouses': {},
            'legal_entity': isDD ? 'dd' : 'barunson',
            '_invSource': 'empty-snapshot', '_siteCode': isDD ? 'BHC2' : 'BK10'
          };
        });
        ok(res, { products: _emptyOut, updated: new Date().toISOString(), count: _emptyOut.length, source: 'empty-snapshot', message: '아직 동기화된 데이터가 없습니다. 상단 [DB 동기화] 버튼을 눌러주세요. (현재 재고 0 으로 표시)' });
        return;
      } catch (_fbErr) {
        console.error('[xerp-inventory] empty-snapshot fallback 실패:', _fbErr.message);
        ok(res, { products: [], updated: new Date().toISOString(), count: 0, source: 'empty-snapshot', message: '아직 동기화된 데이터가 없습니다. 상단 [DB 동기화] 버튼을 눌러주세요.' });
        return;
      }
    } catch (e) {
      if (/does not exist|relation.*not exist/i.test(e.message)) {
        snapTableExists = false;
        console.warn('[xerp-inventory] snapshot 테이블 미존재:', e.message);
      } else {
        fail(res, 500, 'snapshot 조회 오류: ' + e.message);
        return;
      }
    }
  }

  // ★ 2단계: Live XERP 쿼리 경로
  const now = Date.now();
  if (!xerpInventoryCaches) xerpInventoryCaches = {};
  const cacheEntry = xerpInventoryCaches[company];
  if (!forceRefresh && cacheEntry && now - cacheEntry.time < 600000) {
    ok(res, cacheEntry.data);
    return;
  }

  // snapshot 도 없고 캐시도 없고 refresh=1 도 아니면 → products-only 응답
  if (!forceRefresh && !snapTableExists) {
    try {
      const productFilterParts = ["status IN ('active','inactive')"];
      if (company === 'barunson') productFilterParts.push("(product_code NOT LIKE 'DD%' AND origin != 'DD')");
      else if (company === 'dd') productFilterParts.push("(product_code LIKE 'DD%' OR origin = 'DD')");
      const productFilter = productFilterParts.join(' AND ');
      const products = await db.prepare(
        `SELECT product_code, product_name, brand, origin, material_code, material_name, cut_spec, jopan, paper_maker, post_vendor FROM products WHERE ${productFilter}`
      ).all();
      const out = products.map(p => {
        const code = (p.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
        const isDD = code.startsWith('DD') || p.origin === 'DD';
        return {
          '제품코드': code,
          '품목명': p.product_name || '',
          '브랜드': p.brand || '',
          '생산지': p.origin || '',
          '현재고': 0, '가용재고': 0, '요청량': 0,
          '_xerpMonthly': 0, '_xerpDaily': 0, '_xerpTotal3m': 0,
          '_원자재코드': p.material_code || '',
          '_원재료용지명': p.material_name || '',
          '_절': p.cut_spec || '', '_조판': p.jopan || '',
          '_원지사': p.paper_maker || '',
          '_후공정업체': p.post_vendor || '',
          'legal_entity': isDD ? 'dd' : 'barunson',
          '_invSource': 'products-only',
          '_siteCode': isDD ? 'BHC2' : 'BK10'
        };
      });
      console.log(`[xerp-inventory] snapshot 없음 + 캐시 없음 → products-only 응답: ${out.length}개`);
      ok(res, { products: out, updated: new Date().toISOString(), count: out.length, source: 'empty-snapshot', message: 'XERP 재고/출고 데이터 없음. 상단 [DB 동기화] 버튼을 눌러주세요.' });
      return;
    } catch (e) {
      console.error('[xerp-inventory] products-only 조회 실패:', e.message);
    }
  }

  // 여기까지 왔다면 refresh=1. live XERP 쿼리 진행.
  const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;
  await ctx.ensureXerpPool().catch(() => null);

  // ── 내부 헬퍼: 특정 법인의 재고/출고를 해당 DB+SiteCode에서 조회 ──
  async function fetchCompanyInventory(legalEntity) {
    const isDd = legalEntity === 'dd';
    const originFilter = isDd
      ? "(product_code LIKE 'DD%' OR origin = 'DD')"
      : "(product_code NOT LIKE 'DD%' AND origin != 'DD')";
    const statusFilter = isDd
      ? "(status = 'active' OR status = 'inactive')"
      : "status = 'active'";
    let _hasTempCodeFci = false;
    if (isDd) {
      try { await db.prepare('SELECT temp_code FROM products LIMIT 1').get(); _hasTempCodeFci = true; } catch (_) {}
    }
    const _selectCols = `product_code, product_name, brand, origin, material_code, material_name, cut_spec, jopan, paper_maker, post_vendor${(isDd && _hasTempCodeFci) ? ', temp_code' : ''}`;
    const rawRegistered = await db.prepare(
      `SELECT ${_selectCols} FROM products WHERE ${statusFilter} AND ${originFilter}`
    ).all();
    if (!rawRegistered.length) return [];

    for (const p of rawRegistered) {
      p.product_code = (p.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
    }

    const _seenCodes = new Set();
    const registeredProducts = [];
    let _dupSkipped = 0;
    for (const p of rawRegistered) {
      const c = p.product_code;
      if (!c) continue;
      if (_seenCodes.has(c)) { _dupSkipped++; continue; }
      _seenCodes.add(c);
      registeredProducts.push(p);
    }
    if (_dupSkipped > 0) console.warn(`[xerp-inv ${legalEntity}] products 테이블 중복 ${_dupSkipped}건 skip (첫 row 유지)`);

    const productCodes = registeredProducts.map(p => p.product_code);
    const validCodeCount = productCodes.filter(c => /^[A-Za-z0-9_\-]+$/.test(c)).length;
    if (!validCodeCount) return [];

    const dbName = isDd ? 'BHC' : 'XERP';
    const inventoryFilter = isDd ? "ItemCode LIKE 'DD%'" : `SiteCode = '${XERP_SITE_CODE}'`;
    const shipmentFilter = isDd ? "ItemCode LIKE 'DD%'" : `SiteCode = '${XERP_SITE_CODE}'`;
    const siteCode = isDd ? 'BHC2' : 'BK10';
    const workPool = ctx.getXerpPool ? ctx.getXerpPool() : null;

    try {
      if (!workPool) throw new Error('XERP pool not connected');

      const validCodeSet = new Set(productCodes.filter(c => /^[A-Za-z0-9_\-]+$/.test(c)).map(c => c.toUpperCase()));

      const normalizeCode = c => (c || '').toUpperCase().replace(/[_\-\s]/g, '');
      const normMap = {};
      for (const c of productCodes) {
        if (!/^[A-Za-z0-9_\-]+$/.test(c)) continue;
        const k = normalizeCode(c);
        if (k && !normMap[k]) normMap[k] = c.toUpperCase();
      }
      const tempCodeMap = {};
      const tempCodeMapNorm = {};
      if (isDd && _hasTempCodeFci) {
        for (const p of registeredProducts) {
          const tc = (p.temp_code || '').toString().trim();
          if (!tc) continue;
          const tcUp = tc.toUpperCase();
          if (!tempCodeMap[tcUp]) tempCodeMap[tcUp] = p.product_code.toUpperCase();
          const tcNorm = normalizeCode(tcUp);
          if (tcNorm && !tempCodeMapNorm[tcNorm]) tempCodeMapNorm[tcNorm] = p.product_code.toUpperCase();
        }
      }
      const resolveLocal = extCode => {
        const upper = (extCode || '').toUpperCase();
        if (validCodeSet.has(upper)) return upper;
        if (isDd && tempCodeMap[upper]) return tempCodeMap[upper];
        const norm = normalizeCode(upper);
        if (!norm) return null;
        if (normMap[norm]) return normMap[norm];
        if (isDd && tempCodeMapNorm[norm]) return tempCodeMapNorm[norm];
        return null;
      };

      // 1. 현재고
      const invMap = {};
      const invByWh = {};
      const invSiteDist = {};
      let _normMatched = 0;
      try {
        const req = workPool.request();
        req.timeout = 120000;
        const r = await req.query(`
          SELECT RTRIM(ItemCode) AS item_code,
                 RTRIM(WhCode)   AS wh_code,
                 RTRIM(SiteCode) AS site_code,
                 SUM(CASE WHEN OhQty > 0 THEN OhQty ELSE 0 END) AS oh_qty
          FROM mmInventory WITH (NOLOCK)
          WHERE ${inventoryFilter}
          GROUP BY RTRIM(ItemCode), RTRIM(WhCode), RTRIM(SiteCode)
        `);
        for (const row of r.recordset) {
          const rawCode = (row.item_code || '').trim().toUpperCase();
          const code = resolveLocal(rawCode);
          const wh = (row.wh_code || '').trim();
          const sc = (row.site_code || '').trim();
          const qty = Math.round(row.oh_qty || 0);
          if (!code) continue;
          if (code !== rawCode) _normMatched++;
          invMap[code] = (invMap[code] || 0) + qty;
          if (wh && qty > 0) {
            if (!invByWh[code]) invByWh[code] = {};
            invByWh[code][wh] = (invByWh[code][wh] || 0) + qty;
          }
          if (sc) invSiteDist[sc] = (invSiteDist[sc] || 0) + 1;
        }
        console.log(`[xerp-inv ${legalEntity}] 현재고 단일쿼리 성공: ${Object.keys(invMap).length}개 품목 매칭 (정규화 보정 ${_normMatched}건), 창고-품목 조합 ${r.recordset.length}건, SiteCode 분포: ${JSON.stringify(invSiteDist)}`);
      } catch (invErr) {
        console.error(`[xerp-inv ${legalEntity}] 현재고 단일쿼리 실패 — 전체 sync 중단:`, invErr.message);
        throw invErr;
      }

      // 2. 최근 3개월 출고
      const today = new Date();
      const start3m = new Date(today); start3m.setMonth(start3m.getMonth() - 3);
      const fmt = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
      const shipMap = {};
      const shipSiteDist = {};
      if (isDd) {
        try {
          const ddP = ctx.getDdPool ? ctx.getDdPool() : null;
          if (!ddP) throw new Error('DD MySQL pool unavailable (DD_DB_SERVER 미설정 또는 연결 실패)');
          const startISO = start3m.toISOString().slice(0, 10);
          const endISO = today.toISOString().slice(0, 10);
          const [rows] = await ddP.query(
            `SELECT oi.product_code AS item_code, SUM(oi.qty) AS total_qty
             FROM order_items oi INNER JOIN orders o ON oi.order_id = o.id
             WHERE o.created_at >= ? AND o.created_at < ?
               AND o.order_state <> 'C'
               AND oi.product_code IS NOT NULL AND oi.product_code <> ''
             GROUP BY oi.product_code`,
            [startISO, endISO]
          );
          let _shipNormMatched = 0;
          let _ddRowCount = 0;
          let _ddUnmatched = 0;
          for (const row of (rows || [])) {
            _ddRowCount++;
            const rawCode = (row.item_code || '').toString().trim().toUpperCase();
            const code = resolveLocal(rawCode);
            if (!code) { _ddUnmatched++; continue; }
            if (code !== rawCode) _shipNormMatched++;
            const total = Math.round(Number(row.total_qty) || 0);
            const prev = shipMap[code] || { total: 0 };
            const newTotal = prev.total + total;
            shipMap[code] = { total: newTotal, monthly: Math.round(newTotal / 3), daily: Math.round(newTotal / 90) };
          }
          shipSiteDist['DD-MySQL'] = _ddRowCount;
          console.log(`[xerp-inv ${legalEntity}] 출고 DD MySQL 쿼리 성공: rows=${_ddRowCount}, 매칭=${Object.keys(shipMap).length} (정규화/temp_code 보정 ${_shipNormMatched}건), 미매칭=${_ddUnmatched}, 기간=${startISO}~${endISO}`);
        } catch (shipErr) {
          console.warn(`[xerp-inv ${legalEntity}] 출고 DD MySQL 쿼리 실패 — 출고 0 으로 진행:`, shipErr.message);
        }
      } else {
        try {
          const req = workPool.request()
            .input('start3m', sql.NChar(16), fmt(start3m))
            .input('today', sql.NChar(16), fmt(today));
          req.timeout = 120000;
          const r = await req.query(`
            SELECT RTRIM(ItemCode) AS item_code,
                   RTRIM(SiteCode) AS site_code,
                   SUM(InoutQty)   AS total_qty
            FROM mmInoutItem WITH (NOLOCK)
            WHERE ${shipmentFilter} AND InoutGubun = 'SO'
              AND InoutDate >= @start3m AND InoutDate < @today
            GROUP BY RTRIM(ItemCode), RTRIM(SiteCode)
          `);
          let _shipNormMatched = 0;
          for (const row of r.recordset) {
            const rawCode = (row.item_code || '').trim().toUpperCase();
            const code = resolveLocal(rawCode);
            const sc = (row.site_code || '').trim();
            if (code) {
              if (code !== rawCode) _shipNormMatched++;
              const total = Math.round(row.total_qty || 0);
              const prev = shipMap[code] || { total: 0 };
              const newTotal = prev.total + total;
              shipMap[code] = { total: newTotal, monthly: Math.round(newTotal / 3), daily: Math.round(newTotal / 90) };
              if (sc) shipSiteDist[sc] = (shipSiteDist[sc] || 0) + 1;
            }
          }
          console.log(`[xerp-inv ${legalEntity}] 출고 단일쿼리 성공: ${Object.keys(shipMap).length}개 매칭 (정규화 보정 ${_shipNormMatched}건, 3개월치), SiteCode 분포: ${JSON.stringify(shipSiteDist)}`);
        } catch (shipErr) {
          console.warn(`[xerp-inv ${legalEntity}] 출고 단일쿼리 실패 — 출고 0 으로 진행:`, shipErr.message);
        }
      }

      // 3. 품목명 (S2_Card) — 바른손 모드에서만
      let itemNames = {};
      if (!isDd) {
        try {
          const barShopConfig = ctx.barShopConfig || {};
          const bar1Pool = new sql.ConnectionPool(barShopConfig);
          await bar1Pool.connect();
          try {
            const req = bar1Pool.request();
            req.timeout = 60000;
            const r = await req.query(`SELECT RTRIM(Card_Code) AS code, Card_Name FROM S2_Card`);
            r.recordset.forEach(row => {
              const code = (row.code || '').trim().toUpperCase();
              if (code && validCodeSet.has(code)) {
                itemNames[code] = (row.Card_Name || '').trim();
              }
            });
            console.log(`[xerp-inv ${legalEntity}] 품목명 단일쿼리 성공: ${Object.keys(itemNames).length}개 매칭`);
          } catch (nameErr) { console.warn(`[xerp-inv ${legalEntity}] 품목명 쿼리 실패:`, nameErr.message); }
          await bar1Pool.close();
        } catch (e) { console.warn('품목명 풀 생성 실패:', e.message); }
      }

      // 4. 품목 병합
      const out = [];
      for (const p of registeredProducts) {
        const code = p.product_code;
        const codeUpper = code.toUpperCase();
        const ohQty = invMap[codeUpper] || 0;
        const ship = shipMap[codeUpper] || { total: 0, monthly: 0, daily: 0 };
        const whMap = invByWh[codeUpper] || {};
        out.push({
          '제품코드': code,
          '품목명': p.product_name || itemNames[codeUpper] || '',
          '브랜드': p.brand || '',
          '생산지': p.origin || '',
          '현재고': ohQty,
          '가용재고': ohQty,
          '요청량': 0,
          '_xerpMonthly': ship.monthly,
          '_xerpDaily': ship.daily,
          '_xerpTotal3m': ship.total,
          '_원자재코드': p.material_code || '',
          '_원재료용지명': p.material_name || '',
          '_절': p.cut_spec || '',
          '_조판': p.jopan || '',
          '_원지사': p.paper_maker || '',
          '_후공정업체': p.post_vendor || '',
          '_warehouses': whMap,
          'legal_entity': isDd ? 'dd' : 'barunson',
          '_invSource': isDd ? 'XERP+DD' : dbName,
          '_siteCode': siteCode
        });
      }
      console.log(`${dbName}/${siteCode} 재고 로드 (${legalEntity}): ${out.length}개 품목`);
      return out;
    } catch (xerpErr) {
      console.warn(`[xerp-inventory] ${dbName}/${siteCode} XERP 실패 — products 테이블 폴백: ${xerpErr.message}`);
      return registeredProducts.map(p => ({
        '제품코드': p.product_code,
        '품목명': p.product_name || '',
        '브랜드': p.brand || '',
        '생산지': p.origin || '',
        '현재고': 0,
        '가용재고': 0,
        '요청량': 0,
        '_xerpMonthly': 0,
        '_xerpDaily': 0,
        '_xerpTotal3m': 0,
        '_원자재코드': p.material_code || '',
        '_원재료용지명': p.material_name || '',
        '_절': p.cut_spec || '',
        '_조판': p.jopan || '',
        '_원지사': p.paper_maker || '',
        '_후공정업체': p.post_vendor || '',
        'legal_entity': isDd ? 'dd' : 'barunson',
        '_invSource': 'fallback:products',
        '_siteCode': siteCode,
        '_xerpError': xerpErr.message
      }));
    }
  }

  try {
    // ★ Fix #5: 전체 live 쿼리에 하드 타임아웃 45s 부여.
    const HARD_BUDGET_MS = 45_000;
    const TIMEOUT_SENTINEL = Symbol('xerp_live_timeout');
    const withBudget = (p) => Promise.race([
      p,
      new Promise(resolve => setTimeout(() => resolve(TIMEOUT_SENTINEL), HARD_BUDGET_MS))
    ]);

    let products = [];
    let liveTimedOut = false;
    if (company === 'barunson') {
      const r = await withBudget(fetchCompanyInventory('barunson'));
      if (r === TIMEOUT_SENTINEL) liveTimedOut = true; else products = r;
    } else if (company === 'dd') {
      const r = await withBudget(fetchCompanyInventory('dd'));
      if (r === TIMEOUT_SENTINEL) liveTimedOut = true; else products = r;
    } else {
      const combined = withBudget(Promise.all([
        fetchCompanyInventory('barunson').catch(e => { console.error('barunson 조회 실패:', e.message); return []; }),
        fetchCompanyInventory('dd').catch(e => { console.error('dd 조회 실패:', e.message); return []; })
      ]));
      const r = await combined;
      if (r === TIMEOUT_SENTINEL) liveTimedOut = true;
      else { const [bs, dd] = r; products = [...bs, ...dd]; }
    }

    if (liveTimedOut) {
      console.warn(`[xerp-inventory] live 45s 타임아웃 — products-only fallback (company=${company})`);
      try {
        const productFilterParts = ["status IN ('active','inactive')"];
        if (company === 'barunson') productFilterParts.push("(product_code NOT LIKE 'DD%' AND origin != 'DD')");
        else if (company === 'dd') productFilterParts.push("(product_code LIKE 'DD%' OR origin = 'DD')");
        const fbRows = await db.prepare(
          `SELECT product_code, product_name, brand, origin, material_code, material_name, cut_spec, jopan, paper_maker, post_vendor FROM products WHERE ${productFilterParts.join(' AND ')}`
        ).all();
        const fbOut = fbRows.map(p => {
          const code = (p.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
          const isDD = code.startsWith('DD') || p.origin === 'DD';
          return {
            '제품코드': code, '품목명': p.product_name || '', '브랜드': p.brand || '',
            '생산지': p.origin || '', '현재고': 0, '가용재고': 0, '요청량': 0,
            '_xerpMonthly': 0, '_xerpDaily': 0, '_xerpTotal3m': 0,
            '_원자재코드': p.material_code || '', '_원재료용지명': p.material_name || '',
            '_절': p.cut_spec || '', '_조판': p.jopan || '', '_원지사': p.paper_maker || '',
            '_후공정업체': p.post_vendor || '',
            'legal_entity': isDD ? 'dd' : 'barunson',
            '_invSource': 'live-timeout', '_siteCode': isDD ? 'BHC2' : 'BK10'
          };
        });
        ok(res, { products: fbOut, updated: new Date().toISOString(), count: fbOut.length, source: 'live-timeout', message: 'XERP 응답 지연 (45s 초과) — 재고 수치 없이 목록만 표시. 다시 시도해주세요.' });
        return;
      } catch (fbErr) {
        fail(res, 504, 'XERP 응답 지연 (45s) + products-only fallback 실패: ' + fbErr.message);
        return;
      }
    }

    if (!products.length) {
      ok(res, { products: [], updated: new Date().toISOString(), count: 0 });
      return;
    }

    const cacheData = { products, updated: new Date().toISOString(), count: products.length };
    xerpInventoryCaches[company] = { data: cacheData, time: now };
    if (company === 'barunson') { xerpInventoryCache = cacheData; xerpInventoryCacheTime = now; }
    console.log(`재고 API 완료 (company=${company}): ${products.length}개 품목`);
    ok(res, cacheData);
  } catch (e) {
    console.error('재고 조회 오류:', e.message, '(company=' + company + ')');
    const isXerpRelated = (company === 'barunson' || company === 'all');
    if (isXerpRelated && (e.message.includes('imeout') || e.message.includes('closed') || e.message.includes('ECONN'))) {
      const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;
      try { if (xerpPool) await xerpPool.close(); } catch (_) {}
      try {
        const xerpConfig = ctx.xerpConfig || {};
        const newPool = await sql.connect(xerpConfig);
        if (ctx.setXerpPool) ctx.setXerpPool(newPool);
        console.log('XERP 재연결 완료');
      } catch (re) { console.error('XERP 재연결 실패:', re.message); }
    }
    fail(res, 500, '재고 조회 오류: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  품목별 발주 트래킹 API (중복발주 방지 — 입고중 + 입고완료 미동기화)
// ════════════════════════════════════════════════════════════════════

router.get('/api/inventory/pending-orders', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;

  try {
    // 1) 진행중 PO (미입고 잔량) — draft~partial
    const pendingRows = await db.prepare(`
      SELECT i.product_code,
             SUM(i.ordered_qty - COALESCE(i.received_qty,0)) as pending_qty,
             SUM(i.ordered_qty) as ordered_qty,
             SUM(COALESCE(i.received_qty,0)) as partial_received_qty,
             STRING_AGG(DISTINCT h.os_number, ',') as os_numbers,
             STRING_AGG(DISTINCT h.po_number, ',') as po_numbers,
             STRING_AGG(DISTINCT h.po_type, ',') as po_types,
             MIN(h.due_date) as earliest_due,
             MAX(h.status) as latest_status,
             MAX(h.po_date) as latest_po_date
      FROM po_items i
      JOIN po_header h ON h.po_id = i.po_id
      WHERE h.status NOT IN ('cancelled','completed','received')
        AND (i.ordered_qty - COALESCE(i.received_qty,0)) > 0
      GROUP BY i.product_code
    `).all();

    // 2) 입고완료 but XERP 미동기화 (os_number 미등록 or os_registered 아닌 received PO)
    const receivedRows = await db.prepare(`
      SELECT i.product_code,
             SUM(COALESCE(i.received_qty,0)) as received_qty,
             STRING_AGG(DISTINCT h.po_number, ',') as po_numbers,
             MAX(h.updated_at) as completed_at
      FROM po_items i
      JOIN po_header h ON h.po_id = i.po_id
      WHERE h.status = 'received'
        AND COALESCE(i.received_qty,0) > 0
        AND (h.os_number IS NULL OR h.os_number = '')
      GROUP BY i.product_code
    `).all();

    const map = {};
    pendingRows.forEach(r => {
      map[r.product_code] = {
        pending_qty: r.pending_qty || 0,
        ordered_qty: r.ordered_qty || 0,
        partial_received_qty: r.partial_received_qty || 0,
        received_not_synced: 0,
        os_numbers: (r.os_numbers || '').split(',').filter(Boolean),
        po_numbers: (r.po_numbers || '').split(',').filter(Boolean),
        po_types: (r.po_types || '').split(',').filter(Boolean),
        earliest_due: r.earliest_due || '',
        status: r.latest_status || '',
        last_order_date: r.latest_po_date || ''
      };
    });
    // 입고완료(미동기화) 수량 합산
    receivedRows.forEach(r => {
      if (!map[r.product_code]) {
        map[r.product_code] = {
          pending_qty: 0, ordered_qty: 0, partial_received_qty: 0,
          received_not_synced: 0,
          os_numbers: [], po_numbers: [], po_types: [],
          earliest_due: '', status: 'received', last_order_date: ''
        };
      }
      map[r.product_code].received_not_synced = r.received_qty || 0;
      const extraPOs = (r.po_numbers || '').split(',').filter(Boolean);
      extraPOs.forEach(p => {
        if (!map[r.product_code].po_numbers.includes(p)) map[r.product_code].po_numbers.push(p);
      });
    });
    ok(res, map);
  } catch (e) { console.error('pending-orders error:', e.message); ok(res, {}); }
});

// ════════════════════════════════════════════════════════════════════
//  Snapshot 동기화 API (2026-04 재도입)
//  POST /api/sync/xerp-inventory
// ════════════════════════════════════════════════════════════════════

router.post('/api/sync/xerp-inventory', async (req, res, parsed) => {
  const db = ctx.db;
  const sql = ctx.sql;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const readJSON = ctx.readJSON;
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;

  // 중복 실행 방지 (7분 이상은 자동 stale 처리)
  try {
    await db.prepare("UPDATE sync_log SET status='failed', error_msg='stale 자동 해제', finished_at=datetime('now','localtime') WHERE sync_type='xerp_inventory' AND status='running' AND (started_at::timestamp AT TIME ZONE 'Asia/Seoul') < NOW() - INTERVAL '7 minutes'").run();
  } catch (_) {}
  try {
    const running = await db.prepare("SELECT id, started_at FROM sync_log WHERE sync_type='xerp_inventory' AND status='running' LIMIT 1").get();
    if (running) { fail(res, 409, '이미 동기화 진행 중 (시작: ' + running.started_at + ')'); return; }
  } catch (_) {}

  let syncLogId = null;
  let triggeredBy = 'manual';
  let snapshotDisabled = false;
  const body = await readJSON(req).catch(() => ({}));
  triggeredBy = body?.triggered_by || 'manual';
  try {
    const info = await db.prepare("INSERT INTO sync_log (sync_type, status, triggered_by) VALUES (?,?,?)").run('xerp_inventory', 'running', triggeredBy);
    syncLogId = info.lastInsertRowid;
    console.log('[sync] 시작 sync_log_id=' + syncLogId + ' (trigger=' + triggeredBy + ')');
  } catch (e) {
    console.warn('[sync] sync_log INSERT 1차 실패 원문:', e.message);
    console.warn('[sync] 자가복구 시도 — 테이블 재생성 + 누락 컬럼 보강');
    try {
      await db.exec(`CREATE TABLE IF NOT EXISTS sync_log (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        sync_type     TEXT NOT NULL,
        started_at    TEXT DEFAULT (datetime('now','localtime')),
        finished_at   TEXT DEFAULT '',
        success_count INTEGER DEFAULT 0,
        fail_count    INTEGER DEFAULT 0,
        status        TEXT DEFAULT 'running',
        error_msg     TEXT DEFAULT '',
        triggered_by  TEXT DEFAULT 'manual'
      )`);
      const _fix = [
        ['triggered_by', "TEXT DEFAULT 'manual'"],
        ['error_msg', "TEXT DEFAULT ''"],
        ['fail_count', "INTEGER DEFAULT 0"],
        ['success_count', "INTEGER DEFAULT 0"],
        ['finished_at', "TEXT DEFAULT ''"],
        ['status', "TEXT DEFAULT 'running'"]
      ];
      for (const [col, type] of _fix) {
        try { await db.exec(`ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch (_) {}
      }
      const info2 = await db.prepare("INSERT INTO sync_log (sync_type, status, triggered_by) VALUES (?,?,?)").run('xerp_inventory', 'running', triggeredBy);
      syncLogId = info2.lastInsertRowid;
      console.log('[sync] 자가복구 성공 — sync_log_id=' + syncLogId);
    } catch (e2) {
      console.error('[sync] sync_log 자가복구 실패:', e2.message);
      fail(res, 500, 'sync_log 기록 실패 (자가복구도 실패): ' + e2.message + ' — PG 관리자에게 CREATE TABLE 권한 요청 필요');
      return;
    }
  }

  // 즉시 202 반환
  try {
    res.writeHead(202, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({
      ok: true,
      data: {
        sync_log_id: syncLogId,
        status: snapshotDisabled ? 'started-live-only' : 'started',
        triggered_by: triggeredBy,
        snapshot_disabled: snapshotDisabled,
        hint: snapshotDisabled ? 'snapshot 테이블 미존재 — live 리프레시만 수행. 관리자에게 CREATE TABLE + GRANT 요청 필요' : undefined
      }
    }));
  } catch (_) {}

  // 백그라운드 실행
  (async () => {
    const t0 = Date.now();
    if (snapshotDisabled) { inMemorySyncState = { running: true, done_at: null, count: 0, error: null }; }
    try {
      await ctx.ensureXerpPool().catch(() => null);

      const ctrl = new AbortController();
      const timeoutHandle = setTimeout(() => ctrl.abort(new Error('sync bg timeout 5m')), 5 * 60 * 1000);
      const PORT = ctx.PORT || process.env.PORT || 4000;
      const selfBase = 'http://127.0.0.1:' + PORT;
      const r = await fetch(selfBase + '/api/xerp-inventory?refresh=1&company=all', { signal: ctrl.signal }).catch(e => ({ __err: e }));
      clearTimeout(timeoutHandle);
      if (r.__err) throw r.__err;
      const j = await r.json();
      if (!j.ok) throw new Error('xerp-inventory live 호출 실패: ' + (j.error || ''));
      const rows = (j.data && Array.isArray(j.data.products)) ? j.data.products : (Array.isArray(j.data) ? j.data : []);

      const allFallback = rows.length > 0 && rows.every(p => p['_invSource'] === 'fallback:products');
      if (allFallback || rows.length === 0) {
        console.warn('[sync bg] 모든 데이터 fallback/empty — snapshot 갱신 스킵');
        if (!snapshotDisabled) {
          try { await db.prepare("UPDATE sync_log SET status='failed', error_msg=?, finished_at=datetime('now','localtime') WHERE id=?").run('XERP 전체 실패 — 기존 snapshot 유지', syncLogId); } catch (_) {}
        }
        return;
      }

      if (snapshotDisabled) {
        inMemorySyncState = { running: false, done_at: new Date().toISOString(), count: rows.length, error: null };
        console.log(`[sync bg] snapshot 비활성 모드 — live 리프레시만 수행 (${rows.length}개 받음, 테이블 없어 UPSERT 스킵)`);
        return;
      }

      // ★ 자가복구: inventory_snapshot 테이블/컬럼 선제 보장
      try {
        await db.exec(`CREATE TABLE IF NOT EXISTS inventory_snapshot (
          product_code   TEXT PRIMARY KEY,
          legal_entity   TEXT DEFAULT 'barunson',
          site_code      TEXT DEFAULT 'BK10',
          current_stock  INTEGER DEFAULT 0,
          monthly_out    INTEGER DEFAULT 0,
          daily_out      INTEGER DEFAULT 0,
          total_3m       INTEGER DEFAULT 0,
          item_name      TEXT DEFAULT '',
          synced_at      TEXT DEFAULT (datetime('now','localtime'))
        )`);
        for (const [col, type] of [['legal_entity', "TEXT DEFAULT 'barunson'"], ['site_code', "TEXT DEFAULT 'BK10'"], ['monthly_out', "INTEGER DEFAULT 0"], ['daily_out', "INTEGER DEFAULT 0"], ['total_3m', "INTEGER DEFAULT 0"], ['item_name', "TEXT DEFAULT ''"], ['synced_at', "TEXT DEFAULT ''"]]) {
          try { await db.exec(`ALTER TABLE inventory_snapshot ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch (_) {}
        }
      } catch (_) {}

      // UPSERT
      let successCount = 0;
      let failCount = 0;
      const failedCodes = [];
      const BATCH_SIZE = 200;
      const rowPh = "(?,?,?,?,?,?,?,?,?,datetime('now','localtime'))";
      const onConflict = `ON CONFLICT(product_code) DO UPDATE SET
            legal_entity=excluded.legal_entity,
            site_code=excluded.site_code,
            current_stock=excluded.current_stock,
            monthly_out=excluded.monthly_out,
            daily_out=excluded.daily_out,
            total_3m=excluded.total_3m,
            item_name=CASE WHEN excluded.item_name='' THEN inventory_snapshot.item_name ELSE excluded.item_name END,
            warehouses_json=excluded.warehouses_json,
            synced_at=excluded.synced_at`;
      const rowParams = p => [
        p['제품코드'], p['legal_entity'], p['_siteCode'],
        p['현재고'] || 0, p['_xerpMonthly'] || 0, p['_xerpDaily'] || 0, p['_xerpTotal3m'] || 0,
        p['품목명'] || '',
        p['_warehouses'] ? JSON.stringify(p['_warehouses']) : ''
      ];
      const runUpsert = db.transaction(async () => {
        const singleUpsert = db.prepare(`INSERT INTO inventory_snapshot
          (product_code, legal_entity, site_code, current_stock, monthly_out, daily_out, total_3m, item_name, warehouses_json, synced_at)
          VALUES ${rowPh}
          ${onConflict}`);

        for (let i = 0; i < rows.length; i += BATCH_SIZE) {
          const batch = rows.slice(i, i + BATCH_SIZE);
          const placeholders = batch.map(() => rowPh).join(',');
          const batchSql = `INSERT INTO inventory_snapshot
            (product_code, legal_entity, site_code, current_stock, monthly_out, daily_out, total_3m, item_name, warehouses_json, synced_at)
            VALUES ${placeholders}
            ${onConflict}`;
          const flatParams = batch.flatMap(rowParams);
          try {
            await db.prepare(batchSql).run(...flatParams);
            successCount += batch.length;
          } catch (batchErr) {
            console.warn(`[sync bg] batch ${i}..${i + batch.length - 1} 실패, row-by-row 재시도:`, batchErr.message.split('\n')[0]);
            for (const p of batch) {
              try {
                await singleUpsert.run(...rowParams(p));
                successCount++;
              } catch (e) {
                failCount++;
                if (failedCodes.length < 10) failedCodes.push(p['제품코드'] + ':' + e.message.split('\n')[0]);
              }
            }
          }
        }
      });
      await runUpsert();

      // 캐시 무효화
      try { for (const k in xerpInventoryCaches) delete xerpInventoryCaches[k]; } catch (_) {}

      // ── 규격 1회성 동기화 ──
      let specSyncedCount = 0;
      try {
        const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;
        const needSpec = await db.prepare("SELECT product_code FROM products WHERE (spec IS NULL OR spec = '') AND status IN ('active','inactive')").all();
        const validSpecCodes = (needSpec || []).map(r => (r.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim()).filter(c => /^[A-Za-z0-9_\-]+$/.test(c));
        if (validSpecCodes.length > 0 && xerpPool) {
          const specMap = {};
          const validSpecSet = new Set(validSpecCodes.map(c => c.toUpperCase()));
          const t0spec = Date.now();
          const CHUNK = 1000;
          try {
            for (let i = 0; i < validSpecCodes.length; i += CHUNK) {
              const chunk = validSpecCodes.slice(i, i + CHUNK).map(c => c.toUpperCase());
              const inClause = chunk.map(c => `'${c}'`).join(',');
              const reqQ = xerpPool.request();
              reqQ.timeout = 60000;
              const r = await reqQ.query(`
                SELECT item_code, item_spec FROM (
                  SELECT RTRIM(ItemCode) AS item_code,
                         RTRIM(ItemSpec) AS item_spec,
                         ROW_NUMBER() OVER (PARTITION BY RTRIM(ItemCode) ORDER BY InoutDate DESC, InoutSerNo DESC) AS rn
                  FROM mmInoutItem WITH (NOLOCK)
                  WHERE SiteCode = '${XERP_SITE_CODE}' AND RTRIM(ItemCode) IN (${inClause})
                ) t
                WHERE t.rn = 1 AND t.item_spec <> ''
              `);
              for (const row of (r.recordset || [])) {
                const c = (row.item_code || '').trim();
                const sp = (row.item_spec || '').trim();
                if (c && sp && validSpecSet.has(c.toUpperCase())) specMap[c] = sp;
              }
            }
            const elapsed = ((Date.now() - t0spec) / 1000).toFixed(1);
            console.log(`[sync bg] 규격 IN절 쿼리 성공: ${Object.keys(specMap).length}개 매칭 (후보 ${validSpecCodes.length}개, ${Math.ceil(validSpecCodes.length / CHUNK)} chunk, ${elapsed}s)`);
          } catch (e) {
            console.warn(`[sync bg] 규격 IN절 쿼리 실패:`, e.message);
          }
          if (Object.keys(specMap).length > 0) {
            const updSpec = db.prepare("UPDATE products SET spec = ? WHERE product_code = ? AND (spec IS NULL OR spec = '')");
            const applyTx = db.transaction(async () => {
              for (const [code, spec] of Object.entries(specMap)) {
                try {
                  const info = await updSpec.run(spec, code);
                  if (info && info.changes > 0) specSyncedCount++;
                } catch (_) {}
              }
            });
            await applyTx();
          }
          console.log(`[sync bg] 규격 동기화: ${specSyncedCount}개 품목 채움 (후보 ${validSpecCodes.length}개 중 XERP 발견 ${Object.keys(specMap).length}개)`);
        }
      } catch (specErr) {
        console.warn('[sync bg] 규격 동기화 예외:', specErr.message);
      }

      try {
        await db.prepare("UPDATE sync_log SET status=?, success_count=?, fail_count=?, error_msg=?, finished_at=datetime('now','localtime') WHERE id=?")
          .run(failCount > 0 && successCount === 0 ? 'failed' : 'success', successCount, failCount, failCount > 0 ? ('UPSERT 실패 ' + failCount + '건: ' + failedCodes.join(' | ')).slice(0, 500) : '', syncLogId);
      } catch (_) {}
      console.log(`[sync bg] snapshot 갱신 완료: ${successCount}/${rows.length}개 저장 (실패 ${failCount}, 규격 ${specSyncedCount}개 추가, 총 ${((Date.now() - t0) / 1000).toFixed(1)}s)`);
    } catch (e) {
      console.error('[sync bg] 실패:', e.message);
      if (snapshotDisabled) {
        inMemorySyncState = { running: false, done_at: new Date().toISOString(), count: 0, error: e.message };
      } else {
        try {
          await db.prepare("UPDATE sync_log SET status='failed', error_msg=?, finished_at=datetime('now','localtime') WHERE id=?").run(e.message.slice(0, 500), syncLogId);
        } catch (_) {}
      }
    }
  })().catch(e => console.error('[sync bg] IIFE reject:', e?.message || e));
});

// ════════════════════════════════════════════════════════════════════
//  GET /api/sync/status — 마지막 동기화 시각 / 진행 여부 조회
// ════════════════════════════════════════════════════════════════════

router.get('/api/sync/status', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;

  let lastSuccess = null, running = null, lastFailed = null, snapCount = 0;
  try { lastSuccess = await db.prepare("SELECT started_at, finished_at, success_count, triggered_by FROM sync_log WHERE sync_type='xerp_inventory' AND status='success' ORDER BY id DESC LIMIT 1").get(); } catch (_) {}
  try { running = await db.prepare("SELECT started_at, triggered_by FROM sync_log WHERE sync_type='xerp_inventory' AND status='running' ORDER BY id DESC LIMIT 1").get(); } catch (_) {}
  try { lastFailed = await db.prepare("SELECT started_at, finished_at, error_msg, triggered_by FROM sync_log WHERE sync_type='xerp_inventory' AND status='failed' ORDER BY id DESC LIMIT 1").get(); } catch (_) {}
  try { const c = await db.prepare("SELECT COUNT(*) AS cnt FROM inventory_snapshot").get(); snapCount = c?.cnt || 0; } catch (_) {}
  ok(res, {
    is_running: !!running,
    running_since: running?.started_at || null,
    last_success_at: lastSuccess?.finished_at || null,
    last_success_count: lastSuccess?.success_count || 0,
    last_success_by: lastSuccess?.triggered_by || null,
    last_failed_at: lastFailed?.finished_at || null,
    last_failed_error: lastFailed?.error_msg || null,
    snapshot_count: snapCount,
    in_memory_running: !!inMemorySyncState.running,
    in_memory_done: !!inMemorySyncState.done_at,
    in_memory_done_at: inMemorySyncState.done_at,
    in_memory_count: inMemorySyncState.count || 0,
    in_memory_error: inMemorySyncState.error || null
  });
});

// ════════════════════════════════════════════════════════════════════
//  POST /api/sync/xerp-inventory/reset — 수동 리셋
// ════════════════════════════════════════════════════════════════════

router.post('/api/sync/xerp-inventory/reset', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;

  try {
    const info = await db.prepare("UPDATE sync_log SET status='failed', error_msg='수동 리셋', finished_at=datetime('now','localtime') WHERE sync_type='xerp_inventory' AND status='running'").run();
    ok(res, { reset_count: info?.changes || 0 });
  } catch (e) { fail(res, 500, '리셋 실패: ' + e.message); }
});

// ════════════════════════════════════════════════════════════════════
//  XERP 입고이력 품목코드 API (발주이력 판별용)
// ════════════════════════════════════════════════════════════════════

router.get('/api/xerp-receiving-codes', async (req, res, parsed) => {
  const db = ctx.db;
  const sql = ctx.sql;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;

  if (!await ctx.ensureXerpPool()) { fail(res, 503, 'XERP 데이터베이스 미연결 (재연결 시도 중)'); return; }
  const xerpPool = ctx.getXerpPool();
  const from = parsed.searchParams.get('from') || '20250801';
  const to = parsed.searchParams.get('to') || '20260228';
  try {
    const result = await xerpPool.request()
      .input('fromDate', sql.NChar(16), from.replace(/-/g, ''))
      .input('toDate', sql.NChar(16), to.replace(/-/g, ''))
      .query(`
        SELECT DISTINCT RTRIM(i.ItemCode) AS item_code
        FROM mmInoutHeader h WITH (NOLOCK)
        JOIN mmInoutItem i WITH (NOLOCK)
          ON h.SiteCode = i.SiteCode AND h.InoutNo = i.InoutNo AND h.InoutGubun = i.InoutGubun
        WHERE h.SiteCode = '${XERP_SITE_CODE}'
          AND h.InoutGubun = 'SI'
          AND h.InoutDate >= @fromDate AND h.InoutDate <= @toDate
      `);
    const codes = result.recordset.map(r => (r.item_code || '').trim()).filter(Boolean);
    ok(res, { codes, count: codes.length, from, to });
  } catch (e) {
    console.error('XERP 입고이력 조회 오류:', e.message);
    fail(res, 500, 'XERP 입고이력 조회 오류: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  XERP 월평균 출고량 API (재고현황 발주 설계용)
// ════════════════════════════════════════════════════════════════════

router.get('/api/xerp-monthly-usage', async (req, res, parsed) => {
  const db = ctx.db;
  const sql = ctx.sql;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;

  if (!await ctx.ensureXerpPool()) { fail(res, 503, 'XERP 데이터베이스 미연결 (재연결 시도 중)'); return; }
  const xerpPool = ctx.getXerpPool();

  // 1시간 캐시
  const now = Date.now();
  if (xerpUsageCache && now - xerpUsageCacheTime < 3600000) {
    ok(res, xerpUsageCache);
    return;
  }

  try {
    const today = new Date();
    const start3m = new Date(today); start3m.setMonth(start3m.getMonth() - 3);
    const fmt = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');

    const registeredProducts = await db.prepare("SELECT product_code FROM products WHERE status = 'active'").all();
    for (const p of registeredProducts) {
      p.product_code = (p.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
    }
    const registeredCodes = new Set(registeredProducts.map(r => r.product_code));
    const validCodes = registeredProducts.map(p => p.product_code).filter(c => /^[A-Za-z0-9_\-]+$/.test(c));
    if (!validCodes.length) { ok(res, {}); return; }

    const CHUNK_SIZE = 50;
    const MAX_CONCURRENT = 3;
    const codeChunks = [];
    for (let i = 0; i < validCodes.length; i += CHUNK_SIZE) codeChunks.push(validCodes.slice(i, i + CHUNK_SIZE));

    const usage = {};
    let okCount = 0, failCount = 0;

    const processChunk = async (chunk, idx) => {
      const inClause = chunk.map(c => `'${c}'`).join(',');
      try {
        const reqQ = xerpPool.request()
          .input('start3m', sql.NChar(16), fmt(start3m))
          .input('today', sql.NChar(16), fmt(today));
        reqQ.timeout = 7000;
        const r = await reqQ.query(`
          SELECT RTRIM(ItemCode) AS item_code, SUM(InoutQty) AS total_qty, COUNT(DISTINCT RTRIM(InoutDate)) AS ship_days
          FROM mmInoutItem WITH (NOLOCK)
          WHERE SiteCode = '${XERP_SITE_CODE}' AND InoutGubun = 'SO'
            AND InoutDate >= @start3m AND InoutDate < @today
            AND RTRIM(ItemCode) IN (${inClause})
          GROUP BY RTRIM(ItemCode)
        `);
        for (const row of r.recordset) {
          const code = (row.item_code || '').trim();
          if (!code || !registeredCodes.has(code)) continue;
          const total = Math.round(row.total_qty || 0);
          usage[code] = { total, monthly: Math.round(total / 3), daily: Math.round(total / 90) };
        }
        okCount++;
      } catch (e) {
        failCount++;
        console.warn(`[xerp-monthly] chunk ${idx + 1}/${codeChunks.length} 실패:`, e.message);
      }
    };

    // 웨이브 단위 병렬 처리
    for (let i = 0; i < codeChunks.length; i += MAX_CONCURRENT) {
      const wave = codeChunks.slice(i, i + MAX_CONCURRENT);
      await Promise.all(wave.map((chunk, j) => processChunk(chunk, i + j)));
    }
    console.log(`XERP 월출고: ${okCount}/${codeChunks.length} chunk 성공 (실패 ${failCount}), ${Object.keys(usage).length}개 품목`);

    xerpUsageCache = usage;
    xerpUsageCacheTime = now;
    console.log(`XERP 월출고 데이터: ${Object.keys(usage).length}개 관리품목 로드`);
    ok(res, usage);
  } catch (e) {
    console.error('XERP 월출고 조회 오류:', e.message);
    if (e.message.includes('imeout') || e.message.includes('closed') || e.message.includes('ECONN')) {
      const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;
      try { if (xerpPool) await xerpPool.close(); } catch (_) {}
      try {
        const xerpConfig = ctx.xerpConfig || {};
        const newPool = await sql.connect(xerpConfig);
        if (ctx.setXerpPool) ctx.setXerpPool(newPool);
        console.log('XERP 재연결 완료');
      } catch (re) { console.error('XERP 재연결 실패:', re.message); }
    }
    fail(res, 500, 'XERP 월출고 조회 오류: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  수불원장 (Inventory Ledger)
// ════════════════════════════════════════════════════════════════════

router.get('/api/xerp-inventory-ledger', async (req, res, parsed) => {
  const db = ctx.db;
  const sql = ctx.sql;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const XERP_SITE_CODE = ctx.XERP_SITE_CODE;

  if (!await ctx.ensureXerpPool()) { fail(res, 503, 'XERP 데이터베이스 미연결 (재연결 시도 중)'); return; }
  const xerpPool = ctx.getXerpPool();

  const WH_NAMES = {
    MF01: '본사공장', MF02: '공장2', MF03: '공장부속', MF15: '공장보조',
    MF21: '공장21', MF23: '후가공', MF24: '완제품', MT01: '자재창고',
    MT04: '자재보조', MT09: '자재09', M006: '외주06', M011: '외주11', W062: '외부창고'
  };

  try {
    const qFrom = parsed.searchParams.get('from');
    const qTo = parsed.searchParams.get('to');
    const qWarehouse = parsed.searchParams.get('warehouse');
    const qItemCode = parsed.searchParams.get('item_code');

    const today = new Date();
    const fmt = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
    const def = new Date(today); def.setMonth(def.getMonth() - 3); def.setDate(1);
    let startStr = qFrom || fmt(def);
    let endStr = qTo || fmt(today);
    const endNext = new Date(parseInt(endStr.slice(0, 4)), parseInt(endStr.slice(4, 6)) - 1, parseInt(endStr.slice(6, 8)) + 1);
    const endNextStr = fmt(endNext);

    // 현재고 (mmInventory)
    const invResult = await xerpPool.request().query(`
      SELECT RTRIM(ItemCode) AS ic, RTRIM(WhCode) AS wh,
             SUM(CASE WHEN ISNULL(OhQty,0) > 0 THEN OhQty ELSE 0 END) AS stock_qty
      FROM mmInventory WITH (NOLOCK)
      WHERE SiteCode = '${XERP_SITE_CODE}'
      GROUP BY RTRIM(ItemCode), RTRIM(WhCode)
    `);
    const stockMap = {};
    for (const r of invResult.recordset) {
      const key = `${(r.ic || '').trim()}|${(r.wh || '').trim()}`;
      stockMap[key] = r.stock_qty || 0;
    }

    // 창고 목록
    const whResult = await xerpPool.request().query(`
      SELECT DISTINCT RTRIM(WhCode) AS wh_code
      FROM mmInoutItem WITH (NOLOCK)
      WHERE SiteCode = '${XERP_SITE_CODE}' AND WhCode IS NOT NULL AND RTRIM(WhCode) <> ''
      ORDER BY RTRIM(WhCode)
    `);
    const warehouses = whResult.recordset.map(r => ({
      code: r.wh_code, name: WH_NAMES[r.wh_code] || r.wh_code
    }));

    // 기간 입출고
    const req2 = xerpPool.request()
      .input('startDate', sql.NChar(16), startStr)
      .input('endDate', sql.NChar(16), endNextStr);
    let whereExtra = '';
    if (qWarehouse) { req2.input('whFilter', sql.VarChar(20), qWarehouse); whereExtra += ' AND RTRIM(WhCode) = @whFilter'; }
    if (qItemCode) { req2.input('itemFilter', sql.VarChar(60), '%' + qItemCode + '%'); whereExtra += ' AND (RTRIM(ItemCode) LIKE @itemFilter OR RTRIM(ItemName) LIKE @itemFilter)'; }

    const result = await req2.query(`
      SELECT RTRIM(ItemCode) AS item_code,
             MAX(RTRIM(ItemName)) AS item_name,
             RTRIM(WhCode) AS warehouse,
             SUM(CASE WHEN InoutGubun IN ('SI','MI') THEN InoutQty ELSE 0 END) AS in_qty,
             SUM(CASE WHEN InoutGubun IN ('SO','MO') THEN InoutQty ELSE 0 END) AS out_qty,
             SUM(CASE WHEN InoutGubun IN ('SI','MI') THEN InoutAmnt ELSE 0 END) AS in_amnt,
             SUM(CASE WHEN InoutGubun IN ('SO','MO') THEN InoutAmnt ELSE 0 END) AS out_amnt
      FROM mmInoutItem WITH (NOLOCK)
      WHERE SiteCode = '${XERP_SITE_CODE}'
        AND InoutDate >= @startDate AND InoutDate < @endDate
        ${whereExtra}
      GROUP BY RTRIM(ItemCode), RTRIM(WhCode)
      ORDER BY RTRIM(ItemCode), RTRIM(WhCode)
    `);

    // 품목명 보충
    const nameMap = {};
    try {
      const localProds = await db.prepare('SELECT product_code, product_name, material_name, brand FROM products').all();
      for (const p of localProds) {
        if (!p.product_code || nameMap[p.product_code]) continue;
        const nm = (p.product_name || '').trim() || (p.material_name || '').trim() || (p.brand || '').trim();
        if (nm) nameMap[p.product_code] = nm;
      }
    } catch (e) { /* 로컬 DB 없으면 무시 */ }

    // 행 구성
    const rows = result.recordset.map(r => {
      const code = (r.item_code || '').trim();
      const wh = (r.warehouse || '').trim();
      const inQty = r.in_qty || 0;
      const outQty = r.out_qty || 0;
      const curStock = stockMap[`${code}|${wh}`] || 0;
      const beginStock = curStock - inQty + outQty;
      const name = (r.item_name || '').trim() || nameMap[code] || '';
      return {
        item_code: code,
        item_name: name,
        warehouse: wh,
        wh_name: WH_NAMES[wh] || wh,
        begin_stock: beginStock,
        in_qty: inQty,
        out_qty: outQty,
        end_stock: curStock,
        in_amnt: r.in_amnt || 0,
        out_amnt: r.out_amnt || 0
      };
    });

    const totals = rows.reduce((acc, r) => {
      acc.in_qty += r.in_qty; acc.out_qty += r.out_qty;
      acc.in_amnt += r.in_amnt; acc.out_amnt += r.out_amnt;
      return acc;
    }, { in_qty: 0, out_qty: 0, in_amnt: 0, out_amnt: 0 });

    ok(res, { rows, warehouses, totals, range: { start: startStr, end: endStr } });
  } catch (e) {
    console.error('수불원장 조회 오류:', e.message);
    fail(res, 500, '수불원장 조회 오류: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  재고현황2 (XERP 스냅샷) API
// ════════════════════════════════════════════════════════════════════

// POST /api/inv2/backfill — 2022-01-01 부터 어제까지 전체 백필
router.post('/api/inv2/backfill', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const readJSON = ctx.readJSON;

  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const body = await readJSON(req).catch(() => ({}));
  const tables = Array.isArray(body.tables) && body.tables.length ? body.tables : ['inout', 'sales', 'inventory'];
  const startYMD = (body.start && /^\d{8}$/.test(body.start)) ? body.start : '20220101';
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const endYMD = (body.end && /^\d{8}$/.test(body.end)) ? body.end : _fmtYMD(yesterday);
  const triggeredBy = (decoded.username || decoded.userId || 'admin') + '';
  const results = [];
  for (const t of tables) {
    if (!['inout', 'sales', 'inventory'].includes(t)) continue;
    const r = await _inv2EnqueueJob(db, t, 'backfill', startYMD, endYMD, triggeredBy);
    results.push({ table: t, ...r });
  }
  ok(res, { message: '백필 작업 등록됨 (백그라운드 실행)', range: { start: startYMD, end: endYMD }, jobs: results });
});

// POST /api/inv2/sync — 증분 동기화 (마지막 적재일 다음날 ~ 어제)
router.post('/api/inv2/sync', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const readJSON = ctx.readJSON;

  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const body = await readJSON(req).catch(() => ({}));
  const tables = Array.isArray(body.tables) && body.tables.length ? body.tables : ['inout', 'sales', 'inventory'];
  const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
  const endYMD = _fmtYMD(yesterday);
  const triggeredBy = (decoded.username || decoded.userId || 'admin') + '';
  const results = [];
  for (const t of tables) {
    if (!['inout', 'sales', 'inventory'].includes(t)) continue;
    let startYMD = '20220101';
    if (t === 'inout') {
      const last = await db.prepare("SELECT MAX(inout_date) AS d FROM inv2_inout").get();
      if (last && last.d) {
        const d = new Date(parseInt(last.d.slice(0, 4)), parseInt(last.d.slice(4, 6)) - 1, parseInt(last.d.slice(6, 8)) + 1);
        startYMD = _fmtYMD(d);
      }
    } else if (t === 'sales') {
      const last = await db.prepare("SELECT MAX(h_date) AS d FROM inv2_sales").get();
      if (last && last.d) {
        const d = new Date(parseInt(last.d.slice(0, 4)), parseInt(last.d.slice(4, 6)) - 1, parseInt(last.d.slice(6, 8)) + 1);
        startYMD = _fmtYMD(d);
      }
    }
    if (t !== 'inventory' && startYMD > endYMD) {
      results.push({ table: t, skipped: true, reason: '이미 최신 (last >= yesterday)' });
      continue;
    }
    const r = await _inv2EnqueueJob(db, t, 'sync', startYMD, endYMD, triggeredBy);
    results.push({ table: t, ...r, range: { start: startYMD, end: endYMD } });
  }
  ok(res, { message: '증분 동기화 작업 등록됨', jobs: results });
});

// GET /api/inv2/jobs — 최근 작업 이력
router.get('/api/inv2/jobs', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;

  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const jobs = await db.prepare("SELECT * FROM inv2_sync_jobs ORDER BY job_id DESC LIMIT 30").all();
  const stats = {};
  try {
    const inoutLast = await db.prepare("SELECT MAX(inout_date) AS d, COUNT(*) AS n FROM inv2_inout").get();
    const salesLast = await db.prepare("SELECT MAX(h_date) AS d, COUNT(*) AS n FROM inv2_sales").get();
    const invLast = await db.prepare("SELECT MAX(snapshot_date) AS d, COUNT(*) AS n FROM inv2_inventory_snapshot").get();
    stats.inout = { last_date: (inoutLast || {}).d || '', total_rows: Number((inoutLast || {}).n || 0) };
    stats.sales = { last_date: (salesLast || {}).d || '', total_rows: Number((salesLast || {}).n || 0) };
    stats.inventory = { last_date: (invLast || {}).d || '', total_rows: Number((invLast || {}).n || 0) };
  } catch (_) {}
  ok(res, { jobs, stats });
});

// GET /api/inventory2 — 재고현황2 조회 (스냅샷 + adjustments 합산)
router.get('/api/inventory2', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;

  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  try {
    const latest = await db.prepare("SELECT MAX(snapshot_date) AS d FROM inv2_inventory_snapshot").get();
    const snapshotDate = (latest || {}).d || '';
    if (!snapshotDate) {
      ok(res, { products: [], snapshot_date: '', total: 0, message: '스냅샷이 없습니다. [전체 재적재] 버튼으로 적재하세요.' });
      return;
    }
    const snapRows = await db.prepare(`
      SELECT item_code, MAX(item_name) AS item_name, wh_code, SUM(stock_qty) AS qty
      FROM inv2_inventory_snapshot WHERE snapshot_date = ?
      GROUP BY item_code, wh_code
    `).all(snapshotDate);
    const productMap = {};
    for (const r of snapRows) {
      const code = (r.item_code || '').trim();
      if (!code) continue;
      if (!productMap[code]) productMap[code] = {
        제품코드: code, 품목명: r.item_name || code, 가용재고: 0,
        _warehouses: {}, _snapshot_qty: 0, _adjustments: 0,
        snapshot_date: snapshotDate
      };
      const wh = (r.wh_code || '').trim();
      const q = Number(r.qty || 0);
      if (wh) productMap[code]._warehouses[wh] = (productMap[code]._warehouses[wh] || 0) + q;
      productMap[code]._snapshot_qty += q;
    }
    const adjRows = await db.prepare(`
      SELECT item_code, SUM(delta_qty) AS delta, COUNT(*) AS cnt
      FROM inv2_adjustments WHERE adj_date > ? GROUP BY item_code
    `).all(snapshotDate);
    for (const r of adjRows) {
      const code = (r.item_code || '').trim();
      if (!productMap[code]) productMap[code] = {
        제품코드: code, 품목명: code, 가용재고: 0,
        _warehouses: {}, _snapshot_qty: 0, _adjustments: 0,
        snapshot_date: snapshotDate
      };
      productMap[code]._adjustments = Number(r.delta || 0);
    }
    const products = Object.values(productMap).map(p => {
      p.가용재고 = (p._snapshot_qty || 0) + (p._adjustments || 0);
      return p;
    });
    products.sort((a, b) => (b.가용재고 || 0) - (a.가용재고 || 0));
    ok(res, { products, snapshot_date: snapshotDate, total: products.length });
  } catch (e) {
    console.error('inventory2 조회 오류:', e.message);
    fail(res, 500, '재고현황2 조회 오류: ' + e.message);
  }
});

// POST /api/inv2/adjust — 수동 +/- 조정 (admin)
router.post('/api/inv2/adjust', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const readJSON = ctx.readJSON;

  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const body = await readJSON(req).catch(() => ({}));
  const code = (body.item_code || '').trim();
  const delta = Number(body.delta_qty || 0);
  if (!code || !Number.isFinite(delta) || delta === 0) { fail(res, 400, 'item_code 와 0 이 아닌 delta_qty 가 필요합니다'); return; }
  try {
    const r = await db.prepare(`INSERT INTO inv2_adjustments (item_code, delta_qty, reason, user_id, user_name, notes) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(code, delta, body.reason || 'manual', decoded.userId || null, decoded.username || '', body.notes || '');
    ok(res, { adj_id: r.lastInsertRowid, item_code: code, delta_qty: delta });
  } catch (e) {
    fail(res, 500, '조정 실패: ' + e.message);
  }
});

// POST /api/po/:id/receive2 — 발주 입고처리 → inv2_adjustments 에 +수량 기록
router.postP(/^\/api\/po\/(\d+)\/receive2$/, async (req, res, parsed, m) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;
  const readJSON = ctx.readJSON;

  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const poId = parseInt(m[1], 10);
  const body = await readJSON(req).catch(() => ({}));
  const items = Array.isArray(body.items) ? body.items : [];
  if (!items.length) { fail(res, 400, '입고 품목이 없습니다'); return; }
  try {
    const po = await db.prepare("SELECT po_number FROM po_header WHERE po_id=?").get(poId);
    const poNumber = (po && po.po_number) || '';
    const insStmt = db.prepare(`INSERT INTO inv2_adjustments (item_code, delta_qty, reason, po_id, po_number, user_id, user_name, notes) VALUES (?, ?, 'po_receive', ?, ?, ?, ?, ?)`);
    const ids = [];
    const tx = db.transaction(async () => {
      for (const it of items) {
        const code = (it.product_code || '').trim();
        const qty = Number(it.qty || 0);
        if (!code || qty <= 0) continue;
        const r = await insStmt.run(code, qty, poId, poNumber, decoded.userId || null, decoded.username || '', body.notes || '');
        ids.push(r.lastInsertRowid);
      }
    });
    await tx();
    ok(res, { po_id: poId, po_number: poNumber, adjustments: ids, count: ids.length });
  } catch (e) {
    fail(res, 500, '입고처리 실패: ' + e.message);
  }
});

// GET /api/inv2/adjustments — 조정 이력 조회 (재고현황2 상세 패널용)
router.get('/api/inv2/adjustments', async (req, res, parsed) => {
  const db = ctx.db;
  const ok = ctx.ok;
  const fail = ctx.fail;

  const token = ctx.extractToken(req); const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { fail(res, 401, '인증이 필요합니다'); return; }
  const code = parsed.searchParams.get('item_code');
  let rows;
  if (code) {
    rows = await db.prepare("SELECT * FROM inv2_adjustments WHERE item_code=? ORDER BY id DESC LIMIT 200").all(code);
  } else {
    rows = await db.prepare("SELECT * FROM inv2_adjustments ORDER BY id DESC LIMIT 100").all();
  }
  ok(res, { adjustments: rows });
});

// ── 내부 헬퍼: inv2 작업 큐 등록 ──
// 주의: _inv2RunInoutBackfill, _inv2RunSalesBackfill, _inv2RunInventorySnapshot 은
// serve_inv2.js 본체에 남아있음 (XERP 풀 + 대량 트랜잭션 로직).
// 이 모듈에서는 큐 INSERT + setImmediate fire-and-forget 만 담당.
// serve_inv2.js 에서 ctx._inv2RunInoutBackfill 등으로 주입하거나,
// 기존 함수를 그대로 사용할 수 있도록 ctx 에 등록 필요.
async function _inv2EnqueueJob(db, tableName, jobType, rangeStart, rangeEnd, triggeredBy) {
  const existing = await db.prepare("SELECT job_id FROM inv2_sync_jobs WHERE table_name=? AND status IN ('running','queued') ORDER BY job_id DESC LIMIT 1").get(tableName);
  if (existing) return { skipped: true, job_id: existing.job_id, reason: '이미 진행 중인 작업이 있음' };
  const r = await db.prepare(`INSERT INTO inv2_sync_jobs (job_type, table_name, range_start, range_end, status, triggered_by) VALUES (?, ?, ?, ?, 'queued', ?)`).run(jobType, tableName, rangeStart, rangeEnd, triggeredBy);
  const jobId = r.lastInsertRowid;
  // fire-and-forget — 실제 실행 함수는 ctx 에서 가져옴
  setImmediate(() => {
    if (tableName === 'inout' && ctx._inv2RunInoutBackfill) ctx._inv2RunInoutBackfill(jobId, rangeStart, rangeEnd);
    else if (tableName === 'sales' && ctx._inv2RunSalesBackfill) ctx._inv2RunSalesBackfill(jobId, rangeStart, rangeEnd);
    else if (tableName === 'inventory' && ctx._inv2RunInventorySnapshot) ctx._inv2RunInventorySnapshot(jobId);
  });
  return { job_id: jobId };
}

module.exports = { router };
