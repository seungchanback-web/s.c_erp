#!/usr/bin/env python3
"""pivot_data.json -> 단독 HTML 피벗 웹페이지 생성"""
import json, os

dir_path = os.path.dirname(os.path.abspath(__file__))
with open(os.path.join(dir_path, 'pivot_data.json'), 'r', encoding='utf-8') as f:
    data = json.load(f)

data_json = json.dumps(data, ensure_ascii=False)

HTML_TEMPLATE = r"""<!DOCTYPE html>
<html lang="ko">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>2025년 원재료 매입 현황</title>
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
body { font-family: "Malgun Gothic", "Apple SD Gothic Neo", sans-serif; background: #f0f2f5; color: #1a1a2e; }

.header {
  background: linear-gradient(135deg, #1a1a2e 0%, #16213e 50%, #0f3460 100%);
  color: #fff; padding: 24px 32px; position: sticky; top: 0; z-index: 100;
  box-shadow: 0 2px 12px rgba(0,0,0,0.15);
}
.header h1 { font-size: 20px; font-weight: 700; margin-bottom: 4px; }
.header .sub { font-size: 13px; color: #a8b2d1; }

.controls {
  display: flex; gap: 12px; align-items: center; flex-wrap: wrap;
  padding: 16px 32px; background: #fff; border-bottom: 1px solid #e0e0e0;
  position: sticky; top: 72px; z-index: 99;
}
.controls label { font-size: 13px; font-weight: 600; color: #555; }
.controls select, .controls input {
  padding: 6px 10px; border: 1px solid #ccc; border-radius: 6px;
  font-size: 13px; background: #fff; outline: none;
}
.controls select:focus, .controls input:focus { border-color: #0f3460; }
.toggle-group { display: flex; border: 1px solid #ccc; border-radius: 6px; overflow: hidden; }
.toggle-group button {
  padding: 6px 14px; border: none; background: #fff; font-size: 12px;
  cursor: pointer; color: #555; font-weight: 500; transition: all .2s;
}
.toggle-group button.active { background: #0f3460; color: #fff; }

.summary-cards {
  display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px; padding: 16px 32px;
}
.card {
  background: #fff; border-radius: 10px; padding: 16px 20px;
  box-shadow: 0 1px 4px rgba(0,0,0,0.06);
}
.card .label { font-size: 11px; color: #888; font-weight: 600; text-transform: uppercase; letter-spacing: .5px; }
.card .value { font-size: 22px; font-weight: 700; color: #1a1a2e; margin-top: 4px; }
.card .unit { font-size: 12px; color: #888; }

.table-wrap { padding: 0 32px 32px; overflow-x: auto; }
table {
  width: 100%; border-collapse: separate; border-spacing: 0;
  background: #fff; border-radius: 10px; overflow: hidden;
  box-shadow: 0 1px 6px rgba(0,0,0,0.06); font-size: 12px;
}
thead th {
  background: #1a1a2e; color: #fff; padding: 10px 8px;
  font-weight: 600; font-size: 11px; text-align: center;
  position: sticky; top: 130px; z-index: 10; white-space: nowrap;
}
thead th.row-header { background: #16213e; text-align: left; min-width: 100px; }
thead th.month-header { min-width: 100px; }
thead th.total-header { background: #0f3460; min-width: 110px; }

tbody td { padding: 7px 8px; border-bottom: 1px solid #f0f0f0; white-space: nowrap; }
tbody tr:hover td { background: #f8f9ff; }
tbody tr.supplier-row td {
  background: #e8ecf4; font-weight: 700; font-size: 13px;
  border-bottom: 2px solid #c5cee0; cursor: pointer;
}
tbody tr.supplier-row:hover td { background: #dce2f0; }
tbody tr.supplier-row td.toggle-icon { text-align: center; width: 24px; color: #0f3460; }
tbody tr.item-row td { padding-left: 16px; }
tbody tr.item-row td:first-child { padding-left: 32px; }

td.num { text-align: right; font-variant-numeric: tabular-nums; }
td.num.has-value { color: #1a1a2e; }
td.num.zero { color: #ccc; }

tfoot td {
  background: #f0f2f5; font-weight: 700; padding: 10px 8px;
  border-top: 2px solid #1a1a2e; font-size: 12px;
}

.btn { padding: 6px 14px; border: 1px solid #ccc; border-radius: 6px;
  background: #fff; cursor: pointer; font-size: 12px; }
.btn:hover { background: #f0f0f0; }

@media print {
  .header { position: static; }
  .controls { position: static; display: none; }
  thead th { position: static; }
}
</style>
</head>
<body>

<div class="header">
  <h1>2025년 원재료 매입 현황</h1>
  <div class="sub">거래처별 &middot; 월별 &middot; 품목별 매입 수량 및 금액</div>
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

  <label>검색</label>
  <input id="searchInput" type="text" placeholder="품목코드/품목명 검색">

  <button class="btn" id="btnExpandAll">전체 펼치기</button>
  <button class="btn" id="btnCollapseAll">전체 접기</button>
</div>

<div class="summary-cards" id="summaryCards"></div>
<div class="table-wrap"><table id="pivotTable"></table></div>

<script>
const RAW = %%DATA%%;
const MONTHS = ["202501","202502","202503","202504","202505","202506",
                "202507","202508","202509","202510","202511","202512"];
const ML = ["1월","2월","3월","4월","5월","6월","7월","8월","9월","10월","11월","12월"];

let vf = "supplyAmnt", fc = "", st = "";
const exp = new Set();

const fmt = n => (!n ? "" : n.toLocaleString("ko-KR"));

function pivot(data) {
  const S = {};
  data.forEach(r => {
    if (!S[r.csCode]) {
      S[r.csCode] = { csCode: r.csCode, csName: r.csName, items: {}, totals: {} };
      MONTHS.forEach(m => S[r.csCode].totals[m] = { qty:0, supplyAmnt:0, totalAmnt:0 });
    }
    const s = S[r.csCode];
    if (!s.items[r.itemCode]) {
      s.items[r.itemCode] = { itemCode: r.itemCode, itemName: r.itemName, itemSpec: r.itemSpec, unitCode: r.unitCode, months: {} };
      MONTHS.forEach(m => s.items[r.itemCode].months[m] = { qty:0, supplyAmnt:0, totalAmnt:0 });
    }
    const m = r.billMonth;
    if (s.items[r.itemCode].months[m]) {
      s.items[r.itemCode].months[m].qty += r.qty || 0;
      s.items[r.itemCode].months[m].supplyAmnt += r.supplyAmnt || 0;
      s.items[r.itemCode].months[m].totalAmnt += r.totalAmnt || 0;
      s.totals[m].qty += r.qty || 0;
      s.totals[m].supplyAmnt += r.supplyAmnt || 0;
      s.totals[m].totalAmnt += r.totalAmnt || 0;
    }
  });
  return S;
}

function filter() {
  let d = RAW;
  if (fc) d = d.filter(r => r.csCode === fc);
  if (st) { const q = st.toLowerCase(); d = d.filter(r => r.itemCode.toLowerCase().includes(q) || (r.itemName||"").toLowerCase().includes(q)); }
  return d;
}

function sf(obj, f) { return MONTHS.reduce((a,m) => a + (obj[m]?.[f]||0), 0); }

function summary(suppliers) {
  let ts=0, tq=0, is2=new Set();
  Object.values(suppliers).forEach(s => {
    MONTHS.forEach(m => { ts += s.totals[m].supplyAmnt; tq += s.totals[m].qty; });
    Object.keys(s.items).forEach(k => is2.add(k));
  });
  const tv = filter().reduce((a,r) => a + (r.vatAmnt||0), 0);
  document.getElementById("summaryCards").innerHTML =
    '<div class="card"><div class="label">거래처 수</div><div class="value">'+Object.keys(suppliers).length+'<span class="unit">개</span></div></div>'+
    '<div class="card"><div class="label">품목 종류</div><div class="value">'+is2.size+'<span class="unit">종</span></div></div>'+
    '<div class="card"><div class="label">총 수량</div><div class="value">'+tq.toLocaleString()+'</div></div>'+
    '<div class="card"><div class="label">공급가액 합계</div><div class="value">'+Math.round(ts/10000).toLocaleString()+'<span class="unit">만원</span></div></div>'+
    '<div class="card"><div class="label">부가세 합계</div><div class="value">'+Math.round(tv/10000).toLocaleString()+'<span class="unit">만원</span></div></div>'+
    '<div class="card"><div class="label">합계(VAT포함)</div><div class="value">'+Math.round((ts+tv)/10000).toLocaleString()+'<span class="unit">만원</span></div></div>';
}

function table(suppliers) {
  const t = document.getElementById("pivotTable");
  const sorted = Object.values(suppliers).sort((a,b) => sf(b.totals,vf) - sf(a.totals,vf));
  const g = {};
  MONTHS.forEach(m => g[m] = { qty:0, supplyAmnt:0, totalAmnt:0 });
  sorted.forEach(s => MONTHS.forEach(m => { g[m].qty+=s.totals[m].qty; g[m].supplyAmnt+=s.totals[m].supplyAmnt; g[m].totalAmnt+=s.totals[m].totalAmnt; }));

  let h = '<thead><tr><th class="row-header" style="width:30px"></th><th class="row-header">거래처 / 품목</th><th class="row-header">규격</th><th class="row-header">단위</th>';
  MONTHS.forEach((m,i) => h += '<th class="month-header">'+ML[i]+'</th>');
  h += '<th class="total-header">연간 합계</th></tr></thead><tbody>';

  sorted.forEach(s => {
    const ct = sf(s.totals, vf), ex = exp.has(s.csCode);
    h += '<tr class="supplier-row" data-cs="'+s.csCode+'"><td class="toggle-icon">'+(ex?'▼':'▶')+'</td><td>'+(s.csName||s.csCode)+'</td><td></td><td></td>';
    MONTHS.forEach(m => { const v=s.totals[m][vf]; h+='<td class="num '+(v?'has-value':'zero')+'">'+fmt(v)+'</td>'; });
    h += '<td class="num has-value" style="font-weight:700">'+fmt(ct)+'</td></tr>';
    if (ex) {
      Object.values(s.items).sort((a,b) => sf(b.months,vf)-sf(a.months,vf)).forEach(item => {
        const it = sf(item.months, vf);
        if (!it && vf!=='qty') return;
        h += '<tr class="item-row"><td></td><td>'+item.itemCode+' '+(item.itemName||'')+'</td><td>'+(item.itemSpec||'')+'</td><td>'+(item.unitCode||'')+'</td>';
        MONTHS.forEach(m => { const v=item.months[m][vf]; h+='<td class="num '+(v?'has-value':'zero')+'">'+fmt(v)+'</td>'; });
        h += '<td class="num has-value">'+fmt(it)+'</td></tr>';
      });
    }
  });

  h += '</tbody><tfoot><tr><td></td><td><strong>총 합계</strong></td><td></td><td></td>';
  let gt = 0;
  MONTHS.forEach(m => { const v=g[m][vf]; gt+=v; h+='<td class="num">'+fmt(v)+'</td>'; });
  h += '<td class="num" style="font-size:13px">'+fmt(gt)+'</td></tr></tfoot>';
  t.innerHTML = h;

  t.querySelectorAll('.supplier-row').forEach(tr => {
    tr.addEventListener('click', () => {
      const cs = tr.dataset.cs;
      exp.has(cs) ? exp.delete(cs) : exp.add(cs);
      refresh();
    });
  });
}

function refresh() { const f=filter(), s=pivot(f); summary(s); table(s); }

// Init
const csMap = new Map();
RAW.forEach(r => { if (!csMap.has(r.csCode)) csMap.set(r.csCode, r.csName); });
const sel = document.getElementById("filterCs");
[...csMap.entries()].sort((a,b) => (a[1]||"").localeCompare(b[1]||"")).forEach(([c,n]) => {
  const o = document.createElement("option"); o.value=c; o.textContent=n||c; sel.appendChild(o);
});
sel.addEventListener("change", e => { fc=e.target.value; refresh(); });
document.querySelectorAll("#valueToggle button").forEach(b => {
  b.addEventListener("click", () => {
    document.querySelectorAll("#valueToggle button").forEach(x => x.classList.remove("active"));
    b.classList.add("active"); vf=b.dataset.val; refresh();
  });
});
document.getElementById("searchInput").addEventListener("input", e => { st=e.target.value; refresh(); });
document.getElementById("btnExpandAll").addEventListener("click", () => { csMap.forEach((_,c)=>exp.add(c)); refresh(); });
document.getElementById("btnCollapseAll").addEventListener("click", () => { exp.clear(); refresh(); });
refresh();
</script>
</body>
</html>"""

html = HTML_TEMPLATE.replace('%%DATA%%', data_json)
out_path = os.path.join(dir_path, 'mat_purchase_pivot.html')
with open(out_path, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'Generated: {out_path} ({len(html):,} bytes)')
