import assert from 'node:assert/strict';
import { test } from 'node:test';
import { matchesOrder, matchedManagers } from '../src/lib/historyQuery';
import { applyOrderFilters, applySalesFilters, applyPurchaseFilters, emptyOrderFilters, emptySalesFilters, emptyPurchaseFilters } from '../src/lib/queryFilterModel';

test('aliases find the same row and history manager is opt-in', () => {
  const base = {projectId:'P', orderId:'C', orderNumberHistory:['A','B','C'], manager:'甲', managerHistory:['甲','乙','甲'], department:'D',contractNo:'X'};
  assert.equal(matchesOrder(base,'A'),true);
  const order = {...base,orderDate:'2026-01-01',goodsName:'设备',quantity:'1',orderValue:100,deliveredQty:0,businessType:'销售',clientUnit:'客户'};
  assert.equal(applyOrderFilters([order],{...emptyOrderFilters,orderId:'B'}).length,1);
  const sale = {...base,contractDate:'',contractValue:100,invoiceAmount:30,totalReceived:30,receiptDate:'2026-02-01',receiptPhases:[{date:'2026-01-01',amount:10},{date:'2026-02-01',amount:20}]};
  assert.equal(applySalesFilters([sale],{...emptySalesFilters,manager:'乙'}).length,0);
  const result=applySalesFilters([sale],{...emptySalesFilters,manager:'乙',includeHistoryManager:'true',receiptStartDate:'2026-01-01',receiptEndDate:'2026-01-01'});
  assert.equal(result.length,1); assert.equal(result[0].totalReceived,'10.00'); assert.equal(sale.totalReceived,30);
  assert.equal(matchedManagers(base,'乙','true'),'乙');
  const purchase={...base,supplier:'S',contractAmount:100,invoiceAmount:50,paymentAmount:50,paymentDate:'2026-02-01',paymentPhases:[{date:'2026-01-01',amount:30},{date:'2026-02-01',amount:20}]};
  assert.equal(applyPurchaseFilters([purchase],{...emptyPurchaseFilters,paymentStartDate:'2026-01-01',paymentEndDate:'2026-01-01'})[0].paymentAmount,'30.00');
});
