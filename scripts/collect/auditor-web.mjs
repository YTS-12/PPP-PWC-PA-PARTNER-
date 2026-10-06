// 추가 수집 7: 감사인 보완 2 — DART 공시 화면(dart.fss.or.kr) 보고서의 '외부감사에 관한 사항' 표에서 당기·당반기 감사인 (2026-10-06 결정 A)
// 사용: npm run collect:auditor-web   (collect:auditor · collect:auditor-supp 를 받은 뒤에 실행)
// 대상:
//   2026 — 2026 반기 감사인(data/extra/auditor_2026h1.part*.jsonl)이 status 000 인데 감사인을 얻지 못했고(auditor_raw ''),
//          감사용역체결현황(data/extra/auditor_supp.jsonl) 2026 행도 감사인이 없는 회사 → 2026 반기보고서
//          (접수번호: auditor_2026h1 의 rcept_no, 없으면 auditor_supp 의 rcept_no. 둘 다 없으면 건너뜀)
//   2025 — 기존 수집본(DATA_DIR)의 2025 감사인이 없고 auditor_supp 2025 행도 감사인이 없는 회사 → 2025 사업보고서
//          (접수번호: 기존 수집본 primary_report_rcept_no, 없으면 auditor_supp 2025 rcept_no·감사인 이력 2025 rcept_no.
//          모두 없으면(신규 상장 등 사업보고서 없음) 건너뜀). .env 에 DATA_DIR 이 없으면 2026 만 읽는다.
// 방법(회사 1곳에 DART 웹 화면 2번, 요청 간격 1초 이상 · dart.mjs createDartWeb: 캐시·재시도·10번 연속 실패·403/429 즉시 중단):
//   1) 공시 화면(dsaf001/main.do) 목차에서 '외부감사에 관한 사항'(없으면 '회계감사인의 감사의견 등'·'감사인의 감사의견')을 찾는다.
//   2) 그 부분(report/viewer.do)의 표에서 '사업연도'·'감사인' 열을 읽어 auditor-2026h1.mjs 의 pickCurrent·looksLikeAuditor 규칙으로
//      당기·당반기 행의 감사인을 고른다(전기 행으로 대신하지 않음). '가. 회계감사인의 명칭 및 감사의견' 표를 먼저 보고, 거기서 감사인 이름을
//      얻지 못하면(칸에 '-'·'감사보고서' 등) 같은 부분의 다음 표('나. 감사용역 체결현황' 등)를 차례로 본다.
//   data:build 의 현재 감사인 우선순위(결정 A): 감사인 API 2026 → 감사용역체결현황 2026 → DART 화면 2026 → 기존 2025 →
//   감사용역체결현황 2025 → DART 화면 2025 → 이력 추정(표시만).
// 결과: data/extra/auditor_web.jsonl, data/extra/auditorWeb.meta.json
//   행: { corp_code, bsns_year(2026|2025), rcept_no, auditor_raw, period_label, invalid_raw, source:'dartweb' }
//   auditor_raw 는 감사인 이름일 때만 채우고, 아니면 '' 이고 invalid_raw 에 이유(버린 원문·'당반기 행 없음'·'목차에 외부감사 항목 없음'·
//   '감사인 표 없음'·'감사인 칸 비어 있음').
// 저장하지 않고 멈추는 경우: 화면을 받지 못했거나(HTTP 오류·이상 화면·목차 없는 화면) 받은 화면 모두에서 감사인 표를 못 찾았을 때
//   (DART 화면 형식이 바뀐 것으로 봄). 받은 화면은 data/raw/dartweb 에 캐시돼서 다시 실행하면 받은 화면은 새로 요청하지 않아요.
import path from 'node:path';
import { loadBase, loadUniverse, readExtra, writeJsonl, writeExtraMeta, EXTRA_DIR, log } from '../lib/common.mjs';
import { createDartWeb, parseDartMain, reportWebStats, assertNoIssues, runCollector, importAsLibrary, DartFatal } from '../lib/dart.mjs';

// 다른 수집 스크립트의 함수만 가져다 쓴다(그 스크립트의 수집은 실행하지 않음): 당기 행 고르기와 표 읽기
const { pickCurrent, looksLikeAuditor } = await importAsLibrary(() => import('./auditor-2026h1.mjs'));
const { htmlTables } = await importAsLibrary(() => import('./corrections.mjs'));

const HY = 2026; // 반기 감사인 연도(auditor_2026h1)
const FY = 2025; // 기존 수집본 사업연도
const SOURCE = 'dartweb';
const NO_SECTION = '목차에 외부감사 항목 없음';
const NO_TABLE = '감사인 표 없음';
const EMPTY_CELL = '감사인 칸 비어 있음';

const squash = (s) => String(s ?? '').replace(/\s+/g, '');
const clean = (s) => String(s ?? '').replace(/\s+/g, ' ').trim();
const hasAuditor = (v) => !!v && looksLikeAuditor(v);

// 목차에서 감사인 표가 든 부분: 앞의 것부터 찾는다('회계감사인의 감사의견 등'은 '외부감사에 관한 사항'을 품은 상위 부분)
const SECTION_RES = [/외부\s*감사에\s*관한\s*사항/, /회계\s*감사인의\s*감사\s*의견/, /감사인의\s*감사\s*의견/];
/** 공시 화면 목차(parseDartMain 의 toc)에서 감사인 표가 든 부분. 없으면 null */
export function auditSectionNode(toc) {
  for (const re of SECTION_RES) {
    const n = (toc || []).find((t) => re.test(t.text));
    if (n) return n;
  }
  return null;
}

const YEAR_HEAD = /^(사업연도|사업년도|회계연도|기수)$/;
const ADTOR_HEAD = /^(감사인|회계감사인|감사인명|외부감사인)$/;
/**
 * 표 격자(htmlTables 의 한 표)에서 '사업연도'·'감사인' 열을 찾아 행 목록 [{ bsns_year, adtor }]. 머리 행은 앞 3행 안에서 찾는다.
 * 두 줄 머리(rowspan)의 아랫줄처럼 머리 글자가 되풀이된 행과 빈 행은 뺀다. 그런 열이 없으면 null
 */
export function auditorRowsOf(grid) {
  for (let h = 0; h < Math.min(grid.length, 3); h++) {
    const sq = grid[h].map(squash);
    const yc = sq.findIndex((s) => YEAR_HEAD.test(s));
    const ac = sq.findIndex((s) => ADTOR_HEAD.test(s));
    if (yc < 0 || ac < 0 || yc === ac) continue;
    const rows = [];
    for (const row of grid.slice(h + 1)) {
      const label = clean(row[yc]);
      const adtor = clean(row[ac]);
      if (YEAR_HEAD.test(squash(label)) || ADTOR_HEAD.test(squash(adtor))) continue;
      if (!label && !adtor) continue;
      rows.push({ bsns_year: label, adtor });
    }
    return rows.length ? rows : null;
  }
  return null;
}

/**
 * '외부감사에 관한 사항' 화면(viewer.do)에서 당기·당반기 감사인을 고른다. 감사인 열이 있는 표를 앞에서부터 보아 pickCurrent 로
 * 현재 행을 고르고, 감사인 이름을 얻은 첫 표를 쓴다. 모두 못 얻으면 첫 표의 결과(버린 원문)를 invalid_raw 로 남긴다.
 * 반환: { auditor_raw, invalid_raw, period_label, table(쓴 표 순번, 못 얻으면 0), tables(감사인 표 수), conflict, multi }
 */
export function pickFromSection(html) {
  let first = null;
  let tables = 0;
  for (const grid of htmlTables(html)) {
    const rows = auditorRowsOf(grid);
    if (!rows) continue;
    tables++;
    const p = pickCurrent(rows);
    if (!p) continue;
    if (hasAuditor(p.auditor_raw)) {
      return { auditor_raw: p.auditor_raw, invalid_raw: '', period_label: p.period_label, table: tables, tables, conflict: p.conflict, multi: p.multi };
    }
    if (!first) first = p;
  }
  if (first) {
    return { auditor_raw: '', invalid_raw: first.invalid_raw || EMPTY_CELL, period_label: first.period_label, table: 0, tables, conflict: false, multi: false };
  }
  return { auditor_raw: '', invalid_raw: NO_TABLE, period_label: '', table: 0, tables: 0, conflict: false, multi: false };
}

const validateMain = (html) => {
  if (/errorWrap/.test(html)) return 'DART 오류 화면';
  // 보고서 공시 화면에는 늘 왼쪽 목차(node1['text'] …)가 있다. 없으면 점검·오류 화면으로 보고 캐시하지 않는다(다시 실행하면 다시 받음)
  if (!/node\d+\s*\[\s*'text'\s*\]/.test(html)) return '공시 화면 형식이 아니에요(목차 없음)';
  return null;
};
const validateView = (html) => {
  if (/errorWrap/.test(html)) return 'DART 오류 화면';
  if (html.length < 200) return '문서 내용이 너무 짧아요';
  return null;
};

/** 대상 고르기. 반환 { jobs:[{ corp, year, rcept }], t26, t25, has25, skip26, skip25 } */
function loadTargets() {
  const uni = loadUniverse();
  const inUni = new Set(uni.map((c) => c.corp_code));
  const aud = readExtra('auditor_2026h1');
  if (!aud.collected) {
    throw new DartFatal('2026 반기 감사인(data/extra/auditor_2026h1.part*.jsonl)이 없어요. npm run collect:auditor 를 먼저 실행해 주세요.');
  }
  const supp = readExtra('auditor_supp');
  if (!supp.collected) {
    throw new DartFatal('감사인 보완(data/extra/auditor_supp.jsonl)이 없어요. npm run collect:auditor-supp 를 먼저 실행해 주세요.');
  }
  const suppBy = (year) => new Map(supp.rows.filter((r) => Number(r.bsns_year) === year).map((r) => [r.corp_code, r]));
  const s26 = suppBy(HY);
  const s25 = suppBy(FY);

  // 2026: 감사인 API 로 감사인을 얻은 회사(파트 여러 개면 어느 파트든)는 빼고, status 000 인데 감사인이 없는 회사 중 감사용역체결현황도 없는 곳
  const got26 = new Set(aud.rows.filter((r) => hasAuditor(r.auditor_raw)).map((r) => r.corp_code));
  const blank26 = new Map();
  for (const r of aud.rows) {
    if (r.status !== '000' || hasAuditor(r.auditor_raw) || got26.has(r.corp_code) || !inUni.has(r.corp_code)) continue;
    if (hasAuditor((s26.get(r.corp_code) || {}).auditor_raw)) continue;
    if (!blank26.has(r.corp_code) || (!blank26.get(r.corp_code).rcept_no && r.rcept_no)) blank26.set(r.corp_code, r);
  }
  const t26 = [];
  let skip26 = 0;
  for (const [corp, r] of [...blank26].sort((a, b) => a[0].localeCompare(b[0]))) {
    const rcept = [r.rcept_no, (s26.get(corp) || {}).rcept_no].find((v) => /^\d{14}$/.test(String(v || '')));
    if (rcept) t26.push({ corp, year: HY, rcept });
    else skip26++;
  }

  // 2025: 기존 수집본에서 감사인이 없는 회사(DATA_DIR 없으면 건너뜀)
  const t25 = [];
  let skip25 = 0;
  let has25 = false;
  if ((process.env.DATA_DIR || '').trim()) {
    let base;
    try {
      base = loadBase();
    } catch (e) {
      throw new DartFatal(`기존 수집본을 읽지 못했어요: ${e.message}`);
    }
    has25 = true;
    const cs = base.companies
      .filter((c) => inUni.has(c.corp_code) && !c.auditor && !hasAuditor((s25.get(c.corp_code) || {}).auditor_raw))
      .sort((a, b) => a.corp_code.localeCompare(b.corp_code));
    for (const c of cs) {
      const hist = (Array.isArray(c.auditor_history) ? c.auditor_history : []).find((h) => Number(h && h.year) === FY);
      const rcept = [c.primary_report_rcept_no, (s25.get(c.corp_code) || {}).rcept_no, hist && hist.rcept_no].find((v) =>
        /^\d{14}$/.test(String(v || '')),
      );
      if (rcept) t25.push({ corp: c.corp_code, year: FY, rcept });
      else skip25++;
    }
  } else {
    log('  .env 에 DATA_DIR(기존 수집본 폴더)이 없어 2025 사업보고서 보완은 건너뛰고 2026 반기만 읽어요.');
  }
  return { jobs: [...t26, ...t25], t26, t25, has25, skip26, skip25 };
}

const fmtCounts = (m, top = 10) =>
  [...m]
    .sort((a, b) => b[1] - a[1])
    .slice(0, top)
    .map(([k, v]) => `${k}(${v})`)
    .join(', ');

async function main() {
  const { jobs, t26, t25, has25, skip26, skip25 } = loadTargets();
  const web = createDartWeb();
  log(
    `감사인 보완(DART 공시 화면): 2026 반기 ${t26.length}곳${skip26 ? `(접수번호 없어 건너뜀 ${skip26}곳)` : ''} · ` +
      `2025 사업보고서 ${has25 ? `${t25.length}곳${skip25 ? `(사업보고서 접수번호 없어 건너뜀 ${skip25}곳)` : ''}` : '건너뜀'}` +
      ` = 화면 약 ${jobs.length * 2}번, 1초 간격`,
  );
  const out = [];
  const dropped = new Map(); // 감사인 아님으로 버린 값 → 건수
  const noSection = [];
  const noTable = [];
  const fromLater = []; // 첫 표에서 못 얻고 다음 표(감사용역 체결현황 등)에서 얻음
  const kindMismatch = []; // 반기보고서·사업보고서가 아닌 화면
  let viewed = 0;
  let conflicts = 0;
  let multi = 0;
  let i = 0;
  for (const j of jobs) {
    i++;
    const row = { corp_code: j.corp, bsns_year: j.year, rcept_no: j.rcept, auditor_raw: '', period_label: '', invalid_raw: '', source: SOURCE };
    const mainHtml = await web.get('dsaf001/main.do', { rcpNo: j.rcept }, `main/${j.rcept}`, { validate: validateMain });
    if (mainHtml == null) continue; // issues 에 남음 → 저장 전 멈춤
    const info = parseDartMain(mainHtml);
    const want = j.year === HY ? /반기보고서/ : /사업보고서/;
    if (!want.test(squash(info.title))) kindMismatch.push(`${j.corp} ${j.year} ${j.rcept} ${info.title}`);
    const node = auditSectionNode(info.toc);
    if (!node) {
      row.invalid_raw = NO_SECTION;
      noSection.push(`${j.corp} ${j.year} ${j.rcept} ${info.title}`);
      out.push(row);
      continue;
    }
    const q = { rcpNo: node.rcpNo || j.rcept, dcmNo: node.dcmNo, eleId: node.eleId, offset: node.offset, length: node.length, dtd: node.dtd };
    const view = await web.get('report/viewer.do', q, `viewer/${j.rcept}_${node.dcmNo}_${node.eleId}`, { validate: validateView });
    if (view == null) continue;
    viewed++;
    const p = pickFromSection(view);
    row.auditor_raw = p.auditor_raw;
    row.period_label = p.period_label;
    row.invalid_raw = p.invalid_raw;
    if (!p.tables) noTable.push(`${j.corp} ${j.year} ${j.rcept} ${info.title} [${node.text}]`);
    if (p.invalid_raw && p.tables) dropped.set(p.invalid_raw, (dropped.get(p.invalid_raw) || 0) + 1);
    if (p.table > 1) fromLater.push(`${j.corp} ${j.year} ${p.auditor_raw} (${p.period_label})`);
    if (p.conflict) conflicts++;
    if (p.multi) multi++;
    out.push(row);
    if (i % 20 === 0 || i === jobs.length) log(`  ${i}/${jobs.length}곳 확인 (새 요청 ${web.stats.calls} · 캐시 ${web.stats.cached})`);
  }

  // 확인용 출력 (멈추는 경우에도 볼 수 있게 저장 판단 전에 출력)
  const found = (y) => out.filter((r) => r.bsns_year === y && r.auditor_raw).length;
  log(`  감사인 찾음: 2026 반기 ${found(HY)}/${t26.length}곳 · 2025 ${has25 ? `${found(FY)}/${t25.length}곳` : '건너뜀'}`);
  if (dropped.size) log(`  감사인 아님으로 버린 값(상위): ${fmtCounts(dropped)}`);
  if (fromLater.length) {
    log(`  첫 표(회계감사인의 명칭 및 감사의견)에서 못 얻어 다음 표(감사용역 체결현황 등)의 감사인을 쓴 곳 ${fromLater.length}곳:`);
    for (const s of fromLater.slice(0, 10)) log(`    ${s}`);
  }
  if (conflicts) log(`  기수와 당기·전기 표기가 어긋난 곳 ${conflicts}곳: 당기·당반기로 적힌 행의 감사인을 썼어요.`);
  if (multi) log(`  같은 기에 감사인 이름이 둘 이상인 곳 ${multi}곳: 첫 값을 썼어요.`);
  if (noSection.length) {
    log(`  목차에서 외부감사 항목을 못 찾은 곳 ${noSection.length}곳(감사인 비움):`);
    for (const s of noSection.slice(0, 10)) log(`    ${s}`);
  }
  if (noTable.length) {
    log(`  외부감사 부분에서 '사업연도·감사인' 표를 못 찾은 곳 ${noTable.length}곳(감사인 비움):`);
    for (const s of noTable.slice(0, 10)) log(`    ${s}`);
  }
  if (kindMismatch.length) {
    log(`  반기보고서·사업보고서가 아닌 화면 ${kindMismatch.length}건(접수번호 확인 필요, 결과는 그대로 저장):`);
    for (const s of kindMismatch.slice(0, 10)) log(`    ${s}`);
  }
  reportWebStats('auditor-web', web.stats);

  // 저장 전 검사: 화면 요청 실패·이상 화면 → 받은 화면 모두에서 감사인 표를 못 찾음(형식 변경)
  assertNoIssues(web, 'auditor-web');
  if (viewed >= 5 && noTable.length === viewed) {
    throw new DartFatal(
      `받은 외부감사 화면 ${viewed}건 모두에서 '사업연도·감사인' 표를 찾지 못했어요. DART 화면 형식이 바뀌었을 수 있어 저장하지 않았어요. ` +
        'data/raw/dartweb/viewer 의 해당 화면을 확인해 주세요.',
    );
  }
  const file = path.join(EXTRA_DIR, 'auditor_web.jsonl');
  writeJsonl(file, out);
  writeExtraMeta(
    'auditorWeb',
    {
      source: SOURCE,
      targets2026: t26.length,
      targets2025: has25 ? t25.length : null,
      skipped2026: skip26,
      skipped2025: has25 ? skip25 : null,
      records: out.length,
      found2026: found(HY),
      found2025: found(FY),
      noSection: noSection.length,
      noTable: noTable.length,
    },
    out,
  );
  log(`완료: 감사인 보완(DART 공시 화면) ${out.length}건(찾음 ${found(HY) + found(FY)}건) → ${file}`);
}

runCollector('auditor-web', main);
