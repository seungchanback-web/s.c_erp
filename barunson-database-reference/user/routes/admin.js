// routes/admin.js — 관리자/디버그/감사로그/알림/결재 라우트 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════��═══════
//  감사 로그 (Audit Log)
// ════════════════════════════════════════════════════════════════════

// GET /api/audit-log — 감사 로그 목록 (admin만)
router.get('/api/audit-log', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { ctx.fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const limit = Math.min(parseInt(parsed.searchParams.get('limit') || '100'), 500);
  const offset = parseInt(parsed.searchParams.get('offset') || '0');
  const user = parsed.searchParams.get('user') || '';
  const action = parsed.searchParams.get('action') || '';
  const resource = parsed.searchParams.get('resource') || '';
  const start = parsed.searchParams.get('start') || '';
  const end = parsed.searchParams.get('end') || '';
  const search = parsed.searchParams.get('q') || '';

  let where = [], params = [];
  if (user) { where.push("username LIKE ?"); params.push('%' + user + '%'); }
  if (action) { where.push("action = ?"); params.push(action); }
  if (resource) { where.push("resource = ?"); params.push(resource); }
  if (start) { where.push("created_at >= ?"); params.push(start); }
  if (end) { where.push("created_at <= ? || ' 23:59:59'"); params.push(end); }
  if (search) { where.push("(details LIKE ? OR username LIKE ? OR resource_id LIKE ?)"); params.push('%'+search+'%','%'+search+'%','%'+search+'%'); }

  const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = (await ctx.db.prepare("SELECT COUNT(*) as cnt FROM audit_log" + whereClause).get(...params)).cnt;
  const rows = await ctx.db.prepare("SELECT * FROM audit_log" + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?").all(...params, limit, offset);

  ctx.ok(res, { rows, total, limit, offset });
});

// GET /api/audit-log/stats — 감사 로그 통계 (admin만)
router.get('/api/audit-log/stats', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { ctx.fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const days = parseInt(parsed.searchParams.get('days') || '30');
  const since = new Date(Date.now() - days * 86400000).toISOString().slice(0, 10);

  const totalLogs = (await ctx.db.prepare("SELECT COUNT(*) as cnt FROM audit_log WHERE created_at::text >= ?").get(since)).cnt;
  const byAction = await ctx.db.prepare("SELECT action, COUNT(*) as cnt FROM audit_log WHERE created_at::text >= ? GROUP BY action ORDER BY cnt DESC").all(since);
  const byUser = await ctx.db.prepare("SELECT username, COUNT(*) as cnt FROM audit_log WHERE created_at::text >= ? GROUP BY username ORDER BY cnt DESC LIMIT 20").all(since);
  const byResource = await ctx.db.prepare("SELECT resource, COUNT(*) as cnt FROM audit_log WHERE created_at::text >= ? GROUP BY resource ORDER BY cnt DESC").all(since);
  const byDay = await ctx.db.prepare("SELECT created_at::date as day, COUNT(*) as cnt FROM audit_log WHERE created_at::text >= ? GROUP BY created_at::date ORDER BY day DESC LIMIT ?").all(since, days);
  const loginFailed = (await ctx.db.prepare("SELECT COUNT(*) as cnt FROM audit_log WHERE action='login_failed' AND created_at::text >= ?").get(since)).cnt;
  const uniqueUsers = (await ctx.db.prepare("SELECT COUNT(DISTINCT username) as cnt FROM audit_log WHERE created_at::text >= ? AND action IN ('login','google_login')").get(since)).cnt;
  const recentActions = await ctx.db.prepare("SELECT action, COUNT(*) as cnt FROM audit_log WHERE created_at::text >= (NOW() - INTERVAL '1 hour')::text GROUP BY action ORDER BY cnt DESC").all();

  ctx.ok(res, { total: totalLogs, login_failed: loginFailed, unique_users: uniqueUsers, by_action: byAction, by_user: byUser, by_resource: byResource, by_day: byDay, recent_hour: recentActions, days });
});

// GET /api/audit-log/actions — 감사 로그 액션 유형 목록
router.get('/api/audit-log/actions', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { ctx.fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const actions = await ctx.db.prepare("SELECT DISTINCT action FROM audit_log ORDER BY action").all();
  const resources = await ctx.db.prepare("SELECT DISTINCT resource FROM audit_log ORDER BY resource").all();
  const users = await ctx.db.prepare("SELECT DISTINCT username FROM audit_log WHERE username IS NOT NULL ORDER BY username").all();
  ctx.ok(res, { actions: actions.map(a => a.action), resources: resources.map(r => r.resource), users: users.map(u => u.username) });
});

// ════════════════════════════════════════════════════════════════════
//  에러 로그 (Error Logs)
// ════════════════════════════════════════════════════════════════════

// GET /api/error-logs — 에러 로그 (admin만, 필터링 지원)
router.get('/api/error-logs', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { ctx.fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const limit = Math.min(parseInt(parsed.searchParams.get('limit') || '100'), 500);
  const offset = parseInt(parsed.searchParams.get('offset') || '0');
  const level = parsed.searchParams.get('level') || '';
  const search = parsed.searchParams.get('q') || '';

  let where = [], params = [];
  if (level) { where.push("level = ?"); params.push(level); }
  if (search) { where.push("(message LIKE ? OR url LIKE ?)"); params.push('%'+search+'%','%'+search+'%'); }
  const whereClause = where.length ? ' WHERE ' + where.join(' AND ') : '';
  const total = (await ctx.db.prepare("SELECT COUNT(*) as cnt FROM error_logs" + whereClause).get(...params)).cnt;
  const rows = await ctx.db.prepare("SELECT * FROM error_logs" + whereClause + " ORDER BY created_at DESC LIMIT ? OFFSET ?").all(...params, limit, offset);
  ctx.ok(res, { rows, total, limit, offset });
});

// ════════════════════════════════════════════════════════════════════
//  Admin 제품 중복 정리
// ════════════════════════════════════════════════════════════════════

// POST /api/admin/products/dedupe — products 테이블 product_code 중복 row 정리
router.post('/api/admin/products/dedupe', async (req, res, parsed) => {
  const body = await ctx.readJSON(req).catch(() => ({}));
  const dryRun = !!body?.dry_run;

  try {
    const dupGroups = await ctx.db.prepare(`
      SELECT product_code, COUNT(*) AS cnt, STRING_AGG(CAST(id AS TEXT), ',' ORDER BY id) AS ids
      FROM products
      GROUP BY product_code
      HAVING COUNT(*) > 1
    `).all();

    const summary = dupGroups.map(g => {
      const ids = (g.ids || '').split(',').map(x => parseInt(x, 10)).filter(Boolean);
      const keepId = ids[ids.length - 1];
      const deleteIds = ids.slice(0, -1);
      return { product_code: g.product_code, cnt: Number(g.cnt), keep_id: keepId, delete_ids: deleteIds };
    });

    const allDeleteIds = summary.flatMap(s => s.delete_ids);

    if (dryRun || allDeleteIds.length === 0) {
      ctx.ok(res, {
        dry_run: true,
        total_dup_groups: summary.length,
        total_rows_to_delete: allDeleteIds.length,
        sample: summary.slice(0, 20)
      });
      return;
    }

    let deleted = 0;
    for (const id of allDeleteIds) {
      try {
        await ctx.db.prepare('DELETE FROM products WHERE id=?').run(id);
        deleted++;
      } catch (_) {}
    }

    console.log(`[dedupe] products 중복 정리 완료: ${deleted}/${allDeleteIds.length}`);
    ctx.ok(res, {
      dry_run: false,
      total_dup_groups: summary.length,
      requested_delete: allDeleteIds.length,
      actually_deleted: deleted
    });
  } catch (e) {
    console.error('[dedupe] 실패:', e.message);
    ctx.fail(res, 500, '중복 정리 실패: ' + e.message);
  }
});

// ════════════════════════════════════════════════════════════════════
//  XERP 재연결
// ════════════════════════════════════════════════════════════════════

// POST /api/admin/xerp/reconnect — XERP DB 강제 재연결
router.post('/api/admin/xerp/reconnect', async (req, res, parsed) => {
  const t0 = Date.now();
  try {
    if (ctx.xerpReconnectTimer) { clearTimeout(ctx.xerpReconnectTimer); ctx.xerpReconnectTimer = null; }
    const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;
    if (xerpPool) { try { await xerpPool.close(); } catch(_){} }
    if (ctx.setXerpPool) ctx.setXerpPool(null);
    try { await ctx.sql.close(); } catch(_){}
    if (ctx.resetXerpReconnectAttempts) ctx.resetXerpReconnectAttempts();
    const okConn = await ctx.connectXERP();
    if (!okConn) { ctx.fail(res, 503, 'XERP 재연결 실패 — 자격증명/네트워크 점검 필요'); return; }
    const xerpConfig = ctx.xerpConfig || {};
    ctx.ok(res, { reconnected: true, elapsed_ms: Date.now() - t0, user: xerpConfig.user, server: xerpConfig.server });
  } catch (e) { ctx.fail(res, 500, 'XERP 재연결 오류: ' + e.message); }
});

// ════════════════════════════════════════════════════════════════════
//  DD 재고 원샷 재동기화
// ════════════════════════════════════════════════════════════════════

// POST /api/admin/dd-resync — DD 재고 BHC 직접 쿼리 → snapshot UPSERT
router.post('/api/admin/dd-resync', async (req, res, parsed) => {
  const out = { started_at: new Date().toISOString() };
  try {
    const envVars = ctx.envVars || {};
    const barShopConfig = ctx.barShopConfig || {};
    const xerpConfig = ctx.xerpConfig || {};
    const _pwSrc = (k) => (envVars[k] !== undefined ? 'envVars' : (process.env[k] !== undefined ? 'process.env' : 'missing'));
    const _pwDiag = (pw) => ({ len: (pw || '').length, last_char: (pw || '').slice(-1) || '', has_hash: String(pw || '').includes('#') });
    out.cred_diag = {
      barShopConfig: { user: barShopConfig.user, ..._pwDiag(barShopConfig.password), pw_source: _pwSrc('DB_PASSWORD') },
      xerpConfig:    { user: xerpConfig.user,    ..._pwDiag(xerpConfig.password),    pw_source: _pwSrc('XERP_DB_PASSWORD') }
    };

    // 1) 로컬 DD 제품 리스트
    const locals = await ctx.db.prepare(
      "SELECT product_code, product_name FROM products WHERE (product_code LIKE 'DD%' OR legal_entity='dd' OR origin='DD') AND status IN ('active','inactive')"
    ).all();
    const codes = locals.map(r => (r.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim()).filter(Boolean);
    out.local_dd_count = codes.length;
    if (!codes.length) { ctx.ok(res, out); return; }

    // 2) XERP 풀 사용
    const bhcPool = await ctx.ensureXerpPool();
    if (!bhcPool) { out.bhc_error = 'XERP 풀 미연결'; ctx.ok(res, out); return; }
    out.bhc_used_config = 'xerpPool';

    // 3) 재고 쿼리 (mmInventory)
    const invByWh = {};
    const invMap = {};
    const invByWhNorm = {};
    const invMapNorm = {};
    const invSiteDist = {};
    const _stripUs = s => s.replace(/_/g, '');
    try {
      const req0 = bhcPool.request(); req0.timeout = 120000;
      const r = await req0.query(`
        SELECT RTRIM(ItemCode) AS item_code, RTRIM(WhCode) AS wh_code,
               RTRIM(SiteCode) AS site_code,
               SUM(CASE WHEN OhQty>0 THEN OhQty ELSE 0 END) AS oh_qty
        FROM mmInventory WITH (NOLOCK) WHERE ItemCode LIKE 'DD%'
        GROUP BY RTRIM(ItemCode), RTRIM(WhCode), RTRIM(SiteCode)`);
      for (const row of r.recordset) {
        const c = (row.item_code || '').trim().toUpperCase();
        const w = (row.wh_code || '').trim();
        const s = (row.site_code || '').trim();
        const q = Math.round(row.oh_qty || 0);
        if (!c) continue;
        invMap[c] = (invMap[c] || 0) + q;
        if (w && q > 0) { (invByWh[c] ||= {})[w] = ((invByWh[c] || {})[w] || 0) + q; }
        const cn = _stripUs(c);
        if (cn !== c) {
          invMapNorm[cn] = (invMapNorm[cn] || 0) + q;
          if (w && q > 0) { (invByWhNorm[cn] ||= {})[w] = ((invByWhNorm[cn] || {})[w] || 0) + q; }
        } else {
          invMapNorm[cn] = invMap[c];
          if (invByWh[c]) invByWhNorm[cn] = invByWh[c];
        }
        if (s) invSiteDist[s] = (invSiteDist[s] || 0) + 1;
      }
      out.bhc_inv_rows = r.recordset.length;
      out.bhc_inv_items = Object.keys(invMap).length;
      out.bhc_inv_site_dist = invSiteDist;
    } catch (e) { out.inv_query_error = e.message; }

    // 4) 3개월 출고 쿼리
    const shipMap = {};
    const shipMapNorm = {};
    const shipSiteDist = {};
    try {
      const today = new Date();
      const start3m = new Date(today); start3m.setMonth(start3m.getMonth() - 3);
      const fmt = d => d.getFullYear() + String(d.getMonth() + 1).padStart(2, '0') + String(d.getDate()).padStart(2, '0');
      const req1 = bhcPool.request()
        .input('s', ctx.sql.NChar(16), fmt(start3m))
        .input('e', ctx.sql.NChar(16), fmt(today));
      req1.timeout = 120000;
      const r = await req1.query(`
        SELECT RTRIM(ItemCode) AS item_code,
               RTRIM(SiteCode) AS site_code,
               SUM(InoutQty)   AS total_qty
        FROM mmInoutItem WITH (NOLOCK)
        WHERE ItemCode LIKE 'DD%' AND InoutGubun='SO' AND InoutDate >= @s AND InoutDate < @e
        GROUP BY RTRIM(ItemCode), RTRIM(SiteCode)`);
      for (const row of r.recordset) {
        const c = (row.item_code || '').trim().toUpperCase();
        const s = (row.site_code || '').trim();
        const t = Math.round(row.total_qty || 0);
        if (c) {
          const prev = shipMap[c] || { total: 0 };
          const newTotal = prev.total + t;
          shipMap[c] = { total: newTotal, monthly: Math.round(newTotal / 3), daily: Math.round(newTotal / 90) };
          const cn = _stripUs(c);
          shipMapNorm[cn] = shipMap[c];
          if (s) shipSiteDist[s] = (shipSiteDist[s] || 0) + 1;
        }
      }
      out.bhc_ship_items = Object.keys(shipMap).length;
      out.bhc_ship_site_dist = shipSiteDist;
    } catch (e) { out.ship_query_error = e.message; }

    // 5) 로컬 제품별 매칭 + UPSERT
    const matched = [];
    const unmatched = [];
    let _matchedNormCount = 0;
    const sample = [];
    let upserted = 0;
    let upsertFailed = 0;
    const upsertErrs = [];
    const upsertStmt = ctx.db.prepare(`INSERT INTO inventory_snapshot
      (product_code, legal_entity, site_code, current_stock, monthly_out, daily_out, total_3m, item_name, warehouses_json, synced_at)
      VALUES (?,?,?,?,?,?,?,?,?,datetime('now','localtime'))
      ON CONFLICT(product_code) DO UPDATE SET
        legal_entity=excluded.legal_entity, site_code=excluded.site_code,
        current_stock=excluded.current_stock, monthly_out=excluded.monthly_out,
        daily_out=excluded.daily_out, total_3m=excluded.total_3m,
        item_name=CASE WHEN excluded.item_name='' THEN inventory_snapshot.item_name ELSE excluded.item_name END,
        warehouses_json=excluded.warehouses_json, synced_at=excluded.synced_at`);
    for (const p of locals) {
      const code = (p.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
      if (!code) continue;
      const cu = code.toUpperCase();
      const cn = _stripUs(cu);
      let stock, ship, whObj, matchType;
      if (invMap[cu] !== undefined || shipMap[cu] !== undefined) {
        stock = invMap[cu] || 0;
        ship = shipMap[cu] || { total: 0, monthly: 0, daily: 0 };
        whObj = invByWh[cu];
        matchType = 'exact';
      } else if (invMapNorm[cn] !== undefined || shipMapNorm[cn] !== undefined) {
        stock = invMapNorm[cn] || 0;
        ship = shipMapNorm[cn] || { total: 0, monthly: 0, daily: 0 };
        whObj = invByWhNorm[cn];
        matchType = 'norm';
      } else {
        stock = 0; ship = { total: 0, monthly: 0, daily: 0 }; whObj = null; matchType = null;
      }
      const whJson = whObj ? JSON.stringify(whObj) : '';
      if (matchType === 'exact') { matched.push(code); }
      else if (matchType === 'norm') { matched.push(code); _matchedNormCount++; }
      else unmatched.push(code);
      try {
        await upsertStmt.run(code, 'dd', 'BHC2', stock, ship.monthly, ship.daily, ship.total, p.product_name || '', whJson);
        upserted++;
        if (sample.length < 10 && stock > 0) sample.push({ code, stock, monthly: ship.monthly });
      } catch (e) {
        upsertFailed++;
        if (upsertErrs.length < 5) upsertErrs.push(code + ':' + e.message.split('\n')[0]);
      }
    }

    out.matched_count = matched.length;
    out.matched_normalized = _matchedNormCount;
    out.matched_exact = matched.length - _matchedNormCount;
    out.unmatched_count = unmatched.length;
    out.unmatched_sample = unmatched.slice(0, 10);
    out.upserted = upserted;
    out.upsert_failed = upsertFailed;
    if (upsertErrs.length) out.upsert_errors = upsertErrs;
    out.total_stock = locals.reduce((s, p) => {
      const u = (p.product_code || '').toUpperCase();
      return s + (invMap[u] !== undefined ? invMap[u] : (invMapNorm[_stripUs(u)] || 0));
    }, 0);
    out.total_monthly_out = Object.values(shipMap).reduce((s, v) => s + (v.monthly || 0), 0);
    out.sample_upserts = sample;

    // 6) BHC WhCode → warehouses 자동 등록 + warehouse_inventory 동기화
    try {
      const ddWhSet = new Set();
      for (const c of Object.keys(invByWh)) {
        for (const w of Object.keys(invByWh[c] || {})) if (w) ddWhSet.add(w);
      }
      out.dd_warehouses_discovered = [...ddWhSet];

      const upsertWh = ctx.db.prepare(`INSERT INTO warehouses (code, name, description, legal_entity)
        VALUES (?, ?, 'BHC mmInventory 자동연동', 'dd')
        ON CONFLICT(code) DO UPDATE SET legal_entity='dd', updated_at=datetime('now','localtime')`);
      for (const wh of ddWhSet) {
        try { await upsertWh.run(wh, `(디얼디어) ${wh}`); } catch(_){}
      }

      const whIdByCode = {};
      const whRows = await ctx.db.prepare("SELECT id, code FROM warehouses WHERE legal_entity='dd'").all();
      for (const r of whRows) whIdByCode[r.code] = r.id;

      try {
        await ctx.db.prepare(`DELETE FROM warehouse_inventory WHERE memo='BHC 자동연동' AND warehouse_id IN (SELECT id FROM warehouses WHERE legal_entity='dd')`).run();
      } catch(_){}

      const upsertWi = ctx.db.prepare(`INSERT INTO warehouse_inventory (warehouse_id, product_code, product_name, quantity, memo, updated_at)
        VALUES (?, ?, ?, ?, 'BHC 자동연동', datetime('now','localtime'))
        ON CONFLICT(warehouse_id, product_code) DO UPDATE SET
          product_name=CASE WHEN excluded.product_name='' THEN warehouse_inventory.product_name ELSE excluded.product_name END,
          quantity=excluded.quantity, memo=excluded.memo, updated_at=excluded.updated_at`);
      let wiUpserted = 0;
      let wiNorm = 0;
      for (const p of locals) {
        const code = (p.product_code || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
        if (!code) continue;
        const cu = code.toUpperCase();
        let whMap = invByWh[cu];
        if (!whMap) {
          const cn = _stripUs(cu);
          if (cn !== cu && invByWhNorm[cn]) { whMap = invByWhNorm[cn]; wiNorm++; }
        }
        if (!whMap) continue;
        for (const [wh, qty] of Object.entries(whMap)) {
          const wid = whIdByCode[wh];
          if (!wid) continue;
          try { await upsertWi.run(wid, code, p.product_name || '', qty); wiUpserted++; } catch(_){}
        }
      }
      out.dd_warehouses_registered = ddWhSet.size;
      out.dd_warehouse_inventory_upserted = wiUpserted;
      out.dd_warehouse_inventory_normalized = wiNorm;
    } catch (whErr) {
      out.dd_warehouse_register_error = whErr.message;
    }

    out.finished_at = new Date().toISOString();
    ctx.ok(res, out);
  } catch (e) {
    out.fatal_error = e.message;
    out.stack = (e.stack || '').split('\n').slice(0, 5).join(' | ');
    ctx.fail(res, 500, JSON.stringify(out));
  }
});

// ════════════════════════════════════════════════════════════════════
//  DD Orders Schema 진단
// ════════════════════════════════════════════════════════════════════

// GET /api/admin/dd-orders-schema — 디디 wedding DB 스키마 dump
router.get('/api/admin/dd-orders-schema', async (req, res, parsed) => {
  const ddPool = ctx.getDdPool ? ctx.getDdPool() : null;
  if (!ddPool) { ctx.fail(res, 503, 'DD MySQL 미연결 (DD_DB_SERVER 미설정 또는 연결 실패)'); return; }
  const out = { db: 'wedding' };
  try {
    const [tables] = await ddPool.query("SHOW TABLES");
    const allNames = tables.map(r => Object.values(r)[0]);
    const matched = allNames.filter(t => /order|product|item|ship/i.test(t));
    out.matched_tables = matched;
    out.all_tables_count = allNames.length;
    for (const t of matched) {
      try {
        const [cols] = await ddPool.query(`SHOW COLUMNS FROM \`${t}\``);
        out[t + '_columns'] = cols.map(c => ({ name: c.Field, type: c.Type, key: c.Key, null: c.Null }));
        const [sample] = await ddPool.query(`SELECT * FROM \`${t}\` ORDER BY 1 DESC LIMIT 2`);
        out[t + '_sample'] = (sample || []).map(row => {
          const m = {};
          for (const k of Object.keys(row)) {
            const v = row[k];
            if (typeof v === 'string' && /phone|tel|address|name|email|password/i.test(k)) {
              m[k] = v.length > 0 ? '***' + (v.length > 4 ? v.slice(-2) : '') : '';
            } else m[k] = v;
          }
          return m;
        });
        const [cnt] = await ddPool.query(`SELECT COUNT(*) AS cnt FROM \`${t}\``);
        out[t + '_row_count'] = cnt[0]?.cnt || 0;
      } catch (e) { out[t + '_error'] = e.message; }
    }
  } catch (e) { out.error = e.message; }
  ctx.ok(res, out);
});

// ════════════════════════════════════════════════════════════════════
//  Inventory Trace 진단
// ════════════════════════════════════════════════════════════════════

// GET /api/admin/inventory-trace?code=PRODUCT_CODE — 한 품목의 sync 상태 진단
router.get('/api/admin/inventory-trace', async (req, res, parsed) => {
  const code = (parsed.searchParams.get('code') || '').trim();
  if (!code) { ctx.fail(res, 400, 'code 쿼리 파라미터 필수'); return; }
  if (!/^[A-Za-z0-9_\-]+$/.test(code)) { ctx.fail(res, 400, 'code 형식 오류 (영숫자/_/- 만 허용)'); return; }
  const out = { code, ts: new Date().toISOString() };

  // 1) products 테이블 row
  try {
    out.products_row = await ctx.db.prepare('SELECT product_code, product_name, brand, origin, status, legal_entity, material_code, material_name, cut_spec, jopan, spec, product_spec FROM products WHERE product_code = ?').get(code);
  } catch (e) { out.products_error = e.message; }

  // 2) product_post_vendor row 들
  try {
    out.post_vendors = await ctx.db.prepare('SELECT process_type, vendor_name, step_order FROM product_post_vendor WHERE product_code = ? ORDER BY step_order').all(code);
    out.post_vendors_with_name = (out.post_vendors || []).filter(r => r.vendor_name).length;
  } catch (e) { out.post_vendors_error = e.message; }

  // 3) inventory_snapshot row
  try {
    out.snapshot = await ctx.db.prepare('SELECT product_code, legal_entity, site_code, current_stock, monthly_out, daily_out, total_3m, item_name, synced_at FROM inventory_snapshot WHERE product_code = ?').get(code);
  } catch (e) { out.snapshot_error = e.message; }

  // 4) XERP mmInventory 직접 조회
  try {
    const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;
    if (await ctx.ensureXerpPool()) {
      const pool = ctx.getXerpPool();
      const safe = code.replace(/'/g, "''");
      const safeNorm = safe.replace(/[_\-]/g, '');
      const r = await pool.request().query(`
        SELECT RTRIM(SiteCode) AS site, RTRIM(WhCode) AS wh, RTRIM(ItemCode) AS item_code,
               SUM(OhQty) AS qty_all, SUM(CASE WHEN OhQty>0 THEN OhQty ELSE 0 END) AS qty_pos, COUNT(*) AS rows
        FROM mmInventory WITH (NOLOCK)
        WHERE RTRIM(ItemCode) = '${safe}'
           OR REPLACE(REPLACE(RTRIM(ItemCode),'_',''),'-','') = '${safeNorm}'
        GROUP BY RTRIM(SiteCode), RTRIM(WhCode), RTRIM(ItemCode)
      `);
      out.xerp_inventory_rows = r.recordset;
      out.xerp_inventory_total_pos = (r.recordset || []).reduce((s, x) => s + (Number(x.qty_pos) || 0), 0);

      // 4-2) mmInoutItem 출고 직접 조회
      const today = new Date();
      const start3m = new Date(today); start3m.setMonth(start3m.getMonth() - 3);
      const fmt = d => d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
      const r2 = await pool.request()
        .input('s3', ctx.sql.NChar(16), fmt(start3m))
        .input('t', ctx.sql.NChar(16), fmt(today))
        .query(`
          SELECT RTRIM(SiteCode) AS site, RTRIM(InoutGubun) AS gubun,
                 COUNT(*) AS rows, SUM(InoutQty) AS total_qty
          FROM mmInoutItem WITH (NOLOCK)
          WHERE (RTRIM(ItemCode) = '${safe}'
              OR REPLACE(REPLACE(RTRIM(ItemCode),'_',''),'-','') = '${safeNorm}')
            AND InoutDate >= @s3 AND InoutDate < @t
          GROUP BY RTRIM(SiteCode), RTRIM(InoutGubun)
          ORDER BY total_qty DESC
        `);
      out.xerp_inoutitem_3m = r2.recordset;
      out.xerp_so_total_3m = (r2.recordset || []).filter(x => x.gubun === 'SO').reduce((s,x)=>s+(Number(x.total_qty)||0), 0);
      out.xerp_inoutitem_total_3m = (r2.recordset || []).reduce((s,x)=>s+(Number(x.total_qty)||0), 0);
    } else {
      out.xerp_error = 'XERP pool not connected';
    }
  } catch (e) { out.xerp_inventory_error = e.message; }

  // 4-3) DD 품목인 경우 DD MySQL 출고도 함께 진단
  const _isDdCode = (out.products_row && out.products_row.legal_entity === 'dd')
                 || /^DD/i.test(code)
                 || (out.products_row && out.products_row.origin === 'DD');
  if (_isDdCode) {
    try {
      const ddPool = ctx.getDdPool ? ctx.getDdPool() : null;
      if (!ddPool) { out.dd_mysql_error = 'DD MySQL pool 미연결 (DD_DB_SERVER 미설정 또는 연결 실패)'; }
      else {
        const today = new Date();
        const s3m = new Date(today); s3m.setMonth(s3m.getMonth() - 3);
        const startISO = s3m.toISOString().slice(0, 10);
        const endISO = today.toISOString().slice(0, 10);
        let tempCode = '';
        try {
          const r = await ctx.db.prepare('SELECT temp_code FROM products WHERE product_code=?').get(code);
          tempCode = (r && r.temp_code) ? String(r.temp_code).trim() : '';
        } catch(_){}
        const candidates = [code];
        if (tempCode && tempCode !== code) candidates.push(tempCode);
        const norm = code.replace(/[_\-\s]/g, '');
        if (norm !== code && !candidates.includes(norm)) candidates.push(norm);
        const placeholders = candidates.map(()=>'?').join(',');
        const [rows] = await ddPool.query(
          `SELECT oi.product_code AS code,
                  COUNT(DISTINCT oi.order_id) AS order_count,
                  SUM(oi.qty) AS total_qty,
                  SUM(CASE WHEN o.order_state IN ('D','F') OR o.shipping_state='Y' THEN oi.qty ELSE 0 END) AS shipped_qty,
                  SUM(CASE WHEN o.order_state='C' THEN oi.qty ELSE 0 END) AS canceled_qty
           FROM order_items oi INNER JOIN orders o ON oi.order_id = o.id
           WHERE o.created_at >= ? AND o.created_at < ?
             AND oi.product_code IN (${placeholders})
           GROUP BY oi.product_code`,
          [startISO, endISO, ...candidates]
        );
        out.dd_mysql_rows = rows || [];
        out.dd_mysql_candidates = candidates;
        out.dd_mysql_period = { start: startISO, end: endISO };
        out.dd_mysql_total_qty_noncancel = (rows || []).reduce((s, r) => s + (Number(r.total_qty) - Number(r.canceled_qty || 0)), 0);
        out.dd_mysql_temp_code = tempCode;

        // order_state 분포
        try {
          const [stRows] = await ddPool.query(
            `SELECT o.order_state AS state, COUNT(DISTINCT oi.order_id) AS orders, SUM(oi.qty) AS qty
             FROM order_items oi INNER JOIN orders o ON oi.order_id = o.id
             WHERE o.created_at >= ? AND o.created_at < ?
               AND oi.product_code IN (${placeholders})
             GROUP BY o.order_state
             ORDER BY qty DESC`,
            [startISO, endISO, ...candidates]
          );
          out.dd_mysql_state_dist = stRows || [];
        } catch (sErr) { out.dd_mysql_state_dist_error = sErr.message; }
      }
    } catch (e) { out.dd_mysql_error = e.message; }
  }

  // 5) 최근 sync_log 3건
  try {
    out.recent_sync_log = await ctx.db.prepare("SELECT id, status, started_at, finished_at, success_count, fail_count, error_msg FROM sync_log WHERE sync_type='xerp_inventory' ORDER BY id DESC LIMIT 3").all();
  } catch (e) { out.sync_log_error = e.message; }

  // 6) 진단 hint
  out.hint = (() => {
    if (!out.products_row) return 'products 테이블에 그 코드 없음 → 재고현황에 안 나오는 게 정상';
    if (out.products_row.status !== 'active' && out.products_row.status !== 'inactive') return `products.status='${out.products_row.status}' — 재고현황 SELECT 필터에서 제외됨 (active/inactive 만 표시)`;
    if (out.xerp_error) return out.xerp_error + ' — XERP DB 미연결로 sync 자체가 실패';
    if (!out.xerp_inventory_rows || out.xerp_inventory_rows.length === 0) {
      if (_isDdCode) {
        if (out.dd_mysql_error) return `DD 품목 — XERP mmInventory 매칭 없음(재고 0 정상). DD MySQL 진단 실패: ${out.dd_mysql_error}`;
        if (!out.dd_mysql_rows || out.dd_mysql_rows.length === 0) return 'DD 품목 — XERP/DD MySQL 양쪽 모두 매칭 없음. order_items.product_code 표기 확인 + temp_code 매핑 필요';
        if ((out.dd_mysql_total_qty_noncancel || 0) === 0) return 'DD MySQL 매칭은 됐는데 3개월 비취소 출고가 0 — 실제 판매가 없는 상태';
        return `DD 품목 정상 — XERP 재고 없음(0)/DD MySQL 3개월 출고 ${out.dd_mysql_total_qty_noncancel} 개`;
      }
      return 'XERP mmInventory 에 그 ItemCode 자체가 없음 (정규화 매칭 포함) → sync 매칭 실패가 정상';
    }
    if (out.xerp_inventory_total_pos === 0) return 'XERP 에 row 는 있지만 모든 OhQty 음수/0 — XERP 측 데이터가 진짜 0';
    if (!out.snapshot) return 'snapshot 에 row 없음 — 마지막 sync 가 이 품목까지 안 갔거나 UPSERT 실패';
    if ((out.snapshot.current_stock || 0) === 0 && out.xerp_inventory_total_pos > 0) return `snapshot.current_stock=0 인데 XERP 양수 합계는 ${out.xerp_inventory_total_pos} — sync 단계에서 매칭 실패한 것. resolveLocal 정규화 또는 SiteCode 분기 점검 필요`;
    if (_isDdCode) {
      if ((out.snapshot.monthly_out || 0) === 0 && (out.dd_mysql_total_qty_noncancel || 0) > 0) {
        return `snapshot.monthly_out=0 인데 DD MySQL 3개월 비취소 합계는 ${out.dd_mysql_total_qty_noncancel} — sync 매칭 단계에서 출고 누락 (temp_code 매핑 점검)`;
      }
      return 'OK 정상으로 보임 (DD: 재고=XERP, 출고=DD MySQL)';
    }
    if ((out.snapshot.monthly_out || 0) === 0 && out.xerp_inoutitem_total_3m > 0 && out.xerp_so_total_3m === 0) {
      const gubuns = (out.xerp_inoutitem_3m || []).map(x => x.gubun).filter((v,i,a)=>a.indexOf(v)===i).join(',');
      return `출고 0 — XERP 에 ItemCode row 는 있는데(InoutGubun: ${gubuns}) InoutGubun='SO' 가 없음. 디디는 다른 gubun 코드로 출고하는 것일 수 있음 — 코드 분기 필요`;
    }
    if ((out.snapshot.monthly_out || 0) === 0 && out.xerp_so_total_3m > 0) {
      return `snapshot.monthly_out=0 인데 XERP SO 합계는 ${out.xerp_so_total_3m} — sync 매칭 단계에서 출고 누락`;
    }
    return 'OK 정상으로 보임';
  })();
  ctx.ok(res, out);
});

// ════════════════════════════════════════════════════════════════════
//  Debug 라우트
// ════════════════════════════════════════════════════════════════════

// GET /api/debug/env-status — 환경변수 로드 상태 진단
router.get('/api/debug/env-status', async (req, res, parsed) => {
  const envVars = ctx.envVars || {};
  const xerpConfig = ctx.xerpConfig || {};
  const barShopConfig = ctx.barShopConfig || {};
  const ddConfig = ctx.ddConfig || {};
  const dotenvPath = ctx.dotenvPath || '';
  const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;

  const mask = (v) => v ? `[${String(v).length}자]` : '(없음)';
  const src = (k) => envVars[k] ? '.env 파일' : (process.env[k] ? 'docker env' : '미설정');
  const out = {
    dotenv_path: dotenvPath,
    dotenv_exists: ctx.fs.existsSync(dotenvPath),
    xerp_config: {
      server: xerpConfig.server || '(없음)',
      port: xerpConfig.port,
      user: xerpConfig.user || '(없음)',
      password_len: mask(xerpConfig.password),
      database: xerpConfig.database
    },
    bar_shop_config: {
      server: barShopConfig.server || '(없음)',
      port: barShopConfig.port,
      user: barShopConfig.user || '(없음)',
      password_len: mask(barShopConfig.password),
      database: barShopConfig.database
    },
    dd_config: {
      host: ddConfig.host || '(없음)',
      port: ddConfig.port,
      user: ddConfig.user || '(없음)',
      password_len: mask(ddConfig.password)
    },
    sources: {
      DB_SERVER: src('DB_SERVER'),
      DB_USER: src('DB_USER'),
      DB_PASSWORD: src('DB_PASSWORD'),
      XERP_DB_SERVER: src('XERP_DB_SERVER'),
      XERP_DB_USER: src('XERP_DB_USER'),
      XERP_DB_PASSWORD: src('XERP_DB_PASSWORD'),
      DD_DB_SERVER: src('DD_DB_SERVER'),
      DD_DB_USER: src('DD_DB_USER'),
      DD_DB_PASSWORD: src('DD_DB_PASSWORD')
    },
    xerp_pool_connected: !!xerpPool
  };
  ctx.ok(res, out);
});

// GET /api/debug/xerp-warehouses — XERP 창고 목록 조회
router.get('/api/debug/xerp-warehouses', async (req, res, parsed) => {
  try {
    await ctx.ensureXerpPool();
    const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;
    if (!xerpPool) { ctx.fail(res, 503, 'XERP 풀 미연결'); return; }
    const XERP_SITE_CODE = ctx.XERP_SITE_CODE || 'BK10';
    const XERP_INV_WH_LIST = ctx.XERP_INV_WH_LIST || [];
    const r = await xerpPool.request().query(`
      SELECT RTRIM(inv.WhCode) AS wh_code,
             COUNT(DISTINCT RTRIM(inv.ItemCode)) AS item_count,
             SUM(CASE WHEN inv.OhQty > 0 THEN inv.OhQty ELSE 0 END) AS total_qty
      FROM mmInventory inv WITH (NOLOCK)
      WHERE inv.SiteCode = '${XERP_SITE_CODE}' AND inv.WhCode IS NOT NULL AND RTRIM(inv.WhCode) <> ''
      GROUP BY RTRIM(inv.WhCode)
      ORDER BY item_count DESC
    `);
    ctx.ok(res, {
      configured: XERP_INV_WH_LIST,
      configured_active: XERP_INV_WH_LIST.length > 0,
      warehouses: r.recordset,
      hint: '환경변수 XERP_INV_WAREHOUSE=<wh_code> 로 설정하면 해당 창고만 조회. 여러 개는 콤마 구분.'
    });
  } catch (e) {
    ctx.fail(res, 500, '창고 조회 실패: ' + e.message);
  }
});

// GET /api/debug/bhc-diag — BHC (디얼디어) DB 재고 진단
router.get('/api/debug/bhc-diag', async (req, res, parsed) => {
  let bhcPool = null;
  const connectAttempts = [];
  try {
    const barShopConfig = ctx.barShopConfig || {};
    const xerpConfig = ctx.xerpConfig || {};
    const tryConfigs = [
      { name: 'barShopConfig (DB_USER)', cfg: barShopConfig },
      { name: 'xerpConfig (XERP_DB_USER)', cfg: xerpConfig }
    ];
    let usedConfig = null;
    for (const tc of tryConfigs) {
      try {
        const pool = new ctx.sql.ConnectionPool({ ...tc.cfg, database: 'BHC' });
        await pool.connect();
        bhcPool = pool;
        usedConfig = tc.name;
        connectAttempts.push({ name: tc.name, result: 'ok' });
        break;
      } catch (e) {
        connectAttempts.push({ name: tc.name, result: 'fail', error: e.message });
      }
    }
    if (!bhcPool) {
      ctx.jsonRes(res, 500, { ok: false, error: 'BHC 연결 실패 — 모든 credential 실패', attempts: connectAttempts });
      return;
    }

    const out = { bhc_connection: 'ok', used_config: usedConfig, connect_attempts: connectAttempts };

    // 1) BHC.mmInventory 의 SiteCode 분포
    const sites = await bhcPool.request().query(`
      SELECT RTRIM(SiteCode) AS site_code,
             COUNT(*) AS row_count,
             COUNT(DISTINCT RTRIM(ItemCode)) AS item_count,
             SUM(CASE WHEN OhQty > 0 THEN OhQty ELSE 0 END) AS total_qty
      FROM mmInventory WITH (NOLOCK)
      GROUP BY RTRIM(SiteCode)
      ORDER BY row_count DESC
    `);
    out.mmInventory_sitecodes = sites.recordset;

    // 2) BHC.mmInventory 의 WhCode 분포
    const whs = await bhcPool.request().query(`
      SELECT RTRIM(SiteCode) AS site_code,
             RTRIM(WhCode) AS wh_code,
             COUNT(*) AS row_count,
             COUNT(DISTINCT RTRIM(ItemCode)) AS item_count,
             SUM(CASE WHEN OhQty > 0 THEN OhQty ELSE 0 END) AS total_qty
      FROM mmInventory WITH (NOLOCK)
      GROUP BY RTRIM(SiteCode), RTRIM(WhCode)
      ORDER BY row_count DESC
    `);
    out.mmInventory_warehouses = whs.recordset;

    // 3) 상위 10개 재고 품목 (샘플)
    const topItems = await bhcPool.request().query(`
      SELECT TOP 10
             RTRIM(SiteCode) AS site_code,
             RTRIM(WhCode) AS wh_code,
             RTRIM(ItemCode) AS item_code,
             OhQty
      FROM mmInventory WITH (NOLOCK)
      WHERE OhQty > 0
      ORDER BY OhQty DESC
    `);
    out.mmInventory_top_items = topItems.recordset;

    // 4) 로컬 products 에서 DD 계열 품목코드 10개 샘플
    const localDD = await ctx.db.prepare(`
      SELECT product_code FROM products
      WHERE legal_entity = 'dd' OR product_code LIKE 'DD%'
      LIMIT 10
    `).all();
    out.local_dd_sample = localDD.map(r => r.product_code);

    // 5) 각 DD 품목코드가 BHC.mmInventory 에 있는지 매칭
    const matchCheck = {};
    for (const r of localDD) {
      const code = (r.product_code || '').replace(/'/g, "''");
      if (!code) continue;
      const exact = await bhcPool.request().query(`
        SELECT COUNT(*) AS cnt,
               SUM(CASE WHEN OhQty > 0 THEN OhQty ELSE 0 END) AS qty,
               STRING_AGG(RTRIM(SiteCode), ',') AS sites,
               STRING_AGG(RTRIM(WhCode), ',') AS whs
        FROM mmInventory WITH (NOLOCK)
        WHERE RTRIM(ItemCode) = '${code}'
      `);
      const likeSample = await bhcPool.request().query(`
        SELECT TOP 3 RTRIM(SiteCode) AS site_code,
               RTRIM(WhCode) AS wh_code,
               RTRIM(ItemCode) AS item_code,
               OhQty
        FROM mmInventory WITH (NOLOCK)
        WHERE ItemCode LIKE '%${code}%'
      `);
      matchCheck[r.product_code] = {
        exact_count: exact.recordset[0]?.cnt || 0,
        exact_qty: exact.recordset[0]?.qty || 0,
        exact_sites: exact.recordset[0]?.sites || '',
        exact_whs: exact.recordset[0]?.whs || '',
        like_sample: likeSample.recordset
      };
    }
    out.dd_match_check = matchCheck;

    // 6) ItemCode prefix 분포
    const prefixes = await bhcPool.request().query(`
      SELECT TOP 20
             LEFT(RTRIM(ItemCode), 3) AS prefix3,
             COUNT(DISTINCT RTRIM(ItemCode)) AS code_count
      FROM mmInventory WITH (NOLOCK)
      WHERE OhQty > 0
      GROUP BY LEFT(RTRIM(ItemCode), 3)
      ORDER BY code_count DESC
    `);
    out.mmInventory_itemcode_prefix3 = prefixes.recordset;

    out.hint = '결과 해석: mmInventory_sitecodes 에 "BHC2" 가 없거나 row_count 가 0 이면 SiteCode 가 다른 것. dd_match_check 에서 exact_count=0 인데 like_sample 에 결과가 있으면 품목코드 포맷 불일치(prefix/suffix 차이). prefix3 에 "DDC"/"DD_" 가 없으면 BHC 에 DD 품목이 아예 없는 것.';

    ctx.ok(res, out);
  } catch (e) {
    ctx.fail(res, 500, 'BHC 진단 실패: ' + e.message);
  } finally {
    if (bhcPool) { try { await bhcPool.close(); } catch(_){} }
  }
});

// GET /api/debug/xerp-match — XERP ↔ 로컬 제품코드 매칭 확인
router.get('/api/debug/xerp-match', async (req, res, parsed) => {
  const code = (parsed.searchParams.get('code') || '').trim();
  if (!code) { ctx.fail(res, 400, 'code 파라미터 필요'); return; }
  const cleanCode = code.replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();

  const out = { input: code, cleaned: cleanCode };
  try {
    const localRows = await ctx.db.prepare("SELECT product_code, product_name, origin, status FROM products WHERE product_code = ? OR product_code LIKE ?").all(cleanCode, '%' + cleanCode + '%');
    out.local_products = localRows.map(r => ({
      product_code: r.product_code,
      code_chars: Array.from(r.product_code || '').map(ch => ch.charCodeAt(0)).join(','),
      product_name: r.product_name,
      origin: r.origin,
      status: r.status
    }));
  } catch(e) { out.local_error = e.message; }

  try {
    await ctx.ensureXerpPool();
    const xerpPool = ctx.getXerpPool ? ctx.getXerpPool() : null;
    if (!xerpPool) { out.xerp_error = 'XERP 풀 미연결'; }
    else {
      // 2) XERP mmInventory - 정확 매칭
      const exact = await xerpPool.request().query(`
        SELECT * FROM mmInventory WITH (NOLOCK)
        WHERE RTRIM(ItemCode) = '${cleanCode.replace(/'/g, "''")}'
      `);
      out.xerp_inventory_exact = exact.recordset;
      const rows = exact.recordset || [];
      const sumAll = rows.reduce((s,r) => s + Number(r.OhQty || 0), 0);
      const sumPositiveOnly = rows.filter(r => Number(r.OhQty || 0) > 0).reduce((s,r) => s + Number(r.OhQty || 0), 0);
      const sumByBK10 = rows.filter(r => (r.SiteCode || '').trim() === 'BK10').reduce((s,r) => s + Number(r.OhQty || 0), 0);
      const sumBK10PositiveOnly = rows.filter(r => (r.SiteCode || '').trim() === 'BK10' && Number(r.OhQty || 0) > 0).reduce((s,r) => s + Number(r.OhQty || 0), 0);
      out.xerp_inventory_summary = {
        row_count: rows.length,
        sites: [...new Set(rows.map(r => (r.SiteCode || '').trim()))],
        sum_all: sumAll,
        sum_positive_only: sumPositiveOnly,
        sum_bk10_all: sumBK10PositiveOnly,
        sum_bk10_including_negative: sumByBK10
      };

      // 3) LIKE 매칭
      const like = await xerpPool.request().query(`
        SELECT TOP 10 RTRIM(ItemCode) AS item_code, SiteCode, OhQty,
               LEN(ItemCode) AS len_ic
        FROM mmInventory WITH (NOLOCK)
        WHERE ItemCode LIKE '%${cleanCode.replace(/'/g, "''")}%'
          AND RTRIM(ItemCode) <> '${cleanCode.replace(/'/g, "''")}'
      `);
      out.xerp_inventory_like = like.recordset;

      // 4) mmInoutItem - 최근 3개월 출고
      const today = new Date();
      const start3m = new Date(today); start3m.setMonth(start3m.getMonth() - 3);
      const fmt = d => d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
      const ship = await xerpPool.request()
        .input('s', ctx.sql.NChar(16), fmt(start3m))
        .input('t', ctx.sql.NChar(16), fmt(today))
        .query(`
          SELECT TOP 5 RTRIM(ItemCode) AS item_code, InoutDate, InoutQty, InoutGubun
          FROM mmInoutItem WITH (NOLOCK)
          WHERE RTRIM(ItemCode) = '${cleanCode.replace(/'/g, "''")}'
            AND InoutDate >= @s AND InoutDate < @t
            AND InoutGubun = 'SO'
          ORDER BY InoutDate DESC
        `);
      out.xerp_shipment_exact = ship.recordset;
    }
  } catch(e) { out.xerp_error = e.message; }

  ctx.ok(res, out);
});

// ════════════════════════════════════════════════════════════════════
//  알림 (Notifications)
// ════════════════════════════════════════════════════════════════════

// GET /api/notifications — 알림 목록
router.get('/api/notifications', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const uid = decoded ? decoded.userId : 0;
  const rows = await ctx.db.prepare("SELECT * FROM notifications WHERE user_id IS NULL OR user_id = ? ORDER BY created_at DESC LIMIT 100").all(uid);
  ctx.ok(res, rows);
});

// GET /api/notifications/unread-count — 읽지 않은 알림 수
router.get('/api/notifications/unread-count', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const uid = decoded ? decoded.userId : 0;
  const r = await ctx.db.prepare("SELECT COUNT(*) AS cnt FROM notifications WHERE (user_id IS NULL OR user_id = ?) AND is_read = 0").get(uid);
  ctx.ok(res, { count: r.cnt });
});

// POST /api/notifications/read/:id — 개별 알림 읽음 처리
router.postP(/^\/api\/notifications\/read\/(\d+)$/, async (req, res, parsed, match) => {
  const id = match[1];
  await ctx.db.prepare("UPDATE notifications SET is_read = 1 WHERE id = ?").run(id);
  ctx.ok(res, { updated: true });
});

// POST /api/notifications/read-all — 전체 읽음 처리
router.post('/api/notifications/read-all', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const uid = decoded ? decoded.userId : 0;
  await ctx.db.prepare("UPDATE notifications SET is_read = 1 WHERE (user_id IS NULL OR user_id = ?) AND is_read = 0").run(uid);
  ctx.ok(res, { updated: true });
});

// ════════════════════════════════════════════════════════════════════
//  전자결재 (Approvals)
// ════════════════════════════════════════════════════════════════════

// GET /api/approvals/pending-count — 미결 결재 수
router.get('/api/approvals/pending-count', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const uid = decoded ? decoded.userId : 0;
  const r = await ctx.db.prepare("SELECT COUNT(*) AS cnt FROM approval_lines al JOIN approvals a ON a.id=al.approval_id WHERE al.approver_id=? AND al.status='pending' AND a.status='pending'").get(uid);
  ctx.ok(res, { count: r.cnt });
});

// GET /api/approvals — 결재 목록
router.get('/api/approvals', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const uid = decoded ? decoded.userId : 0;
  const qs = new URL(req.url, 'http://localhost').searchParams;
  const tab = qs.get('tab') || 'my';
  let rows = [];
  if (tab === 'my') rows = await ctx.db.prepare("SELECT * FROM approvals WHERE requester_id=? ORDER BY created_at DESC LIMIT 200").all(uid);
  else if (tab === 'pending') rows = await ctx.db.prepare("SELECT a.* FROM approvals a JOIN approval_lines al ON a.id=al.approval_id WHERE al.approver_id=? AND al.status='pending' AND a.status='pending' ORDER BY a.created_at DESC").all(uid);
  else rows = await ctx.db.prepare("SELECT a.* FROM approvals a JOIN approval_lines al ON a.id=al.approval_id WHERE al.approver_id=? AND al.status IN ('approved','rejected') ORDER BY al.acted_at DESC LIMIT 200").all(uid);
  ctx.ok(res, rows);
});

// POST /api/approvals — 결재 상신
router.post('/api/approvals', async (req, res, parsed) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const uid = decoded ? decoded.userId : 0;
  const uname = decoded ? decoded.username : 'system';
  const body = await ctx.readJSON(req);
  const today = new Date().toISOString().slice(0,10).replace(/-/g,'');
  const seq = (await ctx.db.prepare("SELECT COUNT(*) AS cnt FROM approvals WHERE approval_no LIKE ?").get('AP-'+today+'%')).cnt + 1;
  const no = 'AP-'+today+'-'+String(seq).padStart(3,'0');
  const lines = body.lines || [];
  // approver_name만 있고 approver_id가 없으면 users에서 자동 조회
  for (const ln of lines) {
    if (!ln.approver_id && ln.approver_name) {
      const u = await ctx.db.prepare("SELECT user_id, display_name, username FROM users WHERE display_name = ? OR username = ? LIMIT 1").get(ln.approver_name, ln.approver_name);
      if (u) { ln.approver_id = u.user_id; ln.approver_name = u.display_name || u.username; }
    }
  }
  const info = await ctx.db.prepare("INSERT INTO approvals (approval_no,doc_type,doc_ref,title,content,amount,status,requester_id,requester_name,current_step,total_steps) VALUES (?,?,?,?,?,?,?,?,?,1,?)").run(
    no, body.doc_type||'general', body.doc_ref||'', body.title||'', body.content||'', body.amount||0, 'pending', uid, uname, Math.max(lines.length,1));
  const aid = info.lastInsertRowid;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    await ctx.db.prepare("INSERT INTO approval_lines (approval_id,step_order,approver_id,approver_name,role) VALUES (?,?,?,?,?)").run(aid, i+1, ln.approver_id||null, ln.approver_name||'', ln.role||'approver');
  }
  // 첫 번째 결재자에게 알림
  if (lines.length > 0) ctx.createNotification(lines[0].approver_id, 'approval', '결재 요청: '+body.title, uname+'님이 결재를 요청했습니다.', 'approval');
  ctx.auditLog(uid, uname, 'approval_create', 'approvals', aid, `결재상신: ${no} "${body.title}" (${body.doc_type||'일반'})`, clientIP);
  ctx.ok(res, { id: aid, approval_no: no });
});

// GET /api/approvals/:id — 결재 상세
router.getP(/^\/api\/approvals\/(\d+)$/, async (req, res, parsed, match) => {
  const id = match[1];
  const row = await ctx.db.prepare("SELECT * FROM approvals WHERE id=?").get(id);
  if (!row) { ctx.fail(res, 404, '결재 문서를 찾을 수 없습니다'); return; }
  const lines = await ctx.db.prepare("SELECT * FROM approval_lines WHERE approval_id=? ORDER BY step_order").all(id);
  ctx.ok(res, { ...row, lines });
});

// POST /api/approvals/:id/approve — 결재 승인
router.postP(/^\/api\/approvals\/(\d+)\/approve$/, async (req, res, parsed, match) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const id = match[1];
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const body = await ctx.readJSON(req);
  const ap = await ctx.db.prepare("SELECT * FROM approvals WHERE id=?").get(id);
  if (!ap || ap.status !== 'pending') { ctx.fail(res, 400, '결재 불가 상태'); return; }
  const line = await ctx.db.prepare("SELECT * FROM approval_lines WHERE approval_id=? AND step_order=? AND status='pending'").get(id, ap.current_step);
  if (!line) { ctx.fail(res, 403, '결재 권한이 없습니다'); return; }
  await ctx.db.prepare("UPDATE approval_lines SET status='approved', comment=?, acted_at=datetime('now','localtime') WHERE id=?").run(body.comment||'', line.id);
  const nextLine = await ctx.db.prepare("SELECT * FROM approval_lines WHERE approval_id=? AND step_order>? AND status='pending' ORDER BY step_order LIMIT 1").get(id, line.step_order);
  if (nextLine) {
    await ctx.db.prepare("UPDATE approvals SET current_step=?, updated_at=datetime('now','localtime') WHERE id=?").run(nextLine.step_order, id);
    ctx.createNotification(nextLine.approver_id, 'approval', '결재 요청: '+ap.title, '다음 단계 결재를 요청합니다.', 'approval');
  } else {
    await ctx.db.prepare("UPDATE approvals SET status='approved', updated_at=datetime('now','localtime') WHERE id=?").run(id);
    ctx.createNotification(ap.requester_id, 'approval', '결재 승인: '+ap.title, '요청하신 결재가 최종 승인되었습니다.', 'approval');
  }
  if (decoded) ctx.auditLog(decoded.userId, decoded.username, 'approval_approve', 'approvals', id, `결재승인: ${ap.approval_no||id} "${ap.title}"`, clientIP);
  ctx.ok(res, { approved: true });
});

// POST /api/approvals/:id/reject — 결재 반려
router.postP(/^\/api\/approvals\/(\d+)\/reject$/, async (req, res, parsed, match) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const id = match[1];
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const body = await ctx.readJSON(req);
  const ap = await ctx.db.prepare("SELECT * FROM approvals WHERE id=?").get(id);
  if (!ap || ap.status !== 'pending') { ctx.fail(res, 400, '결재 불가 상태'); return; }
  const line = await ctx.db.prepare("SELECT * FROM approval_lines WHERE approval_id=? AND step_order=? AND status='pending'").get(id, ap.current_step);
  if (!line) { ctx.fail(res, 403, '결재 권한이 없습니다'); return; }
  await ctx.db.prepare("UPDATE approval_lines SET status='rejected', comment=?, acted_at=datetime('now','localtime') WHERE id=?").run(body.comment||'', line.id);
  await ctx.db.prepare("UPDATE approvals SET status='rejected', updated_at=datetime('now','localtime') WHERE id=?").run(id);
  ctx.createNotification(ap.requester_id, 'approval', '결재 반려: '+ap.title, (body.comment||'사유 없음'), 'approval');
  if (decoded) ctx.auditLog(decoded.userId, decoded.username, 'approval_reject', 'approvals', id, `결재반려: ${ap.approval_no||id} "${ap.title}" 사유:${body.comment||'없음'}`, clientIP);
  ctx.ok(res, { rejected: true });
});

// ════════════════════════════════════════════════════════════════════
//  버전 정보
// ════════════════════════════════════════════════════════════════════

// GET /api/version — 앱 버전 정보 (공개)
router.get('/api/version', async (req, res, parsed) => {
  const APP_VERSION = ctx.APP_VERSION || '0.0.0';
  const APP_VERSION_DATE = ctx.APP_VERSION_DATE || '';
  const _startTime = ctx._startTime || Date.now();
  ctx.ok(res, { version: APP_VERSION, version_date: APP_VERSION_DATE, started_at: new Date(_startTime).toISOString() });
});

module.exports = { router };
