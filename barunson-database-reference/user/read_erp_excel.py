#!/usr/bin/env python3
"""ERP 스마트재고현황 엑셀(HTML) 파일 읽기
ERP에서 내보낸 .xls는 실제 HTML 테이블 형식
"""
import sys, json, os, re
from html.parser import HTMLParser
sys.stdout.reconfigure(encoding='utf-8')

xls_path = sys.argv[1] if len(sys.argv) > 1 else r'C:\Users\bungb\Downloads\스마트재고현황.xls'

# HTML 파싱
class TableParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.tables = []
        self.current_table = None
        self.current_row = None
        self.current_cell = ''
        self.in_cell = False
        self.cell_tag = None

    def handle_starttag(self, tag, attrs):
        tag = tag.lower()
        if tag == 'table':
            self.current_table = []
        elif tag in ('td', 'th'):
            self.in_cell = True
            self.current_cell = ''
            self.cell_tag = tag
        elif tag == 'tr':
            self.current_row = []

    def handle_endtag(self, tag):
        tag = tag.lower()
        if tag == 'table' and self.current_table is not None:
            self.tables.append(self.current_table)
            self.current_table = None
        elif tag in ('td', 'th') and self.in_cell:
            self.in_cell = False
            if self.current_row is not None:
                self.current_row.append(self.current_cell.strip())
        elif tag == 'tr' and self.current_row is not None:
            if self.current_table is not None:
                self.current_table.append(self.current_row)
            self.current_row = None

    def handle_data(self, data):
        if self.in_cell:
            self.current_cell += data

# 파일 읽기
with open(xls_path, 'r', encoding='utf-8-sig') as f:
    html = f.read()

parser = TableParser()
parser.feed(html)

print(f"테이블 수: {len(parser.tables)}")
for i, t in enumerate(parser.tables):
    print(f"  테이블 {i}: {len(t)}행")
    if t and len(t) > 0:
        print(f"    첫 행: {t[0][:10]}...")

# 메인 테이블 찾기 (가장 큰 테이블)
main_table = max(parser.tables, key=len) if parser.tables else []
print(f"\n메인 테이블: {len(main_table)}행")

if not main_table:
    print("테이블을 찾을 수 없습니다")
    sys.exit(1)

# 헤더 찾기
header_row_idx = 0
for i, row in enumerate(main_table[:10]):
    if any('품목코드' in str(c) for c in row):
        header_row_idx = i
        break

headers = [c.strip() for c in main_table[header_row_idx]]
print(f"헤더 행({header_row_idx}): {headers}")
print(f"컬럼 수: {len(headers)}")

# 데이터 파싱
products = []
for r in range(header_row_idx + 1, len(main_table)):
    row = main_table[r]
    if len(row) < len(headers):
        row += [''] * (len(headers) - len(row))

    item = {}
    for c, h in enumerate(headers):
        if h and c < len(row):
            val = row[c].strip()
            # 숫자 변환 시도
            if h in ('마감단가', 'ERP소가', 'shop세트', '매출량', '현재고', '요청량',
                     '가용재고', '미생산량', '중국재고', '이동재고',
                     '1개월매출', '3개월매출', '6개월매출', '12개월매출'):
                try:
                    val = float(val.replace(',', '')) if val else 0
                    if val == int(val):
                        val = int(val)
                except:
                    pass
            item[h] = val

    if item.get('품목코드'):
        products.append(item)

print(f"\n제품 수: {len(products)}개")

# 요약
if products:
    # 브랜드별
    brands = {}
    for p in products:
        b = p.get('브랜드', '(없음)')
        brands[b] = brands.get(b, 0) + 1
    print(f"\n브랜드별:")
    for b, cnt in sorted(brands.items(), key=lambda x: -x[1])[:15]:
        print(f"  {b}: {cnt}개")

    # 상태별
    statuses = {}
    for p in products:
        s = p.get('상태', '(없음)')
        statuses[s] = statuses.get(s, 0) + 1
    print(f"\n상태별: {statuses}")

    # 샘플
    print(f"\n샘플 5개:")
    for p in products[:5]:
        keys = ['품목코드', '상태코드', '카드구분', '브랜드', '상태', '마감단가', '현재고', '가용재고']
        vals = {k: p.get(k, '') for k in keys}
        print(f"  {vals}")

# JSON 저장
out_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'erp_smart_inventory.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({
        'source': 'ERP 스마트재고현황 엑셀',
        'filter': {'생산지': '한국', '상태': '정상판매'},
        'headers': headers,
        'count': len(products),
        'products': products,
    }, f, ensure_ascii=False, indent=2)
print(f"\nJSON 저장: {out_path}")
print(f"파일 크기: {os.path.getsize(out_path):,} bytes")
