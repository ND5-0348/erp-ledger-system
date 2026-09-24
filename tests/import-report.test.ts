import assert from 'node:assert/strict';
import { issueCsv } from '../src/lib/importReport';
const csv=issueCsv([{row:3,column:'=cmd',reason:' @formula'}, {row:4,column:'金额',reason:'有"引号",\n换行'}]);
assert.ok(csv.startsWith('\uFEFF'));
assert.ok(csv.includes('"\'=cmd"'));
assert.ok(csv.includes('"\' @formula"'));
assert.ok(csv.includes('"有""引号"",\n换行"'));
assert.equal(issueCsv(Array.from({length:52},(_,i)=>({row:i+3,column:'项目编号',reason:'必填'}))).split('\r\n').length,53);
