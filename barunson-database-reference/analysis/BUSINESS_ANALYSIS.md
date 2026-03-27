# MC 시리즈 비즈니스 분석 (2025년 1-8월)

## 핵심 지표

### 사용자
- **전체 사용자**: 73,797명 (TB_Invitation 기준)
- **TB_Order 가시**: 24,927명 (34%만)
- **히든 사용자**: 48,870명 (66%)
- **유료 사용자**: 2,991명 (4.05%)
- **무료 사용자**: 70,806명 (95.95%)

### 매출
- **총 매출 (1-8월)**: 93,089,110원
- **6월 이전 월평균**: 18,591,220원
- **6월 이후 월평균**: 44,337원 (99.76% 감소)
- **ARPU**: 1,261원
- **ARPPU**: 31,127원

### 전환율
- **평균 전환율**: 4.05%
- **최고**: MC1238 (Our Love) - 8.34%
- **최저**: MC1606 (sincere moment) - 1.18%
- **인사이트**: 가장 인기 있는 상품이 가장 낮은 전환율

## 비즈니스 모델 변화

### 2025년 1-5월: 숨겨진 프리미엄
- 87% 무료 사용자도 TB_Order에 Payment_Price=0으로 기록
- 매출 추적 가능

### 2025년 6월: CEO 의사결정
- 무료 서비스 공식화
- 무료 사용자 TB_Order 기록 중단

### 2025년 6월 이후: 매출 급감
- 유료 사용자만 TB_Order에 기록
- 무료 사용자는 TB_Invitation에만 존재
- 99.76% 매출 감소

## 인기 상품 TOP 5

| 순위 | 코드 | 이름 | 총 사용자 | 유료 | 전환율 | 매출 |
|------|------|------|----------|------|--------|------|
| 1 | MC1606 | sincere moment | 14,282 | 168 | 1.18% | 6,647,000원 |
| 2 | MC3252 | 행복한 너와 나 | 6,326 | 229 | 3.62% | 8,671,000원 |
| 3 | MC4114 | 영화 같은 순간 | 5,360 | 180 | 3.36% | 7,061,000원 |
| 4 | MC3220 | Elegant Pearl | 3,579 | 133 | 3.72% | 5,002,000원 |
| 5 | MC1208 | 시작 | 2,826 | 112 | 3.96% | 4,331,000원 |

## 디바이스 사용 패턴

| 구분 | PC | Mobile |
|------|-----|--------|
| 전체 | 67.73% | 32.27% |
| 유료 | 68.91% | 31.09% |
| 무료 | 67.55% | 32.45% |

**인사이트**: 유료/무료 사용자 간 디바이스 선호 차이 없음

## 결제 패턴

| 결제 수단 | 비율 |
|----------|------|
| 카드 결제 | 60-70% |
| 가상계좌 | 30-40% |
| 계좌이체 | 1% 미만 |

## 정확한 분석 쿼리

```sql
-- 월별 MC 사용자 및 매출 분석 (정확한 버전)
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
