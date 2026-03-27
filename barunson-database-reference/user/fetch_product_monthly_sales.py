#!/usr/bin/env python3
"""XERP mmInoutItem(출고)에서 품목별 월별 판매량 추출 → product_monthly_sales.json
월별 분할 쿼리 + 재연결 로직으로 타임아웃 방지"""
import sys, os, json, pymssql, time
from datetime import datetime
from dotenv import load_dotenv

load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

def get_conn():
    return pymssql.connect(
        server=os.getenv("DB_SERVER"),
        port=int(os.getenv("DB_PORT", "1433")),
        user=os.getenv("DB_USER"),
        password=os.getenv("DB_PASSWORD"),
        database="XERP",
        timeout=300,
        login_timeout=30,
    )

print("품목별 월별 판매량 추출 시작 (2024-01 ~ 2025-12)...", file=sys.stderr)

# 기존 파일이 있으면 이어서 진행
out_path = os.path.join(os.path.dirname(__file__), 'product_monthly_sales.json')
products = {}
done_months = set()
try:
    with open(out_path, 'r', encoding='utf-8') as f:
        existing = json.load(f)
        products = existing.get('products', {})
        # 어떤 월이 이미 완료되었는지 확인
        for code, years in products.items():
            for yr, months in years.items():
                for mm in months:
                    done_months.add(f"{yr}{mm}")
            break  # 첫 품목만 확인하면 충분
except:
    pass

if done_months:
    print(f"  기존 데이터 발견: {len(products)} 품목, {len(done_months)} 월 완료", file=sys.stderr)

total_rows = 0
conn = None

for year in [2024, 2025]:
    for month in range(1, 13):
        ym_key = f"{year}{month:02d}"

        # 이미 해당 월 데이터가 있으면 스킵
        if ym_key in done_months:
            print(f"  {year}-{month:02d}: 스킵 (이미 추출됨)", file=sys.stderr)
            continue

        start = f"{year}{month:02d}01"
        if month == 12:
            end = f"{year+1}0101"
        else:
            end = f"{year}{month+1:02d}01"

        # 재연결
        for attempt in range(3):
            try:
                if conn is None:
                    conn = get_conn()
                cursor = conn.cursor()
                sql = f"""
                SELECT RTRIM(ItemCode) AS code, SUM(InoutQty) AS qty
                FROM mmInoutItem WITH (NOLOCK)
                WHERE InoutDate >= '{start}' AND InoutDate < '{end}'
                  AND InoutGubun = 'SO'
                GROUP BY RTRIM(ItemCode)
                """
                cursor.execute(sql)
                rows = cursor.fetchall()
                break
            except Exception as e:
                print(f"  {year}-{month:02d}: 시도 {attempt+1} 실패 - {e}", file=sys.stderr)
                try:
                    conn.close()
                except:
                    pass
                conn = None
                if attempt < 2:
                    time.sleep(5)
                else:
                    raise

        row_count = 0
        for code, qty in rows:
            if not code:
                continue
            code = code.strip()
            if not code:
                continue
            q = int(qty) if qty else 0
            if q <= 0:
                continue
            if code not in products:
                products[code] = {}
            yr = str(year)
            if yr not in products[code]:
                products[code][yr] = {}
            products[code][yr][f"{month:02d}"] = q
            row_count += 1

        total_rows += row_count
        print(f"  {year}-{month:02d}: {row_count:,} 품목", file=sys.stderr)

        # 매월 중간 저장
        result = {
            "meta": {
                "extracted": datetime.now().strftime("%Y-%m-%d %H:%M"),
                "period": "2024-01 ~ 2025-12",
                "product_count": len(products),
            },
            "products": products,
        }
        with open(out_path, 'w', encoding='utf-8') as f:
            json.dump(result, f, ensure_ascii=False)

try:
    conn.close()
except:
    pass

print(f"완료! 총 품목 수: {len(products):,}", file=sys.stderr)

# 샘플 출력
sample_codes = list(products.keys())[:5]
for code in sample_codes:
    print(f"  {code}: {json.dumps(products[code], ensure_ascii=False)}", file=sys.stderr)
