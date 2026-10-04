'use client';
import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-state';

const NAV = [
  { href: '/dashboard', ico: '▦', label: '대시보드' },
  { href: '/companies', ico: '☷', label: '추천 목록' },
  { href: '/me', ico: '☆', label: '내 후보·설정' },
];

function crumbOf(path: string): string {
  if (path.startsWith('/companies/')) return '기업 상세';
  if (path.startsWith('/companies')) return '추천 목록';
  if (path.startsWith('/me')) return '내 후보·설정';
  return '대시보드';
}

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const app = useApp();
  const router = useRouter();
  const path = usePathname() || '/dashboard';

  useEffect(() => {
    if (app.ready && !app.mode) router.replace(`/?next=${encodeURIComponent(path)}`);
  }, [app.ready, app.mode, path, router]);

  if (!app.ready || !app.mode) return <div className="loading">불러오는 중…</div>;

  const isUser = app.mode === 'user';
  const name = app.displayName || '사용자';

  async function onAuth() {
    await app.logout();
    router.replace('/');
  }

  return (
    <>
      <aside className="sidebar">
        <Link href="/dashboard" className="brand" style={{ textDecoration: 'none' }}>
          PA <span>Insight</span>
        </Link>
        <div className="workspace">Workspace</div>
        <nav className="nav">
          {NAV.map((n) => {
            const active = n.href === '/companies' ? path.startsWith('/companies') : path.startsWith(n.href);
            return (
              <Link key={n.href} href={n.href} className={active ? 'active' : ''}>
                <span className="ico">{n.ico}</span>
                <span className="navtext">{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="side-bottom">
          {isUser ? '개인 맞춤 사용 중' : '게스트 모드'}
          <br />
          <span>{isUser ? app.email : '로그인 없이 모든 기능 사용 가능'}</span>
          <br />
          <span>OpenDART 공시 스냅샷</span>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div className="crumb">워크스페이스 / {crumbOf(path)}</div>
          <div className="profile">
            <div className="avatar">{(name[0] || 'G').toUpperCase()}</div>
            <div className="proftext">
              <strong>{name}</strong>
              <div className="subtle" style={{ fontSize: 11 }}>
                {isUser ? app.personal.profile.team || app.email : '저장되지 않는 둘러보기'}
              </div>
            </div>
            <button className="secondary btn-sm" onClick={onAuth}>
              {isUser ? '로그아웃' : '로그인'}
            </button>
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </>
  );
}
