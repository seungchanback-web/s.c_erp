# ERP 리팩토링 — 관리자 공유 문서

> **날짜**: 2026-05-09
> **브랜치**: `refactor/module-split`
> **작업자**: 박영환
> **상태**: 모듈 추출 완료 → 관리자 검토/승인 대기

---

## 요약: 뭘 했는가

`serve_inv2.js` (22,170줄)에서 **15개 라우트 모듈**을 `routes/` 폴더로 분리 추출했습니다.

- 기존 동작은 **100% 보존** (API 경로, 응답 형식, 비즈니스 로직 변경 없음)
- 기존 4개 모듈(`barcode.js`, `journal-auto.js`, `report-engine.js`, `vat-report.js`)과 동일한 패턴 사용
- **아직 serve_inv2.js 원본은 수정하지 않았습니다** — 관리자 확인 후 진행

---

## 왜 하는가

| 문제 | 현재 | 분리 후 |
|------|------|---------|
| 동시 수정 시 머지 충돌 | 거의 100% | 도메인 별로 독립 파일 → 충돌 최소화 |
| 한 곳 수정이 다른 API에 영향 | 전역 변수 공유 | 모듈별 스코프 격리 |
| 디버깅 | 22,170줄에서 원인 탐색 | 해당 모듈 파일만 확인 |
| 신규 연동 추가 (WMS) | 22,170줄에 끼워넣기 위험 | 별도 모듈 파일로 안전하게 추가 |

---

## 분리된 모듈 목록

```
routes/
├── _router.js          ← 기존 (변경 없음)
├── _ctx.js             ← 기존 (변경 없음)
├── auth.js             ← 인증/사용자/권한 (18 routes) [신규]
├── admin.js            ← 감사로그/디버그/알림 (24 routes) [신규]
├── vendors.js          ← 거래처 관리 (7 routes) [신규]
├── china.js            ← 중국 구매/단가/선적 (13 routes) [신규]
├── products.js         ← 품목관리/자료함 (23 routes) [신규]
├── inventory.js        ← 재고/XERP동기화 (15 routes) [신규]
├── auto-order.js       ← 자동발주 (9 routes) [신규]
├── po.js               ← 발주/구매/입고 (38 routes) [신규]
├── vendor-portal.js    ← 벤더포털 (18 routes) [신규]
├── accounting.js       ← 회계/정산/세금 (44 routes) [신규]
├── post-process.js     ← 후공정/거래명세서 (19 routes) [신규]
├── sales.js            ← 매출/주문/DD (41 routes) [신규]
├── bom-mrp.js          ← BOM/MRP/생산계획 (20 routes) [신규]
├── reports.js          ← 통계/대시보드/예산 (35+ routes) [신규]
├── manufacturing.js    ← 생산/품질/창고/공정 (50+ routes) [신규]
├── barcode.js          ← 바코드 (기존)
├── journal-auto.js     ← 자동분개 (기존)
├── report-engine.js    ← 리포트엔진 (기존)
└── vat-report.js       ← 부가세 (기존)
```

---

## 관리자에게 요청하는 사항

### 필수 확인 (진행 전 합의 필요)

- [ ] **`serve_inv2.js` 수정 동결** — 통합 작업 기간(2~3일) 동안 본체 수정을 멈춰주세요. 동시에 수정하면 충돌이 발생합니다.
- [ ] **브랜치 확인** — `refactor/module-split` 브랜치에서 코드를 확인해주세요.
- [ ] **코드 리뷰** — 특히 `po.js`, `accounting.js`, `sales.js` (대형 모듈)의 로직이 원본과 동일한지 확인 부탁드립니다.

### 확인 후 진행할 작업

1. `serve_inv2.js`에서 분리된 라우트 코드 제거 (22,170줄 → ~300줄)
2. ctx 초기화 블록에 모듈이 필요한 속성 주입 코드 추가
3. `moduleRouters` 배열에 15개 모듈 등록
4. 서버 시작 → 전체 API 동작 검증
5. main 브랜치에 PR 머지

---

## 변경하지 않은 것 (안심하세요)

- API 경로 (URL) — 변경 없음
- API 응답 형식 — 변경 없음
- DB 스키마 — 변경 없음
- 비즈니스 로직 — 변경 없음
- 인증/권한 — 변경 없음
- 기존 4개 라우트 모듈 — 변경 없음
- `_router.js`, `_ctx.js` — 변경 없음
- Docker/배포 설정 — 변경 없음

---

## 검증 방법

통합 완료 후 아래 명령으로 검증할 수 있습니다:

```bash
# 서버 시작
npm start

# 헬스체크
curl http://localhost:12026/health

# 로그인 테스트
curl -X POST http://localhost:12026/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"test"}'

# 품목 조회
curl -H "Authorization: Bearer {token}" http://localhost:12026/api/products

# XERP 재고
curl -H "Authorization: Bearer {token}" http://localhost:12026/api/xerp-inventory
```

---

## 향후 계획

리팩토링 완료 후:

1. **WMS 연동 모듈** (`routes/wms-integration.js`) — 별도 파일로 추가, 기존 코드 영향 없음
2. **API 응답 형식 표준화** — 신규 API부터 점진적 적용
3. **데이터드리븐 설정 테이블** — 하드코딩된 값을 설정으로 이동

---

## 문의

질문이나 우려사항 있으시면 언제든 연락주세요.
작업 내용 상세는 `docs/ERP_REFACTORING_PRD.md`에 있습니다.
