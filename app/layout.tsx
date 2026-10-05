import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppStateProvider } from '@/lib/app-state';

export const metadata: Metadata = {
  title: 'PwC PA Partner | 공시로 찾는 클라이언트 후보',
  description: 'DART 공시 신호로 PA·내부회계·IFRS 18·재무자문 제안 후보를 찾는 프로토타입',
  // 링크를 아는 사람만 쓰는 프로토타입이라 배포 주소가 검색에 노출되지 않게 한다.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <head>
        {/* Pretendard (SIL OFL 1.1, 상업적 이용 가능) — 한글 가독성용. 못 불러오면 시스템 글꼴로 대체 */}
        <link
          rel="stylesheet"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css"
        />
      </head>
      <body>
        <AppStateProvider>{children}</AppStateProvider>
      </body>
    </html>
  );
}
