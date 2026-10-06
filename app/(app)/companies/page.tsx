'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/app-state';
import { useSummary } from '@/lib/data';
import { applyFilters, leadHit, type Scored } from '@/lib/scoring';
import { CONFIG, INDUSTRY_GROUPS, SERVICES, SIGNALS, SIG, SIZE_LABEL, STRONG_WARN_STYLE, SVC, TEXTS, auditorTag, cautionOf, defaultFilters, isSamilClient, signalAvailable } from '@/lib/config';
import { siteUrl, won } from '@/lib/format';
import { auditorGroupLabel, auditorNameLabel, downloadCsv } from '@/lib/csv';
import ModeBanner from '@/components/ModeBanner';
import type { Filters, ServiceId } from '@/lib/types';

const PAGE = 50;
const PIN_KEY = 'pa.pinnedRows';

/** 행을 눌러 고정한 기업 (이 탭 안에서만 유지 — 상세에 다녀와도 남음) */
function usePinned() {
  const [pinned, setPinned] = useState<Set<string>>(new Set());
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(PIN_KEY);
      if (raw) setPinned(new Set(JSON.parse(raw) as string[]));
    } catch {}
  }, []);
  const toggle = (corp: string) =>
    setPinned((prev) => {
      const next = new Set(prev);
      if (next.has(corp)) next.delete(corp);
      else next.add(corp);
      try {
        sessionStorage.setItem(PIN_KEY, JSON.stringify([...next]));
      } catch {}
      return next;
    });
  return { pinned, toggle };
}

function exportCsv(rows: Scored[], asOf: string) {
  const header = ['기업', '종목코드', '시장', '업종', '점수', '우선순위', '해당 신호', '추천 용역', '현재 감사인', '감사인 구분', '자산총계(원)', '매출액(원)', '영업이익(원)', '대표자', '대표전화', '팩스', '홈페이지', '주소'];
  downloadCsv(
    `추천기업_${asOf}.csv`,
    header,
    rows.map((c) => [
      c.n,
      c.s,
      c.m,
      c.ig,
      c.score,
      c.priority,
      c.hits.map((h) => SIG[h[0]].label).join(' / '),
      c.services.map((s) => SVC[s].name).join(' / '),
      // 이력 추정 감사인은 '(추정)'을 붙여 확정 감사인과 구분하고, 구분 값도 목록 태그와 같게
      auditorNameLabel(c),
      auditorGroupLabel(c.ag, c.ae, c),
      c.a ?? '',
      c.rv ?? '',
      c.op ?? '',
      c.ceo,
      c.ph,
      c.fx,
      c.hp,
      c.ad,
    ]),
    // 맨 끝에 빈 줄을 두고 기준일·면책 문구를 첫 칸에만 넣는다(열 구조 유지)
    [`데이터 기준일 ${asOf}`, CONFIG.disclaimer],
  );
}

export default function CompaniesPage() {
  const app = useApp();
  const { data, error } = useSummary();
  const [limit, setLimit] = useState(PAGE);
  const { pinned, toggle: togglePin } = usePinned();
  const f = app.filters;
  const extra = data?.meta.extra;

  const rows = useMemo(() => (data ? applyFilters(data.companies, f, extra) : []), [data, f, extra]);
  const hiddenSamil = useMemo(() => {
    if (!data || !f.hideSamil) return 0;
    return applyFilters(data.companies, { ...f, hideSamil: false }, extra).filter((c) => isSamilClient(c)).length;
  }, [data, f, extra]);

  if (error) return <div className="notice">{error}</div>;
  if (!data) return <div className="loading">데이터를 불러오는 중…</div>;

  // 지금 보이는(고른 용역에 속하고 판정 가능한) 신호 중 선택된 개수
  const pickedSignals = SIGNALS.filter(
    (g) => f.services.includes(g.service) && signalAvailable(g.id, extra) && f.signals.includes(g.id),
  ).length;

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
        <details className="crit-fold">
          <summary>
            세부 공시 조건 설정
            <span className="count-badge">{pickedSignals}개 선택됨</span>
            <span className="subtle fold-hint">펼쳐서 신호별로 고르기</span>
          </summary>
          <div className="crit-grid">
          {SERVICES.filter((s) => f.services.includes(s.id)).map((s) => (
            <div className="crit-group" key={s.id}>
              <h4>{s.name}</h4>
              {SIGNALS.filter((g) => g.service === s.id).map((g) => {
                const ok = signalAvailable(g.id, extra);
                return (
                  <label key={g.id} className={`crit ${ok ? '' : 'off'}`} title={ok ? cautionOf(g.id, extra) : `추가 수집 전 · ${extra && g.needs ? CONFIG.extras[g.needs]?.command || '' : ''}`}>
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
        </details>
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
          <span className="pill">{f.hideSamil ? `${TEXTS.samilTag} ${hiddenSamil}곳 숨김` : TEXTS.kpiSamilShown}</span>
        </div>
        <div className="table-wrap">
          <table className="co-table">
            <thead>
              <tr>
                <th className="col-co">기업</th>
                <th className="col-fin">
                  매출
                  <span className="th-sub">영업이익</span>
                </th>
                <th className="col-score" title={`고른 신호 ${pickedSignals}개 중 해당하는 근거 수 (같은 공시로 걸린 신호는 1개로 셈)`}>
                  점수<span className="th-sub">/{pickedSignals}</span>
                </th>
                <th className="col-ev">주요 근거</th>
                <th className="col-svc">추천 용역</th>
                <th className="col-contact">대표 연락처</th>
                <th className="col-pri">우선순위</th>
                <th className="col-act">작업</th>
              </tr>
            </thead>
            <tbody>
              {rows.slice(0, limit).map((c) => {
                const top = leadHit(c.hits);
                const at = auditorTag(c);
                const saved = !!app.personal.shortlist[c.c];
                return (
                  <tr
                    key={c.c}
                    className={pinned.has(c.c) ? 'pinned' : ''}
                    aria-selected={pinned.has(c.c)}
                    onClick={(e) => {
                      // 링크·버튼을 누른 경우는 고정하지 않는다
                      if ((e.target as HTMLElement).closest('a, button, input, select')) return;
                      togglePin(c.c);
                    }}
                  >
                    <td className="col-co">
                      <Link href={`/companies/${c.c}`} className="company">
                        {c.n}
                      </Link>{' '}
                      <span className={`tag ${at.cls}`} title={at.title || undefined} style={at.strong ? STRONG_WARN_STYLE.tag : undefined}>
                        {at.text}
                      </span>
                      <span className="ticker">
                        {c.s} · {c.m === 'KOSPI' ? '코스피' : '코스닥'} · {c.ig} · 자산 {won(c.a)}
                      </span>
                    </td>
                    <td className="col-fin">
                      <span className="fin-rv">{won(c.rv)}</span>
                      <span className={`fin-op ${c.op != null && c.op < 0 ? 'neg' : ''}`}>{won(c.op)}</span>
                    </td>
                    <td className="col-score">
                      <span className="score">{c.score}</span>
                    </td>
                    <td className="col-ev ev-cell">
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
                    <td className="col-svc">
                      <div className="tags">
                        {c.services.map((s) => (
                          <span className="tag" key={s}>
                            {SVC[s].short}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td className="col-contact" style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                      {c.ph || <span className="subtle">공시에 없음</span>}
                      {c.hp && (
                        <span className="ticker">
                          <a href={siteUrl(c.hp)} target="_blank" rel="noreferrer">
                            홈페이지 ↗
                          </a>
                        </span>
                      )}
                    </td>
                    <td className="col-pri">{c.priority && <span className={`tag ${c.priority === '높음' ? 'green' : c.priority === '보통' ? '' : 'amber'}`}>{c.priority}</span>}</td>
                    <td className="col-act">
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
                  <td colSpan={8} className="empty">
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
          우선순위: 점수 3 이상 '높음', 2 '보통', 1 '낮음'. 점수는 고른 신호 수가 만점이에요. 매출·영업이익은 2025 사업보고서 기준(원화 재무만). 행을 누르면 강조가 고정되고, 다시 누르면 풀려요. {CONFIG.disclaimer}
        </p>
      </div>
    </section>
  );
}
