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
│   ├── smartstore.js                   # 스마트스토어 API (브랜드별 분기)
│   └── pptx.js                         # 상품소개서 PPT 생성 (서버사이드)
└── README.md

C:\Users\Jangkwon\Desktop\order-manager\  ← 사무실 PC 로컬 실행용
├── naver-proxy.js                      # 스마트스토어 로컬 프록시 (브랜드별 자격증명 분기)
├── sync-smartstore-auto.js             # 스마트스토어 자동 동기화 스크립트 (팔레오+코코엘)
├── 네이버프록시_실행.bat                # 프록시 수동 실행용
└── 스마트스토어_자동동기화.bat          # 작업스케줄러 등록 (08:00, 16:00)
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

## 환경변수 (Vercel)

```
CAFE24_CLIENT_ID / CAFE24_CLIENT_SECRET / CAFE24_REDIRECT_URI   # paleo 기본
CAFE24_CLIENT_ID_AFRIMO / CAFE24_CLIENT_SECRET_AFRIMO
CAFE24_CLIENT_ID_COCOEL / CAFE24_CLIENT_SECRET_COCOEL
SMARTSTORE_APP_ID / SMARTSTORE_APP_SECRET                       # 팔레오
SMARTSTORE_APP_ID_COCOEL / SMARTSTORE_APP_SECRET_COCOEL         # 코코엘
REACT_APP_SUPABASE_URL / REACT_APP_SUPABASE_ANON_KEY
REACT_APP_CAFE24_CLIENT_ID
REACT_APP_CAFE24_CLIENT_ID_AFRIMO
REACT_APP_CAFE24_CLIENT_ID_COCOEL
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
- 네이버 API 고정 IP 정책 → 사무실 로컬 프록시 경유
- 로컬 프록시: `naver-proxy.js` (localhost:3001)
- 브랜드별 자격증명 분기: URL 파라미터 `brandId`로 팔레오/코코엘 구분
- 응답 구조: `data.data.contents[]` → `item.content.order` / `item.content.productOrder`
- 취소/반품 상태코드: `CANCEL_DONE`, `RETURN_DONE`, `RETURNED`, `EXCHANGE_DONE` 등

**프록시 토큰 테스트**
- 팔레오: http://localhost:3001/token
- 코코엘: http://localhost:3001/token?brandId=0a37b281-f262-4402-979c-e63a739bee53

**자동 동기화**: Windows 작업스케줄러 매일 08:00, 16:00 (팔레오 + 코코엘)

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
- 사무실 내 모든 PC/맥북 동시 접속 가능 (고정 IP 공유)
- `naver-proxy.js` 창이 열려있어야 수동 동기화 가능
- Windows 작업스케줄러가 bat 파일 자동 실행 (경로: 바탕화면/order-manager/)

---

## 변경 이력

| 날짜 | 내용 |
|------|------|
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
