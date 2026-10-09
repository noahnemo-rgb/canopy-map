import assert from "node:assert/strict";
import test from "node:test";
import { scanText, secretSentinels } from "./check-client-secrets.mjs";

test("key shapes and build-time env values are hits", () => {
  assert.deepEqual(scanText("model openai/gpt-4o-mini"), []);
  assert.ok(scanText("sk-abcdefghijklmnopqrstuvwxyz").length > 0);
  assert.ok(scanText("nvapi-abcdefghijklmnopqrstuvwxyz").length > 0);
  assert.ok(scanText("AIzaSyOWNERGEMINIKEY1234567890").length > 0);
  assert.deepEqual(scanText("OPENROUTER_API_KEY="), []);
  assert.ok(scanText("OPENROUTER_API_KEY=sk-abcdefghijklmnopqrstuvwxyz").length > 0);
  const sentinels = secretSentinels({ OPENROUTER_API_KEY: "owner-key-value-123456" });
  assert.deepEqual(sentinels, ["owner-key-value-123456"]);
  assert.ok(scanText("bundle owner-key-value-123456 end", sentinels).includes("env"));
});
