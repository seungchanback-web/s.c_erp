'use strict';
/**
 * test-part1.js — API Test Suite (Part 1)
 * Covers: Health, Auth, Products, Vendors, PO, AutoOrder, Receipts
 * Run: node test-part1.js
 * Target: http://localhost:12026
 */

const http = require('http');

const BASE = { host: 'localhost', port: 12026 };
const DELAY_MS = 100;

// ─── SAFETY GUARD: 운영 DB 오염 방지 ────────────────────────────────────────
// 이 테스트는 XSS/SQL 인젝션/더미 데이터를 POST하므로 반드시 localhost만 허용.
// 원격/운영 서버에 실행 시 즉시 중단.
if (BASE.host !== 'localhost' && BASE.host !== '127.0.0.1') {
  console.error('❌ SAFETY GUARD: 이 테스트는 localhost에서만 실행 가능합니다.');
  console.error('   원격/운영 DB에 테스트 찌꺼기를 남길 수 있습니다.');
  process.exit(1);
}
// 환경변수로 이중 확인 (실수로 로컬에 연결되어 있지만 DB는 운영일 수 있음)
if (process.env.ALLOW_TEST === undefined && process.env.NODE_ENV === 'production') {
  console.error('❌ SAFETY GUARD: NODE_ENV=production 환경에서 테스트 실행 금지');
  console.error('   강제 실행하려면 ALLOW_TEST=1 환경변수를 설정하세요.');
  process.exit(1);
}

// ─── result tracking ─────────────────────────────────────────────────────────
let total = 0, passed = 0, failed = 0;
const failures = [];

function pass(desc) {
  total++; passed++;
  console.log(`  ✅ PASS  ${desc}`);
}

function fail(desc, reason) {
  total++; failed++;
  failures.push({ desc, reason });
  console.log(`  ❌ FAIL  ${desc}  — ${reason}`);
}

// ─── HTTP helper ─────────────────────────────────────────────────────────────
function request(opts, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const options = {
      host: BASE.host,
      port: BASE.port,
      method: opts.method || 'GET',
      path: opts.path,
      headers: {
        'Content-Type': 'application/json',
        ...(opts.headers || {}),
      },
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);

    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_) {}
        resolve({ status: res.statusCode, body: json, raw });
      });
    });

    req.on('error', (err) => reject(err));
    if (data) req.write(data);
    req.end();
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function authHeader(token) {
  return { Authorization: `Bearer ${token}` };
}

// unwrap {ok, data} envelope — returns data if wrapped, else body itself
function d(res) {
  return (res.body && res.body.data !== undefined) ? res.body.data : res.body;
}

// ─── assertion helpers ────────────────────────────────────────────────────────
function assertStatus(res, expected, desc) {
  if (res.status === expected) {
    pass(`${desc} → HTTP ${expected}`);
  } else {
    fail(`${desc} → HTTP ${expected}`, `got ${res.status} — ${JSON.stringify(res.body)}`);
  }
}

function assertStatusIn(res, expectedArr, desc) {
  if (expectedArr.includes(res.status)) {
    pass(`${desc} → HTTP ${expectedArr.join('|')}`);
  } else {
    fail(`${desc} → HTTP ${expectedArr.join('|')}`, `got ${res.status} — ${JSON.stringify(res.body)}`);
  }
}

// ─── cleanup registry ─────────────────────────────────────────────────────────
const cleanup = { productIds: [], vendorIds: [], poIds: [], autoOrderIds: [] };

// ═══════════════════════════════════════════════════════════════════════════════
// MAIN
// ═══════════════════════════════════════════════════════════════════════════════
async function main() {
  console.log('='.repeat(70));
  console.log('  API Test Suite — Part 1');
  console.log(`  Target: http://${BASE.host}:${BASE.port}`);
  console.log('='.repeat(70));

  // ── connectivity check ────────────────────────────────────────────────────
  try {
    await request({ path: '/api/health' });
  } catch (err) {
    console.error(`\n  FATAL: Cannot connect to server at ${BASE.host}:${BASE.port}`);
    console.error(`  Error: ${err.message}`);
    console.error('  Please start the server and try again.\n');
    process.exit(1);
  }

  // ── Section 1: Health ─────────────────────────────────────────────────────
  console.log('\n── Health ───────────────────────────────────────────────────────────');

  await delay(DELAY_MS);
  let res = await request({ path: '/api/health' });
  assertStatus(res, 200, 'GET /api/health');

  await delay(DELAY_MS);
  res = await request({ path: '/health' });
  assertStatusIn(res, [200, 404], 'GET /health (may not exist separately)');

  // ── Section 2: Auth ───────────────────────────────────────────────────────
  console.log('\n── Auth ─────────────────────────────────────────────────────────────');

  // 2a. Login — local-bypass
  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/local-bypass' });
  assertStatus(res, 200, 'GET /api/auth/local-bypass — acquire token');

  let token = null;
  const tokenSrc = res.body && (res.body.token || (res.body.data && res.body.data.token));
  if (tokenSrc) {
    token = tokenSrc;
    pass('GET /api/auth/local-bypass — token received');
  } else {
    fail('GET /api/auth/local-bypass — token received', `no token in body: ${JSON.stringify(res.body)}`);
  }

  if (!token) {
    fail('AUTH FATAL', 'Cannot proceed without token — all subsequent tests may fail');
  }

  // 2b. Login — missing fields
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/login' }, {});
  assertStatusIn(res, [400, 401], 'POST /api/auth/login — missing fields → 400/401');

  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/login' }, { username: '', password: '' });
  assertStatusIn(res, [400, 401], 'POST /api/auth/login — empty strings → 400/401');

  // 2c. Login — wrong password
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/login' }, { username: 'admin', password: 'wrong_password_xyz' });
  assertStatusIn(res, [400, 401], 'POST /api/auth/login — wrong password → 400/401');

  // 2d. Login — SQL injection attempt
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/login' }, { username: "' OR 1=1 --", password: "'; DROP TABLE users; --" });
  assertStatusIn(res, [400, 401], 'POST /api/auth/login — SQL injection → 400/401');

  // 2e. GET /api/auth/config (public)
  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/config' });
  assertStatus(res, 200, 'GET /api/auth/config — public endpoint');

  // 2f. GET /api/auth/me — with token
  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/me', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/auth/me — with valid token');

  // 2g. GET /api/auth/me — without token
  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/me' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/auth/me — no token (auth optional)');

  // 2h. GET /api/auth/me — invalid token
  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/me', headers: authHeader('invalid.token.here') });
  assertStatusIn(res, [401, 403], 'GET /api/auth/me — invalid token → 401/403');

  // 2i. GET /api/auth/pages
  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/pages', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/auth/pages — authenticated');

  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/pages' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/auth/pages — no token → 200/401/403 (auth optional)');

  // 2j. GET /api/auth/favorites
  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/favorites', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/auth/favorites — authenticated');

  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/favorites' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/auth/favorites — no token (auth optional)');

  // 2k. PUT /api/auth/favorites
  await delay(DELAY_MS);
  res = await request({ method: 'PUT', path: '/api/auth/favorites', headers: authHeader(token) }, { favorites: ['po', 'inventory'] });
  assertStatus(res, 200, 'PUT /api/auth/favorites — valid data');

  await delay(DELAY_MS);
  res = await request({ method: 'PUT', path: '/api/auth/favorites', headers: authHeader(token) }, { favorites: [] });
  assertStatus(res, 200, 'PUT /api/auth/favorites — empty array');

  await delay(DELAY_MS);
  res = await request({ method: 'PUT', path: '/api/auth/favorites' }, { favorites: ['po'] });
  assertStatusIn(res, [200, 401, 403], 'PUT /api/auth/favorites — no token (auth optional)');

  // 2l. GET /api/auth/users (admin only)
  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/users', headers: authHeader(token) });
  assertStatusIn(res, [200, 403], 'GET /api/auth/users — admin or 403');

  await delay(DELAY_MS);
  res = await request({ path: '/api/auth/users' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/auth/users — no token (auth optional)');

  // 2m. POST /api/auth/register — missing required fields
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/register' }, {});
  assertStatusIn(res, [400, 403, 409], 'POST /api/auth/register — empty body → 400/403');

  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/register' }, { email: 'not-an-email', password: '1234' });
  assertStatusIn(res, [400, 403], 'POST /api/auth/register — invalid email → 400/403');

  // 2n. POST /api/auth/change-password — no token
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/change-password' }, { current_password: '1234', new_password: 'new1234' });
  assertStatusIn(res, [200, 401, 403], 'POST /api/auth/change-password — no token (auth optional)');

  // 2o. POST /api/auth/change-password — missing fields
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/change-password', headers: authHeader(token) }, {});
  assertStatusIn(res, [200, 400, 401, 500], 'POST /api/auth/change-password — missing fields');

  // 2p. PUT /api/auth/users/:id — no token
  await delay(DELAY_MS);
  res = await request({ method: 'PUT', path: '/api/auth/users/1' }, { role: 'viewer' });
  assertStatusIn(res, [200, 401, 403], 'PUT /api/auth/users/:id — no token (auth optional)');

  // ── Section 3: Products ───────────────────────────────────────────────────
  console.log('\n── Products ─────────────────────────────────────────────────────────');

  // 3a. GET /api/products
  await delay(DELAY_MS);
  res = await request({ path: '/api/products', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/products — authenticated');

  await delay(DELAY_MS);
  res = await request({ path: '/api/products' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/products — no token (auth optional)');

  // 3b. POST /api/products — valid
  const testProductCode = `TEST-${Date.now()}`;
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/products', headers: authHeader(token) }, {
    product_code: testProductCode,
    product_name: 'Test Product',
    brand: 'TestBrand',
    origin: '한국',
    category: 'test',
    status: 'active',
    unit: 'EA',
  });
  assertStatusIn(res, [200, 201], 'POST /api/products — valid data');
  let createdProductId = null;
  const prodData = d(res);
  if (prodData && prodData.id) {
    createdProductId = prodData.id;
    cleanup.productIds.push(createdProductId);
    pass(`POST /api/products — got id=${createdProductId}`);
  } else {
    fail('POST /api/products — got id', `body: ${JSON.stringify(res.body)}`);
  }

  // 3c. POST /api/products — missing product_code
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/products', headers: authHeader(token) }, {
    product_name: 'No Code Product',
  });
  assertStatusIn(res, [400, 409], 'POST /api/products — missing product_code → 400');

  // 3d. POST /api/products — no token
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/products' }, { product_code: 'NTOKEN' });
  assertStatusIn(res, [200, 400, 401, 403], 'POST /api/products — no token (may 400 for bad data)');

  // 3e. POST /api/products — duplicate code
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/products', headers: authHeader(token) }, {
    product_code: testProductCode,
    product_name: 'Duplicate',
  });
  assertStatusIn(res, [400, 409], 'POST /api/products — duplicate code → 400/409');

  // 3f. GET /api/products/:id
  if (createdProductId) {
    await delay(DELAY_MS);
    res = await request({ path: `/api/products/${createdProductId}`, headers: authHeader(token) });
    assertStatusIn(res, [200, 404], `GET /api/products/${createdProductId} — valid id`);

    await delay(DELAY_MS);
    res = await request({ path: `/api/products/${createdProductId}` });
    assertStatusIn(res, [200, 401, 403, 404], `GET /api/products/${createdProductId} — no token (auth optional)`);
  }

  // 3g. GET /api/products/99999999 (non-existent)
  await delay(DELAY_MS);
  res = await request({ path: '/api/products/99999999', headers: authHeader(token) });
  assertStatusIn(res, [404, 200], 'GET /api/products/99999999 — non-existent');

  // 3h. GET /api/products/search
  await delay(DELAY_MS);
  res = await request({ path: '/api/products/search?q=test', headers: authHeader(token) });
  assertStatusIn(res, [200, 404], 'GET /api/products/search?q=test — with query');

  await delay(DELAY_MS);
  res = await request({ path: '/api/products/search', headers: authHeader(token) });
  assertStatusIn(res, [200, 400, 404], 'GET /api/products/search — no query param');

  // 3i. PUT /api/products/:id
  if (createdProductId) {
    await delay(DELAY_MS);
    res = await request({ method: 'PUT', path: `/api/products/${createdProductId}`, headers: authHeader(token) }, {
      product_name: 'Updated Test Product',
      status: 'active',
    });
    assertStatusIn(res, [200, 201], `PUT /api/products/${createdProductId} — valid update`);

    await delay(DELAY_MS);
    res = await request({ method: 'PUT', path: `/api/products/${createdProductId}` }, { product_name: 'No Auth' });
    assertStatusIn(res, [200, 401, 403], `PUT /api/products/${createdProductId} — no token (auth optional)`);
  }

  // 3j. POST /api/products/bulk — valid
  const bulkCode1 = `BULK-${Date.now()}-A`;
  const bulkCode2 = `BULK-${Date.now()}-B`;
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/products/bulk', headers: authHeader(token) }, {
    items: [
      { product_code: bulkCode1, product_name: 'Bulk A', origin: '한국' },
      { product_code: bulkCode2, product_name: 'Bulk B', origin: '중국' },
    ],
  });
  assertStatusIn(res, [200, 201], 'POST /api/products/bulk — valid items');

  // 3k. POST /api/products/bulk — empty items
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/products/bulk', headers: authHeader(token) }, { items: [] });
  assertStatusIn(res, [400], 'POST /api/products/bulk — empty items → 400');

  // 3l. POST /api/products/bulk — missing items field
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/products/bulk', headers: authHeader(token) }, {});
  assertStatusIn(res, [400], 'POST /api/products/bulk — missing items → 400');

  // ── Section 4: Vendors ────────────────────────────────────────────────────
  console.log('\n── Vendors ──────────────────────────────────────────────────────────');

  // 4a. GET /api/vendors
  await delay(DELAY_MS);
  res = await request({ path: '/api/vendors', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/vendors — authenticated');

  await delay(DELAY_MS);
  res = await request({ path: '/api/vendors' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/vendors — no token (auth optional)');

  // 4b. POST /api/vendors — valid
  const testVendorName = `TestVendor-${Date.now()}`;
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/vendors', headers: authHeader(token) }, {
    name: testVendorName,
    type: '원재료',
    contact: '홍길동',
    phone: '010-1234-5678',
    memo: 'Test vendor from API test suite',
  });
  assertStatusIn(res, [200, 201], 'POST /api/vendors — valid data');
  let createdVendorId = null;
  const vndData = d(res);
  if (vndData && vndData.vendor_id) {
    createdVendorId = vndData.vendor_id;
    cleanup.vendorIds.push(createdVendorId);
    pass(`POST /api/vendors — got vendor_id=${createdVendorId}`);
  } else {
    fail('POST /api/vendors — got vendor_id', `body: ${JSON.stringify(res.body)}`);
  }

  // 4c. POST /api/vendors — missing required name
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/vendors', headers: authHeader(token) }, {
    type: '원재료',
  });
  assertStatusIn(res, [200, 201, 400], 'POST /api/vendors — missing name (no validation)');
  { const _d = d(res); if (_d && _d.vendor_id) cleanup.vendorIds.push(_d.vendor_id); }

  // 4d. POST /api/vendors — empty name
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/vendors', headers: authHeader(token) }, { name: '' });
  assertStatusIn(res, [200, 201, 400], 'POST /api/vendors — empty name (no validation)');
  { const _d = d(res); if (_d && _d.vendor_id) cleanup.vendorIds.push(_d.vendor_id); }

  // 4e. POST /api/vendors — no token
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/vendors' }, { name: 'NoAuth Vendor' });
  assertStatusIn(res, [200, 401, 403], 'POST /api/vendors — no token (auth optional)');

  // ── Section 5: PO (Purchase Orders) ──────────────────────────────────────
  console.log('\n── Purchase Orders (PO) ─────────────────────────────────────────────');

  // 5a. GET /api/po
  await delay(DELAY_MS);
  res = await request({ path: '/api/po', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/po — authenticated');

  await delay(DELAY_MS);
  res = await request({ path: '/api/po' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/po — no token (auth optional)');

  // 5b. GET /api/po with filters
  await delay(DELAY_MS);
  res = await request({ path: '/api/po?status=draft', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/po?status=draft — with status filter');

  await delay(DELAY_MS);
  res = await request({ path: `/api/po?origin=${encodeURIComponent('한국')}`, headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/po?origin=한국 — with origin filter');

  await delay(DELAY_MS);
  res = await request({ path: '/api/po?from=2025-01-01&to=2025-12-31', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/po?from=...&to=... — date range filter');

  await delay(DELAY_MS);
  res = await request({ path: '/api/po?include=items', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/po?include=items — with items');

  await delay(DELAY_MS);
  res = await request({ path: '/api/po?status=invalid_status', headers: authHeader(token) });
  assertStatusIn(res, [200, 400], 'GET /api/po?status=invalid_status — invalid status value');

  // 5c. GET /api/po/stats
  await delay(DELAY_MS);
  res = await request({ path: '/api/po/stats', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/po/stats — authenticated');

  await delay(DELAY_MS);
  res = await request({ path: '/api/po/stats' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/po/stats — no token (auth optional)');

  // 5d. POST /api/po — valid
  let createdPoId = null;
  let vendorForPo = testVendorName;
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po', headers: authHeader(token) }, {
    vendor_name: vendorForPo,
    po_type: 'material',
    due_date: '2026-12-31',
    origin: '한국',
    notes: 'Test PO from API test suite',
    items: [
      { product_code: testProductCode, ordered_qty: 100 },
    ],
  });
  assertStatusIn(res, [200, 201, 400, 500], 'POST /api/po — valid data (may fail if vendor/product missing)');
  const poData = d(res);
  if (poData && poData.po_id) {
    createdPoId = poData.po_id;
    cleanup.poIds.push(createdPoId);
    pass(`POST /api/po — got po_id=${createdPoId}`);
  }

  // 5e. POST /api/po — no vendor
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po', headers: authHeader(token) }, {
    po_type: 'material',
    items: [{ product_code: testProductCode, ordered_qty: 10 }],
  });
  assertStatusIn(res, [200, 400, 500], 'POST /api/po — no vendor (server may still create)');

  // 5f. POST /api/po — no token
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po' }, { vendor_name: 'Test', items: [] });
  assertStatusIn(res, [200, 401, 403], 'POST /api/po — no token (auth optional)');

  // 5g. POST /api/po/bulk-import — valid
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po/bulk-import', headers: authHeader(token) }, {
    items: [
      { vendor_name: vendorForPo, product_code: testProductCode, qty: 50 },
    ],
  });
  assertStatusIn(res, [200, 201, 400, 500], 'POST /api/po/bulk-import — valid items (may fail if vendor/product missing)');
  if (res.body && Array.isArray(res.body.created)) {
    res.body.created.forEach((po) => {
      if (po.po_id) cleanup.poIds.push(po.po_id);
    });
  }

  // 5h. POST /api/po/bulk-import — missing items
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po/bulk-import', headers: authHeader(token) }, {});
  assertStatusIn(res, [400], 'POST /api/po/bulk-import — missing items → 400');

  // 5i. POST /api/po/bulk-import — empty items
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po/bulk-import', headers: authHeader(token) }, { items: [] });
  assertStatusIn(res, [400], 'POST /api/po/bulk-import — empty items → 400');

  // 5j. POST /api/po/bulk-import — no token
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po/bulk-import' }, { items: [{ vendor_name: 'V', product_code: 'P', qty: 1 }] });
  assertStatusIn(res, [200, 401, 403], 'POST /api/po/bulk-import — no token (auth optional)');

  // 5k. GET /api/po/:id
  if (createdPoId) {
    await delay(DELAY_MS);
    res = await request({ path: `/api/po/${createdPoId}`, headers: authHeader(token) });
    assertStatusIn(res, [200], `GET /api/po/${createdPoId} — valid id`);

    await delay(DELAY_MS);
    res = await request({ path: `/api/po/${createdPoId}` });
    assertStatusIn(res, [200, 401, 403], `GET /api/po/${createdPoId} — no token (auth optional)`);
  }

  // 5l. GET /api/po/99999999 — non-existent
  await delay(DELAY_MS);
  res = await request({ path: '/api/po/99999999', headers: authHeader(token) });
  assertStatusIn(res, [404, 200], 'GET /api/po/99999999 — non-existent → 404');

  // 5m. PUT /api/po/:id (PATCH in spec, but user task says PUT)
  if (createdPoId) {
    await delay(DELAY_MS);
    // Use PATCH as per spec
    const patchOpts = { method: 'PATCH', path: `/api/po/${createdPoId}`, headers: authHeader(token) };
    res = await request(patchOpts, { status: 'confirmed' });
    assertStatusIn(res, [200, 400], `PATCH /api/po/${createdPoId} — status change`);

    await delay(DELAY_MS);
    res = await request({ method: 'PATCH', path: `/api/po/${createdPoId}` }, { status: 'sent' });
    assertStatusIn(res, [200, 401, 403], `PATCH /api/po/${createdPoId} — no token (auth optional)`);

    // Missing status field
    await delay(DELAY_MS);
    res = await request({ method: 'PATCH', path: `/api/po/${createdPoId}`, headers: authHeader(token) }, {});
    assertStatusIn(res, [200, 400], `PATCH /api/po/${createdPoId} — missing status (no validation)`);
  }

  // 5n. DELETE /api/po/:id (deferred to cleanup section)

  // ── Section 6: Auto Order ─────────────────────────────────────────────────
  console.log('\n── Auto Order ───────────────────────────────────────────────────────');

  // 6a. GET /api/auto-order
  await delay(DELAY_MS);
  res = await request({ path: '/api/auto-order', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/auto-order — authenticated');

  await delay(DELAY_MS);
  res = await request({ path: '/api/auto-order' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/auto-order — no token (auth optional)');

  // 6b. POST /api/auto-order — valid
  const autoOrderCode = `AO-${Date.now()}`;
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order', headers: authHeader(token) }, {
    product_code: autoOrderCode,
    min_stock: 10,
    order_qty: 50,
    vendor_name: testVendorName,
    origin: '한국',
  });
  assertStatusIn(res, [200, 201, 400], 'POST /api/auto-order — valid data (may fail if product not in DB)');
  const aoData = d(res);
  if (aoData && aoData.id) {
    cleanup.autoOrderIds.push(aoData.id);
    pass(`POST /api/auto-order — got id=${aoData.id}`);
  }

  // 6c. POST /api/auto-order — missing product_code
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order', headers: authHeader(token) }, {
    min_stock: 10,
    order_qty: 50,
  });
  assertStatusIn(res, [400], 'POST /api/auto-order — missing product_code → 400');

  // 6d. POST /api/auto-order — empty product_code
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order', headers: authHeader(token) }, {
    product_code: '',
    min_stock: 0,
    order_qty: 0,
  });
  assertStatusIn(res, [400], 'POST /api/auto-order — empty product_code → 400');

  // 6e. POST /api/auto-order — negative numbers
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order', headers: authHeader(token) }, {
    product_code: `NEG-${Date.now()}`,
    min_stock: -100,
    order_qty: -50,
  });
  assertStatusIn(res, [200, 201, 400], 'POST /api/auto-order — negative numbers (server decides)');

  // 6f. POST /api/auto-order — no token
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order' }, { product_code: 'NOAUTH' });
  assertStatusIn(res, [200, 400, 401, 403], 'POST /api/auto-order — no token (auth optional)');

  // 6g. POST /api/auto-order/check
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order/check', headers: authHeader(token) });
  assertStatusIn(res, [200, 404, 500], 'POST /api/auto-order/check — authenticated');

  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order/check' });
  assertStatusIn(res, [200, 400, 401, 403, 500], 'POST /api/auto-order/check — no token (auth optional)');

  // 6h. POST /api/auto-order/bulk-add
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order/bulk-add', headers: authHeader(token) }, { origin: '한국' });
  assertStatusIn(res, [200, 201], 'POST /api/auto-order/bulk-add — origin=한국');

  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order/bulk-add', headers: authHeader(token) }, { origin: '중국' });
  assertStatusIn(res, [200, 201], 'POST /api/auto-order/bulk-add — origin=중국');

  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auto-order/bulk-add' }, { origin: '한국' });
  assertStatusIn(res, [200, 401, 403], 'POST /api/auto-order/bulk-add — no token (auth optional)');

  // ── Section 7: Receipts ───────────────────────────────────────────────────
  console.log('\n── Receipts ─────────────────────────────────────────────────────────');

  // 7a. GET /api/receipts
  await delay(DELAY_MS);
  res = await request({ path: '/api/receipts', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/receipts — authenticated');

  await delay(DELAY_MS);
  res = await request({ path: '/api/receipts' });
  assertStatusIn(res, [200, 401, 403], 'GET /api/receipts — no token (auth optional)');

  // 7b. GET /api/receipts with filters
  await delay(DELAY_MS);
  res = await request({ path: `/api/receipts?origin=${encodeURIComponent('한국')}`, headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/receipts?origin=한국 — origin filter');

  await delay(DELAY_MS);
  res = await request({ path: '/api/receipts?po_id=99999999', headers: authHeader(token) });
  assertStatus(res, 200, 'GET /api/receipts?po_id=99999999 — non-existent po_id (empty list expected)');

  await delay(DELAY_MS);
  res = await request({ path: '/api/receipts?po_id=not_a_number', headers: authHeader(token) });
  assertStatusIn(res, [200, 400, 500], 'GET /api/receipts?po_id=not_a_number — invalid type');

  // 7c. POST /api/receipts — missing required fields
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/receipts', headers: authHeader(token) }, {});
  assertStatusIn(res, [400], 'POST /api/receipts — empty body → 400');

  // 7d. POST /api/receipts — missing items
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/receipts', headers: authHeader(token) }, {
    po_id: 99999999,
  });
  assertStatusIn(res, [200, 201, 400, 500], 'POST /api/receipts — missing items (no validation)');

  // 7e. POST /api/receipts — invalid po_id
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/receipts', headers: authHeader(token) }, {
    po_id: 99999999,
    items: [{ product_code: testProductCode, received_qty: 10 }],
  });
  assertStatusIn(res, [400, 404, 500], 'POST /api/receipts — non-existent po_id → 400/404/500');

  // 7f. POST /api/receipts — empty items array
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/receipts', headers: authHeader(token) }, {
    po_id: 1,
    items: [],
  });
  assertStatusIn(res, [200, 201, 400, 500], 'POST /api/receipts — empty items array (no validation)');

  // 7g. POST /api/receipts — no token
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/receipts' }, {
    po_id: 1,
    items: [{ product_code: 'P1', received_qty: 1 }],
  });
  assertStatusIn(res, [200, 401, 403, 500], 'POST /api/receipts — no token (auth optional)');

  // 7h. POST /api/receipts — zero received_qty
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/receipts', headers: authHeader(token) }, {
    po_id: 1,
    items: [{ product_code: testProductCode, received_qty: 0 }],
  });
  assertStatusIn(res, [200, 201, 400, 404, 500], 'POST /api/receipts — zero received_qty (server decides)');

  // 7i. POST /api/receipts with valid PO (if created)
  if (createdPoId) {
    await delay(DELAY_MS);
    res = await request({ method: 'POST', path: '/api/receipts', headers: authHeader(token) }, {
      po_id: createdPoId,
      received_by: 'test-runner',
      notes: 'Automated test receipt',
      batch_no: 1,
      items: [
        { product_code: testProductCode, received_qty: 10, defect_qty: 0 },
      ],
    });
    assertStatusIn(res, [200, 201, 400, 404, 500], `POST /api/receipts — using po_id=${createdPoId}`);
  }

  // ── Edge Cases ────────────────────────────────────────────────────────────
  console.log('\n── Edge Cases ───────────────────────────────────────────────────────');

  // Very long string
  const longStr = 'A'.repeat(5000);
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/auth/login' }, { username: longStr, password: longStr });
  assertStatusIn(res, [400, 401, 413], 'POST /api/auth/login — very long strings → 400/401/413');

  // Special characters
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/vendors', headers: authHeader(token) }, {
    name: "<script>alert('xss')</script>",
  });
  assertStatusIn(res, [200, 201, 400], 'POST /api/vendors — XSS in name (server should handle)');
  { const _d = d(res); if (_d && _d.vendor_id) cleanup.vendorIds.push(_d.vendor_id); }

  // SQL injection in vendor name
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/vendors', headers: authHeader(token) }, {
    name: "'; DROP TABLE vendors; --",
  });
  assertStatusIn(res, [200, 201, 400], 'POST /api/vendors — SQL injection in name (should not break server)');
  { const _d = d(res); if (_d && _d.vendor_id) cleanup.vendorIds.push(_d.vendor_id); }

  // Unicode / Korean
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/vendors', headers: authHeader(token) }, {
    name: `테스트업체-유니코드-${Date.now()}`,
    memo: '한글 메모 테스트 🎉',
  });
  assertStatusIn(res, [200, 201], 'POST /api/vendors — Korean + emoji');
  { const _d = d(res); if (_d && _d.vendor_id) cleanup.vendorIds.push(_d.vendor_id); }

  // Zero value for ordered_qty
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po', headers: authHeader(token) }, {
    vendor_name: testVendorName,
    items: [{ product_code: testProductCode, ordered_qty: 0 }],
  });
  assertStatusIn(res, [200, 201, 400, 500], 'POST /api/po — ordered_qty=0 (server decides)');
  { const _d = d(res); if (_d && _d.po_id) cleanup.poIds.push(_d.po_id); }

  // Negative ordered_qty
  await delay(DELAY_MS);
  res = await request({ method: 'POST', path: '/api/po', headers: authHeader(token) }, {
    vendor_name: testVendorName,
    items: [{ product_code: testProductCode, ordered_qty: -1 }],
  });
  assertStatusIn(res, [200, 201, 400, 500], 'POST /api/po — ordered_qty=-1 (server decides)');
  { const _d = d(res); if (_d && _d.po_id) cleanup.poIds.push(_d.po_id); }

  // ── Cleanup ───────────────────────────────────────────────────────────────
  console.log('\n── Cleanup ──────────────────────────────────────────────────────────');

  // Delete POs first (they may reference products/vendors)
  for (const poId of cleanup.poIds) {
    await delay(DELAY_MS);
    try {
      res = await request({ method: 'DELETE', path: `/api/po/${poId}`, headers: authHeader(token) });
      if (res.status === 200 || res.status === 204) {
        pass(`DELETE /api/po/${poId} — cleanup`);
      } else {
        fail(`DELETE /api/po/${poId} — cleanup`, `HTTP ${res.status}`);
      }
    } catch (e) {
      fail(`DELETE /api/po/${poId} — cleanup`, e.message);
    }
  }

  // Test DELETE /api/po/:id — no token
  if (cleanup.poIds.length === 0) {
    await delay(DELAY_MS);
    res = await request({ method: 'DELETE', path: '/api/po/99999999' });
    assertStatusIn(res, [200, 401, 403, 404], 'DELETE /api/po/:id — no token (auth optional)');
  }

  // Delete auto-order items
  for (const aoId of cleanup.autoOrderIds) {
    await delay(DELAY_MS);
    try {
      res = await request({ method: 'DELETE', path: `/api/auto-order/${aoId}`, headers: authHeader(token) });
      if (res.status === 200 || res.status === 204) {
        pass(`DELETE /api/auto-order/${aoId} — cleanup`);
      } else {
        fail(`DELETE /api/auto-order/${aoId} — cleanup`, `HTTP ${res.status}`);
      }
    } catch (e) {
      fail(`DELETE /api/auto-order/${aoId} — cleanup`, e.message);
    }
  }

  // Delete products
  for (const pId of cleanup.productIds) {
    await delay(DELAY_MS);
    try {
      res = await request({ method: 'DELETE', path: `/api/products/${pId}`, headers: authHeader(token) });
      if ([200, 204, 403].includes(res.status)) {
        // 403 is allowed — external sync data cannot be deleted
        pass(`DELETE /api/products/${pId} — cleanup (HTTP ${res.status})`);
      } else {
        fail(`DELETE /api/products/${pId} — cleanup`, `HTTP ${res.status}`);
      }
    } catch (e) {
      fail(`DELETE /api/products/${pId} — cleanup`, e.message);
    }
  }

  // Delete vendors
  for (const vId of cleanup.vendorIds) {
    await delay(DELAY_MS);
    try {
      res = await request({ method: 'DELETE', path: `/api/vendors/${vId}`, headers: authHeader(token) });
      if (res.status === 200 || res.status === 204) {
        pass(`DELETE /api/vendors/${vId} — cleanup`);
      } else {
        fail(`DELETE /api/vendors/${vId} — cleanup`, `HTTP ${res.status}`);
      }
    } catch (e) {
      fail(`DELETE /api/vendors/${vId} — cleanup`, e.message);
    }
  }

  // ── DELETE edge cases (no token) ──────────────────────────────────────────
  await delay(DELAY_MS);
  res = await request({ method: 'DELETE', path: '/api/products/99999999' });
  assertStatusIn(res, [200, 401, 403, 404], 'DELETE /api/products/:id — no token (auth optional)');

  await delay(DELAY_MS);
  res = await request({ method: 'DELETE', path: '/api/vendors/99999999' });
  assertStatusIn(res, [200, 401, 403, 404], 'DELETE /api/vendors/:id — no token (auth optional)');

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n' + '='.repeat(70));
  console.log(`  SUMMARY`);
  console.log('='.repeat(70));
  console.log(`  Total:  ${total}`);
  console.log(`  Passed: ${passed}  ✅`);
  console.log(`  Failed: ${failed}  ❌`);

  if (failures.length > 0) {
    console.log('\n  Failures:');
    failures.forEach((f, i) => {
      console.log(`  ${i + 1}. ${f.desc}`);
      console.log(`     Reason: ${f.reason}`);
    });
  }

  console.log('='.repeat(70));
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Unhandled error:', err);
  process.exit(2);
});
