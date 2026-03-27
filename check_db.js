const db = require('better-sqlite3')('C:/barunson/barunson-database-reference/user/orders.db');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log('=== Tables ===');
tables.forEach(t => console.log(' ', t.name));

['vendor_shipment_schedule', 'process_lead_time', 'trade_document'].forEach(tbl => {
  try {
    const cols = db.prepare(`PRAGMA table_info(${tbl})`).all();
    console.log(`\n=== ${tbl} (${cols.length} cols) ===`);
    cols.forEach(c => console.log(`  ${c.name} ${c.type}`));
  } catch(e) {
    console.log(`\n${tbl}: NOT YET CREATED (서버 재시작 필요)`);
  }
});

console.log('\n=== products 신규컬럼 ===');
const pcols = db.prepare('PRAGMA table_info(products)').all();
pcols.filter(c => ['is_new_product','first_order_done'].includes(c.name))
  .forEach(c => console.log(`  ${c.name} ${c.type} default=${c.dflt_value}`));
if (!pcols.find(c => c.name === 'is_new_product')) console.log('  (서버 재시작 후 생성됨)');

db.close();
console.log('\nDone.');
