# barunson 재무/통계 테이블 상세

## 정산 및 송금

### TB_Calculate (정산 테이블)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Calculate_ID | int (PK) | 정산 ID |
| Remit_ID | int (FK→TB_Remit) | 송금 ID |
| Calculate_Type_Code | varchar(50) | 정산 유형 (CTC02: 송금) |
| Remit_Price | int | 송금 금액 |
| Remit_Bank_Code | varchar(3) | 은행 코드 |
| Remit_Account_Number | varchar(50) | 계좌번호 |
| Remit_Content | nvarchar(400) | 송금 내용 |
| Status_Code | varchar(50) | 상태 (200: 성공) |
| Calculate_DateTime | datetime | 정산 일시 |

축의금 범위: 9,000원 ~ 99,000원
주요 은행: KB(004), 농협(011), 우리(020), 신한(088), 카카오뱅크(090)

### TB_Remit (송금 테이블)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Remit_ID | int (PK) | 송금 ID |
| Account_ID | int | 계정 ID |
| Invitation_ID | int | 초대장 ID |
| Partner_Order_ID | varchar(100) | 파트너 주문 ID |
| Account_Number | varchar(50) | 계좌번호 |
| Bank_Code | varchar(3) | 은행 코드 |
| Remitter_Name | nvarchar(50) | 송금인 이름 |
| Result_Code | varchar(50) | 결과 코드 |
| Status_Code | varchar(50) | 상태 코드 |

### TB_Refund_Info (환불 정보)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Refund_ID | int (PK) | 환불 ID |
| Order_ID | int (FK→TB_Order) | 주문 ID |
| Refund_Type_Code | varchar(50) | 환불 유형 (RTC01: 일반, RTC04: 취소) |
| Refund_Price | int | 환불 금액 |
| Refund_Status_Code | varchar(50) | 환불 상태 (RSC02: 완료) |
| Regist_User_ID | varchar(50) | 처리 담당자 |

## 매출 통계

### TB_Sales_Statistic_Day (일별 매출)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Date | char(8) | 날짜 (YYYYMMDD) |
| Barunn_Sales_Price | int | 바른손카드 매출액 |
| Barunn_Free_Order_Count | int | 무료 주문 수 |
| Barunn_Charge_Order_Count | int | 유료 주문 수 |
| Bhands_Sales_Price | int | 비핸즈 매출액 |
| Thecard_Sales_Price | int | 더카드 매출액 |
| Premier_Sales_Price | int | 프리미어 매출액 |
| Total_Sales_Price | int | 전체 매출액 |

### TB_Payment_Status_Day (일별 결제)

| 컬럼명 | 데이터 타입 | 설명 |
|--------|------------|------|
| Date | char(8) | 날짜 |
| Card_Payment_Price | int | 카드 결제 금액 |
| Account_Transfer_Price | int | 계좌이체 금액 |
| Virtual_Account_Price | int | 가상계좌 금액 |
| Total_Price | int | 총 결제 금액 |
| Cancel_Refund_Price | int | 취소/환불 금액 |
| Profit_Price | int | 순이익 |

결제 비율: 카드 60-70%, 가상계좌 30-40%, 계좌이체 1% 미만

### TB_Tax / TB_Company_Tax

| 컬럼명 | 설명 |
|--------|------|
| Tax_ID | 세금 ID |
| Tax | 현재 세율 |
| Remit_Tax | 송금 세금 (230) |
| Calculate_Tax | 정산 세금 (70) |
| Hits_Tax | 조회 세금 (15) |

## 프로세스 플로우

### 주문-결제-정산
```
TB_Order → TB_Payment_Status_Day → TB_Sales_Statistic_Day → TB_Calculate
```

### 축의금 송금
```
TB_Invitation → TB_Remit → TB_Calculate → TB_Remit_Statistics_Daily
```

### 환불
```
TB_Order → TB_Refund_Info → TB_Payment_Status_Day (환불 반영)
```
