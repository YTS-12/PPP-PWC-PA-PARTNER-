import { SERVICES, SIG, signalAvailable } from './config';
import type { CompanySummary, ExtraKey, Filters, Hit, ServiceId } from './types';

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

/** 서로 다른 근거 키 개수 = 점수 (같은 공시로 걸린 PA3·IC3은 1개로 센다) */
export function scoreOf(hits: Hit[]): number {
  return new Set(hits.map((h) => h[3])).size;
}

export function activeSignals(f: Filters, extra?: Record<ExtraKey, boolean>): Set<string> {
  return new Set(
    f.signals.filter((id) => SIG[id] && f.services.includes(SIG[id].service) && signalAvailable(id, extra)),
  );
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
