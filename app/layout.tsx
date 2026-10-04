import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppStateProvider } from '@/lib/app-state';

export const metadata: Metadata = {
  title: 'PA Insight | 공시 기반 제안 후보',
  description: 'DART 공시 신호로 PA·내부회계·IFRS 18·재무자문 제안 후보를 찾는 프로토타입',
  // 링크를 아는 사람만 쓰는 프로토타입이라 배포 주소가 검색에 노출되지 않게 한다.
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: 'device-width', initialScale: 1 };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <AppStateProvider>{children}</AppStateProvider>
      </body>
    </html>
  );
}
