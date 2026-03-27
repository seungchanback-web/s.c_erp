# barunson 데이터베이스 ERD (Entity Relationship Diagram)

## 핵심 관계도

```mermaid
erDiagram
    TB_Order {
        int Order_ID PK
        varchar Order_Code
        varchar Order_Type_Code
        int User_ID
        varchar Email
        varchar Name
        varchar CellPhone_Number
        int Total_Price
        int Payment_Price
        varchar Payment_Method_Code
        varchar Payment_Status_Code
        datetime Payment_DateTime
        varchar Order_Status_Code
        varchar Order_Path "PC or M"
        varchar Payment_Path "PC or M"
        int Previous_Order_ID FK
        datetime Regist_DateTime
        datetime Order_DateTime
    }

    TB_Order_Product {
        int Order_Product_ID PK
        int Order_ID FK
        int Product_ID FK
        int Item_Count
        int Item_Price
        int Total_Price
        datetime Regist_DateTime
    }

    TB_Product {
        int Product_ID PK
        varchar Product_Code "MC4114 등"
        nvarchar Product_Name
        varchar Product_Category_Code
        varchar Product_Brand_Code
        int Template_ID FK
        int Price
        int Discount_Rate
        int Discount_Price
        varchar Display_YN
        datetime Regist_DateTime
    }

    TB_Template {
        int Template_ID PK
        varchar Template_Name
        varchar ProductBrand_Code
        varchar Template_Type_Code
        varchar PC_URL
        varchar Mobile_URL
        datetime Regist_DateTime
    }

    TB_Invitation {
        int Invitation_ID PK
        int Order_ID FK
        int Template_ID FK
        varchar User_ID
        varchar Regist_User_ID
        datetime Regist_DateTime
        varchar Regist_IP
        varchar Update_User_ID
        datetime Update_DateTime
        varchar Update_IP
        varchar Invitation_Display_YN
    }

    TB_Invitation_Detail {
        int Invitation_ID PK_FK
        varchar Groom_Name
        varchar Bride_Name
        varchar WeddingDate
        varchar Weddinghall_Name
        varchar Weddinghall_Address
    }

    TB_Gallery {
        int Gallery_ID PK
        int Invitation_ID FK
        int Sort_Order
        varchar Image_URL
        datetime Regist_DateTime
    }

    TB_GuestBook {
        int GuestBook_ID PK
        int Invitation_ID FK
        varchar Name
        varchar Message
        datetime Regist_DateTime
    }

    TB_Account {
        int Account_ID PK
        int Invitation_ID FK
        varchar Bank_Code
        varchar Account_Number
        varchar Depositor_Name
    }

    TB_Account_Extra {
        int Invitation_ID PK_FK
        int Sort PK
        varchar Bank_Code
        varchar Account_Number
        varchar Account_Holder
    }

    TB_Coupon {
        int Coupon_ID PK
        varchar Coupon_Name
        varchar Discount_Method_Code
        float Discount_Rate
        int Discount_Price
        varchar Use_YN
    }

    TB_Coupon_Publish {
        int Coupon_Publish_ID PK
        int Coupon_ID FK
        varchar User_ID
        varchar Use_YN
        datetime Use_DateTime
    }

    TB_Order_Coupon_Use {
        int Order_Coupon_Use_ID PK
        int Order_ID FK
        int Coupon_Publish_ID FK
        int Discount_Price
    }

    TB_Refund_Info {
        int Refund_ID PK
        int Order_ID FK
        int Refund_Price
        varchar Refund_Status_Code
        datetime Refund_DateTime
    }

    TB_Remit {
        int Remit_ID PK
        int Account_ID
        int Invitation_ID
        varchar Remitter_Name
        varchar Result_Code
    }

    TB_Calculate {
        int Calculate_ID PK
        int Remit_ID FK
        int Remit_Price
        varchar Status_Code
    }

    TB_Order ||--o{ TB_Order_Product : "has"
    TB_Order_Product }o--|| TB_Product : "contains"
    TB_Product }o--|| TB_Template : "uses"
    TB_Order ||--o| TB_Invitation : "creates"
    TB_Invitation }o--|| TB_Template : "based on"
    TB_Invitation ||--|| TB_Invitation_Detail : "has details"
    TB_Invitation ||--o{ TB_Gallery : "has images"
    TB_Invitation ||--o{ TB_GuestBook : "has messages"
    TB_Invitation ||--o{ TB_Account : "has accounts"
    TB_Invitation ||--o{ TB_Account_Extra : "has extra accounts"
    TB_Coupon ||--o{ TB_Coupon_Publish : "publishes"
    TB_Order ||--o{ TB_Order_Coupon_Use : "uses coupons"
    TB_Order_Coupon_Use }o--|| TB_Coupon_Publish : "applies"
    TB_Order ||--o| TB_Refund_Info : "may have refund"
    TB_Order ||--o| TB_Order : "has previous"
    TB_Remit }o--|| TB_Calculate : "settled by"
```

## 핵심 관계 요약

### 주문 플로우
```
TB_Order → TB_Order_Product → TB_Product → TB_Template
```

### 초대장 생성
```
TB_Order → TB_Invitation → TB_Invitation_Detail (97 필드)
                         → TB_Gallery (사진)
                         → TB_GuestBook (방명록)
                         → TB_Account (축의금 계좌)
                         → TB_Account_Extra (추가 계좌)
```

### 쿠폰 사용
```
TB_Coupon → TB_Coupon_Publish → TB_Order_Coupon_Use → TB_Order
```

### 축의금 송금
```
TB_Invitation → TB_Remit → TB_Calculate
```

### 환불 처리
```
TB_Order → TB_Refund_Info
```

## 비즈니스 규칙

1. 하나의 Order는 하나의 Invitation을 생성 (1:1)
2. Invitation은 반드시 하나의 Invitation_Detail을 가짐 (1:1)
3. Product는 Template을 통해 디자인과 연결
4. Gallery, GuestBook은 Invitation별 선택적 기능
5. 여러 은행 계좌를 Invitation에 등록 가능 (축의금)
6. 쿠폰은 발행(Publish) 후 주문에서 사용(Order_Coupon_Use)
7. Order는 자기 참조 (Previous_Order_ID)로 주문 이력 추적
