// 추가 수집 2: 2026 반기보고서의 감사인 (현재 감사인 · 주기적 지정 판정 보완)
// 사용: npm run collect:auditor                 (전체를 한 사람이)
//       npm run collect:auditor -- --part 1/2   (두 사람이 나눠서: 1/2, 2/2)
// 결과: data/extra/auditor_2026h1.part<k>of<n>.jsonl, data/extra/auditor2026_part<k>of<n>.meta.json
// 현재 행: 기간 표기 '제N기'의 N이 가장 큰 행(같은 기면 당기·당반기 행 먼저). 그 행이 당기·당반기 표기가 아니고
//   당기·당반기로 적힌 행이 따로 있으면(기수 없는 '당반기' 포함) 그 행을 쓴다. 현재 행의 감사인 칸이 감사인 이름
//   ('회계'·'감사반'·대형·외국계 법인 이름 포함)이 아니면 auditor_raw를 비워 둔다 → data:build가 2025 사업보고서 감사인을 쓴다.
//   전기 행으로 대신하지 않는다. 당기·당반기 행이 하나도 없고 가장 큰 기 행이 모두 전기·전전기로 적혀 있으면
//   ('제18기(전기) 삼일 | 제17기(전전기) 신우') 현재 행이 없다고 보고 auditor_raw를 비우고 invalid_raw에 '당반기 행 없음'을 남긴다.
// 저장하지 않고 멈추는 경우: 응답 상태가 000·013이 아닌 요청이 있을 때.
//   받은 응답은 data/raw에 캐시돼서 같은 명령을 다시 실행하면 받은 곳은 새로 호출하지 않아요.
import path from 'node:path';
import { arg, missingValue, loadUniverse, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, assertNoIssues, runCollector, DartFatal } from '../lib/dart.mjs';

const YEAR = arg('--year', '2026');
const PART = arg('--part', '1/1');
const REPRT = '11012'; // 반기보고서

const squash = (s) => String(s ?? '').replace(/\s+/g, '');

// 감사인 이름처럼 보이는지 (build-data.mjs의 looksLikeAuditor와 같은 결과): 공백을 지운 뒤
// '회계'(오타 '회게'·'화계'·'…계법인' 포함)·'감사반'이나 대형·외국계 법인 이름이 있으면 감사인으로 본다
// ('신한회계겁인'·'삼화화계법인'·'우리계법인'·'삼정KPMG'·'안진'도 받음). 'EY'는 대문자이고 앞이 영문이 아닐 때만('money' 제외).
// 감사의견('적정'·'한정'·'부적정'·'의견거절')·문서명('감사보고서'·'연결감사보고서')·'해당사항없음'·'-'는 감사인이 아니다
// ('제67기'처럼 기간이 들어간 값도 위 이름이 없어 걸러진다)
const NOT_AUDITOR = new Set(['적정', '한정', '부적정', '의견거절', '감사보고서', '연결감사보고서', '해당사항없음', '해당없음', '-']);
const AUDITOR_RE = /회계|회게|화계|계법인|감사반|삼일|삼정|안진|한영|이촌|딜로이트|KPMG|Deloitte|PwC|(^|[^A-Za-z])EY/;
export const looksLikeAuditor = (s) => {
  const t = squash(s);
  return !NOT_AUDITOR.has(t) && AUDITOR_RE.test(t);
};

/** 기수: '제22기 (당기)'·'제 69 기(당 기)'·'제25(당기)'·'2025년 (제58기)' → 22·69·25·58, '23기(당기)' → 23. 없으면 null */
export function termNo(label) {
  const s = squash(label);
  const m = s.match(/제(\d+)/) || s.match(/^(\d+)기/);
  return m ? Number(m[1]) : null;
}

/** 기수가 없을 때 쓰는 연도: 'FY2026 (당기)'·'2026년 반기' → 2026. 없으면 null */
function yearNo(label) {
  const m = squash(label).match(/(?:19|20)\d{2}/);
  return m ? Number(m[0]) : null;
}

/** 기간 표기 구분: 'cur'(당기·당반기·당분기·(당)기) · 'past'(전기·전전기·(전)기) · ''(표기 없음). 공백은 지우고 본다('당 기') */
function periodKind(label) {
  const s = squash(label);
  if (/전전|전기|\(전\)|전반기|전분기|직전/.test(s)) return 'past';
  if (/당기|당반기|당분기|\(당\)/.test(s)) return 'cur';
  return '';
}

/** 기수(n)가 있는 행이 하나라도 있으면 기수가 가장 큰 행들, 없으면 연도(y)가 가장 큰 행들. 둘 다 없으면 null */
function topRows(arr) {
  for (const key of ['n', 'y']) {
    const has = arr.filter((x) => x[key] != null);
    if (!has.length) continue;
    const top = Math.max(...has.map((x) => x[key]));
    return has.filter((x) => x[key] === top);
  }
  return null;
}

/**
 * 현재 행 후보 고르기. 반환: { rows: 현재 행 후보(앞쪽 우선), conflict, missing?, top? }
 * - 기수(없으면 연도)가 가장 큰 행들 가운데 당기·당반기 행이 있으면 그 행들을 먼저, 표기 없는 행을 뒤에 둔다
 *   (같은 기의 전기 행은 뺀다: '제1기(전기) | 제1기 반기(당반기)' → 당반기 행)
 * - 가장 큰 행들에 당기·당반기 행이 없는데 당기·당반기로 적힌 행이 따로 있으면 conflict=true 로 두고
 *   · 기수·연도가 없는 당기·당반기 행('당반기')이 있으면 그 행을 쓴다('당반기 | 제57기(전기)')
 *   · 가장 큰 행들이 모두 전기·전전기·직전으로 적혀 있으면 당기·당반기 행 중 가장 큰 행을 쓴다
 *     (합병·분할로 기수가 다시 시작된 회사: '제2기(당기) | 제1기(전기) | 제15기(전전기)')
 *   · 그 밖에는(가장 큰 행이 표기 없음) 가장 큰 행을 그대로 쓴다. 옛 행에 남은 '(당기)'로 지난해 감사인을 고르지 않게
 *     ('제58기 반기 | 제57기(당기)' → 제58기)
 * - 당기·당반기 행이 하나도 없으면 가장 큰 행들 중 전기 표기가 아닌 행('제58기 반기'처럼 표기 없음).
 *   가장 큰 행들이 모두 전기·전전기로 적혀 있으면 현재 행이 없다(missing=true, rows=[]):
 *   '제18기(전기) 삼일 | 제17기(전전기) 신우'에서 전기 감사인을 현재 감사인으로 고르지 않게.
 *   기수·연도가 모두 없으면 전기 표기가 아닌 첫 행, 모두 전기 표기면 현재 행 없음
 */
function currentRows(info) {
  const isCur = (x) => x.kind === 'cur';
  const curAll = info.filter(isCur);
  const top = topRows(info);
  if (top && top.some(isCur)) return { rows: [...top.filter(isCur), ...top.filter((x) => x.kind === '')], conflict: false };
  if (curAll.length) {
    if (!top) return { rows: curAll, conflict: false };
    const bare = curAll.filter((x) => x.n == null && x.y == null);
    if (bare.length) return { rows: bare, conflict: true };
    if (top.every((x) => x.kind === 'past')) return { rows: topRows(curAll) || curAll, conflict: true };
    return { rows: top, conflict: true };
  }
  // 당기·당반기 행이 하나도 없음: 전기 표기가 아닌 행만 현재 행으로 본다
  const notPast = (top || info).filter((x) => x.kind !== 'past');
  if (!notPast.length) return { rows: [], conflict: false, missing: true, top: top || info };
  return { rows: top ? notPast : [notPast[0]], conflict: false };
}

// 현재 행(당기·당반기)이 응답에 없을 때 invalid_raw에 남기는 값
const NO_CURRENT_ROW = '당반기 행 없음';

/**
 * 감사인 응답 list에서 현재 행을 골라 감사인을 정한다.
 * 1) 기수(제N기의 N)가 가장 큰 행이 현재 행 (옛 기수 행이 먼저 와도, 당기 행이 여럿이어도 같음).
 *    기수가 없으면 연도(FY2026·2026년)가 가장 큰 행, 그것도 없으면 '당기'(공백 제거) 행, 그것도 없으면 전기 표기가 아닌 첫 행.
 *    같은 기 행이 여럿이면 당기·당반기 행을 먼저 본다. 가장 큰 기 행이 당기·당반기 표기가 아니고 당기·당반기로
 *    적힌 행이 따로 있으면 그 행을 쓰고 conflict=true (자세한 규칙은 currentRows)
 * 2) 현재 행의 감사인 칸이 감사인 이름이면 채택, 아니면 auditor_raw=''로 두고 버린 원문을 invalid_raw에 남긴다.
 *    전기 행 감사인으로 대신하지 않는다. 현재 행이 여럿이면 앞쪽부터 보아 감사인 이름인 첫 값을 쓴다.
 * 3) 당기·당반기 행이 없고 가장 큰 기 행이 모두 전기·전전기면 현재 행이 없다: auditor_raw='',
 *    invalid_raw='당반기 행 없음', noCurrent=true. period_label에는 확인용으로 가장 큰 기 행의 표기(예: '제18기 (전기)')를 남긴다.
 * 반환: { auditor_raw, invalid_raw, period_label, rcept_no, conflict, multi, noCurrent } · list가 비면 null
 */
export function pickCurrent(list) {
  const rows = (Array.isArray(list) ? list : []).filter((r) => r && typeof r === 'object');
  if (!rows.length) return null;
  const info = rows.map((r) => ({ r, n: termNo(r.bsns_year), y: yearNo(r.bsns_year), kind: periodKind(r.bsns_year) }));
  const picked = currentRows(info);
  if (picked.missing) {
    const head = picked.top[0].r;
    return {
      auditor_raw: '',
      invalid_raw: NO_CURRENT_ROW,
      period_label: String(head.bsns_year ?? '').trim(),
      rcept_no: head.rcept_no || rows.find((r) => r.rcept_no)?.rcept_no || '',
      conflict: false,
      multi: false,
      noCurrent: true, // 당기·당반기 행 없이 전기·전전기 행만 있음 → 감사인을 비워 둠
    };
  }
  const cur = picked.rows.map((x) => x.r);
  const adtor = (r) => String(r.adtor ?? '').trim();
  const ok = cur.find((r) => looksLikeAuditor(adtor(r)));
  const chosen = ok || cur[0];
  const dropped = [...new Set(cur.map(adtor).filter((v) => v && !looksLikeAuditor(v)))];
  const names = new Set(cur.map(adtor).filter(looksLikeAuditor).map(squash));
  return {
    auditor_raw: ok ? adtor(ok) : '',
    invalid_raw: ok ? '' : dropped.join(' / '),
    period_label: String(chosen.bsns_year ?? '').trim(),
    rcept_no: chosen.rcept_no || cur.find((r) => r.rcept_no)?.rcept_no || rows.find((r) => r.rcept_no)?.rcept_no || '',
    conflict: picked.conflict, // 기수와 당기·전기 표기가 어긋나 당기 표기 행을 씀
    multi: names.size > 1, // 같은 기에 서로 다른 감사인 이름이 둘 이상 (첫 값을 씀)
    noCurrent: false,
  };
}

/** --part 'k/n' 검사: 1 ≤ k ≤ n 정수 */
function parsePart(s) {
  const m = /^(\d+)\/(\d+)$/.exec(String(s).trim());
  const k = m ? Number(m[1]) : NaN;
  const n = m ? Number(m[2]) : NaN;
  if (!m || k < 1 || k > n) {
    throw new DartFatal(`--part 값이 잘못됐어요(${s}). 1/2·2/2처럼 k/n(1 ≤ k ≤ n 정수)으로 적어 주세요.`);
  }
  return [k, n];
}

const fmtCounts = (m, top = 10) =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ');

async function main() {
  // 값 없이 준 플래그(--part --year 2026 등)는 기본값으로 바뀌어 모르는 사이 다른 범위를 받게 되니 먼저 멈춘다
  for (const [flag, ex] of [['--part', '1/2'], ['--year', '2026']]) {
    if (missingValue(flag)) throw new DartFatal(`${flag} 뒤에 값을 넣어 주세요. 예) npm run collect:auditor -- ${flag} ${ex}`);
  }
  if (YEAR !== '2026') {
    throw new DartFatal(`--year는 2026만 쓸 수 있어요(받은 값: ${YEAR}). 결과 파일 이름이 2026h1로 고정돼 있어서예요.`);
  }
  const [k, n] = parsePart(PART);
  const all = loadUniverse();
  const size = Math.ceil(all.length / n);
  const corps = all.slice((k - 1) * size, k * size);
  const dart = createDart();
  log(`${YEAR} 반기 감사인 수집: 파트 ${k}/${n}, ${corps.length}곳`);
  const out = [];
  const droppedValues = new Map(); // 감사인 아님으로 버린 원문 → 곳 수
  let conflicts = 0;
  let multi = 0;
  let noCurrent = 0;
  let i = 0;
  for (const c of corps) {
    i++;
    const json = await dart.call(
      'accnutAdtorNmNdAdtOpinion.json',
      { corp_code: c.corp_code, bsns_year: YEAR, reprt_code: REPRT },
      `${c.corp_code}_${YEAR}_${REPRT}`,
    );
    const p = json.status === '000' ? pickCurrent(json.list) : null;
    if (p && p.invalid_raw) droppedValues.set(p.invalid_raw, (droppedValues.get(p.invalid_raw) || 0) + 1);
    if (p && p.conflict) conflicts++;
    if (p && p.multi) multi++;
    if (p && p.noCurrent) noCurrent++;
    out.push({
      corp_code: c.corp_code,
      fiscal_year: Number(YEAR),
      reprt_code: REPRT,
      status: json.status,
      auditor_raw: p ? p.auditor_raw : '',
      invalid_raw: p ? p.invalid_raw : '',
      period_label: p ? p.period_label : '',
      rcept_no: p ? p.rcept_no : '',
    });
    if (i % 200 === 0 || i === corps.length) log(`  ${i}/${corps.length}곳 처리`);
  }

  // 확인용 출력 (멈추는 경우에도 원인을 볼 수 있게 저장 판단 전에 출력)
  if (droppedValues.size) log(`  감사인 아님으로 버린 값(상위): ${fmtCounts(droppedValues)}`);
  if (conflicts) log(`  기수와 당기·전기 표기가 어긋난 곳 ${conflicts}곳: 당기·당반기로 적힌 행의 감사인을 썼어요(합병·분할 회사 추정).`);
  if (multi) log(`  같은 기에 감사인 이름이 둘 이상인 곳 ${multi}곳: 첫 값을 썼어요.`);
  if (noCurrent) log(`  당기·당반기 행 없이 전기·전전기 행만 있는 곳 ${noCurrent}곳: 감사인을 비워 뒀어요(invalid_raw '${NO_CURRENT_ROW}' → data:build가 2025 사업보고서 감사인을 써요).`);
  const found = out.filter((r) => r.auditor_raw).length;
  const blank = out.filter((r) => r.status === '000' && !r.auditor_raw).length;
  const empty = out.filter((r) => r.status === '013').length;
  reportStats('auditor-2026h1', dart.stats);

  // 저장 전 검사: 응답 상태 이상이 있으면 저장하지 않고 멈춘다
  assertNoIssues(dart, 'auditor-2026h1');
  const file = path.join(EXTRA_DIR, `auditor_2026h1.part${k}of${n}.jsonl`);
  writeJsonl(file, out);
  writeExtraMeta(`auditor2026_part${k}of${n}`, { year: YEAR, part: `${k}/${n}`, records: out.length, found, blank, empty }, out);
  log(`완료: 감사인 확인 ${found}곳 · 감사인 아님/빈 값 ${blank}곳 · 데이터 없음(013) ${empty}곳 → ${file}`);
}

runCollector('auditor-2026h1', main);
