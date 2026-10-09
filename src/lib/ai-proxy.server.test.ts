import assert from "node:assert/strict";
import test from "node:test";
import { handleAiProxy, handleAiStatus, modelsFromEnv, providerStatus } from "./ai-proxy.server.ts";

const OWNER = "sk-testOWNERKEY1234567890abcd";
const GEMINI = "AIzaSyOWNERGEMINIKEY1234567890";
const BYOK = "sk-testUSERBYOK1234567890zzzz";

function sse(content: string): string {
  return `data: ${JSON.stringify({ choices: [{ delta: { content } }] })}\n\ndata: [DONE]\n\n`;
}

function geminiSse(text: string): string {
  return `data: ${JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] })}\n\n`;
}

const env = {
  OPENROUTER_API_KEY: OWNER,
  AI_GATEWAY_API_KEY: "sk-testGATEWAYKEY1234567890abcd",
  GEMINI_API_KEY: GEMINI,
  NVIDIA_API_KEY: "nvapi-testNVIDIAKEY1234567890abcd",
  LLM_API_KEY: "sk-testLLMAPKEY1234567890abcdef",
  VITE_PUBLIC_HOSTNAME: "raven-fire-rocket-acorn.grok.me",
};

test("status returns booleans and a 4-character tail", async () => {
  const status = providerStatus(env);
  assert.equal(status.openrouterKey, true);
  assert.equal(status.gatewayKey, true);
  assert.equal(status.geminiKey, true);
  assert.equal(status.nvidiaKey, true);
  assert.equal(status.llmapiKey, true);
  assert.equal(status.keyHints.openrouter, "abcd");
  assert.equal(status.keyHints["vercel-gateway"], "abcd");
  assert.equal(status.keyHints.gemini, "7890");
  const response = handleAiStatus(env);
  const text = await response.text();
  assert.equal(text.includes(OWNER), false);
  assert.equal(text.includes(GEMINI), false);
  assert.equal(text.includes("nvapi-test"), false);
  assert.match(text, /abcd/);
});

test("a gateway OIDC token counts as configured and is not returned", () => {
  const token = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.payload.signature";
  const status = providerStatus({ VERCEL_OIDC_TOKEN: token });
  assert.equal(status.gatewayKey, true);
  assert.equal(status.keyHints["vercel-gateway"], "ture");
  assert.equal(JSON.stringify(status).includes(token), false);
});

test("model allowlist keeps package defaults and drops a key-shaped override", () => {
  const models = modelsFromEnv({
    OPENROUTER_MODEL: OWNER,
    GEMINI_MODEL: "gemini-3.8-flash",
    NVIDIA_MODEL: "nvidia/nemotron-3-nano-30b-a3b",
  });
  assert.deepEqual(models.openrouter, ["openai/gpt-4o-mini"]);
  assert.deepEqual(models["space-bunny"], ["stealth/space-bunny-alpha"]);
  assert.deepEqual(models["vercel-gateway"], ["openai/gpt-4o-mini"]);
  assert.deepEqual(models.gemini, ["gemini-3.8-flash"]);
  assert.ok(models.nvidia?.includes("nvidia/nemotron-3-nano-30b-a3b"));
  assert.deepEqual(models.llmapi, ["gpt-4o"]);
});

test("the proxy checks origin, provider, and model, and does not echo the key", async () => {
  let seenUrl = "";
  let seenKey = "";
  const response = await handleAiProxy(
    new Request("https://canopy.example/api/ai", {
      method: "POST",
      headers: { origin: "https://raven-fire-rocket-acorn.grok.me", "content-type": "application/json" },
      body: JSON.stringify({
        provider: "gemini",
        model: "gemini-3.8-flash",
        message: "Which gap is next?",
        byok: BYOK,
      }),
    }),
    env,
    async (input, init) => {
      seenUrl = String(input);
      seenKey = new Headers(init?.headers).get("x-goog-api-key") ?? "";
      return new Response(geminiSse("next"), { status: 200 });
    },
  );
  const text = await response.text();
  assert.equal(response.status, 200);
  assert.equal(seenKey, GEMINI);
  assert.equal(seenUrl.includes("key="), false);
  assert.equal(seenUrl.includes(GEMINI), false);
  assert.equal(text.includes(GEMINI), false);
  assert.equal(text.includes(BYOK), false);
  assert.equal(text.includes(OWNER), false);
  assert.match(text, /next/);

  const foreign = await handleAiProxy(
    new Request("https://canopy.example/api/ai", {
      method: "POST",
      headers: { origin: "https://evil.example", "content-type": "application/json" },
      body: JSON.stringify({ provider: "gemini", model: "gemini-3.8-flash", message: "Hi" }),
    }),
    env,
  );
  assert.equal(foreign.status, 403);
  assert.equal((await foreign.text()).includes(GEMINI), false);

  const missingOrigin = await handleAiProxy(
    new Request("https://canopy.example/api/ai", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ provider: "openrouter", model: "openai/gpt-4o-mini", message: "Hi" }),
    }),
    env,
  );
  assert.equal(missingOrigin.status, 403);

  const model = await handleAiProxy(
    new Request("https://canopy.example/api/ai", {
      method: "POST",
      headers: { origin: "https://raven-fire-rocket-acorn.grok.me", "content-type": "application/json" },
      body: JSON.stringify({ provider: "openrouter", model: "other/model", message: "Hi" }),
    }),
    env,
  );
  assert.equal(model.status, 400);

  const puter = await handleAiProxy(
    new Request("https://canopy.example/api/ai", {
      method: "POST",
      headers: { origin: "https://raven-fire-rocket-acorn.grok.me", "content-type": "application/json" },
      body: JSON.stringify({ provider: "puter", model: "openai/gpt-4o-mini", message: "Hi" }),
    }),
    env,
  );
  assert.equal(puter.status, 400);
});

test("an allowed OpenRouter call uses the owner key and hides it", async () => {
  let authorization = "";
  const response = await handleAiProxy(
    new Request("https://canopy.example/api/ai", {
      method: "POST",
      headers: {
        origin: "http://localhost:8080",
        host: "localhost:8080",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        provider: "openrouter",
        model: "openai/gpt-4o-mini",
        message: "Hi",
        byok: BYOK,
      }),
    }),
    env,
    async (_input, init) => {
      authorization = new Headers(init?.headers).get("authorization") ?? "";
      return new Response(sse("ok"), { status: 200 });
    },
  );
  const text = await response.text();
  assert.equal(authorization, `Bearer ${OWNER}`);
  assert.equal(text.includes(OWNER), false);
  assert.equal(text.includes(BYOK), false);
});
