// routes/auth.js — 인증/사용자/권한 관리 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  AUTH API (공개 — 토큰 불필요)
// ════════════════════════════════════════════════════════════════════

// GET /api/auth/local-bypass — 로컬 개발용 인증 우회 (localhost에서만 작동)
router.get('/api/auth/local-bypass', async (req, res, parsed) => {
  const remoteAddr = req.socket.remoteAddress || '';
  const isLocal = remoteAddr === '127.0.0.1' || remoteAddr === '::1' || remoteAddr === '::ffff:127.0.0.1';
  if (!isLocal) { ctx.fail(res, 403, '로컬에서만 사용 가능합니다'); return; }
  const user = await ctx.db.prepare("SELECT user_id, username, display_name, role, email, permissions, favorites FROM users WHERE role = 'admin' AND is_active = 1 LIMIT 1").get();
  if (!user) { ctx.fail(res, 404, '관리자 계정이 없습니다'); return; }
  const token = ctx.signToken(user);
  let favs = []; try { favs = JSON.parse(user.favorites || '[]'); } catch {}
  ctx.ok(res, { token, user: { user_id: user.user_id, username: user.username, display_name: user.display_name, role: user.role, email: user.email }, permissions: ['*'], favorites: favs });
});

// POST /api/auth/login
router.post('/api/auth/login', async (req, res, parsed) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const body = await ctx.readJSON(req);
  const { username, password } = body;
  if (!username || !password) { ctx.fail(res, 400, '이메일(또는 아이디)과 비밀번호를 입력하세요'); return; }
  const user = await ctx.db.prepare("SELECT * FROM users WHERE (username = ? OR email = ?) AND is_active = 1").get(username, username);
  if (!user || !ctx.bcrypt.compareSync(password, user.password_hash)) {
    ctx.auditLog(null, username, 'login_failed', 'auth', '', '로그인 실패', clientIP);
    ctx.fail(res, 401, '아이디 또는 비밀번호가 일치하지 않습니다');
    return;
  }
  const token = ctx.signToken(user);
  await ctx.db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE user_id = ?").run(user.user_id);
  ctx.auditLog(user.user_id, user.username, 'login', 'auth', '', '로그인 성공', clientIP);
  ctx.ok(res, {
    token, user: { user_id: user.user_id, username: user.username, display_name: user.display_name, role: user.role, email: user.email }
  });
});

// POST /api/auth/google — Google OAuth 로그인
router.post('/api/auth/google', async (req, res, parsed) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const https = require('https');
  const body = await ctx.readJSON(req);
  const { credential } = body;
  if (!credential) { ctx.fail(res, 400, 'Google 인증 토큰이 없습니다'); return; }
  try {
    const verifyUrl = `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`;
    const gRes = await new Promise((resolve, reject) => {
      https.get(verifyUrl, (r) => {
        let data = '';
        r.on('data', c => data += c);
        r.on('end', () => {
          try { resolve({ status: r.statusCode, data: JSON.parse(data) }); }
          catch { reject(new Error('Google 응답 파싱 실패')); }
        });
      }).on('error', reject);
    });
    if (gRes.status !== 200 || !gRes.data.email) {
      ctx.fail(res, 401, 'Google 인증 실패: 유효하지 않은 토큰');
      return;
    }
    if (ctx.GOOGLE_CLIENT_ID && gRes.data.aud !== ctx.GOOGLE_CLIENT_ID) {
      ctx.fail(res, 401, 'Google Client ID 불일치');
      return;
    }
    const { email, sub: googleId, name, picture } = gRes.data;
    const emailDomain = email.split('@')[1];
    if (!ctx.ALLOWED_EMAIL_DOMAINS.includes(emailDomain)) {
      ctx.auditLog(null, email, 'google_login_blocked', 'auth', '', `허용되지 않은 도메인: ${emailDomain}`, clientIP);
      ctx.fail(res, 403, `허용되지 않은 이메일 도메인입니다 (${emailDomain}). 회사 계정으로 로그인하세요.`);
      return;
    }
    let user = await ctx.db.prepare("SELECT * FROM users WHERE google_id = ? OR email = ?").get(googleId, email);
    if (user && !user.is_active) {
      ctx.fail(res, 403, '비활성화된 계정입니다. 관리자에게 문의하세요.');
      return;
    }
    if (!user) {
      const username = email.split('@')[0];
      let finalUsername = username;
      let suffix = 1;
      while (await ctx.db.prepare("SELECT user_id FROM users WHERE username = ?").get(finalUsername)) {
        finalUsername = username + suffix++;
      }
      const result = await ctx.db.prepare("INSERT INTO users (username, password_hash, display_name, role, email, google_id, profile_picture) VALUES (?,?,?,?,?,?,?)")
        .run(finalUsername, '', name || email.split('@')[0], 'viewer', email, googleId, picture || '');
      user = await ctx.db.prepare("SELECT * FROM users WHERE user_id = ?").get(result.lastInsertRowid);
      ctx.auditLog(user.user_id, finalUsername, 'google_register', 'auth', user.user_id, `Google 자동 등록: ${email}`, clientIP);
      console.log(`✅ Google 신규 사용자 등록: ${email} (${finalUsername})`);
    } else {
      await ctx.db.prepare("UPDATE users SET google_id = ?, profile_picture = ?, display_name = CASE WHEN display_name = '' OR display_name = username THEN ? ELSE display_name END WHERE user_id = ?")
        .run(googleId, picture || '', name || user.display_name, user.user_id);
    }
    const token = ctx.signToken(user);
    await ctx.db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE user_id = ?").run(user.user_id);
    ctx.auditLog(user.user_id, user.username, 'google_login', 'auth', '', `Google 로그인: ${email}`, clientIP);
    ctx.ok(res, {
      token,
      user: { user_id: user.user_id, username: user.username, display_name: user.display_name || name, role: user.role, email: user.email, profile_picture: picture || user.profile_picture }
    });
  } catch (e) {
    console.error('Google 인증 오류:', e.message);
    ctx.fail(res, 500, 'Google 인증 처리 중 오류: ' + e.message);
  }
});

// GET /api/auth/config — 클라이언트용 인증 설정
router.get('/api/auth/config', async (req, res, parsed) => {
  ctx.ok(res, {
    google_client_id: ctx.GOOGLE_CLIENT_ID,
    allowed_domains: ctx.ALLOWED_EMAIL_DOMAINS,
    auth_mode: ctx.GOOGLE_CLIENT_ID ? 'google' : 'password'
  });
});

// POST /api/auth/register — 회원가입
router.post('/api/auth/register', async (req, res, parsed) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const body = await ctx.readJSON(req);
  const { email, password, display_name } = body;
  if (!email || !password) { ctx.fail(res, 400, '이메일과 비밀번호를 입력하세요'); return; }
  if (password.length < 4) { ctx.fail(res, 400, '비밀번호는 4자 이상이어야 합니다'); return; }
  const emailDomain = email.split('@')[1];
  if (!ctx.ALLOWED_EMAIL_DOMAINS.includes(emailDomain)) {
    ctx.fail(res, 403, `@${ctx.ALLOWED_EMAIL_DOMAINS.join(', @')} 이메일만 가입할 수 있습니다.`);
    return;
  }
  const exists = await ctx.db.prepare("SELECT user_id FROM users WHERE email = ?").get(email);
  if (exists) { ctx.fail(res, 409, '이미 등록된 이메일입니다. 로그인해주세요.'); return; }
  const username = email.split('@')[0];
  let finalUsername = username;
  let suffix = 1;
  while (await ctx.db.prepare("SELECT user_id FROM users WHERE username = ?").get(finalUsername)) {
    finalUsername = username + suffix++;
  }
  const hash = ctx.bcrypt.hashSync(password, 10);
  const result = await ctx.db.prepare("INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?,?,?,?,?)")
    .run(finalUsername, hash, display_name || username, 'viewer', email);
  const user = await ctx.db.prepare("SELECT * FROM users WHERE user_id = ?").get(result.lastInsertRowid);
  const token = ctx.signToken(user);
  await ctx.db.prepare("UPDATE users SET last_login = datetime('now','localtime') WHERE user_id = ?").run(user.user_id);
  ctx.auditLog(user.user_id, finalUsername, 'register', 'auth', user.user_id, `회원가입: ${email}`, clientIP);
  console.log(`✅ 신규 가입: ${email} (${finalUsername})`);
  ctx.ok(res, {
    token,
    user: { user_id: user.user_id, username: user.username, display_name: user.display_name, role: user.role, email: user.email }
  });
});

// GET /api/auth/me — 현재 사용자 정보
router.get('/api/auth/me', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증이 필요합니다'); return; }
  const user = await ctx.db.prepare("SELECT user_id, username, display_name, role, email, permissions, favorites, last_login FROM users WHERE user_id = ?").get(decoded.userId);
  if (!user) { ctx.fail(res, 401, '사용자를 찾을 수 없습니다'); return; }
  const userPerms = user.permissions ? JSON.parse(user.permissions) : [];
  const effectivePerms = user.role === 'admin' ? ['*'] : (userPerms.length > 0 ? userPerms : (ctx.ROLE_PERMISSIONS[user.role] || []));
  let favs = []; try { favs = JSON.parse(user.favorites || '[]'); } catch {}
  let menuEnabled = {};
  try {
    const ms = await ctx.db.prepare('SELECT page_id, is_enabled FROM menu_settings').all();
    ms.forEach(r => { menuEnabled[r.page_id] = r.is_enabled; });
  } catch (_) {}
  ctx.ok(res, { user: { ...user, permissions: undefined, favorites: undefined }, permissions: effectivePerms, favorites: favs, menuEnabled });
});

// GET /api/auth/pages — 전체 페이지 목록
router.get('/api/auth/pages', async (req, res, parsed) => {
  ctx.ok(res, ctx.ALL_PAGES);
});

// GET /api/menu-settings
router.get('/api/menu-settings', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증이 필요합니다'); return; }
  const rows = await ctx.db.prepare('SELECT page_id, is_enabled, sort_order FROM menu_settings ORDER BY sort_order').all();
  const map = {};
  rows.forEach(r => { map[r.page_id] = { is_enabled: r.is_enabled, sort_order: r.sort_order }; });
  ctx.ok(res, map);
});

// POST /api/menu-settings
router.post('/api/menu-settings', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증이 필요합니다'); return; }
  const user = await ctx.db.prepare("SELECT role FROM users WHERE user_id = ?").get(decoded.userId);
  if (!user || user.role !== 'admin') { ctx.fail(res, 403, '관리자만 메뉴 설정을 변경할 수 있습니다'); return; }
  const body = await ctx.readJSON(req);
  const upsert = ctx.db.prepare(`INSERT INTO menu_settings (page_id, is_enabled, sort_order, updated_at) VALUES (?, ?, ?, datetime('now','localtime'))
    ON CONFLICT(page_id) DO UPDATE SET is_enabled=excluded.is_enabled, sort_order=excluded.sort_order, updated_at=excluded.updated_at`);
  const PROTECTED = ['dashboard', 'settings'];
  const tx = ctx.db.transaction(async () => {
    for (const [pageId, cfg] of Object.entries(body.settings || {})) {
      const enabled = PROTECTED.includes(pageId) ? 1 : (cfg.is_enabled ? 1 : 0);
      await upsert.run(pageId, enabled, cfg.sort_order || 0);
    }
  });
  await tx();
  ctx.ok(res, { message: '메뉴 설정이 저장되었습니다' });
});

// POST /api/auth/change-password
router.post('/api/auth/change-password', async (req, res, parsed) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증이 필요합니다'); return; }
  const body = await ctx.readJSON(req);
  const user = await ctx.db.prepare("SELECT * FROM users WHERE user_id = ?").get(decoded.userId);
  if (!user) { ctx.fail(res, 404, '사용자 없음'); return; }
  if (!ctx.bcrypt.compareSync(body.current_password, user.password_hash)) { ctx.fail(res, 400, '현재 비밀번호가 일치하지 않습니다'); return; }
  if (!body.new_password || body.new_password.length < 4) { ctx.fail(res, 400, '새 비밀번호는 4자 이상이어야 합니다'); return; }
  const hash = ctx.bcrypt.hashSync(body.new_password, 10);
  await ctx.db.prepare("UPDATE users SET password_hash = ?, updated_at = datetime('now','localtime') WHERE user_id = ?").run(hash, decoded.userId);
  ctx.auditLog(decoded.userId, decoded.username, 'password_change', 'auth', decoded.userId, '비밀번호 변경', clientIP);
  ctx.ok(res, { message: '비밀번호가 변경되었습니다' });
});

// GET /api/auth/favorites
router.get('/api/auth/favorites', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증이 필요합니다'); return; }
  const row = await ctx.db.prepare("SELECT favorites FROM users WHERE user_id = ?").get(decoded.userId);
  let favs = [];
  try { favs = JSON.parse(row?.favorites || '[]'); } catch {}
  ctx.ok(res, favs);
});

// PUT /api/auth/favorites
router.put('/api/auth/favorites', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '인증이 필요합니다'); return; }
  const body = await ctx.readJSON(req);
  const favs = Array.isArray(body.favorites) ? body.favorites : [];
  await ctx.db.prepare("UPDATE users SET favorites = ? WHERE user_id = ?").run(JSON.stringify(favs), decoded.userId);
  ctx.ok(res, { message: '즐겨찾기 저장 완료', favorites: favs });
});

// GET /api/auth/user-list — 담당자 드롭다운용
router.get('/api/auth/user-list', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded) { ctx.fail(res, 401, '로그인 필요'); return; }
  const users = await ctx.db.prepare("SELECT user_id, username, display_name, role FROM users WHERE is_active=1 ORDER BY display_name").all();
  ctx.ok(res, users);
});

// GET /api/auth/users — 사용자 목록 (admin만)
router.get('/api/auth/users', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { ctx.fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const users = await ctx.db.prepare("SELECT user_id, username, display_name, role, email, permissions, is_active, last_login, created_at FROM users ORDER BY user_id").all();
  ctx.ok(res, users);
});

// POST /api/auth/users — 사용자 추가 (admin만)
router.post('/api/auth/users', async (req, res, parsed) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { ctx.fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const body = await ctx.readJSON(req);
  if (!body.username || !body.password) { ctx.fail(res, 400, '아이디와 비밀번호 필수'); return; }
  const exists = await ctx.db.prepare("SELECT user_id FROM users WHERE username = ?").get(body.username);
  if (exists) { ctx.fail(res, 409, '이미 존재하는 아이디입니다'); return; }
  const hash = ctx.bcrypt.hashSync(body.password, 10);
  const result = await ctx.db.prepare("INSERT INTO users (username, password_hash, display_name, role, email) VALUES (?,?,?,?,?)")
    .run(body.username, hash, body.display_name || body.username, body.role || 'viewer', body.email || '');
  ctx.auditLog(decoded.userId, decoded.username, 'user_create', 'users', result.lastInsertRowid, `사용자 생성: ${body.username} (${body.role || 'viewer'})`, clientIP);
  ctx.ok(res, { user_id: result.lastInsertRowid, username: body.username });
});

// PUT /api/auth/users/:id — 사용자 수정 (admin만)
router.putP(/^\/api\/auth\/users\/(\d+)$/, async (req, res, parsed, match) => {
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const token = ctx.extractToken(req);
  const decoded = token ? ctx.verifyToken(token) : null;
  if (!decoded || decoded.role !== 'admin') { ctx.fail(res, 403, '관리자 권한이 필요합니다'); return; }
  const uid = parseInt(match[1]);
  const body = await ctx.readJSON(req);
  const sets = [];
  const params = [];
  if (body.display_name !== undefined) { sets.push('display_name=?'); params.push(body.display_name); }
  if (body.role !== undefined) { sets.push('role=?'); params.push(body.role); }
  if (body.email !== undefined) { sets.push('email=?'); params.push(body.email); }
  if (body.is_active !== undefined) { sets.push('is_active=?'); params.push(body.is_active ? 1 : 0); }
  if (body.password) { sets.push('password_hash=?'); params.push(ctx.bcrypt.hashSync(body.password, 10)); }
  if (body.permissions !== undefined) { sets.push('permissions=?'); params.push(JSON.stringify(body.permissions)); }
  if (sets.length === 0) { ctx.fail(res, 400, '변경할 항목이 없습니다'); return; }
  sets.push("updated_at=datetime('now','localtime')");
  params.push(uid);
  await ctx.db.prepare(`UPDATE users SET ${sets.join(',')} WHERE user_id=?`).run(...params);
  ctx.auditLog(decoded.userId, decoded.username, 'user_update', 'users', uid, `사용자 수정: ${JSON.stringify(body)}`, clientIP);
  ctx.ok(res, { updated: uid });
});

module.exports = { router };
