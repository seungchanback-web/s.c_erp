# HELP.md - 테이블 찾기 가이드

목적별로 어떤 DB/테이블을 조회해야 하는지 정리한 문서입니다.

## 사용자 테이블 위치

- **회원 정보**: bar_shop1의 `S2_UserInfo` (1.08M건, 통합 회원 테이블)
- **barunson에는 별도 회원 테이블 없음** → `TB_Order.Member_ID`로 bar_shop1의 `S2_UserInfo`와 연결
- **탈퇴 회원**: bar_shop1의 `S2_UserBye` (4.5M건)
- **카드 조회 이력**: bar_shop1의 `S2_UserCardView` (22.7M건)
- **사용자 옵션**: barunson의 `TB_UserOption`

## CS / 고객 문의

### QnA 시스템 (bar_shop1)

고객 문의(1:1 문의)는 bar_shop1의 QnA 관련 테이블에 저장됩니다.

| 테이블명 | 용도 |
|---------|------|
| QnA | 문의 본문 (제목, 내용, 작성자, 상태, 담당자) |
| QnABoard | 게시판 정의 (BoardId별 설정) |
| QnAComment | 문의 댓글/답변 |
| QnACommentFile | 댓글 첨부파일 |
| QnAFile | 문의 첨부파일 |
| QnAHistory | 문의 처리 이력 |
| QnAKMS | 지식관리 |
| QnACommonCode | QnA 공통 코드 |
| QnACommonCodeUseBoard | 게시판별 공통 코드 매핑 |
| QnAMemberRole | 담당자 역할 |
| QnAReadDate | 읽음 확인 |

#### QnA 주요 컬럼

| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| Seq | int (PK) | 문의 순번 |
| BoardId | varchar(10) | 게시판 ID (예: Tech) |
| Site | int | 사이트 코드 |
| CType | int | 문의 유형 |
| Status | int | 상태 코드 |
| OType | int | 기타 유형 |
| Emergency | bit | 긴급 여부 |
| OrderCode | nvarchar(50) | 주문번호 |
| UserName | nvarchar(50) | 작성자명 |
| UserId | nvarchar(50) | 작성자 ID |
| UserEmail | nvarchar(100) | 작성자 이메일 |
| CardCode | nvarchar(50) | 카드 코드 |
| Title | nvarchar(100) | 제목 |
| Contents | nvarchar(max) | 내용 (HTML) |
| ContentsText | nvarchar(max) | 내용 (텍스트) |
| AdminId | varchar(25) | 담당자 ID |
| WorkAdminId | varchar(25) | 작업 담당자 ID |
| RegDate | datetime | 등록일 |
| LastDate | datetime | 최종 수정일 |

### 기타 CS 관련 테이블 (bar_shop1)

| 테이블명 | 용도 |
|---------|------|
| CallCenterLog | 콜센터 시스템 이벤트 로그 (9.0M건, 상담 내용 아님) |
| CS_HappyCall | 해피콜 |
| S2_CsPoll | CS 설문 |
| S2_CsPollAns | CS 설문 응답 |
| S2_CsPollAnsDetail | CS 설문 응답 상세 |
| S4_CS_Member | CS 담당자 |
| S2_UserQnA | 사용자 QnA (레거시) |
| SMARTAD_CONTACT_US | 스마트광고 문의 |

### 게시판 (barunson)

| 테이블명 | 용도 |
|---------|------|
| TB_Board | 일반 게시판 (공지 등, CS 문의 아님) |

## 주문 관련

- **실물 카드 주문**: bar_shop1의 `custom_order` + `custom_order_item`
- **모바일 초대장 주문**: barunson의 `TB_Order`
- **주문 이력**: bar_shop1의 `custom_order_history`

## 상품 관련

- **실물 카드 상품**: bar_shop1의 `S2_Card`
- **모바일 초대장 상품**: barunson의 `TB_Product`

## 생산/인쇄 관련 (파주 공장)

실물 카드의 생산(인쇄) 데이터는 bar_shop1의 인쇄 작업 테이블에서 조회합니다.

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| custom_order_printjob | 인쇄 작업 (일자별 생산 기록) | 3.3M |
| custom_order_plist | 인쇄 목록 (주문-카드 매핑) | 7.0M |

### 테이블 관계

```
custom_order_printjob.pid → custom_order_plist.id → S2_Card (카드 상품)
                                                   → custom_order (주문)
```

### custom_order_printjob 주요 컬럼

| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| pdate | varchar | 인쇄 일자 ('YYYY-MM-DD') |
| cdate | varchar | 생성 일자 |
| cseq | int | 인쇄 차수 (배치 번호) |
| pid | bigint | 인쇄 목록 ID (FK→custom_order_plist.id) |
| pcount | int | 인쇄 수량 |
| ptype | char | 인쇄 유형 (C: 카드, E: 봉투/내지) |
| printer_id | varchar | 프린터 ID |

### 인덱스 및 성능 최적화

| 인덱스명 | 컬럼 | 유형 |
|---------|------|------|
| PK_custom_order_printjob | cdate, cseq, pid | Clustered |
| IX_custom_order_printjob_pdate | pdate | Nonclustered |
| IX_custom_order_printjob_pid | pid | Nonclustered |

- **최신 생산 조회 시 주의**: `ORDER BY pdate DESC`는 클러스터드 인덱스와 불일치하여 3.3M건 전체 정렬 발생
- **올바른 패턴**: `WHERE pdate >= (SELECT MAX(pdate) ...)`로 범위를 축소한 뒤 `ORDER BY cdate DESC, cseq DESC, pid DESC` (PK 순서)로 정렬

### 예시: 특정일 생산 상품 Top 10

```sql
SELECT TOP 10
    c.Card_Code,
    c.Card_Name,
    COUNT(DISTINCT pj.pid) AS print_jobs,
    SUM(pj.pcount) AS total_quantity
FROM custom_order_printjob pj WITH (NOLOCK)
INNER JOIN custom_order_plist pl WITH (NOLOCK) ON pj.pid = pl.id
INNER JOIN S2_Card c WITH (NOLOCK) ON pl.card_seq = c.Card_Seq
WHERE pj.pdate = '2026-03-06'  -- 조회할 날짜
GROUP BY c.Card_Code, c.Card_Name
ORDER BY total_quantity DESC
```

## XERP (통합 ERP)

XERP는 바른손의 통합 ERP 시스템으로, 1,354개 테이블에 2억+ 건의 데이터가 저장되어 있습니다.
기존 문서에서 "2023년 9월 비활성"으로 기재되었으나, **2026년 3월 기준 주요 테이블에 최신 데이터가 계속 기록되고 있음이 확인**되었습니다.

> **접근 제한 안내**: 현재 프로젝트의 접속 계정(readonly_erp)으로는 **재고/자재(mm) 관련 테이블만 접근 가능**합니다.
> 회계(gl), 매출/매입(rp), 판매(ERP_SalesData) 등 **재무 관련 테이블은 접근 불가**합니다.
> 재무 데이터 접근이 필요한 경우 **조휘열**에게 별도 접속 정보를 요청하세요.

### 주요 테이블 최신 데이터 현황 (2026-03-06 확인)

| 테이블 | 레코드 수 | 최신 데이터 날짜 | 날짜 컬럼 | 비고 |
|--------|-----------|-----------------|-----------|------|
| ERP_SalesData | 18.1M | 2026-03-05 | h_date | 1-2일 지연, 주말 데이터 없음 |
| glDocHeader | 4.3M | 2026-03-10 | DocDate | 미래 날짜 전표 존재 (예약 전표) |
| mmInoutHeader | 5.5M | 2026-03-27 | InoutDate | 미래 날짜 존재 (예정 입출고) |
| rpBillHeader | 4.0M | 2026-03-06 | BillDate | 당일 데이터 확인 |

### 모듈별 접두어 및 접근 가능 여부

| 접두어 | 모듈 | 주요 테이블 | 접근 |
|--------|------|------------|------|
| mm | 자재/재고 | mmInoutHeader, mmInoutItem | **가능** |
| C_ (mm계열) | 공통 재고 | C_mmEvaData, C_mmInvMonth, C_coInoutClose | **가능** |
| ERP_ | 판매 | ERP_SalesData (h_date 필드 사용 필수) | 불가 |
| gl | 회계 | glDocHeader, glDocItem, glDocMngMapping | 불가 |
| rp | 매출/매입 | rpBillHeader, rpBillItem | 불가 |
| sd | 판매 | sdOrder 등 | 불가 |
| po | 구매 | poOrder 등 | 불가 |
| HR_ | 인사 | HR_ 계열 테이블 | 불가 |

> 재무/회계/판매/인사 데이터 접근이 필요하면 **조휘열**에게 별도 접속 정보를 요청하세요.

### 모듈별 상세 문서

XERP의 각 모듈 상세 정보(테이블 스키마, 인덱스, 쿼리 패턴)는 아래 문서 참조:
- **[xerp/INVENTORY.md](xerp/INVENTORY.md)** — 재고/자재관리 (mmInoutHeader/Item, 40.1M건) **← 현재 접근 가능**
- **[xerp/SALES.md](xerp/SALES.md)** — 판매 데이터 (ERP_SalesData, 18.1M건) *(별도 권한 필요)*
- **[xerp/ACCOUNTING.md](xerp/ACCOUNTING.md)** — 회계 전표 (glDocHeader/Item, 17.6M건) *(별도 권한 필요)*
- **[xerp/BILLING.md](xerp/BILLING.md)** — 매출/매입 청구 (rpBillHeader/Item, 25.8M건) *(별도 권한 필요)*

### 쿼리 주의사항

- **ERP_SalesData 조회 시 반드시 `h_date` 필드 사용** (`reg_date` 사용 시 타임아웃)
- `h_date`는 nvarchar(8), 'YYYYMMDD' 형식 (예: `'20260305'`)
- 읽기 전용 쿼리에 `WITH (NOLOCK)` 힌트 사용 권장
- 접속: `.env` 환경변수 사용, database를 `XERP`로 지정

```sql
-- 입출고 조회 (현재 계정으로 접근 가능)
SELECT TOP 100 * FROM XERP.dbo.mmInoutHeader WITH (NOLOCK)
WHERE InoutDate BETWEEN '20260301' AND '20260306'

-- 아래 쿼리는 별도 접속 정보 필요 (조휘열에게 요청)
-- 판매 데이터 조회
-- SELECT TOP 100 * FROM XERP.dbo.ERP_SalesData WITH (NOLOCK)
-- WHERE h_date = '20260305'
--
-- 회계 전표 조회
-- SELECT TOP 100 * FROM XERP.dbo.glDocHeader WITH (NOLOCK)
-- WHERE DocDate BETWEEN '20260301' AND '20260306'
--
-- 청구서 조회
-- SELECT TOP 100 * FROM XERP.dbo.rpBillHeader WITH (NOLOCK)
-- WHERE BillDate BETWEEN '20260301' AND '20260306'
```

## BHC (디얼디어 재고)

BHC는 **디얼디어(Dear Dear)**의 재고 관리 데이터베이스입니다.
XERP와 **동일한 테이블 구조**를 가지고 있으며, MM(자재/재고) 모듈의 모든 테이블이 동일하게 존재합니다.

- **테이블 구조**: XERP의 mm 계열 테이블과 동일 (mmInventory, mmInoutHeader, mmInoutItem 등)
- **현재 재고**: mmInventory 1,564건 (고유 품목 704종, 재고 보유 648건)
- **코드페이지**: 949 (EUC-KR / 한국어 완성형), Collation: `Korean_Wansung_CI_AS`
- **쿼리 방법**: XERP와 동일한 쿼리 패턴 사용 (DB명만 `BHC`로 변경)
- **접속**: 동일 서버, database를 `BHC`로 지정

```sql
-- BHC 재고 조회 예시
SELECT * FROM BHC.dbo.mmInventory WITH (NOLOCK)
WHERE SiteCode = 'BK10' AND OhQty > 0

-- BHC 입출고 조회 예시
SELECT * FROM BHC.dbo.mmInoutHeader WITH (NOLOCK)
WHERE InoutDate BETWEEN '20260301' AND '20260317'
```

> XERP의 재고 관련 상세 스키마/인덱스/쿼리 패턴은 [xerp/INVENTORY.md](xerp/INVENTORY.md) 참조 (BHC에 동일하게 적용)

## 배송 관련

- **배송 정보**: bar_shop1의 `DELIVERY_INFO`
- **배송 상세**: bar_shop1의 `DELIVERY_INFO_DETAIL`
- **배송 추적**: bar_shop1의 `DELIVERY_INFO_DELCODE`

## DD (wedding) - 뚜비뚜비 웨딩

DD는 별도의 MySQL 데이터베이스로, 뚜비뚜비 웨딩 카드 쇼핑몰 데이터를 관리합니다.
접속: `python3 python/db-query-dd.py "SQL"`

### 주문
- **주문 마스터**: `orders` (196K건)
- **주문 항목**: `order_items` (2.16M건)
- **카드 내용**: `order_card_contents` (신랑신부/예식장 정보)
- **봉투 정보**: `order_card_envelopes` (수신인/주소)
- **주문 수량**: `order_card_qty`
- **부가 항목**: `order_item_addition` (식권/스티커 등)
- **주문 옵션**: `order_item_options`
- **바른손 연동**: `orders.barunson_order_seq` → bar_shop1의 `custom_order.order_seq`

### 사용자
- **회원**: `users` (112K건)
- **탈퇴 이력**: `users_leave_log`
- **주소**: `addresses`
- **마케팅 동의**: `marketing_agreement`

### 상품
- **상품 마스터**: `products` (1,241건)
- **카테고리**: `categories` + `category_product`
- **옵션**: `options` + `options_items` + `option_product`
- **부가항목 마스터**: `invitation_card_addition`
- **상품 규격**: `product_format`

### 모바일 청첩장
- **모카드**: `mobile_cards` (37.5K건)
- **모카드 계좌**: `mobile_card_account` (축의금)
- **모카드 추가요소**: `mobile_card_addition` (텍스트/이미지/스타일)
- **모카드 템플릿**: `mobile_card_templates`
- **방명록**: `mobile_invitation_board` (352K건)

### 샘플 주문
- **샘플 주문**: `sample_orders` (200K건)
- **샘플 항목**: `sample_order_items` (1.93M건)

### 쿠폰
- **쿠폰 마스터**: `coupons`
- **쿠폰 발급**: `coupon_issue` (389K건)
- **시리얼 쿠폰**: `serial_coupons` + `serial_coupon_issue`

### CS/문의
- **1:1 문의**: `contact_contents` (180K건)
- **문의 답변**: `contact_content_reply`
- **상담 내용**: `counsel_contents` (97K건)
- **리뷰**: `review_board`

### 결제
- **LG유플러스**: `lguplus_paid_list`
- **토스 결제**: `toss_order`, `toss_api_logs`
- **매출 집계**: `daily_account_log`

### 배송
- **CJ 송장번호**: `cj_invoice_numbers`
- **배송비**: `cost_zipcode`, `cost_manage`

### 제휴/파트너
- **제휴점**: `partner_shop` (385건)
- **제휴 사용자**: `partner_users`
- **제휴 주문**: `order_partnership`

### 바른손 연동
- **코드 매핑**: `code_map_barunson` (DD 상품코드 ↔ 바른손 카드코드 매핑)

상세 스키마: [dd/SCHEMA.md](dd/SCHEMA.md) | ERD: [dd/ERD.md](dd/ERD.md) | 인덱스: [dd/INDEXES.md](dd/INDEXES.md)
