import test from 'node:test';
import assert from 'node:assert/strict';
import { normaliseProjectUrl } from '../src/sync.js';

const PROJECT = 'https://cxkeraeuvvwdvycesacj.supabase.co';

test('a bare project URL is left alone', () => {
  assert.equal(normaliseProjectUrl(PROJECT), PROJECT);
});

test('the REST endpoint from the dashboard is accepted', () => {
  assert.equal(normaliseProjectUrl(`${PROJECT}/rest/v1/`), PROJECT);
  assert.equal(normaliseProjectUrl(`${PROJECT}/rest/v1`), PROJECT);
});

test('the auth, realtime and storage endpoints are accepted too', () => {
  for (const suffix of ['auth/v1', 'realtime/v1', 'storage/v1']) {
    assert.equal(normaliseProjectUrl(`${PROJECT}/${suffix}/`), PROJECT, suffix);
  }
});

test('trailing slashes and surrounding whitespace go', () => {
  assert.equal(normaliseProjectUrl(`  ${PROJECT}///  `), PROJECT);
});

test('empty input stays empty, so sync simply stays off', () => {
  assert.equal(normaliseProjectUrl(''), '');
  assert.equal(normaliseProjectUrl(undefined), '');
  assert.equal(normaliseProjectUrl(null), '');
});

test('a project whose name happens to contain rest is not truncated', () => {
  const odd = 'https://forest.supabase.co';
  assert.equal(normaliseProjectUrl(odd), odd);
});
