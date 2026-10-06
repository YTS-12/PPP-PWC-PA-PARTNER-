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
// 영업양도결정은 사업부를 떼어 내는 거래라 분할과 같이 PA3·IC3(MNA)로 본다
const RE_MNA = /회사합병결정|회사분할결정|회사분할합병결정|영업양수결정|영업양도결정|타법인주식및출자증권양수결정|주식교환[ㆍ·]?이전결정/;
const RE_DISTRESS = /부도발생|영업정지|회생절차개시신청|해산사유발생|채권은행등의관리절차(개시|중단)|감자결정/;
const RE_FRAUD = /횡령|배임/;
// 횡령·배임 정식 공시(혐의발생·진행사항·사실확인). 그 밖에 제목에 횡령·배임이 든 공시(풍문 조회공시 등)는 '관련 공시'
const RE_FRAUD_FORMAL = /^횡령[ㆍ·]?배임/;
const RE_CAP_REDUCTION = /감자결정/;
// 영업정지: 인허가 행정처분인 경우가 많아 감사의견 비적정(RS2)·자본잠식 50% 이상(RS3)과 같은 회사이거나
// 최근 12개월 안에 같은 회사에 신호로 인정된 거래소 시장조치(MARKET, nosig 없는 것)가 있을 때만 RS1
const RE_SUSPENSION = /영업정지/;
// 거래소 시장조치(filings_krx 의 cat 'MARKET', 또는 cat 'FRAUD' 이면서 mkt 가 있는 행. collect:krx 가 분류).
// 수집 쪽과 이중 안전장치로 이 말이 든 제목은 빼고 본다(list-search.mjs 의 MARKET_EXCLUDE 와 같은 목록. 둘을 함께 고친다)
const RE_MARKET_EXCLUDE = /우려|해제|해소|미진행|미해당|면제|자율공시|개선계획|제외/;
const MARKET_KINDS = new Set(['실질심사', '상장폐지사유', '관리종목', '반기부적정', '내부결산', '중요한영업정지']);
// 매매거래정지(중요한 영업정지): 회사의 영업정지 공시에 따라 그날 자동으로 걸리는 정지(코스닥시장공시규정 제37조)라
// 독립된 거래소 확인이 아니다 → RS1 근거·영업정지 예외에 쓰지 않고 근거 공시 목록에 nosig 'selfHalt'로 남긴다(2026-10-06 결정 C)
const MKT_SELF_HALT = '중요한영업정지';
// 내부결산 시점 공시('내부결산시점관리종목지정ㆍ형식적상장폐지ㆍ상장적격성실질심사사유발생' 류): 회사가 감사 전에 낸 공시라
// 관리종목과 나눠 mkt '내부결산'(2026-10-06 결정 E. RS1 근거로는 유지). collect:krx(list-search.mjs marketKind)는 중요한영업정지 다음,
// 관리종목·실질심사보다 먼저 제목의 '내부결산'으로 고른다. 그 전에 받은 옛 행(mkt '관리종목' 등)도 여기서 제목으로 같게 고친다
const RE_INTERNAL = /내부결산/;
const marketKindOf = (mkt, t) => {
  if (!MARKET_KINDS.has(mkt)) return null;
  return mkt !== MKT_SELF_HALT && RE_INTERNAL.test(baseTitle(t)) ? '내부결산' : mkt;
};
// 정정 내용이 거래소 시장조치·내부결산 사유의 해소면 collect:corrections 가 withdrawn true · withdraw_kw '사유 해소'로 저장한다
// → 철회와 같이 신호에서 빼고 nosig 'resolved'(2026-10-06 결정 B)
const RESOLVED_KW = '사유 해소';
// RS1 대표 근거 우선순위(작을수록 먼저): 부도 > 회생 > 해산 > 채권은행 관리(개시·중단) > 거래소 시장조치 > 감자(RS3 동반) > 영업정지.
// 시장조치끼리는 상장폐지 사유 > 상장적격성 실질심사 > 반기 검토의견 부적정 등 > 관리종목 지정 > 내부결산 기준 사유 발생(2026-10-06 결정 D).
// 같은 순위면 최초 공시일(ed) 최신 순(byEventDesc)
const RS1_RANK = [
  [/부도발생/, 0],
  [/회생절차개시신청/, 1],
  [/해산사유발생/, 2],
  [/채권은행등의관리절차(개시|중단)/, 3],
  [/감자결정/, 5],
  [/영업정지/, 6],
];
const RS1_RANK_MARKET = 4;
const MKT_RANK = { 상장폐지사유: 0, 실질심사: 1, 반기부적정: 2, 관리종목: 3, 내부결산: 4 };
const rs1Rank = (f) =>
  f.cat === 'MARKET'
    ? RS1_RANK_MARKET * 10 + (MKT_RANK[f.mkt] ?? 9)
    : (RS1_RANK.find(([re]) => re.test(baseTitle(f.t))) || [null, 9])[1] * 10;
const TX = CONFIG.texts || {};
/** texts 의 '{이름}' 자리를 채운다. 값이 없는 자리는 그대로 둔다 */
const fill = (s, vars = {}) => String(s || '').replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
const isDeadline = (t) => /연장/.test(t) && /(사업보고서|제출기한)/.test(t);
const readable = (t) => (t || '').replace(/^(\s*\[[^\]]*\])+/, '').replace(/\s{2,}/g, ' ').trim();
// 정정공시: 맨 앞 대괄호 머리말 중 '정정'이 든 것([기재정정]·[첨부정정]·[정정명령부과][첨부정정] 등). [첨부추가]·[연장결정]은 아니다.
// 최종 보고서만 받으므로 근거일이 정정 접수일일 수 있다. 정정 정보(corrections.jsonl)로 최초 공시일을 알면 '최초 … · 정정 …',
// 모르면 근거 문구 끝에 '(정정공시)'를 붙이고 목록에 corr 표시를 남긴다
const isCorrection = (t) => /정정/.test(((t || '').match(/^(\s*\[[^\]]*\])+/) || [''])[0]);

// ---------- 횡령·배임(IC2) 유형 ----------
const IC2_TYPE_TEXT = { occur: 'ic2TypeOccur', progress: 'ic2TypeProgress', fact: 'ic2TypeFact', rel: 'ic2TypeRel' };
const IC2_ORDER = { occur: 0, progress: 1, fact: 2, rel: 3 };
const RE_SUB = /\(자회사의주요경영사항\)/;
/** 횡령·배임 공시 유형: 정식 공시는 혐의발생(occur)·진행사항(progress)·사실확인(fact), 그 밖은 관련 공시(rel). sub = 자회사 공시 */
function ic2Info(t) {
  const b = baseTitle(t);
  const sub = RE_SUB.test(b);
  let ic2t = 'rel';
  if (RE_FRAUD_FORMAL.test(b)) {
    const rest = b.replace(RE_FRAUD_FORMAL, '');
    ic2t = /^혐의발생/.test(rest) ? 'occur' : /^사실확인/.test(rest) ? 'fact' : 'progress';
  }
  return { ic2t, ...(sub ? { sub: true } : {}), ...(ic2t === 'rel' ? { rel: true } : {}) };
}

/**
 * 거래소 시장조치 근거 제목. '주권매매거래정지기간변경 (상장적격성 실질심사 대상 결정)'·'기타시장안내 (…)'는 괄호 안 내용,
 * 내부결산 시점 공시는 종류 이름 '내부결산 기준 사유 발생(감사 전)'(texts mktInternal, 결정 E),
 * 그 밖('반기검토(감사)의견부적정등사실확인(…)' 등)은 머리말을 뗀 제목 그대로
 */
function marketTitle(f) {
  const r = readable(f.t);
  if (f.mkt === '내부결산') return TX.mktInternal || r;
  if (f.mkt === MKT_SELF_HALT) return r;
  const m = r.match(/^(?:주권매매거래정지(?:기간변경)?|기타시장안내)\s*\(\s*(.+)\)\s*$/);
  if (!m) return r;
  let s = m[1].trim();
  // 짝 없는 닫는 괄호: '(상장적격성 실질심사 대상(사유발생)))'
  while ((s.match(/\)/g) || []).length > (s.match(/\(/g) || []).length && s.endsWith(')')) s = s.slice(0, -1).trim();
  return s;
}

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
// 기준 미만임을 보여 줄 때는 내림한다(49.6%를 '50%'로 적으면 '50% 미만'과 어긋남)
const pctFloor = (x) => (x < 0.01 ? '1% 미만' : `${Math.floor(x * 100)}%`);

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
 * 화면용 감사인명 (summary·detail의 au, PA2 근거 문구). 원문은 detail hist에만 그대로 둔다.
 * 표 칸 안 줄바꿈(한글 사이)은 붙이고 나머지 공백은 한 칸으로 줄인다. 각주 '(*)'·'(*1)'·'(주1)'·'*'와
 * '대표이사 …'·'대표공인회계사 …' 이하를 지운다. '(주)'·'(PwC)'·'(지정감사인)'·'(구, …)' 같은 괄호는 남긴다.
 * 예: '삼정\n회계법인' → '삼정회계법인', '우리회계법인\n(주1)' → '우리회계법인', '삼일회계법인 대표이사 윤 훈 수' → '삼일회계법인'
 */
function displayAuditor(a) {
  return String(a ?? '')
    .replace(/([가-힣])[ \t]*[\r\n]+[ \t]*(?=[가-힣])/g, '$1')
    .replace(/\s*(대표이사|대표공인회계사)[\s\S]*$/, '')
    .replace(/\(\s*\*?\s*(?:주\s*)?\d*\s*\)+/g, (m) => (/[*\d]/.test(m) ? '' : m))
    .replace(/\*/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

// 정규화 뒤 이름의 오타 (정확히 같은 이름만 고친다). 원문 예: '삼회회계법인'·'정신세림회계법인'·'정진세람 회계법인'·'삼덛회계법인'·'심한회계법인'
const AUDITOR_TYPO = new Map([
  ['삼회', '삼화'],
  ['정신세림', '정진세림'],
  ['정진세람', '정진세림'],
  ['삼덛', '삼덕'],
  ['심한', '신한'],
]);

/**
 * 감사인 비교용 이름 (PA2 연속 판정·감사인 그룹 공용). 화면에 보이는 이름(au)은 displayAuditor, 원문(hist)은 그대로.
 * 괄호와 그 안(겹괄호 포함)·주식회사·㈜·'대표이사 …'·공백·기호를 지우고, 오타(회게법인·화계법인 등)를 고친 뒤
 * 대형 4곳은 '삼일'·'삼정'·'안진'·'한영'으로 통일, 나머지는 맨 앞 영문 접두(EY·딜로이트·Deloitte·KPMG·PwC)와
 * 앞뒤의 '회계법인'을 뗀 뒤 오타 표(AUDITOR_TYPO)와 정확히 같으면 고친다.
 * 예: 'EY한영회계법인'·'한영 회계법인' → '한영', '회계법인 세일원'·'세일원 회계법인' → '세일원', '삼회회계법인' → '삼화'
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
  return AUDITOR_TYPO.get(core) || core || s;
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
  const holdingName = /홀딩스|지주/.test(name);
  if (c.startsWith('715') || c.startsWith('64992')) return '지주회사';
  // 업종이 기타 금융업(649 등)으로 잡힌 지주회사(오리온홀딩스·미원홀딩스 등)는 금융업이 아니라 지주회사로 표시한다(판정은 같은 IF2)
  if (/^6[456]/.test(c)) return holdingName ? '지주회사(회사명·업종 기타금융)' : '금융업';
  if (holdingName) return '지주회사(회사명 기준)';
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
  const extraCorr = readExtra('corrections');
  const extraSupp = readExtra('auditor_supp');
  const extraWeb = readExtra('auditor_web');
  const extraMeta = readExtraMeta();
  const extra = {
    fin: extraFin.collected,
    auditor2026: extraAud.collected,
    major: extraMajor.collected,
    krx: extraKrx.collected,
    deadline: extraDeadline.collected,
    corrections: extraCorr.collected,
    auditorSupp: extraSupp.collected,
    auditorWeb: extraWeb.collected,
  };
  const FY = Number(base.meta.fiscal_year);
  const HY = 2026; // 반기 감사인 연도(auditor_2026h1)

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
  // 감사인 보완(감사용역 체결현황): 회사·연도마다 감사인 이름인 값만 쓴다
  const suppBy = new Map();
  for (const r of extraSupp.rows) {
    if (r.auditor_raw && looksLikeAuditor(r.auditor_raw)) suppBy.set(`${r.corp_code}:${Number(r.bsns_year)}`, r);
  }
  // 감사인 화면 보완(DART 공시 화면 '외부감사에 관한 사항' 표, collect:auditor-web · 2026-10-06 결정 A): 회사·연도마다 감사인 이름인 값만 쓴다
  // (감사인 아님·당기 행 없음·외부감사 항목 없음인 행은 auditor_raw 가 비어 있어 쓰지 않는다)
  const webBy = new Map();
  for (const r of extraWeb.rows) {
    if (r.auditor_raw && looksLikeAuditor(r.auditor_raw)) webBy.set(`${r.corp_code}:${Number(r.bsns_year)}`, r);
  }
  const majorBy = groupBy(extraMajor.rows, (r) => r.corp_code);
  const krxBy = groupBy(extraKrx.rows, (r) => r.corp_code);
  const deadlineBy = groupBy(extraDeadline.rows, (r) => r.corp_code);
  // 정정 정보: 정정본 접수번호 → {first_date, first_rcept_no, withdrawn, attach_only, …}
  const corrBy = new Map(extraCorr.rows.map((r) => [r.rcept_no, r]));

  const summary = [];
  const details = {};
  const recent = [];
  const counts = Object.fromEntries(CONFIG.signals.map((s) => [s.id, 0]));
  const excluded = { spac: 0, reitFund: 0 };
  const recent3m = new Set();
  const recent3mNoSamil = new Set();
  // 빌드 로그용 집계
  const stat = {
    nosig: {},
    corrApplied: 0,
    firstKnown: 0,
    linkOrig: 0,
    supp2026: 0,
    supp2025: 0,
    web2026: 0,
    web2025: 0,
    est: 0,
    estSamil: 0,
    rs1ByMarket: 0,
    rs1MarketKind: {},
    pa1NonDec: 0,
    rs3Old: 0,
  };

  /**
   * 공시 한 건에 정정 정보를 붙인다. first: 최초 공시일(정정 접수일과 다를 때만), link: 첨부정정이면 결정 본문이 있는 원공시 접수번호,
   * withdrawn: 정정 내용이 철회·취하·부결 등, resolved: 그중 거래소 시장조치·내부결산 사유 해소(withdraw_kw '사유 해소', 결정 B).
   * ed: 최근 12개월 판정·정렬에 쓰는 날짜(최초 공시일, 없으면 접수일)
   */
  const enrich = (f) => {
    const c = corrBy.get(f.r);
    const out = { ...f };
    if (isCorrection(f.t) || c) out.corr = true;
    if (c) {
      stat.corrApplied++;
      const first = c.first_date ? isoDate(String(c.first_date)) : '';
      // 최초일이 정정 접수일보다 늦으면 잘못된 값으로 보고 쓰지 않는다
      if (first && first < f.d) {
        out.first = first;
        stat.firstKnown++;
      }
      if (c.attach_only && c.first_rcept_no && c.first_rcept_no !== f.r) {
        out.link = c.first_rcept_no;
        stat.linkOrig++;
      }
      if (c.withdrawn) {
        out.withdrawn = true;
        if (c.withdraw_kw === RESOLVED_KW) out.resolved = true;
      }
    }
    out.ed = out.first || out.d;
    return out;
  };
  // 근거 문구의 날짜: '최초 YYYY-MM-DD · 정정 YYYY-MM-DD', 최초일을 모르는 정정공시는 'YYYY-MM-DD (정정공시)', 그 밖은 날짜 하나
  const dateText = (f) => (f.first ? fill(TX.corrDates, { first: f.first, d: f.d }) : `${f.d}${f.corr ? ` (${TX.corrEvidence})` : ''}`);
  const byEventDesc = (a, b) => b.ed.localeCompare(a.ed) || b.d.localeCompare(a.d);
  // 상세 filings[] 한 건(화면 계약 C5 필드만)
  const filingOut = (cat, f, more = {}) => ({
    cat,
    t: f.t,
    d: f.d,
    r: f.r,
    ...(f.first ? { first: f.first } : {}),
    ...(f.link ? { link: f.link } : {}),
    ...(f.corr ? { corr: true } : {}),
    ...more,
  });

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
    if (cur && cur !== 'KRW') notes.push(fill(TX.notesFx, { cur }));
    // 기존 수집본은 재무가 없어도 assets를 {value:null, …} 객체로 갖고 있어 값으로 판단한다
    if ((!fa || fa.value == null) && !fx) notes.push(TX.notesNoFin);
    // 연장신고(PA1)는 12월 결산 회사의 3월 제출분만 모아서 12월 결산(또는 결산월 값 없음) 회사만 판정한다
    const decClose = !c.closing_month || c.closing_month === '12';
    if (!decClose) notes.push(TX.notesNonDec);

    // --- 감사인 이력 ---
    const hist = new Map();
    for (const h of c.auditor_history || []) {
      if (h.auditor) hist.set(h.year, { a: normAuditor(h.auditor), raw: h.auditor, r: h.rcept_no || '' });
    }
    const histOf = (raw, r) => ({ a: normAuditor(raw), raw, r: r || '' });
    const a26 = audBy.get(corp);
    // 보완은 앞 순서의 값이 없을 때만 쓴다(2026-10-06 결정 A): 2026은 반기 감사인 API → 감사용역 체결현황(s) → DART 공시 화면(w),
    // 2025는 기존 수집본 감사인 → 감사용역 체결현황 → DART 공시 화면
    const s26 = a26 ? null : suppBy.get(`${corp}:${HY}`) || null;
    const w26 = a26 || s26 ? null : webBy.get(`${corp}:${HY}`) || null;
    const s25 = c.auditor ? null : suppBy.get(`${corp}:${FY}`) || null;
    const w25 = c.auditor || s25 ? null : webBy.get(`${corp}:${FY}`) || null;
    const r26 = a26 || s26 || w26;
    if (r26) hist.set(HY, histOf(r26.auditor_raw, r26.rcept_no));
    const r25 = s25 || w25;
    if (r25 && !hist.has(FY)) {
      const prevR = ((c.auditor_history || []).find((h) => h.year === FY) || {}).rcept_no;
      hist.set(FY, histOf(r25.auditor_raw, r25.rcept_no || prevR));
    }
    // 현재 감사인(확정) = 2026 반기 감사인 API → 2026 감사용역 체결현황 → 2026 DART 공시 화면 → 2025 사업보고서(기존 수집본)
    // → 2025 감사용역 체결현황 → 2025 DART 공시 화면. 여섯 다 없으면 이력의 가장 최근 감사인을 '추정'으로 표시만 한다:
    // ae = 그 연도, aeAu = 이름, aeSamil = 삼일 여부.
    // 추정은 감사인 그룹을 정하지 않는다(ag = 'UNKNOWN') → 삼일 숨김은 확정 감사인 기준만(Q1: 아시아나항공은 이력상 삼일이지만 실제 삼정).
    // au는 화면용 이름(추정이면 추정 감사인 이름, 예전 화면 호환)
    let auRaw = '';
    let estRaw = '';
    let auSrc = TX.auSrcNone;
    let ae = null;
    if (a26) {
      auRaw = a26.auditor_raw;
      auSrc = fill(TX.auSrc2026, { year: HY });
    } else if (s26) {
      auRaw = s26.auditor_raw;
      auSrc = fill(TX.auSrcSupp2026, { year: HY });
      stat.supp2026++;
    } else if (w26) {
      auRaw = w26.auditor_raw;
      auSrc = fill(TX.auSrcWeb2026, { year: HY });
      stat.web2026++;
    } else if (c.auditor) {
      auRaw = c.auditor;
      auSrc = fill(TX.auSrc2025, { year: FY });
    } else if (s25) {
      auRaw = s25.auditor_raw;
      auSrc = fill(TX.auSrcSupp2025, { year: FY });
      stat.supp2025++;
    } else if (w25) {
      auRaw = w25.auditor_raw;
      auSrc = fill(TX.auSrcWeb2025, { year: FY });
      stat.web2025++;
    } else {
      const lastYear = Math.max(0, ...hist.keys());
      if (lastYear) {
        estRaw = hist.get(lastYear).raw;
        ae = lastYear;
        auSrc = fill(TX.auSrcEst, { year: lastYear });
      }
    }
    const currentAuditor = displayAuditor(auRaw || estRaw);
    const ag = (auRaw && auditorGroup(normAuditor(auRaw))) || 'UNKNOWN';
    const est = ae ? { ae, aeAu: displayAuditor(estRaw), aeSamil: auditorGroup(normAuditor(estRaw)) === 'SAMIL' } : {};
    if (ae) {
      stat.est++;
      if (est.aeSamil) stat.estSamil++;
    }

    // PA2 주기적 지정 도래·첫해 추정. 근거 문구 앞에 유형 머리말을 붙인다
    const pa2 = (type, ev, year) => addHit('PA2', `[${type}] ${ev}`, '', `AUD:${corp}`, hist.get(year).r);
    if (c.history_has_irregular_terms) {
      notes.push(TX.notesIrregular);
    } else if (hist.has(2026)) {
      const s26 = streakEnding(hist, 2026);
      const s25 = streakEnding(hist, 2025);
      if (s26.n === 6) {
        pa2(TX.pa2TypeDue, `${s26.from}~2026 같은 감사인(${displayAuditor(s26.a)}) 6년 연속 → 2027 사업연도 주기적 지정 가능(추정)`, 2026);
      } else if (s26.n > 6) {
        pa2(TX.pa2TypeDeferred, `${s26.from}~2026 같은 감사인(${displayAuditor(s26.a)}) ${s26.n}년 연속 → 6년 자유선임 뒤 지정 이월 또는 우수기업 유예·면제 가능 → 2027 지정 여부 확인 필요(추정)`, 2026);
      } else if (s25.n >= 6 && hist.get(2026).a !== hist.get(2025).a) {
        pa2(TX.pa2TypeFirst, `2020~2025 같은 감사인 6년 뒤 2026년 ${displayAuditor(hist.get(2026).raw)}(으)로 변경 → 주기적 지정 첫해 추정`, 2026);
      }
    } else {
      const s25 = streakEnding(hist, 2025);
      if (s25.n >= 6) {
        pa2(TX.pa2TypeCheck, `2020~2025 같은 감사인(${displayAuditor(s25.a)}) 6년 연속 → 2026년 지정 첫해이거나 유예 추정 (2026 감사인 확인 필요)`, 2025);
      } else if (s25.n === 5) {
        pa2(TX.pa2TypeCheck, `2021~2025 같은 감사인(${displayAuditor(s25.a)}) 5년 연속 → 2026년에도 같으면 2027 사업연도 지정 대상(추정)`, 2025);
      }
    }

    // --- 공시 (합병·분할·양수도 / 부도·회생·채권은행·감자·영업정지 / 횡령·배임 / 거래소 시장조치 / 연장신고) ---
    // 최근 12개월은 최초 공시일(ed) 기준. 정정 접수일만 12개월 안이고 최초 공시가 그 전이면 nosig 'old',
    // 정정 내용이 철회·취하·부결 등이면 nosig 'withdrawn'(시장조치·내부결산 사유 해소면 'resolved')으로 신호에서 빼고 근거 공시 목록에만 남긴다.
    // 한 공시에 여러 이유가 맞으면 withdrawn·resolved > old > selfHalt > cap·capUnknown·susp 순으로 하나만 붙인다
    let majorList;
    if (extra.major) {
      majorList = (majorBy.get(corp) || []).map((f) => ({ t: f.report_nm, d: isoDate(f.rcept_dt), r: f.rcept_no }));
    } else {
      majorList = (c.ma_reports || []).map((f) => ({ t: f.report_name, d: isoDate(f.date), r: f.rcept_no }));
    }
    const recentOnly = (arr) => arr.filter((f) => f.d >= recentFrom).map(enrich).sort(byEventDesc);
    const withdrawnOf = (f) => (f.withdrawn ? (f.resolved ? 'resolved' : 'withdrawn') : null);
    const offOf = (f) => withdrawnOf(f) || (f.ed < recentFrom ? 'old' : null);
    // 상세 안내(notes)를 붙이는 이유별 건수(회사당 이유마다 안내 한 번)
    const offN = { withdrawn: 0, resolved: 0, old: 0, selfHalt: 0 };
    const countOff = (reason) => {
      if (!reason) return;
      if (reason in offN) offN[reason]++;
      stat.nosig[reason] = (stat.nosig[reason] || 0) + 1;
    };
    const mnaAll = recentOnly(majorList.filter((f) => RE_MNA.test(baseTitle(f.t))));
    const mna = mnaAll.filter((f) => !offOf(f));
    const distress = recentOnly(majorList.filter((f) => RE_DISTRESS.test(baseTitle(f.t))));
    const krxRows = (krxBy.get(corp) || []).map((f) => ({ t: f.report_nm, d: isoDate(f.rcept_dt), r: f.rcept_no, cat: f.cat || 'FRAUD', mkt: f.mkt }));
    // 횡령·배임(cat 없는 옛 행은 FRAUD). 정렬: 최초 공시일(ed) 최신 → 같은 날이면 자사 먼저 → 혐의발생·진행사항·사실확인·관련 공시 순 → 접수일(d) 최신
    const fraudAll = recentOnly(krxRows.filter((f) => f.cat === 'FRAUD' && RE_FRAUD.test(f.t)).map(({ t, d, r }) => ({ t, d, r, ...ic2Info(t) }))).sort(
      (a, b) => b.ed.localeCompare(a.ed) || (a.sub ? 1 : 0) - (b.sub ? 1 : 0) || IC2_ORDER[a.ic2t] - IC2_ORDER[b.ic2t] || b.d.localeCompare(a.d),
    );
    const fraud = fraudAll.filter((f) => !offOf(f));
    // 거래소 시장조치: cat 'MARKET', 그리고 제목에 횡령·배임이 함께 있어 cat 'FRAUD' 에 mkt 가 붙은 행(예: 상장적격성 실질심사 대상 결정(횡령·배임)).
    // 뒤엣것은 같은 공시가 IC2(횡령·배임)와 RS1(시장조치) 근거로 함께 쓰인다. 공시 신호의 근거 키는 대표 근거 접수번호라
    // 두 신호의 대표 근거가 같은 공시면 점수는 1개로 센다(PA3·IC3와 같은 규칙). RS1 근거 · 영업정지 예외 확인에 쓴다.
    // mkt 는 marketKindOf 로 고친다(옛 행의 내부결산 시점 공시 → '내부결산', 결정 E).
    // 매매거래정지(중요한 영업정지)는 근거 공시 목록에만 남기고 nosig 'selfHalt'(결정 C): RS1 근거·영업정지 예외(marketConfirmed)·최근 공시에 안 쓴다
    const marketAll = recentOnly(
      krxRows
        .filter((f) => (f.cat === 'MARKET' || (f.cat === 'FRAUD' && MARKET_KINDS.has(f.mkt))) && !RE_MARKET_EXCLUDE.test(baseTitle(f.t)))
        .map(({ t, d, r, mkt, cat }) => {
          const k = marketKindOf(mkt, t);
          return { t, d, r, ...(k ? { mkt: k } : {}), ...(cat === 'FRAUD' ? { alsoFraud: true } : {}) };
        }),
    );
    const marketOffOf = (f) => offOf(f) || (f.mkt === MKT_SELF_HALT ? 'selfHalt' : null);
    const market = marketAll.filter((f) => !marketOffOf(f));
    // 연장신고 대상 사업연도: 제목의 '(2023.12)' → 2023. 없으면 제출 연도 − 1 (3월 제출 = 직전 사업연도 보고서)
    const fiscalOf = (f) => {
      const m = baseTitle(f.report_nm).match(/\((\d{4})\.\d{1,2}\)/);
      return m ? Number(m[1]) : (f.year || Number(isoDate(f.rcept_dt).slice(0, 4))) - 1;
    };
    // 연장신고는 3개년 제출분(12개월 판정 아님)이라 'old'는 쓰지 않고 철회만 뺀다
    const extAll = (deadlineBy.get(corp) || [])
      .map((f) => ({ t: f.report_nm, d: isoDate(f.rcept_dt), r: f.rcept_no, y: fiscalOf(f) }))
      .filter((f) => isDeadline(baseTitle(f.t)))
      .map(enrich)
      .sort(byEventDesc);
    const ext = extAll.filter((f) => !withdrawnOf(f));

    // 근거 문구 '제목 · 날짜 외 N건'. 접수번호(r)는 첨부정정이면 원공시(link), 근거 키(k)는 정정본 접수번호
    const filingHit = (id, list, title = (f) => readable(f.t)) => {
      if (!list.length) return;
      const f = list[0];
      const more = list.length > 1 ? ` 외 ${list.length - 1}건` : '';
      addHit(id, `${title(f)} · ${dateText(f)}${more}`, f.ed, f.r, f.link || f.r);
    };
    filingHit('PA3', mna);
    filingHit('IC3', mna);
    // RS1은 자본잠식(RS3) 판정 뒤에 정한다(감자결정은 자본잠식 50% 이상일 때만 신호)
    if (extra.krx && fraud.length) {
      // 대표 근거는 정식 공시(혐의발생·진행사항·사실확인) 중 최신(같은 날이면 자사 먼저), 없으면 관련 공시 중 최신.
      // 근거 문구 앞에 유형 머리말, 자회사 공시는 '자회사'를 붙인다
      const formal = fraud.filter((f) => !f.rel);
      const list = [...formal, ...fraud.filter((f) => f.rel)];
      filingHit('IC2', list, (f) => {
        const t = readable(f.t).replace(/\s*\(\s*자회사의\s*주요경영사항\s*\)\s*/, '').trim();
        return `[${TX[IC2_TYPE_TEXT[f.ic2t]]}] ${t}${f.sub ? ` · ${TX.ic2SubTag}` : ''}`;
      });
      const relN = fraud.length - formal.length;
      if (relN) notes.push(fill(TX.ic2RelatedNote, { n: relN }));
    }
    if (extra.deadline && ext.length && !decClose) stat.pa1NonDec++;
    if (extra.deadline && ext.length && decClose) {
      const years = [...new Set(ext.map((f) => f.y))].sort();
      // 가장 긴 연속 사업연도 수 (2년 이상이면 표시)
      let run = 1;
      let best = 1;
      for (let i = 1; i < years.length; i++) {
        run = years[i] === years[i - 1] + 1 ? run + 1 : 1;
        best = Math.max(best, run);
      }
      const latest = ext[0];
      const corrPart = latest.first ? ` · ${dateText(latest)}` : latest.corr ? ` (${TX.corrEvidence})` : '';
      addHit('PA1', `${years.join('·')} 사업연도 사업보고서 제출기한 연장신고${best >= 2 ? ` (${best}년 연속)` : ''}${corrPart}`, latest.ed, latest.r, latest.link || latest.r);
    }
    for (const f of mnaAll) {
      const off = offOf(f);
      countOff(off);
      filings.push(filingOut('MNA', f, off ? { nosig: off } : {}));
    }
    for (const f of fraudAll) {
      const off = offOf(f);
      countOff(off);
      filings.push(filingOut('FRAUD', f, { ...(f.rel ? { rel: true } : {}), ...(f.sub ? { sub: true } : {}), ic2t: f.ic2t, ...(off ? { nosig: off } : {}) }));
    }
    for (const f of marketAll) {
      const off = marketOffOf(f);
      // 횡령·배임 제목의 시장조치는 위 FRAUD 목록에도 있어 신호 제외 수는 한 번만 센다(목록에는 분류마다 한 줄씩).
      // FRAUD 줄에 없는 이유(selfHalt)는 MARKET 줄에서 센다
      if (!f.alsoFraud || off !== offOf(f)) countOff(off);
      filings.push(filingOut('MARKET', f, { ...(f.mkt ? { mkt: f.mkt } : {}), ...(off ? { nosig: off } : {}) }));
    }
    for (const f of extAll) {
      const off = withdrawnOf(f);
      countOff(off);
      filings.push(filingOut('DEADLINE', f, off ? { nosig: off } : {}));
    }

    // --- IC1 2029 연결 내부회계 감사 대상 ---
    // IC1·IF3는 같은 '자산 규모' 사실이라 근거 키를 FIN:<corp>:SIZE 하나로 써서 점수에서 1개로 센다(PA3·IC3처럼)
    if (fx && (fx.CFS || fx.OFS)) {
      const rec = fxKrw(P.ic1AssetBasis === 'CFS' ? fx.CFS : fx.OFS);
      if (fx.CFS && rec && rec.assets != null && rec.assets >= P.ic1MinAssets && rec.assets < P.ic1MaxAssets) {
        addHit('IC1', `자산총계 ${won(rec.assets)}(${P.ic1AssetBasis === 'CFS' ? '연결' : '별도'})${fyTag(rec)} · 연결 작성 → 2029 사업연도 연결 내부회계 감사(현행 일정)`, '', `FIN:${corp}:SIZE`, rec.rcept_no);
      }
    } else if (basis === 'CFS' && krwAssets != null && krwAssets >= P.ic1MinAssets && krwAssets < P.ic1MaxAssets) {
      addHit('IC1', `연결 자산총계 ${won(krwAssets)} · 연결 작성 → 2029 사업연도 연결 내부회계 감사(현행 일정, 연결 자산 근사)`, '', `FIN:${corp}:SIZE`, fa.rcept_no || '');
    }

    // --- IF2 지주회사·금융업 ---
    const fh = finOrHolding(c.industry_code, name);
    if (fh) addHit('IF2', `업종: ${fh} · 주된 사업활동 판단 필요`, '', `IND:${corp}`, '');

    // --- IF3 자산 5천억 이상 + 연결 ---
    const cfsRec = fx ? fxKrw(fx.CFS) : null;
    const cfsAssets = cfsRec ? cfsRec.assets : basis === 'CFS' ? krwAssets : null;
    if (cfsAssets != null && cfsAssets >= P.if3MinAssets) {
      addHit('IF3', `연결 자산총계 ${won(cfsAssets)} · 연결 작성${cfsRec ? fyTag(cfsRec) : ''}`, '', `FIN:${corp}:SIZE`, (cfsRec && cfsRec.rcept_no) || (fa && fa.rcept_no) || '');
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
    if (!opinion) notes.push(TX.notesNoOpinion);

    // --- RS3 자본잠식 (추가 수집 필요) ---
    // 자본금은 주 레코드(연결 우선) 값을 쓰고, 연결 자본금이 비면 같은 연도 별도(OFS) 자본금으로 대신한다(근거에 '별도' 표기).
    // 지배기업 자본금은 연결·별도가 같아서다. capRatio = 잠식률(판정 못 하면 null) → 감자결정 RS1 판정에도 쓴다
    let capRatio = null;
    if (extra.fin && mainRec) {
      let cap = mainRec.capital;
      let capTag = '';
      if (!(cap > 0) && mainRec.fs_div === 'CFS') {
        const ofs = fxKrw(fx.OFS);
        if (ofs && ofs.bsns_year === mainRec.bsns_year && ofs.capital > 0) {
          cap = ofs.capital;
          capTag = '(별도)';
        }
      }
      const eq = mainRec.equity;
      // 2025 사업보고서가 없어(미제출) 이전 연도로 판정하면 그 뒤 감자·분기보고서로 달라졌을 수 있다는 주의를 붙인다 (Q1: 피씨엘)
      const oldYear = Number(mainRec.bsns_year) && Number(mainRec.bsns_year) !== FY;
      const rs3Caution = oldYear ? ` (${fill(TX.rs3OldYearCaution, { fy: FY })})` : '';
      if (cap > 0 && eq != null) {
        capRatio = (cap - eq) / cap;
        if (eq <= 0) {
          addHit('RS3', `전액잠식 (자본총계 ${won(eq)}, 자본금 ${won(cap)}${capTag})${fyTag(mainRec)}${rs3Caution}`, '', `FIN:${corp}:RS3`, mainRec.rcept_no, 1);
        } else if (capRatio >= P.rs3Ratio) {
          addHit('RS3', `자본잠식률 ${pct(capRatio)} (자본금 ${won(cap)}${capTag}, 자본총계 ${won(eq)})${fyTag(mainRec)}${rs3Caution}`, '', `FIN:${corp}:RS3`, mainRec.rcept_no, capRatio);
        }
        if (oldYear && (eq <= 0 || capRatio >= P.rs3Ratio)) stat.rs3Old++;
      } else {
        // 자본금(별도로도 못 채움) 또는 자본총계가 비어 판정 불가 (예: 젬백스는 연결 자본 계정이 모두 비어 있음)
        notes.push(TX.notesNoCapital);
      }
    }

    // --- RS1 부도·회생·채권은행 관리(개시·중단)·거래소 시장조치 (감자결정은 RS3, 영업정지는 RS2·RS3·거래소 시장조치와 같은 회사일 때만) ---
    const impaired = hits.some((h) => h.id === 'RS3');
    const badOpinion = hits.some((h) => h.id === 'RS2');
    // 영업정지 예외: 최근 12개월 안에 신호로 인정된 거래소 시장조치(selfHalt·resolved·withdrawn·old 제외)가 있을 때만(결정 B·C)
    const marketConfirmed = extra.krx && market.length > 0;
    // 신호에서 빼는 이유: withdrawn(철회·취하 확인) · resolved(시장조치 사유 해소, 주요사항보고서에는 보통 없음) ·
    // old(최초 공시가 12개월 전) · cap(자본잠식 50% 미만 감자) · capUnknown(자본잠식 판정 불가 감자) ·
    // susp(재무위험 신호·신호로 인정된 거래소 시장조치 없는 영업정지)
    const nosigOf = (f) => {
      const off = offOf(f);
      if (off) return off;
      const t = baseTitle(f.t);
      if (RE_CAP_REDUCTION.test(t)) return impaired ? null : capRatio == null ? 'capUnknown' : 'cap';
      if (RE_SUSPENSION.test(t)) return impaired || badOpinion || marketConfirmed ? null : 'susp';
      return null;
    };
    const distressSig = distress.filter((f) => !nosigOf(f));
    // RS1 근거 후보 = 주요사항보고서(DISTRESS) 신호 공시 + 신호로 인정된 거래소 시장조치. 대표 근거는 우선순위
    // (부도 > 회생 > … > 거래소 시장조치(상장폐지 사유 > 실질심사 > 반기 부적정 > 관리종목 > 내부결산) > 감자 > 영업정지) → 최신 순
    const rs1List = [...distressSig.map((f) => ({ ...f, cat: 'DISTRESS' })), ...(extra.krx ? market.map((f) => ({ ...f, cat: 'MARKET' })) : [])].sort(
      (a, b) => rs1Rank(a) - rs1Rank(b) || byEventDesc(a, b),
    );
    if (extra.major || (extra.krx && market.length)) {
      filingHit('RS1', rs1List, (f) => (f.cat === 'MARKET' ? `[${TX.marketTag}] ${marketTitle(f)}` : readable(f.t)));
      if (rs1List.length && rs1List[0].cat === 'MARKET') {
        stat.rs1ByMarket++;
        const k = rs1List[0].mkt || '-';
        stat.rs1MarketKind[k] = (stat.rs1MarketKind[k] || 0) + 1;
      }
    }
    // 안내는 이유마다 회사당 한 번
    const offKinds = new Set(distress.map(nosigOf).filter(Boolean));
    if (offKinds.has('capUnknown')) notes.push(extra.fin ? TX.rs1CapUnknownNote : TX.rs1CapReductionNoFinNote);
    else if (offKinds.has('cap')) notes.push(capRatio > 0 ? fill(TX.rs1CapPartialNote, { pct: pctFloor(capRatio) }) : TX.rs1CapReductionNote);
    // 영업정지 신호 제외: 자본잠식(RS3)을 판정하지 못한 회사는 'RS3 없음'이 아니라 '판정 불가'로 따로 알린다
    if (offKinds.has('susp')) notes.push(capRatio == null ? TX.rs1SuspCapUnknownNote : TX.rs1SuspNote);
    for (const f of distress) {
      const off = nosigOf(f);
      countOff(off);
      filings.push(filingOut('DISTRESS', f, off ? { nosig: off } : {}));
    }
    // 정정 정보·자동 정지로 신호에서 뺀 공시 안내(이유마다 회사당 한 번)
    if (offN.withdrawn) notes.push(fill(TX.withdrawnNote, { n: offN.withdrawn }));
    if (offN.resolved) notes.push(fill(TX.resolvedNote, { n: offN.resolved }));
    if (offN.old) notes.push(fill(TX.oldNote, { n: offN.old }));
    if (offN.selfHalt) notes.push(fill(TX.selfHaltNote, { n: offN.selfHalt }));
    // 최근 신호 공시 = 신호 근거가 되는 공시만(nosig 공시 제외). 3개월도 최초 공시일 기준. 삼일 감사 고객 공시를 뺀 수도 따로 센다
    const rs1Market = extra.krx ? market : [];
    for (const f of [...mna, ...distressSig, ...rs1Market, ...fraud]) {
      if (f.ed < from3m) continue;
      recent3m.add(f.r);
      if (ag !== 'SAMIL') recent3mNoSamil.add(f.r);
    }

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
      ...est,
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

    // 같은 공시가 시장조치·횡령·배임 둘 다면(횡령·배임 제목의 시장조치) 최근 신호 공시에는 한 번만(먼저 나온 MARKET으로) 넣는다
    const recentSeen = new Set();
    for (const [cat, list] of [
      ['MNA', mna],
      ['DISTRESS', distressSig],
      ['MARKET', rs1Market],
      ['FRAUD', fraud],
    ]) {
      for (const f of list) {
        if (recentSeen.has(f.r)) continue;
        recentSeen.add(f.r);
        recent.push({
          c: corp,
          n: name,
          cat,
          t: readable(f.t),
          d: f.d,
          r: f.r,
          ...(f.first ? { first: f.first } : {}),
          ...(f.link ? { link: f.link } : {}),
          ed: f.ed,
          samil: ag === 'SAMIL',
          ...(f.rel ? { rel: true } : {}),
          ...(f.corr ? { corr: true } : {}),
        });
      }
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
      ...est,
      opinion,
      kam: c.core_audit_text || '',
      primary: c.primary_report_rcept_no || '',
      contact: { phone: ct.phone || '', fax: ct.fax || '', homepage: ct.homepage || '', ir: ct.ir_homepage || '', address: ct.address || '' },
      fin: { basis, currency: cur, assets, revenue: revenueBase, op: opBase, rcept: fa ? fa.rcept_no || '' : '' },
      finx: fx ? { CFS: fx.CFS || null, OFS: fx.OFS || null } : null,
      hist: [...hist.entries()].sort((a, b) => b[0] - a[0]).map(([y, v]) => [y, v.raw, v.r]),
      // 최초 공시일(없으면 접수일) 최신 순
      filings: filings.sort((a, b) => (b.first || b.d).localeCompare(a.first || a.d) || b.d.localeCompare(a.d)),
      h: hits,
      notes,
    };
  }

  // 최근 신호 공시: 최초 공시일(ed) 최신 순. ed는 정렬에만 쓰고 내보내지 않는다
  recent.sort((a, b) => b.ed.localeCompare(a.ed) || b.d.localeCompare(a.d));
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
    recent: recent.slice(0, 8).map(({ ed: _ed, ...r }) => r),
    recent3m: recent3m.size,
    recent3mNoSamil: recent3mNoSamil.size,
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
    log(`2026 반기 감사인 중 감사인 이름이 아닌 값 ${audIgnored.length}곳은 쓰지 않았어요 (예: ${eg}) → 보완(감사용역 체결현황·DART 공시 화면) 또는 2025 감사인`);
  }
  if (extra.auditorSupp) {
    const suppIgnored = extraSupp.rows.filter((r) => !(r.auditor_raw && looksLikeAuditor(r.auditor_raw))).length;
    log(`감사인 보완(감사용역 체결현황) ${extraSupp.rows.length}행 중 감사인 이름 ${suppBy.size}행 → 현재 감사인으로 씀: 2026 ${stat.supp2026}곳 · 2025 ${stat.supp2025}곳 (감사인 아님·빈 값 ${suppIgnored}행)`);
  }
  if (extra.auditorWeb) {
    const webIgnored = extraWeb.rows.filter((r) => !(r.auditor_raw && looksLikeAuditor(r.auditor_raw))).length;
    log(`감사인 화면 보완(DART 공시 화면) ${extraWeb.rows.length}행 중 감사인 이름 ${webBy.size}행 → 현재 감사인으로 씀: 2026 ${stat.web2026}곳 · 2025 ${stat.web2025}곳 (감사인 아님·당기 행 없음·항목 없음 ${webIgnored}행)`);
  }
  if (extra.corrections) {
    const resolvedRows = extraCorr.rows.filter((r) => r.withdrawn && r.withdraw_kw === RESOLVED_KW).length;
    log(`정정 정보 ${extraCorr.rows.length}행 → 공시에 붙임 ${stat.corrApplied}건(최초일 ${stat.firstKnown}건 · 원공시 링크 ${stat.linkOrig}건) · 철회 등 ${extraCorr.rows.filter((r) => r.withdrawn).length}행(그중 사유 해소 ${resolvedRows}행)`);
  }
  log(`신호별 해당 기업 수: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  const rs1Kinds = Object.entries(stat.rs1MarketKind).map(([k, v]) => `${k} ${v}`).join('·');
  log(`신호 제외 공시(nosig): ${Object.entries(stat.nosig).map(([k, v]) => `${k} ${v}`).join(' · ') || '없음'} · RS1 대표 근거가 거래소 시장조치 ${stat.rs1ByMarket}곳${rs1Kinds ? `(${rs1Kinds})` : ''} · RS3 이전 연도 판정 ${stat.rs3Old}곳 · 12월 결산 아님으로 PA1 뺌 ${stat.pa1NonDec}곳`);
  const agCount = {};
  for (const r of summary) agCount[r.ag] = (agCount[r.ag] || 0) + 1;
  log(`감사인 그룹: ${Object.entries(agCount).map(([k, v]) => `${k} ${v}`).join(' · ')} (이력 추정 표시 ${stat.est}곳, 그중 이력상 삼일 ${stat.estSamil}곳 · 추정은 그룹을 정하지 않음)`);
  log(`summary.json ${(size / 1024).toFixed(0)}KB, detail 파일 ${Object.keys(buckets).length}개 → ${OUT}`);
  log(`추가 수집 대상 목록 ${universe.length}곳 → data/universe.json`);
}

main();
