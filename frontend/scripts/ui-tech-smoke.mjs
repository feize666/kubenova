#!/usr/bin/env node
/**
 * UI tech refresh browser smoke.
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

const ARTIFACT_ROOT = "/case/temp/kubenova/ui-tech-smoke";
const DEFAULT_RUNTIME_QUERY =
  "clusterId=local&namespace=default&pod=smoke-pod&container=smoke-container&clusterName=local";
const cliOptions = parseCliOptions(process.argv.slice(2));

const baseUrl = normalizeBaseUrl(cliOptions.baseUrl || process.env.UI_TECH_BASE_URL || "http://localhost:3000");
const username = process.env.UI_TECH_USER || "admin@local.dev";
const password = process.env.UI_TECH_PASS || "admin123456";
const timeout = readPositiveInt("UI_TECH_TIMEOUT_MS", 20000);
const settleMs = readNonNegativeInt("UI_TECH_SETTLE_MS", 500);
const headless = process.env.UI_TECH_HEADLESS !== "false";
const saveArtifacts = process.env.UI_TECH_SAVE_ARTIFACTS === "1" || process.env.UI_TECH_SAVE_ARTIFACTS === "true";

const viewports = [
  { name: "desktop", width: 1440, height: 900 },
  { name: "mobile", width: 390, height: 844 },
];

const allRoutes = [
  {
    id: "overview",
    path: "/",
    texts: ["总览", "当前风险态势", "Service Impact", "高频运维入口"],
    shellSelector: ".ops-overview-shell",
    toolbarSelector: ".ops-overview-header",
    chipSelector: ".ops-filter-chip",
    statusSelector: ".ops-status-tag",
  },
  {
    id: "overview-scoped",
    path: "/?clusterId=local",
    texts: ["总览", "Cluster local", "单集群"],
    shellSelector: ".ops-overview-shell",
    toolbarSelector: ".ops-overview-header",
    chipSelector: ".ops-filter-chip",
    statusSelector: ".ops-status-tag",
  },
  {
    id: "terminal",
    path: `/terminal?${DEFAULT_RUNTIME_QUERY}&source=smoke`,
    texts: ["Terminal Workbench", "Cluster", "Namespace default", "Pod smoke-pod", "Container smoke-container"],
    shellSelector: ".ops-frame-shell",
    toolbarSelector: ".ops-frame-shell__toolbar",
    chipSelector: ".ops-frame-shell__chips .ops-filter-chip",
    statusSelector: ".ops-frame-shell__status .ops-status-tag",
    requireOpsFrameShell: true,
  },
  {
    id: "logs",
    path: `/logs?${DEFAULT_RUNTIME_QUERY}&tailLines=100&follow=false&timeMode=quick&from=now-15m&to=now`,
    texts: ["Pod 日志工作区", "default / smoke-pod / smoke-container", "跟随已暂停", "100 行"],
    shellSelector: ".ops-frame-shell",
    toolbarSelector: ".ops-frame-shell__toolbar",
    chipSelector: ".ops-frame-shell__chips .ops-filter-chip",
    statusSelector: ".ops-frame-shell__status .ops-status-tag",
    requireOpsFrameShell: true,
  },
];
const routes = selectRoutes(allRoutes, cliOptions.routes);

function parseCliOptions(args) {
  const options = {
    baseUrl: "",
    routes: "",
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
    if (arg === "--help" || arg === "-h") {
      console.log("Usage: node scripts/ui-tech-smoke.mjs [--base-url URL] [--routes overview,terminal,logs]");
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
  return `${baseUrl}${route.path}`;
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

async function authenticateViaApi(page) {
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
  if (/antd.*space.*deprecated|space.*deprecated.*antd|\[antd:\s*space\].*deprecated/i.test(issue.text)) {
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
    brief.includes("400") ||
    brief.includes("bad request") ||
    brief.includes("kubeconfig") ||
    brief.includes("kube config") ||
    brief.includes("凭据");
  return isRuntimeOrLogs && isExpectedDegrade;
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
    const isAntdSpaceWarning = type === "warning" && /antd.*space.*deprecated|space.*deprecated/i.test(text);
    if (type !== "error" && !isAntdSpaceWarning) {
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

async function maybeSaveFailureScreenshot(page, viewportName, routeId) {
  if (!saveArtifacts) return;
  await mkdir(ARTIFACT_ROOT, { recursive: true });
  const filename = `${viewportName}-${routeId}-${Date.now()}.png`.replace(/[^a-zA-Z0-9._-]/g, "_");
  await page.screenshot({ path: join(ARTIFACT_ROOT, filename), fullPage: true });
  info(`失败截图已写入 ${join(ARTIFACT_ROOT, filename)}`);
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
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

async function runViewport(browser, viewport) {
  const context = await browser.newContext({
    viewport: { width: viewport.width, height: viewport.height },
    deviceScaleFactor: 1,
  });
  const page = await context.newPage();
  page.setDefaultTimeout(timeout);
  const capture = installIssueCapture(page, viewport.name);

  try {
    await ensureLoggedIn(page);
    for (const route of routes) {
      try {
        await assertRoute(page, route, viewport);
      } catch (error) {
        await maybeSaveFailureScreenshot(page, viewport.name, route.id);
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
  const browser = await launchBrowser(chromium);
  const captures = [];

  try {
    for (const viewport of viewports) {
      captures.push(await runViewport(browser, viewport));
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
