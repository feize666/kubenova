import assert from "node:assert/strict";
import test from "node:test";
import { readTableDensity, writeTableDensity } from "./density";

// Losing either scope component would leak preferences between accounts/tables.
test("density round-trips through storage and remains isolated by user and table", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  writeTableDensity("alice", "pods", "compact", storage);
  assert.equal(readTableDensity("alice", "pods", storage), "compact");
  assert.equal(readTableDensity("bob", "pods", storage), "standard");
  assert.equal(readTableDensity("alice", "nodes", storage), "standard");
  writeTableDensity("alice:pods", "nodes", "compact", storage);
  assert.equal(readTableDensity("alice", "pods:nodes", storage), "standard");
  writeTableDensity("alice", "pods", "standard", storage);
  assert.equal(readTableDensity("alice", "pods", storage), "standard");
});

test("missing scope does not read or persist anonymous density preferences", () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
  };
  writeTableDensity("", "pods", "compact", storage);
  writeTableDensity("alice", undefined, "compact", storage);
  assert.equal(values.size, 0);
  assert.equal(readTableDensity("", "pods", storage), "standard");
  assert.equal(readTableDensity("alice", undefined, storage), "standard");
});

test("malformed or unsupported persisted values safely use standard density", () => {
  for (const raw of ["{", "null", '"dense"', '{"density":"compact"}', "42", '""']) {
    assert.equal(readTableDensity("alice", "pods", { getItem: () => raw }), "standard");
  }
});

test("unavailable browser storage and failed reads or writes never break the table", () => {
  assert.equal(readTableDensity("alice", "pods"), "standard");
  assert.doesNotThrow(() => writeTableDensity("alice", "pods", "compact"));
  const storage = {
    getItem: () => { throw new Error("SecurityError"); },
    setItem: () => { throw new Error("QuotaExceededError"); },
  };
  assert.equal(readTableDensity("alice", "pods", storage), "standard");
  assert.doesNotThrow(() => writeTableDensity("alice", "pods", "compact", storage));
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  Object.defineProperty(globalThis, "window", {
    configurable: true,
    value: { get localStorage() { throw new Error("SecurityError"); } },
  });
  try {
    assert.equal(readTableDensity("alice", "pods"), "standard");
    assert.doesNotThrow(() => writeTableDensity("alice", "pods", "compact"));
  } finally {
    if (descriptor) Object.defineProperty(globalThis, "window", descriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
