import assert from 'node:assert/strict';
import test from 'node:test';
import { BackendBatchEditorColumn } from '../src/api';
import {
  buildBasicInformationPayload,
  buildPurchaseInformationPayload,
  buildSalesInformationPayload,
  copyEditorSelection,
  createBlankEditorRow,
  editableEditorRowsMatch,
  editorCellKey,
  normalizeEditorValue,
  pasteGrid,
  pasteGridToEditorSelection,
  selectEditorCellRectangle,
} from '../src/lib/batchOrderEditor';

const columns: BackendBatchEditorColumn[] = [
  { excel_column: 'A', label: '全额/净额', key: 'amount_type', value_type: 'text', editable: true, required: false },
  { excel_column: 'B', label: '项目编号', key: 'project_code', value_type: 'text', editable: true, required: true },
  { excel_column: 'C', label: '订单日期', key: 'order_date', value_type: 'date', editable: true, required: false },
  { excel_column: 'D', label: '订单价值', key: 'order_value', value_type: 'number', editable: true, required: true },
  { excel_column: 'X', label: '采购厂商', key: null, value_type: 'text', editable: false, required: false },
];

test('blank online row follows the A-column default and keeps other cells empty', () => {
  assert.deepEqual(createBlankEditorRow(columns), ['全额', null, null, null, null]);
});

test('Excel paste expands new rows but never writes read-only columns', () => {
  const rows = [createBlankEditorRow(columns)];
  const pasted = pasteGrid(rows, '净额\tP-001\t2026/7/26\t1,130\t不应写入\n全额\tP-002\t2026-07-27\t226\t仍不应写入', 0, 0, columns, true);
  assert.equal(pasted.length, 2);
  assert.deepEqual(pasted[0], ['净额', 'P-001', '2026/7/26', '1,130', null]);
  assert.deepEqual(pasted[1], ['全额', 'P-002', '2026-07-27', '226', null]);
});

test('payload mapping follows column keys and normalizes dates and financial numbers', () => {
  const payload = buildBasicInformationPayload(columns, ['全额', 'AH-001', '2026/7/26', '¥1,130.00', '只读']);
  assert.deepEqual(payload, {
    amount_type: '全额',
    project_code: 'AH-001',
    order_date: '2026-07-26',
    order_value: '1130.00',
  });
});

test('required and percentage validation return field-level Chinese errors', () => {
  assert.throws(
    () => buildBasicInformationPayload(columns, ['全额', '', '2026-07-26', '1130', null]),
    /B列“项目编号”为必填项/,
  );
  const percentage: BackendBatchEditorColumn = {
    excel_column: 'S',
    label: '销售税率',
    key: 'sales_tax_rate',
    value_type: 'percentage',
    editable: true,
    required: false,
  };
  assert.equal(normalizeEditorValue(percentage, '13%'), '13');
  assert.equal(
    normalizeEditorValue(
      { ...columns[3], excel_column: 'W' },
      '9,999,999,999,999,999.99',
    ),
    '9999999999999999.99',
  );
});

test('purchase payload follows X-BO keys and excludes automatic readonly columns', () => {
  const purchaseColumns: BackendBatchEditorColumn[] = [
    { excel_column: 'X', label: '采购厂商', key: 'supplier_name', value_type: 'text', editable: true, required: false },
    { excel_column: 'Y', label: '采购税率', key: 'purchase_tax_rate', value_type: 'percentage', editable: true, required: false },
    { excel_column: 'Z', label: '不含税采购单价', key: 'purchase_unit_price_no_tax', value_type: 'number', editable: true, required: false },
    { excel_column: 'BA', label: '待入账金额', key: 'pending_booked_amount', value_type: 'number', editable: false, required: false },
    { excel_column: 'BO', label: '毛利率', key: 'gross_profit_margin_no_tax', value_type: 'percentage', editable: false, required: false },
  ];
  assert.deepEqual(
    buildPurchaseInformationPayload(
      purchaseColumns,
      ['采购厂商甲', '13%', '1,234.567890', '999.00', '50%'],
    ),
    {
      supplier_name: '采购厂商甲',
      purchase_tax_rate: '13',
      purchase_unit_price_no_tax: '1234.567890',
    },
  );
});

test('sales payload follows BP-CM keys and excludes CI-CJ automatic columns', () => {
  const salesColumns: BackendBatchEditorColumn[] = [
    { excel_column: 'BP', label: '合同签订日期', key: 'contract_signed_date', value_type: 'date', editable: true, required: false },
    { excel_column: 'BR', label: '合同价值', key: 'sales_contract_value', value_type: 'number', editable: true, required: false },
    { excel_column: 'CD', label: '回款占比', key: 'receipt1_ratio', value_type: 'percentage', editable: true, required: false },
    { excel_column: 'CI', label: '回款合计', key: 'total_received', value_type: 'number', editable: false, required: false },
    { excel_column: 'CJ', label: '应收款', key: 'accounts_receivable', value_type: 'number', editable: false, required: false },
    { excel_column: 'CK', label: '是否关闭', key: 'close_status', value_type: 'text', editable: true, required: false },
    { excel_column: 'CL', label: '人工成本', key: 'labor_cost', value_type: 'number', editable: true, required: false },
  ];
  assert.deepEqual(
    buildSalesInformationPayload(
      salesColumns,
      ['2026/7/26', '1,130.00', '35.398230%', '400.00', '730.00', '进行中', '12.34'],
    ),
    {
      contract_signed_date: '2026-07-26',
      sales_contract_value: '1130.00',
      receipt1_ratio: '35.398230',
      close_status: '进行中',
      labor_cost: '12.34',
    },
  );
});

test('dirty-row comparison ignores formatting-only differences and detects editable changes', () => {
  const before = ['全额', 'AH-001', '2026-07-26', 1130, null];
  const formattingOnly = ['全额', 'AH-001', '2026/7/26', '1,130.00', '只读变化'];
  const changed = ['全额', 'AH-002', '2026-07-26', '1130', null];

  assert.equal(editableEditorRowsMatch(columns, before, formattingOnly), true);
  assert.equal(editableEditorRowsMatch(columns, before, changed), false);
});

test('cell selection creates Excel-style rectangles and supports additive ranges', () => {
  const firstRange = selectEditorCellRectangle(
    new Set(),
    { rowIndex: 0, columnIndex: 1 },
    { rowIndex: 1, columnIndex: 3 },
  );
  assert.equal(firstRange.size, 6);
  assert.ok(firstRange.has(editorCellKey({ rowIndex: 0, columnIndex: 1 })));
  assert.ok(firstRange.has(editorCellKey({ rowIndex: 1, columnIndex: 3 })));

  const additive = selectEditorCellRectangle(
    firstRange,
    { rowIndex: 3, columnIndex: 5 },
    { rowIndex: 3, columnIndex: 6 },
    'add',
  );
  assert.equal(additive.size, 8);

  const removed = selectEditorCellRectangle(
    additive,
    { rowIndex: 0, columnIndex: 2 },
    { rowIndex: 1, columnIndex: 2 },
    'remove',
  );
  assert.equal(removed.size, 6);
  assert.equal(removed.has(editorCellKey({ rowIndex: 0, columnIndex: 2 })), false);
});

test('copy serializes a rectangular selection in visible-column order', () => {
  const selection = selectEditorCellRectangle(
    new Set(),
    { rowIndex: 0, columnIndex: 0 },
    { rowIndex: 1, columnIndex: 1 },
  );
  const text = copyEditorSelection(
    [
      ['全额', 'P-001', null, null, null],
      ['净额', 'P-002', null, null, null],
    ],
    selection,
    [1, 0],
  );

  assert.equal(text, 'P-001\t全额\nP-002\t净额');
});

test('pasting one copied cell fills every editable cell in a multi-selection', () => {
  const selection = new Set([
    editorCellKey({ rowIndex: 0, columnIndex: 1 }),
    editorCellKey({ rowIndex: 1, columnIndex: 1 }),
    editorCellKey({ rowIndex: 1, columnIndex: 2 }),
  ]);
  const rows = [
    ['全额', 'P-001', '2026-07-26', '10', null],
    ['全额', 'P-002', '2026-07-27', '20', null],
  ];
  const pasted = pasteGridToEditorSelection(
    rows,
    '批量值',
    selection,
    [0, 1, 4],
    columns,
    false,
  );

  assert.deepEqual(pasted, [
    ['全额', '批量值', '2026-07-26', '10', null],
    ['全额', '批量值', '2026-07-27', '20', null],
  ]);
});

test('pasting a grid into one selected cell follows visible columns and can add rows', () => {
  const rows = [createBlankEditorRow(columns)];
  const pasted = pasteGridToEditorSelection(
    rows,
    'P-001\t2026-07-26\nP-002\t2026-07-27',
    new Set([editorCellKey({ rowIndex: 0, columnIndex: 1 })]),
    [0, 1, 2, 3, 4],
    columns,
    true,
  );

  assert.equal(pasted.length, 2);
  assert.deepEqual(pasted[0], ['全额', 'P-001', '2026-07-26', null, null]);
  assert.deepEqual(pasted[1], ['全额', 'P-002', '2026-07-27', null, null]);
});
