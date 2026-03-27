const path = require('path');
const db = require('better-sqlite3')(path.join(__dirname, 'orders.db'));
db.exec('DELETE FROM po_items');
db.exec('DELETE FROM po_activity_log');
try { db.exec('DELETE FROM trade_document'); } catch(e) {}
try { db.exec('DELETE FROM vendor_shipment_schedule'); } catch(e) {}
db.exec('DELETE FROM po_header');
console.log('po_header:', db.prepare('SELECT count(*) as c FROM po_header').get().c);
console.log('po_items:', db.prepare('SELECT count(*) as c FROM po_items').get().c);
console.log('ALL PO DATA CLEARED');
db.close();
