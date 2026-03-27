# 데이터베이스 쿼리 작성 가이드라인

이 문서는 AI 및 개발자가 바른손 데이터베이스에 대한 쿼리와 애플리케이션을 작성할 때 참고하는 가이드라인입니다.

---

## 1. 문서 활용 방법

### 1.1 문서 탐색 순서

1. **README.md** - 전체 시스템 개요, 데이터베이스 목록 파악
2. **CONNECTION.md** - 접속 방법 및 쿼리 실행 방법
3. **GUIDELINE.md** (이 문서) - 쿼리 작성 규칙 및 성능 최적화
4. **해당 DB의 SCHEMA.md** - 테이블/컬럼 구조 확인
5. **해당 DB의 ERD.md** - 테이블 간 관계 확인
6. **해당 DB의 INDEXES.md** - 인덱스 정보 확인 (성능 최적화)
7. **queries/COMMON_QUERIES.md** - 검증된 쿼리 패턴 참조

### 1.2 데이터베이스 선택 기준

| 요구사항 | 대상 DB | 핵심 테이블 |
|----------|---------|------------|
| 디지털 상품/MC 시리즈 조회 | barunson | TB_Product, TB_Order, TB_Invitation |
| 실물 카드 상품 조회 | bar_shop1 | S2_Card, custom_order, custom_order_item |
| MC 사용자 수 집계 | barunson | TB_Invitation (TB_Order 아님!) |
| 카드 종류/브랜드 분류 | bar_shop1 | S2_Card, S2_CardKind, S2_CardKindInfo |
| 배송 정보 | bar_shop1 | DELIVERY_INFO, DELIVERY_INFO_DETAIL |
| ERP 데이터 (2001-현재) | XERP | 모듈별 테이블 |
| 과거 ERP 데이터 (2005-2011) | Dshuffle | 모듈별 테이블 |

---

## 2. 개인정보 보호 (PII Masking)

### 2.1 필수 원칙

쿼리 결과를 **화면에 표시하거나 보고서로 출력**할 때, 개인정보(PII)는 반드시 `'*'`로 마스킹하여 표시해야 합니다.

> **예외**: 데이터 다운로드/추출(export, ETL, 백업, 마이그레이션) 목적의 쿼리에는 마스킹을 적용하지 않습니다.

### 2.2 마스킹 대상 필드

| 개인정보 유형 | 대상 테이블.컬럼 예시 | 마스킹 규칙 |
|-------------|---------------------|------------|
| **이름** | TB_Order.Name, TB_Invitation_Detail.Groom_Name, Bride_Name, 부모님 이름 등 | 첫 글자만 표시: `홍**` |
| **이메일** | TB_Order.Email, S2_UserInfo.umail | 앞 3자만 표시: `use****@****.com` |
| **전화번호** | TB_Order.CellPhone_Number, Groom_Phone, Bride_Phone 등 | 중간 마스킹: `010-****-5678` |
| **주소** | TB_Invitation_Detail.Weddinghall_Address, S2_UserInfo.address, DELIVERY_INFO.ADDR | 상세주소 마스킹: `서울시 강남구 ***` |
| **계좌번호** | TB_Account.Account_Number, TB_Account_Extra.Account_Number, TB_Remit.Account_Number | 뒤 4자리만 표시: `*********1234` |
| **주민번호/생년월일** | S2_UserInfo.jumin, S2_UserInfo.birth | 전체 마스킹 또는 연도만: `1990-**-**` |

### 2.3 SQL Server 마스킹 함수 패턴

```sql
-- 이름 마스킹 (첫 글자 + **)
SELECT
    LEFT(Name, 1) + REPLICATE('*', LEN(Name) - 1) AS Name_Masked
FROM TB_Order

-- 이메일 마스킹 (앞 3자 + ****@****.com)
SELECT
    LEFT(Email, 3) + '****@****' +
    RIGHT(Email, LEN(Email) - CHARINDEX('@', Email) - CHARINDEX('.', REVERSE(Email)))
    AS Email_Masked
FROM TB_Order

-- 간편 이메일 마스킹 (앞 3자 + ****)
SELECT
    LEFT(Email, 3) + REPLICATE('*', 4) AS Email_Masked
FROM TB_Order

-- 전화번호 마스킹 (010-****-5678)
SELECT
    LEFT(CellPhone_Number, 3) + '-****-' + RIGHT(CellPhone_Number, 4) AS Phone_Masked
FROM TB_Order

-- 계좌번호 마스킹 (뒤 4자리만 표시)
SELECT
    REPLICATE('*', LEN(Account_Number) - 4) + RIGHT(Account_Number, 4) AS Account_Masked
FROM TB_Account

-- 주소 마스킹 (시/구까지만 표시)
SELECT
    CASE
        WHEN CHARINDEX(' ', Weddinghall_Address, CHARINDEX(' ', Weddinghall_Address) + 1) > 0
        THEN LEFT(Weddinghall_Address,
             CHARINDEX(' ', Weddinghall_Address, CHARINDEX(' ', Weddinghall_Address) + 1))
             + '***'
        ELSE '***'
    END AS Address_Masked
FROM TB_Invitation_Detail
```

### 2.4 전체 적용 예시

```sql
-- 주문 목록 조회 (화면 표시용 - 마스킹 적용)
SELECT
    o.Order_ID,
    LEFT(o.Name, 1) + REPLICATE('*', LEN(o.Name) - 1) AS Name,
    LEFT(o.Email, 3) + '****' AS Email,
    LEFT(o.CellPhone_Number, 3) + '-****-' + RIGHT(o.CellPhone_Number, 4) AS Phone,
    o.Total_Price,
    o.Order_Status_Code
FROM TB_Order o
WHERE Order_DateTime >= '2025-01-01' AND Order_DateTime < '2025-02-01'

-- 초대장 정보 조회 (화면 표시용 - 마스킹 적용)
SELECT
    i.Invitation_ID,
    LEFT(d.Groom_Name, 1) + '**' AS Groom_Name,
    LEFT(d.Bride_Name, 1) + '**' AS Bride_Name,
    d.WeddingDate,
    d.Weddinghall_Name,
    LEFT(d.Weddinghall_Address, CHARINDEX(' ', d.Weddinghall_Address, CHARINDEX(' ', d.Weddinghall_Address) + 1)) + '***' AS Address
FROM TB_Invitation i
JOIN TB_Invitation_Detail d ON i.Invitation_ID = d.Invitation_ID
WHERE i.Invitation_ID = {id}

-- 데이터 추출 (다운로드/ETL 목적 - 마스킹 불필요)
SELECT o.Name, o.Email, o.CellPhone_Number, o.Total_Price
FROM TB_Order o
WHERE Order_DateTime >= '2025-01-01'
```

### 2.5 bar_shop1 개인정보 마스킹

```sql
-- 사용자 정보 조회 (화면 표시용)
SELECT
    uid,
    LEFT(uname, 1) + REPLICATE('*', LEN(uname) - 1) AS uname,
    LEFT(umail, 3) + '****' AS umail,
    LEFT(birth, 4) + '-**-**' AS birth
FROM S2_UserInfo
WHERE uid = {user_id}

-- 배송 정보 조회 (화면 표시용)
SELECT
    ORDER_SEQ,
    LEFT(NAME, 1) + REPLICATE('*', LEN(NAME) - 1) AS NAME,
    LEFT(PHONE, 3) + '-****-' + RIGHT(PHONE, 4) AS PHONE,
    LEFT(ADDR, CHARINDEX(' ', ADDR, CHARINDEX(' ', ADDR) + 1)) + '***' AS ADDR
FROM DELIVERY_INFO
WHERE ORDER_SEQ = {order_seq}
```

### 2.6 적용 기준 요약

| 용도 | 마스킹 적용 | 설명 |
|------|-----------|------|
| 화면 표시 / UI | **필수** | 모든 PII 마스킹 |
| 보고서 / 리포트 출력 | **필수** | 모든 PII 마스킹 |
| 로그 / 디버깅 출력 | **필수** | 모든 PII 마스킹 |
| API 응답 (일반) | **필수** | 모든 PII 마스킹 |
| 데이터 다운로드 / Export | 불필요 | 원본 데이터 허용 |
| ETL / 마이그레이션 | 불필요 | 원본 데이터 허용 |
| 백업 / 복원 | 불필요 | 원본 데이터 허용 |
| 집계 / 통계 (개인 식별 불가) | 불필요 | COUNT, SUM 등 |

---

## 3. 쿼리 성능 최적화 (인덱스 활용 및 Row Scan 방지)

### 3.1 핵심 원칙: 인덱스를 반드시 활용하라

SQL Server는 인덱스가 없는 컬럼을 조건으로 사용하면 **테이블 풀 스캔(Table Scan / Clustered Index Scan)**을 수행합니다. 대용량 테이블에서 이는 치명적인 성능 저하를 유발합니다.

#### Row Scan이 발생하는 패턴 (피해야 할 것)

```sql
-- BAD: 인덱스 없는 컬럼으로 필터링 → Full Table Scan
SELECT * FROM TB_Order WHERE Name = N'홍길동'  -- 이름은 PII, 결과 표시 시 마스킹 필요

-- BAD: LIKE 와일드카드 시작 → Index Seek 불가
SELECT * FROM S2_Card WHERE Card_Code LIKE '%4914'

-- BAD: 컬럼에 함수 적용 → 인덱스 무효화
SELECT * FROM TB_Order WHERE YEAR(Regist_DateTime) = 2025

-- BAD: 암묵적 타입 변환 → 인덱스 무효화
SELECT * FROM TB_Order WHERE Order_ID = '12345'  -- Order_ID는 int

-- BAD: OR 조건으로 인덱스 분산
SELECT * FROM TB_Order WHERE Email = 'user@mail.com' OR Name = N'홍길동'
```

#### 인덱스를 활용하는 패턴 (사용해야 할 것)

```sql
-- GOOD: PK 인덱스 활용
SELECT * FROM TB_Order WHERE Order_ID = 12345

-- GOOD: 인덱스가 있는 컬럼으로 필터링
SELECT * FROM TB_Order WHERE Email = 'user@mail.com'
-- IX_TB_Order_Email 인덱스 활용

-- GOOD: 날짜 범위를 SARGable하게 작성
SELECT * FROM TB_Order
WHERE Regist_DateTime >= '2025-01-01' AND Regist_DateTime < '2025-02-01'

-- GOOD: LIKE는 접두어 매칭만
SELECT * FROM S2_Card WHERE Card_Code LIKE 'BC%'

-- GOOD: OR 대신 UNION ALL 사용
SELECT * FROM TB_Order WHERE Email = 'user@mail.com'
UNION ALL
SELECT * FROM TB_Order WHERE Order_ID = 12345
```

### 3.2 SARGable 쿼리 작성법

**SARGable** (Search ARGument ABLE) = 인덱스를 효과적으로 활용할 수 있는 조건식

| 패턴 | SARGable | 비고 |
|------|----------|------|
| `Column = value` | O | Index Seek |
| `Column > value` | O | Index Range Scan |
| `Column BETWEEN a AND b` | O | Index Range Scan |
| `Column LIKE 'prefix%'` | O | Index Range Scan |
| `Column IN (a, b, c)` | O | Multiple Index Seek |
| `FUNCTION(Column) = value` | X | Full Scan |
| `Column LIKE '%suffix'` | X | Full Scan |
| `Column + 1 = value` | X | Full Scan |
| `CAST(Column AS type) = value` | X | Full Scan |
| `ISNULL(Column, default) = value` | X | Full Scan |

#### 함수 사용 시 변환 방법

```sql
-- BAD: 컬럼에 함수 적용
WHERE YEAR(Regist_DateTime) = 2025 AND MONTH(Regist_DateTime) = 3

-- GOOD: 범위 조건으로 변환
WHERE Regist_DateTime >= '2025-03-01' AND Regist_DateTime < '2025-04-01'

-- BAD: CONVERT/CAST로 컬럼 변환
WHERE CONVERT(varchar, Payment_DateTime, 112) = '20250301'

-- GOOD: 값 쪽을 변환
WHERE Payment_DateTime >= '2025-03-01' AND Payment_DateTime < '2025-03-02'

-- BAD: ISNULL로 인덱스 무효화
WHERE ISNULL(Order_Status_Code, '') = 'OSC02'

-- GOOD: IS NULL 별도 처리
WHERE Order_Status_Code = 'OSC02'
```

### 3.3 barunson DB 인덱스 활용 가이드

#### TB_Order (가장 중요한 테이블)

| 인덱스명 | 컬럼 | 유형 | 용도 |
|---------|------|------|------|
| PK_TB_Order | Order_ID | Clustered, Unique | 주문 PK 조회 |
| NCIDX_Order_Code | Order_Code | Nonclustered, Unique | 주문코드 조회 |
| IX_TB_Order_Email | Email | Nonclustered | 이메일 기반 조회 |
| IX_TB_Order_MemberId | Member_ID | Nonclustered | 회원 ID 조회 |
| IX_TB_Order_User_ID | User_ID | Nonclustered | 사용자 ID 조회 |
| IX_TB_Order_Order_DateTime | Order_DateTime | Nonclustered | 주문일시 범위 조회 |
| IX_TB_Order_Payment_DateTime | Payment_DateTime | Nonclustered | 결제일시 범위 조회 |
| IX_TB_Order_REegist_Date | Regist_DateTime | Nonclustered | 등록일시 범위 조회 |
| IX_TB_Order_OrderSeq | OrderSeq | Nonclustered | 주문순번 조회 |

**쿼리 예시:**
```sql
-- GOOD: 인덱스 활용 (Order_DateTime 인덱스)
SELECT * FROM TB_Order
WHERE Order_DateTime >= '2025-01-01' AND Order_DateTime < '2025-02-01'

-- GOOD: PK 인덱스 활용
SELECT * FROM TB_Order WHERE Order_ID = 12345

-- GOOD: Email 인덱스 활용
SELECT * FROM TB_Order WHERE Email = 'user@mail.com'
```

#### TB_Invitation (MC 사용자 추적 핵심)

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK_TB_Invitation | Invitation_ID | Clustered, Unique |
| IX_TB_Invitation_Order_ID | Order_ID | Nonclustered, Unique |
| Idx_tb_invitation_template_id | Template_ID | Nonclustered |

#### TB_Invitation_Detail

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK_TB_Invitation_Detail | Invitation_ID | Clustered, Unique |
| NCIDX_Invitation_Detail_URL | URL 컬럼 | Nonclustered, Unique |

#### TB_Product

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK_TB_Product | Product_ID | Clustered, Unique |

> 주의: TB_Product에는 Product_Code 인덱스가 없습니다. `WHERE Product_Code = 'MC4114'` 조회 시 Full Scan이 발생할 수 있으나, 테이블 크기가 작아 영향이 적습니다.

#### 기타 주요 인덱스

| 테이블 | 인덱스 | 용도 |
|--------|--------|------|
| TB_Order_Product | IX_TB_Order_Product_ProductID | Product_ID로 주문상품 조회 |
| TB_Gallery | IX_TB_Gallery_ID | Invitation_ID로 갤러리 조회 |
| TB_GuestBook | IX_TB_GuestBook_ID | Invitation_ID로 방명록 조회 |
| TB_Refund_Info | IX_TB_Refund_Info_Order_ID | Order_ID로 환불 조회 |
| TB_Remit | IX_TB_Remit_Invitation_ID | Invitation_ID로 송금 조회 |
| TB_Remit | IX_TB_Remit_Account_ID | Account_ID로 송금 조회 |
| TB_Depositor_Hits | IX_TB_Depositor_Hits_UserID | User_ID로 조회수 조회 |
| TB_Wish_List | IX_TB_Wish_List_userid | User_ID로 위시리스트 조회 |

### 3.4 bar_shop1 DB 인덱스 활용 가이드

#### custom_order (39개 인덱스)
```sql
-- GOOD: PK 활용
SELECT * FROM custom_order WHERE order_seq = 12345

-- GOOD: 날짜 범위 (인덱스 존재 시)
SELECT * FROM custom_order
WHERE order_date >= '2025-01-01' AND order_date < '2025-02-01'
```

#### S2_Card (7개 인덱스)
```sql
-- GOOD: PK 활용
SELECT * FROM S2_Card WHERE Card_Seq = 1234

-- GOOD: Card_Code 접두어 검색
SELECT * FROM S2_Card WHERE Card_Code LIKE 'BC%'
```

### 3.5 대용량 테이블 쿼리 주의사항

#### bar_shop1 대용량 테이블

| 테이블 | 레코드 수 | 주의사항 |
|--------|-----------|---------|
| CUSTOM_SAMPLE_ORDER_ITEM | 23.9M | 반드시 인덱스 컬럼 조건 필요 |
| S2_UserCardView | 22.7M | TOP 절 사용 권장 |
| CallCenterLog | 9.0M | 기간 조건 필수 |
| LOG_MST | 8.5M | 기간 조건 필수 |
| custom_order_history | 8.2M | 날짜 범위 필수 |

#### XERP 대용량 테이블

| 테이블 | 레코드 수 | 주의사항 |
|--------|-----------|---------|
| mmInoutItem | 40.1M | 반드시 인덱스 활용 |
| rpBillItem | 25.8M | SiteCode + 날짜 조건 필수 |
| ERP_SalesData | 18.1M | h_date 필드 사용 (reg_date 사용 금지 - 타임아웃) |
| glDocItem | 17.6M | 전표번호/날짜 조건 필수 |

---

## 4. 비즈니스 로직 주의사항

### 4.1 MC 시리즈 사용자 집계 (가장 중요!)

```sql
-- WRONG: TB_Order만 사용하면 66%의 사용자를 놓침!
SELECT COUNT(*) FROM TB_Order WHERE ...  -- 34%만 캡처

-- CORRECT: TB_Invitation을 사용해야 모든 사용자 집계 가능
SELECT
    COUNT(DISTINCT i.Invitation_ID) as total_users,
    COUNT(DISTINCT CASE WHEN o.Payment_Price > 0 THEN i.Invitation_ID END) as paid_users,
    COUNT(DISTINCT CASE WHEN o.Payment_Price = 0 OR o.Order_ID IS NULL THEN i.Invitation_ID END) as free_users
FROM TB_Invitation i
JOIN TB_Product p ON i.Template_ID = p.Template_ID
LEFT JOIN TB_Order o ON i.Order_ID = o.Order_ID
WHERE p.Product_Code LIKE 'MC%'
```

**이유:**
- MC 시리즈는 프리미엄 모델 (96% 무료, 4% 유료)
- 2025년 6월 이후: 무료 사용자는 TB_Order에 기록되지 않음
- TB_Invitation에만 모든 사용자(무료+유료)가 기록됨

### 4.2 날짜별 분석 시 기간 구분

```
2025년 1-5월: 모든 사용자가 TB_Order에 기록 (무료도 Payment_Price=0으로)
2025년 6월~: 유료 사용자만 TB_Order에 기록, 무료는 TB_Invitation만
```

### 4.3 Product_ID vs Product_Code

- **웹사이트 URL**: `https://www.barunsonmcard.com/Product/Detail/{Product_ID}` (int)
- **비즈니스 로직**: Product_Code (예: MC4114) 사용
- **매핑 예시**: Product_ID 1188 = MC4114

### 4.4 디바이스 정보

- **위치**: TB_Order.Order_Path, TB_Order.Payment_Path
- **값**: 'PC' 또는 'M' (User Agent 문자열이 아님!)
- **비율**: PC 68%, Mobile 32%

### 4.5 S2_Card 스키마 주의사항

- `Company_Seq` 컬럼은 **존재하지 않음** (COMPANY 테이블과 직접 FK 없음)
- `isDisplay` → 실제 컬럼명은 `DISPLAY_YORN` (char(1), Y/N)
- `Card_Code`는 `varchar(30)` (nvarchar(50)이 아님)
- `S2_CardKind`는 **M:N 관계** (하나의 카드가 여러 종류에 속할 수 있음)

---

## 5. 쿼리 작성 Best Practices

### 5.1 일반 규칙

```sql
-- 1. SELECT *를 피하고 필요한 컬럼만 지정
SELECT Order_ID, Email, Total_Price FROM TB_Order WHERE ...

-- 2. 대용량 테이블은 항상 TOP 사용 (탐색 목적)
SELECT TOP 100 * FROM custom_order_item ORDER BY id DESC

-- 3. WITH (NOLOCK)은 읽기 전용 조회 시 사용 가능
SELECT * FROM TB_Order WITH (NOLOCK) WHERE Order_ID = 12345

-- 4. EXISTS를 IN 대신 사용 (서브쿼리 성능)
-- BAD
SELECT * FROM TB_Order WHERE Order_ID IN (SELECT Order_ID FROM TB_Invitation)
-- GOOD
SELECT * FROM TB_Order o WHERE EXISTS (SELECT 1 FROM TB_Invitation i WHERE i.Order_ID = o.Order_ID)

-- 5. COUNT(*)보다 COUNT(indexed_column) 사용
SELECT COUNT(Order_ID) FROM TB_Order WHERE ...
```

### 5.2 JOIN 최적화

```sql
-- 1. 인덱스가 있는 컬럼으로만 JOIN
-- GOOD: Order_ID (PK/FK) 조인
SELECT o.*, op.Product_ID
FROM TB_Order o
INNER JOIN TB_Order_Product op ON o.Order_ID = op.Order_ID

-- 2. 가능하면 INNER JOIN 사용 (LEFT JOIN보다 빠름)
-- LEFT JOIN은 NULL 체크가 필요한 경우에만

-- 3. JOIN 순서: 작은 테이블 먼저 (옵티마이저가 보통 처리하지만 힌트)
SELECT o.*, p.Product_Name
FROM TB_Order_Product op              -- 중간 테이블
INNER JOIN TB_Order o ON op.Order_ID = o.Order_ID  -- 큰 테이블
INNER JOIN TB_Product p ON op.Product_ID = p.Product_ID  -- 작은 테이블
```

### 5.3 집계 쿼리 최적화

```sql
-- BAD: 전체 스캔 후 집계
SELECT COUNT(*) FROM TB_Order WHERE YEAR(Regist_DateTime) = 2025

-- GOOD: 인덱스 범위 스캔
SELECT COUNT(Order_ID) FROM TB_Order
WHERE Regist_DateTime >= '2025-01-01' AND Regist_DateTime < '2026-01-01'

-- GOOD: 통계 테이블 활용 (가능한 경우)
SELECT SUM(Total_Sales_Price) FROM TB_Sales_Statistic_Month
WHERE Date >= '202501' AND Date <= '202512'
```

### 5.4 페이징 처리

```sql
-- SQL Server 2012+ OFFSET-FETCH (인덱스 컬럼 ORDER BY 필수)
SELECT Order_ID, Email, Total_Price
FROM TB_Order
WHERE Order_DateTime >= '2025-01-01'
ORDER BY Order_ID  -- Clustered Index 활용
OFFSET 0 ROWS FETCH NEXT 50 ROWS ONLY

-- 키셋 페이징 (대용량 테이블에 더 효율적)
SELECT TOP 50 Order_ID, Email, Total_Price
FROM TB_Order
WHERE Order_ID > @last_order_id  -- 이전 페이지 마지막 ID
ORDER BY Order_ID
```

---

## 6. 실행 계획 확인 방법

쿼리 성능이 의심될 때 실행 계획을 확인하세요:

```sql
-- 예상 실행 계획 확인
SET SHOWPLAN_TEXT ON
GO
SELECT * FROM TB_Order WHERE Email = 'user@mail.com'
GO
SET SHOWPLAN_TEXT OFF
GO

-- 실제 실행 통계 확인
SET STATISTICS IO ON
SET STATISTICS TIME ON
GO
SELECT * FROM TB_Order WHERE Order_ID = 12345
GO
SET STATISTICS IO OFF
SET STATISTICS TIME OFF
GO
```

**확인 포인트:**
- `Table Scan` 또는 `Clustered Index Scan` → Full Scan (나쁨)
- `Index Seek` → 인덱스 활용 (좋음)
- `Key Lookup` → 추가 조회 발생 (주의)
- `Logical Reads` 수치가 높으면 → 쿼리 최적화 필요

---

## 7. 흔한 실수와 해결 방법

| 실수 | 문제점 | 해결 방법 |
|------|--------|----------|
| TB_Order로 MC 사용자 집계 | 66% 누락 | TB_Invitation 사용 |
| `YEAR(날짜컬럼) = 2025` | 인덱스 무효화 | 범위 조건으로 변환 |
| `LIKE '%검색어%'` | Full Scan | 접두어 매칭 또는 Full-Text Search |
| `SELECT *` | 불필요한 I/O | 필요 컬럼만 지정 |
| 타입 불일치 조인/비교 | 암묵적 변환, 인덱스 무효화 | 동일 타입 사용 |
| XERP의 `reg_date` 사용 | 타임아웃 | `h_date` 필드 사용 |
| S2_Card.Company_Seq 참조 | 컬럼 없음 | 해당 컬럼 미존재 확인 |
| S2_Card.isDisplay 참조 | 컬럼명 오류 | DISPLAY_YORN 사용 |
| 외래키 의존 | FK 제약조건 없음 | 애플리케이션 레벨 무결성 확인 |
| Payment_Price=0을 '무료'로 | 기간에 따라 의미 다름 | 4.2절 기간 구분 참조 |

---

## 8. 파일 생성 규칙

이 디렉토리(`~/src/reference/database/`)는 **데이터베이스 정보/문서 전용**입니다.

- 사용자가 새로운 코드 파일 생성을 요청할 경우, **이 디렉토리가 아닌 새 디렉토리 또는 기존의 다른 디렉토리**에 생성해야 합니다.
- 이 디렉토리에 파일을 추가/수정하는 것은 **데이터베이스 정보 추가/업데이트 목적에 한해서만** 허용됩니다.

---

## 9. 애플리케이션 개발 시 참고사항

### 9.1 데이터베이스 특성

- **외래키 제약조건**: 모든 DB에서 **외래키 제약 없음** (애플리케이션 레벨 관리)
- **문자 인코딩**: nvarchar (한국어 지원)
- **시간대**: KST (UTC+9)
- **전화번호 형식**: 한국 (010-XXXX-XXXX)
- **통화**: KRW (한국 원)

### 9.2 Python 쿼리 스크립트

```bash
# barunson DB
python3 query.py "SELECT COUNT(*) FROM TB_Order"

# bar_shop1 DB
python3 db-query-bar_shop1.py "SELECT COUNT(*) FROM S2_Card"
```

### 9.3 연결 문자열 패턴

```
# 모든 접속 정보는 .env에서 로드 (CONNECTION.md 참조)
Server={DB_SERVER},{DB_PORT};
Database=barunson;  # 또는 bar_shop1
User Id={DB_USER};
Password={DB_PASSWORD};
TrustServerCertificate=True;
```
