// 추가 수집 4: 거래소공시(I) 최근 12개월 중 횡령·배임 공시
// 사용: npm run collect:krx                    (오늘까지 12개월)
//       npm run collect:krx -- --end 20261006  (다음 날 이어받기: 첫 실행일을 그대로 준다)
// 결과: data/extra/filings_krx.jsonl, data/extra/krx.meta.json
// 저장하지 않고 멈추는 경우: 응답 상태가 000·013이 아닌 요청이 있을 때. 다시 실행 명령(같은 --end)을 함께 보여 준다.
import path from 'node:path';
import { arg, missingValue, loadUniverse, today, windows, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, assertNoIssues, runCollector, DartFatal } from '../lib/dart.mjs';
import { searchAll, toFiling, checkEnd } from './list-search.mjs';

const END = arg('--end', today());
const FRAUD = /횡령|배임/;

async function main() {
  // '--end' 만 주고 날짜를 빠뜨리면 오늘로 바뀌어 첫 실행과 조회 구간이 달라지니(캐시를 못 씀) 먼저 멈춘다
  if (missingValue('--end')) throw new DartFatal(`--end 뒤에 값을 넣어 주세요. 예) npm run collect:krx -- --end ${today()}`);
  const target = new Set(loadUniverse().map((c) => c.corp_code));
  const dart = createDart();
  checkEnd(END, 'collect:krx');
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
  // 확인용 출력 (멈추는 경우에도 볼 수 있게 저장 판단 전에 출력)
  log(`  거래소공시 ${scanned}건 중 대상 기업 횡령·배임 ${list.length}건`);
  for (const t of [...new Set(list.map((r) => r.report_nm))].slice(0, 10)) log(`  제목 예: ${t}`);
  reportStats('filings-krx', dart.stats);

  // 저장 전 검사: 응답 상태 이상
  assertNoIssues(dart, 'filings-krx');
  const file = path.join(EXTRA_DIR, 'filings_krx.jsonl');
  writeJsonl(file, list);
  writeExtraMeta('krx', { from: wins[0][0], to: END, scanned, records: list.length }, list);
  log(`완료: 거래소공시 ${scanned}건 중 횡령·배임 ${list.length}건 → ${file} (조회 종료일 ${END})`);
}

runCollector('filings-krx', main);
