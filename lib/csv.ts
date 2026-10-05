import { auditorGroupText } from './config';
import type { AuditorGroup } from './types';

/** CSV 내보내기 (엑셀에서 한글이 깨지지 않게 BOM을 붙인다) */
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

/** footer 는 빈 줄 뒤 첫 칸에만 넣는다(기준일·면책 문구 등, 열 구조 유지) */
export function downloadCsv(filename: string, header: string[], rows: unknown[][], footer: string[] = []) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  if (footer.length) lines.push('', ...footer.map(csvCell));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** '감사인 구분' 값: 삼일·타 대형법인·기타 법인, 감사인 미확인은 '미확인', 이력 추정은 '…(추정)' */
export const auditorGroupLabel = (ag: AuditorGroup | '' | undefined, ae?: number | null) => auditorGroupText(ag, ae);
