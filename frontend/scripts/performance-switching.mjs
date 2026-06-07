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
const quietCleanupProbeMs = readNonNegativeInt("PERF_QUIET_CLEANUP_PROBE_MS", 750);
const closedMenuLinkProbeMs = readPositiveInt("PERF_CLOSED_MENU_LINK_PROBE_MS", 80);
const routes = readRoutes();
const outputPath = resolveOutputPath();
const budgets = {
  maxP95Ms: readOptionalPositiveInt("PERF_MAX_P95_MS"),
  maxRouteMs: readOptionalPositiveInt("PERF_MAX_ROUTE_MS"),
  maxRouteRequests: readOptionalNonNegativeInt("PERF_MAX_ROUTE_REQUESTS"),
  maxRouteApiRequests: readOptionalNonNegativeInt("PERF_MAX_ROUTE_API_REQUESTS"),
  maxSlowRequestMs: readOptionalPositiveInt("PERF_MAX_SLOW_REQUEST_MS"),
  maxHeapDeltaBytes: readOptionalNonNegativeInt("PERF_MAX_HEAP_DELTA_BYTES"),
  maxHeapUsedBytes: readOptionalNonNegativeInt("PERF_MAX_HEAP_USED_BYTES"),
  maxHeapUsagePercent: readOptionalNonNegativeInt("PERF_MAX_HEAP_USAGE_PERCENT"),
  requireRouteQuiet: readBoolean("PERF_REQUIRE_ROUTE_QUIET", false),
  maxQuietLeaks: readOptionalNonNegativeInt("PERF_MAX_QUIET_LEAKS"),
  maxConsoleErrors: readOptionalNonNegativeInt("PERF_MAX_CONSOLE_ERRORS") ?? 0,
};

function fail(message, cause) {
  const suffix = cause === undefined ? "" : ` 原因: ${describeError(cause)}`;
  throw new Error(`${message}${suffix}`);
}

function info(message) {
  console.log(`[perf-switching] ${message}`);
}

function describeError(error) {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isConnectionRefused(error) {
  return describeError(error).includes("ERR_CONNECTION_REFUSED");
}

async function pageTextSnippet(page) {
  try {
    const text = await page.locator("body").innerText({ timeout: 1000 });
    return text.replace(/\s+/g, " ").trim().slice(0, 300);
  } catch {
    return "";
  }
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

function readOptionalPositiveInt(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    fail(`${name} 必须是正整数毫秒阈值，当前值: ${raw}`);
  }
  return value;
}

function readOptionalNonNegativeInt(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    fail(`${name} 必须是非负整数阈值，当前值: ${raw}`);
  }
  return value;
}

function readBoolean(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return fallback;
  if (["1", "true", "yes", "on"].includes(raw.toLowerCase())) return true;
  if (["0", "false", "no", "off"].includes(raw.toLowerCase())) return false;
  fail(`${name} 必须是布尔值: true/false/1/0，当前值: ${raw}`);
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

function resolveOutputPath() {
  const explicitPath = process.env.PERF_OUTPUT?.trim();
  if (explicitPath) return explicitPath;

  const outputDir =
    process.env.PERF_OUTPUT_DIR?.trim() || join(process.cwd(), "tmp", "performance-switching");
  return join(outputDir, `${new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "")}.json`);
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

function formatBudgetValue(value) {
  return value === null ? "unset" : String(value);
}

function describeBudgets() {
  return [
    `maxP95Ms=${formatBudgetValue(budgets.maxP95Ms)}`,
    `maxRouteMs=${formatBudgetValue(budgets.maxRouteMs)}`,
    `maxRouteRequests=${formatBudgetValue(budgets.maxRouteRequests)}`,
    `maxRouteApiRequests=${formatBudgetValue(budgets.maxRouteApiRequests)}`,
    `maxSlowRequestMs=${formatBudgetValue(budgets.maxSlowRequestMs)}`,
    `maxHeapDeltaBytes=${formatBudgetValue(budgets.maxHeapDeltaBytes)}`,
    `maxHeapUsedBytes=${formatBudgetValue(budgets.maxHeapUsedBytes)}`,
    `maxHeapUsagePercent=${formatBudgetValue(budgets.maxHeapUsagePercent)}`,
    `requireRouteQuiet=${budgets.requireRouteQuiet}`,
    `maxQuietLeaks=${formatBudgetValue(budgets.maxQuietLeaks)}`,
    `maxConsoleErrors=${budgets.maxConsoleErrors}`,
  ].join(" ");
}

function formatRequestBrief(request) {
  const status = request.status === undefined ? request.failureText || "pending" : request.status;
  return `${request.method} ${request.path} ${request.durationMs ?? "?"}ms status=${status} type=${request.type}`;
}

function formatTimingBrief(timings = {}) {
  return [
    `clickToUrl=${timings.clickToUrlMs ?? "n/a"}ms`,
    `urlToSettle=${timings.urlToSettleMs ?? "n/a"}ms`,
    `dcl=${timings.domContentLoadedWaitMs ?? "n/a"}ms`,
    `ready=${timings.routeReadyWaitMs ?? "n/a"}ms`,
    `settle=${timings.settleDelayMs ?? "n/a"}ms`,
    `quietCleanupProbe=${timings.quietCleanupProbeMs ?? "n/a"}ms`,
  ].join(",");
}

function classifySample(sample) {
  if ((sample.failedRequestCount ?? 0) > 0 || (sample.serverErrorRequestCount ?? 0) > 0) {
    return "network";
  }
  const hasFailedRequest = (sample.topRequests || []).some(
    (request) => request.failureText || (typeof request.status === "number" && request.status >= 500),
  );
  if (hasFailedRequest) return "network";

  const timings = sample.timings || {};
  const clickToUrlMs = timings.clickToUrlMs ?? timings.gotoDomContentLoadedMs ?? 0;
  const urlToSettleMs = timings.urlToSettleMs ?? 0;
  if (clickToUrlMs > Math.max(urlToSettleMs, 0) * 1.5 && clickToUrlMs > 250) {
    return "url-wait";
  }
  if (urlToSettleMs > Math.max(clickToUrlMs, 0) * 1.5 && urlToSettleMs > 250) {
    return "settle";
  }
  if ((sample.longTaskCount ?? 0) > 0 || (sample.longTasks?.maxDurationMs ?? 0) >= 50) {
    return "long-task";
  }
  if (sample.apiRequestCount > 0) return "api";
  return "mixed";
}

function formatSampleBrief(sample) {
  const topRequests = (sample.topRequests || []).slice(0, 3).map(formatRequestBrief).join(" | ");
  const quietState = sample.routeQuiet?.during?.state ?? sample.routeQuiet?.after?.state ?? sample.routeQuiet?.state ?? "unknown";
  const quietLeak = sample.routeQuiet?.leaked === true ? "leaked" : "ok";
  return [
    `${sample.route}:${sample.durationMs}ms`,
    `cause=${classifySample(sample)}`,
    `mode=${sample.navMode}`,
    `timings=(${formatTimingBrief(sample.timings)})`,
    `requests=${sample.requestCount}`,
    `api=${sample.apiRequestCount}`,
    `xhrFetch=${sample.xhrFetchCount}`,
    `failed=${sample.failedRequestCount ?? 0}`,
    `5xx=${sample.serverErrorRequestCount ?? 0}`,
    `longTasks=${sample.longTaskCount ?? "?"}/${sample.longTaskMaxMs ?? "?"}ms`,
    `heap=${sample.jsHeap?.supported ? `${sample.jsHeap.deltaUsedBytes ?? "?"}B/${sample.jsHeap.afterUsedBytes ?? "?"}B` : "unsupported"}`,
    `quiet=${quietState}/${quietLeak}`,
    topRequests ? `top=[${topRequests}]` : "",
  ]
    .filter(Boolean)
    .join(" ");
}

function summarizeSlowSamples(samples, limit = 8) {
  return [...samples].sort((left, right) => right.durationMs - left.durationMs).slice(0, limit).map(formatSampleBrief);
}

function summarizeSlowRequests(samples, limit = 12) {
  return samples
    .flatMap((sample) =>
      (sample.topRequests || []).map((request) => ({
        route: sample.route,
        ...request,
      })),
    )
    .filter((request) => request.durationMs !== undefined)
    .sort((left, right) => right.durationMs - left.durationMs)
    .slice(0, limit)
    .map((request) => `${request.route} ${formatRequestBrief(request)}`);
}

function summarizeHeapSamples(samples) {
  const supportedSamples = samples.filter((sample) => sample.jsHeap?.supported === true);
  if (supportedSamples.length === 0) {
    return { supported: false, sampleCount: 0 };
  }
  const deltas = supportedSamples.map((sample) => sample.jsHeap.deltaUsedBytes ?? 0);
  const afterUsed = supportedSamples.map((sample) => sample.jsHeap.afterUsedBytes ?? 0);
  const usagePercent = supportedSamples
    .map((sample) => {
      const limit = sample.jsHeap.jsHeapSizeLimit;
      if (!limit) return null;
      return Math.round(((sample.jsHeap.afterUsedBytes ?? 0) / limit) * 100);
    })
    .filter((value) => value !== null);
  return {
    supported: true,
    sampleCount: supportedSamples.length,
    maxDeltaUsedBytes: Math.max(...deltas),
    minDeltaUsedBytes: Math.min(...deltas),
    p95DeltaUsedBytes: percentile(deltas, 95),
    maxAfterUsedBytes: Math.max(...afterUsed),
    p95AfterUsedBytes: percentile(afterUsed, 95),
    maxUsagePercent: usagePercent.length > 0 ? Math.max(...usagePercent) : null,
  };
}

function summarizeQuietSamples(samples) {
  const duringMissing = samples
    .filter((sample) => sample.routeQuiet?.during?.state !== "present")
    .map((sample) => `${sample.route}:${sample.routeQuiet?.during?.state ?? "unknown"}`);
  const leaked = samples
    .filter((sample) => sample.routeQuiet?.leaked === true)
    .map((sample) => `${sample.route}:${sample.routeQuiet?.after?.state ?? "unknown"}`);
  return {
    duringMissingCount: duringMissing.length,
    leakCount: leaked.length,
    duringMissing: duringMissing.slice(0, 12),
    leaked: leaked.slice(0, 12),
  };
}

function assessPerformanceBudgets(summary) {
  const failures = [];
  if (budgets.maxP95Ms !== null && summary.p95Ms > budgets.maxP95Ms) {
    failures.push(`p95Ms=${summary.p95Ms}ms > PERF_MAX_P95_MS=${budgets.maxP95Ms}ms slowest=${summary.slowestSamples[0] ?? ""}`);
  }
  if (budgets.maxRouteMs !== null) {
    const slowRoutes = summary.samples
      .filter((sample) => sample.durationMs > budgets.maxRouteMs)
      .sort((left, right) => right.durationMs - left.durationMs);
    if (slowRoutes.length > 0) {
      const examples = slowRoutes.slice(0, 5).map(formatSampleBrief).join("; ");
      failures.push(`route samples over PERF_MAX_ROUTE_MS=${budgets.maxRouteMs}ms count=${slowRoutes.length} slowest=${examples}`);
    }
  }
  if (budgets.maxRouteRequests !== null) {
    const heavyRoutes = summary.samples
      .filter((sample) => sample.requestCount > budgets.maxRouteRequests)
      .sort((left, right) => right.requestCount - left.requestCount);
    if (heavyRoutes.length > 0) {
      failures.push(
        `route request budget exceeded PERF_MAX_ROUTE_REQUESTS=${budgets.maxRouteRequests} count=${heavyRoutes.length} heaviest=${heavyRoutes
          .slice(0, 5)
          .map(formatSampleBrief)
          .join("; ")}`,
      );
    }
  }
  if (budgets.maxRouteApiRequests !== null) {
    const apiHeavyRoutes = summary.samples
      .filter((sample) => sample.apiRequestCount > budgets.maxRouteApiRequests)
      .sort((left, right) => right.apiRequestCount - left.apiRequestCount);
    if (apiHeavyRoutes.length > 0) {
      failures.push(
        `route API budget exceeded PERF_MAX_ROUTE_API_REQUESTS=${budgets.maxRouteApiRequests} count=${apiHeavyRoutes.length} heaviest=${apiHeavyRoutes
          .slice(0, 5)
          .map(formatSampleBrief)
          .join("; ")}`,
      );
    }
  }
  if (budgets.maxSlowRequestMs !== null) {
    const slowRequests = summary.samples
      .flatMap((sample) => (sample.topRequests || []).map((request) => ({ route: sample.route, ...request })))
      .filter((request) => (request.durationMs ?? 0) > budgets.maxSlowRequestMs)
      .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0));
    if (slowRequests.length > 0) {
      failures.push(
        `slow request budget exceeded PERF_MAX_SLOW_REQUEST_MS=${budgets.maxSlowRequestMs}ms count=${slowRequests.length} slowest=${slowRequests
          .slice(0, 5)
          .map((request) => `${request.route} ${formatRequestBrief(request)}`)
          .join("; ")}`,
      );
    }
  }
  if (budgets.maxHeapDeltaBytes !== null) {
    const heavyHeapSamples = summary.samples
      .filter((sample) => sample.jsHeap?.supported === true && (sample.jsHeap.deltaUsedBytes ?? 0) > budgets.maxHeapDeltaBytes)
      .sort((left, right) => (right.jsHeap?.deltaUsedBytes ?? 0) - (left.jsHeap?.deltaUsedBytes ?? 0));
    if (heavyHeapSamples.length > 0) {
      failures.push(
        `heap delta budget exceeded PERF_MAX_HEAP_DELTA_BYTES=${budgets.maxHeapDeltaBytes} count=${heavyHeapSamples.length} heaviest=${heavyHeapSamples
          .slice(0, 5)
          .map(formatSampleBrief)
          .join("; ")}`,
      );
    }
  }
  if (budgets.maxHeapUsedBytes !== null) {
    const highHeapSamples = summary.samples
      .filter((sample) => sample.jsHeap?.supported === true && (sample.jsHeap.afterUsedBytes ?? 0) > budgets.maxHeapUsedBytes)
      .sort((left, right) => (right.jsHeap?.afterUsedBytes ?? 0) - (left.jsHeap?.afterUsedBytes ?? 0));
    if (highHeapSamples.length > 0) {
      failures.push(
        `heap used budget exceeded PERF_MAX_HEAP_USED_BYTES=${budgets.maxHeapUsedBytes} count=${highHeapSamples.length} highest=${highHeapSamples
          .slice(0, 5)
          .map(formatSampleBrief)
          .join("; ")}`,
      );
    }
  }
  if (budgets.maxHeapUsagePercent !== null && summary.heap.supported && summary.heap.maxUsagePercent !== null) {
    if (summary.heap.maxUsagePercent > budgets.maxHeapUsagePercent) {
      failures.push(
        `heap usage budget exceeded maxUsagePercent=${summary.heap.maxUsagePercent}% > PERF_MAX_HEAP_USAGE_PERCENT=${budgets.maxHeapUsagePercent}%`,
      );
    }
  }
  if (budgets.requireRouteQuiet && summary.quiet.duringMissingCount > 0) {
    failures.push(
      `route quiet marker missing count=${summary.quiet.duringMissingCount} examples=${summary.quiet.duringMissing.join("; ")}`,
    );
  }
  if (budgets.maxQuietLeaks !== null && summary.quiet.leakCount > budgets.maxQuietLeaks) {
    failures.push(
      `route quiet marker leak count=${summary.quiet.leakCount} > PERF_MAX_QUIET_LEAKS=${budgets.maxQuietLeaks} examples=${summary.quiet.leaked.join("; ")}`,
    );
  }
  if (summary.consoleErrorCount > budgets.maxConsoleErrors) {
    failures.push(
      `consoleErrorCount=${summary.consoleErrorCount} > PERF_MAX_CONSOLE_ERRORS=${budgets.maxConsoleErrors} firstConsole="${summary.consoleErrors[0] ?? ""}" slowest=${summary.slowestSamples[0] ?? ""}`,
    );
  }
  if (summary.pageErrorCount > 0) {
    failures.push(`pageErrorCount=${summary.pageErrorCount} > 0 firstPage="${summary.pageErrors[0] ?? ""}" slowest=${summary.slowestSamples[0] ?? ""}`);
  }
  return failures;
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
  await page.goto(`${baseUrl}/dashboard`, { waitUntil: "domcontentloaded", timeout });
  await ensureStillLoggedIn(page);
  info("API 登录已写入浏览器会话");
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

function summarizeRequests(routeRequests) {
  return routeRequests
    .filter((item) => item.resourceType === "xhr" || item.resourceType === "fetch" || item.url.includes("/_next/"))
    .map((item) => {
      let path = item.url;
      try {
        const parsed = new URL(item.url);
        path = `${parsed.pathname}${parsed.search}`;
      } catch {
        path = item.url;
      }
      return {
        method: item.method,
        path: path.length > 140 ? `${path.slice(0, 137)}...` : path,
        type: item.resourceType,
        status: item.status,
        failureText: item.failureText,
        durationMs: item.durationMs,
      };
    })
    .sort((left, right) => (right.durationMs ?? 0) - (left.durationMs ?? 0))
    .slice(0, 8);
}

function countApiRequests(routeRequests) {
  return routeRequests.filter((item) => {
    try {
      return new URL(item.url).pathname.startsWith("/api/");
    } catch {
      return item.url.includes("/api/");
    }
  }).length;
}

async function ensureRouteProbe(page) {
  await page.addInitScript(() => {
    window.__perfSwitchingProbe = {
      installedAt: performance.now(),
      longTasks: [],
      longTaskSupported: false,
      longTaskError: "",
    };
    try {
      if ("PerformanceObserver" in window) {
        const observer = new PerformanceObserver((list) => {
          for (const entry of list.getEntries()) {
            window.__perfSwitchingProbe.longTasks.push({
              name: entry.name,
              startTime: entry.startTime,
              duration: entry.duration,
            });
          }
        });
        observer.observe({ type: "longtask", buffered: true });
        window.__perfSwitchingProbe.longTaskSupported = true;
        window.__perfSwitchingProbe.longTaskObserver = observer;
      }
    } catch (error) {
      window.__perfSwitchingProbe.longTaskError = error instanceof Error ? error.message : String(error);
    }
  });
}

async function readRouteProbeSnapshot(page) {
  return page.evaluate(() => {
    const probe = window.__perfSwitchingProbe || {
      longTasks: [],
      longTaskSupported: false,
      longTaskError: "probe-not-installed",
    };
    const memory = performance.memory;
    const htmlClass = document.documentElement.className || "";
    const bodyClass = document.body?.className || "";
    const classText = `${htmlClass} ${bodyClass}`;
    const quietDataset = {
      htmlRouteQuiet: document.documentElement.dataset.routeQuiet,
      bodyRouteQuiet: document.body?.dataset.routeQuiet,
      htmlRouteTransitionQuiet: document.documentElement.dataset.routeTransitionQuiet,
      bodyRouteTransitionQuiet: document.body?.dataset.routeTransitionQuiet,
    };
    const quietClassNames = classText
      .split(/\s+/)
      .filter((item) => item.toLowerCase().includes("quiet") || item.toLowerCase().includes("transition"))
      .slice(0, 20);
    const activeDataset = Object.entries(quietDataset).filter(([, value]) => value !== undefined && value !== "");
    return {
      now: performance.now(),
      timeOrigin: performance.timeOrigin,
      longTasks: [...probe.longTasks],
      longTaskSupported: probe.longTaskSupported === true,
      longTaskError: probe.longTaskError || "",
      jsHeap: memory
        ? {
            supported: true,
            usedJSHeapSize: memory.usedJSHeapSize,
            totalJSHeapSize: memory.totalJSHeapSize,
            jsHeapSizeLimit: memory.jsHeapSizeLimit,
          }
        : { supported: false },
      routeQuiet: {
        state: activeDataset.length > 0 || quietClassNames.length > 0 ? "present" : "none",
        classNames: quietClassNames,
        dataset: Object.fromEntries(activeDataset),
      },
    };
  });
}

async function safeReadRouteProbeSnapshot(page) {
  try {
    return await readRouteProbeSnapshot(page);
  } catch (error) {
    return {
      now: 0,
      timeOrigin: 0,
      longTasks: [],
      longTaskSupported: false,
      longTaskError: describeError(error),
      jsHeap: { supported: false },
      routeQuiet: { state: "unreadable", classNames: [], dataset: {} },
    };
  }
}

function summarizeLongTasks(before, after) {
  const beforeTime = before?.timeOrigin === after?.timeOrigin ? before?.now ?? 0 : 0;
  const afterTasks = Array.isArray(after?.longTasks) ? after.longTasks : [];
  const sampleTasks = afterTasks.filter((item) => item.startTime >= beforeTime);
  const durations = sampleTasks.map((item) => Math.round(item.duration));
  return {
    supported: after?.longTaskSupported === true,
    error: after?.longTaskError || "",
    count: sampleTasks.length,
    maxDurationMs: durations.length > 0 ? Math.max(...durations) : 0,
    totalDurationMs: durations.reduce((sum, item) => sum + item, 0),
    top: sampleTasks
      .map((item) => ({
        name: item.name,
        startMs: Math.round(item.startTime - beforeTime),
        durationMs: Math.round(item.duration),
      }))
      .sort((left, right) => right.durationMs - left.durationMs)
      .slice(0, 5),
  };
}

function summarizeHeap(before, after) {
  if (before?.jsHeap?.supported !== true || after?.jsHeap?.supported !== true) {
    return { supported: false };
  }
  return {
    supported: true,
    beforeUsedBytes: before.jsHeap.usedJSHeapSize,
    afterUsedBytes: after.jsHeap.usedJSHeapSize,
    deltaUsedBytes: after.jsHeap.usedJSHeapSize - before.jsHeap.usedJSHeapSize,
    totalJSHeapSize: after.jsHeap.totalJSHeapSize,
    jsHeapSizeLimit: after.jsHeap.jsHeapSizeLimit,
  };
}

async function ensureLoggedIn(page) {
  if (!username || !password) {
    fail("需要登录但缺少 PERF_USER/PERF_PASS");
  }
  try {
    await authenticateViaApi(page);
    return;
  } catch (error) {
    info(`API 登录不可用，回退 UI 登录: ${describeError(error)}`);
  }

  const loginUrl = `${baseUrl}/login`;
  try {
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout });
  } catch (error) {
    fail(`登录页不可达: url=${loginUrl} timeout=${timeout}ms`, error);
  }
  if (!page.url().includes("/login")) {
    info("检测到已有登录会话");
    return;
  }

  try {
    await page.waitForLoadState("networkidle", { timeout });
    await page.waitForFunction(() => document.querySelector("form button[type='submit']") !== null, null, { timeout });
    await page.getByPlaceholder("输入邮箱账号").fill(username);
    await page.getByPlaceholder("输入登录密码").fill(password);
  } catch (error) {
    const snippet = await pageTextSnippet(page);
    fail(`登录表单未就绪: url=${page.url()} 需要 placeholder=输入邮箱账号/输入登录密码 body="${snippet}"`, error);
  }

  try {
    const loginForm = page.locator("form").filter({ has: page.getByPlaceholder("输入登录密码") }).first();
    const submitButton = loginForm.locator('button[type="submit"]').first();
    await Promise.all([
      page.waitForURL(/\/dashboard|\/$/, { timeout }),
      submitButton.click(),
    ]);
  } catch (error) {
    const snippet = await pageTextSnippet(page);
    fail(`登录失败: user=${username} expect=/dashboard|/ current=${page.url()} timeout=${timeout}ms body="${snippet}"`, error);
  }
}

async function ensureStillLoggedIn(page) {
  if (!page.url().includes("/login")) {
    return;
  }
  await ensureLoggedIn(page);
}

async function waitForStablePage(page) {
  const timings = {};
  let stageStart = Date.now();
  try {
    await page.waitForLoadState("domcontentloaded", { timeout });
    timings.domContentLoadedWaitMs = Date.now() - stageStart;
  } catch (error) {
    fail(`页面加载未完成: url=${page.url()} timeout=${timeout}ms`, error);
  }
  stageStart = Date.now();
  await ensureStillLoggedIn(page);
  timings.loginGuardWaitMs = Date.now() - stageStart;
  stageStart = Date.now();
  try {
    await page.locator("main, .ant-layout-content").first().waitFor({ state: "visible", timeout });
    timings.routeReadyWaitMs = Date.now() - stageStart;
  } catch (error) {
    const snippet = await pageTextSnippet(page);
    fail(`页面主体未出现: url=${page.url()} selector="main, .ant-layout-content" body="${snippet}"`, error);
  }
  if (settleMs > 0) {
    stageStart = Date.now();
    await page.waitForTimeout(settleMs);
    timings.settleDelayMs = Date.now() - stageStart;
  } else {
    timings.settleDelayMs = 0;
  }
  return timings;
}

async function clickRouteLink(page, route) {
  const selector = `a[href="${route}"], a[href="${routeUrl(route)}"]`;
  const result = {
    ok: false,
    urlWaitMs: null,
    linkProbeMs: 0,
    sectionOpenMs: 0,
    sectionLabel: null,
  };
  let link = page.locator(selector).first();
  let stageStart = Date.now();
  try {
    await link.waitFor({ state: "attached", timeout: Math.min(timeout, closedMenuLinkProbeMs) });
    await link.scrollIntoViewIfNeeded({ timeout: Math.min(timeout, closedMenuLinkProbeMs) });
    result.linkProbeMs = Date.now() - stageStart;
    stageStart = Date.now();
    await Promise.all([
      page.waitForURL((currentUrl) => currentUrl.pathname === route, { timeout }),
      link.click({ timeout: Math.min(timeout, 5000) }),
    ]);
    result.urlWaitMs = Date.now() - stageStart;
    result.ok = true;
    return result;
  } catch {
    result.linkProbeMs = Date.now() - stageStart;
    const sectionLabel = getRouteSectionLabel(route);
    if (!sectionLabel) {
      return result;
    }
    result.sectionLabel = sectionLabel;
    try {
      stageStart = Date.now();
      await page.getByText(sectionLabel, { exact: true }).first().click({ timeout: Math.min(timeout, 2000) });
      result.sectionOpenMs = Date.now() - stageStart;
      link = page.locator(selector).first();
      stageStart = Date.now();
      await link.waitFor({ state: "attached", timeout: Math.min(timeout, 2000) });
      await link.scrollIntoViewIfNeeded({ timeout: Math.min(timeout, 2000) });
      result.linkProbeMs += Date.now() - stageStart;
      stageStart = Date.now();
      await Promise.all([
        page.waitForURL((currentUrl) => currentUrl.pathname === route, { timeout }),
        link.click({ timeout: Math.min(timeout, 5000) }),
      ]);
      result.urlWaitMs = Date.now() - stageStart;
      result.ok = true;
      return result;
    } catch {
      return result;
    }
  }
}

async function measureRoute(page, route) {
  const requestStartIndex = page.__perfRequests.length;
  const start = Date.now();
  const probeBefore = await safeReadRouteProbeSnapshot(page);
  const timings = {
    clickToUrlMs: null,
    urlToSettleMs: null,
    domContentLoadedWaitMs: null,
    routeReadyWaitMs: null,
    settleDelayMs: null,
    quietCleanupProbeMs: null,
    linkProbeMs: null,
    sectionOpenMs: null,
    gotoDomContentLoadedMs: null,
  };
  let urlSettledAt = start;
  let navMode = "current";
  try {
    if (!samePath(page, route)) {
      const clickResult = await clickRouteLink(page, route);
      timings.linkProbeMs = clickResult.linkProbeMs;
      timings.sectionOpenMs = clickResult.sectionOpenMs;
      if (clickResult.ok) {
        navMode = "click";
        timings.clickToUrlMs = clickResult.urlWaitMs;
        urlSettledAt = Date.now();
      } else {
        navMode = "goto";
        const gotoStart = Date.now();
        await page.goto(routeUrl(route), { waitUntil: "domcontentloaded", timeout });
        timings.gotoDomContentLoadedMs = Date.now() - gotoStart;
        urlSettledAt = Date.now();
      }
    } else {
      timings.clickToUrlMs = 0;
      urlSettledAt = Date.now();
    }
  } catch (error) {
    if (!isConnectionRefused(error)) {
      fail(`路由切换失败: route=${route} stage=url-wait mode=${navMode} from=${page.url()} target=${routeUrl(route)} timeout=${timeout}ms`, error);
    }
    info(`检测到前端连接拒绝，等待恢复后重试 route=${route}`);
    const retryStart = Date.now();
    await waitForBaseReachable(`route=${route}`);
    timings.networkRecoveryWaitMs = Date.now() - retryStart;
    navMode = "goto-retry";
    try {
      const gotoStart = Date.now();
      await page.goto(routeUrl(route), { waitUntil: "domcontentloaded", timeout });
      timings.gotoDomContentLoadedMs = Date.now() - gotoStart;
      urlSettledAt = Date.now();
    } catch (retryError) {
      fail(`路由切换重试失败: route=${route} stage=url-wait mode=${navMode} from=${page.url()} target=${routeUrl(route)} timeout=${timeout}ms`, retryError);
    }
  }
  let stableTimings;
  try {
    stableTimings = await waitForStablePage(page);
  } catch (error) {
    fail(`路由稳定等待失败: route=${route} stage=settle mode=${navMode} current=${page.url()}`, error);
  }
  Object.assign(timings, stableTimings);
  timings.urlToSettleMs = Date.now() - urlSettledAt;
  const measuredDurationMs = Date.now() - start;
  const probeDuringSettle = await safeReadRouteProbeSnapshot(page);
  const routeRequests = page.__perfRequests.slice(requestStartIndex);
  if (quietCleanupProbeMs > 0) {
    const quietCleanupStart = Date.now();
    await page.waitForTimeout(quietCleanupProbeMs);
    timings.quietCleanupProbeMs = Date.now() - quietCleanupStart;
  } else {
    timings.quietCleanupProbeMs = 0;
  }
  const probeAfterCleanup = await safeReadRouteProbeSnapshot(page);
  const longTasks = summarizeLongTasks(probeBefore, probeDuringSettle);
  const jsHeap = summarizeHeap(probeBefore, probeDuringSettle);
  const failedRequestCount = routeRequests.filter((item) => item.failureText).length;
  const serverErrorRequestCount = routeRequests.filter((item) => typeof item.status === "number" && item.status >= 500).length;
  const routeQuiet = {
    during: probeDuringSettle.routeQuiet,
    after: probeAfterCleanup.routeQuiet,
    leaked: probeAfterCleanup.routeQuiet?.state === "present",
  };
  return {
    durationMs: measuredDurationMs,
    navMode,
    timings,
    requestCount: routeRequests.length,
    xhrFetchCount: routeRequests.filter((item) => item.resourceType === "xhr" || item.resourceType === "fetch").length,
    apiRequestCount: countApiRequests(routeRequests),
    failedRequestCount,
    serverErrorRequestCount,
    topRequests: summarizeRequests(routeRequests),
    longTasks,
    longTaskCount: longTasks.count,
    longTaskMaxMs: longTasks.maxDurationMs,
    jsHeap,
    routeQuiet,
  };
}

async function assertBaseReachable() {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Math.min(timeout, 5000));
  let response;
  try {
    response = await fetch(baseUrl, { signal: controller.signal });
  } catch (error) {
    const timeoutMs = Math.min(timeout, 5000);
    fail(`无法访问 PERF_BASE_URL=${baseUrl}。请确认前端服务已启动且地址可达，探测超时=${timeoutMs}ms`, error);
  } finally {
    clearTimeout(timer);
  }
  if (response.status >= 500) {
    fail(`PERF_BASE_URL 返回服务端错误: ${baseUrl} status=${response.status} statusText=${response.statusText}`);
  }
}

async function waitForBaseReachable(reason) {
  const deadline = Date.now() + timeout;
  let lastError;
  while (Date.now() < deadline) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    try {
      const response = await fetch(baseUrl, { signal: controller.signal });
      if (response.status < 500) {
        return;
      }
      lastError = new Error(`status=${response.status}`);
    } catch (error) {
      lastError = error;
    } finally {
      clearTimeout(timer);
    }
    await sleep(500);
  }
  fail(`前端服务未恢复: baseUrl=${baseUrl} reason=${reason}`, lastError);
}

async function writeSummary(summary) {
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  info(`summary=${outputPath}`);
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch (error) {
    fail("未安装 playwright。请先在 frontend 执行: npm install；若已安装依赖，请确认从仓库根或 frontend workspace 运行", error);
  }

  await assertBaseReachable();

  const browser = await launchBrowser(chromium);
  const page = await browser.newPage();
  page.setDefaultTimeout(timeout);
  await ensureRouteProbe(page);

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
      startedAt: Date.now(),
    });
  });
  page.on("requestfinished", async (request) => {
    const item = [...requests].reverse().find((entry) => entry.url === request.url() && entry.method === request.method() && !entry.finishedAt);
    if (item) {
      item.finishedAt = Date.now();
      item.durationMs = item.finishedAt - item.startedAt;
      try {
        item.status = (await request.response())?.status();
      } catch {
        item.status = undefined;
      }
    }
  });
  page.on("requestfailed", (request) => {
    const item = [...requests].reverse().find((entry) => entry.url === request.url() && entry.method === request.method() && !entry.finishedAt);
    if (item) {
      item.finishedAt = Date.now();
      item.durationMs = item.finishedAt - item.startedAt;
      item.failureText = request.failure()?.errorText;
    }
  });

  try {
    info(`baseUrl=${baseUrl} routes=${routes.length} warmup=${warmupCount} samples=${sampleCount} budgets=(${describeBudgets()})`);
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
        info(
          `${route} ${result.durationMs}ms cause=${classifySample({ route, ...result })} mode=${result.navMode} timings=(${formatTimingBrief(
            result.timings,
          )}) requests=${result.requestCount} xhrFetch=${result.xhrFetchCount} failed=${result.failedRequestCount} 5xx=${
            result.serverErrorRequestCount
          } longTasks=${result.longTaskCount}/${result.longTaskMaxMs}ms heap=${
            result.jsHeap?.supported ? `${result.jsHeap.deltaUsedBytes}B/${result.jsHeap.afterUsedBytes}B` : "unsupported"
          } quiet=${result.routeQuiet?.during?.state ?? "unknown"}/${result.routeQuiet?.leaked ? "leaked" : "ok"}`,
        );
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
      heap: summarizeHeapSamples(samples),
      quiet: summarizeQuietSamples(samples),
      budgets,
      samples,
      slowestSamples: summarizeSlowSamples(samples),
      slowestRequests: summarizeSlowRequests(samples),
      consoleErrors,
      pageErrors,
      generatedAt: new Date().toISOString(),
    };

    const budgetFailures = assessPerformanceBudgets(summary);
    summary.budgetFailures = budgetFailures;
    if (budgetFailures.length > 0) {
      await writeSummary(summary);
      fail(`performance budget failed: ${budgetFailures.join("; ")}`);
    }

    await writeSummary(summary);
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
