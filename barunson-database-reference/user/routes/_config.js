// routes/_config.js — 데이터드리븐 설정 로더 (system_configs 테이블)
// donald-duck의 system_configs (PostgreSQL JSONB)와 동일 패턴의 경량 구현

const ctx = require('./_ctx');

// 메모리 캐시 (서버 수명 동안 유지, invalidate로 갱신)
const _cache = new Map();

/**
 * system_configs 테이블 초기화 (서버 시작 시 1회 호출)
 */
function initConfigTables() {
  const { db } = ctx;
  if (!db) return;

  db.exec(`CREATE TABLE IF NOT EXISTS system_configs (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key   TEXT UNIQUE NOT NULL,
    config_value TEXT NOT NULL,
    description  TEXT DEFAULT '',
    is_active    INTEGER DEFAULT 1,
    version      INTEGER DEFAULT 1,
    updated_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_by   TEXT DEFAULT 'system'
  )`);

  db.exec(`CREATE TABLE IF NOT EXISTS config_history (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    config_key   TEXT NOT NULL,
    prev_value   TEXT,
    new_value    TEXT NOT NULL,
    changed_by   TEXT DEFAULT 'system',
    changed_at   TEXT DEFAULT (datetime('now','localtime'))
  )`);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_cfg_key ON system_configs(config_key)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cfgh_key ON config_history(config_key)`);
}

/**
 * 설정값 로드 (캐시 우선, DB fallback, fallback 기본값)
 * @param {string} key - 도트 네이밍 (예: "po.tolerancePct", "brand.labels")
 * @param {*} fallback - DB에 없을 때 기본값
 * @returns {*} JSON 파싱된 설정값
 */
function loadConfig(key, fallback = null) {
  if (_cache.has(key)) return _cache.get(key);

  const { db } = ctx;
  if (!db) return fallback;

  try {
    const row = db.prepare(
      'SELECT config_value FROM system_configs WHERE config_key = ? AND is_active = 1'
    ).get(key);

    if (!row) return fallback;

    const value = JSON.parse(row.config_value);
    _cache.set(key, value);
    return value;
  } catch (e) {
    console.warn(`[Config] loadConfig('${key}') 실패:`, e.message);
    return fallback;
  }
}

/**
 * 설정값 저장 (upsert + 히스토리 기록)
 * @param {string} key
 * @param {*} value - JSON 직렬화 가능한 값
 * @param {string} updatedBy - 변경자 (기본: 'system')
 */
function setConfig(key, value, updatedBy = 'system') {
  const { db } = ctx;
  if (!db) return;

  const json = JSON.stringify(value);

  try {
    const existing = db.prepare('SELECT config_value FROM system_configs WHERE config_key = ?').get(key);

    if (existing) {
      db.prepare(
        'INSERT INTO config_history (config_key, prev_value, new_value, changed_by) VALUES (?,?,?,?)'
      ).run(key, existing.config_value, json, updatedBy);

      db.prepare(
        "UPDATE system_configs SET config_value = ?, version = version + 1, updated_at = datetime('now','localtime'), updated_by = ? WHERE config_key = ?"
      ).run(json, updatedBy, key);
    } else {
      db.prepare(
        'INSERT INTO system_configs (config_key, config_value, updated_by) VALUES (?,?,?)'
      ).run(key, json, updatedBy);
    }

    _cache.set(key, value);
  } catch (e) {
    console.error(`[Config] setConfig('${key}') 실패:`, e.message);
  }
}

/**
 * 캐시 무효화
 * @param {string|null} key - null이면 전체 무효화
 */
function invalidateCache(key = null) {
  if (key) _cache.delete(key);
  else _cache.clear();
}

/**
 * 전체 설정 목록 조회 (관리 UI용)
 */
function listConfigs() {
  const { db } = ctx;
  if (!db) return [];
  try {
    return db.prepare('SELECT config_key, config_value, description, is_active, version, updated_at, updated_by FROM system_configs ORDER BY config_key').all();
  } catch (e) {
    return [];
  }
}

/**
 * 설정 히스토리 조회
 * @param {string} key
 * @param {number} limit
 */
function getConfigHistory(key, limit = 20) {
  const { db } = ctx;
  if (!db) return [];
  try {
    return db.prepare('SELECT * FROM config_history WHERE config_key = ? ORDER BY changed_at DESC LIMIT ?').all(key, limit);
  } catch (e) {
    return [];
  }
}

/**
 * 초기 시드 데이터 (테이블 비어있을 때만 삽입)
 */
function seedDefaults() {
  const { db } = ctx;
  if (!db) return;

  const count = db.prepare('SELECT COUNT(*) AS c FROM system_configs').get().c;
  if (count > 0) return; // 이미 데이터 있으면 스킵

  const seeds = [
    ['brand.labels', '{"BC":"바른손카드","BH":"바른손하이빌","TC":"더카드","DD":"디어디어","WC":"위시카드","BE":"바른에디션"}', '브랜드 코드 → 라벨 매핑'],
    ['origin.leadTime', '{"korea":{"days":7,"safetyMonths":0.5},"china":{"days":50,"safetyMonths":2},"dd":{"days":14,"safetyMonths":1}}', '원산지별 리드타임 및 안전재고 계수'],
    ['po.tolerancePct', '5.0', '입고 허용 오차 (±%)'],
    ['po.statuses', '{"DRAFT":"draft","SENT":"sent","PARTIAL":"partial","RECEIVED":"received","COMPLETED":"completed","CANCELLED":"cancelled"}', 'PO 상태값 정의'],
    ['auto_order.schedule', '"0 9 * * *"', '자동발주 CRON 스케줄'],
    ['xerp.siteCode', '"BK10"', 'XERP 사이트 코드'],
    ['xerp.inoutGubun', '{"SO":"SO","MO":"MO","SI":"SI","MI":"MI"}', 'XERP 입출고 구분 코드'],
    ['vendor_portal.tokenTtlDays', '90', '벤더포털 토큰 유효기간(일)'],
    ['wms.baseUrl', '"http://localhost:3000"', 'WMS 서버 URL'],
    ['wms.endpoints', '{"auth":"/api/platform/auth","products":"/api/platform/products","inventory":"/api/platform/inventory","outbound":"/api/platform/outbound","inbound":"/api/platform/inbound"}', 'WMS API 엔드포인트'],
  ];

  const ins = db.prepare('INSERT OR IGNORE INTO system_configs (config_key, config_value, description) VALUES (?,?,?)');
  for (const [key, value, desc] of seeds) {
    ins.run(key, value, desc);
  }
  console.log(`[Config] 초기 시드 데이터 ${seeds.length}건 삽입`);
}

module.exports = { initConfigTables, loadConfig, setConfig, invalidateCache, listConfigs, getConfigHistory, seedDefaults };
