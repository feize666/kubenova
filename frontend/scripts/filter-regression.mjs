#!/usr/bin/env node
/**
 * 筛选回归脚本（Playwright）
 *
 * 目标：
 * 1) 验证 URL 恢复：clusterId/namespace/keyword 可从 URL 恢复到页面筛选状态
 * 2) 验证联动：切换集群后 namespace 清空且进入禁用态（无集群时）
 *
 * 用法：
 *   FILTER_BASE_URL=http://127.0.0.1:3000 \
 *   FILTER_USER=admin@example.com \
 *   FILTER_PASS=****** \
 *   npm run e2e:filters
 */
import process from "node:process";

const baseUrl = process.env.FILTER_BASE_URL || "http://127.0.0.1:3000";
const username = process.env.FILTER_USER || "";
const password = process.env.FILTER_PASS || "";
const timeout = Number(process.env.FILTER_TIMEOUT_MS || 15000);
const headless = process.env.FILTER_HEADLESS !== "false";

function fail(message) {
  throw new Error(message);
}

function info(message) {
  console.log(`[filter-e2e] ${message}`);
}

async function ensureLoggedIn(page) {
  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded", timeout });
  if (page.url().includes("/dashboard")) {
    info("检测到已登录态，跳过登录。");
    return;
  }
  if (!username || !password) {
    fail("未登录且缺少 FILTER_USER / FILTER_PASS。");
  }

  await page.getByPlaceholder("输入邮箱账号").fill(username);
  await page.getByPlaceholder("输入登录密码").fill(password);
  await page.getByRole("button", { name: "登录控制台" }).click();
  await page.waitForURL(/\/dashboard/, { timeout });
  info("登录成功。");
}

async function resolveFirstClusterAndNamespace(page) {
  await page.goto(`${baseUrl}/workloads/pods`, { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("networkidle", { timeout });

  const clusterSelect = page.locator(".resource-filter-select").first();
  await clusterSelect.click();
  const clusterOptions = page.locator(".ant-select-dropdown:visible .ant-select-item-option[title]");
  const clusterCount = await clusterOptions.count();
  if (clusterCount <= 1) {
    fail("集群选项不足，无法执行联动回归。");
  }

  let selectedCluster = "";
  for (let i = 0; i < clusterCount; i += 1) {
    const option = clusterOptions.nth(i);
    const text = (await option.innerText()).trim();
    if (text && text !== "全部集群") {
      selectedCluster = text;
      break;
    }
  }
  if (!selectedCluster) {
    fail("未找到可用集群选项。");
  }
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: selectedCluster }).first().click();
  await page.waitForTimeout(400);
  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("clusterId"), { timeout });
  const selectedClusterValue = new URL(page.url()).searchParams.get("clusterId") || "";
  if (!selectedClusterValue) {
    fail("未能从 URL 读取 clusterId。");
  }

  const namespaceSelect = page.locator(".resource-filter-select--namespace").first();
  await namespaceSelect.click();
  const namespaceOptions = page.locator(".ant-select-dropdown:visible .ant-select-item-option[title]");
  const namespaceCount = await namespaceOptions.count();
  if (namespaceCount <= 1) {
    fail(`集群 ${selectedCluster} 下无可选 namespace，无法执行 URL 恢复回归。`);
  }

  let selectedNamespace = "";
  for (let i = 0; i < namespaceCount; i += 1) {
    const option = namespaceOptions.nth(i);
    const text = (await option.innerText()).trim();
    if (text && text !== "全部名称空间") {
      selectedNamespace = text;
      break;
    }
  }
  if (!selectedNamespace) {
    fail("未找到可用 namespace 选项。");
  }
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: selectedNamespace }).first().click();
  await page.waitForFunction(() => new URL(window.location.href).searchParams.get("namespace"), { timeout });
  const selectedNamespaceValue = new URL(page.url()).searchParams.get("namespace") || "";
  if (!selectedNamespaceValue) {
    fail("未能从 URL 读取 namespace。");
  }
  info(`回归样本：cluster="${selectedCluster}" namespace="${selectedNamespace}"`);
  return { selectedCluster, selectedClusterValue, selectedNamespace, selectedNamespaceValue };
}

async function assertUrlRestore(page, clusterName, clusterValue, namespaceName, namespaceValue) {
  const keyword = "pod";
  const url = new URL(`${baseUrl}/workloads/pods`);
  url.searchParams.set("clusterId", clusterValue);
  url.searchParams.set("namespace", namespaceValue);
  url.searchParams.set("keyword", keyword);

  await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("networkidle", { timeout });

  const clusterDisplay = (await page.locator(".resource-filter-select .ant-select-selection-item").first().innerText()).trim();
  if (clusterDisplay !== clusterName) {
    fail(`URL 恢复失败：cluster 期望 "${clusterName}" 实际 "${clusterDisplay}"`);
  }

  const namespaceDisplay = (await page.locator(".resource-filter-select--namespace .ant-select-selection-item").first().innerText()).trim();
  if (namespaceDisplay !== namespaceName) {
    fail(`URL 恢复失败：namespace 期望 "${namespaceName}" 实际 "${namespaceDisplay}"`);
  }

  const keywordValue = await page.getByPlaceholder("按 Pod 名称/标签搜索（示例：nginx app=web env=prod）").inputValue();
  if (keywordValue !== keyword) {
    fail(`URL 恢复失败：keyword 期望 "${keyword}" 实际 "${keywordValue}"`);
  }
  info("URL 恢复校验通过。");
}

async function assertClusterNamespaceLinkage(page) {
  await page.goto(`${baseUrl}/workloads/pods`, { waitUntil: "domcontentloaded", timeout });
  await page.waitForLoadState("networkidle", { timeout });

  const clusterSelect = page.locator(".resource-filter-select").first();
  await clusterSelect.click();
  await page.locator(".ant-select-dropdown:visible .ant-select-item-option", { hasText: "全部集群" }).first().click();
  await page.waitForTimeout(400);

  const namespaceSelect = page.locator(".resource-filter-select--namespace").first();
  const disabledClass = await namespaceSelect.getAttribute("class");
  if (!disabledClass || !disabledClass.includes("ant-select-disabled")) {
    fail("联动失败：切到全部集群后 namespace 未禁用。");
  }

  const namespaceText = await namespaceSelect.innerText();
  if (!namespaceText.includes("先选择集群")) {
    fail(`联动失败：namespace 占位文案异常，当前="${namespaceText.trim()}"`);
  }
  info("联动清空/禁用校验通过。");
}

async function main() {
  let chromium;
  try {
    ({ chromium } = await import("playwright"));
  } catch {
    fail("未安装 playwright。请先执行：npm i -D playwright && npx playwright install chromium");
  }

  const browser = await chromium.launch({ headless });
  const page = await browser.newPage();
  page.setDefaultTimeout(timeout);

  try {
    info(`baseUrl=${baseUrl}`);
    await ensureLoggedIn(page);
    const sample = await resolveFirstClusterAndNamespace(page);
    await assertUrlRestore(
      page,
      sample.selectedCluster,
      sample.selectedClusterValue,
      sample.selectedNamespace,
      sample.selectedNamespaceValue,
    );
    await assertClusterNamespaceLinkage(page);
    info("全部校验通过。");
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(`[filter-e2e] FAIL: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
