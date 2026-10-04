# PA Insight (가칭)

DART 공시 신호로 **회계·결산 지원(PA) · 내부회계관리제도 · IFRS 18 도입 지원 · 재무자문·구조조정** 제안 후보를 찾는 웹 프로토타입입니다.
코스피·코스닥 상장사 OpenDART 공시를 **기존 수집본(2026-10-04 기준) + 추가 수집** 방식으로 씁니다.

- 공시 데이터: `public/data/` 의 JSON (기존 수집본으로 이미 만들어 둠)
- 로그인·개인 맞춤 저장: Supabase (이메일·비밀번호, 이메일 인증 끔)
- 앱 실행 중에는 OpenDART·LLM API를 부르지 않습니다.

---

## 1. 처음 실행 (Windows PowerShell 기준)

1. Node.js 20 이상이 필요합니다. `node -v` 로 확인하세요.
2. 이 폴더(`C:\Users\yjh51\Desktop\PPP`)에서 의존성을 설치합니다.

   ```powershell
   cd C:\Users\yjh51\Desktop\PPP
   npm install
   ```

3. 화면을 띄웁니다. → 브라우저에서 http://localhost:3000

   ```powershell
   npm run dev
   ```

   Supabase 키가 없어도 **'로그인 없이 둘러보기'** 로 모든 화면을 쓸 수 있습니다.

## 2. `.env` 만들기

`.env.example` 을 복사해 `.env` 를 만들고, 메모장으로 열어 값을 채웁니다. (`.env` 는 깃허브에 올라가지 않습니다)

```powershell
copy .env.example .env
notepad .env
```

| 변수 | 내용 |
| --- | --- |
| `DART_API_KEY` | OpenDART 인증키. 추가 수집에만 씀 |
| `DATA_DIR` | 기존 수집본 폴더 (이미 채워 둠). `npm run data:build` 를 돌리는 사람만 필요 |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 프로젝트 URL과 anon(publishable) 키 |
| `CRON_SECRET` | Vercel 크론 확인용 임의 값 (영문·숫자 20자 이상 아무 문자열) |

`.env` 를 바꾼 뒤에는 `npm run dev` 를 껐다 켜야 반영됩니다.

## 3. 추가 수집 → 데이터 다시 만들기

기존 수집본에 없는 데이터만 더 받습니다. 대상은 `data/universe.json` 의 2,555곳(스팩·리츠·펀드 제외)입니다.
키 1개당 하루 20,000건 한도이며, 다섯 가지를 모두 합쳐 3,000~5,000건 정도입니다.
받은 원본은 `data/raw/` 에 캐시돼서, 중간에 끊겨도 **같은 명령을 다시 실행하면 이어서** 받습니다.

| 순서 | 명령 | 받는 것 | 호출 수(예상) | 풀리는 신호 |
| --- | --- | --- | --- | --- |
| 1 | `npm run collect:fin` | 주요계정 재수집 (연결·별도 전체 계정) | 약 30 | IF1 영업외손익, RS3 자본잠식, IC1 정확화 |
| 2 | `npm run collect:auditor` | 2026 반기 감사인 | 약 2,560 | 현재 감사인(독립성), PA2 확정 |
| 3 | `npm run collect:major` | 주요사항보고서 12개월 | 10~60 | RS1 부도·회생·감자, PA3·IC3에 분할 추가 |
| 4 | `npm run collect:krx` | 거래소공시 12개월 (횡령·배임) | 수백~1,200 | IC2 횡령·배임 |
| 5 | `npm run collect:deadline` | 제출기한 연장신고 (2024~2026년 3/20~4/10) | 수백~1,200 | PA1 연장신고 |

- 감사인 수집을 두 사람이 나누려면: `npm run collect:auditor -- --part 1/2` , `npm run collect:auditor -- --part 2/2` (각자 본인 키)
- 연장신고 제목을 먼저 확인하려면: `npm run collect:deadline -- --probe`

### 여럿이 나눠 받을 때

1. 각자 저장소를 받고 `npm install`, `.env` 에 **본인** OpenDART 키를 넣습니다. 기존 수집본 폴더는 없어도 됩니다.
2. 맡은 명령만 실행합니다. 예) 담당1 `collect:fin`·`collect:major`, 담당2 `collect:auditor -- --part 1/2`·`collect:krx`, 담당3 `collect:auditor -- --part 2/2`·`collect:deadline`
3. `data/extra/` 에 생긴 파일(`*.jsonl`, `*.meta.json`)만 커밋해 올리거나 개발 담당에게 전달합니다. 파일 이름이 서로 달라 충돌하지 않습니다.
4. `npm run data:build` 와 `public/data/` 커밋은 개발 담당 한 사람만 합니다.

수집이 끝나면 화면용 데이터를 다시 만듭니다. (기존 수집본 폴더가 있는 PC에서)

```powershell
npm run data:build
```

신호별 해당 기업 수가 출력됩니다. 추가 수집 전인 신호는 화면에서 '추가 수집 전'으로 비활성 표시됩니다.

## 4. Supabase 설정 (로그인·개인 맞춤)

1. https://supabase.com 에서 무료 프로젝트를 만듭니다. (리전은 가능하면 Seoul)
2. **SQL Editor** 에 `supabase/migrations/001_user_tables.sql` 내용을 붙여 넣고 Run.
3. **Authentication → Sign In / Providers → Email**: 사용 켜기, **Confirm email 끄기**, 최소 비밀번호 8자.
4. **Authentication → Rate Limits**: 로그인·가입 한도를 넉넉히 올립니다. (사내에서 같은 IP로 몰릴 수 있음)
5. **Project Settings → API** 에서 URL과 anon(publishable) 키를 `.env` 에 넣고 `npm run dev` 재시작.

## 5. 깃허브 → Vercel 배포 (Claude Code)

1. Claude Code로 이 폴더를 깃허브 **비공개 저장소**에 올립니다. `.env` 와 `data/raw/` 는 올라가지 않습니다.
   `public/data/` 는 반드시 함께 올립니다. (Vercel에는 기존 수집본 폴더가 없음)
2. Vercel에서 저장소를 Import → Environment Variables에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET` 를 넣고 Deploy.
   **`DART_API_KEY` 는 Vercel에 넣지 않습니다.**
3. Supabase → Authentication → URL Configuration의 Site URL을 Vercel 주소로 바꿉니다.
4. `vercel.json` 의 크론이 하루 한 번 `/api/keepalive` 를 불러 Supabase 일시정지(7일 비활동)를 막습니다.

## 폴더 구조

```text
app/                    화면 (로그인, 대시보드, 추천 목록, 기업 상세, 내 후보·설정) + /api/keepalive
lib/                    점수 계산, 데이터 로딩, Supabase, 개인 맞춤 상태
config/signals.json     신호 정의·기준값·문구 (빌드 스크립트와 화면이 함께 씀)
scripts/build-data.mjs  기존 수집본 + 추가 수집분 → public/data, data/universe.json
scripts/collect/        추가 수집 스크립트 5종
data/universe.json      추가 수집 대상 2,555곳 목록 (data:build가 만듦, 커밋함)
data/extra/             추가 수집 결과 (*.jsonl, *.meta.json, 커밋함)
data/raw/               OpenDART 원본 응답 캐시 (커밋 안 함)
public/data/            화면용 JSON (summary.json, detail/00~99.json)
supabase/migrations/    사용자 테이블 SQL
```

## 자주 막히는 곳

- `DART_API_KEY가 비어 있어요` → `.env` 에 키를 넣었는지, 파일 이름이 `.env.txt` 가 아닌지 확인하세요.
- `020` (하루 한도) → 다음 날 같은 명령을 다시 실행하면 이어서 받습니다.
- 로그인 버튼이 비활성 → `.env` 의 Supabase 값 확인 후 `npm run dev` 재시작.
- 'Confirm email이 켜져 있어요' → Supabase에서 이메일 인증을 끄세요.
