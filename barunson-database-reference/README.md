# 바른손(Barunson) 데이터베이스 참조 문서

## 개요

바른손(Barunson) 비즈니스 시스템의 데이터베이스 참조 문서입니다. 한국 웨딩 전자상거래 플랫폼으로, 디지털/모바일 청첩장과 실물 카드 상품을 취급합니다.

## 서버 정보

- **서버/포트**: `.env` 파일에서 로드 (CONNECTION.md 참조)
- **엔진**: Microsoft SQL Azure (RTM) - 12.0.2000.8
- **호스팅**: Azure SQL Database
- **인증**: `.env` 파일에서 자격증명 로드

## 데이터베이스 목록 (20개)

| 데이터베이스 | 상태 | 테이블 수 | 주요 용도 |
|------------|------|-----------|-----------|
| **barunson** | 활성 | 94 | 디지털 상품, MC 시리즈 모바일 청첩장 |
| **bar_shop1** | 활성 | 1,068 | 실물 카드 상품 (청첩장, 봉투, 스티커) |
| **XERP** | 활성 | 1,354 | 통합 ERP (제조/재무/인사) |
| **Dshuffle** | 비활성 (2011~) | 1,462 | 구 ERP 시스템 |
| **EagleSupport** | 유지 | 16 | 개발 지원 (코드 템플릿) |
| ACube, barunn, BarunnManagement, BHC, DEPLOY, distribution, GlobalB2B, KTRCS, MO_SVR, ProductPlan, WRB | - | - | 기타 (미문서화) |

## 시스템 진화

```
2005-2011: Dshuffle (구 ERP)
2001-현재: XERP (통합 ERP, 현재도 활성)
2010-현재: bar_shop1 (실물 상품)
2014-현재: barunson (디지털 상품)
```

## 문서 구조

```
database/
  README.md                  # 이 파일 (전체 개요)
  GUIDELINE.md               # AI/개발자를 위한 쿼리 작성 가이드라인
  CLAUDE.md                  # Claude Code 전용 지침
  CONNECTION.md              # 접속 정보 및 쿼리 스크립트 사용법
  SYSTEM_COMPARISON.md       # 데이터베이스 시스템 간 비교 분석
  barunson/
    SCHEMA.md                # barunson DB 스키마 (94 테이블)
    ERD.md                   # 엔티티 관계도
    INDEXES.md               # 인덱스 및 외래키 정보
    MC_SERIES.md             # MC 시리즈 상품 및 비즈니스 모델
    INVITATION_ATTRIBUTES.md # 초대장 98개 필드 상세
    ERP_TABLES.md            # 재무/통계 테이블 상세
  bar_shop1/
    SCHEMA.md                # bar_shop1 DB 스키마 (1,068 테이블)
    ERD.md                   # 엔티티 관계도
    S2_CARD_CATALOG.md       # S2_Card 상품 카탈로그 (50컬럼, 18브랜드)
    ORDER_SYSTEM.md          # 주문/배송 시스템
  xerp/
    SCHEMA.md                # XERP DB 개요 (1,354 테이블)
    INVENTORY.md             # XERP 재고/자재관리(MM) 모듈 상세
    SALES.md                 # XERP 판매 데이터(ERP_SalesData) 상세
    ACCOUNTING.md            # XERP 회계(GL) 모듈 상세
    BILLING.md               # XERP 매출/매입(RP) 모듈 상세
  dshuffle/
    SCHEMA.md                # Dshuffle DB 개요 (1,462 테이블, 비활성)
  eaglesupport/
    SCHEMA.md                # EagleSupport DB 개요 (16 테이블)
  analysis/
    BUSINESS_ANALYSIS.md     # MC 시리즈 비즈니스 분석 (매출/전환율)
    DEVICE_ANALYSIS.md       # 디바이스 사용 패턴 분석
  queries/
    COMMON_QUERIES.md        # 자주 사용하는 SQL 쿼리 모음
```

## 핵심 비즈니스 정보

### 데이터베이스 분리 원칙
- **barunson**: 디지털 상품, MC 시리즈 (세트당 ~30,000원)
- **bar_shop1**: 실물 상품, BC/BH 시리즈 (개당 ~950-1,500원)
- **관계**: MC 상품은 종종 BC 상품을 번들로 포함

### 명명 규칙
- **barunson**: `TB_` 접두어 (예: TB_Order, TB_Product)
- **bar_shop1**: 혼합 접두어 (S2_, S4_, custom_, DELIVERY_)
- **스키마**: 모든 테이블 `dbo` 스키마

### 제품 코드 패턴
| 시리즈 | DB | 브랜드 | 예시 | 가격대 |
|--------|-----|--------|------|--------|
| MC | barunson | 모바일카드 | MC4114 | ~30,000원 |
| BC | bar_shop1 | 바른손카드 | BC4914 | ~950원 |
| BH | bar_shop1 | 비핸즈 | BH9221 | ~1,200원 |
| TC | bar_shop1 | 더카드 | TC시리즈 | ~864원 |
| DDC_ | bar_shop1 | 디어디어 | DDC_BC5995 | ~1,000원 |
| WC | bar_shop1 | W카드 | WC시리즈 | ~776원 |
| BE | bar_shop1 | 봉투 | BE004 | - |
| BSI | bar_shop1 | 스티커 | BSI080 | - |
| FST | bar_shop1 | 식권/부속 | FST43_C | - |

## Python 환경 설정

이 프로젝트의 쿼리 스크립트(`python/query.py`, `python/db-query-bar_shop1.py` 등)를 사용하려면 Python과 `pymssql` 패키지가 필요합니다.

### Python 설치

- **macOS**: `brew install python3`
- **Ubuntu/Debian**: `sudo apt-get install python3 python3-pip`
- **Windows**: [python.org](https://www.python.org/downloads/)에서 다운로드

### pymssql 설치

```bash
pip install pymssql
```

> macOS에서 설치 오류 발생 시 FreeTDS가 필요할 수 있습니다:
> ```bash
> brew install freetds
> pip install pymssql
> ```

### 설치 확인

```bash
python3 -c "import pymssql; print(pymssql.__version__)"
```

## sqlcmd 설치 방법

이 시스템의 MSSQL 서버에 쿼리하려면 `sqlcmd`가 필요합니다.

### macOS

```bash
# Homebrew 사용
brew install sqlcmd
```

### Ubuntu / Debian

```bash
# Microsoft 패키지 저장소 추가
curl -sSL https://packages.microsoft.com/keys/microsoft.asc | sudo tee /etc/apt/trusted.gpg.d/microsoft.asc
sudo add-apt-repository "$(wget -qO- https://packages.microsoft.com/config/ubuntu/$(lsb_release -rs)/prod.list)"

# 설치
sudo apt-get update
sudo apt-get install -y sqlcmd
```

### RHEL / Fedora

```bash
# Microsoft 패키지 저장소 추가
curl -sSL https://packages.microsoft.com/config/rhel/9/prod.repo | sudo tee /etc/yum.repos.d/mssql-release.repo

# 설치
sudo yum install -y sqlcmd
```

### Windows

```powershell
# winget 사용
winget install sqlcmd

# 또는 chocolatey 사용
choco install sqlcmd
```

### Docker

```bash
# mcr.microsoft.com/mssql-tools 이미지 사용
docker run -it mcr.microsoft.com/mssql-tools sqlcmd -S <server> -U <user> -P <password>
```

### 설치 확인

```bash
sqlcmd --version
```
