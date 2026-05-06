# Order Manager

멀티브랜드 온라인쇼핑몰 주문관리 대시보드

- **배포 URL**: https://order-manager-kappa.vercel.app
- **GitHub**: https://github.com/andre21382138-jpg/order-manager
- **스택**: React (CRA) + Supabase + Vercel

---

## 브랜드 / 몰 구성

| 브랜드 | 카페24 몰ID | 스마트스토어 | 부서 |
|--------|------------|-------------|------|
| 팔레오 | paleo | ✅ 연동 완료 | 쇼핑몰운영팀 |
| 아프리모 | afrimo | ❌ 미연동 | 쇼핑몰운영팀 |
| 코코엘 | cocoel / cocoel021 | ✅ 연동 완료 | 쇼핑몰운영팀 |

---

## 메뉴 구조

| 탭 | 서브메뉴 | 설명 |
|----|---------|------|
| 💰 원가 | 원가입력 / 원가조회 | 준비 중 |
| 📣 광고 | 광고입력 / 광고현황조회 | 준비 중 |
| 📊 결산 | 주문입력 / 주문조회 / 결산조회 | 운영 중 |
| 📢 공지사항 | - | 사이드바 바로가기, 관리자 공지/직원 댓글 |
| 📋 상품소개서 | - | 사이드바 바로가기, 카페24 상품 조회 → PPT 다운로드 |

---

## 파일 구조

```
order-manager/                          ← GitHub + Vercel 배포용
├── src/
│   ├── App.js                          # 메인 컴포넌트 (전체 UI + 로직)
│   ├── supabase.js                     # Supabase 클라이언트
│   └── index.js
├── api/
│   ├── cafe24.js                       # 카페24 API (주문/상품/analytics)
│   └── pptx.js                         # 상품소개서 PPT 생성 (서버사이드)
├── server/                             ← 카페24 가상서버 배포용
│   ├── proxy.js                        # 네이버 커머스 프록시 (env-driven, PM2 관리)
│   ├── sync.js                         # 스마트스토어 자동 동기화 (cron 호출)
│   ├── ecosystem.config.js             # PM2 설정 (naver-proxy + naver-tunnel)
│   ├── package.json                    # bcryptjs + dotenv
│   └── .env.example                    # 환경변수 템플릿
└── README.md
```

---

## Supabase 테이블

| 테이블 | 설명 |
|--------|------|
| `profiles` | 유저 (name, department, approved, role) |
| `brands` | 브랜드 (name, color, mall_types, categories, department) |
| `brand_managers` | 담당자-브랜드 매핑 |
| `orders` | 주문헤더 (brand_id, mall_type, order_no, date, total_amount, original_amount, naver_amount, is_cancelled, is_new, total_qty, note) |
| `order_items` | 주문상품 (order_id, product_name, category, qty, amount) |
| `cafe24_tokens` | 카페24 토큰 (brand_id unique) |
| `product_category_map` | 상품번호→카테고리 매핑 (brand_id, product_no unique) |
| `notices` | 공지사항 (title, content, author, is_pinned, created_at) |
| `notice_comments` | 공지사항 댓글 (notice_id, content, author, created_at) |

---

## 환경변수

### Vercel (브라우저/빌드)
```
CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET / CAFE24_REDIRECT_URI   # paleo 기본
CAFE24_CLIENT_ID_AFRIMO / CAFE24_CLIENT_SECRET_AFRIMO
CAFE24_CLIENT_ID_COCOEL / CAFE24_CLIENT_SECRET_COCOEL
REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY
REACT_APP_CAFE24_CLIENT_ID
REACT_APP_CAFE24_CLIENT_ID_AFRIMO
REACT_APP_CAFE24_CLIENT_ID_COCOEL
REACT_APP_PROXY_URL                                             # Cloudflare Tunnel URL
REACT_APP_PROXY_TOKEN                                           # 프록시 인증 토큰
```

### 카페24 서버 (`/root/naver-proxy/.env`)
```
PROXY_PORT=3002
PROXY_HOST=127.0.0.1
ALLOWED_ORIGINS=https://order-manager-kappa.vercel.app
PROXY_TOKEN                                                     # 32자 hex 랜덤
PALEO_APP_ID / PALEO_APP_SECRET
COCOEL_APP_ID / COCOEL_APP_SECRET
SUPABASE_URL / SUPABASE_KEY                                     # service_role 키 (RLS 우회)
PROXY_BASE=http://127.0.0.1:3002
```

---

## 주요 기능

### 인증 & 권한
- Supabase Auth 기반 로그인/회원가입
- 관리자 승인 시스템 (가입 후 승인 필요)
- 역할: admin / director / manager
- 부서별 필터 (admin/director만 타부서 조회 가능)

### 카페24 연동

**수집 방식**
- 결제일 기준 주문 수집 (카페24 전체주문조회 결제일기준과 동일)
- 정상 주문(`canceled=F`)과 취소 주문(`canceled=T`) 각각 별도 API 호출 후 합산
- 30일 단위 청크 분할, 페이지네이션 100건씩
- 배치 upsert 50건씩 (`order_no + brand_id` unique)

**네이버페이 처리**
- `order_place_id === "NCHECKOUT"` 조건으로 네이버페이 주문 감지
- `orders.naver_amount` 컬럼에 분리 저장

**매출 계산 기준**
```
실제결제금액 = totalAmount - naverAmount + cancelAmount
네이버페이결제금액 = naverAmount 합계 (참고용)
최종매출(네이버페이 포함) = totalAmount (정상주문 합계)
환불금액 = cancelAmount (취소주문 합계)
```

### 스마트스토어 연동 (팔레오, 코코엘)
- 네이버 API 고정 IP 정책 → **카페24 가상서버**(203.245.41.105) 프록시 경유
- 외부 노출: **Cloudflare Tunnel** (인바운드 포트 오픈 불필요, HTTPS 자동)
- 서버 프록시: `server/proxy.js` (PM2로 24/7 실행, 127.0.0.1:3002)
- 인증: `X-Proxy-Token` 헤더 (`PROXY_TOKEN` 환경변수)
- 브랜드별 자격증명 분기: URL 파라미터 `brandId`로 팔레오/코코엘 구분
- 응답 구조: `data.data.contents[]` → `item.content.order` / `item.content.productOrder`
- 취소/반품 상태코드: `CANCEL_DONE`, `RETURN_DONE`, `RETURNED`, `EXCHANGE_DONE` 등

**자동 동기화**: 카페24 서버 cron 매일 08:00, 16:00 KST (`/root/naver-proxy/sync.js`)

### 상품소개서
- 사이드바 📋 상품소개서 버튼으로 접근
- 카페24 연동 브랜드 선택 → 상품 목록 썸네일 표시
- 원하는 상품 체크박스 다중 선택
- 소개서 항목: 브랜드명 / 상품명 / 판매가 / 공급가 / 제조사 / 용량·무게 / 요약설명
- 웹에서 모든 항목 직접 수정 가능
- 🖨️ PDF 인쇄 / 📊 PPT 다운로드 (`api/pptx.js` 서버사이드 생성)

### 공지사항
- 관리자만 공지 작성 / 수정 / 삭제 / 상단 고정
- 📌 고정 공지 최상단 노란 배경 표시
- 전 직원 댓글 등록 가능

### 결산 탭

**요약 카드 (8개)**
| 카드 | 내용 |
|------|------|
| 🛒 총 주문금액 | 취소 포함 주문 전체 금액 |
| 📦 주문건수 | 정상건수 (전체건수 중 취소건수) |
| 💳 실제 결제금액 | 현금결제 + 취소환불 포함 |
| 🟢 네이버페이 결제금액 | naver_amount 합계 (참고용) |
| ↩️ 환불건수 / 💸 환불금액 | 취소주문 건수 및 금액 |
| 💰 최종매출 (네이버페이 포함) | 정상주문 total_amount 합계 |
| 📈 객단가 | 최종매출 ÷ 정상주문건수 |

**기타**
- 신규/재구매 카드 (자사몰만)
- 방문통계 및 전환률 (자사몰 단독선택 시)
- 브랜드별 / 카테고리별 / 일별 결산
- 상품별 매출순위
- 날짜 선택 어제까지만 가능 (KST 기준)

---

## 매출 데이터 정합성

카페24 관리자 [전체주문조회 > 결제일기준]과 비교 시 (아프리모 3월8일 기준):

| 항목 | 카페24 | 앱 | 비고 |
|------|--------|-----|------|
| 실결제금액 | 7,797,821원 | 7,797,821원 | ✅ 일치 |
| 네이버포인트 | 1,313,703원 | 1,301,257원 | ✅ 근사 (카페24도 참고용) |
| 환불금액 | - | 299,554원 | ✅ 결제일 기준 |

> 스마트스토어는 주문일/결제일 기준 차이로 날짜별 ±1~3건 오차 발생 가능. 월 합산 기준 일치.

---

## 배포 방법

```powershell
cd C:\Users\Jangkwon\Desktop\order-manager
git add src/App.js api/cafe24.js
git commit -m "커밋 메시지"
git push
```
Vercel 자동 배포 (GitHub 연동)

---

## 작업 방식
- VSCode 미사용: 파일 다운로드 → 로컬 교체 → git push
- 카페24 가상서버(203.245.41.105)가 24시간 프록시·동기화 담당 → **사무실 PC 의존 X**
- 외근/재택에서도 정상 동작 (Cloudflare Tunnel)
- 자동 동기화는 카페24 서버 crontab 관리 (`crontab -e`로 편집)

### 카페24 서버 운영
```bash
ssh root@203.245.41.105
cd /root/naver-proxy
pm2 list                  # naver-proxy + naver-tunnel 상태
pm2 logs naver-proxy      # 프록시 로그
pm2 logs naver-tunnel     # Cloudflare Tunnel 로그
node sync.js              # 수동 동기화 (이번달 1일 ~ 오늘)
tail -f sync.log          # cron 실행 로그
crontab -l                # 등록된 cron 확인
```

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
| 2026-05-06 | 스마트스토어 프록시를 카페24 가상서버로 이전 (사무실 PC 의존 제거) |
| 2026-05-06 | Cloudflare Tunnel로 외부 HTTPS 노출 (인바운드 포트 오픈 불필요) |
| 2026-05-06 | 만냥몰/센스바디/센스토이/리빙온라인1팀 코드/문서 정리 |
| 2026-03-16 | 상품소개서 기능 추가 (카페24 상품 조회 + PPT 다운로드) |
| 2026-03-16 | 스마트스토어 반품 상태코드 RETURNED 추가 |
| 2026-03-16 | orders state 중복 제거 (Map 기반 dedup) |
| 2026-03-16 | 동기화 날짜 범위 KST 기준으로 수정 |
| 2026-03-16 | 주문건수 표시 형식 변경 (전체 N건 중 취소 N건) |
| 2026-03-16 | 스마트스토어 응답 파싱 수정 (data.data.contents) |
| 2026-03-16 | filter/pendingFilter 동기화 문제 수정 |
| 2026-03-13 | 코코엘 스마트스토어 연동 완료 |
| 2026-03-13 | 메뉴 구조 개편 (원가/광고/결산 + 서브탭) |
| 2026-03-13 | 공지사항 게시판 추가 (고정/댓글) |
| 2026-03-13 | 날짜 선택 오늘 이후 비활성화 |
| 2026-03-13 | 사이드바 몰타입 텍스트 색상 개선 |

---

## 대기 중인 작업
- [ ] 상품소개서 디자인 개선
- [ ] 팔레오 / 코코엘 3월 전체 동기화 및 정합성 확인
- [ ] 아프리모 스마트스토어 연동
- [ ] 원가 입력 / 조회 기능 개발
- [ ] 광고 입력 / 현황 조회 기능 개발
