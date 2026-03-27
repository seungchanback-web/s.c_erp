#!/usr/bin/env python3
"""smart_inv_page2.html + smart_inventory_v2.json -> standalone HTML"""
import json, os, sys
sys.stdout.reconfigure(encoding='utf-8')

base = os.path.dirname(__file__)

with open(os.path.join(base, 'smart_inventory_v2.json'), 'r', encoding='utf-8') as f:
    data = json.load(f)

with open(os.path.join(base, 'smart_inv_page2.html'), 'r', encoding='utf-8') as f:
    html = f.read()

# JSON을 JS 변수로 내장
json_str = json.dumps(data, ensure_ascii=False)

# fetch 블록을 내장 데이터로 교체
old_block = """// 데이터 로드
fetch('/data.json')
    .then(r => r.json())
    .then(data => {
        allProducts = data.products;
        document.getElementById('genTime').textContent = data.filter.generated || '';
        document.getElementById('salesRange').textContent =
            `${data.filter.sales_from} ~ ${data.filter.sales_to}`;
        buildBrandChips();
        renderSummary(data.summary);
        renderTable();
    })
    .catch(err => {
        document.getElementById('tableBody').innerHTML =
            `<tr><td colspan="13" class="loading" style="color:red;">데이터 로드 실패: ${err.message}</td></tr>`;
    });"""

new_block = f"""// 데이터 로드 (embedded)
const _DATA_ = {json_str};
allProducts = _DATA_.products;
document.getElementById('genTime').textContent = _DATA_.filter.generated || '';
document.getElementById('salesRange').textContent = _DATA_.filter.sales_from + ' ~ ' + _DATA_.filter.sales_to;
buildBrandChips();
renderSummary(_DATA_.summary);
renderTable();"""

html = html.replace(old_block, new_block)

out = os.path.join(base, 'smart_inv_standalone.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)

print(f"Generated: {out}")
print(f"Size: {os.path.getsize(out):,} bytes")
print(f"Products: {len(data['products'])}")
