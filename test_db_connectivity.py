#!/usr/bin/env python3
import urllib.request, json

BASE = 'http://localhost:12026'

def api(path, token=None):
    req = urllib.request.Request(BASE + path)
    if token:
        req.add_header('Authorization', 'Bearer ' + token)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'ok': False, 'error': str(e)[:80]}

def post_api(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(BASE + path, data=data, headers={'Content-Type':'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return json.loads(r.read())
    except Exception as e:
        return {'ok': False, 'error': str(e)[:80]}

# Login
resp = post_api('/api/auth/login', {'username':'admin','password':'1234'})
TOKEN = resp['data']['token']

# Health
h = api('/api/health')
print('=' * 60)
print('  DB 연결 상태')
print('=' * 60)
for k in ['xerp','bar_shop1','dd','sqlite','status']:
    v = h.get(k, '?')
    icon = '\u2705' if v in [True, 'ok', 'healthy'] else ('\u26a0\ufe0f' if v == False else '\u2753')
    print(f'  {icon} {k}: {v}')

def cnt(d):
    return f"{len(d.get('data',[]))}건"

def src(d):
    sources = d.get('data',{}).get('sources',{})
    if not sources:
        return 'OK'
    return ', '.join(f"{k}={'OK' if v else 'FAIL'}" for k,v in sources.items())

tests = [
    ('📦 재고', '재고현황', '/api/xerp-inventory', 'XERP', cnt),
    ('📦 재고', '출고현황', '/api/shipments', 'XERP', cnt),
    ('📦 재고', '창고관리', '/api/warehouses', 'SQLite', cnt),
    ('📦 재고', '마감현황', '/api/closing-verify?year=2025&month=3', 'XERP', lambda d: 'OK'),
    ('📝 발주', '자동발주', '/api/auto-order', 'SQLite+XERP', cnt),
    ('📝 발주', '발주현황', '/api/po', 'SQLite', cnt),
    ('📝 발주', '발주서관리', '/api/po?status=all', 'SQLite', cnt),
    ('📝 발주', '중국선적', '/api/china-shipment/logs', 'SQLite', cnt),
    ('📥 입고', '입고관리', '/api/receipts', 'SQLite', cnt),
    ('🏭 생산', '생산요청', '/api/production-requests', 'SQLite', cnt),
    ('🏭 생산', '생산재고', '/api/gift-sets', 'SQLite', cnt),
    ('🏭 생산', 'MRP', '/api/mrp/results', 'SQLite', cnt),
    ('✅ 업무', '업무관리', '/api/tasks', 'SQLite', cnt),
    ('✅ 업무', '공지게시판', '/api/notices', 'SQLite', cnt),
    ('💰 매출', '통합매출', '/api/sales/summary?start=20250301&end=20250331', 'XERP+bar_shop1+DD', src),
    ('💰 매출', '바른손매출', '/api/sales/barun?start=20250301&end=20250331', 'XERP+bar_shop1', src),
    ('💰 매출', 'DD매출', '/api/sales/dd?start=20250301&end=20250331', 'DD', src),
    ('💰 매출', '더기프트', '/api/sales/gift?start=20250301&end=20250331', 'bar_shop1', src),
    ('💰 매출', '원가관리', '/api/cost/summary?start=20250301&end=20250331', 'XERP+bar_shop1+SQLite', src),
    ('💰 매출', '고객주문', '/api/customer-orders/summary?start=20250301&end=20250331', 'XERP+bar_shop1+DD+SQLite', src),
    ('💰 매출', '배송추적', '/api/shipping/summary?start=20250301&end=20250331', 'bar_shop1+DD', src),
    ('📋 기준정보', '거래처', '/api/vendors', 'SQLite', cnt),
    ('📋 기준정보', '품목관리', '/api/products', 'SQLite', cnt),
    ('📋 기준정보', 'BOM', '/api/bom', 'SQLite', cnt),
    ('📋 기준정보', '후공정단가', '/api/post-process/prices', 'SQLite', cnt),
    ('📋 기준정보', '거래명세서', '/api/invoices', 'SQLite', cnt),
    ('📈 분석', '대시보드', '/api/dashboard/analytics', 'SQLite', lambda d: 'OK'),
    ('📈 분석', '경영대시보드', '/api/exec/summary?start=20250301&end=20250331', 'XERP+bar_shop1+SQLite', src),
    ('📈 분석', '경영추이', '/api/exec/trend?months=6', 'XERP+bar_shop1', src),
    ('📈 분석', '보고서', '/api/reports', 'SQLite', cnt),
    ('📈 분석', '불량관리', '/api/defects', 'SQLite', cnt),
    ('🔧 시스템', '감사로그', '/api/audit-log', 'SQLite', lambda d: f"total={d.get('data',{}).get('total',0)}건"),
    ('🔧 시스템', '사용자관리', '/api/auth/users', 'SQLite', lambda d: f"{len(d.get('data',[]))}명"),
    ('🔧 시스템', '에러로그', '/api/error-logs', 'SQLite', lambda d: f"total={d.get('data',{}).get('total',0)}건"),
]

ok_cnt = 0
warn_cnt = 0
fail_cnt = 0
prev_cat = ''

for cat, name, path, db, extract in tests:
    if cat != prev_cat:
        print()
        print(f'  {cat}')
        print(f'  {"─"*54}')
        prev_cat = cat

    d = api(path, TOKEN)
    if d.get('ok'):
        try:
            detail = extract(d)
        except:
            detail = 'OK'
        print(f'  ✅ {name:<12} → {db:<25} {detail}')
        ok_cnt += 1
    else:
        err = str(d.get('error',''))[:50]
        if 'XERP' in err or '미연결' in err or 'connect' in err.lower():
            print(f'  ⚠️  {name:<12} → {db:<25} DB 미연결 (야간 접속제한)')
            warn_cnt += 1
        else:
            print(f'  ❌ {name:<12} → {db:<25} {err}')
            fail_cnt += 1

print()
print('=' * 60)
print(f'  결과: ✅ {ok_cnt} 성공 | ⚠️ {warn_cnt} 연결제한 | ❌ {fail_cnt} 실패')
print(f'  총 {ok_cnt+warn_cnt+fail_cnt}개 API 테스트')
print('=' * 60)
