// 추가 수집 2: 2026 반기보고서의 감사인 (현재 감사인 · 주기적 지정 판정 보완)
// 사용: npm run collect:auditor                 (전체를 한 사람이)
//       npm run collect:auditor -- --part 1/2   (두 사람이 나눠서: 1/2, 2/2)
import path from 'node:path';
import { arg, loadUniverse, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, DartFatal } from '../lib/dart.mjs';

const YEAR = arg('--year', '2026');
const PART = arg('--part', '1/1');

function pickCurrent(list) {
  const rows = (list || []).filter((r) => (r.adtor || '').trim() && !/해당사항|없음|^-$/.test(r.adtor.trim()));
  if (!rows.length) return null;
  // 기간 표기에 '당기'가 들어간 행을 우선한다
  return rows.find((r) => /당기/.test(r.bsns_year || '')) || rows[0];
}

async function main() {
  const [k, n] = PART.split('/').map(Number);
  const all = loadUniverse();
  const size = Math.ceil(all.length / n);
  const corps = all.slice((k - 1) * size, k * size);
  const dart = createDart();
  log(`${YEAR} 반기 감사인 수집: 파트 ${k}/${n}, ${corps.length}곳`);
  const out = [];
  let i = 0;
  for (const c of corps) {
    i++;
    const json = await dart.call(
      'accnutAdtorNmNdAdtOpinion.json',
      { corp_code: c.corp_code, bsns_year: YEAR, reprt_code: '11012' },
      `${c.corp_code}_${YEAR}_11012`,
    );
    const row = json.status === '000' ? pickCurrent(json.list) : null;
    out.push({
      corp_code: c.corp_code,
      fiscal_year: Number(YEAR),
      reprt_code: '11012',
      status: json.status,
      auditor_raw: row ? row.adtor.trim() : '',
      period_label: row ? row.bsns_year || '' : '',
      rcept_no: row ? row.rcept_no || '' : (json.list && json.list[0] && json.list[0].rcept_no) || '',
    });
    if (i % 200 === 0 || i === corps.length) log(`  ${i}/${corps.length}곳 처리`);
  }
  const file = path.join(EXTRA_DIR, `auditor_2026h1.part${k}of${n}.jsonl`);
  writeJsonl(file, out);
  writeExtraMeta(`auditor2026_part${k}of${n}`, { year: YEAR, records: out.length });
  const found = out.filter((r) => r.auditor_raw).length;
  log(`완료: 감사인 확인 ${found}/${out.length}곳 → ${file}`);
  reportStats('auditor-2026h1', dart.stats);
}

main().catch((e) => {
  console.error(e instanceof DartFatal ? `중단: ${e.message}` : e);
  process.exit(1);
});
