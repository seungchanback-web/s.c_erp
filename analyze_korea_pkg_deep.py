import json, re
from collections import defaultdict

with open('C:/barunson/korea_pkg_data.json', 'r', encoding='utf-8') as f:
    data = json.load(f)

# 1. 톰슨 단가 vs 제품수량 상관관계
print("=" * 70)
print("1. 톰슨 단가 vs 제품수량 (수량에 따라 단가가 달라지는지?)")
print("=" * 70)
tomson = [r for r in data if r['process'] == '톰슨' and r['unit_price'] and r['unit_price'] > 0]
price_groups = defaultdict(list)
for r in tomson:
    price_groups[int(r['unit_price'])].append(r)

for price in sorted(price_groups.keys()):
    items = price_groups[price]
    qtys = []
    for i in items:
        q = i['product_qty'].replace(',', '')
        try: qtys.append(int(float(q)))
        except: pass
    avg_qty = sum(qtys) / len(qtys) if qtys else 0
    min_qty = min(qtys) if qtys else 0
    max_qty = max(qtys) if qtys else 0
    products = sorted(set(i['product_code'].split('-')[0] for i in items))
    print(f"\n  톰슨 {price:,}원/연 ({len(items)}건)")
    print(f"    수량범위: {min_qty:,} ~ {max_qty:,}매 (평균: {avg_qty:,.0f}매)")
    print(f"    제품: {', '.join(products[:15])}")

# 2. 같은 제품의 톰슨 단가가 월별로 변하는지?
print("\n" + "=" * 70)
print("2. 동일 제품 톰슨 단가 월별 추이 (단가 인상/인하 있는지?)")
print("=" * 70)
product_tomson = defaultdict(list)
for r in tomson:
    pc = r['product_code'].split('-OS')[0]  # OS번호 제거
    product_tomson[pc].append({'month': r['month'], 'price': r['unit_price'], 'qty': r['product_qty']})

for pc, records in sorted(product_tomson.items()):
    if len(records) >= 2:
        prices = set(r['price'] for r in records)
        if len(prices) > 1:
            print(f"\n  ** {pc} - 단가 변동!")
            for r in sorted(records, key=lambda x: x['month']):
                print(f"    {r['month']} | 단가: {r['price']:,.0f}원 | 수량: {r['qty']}")
        else:
            months = sorted(set(r['month'] for r in records))
            print(f"  {pc}: {int(list(prices)[0]):,}원 고정 ({', '.join(months)})")

# 3. 제품코드 앞 2글자(시리즈)별 톰슨 단가 패턴
print("\n" + "=" * 70)
print("3. 제품 시리즈별 톰슨 단가 (규칙성 확인)")
print("=" * 70)
series_prices = defaultdict(list)
for r in tomson:
    pc = r['product_code'].split('-OS')[0]
    # 시리즈 추출: BC, BH, BI, 1813 등
    m = re.match(r'^([A-Z]{2}\d{0,2}|\d{4}[A-Z]*)', pc)
    series = m.group(1) if m else pc[:4]
    series_prices[series].append(r['unit_price'])

for s in sorted(series_prices.keys()):
    prices = series_prices[s]
    unique = sorted(set(int(p) for p in prices))
    if len(unique) == 1:
        print(f"  {s}: {unique[0]:,}원 고정 ({len(prices)}건)")
    else:
        print(f"  {s}: {', '.join(f'{p:,}원' for p in unique)} ({len(prices)}건)")

# 4. 인쇄 단가 패턴
print("\n" + "=" * 70)
print("4. 인쇄 단가 vs 수량 패턴")
print("=" * 70)
inswe = [r for r in data if r['process'] == '인쇄' and r['unit_price'] and r['unit_price'] > 0]
for r in sorted(inswe, key=lambda x: x['unit_price']):
    qty = r['product_qty'].replace(',', '')
    print(f"  {r['month']} | {r['product_code'][:30]:30s} | 수량: {r['product_qty']:>8s} | 단가: {r['unit_price']:>8,.0f}원 | 연수: {r['qty']}")

# 5. 톰슨 규격(연수) 분석
print("\n" + "=" * 70)
print("5. 톰슨 규격(몇연) vs 단가")
print("=" * 70)
for r in sorted(tomson, key=lambda x: x['unit_price']):
    spec = r['spec']
    print(f"  단가:{r['unit_price']:>8,.0f} | 규격:{spec:>5s} | {r['product_code'][:30]:30s} | 수량:{r['product_qty']:>8s}")

# 6. 공정별 고유 패턴 (금액이 아닌 고정 요금인 것들)
print("\n" + "=" * 70)
print("6. 고정 요금 공정 (수량 무관하게 건당 금액)")
print("=" * 70)
fixed_fee = defaultdict(list)
for r in data:
    if r['amount'] and not r['unit_price'] and r['process'] not in ('OS2509-B00010',):
        fixed_fee[r['process']].append(r)

for proc in sorted(fixed_fee.keys(), key=lambda x: -len(fixed_fee[x])):
    items = fixed_fee[proc]
    amounts = [i['amount'] for i in items if i['amount']]
    if amounts:
        unique_amts = sorted(set(int(a) for a in amounts))
        print(f"  {proc}: {len(items)}건 | 금액: {', '.join(f'{a:,}원' for a in unique_amts)}")

# 7. 월별 제품별 후공정 원가 합계
print("\n" + "=" * 70)
print("7. 제품별 후공정 원가 합계 (상위 15)")
print("=" * 70)
product_cost = defaultdict(lambda: {'total': 0, 'processes': defaultdict(float), 'months': set()})
for r in data:
    pc = r['product_code'].split('-OS')[0]
    if r['amount']:
        product_cost[pc]['total'] += r['amount']
        product_cost[pc]['processes'][r['process']] += r['amount']
        product_cost[pc]['months'].add(r['month'])

for pc, v in sorted(product_cost.items(), key=lambda x: -x[1]['total'])[:15]:
    months = ', '.join(sorted(v['months']))
    procs = ' + '.join(f"{p}({a:,.0f})" for p, a in sorted(v['processes'].items(), key=lambda x: -x[1]))
    print(f"  {pc}: {v['total']:>12,.0f}원 ({months})")
    print(f"    {procs}")
