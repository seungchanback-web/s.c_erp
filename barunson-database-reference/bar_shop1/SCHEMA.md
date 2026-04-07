# bar_shop1 데이터베이스 스키마

## 개요

- **데이터베이스**: bar_shop1
- **테이블 수**: 1,068개 (1,105개 포함 뷰)
- **컬럼 수**: 15,917개
- **외래키 관계**: 69개
- **인덱스**: 1,998개
- **용도**: 실물 카드 상품 (청첩장, 봉투, 스티커), 주문/배송 관리

## 주요 테이블 그룹

### 1. 주문 관리 (Custom Order System)

| 테이블명 | 용도 | 레코드 수 | 인덱스 |
|---------|------|-----------|--------|
| custom_order | 주문 마스터 | 1.9M | 39 |
| custom_order_item | 주문 항목 | 7.9M | 8 |
| custom_order_plist | 인쇄 목록 | 7.0M | - |
| custom_order_printjob | 인쇄 작업 | 3.3M | - |
| custom_order_history | 주문 이력 | 8.2M | - |
| custom_order_WeddInfo | 결혼식 정보 | 1.5M | - |
| custom_order_qr | 주문 QR코드 | - | - |

#### custom_order 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| order_seq | int (PK) | 주문 순번 |
| up_order_seq | int | 상위 주문 순번 |
| order_type | varchar | 주문 유형 |
| sales_Gubun | varchar | 판매 구분 |
| site_gubun | char | 사이트 구분 |
| pay_Type | char | 결제 유형 |
| print_type | varchar | 인쇄 유형 |
| company_seq | int (FK) | 회사 순번 |
| status_seq | int | 상태 코드 (1+ = 유효) |

#### custom_order_item 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 항목 ID |
| order_seq | int (FK) | 주문 순번 |
| card_seq | int (FK→S2_Card) | 카드 순번 |
| item_type | varchar | 항목 유형 |
| item_count | int | 수량 |
| item_price | int | 단가 |
| item_sale_price | float | 판매가 |
| discount_rate | float | 할인율 |

### 2. 카드 상품 관리 (S2 System)

| 테이블명 | 용도 | 레코드 수 | 인덱스 |
|---------|------|-----------|--------|
| S2_Card | 카드 마스터 (50 컬럼) | 8,458 | 7 |
| S2_CardKind | 카드-종류 연결 (M:N) | - | - |
| S2_CardKindInfo | 카드 종류 마스터 (16종) | 16 | - |
| S2_CardDetail | 카드 상세 | - | - |
| S2_CardImage | 카드 이미지 | - | - |
| S2_UserInfo | 사용자 정보 | 1.08M | 13 |
| S2_UserCardView | 카드 조회 이력 | 22.7M | 2 |
| S2_UserBye | 탈퇴 회원 | 4.5M | - |
| S2_WishCard | 위시리스트 | 3.7M | - |

> **참고**: S5_MCARD_TMP 테이블은 삭제되었습니다.

상세: [S2_CARD_CATALOG.md](S2_CARD_CATALOG.md) 참조

### 3. 샘플 주문

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| CUSTOM_SAMPLE_ORDER | 샘플 주문 마스터 | - |
| CUSTOM_SAMPLE_ORDER_ITEM | 샘플 주문 항목 (최대) | 23.9M |

### 4. 배송 관리

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| DELIVERY_INFO | 배송 정보 | 1.4M |
| DELIVERY_CODE | 배송 코드 | 2 |
| DELIVERY_INFO_DETAIL | 배송 상세 | 4.5M |
| DELIVERY_INFO_DELCODE | 배송 추적 | 3.3M |

#### DELIVERY_INFO 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| ORDER_SEQ | int | 주문 순번 |
| DELIVERY_SEQ | int | 배송 순번 |
| NAME | varchar | 수령인명 |
| PHONE / HPHONE | varchar | 연락처 |
| ADDR | varchar | 배송 주소 |

### 5. S4 마케팅/이커머스 (87 테이블)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| S4_BestTotalRanking_* | 브랜드별 랭킹 (5개 브랜드) | 10M+ 합계 |
| S4_Event_Review | 리뷰 | 167K |
| S4_MyCoupon | 사용자 쿠폰 | 2.6M |
| S4_COUPON | 쿠폰 정의 | - |
| S4_CPC_Sub_Statics | CPC 분석 | 6.2M |
| DELIVERY_INFO_DETAIL | 배송 상세 | 4.5M |
| S4_CardClickCount | 상품 조회 | - |
| S4_CART | 장바구니 | - |

### 6. 쿠폰 시스템

| 테이블명 | 용도 |
|---------|------|
| COUPON_MST | 쿠폰 마스터 (943개) |
| COUPON_DETAIL | 쿠폰 상세 (개별 코드) |
| COUPON_ISSUE | 쿠폰 발급/사용 이력 |
| COUPON_APPLY_CARD | 적용 카드 |
| COUPON_APPLY_USER | 적용 사용자 |
| COUPON_APPLY_SITE | 적용 사이트 |

### 7. 회사/거래처

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| COMPANY | 회사/거래처 정보 | 5.9K |
| ADMIN_LST | 관리자 목록 | - |

### 8. 기타 대용량 테이블

| 테이블명 | 레코드 수 | 설명 |
|---------|-----------|------|
| wedd_biztalk | 221 | 비즈니스 메시징 (대부분 삭제됨) |
| CallCenterLog | 9.0M | 콜센터 로그 (레거시, CallConnect_Log로 전환 중) |
| CallConnect_Log | 신규 | 콜센터 인바운드 통화 로그 (2026.04~ 신규) |
| LOG_MST | 8.5M | 일반 로그 |
| ata_mmt_log_* | 92개 | 월별 아카이브 (2018-2025) |

### 9. CallConnect_Log (콜센터 인바운드 통화 로그)

> **⚠ 콜 로그 조회 시 주의**: 2026.04부터 신규 인바운드 로그는 이 테이블에 기록됨.
> 구 데이터(CallCenterLog)는 ~3개월 내 마이그레이션 예정이므로, 마이그레이션 완료 전까지
> **콜 로그 조회 시 CallCenterLog와 CallConnect_Log 양쪽 모두 참조 필요**.

| 컬럼명 | 타입 | NULL | 설명 |
|--------|------|------|------|
| id | int | NO | PK (클러스터드) |
| YIVR | varchar(20) | NO | IVR 번호 (수신 전화번호) |
| YCallerID | varchar(20) | NO | 발신자 전화번호 |
| YMENU | varchar(2) | YES | IVR 메뉴 선택값 |
| admin_id | varchar(20) | YES | 상담원 ID |
| call_in_dt | datetime | NO | 인바운드 수신 시각 |
| call_connect_dt | datetime | YES | 상담원 연결 시각 |
| call_close_dt | datetime | YES | 통화 종료 시각 |
| call_type | varchar(1) | NO | 통화 유형 (I=인바운드) |

**인덱스:**
| 인덱스명 | 컬럼 | 유형 |
|----------|------|------|
| PK_CallConnect_Log | id | CLUSTERED |
| IX_CallConnect_Log_CallerID | YCallerID, call_in_dt | NONCLUSTERED |
| IX_CallConnect_Log_InDt | call_in_dt (INCLUDE: YCallerID, admin_id) | NONCLUSTERED |

## 테이블 그룹별 접두어

| 접두어 | 개수 | 설명 |
|--------|------|------|
| S2_ | 116 | 카드/상품 관리 |
| S4_ | 87 | 마케팅/이커머스 |
| custom_ | 58+ | 주문 관리 |
| DELIVERY_ | 4+ | 배송 관리 |
| COUPON_ | 6 | 쿠폰 시스템 |
| mcard_ | 17 | 모바일 카드 (2021년 중단) |
| PHOTOBOOK_ | 다수 | 포토북 서비스 |

## 성능 주의사항

### 대용량 테이블 TOP 5
1. CUSTOM_SAMPLE_ORDER_ITEM: 23.9M
2. S2_UserCardView: 22.7M
3. CallCenterLog: 9.0M
4. LOG_MST: 8.5M
5. custom_order_history: 8.2M

### 쿼리 최적화
- 반드시 인덱스 컬럼으로 필터링
- 날짜 범위 조건 필수
- TOP 절 사용 (탐색 목적)
- `status_seq >= 1`로 유효 주문 필터링
