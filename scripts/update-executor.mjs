#!/usr/bin/env node
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, readdir, stat, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);
const port = Number(process.env.KUBENOVA_UPDATE_EXECUTOR_PORT || 4200);
const token = (process.env.KUBENOVA_UPDATE_EXECUTOR_TOKEN || "").trim();
const composeFile = process.env.KUBENOVA_UPDATE_COMPOSE_FILE || "/opt/kubenova/deploy/docker/docker-compose.prod.yml";
const envFile = process.env.KUBENOVA_UPDATE_ENV_FILE || "/etc/kubenova/docker.env";
const scriptFile = process.env.KUBENOVA_UPDATE_COMPOSE_SCRIPT || "/opt/kubenova/scripts/compose-release.sh";
const stateDir = process.env.KUBENOVA_UPDATE_STATE_DIR || "/var/lib/kubenova/update-executor";
const stateFile = join(stateDir, "tasks.json");
const currentFile = join(stateDir, "current-version");
const tasks = new Map();
let activeTask = null;

const stableTag = (value) => typeof value === "string" && /^v(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:\.(?:0|[1-9]\d*))?$/.test(value);
const safeReleaseUrl = (value, asset) => typeof value === "string" && value.startsWith("https://github.com/") && value.includes("/releases/download/") && value.endsWith(asset);

async function persist() {
  await mkdir(stateDir, { recursive: true });
  await writeFile(stateFile, JSON.stringify([...tasks.values()].slice(-100), null, 2), { mode: 0o600 });
}

async function load() {
  try {
    const rows = JSON.parse(await readFile(stateFile, "utf8"));
    if (Array.isArray(rows)) for (const row of rows) if (row?.taskId) tasks.set(row.taskId, row);
  } catch { /* first start */ }
}

function setTask(task, patch) {
  Object.assign(task, patch);
  void persist();
}

async function envValue(name) {
  try {
    const text = await readFile(envFile, "utf8");
    const row = text.split(/\r?\n/).find((line) => line.trim().startsWith(name + "="));
    return row ? row.slice(row.indexOf("=") + 1).trim().replace(/^['"]|['"]$/g, "") : "";
  } catch { return ""; }
}

async function run(command, args, options = {}) {
  return exec(command, args, { timeout: 20 * 60 * 1000, maxBuffer: 2 * 1024 * 1024, ...options });
}

async function backup(task) {
  setTask(task, { phase: "backing-up", percent: 10, message: "正在备份 PostgreSQL" });
  await mkdir(join(stateDir, "backups"), { recursive: true });
  const user = await envValue("POSTGRES_USER") || "kubenova";
  const database = await envValue("POSTGRES_DB") || "kubenova";
  const password = await envValue("POSTGRES_PASSWORD");
  const file = join(stateDir, "backups", task.taskId + ".sql");
  const result = await run("docker", ["compose", "-f", composeFile, "--env-file", envFile, "exec", "-T", "-e", "PGPASSWORD=" + password, "postgres", "pg_dump", "-U", user, "-d", database], { encoding: "buffer" });
  await writeFile(file, result.stdout, { mode: 0o600 });
  await pruneBackups();
  setTask(task, { backupFile: file, percent: 25, message: "PostgreSQL 备份完成" });
}

async function pruneBackups() {
  const dir = join(stateDir, "backups");
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".sql")) continue;
    const path = join(dir, entry.name);
    files.push({ path, mtime: (await stat(path)).mtimeMs });
  }
  files.sort((left, right) => right.mtime - left.mtime);
  const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
  for (const [index, file] of files.entries()) {
    if (index >= 5 && file.mtime < cutoff) await rm(file.path, { force: true });
  }
}

async function download(task) {
  setTask(task, { phase: "downloading", percent: 35, message: "正在下载并校验发布包" });
  const release = task.release;
  if (!safeReleaseUrl(release?.downloadUrl, "kubenova-ubuntu.tar.gz") || !safeReleaseUrl(release?.checksumUrl, "kubenova-ubuntu.tar.gz.sha256"))
    throw new Error("发布资产地址不受信任");
  const dir = join(stateDir, "downloads", task.taskId);
  await mkdir(dir, { recursive: true });
  for (const [url, name] of [[release.downloadUrl, "kubenova-ubuntu.tar.gz"], [release.checksumUrl, "kubenova-ubuntu.tar.gz.sha256"]]) {
    const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(10 * 60 * 1000) });
    if (!response.ok) throw new Error("发布包下载失败（HTTP " + response.status + "）");
    await writeFile(join(dir, name), Buffer.from(await response.arrayBuffer()), { mode: 0o600 });
  }
  await run("sha256sum", ["-c", "kubenova-ubuntu.tar.gz.sha256"], { cwd: dir });
  setTask(task, { downloadDir: dir, phase: "verifying", percent: 50, message: "SHA256 校验通过" });
}

async function execute(task) {
  const previous = existsSync(currentFile) ? (await readFile(currentFile, "utf8")).trim() : await envValue("KUBENOVA_IMAGE_TAG");
  task.previousVersion = stableTag(previous) ? previous : null;
  await backup(task);
  await download(task);
  setTask(task, { phase: "switching", percent: 65, message: "正在切换 Docker Compose 服务" });
  await run("bash", [scriptFile, "up", "--tag", task.targetVersion, "--env-file", envFile]);
  setTask(task, { phase: "health-check", percent: 90, message: "服务健康检查通过" });
  await writeFile(currentFile, task.targetVersion + "\n", { mode: 0o600 });
  setTask(task, { status: "succeeded", phase: "completed", percent: 100, message: "升级完成" });
}

async function rollback(task) {
  if (!stableTag(task.targetVersion)) throw new Error("回滚版本无效");
  setTask(task, { phase: "switching", percent: 60, message: "正在回滚应用镜像" });
  await run("bash", [scriptFile, "rollback", task.targetVersion, "--env-file", envFile]);
  await writeFile(currentFile, task.targetVersion + "\n", { mode: 0o600 });
  setTask(task, { status: "succeeded", phase: "completed", percent: 100, message: "回滚完成" });
}

async function runTask(task) {
  activeTask = task.taskId;
  setTask(task, { status: "running", phase: "preparing", percent: 0, startedAt: new Date().toISOString() });
  try {
    if (task.action === "install") await execute(task);
    else await rollback(task);
  } catch (error) {
    setTask(task, { status: "failed", phase: "failed", message: error instanceof Error ? error.message : "任务失败" });
    if (task.action === "install" && task.previousVersion) {
      try {
        setTask(task, { phase: "rollbacking", message: "升级失败，正在自动回滚应用镜像" });
        await run("bash", [scriptFile, "rollback", task.previousVersion, "--env-file", envFile]);
        setTask(task, { rolledBack: true, message: "升级失败，应用镜像已自动回滚" });
      } catch {
        setTask(task, { message: "升级和自动回滚均失败，请立即检查主机服务" });
      }
    }
  } finally {
    activeTask = null;
    await persist();
  }
}

function authorized(request) {
  return Boolean(token) && request.headers.authorization === "Bearer " + token;
}

async function body(request) {
  let data = "";
  for await (const chunk of request) {
    data += chunk;
    if (data.length > 1024 * 1024) throw new Error("请求过大");
  }
  return JSON.parse(data || "{}");
}

function json(response, status, payload) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  response.end(JSON.stringify(payload));
}

const server = createServer(async (request, response) => {
  if (!authorized(request)) return json(response, 401, { message: "unauthorized" });
  const path = request.url?.split("?")[0] || "/";
  if (request.method === "POST" && path === "/v1/system-update/tasks") {
    if (activeTask) return json(response, 409, { message: "another update task is running" });
    try {
      const input = await body(request);
      if (!["install", "rollback"].includes(input.action) || !stableTag(input.targetVersion))
        return json(response, 400, { message: "invalid update task" });
      if (input.action === "install" && (!safeReleaseUrl(input.release?.downloadUrl, "kubenova-ubuntu.tar.gz") || !safeReleaseUrl(input.release?.checksumUrl, "kubenova-ubuntu.tar.gz.sha256")))
        return json(response, 400, { message: "untrusted release assets" });
      const task = { taskId: randomUUID(), action: input.action, targetVersion: input.targetVersion, release: input.release, operator: input.operator || "unknown", status: "queued", phase: "queued", percent: 0, message: null, createdAt: new Date().toISOString() };
      tasks.set(task.taskId, task);
      await persist();
      void runTask(task);
      return json(response, 202, task);
    } catch (error) {
      return json(response, 400, { message: error instanceof Error ? error.message : "invalid request" });
    }
  }
  const match = path.match(/^\/v1\/system-update\/tasks\/([^/]+)$/);
  if (request.method === "GET" && match) {
    const task = tasks.get(decodeURIComponent(match[1]));
    return task ? json(response, 200, task) : json(response, 404, { message: "task not found" });
  }
  return json(response, 404, { message: "not found" });
});

await load();
if (!token) throw new Error("KUBENOVA_UPDATE_EXECUTOR_TOKEN must be configured");
await mkdir(dirname(stateFile), { recursive: true });
server.listen(port, "127.0.0.1", () => console.log("update executor listening on 127.0.0.1:" + port));
