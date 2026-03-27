#!/usr/bin/env python3
"""스마트재고현황 - 데이터 탐색 (인코딩 수정)"""
import os, sys, pymssql
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

server = os.getenv('DB_SERVER')
port = int(os.getenv('DB_PORT', '1433'))
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')

conn = pymssql.connect(server=server, port=port, user=user, password=password,
                       database='bar_shop1', charset='UTF-8')
cur = conn.cursor()

# PRODUCE_PLACE 값 확인 (NVARCHAR로 캐스팅)
cur.execute("""
SELECT DISTINCT CAST(PRODUCE_PLACE AS NVARCHAR(200)) as place, COUNT(*) as cnt
FROM CARD WITH (NOLOCK)
WHERE PRODUCE_PLACE IS NOT NULL AND LEN(RTRIM(CAST(PRODUCE_PLACE AS NVARCHAR(200)))) > 0
GROUP BY CAST(PRODUCE_PLACE AS NVARCHAR(200))
ORDER BY cnt DESC
""")
print("=== 생산지 목록 ===")
for row in cur:
    place = row[0].strip() if row[0] else ''
    print(f"  '{place}' (count={row[1]})")

# JUMUN_YES_OR_NO 의미 확인
print("\n=== JUMUN_YES_OR_NO 값별 제품수 ===")
cur.execute("""
SELECT RTRIM(CAST(JUMUN_YES_OR_NO AS NVARCHAR(10))) as j, COUNT(*) as cnt
FROM CARD WITH (NOLOCK)
GROUP BY RTRIM(CAST(JUMUN_YES_OR_NO AS NVARCHAR(10)))
ORDER BY cnt DESC
""")
for row in cur:
    print(f"  JUMUN={row[0]}, count={row[1]}")

# 한국 생산 + 정상판매(DISPLAY=1, JUMUN=1) 제품 샘플
print("\n=== 한국 생산 + 정상판매 샘플 ===")
cur.execute("""
SELECT TOP 20
    RTRIM(CAST(CARD_CODE AS NVARCHAR(50))) as card_code,
    RTRIM(CAST(ERP_CODE AS NVARCHAR(50))) as erp_code,
    RTRIM(CAST(CARD_NAME AS NVARCHAR(200))) as card_name,
    RTRIM(CAST(PRODUCE_PLACE AS NVARCHAR(200))) as produce_place,
    RTRIM(CAST(CARD_GROUP AS NVARCHAR(50))) as card_group,
    RTRIM(CAST(CARD_CATE AS NVARCHAR(50))) as card_cate
FROM CARD WITH (NOLOCK)
WHERE CAST(PRODUCE_PLACE AS NVARCHAR(200)) LIKE N'%한국%'
  AND DISPLAY_YES_OR_NO = '1' AND JUMUN_YES_OR_NO = '1'
ORDER BY CARD_SEQ DESC
""")
rows = cur.fetchall()
print(f"  Found {len(rows)} rows")
for row in rows:
    print(f"  CODE={row[0]}, ERP={row[1]}, NAME={row[2][:40] if row[2] else ''}, PLACE={row[3]}, GROUP={row[4]}, CATE={row[5]}")

# 한국 생산이 아닌 다른 방식 - PRODUCE_PLACE 전체 값 다시 확인
print("\n=== PRODUCE_PLACE raw bytes 확인 ===")
cur.execute("""
SELECT TOP 5 PRODUCE_PLACE,
    CAST(PRODUCE_PLACE AS NVARCHAR(200)) as nplace,
    CAST(PRODUCE_PLACE AS VARBINARY(200)) as bplace
FROM CARD WITH (NOLOCK)
WHERE PRODUCE_PLACE IS NOT NULL AND LEN(RTRIM(PRODUCE_PLACE)) > 2
""")
for row in cur:
    print(f"  raw={row[0]}, nvarchar={row[1]}, binary={row[2]}")

conn.close()
