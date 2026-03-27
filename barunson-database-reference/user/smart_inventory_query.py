#!/usr/bin/env python3
"""스마트재고현황 조회 - 생산지:한국, 상태:정상판매"""
import os, sys, json, pymssql
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

server = os.getenv('DB_SERVER')
port = int(os.getenv('DB_PORT', '1433'))
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')

# Step 1: bar_shop1에서 한국 생산 + 정상판매 제품 목록
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
    j.jaego as shop_jaego
FROM CARD c WITH (NOLOCK)
LEFT JOIN CARD_JAEGO j WITH (NOLOCK) ON c.CARD_CODE = j.card_code
WHERE CAST(c.PRODUCE_PLACE AS NVARCHAR(200)) LIKE N'%한국%'
  AND c.JUMUN_YES_OR_NO = '1'
  AND c.ERP_CODE IS NOT NULL AND LEN(RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50)))) > 0
ORDER BY c.CARD_SEQ DESC
""")
card_map = {}
for row in cur1:
    erp_code = (row[0] or '').strip()
    if erp_code:
        card_map[erp_code] = {
            'erp_code': erp_code,
            'card_code': (row[1] or '').strip(),
            'card_name': (row[2] or '').strip(),
            'produce_place': (row[3] or '').strip(),
            'card_cate': (row[4] or '').strip(),
            'card_group': (row[5] or '').strip(),
            'card_price': row[6] or 0,
            'shop_jaego': row[7] or 0,
        }
conn1.close()
print(f"bar_shop1 한국+정상판매 제품: {len(card_map)}개")

if not card_map:
    # JUMUN_YES_OR_NO=1 조건 완화하여 재시도
    print("결과 없음. JUMUN 조건 완화하여 재시도...")
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
        CAST(c.JUMUN_YES_OR_NO AS NVARCHAR(10)) as jumun,
        CAST(c.DISPLAY_YES_OR_NO AS NVARCHAR(10)) as display_yn,
        CAST(c.CARD_PRICE AS INT) as card_price,
        j.jaego as shop_jaego
    FROM CARD c WITH (NOLOCK)
    LEFT JOIN CARD_JAEGO j WITH (NOLOCK) ON c.CARD_CODE = j.card_code
    WHERE CAST(c.PRODUCE_PLACE AS NVARCHAR(200)) LIKE N'%한국%'
      AND c.ERP_CODE IS NOT NULL AND LEN(RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50)))) > 0
    ORDER BY c.CARD_SEQ DESC
    """)
    for row in cur1:
        erp_code = (row[0] or '').strip()
        if erp_code:
            card_map[erp_code] = {
                'erp_code': erp_code,
                'card_code': (row[1] or '').strip(),
                'card_name': (row[2] or '').strip(),
                'produce_place': (row[3] or '').strip(),
                'card_cate': (row[4] or '').strip(),
                'jumun': (row[5] or '').strip(),
                'display_yn': (row[6] or '').strip(),
                'card_price': row[7] or 0,
                'shop_jaego': row[8] or 0,
            }
    conn1.close()
    print(f"bar_shop1 한국 전체 제품: {len(card_map)}개")

# Step 2: XERP mmInventory에서 해당 품목 재고 조회
conn2 = pymssql.connect(server=server, port=port, user=user, password=password,
                        database='XERP', charset='UTF-8')
cur2 = conn2.cursor()

# ERP_CODE 목록으로 재고 조회
erp_codes = list(card_map.keys())
print(f"\nXERP 재고 조회 대상 ERP코드: {len(erp_codes)}개")

# 전체 mmInventory에서 해당 품목 조회
# IN 절이 너무 길 수 있으므로 전체 재고 가져온 후 필터
cur2.execute("""
SELECT
    RTRIM(ItemCode) as item_code,
    RTRIM(WhCode) as wh_code,
    RTRIM(InvStatus) as inv_status,
    CAST(OhQty AS BIGINT) as oh_qty,
    CAST(OhAmnt AS BIGINT) as oh_amnt
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10'
  AND InvStatus = 'GOOD'
  AND OhQty > 0
ORDER BY ItemCode, WhCode
""")

inventory = []
matched = 0
unmatched_items = set()
for row in cur2:
    item_code = (row[0] or '').strip()
    if item_code in card_map:
        matched += 1
        inventory.append({
            'item_code': item_code,
            'wh_code': (row[1] or '').strip(),
            'inv_status': (row[2] or '').strip(),
            'oh_qty': row[3],
            'oh_amnt': row[4],
            'card_code': card_map[item_code]['card_code'],
            'card_name': card_map[item_code]['card_name'],
            'produce_place': card_map[item_code]['produce_place'],
            'card_cate': card_map[item_code]['card_cate'],
            'card_price': card_map[item_code]['card_price'],
            'shop_jaego': card_map[item_code].get('shop_jaego', 0),
        })

conn2.close()
print(f"XERP 매칭 재고 레코드: {matched}건")

# 품목별 합산
item_summary = {}
for inv in inventory:
    key = inv['item_code']
    if key not in item_summary:
        item_summary[key] = {
            'item_code': key,
            'card_code': inv['card_code'],
            'card_name': inv['card_name'],
            'produce_place': inv['produce_place'],
            'card_cate': inv['card_cate'],
            'card_price': inv['card_price'],
            'shop_jaego': inv['shop_jaego'],
            'warehouses': {},
            'total_qty': 0,
            'total_amnt': 0,
        }
    item_summary[key]['warehouses'][inv['wh_code']] = {
        'qty': inv['oh_qty'],
        'amnt': inv['oh_amnt'],
    }
    item_summary[key]['total_qty'] += inv['oh_qty']
    item_summary[key]['total_amnt'] += inv['oh_amnt']

print(f"품목 수: {len(item_summary)}개")
print(f"총 재고 수량: {sum(v['total_qty'] for v in item_summary.values()):,}")

# JSON 저장
output = {
    'filter': {'produce_place': '한국', 'status': '정상판매'},
    'summary': {
        'item_count': len(item_summary),
        'total_qty': sum(v['total_qty'] for v in item_summary.values()),
        'total_amnt': sum(v['total_amnt'] for v in item_summary.values()),
    },
    'items': sorted(item_summary.values(), key=lambda x: -x['total_qty']),
    'detail': inventory,
}

out_path = os.path.join(os.path.dirname(__file__), 'smart_inventory_data.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(output, f, ensure_ascii=False, indent=2)
print(f"\n저장: {out_path}")

# 상위 20개 출력
print("\n=== 상위 20 품목 (재고수량 기준) ===")
for item in sorted(item_summary.values(), key=lambda x: -x['total_qty'])[:20]:
    wh_str = ', '.join(f"{k}:{v['qty']:,}" for k, v in item['warehouses'].items())
    print(f"  {item['item_code']:12s} | {item['card_cate']:4s} | 총:{item['total_qty']:>10,} | 창고: {wh_str}")
