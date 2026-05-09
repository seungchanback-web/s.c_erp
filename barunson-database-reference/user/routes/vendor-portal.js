// routes/vendor-portal.js — 업체 포털 API (Vendor Portal)
// 업체 전용 JWT 인증 (decodeVendorToken, verifyVendorToken, extractVendorAuth, generateVendorToken)
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  VENDOR PORTAL — 토큰 생성
// ════════════════════════════════════════════════════════════════════

// GET /api/vendor-portal/generate-token — 관리자가 거래처 포탈 접속 토큰 생성
router.get('/api/vendor-portal/generate-token', async (req, res, parsed) => {
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const email = qs.get('email') || '';
  const name = qs.get('name') || '';
  if (!email) { ctx.fail(res, 400, '이메일 필요'); return; }
  const token = ctx.generateVendorToken(email, name);
  ctx.ok(res, { access: token });
});

// ════════════════════════════════════════════════════════════════════
//  VENDOR PORTAL — 메인 대시보드 (PO 목록)
// ════════════════════════════════════════════════════════════════════

// GET /api/vendor-portal — 업체 전용 PO 목록
router.get('/api/vendor-portal', async (req, res, parsed) => {
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  // access 토큰 방식 (신규) 또는 email+token 방식 (레거시)
  const accessToken = qs.get('access') || qs.get('token') || '';
  const decoded = ctx.decodeVendorToken(accessToken);
  const email = decoded ? decoded.email : (qs.get('email') || '');
  const vendorNameParam = decoded ? (decoded.name || '') : (qs.get('vendor_name') || '');
  if (!email || !ctx.verifyVendorToken(email, accessToken)) {
    ctx.fail(res, 403, '인증 실패'); return;
  }
  // vendor_name 파라미터가 있으면 이름으로 정확 매칭, 없으면 이메일로 조회
  let vendor;
  if (vendorNameParam) {
    vendor = await ctx.db.prepare('SELECT * FROM vendors WHERE name = ? AND email = ?').get(vendorNameParam, email);
  }
  if (!vendor) {
    vendor = await ctx.db.prepare('SELECT * FROM vendors WHERE email = ?').get(email);
  }
  if (!vendor) { ctx.fail(res, 404, '등록된 업체가 아닙니다'); return; }

  const rows = await ctx.db.prepare('SELECT * FROM po_header WHERE vendor_name = ? ORDER BY po_date DESC, po_id DESC').all(vendor.name);
  // ── N+1 제거: po_items 일괄 조회 후 그룹핑 ──
  const poIds = rows.map(r => r.po_id);
  let allItems = [];
  if (poIds.length) {
    const placeholders = poIds.map(() => '?').join(',');
    allItems = await ctx.db.prepare(`SELECT * FROM po_items WHERE po_id IN (${placeholders})`).all(...poIds);
  }
  const itemsByPoId = {};
  for (const it of allItems) {
    if (!itemsByPoId[it.po_id]) itemsByPoId[it.po_id] = [];
    itemsByPoId[it.po_id].push(it);
  }
  const _postCols = await ctx.getPostProcessTypes();
  for (const r of rows) {
    r.status = ctx.PO_STATUS_EN_TO_KO[r.status] || r.status;
    r.material_status_label = ctx.MATERIAL_STATUS_KO[r.material_status] || r.material_status;
    r.process_status_label = ctx.PROCESS_STATUS_KO[r.process_status] || r.process_status;
    r.items = itemsByPoId[r.po_id] || [];
    // product_info 데이터 보강 (원자재코드, 원재료용지명, 절, 조판, 후공정체인)
    const pInfo = ctx.getProductInfo();
    const postCols = _postCols;
    const steps = [];
    for (const it of r.items) {
      const info = pInfo[it.product_code] || {};
      it.material_code = info['원자재코드'] || info.material_code || '';
      it.material_name = info['원재료용지명'] || info.material_name || '';
      it.cut = info['절'] || '';
      it.imposition = info['조판'] || '';
      it.product_spec = info['제품사양'] || it.spec || '';
      // 품목별 후공정 체인 — _steps(step_order) 우선, 없으면 postCols 순서 fallback
      let itemSteps = [];
      if (info._steps && info._steps.length) {
        itemSteps = info._steps.map(s => ({ p: s.process, v: s.vendor }));
      } else {
        postCols.forEach(c => {
          if (info[c] && info[c] !== '0' && !/^[\d,.]+$/.test(String(info[c]).trim())) itemSteps.push({ p: c, v: info[c] });
        });
      }
      it.first_process = itemSteps.length ? itemSteps[0].p : '';
      it.first_process_vendor = itemSteps.length ? itemSteps[0].v : '';
      it.process_chain_full = itemSteps.map(s => s.v + '(' + s.p + ')').join(' → ');
      // 품목별 입고처 + 공정명 보정: 현재 업체의 공정 찾기
      if (vendor.type === '후공정' && itemSteps.length > 0) {
        const vName = vendor.name || '';
        let foundIdx = -1;
        // 1) 정확 매칭
        for (let si = 0; si < itemSteps.length; si++) {
          if (itemSteps[si].v === vName) { foundIdx = si; break; }
        }
        // 2) 부분 매칭 (코리아↔코리아패키지 등)
        if (foundIdx < 0) {
          for (let si = 0; si < itemSteps.length; si++) {
            const sv = itemSteps[si].v;
            if (vName.includes(sv) || sv.includes(vName)) { foundIdx = si; break; }
          }
        }
        // 공정명: product_info 기반으로 보정 (DB에 깨진 한글 방지)
        if (foundIdx >= 0) {
          it.resolved_process = itemSteps[foundIdx].p;
        }
        if (foundIdx >= 0 && foundIdx < itemSteps.length - 1) {
          const nxt = itemSteps[foundIdx + 1];
          it.item_next_dest = nxt.v + '(' + nxt.p + ')';
        } else {
          it.item_next_dest = '파주(본사)';
        }
      }
      // PO 전체 후공정 체인 수집
      itemSteps.forEach(s => {
        if (!steps.find(x => x.p === s.p && x.v === s.v)) steps.push(s);
      });
    }
    // 입고처 결정: 원재료→첫번째 후공정 업체, 후공정→다음단계 또는 파주(본사)
    if (vendor.type === '원재료' && steps.length > 0) {
      r.next_destination = steps[0].v + '(' + steps[0].p + ')';
      r.process_chain_label = steps.map(s => s.v + '(' + s.p + ')').join(' → ');
    } else if (vendor.type === '후공정') {
      const chain = r.process_chain ? JSON.parse(r.process_chain) : [];
      const curStep = r.process_step || 0;
      const nextInfo = chain.find(s => s.step === curStep + 1);
      r.next_destination = nextInfo ? nextInfo.vendor + '(' + nextInfo.process + ')' : '파주(본사)';
      r.process_chain_label = chain.length ? chain.map(s => s.vendor + '(' + s.process + ')').join(' → ') : '';
    }
    if (!r.next_destination) r.next_destination = '파주(본사)';
  }
  // 재고 정보 보강 (스마트재고현황 캐시 활용 — 모든 업체에 긴급도 제공)
  try {
    // XERP 재고 캐시에서 가져오기 (10분 갱신)
    const invMap = {};
    const cacheKeys = ['all', 'barunson', 'dd'];
    for (const ck of cacheKeys) {
      const ce = ctx.xerpInventoryCaches ? ctx.xerpInventoryCaches[ck] : null;
      if (ce && ce.data && ce.data.products) {
        for (const p of ce.data.products) {
          const code = p['제품코드'] || p.product_code;
          if (code && !invMap[code]) {
            invMap[code] = {
              stock: p['현재고'] || p['가용재고'] || 0,
              monthly: p['_xerpMonthly'] || 0,
              status: p._status || '',           // urgent/danger/safe
              remainDays: p._remainDays || null,  // 잔여일수
              safetyStock: p._safetyStock || 0
            };
          }
        }
      }
    }
    // 캐시가 비어있으면 XERP 직접 조회 (원재료 업체만 — 후공정은 캐시만 사용)
    if (Object.keys(invMap).length === 0 && vendor.type === '원재료' && typeof ctx.ensureXerpPool === 'function') {
      try {
        if (await ctx.ensureXerpPool()) {
          const xerpPool = ctx.getXerpPool();
          const codes = new Set();
          for (const po of rows) { for (const it of (po.items||[])) { if (it.product_code) codes.add(it.product_code); } }
          if (codes.size > 0) {
            const safeList = [...codes].filter(c => /^[A-Za-z0-9_\-]+$/.test(c)).map(c => `'${c}'`).join(',');
            if (safeList) {
              // ★ 양수 OhQty 만 SUM — XERP 스마트재고현황과 일치 (음수 예약/조정 lot 제외)
              const invR = await xerpPool.request().query(`SELECT RTRIM(ItemCode) AS code, SUM(CASE WHEN OhQty > 0 THEN OhQty ELSE 0 END) AS qty FROM mmInventory WITH(NOLOCK) WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND RTRIM(ItemCode) IN (${safeList}) GROUP BY RTRIM(ItemCode)`);
              for (const r of (invR.recordset||[])) { invMap[r.code.trim()] = { stock: Math.round(r.qty||0), monthly: 0 }; }
              // 월출고
              const today = new Date(); const s3m = new Date(today); s3m.setMonth(s3m.getMonth()-3);
              const fmt = d => d.getFullYear()+String(d.getMonth()+1).padStart(2,'0')+String(d.getDate()).padStart(2,'0');
              const shipR = await xerpPool.request().input('s3',ctx.sql.NChar(16),fmt(s3m)).input('t',ctx.sql.NChar(16),fmt(today)).query(`SELECT RTRIM(ItemCode) AS code, SUM(InoutQty) AS qty FROM mmInoutItem WITH(NOLOCK) WHERE SiteCode='${ctx.XERP_SITE_CODE}' AND InoutGubun='SO' AND InoutDate>=@s3 AND InoutDate<@t AND RTRIM(ItemCode) IN (${safeList}) GROUP BY RTRIM(ItemCode)`);
              for (const r of (shipR.recordset||[])) { const c=r.code.trim(); if(invMap[c]) invMap[c].monthly = Math.round((r.qty||0)/3); }
            }
          }
        }
      } catch(xe) { console.warn('vendor-portal XERP 직접 조회 실패:', xe.message); }
    }
    for (const po of rows) {
      for (const it of (po.items||[])) {
        const inv = invMap[it.product_code] || {};
        it.current_stock = inv.stock || 0;
        it.monthly_usage = inv.monthly || 0;
        it.stock_months = inv.monthly > 0 ? Math.round((inv.stock / inv.monthly) * 10) / 10 : null;
        it.is_urgent = inv.status === 'urgent' || (inv.monthly > 0 && inv.stock <= inv.monthly); // 스마트재고 긴급 또는 1개월 이하
        it.is_danger = inv.status === 'danger';
        it.remain_days = inv.remainDays;
      }
    }
  } catch(e) { console.warn('vendor-portal 재고 보강 실패:', e.message); }

  // 취소 제외 전체 표시, 처리 가능한 것 분리
  const activePOs = rows.filter(r => r.status !== '취소');
  const actionable = activePOs.filter(r => ['발송','확인'].includes(r.status));
  ctx.ok(res, { vendor, pos: actionable, allPos: activePOs });
});

// ════════════════════════════════════════════════════════════════════
//  VENDOR PORTAL — PO 상태 변경 (확인/발송)
// ════════════════════════════════════════════════════════════════════

// PATCH /api/vendor-portal/po/:id — 업체가 상태 변경
router.addPattern('PATCH', /^\/api\/vendor-portal\/po\/(\d+)$/, async (req, res, parsed, m) => {
  const poId = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  const auth = ctx.extractVendorAuth(body);
  if (!auth) { ctx.fail(res, 403, '인증 실패'); return; }
  const email = auth.email;
  // 이메일로 등록된 업체 확인 (같은 이메일로 여러 업체 가능)
  const vendorsWithEmail = await ctx.db.prepare('SELECT * FROM vendors WHERE email = ?').all(email);
  if (!vendorsWithEmail.length) { ctx.fail(res, 404, '등록된 업체가 아닙니다'); return; }

  const po = await ctx.db.prepare('SELECT * FROM po_header WHERE po_id = ?').get(poId);
  if (!po) { ctx.fail(res, 404, 'PO not found'); return; }
  // PO의 vendor_name과 매칭되는 vendor 찾기
  const vendor = vendorsWithEmail.find(v => v.name === po.vendor_name || v.name.startsWith(po.vendor_name) || po.vendor_name.startsWith(v.name.slice(0,2)));
  if (!vendor) { ctx.fail(res, 403, '본인 발주서가 아닙니다'); return; }

  const action = body.action; // 'confirm' or 'ship'
  const currentStatus = ctx.PO_STATUS_EN_TO_KO[po.status] || po.status;

  let emailResult = null;

  if (action === 'confirm' && currentStatus === '발송') {
    // 업체가 발주 확인
    const beforeConfirm = { status: po.status, mat: po.material_status, proc: po.process_status };
    await ctx.db.prepare(`UPDATE po_header SET status = 'confirmed', updated_at = datetime('now','localtime') WHERE po_id = ?`).run(poId);
    // 파이프라인 서브상태 업데이트 (vendor.type 기준)
    if (vendor.type === '후공정') {
      await ctx.db.prepare('UPDATE po_header SET process_status=? WHERE po_id=?').run('confirmed', poId);
    } else {
      // 원재료 또는 타입 미설정
      await ctx.db.prepare('UPDATE po_header SET material_status=? WHERE po_id=?').run('confirmed', poId);
    }
    ctx.logPOActivity(poId, 'vendor_confirm', {
      actor: vendor.name, actor_type: vendor.type,
      from_status: beforeConfirm.status, to_status: 'confirmed',
      from_mat: beforeConfirm.mat, to_mat: vendor.type === '후공정' ? beforeConfirm.mat : 'confirmed',
      from_proc: beforeConfirm.proc, to_proc: vendor.type === '후공정' ? 'confirmed' : beforeConfirm.proc,
      details: `${vendor.name} 발주 확인`
    });
    ctx.ok(res, { po_id: poId, status: '확인', email: emailResult });
    return;

  } else if (action === 'ship' && currentStatus === '확인') {
    // 업체가 발송 처리 (vendor.type 기준으로 원재료/후공정 분기)
    if (vendor.type === '후공정') {
      // 후공정 업체 발송 → 다음 step 체크
      const currentStep = po.process_step || 0;
      const chain = po.process_chain ? JSON.parse(po.process_chain) : [];
      const nextStepInfo = chain.find(s => s.step === currentStep + 1);

      if (nextStepInfo) {
        // 다음 공정 단계가 있음 → 다음 step PO 자동 생성+발송
        await ctx.db.prepare(`UPDATE po_header SET status = '확인', process_status='step_done', shipped_at=datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE po_id = ?`).run(poId);
        ctx.logPOActivity(poId, 'vendor_ship', {
          actor: vendor.name, actor_type: vendor.type,
          from_status: po.status, to_status: '확인',
          from_mat: po.material_status, to_mat: po.material_status,
          from_proc: po.process_status, to_proc: 'step_done',
          details: `${vendor.name} 공정 Step ${currentStep} 완료 → Step ${currentStep+1} (${nextStepInfo.process}@${nextStepInfo.vendor}) 자동 트리거`
        });

        // 다음 step PO가 이미 대기 중인지 확인
        const parentId = po.parent_po_id || poId;
        let nextPO = await ctx.db.prepare(`SELECT * FROM po_header WHERE parent_po_id = ? AND process_step = ? AND po_type = '후공정'`).get(parentId, currentStep + 1);

        // 없으면 자동 생성
        if (!nextPO) {
          const nextPoNumber = await ctx.generatePoNumber();
          // 거래처명에서 vendors 테이블 매칭 (부분 매칭)
          let nextVendorRow = await ctx.db.prepare('SELECT * FROM vendors WHERE name = ?').get(nextStepInfo.vendor);
          if (!nextVendorRow) {
            nextVendorRow = await ctx.db.prepare("SELECT * FROM vendors WHERE name LIKE ?").get(nextStepInfo.vendor.slice(0,2) + '%');
          }
          const nextVendorName = nextVendorRow ? nextVendorRow.name : nextStepInfo.vendor;
          // 현재 PO의 품목을 복사
          const currentItems = await ctx.db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(poId);
          const nextHdr = await ctx.db.prepare(`INSERT INTO po_header (po_number, po_type, vendor_name, status, due_date, total_qty, notes, process_step, parent_po_id, process_chain, origin, po_date, material_status, process_status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,date('now','localtime'),'sent','waiting')`).run(
            nextPoNumber, '후공정', nextVendorName, 'sent',
            po.due_date || '', po.total_qty || 0,
            `공정체인 자동생성: ${nextStepInfo.process}@${nextVendorName} (원PO: ${po.po_number})`,
            currentStep + 1, parentId, po.process_chain || '', po.origin || '한국'
          );
          const nextPoId = nextHdr.lastInsertRowid;
          for (const ci of currentItems) {
            await ctx.db.prepare('INSERT INTO po_items (po_id, product_code, brand, process_type, ordered_qty, spec, notes) VALUES (?,?,?,?,?,?,?)').run(
              nextPoId, ci.product_code, ci.brand || '', nextStepInfo.process, ci.ordered_qty || 0, ci.spec || '', ''
            );
          }
          nextPO = await ctx.db.prepare('SELECT * FROM po_header WHERE po_id=?').get(nextPoId);
          console.log(`[공정체인] 자동 PO 생성: ${nextPoNumber} → ${nextVendorName}(${nextStepInfo.process}), parent=${parentId}`);
          ctx.logPOActivity(nextPoId, 'auto_chain_create', {
            actor_type: 'system',
            to_status: 'sent',
            details: `공정체인 자동생성: Step ${currentStep}(${vendor.name}) → Step ${currentStep+1}(${nextVendorName}, ${nextStepInfo.process})`
          });
        }

        if (nextPO) {
          const nextVendor = await ctx.db.prepare('SELECT * FROM vendors WHERE name = ?').get(nextPO.vendor_name);
          if (nextVendor && nextVendor.email) {
            const nextItems = await ctx.db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(nextPO.po_id);
            await ctx.db.prepare(`UPDATE po_header SET status = 'sent', material_status='sent', process_status='waiting', updated_at = datetime('now','localtime') WHERE po_id = ?`).run(nextPO.po_id);
            emailResult = await ctx.sendPOEmail(nextPO, nextItems, nextVendor.email, nextVendor.name, true, nextVendor.email_cc);
            console.log(`공정체인 Step ${currentStep}→${currentStep+1}: ${nextPO.po_number} → ${nextVendor.name}`);
          }
        }
        ctx.ok(res, { po_id: poId, status: '확인', next_step: currentStep + 1, next_vendor: nextStepInfo.vendor, next_po: nextPO ? nextPO.po_number : null });
        return;
      }

      // 마지막 공정 → OS등록대기 상태로, process_status = completed
      await ctx.db.prepare(`UPDATE po_header SET status = 'os_pending', process_status='completed', shipped_at=datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE po_id = ?`).run(poId);
      ctx.logPOActivity(poId, 'vendor_ship', {
        actor: vendor.name, actor_type: vendor.type,
        from_status: po.status, to_status: 'os_pending',
        from_mat: po.material_status, to_mat: po.material_status,
        from_proc: po.process_status, to_proc: 'completed',
        details: `${vendor.name} 후공정 최종 완료 발송`
      });
      ctx.ok(res, { po_id: poId, status: 'OS등록대기' });
      return;

    } else {
      // 원재료 업체 발송 → material_status = shipped, 같은 날짜 후공정 PO 체인 트리거
      await ctx.db.prepare(`UPDATE po_header SET material_status='shipped', shipped_at=datetime('now','localtime'), updated_at = datetime('now','localtime') WHERE po_id = ?`).run(poId);
      ctx.logPOActivity(poId, 'vendor_ship', {
        actor: vendor.name, actor_type: vendor.type,
        from_status: po.status, to_status: po.status,
        from_mat: po.material_status, to_mat: 'shipped',
        from_proc: po.process_status, to_proc: po.process_status,
        details: `${vendor.name} 원재료 출고`
      });
      // 후공정 PO 찾기 (같은 날짜, 대기 상태, 후공정 타입)
      const postPOs = await ctx.db.prepare(`SELECT * FROM po_header WHERE po_date = ? AND status IN ('draft','sent') AND po_type = '후공정'`).all(po.po_date);
      const _chainOk = [];
      const _chainNoEmail = [];
      const _chainEmailFail = [];
      for (const pp of postPOs) {
        const postVendor = await ctx.db.prepare('SELECT * FROM vendors WHERE name = ?').get(pp.vendor_name);
        if (postVendor && postVendor.email) {
          const ppItems = await ctx.db.prepare('SELECT * FROM po_items WHERE po_id = ?').all(pp.po_id);
          // 후공정 PO를 발송 상태로
          await ctx.db.prepare(`UPDATE po_header SET status = 'sent', updated_at = datetime('now','localtime') WHERE po_id = ?`).run(pp.po_id);
          emailResult = await ctx.sendPOEmail(pp, ppItems, postVendor.email, postVendor.name, true, postVendor.email_cc);
          console.log(`원재료→후공정 체인: ${pp.po_number} → ${postVendor.name} (${postVendor.email})`);
          if (emailResult && emailResult.ok !== false) {
            _chainOk.push(`${pp.po_number} → ${postVendor.name}`);
          } else {
            _chainEmailFail.push(`${pp.po_number} → ${postVendor.name}`);
          }
        } else {
          _chainNoEmail.push(`${pp.po_number} → ${pp.vendor_name}`);
        }
      }
      // Slack 알림: 체인 결과
      try {
        const lines = [];
        lines.push(`🔗 *원재료 출고 → 후공정 체인*`);
        lines.push(`원재료: ${po.po_number} (${po.vendor_name})`);
        if (_chainOk.length) lines.push(`✅ 이메일 발송 (${_chainOk.length}): \n• ${_chainOk.join('\n• ')}`);
        if (_chainNoEmail.length) lines.push(`⚠️ 이메일 없음 (${_chainNoEmail.length}): \n• ${_chainNoEmail.join('\n• ')}`);
        if (_chainEmailFail.length) lines.push(`🔴 발송 실패 (${_chainEmailFail.length}): \n• ${_chainEmailFail.join('\n• ')}`);
        if (!postPOs.length) lines.push(`❌ 매칭되는 후공정 PO 없음 (po_date=${po.po_date})`);
        ctx.sendSlack(lines.join('\n')).catch(()=>{});
      } catch (_) {}
      ctx.ok(res, { po_id: poId, status: '확인', chain_triggered: postPOs.length, chain_ok: _chainOk.length, chain_no_email: _chainNoEmail.length, email: emailResult });
      return;
    }
  }

  ctx.fail(res, 400, `현재 상태(${currentStatus})에서 ${action} 처리 불가`);
});

// ════════════════════════════════════════════════════════════════════
//  VENDOR PORTAL — 발송처리 수정
// ════════════════════════════════════════════════════════════════════

// POST /api/vendor-portal/po/:id/reset-ship — 발송처리 수정 (shipped_at 초기화)
router.addPattern('POST', /^\/api\/vendor-portal\/po\/(\d+)\/reset-ship$/, async (req, res, parsed, m) => {
  const poId = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  const auth = ctx.extractVendorAuth(body);
  if (!auth) { ctx.fail(res, 403, '인증 실패'); return; }
  const po = await ctx.db.prepare('SELECT * FROM po_header WHERE po_id=?').get(poId);
  if (!po) { ctx.fail(res, 404, 'PO 없음'); return; }
  // shipped_at 초기화 (발송 처리 전 상태로)
  await ctx.db.prepare(`UPDATE po_header SET shipped_at='', updated_at=datetime('now','localtime') WHERE po_id=?`).run(poId);
  ctx.logPOActivity(poId, 'reset_ship', { actor_type: 'vendor', details: '발송처리 수정 요청' });
  ctx.ok(res, { po_id: poId });
});

// ════════════════════════════════════════════════════════════════════
//  VENDOR SHIPMENT SCHEDULE API (출하 일정)
// ════════════════════════════════════════════════════════════════════

// POST /api/vendor-portal/material-shipped — 원재료 업체 출고 완료
router.post('/api/vendor-portal/material-shipped', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { po_id } = body;
  if (!po_id) { ctx.fail(res, 400, 'po_id 필수'); return; }
  await ctx.db.prepare("UPDATE po_header SET material_status='shipped' WHERE po_id=?").run(po_id);
  // 납품 스케줄 상태도 업데이트
  await ctx.db.prepare("UPDATE vendor_shipment_schedule SET status='shipped' WHERE po_id=?").run(po_id);
  ctx.logPOActivity(po_id, 'material_shipped', { actor_type: 'material', to_mat: 'shipped', details: '원재료 출고 완료' });
  ctx.ok(res, { po_id, material_status: 'shipped' });
});

// POST /api/vendor-portal/set-shipment — 업체가 출하 일정 등록/수정
router.post('/api/vendor-portal/set-shipment', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { po_id, ship_date, ship_time, post_vendor_name } = body;
  if (!po_id || !ship_date) { ctx.fail(res, 400, '필수 항목 누락'); return; }
  const po = await ctx.db.prepare('SELECT po_number, vendor_name FROM po_header WHERE po_id=?').get(po_id);
  if (!po) { ctx.fail(res, 404, 'PO 없음'); return; }
  const postVendor = await ctx.db.prepare('SELECT email FROM vendors WHERE name=?').get(post_vendor_name || '');
  const postEmail = postVendor ? postVendor.email : '';
  const existing = await ctx.db.prepare('SELECT id FROM vendor_shipment_schedule WHERE po_id=?').get(po_id);
  if (existing) {
    await ctx.db.prepare(`UPDATE vendor_shipment_schedule SET ship_date=?, ship_time=?, post_vendor_name=?, post_vendor_email=?, updated_at=datetime('now','localtime') WHERE po_id=?`)
      .run(ship_date, ship_time || 'AM', post_vendor_name || '', postEmail, po_id);
  } else {
    await ctx.db.prepare(`INSERT INTO vendor_shipment_schedule (po_id, po_number, vendor_name, ship_date, ship_time, post_vendor_name, post_vendor_email) VALUES (?,?,?,?,?,?,?)`)
      .run(po_id, po.po_number, po.vendor_name, ship_date, ship_time || 'AM', post_vendor_name || '', postEmail);
  }
  // 출하 일정 등록 시 원재료 파이프라인 상태를 '출고예정'으로 업데이트
  await ctx.db.prepare("UPDATE po_header SET material_status='scheduled' WHERE po_id=?").run(po_id);
  ctx.logPOActivity(po_id, 'shipment_scheduled', {
    actor: po.vendor_name, actor_type: 'material',
    to_mat: 'scheduled',
    details: `출고일정: ${ship_date} ${ship_time || 'AM'} → ${post_vendor_name || ''}`
  });
  ctx.ok(res, { po_id, ship_date, ship_time: ship_time || 'AM', post_vendor_name });
});

// POST /api/vendor-portal/item-ship-date — 품목별 출고일 저장
router.post('/api/vendor-portal/item-ship-date', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { po_id, item_id, ship_date } = body;
  const authItem = ctx.extractVendorAuth(body);
  if (body.access && !authItem) { ctx.fail(res, 403, '인증 실패'); return; }
  if (!po_id || !ship_date) { ctx.fail(res, 400, '필수 항목 누락'); return; }
  if (item_id !== undefined && item_id !== null) {
    await ctx.db.prepare('UPDATE po_items SET ship_date=? WHERE po_id=? AND item_id=?').run(ship_date, po_id, item_id);
  } else {
    await ctx.db.prepare('UPDATE po_items SET ship_date=? WHERE po_id=?').run(ship_date, po_id);
  }
  ctx.ok(res, { saved: true });
});

// POST /api/vendor-portal/item-produced-qty — 품목별 생산완료수량 저장
router.post('/api/vendor-portal/item-produced-qty', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { po_id, item_id, produced_qty } = body;
  const authPQ = ctx.extractVendorAuth(body);
  if (body.access && !authPQ) { ctx.fail(res, 403, '인증 실패'); return; }
  if (!po_id || produced_qty === undefined) { ctx.fail(res, 400, '필수 항목 누락'); return; }
  const qty = parseInt(produced_qty) || 0;
  if (item_id !== undefined && item_id !== null) {
    await ctx.db.prepare('UPDATE po_items SET produced_qty=? WHERE po_id=? AND item_id=?').run(qty, po_id, item_id);
  } else {
    await ctx.db.prepare('UPDATE po_items SET produced_qty=? WHERE po_id=?').run(qty, po_id);
  }
  ctx.ok(res, { saved: true });
});

// POST /api/vendor-portal/defect-report — 불량 보고
router.post('/api/vendor-portal/defect-report', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const auth = ctx.extractVendorAuth(body);
  if (body.access && !auth) { ctx.fail(res, 403, '인증 실패'); return; }
  const { po_id, item_id, product_code, defect_type, defect_qty, description } = body;
  if (!po_id || !defect_type || !defect_qty) { ctx.fail(res, 400, '필수 항목 누락 (po_id, defect_type, defect_qty)'); return; }
  const vendorName = auth ? auth.vendorName : '';
  const qty = parseInt(defect_qty) || 0;
  await ctx.db.prepare(`INSERT INTO vendor_defect_reports (po_id, item_id, product_code, vendor_name, defect_type, defect_qty, description) VALUES (?,?,?,?,?,?,?)`).run(
    po_id, item_id || null, product_code || '', vendorName, defect_type, qty, description || ''
  );
  // po_items에 불량수량 누적
  if (item_id) {
    await ctx.db.prepare('UPDATE po_items SET defect_qty = defect_qty + ? WHERE po_id=? AND item_id=?').run(qty, po_id, item_id);
  }
  ctx.ok(res, { saved: true });
});

// GET /api/vendor-portal/defect-reports — 불량 보고 목록
router.get('/api/vendor-portal/defect-reports', async (req, res, parsed) => {
  const qs = new URL(req.url, `http://${req.headers.host}`).searchParams;
  const accessToken = qs.get('access') || '';
  const decoded = ctx.decodeVendorToken(accessToken);
  if (!decoded) { ctx.fail(res, 403, '인증 실패'); return; }
  const email = decoded.email;
  const vendor = await ctx.db.prepare('SELECT * FROM vendors WHERE email = ?').get(email);
  if (!vendor) { ctx.fail(res, 404, '업체 없음'); return; }
  const reports = await ctx.db.prepare(`SELECT r.*, h.po_number FROM vendor_defect_reports r LEFT JOIN po_header h ON h.po_id=r.po_id WHERE r.vendor_name=? ORDER BY r.reported_at DESC LIMIT 100`).all(vendor.name);
  ctx.ok(res, reports);
});

// POST /api/vendor-portal/items-ship-dates — 품목별 출고일 일괄 저장
router.post('/api/vendor-portal/items-ship-dates', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { po_id, dates } = body;
  const authDates = ctx.extractVendorAuth(body);
  if (body.access && !authDates) { ctx.fail(res, 403, '인증 실패'); return; }
  if (!po_id || !Array.isArray(dates)) { ctx.fail(res, 400, '필수 항목 누락'); return; }
  const stmt = ctx.db.prepare('UPDATE po_items SET ship_date=? WHERE po_id=? AND item_id=?');
  const tx = ctx.db.transaction(async () => { for (const d of dates) await stmt.run(d.ship_date, po_id, d.item_id); });
  await tx();
  ctx.ok(res, { saved: dates.length });
});

// GET /api/vendor-portal/shipment-schedule — 출하 일정 조회
router.get('/api/vendor-portal/shipment-schedule', async (req, res, parsed) => {
  const poId = parsed.searchParams.get('po_id');
  if (poId) {
    const schedule = await ctx.db.prepare('SELECT * FROM vendor_shipment_schedule WHERE po_id=?').get(poId);
    ctx.ok(res, schedule || null);
  } else {
    const all = await ctx.db.prepare('SELECT * FROM vendor_shipment_schedule ORDER BY ship_date').all();
    ctx.ok(res, all);
  }
});

// ════════════════════════════════════════════════════════════════════
//  VENDOR PORTAL — 공정 리드타임
// ════════════════════════════════════════════════════════════════════

const DEFAULT_LEAD_TIMES = [
  { process_type: '재단', default_days: 1 },
  { process_type: '인쇄', default_days: 3 },
  { process_type: '박/형압', default_days: 2 },
  { process_type: '톰슨', default_days: 2 },
  { process_type: '봉투가공', default_days: 3 },
  { process_type: '단면접착', default_days: 2 },
  { process_type: '우찌누끼', default_days: 2 },
  { process_type: '접지', default_days: 2 },
  { process_type: '코팅', default_days: 2 },
];

// GET /api/vendor-portal/lead-time — 벤더 포털 공정 리드타임 조회
router.get('/api/vendor-portal/lead-time', async (req, res, parsed) => {
  const qsLt = Object.fromEntries(parsed.searchParams);
  const authLt = ctx.extractVendorAuth(qsLt);
  if (!authLt) { ctx.fail(res, 403, '인증 실패'); return; }
  const vendorName = authLt.vendorName || parsed.searchParams.get('vendor_name') || '';
  if (!vendorName) { ctx.fail(res, 400, 'vendor_name 필수'); return; }

  const saved = await ctx.db.prepare('SELECT * FROM process_lead_time WHERE vendor_name=?').all(vendorName);
  const savedMap = {};
  for (const row of saved) savedMap[row.process_type] = row;

  const result = DEFAULT_LEAD_TIMES.map(d => {
    const s = savedMap[d.process_type];
    return {
      process_type: d.process_type,
      default_days: s ? (s.default_days ?? d.default_days) : d.default_days,
      adjusted_days: s ? s.adjusted_days : null,
      adjusted_reason: s ? (s.adjusted_reason || '') : '',
    };
  });
  // 수정 이력 (최근 20건)
  const history = await ctx.db.prepare('SELECT process_type, old_days, new_days, changed_at FROM lead_time_history WHERE vendor_name=? ORDER BY changed_at DESC LIMIT 20').all(vendorName);
  ctx.ok(res, { rows: result, history });
});

// POST /api/vendor-portal/lead-time — 벤더 포털 공정 리드타임 저장
router.post('/api/vendor-portal/lead-time', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const authLtPost = ctx.extractVendorAuth(body);
  if (!authLtPost) { ctx.fail(res, 403, '인증 실패'); return; }
  const vendor_name = authLtPost.vendorName || body.vendor_name || '';
  const lead_times = body.lead_times;
  if (!vendor_name) { ctx.fail(res, 400, 'vendor_name 필수'); return; }
  if (!Array.isArray(lead_times) || lead_times.length === 0) { ctx.fail(res, 400, 'lead_times 필수'); return; }

  const upsert = ctx.db.prepare(`
    INSERT INTO process_lead_time (vendor_name, process_type, default_days, adjusted_days, adjusted_reason)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(vendor_name, process_type) DO UPDATE SET
      adjusted_days=excluded.adjusted_days,
      adjusted_reason=excluded.adjusted_reason,
      updated_at=datetime('now','localtime')
  `);

  // 변경 전 값 조회 (이력 기록용)
  const prevMap = {};
  const prevRows = await ctx.db.prepare('SELECT process_type, adjusted_days, default_days FROM process_lead_time WHERE vendor_name=?').all(vendor_name);
  for (const r of prevRows) prevMap[r.process_type] = r.adjusted_days ?? r.default_days;

  const logStmt = ctx.db.prepare('INSERT INTO lead_time_history (vendor_name, process_type, old_days, new_days) VALUES (?,?,?,?)');

  const upsertAll = ctx.db.transaction(async (items) => {
    for (const lt of items) {
      const oldVal = prevMap[lt.process_type] ?? lt.default_days;
      const newVal = lt.adjusted_days ?? lt.default_days;
      if (oldVal !== newVal) {
        await logStmt.run(vendor_name, lt.process_type, oldVal, newVal);
      }
      await upsert.run(vendor_name, lt.process_type, lt.default_days ?? 1, lt.adjusted_days ?? null, lt.adjusted_reason || '');
    }
  });
  await upsertAll(lead_times);

  const email = authLtPost.email || '';
  console.log(`[vendor-portal/lead-time] ${vendor_name} (${email}) — ${lead_times.length}개 공정 리드타임 저장`);
  ctx.ok(res, { ok: true, vendor_name, saved: lead_times.length });
});

// ════════════════════════════════════════════════════════════════════
//  VENDOR PORTAL — 거래명세서
// ════════════════════════════════════════════════════════════════════

// GET /api/vendor-portal/trade-doc — 업체 포털 거래명세서 조회
router.get('/api/vendor-portal/trade-doc', async (req, res, parsed) => {
  const poId = parsed.searchParams.get('po_id');
  const qsTd = Object.fromEntries(parsed.searchParams);
  const authTd = ctx.extractVendorAuth(qsTd);
  if (!authTd) { ctx.fail(res, 403, '인증 실패'); return; }
  const doc = await ctx.db.prepare('SELECT * FROM trade_document WHERE po_id=? ORDER BY id DESC LIMIT 1').get(poId);
  if (!doc) { ctx.ok(res, null); return; }
  doc.items = JSON.parse(doc.items_json || '[]');
  doc.vendor_modified = doc.vendor_modified_json ? JSON.parse(doc.vendor_modified_json) : null;
  ctx.ok(res, doc);
});

// POST /api/vendor-portal/update-trade-doc — 업체 포털 거래명세서 단가 수정
router.post('/api/vendor-portal/update-trade-doc', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { doc_id, modified_items, memo } = body;
  const authUtd = ctx.extractVendorAuth(body);
  if (!authUtd) { ctx.fail(res, 403, '인증 실패'); return; }
  if (!doc_id) { ctx.fail(res, 400, 'doc_id 필수'); return; }
  const doc = await ctx.db.prepare('SELECT * FROM trade_document WHERE id=?').get(doc_id);
  if (!doc) { ctx.fail(res, 404, '문서 없음'); return; }

  const originalItems = JSON.parse(doc.items_json || '[]');
  const modifiedItems = modified_items || [];
  let hasDiff = false;
  for (let i = 0; i < modifiedItems.length; i++) {
    const orig = originalItems[i];
    const mod = modifiedItems[i];
    if (orig && mod && (orig.unit_price !== mod.unit_price || orig.qty !== mod.qty)) {
      hasDiff = true;
      break;
    }
  }

  await ctx.db.prepare(`UPDATE trade_document SET vendor_modified_json=?, vendor_memo=?, price_diff=?, status='vendor_confirmed', confirmed_at=datetime('now','localtime'), updated_at=datetime('now','localtime') WHERE id=?`)
    .run(JSON.stringify(modifiedItems), memo || '', hasDiff ? 1 : 0, doc_id);

  ctx.logPOActivity(doc.po_id, 'trade_doc_updated', {
    actor: doc.vendor_name, actor_type: doc.vendor_type,
    details: hasDiff ? `거래명세서 단가 수정 (사유: ${memo || '없음'})` : '거래명세서 확인 (수정 없음)'
  });

  ctx.ok(res, { doc_id, price_diff: hasDiff, status: 'vendor_confirmed' });
});

module.exports = { router };
