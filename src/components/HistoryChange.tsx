import { useEffect, useRef, useState } from 'react';
import { api, editingApi, combineEditContexts, HistoryContext } from '../api';
import type { OrderRecord } from '../types';

export default function HistoryChange({ orders, mode, onClose, onSaved }: {
  orders: OrderRecord[]; mode: 'rename' | 'transfer'; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const running = useRef(false);
  const unique = [...new Map(orders.map(o => [JSON.stringify([o.projectId,o.orderId]),o])).values()];
  const [numbers, setNumbers] = useState(() => unique.map(o => o.orderId));
  const [context, setContext] = useState<HistoryContext | null>(null);
  const [manager, setManager] = useState('');
  const [department, setDepartment] = useState('');
  const [branch, setBranch] = useState('');
  const [team, setTeam] = useState('');
  const [date, setDate] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const first = orders[0]?.orderLineId;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    if (mode !== 'transfer' || !first) return;
    let disposed = false;
    api.history(first).then(data => {
      if (disposed) return;
      setContext(data); setManager(data.current.account_manager || '');
      setDepartment(data.current.department || ''); setBranch(data.current.branch_company || ''); setTeam(data.current.team_level3_name || '');
    }).catch(e => { if (!disposed) setError(e.message); });
    return () => { disposed = true; };
  }, [mode, first]);
  async function save() {
    if (running.current || done) return;
    running.current=true; setBusy(true); setError('');
    try {
      if (mode === 'rename') {
        const items = unique.map((o,i) => ({order_line_id:o.orderLineId!,expected_order_no:o.orderId,order_no:numbers[i].trim(),reason:reason.trim()}));
        await editingApi(combineEditContexts(unique.map(o=>o.editContext))).renameOrders(items);
      } else if (context) {
        const c=context.current;
        await editingApi(context.edit_context).transferProject({order_line_id:first,expected:{account_manager:c.account_manager,department:c.department,branch_company:c.branch_company,team_level3_name:c.team_level3_name},account_manager:manager,department,branch_company:branch || null,team_level3_name:team || null,effective_from:date || null,reason:reason.trim()});
      } else return;
      setDone(true);
      try { await onSaved(); } catch { setError('变更已保存，列表刷新失败。请关闭后刷新列表。'); }
    } catch (e) { setError(e instanceof Error ? e.message : '保存失败，请核对当前状态后再操作'); }
    finally { running.current=false;setBusy(false); }
  }
  const input='w-full border border-slate-300 rounded px-3 py-2 text-sm';
  return <dialog ref={dialog} onCancel={e => {e.preventDefault(); if (!busy) onClose();}} className="w-[min(680px,95vw)] max-h-[90vh] rounded-xl p-0 backdrop:bg-black/40">
    <form onSubmit={e => {e.preventDefault();void save();}} className="p-6 space-y-4">
      <h2 className="text-lg font-semibold">{mode === 'rename' ? '变更订单号' : '框架整体交接'}</h2>
      {mode === 'rename' ? <><p className="text-sm text-slate-600">共 {unique.length} 个订单；所有子项目及明细保留原关联，历史编号仍可查询。任一冲突则整批不修改。</p>
        {unique.map((o,i) => <label className="block text-sm" key={o.orderLineId}>{o.projectId} · 当前 {o.orderId}<input className={input} required maxLength={64} disabled={busy || done} value={numbers[i]} onChange={e=>setNumbers(n=>n.map((v,j)=>i===j?e.target.value:v))} /></label>)}</>
        : context ? <><p className="text-sm text-slate-600">框架 {context.current.project_code} 下的全部 {context.affected_lines} 条明细一起交接。</p>
          <p className="text-sm">负责人历史：{context.managers.map(m=>m.manager_name).join(' → ') || context.current.account_manager || '—'}</p>
          {([['客户经理',manager,setManager],['部门',department,setDepartment],['分公司',branch,setBranch],['三级团队',team,setTeam]] as const).map(([label,value,set])=><label className="block text-sm" key={label}>{label}<input className={input} value={value} required={label==='客户经理'||label==='部门'} maxLength={64} disabled={busy||done} onChange={e=>set(e.target.value)} /></label>)}
          <label className="block text-sm">生效日期（未知可留空）<input type="date" max="2099-12-31" className={input} value={date} disabled={busy||done} onChange={e=>setDate(e.target.value)} /></label>
        </> : <p>正在读取框架归属…</p>}
      <label className="block text-sm">变更原因<textarea className={input} required maxLength={500} value={reason} disabled={busy||done} onChange={e=>setReason(e.target.value)} /></label>
      {error && <p role="alert" className="text-red-700 text-sm">{error}</p>}
      {done && <p role="status" className="text-green-700">变更已保存，历史记录已保留。</p>}
      <div className="flex justify-end gap-3"><button type="button" disabled={busy} onClick={onClose} className="border rounded px-4 py-2">关闭</button><button type="submit" disabled={busy||done||!reason.trim()||(mode==='transfer'&&!context)} className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50">{busy?'正在保存…':'确认变更'}</button></div>
    </form>
  </dialog>;
}
