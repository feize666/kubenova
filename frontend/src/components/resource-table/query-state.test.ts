import assert from "node:assert/strict";
import test from "node:test";
import { ApiError } from "@/lib/api/client";
import { deriveResourceTableState } from "./query-state";

test("a first request without data is loading, while a refresh with data is degraded", () => {
  assert.equal(deriveResourceTableState({ data: undefined, error: undefined, isError: false, isLoading: true, isFetching: true }), "loading");
  assert.equal(deriveResourceTableState({ data: { items: [{ name: "web" }] }, error: new Error("offline"), isError: true, isLoading: false, isFetching: false }), "degraded");
});

for (const status of [401, 403]) {
  test(`an authorization failure is permission state even when a cached snapshot exists (${status})`, () => {
    assert.equal(deriveResourceTableState({ data: { items: [{ name: "private" }] }, error: new ApiError("denied", status), isError: true, isLoading: false, isFetching: false }), "permission");
  });
}

test("a real first-load error is distinct from an empty successful response", () => {
  assert.equal(deriveResourceTableState({ data: undefined, error: new Error("offline"), isError: true, isLoading: false, isFetching: false }), "error");
  assert.equal(deriveResourceTableState({ data: { items: [] }, error: undefined, isError: false, isLoading: false, isFetching: false }), "idle");
  assert.equal(deriveResourceTableState(undefined, "filtered-empty"), "filtered-empty");
});
