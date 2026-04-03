# DD (wedding) 데이터베이스 스키마

## 개요

- **데이터베이스**: wedding
- **서버**: 115.68.229.153:3306 (MySQL/InnoDB)
- **테이블 수**: 약 170개
- **용도**: 뚜비뚜비(DD) 웨딩 카드 쇼핑몰 (실물 카드 + 모바일 청첩장)
- **프레임워크**: Laravel 기반 (migrations 테이블 존재)
- **외래키**: 없음 (애플리케이션 레벨 관리)
- **인코딩**: UTF-8

## 주요 테이블 그룹

### 1. 주문 관리 (Orders)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| orders | 주문 마스터 | 196K |
| order_items | 주문 항목 | 2.16M |
| order_card_contents | 카드 내용 (신랑신부/예식장 정보) | 413K |
| order_card_envelopes | 봉투 정보 (수신인/주소) | 823K |
| order_card_qty | 주문 수량 상세 | 168K |
| order_item_addition | 부가 항목 (식권/스티커 등) | 815K |
| order_item_options | 주문 옵션 | 125K |
| order_deposits | 입금 정보 | 3.2K |
| order_refunds | 환불 정보 | 7.6K |
| order_addition_service | 부가 서비스 금액 | 6.1K |
| order_coupon_history | 쿠폰 사용 이력 | 66K |
| order_money_change_log | 금액 변경 이력 | 11.7K |
| order_job_ticket | 작업 지시서 | 848 |
| order_partnership | 제휴 주문 | 3.9K |
| order_seq_autoinc | 주문번호 자동채번 | 976K |
| order_card_bases | 카드 기본 설정 (미사용) | 6 |

#### orders 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 주문 ID |
| order_no | varchar(30) | 주문번호 |
| order_base | varchar(20) | 주문 기반 (wcard 기본) |
| user_id | int | 사용자 ID |
| partner_shop_id | int | 제휴점 ID |
| total_money | int | 총 금액 |
| paid_money | int | 결제 금액 |
| pay_type | varchar(10) | 결제 방식 |
| pg_name | varchar(20) | PG사 |
| pg_tno | varchar(200) | PG 거래번호 |
| order_state | varchar(3) | 주문 상태 (B=기본) |
| shipping_state | varchar(3) | 배송 상태 (B=기본) |
| printing_state | varchar(3) | 인쇄 상태 (B=기본) |
| draft_state | varchar(3) | 시안 상태 (B=기본) |
| order_type | char(1) | 주문 유형 (D=기본) |
| shipping_company | varchar(20) | 배송사 |
| shipping_number | varchar(20) | 송장번호 |
| barunson_order_seq | int | 바른손 연동 주문번호 |
| barunson_order_type | varchar(5) | 바른손 주문 유형 |
| created_at | timestamp | 주문일시 |
| pay_date | varchar(14) | 결제일 |
| order_step | varchar(20) | 주문 진행단계 |
| delivery_price | int | 배송비 |
| discount_money | int | 할인 금액 |
| original_amount | int | 원래 금액 |

#### order_items 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 항목 ID |
| order_no | varchar(25) | 주문번호 |
| order_item_no | varchar(30) | 주문 항목 번호 |
| item_type | varchar(20) | 항목 유형 |
| product_id | int | 상품 ID |
| product_code | varchar(20) | 상품 코드 |
| product_name | varchar(50) | 상품명 |
| order_id | int | 주문 ID |
| parent_id | int | 상위 항목 ID |
| qty | int | 수량 |
| total_money | int | 항목 금액 |
| barunson_order_seq | int | 바른손 연동 주문번호 |
| barunson_card_seq | int | 바른손 카드 순번 |
| barunson_card_code | varchar(20) | 바른손 카드 코드 |
| draft_state | varchar(3) | 시안 상태 |
| printing_state | varchar(3) | 인쇄 상태 |

#### order_card_contents 주요 컬럼 (카드 내용)
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 내용 ID |
| order_id / order_no | - | 주문 참조 |
| order_item_id / order_item_no | - | 주문항목 참조 |
| groom_name / bride_name | varchar(50) | 신랑/신부 이름 |
| groom_father / groom_mother | varchar(50) | 신랑 부모 |
| bride_father / bride_mother | varchar(50) | 신부 부모 |
| event_date | varchar(50) | 예식 일자 |
| event_hour_str / event_minute | - | 예식 시간 |
| wedd_name | varchar(50) | 예식장명 |
| wedd_place | varchar(50) | 예식 홀명 |
| wedd_addr / wedd_road_addr | varchar(150) | 예식장 주소 |
| wedd_phone | varchar(100) | 예식장 전화 |
| wedd_map_id / wedd_map_item_id | int | 약도 참조 |

### 2. 사용자 관리 (Users)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| users | 회원 마스터 | 112K |
| users_leave_log | 탈퇴 이력 | 123K |
| users_roles | 회원-역할 연결 | 50 |
| users_recommand | 추천인 | 1.0K |
| users_recommanded | 피추천인 | 304 |
| login_attempts | 로그인 시도 기록 | 1.46M |
| addresses | 주문/배송 주소 | 382K |
| marketing_agreement | 마케팅 동의 | 394K |
| marketing_agreement_log | 동의 변경 이력 | 435K |
| marketing_agreement_type | 동의 유형 마스터 | 7 |
| marketing_agreement_view | 동의 현황 뷰 | 32K |
| thirdparty_oauth | OAuth 연동 | 18 |
| roles | 역할 마스터 | 9 |
| admin_users | 관리자 (미사용) | 0 |
| __del_users_2023 | 2023년 삭제 회원 백업 | 121K |

#### users 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 회원 ID |
| user_id | varchar(50) | 로그인 ID (UNIQUE) |
| name | varchar(30) | 이름 |
| email | varchar(50) | 이메일 (UNIQUE) |
| phone | varchar(255) | 전화번호 |
| password | varchar(255) | 비밀번호 (해시) |
| join_channel | varchar(20) | 가입 경로 |
| social_key | varchar(30) | 소셜 로그인 키 |
| partner_shop_id | int | 제휴점 ID |
| is_test | char(1) | 테스트 계정 (F/T) |
| event_date | varchar(50) | 예식일 |
| hall_type | char(1) | 예식장 유형 (W=웨딩) |
| hall | varchar(100) | 예식장명 |
| chk_sms / chk_mail | char(1) | SMS/메일 수신 동의 |
| created_at | timestamp | 가입일 |
| last_login | timestamp | 최종 로그인 |

### 3. 상품 관리 (Products)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| products | 상품 마스터 | 1,241 |
| categories | 카테고리 마스터 | 49 |
| category_product | 카테고리-상품 연결 | 3,657 |
| options | 옵션 마스터 | 631 |
| options_items | 옵션 항목 | 16.5K |
| option_product | 옵션-상품 연결 | 2,276 |
| product_format | 상품 규격 (크기/용지 등) | 136 |
| product_design_group | 디자인 그룹-상품 연결 | 76 |
| product_design_group_info | 디자인 그룹 마스터 | 19 |
| product_card_addition | 상품-부가항목 연결 | 31.8K |
| product_mcard_template | 상품-모카드 템플릿 연결 | 67 |
| product_movie_template | 상품-영상 템플릿 연결 | 26 |
| product_relations | 관련 상품 | 119 |
| product_promotion_list | 프로모션 상품 | 366 |
| product_sample_oneclick | 원클릭 샘플 상품 | 50 |
| product_sets | 세트 상품 (미사용) | 0 |
| product_sweetday | 스윗데이 상품 | 9 |
| product_pick | 에디터 픽 | 2 |
| product_gift | 사은품 (미사용) | 0 |
| content_images | 상품 콘텐츠 이미지 | 1,497 |
| hashtag | 해시태그 | 9 |
| hashtag_product | 해시태그-상품 연결 | 304 |

#### products 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 상품 ID |
| code | varchar(20) | 상품 코드 |
| product_label | varchar(100) | 상품 라벨 |
| name | varchar(100) | 상품명 |
| type | varchar(20) | 상품 유형 |
| price | decimal(9,2) | 정가 |
| sale_price | decimal(9,2) | 판매가 |
| sale | decimal(9,2) | 할인가 |
| is_display | char(1) | 전시 여부 (T/F) |
| is_new / is_hit | tinyint | 신상/히트 여부 |
| is_recommend | tinyint | 추천 여부 |
| printing_company | varchar(10) | 인쇄사 (barunson 기본) |
| env_print_type | char(1) | 봉투 인쇄 유형 (E=기본) |
| qty_type | varchar(10) | 수량 유형 (option 기본) |
| is_qrcode | tinyint | QR코드 지원 |
| unit_type / unit_value | - | 단위 정보 |
| min_stock_qty | int | 최소 재고 수량 |
| created_at | timestamp | 등록일 |
| deleted_at | timestamp | 삭제일 (soft delete) |

### 4. 부가 항목 (Invitation Card Addition)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| invitation_card_addition | 부가항목 마스터 (식권/스티커 등) | 385 |
| invitation_card_addition_item | 부가항목 상세 | 542 |

#### invitation_card_addition 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 부가항목 ID |
| add_code | varchar(255) | 부가항목 코드 |
| add_name | varchar(255) | 부가항목명 |
| add_type | varchar(3) | 유형 (TIC=식권 기본) |
| add_qty | int | 수량 |
| add_price | int | 가격 |

### 5. 모바일 청첩장 (Mobile Cards)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| mobile_cards | 모바일 청첩장 | 37.5K |
| mobile_card_account | 축의금 계좌 정보 | 114K |
| mobile_card_addition | 모카드 추가 요소 (텍스트/이미지 등) | 736K |
| mobile_card_templates | 모카드 템플릿 마스터 | 75 |
| mobile_card_template_images | 템플릿 이미지 (미사용) | 0 |
| mobile_invitation_board | 모바일 청첩장 방명록 | 352K |

#### mobile_cards 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 모카드 ID |
| template_id | int | 템플릿 ID |
| product_id | int | 상품 ID |
| user_id | int | 사용자 ID |
| order_id / order_no | - | 주문 참조 |
| mcard_code | varchar(30) | 모카드 고유 코드 |
| mcard_name | varchar(100) | 모카드명 |
| groom_name / bride_name | varchar(50) | 신랑/신부 |
| groom_phone / bride_phone | varchar(30) | 연락처 |
| greeting | text | 인사말 |
| wedd_date | varchar(20) | 예식일 |
| map_title / map_address | varchar(255) | 예식장 정보 |
| map_lat / map_long | varchar(255) | 좌표 |
| use_gallary | char(1) | 갤러리 사용 (T/F) |
| use_toss | char(1) | 축의금 사용 (F 기본) |
| use_guestbook | char(1) | 방명록 사용 (T/F) |
| use_account | char(1) | 계좌 사용 (F 기본) |
| is_disabled | char(1) | 비활성 (F 기본) |
| start_at / end_at | timestamp | 표시 기간 |

### 6. 영상 주문 (Movie/Video)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| movie_order | 영상 주문 (미사용) | 124 |
| movie_order_images | 영상 주문 이미지 (미사용) | 5,874 |
| movie_template | 영상 템플릿 | 33 |
| video_templates | 비디오 템플릿 (미사용) | 0 |

### 7. 샘플 주문 (Sample Orders)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| sample_orders | 샘플 주문 마스터 | 200K |
| sample_order_items | 샘플 주문 항목 | 1.93M |
| sample_orders_dup | 중복 샘플 주문 | 680 |
| sample_order_items_dup | 중복 샘플 항목 | 6,989 |
| sample_carts | 샘플 장바구니 (미사용) | 0 |
| sample_cabinet | 샘플 캐비닛 (미사용) | 140 |
| sample_oneclick | 원클릭 샘플 | 5 |
| sample_stock_log | 샘플 재고 로그 (미사용) | 4 |

#### sample_orders 주요 컬럼
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| id | int (PK) | 샘플 주문 ID |
| sample_order_no | varchar(30) | 샘플 주문번호 |
| user_id | int | 사용자 ID |
| order_state | varchar(2) | 주문 상태 |
| shipping_state | varchar(2) | 배송 상태 |
| order_step | varchar(20) | 주문 단계 (payment 기본) |
| total_money / paid_money | int | 금액 |
| barunson_order_seq | int | 바른손 연동 |

### 8. 쿠폰/프로모션 (Coupons)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| coupons | 쿠폰 마스터 | 122 |
| coupon_issue | 쿠폰 발급 | 389K |
| coupon_hist | 쿠폰 이력 | 20 |
| coupon_info | 쿠폰 정보 (미사용) | 0 |
| coupon_user | 쿠폰-사용자 (미사용) | 0 |
| serial_coupons | 시리얼 쿠폰 마스터 | 33 |
| serial_coupon_issue | 시리얼 쿠폰 발급 | 107K |
| serial_coupon_user | 시리얼 쿠폰 사용자 (미사용) | 0 |
| coupons_category | 쿠폰-카테고리 연결 | 108 |
| coupons_product | 쿠폰-상품 연결 | 1,426 |
| category_serial_coupon | 카테고리-시리얼쿠폰 (미사용) | 0 |
| promotion | 프로모션 마스터 | 5 |
| promotion_list | 프로모션 목록 | 29 |

### 9. 제휴/파트너 (Partners)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| partner_shop | 제휴점 | 385 |
| partner_users | 제휴점 사용자 | 385 |
| partner_accounts | 제휴점 정산 | 60 |
| partner_user_password_reset | 비밀번호 초기화 | 0 |

### 10. CS/문의 (Customer Service)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| contact_contents | 1:1 문의 | 180K |
| contact_content_reply | 문의 답변 | 6.7K |
| counsel_contents | 상담 내용 | 97K |
| review_board | 리뷰 게시판 | 3.9K |
| review_cancel_comment | 리뷰 취소 코멘트 | 6 |
| faq_boards | FAQ 게시판 | 10 |
| faq_board_contents | FAQ 내용 | 62 |
| board | 게시판 마스터 | 2 |
| board_contents | 게시판 글 | 149 |
| board_content_reply | 게시판 답변 | 3 |

### 11. 예식장 약도 (Wedding Map)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| wedd_map | 예식장 약도 마스터 | 8,894 |
| wedd_map_item | 약도 상세 항목 | 8,961 |

### 12. 배송 (Shipping)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| cj_invoice_numbers | CJ 송장번호 풀 | 193K |
| shipping_manage | 배송 관리 설정 | 6 |
| cost_zipcode | 우편번호별 배송비 | 875 |
| cost_manage | 배송비 관리 | 3 |
| packing_manage | 포장 관리 (미사용) | 120 |
| packing_manage_orders | 포장 주문 (미사용) | 0 |

### 13. 결제 (Payment)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| lguplus_paid_list | LG유플러스 결제 내역 | 115K |
| toss_order | 토스 결제 주문 (미사용) | 128 |
| toss_account | 토스 계좌 (미사용) | 322 |
| toss_api_logs | 토스 API 로그 (미사용) | 3.9K |
| toss_stock | 토스 재고 (미사용) | 2 |
| toss_stock_log | 토스 재고 로그 (미사용) | 102 |
| toss_vacct_webhook_log | 토스 가상계좌 웹훅 | 4.0K |
| daily_account_log | 일별 매출 집계 | 24.5K |

### 14. 인쇄/재고 (Printing/Stock)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| indd_create_history | InDesign 파일 생성 이력 (미사용) | 14K |
| print_file_history | 인쇄 파일 이력 (미사용) | 1.8K |
| item_stock_manage | 재고 관리 (미사용) | 268 |
| item_stock_manage_item_typeset | 재고-활자세트 연결 (미사용) | 301 |
| item_stock_manage_log | 재고 변경 이력 (미사용) | 1.1K |
| item_typeset | 활자 세트 (미사용) | 306 |
| typeset_stock_log | 활자 재고 로그 (미사용) | 0 |
| link_indd_order_variable | InDesign 변수 (미사용) | 131 |
| draft_history | 시안 이력 (미사용) | 79K |
| draft_history_comment | 시안 코멘트 (미사용) | 0 |

### 15. 바른손 연동 (Barunson Integration)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| code_map_barunson | 바른손 코드 매핑 | 1,030 |

### 16. 기타/시스템 (System)

| 테이블명 | 용도 | 레코드 수 |
|---------|------|-----------|
| uploaded_images | 업로드 이미지 | 1.34M |
| send_sms_log | SMS 발송 로그 | 658K |
| send_email_log | 이메일 발송 로그 | 98 |
| notifications | 알림 | 13.4K |
| common_code | 공통 코드 | 42 |
| banners | 배너 | 55 |
| banner_images | 배너 이미지 | 16 |
| event_boards | 이벤트 게시판 | 63 |
| event_board_comments | 이벤트 댓글 | 14.9K |
| event_board_options | 이벤트 옵션 | 5 |
| event_boards_coupons | 이벤트-쿠폰 연결 | 7 |
| site_policy | 사이트 정책 | 41 |
| site_policy_benefit | 정책 혜택 | 5 |
| site_popup | 팝업 | 54 |
| sitemap | 사이트맵 | 14 |
| seo_info | SEO 정보 | 80 |
| sms | SMS 템플릿 | 21 |
| email | 이메일 템플릿 (미사용) | 0 |
| message_mail_template | 메일 템플릿 (미사용) | 0 |
| card_greeting | 인사말 템플릿 | 65 |
| main_display | 메인 디스플레이 | 3 |
| main_display_product | 메인 디스플레이 상품 | 24 |
| stickers | 스티커 | 9 |
| homuro_board | 호무로 게시판 | 1,988 |
| homuro_board_item | 호무로 항목 | 1,944 |
| sweetday | 스윗데이 | 0 |
| sweetday_board | 스윗데이 게시판 | 48 |
| holiday_calendar | 공휴일 캘린더 | 100 |
| search_word | 검색어 | 11 |
| search_word_product | 검색어-상품 연결 | 7 |
| policy_info | 정책 정보 | 8 |
| migrations | Laravel 마이그레이션 | 313 |
| jobs | 큐 작업 (미사용) | 0 |
| block_manager | 차단 관리 | 5 |
| best_sample | 베스트 샘플 | 3 |
| best_sample_product | 베스트 샘플 상품 | 63 |
| pick_product | 에디터 픽 상품 | 21 |
| mds_picks / mds_pick_products | MD 추천 (미사용) | 0 |
| shopping_carts | 장바구니 (미사용) | 0 |
| push_subscriptions | 푸시 구독 (미사용) | 0 |

## 상위 10 테이블 (레코드 수)

| 테이블 | 레코드 | 설명 |
|--------|--------|------|
| order_items | 2.16M | 주문 항목 |
| sample_order_items | 1.93M | 샘플 주문 항목 |
| login_attempts | 1.46M | 로그인 시도 |
| uploaded_images | 1.34M | 업로드 이미지 |
| order_seq_autoinc | 976K | 주문번호 자동채번 |
| order_card_envelopes | 823K | 봉투 정보 |
| order_item_addition | 815K | 부가 항목 |
| mobile_card_addition | 736K | 모카드 추가 요소 |
| send_sms_log | 658K | SMS 발송 |
| order_card_contents | 413K | 카드 내용 |

## 바른손 시스템 연동

DD 시스템은 바른손 시스템과 다음과 같이 연동됩니다:

- `orders.barunson_order_seq` → bar_shop1의 `custom_order.order_seq` 매핑
- `order_items.barunson_card_seq` → bar_shop1의 `S2_Card.Card_Seq` 매핑
- `order_items.barunson_card_code` → bar_shop1의 `S2_Card.Card_Code` 매핑
- `code_map_barunson` 테이블에 DD-바른손 코드 매핑 정보 저장
- `orders.base_printing_company` 기본값 'barunson' → 바른손 인쇄 위탁

## 상태값 참고

### order_state (주문 상태)
- B: 기본 (대기)

### shipping_state (배송 상태)
- B: 기본 (대기)

### printing_state (인쇄 상태)
- B: 기본 (대기)

### draft_state (시안 상태)
- B: 기본 (대기)

### is_display (상품 전시)
- T: 전시
- F: 미전시

### 부울형 패턴
- char(1): T/F 또는 Y/N
- tinyint: 0/1
