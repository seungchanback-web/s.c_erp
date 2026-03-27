#!/usr/bin/env python3
"""ERP_CODE vs ItemCode 매칭 확인"""
import os, sys, pymssql
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

server = os.getenv('DB_SERVER')
port = int(os.getenv('DB_PORT', '1433'))
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')

# bar_shop1 ERP_CODE 샘플
conn1 = pymssql.connect(server=server, port=port, user=user, password=password,
                        database='bar_shop1', charset='UTF-8')
cur1 = conn1.cursor()
cur1.execute("""
SELECT TOP 20 RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50))) as erp_code,
    RTRIM(CAST(c.CARD_CODE AS NVARCHAR(50))) as card_code
FROM CARD c WITH (NOLOCK)
WHERE CAST(c.PRODUCE_PLACE AS NVARCHAR(200)) LIKE N'%한국%'
  AND c.JUMUN_YES_OR_NO = '1'
  AND c.ERP_CODE IS NOT NULL AND LEN(RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50)))) > 0
ORDER BY c.CARD_SEQ DESC
""")
erp_codes = []
print("=== bar_shop1 ERP_CODE 샘플 ===")
for row in cur1:
    erp_code = (row[0] or '').strip()
    card_code = (row[1] or '').strip()
    print(f"  ERP_CODE='{erp_code}' (len={len(erp_code)}), CARD_CODE='{card_code}'")
    erp_codes.append(erp_code)
conn1.close()

# XERP mmInventory ItemCode 샘플
conn2 = pymssql.connect(server=server, port=port, user=user, password=password,
                        database='XERP', charset='UTF-8')
cur2 = conn2.cursor()
cur2.execute("""
SELECT TOP 20 RTRIM(ItemCode) as item_code, CAST(OhQty AS BIGINT) as qty
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND InvStatus = 'GOOD' AND OhQty > 0
ORDER BY OhQty DESC
""")
print("\n=== XERP mmInventory ItemCode 샘플 ===")
inv_codes = []
for row in cur2:
    item_code = (row[0] or '').strip()
    print(f"  ItemCode='{item_code}' (len={len(item_code)}), Qty={row[1]}")
    inv_codes.append(item_code)

# 특정 ERP_CODE로 직접 검색
if erp_codes:
    test_code = erp_codes[0]
    print(f"\n=== '{test_code}'로 mmInventory 검색 ===")
    cur2.execute(f"SELECT RTRIM(ItemCode), CAST(OhQty AS BIGINT) FROM mmInventory WITH (NOLOCK) WHERE SiteCode = 'BK10' AND RTRIM(ItemCode) = '{test_code}'")
    rows = cur2.fetchall()
    print(f"  결과: {len(rows)}건")

    # LIKE로 검색
    cur2.execute(f"SELECT RTRIM(ItemCode), CAST(OhQty AS BIGINT) FROM mmInventory WITH (NOLOCK) WHERE SiteCode = 'BK10' AND ItemCode LIKE '{test_code}%'")
    rows = cur2.fetchall()
    print(f"  LIKE 결과: {len(rows)}건")
    for r in rows:
        print(f"    '{r[0].strip()}' qty={r[1]}")

# ERP_CODE가 mmInventory의 ItemCode와 어떻게 다른지 확인
# BN으로 시작하는 품목 확인
print("\n=== mmInventory에서 BN으로 시작하는 품목 ===")
cur2.execute("""
SELECT TOP 20 RTRIM(ItemCode) as item_code, RTRIM(WhCode) as wh, CAST(OhQty AS BIGINT) as qty
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND ItemCode LIKE 'BN%' AND OhQty > 0
ORDER BY OhQty DESC
""")
for row in cur2:
    print(f"  ItemCode='{row[0].strip()}', WH={row[1].strip()}, Qty={row[2]}")

conn2.close()
