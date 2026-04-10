#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ERP 전체 메뉴 풀테스트 v2 - 프론트엔드 실제 호출 경로 기준"""
import urllib.request, json, time, sys

BASE = 'http://localhost:12026'
TOKEN = None
results = []
start_time = time.time()

def api(method, path, body=None, timeout=25):
    url = BASE + path
    data = json.dumps(body).encode() if body else None
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header('Content-Type', 'application/json')
    if TOKEN:
        req.add_header('Authorization', 'Bearer ' + TOKEN)
    try:
        with urllib.request.urlopen(req, timeout=timeout) as r:
            return r.getcode(), json.loads(r.read())
    except urllib.error.HTTPError as e:
        try: return e.code, json.loads(e.read())
        except: return e.code, {'ok': False, 'error': f'HTTP {e.code}: {e.reason}'}
    except Exception as e:
        return 0, {'ok': False, 'error': str(e)[:100]}

def test(cat, menu, method, path, db, check_fn, timeout=25, body=None):
    t0 = time.time()
    code, d = api(method, path, body=body, timeout=timeout)
    ms = int((time.time() - t0) * 1000)
    ok = d.get('ok', False)
    try: detail = check_fn(d) if ok else str(d.get('error',''))[:60]
    except Exception as ex: detail = f'parse err: {ex}'
    status = 'PASS' if ok else ('WARN' if code in [200,503] else 'FAIL')
    results.append((cat, menu, db, status, code, ms, detail, path))
    icon = {'PASS':'[OK]','WARN':'[!!]','FAIL':'[XX]'}[status]
    print(f'  {icon} {menu:<16} {db:<28} {code:>3} {ms:>5}ms  {detail}')

def cnt(d):
    data = d.get('data', [])
    if isinstance(data, list): return f'{len(data)}건'
    if isinstance(data, dict):
        if 'rows' in data: return f"{len(data['rows'])}건, total={data.get('total','?')}"
        if 'total' in data: return f"total={data['total']}"
    return 'OK'

def src(d):
    s = d.get('data',{}).get('sources',{})
    if not s: return 'OK'
    return ', '.join(f"{k}={'O' if v else 'X'}" for k,v in s.items())

# ===== START =====
print('=' * 72)
print('  ERP 전체 메뉴 풀테스트 v2 (프론트엔드 실제 호출 경로)')
print('  ' + time.strftime('%Y-%m-%d %H:%M:%S'))
print('=' * 72)

# Health
print('\n--- Health Check ---')
code, h = api('GET', '/api/health')
checks = h.get('data',{}).get('checks',{}) if h.get('ok') else h
for k in ['sqlite','xerp','smtp','google_sheet']:
    v = checks.get(k, '?')
    print(f'  {k}: {v}')

# Login
print('\n--- Auth ---')
code, d = api('POST', '/api/auth/login', {'username':'admin','password':'1234'})
TOKEN = d['data']['token']
user = d['data']['user']
print(f'  Login OK: {user["username"]} / {user["role"]}')

# Date params
P1 = 'start=20250301&end=20250331'
P3 = 'start=20250101&end=20250331'

# ============================================================
# 1. 재고 (4 pages: inventory, shipments, closing, warehouse)
# ============================================================
print(f'\n{"="*72}')
print('  [1/9] 재고 (4 pages)')
print(f'{"="*72}')
test('재고','재고현황','GET','/api/xerp-inventory','XERP mmInventory',cnt,timeout=20)
test('재고','XERP월사용량','GET','/api/xerp-monthly-usage','XERP mmInoutItem',cnt,timeout=20)
test('재고','XERP입고코드','GET','/api/xerp-receiving-codes?from=20250801&to=20260228','XERP mmInoutHeader',cnt,timeout=20)
test('재고','출고현황','GET','/api/shipments?from=20250301&to=20250401','XERP mmInoutHeader',cnt,timeout=20)
test('재고','마감검증','GET','/api/closing-verify?year=2025&month=3','XERP rpBillItem',lambda d:'OK',timeout=20)
test('재고','마감거래처','GET','/api/closing-vendor-items?vendor_code=2015259&year=2025&month=3','XERP rpBillItem',cnt,timeout=20)
test('재고','창고목록','GET','/api/warehouses','SQLite',cnt)
test('재고','창고재고','GET','/api/warehouses/inventory?search=','SQLite',cnt)
test('재고','XERP동기화','POST','/api/warehouses/sync-xerp','XERP+SQLite',lambda d:'OK',timeout=20,body={})
test('재고','창고이동이력','GET','/api/warehouses/transfers?limit=50','SQLite',cnt)
test('재고','창고조정이력','GET','/api/warehouses/adjustments?limit=50','SQLite',cnt)

# ============================================================
# 2. 발주 (5 pages: auto-order, create-po, po-list, po-mgmt, china-shipment)
# ============================================================
print(f'\n{"="*72}')
print('  [2/9] 발주 (5 pages)')
print(f'{"="*72}')
test('발주','자동발주목록','GET','/api/auto-order','SQLite+XERP',cnt,timeout=15)
test('발주','자동발주검색','GET','/api/auto-order/search?q=test','SQLite',cnt)
test('발주','자동발주체크','POST','/api/auto-order/check','SQLite',lambda d:'OK',body={},timeout=15)
test('발주','PO목록','GET','/api/po','SQLite',cnt)
test('발주','PO통계','GET','/api/po/stats','SQLite',lambda d:f"{len(d.get('data',{}))} keys")
test('발주','발주서(구매)','GET','/api/purchases?year=2026','SQLite',cnt)
test('발주','PO초안','GET','/api/po-drafts','SQLite',cnt)
test('발주','중국선적로그','GET','/api/china-shipment/logs','SQLite',cnt)
test('발주','중국단가','GET','/api/china-price-tiers','SQLite',lambda d:'OK')
test('발주','OS매칭','GET','/api/po/os-match','SQLite',cnt)
test('발주','OS대기','GET','/api/po/os-pending','SQLite',cnt)

# ============================================================
# 3. 입고 (3 pages: delivery-schedule, receipts, os-register)
# ============================================================
print(f'\n{"="*72}')
print('  [3/9] 입고 (3 pages)')
print(f'{"="*72}')
test('입고','입고관리','GET','/api/receipts','SQLite',cnt)
test('입고','입고일정','GET','/api/delivery-schedule','SQLite',cnt,timeout=15)

# ============================================================
# 4. 생산 (3 pages: production-req, production-stock, mrp)
# ============================================================
print(f'\n{"="*72}')
print('  [4/9] 생산 (3 pages)')
print(f'{"="*72}')
test('생산','생산요청','GET','/api/production-requests','SQLite',cnt)
test('생산','생산재고','GET','/api/gift-sets','SQLite',cnt)
test('생산','생산용량','GET','/api/gift-sets/production-capacity','SQLite',lambda d:'OK')
test('생산','MRP결과','GET','/api/mrp/results?month=2025-03','SQLite',cnt)
test('생산','스펙관리','GET','/api/specs','SQLite',cnt)
test('생산','부자재','GET','/api/accessories?page=1&limit=50','SQLite',cnt)
test('생산','생산계획','GET','/api/plans?month=2025-03','SQLite',cnt)

# ============================================================
# 5. 업무 (3 pages: tasks, notes, board)
# ============================================================
print(f'\n{"="*72}')
print('  [5/9] 업무 (3 pages)')
print(f'{"="*72}')
test('업무','업무목록','GET','/api/tasks?status=all','SQLite',cnt)
test('업무','업무(todo)','GET','/api/tasks?status=todo','SQLite',cnt)
test('업무','업무템플릿','GET','/api/task-templates','SQLite',cnt)
test('업무','미팅일지','GET','/api/notes','SQLite',cnt)
test('업무','공지목록','GET','/api/notices?page=1&limit=15','SQLite',cnt)
test('업무','팝업공지','GET','/api/notices/popup','SQLite',cnt)

# ============================================================
# 6. 매출 (7 pages: sales, sales-barun, sales-dd, sales-gift, cost-mgmt, customer-orders, shipping)
# ============================================================
print(f'\n{"="*72}')
print('  [6/9] 매출 (7 pages)')
print(f'{"="*72}')
# 통합매출
test('매출','매출KPI','GET','/api/sales/kpi','XERP+bar_shop1+DD',src,timeout=30)
test('매출','매출일별','GET',f'/api/sales/daily?{P1}','XERP+bar_shop1+DD',src,timeout=30)
test('매출','매출채널별','GET',f'/api/sales/by-channel?{P1}','XERP',src,timeout=30)
test('매출','매출상품별','GET',f'/api/sales/by-product?{P1}&limit=30','XERP',src,timeout=30)
test('매출','매출브랜드별','GET',f'/api/sales/by-brand?{P1}','XERP+bar_shop1',src,timeout=30)
test('매출','매출추이','GET','/api/sales/trend?months=12','XERP',src,timeout=30)
test('매출','주문현황','GET',f'/api/sales/order-status?start=2025-03-01&end=2025-03-31','bar_shop1',src,timeout=15)
test('매출','매출월별','GET',f'/api/sales/monthly?{P1}','XERP',src,timeout=30)
# 바른손매출
test('매출','바른손매출','GET',f'/api/sales/barun?{P1}','XERP+bar_shop1',src,timeout=30)
# DD매출
test('매출','DD매출','GET',f'/api/sales/dd?{P1}','DD MySQL',src,timeout=15)
# 더기프트
test('매출','더기프트매출','GET',f'/api/sales/gift?{P1}','bar_shop1',src,timeout=15)
# 원가관리
test('매출','원가요약','GET','/api/cost/summary','XERP+bar_shop1+SQLite',src,timeout=30)
test('매출','원가상품','GET',f'/api/cost/products?{P1}&limit=50&sort=sales','XERP+bar_shop1',src,timeout=30)
test('매출','원가채널','GET',f'/api/cost/by-channel?{P1}','XERP+bar_shop1',src,timeout=30)
test('매출','원가추이','GET','/api/cost/trend?months=12','XERP+bar_shop1',src,timeout=30)
test('매출','원가구성','GET',f'/api/cost/breakdown?{P1}','XERP+bar_shop1+SQLite',src,timeout=30)
# 고객주문
test('매출','고객주문요약','GET',f'/api/customer-orders/summary?{P1}','XERP+bar_shop1+DD+SQLite',src,timeout=30)
test('매출','고객XERP','GET',f'/api/customer-orders/list?{P1}&limit=10','XERP',cnt,timeout=30)
test('매출','고객bar_shop1','GET',f'/api/customer-orders/bar-list?{P1}&limit=10','bar_shop1',cnt,timeout=15)
test('매출','고객일별','GET','/api/customer-orders/daily?days=30','XERP',cnt,timeout=30)
# 배송추적
test('매출','배송요약','GET',f'/api/shipping/summary?{P1}','bar_shop1+DD',src,timeout=15)
test('매출','배송bar목록','GET',f'/api/shipping/list?{P1}&limit=10','bar_shop1',cnt,timeout=15)
test('매출','배송DD목록','GET',f'/api/shipping/dd-list?{P1}&limit=10','DD MySQL',cnt,timeout=15)

# ============================================================
# 7. 기준정보 (6 pages: vendors, product-mgmt, bom, post-process, invoices, mat-purchase)
# ============================================================
print(f'\n{"="*72}')
print('  [7/9] 기준정보 (6 pages)')
print(f'{"="*72}')
test('기준정보','거래처목록','GET','/api/vendors','SQLite',cnt)
test('기준정보','거래처포털','GET','/api/vendor-portal?email=test@test.com&token=test&vendor_name=test','SQLite',cnt)
test('기준정보','포털납기일정','GET','/api/vendor-portal/shipment-schedule','SQLite',cnt)
test('기준정보','포털리드타임','GET','/api/vendor-portal/lead-time','SQLite',cnt)
test('기준정보','품목목록','GET','/api/products','SQLite',cnt)
test('기준정보','품목정보동기화','GET','/api/product-info/sync-status','SQLite',lambda d:'OK')
test('기준정보','DD동기화','GET','/api/dd/sync-status','DD MySQL',lambda d:'OK',timeout=15)
test('기준정보','품목후공정매핑','GET','/api/product-post-vendor','SQLite',cnt)
test('기준정보','품목노트','GET','/api/product-notes','SQLite',lambda d:f"{len(d.get('data',{}))} codes")
test('기준정보','BOM목록','GET','/api/bom','SQLite',cnt)
test('기준정보','후공정단가','GET','/api/post-process/prices','SQLite',cnt)
test('기준정보','후공정이력','GET','/api/post-process/history','SQLite',cnt)
test('기준정보','후공정매핑','GET','/api/post-process/product-map','SQLite',cnt)
test('기준정보','후공정요약','GET','/api/post-process/summary','SQLite',lambda d:'OK')
test('기준정보','후공정견적','GET','/api/post-process/estimate?product_code=KM-001','SQLite',lambda d:'OK')
test('기준정보','거래명세서','GET','/api/invoices','SQLite',cnt)
test('기준정보','명세서검토','GET','/api/trade-document/review','SQLite',cnt)
test('기준정보','원재료매입','GET','/api/material-purchases?from=20250301&to=20250331','XERP',cnt,timeout=20)

# ============================================================
# 8. 분석 (4 pages: analytics, exec-dashboard, report, defects)
# ============================================================
print(f'\n{"="*72}')
print('  [8/9] 분석 (4 pages)')
print(f'{"="*72}')
test('분석','대시보드분석','GET','/api/dashboard/analytics','SQLite',lambda d:'OK')
test('분석','통계-거래처','GET','/api/stats/vendor-summary','SQLite+XERP',lambda d:'OK',timeout=20)
test('분석','통계-사용추이','GET','/api/stats/usage-trend-all?months=6','XERP',lambda d:'OK',timeout=20)
test('분석','통계-전체','GET','/api/stats','SQLite',lambda d:'OK')
test('분석','경영요약','GET','/api/exec/summary','XERP+bar_shop1+SQLite',src,timeout=35)
test('분석','경영추이','GET','/api/exec/trend?months=12','XERP+bar_shop1',src,timeout=35)
test('분석','보고서목록','GET','/api/reports','SQLite',cnt)
test('분석','입고보고','GET','/api/report-receiving?from=202501&to=202602','XERP+SQLite',cnt,timeout=20)
test('분석','매입단가보고','GET','/api/report-vendor-price?vendor_code=2015259','XERP+SQLite',lambda d:'OK',timeout=20)
test('분석','불량목록','GET','/api/defects?limit=50','SQLite',cnt)
test('분석','불량요약','GET','/api/defects/summary','SQLite',lambda d:'OK')
test('분석','검사관리','GET','/api/inspections','SQLite',cnt)
test('분석','NCR','GET','/api/ncr','SQLite',cnt)

# ============================================================
# 9. 시스템 (3 pages: settings, user-mgmt, audit-log)
# ============================================================
print(f'\n{"="*72}')
print('  [9/9] 시스템 (3 pages)')
print(f'{"="*72}')
test('시스템','감사로그','GET','/api/audit-log?limit=50','SQLite',cnt)
test('시스템','감사통계','GET','/api/audit-log/stats?days=30','SQLite',lambda d:f"total={d['data']['total']}")
test('시스템','감사필터값','GET','/api/audit-log/actions','SQLite',lambda d:f"actions={len(d['data'].get('actions',[]))}")
test('시스템','에러로그','GET','/api/error-logs?limit=50','SQLite',cnt)
test('시스템','활동로그','GET','/api/activity-log','SQLite',cnt)
test('시스템','사용자목록','GET','/api/auth/users','SQLite',lambda d:f"{len(d['data'])}명")
test('시스템','인증설정','GET','/api/auth/config','SQLite',lambda d:'OK')
test('시스템','페이지목록','GET','/api/auth/pages','SQLite',lambda d:f"{len(d['data'])}pages")

# ===== SUMMARY =====
elapsed = time.time() - start_time
pass_cnt = sum(1 for r in results if r[3] == 'PASS')
warn_cnt = sum(1 for r in results if r[3] == 'WARN')
fail_cnt = sum(1 for r in results if r[3] == 'FAIL')
total = len(results)

print(f'\n{"="*72}')
print(f'  TOTAL: {total}개 API | PASS: {pass_cnt} | WARN: {warn_cnt} | FAIL: {fail_cnt} | {elapsed:.0f}초')
print(f'{"="*72}')

if fail_cnt > 0 or warn_cnt > 0:
    print(f'\n--- FAIL/WARN 상세 ---')
    for cat, menu, db, status, code, ms, detail, path in results:
        if status != 'PASS':
            reason = 'XERP timeout' if 'timed out' in detail else ('XERP 미연결' if '미연결' in detail or '503' in detail else 'API error')
            print(f'  [{status:4}] {cat}/{menu} -> {reason}')
            print(f'         {path} (HTTP {code}, {ms}ms)')

# DB별
print(f'\n--- DB별 연동률 ---')
db_stats = {}
for cat, menu, db, status, code, ms, detail, path in results:
    for d in ['XERP','bar_shop1','DD','SQLite']:
        if d in db:
            db_stats.setdefault(d, {'pass':0,'fail':0})
            db_stats[d]['pass' if status=='PASS' else 'fail'] += 1
for d,s in sorted(db_stats.items()):
    t = s['pass']+s['fail']
    pct = s['pass']/t*100 if t else 0
    bar = '#' * int(pct/5) + '.' * (20-int(pct/5))
    print(f'  {d:<12} [{bar}] {s["pass"]}/{t} ({pct:.0f}%)')

# 카테고리별
print(f'\n--- 카테고리별 ---')
cat_stats = {}
for cat, menu, db, status, code, ms, detail, path in results:
    cat_stats.setdefault(cat, {'pass':0,'fail':0})
    cat_stats[cat]['pass' if status=='PASS' else 'fail'] += 1
for c,s in cat_stats.items():
    t = s['pass']+s['fail']
    pct = s['pass']/t*100 if t else 0
    bar = '#' * int(pct/5) + '.' * (20-int(pct/5))
    print(f'  {c:<8} [{bar}] {s["pass"]}/{t} ({pct:.0f}%)')

# 응답시간 분석
print(f'\n--- 응답시간 분석 ---')
times = [r[5] for r in results if r[3]=='PASS']
if times:
    print(f'  평균: {sum(times)/len(times):.0f}ms | 최소: {min(times)}ms | 최대: {max(times)}ms')
    slow = [(r[1],r[5]) for r in results if r[3]=='PASS' and r[5]>5000]
    if slow:
        print(f'  느린 API (>5초):')
        for name,ms in sorted(slow, key=lambda x:-x[1]):
            print(f'    {name}: {ms}ms')
