import assert from 'node:assert/strict';
import { getDashboardMetrics } from '../src/lib/dashboardMetrics';
import { loadAllPages } from '../src/lib/loadAllPages';
import { OrderRecord } from '../src/types';
import { getLedgerStats } from '../src/lib/ledgerStats';
import { ProjectLedger } from '../src/types';
import { applyLedgerFilters, emptyLedgerFilters } from '../src/lib/queryFilterModel';

const row = { projectId: 'P1', orderId: 'O1', department: 'A', orderDate: '2026-09-14',
  orderValue: 100, orderStatus: 'closed' } as OrderRecord;
const stats = getDashboardMetrics({ ledgers: [], orders: [row, {...row, orderStatus: 'open'}], department: 'A' });
assert.equal(stats.totalOrderAmount, 200);
assert.equal(stats.orderCount, 1);
assert.equal(stats.closedCount, 0);
const result = await loadAllPages(async ({offset, limit}) => ({total: 1201,
  items: Array.from({length: Math.min(limit, 1201-offset)}, (_, i) => offset+i)}));
assert.equal(result.items.length, 1201);
assert.equal(new Set(result.items).size, 1201);
await assert.rejects(loadAllPages(async () => ({total: 1, items: []})), /不完整/);

const projects = [
  {id: 'P1', department: 'A', orderAmount: 100, orderStatus: '未关闭'},
  {id: 'P2', department: 'A', orderAmount: 200, orderStatus: '已关闭'},
  {id: 'P3', department: 'B', orderAmount: 500, orderStatus: 'open'},
] as ProjectLedger[];
assert.deepEqual(getLedgerStats(applyLedgerFilters(projects, {...emptyLedgerFilters, department: 'A'})),
  {totalOrderVal: 300, completedCount: 1, inProgressCount: 1});
assert.deepEqual(getLedgerStats([]), {totalOrderVal: 0, completedCount: 0, inProgressCount: 0});
assert.equal(applyLedgerFilters(projects, {...emptyLedgerFilters, orderStatus: 'open'}).length, 2);
