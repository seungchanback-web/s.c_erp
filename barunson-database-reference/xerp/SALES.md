# XERP 판매 데이터 (ERP_SalesData) 상세 문서

> 최종 확인일: 2026-03-06

## 개요

ERP_SalesData는 바른손의 전체 판매 트랜잭션을 기록하는 핵심 테이블입니다. 쇼핑몰(실물 카드) 주문이 발생하면 자동으로 이 테이블에 ERP 매출 데이터로 기록됩니다.

- **레코드 수**: 18,086,729건 (18.1M)
- **사이트 코드**: `BK10` (단일)
- **데이터 유형**: 전량 출고(SO) 데이터
- **데이터 지연**: 1-2일 (실시간 아님, 주말 데이터 없음)
- **최신 데이터**: 2026-03-05 (전일)

## 핵심 주의사항

> **반드시 `h_date` 필드 사용!** `reg_date` 필드로 조회 시 인덱스 부재로 타임아웃 발생.

---

## 테이블 스키마

### ERP_SalesData (18.1M건)

헤더(h_) 정보와 품목(b_) 정보가 하나의 테이블에 비정규화되어 있습니다.

#### 헤더 영역 (h_ 접두어) - 전표 단위

| 컬럼 | 타입 | NULL | 설명 |
|------|------|------|------|
| id | int | NO | 순번 (PK1) |
| h_biz | nvarchar(8) | YES | 사업장 코드 (BK10) |
| h_gubun | nvarchar(4) | YES | 구분 (SO: 출고, 전량 SO) |
| h_date | nvarchar(16) | YES | **매출 일자** (YYYYMMDD, 필수 조건 컬럼) |
| h_syscode | nvarchar(6) | YES | 시스템 코드 (270: 판매출고, 300: 일반출고) |
| h_usrcode | nvarchar(6) | YES | 사용자 코드 |
| h_comcode | nvarchar(16) | YES | 거래처 코드 |
| h_taxType | nvarchar(4) | YES | 세금 유형 (22: 과세 99.98%, 10: 기타) |
| h_offerPrice | numeric | YES | 공급가액 |
| h_superTax | numeric | YES | 부가세 |
| h_sumPrice | numeric | YES | 합계 금액 |
| h_partCode | nvarchar(16) | YES | 부서 코드 |
| h_StaffCode | nvarchar(16) | YES | 담당자 코드 |
| h_sonik | nvarchar(16) | YES | 손익 코드 |
| h_cost | nvarchar(16) | YES | 원가 코드 |
| h_orderid | nvarchar(100) | NO | **주문 ID** (PK2, 예: ET3243205) |
| h_memo1~3 | nvarchar(100) | YES | 메모 1~3 |

#### 품목 영역 (b_ 접두어) - 품목 단위

| 컬럼 | 타입 | NULL | 설명 |
|------|------|------|------|
| b_biz | nvarchar(8) | YES | 사업장 코드 |
| b_goodGubun | nvarchar(4) | YES | 상품 구분 |
| b_seq | smallint | YES | 품목 순번 |
| b_storeCode | nvarchar(8) | YES | 창고 코드 |
| b_date | nvarchar(16) | YES | 품목 일자 |
| b_goodCode | nvarchar(40) | YES | **상품 코드** (bar_shop1 품목과 매핑) |
| b_goodUnit | nvarchar(8) | YES | 단위 |
| b_OrderNum | numeric | NO | 주문 수량 |
| b_unitPrice | numeric | YES | 단가 |
| b_offerPrice | numeric | YES | 공급가 |
| b_superTax | numeric | YES | 부가세 |
| b_sumPrice | numeric | YES | 합계 금액 |
| b_memo | char(16) | YES | 품목 메모 |

#### 부가 정보

| 컬럼 | 타입 | NULL | 설명 |
|------|------|------|------|
| reg_date | smalldatetime | YES | 등록일 (**인덱스 없음, 사용 금지**) |
| FeeAmnt | numeric | YES | 수수료 금액 |
| PayAmnt | numeric | YES | 결제 금액 |
| ItemGubun | nchar(8) | YES | 품목 구분 (전량 'item') |
| DeptGubun | char(2) | YES | 부서 구분 (아래 참조) |
| order_seq | int | YES | bar_shop1 주문 순번 (FK 개념) |
| order_g_seq | int | YES | bar_shop1 주문 그룹 순번 |
| SettleDate | nchar(16) | YES | 정산일 |
| PayDate | nchar(16) | YES | 결제일 |
| PayCheck | char(1) | YES | 결제 확인 |
| C_ShopGroupNo | nvarchar(100) | YES | 쇼핑몰 그룹 번호 |
| inflow_route_settle | varchar(10) | YES | 유입 경로 정산 |

---

## 인덱스

| 인덱스명 | 컬럼 | 유형 | 용도 |
|---------|------|------|------|
| PK_ERP_SalesData | id, h_orderid | CLUSTERED | PK |
| IDX_ERP_SalesData_LSM | **h_date** | NONCLUSTERED | **날짜 조회 (필수 사용)** |
| IDX_ERP_SalesData_LSM2 | h_partCode | NONCLUSTERED | 부서별 조회 |
| IDX_ERP_SalesData_LSM3 | h_orderid | NONCLUSTERED | 주문 ID 조회 |
| idx_erp_salesdata_b_memo | b_memo | NONCLUSTERED | 메모 조회 |

---

## 코드 값 분포

### h_syscode (시스템 코드)

| 코드 | 건수 | 비율 | 의미 |
|------|------|------|------|
| 300 | 15,645,906 | 86.5% | 일반 출고 |
| 270 | 2,440,823 | 13.5% | 판매 출고 |

### DeptGubun (부서 구분)

| 코드 | 건수 | 의미 |
|------|------|------|
| SB | 10,960,434 | 쇼핑몰 B (주력) |
| BR | 4,274,680 | 바른손 |
| ST | 1,115,842 | 스토어 |
| SS | 1,077,235 | 쇼핑몰 S |
| SA | 647,868 | 쇼핑몰 A |
| OB | 6,988 | 기타 B |
| DE | 3,682 | 기타 |

### h_taxType (세금 유형)

| 코드 | 건수 | 의미 |
|------|------|------|
| 22 | 18,083,047 | 과세 (99.98%) |
| 10 | 3,682 | 비과세/기타 |

---

## 월별 활동량 (최근 6개월)

| 월 | 건수 | 매출 합계 (원) |
|----|------|---------------|
| 2026-03 | 24,036 (진행 중) | 434,584,497 |
| 2026-02 | 115,018 | 2,738,896,642 |
| 2026-01 | 137,625 | 3,110,556,993 |
| 2025-12 | 126,659 | 2,505,471,565 |
| 2025-11 | 111,758 | 2,209,162,257 |
| 2025-10 | 120,170 | 2,640,269,239 |

> 월 평균 약 25억원, 12만건의 매출 트랜잭션이 발생합니다.

---

## bar_shop1 연동

ERP_SalesData는 bar_shop1의 주문 시스템과 연동됩니다:

| ERP_SalesData 컬럼 | bar_shop1 테이블 | 연결 컬럼 |
|-------------------|----------------|----------|
| order_seq | custom_order | order_seq |
| h_orderid | custom_order | order_code (ET 접두어) |
| b_goodCode | S2_Card | Card_Code (상품 코드) |

### 상품 코드 예시 (b_goodCode)

| 코드 | bar_shop1 상품 | 유형 |
|------|---------------|------|
| RA004_AR_WH | 화환/답례품 | 실물 |
| TBB | 박스/포장 | 부속 |
| FST43_C | 식권 43번 | 부속 |
| FST44_C | 식권 44번 | 부속 |
| BSI080 | 스티커 080 | 부속 |
| BC3238 | 청첩장 BC3238 | 실물 카드 |

---

## 관련 테이블

| 테이블 | 레코드 수 | 설명 |
|--------|-----------|------|
| ERP_SalesData | 18,086,729 | 판매 데이터 (메인) |
| ERP_SalesData_TMP | 5,361 | 임시 데이터 |
| ErpPhotoOs | 2,773 | 사진 외주 |

---

## 자주 사용하는 쿼리 패턴

### 특정일 매출 조회

```sql
-- GOOD: h_date 인덱스 활용
SELECT * FROM ERP_SalesData WITH (NOLOCK)
WHERE h_date = '20260305'

-- BAD: reg_date 사용 금지 (타임아웃!)
-- SELECT * FROM ERP_SalesData WHERE reg_date >= '2026-03-05'
```

### 기간별 매출 집계

```sql
SELECT LEFT(h_date, 6) AS sales_month,
       COUNT(*) AS cnt,
       SUM(h_sumPrice) AS total_sales,
       SUM(FeeAmnt) AS total_fee
FROM ERP_SalesData WITH (NOLOCK)
WHERE h_date BETWEEN '20260101' AND '20260131'
GROUP BY LEFT(h_date, 6)
```

### 부서별 매출 현황

```sql
SELECT DeptGubun,
       COUNT(*) AS cnt,
       SUM(h_sumPrice) AS total_sales
FROM ERP_SalesData WITH (NOLOCK)
WHERE h_date BETWEEN '20260201' AND '20260228'
GROUP BY DeptGubun
ORDER BY total_sales DESC
```

### 상품별 판매 순위

```sql
SELECT TOP 20 b_goodCode,
       COUNT(*) AS order_count,
       SUM(b_OrderNum) AS total_qty,
       SUM(b_sumPrice) AS total_sales
FROM ERP_SalesData WITH (NOLOCK)
WHERE h_date BETWEEN '20260201' AND '20260228'
GROUP BY b_goodCode
ORDER BY total_sales DESC
```

### 주문 ID로 조회 (bar_shop1 연동)

```sql
-- h_orderid 인덱스 활용
SELECT * FROM ERP_SalesData WITH (NOLOCK)
WHERE h_orderid = 'ET3243205'

-- order_seq로 bar_shop1과 매핑
SELECT e.h_date, e.h_sumPrice, e.b_goodCode, e.b_OrderNum
FROM ERP_SalesData e WITH (NOLOCK)
WHERE e.order_seq = 3243205
```

### 일별 매출 추이

```sql
SELECT h_date,
       COUNT(*) AS cnt,
       SUM(h_sumPrice) AS daily_sales
FROM ERP_SalesData WITH (NOLOCK)
WHERE h_date BETWEEN '20260201' AND '20260228'
GROUP BY h_date
ORDER BY h_date
```

---

## 쿼리 성능 주의사항

1. **`h_date` 필드만 사용** — `reg_date`는 인덱스 없음, 타임아웃 발생
2. **18M건 대용량** — 반드시 h_date로 범위 축소 후 조회
3. `h_date`는 `nvarchar(16)` 타입 — 문자열 비교 (`'20260305'`)
4. 전체 스캔이 필요한 집계는 월 단위로 분리하여 실행
5. `h_orderid` 인덱스로 특정 주문 조회 가능
