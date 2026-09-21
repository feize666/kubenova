import assert from "node:assert/strict";
import test from "node:test";
import { prepareMfaReset, confirmMfaReset, prepareMfaResetOidc, exchangeMfaResetOidc } from "./mfa-reset";

test("reset requests bind the target and never send credentials in URLs", async t => {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response(JSON.stringify({ data: { token: "proof", expiresIn: 300 } }), { status: 200 });
  };
  t.after(() => { globalThis.fetch = original; });
  await prepareMfaReset("session", "target", "private-password", { code: "private-code", method: "recovery" });
  await confirmMfaReset("session", "target", "private-proof");
  await prepareMfaResetOidc("session", "target");
  await exchangeMfaResetOidc("session", "target", "https://console/login/oidc?code=private");
  assert.deepEqual(calls.map(c => c.body.targetUserId), ["target", "target", "target", "target"]);
  assert.ok(calls.every(c => !c.url.includes("private") && !c.url.includes("?")));
  assert.deepEqual(calls[0].body, { targetUserId: "target", password: "private-password", code: "private-code", method: "recovery" });
  assert.deepEqual(calls[1].body, { targetUserId: "target", token: "private-proof" });
});
