# 디바이스 사용 패턴 분석

## 데이터 소스

- **필드**: TB_Order.Order_Path, TB_Order.Payment_Path
- **값**: 'PC' 또는 'M' (User Agent 문자열이 아님!)
- **분석 기간**: 2025년 1-8월

## 분석 결과

### 전체 비율
- **PC**: 67.73%
- **Mobile**: 32.27%

### 유료 사용자
- **PC**: 68.91%
- **Mobile**: 31.09%

### 무료 사용자
- **PC**: 67.55%
- **Mobile**: 32.45%

### 핵심 인사이트
- 유료/무료 사용자 간 디바이스 선호 **동일**
- PC 사용이 약 2:1 비율로 우세
- 디바이스가 전환율에 영향을 미치지 않음

## 분석 시 주의사항

1. **데이터 범위**: TB_Order에만 Order_Path/Payment_Path 존재
2. **2025.06 이후**: 무료 사용자 디바이스 데이터 수집 불가 (TB_Order 미기록)
3. **값 해석**: 'PC' = 데스크톱, 'M' = 모바일 (정확한 UA 정보 아님)

## 분석 쿼리

```sql
-- 디바이스별 주문 분석
SELECT
    CASE
        WHEN Order_Path = 'PC' OR Payment_Path = 'PC' THEN 'PC'
        WHEN Order_Path = 'M' OR Payment_Path = 'M' THEN 'Mobile'
        ELSE 'Unknown'
    END as device_type,
    COUNT(*) as orders,
    SUM(Payment_Price) as revenue
FROM TB_Order o
JOIN TB_Order_Product op ON o.Order_ID = op.Order_ID
JOIN TB_Product p ON op.Product_ID = p.Product_ID
WHERE p.Product_Code LIKE 'MC%'
GROUP BY
    CASE
        WHEN Order_Path = 'PC' OR Payment_Path = 'PC' THEN 'PC'
        WHEN Order_Path = 'M' OR Payment_Path = 'M' THEN 'Mobile'
        ELSE 'Unknown'
    END
```
