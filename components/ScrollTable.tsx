'use client';
import { useEffect, useRef, useState, type ReactNode } from 'react';

/**
 * 넓은 표를 감싼다. 표가 화면보다 넓으면 가로 스크롤바를 표 아래가 아니라 화면 아래에 고정해 보여 줘,
 * 어느 행을 보고 있든 바로 좌우로 옮길 수 있다. 표가 화면 안에 다 들어오거나 560px 이하 카드형이면 숨긴다.
 */
export default function ScrollTable({ children, className = '' }: { children: ReactNode; className?: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const proxy = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0); // 표 전체 폭 — 고정 스크롤바의 길이를 표와 같게 맞춘다
  const [need, setNeed] = useState(false); // 표가 가로로 넘치는지

  useEffect(() => {
    const w = wrap.current;
    if (!w) return;
    const measure = () => {
      setWidth(w.scrollWidth);
      setNeed(w.scrollWidth > w.clientWidth + 1);
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(w);
    if (w.firstElementChild) ro.observe(w.firstElementChild);
    return () => ro.disconnect();
  }, []);

  // 두 스크롤바를 같은 위치로 맞춘다. 한쪽을 옮길 때 다른 쪽의 scroll 이벤트가 되돌리지 않게 막는다
  const syncing = useRef(false);
  const sync = (from: HTMLDivElement | null, to: HTMLDivElement | null) => {
    if (!from || !to || syncing.current) return;
    syncing.current = true;
    to.scrollLeft = from.scrollLeft;
    requestAnimationFrame(() => {
      syncing.current = false;
    });
  };

  return (
    <>
      <div ref={wrap} className={`table-wrap ${need ? 'has-proxy' : ''} ${className}`.trim()} onScroll={() => sync(wrap.current, proxy.current)}>
        {children}
      </div>
      <div ref={proxy} className="hscroll" hidden={!need} aria-hidden="true" onScroll={() => sync(proxy.current, wrap.current)}>
        <div style={{ width }} />
      </div>
    </>
  );
}
