const db = require('better-sqlite3')('./orders.db');

// 1. PO 6 확인
const po = db.prepare('SELECT po_id,po_number,vendor_name,status,material_status,process_status FROM po_header WHERE po_id=6').get();
console.log('=== PO 6 ===');
console.log(JSON.stringify(po, null, 2));

// vendor_name이 깨졌으면 수정
if (po && po.vendor_name !== '대한통상') {
  console.log('\n⚠️ vendor_name 인코딩 깨짐 → 수정');
  db.prepare("UPDATE po_header SET vendor_name='대한통상' WHERE po_id=6").run();
  console.log('✅ vendor_name → 대한통상');
}

// 2. 모든 PO 파이프라인 상태
console.log('\n=== 전체 PO 파이프라인 ===');
const all = db.prepare('SELECT po_id,po_number,vendor_name,status,material_status,process_status FROM po_header ORDER BY po_id DESC').all();
all.forEach(p => console.log(`  ${p.po_number} | ${p.vendor_name} | status:${p.status} | mat:${p.material_status} | proc:${p.process_status}`));

// 3. 새 테이블 확인
console.log('\n=== 새 테이블 ===');
['vendor_shipment_schedule','process_lead_time','trade_document'].forEach(t => {
  const cnt = db.prepare(`SELECT COUNT(*) as c FROM ${t}`).get();
  console.log(`  ${t}: ${cnt.c} rows`);
});

db.close();
