import assert from "node:assert/strict";
import test from "node:test";
import {
  workloadList, workloadPodPath, createWorkloadEditor, switchEnvSource,
  switchEnvFrom, switchAction, switchVolume, moveWorkloadItem,
  parseAdvancedWorkloadObject, parseWorkloadPort, workloadLockReason,
  renameWorkloadKey,
  switchToleration, switchSeccomp, copyWorkloadContainer,
} from "./workload-fields";
import type { ResourceManifest } from "@/lib/resource-editor";

test("production command reader preserves string arguments including spaces and empty values", () => {
  assert.deepEqual(workloadList(["sh", "-c", "echo hello world", ""]), [
    "sh", "-c", "echo hello world", "",
  ]);
});

test("union switches remove invalid toleration values and local seccomp paths, preserving extensions", () => {
  assert.deepEqual(switchToleration({ key: "dedicated", operator: "Equal", value: "worker", effect: "NoSchedule", extra: 7 }, "Exists"), { key: "dedicated", operator: "Exists", effect: "NoSchedule", extra: 7 });
  assert.deepEqual(switchSeccomp({ type: "Localhost", localhostProfile: "a.json", extra: 7 }, "RuntimeDefault"), { type: "RuntimeDefault", extra: 7 });
});

test("map rename preserves siblings, rejects prototype keys and does not overwrite existing keys", () => {
  assert.deepEqual(renameWorkloadKey({ app: "api", retained: "yes" }, "app", "component"), { component: "api", retained: "yes" });
  assert.throws(() => renameWorkloadKey({ app: "api", retained: "yes" }, "app", "retained"));
  assert.throws(() => renameWorkloadKey({ app: "api" }, "app", "__proto__"));
});

const manifest: ResourceManifest = {
  apiVersion: "batch/v1", kind: "CronJob", metadata: { name: "nightly", namespace: "ops" },
  spec: { schedule: "0 1 * * *", jobTemplate: { spec: { backoffLimit: 4, template: {
    metadata: { labels: { app: "worker" }, annotations: { retained: "yes" } },
    spec: { restartPolicy: "Never", containers: [
      { name: "main", image: "worker:1", command: ["sh", "-c"], args: ["echo hi there"], custom: { keep: true } },
      { name: "metrics", image: "metrics:1", ports: [{ containerPort: 9090, hostIP: "127.0.0.1" }] },
    ], initContainers: [{ name: "setup", image: "busybox", unknown: { keep: true } }] },
  } } } }, external: { preserve: true },
};

test("CronJob updates use real nested pod path and preserve all unknown fields", () => {
  const input = structuredClone(manifest);
  let result = input;
  const editor = createWorkloadEditor(input, (value) => { result = value; }, "create");
  editor.write([...workloadPodPath(input.kind), "containers", 0, "image"], "worker:2");
  assert.deepEqual(result, {
    apiVersion: "batch/v1", kind: "CronJob", metadata: { name: "nightly", namespace: "ops" },
    spec: { schedule: "0 1 * * *", jobTemplate: { spec: { backoffLimit: 4, template: {
      metadata: { labels: { app: "worker" }, annotations: { retained: "yes" } },
      spec: { restartPolicy: "Never", containers: [
        { name: "main", image: "worker:2", command: ["sh", "-c"], args: ["echo hi there"], custom: { keep: true } },
        { name: "metrics", image: "metrics:1", ports: [{ containerPort: 9090, hostIP: "127.0.0.1" }] },
      ], initContainers: [{ name: "setup", image: "busybox", unknown: { keep: true } }] },
    } } } }, external: { preserve: true },
  });
  assert.deepEqual(input, manifest);
});

test("back-to-back field edits compose without waiting for a React render", () => {
  const results: ResourceManifest[] = [];
  const editor = createWorkloadEditor(structuredClone(manifest), (value) => results.push(value), "create");
  const path = [...workloadPodPath("CronJob"), "containers", 0];
  editor.write([...path, "ports"], [{ name: "http", containerPort: 8080, protocol: "TCP" }]);
  editor.write([...path, "volumeMounts"], [{ name: "data", mountPath: "/data", readOnly: false }]);
  assert.equal(results.length, 2);
  assert.deepEqual(editor.read([...path, "ports"]), [{ name: "http", containerPort: 8080, protocol: "TCP" }]);
  assert.deepEqual(editor.read([...path, "volumeMounts"]), [{ name: "data", mountPath: "/data", readOnly: false }]);
});

test("env source and probe switches emit exactly once and remove incompatible union members", () => {
  const results: ResourceManifest[] = [];
  const editor = createWorkloadEditor(structuredClone(manifest), (value) => results.push(value), "create");
  const path = [...workloadPodPath("CronJob"), "containers", 0, "env", 0];
  editor.write(path, { name: "TOKEN", value: "literal", unknown: { keep: 1 } });
  editor.update(path, (old) => switchEnvSource(old, "secretKeyRef"));
  assert.equal(results.length, 2);
  assert.deepEqual(editor.read(path), { name: "TOKEN", unknown: { keep: 1 }, valueFrom: { secretKeyRef: { name: "", key: "" } } });
  assert.deepEqual(switchEnvSource({ name: "ENV", valueFrom: { fieldRef: { fieldPath: "metadata.name" } }, retained: true }, "value"), { name: "ENV", value: "", retained: true });
  assert.deepEqual(switchAction({ httpGet: { port: 80 }, timeoutSeconds: 4, custom: { a: 1 } }, "tcpSocket"), { tcpSocket: { port: 80 }, timeoutSeconds: 4, custom: { a: 1 } });
  assert.deepEqual(switchEnvFrom({ prefix: "APP_", configMapRef: { name: "old" }, custom: true }, "secretRef"), { prefix: "APP_", secretRef: { name: "" }, custom: true });
});

test("volume switching preserves metadata and same-type nested options without two stale writes", () => {
  assert.deepEqual(switchVolume({ name: "cfg", configMap: { name: "old", optional: true }, custom: { keep: true } }, "persistentVolumeClaim"), { name: "cfg", persistentVolumeClaim: { claimName: "" }, custom: { keep: true } });
  assert.deepEqual(switchVolume({ name: "cfg", secret: { secretName: "tokens", defaultMode: 420 }, custom: true }, "secret"), { name: "cfg", secret: { secretName: "tokens", defaultMode: 420 }, custom: true });
});

test("regular and init list reorder/deletion preserve whole item identities", () => {
  const editor = createWorkloadEditor(structuredClone(manifest), () => {}, "create");
  const path = [...workloadPodPath("CronJob"), "containers"];
  editor.update(path, (old) => moveWorkloadItem(old, 0, 1));
  editor.write([...path, 1, "name"], "renamed");
  assert.deepEqual(editor.read([...path, 1]), { name: "renamed", image: "worker:1", command: ["sh", "-c"], args: ["echo hi there"], custom: { keep: true } });
  editor.write([...path, 0], undefined);
  assert.equal(workloadList(editor.read(path)).length, 1);
  const init = [...workloadPodPath("CronJob"), "initContainers"];
  editor.update(init, (old) => [...workloadList(old), { name: "migrate", image: "db:1" }]);
  editor.update(init, (old) => moveWorkloadItem(old, 1, -1));
  editor.write([...init, 0], undefined);
  assert.deepEqual(editor.read(init), [{ name: "setup", image: "busybox", unknown: { keep: true } }]);
  assert.deepEqual(moveWorkloadItem(["a", "b"], 0, -1), ["a", "b"]);
});

test("container copy uses a unique name, deeply preserves extensions and leaves source unchanged", () => {
  const source = [{name: "main", image: "app:1", env: [{name: "A", value: "1"}], custom: {keep: true}}, {name: "main-copy", image: "helper:1"}];
  const copied = copyWorkloadContainer(source, 0) as typeof source;
  assert.equal(copied[2].name, "main-copy-copy");
  assert.deepEqual(copied[2].custom, {keep: true});
  copied[2].env![0].value = "2";
  assert.equal(source[0].env![0].value, "1");
  assert.deepEqual(copyWorkloadContainer(source, -1), source);
});

test("disabled editor and immutable edit paths never emit while Pod images remain editable", () => {
  const pod: ResourceManifest = { apiVersion: "v1", kind: "Pod", metadata: { name: "p" }, spec: { containers: [{ name: "a", image: "a:1" }] } };
  const results: ResourceManifest[] = [];
  const editor = createWorkloadEditor(pod, (value) => results.push(value), "edit");
  editor.write(["metadata", "name"], "other");
  editor.write(["spec", "containers", 0, "command"], ["sh"]);
  editor.write(["spec", "containers"], []);
  editor.write(["spec", "containers", 0, "image"], "a:2");
  assert.equal(results.length, 1);
  assert.deepEqual(results[0], { apiVersion: "v1", kind: "Pod", metadata: { name: "p" }, spec: { containers: [{ name: "a", image: "a:2" }] } });
  const disabled = createWorkloadEditor(manifest, (value) => results.push(value), "create", true);
  disabled.write(["spec", "schedule"], "* * * * *");
  assert.equal(results.length, 1);
  assert.ok(workloadLockReason("StatefulSet", "edit", ["spec", "serviceName"]));
  assert.ok(workloadLockReason("Job", "edit", ["spec", "template", "spec", "containers", 0, "image"]));
  assert.equal(workloadLockReason("CronJob", "edit", ["spec", "jobTemplate", "spec", "template", "spec", "containers", 0, "image"]), undefined);
});

test("ports keep IntOrString types and invalid advanced objects cannot be applied", () => {
  assert.equal(parseWorkloadPort("8080"), 8080);
  assert.equal(parseWorkloadPort("http"), "http");
  assert.equal(parseWorkloadPort(""), undefined);
  assert.throws(() => parseAdvancedWorkloadObject("{bad"));
  assert.throws(() => parseAdvancedWorkloadObject("[]"));
  assert.throws(() => parseAdvancedWorkloadObject('{"__proto__":{"polluted":true}}'));
  assert.deepEqual(parseAdvancedWorkloadObject('{"nodeAffinity":{"unknown":true}}'), { nodeAffinity: { unknown: true } });
});
