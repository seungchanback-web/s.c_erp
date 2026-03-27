# barunson 데이터베이스 스키마

## 개요

- **데이터베이스**: barunson
- **테이블 수**: 94개
- **컬럼 수**: 1,182개
- **외래키 관계**: 47개
- **인덱스**: 139개
- **용도**: 디지털 상품, MC 시리즈 모바일 청첩장, 쿠폰, 계정 관리

## 테이블 카테고리

### 1. 주문 관리 (Order Management)

| 테이블명 | 용도 | 컬럼 수 | PK | FK | 인덱스 |
|---------|------|---------|-----|-----|--------|
| TB_Order | 주문 마스터 | 39 | 1 | 1 | 9 |
| TB_Order_Product | 주문 상품 항목 | 12 | 2 | 2 | 2 |
| TB_Order_Change_History | 주문 변경 이력 | 5 | 1 | 0 | 1 |
| TB_Order_Copy | 주문 복사본 | 36 | 0 | 0 | 0 |
| TB_Order_Coupon_Use | 주문 쿠폰 사용 | 9 | 1 | 2 | 2 |
| TB_Order_PartnerShip | 파트너십 주문 | 17 | 2 | 0 | 4 |
| TB_Order_Serial_Coupon_Use | 시리얼 쿠폰 사용 | 9 | 1 | 2 | 1 |
| TB_Temp_Order | 임시 주문 | - | 1 | 0 | 1 |

### 2. 상품 관리 (Product Management)

| 테이블명 | 용도 | 컬럼 수 | PK | FK | 인덱스 |
|---------|------|---------|-----|-----|--------|
| TB_Product | 상품 마스터 | 27 | 1 | 1 | 1 |
| TB_Product_Category | 상품 카테고리 | 9 | 2 | 1 | 1 |
| TB_Product_Icon | 상품 아이콘 | 8 | 2 | 2 | 1 |
| TB_Product_Image | 상품 이미지 | 10 | 1 | 1 | 1 |
| TB_Category | 카테고리 분류 | 19 | 1 | 0 | 1 |
| TB_Apply_Product | 적용 상품 | 2 | 2 | 1 | 1 |

### 3. 초대장 시스템 (Invitation System)

| 테이블명 | 용도 | 컬럼 수 | PK | FK | 인덱스 |
|---------|------|---------|-----|-----|--------|
| TB_Invitation | 초대장 마스터 (모든 MC 사용자) | 11 | 1 | 2 | 3 |
| TB_Invitation_Detail | 고객 입력 속성 (98 필드) | 98 | 1 | 0 | 2 |
| TB_Invitation_Admin | 초대장 관리자 | 15 | 1 | 0 | 1 |
| TB_Invitation_Area | 초대장 영역 | 12 | 2 | 2 | 1 |
| TB_Invitation_Item | 초대장 항목 | 15 | 1 | 2 | 2 |
| TB_Invitation_Tax | 초대장 세금 | 3 | 1 | 2 | 2 |
| TB_Invitation_Account | 초대장 계좌 | 9 | 3 | 1 | 1 |
| TB_Invitation_Detail_Etc | 초대장 기타 상세 | 4 | 2 | 1 | 1 |
| Origin_Invitation_Detail | 원본 초대장 URL | 4 | 0 | 0 | 0 |

### 4. 템플릿 시스템 (Template System)

| 테이블명 | 용도 | 컬럼 수 | PK | FK | 인덱스 |
|---------|------|---------|-----|-----|--------|
| TB_Template | 디자인 템플릿 마스터 | - | 1 | 0 | 1 |
| TB_Template_Area | 템플릿 영역 | - | 1 | 2 | 1 |
| TB_Template_Detail | 템플릿 상세 | - | 1 | 1 | 1 |
| TB_Template_Item | 템플릿 항목 | - | 1 | 2 | 1 |

### 5. 계정 관리 (Account Management)

| 테이블명 | 용도 | 컬럼 수 | PK | FK | 인덱스 |
|---------|------|---------|-----|-----|--------|
| TB_Account | 고객 계정 (은행계좌) | 9 | 1 | 1 | 2 |
| TB_Account_Extra | 추가 계좌 정보 | 8 | 2 | 1 | 1 |
| TB_Account_Setting | 계정 설정 | 7 | 1 | 0 | 1 |

### 6. 쿠폰 시스템 (Coupon System)

| 테이블명 | 용도 | 컬럼 수 | PK | FK | 인덱스 |
|---------|------|---------|-----|-----|--------|
| TB_Coupon | 쿠폰 정의 | 24 | 1 | 0 | 1 |
| TB_Coupon_Apply_Product | 쿠폰 적용 상품 | 2 | 1 | 0 | 1 |
| TB_Coupon_Exception_Product | 쿠폰 제외 상품 | 3 | 0 | 0 | 0 |
| TB_Coupon_Order | 쿠폰 주문 | 19 | 1 | 1 | 1 |
| TB_Coupon_Product | 쿠폰 상품 | 18 | 1 | 0 | 1 |
| TB_Coupon_Product_Option | 쿠폰 상품 옵션 | 4 | 1 | 1 | 1 |
| TB_Coupon_Publish | 쿠폰 발행 | 13 | 1 | 1 | 2 |
| TB_Coupon_Publish_TEST | 쿠폰 발행 테스트 | 13 | 1 | 1 | 1 |
| TB_Serial_Coupon | 시리얼 쿠폰 | - | 1 | 0 | 1 |
| TB_Serial_Coupon_Apply_Product | 시리얼 쿠폰 적용 상품 | - | 1 | 0 | 1 |
| TB_Serial_Coupon_Publish | 시리얼 쿠폰 발행 | - | 1 | 1 | 1 |
| TB_Serial_Apply_Product | 시리얼 적용 상품 | - | 1 | 1 | 1 |
| TB_CASEA_COUPON_PUBLISHED | 케이스A 쿠폰 | 3 | 0 | 0 | 0 |
| TB_CASEB_COUPON_PUBLISHED | 케이스B 쿠폰 | 3 | 0 | 0 | 1 |
| TB_SCHEDULER_COUPON_PUBLISHED | 스케줄러 쿠폰 | 3 | 0 | 0 | 1 |

### 7. 인터랙티브 기능 (Interactive Features)

| 테이블명 | 용도 | 컬럼 수 | PK | FK | 인덱스 |
|---------|------|---------|-----|-----|--------|
| TB_Gallery | 사진 갤러리 | 14 | 1 | 1 | 2 |
| TB_GuestBook | 방명록 | 12 | 1 | 1 | 2 |
| TB_RSVP | 참석 여부 | 8 | 1 | 0 | 1 |
| TB_RSVP_REPLY | RSVP 답변 | 10 | 2 | 0 | 1 |

### 8. 재무/통계 (Finance/Statistics)

| 테이블명 | 용도 |
|---------|------|
| TB_Calculate | 정산 처리 |
| TB_Remit | 송금 거래 |
| TB_Remit_Statistics_Daily | 일별 송금 통계 |
| TB_Remit_Statistics_Monthly | 월별 송금 통계 |
| TB_Refund_Info | 환불 정보 |
| TB_Tax | 세금 설정 |
| TB_Company_Tax | 회사 세금 정책 |
| TB_Invitation_Tax | 초대장 세금 |
| TB_Sales_Statistic_Day | 일별 매출 통계 |
| TB_Sales_Statistic_Month | 월별 매출 통계 |
| TB_Payment_Status_Day | 일별 결제 현황 |
| TB_Payment_Status_Month | 월별 결제 현황 |
| TB_Total_Statistic_Day | 일별 종합 통계 |
| TB_Total_Statistic_Month | 월별 종합 통계 |
| TB_StatisticsOrderProduce | 주문 생산 통계 |
| TB_Depositor_Hits | 입금자 조회수 |

### 9. 배너/팝업/관리 (Banner/Popup/Admin)

| 테이블명 | 용도 |
|---------|------|
| TB_Banner | 배너 |
| TB_Banner_Category | 배너 카테고리 |
| TB_Banner_Item | 배너 항목 |
| TB_Board | 게시판 |
| TB_Popup | 팝업 |
| TB_Popup_Item | 팝업 항목 |
| TB_FlaBannerManage | 플래시 배너 |
| TB_Admin_Memo | 관리자 메모 |

### 10. 공통/기타 (Common/Others)

| 테이블명 | 용도 |
|---------|------|
| TB_Common_Code | 공통 코드 |
| TB_Common_Code_Group | 공통 코드 그룹 |
| TB_Common_Menu | 공통 메뉴 |
| TB_Bank | 은행 정보 |
| TB_Area | 지역/영역 |
| TB_Icon | 아이콘 |
| TB_Item_Resource | 항목 리소스 |
| TB_Kakao_Cache | 카카오 캐시 |
| TB_PolicyInfo | 정책 정보 |
| TB_ReservationWord | 예약어 |
| TB_Standard_Date | 표준 날짜 |
| TB_UserOption | 사용자 옵션 |
| TB_Value_Entered_Login | 로그인 값 입력 |
| TB_Wish_List | 위시리스트 |
| TB_Daily_Unique | 일별 유니크 |
| TB_Error_Content | 오류 내용 |
| TB_Notification_Exclusion_List | 알림 제외 목록 |
| DataProtectionKeys | 데이터 보호 키 |
| SMS_Log | SMS 로그 |

## 주요 테이블 컬럼 상세

### TB_Order (주문 마스터 - 39개 컬럼)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Order_ID | int (PK) | 주문 ID |
| Order_Code | varchar | 주문 코드 (Unique) |
| Order_Type_Code | varchar | 주문 유형 코드 |
| User_ID | varchar | 사용자 ID |
| Email | varchar | 이메일 |
| Name | varchar | 이름 |
| CellPhone_Number | varchar | 휴대전화 |
| Total_Price | int | 총 가격 |
| Payment_Price | int | 결제 금액 (0=무료) |
| Payment_Method_Code | varchar | 결제 방법 코드 |
| Payment_Status_Code | varchar | 결제 상태 코드 |
| Payment_DateTime | datetime | 결제 일시 |
| Order_Status_Code | varchar | 주문 상태 코드 |
| Order_Path | varchar | 주문 경로 ('PC' 또는 'M') |
| Payment_Path | varchar | 결제 경로 ('PC' 또는 'M') |
| Previous_Order_ID | int (FK→TB_Order) | 이전 주문 ID |
| Regist_DateTime | datetime | 등록 일시 |
| Order_DateTime | datetime | 주문 일시 |
| Member_ID | varchar | 회원 ID |
| OrderSeq | int | 주문 순번 |

### TB_Product (상품 마스터 - 27개 컬럼)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Product_ID | int (PK) | 상품 ID (URL에 사용) |
| Product_Code | varchar | 상품 코드 (MC4114 등) |
| Product_Name | nvarchar | 상품명 |
| Product_Category_Code | varchar | 상품 카테고리 코드 |
| Product_Brand_Code | varchar | 상품 브랜드 코드 |
| Template_ID | int (FK→TB_Template) | 템플릿 ID |
| Price | int | 가격 |
| Discount_Rate | int | 할인율 |
| Discount_Price | int | 할인 가격 |
| Display_YN | varchar | 표시 여부 |
| Regist_DateTime | datetime | 등록 일시 |

### TB_Invitation (초대장 마스터 - 11개 컬럼)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Invitation_ID | int (PK) | 초대장 ID |
| Order_ID | int (FK→TB_Order) | 주문 ID (NULL 가능=무료 사용자) |
| Template_ID | int (FK→TB_Template) | 템플릿 ID |
| User_ID | varchar | 사용자 ID |
| Regist_User_ID | varchar | 등록자 ID |
| Regist_DateTime | datetime | 등록 일시 |
| Regist_IP | varchar | 등록 IP |
| Update_User_ID | varchar | 수정자 ID |
| Update_DateTime | datetime | 수정 일시 |
| Update_IP | varchar | 수정 IP |
| Invitation_Display_YN | varchar | 표시 여부 |

> **주의**: Invitation_URL, Delegate_Image_URL, SNS_Image_URL은 TB_Invitation이 아닌 **TB_Invitation_Detail**에 존재합니다.

### TB_Order_Product (주문 상품 - 12개 컬럼)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Order_Product_ID | int (PK) | 주문상품 ID |
| Order_ID | int (FK→TB_Order) | 주문 ID |
| Product_ID | int (FK→TB_Product) | 상품 ID |
| Item_Count | int | 수량 |
| Item_Price | int | 단가 |
| Total_Price | int | 합계 |
| Regist_DateTime | datetime | 등록 일시 |

## Product_ID와 URL 매핑

| Product_ID | Product_Code | Product_Name |
|-----------|-------------|--------------|
| 1186 | MC4111 | 고백하는 날 |
| 1187 | MC4113 | 반짝반짝 사랑 |
| 1188 | MC4114 | 영화 같은 순간 |
| 1189 | MC4115 | 마가렛 |

URL 패턴: `https://www.barunsonmcard.com/Product/Detail/{Product_ID}`
