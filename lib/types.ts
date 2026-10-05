export type ServiceId = 'PA' | 'IC' | 'IFRS18' | 'RS';
export type ExtraKey = 'fin' | 'auditor2026' | 'major' | 'krx' | 'deadline';
export type AuditorGroup = '' | 'SAMIL' | 'BIG4' | 'OTHER';
export type SizeBand = 'L' | 'M' | 'S' | 'U';
export type Status = '검토 전' | '검토 중' | '제안 대상' | '제외';

/** [신호ID, 근거 문구, 근거일(YYYY-MM-DD 또는 ''), 중복 집계 방지 키, 접수번호] */
export type Hit = [string, string, string, string, string];

export interface CompanySummary {
  c: string; // DART 고유번호
  n: string; // 기업명
  s: string; // 종목코드
  m: 'KOSPI' | 'KOSDAQ';
  ig: string; // 업종 그룹
  au: string; // 현재 감사인
  ag: AuditorGroup;
  a: number | null; // 자산총계(원)
  rv?: number | null; // 매출액(원, 원화 재무만)
  op?: number | null; // 영업이익(원, 원화 재무만)
  sz: SizeBand;
  ceo: string;
  ph: string;
  fx: string;
  hp: string;
  ad: string;
  h: Hit[];
}

export interface RecentItem {
  c: string;
  n: string;
  cat: 'MNA' | 'DISTRESS' | 'FRAUD';
  t: string;
  d: string;
  r: string;
  samil: boolean;
  /** 횡령·배임 관련 공시(풍문 조회공시 등, 사실 확인 전) */
  rel?: boolean;
}

/** data/extra/<이름>.meta.json 한 개(수집 기록). 명령마다 필드가 달라 공통으로 쓰는 것만 적고, 화면에서는 값을 확인한 뒤 쓴다 */
export interface ExtraMetaRecord {
  collectedAt?: string;
  records?: number;
  hash?: string;
  [field: string]: unknown;
}

export interface SummaryMeta {
  dataAsOf: string;
  baseCollectedAt: string;
  builtAt: string;
  fiscalYear: number;
  universe: number;
  included: number;
  excluded: { spac: number; reitFund: number };
  extra: Record<ExtraKey, boolean>;
  extraMeta: Record<string, ExtraMetaRecord>;
  signalCounts: Record<string, number>;
  recent: RecentItem[];
  recent3m: number;
  recentFrom: string;
}

export interface Summary {
  meta: SummaryMeta;
  companies: CompanySummary[];
}

export interface FinRec {
  corp_code: string;
  bsns_year: number;
  fs_div: 'CFS' | 'OFS';
  rcept_no: string;
  currency?: string;
  assets?: number | null;
  liabilities?: number | null;
  capital?: number | null;
  equity?: number | null;
  revenue?: number | null;
  op?: number | null;
  op_prev?: number | null;
  op_prev2?: number | null;
  pretax?: number | null;
  net?: number | null;
}

export interface DetailHit {
  id: string;
  ev: string;
  d: string;
  k: string;
  r: string;
  value: number | null;
}

export interface CompanyDetail {
  c: string;
  n: string;
  s: string;
  m: 'KOSPI' | 'KOSDAQ';
  dartName: string;
  ceo: string;
  listed: string;
  ig: string;
  ic: string;
  accMt: string;
  au: string;
  auSrc: string;
  ag: AuditorGroup;
  opinion: string;
  kam: string;
  primary: string;
  contact: { phone: string; fax: string; homepage: string; ir: string; address: string };
  fin: { basis: 'CFS' | 'OFS' | null; currency: string | null; assets: number | null; revenue: number | null; op: number | null; rcept: string };
  finx: { CFS: FinRec | null; OFS: FinRec | null } | null;
  hist: [number, string, string][];
  /** rel: 횡령·배임 관련 공시(사실 확인 전) · nosig: 신호에서 뺀 공시(자본잠식 50% 미만 감자결정) */
  filings: { cat: 'MNA' | 'DISTRESS' | 'FRAUD' | 'DEADLINE'; t: string; d: string; r: string; rel?: boolean; nosig?: boolean }[];
  h: DetailHit[];
  notes: string[];
}

export interface Filters {
  services: ServiceId[];
  signals: string[];
  market: 'all' | 'KOSPI' | 'KOSDAQ';
  size: 'all' | 'L' | 'M' | 'S';
  industry: string;
  hideSamil: boolean;
  query: string;
  sort: 'score' | 'name' | 'risk' | 'assets';
}

export interface Profile {
  display_name: string;
  team: string;
  memo_sign: string;
}

export interface ShortItem {
  status: Status;
  saved_at: string;
}
