import assert from "node:assert/strict";
import test from "node:test";
import { createDetailUrlController, readDetailUrl, writeDetailUrl, type DetailUrlRequest } from "./detail-url";

const background = "https://console.example/workloads/pods?cluster=c1&filter=ready&filter=running#rows";
const pod = { kind: "Pod", id: "c1/default/web", label: "web" };
const podHref = "https://console.example/workloads/pods?cluster=c1&filter=ready&filter=running&detailKind=Pod&detailId=c1%2Fdefault%2Fweb&detailLabel=web#rows";

// Dropping unrelated search parameters or serializing snapshots would break this contract.
test("opening and closing preserve background filters, hash and history-independent identity", () => {
  const request = { ...pod, snapshot: { labels: { token: "secret" } }, token: "secret" };
  const href = writeDetailUrl(background, request);
  assert.equal(href, "/workloads/pods?cluster=c1&filter=ready&filter=running&detailKind=Pod&detailId=c1%2Fdefault%2Fweb&detailLabel=web#rows");
  assert.deepEqual(readDetailUrl(new URL(href, background).href), pod);
  assert.equal(writeDetailUrl(podHref, null), "/workloads/pods?cluster=c1&filter=ready&filter=running#rows");
});

test("malformed, duplicate, missing or overlong identities do not restore a drawer", () => {
  for (const search of [
    "detailKind=Pod", "detailId=x", "detailKind=%20&detailId=x",
    "detailKind=Pod&detailId=x&detailId=y", "detailKind=%3Cscript%3E&detailId=x",
    "detailKind=Pod&detailId=%00x", `detailKind=Pod&detailId=${"x".repeat(2049)}`,
    `detailKind=Pod&detailId=x&detailLabel=${"x".repeat(257)}`,
  ]) assert.equal(readDetailUrl(`https://console.example/pods?${search}`), null, search);
  assert.equal(readDetailUrl("javascript:alert(1)"), null);
  assert.equal(writeDetailUrl("javascript:alert(1)", pod), null);
  assert.deepEqual(readDetailUrl("https://console.example/pods?detailKind=CustomResource&detailId=dynamic%3Ac1%3Agroup%3Av1%3Awidgets%3Adefault%3Ax"), {
    kind: "CustomResource", id: "dynamic:c1:group:v1:widgets:default:x",
  });
});

function browserFixture(initialHref: string) {
  const listeners = new Set<() => void>();
  const browser = {
    location: { href: initialHref },
    history: {
      state: { __NA: true, tree: ["background"] },
      replaceState(data: unknown, _unused: string, url: string) {
        assert.deepEqual(data, { __NA: true, tree: ["background"] });
        browser.location.href = new URL(url, browser.location.href).href;
      },
    },
    addEventListener(_type: "popstate", listener: () => void) { listeners.add(listener); },
    removeEventListener(_type: "popstate", listener: () => void) { listeners.delete(listener); },
  };
  return { browser, pop(href: string) { browser.location.href = href; for (const listener of listeners) listener(); }, listeners };
}

// Two mounted tables must never render the same restored drawer or clear each other's URL.
test("one registered owner restores reload identity and explicit navigation transfers ownership", () => {
  const { browser, listeners } = browserFixture(podHref);
  const controller = createDetailUrlController(browser);
  const ownerA = {}, ownerB = {};
  let a: DetailUrlRequest | null = null, b: DetailUrlRequest | null = null;
  const disposeA = controller.register(ownerA, (request) => { a = request; });
  const disposeB = controller.register(ownerB, (request) => { b = request; });
  assert.deepEqual(a, pod);
  assert.equal(b, null);
  controller.navigate(ownerB, { kind: "Node", id: "live-node:c1:worker", label: "worker" });
  assert.equal(a, null);
  assert.deepEqual(b, { kind: "Node", id: "live-node:c1:worker", label: "worker" });
  controller.navigate(ownerA, null);
  assert.equal(readDetailUrl(browser.location.href)?.kind, "Node");
  controller.navigate(ownerB, null);
  assert.equal(b, null);
  assert.equal(browser.location.href, background);
  disposeA(); disposeB();
  assert.equal(listeners.size, 0);
});

test("relationship navigation, return and browser back/forward publish the current identity", () => {
  const { browser, pop } = browserFixture(background);
  const controller = createDetailUrlController(browser);
  const owner = {};
  let current: DetailUrlRequest | null = null;
  controller.register(owner, (request) => { current = request; });
  controller.navigate(owner, pod);
  controller.navigate(owner, { kind: "Service", id: "c1/default/web-svc" });
  assert.deepEqual(readDetailUrl(browser.location.href), { kind: "Service", id: "c1/default/web-svc" });
  controller.navigate(owner, pod);
  assert.deepEqual(current, pod);
  pop(background);
  assert.equal(current, null);
  pop(podHref);
  assert.deepEqual(current, pod);
  pop("https://console.example/resources?detailKind=Pod&detailId=unrelated");
  assert.equal(current, null, "an old route owner must not restore on another pathname");
});

test("without a registered auto-detail owner no URL or state is consumed", () => {
  const { browser, listeners } = browserFixture(podHref);
  const controller = createDetailUrlController(browser);
  controller.navigate({}, { kind: "Node", id: "other" });
  assert.equal(browser.location.href, podHref);
  assert.equal(listeners.size, 0);
});

// A restored base identity must reset the drawer's old in-memory relationship stack.
test("restoration is distinguished from relationship navigation to reset stale drawer sessions", () => {
  const { browser, pop } = browserFixture(podHref);
  const controller = createDetailUrlController(browser);
  const transitions: string[] = [];
  const owner = {};
  controller.register(owner, ((_request: DetailUrlRequest | null, source?: string) => { transitions.push(source ?? "missing"); }));
  controller.navigate(owner, { kind: "Service", id: "c1/default/web-svc" });
  pop(podHref);
  assert.deepEqual(transitions, ["restore", "navigate", "restore"]);
});
