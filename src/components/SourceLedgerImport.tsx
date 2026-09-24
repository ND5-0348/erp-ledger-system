import React, { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../api';
import { validatePreviewFile } from '../lib/legacyImportPreview';
import { ImportIssue, issueCsv } from '../lib/importReport';
import { ImportTotals, SourceImportResult, moneyText } from '../lib/importReview';
import ImportIssues from './ImportIssues';
import ImportBatchHistory from './ImportBatchHistory';

export function ImportTotalsView({ totals }: { totals: ImportTotals }) {
  return <div className="space-y-3">
    <p className="text-sm"><strong>{totals.project_count}</strong> 个项目 · <strong>{totals.order_count}</strong> 个订单 · <strong>{totals.line_count}</strong> 条明细</p>
    <dl className="grid grid-cols-1 gap-3 sm:grid-cols-2">{([
      ['销售订单金额', totals.order_amount], ['交付收入', totals.delivery_amount], ['开票金额', totals.invoice_amount], ['回款合计', totals.receipt_amount],
    ] as const).map(([label, value]) => <div key={label} className="rounded-lg border border-slate-200 bg-white p-3"><dt className="text-xs text-slate-500">{label}（元）</dt><dd className="mt-1 break-all text-lg font-semibold tabular-nums">{moneyText(value)}</dd></div>)}</dl>
  </div>;
}

export function downloadImportReport(name: string, totals: ImportTotals | null, warnings: SourceImportResult['warnings'], errors: ImportIssue[] = [], duplicates?: SourceImportResult['duplicates']) {
  const rows: ImportIssue[] = [{ row: 0, column: '文件', reason: name }];
  if (totals) rows.push(...Object.entries({ 项目数:totals.project_count,订单数:totals.order_count,明细数:totals.line_count,销售订单金额:totals.order_amount,交付收入:totals.delivery_amount,开票金额:totals.invoice_amount,回款合计:totals.receipt_amount }).map(([column,value]) => ({row:0,column,reason:String(value)})));
  rows.push(...warnings.map(w => ({row:w.row,column:`需注意 · ${w.field}`,reason:w.message})), ...errors.map(e => ({...e,column:`无法导入 · ${e.column}`})));
  if (duplicates) for (const d of duplicates.rows) rows.push({row:d.row,column:'疑似重复',reason:`${d.project_code} / ${d.order_no} / ${d.goods_name}，本次金额 ${d.order_amount}；已有 ${d.match_count} 条；`+d.matches.map(m => `批次 ${m.import_batch_id} 第 ${m.excel_row_no} 行，${m.source_file_name}，金额 ${m.order_value}`).join('；')});
  const url = URL.createObjectURL(new Blob([issueCsv(rows)], {type:'text/csv;charset=utf-8'}));
  const link = document.createElement('a'); link.href=url; link.download='台账导入核对说明.csv'; link.click(); setTimeout(() => URL.revokeObjectURL(url),1000);
}

export default function SourceLedgerImport({ onClose, onImported, onHistory, onDirectImport }: {
  onClose: () => void; onImported: () => Promise<void>; onHistory?: () => void; onDirectImport?: React.ChangeEventHandler<HTMLInputElement>;
}) {
  const dialog=useRef<HTMLDialogElement>(null); const active=useRef(false);
  const [tab,setTab]=useState<'upload'|'history'>('upload');
  const [file,setFile]=useState<File|null>(null); const [result,setResult]=useState<SourceImportResult|null>(null);
  const [busy,setBusy]=useState(false); const [historyBusy,setHistoryBusy]=useState(false);
  const [error,setError]=useState(''); const [errors,setErrors]=useState<ImportIssue[]>([]);
  const [uncertain,setUncertain]=useState(false); const [keepDuplicates,setKeepDuplicates]=useState(false);
  const locked=busy || historyBusy;
  const step=result ? (result.preview ? 1 : 2) : 0;
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => { if (!locked && !uncertain) return; const protect=(e:BeforeUnloadEvent) => {e.preventDefault();e.returnValue='';}; window.addEventListener('beforeunload',protect);return () => window.removeEventListener('beforeunload',protect); },[locked,uncertain]);
  async function run(preview:boolean) {
    if (!file || active.current || uncertain) return;
    active.current=true;setBusy(true);setError('');setErrors([]);
    if (preview) {setResult(null);setKeepDuplicates(false);}
    try {
      const next=await api.importSource(file,preview,!preview && keepDuplicates ? result?.duplicates.confirmation_token || undefined : undefined);
      setResult(next);
      if (!preview) try {await onImported();} catch {setError('导入已成功，列表刷新失败，请刷新页面；无需再次导入。');}
    } catch (e) {
      if (!preview && (!(e instanceof ApiError) || e.status>=500)) {setUncertain(true);setError('提交结果尚未确认，请核对导入批次，勿重复提交。');}
      else {setError(e instanceof Error ? e.message : '读取文件失败，请重试');setErrors(e instanceof ApiError ? e.report?.errors || [] : []);if (!preview) {setResult(null);setKeepDuplicates(false);}}
    } finally {active.current=false;setBusy(false);}
  }
  async function checkStatus() {
    if (!result || active.current) return;
    active.current=true;setBusy(true);
    try {const status=await api.importStatus(result.source_sha256);if(status.items.length){setResult({...result,preview:false,batch_id:status.items[0].id});setUncertain(false);setError('');await onImported();}else setError(status.message);}
    catch {setError('暂时无法核对，请稍后重试。');} finally {active.current=false;setBusy(false);}
  }
  const button='rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm disabled:opacity-40 disabled:cursor-not-allowed';
  return <dialog ref={dialog} aria-labelledby="source-import-title" onCancel={e => {e.preventDefault();if (!locked) onClose();}} className="m-auto w-[min(940px,96vw)] max-h-[94vh] rounded-2xl p-0 shadow-2xl backdrop:bg-slate-900/50">
    <div className="flex max-h-[94vh] flex-col">
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 p-5"><div><h2 id="source-import-title" className="text-xl font-semibold">导入台账</h2><p className="mt-1 text-sm text-slate-500">先核对数量与金额，再写入业务台账。</p></div><button className={button} disabled={locked} onClick={onClose}>关闭</button></header>
      <nav aria-label="导入功能" className="flex gap-5 border-b border-slate-200 px-5">{([['upload','导入文件'],['history','导入记录']] as const).map(([key,label]) => <button key={key} disabled={locked} aria-pressed={tab===key} onClick={() => setTab(key)} className={`border-b-2 py-3 text-sm ${tab===key?'border-blue-600 font-semibold text-blue-700':'border-transparent text-slate-500'}`}>{label}</button>)}</nav>
      <div className="overflow-y-auto p-5 space-y-5">
        {tab==='history' ? <ImportBatchHistory onImported={onImported} onBusy={setHistoryBusy} /> : <>
          <ol aria-label="导入步骤" className="grid grid-cols-3 gap-2 text-sm">{['选择文件','预览核对','导入完成'].map((label,i) => <li key={label} aria-current={step===i?'step':undefined} className={`rounded-lg px-3 py-2 ${step===i?'bg-blue-50 font-semibold text-blue-700':'bg-slate-50 text-slate-500'}`}>{i+1}. {label}</li>)}</ol>
          {step===0 && <section className="rounded-xl border border-dashed border-blue-300 bg-blue-50/30 p-5 space-y-3">
            <label className="block font-semibold text-sm">选择业务台账文件<input className="mt-3 block max-w-full text-sm" type="file" accept=".xlsx" disabled={locked || uncertain} onChange={e => {const selected=e.target.files?.[0];if(!selected)return;const invalid=validatePreviewFile(selected);setError(invalid||'');setErrors([]);setFile(invalid?null:selected);setResult(null);setKeepDuplicates(false);}} /></label>
            <p className="text-sm text-slate-500">自动识别新版和原版台账，支持 .xlsx，最大 20 MB。</p>
            <p className="text-xs text-slate-500">保留各行编号、经理和归属。金额不擅自分摊，提交前自动备份，任何一行失败都不写入本批数据。</p>
          </section>}
          {file && <p className="break-all text-sm text-slate-600">文件：{file.name}{result?.layout && ` · 已识别：${result.layout}`}</p>}
          {busy && <p role="status" className="rounded-lg bg-blue-50 p-3 text-sm text-blue-700">{result?.preview?'正在备份并导入，请勿重复提交…':'正在核对格式、金额和疑似重复明细，请稍候…'}</p>}
          {result && <>
            <p role="status" className="font-semibold text-emerald-800">{result.preview?'格式和业务校验通过，请核对以下汇总。':`已成功导入 ${result.success_rows} 条明细，批次 ${result.batch_id}。`}</p>
            <ImportTotalsView totals={result.summary} />
            {result.duplicates.within_file_rows>0 && <p className="text-sm text-amber-800">文件内有 {result.duplicates.within_file_rows} 行具有相同业务特征，将按原表分别保留。</p>}
            {result.duplicates.count>0 && <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 space-y-3"><h3 className="font-semibold text-amber-900">{result.duplicates.count} 行与已有记录疑似重复</h3><p className="text-sm">请核对是否为新的业务记录。相同项目、订单、物资、规格、数量、单价与采购厂商会触发提醒，不自动删除任何行。</p>
              <div className="max-h-56 space-y-3 overflow-y-auto text-sm">{result.duplicates.rows.slice(0,50).map(d => <div key={d.row} className="border-t border-amber-200 pt-2"><p>本次第 {d.row} 行 · {d.order_no} · {d.goods_name} · ¥{moneyText(d.order_amount)}</p>{d.matches.map(m => <p key={m.order_line_id} className="text-slate-600">已有批次 {m.import_batch_id} 第 {m.excel_row_no} 行 · {m.account_manager} · ¥{moneyText(m.order_value)} · {m.source_file_name}</p>)}</div>)}</div>
              {result.duplicates.count>50 && <p className="text-xs">页面展示前50行，可下载完整说明。</p>}
              {result.preview && <label className="flex items-start gap-2 text-sm font-semibold"><input type="checkbox" checked={keepDuplicates} disabled={busy} onChange={e=>setKeepDuplicates(e.target.checked)} />我已核对，确认这些是需要保留的业务记录，继续导入全部明细</label>}
            </section>}
            {!!result.warnings.length && <details className="rounded-xl border border-amber-200 p-4"><summary className="cursor-pointer text-sm font-semibold text-amber-800">可以导入，{result.warnings.length} 处需注意</summary><p className="my-2 text-xs text-slate-500">下列原文或合计金额会完整保留。</p><ul className="max-h-48 overflow-y-auto space-y-2 text-sm">{result.warnings.slice(0,100).map((w,i)=><li key={i}>第 {w.row} 行 · {w.field}：{w.message}</li>)}</ul>{result.warnings.length>100 && <p className="mt-2 text-xs">页面展示前100项，可下载完整说明。</p>}</details>}
            <button className="text-sm text-blue-700" onClick={()=>downloadImportReport(file?.name || '',result.summary,result.warnings,[],result.duplicates)}>下载完整核对说明</button>
          </>}
          {error && <section role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-3"><h3 className="font-semibold text-red-800">{uncertain?'待确认导入结果':step===2?'导入后提示':'本次未完成导入'}</h3><p className="whitespace-pre-wrap text-sm text-red-800">{error}</p><ImportIssues issues={errors} /><button className="text-sm text-blue-700" onClick={()=>downloadImportReport(file?.name||'',null,[],errors.length?errors:[{row:0,column:'文件',reason:error}])}>下载问题说明</button></section>}
          {uncertain && result && <button className={button} disabled={busy} onClick={checkStatus}>核对导入结果</button>}
          {step===0 && !uncertain && <details className="border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm text-slate-500">高级导入方式</summary><div className="mt-3 space-y-3 text-sm"><p className="text-slate-500">仅在需要确认历史改号、交接，或导入各字段均为单值的文件时使用。</p>{onHistory && <button disabled={locked} className={button} onClick={onHistory}>历史变更预检</button>}{onDirectImport && <label className="block">直接追加（单值）<input disabled={locked} type="file" accept=".xlsx" onChange={onDirectImport} className="mt-2 block max-w-full text-sm" /></label>}</div></details>}
        </>}
      </div>
      {tab==='upload' && <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-slate-200 bg-white p-5"><p className="text-xs text-slate-500">{step===2?'原文件、备份和核对记录已保留。':'预检不会写入业务数据。'}</p><div className="flex gap-2">{step===0?<button className={`${button} !bg-blue-600 text-white`} disabled={!file || locked || uncertain} onClick={()=>run(true)}>下一步：预览核对</button>:step===1?<><button className={button} disabled={locked || uncertain} onClick={()=>{setResult(null);setKeepDuplicates(false);setError('');}}>返回选择</button><button className={`${button} !bg-blue-600 text-white`} disabled={locked || uncertain || (!!result?.duplicates.count && !keepDuplicates)} onClick={()=>run(false)}>确认导入 {result?.success_rows} 条</button></>:<button className={`${button} !bg-blue-600 text-white`} onClick={onClose}>完成</button>}</div></footer>}
    </div>
  </dialog>;
}
