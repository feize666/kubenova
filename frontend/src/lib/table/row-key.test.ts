import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { Table } from "antd";
import { getStableResourceRowKey } from "./row-key";

test("resource keys preserve IDs and namespace identity without a row index", () => {
  assert.equal(getStableResourceRowKey({ id: 0 }), 0);
  assert.equal(getStableResourceRowKey({ metadata: { uid: "pod-uid" } }), "pod-uid");
  assert.equal(getStableResourceRowKey({ namespace: "apps", name: "api" }), "apps/api");
  assert.notEqual(getStableResourceRowKey({ namespace: "a", name: "api" }), getStableResourceRowKey({ namespace: "b", name: "api" }));
});

test("anonymous audit rows remain distinct and stable after sorting or filtering", () => {
  const rows = [{ message: "audit" }, { message: "audit" }, { message: "other" }];
  const keys = rows.map(row => getStableResourceRowKey(row));
  assert.equal(new Set(keys).size, 3);
  assert.deepEqual([...rows].reverse().map(row => getStableResourceRowKey(row)), [...keys].reverse());
  assert.equal(getStableResourceRowKey(rows[1]), keys[1]);
});

test("Ant Design renders the shared row key without index deprecation warnings", (t) => {
  const errors: string[] = [];
  t.mock.method(console, "error", (...args: unknown[]) => errors.push(args.map(String).join(" ")));
  const html = renderToString(createElement(Table, {
    columns: [{ dataIndex: "id", title: "ID" }],
    dataSource: [{ id: "first" }, { id: "second" }],
    rowKey: getStableResourceRowKey,
    pagination: false,
  }));
  assert.ok(html.includes('data-row-key="first"'));
  assert.deepEqual(errors, []);
});
