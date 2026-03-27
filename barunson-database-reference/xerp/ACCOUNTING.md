# XERP 회계 모듈 (GL) 상세 문서

> 최종 확인일: 2026-03-06

## 개요

XERP의 회계(GL, General Ledger) 모듈은 전표 생성, 원장 기록, 관리항목 매핑 등 회계 전반의 데이터를 관리합니다. 2026년 3월 현재 월 약 6,000건의 전표가 활발하게 생성되고 있습니다.

- **사이트 코드**: `BK10` (단일)
- **최신 데이터**: 2026-03-10 (미래 날짜 전표 존재 — 예약/선기표)
- **전표 상태**: 99.97% 승인 완료(RelCheck=Y)

---

## 비즈니스 프로세스

```
거래 발생 → 전표 생성 (glDocHeader + glDocItem)
                ↓
         관리항목 매핑 (glDocMngMapping)
                ↓
         원장 누계 (glMngCum, glCsCum, glDeptCum, glStdCum 등)
                ↓
         재무제표 (glBeforeFs)
```

---

## 핵심 테이블

### GL 모듈 테이블 현황

| 테이블 | 레코드 수 | 설명 |
|--------|-----------|------|
| glDocItem | 17,615,212 | 전표 상세 (차변/대변 항목) |
| glDocMngMapping | 13,776,428 | 관리항목 매핑 |
| glDocHeader | 4,298,851 | **전표 헤더** |
| glDocMngMapping_temp | 1,703,274 | 관리항목 매핑 (임시) |
| glMngCum | 1,541,542 | 관리항목별 누계 |
| glCsDeptCum | 871,276 | 거래처-부서별 누계 |
| gldocheaderChar | 608,947 | 전표 헤더 문자 데이터 |
| gldocheaderIdx | 605,641 | 전표 헤더 인덱스 데이터 |
| glCsCum | 584,887 | 거래처별 누계 |
| glStdMngCum | 535,807 | 표준 관리항목 누계 |
| glDocItem_temp | 451,040 | 전표 상세 (임시) |
| glStdCum | 281,417 | 표준 누계 |
| glDocHeader_temp | 82,434 | 전표 헤더 (임시) |
| glDeptCum | 17,166 | 부서별 누계 |
| glAccCum | 1,931 | 계정과목별 누계 |
| glBeforeFs | 739 | 전기 재무제표 |
| glAccMngMapping | 661 | 계정-관리항목 매핑 |
| glPendingOrigin | 360 | 미결 원본 |
| glRegItem | 138 | 정기 전표 항목 |
| glMngMaster | 53 | 관리항목 마스터 |
| glRegHeader | 39 | 정기 전표 헤더 |

---

### 1. glDocHeader (전표 헤더) — 4.3M건

회계 전표의 헤더 정보. 하나의 전표에 여러 차변/대변 항목(glDocItem)이 포함됩니다.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1* | 사이트 코드 (BK10) |
| DocNo | nchar(32) | PK2* | 전표 번호 (예: GL2603-B00990) |
| DocGubun | nchar(2) | | 전표 구분 (C: 일반 99.99%) |
| DocDate | nchar(16) | | **전표 일자** (YYYYMMDD) |
| DeptCode | nchar(16) | | 부서 코드 |
| RelCheck | nchar(2) | | 승인 상태 (Y: 승인 99.97%, N: 미승인) |
| RelDate | nchar(16) | | 승인 일자 |
| DocType | nvarchar(8) | | 전표 유형 (아래 참조) |
| EmpCode | nchar(16) | | 담당자 코드 |
| SettleTerm | smallint | | 결산 기간 |
| OriginSite | nchar(8) | | 원본 사이트 |
| OriginNo | nchar(32) | | **원본 전표 번호** (다른 모듈 연동) |
| DocDescr | nvarchar(510) | | 전표 적요 |
| SystemDate | datetime | | 시스템 등록 일시 |

> *PK는 SiteCode + DocNo이나, 클러스터드 인덱스는 RelDate + RelCheck + SiteCode입니다.

#### 인덱스

| 인덱스명 | 컬럼 | 유형 | 용도 |
|---------|------|------|------|
| IX_glDocHeader (Clustered) | RelDate, RelCheck, SiteCode | **CLUSTERED** | 승인일 기준 정렬 |
| PK_glDocHeader | SiteCode, DocNo | NONCLUSTERED (Unique) | PK 조회 |
| IDX_glDocHeader_LSM | OriginNo | NONCLUSTERED | 원본 전표 역추적 |

> **주의**: 클러스터드 인덱스가 RelDate 기준이므로, DocDate로 조회 시 클러스터드 인덱스 스캔이 발생합니다. DocDate 범위 조회 시 성능에 유의하세요.

#### DocGubun (전표 구분)

| 코드 | 건수 | 의미 |
|------|------|------|
| C | 4,298,846 | 일반 전표 (99.99%) |
| A | 3 | 기타 |
| B | 2 | 기타 |

#### DocType (전표 유형)

| 코드 | 건수 | 추정 의미 |
|------|------|----------|
| NULL | 4,170,714 | 자동 생성 전표 (96.7%) |
| 090 | 55,277 | 수동 일반 전표 |
| 220 | 33,719 | 매출 관련 |
| 567 | 11,154 | 원가 관련 |
| 120 | 7,784 | 매입 관련 |
| 230 | 6,994 | 매출원가 |
| C | 3,395 | 결산 |
| 994 | 2,835 | 기타 |

---

### 2. glDocItem (전표 상세) — 17.6M건

전표의 차변(Debit)/대변(Credit) 항목. 복식부기 원칙에 따라 차변 합계 = 대변 합계.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| DocNo | nchar(32) | PK2 | 전표 번호 (FK→glDocHeader) |
| DocSerNo | smallint | PK3 | 순번 |
| AccCode | nchar(20) | | **계정과목 코드** |
| DrCr | nchar(2) | | **차대 구분** (D: 차변, C: 대변) |
| DocAmnt | numeric | | **금액** |
| DocDescr | nvarchar(160) | | 적요 |
| CsCode | nchar(16) | | 거래처 코드 |
| VatBillNo | nchar(32) | | 세금계산서 번호 |
| TeCode | nchar(16) | | 과세 코드 |

#### 인덱스

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK (Clustered) | SiteCode, DocNo, DocSerNo | CLUSTERED |
| IDX_glDocItem_LSM | AccCode | NONCLUSTERED |
| IDX_glDocItem_LSM2 | CsCode | NONCLUSTERED |
| idxglDocItem_01 | SiteCode, DocNo, AccCode, DrCr, DocAmnt, CsCode | NONCLUSTERED |

#### 차대 구분 분포

| 코드 | 건수 | 합계 금액 |
|------|------|----------|
| D (차변) | 6,838,146 | 3,499,458,574,640원 |
| C (대변) | 10,777,066 | 3,498,659,125,917원 |

> 차변/대변 합계가 거의 일치 (차이 약 8억원은 미승인 전표로 추정)

#### 주요 계정과목 코드 (AccCode)

| 코드 | 건수 | 추정 의미 |
|------|------|----------|
| 11125101 | 4,198,855 | 외상매출금 |
| 21330101 | 2,863,022 | 선수금 |
| 61110101 | 2,276,606 | 상품매출 |
| 11135101 | 2,255,867 | 미수금 |
| 61110121 | 1,693,048 | 상품매출(온라인) |
| 11110151 | 1,264,544 | 보통예금 |
| 61115101 | 1,105,559 | 제품매출 |
| 73183104 | 1,098,906 | 판매수수료 |

---

### 3. glDocMngMapping (관리항목 매핑) — 13.8M건

전표 항목에 대한 관리항목(거래처, 부서, 프로젝트 등) 매핑.

| 컬럼 | 타입 | PK | 설명 |
|------|------|-----|------|
| SiteCode | nchar(8) | PK1 | 사이트 코드 |
| DocNo | nchar(32) | PK2 | 전표 번호 |
| DocSerNo | int | PK3 | 전표 순번 |
| MngSerNo | smallint | PK4 | 관리항목 순번 |
| MngCode | nchar(8) | | 관리항목 코드 |
| MngData | nvarchar(160) | | 관리항목 값 |

---

## 월별 활동량 (최근 6개월)

| 월 | 전표 건수 |
|----|----------|
| 2026-03 | 988 (진행 중) |
| 2026-02 | 6,158 |
| 2026-01 | 6,988 |
| 2025-12 | 6,250 |
| 2025-11 | 5,619 |
| 2025-10 | 6,890 |

---

## 테이블 관계도

```
glDocHeader (전표 헤더)
  ├─ glDocItem (전표 상세: 차변/대변)
  │    └─ glDocMngMapping (관리항목 매핑)
  │
  ├─ [원본 연동] OriginNo → mmInoutHeader, rpBillHeader 등
  │
  └─ [누계 테이블]
       ├─ glMngCum (관리항목별 누계)
       ├─ glCsCum (거래처별 누계)
       ├─ glCsDeptCum (거래처-부서별 누계)
       ├─ glDeptCum (부서별 누계)
       ├─ glStdCum (표준 누계)
       ├─ glStdMngCum (표준 관리항목 누계)
       └─ glAccCum (계정과목별 누계)
```

### 키 연결

| 부모 | 자식 | 연결 컬럼 |
|------|------|----------|
| glDocHeader | glDocItem | SiteCode + DocNo |
| glDocItem | glDocMngMapping | SiteCode + DocNo + DocSerNo |
| glDocHeader | mmInoutHeader | OriginNo (역참조, DocNo ↔ mmInoutHeader.DocNo) |
| glDocHeader | rpBillHeader | OriginNo (역참조) |

---

## 자주 사용하는 쿼리 패턴

### 특정 기간 전표 조회

```sql
-- PK 인덱스 활용 (SiteCode + DocNo)
SELECT h.DocNo, h.DocDate, h.DocType, h.DocDescr, h.SystemDate
FROM glDocHeader h WITH (NOLOCK)
WHERE h.SiteCode = 'BK10' AND h.DocNo = 'GL2603-B00990'

-- 날짜 범위 조회 (주의: DocDate에 직접 인덱스 없음)
-- 승인된 전표만 조회 시 클러스터드 인덱스 활용 가능
SELECT h.DocNo, h.DocDate, h.DocDescr
FROM glDocHeader h WITH (NOLOCK)
WHERE h.RelDate BETWEEN '20260301' AND '20260306'
  AND h.RelCheck = 'Y' AND h.SiteCode = 'BK10'
```

### 전표 상세 (차변/대변) 조회

```sql
SELECT h.DocNo, h.DocDate, h.DocDescr,
       i.DocSerNo, i.AccCode, i.DrCr, i.DocAmnt, i.DocDescr as ItemDescr, i.CsCode
FROM glDocHeader h WITH (NOLOCK)
JOIN glDocItem i WITH (NOLOCK)
  ON h.SiteCode = i.SiteCode AND h.DocNo = i.DocNo
WHERE h.SiteCode = 'BK10' AND h.DocNo = 'GL2603-B00990'
ORDER BY i.DocSerNo
```

### 계정과목별 월 집계

```sql
SELECT i.AccCode, i.DrCr,
       COUNT(*) AS cnt,
       SUM(i.DocAmnt) AS total_amnt
FROM glDocHeader h WITH (NOLOCK)
JOIN glDocItem i WITH (NOLOCK)
  ON h.SiteCode = i.SiteCode AND h.DocNo = i.DocNo
WHERE h.SiteCode = 'BK10'
  AND h.RelDate BETWEEN '20260201' AND '20260228'
  AND h.RelCheck = 'Y'
GROUP BY i.AccCode, i.DrCr
ORDER BY total_amnt DESC
```

### 거래처별 거래 내역

```sql
-- CsCode 인덱스 활용
SELECT i.CsCode, i.DrCr,
       COUNT(*) AS cnt,
       SUM(i.DocAmnt) AS total_amnt
FROM glDocItem i WITH (NOLOCK)
WHERE i.CsCode = '1450071'
GROUP BY i.CsCode, i.DrCr
```

### 미승인 전표 확인

```sql
SELECT DocNo, DocDate, DocDescr, SystemDate
FROM glDocHeader WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND RelCheck = 'N'
ORDER BY DocDate DESC
```

### 다른 모듈에서 생성된 전표 추적

```sql
-- OriginNo로 원본 전표 역추적
SELECT h.DocNo, h.DocDate, h.OriginNo, h.DocDescr
FROM glDocHeader h WITH (NOLOCK)
WHERE h.OriginNo IS NOT NULL AND h.OriginNo != ''
  AND h.SiteCode = 'BK10'
  AND h.RelDate BETWEEN '20260301' AND '20260306'
```

---

## 쿼리 성능 주의사항

1. **클러스터드 인덱스가 RelDate + RelCheck + SiteCode** — DocDate가 아님에 주의
2. DocDate 범위 검색 시 성능이 떨어질 수 있음 → 가능하면 RelDate 활용
3. **glDocItem (17.6M건)**: AccCode 또는 CsCode 인덱스 활용 권장
4. **glDocMngMapping (13.8M건)**: SiteCode + DocNo + DocSerNo PK로만 조회
5. 전표 번호 패턴: `GL{YYMM}-B{NNNNN}` (예: GL2603-B00990 = 2026년 3월)
