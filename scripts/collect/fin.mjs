// 추가 수집 1: 다중회사 주요계정 재수집 (fnlttMultiAcnt · 100곳씩 · 연결·별도 주요계정)
// 사용: npm run collect:fin                              (2025 사업보고서, 2025 자료가 하나도 없는 회사만 2024로 보완)
//       npm run collect:fin -- --year 2025 --fallback 2024
//       npm run collect:fin -- --allow-low               (확보율 90% 미만이어도 저장. 원인을 확인한 뒤에만 쓴다)
// 결과: data/extra/fin_<연도>.jsonl, data/extra/fin.meta.json
// 저장하지 않고 멈추는 경우: 응답 상태가 000·013이 아닌 요청이 있을 때, 주요계정을 받은 회사가 대상의 90% 미만일 때.
//   받은 응답은 data/raw에 캐시돼서 같은 명령을 다시 실행하면 받은 곳은 새로 호출하지 않아요.
//   확보율이 90% 이상 95% 미만이면 저장은 하고 설계서 합격 기준(95%) 미달 경고를 한 줄 보여 줘요.
// 실행 후 확인: 응답 필드 한 줄, '식별 못 한 행' 수, '확인 필요 계정명'(자본금·세전이익 변형 → 있으면 ACCOUNTS에 추가)
// 자본금 보완: 주요계정 응답에 자본금 행이 없는 레코드(자본총계는 있음, 원화)만 단일회사 전체 재무제표(fnlttSinglAcntAll.json)로
//   자본금을 다시 찾는다(레코드 1건에 1번 호출, 10/5 데이터 기준 32건 · 24곳). 계정명 앞 번호 머리('(1)자본금' 등)는 normName 이 지운다.
import path from 'node:path';
import { arg, hasFlag, missingValue, loadUniverse, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, amount, reportStats, assertNoIssues, runCollector, DartFatal } from '../lib/dart.mjs';

const YEAR = arg('--year', '2025');
const FALLBACK = arg('--fallback', '2024');
const ALLOW_LOW = hasFlag('--allow-low');
const BATCH = 100; // 다중회사 주요계정은 한 번에 100곳까지
const MIN_COVERAGE = 0.9; // 주요계정을 받은 회사가 대상의 이 비율 미만이면 저장하지 않는다
const TARGET_COVERAGE = 0.95; // 설계서 합격 기준: 이 비율 미만이면(90% 이상) 저장은 하되 경고

// 계정명 정리: 공백·앞 번호 머리·(손실) 표기 제거 후 매칭
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
// 앞 번호 머리: '(1)자본금'·'1.자본금'·'1)자본금'·'Ⅰ.자본금'·'I.자본금'·'가.자본금'·'①자본금'·'[1]자본금' (공백을 지운 뒤 본다)
const NUM_HEAD = /^(?:[(\[（]?(?:\d{1,2}|[ⅠⅡⅢⅣⅤⅥⅦⅧⅨⅩⅰⅱⅲⅳⅴⅵⅶⅷⅸⅹ]|[IVX]{1,4}|[가나다라마바사아자차카타파하])[)\]）.．]|[①-⑳])+/;
export const normName = (s) => (s || '').replace(/\s+/g, '').replace(NUM_HEAD, '').replace(/\((손실|이익)\)/g, '');

// 주요계정 API가 늘 주지만 신호에 쓰지 않는 계정: '매칭 안 된 계정명' 출력에서 뺀다
const UNUSED =
  /^(유동자산|비유동자산|유동부채|비유동부채|이익잉여금|결손금|이익잉여금\(결손금\)|총포괄손익|총포괄이익|기타포괄손익|법인세비용|법인세비용\(수익\)|법인세수익)$/;
// 자본금·세전이익과 비슷한데 ACCOUNTS에 안 걸린 이름은 '확인 필요 계정명'으로 따로 보여 준다
const WATCH = /자본금|납입자본|세전|법인세비용차감전|법인세차감전/;

/**
 * list: 응답 행, allowed: 이번 요청에 넣은 corp_code 집합, stockToCorp: 대상 목록의 stock_code → corp_code
 * 공식 가이드의 응답 필드에는 corp_code가 없고 stock_code가 있어서, corp_code가 없으면 stock_code로 회사를 찾는다.
 */
function parseRows(list, year, allowed, stockToCorp) {
  const byKey = new Map();
  const unmatched = new Map();
  let unidentified = 0; // corp_code도 없고 stock_code도 대상 목록에 없는 행
  let outside = 0; // 회사는 찾았지만 이번 요청(대상)에 없는 행
  for (const r of list || []) {
    const fs = r.fs_div;
    if (fs !== 'CFS' && fs !== 'OFS') continue;
    const corp = String(r.corp_code || '').trim() || stockToCorp.get(String(r.stock_code || '').trim());
    if (!corp) {
      unidentified++;
      continue;
    }
    if (!allowed.has(corp)) {
      outside++;
      continue;
    }
    const key = `${corp}|${fs}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        corp_code: corp,
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
  return { records: [...byKey.values()], unmatched, unidentified, outside };
}

let fieldsLogged = false; // 응답 필드 목록은 실행마다 한 번만 출력

async function fetchYear(dart, corps, year, stockToCorp) {
  const records = [];
  const unmatchedAll = new Map();
  let unidentified = 0;
  let outside = 0;
  for (let i = 0; i < corps.length; i += BATCH) {
    const batch = corps.slice(i, i + BATCH);
    const codes = batch.map((c) => c.corp_code);
    const cacheKey = `${year}_${codes[0]}_${codes[codes.length - 1]}_${codes.length}`;
    const json = await dart.call(
      'fnlttMultiAcnt.json',
      { corp_code: codes.join(','), bsns_year: year, reprt_code: '11011' },
      cacheKey,
    );
    if (!fieldsLogged && Array.isArray(json.list) && json.list.length) {
      // 필드 확인용: 키 이름만 출력하고 값은 출력하지 않는다
      fieldsLogged = true;
      const keys = Object.keys(json.list[0]);
      const how = keys.includes('corp_code') ? 'corp_code로 회사를 찾아요' : 'corp_code가 없어 stock_code로 회사를 찾아요';
      log(`  응답 필드(${year} ${i / BATCH + 1}번째 배치 list[0]): ${keys.join(', ')} → ${how}`);
    }
    const p = parseRows(json.list, year, new Set(codes), stockToCorp);
    records.push(...p.records);
    unidentified += p.unidentified;
    outside += p.outside;
    for (const [k, v] of p.unmatched) unmatchedAll.set(k, (unmatchedAll.get(k) || 0) + v);
    log(`  ${year} 사업보고서 ${Math.min(i + BATCH, corps.length)}/${corps.length}곳 처리`);
  }
  return { records, unmatched: unmatchedAll, unidentified, outside };
}

const fmtCounts = (entries) => entries.map(([k, v]) => `${k}(${v})`).join(', ');

/**
 * 자본금 보완: 다중회사 주요계정 응답에 자본금 행이 없는 레코드(자본총계는 있음, 원화)만 단일회사 전체 재무제표
 * (fnlttSinglAcntAll.json, 같은 사업연도·사업보고서·같은 연결/별도)에서 자본금을 찾는다. 회사가 계정명을 '(1)자본금'처럼
 * 번호를 붙여 적으면 주요계정 API 가 자본금으로 묶지 못해 행이 빠진다(Q1: 광명전기 등 16곳). 레코드 1건에 1번 호출.
 * 찾는 행: 재무상태표(BS) 중 account_id 가 ifrs-full_IssuedCapital(또는 ifrs_IssuedCapital)이거나, 계정명을 normName 으로
 * 정리하면 '자본금'인 행. 여러 행이면 account_id 가 맞는 행 → 이름이 맞는 첫 행. 보완한 레코드에는 capital_src 를 남긴다.
 */
async function supplementCapital(dart, records) {
  const need = records.filter((r) => r.capital == null && r.equity != null && (r.currency || 'KRW') === 'KRW');
  if (!need.length) return { need: 0, filled: 0, empty: 0, notFound: [] };
  log(`  자본금 보완: 주요계정에 자본금이 없는 ${need.length}건(${new Set(need.map((r) => r.corp_code)).size}곳)을 단일회사 전체 재무제표로 찾아요`);
  let filled = 0;
  let empty = 0;
  const notFound = [];
  for (const rec of need) {
    const json = await dart.call(
      'fnlttSinglAcntAll.json',
      { corp_code: rec.corp_code, bsns_year: String(rec.bsns_year), reprt_code: '11011', fs_div: rec.fs_div },
      `${rec.corp_code}_${rec.bsns_year}_11011_${rec.fs_div}`,
    );
    if (json.status === '013') {
      empty++;
      continue;
    }
    if (json.status !== '000') continue; // issues 에 남음 → 저장 전 멈춤
    const bs = (Array.isArray(json.list) ? json.list : []).filter((r) => r && r.sj_div === 'BS');
    const byId = bs.find((r) => /^ifrs(-full)?_IssuedCapital$/.test(String(r.account_id || '').trim()));
    const byName = bs.find((r) => normName(r.account_nm) === '자본금');
    const v = [byId, byName].filter(Boolean).map((r) => amount(r.thstrm_amount)).find((x) => x != null) ?? null;
    if (v == null) {
      notFound.push(rec.corp_code);
      continue;
    }
    rec.capital = v;
    rec.capital_src = 'fnlttSinglAcntAll';
    filled++;
  }
  log(
    `  자본금 보완 결과: ${filled}/${need.length}건 채움 · 전체 재무제표 없음(013) ${empty}건 · 자본금 행 못 찾음 ${notFound.length}건` +
      `${notFound.length ? ` (${[...new Set(notFound)].slice(0, 10).join(', ')})` : ''}`,
  );
  return { need: need.length, filled, empty, notFound };
}

async function main() {
  // 값 없이 준 플래그(--year --fallback 2024 등)는 기본값으로 바뀌어 모르는 사이 다른 연도를 받게 되니 먼저 멈춘다
  for (const [flag, ex] of [['--year', '2025'], ['--fallback', '2024']]) {
    if (missingValue(flag)) throw new DartFatal(`${flag} 뒤에 값을 넣어 주세요. 예) npm run collect:fin -- ${flag} ${ex}`);
  }
  const corps = loadUniverse();
  const stockToCorp = new Map(
    corps.filter((c) => String(c.stock_code || '').trim()).map((c) => [String(c.stock_code).trim(), c.corp_code]),
  );
  const dart = createDart();
  log(`주요계정 재수집: 대상 ${corps.length}곳, ${YEAR} 사업보고서`);
  const cur = await fetchYear(dart, corps, YEAR, stockToCorp);
  // YEAR 응답에 상태 이상이 있으면 보완 대상을 잘못 정하게 되니 보완 전에 멈춘다 (다시 실행하면 그 요청만 다시 받음)
  // 멈출 때도 호출·캐시 수를 볼 수 있게 먼저 출력한다 (정상이면 끝에서 한 번만 출력)
  if (dart.issues.length) reportStats('fin', dart.stats);
  assertNoIssues(dart, 'fin');

  // 보완은 YEAR 자료가 하나도 없는 회사만 한다. 그래서 같은 회사·기준(fs_div)이 두 연도에 함께 생기지 않는다
  // (YEAR에 별도만 있는 회사도 보완하지 않는다).
  const got = new Set(cur.records.map((r) => r.corp_code));
  const missing = corps.filter((c) => !got.has(c.corp_code));
  let fb = null;
  if (missing.length && FALLBACK && FALLBACK !== YEAR) {
    log(`  ${YEAR} 자료가 없는 ${missing.length}곳은 ${FALLBACK} 사업보고서로 보완`);
    fb = await fetchYear(dart, missing, FALLBACK, stockToCorp);
  }
  const all = [...cur.records, ...(fb ? fb.records : [])];
  const supp = await supplementCapital(dart, all);

  const seen = new Set();
  let dup = 0;
  for (const r of all) {
    const k = `${r.corp_code}|${r.fs_div}`;
    if (seen.has(k)) dup++;
    seen.add(k);
  }
  if (dup) {
    throw new DartFatal(
      `같은 회사·재무제표 기준이 두 번 들어갔어요(${dup}건). fin.mjs 보완 규칙 확인 필요, 다시 실행해도 같은 결과예요.`,
    );
  }

  // 확인용 출력 (멈추는 경우에도 원인을 볼 수 있게 저장 판단 전에 출력)
  const parts = fb ? [cur, fb] : [cur];
  const unidentified = parts.reduce((s, p) => s + p.unidentified, 0);
  const outside = parts.reduce((s, p) => s + p.outside, 0);
  log(`  회사 식별: 식별 못 한 행 ${unidentified}건 · 대상 밖 행 ${outside}건 (둘 다 건너뜀)`);
  const fieldCounts = ACCOUNTS.map(([f]) => `${f} ${all.filter((r) => r[f] != null).length}`).join(' · ');
  log(`  계정별 값 있는 레코드(전체 ${all.length}건): ${fieldCounts}`);

  const unmatched = new Map();
  for (const p of parts) for (const [k, v] of p.unmatched) unmatched.set(k, (unmatched.get(k) || 0) + v);
  const byCount = (a, b) => b[1] - a[1];
  const watch = [...unmatched].filter(([k]) => WATCH.test(k)).sort(byCount);
  const others = [...unmatched].filter(([k]) => !WATCH.test(k) && !UNUSED.test(k)).sort(byCount).slice(0, 15);
  if (watch.length) log('  확인 필요 계정명(자본금·세전이익 변형 → ACCOUNTS에 추가 검토):', fmtCounts(watch));
  else log('  확인 필요 계정명: 없음');
  if (others.length) log('  참고(매칭 안 된 계정명 상위, 늘 오는 미사용 계정 제외):', fmtCounts(others));

  const cov = new Set(all.map((r) => r.corp_code)).size;
  const fbCov = fb ? new Set(fb.records.map((r) => r.corp_code)).size : 0;
  const pct = Math.floor((cov / corps.length) * 1000) / 10;
  log(`  확보: ${cov}/${corps.length}곳(${pct}%) · ${YEAR} ${got.size}곳 · ${FALLBACK} 보완 ${fbCov}곳 · 레코드 ${all.length}건`);
  reportStats('fin', dart.stats);

  // 저장 전 검사: 응답 상태 이상 → 확보율
  assertNoIssues(dart, 'fin');
  const low = cov < corps.length * MIN_COVERAGE;
  if (low && !ALLOW_LOW) {
    throw new DartFatal(
      `주요계정을 받은 회사가 ${cov}/${corps.length}곳(${pct}%)뿐이라 저장하지 않았어요. ` +
        `위의 응답 필드와 '식별 못 한 행'을 확인해 주세요. 그래도 저장하려면 -- --allow-low 를 붙여 다시 실행하세요(받은 응답은 캐시라 새 호출이 거의 없어요).`,
    );
  }
  if (low) log(`  경고: 확보율이 ${MIN_COVERAGE * 100}% 미만(${pct}%)이지만 --allow-low라 저장해요.`);
  else if (cov < corps.length * TARGET_COVERAGE) {
    log(`  경고: 확보율 ${pct}%(${cov}/${corps.length}곳)가 설계서 합격 기준(${TARGET_COVERAGE * 100}%)에 못 미쳐요. 저장은 해요.`);
  }

  const file = path.join(EXTRA_DIR, `fin_${YEAR}.jsonl`);
  writeJsonl(file, all);
  writeExtraMeta(
    'fin',
    {
      year: YEAR,
      fallback: FALLBACK,
      records: all.length,
      companies: cov,
      target: corps.length,
      capitalSupp: supp.filled,
      ...(low ? { allowLow: true } : {}),
    },
    all,
  );
  log(`완료: ${cov}/${corps.length}곳, 레코드 ${all.length}건 → ${file}`);
}

runCollector('fin', main);
