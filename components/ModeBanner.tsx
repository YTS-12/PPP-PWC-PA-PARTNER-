'use client';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useApp } from '@/lib/app-state';

export default function ModeBanner({ userText }: { userText?: string }) {
  const app = useApp();
  const router = useRouter();
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
      <button
        className="secondary"
        onClick={async () => {
          await app.logout();
          router.replace('/');
        }}
      >
        로그인하고 저장하기
      </button>
    </div>
  );
}
