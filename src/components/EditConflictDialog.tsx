import { useEffect, useRef } from 'react';

export default function EditConflictDialog() {
  const dialog=useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const show=() => { if (!dialog.current?.open) dialog.current?.showModal(); };
    window.addEventListener('erp:edit-conflict',show);
    return () => window.removeEventListener('erp:edit-conflict',show);
  },[]);
  return <dialog ref={dialog} className="w-[min(480px,95vw)] p-6 rounded-xl backdrop:bg-black/40">
    <h2 className="font-semibold text-lg">数据已更新，本次没有保存</h2>
    <p className="my-4 text-sm text-slate-600">其他操作已修改或恢复这份数据。你的输入仍保留在编辑器中，可以返回核对、复制需要保留的内容，再重新加载。</p>
    <div className="flex flex-wrap gap-3"><button className="border rounded px-3 py-2" onClick={()=>dialog.current?.close()}>返回编辑，保留输入</button><button className="bg-blue-600 text-white rounded px-3 py-2" onClick={()=>window.location.reload()}>丢弃输入并重新加载</button></div>
  </dialog>;
}
