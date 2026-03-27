# barunson 데이터베이스 인덱스 및 외래키

## 인덱스 전체 목록 (139개)

### TB_Order (9개 인덱스 - 가장 많음)

| 인덱스명 | 타입 | Unique | PK | 대상 컬럼 |
|---------|------|--------|-----|----------|
| PK_TB_Order | CLUSTERED | O | O | Order_ID |
| NCIDX_Order_Code | NONCLUSTERED | O | X | Order_Code |
| IX_TB_Order_Email | NONCLUSTERED | X | X | Email |
| IX_TB_Order_MemberId | NONCLUSTERED | X | X | Member_ID |
| IX_TB_Order_User_ID | NONCLUSTERED | X | X | User_ID |
| IX_TB_Order_Order_DateTime | NONCLUSTERED | X | X | Order_DateTime |
| IX_TB_Order_Payment_DateTime | NONCLUSTERED | X | X | Payment_DateTime |
| IX_TB_Order_REegist_Date | NONCLUSTERED | X | X | Regist_DateTime |
| IX_TB_Order_OrderSeq | NONCLUSTERED | X | X | OrderSeq |

### TB_Invitation (3개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Invitation | CLUSTERED | O | Invitation_ID |
| IX_TB_Invitation_Order_ID | NONCLUSTERED | O | Order_ID |
| Idx_tb_invitation_template_id | NONCLUSTERED | X | Template_ID |

### TB_Invitation_Detail (2개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Invitation_Detail | CLUSTERED | O | Invitation_ID |
| NCIDX_Invitation_Detail_URL | NONCLUSTERED | O | URL 컬럼 |

### TB_Product (1개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Product | CLUSTERED | O | Product_ID |

> 주의: Product_Code에 인덱스 없음. 테이블 크기가 작아 영향 적음.

### TB_Order_Product (2개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Order_Product | CLUSTERED | O | Order_Product_ID |
| IX_TB_Order_Product_ProductID | NONCLUSTERED | X | Product_ID |

### TB_Gallery (2개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Gallery | CLUSTERED | O | Gallery_ID |
| IX_TB_Gallery_ID | NONCLUSTERED | X | Invitation_ID |

### TB_GuestBook (2개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_GuestBook | CLUSTERED | O | GuestBook_ID |
| IX_TB_GuestBook_ID | NONCLUSTERED | X | Invitation_ID |

### TB_Remit (4개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Remit | CLUSTERED | O | Remit_ID |
| IX_TB_Remit_Account_ID | NONCLUSTERED | X | Account_ID |
| IX_TB_Remit_Compleate_DateTime | NONCLUSTERED | X | Complete_DateTime |
| IX_TB_Remit_Invitation_ID | NONCLUSTERED | X | Invitation_ID |

### TB_Refund_Info (2개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Refund_Info | CLUSTERED | O | Refund_ID |
| IX_TB_Refund_Info_Order_ID | NONCLUSTERED | X | Order_ID |

### TB_Depositor_Hits (3개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Depositor_Hits | CLUSTERED | O | Depositor_Hits_ID |
| IX_TB_Depositor_Hits_UserID | NONCLUSTERED | X | User_ID |
| NonClusteredIndex_TB_Depositor_Hits_RegistDate | NONCLUSTERED | X | Request_Date |

### TB_Order_PartnerShip (4개)

| 인덱스명 | 타입 | Unique | 대상 컬럼 |
|---------|------|--------|----------|
| PK_TB_Order_PartnerShip | CLUSTERED | O | PK 컬럼 |
| IX_TB_Order_PartnerShip_Order_ID | NONCLUSTERED | X | Order_ID |
| IX_TB_Order_PartnerShip_OrderDatae | NONCLUSTERED | X | Order_Date |
| IX_TB_Order_PartnerShip_UpdateTime | NONCLUSTERED | X | Update_Time |

### 통계 테이블 인덱스 (날짜 기반)

| 테이블 | 인덱스 | 대상 컬럼 |
|--------|--------|----------|
| TB_Payment_Status_Day | IX_TB_Payment_Status_Day_Date | Date |
| TB_Payment_Status_Month | IX_TB_Payment_Status_Month_Date | Date |
| TB_Sales_Statistic_Day | IX_TB_Sales_Statistic_Day_Date | Date |
| TB_Sales_Statistic_Month | IX_TB_Sales_Statistic_Month_Date | Date |
| TB_Total_Statistic_Day | IX_TB_Total_Statistic_Day_Date | Date |
| TB_Total_Statistic_Month | IX_TB_Total_Statistic_Month_Date | Date |

### 기타 주요 인덱스

| 테이블 | 인덱스 | 대상 컬럼 |
|--------|--------|----------|
| TB_Coupon_Publish | IX_TB_Coupon_Publish_CouponID_UserID | Coupon_ID + User_ID |
| TB_Order_Coupon_Use | IX_TB_Order_Coupon_Use_Publish_ID | Coupon_Publish_ID |
| TB_Calculate | NonClusteredIndex-20211213-105358 | (미명명) |
| TB_CASEB_COUPON_PUBLISHED | IX_NC_TB_CASEB_COUPON_PUBLISHED_member_id | member_id |
| TB_SCHEDULER_COUPON_PUBLISHED | IX_NC_TB_SCHEDULER_COUPON_PUBLISHED_member_id | member_id |
| TB_Value_Entered_Login | IX_TB_Value_Entered_Login_USER_ID | USER_ID |
| TB_Wish_List | IX_TB_Wish_List_userid | User_ID |
| TB_Invitation_Item | IX_TB_Invitation_Item_ID | Invitation_ID |
| TB_Invitation_Tax | IX_TB_InvitationTax_Tax_ID | Tax_ID |

---

## 외래키 관계 (47개)

### 주문 관련

| FK명 | 부모 테이블.컬럼 → 참조 테이블.컬럼 |
|------|----------------------------------|
| FK_TB_Order_TO_TB_Order | TB_Order.Previous_Order_ID → TB_Order.Order_ID |
| FK_TB_Order_TO_TB_Order_Product | TB_Order_Product.Order_ID → TB_Order.Order_ID |
| FK_TB_Product_TO_TB_Order_Product | TB_Order_Product.Product_ID → TB_Product.Product_ID |
| FK_TB_Order_TO_TB_Order_Coupon_Use | TB_Order_Coupon_Use.Order_ID → TB_Order.Order_ID |
| FK_TB_Coupon_Publish_TO_TB_Order_Coupon_Use | TB_Order_Coupon_Use.Coupon_Publish_ID → TB_Coupon_Publish.Coupon_Publish_ID |
| FK_TB_Order_TO_TB_Order_Serial_Coupon_Use | TB_Order_Serial_Coupon_Use.Order_ID → TB_Order.Order_ID |
| FK_TB_Serial_Coupon_Publish_TO_TB_Order_Serial_Coupon_Use | TB_Order_Serial_Coupon_Use.Coupon_Publish_ID → TB_Serial_Coupon_Publish.Coupon_Publish_ID |
| FK_TB_Order_TO_TB_Refund_Info | TB_Refund_Info.Order_ID → TB_Order.Order_ID |

### 초대장 관련

| FK명 | 부모 테이블.컬럼 → 참조 테이블.컬럼 |
|------|----------------------------------|
| FK_TB_Order_TO_TB_Invitation | TB_Invitation.Order_ID → TB_Order.Order_ID |
| FK_TB_Template_TO_TB_Invitation | TB_Invitation.Template_ID → TB_Template.Template_ID |
| FK_TB_Invitation_TB_Account | TB_Account.Invitation_ID → TB_Invitation.Invitation_ID |
| FK_TB_Invitation_TB_Account_Extra | TB_Account_Extra.Invitation_ID → TB_Invitation.Invitation_ID |
| FK_TB_Invitation_TO_TB_Gallery | TB_Gallery.Invitation_ID → TB_Invitation.Invitation_ID |
| FK_TB_Invitation_TO_TB_GuestBook | TB_GuestBook.Invitation_ID → TB_Invitation.Invitation_ID |
| FK_TB_Invitation_TB_Invitation_Account | TB_Invitation_Account.Invitation_ID → TB_Invitation.Invitation_ID |
| FK_TB_Invitation_TO_TB_Invitation_Area | TB_Invitation_Area.Invitation_ID → TB_Invitation.Invitation_ID |
| FK_TB_Area_TO_TB_Invitation_Area | TB_Invitation_Area.Area_ID → TB_Area.Area_ID |
| FK_TB_Invitation_TO_TB_Invitation_Detail_Etc | TB_Invitation_Detail_Etc.Invitation_ID → TB_Invitation.Invitation_ID |
| FK_TB_Invitation_TO_TB_Invitation_Item | TB_Invitation_Item.Invitation_ID → TB_Invitation.Invitation_ID |
| FK_TB_Item_Resource_TO_TB_Invitation_Item | TB_Invitation_Item.Resource_ID → TB_Item_Resource.Resource_ID |
| FK_TB_Invitation_TO_TB_Invitation_Tax | TB_Invitation_Tax.Invitation_ID → TB_Invitation_Tax.Invitation_ID |
| FK_TB_Tax_TO_TB_Invitation_Tax | TB_Invitation_Tax.Tax_ID → TB_Tax.Tax_ID |

### 상품 관련

| FK명 | 부모 테이블.컬럼 → 참조 테이블.컬럼 |
|------|----------------------------------|
| FK_TB_Template_TO_TB_Product | TB_Product.Template_ID → TB_Template.Template_ID |
| FK_TB_Product_TO_TB_Product_Category | TB_Product_Category.Product_ID → TB_Product.Product_ID |
| FK_TB_Product_TO_TB_Product_Icon | TB_Product_Icon.Product_ID → TB_Product.Product_ID |
| FK_TB_Icon_TO_TB_Product_Icon | TB_Product_Icon.Icon_ID → TB_Icon.Icon_ID |
| FK_TB_Product_TO_TB_Product_Image | TB_Product_Image.Product_ID → TB_Product.Product_ID |

### 쿠폰 관련

| FK명 | 부모 테이블.컬럼 → 참조 테이블.컬럼 |
|------|----------------------------------|
| FK_TB_Coupon_TO_TB_Coupon_Publish | TB_Coupon_Publish.Coupon_ID → TB_Coupon.Coupon_ID |
| FK_TB_Coupon_TO_TB_Coupon_Publish_TEST | TB_Coupon_Publish_TEST.Coupon_ID → TB_Coupon.Coupon_ID |
| FK_TB_Coupon_Product_TO_TB_Coupon_Order | TB_Coupon_Order.Coupon_Product_ID → TB_Coupon_Product.Coupon_Product_ID |
| FK_TB_Coupon_Product_TO_TB_Coupon_Product_Option | TB_Coupon_Product_Option.Coupon_Product_ID → TB_Coupon_Product.Coupon_Product_ID |
| FK_TB_Coupon_Apply_Product_TO_TB_Apply_Product | TB_Apply_Product.Product_Apply_ID → TB_Coupon_Apply_Product.Product_Apply_ID |
| FK_TB_Serial_Coupon_TO_TB_Serial_Coupon_Publish | TB_Serial_Coupon_Publish.Coupon_ID → TB_Serial_Coupon.Coupon_ID |
| FK_TB_Serial_Coupon_Apply_Product_TO_TB_Serial_Apply_Product | TB_Serial_Apply_Product.Product_Apply_ID → TB_Serial_Coupon_Apply_Product.Product_Apply_ID |

### 기타

| FK명 | 부모 테이블.컬럼 → 참조 테이블.컬럼 |
|------|----------------------------------|
| FK_TB_Banner_Category_TO_TB_Banner | TB_Banner.Banner_Category_ID → TB_Banner_Category.Banner_Category_ID |
| FK_TB_Banner_TO_TB_Banner_Item | TB_Banner_Item.Banner_ID → TB_Banner.Banner_ID |
| FK_TB_Common_Code_Group_TO_TB_Common_Code | TB_Common_Code.Code_Group → TB_Common_Code_Group.Code_Group |
| FK_TB_Common_Menu_TO_TB_Common_Menu | TB_Common_Menu.Parent_Menu_ID → TB_Common_Menu.Menu_ID |
| FK_TB_Popup_TO_TB_Popup_Item | TB_Popup_Item.Popup_ID → TB_Popup.Popup_ID |
| FK_TB_Remit_TO_TB_Calculate | TB_Calculate.Remit_ID → TB_Remit.Remit_ID |
| FK_TB_Coupon_Order_TO_TB_Remit | TB_Remit.Coupon_Order_ID → TB_Coupon_Order.Coupon_Order_ID |
| FK_TB_Invitation_Tax_TO_TB_Remit | TB_Remit.Invitation_ID → TB_Invitation_Tax.Invitation_ID |
| FK_TB_Area_TO_TB_Template_Area | TB_Template_Area.Area_ID → TB_Area.Area_ID |
| FK_TB_Template_TO_TB_Template_Area | TB_Template_Area.Template_ID → TB_Template.Template_ID |
| FK_TB_Template_TO_TB_Template_Detail | TB_Template_Detail.Template_ID → TB_Template.Template_ID |
| FK_TB_Item_Resource_TO_TB_Template_Item | TB_Template_Item.Resource_ID → TB_Item_Resource.Resource_ID |
| FK_TB_Template_TO_TB_Template_Item | TB_Template_Item.Template_ID → TB_Template.Template_ID |
