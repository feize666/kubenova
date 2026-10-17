import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../src/components/resource-detail/resource-detail-drawer.tsx', import.meta.url), 'utf8');
assert.match(source, /query\.error instanceof Error && !hasDetailData/, 'failed background refresh must not replace cached details');
assert.match(source, /详情刷新失败，当前内容可能已过期/, 'cached details must clearly indicate stale data');
console.log('[check-detail-refresh] PASS: stale details remain visible after refetch failure.');
