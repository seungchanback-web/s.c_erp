#!/usr/bin/env python3
"""스마트재고현황 - 생산지:한국, 상태:정상판매
결합: bar_shop1 CARD+CARD_JAEGO + XERP mmInventory
"""
import os, sys, json, pymssql
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

server = os.getenv('DB_SERVER')
port = int(os.getenv('DB_PORT', '1433'))
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')

# Step 1: bar_shop1에서 한국 생산 + 정상판매 제품 + 쇼핑몰 재고
print("[1/3] bar_shop1 제품 정보 조회...")
conn1 = pymssql.connect(server=server, port=port, user=user, password=password,
                        database='bar_shop1', charset='UTF-8')
cur1 = conn1.cursor()

cur1.execute("""
SELECT
    RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50))) as erp_code,
    RTRIM(CAST(c.CARD_CODE AS NVARCHAR(50))) as card_code,
    RTRIM(CAST(c.CARD_NAME AS NVARCHAR(200))) as card_name,
    RTRIM(CAST(c.PRODUCE_PLACE AS NVARCHAR(200))) as produce_place,
    RTRIM(CAST(c.CARD_CATE AS NVARCHAR(50))) as card_cate,
    RTRIM(CAST(c.CARD_GROUP AS NVARCHAR(50))) as card_group,
    CAST(c.CARD_PRICE AS INT) as card_price,
    CAST(c.CARD_SRC_PRICE AS INT) as src_price,
    CAST(c.ISHAVE AS NVARCHAR(10)) as ishave,
    CAST(c.ISHAVE_NUM AS INT) as ishave_num,
    j.jaego as shop_jaego,
    RTRIM(CAST(c.CARD_SIZE AS NVARCHAR(50))) as card_size,
    RTRIM(CAST(c.CARD_PAPER AS NVARCHAR(100))) as card_paper,
    c.CARD_SEQ as card_seq
FROM CARD c WITH (NOLOCK)
LEFT JOIN CARD_JAEGO j WITH (NOLOCK) ON c.CARD_CODE = j.card_code
WHERE CAST(c.PRODUCE_PLACE AS NVARCHAR(200)) LIKE N'%한국%'
  AND c.JUMUN_YES_OR_NO = '1'
  AND c.ERP_CODE IS NOT NULL AND LEN(RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50)))) > 0
ORDER BY c.CARD_SEQ DESC
""")

products = []
erp_codes = set()
for row in cur1:
    erp_code = (row[0] or '').strip()
    card_name = (row[2] or '').strip()
    # XSS 스크립트 제거
    if '<' in card_name:
        card_name = ''
    products.append({
        'erp_code': erp_code,
        'card_code': (row[1] or '').strip(),
        'card_name': card_name,
        'produce_place': (row[3] or '').strip(),
        'card_cate': (row[4] or '').strip(),
        'card_group': (row[5] or '').strip(),
        'card_price': row[6] or 0,
        'src_price': row[7] or 0,
        'ishave': (row[8] or '').strip(),
        'ishave_num': row[9] or 0,
        'shop_jaego': row[10] or 0,
        'card_size': (row[11] or '').strip(),
        'card_paper': (row[12] or '').strip(),
        'card_seq': row[13] or 0,
    })
    erp_codes.add(erp_code)
conn1.close()
print(f"  제품 수: {len(products)}개")

# Step 2: XERP mmInventory에서 ERP 재고 조회
print("[2/3] XERP 재고 조회...")
conn2 = pymssql.connect(server=server, port=port, user=user, password=password,
                        database='XERP', charset='UTF-8')
cur2 = conn2.cursor()

# BN, SX 등 한국 생산 제품의 mmInventory 재고
erp_inv = {}
cur2.execute("""
SELECT RTRIM(ItemCode) as ic, RTRIM(WhCode) as wh, RTRIM(InvStatus) as st,
    CAST(OhQty AS BIGINT) as qty, CAST(OhAmnt AS BIGINT) as amnt
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10'
  AND (ItemCode LIKE 'BN%' OR ItemCode LIKE 'SX%')
""")
for row in cur2:
    ic = (row[0] or '').strip()
    if ic in erp_codes:
        if ic not in erp_inv:
            erp_inv[ic] = {'total_qty': 0, 'total_amnt': 0, 'warehouses': {}}
        wh = (row[1] or '').strip()
        qty = row[3] or 0
        amnt = row[4] or 0
        erp_inv[ic]['warehouses'][wh] = {'qty': qty, 'amnt': amnt, 'status': (row[2] or '').strip()}
        erp_inv[ic]['total_qty'] += qty
        erp_inv[ic]['total_amnt'] += amnt

print(f"  ERP 재고 매칭: {len(erp_inv)}개 품목")
conn2.close()

# Step 3: 카테고리 분류 맵
cate_map = {
    'WI': '청첩장', 'SN': '시즌카드', 'EN': '봉투', 'AC': '부속/악세서리',
    'BB': '돌잔치', 'GR': '감사장', 'FS': '식권', 'EV': '이벤트',
    'FP': '인쇄물', 'PH': '포토', 'ST': '스티커', 'PA': '보관함',
}

# 데이터 합치기
for p in products:
    ec = p['erp_code']
    inv = erp_inv.get(ec, {'total_qty': 0, 'total_amnt': 0, 'warehouses': {}})
    p['erp_qty'] = inv['total_qty']
    p['erp_amnt'] = inv['total_amnt']
    p['warehouses'] = inv['warehouses']
    p['cate_name'] = cate_map.get(p['card_cate'], p['card_cate'])

# 요약 통계
total_shop = sum(p['shop_jaego'] for p in products)
total_erp = sum(p['erp_qty'] for p in products)
cate_summary = {}
for p in products:
    cn = p['cate_name']
    if cn not in cate_summary:
        cate_summary[cn] = {'count': 0, 'shop_jaego': 0, 'erp_qty': 0}
    cate_summary[cn]['count'] += 1
    cate_summary[cn]['shop_jaego'] += p['shop_jaego']
    cate_summary[cn]['erp_qty'] += p['erp_qty']

print(f"\n[3/3] 결과 요약")
print(f"  총 제품: {len(products)}개")
print(f"  쇼핑몰 총재고: {total_shop:,}")
print(f"  ERP 총재고: {total_erp:,}")
print(f"\n카테고리별:")
for cn, s in sorted(cate_summary.items(), key=lambda x: -x[1]['count']):
    print(f"  {cn}: {s['count']}개 제품, 쇼핑몰재고={s['shop_jaego']:,}, ERP재고={s['erp_qty']:,}")

# JSON 저장
output = {
    'filter': {'produce_place': '한국', 'status': '정상판매 (JUMUN=1)'},
    'generated': '2026-03-13',
    'summary': {
        'product_count': len(products),
        'total_shop_jaego': total_shop,
        'total_erp_qty': total_erp,
        'categories': cate_summary,
    },
    'products': products,
}

out_path = os.path.join(os.path.dirname(__file__), 'smart_inventory_data.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f"\n데이터 저장: {out_path}")
