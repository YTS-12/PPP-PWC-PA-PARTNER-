'use client';
import { useMemo } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/app-state';
import { useSummary } from '@/lib/data';
import { applyFilters } from '@/lib/scoring';
import { CONFIG, SERVICES, SIGNALS, signalAvailable } from '@/lib/config';
import ModeBanner from '@/components/ModeBanner';
import type { ExtraKey } from '@/lib/types';

const CAT_LABEL = { MNA: '합병·분할·양수', DISTRESS: '부도·회생·감자', FRAUD: '횡령·배임' } as const;

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
          {extras.map(([k, v]) => (
            <span key={k} className={`tag ${meta.extra[k] ? 'green' : 'gray'}`} title={meta.extra[k] ? '반영됨' : `미수집 · ${v.command}`}>
              {v.label} · {meta.extra[k] ? '반영' : '미수집'}
            </span>
          ))}
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
