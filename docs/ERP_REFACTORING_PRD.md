# ERP 모듈 분리 + 아키텍처 정렬 리팩토링 PRD

> **버전**: 2.0.0
> **작성일**: 2026-05-09
> **상태**: Draft — 관리자 합의 후 착수
> **대상**: `serve_inv2.js` (14,000줄, 298개 API)
> **기준 아키텍처**: [donald-duck](https://github.com/barunntechnicaloffice/donald-duck) 기술 PRD

---

## 1. 현황 및 문제

### 1.1 현재 상태

```
barunson-database-reference/user/
├── serve_inv2.js          ← 14,000줄 단일 파일 (298개 API + 서버 로직 + DB 초기화)
├── routes/
│   ├── _router.js         ← 커스텀 라우터 클래스
│   ├── _ctx.js            ← 공유 컨텍스트 컨테이너
│   ├── barcode.js         ← 분리 완료 (참고 패턴)
│   ├── journal-auto.js    ← 분리 완료
│   ├── report-engine.js   ← 분리 완료
│   └── vat-report.js      ← 분리 완료
```

### 1.2 donald-duck 기술 원칙 대비 GAP 분석

| donald-duck 원칙 | ERP 현재 상태 | GAP |
|-----------------|-------------|-----|
| **서버드리븐(SDUI)** — PageSpec JSON | 해당 없음 (백엔드 전용) | N/A |
| **데이터드리븐** — system_configs JSONB | PO status, 원산지 리드타임, 브랜드코드 코드에 하드코딩 | ❌ 큰 격차 |
| **No Hardcoding** — 도메인값 DB에서 로드 | 매직넘버/매직스트링 산재 | ❌ 큰 격차 |
| **Port & Adapter** — 외부 시스템 추상화 | XERP/DD/bar_shop1 직접 SQL 호출 | ❌ 큰 격차 |
| **StateMachine** — DB기반 상태전이 엔진 | if/else로 PO 상태 변경 | ❌ 큰 격차 |
| **EventBus** — 비동기 도메인 이벤트 | 없음 (모두 동기 처리) | ❌ 큰 격차 |
| **API 규격 통일** — ApiResponseDto | ctx.ok() 자유 형식, camelCase 미통일 | ❌ 중간 격차 |
| **DTO 검증** — class-validator | 없음 (인라인 또는 미검증) | ❌ 중간 격차 |
| **도메인 격리** — 모듈 간 직접 import 금지 | 단일 파일 (격리 불가) | ❌ 큰 격차 |
| **camelCase** — 엔드투엔드 | snake_case/camelCase 혼재 | ❌ 중간 격차 |
| **멱등성** — 3-layer 보호 | 일부 API만 중복 체크 | ⚠️ 부분 격차 |

### 1.3 위험 요소

| 위험 | 심각도 | 설명 |
|------|--------|------|
| **머지 충돌** | 높음 | 2명이 동시에 수정 시 100% 충돌 |
| **사이드이펙트** | 높음 | 전역 변수/함수 공유 → 한 곳 수정이 다른 API에 영향 |
| **테스트 불가** | 높음 | 모듈 분리 없이 단위 테스트 작성 불가 |
| **확장 불가** | 높음 | WMS 연동 추가 시 14,000줄에 끼워넣기 위험 |

---

## 2. 목표

### 2.1 2단계 접근

단일 파일을 한번에 donald-duck 수준으로 바꾸는 건 불가능. **2단계**로 나눈다.

| 단계 | 목표 | 산출물 |
|------|------|--------|
| **Step 1 — 모듈 분리** | 14,000줄 → 15개 파일 분리 | 수정 가능한 구조 확보 |
| **Step 2 — 아키텍처 정렬** | donald-duck 기술 원칙 적용 | 3시스템 일관성 확보 |

Step 1 없이 Step 2는 불가능. Step 1이 안전한 기반을 만든다.

### 2.2 비목표 (하지 않는 것)

- Express/NestJS 전환 (기존 커스텀 HTTP 서버 유지)
- TypeScript 전환 (기존 JavaScript 유지)
- SDUI 도입 (ERP는 백엔드 전용, 프론트는 HTML)
- CMYK PDF (ERP에 해당 없음)
- BullMQ/Redis 도입 (ERP 규모에 과도 → 경량 이벤트 시스템)

---

## 3. Step 1 — 모듈 분리 리팩토링

### 3.1 분리 후 구조

```
barunson-database-reference/user/
├── serve_inv2.js              ← ~300줄 (앱 초기화 + 미들웨어 + 라우터 등록)
├── routes/
│   ├── _router.js             ← 커스텀 라우터 (기존, 변경 없음)
│   ├── _ctx.js                ← 공유 컨텍스트 (기존, 변경 없음)
│   │
│   │  ── Step 1: 신규 분리 ──
│   ├── auth.js                ← 인증/사용자/권한 (~15 API)
│   ├── products.js            ← 품목 관리 (~15 API)
│   ├── inventory.js           ← 재고/XERP 연동 (~12 API)
│   ├── po.js                  ← 발주 관리 (~20 API)
│   ├── procurement.js         ← 구매/입고/조달 (~15 API)
│   ├── auto-order.js          ← 자동발주 (~8 API)
│   ├── vendor-portal.js       ← 벤더포털 (~15 API)
│   ├── vendors.js             ← 거래처 관리 (~8 API)
│   ├── post-process.js        ← 후공정 관리 (~12 API)
│   ├── accounting.js          ← 회계/정산/마감 (~20 API)
│   ├── bom-mrp.js             ← BOM/MRP/생산계획 (~12 API)
│   ├── sales.js               ← 매출/주문/DD (~12 API)
│   ├── reports.js             ← 리포트/통계 (~15 API)
│   ├── admin.js               ← 시스템관리/디버그 (~10 API)
│   ├── china.js               ← 중국 구매 전용 (~10 API)
│   │
│   │  ── 기존 분리 완료 ──
│   ├── barcode.js             ← 바코드
│   ├── journal-auto.js        ← 자동분개
│   ├── report-engine.js       ← 리포트엔진
│   └── vat-report.js          ← 부가세
```

### 3.2 모듈 작성 패턴

기존 분리 완료 모듈(barcode.js 등)과 동일한 패턴:

```javascript
// routes/{module}.js
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

function initTables() {
  const { db } = ctx;
  if (!db) return;
  db.exec(`CREATE TABLE IF NOT EXISTS ...`);
}

router.get('/api/some-endpoint', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const user = token ? ctx.verifyToken(token) : null;
  if (!user) { ctx.fail(res, 401, '인증 필요'); return; }
  const rows = ctx.db.prepare('SELECT ...').all();
  ctx.ok(res, rows);
});

module.exports = { router, initTables };
```

### 3.3 분리 규칙

| 규칙 | 이유 |
|------|------|
| 모듈 간 직접 `require` 금지 | `_ctx.js`를 통해서만 공유 |
| 전역 변수 사용 금지 | 모듈 내부 `const`/`let`만 |
| API 경로/응답 변경 금지 | 기존 동작 100% 보존 |
| DB 스키마 변경 금지 | Step 1에서는 구조만 분리 |

### 3.4 실행 순서 (의존성 낮은 것부터)

| Phase | 모듈 | 예상 소요 |
|-------|------|----------|
| R1 | auth, admin, vendors, china | 1일 |
| R2 | products, inventory, auto-order, po | 1~2일 |
| R3 | procurement, vendor-portal, post-process, accounting | 1~2일 |
| R4 | sales, bom-mrp, reports | 1일 |
| R5 | serve_inv2.js 정리 + 통합 검증 | 0.5일 |
| **총계** | **15개 모듈** | **4~6일** |

### 3.5 검증 방법

```bash
# 리팩토링 전: 모든 API 응답 스냅샷
node scripts/snapshot-apis.js --output=before.json

# 리팩토링 후: 응답 비교
node scripts/snapshot-apis.js --output=after.json
node scripts/compare-snapshots.js before.json after.json
# → diff 0건이면 성공
```

### 3.6 성공 기준

- [ ] `serve_inv2.js` 300줄 이하
- [ ] 15개 라우트 모듈로 완전 분리
- [ ] 298개 API 전부 동작 (응답 diff 0건)
- [ ] 에러 로그 0건

---

## 4. Step 2 — 아키텍처 정렬 (donald-duck 기술 원칙 적용)

> Step 1 완료 후 진행. 모듈이 분리되어 있어야 각 모듈에 원칙을 적용 가능.

### 4.1 적용 원칙 요약

donald-duck의 기술 원칙 중 ERP에 적용 가능한 것:

| # | 원칙 | 적용 방법 | 우선순위 |
|---|------|----------|---------|
| A | **API 규격 통일** | 공통 응답 래퍼 + camelCase + 에러 코드 | 높음 |
| B | **데이터드리븐 설정** | system_configs 테이블로 비즈니스 값 관리 | 높음 |
| C | **No Hardcoding** | 매직넘버/매직스트링 → 설정 테이블 이동 | 높음 |
| D | **Port & Adapter** | 외부 DB(XERP/DD/bar_shop1) 접근 추상화 | 중간 |
| E | **StateMachine** | PO/입고/정산 상태 전이를 엔진으로 | 중간 |
| F | **도메인 이벤트** | 경량 이벤트 시스템 (BullMQ 대신 in-process) | 낮음 |
| G | **DTO 검증** | 입력 검증 헬퍼 (Joi/Zod 경량 버전) | 낮음 |

### 4.2 (A) API 규격 통일

#### 4.2.1 공통 응답 래퍼

donald-duck `ApiResponseDto`와 동일한 구조:

```javascript
// routes/_response.js — 공통 응답 헬퍼 (신규)

function apiSuccess(res, data, status = 200) {
  const body = {
    success: true,
    data,
    timestamp: new Date().toISOString(),
  };
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function apiError(res, code, message, status = 400) {
  const body = {
    success: false,
    error: { code, message },
    timestamp: new Date().toISOString(),
  };
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

module.exports = { apiSuccess, apiError };
```

#### 4.2.2 ctx에 등록

```javascript
// serve_inv2.js
const { apiSuccess, apiError } = require('./routes/_response');
ctx.apiSuccess = apiSuccess;
ctx.apiError = apiError;
```

#### 4.2.3 기존 API 점진적 전환

```javascript
// Before (기존)
ctx.ok(res, rows);
ctx.fail(res, 400, '잘못된 요청');

// After (전환 후)
ctx.apiSuccess(res, rows);
ctx.apiError(res, 'VALIDATION_ERROR', '잘못된 요청', 400);
```

> **전환 전략**: 신규 API(WMS 연동)는 즉시 적용. 기존 298개 API는 모듈별로 점진적 전환.
> `ctx.ok`/`ctx.fail`은 하위 호환 유지 (제거하지 않음).

#### 4.2.4 공통 에러 코드 (3시스템 통일)

| 코드 | HTTP | 설명 |
|------|------|------|
| `AUTH_FAILED` | 401 | 인증 실패 |
| `FORBIDDEN` | 403 | 권한 부족 |
| `NOT_FOUND` | 404 | 리소스 없음 |
| `VALIDATION_ERROR` | 400 | 필수 필드 누락/형식 오류 |
| `SKU_NOT_FOUND` | 422 | 미등록 SKU |
| `INSUFFICIENT_STOCK` | 409 | 재고 부족 |
| `DUPLICATE` | 200 | 이미 존재 (멱등성) |
| `INVALID_STATE` | 400 | 상태 전이 불가 |
| `SYSTEM_ERROR` | 500 | 서버 내부 오류 |
| `NOT_CONFIGURED` | 503 | 연동 미설정 |

#### 4.2.5 camelCase 통일

```javascript
// Before (혼재)
{ product_code: '...', vendor_name: '...', po_date: '...' }

// After (camelCase)
{ productCode: '...', vendorName: '...', poDate: '...' }
```

> **전환 전략**: 신규 API는 즉시 camelCase. 기존 API는 모듈별 점진적 전환.
> DB 컬럼명(snake_case)은 변경하지 않음 — 응답 시에만 camelCase로 변환.

```javascript
// routes/_utils.js — camelCase 변환 헬퍼 (신규)

function toCamel(str) {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

function keysToCamel(obj) {
  if (Array.isArray(obj)) return obj.map(keysToCamel);
  if (obj && typeof obj === 'object') {
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [toCamel(k), keysToCamel(v)])
    );
  }
  return obj;
}

module.exports = { toCamel, keysToCamel };
```

---

### 4.3 (B) 데이터드리븐 설정 테이블

#### 4.3.1 system_configs 테이블 (donald-duck과 동일 패턴)

```sql
CREATE TABLE IF NOT EXISTS system_configs (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key   TEXT UNIQUE NOT NULL,
  config_value TEXT NOT NULL,           -- JSON
  description  TEXT DEFAULT '',
  is_active    INTEGER DEFAULT 1,
  version      INTEGER DEFAULT 1,
  updated_at   TEXT DEFAULT (datetime('now','localtime')),
  updated_by   TEXT DEFAULT 'system'
);

CREATE TABLE IF NOT EXISTS config_history (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  config_key   TEXT NOT NULL,
  prev_value   TEXT,
  new_value    TEXT NOT NULL,
  changed_by   TEXT DEFAULT 'system',
  changed_at   TEXT DEFAULT (datetime('now','localtime'))
);
```

#### 4.3.2 이동 대상 하드코딩 값

| 현재 위치 | config_key | config_value | 설명 |
|----------|-----------|-------------|------|
| `serve_inv2.js` 인라인 | `brand.labels` | `{"BC":"바른손카드","BH":"바른손하이빌","TC":"더카드","DD":"디어디어",...}` | 브랜드 코드 → 라벨 |
| `serve_inv2.js` 인라인 | `origin.leadTime` | `{"korea":{"days":7,"safetyMonths":0.5},"china":{"days":50,"safetyMonths":2},"dd":{"days":14,"safetyMonths":1}}` | 원산지별 리드타임 |
| `serve_inv2.js` 인라인 | `po.tolerancePct` | `5.0` | 입고 허용 오차 |
| `serve_inv2.js` 인라인 | `po.statusFlow` | `{"draft":"sent","sent":"partial","partial":"received","received":"completed"}` | PO 상태 흐름 |
| `serve_inv2.js` 인라인 | `auto_order.schedule` | `"0 9 * * *"` | 자동발주 CRON |
| `serve_inv2.js` 인라인 | `xerp.siteCode` | `"BK10"` | XERP 사이트 코드 |
| `serve_inv2.js` 인라인 | `xerp.inoutGubun.SO` | `"SO"` | 출고 구분 코드 |
| `serve_inv2.js` 인라인 | `slack.webhookUrl` | `"env:SLACK_WEBHOOK_URL"` | Slack 웹훅 URL |
| `serve_inv2.js` 인라인 | `email.templates` | `{...}` | 이메일 템플릿 |
| 각 모듈 인라인 | `vendor_portal.tokenTtl` | `7776000` | 벤더 토큰 유효기간 (90일) |

#### 4.3.3 설정 로드 헬퍼

```javascript
// routes/_config.js — 데이터드리븐 설정 로더 (신규)

const ctx = require('./_ctx');

// 메모리 캐시 (서버 시작 시 로드, 변경 시 갱신)
const _cache = new Map();

function loadConfig(key, fallback = null) {
  // 캐시 히트
  if (_cache.has(key)) return _cache.get(key);

  // DB 조회
  const { db } = ctx;
  if (!db) return fallback;

  const row = db.prepare(
    'SELECT config_value FROM system_configs WHERE config_key = ? AND is_active = 1'
  ).get(key);

  if (!row) {
    // fallback 허용 (donald-duck: "DB not configured" 코멘트와 동일)
    return fallback;
  }

  const value = JSON.parse(row.config_value);
  _cache.set(key, value);
  return value;
}

function setConfig(key, value, updatedBy = 'system') {
  const { db } = ctx;
  if (!db) return;

  const json = JSON.stringify(value);
  const existing = db.prepare('SELECT config_value FROM system_configs WHERE config_key = ?').get(key);

  if (existing) {
    // 히스토리 기록
    db.prepare(
      'INSERT INTO config_history (config_key, prev_value, new_value, changed_by) VALUES (?,?,?,?)'
    ).run(key, existing.config_value, json, updatedBy);

    db.prepare(
      'UPDATE system_configs SET config_value = ?, version = version + 1, updated_at = datetime("now","localtime"), updated_by = ? WHERE config_key = ?'
    ).run(json, updatedBy, key);
  } else {
    db.prepare(
      'INSERT INTO system_configs (config_key, config_value, updated_by) VALUES (?,?,?)'
    ).run(key, json, updatedBy);
  }

  _cache.set(key, value);
}

function invalidateCache(key) {
  if (key) _cache.delete(key);
  else _cache.clear();
}

module.exports = { loadConfig, setConfig, invalidateCache };
```

#### 4.3.4 사용 예시

```javascript
// Before (하드코딩)
const TOLERANCE_PCT = 5.0;
if (receivedQty >= orderedQty * (1 - TOLERANCE_PCT / 100)) { ... }

// After (데이터드리븐)
const { loadConfig } = require('./_config');
const tolerance = loadConfig('po.tolerancePct', 5.0);
if (receivedQty >= orderedQty * (1 - tolerance / 100)) { ... }
```

---

### 4.4 (C) No Hardcoding — 매직넘버/매직스트링 제거

#### 4.4.1 상태값 → 상수 모듈

```javascript
// routes/_constants.js — 도메인 상수 (신규)

// 설정 테이블에서 로드하되, fallback 기본값 제공
const { loadConfig } = require('./_config');

const PO_STATUS = () => loadConfig('po.statuses', {
  DRAFT: 'draft',
  SENT: 'sent',
  PARTIAL: 'partial',
  RECEIVED: 'received',
  COMPLETED: 'completed',
  CANCELLED: 'cancelled',
});

const INBOUND_STATUS = () => loadConfig('inbound.statuses', {
  PENDING: 'pending',
  RECEIVED: 'received',
  INSPECTING: 'inspecting',
  COMPLETED: 'completed',
  REJECTED: 'rejected',
});

const ORIGIN = () => loadConfig('origin.labels', {
  KOREA: '한국',
  CHINA: '중국',
  DD: '더기프트',
});

const BRAND = () => loadConfig('brand.labels', {
  BC: '바른손카드',
  BH: '바른손하이빌',
  TC: '더카드',
  DD: '디어디어',
});

module.exports = { PO_STATUS, INBOUND_STATUS, ORIGIN, BRAND };
```

#### 4.4.2 사용 예시

```javascript
// Before (매직스트링)
if (po.status === 'received') { ... }
po.status = 'completed';

// After (상수 + 데이터드리븐)
const { PO_STATUS } = require('./_constants');
if (po.status === PO_STATUS().RECEIVED) { ... }
// 상태 변경은 StateMachine을 통해서만 (§4.6 참조)
```

---

### 4.5 (D) Port & Adapter — 외부 시스템 추상화

#### 4.5.1 현재 문제

```javascript
// 현재: XERP SQL이 비즈니스 로직에 직접 산재
const result = await pool.request().query(`
  SELECT RTRIM(ItemCode) AS code, SUM(OhQty) AS qty
  FROM mmInventory WITH (NOLOCK)
  WHERE SiteCode = 'BK10'
  GROUP BY RTRIM(ItemCode)
`);
```

#### 4.5.2 Port 인터페이스 (추상)

```javascript
// ports/inventory-port.js — 재고 조회 추상 포트 (신규)

/**
 * @typedef {Object} InventoryLevel
 * @property {string} sku
 * @property {number} onHand
 * @property {number} available
 * @property {string} source - 'xerp' | 'wms' | 'snapshot'
 */

/**
 * @typedef {Object} InventoryPort
 * @property {(sku: string) => Promise<InventoryLevel>} getStock
 * @property {(skus: string[]) => Promise<InventoryLevel[]>} getBulkStock
 * @property {() => Promise<void>} syncSnapshot
 */

module.exports = {};
```

#### 4.5.3 Adapter 구현 (구체)

```javascript
// adapters/xerp-inventory-adapter.js — XERP 재고 어댑터 (신규)

const ctx = require('../routes/_ctx');

const xerpInventoryAdapter = {
  async getStock(sku) {
    const pool = await ctx.ensureXerpPool();
    const result = await pool.request()
      .input('sku', sku)
      .query(`
        SELECT RTRIM(ItemCode) AS sku, SUM(OhQty) AS onHand
        FROM mmInventory WITH (NOLOCK)
        WHERE SiteCode = 'BK10' AND RTRIM(ItemCode) = @sku
        GROUP BY RTRIM(ItemCode)
      `);
    const row = result.recordset[0];
    return {
      sku,
      onHand: row?.onHand ?? 0,
      available: row?.onHand ?? 0,
      source: 'xerp',
    };
  },

  async getBulkStock(skus) {
    // ... XERP 대량 조회
  },

  async syncSnapshot() {
    // ... inventory_snapshot 테이블 갱신
  },
};

module.exports = xerpInventoryAdapter;
```

```javascript
// adapters/wms-inventory-adapter.js — WMS 재고 어댑터 (신규)

const ctx = require('../routes/_ctx');
const { loadConfig } = require('../routes/_config');

const wmsInventoryAdapter = {
  async getStock(sku) {
    const baseUrl = loadConfig('wms.baseUrl', 'http://localhost:3000');
    const token = await this._getToken();
    const res = await fetch(`${baseUrl}/api/platform/inventory/${encodeURIComponent(sku)}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    const data = json.data || json;
    return {
      sku: data.sku,
      onHand: data.total,
      available: data.available,
      source: 'wms',
    };
  },

  async getBulkStock(skus) {
    const baseUrl = loadConfig('wms.baseUrl', 'http://localhost:3000');
    const token = await this._getToken();
    const res = await fetch(`${baseUrl}/api/platform/inventory/bulk?skus=${skus.join(',')}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const json = await res.json();
    const items = json.data?.items || [];
    return items.map(i => ({ sku: i.sku, onHand: i.total, available: i.available, source: 'wms' }));
  },

  // 토큰 캐싱
  _token: null,
  _tokenExp: 0,
  async _getToken() {
    if (this._token && Date.now() < this._tokenExp - 60000) return this._token;
    const baseUrl = loadConfig('wms.baseUrl', 'http://localhost:3000');
    const secret = loadConfig('wms.auth.secret', process.env.WMS_SERVICE_SECRET);
    const res = await fetch(`${baseUrl}/api/platform/auth`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ serviceSecret: secret }),
    });
    const data = await res.json();
    this._token = data.token;
    this._tokenExp = Date.now() + (data.expiresIn || 900) * 1000;
    return this._token;
  },
};

module.exports = wmsInventoryAdapter;
```

#### 4.5.4 어댑터 선택 (설정 기반)

```javascript
// adapters/index.js — 어댑터 팩토리 (신규)

const { loadConfig } = require('../routes/_config');

function getInventoryAdapter() {
  const source = loadConfig('inventory.source', 'xerp'); // 'xerp' | 'wms' | 'snapshot'
  switch (source) {
    case 'wms':
      return require('./wms-inventory-adapter');
    case 'xerp':
    default:
      return require('./xerp-inventory-adapter');
  }
}

module.exports = { getInventoryAdapter };
```

> 설정 변경만으로 XERP ↔ WMS 재고 소스를 전환. 코드 변경 불필요.

#### 4.5.5 어댑터 목록

| Port | 현재 구현 | WMS 연동 후 |
|------|----------|-----------|
| **InventoryPort** | XerpInventoryAdapter | WmsInventoryAdapter |
| **ShipmentPort** | XerpShipmentAdapter (mmInoutItem) | WmsShipmentAdapter |
| **ProductPort** | LocalProductAdapter (SQLite) | LocalProductAdapter (변경 없음) |
| **DdSalesPort** | DdMysqlAdapter (MySQL) | DdMysqlAdapter (변경 없음) |

---

### 4.6 (E) StateMachine — 상태 전이 엔진

#### 4.6.1 현재 문제

```javascript
// 현재: if/else로 상태 변경 (사이드이펙트 산재)
if (allReceived) {
  po.status = 'received';
  // 여기서 journal 생성, 여기서 Slack 알림, 여기서 inventory 업데이트...
} else if (withinTolerance) {
  po.status = 'completed';
  // 또 다른 사이드이펙트들...
}
```

#### 4.6.2 경량 StateMachine (donald-duck 패턴 경량화)

```javascript
// engines/state-machine.js — 경량 상태 전이 엔진 (신규)

const { loadConfig } = require('../routes/_config');

/**
 * 설정 기반 상태 전이 실행
 *
 * config_key 예: "state_machine.po"
 * config_value: {
 *   "transitions": [
 *     { "from": "draft", "trigger": "send", "to": "sent", "sideEffects": ["email_vendor"] },
 *     { "from": "sent", "trigger": "receive_partial", "to": "partial" },
 *     { "from": ["sent","partial"], "trigger": "receive_complete", "to": "received", "sideEffects": ["journal_entry","slack_notify"] },
 *     { "from": "received", "trigger": "complete", "to": "completed" },
 *     { "from": ["draft","sent"], "trigger": "cancel", "to": "cancelled" }
 *   ]
 * }
 */
function transition(domain, currentStatus, trigger) {
  const config = loadConfig(`state_machine.${domain}`);
  if (!config?.transitions) {
    throw new Error(`StateMachine 설정 없음: state_machine.${domain}`);
  }

  const rule = config.transitions.find(t => {
    const fromMatch = Array.isArray(t.from)
      ? t.from.includes(currentStatus)
      : t.from === currentStatus || t.from === '*';
    return fromMatch && t.trigger === trigger;
  });

  if (!rule) {
    throw new Error(
      `상태 전이 불가: ${domain} [${currentStatus}] → trigger:${trigger}`
    );
  }

  return {
    previousStatus: currentStatus,
    newStatus: rule.to,
    trigger,
    sideEffects: rule.sideEffects || [],
  };
}

module.exports = { transition };
```

#### 4.6.3 사이드이펙트 레지스트리

```javascript
// engines/side-effects.js — 사이드이펙트 핸들러 등록소 (신규)

const handlers = {};

function register(name, handler) {
  handlers[name] = handler;
}

async function execute(sideEffects, context) {
  const results = [];
  for (const name of sideEffects) {
    const handler = handlers[name];
    if (!handler) {
      console.warn(`[SideEffect] 핸들러 미등록: ${name}`);
      results.push({ name, status: 'skipped' });
      continue;
    }
    try {
      await handler(context);
      results.push({ name, status: 'ok' });
    } catch (err) {
      console.error(`[SideEffect] ${name} 실패:`, err.message);
      results.push({ name, status: 'failed', error: err.message });
    }
  }
  return results;
}

module.exports = { register, execute };
```

#### 4.6.4 사용 예시

```javascript
// routes/po.js — StateMachine 적용
const { transition } = require('../engines/state-machine');
const { execute } = require('../engines/side-effects');

router.post('/api/po/transition', async (req, res) => {
  const { poId, trigger } = await ctx.readJSON(req);
  const po = ctx.db.prepare('SELECT * FROM po_header WHERE po_id = ?').get(poId);

  // 상태 전이 (설정 기반)
  const result = transition('po', po.status, trigger);

  // DB 업데이트
  ctx.db.prepare('UPDATE po_header SET status = ? WHERE po_id = ?')
    .run(result.newStatus, poId);

  // 사이드이펙트 실행
  await execute(result.sideEffects, { po, result });

  ctx.apiSuccess(res, result);
});
```

#### 4.6.5 StateMachine 설정 시드 데이터

```sql
INSERT INTO system_configs (config_key, config_value, description) VALUES
('state_machine.po', '{
  "transitions": [
    {"from": "draft", "trigger": "send", "to": "sent", "sideEffects": ["email_vendor", "slack_po_sent"]},
    {"from": "sent", "trigger": "receive_partial", "to": "partial", "sideEffects": ["update_inventory"]},
    {"from": ["sent","partial"], "trigger": "receive_complete", "to": "received", "sideEffects": ["update_inventory", "journal_entry"]},
    {"from": "received", "trigger": "complete", "to": "completed", "sideEffects": ["slack_po_complete"]},
    {"from": ["draft","sent","partial"], "trigger": "cancel", "to": "cancelled", "sideEffects": ["release_inventory"]}
  ]
}', 'PO 상태 전이 규칙'),

('state_machine.procurement', '{
  "transitions": [
    {"from": "pending", "trigger": "start_inspect", "to": "inspecting"},
    {"from": "inspecting", "trigger": "pass", "to": "completed", "sideEffects": ["update_inventory", "wms_receive_confirm"]},
    {"from": "inspecting", "trigger": "fail", "to": "rejected", "sideEffects": ["create_defect_report"]}
  ]
}', '입고검수 상태 전이 규칙');
```

---

### 4.7 (F) 도메인 이벤트 (경량 버전)

donald-duck은 BullMQ(Redis)를 사용하지만, ERP 규모에서는 과도. **in-process 경량 이벤트**로 구현:

```javascript
// engines/event-bus.js — 경량 도메인 이벤트 (신규)

const listeners = {};

function on(eventType, handler) {
  if (!listeners[eventType]) listeners[eventType] = [];
  listeners[eventType].push(handler);
}

async function emit(eventType, payload) {
  const handlers = listeners[eventType] || [];
  for (const handler of handlers) {
    try {
      await handler(payload);
    } catch (err) {
      console.error(`[EventBus] ${eventType} 핸들러 오류:`, err.message);
      // fire-and-forget: 실패해도 계속 진행
    }
  }
}

module.exports = { on, emit };
```

**사용 예시**:

```javascript
// 초기화 시 핸들러 등록
const eventBus = require('./engines/event-bus');

eventBus.on('po:received', async ({ poId, items }) => {
  // 재고 업데이트
  await updateInventory(items);
});

eventBus.on('po:received', async ({ poId }) => {
  // Slack 알림
  await sendSlack(`PO ${poId} 입고 완료`);
});

// 비즈니스 로직에서 이벤트 발행
eventBus.emit('po:received', { poId, items });
```

---

### 4.8 (G) DTO 검증 헬퍼

NestJS의 class-validator 대신 **경량 검증 헬퍼**:

```javascript
// routes/_validate.js — 입력 검증 헬퍼 (신규)

function validate(data, rules) {
  const errors = [];
  for (const [field, rule] of Object.entries(rules)) {
    const value = data[field];
    if (rule.required && (value === undefined || value === null || value === '')) {
      errors.push(`${field}은(는) 필수입니다`);
    }
    if (rule.type && value !== undefined && typeof value !== rule.type) {
      errors.push(`${field}은(는) ${rule.type} 타입이어야 합니다`);
    }
    if (rule.min !== undefined && value < rule.min) {
      errors.push(`${field}은(는) ${rule.min} 이상이어야 합니다`);
    }
    if (rule.enum && !rule.enum.includes(value)) {
      errors.push(`${field}은(는) [${rule.enum.join(',')}] 중 하나여야 합니다`);
    }
  }
  return errors.length > 0 ? errors : null;
}

module.exports = { validate };
```

**사용 예시**:

```javascript
const { validate } = require('./_validate');

router.post('/api/po', async (req, res) => {
  const body = await ctx.readJSON(req);
  const errors = validate(body, {
    vendorName: { required: true, type: 'string' },
    poDate: { required: true, type: 'string' },
    items: { required: true },
  });
  if (errors) {
    ctx.apiError(res, 'VALIDATION_ERROR', errors.join(', '), 400);
    return;
  }
  // ...
});
```

---

### 4.9 Step 2 최종 폴더 구조

```
barunson-database-reference/user/
├── serve_inv2.js              ← ~300줄 (앱 초기화)
├── routes/
│   ├── _router.js             ← 라우터 (기존)
│   ├── _ctx.js                ← 컨텍스트 (기존)
│   ├── _response.js           ← 공통 응답 래퍼 (신규 Step 2-A)
│   ├── _config.js             ← 설정 로더 (신규 Step 2-B)
│   ├── _constants.js          ← 도메인 상수 (신규 Step 2-C)
│   ├── _validate.js           ← DTO 검증 (신규 Step 2-G)
│   ├── _utils.js              ← camelCase 변환 등 (신규 Step 2-A)
│   ├── auth.js                ← Step 1에서 분리
│   ├── products.js
│   ├── ... (15개 도메인 모듈)
│   └── wms-integration.js     ← WMS 연동 (별도 작업)
├── engines/
│   ├── state-machine.js       ← 경량 StateMachine (신규 Step 2-E)
│   ├── side-effects.js        ← 사이드이펙트 레지스트리 (신규 Step 2-E)
│   └── event-bus.js           ← 경량 EventBus (신규 Step 2-F)
├── adapters/
│   ├── index.js               ← 어댑터 팩토리 (신규 Step 2-D)
│   ├── xerp-inventory-adapter.js  ← XERP 어댑터 (신규 Step 2-D)
│   ├── wms-inventory-adapter.js   ← WMS 어댑터 (신규 Step 2-D)
│   └── dd-sales-adapter.js       ← DD MySQL 어댑터 (신규 Step 2-D)
├── ports/
│   ├── inventory-port.js      ← 재고 포트 인터페이스 (신규 Step 2-D)
│   └── shipment-port.js       ← 출고 포트 인터페이스 (신규 Step 2-D)
```

---

## 5. 실행 계획 (전체)

| Phase | 작업 | 소요 | 사전조건 |
|-------|------|------|---------|
| **Step 1** | | | |
| R1 | auth, admin, vendors, china 분리 | 1일 | 관리자 동결 합의 |
| R2 | products, inventory, auto-order, po 분리 | 1~2일 | R1 완료 |
| R3 | procurement, vendor-portal, post-process, accounting 분리 | 1~2일 | R2 완료 |
| R4 | sales, bom-mrp, reports 분리 | 1일 | R3 완료 |
| R5 | serve_inv2.js 정리 + 통합 검증 | 0.5일 | R4 완료 |
| **Step 2** | | | |
| A1 | _response.js + _utils.js (API 규격 통일) | 0.5일 | Step 1 완료 |
| A2 | system_configs 테이블 + _config.js (데이터드리븐) | 0.5일 | A1 완료 |
| A3 | _constants.js (No Hardcoding) | 0.5일 | A2 완료 |
| A4 | engines/ (StateMachine + EventBus + SideEffects) | 1~2일 | A3 완료 |
| A5 | adapters/ + ports/ (Port & Adapter) | 1~2일 | A4 완료 |
| A6 | _validate.js (DTO 검증) | 0.5일 | A1 완료 (병렬 가능) |
| A7 | 기존 모듈 점진적 전환 (신규 패턴 적용) | 2~3일 | A1~A5 완료 |
| **총계** | | **10~15일** | |

---

## 6. 성공 기준

### Step 1 완료 기준

- [ ] `serve_inv2.js` 300줄 이하
- [ ] 15개 라우트 모듈 완전 분리
- [ ] 298개 API 전부 동작 (응답 diff 0건)
- [ ] 에러 로그 0건

### Step 2 완료 기준

- [ ] system_configs 테이블 운영 중 (10개+ 설정)
- [ ] 공통 응답 래퍼 (apiSuccess/apiError) 신규 API 100% 적용
- [ ] StateMachine으로 PO/입고 상태 전이 처리
- [ ] Port & Adapter로 XERP ↔ WMS 재고 소스 전환 가능
- [ ] 하드코딩 매직넘버 0건 (신규 모듈 기준)
- [ ] WMS 연동 모듈 추가 준비 완료

### donald-duck 정합성 기준

| 원칙 | Step 2 완료 후 상태 |
|------|-------------------|
| 서버드리븐(SDUI) | N/A (ERP 백엔드 전용) |
| 데이터드리븐 | ✅ system_configs로 비즈니스 값 관리 |
| No Hardcoding | ✅ 매직넘버 → 설정 테이블 |
| Port & Adapter | ✅ XERP/WMS/DD 추상화 |
| StateMachine | ✅ 경량 엔진 (설정 기반 전이) |
| EventBus | ✅ 경량 in-process 이벤트 |
| API 규격 통일 | ✅ 3시스템 공통 응답/에러/camelCase |
| DTO 검증 | ✅ 경량 validate 헬퍼 |
| 도메인 격리 | ✅ 모듈별 파일 분리 + ctx 공유만 |
| camelCase | ✅ 신규 API 100%, 기존 점진적 전환 |

---

## 7. 위험 관리

| 위험 | 대응 |
|------|------|
| 관리자 동시 수정 → 충돌 | 동결 기간 합의, `refactor/module-split` 브랜치 |
| 분리 후 변수 스코프 문제 | ctx 통한 공유만 허용 |
| Step 2 과도 설계 | 신규 API만 먼저 적용, 기존 298개는 점진적 |
| StateMachine 전환 중 상태 불일치 | 기존 if/else 병행 운영 후 검증 완료 시 제거 |

---

## 8. 롤백 계획

```bash
# Step 1 롤백 (즉시)
git checkout main -- barunson-database-reference/user/serve_inv2.js
git checkout main -- barunson-database-reference/user/routes/

# Step 2 롤백 (엔진/어댑터만)
git checkout main -- barunson-database-reference/user/engines/
git checkout main -- barunson-database-reference/user/adapters/
git checkout main -- barunson-database-reference/user/ports/

# 서버 재시작
docker restart s-c-erp
```

---

## 부록: 관리자 전달 체크리스트

- [ ] 리팩토링 기간 (~2주) 동안 `serve_inv2.js` 수정 동결 가능한지
- [ ] `refactor/module-split` 브랜치 작업 → PR 머지 동의
- [ ] 기존 `routes/` 패턴(`_router.js`, `_ctx.js`) 그대로 사용 동의
- [ ] Step 2에서 `engines/`, `adapters/`, `ports/` 폴더 추가 동의
- [ ] `system_configs` 테이블 신규 생성 동의
- [ ] 리팩토링 후 코드 리뷰 참여
- [ ] Docker 재배포 일정 조율
