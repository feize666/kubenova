import assert from "node:assert/strict";
import test from "node:test";

// @ts-expect-error -- Node 24 native TypeScript tests require an explicit extension.
import { getConsoleSurface, getPlatformTitle, getPlatformNavigation, PLATFORM_HOME_PATH } from "./console-routing.ts";

test("管理员的平台门户显示六个一级入口", () => {
  const navigation = getPlatformNavigation("admin");

  assert.deepEqual(
    navigation.map(({ label, path }) => ({ label, path })),
    [
      { label: "概览", path: "/" },
      { label: "集群", path: "/clusters" },
      { label: "AI 助手", path: "/ai-assistant" },
      { label: "访问控制", path: "/authorization" },
      { label: "应用中心", path: "/applications" },
      { label: "系统设置", path: "/settings" },
    ],
  );
});

test("普通运维角色看不到平台级授权和系统设置", () => {
  assert.deepEqual(
    getPlatformNavigation("operator").map((item) => item.path),
    ["/", "/clusters"],
  );
});

test("普通运维用户只有获得 AI 能力授权后才显示 AI 助手入口", () => {
  assert.equal(getPlatformNavigation("operator").some((item) => item.path === "/ai-assistant"), false);
  assert.equal(getPlatformNavigation("operator", undefined, true).some((item) => item.path === "/ai-assistant"), true);
});

test("应用中心仅向现有超级管理员角色开放", () => {
  for (const role of ["admin", "platform-admin", " ADMIN "]) {
    assert.ok(getPlatformNavigation(role).some((item) => item.path === "/applications"));
  }
  for (const role of ["", "user", "viewer", "operator", "cluster-admin"]) {
    assert.equal(getPlatformNavigation(role).some((item) => item.path === "/applications"), false);
  }
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
  assert.equal(getPlatformTitle("/authorization"), "访问控制");
  assert.equal(getPlatformTitle("/applications"), "应用中心");
  assert.equal(getPlatformTitle("/settings/update"), "系统设置");
});
