// routes/products.js — 품목관리/자료함/후공정업체 라우트 모듈
const Router = require('./_router');
const ctx = require('./_ctx');
const router = new Router();

// ════════════════════════════════════════════════════════════════════
//  헬퍼: 생산지 정규화 (DD의 "예지가/코리아/마커엘엔피" 변형값 → "한국")
// ════════════════════════════════════════════════════════════════════

function _normOrigin(v) {
  const s = String(v || '').trim();
  if (!s) return '한국';
  if (s === '한국' || s === '중국' || s === '더기프트') return s;
  if (s === '코리아' || s === '예지가' || s === '마커엘엔피' ||
      s.indexOf('코리아') === 0 || s.indexOf('예지가') === 0 || s.indexOf('마커') === 0) return '한국';
  return s;
}

// legal_entity 가상 매핑 (DB 컬럼 없을 때 품목코드 prefix 기반)
function _deriveEntity(code) {
  const c = String(code || '').toUpperCase();
  if (c.startsWith('DD')) return 'dd';
  return 'barunson';
}

// 카드구분 → 기본 후공정 체인 (bulk-import-korea 용)
const KOREA_CATEGORY_POST_CHAIN = {
  '청첩장':  [{step:1,process:'인쇄'}, {step:2,process:'재단'}, {step:3,process:'톰슨'}, {step:4,process:'접지'}, {step:5,process:'조립'}],
  '봉투':    [{step:1,process:'인쇄'}, {step:2,process:'재단'}, {step:3,process:'봉투가공'}],
  '내지':    [{step:1,process:'인쇄'}, {step:2,process:'재단'}],
  '감사장':  [{step:1,process:'인쇄'}, {step:2,process:'재단'}, {step:3,process:'톰슨'}],
  '부속':    [{step:1,process:'재단'}],
  '리본':    [{step:1,process:'재단'}],
  '답례품':  [],
  '용지':    [],
  '기타':    [{step:1,process:'인쇄'}, {step:2,process:'재단'}]
};

// ════════════════════════════════════════════════════════════════════
//  POST /api/save-product-info — product_info.json 저장
// ════════════════════════════════════════════════════════════════════

router.post('/api/save-product-info', async (req, res, parsed) => {
  const body = await ctx.readBody(req);
  const outPath = ctx.path.join(__dirname, '..', 'product_info.json');
  ctx.fs.writeFileSync(outPath, body, 'utf8');
  ctx.jsonRes(res, 200, { ok: true, size: body.length, path: outPath });
});

// ════════════════════════════════════════════════════════════════════
//  GET /api/refresh — 데이터 갱신 (엑셀/JSON)
// ════════════════════════════════════════════════════════════════════

router.get('/api/refresh', async (req, res, parsed) => {
  const { execFile } = require('child_process');
  const DATA_DIR = ctx.DATA_DIR || ctx.path.join(__dirname, '..');
  const xlsPath = process.env.ERP_EXCEL_PATH || ctx.path.join(DATA_DIR, '스마트재고현황.xls');
  if (ctx.fs.existsSync(xlsPath)) {
    const stat = ctx.fs.statSync(xlsPath);
    const script = ctx.path.join(__dirname, '..', 'read_erp_excel.py');
    execFile('python', [script, xlsPath], { encoding: 'utf8' }, (err, stdout, stderr) => {
      if (err) {
        ctx.jsonRes(res, 200, { ok: false, error: stderr || err.message });
        return;
      }
      const match = stdout.match(/제품 수: (\d+)개/);
      const count = match ? parseInt(match[1]) : 0;
      const fileTime = stat.mtime.toLocaleString('ko-KR');
      ctx.jsonRes(res, 200, { ok: true, count, fileTime, message: `${count}개 품목 갱신 완료 (엑셀: ${fileTime})` });
    });
    return;
  }
  // 엑셀 없으면 JSON 파일로 폴백
  const jsonPath = ctx.path.join(DATA_DIR, 'erp_smart_inventory.json');
  if (ctx.fs.existsSync(jsonPath)) {
    try {
      const d = JSON.parse(ctx.fs.readFileSync(jsonPath, 'utf8'));
      const products = d.products || d.data || d;
      const count = Array.isArray(products) ? products.length : 0;
      const stat = ctx.fs.statSync(jsonPath);
      const fileTime = stat.mtime.toLocaleString('ko-KR');
      ctx.jsonRes(res, 200, { ok: true, count, fileTime, message: `${count}개 품목 로드 완료 (JSON: ${fileTime})` });
    } catch(e) {
      ctx.jsonRes(res, 200, { ok: false, error: 'JSON 파싱 오류: ' + e.message });
    }
  } else {
    ctx.jsonRes(res, 200, { ok: false, error: '데이터 파일이 없습니다. erp_smart_inventory.json 또는 스마트재고현황.xls를 user/ 폴더에 넣어주세요.' });
  }
});

// ════════════════════════════════════════════════════════════════════
//  REFERENCE DOCS (자료함)
// ════════════════════════════════════════════════════════════════════

// GET /api/reference-docs
router.get('/api/reference-docs', async (req, res, parsed) => {
  const cat = parsed.searchParams.get('category') || '';
  const q = parsed.searchParams.get('q') || '';
  let sql = 'SELECT * FROM reference_docs WHERE 1=1';
  const params = [];
  if (cat) { sql += ' AND category = ?'; params.push(cat); }
  if (q) { sql += ' AND (title LIKE ? OR memo LIKE ?)'; params.push('%'+q+'%', '%'+q+'%'); }
  sql += ' ORDER BY created_at DESC';
  const rows = await ctx.db.prepare(sql).all(...params);
  ctx.ok(res, rows);
});

// GET /api/reference-docs/categories
router.get('/api/reference-docs/categories', async (req, res, parsed) => {
  const rows = await ctx.db.prepare("SELECT DISTINCT category FROM reference_docs WHERE category != '' ORDER BY category").all();
  ctx.ok(res, rows.map(r => r.category));
});

// POST /api/reference-docs — 링크 등록
router.post('/api/reference-docs', async (req, res, parsed) => {
  const token = ctx.extractToken(req);
  const currentUser = token ? ctx.verifyToken(token) : null;
  const body = await ctx.readJSON(req);
  if (!body.title) { ctx.fail(res, 400, 'title 필수'); return; }
  if (!body.url) { ctx.fail(res, 400, 'url 필수'); return; }
  const uploader = currentUser ? (currentUser.username || '') : '';
  const uploaderId = currentUser ? (currentUser.userId || 0) : 0;
  const info = await ctx.db.prepare(
    `INSERT INTO reference_docs (type, title, url, category, memo, uploader, uploader_id) VALUES ('link', ?, ?, ?, ?, ?, ?)`
  ).run(body.title, body.url, body.category || '', body.memo || '', uploader, uploaderId);
  ctx.ok(res, { id: info.lastInsertRowid });
});

// POST /api/reference-docs/upload — 파일 업로드
router.post('/api/reference-docs/upload', async (req, res, parsed) => {
  try {
    const token = ctx.extractToken(req);
    const currentUser = token ? ctx.verifyToken(token) : null;
    const contentType = req.headers['content-type'] || '';
    if (!contentType.includes('multipart/form-data')) { ctx.fail(res, 400, 'multipart/form-data 필요'); return; }
    const boundary = contentType.split('boundary=')[1];
    if (!boundary) { ctx.fail(res, 400, 'boundary 없음'); return; }
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const buf = Buffer.concat(chunks);
    const sep = Buffer.from('--' + boundary);
    const fields = {};
    let fileData = null, fileName = '';
    const parts = [];
    let start = 0;
    while (true) {
      const idx = buf.indexOf(sep, start);
      if (idx === -1) break;
      if (start > 0) parts.push(buf.slice(start, idx - 2));
      start = idx + sep.length + 2;
    }
    for (const part of parts) {
      const headerEnd = part.indexOf('\r\n\r\n');
      if (headerEnd === -1) continue;
      const header = part.slice(0, headerEnd).toString('utf8');
      const pbody = part.slice(headerEnd + 4);
      const nameMatch = header.match(/name="([^"]+)"/);
      const fileMatch = header.match(/filename="([^"]+)"/);
      if (nameMatch) {
        if (fileMatch) { fileData = pbody; fileName = fileMatch[1]; }
        else { fields[nameMatch[1]] = pbody.toString('utf8').trim(); }
      }
    }
    if (!fileData || !fileName) { ctx.fail(res, 400, '파일 없음'); return; }
    const title = fields.title || fileName;
    const category = fields.category || '';
    const memo = fields.memo || '';
    const uploadDir = process.env.UPLOAD_DIR || ctx.path.join(__dirname, '..', 'uploads');
    const refDir = ctx.path.join(uploadDir, 'reference');
    if (!ctx.fs.existsSync(refDir)) ctx.fs.mkdirSync(refDir, { recursive: true });
    const safeName = `${Date.now()}_${fileName.replace(/[^a-zA-Z0-9가-힣._-]/g, '_')}`;
    const filePath = ctx.path.join(refDir, safeName);
    ctx.fs.writeFileSync(filePath, fileData);
    const uploader = currentUser ? (currentUser.username || '') : '';
    const uploaderId = currentUser ? (currentUser.userId || 0) : 0;
    const info = await ctx.db.prepare(
      `INSERT INTO reference_docs (type, title, file_path, file_name, file_size, category, memo, uploader, uploader_id) VALUES ('file', ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(title, filePath, fileName, fileData.length, category, memo, uploader, uploaderId);
    ctx.ok(res, { id: info.lastInsertRowid, file_name: fileName });
  } catch(e) {
    console.error('자료함 업로드 오류:', e.message);
    ctx.fail(res, 500, '업로드 실패: ' + e.message);
  }
});

// GET /api/reference-docs/:id/file — 파일 다운로드
router.getP(/^\/api\/reference-docs\/(\d+)\/file$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  const row = await ctx.db.prepare('SELECT file_path, file_name FROM reference_docs WHERE id = ?').get(id);
  if (!row || !row.file_path) { ctx.fail(res, 404, '파일 없음'); return; }
  if (!ctx.fs.existsSync(row.file_path)) { ctx.fail(res, 404, '파일이 디스크에 없음'); return; }
  const ext = ctx.path.extname(row.file_name || '').toLowerCase();
  const MIME = ctx.MIME || {};
  const ct = MIME[ext] || 'application/octet-stream';
  const CORS = ctx.CORS || {};
  res.writeHead(200, {
    'Content-Type': ct,
    'Content-Disposition': `inline; filename="${encodeURIComponent(row.file_name || 'file')}"`,
    ...CORS,
  });
  ctx.fs.createReadStream(row.file_path).pipe(res);
});

// PATCH /api/reference-docs/:id — 수정
router.addPattern('PATCH', /^\/api\/reference-docs\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  const body = await ctx.readJSON(req);
  const fields = [];
  const params = [];
  for (const k of ['title','url','category','memo']) {
    if (body[k] !== undefined) { fields.push(`${k}=?`); params.push(body[k]); }
  }
  if (!fields.length) { ctx.fail(res, 400, '수정할 필드 없음'); return; }
  fields.push("updated_at=datetime('now','localtime')");
  params.push(id);
  await ctx.db.prepare(`UPDATE reference_docs SET ${fields.join(',')} WHERE id = ?`).run(...params);
  ctx.ok(res, { updated: id });
});

// DELETE /api/reference-docs/:id
router.delP(/^\/api\/reference-docs\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  const row = await ctx.db.prepare('SELECT file_path FROM reference_docs WHERE id = ?').get(id);
  if (row && row.file_path) {
    try { ctx.fs.unlinkSync(row.file_path); } catch(_) {}
  }
  await ctx.db.prepare('DELETE FROM reference_docs WHERE id = ?').run(id);
  ctx.ok(res, { deleted: id });
});

// ════════════════════════════════════════════════════════════════════
//  PRODUCTS (품목관리)
// ════════════════════════════════════════════════════════════════════

// GET /api/products
router.get('/api/products', async (req, res, parsed) => {
  const entity = parsed.searchParams.get('entity') || '';
  let sql = 'SELECT * FROM products';
  const params = [];
  if (entity && entity !== 'all' && ctx._hasEntity && ctx._hasEntity.products) {
    sql += ' WHERE legal_entity=?';
    params.push(entity);
  }
  sql += ' ORDER BY origin, product_code';
  let rows = await ctx.db.prepare(sql).all(...params);
  rows = rows.map(r => {
    if (!r.legal_entity) r.legal_entity = _deriveEntity(r.product_code);
    return r;
  });
  // product_code 중복 제거 (첫 등장 유지)
  {
    const _seen = new Set();
    rows = rows.filter(r => {
      const c = (r.product_code || '').trim();
      if (!c || _seen.has(c)) return false;
      _seen.add(c);
      return true;
    });
  }
  // 컬럼이 없어서 DB 필터를 못 건 경우, 메모리에서 한번 더 필터
  if (entity && entity !== 'all' && !(ctx._hasEntity && ctx._hasEntity.products)) {
    rows = rows.filter(r => r.legal_entity === entity);
  }
  ctx.ok(res, rows);
});

// POST /api/products — 품목 신규 등록
router.post('/api/products', async (req, res, parsed) => {
  const b = await ctx.readJSON(req);
  if (!b.product_code) { ctx.fail(res, 400, 'product_code required'); return; }
  const entity = (b.legal_entity === 'dd') ? 'dd' : 'barunson';
  b.origin = _normOrigin(b.origin);
  // temp_code 컬럼 존재 여부 런타임 체크
  let _hasTempCode = false;
  try { await ctx.db.prepare('SELECT temp_code FROM products LIMIT 1').get(); _hasTempCode = true; } catch(_){}
  try {
    const baseCols = 'product_code, product_name, brand, origin, category, status, material_code, material_name, unit, cut_spec, jopan, paper_maker, memo, op_category, is_new_product, spec';
    const baseVals = [b.product_code, b.product_name||'', b.brand||'', b.origin||'한국', b.category||'', b.status||'active',
      b.material_code||'', b.material_name||'', b.unit||'EA', b.cut_spec||'', b.jopan||'', b.paper_maker||'', b.memo||'', b.op_category||'', b.is_new_product ? 1 : 0, b.spec||''];
    let cols = baseCols, vals = [...baseVals];
    if (ctx._hasEntity && ctx._hasEntity.products) { cols += ', legal_entity'; vals.push(entity); }
    if (_hasTempCode) { cols += ', temp_code'; vals.push(b.temp_code||''); }
    const ph = vals.map((_,i)=>'?').join(',');
    const info = await ctx.db.prepare(`INSERT INTO products (${cols}) VALUES (${ph})`).run(...vals);
    // op_category → product_notes 동기화
    if (b.op_category) {
      try {
        await ctx.db.prepare(`INSERT INTO product_notes (product_code, op_category, updated_at) VALUES (?,?,datetime('now','localtime'))
          ON CONFLICT(product_code) DO UPDATE SET op_category=excluded.op_category, updated_at=excluded.updated_at`).run(b.product_code, b.op_category);
      } catch(_){}
    }
    ctx.ok(res, { id: info.lastInsertRowid });
  } catch(e) {
    ctx.fail(res, 400, e.message.includes('UNIQUE') ? '이미 등록된 품목코드입니다' : e.message);
  }
});

// PUT /api/products/:id — 품목 수정
router.putP(/^\/api\/products\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  const b = await ctx.readJSON(req);
  const entity = (b.legal_entity === 'dd') ? 'dd' : 'barunson';
  let _hasTempCodeU = false;
  try { await ctx.db.prepare('SELECT temp_code FROM products LIMIT 1').get(); _hasTempCodeU = true; } catch(_){}
  let setCols = 'product_name=?, brand=?, origin=?, category=?, status=?, material_code=?, material_name=?, unit=?, cut_spec=?, jopan=?, paper_maker=?, memo=?, op_category=?, is_new_product=?, spec=?';
  let setVals = [b.product_name||'', b.brand||'', b.origin||'한국', b.category||'', b.status||'active',
    b.material_code||'', b.material_name||'', b.unit||'EA', b.cut_spec||'', b.jopan||'', b.paper_maker||'', b.memo||'', b.op_category||'', b.is_new_product ? 1 : 0, b.spec||''];
  if (ctx._hasEntity && ctx._hasEntity.products) { setCols += ', legal_entity=?'; setVals.push(entity); }
  if (_hasTempCodeU) { setCols += ', temp_code=?'; setVals.push(b.temp_code||''); }
  // 매입관리 필드: lead_time_days, moq, payment_terms, supplier_id
  const _procureCols = ['lead_time_days','moq','payment_terms','supplier_id'];
  for (const pc of _procureCols) {
    if (b[pc] !== undefined) {
      let _hasPc = false;
      try { await ctx.db.prepare(`SELECT ${pc} FROM products LIMIT 1`).get(); _hasPc = true; } catch(_){}
      if (_hasPc) { setCols += `, ${pc}=?`; setVals.push(b[pc]); }
    }
  }
  setCols += ", updated_at=datetime('now','localtime')";
  setVals.push(id);
  await ctx.db.prepare(`UPDATE products SET ${setCols} WHERE id=?`).run(...setVals);
  if (ctx.scheduleProductInfoReload) ctx.scheduleProductInfoReload();
  // op_category → product_notes 동기화
  if (b.op_category) {
    const prod = await ctx.db.prepare('SELECT product_code FROM products WHERE id=?').get(id);
    if (prod) await ctx.db.prepare(`INSERT INTO product_notes (product_code, op_category, updated_at) VALUES (?,?,datetime('now','localtime'))
      ON CONFLICT(product_code) DO UPDATE SET op_category=excluded.op_category, updated_at=excluded.updated_at`).run(prod.product_code, b.op_category);
  }
  ctx.ok(res, { id });
});

// DELETE /api/products/:id — 품목 삭제
router.delP(/^\/api\/products\/(\d+)$/, async (req, res, parsed, m) => {
  const id = parseInt(m[1]);
  const prod = await ctx.db.prepare('SELECT id, origin, product_name FROM products WHERE id = ?').get(id);
  if (!prod) { ctx.fail(res, 404, '품목을 찾을 수 없습니다'); return; }
  if (prod.origin && prod.origin !== 'manual') {
    ctx.fail(res, 403, `외부 동기화 데이터(${prod.origin})는 삭제할 수 없습니다. 원본 시스템에서 관리하세요.`);
    return;
  }
  await ctx.db.prepare('DELETE FROM products WHERE id = ? AND (origin IS NULL OR origin = "manual")').run(id);
  ctx.ok(res, { deleted: id });
});

// ════════════════════════════════════════════════════════════════════
//  PRODUCTS BULK UPLOAD (품목관리 엑셀 일괄 업로드)
// ════════════════════════════════════════════════════════════════════

// POST /api/products/bulk/preview — 저장 없이 신규/기존/오류 건수만 계산
router.post('/api/products/bulk/preview', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const items = body.items || [];
  if (!items.length) { ctx.fail(res, 400, 'items required'); return; }
  const newList = [];
  const updateList = [];
  const errorList = [];
  for (const it of items) {
    if (!it || !it.product_code) {
      errorList.push({ product_code: it && it.product_code || '', reason: 'product_code 누락' });
      continue;
    }
    const existing = await ctx.db.prepare('SELECT product_code, product_name, brand, origin, cut_spec, jopan FROM products WHERE product_code=?').get(it.product_code);
    if (existing) {
      updateList.push({
        product_code: it.product_code,
        new_name: it.product_name || '',
        old_name: existing.product_name || '',
        new_origin: it.origin || '',
        old_origin: existing.origin || ''
      });
    } else {
      newList.push({
        product_code: it.product_code,
        product_name: it.product_name || '',
        origin: it.origin || ''
      });
    }
  }
  ctx.ok(res, {
    total: items.length,
    new_count: newList.length,
    update_count: updateList.length,
    error_count: errorList.length,
    new_list: newList,
    update_list: updateList,
    error_list: errorList
  });
});

// POST /api/products/bulk — 일괄 등록/업데이트
router.post('/api/products/bulk', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const items = body.items || [];
  const mode = body.mode === 'insert_only' ? 'insert_only' : 'upsert';
  if (!items.length) { ctx.fail(res, 400, 'items required'); return; }
  // 서버측 방어: 생산지 변형값 정규화
  for (const it of items) { if (it) it.origin = _normOrigin(it.origin); }

  const hasEntity = ctx._hasEntity && ctx._hasEntity.products;
  const upsert = hasEntity
    ? ctx.db.prepare(`INSERT INTO products (product_code, product_name, brand, origin, material_code, material_name, cut_spec, jopan, paper_maker, memo, op_category, legal_entity, is_new_product)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(product_code) DO UPDATE SET
      product_name=CASE WHEN excluded.product_name='' THEN products.product_name ELSE excluded.product_name END,
      brand=CASE WHEN excluded.brand='' THEN products.brand ELSE excluded.brand END,
      origin=CASE WHEN excluded.origin='' THEN products.origin ELSE excluded.origin END,
      material_code=CASE WHEN excluded.material_code='' THEN products.material_code ELSE excluded.material_code END,
      material_name=CASE WHEN excluded.material_name='' THEN products.material_name ELSE excluded.material_name END,
      cut_spec=CASE WHEN excluded.cut_spec='' THEN products.cut_spec ELSE excluded.cut_spec END,
      jopan=CASE WHEN excluded.jopan='' THEN products.jopan ELSE excluded.jopan END,
      paper_maker=CASE WHEN excluded.paper_maker='' THEN products.paper_maker ELSE excluded.paper_maker END,
      memo=CASE WHEN excluded.memo='' THEN products.memo ELSE excluded.memo END,
      op_category=CASE WHEN excluded.op_category='' THEN products.op_category ELSE excluded.op_category END,
      legal_entity=CASE WHEN excluded.legal_entity='' THEN products.legal_entity ELSE excluded.legal_entity END,
      is_new_product=CASE WHEN excluded.is_new_product=0 THEN products.is_new_product ELSE excluded.is_new_product END,
      updated_at=datetime('now','localtime')`)
    : ctx.db.prepare(`INSERT INTO products (product_code, product_name, brand, origin, material_code, material_name, cut_spec, jopan, paper_maker, memo, op_category, is_new_product)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
    ON CONFLICT(product_code) DO UPDATE SET
      product_name=CASE WHEN excluded.product_name='' THEN products.product_name ELSE excluded.product_name END,
      brand=CASE WHEN excluded.brand='' THEN products.brand ELSE excluded.brand END,
      origin=CASE WHEN excluded.origin='' THEN products.origin ELSE excluded.origin END,
      material_code=CASE WHEN excluded.material_code='' THEN products.material_code ELSE excluded.material_code END,
      material_name=CASE WHEN excluded.material_name='' THEN products.material_name ELSE excluded.material_name END,
      cut_spec=CASE WHEN excluded.cut_spec='' THEN products.cut_spec ELSE excluded.cut_spec END,
      jopan=CASE WHEN excluded.jopan='' THEN products.jopan ELSE excluded.jopan END,
      paper_maker=CASE WHEN excluded.paper_maker='' THEN products.paper_maker ELSE excluded.paper_maker END,
      memo=CASE WHEN excluded.memo='' THEN products.memo ELSE excluded.memo END,
      op_category=CASE WHEN excluded.op_category='' THEN products.op_category ELSE excluded.op_category END,
      is_new_product=CASE WHEN excluded.is_new_product=0 THEN products.is_new_product ELSE excluded.is_new_product END,
      updated_at=datetime('now','localtime')`);

  // op_category → product_notes 동기화용
  const upsertNote = ctx.db.prepare(`INSERT INTO product_notes (product_code, op_category, updated_at) VALUES (?,?,datetime('now','localtime'))
    ON CONFLICT(product_code) DO UPDATE SET op_category=excluded.op_category, updated_at=excluded.updated_at`);

  let inserted = 0, updated = 0, skipped = 0;
  const tx = ctx.db.transaction(async () => {
    for (const it of items) {
      if (!it.product_code) continue;
      const existing = await ctx.db.prepare('SELECT id FROM products WHERE product_code=?').get(it.product_code);
      if (existing && mode === 'insert_only') { skipped++; continue; }
      const _bArgs = [
        it.product_code, it.product_name||'', it.brand||'', it.origin||'한국',
        it.material_code||'', it.material_name||'', it.cut_spec||'', it.jopan||'',
        it.paper_maker||'', it.memo||'', it.op_category||''
      ];
      if (hasEntity) _bArgs.push((it.legal_entity === 'dd') ? 'dd' : 'barunson');
      _bArgs.push(it.is_new_product ? 1 : 0);
      await upsert.run(..._bArgs);
      if (it.op_category) await upsertNote.run(it.product_code, it.op_category);
      if (existing) updated++; else inserted++;
    }
  });
  await tx();
  ctx.ok(res, { inserted, updated, skipped, total: inserted + updated + skipped, mode });
});

// ════════════════════════════════════════════════════════════════════
//  POST /api/products/bulk-import-korea
//  바른컴퍼니 한국 생산품목 TSV 일괄 업데이트 + 카테고리별 기본 후공정 체인 매칭
// ════════════════════════════════════════════════════════════════════

router.post('/api/products/bulk-import-korea', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const tsv = body?.tsv || '';
  const dryRun = !!body?.dry_run;
  const skipIfExists = !!body?.skip_if_exists;
  if (!tsv) { ctx.fail(res, 400, 'tsv required'); return; }

  // 1) 파싱
  const lines = tsv.split(/\r?\n/).filter(l => l.trim());
  const rows = [];
  for (const line of lines) {
    const cols = line.split('\t');
    if (cols[0] === 'No' || cols[1] === '품목코드') continue;
    if (cols.length < 2) continue;
    let idx = 0;
    if (/^\d+$/.test(cols[0])) idx = 1;
    const code = (cols[idx] || '').replace(/[\s\u00A0\u200B\u200C\u200D\uFEFF]/g, '').trim();
    const category = (cols[idx+1] || '').trim();
    const brandRaw = (cols[idx+2] || '').trim();
    if (!code) continue;
    const dInner = /\(D_내\)/.test(brandRaw);
    const dOuter = /\(D_외\)/.test(brandRaw);
    const brand = brandRaw.replace(/\s*\(D_[내외]\)\s*/g, '').trim();
    const memo = (dInner ? 'D_내' : dOuter ? 'D_외' : '').trim();
    rows.push({ code, category, brand, memo });
  }

  // 2) product_code 기준 중복 제거
  const seen = new Map();
  for (const r of rows) if (!seen.has(r.code)) seen.set(r.code, r);
  const unique = Array.from(seen.values());

  // 카테고리별 집계
  const categoryCount = {};
  for (const r of unique) categoryCount[r.category || '(빈값)'] = (categoryCount[r.category || '(빈값)'] || 0) + 1;

  // dry_run / skip_if_exists 양쪽에서 신규/기존 분류 정보가 필요
  let existingCodeSet = null;
  if (dryRun || skipIfExists) {
    try {
      const safeCodes = unique.map(r => r.code).filter(c => /^[A-Za-z0-9_\-]+$/.test(c));
      if (safeCodes.length === 0) {
        existingCodeSet = new Set();
      } else {
        const ph = safeCodes.map(() => '?').join(',');
        const rows2 = await ctx.db.prepare(`SELECT product_code FROM products WHERE product_code IN (${ph})`).all(...safeCodes);
        existingCodeSet = new Set(rows2.map(r => r.product_code));
      }
    } catch (e) {
      console.warn('[bulk-import-korea] existing 조회 실패 — skip_if_exists/dry_run 분류 생략:', e.message);
      existingCodeSet = null;
    }
  }

  if (dryRun) {
    const newRows = existingCodeSet ? unique.filter(r => !existingCodeSet.has(r.code)) : unique;
    const existingRows = existingCodeSet ? unique.filter(r => existingCodeSet.has(r.code)) : [];
    const newCatCount = {};
    for (const r of newRows) newCatCount[r.category || '(빈값)'] = (newCatCount[r.category || '(빈값)'] || 0) + 1;
    ctx.ok(res, {
      dry_run: true,
      parsed: rows.length,
      unique: unique.length,
      duplicates_removed: rows.length - unique.length,
      category_breakdown: categoryCount,
      existing_check: existingCodeSet ? 'ok' : 'skipped',
      new_codes_count: newRows.length,
      existing_codes_count: existingRows.length,
      new_category_breakdown: newCatCount,
      new_codes_sample: newRows.slice(0, 20).map(r => r.code),
      existing_codes_sample: existingRows.slice(0, 20).map(r => r.code),
      sample: unique.slice(0, 10)
    });
    return;
  }

  // 3) products UPSERT + product_post_vendor 기본 체인 INSERT
  let inserted = 0, updated = 0, skippedExisting = 0, chainInserted = 0, chainSkipped = 0, errors = 0;

  let ppvOK = true;
  try { await ctx.db.prepare('SELECT 1 FROM product_post_vendor LIMIT 1').get(); } catch(_) { ppvOK = false; }

  for (const r of unique) {
    try {
      const existing = await ctx.db.prepare('SELECT id FROM products WHERE product_code=?').get(r.code);
      if (existing) {
        if (skipIfExists) {
          skippedExisting++;
          continue;
        }
        await ctx.db.prepare(`UPDATE products SET
          category=CASE WHEN ?='' THEN category ELSE ? END,
          brand=CASE WHEN ?='' THEN brand ELSE ? END,
          origin='한국',
          status='active',
          memo=CASE WHEN ?='' THEN memo ELSE ? END,
          updated_at=datetime('now','localtime')
          WHERE product_code=?`).run(r.category, r.category, r.brand, r.brand, r.memo, r.memo, r.code);
        updated++;
      } else {
        await ctx.db.prepare(`INSERT INTO products (product_code, product_name, brand, origin, category, status, memo)
          VALUES (?, '', ?, '한국', ?, 'active', ?)`).run(r.code, r.brand, r.category, r.memo);
        inserted++;
      }

      // 기본 후공정 체인 INSERT (기존 체인 있으면 skip)
      if (ppvOK) {
        const chain = KOREA_CATEGORY_POST_CHAIN[r.category] || [];
        if (chain.length) {
          const hasExisting = await ctx.db.prepare('SELECT 1 FROM product_post_vendor WHERE product_code=? LIMIT 1').get(r.code);
          if (hasExisting) {
            chainSkipped++;
          } else {
            for (const step of chain) {
              try {
                await ctx.db.prepare('INSERT INTO product_post_vendor (product_code, process_type, vendor_name, step_order) VALUES (?, ?, \'\', ?)').run(r.code, step.process, step.step);
              } catch(_) {}
            }
            chainInserted++;
          }
        }
      }
    } catch (e) {
      errors++;
      if (errors < 5) console.error('[bulk-import-korea] row 오류:', r.code, e.message);
    }
  }

  if (ctx.scheduleProductInfoReload) ctx.scheduleProductInfoReload();
  console.log(`[bulk-import-korea] 완료: 신규 ${inserted} / 업데이트 ${updated} / 기존skip ${skippedExisting} / 체인신설 ${chainInserted} / 체인유지 ${chainSkipped} / 오류 ${errors}`);
  ctx.ok(res, {
    parsed: rows.length,
    unique: unique.length,
    duplicates_removed: rows.length - unique.length,
    skip_if_exists: skipIfExists,
    inserted, updated,
    skipped_existing: skippedExisting,
    chain_inserted: chainInserted,
    chain_skipped_existing: chainSkipped,
    ppv_table_available: ppvOK,
    errors,
    category_breakdown: categoryCount
  });
});

// ════════════════════════════════════════════════════════════════════
//  PUT /api/products/:code/field — 개별 필드 업데이트 + product_field_history 이력
// ════════════════════════════════════════════════════════════════════

router.putP(/^\/api\/products\/(.+)\/field$/, async (req, res, parsed, m) => {
  const code = decodeURIComponent(m[1]);
  const token = ctx.extractToken(req);
  const currentUser = token ? ctx.verifyToken(token) : null;
  const clientIP = req.headers['x-forwarded-for'] || req.socket.remoteAddress || '';
  const body = await ctx.readJSON(req);
  const allowed = ['cut_spec','jopan','paper_maker','material_name','material_code','post_vendor','lead_time_days','moq','payment_terms','supplier_id','memo'];
  if (!allowed.includes(body.field)) { ctx.fail(res, 400, '허용되지 않는 필드'); return; }
  // 이전 값 조회 후 이력 저장
  let prev;
  try { prev = await ctx.db.prepare(`SELECT ${body.field} as val FROM products WHERE product_code=?`).get(code); } catch(_) { prev = undefined; }
  const oldVal = prev ? (prev.val || '') : '';
  if (String(oldVal) !== String(body.value)) {
    try {
      // reason, changed_by 컬럼 존재 여부 런타임 체크
      let _hasPfhReason = false;
      try { await ctx.db.prepare('SELECT reason FROM product_field_history LIMIT 1').get(); _hasPfhReason = true; } catch(_){}
      const reason = body.reason || '';
      const changer = body.changed_by || (currentUser ? currentUser.username : '');
      if (_hasPfhReason) {
        await ctx.db.prepare('INSERT INTO product_field_history (product_code, field_name, old_value, new_value, reason, changed_by) VALUES (?,?,?,?,?,?)').run(code, body.field, String(oldVal), String(body.value), reason, changer);
      } else {
        await ctx.db.prepare('INSERT INTO product_field_history (product_code, field_name, old_value, new_value) VALUES (?,?,?,?)').run(code, body.field, String(oldVal), String(body.value));
      }
    } catch(histErr) { console.warn('[product_field_history] insert skip:', histErr.message); }
  }
  await ctx.db.prepare(`UPDATE products SET ${body.field}=?, updated_at=datetime('now','localtime') WHERE product_code=?`).run(body.value, code);
  if (ctx.scheduleProductInfoReload) ctx.scheduleProductInfoReload();
  if (currentUser) ctx.auditLog(currentUser.userId, currentUser.username, 'product_update', 'products', code, `품목수정: ${code} ${body.field} "${oldVal}"→"${body.value}"${body.reason ? ' 사유: '+body.reason : ''}`, clientIP);
  ctx.ok(res, { updated: code, field: body.field });
});

// ════════════════════════════════════════════════════════════════════
//  PATCH /api/products/:code/post-vendor — 후공정 업체 설정
// ════════════════════════════════════════════════════════════════════

router.addPattern('PATCH', /^\/api\/products\/(.+)\/post-vendor$/, async (req, res, parsed, m) => {
  const code = decodeURIComponent(m[1]);
  const body = await ctx.readJSON(req);
  await ctx.db.prepare("UPDATE products SET post_vendor=?, updated_at=datetime('now','localtime') WHERE product_code=?").run(body.post_vendor || '', code);
  if (ctx.xerpInventoryCacheTime !== undefined) ctx.xerpInventoryCacheTime = 0;
  if (ctx.scheduleProductInfoReload) ctx.scheduleProductInfoReload();
  ctx.ok(res, { ok: true, code, post_vendor: body.post_vendor });
});

// ════════════════════════════════════════════════════════════════════
//  GET /api/products/:code/history — 필드 변경 이력 조회
// ════════════════════════════════════════════════════════════════════

router.getP(/^\/api\/products\/(.+)\/history$/, async (req, res, parsed, m) => {
  const code = decodeURIComponent(m[1]);
  const rows = await ctx.db.prepare('SELECT * FROM product_field_history WHERE product_code=? ORDER BY changed_at DESC LIMIT 50').all(code);
  ctx.ok(res, rows);
});

// ════════════════════════════════════════════════════════════════════
//  품목별 후공정 업체 매핑 API
// ════════════════════════════════════════════════════════════════════

// GET /api/product-post-vendor
router.get('/api/product-post-vendor', async (req, res, parsed) => {
  const rows = await ctx.db.prepare("SELECT * FROM product_post_vendor ORDER BY product_code, CASE WHEN process_type='봉투가공' THEN 1 ELSE 0 END, step_order, process_type").all();
  ctx.ok(res, rows);
});

// POST /api/product-post-vendor
router.post('/api/product-post-vendor', async (req, res, parsed) => {
  const body = await ctx.readJSON(req);
  const { mappings } = body;
  if (!mappings || !mappings.length) { ctx.fail(res, 400, 'mappings 필요'); return; }
  const validMappings = mappings.filter(m => m.product_code && m.process_type && m.vendor_name);
  const codesWithValid = [...new Set(validMappings.map(m => m.product_code))];
  const insert = ctx.db.prepare(`INSERT INTO product_post_vendor (product_code, process_type, vendor_name, step_order, updated_at)
    VALUES (?, ?, ?, ?, datetime('now','localtime'))`);
  const delByCode = ctx.db.prepare('DELETE FROM product_post_vendor WHERE product_code=?');
  const tx = ctx.db.transaction(async () => {
    for (const code of codesWithValid) {
      await delByCode.run(code);
    }
    for (const m of validMappings) {
      await insert.run(m.product_code, m.process_type, m.vendor_name, m.step_order || 1);
    }
  });
  await tx();
  if (ctx.scheduleProductInfoReload) ctx.scheduleProductInfoReload();
  ctx.ok(res, { ok: true, saved: validMappings.length, replaced_codes: codesWithValid.length });
});

// ════════════════════════════════════════════════════════════════════
//  PRODUCT NOTES (품목 특이사항)
// ════════════════════════════════════════════════════════════════════

// GET /api/product-notes
router.get('/api/product-notes', async (req, res, parsed) => {
  const rows = await ctx.db.prepare('SELECT * FROM product_notes').all();
  const map = {};
  rows.forEach(r => { map[r.product_code] = { note_type: r.note_type, note_text: r.note_text, op_category: r.op_category || '' }; });
  ctx.ok(res, map);
});

// PUT /api/product-notes/:code
router.putP(/^\/api\/product-notes\/(.+)$/, async (req, res, parsed, m) => {
  const code = decodeURIComponent(m[1]);
  const b = await ctx.readJSON(req);
  const noteType = b.note_type || '';
  const noteText = b.note_text || '';
  const opCategory = b.op_category || '';
  if (!noteType && !noteText && !opCategory) {
    await ctx.db.prepare('DELETE FROM product_notes WHERE product_code=?').run(code);
  } else {
    await ctx.db.prepare("INSERT INTO product_notes (product_code, note_type, note_text, op_category, updated_at) VALUES (?,?,?,?,datetime('now','localtime')) ON CONFLICT(product_code) DO UPDATE SET note_type=excluded.note_type, note_text=excluded.note_text, op_category=excluded.op_category, updated_at=excluded.updated_at").run(code, noteType, noteText, opCategory);
  }
  ctx.ok(res, { saved: true, product_code: code });
});

// ════════════════════════════════════════════════════════════════════
//  product_info.json ↔ products DB 동기화
// ════════════════════════════════════════════════════════════════════

// GET /api/product-info/sync-status
router.get('/api/product-info/sync-status', async (req, res, parsed) => {
  try {
    const piData = ctx.getProductInfo();
    const jsonCodes = new Set(Object.keys(piData));
    const dbRows = await ctx.db.prepare("SELECT product_code FROM products").all();
    const dbCodes = new Set(dbRows.map(r => r.product_code));
    let inBoth = 0, onlyJson = 0, onlyDb = 0;
    for (const c of jsonCodes) { if (dbCodes.has(c)) inBoth++; else onlyJson++; }
    for (const c of dbCodes) { if (!jsonCodes.has(c)) onlyDb++; }
    ctx.ok(res, { inBoth, onlyJson, onlyDb, totalJson: jsonCodes.size, totalDb: dbCodes.size });
  } catch (e) {
    ctx.fail(res, 500, 'sync-status 오류: ' + e.message);
  }
});

// POST /api/product-info/sync
router.post('/api/product-info/sync', async (req, res, parsed) => {
  try {
    const piData = ctx.getProductInfo();
    const dbRows = await ctx.db.prepare("SELECT product_code FROM products").all();
    const dbCodes = new Set(dbRows.map(r => r.product_code));
    const upd = ctx.db.prepare(`UPDATE products SET material_code=?, material_name=?, cut_spec=?, jopan=?, paper_maker=?, updated_at=datetime('now','localtime') WHERE product_code=?`);
    let updated = 0, skipped = 0;
    const txn = ctx.db.transaction(async () => {
      for (const [code, info] of Object.entries(piData)) {
        if (dbCodes.has(code)) {
          await upd.run(
            info['원자재코드'] || '',
            info['원재료용지명'] || '',
            info['절'] || '',
            info['조판'] || '',
            info['제지사'] || '',
            code
          );
          updated++;
        } else {
          skipped++;
        }
      }
    });
    await txn();
    // 캐시 무효화
    if (ctx.productInfoCache !== undefined) ctx.productInfoCache = null;
    ctx.ok(res, { updated, skipped });
  } catch (e) {
    ctx.fail(res, 500, 'sync 오류: ' + e.message);
  }
});

module.exports = { router };
