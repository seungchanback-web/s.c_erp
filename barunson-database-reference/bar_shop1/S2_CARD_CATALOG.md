# S2_Card 상품 카탈로그

## 개요

- **총 상품**: 8,458개
- **청첩장(A01)**: 4,334개 (활성 4,221 / 비활성 113)
- **컬럼 수**: 50개
- **관련 테이블**: 60+개

## 스키마 정정 사항 (중요!)

| 기존 문서 | 실제 | 비고 |
|----------|------|------|
| Company_Seq | 존재하지 않음 | COMPANY와 직접 FK 없음 |
| isDisplay | DISPLAY_YORN | char(1), Y/N |
| DisplayIdx | 존재하지 않음 | - |
| Card_Code nvarchar(50) | varchar(30) | 타입 주의 |

## S2_Card 전체 컬럼 (50개)

| # | 컬럼명 | 타입 | NULL | 설명 |
|---|--------|------|------|------|
| 1 | Card_Seq | int | NO | PK |
| 2 | CardBrand | char(1) | NO | 브랜드 (B/S/C/X 등) |
| 3 | Card_Code | varchar(30) | NO | 카드 코드 |
| 4 | Card_ERPCode | varchar(30) | NO | ERP 코드 |
| 5 | Card_Div | char(3) | NO | 카테고리 (A01 등) |
| 6 | Card_Name | varchar(150) | YES | 카드명 |
| 7 | Card_Image | varchar(150) | YES | 이미지 경로 |
| 8 | CardSet_Price | int | YES | 세트 가격 |
| 9 | Card_Price | int | NO | 단가 |
| 10 | ERP_EXPECTED_ARRIVAL_DATE | datetime | YES | ERP 입고 예정일 |
| 11 | ERP_EXPECTED_ARRIVAL_DATE_USE_YORN | varchar(1) | YES | 입고예정일 사용여부 |
| 12 | ERP_MIN_STOCK_QTY | int | YES | 최소 재고 수량 |
| 13 | ERP_MIN_STOCK_QTY_USE_YORN | varchar(1) | YES | 최소재고 사용여부 |
| 14 | RegDate | datetime | YES | 등록일 |
| 15 | Card_WSize | int | YES | 가로 mm |
| 16 | Card_HSize | int | YES | 세로 mm |
| 17 | Old_Code | varchar(30) | YES | 이전 코드 |
| 18 | t_env_code | varchar(30) | YES | 봉투 코드 |
| 19 | t_inpaper_code | varchar(30) | YES | 내지 코드 |
| 20 | admin_id | varchar(20) | YES | 관리자 ID |
| 21 | new_code | varchar(50) | YES | 신규 코드 |
| 22 | CARD_GROUP | char(1) | YES | 카드 그룹 |
| 23 | CardFactory_Price | int | YES | 공장 원가 |
| 24 | REGIST_DATES | datetime | YES | 등록 일시 |
| 25 | DISPLAY_YORN | char(1) | YES | 표시 여부 (Y/N) |
| 26 | DISPLAY_UPDATE_DATE | datetime | YES | 표시 변경일 |
| 27 | DISPLAY_UPDATE_UID | varchar(50) | YES | 표시 변경자 |
| 28 | FPRINT_YORN | char(1) | YES | 인쇄 가능 |
| 29 | WisaFlag | char(1) | YES | 위사 플래그 |
| 30 | View_Discount_Percent | numeric | YES | 표시 할인율 |
| 31 | Cost_Price | int | YES | 원가 |
| 32 | Video_URL | varchar(500) | YES | 영상 URL |
| 33 | Tip | nvarchar(2000) | YES | 팁 |
| 34 | Explain | nvarchar(MAX) | YES | 상세 설명 |
| 35 | Unit | nvarchar(10) | YES | 주문 단위 |
| 36 | Unit_Value | int | YES | 단위 수량 |
| 37 | Option_Name | nvarchar(50) | YES | 옵션명 |
| 38 | OverQty | int | NO | 초과 수량 |
| 39 | Unit_IsBox | bit | NO | 박스 단위 |
| 40 | Unit_BoxName | nvarchar(10) | YES | 박스 단위명 |
| 41 | Unit_Name | nvarchar(10) | YES | 단위명 |
| 42 | Unit_Max | int | NO | 최대 주문 수량 |
| 43 | SamplePrice | int | NO | 샘플 가격 |
| 44 | SamplePolicy | char(1) | YES | 샘플 정책 |
| 45 | RelatedCards | varchar(1000) | YES | 연관 카드 |
| 46 | Unit_Min | int | NO | 최소 주문 수량 |
| 47 | ModAdminId | varchar(20) | YES | 수정 관리자 |
| 48 | SamplePaymentPrice | int | NO | 샘플 결제가 |
| 49 | IsSampleOnly | bit | NO | 샘플 전용 |
| 50 | IsPrint | bit | YES | 인쇄 가능 |

## 브랜드 코드 매핑 (18개)

| 코드 | 브랜드명 | 청첩장 수 | 활성 | 평균가 | 가격 범위 |
|------|---------|----------|------|--------|----------|
| B | 바른손카드 | 1,581 | 1,514 | 969원 | 0~8,900원 |
| C | 더카드 | 662 | 643 | 864원 | 250~3,000원 |
| S | 비핸즈 | 550 | 540 | 1,526원 | 0~8,000원 |
| X | 디어디어 | 488 | 482 | 1,054원 | 490~2,400원 |
| W | W카드 | 215 | 214 | 776원 | 300~4,520원 |
| N | 네이처 | 182 | 181 | 770원 | 375~2,500원 |
| I | 이니스 | 143 | 143 | 1,267원 | 500~3,000원 |
| H | 비핸즈프리미엄 | 121 | 121 | 648원 | 300~1,000원 |
| F | 플라워 | 98 | 96 | 750원 | 0~1,200원 |
| D | 디자인카드 | 73 | 66 | 814원 | 0~1,400원 |
| P | 프리미어 | 68 | 68 | 892원 | 550~1,700원 |
| M | 모바일 | 45 | 45 | 676원 | 380~1,050원 |
| G | 글로벌 | 25 | 25 | 1,016원 | 700~1,280원 |
| U | 유니세프 | 25 | 25 | 1,094원 | 600~8,000원 |
| Y | 유니크 | 25 | 25 | 798원 | 750~1,000원 |
| K | 비케이 | 20 | 20 | 760원 | 760~760원 |
| T | 프리미어더카드 | 8 | 8 | 990원 | 600~1,500원 |
| A | 기타 | 5 | 5 | - | - |

## 카테고리 매핑 (Card_Div)

| 코드 | 카테고리 | 수량 | 활성 | 가격 범위 |
|------|---------|------|------|----------|
| A01 | 일반청첩장 | 4,334 | 4,221 | 0~8,900원 |
| A02 | 봉투 | 682 | - | - |
| A03 | 감사장 | 39 | - | - |
| A04 | 스티커 | 314 | - | - |
| A05 | 식권/부속 | 388 | - | - |
| B01 | 포토북/앨범 | 1,140 | - | - |
| C01~C29 | 초대장/감사장/기업행사/돌잔치 등 | 다양 | - | - |

## S2_CardKindInfo (16종 카드 유형)

| CardKind_Seq | 종류명 |
|-------------|--------|
| 1 | 청첩장 |
| 2 | 초대장 |
| 3 | 감사장 |
| 4 | 카드형답례장 |
| 5 | 한지형답례장 |
| 6 | 기업행사 |
| 7 | 고희연/회갑연 |
| 8 | 기성웨딩 |
| 9 | 맞춤웨딩 |
| 10 | 미니청첩장 |
| 13 | 디지털감사장 |
| 14 | 커스텀디지털카드 |
| 15 | 메시지카드 |
| 16 | 결혼답례카드 |
| 17 | 식순지 |
| 18 | 돈봉투 |

> S2_CardKind는 M:N 관계: 하나의 카드가 여러 종류에 속할 수 있음 (예: 청첩장 + 커스텀디지털카드)
