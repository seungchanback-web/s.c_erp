// routes/vendors.js — 거래처 관리/통계 라우트 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ═════════════════════════════��══════════════════════════════════���═══
//  거래처명 입력 유효성 검증 (내부 헬퍼)
// ════════════════════════════════════════════════════════════════════

function validateVendorInput(body) {
  const name = (body.name || '').trim();
  if (!name) return '거래처명을 입력하세요';
  if (name.length < 2) return '거래처명은 2자 이상이어야 합니다';
  if (name.length > 100) return '거래처명은 100자를 초과할 수 없습니다';
  // XSS 방지
  if (/<\s*script/i.test(name) || /<\s*\/\s*script/i.test(name)) return '거래처명에 스크립트 태그를 사용할 수 없습니다';
  if (/on\w+\s*=/i.test(name)) return '거래처명에 이벤트 핸들러를 포함할 수 없습니다';
  // SQL 인젝션 명시 패턴
  if (/drop\s+table/i.test(name) || /;\s*delete\s+from/i.test(name) || /union\s+select/i.test(name)) {
    return '거래처명에 SQL 예약어 패턴을 사용할 수 없습니다';
  }
  // 명백한 테스트 패턴 차단
  const testPatterns = [
    /^test$/i,
    /^testvendor/i,
    /^FT[-_]/i,
    /^FT-?(Customer|Supplier|Cust|Sup)/i,
    /^NoAuth/i,
    /^테스트업체[-_]/,
    /^dummy/i,
    /^sample[-_]/i,
    /^placeholder/i
  ];
  if (testPatterns.some(re => re.test(name))) {
    return '테스트용 이름은 사용할 수 없습니다';
  }
  // 제어문자
  if (/[\x00-\x1F\x7F]/.test(name)) return '거래처명에 제어문자를 사용할 수 없습니다';
  // 대체 문자 (인코딩 손상)
  if (name.includes('\uFFFD')) return '거래처명 인코딩이 손상되었습니다';
  return null;
}

// ════════════════════════════════════════════════════════════════════
//  거래처 CRUD
// ════════════════════════════════════════════════════════════════════

// GET /api/vendors — 거래처 목록
router.get('/api/vendors', async (req, res, parsed) => {
  const rows = await ctx.db.prepare('SELECT * FROM vendors ORDER BY name').all();
  ctx.ok(res, rows);
});

// POST /api/vendors — 거래처 등록
router.post('/api/vendors', async (req, res, parsed) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const body = await ctx.readJSON(req);
  const vErr = validateVendorInput(body);
  if (vErr) { ctx.fail(res, 400, vErr); return; }
  const info = await ctx.db.prepare(`INSERT INTO vendors (vendor_code, name, type, contact, phone, email, email_cc, kakao, memo) VALUES (?,?,?,?,?,?,?,?,?)`).run(
    body.vendor_code || '', body.name || '', body.type || '', body.contact || '',
    body.phone || '', body.email || '', body.email_cc || '', body.kakao || '', body.memo || ''
  );
  if (decoded) ctx.auditLog(decoded.userId, decoded.username, 'vendor_create', 'vendors', info.lastInsertRowid, `거래처 등록: ${body.name}`, clientIP);
  ctx.ok(res, { vendor_id: info.lastInsertRowid });
});

// POST /api/vendors/migrate — 거래처 일괄 마이그레이션
router.post('/api/vendors/migrate', async (req, res, parsed) => {
  const vendors = await ctx.readJSON(req);
  if (!Array.isArray(vendors)) { ctx.fail(res, 400, 'Expected array'); return; }
  const tx = ctx.db.transaction(async (list) => {
    let count = 0;
    for (const v of list) {
      const info = await ctx.db.prepare(`INSERT INTO vendors (name, type, contact, phone, email, kakao, memo) VALUES (?,?,?,?,?,?,?) ON CONFLICT DO NOTHING`).run(
        v.name || '', v.type || '', v.contact || '', v.phone || '', v.email || '', v.kakao || '', v.memo || ''
      );
      if (info.changes > 0) count++;
    }
    return count;
  });
  const count = await tx(vendors);
  ctx.ok(res, { migrated: count, total: vendors.length });
});

// PUT /api/vendors/:id — 거래처 수정
router.putP(/^\/api\/vendors\/(\d+)$/, async (req, res, parsed, match) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const id = parseInt(match[1]);
  const body = await ctx.readJSON(req);
  // name 변경 시 validation 적용
  if (body.name !== undefined) {
    const vErr = validateVendorInput(body);
    if (vErr) { ctx.fail(res, 400, vErr); return; }
  }
  const fields = [];
  const values = [];
  for (const col of ['vendor_code', 'name', 'type', 'contact', 'phone', 'email', 'email_cc', 'kakao', 'memo']) {
    if (body[col] !== undefined) {
      fields.push(`${col} = ?`);
      values.push(body[col]);
    }
  }
  if (fields.length === 0) { ctx.fail(res, 400, 'No fields to update'); return; }
  fields.push(`updated_at = datetime('now','localtime')`);
  values.push(id);
  await ctx.db.prepare(`UPDATE vendors SET ${fields.join(', ')} WHERE vendor_id = ?`).run(...values);
  if (decoded) ctx.auditLog(decoded.userId, decoded.username, 'vendor_update', 'vendors', id, `거래처 수정: ${body.name || id}`, clientIP);
  ctx.ok(res, { vendor_id: id });
});

// DELETE /api/vendors/:id — 거래처 삭제
router.delP(/^\/api\/vendors\/(\d+)$/, async (req, res, parsed, match) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  const id = parseInt(match[1]);
  await ctx.db.prepare('DELETE FROM vendors WHERE vendor_id = ?').run(id);
  if (decoded) ctx.auditLog(decoded.userId, decoded.username, 'vendor_delete', 'vendors', id, `거래처 삭제`, clientIP);
  ctx.ok(res, { deleted: id });
});

// ════════════════════════════════════════════════════════════════════
//  거래처 통계
// ════════════════════════════════════════════════════════════════════

// GET /api/stats/vendor-summary — 거래처별 발주 통계
router.get('/api/stats/vendor-summary', async (req, res, parsed) => {
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const from = qs.get('from') || new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().slice(0, 10);
  const to = qs.get('to') || new Date().toISOString().slice(0, 10);
  const rows = await ctx.db.prepare(`
    SELECT vendor_name,
      COUNT(*) as order_count,
      COALESCE(SUM(total_qty), 0) as total_qty,
      COALESCE(SUM(CASE WHEN status IN ('received','os_pending') THEN 1 ELSE 0 END), 0) as completed_count
    FROM po_header
    WHERE po_date >= ? AND po_date <= ? AND status != 'cancelled'
    GROUP BY vendor_name
    ORDER BY order_count DESC
  `).all(from, to);

  // 납기 준수율 및 평균 리드타임 계산
  const result = await Promise.all(rows.map(async r => {
    const ltRows = await ctx.db.prepare(`
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
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const today = new Date();
  const defaultFrom = new Date(today.getFullYear(), today.getMonth() - 5, 1).toISOString().slice(0, 10);
  const from = qs.get('from') || defaultFrom;
  const to = qs.get('to') || today.toISOString().slice(0, 10);
  const minOrders = parseInt(qs.get('min_orders') || '1', 10);

  // 1) 발주 통계 (업체별)
  const poStats = await ctx.db.prepare(`
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
    const ltRows = await ctx.db.prepare(`
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
  const defectStats = await ctx.db.prepare(`
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
      // 종합 점수 (0~100): 납기 준수율(50%) + 품질(50%)
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

module.exports = { router };
