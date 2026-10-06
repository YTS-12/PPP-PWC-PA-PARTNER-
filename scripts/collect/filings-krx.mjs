// 추가 수집 3: 거래소공시(I) 최근 12개월 중 횡령·배임 공시와 거래소 시장조치 공시
// 사용: npm run collect:krx                    (오늘까지 12개월)
//       npm run collect:krx -- --end 20261006  (다음 날 이어받기: 첫 실행일을 그대로 준다)
// 결과: data/extra/filings_krx.jsonl, data/extra/krx.meta.json
//   행마다 cat: 'FRAUD'(제목에 횡령·배임) | 'MARKET'(거래소 시장조치, list-search.mjs 의 marketKind 규칙 · 결정 E4)
//   시장조치면 mkt: '실질심사'|'상장폐지사유'|'관리종목'|'반기부적정'|'내부결산'|'중요한영업정지'.
//   ('내부결산' = 내부결산시점 공시, 결정 E. '중요한영업정지'는 저장만 하고 data:build 가 RS1 에서 뺀다, 결정 C) 제목에 횡령·배임이 있으면서 시장조치이기도 하면
//   cat 'FRAUD' 에 mkt 도 넣는다. cat 이 없는 옛 행은 FRAUD 로 읽는다.
//   시장조치는 횡령·배임과 같은 응답(같은 캐시)에서 고르므로 새 호출이 없다.
// 저장하지 않고 멈추는 경우: 응답 상태가 000·013이 아닌 요청이 있을 때. 다시 실행 명령(같은 --end)을 함께 보여 준다.
import path from 'node:path';
import { arg, missingValue, loadUniverse, today, windows, writeJsonl, writeExtraMeta, EXTRA_DIR, log, baseTitle } from '../lib/common.mjs';
import { createDart, reportStats, assertNoIssues, runCollector, DartFatal } from '../lib/dart.mjs';
import { searchAll, toFiling, checkEnd, marketKind, looksMarket } from './list-search.mjs';

const END = arg('--end', today());
const FRAUD = /횡령|배임/;

async function main() {
  // '--end' 만 주고 날짜를 빠뜨리면 오늘로 바뀌어 첫 실행과 조회 구간이 달라지니(캐시를 못 씀) 먼저 멈춘다
  if (missingValue('--end')) throw new DartFatal(`--end 뒤에 값을 넣어 주세요. 예) npm run collect:krx -- --end ${today()}`);
  const target = new Set(loadUniverse().map((c) => c.corp_code));
  const dart = createDart();
  checkEnd(END, 'collect:krx');
  const wins = windows(END, 365);
  log(`거래소공시 수집(횡령·배임, 시장조치): ${wins[0][0]}~${END}, ${wins.length}구간 × 코스피·코스닥`);
  const out = new Map();
  const nearMiss = new Map(); // 시장조치처럼 보이지만 규칙 밖인 제목 → 건수 (확인용)
  let scanned = 0;
  for (const [bgn, end] of wins) {
    for (const cls of ['Y', 'K']) {
      const rows = await searchAll({ dart, bgn, end, type: 'I', cls, tag: 'krx' });
      scanned += rows.length;
      for (const r of rows) {
        if (!target.has(r.corp_code)) continue;
        const t = r.report_nm || '';
        const fraud = FRAUD.test(t);
        const mkt = marketKind(t);
        if (fraud || mkt) {
          out.set(r.rcept_no, toFiling(r, { pblntf_ty: 'I', cat: fraud ? 'FRAUD' : 'MARKET', ...(mkt ? { mkt } : {}) }));
        } else if (looksMarket(t)) {
          const k = baseTitle(t);
          nearMiss.set(k, (nearMiss.get(k) || 0) + 1);
        }
      }
      log(`  ${bgn}~${end} ${cls === 'Y' ? '코스피' : '코스닥'}: 거래소공시 ${rows.length}건 확인`);
    }
  }
  const list = [...out.values()];
  // 확인용 출력 (멈추는 경우에도 볼 수 있게 저장 판단 전에 출력)
  const fraud = list.filter((r) => r.cat === 'FRAUD');
  const market = list.filter((r) => r.cat === 'MARKET');
  const byMkt = {};
  for (const r of list) if (r.mkt) byMkt[r.mkt] = (byMkt[r.mkt] || 0) + 1;
  log(`  거래소공시 ${scanned}건 중 대상 기업 ${list.length}건: 횡령·배임 ${fraud.length}건 · 시장조치 ${market.length}건`);
  const both = fraud.filter((r) => r.mkt).length;
  log(
    `  시장조치 유형별: ${Object.entries(byMkt).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'}` +
      `${both ? ` (횡령·배임 제목이면서 시장조치인 ${both}건은 cat FRAUD 에 mkt 도 넣음)` : ''}`,
  );
  log(`  시장조치 회사 ${new Set(market.map((r) => r.corp_code)).size}곳`);
  for (const t of [...new Set(fraud.map((r) => r.report_nm))].slice(0, 10)) log(`  제목 예(횡령·배임): ${t}`);
  for (const k of Object.keys(byMkt)) {
    const ex = list.find((r) => r.mkt === k);
    log(`  제목 예(${k}): ${ex.report_nm.trim()}`);
  }
  const nm = [...nearMiss].sort((a, b) => b[1] - a[1]);
  if (nm.length) {
    log(`  시장조치 규칙 밖 제목 ${nm.reduce((s, [, n]) => s + n, 0)}건(${nm.length}종, 우려·해제·관련 안내 등 · 많은 순 10개):`);
    for (const [t, n] of nm.slice(0, 10)) log(`    ${n}건  ${t}`);
  }
  reportStats('filings-krx', dart.stats);

  // 저장 전 검사: 응답 상태 이상
  assertNoIssues(dart, 'filings-krx');
  const file = path.join(EXTRA_DIR, 'filings_krx.jsonl');
  writeJsonl(file, list);
  writeExtraMeta('krx', { from: wins[0][0], to: END, scanned, records: list.length, fraud: fraud.length, market: market.length, byMkt }, list);
  log(`완료: 거래소공시 ${scanned}건 중 횡령·배임 ${fraud.length}건 · 시장조치 ${market.length}건 → ${file} (조회 종료일 ${END})`);
}

runCollector('filings-krx', main);
