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
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp-${process.pid}`;
  try {
    fs.writeFileSync(tmp, JSON.stringify(json), 'utf8');
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
  throw new DartFatal(
    `응답 상태가 정상(000·013)이 아닌 요청이 ${list.length}건 있어 결과를 저장하지 않았어요. 같은 명령을 다시 실행하면 그 요청만 다시 받아요.`,
  );
}

/** 수집 스크립트 실행: 실패하면 이유를 한 줄로 보여 주고 종료 코드 1. 성공하면 아무것도 하지 않는다 */
export function runCollector(name, mainFn) {
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
