import { createAiClient } from "ai-buffer";

export const CANOPY_PROMPT =
  "You help a person read their Canopy map. The notes list work they are building and gaps they are tracking. Be concrete and short. Do not write the missing code.";

const LEGACY_PROVIDER_KEY_NAMES = ["canopy_openrouter_key"];

const PROVIDER_SECRET_STORAGE_KEYS = [
  "ai-buffer.openrouter_key",
  "ai-buffer.gateway_key",
  "ai-buffer.gemini_key",
  "ai-buffer.nvidia_key",
  "ai-buffer.llmapi_key",
];

/**
 * @param {Array<{ level?: string, name?: string, repo?: string, gaps?: string[] }> | null | undefined} nodes
 */
export function mapNotes(nodes) {
  return (nodes || [])
    .slice(0, 40)
    .map((node) => {
      const repo = node.repo ? ` (${node.repo})` : "";
      const gaps = Array.isArray(node.gaps) && node.gaps.length ? ` gaps: ${node.gaps.join("; ")}` : "";
      return `${node.level || "node"}: ${node.name || "untitled"}${repo}${gaps}`;
    })
    .join("\n");
}

/**
 * Drop raw provider keys left in web storage. Selection ids are left in place.
 * @param {{ removeItem?: (key: string) => void } | null | undefined} storage
 */
export function forgetBrowserProviderKeys(storage) {
  if (!storage || typeof storage.removeItem !== "function") return;
  for (const key of [...LEGACY_PROVIDER_KEY_NAMES, ...PROVIDER_SECRET_STORAGE_KEYS]) {
    storage.removeItem(key);
  }
}

/**
 * @param {{ provider: string, model: string, message: string, systemPrompt?: string, context?: string }} input
 */
export function proxyChatBody({ provider, model, message, systemPrompt, context }) {
  return { provider, model, message, systemPrompt, context };
}

/** @param {unknown} value */
function hintTail(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  const stripped = trimmed.startsWith("••••") ? trimmed.slice(4) : trimmed;
  if (stripped.length < 4) return "";
  return stripped.slice(-4);
}

/**
 * Keep booleans and a 4-character tail. A full key in the payload is not copied through.
 * @param {Record<string, any> | null | undefined} body
 * @param {boolean} puterSignedIn
 */
export function sanitizeProbe(body, puterSignedIn) {
  const source = body && typeof body === "object" ? body : {};
  const rawHints = source.keyHints && typeof source.keyHints === "object" ? source.keyHints : {};
  /** @type {Record<string, string>} */
  const keyHints = {};
  for (const [id, value] of Object.entries(rawHints)) {
    const tail = hintTail(value);
    if (tail) keyHints[id] = tail;
  }
  return {
    puterSignedIn: Boolean(puterSignedIn),
    openrouterKey: Boolean(source.openrouterKey),
    gatewayKey: Boolean(source.gatewayKey),
    geminiKey: Boolean(source.geminiKey),
    nvidiaKey: Boolean(source.nvidiaKey),
    llmapiKey: Boolean(source.llmapiKey),
    keyHints,
  };
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {boolean} puterSignedIn
 */
export async function loadCanopyProbe(fetchImpl, puterSignedIn) {
  let body = {};
  try {
    const response = await fetchImpl("/api/ai/status", { headers: { accept: "application/json" } });
    if (response.ok) body = await response.json();
  } catch {
    body = {};
  }
  return sanitizeProbe(body, puterSignedIn);
}

/** @param {string} buffer */
function takeSseEvents(buffer) {
  const events = [];
  let rest = buffer;
  let splitAt = rest.indexOf("\n\n");
  while (splitAt !== -1) {
    events.push(rest.slice(0, splitAt));
    rest = rest.slice(splitAt + 2);
    splitAt = rest.indexOf("\n\n");
  }
  return { events, rest };
}

/**
 * @param {string} text
 * @param {string} raw
 * @param {((chunk: string) => void) | undefined} onChunk
 */
function applySseEvent(text, raw, onChunk) {
  const line = raw
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item.startsWith("data:"));
  if (!line) return text;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return text;
  const payload = JSON.parse(data);
  if (payload?.error?.message) throw new Error(payload.error.message);
  if (typeof payload?.text === "string" && payload.text) {
    onChunk?.(payload.text);
    return text + payload.text;
  }
  return text;
}

/**
 * @param {Response} response
 * @param {((chunk: string) => void) | undefined} onChunk
 */
export async function readProxyStream(response, onChunk) {
  if (!response.ok) {
    let message = "";
    try {
      const body = await response.json();
      message = typeof body?.error?.message === "string" ? body.error.message : "";
    } catch {
      message = "";
    }
    throw new Error(message || "The map question did not go through.");
  }
  const decoder = new TextDecoder();
  let buffer = "";
  let text = "";
  const reader = response.body?.getReader?.();
  if (!reader) {
    buffer = typeof response.text === "function" ? await response.text() : "";
  } else {
    while (true) {
      const step = await reader.read();
      if (step.done) break;
      buffer += decoder.decode(step.value, { stream: true });
      const parsed = takeSseEvents(buffer);
      buffer = parsed.rest;
      for (const event of parsed.events) text = applySseEvent(text, event, onChunk);
    }
    buffer += decoder.decode();
  }
  if (buffer.trim()) {
    const parsed = takeSseEvents(`${buffer}\n\n`);
    for (const event of parsed.events) text = applySseEvent(text, event, onChunk);
  }
  return text;
}

/**
 * @param {{
 *   provider: string,
 *   model: string,
 *   message: string,
 *   systemPrompt?: string,
 *   context?: string,
 *   fetchImpl?: typeof fetch,
 *   onChunk?: (chunk: string) => void,
 * }} input
 */
export async function streamCanopyProxy({ provider, model, message, systemPrompt, context, fetchImpl, onChunk }) {
  const fetchFn = fetchImpl || fetch;
  const response = await fetchFn("/api/ai", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(proxyChatBody({ provider, model, message, systemPrompt, context })),
  });
  return readProxyStream(response, onChunk);
}

/**
 * Puter stays in the browser. Every other provider goes to the server proxy.
 * This function does not accept an API key.
 * @param {{
 *   provider: string,
 *   model: string,
 *   message: string,
 *   systemPrompt?: string,
 *   context?: string,
 *   loadPuter?: () => Promise<any>,
 *   fetchImpl?: typeof fetch,
 *   onChunk?: (chunk: string) => void,
 * }} input
 */
export async function askCanopy({ provider, model, message, systemPrompt, context, loadPuter, fetchImpl, onChunk }) {
  if (provider === "puter") {
    const ai = createAiClient({ provider: "puter", model, loadPuter });
    return ai.streamChat({ message, systemPrompt, context, onChunk });
  }
  return streamCanopyProxy({ provider, model, message, systemPrompt, context, fetchImpl, onChunk });
}
