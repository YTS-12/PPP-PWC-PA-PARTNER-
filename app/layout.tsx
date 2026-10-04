import type { Metadata, Viewport } from 'next';
import './globals.css';
import { AppStateProvider } from '@/lib/app-state';

export const metadata: Metadata = {
  title: 'PA Insight | 공시 기반 제안 후보',
  description: 'DART 공시 신호로 PA·내부회계·IFRS 18·재무자문 제안 후보를 찾는 프로토타입',
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
