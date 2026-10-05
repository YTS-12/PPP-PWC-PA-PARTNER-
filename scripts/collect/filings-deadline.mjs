// 추가 수집 5: 사업보고서 제출기한 연장신고 (2024·2025·2026년 3/1~4/10)
// 사용: npm run collect:deadline                 (공시유형 전체를 훑음 · 권장)
//       npm run collect:deadline -- --probe      ('연장'이 들어간 제목만 보여 주고 파일은 쓰지 않음: 실제 제목 확인용)
//       npm run collect:deadline -- --allow-empty (연장신고가 0건이어도 저장. 제목 목록을 확인한 뒤에만 쓴다)
//       --type 은 공시유형을 이미 알 때만 쓴다. list.json 응답에는 공시유형 필드가 없어 결과로 유형을 확인할 수 없다.
// 결과: data/extra/filings_deadline.jsonl, data/extra/deadline.meta.json
// 저장하지 않고 멈추는 경우: 응답 상태가 000·013이 아닌 요청이 있을 때, 연장신고가 0건일 때(--allow-empty 제외).
//   받은 응답은 data/raw에 캐시돼서 같은 명령을 다시 실행하면 받은 곳은 새로 호출하지 않아요(기간이 고정이라 언제 다시 돌려도 캐시를 씀).
// 기간 3/1~4/10 은 12월 결산 회사의 사업보고서 기한(3월 말) 전후다. 12월 결산이 아닌 회사(대상 2,555곳 중 약 31곳,
//   3·6·9월 결산 등)는 기한이 달라 이 기간으로는 연장신고를 잡지 못하므로 PA1 판정 범위 밖이다.
// 처음에는 3/20~4/10 만 받아 3/20 전에 낸 연장신고(예: 2026-03-16·03-18, 2025-03-19, 2024-03-15·03-19 접수)를 놓쳤다.
//   그래서 시작일을 3/1 로 당기되 [3/1~3/19]와 [3/20~4/10] 두 구간으로 나눠 조회한다. list.json 캐시 이름에 조회 구간(bgn·end)이
//   들어가서, 한 구간(3/1~4/10)으로 바꾸면 이미 받은 3/20~4/10 응답을 못 쓰고 전부 다시 호출하게 된다.
//   두 구간으로 나누면 3/20~4/10 은 그대로 캐시를 쓰고 3/1~3/19 만 새로 받는다(연도·시장마다 수십 쪽).
import path from 'node:path';
import { arg, hasFlag, missingValue, loadUniverse, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, assertNoIssues, runCollector, DartFatal } from '../lib/dart.mjs';
import { searchAll, toFiling } from './list-search.mjs';

const TYPE = arg('--type', '');
const YEARS = (arg('--years', '2024,2025,2026') || '').split(',').map((s) => s.trim());
const PROBE = hasFlag('--probe');
const ALLOW_EMPTY = hasFlag('--allow-empty');
const isDeadline = (t) => /연장/.test(t) && /(사업보고서|제출기한)/.test(t);
// 조회 구간(월일 MMDD). 두 구간은 겹치지 않는다. 뒤 구간은 처음 수집 때와 같아 받은 응답 캐시를 그대로 쓴다(머리 주석 참고)
const SPANS = [
  ['0301', '0319'],
  ['0320', '0410'],
];
const md = (s) => `${Number(s.slice(0, 2))}/${Number(s.slice(2))}`; // '0301' → '3/1'
const PERIOD = `${md(SPANS[0][0])}~${md(SPANS[SPANS.length - 1][1])}`; // '3/1~4/10'

async function main() {
  // 값 없이 준 플래그(--type --probe 등)는 기본값으로 바뀌어 모르는 사이 다른 범위를 받게 되니 먼저 멈춘다
  const need = [
    ['--type', '--type A (공시유형 코드. 모르면 --type 을 빼고 실행하세요)'],
    ['--years', '--years 2024,2025,2026'],
  ];
  for (const [flag, ex] of need) {
    if (missingValue(flag)) throw new DartFatal(`${flag} 뒤에 값을 넣어 주세요. 예) npm run collect:deadline -- ${ex}`);
  }
  const target = new Set(loadUniverse().map((c) => c.corp_code));
  const dart = createDart();
  log(
    `제출기한 연장신고 수집: ${YEARS.join(', ')}년 ${PERIOD} (${SPANS.map(([b, e]) => `${md(b)}~${md(e)}`).join(' + ')} 나눠 조회), ` +
      `공시유형 ${TYPE || '전체'}${PROBE ? ' (--probe: 제목만 확인, 파일은 쓰지 않음)' : ''}`,
  );
  const out = new Map();
  const probe = new Map();
  for (const y of YEARS) {
    for (const cls of ['Y', 'K']) {
      const counts = [];
      for (const [b, e] of SPANS) {
        const rows = await searchAll({ dart, bgn: `${y}${b}`, end: `${y}${e}`, type: TYPE, cls, tag: 'deadline' });
        for (const r of rows) {
          const t = r.report_nm || '';
          if (/연장/.test(t)) probe.set(t, (probe.get(t) || 0) + 1);
          if (target.has(r.corp_code) && isDeadline(t)) out.set(r.rcept_no, toFiling(r, { year: Number(y) }));
        }
        counts.push(`${md(b)}~${md(e)} ${rows.length}건`);
      }
      log(`  ${y}년 ${cls === 'Y' ? '코스피' : '코스닥'}: ${counts.join(' · ')} 확인`);
    }
  }
  const list = [...out.values()];
  if (PROBE || list.length === 0) {
    log(`'연장'이 들어간 공시 제목 ${probe.size}종 (제목 규칙 확인용, 많은 순 30개):`);
    for (const [t, n] of [...probe.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) log(`  ${n}건  ${t}${isDeadline(t) ? '' : '  ← 규칙 밖'}`);
    if (!probe.size) log('  (없음)');
  }
  log(`  제목 규칙에 맞는 대상 기업 연장신고: ${list.length}건`);
  reportStats('filings-deadline', dart.stats);

  if (PROBE) {
    // 확인용 실행: 결과 파일은 건드리지 않는다. 응답 이상이 있으면 위 목록이 일부일 수 있다
    if (dart.issues.length) log(`  경고: 응답 상태 이상 ${dart.issues.length}건이 있어 위 목록은 일부일 수 있어요. 옵션 없이 다시 실행하면 그 요청만 다시 받아요.`);
    log('--probe 라 파일은 쓰지 않았어요. 저장하려면 옵션 없이 다시 실행하세요.');
    return;
  }

  // 저장 전 검사: 응답 상태 이상 → 0건
  assertNoIssues(dart, 'filings-deadline');
  if (!list.length && !ALLOW_EMPTY) {
    throw new DartFatal(
      '연장신고 0건 — 제목 규칙을 확인하세요. 위 제목 목록에 연장신고가 보이면 filings-deadline.mjs 의 isDeadline 규칙을 고쳐 다시 실행하고' +
        '(받은 응답은 캐시라 새 호출이 거의 없어요), 정말 0건이 맞으면 -- --allow-empty 를 붙여 다시 실행하세요.',
    );
  }
  if (!list.length) log('  경고: 연장신고가 0건이지만 --allow-empty 라 저장해요.');

  const file = path.join(EXTRA_DIR, 'filings_deadline.jsonl');
  writeJsonl(file, list);
  writeExtraMeta(
    'deadline',
    { years: YEARS, period: PERIOD, type: TYPE || 'ALL', records: list.length, ...(list.length ? {} : { allowEmpty: true }) },
    list,
  );
  log(`완료: 연장신고 ${list.length}건 → ${file}`);
}

runCollector('filings-deadline', main);
