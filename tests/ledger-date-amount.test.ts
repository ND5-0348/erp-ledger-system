import assert from 'node:assert/strict';
import { getLedgerStats } from '../src/lib/ledgerStats';
import { emptyLedgerFilters } from '../src/lib/queryFilterModel';
import { OrderRecord, ProjectLedger, SalesRecord } from '../src/types';

const projects = [{id: 'P1', orderAmount: 600, orderStatus: 'open'}] as ProjectLedger[];
const orders = [
  {orderLineId: 1, projectId: 'P1', orderId: 'O1', orderDate: '2026-09-14', orderValue: 100},
  {orderLineId: 2, projectId: 'P1', orderId: 'O2', orderDate: '2026-09-15', orderValue: 200},
  {orderLineId: 3, projectId: 'P1', orderId: 'O2', orderDate: '2026-09-15', orderValue: 300},
  {orderLineId: 4, projectId: 'P2', orderId: 'O3', orderDate: '2026-09-14', orderValue: 900},
] as OrderRecord[];
const sales = [
  {orderLineId: 1, projectId: 'P1', invoiceDates: ['2026-09-16', '2026-09-17'], invoiceAmount: 20},
  {orderLineId: 2, projectId: 'P1', invoiceDates: ['2026-09-14'], invoiceAmount: 30},
] as SalesRecord[];
function amount(filters: Partial<typeof emptyLedgerFilters>) {
  return getLedgerStats(projects, {orders, sales, filters: {...emptyLedgerFilters, ...filters}}).totalOrderVal;
}
assert.equal(amount({startDate: '2026-09-14', endDate: '2026-09-14'}), 100);
assert.equal(amount({invoiceStartDate: '2026-09-14', invoiceEndDate: '2026-09-14'}), 200);
assert.equal(amount({invoiceStartDate: '2026-09-16', invoiceEndDate: '2026-09-17'}), 100);
assert.equal(amount({startDate: '2026-09-14', invoiceStartDate: '2026-09-14', invoiceEndDate: '2026-09-14'}), 200);
assert.equal(amount({endDate: '2026-09-14', invoiceStartDate: '2026-09-14', invoiceEndDate: '2026-09-14'}), 0);
assert.equal(amount({startDate: '2026-09-18'}), 0);
assert.equal(amount({}), 600);
assert.equal(getLedgerStats([], {orders, sales, filters: {...emptyLedgerFilters, startDate: '2026-09-14'}}).totalOrderVal, 0);
