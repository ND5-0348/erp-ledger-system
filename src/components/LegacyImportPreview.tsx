import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import {
  buildResolution, canCommitPreview, createResolutionDraft, excelColumn, phaseTotal, validatePreviewFile,
  type PreviewIssue, type PreviewPage, type PreviewResult, type PreviewRow, type ResolutionDraft,
} from '../lib/legacyImportPreview';

const PAGE_SIZE = 20;
const button = 'rounded-lg border border-slate-300 px-3 py-2 text-sm hover:bg-slate-100 disabled:opacity-40 disabled:cursor-not-allowed';
const input = 'w-full rounded border border-slate-300 px-2 py-1.5 text-sm bg-white';
const display = (value: unknown) => value === null || value === undefined || value === '' ? '—' : String(value);
const message = (error: unknown) => error instanceof Error ? error.message : '请求失败，请稍后重新读取。';

export function PreviewIssues({ issues }: { issues: PreviewIssue[] }) {
  if (!issues.length) return null;
  return <ul className="space-y-2 text-sm">
    {issues.map((issue, index) => <li key={`${issue.code}-${index}`} className={issue.blocking ? 'text-red-700' : 'text-amber-800'}>
      <strong>{issue.blocking ? '阻断' : '提示'}{issue.row ? ` · 第 ${issue.row} 行` : ''}</strong>
      {issue.columns.length > 0 && <span> · {issue.columns.join('、')}</span>}：{issue.message}
      <span className="ml-2 text-xs text-slate-500">{issue.code}</span>
    </li>)}
  </ul>;
}

export function PreviewRowDetails({ row }: { row: PreviewRow }) {
  return <div className="space-y-4 text-sm">
    <div className="grid gap-3 md:grid-cols-2">
      {(['order_no', 'manager'] as const).map(name => {
        const history = name === 'order_no' ? row.effective.order_history : row.effective.manager_history;
        return <div key={name} className="rounded-lg bg-slate-50 p-3 break-words">
          <h4 className="font-semibold">{name === 'order_no' ? '订单号' : '客户经理'}</h4>
          <p className="mt-1 text-slate-500 whitespace-pre-wrap">原值：{display(row.parsed[name].raw)}</p>
          <p>当前值：{display(history.at(-1))}</p>
          <p>历史（旧 → 新）：{history.join(' → ') || '—'}</p>
        </div>;
      })}
    </div>
    {Object.entries(row.effective.finance).map(([name, entry]) => <section key={name} className="space-y-2">
      <h4 className="font-semibold">{entry.label}{entry.manual ? ' · 已人工修正' : ''}</h4>
      {entry.raw_sources.map((source, index) => <div key={index} className="rounded bg-slate-50 p-2 text-xs whitespace-pre-wrap break-words">
        来源 {index + 1}（{excelColumn(source.date_column)} / {excelColumn(source.amount_column)} / {excelColumn(source.document_column)} 列）：
        日期原值「{display(source.date_raw)}」 · 金额原值「{display(source.amount_raw)}」 · 票据原值「{display(source.document_raw)}」
      </div>)}
      <div className="overflow-x-auto"><table className="w-full min-w-[480px] text-left text-sm">
        <thead className="bg-slate-100"><tr>{['期次', '来源', '日期', '金额（元）', '票据／凭证号'].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{entry.phases.map((phase, index) => <tr key={index} className="border-b border-slate-100">
          <td className="p-2">{index + 1}</td><td className="p-2">{phase.source_group}</td>
          <td className="p-2">{display(phase.date)}</td><td className="p-2 tabular-nums">{display(phase.amount)}</td>
          <td className="p-2 break-all">{display(phase.document_no)}</td>
        </tr>)}</tbody>
      </table></div>
      {!entry.phases.length && <p className="text-amber-800">尚未得到可用期次，请根据原值逐期填写。</p>}
    </section>)}
    <PreviewIssues issues={row.effective.issues} />
    {row.resolved_at && <p className="text-xs text-slate-500">最近确认：{row.resolved_at.replace('T', ' ')} · 操作者编号 {display(row.resolution?.audit?.recorded_by)}</p>}
  </div>;
}

function ResolutionEditor({ row, draft, onChange, onSave, onCancel, busy }: {
  row: PreviewRow; draft: ResolutionDraft; onChange: (value: ResolutionDraft) => void;
  onSave: () => void; onCancel: () => void; busy: boolean;
}) {
  const setFinance = (name: string, value: Partial<ResolutionDraft['finance'][string]>) =>
    onChange({ ...draft, finance: { ...draft.finance, [name]: { ...draft.finance[name], ...value } } });
  return <fieldset disabled={busy} className="mt-4 space-y-4 rounded-xl border border-blue-200 bg-blue-50/50 p-4">
    <legend className="px-2 font-semibold text-blue-900">人工修正 · 第 {row.excel_row_no} 行</legend>
    <p className="text-xs text-slate-600">仅修改勾选的字段。日期、金额、票据逐期填写；多日期对应一个合计时，请自行确认分摊金额。保存后由系统重新校验。</p>
    {(['order_no', 'manager'] as const).map(name => <div key={name}>
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={draft.chains[name].enabled}
        onChange={event => onChange({ ...draft, chains: { ...draft.chains, [name]: { ...draft.chains[name], enabled: event.target.checked } } })} />
        修正{name === 'order_no' ? '订单号历史' : '客户经理历史'}</label>
      {draft.chains[name].enabled && <div className="mt-2 space-y-2">
        <p className="text-xs text-slate-600">从旧到新排列，最后一项为当前值。既有订单改号或项目交接仍须通过独立授权流程。</p>
        {draft.chains[name].history.map((value, index) => <div key={index} className="flex gap-2">
          <input className={input} aria-label={`${name === 'order_no' ? '订单号' : '客户经理'}历史第 ${index + 1} 项`} value={value}
            onChange={event => onChange({ ...draft, chains: { ...draft.chains, [name]: { ...draft.chains[name], history: draft.chains[name].history.map((item, i) => i === index ? event.target.value : item) } } })} />
          <button type="button" className={button} onClick={() => onChange({ ...draft, chains: { ...draft.chains, [name]: { ...draft.chains[name], history: draft.chains[name].history.filter((_, i) => i !== index) } } })}>移除</button>
        </div>)}
        <button type="button" className={button} disabled={draft.chains[name].history.length >= 50}
          onClick={() => onChange({ ...draft, chains: { ...draft.chains, [name]: { ...draft.chains[name], history: [...draft.chains[name].history, ''] } } })}>添加历史项</button>
      </div>}
    </div>)}
    {Object.entries(draft.finance).map(([name, entry]) => <section key={name} className="space-y-3 border-t border-blue-100 pt-3">
      <label className="flex items-center gap-2 text-sm font-semibold"><input type="checkbox" checked={entry.enabled}
        onChange={event => setFinance(name, { enabled: event.target.checked })} />修正{row.parsed.finance[name].label}</label>
      {entry.enabled && <>
        {entry.phases.map((phase, index) => <div key={index} className="grid gap-2 rounded bg-white p-3 md:grid-cols-[110px_1fr_1fr_1fr_auto]">
          <label className="text-xs">第 {index + 1} 期来源<select className={input} value={phase.source_group} onChange={event => setFinance(name, { phases: entry.phases.map((item, i) => i === index ? { ...item, source_group: Number(event.target.value) } : item) })}>
            {row.parsed.finance[name].raw_sources.map((source, i) => <option key={i} value={i + 1}>来源 {i + 1} · {excelColumn(source.date_column)} 列</option>)}
          </select></label>
          {(['date', 'amount', 'document_no'] as const).map(key => <label key={key} className="text-xs">
            {key === 'date' ? '日期' : key === 'amount' ? '金额（元）' : '票据／凭证号（可空）'}
            <input className={input} type={key === 'date' ? 'date' : 'text'} max={key === 'date' ? '2099-12-31' : undefined}
              inputMode={key === 'amount' ? 'decimal' : undefined} maxLength={key === 'document_no' ? 128 : undefined}
              aria-label={`${row.parsed.finance[name].label}第 ${index + 1} 期${key === 'date' ? '日期' : key === 'amount' ? '金额' : '票据号'}`}
              value={phase[key] ?? ''} onChange={event => setFinance(name, { phases: entry.phases.map((item, i) => i === index ? { ...item, [key]: event.target.value } : item) })} />
          </label>)}
          <button type="button" className={button} onClick={() => setFinance(name, { phases: entry.phases.filter((_, i) => i !== index) })}>移除本期</button>
        </div>)}
        <div className="flex flex-wrap gap-2">
          {row.parsed.finance[name].raw_sources.map((source, i) => <button type="button" key={i} className={button} disabled={entry.phases.length >= 50}
            onClick={() => setFinance(name, { phases: [...entry.phases, { source_group: i + 1, date: '', amount: '', document_no: null }] })}>为来源 {i + 1} 添加一期</button>)}
        </div>
        {row.parsed.finance[name].raw_sources.map((source, i) => <p key={i} className="text-xs text-slate-600">
          来源 {i + 1} · 原金额：{display(source.amount_raw)} · 本组修正合计：{phaseTotal(entry.phases, i + 1)} 元
        </p>)}
        <label className="block text-sm">原合计修正理由（仅原合计本身有误时填写）
          <textarea className={input} rows={2} maxLength={500} value={entry.total_correction_reason}
            onChange={event => setFinance(name, { total_correction_reason: event.target.value })} />
        </label>
      </>}
    </section>)}
    <div className="flex gap-2"><button type="button" className={`${button} bg-blue-600 text-white hover:bg-blue-700`} onClick={onSave}>保存修正并重新校验</button>
      <button type="button" className={button} onClick={onCancel}>放弃本次修正</button></div>
  </fieldset>;
}

export default function LegacyImportPreview({ onClose, onImported }: {
  onClose: () => void; onImported: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const activeRequest = useRef(false);
  const refreshedSession = useRef('');
  const [file, setFile] = useState<File | null>(null);
  const [sessionId, setSessionId] = useState('');
  const [page, setPage] = useState<PreviewPage | null>(null);
  const [offset, setOffset] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [uncertain, setUncertain] = useState(false);
  const [result, setResult] = useState<PreviewResult | null>(null);
  const [editing, setEditing] = useState<{ row: PreviewRow; draft: ResolutionDraft } | null>(null);
  const [discardPrompt, setDiscardPrompt] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (!editing && !busy && !uncertain) return;
    const protectInput = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', protectInput);
    return () => window.removeEventListener('beforeunload', protectInput);
  }, [editing, busy, uncertain]);

  async function refreshImported(id: string) {
    if (refreshedSession.current === id) return;
    try { await onImported(); refreshedSession.current = id; }
    catch { setNotice('导入已成功，但列表刷新失败。请关闭预检后刷新列表，无需重复导入。'); }
  }

  async function run(action: () => Promise<void>) {
    if (activeRequest.current) return;
    activeRequest.current = true;
    setBusy(true); setError(''); setNotice('');
    try { await action(); } catch (cause) { setError(message(cause)); }
    finally { activeRequest.current = false; setBusy(false); }
  }

  async function read(id: string, nextOffset = offset) {
    const next = await api.getLegacyPreview(id, nextOffset, PAGE_SIZE);
    setPage(next); setSessionId(next.session.id); setOffset(nextOffset);
    if (next.session.status === 'committed') {
      setResult(next.session.result ?? null); setUncertain(false);
      await refreshImported(next.session.id);
    }
    return next;
  }

  const close = () => {
    if (busy) return;
    if (editing) { setDiscardPrompt(true); return; }
    onClose();
  };

  const start = () => run(async () => {
    if (!file) throw new Error('请先选择文件。');
    const invalid = validatePreviewFile(file);
    if (invalid) throw new Error(invalid);
    const created = await api.createLegacyPreview(file);
    setSessionId(created.session_id);
    await read(created.session_id, 0);
  });

  const save = () => run(async () => {
    if (!editing || !page) return;
    const resolution = buildResolution(editing.row, editing.draft);
    await api.resolveLegacyPreview(page.session.id, [{ excel_row_no: editing.row.excel_row_no, resolution }]);
    setEditing(null);
    // Stale pre-save summaries must not enable commit if the subsequent read fails.
    setPage(null);
    await read(page.session.id);
    setNotice('修正已保存，并已重新校验整份文件。');
  });

  const commit = () => run(async () => {
    if (!page || !file || !canCommitPreview(page, { busy: false, dirty: !!editing, uncertain, hasFile: true })) return;
    let committed: PreviewResult;
    try { committed = await api.commitLegacyPreview(page.session.id, file); }
    catch (cause) {
      if (!(cause instanceof ApiError) || cause.status >= 500) {
        setUncertain(true);
        throw new Error('提交结果尚未确认，请保留此会话并点击“重新读取结果”。不要重新上传创建另一批导入。');
      }
      setPage(null);
      throw cause;
    }
    setResult(committed);
    setPage({ ...page, session: { ...page.session, status: 'committed', result: committed } });
    await refreshImported(page.session.id);
  });

  const blocked = !canCommitPreview(page, { busy, dirty: !!editing, uncertain, hasFile: !!file });
  return <dialog ref={dialog} aria-labelledby="legacy-preview-title" onCancel={event => { event.preventDefault(); close(); }}
    className="fixed inset-0 m-auto w-[min(1200px,96vw)] max-h-[94vh] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/50 text-slate-800">
    <div className="flex max-h-[94vh] flex-col">
      <header className="flex items-start justify-between border-b border-slate-200 p-5">
        <div><h2 id="legacy-preview-title" className="text-xl font-bold">台账导入预检</h2>
          <p className="mt-1 text-sm text-slate-500">核对历史信息与多期流水，处理阻断问题后整批导入。</p></div>
        <button type="button" className={button} disabled={busy} onClick={close}>关闭</button>
      </header>
      <div className="space-y-4 overflow-y-auto p-5">
        <div className="rounded-xl border border-slate-200 p-4 space-y-3">
          <label className="block text-sm font-semibold">{sessionId ? '原预检文件（提交时再次核对内容）' : '选择业务台账文件'}
            <input type="file" accept=".xlsx" className="mt-2 block max-w-full text-sm" disabled={busy || !!editing || !!result}
              onChange={event => { const selected = event.target.files?.[0]; if (!selected) return;
                const invalid = validatePreviewFile(selected); setError(invalid || ''); setFile(invalid ? null : selected); }} />
          </label>
          <p className="text-xs text-slate-500">支持 0916 新版 92 列模板（交付应收款、开票应收款）及原版 91 列模板，最大 20 MB、20,000 行。日期可用逗号、分号或换行分隔，金额按期次用斜杠、分号或换行分隔。预检不写入业务数据；原文件只在当前页面内存中保留。</p>
          {!sessionId && <button type="button" className={`${button} bg-blue-600 text-white hover:bg-blue-700`} disabled={busy || !file} onClick={start}>开始预检</button>}
          <div className="flex flex-wrap items-end gap-2">
            <label className="min-w-0 flex-1 text-xs">预检会话编号（可复制保存，用于重新读取）
              <input className={input} value={sessionId} readOnly={!!page} disabled={busy || !!editing}
                onChange={event => setSessionId(event.target.value.trim())} placeholder="可粘贴已有会话编号" /></label>
            <button type="button" className={button} disabled={busy || !!editing || !sessionId}
              onClick={() => run(async () => { await read(sessionId); })}>重新读取结果</button>
          </div>
        </div>
        {busy && <p role="status" className="text-sm text-blue-700">正在处理，请稍候…</p>}
        {notice && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-800">{notice}</p>}
        {discardPrompt && <div role="alert" className="rounded-lg bg-amber-50 p-3 text-sm">
          <p>还有未保存的修正，关闭后这些输入会丢失。已保存的预检会话仍可凭编号读取。</p>
          <div className="mt-2 flex gap-2"><button className={button} type="button" onClick={() => setDiscardPrompt(false)}>继续编辑</button>
            <button className={button} type="button" onClick={onClose}>放弃输入并关闭</button></div>
        </div>}
        {page && <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[[page.summary.total_rows, '预检行数'], [page.summary.blocking_rows, '阻断行数'], [page.summary.warning_rows, '提示行数'], [page.summary.multi_value_rows, '历史多值行数']].map(([value, label]) =>
              <div key={label} className="rounded-xl bg-slate-50 p-3"><div className="text-2xl font-bold tabular-nums">{value}</div><div className="text-xs text-slate-500">{label}</div></div>)}
          </div>
          <p className="text-xs text-slate-500 break-all">文件：{page.session.source_file_name} · 有效期至：{page.session.expires_at?.replace('T', ' ')}<br />文件校验值：{page.session.source_sha256}</p>
          <PreviewIssues issues={page.summary.cross_row_issues || []} />
          {page.session.status === 'expired' && <p role="alert" className="text-red-700 text-sm">会话已过期，请关闭后重新预检。</p>}
          {page.session.status === 'committed' && <p role="status" className="rounded-xl bg-emerald-50 p-4 text-emerald-900">
            已完成整批导入{result ? `：成功 ${result.success_rows} 行，跳过 ${result.skipped_rows} 行；写入 ${Object.values<number>(result.phases).reduce((sum, count) => sum + count, 0)} 条财务期次。` : '。请刷新业务列表核对。'}
          </p>}
          {page.rows.items.map(row => <section key={row.excel_row_no} className="rounded-xl border border-slate-200">
            <button type="button" className="flex w-full items-center justify-between gap-3 p-4 text-left hover:bg-slate-50"
              aria-expanded={expanded === row.excel_row_no || editing?.row.excel_row_no === row.excel_row_no}
              onClick={() => setExpanded(expanded === row.excel_row_no ? null : row.excel_row_no)}>
              <span><strong>第 {row.excel_row_no} 行</strong> · {row.parsed.project_code} · {row.parsed.project_name} · {row.parsed.goods_name}</span>
              <span className={`shrink-0 text-xs ${row.effective.issues.some(issue => issue.blocking) ? 'text-red-700' : 'text-slate-500'}`}>
                {row.effective.issues.some(issue => issue.blocking) ? '有阻断问题' : row.effective.issues.length ? '有提示' : '查看详情'}</span>
            </button>
            {(expanded === row.excel_row_no || editing?.row.excel_row_no === row.excel_row_no) && <div className="border-t border-slate-100 p-4">
              <PreviewRowDetails row={row} />
              {editing?.row.excel_row_no === row.excel_row_no ? <ResolutionEditor row={row} draft={editing.draft} busy={busy}
                onChange={draft => setEditing({ row, draft })} onSave={save} onCancel={() => setEditing(null)} />
                : page.session.status === 'pending' && <button type="button" className={`${button} mt-4`} disabled={busy || !!editing || uncertain}
                  onClick={() => setEditing({ row, draft: createResolutionDraft(row) })}>人工修正此行</button>}
            </div>}
          </section>)}
          <div className="flex items-center justify-between text-sm">
            <span>第 {Math.floor(offset / PAGE_SIZE) + 1} / {Math.max(1, Math.ceil(page.rows.total / PAGE_SIZE))} 页 · 共 {page.rows.total} 行</span>
            <div className="flex gap-2"><button type="button" className={button} disabled={busy || !!editing || offset === 0}
              onClick={() => run(async () => { await read(sessionId, Math.max(0, offset - PAGE_SIZE)); })}>上一页</button>
              <button type="button" className={button} disabled={busy || !!editing || offset + PAGE_SIZE >= page.rows.total}
                onClick={() => run(async () => { await read(sessionId, offset + PAGE_SIZE); })}>下一页</button></div>
          </div>
        </>}
      </div>
      <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white p-5">
        {error && <p role="alert" className="w-full rounded-lg bg-red-50 p-3 text-sm text-red-800 whitespace-pre-wrap break-words">{error}</p>}
        <p className="max-w-2xl text-xs text-slate-500">{uncertain ? '提交结果未确认，请重新读取当前会话结果。' : editing ? '请先保存或放弃本次修正。' : '需整份文件通过校验。提交前自动备份，任一业务行失败则整批回滚；提示项请展开核对。'}</p>
        <button type="button" className={`${button} bg-blue-600 text-white hover:bg-blue-700`} disabled={blocked} onClick={commit}>
          {page?.session.status === 'committed' ? '已导入' : '确认整批导入'}
        </button>
      </footer>
    </div>
  </dialog>;
}
