import assert from "node:assert/strict";
import test from "node:test";
// @ts-expect-error -- Node 24 native TypeScript tests require explicit extension.
import { getResourceDetailQueryState, visibleDetailData } from "./query-state.ts";

const denied = Object.assign(new Error("forbidden"), { status: 403 });
const failed = new Error("gateway unavailable");

test("detail permission failure hides cached data instead of rendering stale resource", () => {
  const query = { data: { name: "old" }, error: denied, isPending: false, isFetching: false };
  assert.equal(visibleDetailData(query), undefined);
  assert.equal(getResourceDetailQueryState(query), "permission");
});

test("ordinary refresh failure keeps the last successful detail as degraded", () => {
  const query = { data: { name: "old" }, error: failed, isPending: false, isFetching: false };
  assert.deepEqual(visibleDetailData(query), { name: "old" });
  assert.equal(getResourceDetailQueryState(query), "degraded");
});

test("initial failure is distinct from a real empty detail", () => {
  assert.equal(getResourceDetailQueryState({ data: undefined, error: failed, isPending: false, isFetching: false }), "error");
  assert.equal(getResourceDetailQueryState({ data: undefined, error: undefined, isPending: false, isFetching: false }), "empty");
});
