const http = require('http');
const fs = require('fs');
const path = require('path');
const PORT = 12026;
const file = path.join(__dirname, 'smart_inventory_page.html');
http.createServer((req, res) => {
  res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
  fs.createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`http://localhost:${PORT}`));
