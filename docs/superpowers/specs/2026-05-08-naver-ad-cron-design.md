# 네이버 광고 — 자동 동기화 cron (08:00 KST 당월)

작성일: 2026-05-08
대상: `server/sync-ad.js` (신규), cafe24 서버 crontab
선행: `2026-05-08-naver-ad-trend-chart-design.md` (Phase 2b — 트렌드 차트, 직전 phase)

## 배경

광고 데이터는 D-1 한도라 매일 자동으로 한 번만 수동 동기화하면 충분 (사용자 피드백). 기존 SmartStore 자동 동기화 (`server/sync.js`)가 매일 08:00 cafe24 서버 cron으로 작동 중. 같은 패턴으로 네이버 광고 자동 동기화 추가.

## 단계 분리

이번 phase는 단일 task. spec/plan 가벼움.

## 구현

### 새 파일: `server/sync-ad.js`

기존 `api/naver-ad.js`의 핵심 로직을 cafe24 서버 환경(Node.js, 60초 timeout 없음)으로 옮김:
- HMAC 서명 (`signHmac`)
- `naverAdGet` (fetch + signature)
- `parallelLimit`, `chunkIds` 헬퍼
- 캠페인 동기화 (Phase 1 일별 + Phase 2 캠페인별 row)
- 키워드 동기화 (Phase 2a 일별 row + Phase 2b 트렌드 데이터 source)
- 활성 캠페인/광고그룹/키워드 사전 필터 (네트워크 호출 80% 절감)

직접 Supabase REST API 호출 (server/sync.js의 `supabaseQuery` 패턴). frontend 의존성 없음.

### 동기화 흐름

1. 시작 로그: 시각, mode (default = 당월)
2. 브랜드 목록 fetch (`getBrands`) + BRAND_ALIAS 매칭으로 자격증명 있는 브랜드만 필터
3. 각 브랜드별:
   a. **캠페인 동기화** (= action=stats 로직)
      - `/ncc/campaigns` 가져옴
      - per-day `/stats` 호출 (campaign 합산)
      - 일별 row + 캠페인별 row를 naver_ad_stats 테이블에 upsert
   b. **키워드 동기화** (= action=keywords 로직)
      - 활성 캠페인 식별
      - 활성 광고그룹 fetch + 식별
      - 활성 키워드 fetch
      - 활성 키워드 사전 필터 (cost > 0인 것만)
      - per-day × chunk 키워드 stats
      - truncate-and-insert로 naver_ad_keyword_stats에 저장
4. 종료 로그: 처리한 row 수, 소요 시간

### 환경변수 (cafe24 서버 `.env`)

기존 `.env`에 추가:
```
PALEO_NAVERAD_CUSTOMER_ID=...
PALEO_NAVERAD_ACCESS_LICENSE=...
PALEO_NAVERAD_SECRET_KEY=...
```

값은 Vercel 환경변수와 동일.

### 날짜 범위 — 당월

```js
function thisMonthRange() {
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000); // KST
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth() + 1;
  const yest = new Date(Date.now() + 9 * 60 * 60 * 1000 - 86400000).toISOString().slice(0, 10);
  const firstDay = `${y}-${String(m).padStart(2, '0')}-01`;
  return { start: firstDay, end: yest };
}
```

월초(1일)에 실행되면 start=end=어제 (= 지난달 말일)일 수 있음 — 이 케이스는 정상 동작 (1일자 동기화).

### Crontab

cafe24 서버 crontab에 추가:
```
0 8 * * * cd /home/USER/order-manager-server && node sync-ad.js >> sync-ad.log 2>&1
```

기존 SmartStore cron entry와 동일 시각, 별도 line.

## 영향 범위

| 파일 | 변경 |
|------|------|
| `server/sync-ad.js` | 신규 (~300~400 lines) |
| 사용자 작업 | cafe24 .env에 NAVERAD_* 3개 추가, git pull, crontab entry 추가 |

## 비목표

- 다른 브랜드 (PALEO 외) — 자격증명 추가 시 자동 포함 (BRAND_ALIAS 확장)
- Slack/이메일 알림 — cron stderr + 로그파일로 충분
- 재시도 로직 — fail-fast + 다음 날 재시도
- 백필 (과거 누락 일자) — 수동 모달 sync로 충분

## 검증 기준

- [ ] `server/sync-ad.js` 신규 파일 생성, syntax 정상
- [ ] 로컬에서 `node server/sync-ad.js` 실행 가능 (단, .env 필요)
- [ ] 환경변수 미설정 시 명확한 에러 + exit
- [ ] 서버 .env에 NAVERAD_* 추가
- [ ] 서버에서 manual 실행 → 일별 표 + 캠페인별 표 + 키워드별 표 모두 데이터 채워짐
- [ ] crontab entry 추가 후 다음날 08:00에 자동 실행 확인 (`tail -f sync-ad.log`)
- [ ] 로그에 "✅" 또는 처리한 row 수 표시
- [ ] 실패 시 stderr 로그 + non-zero exit code

## 리스크와 대응

**1. 코드 중복 (api/naver-ad.js와)**
- 의도적 trade-off: 단순함 우선
- 향후 공유 모듈(`lib/naver-ad-core.js`)로 리팩터 가능 (이번엔 비목표)

**2. 동기화 시간**
- 캠페인 ~21초 + 키워드 ~30~50초 = ~50~70초
- cafe24 서버는 timeout 없음 (Vercel과 다름) → 안전

**3. 월초 실행 시 빈 결과**
- 1일 08:00 실행 → start=end=지난달 말일 → 어제 데이터 1일치 동기화 (정상)
- 또는 start > end 케이스 방어: start > end면 swap 또는 skip

**4. Naver API 일시 장애**
- fail-fast로 종료 (이번 phase). 다음날 08:00 재실행으로 자동 복구.

**5. 환경변수 미설정 — 모든 브랜드 skip**
- 명시적 warning 로그 + exit 0 (cron 알림 없음). 사용자가 첫 day 로그 확인 필요.
