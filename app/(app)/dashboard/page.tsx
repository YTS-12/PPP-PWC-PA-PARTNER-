'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/app-state';
import { useSummary } from '@/lib/data';
import { applyFilters } from '@/lib/scoring';
import { CONFIG, SERVICES, SIGNALS, signalAvailable } from '@/lib/config';
import ModeBanner from '@/components/ModeBanner';
import { kstDate } from '@/lib/format';
import type { ExtraKey, ExtraMetaRecord, SummaryMeta } from '@/lib/types';

const CAT_LABEL = { MNA: '합병·분할·양수', DISTRESS: '부도·회생·감자', FRAUD: '횡령·배임' } as const;

/**
 * 데이터 상태 칩용 수집 기록 요약. meta.extraMeta 는 data/extra/<이름>.meta.json 을 그대로 모은 것이라
 * 키는 fin·major·krx·deadline, 감사인은 파트마다 auditor2026_part1of1 처럼 따로 있다(→ 'auditor2026' 로 시작하는 기록을 모두 모음).
 * 명령마다 필드가 달라 값은 형식을 확인한 뒤 쓴다.
 * 칩에 보이는 개수: 주요계정(fin)은 받은 회사 수(companies) 'N곳', 감사인은 감사인을 확인한 회사 수(found) 합계
 * '감사인 확인 N곳', 주요사항·거래소공시·연장신고는 결과 건수(records) 'N건'. 해당 필드가 없는 예전 기록은 records 'N건'.
 */
function extraRecord(key: ExtraKey, extraMeta: SummaryMeta['extraMeta'] | undefined) {
  const recs = Object.entries(extraMeta || {}).filter(([name]) => (key === 'auditor2026' ? name.startsWith('auditor2026') : name === key));
  if (!recs.length) return null;
  // 기록의 field 값: 유한한 숫자일 때만 쓴다 (형식이 다르면 null)
  const num = (m: ExtraMetaRecord | undefined, field: string): number | null => {
    const v: unknown = m ? m[field] : undefined;
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };
  // field 합계. every=true 면 모든 기록에 값이 있을 때만(일부 파트만 있으면 덜 센 값이 되므로), 아니면 하나라도 있으면
  const sum = (field: string, every = false): number | null => {
    const vals = recs.map(([, m]) => num(m, field));
    const ok = every ? vals.every((n) => n !== null) : vals.some((n) => n !== null);
    return ok ? vals.reduce<number>((s, n) => s + (n ?? 0), 0) : null;
  };
  const records = sum('records');
  const unitCount = key === 'fin' ? sum('companies', true) : key === 'auditor2026' ? sum('found', true) : null;
  // byCompany: 곳 단위(이때 결과 건수는 툴팁으로)
  const count: { n: number; text: string; byCompany: boolean } | null =
    unitCount !== null
      ? {
          n: unitCount,
          text: key === 'auditor2026' ? `감사인 확인 ${unitCount.toLocaleString()}곳` : `${unitCount.toLocaleString()}곳`,
          byCompany: true,
        }
      : records !== null
        ? { n: records, text: `${records.toLocaleString()}건`, byCompany: false }
        : null;
  // 가장 최근 수집 시각(UTC ISO)을 한국 날짜로
  const times = recs
    .map(([, m]) => (typeof m?.collectedAt === 'string' ? Date.parse(m.collectedAt) : NaN))
    .filter((t) => Number.isFinite(t));
  const date = times.length ? kstDate(new Date(Math.max(...times))) : '';
  // 감사인 파트: 이름의 partKofN 에서 가장 큰 N 을 전체 파트 수로, 그 N 으로 받은 서로 다른 K 의 수를 받은 파트 수로 본다
  let parts: { got: number; total: number } | null = null;
  if (key === 'auditor2026') {
    const ps = recs
      .map(([name]) => /_part(\d+)of(\d+)$/.exec(name))
      .filter((x): x is RegExpExecArray => x !== null)
      .map((x) => ({ k: Number(x[1]), n: Number(x[2]) }));
    const total = Math.max(0, ...ps.map((p) => p.n));
    if (total > 1) parts = { got: new Set(ps.filter((p) => p.n === total && p.k >= 1 && p.k <= total).map((p) => p.k)).size, total };
  }
  const target = key === 'fin' ? sum('target', true) : null; // 주요계정 대상 회사 수 (툴팁용)
  return { records, count, target, date, parts };
}

export default function DashboardPage() {
  const app = useApp();
  const { data, error } = useSummary();

  // 추천 목록에서 남긴 검색어는 대시보드 집계에 쓰지 않는다 (검색 중에는 0점 회사도 목록에 남기 때문)
  const scored = useMemo(
    () => (data ? applyFilters(data.companies, { ...app.filters, query: '' }, data.meta.extra) : []),
    [data, app.filters],
  );

  if (error) return <div className="notice">{error}</div>;
  if (!data) return <div className="loading">데이터를 불러오는 중…</div>;

  const meta = data.meta;
  const shortIds = Object.keys(app.personal.shortlist);
  const inProgress = shortIds.filter((id) => ['검토 중', '제안 대상'].includes(app.personal.shortlist[id].status)).length;
  const bars = SERVICES.map((s) => ({ s, n: scored.filter((c) => c.services.includes(s.id)).length }));
  const max = Math.max(1, ...bars.map((b) => b.n));
  const extras = Object.entries(CONFIG.extras) as [ExtraKey, { label: string; command: string }][];
  const pendingSignals = SIGNALS.filter((s) => !signalAvailable(s.id, meta.extra)).map((s) => s.label);
  // 최근 3개월 집계에 들어가는 공시 분류. 주요사항보고서 수집 전에는 기존 수집본 분류(합병·주식양수·영업양수·주식교환)만 센다
  const recentKinds = [
    meta.extra.major ? CAT_LABEL.MNA : '합병·양수 등(기존 수집본)',
    meta.extra.major ? CAT_LABEL.DISTRESS : '',
    meta.extra.krx ? CAT_LABEL.FRAUD : '',
  ]
    .filter(Boolean)
    .join(' · ');
  const isUser = app.mode === 'user';

  return (
    <section>
      <div className="eyebrow">Opportunity intelligence</div>
      <div className="title-row">
        <div>
          <h1>{isUser ? `${app.displayName}님의 PA 영업 기회` : 'PA 영업 기회 대시보드'}</h1>
          <p>DART 공시 신호로 제안 후보를 찾고, 검토 우선순위를 정리하세요. 데이터 기준일 {meta.dataAsOf}.</p>
        </div>
        <Link href="/companies" className="primary" style={{ padding: '10px 14px', borderRadius: 9, color: '#fff', fontWeight: 650, textDecoration: 'none' }}>
          ＋ 추천 목록 보기
        </Link>
      </div>

      <ModeBanner userText={app.personal.savedFilters ? '내 기본 조건으로 추천했어요.' : "기본 조건이 아직 없어요. 추천 목록에서 '내 기본 조건으로 저장'을 눌러 보세요."} />

      <div className="grid kpis">
        <div className="card">
          <div className="kpi-label">탐색 대상 상장사</div>
          <div className="kpi-value">{meta.included.toLocaleString()}</div>
          <div className="kpi-note">
            코스피·코스닥 · 스팩 {meta.excluded.spac}·리츠·펀드 {meta.excluded.reitFund} 제외
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">현재 조건의 추천 기업</div>
          <div className="kpi-value">{scored.length.toLocaleString()}</div>
          <div className="kpi-note">{app.filters.hideSamil ? '삼일 감사 고객 숨김' : '삼일 감사 고객 포함'}</div>
        </div>
        <div className="card">
          <div className="kpi-label">내 제안 후보</div>
          <div className="kpi-value">{shortIds.length}</div>
          <div className="kpi-note">{shortIds.length ? `진행 중 ${inProgress}곳` : '추천 목록에서 저장'}</div>
        </div>
        <div className="card">
          <div className="kpi-label">최근 3개월 신호 공시</div>
          <div className="kpi-value">{meta.recent3m}</div>
          <div className="kpi-note">{recentKinds}</div>
        </div>
      </div>

      <div className="grid two-col">
        <div className="card">
          <div className="section-head">
            <h2>용역별 추천 기업 수</h2>
            <span className="pill">현재 조건 기준</span>
          </div>
          <div className="hbars">
            {bars.map(({ s, n }) => (
              <div className="hbar-row" key={s.id}>
                <span>{s.name}</span>
                <div className="hbar-track">
                  <div className="hbar-fill" style={{ width: `${(n / max) * 100}%`, background: app.filters.services.includes(s.id) ? undefined : '#c8d3e1' }} />
                </div>
                <b>{n}</b>
              </div>
            ))}
          </div>
          <p className="hint">한 기업이 여러 용역에 걸릴 수 있어요. 추가 수집 전인 신호는 계산에서 빠져요.</p>
        </div>
        <div className="card">
          <div className="section-head">
            <h2>최근 포착한 공시 신호</h2>
            <span className="pill">공시일순</span>
          </div>
          {meta.recent.length === 0 && <div className="empty">최근 신호 공시가 없어요.</div>}
          {meta.recent.map((r) => (
            <div className="activity" key={r.r + r.c}>
              <div className={`dot ${r.cat !== 'MNA' ? 'warn' : ''}`} />
              <div>
                <strong>
                  <Link href={`/companies/${r.c}`}>{r.n}</Link> · {r.cat === 'MNA' && !meta.extra.major ? '합병·양수' : CAT_LABEL[r.cat]}
                </strong>
                <p>
                  {r.t} · {r.d}
                  {r.samil && <span style={{ color: 'var(--red)' }}> · 삼일 감사 고객</span>}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="section-head">
          <h2>데이터 상태</h2>
          <span className="pill">기준일 {meta.dataAsOf}</span>
        </div>
        <div className="tags" style={{ gap: 8 }}>
          <span className="tag green">기존 수집본 · {meta.universe.toLocaleString()}곳 · {meta.fiscalYear} 사업보고서</span>
          {extras.map(([k, v]) => {
            if (!meta.extra[k]) {
              return (
                <span key={k} className="tag gray" title={`미수집 · ${v.command}`}>
                  {v.label} · 미수집
                </span>
              );
            }
            const rec = extraRecord(k, meta.extraMeta);
            // 칩 개수가 0이거나 파트가 덜 모이면 확인이 필요하다는 뜻으로 주황색
            const empty = rec?.count?.n === 0;
            const partial = !!rec?.parts && rec.parts.got < rec.parts.total;
            const warn = empty || partial;
            // 칩 개수가 곳 단위면 결과 건수(records)는 툴팁으로 따로 보여 준다
            const recordsTip = rec?.count?.byCompany && rec.records !== null ? `결과 ${rec.records.toLocaleString()}건` : '';
            const targetTip = rec?.target ? `대상 ${rec.target.toLocaleString()}곳` : '';
            const tip = [
              '반영됨',
              rec ? '' : '수집 기록(meta.json) 없음',
              targetTip,
              recordsTip,
              empty && rec?.count ? `${rec.count.text} · 수집 로그 확인 후 ${v.command}` : '',
              partial && rec?.parts ? `파트 ${rec.parts.total - rec.parts.got}개 미반영` : '',
            ]
              .filter(Boolean)
              .join(' · ');
            return (
              <span key={k} className={`tag ${warn ? 'amber' : 'green'}`} title={tip}>
                {v.label} · 반영
                {rec?.date ? ` · 수집 ${rec.date}` : ''}
                {rec?.count ? ` · ${rec.count.text}` : ''}
                {rec?.parts ? ` · ${rec.parts.got}/${rec.parts.total} 파트` : ''}
              </span>
            );
          })}
        </div>
        {pendingSignals.length > 0 && (
          <p className="hint">추가 수집 전인 신호({pendingSignals.join(', ')})는 추천 목록에서 비활성으로 보여요.</p>
        )}
      </div>

      <div className="notice" style={{ marginTop: 16 }}>
        {CONFIG.disclaimer}
      </div>
    </section>
  );
}
