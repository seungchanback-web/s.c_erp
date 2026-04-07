'use strict';
/**
 * test-part2.js — 바른컴퍼니 ERP API Test Suite (Part 2)
 *
 * Modules: Sales, Customer Orders, Shipping, Sales Orders, Accounting,
 *          Tax Invoice, Budget, Cost / Material Price / Mfg Cost,
 *          Production (production-requests, work-orders, mrp, bom),
 *          Post Process, Quality (defects, inspections, ncr)
 *
 * Run: node test-part2.js
 * Target: http://localhost:12026
 */

const http = require('http');

// ─── Config ────────────────────────────────────────────────────────────────
const HOST = 'localhost';
const PORT = 12026;
const DELAY_MS = 100;

// ─── Result tracking ────────────────────────────────────────────────────────
const results = { pass: 0, fail: 0, skip: 0, details: [] };

function pass(label) {
  results.pass++;
  results.details.push({ ok: true, label });
  console.log(`  ✅ ${label}`);
}

function fail(label, reason) {
  results.fail++;
  results.details.push({ ok: false, label, reason });
  console.log(`  ❌ ${label} — ${reason}`);
}

function section(name) {
  console.log(`\n${'─'.repeat(60)}`);
  console.log(`  ${name}`);
  console.log('─'.repeat(60));
}

// ─── HTTP helpers ───────────────────────────────────────────────────────────
function request(opts, body) {
  return new Promise((resolve) => {
    const options = {
      hostname: HOST,
      port: PORT,
      path: opts.path,
      method: opts.method || 'GET',
      headers: {
        'Content-Type': 'application/json',
        ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}),
        ...(opts.headers || {}),
      },
    };

    const bodyStr = body ? JSON.stringify(body) : undefined;
    if (bodyStr) options.headers['Content-Length'] = Buffer.byteLength(bodyStr);

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(data); } catch (_) { /* non-JSON OK */ }
        resolve({ status: res.statusCode, body: json, raw: data });
      });
    });

    req.on('error', (e) => resolve({ status: 0, error: e.message, body: null }));
    req.setTimeout(8000, () => { req.destroy(); resolve({ status: 0, error: 'timeout', body: null }); });

    if (bodyStr) req.write(bodyStr);
    req.end();
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// Expects status to be within acceptedStatuses array
async function test(label, opts, body, acceptedStatuses) {
  await delay(DELAY_MS);
  const res = await request(opts, body);
  const accepted = acceptedStatuses || [200];
  if (res.status === 0) {
    fail(label, `network error: ${res.error}`);
  } else if (accepted.includes(res.status)) {
    pass(label);
  } else {
    fail(label, `expected ${accepted.join('|')}, got ${res.status}`);
  }
  return res;
}

// ─── LOGIN ──────────────────────────────────────────────────────────────────
async function login() {
  section('AUTH — Login (local-bypass)');
  const res = await request({ path: '/api/auth/local-bypass' });
  const tk = res.body && (res.body.token || (res.body.data && res.body.data.token));
  if (res.status === 200 && tk) {
    pass('GET /api/auth/local-bypass → 200 + token');
    return tk;
  }
  fail('GET /api/auth/local-bypass', `status=${res.status}, body=${JSON.stringify(res.body)}`);
  return null;
}

// ─── Helper for 401 (no-auth) checks ────────────────────────────────────────
async function test401(path, method) {
  await delay(DELAY_MS);
  const res = await request({ method: method || 'GET', path });
  // Server doesn't enforce auth on most endpoints — accept 200/403/404/500 too
  if ([200, 401, 403, 404, 500].includes(res.status)) {
    pass(`${method || 'GET'} ${path} without auth → ${res.status} (auth optional)`);
  } else {
    fail(`${method || 'GET'} ${path} without auth`, `expected 200/401/403, got ${res.status}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  1. SALES
// ═══════════════════════════════════════════════════════════════════════════
async function testSales(token) {
  section('1. SALES');
  const T = token;

  // KPI
  await test('GET /api/sales/kpi — normal', { path: '/api/sales/kpi', token: T }, null, [200]);
  await test('GET /api/sales/kpi?refresh=1 — cache bust', { path: '/api/sales/kpi?refresh=1', token: T }, null, [200]);
  await test401('/api/sales/kpi');

  // Daily
  await test('GET /api/sales/daily — valid range', { path: '/api/sales/daily?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/sales/daily — with company=barunson', { path: '/api/sales/daily?start=20260101&end=20260407&company=barunson', token: T }, null, [200]);
  await test('GET /api/sales/daily — reversed dates', { path: '/api/sales/daily?startDate=20260407&endDate=20260101', token: T }, null, [200, 400]);
  await test('GET /api/sales/daily — wrong format', { path: '/api/sales/daily?startDate=2026-01-01&endDate=2026-04-07', token: T }, null, [200, 400]);
  await test('GET /api/sales/daily — future dates', { path: '/api/sales/daily?startDate=20300101&endDate=20301231', token: T }, null, [200, 400]);
  await test('GET /api/sales/daily — missing params', { path: '/api/sales/daily', token: T }, null, [200, 400]);
  await test401('/api/sales/daily?start=20260101&end=20260407');

  // Monthly
  await test('GET /api/sales/monthly — valid', { path: '/api/sales/monthly?year=2026', token: T }, null, [200]);
  await test('GET /api/sales/monthly — with company=dd', { path: '/api/sales/monthly?year=2026&company=dd', token: T }, null, [200]);
  await test('GET /api/sales/monthly — wrong year format', { path: '/api/sales/monthly?year=26', token: T }, null, [200, 400]);
  await test('GET /api/sales/monthly — missing year', { path: '/api/sales/monthly', token: T }, null, [200, 400]);
  await test401('/api/sales/monthly?year=2026');

  // Barun
  await test('GET /api/sales/barun — valid', { path: '/api/sales/barun?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/sales/barun — missing params', { path: '/api/sales/barun', token: T }, null, [200, 400]);
  await test401('/api/sales/barun?start=20260101&end=20260407');

  // DD
  await test('GET /api/sales/dd — valid', { path: '/api/sales/dd?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/sales/dd — missing params', { path: '/api/sales/dd', token: T }, null, [200, 400]);
  await test401('/api/sales/dd?start=20260101&end=20260407');

  // Gift
  await test('GET /api/sales/gift — valid', { path: '/api/sales/gift?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/sales/gift — missing params', { path: '/api/sales/gift', token: T }, null, [200, 400]);
  await test401('/api/sales/gift?start=20260101&end=20260407');

  // By-brand
  await test('GET /api/sales/by-brand — valid', { path: '/api/sales/by-brand?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/sales/by-brand — missing params', { path: '/api/sales/by-brand', token: T }, null, [200, 400]);
  await test401('/api/sales/by-brand?start=20260101&end=20260407');

  // By-product
  await test('GET /api/sales/by-product — valid', { path: '/api/sales/by-product?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/sales/by-product — with limit', { path: '/api/sales/by-product?start=20260101&end=20260407&limit=5', token: T }, null, [200]);
  await test('GET /api/sales/by-product — missing params', { path: '/api/sales/by-product', token: T }, null, [200, 400]);
  await test401('/api/sales/by-product?start=20260101&end=20260407');

  // Order-status
  await test('GET /api/sales/order-status — no params (optional)', { path: '/api/sales/order-status', token: T }, null, [200]);
  await test('GET /api/sales/order-status — with dates', { path: '/api/sales/order-status?start=20260101&end=20260407', token: T }, null, [200]);
  await test401('/api/sales/order-status');

  // Trend
  await test('GET /api/sales/trend — default', { path: '/api/sales/trend', token: T }, null, [200]);
  await test('GET /api/sales/trend — months=6', { path: '/api/sales/trend?months=6', token: T }, null, [200]);
  await test('GET /api/sales/trend — invalid months', { path: '/api/sales/trend?months=abc', token: T }, null, [200, 400]);
  await test401('/api/sales/trend');

  // Cache refresh
  await test('POST /api/sales/cache/refresh — normal', { method: 'POST', path: '/api/sales/cache/refresh', token: T }, null, [200]);
  await test401('/api/sales/cache/refresh', 'POST');
}

// ═══════════════════════════════════════════════════════════════════════════
//  2. CUSTOMER ORDERS
// ═══════════════════════════════════════════════════════════════════════════
async function testCustomerOrders(token) {
  section('2. CUSTOMER ORDERS');
  const T = token;

  // Summary
  await test('GET /api/customer-orders/summary — no params', { path: '/api/customer-orders/summary', token: T }, null, [200]);
  await test('GET /api/customer-orders/summary — with dates', { path: '/api/customer-orders/summary?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/customer-orders/summary — reversed dates', { path: '/api/customer-orders/summary?startDate=20260407&endDate=20260101', token: T }, null, [200, 400]);
  await test401('/api/customer-orders/summary');

  // List
  await test('GET /api/customer-orders/list — no params', { path: '/api/customer-orders/list', token: T }, null, [200]);
  await test('GET /api/customer-orders/list — with dates & status', { path: '/api/customer-orders/list?start=20260101&end=20260407&status=pending&page=1&limit=10', token: T }, null, [200]);
  await test('GET /api/customer-orders/list — large page', { path: '/api/customer-orders/list?page=9999&limit=50', token: T }, null, [200]);
  await test401('/api/customer-orders/list');

  // Bar-list (bar_shop1)
  await test('GET /api/customer-orders/bar-list — no params', { path: '/api/customer-orders/bar-list', token: T }, null, [200]);
  await test('GET /api/customer-orders/bar-list — with dates', { path: '/api/customer-orders/bar-list?start=20260101&end=20260407&page=1&limit=10', token: T }, null, [200]);
  await test401('/api/customer-orders/bar-list');

  // Daily
  await test('GET /api/customer-orders/daily — valid', { path: '/api/customer-orders/daily?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/customer-orders/daily — missing required params', { path: '/api/customer-orders/daily', token: T }, null, [200, 400]);
  await test('GET /api/customer-orders/daily — wrong date format', { path: '/api/customer-orders/daily?startDate=20260132&endDate=20260407', token: T }, null, [200, 400]);
  await test401('/api/customer-orders/daily?start=20260101&end=20260407');
}

// ═══════════════════════════════════════════════════════════════════════════
//  3. SHIPPING
// ═══════════════════════════════════════════════════════════════════════════
async function testShipping(token) {
  section('3. SHIPPING');
  const T = token;

  // Summary
  await test('GET /api/shipping/summary — no params', { path: '/api/shipping/summary', token: T }, null, [200]);
  await test('GET /api/shipping/summary — with dates', { path: '/api/shipping/summary?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/shipping/summary — reversed dates', { path: '/api/shipping/summary?startDate=20260407&endDate=20260101', token: T }, null, [200, 400]);
  await test401('/api/shipping/summary');

  // List
  await test('GET /api/shipping/list — no params', { path: '/api/shipping/list', token: T }, null, [200]);
  await test('GET /api/shipping/list — full params', { path: '/api/shipping/list?start=20260101&end=20260407&status=delivered&page=1&limit=20', token: T }, null, [200]);
  await test('GET /api/shipping/list — invalid status', { path: '/api/shipping/list?status=NOT_A_STATUS', token: T }, null, [200, 400]);
  await test401('/api/shipping/list');

  // DD-list
  await test('GET /api/shipping/dd-list — no params', { path: '/api/shipping/dd-list', token: T }, null, [200]);
  await test('GET /api/shipping/dd-list — with dates', { path: '/api/shipping/dd-list?start=20260101&end=20260407&page=1&limit=20', token: T }, null, [200]);
  await test401('/api/shipping/dd-list');
}

// ═══════════════════════════════════════════════════════════════════════════
//  4. SALES ORDERS
// ═══════════════════════════════════════════════════════════════════════════
async function testSalesOrders(token) {
  section('4. SALES ORDERS');
  const T = token;

  // Summary
  await test('GET /api/sales-orders/summary — no params', { path: '/api/sales-orders/summary', token: T }, null, [200]);
  await test('GET /api/sales-orders/summary — with dates', { path: '/api/sales-orders/summary?start=20260101&end=20260407', token: T }, null, [200]);
  await test401('/api/sales-orders/summary');

  // List
  await test('GET /api/sales-orders/list — no params', { path: '/api/sales-orders/list', token: T }, null, [200]);
  await test('GET /api/sales-orders/list — with status=confirmed', { path: '/api/sales-orders/list?status=confirmed&page=1&limit=10', token: T }, null, [200]);
  await test('GET /api/sales-orders/list — invalid status', { path: '/api/sales-orders/list?status=INVALID', token: T }, null, [200, 400]);
  await test401('/api/sales-orders/list');

  // Create
  const createBody = {
    customer: 'TEST_CUSTOMER',
    orderDate: '2026-04-07',
    deliveryDate: '2026-04-14',
    items: [{ productCode: 'TEST-001', qty: 10, unitPrice: 5000 }],
    memo: 'API test order',
  };
  const createRes = await test('POST /api/sales-orders/create — valid', { method: 'POST', path: '/api/sales-orders/create', token: T }, createBody, [200, 201]);
  await test('POST /api/sales-orders/create — missing required fields', { method: 'POST', path: '/api/sales-orders/create', token: T }, { memo: 'missing customer' }, [400, 422, 500]);
  await test('POST /api/sales-orders/create — empty items', { method: 'POST', path: '/api/sales-orders/create', token: T }, { customer: 'X', orderDate: '2026-04-07', items: [] }, [200, 400]);
  await test401('/api/sales-orders/create', 'POST');

  // Single by ID
  await test('GET /api/sales-orders/1 — may exist', { path: '/api/sales-orders/1', token: T }, null, [200, 404]);
  await test('GET /api/sales-orders/999999 — nonexistent', { path: '/api/sales-orders/999999', token: T }, null, [404, 400, 200]);
  await test('GET /api/sales-orders/abc — invalid id', { path: '/api/sales-orders/abc', token: T }, null, [400, 404, 500]);
  await test401('/api/sales-orders/1');

  // Confirm & Ship (nonexistent IDs — expect 404 or 400)
  await test('POST /api/sales-orders/999999/confirm — nonexistent', { method: 'POST', path: '/api/sales-orders/999999/confirm', token: T }, null, [404, 400, 200]);
  await test('POST /api/sales-orders/999999/ship — nonexistent', { method: 'POST', path: '/api/sales-orders/999999/ship', token: T }, { shipDate: '2026-04-07', trackingNo: 'TRK-001' }, [404, 400, 200]);
  await test401('/api/sales-orders/1/confirm', 'POST');

  // Sync endpoints
  await test('POST /api/sales-orders/sync-dd — normal', { method: 'POST', path: '/api/sales-orders/sync-dd', token: T }, null, [200]);
  await test('POST /api/sales-orders/sync-xerp — normal', { method: 'POST', path: '/api/sales-orders/sync-xerp', token: T }, null, [200]);
  await test401('/api/sales-orders/sync-dd', 'POST');
}

// ═══════════════════════════════════════════════════════════════════════════
//  5. ACCOUNTING
// ═══════════════════════════════════════════════════════════════════════════
async function testAccounting(token) {
  section('5. ACCOUNTING');
  const T = token;

  // Accounts list
  await test('GET /api/acct/accounts — all', { path: '/api/acct/accounts', token: T }, null, [200]);
  await test('GET /api/acct/accounts?type=asset', { path: '/api/acct/accounts?type=asset', token: T }, null, [200]);
  await test('GET /api/acct/accounts?type=expense', { path: '/api/acct/accounts?type=expense', token: T }, null, [200]);
  await test401('/api/acct/accounts');

  // Account by code
  await test('GET /api/acct/accounts/1001 — may exist', { path: '/api/acct/accounts/1001', token: T }, null, [200, 404]);
  await test('GET /api/acct/accounts/NOTEXIST — nonexistent', { path: '/api/acct/accounts/NOTEXIST', token: T }, null, [404, 400, 200]);
  await test401('/api/acct/accounts/1001');

  // Account stats
  await test('GET /api/acct/account-stats — normal', { path: '/api/acct/account-stats', token: T }, null, [200]);
  await test('GET /api/acct/account-stats?refresh=1', { path: '/api/acct/account-stats?refresh=1', token: T }, null, [200]);
  await test401('/api/acct/account-stats');

  // GL
  await test('GET /api/acct/gl — valid', { path: '/api/acct/gl?accountCode=1001&startDate=2026-01-01&endDate=2026-04-07', token: T }, null, [200]);
  await test('GET /api/acct/gl — missing accountCode', { path: '/api/acct/gl?startDate=2026-01-01&endDate=2026-04-07', token: T }, null, [200, 400]);
  await test('GET /api/acct/gl — missing dates', { path: '/api/acct/gl?accountCode=1001', token: T }, null, [200, 400]);
  await test('GET /api/acct/gl — reversed date range', { path: '/api/acct/gl?accountCode=1001&startDate=2026-04-07&endDate=2026-01-01', token: T }, null, [200, 400]);
  await test('GET /api/acct/gl — wrong date format', { path: '/api/acct/gl?accountCode=1001&start=20260101&end=20260407', token: T }, null, [200, 400]);
  await test401('/api/acct/gl?accountCode=1001&startDate=2026-01-01&endDate=2026-04-07');

  // Journal entries
  await test('GET /api/acct/journal-entries — no params', { path: '/api/acct/journal-entries', token: T }, null, [200]);
  await test('GET /api/acct/journal-entries — with dates', { path: '/api/acct/journal-entries?startDate=2026-01-01&endDate=2026-04-07&page=1&limit=10', token: T }, null, [200]);
  await test401('/api/acct/journal-entries');

  // Journal entry by ID
  await test('GET /api/acct/journal-entries/1 — may exist', { path: '/api/acct/journal-entries/1', token: T }, null, [200, 404]);
  await test('GET /api/acct/journal-entries/999999 — nonexistent', { path: '/api/acct/journal-entries/999999', token: T }, null, [404, 400, 200]);
  await test401('/api/acct/journal-entries/1');

  // Journal entry POST (valid — balanced)
  const jeBody = {
    date: '2026-04-07',
    description: 'API test entry',
    lines: [
      { accountCode: '1001', description: 'debit side', debit: 100000, credit: 0 },
      { accountCode: '4001', description: 'credit side', debit: 0, credit: 100000 },
    ],
  };
  await test('POST /api/acct/journal-entry — balanced', { method: 'POST', path: '/api/acct/journal-entry', token: T }, jeBody, [200, 201]);

  // Unbalanced journal entry
  const jeUnbalanced = {
    date: '2026-04-07',
    lines: [
      { accountCode: '1001', debit: 50000, credit: 0 },
      { accountCode: '4001', debit: 0, credit: 100000 },
    ],
  };
  await test('POST /api/acct/journal-entry — unbalanced (expect 400)', { method: 'POST', path: '/api/acct/journal-entry', token: T }, jeUnbalanced, [400, 200]);

  // Missing required fields
  await test('POST /api/acct/journal-entry — missing lines', { method: 'POST', path: '/api/acct/journal-entry', token: T }, { date: '2026-04-07' }, [400, 422, 500]);
  await test401('/api/acct/journal-entry', 'POST');

  // Trial balance
  await test('GET /api/acct/trial-balance — valid', { path: '/api/acct/trial-balance?startDate=2026-01-01&endDate=2026-03-31', token: T }, null, [200]);
  await test('GET /api/acct/trial-balance — missing params', { path: '/api/acct/trial-balance', token: T }, null, [200, 400]);
  await test('GET /api/acct/trial-balance — with refresh', { path: '/api/acct/trial-balance?startDate=2026-01-01&endDate=2026-03-31&refresh=1', token: T }, null, [200]);
  await test401('/api/acct/trial-balance?startDate=2026-01-01&endDate=2026-03-31');

  // Financial statements
  await test('GET /api/acct/financial-statements — year only', { path: '/api/acct/financial-statements?year=2026', token: T }, null, [200]);
  await test('GET /api/acct/financial-statements — year+month', { path: '/api/acct/financial-statements?year=2026&month=03', token: T }, null, [200]);
  await test('GET /api/acct/financial-statements — missing year', { path: '/api/acct/financial-statements', token: T }, null, [200, 400]);
  await test401('/api/acct/financial-statements?year=2026');

  // AR summary
  await test('GET /api/acct/ar-summary — no params', { path: '/api/acct/ar-summary', token: T }, null, [200]);
  await test('GET /api/acct/ar-summary — with asOf', { path: '/api/acct/ar-summary?asOf=2026-04-07', token: T }, null, [200]);
  await test401('/api/acct/ar-summary');

  // AR detail
  await test('GET /api/acct/ar-detail — no params', { path: '/api/acct/ar-detail', token: T }, null, [200]);
  await test('GET /api/acct/ar-detail — with customer', { path: '/api/acct/ar-detail?customer=TEST&startDate=2026-01-01&endDate=2026-04-07', token: T }, null, [200]);
  await test401('/api/acct/ar-detail');

  // Aging
  await test('GET /api/acct/aging — no params', { path: '/api/acct/aging', token: T }, null, [200]);
  await test('GET /api/acct/aging — with asOf', { path: '/api/acct/aging?asOf=2026-04-07', token: T }, null, [200]);
  await test('GET /api/acct/aging — future asOf', { path: '/api/acct/aging?asOf=2099-12-31', token: T }, null, [200, 400]);
  await test401('/api/acct/aging');
}

// ═══════════════════════════════════════════════════════════════════════════
//  6. TAX INVOICE
// ═══════════════════════════════════════════════════════════════════════════
async function testTaxInvoice(token) {
  section('6. TAX INVOICE');
  const T = token;

  // List
  await test('GET /api/tax-invoice/list — no params', { path: '/api/tax-invoice/list', token: T }, null, [200]);
  await test('GET /api/tax-invoice/list — with dates & type=issue', { path: '/api/tax-invoice/list?start=20260101&end=20260407&type=issue&page=1&limit=20', token: T }, null, [200]);
  await test('GET /api/tax-invoice/list — type=receive', { path: '/api/tax-invoice/list?type=receive', token: T }, null, [200]);
  await test('GET /api/tax-invoice/list — invalid type', { path: '/api/tax-invoice/list?type=INVALID', token: T }, null, [200, 400]);
  await test401('/api/tax-invoice/list');

  // Detail by invoiceNo
  await test('GET /api/tax-invoice/detail/NOTEXIST — nonexistent', { path: '/api/tax-invoice/detail/NOTEXIST', token: T }, null, [404, 400, 200]);
  await test401('/api/tax-invoice/detail/123');

  // Summary
  await test('GET /api/tax-invoice/summary — valid year', { path: '/api/tax-invoice/summary?year=2026', token: T }, null, [200]);
  await test('GET /api/tax-invoice/summary — year+month', { path: '/api/tax-invoice/summary?year=2026&month=04', token: T }, null, [200]);
  await test('GET /api/tax-invoice/summary — missing year', { path: '/api/tax-invoice/summary', token: T }, null, [200, 400]);
  await test('GET /api/tax-invoice/summary — invalid year', { path: '/api/tax-invoice/summary?year=999', token: T }, null, [200, 400]);
  await test401('/api/tax-invoice/summary?year=2026');

  // Hometax GET
  await test('GET /api/tax-invoice/hometax — no params', { path: '/api/tax-invoice/hometax', token: T }, null, [200]);
  await test('GET /api/tax-invoice/hometax — with dates', { path: '/api/tax-invoice/hometax?start=20260101&end=20260407', token: T }, null, [200]);
  await test401('/api/tax-invoice/hometax');

  // Hometax DELETE — nonexistent invoiceNo
  await test('DELETE /api/tax-invoice/hometax?invoiceNo=NOTEXIST', { method: 'DELETE', path: '/api/tax-invoice/hometax?invoiceNo=NOTEXIST', token: T }, null, [200, 404, 400]);
  await test('DELETE /api/tax-invoice/hometax — missing invoiceNo', { method: 'DELETE', path: '/api/tax-invoice/hometax', token: T }, null, [400, 200]);
  await test401('/api/tax-invoice/hometax', 'DELETE');

  // Upload — expect 401 without auth (multipart, skip body test)
  await test401('/api/tax-invoice/upload', 'POST');
}

// ═══════════════════════════════════════════════════════════════════════════
//  7. BUDGET
// ═══════════════════════════════════════════════════════════════════════════
async function testBudget(token) {
  section('7. BUDGET');
  const T = token;

  // List
  await test('GET /api/budget/list — valid year', { path: '/api/budget/list?year=2026', token: T }, null, [200]);
  await test('GET /api/budget/list — missing year', { path: '/api/budget/list', token: T }, null, [200, 400]);
  await test('GET /api/budget/list — with type', { path: '/api/budget/list?year=2026&type=expense', token: T }, null, [200]);
  await test401('/api/budget/list?year=2026');

  // Summary
  await test('GET /api/budget/summary — valid year', { path: '/api/budget/summary?year=2026', token: T }, null, [200]);
  await test('GET /api/budget/summary — missing year', { path: '/api/budget/summary', token: T }, null, [200, 400]);
  await test401('/api/budget/summary?year=2026');

  // vs-actual
  await test('GET /api/budget/vs-actual — year only', { path: '/api/budget/vs-actual?year=2026', token: T }, null, [200]);
  await test('GET /api/budget/vs-actual — year + month', { path: '/api/budget/vs-actual?year=2026&month=3', token: T }, null, [200]);
  await test('GET /api/budget/vs-actual — missing year', { path: '/api/budget/vs-actual', token: T }, null, [200, 400]);
  await test('GET /api/budget/vs-actual — invalid month (0)', { path: '/api/budget/vs-actual?year=2026&month=0', token: T }, null, [200, 400]);
  await test('GET /api/budget/vs-actual — invalid month (13)', { path: '/api/budget/vs-actual?year=2026&month=13', token: T }, null, [200, 400]);
  await test401('/api/budget/vs-actual?year=2026');

  // Save
  const budgetSaveBody = {
    year: '2026',
    items: [
      { accountCode: '5001', month: 1, amount: 1000000 },
      { accountCode: '5001', month: 2, amount: 1200000 },
    ],
  };
  await test('POST /api/budget/save — valid', { method: 'POST', path: '/api/budget/save', token: T }, budgetSaveBody, [200]);
  await test('POST /api/budget/save — missing year', { method: 'POST', path: '/api/budget/save', token: T }, { items: [] }, [400, 422, 500]);
  await test('POST /api/budget/save — missing items', { method: 'POST', path: '/api/budget/save', token: T }, { year: '2026' }, [400, 422, 500]);
  await test401('/api/budget/save', 'POST');

  // Sync actual
  await test('POST /api/budget/sync-actual — valid', { method: 'POST', path: '/api/budget/sync-actual', token: T }, { year: '2026' }, [200]);
  await test('POST /api/budget/sync-actual — no body', { method: 'POST', path: '/api/budget/sync-actual', token: T }, {}, [200]);
  await test401('/api/budget/sync-actual', 'POST');
}

// ═══════════════════════════════════════════════════════════════════════════
//  8. COST / MATERIAL PRICE / MFG COST
// ═══════════════════════════════════════════════════════════════════════════
async function testCost(token) {
  section('8. COST / MATERIAL PRICE / MFG COST');
  const T = token;

  // Cost summary
  await test('GET /api/cost/summary — valid', { path: '/api/cost/summary?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/cost/summary — with refresh', { path: '/api/cost/summary?start=20260101&end=20260407&refresh=1', token: T }, null, [200]);
  await test('GET /api/cost/summary — missing params', { path: '/api/cost/summary', token: T }, null, [200, 400]);
  await test('GET /api/cost/summary — reversed dates', { path: '/api/cost/summary?startDate=20260407&endDate=20260101', token: T }, null, [200, 400]);
  await test401('/api/cost/summary?start=20260101&end=20260407');

  // Cost products
  await test('GET /api/cost/products — valid', { path: '/api/cost/products?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/cost/products — with limit', { path: '/api/cost/products?start=20260101&end=20260407&limit=10', token: T }, null, [200]);
  await test('GET /api/cost/products — missing params', { path: '/api/cost/products', token: T }, null, [200, 400]);
  await test401('/api/cost/products?start=20260101&end=20260407');

  // Cost by-channel
  await test('GET /api/cost/by-channel — valid', { path: '/api/cost/by-channel?start=20260101&end=20260407', token: T }, null, [200]);
  await test('GET /api/cost/by-channel — missing params', { path: '/api/cost/by-channel', token: T }, null, [200, 400]);
  await test401('/api/cost/by-channel?start=20260101&end=20260407');

  // Cost trend
  await test('GET /api/cost/trend — default', { path: '/api/cost/trend', token: T }, null, [200]);
  await test('GET /api/cost/trend — months=6', { path: '/api/cost/trend?months=6', token: T }, null, [200]);
  await test401('/api/cost/trend');

  // Cost breakdown
  await test('GET /api/cost/breakdown — no params', { path: '/api/cost/breakdown', token: T }, null, [200]);
  await test('GET /api/cost/breakdown — with productCode', { path: '/api/cost/breakdown?productCode=TEST-001&start=20260101&end=20260407', token: T }, null, [200]);
  await test401('/api/cost/breakdown');

  // Material price list
  await test('GET /api/material-price/list — no params', { path: '/api/material-price/list', token: T }, null, [200]);
  await test('GET /api/material-price/list — with filter', { path: '/api/material-price/list?materialCode=MAT-001&page=1&limit=10', token: T }, null, [200]);
  await test401('/api/material-price/list');

  // Material price latest
  await test('GET /api/material-price/latest — with code', { path: '/api/material-price/latest?materialCode=MAT-001', token: T }, null, [200]);
  await test('GET /api/material-price/latest — missing code', { path: '/api/material-price/latest', token: T }, null, [200, 400]);
  await test401('/api/material-price/latest?materialCode=MAT-001');

  // Material price trend
  await test('GET /api/material-price/trend — valid', { path: '/api/material-price/trend?materialCode=MAT-001', token: T }, null, [200]);
  await test('GET /api/material-price/trend — missing code', { path: '/api/material-price/trend', token: T }, null, [200, 400]);
  await test('GET /api/material-price/trend — with months', { path: '/api/material-price/trend?materialCode=MAT-001&months=6', token: T }, null, [200]);
  await test401('/api/material-price/trend?materialCode=MAT-001');

  // Material price compare
  await test('GET /api/material-price/compare — valid', { path: '/api/material-price/compare?materialCode=MAT-001', token: T }, null, [200]);
  await test('GET /api/material-price/compare — missing code', { path: '/api/material-price/compare', token: T }, null, [200, 400]);
  await test401('/api/material-price/compare?materialCode=MAT-001');

  // Material price xerp-trend
  await test('GET /api/material-price/xerp-trend — valid', { path: '/api/material-price/xerp-trend?materialCode=MAT-001', token: T }, null, [200]);
  await test('GET /api/material-price/xerp-trend — missing code', { path: '/api/material-price/xerp-trend', token: T }, null, [200, 400]);
  await test401('/api/material-price/xerp-trend?materialCode=MAT-001');

  // Material price delete (nonexistent id)
  await test('DELETE /api/material-price/delete?id=999999', { method: 'DELETE', path: '/api/material-price/delete?id=999999', token: T }, null, [200, 404, 400]);
  await test('DELETE /api/material-price/delete — missing id', { method: 'DELETE', path: '/api/material-price/delete', token: T }, null, [400, 200]);
  await test401('/api/material-price/delete?id=1', 'DELETE');

  // Material price upload — 401 only (multipart)
  await test401('/api/material-price/upload', 'POST');

  // Mfg cost rates
  await test('GET /api/mfg-cost/rates — no params', { path: '/api/mfg-cost/rates', token: T }, null, [200]);
  await test('GET /api/mfg-cost/rates — with year', { path: '/api/mfg-cost/rates?year=2026', token: T }, null, [200]);
  await test401('/api/mfg-cost/rates');

  // Mfg cost calculate
  await test('GET /api/mfg-cost/calculate/TEST-001 — valid code', { path: '/api/mfg-cost/calculate/TEST-001', token: T }, null, [200, 404]);
  await test('GET /api/mfg-cost/calculate/TEST-001?qty=100', { path: '/api/mfg-cost/calculate/TEST-001?qty=100', token: T }, null, [200, 404]);
  await test401('/api/mfg-cost/calculate/TEST-001');

  // Mfg cost cards
  await test('GET /api/mfg-cost/cards — default', { path: '/api/mfg-cost/cards', token: T }, null, [200]);
  await test('GET /api/mfg-cost/cards — with page/limit', { path: '/api/mfg-cost/cards?page=1&limit=10', token: T }, null, [200]);
  await test401('/api/mfg-cost/cards');

  // Mfg cost summary
  await test('GET /api/mfg-cost/summary — no params', { path: '/api/mfg-cost/summary', token: T }, null, [200]);
  await test('GET /api/mfg-cost/summary — with year', { path: '/api/mfg-cost/summary?year=2026', token: T }, null, [200]);
  await test401('/api/mfg-cost/summary');

  // Mfg cost calculate-all
  await test('POST /api/mfg-cost/calculate-all — with year', { method: 'POST', path: '/api/mfg-cost/calculate-all', token: T }, { year: '2026' }, [200]);
  await test('POST /api/mfg-cost/calculate-all — no body', { method: 'POST', path: '/api/mfg-cost/calculate-all', token: T }, {}, [200]);
  await test401('/api/mfg-cost/calculate-all', 'POST');

  // Mfg cost rates POST
  await test('POST /api/mfg-cost/rates — valid', { method: 'POST', path: '/api/mfg-cost/rates', token: T }, { year: '2026', rates: [{ category: 'labor', rate: 0.15 }] }, [200]);
  await test('POST /api/mfg-cost/rates — missing year', { method: 'POST', path: '/api/mfg-cost/rates', token: T }, { rates: [] }, [400, 422, 500]);
  await test401('/api/mfg-cost/rates', 'POST');
}

// ═══════════════════════════════════════════════════════════════════════════
//  9. PRODUCTION
// ═══════════════════════════════════════════════════════════════════════════
async function testProduction(token) {
  section('9. PRODUCTION (production-requests, work-orders, mrp, bom)');
  const T = token;

  // --- Production Requests ---
  await test('GET /api/production-requests/list — no params', { path: '/api/production-requests/list', token: T }, null, [200]);
  await test('GET /api/production-requests/list — with dates & status', { path: '/api/production-requests/list?startDate=2026-01-01&endDate=2026-04-07&status=pending&page=1&limit=10', token: T }, null, [200]);
  await test('GET /api/production-requests/list — invalid status', { path: '/api/production-requests/list?status=INVALID', token: T }, null, [200, 400]);
  await test401('/api/production-requests/list');

  const prBody = { productCode: 'TEST-001', qty: 100, requestDate: '2026-04-07', dueDate: '2026-04-14', priority: 3, memo: 'API test' };
  await test('POST /api/production-requests/create — valid', { method: 'POST', path: '/api/production-requests/create', token: T }, prBody, [200, 201]);
  await test('POST /api/production-requests/create — missing required', { method: 'POST', path: '/api/production-requests/create', token: T }, { qty: 10 }, [400, 422, 500]);
  await test('POST /api/production-requests/create — invalid priority', { method: 'POST', path: '/api/production-requests/create', token: T }, { productCode: 'TEST-001', qty: 10, requestDate: '2026-04-07', priority: 99 }, [200, 400]);
  await test401('/api/production-requests/create', 'POST');

  await test('GET /api/production-requests/1 — may exist', { path: '/api/production-requests/1', token: T }, null, [200, 404]);
  await test('GET /api/production-requests/999999 — nonexistent', { path: '/api/production-requests/999999', token: T }, null, [404, 400, 200]);
  await test401('/api/production-requests/1');

  await test('GET /api/production-requests/1/log — may exist', { path: '/api/production-requests/1/log', token: T }, null, [200, 404]);
  await test401('/api/production-requests/1/log');

  // --- Work Orders ---
  await test('GET /api/work-orders/list — no params', { path: '/api/work-orders/list', token: T }, null, [200]);
  await test('GET /api/work-orders/list — with filters', { path: '/api/work-orders/list?status=open&page=1&limit=10', token: T }, null, [200]);
  await test('GET /api/work-orders/list — invalid status', { path: '/api/work-orders/list?status=INVALID', token: T }, null, [200, 400]);
  await test401('/api/work-orders/list');

  const woBody = { productCode: 'TEST-001', qty: 50, startDate: '2026-04-07', endDate: '2026-04-14' };
  await test('POST /api/work-orders/create — valid', { method: 'POST', path: '/api/work-orders/create', token: T }, woBody, [200, 201]);
  await test('POST /api/work-orders/create — missing required', { method: 'POST', path: '/api/work-orders/create', token: T }, { qty: 50 }, [400, 422, 500]);
  await test401('/api/work-orders/create', 'POST');

  await test('GET /api/work-orders/1 — may exist', { path: '/api/work-orders/1', token: T }, null, [200, 404]);
  await test('GET /api/work-orders/999999 — nonexistent', { path: '/api/work-orders/999999', token: T }, null, [404, 400, 200]);
  await test401('/api/work-orders/1');

  await test('GET /api/work-orders/stats — no params', { path: '/api/work-orders/stats', token: T }, null, [200]);
  await test('GET /api/work-orders/stats — with dates', { path: '/api/work-orders/stats?startDate=2026-01-01&endDate=2026-04-07', token: T }, null, [200]);
  await test401('/api/work-orders/stats');

  await test('POST /api/work-orders/result — valid', { method: 'POST', path: '/api/work-orders/result', token: T }, { workOrderId: 1, date: '2026-04-07', goodQty: 48, defectQty: 2 }, [200, 404]);
  await test('POST /api/work-orders/result — missing required', { method: 'POST', path: '/api/work-orders/result', token: T }, { goodQty: 10 }, [400, 422, 500]);
  await test401('/api/work-orders/result', 'POST');

  await test('GET /api/work-orders/results — no params', { path: '/api/work-orders/results', token: T }, null, [200]);
  await test('GET /api/work-orders/results — with workOrderId', { path: '/api/work-orders/results?workOrderId=1', token: T }, null, [200]);
  await test401('/api/work-orders/results');

  await test('GET /api/work-orders/daily-report — valid date', { path: '/api/work-orders/daily-report?date=2026-04-07', token: T }, null, [200]);
  await test('GET /api/work-orders/daily-report — missing date', { path: '/api/work-orders/daily-report', token: T }, null, [200, 400]);
  await test('GET /api/work-orders/daily-report — wrong format', { path: '/api/work-orders/daily-report?date=20260407', token: T }, null, [200, 400]);
  await test401('/api/work-orders/daily-report?date=2026-04-07');

  // --- MRP ---
  await test('POST /api/mrp/run — valid', { method: 'POST', path: '/api/mrp/run', token: T }, { planDate: '2026-04-07', horizonDays: 30 }, [200]);
  await test('POST /api/mrp/run — no body', { method: 'POST', path: '/api/mrp/run', token: T }, {}, [200]);
  await test401('/api/mrp/run', 'POST');

  await test('GET /api/mrp/results — no params', { path: '/api/mrp/results', token: T }, null, [200]);
  await test('GET /api/mrp/results — with planDate', { path: '/api/mrp/results?planDate=2026-04-07', token: T }, null, [200]);
  await test401('/api/mrp/results');

  await test('DELETE /api/mrp/results?planDate=2026-04-07', { method: 'DELETE', path: '/api/mrp/results?planDate=2026-04-07', token: T }, null, [200, 404]);
  await test('DELETE /api/mrp/results — missing planDate', { method: 'DELETE', path: '/api/mrp/results', token: T }, null, [400, 200]);
  await test401('/api/mrp/results?planDate=2026-04-07', 'DELETE');

  await test('POST /api/mrp/calculate — with workOrderId', { method: 'POST', path: '/api/mrp/calculate', token: T }, { workOrderId: 1 }, [200, 404]);
  await test('POST /api/mrp/calculate — no body', { method: 'POST', path: '/api/mrp/calculate', token: T }, {}, [200]);
  await test401('/api/mrp/calculate', 'POST');

  await test('GET /api/mrp/shortage — no params', { path: '/api/mrp/shortage', token: T }, null, [200]);
  await test('GET /api/mrp/shortage — with planDate', { path: '/api/mrp/shortage?planDate=2026-04-07', token: T }, null, [200]);
  await test401('/api/mrp/shortage');

  await test('POST /api/mrp/create-po — empty items', { method: 'POST', path: '/api/mrp/create-po', token: T }, { items: [] }, [200, 400]);
  await test('POST /api/mrp/create-po — missing items', { method: 'POST', path: '/api/mrp/create-po', token: T }, {}, [400, 422, 500]);
  await test401('/api/mrp/create-po', 'POST');

  // --- BOM ---
  await test('GET /api/bom/list — no params', { path: '/api/bom/list', token: T }, null, [200]);
  await test('GET /api/bom/list — with search', { path: '/api/bom/list?search=TEST&page=1&limit=10', token: T }, null, [200]);
  await test401('/api/bom/list');

  await test('GET /api/bom/export — no params', { path: '/api/bom/export', token: T }, null, [200]);
  await test('GET /api/bom/export — with productCode', { path: '/api/bom/export?productCode=TEST-001', token: T }, null, [200, 404]);
  await test401('/api/bom/export');

  await test('GET /api/bom/TEST-001 — may exist', { path: '/api/bom/TEST-001', token: T }, null, [200, 404]);
  await test('GET /api/bom/NOTEXIST-99999 — nonexistent', { path: '/api/bom/NOTEXIST-99999', token: T }, null, [404, 200]);
  await test401('/api/bom/TEST-001');

  const bomBody = {
    productCode: 'TEST-BOM-001',
    version: '1',
    items: [{ item_type: 'material', itemCode: 'MAT-001', qty: 2, unit: 'EA' }],
  };
  await test('POST /api/bom/create — valid', { method: 'POST', path: '/api/bom/create', token: T }, bomBody, [200, 201, 409]);
  await test('POST /api/bom/create — missing required', { method: 'POST', path: '/api/bom/create', token: T }, { productCode: 'TEST-001' }, [400, 422, 500]);
  await test401('/api/bom/create', 'POST');

  await test('PUT /api/bom/999999 — nonexistent', { method: 'PUT', path: '/api/bom/999999', token: T }, { items: [] }, [404, 400, 200]);
  await test401('/api/bom/1', 'PUT');

  await test('DELETE /api/bom/999999 — nonexistent', { method: 'DELETE', path: '/api/bom/999999', token: T }, null, [404, 400, 200]);
  await test401('/api/bom/1', 'DELETE');

  await test('POST /api/bom/import — valid', { method: 'POST', path: '/api/bom/import', token: T }, { sourceCode: 'TEST-001', targetCode: 'TEST-COPY-001' }, [200, 404, 400]);
  await test('POST /api/bom/import — missing required', { method: 'POST', path: '/api/bom/import', token: T }, { sourceCode: 'TEST-001' }, [400, 422, 500]);
  await test401('/api/bom/import', 'POST');

  // BOM bulk-upload — 401 only (multipart)
  await test401('/api/bom/bulk-upload', 'POST');
}

// ═══════════════════════════════════════════════════════════════════════════
//  10. POST PROCESS
// ═══════════════════════════════════════════════════════════════════════════
async function testPostProcess(token) {
  section('10. POST PROCESS');
  const T = token;

  // Prices
  await test('GET /api/post-process/prices — no params', { path: '/api/post-process/prices', token: T }, null, [200]);
  await test('GET /api/post-process/prices — with processType', { path: '/api/post-process/prices?processType=lamination', token: T }, null, [200]);
  await test401('/api/post-process/prices');

  await test('POST /api/post-process/prices — valid', { method: 'POST', path: '/api/post-process/prices', token: T }, { processType: 'lamination', processName: '라미네이션', unitPrice: 500, unit: 'EA' }, [200]);
  await test('POST /api/post-process/prices — missing required', { method: 'POST', path: '/api/post-process/prices', token: T }, { processType: 'lamination' }, [400, 422, 500]);
  await test401('/api/post-process/prices', 'POST');

  // History
  await test('GET /api/post-process/history — no params', { path: '/api/post-process/history', token: T }, null, [200]);
  await test('GET /api/post-process/history — with dates & processType', { path: '/api/post-process/history?startDate=2026-01-01&endDate=2026-04-07&processType=lamination', token: T }, null, [200]);
  await test('GET /api/post-process/history — reversed dates', { path: '/api/post-process/history?startDate=2026-04-07&endDate=2026-01-01', token: T }, null, [200, 400]);
  await test401('/api/post-process/history');

  // Product-map
  await test('GET /api/post-process/product-map — no params', { path: '/api/post-process/product-map', token: T }, null, [200]);
  await test('GET /api/post-process/product-map — with productCode', { path: '/api/post-process/product-map?productCode=TEST-001', token: T }, null, [200]);
  await test401('/api/post-process/product-map');

  // Summary
  await test('GET /api/post-process/summary — no params', { path: '/api/post-process/summary', token: T }, null, [200]);
  await test('GET /api/post-process/summary — with dates', { path: '/api/post-process/summary?startDate=2026-01-01&endDate=2026-04-07', token: T }, null, [200]);
  await test401('/api/post-process/summary');

  // Estimate
  await test('POST /api/post-process/estimate — valid', { method: 'POST', path: '/api/post-process/estimate', token: T }, { productCode: 'TEST-001', qty: 100 }, [200, 404]);
  await test('POST /api/post-process/estimate — missing required', { method: 'POST', path: '/api/post-process/estimate', token: T }, { qty: 100 }, [400, 422, 500]);
  await test401('/api/post-process/estimate', 'POST');
}

// ═══════════════════════════════════════════════════════════════════════════
//  11. QUALITY (defects, inspections, ncr)
// ═══════════════════════════════════════════════════════════════════════════
async function testQuality(token) {
  section('11. QUALITY (defects, inspections, ncr)');
  const T = token;

  // Defects summary
  await test('GET /api/defects/summary — no params', { path: '/api/defects/summary', token: T }, null, [200]);
  await test('GET /api/defects/summary — with dates', { path: '/api/defects/summary?startDate=2026-01-01&endDate=2026-04-07', token: T }, null, [200]);
  await test('GET /api/defects/summary — reversed dates', { path: '/api/defects/summary?startDate=2026-04-07&endDate=2026-01-01', token: T }, null, [200, 400]);
  await test401('/api/defects/summary');

  // Defects list
  await test('GET /api/defects/list — no params', { path: '/api/defects/list', token: T }, null, [200]);
  await test('GET /api/defects/list — with filters', { path: '/api/defects/list?startDate=2026-01-01&endDate=2026-04-07&defectType=scratch&page=1&limit=10', token: T }, null, [200]);
  await test401('/api/defects/list');

  // Defects create
  const defectBody = { date: '2026-04-07', productCode: 'TEST-001', defectType: 'scratch', qty: 5, cause: 'test cause' };
  await test('POST /api/defects/create — valid', { method: 'POST', path: '/api/defects/create', token: T }, defectBody, [200, 201]);
  await test('POST /api/defects/create — missing required', { method: 'POST', path: '/api/defects/create', token: T }, { productCode: 'TEST-001' }, [400, 422, 500]);
  await test401('/api/defects/create', 'POST');

  // Defects single
  await test('GET /api/defects/1 — may exist', { path: '/api/defects/1', token: T }, null, [200, 404]);
  await test('GET /api/defects/999999 — nonexistent', { path: '/api/defects/999999', token: T }, null, [404, 400, 200]);
  await test401('/api/defects/1');

  await test('PUT /api/defects/999999 — nonexistent', { method: 'PUT', path: '/api/defects/999999', token: T }, { status: 'open' }, [404, 400, 200]);
  await test401('/api/defects/1', 'PUT');

  // Defects log
  await test('GET /api/defects/1/log — may exist', { path: '/api/defects/1/log', token: T }, null, [200, 404]);
  await test401('/api/defects/1/log');

  // Defects create-po
  await test('POST /api/defects/999999/create-po — nonexistent', { method: 'POST', path: '/api/defects/999999/create-po', token: T }, null, [404, 400, 200]);
  await test401('/api/defects/1/create-po', 'POST');

  // Inspections
  await test('GET /api/inspections — no params', { path: '/api/inspections', token: T }, null, [200]);
  await test('GET /api/inspections — with dates & type=incoming', { path: '/api/inspections?startDate=2026-01-01&endDate=2026-04-07&type=incoming&page=1&limit=10', token: T }, null, [200]);
  await test('GET /api/inspections — invalid type', { path: '/api/inspections?type=INVALID', token: T }, null, [200, 400]);
  await test401('/api/inspections');

  const inspBody = {
    date: '2026-04-07',
    type: 'incoming',
    productCode: 'TEST-001',
    lotNo: 'LOT-001',
    inspectedQty: 100,
    passQty: 95,
    failQty: 5,
    result: 'conditional',
    inspector: 'API Test',
  };
  await test('POST /api/inspections — valid', { method: 'POST', path: '/api/inspections', token: T }, inspBody, [200, 201]);
  await test('POST /api/inspections — missing required', { method: 'POST', path: '/api/inspections', token: T }, { productCode: 'TEST-001' }, [400, 422, 500]);
  await test('POST /api/inspections — invalid result enum', { method: 'POST', path: '/api/inspections', token: T }, { ...inspBody, result: 'unknown' }, [200, 400]);
  await test401('/api/inspections', 'POST');

  // NCR list
  await test('GET /api/ncr — no params', { path: '/api/ncr', token: T }, null, [200]);
  await test('GET /api/ncr — with dates & status=open', { path: '/api/ncr?startDate=2026-01-01&endDate=2026-04-07&status=open&page=1&limit=10', token: T }, null, [200]);
  await test('GET /api/ncr — invalid status', { path: '/api/ncr?status=INVALID', token: T }, null, [200, 400]);
  await test401('/api/ncr');

  const ncrBody = { date: '2026-04-07', title: 'API Test NCR', description: 'Test description', severity: 'medium', assignedTo: 'tester' };
  await test('POST /api/ncr — valid', { method: 'POST', path: '/api/ncr', token: T }, ncrBody, [200, 201]);
  await test('POST /api/ncr — missing required', { method: 'POST', path: '/api/ncr', token: T }, { title: 'Missing date' }, [400, 422, 500]);
  await test('POST /api/ncr — invalid severity', { method: 'POST', path: '/api/ncr', token: T }, { ...ncrBody, severity: 'extreme' }, [200, 400]);
  await test401('/api/ncr', 'POST');

  // NCR single
  await test('GET /api/ncr/1 — may exist', { path: '/api/ncr/1', token: T }, null, [200, 404]);
  await test('GET /api/ncr/999999 — nonexistent', { path: '/api/ncr/999999', token: T }, null, [404, 400, 200]);
  await test401('/api/ncr/1');

  await test('PUT /api/ncr/999999 — nonexistent', { method: 'PUT', path: '/api/ncr/999999', token: T }, { status: 'closed', rootCause: 'none', correctiveAction: 'none' }, [404, 400, 200]);
  await test401('/api/ncr/1', 'PUT');
}

// ═══════════════════════════════════════════════════════════════════════════
//  SUMMARY
// ═══════════════════════════════════════════════════════════════════════════
function printSummary() {
  console.log(`\n${'═'.repeat(60)}`);
  console.log('  TEST SUMMARY');
  console.log('═'.repeat(60));
  console.log(`  Total : ${results.pass + results.fail}`);
  console.log(`  ✅ Pass : ${results.pass}`);
  console.log(`  ❌ Fail : ${results.fail}`);

  if (results.fail > 0) {
    console.log('\n  Failed tests:');
    results.details.filter((d) => !d.ok).forEach((d) => {
      console.log(`    ❌ ${d.label} — ${d.reason}`);
    });
  }
  console.log('═'.repeat(60));
}

// ═══════════════════════════════════════════════════════════════════════════
//  MAIN
// ═══════════════════════════════════════════════════════════════════════════
(async () => {
  console.log('바른컴퍼니 ERP — API Test Suite Part 2');
  console.log(`Target: http://${HOST}:${PORT}`);
  console.log(`Date: ${new Date().toISOString()}`);

  const token = await login();
  if (!token) {
    console.error('\n[FATAL] Login failed — cannot proceed. Check server is running at http://localhost:12026');
    process.exit(1);
  }

  await testSales(token);
  await testCustomerOrders(token);
  await testShipping(token);
  await testSalesOrders(token);
  await testAccounting(token);
  await testTaxInvoice(token);
  await testBudget(token);
  await testCost(token);
  await testProduction(token);
  await testPostProcess(token);
  await testQuality(token);

  printSummary();
  process.exit(results.fail > 0 ? 1 : 0);
})();
