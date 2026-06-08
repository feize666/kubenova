#!/usr/bin/env node
/**
 * 全站筛选联动回归（矩阵版）
 *
 * 覆盖目标：
 * 1) URL 恢复：clusterId/namespace/keyword
 * 2) 触发取数：点击“查询”后，XHR/FETCH 请求包含筛选参数
 *
 * 运行：
 *   FILTER_BASE_URL=http://127.0.0.1:3000 \
 *   FILTER_USER=admin@example.com \
 *   FILTER_PASS=****** \
 *   npm run e2e:filters:matrix
 *
 * 可选：
 *   FILTER_CASES=workloads-pods,network-services   # 仅跑部分用例
 *   FILTER_HEADLESS=false                          # 有头模式
 *   FILTER_TIMEOUT_MS=20000
 *   FILTER_MODE=list                               # 仅输出清单，不执行浏览器
 */
import { existsSync } from "node:fs";
import process from "node:process";

const baseUrl = process.env.FILTER_BASE_URL || "http://127.0.0.1:3000";
const username = process.env.FILTER_USER || "admin@local.dev";
const password = process.env.FILTER_PASS || "admin123456";
const timeout = Number(process.env.FILTER_TIMEOUT_MS || 20000);
const headless = process.env.FILTER_HEADLESS !== "false";
const mode = process.env.FILTER_MODE || "run";
const keyword = process.env.FILTER_KEYWORD || "codex-filter-e2e";

/** @typedef {"cluster-namespace" | "cluster-only"} Scope */

/**
 * @typedef CaseItem
 * @property {string} id
 * @property {string} title
 * @property {string} path
 * @property {Scope} scope
 */

/** @type {CaseItem[]} */
const ALL_CASES = [
  { id: "workloads-deployments", title: "Workloads / Deployments", path: "/workloads/deployments", scope: "cluster-namespace" },
  { id: "workloads-pods", title: "Workloads / Pods", path: "/workloads/pods", scope: "cluster-namespace" },
  { id: "workloads-statefulsets", title: "Workloads / StatefulSets", path: "/workloads/statefulsets", scope: "cluster-namespace" },
  { id: "workloads-daemonsets", title: "Workloads / DaemonSets", path: "/workloads/daemonsets", scope: "cluster-namespace" },
  { id: "workloads-replicasets", title: "Workloads / ReplicaSets", path: "/workloads/replicasets", scope: "cluster-namespace" },
  { id: "workloads-jobs", title: "Workloads / Jobs", path: "/workloads/jobs", scope: "cluster-namespace" },
  { id: "workloads-cronjobs", title: "Workloads / CronJobs", path: "/workloads/cronjobs", scope: "cluster-namespace" },
  { id: "workloads-helm", title: "Workloads / Helm", path: "/workloads/helm", scope: "cluster-namespace" },
  { id: "workloads-autoscaling-hpa", title: "Workloads / Autoscaling HPA", path: "/workloads/autoscaling/hpa", scope: "cluster-namespace" },
  { id: "workloads-autoscaling-vpa", title: "Workloads / Autoscaling VPA", path: "/workloads/autoscaling/vpa", scope: "cluster-namespace" },
  { id: "network-services", title: "Network / Services", path: "/network/services", scope: "cluster-namespace" },
  { id: "network-endpoints", title: "Network / Endpoints", path: "/network/endpoints", scope: "cluster-namespace" },
  { id: "network-endpointslices", title: "Network / EndpointSlices", path: "/network/endpointslices", scope: "cluster-namespace" },
  { id: "network-networkpolicy", title: "Network / NetworkPolicy", path: "/network/networkpolicy", scope: "cluster-namespace" },
  { id: "network-ingress", title: "Network / Ingress", path: "/network/ingress", scope: "cluster-namespace" },
  { id: "network-ingressroute", title: "Network / IngressRoute", path: "/network/ingressroute", scope: "cluster-namespace" },
  { id: "network-gateway-api", title: "Network / Gateway API", path: "/network/gateway-api", scope: "cluster-namespace" },
  { id: "storage-pv", title: "Storage / PV", path: "/storage/pv", scope: "cluster-only" },
  { id: "storage-pvc", title: "Storage / PVC", path: "/storage/pvc", scope: "cluster-namespace" },
  { id: "storage-sc", title: "Storage / SC", path: "/storage/sc", scope: "cluster-only" },
  { id: "configs-configmaps", title: "Configs / ConfigMaps", path: "/configs/configmaps", scope: "cluster-namespace" },
  { id: "configs-secrets", title: "Configs / Secrets", path: "/configs/secrets", scope: "cluster-namespace" },
  { id: "configs-serviceaccounts", title: "Configs / ServiceAccounts", path: "/configs/serviceaccounts", scope: "cluster-namespace" },
  { id: "security-events", title: "Security / Events", path: "/security", scope: "cluster-namespace" },
  { id: "namespaces", title: "Namespaces", path: "/namespaces", scope: "cluster-only" },
];

function info(message) {
  console.log(`[filters-matrix] ${message}`);
}

function fail(message) {
  throw new Error(message);
}

function describeError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

async function launchBrowser(chromium) {
  try {
    return await chromium.launch({ headless });
  } catch (error) {
    const executablePath = resolveChromiumExecutable();
    if (!executablePath) {
      fail(`无法启动 Chromium。请执行: npx playwright install chromium。原因: ${error instanceof Error ? error.message : String(error)}`);
    }
    info(`Playwright 浏览器缺失，改用系统 Chrome: ${executablePath}`);
    return chromium.launch({
      headless,
      executablePath,
      args: ["--no-sandbox"],
    });
  }
}

function resolveChromiumExecutable() {
  return [
    process.env.CHROME_BIN,
    process.env.CHROMIUM_BIN,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
    "/opt/google/chrome/chrome-real",
  ].find((item) => item && existsSync(item));
}

function parseCaseFilter(input) {
  if (!input?.trim()) return ALL_CASES;
  const wanted = new Set(
    input
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
  );
  const filtered = ALL_CASES.filter((item) => wanted.has(item.id));
  const missing = [...wanted].filter((id) => !filtered.find((item) => item.id === id));
  if (missing.length) fail(`FILTER_CASES 含未知用例: ${missing.join(", ")}`);
  return filtered;
}

function hasKeyValueInObject(obj, key, expectedValue) {
  if (obj === null || obj === undefined) return false;
  if (Array.isArray(obj)) {
    return obj.some((item) => hasKeyValueInObject(item, key, expectedValue));
  }
  if (typeof obj !== "object") return false;

  for (const [k, value] of Object.entries(obj)) {
    if (k === key && String(value) === expectedValue) {
      return true;
    }
    if (typeof value === "object" && value !== null && hasKeyValueInObject(value, key, expectedValue)) {
      return true;
    }
  }
  return false;
}

function requestHasParam(request, key, expectedValue) {
  const url = new URL(request.url());
  const fromUrl = url.searchParams.get(key);
  if (fromUrl === expectedValue) return true;

  const postData = request.postData();
  if (!postData) return false;

  try {
    const form = new URLSearchParams(postData);
    if (form.get(key) === expectedValue) return true;
  } catch {
    // ignore form parse error
  }

  try {
    const jsonBody = request.postDataJSON();
    if (hasKeyValueInObject(jsonBody, key, expectedValue)) return true;
  } catch {
    // ignore json parse error
  }

  const normalized = decodeURIComponent(postData).toLowerCase();
  const needle = `${key.toLowerCase()}=${expectedValue.toLowerCase()}`;
  const jsonNeedle = `"${key.toLowerCase()}":"${expectedValue.toLowerCase()}"`;
  return normalized.includes(needle) || normalized.includes(jsonNeedle);
}

function captureApiRequests(page) {
  const requests = [];
  const listener = (request) => {
    const type = request.resourceType();
    if (type === "xhr" || type === "fetch") {
      requests.push(request);
    }
  };
  page.on("request", listener);
  return {
    requests,
    stop() {
      page.off("request", listener);
    },
  };
}

async function waitForPageReady(page) {
  await page.locator("main, .ant-layout-content").first().waitFor({ state: "visible", timeout });
  await page.waitForTimeout(300);
}

async function ensureLoggedIn(page) {
  try {
    await authenticateViaApi(page);
    return;
  } catch (error) {
    info(`API 登录不可用，回退 UI 登录: ${describeError(error)}`);
  }

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout });
  if (page.url().includes("/dashboard")) {
    info("检测到已登录态，跳过登录");
    return;
  }

  if (!username || !password) {
    fail("未登录且缺少 FILTER_USER / FILTER_PASS");
  }

  await page.getByPlaceholder("输入邮箱账号").fill(username);
  await page.getByPlaceholder("输入登录密码").fill(password);
  const loginForm = page.locator("form").filter({ has: page.getByPlaceholder("输入登录密码") }).first();
  await loginForm.locator('button[type="submit"]').first().click();
  await page.waitForURL(/\/dashboard/, { timeout });
  info("登录成功");
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

async function authenticateViaApi(page) {
  const response = await fetch(`${baseUrl}/api/v1/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  const payload = await response.json();
  if (!response.ok) {
    fail(`API 登录失败: status=${response.status} body=${JSON.stringify(payload).slice(0, 300)}`);
  }
  const snapshot = readAuthSnapshot(payload);
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
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout });
  info("API 登录已写入浏览器会话");
}

async function resolveSampleClusterAndNamespace(page) {
  await page.goto(`${baseUrl}/workloads/pods`, { waitUntil: "domcontentloaded", timeout });
  await waitForPageReady(page);

  const scopeTrigger = page.getByRole("button", { name: /资源范围/ }).first();
  if ((await scopeTrigger.count()) > 0) {
    await scopeTrigger.click();
  }

  const clusterSelect = page.locator(".resource-filter-select").first();
  await clusterSelect.click();
  const clusterOptions = page.locator(".ant-select-dropdown:visible .ant-select-item-option[title]");
  const clusterCount = await clusterOptions.count();
  if (clusterCount <= 1) {
    fail("集群选项不足，无法回归");
  }

  let clusterName = "";
  for (let i = 0; i < clusterCount; i += 1) {
    const name = (await clusterOptions.nth(i).innerText()).trim();
    if (name && name !== "全部集群") {
      clusterName = name;
      break;
    }
  }
  if (!clusterName) fail("未找到可用集群选项");

  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: clusterName }).first().click();
  await page.waitForTimeout(300);
  const applyButton = page.getByRole("button", { name: "应用", exact: true }).first();
  if ((await applyButton.count()) > 0) {
    await applyButton.click();
  }
  await page.waitForFunction(() => Boolean(new URL(window.location.href).searchParams.get("clusterId")), { timeout });
  const clusterId = new URL(page.url()).searchParams.get("clusterId") || "";
  if (!clusterId) fail("未能解析 clusterId");

  if ((await scopeTrigger.count()) > 0) {
    await scopeTrigger.click();
  }
  const namespaceSelect = page.locator(".resource-filter-select--namespace").first();
  await namespaceSelect.click();
  const namespaceOptions = page.locator(".ant-select-dropdown:visible .ant-select-item-option[title]");
  const namespaceCount = await namespaceOptions.count();
  if (namespaceCount <= 1) {
    fail(`集群 ${clusterName} 下无可用 namespace`);
  }

  let namespaceName = "";
  for (let i = 0; i < namespaceCount; i += 1) {
    const name = (await namespaceOptions.nth(i).innerText()).trim();
    if (name && name !== "全部名称空间") {
      namespaceName = name;
      break;
    }
  }
  if (!namespaceName) fail("未找到可用 namespace");

  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: namespaceName }).first().click();
  const namespaceApplyButton = page.getByRole("button", { name: "应用", exact: true }).first();
  if ((await namespaceApplyButton.count()) > 0) {
    await namespaceApplyButton.click();
  }
  await page.waitForFunction(() => Boolean(new URL(window.location.href).searchParams.get("namespace")), { timeout });
  const namespace = new URL(page.url()).searchParams.get("namespace") || "";
  if (!namespace) fail("未能解析 namespace");

  info(`样本集群=${clusterName}(${clusterId})，样本名称空间=${namespaceName}(${namespace})`);
  return { clusterName, clusterId, namespaceName, namespace };
}

async function locateKeywordInput(page) {
  const byPlaceholder = page.locator('input[placeholder*="搜索"]');
  if ((await byPlaceholder.count()) > 0) {
    return byPlaceholder.first();
  }
  const fallback = page.locator(".ant-input-affix-wrapper input");
  if ((await fallback.count()) > 0) {
    return fallback.first();
  }
  fail("未找到搜索输入框");
}

async function clickSearchButton(page) {
  const button = page.getByRole("button", { name: "查询", exact: true }).first();
  if ((await button.count()) === 0) {
    fail("未找到查询按钮");
  }
  await button.click();
}

async function assertUrlRestore(page, testCase, sample) {
  const targetUrl = new URL(`${baseUrl}${testCase.path}`);
  targetUrl.searchParams.set("clusterId", sample.clusterId);
  targetUrl.searchParams.set("keyword", keyword);
  if (testCase.scope === "cluster-namespace") {
    targetUrl.searchParams.set("namespace", sample.namespace);
  }

  await page.goto(targetUrl.toString(), { waitUntil: "domcontentloaded", timeout });
  await waitForPageReady(page);

  const actual = new URL(page.url()).searchParams;
  if (actual.get("clusterId") !== sample.clusterId) {
    fail(`[${testCase.id}] URL恢复失败: clusterId`);
  }
  if (testCase.scope === "cluster-namespace" && actual.get("namespace") !== sample.namespace) {
    fail(`[${testCase.id}] URL恢复失败: namespace`);
  }
  if (actual.get("keyword") !== keyword) {
    fail(`[${testCase.id}] URL恢复失败: keyword`);
  }

  const keywordInput = await locateKeywordInput(page);
  const value = await keywordInput.inputValue();
  if (value !== keyword) {
    fail(`[${testCase.id}] URL恢复失败: 输入框值=${value}`);
  }
}

async function assertFetchTriggeredByFilters(page, testCase, sample) {
  const collector = captureApiRequests(page);
  try {
    await clickSearchButton(page);
    await page.waitForTimeout(1200);

    if (!collector.requests.length) {
      fail(`[${testCase.id}] 点击查询后未捕获到任何 XHR/FETCH`);
    }

    const matched = collector.requests.find((request) => {
      const hasCluster = requestHasParam(request, "clusterId", sample.clusterId);
      const hasKeyword = requestHasParam(request, "keyword", keyword);
      const hasNamespace =
        testCase.scope === "cluster-namespace" ? requestHasParam(request, "namespace", sample.namespace) : true;
      return hasCluster && hasKeyword && hasNamespace;
    });

    if (!matched) {
      const preview = collector.requests
        .slice(0, 6)
        .map((request) => request.url())
        .join(" | ");
      fail(`[${testCase.id}] 未发现包含筛选参数的取数请求。采样请求: ${preview || "无"}`);
    }
  } finally {
    collector.stop();
  }
}

async function runCase(page, testCase, sample) {
  info(`开始: ${testCase.id} -> ${testCase.path}`);
  await assertUrlRestore(page, testCase, sample);
  await assertFetchTriggeredByFilters(page, testCase, sample);
  info(`通过: ${testCase.id}`);
}

async function main() {
  const selectedCases = parseCaseFilter(process.env.FILTER_CASES || "");
  if (mode === "list") {
    info(`模式=list，总用例=${selectedCases.length}`);
    selectedCases.forEach((item) => {
      console.log(`${item.id}\t${item.path}\t${item.scope}`);
    });
    return;
  }

  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("未安装 playwright。请先执行：npm i -D playwright && npx playwright install chromium");
  }

  const browser = await launchBrowser(chromium);
  const page = await browser.newPage();
  page.setDefaultTimeout(timeout);

  const passed = [];
  const failed = [];

  try {
    info(`baseUrl=${baseUrl} cases=${selectedCases.length} headless=${headless}`);
    await ensureLoggedIn(page);
    const sample = await resolveSampleClusterAndNamespace(page);

    for (const testCase of selectedCases) {
      try {
        await runCase(page, testCase, sample);
        passed.push(testCase.id);
      } catch (error) {
        failed.push({
          id: testCase.id,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } finally {
    await browser.close();
  }

  info(`完成: 通过=${passed.length} 失败=${failed.length}`);
  if (failed.length) {
    failed.forEach((item) => {
      console.error(`[filters-matrix] FAIL ${item.id}: ${item.message}`);
    });
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(`[filters-matrix] FATAL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
