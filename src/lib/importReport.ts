export interface ImportIssue { row: number; column: string; reason: string }
export interface MaintenanceReport {
  file_name: string; sha256: string; database: string; data_epoch: number;
  total_rows: number; valid_rows: number; skipped_rows: number; error_count: number;
  current_rows: number; layout: string; errors: ImportIssue[]; token: string | null;
}
export function issueCsv(issues: ImportIssue[]): string {
  const cell = (value: unknown) => {
    const text = String(value ?? '');
    return `"${(/^[\s]*[=+@-]/.test(text) ? "'" + text : text).replaceAll('"', '""')}"`;
  };
  return '\uFEFF' + [['行号','列名','原因'], ...issues.map(i => [i.row, i.column, i.reason])]
    .map(row => row.map(cell).join(',')).join('\r\n');
}
