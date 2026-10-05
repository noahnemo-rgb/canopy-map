import assert from "node:assert/strict";
import test from "node:test";
import { createCanopyRouter, mapNotes } from "./canopy-ai.js";

function sse(text) {
  const body = `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\ndata: [DONE]\n`;
  return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
}

test("map notes keep names, repos, and gaps", () => {
  const notes = mapNotes([
    { level: "repo", name: "Canopy", repo: "noahnemo-rgb/canopy-map", gaps: ["Sign-in later"] },
  ]);
  assert.match(notes, /repo: Canopy \(noahnemo-rgb\/canopy-map\) gaps: Sign-in later/);
});

test("a saved key tries Space Bunny Alpha after Puter, then gpt-4o-mini", async () => {
  const models = [];
  const router = createCanopyRouter({
    apiKey: "sk-test",
    timeoutMs: 1000,
    siteUrl: "https://canopy.local",
    loadPuter: async () => {
      throw new Error("puter unavailable");
    },
    fetchImpl: async (_input, init) => {
      const payload = JSON.parse(String(init?.body));
      models.push(payload.model);
      if (models.length === 1) return new Response("slow down", { status: 429 });
      return sse("next");
    },
  });

  assert.equal(await router.streamChat({ message: "What gap should I look at?" }), "next");
  assert.deepEqual(models, ["stealth/space-bunny-alpha", "openai/gpt-4o-mini"]);
});
