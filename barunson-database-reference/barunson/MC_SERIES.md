# MC 시리즈 상품 및 비즈니스 모델

## 개요

MC 시리즈는 바른손의 모바일/디지털 청첩장 제품군입니다. 프리미엄 모델로 운영됩니다.

## 비즈니스 모델

### 프리미엄 구조
- **무료 사용자**: 96% (70,806명, 2025.01-08)
- **유료 사용자**: 4% (2,991명, 2025.01-08)
- **전체 사용자**: 73,797명

### 가격
- 세트 가격: ~30,000원
- 개별 카드(bar_shop1): ~950원

### 매출 현황 (2025년)
- **총 매출 (1-8월)**: 93,089,110원
- **6월 이전 월평균**: 18,591,220원
- **6월 이후 월평균**: 44,337원 (99.76% 감소)
- **ARPU**: 1,261원 (매우 낮음 - 무료 사용자 포함)
- **ARPPU**: 31,127원 (유료 사용자만)

## 데이터 추적 (중요!)

### 기간별 추적 방식
| 기간 | TB_Order | TB_Invitation |
|------|----------|--------------|
| 2025.01-05 | 모든 사용자 (무료도 Payment_Price=0) | 모든 사용자 |
| 2025.06 이후 | 유료 사용자만 | 모든 사용자 |

### 올바른 사용자 집계 방법

```sql
-- CORRECT: TB_Invitation 사용 (모든 사용자)
SELECT
    COUNT(DISTINCT i.Invitation_ID) as total_users,
    COUNT(DISTINCT CASE WHEN o.Payment_Price > 0 THEN i.Invitation_ID END) as paid_users,
    COUNT(DISTINCT CASE WHEN o.Payment_Price = 0 OR o.Order_ID IS NULL THEN i.Invitation_ID END) as free_users
FROM TB_Invitation i
JOIN TB_Product p ON i.Template_ID = p.Template_ID
LEFT JOIN TB_Order o ON i.Order_ID = o.Order_ID
WHERE p.Product_Code LIKE 'MC%'

-- WRONG: TB_Order만 사용 (34%만 캡처)
SELECT COUNT(*) FROM TB_Order WHERE ...
```

### 데이터 조인 경로
```
TB_Invitation.Template_ID → TB_Product.Template_ID (상품 매핑)
TB_Invitation.Order_ID → TB_Order.Order_ID (주문 매핑, NULL 가능)
```

## 디바이스 사용 패턴

- **전체**: PC 67.73% / Mobile 32.27%
- **유료**: PC 68.91% / Mobile 31.09%
- **무료**: PC 67.55% / Mobile 32.45%
- **데이터 위치**: TB_Order.Order_Path, TB_Order.Payment_Path ('PC' 또는 'M')

## 인기 MC 상품 (2025년)

| 순위 | 코드 | 상품명 | 총 사용자 | 유료 | 전환율 | 매출 |
|------|------|--------|----------|------|--------|------|
| 1 | MC1606 | sincere moment | 14,282 | 168 | 1.18% | 6,647,000원 |
| 2 | MC3252 | 행복한 너와 나 | 6,326 | 229 | 3.62% | 8,671,000원 |
| 3 | MC4114 | 영화 같은 순간 | 5,360 | 180 | 3.36% | 7,061,000원 |
| 4 | MC3220 | Elegant Pearl | 3,579 | 133 | 3.72% | 5,002,000원 |
| 5 | MC1208 | 시작 | 2,826 | 112 | 3.96% | 4,331,000원 |

- **평균 전환율**: 4.05%
- **최고 전환율**: MC1238 (Our Love) - 8.34%
- **최저 전환율**: MC1606 (sincere moment) - 1.18%

## Product_ID 매핑 (URL용)

| Product_ID | Product_Code | Product_Name |
|-----------|-------------|--------------|
| 1186 | MC4111 | 고백하는 날 |
| 1187 | MC4113 | 반짝반짝 사랑 |
| 1188 | MC4114 | 영화 같은 순간 |
| 1189 | MC4115 | 마가렛 |

URL: `https://www.barunsonmcard.com/Product/Detail/{Product_ID}`

## MC 상품과 bar_shop1 관계

MC 세트는 종종 bar_shop1의 BC 상품을 번들로 포함합니다:
- 예: MC4114 (30,000원 세트) ← BC4914 (950원 개별 카드)
