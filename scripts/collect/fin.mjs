// 추가 수집 1: 다중회사 주요계정 재수집 (연결·별도 전체 주요계정)
// 사용: npm run collect:fin            (기본 2025 사업보고서, 없으면 2024로 보완)
//       npm run collect:fin -- --year 2025 --fallback 2024
import path from 'node:path';
import { arg, loadUniverse, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, amount, reportStats, DartFatal } from '../lib/dart.mjs';

const YEAR = arg('--year', '2025');
const FALLBACK = arg('--fallback', '2024');

// 계정명 정리: 공백·(손실) 표기 제거 후 매칭
const ACCOUNTS = [
  ['assets', /^자산총계$/],
  ['liabilities', /^부채총계$/],
  ['capital', /^자본금$/],
  ['equity', /^자본총계$/],
  ['revenue', /^(매출액|수익\(매출액\)|영업수익)$/],
  ['op', /^영업이익$/],
  ['pretax', /^(법인세차감전순이익|법인세비용차감전순이익|법인세차감전계속사업이익)$/],
  ['net', /^당기순이익$/],
];
const normName = (s) => (s || '').replace(/\s+/g, '').replace(/\((손실|이익)\)/g, '');

function parseRows(list, year) {
  const byKey = new Map();
  const unmatched = new Map();
  for (const r of list || []) {
    const fs = r.fs_div;
    if (fs !== 'CFS' && fs !== 'OFS') continue;
    const key = `${r.corp_code}|${fs}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        corp_code: r.corp_code,
        bsns_year: Number(year),
        fs_div: fs,
        rcept_no: r.rcept_no || '',
        currency: r.currency || 'KRW',
      });
    }
    const rec = byKey.get(key);
    const nm = normName(r.account_nm);
    const hit = ACCOUNTS.find(([, re]) => re.test(nm));
    if (!hit) {
      unmatched.set(nm, (unmatched.get(nm) || 0) + 1);
      continue;
    }
    const [field] = hit;
    if (rec[field] !== undefined) continue; // 같은 계정이 두 번 나오면 첫 값 유지
    rec[field] = amount(r.thstrm_amount);
    if (field === 'op') {
      rec.op_prev = amount(r.frmtrm_amount);
      rec.op_prev2 = amount(r.bfefrmtrm_amount);
    }
  }
  return { records: [...byKey.values()], unmatched };
}

async function fetchYear(dart, corps, year) {
  const records = [];
  const unmatchedAll = new Map();
  for (let i = 0; i < corps.length; i += 100) {
    const batch = corps.slice(i, i + 100);
    const codes = batch.map((c) => c.corp_code);
    const cacheKey = `${year}_${codes[0]}_${codes[codes.length - 1]}_${codes.length}`;
    const json = await dart.call(
      'fnlttMultiAcnt.json',
      { corp_code: codes.join(','), bsns_year: year, reprt_code: '11011' },
      cacheKey,
    );
    const { records: recs, unmatched } = parseRows(json.list, year);
    records.push(...recs);
    for (const [k, v] of unmatched) unmatchedAll.set(k, (unmatchedAll.get(k) || 0) + v);
    log(`  ${year} 사업보고서 ${Math.min(i + 100, corps.length)}/${corps.length}곳 처리`);
  }
  return { records, unmatched: unmatchedAll };
}

async function main() {
  const corps = loadUniverse();
  const dart = createDart();
  log(`주요계정 재수집: 대상 ${corps.length}곳, ${YEAR} 사업보고서`);
  const main = await fetchYear(dart, corps, YEAR);
  const got = new Set(main.records.map((r) => r.corp_code));
  const missing = corps.filter((c) => !got.has(c.corp_code));
  let fb = { records: [] };
  if (missing.length && FALLBACK) {
    log(`  ${YEAR} 자료가 없는 ${missing.length}곳은 ${FALLBACK} 사업보고서로 보완`);
    fb = await fetchYear(dart, missing, FALLBACK);
  }
  const all = [...main.records, ...fb.records];
  const file = path.join(EXTRA_DIR, `fin_${YEAR}.jsonl`);
  writeJsonl(file, all);
  writeExtraMeta('fin', { year: YEAR, fallback: FALLBACK, records: all.length });
  const cov = new Set(all.map((r) => r.corp_code)).size;
  log(`완료: ${cov}/${corps.length}곳, 레코드 ${all.length}건 → ${file}`);
  const top = [...main.unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  if (top.length) log('  참고(매칭 안 된 계정명 상위):', top.map(([k, v]) => `${k}(${v})`).join(', '));
  reportStats('fin', dart.stats);
}

main().catch((e) => {
  console.error(e instanceof DartFatal ? `중단: ${e.message}` : e);
  process.exit(1);
});
