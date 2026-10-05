import { SERVICES, SIG, signalAvailable } from './config';
import type { CompanySummary, DetailHit, ExtraKey, Filters, Hit, ServiceId } from './types';

export interface Scored extends CompanySummary {
  hits: Hit[];
  score: number;
  services: ServiceId[];
  priority: '높음' | '보통' | '낮음' | '';
  risk: number;
  latest: string;
}

export function priorityOf(score: number): Scored['priority'] {
  if (score >= 3) return '높음';
  if (score === 2) return '보통';
  if (score === 1) return '낮음';
  return '';
}

/** 서로 다른 근거 키 개수 = 점수 (같은 공시로 걸린 PA3·IC3, 같은 자산 규모로 걸린 IC1·IF3은 1개로 센다) */
export function scoreOf(hits: Hit[]): number {
  return new Set(hits.map((h) => h[3])).size;
}

// 목록 '주요 근거' 열의 대표 근거 고르는 순서. 사건 신호(근거일 최신 우선, 같은 날이면 이 순서) → PA2 → 구조 신호
const EVENT_SIGNALS = ['RS1', 'RS2', 'RS3', 'IC2', 'PA1', 'PA3', 'IC3'];
const STRUCT_SIGNALS = ['PA2', 'IC1', 'IF1', 'IF2', 'IF3'];

/** 대표 근거 한 건. hits는 현재 조건 안의 근거(Scored.hits) */
export function leadHit(hits: Hit[]): Hit | undefined {
  const events = hits.filter((h) => EVENT_SIGNALS.includes(h[0]));
  if (events.length) {
    return [...events].sort((a, b) => b[2].localeCompare(a[2]) || EVENT_SIGNALS.indexOf(a[0]) - EVENT_SIGNALS.indexOf(b[0]))[0];
  }
  for (const id of STRUCT_SIGNALS) {
    const h = hits.find((x) => x[0] === id);
    if (h) return h;
  }
  return hits[0];
}

export function activeSignals(f: Filters, extra?: Record<ExtraKey, boolean>): Set<string> {
  return new Set(
    f.signals.filter((id) => SIG[id] && f.services.includes(SIG[id].service) && signalAvailable(id, extra)),
  );
}

export interface DetailScore {
  active: Set<string>; // 현재 조건에서 켜진 신호 ID
  hits: DetailHit[]; // 그중 이 회사에 해당하는 근거
  score: number;
  total: number; // 조건과 상관없이 해당하는 근거 키 개수
  priority: Scored['priority'];
  services: ServiceId[];
}

/** 상세 화면 점수. 목록(applyFilters)과 같은 조건·같은 근거 키 기준으로 센다 */
export function scoreDetailHits(hits: DetailHit[], f: Filters, extra?: Record<ExtraKey, boolean>): DetailScore {
  const active = activeSignals(f, extra);
  const inScope = hits.filter((h) => active.has(h.id));
  const score = new Set(inScope.map((h) => h.k)).size;
  const services = SERVICES.map((s) => s.id).filter((sid) => inScope.some((h) => SIG[h.id].service === sid));
  return { active, hits: inScope, score, total: new Set(hits.map((h) => h.k)).size, priority: priorityOf(score), services };
}

export function applyFilters(
  companies: CompanySummary[],
  f: Filters,
  extra?: Record<ExtraKey, boolean>,
  opts: { ignoreSamil?: boolean } = {},
): Scored[] {
  const active = activeSignals(f, extra);
  const q = f.query.trim().toLowerCase();
  const out: Scored[] = [];
  for (const c of companies) {
    if (f.market !== 'all' && c.m !== f.market) continue;
    if (f.size !== 'all' && c.sz !== f.size) continue;
    if (f.industry !== 'all' && c.ig !== f.industry) continue;
    // 이력으로 추정한 삼일(ae 있음)도 ag가 SAMIL이라 같이 숨긴다. 감사인 미확인(UNKNOWN)은 숨기지 않고 태그로 알린다
    if (!opts.ignoreSamil && f.hideSamil && c.ag === 'SAMIL') continue;
    if (q && !(c.n.toLowerCase().includes(q) || c.s.toLowerCase().includes(q))) continue;
    const hits = c.h.filter((h) => active.has(h[0]));
    const score = scoreOf(hits);
    if (!q && score === 0) continue;
    const services = SERVICES.map((s) => s.id).filter((sid) => hits.some((h) => SIG[h[0]].service === sid));
    const risk = hits.filter((h) => SIG[h[0]].service === 'RS').length;
    const latest = hits.reduce((m, h) => (h[2] > m ? h[2] : m), '');
    out.push({ ...c, hits, score, services, priority: priorityOf(score), risk, latest });
  }
  const byName = (a: Scored, b: Scored) => a.n.localeCompare(b.n, 'ko');
  if (f.sort === 'name') out.sort(byName);
  else if (f.sort === 'risk') out.sort((a, b) => b.risk - a.risk || b.score - a.score || byName(a, b));
  else if (f.sort === 'assets') out.sort((a, b) => (b.a ?? -1) - (a.a ?? -1) || byName(a, b));
  else out.sort((a, b) => b.score - a.score || b.latest.localeCompare(a.latest) || byName(a, b));
  return out;
}
