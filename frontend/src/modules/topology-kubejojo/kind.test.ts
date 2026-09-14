import { test } from "node:test";
import assert from "node:assert/strict";

import { normalizeTopologyKind } from "./kind";

test("normalizes common Kubernetes kind case variants", () => {
  assert.equal(normalizeTopologyKind("deployment"), "Deployment");
  assert.equal(normalizeTopologyKind("DEPLOYMENT"), "Deployment");
  assert.equal(normalizeTopologyKind("daemonset"), "DaemonSet");
  assert.equal(normalizeTopologyKind("ENDPOINTSLICE"), "EndpointSlice");
  assert.equal(normalizeTopologyKind("statefulset"), "StatefulSet");
  assert.equal(normalizeTopologyKind("PV"), "PersistentVolume");
});

test("keeps unknown kinds readable", () => {
  assert.equal(normalizeTopologyKind("widget"), "Widget");
  assert.equal(normalizeTopologyKind(""), "Unknown");
});
