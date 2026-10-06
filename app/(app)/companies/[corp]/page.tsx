'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApp } from '@/lib/app-state';
import { loadDetail, useSummary } from '@/lib/data';
import {
  CONFIG,
  SIG,
  STATUSES,
  STRONG_WARN_STYLE,
  TEXTS,
  auditorTag,
  auditorView,
  catLabel,
  cautionOf,
  estAuditorNote,
  estAuditorTitle,
  filingDateText,
  ic2TypeTag,
  marketKindLabel,
  nosigTag,
} from '@/lib/config';
import { dartUrl, pct, siteUrl, withCurrency } from '@/lib/format';
import { scoreDetailHits } from '@/lib/scoring';
import type { CompanyDetail, DetailHit, FinRec, Status } from '@/lib/types';

function copyText(text: string, done: () => void, fail: () => void) {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(done, () => fallback());
  } else fallback();
  function fallback() {
    const ta = document.createElement('textarea');
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand('copy');
      done();
    } catch {
      fail();
    }
    ta.remove();
  }
}

export default function CompanyDetailPage() {
  const params = useParams<{ corp: string }>();
  const corp = String(params?.corp || '');
  const app = useApp();
  const { data: summary, error: summaryError } = useSummary();
  const [d, setD] = useState<CompanyDetail | null | undefined>(undefined);
  const [memo, setMemo] = useState('');

  useEffect(() => {
    let alive = true;
    setD(undefined);
    loadDetail(corp).then((x) => alive && setD(x));
    return () => {
      alive = false;
    };
  }, [corp]);

  useEffect(() => {
    setMemo(app.personal.memos[corp] || '');
  }, [corp, app.personal.memos]);

  // 추가 수집 반영 여부(meta.extra)로 신호를 거르므로 summary도 받은 뒤 점수를 낸다. 못 받으면 추가 수집 전으로 본다
  if (d === undefined || (!summary && !summaryError)) return <div className="loading">불러오는 중…</div>;
  if (d === null)
    return (
      <div className="empty">
        회사 정보를 찾지 못했어요. <Link href="/companies">추천 목록으로</Link>
      </div>
    );

  const meta = summary?.meta;
  const saved = app.personal.shortlist[corp];
  // 목록과 같은 기준: 현재 조건(용역·신호·추가 수집 여부) 안의 근거 키 개수
  const sc = scoreDetailHits(d.h, app.filters, meta?.extra);
  const { score, priority, services } = sc;
  const fx = d.finx;
  const main: FinRec | null = fx ? fx.CFS || fx.OFS : null;
  const foreign = !!main?.currency && main.currency !== 'KRW';
  const noFin = meta?.extra.fin ? '주요계정 없음' : '추가 수집 후 표시';
  // 자본총계가 0 이하(완전 자본잠식)면 부채비율은 뜻이 없어 '자본잠식'으로 보인다
  const eqNonPos = main?.equity != null && main.equity <= 0;
  const debtRatio = main && main.liabilities != null && main.equity != null && main.equity > 0 ? main.liabilities / main.equity : null;
  const debtSrc = eqNonPos ? '자본총계 0 이하 · 계산 불가' : main ? `부채총계 ÷ 자본총계${debtRatio == null ? ' · 계산 불가' : ''}` : noFin;
  const nonop = main && main.pretax != null && main.op != null ? main.pretax - main.op : null;
  const nonopRatio = nonop != null && main && main.op ? Math.abs(nonop) / Math.abs(main.op) : null;
  const ratioText = nonopRatio != null ? `영업이익의 ${pct(nonopRatio)}` : '';
  const nonopSrc = foreign
    ? [TEXTS.fxSizeExcluded, ratioText].filter(Boolean).join(' · ')
    : ratioText || (main ? '계산 불가' : noFin);
  // 독립성: 확정 감사인(ag)만 삼일 경고에 쓰고, 이력 추정(ae)은 표시만 한다(추정 감사인이 삼일이면 진한 주황 경고만)
  const av = auditorView(d);
  const samil = av.group === 'SAMIL';
  const est = av.est;
  // 감사인 미확인: 확정 감사인도 이력도 못 찾음(예전 데이터의 빈 ag 포함)
  const unknownAu = av.group === 'UNKNOWN' && !est;
  const auTag = auditorTag(d);
  // 헤더 감사인 표기. 출처가 '확인 못 함'이면 '감사인 미확인'과 겹치므로 출처를 붙이지 않는다
  const auSrc = d.auSrc && d.auSrc !== TEXTS.auSrcNone ? d.auSrc : '';
  const auHead = est
    ? `${TEXTS.unknownAuditorShort} · ${av.estAu}${auSrc ? `(${auSrc})` : TEXTS.estAuditorSuffix}`
    : unknownAu
      ? `${TEXTS.unknownAuditorShort}${auSrc ? `(${auSrc})` : ''}`
      : `현재 감사인 ${d.au}${auSrc ? `(${auSrc})` : ''}`;
  const isUser = app.mode === 'user';

  const contactText = [
    d.n,
    `대표자: ${d.ceo || '-'}`,
    `대표전화: ${d.contact.phone || '-'}`,
    `팩스: ${d.contact.fax || '-'}`,
    `홈페이지: ${d.contact.homepage || '-'}`,
    `IR: ${d.contact.ir || '-'}`,
    `주소: ${d.contact.address || '-'}`,
    `(출처: DART 기업개황, 기준일 ${meta?.dataAsOf || ''})`,
  ].join('\n');

  const draft = () => {
    const p = app.personal.profile;
    // 같은 근거 키(PA3·IC3 등)는 한 줄로 묶어 개수와 목록을 맞춘다
    const byKey = new Map<string, DetailHit[]>();
    for (const h of sc.hits) byKey.set(h.k, [...(byKey.get(h.k) || []), h]);
    const sigText = [...byKey.values()].map((g) => `${g.map((h) => SIG[h.id].label).join(' / ')}${g[0].d ? `(${g[0].d})` : ''}`).join(', ');
    const lines = [
      `[검토 메모 초안] ${d.n} (${d.m === 'KOSPI' ? '코스피' : '코스닥'} · ${d.ig})`,
      `- 해당 신호 ${score}개${sc.total !== score ? ` (현재 조건 기준 · 전체 ${sc.total}개)` : ''}: ${sigText || '없음'}`,
      `- 검토 용역: ${services.map((s) => CONFIG.services.find((x) => x.id === s)!.name).join(', ') || '-'}`,
      `- 회사 대표 연락처: ${d.contact.phone || '-'} / ${d.contact.homepage || '-'} (DART 기업개황)`,
      `- 독립성: ${
        samil
          ? '현재 감사인 삼일 → 사내 독립성 검토 필요'
          : est
            ? estAuditorTitle(av)
            : unknownAu
              ? TEXTS.unknownAuditorTag
              : `현재 감사인 ${d.au} (사내 절차로 최종 확인)`
      }`,
      '- 비고: 공시 신호 기반 검토 후보이며 용역 수요를 확정하지 않음',
    ];
    if (p.memo_sign || p.display_name) lines.push(`- ${p.memo_sign || p.display_name}${p.team ? ' / ' + p.team : ''}`);
    return lines.join('\n');
  };

  return (
    <section>
      <div className="eyebrow">Company intelligence</div>
      <div className="title-row">
        <div>
          <p style={{ margin: 0 }}>
            <Link href="/companies">← 추천 목록으로</Link>
          </p>
          <h1 style={{ marginTop: 12 }}>{d.n} · 기업 분석</h1>
          <p>
            {d.m === 'KOSPI' ? '코스피' : '코스닥'} · {d.ig} · {auHead} · 데이터 기준일 {meta?.dataAsOf || '-'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {saved && (
            <select className="status-select" value={saved.status} onChange={(e) => app.setStatus(corp, e.target.value as Status)} aria-label="진행 상태">
              {STATUSES.map((s) => (
                <option key={s}>{s}</option>
              ))}
            </select>
          )}
          <button className="primary" onClick={() => app.toggleShortlist(corp)}>
            {saved ? '★ 후보에 저장됨' : '☆ 후보에 저장'}
          </button>
        </div>
      </div>

      {samil && (
        <div className="banner indep">
          <span>
            <b>{TEXTS.samilTag}</b> · {TEXTS.samilBanner}
          </span>
        </div>
      )}
      {unknownAu && (
        <div className="banner indep-warn">
          <span>
            <b>{TEXTS.unknownAuditorTag}</b> · {TEXTS.unknownAuditorBanner}
          </span>
        </div>
      )}
      {est && (
        <div className="banner indep-warn" style={av.estSamil ? STRONG_WARN_STYLE.banner : undefined}>
          <span>
            <b>{av.estSamil ? TEXTS.estSamilWarn : TEXTS.estAuditorLabel}</b> · {estAuditorNote(av)}
          </span>
        </div>
      )}

      <div className="card">
        <div className="company-head">
          <div>
            <span className="tag">{d.ig}</span> <span className="tag gray">{d.m === 'KOSPI' ? '코스피' : '코스닥'}</span>{' '}
            {/* 삼일(확정)은 위 빨간 띠로 알리고, 그 밖은 목록과 같은 독립성 태그 */}
            {!samil && (
              <span className={`tag ${auTag.cls}`} title={auTag.title || undefined} style={auTag.strong ? STRONG_WARN_STYLE.tag : undefined}>
                {auTag.text}
              </span>
            )}
            <h2>{d.n}</h2>
            <div className="subtle">
              {d.s} · {d.dartName} · 상장 {d.listed || '-'} · 결산월 {d.accMt || '-'}월
            </div>
          </div>
          <div className="score-box">
            <div className="subtle" style={{ fontSize: 12 }}>
              현재 조건 해당 신호
            </div>
            <div style={{ fontSize: 32, fontWeight: 850, color: 'var(--navy)', margin: '5px 0' }}>{score}개</div>
            {priority && <span className={`tag ${priority === '높음' ? 'green' : priority === '보통' ? '' : 'amber'}`}>우선순위 {priority}</span>}
            {sc.total !== score && (
              <div className="subtle" style={{ fontSize: 11, marginTop: 6 }}>
                전체 해당 신호 {sc.total}개
              </div>
            )}
          </div>
        </div>
        <div className="metric-grid">
          <div className="metric">
            <div className="label">자산총계</div>
            <div className="num">{withCurrency(main?.assets ?? d.fin.assets, main?.currency || d.fin.currency)}</div>
            <div className="src">
              {main ? (main.fs_div === 'CFS' ? '연결' : '별도') : d.fin.basis === 'CFS' ? '연결' : d.fin.basis === 'OFS' ? '별도' : '-'} · {main ? `${main.bsns_year} 사업보고서` : '2025 사업보고서'}
            </div>
          </div>
          <div className="metric">
            <div className="label">부채비율</div>
            <div className="num">{eqNonPos ? '자본잠식' : debtRatio != null ? pct(debtRatio) : '–'}</div>
            <div className="src">{debtSrc}</div>
          </div>
          <div className="metric">
            <div className="label">영업이익 {main ? '(당기·전기·전전기)' : '(2025)'}</div>
            <div className="num" style={{ fontSize: main ? 14 : 19 }}>
              {main ? [main.op, main.op_prev, main.op_prev2].map((v) => withCurrency(v, main.currency)).join(' · ') : withCurrency(d.fin.op, d.fin.currency)}
            </div>
            <div className="src">주요계정 API</div>
          </div>
          <div className="metric">
            <div className="label">영업외손익 (세전이익 − 영업이익)</div>
            <div className="num">{nonop != null ? withCurrency(nonop, main?.currency) : '–'}</div>
            <div className="src">{nonopSrc}</div>
          </div>
        </div>
      </div>

      <div className="analysis-grid" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="section-head">
            <h2>추천 근거</h2>
            <span className="pill">규칙 기반 · 예/아니오</span>
          </div>
          {d.h.length === 0 && <div className="empty">해당하는 공시 신호가 없어요.</div>}
          {d.h.map((h) => {
            const g = SIG[h.id];
            const out = !sc.active.has(h.id);
            // caution은 늘, cautionPending은 해당 추가 수집 전일 때만
            const caution = cautionOf(h.id, meta?.extra);
            return (
              <div className="reason" key={h.id} style={out ? { opacity: 0.5 } : undefined}>
                <div className="reason-icon">{g.service === 'RS' ? '!' : h.r && h.d ? '◈' : '↗'}</div>
                <div style={{ minWidth: 0 }}>
                  <strong>{g.label}</strong>
                  {out && (
                    <>
                      {' '}
                      <span className="tag gray">현재 조건 밖</span>
                    </>
                  )}
                  <p>
                    {h.ev}
                    <br />
                    {CONFIG.services.find((s) => s.id === g.service)!.short} · {g.source} API
                    {h.r && (
                      <>
                        {' · '}
                        <a href={dartUrl(h.r)} target="_blank" rel="noreferrer">
                          DART 원문 ↗
                        </a>
                      </>
                    )}
                  </p>
                  {caution && <div className="caution">{caution}</div>}
                </div>
              </div>
            );
          })}
          {sc.hits.length < d.h.length && <p className="hint">흐리게 표시한 근거는 현재 추천 조건 밖이라 점수에 넣지 않았어요. 조건은 추천 목록에서 바꿀 수 있어요.</p>}
          <p className="hint">{CONFIG.disclaimer}</p>
        </div>

        <div className="card">
          <div className="section-head">
            <h2>제안 방향 초안</h2>
            <span className="pill">템플릿 · 검토 필요</span>
          </div>
          <div className="callout">
            {samil && (
              <>
                <b>{CONFIG.strategy.SAMIL}</b>
                <br />
              </>
            )}
            {services.length
              ? services.map((s) => <div key={s}>{CONFIG.strategy[s]}</div>)
              : d.h.length
                ? '현재 조건에 해당하는 용역이 없어요.'
                : '해당 용역이 없어요.'}
          </div>
          <div style={{ marginTop: 15 }}>
            <strong style={{ fontSize: 13 }}>추천 용역</strong>
            <div className="tags" style={{ marginTop: 10 }}>
              {services.map((s) => (
                <span className="tag" key={s}>
                  {CONFIG.services.find((x) => x.id === s)!.name}
                </span>
              ))}
            </div>
          </div>
          <div style={{ marginTop: 18 }}>
            <div className="section-head" style={{ marginBottom: 8 }}>
              <h2 style={{ fontSize: 14 }}>내 메모</h2>
              <span className="pill">{isUser ? '내 계정에 저장' : '게스트 · 저장 안 됨'}</span>
            </div>
            <div className="field" style={{ marginBottom: 6 }}>
              <textarea maxLength={200} placeholder="예: 다음 주 매니저와 검토 / 공시 원문 재확인" value={memo} onChange={(e) => setMemo(e.target.value)} />
              <div className="counter">{memo.length} / 200</div>
            </div>
            <p className="hint" style={{ marginTop: 0 }}>
              고객 기밀·실명·금액은 입력하지 마세요.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="secondary" onClick={() => app.saveMemo(corp, memo)}>
                메모 저장
              </button>
              <button className="secondary" onClick={() => copyText(draft(), () => app.notify('검토 메모 초안을 복사했어요.'), () => app.notify('복사가 막혀 있어요.'))}>
                검토 메모 초안 복사
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="grid two-col" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="section-head">
            <h2>회사 정보 · 컨택 포인트</h2>
            <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <span className="pill">기업개황 API</span>
              <button className="small-btn" onClick={() => copyText(contactText, () => app.notify('회사 연락처를 복사했어요.'), () => app.notify('복사가 막혀 있어요.'))}>
                ⧉ 연락처 복사
              </button>
            </div>
          </div>
          <div className="contact-grid">
            <div className="ci">
              <div className="k">대표자</div>
              <div className="v">{d.ceo || <span className="subtle">공시에 없음</span>}</div>
              <div className="f">ceo_nm</div>
            </div>
            <div className="ci wide">
              <div className="k">홈페이지</div>
              <div className="v">
                {d.contact.homepage ? (
                  <a href={siteUrl(d.contact.homepage)} target="_blank" rel="noreferrer">
                    {d.contact.homepage} ↗
                  </a>
                ) : (
                  <span className="subtle">공시에 없음</span>
                )}
              </div>
              <div className="f">hm_url</div>
            </div>
            <div className="ci">
              <div className="k">대표전화</div>
              <div className="v">{d.contact.phone || <span className="subtle">공시에 없음</span>}</div>
              <div className="f">phn_no</div>
            </div>
            <div className="ci">
              <div className="k">팩스</div>
              <div className="v">{d.contact.fax || <span className="subtle">공시에 없음</span>}</div>
              <div className="f">fax_no</div>
            </div>
            <div className="ci">
              <div className="k">IR 페이지</div>
              <div className="v">
                {d.contact.ir ? (
                  <a href={siteUrl(d.contact.ir)} target="_blank" rel="noreferrer">
                    {d.contact.ir} ↗
                  </a>
                ) : (
                  <span className="subtle">공시에 없음</span>
                )}
              </div>
              <div className="f">ir_url</div>
            </div>
            <div className="ci full">
              <div className="k">본사 주소</div>
              <div className="v">{d.contact.address || <span className="subtle">공시에 없음</span>}</div>
              <div className="f">adres</div>
            </div>
          </div>
          <p className="hint">공시된 회사 대표 연락처만 보여줘요. 담당자 개인 연락처는 제공하지 않아요. 공시 이후 바뀌었을 수 있으니 연락 전 홈페이지에서 한 번 더 확인하세요.</p>
        </div>

        <div className="card">
          <div className="section-head">
            <h2>공시 보고서 바로가기</h2>
            <span className="pill">DART 원문</span>
          </div>
          <div className="doc-list">
            {d.primary && (
              <div className="doc">
                <div>
                  <b>2025 사업보고서</b>
                  <div className="subtle" style={{ fontSize: 11, marginTop: 3 }}>
                    접수번호 {d.primary}
                  </div>
                </div>
                <a href={dartUrl(d.primary)} target="_blank" rel="noreferrer">
                  원문 ↗
                </a>
              </div>
            )}
            {d.filings.map((f) => {
              // 분류 이름(거래소 시장조치면 종류까지. 옛 데이터의 내부결산 시점 공시는 제목으로 '내부결산 기준 사유 발생(감사 전)') ·
              // 날짜(정정공시는 '최초 … · 정정 …') · 접수번호(정정본) · 신호 제외 이유 태그(철회·사유 해소·12개월 전·자동 정지·감자·영업정지)
              const mkt = f.cat === 'MARKET' ? marketKindLabel(f.mkt, f.t) : '';
              const ic2 = f.cat === 'FRAUD' ? ic2TypeTag(f) : null;
              const off = nosigTag(f.nosig);
              return (
                <div className="doc" key={`${f.cat}:${f.r}`}>
                  <div>
                    <b>{f.t}</b>
                    <div className="subtle" style={{ fontSize: 11, marginTop: 3 }}>
                      {f.cat === 'MNA' && !meta?.extra.major ? '합병·양수 결정' : catLabel(f.cat)}
                      {mkt ? ` · ${mkt}` : ''} · {filingDateText(f)} · 접수번호 {f.r}
                      {ic2 && (
                        <span className={`tag ${ic2.cls}`} style={{ marginLeft: 6 }}>
                          {ic2.text}
                        </span>
                      )}
                      {f.sub && (
                        <span className="tag gray" style={{ marginLeft: 6 }}>
                          {TEXTS.ic2SubTag}
                        </span>
                      )}
                      {/* 최초 공시일을 알면 날짜에 '정정'이 이미 보이므로 '정정' 태그는 모를 때만. 첨부정정은 원공시로 연결한다는 태그 */}
                      {f.link ? (
                        <span className="tag gray" style={{ marginLeft: 6 }}>
                          {TEXTS.linkFirstTag}
                        </span>
                      ) : (
                        f.corr &&
                        !f.first && (
                          <span className="tag gray" style={{ marginLeft: 6 }}>
                            {TEXTS.corrTag}
                          </span>
                        )
                      )}
                      {off && (
                        <span className="tag gray" style={{ marginLeft: 6 }}>
                          {off}
                        </span>
                      )}
                    </div>
                  </div>
                  {/* 첨부정정([첨부정정]·[첨부추가])은 결정 본문이 있는 원공시(link)를 연다 */}
                  <a href={dartUrl(f.link || f.r)} target="_blank" rel="noreferrer">
                    원문 ↗
                  </a>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="grid two-col" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="section-head">
            <h2>감사인 이력</h2>
            <span className="pill">회계감사인 API · 보완</span>
          </div>
          <div className="table-wrap">
            <table className="hist-table">
              <thead>
                <tr>
                  <th>사업연도</th>
                  <th>감사인</th>
                  <th>원문</th>
                </tr>
              </thead>
              <tbody>
                {d.hist.map(([y, a, r]) => (
                  <tr key={y}>
                    <td>{y === 2026 ? '2026 (반기)' : y}</td>
                    <td>{a}</td>
                    <td>{r ? <a href={dartUrl(r)} target="_blank" rel="noreferrer">보기 ↗</a> : '–'}</td>
                  </tr>
                ))}
                {d.hist.length === 0 && (
                  <tr>
                    <td colSpan={3} className="empty">
                      감사인 이력이 없어요.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
        <div className="card">
          <div className="section-head">
            <h2>감사의견 · 핵심감사사항</h2>
            <span className="pill">참고 · 2025 사업보고서</span>
          </div>
          <p style={{ margin: '0 0 10px' }}>
            감사의견: <b>{d.opinion || '미확인'}</b>
          </p>
          <div className="kam">{d.kam || '핵심감사사항 정보가 없어요.'}</div>
        </div>
      </div>

      {d.notes.length > 0 && (
        <div className="notice" style={{ marginTop: 16 }}>
          {d.notes.map((n) => (
            <div key={n}>{n}</div>
          ))}
        </div>
      )}
    </section>
  );
}
