# 데이터베이스 접속 정보

## 서버 정보

- **서버/포트**: `.env` 파일의 `DB_SERVER`, `DB_PORT` 참조
- **엔진**: Microsoft SQL Azure (RTM) - 12.0.2000.8
- **에디션**: SQL Azure
- **호스팅**: Azure SQL Database
- **인증**: SQL Server 인증 (`.env` 파일에서 자격증명 로드)
- **로그인 사용자**: `.env`의 `DB_USER` 참조 (스키마: dbo)

## 접속 방법

### Python 스크립트 (권장)

프로젝트 루트에서 `python/` 디렉토리의 스크립트 사용:

```bash
# barunson DB 쿼리
python3 python/query.py "SELECT COUNT(*) FROM TB_Order"

# bar_shop1 DB 쿼리
python3 python/db-query-bar_shop1.py "SELECT COUNT(*) FROM S2_Card"

# 파이프 입력
echo "SELECT name FROM sys.tables" | python3 python/query.py
```

### sqlcmd 직접 접속

```bash
# .env에서 환경변수 로드 후 사용
# barunson
sqlcmd -S $DB_SERVER,$DB_PORT -U $DB_USER -P "$DB_PASSWORD" -d barunson -C

# bar_shop1
sqlcmd -S $DB_SERVER,$DB_PORT -U $DB_USER -P "$DB_PASSWORD" -d bar_shop1 -C

# XERP
sqlcmd -S $DB_SERVER,$DB_PORT -U $DB_USER -P "$DB_PASSWORD" -d XERP -C
```

### 연결 문자열

```
# .NET / C# (.env 값 사용)
Server={DB_SERVER},{DB_PORT};Database=barunson;User Id={DB_USER};Password={DB_PASSWORD};TrustServerCertificate=True;

# Python (pymssql) - .env에서 로드
server = os.getenv('DB_SERVER')
port = int(os.getenv('DB_PORT'))
database = 'barunson'  # 또는 bar_shop1, XERP, Dshuffle
user = os.getenv('DB_USER')
password = os.getenv('DB_PASSWORD')
```

### DD (wedding) DB 쿼리 - MySQL

```bash
# DD wedding DB 쿼리 (.env-all에서 접속 정보 로드)
python3 python/db-query-dd.py "SELECT COUNT(*) FROM orders"

# mysql 직접 접속
mysql -h $DD_DB_SERVER -P $DD_DB_PORT -u $DD_DB_USER -p"$DD_DB_PASSWORD" wedding
```

### Python 의존성

```
pymssql
pymysql
python-dotenv
```

## .env 파일 형식

`.env` 파일은 이 프로젝트 루트에 위치합니다 (MSSQL 서버용).

```env
DB_SERVER=<서버주소>
DB_PORT=<포트>
DB_USER=<사용자명>
DB_PASSWORD=<비밀번호>
DB_NAME=barunson
```

`.env-all` 파일에 MSSQL + DD(MySQL) 접속 정보가 통합되어 있습니다.

```env
# MSSQL (barunson/bar_shop1)
DB_SERVER=<서버주소>
DB_PORT=1433
DB_USER=<사용자명>
DB_PASSWORD=<비밀번호>

# XERP (MSSQL, 별도 계정)
XERP_DB_SERVER=<서버주소>
XERP_DB_PORT=1433
XERP_DB_USER=<사용자명>
XERP_DB_PASSWORD=<비밀번호>

# DD wedding (MySQL)
DD_DB_SERVER=<서버주소>
DD_DB_PORT=3306
DD_DB_USER=<사용자명>
DD_DB_PASSWORD=<비밀번호>
```

> **주의**: `.env`, `.env-all` 파일은 Git에 커밋하지 않습니다. `.gitignore`에 포함되어 있습니다.

## 사용 가능한 데이터베이스 (20개)

ACube, bar_shop1, barunn, BarunnManagement, barunson, BHC, DEPLOY, distribution, Dshuffle, EagleSupport, GlobalB2B, KTRCS, master, MO_SVR, model, msdb, ProductPlan, tempdb, WRB, XERP

## 쿼리 타임아웃 주의사항

- 기본 타임아웃: 30초
- 대용량 테이블 조회 시 `-t 120` 옵션 추가 권장
- XERP의 `ERP_SalesData.reg_date`로 쿼리 시 타임아웃 빈번 → `h_date` 필드 사용
- 읽기 전용 쿼리에 `WITH (NOLOCK)` 힌트 사용 가능
