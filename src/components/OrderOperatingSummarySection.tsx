import React from 'react';
import { ChevronRight } from 'lucide-react';
import { ProjectOrderSummary } from '../lib/projectOrderSummary';

interface OrderOperatingSummarySectionProps {
  title: string;
  sectionId: string;
  variant: 'all' | 'sales' | 'purchase' | 'payments';
  rows: ProjectOrderSummary[];
  expandedRows: Set<string>;
  onToggle: (sectionId: string, orderId: string) => void;
}

const columnsByVariant = {
  all: [
    { key: 'salesOrderAmount', label: 'A销售订单金额' },
    { key: 'purchaseAmount', label: 'A含税采购金额' },
    { key: 'deliveryValue', label: 'B交付价值' },
    { key: 'deliveryCost', label: 'B交付成本' },
    { key: 'receiptAmount', label: 'D回款金额' },
    { key: 'paymentAmount', label: 'D付款金额' },
    { key: 'invoiceAmount', label: 'E发票金额' },
    { key: 'receivedInvoiceAmount', label: 'E收票金额' },
  ],
  sales: [
    { key: 'salesOrderAmount', label: 'A销售订单金额' },
    { key: 'deliveryValue', label: 'B交付价值' },
    { key: 'receiptAmount', label: 'D回款金额' },
    { key: 'invoiceAmount', label: 'E发票金额' },
  ],
  purchase: [
    { key: 'purchaseAmount', label: 'A含税采购金额' },
    { key: 'deliveryCost', label: 'B交付成本' },
    { key: 'paymentAmount', label: 'D付款金额' },
    { key: 'receivedInvoiceAmount', label: 'E收票金额' },
  ],
  payments: [
    { key: 'receiptAmount', label: 'D回款金额' },
    { key: 'paymentAmount', label: 'D付款金额' },
  ],
} as const;

function formatMoney(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value || 0));
}

export default function OrderOperatingSummarySection({
  title,
  sectionId,
  variant,
  rows,
  expandedRows,
  onToggle,
}: OrderOperatingSummarySectionProps) {
  const amountColumns = columnsByVariant[variant];
  return (
    <section>
      <h3 className="text-sm font-bold text-slate-900 mb-3">{title}</h3>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="w-full table-fixed text-left" style={{ minWidth: `${330 + amountColumns.length * 190}px` }}>
          <thead className="bg-slate-50 text-xs text-slate-500">
            <tr>
              <th className="px-4 py-2 font-semibold w-[200px]">订单号</th>
              <th className="px-4 py-2 font-semibold w-[130px]">订单日期</th>
              {amountColumns.map((column) => (
                <th key={column.key} className="px-4 py-2 font-semibold text-right w-[190px]">
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={2 + amountColumns.length} className="px-4 py-6 text-center text-xs text-slate-400">暂无订单记录</td>
              </tr>
            ) : (
              rows.map((item) => {
                const expandedKey = `${sectionId}:${item.orderId}`;
                const expanded = expandedRows.has(expandedKey);
                return (
                  <React.Fragment key={expandedKey}>
                    <tr
                      className="text-xs text-slate-700 cursor-pointer hover:bg-blue-50/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-500"
                      role="button"
                      tabIndex={0}
                      aria-expanded={expanded}
                      aria-label={`${expanded ? '收起' : '展开'}${title}订单 ${item.orderId} 的货物明细`}
                      title={expanded ? '点击收起货物明细' : '点击展开货物明细'}
                      onClick={() => onToggle(sectionId, item.orderId)}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault();
                          onToggle(sectionId, item.orderId);
                        }
                      }}
                    >
                      <td className="px-4 py-2 font-mono text-blue-600">
                        <span className="inline-flex items-center gap-2">
                          <ChevronRight className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-90' : ''}`} />
                          {item.orderId}
                        </span>
                      </td>
                      <td className="px-4 py-2 font-mono">{item.orderDate || '-'}</td>
                      {amountColumns.map((column) => (
                        <td key={column.key} className="px-4 py-2 text-right font-mono">
                          ¥{formatMoney(item[column.key])}
                        </td>
                      ))}
                    </tr>
                    {expanded && (
                      <tr>
                        <td colSpan={2 + amountColumns.length} className="p-3 bg-slate-50/80">
                          <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white">
                            <table className="w-full table-fixed text-left" style={{ minWidth: `${750 + amountColumns.length * 190}px` }}>
                              <thead className="bg-slate-100 text-[11px] text-slate-500">
                                <tr>
                                  <th className="px-3 py-2 font-semibold w-[260px]">物资/服务名称</th>
                                  <th className="px-3 py-2 font-semibold w-[160px]">规格型号</th>
                                  <th className="px-3 py-2 font-semibold w-[110px]">数量</th>
                                  <th className="px-3 py-2 font-semibold w-[220px]">采购厂商</th>
                                  {amountColumns.map((column) => (
                                    <th key={column.key} className="px-3 py-2 font-semibold text-right w-[190px]">
                                      {column.label}
                                    </th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody className="divide-y divide-slate-100">
                                {item.lines.map((line) => (
                                  <tr key={`${expandedKey}:${line.id}`} className="text-[11px] text-slate-700">
                                    <td className="px-3 py-2 whitespace-normal break-words">{line.goodsName}</td>
                                    <td className="px-3 py-2 whitespace-normal break-words">{line.specModel}</td>
                                    <td className="px-3 py-2">{line.quantity}</td>
                                    <td className="px-3 py-2 whitespace-normal break-words">{line.supplier}</td>
                                    {amountColumns.map((column) => (
                                      <td key={column.key} className="px-3 py-2 text-right font-mono">
                                        ¥{formatMoney(line[column.key])}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}
