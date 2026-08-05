import assert from 'node:assert/strict';

import * as dateTime from '../src/lib/dateTime';

type DatabaseTimeFormatter = (value: string | null | undefined) => string;

const formatDatabaseUtcTime = (dateTime as typeof dateTime & {
  formatDatabaseUtcTime?: DatabaseTimeFormatter;
}).formatDatabaseUtcTime;

assert.ok(formatDatabaseUtcTime, '应提供数据库 UTC 时间格式化函数');
assert.equal(formatDatabaseUtcTime('2026-08-04 10:48:29'), '2026-08-04 18:48:29');
assert.equal(formatDatabaseUtcTime('2026-08-04T16:05:07'), '2026-08-05 00:05:07');
assert.equal(formatDatabaseUtcTime(null), '');

console.log('date time tests passed');
