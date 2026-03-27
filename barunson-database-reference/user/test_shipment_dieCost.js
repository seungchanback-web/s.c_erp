const http = require('http');
const db = require('better-sqlite3')('./orders.db');

function api(method, path, body) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : '';
    const opts = { hostname:'localhost', port:12026, path, method, headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(data)} };
    const req = http.request(opts, res => { let b=''; res.on('data',c=>b+=c); res.on('end',()=>{ try{resolve(JSON.parse(b))}catch(e){resolve(b)} }); });
    req.on('error',reject); if(data)req.write(data); req.end();
  });
}

(async () => {
  // === 목형비 테스트 ===
  console.log('========== 목형비 자동 관리 테스트 ==========');

  // 1. 신제품 등록
  console.log('\n--- 1. 신제품 등록 ---');
  db.prepare("INSERT OR REPLACE INTO products (product_code, product_name, brand, is_new_product, first_order_done, die_cost) VALUES (?,?,?,?,?,?)")
    .run('TEST001', '테스트신제품', '바른손', 1, 0, 50000);
  console.log('  TEST001 등록 (is_new=1, first_order_done=0, die_cost=50000)');

  // 2. 첫 발주 생성
  console.log('\n--- 2. 첫 발주 → 목형비 포함 ---');
  const r1 = await api('POST', '/api/po', {
    po_type:'material', vendor_name:'대한통상', status:'draft',
    expected_date:'2026-03-25', notes:'목형비 테스트',
    items:[{product_code:'TEST001', brand:'바른손', process_type:'', ordered_qty:10000, spec:'', notes:''}]
  });
  const poId1 = r1.data.po_id;
  const poItem1 = db.prepare('SELECT notes FROM po_items WHERE po_id=? AND product_code=?').get(poId1, 'TEST001');
  const prod1 = db.prepare('SELECT is_new_product, first_order_done FROM products WHERE product_code=?').get('TEST001');
  console.log(`  PO ${r1.data.po_number} 생성`);
  console.log(`  po_items.notes: "${poItem1.notes}" → ${poItem1.notes.includes('목형비') ? '✅ 목형비 포함' : '❌ 목형비 없음'}`);
  console.log(`  first_order_done: ${prod1.first_order_done} → ${prod1.first_order_done === 1 ? '✅ 업데이트됨' : '❌ 미업데이트'}`);

  // 3. 재발주 → 목형비 없어야 함
  console.log('\n--- 3. 재발주 → 목형비 제외 ---');
  const r2 = await api('POST', '/api/po', {
    po_type:'material', vendor_name:'대한통상', status:'draft',
    expected_date:'2026-04-01', notes:'재발주',
    items:[{product_code:'TEST001', brand:'바른손', process_type:'', ordered_qty:20000, spec:'', notes:''}]
  });
  const poId2 = r2.data.po_id;
  const poItem2 = db.prepare('SELECT notes FROM po_items WHERE po_id=? AND product_code=?').get(poId2, 'TEST001');
  console.log(`  PO ${r2.data.po_number} 생성`);
  console.log(`  po_items.notes: "${poItem2.notes}" → ${poItem2.notes.includes('목형비') ? '❌ 목형비 있음 (버그!)' : '✅ 목형비 없음'}`);

  // === 출고일 이메일 체크 테스트 ===
  console.log('\n========== 출고일 이메일 체크 테스트 ==========');

  // 4. 오늘 날짜로 출고 스케줄 생성
  const today = new Date().toISOString().slice(0, 10);
  console.log(`\n--- 4. 오늘 출고 스케줄 생성 (${today}) ---`);
  db.prepare("INSERT INTO vendor_shipment_schedule (po_id, po_number, vendor_name, ship_date, ship_time, post_vendor_name, post_vendor_email, auto_email_sent, status) VALUES (?,?,?,?,?,?,?,?,?)")
    .run(poId1, r1.data.po_number, '대한통상', today, 'AM', '코리아패키지', 'test@test.com', 0, 'scheduled');
  console.log('  스케줄 등록 완료');

  // 5. 수동 출고일 체크 실행
  console.log('\n--- 5. 출고일 체크 수동 실행 ---');
  const r3 = await api('POST', '/api/auto-order/run-shipment-check', {});
  console.log(`  결과: ${JSON.stringify(r3)}`);

  // 6. auto_email_sent 확인
  const sch = db.prepare('SELECT auto_email_sent, status FROM vendor_shipment_schedule WHERE po_id=?').get(poId1);
  console.log(`  auto_email_sent: ${sch.auto_email_sent} → ${sch.auto_email_sent === 1 ? '✅ 이메일 발송됨' : '⚠️ 미발송 (이메일 서버 문제일 수 있음)'}`);

  // 7. process_status 확인
  const po = db.prepare('SELECT process_status FROM po_header WHERE po_id=?').get(poId1);
  console.log(`  process_status: ${po.process_status}`);

  // 활동 로그
  const logs = db.prepare('SELECT action, details FROM po_activity_log WHERE po_id=? ORDER BY id').all(poId1);
  console.log(`\n--- 활동 로그 (${logs.length}건) ---`);
  logs.forEach((l,i) => console.log(`  ${i+1}. [${l.action}] ${l.details}`));

  // 정리
  db.prepare('DELETE FROM products WHERE product_code=?').run('TEST001');

  console.log('\n========== 테스트 완료 ==========');
  db.close();
})();
