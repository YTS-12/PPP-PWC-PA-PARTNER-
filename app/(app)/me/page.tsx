'use client';
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useApp } from '@/lib/app-state';
import { useSummary } from '@/lib/data';
import { SIZE_LABEL, STATUSES, SVC } from '@/lib/config';
import { auditorGroupLabel, downloadCsv } from '@/lib/csv';
import { kstDate } from '@/lib/format';
import ModeBanner, { useLeaveToLogin } from '@/components/ModeBanner';
import type { Profile, Status } from '@/lib/types';

type Tab = 'short' | 'settings';

export default function MePage() {
  const app = useApp();
  const leave = useLeaveToLogin();
  const { data } = useSummary();
  const [tab, setTab] = useState<Tab>('short');
  const [statusTab, setStatusTab] = useState<'전체' | Status>('전체');
  const [profile, setProfile] = useState<Profile>(app.personal.profile);
  const [confirm, setConfirm] = useState(false);
  const isUser = app.mode === 'user';

  useEffect(() => setProfile(app.personal.profile), [app.personal.profile]);

  const byCorp = useMemo(() => new Map((data?.companies || []).map((c) => [c.c, c])), [data]);
  const ids = Object.keys(app.personal.shortlist);
  const visible = ids.filter((id) => statusTab === '전체' || app.personal.shortlist[id].status === statusTab);
  const sf = app.personal.savedFilters;

  // 지금 보이는 상태 탭의 후보만 내보낸다
  const exportShortlist = () => {
    const header = ['기업', '종목코드', '시장', '업종', '진행 상태', '저장일', '현재 감사인', '감사인 구분', '대표자', '대표전화', '팩스', '홈페이지', '주소', '내 메모'];
    downloadCsv(
      `내후보_${statusTab}_${kstDate()}.csv`,
      header,
      visible.map((id) => {
        const c = byCorp.get(id);
        const item = app.personal.shortlist[id];
        return [c?.n || id, c?.s, c?.m, c?.ig, item.status, item.saved_at, c?.au, auditorGroupLabel(c?.ag || ''), c?.ceo, c?.ph, c?.fx, c?.hp, c?.ad, app.personal.memos[id] || ''];
      }),
    );
  };

  return (
    <section>
      <div className="eyebrow">Sales pipeline</div>
      <div className="title-row">
        <div>
          <h1>내 후보 · 설정</h1>
          <p>저장한 기업의 진행 상태와 메모를 관리하고, 개인 맞춤 설정을 바꾸세요.</p>
        </div>
        <Link href="/companies" className="secondary" style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid var(--line)', color: 'var(--ink)', fontWeight: 650, textDecoration: 'none' }}>
          ＋ 기업 더 찾기
        </Link>
      </div>
      <ModeBanner />

      <div className="tabs">
        <button className={tab === 'short' ? 'on' : ''} onClick={() => setTab('short')}>
          제안 후보 {ids.length}
        </button>
        <button className={tab === 'settings' ? 'on' : ''} onClick={() => setTab('settings')}>
          내 설정
        </button>
      </div>

      {tab === 'short' && (
        <div className="card">
          <div className="short-head">
            <div className="tabs">
              {(['전체', ...STATUSES] as const).map((s) => (
                <button key={s} className={statusTab === s ? 'on' : ''} onClick={() => setStatusTab(s)}>
                  {s} {s === '전체' ? ids.length : ids.filter((id) => app.personal.shortlist[id].status === s).length}
                </button>
              ))}
            </div>
            <button className="secondary btn-sm" disabled={visible.length === 0} onClick={exportShortlist} title="지금 보이는 상태 탭의 후보만 내보내요">
              ↓ 후보 CSV 내보내기 ({visible.length})
            </button>
          </div>
          {visible.length === 0 ? (
            <div className="empty">
              <div style={{ fontSize: 28, marginBottom: 10 }}>☆</div>
              <strong>{ids.length ? '이 상태의 기업이 없어요.' : '아직 저장한 기업이 없어요.'}</strong>
              <p>추천 목록에서 관심 기업을 후보로 저장해 보세요.</p>
              <Link href="/companies">추천 목록 보기</Link>
            </div>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>기업</th>
                    <th>진행 상태</th>
                    <th>대표 연락처</th>
                    <th>내 메모</th>
                    <th>저장일</th>
                    <th>작업</th>
                  </tr>
                </thead>
                <tbody>
                  {visible.map((id) => {
                    const c = byCorp.get(id);
                    const item = app.personal.shortlist[id];
                    return (
                      <tr key={id}>
                        <td>
                          <Link href={`/companies/${id}`} className="company">
                            {c?.n || id}
                          </Link>{' '}
                          {c?.ag === 'SAMIL' && <span className="tag red">삼일 감사 고객</span>}
                          <span className="ticker">{c ? `${c.s} · ${c.m === 'KOSPI' ? '코스피' : '코스닥'} · ${c.ig}` : ''}</span>
                        </td>
                        <td>
                          <select className="status-select" value={item.status} onChange={(e) => app.setStatus(id, e.target.value as Status)}>
                            {STATUSES.map((s) => (
                              <option key={s}>{s}</option>
                            ))}
                          </select>
                        </td>
                        <td style={{ fontSize: 12, whiteSpace: 'nowrap' }}>
                          {c?.ph || '–'}
                          {c?.ceo && <span className="ticker">대표자 {c.ceo}</span>}
                        </td>
                        <td style={{ maxWidth: 280, fontSize: 12, color: '#475467' }}>{app.personal.memos[id] || <span className="subtle">메모 없음</span>}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{item.saved_at}</td>
                        <td>
                          <div className="row-actions">
                            <Link href={`/companies/${id}`} className="small-btn" style={{ textDecoration: 'none', color: 'var(--ink)' }}>
                              상세
                            </Link>
                            <button className="small-btn" onClick={() => app.toggleShortlist(id)}>
                              제거
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {tab === 'settings' && (
        <>
          <div className="grid two-col">
            <div className="card">
              <div className="section-head">
                <h2>프로필 · 메모 서명</h2>
                <span className="pill">검토 메모 초안에 사용</span>
              </div>
              {(['display_name', 'team', 'memo_sign'] as const).map((k) => (
                <div className="field" key={k}>
                  <label htmlFor={k}>{k === 'display_name' ? '표시 이름' : k === 'team' ? '소속 팀' : '메모 서명 문구'}</label>
                  <input
                    id={k}
                    disabled={!isUser}
                    placeholder={k === 'display_name' ? '예: 홍길동' : k === 'team' ? '예: 감사본부 ○팀' : '예: 검토자 홍길동 (내부 검토용)'}
                    value={profile[k]}
                    onChange={(e) => setProfile({ ...profile, [k]: e.target.value })}
                  />
                </div>
              ))}
              <button className="primary" onClick={() => app.saveProfile(profile)}>
                프로필 저장
              </button>
              {!isUser && <p className="hint">게스트 모드에서는 프로필을 저장할 수 없어요.</p>}
            </div>
            <div className="card">
              <div className="section-head">
                <h2>내 기본 추천 조건</h2>
                <span className="pill">로그인 시 자동 적용</span>
              </div>
              {!isUser ? (
                <p className="subtle" style={{ margin: 0, lineHeight: 1.7 }}>
                  게스트 모드에서는 기본 조건을 저장할 수 없어요. 로그인하면 다음에 들어올 때 내 조건으로 바로 추천해 드려요.
                </p>
              ) : !sf ? (
                <p className="subtle" style={{ margin: 0, lineHeight: 1.7 }}>
                  저장된 기본 조건이 없어요. 추천 목록에서 조건을 고른 뒤 <b>내 기본 조건으로 저장</b>을 눌러 주세요.
                </p>
              ) : (
                <table>
                  <tbody>
                    <tr>
                      <td className="subtle">용역</td>
                      <td>{sf.services.map((s) => SVC[s].name).join(', ')}</td>
                    </tr>
                    <tr>
                      <td className="subtle">공시 신호</td>
                      <td>{sf.signals.length}개 선택</td>
                    </tr>
                    <tr>
                      <td className="subtle">시장 · 규모 · 업종</td>
                      <td>
                        {sf.market === 'all' ? '전체' : sf.market} · {SIZE_LABEL[sf.size]} · {sf.industry === 'all' ? '전체' : sf.industry}
                      </td>
                    </tr>
                    <tr>
                      <td className="subtle">삼일 감사 고객</td>
                      <td>{sf.hideSamil ? '숨김' : '표시'}</td>
                    </tr>
                  </tbody>
                </table>
              )}
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                <Link href="/companies" className="secondary" style={{ padding: '10px 14px', borderRadius: 9, border: '1px solid var(--line)', color: 'var(--ink)', fontWeight: 650, textDecoration: 'none' }}>
                  조건 바꾸러 가기
                </Link>
                <button className="secondary" onClick={() => app.resetDefaultFilters()}>
                  기본값 초기화
                </button>
              </div>
            </div>
          </div>
          <div className="card" style={{ marginTop: 16 }}>
            <div className="section-head">
              <h2>계정</h2>
            </div>
            <p className="subtle" style={{ margin: '0 0 14px', lineHeight: 1.7 }}>
              별도 회원가입 없이 이메일·비밀번호로만 구분해요. 로그인은 개인 맞춤(기본 조건·후보·메모 저장)을 위한 것이며, 추천 기능은 로그인 없이도 똑같이 쓸 수 있어요.
            </p>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="danger" onClick={() => setConfirm(true)}>
                내 저장 데이터 모두 지우기
              </button>
              <button className="secondary" onClick={leave}>
                {isUser ? '로그아웃' : '로그인하러 가기'}
              </button>
            </div>
          </div>
        </>
      )}

      {confirm && (
        <div className="modal-bg" role="dialog" aria-modal="true">
          <div className="modal">
            <h3>저장 데이터를 모두 지울까요?</h3>
            <p>기본 조건·제안 후보·메모·프로필이 모두 지워지고 되돌릴 수 없어요.</p>
            <div className="actions">
              <button className="secondary" onClick={() => setConfirm(false)}>
                취소
              </button>
              <button
                className="danger"
                onClick={async () => {
                  setConfirm(false);
                  await app.clearAll();
                }}
              >
                모두 지우기
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
