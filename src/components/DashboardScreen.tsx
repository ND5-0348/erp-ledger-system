import React, { useState } from 'react';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Calendar,
  CheckCircle2,
  Filter,
  Minus,
  RefreshCw,
  ShoppingCart,
  TrendingDown,
  TrendingUp,
  Wallet,
} from 'lucide-react';
import { OperationLog, OrderRecord, ProjectLedger, ScreenType } from '../types';
import {
  getDashboardDepartments,
  getDashboardLatestModifiedAt,
  getDashboardMetrics,
  getDashboardSalesRanking,
  getDashboardTrendData,
} from '../lib/dashboardMetrics';

interface DashboardScreenProps {
  logs: OperationLog[];
  ledgers: ProjectLedger[];
  orders: OrderRecord[];
  onNavigate: (screen: ScreenType) => void;
}

interface TrendPoint {
  x: number;
  y: number;
}

function money(value: number) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    maximumFractionDigits: 0,
  }).format(value);
}

function compactMoney(value: number) {
  if (Math.abs(value) >= 10000) {
    return `${(value / 10000).toFixed(2)} 万元`;
  }
  return `${value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} 元`;
}

function smoothPath(points: TrendPoint[]) {
  if (points.length === 0) return '';
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  return points.slice(1).reduce((path, point, index) => {
    const previous = points[index];
    const middleX = (previous.x + point.x) / 2;
    return `${path} C ${middleX} ${previous.y}, ${middleX} ${point.y}, ${point.x} ${point.y}`;
  }, `M ${points[0].x} ${points[0].y}`);
}

export default function DashboardScreen({ logs, ledgers, orders, onNavigate }: DashboardScreenProps) {
  const [hoveredTrendIndex, setHoveredTrendIndex] = useState<number | null>(null);
  const [selectedDepartment, setSelectedDepartment] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const departmentOptions = getDashboardDepartments(orders);
  const dashboardFilters = { department: selectedDepartment, startDate, endDate };
  const dashboardMetrics = getDashboardMetrics({ ledgers, orders, ...dashboardFilters });
  const salesRanking = getDashboardSalesRanking(orders, selectedDepartment, startDate, endDate);
  const salesRankingTitle = selectedDepartment ? '三级团队销售订单金额排行' : '部门销售订单金额排行';
  const recentLogs = logs.slice(0, 5);
  const trendData = getDashboardTrendData(orders, dashboardFilters);
  const latestModifiedAt = getDashboardLatestModifiedAt(orders, dashboardFilters);
  const maxTrendValue = Math.max(...trendData.flatMap((item) => [item.orderAmount, item.profit]), 1);
  const toPoint = (value: number, index: number): TrendPoint => ({
    x: trendData.length === 1 ? 300 : (index / (trendData.length - 1)) * 600,
    y: 180 - (Math.max(value, 0) / maxTrendValue) * 150,
  });
  const orderPoints = trendData.map((item, index) => toPoint(item.orderAmount, index));
  const profitPoints = trendData.map((item, index) => toPoint(item.profit, index));
  const orderPath = smoothPath(orderPoints);
  const profitPath = smoothPath(profitPoints);
  const orderAreaPath = orderPoints.length
    ? `${orderPath} L ${orderPoints[orderPoints.length - 1].x} 200 L ${orderPoints[0].x} 200 Z`
    : '';
  const hoveredTrend = hoveredTrendIndex === null ? null : trendData[hoveredTrendIndex];
  const hoveredPoint = hoveredTrendIndex === null ? null : orderPoints[hoveredTrendIndex];
  const tooltipX = hoveredPoint ? Math.min(Math.max(hoveredPoint.x, 88), 512) : 0;
  const tooltipY = hoveredPoint ? Math.max(hoveredPoint.y - 54, 8) : 0;

  const maxRankingAmount = Math.max(...salesRanking.map((item) => item.amount), 1);

  const metrics = [
    { label: '销售订单总金额', value: compactMoney(dashboardMetrics.totalOrderAmount), icon: Wallet, trend: '实时', trendType: 'up' },
    { label: '毛利润', value: compactMoney(dashboardMetrics.grossProfit), icon: TrendingUp, trend: '实时', trendType: 'up' },
    { label: '订单总数', value: `${dashboardMetrics.orderCount.toLocaleString('zh-CN')} 个`, icon: ShoppingCart, trend: '实时', trendType: 'up' },
    { label: '应收账款', value: compactMoney(dashboardMetrics.accountsReceivable), icon: ArrowDownLeft, trend: '实时', trendType: 'down' },
    { label: '应付账款', value: compactMoney(dashboardMetrics.accountsPayable), icon: ArrowUpRight, trend: '实时', trendType: 'flat' },
    { label: '已关闭订单', value: `${dashboardMetrics.closedCount.toLocaleString('zh-CN')} 个`, icon: CheckCircle2, trend: '实时', trendType: 'up' },
  ] as const;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-900 font-sans">仪表盘概览</h1>
          <p className="text-sm text-slate-500 font-sans mt-1">欢迎回来，这是今天的业务实时动态。</p>
        </div>
        <div className="flex flex-wrap items-center gap-3 self-start sm:self-center">
          <label className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg shadow-sm text-xs">
            <Filter className="w-4 h-4 text-blue-600" />
            <span className="font-medium text-slate-500">部门</span>
            <select
              value={selectedDepartment}
              onChange={(event) => setSelectedDepartment(event.target.value)}
              className="bg-transparent outline-none text-slate-800 font-medium cursor-pointer min-w-[92px]"
              aria-label="按部门筛选仪表盘指标"
            >
              <option value="">全部部门</option>
              {departmentOptions.map((department) => (
                <option key={department} value={department}>
                  {department}
                </option>
              ))}
            </select>
          </label>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg shadow-sm text-xs">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="font-medium text-slate-500">订单日期</span>
            <input
              type="date"
              value={startDate}
              onChange={(event) => setStartDate(event.target.value)}
              max={endDate || undefined}
              className="w-[116px] bg-transparent outline-none text-slate-800 font-medium cursor-pointer"
              aria-label="订单日期开始日期"
            />
            <span className="text-slate-400">至</span>
            <input
              type="date"
              value={endDate}
              onChange={(event) => setEndDate(event.target.value)}
              min={startDate || undefined}
              className="w-[116px] bg-transparent outline-none text-slate-800 font-medium cursor-pointer"
              aria-label="订单日期结束日期"
            />
          </div>
          <div className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 text-slate-700 rounded-lg shadow-sm text-xs font-mono" title="当前筛选结果中的数据最新修改时间">
            <Calendar className="w-4 h-4 text-slate-400" />
            <span className="font-sans font-medium text-slate-500">数据最新修改（北京时间）</span>
            <span>{latestModifiedAt || '--'}</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {metrics.map((metric) => {
          const Icon = metric.icon;
          return (
            <div
              key={metric.label}
              className="bg-white border border-slate-200/80 p-4 rounded-xl shadow-sm hover:-translate-y-0.5 transition-all duration-300"
            >
              <div className="flex justify-between items-start mb-2">
                <span className="text-slate-500 font-medium text-xs">{metric.label}</span>
                <div className="p-1.5 bg-blue-50 rounded-lg">
                  <Icon className="w-4 h-4 text-blue-600" />
                </div>
              </div>
              <div className="text-xl font-bold text-slate-900 tracking-tight font-sans">{metric.value}</div>
              <div
                className={`text-xs flex items-center mt-2 font-sans font-medium ${
                  metric.trendType === 'down' ? 'text-emerald-600' : metric.trendType === 'flat' ? 'text-slate-400' : 'text-rose-600'
                }`}
              >
                {metric.trendType === 'down' ? (
                  <TrendingDown className="w-3.5 h-3.5 mr-0.5" />
                ) : metric.trendType === 'flat' ? (
                  <Minus className="w-3.5 h-3.5 mr-0.5" />
                ) : (
                  <TrendingUp className="w-3.5 h-3.5 mr-0.5" />
                )}
                <span>{metric.trend}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 bg-white border border-slate-200 rounded-xl p-6 shadow-sm">
          <div className="flex justify-between items-center mb-6">
            <h3 className="font-semibold text-slate-900 text-sm">订单与毛利润趋势</h3>
            <div className="flex items-center gap-4 text-xs font-medium text-slate-500">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-blue-600 inline-block" />
                <span>订单金额</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-slate-500 border-dashed border-2 inline-block border-slate-500" />
                <span>毛利润</span>
              </div>
            </div>
          </div>

          <div className="relative h-64 w-full">
            <div className="absolute inset-0 flex flex-col justify-between pointer-events-none opacity-30 py-4">
              <div className="border-b border-slate-200 w-full" />
              <div className="border-b border-slate-200 w-full" />
              <div className="border-b border-slate-200 w-full" />
              <div className="border-b border-slate-200 w-full" />
            </div>
            {trendData.length > 0 ? (
              <svg className="w-full h-full overflow-visible" preserveAspectRatio="none" viewBox="0 0 600 200">
                <defs>
                  <linearGradient id="blueGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#1167c9" stopOpacity="0.12" />
                    <stop offset="100%" stopColor="#1167c9" stopOpacity="0" />
                  </linearGradient>
                </defs>
                <path d={orderAreaPath} fill="url(#blueGrad)" />
                <path d={orderPath} fill="none" stroke="#1167c9" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
                <path
                  d={profitPath}
                  fill="none"
                  stroke="#64748b"
                  strokeWidth="2"
                  strokeDasharray="5 5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                {trendData.map((item, index) => {
                  const orderPoint = orderPoints[index];
                  const profitPoint = profitPoints[index];
                  return (
                    <g key={item.month} onMouseEnter={() => setHoveredTrendIndex(index)} onMouseLeave={() => setHoveredTrendIndex(null)}>
                      <circle cx={orderPoint.x} cy={orderPoint.y} r="11" fill="transparent" />
                      <circle cx={profitPoint.x} cy={profitPoint.y} r="11" fill="transparent" />
                      <circle cx={orderPoint.x} cy={orderPoint.y} r="3.8" fill="#1167c9" stroke="#ffffff" strokeWidth="1.5" />
                      <circle cx={profitPoint.x} cy={profitPoint.y} r="3.4" fill="#64748b" stroke="#ffffff" strokeWidth="1.4" />
                    </g>
                  );
                })}
                {hoveredTrend && (
                  <g pointerEvents="none">
                    <rect x={tooltipX - 86} y={tooltipY} width="172" height="48" rx="6" fill="#0f172a" opacity="0.92" />
                    <text x={tooltipX - 74} y={tooltipY + 17} fill="#ffffff" fontSize="10" fontWeight="600">
                      {hoveredTrend.month}
                    </text>
                    <text x={tooltipX - 74} y={tooltipY + 32} fill="#bfdbfe" fontSize="9">
                      订单金额 {compactMoney(hoveredTrend.orderAmount)}
                    </text>
                    <text x={tooltipX + 8} y={tooltipY + 32} fill="#cbd5e1" fontSize="9">
                      毛利润 {compactMoney(hoveredTrend.profit)}
                    </text>
                  </g>
                )}
              </svg>
            ) : (
              <div className="absolute inset-0 flex items-center justify-center text-sm text-slate-400">暂无符合筛选条件的趋势数据</div>
            )}
          </div>

          <div className="flex justify-between mt-4 text-xs font-mono text-slate-400">
            {trendData.length > 0 && trendData.map((item) => <span key={item.month}>{item.month}</span>)}
          </div>
        </div>

        <div className="bg-white border border-slate-200 rounded-xl p-6 shadow-sm flex flex-col justify-between">
          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-5">{salesRankingTitle}</h3>
            <div className="space-y-4">
              {salesRanking.map((item) => (
                <div key={item.label} className="space-y-1.5">
                  <div className="flex justify-between text-xs font-medium gap-3">
                    <span className="text-slate-700 truncate">{item.label}</span>
                    <span className="text-slate-900 font-mono shrink-0">{compactMoney(item.amount)}</span>
                  </div>
                  <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div
                      className="bg-blue-600 h-full rounded-full transition-all duration-500"
                      style={{ width: `${Math.max((item.amount / maxRankingAmount) * 100, 4)}%` }}
                    />
                  </div>
                </div>
              ))}
              {salesRanking.length === 0 && (
                <div className="text-xs text-slate-400 py-4 text-center">
                  {selectedDepartment ? '暂无符合筛选条件的三级团队排行数据' : '暂无符合筛选条件的部门排行数据'}
                </div>
              )}
            </div>
          </div>
          <div className="mt-5 pt-4 border-t border-slate-100 text-center text-xs text-slate-400 font-sans">
            数据来自后端业务台账汇总
          </div>
        </div>
      </div>

      <div className="bg-white border border-slate-200 rounded-xl shadow-sm overflow-hidden">
        <div className="p-5 border-b border-slate-200 flex justify-between items-center">
          <h3 className="font-semibold text-slate-900 text-sm">操作日志</h3>
          <div className="flex items-center gap-2">
            <button className="p-1.5 hover:bg-slate-50 text-slate-500 rounded-lg border border-slate-200 transition-colors">
              <Filter className="w-4 h-4" />
            </button>
            <button className="p-1.5 hover:bg-slate-50 text-slate-500 rounded-lg border border-slate-200 transition-colors">
              <RefreshCw className="w-4 h-4" />
            </button>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-6 py-3 font-medium text-xs text-slate-500">操作人</th>
                <th className="px-6 py-3 font-medium text-xs text-slate-500">操作模块</th>
                <th className="px-6 py-3 font-medium text-xs text-slate-500">详情</th>
                <th className="px-6 py-3 font-medium text-xs text-slate-500">状态</th>
                <th className="px-6 py-3 font-medium text-xs text-slate-500">操作时间</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {recentLogs.map((log) => (
                <tr key={log.id} className="hover:bg-slate-50 transition-colors group">
                  <td className="px-6 py-3.5 text-sm font-medium text-slate-700">{log.user}</td>
                  <td className="px-6 py-3.5 text-sm text-slate-600">{log.module}</td>
                  <td className="px-6 py-3.5 text-sm text-slate-600 max-w-md truncate">{log.details}</td>
                  <td className="px-6 py-3.5">
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/50">
                      {log.status}
                    </span>
                  </td>
                  <td className="px-6 py-3.5 text-xs text-slate-400 font-mono">{log.time}</td>
                </tr>
              ))}
              {recentLogs.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-6 py-8 text-center text-sm text-slate-400">
                    暂无操作日志
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="p-4 bg-slate-50/50 border-t border-slate-100 flex justify-center">
          <button
            onClick={() => onNavigate('system')}
            className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-700 hover:gap-1.5 transition-all"
          >
            <span>查看全部日志</span>
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
