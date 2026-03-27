#!/usr/bin/env python3
"""스마트재고현황 웹서버 - Flask API + 정적 페이지
Port: 12026
"""
import os, sys, json, pymssql
from datetime import datetime
from flask import Flask, jsonify, request, send_file
from dotenv import load_dotenv
load_dotenv()
sys.stdout.reconfigure(encoding='utf-8')

app = Flask(__name__)

DB_CONFIG = {
    'server': os.getenv('DB_SERVER'),
    'port': int(os.getenv('DB_PORT', '1433')),
    'user': os.getenv('DB_USER'),
    'password': os.getenv('DB_PASSWORD'),
}

# 브랜드 추정 맵
BRAND_MAP = {
    'BC': '바른손카드', 'BH': '비헨즈', 'BI': '초대장', 'BS': '바른손',
    'BN': '바른손(구)', 'SX': '바른손(구)', 'PE': '프리미어', 'DD': '더카드',
    'FS': '식권', 'se': '시즌', 'BE': '봉투', 'TG': 'TG',
}

CATE_MAP = {
    'WI': '청첩장', 'SN': '시즌카드', 'EN': '봉투', 'AC': '부속/악세서리',
    'BB': '돌잔치', 'GR': '감사장', 'FS': '식권', 'EV': '이벤트',
    'FP': '인쇄물', 'PH': '포토', 'ST': '스티커', 'PA': '보관함',
}

STATUS_MAP = {'1': '정상판매', '0': '판매중지'}


def get_conn(db):
    return pymssql.connect(**DB_CONFIG, database=db, charset='UTF-8')


@app.route('/')
def index():
    return send_file(os.path.join(os.path.dirname(__file__), 'smart_inv_page.html'))


@app.route('/api/inventory')
def api_inventory():
    sales_from = request.args.get('sales_from', datetime.now().strftime('%Y%m%d'))
    sales_to = request.args.get('sales_to', datetime.now().strftime('%Y%m%d'))
    brand_filter = request.args.get('brand', '')
    produce_filter = request.args.get('produce', '')  # 한국, 중국 등

    # 1. mmInventory
    conn = get_conn('XERP')
    cur = conn.cursor()
    cur.execute("""
        SELECT RTRIM(ItemCode), RTRIM(WhCode), CAST(OhQty AS BIGINT)
        FROM mmInventory WITH (NOLOCK)
        WHERE SiteCode='BK10' AND OhQty <> 0
    """)
    items = {}
    for ic, wh, qty in cur:
        ic = ic.strip()
        if ic not in items:
            items[ic] = {'wh': {}, 'cur': 0, 'cn': 0, 'transit': 0}
        items[ic]['wh'][wh.strip()] = qty
        if wh.strip().startswith('MF'):
            items[ic]['cur'] += qty
        elif wh.strip() == 'MT01':
            items[ic]['cn'] += qty
        elif wh.strip() == 'MT04':
            items[ic]['transit'] += qty

    # 2. 매출량
    cur.execute("""
        SELECT RTRIM(ItemCode), SUM(CAST(InoutQty AS BIGINT))
        FROM mmInoutItem WITH (NOLOCK)
        WHERE SiteCode='BK10' AND InoutGubun='SO'
          AND InoutDate >= %s AND InoutDate <= %s
        GROUP BY ItemCode
    """, (sales_from, sales_to))
    sales = {r[0].strip(): r[1] for r in cur}

    # 3. 요청량
    cur.execute("""
        SELECT RTRIM(ItemCode), SUM(CAST(ReqQty AS BIGINT)) - SUM(CAST(OutQty AS BIGINT))
        FROM mmRequisitItem WITH (NOLOCK)
        WHERE SiteCode='BK10' AND ReqItemStatus <> 'C'
        GROUP BY ItemCode
    """)
    reqs = {r[0].strip(): max(0, r[1]) for r in cur}
    conn.close()

    # 4. bar_shop1 CARD
    conn2 = get_conn('bar_shop1')
    cur2 = conn2.cursor()
    cur2.execute("""
        SELECT
            RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50))),
            RTRIM(CAST(c.CARD_CODE AS NVARCHAR(50))),
            RTRIM(CAST(c.CARD_NAME AS NVARCHAR(200))),
            RTRIM(CAST(c.CARD_CATE AS NVARCHAR(50))),
            CAST(c.CARD_PRICE AS INT),
            CAST(c.CARD_SRC_PRICE AS INT),
            RTRIM(CAST(c.PRODUCE_PLACE AS NVARCHAR(200))),
            CAST(c.JUMUN_YES_OR_NO AS NVARCHAR(10)),
            j.jaego
        FROM CARD c WITH (NOLOCK)
        LEFT JOIN CARD_JAEGO j WITH (NOLOCK) ON CAST(c.CARD_CODE AS NVARCHAR(50)) = j.card_code
        WHERE c.ERP_CODE IS NOT NULL AND LEN(RTRIM(CAST(c.ERP_CODE AS NVARCHAR(50)))) > 0
    """)
    cards = {}
    for row in cur2:
        erp = (row[0] or '').strip()
        name = (row[2] or '').strip()
        if '<' in name:
            name = ''
        cards[erp] = {
            'card_code': (row[1] or '').strip(),
            'name': name,
            'cate': (row[3] or '').strip(),
            'price': row[4] or 0,
            'src_price': row[5] or 0,
            'produce': (row[6] or '').strip(),
            'jumun': (row[7] or '').strip(),
            'shop_jaego': row[8] or 0,
        }
    conn2.close()

    # 병합
    products = []
    for ic, inv in items.items():
        card = cards.get(ic, {})
        prefix = ic[:2]
        brand = BRAND_MAP.get(prefix, prefix)
        sales_qty = sales.get(ic, 0)
        req_qty = reqs.get(ic, 0)
        cur_stock = inv['cur']
        avail = cur_stock - req_qty

        # 필터 적용
        if brand_filter and brand != brand_filter:
            continue
        produce = card.get('produce', '')
        if produce_filter:
            if produce_filter == '한국' and '한국' not in produce:
                # 한국 필터: bar_shop1에 매칭되고 한국인 것 + 매칭 안 되는 것도 포함
                if ic in cards:
                    continue
            elif produce_filter == '중국' and '중국' not in produce:
                if ic in cards:
                    continue

        products.append({
            'ic': ic,
            'brand': brand,
            'cate': CATE_MAP.get(card.get('cate', ''), card.get('cate', '')),
            'status': STATUS_MAP.get(card.get('jumun', ''), ''),
            'name': card.get('name', ''),
            'src_price': card.get('src_price', 0),
            'price': card.get('price', 0),
            'shop_jaego': card.get('shop_jaego', 0),
            'sales': sales_qty,
            'cur': cur_stock,
            'req': req_qty,
            'avail': avail,
            'cn': inv['cn'],
            'transit': inv['transit'],
            'matched': ic in cards,
            'wh': inv['wh'],
        })

    products.sort(key=lambda x: -x['sales'])

    # 요약
    summary = {
        'count': len(products),
        'matched': sum(1 for p in products if p['matched']),
        'total_cur': sum(p['cur'] for p in products),
        'total_cn': sum(p['cn'] for p in products),
        'total_transit': sum(p['transit'] for p in products),
        'total_sales': sum(p['sales'] for p in products),
        'total_req': sum(p['req'] for p in products),
    }

    return jsonify({
        'filter': {'sales_from': sales_from, 'sales_to': sales_to},
        'summary': summary,
        'products': products,
        'generated': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
    })


@app.route('/api/brands')
def api_brands():
    """브랜드 목록"""
    return jsonify(list(BRAND_MAP.values()))


if __name__ == '__main__':
    print("스마트재고현황 서버 시작: http://localhost:12026")
    app.run(host='0.0.0.0', port=12026, debug=True)
