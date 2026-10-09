// @ts-nocheck
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  createLocalStorageStore,
  createProviderSelectionStore,
  loadDashboard,
} from "ai-buffer";
import {
  askCanopy,
  forgetBrowserProviderKeys,
  mapNotes,
  proxyChatBody,
  sanitizeProbe,
  streamCanopyProxy,
} from "./canopy-ai.js";

function memoryStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
    removeItem: (key) => {
      values.delete(key);
    },
    dump: () => Object.fromEntries(values),
  };
}

function sseResponse(text) {
  const body = `data: ${JSON.stringify({ text })}\n\ndata: [DONE]\n\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("map notes keep names, repos, and gaps", () => {
  const notes = mapNotes([
    { level: "repo", name: "Canopy", repo: "noahnemo-rgb/canopy-map", gaps: ["Sign-in later"] },
  ]);
  assert.match(notes, /repo: Canopy \(noahnemo-rgb\/canopy-map\) gaps: Sign-in later/);
});

test("the proxy body has no key fields", () => {
  const body = proxyChatBody({
    provider: "gemini",
    model: "gemini-3.8-flash",
    message: "Hi",
    systemPrompt: "Be short.",
    context: "repo: Canopy",
  });
  assert.deepEqual(Object.keys(body).sort(), ["context", "message", "model", "provider", "systemPrompt"]);
  assert.equal(JSON.stringify(body).includes("apiKey"), false);
  assert.equal(JSON.stringify(body).includes("byok"), false);
});

test("a status payload is reduced to booleans and a 4-character tail", () => {
  const full = "sk-testOWNERKEY1234567890abcd";
  const probe = sanitizeProbe(
    {
      openrouterKey: true,
      gatewayKey: false,
      keyHints: { openrouter: full, gemini: "7890" },
      OPENROUTER_API_KEY: full,
    },
    false,
  );
  assert.equal(probe.openrouterKey, true);
  assert.equal(probe.keyHints.openrouter, "abcd");
  assert.equal(probe.keyHints.gemini, "7890");
  assert.equal(JSON.stringify(probe).includes(full), false);
  assert.equal("OPENROUTER_API_KEY" in probe, false);
});

test("server providers are on the selection dashboard and storage keeps ids only", async () => {
  const storage = memoryStorage({
    canopy_openrouter_key: "sk-testOWNERKEY1234567890abcd",
    "ai-buffer.openrouter_key": "sk-testOWNERKEY1234567890abcd",
  });
  forgetBrowserProviderKeys(storage);
  assert.equal(storage.dump().canopy_openrouter_key, undefined);
  assert.equal(storage.dump()["ai-buffer.openrouter_key"], undefined);

  const store = createProviderSelectionStore(createLocalStorageStore(storage));
  await store.setProvider("vercel-gateway");
  await store.setModel("gemini", "gemini-3.8-flash");
  await assert.rejects(() => store.setModel("openrouter", "sk-testOWNERKEY1234567890abcd"));
  const rows = await loadDashboard(store, {
    gatewayKey: true,
    geminiKey: true,
    nvidiaKey: true,
    llmapiKey: true,
    keyHints: { "vercel-gateway": "ab12" },
  });
  assert.deepEqual(
    rows.map((row) => row.label),
    ["Puter", "OpenRouter", "Space Bunny Alpha", "Vercel Gateway", "Gemini API", "NVIDIA NIM", "LLMAPI"],
  );
  const gateway = rows.find((row) => row.id === "vercel-gateway");
  assert.equal(gateway.status, "configured");
  assert.equal(gateway.activeLabel, "active");
  assert.equal(gateway.keyHint, "••••ab12");
  assert.equal(gateway.modelLabel, "model");
  const nvidia = rows.find((row) => row.id === "nvidia");
  assert.equal(nvidia.status, "configured");
  const llmapi = rows.find((row) => row.id === "llmapi");
  assert.equal(llmapi.label, "LLMAPI");
  const saved = storage.dump();
  assert.deepEqual(Object.keys(saved).sort(), ["ai-buffer.active_provider", "ai-buffer.model.gemini"]);
  assert.equal(JSON.stringify(saved).includes("sk-"), false);
});

test("Puter stays in the browser and other providers post to the proxy", async () => {
  let posted = null;
  const puterText = await askCanopy({
    provider: "puter",
    model: "openai/gpt-4o-mini",
    message: "What gap should I look at?",
    systemPrompt: "Be short.",
    context: "repo: Canopy",
    loadPuter: async () => ({
      ai: { chat: async (messages) => `puter:${messages.at(-1).content}` },
    }),
    fetchImpl: async () => {
      throw new Error("Puter must not call the proxy");
    },
  });
  assert.match(puterText, /^puter:/);

  const proxyText = await streamCanopyProxy({
    provider: "nvidia",
    model: "nvidia/nemotron-3-nano-30b-a3b",
    message: "Hi",
    systemPrompt: "Be short.",
    context: "repo: Canopy",
    fetchImpl: async (url, init) => {
      posted = { url, body: JSON.parse(String(init.body)) };
      return sseResponse("nim");
    },
  });
  assert.equal(proxyText, "nim");
  assert.equal(posted.url, "/api/ai");
  assert.equal(posted.body.provider, "nvidia");
  assert.equal(posted.body.model, "nvidia/nemotron-3-nano-30b-a3b");
  assert.equal("apiKey" in posted.body, false);
  assert.equal("byok" in posted.body, false);
});

test("the ask screen does not write provider keys into web storage", () => {
  const ask = readFileSync(new URL("../components/map-ask.tsx", import.meta.url), "utf8");
  const dashboard = readFileSync(new URL("../components/ai-buffer-dashboard.tsx", import.meta.url), "utf8");
  const ai = readFileSync(new URL("./canopy-ai.js", import.meta.url), "utf8");
  assert.equal(ask.includes("localStorage.setItem"), false);
  assert.equal(ask.includes("sessionStorage.setItem"), false);
  assert.equal(ask.includes("canopy_openrouter_key"), false);
  assert.equal(dashboard.includes("localStorage"), false);
  assert.equal(dashboard.includes("sessionStorage"), false);
  assert.equal(ai.includes("localStorage.setItem"), false);
  assert.equal(ai.includes("sessionStorage.setItem"), false);
  const texts = [...dashboard.matchAll(/>([^<>{}]+)</g)]
    .map((match) => match[1].trim())
    .filter((text) => /[A-Za-z]/.test(text));
  assert.deepEqual(texts, ["ai-buffer"]);
});
