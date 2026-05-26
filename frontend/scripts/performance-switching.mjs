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
import { dirname, join } from "node:path";
import process from "node:process";

const baseUrl = process.env.PERF_BASE_URL || process.env.FILTER_BASE_URL || "http://127.0.0.1:3000";
const username = process.env.PERF_USER || process.env.FILTER_USER || "";
const password = process.env.PERF_PASS || process.env.FILTER_PASS || "";
const timeout = Number(process.env.PERF_TIMEOUT_MS || 20000);
const headless = process.env.PERF_HEADLESS !== "false";
const sampleCount = Number(process.env.PERF_SAMPLE_COUNT || 5);
const outputPath =
  process.env.PERF_OUTPUT ||
  join(
    "artifacts",
    "performance",
    new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, ""),
    "route-switch",
    "summary.json",
  );

const routes = [
  "/dashboard",
  "/clusters",
  "/workloads/pods",
  "/network/services",
  "/network/topology",
  "/observability/cluster-health",
  "/ai-assistant",
];

function fail(message) {
  throw new Error(message);
}

function info(message) {
  console.log(`[perf-switching] ${message}`);
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1);
  return sorted[index];
}

async function ensureLoggedIn(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout });
  if (!page.url().includes("/login")) {
    info("detected existing session");
    return;
  }
  if (!username || !password) {
    fail("missing PERF_USER/PERF_PASS for login");
  }

  await page.getByPlaceholder("输入邮箱账号").fill(username);
  await page.getByPlaceholder("输入登录密码").fill(password);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/dashboard|\/$/, { timeout });
}

async function waitForStablePage(page) {
  await page.waitForLoadState("domcontentloaded", { timeout });
  await page.locator("main, .ant-layout-content").first().waitFor({ state: "visible", timeout });
  await page.waitForTimeout(150);
}

async function measureRoute(page, route) {
  const url = `${baseUrl}${route}`;
  const start = Date.now();
  await page.goto(url, { waitUntil: "domcontentloaded", timeout });
  await waitForStablePage(page);
  return Date.now() - start;
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("playwright is not installed. Run: npm i -D playwright && npx playwright install chromium");
  }

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  page.setDefaultTimeout(timeout);

  const consoleErrors = [];
  const pageErrors = [];
  const requests = [];

  page.on("console", (message) => {
    if (message.type() === "error") {
      consoleErrors.push(message.text());
    }
  });
  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });
  page.on("request", (request) => {
    requests.push(request.url());
  });

  try {
    info(`baseUrl=${baseUrl} samples=${sampleCount}`);
    await ensureLoggedIn(page);

    const samples = [];
    for (let sample = 0; sample < sampleCount; sample += 1) {
      for (const route of routes) {
        const durationMs = await measureRoute(page, route);
        samples.push({ action: "routeSwitch", route, durationMs });
        info(`${route} ${durationMs}ms`);
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

main().catch((error) => {
  console.error(`[perf-switching] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
