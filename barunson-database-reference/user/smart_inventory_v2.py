#!/usr/bin/env python3
"""스마트재고현황 v2 - ERP 화면 컬럼 전체 반영
경로: 물류관리 > 제품관리 > 수불현황 > 스마트재고현황

데이터 소스:
- mmInventory: 현재고(MF*), 중국재고(MT01), 이동재고(MT04)
- mmInoutItem: 매출량(SO), 이동재고 상세(MO/MI)
- mmRequisitItem: 요청량(미완료 건)
- bar_shop1 CARD: 카드구분, 상태, 마감단가, ERP소가 등
"""
import os, sys, json, pymssql
from datetime import datetime, timedelta
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

server = os.getenv('DB_SERVER')
port = int(os.getenv('DB_PORT', '1433'))
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')

# 날짜 파라미터 (기본: 오늘)
today = datetime.now().strftime('%Y%m%d')
sales_from = sys.argv[1] if len(sys.argv) > 1 else today
sales_to = sys.argv[2] if len(sys.argv) > 2 else today

print(f"=== 스마트재고현황 조회 ===")
print(f"매출일: {sales_from} ~ {sales_to}")
print()

# ── 1. mmInventory: 품목별 창고별 재고 ──
print("[1/4] mmInventory 재고 조회...")
conn_xerp = pymssql.connect(server=server, port=port, user=user, password=password,
                            database='XERP', charset='UTF-8')
cur = conn_xerp.cursor()

# 현재고 창고: MF01, MF02, MF03, MF15 (한국 주요 창고)
# 중국재고: MT01
# 이동재고: MT04
cur.execute("""
SELECT
    RTRIM(ItemCode) as ic,
    RTRIM(WhCode) as wh,
    CAST(OhQty AS BIGINT) as qty
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10'
  AND OhQty <> 0
""")

items = {}  # {ItemCode: {warehouses, 현재고, 중국재고, 이동재고}}
for row in cur:
    ic, wh, qty = row[0].strip(), row[1].strip(), row[2]
    if ic not in items:
        items[ic] = {
            'warehouses': {},
            'cur_stock': 0,    # 현재고 (MF 창고 합)
            'cn_stock': 0,     # 중국재고 (MT01)
            'transit_stock': 0, # 이동재고 (MT04)
        }
    items[ic]['warehouses'][wh] = qty

    if wh.startswith('MF'):
        items[ic]['cur_stock'] += qty
    elif wh == 'MT01':
        items[ic]['cn_stock'] += qty
    elif wh == 'MT04':
        items[ic]['transit_stock'] += qty

print(f"  재고 보유 품목: {len(items)}개")

# ── 2. mmInoutItem: 매출량 (SO=출고) ──
print(f"[2/4] 매출량 조회 ({sales_from}~{sales_to})...")
cur.execute("""
SELECT
    RTRIM(ItemCode) as ic,
    SUM(CAST(InoutQty AS BIGINT)) as total_qty
FROM mmInoutItem WITH (NOLOCK)
WHERE SiteCode = 'BK10'
  AND InoutGubun = 'SO'
  AND InoutDate >= %s AND InoutDate <= %s
GROUP BY ItemCode
""", (sales_from, sales_to))

sales_data = {}
for row in cur:
    sales_data[row[0].strip()] = row[1]
print(f"  매출 품목: {len(sales_data)}개")

# ── 3. mmRequisitItem: 요청량 (미완료 건) ──
print("[3/4] 요청량 조회 (미완료)...")
cur.execute("""
SELECT
    RTRIM(i.ItemCode) as ic,
    SUM(CAST(i.ReqQty AS BIGINT)) - SUM(CAST(i.OutQty AS BIGINT)) as pending_qty
FROM mmRequisitItem i WITH (NOLOCK)
WHERE i.SiteCode = 'BK10'
  AND i.ReqItemStatus <> 'C'
GROUP BY i.ItemCode
""")

req_data = {}
for row in cur:
    pending = row[1]
    if pending > 0:
        req_data[row[0].strip()] = pending
print(f"  요청 품목: {len(req_data)}개")

conn_xerp.close()

# ── 4. bar_shop1 CARD: 제품 마스터 정보 ──
print("[4/4] bar_shop1 제품 정보 조회...")
conn_shop = pymssql.connect(server=server, port=port, user=user, password=password,
                            database='bar_shop1', charset='UTF-8')
cur_shop = conn_shop.cursor()

cur_shop.execute("""
SELECT
    RTRIM(CAST(ERP_CODE AS NVARCHAR(50))) as erp_code,
    RTRIM(CAST(c.CARD_CODE AS NVARCHAR(50))) as card_code,
    RTRIM(CAST(c.CARD_NAME AS NVARCHAR(200))) as card_name,
    RTRIM(CAST(c.CARD_CATE AS NVARCHAR(50))) as card_cate,
    RTRIM(CAST(c.CARD_KIND AS NVARCHAR(50))) as card_kind,
    RTRIM(CAST(c.CARD_DIV AS NVARCHAR(50))) as card_div,
    CAST(c.CARD_PRICE AS INT) as card_price,
    CAST(c.CARD_SRC_PRICE AS INT) as src_price,
    RTRIM(CAST(c.PRODUCE_PLACE AS NVARCHAR(200))) as produce_place,
    CAST(c.JUMUN_YES_OR_NO AS NVARCHAR(10)) as jumun,
    CAST(c.DISPLAY_YES_OR_NO AS NVARCHAR(10)) as display,
    CAST(c.ISHAVE AS NVARCHAR(10)) as ishave,
    CAST(c.ISHAVE_NUM AS INT) as ishave_num,
    j.jaego as shop_jaego
FROM CARD c WITH (NOLOCK)
LEFT JOIN CARD_JAEGO j WITH (NOLOCK) ON CAST(c.CARD_CODE AS NVARCHAR(50)) = j.card_code
WHERE c.ERP_CODE IS NOT NULL AND LEN(RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50)))) > 0
""")

card_info = {}
for row in cur_shop:
    erp_code = (row[0] or '').strip()
    card_name = (row[2] or '').strip()
    # XSS 스크립트 제거
    if '<' in card_name:
        card_name = ''
    card_info[erp_code] = {
        'card_code': (row[1] or '').strip(),
        'card_name': card_name,
        'card_cate': (row[3] or '').strip(),
        'card_kind': (row[4] or '').strip(),
        'card_div': (row[5] or '').strip(),
        'card_price': row[6] or 0,       # ERP소가
        'src_price': row[7] or 0,         # 마감단가
        'produce_place': (row[8] or '').strip(),
        'jumun': (row[9] or '').strip(),  # 상태 (1=정상판매)
        'display': (row[10] or '').strip(),
        'ishave': (row[11] or '').strip(),
        'ishave_num': row[12] or 0,
        'shop_jaego': row[13] or 0,
    }
conn_shop.close()
print(f"  bar_shop1 제품: {len(card_info)}개")

# ── 데이터 병합 ──
# 카테고리 분류 맵
cate_map = {
    'WI': '청첩장', 'SN': '시즌카드', 'EN': '봉투', 'AC': '부속/악세서리',
    'BB': '돌잔치', 'GR': '감사장', 'FS': '식권', 'EV': '이벤트',
    'FP': '인쇄물', 'PH': '포토', 'ST': '스티커', 'PA': '보관함',
}

# 브랜드 추정 (품목코드 접두어 기반)
brand_map = {
    'BC': '바른손카드', 'BH': '비헨즈', 'BI': '초대장', 'BS': '바른손',
    'BN': '바른손(구)', 'SX': '바른손(구)', 'PE': '프리미어', 'DD': '더카드',
    'FS': '식권', 'se': '시즌', 'BE': '봉투',
}

# 상태 맵
status_map = {'1': '정상판매', '0': '판매중지'}

products = []
for ic, inv in items.items():
    card = card_info.get(ic, {})
    sales_qty = sales_data.get(ic, 0)
    req_qty = req_data.get(ic, 0)
    cur_stock = inv['cur_stock']
    avail_stock = cur_stock - req_qty  # 가용재고 = 현재고 - 요청량

    prefix = ic[:2]
    brand = brand_map.get(prefix, prefix)

    products.append({
        'item_code': ic,                          # 품목코드
        'brand': brand,                           # 브랜드 (추정)
        'card_cate': card.get('card_cate', ''),   # 카드구분
        'cate_name': cate_map.get(card.get('card_cate', ''), card.get('card_cate', '')),
        'status': status_map.get(card.get('jumun', ''), ''),  # 상태
        'card_name': card.get('card_name', ''),   # 품목명
        'src_price': card.get('src_price', 0),    # 마감단가
        'card_price': card.get('card_price', 0),  # ERP소가
        'shop_jaego': card.get('shop_jaego', 0),  # Shop재고
        'sales_qty': sales_qty,                   # 매출량
        'cur_stock': cur_stock,                   # 현재고 (MF 합계)
        'req_qty': req_qty,                       # 요청량
        'avail_stock': avail_stock,               # 가용재고
        'cn_stock': inv['cn_stock'],              # 중국재고 (MT01)
        'transit_stock': inv['transit_stock'],     # 이동재고 (MT04)
        'warehouses': inv['warehouses'],          # 창고별 상세
        'has_card_info': ic in card_info,         # bar_shop1 매칭 여부
    })

# 정렬: 매출량 많은 순
products.sort(key=lambda x: -x['sales_qty'])

# ── 요약 통계 ──
total_cur = sum(p['cur_stock'] for p in products)
total_cn = sum(p['cn_stock'] for p in products)
total_transit = sum(p['transit_stock'] for p in products)
total_sales = sum(p['sales_qty'] for p in products)
total_req = sum(p['req_qty'] for p in products)
matched = sum(1 for p in products if p['has_card_info'])

print(f"\n=== 결과 요약 ===")
print(f"총 품목: {len(products)}개 (bar_shop1 매칭: {matched}개)")
print(f"현재고 합계: {total_cur:,}")
print(f"중국재고 합계: {total_cn:,}")
print(f"이동재고 합계: {total_transit:,}")
print(f"매출량 합계: {total_sales:,}")
print(f"요청량 합계: {total_req:,}")

# 브랜드별 요약
print(f"\n브랜드별:")
brand_summary = {}
for p in products:
    b = p['brand']
    if b not in brand_summary:
        brand_summary[b] = {'count': 0, 'cur_stock': 0, 'sales': 0, 'cn': 0}
    brand_summary[b]['count'] += 1
    brand_summary[b]['cur_stock'] += p['cur_stock']
    brand_summary[b]['sales'] += p['sales_qty']
    brand_summary[b]['cn'] += p['cn_stock']

for b, s in sorted(brand_summary.items(), key=lambda x: -x[1]['count']):
    print(f"  {b}: {s['count']}품목, 현재고={s['cur_stock']:,}, 매출={s['sales']:,}, 중국={s['cn']:,}")

# Top 20 매출
print(f"\nTop 20 매출 품목:")
print(f"{'품목코드':<15} {'브랜드':<10} {'매출량':>8} {'현재고':>10} {'요청량':>8} {'가용재고':>10} {'중국재고':>10} {'이동재고':>10}")
print("-" * 90)
for p in products[:20]:
    print(f"{p['item_code']:<15} {p['brand']:<10} {p['sales_qty']:>8,} {p['cur_stock']:>10,} {p['req_qty']:>8,} {p['avail_stock']:>10,} {p['cn_stock']:>10,} {p['transit_stock']:>10,}")

# JSON 저장
output = {
    'filter': {
        'sales_from': sales_from,
        'sales_to': sales_to,
        'generated': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    },
    'summary': {
        'product_count': len(products),
        'matched_count': matched,
        'total_cur_stock': total_cur,
        'total_cn_stock': total_cn,
        'total_transit_stock': total_transit,
        'total_sales': total_sales,
        'total_req': total_req,
        'brand_summary': brand_summary,
    },
    'products': products,
}

out_path = os.path.join(os.path.dirname(__file__), 'smart_inventory_v2.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2, default=str)
print(f"\n데이터 저장: {out_path}")
