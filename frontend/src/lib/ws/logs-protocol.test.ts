import assert from "node:assert/strict";
import test from "node:test";
import { RuntimeLogsSocket } from "./logs";

test("gateway log frames expose content and timestamp rather than dropping typed output", () => {
  const lines = RuntimeLogsSocket.parseSocketMessage("log", {
    type: "log",
    content: "first line\npong\nlogs.ack\nsecond line",
    timestamp: "2026-10-10T08:00:00.000Z",
  });
  assert.deepEqual(lines.map(({ text, ts }) => ({ text, ts })), [
    { text: "first line", ts: 1791619200000 },
    { text: "pong", ts: 1791619200000 },
    { text: "logs.ack", ts: 1791619200000 },
    { text: "second line", ts: 1791619200000 },
  ]);
});

test("event envelopes retain object payload metadata and text", () => {
  const lines = RuntimeLogsSocket.parseSocketMessage("logs.output", {
    type: "stderr",
    content: "WARN fixture",
    timestamp: "2026-10-10T08:00:00.000Z",
  });
  assert.equal(lines.length, 1);
  assert.equal(lines[0].text, "WARN fixture");
  assert.equal(lines[0].type, "stderr");
  assert.equal(lines[0].ts, 1791619200000);
});
