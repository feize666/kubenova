import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { getNamespaces } from './namespaces';
import { getClusterNodes } from './clusters';
import { getWorkloads } from './workloads';

test('Pod list query passes cancellation to its transport', async () => {
  const source = readFileSync(new URL('../../app/workloads/pods/page.tsx', import.meta.url), 'utf8');
  const ast = ts.createSourceFile('page.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let query: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === 'podsQuery' && node.initializer && ts.isCallExpression(node.initializer)) {
      const options = node.initializer.arguments[0];
      if (ts.isObjectLiteralExpression(options)) {
        query = options.properties.find((property) => ts.isPropertyAssignment(property) && property.name.getText(ast) === 'queryFn');
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.ok(query && ts.isPropertyAssignment(query));
  const compiled = ts.transpileModule(`const run = ${query.initializer.getText(ast)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const controller = new AbortController();
  let received: AbortSignal | undefined;
  const run = new Function('getWorkloadsByKind', 'POD_KIND', 'clusterId', 'namespace', 'keyword', 'page', 'pageSize', 'sortBy', 'sortOrder', 'phaseFilter', 'accessToken', `${compiled}; return run;`)(
    (_kind: string, _params: unknown, _token: string, options?: { signal?: AbortSignal }) => { received = options?.signal; },
    'pods', 'cluster', 'loop', '', 1, 25, 'name', 'asc', '', 'fixture',
  );
  await run({ signal: controller.signal });
  assert.equal(received, controller.signal);
});

test('resource list transports abort obsolete namespace, node and workload reads', async () => {
  const original = globalThis.fetch;
  const pending: AbortSignal[] = [];
  globalThis.fetch = async (_input, init) => {
    const signal = init?.signal;
    assert.ok(signal);
    pending.push(signal);
    return new Promise<Response>((_resolve, reject) => {
      const abort = () => reject(new DOMException('Cancelled by caller', 'AbortError'));
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    });
  };
  try {
    for (const read of [
      (signal: AbortSignal) => getNamespaces({ clusterId: 'old' }, 'fixture', { signal }),
      (signal: AbortSignal) => getClusterNodes('old', 'fixture', { signal }),
      (signal: AbortSignal) => getWorkloads('deployments', { clusterId: 'old' }, 'fixture', { signal }),
    ]) {
      const controller = new AbortController();
      const result = read(controller.signal);
      controller.abort();
      await assert.rejects(result);
      assert.equal(pending.at(-1)?.aborted, true);
    }
    assert.equal(pending.length, 3);
  } finally {
    globalThis.fetch = original;
  }
});
