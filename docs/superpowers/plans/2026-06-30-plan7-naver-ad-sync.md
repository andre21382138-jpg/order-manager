# Plan 7 — 네이버 검색광고 sync 구현 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가상서버 sync-worker의 `naverAdAdapter` stub을 실 구현으로 교체. atomic `syncAdStats` (ad_units 메타 + ad_stats 통계 한 번에) + manual용 `syncAdUnits`. HMAC-SHA256 서명 + /ncc/* + /stats endpoints.

**Architecture:** `lib/adapters.js` 모듈 스코프에 `crypto` require + `signNaverAd` HMAC helper + `naverAdGet(uriPath, query, creds)` + `chunkArray(arr, size)`. `naverAdAdapter.syncAdStats`는 ① 캠페인 list → ② 일별 캠페인 stats → ③/④ 활성 캠페인의 adgroup → ⑤ 활성 adgroup의 keyword → ⑥ 활성 keyword 일별 stats → ⑦ ad_units upsert (campaign 먼저, keyword는 parent_id 매핑) → ⑧ ad_stats upsert. `syncAdUnits`는 메타만 sync (stats 미터치).

**Tech Stack:** Node 20 (가상서버 CommonJS), `crypto` 내장, node `https` 내장. Supabase REST upsert. naver search ad API v1.

**Spec:** `docs/superpowers/specs/2026-06-30-plan7-naver-ad-sync-design.md`

**참조 코드** (implementer가 read):
- `c:\Users\Jangkwon\Desktop\order-manager\api\naver-ad.js` (전체 라인) — HMAC 서명, /ncc/* 엔드포인트, /stats 응답 매핑, 3단 cost>0 사전필터 패턴

## Global Constraints

- **레포 위치 (로컬)**: `C:\Users\Jangkwon\Desktop\order-manager-saas`
- **가상서버**: `203.245.41.105` `/root/sync-worker/`
- **API base**: `https://api.searchad.naver.com`
- **HMAC 서명**: `signature = base64(hmacSHA256(secretKey, "${timestamp}.${method}.${uriPath}"))` — uriPath는 쿼리스트링 제외
- **헤더**: `X-Timestamp, X-API-KEY (=accessLicense), X-Customer (=customerId), X-Signature, Content-Type: application/json`
- **응답 필드 매핑**: impCnt→impressions, clkCnt→clicks, salesAmt→cost, ccnt→conversions, convAmt→conversion_revenue
- **페이지네이션**: /stats `ids` 100개씩 chunk, sync-worker는 sequential (병렬 X)
- **ad_units key**: `external_id` (campaign: `nccCampaignId`, keyword: `nccKeywordId`)
- **ad_units channel**: `'naver_ad'` 고정
- **ad_units channel_account**: `ctx.channelAccount`
- **ad_units parent_id**: campaign: null, keyword: 같은 brand의 campaign saved UUID (keyword.adgroup.campaign 2단 lookup)
- **ad_units metadata (jsonb)**: campaign: `{type: campaignTp}`, keyword: `{ad_group_id, ad_group_name}`
- **ad_units active**: 모두 `true`
- **ad_stats UNIQUE**: `(ad_unit_id, date)` — upsert onConflict
- **campaign stats**: 전부 upsert (cost=0도)
- **keyword stats**: 일별 cost > 0만 upsert
- **skipped_count**: ad_units에 없는 external_id의 stats는 skip + 카운트
- **default 범위**: `day = yesterdayKST()` 1일치
- **백필 범위**: `ctx.dateRangeStart` 있으면 start~end (`end = dateRangeEnd || dateRangeStart`) 일별 loop
- **keyword_stats 실패율**: 30% 초과 시 ok:false (부분 결과 거부)
- **자동 테스트 무** — `node --check` + 운영자 수동 검증
- **CommonJS** (가상서버)

## File Structure (Plan 7 완료 시점)

```
order-manager-saas/
├── lib/adapters/naver-ad.ts              # ★ syncAdStats + syncAdUnits 시그니처(throw) + adapter export 갱신
└── server/sync-worker/
    └── lib/adapters.js                   # ★ crypto require + HMAC helper + naverAdGet + chunkArray + naverAdAdapter 실 구현
```

---

### Task 1: TypeScript `lib/adapters/naver-ad.ts` syncAdStats + syncAdUnits throw stub

**Files:**
- Modify: `lib/adapters/naver-ad.ts`

**Interfaces:**
- Consumes: `SyncContext`, `CredentialPayload` from `lib/adapters/_types.ts`
- Produces: TypeScript ChannelAdapter 인터페이스 충족 (syncAdStats / syncAdUnits 양쪽 throw stub). 실 구현은 가상서버.

- [ ] **Step 1: 상단 import에 SyncContext 추가**

기존:
```typescript
import 'server-only'
import type {
  ChannelAdapter,
  CredentialPayload,
  ValidateResult,
} from './_types'
```

변경:
```typescript
import 'server-only'
import type {
  ChannelAdapter,
  CredentialPayload,
  ValidateResult,
  SyncContext,
} from './_types'
```

- [ ] **Step 2: adapter export 직전에 syncAdStats + syncAdUnits 함수 추가**

`naverAdAdapter` 객체 정의 직전(같은 파일 끝쪽)에 다음 두 함수 추가:

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
```

그리고 기존 export 객체에 두 메서드 추가:

```typescript
export const naverAdAdapter: ChannelAdapter = {
  channel: 'naver_ad',
  category: 'ad',
  authType: 'api_key',
  credentialFields: [...],   // 기존 값 그대로
  buildPayload,
  validate,
  syncAdStats,
  syncAdUnits,
}
```

> `credentialFields`, `buildPayload`, `validate`는 기존 정의 그대로 유지. `[...]`는 plan 표기일 뿐 코드는 변경 X.

- [ ] **Step 3: Vercel 빌드 확인**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
npm run build
```

기대: 타입 에러 없음. 빌드 성공.

- [ ] **Step 4: 커밋**

```powershell
git add lib/adapters/naver-ad.ts
git commit -m "feat(adapters): naver-ad.ts에 syncAdStats + syncAdUnits 시그니처 추가 (throw — 가상서버 전용)"
git push
```

---

### Task 2: 가상서버 `lib/adapters.js`에 crypto + HMAC helper + naverAdGet + chunkArray

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Consumes: 기존 `httpsRequest` helper (Plan 4 Task 5)
- Produces:
  - `signNaverAd(secretKey, method, uriPath, timestamp): string` (base64 HMAC-SHA256)
  - `naverAdGet(uriPath, query, creds): Promise<{status, data}>` — httpsRequest 래퍼 + HMAC 헤더 자동
  - `chunkArray(arr, size): T[][]` — 단순 chunk

- [ ] **Step 1: 상단 require에 crypto 추가**

기존 상단부 (Task 3로 이미 bcrypt가 https 옆에 추가됨):
```javascript
const https = require('https')
const bcrypt = require('bcryptjs')
```

변경:
```javascript
const https = require('https')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
```

- [ ] **Step 2: httpsRequest 함수 다음 라인에 helper 3개 추가**

`function httpsRequest(...)` 함수 닫는 `}` 다음 빈 줄 다음에 다음 코드 블록 추가:

```javascript
// === Plan 7: 네이버 검색광고 helpers ===

function signNaverAd(secretKey, method, uriPath, timestamp) {
  const message = `${timestamp}.${method}.${uriPath}`
  return crypto.createHmac('sha256', secretKey).update(message).digest('base64')
}

async function naverAdGet(uriPath, query, creds) {
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

- [ ] **Step 3: 로컬 syntax check**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker
node --check lib/adapters.js
```

기대: 출력 없음.

- [ ] **Step 4: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "feat(sync-worker): 네이버광고 helpers (signNaverAd HMAC + naverAdGet + chunkArray)"
git push
```

---

### Task 3: 가상서버 naverAdAdapter.syncAdStats 실 구현

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Consumes: Task 2의 `signNaverAd`, `naverAdGet`, `chunkArray`. 기존 `httpsRequest`, `yesterdayKST`. `createAdminClient` from `./supabase`.
- Produces: `naverAdAdapter.syncAdStats(creds, ctx)` — atomic, ad_units 먼저 upsert 후 ad_stats upsert. 반환 `{ok, rowsUpserted, meta:{ad_units_upserted, ad_stats_upserted, skipped_count, warnings_count}}`

- [ ] **Step 1: naverAdAdapter stub 부분 찾기**

`server/sync-worker/lib/adapters.js`의 stub 영역(약 535~538 라인 근처):

```javascript
const naverAdAdapter = {
  channel: 'naver_ad',
  // syncAdStats/syncAdUnits — Plan 7에서 구현
}
```

- [ ] **Step 2: 위 stub을 다음 코드로 교체** (syncAdUnits는 Task 4에서 추가, 현재 Task 3는 syncAdStats만)

```javascript
const naverAdAdapter = {
  channel: 'naver_ad',

  async syncAdStats(creds, ctx) {
    const { customerId, accessLicense, secretKey } = creds
    const brandId = ctx.brandId
    const channelAccount = ctx.channelAccount
    if (!customerId || !accessLicense || !secretKey || !brandId || !channelAccount) {
      return { ok: false, error: 'syncAdStats: 필수 인자 누락', retryable: false }
    }

    const { createAdminClient } = require('./supabase')
    const admin = createAdminClient()

    // 1. 날짜 범위 결정
    const startDate = ctx.dateRangeStart || yesterdayKST()
    const endDate = ctx.dateRangeEnd || ctx.dateRangeStart || yesterdayKST()
    const days = []
    {
      let cursor = new Date(`${startDate}T00:00:00Z`)
      const endD = new Date(`${endDate}T00:00:00Z`)
      while (cursor <= endD) {
        days.push(cursor.toISOString().slice(0, 10))
        cursor = new Date(cursor.getTime() + 86400000)
      }
    }

    const warnings = []

    // 2. /ncc/campaigns
    const campResp = await naverAdGet('/ncc/campaigns', null, { customerId, accessLicense, secretKey })
    if (campResp.status === 401) {
      return { ok: false, error: 'naver_ad 인증 실패 (401, campaigns)', retryable: true }
    }
    if (campResp.status !== 200) {
      return {
        ok: false,
        error: `campaigns 조회 실패 (${campResp.status}): ${JSON.stringify(campResp.data).slice(0, 200)}`,
        retryable: true,
      }
    }
    const campaignList = Array.isArray(campResp.data) ? campResp.data : []
    if (campaignList.length === 0) {
      return { ok: true, rowsUpserted: 0, meta: { ad_units_upserted: 0, ad_stats_upserted: 0, skipped_count: 0, warnings_count: 0 } }
    }
    const allCampaignIds = campaignList.map((c) => c.nccCampaignId).filter(Boolean)
    const idToCampaign = {}
    for (const c of campaignList) {
      if (c.nccCampaignId) idToCampaign[c.nccCampaignId] = { name: c.name || c.nccCampaignId, type: c.campaignTp || null }
    }

    // 3. days × campaign /stats — 전 캠페인 (cost=0 포함)
    const fields5 = JSON.stringify(['impCnt', 'clkCnt', 'salesAmt', 'ccnt', 'convAmt'])
    const fieldsCost = JSON.stringify(['salesAmt'])
    const campaignStatsByDay = {} // {day: {nccCampaignId: {impressions, clicks, cost, conversions, conversion_revenue}}}
    const sumCostByCampaign = {}
    const campChunks = chunkArray(allCampaignIds, 100)
    for (const day of days) {
      campaignStatsByDay[day] = {}
      for (const chunk of campChunks) {
        const r = await naverAdGet(
          '/stats',
          {
            ids: chunk.join(','),
            fields: fields5,
            timeRange: JSON.stringify({ since: day, until: day }),
            datePreset: 'custom',
          },
          { customerId, accessLicense, secretKey }
        )
        if (r.status === 401) return { ok: false, error: 'naver_ad 인증 실패 (401, campaign stats)', retryable: true }
        if (r.status !== 200) {
          return { ok: false, error: `campaign stats 조회 실패 (${day}, ${r.status})`, retryable: true }
        }
        for (const it of (r.data?.data || [])) {
          const cost = Number(it.salesAmt || 0)
          campaignStatsByDay[day][it.id] = {
            impressions: Number(it.impCnt || 0),
            clicks: Number(it.clkCnt || 0),
            cost,
            conversions: Number(it.ccnt || 0),
            conversion_revenue: Number(it.convAmt || 0),
          }
          sumCostByCampaign[it.id] = (sumCostByCampaign[it.id] || 0) + cost
        }
      }
    }
    const activeCampaignIds = Object.keys(sumCostByCampaign).filter((id) => sumCostByCampaign[id] > 0)

    // 4. activeCampaignIds 별 /ncc/adgroups sequential
    const adgroupList = []
    const idToAdgroup = {} // adgroupId → {name, campaign_id}
    for (const cid of activeCampaignIds) {
      const r = await naverAdGet('/ncc/adgroups', { nccCampaignId: cid }, { customerId, accessLicense, secretKey })
      if (r.status === 401) return { ok: false, error: 'naver_ad 인증 실패 (401, adgroups)', retryable: true }
      if (r.status !== 200) {
        warnings.push({ stage: 'adgroups', cid, status: r.status })
        continue
      }
      const arr = Array.isArray(r.data) ? r.data : []
      for (const g of arr) {
        if (g.nccAdgroupId) {
          adgroupList.push(g)
          idToAdgroup[g.nccAdgroupId] = { name: g.name || g.nccAdgroupId, campaign_id: g.nccCampaignId || cid }
        }
      }
    }
    const allAdgroupIds = adgroupList.map((g) => g.nccAdgroupId).filter(Boolean)

    // 5. adgroup ids chunk /stats 기간 합산 — activeAdgroupIds
    let activeAdgroupIds = []
    if (allAdgroupIds.length > 0) {
      const adgroupChunks = chunkArray(allAdgroupIds, 100)
      const adgroupCost = {}
      for (const chunk of adgroupChunks) {
        const r = await naverAdGet(
          '/stats',
          {
            ids: chunk.join(','),
            fields: fieldsCost,
            timeRange: JSON.stringify({ since: startDate, until: endDate }),
            datePreset: 'custom',
          },
          { customerId, accessLicense, secretKey }
        )
        if (r.status === 401) return { ok: false, error: 'naver_ad 인증 실패 (401, adgroup stats)', retryable: true }
        if (r.status !== 200) {
          return { ok: false, error: `adgroup stats 조회 실패 (${r.status})`, retryable: true }
        }
        for (const it of (r.data?.data || [])) {
          adgroupCost[it.id] = (adgroupCost[it.id] || 0) + Number(it.salesAmt || 0)
        }
      }
      activeAdgroupIds = Object.keys(adgroupCost).filter((id) => adgroupCost[id] > 0)
    }

    // 6. activeAdgroupIds 별 /ncc/keywords sequential
    const keywordList = []
    const idToKeyword = {} // keywordId → {name, adgroup_id}
    for (const gid of activeAdgroupIds) {
      const r = await naverAdGet('/ncc/keywords', { nccAdgroupId: gid }, { customerId, accessLicense, secretKey })
      if (r.status === 401) return { ok: false, error: 'naver_ad 인증 실패 (401, keywords)', retryable: true }
      if (r.status !== 200) {
        warnings.push({ stage: 'keywords', gid, status: r.status })
        continue
      }
      const arr = Array.isArray(r.data) ? r.data : []
      for (const k of arr) {
        if (k.nccKeywordId) {
          keywordList.push(k)
          idToKeyword[k.nccKeywordId] = { name: k.keyword || k.nccKeywordId, adgroup_id: k.nccAdgroupId || gid }
        }
      }
    }
    const allKeywordIds = keywordList.map((k) => k.nccKeywordId).filter(Boolean)

    // 7. keyword ids chunk /stats 기간 합산 — activeKeywordIds
    let activeKeywordIds = []
    if (allKeywordIds.length > 0) {
      const kwChunks = chunkArray(allKeywordIds, 100)
      const kwCost = {}
      for (const chunk of kwChunks) {
        const r = await naverAdGet(
          '/stats',
          {
            ids: chunk.join(','),
            fields: fieldsCost,
            timeRange: JSON.stringify({ since: startDate, until: endDate }),
            datePreset: 'custom',
          },
          { customerId, accessLicense, secretKey }
        )
        if (r.status === 401) return { ok: false, error: 'naver_ad 인증 실패 (401, keyword period stats)', retryable: true }
        if (r.status !== 200) {
          return { ok: false, error: `keyword period stats 조회 실패 (${r.status})`, retryable: true }
        }
        for (const it of (r.data?.data || [])) {
          kwCost[it.id] = (kwCost[it.id] || 0) + Number(it.salesAmt || 0)
        }
      }
      activeKeywordIds = Object.keys(kwCost).filter((id) => kwCost[id] > 0)
    }

    // 8. days × activeKeyword chunk /stats full stats
    const keywordStatsByDay = {} // {day: {keywordId: {impressions, clicks, cost, ...}}}
    let kwStatTasks = 0
    let kwStatFails = 0
    if (activeKeywordIds.length > 0) {
      const kwChunks = chunkArray(activeKeywordIds, 100)
      for (const day of days) {
        keywordStatsByDay[day] = {}
        for (const chunk of kwChunks) {
          kwStatTasks++
          const r = await naverAdGet(
            '/stats',
            {
              ids: chunk.join(','),
              fields: fields5,
              timeRange: JSON.stringify({ since: day, until: day }),
              datePreset: 'custom',
            },
            { customerId, accessLicense, secretKey }
          )
          if (r.status === 401) return { ok: false, error: 'naver_ad 인증 실패 (401, keyword day stats)', retryable: true }
          if (r.status !== 200) {
            kwStatFails++
            warnings.push({ stage: 'keyword_stats', day, status: r.status })
            continue
          }
          for (const it of (r.data?.data || [])) {
            const cost = Number(it.salesAmt || 0)
            if (cost > 0) {
              keywordStatsByDay[day][it.id] = {
                impressions: Number(it.impCnt || 0),
                clicks: Number(it.clkCnt || 0),
                cost,
                conversions: Number(it.ccnt || 0),
                conversion_revenue: Number(it.convAmt || 0),
              }
            }
          }
        }
      }
    }
    if (kwStatTasks > 0 && kwStatFails / kwStatTasks > 0.3) {
      return {
        ok: false,
        error: `keyword_stats 실패율 과다: ${kwStatFails}/${kwStatTasks}`,
        retryable: true,
      }
    }

    // 9-10. ad_units upsert (campaign 먼저, keyword는 parent_id 매핑)
    const campaignAdUnitRows = allCampaignIds.map((cid) => ({
      brand_id: brandId,
      channel: 'naver_ad',
      channel_account: channelAccount,
      external_id: cid,
      external_name: idToCampaign[cid]?.name || cid,
      level: 'campaign',
      parent_id: null,
      metadata: { type: idToCampaign[cid]?.type || null },
      active: true,
    }))

    const { data: savedCampaigns, error: campUpsertErr } = await admin
      .from('ad_units')
      .upsert(campaignAdUnitRows, { onConflict: 'brand_id,channel,external_id' })
      .select('id, external_id')

    if (campUpsertErr) {
      return { ok: false, error: `ad_units (campaign) upsert 실패: ${campUpsertErr.message}`, retryable: true }
    }
    const campaignDbIdMap = {}
    for (const row of (savedCampaigns || [])) campaignDbIdMap[row.external_id] = row.id

    // keyword rows
    const keywordAdUnitRows = []
    for (const kid of allKeywordIds) {
      const kw = idToKeyword[kid]
      if (!kw) continue
      const ag = idToAdgroup[kw.adgroup_id]
      if (!ag) continue
      const parentDbId = campaignDbIdMap[ag.campaign_id]
      if (!parentDbId) continue // campaign이 ad_units에 없으면 skip (드물지만 safety)
      keywordAdUnitRows.push({
        brand_id: brandId,
        channel: 'naver_ad',
        channel_account: channelAccount,
        external_id: kid,
        external_name: kw.name,
        level: 'keyword',
        parent_id: parentDbId,
        metadata: { ad_group_id: kw.adgroup_id, ad_group_name: ag.name },
        active: true,
      })
    }

    let savedKeywords = []
    if (keywordAdUnitRows.length > 0) {
      const { data, error: kwUpsertErr } = await admin
        .from('ad_units')
        .upsert(keywordAdUnitRows, { onConflict: 'brand_id,channel,external_id' })
        .select('id, external_id')
      if (kwUpsertErr) {
        return { ok: false, error: `ad_units (keyword) upsert 실패: ${kwUpsertErr.message}`, retryable: true }
      }
      savedKeywords = data || []
    }
    const keywordDbIdMap = {}
    for (const row of savedKeywords) keywordDbIdMap[row.external_id] = row.id

    const adUnitsUpserted = (savedCampaigns?.length || 0) + savedKeywords.length

    // 11. ad_stats upsert (campaign 전부 + keyword 일별 cost > 0)
    const statRows = []
    let skipped = 0
    for (const day of days) {
      // campaign stats — 전부 (cost=0 포함)
      for (const cid of allCampaignIds) {
        const unitDb = campaignDbIdMap[cid]
        if (!unitDb) { skipped++; continue }
        const s = campaignStatsByDay[day]?.[cid] || { impressions: 0, clicks: 0, cost: 0, conversions: 0, conversion_revenue: 0 }
        statRows.push({
          brand_id: brandId,
          ad_unit_id: unitDb,
          date: day,
          impressions: s.impressions,
          clicks: s.clicks,
          cost: s.cost,
          conversions: s.conversions,
          conversion_revenue: s.conversion_revenue,
          metadata: {},
        })
      }
      // keyword stats — 일별 cost > 0만
      const dayKwStats = keywordStatsByDay[day] || {}
      for (const kid of Object.keys(dayKwStats)) {
        const unitDb = keywordDbIdMap[kid]
        if (!unitDb) { skipped++; continue }
        const s = dayKwStats[kid]
        statRows.push({
          brand_id: brandId,
          ad_unit_id: unitDb,
          date: day,
          impressions: s.impressions,
          clicks: s.clicks,
          cost: s.cost,
          conversions: s.conversions,
          conversion_revenue: s.conversion_revenue,
          metadata: {},
        })
      }
    }

    let adStatsUpserted = 0
    if (statRows.length > 0) {
      const BATCH = 200
      for (let i = 0; i < statRows.length; i += BATCH) {
        const batch = statRows.slice(i, i + BATCH)
        const { data, error: statErr } = await admin
          .from('ad_stats')
          .upsert(batch, { onConflict: 'ad_unit_id,date' })
          .select('id')
        if (statErr) {
          return { ok: false, error: `ad_stats upsert 실패: ${statErr.message}`, retryable: true }
        }
        adStatsUpserted += data?.length || 0
      }
    }

    return {
      ok: true,
      rowsUpserted: adStatsUpserted,
      meta: {
        ad_units_upserted: adUnitsUpserted,
        ad_stats_upserted: adStatsUpserted,
        skipped_count: skipped,
        warnings_count: warnings.length,
        days: days.length,
        active_campaigns: activeCampaignIds.length,
        active_keywords: activeKeywordIds.length,
      },
    }
  },

  // syncAdUnits — Task 4에서 추가
}
```

> 주의: 이 코드 블록 안에 `// syncAdUnits — Task 4에서 추가` 주석 라인을 남기고, syncAdUnits 메서드는 Task 4에서 그 위치에 추가.

- [ ] **Step 3: 로컬 syntax check**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker
node --check lib/adapters.js
```

기대: 출력 없음.

- [ ] **Step 4: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "feat(sync-worker): naverAdAdapter.syncAdStats 실 구현 (atomic ad_units + ad_stats, 3단 cost 필터)"
git push
```

---

### Task 4: 가상서버 naverAdAdapter.syncAdUnits 실 구현

**Files:**
- Modify: `server/sync-worker/lib/adapters.js`

**Interfaces:**
- Consumes: 같은 helper (`naverAdGet`). 같은 idToCampaign/Adgroup/Keyword 패턴.
- Produces: `naverAdAdapter.syncAdUnits(creds, ctx)` — ad_units만 sync (campaign + keyword 메타), ad_stats 미터치. 반환 `{ok, rowsUpserted, meta:{campaign_count, keyword_count}}`

- [ ] **Step 1: Task 3 코드의 `// syncAdUnits — Task 4에서 추가` 주석 라인을 다음 메서드로 교체**

기존 (Task 3 끝부분):
```javascript
  // syncAdUnits — Task 4에서 추가
}
```

교체:
```javascript
  async syncAdUnits(creds, ctx) {
    const { customerId, accessLicense, secretKey } = creds
    const brandId = ctx.brandId
    const channelAccount = ctx.channelAccount
    if (!customerId || !accessLicense || !secretKey || !brandId || !channelAccount) {
      return { ok: false, error: 'syncAdUnits: 필수 인자 누락', retryable: false }
    }

    const { createAdminClient } = require('./supabase')
    const admin = createAdminClient()

    const warnings = []

    // 1. campaigns
    const campResp = await naverAdGet('/ncc/campaigns', null, { customerId, accessLicense, secretKey })
    if (campResp.status === 401) return { ok: false, error: 'naver_ad 인증 실패 (401, campaigns)', retryable: true }
    if (campResp.status !== 200) {
      return { ok: false, error: `campaigns 조회 실패 (${campResp.status})`, retryable: true }
    }
    const campaignList = Array.isArray(campResp.data) ? campResp.data : []
    const allCampaignIds = campaignList.map((c) => c.nccCampaignId).filter(Boolean)
    const idToCampaign = {}
    for (const c of campaignList) {
      if (c.nccCampaignId) idToCampaign[c.nccCampaignId] = { name: c.name || c.nccCampaignId, type: c.campaignTp || null }
    }

    // 2. adgroups per campaign (전체)
    const adgroupList = []
    const idToAdgroup = {}
    for (const cid of allCampaignIds) {
      const r = await naverAdGet('/ncc/adgroups', { nccCampaignId: cid }, { customerId, accessLicense, secretKey })
      if (r.status !== 200) { warnings.push({ stage: 'adgroups', cid, status: r.status }); continue }
      const arr = Array.isArray(r.data) ? r.data : []
      for (const g of arr) {
        if (g.nccAdgroupId) {
          adgroupList.push(g)
          idToAdgroup[g.nccAdgroupId] = { name: g.name || g.nccAdgroupId, campaign_id: g.nccCampaignId || cid }
        }
      }
    }

    // 3. keywords per adgroup (전체)
    const keywordList = []
    const idToKeyword = {}
    for (const g of adgroupList) {
      const r = await naverAdGet('/ncc/keywords', { nccAdgroupId: g.nccAdgroupId }, { customerId, accessLicense, secretKey })
      if (r.status !== 200) { warnings.push({ stage: 'keywords', gid: g.nccAdgroupId, status: r.status }); continue }
      const arr = Array.isArray(r.data) ? r.data : []
      for (const k of arr) {
        if (k.nccKeywordId) {
          keywordList.push(k)
          idToKeyword[k.nccKeywordId] = { name: k.keyword || k.nccKeywordId, adgroup_id: k.nccAdgroupId || g.nccAdgroupId }
        }
      }
    }

    // 4. ad_units upsert — campaign 먼저
    const campaignRows = allCampaignIds.map((cid) => ({
      brand_id: brandId,
      channel: 'naver_ad',
      channel_account: channelAccount,
      external_id: cid,
      external_name: idToCampaign[cid]?.name || cid,
      level: 'campaign',
      parent_id: null,
      metadata: { type: idToCampaign[cid]?.type || null },
      active: true,
    }))

    const { data: savedCampaigns, error: campErr } = await admin
      .from('ad_units')
      .upsert(campaignRows, { onConflict: 'brand_id,channel,external_id' })
      .select('id, external_id')
    if (campErr) {
      return { ok: false, error: `ad_units (campaign) upsert 실패: ${campErr.message}`, retryable: true }
    }
    const campaignDbIdMap = {}
    for (const row of (savedCampaigns || [])) campaignDbIdMap[row.external_id] = row.id

    // keyword rows
    const keywordRows = []
    for (const k of keywordList) {
      const kw = idToKeyword[k.nccKeywordId]
      if (!kw) continue
      const ag = idToAdgroup[kw.adgroup_id]
      if (!ag) continue
      const parentDbId = campaignDbIdMap[ag.campaign_id]
      if (!parentDbId) continue
      keywordRows.push({
        brand_id: brandId,
        channel: 'naver_ad',
        channel_account: channelAccount,
        external_id: k.nccKeywordId,
        external_name: kw.name,
        level: 'keyword',
        parent_id: parentDbId,
        metadata: { ad_group_id: kw.adgroup_id, ad_group_name: ag.name },
        active: true,
      })
    }

    let savedKeywords = []
    if (keywordRows.length > 0) {
      const { data, error: kwErr } = await admin
        .from('ad_units')
        .upsert(keywordRows, { onConflict: 'brand_id,channel,external_id' })
        .select('id, external_id')
      if (kwErr) {
        return { ok: false, error: `ad_units (keyword) upsert 실패: ${kwErr.message}`, retryable: true }
      }
      savedKeywords = data || []
    }

    const totalUpserted = (savedCampaigns?.length || 0) + savedKeywords.length

    return {
      ok: true,
      rowsUpserted: totalUpserted,
      meta: {
        campaign_count: savedCampaigns?.length || 0,
        keyword_count: savedKeywords.length,
        warnings_count: warnings.length,
      },
    }
  },
}
```

- [ ] **Step 2: 로컬 syntax check**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker
node --check lib/adapters.js
```

기대: 출력 없음.

- [ ] **Step 3: 커밋**

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager-saas
git add server/sync-worker/lib/adapters.js
git commit -m "feat(sync-worker): naverAdAdapter.syncAdUnits 실 구현 (manual ad_units 백필용)"
git push
```

---

### Task 5: 가상서버 deploy + reload (사용자 직접)

**Files:** 외부 작업 (scp + pm2 reload)

**Interfaces:**
- Produces: 가상서버 `/root/sync-worker/lib/adapters.js` 최신 + PM2 재시작 + 정상 로그

- [ ] **Step 1: 로컬에서 가상서버로 adapters.js 동기화**

로컬 PowerShell:

```powershell
scp C:\Users\Jangkwon\Desktop\order-manager-saas\server\sync-worker\lib\adapters.js root@203.245.41.105:/root/sync-worker/lib/adapters.js
```

- [ ] **Step 2: 가상서버 SSH + PM2 reload + 로그 확인**

가상서버 SSH:

```bash
pm2 reload sync-worker
sleep 5
pm2 logs sync-worker --lines 15 --nostream
```

기대: `sync-worker starting` + 추가 에러 없음.

이 task는 외부 작업이라 커밋 없음.

---

### Task 6: 통합 수동 검증 (사용자 직접)

**Files:** 외부 작업 (브라우저 + SSH + SQL Editor)

**Interfaces:**
- Produces: spec §7 검증 시나리오 7개 모두 통과

이 task는 사용자가 직접 진행.

- [ ] **Step 1: PM2 상태 확인**

```bash
pm2 list
```

기대: `sync-worker` 행 `online`, 직전 uptime 적정.

- [ ] **Step 2: 운영자 페이지에서 네이버광고 자격증명 등록**

1. `https://order-manager-saas-bay.vercel.app` 시크릿 창 로그인 (`ssakwon@kbh.kr`)
2. 기존 또는 신규 브랜드 페이지 → "+ 네이버광고 계정 추가"
3. 별칭 `테스트` + customer/license/secret 입력 (PALEO_NAVERAD_*)
4. 등록 → ✅ 표시

가상서버 `.env`에서 값 확인:

```bash
grep "^PALEO_NAVERAD" /root/naver-proxy/.env
```

- [ ] **Step 3: 수동 ad_stats enqueue**

Supabase SQL Editor:

```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'ad_stats', now()
FROM brand_credentials WHERE channel='naver_ad' AND status='active' LIMIT 1;
```

- [ ] **Step 4: 1~3분 후 결과 확인**

```sql
SELECT status, result_summary, error_message
FROM sync_jobs WHERE job_type='ad_stats' AND channel='naver_ad'
ORDER BY created_at DESC LIMIT 3;
```

기대: `status='completed'`, `result_summary` 안에 `rowsUpserted` + `meta.ad_units_upserted, ad_stats_upserted, skipped_count, warnings_count`.

만약 에러나면 `error_message` 확인 후 같은 패턴으로 fix (Plan 5/6 경험 동일).

- [ ] **Step 5: ad_units 행 수 확인**

```sql
SELECT level, count(*)
FROM ad_units
WHERE channel = 'naver_ad'
GROUP BY level;
```

기대: `campaign` N개, `keyword` K개. `ad_group` 0개 (sync 안 함).

- [ ] **Step 6: ad_stats 행 수 + 합산 확인**

yesterday 값을 `'2026-06-29'` (KST 어제) 식으로 치환:

```sql
SELECT au.level, count(*), sum(s.cost), sum(s.impressions)
FROM ad_stats s
JOIN ad_units au ON au.id = s.ad_unit_id
WHERE au.channel = 'naver_ad' AND s.date = (current_date - interval '1 day')::date
GROUP BY au.level;
```

기대: campaign 행 N개 (cost=0 포함), keyword 행은 cost>0만.

- [ ] **Step 7: manual ad_units 잡 검증**

```sql
INSERT INTO sync_jobs (brand_id, credential_id, channel, job_type, scheduled_at)
SELECT brand_id, id, channel, 'ad_units', now()
FROM brand_credentials WHERE channel='naver_ad' AND status='active' LIMIT 1;
```

1~3분 후:

```sql
SELECT status, result_summary
FROM sync_jobs WHERE job_type='ad_units' AND channel='naver_ad'
ORDER BY created_at DESC LIMIT 1;
```

기대: `result_summary` 안에 `meta.campaign_count`, `meta.keyword_count`. ad_stats는 변동 없음.

- [ ] **Step 8: cleanup (선택)**

```sql
DELETE FROM brands WHERE name='Plan 7 검증' OR name='Plan 6 검증';
DELETE FROM vault.secrets WHERE id NOT IN (SELECT secret_id FROM brand_credentials WHERE secret_id IS NOT NULL);
DELETE FROM sync_jobs WHERE created_at < now() - interval '1 hour' OR status IN ('completed','failed');

SELECT
  (SELECT count(*) FROM brand_credentials) AS bc,
  (SELECT count(*) FROM vault.secrets) AS vs,
  (SELECT count(*) FROM sync_jobs) AS sj,
  (SELECT count(*) FROM ad_units) AS au,
  (SELECT count(*) FROM ad_stats) AS as_count;
```

이 task는 외부 작업이라 커밋 없음.

---

## Plan 7 완료 기준 체크리스트

- [ ] TypeScript naver-ad.ts에 syncAdStats + syncAdUnits 시그니처(throw) 추가, Vercel 빌드 통과
- [ ] 가상서버 adapters.js에 crypto require + signNaverAd + naverAdGet + chunkArray helper
- [ ] 가상서버 naverAdAdapter.syncAdStats 실 구현 (atomic, 3단 cost 필터, ad_units → ad_stats)
- [ ] 가상서버 naverAdAdapter.syncAdUnits 실 구현 (manual용)
- [ ] 가상서버 deploy + PM2 reload + 정상 로그
- [ ] 통합 검증 시나리오 7개 통과 (특히 4 ad_stats 행/합산 + 7 ad_units 단독 잡)

## Plan 7 이후 — Plan 6b / Plan 5b / 광고 분석 뷰 예고

- **Plan 6b** (사용자 요청): 코코엘 스마트스토어 옛 sync.js cron → 새 sync-worker 컷오버. 코드 작업 거의 없음
- **광고 분석 뷰**: ad_units + ad_stats 시각화 SaaS 페이지 (별도 Plan)
- **Plan 5b**: 팔레오 카페24 컷오버

---

## 위험 + 완화

| 위험 | 완화 |
|---|---|
| /stats API rate limit | sequential 호출(병렬 X) + chunk 100. 도달 시 retryable=true로 재시도 |
| campaign 수 100개 초과 → ids 길이 한계 | chunk 100개씩 분할 |
| keyword 수 너무 많아 sync 시간 길어짐 | cost > 0 사전필터로 3단계 축소 |
| keyword_stats 부분 실패 | 30% 임계로 보호 |
| ad_units 매핑 실패 (응답 ID DB에 없음) | ad_units 먼저 upsert + select id로 매핑. 매핑 안 된 stat은 skip + skipped_count |
| 첫 운영 시 ad_units 없는 상태 → ad_stats가 매핑 실패 | atomic이라 같은 호출 안에서 ad_units 먼저 upsert. 동일 잡 내 순서 보장 |
| 운영 중 keyword 추가 | 다음 cron에서 새 ad_units 자동 추가 (UNIQUE conflict로 update) |
| Plan 4 cron 'ad_stats' 만 매일 trigger | 의도. syncAdStats 안에서 ad_units 자동 갱신. 'ad_units' 잡은 manual용 |
