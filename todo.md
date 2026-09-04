# DISHOUSE — TODO

> 기획서 `DISHOUSE_홈페이지_개발기획서.md` 기반. MVP 우선, 이후 확장 분리.

## 진행 규칙
- [ ] 완료 시 체크, PR/커밋에 `fixes #` 명시
- MVP 완료 후 `나중에 구현` 착수

---

## Phase 0 — 프로젝트 셋업

- [ ] 0-1 프레임워크 결정: Next.js (App Router) + ESM 확정
- [ ] 0-2 모노레포 설정: `04_dishouse/` 패키지 초기화 (`package.json`, `.env.example`, `.gitignore`)
- [ ] 0-3 기술 스택 확정: 2D 렌더러 (Phaser vs Canvas 자체구현) 비교 후 결정
- [ ] 0-4 DB 결정: PostgreSQL / Supabase 중 택1, 마이그레이션 도구 선택
- [ ] 0-5 공통 상수 정리: `DISCORD_CLIENT_ID=1516064597638123730`, `ADMIN_USER_ID=1269575955626725390` 환경변수화
- [ ] 0-6 개발 스크립트: `dev`, `build`, `start` 동작 확인
- [ ] 0-7 README / AGENTS.md 작성 (04_dishouse 전용)

검증: `npm run dev` 로컬 기동, 빈 페이지 렌더

---

## Phase 1 — Discord 로그인 (OAuth2)

- [ ] 1-1 Discord Application OAuth2 설정 (redirect URI, scope: `identify guilds`)
  - env: `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_REDIRECT_URI`, `DISCORD_GUILD_ID`, `DISCORD_BOT_TOKEN`
- [ ] 1-2 로그인 플로우 구현: `/api/auth/login` → Discord → `/api/auth/callback`
- [ ] 1-3 세션/토큰 관리: httpOnly cookie or JWT, 서버에서만 Bot Token/OAuth secret 보관
- [ ] 1-4 유저 정보 조회: `discord_id`, `username`, `display_name`, `avatar_url` 저장/캐시
- [ ] 1-5 길드 가입 여부 검증: `GET /users/@me/guilds` 또는 bot `GET /guilds/{guild.id}/members/{user.id}` 로 확인
- [ ] 1-6 역할/권한 조회: 관리자 여부 판별 (Administrator 또는 특정 역할)
- [ ] 1-7 비로그인 상태 UI: 메인에서 로그인 버튼만 노출, 집 진입 차단
- [ ] 1-8 로그아웃 처리

검증: 비가입자는 진입 차단, 가입자는 캐릭터로 입장 로그 확인

---

## Phase 2 — DB & 방(Room) 모델

- [ ] 2-1 `rooms` 테이블 설계
  ```sql
  id TEXT PK -- living, bedroom, kitchen, room1, room2, bathroom
  name TEXT -- 거실, 침실, 주방, 방1, 방2, 화장실
  channel_id TEXT NULL -- Discord Channel ID (이름 아님)
  position JSONB -- 맵 좌표/크기/문 위치 등
  created_at / updated_at
  ```
- [ ] 2-2 `users` 테이블 설계 (필요시)
  ```
  discord_id PK, display_name, avatar_url, last_position JSONB, last_seen
  ```
- [ ] 2-3 초기 6개 방 seed 데이터 삽입 (거실/침실/주방/방1/방2/화장실)
- [ ] 2-4 마이그레이션 스크립트 작성 및 실행 확인

검증: DB에서 Channel ID 기준으로 조회, 채널명 변경 시에도 연결 유지

---

## Phase 3 — 2D 집 & 캐릭터 이동

- [ ] 3-1 Top-down 맵 레이아웃 설계: 6개 방 배치, 벽/충돌 영역 정의
- [ ] 3-2 2D 렌더러 구현: Phaser 또는 Canvas — 맵 타일/배경 렌더
- [ ] 3-3 캐릭터 이동: 방향키/WASD, 충돌 판정, 부드러운 보간 (lerp)
- [ ] 3-4 방 이동 연출: 문 통과 시 자연스러운 전환 (순간이동 버튼 금지)
- [ ] 3-5 카메라/뷰포트: 캐릭터 추적, 집이 화면 중심이 되도록 레이아웃
- [ ] 3-6 모바일 입력: 가상 조이스틱 또는 터치 이동 (최소 접근성)
- [ ] 3-7 현재 방 판정 로직: 캐릭터 좌표 → `roomId` 계산, 상태 공유

검증: 키보드로 6개 방 모두 이동 가능, 벽 뚫림 없음

---

## Phase 4 — 캐릭터 (Discord Avatar 기반)

- [ ] 4-1 캐릭터 스프라이트: 공통 몸통(픽셀 캐릭터) + 머리=Discord Avatar 합성
- [ ] 4-2 Avatar 처리: 원형 클립, 리사이징/캐싱, fallback(기본 이미지)
- [ ] 4-3 닉네임 표시: 캐릭터 위에 `display_name` 렌더
- [ ] 4-4 본인/타인 구분 스타일 (선택)
- [ ] 4-5 프로필 카드: hover 시 미니 카드 (프사, 이름, 온라인 상태, 현재 위치) — 과하지 않게

검증: 프사가 머리 부분에 자연스럽게 합성되어 작은 화면에서도 선명

---

## Phase 5 — 실시간 동기화 (WebSocket)

- [ ] 5-1 WebSocket 서버 구축: Next.js Route Handler / 별도 Node 서버 / Socket.IO 중 택1
- [ ] 5-2 인증 연동: WS 연결 시 세션 검증 (비로그인 거부)
- [ ] 5-3 위치 동기화: `client → server → other clients` 브로드캐스트 (throttle ~ 20fps, DB 저장 안 함)
- [ ] 5-4 접속/퇴장 이벤트: 입장/퇴장 시 주변 클라이언트에 알림
- [ ] 5-5 재연결/끊김 처리: 네트워크 단절 시 UI 상태 표시, 자동 재연결
- [ ] 5-6 마지막 위치만 DB 저장 (선택, 매 프레임 저장 금지)

검증: 2개 브라우저로 동시 접속 시 서로의 이동이 실시간 반영

---

## Phase 6 — 방별 채팅 & 말풍선

- [ ] 6-1 채팅 입력 UI: 하단 입력창, 연결 안 된 방에서는 비활성화 + 안내 문구
- [ ] 6-2 현재 방 → 채널 매핑: `roomId → channel_id` 조회 로직
- [ ] 6-3 홈페이지 → Discord: 입력 → Backend → `channel_id` 확인 → Discord API로 메시지 전송 → WS broadcast
- [ ] 6-4 Discord → 홈페이지: Bot `messageCreate` 수신 → `channel_id`로 room 역조회 → 해당 room 유저에게 WS 전송 → 말풍선 표시
- [ ] 6-5 말풍선 UI: 캐릭터 위에 표시, 일정 시간 후 자동 소멸, 긴 메시지 줄바꿈/자르기
- [ ] 6-6 채팅 기록 UI: 방별 최근 메시지 리스트 (별도 패널)
- [ ] 6-7 보안: Bot Token 절대 클라이언트 노출 금지, 메시지 전송은 서버 경유

검증: 홈페이지에서 친 메시지 Discord 채널에 노출 / Discord 메시지 홈페이지 말풍선에 노출

---

## Phase 7 — Discord Bot & 슬래시 명령어

- [ ] 7-1 Bot 셋업: `discord.js` 기반, intents `Guilds`, `GuildMessages`, `MessageContent` (필요시)
- [ ] 7-2 `/채널지정` 명령어: `/채널지정 (방이름) (채널)` — 방 enum (거실/침실/주방/방1/방2/화장실), Channel ID 저장
- [ ] 7-3 권한 체크: Administrator / ManageGuild / 특정 역할만 실행 가능
- [ ] 7-4 `/채널정보` 명령어: 전체 방-채널 매핑 embed 출력
- [ ] 7-5 `/채널초기화` 명령어: 특정 방 연결 해제 (NULL 처리)
- [ ] 7-6 명령어 배포 스크립트: `deploy-commands.js`
- [ ] 7-7 에러 처리: 존재하지 않는 방, 채널 타입 불일치 등

검증: Discord에서 `/채널지정 거실 #일반` 실행 시 DB `channel_id` 갱신, 재기동 후에도 유지

---

## Phase 8 — 접속자 현황 & UI/UX

- [ ] 8-1 현재 접속자 수 표시: `● N명 온라인` (우상단 등)
- [ ] 8-2 클릭 시 방별 인원 breakdown: 거실 5명, 침실 1명 ... (초기엔 간단 표시만)
- [ ] 8-3 전체 레이아웃: DISHOUSE 헤더, 2D 집 중심, 채팅 입력창 하단 고정 — 대시보드 느낌 금지
- [ ] 8-4 게임+웹 중간 톤 디자인: 간결, 이쁨, UI가 집 가리지 않음
- [ ] 8-5 빈 방 처리: 연결 안 된 방은 `아직 연결된 채널이 없습니다` + 입력창 숨김/비활성화
- [ ] 8-6 반응형: 데스크탑 우선, 모바일 최소 접근성 확보
- [ ] 8-7 로딩/에러/오프라인 상태 UI

검증: 기획서 11장 예시 화면과 유사한 시각적 균형, Lighthouse/수동 QA

---

## Phase 9 — 보안 · 배포 · 운영

- [ ] 9-1 환경변수 분리: `.env` / `.env.example` 작성, Token 절대 커밋 금지
- [ ] 9-2 서버 권한 검증: 홈페이지에서도 길드 가입/권한 재검증 (클라 우회 방지)
- [ ] 9-3 Rate limiting: 채팅 스팸 방지
- [ ] 9-4 로그/모니터링: Bot/WebSocket 에러 로깅
- [ ] 9-5 배포: Vercel/자체 서버 등 타겟 결정, Bot 상시 실행 보장
- [ ] 9-6 문서화: 설치/실행/환경변수 가이드

검증: 프로덕션에서 OAuth, Bot, WS, DB 모두 정상 동작

---

## 나중에 구현 (MVP 이후)

- [ ] 음성채널 연동
- [ ] 캐릭터 의상 / 펫
- [ ] 집 꾸미기
- [ ] 방 잠금 / 방 이름 변경
- [ ] 시즌별 테마
- [ ] 개인 상태 메시지
- [ ] 프로필 카드 고도화
- [ ] 애니메이션/이펙트 강화

---

## MVP 완료 정의 (필수 체크리스트)

- [ ] Discord 로그인 및 서버 가입 확인
- [ ] 6개 방 2D 집 + 캐릭터 이동 (문 통과 연출)
- [ ] Avatar 기반 캐릭터 + 닉네임 표시
- [ ] 방 ↔ Channel ID 연결 + `/채널지정`
- [ ] 홈페이지 ↔ Discord 양방향 메시지
- [ ] WebSocket 실시간 위치/채팅 동기화 + 말풍선
- [ ] 접속자 표시 + 간결한 UI

---

## 다음 액션 (제안)

1. Phase 0-1 ~ 0-4 결정 후 `npm create next-app` 스캐폴딩
2. Supabase vs 로컬 Postgres 확정
3. Discord Application 생성 및 OAuth/Bot Token 발급 — 필요하면 같이 진행
