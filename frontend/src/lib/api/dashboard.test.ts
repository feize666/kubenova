import assert from "node:assert/strict";
import test from "node:test";
import {
  formatDashboardMetric,
  type DashboardResourceMetric,
} from "./dashboard";

function metric(
  overrides: Partial<DashboardResourceMetric>,
): DashboardResourceMetric {
  return {
    value: null,
    used: null,
    capacity: null,
    unit: "cores",
    source: "none",
    capturedAt: null,
    freshness: "unavailable",
    degraded: true,
    ...overrides,
  };
}

test("dashboard metric renders unavailable data as dashes instead of zero percent", () => {
  assert.deepEqual(formatDashboardMetric(metric({})), {
    valueLabel: "--",
    capacityLabel: "容量 --",
    percent: null,
    sourceLabel: "无可用数据",
    freshnessLabel: "不可用",
  });
});

test("dashboard metric preserves live usage when capacity is unavailable", () => {
  assert.deepEqual(
    formatDashboardMetric(
      metric({
        used: 0.75,
        source: "metrics-server",
        capturedAt: "2026-09-10T06:00:00.000Z",
        freshness: "fresh",
      }),
    ),
    {
      valueLabel: "750 mCPU",
      capacityLabel: "容量 --",
      percent: null,
      sourceLabel: "metrics-server 实时采样",
      freshnessLabel: "实时",
    },
  );
});

test("dashboard metric labels requested metadata as a synchronized snapshot", () => {
  assert.deepEqual(
    formatDashboardMetric(
      metric({
        value: 25,
        used: 1.5,
        capacity: 6,
        source: "k8s-node-allocatable-requested",
        capturedAt: "2026-09-10T06:00:00.000Z",
        freshness: "cached",
      }),
    ),
    {
      valueLabel: "1.50 cores",
      capacityLabel: "可分配 6.00 cores",
      percent: 25,
      sourceLabel: "K8s 请求量 / 可分配量快照",
      freshnessLabel: "已同步",
    },
  );
});
