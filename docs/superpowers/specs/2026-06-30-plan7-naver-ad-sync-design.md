# Plan 7 — 네이버 검색광고 sync 구현 디자인 문서

> 가상서버 sync-worker의 `naverAdAdapter` stub을 실 구현으로 교체. 메서드 `syncAdStats` (atomic: 내부에서 ad_units 메타 + ad_stats 통계를 한 번에) + `syncAdUnits` (manual 백필용). 기존 `order-manager/api/naver-ad.js` 패턴을 SaaS 정규화 스키마(`ad_units` + `ad_stats`)에 맞게 변환.

## 1. 목표 & 범위

- **목표**: 네이버 검색광고 D-1 데이터를 매일 1회 자동 수집. 캠페인 + 키워드 두 레벨의 메타데이터 + 일별 통계.
- **범위 (In)**:
  - 가상서버 `server/sync-worker/lib/adapters.js`의 `naverAdAdapter`에 `syncAdStats` + `syncAdUnits` 메서드 실 구현
  - HMAC-SHA256 서명 helper 추가
  - SaaS `lib/adapters/naver-ad.ts`에 두 메서드 시그니처(throw stub) 추가
  - Vercel side는 변경 없음 (어댑터 인터페이스 충족만)
- **범위 (Out)**:
  - 광고 분석 뷰/대시보드 UI (별도 후속 Plan)
  - ad_group 레벨 ad_units 행 (스키마는 지원하지만 sync 안 함)
  - 자동 백필 (D-7 등) — manual `dateRangeStart`/`End` 지정으로 처리

## 2. 핵심 결정사항 (확정)

| 항목 | 값 | 근거 |
|---|---|---|
| sync 범위 default | `from=to=yesterdayKST` (D-1 1일치) | 사용자 메모리 "동기화 시간보다 분석 뷰 풍부함 우선". 누락은 manual 백필. |
| ad_units 레벨 | campaign + keyword (ad_group skip) | 기존 order-manager 동일. 분석 단위 중심. |
| keyword 필터 | cost > 0 사전필터 (기간 합산 기준) | 활성 캠페인 → 활성 그룹 → 활성 키워드 3단 필터. API 호출 수 절감. |
| campaign 통계 필터 | 전부 저장 (cost=0도 ad_stats 행 생성) | 캠페인 수 작아서 cost=0이어도 OK. 추후 분석 시 0 vs 데이터 구분 명확. |
| atomic 동기화 | syncAdStats가 단일 잡 안에서 ad_units + ad_stats 모두 처리 | 순서 보장. ad_stats의 ad_unit_id FK 사전 채움. |
| cron | 매일 08:00 KST `enqueue_naver_ad_stats` | 네이버 D-1 데이터 안정 시각. 기존 운영 시각 동일. |
| API base | `https://api.searchad.naver.com` | |
| 서명 | `signature = base64(hmacSHA256(secretKey, "${timestamp}.${method}.${uriPath}"))` | uri는 path만 (query string 제외) |
| 헤더 | `X-Timestamp, X-API-KEY (=accessLicense), X-Customer (=customerId), X-Signature, Content-Type: application/json` | |
| 응답 매핑 | impCnt→impressions, clkCnt→clicks, salesAmt→cost, ccnt→conversions, convAmt→conversion_revenue | 기존과 동일 |
| 페이지네이션 | /stats는 ids[]를 100개씩 chunk. sync-worker는 sequential (병렬 X — sync-worker는 worker 1대라 폭주 방지) | Vercel과 달리 60초 timeout 없음 |
| ad_units key | `external_id` (campaign: nccCampaignId, keyword: nccKeywordId) | UNIQUE(brand_id, channel, external_id) |
| ad_units parent_id | campaign: null. keyword: 같은 brand의 campaign saved UUID | adgroup skip이므로 keyword → campaign 직접 매핑 (keyword의 adgroup의 campaign_id로 lookup) |
| ad_units metadata | campaign: `{type: campaignTp, channel_account: <alias>}`. keyword: `{ad_group_id, ad_group_name, channel_account}` | jsonb |
| ad_stats UNIQUE | `(ad_unit_id, date)` | conflict 시 upsert로 갱신 |
| ad_stats 누락 처리 | ad_units에 없는 external_id의 stats는 skip + log (응답에 meta.skipped_count) | FK violation 방지 |

## 3. 컴포넌트 & 인터페이스

### 3.1 가상서버 `lib/adapters.js` — 추가 모듈 스코프

```javascript
const crypto = require('crypto')

function signNaverAd(secretKey, method, uriPath, timestamp) {
  const message = `${timestamp}.${method}.${uriPath}`
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64')
}

async function naverAdGet(uriPath, query, creds) {
  // uriPath는 쿼리스트링 없는 path. query는 객체 → URLSearchParams 변환
  const timestamp = Date.now().toString()
  const signature = signNaverAd(creds.secretKey, 'GET', uriPath, timestamp)
  const qs = query ? '?' + new URLSearchParams(query).toString() : ''
  const url = `https://api.searchad.naver.com${uriPath}${qs}`
  return httpsRequest(url, {
    method: 'GET',
    headers: {
      'X-Timestamp': timestamp,
      'X-API-KEY': creds.accessLicense,
      'X-Customer': creds.customerId,
      'X-Signature': signature,
      'Content-Type': 'application/json',
    },
  })
}

function chunkArray(arr, size) {
  const out = []
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size))
  return out
}
```

### 3.2 `naverAdAdapter.syncAdStats(creds, ctx)`

```
입력:
  creds: { customerId, accessLicense, secretKey }
  ctx: { brandId, channelAccount, dateRangeStart?, dateRangeEnd? }

흐름:
  1. 날짜 범위 결정:
     - default: `day = yesterdayKST()` (1일치)
     - ctx.dateRangeStart 있으면: `start = ctx.dateRangeStart`, `end = ctx.dateRangeEnd || ctx.dateRangeStart`
     - days[] = start~end (inclusive) 일별 배열. 일별 loop 진행 (manual 백필용)
  2. GET /ncc/campaigns → campaignList
     - 응답이 배열 아니거나 빈 배열이면 ok:true, rowsUpserted:0
  3. days 각각 일별 캠페인 stats: GET /stats?ids=<all_campaign_ids>&fields=["impCnt","clkCnt","salesAmt","ccnt","convAmt"]&timeRange={since:day,until:day}&datePreset=custom
     → campaignStatsByDay[day][id] = {impressions, clicks, cost, conversions, conversion_revenue}
     - 모든 day 합산 cost > 0인 캠페인 = activeCampaignIds (key 필터링용)
  4. activeCampaignIds 별로 GET /ncc/adgroups?nccCampaignId=<id> sequential
     → adgroupList[] (각 adgroup의 nccCampaignId 보존)
  5. adgroup ids 100개씩 chunk, /stats로 기간 합산 cost 조회 (timeRange: {since:start, until:end}) → cost > 0인 adgroup = activeAdgroupIds
  6. activeAdgroupIds 별로 GET /ncc/keywords?nccAdgroupId=<id> sequential
     → keywordList[] (각 keyword의 nccAdgroupId 보존)
  7. keyword ids 100개씩 chunk, /stats로 기간 합산 cost 조회 → cost > 0인 keyword = activeKeywordIds
  8. days × activeKeywordIds 100개 chunk, /stats로 일별 full stats (5종) sequential 조회
     → keywordStatsByDay[day][id] = {impressions, clicks, cost, conversions, conversion_revenue}
     - 일별 cost > 0만 ad_stats에 keep (일별 0인 행은 skip)
  9. ad_units upsert (campaign 행 + keyword 행)
     - campaign rows: { brand_id, channel: 'naver_ad', channel_account: ctx.channelAccount, external_id: nccCampaignId, external_name: name, level: 'campaign', parent_id: null, metadata: { type: campaignTp }, active: true }
     - keyword rows (parent_id 채우려면 campaign 먼저 upsert+select id 필요)
     - 2단계: 먼저 campaign upsert + SELECT id → campaignDbIdMap[nccCampaignId] = uuid
     - keyword rows: { brand_id, channel: 'naver_ad', channel_account: ctx.channelAccount, external_id: nccKeywordId, external_name: keyword, level: 'keyword', parent_id: campaignDbIdMap[adgroup.nccCampaignId], metadata: { ad_group_id, ad_group_name }, active: true }
  10. 후 keyword upsert + SELECT id → unitDbIdMap (combined)
  11. ad_stats upsert (days × units 행렬을 flatten)
      - campaign stats (전부, days × campaigns): { brand_id, ad_unit_id, date, impressions, clicks, cost, conversions, conversion_revenue, metadata: {} }
      - keyword stats (일별 cost > 0, days × active keywords): 위와 동일 구조
  12. 반환: { ok: true, rowsUpserted: <ad_stats 행 수>, meta: { ad_units_upserted, ad_stats_upserted, skipped_count } }

에러:
  - 401: { ok: false, error: 'naver_ad 인증 실패 (401)', retryable: true }
  - 4xx/5xx 단계별: 어느 단계에서 실패했는지 message에 포함, retryable: true
  - keyword_stats 실패율 30% 초과: { ok: false, error: '...실패율 과다...', retryable: true } — 부분 결과 저장 거부 (데이터 오염 방지)
  - 필수 ctx 누락: retryable: false
```

### 3.3 `naverAdAdapter.syncAdUnits(creds, ctx)`

```
입력: 동일 (date 무관)
흐름:
  1. GET /ncc/campaigns → campaignList
  2. 각 campaign 별로 GET /ncc/adgroups → adgroupList
  3. 각 adgroup 별로 GET /ncc/keywords → keywordList
  4. ad_units upsert (campaign + keyword) — 전체 (cost 필터 안 함, metadata 전체 갱신용)
  5. ad_stats 미터치
  6. 반환: { ok: true, rowsUpserted: <ad_units 행 수>, meta: { campaign_count, keyword_count } }

용도: 운영자 manual SQL Editor에서 job_type='ad_units' enqueue 시 사용. cron은 호출 안 함.
```

### 3.4 SaaS `lib/adapters/naver-ad.ts` — 추가

```typescript
async function syncAdStats(
  _creds: CredentialPayload,
  _ctx: SyncContext
): Promise<{ ok: false; error: string; retryable: boolean }> {
  throw new Error('syncAdStats must run on virtual server sync-worker (not Vercel)')
}

async function syncAdUnits(
  _creds: CredentialPayload,
  _ctx: SyncContext
): Promise<{ ok: false; error: string; retryable: boolean }> {
  throw new Error('syncAdUnits must run on virtual server sync-worker (not Vercel)')
}

export const naverAdAdapter: ChannelAdapter = {
  channel: 'naver_ad',
  category: 'ad',
  authType: 'api_key',
  credentialFields: [...],
  buildPayload,
  validate,
  syncAdStats,
  syncAdUnits,
}
```

## 4. 데이터 흐름

```
[pg_cron 08:00 KST]
  ↓ enqueue_naver_ad_stats (Plan 4 cron)
  ↓ INSERT INTO sync_jobs (channel='naver_ad', job_type='ad_stats', ...)
  ↓
[sync-worker poll (5s)]
  ↓ pick_pending_job → status='running'
  ↓ vault read (creds) → naverAdAdapter.syncAdStats(creds, ctx)
  ↓
naverAdAdapter.syncAdStats:
  1) GET /ncc/campaigns
  2) per-day campaign /stats (1 call)
  3) active campaign별 /ncc/adgroups (N calls, sequential)
  4) adgroup chunk /stats (N/100 calls)
  5) active adgroup별 /ncc/keywords (M calls, sequential)
  6) keyword chunk /stats — 기간 필터 (M_k/100 calls)
  7) active keyword chunk /stats — full (M_a/100 calls)
  8) campaign ad_units upsert+select
  9) keyword ad_units upsert+select (parent_id 채움)
  10) campaign + keyword ad_stats upsert (UNIQUE ad_unit_id, date)
  ↓
[markCompleted] result_summary = { rowsUpserted, meta: { ad_units_upserted, ad_stats_upserted, skipped_count } }
```

## 5. 에러 처리 매트릭스

| 에러 | 핸들링 | retryable |
|---|---|---|
| 401 from /ncc/* | retryable=true. 다음 polling에 재시도 | true |
| 4xx/5xx /stats 단일 호출 실패 | 즉시 ok:false, error에 단계 포함 | true |
| keyword_stats 실패율 > 30% | 즉시 ok:false ("실패율 과다") | true |
| /ncc/adgroups 또는 /ncc/keywords 개별 실패 | warnings 배열 누적, 진행 계속, meta.warnings_count 반환 | n/a |
| 응답 _raw (JSON parse 실패) | error="응답 JSON 파싱 실패" + retryable=true | true |
| ctx.channelAccount/brandId 누락 | retryable=false | false |
| creds 필드 누락 | retryable=false | false |
| ad_units upsert 실패 | retryable=true. error 메시지 | true |
| ad_stats upsert 실패 | retryable=true. 부분적 ad_units는 이미 저장됨 (idempotent 차회 재시도 OK) | true |
| network error | retryable=true | true |

## 6. 파일 구조 변경

```
order-manager-saas/
├── lib/adapters/naver-ad.ts                # ★ syncAdStats + syncAdUnits 시그니처(throw stub) 추가
└── server/sync-worker/
    └── lib/adapters.js                     # ★ HMAC helper + chunkArray + naverAdGet + naverAdAdapter 실 구현
```

## 7. 검증 시나리오

1. **자격증명 등록**: 운영자 페이지에서 네이버광고 자격증명 등록 → ✅ 표시 (Plan 4 validate proxy 정상 동작 확인)
2. **수동 ad_stats enqueue**:
   ```sql
   INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
   SELECT brand_id, id, channel, 'ad_stats', now()
   FROM brand_credentials WHERE channel='naver_ad' AND status='active' LIMIT 1;
   ```
   1~3분 후 `status='completed'`, `result_summary={rowsUpserted:N, meta:{ad_units_upserted:U, ad_stats_upserted:M}}`
3. **ad_units 테이블 확인**:
   ```sql
   SELECT level, count(*) FROM ad_units
   WHERE brand_id = '<운영자 brand>' AND channel = 'naver_ad'
   GROUP BY level;
   ```
   기대: campaign N개, keyword K개. ad_group 0개.
4. **ad_stats 테이블 확인**:
   ```sql
   SELECT au.level, count(*), sum(s.cost), sum(s.impressions)
   FROM ad_stats s JOIN ad_units au ON au.id = s.ad_unit_id
   WHERE s.brand_id = '<운영자 brand>' AND au.channel = 'naver_ad' AND s.date = '<yesterday>'
   GROUP BY au.level;
   ```
   기대: campaign 행 N개 (all caps), keyword 행 K_active개 (cost > 0만)
5. **cron 트리거 확인** (08:00 KST 익일 검증): pg_cron 마지막 실행 시각이 정상이고 sync_jobs에 새 'ad_stats' 잡 생성됨.
6. **manual ad_units 잡**: SQL Editor에서 `job_type='ad_units'` 단독 enqueue 후 `result_summary={rowsUpserted:U, meta:{campaign_count, keyword_count}}` 나오고 ad_stats는 변동 없음.
7. **cleanup** (선택): 검증 brand 삭제, vault 잔여 삭제, sync_jobs 정리.

## 8. 위험 + 완화

| 위험 | 완화 |
|---|---|
| /stats API rate limit (요청 / 초) | sequential 호출(병렬 X) + chunk 100. 실제 rate limit 도달 시 retryable=true로 다음 polling 자동 재시도 |
| campaign 수가 100개 초과 → ids 파라미터 길이 한계 | chunk 100개씩 분할 호출 |
| keyword 수 너무 많아 sync 시간 길어짐 | cost > 0 사전필터로 3단계 줄임 (active 캠페인의 active 그룹의 active 키워드만) |
| keyword_stats 부분 실패 (warnings 다수) | 30% 임계로 보호. 임계 미만이면 누락 데이터 받아들임 (다음 cron에 보완) |
| ad_units 매핑 실패 (응답 ID가 DB에 없음) — 차수 운영 중 keyword 추가/삭제 | ad_units 먼저 upsert + select id로 확실히 매핑. 매핑 안 된 stat은 skip + skipped_count |
| campaign_account가 같은 brand 여러 광고 계정 | brand_credentials.UNIQUE(brand_id, channel, channel_account) — 별칭 다르면 별개 잡 enqueue 가능. ad_units.channel_account에 별칭 저장. |
| 운영 중 token rotation | naver search ad는 long-lived API key 모델 — token refresh 없음. accessLicense + secretKey 1회 등록 후 변경 거의 없음. |
| Plan 4 cron이 'ad_stats' job_type만 매일 trigger — 'ad_units'는 manual | 의도. cron 정의 단순화. ad_units 자동 갱신은 syncAdStats가 이미 포함 (atomic). |

## 9. 의존성 (Plan 4/5/6에서 이미 존재)

- `httpsRequest` (Plan 4): 그대로 재사용
- `yesterdayKST` (Plan 5): 그대로 재사용
- `JOB_TYPE_TO_METHOD` 라우팅: `ad_stats` → `syncAdStats`, `ad_units` → `syncAdUnits` (Plan 4 이미 정의 — 변경 X)
- `enqueue_naver_ad_stats` pg_cron (Plan 4 이미 정의 — 변경 X)
- `ad_units` 테이블 + RLS (Plan 1, 003_ad_units.sql)
- `ad_stats` 테이블 + RLS (Plan 1, 004_ad_stats.sql)
- vault 자격증명 + brand_credentials (Plan 2/3/4)

## 10. Plan 7 이후 작업

- **Plan 6b** (사용자 요청): 코코엘 스마트스토어 옛 sync.js cron → 새 sync-worker 컷오버. 코드 작업 거의 없음 (SaaS UI에서 자격증명 등록 + 옛 sync.js 종료).
- **광고 분석 뷰**: ad_units + ad_stats를 시각화하는 SaaS 페이지 (별도 Plan)
- **Plan 5b**: 팔레오 카페24 컷오버 (Plan 5/6/7 안정 1~2주 후)
