import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 24 native TypeScript tests require an explicit extension.
import { buildClusterResourceHref, buildClusterWorkspaceHref } from "./cluster-workspace.ts";

test("集群入口生成固定集群的 canonical 概览地址", () => {
  assert.equal(buildClusterWorkspaceHref(" ack-prod "), "/clusters/ack-prod/overview");
  assert.equal(buildClusterWorkspaceHref("ack/prod"), "/clusters/ack%2Fprod/overview");
});

test("资源地址位于同一个集群工作区内", () => {
  assert.equal(
    buildClusterResourceHref("ack-prod", "/workloads/pods"),
    "/clusters/ack-prod/workloads/pods",
  );
});

test("空集群标识不能生成工作区地址", () => {
  assert.throws(() => buildClusterWorkspaceHref("   "), /集群标识不能为空/);
});
