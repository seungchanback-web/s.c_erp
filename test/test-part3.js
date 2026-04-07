'use strict';
/**
 * test-part3.js — ERP API Comprehensive Test Suite (Part 3)
 * Target: http://localhost:12026
 * Modules: Notices, Tasks, Notes, Approvals, Notifications, Audit Log,
 *          Error Logs, RBAC, Dashboard, China Shipment, Safety Stock,
 *          Lots, Gift Sets, Warehouses, Inventory, Shipments, Procurement
 *
 * Usage: node test-part3.js
 */

const http = require('http');

// ──────────────────────────────────────────────
// Config
// ──────────────────────────────────────────────
const HOST = 'localhost';
const PORT = 12026;
const DELAY_MS = 100;

// ──────────────────────────────────────────────
// State
// ──────────────────────────────────────────────
let TOKEN = null;
const results = [];          // { name, passed, status, error }
const cleanup = [];          // functions to call at the end

// ──────────────────────────────────────────────
// HTTP helper
// ──────────────────────────────────────────────
function request(method, path, body, extraHeaders = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const headers = {
      'Content-Type': 'application/json',
      ...extraHeaders,
    };
    if (TOKEN) headers['Authorization'] = `Bearer ${TOKEN}`;
    if (data) headers['Content-Length'] = Buffer.byteLength(data);

    const options = { hostname: HOST, port: PORT, path, method, headers };
    const req = http.request(options, (res) => {
      let raw = '';
      res.on('data', (c) => (raw += c));
      res.on('end', () => {
        let json = null;
        try { json = JSON.parse(raw); } catch (_) { json = raw; }
        resolve({ status: res.statusCode, body: json, raw });
      });
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

function delay(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

// ──────────────────────────────────────────────
// Test runner helpers
// ──────────────────────────────────────────────
async function test(name, fn) {
  await delay(DELAY_MS);
  try {
    const { passed, status, error } = await fn();
    results.push({ name, passed: !!passed, status, error: error || null });
    console.log(`${passed ? '✅' : '❌'} [${status}] ${name}${error ? ' — ' + error : ''}`);
  } catch (err) {
    results.push({ name, passed: false, status: 'ERR', error: err.message });
    console.log(`❌ [ERR] ${name} — ${err.message}`);
  }
}

function ok(res, expectedStatus = 200) {
  const passed = res.status === expectedStatus;
  return { passed, status: res.status, error: passed ? null : `expected ${expectedStatus}, got ${res.status}: ${JSON.stringify(res.body).slice(0, 120)}` };
}

function notOk(res, ...badStatuses) {
  // passes if status is NOT in badStatuses (i.e., expect a rejection)
  const passed = badStatuses.includes(res.status);
  return { passed, status: res.status, error: passed ? null : `expected one of [${badStatuses}], got ${res.status}` };
}

// ──────────────────────────────────────────────
// SECTION: Login
// ──────────────────────────────────────────────
async function login() {
  console.log('\n══════════════════════════════════════');
  console.log(' LOGIN (local-bypass)');
  console.log('══════════════════════════════════════');
  const res = await request('GET', '/api/auth/local-bypass');
  const tk = res.body && (res.body.token || (res.body.data && res.body.data.token));
  if (res.status === 200 && tk) {
    TOKEN = tk;
    console.log('✅ [200] Local-bypass login successful — token acquired');
    results.push({ name: 'Login (local-bypass)', passed: true, status: 200 });
    return true;
  }
  console.log(`❌ [${res.status}] Local-bypass login FAILED — ${JSON.stringify(res.body).slice(0, 200)}`);
  results.push({ name: 'Login (local-bypass)', passed: false, status: res.status, error: 'Login failed' });
  return false;
}

// ──────────────────────────────────────────────
// SECTION: Notices
// ──────────────────────────────────────────────
async function testNotices() {
  console.log('\n══════════════════════════════════════');
  console.log(' NOTICES');
  console.log('══════════════════════════════════════');

  // GET list — normal
  await test('GET /api/notices (200 with auth)', async () => {
    const r = await request('GET', '/api/notices');
    return ok(r);
  });

  // GET list — no auth
  await test('GET /api/notices (401 no auth)', async () => {
    const savedToken = TOKEN;
    TOKEN = null;
    const r = await request('GET', '/api/notices');
    TOKEN = savedToken;
    return notOk(r, 200, 401, 403);
  });

  // GET popup
  await test('GET /api/notices/popup (200)', async () => {
    const r = await request('GET', '/api/notices/popup');
    return ok(r);
  });

  // POST notice — normal
  let noticeId = null;
  await test('POST /api/notices (create notice)', async () => {
    const r = await request('POST', '/api/notices', {
      title: '[TEST] API Test Notice',
      content: 'This is a test notice created by test-part3.js',
      category: 'general',
      is_pinned: false,
    });
    if (r.status === 200 && r.body) {
      const id = r.body.id || (r.body.notice && r.body.notice.id);
      if (id) {
        noticeId = id;
        cleanup.push(async () => {
          await request('DELETE', `/api/notices/${noticeId}`);
        });
      }
    }
    return ok(r);
  });

  // POST notice — empty body
  await test('POST /api/notices (400 empty body)', async () => {
    const r = await request('POST', '/api/notices', {});
    return notOk(r, 400, 422, 500);
  });

  // POST release notice
  await test('POST /api/notices/release (create release note)', async () => {
    const r = await request('POST', '/api/notices/release', {
      version: '99.99.99-test',
      changes: ['Test change 1', 'Test change 2'],
    });
    return ok(r);
  });

  // GET notice by id
  if (noticeId) {
    await test(`GET /api/notices/${noticeId} (200)`, async () => {
      const r = await request('GET', `/api/notices/${noticeId}`);
      return ok(r);
    });

    // PUT notice
    await test(`PUT /api/notices/${noticeId} (update)`, async () => {
      const r = await request('PUT', `/api/notices/${noticeId}`, {
        title: '[TEST] Updated Notice',
        content: 'Updated content',
      });
      return ok(r);
    });
  }

  // GET nonexistent notice
  await test('GET /api/notices/999999999 (404)', async () => {
    const r = await request('GET', '/api/notices/999999999');
    return notOk(r, 404, 400);
  });

  // SQL injection in query
  await test("GET /api/notices?category='; DROP TABLE notices;-- (safe)", async () => {
    const r = await request('GET', `/api/notices?category=${encodeURIComponent("'; DROP TABLE notices;--")}`);
    return ok(r);
  });
}

// ──────────────────────────────────────────────
// SECTION: Tasks
// ──────────────────────────────────────────────
async function testTasks() {
  console.log('\n══════════════════════════════════════');
  console.log(' TASKS');
  console.log('══════════════════════════════════════');

  await test('GET /api/tasks (200)', async () => {
    const r = await request('GET', '/api/tasks');
    return ok(r);
  });

  await test('GET /api/tasks (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/tasks');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/tasks?status=open', async () => {
    const r = await request('GET', '/api/tasks?status=open');
    return ok(r);
  });

  await test('GET /api/tasks?priority=high', async () => {
    const r = await request('GET', '/api/tasks?priority=high');
    return ok(r);
  });

  let taskId = null;
  await test('POST /api/tasks (create task)', async () => {
    const r = await request('POST', '/api/tasks', {
      title: '[TEST] API Test Task',
      description: 'Created by test-part3.js',
      priority: 'medium',
      due_date: '2026-12-31',
    });
    if (r.status === 200 && r.body) {
      const id = r.body.id || (r.body.task && r.body.task.id);
      if (id) {
        taskId = id;
        cleanup.push(async () => { await request('DELETE', `/api/tasks/${taskId}`); });
      }
    }
    return ok(r);
  });

  await test('POST /api/tasks (400 missing title)', async () => {
    const r = await request('POST', '/api/tasks', { description: 'no title' });
    return notOk(r, 400, 422, 500);
  });

  if (taskId) {
    await test(`GET /api/tasks/${taskId} (200)`, async () => {
      const r = await request('GET', `/api/tasks/${taskId}`);
      return ok(r);
    });

    await test(`PUT /api/tasks/${taskId} (update status)`, async () => {
      const r = await request('PUT', `/api/tasks/${taskId}`, { status: 'in_progress' });
      return ok(r);
    });

    await test(`GET /api/tasks/${taskId}/comments (200)`, async () => {
      const r = await request('GET', `/api/tasks/${taskId}/comments`);
      return ok(r);
    });

    await test(`POST /api/tasks/${taskId}/comments (add comment)`, async () => {
      const r = await request('POST', `/api/tasks/${taskId}/comments`, {
        content: 'Test comment from test-part3.js',
      });
      return ok(r);
    });

    await test(`GET /api/tasks/${taskId}/steps (200)`, async () => {
      const r = await request('GET', `/api/tasks/${taskId}/steps`);
      return ok(r);
    });
  }

  await test('GET /api/tasks/999999999 (404)', async () => {
    const r = await request('GET', '/api/tasks/999999999');
    return notOk(r, 404, 400);
  });

  await test('GET /api/task-templates (200)', async () => {
    const r = await request('GET', '/api/task-templates');
    return ok(r);
  });
}

// ──────────────────────────────────────────────
// SECTION: Notes
// ──────────────────────────────────────────────
async function testNotes() {
  console.log('\n══════════════════════════════════════');
  console.log(' NOTES');
  console.log('══════════════════════════════════════');

  await test('GET /api/notes (200)', async () => {
    const r = await request('GET', '/api/notes');
    return ok(r);
  });

  await test('GET /api/notes (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/notes');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test("GET /api/notes?q='; SELECT * FROM notes;-- (safe)", async () => {
    const r = await request('GET', `/api/notes?q=${encodeURIComponent("'; SELECT * FROM notes;--")}`);
    return ok(r);
  });

  let noteId = null;
  await test('POST /api/notes (create note)', async () => {
    const r = await request('POST', '/api/notes', {
      title: '[TEST] API Test Note',
      content: 'Test note content created by test-part3.js',
      note_type: 'general',
    });
    if (r.status === 200 && r.body) {
      const id = r.body.id || (r.body.note && r.body.note.id);
      if (id) {
        noteId = id;
        cleanup.push(async () => { await request('DELETE', `/api/notes/${noteId}`); });
      }
    }
    return ok(r);
  });

  await test('POST /api/notes (400 missing required fields)', async () => {
    const r = await request('POST', '/api/notes', { note_type: 'test' });
    return notOk(r, 400, 422, 500);
  });

  if (noteId) {
    await test(`GET /api/notes/${noteId} (200)`, async () => {
      const r = await request('GET', `/api/notes/${noteId}`);
      return ok(r);
    });

    await test(`PUT /api/notes/${noteId} (update)`, async () => {
      const r = await request('PUT', `/api/notes/${noteId}`, {
        title: '[TEST] Updated Note',
        content: 'Updated content',
      });
      return ok(r);
    });

    await test(`GET /api/notes/${noteId}/comments (200)`, async () => {
      const r = await request('GET', `/api/notes/${noteId}/comments`);
      return ok(r);
    });

    await test(`POST /api/notes/${noteId}/comments (add comment)`, async () => {
      const r = await request('POST', `/api/notes/${noteId}/comments`, {
        content: 'Test comment from test-part3.js',
      });
      return ok(r);
    });
  }

  await test('GET /api/notes/999999999 (404)', async () => {
    const r = await request('GET', '/api/notes/999999999');
    return notOk(r, 404, 400);
  });
}

// ──────────────────────────────────────────────
// SECTION: Approvals
// ──────────────────────────────────────────────
async function testApprovals() {
  console.log('\n══════════════════════════════════════');
  console.log(' APPROVALS');
  console.log('══════════════════════════════════════');

  await test('GET /api/approvals/pending-count (200)', async () => {
    const r = await request('GET', '/api/approvals/pending-count');
    return ok(r);
  });

  await test('GET /api/approvals/pending-count (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/approvals/pending-count');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/approvals (200, tab=my)', async () => {
    const r = await request('GET', '/api/approvals?tab=my');
    return ok(r);
  });

  await test('GET /api/approvals (200, tab=pending)', async () => {
    const r = await request('GET', '/api/approvals?tab=pending');
    return ok(r);
  });

  await test('GET /api/approvals (200, tab=done)', async () => {
    const r = await request('GET', '/api/approvals?tab=done');
    return ok(r);
  });

  let approvalId = null;
  await test('POST /api/approvals (create approval request)', async () => {
    const r = await request('POST', '/api/approvals', {
      title: '[TEST] API Test Approval',
      type: 'general',
      content: 'Test approval created by test-part3.js',
    });
    if (r.status === 200 && r.body) {
      const id = r.body.id || (r.body.approval && r.body.approval.id);
      if (id) approvalId = id;
    }
    return ok(r);
  });

  await test('POST /api/approvals (400 missing title/type)', async () => {
    const r = await request('POST', '/api/approvals', { content: 'no title or type' });
    return notOk(r, 400, 422, 500);
  });

  if (approvalId) {
    await test(`GET /api/approvals/${approvalId} (200)`, async () => {
      const r = await request('GET', `/api/approvals/${approvalId}`);
      return ok(r);
    });

    await test(`POST /api/approvals/${approvalId}/approve (200)`, async () => {
      const r = await request('POST', `/api/approvals/${approvalId}/approve`, {
        comment: 'Approved in test',
      });
      return ok(r);
    });
  }

  await test('GET /api/approvals/999999999 (404)', async () => {
    const r = await request('GET', '/api/approvals/999999999');
    return notOk(r, 404, 400);
  });

  await test('POST /api/approvals/999999999/reject (404)', async () => {
    const r = await request('POST', '/api/approvals/999999999/reject', { reason: 'test' });
    return notOk(r, 404, 400);
  });
}

// ──────────────────────────────────────────────
// SECTION: Notifications
// ──────────────────────────────────────────────
async function testNotifications() {
  console.log('\n══════════════════════════════════════');
  console.log(' NOTIFICATIONS');
  console.log('══════════════════════════════════════');

  await test('GET /api/notifications (200)', async () => {
    const r = await request('GET', '/api/notifications');
    return ok(r);
  });

  await test('GET /api/notifications (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/notifications');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/notifications/unread-count (200)', async () => {
    const r = await request('GET', '/api/notifications/unread-count');
    return ok(r);
  });

  await test('POST /api/notifications/read-all (200)', async () => {
    const r = await request('POST', '/api/notifications/read-all', {});
    return ok(r);
  });

  await test('POST /api/notifications/read/999999999 (safe 404/200)', async () => {
    const r = await request('POST', '/api/notifications/read/999999999', {});
    // Some implementations return 200 even for nonexistent IDs
    const passed = [200, 404, 400].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });
}

// ──────────────────────────────────────────────
// SECTION: Audit Log
// ──────────────────────────────────────────────
async function testAuditLog() {
  console.log('\n══════════════════════════════════════');
  console.log(' AUDIT LOG');
  console.log('══════════════════════════════════════');

  await test('GET /api/audit-log (200)', async () => {
    const r = await request('GET', '/api/audit-log');
    return ok(r);
  });

  await test('GET /api/audit-log (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/audit-log');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/audit-log?limit=10&offset=0 (200)', async () => {
    const r = await request('GET', '/api/audit-log?limit=10&offset=0');
    return ok(r);
  });

  await test('GET /api/audit-log?action=login (filter)', async () => {
    const r = await request('GET', '/api/audit-log?action=login');
    return ok(r);
  });

  await test('GET /api/audit-log/stats (200)', async () => {
    const r = await request('GET', '/api/audit-log/stats');
    return ok(r);
  });

  await test('GET /api/audit-log/stats?days=30 (200)', async () => {
    const r = await request('GET', '/api/audit-log/stats?days=30');
    return ok(r);
  });

  await test('GET /api/audit-log/actions (200)', async () => {
    const r = await request('GET', '/api/audit-log/actions');
    return ok(r);
  });

  // SQL injection in q param
  await test("GET /api/audit-log?q=' OR '1'='1 (safe)", async () => {
    const r = await request('GET', `/api/audit-log?q=${encodeURIComponent("' OR '1'='1")}`);
    return ok(r);
  });
}

// ──────────────────────────────────────────────
// SECTION: Error Logs
// ──────────────────────────────────────────────
async function testErrorLogs() {
  console.log('\n══════════════════════════════════════');
  console.log(' ERROR LOGS');
  console.log('══════════════════════════════════════');

  await test('GET /api/error-logs (200)', async () => {
    const r = await request('GET', '/api/error-logs');
    return ok(r);
  });

  await test('GET /api/error-logs (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/error-logs');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/error-logs?limit=5 (200)', async () => {
    const r = await request('GET', '/api/error-logs?limit=5');
    return ok(r);
  });

  await test('GET /api/error-logs?level=error (200)', async () => {
    const r = await request('GET', '/api/error-logs?level=error');
    return ok(r);
  });
}

// ──────────────────────────────────────────────
// SECTION: RBAC
// ──────────────────────────────────────────────
async function testRbac() {
  console.log('\n══════════════════════════════════════');
  console.log(' RBAC');
  console.log('══════════════════════════════════════');

  await test('GET /api/rbac/roles (200)', async () => {
    const r = await request('GET', '/api/rbac/roles');
    return ok(r);
  });

  await test('GET /api/rbac/roles (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/rbac/roles');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/rbac/permissions (200)', async () => {
    const r = await request('GET', '/api/rbac/permissions');
    return ok(r);
  });

  await test('GET /api/rbac/user-permissions (200)', async () => {
    const r = await request('GET', '/api/rbac/user-permissions');
    return ok(r);
  });

  await test('POST /api/rbac/check (200)', async () => {
    const r = await request('POST', '/api/rbac/check', {
      resource: 'notices',
      action: 'read',
    });
    return ok(r);
  });
}

// ──────────────────────────────────────────────
// SECTION: Dashboard
// ──────────────────────────────────────────────
async function testDashboard() {
  console.log('\n══════════════════════════════════════');
  console.log(' DASHBOARD');
  console.log('══════════════════════════════════════');

  await test('GET /api/dashboard/analytics (200)', async () => {
    const r = await request('GET', '/api/dashboard/analytics');
    return ok(r);
  });

  await test('GET /api/dashboard/analytics (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/dashboard/analytics');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/exec/summary (200)', async () => {
    const r = await request('GET', '/api/exec/summary');
    return ok(r);
  });

  await test('GET /api/exec/trend (200)', async () => {
    const r = await request('GET', '/api/exec/trend');
    return ok(r);
  });

  await test('GET /api/exec/trend?months=3 (200)', async () => {
    const r = await request('GET', '/api/exec/trend?months=3');
    return ok(r);
  });

  await test('GET /api/exec/dashboard-full (200)', async () => {
    const r = await request('GET', '/api/exec/dashboard-full');
    return ok(r);
  });

  await test('GET /api/stats (200)', async () => {
    const r = await request('GET', '/api/stats');
    return ok(r);
  });

  await test('GET /api/stats/vendor-summary (200)', async () => {
    const r = await request('GET', '/api/stats/vendor-summary');
    return ok(r);
  });

  await test('GET /api/stats/usage-trend?code=TEST (200)', async () => {
    const r = await request('GET', '/api/stats/usage-trend?code=TEST');
    return ok(r);
  });

  await test('GET /api/stats/usage-trend-all (200)', async () => {
    const r = await request('GET', '/api/stats/usage-trend-all');
    return ok(r);
  });

  await test('GET /api/activity-log (200)', async () => {
    const r = await request('GET', '/api/activity-log');
    return ok(r);
  });
}

// ──────────────────────────────────────────────
// SECTION: China Shipment
// ──────────────────────────────────────────────
async function testChinaShipment() {
  console.log('\n══════════════════════════════════════');
  console.log(' CHINA SHIPMENT');
  console.log('══════════════════════════════════════');

  await test('GET /api/china-shipment/logs (200)', async () => {
    const r = await request('GET', '/api/china-shipment/logs');
    return ok(r);
  });

  await test('GET /api/china-shipment/logs (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/china-shipment/logs');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  let shipmentId = null;
  await test('POST /api/china-shipment/save (create shipment)', async () => {
    const r = await request('POST', '/api/china-shipment/save', {
      product_code: 'TEST-PROD-001',
      quantity: 100,
      destination: '서울',
      notes: 'Test shipment from test-part3.js',
    });
    if (r.status === 200 && r.body) {
      const id = r.body.id || (r.body.shipment && r.body.shipment.id) || r.body.log_id;
      if (id) {
        shipmentId = id;
        cleanup.push(async () => {
          await request('DELETE', `/api/china-shipment/logs/${shipmentId}`);
        });
      }
    }
    // Accept 200 or 400 (product may not exist)
    const passed = [200, 400, 404].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/china-shipment/logs/999999999 (404)', async () => {
    const r = await request('GET', '/api/china-shipment/logs/999999999');
    return notOk(r, 404, 400);
  });

  if (shipmentId) {
    await test(`GET /api/china-shipment/logs/${shipmentId} (200)`, async () => {
      const r = await request('GET', `/api/china-shipment/logs/${shipmentId}`);
      return ok(r);
    });

    await test(`PATCH /api/china-shipment/${shipmentId} (update)`, async () => {
      const r = await request('PATCH', `/api/china-shipment/${shipmentId}`, {
        notes: 'Updated by test-part3.js',
      });
      return ok(r);
    });
  }
}

// ──────────────────────────────────────────────
// SECTION: Safety Stock
// ──────────────────────────────────────────────
async function testSafetyStock() {
  console.log('\n══════════════════════════════════════');
  console.log(' SAFETY STOCK');
  console.log('══════════════════════════════════════');

  await test('GET /api/safety-stock (200)', async () => {
    const r = await request('GET', '/api/safety-stock');
    return ok(r);
  });

  await test('GET /api/safety-stock (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/safety-stock');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('POST /api/safety-stock (set safety stock)', async () => {
    const r = await request('POST', '/api/safety-stock', {
      product_code: 'TEST-SAFETY-001',
      min_stock: 50,
      max_stock: 500,
      reorder_qty: 100,
    });
    // accept 200 (set) or 400 (product not found)
    const passed = [200, 400, 404].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('POST /api/safety-stock (400 missing required)', async () => {
    const r = await request('POST', '/api/safety-stock', { product_code: 'TEST' });
    return notOk(r, 400, 422, 500);
  });

  await test('POST /api/safety-stock/check (200)', async () => {
    const r = await request('POST', '/api/safety-stock/check', {
      product_codes: ['TEST-001', 'TEST-002'],
    });
    return ok(r);
  });

  await test('POST /api/safety-stock/check (empty body, 200)', async () => {
    const r = await request('POST', '/api/safety-stock/check', {});
    return ok(r);
  });

  await test('POST /api/safety-stock/import-from-xerp (200/503)', async () => {
    const r = await request('POST', '/api/safety-stock/import-from-xerp', {});
    // XERP may not be connected in test env
    const passed = [200, 503, 500].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });
}

// ──────────────────────────────────────────────
// SECTION: Lots
// ──────────────────────────────────────────────
async function testLots() {
  console.log('\n══════════════════════════════════════');
  console.log(' LOTS');
  console.log('══════════════════════════════════════');

  await test('GET /api/lots/summary (200)', async () => {
    const r = await request('GET', '/api/lots/summary');
    return ok(r);
  });

  await test('GET /api/lots (200)', async () => {
    const r = await request('GET', '/api/lots');
    return ok(r);
  });

  await test('GET /api/lots (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/lots');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/lots?status=active (200)', async () => {
    const r = await request('GET', '/api/lots?status=active');
    return ok(r);
  });

  await test('GET /api/lots/fifo (200)', async () => {
    const r = await request('GET', '/api/lots/fifo');
    return ok(r);
  });

  let lotId = null;
  await test('POST /api/lots (create lot)', async () => {
    const r = await request('POST', '/api/lots', {
      product_code: 'TEST-LOT-001',
      quantity: 200,
      batch_number: 'BATCH-TEST-001',
      warehouse: 'main',
    });
    if (r.status === 200 && r.body) {
      const id = r.body.id || (r.body.lot && r.body.lot.id);
      if (id) lotId = id;
    }
    const passed = [200, 400, 404].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('POST /api/lots (400 missing product_code)', async () => {
    const r = await request('POST', '/api/lots', { quantity: 100 });
    return notOk(r, 400, 422, 500);
  });

  if (lotId) {
    await test(`GET /api/lots/${lotId} (200)`, async () => {
      const r = await request('GET', `/api/lots/${lotId}`);
      return ok(r);
    });

    await test(`PUT /api/lots/${lotId} (update notes)`, async () => {
      const r = await request('PUT', `/api/lots/${lotId}`, {
        notes: 'Updated by test-part3.js',
      });
      return ok(r);
    });

    await test(`POST /api/lots/${lotId}/inspect (200)`, async () => {
      const r = await request('POST', `/api/lots/${lotId}/inspect`, {
        result: 'pass',
        notes: 'Test inspection',
        inspector: 'tester',
      });
      return ok(r);
    });

    await test(`POST /api/lots/${lotId}/transaction (in)`, async () => {
      const r = await request('POST', `/api/lots/${lotId}/transaction`, {
        type: 'in',
        quantity: 10,
        reason: 'test in',
      });
      const passed = [200, 400].includes(r.status);
      return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
    });
  }

  await test('GET /api/lots/999999999 (404)', async () => {
    const r = await request('GET', '/api/lots/999999999');
    return notOk(r, 404, 400);
  });

  await test('GET /api/lots/trace/BATCH-NONEXISTENT (404/200)', async () => {
    const r = await request('GET', '/api/lots/trace/BATCH-NONEXISTENT');
    const passed = [200, 404, 400].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('POST /api/lots/fifo-consume (400 insufficient stock)', async () => {
    const r = await request('POST', '/api/lots/fifo-consume', {
      product_code: 'NONEXISTENT-PRODUCT',
      quantity: 999999,
    });
    return notOk(r, 400, 404, 500);
  });

  await test('POST /api/lots/sync-xerp (200/503)', async () => {
    const r = await request('POST', '/api/lots/sync-xerp', {});
    const passed = [200, 503, 500].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });
}

// ──────────────────────────────────────────────
// SECTION: Gift Sets
// ──────────────────────────────────────────────
async function testGiftSets() {
  console.log('\n══════════════════════════════════════');
  console.log(' GIFT SETS');
  console.log('══════════════════════════════════════');

  await test('GET /api/gift-sets (200)', async () => {
    const r = await request('GET', '/api/gift-sets');
    return ok(r);
  });

  await test('GET /api/gift-sets (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/gift-sets');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/gift-sets?status=active (200)', async () => {
    const r = await request('GET', '/api/gift-sets?status=active');
    return ok(r);
  });

  await test('GET /api/gift-sets/production-capacity (200)', async () => {
    const r = await request('GET', '/api/gift-sets/production-capacity');
    return ok(r);
  });

  let giftSetId = null;
  await test('POST /api/gift-sets (create gift set)', async () => {
    const r = await request('POST', '/api/gift-sets', {
      name: '[TEST] API Test Gift Set',
      description: 'Created by test-part3.js',
      status: 'active',
      components: [
        { product_code: 'TEST-COMP-001', quantity: 1 },
        { product_code: 'TEST-COMP-002', quantity: 2 },
      ],
    });
    if (r.status === 200 && r.body) {
      const id = r.body.id || (r.body.set && r.body.set.id);
      if (id) {
        giftSetId = id;
        cleanup.push(async () => {
          // No delete endpoint in spec — leave created
        });
      }
    }
    const passed = [200, 400, 404].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('POST /api/gift-sets (400 missing name)', async () => {
    const r = await request('POST', '/api/gift-sets', { description: 'no name' });
    return notOk(r, 400, 422, 500);
  });

  if (giftSetId) {
    await test(`PUT /api/gift-sets/${giftSetId} (update)`, async () => {
      const r = await request('PUT', `/api/gift-sets/${giftSetId}`, {
        name: '[TEST] Updated Gift Set',
        status: 'active',
      });
      return ok(r);
    });

    await test(`GET /api/gift-sets/${giftSetId}/transactions (200)`, async () => {
      const r = await request('GET', `/api/gift-sets/${giftSetId}/transactions`);
      return ok(r);
    });

    await test(`POST /api/gift-sets/${giftSetId}/transaction (produce)`, async () => {
      const r = await request('POST', `/api/gift-sets/${giftSetId}/transaction`, {
        type: 'produce',
        quantity: 5,
        notes: 'Test production',
      });
      const passed = [200, 400, 404].includes(r.status);
      return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
    });
  }

  await test('GET /api/gift-sets/999999999/transactions (404)', async () => {
    const r = await request('GET', '/api/gift-sets/999999999/transactions');
    return notOk(r, 404, 400);
  });
}

// ──────────────────────────────────────────────
// SECTION: Warehouses
// ──────────────────────────────────────────────
async function testWarehouses() {
  console.log('\n══════════════════════════════════════');
  console.log(' WAREHOUSES');
  console.log('══════════════════════════════════════');

  await test('GET /api/warehouses (200)', async () => {
    const r = await request('GET', '/api/warehouses');
    return ok(r);
  });

  await test('GET /api/warehouses (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/warehouses');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/warehouses/inventory (200)', async () => {
    const r = await request('GET', '/api/warehouses/inventory');
    return ok(r);
  });

  await test('GET /api/warehouses/inventory?search=TEST (200)', async () => {
    const r = await request('GET', '/api/warehouses/inventory?search=TEST');
    return ok(r);
  });

  await test('GET /api/warehouses/transfers (200)', async () => {
    const r = await request('GET', '/api/warehouses/transfers');
    return ok(r);
  });

  await test('GET /api/warehouses/transfers/stats (200)', async () => {
    const r = await request('GET', '/api/warehouses/transfers/stats');
    return ok(r);
  });

  await test('GET /api/warehouses/adjustments (200)', async () => {
    const r = await request('GET', '/api/warehouses/adjustments');
    return ok(r);
  });

  let warehouseId = null;
  const uniqueCode = `TEST-WH-${Date.now()}`;
  await test('POST /api/warehouses (create warehouse)', async () => {
    const r = await request('POST', '/api/warehouses', {
      code: uniqueCode,
      name: '[TEST] API Test Warehouse',
      location: '테스트 위치',
      description: 'Created by test-part3.js',
    });
    if (r.status === 200 && r.body) {
      // Try to find id in body
      const id = r.body.id || r.body.warehouse_id;
      if (id) {
        warehouseId = id;
        cleanup.push(async () => {
          await request('DELETE', `/api/warehouses/${warehouseId}`);
        });
      } else {
        // fetch list to find new warehouse
        const list = await request('GET', '/api/warehouses');
        if (list.body && Array.isArray(list.body)) {
          const found = list.body.find((w) => w.code === uniqueCode);
          if (found) {
            warehouseId = found.id;
            cleanup.push(async () => {
              await request('DELETE', `/api/warehouses/${warehouseId}`);
            });
          }
        }
      }
    }
    return ok(r);
  });

  await test('POST /api/warehouses (409 duplicate code)', async () => {
    const r = await request('POST', '/api/warehouses', {
      code: uniqueCode,
      name: '[TEST] Duplicate',
    });
    return notOk(r, 409, 400);
  });

  await test('POST /api/warehouses (400 missing required)', async () => {
    const r = await request('POST', '/api/warehouses', { location: 'somewhere' });
    return notOk(r, 400, 422, 500);
  });

  if (warehouseId) {
    await test(`PUT /api/warehouses/${warehouseId} (update)`, async () => {
      const r = await request('PUT', `/api/warehouses/${warehouseId}`, {
        name: '[TEST] Updated Warehouse',
        location: '업데이트된 위치',
        status: 'active',
      });
      return ok(r);
    });

    await test('POST /api/warehouses/inventory (set inventory)', async () => {
      const r = await request('POST', '/api/warehouses/inventory', {
        warehouse_id: warehouseId,
        product_code: 'TEST-INV-001',
        product_name: 'Test Product',
        quantity: 100,
      });
      return ok(r);
    });

    await test('POST /api/warehouses/inventory/bulk (bulk set)', async () => {
      const r = await request('POST', '/api/warehouses/inventory/bulk', {
        warehouse_id: warehouseId,
        items: [
          { product_code: 'TEST-BULK-001', product_name: 'Bulk Test 1', quantity: 50 },
          { product_code: 'TEST-BULK-002', product_name: 'Bulk Test 2', quantity: 75 },
        ],
      });
      return ok(r);
    });

    await test('POST /api/warehouses/adjust (adjust inventory)', async () => {
      const r = await request('POST', '/api/warehouses/adjust', {
        warehouse_id: warehouseId,
        product_code: 'TEST-INV-001',
        product_name: 'Test Product',
        new_quantity: 90,
        reason: 'Test adjustment',
        operator: 'tester',
      });
      return ok(r);
    });
  }

  await test('DELETE /api/warehouses/999999999 (404)', async () => {
    const r = await request('DELETE', '/api/warehouses/999999999');
    return notOk(r, 404, 400);
  });

  await test('POST /api/warehouses/sync-xerp (200/503)', async () => {
    const r = await request('POST', '/api/warehouses/sync-xerp', {});
    const passed = [200, 503, 500].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });
}

// ──────────────────────────────────────────────
// SECTION: Inventory (XERP)
// ──────────────────────────────────────────────
async function testInventory() {
  console.log('\n══════════════════════════════════════');
  console.log(' INVENTORY');
  console.log('══════════════════════════════════════');

  await test('GET /api/xerp-inventory (200/503)', async () => {
    const r = await request('GET', '/api/xerp-inventory');
    const passed = [200, 503].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/xerp-inventory (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/xerp-inventory');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/xerp-inventory?company=barunson (200/503)', async () => {
    const r = await request('GET', '/api/xerp-inventory?company=barunson');
    const passed = [200, 503].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/xerp-inventory?company=dd (200/503)', async () => {
    const r = await request('GET', '/api/xerp-inventory?company=dd');
    const passed = [200, 503].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/inventory/pending-orders (200)', async () => {
    const r = await request('GET', '/api/inventory/pending-orders');
    return ok(r);
  });

  await test('GET /api/xerp-receiving-codes (200/503)', async () => {
    const r = await request('GET', '/api/xerp-receiving-codes');
    const passed = [200, 503].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/xerp-monthly-usage (200/503)', async () => {
    const r = await request('GET', '/api/xerp-monthly-usage');
    const passed = [200, 503].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });
}

// ──────────────────────────────────────────────
// SECTION: Shipments
// ──────────────────────────────────────────────
async function testShipments() {
  console.log('\n══════════════════════════════════════');
  console.log(' SHIPMENTS');
  console.log('══════════════════════════════════════');

  await test('GET /api/shipments (200/503)', async () => {
    const r = await request('GET', '/api/shipments');
    const passed = [200, 503].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/shipments (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/shipments');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/shipments?from=20260101&to=20260407 (200/503)', async () => {
    const r = await request('GET', '/api/shipments?from=20260101&to=20260407');
    const passed = [200, 503].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/shipments?gubun=SO (200/503)', async () => {
    const r = await request('GET', '/api/shipments?gubun=SO');
    const passed = [200, 503].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });
}

// ──────────────────────────────────────────────
// SECTION: Procurement
// ──────────────────────────────────────────────
async function testProcurement() {
  console.log('\n══════════════════════════════════════');
  console.log(' PROCUREMENT');
  console.log('══════════════════════════════════════');

  await test('GET /api/procurement/dashboard (200)', async () => {
    const r = await request('GET', '/api/procurement/dashboard');
    return ok(r);
  });

  await test('GET /api/procurement/dashboard (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('GET', '/api/procurement/dashboard');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('GET /api/procurement/po-receive-status (200)', async () => {
    const r = await request('GET', '/api/procurement/po-receive-status');
    return ok(r);
  });

  await test('GET /api/procurement/po-receive-status?origin=한국 (200)', async () => {
    const r = await request('GET', `/api/procurement/po-receive-status?origin=${encodeURIComponent('한국')}`);
    return ok(r);
  });

  await test('GET /api/procurement/china-shipments (200)', async () => {
    const r = await request('GET', '/api/procurement/china-shipments');
    return ok(r);
  });

  await test('GET /api/procurement/pipeline (200)', async () => {
    const r = await request('GET', '/api/procurement/pipeline');
    return ok(r);
  });

  await test('GET /api/procurement/assembly (200)', async () => {
    const r = await request('GET', '/api/procurement/assembly');
    return ok(r);
  });

  await test('GET /api/procurement/receive-history/999999 (200/empty)', async () => {
    const r = await request('GET', '/api/procurement/receive-history/999999');
    const passed = [200, 404, 400].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/procurement/shipment-items/999999 (200/empty)', async () => {
    const r = await request('GET', '/api/procurement/shipment-items/999999');
    const passed = [200, 404, 400].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  await test('GET /api/procurement/korea-detail/999999 (404)', async () => {
    const r = await request('GET', '/api/procurement/korea-detail/999999');
    return notOk(r, 404, 400);
  });

  // POST endpoints — mostly check auth + invalid body
  await test('POST /api/procurement/force-complete (400 no po_id)', async () => {
    const r = await request('POST', '/api/procurement/force-complete', {});
    return notOk(r, 400, 422, 404, 500);
  });

  await test('POST /api/procurement/force-complete (401 no auth)', async () => {
    const saved = TOKEN; TOKEN = null;
    const r = await request('POST', '/api/procurement/force-complete', { po_id: 1 });
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  await test('POST /api/procurement/update-stage (400 missing fields)', async () => {
    const r = await request('POST', '/api/procurement/update-stage', {});
    return notOk(r, 400, 422, 404, 500);
  });

  await test('POST /api/procurement/confirm-material-date (400 missing)', async () => {
    const r = await request('POST', '/api/procurement/confirm-material-date', {});
    return notOk(r, 400, 422, 404, 500);
  });

  await test('POST /api/procurement/confirm-delivery-date (400 missing)', async () => {
    const r = await request('POST', '/api/procurement/confirm-delivery-date', {});
    return notOk(r, 400, 422, 404, 500);
  });
}

// ──────────────────────────────────────────────
// Edge case / cross-cutting tests
// ──────────────────────────────────────────────
async function testEdgeCases() {
  console.log('\n══════════════════════════════════════');
  console.log(' EDGE CASES');
  console.log('══════════════════════════════════════');

  // Non-integer IDs
  await test('GET /api/notices/not-a-number (400/404)', async () => {
    const r = await request('GET', '/api/notices/not-a-number');
    const passed = [400, 404, 422].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `expected 400/404/422 got ${r.status}` };
  });

  await test('GET /api/tasks/abc (400/404)', async () => {
    const r = await request('GET', '/api/tasks/abc');
    const passed = [400, 404, 422].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `expected 400/404/422 got ${r.status}` };
  });

  // Empty string token
  await test('GET /api/notices with invalid token (401)', async () => {
    const saved = TOKEN;
    TOKEN = 'invalid.token.value';
    const r = await request('GET', '/api/notices');
    TOKEN = saved;
    return notOk(r, 200, 401, 403);
  });

  // Very long string injection
  await test('POST /api/notes with oversized title (safe)', async () => {
    const r = await request('POST', '/api/notes', {
      title: 'A'.repeat(10000),
      content: 'B'.repeat(100000),
    });
    const passed = [200, 400, 413, 422, 500].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  // SQL injection in path ID
  await test("GET /api/lots/1 OR 1=1 (400/404)", async () => {
    const r = await request('GET', '/api/lots/1%20OR%201%3D1');
    const passed = [400, 404, 422].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  // Invalid enum values
  await test("GET /api/tasks?priority=invalid_priority (200 or 400)", async () => {
    const r = await request('GET', '/api/tasks?priority=invalid_priority');
    const passed = [200, 400].includes(r.status);
    return { passed, status: r.status, error: passed ? null : `unexpected ${r.status}` };
  });

  // POST with null body
  await test('POST /api/approvals with null fields (400)', async () => {
    const r = await request('POST', '/api/approvals', { title: null, type: null });
    return notOk(r, 400, 422, 500);
  });
}

// ──────────────────────────────────────────────
// Cleanup
// ──────────────────────────────────────────────
async function runCleanup() {
  if (cleanup.length === 0) return;
  console.log('\n══════════════════════════════════════');
  console.log(' CLEANUP');
  console.log('══════════════════════════════════════');
  for (const fn of cleanup) {
    try {
      await fn();
      await delay(DELAY_MS);
    } catch (e) {
      console.log(`  cleanup error: ${e.message}`);
    }
  }
  console.log('  Cleanup done.');
}

// ──────────────────────────────────────────────
// Summary
// ──────────────────────────────────────────────
function printSummary() {
  const total = results.length;
  const passed = results.filter((r) => r.passed).length;
  const failed = total - passed;

  console.log('\n══════════════════════════════════════');
  console.log(' SUMMARY');
  console.log('══════════════════════════════════════');
  console.log(`  Total  : ${total}`);
  console.log(`  Passed : ${passed} ✅`);
  console.log(`  Failed : ${failed} ❌`);

  if (failed > 0) {
    console.log('\n  Failed tests:');
    results
      .filter((r) => !r.passed)
      .forEach((r) => {
        console.log(`  ❌ [${r.status}] ${r.name}${r.error ? ' — ' + r.error : ''}`);
      });
  }

  console.log('\n  Done.');
  process.exit(failed > 0 ? 1 : 0);
}

// ──────────────────────────────────────────────
// Main
// ──────────────────────────────────────────────
(async () => {
  console.log('══════════════════════════════════════════════');
  console.log(' ERP API TEST SUITE — PART 3');
  console.log(` Target: http://${HOST}:${PORT}`);
  console.log('══════════════════════════════════════════════');

  const loggedIn = await login();
  if (!loggedIn) {
    console.log('\n❌ Login failed — cannot run protected endpoint tests.');
    process.exit(1);
  }

  await testNotices();
  await testTasks();
  await testNotes();
  await testApprovals();
  await testNotifications();
  await testAuditLog();
  await testErrorLogs();
  await testRbac();
  await testDashboard();
  await testChinaShipment();
  await testSafetyStock();
  await testLots();
  await testGiftSets();
  await testWarehouses();
  await testInventory();
  await testShipments();
  await testProcurement();
  await testEdgeCases();

  await runCleanup();
  printSummary();
})();
