import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 24 native TypeScript tests require an explicit extension.
import { getConsoleSurface, getPlatformTitle, getPlatformNavigation, PLATFORM_HOME_PATH } from "./console-routing.ts";

test("管理员的平台门户只显示五个一级入口", () => {
  const navigation = getPlatformNavigation("admin");

  assert.deepEqual(
    navigation.map(({ label, path }) => ({ label, path })),
    [
      { label: "概览", path: "/" },
      { label: "集群", path: "/clusters" },
      { label: "授权管理", path: "/authorization" },
      { label: "应用中心", path: "/applications" },
      { label: "系统设置", path: "/settings" },
    ],
  );
});

test("普通运维角色看不到平台级授权和系统设置", () => {
  assert.deepEqual(
    getPlatformNavigation("operator").map((item) => item.path),
    ["/", "/clusters", "/applications"],
  );
});

test("控制台路由能区分登录、平台门户和单集群工作区", () => {
  assert.equal(getConsoleSurface("/login"), "public");
  assert.equal(getConsoleSurface("/clusters"), "portal");
  assert.equal(getConsoleSurface("/settings/update"), "portal");
  assert.equal(getConsoleSurface("/clusters/ack-prod/overview"), "cluster-workspace");
  assert.equal(getConsoleSurface("/clusters/ack-prod/workloads/pods"), "cluster-workspace");
  assert.equal(getConsoleSurface("/workloads/pods"), "legacy-workspace");
});

test("登录成功后的默认入口是平台概览", () => {
  assert.equal(PLATFORM_HOME_PATH, "/");
});

test("平台规范路由返回稳定的页面标题", () => {
  assert.equal(getPlatformTitle("/"), "概览");
  assert.equal(getPlatformTitle("/authorization"), "授权管理");
  assert.equal(getPlatformTitle("/applications"), "应用中心");
  assert.equal(getPlatformTitle("/settings/update"), "系统设置");
});
