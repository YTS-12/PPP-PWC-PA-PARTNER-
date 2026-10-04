// 수집·빌드 스크립트 공통 모듈: 환경변수, 경로, jsonl, 기간 계산, 대상 기업 목록
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
export const EXTRA_DIR = path.join(ROOT, 'data', 'extra');
export const RAW_DIR = path.join(ROOT, 'data', 'raw');
export const UNIVERSE_FILE = path.join(ROOT, 'data', 'universe.json');
export const CONFIG = JSON.parse(fs.readFileSync(path.join(ROOT, 'config', 'signals.json'), 'utf8'));

const BASE_FILE = process.env.BASE_JSON || '08_상장기업전체_웹앱용_기업데이터.json';

export function requireDataDir() {
  const dir = (process.env.DATA_DIR || '').trim();
  if (!dir) {
    throw new Error('DATA_DIR이 비어 있어요. .env 파일에 기존 수집본 폴더 경로를 넣어 주세요.');
  }
  const file = path.join(dir, BASE_FILE);
  if (!fs.existsSync(file)) {
    throw new Error(`기존 수집본 파일을 찾지 못했어요: ${file}`);
  }
  return { dir, file };
}

let baseCache = null;
export function loadBase() {
  if (baseCache) return baseCache;
  const { file } = requireDataDir();
  baseCache = JSON.parse(fs.readFileSync(file, 'utf8'));
  return baseCache;
}

/** 추천 대상에서 빼는 이유: 리츠·인프라펀드(instrument_type RT·IF·MF), 스팩(이름에 '스팩'). 해당 없으면 null */
export function excludeReason(c) {
  if (['RT', 'IF', 'MF'].includes(c.instrument_type)) return 'reitFund';
  if ((c.name || '').includes('스팩')) return 'spac';
  return null;
}

/**
 * 추가 수집 대상 기업 목록 (스팩·리츠·펀드 제외).
 * 저장소의 data/universe.json을 먼저 쓴다(npm run data:build가 만듦). 그래서 수집 담당은 기존 수집본 폴더 없이
 * 저장소와 본인 키만으로 수집할 수 있고, 모두 같은 목록을 써서 --part 분할이 어긋나지 않는다.
 */
export function loadUniverse() {
  if (fs.existsSync(UNIVERSE_FILE)) {
    return JSON.parse(fs.readFileSync(UNIVERSE_FILE, 'utf8')).companies;
  }
  if (!(process.env.DATA_DIR || '').trim()) {
    throw new Error('대상 기업 목록(data/universe.json)이 없어요. 저장소를 최신으로 받거나, .env의 DATA_DIR에 기존 수집본 폴더를 넣어 주세요.');
  }
  return universeFromBase(loadBase());
}

export function universeFromBase(base) {
  return base.companies
    .filter((c) => !excludeReason(c))
    .map((c) => ({ corp_code: c.corp_code, stock_code: c.stock_code, name: c.name, market: c.market }));
}

export function arg(name, fallback = null) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  const pre = process.argv.find((a) => a.startsWith(name + '='));
  if (pre) return pre.slice(name.length + 1);
  return fallback;
}
export const hasFlag = (name) => process.argv.includes(name);

export function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map((r) => JSON.stringify(r)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

export function readJsonl(file) {
  if (!fs.existsSync(file)) return [];
  return fs
    .readFileSync(file, 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l));
}

/** data/extra 안에서 prefix로 시작하는 jsonl을 모두 읽는다. 파일이 하나라도 있으면 collected=true */
export function readExtra(prefix) {
  if (!fs.existsSync(EXTRA_DIR)) return { collected: false, rows: [] };
  const files = fs.readdirSync(EXTRA_DIR).filter((f) => f.startsWith(prefix) && f.endsWith('.jsonl'));
  const rows = files.flatMap((f) => readJsonl(path.join(EXTRA_DIR, f)));
  return { collected: files.length > 0, rows, files };
}

// 수집 기록: 명령(파트)마다 data/extra/<이름>.meta.json 한 개. 여러 사람이 따로 커밋해도 충돌하지 않는다.
const META_SUFFIX = '.meta.json';
export function readExtraMeta() {
  if (!fs.existsSync(EXTRA_DIR)) return {};
  const meta = {};
  for (const f of fs.readdirSync(EXTRA_DIR)) {
    if (!f.endsWith(META_SUFFIX)) continue;
    try {
      meta[f.slice(0, -META_SUFFIX.length)] = JSON.parse(fs.readFileSync(path.join(EXTRA_DIR, f), 'utf8'));
    } catch {
      // 깨진 기록 파일은 건너뛴다 (수집 결과 jsonl에는 영향 없음)
    }
  }
  return meta;
}
export function writeExtraMeta(name, info) {
  fs.mkdirSync(EXTRA_DIR, { recursive: true });
  fs.writeFileSync(
    path.join(EXTRA_DIR, `${name}${META_SUFFIX}`),
    JSON.stringify({ ...info, collectedAt: new Date().toISOString() }, null, 2),
    'utf8',
  );
}

// ---------- 날짜 ----------
export const ymd = (d) => d.toISOString().slice(0, 10).replace(/-/g, '');
export const isoDate = (s) => (s && s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : s || '');
export function parseYmd(s) {
  return new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8)));
}

/** end(YYYYMMDD)까지 days일을 maxSpan일 이하 구간으로 나눈다. 공시검색은 corp_code 없이 3개월까지만 조회된다. */
export function windows(endYmd, days = 365, maxSpan = 89) {
  const end = parseYmd(endYmd);
  const start = new Date(end.getTime() - (days - 1) * 864e5);
  const out = [];
  let cur = start;
  while (cur <= end) {
    const segEnd = new Date(Math.min(cur.getTime() + (maxSpan - 1) * 864e5, end.getTime()));
    out.push([ymd(cur), ymd(segEnd)]);
    cur = new Date(segEnd.getTime() + 864e5);
  }
  return out;
}

export function today() {
  // 한국 시간 기준 오늘
  const now = new Date(Date.now() + 9 * 3600e3);
  return ymd(now);
}

/** 공시 제목 정리: 공백과 맨 앞 대괄호 머리말([기재정정] 등) 제거 */
export function baseTitle(reportNm) {
  let t = (reportNm || '').replace(/\s+/g, '');
  while (/^\[[^\]]*\]/.test(t)) t = t.replace(/^\[[^\]]*\]/, '');
  return t;
}

export function log(...a) {
  console.log(...a);
}
