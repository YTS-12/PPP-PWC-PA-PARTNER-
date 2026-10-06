// OpenDART 호출 공통 모듈: 간격 유지, 재시도, 상태코드 처리, 원본 응답 캐시(이어받기)
// DART_BASE_URL 은 모의 서버 시험용이에요. http://127.0.0.1:포트 · http://localhost:포트 만 받고, 없으면 OpenDART 로 보내요.
// 모의 서버로 받은 응답은 data/raw/_mock 에 따로 캐시해요. 실제 수집 캐시(data/raw/<엔드포인트>)에 섞이지 않게.
// 정상(000·013) 응답 없이 이상 응답이 10번 연속 오면 한도를 헛되이 쓰지 않게 바로 멈춰요.
import fs from 'node:fs';
import path from 'node:path';
import { RAW_DIR } from './common.mjs';

const DEFAULT_BASE = 'https://opendart.fss.or.kr/api';
const MAX_TRIES = 4; // 실패하면 2·4·8초 간격으로 최대 4번 시도 (마지막 시도 뒤에는 기다리지 않음)
const RETRY_BASE_MS = 2000;
const MAX_BAD_RUN = 10; // 정상 응답 없이 이상 응답(issues 대상)이 이만큼 이어지면 멈춘다
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DartFatal extends Error {}

// 모의 서버 주소만 허용: 잘못된 값이면 createDart 에서 DartFatal 로 멈춘다 (불러오는 순간 멈추면 runCollector 가 못 잡음)
const BASE_ENV = (process.env.DART_BASE_URL || '').trim();
const BASE_OK = !BASE_ENV || /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}(\/|$)/.test(BASE_ENV);
export const DART_BASE = !BASE_ENV ? DEFAULT_BASE : BASE_OK ? BASE_ENV.replace(/\/+$/, '') : null;
// 응답 캐시 위치: 실제 OpenDART 면 data/raw, 모의 서버면 data/raw/_mock
export const CACHE_DIR = DART_BASE && DART_BASE !== DEFAULT_BASE ? path.join(RAW_DIR, '_mock') : RAW_DIR;

const errText = (e) => {
  const msg = e && e.message ? e.message : String(e);
  const code = e && e.cause && e.cause.code;
  return code ? `${msg} (${code})` : msg;
};

/** 캐시 읽기: 없으면 null. 깨진 파일(쓰다 끊긴 것 등)은 지우고 null → 새로 받는다 */
function readCache(file) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  try {
    const json = JSON.parse(text);
    if (json && typeof json === 'object') return json;
  } catch {
    // 아래에서 지운다
  }
  try {
    fs.unlinkSync(file);
  } catch {
    // 이미 지워졌으면 그대로 둔다
  }
  console.log(`  깨진 캐시를 지우고 다시 받아요: ${path.relative(RAW_DIR, file)}`);
  return null;
}

/** 캐시 쓰기: 임시 파일에 다 쓴 뒤 이름을 바꿔, 중간에 끊겨도 반쯤 쓴 캐시가 남지 않게 한다 */
async function writeCache(file, json) {
  await writeFileAtomic(file, JSON.stringify(json));
}

async function writeFileAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, text, 'utf8');
    // Windows 에서 백신 검사 등으로 잠깐 잠기면 이름 바꾸기가 실패할 수 있어 몇 번 더 해 본다
    for (let i = 0; ; i++) {
      try {
        fs.renameSync(tmp, file);
        return;
      } catch (e) {
        if (i >= 4 || !['EPERM', 'EACCES', 'EBUSY'].includes(e.code)) throw e;
        await sleep(100 * (i + 1));
      }
    }
  } catch (e) {
    try {
      fs.unlinkSync(tmp);
    } catch {
      // 임시 파일이 없으면 그대로 둔다
    }
    throw e;
  }
}

export function createDart({ intervalMs = 220 } = {}) {
  if (!DART_BASE) {
    throw new DartFatal(
      'DART_BASE_URL은 모의 서버 시험용이라 http://127.0.0.1:포트 또는 http://localhost:포트만 쓸 수 있어요. 실제 수집이면 .env에서 DART_BASE_URL을 지워 주세요.',
    );
  }
  const key = (process.env.DART_API_KEY || '').trim();
  if (!key || key.includes('여기에')) {
    throw new DartFatal('DART_API_KEY가 비어 있어요. 프로젝트 폴더의 .env 파일에 OpenDART 인증키를 넣어 주세요.');
  }
  if (DART_BASE !== DEFAULT_BASE) {
    console.log(
      `  모의 서버(${DART_BASE})로 요청해요. 응답 캐시는 data/raw/_mock 에 따로 둬요. 실제 수집이면 DART_BASE_URL을 지워 주세요.`,
    );
  }
  const redact = (s) => String(s).split(key).join('***');
  let last = 0;
  let badRun = 0; // 정상(000·013) 응답 없이 이어진 이상 응답 수. 캐시에서 읽은 응답은 세지도 초기화하지도 않는다
  const badStatuses = new Set();
  const stats = { calls: 0, cached: 0, ok: 0, empty: 0, other: 0 };
  // 상태가 000·013 이 아닌 응답 기록. stats.issues 로도 볼 수 있다(열거되지 않음: reportStats 용)
  const issues = [];
  Object.defineProperty(stats, 'issues', { value: issues });

  async function pace() {
    const gap = last + intervalMs - Date.now();
    if (gap > 0) await sleep(gap);
    last = Date.now();
  }

  /**
   * endpoint: 'list.json' 등, params: 요청 인자(인증키 제외), cacheKey: 원본 저장 이름
   * 반환: DART 응답 JSON (status 000·013 등). 한도 초과(020)·키 문제·4번 모두 실패는 DartFatal로 멈춘다.
   * 000·013 이 아닌 응답(예: 100 잘못된 값)은 그대로 돌려주고 issues 에 남긴다 → 저장 전에 assertNoIssues 로 멈춘다.
   * 다만 정상 응답 없이 이런 응답이 MAX_BAD_RUN(10)번 이어지면 키·요청 설정 문제로 보고 바로 DartFatal 로 멈춘다.
   */
  async function call(endpoint, params = {}, cacheKey) {
    const dir = path.join(CACHE_DIR, endpoint.replace(/\.json$/, ''));
    const file = cacheKey ? path.join(dir, `${cacheKey}.json`) : null;
    const hit = file ? readCache(file) : null;
    if (hit) {
      stats.cached++;
      // 캐시된 정상 응답은 키·요청 설정이 맞다는 뜻이라 연속 오류 수를 되돌린다(다시 실행할 때 흩어진 실패가 몰려 오탐하지 않게)
      badRun = 0;
      badStatuses.clear();
      return hit;
    }
    const { crtfc_key: _drop, ...plain } = params;
    const qs = new URLSearchParams({ crtfc_key: key, ...plain });
    let lastErr = '';
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1)); // 2·4·8초
      await pace();
      stats.calls++;
      let json;
      try {
        const res = await fetch(`${DART_BASE}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        json = await res.json();
        if (!json || typeof json !== 'object') throw new Error('응답이 JSON 객체가 아니에요');
      } catch (e) {
        lastErr = redact(errText(e));
        continue;
      }
      const st = json.status;
      if (st === '020') throw new DartFatal('하루 요청 한도(020)를 넘었어요. 내일 같은 명령을 다시 실행하면 받은 곳부터 이어서 받아요.');
      if (['010', '011', '012', '901'].includes(st)) throw new DartFatal(`인증키 문제(${st}): ${json.message}`);
      if (st === '800' || st === '900') {
        lastErr = `DART 일시 오류(${st}): ${json.message}`;
        continue;
      }
      if (st === '000' || st === '013') {
        if (st === '000') stats.ok++;
        else stats.empty++;
        badRun = 0;
        badStatuses.clear();
      } else {
        stats.other++;
        const issue = { status: st, message: json.message || '', endpoint, params: { ...plain } };
        issues.push(issue);
        badRun++;
        badStatuses.add(st ?? '없음');
        if (badRun >= MAX_BAD_RUN) {
          const sts = [...badStatuses].join('·');
          console.error(`  마지막 응답: ${issue.status ?? '상태 없음'} ${issue.message} · ${endpoint} ${fmtParams(issue.params)}`);
          throw new DartFatal(
            `${badStatuses.size > 1 ? '' : '같은 '}오류(상태 ${sts})가 ${MAX_BAD_RUN}번 연속이에요. 키·요청 설정을 확인해 주세요. ` +
              '받은 결과는 캐시에 남아 있어 다시 실행하면 이어서 받아요.',
          );
        }
      }
      if (file && (st === '000' || st === '013')) await writeCache(file, json);
      return json;
    }
    throw new DartFatal(
      `${endpoint} 요청이 ${MAX_TRIES}번 모두 실패했어요(${lastErr}). 잠시 뒤 같은 명령을 다시 실행하면 받은 곳부터 이어서 받아요.`,
    );
  }

  return { call, stats, issues };
}

/** "1,234" · "-1,234" · "-" → 정수 또는 null */
export function amount(v) {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/,/g, '').trim();
  if (!s || s === '-') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function reportStats(name, stats) {
  const need = Array.isArray(stats.issues) ? stats.issues.length : stats.other || 0;
  console.log(
    `[${name}] 새 호출 ${stats.calls}건 · 캐시 ${stats.cached}건 · 정상 ${stats.ok} · 데이터 없음 ${stats.empty} · 기타 ${stats.other} · 확인 필요 ${need}건`,
  );
}

// 요청 인자를 한 줄로: 긴 값(100곳 corp_code 등)은 앞부분만
const fmtParams = (p) =>
  Object.entries(p || {})
    .map(([k, v]) => {
      const s = String(v);
      return `${k}=${s.length > 40 ? `${s.slice(0, 40)}…` : s}`;
    })
    .join('&');

/** 000·013 이 아닌 응답이 있으면 상위 10건을 보여 주고 멈춘다. 결과 jsonl·meta 를 쓰기 직전에 부른다 */
export function assertNoIssues(dart, name) {
  const list = (dart && dart.issues) || [];
  if (!list.length) return;
  const byStatus = new Map();
  for (const it of list) byStatus.set(it.status, (byStatus.get(it.status) || 0) + 1);
  console.error(
    `[${name}] 확인 필요 ${list.length}건 (${[...byStatus].map(([s, n]) => `${s ?? '상태 없음'} ${n}건`).join(', ')})`,
  );
  for (const it of list.slice(0, 10)) {
    console.error(`  ${it.status ?? '상태 없음'} ${it.message} · ${it.endpoint} ${fmtParams(it.params)}`);
  }
  if (list.length > 10) console.error(`  … 외 ${list.length - 10}건`);
  const what = list.every((it) => it.web) ? 'DART 웹 화면을 제대로 받지 못한 요청이' : '응답 상태가 정상(000·013)이 아닌 요청이';
  throw new DartFatal(
    `${what} ${list.length}건 있어 결과를 저장하지 않았어요. 같은 명령을 다시 실행하면 그 요청만 다시 받아요.`,
  );
}

// 다른 수집 스크립트의 함수만 가져다 쓸 때(예: auditor-supp 가 auditor-2026h1 의 pickCurrent 를 씀) 그 스크립트의
// runCollector(main) 가 실행되지 않게 하는 표시. importAsLibrary 가 불러오는 동안만 켠다.
let libraryImportDepth = 0;
/**
 * 수집 스크립트를 함수 모음으로만 불러온다: load 는 () => import('./other.mjs'). 불러오는 동안 그 스크립트 맨 끝의
 * runCollector 는 아무것도 하지 않는다. 정적 import 는 이 표시보다 먼저 실행되므로 꼭 이 함수로 동적 import 한다.
 */
export async function importAsLibrary(load) {
  libraryImportDepth++;
  try {
    return await load();
  } finally {
    libraryImportDepth--;
  }
}

/** 수집 스크립트 실행: 실패하면 이유를 한 줄로 보여 주고 종료 코드 1. 성공하면 아무것도 하지 않는다 */
export function runCollector(name, mainFn) {
  if (libraryImportDepth > 0) return Promise.resolve(); // importAsLibrary 로 함수만 가져가는 중
  return Promise.resolve()
    .then(() => mainFn())
    .catch((e) => {
      if (e instanceof DartFatal) {
        console.error(`중단: ${e.message}`);
      } else {
        console.error(`중단: 예기치 않은 오류 – ${errText(e)}`);
        console.error('같은 명령을 다시 실행하면 받은 곳부터 이어서 받아요.');
        if (process.env.DEBUG) console.error(`[${name}]`, e);
      }
      process.exit(1);
    });
}

// ===================== DART 웹(dart.fss.or.kr) 공시 화면 =====================
// OpenDART API 로 받을 수 없는 것만 공시 화면에서 읽는다: 정정공시의 최초 공시·정정 내용(collect:corrections), API 두 곳 모두
// 감사인이 없는 회사의 보고서 '외부감사에 관한 사항' 표(collect:auditor-web, 2026-10-06 결정 A). 이 두 명령만 createDartWeb 을 쓴다.
// 요청 간격 1초 이상, 실패하면 2·4·8초 뒤 다시 시도(최대 4번). 받은 화면은 data/raw/dartweb/<종류>/<이름>.html 에 캐시해
// 다시 실행하면 받은 화면은 새로 요청하지 않는다(이어받기). 403·429(차단·과다 요청)는 바로 멈춘다.
// DARTWEB_BASE_URL 은 모의 서버 시험용이다. DART_BASE_URL 처럼 http://127.0.0.1:포트 · http://localhost:포트 만 받고,
// 모의 서버로 받은 화면은 data/raw/_mock/dartweb 에 따로 캐시한다.
const WEB_DEFAULT = 'https://dart.fss.or.kr';
const WEB_ENV = (process.env.DARTWEB_BASE_URL || '').trim();
const WEB_ENV_OK = !WEB_ENV || /^http:\/\/(127\.0\.0\.1|localhost):\d{1,5}(\/|$)/.test(WEB_ENV);
export const DARTWEB_BASE = !WEB_ENV ? WEB_DEFAULT : WEB_ENV_OK ? WEB_ENV.replace(/\/+$/, '') : null;
export const WEB_CACHE_DIR =
  DARTWEB_BASE && DARTWEB_BASE !== WEB_DEFAULT ? path.join(RAW_DIR, '_mock', 'dartweb') : path.join(RAW_DIR, 'dartweb');
const WEB_MIN_INTERVAL_MS = 1000;
const WEB_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)';

/** 응답 바이트를 글자로: Content-Type·meta 의 charset 을 먼저 보고, 깨지면 UTF-8 ↔ EUC-KR 을 바꿔 다시 읽는다 */
function decodeHtml(buf, contentType) {
  const label = (s) => {
    const v = String(s || '').toLowerCase();
    if (!v) return '';
    return /euc-?kr|ks_c_5601|cp949|ms949/.test(v) ? 'euc-kr' : /utf-?8/.test(v) ? 'utf-8' : '';
  };
  const fromHeader = label((String(contentType || '').match(/charset=["']?([\w-]+)/i) || [])[1]);
  const fromMeta = label((buf.subarray(0, 4096).toString('latin1').match(/charset=["']?([\w-]+)/i) || [])[1]);
  const first = fromHeader || fromMeta || 'utf-8';
  const order = first === 'euc-kr' ? ['euc-kr', 'utf-8'] : ['utf-8', 'euc-kr'];
  for (const enc of order) {
    try {
      return new TextDecoder(enc, { fatal: true }).decode(buf);
    } catch {
      // 다음 인코딩으로
    }
  }
  return new TextDecoder(first).decode(buf);
}

/** 화면 캐시 읽기: 없으면 null. 빈 파일(쓰다 끊긴 것)은 지우고 null → 새로 받는다 */
function readTextCache(file) {
  let t;
  try {
    t = fs.readFileSync(file, 'utf8');
  } catch (e) {
    if (e.code === 'ENOENT') return null;
    throw e;
  }
  if (t.length > 0) return t;
  try {
    fs.unlinkSync(file);
  } catch {
    // 이미 없으면 그대로
  }
  return null;
}

/**
 * DART 웹 화면 요청기. get(경로, 요청 인자, 캐시 이름, { validate }) → 화면 글자(HTML) 또는 null.
 * - validate(html) 가 문자열(이상 이유)을 돌려주면 이상 화면으로 보고 캐시하지 않고 issues 에 남긴 뒤 null 을 돌려준다
 *   → 수집 스크립트가 저장 직전 assertNoIssues 로 멈춘다(dart.call 의 000·013 아닌 응답과 같은 처리).
 *   캐시된 화면도 validate 를 다시 통과해야 쓴다(통과 못 하면 새로 받는다).
 * - 네트워크 오류·5xx 는 2·4·8초 뒤 다시 시도, 4번 모두 실패하면 DartFatal. 403·429 는 바로 DartFatal.
 * - 이상 화면·404 같은 실패가 정상 화면 없이 10번 이어지면 주소·차단 문제로 보고 DartFatal.
 */
export function createDartWeb({ intervalMs = WEB_MIN_INTERVAL_MS } = {}) {
  if (!DARTWEB_BASE) {
    throw new DartFatal(
      'DARTWEB_BASE_URL은 모의 서버 시험용이라 http://127.0.0.1:포트 또는 http://localhost:포트만 쓸 수 있어요. 실제 수집이면 .env에서 DARTWEB_BASE_URL을 지워 주세요.',
    );
  }
  const mock = DARTWEB_BASE !== WEB_DEFAULT;
  // 실제 DART 웹은 1초보다 짧게 요청하지 않는다. 모의 서버 시험만 DARTWEB_MOCK_INTERVAL_MS 로 줄일 수 있다
  const mockGap = Number(process.env.DARTWEB_MOCK_INTERVAL_MS);
  const gapMs = mock && process.env.DARTWEB_MOCK_INTERVAL_MS && Number.isFinite(mockGap) && mockGap >= 0
    ? mockGap
    : Math.max(WEB_MIN_INTERVAL_MS, intervalMs);
  if (mock) console.log(`  모의 DART 웹(${DARTWEB_BASE})으로 요청해요. 화면 캐시는 data/raw/_mock/dartweb 에 따로 둬요.`);
  let last = 0;
  let badRun = 0;
  const stats = { calls: 0, cached: 0, ok: 0, other: 0 };
  const issues = [];
  Object.defineProperty(stats, 'issues', { value: issues });

  async function pace() {
    const gap = last + gapMs - Date.now();
    if (gap > 0) await sleep(gap);
    last = Date.now();
  }

  function bad(issue) {
    stats.other++;
    issues.push({ web: true, ...issue });
    badRun++;
    if (badRun >= MAX_BAD_RUN) {
      console.error(`  마지막 실패: ${issue.status} ${issue.message} · ${issue.endpoint} ${fmtParams(issue.params)}`);
      throw new DartFatal(
        `DART 웹 화면 요청이 ${MAX_BAD_RUN}번 연속 실패했어요(마지막: ${issue.status}). 주소·접속 상태를 확인해 주세요. ` +
          '받은 화면은 캐시에 남아 있어 다시 실행하면 이어서 받아요.',
      );
    }
    return null;
  }

  async function get(pathname, params = {}, cacheKey, { validate } = {}) {
    const check = (html) => (validate ? validate(html) : html.trim() ? null : '빈 화면');
    const file = cacheKey ? path.join(WEB_CACHE_DIR, `${cacheKey}.html`) : null;
    const hit = file ? readTextCache(file) : null;
    if (hit && !check(hit)) {
      stats.cached++;
      badRun = 0;
      return hit;
    }
    const endpoint = pathname.replace(/^\/+/, '');
    const url = `${DARTWEB_BASE}/${endpoint}?${new URLSearchParams(params)}`;
    let lastErr = '';
    for (let attempt = 0; attempt < MAX_TRIES; attempt++) {
      if (attempt > 0) await sleep(RETRY_BASE_MS * 2 ** (attempt - 1)); // 2·4·8초
      await pace();
      stats.calls++;
      let res;
      let html;
      try {
        res = await fetch(url, {
          headers: { 'User-Agent': WEB_UA, Referer: `${DARTWEB_BASE}/` },
          signal: AbortSignal.timeout(30000),
        });
        if (res.status === 403 || res.status === 429) {
          throw new DartFatal(
            `DART 웹이 요청을 막았어요(HTTP ${res.status}). 한참 뒤에 같은 명령을 다시 실행하면 받은 화면은 캐시로 건너뛰고 이어서 받아요.`,
          );
        }
        if (res.status >= 500) throw new Error(`HTTP ${res.status}`);
        html = decodeHtml(Buffer.from(await res.arrayBuffer()), res.headers.get('content-type'));
      } catch (e) {
        if (e instanceof DartFatal) throw e;
        lastErr = errText(e);
        continue;
      }
      if (!res.ok) return bad({ status: `HTTP ${res.status}`, message: '화면을 받지 못했어요', endpoint, params });
      const why = check(html);
      if (why) return bad({ status: '화면 이상', message: why, endpoint, params });
      stats.ok++;
      badRun = 0;
      if (file) await writeFileAtomic(file, html);
      return html;
    }
    throw new DartFatal(
      `DART 웹 ${endpoint} 요청이 ${MAX_TRIES}번 모두 실패했어요(${lastErr}). 잠시 뒤 같은 명령을 다시 실행하면 받은 화면은 건너뛰고 이어서 받아요.`,
    );
  }

  return { get, stats, issues, mock };
}

export function reportWebStats(name, stats) {
  const need = Array.isArray(stats.issues) ? stats.issues.length : stats.other || 0;
  console.log(`[${name}] DART 웹 새 요청 ${stats.calls}건 · 캐시 ${stats.cached}건 · 정상 ${stats.ok} · 확인 필요 ${need}건`);
}

/**
 * 공시 화면(dsaf001/main.do) 읽기.
 * 반환: { title, family: [{ rcpNo, date: 'YYYY.MM.DD', label: '[정정]'|'', title }], toc: [{ text, rcpNo, dcmNo, eleId, offset, length, dtd }],
 *        doc: 처음 여는 문서 { rcpNo, dcmNo, eleId, offset, length, dtd } | null }
 * family 는 '본문' 선택 목록(같은 공시의 원공시·정정공시 버전, 최신순). 첨부정정은 자기 자신 없이 원공시만 나오기도 한다.
 * toc 는 왼쪽 목차(주요사항보고서·반기보고서·사업보고서 등). 거래소공시처럼 목차가 없는 화면은 toc 가 비고 doc 만 있다.
 */
export function parseDartMain(html) {
  const title = ((html.match(/<title>([^<]*)<\/title>/i) || [])[1] || '').trim();
  const family = [];
  const sel = html.match(/<select[^>]*id=["']family["'][^>]*>([\s\S]*?)<\/select>/i);
  if (sel) {
    const re = /<option\s+value=["']rcpNo=(\d{14})["']([^>]*)>([\s\S]*?)<\/option>/gi;
    let m;
    while ((m = re.exec(sel[1]))) {
      const text = m[3].replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();
      const date = (text.match(/(\d{4}\.\d{2}\.\d{2})/) || [])[1] || '';
      const label = (text.match(/\[[^\]]*\]/) || [])[0] || '';
      const t = (m[2].match(/title=["']([^"']*)["']/) || [])[1] || '';
      family.push({ rcpNo: m[1], date, label, title: t.trim() });
    }
  }
  const toc = [];
  const blocks = html.split(/var\s+node\d+\s*=\s*\{\s*\}\s*;/).slice(1);
  for (const blk of blocks) {
    const field = (k) => ((blk.match(new RegExp(`node\\d+\\['${k}'\\]\\s*=\\s*"((?:[^"\\\\]|\\\\.)*)"`)) || [])[1] || '');
    const node = {
      text: field('text').replace(/\\(["'\\/])/g, '$1'),
      rcpNo: field('rcpNo'),
      dcmNo: field('dcmNo'),
      eleId: field('eleId'),
      offset: field('offset'),
      length: field('length'),
      dtd: field('dtd'),
    };
    if (node.dcmNo && node.text) toc.push(node);
  }
  const dv = html.match(/viewDoc\(\s*"(\d{14})",\s*"(\d+)",\s*"(\d+)",\s*"(\d+)",\s*"(\d+)",\s*"([^"]*)"/);
  const doc = dv ? { rcpNo: dv[1], dcmNo: dv[2], eleId: dv[3], offset: dv[4], length: dv[5], dtd: dv[6] } : null;
  return { title, family, toc, doc };
}
