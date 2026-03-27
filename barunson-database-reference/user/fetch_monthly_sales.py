#!/usr/bin/env python3
"""XERP DB에서 월별 출고량(매출) 조회 → monthly_sales.json 생성"""
import sys, os, json, pymssql
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

conn = pymssql.connect(
    server=os.getenv("DB_SERVER"),
    port=int(os.getenv("DB_PORT", "1433")),
    user=os.getenv("DB_USER"),
    password=os.getenv("DB_PASSWORD"),
    database="XERP",
)
cursor = conn.cursor()

result = {}  # { "2024": {"01": qty, "02": qty, ...}, "2025": {...} }

for year in [2024, 2025]:
    year_data = {}
    for month in range(1, 13):
        start = f"{year}{month:02d}01"
        if month == 12:
            end = f"{year+1}0101"
        else:
            end = f"{year}{month+1:02d}01"

        sql = f"""
            SELECT ISNULL(SUM(InoutQty), 0)
            FROM mmInoutItem WITH (NOLOCK)
            WHERE InoutDate >= '{start}' AND InoutDate < '{end}'
              AND InoutGubun = 'SI'
        """
        cursor.execute(sql)
        row = cursor.fetchone()
        qty = float(row[0]) if row and row[0] else 0
        year_data[f"{month:02d}"] = int(qty)
        print(f"  {year}-{month:02d}: {int(qty):,}", file=sys.stderr)

    result[str(year)] = year_data

# 2026년 진행중 월도 포함
year_data_2026 = {}
for month in range(1, 4):  # 1~3월
    start = f"2026{month:02d}01"
    if month == 3:
        end = "20260401"
    else:
        end = f"2026{month+1:02d}01"

    sql = f"""
        SELECT ISNULL(SUM(InoutQty), 0)
        FROM mmInoutItem WITH (NOLOCK)
        WHERE InoutDate >= '{start}' AND InoutDate < '{end}'
          AND InoutGubun = 'SI'
    """
    cursor.execute(sql)
    row = cursor.fetchone()
    qty = float(row[0]) if row and row[0] else 0
    year_data_2026[f"{month:02d}"] = int(qty)
    print(f"  2026-{month:02d}: {int(qty):,}", file=sys.stderr)

result["2026"] = year_data_2026

conn.close()

out_path = os.path.join(os.path.dirname(__file__), 'monthly_sales.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(result, f, ensure_ascii=False, indent=2)

print(f"저장 완료: {out_path}")
print(json.dumps(result, ensure_ascii=False, indent=2))
