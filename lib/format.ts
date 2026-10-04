/** 원 단위 금액을 조·억으로 표시 (예: 1조 2,400억) */
export function won(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return '–';
  const sign = n < 0 ? '-' : '';
  const v = Math.abs(n);
  if (v >= 1e12) {
    let jo = Math.floor(v / 1e12);
    let eok = Math.round((v - jo * 1e12) / 1e8);
    if (eok >= 10000) {
      jo += 1;
      eok = 0;
    }
    return `${sign}${jo}조${eok ? ' ' + eok.toLocaleString('ko-KR') + '억' : ''}`;
  }
  if (v >= 1e8) return `${sign}${Math.round(v / 1e8).toLocaleString('ko-KR')}억`;
  if (v >= 1e4) return `${sign}${Math.round(v / 1e4).toLocaleString('ko-KR')}만`;
  return `${sign}${v.toLocaleString('ko-KR')}`;
}

export function withCurrency(n: number | null | undefined, currency: string | null | undefined): string {
  if (n === null || n === undefined) return '–';
  if (!currency || currency === 'KRW') return won(n);
  return `${n.toLocaleString('ko-KR')} ${currency}`;
}

export const pct = (x: number | null | undefined, digits = 0) =>
  x === null || x === undefined || !Number.isFinite(x) ? '–' : `${(x * 100).toFixed(digits)}%`;

export const dartUrl = (rcept: string) => `https://dart.fss.or.kr/dsaf001/main.do?rcpNo=${rcept}`;

export function siteUrl(u: string): string {
  const s = (u || '').trim();
  if (!s) return '';
  return /^https?:\/\//i.test(s) ? s : `https://${s}`;
}

/** 한국 날짜(YYYY-MM-DD). toISOString()은 UTC라 오전 9시 전에는 하루 전 날짜가 된다 */
export function kstDate(d: Date | string = new Date()): string {
  const t = typeof d === 'string' ? Date.parse(d) : d.getTime();
  if (!Number.isFinite(t)) return '';
  return new Date(t + 9 * 3600e3).toISOString().slice(0, 10);
}
