# XERP 데이터베이스 스키마

## 개요

- **상태**: 활성 (2026년 3월 기준 최신 데이터 확인)
- **테이블 수**: 1,354개
- **총 레코드**: 약 2억 건 이상
- **용도**: 통합 ERP (제조/재무/인사)
- **참고**: 기존 문서에서 "2023년 9월 비활성"으로 기재되었으나, 실제로는 ERP_SalesData, glDocHeader, mmInoutHeader, rpBillHeader 등 주요 테이블에 2026년 최신 데이터가 계속 기록되고 있음

## 접근 제한

> **현재 프로젝트 계정(readonly_erp)으로는 재고/자재(mm) 관련 테이블만 접근 가능합니다.**
> 회계(gl), 매출/매입(rp), 판매(ERP_SalesData) 등 재무 관련 테이블은 접근 불가합니다.
> 재무 데이터가 필요한 경우 **조휘열**에게 별도 접속 정보를 요청하세요.

## 주요 특징

- **멀티테넌트**: SiteCode 기반
- **외래키**: 없음 (애플리케이션 레벨 관리)
- **모듈 구조**: 접두어 기반

## 모듈별 요약

| 모듈 | 접두어 | 테이블 수 | 레코드 수 | 설명 |
|------|--------|-----------|-----------|------|
| 공통/코어 | C_ | 228 | 32.6M | 공통 모듈 |
| 인사관리 | HR_ | 184 | 151K | 인사/급여/근태 |
| 자재관리 | mm | 37 | 45.2M | 입출고/재고 |
| 회계 | gl | 60 | 40.2M | 전표/원장 |
| 매출/매입 | rp | 22 | 37.9M | 청구서/세금계산서 |
| 판매 | sd | 57 | 15.2M | 주문/배송 |
| 구매 | po | 10 | 163K | 구매주문 |
| 생산 | pp | 21 | 269 | 생산계획 (거의 미사용) |
| 재무 | fas_ | 51 | - | 재무관리 |

## 상위 10 테이블 (레코드 수)

| 테이블 | 레코드 | 모듈 | 설명 |
|--------|--------|------|------|
| mmInoutItem | 40.1M | MM | 입출고 상세 |
| rpBillItem | 25.8M | RP | 청구서 상세 |
| ERP_SalesData | 18.1M | SD | 판매 데이터 |
| glDocItem | 17.6M | GL | 전표 상세 |
| glDocMngMapping | 13.8M | GL | 관리항목 매핑 |
| C_mmEvaData | 11.6M | C_ | 평가 데이터 |
| C_mmInvMonth | 11.6M | C_ | 월별 재고 |
| C_coInoutClose | 9.9M | C_ | 마감 처리 |
| mmInoutHeader | 5.5M | MM | 입출고 헤더 |
| glDocHeader | 4.3M | GL | 전표 헤더 |

## 쿼리 주의사항

### ERP_SalesData (가장 많이 조회)
- **반드시 `h_date` 필드 사용** (nvarchar(8), 'YYYYMMDD' 형식)
- `reg_date` 필드 사용 시 타임아웃 발생 (인덱스 부재)
- 데이터 지연: 1-2일 (실시간 아님)
- 주말 데이터 없음

```sql
-- GOOD
SELECT COUNT(*) FROM XERP.dbo.ERP_SalesData WHERE h_date = '20230901'

-- BAD (타임아웃 발생)
SELECT COUNT(*) FROM XERP.dbo.ERP_SalesData WHERE reg_date >= '2023-09-01'
```

### 일반 쿼리
```sql
-- WITH (NOLOCK) 사용 권장
SELECT * FROM XERP.dbo.glDocHeader WITH (NOLOCK)
WHERE DocDate BETWEEN '20230101' AND '20230930'
```

## 비즈니스 프로세스

### 구매-입고-재고
```
구매요청(mmRequisit) → 구매주문(poOrder) → 입고(mmInout) → 재고(mmInv)
```

### 주문-출고-매출
```
판매주문(sdOrder) → 출고(mmInout) → 배송(Delivery) → 매출(Sales)
```

### 회계
```
거래발생 → 전표생성(glDoc) → 원장기록(glLedger) → 재무제표
```
