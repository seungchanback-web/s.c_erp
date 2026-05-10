const _startTime = Date.now();
// ERP 애플리케이션 버전 (MANUAL.md / CHANGELOG.md 와 동기화)
const APP_VERSION = '1.1.2';
const APP_VERSION_DATE = '2026-04-23';
const APP_BUILD_ID = '2451c4a-bhc-fix';

// ── XERP 도메인 상수 ────────────────────────────────────────────────
// 매직 스트링 산재 방지 — SQL template literal / 하드코딩 분기에서 참조.
// SiteCode=BK10 (바른손 본사). DD 분기는 ItemCode LIKE 'DD%' 로 처리되므로 별도 상수 없음.
const XERP_SITE_CODE = 'BK10';
// 출고 구분 (mmInoutItem.InoutGubun) — 'SO' = Sales Out (출고)
const XERP_INOUT_GUBUN_SO = 'SO';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { URL } = require('url');
const zlib = require('zlib');
const pgAdapter = require('./pg-adapter');
const nodemailer = require('nodemailer');
const sql = require('mssql');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// ── 파일 로거 (일별 로테이션, 30일 보관) ────────────────────────────
const LOG_DIR = process.env.LOG_DIR || path.join(__dirname, 'logs');
if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });

function _logDate() { return new Date().toISOString().slice(0,10); }
function _logTime() { return new Date().toISOString().replace('T',' ').slice(0,19); }
let _logFileDate = _logDate();
let _accessStream = fs.createWriteStream(path.join(LOG_DIR, `access-${_logFileDate}.log`), { flags: 'a' });
let _errorStream  = fs.createWriteStream(path.join(LOG_DIR, `error-${_logFileDate}.log`),  { flags: 'a' });
let _appStream    = fs.createWriteStream(path.join(LOG_DIR, `app-${_logFileDate}.log`),    { flags: 'a' });

function _rotateIfNeeded() {
  const today = _logDate();
  if (today === _logFileDate) return;
  _logFileDate = today;
  _accessStream.end(); _errorStream.end(); _appStream.end();
  _accessStream = fs.createWriteStream(path.join(LOG_DIR, `access-${today}.log`), { flags: 'a' });
  _errorStream  = fs.createWriteStream(path.join(LOG_DIR, `error-${today}.log`),  { flags: 'a' });
  _appStream    = fs.createWriteStream(path.join(LOG_DIR, `app-${today}.log`),    { flags: 'a' });
  // 30일 이전 로그 삭제
  _cleanOldLogs();
}

function _cleanOldLogs() {
  const cutoff = Date.now() - 30 * 86400000;
  try {
    for (const f of fs.readdirSync(LOG_DIR)) {
      const m = f.match(/^(?:access|error|app)-(\d{4}-\d{2}-\d{2})\.log$/);
      if (m && new Date(m[1]).getTime() < cutoff) {
        fs.unlinkSync(path.join(LOG_DIR, f));
      }
    }
  } catch (_) {}
}

const logger = {
  access(method, url, status, ms, ip) {
    _rotateIfNeeded();
    const line = `${_logTime()} ${ip} ${method} ${url} ${status} ${ms}ms\n`;
    _accessStream.write(line);
  },
  info(msg, ...args) {
    _rotateIfNeeded();
    const line = `${_logTime()} [INFO] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`;
    _appStream.write(line);
    console.log(msg, ...args);
  },
  warn(msg, ...args) {
    _rotateIfNeeded();
    const line = `${_logTime()} [WARN] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`;
    _appStream.write(line);
    console.warn(msg, ...args);
  },
  error(msg, ...args) {
    _rotateIfNeeded();
    const line = `${_logTime()} [ERROR] ${msg} ${args.length ? JSON.stringify(args) : ''}\n`;
    _errorStream.write(line);
    _appStream.write(line);
    console.error(msg, ...args);
    // Slack 알림 (fire-and-forget, 실패해도 서버 영향 없음)
    try { slackError(msg, args); } catch(_) {}
  }
};
_cleanOldLogs(); // 서버 시작 시 1회 정리

// ── Slack Incoming Webhook 알림 ─────────────────────────────────
// SLACK_WEBHOOK_URL 환경변수가 설정되어 있을 때만 동작. 미설정 시 전부 no-op.
// 에러 알림은 중복 억제(dedupe) 및 rate limit 적용.
const _slackDedupe = new Map(); // key → lastSentTime
const SLACK_DEDUPE_MS = 5 * 60 * 1000; // 같은 에러는 5분에 1번만
let _slackWebhookUrl = ''; // 서버 시작 후 envVars 로드되면 채워짐

function _slackCleanupDedupe() {
  const cutoff = Date.now() - SLACK_DEDUPE_MS * 2;
  for (const [k, t] of _slackDedupe.entries()) {
    if (t < cutoff) _slackDedupe.delete(k);
  }
}

async function sendSlack(text, opts = {}) {
  if (!_slackWebhookUrl) return false;
  if (!text || typeof text !== 'string') return false;
  const payload = { text: text.slice(0, 3000) };
  if (opts.blocks) payload.blocks = opts.blocks;
  try {
    const https = require('https');
    const url = new URL(_slackWebhookUrl);
    const body = JSON.stringify(payload);
    return await new Promise((resolve) => {
      const req = https.request({
        method: 'POST',
        hostname: url.hostname,
        path: url.pathname + url.search,
        headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
        timeout: 5000
      }, (res) => {
        res.on('data', () => {});
        res.on('end', () => resolve(res.statusCode >= 200 && res.statusCode < 300));
      });
      req.on('error', () => resolve(false));
      req.on('timeout', () => { req.destroy(); resolve(false); });
      req.write(body);
      req.end();
    });
  } catch (_) { return false; }
}

function slackError(msg, args) {
  if (!_slackWebhookUrl) return;
  // 에러 메시지 필터: 너무 흔한 것들(요청 취소, ECONNRESET) 제외
  const full = String(msg) + ' ' + (args && args.length ? JSON.stringify(args).slice(0, 300) : '');
  if (/ECONNRESET|EPIPE|aborted|socket hang up/i.test(full)) return;
  // dedupe key: 앞 150자
  const key = full.slice(0, 150);
  const now = Date.now();
  if (_slackDedupe.has(key) && (now - _slackDedupe.get(key)) < SLACK_DEDUPE_MS) return;
  _slackDedupe.set(key, now);
  _slackCleanupDedupe();
  // fire-and-forget
  sendSlack(`🚨 *ERP 에러*\n\`\`\`${full.slice(0, 1500)}\`\`\``).catch(() => {});
}

// ── XERP MSSQL 연결 ─────────────────────────────────────────────────
let xerpPool = null;
let xerpUsageCache = null;
let xerpUsageCacheTime = 0;
let xerpInventoryCache = null;
let xerpInventoryCacheTime = 0;
let xerpInventoryCaches = {};     // { barunson: {data, time}, dd: {data, time} }
// In-memory 동기화 상태 (sync_log 테이블 없을 때 대체)
let inMemorySyncState = { running: false, done_at: null, count: 0, error: null };
let giftSetShipmentCache = {};    // { xerp_code: total_qty }
let giftSetShipmentCacheTime = 0;
// ── 매출관리 캐시 ──
let salesKpiCache = null, salesKpiCacheTime = 0;
const SALES_CACHE_TTL = 30 * 60 * 1000; // 30분
// ── 원가관리 캐시 ──
let costSummaryCache = null, costSummaryCacheTime = 0;
const COST_CACHE_TTL = 30 * 60 * 1000; // 30분
// ── 회계 모듈 캐시 ──
let acctStatsCache = null, acctStatsCacheTime = 0;
let trialBalanceCache = null, trialBalanceCacheTime = 0;
const ACCT_CACHE_TTL = 30 * 60 * 1000; // 30분
// ── 세금계산서 캐시 ──
let taxInvoiceSummaryCache = null, taxInvoiceSummaryCacheTime = 0;
const DEPT_GUBUN_LABELS = {'SB':'쇼핑몰B','BR':'바른손','ST':'스토어','SS':'쇼핑몰S','SA':'쇼핑몰A','OB':'기타B','DE':'기타'};
const BRAND_LABELS = {'B':'바른손카드','S':'비핸즈','C':'더카드','X':'디얼디어','W':'W카드','N':'네이처','I':'이니스','H':'비핸즈프리미엄','F':'플라워','D':'디자인카드','P':'프리미어','M':'모바일','G':'글로벌','U':'유니세프','Y':'유니크','K':'BK','T':'프리미어더카드','A':'기타'};
// .env를 여러 위치에서 탐색
const dotenvCandidates = [
  path.join(__dirname, '.env'),
  path.join(__dirname, '..', '.env'),
  path.join(__dirname, '..', '..', '.env')
];
const dotenvPath = dotenvCandidates.find(p => fs.existsSync(p)) || dotenvCandidates[1];
const envVars = {};
try {
  const envContent = fs.readFileSync(dotenvPath, 'utf8');
  envContent.replace(/\r/g, '').split('\n').forEach(line => {
    // KEY=VALUE 파싱 — KEY에 # 불허, VALUE는 전체 캡처 (# 포함)
    const eqIdx = line.indexOf('=');
    if (eqIdx < 0 || line.trimStart().startsWith('#')) return;
    const key = line.slice(0, eqIdx).trim();
    if (!key) return;
    let val = line.slice(eqIdx + 1).trim();
    // 따옴표 제거 (DB_PASSWORD="xxx#" 형태 지원)
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    envVars[key] = val;
  });
  console.log('환경변수 로드:', dotenvPath, '(DB_SERVER:', envVars.DB_SERVER ? 'OK' : 'missing', ')');
} catch (e) { console.warn('.env 로드 실패:', e.message); }

// Slack Webhook URL 활성화 (envVars 로드 완료 후)
_slackWebhookUrl = envVars.SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL || '';
if (_slackWebhookUrl) {
  console.log('[Slack] Webhook 활성화됨');
} else {
  console.log('[Slack] SLACK_WEBHOOK_URL 미설정 → 알림 비활성');
}

// 서버 크래시 감지 (uncaughtException / unhandledRejection)
process.on('uncaughtException', (err) => {
  console.error('[CRASH] uncaughtException:', err.message, err.stack);
  try { sendSlack(`💥 *ERP 서버 크래시 (uncaughtException)*\n\`\`\`${err.message}\n${(err.stack||'').slice(0, 1500)}\`\`\``); } catch(_){}
  // 바로 종료하지 않고 1초 대기 (Slack 전송 시간 확보)
  setTimeout(() => process.exit(1), 1000);
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : '';
  console.error('[CRASH] unhandledRejection:', msg, stack);
  try { sendSlack(`⚠️ *ERP unhandledRejection*\n\`\`\`${msg}\n${(stack||'').slice(0, 1500)}\`\`\``); } catch(_){}
});

const xerpConfig = {
  // XERP_DB_* 우선 (전용 readonly_erp 계정), 없으면 DB_* 로 fallback (레거시 운영환경 호환)
  server: envVars.XERP_DB_SERVER || process.env.XERP_DB_SERVER || envVars.DB_SERVER || process.env.DB_SERVER || '',
  port: parseInt(envVars.XERP_DB_PORT || process.env.XERP_DB_PORT || envVars.DB_PORT || process.env.DB_PORT || '1433'),
  user: envVars.XERP_DB_USER || process.env.XERP_DB_USER || envVars.DB_USER || process.env.DB_USER || '',
  password: envVars.XERP_DB_PASSWORD || process.env.XERP_DB_PASSWORD || envVars.DB_PASSWORD || process.env.DB_PASSWORD || '',
  database: 'XERP',
  options: { encrypt: true, trustServerCertificate: false, requestTimeout: 120000 },
  pool: { max: 5, min: 1, idleTimeoutMillis: 300000 }
};
// BHC(디얼디어)는 readonly_erp 접근 불가 → DB_USER(readonly_user) 우선, 없으면 xerpConfig 폴백
const bhcConfig = {
  server: envVars.DB_SERVER || process.env.DB_SERVER || xerpConfig.server,
  port: parseInt(envVars.DB_PORT || process.env.DB_PORT) || xerpConfig.port,
  user: envVars.DB_USER || process.env.DB_USER || xerpConfig.user,
  password: envVars.DB_PASSWORD || process.env.DB_PASSWORD || xerpConfig.password,
  database: 'BHC',
  options: { encrypt: true, trustServerCertificate: false, requestTimeout: 120000 },
  pool: { max: 3, min: 0, idleTimeoutMillis: 60000 }
};

// 재고 조회 시 특정 창고만 필터링 — 미설정이면 전체 창고 합산 (legacy 동작).
// 사용자가 "파주물류센터(제품)" 한 창고만 보고 싶다고 해서 도입. WhCode 정확값은
//   GET /api/debug/xerp-warehouses 로 조회 후 .env 에 XERP_INV_WAREHOUSE=<code> 설정.
//   여러 창고 합산이 필요하면 콤마로 구분 (예: 'MF24,MF14').
const XERP_INV_WAREHOUSE = (envVars.XERP_INV_WAREHOUSE || process.env.XERP_INV_WAREHOUSE || '').trim();
const XERP_INV_WH_LIST = XERP_INV_WAREHOUSE ? XERP_INV_WAREHOUSE.split(',').map(s => s.trim()).filter(Boolean) : [];
if (XERP_INV_WH_LIST.length > 0) console.log(`[xerp-inv] 창고 필터 활성: WhCode IN (${XERP_INV_WH_LIST.join(', ')})`);
else console.log('[xerp-inv] 창고 필터 미설정 — 전체 창고 합산');

// bar_shop1 전용 config — DB_* (readonly_user) 사용. server 는 XERP 와 동일 인스턴스지만
// SQL 로그인이 달라서 (readonly_user vs readonly_erp) 별도 관리.
// 기존엔 `{...xerpConfig, database: 'bar_shop1'}` 로 덮어써서 readonly_erp 가 bar_shop1 접근 권한 없으면 실패.
const barShopConfig = {
  server: envVars.DB_SERVER || process.env.DB_SERVER || xerpConfig.server,
  port: parseInt(envVars.DB_PORT || process.env.DB_PORT) || xerpConfig.port,
  user: envVars.DB_USER || process.env.DB_USER || xerpConfig.user,
  password: envVars.DB_PASSWORD || process.env.DB_PASSWORD || xerpConfig.password,
  database: 'bar_shop1',
  options: { encrypt: true, trustServerCertificate: false, requestTimeout: 120000 },
  pool: { max: 3, min: 1, idleTimeoutMillis: 300000 }
};

let xerpReconnectTimer = null;
let xerpReconnectAttempts = 0;
const XERP_MAX_RECONNECT_DELAY = 300000; // 최대 5분

async function connectXERP() {
  if (!xerpConfig.server) { console.warn('XERP: DB_SERVER 미설정 → 출고현황 비활성'); return false; }
  try {
    // 기존 풀 + 글로벌 풀 정리 (stale 상태 방지)
    if (xerpPool) { try { await xerpPool.close(); } catch(_){} xerpPool = null; }
    try { await sql.close(); } catch(_){} // 글로벌 풀도 정리
    xerpPool = await sql.connect(xerpConfig);
    xerpReconnectAttempts = 0;
    console.log(`XERP 데이터베이스 연결 완료 (user: ${xerpConfig.user})`);

    // XERP 품목명 캐시 로딩 (비동기, 백그라운드)
    loadXerpItemNames().catch(e => console.warn('XERP 품목명 캐시 실패:', e.message));

    // 연결 에러 이벤트 → 자동 재연결
    xerpPool.on('error', (err) => {
      console.error('XERP 연결 끊김:', err.message);
      xerpPool = null;
      scheduleXerpReconnect();
    });
    return true;
  } catch (e) {
    console.warn(`XERP 연결 실패 (시도 ${xerpReconnectAttempts + 1}):`, e.message);
    xerpPool = null;
    return false;
  }
}

// XERP 품목코드→품목명 캐시 (수불원장용, 서버 시작 시 1회 로딩)
let xerpItemNameCache = {};
async function loadXerpItemNames() {
  if (!xerpPool) return;
  const cache = {};
  try {
    // 1) poOrderItem에서 품목명 (717개+, 가장 신뢰성 높음)
    const poResult = await xerpPool.request().query(`
      SELECT RTRIM(ItemCode) AS ic, MAX(RTRIM(ItemName)) AS nm
      FROM poOrderItem WITH (NOLOCK)
      WHERE SiteCode = '${XERP_SITE_CODE}'
        AND ItemName IS NOT NULL AND LEN(RTRIM(ItemName)) > 0
      GROUP BY RTRIM(ItemCode)
    `);
    for (const r of poResult.recordset) {
      const code = (r.ic||'').trim();
      const name = (r.nm||'').trim();
      if (code && name) cache[code] = name;
    }
    console.log(`XERP 품목명 캐시(poOrderItem): ${Object.keys(cache).length}개`);
  } catch(e) { console.warn('poOrderItem 품목명 로딩 실패:', e.message); }
  // mmInoutItem은 40M건으로 GROUP BY 쿼리가 타임아웃됨 — poOrderItem만 사용
  // 향후 품목 마스터 테이블 별도 구축 필요
  xerpItemNameCache = cache;
  console.log(`XERP 품목명 캐시 총: ${Object.keys(cache).length}개 품목`);
}

function scheduleXerpReconnect() {
  if (xerpReconnectTimer) return; // 이미 스케줄됨
  xerpReconnectAttempts++;
  // 지수 백오프: 5s, 10s, 20s, 40s ... 최대 5분
  const delay = Math.min(5000 * Math.pow(2, xerpReconnectAttempts - 1), XERP_MAX_RECONNECT_DELAY);
  console.log(`XERP 재연결 예약: ${Math.round(delay/1000)}초 후 (시도 #${xerpReconnectAttempts})`);
  xerpReconnectTimer = setTimeout(async () => {
    xerpReconnectTimer = null;
    const ok = await connectXERP();
    if (!ok) scheduleXerpReconnect();
  }, delay);
}

// 요청 시 풀 상태 확인 + 자동 복구 헬퍼
async function ensureXerpPool() {
  if (xerpPool && xerpPool.connected) return xerpPool;
  // 연결 없으면 즉시 재연결 시도
  const ok = await connectXERP();
  if (ok) return xerpPool;
  return null;
}

// 초기 연결 (서버 기동 후 백그라운드에서 실행 — Docker 헬스체크 타임아웃 방지)
function initXERP() {
  setTimeout(async () => {
    const ok = await connectXERP();
    if (!ok) scheduleXerpReconnect();
  }, 1000);
}

// ── DD (디얼디어) MySQL 연결 ─────────────────────────────────────────
let ddPool = null;
const ddConfig = {
  host: envVars.DD_DB_SERVER || process.env.DD_DB_SERVER || '',
  port: parseInt(envVars.DD_DB_PORT || process.env.DD_DB_PORT || '3306'),
  user: envVars.DD_DB_USER || process.env.DD_DB_USER || '',
  password: envVars.DD_DB_PASSWORD || process.env.DD_DB_PASSWORD || '',
  database: 'wedding',
  charset: 'utf8mb4',
  waitForConnections: true,
  connectionLimit: 3,
  queueLimit: 0
};

async function ensureDdPool() {
  if (ddPool) return ddPool;
  if (!ddConfig.host) { console.warn('DD: DD_DB_SERVER 미설정'); return null; }
  try {
    const mysql = require('mysql2/promise');
    ddPool = await mysql.createPool(ddConfig);
    // 연결 테스트
    const [rows] = await ddPool.query('SELECT 1');
    console.log('DD(디얼디어) MySQL 연결 완료');
    return ddPool;
  } catch(e) {
    console.warn('DD MySQL 연결 실패:', e.message);
    ddPool = null;
    return null;
  }
}

// DD 초기 연결 (서버 기동 후 백그라운드에서 실행)
function initDD() {
  setTimeout(async () => {
    if (ddConfig.host) await ensureDdPool();
    else console.log('ℹ DD_DB_SERVER 미설정 → DD 동기화 비활성');
  }, 2000);
}

// ── Google Sheet 동기화 (Apps Script 웹앱 방식) ─────────────────────
const APPS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbwwhOP9gtC-8l6BFSRRJFwv2UrnYCtXxvaD9_NBHcWTsKuGl3Hlk5qqdCxnla-gxHMa/exec';
let gAccessToken = null;
let gRefreshToken = null;
let gClientId = null;
let gClientSecret = null;
let gTokenExpiry = 0;

function refreshGoogleToken() {
  return new Promise((resolve) => {
    if (!gRefreshToken || !gClientId || !gClientSecret) { resolve(false); return; }
    const postData = `client_id=${gClientId}&client_secret=${gClientSecret}&refresh_token=${gRefreshToken}&grant_type=refresh_token`;
    const req = https.request({
      hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(postData) }
    }, (resp) => {
      let data = '';
      resp.on('data', c => data += c);
      resp.on('end', () => {
        try {
          const d = JSON.parse(data);
          if (d.access_token) {
            gAccessToken = d.access_token;
            gTokenExpiry = Date.now() + (d.expires_in || 3600) * 1000 - 60000;
            console.log('Google 토큰 갱신 완료');
            resolve(true);
          } else { console.warn('토큰 갱신 실패:', data.substring(0, 200)); resolve(false); }
        } catch (e) { resolve(false); }
      });
    });
    req.on('error', () => resolve(false));
    req.write(postData);
    req.end();
  });
}

async function ensureGoogleToken() {
  if (!gRefreshToken) return false;
  if (gAccessToken && Date.now() < gTokenExpiry) return true;
  return await refreshGoogleToken();
}

(async function initGoogleAuth() {
  try {
    const clasprc = JSON.parse(fs.readFileSync(path.join(process.env.USERPROFILE || process.env.HOME, '.clasprc.json'), 'utf8'));
    const tokens = clasprc.tokens.default;
    gAccessToken = tokens.access_token;
    gRefreshToken = tokens.refresh_token;
    gClientId = tokens.client_id;
    gClientSecret = tokens.client_secret;
    gTokenExpiry = tokens.expiry_date || 0;
    // 토큰 만료 시 즉시 갱신
    if (Date.now() >= gTokenExpiry) {
      await refreshGoogleToken();
    }
    console.log('Google Sheet 동기화 준비 완료 (Apps Script 웹앱)');
  } catch (e) {
    console.warn('Google 인증 초기화 실패 (시트 동기화 비활성):', e.message);
  }
})();

async function appendToGoogleSheet(rows) {
  await ensureGoogleToken();
  return new Promise((resolve) => {
    if (!gAccessToken || !rows.length) { resolve({ ok: false, error: 'not ready' }); return; }
    const body = JSON.stringify({ rows });
    const bodyBuf = Buffer.from(body, 'utf8');
    const u = new URL(APPS_SCRIPT_URL);

    function doRequest(urlObj, redirectCount, method) {
      if (redirectCount > 5) { resolve({ ok: false, error: 'too many redirects' }); return; }
      const isPOST = method === 'POST';
      const options = {
        hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: method,
        headers: { 'Authorization': 'Bearer ' + gAccessToken }
      };
      if (isPOST) {
        options.headers['Content-Type'] = 'application/json; charset=utf-8';
        options.headers['Content-Length'] = bodyBuf.length;
      }
      const req = https.request(options, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          // Apps Script: POST→302→GET (standard HTTP redirect behavior)
          doRequest(new URL(resp.headers.location), redirectCount + 1, 'GET');
          resp.resume();
          return;
        }
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve({ ok: false, error: 'parse error', status: resp.statusCode, raw: data.substring(0, 300) }); }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      if (isPOST) req.write(bodyBuf);
      req.end();
    }
    doRequest(u, 0, 'POST');
  });
}

async function cancelInGoogleSheet(productCodes, orderDate) {
  await ensureGoogleToken();
  return new Promise((resolve) => {
    if (!gAccessToken || !productCodes.length) { resolve({ ok: false, error: 'not ready' }); return; }
    const body = JSON.stringify({ action: 'cancel', product_codes: productCodes, order_date: orderDate || '' });
    const bodyBuf = Buffer.from(body, 'utf8');
    const u = new URL(APPS_SCRIPT_URL);

    function doRequest(urlObj, redirectCount, method) {
      if (redirectCount > 5) { resolve({ ok: false, error: 'too many redirects' }); return; }
      const isPOST = method === 'POST';
      const options = {
        hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method: method,
        headers: { 'Authorization': 'Bearer ' + gAccessToken }
      };
      if (isPOST) {
        options.headers['Content-Type'] = 'application/json; charset=utf-8';
        options.headers['Content-Length'] = bodyBuf.length;
      }
      const req = https.request(options, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          doRequest(new URL(resp.headers.location), redirectCount + 1, 'GET');
          resp.resume();
          return;
        }
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          try { resolve(JSON.parse(data)); } catch (e) { resolve({ ok: false, error: 'parse error' }); }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message }));
      if (isPOST) req.write(bodyBuf);
      req.end();
    }
    doRequest(u, 0, 'POST');
  });
}

// ── 이메일 발송 (nodemailer SMTP + Apps Script 폴백) ────────────────
const PORTAL_SECRET = 'barun-company-portal-2026';
const TEST_EMAIL = 'seungchan.back@barunn.net'; // 테스트용 — 모든 이메일 여기로
const BASE_URL = envVars.BASE_URL || process.env.BASE_URL || (() => {
  const ni = require('os').networkInterfaces();
  for (const addrs of Object.values(ni)) {
    for (const a of addrs) { if (a.family === 'IPv4' && !a.internal) return `http://${a.address}:12026`; }
  }
  return 'http://localhost:12026';
})();

// SMTP 설정 (.env에서 로드)
const SMTP_USER = envVars.SMTP_USER || process.env.SMTP_USER || '';       // Gmail 주소
const SMTP_PASS = envVars.SMTP_PASS || process.env.SMTP_PASS || '';       // Gmail 앱 비밀번호 (16자리)
const SMTP_FROM = envVars.SMTP_FROM || process.env.SMTP_FROM || SMTP_USER;

// Google OAuth 설정
const GOOGLE_CLIENT_ID = envVars.GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '';
const ALLOWED_EMAIL_DOMAINS = (envVars.ALLOWED_EMAIL_DOMAINS || process.env.ALLOWED_EMAIL_DOMAINS || 'barunn.net').split(',').map(d => d.trim());
if (GOOGLE_CLIENT_ID) console.log('✅ Google OAuth 설정됨 (허용 도메인:', ALLOWED_EMAIL_DOMAINS.join(', '), ')');
else console.log('ℹ️ GOOGLE_CLIENT_ID 미설정 — .env에 추가하면 Google 로그인 활성화');

let smtpTransporter = null;
if (SMTP_USER && SMTP_PASS) {
  smtpTransporter = nodemailer.createTransport({
    service: 'gmail',
    auth: { user: SMTP_USER, pass: SMTP_PASS }
  });
  smtpTransporter.verify().then(() => {
    console.log('✅ SMTP(Gmail) 이메일 발송 준비 완료');
  }).catch(err => {
    console.warn('⚠️ SMTP 연결 실패:', err.message);
    smtpTransporter = null;
  });
} else {
  console.log('ℹ️ SMTP 미설정 — .env에 SMTP_USER, SMTP_PASS 추가 필요 (Gmail 앱 비밀번호)');
}

// P2-13: JWT 기반 거래처 토큰 (기존 해시 폴백 유지)
const VENDOR_JWT_SECRET = envVars.VENDOR_JWT_SECRET || (() => {
  const vendorSecretPath = path.join(__dirname, '.vendor_jwt_secret');
  try { return fs.readFileSync(vendorSecretPath, 'utf8').trim(); }
  catch {
    const s = crypto.randomBytes(32).toString('hex');
    try { fs.writeFileSync(vendorSecretPath, s, 'utf8'); } catch(_){}
    return s;
  }
})();

function generateVendorTokenLegacy(email) {
  return crypto.createHash('sha256').update(email + PORTAL_SECRET).digest('hex').slice(0, 16);
}

function generateVendorToken(email, vendorName) {
  try {
    return jwt.sign({ email, name: vendorName || '', type: 'vendor' }, VENDOR_JWT_SECRET, { expiresIn: '90d' });
  } catch (e) {
    console.warn('JWT 생성 실패, 레거시 토큰 사용:', e.message);
    return generateVendorTokenLegacy(email);
  }
}

function decodeVendorToken(token) {
  try {
    const decoded = jwt.verify(token, VENDOR_JWT_SECRET);
    if (decoded && decoded.type === 'vendor') return decoded;
  } catch (_) {}
  return null;
}

function verifyVendorToken(email, token) {
  // 1. JWT 검증 시도 (access 토큰: email 파라미터 없이 토큰만으로 검증)
  const decoded = decodeVendorToken(token);
  if (decoded) {
    if (!email) return true;
    if (decoded.email === email) return true;
  }
  // 2. 레거시 해시 토큰 폴백 (하위 호환)
  if (email) return generateVendorTokenLegacy(email) === token;
  return false;
}

// vendor-portal 공통 인증 헬퍼
// 2026-04: 외부 접근 차단 후 — 진입점(미들웨어)에서 관리자 JWT 필수로 검증하므로
//          여기서는 단순히 params 에서 email/vendor_name 만 뽑아 전달.
function extractVendorAuth(params) {
  const email = params.email || '';
  const vendorName = params.vendor_name || '';
  if (!email) return null;
  return { email, vendorName, token: '' };
}

// product_info 데이터 (원자재코드, 원재료명, 절, 후공정업체 조회용)
// 1차 소스: products + product_post_vendor DB 테이블
// 2차 폴백: product_info.json 파일 (레거시)
let productInfoCache = null;
let _productInfoReloadScheduled = false;

const _POST_COL_TO_KR = {
  thomson: '톰슨',
  envelope: '봉투가공',
  seari: '세아리',
  laser: '레이져',
  cutting: '재단',
  silk: '실크',
};

async function reloadProductInfoFromDB() {
  try {
    const products = await db.prepare("SELECT product_code, material_code, material_name, cut_spec, jopan, paper_maker, product_spec, thomson, envelope, seari, laser, cutting, silk FROM products").all();
    let ppv = [];
    // 봉투가공은 항상 마지막 — step_order 보다 우선
    try { ppv = await db.prepare("SELECT product_code, process_type, vendor_name, step_order FROM product_post_vendor ORDER BY product_code, CASE WHEN process_type='봉투가공' THEN 1 ELSE 0 END, step_order").all(); } catch(_) {}
    const ppvByCode = {};
    const ppvStepsByCode = {};
    for (const r of ppv) {
      if (!r.product_code) continue;
      if (!ppvByCode[r.product_code]) ppvByCode[r.product_code] = {};
      if (!ppvStepsByCode[r.product_code]) ppvStepsByCode[r.product_code] = [];
      if (r.process_type && r.vendor_name) {
        ppvByCode[r.product_code][r.process_type] = r.vendor_name;
        ppvStepsByCode[r.product_code].push({ step: r.step_order || 1, process: r.process_type, vendor: r.vendor_name });
      }
    }
    // 후공정 타입 목록 (이 키들은 product_post_vendor에서만 관리)
    let postProcessTypes = ['재단','인쇄','박/형압','톰슨','단면접착','우찌누끼','접지','코팅','봉투가공'];
    try { const pt = await getPostProcessTypes(); if (pt.length) postProcessTypes = pt; } catch(_) {}
    const postTypeSet = new Set(postProcessTypes);

    // 레거시 JSON은 기본정보(원자재코드 등)의 폴백으로만 사용 — 후공정 필드는 무시
    let legacy = {};
    try { legacy = JSON.parse(fs.readFileSync(path.join(__dir, 'product_info.json'), 'utf8')); } catch(_) {}
    const out = {};
    // 레거시에서 기본정보만 복사 (후공정 키는 제외)
    for (const code in legacy) {
      const row = {};
      for (const [k, v] of Object.entries(legacy[code] || {})) {
        if (!postTypeSet.has(k)) row[k] = v;
      }
      out[code] = row;
    }
    // DB products 테이블로 override (단일 소스)
    // 레거시 후공정 컬럼(thomson/envelope/...) 매핑 — product_post_vendor 가 비었을 때 폴백용
    const LEGACY_POST_ORDER = [
      { col: 'cutting',  kr: '재단' },
      { col: 'thomson',  kr: '톰슨' },
      { col: 'envelope', kr: '봉투가공' },
      { col: 'seari',    kr: '세아리' },
      { col: 'laser',    kr: '레이져' },
      { col: 'silk',     kr: '실크' },
    ];
    const legacyStepsByCode = {};
    for (const p of products) {
      const code = p.product_code;
      if (!code) continue;
      const row = out[code] || {};
      if (p.material_code) row['원자재코드'] = p.material_code;
      if (p.material_name) row['원재료용지명'] = p.material_name;
      if (p.paper_maker) row['제지사'] = p.paper_maker;
      if (p.cut_spec !== null && p.cut_spec !== undefined && p.cut_spec !== '') row['절'] = String(p.cut_spec);
      if (p.jopan !== null && p.jopan !== undefined && p.jopan !== '') row['조판'] = String(p.jopan);
      if (p.product_spec) row['제품사양'] = p.product_spec;
      // 레거시 후공정 키가 남아있으면 제거
      for (const pt of postProcessTypes) { delete row[pt]; }
      out[code] = row;
      // 레거시 products 컬럼에서 후공정 체인 수집 (polluted 값 '0' 제외)
      const steps = [];
      let stepOrder = 1;
      for (const { col, kr } of LEGACY_POST_ORDER) {
        const v = (p[col] || '').trim ? p[col].trim() : p[col];
        if (v && v !== '0') {
          steps.push({ step: stepOrder++, process: kr, vendor: v });
        }
      }
      if (steps.length) legacyStepsByCode[code] = steps;
    }
    // product_post_vendor가 유일한 후공정 소스 (사용자가 품목관리에서 관리)
    for (const [code, ptMap] of Object.entries(ppvByCode)) {
      if (!out[code]) out[code] = {};
      for (const [pt, vn] of Object.entries(ptMap)) out[code][pt] = vn;
      // step_order 기반 정렬 + 봉투가공은 항상 최후미로 강제 (입고처 lookup 정확성)
      // step_order 가 중간으로 입력된 품목에서도 후공정 순서 일관성 유지.
      if (ppvStepsByCode[code]?.length) {
        out[code]._steps = ppvStepsByCode[code].sort((a, b) => {
          if (a.process==='봉투가공' && b.process!=='봉투가공') return 1;
          if (b.process==='봉투가공' && a.process!=='봉투가공') return -1;
          return a.step - b.step;
        });
      }
    }
    // product_post_vendor 에 항목 없는 품목은 레거시 products 컬럼으로 _steps 폴백
    for (const [code, legacySteps] of Object.entries(legacyStepsByCode)) {
      if (!out[code]) out[code] = {};
      if (!out[code]._steps || !out[code]._steps.length) {
        out[code]._steps = legacySteps;
        // 공정명→업체 역 매핑도 pi[공정명] = 업체 형태로 보강
        for (const s of legacySteps) {
          if (!out[code][s.process]) out[code][s.process] = s.vendor;
        }
      }
    }
    productInfoCache = out;
    console.log(`[product_info] DB 재로드 완료: ${Object.keys(out).length}개 품목`);
  } catch (e) {
    console.warn('[product_info] DB 재로드 실패:', e.message);
    // DB 실패 시 레거시 JSON으로라도 초기화
    if (!productInfoCache) {
      try { productInfoCache = JSON.parse(fs.readFileSync(path.join(__dir, 'product_info.json'), 'utf8')); }
      catch (_) { productInfoCache = {}; }
    }
  }
}

let _lastProductInfoReloadAt = 0;
function scheduleProductInfoReload() {
  if (_productInfoReloadScheduled) return;
  // bulk-import 처럼 연속 write 가 들어오면 300ms 디바운스만으로는 과호출.
  // 1.5s 로 늘려 burst 를 한 번에 흡수. 사용자 체감 딜레이는 여전히 < 2s.
  _productInfoReloadScheduled = true;
  setTimeout(async () => {
    _productInfoReloadScheduled = false;
    // 최근 5초 안에 이미 재로드했으면 스킵 — bulk 흐름에서 중복 스캔 방지
    if (Date.now() - _lastProductInfoReloadAt < 5000) return;
    await reloadProductInfoFromDB();
    _lastProductInfoReloadAt = Date.now();
  }, 1500);
}

function getProductInfo() {
  if (productInfoCache) return productInfoCache;
  // 첫 호출 — 레거시 파일에서 기본정보만 로드 (후공정 키는 즉시 제거)
  const _defaultPostTypes = ['재단','인쇄','박/형압','톰슨','봉투가공','단면접착','우찌누끼','접지','코팅'];
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(__dir, 'product_info.json'), 'utf8'));
    const cleaned = {};
    for (const code in raw) {
      const row = {};
      for (const [k, v] of Object.entries(raw[code] || {})) {
        if (!_defaultPostTypes.includes(k)) row[k] = v;
      }
      cleaned[code] = row;
    }
    productInfoCache = cleaned;
  } catch (e) { productInfoCache = {}; }
  scheduleProductInfoReload();
  return productInfoCache;
}

// 업체+제품코드 직전 단가 조회 (최신 승인/확인 거래명세서에서)
async function getLastVendorPrice(vendorName, productCode) {
  try {
    const docs = await db.prepare(`SELECT items_json, vendor_modified_json FROM trade_document
      WHERE vendor_name=? AND status IN ('vendor_confirmed','approved')
      ORDER BY id DESC LIMIT 10`).all(vendorName);
    for (const doc of docs) {
      const modified = doc.vendor_modified_json ? JSON.parse(doc.vendor_modified_json) : null;
      const items = JSON.parse(doc.items_json || '[]');
      for (let i = 0; i < items.length; i++) {
        if (items[i].product_code === productCode) {
          const price = modified && modified[i] ? modified[i].unit_price : items[i].unit_price;
          if (price && price > 0) return price;
        }
      }
    }
  } catch(e) {}
  // 후공정 단가 마스터에서도 조회
  try {
    const pp = await db.prepare(`SELECT unit_price FROM post_process_price WHERE vendor_name=? AND unit_price>0 ORDER BY id DESC LIMIT 1`).get(vendorName);
    if (pp) return pp.unit_price;
  } catch(e) {}
  return 0;
}

// PO 활동 로그 기록
async function logPOActivity(poId, action, opts = {}) {
  const po = await db.prepare('SELECT po_number, status, material_status, process_status FROM po_header WHERE po_id=?').get(poId);
  if (!po) return;
  await db.prepare(`INSERT INTO po_activity_log (po_id, po_number, action, actor, actor_type, from_status, to_status, from_material_status, to_material_status, from_process_status, to_process_status, details) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`)
    .run(
      poId, po.po_number, action,
      opts.actor || '', opts.actor_type || 'system',
      opts.from_status || po.status, opts.to_status || '',
      opts.from_mat || po.material_status || '', opts.to_mat || '',
      opts.from_proc || po.process_status || '', opts.to_proc || '',
      opts.details || ''
    );
}

// 이메일 발송: SMTP 우선, Apps Script 폴백
// 2026-04: 거래처 포털 링크 제거. PDF 첨부 + 이메일 회신/전화 안내로 변경.
// 2026-04: DD 법인 발주는 '바른디자인' 명의로 발송 (바른컴퍼니 아님)
async function sendPOEmail(po, items, vendorEmail, vendorName, isPostProcess, emailCc) {

  const pInfo = getProductInfo();

  // 법인별 발송 명의 분기
  const isDD = (po.legal_entity === 'dd');
  const SENDER_COMPANY = isDD ? '바른디자인' : '바른컴퍼니';

  const typeLabel = isPostProcess ? '후공정' : '원재료';
  const subject = `[${SENDER_COMPANY}] ${typeLabel} 발주서 - ${po.po_number} (${vendorName})`;

  // 품목별 product_info 매핑 + 연(R) 계산: 발주수량 / 500 / 절 / 조판
  // parseJeolServer: 'T3K'→3, '3TK'→3 등 문자열에서 절 숫자 추출
  const parseJeolServer = (val) => {
    if (!val) return 0;
    const n = parseFloat(val);
    if (!isNaN(n) && n > 0) return n;
    const m = String(val).match(/(\d+)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const enrichedItems = items.map(it => {
    const pi = pInfo[it.product_code] || {};
    const cut = parseJeolServer(pi['절']) || 1;
    const jopan = parseJeolServer(pi['조판']) || 1;
    const qty = it.ordered_qty || 0;
    const reams = qty / 500 / cut / jopan;
    const reamsStr = reams % 1 === 0 ? String(reams) : reams.toFixed(1);
    // 제품별 후공정 체인 (step_order 순 + 봉투가공 후미) — 공정 포함: 코리아(톰슨) → 예지가(봉투가공)
    // 동일 (업체,공정) 중복만 제거; 같은 업체가 여러 공정을 맡으면 모두 노출
    let itemChainText = '';
    const steps = (pi._steps && pi._steps.length)
      ? pi._steps.slice().sort((a,b)=> {
          if (a.process==='봉투가공' && b.process!=='봉투가공') return 1;
          if (b.process==='봉투가공' && a.process!=='봉투가공') return -1;
          return (a.step||0) - (b.step||0);
        })
      : [];
    if (steps.length) {
      const seen = new Set();
      const parts = [];
      for (const s of steps) {
        if (!s.vendor) continue;
        const key = s.vendor + '||' + (s.process || '');
        if (seen.has(key)) continue;
        seen.add(key);
        parts.push(s.process ? `${s.vendor}(${s.process})` : s.vendor);
      }
      itemChainText = parts.join(' → ');
    }
    // 규격 폴백: po_items.spec 우선 → 절/조판 조합 → 제품사양 (원재료 발주서는 종이 규격이 우선)
    let specText = (it.spec && String(it.spec).trim()) ? String(it.spec).trim() : '';
    if (!specText && pi['절'] && pi['조판']) specText = `${pi['절']}절 ${pi['조판']}조판`;
    if (!specText && pi['제품사양']) specText = pi['제품사양'];
    // 입고처 = 현재 공정의 다음 단계 업체 (마지막 단계면 자사창고 '바른손')
    // _steps 는 step_order + 봉투가공 후미 정렬이 적용된 상태로 들어옴 (app.html / serve 양쪽 동일 규칙)
    let nextVendor = '바른손';
    if (steps && steps.length) {
      const cur = (it.process_type || '').trim();
      const idx = steps.findIndex(s => (s.process || '').trim() === cur);
      if (idx >= 0 && idx < steps.length - 1) {
        const nx = steps[idx + 1];
        if (nx && nx.vendor) nextVendor = nx.vendor;
      }
    }
    return {
      ...it,
      material_code: pi['원자재코드'] || '',
      // 원재료명: 규격 컬럼이 별도로 존재하므로 it.spec fallback 제거 (중복 표시 방지)
      material_name: pi['원재료용지명'] || '',
      cut_spec: pi['절'] || '',
      ream_qty: reamsStr,
      item_chain: itemChainText,
      spec_display: specText,
      next_vendor: nextVendor,
    };
  });

  // 원재료/후공정 구분
  const isRawMaterial = !isPostProcess;

  // 후공정: 품목별 process_type → 담당자 매핑 (process_assignee 테이블)
  // 같은 업체의 같은 공정에 담당자 여러 명 가능 — 모두 CC, 섹션 헤더에 이름만 나열
  const assigneesByProcess = {};  // { process_type: [{name, email, phone}, ...] }
  const autoCcEmails = [];
  if (isPostProcess) {
    const uniqProcs = [...new Set(enrichedItems.map(it => (it.process_type || '').trim()).filter(Boolean))];
    if (uniqProcs.length) {
      try {
        const placeholders = uniqProcs.map(() => '?').join(',');
        const rows = await db.prepare(`SELECT process_type, assignee_name, assignee_email, phone
          FROM process_assignee
          WHERE vendor_name=? AND process_type IN (${placeholders}) AND is_active=1
          ORDER BY process_type, assignee_name`).all(vendorName, ...uniqProcs);
        for (const r of rows) {
          if (!assigneesByProcess[r.process_type]) assigneesByProcess[r.process_type] = [];
          assigneesByProcess[r.process_type].push({ name: r.assignee_name || '', email: r.assignee_email || '', phone: r.phone || '' });
          if (r.assignee_email) autoCcEmails.push(r.assignee_email.trim());
        }
      } catch (e) {
        console.warn('[process_assignee 조회 실패]', e.message);
      }
    }
  }

  // 원재료: 다음 입고처(후공정 업체) — 제품별 체인을 합쳐 헤더 요약으로 사용
  let nextDestinations = [];
  if (isRawMaterial) {
    const seen = new Set();
    for (const it of enrichedItems) {
      if (it.item_chain && !seen.has(it.item_chain)) {
        seen.add(it.item_chain);
        nextDestinations.push(it.item_chain);
      }
    }
    // 제품별 체인이 하나도 없으면 기존 방식(같은 날짜 후공정 vendor) 폴백
    if (!nextDestinations.length && po.po_date) {
      const postPOs = await db.prepare(`SELECT DISTINCT vendor_name FROM po_header WHERE po_date = ? AND po_type = '후공정' AND status != 'cancelled'`).all(po.po_date);
      nextDestinations = postPOs.map(p => p.vendor_name);
    }
  }

  // 모든 셀 가운데 정렬 + 일정 padding + 단어 wrap 방지 (사용자 요청 — 간극 통일)
  const thStyle = 'border:1px solid #bbb;padding:8px 8px;text-align:center;vertical-align:middle;background:#f3f4f6;font-weight:600;font-size:12px;white-space:nowrap';
  const tdStyle = 'border:1px solid #ddd;padding:8px 8px;font-size:13px;text-align:center;vertical-align:middle;white-space:nowrap';

  let tableHeader, tableRows;
  if (isRawMaterial) {
    // 원재료 발주서: '규격' → '용지 규격' (XERP mmInoutItem.ItemSpec 동기화값, 예: 788*1061)
    // po_items.spec 에 PO 등록 시 products.spec(=XERP 매칭값) 으로 자동 채워짐 (line ~11275)
    tableHeader = `<tr>
      <th style="${thStyle}">제품코드</th>
      <th style="${thStyle}">원재료코드</th>
      <th style="${thStyle}">원재료명</th>
      <th style="${thStyle}">용지 규격</th>
      <th style="${thStyle};color:#c2410c">다음 입고처</th>
      <th style="${thStyle}">발주수량(낱개)</th>
      <th style="${thStyle}">절</th>
    </tr>`;
    tableRows = enrichedItems.map(it => `<tr>
      <td style="${tdStyle};font-weight:600">${it.product_code || ''}</td>
      <td style="${tdStyle}">${it.material_code || ''}</td>
      <td style="${tdStyle}">${it.material_name || ''}</td>
      <td style="${tdStyle}">${it.spec || ''}</td>
      <td style="${tdStyle};color:#c2410c;font-weight:600">${it.item_chain || '-'}</td>
      <td style="${tdStyle};font-weight:700;font-size:15px">${(it.ordered_qty || 0).toLocaleString()}매</td>
      <td style="${tdStyle}">${it.cut_spec || ''}</td>
    </tr>`).join('');
  } else {
    // 후공정 발주서: 공정별 섹션 분리 — 각 섹션 헤더에 담당자 표시
    const byProc = {};
    for (const it of enrichedItems) {
      const p = (it.process_type || '').trim() || '(공정미지정)';
      if (!byProc[p]) byProc[p] = [];
      byProc[p].push(it);
    }
    const sectionOrder = Object.keys(byProc).sort();
    // 단일 공정일 때는 섹션 헤더 생략하고 기존 테이블 유지
    // 후공정 발주서 헤더: 제품코드 / 공정 / 원재료코드 / 원재료명 / 입고수량(R) / 생산수량(낱개) / 규격 / 입고처
    const postHeaderHtml = `<tr>
        <th style="${thStyle}">제품코드</th>
        <th style="${thStyle}">공정</th>
        <th style="${thStyle}">원재료코드</th>
        <th style="${thStyle}">원재료명</th>
        <th style="${thStyle}">입고수량(R)</th>
        <th style="${thStyle}">생산수량(낱개)</th>
        <th style="${thStyle}">규격</th>
        <th style="${thStyle}">입고처</th>
      </tr>`;
    const postRowHtml = it => `<tr>
          <td style="${tdStyle};font-weight:600">${it.product_code || ''}</td>
          <td style="${tdStyle}">${it.process_type || ''}</td>
          <td style="${tdStyle};color:#0369a1">${it.material_code || ''}</td>
          <td style="${tdStyle}">${it.material_name || ''}</td>
          <td style="${tdStyle};font-weight:700">${it.ream_qty || '-'}R</td>
          <td style="${tdStyle};font-weight:600">${(it.ordered_qty || 0).toLocaleString()}</td>
          <td style="${tdStyle}">${it.spec || ''}</td>
          <td style="${tdStyle};color:#7c2d12;font-weight:600">${it.next_vendor || '바른손'}</td>
        </tr>`;
    if (sectionOrder.length <= 1) {
      tableHeader = postHeaderHtml;
      tableRows = enrichedItems.map(postRowHtml).join('');
    } else {
      // 복수 공정: 섹션별 sub-table 로 렌더 → tableHeader/tableRows 대신 본문 통째 교체용 마크업을 tableRows 에 담음
      tableHeader = postHeaderHtml;
      tableRows = sectionOrder.map(proc => {
        const list = byProc[proc];
        const ppl = assigneesByProcess[proc] || [];
        const assigneeLabel = ppl.length
          ? ppl.map(a => a.name + (a.email ? ` &lt;${a.email}&gt;` : '')).join(', ')
          : '담당자 미등록';
        const sectionHdr = `<tr><td colspan="8" style="padding:10px 8px;background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;font-weight:700;font-size:13px">
          ▸ ${proc} <span style="font-weight:400;font-size:11px;color:#9a3412;margin-left:10px">담당: ${assigneeLabel}</span>
        </td></tr>`;
        const body = list.map(postRowHtml).join('');
        return sectionHdr + body;
      }).join('');
    }
  }

  // 이메일 본문 HTML — max-width 700→960px (8~10컬럼 표가 wrap 되지 않도록)
  const html = `
    <div style="font-family:'맑은 고딕',sans-serif;max-width:960px;margin:0 auto">
      <div style="background:#f97316;color:#fff;padding:20px;border-radius:8px 8px 0 0">
        <h2 style="margin:0">${SENDER_COMPANY} ${typeLabel} 발주서</h2>
      </div>
      <div style="padding:24px;border:1px solid #e5e7eb;border-top:none">
        <table style="width:100%;margin-bottom:20px;font-size:14px">
          <tr><td style="padding:6px 0;color:#666;width:100px">발주번호</td><td style="padding:6px 0;font-weight:600">${po.po_number}</td></tr>
          <tr><td style="padding:6px 0;color:#666">발주일</td><td style="padding:6px 0">${po.po_date || ''}</td></tr>
          <tr><td style="padding:6px 0;color:#666">거래처</td><td style="padding:6px 0;font-weight:600">${vendorName}</td></tr>
          <tr><td style="padding:6px 0;color:#666">납기예정일</td><td style="padding:6px 0">${po.expected_date || ''}</td></tr>
          ${po.notes ? `<tr><td style="padding:6px 0;color:#666">비고</td><td style="padding:6px 0">${po.notes}</td></tr>` : ''}
        </table>
        <h3 style="margin:20px 0 10px;font-size:15px">발주 품목 <span style="font-size:11px;font-weight:400;color:#9a3412">— 품목별 다음 입고처 공정 포함</span></h3>
        <table style="width:100%;border-collapse:collapse">
          <thead>${tableHeader}</thead>
          <tbody>${tableRows}</tbody>
        </table>
        <div style="margin-top:24px;padding:16px 20px;background:#fff7ed;border:1px solid #fdba74;border-radius:8px;color:#7c2d12">
          <div style="font-weight:700;font-size:14px;margin-bottom:8px">📋 발주 확인 및 진행 안내</div>
          <div style="font-size:13px;line-height:1.7">
            ① 첨부된 <b>PDF 발주서</b>를 확인해주세요.<br>
            ② <b>발주 확인 / 출고 예정일</b>을 이 메일에 회신해주시거나 담당자에게 전화 부탁드립니다.<br>
            ③ <b>출고 완료 시점</b>에도 회신 부탁드립니다. 접수 후 후공정 업체로 전달됩니다.
          </div>
        </div>
        <p style="margin-top:14px;color:#888;font-size:11px;text-align:center">
          ※ 본 메일은 ${SENDER_COMPANY} ERP에서 자동 발송되었습니다.<br>
          문의: seungchan.back@barunn.net
        </p>
      </div>
    </div>`;

  // 합계 계산
  const totalQty = enrichedItems.reduce((s, it) => s + (it.ordered_qty || 0), 0);
  const totalReams = enrichedItems.reduce((s, it) => s + (parseFloat(it.ream_qty) || 0), 0);

  // 중국 거래처 판별 (origin 기반)
  let isChinaVendor = false;
  for (const it of items) {
    const prod = await db.prepare('SELECT origin FROM products WHERE product_code=?').get(it.product_code);
    if (prod && prod.origin === '중국') { isChinaVendor = true; break; }
  }

  // 첨부파일용 발주서 HTML (인쇄 최적화 — 프로페셔널 양식)
  const attachmentHtml = `<!DOCTYPE html><html><head><meta charset="utf-8">
    <title>${typeLabel} 발주서 - ${po.po_number}</title>
    <style>
      body{font-family:'Noto Sans KR','맑은 고딕','Microsoft YaHei',sans-serif;margin:0;padding:30px 40px;color:#333;font-size:13px}
      .header{display:flex;justify-content:space-between;align-items:flex-start;border-bottom:3px solid #f97316;padding-bottom:16px;margin-bottom:20px}
      .header-left h1{font-size:20px;margin:0 0 2px;color:#f97316}
      .header-left .sub{color:#666;font-size:11px}
      .header-right{text-align:right;font-size:11px;color:#666;line-height:1.6}
      .doc-title{text-align:center;font-size:18px;font-weight:700;margin:16px 0;letter-spacing:2px}
      ${isChinaVendor ? '.doc-title .cn{font-size:14px;color:#666;font-weight:400}' : ''}
      .info-grid{display:flex;gap:20px;margin-bottom:20px}
      .info-box{flex:1;border:1px solid #ddd;border-radius:6px;padding:12px 14px}
      .info-box h4{font-size:11px;color:#f97316;margin:0 0 8px;text-transform:uppercase;letter-spacing:1px}
      .info-box table{width:100%}
      .info-box td{border:none;padding:3px 0;font-size:12px;vertical-align:top}
      .info-box td:first-child{color:#888;width:70px;white-space:nowrap}
      .info-box td:last-child{font-weight:500}
      .items-table{width:100%;border-collapse:collapse;margin-bottom:16px}
      .items-table th{background:#f8f9fa;border:1px solid #ccc;padding:7px 10px;text-align:left;font-size:11px;font-weight:600;color:#555}
      .items-table td{border:1px solid #ddd;padding:7px 10px;font-size:12px}
      .items-table .right{text-align:right}
      .items-table .center{text-align:center}
      .items-table .bold{font-weight:700}
      .items-table .total-row{background:#fff3e0;font-weight:700;font-size:13px}
      .terms{margin:20px 0;padding:14px;background:#fafafa;border:1px solid #eee;border-radius:6px;font-size:11px;color:#666;line-height:1.7}
      .terms h4{margin:0 0 6px;font-size:12px;color:#333}
      .sign-area{display:flex;justify-content:space-between;margin-top:30px}
      .sign-box{width:45%;border-top:2px solid #333;padding-top:8px;text-align:center}
      .sign-box .label{font-size:11px;color:#888}
      .sign-box .name{font-size:14px;font-weight:600;margin-top:4px}
      .footer{margin-top:30px;text-align:center;color:#bbb;font-size:10px;border-top:1px solid #eee;padding-top:10px}
      @media print{body{margin:15px 20px;padding:0}.footer{page-break-after:always}}
    </style></head><body>

    <div class="doc-title">
      ${typeLabel} 발주서 PURCHASE ORDER
      ${isChinaVendor ? '<br><span class="cn">采购订单</span>' : ''}
    </div>

    <div class="info-grid">
      <div class="info-box">
        <h4>발주 정보 ${isChinaVendor ? '/ 订单信息' : ''}</h4>
        <table>
          <tr><td>${isChinaVendor ? 'PO번호' : '발주번호'}</td><td style="font-weight:700">${po.po_number}</td></tr>
          <tr><td>${isChinaVendor ? '下单日期' : '발주일'}</td><td>${po.po_date || ''}</td></tr>
          <tr><td>${isChinaVendor ? '交货日期' : '납기예정'}</td><td style="color:#e65100;font-weight:600">${po.expected_date || '협의'}</td></tr>
          <tr><td>품목수</td><td>${enrichedItems.length}건</td></tr>
        </table>
      </div>
      <div class="info-box">
        <h4>거래처 ${isChinaVendor ? '/ 供应商' : ''}</h4>
        <table>
          <tr><td>${isChinaVendor ? '供应商' : '업체명'}</td><td style="font-weight:700;font-size:14px">${vendorName}</td></tr>
          <tr><td>이메일</td><td>${vendorEmail}</td></tr>
          ${po.notes ? `<tr><td>비고</td><td>${po.notes}</td></tr>` : ''}
        </table>
      </div>
    </div>

    <table class="items-table">
      <thead>
        ${isRawMaterial ? `<tr>
          <th style="width:30px">#</th>
          <th>제품코드${isChinaVendor ? '<br><span style="font-weight:400;color:#999">产品编号</span>' : ''}</th>
          <th>원재료코드</th>
          <th>원재료명${isChinaVendor ? '<br><span style="font-weight:400;color:#999">材料名称</span>' : ''}</th>
          <th>용지 규격${isChinaVendor ? '<br><span style="font-weight:400;color:#999">纸张规格</span>' : ''}</th>
          <th style="color:#c2410c">다음 입고처${isChinaVendor ? '<br><span style="font-weight:400;color:#999">下一入库处</span>' : ''}</th>
          <th class="right">발주수량(낱개)${isChinaVendor ? '<br><span style="font-weight:400;color:#999">订购量</span>' : ''}</th>
          <th class="center">절</th>
        </tr>` : `<tr>
          <th style="width:30px">#</th>
          <th>제품코드</th>
          <th>공정</th>
          <th>원재료코드</th>
          <th>원재료명</th>
          <th class="right">입고수량(R)</th>
          <th class="right">생산수량</th>
          <th>규격</th>
          <th>입고처</th>
        </tr>`}
      </thead>
      <tbody>
        ${(() => {
          if (isRawMaterial) {
            return enrichedItems.map((it, idx) => `<tr>
              <td class="center" style="color:#999">${idx + 1}</td>
              <td class="bold">${it.product_code || ''}</td>
              <td>${it.material_code || ''}</td>
              <td>${it.material_name || ''}</td>
              <td>${it.spec || ''}</td>
              <td style="color:#c2410c;font-weight:600">${it.item_chain || '-'}</td>
              <td class="right bold" style="font-size:14px">${(it.ordered_qty || 0).toLocaleString()}매</td>
              <td class="center">${it.cut_spec || ''}</td>
            </tr>`).join('');
          }
          // 후공정: 공정별 섹션 + 담당자 헤더
          const byProc = {};
          for (const it of enrichedItems) {
            const p = (it.process_type || '').trim() || '(공정미지정)';
            if (!byProc[p]) byProc[p] = [];
            byProc[p].push(it);
          }
          const procs = Object.keys(byProc).sort();
          // 후공정 PDF 행: # / 제품코드 / 공정 / 원재료코드 / 원재료명 / 입고수량(R) / 생산수량 / 규격 / 입고처
          const postPdfRow = (it, n) => `<tr>
              <td class="center" style="color:#999">${n}</td>
              <td class="bold">${it.product_code || ''}</td>
              <td>${it.process_type || ''}</td>
              <td>${it.material_code || ''}</td>
              <td>${it.material_name || ''}</td>
              <td class="right bold">${it.ream_qty || '-'}R</td>
              <td class="right">${(it.ordered_qty || 0).toLocaleString()}</td>
              <td>${it.spec || ''}</td>
              <td style="color:#7c2d12;font-weight:600">${it.next_vendor || '바른손'}</td>
            </tr>`;
          if (procs.length <= 1) {
            return enrichedItems.map((it, idx) => postPdfRow(it, idx + 1)).join('');
          }
          let idx = 0;
          return procs.map(proc => {
            const list = byProc[proc];
            const ppl = assigneesByProcess[proc] || [];
            const assigneeLabel = ppl.length
              ? ppl.map(a => a.name + (a.email ? ` &lt;${a.email}&gt;` : '')).join(', ')
              : '담당자 미등록';
            const hdr = `<tr><td colspan="9" style="padding:8px 10px;background:#fff7ed;border:1px solid #fdba74;color:#7c2d12;font-weight:700;font-size:12px">
              ▸ ${proc} <span style="font-weight:400;font-size:10px;color:#9a3412;margin-left:8px">담당: ${assigneeLabel}</span>
            </td></tr>`;
            const body = list.map(it => { idx++; return postPdfRow(it, idx); }).join('');
            return hdr + body;
          }).join('');
        })()}
        <tr class="total-row">
          <td colspan="${isRawMaterial ? 6 : 5}" style="text-align:right;border:1px solid #ccc">합계 ${isChinaVendor ? '/ 合计' : ''}</td>
          ${isRawMaterial ? `
            <td class="right" style="border:1px solid #ccc;font-size:14px">${totalQty.toLocaleString()}매</td>
            <td style="border:1px solid #ccc"></td>
          ` : `
            <td class="right" style="border:1px solid #ccc">${totalReams % 1 === 0 ? totalReams : totalReams.toFixed(1)}R</td>
            <td class="right" style="border:1px solid #ccc">${totalQty.toLocaleString()}</td>
            <td style="border:1px solid #ccc"></td>
            <td style="border:1px solid #ccc"></td>
          `}
        </tr>
      </tbody>
    </table>

    <div class="terms">
      <h4>거래 조건 ${isChinaVendor ? '/ 交易条件' : ''}</h4>
      ${isChinaVendor ? `
        결제조건 / 付款方式: 월말 정산 (月末结算)<br>
        운송조건 / 运输方式: FOB 중국항 (FOB China Port)<br>
        포장기준 / 包装要求: 500매/연 기준 박스 포장 (500张/令 纸箱包装)<br>
        품질기준 / 质量标准: 주문사양 기준 ±2% 이내 (订单规格 ±2%)
      ` : `
        결제조건: 월말 정산<br>
        운송조건: 거래처 직배송<br>
        포장기준: 500매/연 기준 박스 포장<br>
        품질기준: 주문사양 기준
      `}
    </div>

    <div class="sign-area">
      <div class="sign-box">
        <div class="label">발주처 ${isChinaVendor ? '/ 采购方' : ''}</div>
        <div class="name">${SENDER_COMPANY}</div>
      </div>
      <div class="sign-box">
        <div class="label">공급처 ${isChinaVendor ? '/ 供应方' : ''}</div>
        <div class="name">${vendorName}</div>
      </div>
    </div>

    <div class="footer">${SENDER_COMPANY} 발주시스템 | Generated ${new Date().toISOString().slice(0, 10)} | ${po.po_number}</div>
  </body></html>`;

  const toEmail = vendorEmail; // 실제 거래처 이메일로 발송
  const ccEmails = emailCc ? emailCc.split(',').map(e => e.trim()).filter(e => e) : [];
  // 후공정 PO: process_assignee 담당자 이메일 자동 CC 병합 (중복 제거, toEmail과도 중복 제거)
  if (autoCcEmails.length) {
    const seen = new Set([toEmail.toLowerCase(), ...ccEmails.map(e => e.toLowerCase())]);
    for (const e of autoCcEmails) {
      const k = e.toLowerCase();
      if (k && !seen.has(k)) { ccEmails.push(e); seen.add(k); }
    }
  }

  // 첨부파일 — xlsx (사용자 요청으로 PDF → 엑셀 변경, 2026-04-29)
  let xlsxBuffer = null;
  let attachmentFileName = `${typeLabel}_발주서_${po.po_number}.xlsx`;
  let attachmentContentType = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
  try {
    const XLSX = require('xlsx');
    const wb = XLSX.utils.book_new();
    const aoa = [];
    // 정보 영역
    aoa.push([`${SENDER_COMPANY} ${typeLabel} 발주서`]);
    aoa.push([]);
    aoa.push(['발주번호', po.po_number]);
    aoa.push(['발주일', po.po_date || '']);
    aoa.push(['거래처', vendorName]);
    if (po.expected_date) aoa.push(['납기예정일', po.expected_date]);
    if (po.notes) aoa.push(['비고', po.notes]);
    aoa.push([]);
    // 품목 헤더 + 데이터 (이메일 본문 표와 동일 컬럼 구성)
    if (isRawMaterial) {
      aoa.push(['#', '제품코드', '원재료코드', '원재료명', '용지 규격', '다음 입고처', '발주수량(낱개)', '절']);
      enrichedItems.forEach((it, i) => {
        aoa.push([
          i + 1,
          it.product_code || '',
          it.material_code || '',
          it.material_name || '',
          it.spec || '',
          it.item_chain || '',
          it.ordered_qty || 0,
          it.cut_spec || ''
        ]);
      });
    } else {
      aoa.push(['#', '제품코드', '공정', '원재료코드', '원재료명', '입고수량(R)', '생산수량(낱개)', '규격', '입고처']);
      enrichedItems.forEach((it, i) => {
        aoa.push([
          i + 1,
          it.product_code || '',
          it.process_type || '',
          it.material_code || '',
          it.material_name || '',
          (it.ream_qty != null && it.ream_qty !== '' ? it.ream_qty : '-') + 'R',
          it.ordered_qty || 0,
          it.spec || '',
          it.next_vendor || '바른손'
        ]);
      });
    }
    const ws = XLSX.utils.aoa_to_sheet(aoa);
    // 컬럼 너비 (글자 수 기준)
    ws['!cols'] = isRawMaterial
      ? [{wch:5},{wch:14},{wch:12},{wch:20},{wch:12},{wch:34},{wch:12},{wch:6}]
      : [{wch:5},{wch:12},{wch:10},{wch:12},{wch:20},{wch:12},{wch:14},{wch:12},{wch:14}];
    XLSX.utils.book_append_sheet(wb, ws, '발주서');
    xlsxBuffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
    console.log(`📊 엑셀 변환 완료: ${attachmentFileName} (${xlsxBuffer.length} bytes)`);
  } catch (xlsxErr) {
    console.warn(`⚠️ 엑셀 변환 실패 (HTML 첨부로 폴백): ${xlsxErr.message}`);
    xlsxBuffer = null;
    attachmentFileName = `${typeLabel}_발주서_${po.po_number}.html`;
    attachmentContentType = 'text/html';
  }

  // 방법 1: nodemailer SMTP (Gmail 앱 비밀번호)
  if (smtpTransporter) {
    try {
      const mailOptions = {
        from: `"${SENDER_COMPANY} 발주시스템" <${SMTP_FROM}>`,
        to: toEmail,
        subject,
        html,
        attachments: [{
          filename: attachmentFileName,
          content: xlsxBuffer || attachmentHtml,
          contentType: attachmentContentType
        }]
      };
      if (ccEmails.length > 0) mailOptions.cc = ccEmails.join(', ');
      const info = await smtpTransporter.sendMail(mailOptions);
      console.log(`✅ SMTP 이메일 발송 성공: ${subject} → ${toEmail}${ccEmails.length ? ' (CC: ' + ccEmails.join(', ') + ')' : ''}`, info.messageId);
      return { ok: true, to: toEmail, cc: ccEmails, method: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.error(`❌ SMTP 이메일 발송 실패: ${err.message}`);
      // SMTP 실패 → Apps Script 폴백 시도
    }
  }

  // 방법 2: Apps Script 폴백
  await ensureGoogleToken();
  if (!gAccessToken) {
    return { ok: false, error: 'SMTP 미설정 + Google 토큰 없음. .env에 SMTP_USER/SMTP_PASS 설정 필요', to: toEmail };
  }

  const emailPayload = {
    action: 'sendEmail', to: toEmail, subject, html,
    cc: ccEmails.length > 0 ? ccEmails.join(',') : '',
    attachment: { name: attachmentFileName, content: attachmentHtml, mimeType: 'text/html' }
  };

  return new Promise((resolve) => {
    const body = JSON.stringify(emailPayload);
    const bodyBuf = Buffer.from(body, 'utf8');
    const u = new URL(APPS_SCRIPT_URL);

    function doRequest(urlObj, redirectCount, method) {
      if (redirectCount > 5) { resolve({ ok: false, error: 'too many redirects', to: toEmail }); return; }
      const isPOST = method === 'POST';
      const options = {
        hostname: urlObj.hostname, path: urlObj.pathname + urlObj.search, method,
        headers: { 'Authorization': 'Bearer ' + gAccessToken }
      };
      if (isPOST) {
        options.headers['Content-Type'] = 'application/json; charset=utf-8';
        options.headers['Content-Length'] = bodyBuf.length;
      }
      const req = https.request(options, (resp) => {
        if (resp.statusCode >= 300 && resp.statusCode < 400 && resp.headers.location) {
          doRequest(new URL(resp.headers.location), redirectCount + 1, 'GET');
          resp.resume();
          return;
        }
        let data = '';
        resp.on('data', c => data += c);
        resp.on('end', () => {
          try {
            const result = JSON.parse(data);
            if (result.status === 'success' || result.ok) {
              console.log(`✅ Apps Script 이메일 발송 성공: ${subject} → ${toEmail}`, result);
              resolve({ ok: true, ...result, to: toEmail, method: 'apps_script' });
            } else {
              console.error(`❌ Apps Script 이메일 실패:`, result);
              resolve({ ok: false, error: result.error || 'Apps Script 실패', to: toEmail, method: 'apps_script' });
            }
          } catch (e) {
            console.error(`❌ Apps Script 응답 파싱 실패 (HTML 로그인 페이지 등): ${data.substring(0, 200)}`);
            resolve({ ok: false, error: 'Google 인증 만료 — SMTP 설정 필요', to: toEmail, method: 'apps_script', raw: data.substring(0, 100) });
          }
        });
      });
      req.on('error', e => resolve({ ok: false, error: e.message, to: toEmail }));
      if (isPOST) req.write(bodyBuf);
      req.end();
    }
    doRequest(u, 0, 'POST');
  });
}

const PORT = parseInt(process.env.PORT || '12026', 10);
const __dir = __dirname;
const DATA_DIR = process.env.DATA_DIR || __dir;
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dir, 'uploads');

// ── PostgreSQL ──────────────────────────────────────────────────────────
const db = pgAdapter;

async function startServer() {
  // PostgreSQL 연결
  await db.connect({
    host: envVars.PG_HOST || process.env.PG_HOST || 'onely-postgres',
    port: envVars.PG_PORT || process.env.PG_PORT || '5432',
    user: envVars.PG_USER || process.env.PG_USER || 'onely',
    password: envVars.PG_PASSWORD || process.env.PG_PASSWORD || 'onely',
    database: envVars.PG_DATABASE || process.env.PG_DATABASE || 'sc_erp',
  });
  console.log('✅ PostgreSQL 연결 완료');

  // ── [prelude] onely superuser 로 DDL 권한 선제 해결 ────────────────────
  // prod 에선 PG_USER=sc_erp 로 접속하는데, sc_erp 가 public 스키마 CREATE 권한도 없고
  // 기존 테이블의 owner 도 아니어서 후속 CREATE TABLE / ALTER TABLE 전부 silent-fail.
  // 결과: sync_log 테이블이 없어서 /api/sync/xerp-inventory 가 snapshot 비활성으로 떨어지고
  //       "live 리프레시 중" 루프 + "⚠️ 동기화 필요" 배지 영구 표시 (ISSUE-2026-04-22-DB-PERMISSION.md).
  // 해결: 매 부팅마다 onely superuser 로 (a) schema GRANT, (b) 모든 public 테이블 owner 를 sc_erp 로 이전,
  //       (c) sync_log/inventory_snapshot 을 superuser 권한으로 직접 CREATE — 이후 sc_erp CREATE/ALTER 가 정상화됨.
  {
    const _pguser = envVars.PG_USER || process.env.PG_USER || 'onely';
    const _pgadminUser = envVars.PG_ADMIN_USER || process.env.PG_ADMIN_USER || 'onely';
    const _pgadminPass = envVars.PG_ADMIN_PASSWORD || process.env.PG_ADMIN_PASSWORD || 'onely';
    // 이미 superuser 로 접속 중이면 prelude 자체를 skip (중복 연결 불필요)
    if (_pguser === _pgadminUser) {
      console.log('[prelude] 접속 계정이 이미 admin(' + _pgadminUser + ') — 권한 prelude 생략');
    } else {
      const { Pool: _PgPool } = require('pg');
      const _adminHost = envVars.PG_HOST || process.env.PG_HOST || 'onely-postgres';
      const _adminPort = parseInt(envVars.PG_PORT || process.env.PG_PORT || '5432');
      const _adminDb = envVars.PG_DATABASE || process.env.PG_DATABASE || 'sc_erp';
      let _adminPool = null;
      try {
        _adminPool = new _PgPool({ host: _adminHost, port: _adminPort, user: _pgadminUser, password: _pgadminPass, database: _adminDb, max: 2, connectionTimeoutMillis: 5000 });
        // 연결 테스트
        await _adminPool.query('SELECT 1');
      } catch (e) {
        console.warn('[prelude] admin 계정(' + _pgadminUser + ') 연결 실패 — 권한 prelude 생략:', e.message);
        _adminPool = null;
      }
      if (_adminPool) {
        // (a) schema public 에 CREATE/USAGE 권한 부여 → sc_erp 가 CREATE TABLE 할 수 있게
        try { await _adminPool.query(`GRANT ALL PRIVILEGES ON SCHEMA public TO ${_pguser}`); console.log('[prelude] GRANT schema public → ' + _pguser); } catch(e) { console.warn('[prelude] GRANT schema public 실패:', e.message); }
        try { await _adminPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO ${_pguser}`); } catch(_) {}
        try { await _adminPool.query(`ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON SEQUENCES TO ${_pguser}`); } catch(_) {}

        // (b) 기존 모든 public 테이블의 owner 를 sc_erp 로 이전 → 이후 ALTER TABLE 가능
        try {
          const r = await _adminPool.query(`SELECT tablename FROM pg_tables WHERE schemaname='public'`);
          let _owned = 0;
          for (const row of r.rows) {
            try {
              await _adminPool.query(`ALTER TABLE public."${row.tablename}" OWNER TO ${_pguser}`);
              _owned++;
            } catch(_) {}
          }
          if (_owned) console.log('[prelude] ' + _owned + '개 테이블 owner → ' + _pguser);
        } catch(e) { console.warn('[prelude] owner 이전 실패:', e.message); }

        // (c) sync_log / inventory_snapshot 은 superuser 로 직접 CREATE (존재 보장)
        //     이후 sc_erp 의 CREATE TABLE IF NOT EXISTS 와 ALTER 는 owner 도 sc_erp 라 정상 동작.
        try {
          await _adminPool.query(`CREATE TABLE IF NOT EXISTS sync_log (
            id            SERIAL PRIMARY KEY,
            sync_type     TEXT NOT NULL,
            started_at    TEXT DEFAULT TO_CHAR(NOW() AT TIME ZONE 'Asia/Seoul','YYYY-MM-DD HH24:MI:SS'),
            finished_at   TEXT DEFAULT '',
            success_count INTEGER DEFAULT 0,
            fail_count    INTEGER DEFAULT 0,
            status        TEXT DEFAULT 'running',
            error_msg     TEXT DEFAULT '',
            triggered_by  TEXT DEFAULT 'manual'
          )`);
          await _adminPool.query(`ALTER TABLE sync_log OWNER TO ${_pguser}`);
          console.log('[prelude] sync_log 테이블 OK (owner=' + _pguser + ')');
        } catch(e) { console.warn('[prelude] sync_log CREATE 실패:', e.message); }
        try {
          await _adminPool.query(`CREATE TABLE IF NOT EXISTS inventory_snapshot (
            product_code   TEXT PRIMARY KEY,
            legal_entity   TEXT DEFAULT 'barunson',
            site_code      TEXT DEFAULT 'BK10',
            current_stock  INTEGER DEFAULT 0,
            monthly_out    INTEGER DEFAULT 0,
            daily_out      INTEGER DEFAULT 0,
            total_3m       INTEGER DEFAULT 0,
            item_name      TEXT DEFAULT '',
            synced_at      TEXT DEFAULT ''
          )`);
          await _adminPool.query(`ALTER TABLE inventory_snapshot OWNER TO ${_pguser}`);
          console.log('[prelude] inventory_snapshot 테이블 OK (owner=' + _pguser + ')');
        } catch(e) { console.warn('[prelude] inventory_snapshot CREATE 실패:', e.message); }

        // (d) 기존 객체에 대한 마무리 GRANT
        try { await _adminPool.query(`GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO ${_pguser}`); } catch(_) {}
        try { await _adminPool.query(`GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO ${_pguser}`); } catch(_) {}

        try { await _adminPool.end(); } catch(_) {}
      }
    }
  }

// ── 핵심 테이블 DDL (ALTER TABLE 보다 선행되어야 함) ───────────────────
// 이전엔 serve_inv2.js 에 이 테이블들의 CREATE 가 없어 init_db.js(SQLite) 에만 의존.
// PG 환경에선 fresh DB 부팅 시 ALTER TABLE 이 "relation does not exist" 로 전부 실패 → 누락 컬럼 런타임 쿼리 실패 악순환.
// 여기서 먼저 생성해 후속 ALTER/CREATE INDEX 가 안전히 진행되도록 보장. pg-adapter 가 SQLite 문법 → PG 로 자동 변환.
await db.exec(`
  CREATE TABLE IF NOT EXISTS vendors (
    vendor_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_code TEXT DEFAULT '',
    name        TEXT NOT NULL,
    type        TEXT DEFAULT '',
    contact     TEXT DEFAULT '',
    phone       TEXT DEFAULT '',
    email       TEXT DEFAULT '',
    kakao       TEXT DEFAULT '',
    memo        TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    updated_at  TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS po_header (
    po_id       INTEGER PRIMARY KEY AUTOINCREMENT,
    po_number   TEXT UNIQUE NOT NULL,
    po_type     TEXT NOT NULL DEFAULT 'material',
    vendor_name TEXT DEFAULT '',
    po_date     TEXT DEFAULT (date('now','localtime')),
    status      TEXT DEFAULT 'draft',
    expected_date TEXT DEFAULT '',
    due_date    TEXT DEFAULT '',
    total_qty   INTEGER DEFAULT 0,
    notes       TEXT DEFAULT '',
    created_at  TEXT DEFAULT (datetime('now','localtime')),
    updated_at  TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_po_status ON po_header(status);
  CREATE INDEX IF NOT EXISTS idx_po_date ON po_header(po_date);
  CREATE TABLE IF NOT EXISTS po_items (
    item_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id        INTEGER NOT NULL,
    product_code TEXT NOT NULL,
    brand        TEXT DEFAULT '',
    process_type TEXT DEFAULT '',
    ordered_qty  INTEGER DEFAULT 0,
    received_qty INTEGER DEFAULT 0,
    spec         TEXT DEFAULT '',
    notes        TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_po_items_po ON po_items(po_id);
  CREATE INDEX IF NOT EXISTS idx_po_items_code ON po_items(product_code);
  CREATE TABLE IF NOT EXISTS receipts (
    receipt_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    po_id        INTEGER NOT NULL,
    receipt_date TEXT DEFAULT (date('now','localtime')),
    received_by  TEXT DEFAULT '',
    notes        TEXT DEFAULT '',
    created_at   TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_receipts_po ON receipts(po_id);
  CREATE TABLE IF NOT EXISTS receipt_items (
    receipt_item_id INTEGER PRIMARY KEY AUTOINCREMENT,
    receipt_id      INTEGER NOT NULL,
    po_item_id      INTEGER,
    product_code    TEXT NOT NULL,
    received_qty    INTEGER DEFAULT 0,
    defect_qty      INTEGER DEFAULT 0,
    notes           TEXT DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS idx_receipt_items_receipt ON receipt_items(receipt_id);
  CREATE TABLE IF NOT EXISTS bom_header (
    bom_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code  TEXT NOT NULL UNIQUE,
    product_name  TEXT DEFAULT '',
    brand         TEXT DEFAULT '',
    version       INTEGER DEFAULT 1,
    notes         TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now','localtime')),
    updated_at    TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE TABLE IF NOT EXISTS bom_items (
    bom_item_id   INTEGER PRIMARY KEY AUTOINCREMENT,
    bom_id        INTEGER NOT NULL,
    item_type     TEXT NOT NULL DEFAULT 'material',
    material_code TEXT DEFAULT '',
    material_name TEXT DEFAULT '',
    vendor_name   TEXT DEFAULT '',
    process_type  TEXT DEFAULT '',
    qty_per       REAL DEFAULT 1,
    cut_spec      TEXT DEFAULT '',
    plate_spec    TEXT DEFAULT '',
    unit          TEXT DEFAULT 'EA',
    notes         TEXT DEFAULT '',
    sort_order    INTEGER DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS idx_bom_items_bom ON bom_items(bom_id);
  CREATE TABLE IF NOT EXISTS product_post_vendor (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code TEXT NOT NULL,
    process_type TEXT NOT NULL DEFAULT '',
    vendor_name  TEXT NOT NULL DEFAULT '',
    step_order   INTEGER DEFAULT 1,
    created_at   TEXT DEFAULT (datetime('now','localtime')),
    updated_at   TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(product_code, process_type, step_order)
  );
  CREATE INDEX IF NOT EXISTS idx_ppv_code ON product_post_vendor(product_code);
`);
console.log('[init] 핵심 테이블 7종 OK (vendors/po_header/po_items/receipts/receipt_items/bom_header/bom_items/product_post_vendor)');

// ── Ensure order_history table ──────────────────────────────────────
await db.exec(`
  CREATE TABLE IF NOT EXISTS order_history (
    history_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    order_date     TEXT DEFAULT '',
    os_no          TEXT DEFAULT '',
    warehouse_order TEXT DEFAULT '',
    product_name   TEXT DEFAULT '',
    product_code   TEXT NOT NULL,
    actual_qty     INTEGER DEFAULT 0,
    material_code  TEXT DEFAULT '',
    material_name  TEXT DEFAULT '',
    paper_maker    TEXT DEFAULT '',
    vendor_code    TEXT DEFAULT '',
    qty            REAL DEFAULT 0,
    cut_spec       TEXT DEFAULT '',
    plate_spec     TEXT DEFAULT '',
    cutting        TEXT DEFAULT '',
    printing       TEXT DEFAULT '',
    foil_emboss    TEXT DEFAULT '',
    thomson        TEXT DEFAULT '',
    envelope_proc  TEXT DEFAULT '',
    seari          TEXT DEFAULT '',
    laser          TEXT DEFAULT '',
    silk           TEXT DEFAULT '',
    outsource      TEXT DEFAULT '',
    order_qty      INTEGER DEFAULT 0,
    product_spec   TEXT DEFAULT '',
    source_sheet   TEXT DEFAULT '',
    created_at     TEXT DEFAULT (datetime('now','localtime'))
  );
  CREATE INDEX IF NOT EXISTS idx_oh_product ON order_history(product_code);
  CREATE INDEX IF NOT EXISTS idx_oh_date ON order_history(order_date);
`);

// ── product_notes 테이블 (품목별 특이사항) ──
await db.exec(`
  CREATE TABLE IF NOT EXISTS product_notes (
    product_code TEXT PRIMARY KEY,
    note_type    TEXT DEFAULT '',
    note_text    TEXT DEFAULT '',
    updated_at   TEXT DEFAULT (datetime('now','localtime'))
  );
`);
try { await db.exec("ALTER TABLE product_notes ADD COLUMN op_category TEXT DEFAULT ''"); } catch(_) {}

// ── 원장 매핑 테이블 (거래처 품목코드 ↔ XERP 품목코드) ──
await db.exec(`
  CREATE TABLE IF NOT EXISTS ledger_code_map (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_code TEXT NOT NULL,
    vendor_item_code TEXT NOT NULL,
    vendor_item_name TEXT DEFAULT '',
    xerp_item_code TEXT NOT NULL,
    xerp_item_name TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    UNIQUE(vendor_code, vendor_item_code)
  );
`);

// ── 필수 자동발주 테이블 ─────────────────────────────────────────────
await db.exec(`
  CREATE TABLE IF NOT EXISTS auto_order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code TEXT NOT NULL UNIQUE,
    min_stock INTEGER DEFAULT 0,
    order_qty INTEGER DEFAULT 0,
    vendor_name TEXT DEFAULT '',
    enabled INTEGER DEFAULT 1,
    last_ordered_at TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);
// ── 품목관리 테이블 ──
await db.exec(`
  CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    product_code TEXT NOT NULL UNIQUE,
    product_name TEXT DEFAULT '',
    brand TEXT DEFAULT '',
    origin TEXT DEFAULT '한국',
    category TEXT DEFAULT '',
    status TEXT DEFAULT 'active',
    material_code TEXT DEFAULT '',
    material_name TEXT DEFAULT '',
    cut_spec TEXT DEFAULT '',
    jopan TEXT DEFAULT '',
    paper_maker TEXT DEFAULT '',
    memo TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now','localtime')),
    updated_at TEXT DEFAULT (datetime('now','localtime'))
  );
`);

// ── XERP 재고/출고 스냅샷 테이블 (2026-04 재도입) ──
// 매번 XERP 호출하지 않고 하루 1회 또는 수동 '동기화' 시에만 갱신.
// 프로덕션 PG onely 유저에 CREATE 권한 없는 경우를 대비해 별도 try/catch.
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
  await db.exec("CREATE INDEX IF NOT EXISTS idx_invsnap_entity ON inventory_snapshot(legal_entity)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_invsnap_synced ON inventory_snapshot(synced_at)");
  // 구 스키마 호환: 구 버전 코드로 테이블이 만들어져 있으면 legal_entity/site_code/item_name 등 누락 가능.
  const _invsnapCols = [
    ['legal_entity',  "TEXT DEFAULT 'barunson'"],
    ['site_code',     "TEXT DEFAULT 'BK10'"],
    ['monthly_out',   "INTEGER DEFAULT 0"],
    ['daily_out',     "INTEGER DEFAULT 0"],
    ['total_3m',      "INTEGER DEFAULT 0"],
    ['item_name',     "TEXT DEFAULT ''"],
    ['synced_at',     "TEXT DEFAULT ''"]
  ];
  for (const [col, type] of _invsnapCols) {
    try { await db.exec(`ALTER TABLE inventory_snapshot ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch(_) {}
  }
  console.log('[init] inventory_snapshot 테이블 OK');
} catch(e) {
  console.error('[init] ★ inventory_snapshot 테이블 생성 실패:', e.message);
  console.error('[init] ★ 관리자가 아래 SQL을 PG 에 실행해야 함:');
  console.error('[init] ★  CREATE TABLE inventory_snapshot (...);');
  console.error('[init] ★  GRANT SELECT,INSERT,UPDATE,DELETE ON inventory_snapshot TO onely;');
}

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
  await db.exec("CREATE INDEX IF NOT EXISTS idx_synclog_type_time ON sync_log(sync_type, started_at)");
  // 상태별 조회 최적화 (stale 감지 / /api/sync/status 모두 status='running' 으로 필터)
  await db.exec("CREATE INDEX IF NOT EXISTS idx_synclog_status ON sync_log(status) WHERE status='running'");
  // 구 스키마 호환: 구 버전 코드로 sync_log 가 이미 만들어져 있고 triggered_by/error_msg/fail_count 등이 빠져 있을 수 있음.
  // CREATE TABLE IF NOT EXISTS 는 기존 테이블을 건드리지 않으므로 ALTER 로 명시적 보강.
  // 누락 시 INSERT "column does not exist" → "does not exist" 정규식 매칭 → snapshot_disabled 로 오폴백.
  const _synclogCols = [
    ['triggered_by', "TEXT DEFAULT 'manual'"],
    ['error_msg',    "TEXT DEFAULT ''"],
    ['fail_count',   "INTEGER DEFAULT 0"],
    ['success_count',"INTEGER DEFAULT 0"],
    ['finished_at',  "TEXT DEFAULT ''"],
    ['status',       "TEXT DEFAULT 'running'"]
  ];
  for (const [col, type] of _synclogCols) {
    try { await db.exec(`ALTER TABLE sync_log ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch(_) {}
  }
  // 서버 크래시/재시작 직후 남은 running row 자동 해제.
  // 크래시되면 해당 node 프로세스는 이미 죽었으므로 락을 정리하지 않으면 409가 영구화됨.
  try {
    const cleared = await db.prepare("UPDATE sync_log SET status='failed', error_msg='서버 재시작 감지 — 자동 해제', finished_at=datetime('now','localtime') WHERE status='running'").run();
    if (cleared && cleared.changes > 0) console.log(`[init] sync_log stale 자동 해제: ${cleared.changes}건`);
  } catch(_) {}
  console.log('[init] sync_log 테이블 OK');
} catch(e) {
  console.error('[init] ★ sync_log 테이블 생성 실패:', e.message);
}

// ════════════════════════════════════════════════════════════════════
//  재고현황2 (XERP 스냅샷 적재 + 입고 조정) 전용 테이블
//  ※ 기존 inventory_snapshot / sync_log 와 분리. prefix = inv2_
//  - inv2_inventory_snapshot : XERP mmInventory 행 단위 스냅샷
//  - inv2_inout              : XERP mmInoutItem 행 단위 (SO/MO/SI/MI)
//  - inv2_sales              : XERP ERP_SalesData 행 단위
//  - inv2_adjustments        : 발주 입고처리/수동 조정 로그 (재고 +/-)
//  - inv2_sync_jobs          : 백필/동기화 작업 진행률 추적
// ════════════════════════════════════════════════════════════════════
try {
  await db.exec(`CREATE TABLE IF NOT EXISTS inv2_inventory_snapshot (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    snapshot_date TEXT NOT NULL,
    site_code     TEXT DEFAULT 'BK10',
    wh_code       TEXT DEFAULT '',
    item_code     TEXT NOT NULL,
    item_name     TEXT DEFAULT '',
    stock_qty     NUMERIC DEFAULT 0,
    synced_at     TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_snap_item ON inv2_inventory_snapshot(item_code)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_snap_date ON inv2_inventory_snapshot(snapshot_date)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_snap_wh ON inv2_inventory_snapshot(wh_code)");

  await db.exec(`CREATE TABLE IF NOT EXISTS inv2_inout (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    inout_date    TEXT NOT NULL,
    site_code     TEXT DEFAULT 'BK10',
    wh_code       TEXT DEFAULT '',
    inout_no      TEXT DEFAULT '',
    inout_seq     INTEGER DEFAULT 0,
    inout_gubun   TEXT DEFAULT '',
    item_code     TEXT NOT NULL,
    item_name     TEXT DEFAULT '',
    inout_qty     NUMERIC DEFAULT 0,
    inout_amnt    NUMERIC DEFAULT 0,
    synced_at     TEXT DEFAULT (datetime('now','localtime'))
  )`);
  // 멱등성 — 동일 (no, seq, gubun, code) 중복 방지
  try { await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_inv2_inout ON inv2_inout(inout_no, inout_seq, inout_gubun, item_code)"); } catch(_){}
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_inout_date ON inv2_inout(inout_date)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_inout_item ON inv2_inout(item_code)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_inout_gubun ON inv2_inout(inout_gubun)");

  await db.exec(`CREATE TABLE IF NOT EXISTS inv2_sales (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    h_date        TEXT NOT NULL,
    h_orderid     TEXT DEFAULT '',
    b_seq         INTEGER DEFAULT 0,
    b_goodcode    TEXT DEFAULT '',
    b_ordernum    NUMERIC DEFAULT 0,
    b_sumprice    NUMERIC DEFAULT 0,
    h_sumprice    NUMERIC DEFAULT 0,
    h_offerprice  NUMERIC DEFAULT 0,
    h_supertax    NUMERIC DEFAULT 0,
    fee_amnt      NUMERIC DEFAULT 0,
    dept_gubun    TEXT DEFAULT '',
    synced_at     TEXT DEFAULT (datetime('now','localtime'))
  )`);
  try { await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS uq_inv2_sales ON inv2_sales(h_orderid, b_seq, b_goodcode)"); } catch(_){}
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_sales_date ON inv2_sales(h_date)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_sales_code ON inv2_sales(b_goodcode)");

  await db.exec(`CREATE TABLE IF NOT EXISTS inv2_adjustments (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    adj_date      TEXT DEFAULT (date('now','localtime')),
    item_code     TEXT NOT NULL,
    delta_qty     NUMERIC NOT NULL,
    reason        TEXT DEFAULT 'manual',
    po_id         INTEGER,
    po_number     TEXT DEFAULT '',
    user_id       INTEGER,
    user_name     TEXT DEFAULT '',
    notes         TEXT DEFAULT '',
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_adj_item ON inv2_adjustments(item_code)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_adj_po ON inv2_adjustments(po_id)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_adj_date ON inv2_adjustments(adj_date)");

  await db.exec(`CREATE TABLE IF NOT EXISTS inv2_sync_jobs (
    job_id        INTEGER PRIMARY KEY AUTOINCREMENT,
    job_type      TEXT NOT NULL,
    table_name    TEXT NOT NULL,
    range_start   TEXT DEFAULT '',
    range_end     TEXT DEFAULT '',
    status        TEXT DEFAULT 'queued',
    progress_pct  INTEGER DEFAULT 0,
    current_step  TEXT DEFAULT '',
    rows_inserted INTEGER DEFAULT 0,
    error_msg     TEXT DEFAULT '',
    started_at    TEXT DEFAULT '',
    finished_at   TEXT DEFAULT '',
    triggered_by  TEXT DEFAULT 'manual',
    created_at    TEXT DEFAULT (datetime('now','localtime'))
  )`);
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_sync_status ON inv2_sync_jobs(status)");
  await db.exec("CREATE INDEX IF NOT EXISTS idx_inv2_sync_table ON inv2_sync_jobs(table_name)");

  // 서버 재시작 시 stale running 작업 자동 해제 (sync_log 와 동일 패턴)
  try {
    const cleared = await db.prepare("UPDATE inv2_sync_jobs SET status='failed', error_msg='서버 재시작 감지 — 자동 해제', finished_at=datetime('now','localtime') WHERE status='running' OR status='queued'").run();
    if (cleared && cleared.changes > 0) console.log(`[init] inv2_sync_jobs stale 자동 해제: ${cleared.changes}건`);
  } catch(_){}

  console.log('[init] inv2_* 테이블 OK (재고현황2)');
} catch(e) {
  console.error('[init] ★ inv2_* 테이블 생성 실패:', e.message);
}

// ── BOM 조판 계산 확장 컬럼 ──
try { await db.exec("ALTER TABLE bom_items ADD COLUMN material_type TEXT DEFAULT 'IMPOSITION'"); } catch {}
try { await db.exec("ALTER TABLE bom_items ADD COLUMN paper_standard TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE bom_items ADD COLUMN paper_type TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE bom_items ADD COLUMN gsm INTEGER DEFAULT 0"); } catch {}
try { await db.exec("ALTER TABLE bom_items ADD COLUMN finished_w REAL DEFAULT 0"); } catch {}
try { await db.exec("ALTER TABLE bom_items ADD COLUMN finished_h REAL DEFAULT 0"); } catch {}
try { await db.exec("ALTER TABLE bom_items ADD COLUMN bleed REAL DEFAULT 3"); } catch {}
try { await db.exec("ALTER TABLE bom_items ADD COLUMN grip REAL DEFAULT 10"); } catch {}
try { await db.exec("ALTER TABLE bom_items ADD COLUMN loss_rate REAL DEFAULT 5"); } catch {}
try { await db.exec("ALTER TABLE bom_header ADD COLUMN default_order_qty INTEGER DEFAULT 1000"); } catch {}
try { await db.exec("ALTER TABLE bom_header ADD COLUMN finished_w REAL DEFAULT 0"); } catch {}
try { await db.exec("ALTER TABLE bom_header ADD COLUMN finished_h REAL DEFAULT 0"); } catch {}

// ── os_number 컬럼 추가 (발주 프로세스 자동화) ──
try { await db.exec("ALTER TABLE po_header ADD COLUMN os_number TEXT DEFAULT ''"); } catch(_) {}

// ── 신제품 관리 컬럼 추가 ──
try { await db.exec("ALTER TABLE products ADD COLUMN is_new_product INTEGER DEFAULT 0"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN first_order_done INTEGER DEFAULT 0"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN die_cost INTEGER DEFAULT 0"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN lead_time_days INTEGER DEFAULT 0"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN post_vendor TEXT DEFAULT ''"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN unit TEXT DEFAULT 'EA'"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN op_category TEXT DEFAULT ''"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN temp_code TEXT DEFAULT ''"); } catch(e) {}
// 규격 — XERP mmInoutItem.ItemSpec 에서 1회성 동기화됨. 한번 채워지면 수동 수정 전까지 유지.
try { await db.exec("ALTER TABLE products ADD COLUMN spec TEXT DEFAULT ''"); } catch(e) {}
// inventory_snapshot 에 창고별 재고 JSON 컬럼 — { "MF01": 100, "MT01": 50, ... }
// 프론트가 창고 드롭다운으로 즉시 필터링 가능. current_stock 은 전체 합산을 그대로 유지(legacy 호환).
try { await db.exec("ALTER TABLE inventory_snapshot ADD COLUMN warehouses_json TEXT DEFAULT ''"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN moq TEXT DEFAULT ''"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN payment_terms TEXT DEFAULT ''"); } catch(e) {}
try { await db.exec("ALTER TABLE products ADD COLUMN supplier_id INTEGER DEFAULT 0"); } catch(e) {}

// ── 생산지별 기본 리드타임 (일) ──
const ORIGIN_LEAD_TIME = { '중국': 50, '한국': 7, '더기프트': 14 };

// ── 공유 상수: PO 상태 매핑 (중복 제거) ──
const PO_STATUS_EN_TO_KO = { 'draft':'대기', 'sent':'발송', 'confirmed':'확인', 'partial':'수령중', 'received':'완료', 'cancelled':'취소', 'os_pending':'OS등록대기', 'os_registered':'OS검증대기' };
const PO_STATUS_KO_TO_EN = { '대기':'draft', '발송':'sent', '확인':'confirmed', '수령중':'partial', '완료':'received', '취소':'cancelled', 'OS등록대기':'os_pending', 'OS검증대기':'os_registered' };
const MATERIAL_STATUS_KO = { 'sent':'발주완료', 'confirmed':'확인', 'scheduled':'출고예정', 'shipped':'출고완료' };
const PROCESS_STATUS_KO = { 'waiting':'대기', 'sent':'발주완료', 'confirmed':'확인', 'working':'작업중', 'completed':'완료' };

// ── 후공정 타입: DB에서 로드 (getPostProcessTypes() 사용) ──
let _cachedPostCols = null;
let _processTypesInMemory = null; // DB 테이블 없을 때 인메모리 저장소
const _defaultPostTypes = [
  {id:1,name:'재단',category:'post',group_name:'',icon:'⚙️',sort_order:1,is_active:1,default_vendor:''},
  {id:2,name:'인쇄',category:'post',group_name:'',icon:'⚙️',sort_order:2,is_active:1,default_vendor:''},
  {id:3,name:'박/형압',category:'post',group_name:'',icon:'⚙️',sort_order:3,is_active:1,default_vendor:''},
  {id:4,name:'톰슨',category:'post',group_name:'',icon:'⚙️',sort_order:4,is_active:1,default_vendor:''},
  {id:5,name:'봉투가공',category:'post',group_name:'',icon:'⚙️',sort_order:5,is_active:1,default_vendor:''},
  {id:22,name:'단면접착',category:'post',group_name:'',icon:'⚙️',sort_order:6,is_active:1,default_vendor:''},
  {id:10,name:'우찌누끼',category:'post',group_name:'',icon:'⚙️',sort_order:7,is_active:1,default_vendor:'예지가'},
  {id:21,name:'접지',category:'post',group_name:'',icon:'⚙️',sort_order:8,is_active:1,default_vendor:''},
  {id:23,name:'코팅',category:'post',group_name:'',icon:'⚙️',sort_order:9,is_active:1,default_vendor:''},
  // 아래 4종은 미사용 — 과거 po_items 참조 호환을 위해 row 유지, is_active=0
  {id:6,name:'세아리',category:'post',group_name:'',icon:'⚙️',sort_order:90,is_active:0,default_vendor:''},
  {id:7,name:'레이져',category:'post',group_name:'',icon:'⚙️',sort_order:91,is_active:0,default_vendor:''},
  {id:8,name:'실크',category:'post',group_name:'',icon:'⚙️',sort_order:92,is_active:0,default_vendor:''},
  {id:9,name:'임가공',category:'post',group_name:'',icon:'⚙️',sort_order:93,is_active:0,default_vendor:''}
];
const _defaultBomTypes = [
  {id:11,name:'오프셋인쇄',category:'bom',group_name:'인쇄',icon:'🖨️',sort_order:1,is_active:1,default_vendor:''},
  {id:12,name:'디지털인쇄',category:'bom',group_name:'인쇄',icon:'💻',sort_order:2,is_active:1,default_vendor:''},
  {id:13,name:'박가공',category:'bom',group_name:'후가공',icon:'✨',sort_order:3,is_active:1,default_vendor:''},
  {id:14,name:'형압',category:'bom',group_name:'후가공',icon:'🔲',sort_order:4,is_active:1,default_vendor:''},
  {id:15,name:'에폭시',category:'bom',group_name:'후가공',icon:'💎',sort_order:5,is_active:1,default_vendor:''},
  {id:16,name:'톰슨',category:'bom',group_name:'후가공',icon:'✂️',sort_order:6,is_active:1,default_vendor:''},
  {id:17,name:'코팅/라미',category:'bom',group_name:'후가공',icon:'🛡️',sort_order:7,is_active:1,default_vendor:''},
  {id:18,name:'접지',category:'bom',group_name:'제본',icon:'📐',sort_order:8,is_active:1,default_vendor:''},
  {id:19,name:'제본',category:'bom',group_name:'제본',icon:'📚',sort_order:9,is_active:1,default_vendor:''},
  {id:20,name:'포장',category:'bom',group_name:'포장',icon:'📦',sort_order:10,is_active:1,default_vendor:''},
  {id:23,name:'단면접착',category:'bom',group_name:'후가공',icon:'🩹',sort_order:11,is_active:1,default_vendor:''}
];
let _processTypesTableExists = null;

async function checkProcessTypesTable() {
  if (_processTypesTableExists !== null) return _processTypesTableExists;
  try {
    await db.prepare("SELECT COUNT(*) AS cnt FROM process_types").get();
    _processTypesTableExists = true;
  } catch(e) {
    _processTypesTableExists = false;
    // 인메모리 초기화
    _processTypesInMemory = [..._defaultPostTypes, ..._defaultBomTypes];
    // JSON 파일로 영속화 시도
    try {
      const ptFile = path.join(__dirname, 'process_types.json');
      if (fs.existsSync(ptFile)) _processTypesInMemory = JSON.parse(fs.readFileSync(ptFile, 'utf8'));
    } catch(_) {}
  }
  return _processTypesTableExists;
}

function saveProcessTypesToFile() {
  if (!_processTypesInMemory) return;
  try { fs.writeFileSync(path.join(__dirname, 'process_types.json'), JSON.stringify(_processTypesInMemory, null, 2)); } catch(_) {}
}

async function getPostProcessTypes() {
  if (_cachedPostCols) return _cachedPostCols;
  const hasTable = await checkProcessTypesTable();
  if (hasTable) {
    try {
      const rows = await db.prepare("SELECT name FROM process_types WHERE category='post' AND is_active=1 ORDER BY sort_order, id").all();
      if (rows.length > 0) { _cachedPostCols = rows.map(r => r.name); return _cachedPostCols; }
    } catch(e) { /* fallback */ }
  } else if (_processTypesInMemory) {
    _cachedPostCols = _processTypesInMemory.filter(p => p.category === 'post' && p.is_active).sort((a,b) => a.sort_order - b.sort_order).map(p => p.name);
    return _cachedPostCols;
  }
  return ['재단','인쇄','박/형압','톰슨','봉투가공','단면접착','우찌누끼','접지','코팅'];
}
function invalidatePostColsCache() { _cachedPostCols = null; }

// 원지사(paper_maker) 약칭 → 등록된 거래처명 매핑
const PAPER_MAKER_TO_VENDOR = {
  '대한': '대한통상', '대한통상': '대한통상',
  '두성': '두성종이', '두성종이': '두성종이',
  '삼원': '삼원제지', '삼원제지': '삼원제지',
  '서경': '주식회사 서경', '주식회사 서경': '주식회사 서경',
  '한솔PNS': '한솔PNS', '한솔': '한솔PNS',
  '파주': '파주', // 거래처 미등록 시 매핑 안 됨
};

function resolveVendor(paperMaker) {
  if (!paperMaker) return null;
  return PAPER_MAKER_TO_VENDOR[paperMaker.trim()] || null;
}

// ── 2단계 파이프라인 추적 컬럼 추가 (원재료 + 후공정) ──
try { await db.exec("ALTER TABLE po_header ADD COLUMN material_status TEXT DEFAULT 'sent'"); } catch(e) {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN process_status TEXT DEFAULT 'waiting'"); } catch(e) {}

// ── 발송처리 시점 기록 ──
try { await db.exec("ALTER TABLE po_header ADD COLUMN shipped_at TEXT DEFAULT ''"); } catch(e) {}

// ── 불량 처리 발주 연결 컬럼 추가 ──
try { await db.exec("ALTER TABLE po_header ADD COLUMN defect_id INTEGER DEFAULT NULL"); } catch(e) {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN defect_number TEXT DEFAULT ''"); } catch(e) {}

// ── 생산지(origin) 컬럼 추가 (한국/중국/더기프트 분리) ──
try { await db.exec("ALTER TABLE po_header ADD COLUMN origin TEXT DEFAULT ''"); } catch(_) {}

// ============================================================
// 법인(legal_entity) 컬럼 일괄 추가 — 바른컴퍼니(barunson) / 디디(dd) 분리
// ============================================================
const _entityTables = [
  'products', 'po_header', 'po_items', 'trade_document',
  'receipts', 'defects', 'batch_master', 'work_orders'
];
// 1st pass: 이 시점에 이미 존재하는 테이블만 대상.
// trade_document/defects/batch_master/work_orders 는 뒤에서 CREATE 되므로 skip — 뒤의 2nd pass 에서 처리.
// 존재 체크 없이 ALTER 하면 pg-adapter 가 "relation does not exist" 를 ERROR 레벨로 로그해 노이즈.
for (const tbl of _entityTables) {
  try {
    const exists = await db.prepare("SELECT 1 AS x FROM information_schema.tables WHERE table_name=?").get(tbl);
    if (!exists) continue;
    await db.exec(`ALTER TABLE ${tbl} ADD COLUMN legal_entity TEXT DEFAULT 'barunson'`);
  } catch(_) {}
}
try { await db.exec("CREATE INDEX IF NOT EXISTS idx_products_entity ON products(legal_entity)"); } catch(_) {}
try { await db.exec("CREATE INDEX IF NOT EXISTS idx_po_header_entity ON po_header(legal_entity)"); } catch(_) {}

// ── DD 자동 동기화로 들어왔던 origin='DD' 품목 정리 (1회성, 거래 미연결 확인 완료) ──
try {
  const _ddCleanup = await db.prepare("SELECT COUNT(*) AS c FROM products WHERE origin='DD' OR brand='DD'").get();
  if (_ddCleanup && Number(_ddCleanup.c) > 0) {
    const _used = await db.prepare(`SELECT COUNT(*) AS c FROM po_items i
      JOIN products p ON p.product_code=i.product_code
      WHERE p.origin='DD' OR p.brand='DD'`).get();
    // v1.0.8: origin='DD'를 '한국'으로 강제 UPDATE 하던 로직 제거 —
    // 원래 생산지(한국/중국/더기프트)가 소실되어 발주서 작성 탭에서 DD 품목이 바른손과 섞이는 버그 유발.
    // 이제는 legal_entity만 마킹하고 origin은 건드리지 않는다.
    if (_used && Number(_used.c) === 0) {
      await db.prepare("DELETE FROM products WHERE origin='DD' OR brand='DD'").run();
      console.log(`[entity-migration] DD 더미 품목 ${_ddCleanup.c}건 삭제 완료`);
    } else {
      await db.prepare("UPDATE products SET legal_entity='dd' WHERE (origin='DD' OR brand='DD')").run();
      console.log(`[entity-migration] DD 품목 ${_ddCleanup.c}건 dd 법인으로 마킹 (origin 보존, 거래 ${_used.c}건 연결)`);
    }
  }
} catch(e) { console.warn('[entity-migration] DD 정리 오류:', e.message); }

// ── 기존 거래 데이터 backfill (legal_entity NULL/'' → 'barunson') ──
for (const tbl of _entityTables) {
  try {
    await db.prepare(`UPDATE ${tbl} SET legal_entity='barunson' WHERE legal_entity IS NULL OR legal_entity=''`).run();
  } catch(e) { /* 컬럼 없으면 무시 */ }
}
// DD 제품 마킹: product_code가 DD로 시작하는 품목 → legal_entity='dd'
try {
  const ddUpdated = await db.prepare("UPDATE products SET legal_entity='dd' WHERE product_code LIKE 'DD%' AND (legal_entity IS NULL OR legal_entity='barunson')").run();
  if (ddUpdated.changes > 0) console.log(`[entity-backfill] DD 제품 ${ddUpdated.changes}건 → legal_entity='dd' 마킹`);
  // PO도 DD 품목이 포함된 것은 dd로 마킹
  const ddPoUpdated = await db.prepare(`UPDATE po_header SET legal_entity='dd' WHERE po_id IN (SELECT DISTINCT po_id FROM po_items WHERE product_code LIKE 'DD%') AND (legal_entity IS NULL OR legal_entity='barunson')`).run();
  if (ddPoUpdated.changes > 0) console.log(`[entity-backfill] DD 관련 PO ${ddPoUpdated.changes}건 → legal_entity='dd' 마킹`);
} catch(e) { console.warn('[entity-backfill] DD 마킹 오류:', e.message); }

// ── DDL 권한 부족 대응: onely 계정으로 legal_entity 컬럼 추가 시도 ──
// sc_erp 계정은 ALTER TABLE 불가 → onely(superuser)로 별도 연결하여 DDL 실행
{
  const { Pool: _PgPool } = require('pg');
  const _ddlHost = envVars.PG_HOST || process.env.PG_HOST || 'onely-postgres';
  const _ddlPort = parseInt(envVars.PG_PORT || process.env.PG_PORT || '5432');
  const _ddlDb = envVars.PG_DATABASE || process.env.PG_DATABASE || 'sc_erp';
  const _ddlPool = new _PgPool({ host: _ddlHost, port: _ddlPort, user: 'onely', password: 'onely', database: _ddlDb, max: 2 });
  let _ddlOk = 0;
  for (const tbl of _entityTables) {
    try {
      const chk = await _ddlPool.query("SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name='legal_entity'", [tbl]);
      if (!chk.rows.length) {
        await _ddlPool.query(`ALTER TABLE ${tbl} ADD COLUMN legal_entity TEXT DEFAULT 'barunson'`);
        _ddlOk++;
        console.log(`[DDL/onely] ${tbl}.legal_entity 컬럼 추가 완료`);
      }
    } catch(e) { /* 테이블 없거나 이미 존재 */ }
  }
  if (_ddlOk) console.log(`[DDL/onely] ${_ddlOk}개 테이블에 legal_entity 컬럼 추가`);

  // ── sync_log / inventory_snapshot 누락 컬럼 보강 (onely 권한으로) ──
  // 운영 PG 의 이 테이블들이 구 스키마로 만들어져 있으면 INSERT 실패 → snapshot_disabled → "live 리프레시 중" 루프.
  // sc_erp 계정이 ALTER 권한 없어서 이전 보강 코드(db.exec)가 silent-fail 하던 문제 해결.
  const _criticalCols = [
    ['sync_log', 'triggered_by',  "TEXT DEFAULT 'manual'"],
    ['sync_log', 'error_msg',     "TEXT DEFAULT ''"],
    ['sync_log', 'fail_count',    "INTEGER DEFAULT 0"],
    ['sync_log', 'success_count', "INTEGER DEFAULT 0"],
    ['sync_log', 'finished_at',   "TEXT DEFAULT ''"],
    ['sync_log', 'status',        "TEXT DEFAULT 'running'"],
    ['inventory_snapshot', 'legal_entity', "TEXT DEFAULT 'barunson'"],
    ['inventory_snapshot', 'site_code',    "TEXT DEFAULT 'BK10'"],
    ['inventory_snapshot', 'monthly_out',  "INTEGER DEFAULT 0"],
    ['inventory_snapshot', 'daily_out',    "INTEGER DEFAULT 0"],
    ['inventory_snapshot', 'total_3m',     "INTEGER DEFAULT 0"],
    ['inventory_snapshot', 'item_name',    "TEXT DEFAULT ''"],
    ['inventory_snapshot', 'synced_at',    "TEXT DEFAULT ''"]
  ];
  let _criticalOk = 0;
  for (const [tbl, col, type] of _criticalCols) {
    try {
      const chk = await _ddlPool.query("SELECT 1 FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", [tbl, col]);
      if (!chk.rows.length) {
        await _ddlPool.query(`ALTER TABLE ${tbl} ADD COLUMN ${col} ${type}`);
        _criticalOk++;
        console.log(`[DDL/onely] ${tbl}.${col} 컬럼 추가 완료`);
      }
    } catch(e) { /* 테이블 자체가 없거나 이미 존재 — 초기 CREATE 단계가 처리 */ }
  }
  if (_criticalOk) console.log(`[DDL/onely] sync_log/inventory_snapshot 누락 컬럼 ${_criticalOk}개 보강 완료`);

  // GRANT 권한도 부여 (sc_erp 계정이 읽기/쓰기 가능하도록)
  try { await _ddlPool.query("GRANT ALL ON ALL TABLES IN SCHEMA public TO sc_erp"); } catch(e) {}
  // 시퀀스도 GRANT (AUTOINCREMENT/SERIAL 쓰는 테이블 INSERT 시 nextval 권한 필요)
  try { await _ddlPool.query("GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO sc_erp"); } catch(e) {}
  await _ddlPool.end();
}

// ── 컬럼 존재 여부 점검 (PG 권한 부족으로 ALTER 실패한 테이블 대응) ──
// 운영 PG의 일부 테이블은 owner가 아니라서 ALTER TABLE이 silent fail함.
// 컬럼이 실제로 있는 테이블만 entity 필터/저장을 적용해서 페이지 깨짐을 방지.
const _hasEntity = {};
for (const tbl of _entityTables) {
  try {
    const r = await db.prepare(
      "SELECT 1 AS x FROM information_schema.columns WHERE table_name=? AND column_name='legal_entity'"
    ).get(tbl);
    _hasEntity[tbl] = !!r;
  } catch(e) { _hasEntity[tbl] = false; }
}
console.log('[entity] legal_entity 컬럼 존재 여부:', _hasEntity);

// ── 납품 스케줄 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS vendor_shipment_schedule (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  po_number TEXT DEFAULT '',
  vendor_name TEXT DEFAULT '',
  ship_date TEXT DEFAULT '',
  ship_time TEXT DEFAULT 'AM',
  post_vendor_name TEXT DEFAULT '',
  post_vendor_email TEXT DEFAULT '',
  auto_email_sent INTEGER DEFAULT 0,
  status TEXT DEFAULT 'scheduled',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── 공정 리드타임 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS process_lead_time (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  process_type TEXT NOT NULL,
  default_days INTEGER DEFAULT 1,
  adjusted_days INTEGER DEFAULT NULL,
  adjusted_reason TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(vendor_name, process_type)
)`);

// ── 리드타임 수정 이력 ──
await db.exec(`CREATE TABLE IF NOT EXISTS lead_time_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  process_type TEXT NOT NULL,
  old_days INTEGER,
  new_days INTEGER,
  changed_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_lt_hist_vendor ON lead_time_history(vendor_name)`);

// ── 거래명세서 테이블 (v2 - 기존 invoice 플로우 대체) ──
await db.exec(`CREATE TABLE IF NOT EXISTS trade_document (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  po_number TEXT DEFAULT '',
  doc_type TEXT DEFAULT 'purchase',
  vendor_name TEXT DEFAULT '',
  vendor_type TEXT DEFAULT 'material',
  items_json TEXT DEFAULT '[]',
  vendor_modified_json TEXT DEFAULT '',
  vendor_memo TEXT DEFAULT '',
  price_diff INTEGER DEFAULT 0,
  status TEXT DEFAULT 'sent',
  sent_at TEXT DEFAULT (datetime('now','localtime')),
  confirmed_at TEXT DEFAULT '',
  approved_at TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── 신규 테이블 인덱스 ──
await db.exec(`CREATE INDEX IF NOT EXISTS idx_shipment_po ON vendor_shipment_schedule(po_id)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_shipment_date ON vendor_shipment_schedule(ship_date)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_shipment_status ON vendor_shipment_schedule(status)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_doc_po ON trade_document(po_id)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_doc_status ON trade_document(status)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_trade_doc_vendor ON trade_document(vendor_name)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_lead_time_vendor ON process_lead_time(vendor_name)`);

// ── 후공정 단가 마스터 ──
await db.exec(`CREATE TABLE IF NOT EXISTS post_process_price (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  process_type TEXT NOT NULL,
  price_type TEXT DEFAULT 'per_unit',
  price_tier TEXT DEFAULT '',
  spec_condition TEXT DEFAULT '',
  unit_price REAL DEFAULT 0,
  effective_from TEXT DEFAULT '',
  effective_to TEXT DEFAULT '',
  source TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pp_price_vendor ON post_process_price(vendor_name)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pp_price_process ON post_process_price(process_type)`);

// ── 공정 담당자 마스터 (vendor × 공정 × 담당자) — 후공정 발주 이메일 CC 자동 라우팅 ──
await db.exec(`CREATE TABLE IF NOT EXISTS process_assignee (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  process_type TEXT NOT NULL,
  assignee_name TEXT DEFAULT '',
  assignee_email TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pa_vendor ON process_assignee(vendor_name)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pa_process ON process_assignee(process_type)`);
await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_pa_uniq ON process_assignee(vendor_name, process_type, assignee_email)`);

// ── 후공정 거래 이력 ──
await db.exec(`CREATE TABLE IF NOT EXISTS post_process_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  month TEXT NOT NULL,
  date TEXT DEFAULT '',
  product_code TEXT NOT NULL,
  process_type TEXT NOT NULL,
  spec TEXT DEFAULT '',
  qty TEXT DEFAULT '',
  product_qty TEXT DEFAULT '',
  unit_price REAL DEFAULT 0,
  amount REAL DEFAULT 0,
  os_number TEXT DEFAULT '',
  po_number TEXT DEFAULT '',
  imported_from TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pp_hist_vendor ON post_process_history(vendor_name)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pp_hist_product ON post_process_history(product_code)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pp_hist_month ON post_process_history(month)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pp_hist_process ON post_process_history(process_type)`);

// ── 제품별 후공정 매핑 ──
await db.exec(`CREATE TABLE IF NOT EXISTS product_process_map (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  process_type TEXT NOT NULL,
  default_spec TEXT DEFAULT '',
  default_price REAL DEFAULT 0,
  vendor_name TEXT DEFAULT '',
  occurrence INTEGER DEFAULT 1,
  last_amount REAL DEFAULT 0,
  last_month TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(product_code, process_type, vendor_name)
)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_ppm_product ON product_process_map(product_code)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_ppm_vendor ON product_process_map(vendor_name)`);

// ── 공정 타입 마스터 (동적 관리) ──
await db.exec(`CREATE TABLE IF NOT EXISTS process_types (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'post',
  group_name TEXT DEFAULT '',
  icon TEXT DEFAULT '⚙️',
  sort_order INTEGER DEFAULT 0,
  is_active INTEGER DEFAULT 1,
  default_vendor TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(name, category)
)`);
// 시드 데이터: 사용 중인 후공정 타입 9종 (2026-04-22 재확장).
// 과거 시드된 4종(세아리/레이져/실크/임가공)은 아래 마이그레이션에서 is_active=0 으로 비활성화.
// 우찌누끼/접지/코팅은 이전 트리밍에서 비활성화됐다가 이번에 재활성화.
try {
  const seedPost = [
    {name:'재단',sort:1},{name:'인쇄',sort:2},{name:'박/형압',sort:3},{name:'톰슨',sort:4},
    {name:'봉투가공',sort:5},{name:'단면접착',sort:6},
    {name:'우찌누끼',sort:7,vendor:'예지가'},{name:'접지',sort:8},{name:'코팅',sort:9}
  ];
  const seedBom = [
    {name:'오프셋인쇄',group:'인쇄',icon:'🖨️',sort:1},{name:'디지털인쇄',group:'인쇄',icon:'💻',sort:2},
    {name:'박가공',group:'후가공',icon:'✨',sort:3},{name:'형압',group:'후가공',icon:'🔲',sort:4},
    {name:'에폭시',group:'후가공',icon:'💎',sort:5},{name:'톰슨',group:'후가공',icon:'✂️',sort:6},
    {name:'코팅/라미',group:'후가공',icon:'🛡️',sort:7},{name:'접지',group:'제본',icon:'📐',sort:8},
    {name:'제본',group:'제본',icon:'📚',sort:9},{name:'포장',group:'포장',icon:'📦',sort:10},
    {name:'단면접착',group:'후가공',icon:'🩹',sort:11}
  ];
  const ins = db.prepare("INSERT OR IGNORE INTO process_types (name,category,group_name,icon,sort_order,default_vendor) VALUES (?,?,?,?,?,?)");
  for (const s of seedPost) await ins.run(s.name,'post','',s.icon||'⚙️',s.sort,s.vendor||'');
  for (const s of seedBom) await ins.run(s.name,'bom',s.group||'',s.icon||'⚙️',s.sort,'');
  // 마이그레이션 1: 더 이상 사용하지 않는 4종 비활성화 (기존 시드된 row 가 있을 때).
  // 데이터 삭제는 안 함 — 과거 po_items 의 process_type 으로 참조될 수 있어 hidden 처리만.
  try {
    await db.prepare("UPDATE process_types SET is_active=0 WHERE category='post' AND name IN ('세아리','레이져','실크','임가공')").run();
  } catch(_) {}
  // 마이그레이션 2: 이전 트리밍에서 비활성화됐던 3종(우찌누끼/접지/코팅) 재활성화 + sort_order 정리.
  // INSERT OR IGNORE 는 이미 존재하는 row 의 sort_order/is_active 를 덮어쓰지 않으므로 명시적으로 UPDATE.
  try {
    await db.prepare("UPDATE process_types SET is_active=1, sort_order=7 WHERE category='post' AND name='우찌누끼'").run();
    await db.prepare("UPDATE process_types SET is_active=1, sort_order=8 WHERE category='post' AND name='접지'").run();
    await db.prepare("UPDATE process_types SET is_active=1, sort_order=9 WHERE category='post' AND name='코팅'").run();
  } catch(_) {}
} catch(e) { console.warn('process_types 시드 데이터 삽입 실패 (무시):', e.message); }

// ── 품목 필드 변경 이력 ──
await db.exec(`CREATE TABLE IF NOT EXISTS product_field_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  field_name TEXT NOT NULL,
  old_value TEXT DEFAULT '',
  new_value TEXT DEFAULT '',
  changed_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pfh_code ON product_field_history(product_code)`);
// reason, changed_by 컬럼 추가 (기존 테이블 호환)
try { await db.exec("ALTER TABLE product_field_history ADD COLUMN reason TEXT DEFAULT ''"); } catch(_) {}
try { await db.exec("ALTER TABLE product_field_history ADD COLUMN changed_by TEXT DEFAULT ''"); } catch(_) {}

// ── 중국 선적 이력 ──
await db.exec(`CREATE TABLE IF NOT EXISTS china_shipment_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_date TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  total_boxes REAL DEFAULT 0,
  total_items INTEGER DEFAULT 0,
  target_boxes INTEGER DEFAULT 500,
  items_json TEXT DEFAULT '[]',
  status TEXT DEFAULT 'draft',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── 중국 선적 이력: BL번호/선적일/예상도착일 컬럼 추가 ──
try { await db.exec("ALTER TABLE china_shipment_log ADD COLUMN bl_number TEXT DEFAULT ''"); } catch(_) {}
try { await db.exec("ALTER TABLE china_shipment_log ADD COLUMN ship_date TEXT DEFAULT ''"); } catch(_) {}
try { await db.exec("ALTER TABLE china_shipment_log ADD COLUMN eta_date TEXT DEFAULT ''"); } catch(_) {}

// ── 선적 ↔ PO 아이템 연결 (파셜 입고 추적) ──
await db.exec(`CREATE TABLE IF NOT EXISTS shipment_po_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  shipment_id INTEGER NOT NULL,
  po_id INTEGER NOT NULL,
  po_item_id INTEGER,
  product_code TEXT DEFAULT '',
  product_name TEXT DEFAULT '',
  shipped_qty INTEGER DEFAULT 0,
  received_qty INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  UNIQUE(shipment_id, po_item_id)
)`);

// ── 더기프트 포장작업 ──
await db.exec(`CREATE TABLE IF NOT EXISTS gift_assembly (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_no TEXT UNIQUE,
  product_code TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  target_qty INTEGER DEFAULT 0,
  completed_qty INTEGER DEFAULT 0,
  status TEXT DEFAULT 'planned',
  assembly_date TEXT,
  completed_date TEXT,
  worker_name TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);

await db.exec(`CREATE TABLE IF NOT EXISTS gift_assembly_materials (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  assembly_id INTEGER NOT NULL,
  item_code TEXT NOT NULL,
  item_name TEXT DEFAULT '',
  required_qty INTEGER DEFAULT 0,
  issued_qty INTEGER DEFAULT 0,
  lot_id INTEGER,
  UNIQUE(assembly_id, item_code)
)`);

// ── 거래명세서 파일 관리 ──
await db.exec(`CREATE TABLE IF NOT EXISTS trade_doc_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  period TEXT NOT NULL,
  file_name TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  total_amount REAL DEFAULT 0,
  item_count INTEGER DEFAULT 0,
  parsed_at TEXT DEFAULT '',
  status TEXT DEFAULT 'uploaded',
  uploaded_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── 활동 로그 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS po_activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  po_number TEXT DEFAULT '',
  action TEXT NOT NULL,
  actor TEXT DEFAULT '',
  actor_type TEXT DEFAULT '',
  from_status TEXT DEFAULT '',
  to_status TEXT DEFAULT '',
  from_material_status TEXT DEFAULT '',
  to_material_status TEXT DEFAULT '',
  from_process_status TEXT DEFAULT '',
  to_process_status TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_activity_po ON po_activity_log(po_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_activity_date ON po_activity_log(created_at)");

// ── po_items에 ship_date 컬럼 추가 (품목별 출고일) ──
try { await db.exec(`ALTER TABLE po_items ADD COLUMN ship_date TEXT DEFAULT ''`); } catch(e) {}
try { await db.exec(`ALTER TABLE po_items ADD COLUMN os_number TEXT DEFAULT ''`); } catch(e) {}
try { await db.exec(`ALTER TABLE po_items ADD COLUMN produced_qty INTEGER DEFAULT 0`); } catch(e) {}
try { await db.exec(`ALTER TABLE po_items ADD COLUMN defect_qty INTEGER DEFAULT 0`); } catch(e) {}
try { await db.exec(`ALTER TABLE po_items ADD COLUMN unit_price REAL DEFAULT 0`); } catch(e) {}
try { await db.exec(`ALTER TABLE po_items ADD COLUMN amount REAL DEFAULT 0`); } catch(e) {}
try { await db.exec(`ALTER TABLE po_items ADD COLUMN tax_amount REAL DEFAULT 0`); } catch(e) {}
try { await db.exec(`ALTER TABLE po_items ADD COLUMN received_date TEXT DEFAULT ''`); } catch(e) {}

// ── 구매마감 업체 첨부파일 (세금계산서/거래명세서) ──
await db.exec(`CREATE TABLE IF NOT EXISTS purchase_closing_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  closing_year INTEGER NOT NULL,
  closing_month INTEGER NOT NULL,
  legal_entity TEXT NOT NULL DEFAULT 'barunson',
  vendor_name TEXT NOT NULL,
  file_name TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_type TEXT DEFAULT '',
  file_size INTEGER DEFAULT 0,
  parsed_total REAL DEFAULT 0,
  parsed_tax REAL DEFAULT 0,
  parsed_data TEXT DEFAULT '[]',
  match_status TEXT DEFAULT 'pending',
  notes TEXT DEFAULT '',
  uploaded_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── 거래처 불량 보고 ──
await db.exec(`CREATE TABLE IF NOT EXISTS vendor_defect_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER NOT NULL,
  item_id INTEGER,
  product_code TEXT,
  vendor_name TEXT,
  defect_type TEXT NOT NULL,
  defect_qty INTEGER DEFAULT 0,
  description TEXT DEFAULT '',
  action_taken TEXT DEFAULT '',
  status TEXT DEFAULT 'reported',
  reported_at TEXT DEFAULT (datetime('now','localtime')),
  resolved_at TEXT,
  resolved_by TEXT
)`);

// ── 불량/품질 관리 ──
await db.exec(`CREATE TABLE IF NOT EXISTS defects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  defect_number TEXT NOT NULL UNIQUE,
  po_id INTEGER,
  po_number TEXT DEFAULT '',
  vendor_name TEXT NOT NULL,
  product_code TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  defect_date TEXT NOT NULL,
  defect_type TEXT NOT NULL DEFAULT '',
  defect_qty INTEGER NOT NULL DEFAULT 0,
  order_qty INTEGER NOT NULL DEFAULT 0,
  severity TEXT NOT NULL DEFAULT 'minor',
  description TEXT NOT NULL DEFAULT '',
  photo_url TEXT DEFAULT '',
  claim_type TEXT DEFAULT '',
  claim_amount REAL DEFAULT 0,
  resolution TEXT DEFAULT '',
  resolved_date TEXT DEFAULT '',
  resolved_by TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'registered',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_defect_vendor ON defects(vendor_name)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_defect_product ON defects(product_code)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_defect_status ON defects(status)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_defect_date ON defects(defect_date)");

await db.exec(`CREATE TABLE IF NOT EXISTS defect_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  defect_id INTEGER NOT NULL,
  defect_number TEXT DEFAULT '',
  action TEXT NOT NULL,
  from_status TEXT DEFAULT '',
  to_status TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (defect_id) REFERENCES defects(id)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_defect_log_defect ON defect_logs(defect_id)");

// ── 생산요청 관리 ──
await db.exec(`CREATE TABLE IF NOT EXISTS production_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number TEXT NOT NULL UNIQUE,
  product_type TEXT NOT NULL DEFAULT '',
  product_name TEXT NOT NULL DEFAULT '',
  brand TEXT DEFAULT '',
  requested_qty INTEGER NOT NULL DEFAULT 0,
  spec_json TEXT DEFAULT '{}',
  requester TEXT DEFAULT '',
  designer TEXT DEFAULT '',
  printer_vendor TEXT DEFAULT '',
  post_vendor TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'requested',
  priority TEXT DEFAULT 'normal',
  due_date TEXT DEFAULT '',
  design_confirmed_at TEXT DEFAULT '',
  data_confirmed_at TEXT DEFAULT '',
  production_started_at TEXT DEFAULT '',
  completed_at TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_pr_status ON production_requests(status)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_pr_type ON production_requests(product_type)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_pr_date ON production_requests(created_at)");

await db.exec(`CREATE TABLE IF NOT EXISTS production_request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  request_number TEXT DEFAULT '',
  action TEXT NOT NULL,
  from_status TEXT DEFAULT '',
  to_status TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (request_id) REFERENCES production_requests(id)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_pr_log_req ON production_request_logs(request_id)");

// ── 제품 스펙 마스터 ──
await db.exec(`CREATE TABLE IF NOT EXISTS product_spec_master (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_type TEXT NOT NULL DEFAULT '',
  spec_name TEXT NOT NULL DEFAULT '',
  brand TEXT DEFAULT '',
  paper_cover TEXT DEFAULT '',
  paper_inner TEXT DEFAULT '',
  print_method TEXT DEFAULT '',
  print_color TEXT DEFAULT '',
  binding TEXT DEFAULT '',
  post_process TEXT DEFAULT '',
  size TEXT DEFAULT '',
  pages INTEGER DEFAULT 0,
  weight TEXT DEFAULT '',
  extras TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  is_template INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_spec_type ON product_spec_master(product_type)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_spec_template ON product_spec_master(is_template)");

// ── 수입검사 (Incoming Inspection) ──
await db.exec(`CREATE TABLE IF NOT EXISTS incoming_inspections (
  inspection_id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_id INTEGER,
  po_number TEXT DEFAULT '',
  vendor_name TEXT DEFAULT '',
  inspection_date TEXT DEFAULT (date('now','localtime')),
  inspector TEXT DEFAULT '',
  result TEXT NOT NULL DEFAULT 'pending',
  items_json TEXT DEFAULT '[]',
  total_qty INTEGER DEFAULT 0,
  pass_qty INTEGER DEFAULT 0,
  fail_qty INTEGER DEFAULT 0,
  pass_rate REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_insp_po ON incoming_inspections(po_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_insp_date ON incoming_inspections(inspection_date)");

// ── 부적합 처리 (Non-Conformance Report) ──
await db.exec(`CREATE TABLE IF NOT EXISTS ncr (
  ncr_id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_number TEXT NOT NULL UNIQUE,
  defect_id INTEGER,
  inspection_id INTEGER,
  po_id INTEGER,
  vendor_name TEXT DEFAULT '',
  product_code TEXT DEFAULT '',
  ncr_type TEXT DEFAULT 'incoming',
  description TEXT DEFAULT '',
  root_cause TEXT DEFAULT '',
  corrective_action TEXT DEFAULT '',
  preventive_action TEXT DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open',
  severity TEXT DEFAULT 'minor',
  responsible TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  closed_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_ncr_status ON ncr(status)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_ncr_vendor ON ncr(vendor_name)");

await db.exec(`CREATE TABLE IF NOT EXISTS ncr_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ncr_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  from_status TEXT DEFAULT '',
  to_status TEXT DEFAULT '',
  actor TEXT DEFAULT '',
  details TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── 협력사 평가 (Vendor Scorecard) ──
await db.exec(`CREATE TABLE IF NOT EXISTS vendor_scorecard (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_name TEXT NOT NULL,
  eval_month TEXT NOT NULL,
  delivery_score REAL DEFAULT 0,
  quality_score REAL DEFAULT 0,
  price_score REAL DEFAULT 0,
  total_score REAL DEFAULT 0,
  total_po INTEGER DEFAULT 0,
  ontime_po INTEGER DEFAULT 0,
  total_defects INTEGER DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(vendor_name, eval_month)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_vs_vendor ON vendor_scorecard(vendor_name)");

// ── 중국 상품별 단가 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS china_price_tiers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  product_type TEXT DEFAULT 'Card',
  qty_tier INTEGER NOT NULL,
  unit_price REAL NOT NULL,
  currency TEXT DEFAULT 'CNY',
  effective_date TEXT DEFAULT '2025-05-01',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(product_code, qty_tier)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_cpt_product ON china_price_tiers(product_code)");

// ── 중국 재고 DB (매주 엑셀 업로드) ──────────────────────────────
await db.exec(`CREATE TABLE IF NOT EXISTS china_inventory (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  product_name TEXT DEFAULT '',
  cn_stock INTEGER DEFAULT 0,
  incoming_qty INTEGER DEFAULT 0,
  incoming_date TEXT DEFAULT '',
  upload_date TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(product_code)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_china_inv_code ON china_inventory(product_code)");
// china_inventory 컬럼 확장 (PO 양식)
try { await db.exec("ALTER TABLE china_inventory ADD COLUMN po_no TEXT DEFAULT ''"); } catch(_) {}
try { await db.exec("ALTER TABLE china_inventory ADD COLUMN order_qty INTEGER DEFAULT 0"); } catch(_) {}
try { await db.exec("ALTER TABLE china_inventory ADD COLUMN order_date TEXT DEFAULT ''"); } catch(_) {}
try { await db.exec("ALTER TABLE china_inventory ADD COLUMN due_date TEXT DEFAULT ''"); } catch(_) {}
try { await db.exec("ALTER TABLE china_inventory ADD COLUMN received_qty INTEGER DEFAULT 0"); } catch(_) {}
try { await db.exec("ALTER TABLE china_inventory ADD COLUMN unproduced_qty INTEGER DEFAULT 0"); } catch(_) {}
try { await db.exec("ALTER TABLE china_inventory ADD COLUMN is_complete TEXT DEFAULT 'N'"); } catch(_) {}

// ── 인증/권한 테이블 (S1) ─────────────────────────────────────────
await db.exec(`CREATE TABLE IF NOT EXISTS users (
  user_id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password_hash TEXT NOT NULL DEFAULT '',
  display_name TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT 'viewer',
  email TEXT DEFAULT '',
  google_id TEXT DEFAULT '',
  profile_picture TEXT DEFAULT '',
  is_active INTEGER DEFAULT 1,
  last_login TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
// google_id, profile_picture, permissions 컬럼 마이그레이션
try { await db.exec("ALTER TABLE users ADD COLUMN google_id TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE users ADD COLUMN profile_picture TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE users ADD COLUMN permissions TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE users ADD COLUMN favorites TEXT DEFAULT '[]'"); } catch {}
try { await db.exec("ALTER TABLE vendors ADD COLUMN email_cc TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE product_post_vendor ADD COLUMN step_order INTEGER DEFAULT 1"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN process_step INTEGER DEFAULT 0"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN parent_po_id INTEGER DEFAULT NULL"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN process_chain TEXT DEFAULT ''"); } catch {}
// ±5% tolerance + force-approve columns
try { await db.exec("ALTER TABLE po_header ADD COLUMN tolerance_pct REAL DEFAULT 5.0"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN force_completed INTEGER DEFAULT 0"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN force_completed_by TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN force_completed_at TEXT DEFAULT ''"); } catch {}
// 제지사→후공정 2-stage flow columns
try { await db.exec("ALTER TABLE po_header ADD COLUMN material_vendor_name TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN process_vendor_name TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN material_send_date TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN material_confirmed_at TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE po_header ADD COLUMN process_email_sent INTEGER DEFAULT 0"); } catch {}
// 거래처 입고일 확정
try { await db.exec("ALTER TABLE po_header ADD COLUMN vendor_confirmed_date TEXT DEFAULT ''"); } catch {} // 거래처가 확정한 입고일
try { await db.exec("ALTER TABLE po_header ADD COLUMN vendor_confirmed_at TEXT DEFAULT ''"); } catch {} // 확정 시각
// 중국 신제품/리오더 구분
try { await db.exec("ALTER TABLE po_header ADD COLUMN order_type TEXT DEFAULT ''"); } catch {} // new/reorder
// 더기프트 출고 트래킹
try { await db.exec("ALTER TABLE gift_assembly ADD COLUMN delivery_status TEXT DEFAULT ''"); } catch {} // packed/shipped/delivered
try { await db.exec("ALTER TABLE gift_assembly ADD COLUMN tracking_number TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE gift_assembly ADD COLUMN carrier TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE gift_assembly ADD COLUMN shipped_date TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE gift_assembly ADD COLUMN delivered_date TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE gift_assembly ADD COLUMN delivery_address TEXT DEFAULT ''"); } catch {}
try { await db.exec("ALTER TABLE gift_assembly ADD COLUMN recipient_name TEXT DEFAULT ''"); } catch {}

// ── po_header.origin 빈 값 backfill (품목 → products.origin 매핑) ──
try {
  const emptyOriginPOs = await db.prepare("SELECT po_id FROM po_header WHERE origin='' OR origin IS NULL").all();
  let backfilled = 0;
  for (const po of emptyOriginPOs) {
    const item = await db.prepare("SELECT pi.product_code FROM po_items pi WHERE pi.po_id=? LIMIT 1").get(po.po_id);
    if (item) {
      const prod = await db.prepare("SELECT origin FROM products WHERE product_code=?").get(item.product_code);
      if (prod && prod.origin) {
        await db.prepare("UPDATE po_header SET origin=? WHERE po_id=?").run(prod.origin, po.po_id);
        backfilled++;
      }
    }
  }
  if (backfilled > 0) console.log(`[origin backfill] ${backfilled}/${emptyOriginPOs.length} PO에 origin 설정 완료`);
} catch (e) { console.warn('origin backfill 실패:', e.message); }

// ── 업무관리 ──────────────────────────────────────────────────────
await db.exec(`CREATE TABLE IF NOT EXISTS tasks (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_number TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT DEFAULT '기타',
  status TEXT NOT NULL DEFAULT 'todo',
  priority TEXT NOT NULL DEFAULT 'normal',
  assignee TEXT DEFAULT '',
  due_date TEXT DEFAULT '',
  start_date TEXT DEFAULT '',
  completed_at TEXT DEFAULT '',
  related_po TEXT DEFAULT '',
  related_vendor TEXT DEFAULT '',
  tags TEXT DEFAULT '',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_task_status ON tasks(status)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_task_due ON tasks(due_date)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_task_assignee ON tasks(assignee)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_task_category ON tasks(category)");

await db.exec(`CREATE TABLE IF NOT EXISTS task_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  author TEXT DEFAULT '',
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  FOREIGN KEY (task_id) REFERENCES tasks(id)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_tc_task ON task_comments(task_id)");

// ── 업무 단계 (Workflow Steps) ──
await db.exec(`CREATE TABLE IF NOT EXISTS task_steps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  step_order INTEGER NOT NULL DEFAULT 0,
  step_name TEXT NOT NULL,
  step_type TEXT NOT NULL DEFAULT 'text',
  value TEXT DEFAULT '',
  is_done INTEGER DEFAULT 0,
  done_at TEXT DEFAULT '',
  note TEXT DEFAULT '',
  FOREIGN KEY (task_id) REFERENCES tasks(id)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_ts_task ON task_steps(task_id)");

// ── tasks 테이블에 template_id 컬럼 추가 ──
try { await db.exec("ALTER TABLE tasks ADD COLUMN template_id TEXT DEFAULT ''"); } catch(_) {}

// ── 부속품 마스터 ──
await db.exec(`CREATE TABLE IF NOT EXISTS accessories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  acc_code TEXT DEFAULT '',
  acc_name TEXT NOT NULL,
  acc_type TEXT DEFAULT '기타',
  current_stock INTEGER DEFAULT 0,
  min_stock INTEGER DEFAULT 0,
  unit TEXT DEFAULT '개',
  vendor TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);

try { await db.exec("ALTER TABLE accessories ADD COLUMN origin TEXT DEFAULT '한국'"); } catch(_) {}

// ── 제품↔부속품 연결 ──
await db.exec(`CREATE TABLE IF NOT EXISTS product_accessories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code TEXT NOT NULL,
  acc_id INTEGER NOT NULL,
  qty_per INTEGER DEFAULT 1,
  UNIQUE(product_code, acc_id)
)`);

await db.exec(`CREATE TABLE IF NOT EXISTS po_drafts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  po_number TEXT NOT NULL,
  po_date TEXT,
  due_date TEXT,
  vendor_id INTEGER DEFAULT 0,
  vendor_name TEXT DEFAULT '',
  vendor_contact TEXT DEFAULT '',
  vendor_phone TEXT DEFAULT '',
  vendor_email TEXT DEFAULT '',
  issuer_name TEXT DEFAULT '바른컴퍼니',
  issuer_contact TEXT DEFAULT '',
  issuer_phone TEXT DEFAULT '',
  issuer_email TEXT DEFAULT '',
  payment_terms TEXT DEFAULT '',
  remark TEXT DEFAULT '',
  items TEXT DEFAULT '[]',
  total_supply INTEGER DEFAULT 0,
  total_tax INTEGER DEFAULT 0,
  total_amount INTEGER DEFAULT 0,
  status TEXT DEFAULT 'sent',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// v1.0.9: vendor_notes 테이블 (미팅일지) — CREATE 누락 수정
await db.exec(`CREATE TABLE IF NOT EXISTS vendor_notes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  vendor_id INTEGER,
  vendor_name TEXT DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  content TEXT DEFAULT '',
  note_type TEXT DEFAULT 'meeting',
  note_date TEXT DEFAULT (date('now','localtime')),
  status TEXT DEFAULT 'open',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
try { await db.exec("ALTER TABLE vendor_notes ADD COLUMN status TEXT DEFAULT 'open'"); } catch(_) {}
try { await db.exec("ALTER TABLE vendor_notes ADD COLUMN updated_at TEXT DEFAULT (datetime('now','localtime'))"); } catch(_) {}

// ── 자료함 (reference docs) ──
await db.exec(`CREATE TABLE IF NOT EXISTS reference_docs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL DEFAULT 'link',
  title TEXT NOT NULL DEFAULT '',
  url TEXT DEFAULT '',
  file_path TEXT DEFAULT '',
  file_name TEXT DEFAULT '',
  file_size INTEGER DEFAULT 0,
  category TEXT DEFAULT '',
  memo TEXT DEFAULT '',
  uploader TEXT DEFAULT '',
  uploader_id INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
// v1.0.8: po_drafts 법인 분리
try { await db.exec("ALTER TABLE po_drafts ADD COLUMN legal_entity TEXT DEFAULT 'barunson'"); } catch(_) {}
// v1.0.9: po_drafts 완료/연결PO
try { await db.exec("ALTER TABLE po_drafts ADD COLUMN linked_po_id INTEGER DEFAULT 0"); } catch(_) {}
try { await db.exec("ALTER TABLE po_drafts ADD COLUMN completed_at TEXT"); } catch(_) {}

// ── 불량 클레임 정산 (defect settlements) ──
await db.exec(`CREATE TABLE IF NOT EXISTS defect_settlements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  defect_id INTEGER NOT NULL,
  defect_number TEXT DEFAULT '',
  vendor_name TEXT NOT NULL,
  claim_amount REAL DEFAULT 0,
  settled_amount REAL DEFAULT 0,
  balance REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  applied_po_id INTEGER,
  applied_po_number TEXT DEFAULT '',
  applied_at TEXT DEFAULT '',
  applied_by TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_settle_vendor ON defect_settlements(vendor_name)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_settle_status ON defect_settlements(status)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_settle_defect ON defect_settlements(defect_id)");

await db.exec(`CREATE TABLE IF NOT EXISTS note_comments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id INTEGER NOT NULL,
  author TEXT DEFAULT '',
  content TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_nc_note ON note_comments(note_id)");

await db.exec(`CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  subtitle TEXT DEFAULT '',
  report_type TEXT DEFAULT 'general',
  content TEXT DEFAULT '{}',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── 워크플로우 템플릿 (하드코딩, DB 필요 없음) ──
const TASK_TEMPLATES = {
  'cn-order': {
    name: '🇨🇳 중국 발주 프로세스',
    category: '발주',
    steps: [
      { name: 'ERP 발주서 작성', type: 'text', placeholder: 'PO번호 입력 (예: PO-260001)' },
      { name: '발주서 이메일 발송', type: 'checkbox', placeholder: '' },
      { name: '업체 납기 확인', type: 'date', placeholder: '업체 확인 납기일' },
      { name: '예상 선적일', type: 'date', placeholder: '예상 선적일' },
      { name: 'BL번호 / 선적 완료', type: 'text', placeholder: 'BL번호 입력' },
      { name: '예상 통관일', type: 'date', placeholder: '예상 통관일' },
      { name: '실제 통관일', type: 'date', placeholder: '실제 통관 완료일' },
      { name: '입고 처리 완료', type: 'checkbox', placeholder: '' },
    ]
  },
  'kr-order': {
    name: '🇰🇷 한국 발주 프로세스',
    category: '발주',
    steps: [
      { name: 'ERP 발주서 작성', type: 'text', placeholder: 'PO번호 입력' },
      { name: '발주서 이메일 발송', type: 'checkbox', placeholder: '' },
      { name: '업체 납기 확인', type: 'date', placeholder: '납기일' },
      { name: '후공정 완료', type: 'date', placeholder: '후공정 완료일' },
      { name: '입고 예정일', type: 'date', placeholder: '입고 예정일' },
      { name: '실제 입고일', type: 'date', placeholder: '실제 입고 완료일' },
      { name: '검수 완료', type: 'checkbox', placeholder: '' },
    ]
  },
  'gift-order': {
    name: '🎁 더기프트 발주 프로세스',
    category: '발주',
    steps: [
      { name: 'ERP 발주서 작성', type: 'text', placeholder: 'PO번호 입력' },
      { name: '발주서 이메일 발송', type: 'checkbox', placeholder: '' },
      { name: '업체 납기 확인', type: 'date', placeholder: '납기일' },
      { name: '입고 예정일', type: 'date', placeholder: '입고 예정일' },
      { name: '실제 입고일', type: 'date', placeholder: '실제 입고 완료일' },
      { name: '검수 완료', type: 'checkbox', placeholder: '' },
    ]
  },
  'vendor-issue': {
    name: '🔴 거래처 이슈 처리',
    category: '거래처',
    steps: [
      { name: '이슈 내용 확인', type: 'text', placeholder: '이슈 요약' },
      { name: '거래처 연락', type: 'date', placeholder: '연락일' },
      { name: '거래처 답변 수신', type: 'text', placeholder: '답변 내용 요약' },
      { name: '내부 검토 완료', type: 'checkbox', placeholder: '' },
      { name: '처리 완료', type: 'date', placeholder: '처리 완료일' },
    ]
  },
  'custom': {
    name: '✏️ 직접 단계 입력',
    category: '',
    steps: []
  }
};

// password_hash NOT NULL 제거 불가능하므로 기본값 허용
try { await db.exec("UPDATE users SET password_hash = '' WHERE password_hash IS NULL"); } catch {}

await db.exec(`CREATE TABLE IF NOT EXISTS audit_log (
  log_id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,
  username TEXT DEFAULT '',
  action TEXT NOT NULL,
  resource TEXT DEFAULT '',
  resource_id TEXT DEFAULT '',
  details TEXT DEFAULT '',
  ip_address TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_audit_user ON audit_log(user_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at)");

await db.exec(`CREATE TABLE IF NOT EXISTS error_logs (
  error_id INTEGER PRIMARY KEY AUTOINCREMENT,
  level TEXT DEFAULT 'error',
  message TEXT NOT NULL,
  stack TEXT DEFAULT '',
  url TEXT DEFAULT '',
  method TEXT DEFAULT '',
  user_id INTEGER,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_error_created ON error_logs(created_at)");

// ── 더기프트 세트 생산재고 ─────────────────────────────────────────
await db.exec(`CREATE TABLE IF NOT EXISTS gift_sets (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  set_code      TEXT NOT NULL UNIQUE,
  set_name      TEXT NOT NULL,
  description   TEXT DEFAULT '',
  base_stock    INTEGER DEFAULT 0,
  current_stock INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'active',
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  updated_at    TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_gs_code ON gift_sets(set_code)");

// xerp_code 컬럼 추가 (출고재고 XERP 연동용)
try { await db.exec("ALTER TABLE gift_sets ADD COLUMN xerp_code TEXT DEFAULT ''"); } catch(e) { /* 이미 존재 */ }

await db.exec(`CREATE TABLE IF NOT EXISTS gift_set_bom (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id        INTEGER NOT NULL,
  item_type     TEXT NOT NULL,
  item_code     TEXT NOT NULL,
  item_name     TEXT DEFAULT '',
  qty_per       REAL DEFAULT 1,
  unit          TEXT DEFAULT 'EA',
  UNIQUE(set_id, item_type, item_code)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_gsb_set ON gift_set_bom(set_id)");

await db.exec(`CREATE TABLE IF NOT EXISTS gift_set_transactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id     INTEGER NOT NULL,
  tx_type    TEXT NOT NULL,
  qty        INTEGER NOT NULL,
  operator   TEXT DEFAULT '',
  memo       TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_gst_set ON gift_set_transactions(set_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_gst_created ON gift_set_transactions(created_at)");

// ── 더기프트 출고 스케줄 (출고예정 관리) ──
await db.exec(`CREATE TABLE IF NOT EXISTS gift_shipment_schedule (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  set_id        INTEGER NOT NULL,
  set_code      TEXT DEFAULT '',
  set_name      TEXT DEFAULT '',
  ship_date     TEXT NOT NULL,
  planned_qty   INTEGER DEFAULT 0,
  shipped_qty   INTEGER DEFAULT 0,
  status        TEXT DEFAULT 'planned',
  order_ref     TEXT DEFAULT '',
  recipient     TEXT DEFAULT '',
  address       TEXT DEFAULT '',
  notes         TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now','localtime')),
  updated_at    TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_gss_set ON gift_shipment_schedule(set_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_gss_date ON gift_shipment_schedule(ship_date)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_gss_status ON gift_shipment_schedule(status)");

// 소비기한 관리 컬럼 추가
try { await db.exec("ALTER TABLE gift_sets ADD COLUMN expiry_date TEXT DEFAULT ''"); } catch(e) {}
try { await db.exec("ALTER TABLE gift_set_transactions ADD COLUMN expiry_date TEXT DEFAULT ''"); } catch(e) {}

// ── 더기프트 품목 자동 등록 (gift_sets + BOM → products) ──
try {
  const giftSets = await db.prepare("SELECT set_code, set_name FROM gift_sets").all();
  const bomItems = await db.prepare("SELECT DISTINCT item_code, item_name FROM gift_set_bom").all();
  const allGiftCodes = new Map();
  giftSets.forEach(s => allGiftCodes.set(s.set_code, s.set_name));
  bomItems.forEach(b => { if (!allGiftCodes.has(b.item_code)) allGiftCodes.set(b.item_code, b.item_name); });
  if (allGiftCodes.size > 0) {
    const upsert = db.prepare(`INSERT INTO products (product_code, product_name, brand, origin, status)
      VALUES (?, ?, '바른손카드', '더기프트', 'active')
      ON CONFLICT(product_code) DO UPDATE SET origin='더기프트', status='active', updated_at=NOW()
      WHERE products.origin != '더기프트'`);
    const tx = db.transaction(async () => { for (const [code, name] of allGiftCodes) await upsert.run(code, name || ''); });
    await tx();
    console.log(`더기프트 품목 자동 등록/업데이트: ${allGiftCodes.size}건`);
  }
} catch(e) { console.warn('더기프트 품목 자동등록 실패:', e.message); }

// ── 매출관리 캐시 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS sales_daily_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_date       TEXT NOT NULL,
  source          TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT '',
  total_orders    INTEGER DEFAULT 0,
  total_qty       INTEGER DEFAULT 0,
  total_sales     INTEGER DEFAULT 0,
  total_supply    INTEGER DEFAULT 0,
  total_vat       INTEGER DEFAULT 0,
  total_fee       INTEGER DEFAULT 0,
  cached_at       TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(sale_date, source, channel)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_sdc_date ON sales_daily_cache(sale_date)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_sdc_source ON sales_daily_cache(source)");

await db.exec(`CREATE TABLE IF NOT EXISTS sales_monthly_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_month      TEXT NOT NULL,
  source          TEXT NOT NULL,
  channel         TEXT NOT NULL DEFAULT '',
  total_orders    INTEGER DEFAULT 0,
  total_qty       INTEGER DEFAULT 0,
  total_sales     INTEGER DEFAULT 0,
  total_supply    INTEGER DEFAULT 0,
  total_vat       INTEGER DEFAULT 0,
  total_fee       INTEGER DEFAULT 0,
  cached_at       TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(sale_month, source, channel)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_smc_month ON sales_monthly_cache(sale_month)");

await db.exec(`CREATE TABLE IF NOT EXISTS sales_product_cache (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  sale_month      TEXT NOT NULL,
  source          TEXT NOT NULL,
  product_code    TEXT NOT NULL,
  product_name    TEXT DEFAULT '',
  brand           TEXT DEFAULT '',
  total_orders    INTEGER DEFAULT 0,
  total_qty       INTEGER DEFAULT 0,
  total_sales     INTEGER DEFAULT 0,
  cached_at       TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(sale_month, source, product_code)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_spc_month ON sales_product_cache(sale_month)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_spc_product ON sales_product_cache(product_code)");

await db.exec(`CREATE TABLE IF NOT EXISTS sales_settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("INSERT OR IGNORE INTO sales_settings (key, value) VALUES ('default_range_days', '30')");
await db.exec("INSERT OR IGNORE INTO sales_settings (key, value) VALUES ('cache_ttl_minutes', '30')");

// ── 다중 창고 재고 관리 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS warehouses (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  location    TEXT DEFAULT '',
  description TEXT DEFAULT '',
  is_default  INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'active',
  legal_entity TEXT NOT NULL DEFAULT 'barunson',
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  updated_at  TEXT DEFAULT (datetime('now','localtime'))
)`);
// 기존 DB 호환: legal_entity 컬럼 없을 시 추가
try { await db.exec("ALTER TABLE warehouses ADD COLUMN legal_entity TEXT NOT NULL DEFAULT 'barunson'"); } catch(_){}

await db.exec(`CREATE TABLE IF NOT EXISTS warehouse_inventory (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id  INTEGER NOT NULL,
  product_code  TEXT NOT NULL,
  product_name  TEXT DEFAULT '',
  quantity      INTEGER DEFAULT 0,
  memo          TEXT DEFAULT '',
  updated_at    TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(warehouse_id, product_code)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_wi_wh ON warehouse_inventory(warehouse_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_wi_pc ON warehouse_inventory(product_code)");

await db.exec(`CREATE TABLE IF NOT EXISTS warehouse_transfers (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  from_warehouse  INTEGER NOT NULL,
  to_warehouse    INTEGER NOT NULL,
  product_code    TEXT NOT NULL,
  product_name    TEXT DEFAULT '',
  quantity        INTEGER NOT NULL,
  operator        TEXT DEFAULT '',
  memo            TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_wt_from ON warehouse_transfers(from_warehouse)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_wt_to ON warehouse_transfers(to_warehouse)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_wt_created ON warehouse_transfers(created_at)");

await db.exec(`CREATE TABLE IF NOT EXISTS warehouse_adjustments (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  warehouse_id  INTEGER NOT NULL,
  product_code  TEXT NOT NULL,
  product_name  TEXT DEFAULT '',
  adj_type      TEXT NOT NULL,
  before_qty    INTEGER DEFAULT 0,
  after_qty     INTEGER DEFAULT 0,
  diff_qty      INTEGER DEFAULT 0,
  reason        TEXT DEFAULT '',
  operator      TEXT DEFAULT '',
  created_at    TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_wa_wh ON warehouse_adjustments(warehouse_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_wa_created ON warehouse_adjustments(created_at)");

// 기본 창고 초기화 (처음 실행 시)
const whCount = await db.prepare("SELECT COUNT(*) as cnt FROM warehouses").get();
if (whCount.cnt === 0) {
  const insertWh = db.prepare("INSERT INTO warehouses (code, name, location, description, is_default, legal_entity) VALUES (?, ?, ?, ?, ?, ?)");
  await insertWh.run('WH-HQ', '(바른컴퍼니) 본사창고', '본사', 'XERP 연동 기본 창고', 1, 'barunson');
  await insertWh.run('WH-02', '(바른컴퍼니) 제2창고', '', '', 0, 'barunson');
  await insertWh.run('WH-03', '(바른컴퍼니) 제3창고', '', '', 0, 'barunson');
  await insertWh.run('WH-04', '(바른컴퍼니) 제4창고', '', '', 0, 'barunson');
  console.log('[DB] 기본 창고 4개 초기화 완료');
}

// 기존 시드 창고 마이그레이션 — 이름 prefix + legal_entity 태깅 (멱등)
try {
  await db.exec(`UPDATE warehouses SET name = '(바른컴퍼니) ' || name
    WHERE code IN ('WH-HQ','WH-02','WH-03','WH-04')
      AND name NOT LIKE '(바른컴퍼니)%' AND name NOT LIKE '(디얼디어)%'`);
  await db.exec(`UPDATE warehouses SET legal_entity='barunson'
    WHERE (legal_entity IS NULL OR legal_entity='')`);
} catch(_){}

// ── 디얼디어 마스터 자동 import (멱등) ──
// 파일: dd_master.json (디얼디어 스마트재고현황 엑셀에서 추출)
// 동작: products 테이블에 UPSERT — 신규는 INSERT, 기존은 brand/origin/category/status/legal_entity 갱신
//       사용자 편집 가능 컬럼(product_name, material_*, op_category, is_new_product, memo, spec)은 건드리지 않음
try {
  const _ddMasterPath = path.join(__dirname, 'dd_master.json');
  if (fs.existsSync(_ddMasterPath)) {
    const _ddRaw = JSON.parse(fs.readFileSync(_ddMasterPath, 'utf-8'));
    const _ddItems = Array.isArray(_ddRaw) ? _ddRaw : (_ddRaw.items || []);
    let _ddInserted = 0, _ddUpdated = 0, _ddFailed = 0;
    // temp_code 컬럼 존재 여부 런타임 체크
    let _hasTempCodeMig = false;
    try { await db.prepare('SELECT temp_code FROM products LIMIT 1').get(); _hasTempCodeMig = true; } catch(_){}

    let _ddSkippedBarunson = 0;
    for (const it of _ddItems) {
      const code = (it.product_code || '').trim();
      if (!code) continue;
      try {
        // 존재 여부 확인 + 안전장치: 바른컴퍼니로 등록된 코드는 hijack 금지 (DD엑셀에 같은 코드가 있어도 skip)
        const exists = await db.prepare("SELECT legal_entity FROM products WHERE product_code=?").get(code);
        if (exists) {
          if (exists.legal_entity === 'barunson') {
            // 바른컴퍼니 품목과 코드 충돌 — 사용자 확인 필요. skip.
            _ddSkippedBarunson++;
            continue;
          }
          // 기존 DD 품목 갱신 — 마스터 컬럼만
          let setSql = `brand=?, origin=?, category=?, status=?, legal_entity='dd', updated_at=datetime('now','localtime')`;
          const args = [it.brand || '', it.origin || '한국', it.category || '', it.status || 'active'];
          if (_hasTempCodeMig && it.online_code) { setSql += ', temp_code=?'; args.push(it.online_code); }
          args.push(code);
          await db.prepare(`UPDATE products SET ${setSql} WHERE product_code=?`).run(...args);
          _ddUpdated++;
        } else {
          // INSERT — unit 기본값 'EA'
          let cols = 'product_code, product_name, brand, origin, category, status, unit, legal_entity';
          let vals = [code, '', it.brand || '', it.origin || '한국', it.category || '', it.status || 'active', 'EA', 'dd'];
          if (_hasTempCodeMig && it.online_code) { cols += ', temp_code'; vals.push(it.online_code); }
          const ph = vals.map(()=>'?').join(',');
          await db.prepare(`INSERT INTO products (${cols}) VALUES (${ph})`).run(...vals);
          _ddInserted++;
        }
      } catch(e) {
        _ddFailed++;
        if (_ddFailed <= 3) console.warn(`[DD-import] ${code} 실패:`, e.message);
      }
    }
    console.log(`[DB] 디얼디어 마스터 import: 신규 ${_ddInserted}건, 업데이트 ${_ddUpdated}건, 바른컴퍼니 충돌 skip ${_ddSkippedBarunson}건, 실패 ${_ddFailed}건 (총 ${_ddItems.length}건 처리)`);
  }
} catch(e) {
  console.error('[DB] 디얼디어 마스터 import 실패:', e.message);
}

// ── 공지/게시판 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS notices (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  title       TEXT NOT NULL,
  content     TEXT DEFAULT '',
  category    TEXT DEFAULT 'notice',
  is_popup    INTEGER DEFAULT 0,
  popup_start TEXT DEFAULT NULL,
  popup_end   TEXT DEFAULT NULL,
  is_pinned   INTEGER DEFAULT 0,
  author_id   INTEGER,
  author_name TEXT DEFAULT '',
  view_count  INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'active',
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  updated_at  TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_notices_status ON notices(status, created_at)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_notices_popup ON notices(is_popup, popup_start, popup_end)");

await db.exec(`CREATE TABLE IF NOT EXISTS notice_reads (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  notice_id  INTEGER NOT NULL,
  user_id    INTEGER NOT NULL,
  read_at    TEXT DEFAULT (datetime('now','localtime')),
  popup_dismissed INTEGER DEFAULT 0
)`);
await db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_nr_unique ON notice_reads(notice_id, user_id)");

// ── 회계 모듈 SQLite 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS gl_account_map (
  acc_code    TEXT PRIMARY KEY,
  acc_name    TEXT NOT NULL DEFAULT '',
  acc_type    TEXT NOT NULL DEFAULT '',
  acc_group   TEXT DEFAULT '',
  parent_code TEXT DEFAULT '',
  depth       INTEGER DEFAULT 0,
  sort_order  INTEGER DEFAULT 0,
  is_active   INTEGER DEFAULT 1,
  updated_at  TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS gl_balance_cache (
  acc_code   TEXT NOT NULL,
  year_month TEXT NOT NULL,
  opening_dr REAL DEFAULT 0, opening_cr REAL DEFAULT 0,
  period_dr  REAL DEFAULT 0, period_cr  REAL DEFAULT 0,
  closing_dr REAL DEFAULT 0, closing_cr REAL DEFAULT 0,
  cached_at  TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(acc_code, year_month)
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS accounting_settings (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS cs_code_cache (
  cs_code   TEXT PRIMARY KEY,
  cs_name   TEXT DEFAULT '',
  cached_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// 계정과목 한글명 매핑 (XERP 주요 계정)
const KNOWN_ACCOUNTS = {
  '11110101':'현금','11110151':'보통예금','11110152':'보통예금2','11110153':'보통예금3',
  '11120101':'받을어음','11125101':'외상매출금','11125102':'외상매출금(수출)',
  '11130101':'단기대여금','11135101':'미수금','11135102':'미수수익',
  '11140101':'선급금','11145101':'선급비용','11150101':'재고자산',
  '11151101':'상품','11152101':'제품','11153101':'재공품','11154101':'원재료','11155101':'저장품',
  '11160101':'부가세대급금','11199101':'기타유동자산',
  '12110101':'토지','12120101':'건물','12125101':'건물감가상각누계액',
  '12130101':'기계장치','12135101':'기계장치감가상각누계액',
  '12140101':'차량운반구','12145101':'차량운반구감가상각누계액',
  '12150101':'비품','12155101':'비품감가상각누계액',
  '12160101':'건설중인자산','12170101':'무형자산','12175101':'영업권',
  '12180101':'장기투자증권','12190101':'장기대여금','12199101':'기타비유동자산',
  '21110101':'외상매입금','21120101':'지급어음','21130101':'단기차입금',
  '21140101':'미지급금','21145101':'미지급비용','21150101':'선수금',
  '21155101':'예수금','21160101':'부가세예수금','21170101':'유동성장기부채',
  '21199101':'기타유동부채','21210101':'미지급법인세',
  '21310101':'선수금(카드)','21320101':'선수금(현금)','21330101':'선수금',
  '22110101':'장기차입금','22120101':'사채','22130101':'퇴직급여충당부채',
  '22199101':'기타비유동부채',
  '31110101':'자본금','31120101':'자본잉여금','31130101':'이익잉여금',
  '31140101':'자본조정','31150101':'기타포괄손익누계액',
  '41110101':'상품매출','41110102':'상품매출(수출)','41120101':'제품매출',
  '51110101':'상품매출원가','51120101':'제품매출원가','51130101':'원재료비',
  '51140101':'노무비','51150101':'제조경비',
  '61110101':'상품매출','61110121':'상품매출(온라인)','61115101':'제품매출',
  '61120101':'임대수입','61130101':'수수료수입',
  '64110101':'이자수익','64120101':'배당금수익','64130101':'외환차익',
  '64140101':'외화환산이익','64150101':'유형자산처분이익','64199101':'잡이익',
  '71110101':'급여','71120101':'퇴직급여','71130101':'복리후생비',
  '71140101':'여비교통비','71150101':'접대비','71160101':'통신비',
  '71170101':'수도광열비','71180101':'세금과공과','71190101':'감가상각비',
  '71200101':'임차료','71210101':'수선비','71220101':'보험료',
  '71230101':'차량유지비','71240101':'운반비','71250101':'교육훈련비',
  '71260101':'도서인쇄비','71270101':'소모품비','71280101':'지급수수료',
  '71290101':'광고선전비','71300101':'대손상각비','71310101':'무형자산상각비',
  '71399101':'기타판관비',
  '73110101':'포장비','73120101':'운반비(판매)','73130101':'판매수수료',
  '73140101':'판매촉진비','73150101':'판매보증비',
  '73183104':'판매수수료',
  '74110101':'이자비용','74120101':'외환차손','74130101':'외화환산손실',
  '74140101':'유형자산처분손실','74199101':'잡손실',
  '81110101':'법인세비용'
};

function classifyAccount(code) {
  const c = code.replace(/\s/g, '');
  const first = c.charAt(0);
  const first2 = c.substring(0, 2);
  let acc_type = '', acc_group = '', sort_order = 0;
  if (first === '1') {
    acc_type = 'asset';
    if (first2 === '11') { acc_group = '유동자산'; sort_order = 1000; }
    else { acc_group = '비유동자산'; sort_order = 2000; }
  } else if (first === '2') {
    acc_type = 'liability';
    if (first2 === '21') { acc_group = '유동부채'; sort_order = 3000; }
    else { acc_group = '비유동부채'; sort_order = 4000; }
  } else if (first === '3') {
    acc_type = 'equity'; acc_group = '자본'; sort_order = 5000;
  } else if (first === '4' || first2 === '61') {
    acc_type = 'revenue'; acc_group = '매출'; sort_order = 6000;
  } else if (first === '5' || first2 === '51') {
    acc_type = 'expense'; acc_group = '매출원가'; sort_order = 7000;
  } else if (first2 === '64') {
    acc_type = 'revenue'; acc_group = '영업외수익'; sort_order = 6500;
  } else if (first === '6') {
    acc_type = 'revenue'; acc_group = '매출'; sort_order = 6000;
  } else if (first2 === '71' || first2 === '72' || first2 === '73') {
    acc_type = 'expense'; acc_group = '판매비와관리비'; sort_order = 8000;
  } else if (first2 === '74') {
    acc_type = 'expense'; acc_group = '영업외비용'; sort_order = 8500;
  } else if (first === '7') {
    acc_type = 'expense'; acc_group = '비용'; sort_order = 8000;
  } else if (first === '8') {
    acc_type = 'expense'; acc_group = '법인세비용'; sort_order = 9000;
  } else {
    acc_type = 'other'; acc_group = '기타'; sort_order = 9999;
  }
  const parent_code = c.substring(0, 5);
  const depth = c.length <= 5 ? 1 : (c.length <= 6 ? 2 : 3);
  const name = KNOWN_ACCOUNTS[c] || '';
  return { acc_type, acc_group, parent_code, depth, sort_order, acc_name: name };
}

// ── 작업지시 SQLite 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS work_orders (
  wo_id       INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_number   TEXT UNIQUE NOT NULL,
  request_id  INTEGER,
  product_code TEXT,
  product_name TEXT DEFAULT '',
  brand       TEXT DEFAULT '',
  ordered_qty INTEGER DEFAULT 0,
  produced_qty INTEGER DEFAULT 0,
  defect_qty  INTEGER DEFAULT 0,
  status      TEXT DEFAULT 'planned',
  priority    TEXT DEFAULT 'normal',
  start_date  TEXT,
  due_date    TEXT,
  completed_date TEXT,
  printer_vendor TEXT DEFAULT '',
  post_vendor TEXT DEFAULT '',
  paper_type  TEXT DEFAULT '',
  notes       TEXT DEFAULT '',
  cost_material REAL DEFAULT 0,
  cost_labor   REAL DEFAULT 0,
  cost_overhead REAL DEFAULT 0,
  cost_total   REAL DEFAULT 0,
  created_by  TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime')),
  updated_at  TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS work_order_logs (
  log_id      INTEGER PRIMARY KEY AUTOINCREMENT,
  wo_id       INTEGER NOT NULL,
  wo_number   TEXT,
  action      TEXT,
  from_status TEXT,
  to_status   TEXT,
  qty_change  INTEGER DEFAULT 0,
  actor       TEXT DEFAULT '',
  details     TEXT DEFAULT '',
  created_at  TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── 홈택스 세금계산서 업로드 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS hometax_invoices (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_no    TEXT DEFAULT '',
  invoice_date  TEXT NOT NULL DEFAULT '',
  ar_ap         TEXT DEFAULT 'AP',
  cs_name       TEXT DEFAULT '',
  cs_reg_no     TEXT DEFAULT '',
  supply_amt    REAL DEFAULT 0,
  vat_amt       REAL DEFAULT 0,
  total_amt     REAL DEFAULT 0,
  item_name     TEXT DEFAULT '',
  remark        TEXT DEFAULT '',
  electronic    TEXT DEFAULT 'Y',
  source        TEXT DEFAULT 'hometax',
  uploaded_by   TEXT DEFAULT '',
  uploaded_at   TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(invoice_no, invoice_date, cs_reg_no, supply_amt)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_hometax_date ON hometax_invoices(invoice_date)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_hometax_arap ON hometax_invoices(ar_ap, invoice_date)");

// ── 로트/배치 추적 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS batch_master (
  batch_id        INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_number    TEXT NOT NULL DEFAULT '',
  product_code    TEXT NOT NULL DEFAULT '',
  product_name    TEXT DEFAULT '',
  vendor_name     TEXT DEFAULT '',
  vendor_lot      TEXT DEFAULT '',
  received_date   TEXT DEFAULT '',
  po_number       TEXT DEFAULT '',
  received_qty    REAL DEFAULT 0,
  current_qty     REAL DEFAULT 0,
  quality_status  TEXT DEFAULT 'GOOD',
  warehouse       TEXT DEFAULT '',
  mfg_date        TEXT DEFAULT '',
  exp_date        TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  created_by      TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now','localtime')),
  updated_at      TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(batch_number, product_code)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_batch_product ON batch_master(product_code)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_batch_status ON batch_master(quality_status)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_batch_date ON batch_master(received_date)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_batch_warehouse ON batch_master(warehouse)");

await db.exec(`CREATE TABLE IF NOT EXISTS batch_transactions (
  txn_id          INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id        INTEGER NOT NULL,
  batch_number    TEXT DEFAULT '',
  txn_type        TEXT NOT NULL DEFAULT '',
  txn_date        TEXT DEFAULT (datetime('now','localtime')),
  from_warehouse  TEXT DEFAULT '',
  to_warehouse    TEXT DEFAULT '',
  product_code    TEXT DEFAULT '',
  qty             REAL DEFAULT 0,
  qty_before      REAL DEFAULT 0,
  qty_after       REAL DEFAULT 0,
  reference_no    TEXT DEFAULT '',
  actor           TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_btxn_batch ON batch_transactions(batch_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_btxn_date ON batch_transactions(txn_date)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_btxn_type ON batch_transactions(txn_type)");

await db.exec(`CREATE TABLE IF NOT EXISTS batch_inspections (
  insp_id         INTEGER PRIMARY KEY AUTOINCREMENT,
  batch_id        INTEGER NOT NULL,
  batch_number    TEXT DEFAULT '',
  insp_date       TEXT DEFAULT (datetime('now','localtime')),
  inspector       TEXT DEFAULT '',
  insp_type       TEXT DEFAULT 'RECEIVING',
  sample_size     INTEGER DEFAULT 0,
  defects_found   INTEGER DEFAULT 0,
  defect_desc     TEXT DEFAULT '',
  result          TEXT DEFAULT 'PASS',
  next_action     TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  created_by      TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_binsp_batch ON batch_inspections(batch_id)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_binsp_date ON batch_inspections(insp_date)");

// ── 원재료 단가 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS material_prices (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  product_code    TEXT NOT NULL DEFAULT '',
  product_name    TEXT DEFAULT '',
  spec            TEXT DEFAULT '',
  unit            TEXT DEFAULT 'R',
  vendor_name     TEXT DEFAULT '',
  list_price      REAL DEFAULT 0,
  apply_price     REAL DEFAULT 0,
  discount_rate   REAL DEFAULT 0,
  apply_month     TEXT DEFAULT '',
  notes           TEXT DEFAULT '',
  uploaded_by     TEXT DEFAULT '',
  created_at      TEXT DEFAULT (datetime('now','localtime')),
  updated_at      TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(product_code, vendor_name, apply_month)
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_matprice_code ON material_prices(product_code)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_matprice_vendor ON material_prices(vendor_name)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_matprice_month ON material_prices(apply_month)");

// ── Phase 5: 알림센터 ──
await db.exec(`CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY, user_id INTEGER, type TEXT NOT NULL DEFAULT 'system',
  title TEXT NOT NULL DEFAULT '', message TEXT DEFAULT '', link TEXT DEFAULT '',
  is_read INTEGER DEFAULT 0, is_email_sent INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_noti_user ON notifications(user_id, is_read)");

// ── Phase 1: 전자결재 ──
await db.exec(`CREATE TABLE IF NOT EXISTS approvals (
  id SERIAL PRIMARY KEY, approval_no TEXT UNIQUE, doc_type TEXT NOT NULL DEFAULT 'general',
  doc_ref TEXT DEFAULT '', title TEXT NOT NULL DEFAULT '', content TEXT DEFAULT '',
  amount DOUBLE PRECISION DEFAULT 0, status TEXT DEFAULT 'draft',
  requester_id INTEGER, requester_name TEXT DEFAULT '',
  current_step INTEGER DEFAULT 1, total_steps INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (NOW()),
  updated_at TEXT DEFAULT (NOW())
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS approval_lines (
  id SERIAL PRIMARY KEY, approval_id INTEGER NOT NULL, step_order INTEGER NOT NULL,
  approver_id INTEGER, approver_name TEXT DEFAULT '',
  role TEXT DEFAULT 'approver', status TEXT DEFAULT 'pending',
  comment TEXT DEFAULT '', acted_at TEXT,
  UNIQUE(approval_id, step_order)
)`);

// ── 동기화 메타 ──
await db.exec(`CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY, last_sync TEXT, record_count INTEGER DEFAULT 0, status TEXT DEFAULT 'ok', message TEXT DEFAULT ''
)`);

// ── Phase 2: 수주관리 ──
await db.exec(`CREATE TABLE IF NOT EXISTS sales_orders (
  id INTEGER PRIMARY KEY, order_no TEXT UNIQUE, order_type TEXT DEFAULT 'quote',
  status TEXT DEFAULT 'draft', customer_name TEXT NOT NULL DEFAULT '',
  customer_contact TEXT DEFAULT '', customer_tel TEXT DEFAULT '',
  order_date TEXT, delivery_date TEXT, shipped_date TEXT,
  total_qty INTEGER DEFAULT 0, total_amount REAL DEFAULT 0, tax_amount REAL DEFAULT 0,
  notes TEXT DEFAULT '', created_by TEXT DEFAULT '',
  source TEXT DEFAULT 'manual', external_id TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
// source 컬럼 마이그레이션 (기존 테이블에 컬럼 없을 수 있음)
try { await db.exec("ALTER TABLE sales_orders ADD COLUMN source TEXT DEFAULT 'manual'"); } catch(_){}
try { await db.exec("ALTER TABLE sales_orders ADD COLUMN external_id TEXT DEFAULT ''"); } catch(_){}
await db.exec(`CREATE TABLE IF NOT EXISTS sales_order_items (
  id INTEGER PRIMARY KEY, order_id INTEGER NOT NULL,
  product_code TEXT DEFAULT '', product_name TEXT DEFAULT '', spec TEXT DEFAULT '',
  unit_price REAL DEFAULT 0, qty INTEGER DEFAULT 0, amount REAL DEFAULT 0, notes TEXT DEFAULT ''
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_sales_order_items_order_id ON sales_order_items(order_id)");

// ── Phase 4: 예산관리 ──
await db.exec(`CREATE TABLE IF NOT EXISTS budgets (
  id INTEGER PRIMARY KEY, year TEXT NOT NULL, month TEXT NOT NULL,
  acc_code TEXT DEFAULT '', acc_name TEXT DEFAULT '',
  budget_type TEXT DEFAULT 'expense', budget_amount REAL DEFAULT 0,
  actual_amount REAL DEFAULT 0, notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(year, month, acc_code)
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS daily_cash (
  id INTEGER PRIMARY KEY, cash_date TEXT NOT NULL,
  acc_code TEXT DEFAULT '', acc_name TEXT DEFAULT '',
  inflow REAL DEFAULT 0, outflow REAL DEFAULT 0, balance REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(cash_date, acc_code)
)`);

// ── 수동 분개 (Manual Journal Entries) ──
await db.exec(`CREATE TABLE IF NOT EXISTS journal_entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_no TEXT UNIQUE,
  entry_date TEXT NOT NULL,
  description TEXT DEFAULT '',
  total_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'posted',
  created_by TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS journal_entry_lines (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_id INTEGER NOT NULL,
  line_no INTEGER DEFAULT 1,
  acc_code TEXT NOT NULL,
  acc_name TEXT DEFAULT '',
  debit REAL DEFAULT 0,
  credit REAL DEFAULT 0,
  description TEXT DEFAULT ''
)`);
await db.exec("CREATE INDEX IF NOT EXISTS idx_je_date ON journal_entries(entry_date)");
await db.exec("CREATE INDEX IF NOT EXISTS idx_jel_entry ON journal_entry_lines(entry_id)");

// ── Phase 6: 생산실적 ──
await db.exec(`CREATE TABLE IF NOT EXISTS work_order_results (
  id INTEGER PRIMARY KEY, work_order_id INTEGER NOT NULL,
  result_date TEXT NOT NULL, good_qty INTEGER DEFAULT 0, defect_qty INTEGER DEFAULT 0,
  worker_name TEXT DEFAULT '', work_hours REAL DEFAULT 0, notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// ── Phase 1-6 확장 테이블 ──

// 안전재고 규칙
await db.exec(`CREATE TABLE IF NOT EXISTS safety_stock_rules (
  id INTEGER PRIMARY KEY, product_code TEXT NOT NULL UNIQUE,
  product_name TEXT DEFAULT '', min_qty INTEGER DEFAULT 0,
  reorder_qty INTEGER DEFAULT 0, reorder_point INTEGER DEFAULT 0,
  lead_time_days INTEGER DEFAULT 7, warehouse TEXT DEFAULT '',
  auto_po INTEGER DEFAULT 0, vendor_name TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// 재고실사
await db.exec(`CREATE TABLE IF NOT EXISTS cycle_count_plans (
  id INTEGER PRIMARY KEY, plan_no TEXT UNIQUE,
  plan_date TEXT NOT NULL, warehouse TEXT DEFAULT '',
  status TEXT DEFAULT 'planned', note TEXT DEFAULT '',
  created_by TEXT DEFAULT '', completed_at TEXT,
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS cycle_count_items (
  id INTEGER PRIMARY KEY, plan_id INTEGER NOT NULL,
  product_code TEXT NOT NULL, product_name TEXT DEFAULT '',
  system_qty INTEGER DEFAULT 0, counted_qty INTEGER,
  variance INTEGER DEFAULT 0, adjusted INTEGER DEFAULT 0,
  note TEXT DEFAULT '',
  UNIQUE(plan_id, product_code)
)`);

// 제조원가
await db.exec(`CREATE TABLE IF NOT EXISTS mfg_cost_cards (
  id INTEGER PRIMARY KEY, product_code TEXT NOT NULL,
  product_name TEXT DEFAULT '', calc_date TEXT NOT NULL,
  material_cost REAL DEFAULT 0, labor_cost REAL DEFAULT 0,
  overhead_cost REAL DEFAULT 0, outsource_cost REAL DEFAULT 0,
  total_cost REAL DEFAULT 0, unit_cost REAL DEFAULT 0,
  qty INTEGER DEFAULT 1, source TEXT DEFAULT 'auto',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(product_code, calc_date)
)`);
await db.exec(`CREATE TABLE IF NOT EXISTS cost_rates (
  id INTEGER PRIMARY KEY, rate_type TEXT NOT NULL,
  rate_key TEXT NOT NULL, rate_value REAL DEFAULT 0,
  unit TEXT DEFAULT '', effective_from TEXT,
  notes TEXT DEFAULT '',
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(rate_type, rate_key)
)`);
// 기본 노무비/경비 시드
try {
  await db.prepare("INSERT OR IGNORE INTO cost_rates (rate_type,rate_key,rate_value,unit,notes) VALUES (?,?,?,?,?)").run('labor','default',25000,'원/시간','기본 노무비 단가');
  await db.prepare("INSERT OR IGNORE INTO cost_rates (rate_type,rate_key,rate_value,unit,notes) VALUES (?,?,?,?,?)").run('overhead','rate',15,'%','제조경비 비율 (재료비+노무비 대비)');
} catch(_){}

// RBAC 권한
await db.exec(`CREATE TABLE IF NOT EXISTS role_permissions (
  id INTEGER PRIMARY KEY, role TEXT NOT NULL,
  permission TEXT NOT NULL, resource TEXT DEFAULT '*',
  granted INTEGER DEFAULT 1,
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(role, permission, resource)
)`);
// 기본 권한 시드
try {
  const seedPerms = db.transaction(async () => {
    const ins = db.prepare("INSERT OR IGNORE INTO role_permissions (role,permission,resource) VALUES (?,?,?)");
    await ins.run('admin', '*', '*');
    for (const p of ['read','write']) { for (const res of ['po','vendor','receipt','inventory','auto-order']) { await ins.run('purchase',p,res); } } await ins.run('purchase','read','dashboard');
    for (const p of ['read','write']) { for (const res of ['sales-order','customer-orders','shipping']) { await ins.run('sales',p,res); } } await ins.run('sales','read','dashboard'); await ins.run('sales','read','inventory');
    for (const p of ['read','write']) { for (const res of ['work-order','production-req','bom','equipment','process-routing']) { await ins.run('production',p,res); } } await ins.run('production','read','dashboard'); await ins.run('production','read','inventory');
    for (const p of ['read','write']) { for (const res of ['journal','budget','tax-invoice','ar-ap','mfg-cost']) { await ins.run('accounting',p,res); } } await ins.run('accounting','read','dashboard');
    await ins.run('executive','read','*');
    await ins.run('viewer','read','*');
  });
  await seedPerms();
} catch(_){}

// 공정 라우팅
await db.exec(`CREATE TABLE IF NOT EXISTS process_routing (
  id INTEGER PRIMARY KEY, product_code TEXT NOT NULL,
  step_no INTEGER NOT NULL, process_name TEXT NOT NULL,
  process_type TEXT DEFAULT 'internal',
  equipment_id INTEGER, vendor_name TEXT DEFAULT '',
  std_time_min REAL DEFAULT 0, setup_time_min REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  UNIQUE(product_code, step_no)
)`);

// 공정별 실적
await db.exec(`CREATE TABLE IF NOT EXISTS process_results (
  id INTEGER PRIMARY KEY, wo_id INTEGER NOT NULL,
  routing_id INTEGER, step_no INTEGER NOT NULL,
  process_name TEXT NOT NULL, equipment_id INTEGER,
  start_time TEXT, end_time TEXT,
  good_qty INTEGER DEFAULT 0, defect_qty INTEGER DEFAULT 0,
  worker_name TEXT DEFAULT '', status TEXT DEFAULT 'pending',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// 설비 마스터
await db.exec(`CREATE TABLE IF NOT EXISTS equipment (
  id INTEGER PRIMARY KEY, eq_code TEXT UNIQUE NOT NULL,
  eq_name TEXT NOT NULL, eq_type TEXT DEFAULT '',
  location TEXT DEFAULT '', status TEXT DEFAULT 'active',
  purchase_date TEXT, manufacturer TEXT DEFAULT '',
  model TEXT DEFAULT '', capacity_per_hour REAL DEFAULT 0,
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// 설비 로그 (가동/비가동/정비)
await db.exec(`CREATE TABLE IF NOT EXISTS equipment_logs (
  id INTEGER PRIMARY KEY, equipment_id INTEGER NOT NULL,
  log_date TEXT NOT NULL, log_type TEXT NOT NULL,
  start_time TEXT, end_time TEXT,
  duration_min REAL DEFAULT 0, reason TEXT DEFAULT '',
  worker_name TEXT DEFAULT '', notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime'))
)`);

// 알림 생성 헬퍼
async function createNotification(userId, type, title, message, link) {
  try {
    await db.prepare("INSERT INTO notifications (user_id, type, title, message, link) VALUES (?,?,?,?,?)").run(userId, type, title, message || '', link || '');
  } catch(e) { console.error('알림 생성 실패:', e.message); }
}

// JWT 시크릿 (서버 고유 — 최초 생성 후 파일 저장)
const JWT_SECRET_PATH = path.join(DATA_DIR, '.jwt_secret');
let JWT_SECRET;
try {
  JWT_SECRET = fs.readFileSync(JWT_SECRET_PATH, 'utf8').trim();
} catch {
  JWT_SECRET = crypto.randomBytes(32).toString('hex');
  fs.writeFileSync(JWT_SECRET_PATH, JWT_SECRET, 'utf8');
  console.log('JWT 시크릿 키 생성 완료');
}
const JWT_EXPIRES = '24h';

// 마스터 관리자 계정 (seungchan.back@barunn.net)
const masterEmail = 'seungchan.back@barunn.net';
const masterUser = await db.prepare("SELECT user_id FROM users WHERE email = ?").get(masterEmail);
if (!masterUser) {
  const hash = bcrypt.hashSync('1234', 10);
  const oldAdmin = await db.prepare("SELECT user_id FROM users WHERE username = 'admin'").get();
  if (oldAdmin) {
    await db.prepare("UPDATE users SET username = ?, email = ?, password_hash = ?, display_name = ?, role = 'admin' WHERE user_id = ?")
      .run('seungchan.back', masterEmail, hash, '백승찬', oldAdmin.user_id);
  } else {
    await db.prepare("INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)")
      .run('seungchan.back', hash, '백승찬', 'admin', masterEmail);
  }
  console.log('✅ 마스터 계정: seungchan.back@barunn.net / 1234');
} else {
  // 이미 존재하면 admin 역할 보장 + username 통일
  await db.prepare("UPDATE users SET role = 'admin', username = 'seungchan.back' WHERE user_id = ?").run(masterUser.user_id);
}

// 공용 관리자 계정 (admin / 1234) — 다수 사용자 공용 접속용
const adminUsername = 'admin';
const adminEmail2 = 'admin@barunn.net';
const adminExisting = await db.prepare("SELECT user_id, password_hash FROM users WHERE username = ? OR email = ?").get(adminUsername, adminEmail2);
if (!adminExisting) {
  const hash2 = bcrypt.hashSync('1234', 10);
  await db.prepare("INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?, ?, ?, ?, ?)")
    .run(adminUsername, hash2, '관리자(공용)', 'admin', adminEmail2);
  console.log('✅ 공용 관리자 계정 생성: admin / 1234');
} else {
  // 이미 존재하면 admin 역할 + 비밀번호 기본값 보장
  const hash2 = bcrypt.hashSync('1234', 10);
  try {
    const pwOk = adminExisting.password_hash && bcrypt.compareSync('1234', adminExisting.password_hash);
    if (!pwOk) {
      await db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE user_id = ?").run(hash2, adminExisting.user_id);
      console.log('✅ 공용 관리자 계정 비밀번호 초기화: admin / 1234');
    } else {
      await db.prepare("UPDATE users SET role = 'admin' WHERE user_id = ?").run(adminExisting.user_id);
    }
  } catch(e) {
    await db.prepare("UPDATE users SET password_hash = ?, role = 'admin' WHERE user_id = ?").run(hash2, adminExisting.user_id);
  }
}
// 마스터 계정 비밀번호 보장 (seed.db에서 복원 시 비밀번호가 다를 수 있으므로)
const masterCheck = await db.prepare("SELECT user_id, password_hash FROM users WHERE email = ?").get(masterEmail);
if (masterCheck && masterCheck.password_hash) {
  const defaultPw = '1234';
  try {
    if (!bcrypt.compareSync(defaultPw, masterCheck.password_hash)) {
      // 비밀번호가 기본값이 아니면 유지 (사용자가 변경했을 수 있음)
    }
  } catch(e) { console.warn('bcrypt 비교 실패 (무시):', e.message); }
  // username이 admin이면 seungchan.back으로 통일
  await db.prepare("UPDATE users SET username = 'seungchan.back' WHERE user_id = ? AND username = 'admin'").run(masterCheck.user_id);
}

// JWT 유틸
function signToken(user) {
  return jwt.sign({ userId: user.user_id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: JWT_EXPIRES });
}

function verifyToken(token) {
  try { return jwt.verify(token, JWT_SECRET); }
  catch { return null; }
}

function extractToken(req) {
  const auth = req.headers['authorization'];
  if (auth && auth.startsWith('Bearer ')) return auth.slice(7);
  const cookie = req.headers['cookie'];
  if (cookie) {
    const m = cookie.match(/token=([^;]+)/);
    if (m) return m[1];
  }
  return null;
}

// 감사 로그 기록
async function auditLog(userId, username, action, resource, resourceId, details, ip) {
  try {
    await db.prepare("INSERT INTO audit_log (user_id, username, action, resource, resource_id, details, ip_address) VALUES (?,?,?,?,?,?,?)")
      .run(userId || 0, username || '', action, resource || '', String(resourceId || ''), details || '', ip || '');
  } catch (e) { console.error('감사 로그 기록 실패:', e.message); }
}

// 에러 로그 기록
async function logError(level, message, stack, url, method, userId) {
  try {
    await db.prepare("INSERT INTO error_logs (level, message, stack, url, method, user_id) VALUES (?,?,?,?,?,?)")
      .run(level, message, stack || '', url || '', method || '', userId || null);
  } catch (e) { console.error('에러 로그 기록 실패:', e.message); }
}

// 시스템 공지 작성 (릴리스 노트 등 서버 내부에서 자동 게시)
async function postSystemNotice(title, content, options = {}) {
  try {
    const { category = 'update', is_popup = 0, is_pinned = 0 } = options;
    const admin = await db.prepare("SELECT user_id, username FROM users WHERE role = 'admin' LIMIT 1").get();
    const authorId = admin ? admin.user_id : 0;
    const authorName = admin ? admin.username : 'system';
    const r = await db.prepare(`INSERT INTO notices (title, content, category, is_popup, popup_start, popup_end, is_pinned, author_id, author_name)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
      title, content, category, is_popup ? 1 : 0, null, null, is_pinned ? 1 : 0, authorId, authorName
    );
    logger.info(`[시스템 공지] ${title} (id: ${r.lastInsertRowid})`);
    return r.lastInsertRowid;
  } catch (e) { logger.error('시스템 공지 작성 실패:', e.message); return null; }
}

// 전체 페이지 목록 (관리자 권한 UI용)
const ALL_PAGES = [
  { id: 'dashboard', name: '홈', group: '기본' },
  // 구매
  { id: 'auto-order', name: '자동발주', group: '구매' },
  { id: 'create-po', name: '발주생성', group: '구매' },
  { id: 'po-list', name: '발주현황', group: '구매' },
  { id: 'po-mgmt', name: '발주서 관리', group: '구매' },
  { id: 'china-shipment', name: '중국선적', group: '구매' },
  { id: 'delivery-schedule', name: '입고일정', group: '구매' },
  { id: 'receipts', name: '입고관리', group: '구매' },
  { id: 'os-register', name: 'OS등록', group: '구매' },
  { id: 'purchase-closing', name: '구매마감', group: '구매' },
  // 판매
  { id: 'sales', name: '통합매출', group: '판매' },
  { id: 'sales-barun', name: '바른손매출', group: '판매' },
  { id: 'sales-dd', name: 'DD매출', group: '판매' },
  { id: 'sales-gift', name: '더기프트매출', group: '판매' },
  { id: 'customer-orders', name: '고객주문', group: '판매' },
  { id: 'shipping', name: '배송추적', group: '판매' },
  // 재고
  { id: 'inventory', name: '재고현황', group: '재고' },
  { id: 'warehouse', name: '창고별 재고', group: '재고' },
  { id: 'shipments', name: '입출고 현황', group: '재고' },
  { id: 'shipment-status', name: '출고현황', group: '재고' },
  { id: 'sales-status', name: '판매현황', group: '판매' },
  { id: 'inventory2', name: '재고현황2', group: '재고' },
  // 생산
  { id: 'production-req', name: '생산요청', group: '생산' },
  { id: 'production-stock', name: '생산재고', group: '생산' },
  { id: 'mrp', name: 'MRP', group: '생산' },
  // 회계
  { id: 'invoices', name: '거래명세서', group: '회계' },
  { id: 'mat-purchase', name: '원재료 매입', group: '회계' },
  { id: 'cost-mgmt', name: '원가관리', group: '회계' },
  { id: 'closing', name: '마감현황', group: '회계' },
  { id: 'chart-of-accounts', name: '계정과목', group: '회계' },
  { id: 'journal', name: '분개장', group: '회계' },
  { id: 'general-ledger', name: '총계정원장', group: '회계' },
  { id: 'trial-balance', name: '시산표', group: '회계' },
  { id: 'financial-statements', name: '재무제표', group: '회계' },
  { id: 'ar-ap', name: '채권/채무', group: '회계' },
  { id: 'tax-invoice', name: '세금계산서', group: '회계' },
  // 생산
  { id: 'work-order', name: '작업지시', group: '생산' },
  { id: 'lot-tracking', name: '로트추적', group: '생산' },
  // 기준정보
  { id: 'vendors', name: '거래처 관리', group: '기준정보' },
  { id: 'product-mgmt', name: '품목관리', group: '기준정보' },
  { id: 'bom', name: '제품공정', group: '기준정보' },
  { id: 'post-process', name: '후공정 단가', group: '기준정보' },
  // 경영분석
  { id: 'analytics', name: '대시보드', group: '경영분석' },
  { id: 'exec-dashboard', name: '경영대시보드', group: '경영분석' },
  { id: 'report', name: '보고서', group: '경영분석' },
  { id: 'defects', name: '불량관리', group: '경영분석' },
  // 판매
  { id: 'sales-order', name: '수주관리', group: '판매' },
  // 재고
  { id: 'lot-tracking', name: 'Lot추적', group: '재고' },
  // 회계
  { id: 'budget', name: '예산관리', group: '회계' },
  // 업무
  { id: 'approval', name: '전자결재', group: '업무' },
  { id: 'tasks', name: '업무관리', group: '업무' },
  { id: 'notes', name: '미팅일지', group: '업무' },
  { id: 'board', name: '공지/게시판', group: '업무' },
  // 통합발주
  { id: 'procurement', name: '통합발주관리', group: '구매' },
  // 재고 확장
  { id: 'inventory-ledger', name: '수불원장', group: '재고' },
  { id: 'safety-stock', name: '안전재고관리', group: '재고' },
  { id: 'cycle-count', name: '재고실사', group: '재고' },
  // 생산 확장
  { id: 'process-routing', name: '공정라우팅', group: '생산' },
  { id: 'equipment', name: '설비관리', group: '생산' },
  // 회계 확장
  { id: 'mfg-cost', name: '제조원가', group: '회계' },
  { id: 'vat-report', name: '부가세 신고', group: '회계' },
  { id: 'journal-auto', name: '자동 분개', group: '회계' },
  // 재고 확장
  { id: 'barcode', name: '바코드/QR', group: '재고' },
  // 경영분석 확장
  { id: 'report-builder', name: '보고서 빌더', group: '경영분석' },
  // 시스템
  { id: 'settings', name: '설정', group: '시스템' },
  { id: 'user-mgmt', name: '사용자 관리', group: '시스템' },
  { id: 'audit-log', name: '감사로그', group: '시스템' },
  { id: 'notification', name: '알림센터', group: '시스템' },
  { id: 'rbac', name: '권한관리', group: '시스템' },
];

// 역할 기본 권한 맵 (개별 permissions가 없을 때 fallback)
const ROLE_PERMISSIONS = {
  admin: ['*'],  // 모든 권한
  purchase: ['dashboard', 'inventory', 'inventory2', 'warehouse', 'shipments', 'shipment-status', 'inventory-ledger', 'auto-order', 'create-po', 'po-list', 'os-register',
    'delivery-schedule', 'receipts', 'invoices', 'notes', 'product-mgmt', 'bom', 'mrp', 'post-process', 'defects',
    'closing', 'report', 'po-mgmt', 'china-shipment', 'mat-purchase', 'tasks', 'meeting-log', 'sales', 'sales-status', 'sales-barun', 'sales-dd', 'sales-gift', 'cost-mgmt', 'board', 'audit-log', 'exec-dashboard', 'customer-orders', 'shipping',
    'chart-of-accounts', 'journal', 'general-ledger', 'trial-balance', 'financial-statements', 'ar-ap', 'tax-invoice', 'work-order', 'lot-tracking',
    'approval', 'sales-order', 'budget', 'notification', 'safety-stock', 'cycle-count', 'mfg-cost', 'procurement', 'vendor-performance'],
  production: ['dashboard', 'inventory', 'inventory2', 'warehouse', 'shipments', 'inventory-ledger', 'production-req', 'mrp', 'bom', 'post-process', 'defects', 'product-mgmt', 'notes', 'production-stock', 'tasks', 'approval', 'lot-tracking',
    'process-routing', 'equipment', 'mfg-cost', 'safety-stock', 'work-order'],
  logistics: ['dashboard', 'inventory', 'inventory2', 'warehouse', 'shipments', 'shipment-status', 'inventory-ledger', 'receipts', 'delivery-schedule', 'shipping', 'lot-tracking',
    'safety-stock', 'cycle-count', 'barcode', 'tasks', 'notes', 'board', 'notification', 'customer-orders'],
  sales_team: ['dashboard', 'sales', 'sales-status', 'sales-barun', 'sales-dd', 'sales-gift', 'sales-order', 'customer-orders', 'shipping',
    'inventory', 'inventory2', 'warehouse', 'shipments', 'shipment-status', 'ar-ap', 'invoices', 'tasks', 'notes', 'board', 'notification', 'exec-dashboard', 'analytics', 'report'],
  accounting: ['dashboard', 'invoices', 'mat-purchase', 'cost-mgmt', 'closing', 'chart-of-accounts', 'journal', 'general-ledger',
    'trial-balance', 'financial-statements', 'ar-ap', 'tax-invoice', 'budget', 'mfg-cost', 'vat-report', 'journal-auto',
    'sales', 'sales-status', 'sales-barun', 'sales-dd', 'sales-gift', 'tasks', 'notes', 'board', 'notification', 'approval', 'exec-dashboard'],
  packaging: ['dashboard', 'inventory', 'inventory2', 'warehouse', 'shipments', 'production-req', 'production-stock', 'work-order', 'bom',
    'post-process', 'lot-tracking', 'receipts', 'tasks', 'notes', 'board', 'notification'],
  viewer: ['dashboard', 'inventory', 'inventory2', 'warehouse', 'shipments', 'shipment-status', 'po-list', 'notes', 'sales', 'sales-status', 'sales-barun', 'sales-gift', 'cost-mgmt', 'board', 'customer-orders', 'shipping',
    'chart-of-accounts', 'journal', 'general-ledger', 'trial-balance', 'financial-statements', 'ar-ap'],
};

function hasPermission(role, page, userPermissions) {
  if (!role) return false;
  // admin은 항상 전체 권한
  if (role === 'admin') return true;
  // 사용자별 개별 permissions가 있으면 그것 사용
  if (userPermissions && userPermissions.length > 0) {
    return userPermissions.includes(page);
  }
  // 없으면 역할 기본 권한
  const perms = ROLE_PERMISSIONS[role];
  if (!perms) return false;
  return perms.includes(page);
}

// GET /api/auth/pages — 전체 페이지 목록 (관리자 권한 UI용)
// (handleRequest 내에서 처리)

// ── 구매마감 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS purchase_closing (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  legal_entity TEXT NOT NULL DEFAULT 'barunson',
  vendor_name TEXT NOT NULL,
  closing_year INTEGER NOT NULL,
  closing_month INTEGER NOT NULL,
  po_count INTEGER DEFAULT 0,
  total_ordered_qty INTEGER DEFAULT 0,
  total_received_qty INTEGER DEFAULT 0,
  total_defect_qty INTEGER DEFAULT 0,
  total_amount REAL DEFAULT 0,
  adjustment_amount REAL DEFAULT 0,
  final_amount REAL DEFAULT 0,
  status TEXT DEFAULT 'open',
  confirmed_by TEXT DEFAULT '',
  confirmed_at TEXT DEFAULT '',
  notes TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now','localtime')),
  updated_at TEXT DEFAULT (datetime('now','localtime')),
  UNIQUE(legal_entity, vendor_name, closing_year, closing_month)
)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pc_ym ON purchase_closing(closing_year, closing_month)`);
await db.exec(`CREATE INDEX IF NOT EXISTS idx_pc_status ON purchase_closing(status)`);

// ── 메뉴 활성화/비활성화 설정 테이블 ──
await db.exec(`CREATE TABLE IF NOT EXISTS menu_settings (
  page_id    TEXT PRIMARY KEY,
  is_enabled INTEGER DEFAULT 1,
  sort_order INTEGER DEFAULT 0,
  updated_at TEXT DEFAULT (datetime('now','localtime'))
)`);
// 기본값: 모든 페이지 활성화 (dashboard, settings는 항상 활성)
try {
  const existingRows = await db.prepare('SELECT page_id FROM menu_settings').all();
  const existing = existingRows.map(r => r.page_id);
  const insertStmt = db.prepare('INSERT OR IGNORE INTO menu_settings (page_id, is_enabled, sort_order) VALUES (?, 1, ?)');
  for (let idx = 0; idx < ALL_PAGES.length; idx++) {
    const p = ALL_PAGES[idx];
    if (!existing.includes(p.id)) await insertStmt.run(p.id, idx);
  }
} catch (_) {}

// ── DB 자동 백업 (PostgreSQL은 pg_dump 등 외부 도구 사용) ──
// SQLite 백업 코드 제거됨 — PostgreSQL은 별도 백업 정책 적용

// 초기 필수발주 품목 4건
const aoInit = db.prepare('INSERT OR IGNORE INTO auto_order_items (product_code, min_stock, order_qty) VALUES (?, ?, ?)');
await aoInit.run('BE004', 0, 0);
await aoInit.run('BE005', 0, 0);
await aoInit.run('2010wh_n', 0, 0);
await aoInit.run('BE042', 0, 0);


// ── Uploads directory ───────────────────────────────────────────────
const UPLOAD_ROOT = path.join(UPLOAD_DIR, 'invoices');
fs.mkdirSync(UPLOAD_ROOT, { recursive: true });

// ── MIME map ────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.js':   'text/javascript; charset=utf-8',
  '.css':  'text/css; charset=utf-8',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif':  'image/gif',
  '.pdf':  'application/pdf',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.xls':  'application/vnd.ms-excel',
};

// ── Helpers ─────────────────────────────────────────────────────────
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, PATCH, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function jsonRes(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  const _req = res._req;
  const acceptEncoding = (_req && _req.headers && _req.headers['accept-encoding']) || '';
  if (acceptEncoding.includes('gzip')) {
    const hdrs = { 'Content-Type': 'application/json; charset=utf-8', 'Content-Encoding': 'gzip', ...CORS };
    res.writeHead(statusCode, hdrs);
    zlib.gzip(Buffer.from(body), (err, compressed) => {
      if (err) { res.end(body); } else { res.end(compressed); }
    });
  } else {
    res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8', ...CORS });
    res.end(body);
  }
}

function ok(res, data) { jsonRes(res, 200, { ok: true, data }); }
function fail(res, code, error) { jsonRes(res, code, { ok: false, error }); }

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function readJSON(req) {
  return readBody(req).then(buf => JSON.parse(buf.toString('utf8')));
}

// ── Simple multipart parser ─────────────────────────────────────────
function parseMultipart(buf, boundary) {
  const parts = {};
  const sep = Buffer.from('--' + boundary);
  let pos = 0;

  while (pos < buf.length) {
    const start = buf.indexOf(sep, pos);
    if (start === -1) break;
    const afterSep = start + sep.length;
    // check for closing --
    if (buf[afterSep] === 0x2D && buf[afterSep + 1] === 0x2D) break;

    // find header/body separator (double CRLF)
    const headerEnd = buf.indexOf('\r\n\r\n', afterSep);
    if (headerEnd === -1) break;
    const headerStr = buf.slice(afterSep, headerEnd).toString('utf8');

    // find end of this part
    const nextSep = buf.indexOf(sep, headerEnd + 4);
    const bodyEnd = nextSep !== -1 ? nextSep - 2 : buf.length; // -2 for trailing CRLF
    const body = buf.slice(headerEnd + 4, bodyEnd);

    // parse disposition
    const dispMatch = headerStr.match(/name="([^"]+)"/);
    const fileMatch = headerStr.match(/filename="([^"]+)"/);
    const ctMatch = headerStr.match(/Content-Type:\s*(.+)/i);
    const name = dispMatch ? dispMatch[1] : null;

    if (name) {
      if (fileMatch) {
        parts[name] = {
          filename: fileMatch[1],
          contentType: ctMatch ? ctMatch[1].trim() : 'application/octet-stream',
          data: body,
        };
      } else {
        parts[name] = body.toString('utf8');
      }
    }
    pos = nextSep !== -1 ? nextSep : buf.length;
  }
  return parts;
}

// ── PO number generator ─────────────────────────────────────────────
async function generatePoNumber() {
  const today = new Date();
  const ymd = today.getFullYear().toString()
    + String(today.getMonth() + 1).padStart(2, '0')
    + String(today.getDate()).padStart(2, '0');
  const prefix = `PO-${ymd}-`;
  const row = await db.prepare(`SELECT po_number FROM po_header WHERE po_number LIKE ? ORDER BY po_number DESC LIMIT 1`).get(prefix + '%');
  let seq = 1;
  if (row) {
    const last = parseInt(row.po_number.split('-')[2], 10);
    if (!isNaN(last)) seq = last + 1;
  }
  return prefix + String(seq).padStart(3, '0');
}

// ── Route Modules (모듈화) ──────────────────────────────────────────
const routeCtx = require('./routes/_ctx');
// ctx 초기화 — 모든 공유 상태를 route 모듈에 전달
Object.assign(routeCtx, {
  db, ok, fail, jsonRes, readBody, readJSON, parseMultipart,
  signToken, verifyToken, extractToken,
  auditLog, logError, logPOActivity: typeof logPOActivity !== 'undefined' ? logPOActivity : null,
  createNotification, generatePoNumber, hasPermission,
  ALL_PAGES, ROLE_PERMISSIONS, KNOWN_ACCOUNTS: typeof KNOWN_ACCOUNTS !== 'undefined' ? KNOWN_ACCOUNTS : {},
  DEPT_GUBUN_LABELS: typeof DEPT_GUBUN_LABELS !== 'undefined' ? DEPT_GUBUN_LABELS : {},
  BRAND_LABELS: typeof BRAND_LABELS !== 'undefined' ? BRAND_LABELS : {},
  bcrypt, jwt, sql, nodemailer, fs, path,
  _jwtSecret: typeof JWT_SECRET !== 'undefined' ? JWT_SECRET : 'dev-secret',
  _smtpTransporter: typeof smtpTransporter !== 'undefined' ? smtpTransporter : null,
  SMTP_FROM: typeof SMTP_FROM !== 'undefined' ? SMTP_FROM : '',
  xerpInventoryCache: typeof xerpInventoryCache !== 'undefined' ? xerpInventoryCache : null,
  getXerpPool: () => typeof xerpPool !== 'undefined' ? xerpPool : null,
  getDdPool: () => typeof ddPool !== 'undefined' ? ddPool : null,
  setXerpPool: (p) => { xerpPool = p; },
  ensureXerpPool: typeof ensureXerpPool !== 'undefined' ? ensureXerpPool : null,
  connectXERP: typeof connectXERP !== 'undefined' ? connectXERP : null,
  resetXerpReconnectAttempts: () => { if (typeof xerpReconnectAttempts !== 'undefined') xerpReconnectAttempts = 0; },
  get xerpReconnectTimer() { return typeof xerpReconnectTimer !== 'undefined' ? xerpReconnectTimer : null; },
  set xerpReconnectTimer(v) { if (typeof xerpReconnectTimer !== 'undefined') xerpReconnectTimer = v; },
  xerpConfig: typeof xerpConfig !== 'undefined' ? xerpConfig : {},
  barShopConfig: typeof barShopConfig !== 'undefined' ? barShopConfig : {},
  ddConfig: typeof ddConfig !== 'undefined' ? ddConfig : {},
  envVars: typeof envVars !== 'undefined' ? envVars : {},
  dotenvPath: typeof dotenvPath !== 'undefined' ? dotenvPath : '',
  XERP_SITE_CODE: typeof XERP_SITE_CODE !== 'undefined' ? XERP_SITE_CODE : 'BK10',
  XERP_INV_WH_LIST: typeof XERP_INV_WH_LIST !== 'undefined' ? XERP_INV_WH_LIST : [],
  APP_VERSION: typeof APP_VERSION !== 'undefined' ? APP_VERSION : '0.0.0',
  APP_VERSION_DATE: typeof APP_VERSION_DATE !== 'undefined' ? APP_VERSION_DATE : '',
  _startTime: typeof _startTime !== 'undefined' ? _startTime : Date.now(),
  // Auto-order helpers
  sendPOEmail: typeof sendPOEmail !== 'undefined' ? sendPOEmail : null,
  resolveVendor: typeof resolveVendor !== 'undefined' ? resolveVendor : null,
  runAutoOrderScheduler: typeof runAutoOrderScheduler !== 'undefined' ? runAutoOrderScheduler : null,
  runShipmentEmailCheck: typeof runShipmentEmailCheck !== 'undefined' ? runShipmentEmailCheck : null,
  ORIGIN_LEAD_TIME: typeof ORIGIN_LEAD_TIME !== 'undefined' ? ORIGIN_LEAD_TIME : { '중국': 50, '한국': 7, '더기프트': 14 },
  _hasEntity: typeof _hasEntity !== 'undefined' ? _hasEntity : {},
  __dir: typeof __dir !== 'undefined' ? __dir : __dirname,
});

// ── legal_entity 2차 ALTER (뒤늦게 CREATE 된 trade_document/defects/batch_master/work_orders 대응) ──
// 1차 ALTER 루프(line ~1560)는 이 테이블들이 아직 CREATE 전이라 silent-fail 했음.
// 이제 모든 CREATE TABLE 이 끝났으니 누락된 것들만 재시도.
try {
  const _entityTablesLate = ['trade_document', 'defects', 'batch_master', 'work_orders'];
  let _lateOk = 0;
  for (const tbl of _entityTablesLate) {
    try {
      const chk = await db.prepare("SELECT 1 AS x FROM information_schema.columns WHERE table_name=? AND column_name='legal_entity'").get(tbl);
      if (!chk) {
        await db.exec(`ALTER TABLE ${tbl} ADD COLUMN legal_entity TEXT DEFAULT 'barunson'`);
        await db.prepare(`UPDATE ${tbl} SET legal_entity='barunson' WHERE legal_entity IS NULL OR legal_entity=''`).run().catch(()=>{});
        _lateOk++;
      }
    } catch(e) { /* 테이블 자체가 없으면 skip */ }
  }
  if (_lateOk) console.log(`[entity 2nd pass] ${_lateOk}개 테이블에 legal_entity 추가 완료`);
} catch(_) {}

// ── products 누락 컬럼 보강 (product_spec 등 — reloadProductInfoFromDB 의 SELECT 에서 참조) ──
// products 테이블은 외부 마이그레이션/수동 DDL 로 생성된 케이스가 많아 스키마 편차 발생.
// 코드가 참조하는 컬럼이 없으면 런타임 쿼리 전체 실패 → reloadProductInfoFromDB 재로드 실패 연쇄.
try {
  const productsCols = [
    ['product_spec', "TEXT DEFAULT ''"],
    ['thomson',  "TEXT DEFAULT ''"],
    ['envelope', "TEXT DEFAULT ''"],
    ['seari',    "TEXT DEFAULT ''"],
    ['laser',    "TEXT DEFAULT ''"],
    ['cutting',  "TEXT DEFAULT ''"],
    ['silk',     "TEXT DEFAULT ''"]
  ];
  for (const [col, type] of productsCols) {
    try { await db.exec(`ALTER TABLE products ADD COLUMN IF NOT EXISTS ${col} ${type}`); } catch(_) {}
  }
} catch(_) {}

// 라우트 모듈 로드 (새 기능은 모듈로 추가)
const moduleRouters = [];
try {
  const journalAuto = require('./routes/journal-auto');
  if (journalAuto.initTables) journalAuto.initTables();
  if (journalAuto.router) moduleRouters.push(journalAuto.router);
  // 입고 시 자동 전표 훅을 전역에 등록
  global._hookReceiveJournal = journalAuto.hookReceiveJournal || null;
  global._hookShipmentJournal = journalAuto.hookShipmentJournal || null;
  console.log('✅ 모듈 로드: journal-auto (' + (journalAuto.router?.count || 0) + ' routes)');
} catch(e) { console.log('⚠️ journal-auto 모듈 미로드:', e.message); }

try {
  const vatReport = require('./routes/vat-report');
  if (vatReport.initTables) vatReport.initTables();
  if (vatReport.router) moduleRouters.push(vatReport.router);
  console.log('✅ 모듈 로드: vat-report (' + (vatReport.router?.count || 0) + ' routes)');
} catch(e) { console.log('⚠️ vat-report 모듈 미로드:', e.message); }

try {
  const barcode = require('./routes/barcode');
  if (barcode.initTables) await barcode.initTables();
  if (barcode.router) moduleRouters.push(barcode.router);
  console.log('✅ 모듈 로드: barcode (' + (barcode.router?.count || 0) + ' routes)');
} catch(e) { console.log('⚠️ barcode 모듈 미로드:', e.message); }

try {
  const reportEngine = require('./routes/report-engine');
  if (reportEngine.initTables) await reportEngine.initTables();
  if (reportEngine.router) moduleRouters.push(reportEngine.router);
  console.log('✅ 모듈 로드: report-engine (' + (reportEngine.router?.count || 0) + ' routes)');
} catch(e) { console.log('⚠️ report-engine 모듈 미로드:', e.message); }

try {
  const admin = require('./routes/admin');
  if (admin.router) moduleRouters.push(admin.router);
  console.log('✅ 모듈 로드: admin (' + (admin.router?.count || 0) + ' routes)');
} catch(e) { console.log('⚠️ admin 모듈 미로드:', e.message); }

try {
  const vendors = require('./routes/vendors');
  if (vendors.router) moduleRouters.push(vendors.router);
  console.log('✅ 모듈 로드: vendors (' + (vendors.router?.count || 0) + ' routes)');
} catch(e) { console.log('⚠️ vendors 모듈 미로드:', e.message); }

try {
  const autoOrder = require('./routes/auto-order');
  if (autoOrder.router) moduleRouters.push(autoOrder.router);
  console.log('✅ 모듈 로드: auto-order (' + (autoOrder.router?.count || 0) + ' routes)');
} catch(e) { console.log('⚠️ auto-order 모듈 미로드:', e.message); }

// ── 추가 모듈 로드 (Step 1 리팩토링) ──
const _newModules = ['auth','products','inventory','po','vendor-portal','accounting','post-process','sales','bom-mrp','reports','manufacturing','china','wms-integration'];
for (const modName of _newModules) {
  try {
    const mod = require(`./routes/${modName}`);
    if (mod.initTables) mod.initTables();
    if (mod.router) moduleRouters.push(mod.router);
    console.log(`✅ 모듈 로드: ${modName} (${mod.router?.count || 0} routes)`);
  } catch(e) { console.log(`⚠️ ${modName} 모듈 미로드: ${e.message}`); }
}

console.log(`📦 총 ${moduleRouters.reduce((s,r) => s + r.count, 0)}개 모듈 라우트 등록`);

// ── Server ──────────────────────────────────────────────────────────
http.createServer(async (req, res) => {
  const _reqStart = Date.now();
  const _clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
  // 헬스체크는 최우선 처리 (Docker/Starlog 배포 안정성)
  const u = req.url;
  if ((u === '/health' || u === '/api/health') && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json', ...CORS });
    res.end(JSON.stringify({ ok: true, data: { status: 'ok', timestamp: new Date().toISOString() } }));
    return;
  }
  // 응답 완료 시 액세스 로그
  res.on('finish', () => {
    const ms = Date.now() - _reqStart;
    if (u !== '/health' && u !== '/api/health') {
      logger.access(req.method, u, res.statusCode, ms, _clientIp);
    }
  });
  try {
    await handleRequest(req, res);
  } catch (e) {
    logger.error('Server error:', e.message, e.stack);
    logError('error', e.message, e.stack, req.url, req.method);
    fail(res, 500, e.message || 'Internal Server Error');
  }
}).listen(PORT, '0.0.0.0', () => {
  logger.info(`스마트재고현황: http://localhost:${PORT}  (startup: ${((Date.now() - _startTime)/1000).toFixed(1)}s)`);
  logger.info(`헬스체크: http://localhost:${PORT}/api/health`);
  logger.info(`로그 디렉토리: ${LOG_DIR}`);
  // product_info 캐시를 DB에서 즉시 로드 (첫 요청 전에 완료)
  reloadProductInfoFromDB().catch(e => console.warn('[startup] product_info 초기 로드 실패:', e.message));
  // 외부 DB 연결은 서버 기동 후 백그라운드에서 (Docker 헬스체크 타임아웃 방지)
  initXERP();
  initDD();
  scheduleAutoOrder();
  scheduleXerpSync();
});

// 미처리 예외/프라미스 거부 핸들러
process.on('uncaughtException', (e) => {
  console.error('Uncaught Exception:', e);
  try { logError('fatal', e.message, e.stack); } catch(_) {}
});
process.on('unhandledRejection', (reason) => {
  const msg = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : '';
  console.error('Unhandled Rejection:', msg);
  try { logError('error', msg, stack); } catch(_) {}
});

// ════════════════════════════════════════════════════════════════════
//  재고현황2 백그라운드 적재 (XERP → 로컬 Postgres)
//  - 월 단위 청크로 진행, 진행률을 inv2_sync_jobs.progress_pct 에 기록
//  - 멱등성: UNIQUE 인덱스 + ON CONFLICT DO NOTHING
//  - 동시 실행 방지: 같은 (job_type, table_name) 의 running 잡이 있으면 스킵
// ════════════════════════════════════════════════════════════════════
function _ymdToDate(ymd) {
  return new Date(parseInt(ymd.slice(0,4)), parseInt(ymd.slice(4,6))-1, parseInt(ymd.slice(6,8)));
}
function _fmtYMD(d) {
  return d.getFullYear() + String(d.getMonth()+1).padStart(2,'0') + String(d.getDate()).padStart(2,'0');
}
function _monthChunks(startYMD, endYMD) {
  const out = [];
  const sy = parseInt(startYMD.slice(0,4)), sm = parseInt(startYMD.slice(4,6))-1;
  const endD = _ymdToDate(endYMD);
  let cur = new Date(sy, sm, 1);
  while (cur <= endD) {
    const last = new Date(cur.getFullYear(), cur.getMonth()+1, 0);
    const ms = _fmtYMD(cur);
    const me = _fmtYMD(last);
    out.push({ start: ms < startYMD ? startYMD : ms, end: me > endYMD ? endYMD : me });
    cur = new Date(cur.getFullYear(), cur.getMonth()+1, 1);
  }
  return out;
}
async function _inv2UpdateJob(jobId, fields) {
  const cols = Object.keys(fields);
  if (!cols.length) return;
  const sets = cols.map(c => `${c}=?`).join(',');
  const vals = cols.map(c => fields[c]);
  vals.push(jobId);
  try { await db.prepare(`UPDATE inv2_sync_jobs SET ${sets} WHERE job_id=?`).run(...vals); } catch(e) {
    console.warn('[inv2 job] update fail', jobId, e.message);
  }
}
async function _inv2RunInoutBackfill(jobId, startYMD, endYMD) {
  try {
    await _inv2UpdateJob(jobId, { status:'running', started_at:'NOW_PG', current_step:'XERP 연결 확인' });
    // started_at handled separately to use NOW()
    await db.prepare("UPDATE inv2_sync_jobs SET started_at=datetime('now','localtime') WHERE job_id=? AND (started_at IS NULL OR started_at='')").run(jobId);
    if (!await ensureXerpPool()) throw new Error('XERP 풀 연결 불가');
    const chunks = _monthChunks(startYMD, endYMD);
    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const ymLabel = c.start.slice(0,4) + '-' + c.start.slice(4,6);
      await _inv2UpdateJob(jobId, { current_step: `[입출고] ${ymLabel} 조회 중...`, progress_pct: Math.floor(i / chunks.length * 100) });
      // endNext = end+1day exclusive
      const endNext = _fmtYMD(new Date(parseInt(c.end.slice(0,4)), parseInt(c.end.slice(4,6))-1, parseInt(c.end.slice(6,8))+1));
      const r = await xerpPool.request()
        .input('s', sql.NChar(16), c.start)
        .input('e', sql.NChar(16), endNext)
        .query(`SELECT RTRIM(InoutDate) AS d, RTRIM(WhCode) AS wh, RTRIM(InoutNo) AS no,
                       InoutSeq AS seq, RTRIM(InoutGubun) AS gb,
                       RTRIM(ItemCode) AS code, RTRIM(ItemName) AS name,
                       InoutQty AS qty, InoutAmnt AS amnt
                FROM mmInoutItem WITH (NOLOCK)
                WHERE SiteCode = '${XERP_SITE_CODE}'
                  AND InoutGubun IN ('SO','MO','SI','MI')
                  AND InoutDate >= @s AND InoutDate < @e`);
      const rows = r.recordset || [];
      // 배치 INSERT — 한 트랜잭션에서 ON CONFLICT DO NOTHING
      const insStmt = db.prepare(`INSERT INTO inv2_inout (inout_date, site_code, wh_code, inout_no, inout_seq, inout_gubun, item_code, item_name, inout_qty, inout_amnt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
      const tx = db.transaction(async () => {
        for (const row of rows) {
          await insStmt.run(
            (row.d||'').trim(), XERP_SITE_CODE, (row.wh||'').trim(),
            (row.no||'').trim(), Number(row.seq||0), (row.gb||'').trim(),
            (row.code||'').trim(), (row.name||'').trim(),
            Number(row.qty||0), Number(row.amnt||0)
          );
        }
      });
      await tx();
      inserted += rows.length;
      await _inv2UpdateJob(jobId, { rows_inserted: inserted, current_step: `[입출고] ${ymLabel} 완료 (+${rows.length}행, 누적 ${inserted})` });
    }
    await _inv2UpdateJob(jobId, { status:'completed', progress_pct: 100, finished_at: 'NOW_PG', current_step: `완료 (총 ${inserted}행)` });
    await db.prepare("UPDATE inv2_sync_jobs SET finished_at=datetime('now','localtime') WHERE job_id=?").run(jobId);
    console.log(`[inv2 job ${jobId}] inout backfill done (+${inserted})`);
  } catch (e) {
    console.error(`[inv2 job ${jobId}] inout backfill failed:`, e.message);
    await _inv2UpdateJob(jobId, { status:'failed', error_msg: e.message, finished_at:'NOW_PG' });
    await db.prepare("UPDATE inv2_sync_jobs SET finished_at=datetime('now','localtime') WHERE job_id=? AND (finished_at IS NULL OR finished_at='')").run(jobId);
  }
}
async function _inv2RunSalesBackfill(jobId, startYMD, endYMD) {
  try {
    await _inv2UpdateJob(jobId, { status:'running', current_step:'XERP 연결 확인' });
    await db.prepare("UPDATE inv2_sync_jobs SET started_at=datetime('now','localtime') WHERE job_id=? AND (started_at IS NULL OR started_at='')").run(jobId);
    if (!await ensureXerpPool()) throw new Error('XERP 풀 연결 불가');
    const chunks = _monthChunks(startYMD, endYMD);
    let inserted = 0;
    for (let i = 0; i < chunks.length; i++) {
      const c = chunks[i];
      const ymLabel = c.start.slice(0,4) + '-' + c.start.slice(4,6);
      await _inv2UpdateJob(jobId, { current_step:`[매출] ${ymLabel} 조회 중...`, progress_pct: Math.floor(i / chunks.length * 100) });
      const r = await xerpPool.request()
        .input('s', sql.NVarChar(16), c.start)
        .input('e', sql.NVarChar(16), c.end)
        .query(`SELECT RTRIM(h_date) AS d, RTRIM(h_orderid) AS oid, b_seq AS seq, RTRIM(b_goodCode) AS code,
                       b_OrderNum AS qty, b_sumPrice AS bsum, h_sumPrice AS hsum,
                       h_offerPrice AS off, h_superTax AS tax, FeeAmnt AS fee, RTRIM(DeptGubun) AS dg
                FROM ERP_SalesData WITH (NOLOCK)
                WHERE h_date >= @s AND h_date <= @e`);
      const rows = r.recordset || [];
      const insStmt = db.prepare(`INSERT INTO inv2_sales (h_date, h_orderid, b_seq, b_goodcode, b_ordernum, b_sumprice, h_sumprice, h_offerprice, h_supertax, fee_amnt, dept_gubun)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`);
      const tx = db.transaction(async () => {
        for (const row of rows) {
          await insStmt.run(
            (row.d||'').trim(), (row.oid||'').trim(), Number(row.seq||0),
            (row.code||'').trim(), Number(row.qty||0), Number(row.bsum||0),
            Number(row.hsum||0), Number(row.off||0), Number(row.tax||0),
            Number(row.fee||0), (row.dg||'').trim()
          );
        }
      });
      await tx();
      inserted += rows.length;
      await _inv2UpdateJob(jobId, { rows_inserted: inserted, current_step:`[매출] ${ymLabel} 완료 (+${rows.length}행, 누적 ${inserted})` });
    }
    await _inv2UpdateJob(jobId, { status:'completed', progress_pct:100, current_step:`완료 (총 ${inserted}행)` });
    await db.prepare("UPDATE inv2_sync_jobs SET finished_at=datetime('now','localtime') WHERE job_id=?").run(jobId);
    console.log(`[inv2 job ${jobId}] sales backfill done (+${inserted})`);
  } catch (e) {
    console.error(`[inv2 job ${jobId}] sales backfill failed:`, e.message);
    await _inv2UpdateJob(jobId, { status:'failed', error_msg: e.message });
    await db.prepare("UPDATE inv2_sync_jobs SET finished_at=datetime('now','localtime') WHERE job_id=?").run(jobId);
  }
}
async function _inv2RunInventorySnapshot(jobId) {
  try {
    await _inv2UpdateJob(jobId, { status:'running', current_step:'mmInventory 조회' });
    await db.prepare("UPDATE inv2_sync_jobs SET started_at=datetime('now','localtime') WHERE job_id=?").run(jobId);
    if (!await ensureXerpPool()) throw new Error('XERP 풀 연결 불가');
    const r = await xerpPool.request().query(`
      SELECT RTRIM(WhCode) AS wh, RTRIM(ItemCode) AS code, RTRIM(ItemName) AS name, ItemStock AS qty
      FROM mmInventory WITH (NOLOCK)
      WHERE SiteCode = '${XERP_SITE_CODE}' AND WhCode IS NOT NULL AND RTRIM(WhCode) <> ''
    `);
    const rows = r.recordset || [];
    const today = new Date();
    const snapshotDate = today.getFullYear() + '-' + String(today.getMonth()+1).padStart(2,'0') + '-' + String(today.getDate()).padStart(2,'0');
    // 같은 날짜 스냅샷 중복 방지: 먼저 삭제
    await db.prepare("DELETE FROM inv2_inventory_snapshot WHERE snapshot_date=?").run(snapshotDate);
    const insStmt = db.prepare(`INSERT INTO inv2_inventory_snapshot (snapshot_date, site_code, wh_code, item_code, item_name, stock_qty) VALUES (?, ?, ?, ?, ?, ?)`);
    let inserted = 0;
    const tx = db.transaction(async () => {
      for (const row of rows) {
        await insStmt.run(snapshotDate, XERP_SITE_CODE, (row.wh||'').trim(), (row.code||'').trim(), (row.name||'').trim(), Number(row.qty||0));
        inserted++;
      }
    });
    await tx();
    await _inv2UpdateJob(jobId, { status:'completed', progress_pct:100, rows_inserted: inserted, current_step:`완료 (${snapshotDate} 기준 ${inserted}행)` });
    await db.prepare("UPDATE inv2_sync_jobs SET finished_at=datetime('now','localtime') WHERE job_id=?").run(jobId);
    console.log(`[inv2 job ${jobId}] inventory snapshot done (+${inserted})`);
  } catch (e) {
    console.error(`[inv2 job ${jobId}] inventory snapshot failed:`, e.message);
    await _inv2UpdateJob(jobId, { status:'failed', error_msg: e.message });
    await db.prepare("UPDATE inv2_sync_jobs SET finished_at=datetime('now','localtime') WHERE job_id=?").run(jobId);
  }
}
async function _inv2EnqueueJob(jobType, tableName, rangeStart, rangeEnd, triggeredBy) {
  // 같은 (job_type, table_name) 이 running/queued 면 거부
  const existing = await db.prepare("SELECT job_id FROM inv2_sync_jobs WHERE table_name=? AND status IN ('running','queued') ORDER BY job_id DESC LIMIT 1").get(tableName);
  if (existing) return { skipped: true, job_id: existing.job_id, reason: '이미 진행 중인 작업이 있음' };
  const r = await db.prepare(`INSERT INTO inv2_sync_jobs (job_type, table_name, range_start, range_end, status, triggered_by) VALUES (?, ?, ?, ?, 'queued', ?)`).run(jobType, tableName, rangeStart, rangeEnd, triggeredBy);
  const jobId = r.lastInsertRowid;
  // fire-and-forget
  setImmediate(() => {
    if (tableName === 'inout') _inv2RunInoutBackfill(jobId, rangeStart, rangeEnd);
    else if (tableName === 'sales') _inv2RunSalesBackfill(jobId, rangeStart, rangeEnd);
    else if (tableName === 'inventory') _inv2RunInventorySnapshot(jobId);
  });
  return { job_id: jobId };
}

async function handleRequest(req, res) {
  res._req = req; // gzip 판단용 req 참조 보관
  const parsed = new URL(req.url, `http://localhost:${PORT}`);
  const pathname = parsed.pathname;
  const method = req.method;

  // ── CORS preflight ──
  if (method === 'OPTIONS') {
    res.writeHead(204, CORS);
    res.end();
    return;
  }

  // ── 모듈 라우터 우선 처리 ──
  for (const mr of moduleRouters) {
    if (await mr.handle(req, res, pathname, method, parsed)) return;
  }

  // ── 인라인 라우트 제거됨 — 모든 API는 routes/*.js 모듈에서 처리 ──
  // 매칭되지 않은 요청 → 404
  fail(res, 404, `API를 찾을 수 없습니다: ${method} ${pathname}`);
}

function scheduleAutoOrder() {
  const now = new Date();
  const next9am = new Date(now);
  next9am.setHours(9, 0, 0, 0);
  if (now >= next9am) next9am.setDate(next9am.getDate() + 1);

  const msUntilNext = next9am - now;
  console.log(`[자동발주 스케줄러] 다음 실행: ${next9am.toLocaleString('ko-KR')} (${Math.round(msUntilNext / 60000)}분 후)`);

  setTimeout(() => {
    _safeRunAutoOrder();
    // 이후 24시간마다 반복
    setInterval(_safeRunAutoOrder, 24 * 60 * 60 * 1000);
  }, msUntilNext);
}

// ── 매일 9시 발주 현황 Slack 요약 ─────────────────────────────────
// 자동발주 스케줄러 실행 직후(약 1분 뒤) 호출됨
async function runDailyPOSummary() {
  if (!_slackWebhookUrl) return;
  const today = new Date().toISOString().slice(0, 10);

  // 1) 오늘 자동 생성된 PO 집계
  let todayPOs = [];
  try {
    todayPOs = await db.prepare(
      "SELECT po_number, vendor_name, total_qty, origin, notes FROM po_header WHERE po_date=? AND notes LIKE '%자동발주%'"
    ).all(today);
  } catch(e) { logger.warn('[일일 요약] 오늘 PO 조회 실패:', e.message); }

  // 2) 자동발주 설정 품목 중 긴급/위험 분류 (재고 파일 기반)
  let urgent = 0, warning = 0, totalEnabled = 0;
  try {
    const items = await db.prepare('SELECT product_code FROM auto_order_items WHERE enabled=1').all();
    totalEnabled = items.length;
    let inv = [];
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(__dir, 'erp_smart_inventory.json'), 'utf8'));
      inv = raw.products || raw.data || (Array.isArray(raw) ? raw : []);
    } catch(_) {}
    const invMap = {};
    for (const p of inv) invMap[p['품목코드']] = p;
    for (const it of items) {
      const p = invMap[it.product_code] || invMap[(it.product_code||'').toUpperCase()];
      if (!p) continue;
      const avail = typeof p['가용재고']==='number' ? p['가용재고'] : 0;
      const daily = p['_xerpDaily'] || 0;
      if (daily <= 0) continue;
      const remainDays = avail / daily;
      if (remainDays <= 14) urgent++;
      else if (remainDays <= 21) warning++;
    }
  } catch(e) { logger.warn('[일일 요약] 긴급도 분류 실패:', e.message); }

  // 3) Slack 메시지 작성
  const dateLabel = new Date().toLocaleDateString('ko-KR', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
  let msg = `📋 *ERP 일일 발주 요약 — ${dateLabel}*\n\n`;
  msg += `🤖 *자동발주 생성: ${todayPOs.length}건*\n`;
  if (todayPOs.length > 0) {
    const preview = todayPOs.slice(0, 10).map(po => `  • \`${po.po_number}\` ${po.vendor_name || '(미지정)'} — ${(po.total_qty||0).toLocaleString()}매 [${po.origin||'?'}]`).join('\n');
    msg += preview;
    if (todayPOs.length > 10) msg += `\n  _...외 ${todayPOs.length - 10}건_`;
    msg += '\n\n';
  } else {
    msg += `  _오늘 자동 생성된 발주 없음_\n\n`;
  }
  msg += `📊 *자동발주 모니터링: ${totalEnabled}개 품목*\n`;
  msg += `  🔴 긴급 (14일 이하): *${urgent}개*\n`;
  msg += `  🟡 위험 (21일 이하): *${warning}개*\n`;
  msg += `  🟢 안전: ${Math.max(totalEnabled - urgent - warning, 0)}개\n`;
  msg += `\n<https://docker-manager.barunsoncard.com/c/s-c-erp/|ERP 바로가기>`;

  await sendSlack(msg);
  console.log('[일일 발주 요약] Slack 전송 완료');
}

// XERP 데이터 자동 동기화: 매일 9:30 실행
function scheduleXerpSync() {
  const now = new Date();
  const next930 = new Date(now);
  next930.setHours(9, 30, 0, 0);
  if (now >= next930) next930.setDate(next930.getDate() + 1);

  const msUntil = next930 - now;
  console.log(`[XERP 동기화] 다음 실행: ${next930.toLocaleString('ko-KR')} (${Math.round(msUntil / 60000)}분 후)`);

  setTimeout(async () => {
    await refreshXerpCache();
    setInterval(async () => {
      await refreshXerpCache();
    }, 24 * 60 * 60 * 1000);
  }, msUntil);
}

async function refreshXerpCache() {
  console.log(`[XERP 동기화] ${new Date().toLocaleString('ko-KR')} 자동 동기화 시작`);
  try {
    xerpInventoryCacheTime = 0; // 캐시 무효화
    const http = require('http');
    const req = http.get(`http://localhost:${PORT}/api/xerp-inventory?refresh=1`, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => console.log('[XERP 동기화] 완료'));
    });
    req.on('error', e => console.warn('[XERP 동기화] 실패:', e.message));
  } catch(e) { console.warn('[XERP 동기화] 오류:', e.message); }
}

} // end startServer()

startServer().catch(e => { console.error('❌ 서버 시작 실패:', e); process.exit(1); });
