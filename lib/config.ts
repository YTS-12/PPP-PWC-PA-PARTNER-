import raw from '@/config/signals.json';
import { won } from './format';
import type { ExtraKey, Filters, ServiceId } from './types';

export interface SignalDef {
  id: string;
  service: ServiceId;
  label: string;
  source: string;
  needs: ExtraKey | null;
  caution: string;
}
export interface ServiceDef {
  id: ServiceId;
  name: string;
  short: string;
}

export const CONFIG = raw as unknown as {
  params: Record<string, number | string>;
  services: ServiceDef[];
  signals: SignalDef[];
  extras: Record<ExtraKey, { label: string; command: string }>;
  strategy: Record<ServiceId | 'SAMIL', string>;
  texts: Record<string, string>;
  disclaimer: string;
};

export const SERVICES = CONFIG.services;
export const SIGNALS = CONFIG.signals;
export const SIG: Record<string, SignalDef> = Object.fromEntries(SIGNALS.map((s) => [s.id, s]));
export const SVC: Record<ServiceId, ServiceDef> = Object.fromEntries(SERVICES.map((s) => [s.id, s])) as Record<
  ServiceId,
  ServiceDef
>;
export const STATUSES = ['검토 전', '검토 중', '제안 대상', '제외'] as const;

/** 규모 기준 금액 표기. 천억 단위로 떨어지면 '5천억'처럼 줄이고, 그 밖은 won() 표기를 따른다 */
function sizeAmount(n: number): string {
  if (n > 0 && n < 1e12 && n % 1e11 === 0) return `${n / 1e11}천억`;
  return won(n);
}

const SIZE_LARGE = sizeAmount(Number(CONFIG.params.sizeLarge));
const SIZE_MID = sizeAmount(Number(CONFIG.params.sizeMid));

export const SIZE_LABEL: Record<string, string> = {
  all: '전체',
  L: `${SIZE_LARGE} 원 이상`,
  M: `${SIZE_MID} ~ ${SIZE_LARGE} 원`,
  S: `${SIZE_MID} 원 미만`,
};

export const INDUSTRY_GROUPS = [
  '반도체·전자',
  'IT·소프트웨어',
  '바이오·헬스케어',
  '자동차·운송장비',
  '기계·장비',
  '에너지·화학',
  '소재',
  '유통·소비재',
  '건설·부동산',
  '금융·지주',
  '미디어·엔터',
  '운송·물류',
  '서비스·기타',
];

export function signalAvailable(id: string, extra: Record<ExtraKey, boolean> | undefined): boolean {
  const s = SIG[id];
  if (!s) return false;
  if (!s.needs) return true;
  return Boolean(extra && extra[s.needs]);
}

export function defaultFilters(): Filters {
  return {
    services: SERVICES.map((s) => s.id),
    signals: SIGNALS.map((s) => s.id),
    market: 'all',
    size: 'all',
    industry: 'all',
    hideSamil: true,
    query: '',
    sort: 'score',
  };
}

/** 저장된 조건에 빠진 항목이 있으면 기본값으로 채운다 */
export function normalizeFilters(f: Partial<Filters> | null | undefined): Filters {
  const d = defaultFilters();
  if (!f) return d;
  return {
    ...d,
    ...f,
    services: Array.isArray(f.services) && f.services.length ? (f.services as ServiceId[]) : d.services,
    signals: Array.isArray(f.signals) && f.signals.length ? f.signals : d.signals,
    query: '',
  };
}
