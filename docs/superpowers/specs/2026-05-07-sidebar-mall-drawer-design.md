# 사이드바 Mall Drawer

작성일: 2026-05-07
대상 파일: `src/App.js`
선행 변경: `2026-05-07-brand-first-navigation-design.md`

## 배경

이전 작업으로 본문 상단에 `[자사몰 | 스마트스토어]` 탭과 `[매출 | 광고 | 원가]` 탭이 동시에 노출되는 구조를 갖췄다. 사용자는 단계적 흐름을 원한다: 사이드바에서 브랜드 클릭 → mall 선택 drawer가 옆에 뜸 → mall 클릭 → drawer 닫히고 본문이 풀 너비로 결과 표시.

## 정보 위계 (변경)

```
Brand (사이드바)
  └ [클릭] → Mall Drawer (사이드바 옆 패널, 자사몰 / 스마트스토어)
       └ [클릭] → Body 본문 (full width)
            ├ Header: 브랜드명 + 현재 mall 텍스트
            ├ Main 탭 (매출 / 광고 / 원가)
            └ (매출만) Sub 탭 (주문입력 / 주문조회 / 결산조회)
```

핵심: **본문에서 Mall 탭이 제거됨**. Mall 전환은 사이드바 브랜드 재클릭 → drawer 재오픈 → 다른 mall 선택 경로로만 가능.

## 동작 흐름

1. **로그인 직후**
   - 첫 허용 브랜드 자동 선택 (`currentBrandId` 설정)
   - **Mall drawer 자동 오픈** (그 브랜드의 mall 선택지를 보여줌)
   - 본문은 비어 있거나 placeholder ("쇼핑몰을 선택하세요" 안내)

2. **Drawer에서 mall 클릭**
   - `currentMallType` 갱신
   - Drawer 닫힘
   - 본문이 full width로 콘텐츠 표시

3. **사이드바에서 다른 브랜드 클릭**
   - `currentBrandId` 갱신
   - Drawer 재오픈 (새 브랜드의 mall 선택지)
   - 본문은 mall 재선택 전까지 placeholder 안내

4. **사이드바에서 동일 브랜드 재클릭**
   - Drawer 토글 (열려있으면 닫고, 닫혀있으면 다시 열기)

5. **모바일 (≤768px)**
   - Drawer는 fullscreen modal 형태로 표시 (햄버거 사이드바 옆에 붙는 패널은 좁은 화면에서 어색)
   - Mall 선택 후 modal 닫힘

## Drawer 구조

```
┌────────────────────────┐
│ 팔레오             [✕] │  ← 헤더: 브랜드명 + 닫기
├────────────────────────┤
│                        │
│  🏪 자사몰         🔗 │  ← Mall 옵션 + 동기화 버튼
│                        │
│  🛍️ 스마트스토어   🔗 │
│                        │
└────────────────────────┘
```

- **위치 (데스크탑)**: 사이드바 바로 오른쪽. 너비 ~220px.
- **배경**: 흰색(`#FFFFFF`) 카드 스타일, 사이드바와 시각적으로 구분.
- **닫기 트리거**:
  - 헤더 ✕ 버튼
  - Mall 옵션 클릭
  - 같은 브랜드를 사이드바에서 다시 클릭 (토글)
- **외부 클릭 시 닫기 안 함** (실수 클릭 방지)
- **🔗 동기화 버튼**:
  - 자사몰 옆: 카페24 연동 모달 (`setShowCafe24Modal`)
  - 스마트스토어 옆: 스마트스토어 동기화 모달 (`setShowSmartstoreModal`)
  - 클릭 시 `e.stopPropagation()` 으로 mall 선택 onClick과 분리

## 본문 헤더 (Drawer 닫힘 상태)

기존 (삭제됨):
```
🟢 팔레오
[ 자사몰 | 스마트스토어 ]   ← Mall 탭 (삭제)
[ 매출 | 광고 | 원가 ]
```

변경 후:
```
🟢 팔레오 · 🏪 자사몰        ← 브랜드명 + 현재 mall 텍스트
[ 매출 | 광고 | 원가 ]      ← Main 탭만
[주문입력 | 주문조회 | 결산조회]  (매출 선택시)
```

- 현재 mall 표시는 텍스트로 ("· 🏪 자사몰" 또는 "· 🛍️ 스마트스토어")
- Mall 탭 row 자체가 사라짐
- 미연동 mall 처리는 기존과 동일: 본문 영역에 "준비 중" placeholder

## Mall 미선택 placeholder (drawer 열림 상태)

Drawer가 열려 있고 사용자가 아직 mall을 클릭하지 않은 상태에서 본문은:

```
┌─────────────────────────────────┐
│                                 │
│           👈                    │
│                                 │
│  왼쪽 drawer에서 쇼핑몰을        │
│  선택해주세요                   │
│                                 │
└─────────────────────────────────┘
```

또는 그냥 비어있게 둬도 됨 (drawer가 시각적으로 충분히 강조되니).

**결정: 안내 텍스트 표시** — drawer 위치를 모르는 사용자를 위해 친절한 안내.

## State 변경

### 추가
```js
const [mallDrawerBrandId, setMallDrawerBrandId] = useState(null);
// null = drawer 닫힘
// brandId = 그 브랜드의 mall drawer 열림
```

### 변경된 로직

**사이드바 brand 클릭** (현재):
```js
onClick={() => sidebarOpen && setCurrentBrandId(b.id)}
```

**변경 후**:
```js
onClick={() => {
  if (!sidebarOpen) return;
  setCurrentBrandId(b.id);
  setMallDrawerBrandId(prev => prev === b.id ? null : b.id);
}}
```

**Drawer mall 클릭**:
```js
onClick={() => {
  setCurrentMallType(t);
  setMallDrawerBrandId(null);
}}
```

**Auto-select effect (Task 1 자취)**:
- 첫 brand 자동 선택 시 `setMallDrawerBrandId(visibleBrands[0].id)`도 함께 호출
- 이미 currentMallType은 자사몰로 default → drawer가 뜬 상태에서 사용자가 선택 안 하면 자사몰이 기본값. 이 경우 본문은 "쇼핑몰을 선택하세요" 안내.

**판단**: 사용자가 drawer를 닫는 행동(✕ 또는 mall 선택)을 하기 전까지 본문은 안내 placeholder만 표시. 자동으로 자사몰 콘텐츠를 미리 표시하지 않음.

이를 위한 **drawerHasBeenClosed 플래그가 필요한가?**: 아니. 단순히 `mallDrawerBrandId === null` 이면 닫힘 → 본문 표시. `mallDrawerBrandId !== null` 이면 열림 → "선택해주세요" 표시.

## 영향 범위

### 변경 파일
- `src/App.js` (단일)

### 변경 영역
| 영역 | 변경 |
|------|------|
| State 선언 | `mallDrawerBrandId` 추가 |
| Auto-select effect | drawer도 함께 오픈 처리 |
| 사이드바 brand 클릭 onClick | drawer 토글 로직 추가 |
| Layout: 사이드바 옆 | 새 Drawer 컴포넌트 (inline JSX 또는 함수 컴포넌트) |
| 본문 헤더 | Mall 탭 row 제거 + 헤더에 "· 🏪 자사몰" 텍스트 |
| 본문 placeholder | drawer 열림 상태 안내 추가 |
| 모바일 | drawer를 fullscreen modal로 |

### 변경 없음
- Supabase / 백엔드
- 결산조회 / 주문조회 / 주문입력 비즈니스 로직
- 광고 / 원가 placeholder
- `currentBrandId` / `currentMallType` / `mainTab` / `salesSubTab` state
- Auto-select 첫 brand 로직 (drawer 추가 동작만 보강)

## 비목표

- localStorage로 마지막 선택 기억
- 키보드 단축키 (ESC로 drawer 닫기 등)
- 정교한 drawer 애니메이션 (간단한 CSS transition만)
- 사이드바 collapsed 상태에서의 drawer 동작 (collapsed 시엔 drawer 안 뜨고 사이드바 펼치라고 안내)

## 검증 기준

- [ ] 첫 로그인 시: 첫 브랜드 선택 + drawer 자동 오픈, 본문엔 "쇼핑몰을 선택해주세요" 안내
- [ ] Drawer mall 클릭 → drawer 닫힘, 본문 풀 너비 콘텐츠 표시
- [ ] 본문 헤더에 "🟢 팔레오 · 🏪 자사몰" 텍스트 표시
- [ ] 본문에 [매출 | 광고 | 원가] 탭만 표시 (Mall 탭 없음)
- [ ] 다른 브랜드 클릭 → drawer 재오픈, 본문 다시 안내
- [ ] 같은 브랜드 재클릭 → drawer 토글
- [ ] Drawer 헤더 ✕ 클릭 → drawer 닫힘 (currentMallType는 그대로 유지)
- [ ] 🔗 동기화 버튼 클릭 → 카페24/스마트스토어 모달 정상 오픈, mall 선택은 안 됨
- [ ] 미연동 mall 클릭 → drawer 닫히고 본문에 "준비 중" placeholder
- [ ] 모바일 뷰: drawer가 fullscreen modal로 동작
- [ ] 사이드바 ✏️/🗑️ 편집/삭제 버튼은 brand 선택과 분리 (`stopPropagation`)
