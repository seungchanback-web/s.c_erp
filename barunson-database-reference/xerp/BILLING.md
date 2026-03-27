# XERP 매출/매입 모듈 (RP) 상세 문서

> 최종 확인일: 2026-03-06

## 개요

XERP의 매출/매입(RP, Revenue/Payable) 모듈은 청구서, 세금계산서, 수금/지급 예정, 수금 배분 등 매출채권과 매입채무를 관리합니다. 2026년 3월 현재 월 약 8,000건의 청구 트랜잭션이 활발하게 발생하고 있습니다.

- **사이트 코드**: `BK10` (단일)
- **최신 데이터**: 2026-03-06 (당일)
- **매출채권(AR) 비중**: 93.3% / 매입채무(AP) 비중: 6.7%

---

## 비즈니스 프로세스

```
출고(mmInout) → 청구서 발행 (rpBillHeader + rpBillItem)
                     ↓
              세금계산서 발행 (rpInvoiceHeader + rpInvoiceItem)
                     ↓
              수금/지급 예정 (rpMoneyExpect)
                     ↓
              수금/지급 배분 (rpExpectMoneyAlloc)
                     ↓
              회계 전표 (glDocHeader)
```

---

## 핵심 테이블

### RP 모듈 테이블 현황

| 테이블 | 레코드 수 | 설명 |
|--------|-----------|------|
| rpBillItem | 25,786,090 | **청구서 상세** (품목별) |
| rpBillHeader | 4,036,507 | **청구서 헤더** (전표 단위) |
| rpExpectMoneyAlloc | 3,720,700 | 수금/지급 배분 |
| rpInvoiceItem | 2,634,192 | 세금계산서 상세 |
| rpMoneyExpect | 2,579,379 | 수금/지급 예정 |
| rpInvoiceHeader | 192,424 | 세금계산서 헤더 |
| rpInvoice_Excel | 2,336 | 세금계산서 Excel 내역 |
| rpPreAmntBillAlloc | 1,414 | 선급금 청구 배분 |
| rpInvoice_Excel_AP | 1,009 | 세금계산서 Excel (매입) |
| rpFee | 663 | 수수료 |
| rpPreAmntItem | 330 | 선급금 상세 |
| rpPreAmntHeader | 260 | 선급금 헤더 |

---

### 1. rpBillHeader (청구서 헤더) — 4.0M건

매출/매입 청구서의 헤더 정보.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1* | 사이트 코드 (BK10) |
| BillNo | nchar(32) | PK2* | 청구 번호 (예: AR2603-B00001) |
| ArApGubun | nchar(4) | PK3* | **매출/매입 구분** (AR/AP) |
| SysCase | nchar(6) | | 사유 코드 |
| CaseCode | nchar(6) | | 사유 세부 코드 |
| BillDate | nchar(16) | | **청구 일자** (YYYYMMDD) |
| CsCode | nchar(16) | | 거래처 코드 |
| TaxCode | nchar(4) | | 세금 코드 (아래 참조) |
| CurrCode | nchar(6) | | 통화 (KRW) |
| ExchRate | numeric | | 환율 |
| AccCode | nchar(20) | | 계정과목 코드 |
| BillAmnt | numeric | | **청구 금액** |
| VatAmnt | numeric | | 부가세 |
| PreAmnt | numeric | | 선수금 |
| MoneySumAmnt | numeric | | 수금 합계 |
| PostedArApAmnt | numeric | | 전기 매출/매입 금액 |
| PostedVatAmnt | numeric | | 전기 부가세 |
| DeptCode | nchar(16) | | 부서 코드 |
| EmpCode | nchar(16) | | 담당자 코드 |
| BillDescr | nvarchar(160) | | 비고 |
| InvoiceNo | nchar(32) | | 세금계산서 번호 (FK→rpInvoiceHeader) |
| OriginGubun | nchar(8) | | 원본 구분 |
| OriginNo | nchar(32) | | 원본 전표 번호 |
| C_JumunNo | nvarchar(100) | | **주문 번호** (쇼핑몰 연동) |
| C_ShopGroupNo | varchar(50) | | 쇼핑몰 그룹 번호 |
| C_PointAmnt | numeric | | 포인트 금액 |

> *PK는 SiteCode + BillNo + ArApGubun이나, 클러스터드 인덱스는 SiteCode + ArApGubun + BillDate + BillNo입니다.

#### 인덱스

| 인덱스명 | 컬럼 | 유형 | 용도 |
|---------|------|------|------|
| IX_rpBillHeader (Clustered) | SiteCode, ArApGubun, **BillDate**, BillNo | **CLUSTERED** | 날짜별 조회에 최적 |
| PK (Nonclustered) | SiteCode, BillNo, ArApGubun | NONCLUSTERED (Unique) | PK 조회 |
| IDX_rpBillHeader_LSM | SiteCode, InvoiceNo | NONCLUSTERED | 세금계산서 연동 |
| IDX_rpBillHeader_LSM2 | C_JumunNo | NONCLUSTERED | 주문 번호 조회 |
| IDX_rpBillHeader_LSM3 | C_ShopGroupNo | NONCLUSTERED | 쇼핑몰 그룹 조회 |

#### ArApGubun (매출/매입 구분)

| 코드 | 건수 | 비율 | 의미 |
|------|------|------|------|
| AR | 3,766,215 | 93.3% | 매출채권 (Accounts Receivable) |
| AP | 270,226 | 6.7% | 매입채무 (Accounts Payable) |
| Ax | 66 | 0.0% | 기타 |

#### SysCase/CaseCode (사유 코드)

| SysCase | CaseCode | 건수 | 추정 의미 |
|---------|----------|------|----------|
| 270 | 270 | 3,717,809 | 판매 청구 (92.1%) |
| 150 | 150 | 167,991 | 구매/외주 청구 |
| 100 | 101 | 82,942 | 자재 관련 |
| 900 | 900 | 27,379 | 기타 |
| 100 | 100 | 24,682 | 자재 관련 |
| 300 | 300 | 6,683 | 일반 |

#### TaxCode (세금 코드)

| 코드 | 건수 | 의미 |
|------|------|------|
| 22 | 3,098,819 | 과세 (76.8%) |
| 10 | 614,424 | 면세/비과세 (15.2%) |
| 50 | 261,220 | 기타 과세 (6.5%) |
| 20 | 44,178 | 기타 |
| 12 | 7,116 | 기타 |
| 55 | 6,784 | 기타 |

---

### 2. rpBillItem (청구서 상세) — 25.8M건

청구서의 품목별 상세. 하나의 청구서(Header)에 여러 품목(Item)이 포함.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| BillNo | nchar(32) | PK2 | 청구 번호 (FK→rpBillHeader) |
| ArApGubun | nchar(4) | PK3 | 매출/매입 구분 |
| BillSerNo | smallint | PK4 | 순번 |
| ItemCode | nchar(40) | | **품목 코드** |
| ItemName | nvarchar(160) | | 품목명 |
| ItemSpec | nvarchar(200) | | 규격 |
| ItemQty | numeric | | 수량 |
| ItemFreeQty | numeric | | 무상 수량 |
| UnitCode | nchar(8) | | 단위 |
| ItemPrice | numeric | | 단가 |
| ItemAmnt | numeric | | **금액** |
| ItemVatAmnt | numeric | | 부가세 |
| InoutNo | nchar(32) | | 입출고 번호 (FK→mmInoutHeader) |
| InoutGubun | nchar(4) | | 입출고 구분 |
| InoutSerNo | smallint | | 입출고 순번 |
| SalesCostAmnt | numeric | | 매출원가 |
| ItemGubun | nchar(8) | | 품목 구분 |

#### 인덱스

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK (Clustered) | SiteCode, BillNo, ArApGubun, BillSerNo | CLUSTERED |
| idx_rpbillItem_4 | SiteCode, InoutNo, InoutSerNo, ArApGubun, InoutGubun, BillNo | NONCLUSTERED |
| rpBillItem5 | SiteCode, ArApGubun, BlNo, InvSerNo, ItemQty | NONCLUSTERED |

---

### 3. rpInvoiceHeader (세금계산서 헤더) — 192K건

| 컬럼 | 타입 | 설명 |
|------|------|------|
| SiteCode | nchar(8) | 사이트 코드 |
| InvoiceNo | nchar(32) | 세금계산서 번호 |
| ArApGubun | nchar(4) | 매출/매입 구분 |
| OurRegNo | nvarchar(40) | 당사 사업자등록번호 |
| CsCode | nchar(16) | 거래처 코드 |
| CsRegNo | nvarchar(40) | 거래처 사업자등록번호 |
| InvoiceDate | nchar(16) | 발행일 |
| SupplyAmnt | numeric | 공급가액 |
| VatAmnt | numeric | 부가세 |
| TaxCode | nchar(4) | 세금 코드 |
| BillCheck | nchar(2) | 청구 연동 여부 |
| DocNo | nchar(32) | 회계 전표 번호 |
| RelCheck | nchar(2) | 승인 상태 |
| EseroUp | nchar(2) | 전자세금계산서 여부 |
| CsEmail | varchar(40) | 거래처 이메일 |
| CsMobile | nvarchar(40) | 거래처 연락처 |

### 4. rpInvoiceItem (세금계산서 상세) — 2.6M건

| 컬럼 | 타입 | 설명 |
|------|------|------|
| SiteCode | nchar(8) | 사이트 코드 |
| InvoiceNo | nchar(32) | 세금계산서 번호 |
| ArApGubun | nchar(4) | 매출/매입 구분 |
| InvoiceSerNo | smallint | 순번 |
| ItemDate | nchar(16) | 품목 일자 |
| ItemName | nvarchar(160) | 품목명 |
| ItemQty | numeric | 수량 |
| ItemPrice | numeric | 단가 |
| ItemAmnt | numeric | 금액 |
| ItemVatAmnt | numeric | 부가세 |

---

### 5. rpMoneyExpect (수금/지급 예정) — 2.6M건

매출채권의 수금 예정일 및 매입채무의 지급 예정을 관리합니다.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| SiteCode | nchar(8) | 사이트 코드 |
| OriginNo | nchar(32) | 원본 번호 (청구서 번호) |
| OriginSerNo | smallint | 원본 순번 |
| ExpectOrigin | nchar(6) | 예정 출처 |
| CsCode | nchar(16) | 거래처 코드 |
| ExpectPayCode | nchar(4) | 결제 수단 코드 |
| ExpectAmnt | numeric | 예정 금액 |
| ExpectRemainAmnt | numeric | 미수 잔액 |
| ExpectDate | nchar(16) | 예정일 |
| ArApAcc | nchar(20) | 매출/매입 계정 |
| C_JumunNo | nvarchar(40) | 주문 번호 |

### 6. rpExpectMoneyAlloc (수금/지급 배분) — 3.7M건

실제 수금/지급 시 예정 건에 대한 배분 기록.

| 컬럼 | 타입 | 설명 |
|------|------|------|
| SiteCode | nchar(8) | 사이트 코드 |
| OriginNo | nchar(32) | 원본 번호 |
| OriginSerNo | smallint | 원본 순번 |
| AllocSerNo | smallint | 배분 순번 |
| DocNo | nchar(32) | 회계 전표 번호 |
| AllocDate | nchar(16) | 배분일 |
| AllocAmnt | numeric | 배분 금액 |
| ArApGubun | nchar(4) | 매출/매입 구분 |
| PayCode | nchar(4) | 결제 수단 |
| C_JumunNo | nchar(40) | 주문 번호 |

---

## 월별 활동량 (최근 6개월)

| 월 | 청구 건수 | 청구 금액 합계 (원) |
|----|----------|-------------------|
| 2026-03 | 996 (진행 중) | 133,861,421 |
| 2026-02 | 7,993 | 1,058,054,603 |
| 2026-01 | 9,130 | 1,447,346,646 |
| 2025-12 | 7,733 | 1,228,485,990 |
| 2025-11 | 6,938 | 1,277,904,806 |
| 2025-10 | 8,220 | 1,199,637,279 |

> 월 평균 약 12억원, 8,000건의 청구가 발생합니다.

---

## 테이블 관계도

```
mmInoutHeader (입출고)
  └─→ rpBillHeader (청구서 헤더)
        ├─ rpBillItem (청구서 상세)
        │    └─ [InoutNo, InoutGubun, InoutSerNo → mmInoutItem 역참조]
        │
        ├─→ rpInvoiceHeader (세금계산서 헤더)
        │     └─ rpInvoiceItem (세금계산서 상세)
        │
        ├─→ rpMoneyExpect (수금/지급 예정)
        │     └─ rpExpectMoneyAlloc (수금/지급 배분)
        │
        └─→ glDocHeader (회계 전표)
```

### 키 연결

| 부모 | 자식 | 연결 컬럼 |
|------|------|----------|
| rpBillHeader | rpBillItem | SiteCode + BillNo + ArApGubun |
| rpBillHeader | rpInvoiceHeader | InvoiceNo |
| rpBillItem | mmInoutItem | InoutNo + InoutGubun + InoutSerNo |
| rpBillHeader | rpMoneyExpect | BillNo (OriginNo) |
| rpMoneyExpect | rpExpectMoneyAlloc | OriginNo + OriginSerNo |
| rpBillHeader | glDocHeader | 회계 전표 자동 생성 |

---

## 자주 사용하는 쿼리 패턴

### 기간별 청구 조회

```sql
-- 클러스터드 인덱스 활용 (SiteCode + ArApGubun + BillDate)
SELECT BillNo, BillDate, CsCode, BillAmnt, VatAmnt, BillDescr
FROM rpBillHeader WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND ArApGubun = 'AR'
  AND BillDate BETWEEN '20260301' AND '20260306'
ORDER BY BillDate DESC
```

### 매출/매입별 월 집계

```sql
SELECT ArApGubun,
       LEFT(BillDate, 6) AS bill_month,
       COUNT(*) AS cnt,
       SUM(BillAmnt) AS total_amnt,
       SUM(VatAmnt) AS total_vat
FROM rpBillHeader WITH (NOLOCK)
WHERE SiteCode = 'BK10'
  AND BillDate BETWEEN '20260201' AND '20260228'
GROUP BY ArApGubun, LEFT(BillDate, 6)
```

### 청구서 + 품목 상세

```sql
SELECT h.BillNo, h.BillDate, h.ArApGubun, h.CsCode, h.BillAmnt,
       i.ItemCode, i.ItemName, i.ItemQty, i.ItemPrice, i.ItemAmnt
FROM rpBillHeader h WITH (NOLOCK)
JOIN rpBillItem i WITH (NOLOCK)
  ON h.SiteCode = i.SiteCode AND h.BillNo = i.BillNo AND h.ArApGubun = i.ArApGubun
WHERE h.SiteCode = 'BK10' AND h.BillNo = 'AR2603-B00001'
ORDER BY i.BillSerNo
```

### 주문 번호로 청구 조회 (쇼핑몰 연동)

```sql
-- C_JumunNo 인덱스 활용
SELECT BillNo, BillDate, ArApGubun, BillAmnt, VatAmnt
FROM rpBillHeader WITH (NOLOCK)
WHERE C_JumunNo = '주문번호'
```

### 거래처별 매출 순위

```sql
SELECT TOP 20 CsCode,
       COUNT(*) AS bill_count,
       SUM(BillAmnt) AS total_amnt
FROM rpBillHeader WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND ArApGubun = 'AR'
  AND BillDate BETWEEN '20260201' AND '20260228'
GROUP BY CsCode
ORDER BY total_amnt DESC
```

### 미수금 확인 (수금 예정 vs 실제 수금)

```sql
SELECT me.OriginNo, me.CsCode,
       me.ExpectAmnt,
       me.ExpectRemainAmnt,
       me.ExpectDate,
       ISNULL(SUM(ma.AllocAmnt), 0) AS allocated_amnt
FROM rpMoneyExpect me WITH (NOLOCK)
LEFT JOIN rpExpectMoneyAlloc ma WITH (NOLOCK)
  ON me.SiteCode = ma.SiteCode
  AND me.OriginNo = ma.OriginNo AND me.OriginSerNo = ma.OriginSerNo
WHERE me.SiteCode = 'BK10'
  AND me.ExpectRemainAmnt > 0
GROUP BY me.OriginNo, me.CsCode, me.ExpectAmnt, me.ExpectRemainAmnt, me.ExpectDate
ORDER BY me.ExpectRemainAmnt DESC
```

### 입출고 → 청구 연동 확인

```sql
-- rpBillItem의 InoutNo로 입출고 원본 추적
SELECT bi.BillNo, bi.ItemCode, bi.ItemQty, bi.ItemAmnt,
       bi.InoutNo, bi.InoutGubun, bi.InoutSerNo
FROM rpBillItem bi WITH (NOLOCK)
WHERE bi.SiteCode = 'BK10' AND bi.InoutNo IS NOT NULL
  AND bi.BillNo = 'AR2603-B00001'
```

---

## 쿼리 성능 주의사항

1. **rpBillItem (25.8M건)**: 가장 대용량. 반드시 BillNo 또는 InoutNo 인덱스 활용
2. **rpBillHeader 클러스터드 인덱스**: SiteCode + ArApGubun + BillDate + BillNo — 날짜 범위 조회에 최적
3. **C_JumunNo 인덱스**: 쇼핑몰 주문 연동 시 활용
4. **청구 번호 패턴**: `AR{YYMM}-B{NNNNN}` (매출) / `AP{YYMM}-B{NNNNN}` (매입)
5. 날짜 형식: 모든 날짜 컬럼은 `nchar` 타입, `'YYYYMMDD'` 문자열 비교
6. WITH (NOLOCK) 힌트 항상 사용 권장
