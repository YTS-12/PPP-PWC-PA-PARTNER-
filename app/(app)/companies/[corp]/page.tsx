'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useApp } from '@/lib/app-state';
import { loadDetail, useSummary } from '@/lib/data';
import { CONFIG, SIG, STATUSES, cautionOf } from '@/lib/config';
import { dartUrl, pct, siteUrl, withCurrency } from '@/lib/format';
import { scoreDetailHits } from '@/lib/scoring';
import type { CompanyDetail, DetailHit, FilingItem, FinRec, Status } from '@/lib/types';

const CAT_LABEL = { MNA: '합병·분할·양수 결정', DISTRESS: '부도·회생·감자·영업정지', FRAUD: '횡령·배임', DEADLINE: '제출기한 연장신고' } as const;

/** 신호에서 뺀 공시의 태그 문구. 예전 데이터의 nosig:true는 'cap'(자본잠식 50% 미만 감자)으로 읽는다 */
function nosigTag(nosig: FilingItem['nosig'] | boolean | undefined): string {
  const reason = nosig === true ? 'cap' : nosig;
  if (reason === 'cap') return CONFIG.texts.rs1CapReductionTag;
  if (reason === 'capUnknown') return CONFIG.texts.rs1CapUnknownTag || CONFIG.texts.rs1CapReductionTag;
  if (reason === 'susp') return CONFIG.texts.rs1SuspTag || '신호 제외';
  return '';
}

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
    ? ['외화 재무 · 규모 신호 제외', ratioText].filter(Boolean).join(' · ')
    : ratioText || (main ? '계산 불가' : noFin);
  const samil = d.ag === 'SAMIL';
  // 감사인 미확인: 현재 감사인도 이력도 못 찾음(예전 데이터의 빈 ag 포함)
  const unknownAu = d.ag === 'UNKNOWN' || !d.ag;
  // 이력 추정: 현재 감사인을 못 찾아 ae 연도 사업보고서 감사인으로 정함
  const est = !unknownAu && !!d.ae;
  const estNote = est ? (CONFIG.texts.estAuditorNote || '').replace('{year}', String(d.ae)).replace('{au}', d.au || '-') : '';
  const auSrcText = est ? `추정 · ${d.auSrc.replace(/\(추정\)$/, '')}` : d.auSrc;
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
          ? `현재 감사인 삼일${est ? `(${d.ae} 사업보고서 이력 기준 추정)` : ''} → 사내 독립성 검토 필요`
          : unknownAu
            ? '감사인 미확인 → 독립성 직접 확인 필요'
            : `현재 감사인 ${d.au}${est ? `(${d.ae} 사업보고서 이력 기준 추정)` : ''} (사내 절차로 최종 확인)`
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
            {d.m === 'KOSPI' ? '코스피' : '코스닥'} · {d.ig} · 현재 감사인 {d.au || '미확인'}({auSrcText}) · 데이터 기준일 {meta?.dataAsOf || '-'}
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
            <b>삼일 감사 고객</b> · 현재 감사인이 삼일회계법인이에요. 재무제표 작성 지원·재무정보체제 구축 등 비감사업무는 법적으로 제한될 수 있으니, 제안 전 사내 독립성 검토가 필요해요.
            {est && (
              <>
                <br />
                <b>이력 기준 추정</b> · {estNote}
              </>
            )}
          </span>
        </div>
      )}
      {unknownAu && (
        <div className="banner indep-warn">
          <span>
            <b>{CONFIG.texts.unknownAuditorTag}</b> · 현재 감사인과 감사인 이력을 공시에서 확인하지 못했어요. 삼일 감사 고객일 수 있으니 제안 전 사내 절차로 독립성을 직접 확인하세요.
          </span>
        </div>
      )}
      {est && !samil && (
        <div className="banner indep-warn">
          <span>
            <b>감사인 추정</b> · {estNote}
          </span>
        </div>
      )}

      <div className="card">
        <div className="company-head">
          <div>
            <span className="tag">{d.ig}</span> <span className="tag gray">{d.m === 'KOSPI' ? '코스피' : '코스닥'}</span>{' '}
            {unknownAu ? (
              <span className="tag amber">{CONFIG.texts.unknownAuditorTag}</span>
            ) : (
              !samil && <span className="tag gray">타 법인 감사 고객{est ? '(추정)' : ''}</span>
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
            {d.filings.map((f) => (
              <div className="doc" key={f.r}>
                <div>
                  <b>{f.t}</b>
                  <div className="subtle" style={{ fontSize: 11, marginTop: 3 }}>
                    {f.cat === 'MNA' && !meta?.extra.major ? '합병·양수 결정' : CAT_LABEL[f.cat]} · {f.d} · 접수번호 {f.r}
                    {f.rel && <span className="tag amber" style={{ marginLeft: 6 }}>{CONFIG.texts.ic2RelatedTag}</span>}
                    {f.corr && (
                      <span className="tag gray" style={{ marginLeft: 6 }}>
                        {CONFIG.texts.corrTag}
                      </span>
                    )}
                    {f.nosig && (
                      <span className="tag gray" style={{ marginLeft: 6 }}>
                        {nosigTag(f.nosig)}
                      </span>
                    )}
                  </div>
                </div>
                <a href={dartUrl(f.r)} target="_blank" rel="noreferrer">
                  원문 ↗
                </a>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid two-col" style={{ marginTop: 16 }}>
        <div className="card">
          <div className="section-head">
            <h2>감사인 이력</h2>
            <span className="pill">회계감사인 API</span>
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
