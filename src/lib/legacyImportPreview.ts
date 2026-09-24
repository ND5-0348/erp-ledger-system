export interface PreviewIssue {
  code: string;
  message: string;
  blocking: boolean;
  sheet?: string | null;
  row?: number | null;
  columns: Array<string | number>;
}

export interface PreviewPhase {
  source_group: number;
  source_column?: number | null;
  position?: number;
  date: string | null;
  amount: string | null;
  document_no: string | null;
}

export interface FinanceSource {
  date_column?: number;
  amount_column?: number;
  document_column?: number | null;
  date_raw: string | null;
  amount_raw: string | null;
  document_raw: string | null;
}

export interface PreviewFinance {
  label: string;
  raw_sources: FinanceSource[];
  phases: PreviewPhase[];
  manual?: boolean;
}

export interface RowResolution {
  order_no?: { history: string[] };
  manager?: { history: string[] };
  finance?: Record<string, { phases: PreviewPhase[]; total_correction_reason: string }>;
}

export interface PreviewRow {
  excel_row_no: number;
  parsed: {
    project_code: string | null;
    project_name: string | null;
    goods_name: string | null;
    order_no: { raw: string | null; current: string | null; history: string[] };
    manager: { raw: string | null; current: string | null; history: string[] };
    finance: Record<string, PreviewFinance>;
    issues: PreviewIssue[];
  };
  resolution: (RowResolution & { audit?: { recorded_by: number; recorded_at: string } }) | null;
  resolved_at: string | null;
  effective: {
    order_history: string[];
    manager_history: string[];
    finance: Record<string, PreviewFinance>;
    issues: PreviewIssue[];
  };
}

export interface PreviewSummary {
  total_rows: number;
  blocking_rows: number;
  warning_rows: number;
  multi_value_rows: number;
  comparable: boolean;
  cross_row_issues?: PreviewIssue[];
}

export interface PreviewResult {
  session_id: string;
  success_rows: number;
  skipped_rows: number;
  phases: Record<string, number>;
  history_records: number;
  file_sha256: string;
  already_committed?: boolean;
}

export interface PreviewPage {
  session: {
    id: string;
    status: string;
    source_file_name: string;
    source_sha256: string;
    expires_at: string | null;
    parser_version: string;
    result?: PreviewResult | null;
  };
  summary: PreviewSummary;
  rows: { total: number; items: PreviewRow[] };
}

export interface PreviewCreated {
  session_id: string;
  source_sha256: string;
  expires_at: string;
  parser_version: string;
  summary: PreviewSummary;
}

export interface ResolutionDraft {
  chains: Record<'order_no' | 'manager', { enabled: boolean; history: string[] }>;
  finance: Record<string, {
    enabled: boolean;
    phases: PreviewPhase[];
    total_correction_reason: string;
  }>;
}

export function createResolutionDraft(row: PreviewRow): ResolutionDraft {
  const finance: ResolutionDraft['finance'] = {};
  for (const [name, entry] of Object.entries(row.effective.finance)) {
    finance[name] = {
      enabled: false,
      phases: entry.phases.map(phase => ({ ...phase })),
      total_correction_reason: row.resolution?.finance?.[name]?.total_correction_reason || '',
    };
  }
  return {
    chains: {
      order_no: { enabled: false, history: [...row.effective.order_history] },
      manager: { enabled: false, history: [...row.effective.manager_history] },
    },
    finance,
  };
}

export function excelColumn(column?: number | null): string {
  if (!column || column < 1) return '—';
  let value = column;
  let label = '';
  while (value > 0) {
    value -= 1;
    label = String.fromCharCode(65 + value % 26) + label;
    value = Math.floor(value / 26);
  }
  return label;
}

function validDate(value: string | null): boolean {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4));
  const date = new Date(`${value}T00:00:00Z`);
  return year >= 1 && year <= 2099 && !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}

function moneyCents(value: string | null): bigint | null {
  if (value === null || !/^\d+(\.\d{1,2})?$/.test(value.trim())) return null;
  const [whole, fraction = ''] = value.trim().split('.');
  const cents = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  return cents <= 999999999999999999n ? cents : null;
}

export function phaseTotal(phases: PreviewPhase[], sourceGroup: number): string {
  let total = 0n;
  const group = phases.filter(phase => phase.source_group === sourceGroup);
  if (!group.length) return '未填写';
  for (const phase of group) {
    const cents = moneyCents(phase.amount);
    if (cents === null) return '金额待补齐';
    total += cents;
  }
  return `${total / 100n}.${String(total % 100n).padStart(2, '0')}`;
}

export function buildResolution(row: PreviewRow, draft: ResolutionDraft): RowResolution {
  const result: RowResolution = {};
  for (const name of ['order_no', 'manager'] as const) {
    if (!draft.chains[name].enabled) continue;
    const history = draft.chains[name].history.map(item => item.trim());
    if (!history.length || history.length > 50 || history.some(item => !item)) {
      throw new Error(`${name === 'order_no' ? '订单号' : '客户经理'}请按旧到新填写 1–50 个非空值。`);
    }
    result[name] = { history };
  }
  for (const [name, entry] of Object.entries(draft.finance)) {
    if (!entry.enabled) continue;
    const source = row.parsed.finance[name];
    const label = source.label;
    if (!entry.phases.length || entry.phases.length > 50) throw new Error(`${label}请填写 1–50 期。`);
    if (entry.total_correction_reason.length > 500) throw new Error(`${label}的合计修正理由不能超过 500 字。`);
    const phases = entry.phases.map((phase, index) => {
      if (!Number.isInteger(phase.source_group) || phase.source_group < 1 || phase.source_group > source.raw_sources.length) {
        throw new Error(`${label}第 ${index + 1} 期请选择原表来源列组。`);
      }
      if (!validDate(phase.date)) throw new Error(`${label}第 ${index + 1} 期请填写有效日期（年份不超过 2099）。`);
      if (moneyCents(phase.amount) === null) throw new Error(`${label}第 ${index + 1} 期金额须为非负数、最多两位小数且不超过系统上限。`);
      const document = phase.document_no?.trim() || null;
      if (document && document.length > 128) throw new Error(`${label}第 ${index + 1} 期票据号不能超过 128 字。`);
      // Only send fields accepted by PhaseRevision; keep amounts as decimal strings.
      return { source_group: phase.source_group, date: phase.date, amount: phase.amount!.trim(), document_no: document };
    }).sort((a, b) => a.source_group - b.source_group);
    result.finance ??= {};
    result.finance[name] = { phases, total_correction_reason: entry.total_correction_reason.trim() };
  }
  if (!Object.keys(result).length) throw new Error('请先选择需要修正的字段。');
  return result;
}

export function canCommitPreview(page: PreviewPage | null, state: {
  busy: boolean; dirty: boolean; uncertain: boolean; hasFile: boolean;
}): boolean {
  return Boolean(page && page.session.status === 'pending' && page.summary.total_rows > 0
    && page.summary.comparable && page.summary.blocking_rows === 0
    && !page.summary.cross_row_issues?.some(issue => issue.blocking)
    && !state.busy && !state.dirty && !state.uncertain && state.hasFile);
}

export function validatePreviewFile(file: Pick<File, 'name' | 'size'>): string | null {
  if (!/\.xlsx$/i.test(file.name)) return '请选择 .xlsx 格式的台账文件。';
  if (file.size === 0) return '文件为空，请重新选择。';
  if (file.size > 20 * 1024 * 1024) return '上传文件不能超过 20 MB。';
  return null;
}
