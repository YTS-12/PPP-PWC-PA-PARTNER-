// 추가 수집 5: 사업보고서 제출기한 연장신고 (2024·2025·2026년 3/20~4/10)
// 사용: npm run collect:deadline                 (공시유형 전체를 훑음)
//       npm run collect:deadline -- --type A     (공시유형을 확인한 뒤 좁혀서 빠르게)
//       npm run collect:deadline -- --probe      ('연장'이 들어간 제목을 모두 보여 줌: 실제 제목 확인용)
import path from 'node:path';
import { arg, hasFlag, loadUniverse, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, DartFatal } from '../lib/dart.mjs';
import { searchAll, toFiling } from './list-search.mjs';

const TYPE = arg('--type', '');
const YEARS = (arg('--years', '2024,2025,2026') || '').split(',').map((s) => s.trim());
const PROBE = hasFlag('--probe');
const isDeadline = (t) => /연장/.test(t) && /(사업보고서|제출기한)/.test(t);

async function main() {
  const target = new Set(loadUniverse().map((c) => c.corp_code));
  const dart = createDart();
  log(`제출기한 연장신고 수집: ${YEARS.join(', ')}년 3/20~4/10, 공시유형 ${TYPE || '전체'}`);
  const out = new Map();
  const probe = new Map();
  for (const y of YEARS) {
    for (const cls of ['Y', 'K']) {
      const rows = await searchAll({ dart, bgn: `${y}0320`, end: `${y}0410`, type: TYPE, cls, tag: 'deadline' });
      for (const r of rows) {
        const t = r.report_nm || '';
        if (/연장/.test(t)) probe.set(t, (probe.get(t) || 0) + 1);
        if (target.has(r.corp_code) && isDeadline(t)) out.set(r.rcept_no, toFiling(r, { year: Number(y) }));
      }
      log(`  ${y}년 ${cls === 'Y' ? '코스피' : '코스닥'}: ${rows.length}건 확인`);
    }
  }
  if (PROBE || out.size === 0) {
    log("'연장'이 들어간 공시 제목 (제목 규칙 확인용):");
    for (const [t, n] of [...probe.entries()].sort((a, b) => b[1] - a[1]).slice(0, 30)) log(`  ${n}건  ${t}`);
  }
  const list = [...out.values()];
  const file = path.join(EXTRA_DIR, 'filings_deadline.jsonl');
  writeJsonl(file, list);
  writeExtraMeta('deadline', { years: YEARS, type: TYPE || 'ALL', records: list.length });
  log(`완료: 연장신고 ${list.length}건 → ${file}`);
  reportStats('filings-deadline', dart.stats);
}

main().catch((e) => {
  console.error(e instanceof DartFatal ? `중단: ${e.message}` : e);
  process.exit(1);
});
