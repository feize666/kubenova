import assert from "node:assert/strict";
import test from "node:test";
import * as logs from "./logs";
import * as terminal from "./terminal";

test('terminal keepalive does not pollute shell output, but real pong output remains visible',()=>{
  assert.equal(terminal.parseTerminalMessagePayload(JSON.stringify({type:'system',state:'keepalive',content:'pong'})).text,'');
  assert.equal(terminal.parseTerminalMessagePayload(JSON.stringify({type:'stdout',content:'pong'})).text,'pong');
});

test("new log count grows while reading history and resets when following", () => {
  assert.equal(typeof logs.nextUnreadLogCount, "function");
  assert.equal(logs.nextUnreadLogCount(4, 3, false), 7);
  assert.equal(logs.nextUnreadLogCount(4, 3, true), 0);
  assert.equal(logs.nextUnreadLogCount(4, 0, false), 4);
});

test("terminal permits initial/manual connection but rejects automatic reconnection", () => {
  assert.equal(typeof terminal.shouldConnectTerminal, "function");
  assert.equal(terminal.shouldConnectTerminal(false), true);
  assert.equal(terminal.shouldConnectTerminal(true), false);
});

test("terminal exposes manual reconnect only when a valid session target is available", () => {
  assert.equal(terminal.canManuallyReconnect({ status: "disconnected", blocked: false, hasTarget: true }), true);
  assert.equal(terminal.canManuallyReconnect({ status: "connected", blocked: false, hasTarget: true }), true);
  assert.equal(terminal.canManuallyReconnect({ status: "connecting", blocked: false, hasTarget: true }), false);
  assert.equal(terminal.canManuallyReconnect({ status: "disconnected", blocked: true, hasTarget: true }), false);
  assert.equal(terminal.canManuallyReconnect({ status: "disconnected", blocked: true, hasTarget: true, newSession: true }), true);
  assert.equal(terminal.canManuallyReconnect({ status: "disconnected", blocked: false, hasTarget: false }), false);
});

test("user scrolling pauses follow without programmatic writes resuming it", () => {
  assert.equal(typeof logs.nextLogFollowOutput, "function");
  assert.equal(logs.nextLogFollowOutput(true, 10, 20, false), false);
  assert.equal(logs.nextLogFollowOutput(false, 20, 20, false), true);
  assert.equal(logs.nextLogFollowOutput(false, 20, 20, true), false);
  assert.equal(logs.nextLogFollowOutput(true, 10, 20, true), true);
});
