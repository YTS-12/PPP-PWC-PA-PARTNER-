# PA Insight (가칭)

DART 공시 신호로 **회계·결산 지원(PA) · 내부회계관리제도 · IFRS 18 도입 지원 · 재무자문·구조조정** 제안 후보를 찾는 웹 프로토타입입니다.
코스피·코스닥 상장사 OpenDART 공시를 **기존 수집본(2026-10-04 기준) + 추가 수집** 방식으로 씁니다.

- 공시 데이터: `public/data/` 의 JSON (기존 수집본으로 이미 만들어 둠)
- 로그인·개인 맞춤 저장: Supabase (이메일·비밀번호, 이메일 인증 끔)
- 앱 실행 중에는 OpenDART·LLM API를 부르지 않습니다.

---

## 1. 처음 실행 (Windows PowerShell 기준)

1. Node.js 24.x(LTS)가 필요합니다. `node -v` 로 확인하세요(`v24.` 로 시작). Vercel도 `package.json` 의 `engines` 설정(`24.x`)에 따라 같은 버전으로 빌드합니다.
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
| `DART_API_KEY` | OpenDART 인증키(1개). 추가 수집에만 씀 |
| `DATA_DIR` | 기존 수집본 폴더(`08_상장기업전체_웹앱용_기업데이터.json` 이 있는 곳). `.env.example` 에는 값이 비어 있고 예시는 주석에 있으니 직접 채웁니다. 예) `DATA_DIR=C:\Users\yjh51\Desktop\상장기업자료_최종검토본`. `npm run data:build` 에만 필요 |
| `NEXT_PUBLIC_SUPABASE_URL` · `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase 프로젝트 URL과 anon(publishable) 키 |
| `CRON_SECRET` | Vercel 크론 확인용 임의 값 (영문·숫자 20자 이상 아무 문자열) |

`.env` 를 바꾼 뒤에는 `npm run dev` 를 껐다 켜야 반영됩니다. Vercel 환경변수도 바꾼 뒤 다시 배포해야 반영됩니다.

## 3. 추가 수집 → 데이터 다시 만들기

기존 수집본에 없는 데이터만 더 받습니다. 대상은 `data/universe.json` 의 2,555곳(스팩·리츠·펀드 제외)입니다.
이 PC 한 대에서 OpenDART 키 1개로 다섯 가지를 모두 받습니다(2026-10-05 변경).
키 1개당 하루 20,000건 한도이며, 다섯 가지를 모두 합쳐 약 3,400\~5,100건(한도의 17\~26%, 추정)입니다.
받은 원본은 `data/raw/` 에 캐시돼서, 중간에 끊겨도 **같은 명령을 다시 실행하면 이어서** 받습니다.

아래 순서대로, 기본은 옵션 없이 실행합니다.

| 순서 | 명령 | 받는 것 | 호출 수(예상) | 풀리는 신호 |
| --- | --- | --- | --- | --- |
| 1 | `npm run collect:fin` | 주요계정 재수집 (연결·별도 전체 계정) | 약 30 | IF1 영업외손익, RS3 자본잠식, IC1 정확화 |
| 2 | `npm run collect:major` | 주요사항보고서 12개월 | 10~60 | RS1 부도·회생·감자, PA3·IC3에 분할 추가 |
| 3 | `npm run collect:krx` | 거래소공시 12개월 (횡령·배임) | 수백~1,200 | IC2 횡령·배임 |
| 4 | `npm run collect:deadline` | 제출기한 연장신고 (2024\~2026년 3/20\~4/10, 공시유형 전체) | 수백\~1,200 | PA1 연장신고 |
| 5 | `npm run collect:auditor` | 2026 반기 감사인 (2,555곳 한 번에) | 약 2,560 | 현재 감사인(독립성), PA2 확정 |

- **2·3번(major·krx)은 같은 날 끝냅니다.** 조회 종료일이 실행일이라, 다음 날 다시 돌리면 구간이 바뀌어 캐시를 못 쓰고 처음부터 다시 호출합니다. 다음 날 이어받아야 하면 첫 실행일을 넣습니다. 예) `npm run collect:major -- --end 20261005`
- 5번(auditor)이 가장 오래 걸립니다(약 10~25분). 마지막에 돌리고, 그동안 Supabase·배포 작업을 해도 됩니다.

각 단계에서 볼 출력입니다. 모든 명령은 마지막에 `[이름] 새 호출 N건 · 캐시 N건 · 정상 N · 데이터 없음 N · 기타 N` 을 출력합니다.

1. `collect:fin` — `완료: N/2555곳, 레코드 N건` 과 `참고(매칭 안 된 계정명 상위)`. 자본금·세전이익 변형이 보이면 `scripts/collect/fin.mjs` 계정 규칙에 추가합니다.
2. `collect:major` — 구간·시장별 건수와 `완료: 대상 기업 주요사항보고서 N건`.
3. `collect:krx` — `완료: 거래소공시 N건 중 횡령·배임 N건` 과 `제목 예:` 최대 10개. 횡령·배임 표기가 잡히는지 봅니다.
4. `collect:deadline` — 연도·시장별 `N건 확인` 과 `완료: 연장신고 N건`. 공시검색 응답에는 공시유형 필드가 없어 유형으로 좁힐 수 없으니, 옵션 없이 유형 전체·3개년으로 받습니다. '연장'이 들어간 실제 제목 목록은 `npm run collect:deadline -- --probe` 로 확인합니다. 이미 받은 응답은 캐시라 새 호출이 거의 없고, 연장신고가 0건이면 옵션 없이도 이 목록을 출력합니다.
5. `collect:auditor` — 200곳마다 `N/2555곳 처리`, 끝에 `완료: 감사인 확인 N/2555곳`.

### 여럿이 나눠 받을 때 (선택)

키가 여러 개라 나눠 받고 싶을 때만 씁니다. 감사인은 `npm run collect:auditor -- --part 1/2`, `-- --part 2/2` 로 나눌 수 있고, 결과는 `data/extra/` 에 명령·파트마다 다른 파일로 생겨 충돌하지 않습니다. 다른 사람은 결과 파일만 전달하고, `data:build`·커밋·푸시는 저장소 주인 한 사람만 합니다(Vercel Hobby는 비공개 저장소에서 다른 사람의 커밋을 배포하지 않음).

수집이 끝나면 화면용 데이터를 다시 만듭니다. (`.env` 에 `DATA_DIR` 를 채운 PC에서)

```powershell
npm run data:build
```

신호별 해당 기업 수가 출력됩니다. 추가 수집 전인 신호는 화면에서 '추가 수집 전'으로 비활성 표시됩니다. 만든 뒤 `data/extra/` 와 `public/data/` 를 함께 커밋·푸시하면 Vercel이 다시 배포합니다.

## 4. Supabase 설정 (로그인·개인 맞춤)

Vercel 첫 배포 전에 끝내 URL과 anon 키를 확보해 둡니다.

1. https://supabase.com 에서 무료 프로젝트를 만듭니다. (리전은 가능하면 Seoul)
2. **SQL Editor** 에 `supabase/migrations/001_user_tables.sql` 내용을 붙여 넣고 Run.
3. **Authentication → Sign In / Providers → Email**: 사용 켜기, **Confirm email 끄기**, 최소 비밀번호 8자.
4. **Authentication → Rate Limits**: 로그인·가입 한도를 넉넉히 올립니다. (사내에서 같은 IP로 몰릴 수 있음)
5. **Project Settings → API** 에서 URL과 anon(publishable) 키를 `.env` 에 넣고 `npm run dev` 재시작.

## 5. 깃허브 → Vercel 배포 (Claude Code)

추가 수집을 기다리지 않고 기존 수집본 데이터로 먼저 배포한 뒤, 추가 수집분을 푸시해 다시 배포합니다.

1. 깃허브 웹에서 개인 계정에 **비공개 저장소**를 만듭니다. README·.gitignore·license는 모두 체크하지 않은 빈 저장소로 만들고, 기본 브랜치는 `main` 입니다.
   팀원은 초대하지 않습니다. (Vercel Hobby는 비공개 저장소 협업을 지원하지 않음)
2. 커밋 작성자 이메일을 그 깃허브 계정에 **인증된 이메일**로 설정합니다. 커밋 작성자가 Vercel에 연결한 깃허브 계정 본인이어야 배포됩니다.

   ```powershell
   git config user.name "<깃허브 사용자명>"
   git config user.email "<깃허브 계정에 인증된 이메일>"
   ```

3. Claude Code로 이 폴더를 그 저장소의 `main` 에 올립니다. `.env` 와 `data/raw/` 는 올라가지 않습니다.
   `public/data/` 와 `data/universe.json` 은 반드시 함께 올립니다. (Vercel에는 기존 수집본 폴더가 없음)
4. Vercel에서 저장소를 Import → Import 화면의 Environment Variables에 `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `CRON_SECRET` 3개를 넣고 첫 Deploy.
   **`DART_API_KEY` 는 Vercel에 넣지 않습니다.** 환경변수는 `NEXT_PUBLIC_` 값을 포함해 모두, 바꾼 뒤 다시 배포(Redeploy)해야 반영됩니다.
5. Supabase → Authentication → URL Configuration의 Site URL을 Vercel 주소로 바꿉니다.
6. 배포 주소에서 5개 화면·로그인·저장을 확인하고, keepalive가 동작하는지 봅니다. Vercel → Settings → Cron Jobs 에서 Run을 누르거나, 아래처럼 헤더를 붙여 불러 본문에 `"ok":true` 가 있으면 됩니다.

   ```powershell
   curl.exe -H "Authorization: Bearer <CRON_SECRET 값>" https://<배포 주소>/api/keepalive
   ```

   브라우저로 그냥 열면 401이 정상입니다. 503은 Vercel에 Supabase 환경변수나 `CRON_SECRET`이 없음, 502는 Supabase 응답 실패(일시정지 등)입니다.
7. 추가 수집이 끝나면 `npm run data:build` → `data/extra/`·`public/data/` 커밋·푸시로 다시 배포합니다.

배포 설정은 저장소에 들어 있습니다.

- `vercel.json`: 하루 한 번(UTC 0시 = 한국 오전 9시) `/api/keepalive` 를 부르는 크론으로 Supabase 일시정지(7일 비활동)를 막고, `regions: ["icn1"]` 로 함수를 서울 리전에서 돌립니다.
- `package.json`: `engines.node` 가 `24.x` 라 Vercel도 Node.js 24로 빌드합니다.
- 모든 페이지에 robots `noindex` 를 붙여 검색에 노출되지 않습니다.

10/30까지는 2026-10-12 · 2026-10-19 · 2026-10-26에 접속·로그인·저장을 확인합니다. Hobby는 런타임 로그를 1시간만 보관하므로, 크론이 돌았는지는 Supabase 대시보드(Paused 상태가 아닌지, API 요청이 매일 있는지)로 봅니다.

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
- `020` (하루 한도) → 다음 날 같은 명령을 다시 실행하면 이어서 받습니다. `collect:major`·`collect:krx` 는 `-- --end <첫 실행일>` 을 붙여야 캐시를 씁니다.
- 로그인 버튼이 비활성 → `.env` 의 Supabase 값 확인 후 `npm run dev` 재시작. 배포 주소에서 그렇다면 Vercel 환경변수 확인 후 다시 배포.
- 'Confirm email이 켜져 있어요' → Supabase에서 이메일 인증을 끄세요.
- 푸시했는데 Vercel이 배포하지 않음 → 커밋 작성자 이메일(`git config user.email`)이 Vercel에 연결한 깃허브 계정의 인증된 이메일인지 확인하세요.
- `npm audit` 경고가 나와도 `npm audit fix --force` 는 하지 않습니다. (Next 16으로 올라가 호환성이 깨짐)
