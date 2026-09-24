import React, { useState } from 'react';
import { ImportIssue, issueCsv } from '../lib/importReport';

export default function ImportIssues({ issues }: { issues: ImportIssue[] }) {
  const [page, setPage] = useState(0);
  const current = Math.min(page, Math.max(0, Math.ceil(issues.length / 20) - 1));
  const download = () => {
    const url = URL.createObjectURL(new Blob([issueCsv(issues)], { type: 'text/csv;charset=utf-8' }));
    const link = document.createElement('a'); link.href = url; link.download = '导入问题清单.csv'; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  if (!issues.length) return null;
  return <div className="space-y-3">
    <div className="flex justify-between"><strong>发现 {issues.length} 个问题</strong><button type="button" onClick={download} className="text-blue-700">下载完整 CSV</button></div>
    <div className="max-h-80 overflow-auto"><table className="w-full text-left text-sm"><thead><tr><th>行号</th><th>列名</th><th>原因</th></tr></thead><tbody>
      {issues.slice(current * 20, current * 20 + 20).map((issue, index) => <tr key={index} className="border-t"><td className="p-2">{issue.row || '文件'}</td><td className="p-2">{issue.column}</td><td className="p-2 whitespace-pre-wrap">{issue.reason}</td></tr>)}
    </tbody></table></div>
    <div className="flex gap-4"><button type="button" disabled={!current} onClick={() => setPage(current - 1)}>上一页</button><span>{current + 1} / {Math.ceil(issues.length / 20)}</span><button type="button" disabled={(current + 1) * 20 >= issues.length} onClick={() => setPage(current + 1)}>下一页</button></div>
  </div>;
}
