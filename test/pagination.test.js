import assert from 'node:assert/strict';
import test from 'node:test';

import { paginate } from '../src/pagination.js';

test('ban records are paginated at 30 records per page', () => {
  const records = Array.from({ length: 65 }, (_, index) => ({ id: index + 1 }));
  const first = paginate(records, 1, 30);
  const third = paginate(records, 3, 30);
  assert.equal(first.items.length, 30);
  assert.deepEqual(first.items.map((item) => item.id), Array.from({ length: 30 }, (_, index) => index + 1));
  assert.equal(first.totalPages, 3);
  assert.equal(first.total, 65);
  assert.deepEqual(third.items.map((item) => item.id), [61, 62, 63, 64, 65]);
});

test('pagination clamps invalid and out-of-range values', () => {
  const result = paginate([1, 2, 3], 99, 1000);
  assert.equal(result.page, 1);
  assert.equal(result.pageSize, 100);
  assert.deepEqual(result.items, [1, 2, 3]);
});
