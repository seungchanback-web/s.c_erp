#!/usr/bin/env python3
"""2025 원재료 매입 피벗 테이블 웹페이지 생성"""
import os, pymssql, sys, json
sys.stdout.reconfigure(encoding='utf-8')
from dotenv import load_dotenv
load_dotenv()

conn = pymssql.connect(
    server=os.getenv('DB_SERVER'),
    port=int(os.getenv('DB_PORT', '1433')),
    user=os.getenv('DB_USER'),
    password=os.getenv('DB_PASSWORD'),
    database='XERP'
)
cursor = conn.cursor()
cursor.execute("""
SELECT
    RTRIM(h.CsCode) AS csCode,
    RTRIM(cs.CsName) AS csName,
    LEFT(h.BillDate, 6) AS billMonth,
    RTRIM(bi.ItemCode) AS itemCode,
    RTRIM(im.ItemName) AS itemName,
    RTRIM(im.ItemSpec) AS itemSpec,
    RTRIM(bi.UnitCode) AS unitCode,
    CAST(SUM(bi.ItemQty) AS BIGINT) AS qty,
    CAST(SUM(bi.ItemAmnt) AS BIGINT) AS supplyAmnt,
    CAST(SUM(bi.ItemVatAmnt) AS BIGINT) AS vatAmnt,
    CAST(SUM(bi.ItemAmnt + bi.ItemVatAmnt) AS BIGINT) AS totalAmnt
FROM rpBillHeader h WITH (NOLOCK)
JOIN rpBillItem bi WITH (NOLOCK)
    ON h.SiteCode = bi.SiteCode AND h.BillNo = bi.BillNo AND h.ArApGubun = bi.ArApGubun
JOIN ItemMaster im WITH (NOLOCK)
    ON bi.ItemCode = im.ItemCode AND im.ComCode = 'BK01'
LEFT JOIN CsMaster cs WITH (NOLOCK)
    ON h.CsCode = cs.CsCode AND cs.ComCode = 'BK01'
WHERE h.SiteCode = 'BK10'
  AND h.ArApGubun = 'AP'
  AND h.BillDate >= '20250101' AND h.BillDate <= '20251231'
  AND RTRIM(im.ItemType) = 'MAT'
GROUP BY RTRIM(h.CsCode), RTRIM(cs.CsName), LEFT(h.BillDate, 6),
         RTRIM(bi.ItemCode), RTRIM(im.ItemName), RTRIM(im.ItemSpec), RTRIM(bi.UnitCode)
ORDER BY SUM(bi.ItemAmnt) DESC
""")
rows = []
for row in cursor:
    rows.append({
        'csCode': (row[0] or '').strip(),
        'csName': (row[1] or '').strip(),
        'billMonth': (row[2] or '').strip(),
        'itemCode': (row[3] or '').strip(),
        'itemName': (row[4] or '').strip(),
        'itemSpec': (row[5] or '').strip(),
        'unitCode': (row[6] or '').strip(),
        'qty': row[7],
        'supplyAmnt': row[8],
        'vatAmnt': row[9],
        'totalAmnt': row[10],
    })
conn.close()

data_json = json.dumps(rows, ensure_ascii=False)

html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>2025년 원재료 매입 현황 - 피벗 테이블</title>
<style>
* {{ margin: 0; padding: 0; box-sizing: border-box; }}
body {{ font-family: 'Malgun Gothic', 'Apple SD Gothic Neo', sans-serif; background: #f0f2f5; color: #1a1a2e; }}

.header {{
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  color: #fff; padding: 24px 32px; position: sticky; top: 0; z-index: 100;
  box-shadow: 0 2px 12px rgba(0,0,0,0.15);
}}
.header h1 {{ font-size: 20px; font-weight: 700; margin-bottom: 4px; }}
.header .sub {{ font-size: 13px; color: #a8b2d1; }}

.controls {{
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  padding: 16px 32px; background: #fff; border-bottom: 1px solid #e0e0e0;
  position: sticky; top: 72px; z-index: 99;
}}
.controls label {{ font-size: 13px; font-weight: 600; color: #555; }}
.controls select, .controls input {{
  padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px;
  font-size: 13px; background: #fff; outline: none;
}}
.controls select:focus, .controls input:focus {{ border-color: #0f3460; }}
.toggle-group {{ display: flex; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; }}
.toggle-group button {{
  padding: 6px 14px; border: none; background: #fff; font-size: 12px;
  cursor: pointer; color: #555; font-weight: 500; transition: all .2s;
}}
.toggle-group button.active {{ background: #0f3460; color: #fff; }}

.summary-cards {{
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px; padding: 16px 32px;
}}
.card {{
  background: #fff; border-radius: 10px; padding: 16px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}}
.card .label {{ font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }}
.card .value {{ font-size: 22px; font-weight: 700; color: #1a1a2e; margin-top: 4px; }}
.card .unit {{ font-size: 12px; color: #888; }}

.table-wrap {{
  padding: 0 32px 32px; overflow-x: auto;
}}
table {{
  width: 100%; border-collapse: separate; border-spacing: 0;
  background: #fff; border-radius: 10px; overflow: hidden;
  box-shadow: 0 1px 6px rgba(0,0,0,0.06); font-size: 12px;
}}
thead th {{
  background: #1a1a2e; color: #fff; padding: 10px 8px;
  font-weight: 600; font-size: 11px; text-align: center;
  position: sticky; top: 130px; z-index: 10; white-space: nowrap;
}}
thead th.row-header {{ background: #16213e; text-align: left; min-width: 100px; }}
thead th.month-header {{ min-width: 100px; }}
thead th.total-header {{ background: #0f3460; min-width: 110px; }}

tbody td {{
  padding: 7px 8px; border-bottom: 1px solid #f0f0f0;
  white-space: nowrap;
}}
tbody tr:hover td {{ background: #f8f9ff; }}
tbody tr.supplier-row td {{
  background: #e8ecf4; font-weight: 700; font-size: 13px;
  border-bottom: 2px solid #c5cee0; cursor: pointer;
}}
tbody tr.supplier-row:hover td {{ background: #dce2f0; }}
tbody tr.supplier-row td.toggle-icon {{ text-align: center; width: 24px; color: #0f3460; }}
tbody tr.item-row td {{ padding-left: 16px; }}
tbody tr.item-row td:first-child {{ padding-left: 32px; }}

td.num {{ text-align: right; font-variant-numeric: tabular-nums; }}
td.num.has-value {{ color: #1a1a2e; }}
td.num.zero {{ color: #ccc; }}

tfoot td {{
  background: #f0f2f5; font-weight: 700; padding: 10px 8px;
  border-top: 2px solid #1a1a2e; font-size: 12px;
}}

.expand-all {{ padding: 6px 14px; border: 1px solid #ccc; border-radius: 6px;
  background: #fff; cursor: pointer; font-size: 12px; }}
.expand-all:hover {{ background: #f0f0f0; }}

.search-box {{ position: relative; }}
.search-box input {{ padding-left: 28px; width: 200px; }}
.search-box::before {{
  content: '\\1F50D'; position: absolute; left: 8px; top: 50%;
  transform: translateY(-50%); font-size: 13px;
}}

@media print {{
  .header {{ position: static; }}
  .controls {{ position: static; display: none; }}
  thead th {{ position: static; }}
}}
</style>
</head>
<body>

<div class="header">
  <h1>2025년 원재료 매입 현황</h1>
  <div class="sub">XERP rpBillHeader(AP) + ItemMaster(MAT) | 거래처별 · 월별 · 품목별 피벗</div>
</div>

<div class="controls">
  <label>거래처</label>
  <select id="filterCs"><option value="">전체</option></select>

  <label>보기</label>
  <div class="toggle-group" id="valueToggle">
    <button data-val="supplyAmnt" class="active">공급가액</button>
    <button data-val="totalAmnt">합계(VAT)</button>
    <button data-val="qty">수량</button>
  </div>

  <div class="search-box">
    <input id="searchInput" type="text" placeholder="품목코드/품목명 검색">
  </div>

  <button class="expand-all" id="btnExpandAll">전체 펼치기</button>
  <button class="expand-all" id="btnCollapseAll">전체 접기</button>
</div>

<div class="summary-cards" id="summaryCards"></div>
<div class="table-wrap"><table id="pivotTable"></table></div>

<script>
const RAW = __DATA__;
const MONTHS = ['202501','202502','202503','202504','202505','202506',
                '202507','202508','202509','202510','202511','202512'];
const MONTH_LABELS = ['1월','2월','3월','4월','5월','6월','7월','8월','9월','10월','11월','12월'];

let valueField = 'supplyAmnt';
let filterCs = '';
let searchTerm = '';
let expandedSuppliers = new Set();

function fmt(n) {{
  if (n == null || n === 0) return '';
  return n.toLocaleString('ko-KR');
}}

function buildPivotData(data) {{
  const suppliers = {{}};
  data.forEach(r => {{
    const csKey = r.csCode;
    if (!suppliers[csKey]) {{
      suppliers[csKey] = {{ csCode: r.csCode, csName: r.csName, items: {{}}, totals: {{}} }};
      MONTHS.forEach(m => suppliers[csKey].totals[m] = {{ qty:0, supplyAmnt:0, totalAmnt:0 }});
    }}
    const s = suppliers[csKey];
    const itemKey = r.itemCode;
    if (!s.items[itemKey]) {{
      s.items[itemKey] = {{ itemCode: r.itemCode, itemName: r.itemName, itemSpec: r.itemSpec, unitCode: r.unitCode, months: {{}} }};
      MONTHS.forEach(m => s.items[itemKey].months[m] = {{ qty:0, supplyAmnt:0, totalAmnt:0 }});
    }}
    const m = r.billMonth;
    if (s.items[itemKey].months[m]) {{
      s.items[itemKey].months[m].qty += r.qty || 0;
      s.items[itemKey].months[m].supplyAmnt += r.supplyAmnt || 0;
      s.items[itemKey].months[m].totalAmnt += r.totalAmnt || 0;
      s.totals[m].qty += r.qty || 0;
      s.totals[m].supplyAmnt += r.supplyAmnt || 0;
      s.totals[m].totalAmnt += r.totalAmnt || 0;
    }}
  }});
  return suppliers;
}}

function getFiltered() {{
  let d = RAW;
  if (filterCs) d = d.filter(r => r.csCode === filterCs);
  if (searchTerm) {{
    const q = searchTerm.toLowerCase();
    d = d.filter(r => r.itemCode.toLowerCase().includes(q) || (r.itemName||'').toLowerCase().includes(q));
  }}
  return d;
}}

function sumField(obj, field) {{
  return MONTHS.reduce((a, m) => a + (obj[m]?.[field] || 0), 0);
}}

function renderSummary(suppliers) {{
  const cards = document.getElementById('summaryCards');
  let totalSupply = 0, totalVat = 0, totalQty = 0, itemSet = new Set();
  Object.values(suppliers).forEach(s => {{
    MONTHS.forEach(m => {{
      totalSupply += s.totals[m].supplyAmnt;
      totalQty += s.totals[m].qty;
    }});
    Object.keys(s.items).forEach(k => itemSet.add(k));
  }});
  const filtered = getFiltered();
  totalVat = filtered.reduce((a,r) => a + (r.vatAmnt||0), 0);
  cards.innerHTML = `
    <div class="card"><div class="label">거래처 수</div><div class="value">${{Object.keys(suppliers).length}}<span class="unit">개</span></div></div>
    <div class="card"><div class="label">품목 종류</div><div class="value">${{itemSet.size}}<span class="unit">종</span></div></div>
    <div class="card"><div class="label">총 수량</div><div class="value">${{totalQty.toLocaleString()}}<span class="unit">EA</span></div></div>
    <div class="card"><div class="label">공급가액 합계</div><div class="value">${{Math.round(totalSupply/10000).toLocaleString()}}<span class="unit">만원</span></div></div>
    <div class="card"><div class="label">부가세 합계</div><div class="value">${{Math.round(totalVat/10000).toLocaleString()}}<span class="unit">만원</span></div></div>
    <div class="card"><div class="label">합계(VAT포함)</div><div class="value">${{Math.round((totalSupply+totalVat)/10000).toLocaleString()}}<span class="unit">만원</span></div></div>
  `;
}}

function renderTable(suppliers) {{
  const table = document.getElementById('pivotTable');
  // Sort suppliers by total descending
  const sorted = Object.values(suppliers).sort((a,b) =>
    sumField(b.totals, valueField) - sumField(a.totals, valueField));

  // Grand totals
  const grand = {{}};
  MONTHS.forEach(m => grand[m] = {{ qty:0, supplyAmnt:0, totalAmnt:0 }});
  sorted.forEach(s => MONTHS.forEach(m => {{
    grand[m].qty += s.totals[m].qty;
    grand[m].supplyAmnt += s.totals[m].supplyAmnt;
    grand[m].totalAmnt += s.totals[m].totalAmnt;
  }}));

  let html = `<thead><tr>
    <th class="row-header" style="width:30px"></th>
    <th class="row-header">거래처 / 품목</th>
    <th class="row-header">규격</th>`;
  MONTHS.forEach((m,i) => html += `<th class="month-header">${{MONTH_LABELS[i]}}</th>`);
  html += `<th class="total-header">연간 합계</th></tr></thead><tbody>`;

  sorted.forEach(s => {{
    const csTotal = sumField(s.totals, valueField);
    const expanded = expandedSuppliers.has(s.csCode);
    html += `<tr class="supplier-row" data-cs="${{s.csCode}}">
      <td class="toggle-icon">${{expanded ? '▼' : '▶'}}</td>
      <td>${{s.csName || s.csCode}}</td><td></td>`;
    MONTHS.forEach(m => {{
      const v = s.totals[m][valueField];
      html += `<td class="num ${{v ? 'has-value' : 'zero'}}">${{fmt(v)}}</td>`;
    }});
    html += `<td class="num has-value" style="font-weight:700">${{fmt(csTotal)}}</td></tr>`;

    if (expanded) {{
      const items = Object.values(s.items).sort((a,b) =>
        sumField(b.months, valueField) - sumField(a.months, valueField));
      items.forEach(item => {{
        const itemTotal = sumField(item.months, valueField);
        if (itemTotal === 0 && valueField !== 'qty') return;
        html += `<tr class="item-row">
          <td></td>
          <td>${{item.itemCode}} ${{item.itemName || ''}}</td>
          <td>${{item.itemSpec || ''}}</td>`;
        MONTHS.forEach(m => {{
          const v = item.months[m][valueField];
          html += `<td class="num ${{v ? 'has-value' : 'zero'}}">${{fmt(v)}}</td>`;
        }});
        html += `<td class="num has-value">${{fmt(itemTotal)}}</td></tr>`;
      }});
    }}
  }});
  html += `</tbody><tfoot><tr><td></td><td><strong>총 합계</strong></td><td></td>`;
  let grandTotal = 0;
  MONTHS.forEach(m => {{
    const v = grand[m][valueField];
    grandTotal += v;
    html += `<td class="num">${{fmt(v)}}</td>`;
  }});
  html += `<td class="num" style="font-size:13px">${{fmt(grandTotal)}}</td></tr></tfoot>`;

  table.innerHTML = html;

  // Bind click events
  table.querySelectorAll('.supplier-row').forEach(tr => {{
    tr.addEventListener('click', () => {{
      const cs = tr.dataset.cs;
      if (expandedSuppliers.has(cs)) expandedSuppliers.delete(cs);
      else expandedSuppliers.add(cs);
      refresh();
    }});
  }});
}}

function refresh() {{
  const filtered = getFiltered();
  const suppliers = buildPivotData(filtered);
  renderSummary(suppliers);
  renderTable(suppliers);
}}

// Init supplier filter
const csSet = new Map();
RAW.forEach(r => {{ if (!csSet.has(r.csCode)) csSet.set(r.csCode, r.csName); }});
const sel = document.getElementById('filterCs');
[...csSet.entries()].sort((a,b) => a[1].localeCompare(b[1])).forEach(([code, name]) => {{
  const opt = document.createElement('option');
  opt.value = code;
  opt.textContent = name || code;
  sel.appendChild(opt);
}});

sel.addEventListener('change', e => {{ filterCs = e.target.value; refresh(); }});

document.querySelectorAll('#valueToggle button').forEach(btn => {{
  btn.addEventListener('click', () => {{
    document.querySelectorAll('#valueToggle button').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    valueField = btn.dataset.val;
    refresh();
  }});
}});

document.getElementById('searchInput').addEventListener('input', e => {{
  searchTerm = e.target.value;
  refresh();
}});

document.getElementById('btnExpandAll').addEventListener('click', () => {{
  csSet.forEach((_, code) => expandedSuppliers.add(code));
  refresh();
}});
document.getElementById('btnCollapseAll').addEventListener('click', () => {{
  expandedSuppliers.clear();
  refresh();
}});

// Initial render - expand all
csSet.forEach((_, code) => expandedSuppliers.add(code));
refresh();
</script>
</body>
</html>"""

html = html.replace('__DATA__', data_json)

out_path = os.path.join(os.path.dirname(__file__), 'mat_purchase_pivot.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'Generated: {out_path}')
print(f'Data rows: {len(rows)}')
