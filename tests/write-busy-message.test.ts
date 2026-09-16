import assert from 'node:assert/strict';

import { ApiError, parseErrorMessage } from '../src/api';

// 普通字符串 detail 保持原样。
assert.equal(parseErrorMessage('{"detail":"项目已存在"}'), '项目已存在');
assert.equal(parseErrorMessage(''), '');
assert.equal(parseErrorMessage('not-json'), 'not-json');
assert.equal(parseErrorMessage('{"detail":[{"msg":"x"}]}'), '{"detail":[{"msg":"x"}]}');

// 写入忙（409 BUSINESS_WRITE_BUSY）返回结构化 detail，界面要展示 message，
// 不能把整段 JSON 丢给用户，也不能丢失“本次未写入”的提示。
const busyBody = JSON.stringify({
  detail: {
    code: 'BUSINESS_WRITE_BUSY',
    message: '另一笔业务写入正在进行，请稍后重试；本次请求未写入任何数据。',
  },
});
assert.equal(
  parseErrorMessage(busyBody),
  '另一笔业务写入正在进行，请稍后重试；本次请求未写入任何数据。',
);

// 结构化 detail 缺少 message 时退回原始 body，避免显示成空字符串。
assert.equal(parseErrorMessage('{"detail":{"code":"X"}}'), '{"detail":{"code":"X"}}');

const error = new ApiError(409, parseErrorMessage(busyBody));
assert.equal(error.status, 409);
assert.equal(error.name, 'ApiError');
assert.match(error.message, /本次请求未写入任何数据/);

console.log('write busy message tests passed');
