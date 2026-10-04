// OpenDART 호출 공통 모듈: 간격 유지, 재시도, 상태코드 처리, 원본 응답 캐시(이어받기)
import fs from 'node:fs';
import path from 'node:path';
import { RAW_DIR } from './common.mjs';

const BASE = 'https://opendart.fss.or.kr/api';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export class DartFatal extends Error {}

export function createDart({ intervalMs = 220 } = {}) {
  const key = (process.env.DART_API_KEY || '').trim();
  if (!key || key.includes('여기에')) {
    throw new DartFatal('DART_API_KEY가 비어 있어요. 프로젝트 폴더의 .env 파일에 OpenDART 인증키를 넣어 주세요.');
  }
  let last = 0;
  const stats = { calls: 0, cached: 0, ok: 0, empty: 0, other: 0 };

  async function pace() {
    const gap = last + intervalMs - Date.now();
    if (gap > 0) await sleep(gap);
    last = Date.now();
  }

  /**
   * endpoint: 'list.json' 등, params: 요청 인자(인증키 제외), cacheKey: 원본 저장 이름
   * 반환: DART 응답 JSON (status 000·013 등). 한도 초과(020)·키 문제는 DartFatal로 멈춘다.
   */
  async function call(endpoint, params, cacheKey) {
    const dir = path.join(RAW_DIR, endpoint.replace(/\.json$/, ''));
    const file = cacheKey ? path.join(dir, `${cacheKey}.json`) : null;
    if (file && fs.existsSync(file)) {
      stats.cached++;
      return JSON.parse(fs.readFileSync(file, 'utf8'));
    }
    const qs = new URLSearchParams({ crtfc_key: key, ...params });
    let lastErr;
    for (let attempt = 0; attempt < 4; attempt++) {
      await pace();
      stats.calls++;
      try {
        const res = await fetch(`${BASE}/${endpoint}?${qs}`, { signal: AbortSignal.timeout(20000) });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = await res.json();
        const st = json.status;
        if (st === '020') throw new DartFatal('하루 요청 한도(020)를 넘었어요. 내일 같은 명령을 다시 실행하면 받은 곳부터 이어서 받아요.');
        if (['010', '011', '012', '901'].includes(st)) throw new DartFatal(`인증키 문제(${st}): ${json.message}`);
        if (st === '800' || st === '900') throw new Error(`DART 일시 오류(${st}): ${json.message}`);
        if (st === '000') stats.ok++;
        else if (st === '013') stats.empty++;
        else stats.other++;
        if (file && (st === '000' || st === '013')) {
          fs.mkdirSync(dir, { recursive: true });
          fs.writeFileSync(file, JSON.stringify(json), 'utf8');
        }
        return json;
      } catch (e) {
        if (e instanceof DartFatal) throw e;
        lastErr = e;
        await sleep(2000 * 2 ** attempt);
      }
    }
    throw lastErr;
  }

  return { call, stats };
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
  console.log(
    `[${name}] 새 호출 ${stats.calls}건 · 캐시 ${stats.cached}건 · 정상 ${stats.ok} · 데이터 없음 ${stats.empty} · 기타 ${stats.other}`,
  );
}
