# bar_shop1 주문/배송 시스템

## 주문 플로우

```
주문(custom_order) → 항목(custom_order_item) → 배송(DELIVERY_INFO)
                   → 인쇄(custom_order_plist)
                   → 이력(custom_order_history)
                   → 결혼식정보(custom_order_WeddInfo)
                   → QR코드(custom_order_qr)
```

## 주문 상태 관리

- `status_seq >= 1`: 유효 주문
- `pay_Type`: 결제 방법 코드
- `site_gubun`: 사이트/브랜드 식별

## 쿼리 패턴

### 특정 기간 판매 조회
```sql
SELECT
    c.Card_Code,
    c.Card_Name,
    COUNT(DISTINCT o.order_seq) as order_count,
    SUM(oi.item_count) as total_quantity
FROM custom_order o
INNER JOIN custom_order_item oi ON o.order_seq = oi.order_seq
INNER JOIN S2_Card c ON oi.card_seq = c.Card_Seq
WHERE o.order_date >= '2025-01-01'
    AND o.order_date < '2025-02-01'
    AND o.status_seq >= 1
GROUP BY c.Card_Code, c.Card_Name
ORDER BY order_count DESC
```

### 청첩장 분석 시 제외 항목
```sql
-- 봉투, 스티커, 식권 제외
AND c.Card_Code NOT LIKE 'BSI%'     -- 스티커
AND c.Card_Code NOT LIKE 'BE%'      -- 봉투
AND c.Card_Code NOT LIKE 'DDA%'     -- 식권
AND c.Card_Name NOT LIKE '%봉투%'
AND c.Card_Name NOT LIKE '%스티커%'
AND c.Card_Name NOT LIKE '%식권%'
```

### 브랜드별 랭킹 조회
```sql
SELECT TOP 10 Card_Seq, RankNo
FROM S4_BestTotalRanking_Barunson
WHERE Gubun = 'WEEK'
ORDER BY Gubun_date DESC, RankNo
```

## 배송 시스템

### DELIVERY_INFO 주요 조회
```sql
SELECT
    d.ORDER_SEQ, d.DELIVERY_SEQ,
    d.NAME, d.ADDR,
    d.PHONE, d.HPHONE
FROM DELIVERY_INFO d
WHERE d.ORDER_SEQ = {order_seq}
```

## 모바일 카드 (mcard_) - 중단됨

- 17개 테이블 (mcard_Invitation, mcard_Skin, mcard_Gallery 등)
- **마지막 활동**: 2021-11-28
- 현재 비활성 상태 - 사용하지 않음
