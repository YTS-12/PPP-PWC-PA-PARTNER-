// 기존 수집본(DATA_DIR) + 추가 수집분(data/extra) → public/data (summary.json, detail/00~99.json)
// 함께 data/universe.json(추가 수집 대상 목록)도 만든다. 수집 담당은 이 파일로 수집한다.
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
const isDeadline = (t) => /연장/.test(t) && /(사업보고서|제출기한)/.test(t);
const readable = (t) => (t || '').replace(/^(\s*\[[^\]]*\])+/, '').trim();

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
function normAuditor(a) {
  return (a || '')
    .replace(/\([^)]*\)/g, '')
    .replace(/주식회사|㈜/g, '')
    .replace(/\s+/g, '')
    .replace(/^EY/, '')
    .trim();
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

  // 기준일은 한국 날짜로 맞춘다 (추가 수집 기록은 UTC로 저장됨)
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
  const audBy = new Map(extraAud.rows.filter((r) => r.auditor_raw).map((r) => [r.corp_code, r]));
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
    const fraud = recentOnly((krxBy.get(corp) || []).map((f) => ({ t: f.report_nm, d: isoDate(f.rcept_dt), r: f.rcept_no })).filter((f) => RE_FRAUD.test(f.t)));
    const ext = (deadlineBy.get(corp) || [])
      .map((f) => ({ t: f.report_nm, d: isoDate(f.rcept_dt), r: f.rcept_no, y: f.year || Number(isoDate(f.rcept_dt).slice(0, 4)) }))
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
    if (extra.major) filingHit('RS1', distress);
    if (extra.krx) filingHit('IC2', fraud);
    if (extra.deadline && ext.length) {
      const years = [...new Set(ext.map((f) => f.y))].sort();
      const consec = years.some((y, i) => i > 0 && years[i - 1] === y - 1);
      const latest = ext[0];
      addHit('PA1', `${years.join('·')}년 사업보고서 제출기한 연장신고${consec ? ' (2년 연속)' : ''}`, latest.d, latest.r, latest.r);
    }
    for (const f of mna) filings.push({ cat: 'MNA', ...f });
    for (const f of distress) filings.push({ cat: 'DISTRESS', ...f });
    for (const f of fraud) filings.push({ cat: 'FRAUD', ...f });
    for (const f of ext) filings.push({ cat: 'DEADLINE', t: f.t, d: f.d, r: f.r });
    for (const f of [...mna, ...distress, ...fraud]) if (f.d >= from3m) recent3m.add(f.r);

    // --- IC1 2029 연결 내부회계 감사 대상 ---
    if (fx && (fx.CFS || fx.OFS)) {
      const rec = fxKrw(P.ic1AssetBasis === 'CFS' ? fx.CFS : fx.OFS);
      if (fx.CFS && rec && rec.assets != null && rec.assets >= P.ic1MinAssets && rec.assets < P.ic1MaxAssets) {
        addHit('IC1', `자산총계 ${won(rec.assets)}(${P.ic1AssetBasis === 'CFS' ? '연결' : '별도'}) · 연결 작성 → 2029 사업연도 연결 내부회계 감사(현행 일정)`, '', `FIN:${corp}:IC1`, rec.rcept_no);
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
      addHit('IF3', `연결 자산총계 ${won(cfsAssets)} · 연결 작성`, '', `FIN:${corp}:IF3`, (cfsRec && cfsRec.rcept_no) || (fa && fa.rcept_no) || '');
    }

    // --- IF1 영업외손익 비중 (추가 수집 필요) ---
    const mainRec = fx ? fxKrw(fx.CFS) || fxKrw(fx.OFS) : null;
    if (extra.fin && mainRec && !fh && mainRec.op != null && mainRec.pretax != null) {
      const nonop = mainRec.pretax - mainRec.op;
      const ratio = mainRec.op !== 0 ? Math.abs(nonop) / Math.abs(mainRec.op) : Infinity;
      if (Math.abs(nonop) >= P.if1MinAbs && ratio >= P.if1Ratio) {
        const label = mainRec.op === 0 ? '(영업이익 0)' : `(영업이익의 ${pct(ratio)})`;
        addHit('IF1', `영업외손익 ${nonop >= 0 ? '+' : ''}${won(nonop)} ${label} · ${mainRec.fs_div === 'CFS' ? '연결' : '별도'}`, '', `FIN:${corp}:IF1`, mainRec.rcept_no, ratio === Infinity ? null : ratio);
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
        addHit('RS3', `전액잠식 (자본총계 ${won(eq)}, 자본금 ${won(cap)})`, '', `FIN:${corp}:RS3`, mainRec.rcept_no, 1);
      } else if ((cap - eq) / cap >= P.rs3Ratio) {
        const r = (cap - eq) / cap;
        addHit('RS3', `자본잠식률 ${pct(r)} (자본금 ${won(cap)}, 자본총계 ${won(eq)})`, '', `FIN:${corp}:RS3`, mainRec.rcept_no, r);
      }
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
      a: krwAssets,
      sz,
      ceo: c.ceo || '',
      ph: ct.phone || '',
      fx: ct.fax || '',
      hp: ct.homepage || '',
      ad: ct.address || '',
      h: hits.map((h) => [h.id, h.ev, h.d, h.k, h.r]),
    });

    for (const f of [...mna, ...distress, ...fraud]) {
      recent.push({ c: corp, n: name, cat: mna.includes(f) ? 'MNA' : distress.includes(f) ? 'DISTRESS' : 'FRAUD', t: readable(f.t), d: f.d, r: f.r, samil: ag === 'SAMIL' });
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
  log(`신호별 해당 기업 수: ${Object.entries(counts).map(([k, v]) => `${k} ${v}`).join(' · ')}`);
  log(`summary.json ${(size / 1024).toFixed(0)}KB, detail 파일 ${Object.keys(buckets).length}개 → ${OUT}`);
  log(`추가 수집 대상 목록 ${universe.length}곳 → data/universe.json`);
}

main();
