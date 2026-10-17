#!/usr/bin/env node
/**
 * UI tech refresh browser smoke.
 * Screenshot evidence naming: <route>__<theme>__<viewport>__<state>.png
 *
 * Usage:
 *   UI_TECH_BASE_URL=http://localhost:3000 \
 *   UI_TECH_USER=admin@local.dev \
 *   UI_TECH_PASS=admin123456 \
 *   npm run e2e:ui-tech:smoke
 */
import { existsSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import { join } from "node:path";
import process from "node:process";

const DEFAULT_ARTIFACT_ROOT = "/case/temp/kubenova/ui-tech-smoke";
const ARTIFACT_ROOT = process.env.UI_TECH_ARTIFACT_DIR || DEFAULT_ARTIFACT_ROOT;
const smokeClusterId = process.env.UI_TECH_CLUSTER_ID || "local";
const smokeNamespace = process.env.UI_TECH_NAMESPACE || "default";
const smokeClusterName = process.env.UI_TECH_CLUSTER_NAME || smokeClusterId;
const smokePod = process.env.UI_TECH_POD || "smoke-pod";
const smokeContainer = process.env.UI_TECH_CONTAINER || "smoke-container";
const DEFAULT_RUNTIME_QUERY = new URLSearchParams({
  clusterId: smokeClusterId,
  namespace: smokeNamespace,
  pod: smokePod,
  container: smokeContainer,
  clusterName: smokeClusterName,
}).toString();
const cliOptions = parseCliOptions(process.argv.slice(2));

const baseUrl = normalizeBaseUrl(cliOptions.baseUrl || process.env.UI_TECH_BASE_URL || "http://localhost:3000");
const username = process.env.UI_TECH_USER || "admin@local.dev";
const password = process.env.UI_TECH_PASS || "admin123456";
const timeout = readPositiveInt("UI_TECH_TIMEOUT_MS", 20000);
const settleMs = readNonNegativeInt("UI_TECH_SETTLE_MS", 500);
const headless = process.env.UI_TECH_HEADLESS !== "false";
const saveArtifacts = process.env.UI_TECH_SAVE_ARTIFACTS === "1" || process.env.UI_TECH_SAVE_ARTIFACTS === "true";
const themes = selectThemes(cliOptions.themes || process.env.UI_TECH_THEMES || "black,white");

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "tablet", width: 820, height: 1180 },
  { name: "mobile", width: 390, height: 844 },
];

const allRoutes = [
  {
    id: "overview",
    path: "/",
    texts: ["集群概览", "集群资源概览", "工作负载", "最近异常事件"],
    shellSelector: ".ops-overview-shell",
    toolbarSelector: ".ops-overview-header",
    chipSelector: ".ops-filter-chip",
    statusSelector: ".ops-status-tag",
  },
  {
    id: "overview-scoped",
    path: `/?clusterId=${encodeURIComponent(smokeClusterId)}`,
    texts: ["集群概览", "集群资源概览", "单集群视图"],
    shellSelector: ".ops-overview-shell",
    toolbarSelector: ".ops-overview-header",
    chipSelector: ".ops-filter-chip",
    statusSelector: ".ops-status-tag",
  },
  {
    id: "terminal",
    path: `/terminal?${DEFAULT_RUNTIME_QUERY}&source=smoke`,
    texts: ["Pod 终端工作区", `${smokeNamespace} / ${smokePod}`, "网关"],
    shellSelector: ".ops-frame-shell",
    toolbarSelector: ".ops-frame-shell__toolbar",
    chipSelector: ".ops-frame-shell__status .ops-status-tag",
    statusSelector: ".ops-frame-shell__status .ops-status-tag",
    requireOpsFrameShell: true,
  },
  {
    id: "logs",
    path: `/logs?${DEFAULT_RUNTIME_QUERY}&tailLines=100&follow=false&timeMode=quick&from=now-15m&to=now`,
    texts: ["Pod 日志工作区", `${smokeNamespace} / ${smokePod} / ${smokeContainer}`, "Paused", "行 100"],
    shellSelector: ".ops-frame-shell",
    toolbarSelector: ".ops-frame-shell__toolbar",
    chipSelector: ".ops-frame-shell__status .ops-status-tag",
    statusSelector: ".ops-frame-shell__status .ops-status-tag",
    requireOpsFrameShell: true,
  },
  {
    id: "pods",
    path: `/workloads/pods?clusterId=${encodeURIComponent(smokeClusterId)}&namespace=${encodeURIComponent(smokeNamespace)}`,
    texts: ["Pod", "查看和管理集群中运行的 Pod 实例", "资源范围"],
    shellSelector: ".resource-table-shell",
    toolbarSelector: ".resource-table-toolbar",
    chipSelector: ".resource-scope-filter-button",
    statusSelector: ".resource-table-toolbar-actions",
    evidenceState: "table",
    overlayChecks: ["row-dropdown-yaml"],
  },
  {
    id: "deployments",
    path: `/workloads/deployments?clusterId=${encodeURIComponent(smokeClusterId)}&namespace=${encodeURIComponent(smokeNamespace)}`,
    texts: ["Deployment", "管理无状态应用发布", "资源范围"],
    shellSelector: ".resource-table-shell",
    toolbarSelector: ".resource-table-toolbar",
    chipSelector: ".resource-scope-filter-button",
    statusSelector: ".resource-table-toolbar-actions",
    evidenceState: "table",
    createTriggerSelector: 'button[aria-label="创建Deployment"]',
    overlayChecks: ["scope-popover", "table-search-popover", "table-column-popover", "create-route", "row-dropdown-yaml", "resource-detail"],
  },
  {
    id: "namespaces",
    path: `/namespaces?clusterId=${encodeURIComponent(smokeClusterId)}`,
    texts: ["Namespace", "统一管理名称空间", "资源范围"],
    shellSelector: ".resource-table-shell",
    toolbarSelector: ".resource-table-toolbar",
    chipSelector: ".resource-scope-filter-button",
    statusSelector: ".resource-table-toolbar-actions",
    evidenceState: "table",
    overlayChecks: ["row-dropdown-yaml"],
  },
  {
    id: "nodes",
    path: `/clusters/nodes?clusterId=${encodeURIComponent(smokeClusterId)}`,
    texts: ["Node", "查看集群工作节点", "集群"],
    shellSelector: ".resource-table-shell",
    toolbarSelector: ".resource-table-toolbar",
    chipSelector: ".resource-scope-filter-button",
    statusSelector: ".resource-table-toolbar-actions",
    evidenceState: "table",
  },
  {
    id: "cluster-management",
    path: "/clusters",
    texts: ["集群管理", "查看集群版本", "集群总数"],
    shellSelector: ".resource-table-shell",
    toolbarSelector: ".resource-table-toolbar",
    chipSelector: ".resource-filter-toolbar",
    statusSelector: ".resource-table-toolbar-actions",
    evidenceState: "table",
    createTriggerSelector: 'button[aria-label="创建集群"]',
    createFieldSelector: '.ops-modal-shell input[placeholder="例如：prod-cluster-01"]',
    createFooterSelector: '.ops-modal-shell .ant-modal-footer',
    overlayChecks: ["table-search-popover", "table-column-popover", "create-modal"],
  },
  {
    id: "handbook",
    path: "/handbook",
    texts: ["使用手册", "权限说明", "登录与快速开始"],
    shellSelector: ".handbook-page",
    toolbarSelector: ".handbook-page__intro",
    chipSelector: ".handbook-page .ant-collapse-header",
    statusSelector: ".handbook-page__sections",
    evidenceState: "workbench",
  },
  {
    id: "topology",
    path: `/network/topology?clusterId=${encodeURIComponent(smokeClusterId)}&namespace=${encodeURIComponent(smokeNamespace)}`,
    texts: ["资源拓扑", "单集群工作负载", "资源域"],
    shellSelector: ".resource-map-shell",
    toolbarSelector: ".topology-headlamp-toolbar",
    chipSelector: ".topology-domain-menu, .topology-group-chips",
    statusSelector: ".topology-headlamp-toolbar, .resource-map-canvas-state",
    canvasStateSelector: ".resource-map-canvas-state",
    evidenceState: "workbench",
  },
  {
    id: "ai-assistant",
    path: "/ai-assistant",
    texts: ["AI 助手", "ChatOps", "AI 模型", "ChatOps 会话中"],
    shellSelector: ".ops-workbench-shell--ai",
    toolbarSelector: ".ai-assistant-chat-surface",
    chipSelector: ".ai-assistant-status-chip, .ops-status-tag",
    statusSelector: "#ai-assistant-input",
    evidenceState: "workbench",
    overlayChecks: ["ai-settings-drawer", "ai-alert-drawer"],
  },
  {
    id: "aiops",
    path: "/aiops",
    texts: ["AI 助手", "ChatOps", "ChatOps 会话中"],
    shellSelector: ".resource-page-header",
    toolbarSelector: ".resource-page-header",
    chipSelector: ".ant-select",
    statusSelector: ".resource-table-shell, .ops-surface",
    evidenceState: "workbench",
  },
];
const routes = selectRoutes(allRoutes, cliOptions.routes);

function parseCliOptions(args) {
  const options = {
    baseUrl: "",
    routes: "",
    themes: "",
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--base-url") {
      options.baseUrl = args[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--base-url=")) {
      options.baseUrl = arg.slice("--base-url=".length);
      continue;
    }
    if (arg === "--routes") {
      options.routes = args[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--routes=")) {
      options.routes = arg.slice("--routes=".length);
      continue;
    }
    if (arg === "--themes") {
      options.themes = args[index + 1] || "";
      index += 1;
      continue;
    }
    if (arg.startsWith("--themes=")) {
      options.themes = arg.slice("--themes=".length);
      continue;
    }
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/ui-tech-smoke.mjs [--base-url URL] [--routes overview,terminal,logs] [--themes black,white]");
      process.exit(0);
    }
    fail(`未知参数: ${arg}`);
  }
  return options;
}

function selectRoutes(candidateRoutes, raw) {
  if (!raw) return candidateRoutes;
  const aliases = {
    overview: new Set(["overview", "overview-scoped"]),
    terminal: new Set(["terminal"]),
    logs: new Set(["logs"]),
    "resource-surfaces": new Set(["pods", "deployments", "namespaces", "nodes"]),
    workloads: new Set(["pods", "deployments"]),
    helm: new Set(["helm-releases", "helm-repositories"]),
    clusters: new Set(["cluster-management", "namespaces", "nodes"]),
    topology: new Set(["topology"]),
    ai: new Set(["ai-assistant", "aiops"]),
  };
  const requested = new Set();
  for (const item of raw.split(",")) {
    const key = item.trim();
    if (!key) continue;
    const matched = aliases[key] || new Set([key]);
    for (const routeId of matched) {
      requested.add(routeId);
    }
  }
  const selected = candidateRoutes.filter((route) => requested.has(route.id));
  if (selected.length === 0) {
    fail(`--routes 未匹配任何路由: ${raw}`);
  }
  return selected;
}

function selectThemes(raw) {
  const aliases = {
    black: "dark",
    dark: "dark",
    white: "light",
    light: "light",
  };
  const selected = [];
  for (const item of raw.split(",")) {
    const key = item.trim().toLowerCase();
    if (!key) continue;
    const theme = aliases[key];
    if (!theme) {
      fail(`--themes 包含未知主题: ${item}`);
    }
    if (!selected.includes(theme)) {
      selected.push(theme);
    }
  }
  if (selected.length === 0) {
    fail(`--themes 未选择任何主题: ${raw}`);
  }
  return selected;
}

function themeEvidenceName(theme) {
  return theme === "dark" ? "black" : "white";
}

function fail(message, cause) {
  const suffix = cause === undefined ? "" : ` 原因: ${describeError(cause)}`;
  throw new Error(`${message}${suffix}`);
}

function info(message) {
  console.log(`[ui-tech-smoke] ${message}`);
}

function describeError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function normalizeBaseUrl(value) {
  return value.trim().replace(/\/+$/, "");
}

function readPositiveInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${name} 必须是正整数，当前值: ${raw}`);
  }
  return value;
}

function readNonNegativeInt(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    fail(`${name} 必须是非负整数，当前值: ${raw}`);
  }
  return value;
}

function routeUrl(route) {
  const url = new URL(route.path, baseUrl);
  if (process.env.UI_TECH_CLUSTER_ID && url.searchParams.has("clusterId")) {
    url.searchParams.set("clusterId", process.env.UI_TECH_CLUSTER_ID);
  }
  if (process.env.UI_TECH_NAMESPACE && url.searchParams.has("namespace")) {
    url.searchParams.set("namespace", process.env.UI_TECH_NAMESPACE);
  }
  return url.toString();
}

async function pageTextSnippet(page) {
  try {
    const text = await page.locator("body").innerText({ timeout: 1000 });
    return text.replace(/\s+/g, " ").trim().slice(0, 400);
  } catch {
    return "";
  }
}

function readAuthSnapshot(payload) {
  const data = payload && typeof payload === "object" && "data" in payload ? payload.data : payload;
  if (!data || typeof data !== "object") {
    fail("登录接口响应缺少 data 对象");
  }
  if (typeof data.accessToken !== "string" || typeof data.refreshToken !== "string") {
    fail("登录接口响应缺少 accessToken/refreshToken");
  }
  const user = data.user && typeof data.user === "object" ? data.user : {};
  return {
    accessToken: data.accessToken,
    refreshToken: data.refreshToken,
    expiresAt: typeof data.expiresAt === "string" ? data.expiresAt : "",
    username: typeof user.username === "string" ? user.username : username,
    role: typeof user.role === "string" ? user.role : "",
  };
}

let apiAuthSnapshot;
async function authenticateViaApi(page) {
  if (!apiAuthSnapshot) {
  const loginApiUrl = `${baseUrl}/api/v1/auth/login`;
  let response;
  try {
    response = await fetch(loginApiUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
  } catch (error) {
    fail(`API 登录请求失败: url=${loginApiUrl}`, error);
  }

  let payload;
  try {
    payload = await response.json();
  } catch (error) {
    fail(`API 登录响应不是 JSON: url=${loginApiUrl} status=${response.status}`, error);
  }
  if (!response.ok) {
    fail(`API 登录失败: url=${loginApiUrl} status=${response.status} body=${JSON.stringify(payload).slice(0, 300)}`);
  }

  apiAuthSnapshot = readAuthSnapshot(payload);
  }
  const snapshot = apiAuthSnapshot;
  await page.goto(baseUrl, { waitUntil: "domcontentloaded", timeout });
  await page.evaluate((auth) => {
    const entries = [
      ["aiops_auth_access", auth.accessToken],
      ["aiops_auth_refresh", auth.refreshToken],
      ["aiops_auth_user", auth.username],
      ["aiops_auth_role", auth.role],
      ["access_token", auth.accessToken],
      ["refresh_token", auth.refreshToken],
      ["username", auth.username],
      ["role", auth.role],
    ];
    for (const [key, value] of entries) {
      window.localStorage.setItem(key, value);
    }
    if (auth.expiresAt) {
      window.localStorage.setItem("aiops_auth_expires_at", auth.expiresAt);
      window.localStorage.setItem("expires_at", auth.expiresAt);
    }
  }, snapshot);
  info("API 登录已写入浏览器会话");
}

async function authenticateViaUi(page) {
  const loginUrl = `${baseUrl}/login`;
  await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout });
  if (!page.url().includes("/login")) {
    info("检测到已有登录会话");
    return;
  }

  try {
    await page.getByPlaceholder("输入邮箱账号").fill(username, { timeout });
    await page.getByPlaceholder("输入登录密码").fill(password, { timeout });
    const loginForm = page.locator("form").filter({ has: page.getByPlaceholder("输入登录密码") }).first();
    await Promise.all([
      page.waitForURL(/\/dashboard|\/$/, { timeout }),
      loginForm.locator('button[type="submit"]').first().click(),
    ]);
  } catch (error) {
    const snippet = await pageTextSnippet(page);
    fail(`UI 登录失败: current=${page.url()} body="${snippet}"`, error);
  }
  info("UI 登录成功");
}

async function ensureLoggedIn(page) {
  try {
    await authenticateViaApi(page);
    return;
  } catch (error) {
    info(`API 登录不可用，回退 UI 登录: ${describeError(error)}`);
  }
  await authenticateViaUi(page);
}

function isAllowedConsoleIssue(issue) {
  const brief = `${issue.text} ${issue.url || ""}`.toLowerCase();
  if (
    /antd.*space.*deprecated|space.*deprecated.*antd|\[antd:\s*space\].*deprecated/i.test(issue.text) ||
    /\[antd:\s*Alert\].*message.*deprecated|Alert.*message.*deprecated/i.test(issue.text)
  ) {
    return true;
  }
  const isResourceApiNotFound =
    process.env.UI_TECH_ALLOW_BACKEND_DEGRADATION === "1" &&
    brief.includes("404") &&
    (
      brief.includes("/api/workloads") ||
      brief.includes("/api/namespaces") ||
      brief.includes("/api/clusters") ||
      brief.includes("/api/resources/discovery/catalog") ||
      brief.includes("/api/helm") ||
      brief.includes("/api/dashboard")
    );
  if (isResourceApiNotFound) {
    return true;
  }
  // Local UI smoke runs may not have a control-api connected to a cluster;
  // topology summary degradation is rendered by the page and is not a UI
  // browser error in that fixture-free mode.
  if (process.env.UI_TECH_ALLOW_BACKEND_DEGRADATION === "1" && brief.includes("/api/topology/summary") && brief.includes("503")) {
    return true;
  }
  const isRuntimeOrLogs =
    brief.includes("/api/runtime") ||
    brief.includes("/api/logs") ||
    brief.includes("runtime") ||
    brief.includes("logs") ||
    brief.includes("终端") ||
    brief.includes("日志");
  const isExpectedDegrade =
    brief.includes("403") ||
    brief.includes("400") ||
    brief.includes("bad request") ||
    brief.includes("kubeconfig") ||
    brief.includes("kube config") ||
    brief.includes("凭据");
  return process.env.UI_TECH_ALLOW_BACKEND_DEGRADATION === "1" && isRuntimeOrLogs && isExpectedDegrade;
}

function installIssueCapture(page, viewportName) {
  const issues = [];
  const pageErrors = [];

  page.on("console", (message) => {
    const type = message.type();
    if (type !== "error" && type !== "warning") {
      return;
    }
    const text = message.text();
    const isAllowedAntdWarning =
      type === "warning" &&
      (
        /antd.*space.*deprecated|space.*deprecated/i.test(text) ||
        /\[antd:\s*Alert\].*message.*deprecated|Alert.*message.*deprecated/i.test(text)
      );
    if (type !== "error" && !isAllowedAntdWarning) {
      return;
    }
    const location = message.location();
    issues.push({
      type,
      text,
      url: location.url,
      lineNumber: location.lineNumber,
      columnNumber: location.columnNumber,
      viewport: viewportName,
    });
  });

  page.on("pageerror", (error) => {
    pageErrors.push({
      text: describeError(error),
      viewport: viewportName,
    });
  });

  return { issues, pageErrors };
}

async function waitForStableRoute(page, route, viewport) {
  const target = routeUrl(route);
  try {
    await page.goto(target, { waitUntil: "domcontentloaded", timeout });
    await page.locator("body").waitFor({ state: "visible", timeout });
  } catch (error) {
    fail(`[${viewport.name}/${route.id}] 页面不可达: url=${target}`, error);
  }

  if (page.url().includes("/login")) {
    await ensureLoggedIn(page);
    await page.goto(target, { waitUntil: "domcontentloaded", timeout });
  }

  try {
    await page.locator(route.shellSelector).first().waitFor({ state: "visible", timeout });
  } catch (error) {
    const snippet = await pageTextSnippet(page);
    fail(`[${viewport.name}/${route.id}] shell 未出现: selector=${route.shellSelector} body="${snippet}"`, error);
  }

  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }
}

async function assertSelectorVisible(page, viewport, route, selector, label) {
  const locator = page.locator(selector);
  const count = await locator.count();
  if (count === 0) {
    fail(`[${viewport.name}/${route.id}] 缺少 ${label}: selector=${selector}`);
  }
  try {
    await locator.first().waitFor({ state: "visible", timeout: 3000 });
  } catch (error) {
    fail(`[${viewport.name}/${route.id}] ${label} 不可见: selector=${selector}`, error);
  }
}

async function assertOverlayVisible(page, viewport, route, selector, label) {
  const locator = page.locator(selector);
  const deadline = Date.now() + 5000;
  let lastVisibleBox = null;
  while (Date.now() < deadline) {
    const count = await locator.count();
    if (count === 0) {
      await page.waitForTimeout(100);
      continue;
    }
    for (let index = 0; index < count; index += 1) {
      const overlay = locator.nth(index);
      if (!(await overlay.isVisible().catch(() => false))) {
        continue;
      }
      await overlay.evaluate(async element => {
        const animations = [];
        for (let node = element; node; node = node.parentElement) {
          animations.push(...node.getAnimations().filter(animation => animation.effect?.getTiming().iterations !== Infinity));
        }
        await Promise.all(animations.map(animation => animation.finished.catch(() => {})));
      });
      if (!(await overlay.isVisible().catch(() => false))) continue;
      const box = await overlay.boundingBox();
      if (!box) {
        continue;
      }
      lastVisibleBox = box;
      if (box.width <= viewport.width + 2 && box.x >= -2 && box.x + box.width <= viewport.width + 2) {
        return;
      }
    }
    await page.waitForTimeout(100);
  }

  if (!lastVisibleBox) {
    fail(`[${viewport.name}/${route.id}] 浮层缺失或不可见: ${label} selector=${selector}`);
  }
  fail(
    `[${viewport.name}/${route.id}] 浮层横向越界: ${label} x=${Math.round(lastVisibleBox.x)} width=${Math.round(lastVisibleBox.width)} viewport=${viewport.width}`,
  );
}

async function locatorUsable(locator) {
  if ((await locator.count()) === 0) return false;
  const first = locator.first();
  try {
    return (await first.isVisible()) && (await first.isEnabled());
  } catch {
    return false;
  }
}

async function closeFloatingLayer(page) {
  await page.keyboard.press("Escape");
  await page.mouse.click(4, 4);
  if (settleMs > 0) {
    await page.waitForTimeout(Math.min(settleMs, 250));
  }
}

async function probePopover(page, viewport, route, theme, config) {
  const trigger = page.locator(config.trigger).first();
  if (!(await locatorUsable(trigger))) {
    info(`${viewport.name}/${route.id} 跳过 ${config.state}: trigger 不可用`);
    return false;
  }
  await trigger.click();
  await assertOverlayVisible(page, viewport, route, config.overlay, config.state);
  await saveRouteScreenshot(page, viewport.name, route.id, theme, config.state);
  await closeFloatingLayer(page);
  return true;
}

async function probeButtonOverlay(page, viewport, route, theme, config) {
  const trigger = config.trigger
    ? page.locator(config.trigger).filter({ visible: true }).first()
    : page.getByRole("button", { name: config.roleName }).first();
  if (!(await locatorUsable(trigger))) {
    info(`${viewport.name}/${route.id} 跳过 ${config.state}: trigger 不可用`);
    return false;
  }
  await trigger.click();
  await assertOverlayVisible(page, viewport, route, config.overlay, config.state);
  if (config.requiredField && !(await page.locator(config.requiredField).isVisible().catch(() => false))) {
    fail(`[${viewport.name}/${route.id}] 浮层虽然存在但目标表单字段不可见: ${config.requiredField}`);
  }
  if (config.requiredFooter) {
    const footer = page.locator(config.requiredFooter).last();
    const bounds = await footer.boundingBox();
    if (!bounds || bounds.y < -1 || bounds.y + bounds.height > viewport.height + 1) {
      const metrics = await page.locator('.ops-modal-shell:visible').last().evaluate(element => {
        const modal=element.querySelector('.ant-modal-content');
        const body=element.querySelector('.ant-modal-body');
        const footer=element.querySelector('.ant-modal-footer');
        return {classes:element.className,parents:[element.parentElement?.className,element.parentElement?.parentElement?.className],children:[...element.children].map(child=>child.className),parts:Object.fromEntries([['root',element],['content',modal],['body',body],['footer',footer]].map(([key,node])=>{
          if(!node)return [key,null];
          const rect=node.getBoundingClientRect(),style=getComputedStyle(node);
          return [key,{y:rect.y,height:rect.height,maxHeight:style.maxHeight,overflow:style.overflow,flex:style.flex}];
        }))};
      });
      fail(`[${viewport.name}/${route.id}] 浮层操作栏超出视口: footer=${JSON.stringify(bounds)} metrics=${JSON.stringify(metrics)} viewport=${viewport.width}x${viewport.height}`);
    }
  }
  if (config.requiredField && saveArtifacts) {
    await mkdir(ARTIFACT_ROOT, { recursive: true });
    const filename = screenshotFilename(route.id, theme, viewport.name, config.state);
    const modal = page.locator(config.overlay).filter({ visible: true }).last();
    await modal.screenshot({ path: join(ARTIFACT_ROOT, filename), animations: "disabled" });
    info(`浮层截图已写入 ${join(ARTIFACT_ROOT, filename)}`);
  } else {
    await saveRouteScreenshot(page, viewport.name, route.id, theme, config.state);
  }
  await closeFloatingLayer(page);
  return true;
}

async function probeCreateRoute(page, viewport, route, theme) {
  const trigger = route.createTriggerSelector
    ? page.locator(route.createTriggerSelector).first()
    : page.getByRole("button", { name: /创建/ }).first();
  if (!(await locatorUsable(trigger))) {
    info(`${viewport.name}/${route.id} 跳过 create-route: trigger 不可用`);
    return false;
  }
  const beforeUrl = page.url();
  await trigger.click();
  try {
    await page.waitForURL(/\/workloads\/create|\/resources\/editor|\/create/, { timeout: 5000 });
  } catch (error) {
    fail(`[${viewport.name}/${route.id}] 创建入口未跳转到创建页`, error);
  }
  await page.waitForFunction(() => {
    const text = document.body.innerText;
    return text.includes("Deployment") || text.includes("编辑上下文暂不可用");
  }, null, { timeout });
  const bodyText = (await page.locator("body").innerText({ timeout })).replace(/\s+/g, " ");
  const requiredCreateText = bodyText.includes("编辑上下文暂不可用") ? ["资源编辑器"] : ["创建", "Deployment"];
  for (const text of requiredCreateText) {
    if (!bodyText.includes(text)) {
      fail(`[${viewport.name}/${route.id}] 创建页缺少关键文案: "${text}" body="${bodyText.slice(0, 500)}"`);
    }
  }
  await saveRouteScreenshot(page, viewport.name, route.id, theme, "create-route");
  await page.goto(beforeUrl, { waitUntil: "domcontentloaded", timeout });
  await page.locator(route.shellSelector).first().waitFor({ state: "visible", timeout });
  await page.waitForTimeout(Math.min(settleMs, 1000));
  return true;
}

async function probeOptionalRowDropdownAndYaml(page, viewport, route, theme) {
  const trigger = page.locator('button[aria-label="操作"]:visible, button[aria-label="更多操作"]:visible, button[aria-label$="更多操作"]:visible').first();
  await trigger.waitFor({ state: 'visible', timeout: 5000 }).catch(() => {});
  if (!(await locatorUsable(trigger))) {
    info(`${viewport.name}/${route.id} 跳过 row-dropdown-yaml: 无可用行操作`);
    return false;
  }
  await trigger.click();
  await page.locator('.ant-dropdown:visible').first().waitFor({ state: 'visible', timeout: 1000 });
  await saveRouteScreenshot(page, viewport.name, route.id, theme, "row-dropdown");

  const yamlItem = page.locator('.ant-dropdown:not(.ant-dropdown-hidden) [role="menuitem"]').filter({ hasText: /^YAML$/ }).first();
  await yamlItem.click({ timeout: 3000 });
  await assertOverlayVisible(page, viewport, route, ".ops-drawer-shell--resource, .ops-drawer-shell--editor, .ant-drawer-content", "yaml-drawer");
  await page.getByText('正在读取 YAML', { exact: true }).waitFor({ state: 'hidden', timeout });
  const drawer = page.locator('.ops-drawer-shell--resource:visible').last();
  if (await drawer.locator('.ant-alert-error, .ant-alert-warning').count()) {
    fail(`[${viewport.name}/${route.id}] YAML 读取失败: ${await drawer.innerText()}`);
  }
  await drawer.getByRole('button', { name: /复制/ }).waitFor({ state: 'visible', timeout });
  if (!(await drawer.getByRole('button', { name: /复制/ }).isEnabled())) {
    fail(`[${viewport.name}/${route.id}] YAML 内容未就绪，复制操作仍不可用`);
  }
  await saveRouteScreenshot(page, viewport.name, route.id, theme, "yaml-drawer");
  await closeFloatingLayer(page);
  return true;
}

async function assertOverlayChecks(page, route, viewport, theme) {
  const checks = route.overlayChecks ?? [];
  for (const check of checks) {
    if (check === 'resource-detail') {
      const preferredName = process.env.UI_TECH_DETAIL_NAME?.trim();
      const name = preferredName
        ? page.locator(`.resource-table tbody a.ant-typography:visible, .ops-mobile-resource-card__title a.ant-typography:visible, .ops-mobile-resource-card.is-interactive:visible`).filter({ hasText: preferredName }).first()
        : page.locator('.resource-table tbody a.ant-typography:visible, .ops-mobile-resource-card__title a.ant-typography:visible, .ops-mobile-resource-card.is-interactive:visible').first();
      if (!await name.count()) { info(`${viewport.name}/${route.id} 跳过详情: 未找到目标工作负载`); continue; }
      const before = new URL(page.url()).pathname;
      await name.click();
      const drawer = page.locator('.resource-detail-drawer-wrapper:visible').last();
      await drawer.waitFor({ state: 'visible', timeout });
      await drawer.getByText('正在加载资源详情', { exact: true }).waitFor({ state: 'hidden', timeout });
      if ((await drawer.innerText()).includes('资源详情加载失败')) fail(`[${viewport.name}/${route.id}] 真实详情读取失败`);
      if (route.id === 'deployments') {
        const accessResponse = page.waitForResponse(response => response.url().includes('/resources/access/context'), { timeout });
        for (const tabName of ['Pod 列表', '访问方式']) {
          await drawer.getByRole('tab', { name: tabName, exact: true }).click();
          if (tabName === 'Pod 列表') {
            await drawer.getByText('加载 Pod 列表...', { exact: true }).waitFor({ state: 'hidden', timeout });
            await drawer.locator('.ant-table-tbody .ant-typography:visible').first().waitFor({ state: 'visible', timeout });
          }
          if (tabName === '访问方式') {
            await drawer.getByText('正在读取访问资源及真实关联关系…', { exact: true }).waitFor({ state: 'hidden', timeout });
            const response = await accessResponse;
            const payload = await response.json();
            const data = payload.data ?? payload;
            info(`${viewport.name}/${route.id} access status=${response.status()} lists=${JSON.stringify(data.lists?.map(row => ({ kind: row.kind, count: row.items?.length, incomplete: row.incomplete, error: row.error })))}`);
            if (!response.ok() || data.lists?.some(row => row.incomplete)) fail(`[${viewport.name}/${route.id}] 访问资源读取不完整，不能完成关联验收`);
            const workloads = data.lists?.find(row => row.kind === 'Deployment')?.items ?? [];
            const services = data.lists?.find(row => row.kind === 'Service')?.items ?? [];
            const candidates = workloads.filter(workload => services.some(service => {
              const selector = service.spec?.selector ?? {};
              const labels = workload.spec?.template?.metadata?.labels ?? {};
              return Object.keys(selector).length && Object.entries(selector).every(([key, value]) => labels[key] === value);
            })).map(workload => workload.metadata.name);
            info(`${viewport.name}/${route.id} 有真实 selector 关联服务的 Deployment: ${candidates.join(', ') || '未发现'}`);
          }
          const content = await drawer.innerText();
          if (/加载失败|读取失败|请求失败/.test(content)) fail(`[${viewport.name}/${route.id}] ${tabName} 读取失败`);
          info(`${viewport.name}/${route.id} ${tabName}真实内容: ${content.replace(/\s+/g, ' ').slice(-900)}`);
        }
        if (preferredName) {
          const service = drawer.locator('.ant-table-tbody a:visible').first();
          const serviceName = (await service.innerText()).trim();
          if (!serviceName) fail(`[${viewport.name}/${route.id}] 关联 Service 名称为空`);
          await service.click();
          const serviceDrawer = page.locator('.resource-detail-drawer-wrapper').filter({ has: page.getByText(`Service 详情 · ${serviceName}`, { exact: true }) }).filter({ visible: true }).last();
          await serviceDrawer.waitFor({ state: 'visible', timeout });
          await serviceDrawer.getByText('正在加载资源详情', { exact: true }).waitFor({ state: 'hidden', timeout });
          if ((await serviceDrawer.innerText()).includes('资源详情加载失败')) fail(`[${viewport.name}/${route.id}] 关联 Service 跳转读取失败`);
          await closeFloatingLayer(page);
          await name.click();
          const workloadDrawer = page.locator('.resource-detail-drawer-wrapper:visible').last();
          await workloadDrawer.getByRole('tab', { name: 'Pod 列表', exact: true }).click();
          await workloadDrawer.getByText('加载 Pod 列表...', { exact: true }).waitFor({ state: 'hidden', timeout });
          const pod = workloadDrawer.locator('.ant-table-tbody a:visible').first();
          await pod.waitFor({ state: 'visible', timeout });
          const podName = (await pod.innerText()).trim();
          await pod.click();
          const podDrawer = page.locator('.resource-detail-drawer-wrapper').filter({ has: page.getByText(`Pod 详情 · ${podName}`, { exact: true }) }).filter({ visible: true }).last();
          await podDrawer.waitFor({ state: 'visible', timeout });
          await podDrawer.getByText('正在加载资源详情', { exact: true }).waitFor({ state: 'hidden', timeout });
          if ((await podDrawer.innerText()).includes('资源详情加载失败')) fail(`[${viewport.name}/${route.id}] Pod 名称跳转读取失败`);
          if (process.env.UI_TECH_LIVE_LOGS === '1') {
            let receivedLogFrames = 0;
            const logFrameTypes = {};
            const streamLogSignatures = [];
            let streamLogShape;
            const logSockets = new Set();
            const captureLogsSocket = socket => {
              if (/logs|runtime/.test(socket.url())) {
                logSockets.add(socket);
                socket.on('close', () => logSockets.delete(socket));
                socket.on('framereceived', frame => {
                  receivedLogFrames += 1;
                  try {
                    const payload = JSON.parse(String(frame.payload));
                    const type = payload.type ?? payload.data?.type ?? payload.payload?.type;
                    if (['log', 'system', 'error', 'metadata'].includes(type)) logFrameTypes[type] = (logFrameTypes[type] ?? 0) + 1;
                    if (type === 'log') {
                      const message = payload.content ?? payload.message ?? payload.data?.content ?? payload.data?.message ?? payload.payload?.content ?? payload.payload?.message;
                      const timestamp = payload.timestamp ?? payload.data?.timestamp ?? payload.payload?.timestamp;
                      if (!streamLogShape) streamLogShape = { keys:Object.keys(payload), dataKeys:payload.data&&typeof payload.data==='object'?Object.keys(payload.data):[], payloadKeys:payload.payload&&typeof payload.payload==='object'?Object.keys(payload.payload):[], messageType:typeof message, messageLength:typeof message==='string'?message.length:undefined, timestampType:typeof timestamp };
                      if (typeof message === 'string') streamLogSignatures.push({ signature: `${timestamp ?? ''}|${message.trim()}`, message: message.trim() });
                    }
                  } catch {}
                });
              }
            };
            page.on('websocket', captureLogsSocket);
            const historyResponse = page.waitForResponse(response => new URL(response.url()).pathname.endsWith('/logs') && response.request().method() === 'GET', { timeout });
            await podDrawer.getByRole('tab', { name: '日志', exact: true }).click();
            const logs = page.locator('.ant-modal:visible').last();
            await logs.waitFor({ state: 'visible', timeout });
            await logs.getByText('已连接', { exact: true }).first().waitFor({ state: 'visible', timeout });
            const history = await historyResponse;
            const historyPayload = await history.json();
            const historyData = historyPayload.data ?? historyPayload;
            if (!history.ok() || !Array.isArray(historyData.items)) fail(`[${viewport.name}/${route.id}] 日志历史响应无效`);
            const historySignatures = new Set(historyData.items.map(item => `${item.timestamp ?? ''}|${String(item.message ?? '').trim()}`));
            const historyMessages = new Set(historyData.items.map(item => String(item.message ?? '').trim()));
            info(`${viewport.name}/${route.id} 真实日志历史读取 ${historyData.items.length} 条（不输出正文）`);
            const logFramesAtReady = logFrameTypes.log ?? 0;
            const liveObservationMs = Number.parseInt(process.env.UI_TECH_LOG_SETTLE_MS || '0', 10);
            if (Number.isFinite(liveObservationMs) && liveObservationMs > 0) {
              await page.waitForTimeout(Math.min(liveObservationMs, 15000));
            }
            const liveLogDelta = (logFrameTypes.log ?? 0) - logFramesAtReady;
            const historyOverlap = streamLogSignatures.filter(record =>
              historySignatures.has(record.signature) || historyMessages.has(record.message) ||
              [...historyMessages].some(message => message && record.message.includes(message))
            ).length;
            const unmatchedStreamRecords = streamLogSignatures.length - historyOverlap;
            info(`${viewport.name}/${route.id} 真实日志 WebSocket 接收帧数 ${receivedLogFrames}（不输出正文）`);
            info(`${viewport.name}/${route.id} 日志帧类型数量 ${JSON.stringify(logFrameTypes)}`);
            if (process.env.UI_TECH_REQUIRE_LIVE_LOG_DELTA === '1' && liveLogDelta <= 0) {
              fail(`[${viewport.name}/${route.id}] 观察${liveObservationMs}ms后未收到新的日志帧`);
            }
            info(`${viewport.name}/${route.id} WS日志记录签名：历史重叠 ${historyOverlap}，未匹配历史 ${unmatchedStreamRecords}（不输出正文）`);
            info(`${viewport.name}/${route.id} 日志结构（无正文）：WS ${JSON.stringify(streamLogShape)}，REST ${JSON.stringify(historyData.items[0] ? { keys:Object.keys(historyData.items[0]), messageType:typeof historyData.items[0].message, messageLength:String(historyData.items[0].message??'').length, timestampType:typeof historyData.items[0].timestamp } : null)}`);
            if (process.env.UI_TECH_REQUIRE_LIVE_LOG_DELTA === '1' && unmatchedStreamRecords <= 0) {
              fail(`[${viewport.name}/${route.id}] WebSocket 日志帧全部与历史记录重叠，不能证明实时新增`);
            }
            if (liveObservationMs > 0) info(`${viewport.name}/${route.id} 日志连接后新增帧 ${liveLogDelta}，观察时长 ${Math.min(liveObservationMs, 15000)}ms`);
            await logs.getByRole('button', { name: 'Close', exact: true }).click();
            await podDrawer.waitFor({ state: 'visible', timeout });
            const closeDeadline = Date.now() + 5000;
            while (logSockets.size && Date.now() < closeDeadline) await page.waitForTimeout(50);
            if (logSockets.size) fail(`[${viewport.name}/${route.id}] 日志关闭后 WebSocket 未关闭`);
            page.off('websocket', captureLogsSocket);
            if (new URL(page.url()).pathname !== before) fail(`[${viewport.name}/${route.id}] 日志关闭离开原页面`);
          }
          if (process.env.UI_TECH_LIVE_TERMINAL === '1') {
            await podDrawer.getByRole('tab', { name: '终端', exact: true }).click();
            const terminal = page.locator('.ant-modal:visible').last();
            await terminal.waitFor({ state: 'visible', timeout });
            await terminal.getByText('已连接', { exact: true }).first().waitFor({ state: 'visible', timeout });
            await terminal.getByRole('button', { name: /断开/ }).click();
            await terminal.getByText('已断开', { exact: true }).first().waitFor({ state: 'visible', timeout });
            await terminal.getByRole('button', { name: 'Close', exact: true }).click();
            await podDrawer.waitFor({ state: 'visible', timeout });
            if (new URL(page.url()).pathname !== before) fail(`[${viewport.name}/${route.id}] 终端关闭离开原页面`);
          }
        }
      }
      if (new URL(page.url()).pathname !== before) fail(`[${viewport.name}/${route.id}] 详情切走背景列表`);
      await closeFloatingLayer(page);
      continue;
    }
    if (check === "scope-popover") {
      await probePopover(page, viewport, route, theme, {
        state: "scope-popover",
        trigger: ".resource-scope-filter-button",
        overlay: ".resource-scope-filter-popover",
      });
      continue;
    }
    if (check === "table-search-popover") {
      const search = page.getByRole('textbox', { name: '搜索资源' }).filter({ visible: true }).first();
      if (await search.count()) {
        const before = new URL(page.url()).pathname;
        await search.fill('kubenova-smoke-no-match');
        await search.fill('');
        if (new URL(page.url()).pathname !== before) fail(`[${viewport.name}/${route.id}] 列表搜索离开当前资源页面`);
        continue;
      }
      await probePopover(page, viewport, route, theme, {
        state: "search-popover",
        trigger: 'button[aria-label="搜索"]',
        overlay: ".resource-table-search-popover",
      });
      continue;
    }
    if (check === "table-column-popover") {
      await probePopover(page, viewport, route, theme, {
        state: "column-popover",
        trigger: 'button[aria-label="列设置"]',
        overlay: ".resource-table-column-popover",
      });
      continue;
    }
    if (check === "create-modal") {
      await probeButtonOverlay(page, viewport, route, theme, {
        state: "create-modal",
        trigger: route.createTriggerSelector,
        roleName: /创建/,
        overlay: ".ops-modal-shell, .ant-modal-content, .ant-modal",
        requiredField: route.createFieldSelector,
        requiredFooter: route.createFooterSelector,
      });
      continue;
    }
    if (check === "create-route") {
      await probeCreateRoute(page, viewport, route, theme);
      continue;
    }
    if (check === "ai-settings-drawer") {
      await probeButtonOverlay(page, viewport, route, theme, {
        state: "ai-settings-drawer",
        roleName: "模型设置",
        overlay: ".ops-drawer-shell--business, .ant-drawer-content",
      });
      continue;
    }
    if (check === "ai-alert-drawer") {
      await probeButtonOverlay(page, viewport, route, theme, {
        state: "ai-alert-drawer",
        roleName: "告警接入",
        overlay: ".ops-drawer-shell--business, .ant-drawer-content",
      });
      continue;
    }
    if (check === "row-dropdown-yaml") {
      await probeOptionalRowDropdownAndYaml(page, viewport, route, theme);
      continue;
    }
    fail(`[${viewport.name}/${route.id}] 未知浮层验收项: ${check}`);
  }
}

async function assertRoute(page, route, viewport) {
  await waitForStableRoute(page, route, viewport);

  if (route.requireOpsFrameShell) {
    await assertSelectorVisible(page, viewport, route, ".ops-frame-shell", ".ops-frame-shell");
  }
  await assertSelectorVisible(page, viewport, route, route.toolbarSelector, "工具栏");
  await assertSelectorVisible(page, viewport, route, route.chipSelector, "状态芯片");
  await assertSelectorVisible(page, viewport, route, route.statusSelector, "状态标识");

  const bodyText = (await page.locator("body").innerText({ timeout })).replace(/\s+/g, " ");
  const normalizedBodyText = bodyText.toLowerCase();
  for (const text of route.texts) {
    if (!normalizedBodyText.includes(text.toLowerCase())) {
      fail(`[${viewport.name}/${route.id}] 缺少关键文案: "${text}" body="${bodyText.slice(0, 500)}"`);
    }
  }

  const overflow = await page.evaluate(() => ({
    bodyScrollWidth: Math.ceil(document.body.scrollWidth),
    documentScrollWidth: Math.ceil(document.documentElement.scrollWidth),
    innerWidth: window.innerWidth,
  }));
  if (overflow.bodyScrollWidth > viewport.width + 2) {
    fail(
      `[${viewport.name}/${route.id}] body 横向溢出: body.scrollWidth=${overflow.bodyScrollWidth} viewport=${viewport.width}`,
    );
  }

  info(
    `${viewport.name}/${route.id} 通过 scrollWidth=${overflow.bodyScrollWidth}/${overflow.documentScrollWidth} viewport=${overflow.innerWidth}`,
  );
}

function screenshotFilename(routeId, theme, viewportName, state, suffix = "") {
  return `${routeId}__${themeEvidenceName(theme)}__${viewportName}__${state}${suffix}.png`.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function saveRouteScreenshot(page, viewportName, routeId, theme, state, suffix = "") {
  if (!saveArtifacts) return;
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const filename = screenshotFilename(routeId, theme, viewportName, state, suffix);
  const capturesOverlay = /modal|drawer|popover|dropdown|yaml/.test(state);
  await page.screenshot({ path: join(ARTIFACT_ROOT, filename), fullPage: !capturesOverlay });
  info(`截图已写入 ${join(ARTIFACT_ROOT, filename)}`);
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    const executablePath = resolveChromiumExecutable();
    if (!executablePath) {
      fail(`无法启动 Chromium。请执行: npx playwright install chromium。原因: ${describeError(error)}`);
    }
    info(`Playwright 浏览器缺失，改用系统 Chrome: ${executablePath}`);
    return chromium.launch({
      headless,
      executablePath,
      args: ["--no-sandbox"],
    });
  }
}

async function loadPlaywright() {
  try {
    return await import("playwright");
  } catch (error) {
    const fallbackRoots = [
      process.env.UI_TECH_PLAYWRIGHT_ROOT,
      process.cwd(),
      "/case/kubenova/frontend",
    ].filter(Boolean);

    for (const root of fallbackRoots) {
      try {
        const requireFromRoot = createRequire(join(root, "package.json"));
        return requireFromRoot("playwright");
      } catch {
        // Try next existing dependency root.
      }
    }
    fail("未安装 playwright。请先执行: npm i -D playwright", error);
  }
}

function resolveChromiumExecutable() {
  const candidates = [
    process.env.UI_TECH_CHROMIUM_EXECUTABLE,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
    "/opt/google/chrome/chrome-real",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function applyTheme(page, theme) {
  await page.addInitScript((nextTheme) => {
    window.localStorage.setItem("kubenova-theme-mode", nextTheme);
    document.documentElement?.setAttribute("data-theme", nextTheme);
  }, theme);
}

async function runViewport(browser, viewport, theme) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  await applyTheme(page, theme);
  const capture = installIssueCapture(page, `${themeEvidenceName(theme)}/${viewport.name}`);

  try {
    await ensureLoggedIn(page);
    for (const route of routes) {
      try {
        await assertRoute(page, route, viewport);
        await assertOverlayChecks(page, route, viewport, theme);
        await saveRouteScreenshot(page, viewport.name, route.id, theme, route.evidenceState ?? (route.requireOpsFrameShell ? route.id : "workbench"));
      } catch (error) {
        await saveRouteScreenshot(page, viewport.name, route.id, theme, "error", `-${Date.now()}`);
        throw error;
      }
    }
  } finally {
    await context.close();
  }

  return capture;
}

async function main() {
  const { chromium } = await loadPlaywright();

  info(`baseUrl=${baseUrl}`);
  info(`artifactRoot=${ARTIFACT_ROOT} saveArtifacts=${saveArtifacts}`);
  info(`themes=${themes.map(themeEvidenceName).join(",")}`);
  info(`viewports=${viewports.map((viewport) => `${viewport.name}:${viewport.width}x${viewport.height}`).join(",")}`);
  const browser = await launchBrowser(chromium);
  const captures = [];

  try {
    for (const theme of themes) {
      for (const viewport of viewports) {
        captures.push(await runViewport(browser, viewport, theme));
      }
    }
  } finally {
    await browser.close();
  }

  const consoleIssues = captures.flatMap((capture) => capture.issues);
  const disallowedConsoleIssues = consoleIssues.filter((issue) => !isAllowedConsoleIssue(issue));
  const pageErrors = captures.flatMap((capture) => capture.pageErrors);

  if (disallowedConsoleIssues.length > 0 || pageErrors.length > 0) {
    const consoleSummary = disallowedConsoleIssues
      .slice(0, 5)
      .map((issue) => `${issue.viewport} ${issue.type}: ${issue.text} @ ${issue.url}:${issue.lineNumber}`)
      .join("\n");
    const pageSummary = pageErrors
      .slice(0, 5)
      .map((issue) => `${issue.viewport}: ${issue.text}`)
      .join("\n");
    fail(`浏览器错误超出允许清单\nconsole:\n${consoleSummary || "-"}\npageerror:\n${pageSummary || "-"}`);
  }

  const allowedCount = consoleIssues.length - disallowedConsoleIssues.length;
  info(`全部 smoke 通过。allowedConsoleIssues=${allowedCount}`);
}

main().catch((error) => {
  console.error(`[ui-tech-smoke] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
