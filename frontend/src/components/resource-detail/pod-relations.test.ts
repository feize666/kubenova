import assert from "node:assert/strict";
import test from "node:test";
import { belongsToOwner, collectPaginatedWorkloads, selectorMatches } from "../../app/clusters/[clusterId]/resource/[kind]/[...id]/pod-relations";

const pod = (name: string, ownerReferences: unknown[] = [], labels: Record<string, string> = {}) => ({
  id: `pod-${name}`,
  kind: "Pod",
  name,
  namespace: "prod",
  labels,
  statusJson: { ownerReferences },
});

test("follows ReplicaSet and Job owner chains without accepting a shared label", () => {
  const resources = [
    pod("web-pod", [{ kind: "ReplicaSet", name: "web-rs", uid: "rs-1" }], { app: "shared" }),
    { id: "rs-1", kind: "ReplicaSet", name: "web-rs", namespace: "prod", statusJson: { uid: "rs-1", ownerReferences: [{ kind: "Deployment", name: "web", uid: "deploy-1" }] } },
    { id: "deploy-1", kind: "Deployment", name: "web", namespace: "prod", labels: { app: "shared" }, statusJson: { uid: "deploy-1" } },
  ];
  assert.equal(belongsToOwner(resources[0], resources[2], resources), true);
  assert.equal(belongsToOwner({ ...resources[0], name: "other-pod", statusJson: { ownerReferences: [{ kind: "ReplicaSet", name: "other-rs", uid: "rs-2" }] } }, resources[2], resources), false);
  assert.equal(belongsToOwner(pod("cron-pod", [{ kind: "Job", name: "nightly-123", uid: "job-1" }]), { kind: "CronJob", name: "nightly", namespace: "prod", statusJson: { uid: "cron-1" } }, [
    { kind: "Job", name: "nightly-123", namespace: "prod", statusJson: { uid: "job-1", ownerReferences: [{ kind: "CronJob", name: "nightly", uid: "cron-1" }] } },
  ]), true);
});

test("selector matching requires a real selector and stays namespace scoped", () => {
  assert.equal(selectorMatches({ app: "web", tier: "frontend" }, { matchLabels: { app: "web" } }), true);
  assert.equal(selectorMatches({ app: "web" }, { matchExpressions: [{ key: "tier", operator: "Exists" }] }), false);
  assert.equal(selectorMatches({ app: "web" }, {}), false);
});

test("explicit controller wins over a non-controller reference and known UID mismatch", () => {
  const owner = { kind: "StatefulSet", name: "web", namespace: "prod", clusterId: "c1", statusJson: { uid: "current" } };
  assert.equal(belongsToOwner(pod("legitimate", [{ kind: "StatefulSet", name: "web", uid: "current", controller: true }]), owner, []), true);
  assert.equal(belongsToOwner(pod("old", [{ kind: "StatefulSet", name: "web", uid: "old", controller: true }]), owner, []), false);
  assert.equal(belongsToOwner(pod("shared", [{ kind: "StatefulSet", name: "web", uid: "current", controller: false }, { kind: "Job", name: "other", controller: true }]), owner, []), false);
  assert.equal(belongsToOwner({ ...pod("foreign", [{ kind: "StatefulSet", name: "web", uid: "current" }]), clusterId: "c2" }, owner, []), false);
});

test("selector expressions follow Kubernetes absent-key and empty-value semantics", () => {
  assert.equal(selectorMatches({}, { matchExpressions: [{ key: "blocked", operator: "NotIn", values: ["yes"] }] }), true);
  assert.equal(selectorMatches({ blocked: "yes" }, { matchExpressions: [{ key: "blocked", operator: "NotIn", values: ["yes"] }] }), false);
  assert.equal(selectorMatches({}, { matchExpressions: [{ key: "tier", operator: "In", values: [""] }] }), false);
  assert.equal(selectorMatches({ flag: "" }, { matchLabels: { flag: "" } }), true);
  assert.equal(selectorMatches({}, { matchExpressions: [{ key: "flag", operator: "DoesNotExist" }] }), true);
});

test("collects every page instead of truncating at the first 200 rows", async () => {
  const calls: number[] = [];
  const item = (name: string) => ({ id: name, clusterId: "c1", namespace: "prod", kind: "Pod", name, state: "active" as const, replicas: 1, readyReplicas: 1, createdAt: "2026-10-11", updatedAt: "2026-10-11" });
  const result = await collectPaginatedWorkloads(async (page) => {
    calls.push(page);
    return page === 1
      ? { items: Array.from({ length: 200 }, (_, index) => item(`pod-${index}`)), total: 201, page, pageSize: 200 }
      : { items: [item("pod-200")], total: 201, page, pageSize: 200 };
  });
  assert.deepEqual(calls, [1, 2]);
  assert.equal(result.length, 201);
});
