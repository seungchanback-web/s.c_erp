#!/usr/bin/env python3
"""스마트재고현황 조회 - XERP mmInventory + bar_shop1 CARD 매핑"""
import os, sys, json, pymssql
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

server = os.getenv('DB_SERVER')
port = int(os.getenv('DB_PORT', '1433'))
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')

# Step 1: bar_shop1에서 CARD 정보 (생산지, 상태) 조회
conn1 = pymssql.connect(server=server, port=port, user=user, password=password, database='bar_shop1')
cur1 = conn1.cursor()

# 먼저 PRODUCE_PLACE와 상태 관련 값 확인
cur1.execute("""
SELECT DISTINCT RTRIM(PRODUCE_PLACE) as place
FROM CARD WITH (NOLOCK)
WHERE PRODUCE_PLACE IS NOT NULL AND LEN(RTRIM(PRODUCE_PLACE)) > 0
""")
places = [row[0] for row in cur1]
print("=== 생산지 목록 ===")
for p in places:
    print(f"  - '{p}'")

# DISPLAY_YES_OR_NO, JUMUN_YES_OR_NO 등 상태 확인
cur1.execute("""
SELECT DISTINCT
    RTRIM(DISPLAY_YES_OR_NO) as display_yn,
    RTRIM(JUMUN_YES_OR_NO) as jumun_yn,
    COUNT(*) as cnt
FROM CARD WITH (NOLOCK)
GROUP BY RTRIM(DISPLAY_YES_OR_NO), RTRIM(JUMUN_YES_OR_NO)
ORDER BY cnt DESC
""")
print("\n=== 상태 조합 (DISPLAY_YES_OR_NO / JUMUN_YES_OR_NO) ===")
for row in cur1:
    print(f"  DISPLAY={row[0]}, JUMUN={row[1]}, count={row[2]}")

# ISHAVE 확인
cur1.execute("""
SELECT DISTINCT RTRIM(ISHAVE) as ishave, COUNT(*) as cnt
FROM CARD WITH (NOLOCK)
GROUP BY RTRIM(ISHAVE)
ORDER BY cnt DESC
""")
print("\n=== ISHAVE 값 ===")
for row in cur1:
    print(f"  ISHAVE={row[0]}, count={row[1]}")

# ERP_CODE와 CARD_CODE 매핑 확인
cur1.execute("""
SELECT TOP 10
    RTRIM(CARD_CODE) as card_code,
    RTRIM(ERP_CODE) as erp_code,
    RTRIM(CARD_NAME) as card_name,
    RTRIM(PRODUCE_PLACE) as produce_place,
    RTRIM(DISPLAY_YES_OR_NO) as display_yn,
    RTRIM(JUMUN_YES_OR_NO) as jumun_yn,
    RTRIM(ISHAVE) as ishave
FROM CARD WITH (NOLOCK)
WHERE ERP_CODE IS NOT NULL AND LEN(RTRIM(ERP_CODE)) > 0
ORDER BY CARD_SEQ DESC
""")
print("\n=== CARD 샘플 (ERP_CODE 매핑) ===")
for row in cur1:
    print(f"  CARD_CODE={row[0]}, ERP_CODE={row[1]}, NAME={row[2]}, PLACE={row[3]}, DISP={row[4]}, JUMUN={row[5]}, ISHAVE={row[6]}")

conn1.close()

# Step 2: XERP mmInventory 현재 재고 확인
conn2 = pymssql.connect(server=server, port=port, user=user, password=password, database='XERP')
cur2 = conn2.cursor()

cur2.execute("""
SELECT TOP 10
    RTRIM(WhCode) as wh,
    RTRIM(InvStatus) as status,
    RTRIM(ItemCode) as item_code,
    CAST(OhQty AS BIGINT) as qty,
    CAST(OhAmnt AS BIGINT) as amnt
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND OhQty > 0
ORDER BY OhQty DESC
""")
print("\n=== mmInventory 샘플 (상위 10) ===")
for row in cur2:
    print(f"  WH={row[0]}, Status={row[1]}, Item={row[2]}, Qty={row[3]}, Amnt={row[4]}")

conn2.close()
print("\nDone.")
