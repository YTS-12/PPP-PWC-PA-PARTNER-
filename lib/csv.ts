/** CSV 내보내기 (엑셀에서 한글이 깨지지 않게 BOM을 붙인다) */
function csvCell(v: unknown): string {
  const s = String(v ?? '');
  return `"${s.replace(/"/g, '""')}"`;
}

export function downloadCsv(filename: string, header: string[], rows: unknown[][]) {
  const lines = [header, ...rows].map((r) => r.map(csvCell).join(','));
  const blob = new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export const auditorGroupLabel = (ag: string) =>
  ag === 'SAMIL' ? '삼일' : ag === 'BIG4' ? '타 대형법인' : ag === 'OTHER' ? '기타 법인' : '';
