import { DM_Serif_Display } from 'next/font/google';

// PPP 글자용 세리프 (SIL OFL, 상업적 이용 가능). next/font가 빌드 때 받아 자체 호스팅한다
const serif = DM_Serif_Display({ weight: '400', subsets: ['latin'], display: 'swap' });

/**
 * PwC PA Partner 로고: 오른쪽 위 신호 막대 3개(작은 막대가 연하고 클수록 진함) + PPP + 제목.
 * PwC 로고의 주황 막대 모양은 쓰지 않는다(핸드북 '브랜드 자산은 제공된 가이드 범위 내' 규정).
 * size: 'md' 사이드바 · 'lg' 로그인 화면
 */
export default function Logo({ size = 'md' }: { size?: 'md' | 'lg' }) {
  return (
    <span className={`logo logo-${size}`}>
      <span className="logo-mark">
        <span className="logo-bars" aria-hidden="true">
          <i />
          <i />
          <i />
        </span>
        <span className={`logo-ppp ${serif.className}`}>
          <b>P</b>
          <b>P</b>
          <b>P</b>
        </span>
      </span>
      <span className="logo-sep" aria-hidden="true" />
      <span className="logo-text">
        <span className="logo-title">
          <em>PwC</em> PA Partner
        </span>
        <span className="logo-sub">Who&apos;s next — 다음 제안 후보</span>
      </span>
    </span>
  );
}
