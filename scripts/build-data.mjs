// 기존 수집본(DATA_DIR) + 추가 수집분(data/extra) → public/data (summary.json, detail/00~99.json)
// 함께 data/universe.json(추가 수집 대상 목록)도 만든다. 추가 수집 스크립트는 이 파일로 대상을 정한다.
// 사용: npm run data:build
import fs from 'node:fs';
import path from 'node:path';
import {
  ROOT,
  CONFIG,
  UNIVERSE_FILE,
  loadBase,
  readExtra,
  readExtraMeta,
  excludeReason,
  universeFromBase,
  baseTitle,
  isoDate,
  log,
} from './lib/common.mjs';

const P = CONFIG.params;
const OUT = path.join(ROOT, 'public', 'data');

// ---------- 공시 제목 분류 (공백·머리말 제거한 제목 기준) ----------
const RE_MNA = /회사합병결정|회사분할결정|회사분할합병결정|영업양수결정|타법인주식및출자증권양수결정|주식교환[ㆍ·]?이전결정/;
const RE_DISTRESS = /부도발생|영업정지|회생절차개시신청|해산사유발생|채권은행등의관리절차개시|감자결정/;
const RE_FRAUD = /횡령|배임/;
// 횡령·배임 정식 공시(혐의발생·진행사항·사실확인). 그 밖에 제목에 횡령·배임이 든 공시(풍문 조회공시 등)는 '관련 공시'
const RE_FRAUD_FORMAL = /^횡령[ㆍ·]?배임/;
const RE_CAP_REDUCTION = /감자결정/;
const TX = CONFIG.texts || {};
const isDeadline = (t) => /연장/.test(t) && /(사업보고서|제출기한)/.test(t);
const readable = (t) => (t || '').replace(/^(\s*\[[^\]]*\])+/, '').replace(/\s{2,}/g, ' ').trim();

// ---------- 표시 형식 ----------
function won(n) {
  if (n === null || n === undefined) return '–';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1e12) {
    let jo = Math.floor(v / 1e12);
    let eok = Math.round((v - jo * 1e12) / 1e8);
    if (eok >= 10000) {
      jo += 1;
      eok = 0;
    }
    return `${sign}${jo}조${eok ? ' ' + eok.toLocaleString('ko-KR') + '억' : ''}`;
  }
  if (v >= 1e8) return `${sign}${Math.round(v / 1e8).toLocaleString('ko-KR')}억`;
  if (v >= 1e4) return `${sign}${Math.round(v / 1e4).toLocaleString('ko-KR')}만`;
  return `${sign}${v.toLocaleString('ko-KR')}`;
}
const pct = (x) => `${Math.round(x * 100)}%`;

// ---------- 감사인 ----------
// 감사인 이름처럼 보이는지 (auditor-2026h1.mjs의 looksLikeAuditor와 같은 결과): 공백을 지운 뒤
// '회계'(오타 '회게'·'화계'·'…계법인' 포함)·'감사반'이나 대형·외국계 법인 이름이 있으면 감사인으로 본다.
// 'EY'는 대문자이고 앞이 영문이 아닐 때만. 감사의견·문서명('감사보고서' 등)·'해당사항없음'·'-'는 감사인이 아니다
const NOT_AUDITOR = new Set(['적정', '한정', '부적정', '의견거절', '감사보고서', '연결감사보고서', '해당사항없음', '해당없음', '-']);
const AUDITOR_RE = /회계|회게|화계|계법인|감사반|삼일|삼정|안진|한영|이촌|딜로이트|KPMG|Deloitte|PwC|(^|[^A-Za-z])EY/;
const looksLikeAuditor = (s) => {
  const t = String(s ?? '').replace(/\s+/g, '');
  return !NOT_AUDITOR.has(t) && AUDITOR_RE.test(t);
};

/**
 * 감사인 비교용 이름 (PA2 연속 판정·감사인 그룹 공용). 화면에 보이는 원문(au, hist)은 바꾸지 않는다.
 * 괄호와 그 안(겹괄호 포함)·주식회사·㈜·'대표이사 …'·공백·기호를 지우고, 오타(회게법인·화계법인 등)를 고친 뒤
 * 대형 4곳은 '삼일'·'삼정'·'안진'·'한영'으로 통일, 나머지는 맨 앞 영문 접두(EY·딜로이트·Deloitte·KPMG·PwC)와
 * 앞뒤의 '회계법인'을 뗀다. 예: 'EY한영회계법인'·'한영 회계법인' → '한영', '회계법인 세일원'·'세일원 회계법인' → '세일원'
 * 같은 이름 반복을 지운 뒤에도 '회계법인'이 두 번 이상이면 서로 다른 법인 두 곳을 함께 적은 것으로 보고
 * 통일하지 않은 정리된 전체를 돌려준다. 예: '대주회계법인 삼일회계법인' → '대주회계법인삼일회계법인'
 * (감사인 그룹은 includes 기준이라 삼일이 들어 있으면 그대로 SAMIL)
 */
function normAuditor(a) {
  let s = String(a ?? '');
  for (let prev = ''; prev !== s; ) {
    prev = s;
    s = s.replace(/[(（][^()（）]*[)）]/g, ''); // 안쪽 괄호부터: '동현회계법인((구)영앤진회계법인)'
  }
  s = s
    .replace(/[()（）]/g, '') // 짝 없는 괄호: '태일회계법인 (*주1))'
    .replace(/주식회사|㈜/g, '')
    .replace(/\s+/g, '')
    .replace(/(대표이사|대표공인회계사).*$/, '') // '삼일회계법인 대표이사 윤 훈 수'
    .replace(/[^0-9A-Za-z가-힣]/g, '') // '우리회계법인-'
    .replace(/회게법인|화계법인|회계(겁인|버인|벙인)/g, '회계법인') // '동아송강회게법인'·'삼화화계법인'·'신한회계겁인'
    .replace(/회계법$/, '회계법인') // '대성삼경회계법'
    .replace(/(^|[^회])계법인$/, '$1회계법인') // '우리계법인'
    .replace(/^(.+?)\1+$/, '$1'); // 같은 이름 반복: '안경회계법인 안경회계법인'
  if ((s.match(/회계법인/g) || []).length >= 2) return s; // 두 법인 함께 표기: '삼정회계법인 삼일회계법인'
  const big = ['삼일', '삼정', '안진', '한영'].find((b) => s.includes(b)); // auditorGroup과 같은 순서
  if (big) return big;
  const core = s
    .replace(/^(EY|딜로이트|Deloitte|KPMG|PwC)+/i, '')
    .replace(/^회계법인/, '')
    .replace(/회계(법인)?$/, ''); // '우리회계'
  return core || s;
}
function auditorGroup(norm) {
  if (!norm) return '';
  if (norm.includes('삼일')) return 'SAMIL';
  if (/삼정|안진|한영/.test(norm)) return 'BIG4';
  return 'OTHER';
}

// ---------- 업종 그룹 (KSIC 앞 2자리 기준, 자체 분류) ----------
function industryGroup(code) {
  const c = (code || '').trim();
  if (!c) return '서비스·기타';
  if (c.startsWith('715')) return '금융·지주';
  if (c.startsWith('582')) return 'IT·소프트웨어';
  const d = parseInt(c.slice(0, 2), 10);
  if (d === 26) return '반도체·전자';
  if ([21, 27, 70, 86, 87].includes(d)) return '바이오·헬스케어';
  if ([61, 62, 63].includes(d)) return 'IT·소프트웨어';
  if ([58, 59, 60, 90, 91].includes(d)) return '미디어·엔터';
  if (d >= 64 && d <= 66) return '금융·지주';
  if ([25, 28, 29].includes(d)) return '기계·장비';
  if ([30, 31].includes(d)) return '자동차·운송장비';
  if ([19, 20, 35].includes(d)) return '에너지·화학';
  if ([5, 6, 7, 8, 16, 17, 18, 22, 23, 24].includes(d)) return '소재';
  if ([10, 11, 12, 13, 14, 15, 32, 33, 45, 46, 47, 55, 56].includes(d)) return '유통·소비재';
  if ([41, 42, 68].includes(d)) return '건설·부동산';
  if (d >= 49 && d <= 52) return '운송·물류';
  return '서비스·기타';
}
function finOrHolding(code, name) {
  const c = (code || '').trim();
  if (c.startsWith('715') || c.startsWith('64992')) return '지주회사';
  if (/^6[456]/.test(c)) return '금융업';
  if (/홀딩스|지주/.test(name)) return '지주회사(회사명 기준)';
  return null;
}

function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r);
    if (!m.has(k)) m.set(k, []);
    m.get(k).push(r);
  }
  return m;
}

function streakEnding(hist, endYear) {
  const e = hist.get(endYear);
  if (!e) return { n: 0 };
  let n = 1;
  for (let y = endYear - 1; y >= 2015; y--) {
    const h = hist.get(y);
    if (h && h.a === e.a) n++;
    else break;
  }
  return { n, a: e.raw, from: endYear - n + 1 };
}

// =====================================================================
function main() {
  const base = loadBase();
  const extraFin = readExtra('fin_');
  const extraAud = readExtra('auditor_2026h1');
  const extraMajor = readExtra('filings_major');
  const extraKrx = readExtra('filings_krx');
  const extraDeadline = readExtra('filings_deadline');
  const extraMeta = readExtraMeta();
  const extra = {
    fin: extraFin.collected,
    auditor2026: extraAud.collected,
    major: extraMajor.collected,
    krx: extraKrx.collected,
    deadline: extraDeadline.collected,
  };

  // 기준일은 한국 날짜로 맞춘다 (추가 수집 기록은 UTC로 저장됨).
  // 추가 수집 기록의 collectedAt을 그대로 쓴다: 캐시로 같은 결과를 다시 저장하면 writeExtraMeta가 처음 날짜를 유지한다.
  const kstDate = (iso) => {
    const t = Date.parse(iso || '');
    return Number.isFinite(t) ? new Date(t + 9 * 3600e3).toISOString().slice(0, 10) : '';
  };
  const baseDate = kstDate(base.meta.collected_at) || (base.meta.collected_at || '').slice(0, 10);
  const extraDates = Object.values(extraMeta)
    .map((m) => kstDate(m.collectedAt))
    .filter(Boolean);
  const asOf = [baseDate, ...extraDates].sort().at(-1);
  const asOfMs = Date.parse(`${asOf}T00:00:00Z`);
  const recentFrom = new Date(asOfMs - (P.recentDays - 1) * 864e5).toISOString().slice(0, 10);
  const from3m = new Date(asOfMs - 89 * 864e5).toISOString().slice(0, 10);

  // 추가 수집분 색인
  const finBy = new Map();
  for (const r of extraFin.rows) {
    if (!finBy.has(r.corp_code)) finBy.set(r.corp_code, {});
    const slot = finBy.get(r.corp_code);
    // 같은 기준이 두 연도로 있으면 최신 연도 우선
    if (!slot[r.fs_div] || slot[r.fs_div].bsns_year < r.bsns_year) slot[r.fs_div] = r;
  }
  // 감사인 수집분: 감사인 이름이 아닌 값('적정'·'감사보고서' 등)은 쓰지 않는다 → 2025 사업보고서 감사인을 쓴다 (수집 쪽과 이중 안전장치)
  const audBy = new Map(extraAud.rows.filter((r) => r.auditor_raw && looksLikeAuditor(r.auditor_raw)).map((r) => [r.corp_code, r]));
  const audIgnored = extraAud.rows.filter((r) => r.auditor_raw && !looksLikeAuditor(r.auditor_raw));
  const majorBy = groupBy(extraMajor.rows, (r) => r.corp_code);
  const krxBy = groupBy(extraKrx.rows, (r) => r.corp_code);
  const deadlineBy = groupBy(extraDeadline.rows, (r) => r.corp_code);

  const summary = [];
  const details = {};
  const recent = [];
  const counts = Object.fromEntries(CONFIG.signals.map((s) => [s.id, 0]));
  const excluded = { spac: 0, reitFund: 0 };
  let recent3m = new Set();

  for (const c of base.companies) {
    const name = c.name;
    const why = excludeReason(c);
    if (why) {
      excluded[why]++;
      continue;
    }
    const corp = c.corp_code;
    const hits = [];
    const notes = [];
    const filings = [];
    const addHit = (id, ev, d = '', k = '', r = '', value = null) => {
      hits.push({ id, ev, d, k: k || `${id}:${corp}`, r, value });
      counts[id]++;
    };

    // --- 재무 (기존 수집본: 기준 1개, 3개 항목) ---
    const basis = c.financial_basis || null;
    const fa = (c.financials || {}).assets || null;
    const cur = fa ? fa.currency || null : null;
    const assets = fa ? fa.value : null;
    const krwAssets = cur === 'KRW' ? assets : null;
    const revenueBase = ((c.financials || {}).revenue || {}).value ?? null;
    const opBase = ((c.financials || {}).operating_profit || {}).value ?? null;
    const fx = finBy.get(corp) || null;
    const fxKrw = (rec) => (rec && (rec.currency || 'KRW') === 'KRW' ? rec : null);
    // 주요계정이 기존 수집본 사업연도(2025)가 아닌 해(보완한 2024 등)면 근거 문구에 연도를 붙인다 (IC1·IF1·IF3·RS3).
    // 기존 수집본 재무로 판정할 때는 붙이지 않는다
    const fyTag = (rec) => {
      const y = Number(rec && rec.bsns_year);
      return y && y !== Number(base.meta.fiscal_year) ? ` · ${y} 사업보고서` : '';
    };
    if (cur && cur !== 'KRW') notes.push(`재무 통화가 ${cur}라서 규모 기준 신호(IC1·IF1·IF3·RS3)는 판정하지 않았어요.`);
    if (!fa && !fx) notes.push('2025 사업보고서 재무가 없어(신규 상장 등) 재무 기준 신호는 판정하지 않았어요.');

    // --- 감사인 이력 ---
    const hist = new Map();
    for (const h of c.auditor_history || []) {
      if (h.auditor) hist.set(h.year, { a: normAuditor(h.auditor), raw: h.auditor, r: h.rcept_no || '' });
    }
    const a26 = audBy.get(corp);
    if (a26) hist.set(2026, { a: normAuditor(a26.auditor_raw), raw: a26.auditor_raw, r: a26.rcept_no || '' });
    const currentAuditor = (a26 && a26.auditor_raw) || c.auditor || '';
    const auSrc = a26 ? '2026 반기보고서' : '2025 사업보고서';
    const ag = auditorGroup(normAuditor(currentAuditor));

    // PA2 주기적 지정 도래 추정
    if (c.history_has_irregular_terms) {
      notes.push('결산 기수가 불규칙해 주기적 지정 추정(PA2)은 판정하지 않았어요.');
    } else if (hist.has(2026)) {
      const s26 = streakEnding(hist, 2026);
      const s25 = streakEnding(hist, 2025);
      if (s26.n === 6) {
        addHit('PA2', `${s26.from}~2026 같은 감사인(${s26.a}) 6년 연속 → 2027 사업연도 주기적 지정 가능(추정)`, '', `AUD:${corp}`, hist.get(2026).r);
      } else if (s26.n > 6) {
        addHit('PA2', `${s26.from}~2026 같은 감사인(${s26.a}) ${s26.n}년 연속 → 지정 유예(우수기업) 또는 과거 지정 이력 포함 가능, 2027 지정 여부 확인 필요(추정)`, '', `AUD:${corp}`, hist.get(2026).r);
      } else if (s25.n >= 6 && hist.get(2026).a !== hist.get(2025).a) {
        addHit('PA2', `2020~2025 같은 감사인 6년 뒤 2026년 ${hist.get(2026).raw}(으)로 변경 → 주기적 지정 첫해 추정`, '', `AUD:${corp}`, hist.get(2026).r);
      }
    } else {
      const s25 = streakEnding(hist, 2025);
      if (s25.n >= 6) {
        addHit('PA2', `2020~2025 같은 감사인(${s25.a}) 6년 연속 → 2026년 지정 첫해이거나 유예 추정 (2026 감사인 확인 필요)`, '', `AUD:${corp}`, hist.get(2025).r);
      } else if (s25.n === 5) {
        addHit('PA2', `2021~2025 같은 감사인(${s25.a}) 5년 연속 → 2026년에도 같으면 2027 사업연도 지정 대상(추정)`, '', `AUD:${corp}`, hist.get(2025).r);
      }
    }

    // --- 공시 (합병·분할 / 부도·회생 / 횡령·배임 / 연장신고) ---
    let majorList;
    if (extra.major) {
      majorList = (majorBy.get(corp) || []).map((f) => ({ t: f.report_nm, d: isoDate(f.rcept_dt), r: f.rcept_no }));
    } else {
      majorList = (c.ma_reports || []).map((f) => ({ t: f.report_name, d: isoDate(f.date), r: f.rcept_no }));
    }
    const recentOnly = (arr) => arr.filter((f) => f.d >= recentFrom).sort((a, b) => b.d.localeCompare(a.d));
    const mna = recentOnly(majorList.filter((f) => RE_MNA.test(baseTitle(f.t))));
    const distress = recentOnly(majorList.filter((f) => RE_DISTRESS.test(baseTitle(f.t))));
    const fraud = recentOnly((krxBy.get(corp) || []).map((f) => ({ t: f.report_nm, d: isoDate(f.rcept_dt), r: f.rcept_no })).filter((f) => RE_FRAUD.test(f.t)))
      .map((f) => (RE_FRAUD_FORMAL.test(baseTitle(f.t)) ? f : { ...f, rel: true }));
    // 연장신고 대상 사업연도: 제목의 '(2023.12)' → 2023. 없으면 제출 연도 − 1 (3월 제출 = 직전 사업연도 보고서)
    const fiscalOf = (f) => {
      const m = baseTitle(f.report_nm).match(/\((\d{4})\.\d{1,2}\)/);
      return m ? Number(m[1]) : (f.year || Number(isoDate(f.rcept_dt).slice(0, 4))) - 1;
    };
    const ext = (deadlineBy.get(corp) || [])
      .map((f) => ({ t: f.report_nm, d: isoDate(f.rcept_dt), r: f.rcept_no, y: fiscalOf(f) }))
      .filter((f) => isDeadline(baseTitle(f.t)))
      .sort((a, b) => b.d.localeCompare(a.d));

    const filingHit = (id, list) => {
      if (!list.length) return;
      const f = list[0];
      const more = list.length > 1 ? ` 외 ${list.length - 1}건` : '';
      addHit(id, `${readable(f.t)} · ${f.d}${more}`, f.d, f.r, f.r);
    };
    filingHit('PA3', mna);
    filingHit('IC3', mna);
    // RS1은 자본잠식(RS3) 판정 뒤에 정한다(감자결정은 자본잠식 50% 이상일 때만 신호)
    if (extra.krx && fraud.length) {
      // 대표 근거는 정식 공시(혐의발생·진행사항·사실확인) 중 최신, 없으면 관련 공시 중 최신에 '사실 확인 전'을 붙인다
      const formal = fraud.filter((f) => !f.rel);
      const f = formal[0] || fraud[0];
      const more = fraud.length > 1 ? ` 외 ${fraud.length - 1}건` : '';
      addHit('IC2', `${readable(f.t)} · ${f.d}${more}${formal.length ? '' : ` (${TX.ic2RelatedEvidence})`}`, f.d, f.r, f.r);
      const relN = fraud.length - formal.length;
      if (relN) notes.push(String(TX.ic2RelatedNote || '').replace('{n}', relN));
    }
    if (extra.deadline && ext.length) {
      const years = [...new Set(ext.map((f) => f.y))].sort();
      // 가장 긴 연속 사업연도 수 (2년 이상이면 표시)
      let run = 1;
      let best = 1;
      for (let i = 1; i < years.length; i++) {
        run = years[i] === years[i - 1] + 1 ? run + 1 : 1;
        best = Math.max(best, run);
      }
      const latest = ext[0];
      addHit('PA1', `${years.join('·')} 사업연도 사업보고서 제출기한 연장신고${best >= 2 ? ` (${best}년 연속)` : ''}`, latest.d, latest.r, latest.r);
    }
    for (const f of mna) filings.push({ cat: 'MNA', ...f });
    for (const f of fraud) filings.push({ cat: 'FRAUD', ...f });
    for (const f of ext) filings.push({ cat: 'DEADLINE', t: f.t, d: f.d, r: f.r });

    // --- IC1 2029 연결 내부회계 감사 대상 ---
    if (fx && (fx.CFS || fx.OFS)) {
      const rec = fxKrw(P.ic1AssetBasis === 'CFS' ? fx.CFS : fx.OFS);
      if (fx.CFS && rec && rec.assets != null && rec.assets >= P.ic1MinAssets && rec.assets < P.ic1MaxAssets) {
        addHit('IC1', `자산총계 ${won(rec.assets)}(${P.ic1AssetBasis === 'CFS' ? '연결' : '별도'})${fyTag(rec)} · 연결 작성 → 2029 사업연도 연결 내부회계 감사(현행 일정)`, '', `FIN:${corp}:IC1`, rec.rcept_no);
      }
    } else if (basis === 'CFS' && krwAssets != null && krwAssets >= P.ic1MinAssets && krwAssets < P.ic1MaxAssets) {
      addHit('IC1', `연결 자산총계 ${won(krwAssets)} · 연결 작성 → 2029 사업연도 연결 내부회계 감사(현행 일정, 연결 자산 근사)`, '', `FIN:${corp}:IC1`, fa.rcept_no || '');
    }

    // --- IF2 지주회사·금융업 ---
    const fh = finOrHolding(c.industry_code, name);
    if (fh) addHit('IF2', `업종: ${fh} · 주된 사업활동 판단 필요`, '', `IND:${corp}`, '');

    // --- IF3 자산 5천억 이상 + 연결 ---
    const cfsRec = fx ? fxKrw(fx.CFS) : null;
    const cfsAssets = cfsRec ? cfsRec.assets : basis === 'CFS' ? krwAssets : null;
    if (cfsAssets != null && cfsAssets >= P.if3MinAssets) {
      addHit('IF3', `연결 자산총계 ${won(cfsAssets)} · 연결 작성${cfsRec ? fyTag(cfsRec) : ''}`, '', `FIN:${corp}:IF3`, (cfsRec && cfsRec.rcept_no) || (fa && fa.rcept_no) || '');
    }

    // --- IF1 영업외손익 비중 (추가 수집 필요) ---
    const mainRec = fx ? fxKrw(fx.CFS) || fxKrw(fx.OFS) : null;
    if (extra.fin && mainRec && !fh && mainRec.op != null && mainRec.pretax != null) {
      const nonop = mainRec.pretax - mainRec.op;
      const ratio = mainRec.op !== 0 ? Math.abs(nonop) / Math.abs(mainRec.op) : Infinity;
      if (Math.abs(nonop) >= P.if1MinAbs && ratio >= P.if1Ratio) {
        const label = mainRec.op === 0 ? '(영업이익 0)' : `(영업이익의 ${pct(ratio)})`;
        addHit('IF1', `영업외손익 ${nonop >= 0 ? '+' : ''}${won(nonop)} ${label} · ${mainRec.fs_div === 'CFS' ? '연결' : '별도'}${fyTag(mainRec)}`, '', `FIN:${corp}:IF1`, mainRec.rcept_no, ratio === Infinity ? null : ratio);
      }
    }

    // --- RS2 감사의견 비적정 ---
    const opinion = c.audit_opinion || '';
    if (/한정|부적정|의견거절/.test(opinion)) {
      addHit('RS2', `2025 감사의견: ${opinion}`, '', `AUD:${corp}:RS2`, c.primary_report_rcept_no || '');
    }

    // --- RS3 자본잠식 (추가 수집 필요) ---
    if (extra.fin && mainRec && mainRec.capital > 0 && mainRec.equity != null) {
      const cap = mainRec.capital;
      const eq = mainRec.equity;
      if (eq <= 0) {
        addHit('RS3', `전액잠식 (자본총계 ${won(eq)}, 자본금 ${won(cap)})${fyTag(mainRec)}`, '', `FIN:${corp}:RS3`, mainRec.rcept_no, 1);
      } else if ((cap - eq) / cap >= P.rs3Ratio) {
        const r = (cap - eq) / cap;
        addHit('RS3', `자본잠식률 ${pct(r)} (자본금 ${won(cap)}, 자본총계 ${won(eq)})${fyTag(mainRec)}`, '', `FIN:${corp}:RS3`, mainRec.rcept_no, r);
      }
    }

    // --- RS1 부도·회생·채권은행 관리·감자 (감자결정은 자본잠식 50% 이상일 때만) ---
    const impaired = hits.some((h) => h.id === 'RS3');
    const distressSig = distress.filter((f) => !RE_CAP_REDUCTION.test(baseTitle(f.t)) || impaired);
    const capOnly = distress.filter((f) => !distressSig.includes(f));
    if (extra.major) filingHit('RS1', distressSig);
    if (capOnly.length) notes.push(extra.fin ? TX.rs1CapReductionNote : TX.rs1CapReductionNoFinNote);
    for (const f of distressSig) filings.push({ cat: 'DISTRESS', ...f });
    for (const f of capOnly) filings.push({ cat: 'DISTRESS', ...f, nosig: true });
    // 최근 신호 공시 = 신호 근거가 되는 공시만(신호에서 뺀 감자결정은 제외)
    for (const f of [...mna, ...distressSig, ...fraud]) if (f.d >= from3m) recent3m.add(f.r);

    const sz = krwAssets == null ? 'U' : krwAssets >= P.sizeLarge ? 'L' : krwAssets >= P.sizeMid ? 'M' : 'S';
    const ct = c.contacts || {};
    const ig = industryGroup(c.industry_code);
    summary.push({
      c: corp,
      n: name,
      s: c.stock_code,
      m: c.market,
      ig,
      au: currentAuditor,
      ag,
      a: krwAssets,
      rv: cur === 'KRW' ? revenueBase : null,
      op: cur === 'KRW' ? opBase : null,
      sz,
      ceo: c.ceo || '',
      ph: ct.phone || '',
      fx: ct.fax || '',
      hp: ct.homepage || '',
      ad: ct.address || '',
      h: hits.map((h) => [h.id, h.ev, h.d, h.k, h.r]),
    });

    for (const f of [...mna, ...distressSig, ...fraud]) {
      const cat = mna.includes(f) ? 'MNA' : distressSig.includes(f) ? 'DISTRESS' : 'FRAUD';
      recent.push({ c: corp, n: name, cat, t: readable(f.t), d: f.d, r: f.r, samil: ag === 'SAMIL', ...(f.rel ? { rel: true } : {}) });
    }

    details[corp] = {
      c: corp,
      n: name,
      s: c.stock_code,
      m: c.market,
      dartName: c.dart_name || name,
      ceo: c.ceo || '',
      listed: isoDate(c.listed_date || ''),
      ig,
      ic: c.industry_code || '',
      accMt: c.closing_month || '',
      au: currentAuditor,
      auSrc,
      ag,
      opinion,
      kam: c.core_audit_text || '',
      primary: c.primary_report_rcept_no || '',
      contact: { phone: ct.phone || '', fax: ct.fax || '', homepage: ct.homepage || '', ir: ct.ir_homepage || '', address: ct.address || '' },
      fin: { basis, currency: cur, assets, revenue: revenueBase, op: opBase, rcept: fa ? fa.rcept_no || '' : '' },
      finx: fx ? { CFS: fx.CFS || null, OFS: fx.OFS || null } : null,
      hist: [...hist.entries()].sort((a, b) => b[0] - a[0]).map(([y, v]) => [y, v.raw, v.r]),
      filings: filings.sort((a, b) => b.d.localeCompare(a.d)),
      h: hits,
      notes,
    };
  }

  recent.sort((a, b) => b.d.localeCompare(a.d));
  const meta = {
    dataAsOf: asOf,
    baseCollectedAt: base.meta.collected_at,
    builtAt: new Date().toISOString(),
    fiscalYear: base.meta.fiscal_year,
    universe: base.companies.length,
    included: summary.length,
    excluded,
    extra,
    extraMeta,
    signalCounts: counts,
    recent: recent.slice(0, 8),
    recent3m: recent3m.size,
    recentFrom,
  };

  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'detail'), { recursive: true });
  fs.writeFileSync(path.join(OUT, 'summary.json'), JSON.stringify({ meta, companies: summary }), 'utf8');
  const buckets = {};
  for (const [corp, d] of Object.entries(details)) {
    const b = corp.slice(-2);
    (buckets[b] ||= {})[corp] = d;
  }
  for (const [b, obj] of Object.entries(buckets)) {
    fs.writeFileSync(path.join(OUT, 'detail', `${b}.json`), JSON.stringify(obj), 'utf8');
  }

  // 추가 수집 대상 목록 (내용이 같으면 파일도 같아 깃 변경이 생기지 않는다)
  const universe = universeFromBase(base);
  fs.mkdirSync(path.dirname(UNIVERSE_FILE), { recursive: true });
  fs.writeFileSync(
    UNIVERSE_FILE,
    JSON.stringify({ baseCollectedAt: base.meta.collected_at, count: universe.length, companies: universe }),
    'utf8',
  );

  const size = fs.statSync(path.join(OUT, 'summary.json')).size;
  log(`데이터 기준일 ${asOf} · 대상 ${summary.length}곳 (제외: 스팩 ${excluded.spac}, 리츠·펀드 ${excluded.reitFund})`);
  log(`추가 수집 반영: ${Object.entries(extra).map(([k, v]) => `${k}=${v ? 'O' : '-'}`).join(' ')}`);
  if (audIgnored.length) {
    const eg = [...new Set(audIgnored.map((r) => r.auditor_raw))].slice(0, 5).join(', ');
    log(`2026 반기 감사인 중 감사인 이름이 아닌 값 ${audIgnored.length}곳은 쓰지 않고 2025 감사인을 썼어요 (예: ${eg})`);
  }
  log(`신호별 해당 기업 수: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  log(`summary.json ${(size / 1024).toFixed(0)}KB, detail 파일 ${Object.keys(buckets).length}개 → ${OUT}`);
  log(`추가 수집 대상 목록 ${universe.length}곳 → data/universe.json`);
}

main();
