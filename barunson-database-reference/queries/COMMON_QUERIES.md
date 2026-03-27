# 자주 사용하는 SQL 쿼리 모음

## barunson 데이터베이스

### 시스템 조회

```sql
-- 전체 테이블 목록
SELECT name FROM barunson.sys.tables ORDER BY name

-- 테이블 스키마 조회
SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE, CHARACTER_MAXIMUM_LENGTH
FROM barunson.INFORMATION_SCHEMA.COLUMNS
WHERE TABLE_NAME = 'TB_Order'
ORDER BY ORDINAL_POSITION

-- 테이블별 레코드 수
SELECT t.name AS TableName, p.rows AS RowCount
FROM barunson.sys.tables t
INNER JOIN barunson.sys.partitions p ON t.object_id = p.object_id
WHERE p.index_id IN (0,1)
ORDER BY p.rows DESC
```

### MC 사용자 집계 (가장 중요한 쿼리!)

```sql
-- CORRECT: 모든 MC 사용자 (무료+유료)
SELECT
    COUNT(DISTINCT i.Invitation_ID) as total_users,
    COUNT(DISTINCT CASE WHEN o.Payment_Price > 0 THEN i.Invitation_ID END) as paid_users,
    COUNT(DISTINCT CASE WHEN o.Payment_Price = 0 OR o.Order_ID IS NULL THEN i.Invitation_ID END) as free_users
FROM TB_Invitation i
JOIN TB_Product p ON i.Template_ID = p.Template_ID
LEFT JOIN TB_Order o ON i.Order_ID = o.Order_ID
WHERE p.Product_Code LIKE 'MC%'

-- WRONG: 66%의 사용자를 놓침!
-- SELECT COUNT(*) FROM TB_Order WHERE ...
```

### 월별 MC 분석

```sql
SELECT
    YEAR(i.Regist_DateTime) as year,
    MONTH(i.Regist_DateTime) as month,
    COUNT(DISTINCT i.Invitation_ID) as total_users,
    COUNT(DISTINCT CASE WHEN o.Payment_Price > 0 THEN i.Invitation_ID END) as paid_users,
    SUM(ISNULL(o.Payment_Price, 0)) as revenue
FROM TB_Invitation i
JOIN TB_Product p ON i.Template_ID = p.Template_ID
LEFT JOIN TB_Order o ON i.Order_ID = o.Order_ID
WHERE p.Product_Code LIKE 'MC%'
    AND i.Regist_DateTime >= '2025-01-01'
GROUP BY YEAR(i.Regist_DateTime), MONTH(i.Regist_DateTime)
ORDER BY year, month
```

### 상품 조회

```sql
-- Product_ID로 상품 조회 (URL에서 사용)
SELECT Product_ID, Product_Code, Product_Name, Price
FROM TB_Product WHERE Product_ID = 1188  -- MC4114

-- Product_Code로 상품 조회
SELECT Product_ID, Product_Code, Product_Name
FROM TB_Product WHERE Product_Code = 'MC4114'
```

### 주문 조회

```sql
-- 날짜 범위 주문 (인덱스 활용)
SELECT Order_ID, Email, Total_Price, Payment_Price, Order_Status_Code
FROM TB_Order
WHERE Order_DateTime >= '2025-01-01' AND Order_DateTime < '2025-02-01'

-- 이메일로 주문 조회 (인덱스 활용)
SELECT Order_ID, Total_Price, Order_Status_Code
FROM TB_Order WHERE Email = 'user@example.com'

-- 주문 상세 (주문+상품+초대장)
SELECT o.Order_ID, o.Email, o.Payment_Price,
       p.Product_Code, p.Product_Name,
       i.Invitation_ID, i.Invitation_URL
FROM TB_Order o
JOIN TB_Order_Product op ON o.Order_ID = op.Order_ID
JOIN TB_Product p ON op.Product_ID = p.Product_ID
LEFT JOIN TB_Invitation i ON o.Order_ID = i.Order_ID
WHERE o.Order_ID = {order_id}
```

### 초대장 상세 조회

```sql
-- 초대장 고객 입력 정보
SELECT
    d.Groom_Name, d.Bride_Name,
    d.WeddingDate, d.WeddingHHmm,
    d.Weddinghall_Name, d.Weddinghall_Address,
    d.Weddinghall_Location_LAT, d.Weddinghall_Location_LOT
FROM TB_Invitation_Detail d
JOIN TB_Invitation i ON d.Invitation_ID = i.Invitation_ID
WHERE i.Order_ID = {order_id}
```

### 디바이스 분석

```sql
SELECT
    CASE
        WHEN Order_Path = 'PC' OR Payment_Path = 'PC' THEN 'PC'
        WHEN Order_Path = 'M' OR Payment_Path = 'M' THEN 'Mobile'
        ELSE 'Unknown'
    END as device_type,
    COUNT(*) as orders
FROM TB_Order o
JOIN TB_Order_Product op ON o.Order_ID = op.Order_ID
JOIN TB_Product p ON op.Product_ID = p.Product_ID
WHERE p.Product_Code LIKE 'MC%'
GROUP BY Order_Path, Payment_Path
```

### 매출 통계 조회

```sql
-- 월별 매출 (통계 테이블 활용 - 빠름)
SELECT Date, Total_Sales_Price, Barunn_Sales_Price
FROM TB_Sales_Statistic_Month
WHERE Date >= '202501'
ORDER BY Date

-- 일별 결제 현황
SELECT Date, Total_Price, Cancel_Refund_Price, Profit_Price
FROM TB_Payment_Status_Day
WHERE Date >= '20250101' AND Date <= '20250131'
ORDER BY Date
```

---

## bar_shop1 데이터베이스

### 시스템 조회

```sql
-- 전체 테이블 목록
SELECT name FROM bar_shop1.sys.tables ORDER BY name

-- 테이블별 레코드 수
SELECT TOP 20 t.name AS TableName, p.rows AS RowCnt
FROM bar_shop1.sys.tables t
INNER JOIN bar_shop1.sys.partitions p ON t.object_id = p.object_id
WHERE p.index_id IN (0,1) AND t.is_ms_shipped = 0
ORDER BY p.rows DESC
```

### 카드 상품 조회

```sql
-- 특정 카드 조회
SELECT Card_Seq, CardBrand, Card_Code, Card_Name, Card_Price, DISPLAY_YORN
FROM S2_Card WHERE Card_Code = 'BC4914'

-- 브랜드별 상품 수
SELECT CardBrand, COUNT(*) as cnt, AVG(Card_Price) as avg_price
FROM S2_Card WHERE Card_Div = 'A01'
GROUP BY CardBrand ORDER BY cnt DESC

-- 활성 청첩장 목록
SELECT Card_Code, Card_Name, Card_Price, CardBrand
FROM S2_Card
WHERE Card_Div = 'A01' AND DISPLAY_YORN = 'Y'
ORDER BY Card_Price DESC
```

### 주문 판매 조회

```sql
-- 기간별 판매량 (인덱스 활용)
SELECT
    c.Card_Code, c.Card_Name,
    COUNT(DISTINCT o.order_seq) as order_count,
    SUM(oi.item_count) as total_qty
FROM custom_order o
INNER JOIN custom_order_item oi ON o.order_seq = oi.order_seq
INNER JOIN S2_Card c ON oi.card_seq = c.Card_Seq
WHERE o.order_date >= '2025-01-01' AND o.order_date < '2025-02-01'
    AND o.status_seq >= 1
GROUP BY c.Card_Code, c.Card_Name
ORDER BY order_count DESC
```

### 카드 종류 조회 (M:N)

```sql
-- 카드의 종류 조회
SELECT c.Card_Code, c.Card_Name, ki.CardKind
FROM S2_Card c
JOIN S2_CardKind ck ON c.Card_Seq = ck.Card_Seq
JOIN S2_CardKindInfo ki ON ck.CardKind_Seq = ki.CardKind_Seq
WHERE c.Card_Code = 'BC4914'

-- 특정 종류의 카드 목록
SELECT c.Card_Code, c.Card_Name, c.Card_Price
FROM S2_Card c
JOIN S2_CardKind ck ON c.Card_Seq = ck.Card_Seq
WHERE ck.CardKind_Seq = 1  -- 1=청첩장
    AND c.DISPLAY_YORN = 'Y'
ORDER BY c.Card_Price DESC
```

---

## XERP 데이터베이스

```sql
-- 판매 데이터 조회 (반드시 h_date 사용!)
SELECT TOP 100 * FROM XERP.dbo.ERP_SalesData
WHERE h_date = '20230901'

-- 회계 전표 조회
SELECT * FROM XERP.dbo.glDocHeader WITH (NOLOCK)
WHERE DocDate BETWEEN '20230101' AND '20230930'

-- 재고 현황
SELECT * FROM XERP.dbo.mmInoutHeader WITH (NOLOCK)
WHERE InoutDate BETWEEN '20230101' AND '20230930'
```
