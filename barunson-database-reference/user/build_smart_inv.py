#!/usr/bin/env python3
"""smart_inventory.html에 데이터 삽입"""
import os, json
sys_dir = os.path.dirname(__file__)

with open(os.path.join(sys_dir, 'smart_inventory_data.json'), 'r', encoding='utf-8') as f:
    data = json.load(f)

with open(os.path.join(sys_dir, 'smart_inventory.html'), 'r', encoding='utf-8') as f:
    html = f.read()

html = html.replace('__DATA__', json.dumps(data, ensure_ascii=False))

out = os.path.join(sys_dir, 'smart_inventory_page.html')
with open(out, 'w', encoding='utf-8') as f:
    f.write(html)
print(f'Generated: {out}')
print(f'Products: {len(data["products"])}')
