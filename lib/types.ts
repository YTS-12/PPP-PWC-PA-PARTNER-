export type ServiceId = 'PA' | 'IC' | 'IFRS18' | 'RS';
/**
 * 추가 수집 종류. corrections: 정정공시 최초일·철회·사유 해소(collect:corrections) ·
 * auditorSupp: 감사인 보완(감사용역 체결현황, collect:auditor-supp) ·
 * auditorWeb: 감사인 화면 보완(DART 공시 화면 '외부감사에 관한 사항' 표, collect:auditor-web, 2026-10-06 결정 A).
 * 예전 summary.json 의 meta.extra 에는 auditorWeb 이 없을 수 있다(없으면 미수집으로 본다)
 */
export type ExtraKey = 'fin' | 'auditor2026' | 'major' | 'krx' | 'deadline' | 'corrections' | 'auditorSupp' | 'auditorWeb';
/**
 * 감사인 그룹. 확정 감사인(2026 반기 → 2026 감사용역 체결현황 → 2026 DART 공시 화면 → 2025 사업보고서 →
 * 2025 감사용역 체결현황 → 2025 DART 공시 화면)으로만 정한다.
 * UNKNOWN = 확정 감사인을 못 찾음(이력 추정 ae가 있어도 UNKNOWN. 삼일 숨김에 쓰지 않고 독립성 직접 확인)
 */
export type AuditorGroup = 'SAMIL' | 'BIG4' | 'OTHER' | 'UNKNOWN';
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
  au: string; // 현재 감사인(표시용 이름: 줄바꿈·각주·'대표이사 …' 정리). 이력 추정(ae)이면 추정 감사인 이름(aeAu와 같음)
  ag: AuditorGroup;
  /** 확정 감사인을 못 찾아 이력의 가장 최근 감사인을 보였을 때 그 연도(사업보고서 기준). 표시용이며 ag·삼일 숨김에 쓰지 않는다 */
  ae?: number;
  /** 이력 추정 감사인 표시용 이름(ae가 있을 때만) */
  aeAu?: string;
  /** 이력 추정 감사인이 삼일인지(ae가 있을 때만). true면 주황 경고 texts.estSamilWarn만 띄우고 숨기지 않는다 */
  aeSamil?: boolean;
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
  cat: 'MNA' | 'DISTRESS' | 'FRAUD' | 'MARKET';
  t: string;
  /** 접수일(정정공시면 마지막 정정 접수일) */
  d: string;
  r: string;
  /** 최초 공시일(정정공시이고 정정 정보로 확인했을 때만, d와 다를 때만). 정렬·3개월 집계는 first ?? d */
  first?: string;
  /** 첨부정정이라 결정 본문이 있는 원공시 접수번호(원문 링크는 link ?? r) */
  link?: string;
  samil: boolean;
  /** 횡령·배임 관련 공시(풍문 조회공시 등, 사실 확인 전) */
  rel?: boolean;
  /** 정정공시([기재정정]·[첨부정정] 등). 접수일이 원결정일과 다를 수 있다 */
  corr?: boolean;
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
  /** 최근 3개월 신호 공시 수(전체, 최초 공시일 기준) */
  recent3m: number;
  /** 최근 3개월 신호 공시 수(삼일 감사 고객 ag === 'SAMIL' 회사 공시 제외) */
  recent3mNoSamil: number;
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

/**
 * 신호에서 뺀 공시의 이유(화면 태그는 texts 키, lib/config NOSIG_TEXT).
 * withdrawn: 정정 내용이 철회·취하·부결 등(texts.withdrawnTag) ·
 * resolved: 거래소 시장조치·내부결산 공시의 정정 내용에 사유 해소(corrections withdraw_kw '사유 해소', 2026-10-06 결정 B, texts.resolvedTag) ·
 * old: 최초 공시일이 최근 12개월 전(정정 접수일만 12개월 안, texts.oldTag) ·
 * selfHalt: 매매거래정지(중요한 영업정지). 영업정지 공시에 따라 그날 자동으로 걸리는 정지라 RS1 근거·영업정지 예외에 안 씀(결정 C, texts.selfHaltTag) ·
 * cap: 자본잠식 50% 미만 감자결정(texts.rs1CapReductionTag) · capUnknown: 자본잠식을 판정할 수 없는 감자결정(texts.rs1CapUnknownTag) ·
 * susp: 재무위험 신호(RS2·RS3)·신호로 인정된 거래소 시장조치 없는 영업정지(texts.rs1SuspTag).
 * 한 공시에 여러 이유가 맞으면 withdrawn·resolved > old > selfHalt > cap·capUnknown·susp 순으로 하나만
 */
export type NoSignalReason = 'withdrawn' | 'resolved' | 'old' | 'selfHalt' | 'cap' | 'capUnknown' | 'susp';

/** 횡령·배임 공시 유형: 혐의발생 · 진행사항 · 사실확인 · 관련 공시(풍문 조회공시 등). 머리말 문구는 texts.ic2Type* */
export type Ic2Type = 'occur' | 'progress' | 'fact' | 'rel';

/**
 * 거래소 시장조치 종류(filings_krx 의 mkt). 상장적격성 실질심사 대상·사유 발생/추가 · 상장폐지 사유 발생/추가 ·
 * 관리종목 지정·지정사유 추가 · 반기 검토(감사)의견 부적정 등 사실확인 ·
 * 내부결산 기준 사유 발생(감사 전, '내부결산시점관리종목지정ㆍ형식적상장폐지ㆍ상장적격성실질심사사유발생' 류, 2026-10-06 결정 E) ·
 * 매매거래정지(중요한 영업정지, 신호에는 안 씀 nosig 'selfHalt').
 * 화면 이름은 texts.mktReview·mktDelist·mktAdmin·mktHalfOpinion·mktInternal·mktSuspension.
 * 결정 E 이전 데이터는 내부결산 시점 공시도 '관리종목'이라 화면은 제목으로 다시 본다(lib/config marketKindOf)
 */
export type MarketKind = '실질심사' | '상장폐지사유' | '관리종목' | '반기부적정' | '내부결산' | '중요한영업정지';

/** 공시 분류. MARKET = 거래소 시장조치(RS1 근거). 화면 이름은 texts.catLabel<분류> */
export type FilingCat = 'MNA' | 'DISTRESS' | 'FRAUD' | 'MARKET' | 'DEADLINE';

/** 상세 근거 공시 한 건. t는 원래 제목(머리말 포함). 목록은 first ?? d 최신 순 */
export interface FilingItem {
  cat: FilingCat;
  t: string;
  /** 접수일(정정공시면 마지막 정정 접수일) */
  d: string;
  r: string;
  /** 최초 공시일 YYYY-MM-DD(정정공시이고 정정 정보로 확인했을 때만, d와 다를 때만). 최근 12개월 판정은 first ?? d */
  first?: string;
  /** 첨부정정([첨부정정]·[첨부추가])이라 결정 본문이 있는 원공시 접수번호. 원문 링크는 link ?? r */
  link?: string;
  /** 횡령·배임 관련 공시(사실 확인 전). ic2t === 'rel'과 같다 */
  rel?: boolean;
  /** 정정공시([기재정정]·[첨부정정] 등, 정정 정보에 있는 [첨부추가] 포함) */
  corr?: boolean;
  /** 신호에서 뺀 공시와 그 이유 */
  nosig?: NoSignalReason;
  /** 횡령·배임(FRAUD) 공시 유형 */
  ic2t?: Ic2Type;
  /** 자회사 공시(제목에 '(자회사의 주요경영사항)'). texts.ic2SubTag */
  sub?: true;
  /** 거래소 시장조치(MARKET) 종류 */
  mkt?: MarketKind;
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
  /**
   * 감사인 출처(texts.auSrc*): '2026 반기보고서' | '2026 반기보고서(감사용역 체결현황)' | '2026 반기보고서(DART 공시 화면)' |
   * '2025 사업보고서' | '2025 사업보고서(감사용역 체결현황)' | '2025 사업보고서(DART 공시 화면)' |
   * '<연도> 사업보고서 이력(추정)' | '확인 못 함'
   */
  auSrc: string;
  ag: AuditorGroup;
  /** 이력 추정 감사인의 연도·이름·삼일 여부(CompanySummary.ae·aeAu·aeSamil과 같음, 표시용) */
  ae?: number;
  aeAu?: string;
  aeSamil?: boolean;
  opinion: string;
  kam: string;
  primary: string;
  contact: { phone: string; fax: string; homepage: string; ir: string; address: string };
  fin: { basis: 'CFS' | 'OFS' | null; currency: string | null; assets: number | null; revenue: number | null; op: number | null; rcept: string };
  finx: { CFS: FinRec | null; OFS: FinRec | null } | null;
  hist: [number, string, string][];
  filings: FilingItem[];
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
