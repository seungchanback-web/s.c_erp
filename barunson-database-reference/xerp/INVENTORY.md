# XERP 재고/자재관리 (MM 모듈) 상세 문서

> 최종 확인일: 2026-03-06

## 개요

XERP의 자재관리(MM) 모듈은 입출고, 재고, 청구요청, 검수, 폐기, 월마감 등 재고 관련 전체 프로세스를 관리합니다. **2026년 3월 현재 활발하게 운영 중**이며, 매월 15,000~19,000건의 입출고 트랜잭션이 발생하고 있습니다.

- **사이트 코드**: `BK10` (단일 사이트)
- **통화**: KRW
- **재고 상태**: GOOD (양품), POOR (불량)

## 비즈니스 프로세스

```
청구요청(mmRequisit) → 입고(mmInout SI/MI) → 재고(mmInventory) → 출고(mmInout SO/MO)
                                                    ↓
                                              월별 재고(mminvMonth, C_mmInvMonth)
                                                    ↓
                                              재고 평가(C_mmEvaData)
                                                    ↓
                                              월마감(mmMonthClose)
```

### 입출고 구분 (InoutGubun)

| 코드 | 의미 | 레코드 수 | 비율 |
|------|------|-----------|------|
| SO | 출고 (Stock Out) | 4,904,127 | 89.8% |
| SI | 입고 (Stock In) | 361,859 | 6.6% |
| MO | 자재 출고 (Material Out) | 132,185 | 2.4% |
| MI | 자재 입고 (Material In) | 61,047 | 1.1% |

### 주요 사유코드 (SysCase/CaseCode)

| SysCase | CaseCode | 건수 | 추정 의미 |
|---------|----------|------|----------|
| 270 | 270 | 2,548,239 | 판매 출고 |
| 300 | 308 | 1,927,502 | 일반 출고 |
| 400 | 400 | 286,890 | 구매 입고 |
| 170 | 170 | 156,513 | 외주 입고 |
| 800 | 804 | 113,635 | 생산 출고 |
| 100 | 101 | 81,644 | 자재 입고 |

---

## 테이블 상세

### 핵심 테이블 요약

| 테이블 | 레코드 수 | 용도 | 최신 데이터 |
|--------|-----------|------|------------|
| mmInoutItem | 40.1M | 입출고 상세 (품목별) | 2026-03 |
| C_mmEvaData | 11.6M | 재고 평가 (월별/품목별) | 202601 |
| C_mmInvMonth | 11.6M | 월별 재고 집계 (창고 무관) | 202601 |
| mmInoutHeader | 5.5M | 입출고 헤더 (전표 단위) | 2026-03-27 |
| mmRequisitItem | 1.9M | 청구요청 상세 | - |
| mminvMonth | 781K | 월별 재고 (창고별) | 202603 |
| C_mmInoutSumMonth | 780K | 월별 입출고 요약 | 200809 (과거) |
| mmInspItem | 625K | 검수 상세 | - |
| mmRequisitHeader | 216K | 청구요청 헤더 | 2026-03-09 |
| mmInventory | 76K | 현재 재고 (실시간) | 실시간 |
| mmDisposeitem | 10K | 폐기 상세 | - |
| mmMonthClose | 528 | 월마감 기록 | 202601 |
| mmDisposeHeader | 475 | 폐기 헤더 | - |
| mmInspHeader | 329 | 검수 헤더 | - |
| mmStatusChgHeader | 376 | 재고 상태 변경 헤더 | - |
| mmStatusChgItem | 1,047 | 재고 상태 변경 상세 | - |

### 월별 활동량 (최근 6개월)

| 월 | 입출고 건수 |
|----|-----------|
| 2026-03 | 2,339 (진행 중) |
| 2026-02 | 16,055 |
| 2026-01 | 19,598 |
| 2025-12 | 17,330 |
| 2025-11 | 15,075 |
| 2025-10 | 16,557 |

---

### 1. mmInoutHeader (입출고 헤더) - 5.5M건

입출고 전표의 헤더 정보. 전표 단위로 하나의 레코드.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 (BK10) |
| InoutNo | nchar(32) | PK2 | 입출고 번호 (예: SR2603-B00140) |
| InoutGubun | nchar(4) | PK3 | 입출고 구분 (SO/SI/MO/MI) |
| InoutDate | nchar(16) | | 입출고 일자 (YYYYMMDD) |
| SysCase | nchar(6) | | 시스템 사유 코드 |
| CaseCode | nchar(6) | | 사유 세부 코드 |
| InoutPlace | nchar(16) | | 거래처/입출고처 |
| CurrCode | nchar(6) | | 통화 코드 (KRW) |
| ExchRate | numeric | | 환율 |
| TransAmntTotal | numeric | | 운송비 합계 |
| TransVatTotal | numeric | | 운송비 부가세 합계 |
| TransStatus | nchar(2) | | 운송 상태 |
| InoutDescr | nvarchar(260) | | 비고 |
| OriginNo | nchar(32) | | 원본 전표 번호 |
| DocNo | nchar(32) | | 회계 전표 번호 |
| C_JumunNo | nvarchar(100) | | 주문 번호 (쇼핑몰 연동) |
| C_Confirm | char(1) | | 확인 여부 |
| Actiondate | datetime | | 처리 일시 |

#### 인덱스

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK (Clustered) | SiteCode, InoutNo, InoutGubun | CLUSTERED |
| NCI_INOUT_DATE | InoutDate | NONCLUSTERED |
| NCI_SYSCASE | SysCase | NONCLUSTERED |
| IDX_mmInoutHeader_LSM2 | SiteCode, InoutDate | NONCLUSTERED |
| IX_..._SysCase_InoutDate_CaseCode | SiteCode, InoutGubun, InoutDate, SysCase, CaseCode (+ OriginNo include) | NONCLUSTERED |
| IX_..._SysCase_CaseCode_InoutDate_OrginNo | SiteCode, InoutGubun, SysCase, CaseCode, InoutPlace, OriginNo | NONCLUSTERED |

#### 쿼리 팁

```sql
-- 날짜 범위로 입출고 조회 (NCI_INOUT_DATE 인덱스 활용)
SELECT * FROM mmInoutHeader WITH (NOLOCK)
WHERE InoutDate BETWEEN '20260301' AND '20260306'

-- 사이트+날짜 조회 (IDX_mmInoutHeader_LSM2 활용)
SELECT * FROM mmInoutHeader WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND InoutDate BETWEEN '20260301' AND '20260306'

-- 특정 구분+사유 조회
SELECT * FROM mmInoutHeader WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND InoutGubun = 'SO' AND SysCase = '270'
  AND InoutDate BETWEEN '20260301' AND '20260306'
```

---

### 2. mmInoutItem (입출고 상세) - 40.1M건

입출고 전표의 품목별 상세. 하나의 전표(Header)에 여러 품목(Item)이 포함.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| InoutNo | nchar(32) | PK2 | 입출고 번호 (FK→mmInoutHeader) |
| InoutGubun | nchar(4) | PK3 | 입출고 구분 |
| InoutSerNo | smallint | PK4 | 순번 |
| WhCode | nchar(8) | | 창고 코드 |
| InoutDate | nchar(16) | | 입출고 일자 |
| ItemCode | nchar(40) | | 품목 코드 |
| ItemName | nvarchar(160) | | 품목명 |
| ItemSpec | nvarchar(200) | | 규격 |
| InvStatus | nchar(8) | | 재고 상태 (GOOD/POOR) |
| InoutQty | numeric | | 입출고 수량 |
| UnitCode | nchar(8) | | 단위 |
| InoutPrice | numeric | | 단가 |
| InoutAmnt | numeric | | 금액 |
| OhQty | numeric | | 재고 수량 |
| OhPrice | numeric | | 재고 단가 |
| OhAmnt | numeric | | 재고 금액 |
| LotNo | nchar(60) | | 로트 번호 |
| IrNo | nchar(32) | | 청구요청 번호 (FK→mmRequisitHeader) |
| IrSerNo | smallint | | 청구요청 순번 |

#### 인덱스

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK_mmInoutItem (Clustered) | SiteCode, InoutNo, InoutGubun, InoutSerNo | CLUSTERED |
| IDX_mmInoutItem_01 | SiteCode, WhCode, InvStatus, ItemCode, InoutDate, ItemDaySerNo, InoutQty, IrNo, IrSerNo | NONCLUSTERED |
| IDX_mmInoutItem_LSM3 | InoutDate | NONCLUSTERED |
| IDX_mmInoutItem_LSM2 | WhCode, InoutDate | NONCLUSTERED |
| IDX_mmInoutitem_LSM | IrNo, IrSerNo | NONCLUSTERED |

#### 쿼리 팁

```sql
-- 특정 품목의 입출고 이력 (IDX_mmInoutItem_01 활용)
SELECT * FROM mmInoutItem WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND WhCode = 'MF01' AND ItemCode = 'BSI080'
  AND InoutDate BETWEEN '20260201' AND '20260228'

-- 날짜 기준 조회 (IDX_mmInoutItem_LSM3 활용)
SELECT TOP 100 * FROM mmInoutItem WITH (NOLOCK)
WHERE InoutDate BETWEEN '20260301' AND '20260306'

-- Header와 JOIN
SELECT h.InoutNo, h.InoutGubun, h.InoutDate, h.SysCase,
       i.ItemCode, i.ItemName, i.InoutQty, i.InoutAmnt
FROM mmInoutHeader h WITH (NOLOCK)
JOIN mmInoutItem i WITH (NOLOCK)
  ON h.SiteCode = i.SiteCode AND h.InoutNo = i.InoutNo AND h.InoutGubun = i.InoutGubun
WHERE h.InoutDate BETWEEN '20260301' AND '20260306'
```

---

### 3. mmInventory (현재 재고) - 76K건

현재 시점의 실시간 재고 현황. 창고+상태+품목별 재고 수량/금액.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| WhCode | nchar(8) | PK2 | 창고 코드 |
| InvStatus | nchar(8) | PK3 | 재고 상태 (GOOD/POOR) |
| ItemCode | nchar(40) | PK4 | 품목 코드 |
| OhQty | numeric(17) | | 재고 수량 |
| OhAmnt | numeric(17) | | 재고 금액 |

#### 인덱스

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK (Clustered) | SiteCode, WhCode, InvStatus, ItemCode | CLUSTERED |
| IX_..._OhQty | SiteCode, WhCode, InvStatus, OhQty | NONCLUSTERED |

#### 주요 창고별 현재 재고 현황

| 창고코드 | 품목 수 | 총 수량 | 추정 용도 |
|---------|---------|---------|----------|
| MF01 | 848 | 7,959,666 | 주 공장 창고 (최대) |
| MT01 | 83 | 2,163,130 | 자재 창고 |
| MF03 | 371 | 1,926,114 | 공장 부 창고 |
| MF15 | 811 | 569,587 | 공장 보조 창고 |
| MT04 | 132 | 373,291 | 자재 보조 창고 |
| W062 | 24 | 193,576 | 외부 창고 |
| MF24 | 51 | 136,873 | 공장 보조 창고 |

#### 재고 상위 품목 (현재)

| 품목코드 | 창고 | 재고 수량 | bar_shop1 매핑 |
|---------|------|-----------|---------------|
| BSI080 | MT01 | 907,511 | 스티커 |
| FST43_C | MF01 | 252,000 | 식권/부속 |
| DPBM001 | MT04 | 235,557 | - |
| BSI094 | MT01 | 195,900 | 스티커 |
| FST44_C | MF01 | 189,000 | 식권/부속 |
| BE004 | MF01 | 143,142 | 봉투 |

#### 쿼리 팁

```sql
-- 특정 창고의 양품 재고 조회
SELECT ItemCode, OhQty, OhAmnt
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND WhCode = 'MF01' AND InvStatus = 'GOOD'
  AND OhQty > 0
ORDER BY OhQty DESC

-- 특정 품목의 전체 창고 재고
SELECT WhCode, InvStatus, OhQty, OhAmnt
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND ItemCode = 'BSI080'

-- 재고가 있는 품목 수 집계
SELECT WhCode, InvStatus, COUNT(*) as item_count, SUM(OhQty) as total_qty
FROM mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND OhQty > 0
GROUP BY WhCode, InvStatus
ORDER BY total_qty DESC
```

---

### 4. C_mmInvMonth (월별 재고 집계) - 11.6M건

월별 재고 현황 (창고 구분 없이 품목+상태별 집계). 가장 많이 조회되는 재고 테이블.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| InvMonth | nchar(12) | PK2 | 재고 월 (YYYYMM, 예: 202601) |
| ItemCode | nchar(40) | PK3 | 품목 코드 |
| InvStatus | nchar(8) | PK4 | 재고 상태 (GOOD/POOR) |
| OhQty | numeric | | 재고 수량 |
| OhPrice | numeric | | 재고 단가 |
| OhAmnt | numeric | | 재고 금액 |

최신 데이터: **202601** (월 77,353건)

```sql
-- 특정 월의 재고 현황
SELECT ItemCode, InvStatus, OhQty, OhPrice, OhAmnt
FROM C_mmInvMonth WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND InvMonth = '202601' AND OhQty > 0
ORDER BY OhQty DESC

-- 특정 품목의 월별 재고 추이
SELECT InvMonth, OhQty, OhAmnt
FROM C_mmInvMonth WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND ItemCode = 'BSI080' AND InvStatus = 'GOOD'
ORDER BY InvMonth DESC
```

---

### 5. mminvMonth (월별 재고 - 창고별) - 781K건

월별 재고 현황 (창고별). C_mmInvMonth와 유사하나 창고 구분 포함.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| WhCode | nchar(8) | PK2 | 창고 코드 |
| ItemCode | nchar(40) | PK3 | 품목 코드 |
| InvStatus | nchar(8) | PK4 | 재고 상태 |
| InvMonth | nchar(12) | PK5 | 재고 월 (YYYYMM) |
| OhQty | numeric(17) | | 재고 수량 |
| OhPrice | numeric | | 재고 단가 |
| OhAmnt | numeric(17) | | 재고 금액 |

최신 데이터: **202603** (월 1,612건)

```sql
-- 특정 창고의 월별 재고
SELECT ItemCode, InvMonth, OhQty, OhAmnt
FROM mminvMonth WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND WhCode = 'MF01' AND InvMonth = '202603'
  AND OhQty > 0
ORDER BY OhQty DESC
```

---

### 6. C_mmEvaData (재고 평가) - 11.6M건

월별 재고 평가 데이터. 기초재고(S)와 입고(In) 수량/금액, 표준단가.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| InvMonth | nchar(12) | PK2 | 평가 월 (YYYYMM) |
| ItemCode | nchar(40) | PK3 | 품목 코드 |
| InvStatus | nchar(8) | PK4 | 재고 상태 |
| SQty | numeric | | 기초 수량 |
| SAmnt | numeric | | 기초 금액 |
| InQty | numeric | | 입고 수량 |
| InAmnt | numeric | | 입고 금액 |
| StdPrice | numeric | | 표준 단가 |

최신 데이터: **202601** (월 77,353건)

```sql
-- 월별 재고 평가 (이동평균법 기반)
SELECT ItemCode, SQty, SAmnt, InQty, InAmnt, StdPrice
FROM C_mmEvaData WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND InvMonth = '202601' AND InvStatus = 'GOOD'
  AND (SQty > 0 OR InQty > 0)
ORDER BY SAmnt DESC
```

---

### 7. mmRequisitHeader / mmRequisitItem (청구요청)

자재 청구요청 전표. 2026년 3월까지 활발하게 사용 중.

#### mmRequisitHeader (216K건)

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| ReqNo | nchar(32) | PK2 | 청구 번호 (예: MQ2603-B00141) |
| SysCase | nchar(6) | | 사유 코드 |
| CaseCode | nchar(6) | | 사유 세부 코드 |
| ReqDate | nchar(16) | | 청구 일자 |
| ExpectDate | nchar(16) | | 예상 입고일 |
| ReqDept | nchar(16) | | 요청 부서 |
| ReqEmp | nchar(16) | | 요청자 |
| ReqStatus | nchar(2) | | 상태 (A: 진행, B: 보류, C: 완료) |
| ReqDescr | nvarchar(6000) | | 비고 |

#### mmRequisitItem (1.9M건)

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| ReqNo | nchar(32) | PK2 | 청구 번호 |
| ReqSerNo | smallint | PK3 | 순번 |
| WhCode | nchar(8) | | 출고 창고 |
| WhCodeIn | nchar(8) | | 입고 창고 |
| ItemCode | nchar(40) | | 품목 코드 |
| ReqQty | numeric | | 청구 수량 |
| OutQty | numeric | | 출고 수량 |
| ReqItemStatus | nchar(2) | | 품목 상태 |

#### 청구 상태 분포

| 상태 | 건수 | 의미 |
|------|------|------|
| C | 214,830 | 완료 |
| A | 651 | 진행 중 |
| B | 98 | 보류 |

```sql
-- 진행 중인 청구요청 조회
SELECT r.ReqNo, r.ReqDate, r.ExpectDate, r.ReqStatus, r.ReqDescr,
       i.ItemCode, i.WhCode, i.ReqQty, i.OutQty
FROM mmRequisitHeader r WITH (NOLOCK)
JOIN mmRequisitItem i WITH (NOLOCK) ON r.SiteCode = i.SiteCode AND r.ReqNo = i.ReqNo
WHERE r.SiteCode = 'BK10' AND r.ReqStatus = 'A'
ORDER BY r.ReqDate DESC
```

---

### 8. mmInspHeader / mmInspItem (검수)

입고 자재 검수 기록.

#### mmInspHeader (329건)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| SiteCode | nchar(8) | 사이트 코드 |
| InspGubun | nchar(8) | 검수 구분 |
| InspDate | nchar(16) | 검수 일자 |
| ModuleGubun | nchar(4) | 모듈 구분 |
| osCsCode | nchar(16) | 거래처 코드 |
| EmpCode | nchar(24) | 검수자 |

#### mmInspItem (625K건)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| WhCode | nchar(8) | 창고 코드 |
| ItemCode | nchar(40) | 품목 코드 |
| BookQty | numeric | 장부 수량 |
| InspQty | numeric | 실사 수량 |
| InspPrice | numeric | 검수 단가 |
| LotNo | nchar(60) | 로트 번호 |

---

### 9. mmDisposeHeader / mmDisposeitem (폐기)

불량/폐기 자재 처리 기록.

#### mmDisposeHeader (475건)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| DisposeNo | nchar(32) | 폐기 번호 |
| DisposeDate | nchar(16) | 폐기 일자 |
| DisposeAmnt | numeric | 폐기 금액 |
| DisposeExpense | numeric | 폐기 비용 |
| DisposeDescr | nvarchar(240) | 비고 |

#### mmDisposeitem (10K건)

| 컬럼 | 타입 | 설명 |
|------|------|------|
| ItemCode | nchar(40) | 품목 코드 |
| WhCode | nchar(8) | 창고 코드 |
| DisposeQty | numeric | 폐기 수량 |
| DisposePrice | numeric | 폐기 단가 |
| DisposeCause | nchar(16) | 폐기 사유 |

---

### 10. mmStatusChgHeader / mmStatusChgItem (재고 상태 변경)

GOOD ↔ POOR 간 재고 상태 변경 기록 (376건/1,047건).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| ChangeNo | nchar(32) | 변경 번호 |
| ChangeDate | nchar(16) | 변경 일자 |
| BInvStatus | nchar(8) | 변경 전 상태 |
| AInvStatus | nchar(8) | 변경 후 상태 |
| ChangeQty | numeric | 변경 수량 |

---

### 11. mmMonthClose (월마감)

재고 월마감 기록. 최신 마감: **202601** (2026-02-25 실행).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| SiteCode | nchar(8) | 사이트 코드 |
| ModuleGubun | nchar(4) | 모듈 구분 (MM: 자재, SM: 판매) |
| CloseMonth | nchar(12) | 마감 월 (YYYYMM) |
| CloseTime | nchar(40) | 마감 실행 시각 |

```sql
-- 최근 마감 이력 확인
SELECT * FROM mmMonthClose WITH (NOLOCK)
ORDER BY CloseMonth DESC
```

---

### 12. C_mmInoutSumMonth (월별 입출고 요약) - 780K건

월별 입출고 집계. 최신 데이터는 **200809** (2008년 이후 미갱신).

| 컬럼 | 타입 | 설명 |
|------|------|------|
| InvMonth | nchar(12) | 집계 월 |
| InoutGubun | nchar(4) | 입출고 구분 |
| SysCase | nchar(12) | 사유 코드 |
| CaseCode | nchar(12) | 사유 세부 코드 |
| ItemCode | nchar(40) | 품목 코드 |
| WhCode | nchar(8) | 창고 코드 |
| InoutQty | numeric | 수량 |
| InoutAmnt | numeric | 금액 |

> **주의**: 이 테이블은 2008년 9월 이후 갱신되지 않았습니다. 최신 월별 입출고 집계는 mmInoutHeader/mmInoutItem에서 직접 집계해야 합니다.

---

## 테이블 관계도

```
mmRequisitHeader ─┐
  └─ mmRequisitItem ──→ mmInoutHeader ─┐
                                        └─ mmInoutItem ──→ mmInventory (현재 재고)
                                                              ↓
                                                        mminvMonth (창고별 월별)
                                                        C_mmInvMonth (전체 월별)
                                                        C_mmEvaData (재고 평가)
                                                              ↓
                                                        mmMonthClose (월마감)

mmInspHeader ──→ mmInspItem (검수)
mmDisposeHeader ──→ mmDisposeitem (폐기)
mmStatusChgHeader ──→ mmStatusChgItem (상태 변경: GOOD↔POOR)
```

### 키 연결

| 부모 테이블 | 자식 테이블 | 연결 컬럼 |
|------------|-----------|----------|
| mmInoutHeader | mmInoutItem | SiteCode + InoutNo + InoutGubun |
| mmRequisitHeader | mmRequisitItem | SiteCode + ReqNo |
| mmRequisitItem | mmInoutItem | IrNo + IrSerNo (역참조) |
| mmInspHeader | mmInspItem | SiteCode + InspGubun + InspDate + ModuleGubun + osCsCode |

> **주의**: 외래키 제약조건은 없음 (애플리케이션 레벨 관리)

---

## 자주 사용하는 쿼리 패턴

### 특정 기간 입출고 현황

```sql
SELECT h.InoutGubun,
       COUNT(*) as cnt,
       SUM(i.InoutQty) as total_qty,
       SUM(i.InoutAmnt) as total_amnt
FROM mmInoutHeader h WITH (NOLOCK)
JOIN mmInoutItem i WITH (NOLOCK)
  ON h.SiteCode = i.SiteCode AND h.InoutNo = i.InoutNo AND h.InoutGubun = i.InoutGubun
WHERE h.SiteCode = 'BK10'
  AND h.InoutDate BETWEEN '20260201' AND '20260228'
GROUP BY h.InoutGubun
ORDER BY h.InoutGubun
```

### 품목별 재고 추이 (최근 6개월)

```sql
SELECT InvMonth, OhQty, OhAmnt
FROM C_mmInvMonth WITH (NOLOCK)
WHERE SiteCode = 'BK10'
  AND ItemCode = 'BSI080'
  AND InvStatus = 'GOOD'
  AND InvMonth >= '202508'
ORDER BY InvMonth
```

### 재고 부족 품목 확인

```sql
SELECT inv.ItemCode, inv.WhCode, inv.OhQty,
       req.ReqQty, req.OutQty
FROM mmInventory inv WITH (NOLOCK)
LEFT JOIN (
    SELECT ri.ItemCode, ri.WhCode, SUM(ri.ReqQty) as ReqQty, SUM(ri.OutQty) as OutQty
    FROM mmRequisitHeader rh WITH (NOLOCK)
    JOIN mmRequisitItem ri WITH (NOLOCK) ON rh.SiteCode = ri.SiteCode AND rh.ReqNo = ri.ReqNo
    WHERE rh.SiteCode = 'BK10' AND rh.ReqStatus = 'A'
    GROUP BY ri.ItemCode, ri.WhCode
) req ON inv.ItemCode = req.ItemCode AND inv.WhCode = req.WhCode
WHERE inv.SiteCode = 'BK10' AND inv.InvStatus = 'GOOD' AND inv.OhQty > 0
ORDER BY inv.OhQty ASC
```

### 월마감 후 재고 평가 확인

```sql
SELECT e.ItemCode, e.InvStatus,
       e.SQty as 기초수량, e.SAmnt as 기초금액,
       e.InQty as 입고수량, e.InAmnt as 입고금액,
       e.StdPrice as 표준단가,
       m.OhQty as 기말수량, m.OhAmnt as 기말금액
FROM C_mmEvaData e WITH (NOLOCK)
JOIN C_mmInvMonth m WITH (NOLOCK)
  ON e.SiteCode = m.SiteCode AND e.InvMonth = m.InvMonth
  AND e.ItemCode = m.ItemCode AND e.InvStatus = m.InvStatus
WHERE e.SiteCode = 'BK10' AND e.InvMonth = '202601'
  AND e.InvStatus = 'GOOD' AND (e.SQty > 0 OR e.InQty > 0)
ORDER BY e.SAmnt DESC
```

---

## 쿼리 성능 주의사항

1. **mmInoutItem (40M건)**: 반드시 인덱스 컬럼으로 필터링. InoutDate, WhCode, ItemCode 등 활용.
2. **C_mmInvMonth / C_mmEvaData (11.6M건)**: SiteCode + InvMonth로 PK 범위 축소 필수.
3. **mmInoutHeader (5.5M건)**: InoutDate 인덱스(NCI_INOUT_DATE) 또는 SiteCode+InoutDate 복합 인덱스 활용.
4. **날짜 형식**: 모든 날짜 컬럼은 `nchar` 타입으로 `'YYYYMMDD'` 문자열 비교. 함수 변환 불필요.
5. **WITH (NOLOCK)**: 읽기 전용 조회 시 항상 사용 권장.
