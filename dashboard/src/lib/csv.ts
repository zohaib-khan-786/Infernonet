/**
 * CSV, in the browser.
 *
 * Two exports and a rule.
 *
 * The rule: the only exports in this product are ones a person can verify
 * against what is on screen. The service serves exactly one real CSV endpoint
 * — the inventory export — and `inventoryCsvUrl` in `api/endpoints.ts` is used
 * for that, so the file comes from the service and is complete whether or not
 * the browser happened to have the rows loaded.
 *
 * Everything else — the readings window, the filtered event log — is built here,
 * in the page, from the rows it is showing, and the button that triggers it
 * says so in its own label. A CSV that silently covered a different set of rows
 * than the table above it would be a file nobody could trust, and the difference
 * between "this is what I am looking at" and "this is everything the service
 * holds" is the difference between a useful export and a wrong one.
 */
export type CsvValue = string | number | null | undefined;

/** RFC 4180 quoting. `null` and `undefined` become an empty cell, never "0". */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return '';
  const text = typeof value === 'number' ? String(value) : value;
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

export function buildCsv(headers: readonly string[], rows: readonly (readonly CsvValue[])[]): string {
  const lines = [headers.map(csvCell).join(',')];
  for (const row of rows) lines.push(row.map(csvCell).join(','));
  // A BOM so Excel opens UTF-8 item names correctly; RFC 4180 says CRLF, and a
  // spreadsheet is the thing most likely to open the file.
  return `﻿${lines.join('\r\n')}\r\n`;
}

/**
 * Hand a generated file to the browser as a download.
 *
 * The object URL is revoked on the next frame rather than immediately: Safari
 * cancels the download if the URL is gone before it has read it, and the anchor
 * is still in the document at that point.
 */
export function downloadText(filename: string, mime: string, body: string): void {
  const url = URL.createObjectURL(new Blob([body], { type: `${mime};charset=utf-8` }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = 'noopener';
  anchor.hidden = true;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadCsv(filename: string, headers: readonly string[], rows: readonly (readonly CsvValue[])[]): void {
  downloadText(filename, 'text/csv', buildCsv(headers, rows));
}
