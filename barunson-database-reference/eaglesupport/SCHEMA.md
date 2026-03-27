# EagleSupport 데이터베이스 스키마

## 개요

- **상태**: 유지 (2004년~)
- **테이블 수**: 16개 (활성 14, 미사용 6, 일부 중복)
- **총 레코드**: 71,321건
- **용도**: 개발 지원 시스템 (코드 템플릿 관리)

## 테이블 현황

### 활성 테이블

| 테이블명 | 레코드 | 설명 |
|---------|--------|------|
| Template | 81 | 템플릿 마스터 (TplCode PK) |
| TemplateContents | 813 | 템플릿 코드 조각 |
| TemplateContentsLang | 804 | 다국어 템플릿 내용 |
| TemplateLang | 157 | 템플릿 다국어 메타 |
| DevMaster | 3 | 개발자 정보 |
| ScriptInformation | 1 | 스크립트 버전 (v1.7) |

### 기타 테이블

| 테이블명 | 레코드 | 설명 |
|---------|--------|------|
| ResUpdate | 34,747 | 리소스 업데이트 |
| ResX_JpnDD | 33,718 | 일본어 리소스 |
| realjpn | 997 | 일본어 데이터 |
| Notification | 0 | 알림 |

### 미사용 테이블

ProgramObj, ProgramObjLang, ProgField, ProgFieldLang, ProgramRelation, dtproperties

## 관계도

```
Template (1) → (N) TemplateContents → (N) TemplateContentsLang
Template (1) → (N) TemplateLang
DevMaster (1) → (N) Template (InsDevCode)
```

## 템플릿 분류

| 접두어 | 의미 | 수량 |
|--------|------|------|
| [F] | 웹폼 | 33 |
| [S] | 웹서비스 | 20 |
| [J] | JavaScript | 4 |
| (없음) | 공통/기타 | 24 |

## 등록 개발자

| 코드 | 이름 | 권한 |
|------|------|------|
| admin | 바른손 | 관리자 |
| CLoud | 박창용 | 관리자 |
| wood | 정한섭 | 일반 |
