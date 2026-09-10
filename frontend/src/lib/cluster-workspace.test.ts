import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 24 native TypeScript tests require an explicit extension.
import { buildClusterResourceHref, buildClusterWorkspaceHref, filterClusterScopedColumns, getClusterIdFromPathname, getClusterWorkspaceNavigation, isSupportedClusterWorkspaceResource, resolveResourceFilterBasePath, resolveWorkspaceClusterFieldValue, resolveWorkspaceClusterId, resolveWorkspaceResourceHref, scopeWorkspaceClusterFormData, scopeWorkspaceClusterValues } from "./cluster-workspace.ts";

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
  assert.equal(labels.includes("日志"), true);
  assert.ok(
    sections.flatMap((section) => section.items).every((item) => item.href.startsWith("/clusters/ack-prod/")),
  );
});

test("从工作区地址解析并解码唯一集群标识", () => {
  assert.equal(getClusterIdFromPathname("/clusters/ack-prod/overview"), "ack-prod");
  assert.equal(getClusterIdFromPathname("/clusters/ack%2Fprod/workloads/pods"), "ack/prod");
  assert.equal(getClusterIdFromPathname("/clusters"), null);
});

test("工作区集群标识覆盖旧查询范围且不可清空", () => {
  assert.equal(resolveWorkspaceClusterId("ack-prod", "other-cluster"), "ack-prod");
  assert.equal(resolveWorkspaceClusterId("ack-prod", ""), "ack-prod");
  assert.equal(resolveWorkspaceClusterId(null, "legacy-cluster"), "legacy-cluster");
});

test("工作区集群表单值始终锁定当前集群", () => {
  assert.equal(resolveWorkspaceClusterFieldValue("ack-prod", "other-cluster"), "ack-prod");
  assert.equal(resolveWorkspaceClusterFieldValue(" ack-prod ", ""), "ack-prod");
  assert.equal(resolveWorkspaceClusterFieldValue(null, "legacy-cluster"), "legacy-cluster");
});

test("工作区菜单中的每个资源地址都有 canonical 页面承接", () => {
  const resourcePaths = getClusterWorkspaceNavigation("ack-prod")
    .flatMap((section) => section.items)
    .map((item) => item.href.replace("/clusters/ack-prod/", ""))
    .filter((path) => path !== "overview");

  assert.ok(resourcePaths.length > 0);
  assert.ok(resourcePaths.every(isSupportedClusterWorkspaceResource));
  assert.equal(isSupportedClusterWorkspaceResource("workloads/unknown"), false);
});

test("工作区资源筛选同步不能把 canonical 地址改回旧页面", () => {
  const canonicalPath = "/clusters/ack-prod/workloads/deployments";
  assert.equal(
    resolveResourceFilterBasePath("ack-prod", canonicalPath, "/workloads/deployments"),
    canonicalPath,
  );
  assert.equal(
    resolveResourceFilterBasePath(null, "/workloads/deployments", "/workloads/deployments"),
    "/workloads/deployments",
  );
});

test("工作区内的资源操作继续留在当前集群", () => {
  assert.equal(
    resolveWorkspaceResourceHref("ack-prod", "/workloads/create?kind=Deployment"),
    "/clusters/ack-prod/workloads/create?kind=Deployment",
  );
  assert.equal(
    resolveWorkspaceResourceHref(null, "/workloads/create?kind=Deployment"),
    "/workloads/create?kind=Deployment",
  );
});

test("工作区请求边界递归覆盖所有外来 clusterId", () => {
  assert.deepEqual(
    scopeWorkspaceClusterValues("ack-prod", {
      clusterId: "other",
      identity: { clusterId: "other", name: "web" },
      items: [{ clusterId: "other" }],
      namespace: "default",
    }),
    {
      clusterId: "ack-prod",
      identity: { clusterId: "ack-prod", name: "web" },
      items: [{ clusterId: "ack-prod" }],
      namespace: "default",
    },
  );
  assert.equal(scopeWorkspaceClusterValues(null, "unchanged"), "unchanged");
});

test("工作区请求边界覆盖 FormData 中的外来 clusterId", () => {
  const body = new FormData();
  body.append("clusterId", "other");
  body.append("name", "web");

  const scoped = scopeWorkspaceClusterFormData("ack-prod", body);

  assert.equal(scoped.get("clusterId"), "ack-prod");
  assert.equal(scoped.get("name"), "web");
  assert.equal(body.get("clusterId"), "other");
});

test("单集群工作区隐藏集群列且不影响 legacy 页面", () => {
  const columns = [
    { key: "name", title: "名称" },
    { key: "clusterId", title: "集群" },
    { key: "cluster", title: "集群" },
    { title: "集群名称" },
    { key: "namespace", title: "名称空间" },
  ] as const;

  assert.deepEqual(
    filterClusterScopedColumns("ack-prod", columns).map((column) => column.key),
    ["name", "namespace"],
  );
  assert.deepEqual(
    filterClusterScopedColumns(null, columns).map((column) => column.key),
    ["name", "clusterId", "cluster", undefined, "namespace"],
  );
});

test("单集群工作区递归清理分组中的集群列", () => {
  const columns = [
    {
      key: "identity",
      title: "身份",
      children: [
        { key: "clusterId", title: "集群" },
        { key: "name", title: "名称" },
      ],
    },
  ] as const;

  assert.deepEqual(
    filterClusterScopedColumns("ack-prod", columns),
    [{ key: "identity", title: "身份", children: [{ key: "name", title: "名称" }] }],
  );
  assert.deepEqual(
    filterClusterScopedColumns("ack-prod", [{ key: "identity", title: "身份", children: [{ key: "clusterId", title: "集群" }] }]),
    [],
  );
});
