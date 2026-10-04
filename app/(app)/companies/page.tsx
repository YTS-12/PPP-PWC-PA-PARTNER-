'use client';
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/app-state';
import { useSummary } from '@/lib/data';
import { applyFilters, type Scored } from '@/lib/scoring';
import { CONFIG, INDUSTRY_GROUPS, SERVICES, SIGNALS, SIG, SIZE_LABEL, SVC, defaultFilters, signalAvailable } from '@/lib/config';
import { siteUrl, won } from '@/lib/format';
import ModeBanner from '@/components/ModeBanner';
import type { Filters, ServiceId } from '@/lib/types';

const PAGE = 50;

function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

function exportCsv(rows: Scored[], asOf: string) {
  const header = ['기업', '종목코드', '시장', '업종', '점수', '우선순위', '해당 신호', '추천 용역', '현재 감사인', '감사인 구분', '자산총계(원)', '대표자', '대표전화', '팩스', '홈페이지', '주소'];
  const lines = [header.map(csvCell).join(',')];
  for (const c of rows) {
    lines.push(
      [
        c.n,
        c.s,
        c.m,
        c.ig,
        c.score,
        c.priority,
        c.hits.map((h) => SIG[h[0]].label).join(' / '),
        c.services.map((s) => SVC[s].name).join(' / '),
        c.au,
        c.ag === 'SAMIL' ? '삼일' : c.ag === 'BIG4' ? '타 대형법인' : c.ag === 'OTHER' ? '기타 법인' : '',
        c.a ?? '',
        c.ceo,
        c.ph,
        c.fx,
        c.hp,
        c.ad,
      ]
        .map(csvCell)
        .join(','),
    );
  }
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `추천기업_${asOf}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export default function CompaniesPage() {
  const app = useApp();
  const { data, error } = useSummary();
  const [limit, setLimit] = useState(PAGE);
  const f = app.filters;
  const extra = data?.meta.extra;

  const rows = useMemo(() => (data ? applyFilters(data.companies, f, extra) : []), [data, f, extra]);
  const hiddenSamil = useMemo(() => {
    if (!data || !f.hideSamil) return 0;
    return applyFilters(data.companies, { ...f, hideSamil: false }, extra).filter((c) => c.ag === 'SAMIL').length;
  }, [data, f, extra]);

  if (error) return <div className="notice">{error}</div>;
  if (!data) return <div className="loading">데이터를 불러오는 중…</div>;

  const set = (patch: Partial<Filters>) => {
    setLimit(PAGE);
    app.setFilters({ ...f, ...patch });
  };
  const toggleService = (id: ServiceId) =>
    set({ services: f.services.includes(id) ? f.services.filter((s) => s !== id) : [...f.services, id] });
  const toggleSignal = (id: string) =>
    set({ signals: f.signals.includes(id) ? f.signals.filter((s) => s !== id) : [...f.signals, id] });

  return (
    <section>
      <div className="eyebrow">Recommended companies</div>
      <div className="title-row">
        <div>
          <h1>추천 기업 목록</h1>
          <p>고른 용역·신호에 해당하는 근거가 많은 기업부터 보여줘요. 같은 공시로 걸린 신호는 한 번만 세요.</p>
        </div>
      </div>
      <ModeBanner />

      <div className="card filter-card">
        <div className="field-title">관심 용역</div>
        <div className="svc-chips">
          {SERVICES.map((s) => (
            <label key={s.id} className={`chip ${f.services.includes(s.id) ? 'on' : ''}`}>
              <input type="checkbox" checked={f.services.includes(s.id)} onChange={() => toggleService(s.id)} />
              {s.name}
            </label>
          ))}
        </div>
        <div className="crit-grid">
          {SERVICES.filter((s) => f.services.includes(s.id)).map((s) => (
            <div className="crit-group" key={s.id}>
              <h4>{s.name}</h4>
              {SIGNALS.filter((g) => g.service === s.id).map((g) => {
                const ok = signalAvailable(g.id, extra);
                return (
                  <label key={g.id} className={`crit ${ok ? '' : 'off'}`} title={ok ? g.caution : `추가 수집 전 · ${extra && g.needs ? CONFIG.extras[g.needs].command : ''}`}>
                    <input type="checkbox" disabled={!ok} checked={ok && f.signals.includes(g.id)} onChange={() => toggleSignal(g.id)} />
                    <span>
                      {g.label}
                      <span className="src">
                        {g.source} API{ok ? ` · ${data.meta.signalCounts[g.id] ?? 0}곳` : ' · 추가 수집 전'}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          ))}
        </div>
        <div className="filter-row">
          <input type="search" placeholder="기업명 또는 종목코드 검색" value={f.query} onChange={(e) => set({ query: e.target.value })} />
          <select value={f.market} onChange={(e) => set({ market: e.target.value as Filters['market'] })} aria-label="시장">
            <option value="all">시장 전체</option>
            <option value="KOSPI">코스피</option>
            <option value="KOSDAQ">코스닥</option>
          </select>
          <select value={f.size} onChange={(e) => set({ size: e.target.value as Filters['size'] })} aria-label="자산 규모">
            {(['all', 'L', 'M', 'S'] as const).map((k) => (
              <option key={k} value={k}>
                자산 {SIZE_LABEL[k]}
              </option>
            ))}
          </select>
          <select value={f.industry} onChange={(e) => set({ industry: e.target.value })} aria-label="업종">
            <option value="all">업종 전체</option>
            {INDUSTRY_GROUPS.map((g) => (
              <option key={g} value={g}>
                {g}
              </option>
            ))}
          </select>
          <select value={f.sort} onChange={(e) => set({ sort: e.target.value as Filters['sort'] })} aria-label="정렬">
            <option value="score">점수 높은 순</option>
            <option value="risk">재무위험 신호 우선</option>
            <option value="assets">자산 큰 순</option>
            <option value="name">기업명 가나다순</option>
          </select>
          <label className="switch">
            <input type="checkbox" checked={f.hideSamil} onChange={(e) => set({ hideSamil: e.target.checked })} />
            삼일 감사 고객 숨기기
          </label>
        </div>
        <div className="filter-actions">
          <button className="secondary" onClick={() => app.setFilters(app.personal.savedFilters || defaultFilters())}>
            조건 초기화
          </button>
          <button className="secondary" onClick={() => app.saveDefaultFilters(f)}>
            ☆ 내 기본 조건으로 저장
          </button>
          <button className="secondary" onClick={() => exportCsv(rows, data.meta.dataAsOf)}>
            ↓ CSV 내보내기
          </button>
        </div>
      </div>

      <div className="card">
        <div className="section-head">
          <h2>
            추천 기업 <span className="subtle">{rows.length.toLocaleString()}곳</span>
          </h2>
          <span className="pill">{f.hideSamil ? `삼일 감사 고객 ${hiddenSamil}곳 숨김` : '삼일 감사 고객 포함'}</span>
        </div>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>기업</th>
                <th>점수</th>
                <th>주요 근거</th>
                <th>추천 용역</th>
                <th>대표 연락처</th>
                <th>우선순위</th>
                <th>작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((c) => {
                const top = c.hits[0];
                const saved = !!app.personal.shortlist[c.c];
                return (
                  <tr key={c.c}>
                    <td>
                      <Link href={`/companies/${c.c}`} className="company">
                        {c.n}
                      </Link>{' '}
                      {c.ag === 'SAMIL' ? <span className="tag red">삼일 감사 고객</span> : c.ag ? <span className="tag gray">타 법인 감사</span> : null}
                      <span className="ticker">
                        {c.s} · {c.m === 'KOSPI' ? '코스피' : '코스닥'} · {c.ig} · 자산 {won(c.a)}
                      </span>
                    </td>
                    <td>
                      <span className="score">{c.score}</span>
                    </td>
                    <td className="ev-cell">
                      {top ? (
                        <>
                          <span className="tag">{SIG[top[0]].label}</span>
                          <div className="subtle" style={{ marginTop: 5 }}>
                            {top[1]}
                          </div>
                        </>
                      ) : (
                        <span className="subtle">선택한 신호 없음</span>
                      )}
                    </td>
                    <td>
                      <div className="tags">
                        {c.services.map((s) => (
                          <span className="tag" key={s}>
                            {SVC[s].short}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {c.ph || <span className="subtle">공시에 없음</span>}
                      {c.hp && (
                        <span className="ticker">
                          <a href={siteUrl(c.hp)} target="_blank" rel="noreferrer">
                            홈페이지 ↗
                          </a>
                        </span>
                      )}
                    </td>
                    <td>{c.priority && <span className={`tag ${c.priority === '높음' ? 'green' : c.priority === '보통' ? '' : 'amber'}`}>{c.priority}</span>}</td>
                    <td>
                      <div className="row-actions">
                        <Link href={`/companies/${c.c}`} className="small-btn" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
                          상세
                        </Link>
                        <button className={`small-btn ${saved ? 'selected' : ''}`} onClick={() => app.toggleShortlist(c.c)}>
                          {saved ? '★ 저장됨' : '☆ 저장'}
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={7} className="empty">
                    조건에 맞는 기업이 없어요. 용역이나 신호를 더 골라 보세요.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {rows.length > limit && (
          <div className="more">
            <button className="secondary" onClick={() => setLimit(limit + PAGE)}>
              더 보기 ({limit.toLocaleString()} / {rows.length.toLocaleString()})
            </button>
          </div>
        )}
        <p className="hint">
          우선순위: 점수 3 이상 '높음', 2 '보통', 1 '낮음'. {CONFIG.disclaimer}
        </p>
      </div>
    </section>
  );
}
