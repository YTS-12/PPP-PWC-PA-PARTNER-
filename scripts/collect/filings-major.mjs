// 추가 수집 3: 주요사항보고서(B) 최근 12개월 — 합병·분할 등과 부도·회생·감자 재분류용
// 사용: npm run collect:major                    (오늘까지 12개월)
//       npm run collect:major -- --end 20261006
import path from 'node:path';
import { arg, loadUniverse, today, windows, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, DartFatal } from '../lib/dart.mjs';
import { searchAll, toFiling } from './list-search.mjs';

const END = arg('--end', today());

async function main() {
  const target = new Set(loadUniverse().map((c) => c.corp_code));
  const dart = createDart();
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
  const file = path.join(EXTRA_DIR, 'filings_major.jsonl');
  writeJsonl(file, list);
  writeExtraMeta('major', { from: wins[0][0], to: END, records: list.length });
  log(`완료: 대상 기업 주요사항보고서 ${list.length}건 → ${file}`);
  reportStats('filings-major', dart.stats);
}

main().catch((e) => {
  console.error(e instanceof DartFatal ? `중단: ${e.message}` : e);
  process.exit(1);
});
