import raw from '@/config/signals.json';
import { won } from './format';
import type { AuditorGroup, CompanySummary, ExtraKey, FilingCat, Filters, Ic2Type, MarketKind, NoSignalReason, ServiceId } from './types';

export interface SignalDef {
  id: string;
  service: ServiceId;
  label: string;
  source: string;
  /** 이 추가 수집이 반영돼야 판정하는 신호(null이면 기존 수집본만으로 판정) */
  needs: ExtraKey | null;
  /** 늘 보이는 주의 문구(추가 수집 뒤에도 맞는 문장만). 없으면 '' */
  caution: string;
  /** pendingKey 추가 수집 전(meta.extra[pendingKey]가 false)일 때만 caution 뒤에 붙이는 문구 */
  cautionPending?: string;
  pendingKey?: ExtraKey | null;
}
export interface ServiceDef {
  id: ServiceId;
  name: string;
  short: string;
}

/**
 * 화면 문구 키(config/signals.json texts). signals.json에 있는 키만 쓸 수 있다 —
 * 없는 키를 쓰면 tsc가 막아서 화면에 빈 문구나 'undefined'가 나가지 않는다.
 * 문구 자체는 signals.json에서만 고친다(CLAUDE.md).
 */
export type TextKey = keyof typeof raw.texts;

export const CONFIG = raw as unknown as {
  version: number;
  params: Record<string, number | string>;
  services: ServiceDef[];
  signals: SignalDef[];
  extras: Partial<Record<ExtraKey, { label: string; command: string }>>;
  strategy: Record<ServiceId | 'SAMIL', string>;
  texts: Record<TextKey, string>;
  disclaimer: string;
};

/** 화면 문구 */
export const TEXTS = CONFIG.texts;

/** 문구의 '{이름}' 자리를 채운다(build-data.mjs fill과 같은 규칙: 값이 없는 자리는 그대로 둔다) */
export function fillText(template: string, vars: Record<string, string | number | null | undefined> = {}): string {
  return String(template || '').replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] != null ? String(vars[k]) : m));
}

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

/**
 * 신호 주의 문구. caution은 늘 보이고, cautionPending은 pendingKey 추가 수집 전일 때만 뒤에 붙인다.
 * summary를 못 받아 extra가 없으면 signalAvailable처럼 추가 수집 전으로 본다
 */
export function cautionOf(id: string, extra: Record<ExtraKey, boolean> | undefined): string {
  const s = SIG[id];
  if (!s) return '';
  const pending = s.cautionPending && s.pendingKey && !(extra && extra[s.pendingKey]) ? s.cautionPending : '';
  return [s.caution, pending].filter(Boolean).join(' ');
}

// ---------- 근거 공시(상세 filings·대시보드 recent) 표시 ----------

const CAT_TEXT: Record<FilingCat, TextKey> = {
  MNA: 'catLabelMNA',
  DISTRESS: 'catLabelDISTRESS',
  FRAUD: 'catLabelFRAUD',
  MARKET: 'catLabelMARKET',
  DEADLINE: 'catLabelDEADLINE',
};
/** 공시 분류 이름(texts.catLabel<분류>). 모르는 분류는 그대로 */
export function catLabel(cat: FilingCat | string): string {
  const k = CAT_TEXT[cat as FilingCat];
  return k ? TEXTS[k] : String(cat || '');
}

const MKT_TEXT: Record<MarketKind, TextKey> = {
  실질심사: 'mktReview',
  상장폐지사유: 'mktDelist',
  관리종목: 'mktAdmin',
  반기부적정: 'mktHalfOpinion',
  내부결산: 'mktInternal',
  중요한영업정지: 'mktSuspension',
};
/**
 * 화면에 보일 거래소 시장조치 종류. 내부결산 시점 공시(제목에 '내부결산')는 결정 E 이전 데이터에서 mkt '관리종목' 등으로
 * 들어 있어 제목으로 '내부결산'으로 고친다(build-data.mjs marketKindOf와 같은 규칙. 중요한영업정지는 그대로). 모르는 종류면 그대로
 */
export function marketKindOf(mkt: MarketKind | string | undefined, title?: string): string {
  if (!mkt) return '';
  if (mkt !== '중요한영업정지' && MKT_TEXT[mkt as MarketKind] && /내부결산/.test(String(title || '').replace(/\s+/g, ''))) return '내부결산';
  return mkt;
}
/** 거래소 시장조치 종류 이름(texts.mkt*). title(공시 제목)을 주면 옛 데이터의 내부결산 시점 공시도 '내부결산 기준 사유 발생(감사 전)'. 없거나 모르는 종류면 '' */
export function marketKindLabel(mkt: MarketKind | string | undefined, title?: string): string {
  const kind = marketKindOf(mkt, title);
  const k = kind ? MKT_TEXT[kind as MarketKind] : undefined;
  return k ? TEXTS[k] : '';
}

const IC2_TEXT: Record<Ic2Type, TextKey> = { occur: 'ic2TypeOccur', progress: 'ic2TypeProgress', fact: 'ic2TypeFact', rel: 'ic2TypeRel' };
/** 횡령·배임 공시 유형 태그(texts.ic2Type*). ic2t가 없는 예전 데이터는 rel(관련 공시)만 알 수 있다 */
export function ic2TypeTag(f: { ic2t?: Ic2Type; rel?: boolean }): { text: string; cls: string } | null {
  const t: Ic2Type | undefined = f.ic2t || (f.rel ? 'rel' : undefined);
  const k = t ? IC2_TEXT[t] : undefined;
  if (!k) return null;
  // 혐의발생은 기본색, 진행사항·사실확인(결과 확인 필요)·관련 공시(사실 확인 전)는 주황
  return { text: TEXTS[k], cls: t === 'occur' ? '' : 'amber' };
}

// 신호 제외 이유별 태그(texts 키). 예전 키 이름(rs1CapReductionTag 등)은 그대로 쓴다
const NOSIG_TEXT: Record<NoSignalReason, TextKey> = {
  withdrawn: 'withdrawnTag',
  resolved: 'resolvedTag',
  old: 'oldTag',
  selfHalt: 'selfHaltTag',
  cap: 'rs1CapReductionTag',
  capUnknown: 'rs1CapUnknownTag',
  susp: 'rs1SuspTag',
};
/** 신호에서 뺀 공시의 태그 문구. 예전 데이터의 nosig:true는 'cap'(자본잠식 50% 미만 감자)으로 읽는다. 모르는 이유면 '' */
export function nosigTag(nosig: NoSignalReason | boolean | undefined): string {
  if (!nosig) return '';
  const reason: NoSignalReason = nosig === true ? 'cap' : nosig;
  const k = NOSIG_TEXT[reason];
  return k ? TEXTS[k] : '';
}

/** 근거 공시 날짜. 정정공시이고 최초 공시일을 알면 '최초 YYYY-MM-DD · 정정 YYYY-MM-DD'(texts.corrDates), 아니면 접수일 */
export function filingDateText(f: { d: string; first?: string }): string {
  return f.first && f.first !== f.d ? fillText(TEXTS.corrDates, { first: f.first, d: f.d }) : f.d;
}

// ---------- 독립성(감사인) 표시 ----------

/** 감사인 표시에 쓰는 summary·detail 공통 필드 */
export type AuditorFields = Partial<Pick<CompanySummary, 'au' | 'ae' | 'aeAu' | 'aeSamil'>> & { ag?: AuditorGroup | '' };

export interface AuditorView {
  /** 확정 감사인 그룹. 이력 추정(ae)은 그룹을 정하지 않으므로 UNKNOWN */
  group: AuditorGroup;
  /** 확정 감사인을 못 찾아 이력의 가장 최근 감사인을 보이는 중 */
  est: boolean;
  estYear: number | null;
  estAu: string;
  /** 이력 추정 감사인이 삼일 → 주황 경고만(숨기지 않음) */
  estSamil: boolean;
}

/**
 * 감사인 표시 기준. 확정 감사인(ag)만 삼일 숨김·빨간 경고에 쓰고, 이력 추정(ae)은 표시만 한다
 * (Q1: 아시아나항공은 이력상 삼일이지만 실제 삼정).
 * 예전 데이터(수정 2차)는 이력 추정이어도 ag를 SAMIL 등으로 채웠으므로, ae가 있으면 ag와 상관없이 추정으로 읽는다.
 * ag가 빈 더 예전 데이터는 감사인 미확인으로 본다
 */
export function auditorView(x: AuditorFields | null | undefined): AuditorView {
  const ae = x && typeof x.ae === 'number' && x.ae > 0 ? x.ae : null;
  if (x && ae) {
    return {
      group: 'UNKNOWN',
      est: true,
      estYear: ae,
      estAu: x.aeAu || x.au || '',
      estSamil: typeof x.aeSamil === 'boolean' ? x.aeSamil : x.ag === 'SAMIL',
    };
  }
  const ag = x?.ag;
  const group: AuditorGroup = ag === 'SAMIL' || ag === 'BIG4' || ag === 'OTHER' ? ag : 'UNKNOWN';
  return { group, est: false, estYear: null, estAu: '', estSamil: false };
}

/** 확정 감사인이 삼일인 회사(기본 숨김·빨간 경고 대상). 이력 추정 삼일은 넣지 않는다 */
export function isSamilClient(x: AuditorFields | null | undefined): boolean {
  return auditorView(x).group === 'SAMIL';
}

/** 이력 추정 한 줄 설명(texts.estAuditorTitle). 추정이 아니면 '' */
export function estAuditorTitle(v: AuditorView): string {
  return v.est ? fillText(TEXTS.estAuditorTitle, { au: v.estAu || '-', year: v.estYear }) : '';
}

/** 이력 추정 감사인 안내(texts.estAuditorNote). 추정이 아니면 '' */
export function estAuditorNote(v: AuditorView): string {
  return v.est ? fillText(TEXTS.estAuditorNote, { au: v.estAu || '-', year: v.estYear }) : '';
}

/**
 * 이력 추정 감사인이 삼일일 때 덧씌우는 진한 주황(globals.css의 .tag.amber·.banner.indep-warn보다 진하게).
 * tag: 목록·내 후보·상세 태그(긴 문구라 줄바꿈 허용) · banner: 상세 경고 띠
 */
export const STRONG_WARN_STYLE = {
  tag: { background: '#fde68a', color: '#713f12', boxShadow: 'inset 0 0 0 1px #f59e0b', whiteSpace: 'normal' },
  banner: { background: '#fde68a', color: '#713f12', borderColor: '#f59e0b' },
} as const;

/**
 * 목록·내 후보·상세의 독립성 태그.
 * 삼일(확정) 빨강 · 타 법인 회색 · 감사인 미확인 주황 · 이력 추정은 '감사인 미확인 · {이력상 최근 감사인}(추정)' 주황.
 * 추정 감사인이 삼일이면 texts.estSamilWarn을 진한 주황(strong)으로 — 숨기지는 않는다
 */
export function auditorTag(x: AuditorFields | null | undefined): { cls: string; text: string; title: string; strong: boolean } {
  const v = auditorView(x);
  if (v.group === 'SAMIL') return { cls: 'red', text: TEXTS.samilTag, title: '', strong: false };
  if (v.group === 'BIG4' || v.group === 'OTHER') return { cls: 'gray', text: TEXTS.otherAuditorTag, title: '', strong: false };
  if (v.est) {
    const title = estAuditorTitle(v);
    if (v.estSamil) return { cls: 'amber', text: TEXTS.estSamilWarn, title, strong: true };
    return { cls: 'amber', text: `${TEXTS.unknownAuditorShort} · ${v.estAu}${TEXTS.estAuditorSuffix}`, title, strong: false };
  }
  return { cls: 'amber', text: TEXTS.unknownAuditorShort, title: TEXTS.unknownAuditorTag, strong: false };
}

/**
 * CSV '감사인 구분' 값: 삼일 · 타 대형법인 · 기타 법인 · 감사인 미확인.
 * 이력 추정은 목록 태그와 같은 '감사인 미확인 · {감사인}(추정)', 추정 감사인이 삼일이면 '감사인 미확인 · {texts.estSamilWarn}'
 */
export function auditorGroupText(x: AuditorFields | null | undefined): string {
  const v = auditorView(x);
  if (v.group === 'SAMIL') return '삼일';
  if (v.group === 'BIG4') return '타 대형법인';
  if (v.group === 'OTHER') return '기타 법인';
  if (v.est) return `${TEXTS.unknownAuditorShort} · ${v.estSamil ? TEXTS.estSamilWarn : `${v.estAu}${TEXTS.estAuditorSuffix}`}`;
  return TEXTS.unknownAuditorShort;
}

/** CSV '현재 감사인' 값. 이력 추정이면 '{감사인}(추정)'으로 확정 감사인과 구분한다 */
export function auditorNameText(x: AuditorFields | null | undefined): string {
  const v = auditorView(x);
  if (v.est) return `${v.estAu}${TEXTS.estAuditorSuffix}`;
  return x?.au || '';
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
