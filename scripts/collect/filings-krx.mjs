// 추가 수집 4: 거래소공시(I) 최근 12개월 중 횡령·배임 공시
// 사용: npm run collect:krx                    (오늘까지 12개월)
//       npm run collect:krx -- --end 20261006
import path from 'node:path';
import { arg, loadUniverse, today, windows, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, DartFatal } from '../lib/dart.mjs';
import { searchAll, toFiling } from './list-search.mjs';

const END = arg('--end', today());
const FRAUD = /횡령|배임/;

async function main() {
  const target = new Set(loadUniverse().map((c) => c.corp_code));
  const dart = createDart();
  const wins = windows(END, 365);
  log(`거래소공시 수집(횡령·배임): ${wins[0][0]}~${END}, ${wins.length}구간 × 코스피·코스닥`);
  const out = new Map();
  let scanned = 0;
  for (const [bgn, end] of wins) {
    for (const cls of ['Y', 'K']) {
      const rows = await searchAll({ dart, bgn, end, type: 'I', cls, tag: 'krx' });
      scanned += rows.length;
      for (const r of rows) {
        if (target.has(r.corp_code) && FRAUD.test(r.report_nm || '')) out.set(r.rcept_no, toFiling(r, { pblntf_ty: 'I' }));
      }
      log(`  ${bgn}~${end} ${cls === 'Y' ? '코스피' : '코스닥'}: 거래소공시 ${rows.length}건 확인`);
    }
  }
  const list = [...out.values()];
  const file = path.join(EXTRA_DIR, 'filings_krx.jsonl');
  writeJsonl(file, list);
  writeExtraMeta('krx', { from: wins[0][0], to: END, scanned, records: list.length });
  log(`완료: 거래소공시 ${scanned}건 중 횡령·배임 ${list.length}건 → ${file}`);
  for (const t of [...new Set(list.map((r) => r.report_nm))].slice(0, 10)) log(`  제목 예: ${t}`);
  reportStats('filings-krx', dart.stats);
}

main().catch((e) => {
  console.error(e instanceof DartFatal ? `중단: ${e.message}` : e);
  process.exit(1);
});
