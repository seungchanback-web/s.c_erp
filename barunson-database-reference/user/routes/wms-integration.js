// routes/wms-integration.js — WMS 연동 모듈
// WMS Platform API 호출 + 웹훅 수신 + 서비스 토큰 발급
// donald-duck MES Adapter와 동일 패턴 (토큰 캐싱 + 자동 갱신 + 401 재시도)

const Router = require('./_router');
const ctx = require('./_ctx');
const { apiSuccess, apiError } = require('./_response');
const { loadConfig } = require('./_config');
const { keysToCamel } = require('./_utils');
const crypto = require('crypto');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  WMS API 클라이언트 (토큰 캐싱 + 자동 갱신)
// ════════════════════════════════════════════════════════════════════

let _wmsToken = null;
let _wmsTokenExp = 0;

function getWmsConfig() {
  return {
    baseUrl: loadConfig('wms.baseUrl', process.env.WMS_BASE_URL || 'http://localhost:3000'),
    secret: process.env.WMS_SERVICE_SECRET || loadConfig('wms.auth.secret', ''),
    webhookSecret: process.env.WMS_WEBHOOK_SECRET || loadConfig('wms.webhook.secret', ''),
  };
}

async function wmsAuthenticate() {
  if (_wmsToken && Date.now() < _wmsTokenExp - 60_000) return _wmsToken;

  const { baseUrl, secret } = getWmsConfig();
  if (!secret) throw new Error('WMS_SERVICE_SECRET 미설정');

  const res = await fetch(`${baseUrl}/api/platform/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceSecret: secret }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WMS 인증 실패 (${res.status}): ${text}`);
  }

  const data = await res.json();
  _wmsToken = data.token;
  _wmsTokenExp = Date.now() + (data.expiresIn || 900) * 1000;
  return _wmsToken;
}

/**
 * WMS API 호출 (인증 + 자동 재시도)
 * WMS 표준 응답 { success, data } 에서 data를 추출하여 반환
 */
async function wmsRequest(method, path, options = {}) {
  const { baseUrl } = getWmsConfig();
  let token = await wmsAuthenticate();

  const buildOpts = (t) => {
    const opts = {
      method,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    };
    if (options.body) opts.body = JSON.stringify(options.body);
    return opts;
  };

  let url = `${baseUrl}${path}`;
  if (options.params) {
    const qs = new URLSearchParams(options.params).toString();
    url += `?${qs}`;
  }

  let res = await fetch(url, buildOpts(token));

  // 401 → 토큰 재발급 후 1회 재시도
  if (res.status === 401) {
    _wmsToken = null;
    token = await wmsAuthenticate();
    res = await fetch(url, buildOpts(token));
  }

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`WMS API ${method} ${path} 실패 (${res.status}): ${text}`);
  }

  const json = await res.json();
  // WMS 표준 응답에서 data 추출
  if (json.success && 'data' in json) return json.data;
  return json;
}

// ════════════════════════════════════════════════════════════════════
//  ERP → WMS: 품목 동기화
// ════════════════════════════════════════════════════════════════════

// POST /api/wms/product-sync — 전체 품목을 WMS에 push
router.post('/api/wms/product-sync', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { apiError(res, 'AUTH_FAILED', '인증이 필요합니다', 401); return; }

  try {
    const products = await ctx.db.prepare(
      "SELECT product_code, product_name, brand, unit, origin FROM products WHERE status != 'inactive' ORDER BY product_code"
    ).all();

    const results = [];
    // 50건씩 배치
    for (let i = 0; i < products.length; i += 50) {
      const batch = products.slice(i, i + 50);
      for (const p of batch) {
        try {
          const data = await wmsRequest('POST', '/api/platform/products', {
            body: {
              sku: p.product_code,
              name: p.product_name,
              category: p.brand || '기타',
              unit: p.unit || 'EA',
            },
          });
          results.push({ sku: p.product_code, action: data.action, ok: true });
        } catch (e) {
          results.push({ sku: p.product_code, ok: false, error: e.message });
        }
      }
    }

    const created = results.filter(r => r.ok && r.action === 'created').length;
    const updated = results.filter(r => r.ok && r.action === 'updated').length;
    const failed = results.filter(r => !r.ok).length;

    ctx.auditLog(decoded.userId, decoded.username, 'wms_product_sync', 'wms', '', `동기화 완료: 생성=${created}, 업데이트=${updated}, 실패=${failed}`);
    apiSuccess(res, { total: products.length, created, updated, failed, results });
  } catch (e) {
    apiError(res, 'SYSTEM_ERROR', `WMS 품목 동기화 실패: ${e.message}`, 500);
  }
});

// ════════════════════════════════════════════════════════════════════
//  ERP → WMS: 재고 조회
// ════════════════════════════════════════════════════════════════════

// GET /api/wms/inventory — WMS 실물 재고 조회 (단건)
router.get('/api/wms/inventory', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { apiError(res, 'AUTH_FAILED', '인증이 필요합니다', 401); return; }

  const sku = parsed.searchParams.get('sku');
  if (!sku) { apiError(res, 'VALIDATION_ERROR', 'sku 파라미터 필수', 400); return; }

  try {
    const data = await wmsRequest('GET', `/api/platform/inventory/${encodeURIComponent(sku)}`);
    apiSuccess(res, data);
  } catch (e) {
    apiError(res, 'SYSTEM_ERROR', `WMS 재고 조회 실패: ${e.message}`, 500);
  }
});

// GET /api/wms/inventory/bulk — WMS 실물 재고 대량 조회
router.get('/api/wms/inventory/bulk', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { apiError(res, 'AUTH_FAILED', '인증이 필요합니다', 401); return; }

  const skus = parsed.searchParams.get('skus');
  if (!skus) { apiError(res, 'VALIDATION_ERROR', 'skus 파라미터 필수 (쉼표 구분)', 400); return; }

  try {
    const data = await wmsRequest('GET', '/api/platform/inventory/bulk', {
      params: { skus },
    });
    apiSuccess(res, data);
  } catch (e) {
    // WMS 장애 시 XERP fallback
    const fallbackEnabled = loadConfig('wms.fallbackToXerp', true);
    if (fallbackEnabled) {
      try {
        const pool = await ctx.ensureXerpPool();
        if (pool) {
          const skuList = skus.split(',').map(s => s.trim()).filter(Boolean);
          const result = await pool.request().query(`
            SELECT RTRIM(ItemCode) AS sku, SUM(OhQty) AS total
            FROM mmInventory WITH (NOLOCK)
            WHERE SiteCode = 'BK10' AND RTRIM(ItemCode) IN (${skuList.map(s => `'${s}'`).join(',')})
            GROUP BY RTRIM(ItemCode)
          `);
          const items = skuList.map(sku => {
            const row = result.recordset.find(r => r.sku === sku);
            return { sku, available: row?.total || 0, reserved: 0, total: row?.total || 0 };
          });
          apiSuccess(res, { items, queriedAt: new Date().toISOString(), source: 'xerp_fallback' });
          return;
        }
      } catch (_) {}
    }
    apiError(res, 'SYSTEM_ERROR', `WMS 재고 조회 실패 (fallback도 실패): ${e.message}`, 500);
  }
});

// ════════════════════════════════════════════════════════════════════
//  ERP → WMS: 출고 생성/조회
// ════════════════════════════════════════════════════════════════════

// POST /api/wms/outbound — WMS 출고 요청 생성
router.post('/api/wms/outbound', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { apiError(res, 'AUTH_FAILED', '인증이 필요합니다', 401); return; }

  const body = await ctx.readJSON(req);
  if (!body.externalOrderNo || !body.items?.length) {
    apiError(res, 'VALIDATION_ERROR', 'externalOrderNo와 items 필수', 400);
    return;
  }

  try {
    const data = await wmsRequest('POST', '/api/platform/outbound', { body });
    ctx.auditLog(decoded.userId, decoded.username, 'wms_outbound_create', 'wms', data.outboundId, `WMS 출고 생성: ${body.externalOrderNo}`);
    apiSuccess(res, data, 201);
  } catch (e) {
    apiError(res, 'SYSTEM_ERROR', `WMS 출고 생성 실패: ${e.message}`, 500);
  }
});

// GET /api/wms/outbound/status — 외부 주문번호로 출고 상태 조회
router.get('/api/wms/outbound/status', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { apiError(res, 'AUTH_FAILED', '인증이 필요합니다', 401); return; }

  const orderNo = parsed.searchParams.get('orderNo');
  if (!orderNo) { apiError(res, 'VALIDATION_ERROR', 'orderNo 파라미터 필수', 400); return; }

  try {
    const data = await wmsRequest('GET', `/api/platform/outbound/by-order/${encodeURIComponent(orderNo)}`);
    apiSuccess(res, data);
  } catch (e) {
    apiError(res, 'SYSTEM_ERROR', `WMS 출고 상태 조회 실패: ${e.message}`, 500);
  }
});

// ════════════════════════════════════════════════════════════════════
//  WMS → ERP: 웹훅 수신 (서비스 토큰 발급 + 서명 검증)
// ════════════════════════════════════════════════════════════════════

// POST /api/auth/service-token — WMS용 서비스 토큰 발급
router.post('/api/auth/service-token', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { serviceSecret } = body;

  const expected = process.env.ERP_SERVICE_SECRET;
  if (!expected) { apiError(res, 'NOT_CONFIGURED', 'ERP_SERVICE_SECRET 미설정', 503); return; }
  if (!serviceSecret || serviceSecret !== expected) {
    apiError(res, 'AUTH_FAILED', '유효하지 않은 서비스 시크릿', 401);
    return;
  }

  // JWT 토큰 발급 (1시간)
  const tokenPayload = { service: 'wms', role: 'service', iat: Math.floor(Date.now() / 1000) };
  const token = ctx.jwt.sign(tokenPayload, ctx._jwtSecret, { expiresIn: '1h' });

  // 래핑 없이 직접 반환 (MES Adapter 호환)
  ctx.jsonRes(res, 200, { token, expiresIn: 3600 });
});

// 웹훅 서명 검증 헬퍼
function verifyWmsWebhook(req, rawBody) {
  const { webhookSecret } = getWmsConfig();
  if (!webhookSecret) throw new Error('WMS_WEBHOOK_SECRET 미설정');

  const signature = req.headers['x-webhook-signature'];
  const timestamp = req.headers['x-webhook-timestamp'];
  if (!signature) throw new Error('X-Webhook-Signature 헤더 없음');

  // 타임스탬프 윈도우 (5분)
  if (timestamp) {
    const ts = parseInt(timestamp, 10);
    const now = Math.floor(Date.now() / 1000);
    if (isNaN(ts) || Math.abs(now - ts) > 300) throw new Error('웹훅 타임스탬프 만료');
  }

  // sha256= 접두사 제거
  const rawSig = signature.startsWith('sha256=') ? signature.slice(7) : signature;

  // WMS 서명: ${timestamp}.${body}
  const message = timestamp ? `${timestamp}.${rawBody}` : rawBody;
  const expected = crypto.createHmac('sha256', webhookSecret).update(message).digest('hex');

  const sigBuf = Buffer.from(rawSig, 'utf-8');
  const expBuf = Buffer.from(expected, 'utf-8');
  if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
    throw new Error('웹훅 서명 검증 실패');
  }
}

// POST /api/wms/receive-confirm — WMS 입고확정 웹훅
router.post('/api/wms/receive-confirm', async (req, res, parsed) => {
  const rawBody = await ctx.readBody(req);
  try {
    verifyWmsWebhook(req, rawBody);
  } catch (e) {
    apiError(res, 'AUTH_FAILED', e.message, 401);
    return;
  }

  try {
    const payload = JSON.parse(rawBody);
    const { externalPoNo, inboundNo, status, items } = payload;

    if (!externalPoNo) { apiError(res, 'VALIDATION_ERROR', 'externalPoNo 필수', 400); return; }

    // PO 조회
    const po = await ctx.db.prepare('SELECT po_id, status FROM po_header WHERE po_number = ?').get(externalPoNo);
    if (!po) { apiError(res, 'NOT_FOUND', `PO를 찾을 수 없습니다: ${externalPoNo}`, 404); return; }

    // 입고 수량 업데이트
    if (items && items.length > 0) {
      for (const item of items) {
        await ctx.db.prepare(
          'UPDATE po_items SET received_qty = COALESCE(received_qty, 0) + ? WHERE po_id = ? AND product_code = ?'
        ).run(item.receivedQty || 0, po.po_id, item.sku);
      }
    }

    // PO 상태 업데이트
    const statusMap = { CONFIRMED: 'received', QC_FAILED: 'received' };
    const newPoStatus = statusMap[status] || 'partial';
    await ctx.db.prepare("UPDATE po_header SET status = ?, updated_at = datetime('now','localtime') WHERE po_id = ?")
      .run(newPoStatus, po.po_id);

    // 수신 로그 기록
    await ctx.db.prepare(
      "INSERT INTO wms_receive_log (po_number, inbound_no, status, received_date, raw_payload) VALUES (?,?,?,datetime('now','localtime'),?)"
    ).run(externalPoNo, inboundNo || '', status || 'CONFIRMED', rawBody);

    ctx.auditLog(null, 'wms-webhook', 'receive_confirm', 'po', po.po_id, `WMS 입고확정: ${inboundNo} → PO ${externalPoNo}`);
    apiSuccess(res, { received: true });
  } catch (e) {
    apiError(res, 'SYSTEM_ERROR', `입고확정 처리 실패: ${e.message}`, 500);
  }
});

// POST /api/wms/shipment-confirm — WMS 출고확정 웹훅
router.post('/api/wms/shipment-confirm', async (req, res, parsed) => {
  const rawBody = await ctx.readBody(req);
  try {
    verifyWmsWebhook(req, rawBody);
  } catch (e) {
    apiError(res, 'AUTH_FAILED', e.message, 401);
    return;
  }

  try {
    const payload = JSON.parse(rawBody);
    const { outboundNo, externalOrderNo, status, shippedDate, trackingNo, carrierCode, items } = payload;

    // 출고 로그 기록
    await ctx.db.prepare(
      "INSERT INTO wms_shipment_log (outbound_no, external_order_no, status, shipped_date, tracking_no, carrier_code, raw_payload) VALUES (?,?,?,?,?,?,?)"
    ).run(outboundNo || '', externalOrderNo || '', status || 'SHIPPED', shippedDate || null, trackingNo || null, carrierCode || null, rawBody);

    ctx.auditLog(null, 'wms-webhook', 'shipment_confirm', 'outbound', '', `WMS 출고확정: ${outboundNo} (${trackingNo || 'N/A'})`);
    apiSuccess(res, { received: true });
  } catch (e) {
    apiError(res, 'SYSTEM_ERROR', `출고확정 처리 실패: ${e.message}`, 500);
  }
});

// ════════════════════════════════════════════════════════════════════
//  설정 관리 API (system_configs 조회/수정)
// ════════════════════════════════════════════════════════════════════

const { listConfigs, getConfigHistory, setConfig, invalidateCache } = require('./_config');

// GET /api/system-configs — 전체 설정 목록
router.get('/api/system-configs', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { apiError(res, 'FORBIDDEN', '관리자 권한 필요', 403); return; }

  const configs = listConfigs();
  apiSuccess(res, keysToCamel(configs));
});

// PUT /api/system-configs/:key — 설정 변경
router.putP(/^\/api\/system-configs\/(.+)$/, async (req, res, parsed, match) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { apiError(res, 'FORBIDDEN', '관리자 권한 필요', 403); return; }

  const key = decodeURIComponent(match[1]);
  const body = await ctx.readJSON(req);

  if (body.value === undefined) { apiError(res, 'VALIDATION_ERROR', 'value 필드 필수', 400); return; }

  setConfig(key, body.value, decoded.username);
  ctx.auditLog(decoded.userId, decoded.username, 'config_update', 'system_configs', key, `설정 변경: ${key}`);
  apiSuccess(res, { key, updated: true });
});

// GET /api/system-configs/:key/history — 설정 변경 이력
router.getP(/^\/api\/system-configs\/(.+)\/history$/, async (req, res, parsed, match) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { apiError(res, 'FORBIDDEN', '관리자 권한 필요', 403); return; }

  const key = decodeURIComponent(match[1]);
  const history = getConfigHistory(key);
  apiSuccess(res, keysToCamel(history));
});

// POST /api/system-configs/invalidate — 캐시 무효화
router.post('/api/system-configs/invalidate', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { apiError(res, 'FORBIDDEN', '관리자 권한 필요', 403); return; }

  const body = await ctx.readJSON(req);
  invalidateCache(body.key || null);
  apiSuccess(res, { invalidated: body.key || 'all' });
});

// ════════════════════════════════════════════════════════════════════
//  테이블 초기화
// ════════════════════════════════════════════════════════════════════

function initTables() {
  const { db } = ctx;
  if (!db) return;

  // WMS 수신 로그 테이블
  db.exec(`CREATE TABLE IF NOT EXISTS wms_receive_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number TEXT NOT NULL,
    inbound_no TEXT NOT NULL,
    status TEXT DEFAULT 'received',
    received_date TEXT,
    raw_payload TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS wms_shipment_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    outbound_no TEXT NOT NULL,
    external_order_no TEXT,
    status TEXT DEFAULT 'shipped',
    shipped_date TEXT,
    tracking_no TEXT,
    carrier_code TEXT,
    raw_payload TEXT,
    created_at TEXT DEFAULT (datetime('now','localtime'))
  )`);

  // system_configs 초기화
  const { initConfigTables, seedDefaults } = require('./_config');
  initConfigTables();
  seedDefaults();
}

module.exports = { router, initTables, wmsRequest, wmsAuthenticate };
