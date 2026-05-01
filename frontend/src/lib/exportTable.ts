/**
 * Table export helpers — CSV and XLSX.
 *
 * Both functions take an array of plain rows + the columns to include and
 * trigger a browser download. XLSX uses SheetJS (xlsx); the import is async
 * so the library is code-split into its own chunk and only fetched when
 * the user actually clicks an Excel button.
 *
 * Cell values are stringified defensively — null/undefined become empty,
 * objects are JSON-encoded so nested data still survives the round-trip.
 */

function safeFilename(name: string, ext: string): string {
  const safe = name.replace(/[^A-Za-z0-9._ -]+/g, '_').slice(0, 80) || 'export';
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `${safe}-${stamp}.${ext}`;
}

function cellString(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  try { return JSON.stringify(v); } catch { return String(v); }
}

/**
 * Trigger a CSV download. Includes a UTF-8 BOM so Excel opens accents
 * (é, ñ, ó) correctly when the user double-clicks the file.
 */
export function downloadCsv(
  columns: string[],
  rows: Record<string, unknown>[],
  filenameStub: string = 'export',
): void {
  const header = columns.map((c) => csvCell(c)).join(',');
  const lines = rows.map((r) => columns.map((c) => csvCell(cellString(r[c]))).join(','));
  // U+FEFF BOM — tells Excel "this is UTF-8".
  const body = '﻿' + [header, ...lines].join('\n');
  const blob = new Blob([body], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = safeFilename(filenameStub, 'csv');
  a.click();
  URL.revokeObjectURL(url);
}

function csvCell(s: string): string {
  if (s.includes(',') || s.includes('"') || s.includes('\n') || s.includes('\r')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Trigger a real .xlsx download. Lazy-imports the xlsx library — first
 * call will incur a one-time chunk fetch (~200KB gzipped); subsequent
 * exports in the same session are instant.
 */
export async function downloadXlsx(
  columns: string[],
  rows: Record<string, unknown>[],
  filenameStub: string = 'export',
  sheetName: string = 'Sheet1',
): Promise<void> {
  const XLSX = await import('xlsx');
  // Build the data as array-of-arrays so we control column order regardless
  // of how the row dicts are keyed.
  const aoa: unknown[][] = [columns];
  for (const r of rows) {
    aoa.push(columns.map((c) => {
      const v = r[c];
      // Numbers and dates stay typed so Excel formats them as such.
      if (v == null) return '';
      if (typeof v === 'number' || typeof v === 'boolean') return v;
      if (v instanceof Date) return v;
      if (typeof v === 'string') return v;
      try { return JSON.stringify(v); } catch { return String(v); }
    }));
  }
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  // Auto-size columns based on content (capped to 60 chars).
  const widths = columns.map((c, i) => {
    let max = c.length;
    for (let r = 1; r < aoa.length; r++) {
      const len = String(aoa[r][i] ?? '').length;
      if (len > max) max = len;
    }
    return { wch: Math.min(60, Math.max(8, max + 2)) };
  });
  ws['!cols'] = widths;
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0, 31) || 'Sheet1');
  XLSX.writeFile(wb, safeFilename(filenameStub, 'xlsx'));
}
