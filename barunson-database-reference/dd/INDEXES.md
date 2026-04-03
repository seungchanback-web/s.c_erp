# DD (wedding) 데이터베이스 인덱스

## 개요

- **DB 엔진**: MySQL InnoDB
- **전체 인덱스 수**: 약 180개
- **외래키 제약**: 없음 (모든 관계는 애플리케이션 레벨)
- **PK**: 대부분 auto_increment int

## 주요 테이블 인덱스

### orders (주문 마스터)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| order_no | order_no | UNIQUE | 주문번호 |
| user_id | user_id | INDEX | 사용자별 조회 |
| user_id_order_base | order_base, user_id | INDEX | 사용자+주문기반 |
| idx_orders_order_created_at_order_step | created_at, order_step | INDEX | 날짜+단계별 조회 |
| idx_orders_barunson_order_seq | barunson_order_seq | INDEX | 바른손 연동 |
| idx_bank_name | bank_name | INDEX | 입금 은행 |
| idx_shipping_number | shipping_number | INDEX | 송장번호 |
| idx_is_printing_print_state | is_printing, printing_state | INDEX | 인쇄 상태 |

### order_items (주문 항목)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| order_no | order_no | INDEX | |
| order_item_no | order_item_no | INDEX | |
| order_id | order_id | INDEX | |
| product_id | product_id | INDEX | |
| parent_id | parent_id | INDEX | |
| idx_product_code | product_code | INDEX | |
| idx_product_name | product_name | INDEX | |
| idx_barunson_order_seq | barunson_order_seq | INDEX | |
| idx_order_no_item_type_parent_id | order_no, item_type, parent_id | INDEX | 복합 |
| idx_parent_id_product_id | parent_id, product_id | INDEX | 복합 |

### order_card_contents (카드 내용)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| order_id | order_id | INDEX | |
| order_no | order_no | INDEX | |
| order_item_id | order_item_id | INDEX | |
| order_item_no | order_item_no | INDEX | |

### order_card_envelopes (봉투 정보)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| order_id | order_id | INDEX | |
| order_no | order_no | INDEX | |
| order_item_id | order_item_id | INDEX | |
| order_item_no | order_item_no | INDEX | |
| user_id | user_id | INDEX | |
| idx_env_person1 | env_person1 | INDEX | 수신인1 검색 |
| idx_env_person2 | env_person2 | INDEX | 수신인2 검색 |

### users (회원)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| user_id | user_id | UNIQUE | 로그인 ID |
| users_email_unique | email | UNIQUE | 이메일 |
| idx_user_name | name | INDEX | 이름 검색 |
| created_at | created_at | INDEX | 가입일 |
| user_id_created_at | user_id, created_at | INDEX | 복합 |

### products (상품)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| code | code | INDEX | 상품코드 |
| product_label | product_label | INDEX | 상품라벨 |

### mobile_cards (모바일 청첩장)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| idx_order1 | order_id | INDEX | |
| idx_order2 | mcard_code, deleted_at | INDEX | 복합 (코드+삭제) |
| order_no | order_no | INDEX | |

### mobile_card_addition (모카드 추가요소)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| idx_target | target_id, add_type, target, add_value | INDEX | 복합 4컬럼 |
| idx_add_value | add_value | INDEX | |

### mobile_invitation_board (방명록)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| mobile_invitation_board_board_key_index | board_key | INDEX | mcard_code 연결 |

### sample_orders (샘플 주문)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| sample_order_no | sample_order_no | INDEX | |
| user_id | user_id | INDEX | |
| idx_user_id_order_state | user_id, order_state | INDEX | 복합 |
| ix_sample_orders_state | order_step, created_at | INDEX | 복합 |

### sample_order_items (샘플 항목)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| sample_order_id | sample_order_id | INDEX | |
| sample_order_no | sample_order_no | INDEX | |
| sample_order_item_no | sample_order_item_no | INDEX | |
| product_id | product_id | INDEX | |

### coupon_issue (쿠폰 발급)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| coupon_id | coupon_id | INDEX | |
| user_id | user_id | INDEX | |
| order_no | order_no | INDEX | |
| coupon_id_is_used_user_id | coupon_id, user_id, is_used | INDEX | 복합 (사용여부 확인) |

### addresses (주소)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| idx_user_id | user_id | INDEX | |
| idx_order_name | order_name | INDEX | |
| idx_order_phone | order_phone | INDEX | |
| idx_order_phone_add | order_phone_add | INDEX | |
| idx_delivery_name | delivery_name | INDEX | |
| idx_delivery_phone | delivery_phone | INDEX | |
| idx_delivery_phone_add | delivery_phone_add | INDEX | |

### uploaded_images (업로드 이미지)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| target_target_id | target, target_id | INDEX | 복합 |
| idx_order_no | order_no | INDEX | |
| idx_sort_order | sort_order | INDEX | |
| idx_deleted | deleted_at | INDEX | |

### login_attempts (로그인 시도)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| login_attempts_user_id_foreign | user_id | INDEX | |
| idx_login_ip | login_ip | INDEX | |

### order_item_addition (부가 항목)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| order_id | order_id | INDEX | |
| order_no | order_no | INDEX | |
| order_item_id | order_item_id | INDEX | |
| order_item_no | order_item_no | INDEX | |
| addition_id | addition_id | INDEX | |
| addition_item_id | addition_item_id | INDEX | |

### order_partnership (제휴 주문)

| 인덱스명 | 컬럼 | 유형 | 비고 |
|----------|------|------|------|
| PRIMARY | id | PK | |
| order_id | order_id | INDEX | |
| p_ordercode_p_id | p_ordercode, p_id | INDEX | 복합 |
| p_id_lastupdatetime | p_id, lastupdatetime | INDEX | 복합 |
| p_id_p_orderdate | p_id, p_orderdate | INDEX | 복합 |

## 쿼리 최적화 가이드

### 주문 조회 시
```sql
-- GOOD: created_at + order_step 복합 인덱스 활용
SELECT * FROM orders
WHERE created_at >= '2026-01-01' AND order_step = 'payment';

-- GOOD: order_no 인덱스 활용
SELECT * FROM orders WHERE order_no = 'DD20260301001';

-- GOOD: user_id 인덱스 활용
SELECT * FROM orders WHERE user_id = 12345;
```

### 모바일 청첩장 조회 시
```sql
-- GOOD: mcard_code + deleted_at 복합 인덱스 활용
SELECT * FROM mobile_cards
WHERE mcard_code = 'ABC123' AND deleted_at IS NULL;
```

### 주의사항
- orders 테이블에 **order_state 단독 인덱스 없음** → order_state만으로 WHERE 조건 사용 시 Full Scan
- products 테이블에 **is_display 인덱스 없음** → 상품 전시여부만으로 필터링 시 Full Scan
- mobile_cards 테이블에 **user_id 인덱스 없음** → 사용자별 모카드 조회 시 주의
- order_card_contents에 **groom_name/bride_name 인덱스 없음** → 이름 검색 시 Full Scan
