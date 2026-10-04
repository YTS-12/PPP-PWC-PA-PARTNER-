'use client';
import { useEffect, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-state';

const NEXT_ALLOWED = ['/dashboard', '/companies', '/me'];

/** ?next=는 같은 사이트의 앱 화면만 허용한다. 역슬래시·제어문자는 브라우저가 외부 주소로 읽을 수 있어 거부한다 */
function nextPath(): string {
  if (typeof window === 'undefined') return '/dashboard';
  const n = new URLSearchParams(window.location.search).get('next');
  if (!n || !n.startsWith('/') || /[\\\u0000-\u001f\u007f]/.test(n)) return '/dashboard';
  try {
    const u = new URL(n, window.location.origin);
    if (u.origin !== window.location.origin) return '/dashboard';
    if (!NEXT_ALLOWED.some((p) => u.pathname === p || u.pathname.startsWith(`${p}/`))) return '/dashboard';
    return u.pathname + u.search;
  } catch {
    return '/dashboard';
  }
}

export default function LoginPage() {
  const app = useApp();
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [pw, setPw] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (app.ready && app.mode) router.replace(nextPath());
  }, [app.ready, app.mode, router]);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    const mail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return setErr('이메일 형식을 확인해 주세요.');
    if (pw.length < 8) return setErr('비밀번호는 8자 이상이어야 해요.');
    setBusy(true);
    const r = await app.login(mail, pw);
    setBusy(false);
    if (!r.ok) return setErr(r.message || '로그인하지 못했어요.');
    app.notify(r.created ? '새 개인 공간을 만들었어요. 이제 조건·후보·메모가 저장돼요.' : '다시 오셨네요. 저장한 내용을 불러왔어요.');
    router.replace(nextPath());
  }

  function guest() {
    app.enterGuest();
    app.notify('게스트로 둘러보는 중이에요. 로그인하면 내용이 저장돼요.');
    router.replace(nextPath());
  }

  return (
    <div className="login">
      <div className="login-side">
        <div>
          <div className="brand">
            PA <span>Insight</span>
          </div>
          <div style={{ marginTop: 56 }}>
            <h1>
              공시로 찾는
              <br />
              다음 제안 후보
            </h1>
            <p>
              DART 공시에서 확인되는 신호로 회계·결산 지원, 내부회계관리제도, IFRS 18 도입 지원, 재무자문·구조조정 후보를 먼저 추려 드려요.
            </p>
          </div>
          <div className="login-points">
            <div>
              <span className="n">1</span>
              <span>
                <b>공시 기준 → 용역 매핑</b>
                <br />
                모든 추천에 공시명·공시일·DART 원문 링크를 함께 보여줘요.
              </span>
            </div>
            <div>
              <span className="n">2</span>
              <span>
                <b>감사 고객 자동 표시</b>
                <br />
                현재 감사인이 삼일인 회사는 기본으로 숨겨요.
              </span>
            </div>
            <div>
              <span className="n">3</span>
              <span>
                <b>바로 쓰는 컨택 포인트</b>
                <br />
                대표자·대표전화·팩스·홈페이지·주소를 공시 기준으로 함께 드려요.
              </span>
            </div>
            <div>
              <span className="n">4</span>
              <span>
                <b>로그인하면 개인 맞춤</b>
                <br />내 기본 조건, 제안 후보·진행 상태, 회사별 메모가 저장돼요.
              </span>
            </div>
          </div>
        </div>
        <div className="login-foot">
          코스피·코스닥 상장사 OpenDART 공시 스냅샷 기반 프로토타입입니다.
          <br />
          추천은 용역 수요를 확정하지 않으며, 독립성은 사내 절차로 최종 확인해야 합니다.
        </div>
      </div>

      <div className="login-main">
        <div className="login-card">
          <h2>시작하기</h2>
          <p className="lead">이메일과 비밀번호만 입력하면 바로 시작돼요.</p>
          <div className="no-signup">
            <b>회원가입이 필요 없어요</b>
            처음 입력한 이메일이면 개인 공간이 자동으로 만들어지고, 다음에 같은 이메일·비밀번호로 들어오면 저장한 내용이 그대로 보여요. 이메일 인증 메일도 보내지 않아요.
          </div>
          {!app.supabaseReady && (
            <div className="notice" style={{ marginBottom: 16 }}>
              로그인 설정 전이에요. <code>.env</code>에 Supabase URL과 anon 키를 넣으면 로그인이 켜져요. 지금은 둘러보기로 모든 기능을 쓸 수 있어요.
            </div>
          )}
          <form onSubmit={onSubmit} noValidate>
            <div className="field">
              <label htmlFor="email">이메일</label>
              <input id="email" type="email" autoComplete="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div className="field">
              <label htmlFor="pw">
                비밀번호 <span className="subtle">(8자 이상)</span>
              </label>
              <input id="pw" type="password" autoComplete="current-password" placeholder="비밀번호" value={pw} onChange={(e) => setPw(e.target.value)} />
            </div>
            <div className="login-err" role="alert">
              {err}
            </div>
            <button className="primary full" type="submit" disabled={busy || !app.supabaseReady}>
              {busy ? '확인 중…' : '로그인하고 개인 맞춤으로 시작'}
            </button>
          </form>
          <div className="or">또는</div>
          <button className="secondary full" onClick={guest}>
            로그인 없이 둘러보기
          </button>
          <div className="fine">
            <b style={{ color: 'var(--ink)' }}>로그인은 개인 맞춤 기능을 위한 것이에요.</b> 로그인하지 않아도 기업 추천·상세 분석 등 모든 기능을 쓸 수 있어요. 다만 게스트로 쓰면 후보·메모·조건이 저장되지 않아요.
            <ul>
              <li>처음 입력한 이메일로 새 공간이 만들어져요. 오타에 주의해 주세요.</li>
              <li>회사 계정 비밀번호를 다시 쓰지 마세요.</li>
              <li>메모에는 고객 기밀·실명·금액을 입력하지 마세요.</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}
