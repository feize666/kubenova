import assert from "node:assert/strict";
import test from "node:test";
import {
  createTablePreferencesClient,
  type TablePreferences,
} from "./table-preferences";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

function preferenceResponse(value: TablePreferences) {
  return Response.json({
    data: { tableKey: "pods", value, updatedAt: "2026-10-11T00:00:00Z" },
  });
}

const visible = { columnVisibility: { namespace: true }, filterRowVisible: true };
const hidden = { columnVisibility: { namespace: false }, filterRowVisible: false };

test("a late read cannot replace preferences saved while that read was pending", async (t) => {
  const originalFetch = globalThis.fetch;
  const pendingRead = deferred<Response>();
  let reads = 0;
  const writes: Array<{ method: string | undefined; body: unknown }> = [];
  globalThis.fetch = async (_url, init) => {
    if (init?.method === "GET") {
      reads += 1;
      return pendingRead.promise;
    }
    writes.push({ method: init?.method, body: JSON.parse(String(init?.body)) });
    return preferenceResponse(hidden);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = createTablePreferencesClient("late-read-token")!;
  const firstRead = client.loadTablePreferences!("pods");
  await client.saveTablePreferences!("pods", hidden);
  assert.deepEqual(writes, [{ method: "PUT", body: { value: hidden } }]);
  pendingRead.resolve(preferenceResponse(visible));
  await firstRead;
  assert.deepEqual(await client.loadTablePreferences!("pods"), hidden);
  assert.equal(reads, 1, "saved preferences remain cached without another fetch");
});

test("a pending read failure cannot discard a newer local save", async (t) => {
  const originalFetch = globalThis.fetch;
  const pendingRead = deferred<Response>();
  globalThis.fetch = async (_url, init) => init?.method === "GET"
    ? pendingRead.promise
    : preferenceResponse(hidden);
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = createTablePreferencesClient("late-read-failure-token")!;
  const firstRead = client.loadTablePreferences!("pods");
  await client.saveTablePreferences!("pods", hidden);
  pendingRead.resolve(Response.json({ message: "Unavailable" }, { status: 503 }));
  assert.equal(await firstRead, null);
  assert.deepEqual(await client.loadTablePreferences!("pods"), hidden);
});

test("failed persistence still keeps the latest local preference", async (t) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_url, init) => init?.method === "GET"
    ? preferenceResponse(visible)
    : Response.json({ message: "Unavailable" }, { status: 503 });
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = createTablePreferencesClient("failed-save-token")!;
  assert.deepEqual(await client.loadTablePreferences!("pods"), visible);
  await client.saveTablePreferences!("pods", hidden);
  assert.deepEqual(await client.loadTablePreferences!("pods"), hidden);
});

test("out-of-order save completions do not restore an older preference", async (t) => {
  const originalFetch = globalThis.fetch;
  const firstSave = deferred<Response>();
  const secondSave = deferred<Response>();
  let writes = 0;
  const methods: Array<string | undefined> = [];
  globalThis.fetch = async (_url, init) => {
    methods.push(init?.method);
    writes += 1;
    return writes === 1 ? firstSave.promise : secondSave.promise;
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = createTablePreferencesClient("parallel-save-token")!;
  const olderSave = client.saveTablePreferences!("pods", visible);
  const newerSave = client.saveTablePreferences!("pods", hidden);
  assert.deepEqual(await client.loadTablePreferences!("pods"), hidden);
  secondSave.resolve(preferenceResponse(hidden));
  await newerSave;
  firstSave.resolve(preferenceResponse(visible));
  await olderSave;
  assert.deepEqual(await client.loadTablePreferences!("pods"), hidden);
  assert.deepEqual(methods, ["PUT", "PUT"]);
});

test("an older failed save cannot discard a later successful preference", async (t) => {
  const originalFetch = globalThis.fetch;
  const firstSave = deferred<Response>();
  let writes = 0;
  globalThis.fetch = async () => {
    writes += 1;
    return writes === 1 ? firstSave.promise : preferenceResponse(hidden);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = createTablePreferencesClient("parallel-failed-save-token")!;
  const olderSave = client.saveTablePreferences!("pods", visible);
  await client.saveTablePreferences!("pods", hidden);
  firstSave.resolve(Response.json({ message: "Unavailable" }, { status: 503 }));
  await olderSave;
  assert.deepEqual(await client.loadTablePreferences!("pods"), hidden);
});

test("preference cache is isolated by account token and table key", async (t) => {
  const originalFetch = globalThis.fetch;
  const reads: string[] = [];
  const writes: Array<{ authorization: string | null; body: unknown }> = [];
  globalThis.fetch = async (url, init) => {
    const authorization = new Headers(init?.headers).get("Authorization");
    if (init?.method === "PUT") {
      writes.push({ authorization, body: JSON.parse(String(init.body)) });
      return preferenceResponse(hidden);
    }
    assert.equal(init?.method, "GET");
    reads.push(`${authorization}:${String(url).split("/").at(-1)}`);
    return preferenceResponse(visible);
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const firstAccount = createTablePreferencesClient("isolated-account-a")!;
  const secondAccount = createTablePreferencesClient("isolated-account-b")!;
  await firstAccount.saveTablePreferences!("pods", hidden);
  assert.deepEqual(writes, [{ authorization: "Bearer isolated-account-a", body: { value: hidden } }]);
  assert.deepEqual(await secondAccount.loadTablePreferences!("pods"), visible);
  assert.deepEqual(await firstAccount.loadTablePreferences!("pods"), hidden);
  assert.deepEqual(await firstAccount.loadTablePreferences!("services"), visible);
  assert.deepEqual(await secondAccount.loadTablePreferences!("pods"), visible);
  assert.deepEqual(reads, ["Bearer isolated-account-b:pods", "Bearer isolated-account-a:services"]);
});

test("concurrent loads share one read and cache its successful result", async (t) => {
  const originalFetch = globalThis.fetch;
  const pendingRead = deferred<Response>();
  let reads = 0;
  globalThis.fetch = async (_url, init) => {
    assert.equal(init?.method, "GET");
    reads += 1;
    return pendingRead.promise;
  };
  t.after(() => { globalThis.fetch = originalFetch; });
  const client = createTablePreferencesClient("shared-read-token")!;
  const firstRead = client.loadTablePreferences!("pods");
  const secondRead = client.loadTablePreferences!("pods");
  pendingRead.resolve(preferenceResponse(visible));
  assert.deepEqual(await firstRead, visible);
  assert.deepEqual(await secondRead, visible);
  assert.deepEqual(await client.loadTablePreferences!("pods"), visible);
  assert.equal(reads, 1);
});
