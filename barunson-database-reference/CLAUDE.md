# CLAUDE.md - 바른손 데이터베이스 참조

이 디렉토리는 바른손(Barunson) 데이터베이스 시스템의 참조 문서입니다.
AI가 쿼리/애플리케이션 작성 시 이 문서들을 참고합니다.

## 필수 참조 순서

1. **GUIDELINE.md** - 쿼리 작성 규칙, 인덱스 활용, Row Scan 방지 (반드시 읽을 것)
2. **해당 DB의 SCHEMA.md** - 테이블/컬럼 구조
3. **해당 DB의 ERD.md** - 테이블 간 관계
4. **해당 DB의 INDEXES.md** - 인덱스 정보 (성능 최적화)
5. **queries/COMMON_QUERIES.md** - 검증된 쿼리 패턴

## 핵심 규칙

### MC 시리즈 사용자 집계
- **TB_Order는 34%만 캡처** → 반드시 **TB_Invitation** 사용
- 프리미엄 모델: 96% 무료, 4% 유료
- 2025.06 이후: 무료 사용자는 TB_Order에 미기록

### 쿼리 성능
- **쿼리 작성 전 반드시 `sys.indexes` + `sys.index_columns`로 대상 테이블의 인덱스를 확인**하고, 인덱스를 활용하는 쿼리를 작성할 것
- 인덱스가 없는 컬럼으로 WHERE/ORDER BY 사용 금지 (Full Table Scan 발생)
- ORDER BY는 PK(클러스터드 인덱스) 또는 기존 넌클러스터드 인덱스 컬럼 순서에 맞출 것
- 대량 테이블에서 TOP N 조회 시 인덱스 범위를 먼저 축소 (예: 서브쿼리로 최신 날짜 특정 후 필터링)
- 컬럼에 함수 적용 금지 → 범위 조건으로 변환
- LIKE '%...' 금지 → 접두어 매칭만 사용
- XERP의 ERP_SalesData는 반드시 `h_date` 필드 사용 (`reg_date` 사용 시 타임아웃)
- 인덱스 확인 쿼리: `SELECT i.name, COL_NAME(ic.object_id, ic.column_id), i.type_desc FROM sys.indexes i JOIN sys.index_columns ic ON i.object_id=ic.object_id AND i.index_id=ic.index_id WHERE i.object_id=OBJECT_ID('테이블명') ORDER BY i.name, ic.key_ordinal`


### 테이블 찾기
- 목적별 테이블 위치는 **[HELP.md](HELP.md)** 참조 (사용자, CS/문의, 주문, 상품, 배송, XERP 등)
- **XERP는 활성 상태** (2026년 3월 기준 최신 데이터 확인됨, "2023년 비활성" 아님)

### XERP 접근 제한
- **`.env`에 3개 계정 정보(DB, XERP, DD)가 모두 포함된 경우**: 재무 데이터 전체 접근 권한 보유 → 회계(gl), 매출/매입(rp), 판매(ERP_SalesData) 등 제한 없이 접근 가능
- **`.env`에 XERP 계정이 없는 경우** (2개 이하): 재고/자재(mm) 관련 테이블만 접근 가능, 재무 관련 테이블은 접근 불가
- 재무 데이터 접근이 필요하나 권한이 없는 경우 **조휘열**에게 별도 접속 정보를 요청해야 함

### BHC (디얼디어 재고)
- **용도**: 디얼디어(Dear Dear)의 재고 관리 데이터베이스
- **테이블 구조**: XERP와 동일 (mm 계열 테이블 전체 동일 구조)
- **주요 테이블**: mmInventory(1,564건), mmInoutHeader, mmInoutItem 등
- **코드페이지**: 949 (EUC-KR / 한국어 완성형), Collation: `Korean_Wansung_CI_AS`
- **쿼리 방법**: XERP와 동일한 패턴, DB명만 `BHC`로 변경
- **스키마 참조**: [xerp/INVENTORY.md](xerp/INVENTORY.md) 동일 적용

### 개인정보 마스킹 (PII)
- 화면 표시, 보고서, API 응답 시 **반드시 마스킹** (데이터 추출/ETL은 예외)
- **이름**: 첫 글자와 끝글자만 → `홍*임`
- **이메일**: 앞 3자만 → `use****@****.com`
- **전화번호**: 중간 마스킹 → `010-****-5678`
- **주소**: 시/구까지만 → `서울시 강남구 ***`
- **계좌번호**: 뒤 4자리만 → `*********1234`
- **주민번호/생년월일**: 연도만 → `1990-**-**`
- 상세 SQL 패턴은 GUIDELINE.md 2장 참조

### 스키마 주의사항
- S2_Card.Company_Seq → 존재하지 않음
- S2_Card.isDisplay → 실제 컬럼명 DISPLAY_YORN
- S2_Card.Card_Code는 varchar(30)
- S2_CardKind는 M:N 관계
- 모든 DB에 외래키 제약조건 없음

### 접속 정보
- 서버/포트/자격증명: `.env` / `.env-all` 파일에서 로드 (CONNECTION.md 참조)
- 로그인 사용자: `.env`의 `DB_USER` 참조 (스키마: dbo)
- barunson DB: `python3 python/query.py "SQL"`
- bar_shop1 DB: `python3 python/db-query-bar_shop1.py "SQL"`
- DD wedding DB (MySQL): `python3 python/db-query-dd.py "SQL"`

### 파일 생성 규칙
- 사용자가 애플리케이션/스크립트 생성을 요청하면 반드시 `./user/` 디렉토리 내부에 생성
- 기존 프로젝트 디렉토리(python/, queries/ 등)를 오염시키지 않도록 주의
- 웹 애플리케이션 생성 시 포트는 반드시 **10000 이상** 사용 (macOS AirPlay 등 시스템 서비스 충돌 방지)

### DD (wedding) 데이터베이스
- **엔진**: MySQL (MSSQL이 아님에 주의)
- **접속정보**: `.env-all`의 `DD_DB_*` 변수 사용
- **용도**: 뚜비뚜비 웨딩 카드 쇼핑몰 (실물 카드 + 모바일 청첩장)
- **테이블 수**: 약 170개, Laravel 기반
- **주요 테이블**: orders, order_items, products, users, mobile_cards, sample_orders
- **바른손 연동**: orders.barunson_order_seq → bar_shop1.custom_order.order_seq
- **인덱스 확인**: `SHOW INDEX FROM 테이블명` (MySQL 방식, sys.indexes 아님)
- **참조 문서**: [dd/SCHEMA.md](dd/SCHEMA.md), [dd/ERD.md](dd/ERD.md), [dd/INDEXES.md](dd/INDEXES.md)

### 명명 규칙
- barunson: TB_ 접두어 (TB_Order, TB_Product)
- bar_shop1: 혼합 (S2_, S4_, custom_, DELIVERY_)
- DD wedding: snake_case (orders, order_items, mobile_cards)
- 스키마: MSSQL은 모두 dbo, DD는 MySQL (스키마 없음)
