import type { FinancialPhase } from '../types';

export function matchesOrder(item: { orderId: string; orderNumberHistory?: string[] }, query: string) {
  return [item.orderId, ...(item.orderNumberHistory || [])].some(n => n.toLowerCase().includes(query.toLowerCase()));
}
export function matchesManager(item: { manager?: string; managerHistory?: string[] }, query: string, includeHistory?: string) {
  return [item.manager || '', ...(includeHistory === 'true' ? item.managerHistory || [] : [])].some(n => n.toLowerCase().includes(query.toLowerCase()));
}
export function matchedManagers(item: { manager?: string; managerHistory?: string[] }, query: string, includeHistory?: string) {
  return includeHistory === 'true' && query
    ? [...new Set(item.managerHistory || [])].filter(n => n !== item.manager && n.toLowerCase().includes(query.toLowerCase())).join('、') : '';
}
export function phasesInRange(phases: FinancialPhase[], start: string, end: string) {
  return phases.filter(p => p.date && (!start || p.date >= start) && (!end || p.date <= end));
}
