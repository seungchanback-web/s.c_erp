// routes/_ctx.js — 라우트 모듈이 공유하는 컨텍스트 컨테이너
// serve_inv2.js에서 초기화 후 주입됨

const ctx = {
  // DB connections
  db: null,           // SQLite (better-sqlite3)
  xerpPool: null,     // MSSQL pool (getter)
  ddPool: null,       // MySQL pool (getter)

  // Response helpers
  ok: null,
  fail: null,
  jsonRes: null,
  readBody: null,
  readJSON: null,
  parseMultipart: null,

  // Auth helpers
  signToken: null,
  verifyToken: null,
  extractToken: null,

  // Vendor auth helpers (업체 포털 전용 JWT)
  generateVendorToken: null,
  decodeVendorToken: null,
  verifyVendorToken: null,
  extractVendorAuth: null,

  // Logging
  auditLog: null,
  logError: null,
  logPOActivity: null,

  // Notification
  createNotification: null,

  // PO helpers
  generatePoNumber: null,

  // Permission
  hasPermission: null,
  ALL_PAGES: null,
  ROLE_PERMISSIONS: null,

  // SMTP
  getSmtpTransporter: () => ctx._smtpTransporter,
  _smtpTransporter: null,
  SMTP_FROM: '',

  // Caches
  xerpItemNameCache: {},
  xerpInventoryCache: null,
  salesKpiCache: null,
  costSummaryCache: null,
  acctStatsCache: null,
  trialBalanceCache: null,

  // Product helpers
  getProductInfo: null,
  getLastVendorPrice: null,

  // Constants
  KNOWN_ACCOUNTS: null,
  DEPT_GUBUN_LABELS: null,
  BRAND_LABELS: null,

  // External modules
  bcrypt: null,
  jwt: null,
  sql: null,
  nodemailer: null,
  fs: null,
  path: null,

  // Ensure XERP connection
  ensureXerpPool: null,

  // Pool getters (live references)
  getXerpPool: null,
  getDdPool: null,
  setXerpPool: null,

  // XERP reconnect helpers
  xerpReconnectTimer: null,
  resetXerpReconnectAttempts: null,
  connectXERP: null,

  // Config objects (admin/debug 진단용)
  xerpConfig: null,
  barShopConfig: null,
  ddConfig: null,
  envVars: null,
  dotenvPath: '',
  XERP_SITE_CODE: 'BK10',
  XERP_INV_WH_LIST: [],

  // App meta
  APP_VERSION: '0.0.0',
  APP_VERSION_DATE: '',
  _startTime: null,

  // Journal entry auto-creation (cross-module)
  createJournalEntry: null,

  // Product module helpers
  scheduleProductInfoReload: null,
  xerpInventoryCacheTime: 0,
  productInfoCache: null,
  DATA_DIR: '',
  CORS: {},
  MIME: {},

  // Auto-order helpers
  sendPOEmail: null,
  resolveVendor: null,
  runAutoOrderScheduler: null,
  runShipmentEmailCheck: null,
  ORIGIN_LEAD_TIME: { '중국': 50, '한국': 7, '더기프트': 14 },
  _hasEntity: {},
  __dir: '',

  // Inv2 background job runners (injected from serve_inv2.js)
  _inv2RunInoutBackfill: null,
  _inv2RunSalesBackfill: null,
  _inv2RunInventorySnapshot: null,

  // PO status maps
  PO_STATUS_EN_TO_KO: {},
  PO_STATUS_KO_TO_EN: {},
  MATERIAL_STATUS_KO: {},
  PROCESS_STATUS_KO: {},

  // XERP inventory caches (vendor-portal 재고 보강용)
  xerpInventoryCaches: null,

  // Slack
  sendSlack: null,
  _slackWebhookUrl: '',

  // Google Sheet helpers
  appendToGoogleSheet: null,
  cancelInGoogleSheet: null,

  // Post-process types helper
  getPostProcessTypes: null,

  // PORT (injected from serve_inv2.js)
  PORT: 4000,
};

module.exports = ctx;
