# PA Insight — Claude Code 공통 규칙

## 프로젝트
- Next.js 15 (App Router, TypeScript) + Supabase(Auth와 사용자 테이블 4개만) + Vercel Hobby.
- 공시 데이터는 DB가 아니라 `public/data/*.json` 정적 파일로 제공한다. 만드는 곳은 `scripts/build-data.mjs` 하나다.
- 데이터 흐름: 기존 수집본(`DATA_DIR`) + 추가 수집분(`data/extra/*.jsonl`) → `npm run data:build` → `public/data`.
- 추가 수집 대상은 `data/universe.json`(2,555곳)이다. 이 파일과 `public/data`는 `data:build`로만 만들고 손으로 고치지 않는다.
- 추가 수집 결과는 명령마다 다른 파일(`*.jsonl`, `*.meta.json`)로 남겨 여러 사람이 커밋해도 충돌하지 않게 한다.
- 설계서는 `docs/design.md`다. 파일·필드 이름은 설계서를 따르고, 바꿔야 하면 설계서를 먼저 고친다.

## 지켜야 할 것
- 비밀 키(`DART_API_KEY`, Supabase service_role 등)를 코드·커밋·`NEXT_PUBLIC_` 변수에 넣지 않는다. `.env`와 `data/raw/`는 커밋하지 않는다.
- 앱 실행 중에 OpenDART나 LLM API를 호출하지 않는다. OpenDART는 `scripts/collect/`에서만 부른다.
- 신호 이름·기준값·문구는 `config/signals.json`에서만 고친다. 화면과 스크립트에 따로 정의하지 않는다.
- 공시 데이터에서 쓰지 않는 항목: 감사시간 초과, 감사보고서 강조사항, 감사 전 재무제표 미제출. 다시 넣지 않는다.
- 대표자명은 공시된 기업개황 정보로 적재·표시한다. 담당자 개인 연락처, 법인·사업자등록번호는 수집하지 않는다.
- 독립성: 현재 감사인이 삼일회계법인이면 목록에서 기본 숨김, 상세 화면에 경고. 문구는 '추정'·'가능'으로 쓰고 용역 수요를 단정하지 않는다.
- 금액은 원 단위 정수로 저장하고 화면에서 조·억으로 바꾼다. 외화 재무는 규모 기준 신호에서 빼고 이유를 표시한다.
- 스팩(이름에 '스팩')과 리츠·인프라펀드(instrument_type RT·IF·MF)는 추천 대상에서 뺀다.

## 자주 쓰는 명령
- `npm run dev` 로컬 실행 / `npm run build` 배포 빌드 확인
- `npm run data:build` 화면용 데이터 다시 만들기
- `npm run collect:fin | collect:auditor | collect:major | collect:krx | collect:deadline` 추가 수집
