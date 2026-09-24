import assert from 'node:assert/strict';
import test from 'node:test';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { api, setApiToken } from '../src/api';
import { moneyText } from '../src/lib/importReview';
import SourceLedgerImport, { ImportTotalsView } from '../src/components/SourceLedgerImport';

test('import totals preserve cents beyond JavaScript integer precision', () => {
  assert.equal(moneyText('9999999999999999.99'), '9,999,999,999,999,999.99');
  assert.equal(moneyText('-9200.00'), '-9,200.00');
  assert.equal(moneyText('8.459999999999999'), '8.46');
  assert.equal(moneyText('-8.455'), '-8.46');
  assert.equal(moneyText('999.995'), '1,000.00');
  const html=renderToStaticMarkup(React.createElement(ImportTotalsView,{totals:{line_count:1048,project_count:85,order_count:375,order_amount:'45658614.54',delivery_amount:'44456063.31',invoice_amount:'43320548.98',receipt_amount:'35380198.07'}}));
  assert.match(html,/45,658,614.54/);assert.match(html,/35,380,198.07/);
});

test('wizard starts at file selection and keeps advanced choices out of the main action', () => {
  const html=renderToStaticMarkup(React.createElement(SourceLedgerImport,{onClose:()=>{},onImported:async()=>{},onHistory:()=>{}}));
  assert.match(html,/导入记录/);assert.match(html,/aria-current="step"/);
  assert.match(html,/<details[^>]*><summary[^>]*>高级导入方式/);
  assert.doesNotMatch(html,/确认导入 \d+ 条/);
});

test('duplicate confirmation is sent only when explicitly supplied and preserves file bytes', async () => {
  const original=globalThis.fetch;const calls:RequestInit[]=[];
  globalThis.fetch=(async (_url,init)=>{calls.push(init!);return new Response('{}',{status:200});}) as typeof fetch;
  setApiToken('synthetic');
  try {
    const file=new File(['xlsx bytes'],'台账.xlsx');
    await api.importSource(file,true);await api.importSource(file,false,'reviewed-token');
    assert.equal(calls[0].body,file);assert.equal(calls[1].body,file);
    assert.equal((calls[0].headers as Record<string,string>)['X-Duplicate-Confirmation'],undefined);
    assert.equal((calls[1].headers as Record<string,string>)['X-Duplicate-Confirmation'],'reviewed-token');
  } finally {globalThis.fetch=original;setApiToken('');}
});
