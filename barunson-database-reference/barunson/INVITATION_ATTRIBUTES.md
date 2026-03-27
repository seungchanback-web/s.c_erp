# TB_Invitation_Detail 속성 상세 (97개 필드)

## 개요

MC 시리즈 상품의 고객 입력 속성을 저장하는 테이블입니다. 98개의 컬럼으로 구성됩니다.

> **참고**: Invitation_URL, Delegate_Image_URL, SNS_Image_URL도 이 테이블에 포함되어 있습니다 (TB_Invitation이 아님).

## 속성 분류

### 1. 기본 정보
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| Invitation_Title | nvarchar | 청첩장 제목 |
| Greetings | nvarchar | 인사말 |
| Sender | nvarchar | 발신자 |

### 2. 신랑 정보 (Groom)
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| Groom_Name | nvarchar | 신랑 이름 |
| Groom_EngName | nvarchar | 신랑 영문 이름 |
| Groom_Phone | varchar | 신랑 전화번호 |
| Groom_Global_Phone_YN | char | 국제전화 여부 |
| Groom_Global_Phone_Number | varchar | 국제전화번호 |

### 3. 신부 정보 (Bride)
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| Bride_Name | nvarchar | 신부 이름 |
| Bride_EngName | nvarchar | 신부 영문 이름 |
| Bride_Phone | varchar | 신부 전화번호 |
| Bride_Global_Phone_YN | char | 국제전화 여부 |
| Bride_Global_Phone_Number | varchar | 국제전화번호 |
| Bride_First_YN | char | 신부 이름 우선 표시 여부 |

### 4. 부모님 정보 (Parents)
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| Parents_Information_Use_YN | char | 부모님 정보 사용 여부 |
| Groom_Father_Name | nvarchar | 신랑 아버지 이름 |
| Groom_Father_Title | nvarchar | 신랑 아버지 호칭 |
| Groom_Father_Phone | varchar | 신랑 아버지 전화번호 |
| Groom_Father_Deceased_YN | char | 신랑 아버지 고인 여부 |
| Groom_Mother_Name | nvarchar | 신랑 어머니 이름 |
| Groom_Mother_Title | nvarchar | 신랑 어머니 호칭 |
| Groom_Mother_Phone | varchar | 신랑 어머니 전화번호 |
| Groom_Mother_Deceased_YN | char | 신랑 어머니 고인 여부 |
| Bride_Father_Name | nvarchar | 신부 아버지 이름 |
| Bride_Father_Title | nvarchar | 신부 아버지 호칭 |
| Bride_Father_Phone | varchar | 신부 아버지 전화번호 |
| Bride_Father_Deceased_YN | char | 신부 아버지 고인 여부 |
| Bride_Mother_Name | nvarchar | 신부 어머니 이름 |
| Bride_Mother_Title | nvarchar | 신부 어머니 호칭 |
| Bride_Mother_Phone | varchar | 신부 어머니 전화번호 |
| Bride_Mother_Deceased_YN | char | 신부 어머니 고인 여부 |

### 5. 결혼식 정보 (Wedding)
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| WeddingDate | varchar | 결혼 날짜 |
| WeddingHHmm | varchar | 결혼 시간 |
| Time_Type_Name | varchar | 시간 유형 (오전/오후 등) |
| Weddinghall_Name | nvarchar | 예식장 이름 |
| Weddinghall_Address | nvarchar | 예식장 주소 |
| Weddinghall_PhoneNumber | varchar | 예식장 전화번호 |
| Weddinghall_Location_LAT | float | 위도 (GPS) |
| Weddinghall_Location_LOT | float | 경도 (GPS) |
| Weddinghall_Detail | nvarchar | 예식장 상세 (층/홀) |

### 6. 미디어 옵션 (Media)
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| Delegate_Image_URL | varchar | 대표 이미지 URL |
| SNS_Image_URL | varchar | SNS 공유 이미지 URL |
| Outline_Image_URL | varchar | 아웃라인 이미지 URL |
| Main_Image_URL | varchar | 메인 이미지 URL |
| BGM_URL | varchar | 배경음악 URL |
| BGM_YN | char | BGM 사용 여부 |
| BGM_Auto_Play_YN | char | BGM 자동재생 여부 |
| Video_URL | varchar | 동영상 URL |
| Video_YN | char | 동영상 사용 여부 |

### 7. 인터랙티브 기능 (Interactive)
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| Gallery_Use_YN | char | 갤러리 사용 여부 |
| GuestBook_Use_YN | char | 방명록 사용 여부 |
| Rsvp_Use_YN | nchar | RSVP 사용 여부 |
| Sender | nvarchar | 발신자 정보 |
| GalleryPreventPhoto_YN | char | 갤러리 사진 방지 여부 |
| Gallery_Type_Code | varchar | 갤러리 유형 코드 |

### 8. 금융 설정 (Financial)
| 컬럼명 | 타입 | 설명 |
|--------|------|------|
| MoneyAccount_Div_Use_YN | char | 축의금 계좌 구분 사용 여부 |
| MoneyAccount_Remit_Use_YN | char | 축의금 계좌 송금 사용 여부 |
| MoneyGift_Remit_Use_YN | char | 축의금 송금 사용 여부 |
| Conf_KaKaoPay_YN | char | 카카오페이 사용 여부 |
| Conf_Remit_YN | char | 송금 기능 사용 여부 |

### 9. 표시 제어 (Display Controls)
다수의 YN 플래그로 각 기능의 가시성을 제어합니다.

## 조회 예시

```sql
-- MC 상품의 고객 입력 정보 조회
SELECT
    d.Groom_Name, d.Bride_Name,
    d.WeddingDate, d.WeddingHHmm,
    d.Weddinghall_Name, d.Weddinghall_Address,
    d.Weddinghall_Location_LAT, d.Weddinghall_Location_LOT
FROM TB_Invitation_Detail d
JOIN TB_Invitation i ON d.Invitation_ID = i.Invitation_ID
WHERE i.Order_ID = {order_id}
```
