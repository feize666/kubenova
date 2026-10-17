import test from "node:test";
import assert from "node:assert/strict";

import { normalizeAiAssistantActionOperation } from "./ai-assistant";

test("normalizes the manifest mutation action for the approval pipeline", () => {
  assert.equal(
    normalizeAiAssistantActionOperation("apply-resource-manifest"),
    "apply-resource-manifest",
  );
});

test("unknown AI mutation actions remain rejected by the client allowlist", () => {
  assert.equal(normalizeAiAssistantActionOperation("apply-arbitrary-shell"), undefined);
});
