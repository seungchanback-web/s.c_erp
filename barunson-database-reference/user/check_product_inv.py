#!/usr/bin/env python3
"""완제품 재고 테이블 탐색"""
import os, sys, pymssql
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

server = os.getenv('DB_SERVER')
port = int(os.getenv('DB_PORT', '1433'))
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')

conn = pymssql.connect(server=server, port=port, user=user, password=password,
                       database='XERP', charset='UTF-8')
cur = conn.cursor()

# sdShopInventory 컬럼 구조
print("=== sdShopInventory 컬럼 ===")
cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sdShopInventory' ORDER BY ORDINAL_POSITION")
for row in cur:
    print(f"  {row[0]} ({row[1]})")

# sdShopInventory 샘플
print("\n=== sdShopInventory 샘플 ===")
cur.execute("SELECT TOP 10 * FROM sdShopInventory WITH (NOLOCK)")
cols = [c[0] for c in cur.description]
print("  " + " | ".join(cols))
for row in cur:
    print("  " + " | ".join(str(v).strip() if v else '' for v in row))

# sdShopInventory에서 BN 품목 검색
print("\n=== sdShopInventory BN 품목 ===")
cur.execute("""
SELECT TOP 20 * FROM sdShopInventory WITH (NOLOCK)
WHERE ItemCode LIKE 'BN%' AND OhQty > 0
ORDER BY OhQty DESC
""")
if cur.description:
    cols = [c[0] for c in cur.description]
    for row in cur:
        print("  " + " | ".join(str(v).strip() if v else '' for v in row))

# sdShopInvMonth 컬럼
print("\n=== sdShopInvMonth 컬럼 ===")
cur.execute("SELECT COLUMN_NAME, DATA_TYPE FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_NAME = 'sdShopInvMonth' ORDER BY ORDINAL_POSITION")
for row in cur:
    print(f"  {row[0]} ({row[1]})")

# mmInventory에서 BN 품목이 있는지 (재고 0 포함)
print("\n=== mmInventory BN 품목 (재고 0 포함) ===")
cur.execute("""
SELECT TOP 20 RTRIM(ItemCode) as ic, RTRIM(WhCode) as wh, RTRIM(InvStatus) as st,
    CAST(OhQty AS BIGINT) as qty
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND ItemCode LIKE 'BN%'
""")
for row in cur:
    print(f"  Item={row[0]}, WH={row[1]}, Status={row[2]}, Qty={row[3]}")

# mmInoutItem에서 BN 품목 최근 입출고 확인
print("\n=== mmInoutItem BN 최근 입출고 ===")
cur.execute("""
SELECT TOP 20 RTRIM(ItemCode) as ic, RTRIM(ItemName) as nm,
    InoutDate, RTRIM(WhCode) as wh, CAST(InoutQty AS BIGINT) as qty
FROM mmInoutItem WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND ItemCode LIKE 'BN%'
  AND InoutDate >= '20250101'
ORDER BY InoutDate DESC
""")
for row in cur:
    print(f"  {row[0]} | {row[1]} | {row[2]} | WH={row[3]} | Qty={row[4]}")

# ERP_SalesData에서 BN 품목 확인
print("\n=== ERP_SalesData BN 최근 데이터 ===")
cur.execute("""
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'ERP_SalesData'
ORDER BY ORDINAL_POSITION
""")
print("  Columns: " + ", ".join(row[0] for row in cur))

conn.close()
