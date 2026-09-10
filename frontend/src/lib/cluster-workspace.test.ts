import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 24 native TypeScript tests require an explicit extension.
import { buildClusterResourceHref, buildClusterWorkspaceHref, getClusterIdFromPathname, getClusterWorkspaceNavigation } from "./cluster-workspace.ts";

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

test("单集群工作区只保留当前集群资源菜单", () => {
  const sections = getClusterWorkspaceNavigation("ack-prod");
  const baseResources = sections.find((section) => section.key === "base-resources");
  const labels = sections.flatMap((section) => [section.label, ...section.items.map((item) => item.label)]);

  assert.deepEqual(baseResources?.items.map((item) => item.label), ["Node", "Namespace"]);
  assert.equal(labels.includes("Cluster"), false);
  assert.equal(labels.includes("系统设置"), false);
  assert.ok(
    sections.flatMap((section) => section.items).every((item) => item.href.startsWith("/clusters/ack-prod/")),
  );
});

test("从工作区地址解析并解码唯一集群标识", () => {
  assert.equal(getClusterIdFromPathname("/clusters/ack-prod/overview"), "ack-prod");
  assert.equal(getClusterIdFromPathname("/clusters/ack%2Fprod/workloads/pods"), "ack/prod");
  assert.equal(getClusterIdFromPathname("/clusters"), null);
});
