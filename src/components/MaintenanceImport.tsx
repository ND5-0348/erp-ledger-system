import React, { useRef, useState } from 'react';
import { api } from '../api';
import { MaintenanceReport } from '../lib/importReport';
import ImportIssues from './ImportIssues';

export default function MaintenanceImport({ onRefresh }: { onRefresh: () => void }) {
  const [files, setFiles] = useState<string[]>([]);
  const [file, setFile] = useState('');
  const [report, setReport] = useState<MaintenanceReport | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [message, setMessage] = useState('');
  async function run(work: () => Promise<void>) {
    if (working.current) return;
    working.current = true; setBusy(true); setMessage('');
    try { await work(); } catch (error) { setMessage(error instanceof Error ? error.message : '操作失败'); }
    finally { working.current = false; setBusy(false); }
  }
  return <section className="bg-white border border-amber-200 rounded-xl p-6 space-y-4">
    <h2 className="font-bold text-lg">维护：替换全部业务数据</h2>
    <p className="text-sm text-slate-600">将订单、采购、销售及历史记录整体替换为所选文件。账号与操作日志保留。系统先检查文件并创建可校验的业务备份，写入失败时整批回滚。</p>
    <div className="flex flex-wrap gap-3">
      <button disabled={busy} className="border rounded px-3 py-2" onClick={() => run(async () => {
        const result = await api.maintenanceFiles(); setFiles(result.items);
        if (!result.items.length) setMessage('受控导入目录中没有 Excel 文件。请由维护人员将待导入文件放入应用 docs 目录后刷新。');
      })}>读取可用文件</button>
      <select aria-label="维护导入文件" value={file} disabled={busy} className="border rounded px-3 py-2 max-w-full" onChange={e => { setFile(e.target.value); setReport(null); setConfirmation(''); }}>
        <option value="">请选择文件</option>{files.map(name => <option key={name}>{name}</option>)}
      </select>
      <button disabled={busy || !file} className="border rounded px-3 py-2 disabled:opacity-50" onClick={() => run(async () => {
        setReport(null); setConfirmation(''); setReport(await api.previewMaintenance(file));
      })}>{busy ? '处理中…' : '预检文件'}</button>
    </div>
    {report && <div className="space-y-4">
      <dl className="grid sm:grid-cols-2 gap-2 text-sm">
        <div><dt className="text-slate-500">文件</dt><dd>{report.file_name}</dd></div>
        <div><dt className="text-slate-500">布局</dt><dd>{report.layout}</dd></div>
        <div><dt className="text-slate-500">目标数据库</dt><dd>{report.database}</dd></div>
        <div><dt className="text-slate-500">替换范围</dt><dd>现有 {report.current_rows} 条 → 文件 {report.valid_rows} 条；跳过 {report.skipped_rows} 行</dd></div>
        <div className="sm:col-span-2"><dt className="text-slate-500">文件校验摘要（SHA256）</dt><dd className="break-all font-mono text-xs">{report.sha256}</dd></div>
      </dl>
      <ImportIssues issues={report.errors} />
      {report.token && <div className="space-y-2">
        <label className="block text-sm">核对上方文件与范围后，输入“替换全部业务数据”<input aria-label="全量替换确认文字" className="block border rounded px-3 py-2 mt-2 w-full max-w-md" disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label>
        <button className="bg-red-700 text-white px-4 py-2 rounded disabled:opacity-40" disabled={busy || confirmation !== '替换全部业务数据'} onClick={() => run(async () => {
          const token = report.token!;
          // Consume this screen's credential before sending. A lost response
          // must be reconciled through logs and a new preview, never retried.
          setReport({ ...report, token: null });
          const result = await api.replaceMaintenance(file, token, confirmation);
          setConfirmation(''); setMessage(`已完成全量替换：${result.success_rows} 条；批次 ${result.batch_id}；替换前备份 ${result.backup_id}。`); onRefresh();
        })}>确认替换全部业务数据</button>
      </div>}
    </div>}
    {message && <p role="status" className="whitespace-pre-wrap text-sm text-slate-700">{message}</p>}
  </section>;
}
