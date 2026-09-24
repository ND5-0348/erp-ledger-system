import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api, setApiToken } from '../src/api';
import { PreviewRowDetails } from '../src/components/LegacyImportPreview';
import {
  buildResolution, canCommitPreview, createResolutionDraft, excelColumn, phaseTotal, validatePreviewFile,
  type PreviewPage, type PreviewRow,
} from '../src/lib/legacyImportPreview';

const row: PreviewRow = {
  excel_row_no: 3,
  parsed: {
    project_code: 'P-SYNTHETIC', project_name: '合成子项目', goods_name: '测试设备',
    order_no: { raw: 'A/B/C', current: 'C', history: ['A', 'B', 'C'] },
    manager: { raw: '甲/乙/甲', current: '甲', history: ['甲', '乙', '甲'] },
    finance: {
      sales_receipt: { label: '销售回款', raw_sources: [
        { date_column: 79, amount_column: 81, document_column: 80, date_raw: '2026/01/01/2026/02/01', amount_raw: '300', document_raw: null },
        { date_column: 83, amount_column: 85, document_column: 84, date_raw: '2026-03-01', amount_raw: '50', document_raw: 'REC-3' },
      ], phases: [] },
      purchase_payment: { label: '采购付款', raw_sources: [{ date_raw: '2026-04-01', amount_raw: '40', document_raw: null }], phases: [
        { source_group: 1, date: '2026-04-01', amount: '40', document_no: null },
      ] },
    }, issues: [{ code: 'AMOUNT_SPLIT_REQUIRED', message: '请人工分摊', blocking: true, columns: ['销售回款'] }],
  },
  resolution: null, resolved_at: null,
  effective: { order_history: ['A', 'B', 'C'], manager_history: ['甲', '乙', '甲'], finance: {}, issues: [] },
};
row.effective.finance = structuredClone(row.parsed.finance);
row.effective.issues = structuredClone(row.parsed.issues);

function editableDraft() {
  const draft = createResolutionDraft(row);
  draft.finance.sales_receipt.enabled = true;
  draft.finance.sales_receipt.phases = [
    { source_group: 1, date: '2026-01-01', amount: '100.00', document_no: 'REC-1', position: 1, source_column: 79 },
    { source_group: 1, date: '2026-02-01', amount: '200.00', document_no: '', position: 2, source_column: 79 },
    { source_group: 2, date: '2026-03-01', amount: '50.00', document_no: 'REC-3', position: 3, source_column: 83 },
  ];
  return draft;
}

test('structured corrections preserve source groups, decimals and unedited groups', () => {
  const draft = editableDraft();
  const resolution = buildResolution(row, draft);
  assert.deepEqual(resolution.finance?.sales_receipt.phases, [
    { source_group: 1, date: '2026-01-01', amount: '100.00', document_no: 'REC-1' },
    { source_group: 1, date: '2026-02-01', amount: '200.00', document_no: null },
    { source_group: 2, date: '2026-03-01', amount: '50.00', document_no: 'REC-3' },
  ]);
  assert.equal(resolution.finance?.purchase_payment, undefined);
  assert.equal(resolution.manager, undefined);
  assert.equal(row.effective.finance.sales_receipt.phases.length, 0);
});

test('chain editor preserves repeat appointments and ordered aliases', () => {
  const draft = createResolutionDraft(row);
  draft.chains.manager.enabled = true;
  draft.chains.order_no.enabled = true;
  const resolution = buildResolution(row, draft);
  assert.deepEqual(resolution.manager?.history, ['甲', '乙', '甲']);
  assert.deepEqual(resolution.order_no?.history, ['A', 'B', 'C']);
  draft.chains.manager.history.push(' ');
  assert.throws(() => buildResolution(row, draft), /非空/);
});

test('financial editor rejects invalid dates, missing split amounts, precision and source mismatches', () => {
  for (const [field, value] of [
    ['date', '2026-02-30'], ['date', '2100-01-01'], ['amount', ''], ['amount', '-1'],
    ['amount', '0.001'], ['amount', '1e5'], ['amount', '10000000000000000.00'], ['source_group', 3],
  ] as const) {
    const draft = editableDraft();
    (draft.finance.sales_receipt.phases[0] as any)[field] = value;
    assert.throws(() => buildResolution(row, draft), undefined, `${field}=${value}`);
  }
  const draft = editableDraft();
  draft.finance.sales_receipt.phases[0].amount = '0';
  assert.equal(buildResolution(row, draft).finance?.sales_receipt.phases[0].amount, '0');
  assert.throws(() => buildResolution(row, createResolutionDraft(row)), /选择/);
});

test('group totals never combine sources or lose cents at maximum precision', () => {
  const draft = editableDraft();
  assert.equal(phaseTotal(draft.finance.sales_receipt.phases, 1), '300.00');
  assert.equal(phaseTotal(draft.finance.sales_receipt.phases, 2), '50.00');
  draft.finance.sales_receipt.phases[0].amount = '9999999999999999.99';
  draft.finance.sales_receipt.phases[1].amount = '0.01';
  assert.equal(phaseTotal(draft.finance.sales_receipt.phases, 1), '10000000000000000.00');
});

test('commit gating uses the complete server summary, status and unsaved/request state', () => {
  const page: PreviewPage = {
    session: { id: 'session', status: 'pending', source_file_name: 'synthetic.xlsx', source_sha256: 'abc', expires_at: null, parser_version: '2' },
    summary: { total_rows: 21, blocking_rows: 0, warning_rows: 0, multi_value_rows: 0, comparable: true },
    rows: { total: 21, items: [] },
  };
  const state = { busy: false, dirty: false, uncertain: false, hasFile: true };
  assert.equal(canCommitPreview(page, state), true);
  for (const status of ['committed', 'expired', 'cancelled']) assert.equal(canCommitPreview({ ...page, session: { ...page.session, status } }, state), false);
  for (const flag of ['busy', 'dirty', 'uncertain']) assert.equal(canCommitPreview(page, { ...state, [flag]: true }), false);
  assert.equal(canCommitPreview(page, { ...state, hasFile: false }), false);
  assert.equal(canCommitPreview(null, state), false);
  assert.equal(canCommitPreview({ ...page, summary: { ...page.summary, blocking_rows: 1 } }, state), false);
  assert.equal(canCommitPreview({ ...page, summary: { ...page.summary, comparable: false } }, state), false);
  assert.equal(canCommitPreview({ ...page, summary: { ...page.summary, total_rows: 0 } }, state), false);
  assert.equal(canCommitPreview({ ...page, summary: { ...page.summary, cross_row_issues: [{ code: 'ORDER_ALIAS_CONFLICT', message: '另一页的冲突', blocking: true, row: 23, columns: [] }] } }, state), false);
});

test('file limits and template column names are explicit', () => {
  assert.equal(validatePreviewFile({ name: 'x.XLSX', size: 20 * 1024 * 1024 }), null);
  assert.ok(validatePreviewFile({ name: 'x.xlsx', size: 0 }));
  assert.ok(validatePreviewFile({ name: 'x.xls', size: 10 }));
  assert.ok(validatePreviewFile({ name: 'x.xlsx', size: 20 * 1024 * 1024 + 1 }));
  assert.equal(excelColumn(79), 'CA');
  assert.equal(excelColumn(83), 'CE');
});

test('rendered details show immutable original cells, current histories and effective issues', () => {
  const html = renderToStaticMarkup(React.createElement(PreviewRowDetails, { row }));
  assert.match(html, /A\/B\/C/);
  assert.match(html, /甲 → 乙 → 甲/);
  assert.match(html, /CA \/ CC \/ CB/);
  assert.match(html, /AMOUNT_SPLIT_REQUIRED/);
  const corrected = structuredClone(row);
  corrected.effective.issues = [];
  corrected.effective.finance.sales_receipt.phases = editableDraft().finance.sales_receipt.phases;
  const correctedHtml = renderToStaticMarkup(React.createElement(PreviewRowDetails, { row: corrected }));
  assert.doesNotMatch(correctedHtml, /AMOUNT_SPLIT_REQUIRED/);
  assert.match(correctedHtml, /REC-3/);
  assert.match(correctedHtml, /2026\/01\/01\/2026\/02\/01/);
});

test('API sends original binary to create/commit and JSON only to resolutions', async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  setApiToken('synthetic-test-token');
  try {
    const file = new File(['synthetic'], '旧台账.xlsx');
    await api.createLegacyPreview(file);
    await api.getLegacyPreview('session/one', 20, 20);
    await api.resolveLegacyPreview('session/one', [{ excel_row_no: 3, resolution: buildResolution(row, editableDraft()) }]);
    await api.commitLegacyPreview('session/one', file);
    assert.equal(calls[0].init.body, file);
    assert.match(calls[0].url, /filename=/);
    assert.match(calls[1].url, /session%2Fone\?offset=20&limit=20$/);
    assert.equal(calls[2].init.method, 'PUT');
    assert.equal(JSON.parse(String(calls[2].init.body)).items[0].resolution.finance.sales_receipt.phases.length, 3);
    assert.equal(calls[3].init.body, file);
    assert.match(calls[3].url, /session%2Fone\/commit$/);
    assert.equal((calls[3].init.headers as Record<string, string>).Authorization, 'Bearer synthetic-test-token');
  } finally { globalThis.fetch = originalFetch; setApiToken(''); }
});
