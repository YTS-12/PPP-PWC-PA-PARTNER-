'use client';
import { useCallback } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-state';

/** 로그인 화면으로 나가는 중이면 true. (app)/layout의 '모드 없음 → /?next=' 이동을 건너뛰어 이동이 한 번만 일어나게 한다 */
export const leaving = { current: false };

/** 게스트 '로그인'·로그인 사용자 '로그아웃' 공통 처리 */
export function useLeaveToLogin() {
  const app = useApp();
  const router = useRouter();
  const path = usePathname() || '/dashboard';
  const { mode, personal, logout } = app;
  return useCallback(async () => {
    const isUser = mode === 'user';
    if (!isUser) {
      const dirty = Object.keys(personal.shortlist).length > 0 || Object.keys(personal.memos).length > 0;
      if (dirty && !window.confirm('게스트로 담은 후보·메모는 로그인 화면으로 가면 사라져요. 계속할까요?')) return;
    }
    leaving.current = true;
    await logout();
    router.replace(isUser ? '/' : `/?next=${encodeURIComponent(path)}`);
  }, [mode, personal.shortlist, personal.memos, logout, router, path]);
}

export default function ModeBanner({ userText }: { userText?: string }) {
  const app = useApp();
  const leave = useLeaveToLogin();
  if (app.mode === 'user') {
    if (!userText) return null;
    return (
      <div className="banner user">
        <span>
          <b>개인 맞춤 적용 중</b> · {userText}
        </span>
        <Link href="/me" className="secondary" style={{ padding: '7px 10px', fontSize: 12, borderRadius: 9, border: '1px solid var(--line)', background: '#fff' }}>
          내 설정
        </Link>
      </div>
    );
  }
  return (
    <div className="banner guest">
      <span>
        <b>게스트 모드</b> · 모든 추천 기능을 그대로 쓸 수 있어요. 다만 조건·후보·메모는 이 화면을 떠나면 사라져요.
      </span>
      <button className="secondary" onClick={leave}>
        로그인하고 저장하기
      </button>
    </div>
  );
}
