import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
for(const path of ['cluster-workspace-shell.tsx','shell-layout.tsx']){
  const source = readFileSync(new URL(`../src/components/${path}`, import.meta.url), 'utf8');
  assert.doesNotMatch(source, /window\.location\.reload\(/, `${path}: refresh must preserve mounted page state`);
  assert.match(source, /usePageRefresh\(\)/, `${path}: use shared refresh behavior`);
  assert.match(source, /loading=\{refreshing\}/, `${path}: refresh needs busy feedback`);
}
console.log('[check-workspace-refresh] PASS: mounted-state-preserving refresh contracts.');
