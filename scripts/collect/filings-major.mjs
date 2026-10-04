// 추가 수집 3: 주요사항보고서(B) 최근 12개월 — 합병·분할 등과 부도·회생·감자 재분류용
// 사용: npm run collect:major                    (오늘까지 12개월)
//       npm run collect:major -- --end 20261006  (다음 날 이어받기: 첫 실행일을 그대로 준다)
// 결과: data/extra/filings_major.jsonl, data/extra/major.meta.json
// 저장하지 않고 멈추는 경우: 응답 상태가 000·013이 아닌 요청이 있을 때. 다시 실행 명령(같은 --end)을 함께 보여 준다.
import path from 'node:path';
import { arg, missingValue, loadUniverse, today, windows, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, assertNoIssues, runCollector, DartFatal } from '../lib/dart.mjs';
import { searchAll, toFiling, checkEnd } from './list-search.mjs';

const END = arg('--end', today());

async function main() {
  // '--end' 만 주고 날짜를 빠뜨리면 오늘로 바뀌어 첫 실행과 조회 구간이 달라지니(캐시를 못 씀) 먼저 멈춘다
  if (missingValue('--end')) throw new DartFatal(`--end 뒤에 값을 넣어 주세요. 예) npm run collect:major -- --end ${today()}`);
  const target = new Set(loadUniverse().map((c) => c.corp_code));
  const dart = createDart();
  checkEnd(END, 'collect:major');
  const wins = windows(END, 365);
  log(`주요사항보고서 수집: ${wins[0][0]}~${END}, ${wins.length}구간 × 코스피·코스닥`);
  const out = new Map();
  for (const [bgn, end] of wins) {
    for (const cls of ['Y', 'K']) {
      const rows = await searchAll({ dart, bgn, end, type: 'B', cls, tag: 'major' });
      for (const r of rows) if (target.has(r.corp_code)) out.set(r.rcept_no, toFiling(r, { pblntf_ty: 'B' }));
      log(`  ${bgn}~${end} ${cls === 'Y' ? '코스피' : '코스닥'}: ${rows.length}건`);
    }
  }
  const list = [...out.values()];
  reportStats('filings-major', dart.stats);

  // 저장 전 검사: 응답 상태 이상
  assertNoIssues(dart, 'filings-major');
  const file = path.join(EXTRA_DIR, 'filings_major.jsonl');
  writeJsonl(file, list);
  writeExtraMeta('major', { from: wins[0][0], to: END, records: list.length }, list);
  log(`완료: 대상 기업 주요사항보고서 ${list.length}건 → ${file} (조회 종료일 ${END})`);
}

runCollector('filings-major', main);
