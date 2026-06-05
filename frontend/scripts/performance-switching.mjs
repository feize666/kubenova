#!/usr/bin/env node
/**
 * Feature-switching performance probe.
 *
 * Usage:
 *   PERF_BASE_URL=http://127.0.0.1:3000 \
 *   PERF_USER=admin@local.dev \
 *   PERF_PASS=admin123456 \
 *   npm run e2e:performance:switching
 */
import { mkdir, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";

const DEFAULT_ROUTES = [
  "/",
  "/clusters",
  "/workloads/pods",
  "/network/services",
  "/network/topology",
  "/observability",
  "/inspection",
  "/aiops",
  "/ai-assistant",
];

const ROUTE_SECTION_LABELS = [
  { prefix: "/clusters", label: "集群域管理" },
  { prefix: "/namespaces", label: "集群域管理" },
  { prefix: "/workloads/helm", label: "应用交付" },
  { prefix: "/workloads/autoscaling", label: "应用交付" },
  { prefix: "/workloads", label: "工作负载" },
  { prefix: "/network/topology", label: null },
  { prefix: "/network", label: "网络管理" },
  { prefix: "/storage", label: "存储管理" },
  { prefix: "/configs/serviceaccounts", label: "身份与安全" },
  { prefix: "/configs", label: "配置管理" },
  { prefix: "/observability", label: "可观测性" },
  { prefix: "/inspection", label: "可观测性" },
  { prefix: "/aiops", label: "AIOps" },
  { prefix: "/ai-assistant", label: "AIOps" },
  { prefix: "/users", label: "身份与安全" },
  { prefix: "/security", label: "身份与安全" },
  { prefix: "/system", label: "系统管理" },
];

const baseUrl = normalizeBaseUrl(process.env.PERF_BASE_URL || process.env.FILTER_BASE_URL || "http://127.0.0.1:3000");
const username = process.env.PERF_USER || process.env.FILTER_USER || "admin@local.dev";
const password = process.env.PERF_PASS || process.env.FILTER_PASS || "admin123456";
const timeout = readPositiveInt("PERF_TIMEOUT_MS", 20000);
const headless = process.env.PERF_HEADLESS !== "false";
const sampleCount = readPositiveInt("PERF_SAMPLE_COUNT", 5);
const warmupCount = readNonNegativeInt("PERF_WARMUP_COUNT", 1);
const settleMs = readNonNegativeInt("PERF_SETTLE_MS", 150);
const routes = readRoutes();
const outputPath =
  process.env.PERF_OUTPUT ||
  join(
    tmpdir(),
    "k8s-aiops-manager",
    "performance-switching",
    `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}.json`,
  );

function fail(message) {
  throw new Error(message);
}

function info(message) {
  console.log(`[perf-switching] ${message}`);
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

function readRoutes() {
  const raw = process.env.PERF_ROUTES;
  if (!raw) return DEFAULT_ROUTES;
  const parsed = raw
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => (item.startsWith("/") ? item : `/${item}`));
  if (parsed.length === 0) {
    fail("PERF_ROUTES 至少需要一个路由，例如: PERF_ROUTES=/dashboard,/clusters");
  }
  return parsed;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

function routeUrl(route) {
  return `${baseUrl}${route}`;
}

function getRouteSectionLabel(route) {
  return ROUTE_SECTION_LABELS.find((item) => route === item.prefix || route.startsWith(`${item.prefix}/`))?.label ?? null;
}

function samePath(page, route) {
  try {
    return new URL(page.url()).pathname === route;
  } catch {
    return false;
  }
}

async function ensureLoggedIn(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout });
  if (!page.url().includes("/login")) {
    info("检测到已有登录会话");
    return;
  }
  if (!username || !password) {
    fail("需要登录但缺少 PERF_USER/PERF_PASS");
  }

  await page.getByPlaceholder("输入邮箱账号").fill(username);
  await page.getByPlaceholder("输入登录密码").fill(password);
  await Promise.all([
    page.waitForURL(/\/dashboard|\/$/, { timeout }),
    page.getByRole("button", { name: "登录控制台" }).click(),
  ]);
}

async function ensureStillLoggedIn(page) {
  if (!page.url().includes("/login")) {
    return;
  }
  await ensureLoggedIn(page);
}

async function waitForStablePage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout });
  await ensureStillLoggedIn(page);
  await page.locator("main, .ant-layout-content").first().waitFor({ state: "visible", timeout });
  if (settleMs > 0) {
    await page.waitForTimeout(settleMs);
  }
}

async function clickRouteLink(page, route) {
  const selector = `a[href="${route}"], a[href="${routeUrl(route)}"]`;
  let link = page.locator(selector).first();
  try {
    await link.waitFor({ state: "attached", timeout: Math.min(timeout, 2000) });
    await link.scrollIntoViewIfNeeded({ timeout: Math.min(timeout, 2000) });
    await Promise.all([
      page.waitForURL((currentUrl) => currentUrl.pathname === route, { timeout }),
      link.click({ timeout: Math.min(timeout, 5000) }),
    ]);
    return true;
  } catch {
    const sectionLabel = getRouteSectionLabel(route);
    if (!sectionLabel) {
      return false;
    }
    try {
      await page.getByText(sectionLabel, { exact: true }).first().click({ timeout: Math.min(timeout, 2000) });
      link = page.locator(selector).first();
      await link.waitFor({ state: "attached", timeout: Math.min(timeout, 2000) });
      await link.scrollIntoViewIfNeeded({ timeout: Math.min(timeout, 2000) });
      await Promise.all([
        page.waitForURL((currentUrl) => currentUrl.pathname === route, { timeout }),
        link.click({ timeout: Math.min(timeout, 5000) }),
      ]);
      return true;
    } catch {
      return false;
    }
  }
}

async function measureRoute(page, route) {
  const requestStartIndex = page.__perfRequests.length;
  const start = Date.now();
  let navMode = "current";
  if (!samePath(page, route)) {
    if (await clickRouteLink(page, route)) {
      navMode = "click";
    } else {
      navMode = "goto";
      await page.goto(routeUrl(route), { waitUntil: "domcontentloaded", timeout });
    }
  }
  await waitForStablePage(page);
  const routeRequests = page.__perfRequests.slice(requestStartIndex);
  return {
    durationMs: Date.now() - start,
    navMode,
    requestCount: routeRequests.length,
    xhrFetchCount: routeRequests.filter((item) => item.resourceType === "xhr" || item.resourceType === "fetch").length,
  };
}

async function assertBaseReachable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeout, 5000));
  try {
    const response = await fetch(baseUrl, { signal: controller.signal });
    if (response.status >= 500) {
      fail(`PERF_BASE_URL 返回服务端错误: ${baseUrl} status=${response.status}`);
    }
  } catch (error) {
    fail(`无法访问 PERF_BASE_URL=${baseUrl}。请确认前端服务已启动。原因: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("未安装 playwright。请先在 frontend 执行: npm install");
  }

  await assertBaseReachable();

  const browser = await launchBrowser(chromium);
  const page = await browser.newPage();
  page.setDefaultTimeout(timeout);

  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];
  page.__perfRequests = requests;

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("request", (request) => {
    requests.push({
      url: request.url(),
      resourceType: request.resourceType(),
      method: request.method(),
    });
  });

  try {
    info(`baseUrl=${baseUrl} routes=${routes.length} warmup=${warmupCount} samples=${sampleCount}`);
    await ensureLoggedIn(page);

    for (let warmup = 0; warmup < warmupCount; warmup += 1) {
      for (const route of routes) {
        await measureRoute(page, route);
      }
      info(`warmup ${warmup + 1}/${warmupCount} done`);
    }
    requests.length = 0;

    const samples = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      for (const route of routes) {
        const result = await measureRoute(page, route);
        samples.push({ action: "routeSwitch", route, ...result });
        info(`${route} ${result.durationMs}ms mode=${result.navMode} requests=${result.requestCount} xhrFetch=${result.xhrFetchCount}`);
      }
    }

    const durations = samples.map((item) => item.durationMs);
    const summary = {
      baseUrl,
      sampleCount,
      routeCount: routes.length,
      p50Ms: percentile(durations, 50),
      p95Ms: percentile(durations, 95),
      maxMs: Math.max(...durations),
      consoleErrorCount: consoleErrors.length,
      pageErrorCount: pageErrors.length,
      requestCount: requests.length,
      samples,
      consoleErrors,
      pageErrors,
      generatedAt: new Date().toISOString(),
    };

    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
    info(`summary=${outputPath}`);

    if (consoleErrors.length > 0 || pageErrors.length > 0) {
      fail(`detected console/page errors: console=${consoleErrors.length} page=${pageErrors.length}`);
    }
  } finally {
    await browser.close();
  }
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
  const candidates = [
    process.env.PERF_CHROMIUM_EXECUTABLE,
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/opt/google/chrome/chrome",
    "/opt/google/chrome/chrome-real",
  ].filter(Boolean);
  return candidates.find((candidate) => existsSync(candidate)) ?? null;
}

main().catch((error) => {
  console.error(`[perf-switching] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
