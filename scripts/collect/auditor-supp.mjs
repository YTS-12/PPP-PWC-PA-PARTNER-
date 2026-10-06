// 추가 수집 6: 감사인 보완 — OpenDART 감사용역체결현황(adtServcCnclsSttus.json, 정기보고서 주요정보 DS002)의 당기 감사인
// 사용: npm run collect:auditor-supp   (collect:auditor 를 받은 뒤에 실행)
// 대상(결정 E2):
//   2026 — 2026 반기 감사인(data/extra/auditor_2026h1.part*.jsonl)에서 감사인을 얻지 못한 회사(auditor_raw 가 비었거나 감사인 이름이 아님:
//          API 값 '-'·감사의견·문서명, 당반기 행 없음, 반기보고서 없음 013) → 2026 반기보고서(reprt_code 11012)
//   2025 — 기존 수집본(DATA_DIR)에서 2025 감사인이 없는 회사 → 2025 사업보고서(11011). .env 에 DATA_DIR 이 없으면 2026 만 받는다.
// 요청 인자: corp_code, bsns_year, reprt_code (공식 가이드 apiId 2020010). 응답의 bsns_year 는 '당기'·'전기'·'전전기'(또는 '제N기(당기)'),
//   adtor 는 감사인. 같은 보고서의 회계감사인 API 와 같은 규칙(auditor-2026h1.mjs 의 pickCurrent·looksLikeAuditor)으로 당기 행을 고른다.
//   보수·시간 칸(mendng·tot_reqre_time·adt_cntrct_dtls_*·real_exc_dtls_*)은 쓰지 않아 저장하지 않는다(설계서: 감사보수·감사시간 쓰지 않음).
// 결과: data/extra/auditor_supp.jsonl, data/extra/auditorSupp.meta.json (기록 이름은 다른 명령처럼 화면의 추가 수집 키 auditorSupp 와 같게)
//   행: { corp_code, bsns_year(2026|2025), reprt_code('11012'|'11011'), status, auditor_raw, period_label, rcept_no, source:'adtServcCnclsSttus' }
//   auditor_raw 는 감사인 이름일 때만 채우고, 아니면 '' (data:build 는 감사인 이름인 값만 쓴다).
// 저장하지 않고 멈추는 경우: 응답 상태가 000·013이 아닌 요청이 있을 때. 받은 응답은 data/raw 에 캐시돼 다시 실행하면 이어받는다.
import path from 'node:path';
import { loadBase, loadUniverse, readExtra, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDart, reportStats, assertNoIssues, runCollector, importAsLibrary, DartFatal } from '../lib/dart.mjs';

// 회계감사인 수집과 같은 당기 행 고르기를 그대로 쓴다(그 스크립트의 수집은 실행하지 않음)
const { pickCurrent, looksLikeAuditor } = await importAsLibrary(() => import('./auditor-2026h1.mjs'));

const API = 'adtServcCnclsSttus';
const HY = 2026; // 반기 감사인 연도(auditor_2026h1)
const FY = 2025; // 기존 수집본 사업연도

async function main() {
  const uni = loadUniverse();
  const inUni = new Set(uni.map((c) => c.corp_code));
  const aud = readExtra('auditor_2026h1');
  if (!aud.collected) {
    throw new DartFatal('2026 반기 감사인(data/extra/auditor_2026h1.part*.jsonl)이 없어요. npm run collect:auditor 를 먼저 실행해 주세요.');
  }
  // 2026: 감사인 이름을 얻은 회사는 빼고, 남은 회사(파트 여러 개면 합침)
  const got26 = new Set(aud.rows.filter((r) => r.auditor_raw && looksLikeAuditor(r.auditor_raw)).map((r) => r.corp_code));
  const t26 = [...new Set(aud.rows.map((r) => r.corp_code))].filter((c) => inUni.has(c) && !got26.has(c)).sort();
  // 2025: 기존 수집본에서 감사인이 없는 회사(DATA_DIR 없으면 건너뜀)
  let t25 = [];
  let has25 = false;
  if ((process.env.DATA_DIR || '').trim()) {
    let base;
    try {
      base = loadBase();
    } catch (e) {
      throw new DartFatal(`기존 수집본을 읽지 못했어요: ${e.message}`);
    }
    has25 = true;
    t25 = base.companies.filter((c) => inUni.has(c.corp_code) && !c.auditor).map((c) => c.corp_code).sort();
  } else {
    log('  .env 에 DATA_DIR(기존 수집본 폴더)이 없어 2025 사업보고서 보완은 건너뛰고 2026 반기만 받아요.');
  }
  const jobs = [
    ...t26.map((corp) => ({ corp, year: HY, reprt: '11012' })),
    ...t25.map((corp) => ({ corp, year: FY, reprt: '11011' })),
  ];
  const dart = createDart();
  log(`감사인 보완(감사용역체결현황): 2026 반기 ${t26.length}곳 · 2025 사업보고서 ${has25 ? `${t25.length}곳` : '건너뜀'} = 요청 ${jobs.length}건`);
  const out = [];
  const dropped = new Map(); // 감사인 아님으로 버린 값 → 건수
  let i = 0;
  for (const j of jobs) {
    i++;
    const json = await dart.call(`${API}.json`, { corp_code: j.corp, bsns_year: String(j.year), reprt_code: j.reprt }, `${j.corp}_${j.year}_${j.reprt}`);
    const p = json.status === '000' ? pickCurrent(json.list) : null;
    if (p && p.invalid_raw) dropped.set(p.invalid_raw, (dropped.get(p.invalid_raw) || 0) + 1);
    out.push({
      corp_code: j.corp,
      bsns_year: j.year,
      reprt_code: j.reprt,
      status: json.status,
      auditor_raw: p && looksLikeAuditor(p.auditor_raw) ? p.auditor_raw : '',
      period_label: p ? p.period_label : '',
      rcept_no: p ? p.rcept_no : '',
      source: API,
    });
    if (i % 100 === 0 || i === jobs.length) log(`  ${i}/${jobs.length}건 처리`);
  }

  // 확인용 출력 (멈추는 경우에도 볼 수 있게 저장 판단 전에 출력)
  const found = (y) => out.filter((r) => r.bsns_year === y && r.auditor_raw).length;
  const empty = out.filter((r) => r.status === '013').length;
  log(`  감사인 찾음: 2026 반기 ${found(HY)}/${t26.length}곳 · 2025 ${has25 ? `${found(FY)}/${t25.length}곳` : '건너뜀'} · 데이터 없음(013) ${empty}건`);
  if (dropped.size) {
    log(`  감사인 아님으로 버린 값(상위): ${[...dropped].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}(${v})`).join(', ')}`);
  }
  reportStats('auditor-supp', dart.stats);

  // 저장 전 검사: 응답 상태 이상이 있으면 저장하지 않고 멈춘다
  assertNoIssues(dart, 'auditor-supp');
  const file = path.join(EXTRA_DIR, 'auditor_supp.jsonl');
  writeJsonl(file, out);
  writeExtraMeta(
    'auditorSupp',
    { api: API, targets2026: t26.length, targets2025: has25 ? t25.length : null, records: out.length, found2026: found(HY), found2025: found(FY), empty },
    out,
  );
  log(`완료: 감사인 보완 ${out.length}건(찾음 ${found(HY) + found(FY)}건) → ${file}`);
}

runCollector('auditor-supp', main);
