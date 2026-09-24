import React, { useEffect, useRef, useState } from 'react';
import { api } from '../api';
import { ImportBatch, ImportBatchDetail, moneyText } from '../lib/importReview';
import { ImportTotalsView, downloadImportReport } from './SourceLedgerImport';

export default function ImportBatchHistory({ onImported, onBusy }: { onImported: () => Promise<void>; onBusy: (busy: boolean) => void }) {
  const active = useRef(false);
  const [items, setItems] = useState<ImportBatch[]>([]);
  const [offset, setOffset] = useState(0); const [total, setTotal] = useState(0);
  const [detail, setDetail] = useState<ImportBatchDetail | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState('');
  async function load(next = 0) { const data = await api.importBatches(next); setItems(data.items); setTotal(data.total); setOffset(next); }
  const run = async (fn: () => Promise<void>) => { if (active.current) return; active.current=true; setBusy(true); onBusy(true); setMessage('');
    try { await fn(); } catch (e) { setMessage(e instanceof Error ? e.message : '读取失败，请重试'); }
    finally { active.current=false; setBusy(false); onBusy(false); } };
  useEffect(() => { void run(() => load()); }, []);
  return <section className="space-y-4">
    <div className="flex items-center justify-between"><p className="text-sm text-slate-500">共 {total} 个批次，可查看核对记录和撤销条件。</p><button disabled={busy} className="text-blue-700 text-sm" onClick={() => run(() => load(offset))}>刷新记录</button></div>
    {message && <p role="status" className="rounded-lg bg-amber-50 p-3 text-sm">{message}</p>}
    {busy && <p role="status" className="text-sm text-blue-700">正在处理…</p>}
    {!busy && !items.length && <p className="py-10 text-center text-slate-500">暂无可查看的导入记录</p>}
    {items.map(item => <article key={item.id} className="rounded-xl border border-slate-200 p-4 space-y-2">
      <div className="flex flex-wrap justify-between gap-2"><strong className="break-all">{item.source_file_name}</strong><span className="text-sm">{item.status === 'reverted' ? '已撤销' : item.status === 'completed' ? '已完成' : item.status}</span></div>
      <p className="text-xs text-slate-500">批次 {item.id} · {item.imported_by_name || '原系统导入'} · {item.uploaded_at.replace('T', ' ')}</p>
      <p className="text-sm">{item.success_rows} 条明细 · 订单金额 ¥{moneyText(item.summary.order_amount)}{item.summary_is_current && <span className="text-xs text-slate-500">（当前金额）</span>}</p>
      <p className="text-xs break-all text-slate-500">{item.backup_file ? `系统备份 #${item.pre_import_backup_id}：${item.backup_file}` : '历史批次未关联备份；原有备份仍可在系统管理中查询。'}</p>
      <button disabled={busy} className="text-sm text-blue-700" onClick={() => run(async () => { setDetail(await api.importBatch(item.id)); setConfirmation(''); })}>查看明细与撤销条件</button>
    </article>)}
    {total > 20 && <div className="flex justify-between text-sm"><button disabled={busy || offset === 0} onClick={() => run(() => load(offset - 20))}>上一页</button><span>{offset / 20 + 1} / {Math.ceil(total / 20)}</span><button disabled={busy || offset + 20 >= total} onClick={() => run(() => load(offset + 20))}>下一页</button></div>}
    {detail && <section className="rounded-xl border border-blue-200 bg-blue-50/40 p-4 space-y-4">
      <div className="flex justify-between"><h3 className="font-semibold">批次 {detail.id} 核对记录</h3><button disabled={busy} onClick={() => setDetail(null)}>收起</button></div>
      {detail.summary_is_current && <p className="text-sm text-amber-800">该历史批次未保存导入时的金额快照，以下显示当前有效数据。</p>}
      <ImportTotalsView totals={detail.summary} />
      <button className="text-sm text-blue-700" onClick={() => downloadImportReport(detail.source_file_name, detail.summary, detail.warnings)}>下载核对说明</button>
      <p className="text-sm">{detail.undo.message}</p>
      {!!detail.undo.reasons.length && <ul className="space-y-1 text-sm text-amber-800">{detail.undo.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
      {detail.undo.can_revert && <div className="space-y-3 border-t border-blue-200 pt-3">
        <p className="text-sm font-semibold">将撤销本批次 {detail.undo.line_count} 条明细，提交时再次检查后续修改。</p>
        <label className="block text-sm">请输入“撤销批次 {detail.id}”<input className="mt-2 block w-full rounded-lg border border-slate-200 bg-white p-2" value={confirmation} disabled={busy} onChange={e => setConfirmation(e.target.value)} /></label>
        <button className="rounded-lg bg-red-600 px-4 py-2 text-sm text-white disabled:opacity-40" disabled={busy || confirmation !== `撤销批次 ${detail.id}`} onClick={() => run(async () => {
          const result = await api.revertImportBatch(detail.id, detail.undo.token!, confirmation);
          setDetail(null); setConfirmation(''); await load(offset);
          try { await onImported(); } catch { /* Completed undo stays visible in history. */ }
          setMessage(`已撤销 ${result.reverted_rows} 条明细，原文件和备份已保留。`);
        })}>确认撤销本批次</button>
      </div>}
    </section>}
  </section>;
}
