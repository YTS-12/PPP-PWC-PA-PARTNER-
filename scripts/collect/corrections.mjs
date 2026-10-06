// 추가 수집 8: 정정공시의 최초 공시일·원공시 접수번호·철회 여부 (DART 웹 공시 화면)
// 사용: npm run collect:corrections   (collect:major·collect:krx·collect:deadline 을 받은 뒤에 실행)
// 대상: data/extra 의 filings_major·filings_krx·filings_deadline 중 제목 머리말이 정정류인 공시
//   ([기재정정]·[첨부정정]·[첨부추가]·[정정명령부과] 등 '정정'·'첨부추가'가 든 대괄호 머리말. [연장결정]은 정정 아님).
//   filings_major 는 신호에 쓰는 제목(SIGNAL_MAJOR: 합병·분할·분할합병·영업양수·영업양도·타법인주식 양수·주식교환·이전,
//   부도·영업정지·회생·해산·채권은행 관리 개시·중단·감자)만 본다. 거래소공시·연장신고는 모두 신호용이라 정정류 전부.
// 방법(공시 1건에 DART 웹 화면 2번(첨부추가는 1번), 요청 간격 1초 이상):
//   1) 공시 화면(dsaf001/main.do) — '본문' 버전 목록(family)에서 원공시(머리말 없는 가장 오래된 버전) 접수번호를 찾고,
//      왼쪽 목차에서 '정정신고(보고)' 부분 위치를 얻는다(거래소공시는 목차 없이 문서 하나).
//   2) 정정신고 부분(report/viewer.do) — '최초제출일'(거래소공시는 '정정관련 공시서류제출일')·정정사유·정정사항(정정 후)을 읽는다.
//   first_date 는 버전 목록에 적힌 원공시 날짜(= OpenDART rcept_dt 와 같은 기준. 접수번호 앞 8자리와 하루쯤 다를 수 있음)로 정하고,
//   원공시를 못 찾으면 정정신고의 '최초제출일'을 쓴다. 거래소공시의 '정정관련 공시서류제출일'은 바로 앞 버전 날짜라(여러 번 정정한 공시)
//   first_date 후보로 쓰지 않고 원공시 날짜와 비교하는 데만 쓴다. 원공시도 '최초제출일'도 없으면 first_date 는 null 이고
//   data:build 는 그 공시의 접수일(rcept_dt)로 판정한다.
//   withdrawn: 정정사유·항목·정정 후 내용에 철회·취하·부결·해제·해지·처분 취소 확정·전 항목 삭제·모든 절차 중단이 있으면 true.
//   그 공시의 사건 말(합병·분할·양수·감자·회생·영업정지·횡령 등)이 같은 문장 가까이에 있을 때만 본다(정정사유가 15자 이하이고
//   다른 결정 이름이 없으면 사건 말 없이도 본다. 예: '계약 해지'). 조건문('부결될 경우'·'해제할 수 있다'·'해제 시까지'),
//   결정과 무관한 대상의 해지·해제·철회(보호예수·담보·신탁계약·근저당권·질권 설정·대출 약정·임대차 계약·매매거래정지·
//   주주총회 소집 등), 소송·고소·집행정지 취하, 회사가 진 소송('처분 취소 소송 패소 확정')은 빼고 본다.
//   '전 항목 삭제'는 행 수가 아니라 결정 핵심 항목(1·2번 항목, 항목 이름 '전체'·공시 제목)이 지워졌을 때만 본다(detectWithdraw).
//   '본 건'·'본건'·'본 공시'는 그 공시 자체를 가리키므로 모든 공시의 사건 말로 본다(2026-10-06 결정 F. 한화 '공시한 본 건을 철회').
//   사유 해소(2026-10-06 결정 B): 거래소 시장조치·내부결산 시점 공시(list-search.mjs 의 marketKind, 횡령·배임 제목 제외)의 정정사유·정정 후 내용에
//   '사유가 해소'·'해소되었'·'해당 사유 없음'·'미해당'·'해당하지 않'이 있으면(조건문·'해소 여부'·부정·일부 해소는 뺌) withdrawn true,
//   withdraw_kw '사유 해소'(data:build 는 철회와 같이 신호에서 뺀다. 화면 문구 '신호 제외 · 사유 해소 확인'). detectResolved.
//   첨부정정류(머리말에 [첨부정정]이 있거나 attach_only)는 자기 정정신고에서 철회를 못 찾으면, 버전 목록(family)의 원공시 이후·이 정정본 이전
//   (같은 날 포함) 정정 버전의 정정신고도 최신 버전부터 읽어 철회를 판단한다(결정 F: 미래에셋생명 [첨부정정]의 철회 내용은 같은 날 [기재정정]에만 있음).
//   그 버전마다 화면 2번을 더 받고(캐시), 철회를 찾으면 거기서 멈춘다. 그 버전에서 찾았으면 reason 에 '정정본 <접수번호>:'로 문맥을 덧붙인다.
//   attach_only: 머리말이 [첨부정정]·[첨부추가]뿐이고 원공시가 따로 있음(결정 본문이 원공시에만 있음) → 화면은 원공시 접수번호로 링크한다.
//   [첨부추가]는 대개 같은 접수번호에 첨부서류만 더한 것이라 버전 목록에 자기 자신만 있다. 이때는 그 공시가 원공시(본문 있음)라
//   first_rcept_no·first_date 를 자기 자신으로 두고 attach_only=false, 정정신고 부분도 없어 화면을 1번만 받는다.
// 결과: data/extra/corrections.jsonl, data/extra/corrections.meta.json
// 저장하지 않고 멈추는 경우: 화면을 받지 못했거나(HTTP 오류·이상 화면) 공시 화면에서 버전 목록을 못 읽은 공시가 있을 때.
//   받은 화면은 data/raw/dartweb 에 캐시돼서 같은 명령을 다시 실행하면 받은 화면은 새로 요청하지 않아요.
//   정정신고 부분을 찾지 못한 공시는 원공시 정보만 저장하고 확인용으로 출력해요(withdrawn=false, source 'dartweb-family').
import fs from 'node:fs';
import path from 'node:path';
import { readJsonl, writeJsonl, writeExtraMeta, EXTRA_DIR, baseTitle, log } from '../lib/common.mjs';
import { createDartWeb, parseDartMain, reportWebStats, assertNoIssues, runCollector, DartFatal } from '../lib/dart.mjs';
import { marketKind, marketKindCounts } from './list-search.mjs';

// filings_major 중 신호에 쓰는 제목 (build-data.mjs 의 MNA·DISTRESS 분류를 모두 덮어야 한다. 영업양도·관리절차중단 포함)
export const SIGNAL_MAJOR =
  /회사합병결정|회사분할결정|회사분할합병결정|영업양수결정|영업양도결정|타법인주식및출자증권양수결정|주식교환[ㆍ·]?이전결정|부도발생|영업정지|회생절차개시신청|해산사유발생|채권은행등의관리절차개시|채권은행등의관리절차중단|감자결정/;

const SOURCES = [
  { key: 'major', file: 'filings_major.jsonl', pick: (r) => SIGNAL_MAJOR.test(baseTitle(r.report_nm)) },
  { key: 'krx', file: 'filings_krx.jsonl', pick: () => true },
  { key: 'deadline', file: 'filings_deadline.jsonl', pick: () => true },
];

const squash = (s) => String(s ?? '').replace(/\s+/g, '');

/** 맨 앞 대괄호 머리말들: '[기재정정][첨부정정]주요…' → '[기재정정][첨부정정]' */
export function headOf(reportNm) {
  const m = squash(reportNm).match(/^(\[[^\]]*\])+/);
  return m ? m[0] : '';
}
/** 정정류 머리말: '정정'·'첨부추가'가 든 대괄호 머리말([연장결정] 등은 아님) */
export const isCorrectionHead = (head) => /\[[^\]]*(정정|첨부추가)[^\]]*\]/.test(head || '');
/** 결정 본문 없이 첨부서류만 고친 정정: [첨부정정]·[첨부추가]만 있고 [기재정정]이 없음 */
export const isAttachOnly = (head) => /첨부정정|첨부추가/.test(head || '') && !/기재정정/.test(head || '');

// ---------------------------------------------------------------- HTML 표 읽기 (중첩 표 지원)
const ENT = { nbsp: ' ', amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
const decodeEnt = (s) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1));
      return Number.isFinite(cp) && cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ' ';
    }
    return ENT[e.toLowerCase()] ?? m;
  });
const inlineText = (s) => decodeEnt(s.replace(/<br\s*\/?>/gi, ' ').replace(/<[^>]+>/g, ' '));
const clean = (s) => s.replace(/\s+/g, ' ').trim();

/** table·tr·td·th 만 보는 작은 트리 파서. 셀 안의 표(정정 전·후 칸에 든 표)는 그 셀의 글자로 합친다 */
function parseTree(html) {
  const root = { tag: 'root', attrs: '', kids: [] };
  const stack = [root];
  const top = () => stack[stack.length - 1];
  const re = /<(\/?)(table|tr|td|th)\b([^>]*)>/gi;
  let last = 0;
  let m;
  while ((m = re.exec(html))) {
    const text = html.slice(last, m.index);
    if (text) top().kids.push(text);
    last = re.lastIndex;
    const tag = m[2].toLowerCase();
    if (!m[1]) {
      if (tag === 'td' || tag === 'th') {
        if (['td', 'th'].includes(top().tag)) stack.pop(); // 닫는 태그 없이 다음 칸
      } else if (tag === 'tr') {
        if (['td', 'th'].includes(top().tag)) stack.pop();
        if (top().tag === 'tr') stack.pop();
      }
      const node = { tag, attrs: m[3] || '', kids: [] };
      top().kids.push(node);
      stack.push(node);
    } else {
      for (let i = stack.length - 1; i > 0; i--) {
        if (stack[i].tag === tag) {
          stack.length = i;
          break;
        }
        if (stack[i].tag === 'table' && tag !== 'table') break; // 바깥 표의 닫는 태그를 안쪽에서 쓰지 않게
      }
    }
  }
  const rest = html.slice(last);
  if (rest) top().kids.push(rest);
  return root;
}
function nodeText(n) {
  return clean(
    n.kids
      .map((k) => (typeof k === 'string' ? inlineText(k) : k.tag === 'table' ? ` ${nodeText(k)} ` : ` ${nodeText(k)} `))
      .join(' '),
  );
}
function tablesIn(n, out = []) {
  for (const k of n.kids) {
    if (typeof k === 'string') continue;
    if (k.tag === 'table') out.push(k);
    else tablesIn(k, out); // 표 안(셀 안)의 표는 그 셀 글자로 읽으므로 여기서는 바깥 표만 모은다
  }
  return out;
}
const spanOf = (attrs, k) => {
  const v = Number((attrs.match(new RegExp(`${k}\\s*=\\s*["']?(\\d+)`, 'i')) || [])[1]);
  return Number.isFinite(v) && v > 1 ? Math.min(v, 50) : 1;
};
/** 표의 행 → 칸 격자(rowspan·colspan 반영). 같은 칸이 여러 자리를 차지하면 같은 객체가 들어간다 */
function gridOf(table) {
  const rows = table.kids.filter((k) => typeof k !== 'string' && k.tag === 'tr');
  const pending = [];
  const grid = [];
  for (const tr of rows) {
    const out = [];
    let col = 0;
    const fill = () => {
      while (pending[col] && pending[col].left > 0) {
        out[col] = pending[col].cell;
        pending[col].left--;
        col++;
      }
    };
    for (const td of tr.kids.filter((k) => typeof k !== 'string' && (k.tag === 'td' || k.tag === 'th'))) {
      fill();
      const cell = { text: nodeText(td) };
      const cs = spanOf(td.attrs, 'colspan');
      const rs = spanOf(td.attrs, 'rowspan');
      for (let k = 0; k < cs; k++) {
        out[col + k] = cell;
        if (rs > 1) pending[col + k] = { left: rs - 1, cell };
      }
      col += cs;
    }
    for (; col < pending.length; col++) if (pending[col] && pending[col].left > 0) {
      out[col] = pending[col].cell;
      pending[col].left--;
    }
    grid.push(out);
  }
  return grid;
}

/**
 * 화면 글자(HTML)의 바깥 표들을 칸 글자 격자로: [표][행][열] = 칸 글자(rowspan·colspan 은 같은 글자를 반복, 빈 자리는 '').
 * 셀 안의 표는 그 셀 글자로 합친다. collect:auditor-web 이 '외부감사에 관한 사항' 표를 읽을 때도 쓴다
 */
export function htmlTables(html) {
  return tablesIn(parseTree(String(html || ''))).map((t) => gridOf(t).map((row) => Array.from(row, (c) => (c ? c.text : ''))));
}

const HEAD_LABEL = (t) => {
  const s = squash(t);
  if (/^(항목|정정항목)$/.test(s)) return 'item';
  if (s === '정정사유') return 'reason';
  if (s === '정정전') return 'before';
  if (s === '정정후') return 'after';
  return null;
};
const DATE_RE = /(\d{4})\s*[-.년/]\s*(\d{1,2})\s*[-.월/]\s*(\d{1,2})/;
const ymdOf = (m) => (m ? `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}` : null);
const isoOf = (s) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}T00:00:00Z`;
const validYmd = (s) => {
  if (!s || !/^\d{8}$/.test(s)) return null;
  const d = new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
  return d.toISOString().slice(0, 10).replace(/-/g, '') === s && s >= '19900101' ? s : null;
};

/**
 * 정정신고 부분 읽기. html: 정정신고 부분 화면(주요사항보고서 등) 또는 거래소공시 문서 전체.
 * 반환: { found, firstDate(YYYYMMDD|null), firstDateKind('first'|'prev'|null), reasons[], items[], afters[], befores[], pairs[], rows }
 *   firstDateKind: 'first' = '최초제출일'·'최초 공시일' 등(원공시 날짜), 'prev' = 거래소공시 '정정관련 공시서류제출일'(바로 앞 버전 날짜)
 *   pairs: 정정사항 표 행마다 { item, before, after } (정정 후 칸이 있는 행만)
 */
export function parseCorrection(html) {
  const src = String(html || '');
  const at = src.search(/정\s*정\s*신\s*고/);
  if (at < 0) return { found: false, firstDate: null, firstDateKind: null, reasons: [], items: [], afters: [], befores: [], pairs: [], rows: 0 };
  // 거래소공시: 정정신고는 문서 맨 앞 블록이고, 본문은 class="xforms_title" 부터
  let sec = src.slice(at);
  const body = sec.search(/class=["']?xforms_title/i);
  if (body > 0) sec = sec.slice(0, body);
  const tables = tablesIn(parseTree(sec));
  const reasons = new Set();
  const items = new Set();
  const afters = [];
  const befores = [];
  const pairs = [];
  let rows = 0;
  let headerSeen = false;
  let firstDate = null;
  let firstDateKind = null;
  const flat = [];
  for (const t of tables) {
    const grid = gridOf(t);
    let labels = null;
    for (const row of grid) {
      const cells = [...new Set(row.filter(Boolean))];
      const texts = cells.map((c) => c.text);
      flat.push(texts.join(' | '));
      const lab = row.map((c) => (c ? HEAD_LABEL(c.text) : null));
      if (lab.includes('before') && lab.includes('after')) {
        labels = lab;
        headerSeen = true;
        continue;
      }
      // 거래소공시: '3. 정정사유 | 사유' 행
      const ri = texts.findIndex((x) => /^(\d+\.)?정정사유$/.test(squash(x)));
      if (ri >= 0 && texts[ri + 1] && !labels) reasons.add(texts[ri + 1]);
      if (!labels) continue;
      rows++;
      const byLabel = { item: new Set(), reason: new Set(), before: new Set(), after: new Set() };
      row.forEach((c, i) => {
        if (c && lab[i] == null && labels[i]) byLabel[labels[i]].add(c);
      });
      for (const c of byLabel.item) if (c.text) items.add(c.text);
      for (const c of byLabel.reason) if (c.text) reasons.add(c.text);
      for (const c of byLabel.before) befores.push(c.text);
      for (const c of byLabel.after) afters.push(c.text);
      if (byLabel.after.size) {
        const join = (set) => [...set].map((c) => c.text).join(' ');
        pairs.push({ item: join(byLabel.item), before: join(byLabel.before), after: join(byLabel.after) });
      }
    }
  }
  const text = flat.join(' / ');
  const fm = text.match(/(최초\s*제출일|공시서류\s*제출일|최초\s*공시일|최초\s*접수일)[^0-9]{0,15}(\d{4}\s*[-.년/]\s*\d{1,2}\s*[-.월/]\s*\d{1,2})/);
  if (fm) {
    firstDate = validYmd(ymdOf(fm[2].match(DATE_RE)));
    if (firstDate) firstDateKind = /최초/.test(fm[1]) ? 'first' : 'prev';
  }
  return { found: headerSeen || reasons.size > 0, firstDate, firstDateKind, reasons: [...reasons], items: [...items], afters, befores, pairs, rows };
}

// ---------------------------------------------------------------- 철회 감지
// 결정·사건이 아닌 대상을 푸는·거두는 말. 이 말 바로 뒤, 또는 명사 1~2개(사건 말 없이)를 건너 철회·취하·해제·해지가 오면 철회로 보지 않는다.
// 예: 보호예수 해제, 매매거래정지 및 해제, 신탁계약 해지, 근저당권 해지, 질권 설정 해지, 대출 약정 해지, 임대차 계약 해지,
//     정기예금 해지, 주주총회 소집 철회, 최대주주 변경 계약 해제, 소송·고소·집행정지 취하, 반대의사·주식매수청구 철회, 관리절차 해제
const NOT_EVENT_SRC =
  '보호예수|의무보유|예탁|담보|질권|근저당|저당|압류|가압류|가처분|매매거래\\s*정지|거래\\s*정지|관리\\s*종목|' +
  '투자\\s*(주의|경고|위험)|환기\\s*종목|신탁|대차|임대|대출|차입|예금|적금|' +
  '소송|(^|[\\s(])소(?=\\s|$|을|를|의|가|는|은|에)|항고|항소|상고|집행\\s*정지|이의\\s*신청|고소|고발|' +
  '관리\\s*절차|공동\\s*관리|워크아웃|약정|확약|락업|반대\\s*의사|통지|매수\\s*청구|청구권|청약|동의|의견|위임|의결권|대리권|' +
  '청구|신고서\\s*제출|주주\\s*총회|주총|소집|최대\\s*주주|주주\\s*간|주권';
// '해제' 앞의 '정지'(매매거래정지·정지기간·정지 해제 시까지)는 기간이 끝나 푸는 것이라 철회가 아니다('영업정지 처분 철회'는 철회로 본다)
const NOT_EVENT_RELEASE_SRC = `${NOT_EVENT_SRC}|정지`;
// 제외어와 철회류 말 사이에 이 말이 있으면 결정 자체의 철회일 수 있어 제외하지 않는다('동의 미달로 합병 철회')
const DECISION_WORD = /합병|분할|양수|양도|감자|자본\s*금?\s*감소|회생|해산|교환|부도|영업\s*정지|횡령|배임|결정/;
// 사이 낱말로 세지 않는 말(접속·조사)
const CONNECTIVE = /^(및|등|과|와|또는|그리고|의|을|를|은|는|이|가|에|관련|[,·ㆍ/~-])$/;

/** before(철회류 말 앞 글)가 결정과 무관한 대상으로 끝나는지: 제외어 + (같은 낱말의 나머지) + 사이 낱말 0~2개 */
function notEventBefore(before, kw) {
  let s = before;
  const stop = Math.max(s.lastIndexOf('. '), s.lastIndexOf('다.'));
  if (stop >= 0) s = s.slice(stop + 2);
  const re = new RegExp(kw === '해제' ? NOT_EVENT_RELEASE_SRC : NOT_EVENT_SRC, 'g');
  let m;
  while ((m = re.exec(s))) {
    if (!m[0]) {
      re.lastIndex++;
      continue;
    }
    const rest = s.slice(m.index + m[0].length);
    if (DECISION_WORD.test(rest)) continue;
    // '영업양수도 약정 해지'·'합병확약 철회'처럼 약정·확약 앞 낱말이 결정이면 결정 자체의 약정이다('대출 약정 해지'는 제외)
    if (/약정|확약/.test(m[0]) && DECISION_WORD.test((s.slice(0, m.index).match(/\S*\s*\S*$/) || [''])[0])) continue;
    const words = rest.split(/\s+/);
    // 제외어에 붙은 글자('신탁계약은'의 '계약은', '근저당권'의 '권')는 같은 낱말이라 세지 않는다
    const between = (rest && !/^\s/.test(rest) ? words.slice(1) : words).filter((w) => w && !CONNECTIVE.test(w));
    if (between.length <= 2) return true;
  }
  return false;
}

// 조건·가정('부결될 경우', '부결 시', '해제할 수 있다', '해지 조건', '해제 시까지', '해지 예정')은 철회 사실이 아니다
// '합병계약의 해제:'처럼 콜론이 붙은 것은 계약 조항 제목이다
const CONDITIONAL_AFTER =
  /^\s*([:：]|될|되는|된\s*경우|된\s*때|되면|할|하는|한\s*경우|하면|하거나|되거나|시까지|일까지|예정|시[\s,.)]|시에|시$|조건|사유|권|가능|요건|또는|등의\s*경우|의\s*경우|되더라도|하더라도|된다면|한다면|여부)/;
// 앞 절에 조건('부결시 본 계약은', '…하는 경우')이 있고 뒤가 설명형('해제되며', '해지됩니다')이면 계약 조항 설명이지 철회 사실이 아니다
const CONDITION_BEFORE = /(시|경우|때)\s*(에는|에|,)?\s+[^.。]{0,20}$/;
const DESCRIPTIVE_AFTER = /^\s*(되며|된다|됩니다|되고|하며|한다|합니다)/;
// '처분 취소 확정'이라도 회사가 진 소송(패소·기각·각하·인용되지 않음)이면 처분이 그대로라 철회가 아니다.
// 상대방(피고·처분청)의 상고·항소가 기각된 것, 승소는 회사가 이긴 것이다
const LAWSUIT_LOST = /패소|기각|각하|인용\s*되지\s*않|인용하지\s*않|불인용/;
// '상고 기각으로 … 처분 취소 판결 확정'처럼 확정된 것이 '처분 취소 판결'이면, 기각된 것은 그 판결에 대한 상대방의 상고다(회사 승소)
const LAWSUIT_WON =
  /승소|피고\s*(측\s*)?(의\s*)?패소|(피고|처분청|행정청|상대방|국토\s*교통부|국토부)\s*(측)?\s*(의|이|가|은|는)?\s*(상고|항소|상소|재항고)[^.。]{0,10}(기각|각하|취하)|처분\s*취소\s*판결\s*(이|이\s*최종)?\s*확정/;
// 말 안에 띄어쓰기를 넣지 않는다('위해 제1우선주'의 '해 제'를 '해제'로 읽지 않게)
const KW_LIST = [
  ['전 항목 삭제', /전체\s*항목\s*삭제|전\s*항목\s*삭제|모든\s*항목\s*삭제/],
  // '관련'만으로는 잡지 않는다('합병 관련 채권자보호절차 공고 취소'는 철회가 아님). '분할 관련 모든 절차 철회'는 '모든'으로 잡힌다
  ['모든 절차 중단', /(모든|일체의?)\s*[^.。]{0,12}(절차|사항|진행)[^.。]{0,8}(중단|취소|철회|중지)/],
  ['처분 취소 확정', /처분[^.。]{0,15}취소[^.。]{0,10}(확정|되어\s*효력)|처분\s*취소\s*확정/],
  ['철회', /철회/],
  ['취하', /취하/],
  ['부결', /부결/],
  ['해제', /해제/],
  ['해지', /해지/],
];

// 취하·철회한 뒤 같은 건을 다시 낸 경우(서류 보완 뒤 재접수, 주주총회 재소집 등)는 철회가 아니다
const REFILED = /재\s*접수|재\s*신청|재\s*제출|재\s*결의|재\s*소집|재\s*공고|다시\s*(신청|접수|제출|결의|소집|공고)/;

/** 공시 제목(머리말 뺀 것)에 맞는 사건 말: 정정사유·항목·정정 후 내용에서 이 말과 함께 나온 철회류 말만 본다(다른 결정의 철회와 구분) */
export function eventWordsOf(titleBase) {
  const t = squash(titleBase);
  const w = [];
  if (/합병/.test(t)) w.push('합병');
  if (/분할/.test(t)) w.push('분할');
  if (/영업양수/.test(t)) w.push('양수', '영업');
  if (/영업양도/.test(t)) w.push('양도', '영업');
  // 제3자배정 신주를 취득하는 경우가 있어 '신주 인수'·'유상증자 참여' 계약도 이 결정의 계약이다
  if (/타법인주식/.test(t)) w.push('양수', '취득', '주식', '출자', '신주', '증자', '인수');
  if (/주식교환|이전결정/.test(t)) w.push('교환', '이전');
  if (/회생/.test(t)) w.push('회생', '신청', '개시');
  if (/영업정지/.test(t)) w.push('영업정지', '처분');
  if (/감자/.test(t)) w.push('감자', '자본\\s*금?\\s*감소', '병합');
  if (/해산/.test(t)) w.push('해산');
  if (/부도/.test(t)) w.push('부도');
  if (/관리절차/.test(t)) w.push('관리절차', '공동관리');
  if (/연장/.test(t)) w.push('연장', '신고');
  if (/횡령|배임/.test(t)) w.push('횡령', '배임');
  // 거래소 시장조치 공시(정정사유에 사건 말이 없으면 짧은 사유만 본다)
  if (/실질심사/.test(t)) w.push('실질심사', '심사');
  if (/상장폐지/.test(t)) w.push('상장폐지');
  if (/관리종목/.test(t)) w.push('관리종목');
  if (/부적정/.test(t)) w.push('부적정', '검토의견', '감사의견');
  if (/매매거래정지/.test(t)) w.push('매매거래정지', '거래정지');
  // '본 건'·'본건'·'본 공시'는 그 공시 자체를 가리키므로 모든 공시의 사건 말로 본다(2026-10-06 결정 F: 한화 감자결정 '공시한 본 건을 철회').
  // '기본 건'·'견본건'(앞이 한글)·'본건물'·'본 건축'은 아니다
  w.push('(?<![가-힣])본\\s*(?:건|공시)(?!물|축|설)');
  return new RegExp(w.join('|'));
}

// 결정·사건 이름. 그 공시의 사건 말(eventWordsOf)에 없는 이름은 '다른 결정'이다(감자결정 공시의 '유상증자'·'전환사채 취득' 등)
const DECISION_NAME = /합병|분할|양수|양도|취득|처분|감자|자본\s*금?\s*감소|회생|해산|주식\s*교환|주식\s*이전|부도|영업\s*정지|관리\s*절차|횡령|배임|증자|사채|자기\s*주식|자사주|신주|출자|채무\s*보증|담보\s*제공|소송/g;
// 결정이 아닌 주주총회 안건(정관 변경·이사 선임 등). 정정사유의 '부결'이 이 안건 이야기면 그 공시의 부결로 보지 않는다
// '자본준비금 감소의 건'·'이익잉여금 처분' 같은 준비금·잉여금 안건은 감자(자본금 감소)가 아니다
const OTHER_AGENDA = /정관|선임|해임|보수한도|배당|재무제표승인|준비금|잉여금/;
// 사건 말이 없는 정정사유의 '계약 해지·해제'(그 공시의 결정 계약). 앞에 다른 계약 이름이 붙으면 아니다('주주간 계약 해지')
const GENERIC_CONTRACT = /(^|[\s(,])계약\s*(을|를|이|가|의|에\s*대한)?\s*(합의\s*)?(해지|해제)/;
const OTHER_CONTRACT = /(주주간|주주|신탁|대출|여신|임대차|임대|근저당|질권|담보|용역|공급|판매|구매|라이선스|라이센스|고용|위탁|보험|리스|투자자문|컨설팅|약정)\s*$/;
/** 글 안 마지막 '다른 결정' 이름이 끝나는 자리(없으면 -1) */
function otherDecisionEnd(text, event) {
  let end = -1;
  for (const d of text.matchAll(DECISION_NAME)) if (!event.test(squash(d[0]))) end = d.index + d[0].length;
  return end;
}
/**
 * 짧은 정정사유('계약 해지'·'계약 합의 해제에 따른 정정'): 공백 뺀 15자 이하이고 다른 결정 이름이 없음.
 * 이런 사유는 그 공시의 결정을 두고 쓴 것으로 보고 사건 말 확인을 하지 않는다
 */
export function isShortReason(text, titleBase = '') {
  const s = squash(text);
  if (!s || s.length > 15) return false;
  return otherDecisionEnd(s, eventWordsOf(titleBase)) < 0;
}

/**
 * 한 글 안에서 철회류 말을 찾는다(앞뒤 문맥으로 사건이 아닌 것·조건문·일부 해제·재접수·패소는 뺌). 찾으면 { kw, ctx }.
 * opts.skip: 이 공시에서는 철회로 보지 않을 말(예: 채권은행 관리절차 공시의 '모든 절차 중단'은 그 자체가 위기 사건)
 * opts.event: 주면 그 사건 말이 같은 문장 앞쪽 30자(또는 뒤 12자) 안에 있을 때만 인정한다('전 항목 삭제'·'처분 취소 확정'은 빼고).
 *   앞쪽 30자에 다른 결정 이름이 있으면('유상증자 결정 철회에 따른 감자 일정 변경') 그 이름 뒤에 사건 말이 있어야 한다
 */
export function findWithdraw(text, { skip = new Set(), event = null } = {}) {
  const s = clean(String(text || ''));
  if (!s) return null;
  for (const [kw, re] of KW_LIST) {
    if (skip.has(kw)) continue;
    const g = new RegExp(re.source, 'g');
    let m;
    while ((m = g.exec(s))) {
      const before = s.slice(Math.max(0, m.index - 20), m.index);
      const after = s.slice(m.index + m[0].length, m.index + m[0].length + 12);
      const tail = s.slice(m.index + m[0].length, m.index + m[0].length + 60);
      if (['철회', '취하', '해제', '해지'].includes(kw) && notEventBefore(s.slice(Math.max(0, m.index - 40), m.index), kw)) continue;
      if (CONDITIONAL_AFTER.test(after)) continue;
      if (CONDITION_BEFORE.test(before) && DESCRIPTIVE_AFTER.test(after)) continue;
      // 일부 해제·일부 철회·처분 일부 취소
      if (/일부/.test(before.slice(-10)) || /^\s*일부/.test(after) || /일부/.test(m[0])) continue;
      if (REFILED.test(tail)) continue;
      // '취하여'·'취하고'처럼 '취하다(取)'로 쓰인 경우: 앞이 '조치를'·'방안을'·'입장을'이면 철회가 아님
      if (kw === '취하' && /(조치|방안|입장|태도|대책|자세|행동|형태|방식)\s*(를|을)?\s*$/.test(before)) continue;
      if (kw === '해지' && /^\s*(수수료|위약금|일|금)/.test(after)) continue;
      if (kw === '처분 취소 확정') {
        // 같은 문장(앞뒤 60자, 문장 끝에서 자름)에 패소·기각 등이 있으면 회사가 진 것
        let head = s.slice(Math.max(0, m.index - 60), m.index);
        const cutAt = Math.max(head.lastIndexOf('. '), head.lastIndexOf('다.'));
        if (cutAt >= 0) head = head.slice(cutAt + 2);
        let rest = s.slice(m.index + m[0].length, m.index + m[0].length + 60);
        const endAt = rest.search(/\.\s|다\./);
        if (endAt >= 0) rest = rest.slice(0, endAt + 1);
        const seg = head + m[0] + rest;
        if (LAWSUIT_LOST.test(seg) && !LAWSUIT_WON.test(seg)) continue;
      }
      if (event && !['전 항목 삭제', '처분 취소 확정'].includes(kw)) {
        let near = s.slice(Math.max(0, m.index - 30), m.index);
        const stop = Math.max(near.lastIndexOf('. '), near.lastIndexOf('다.'));
        if (stop >= 0) near = near.slice(stop + 1);
        const other = otherDecisionEnd(near, event);
        if (other >= 0 ? !event.test(near.slice(other)) : !event.test(near) && !event.test(after)) continue;
      }
      return { kw, ctx: s.slice(Math.max(0, m.index - 40), m.index + m[0].length + 40) };
    }
  }
  return null;
}

const DELETED = /^(-|－|―|—|삭제|전체삭제|해당사항없음|해당없음)?$/;
const isDeleted = (s) => DELETED.test(squash(s));
// 표 끝의 각주 칸('주2) 정정후'·'[주1]'·'※ …'), 짧은 것만
const isNoteCell = (s) => {
  const q = squash(s);
  return q.length > 0 && q.length <= 12 && /^(\[주\d+\]|\(주\d+\)|주\d+\)|※)/.test(q);
};
// 결정의 핵심 항목: 서식의 1·2번 항목('1. 합병방법'·'2. 양수내역'·'1.분할방법')
const CORE_ITEM = /^\s*[12]\s*[.)]/;
const NUMBERED_ITEM = /^\s*\d+\s*[.)]/;

/**
 * 정정 내용이 그 공시(결정·신청)를 거둬들인 것인지. 정정사유·항목을 먼저, 그다음 정정 후 내용을 본다(정정 전 내용은 보지 않음).
 * 정정사유·항목·정정 후 내용 모두 그 공시의 사건 말이 가까이 있을 때만 본다. 짧은 정정사유(isShortReason)와
 * 다른 결정·안건 이름 없는 정정사유의 '부결'은 사건 말 없이 본다.
 * '전 항목 삭제': 정정 후 칸(각주 칸 빼고)이 모두 '-'·'삭제'이고, 항목 이름에 '일부'가 없고, 정정 전 값이 있던 행이 지워졌으며,
 *   지워진 것이 결정의 핵심일 때만 — 항목 이름이 '전체'·공시 제목(예: 회생절차개시신청)이거나, 1·2번 항목이 지워졌거나,
 *   항목 번호가 없는 표에서 정정 전 값이 있던 행 3개 이상이 모두 지워짐. 뒤쪽 번호 항목(풋옵션·기타 참고사항 등)만 지운 것은 아니다.
 * 반환: { withdrawn, where, kw, ctx }
 */
export function detectWithdraw(p, titleBase = '') {
  // 채권은행 관리절차 공시에서 '절차 중단'은 철회가 아니라 그 자체가 위기 사건(결정 E4: 관리절차 중단도 RS1 근거)
  const skip = new Set(/채권은행등의관리절차/.test(squash(titleBase)) ? ['모든 절차 중단'] : []);
  const event = eventWordsOf(titleBase);
  for (const t of [...p.reasons, ...p.items]) {
    let hit = findWithdraw(t, { skip, event: isShortReason(t, titleBase) ? null : event });
    // 정정사유의 '부결'은 그 공시 안건이 주주총회에서 부결된 것('임시주주총회 의결정족수 부족에 따른 부결')이라
    // 다른 결정·안건 이름이 없으면 사건 말 없이도 본다(이때는 '부결'만)
    if (!hit && /부결/.test(t) && otherDecisionEnd(squash(t), event) < 0 && !OTHER_AGENDA.test(squash(t))) {
      hit = findWithdraw(t, { skip: new Set(KW_LIST.map(([k]) => k).filter((k) => k !== '부결')) });
    }
    // 사건 말 없이 '…합의에 따른 계약 해지'만 적은 정정사유: 다른 결정·계약 이름이 없으면 그 공시의 결정 계약으로 본다
    if (!hit) {
      const c = clean(String(t || ''));
      const gm = c.match(GENERIC_CONTRACT);
      const kwAt = gm ? gm.index + gm[0].length - gm[4].length : 0;
      if (
        gm &&
        otherDecisionEnd(squash(c), event) < 0 &&
        !OTHER_CONTRACT.test(c.slice(0, gm.index + gm[1].length).trim()) &&
        !notEventBefore(c.slice(Math.max(0, kwAt - 40), kwAt), gm[4]) &&
        !REFILED.test(c)
      ) {
        hit = { kw: gm[4], ctx: c.slice(Math.max(0, gm.index - 40), gm.index + gm[0].length + 40) };
      }
    }
    if (hit) return { withdrawn: true, where: 'reason', ...hit };
  }
  for (const t of p.afters) {
    const hit = findWithdraw(t, { skip, event });
    if (hit) return { withdrawn: true, where: 'after', ...hit };
  }
  const tb = squash(titleBase).replace(/^주요사항보고서/, '').replace(/[()]/g, '');
  const itemIsWhole = p.items.some((it) => {
    const s = squash(it).replace(/[()]/g, '');
    return /^(전체|전항목|모든항목)/.test(s) || (s.length >= 4 && tb && (tb.includes(s) || s.includes(tb)));
  });
  const pairs = p.pairs || p.afters.map((a, i) => ({ item: p.items[i] || '', before: (p.befores || [])[i] ?? '', after: a }));
  const body = pairs.filter((x) => !isNoteCell(x.after));
  const allDeleted = p.rows > 0 && body.length > 0 && body.every((x) => isDeleted(x.after));
  // 항목 이름이나 정정사유에 '일부'가 있으면 부분 정정이다('일부 항목(2. 양수가액) 삭제')
  const partial = [...p.items, ...p.reasons].some((it) => /일부/.test(it));
  const valued = body.filter((x) => !isDeleted(x.before)); // 정정 전 값이 있던 행
  const numbered = body.some((x) => NUMBERED_ITEM.test(x.item));
  // 핵심 항목 한 칸만 지운 정정(양수금액만 '-', '회사와 관계'만 '해당사항 없음')은 결정 철회가 아니다: 값 있던 행 2개 이상이 함께 지워져야 한다
  const core = itemIsWhole || (valued.length >= 2 && valued.some((x) => CORE_ITEM.test(x.item))) || (!numbered && valued.length >= 3);
  if (allDeleted && !partial && valued.length > 0 && core) {
    return { withdrawn: true, where: 'after', kw: '전 항목 삭제', ctx: p.items.join(' / ') };
  }
  return { withdrawn: false, kw: null, ctx: '' };
}

// ---------------------------------------------------------------- 사유 해소 (2026-10-06 결정 B)
// 거래소 시장조치·내부결산 시점 공시의 정정 내용에 사유가 해소됐다고 적혀 있으면(아이엘 20260316902716: '외부감사 진행 중 재무제표
// 수정사항 반영으로 해당 사유가 해소되었습니다') 그 공시의 사유가 없어진 것이라 철회와 같이 본다(withdrawn, withdraw_kw '사유 해소').
// 말: '사유가 해소'·'해소되었'·'해당 사유 없음'·'미해당'·'해당하지 않'. 조건·가정('해소될 경우'·'해소 여부'·'해소 시'·'해당하지 않을 경우')과
// 부정('해소되었다고 볼 수 없')은 빼고, '미해당'·'해당하지 않'은 같은 문장 앞 40자(또는 뒤 16자) 안에 사유·관리종목·상장폐지·실질심사·
// 상장적격성·요건이 있을 때만 본다(표의 '3) 미해당' 같은 기준별 칸·'해당/미해당' 선택지·환기종목 등 다른 조치 이야기는 아님).
// 같은 칸에 '여전히 해당'·'사유는 유지'처럼 남은 사유가 적혀 있으면 일부 해소라 보지 않는다.
const RESOLVED_KW = /사유\s*(가|는|이)?\s*(모두\s*)?해소|해소\s*되었|해당\s*사유\s*(가|는)?\s*없|미\s*해당|해당\s*하지\s*않/g;
const RESOLVED_COND_AFTER =
  /^\s*(될|되는|되면|되지|되더라도|된다면|될지|되었는지|되었는가|되었다고\s*(볼|보기|할)\s*수\s*없|된\s*경우|된\s*때|하지\s*못|못|여부|시[\s,.)]|시에|시$|시까지|예정|가능|를\s*위|을\s*위|위해|조건|요건|할\s*경우|하는\s*경우|한\s*경우|할\s*때|하면|되거나|하거나|또는|을\s*(경우|때|시)|는\s*(경우|때)|은\s*경우|으면|는다면|을지|는지|게\s*(되면|될\s*경우))/;
const RESOLVED_NEG_TAIL = /^[^.。]{0,20}((볼|할|단정할|판단할)\s*수\s*없|어렵|아니)/;
// '미해당'·'해당하지 않'은 그 공시의 사유를 두고 쓴 것일 때만(같은 문장 앞 40자·뒤 16자). 투자주의 환기종목·불성실공시 등 다른 조치 이야기는 아니다
const RESOLVED_CONTEXT = /사유|관리\s*종목|상장\s*폐지|실질\s*심사|상장\s*적격성|요건/;
const RESOLVED_OTHER = /환기\s*종목|투자\s*(주의|경고|위험)|불성실|공시\s*위반/;
// '계속'은 '계속사업손실'·'계속기업'에도 있어 바로 뒤에 해당·유지가 올 때만 본다
const RESOLVED_PARTIAL = /(여전히|아직도?|그대로)\s*[^.。]{0,25}(해당|유지|존속)|계속\s+(해당|유지|존속)|사유\s*(는|은|가)?\s*(여전히\s*)?(유지|존속|남아)/;

/** 시장조치·내부결산 공시인지(사유 해소를 보는 공시). 횡령·배임 제목(cat FRAUD)은 사건 자체가 남으므로 보지 않는다 */
export const isResolvableTitle = (titleBase) => !!marketKind(titleBase) && !/횡령|배임/.test(squash(titleBase));

/** 한 글에서 사유 해소 문구를 찾는다. 찾으면 { kw:'사유 해소', ctx } */
export function findResolved(text) {
  const s = clean(String(text || ''));
  if (!s || RESOLVED_PARTIAL.test(s)) return null;
  const g = new RegExp(RESOLVED_KW.source, 'g');
  let m;
  while ((m = g.exec(s))) {
    const after = s.slice(m.index + m[0].length, m.index + m[0].length + 16);
    if (RESOLVED_COND_AFTER.test(after) || RESOLVED_NEG_TAIL.test(after)) continue;
    let before = s.slice(Math.max(0, m.index - 40), m.index);
    const stop = Math.max(before.lastIndexOf('. '), before.lastIndexOf('다.'));
    if (stop >= 0) before = before.slice(stop + 1);
    const neg = /미\s*해당|해당\s*하지/.test(m[0]);
    if (neg) {
      // 표의 기준별 칸('3) 미해당')·서식 선택지('해당/미해당')는 사유 해소가 아니다
      if (/\d\s*\)\s*$/.test(before) || /해당\s*(\/|또는|·|,)\s*$/.test(before) || /^\s*(\/|·)/.test(after)) continue;
      if (!RESOLVED_CONTEXT.test(before) && !RESOLVED_CONTEXT.test(after)) continue;
      if (RESOLVED_OTHER.test(before)) continue;
    }
    return { kw: '사유 해소', ctx: s.slice(Math.max(0, m.index - 60), m.index + m[0].length + 30) };
  }
  return null;
}

/** 정정사유·정정 후 내용에서 사유 해소를 찾는다(항목 이름·정정 전 내용은 보지 않음). 반환: { withdrawn, where, kw, ctx } */
export function detectResolved(p, titleBase = '') {
  if (!isResolvableTitle(titleBase)) return { withdrawn: false, kw: null, ctx: '' };
  for (const [where, list] of [['reason', p.reasons || []], ['after', p.afters || []]]) {
    for (const t of list) {
      const hit = findResolved(t);
      if (hit) return { withdrawn: true, where, ...hit };
    }
  }
  return { withdrawn: false, kw: null, ctx: '' };
}

/** 철회 판단 전체: 철회·취하 등(detectWithdraw)을 먼저, 없으면 시장조치·내부결산 공시의 사유 해소(detectResolved) */
export function judgeWithdraw(p, titleBase = '') {
  const w = detectWithdraw(p, titleBase);
  return w.withdrawn ? w : detectResolved(p, titleBase);
}

/**
 * 첨부정정류의 같은 공시 다른 정정 버전(2026-10-06 결정 F: 미래에셋생명 [첨부정정] 20260326001536 의 철회 내용은
 * 같은 날 [기재정정] 20260326001292 에만 있음). family(최신순)에서 원공시 이후이고 이 정정본 이전(같은 날 포함)인 정정 표시 버전, 최신부터.
 * 첨부정정 자신은 버전 목록에 없는 경우가 많고, 목록의 '[정정]'은 기재정정·첨부정정을 가르지 않아 정정 버전을 모두 본다(정정신고 부분만 읽음).
 */
export function siblingVersions(family, rcpNo, orig, rcptDt = '') {
  const dayOf = (f) => validYmd(String(f.date || '').replace(/\D/g, '')) || f.rcpNo.slice(0, 8);
  const selfDay = validYmd(String(rcptDt || '')) || rcpNo.slice(0, 8);
  const seen = new Set();
  return (family || [])
    .filter((f) => f.rcpNo !== rcpNo && f.label && (!orig || (f.rcpNo !== orig.rcpNo && f.rcpNo > orig.rcpNo)))
    .filter((f) => f.rcpNo < rcpNo || dayOf(f) <= selfDay)
    .filter((f) => !seen.has(f.rcpNo) && seen.add(f.rcpNo))
    .sort((a, b) => b.rcpNo.localeCompare(a.rcpNo));
}

// ---------------------------------------------------------------- 수집
const validateMain = (html) => {
  if (/errorWrap/.test(html)) return 'DART 오류 화면';
  // 공시 화면에는 늘 '본문' 선택 목록(id="family")이 있다. 없으면 점검·오류 화면으로 보고 캐시하지 않는다(다시 실행하면 다시 받음)
  if (!/id=["']family["']/.test(html)) return '공시 화면 형식이 아니에요(본문 선택 목록 없음)';
  return null;
};
const validateView = (html) => {
  if (/errorWrap/.test(html)) return 'DART 오류 화면';
  if (html.length < 200) return '문서 내용이 너무 짧아요';
  return null;
};

/** family(최신순)에서 원공시: 자기 자신이 아니고 머리말 표시가 없는 버전 중 가장 오래된 것. 없으면 자기 자신이 아닌 가장 오래된 버전 */
export function originalOf(family, rcpNo) {
  const others = family.filter((f) => f.rcpNo !== rcpNo && f.rcpNo < rcpNo);
  const plain = others.filter((f) => !f.label);
  const pool = plain.length ? plain : others;
  if (!pool.length) return null;
  return pool.reduce((a, b) => (a.rcpNo < b.rcpNo ? a : b));
}

const emptyParsed = () => ({ found: false, firstDate: null, firstDateKind: null, reasons: [], items: [], afters: [], befores: [], pairs: [], rows: 0 });

/**
 * 공시 화면 정보(parseDartMain 결과)의 정정신고 부분을 받아 읽는다. 목차의 '정정신고(보고)', 목차가 없는 화면(거래소공시)은 문서 하나 전체.
 * 목차는 있는데 정정신고가 없으면(첨부추가 등) 읽지 않는다. 반환 { node, parsed } · 화면을 못 받으면 null(issues 에 남음 → 저장 전 멈춤)
 */
async function readCorrectionPart(web, rcp, info) {
  const corrNode = info.toc.find((n) => /정\s*정\s*신\s*고/.test(n.text));
  const node = corrNode || (info.toc.length ? null : info.doc);
  if (!node) return { node: null, parsed: emptyParsed() };
  const q = { rcpNo: node.rcpNo || rcp, dcmNo: node.dcmNo, eleId: node.eleId, offset: node.offset, length: node.length, dtd: node.dtd };
  const view = await web.get('report/viewer.do', q, `viewer/${rcp}_${node.dcmNo}_${node.eleId}`, { validate: validateView });
  if (view == null) return null;
  return { node, parsed: parseCorrection(view) };
}

function loadTargets() {
  const byRcpt = new Map();
  const counts = {};
  const present = {};
  for (const s of SOURCES) {
    const file = path.join(EXTRA_DIR, s.file);
    present[s.key] = fs.existsSync(file);
    const rows = readJsonl(file);
    let n = 0;
    for (const r of rows) {
      const head = headOf(r.report_nm);
      if (!isCorrectionHead(head) || !s.pick(r)) continue;
      if (!/^\d{14}$/.test(String(r.rcept_no || ''))) continue;
      if (!byRcpt.has(r.rcept_no)) {
        byRcpt.set(r.rcept_no, { ...r, head, src: s.key });
        n++;
      }
    }
    counts[s.key] = n;
  }
  return { targets: [...byRcpt.values()].sort((a, b) => a.rcept_no.localeCompare(b.rcept_no)), counts, present };
}

const cut = (s, n) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function main() {
  const { targets, counts, present } = loadTargets();
  if (!present.major && !present.krx && !present.deadline) {
    throw new DartFatal('data/extra 에 filings_major·filings_krx·filings_deadline 이 없어요. collect:major·collect:krx·collect:deadline 을 먼저 실행해 주세요.');
  }
  const missingSrc = Object.entries(present).filter(([, v]) => !v).map(([k]) => k);
  const web = createDartWeb();
  log(
    `정정공시 확인: ${targets.length}건 (주요사항 ${counts.major} · 거래소공시 ${counts.krx} · 연장신고 ${counts.deadline})` +
      `${missingSrc.length ? ` · 아직 수집 전: ${missingSrc.join('·')}` : ''}. 공시마다 DART 웹 화면 2번(첨부추가는 1번), 1초 간격`,
  );
  const out = [];
  const noFamily = [];
  const noSection = [];
  const dateMismatch = [];
  const sib = { targets: 0, versions: 0, found: [] }; // 첨부정정류의 다른 정정 버전 확인(결정 F)
  let i = 0;
  for (const t of targets) {
    i++;
    const rcp = t.rcept_no;
    const mainHtml = await web.get('dsaf001/main.do', { rcpNo: rcp }, `main/${rcp}`, { validate: validateMain });
    if (mainHtml == null) continue; // issues 에 남음 → 저장 전 멈춤
    const info = parseDartMain(mainHtml);
    const orig = originalOf(info.family, rcp);
    if (!info.family.length) noFamily.push(rcp);
    // [첨부추가]는 같은 접수번호에 첨부서류만 더한 것이라 버전 목록에 자기 자신(머리말 없음)만 있다 → 자기 자신이 원공시(본문 있음)
    const selfOriginal = !orig && info.family.length > 0 && info.family.every((f) => f.rcpNo === rcp && !f.label);
    const part = await readCorrectionPart(web, rcp, info);
    if (part == null) continue; // issues 에 남음 → 저장 전 멈춤
    const { node, parsed } = part;
    if (!parsed.found && (node || /정정/.test(t.head))) noSection.push(`${rcp} ${t.corp_name || ''} ${squash(t.report_nm)}`);
    // 버전 목록의 날짜(YYYY.MM.DD)가 OpenDART rcept_dt 와 같다(Q1 캐시 226건 확인). 없으면 접수번호 앞 8자리
    const origDate = orig ? validYmd(String(orig.date || '').replace(/\D/g, '')) || orig.rcpNo.slice(0, 8) : null;
    const docDate = parsed.firstDate && parsed.firstDate <= t.rcept_dt ? parsed.firstDate : null;
    // 정정신고에 적힌 날짜는 회사가 쓴 제출일(접수번호 날짜)이라 하루쯤 다른 것이 흔하다. 사흘 넘게 다르면 확인용으로 보여 준다
    // (오기, 또는 거래소공시처럼 바로 앞 버전 날짜를 적은 경우)
    if (origDate && docDate && Math.abs(Date.parse(isoOf(origDate)) - Date.parse(isoOf(docDate))) > 3 * 864e5) {
      dateMismatch.push(`${rcp} 원공시 ${origDate} · 정정신고 ${docDate}${parsed.firstDateKind === 'prev' ? '(정정관련 공시서류제출일)' : ''}`);
    }
    // 원공시를 못 찾았을 때 대신 쓰는 것은 '최초제출일'뿐이다. 거래소공시 '정정관련 공시서류제출일'(바로 앞 버전 날짜)은
    // 비교에만 쓰고 first_date 로 쓰지 않는다 → 원공시도 최초제출일도 없으면 null(data:build 는 rcept_dt 로 판정)
    const first = origDate || (parsed.firstDateKind === 'first' ? docDate : null) || (selfOriginal ? t.rcept_dt : null);
    const title = baseTitle(t.report_nm);
    let w = parsed.found ? judgeWithdraw(parsed, title) : { withdrawn: false, kw: null, ctx: '' };
    // 첨부정정류: 자기 정정신고에 철회가 없으면 같은 공시의 다른 정정 버전(원공시 이후·이 정정본 이전, 같은 날 포함)의 정정신고도 본다(결정 F)
    let wFrom = null;
    if (!w.withdrawn && !selfOriginal && (isAttachOnly(t.head) || /첨부정정/.test(t.head))) {
      const sibs = siblingVersions(info.family, rcp, orig, t.rcept_dt);
      if (sibs.length) sib.targets++;
      let failed = false;
      for (const s of sibs) {
        sib.versions++;
        const sm = await web.get('dsaf001/main.do', { rcpNo: s.rcpNo }, `main/${s.rcpNo}`, { validate: validateMain });
        const sp = sm == null ? null : await readCorrectionPart(web, s.rcpNo, parseDartMain(sm));
        if (sp == null) {
          failed = true; // issues 에 남음 → 저장 전 멈춤
          break;
        }
        if (!sp.parsed.found) continue;
        const sw = judgeWithdraw(sp.parsed, title);
        if (sw.withdrawn) {
          w = sw;
          wFrom = s.rcpNo;
          break;
        }
      }
      if (failed) continue;
    }
    if (wFrom) sib.found.push(`${rcp} ${t.corp_name || ''} ${squash(t.report_nm)} ← 정정본 ${wFrom} [${w.kw}]`);
    const reasonText = parsed.reasons.join(' / ');
    // 철회 근거 문맥이 정정사유에 이미 들어 있으면 덧붙이지 않는다. 다른 정정 버전에서 찾았으면 그 접수번호를 앞에 붙인다
    const ctx = w.withdrawn && (wFrom || !reasonText.includes(clean(w.ctx))) ? `${wFrom ? `정정본 ${wFrom}: ` : ''}${clean(w.ctx)}` : '';
    const reason = cut(clean([reasonText, ctx].filter(Boolean).join(' · ')), 200);
    out.push({
      rcept_no: rcp,
      corp_code: t.corp_code,
      report_nm: clean(String(t.report_nm || '')),
      rcept_dt: t.rcept_dt,
      first_date: first,
      first_rcept_no: orig ? orig.rcpNo : selfOriginal ? rcp : null,
      withdrawn: w.withdrawn,
      withdraw_kw: w.withdrawn ? w.kw : null,
      reason,
      attach_only: isAttachOnly(t.head) && !selfOriginal,
      source: parsed.found ? 'dartweb' : 'dartweb-family',
    });
    if (i % 25 === 0 || i === targets.length) log(`  ${i}/${targets.length}건 확인 (새 요청 ${web.stats.calls} · 캐시 ${web.stats.cached})`);
  }

  // 확인용 출력 (멈추는 경우에도 볼 수 있게 저장 판단 전에 출력)
  const wd = out.filter((r) => r.withdrawn);
  const byKw = new Map();
  for (const r of wd) byKw.set(r.withdraw_kw, (byKw.get(r.withdraw_kw) || 0) + 1);
  log(
    `  최초 공시일 확인 ${out.filter((r) => r.first_date).length}/${out.length}건 · 원공시 접수번호 ${out.filter((r) => r.first_rcept_no).length}건 · ` +
      `첨부정정류 ${out.filter((r) => r.attach_only).length}건 · 철회·취하 등 ${wd.length}건` +
      `${wd.length ? ` (${[...byKw].map(([k, v]) => `${k} ${v}`).join(', ')})` : ''}`,
  );
  for (const r of wd.slice(0, 40)) log(`    철회 감지 ${r.rcept_no} ${r.report_nm} [${r.withdraw_kw}] ${cut(r.reason, 90)}`);
  if (wd.length > 40) log(`    … 외 ${wd.length - 40}건`);
  // 거래소 시장조치·내부결산 정정공시(유형별)와 사유 해소(결정 B·C·E). 유형은 지금 규칙(marketKind)으로 다시 본다
  const mktRows = out.map((r) => ({ ...r, mkt: marketKind(r.report_nm) })).filter((r) => r.mkt);
  const resolved = out.filter((r) => r.withdraw_kw === '사유 해소');
  log(
    `  거래소 시장조치 정정공시 ${mktRows.length}건(${marketKindCounts(mktRows)}) · 사유 해소 ${resolved.length}건` +
      `${resolved.length ? ` (${marketKindCounts(resolved.map((r) => ({ mkt: marketKind(r.report_nm) })))})` : ''}`,
  );
  log(
    `  첨부정정류 중 다른 정정 버전을 본 공시 ${sib.targets}건(버전 ${sib.versions}개 확인) · 그 버전에서 철회를 찾은 공시 ${sib.found.length}건`,
  );
  for (const s of sib.found.slice(0, 10)) log(`    ${s}`);
  if (noSection.length) {
    log(`  정정신고 부분을 못 읽은 공시 ${noSection.length}건(원공시 정보만 저장, 철회 판단 못 함):`);
    for (const s of noSection.slice(0, 10)) log(`    ${s}`);
  }
  if (dateMismatch.length) {
    log(`  원공시 날짜와 정정신고의 제출일(최초제출일·정정관련 공시서류제출일)이 사흘 넘게 다른 공시 ${dateMismatch.length}건(버전 목록의 원공시 날짜를 씀):`);
    for (const s of dateMismatch.slice(0, 10)) log(`    ${s}`);
  }
  reportWebStats('corrections', web.stats);

  // 저장 전 검사: 화면 요청 실패·이상 화면 → 버전 목록 못 읽음
  assertNoIssues(web, 'corrections');
  if (noFamily.length) {
    throw new DartFatal(
      `공시 화면에서 버전 목록(본문 선택)을 읽지 못한 공시가 ${noFamily.length}건이에요(예: ${noFamily.slice(0, 5).join(', ')}). ` +
        'DART 화면 형식이 바뀌었을 수 있어 저장하지 않았어요. data/raw/dartweb/main 의 해당 화면을 확인해 주세요.',
    );
  }
  const file = path.join(EXTRA_DIR, 'corrections.jsonl');
  writeJsonl(file, out);
  writeExtraMeta(
    'corrections',
    {
      targets: targets.length,
      records: out.length,
      bySource: counts,
      firstKnown: out.filter((r) => r.first_date).length,
      withdrawn: wd.length,
      resolved: resolved.length,
      fromSibling: sib.found.length,
      attachOnly: out.filter((r) => r.attach_only).length,
      noSection: noSection.length,
    },
    out,
  );
  log(`완료: 정정공시 ${out.length}건(철회·취하 등 ${wd.length}건) → ${file}`);
}

runCollector('corrections', main);
