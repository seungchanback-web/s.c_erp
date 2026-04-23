# 2026-04-23 DD(디얼디어) 재고 동기화 미작동 — 진단 보고서

**발생일**: 2026-04-23
**영향**: 재고현황에서 법인 필터 "디디" 선택 시 모든 품목의 가용재고가 **0** 으로 표시됨. 월출고는 일부 표시되지만 현재고 열은 비어있음.

---

## 1. 증상

1. 재고현황 → 법인="디디" 선택 → 표에 DDC_xxxx / DD_xxxx 품목들이 나오지만 가용재고 컬럼이 전부 0
2. 월출고 컬럼에는 숫자가 보이는 경우가 있음 (일부 품목)
3. 창고 드롭다운에 DD 쪽 창고(`DF01` 등) 가 안 나타남 (warehouses_json 이 비어있어서)
4. DB 동기화 버튼 누르면 정상적으로 완료 메시지 뜨지만 DD 데이터는 여전히 0

---

## 2. 원인 — 2가지 독립 이슈가 겹침

### 원인 A: 운영서버 `.env` 의 DB 계정이 BHC DB 접근 권한 없음

진단 엔드포인트 `/api/debug/bhc-diag` 결과:

```json
{
  "ok": false,
  "error": "BHC 연결 실패 — 모든 credential 실패",
  "attempts": [
    {"name": "barShopConfig (DB_USER)",      "result": "fail",
     "error": "Login failed for user 'readonly_user'."},
    {"name": "xerpConfig (XERP_DB_USER)",    "result": "fail",
     "error": "Login failed for user 'readonly_erp'."}
  ]
}
```

운영서버 `.env` 에 설정된 두 계정 모두 BHC 데이터베이스에 접근 불가:
- `readonly_user` → barunson, bar_shop1 만 가능 (BHC 권한 없음)
- `readonly_erp` → XERP 만 가능 (BHC 권한 없음)

**대조**: 유저 로컬 PC 의 `.env` 계정은 BHC 접근 가능함 (로컬에서 직접 쿼리로 확인):

```bash
$ python python/query.py "SELECT TOP 5 RTRIM(SiteCode), RTRIM(WhCode), RTRIM(ItemCode), OhQty FROM BHC.dbo.mmInventory WITH (NOLOCK) WHERE OhQty > 0"
site  wh    code       OhQty
BHC2  DF01  DDC4206    14991
BHC2  DF01  DDC5226    15082
BHC2  DF01  DDE007M    15199
BHC2  DF01  DDC5225    15652
BHC2  DF01  DDC5220_1  15950
```

→ **운영 `.env` 의 `DB_USER`/`DB_PASSWORD` 를 로컬과 동일한 계정으로 교체 필요**

### 원인 B: 로컬 products 와 BHC.mmInventory 의 품목코드 포맷 불일치

로컬 쿼리로 확인:

| 로컬 products.product_code | BHC.mmInventory.ItemCode | 매칭 결과 |
|---|---|---|
| `DDC_5209` | `DDC5209` (존재) | ❌ 언더스코어 차이로 불일치 |
| `DDC_3227` | `DDC3227` (존재) | ❌ 동일 문제 |
| `DD_FST85` | `DD_FST85` (존재) | ✅ 일치 |

**규칙**: `DDC_<숫자>` 포맷은 BHC 에서 `DDC<숫자>` 로 저장됨 (DDC 바로 뒤 언더스코어만 없음). `DD_<알파벳>` 포맷은 양쪽 동일.

→ **매칭 로직에 `DDC_<digit>` → `DDC<digit>` 정규화 필요** (`fetchCompanyInventory` 내부)

---

## 3. 해결 방안

### A. 운영서버 `.env` 수정 — 담당: 사용자

배포 플랫폼(`docker-manager.barunsoncard.com`) 에서 `s-c-erp` 컨테이너의 환경변수 수정:

```env
DB_USER=<로컬과 동일한 BHC 접근 가능 계정>
DB_PASSWORD=<해당 비번>
```

적용 후 컨테이너 재시작.

**참고**: 기존 `XERP_DB_USER=readonly_erp` 는 XERP 전용으로 유지 가능. `DB_USER` 만 "전체 접근 가능한 계정" 으로 바꾸면 바른손/bar_shop1/BHC 모두 커버됨.

### B. 코드 — 담당: 완료 (PR #6 대기)

`serve_inv2.js::fetchCompanyInventory` 의 validCodeSet 빌드 로직에 DD 모드 분기 추가:

```js
const validCodeSet = new Set();
const bhcToLocal = {}; // DD 전용: BHC 포맷 → 로컬 포맷 역매핑
for (const pc of productCodes) {
  if (!/^[A-Za-z0-9_\-]+$/.test(pc)) continue;
  const upper = pc.toUpperCase();
  validCodeSet.add(upper);
  bhcToLocal[upper] = upper;
  if (isDd) {
    const bhcForm = upper.replace(/^DDC_(\d)/, 'DDC$1');
    if (bhcForm !== upper) {
      validCodeSet.add(bhcForm);
      bhcToLocal[bhcForm] = upper;
    }
  }
}
```

mmInventory / mmInoutItem 결과 순회 시 `bhcToLocal[code]` 로 로컬 코드 복원 후 저장.

**PR**: https://github.com/seungchanback-web/s.c_erp/pull/6 (커밋 `44072b9`)

### C. 두 해결 모두 적용돼야 실제로 DD 재고가 뜸

| 상태 | A 미적용 | A 적용 |
|---|---|---|
| **B 미적용 (현재)** | BHC 연결 실패, 데이터 0 | BHC 연결 OK 지만 포맷 불일치로 매칭 0 — 여전히 재고 0 |
| **B 적용 (PR #6 머지 후)** | BHC 연결 실패 — 여전히 재고 0 | **✅ DD 재고 정상 표시** |

---

## 4. 검증 절차 (A + B 적용 후)

### 4-1. 진단 엔드포인트 확인

```
GET /c/s-c-erp/api/debug/bhc-diag
```

예상 응답(정상):
```json
{
  "ok": true,
  "bhc_connection": "ok",
  "used_config": "barShopConfig (DB_USER)" (또는 xerpConfig),
  "mmInventory_sitecodes": [
    { "site_code": "BHC2", "row_count": 1500+, ... }
  ],
  "mmInventory_warehouses": [
    { "site_code": "BHC2", "wh_code": "DF01", "item_count": ..., "total_qty": ... }
  ],
  "dd_match_check": {
    "DDC_5209": { "exact_count": 1 or more, ... }
  }
}
```

### 4-2. DB 동기화

1. 재고현황 페이지에서 **"DB 동기화"** 버튼 클릭
2. 완료 대기 (2~5분)
3. 서버 로그에 아래 메시지 확인:
   ```
   [xerp-inv dd] 현재고 단일쿼리 성공: N개 품목 매칭, 창고-품목 조합 ... 건
   ```
   N 이 0 이 아니면 성공.

### 4-3. UI 확인

1. 재고현황 페이지 강제 새로고침 (Ctrl+Shift+R)
2. 법인 필터 "디디" 선택
3. 가용재고 컬럼에 수치 표시됨
4. 창고 드롭다운에 `DF01` (또는 BHC 다른 창고) 옵션 추가됨

---

## 5. 미해결/확인 필요 항목

- [ ] **DD 창고 기본값** — 바른손은 MF01(파주물류센터 제품) 이 기본. DD 는 `DF01` 이 동일 역할인지 확인 필요. 맞으면 창고 드롭다운 기본 선택 로직도 DD 시엔 `DF01` 로 분기할지 결정.
- [ ] **DD_FST85 실제 재고** — 로컬 쿼리 결과 `DD_FST85` 가 `0E-8` (사실상 0)로 나옴. 유효 재고가 없는 상태일 수 있음. 정상 시나리오인지 업무상 확인 필요.
- [ ] **로컬 `.env` 와 운영 `.env` 의 계정 차이가 언제부터 발생했는지** — 기록 없음. 초기 배포 시부터 이런 상태였는지, 중간에 바뀐 건지 확인 필요 (근본 원인 파악용).

---

## 6. 부수 이슈 (이 이슈와 별개, 참고)

- `/api/latest` 가 401 반환 (재고랑 무관, 별개 인증 이슈)
- `xlsx.full.min.js` 가 853ms 블로킹 로드 → 엑셀 다운로드 lazy-load 로 개선 가능
- 재고현황 초기 로드 Load 이벤트 1.19s — 체감 느림 호소 있음. 정확한 병목 지점 측정 필요 (`/api/xerp-inventory` 단일 요청 Time 값 확인 필요)

---

## 7. 관련 PR 히스토리

이번 세션에서 DD 재고 이슈 진단/수정 과정 중 머지된 PR 들:

| PR | 커밋 | 내용 | 상태 |
|---|---|---|---|
| [#2](https://github.com/seungchanback-web/s.c_erp/pull/2) | `54f459d` | 재고/발주 통합 개선 묶음 (동기화 가속, 창고별 재고, 규격, 소진후단종 등 11커밋) | ✅ 머지 |
| [#3](https://github.com/seungchanback-web/s.c_erp/pull/3) | `13a76b6` | 창고 드롭다운 기본값 MF01 | ✅ 머지 |
| [#4](https://github.com/seungchanback-web/s.c_erp/pull/4) | `7051312` | `/api/debug/bhc-diag` 엔드포인트 추가 | ✅ 머지 |
| [#5](https://github.com/seungchanback-web/s.c_erp/pull/5) | `a475eaa` | bhc-diag 가 여러 credential 시도 | ✅ 머지 |
| [#6](https://github.com/seungchanback-web/s.c_erp/pull/6) | `44072b9` | DD 품목코드 DDC_ 포맷 정규화 | ⏳ 대기 |

---

## 8. 디버그 룰 준수 메모

본 문서 작성 시 [디버깅 룰](본문 외)에 따름:
- 추측 배제 — 확인된 사실(진단 엔드포인트 응답, 로컬 쿼리 결과)만 기재
- "고쳤다" 표현은 실제 테스트 통과 후에만 사용 — PR #6 은 "대기" 로 표시
- 코드 수정안은 diff 형식으로 근거 제시
- 확신 못 한 항목은 §5 에 "확인 필요" 로 별도 섹션
