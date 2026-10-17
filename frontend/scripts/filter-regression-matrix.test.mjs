import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
import test from "node:test";

const script = new URL("./filter-regression-matrix.mjs", import.meta.url);
const source = readFileSync(script, "utf8").replace(/^import .*;\n/gm, "").replace(/main\(\)\.catch\([\s\S]*$/, "");
const context = vm.createContext({ process, URL, URLSearchParams, existsSync, console });
vm.runInContext(`${source}\nthis.matrix = { ALL_CASES, requestHasParam, resolveChromiumExecutable, isConcreteNamespace: typeof isConcreteNamespace === 'function' ? isConcreteNamespace : undefined, requestMatchesCase: typeof requestMatchesCase === 'function' ? requestMatchesCase : undefined, assertSuccessfulListResponse: typeof assertSuccessfulListResponse === 'function' ? assertSuccessfulListResponse : undefined };`, context);
const matrix = context.matrix;
const pod = matrix.ALL_CASES.find(item => item.id === "workloads-pods");
const sample = { clusterId: "cluster-a", namespace: "prod" };
const request = (path, params = {}, method = "GET") => ({ url: () => `http://localhost${path}?${new URLSearchParams(params)}`, method: () => method, resourceType: () => "fetch", postData: () => null });

test("list mode rejects removed routes without starting a browser", () => {
  for (const id of ["workloads-helm", "network-ingressroute"]) {
    const result = spawnSync(process.execPath, [script.pathname], { env: { ...process.env, FILTER_MODE: "list", FILTER_CASES: id }, encoding: "utf8" });
    assert.equal(result.status, 1);
    assert.match(result.stderr, /未知用例/);
  }
});

test("namespace sample rejects all-namespace labels and empty options", () => {
  assert.equal(typeof matrix.isConcreteNamespace, "function");
  for (const value of ["", " ", "全部命名空间", "全部名称空间"]) assert.equal(matrix.isConcreteNamespace(value), false);
  assert.equal(matrix.isConcreteNamespace("prod"), true);
});

test("case matching rejects unrelated endpoint, kind, writes and partial filters", () => {
  assert.equal(typeof matrix.requestMatchesCase, "function");
  const params = { ...sample, kind: "Pod", keyword: "probe" };
  assert.equal(matrix.requestMatchesCase(request("/api/workloads", params), pod, sample, "probe"), true);
  for (const req of [request("/api/clusters", params), request("/api/workloads", { ...params, kind: "Deployment" }), request("/api/workloads", params, "POST"), request("/api/workloads", { ...params, keyword: "probe-extra" })]) {
    assert.equal(matrix.requestMatchesCase(req, pod, sample, "probe"), false);
  }
});

test("list responses must be successful JSON lists, including successful empty results", async () => {
  assert.equal(typeof matrix.assertSuccessfulListResponse, "function");
  const response = (status, payload) => ({ ok: () => status >= 200 && status < 300, status: () => status, json: async () => payload, url: () => "http://localhost/api/workloads" });
  await matrix.assertSuccessfulListResponse(response(200, { items: [], total: 0 }), pod);
  for (const item of [response(403, { message: "Forbidden" }), response(200, { success: false, items: [] }), response(200, { message: "not a list" })]) await assert.rejects(matrix.assertSuccessfulListResponse(item, pod));
});

test("parameter matching does not accept malformed or substring body values", () => {
  const req = body => ({ url: () => "http://localhost/api/workloads", postData: () => body, postDataJSON: () => JSON.parse(body) });
  assert.equal(matrix.requestHasParam(req("keyword=probe-extra"), "keyword", "probe"), false);
  assert.doesNotThrow(() => matrix.requestHasParam(req("%broken"), "keyword", "probe"));
});

test("Chrome fallback includes the installed macOS application", () => {
  const mac = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
  const sandbox = vm.createContext({ process: { env: {} }, URL, URLSearchParams, console, existsSync: path => path === mac });
  vm.runInContext(`${source}\nthis.chrome = resolveChromiumExecutable();`, sandbox);
  assert.equal(sandbox.chrome, mac);
});
