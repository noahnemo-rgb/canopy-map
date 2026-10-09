import {
  createAiProxy,
  createMemoryRateLimit,
  DEFAULT_GEMINI_MODEL,
  DEFAULT_LLMAPI_MODEL,
  DEFAULT_MODEL,
  DEFAULT_NVIDIA_MODEL,
  DEFAULT_VERCEL_GATEWAY_MODEL,
  looksLikeSecret,
  SERVER_PROXY_PROVIDERS,
  SPACE_BUNNY_MODEL,
  type ServerProxyProvider,
} from "ai-buffer";

type Env = Record<string, string | undefined>;

const HOST_ENV_NAMES = [
  "VITE_PUBLIC_HOSTNAME",
  "VERCEL_PROJECT_PRODUCTION_URL",
  "VERCEL_URL",
  "VERCEL_BRANCH_URL",
] as const;

const ENV_NAMES = [
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "GEMINI_API_KEY",
  "NVIDIA_API_KEY",
  "LLM_API_KEY",
  "OPENROUTER_MODEL",
  "AI_GATEWAY_MODEL",
  "GEMINI_MODEL",
  "LLMAPI_MODEL",
  "NVIDIA_MODEL",
  "AI_BUFFER_ALLOWED_ORIGINS",
  ...HOST_ENV_NAMES,
] as const;

export interface ProviderStatus {
  openrouterKey: boolean;
  gatewayKey: boolean;
  geminiKey: boolean;
  nvidiaKey: boolean;
  llmapiKey: boolean;
  keyHints: Record<string, string>;
}

const rateLimit = createMemoryRateLimit({ limit: 30, windowMs: 60_000 });

function pick(env: Env, name: string): string {
  const value = env[name];
  return typeof value === "string" ? value.trim() : "";
}

/** Copy the names this proxy reads. Callers pass `process.env` at request time. */
export function ownerEnv(source: Env): Env {
  const env: Env = {};
  for (const name of ENV_NAMES) env[name] = source[name];
  return env;
}

export function last4(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length < 4) return "";
  return trimmed.slice(-4);
}

function cleanHost(value: string | null | undefined): string | null {
  if (!value) return null;
  const host = value.split(",")[0]?.trim().toLowerCase() ?? "";
  if (!host || /[\s/\\]/.test(host) || host.includes("://")) return null;
  return host;
}

function isLocalHost(host: string): boolean {
  const name = host.replace(/:\d+$/, "");
  return name === "localhost" || name === "127.0.0.1" || name === "0.0.0.0" || name === "[::1]" || name === "::1";
}

function originForHost(host: string, protoHeader: string | null): string {
  if (isLocalHost(host)) return `http://${host}`;
  const proto = protoHeader?.split(",")[0]?.trim().toLowerCase();
  const scheme = proto === "http" || proto === "https" ? proto : "https";
  return `${scheme}://${host}`;
}

function explicitOrigins(value: string | undefined): string[] {
  if (!value) return [];
  const origins: string[] = [];
  for (const part of value.split(",")) {
    const origin = part.trim().replace(/\/$/, "");
    if (origin.startsWith("https://") || origin.startsWith("http://")) origins.push(origin);
  }
  return origins;
}

/**
 * Exact Origin allowlist: configured hosts, plus the host this request arrived on.
 * A browser on another site cannot set Origin to this host.
 */
export function allowedOriginsFor(request: Request, env: Env): string[] {
  const origins = new Set<string>(explicitOrigins(pick(env, "AI_BUFFER_ALLOWED_ORIGINS")));
  for (const name of HOST_ENV_NAMES) {
    const raw = pick(env, name).replace(/^https?:\/\//, "");
    const host = cleanHost(raw);
    if (host) origins.add(originForHost(host, "https"));
  }
  const proto = request.headers.get("x-forwarded-proto");
  const forwarded = cleanHost(request.headers.get("x-forwarded-host"));
  const host = cleanHost(request.headers.get("host"));
  if (forwarded) origins.add(originForHost(forwarded, proto));
  if (host) origins.add(originForHost(host, proto));
  return [...origins];
}

function modelList(values: Array<string | undefined>): string[] {
  const out: string[] = [];
  for (const value of values) {
    const trimmed = value?.trim() ?? "";
    if (!trimmed || looksLikeSecret(trimmed) || out.includes(trimmed)) continue;
    out.push(trimmed);
  }
  return out;
}

export function modelsFromEnv(env: Env): Partial<Record<ServerProxyProvider, readonly string[]>> {
  return {
    openrouter: modelList([pick(env, "OPENROUTER_MODEL"), DEFAULT_MODEL]),
    "space-bunny": [SPACE_BUNNY_MODEL],
    "vercel-gateway": modelList([pick(env, "AI_GATEWAY_MODEL"), DEFAULT_VERCEL_GATEWAY_MODEL]),
    gemini: modelList([pick(env, "GEMINI_MODEL"), DEFAULT_GEMINI_MODEL]),
    nvidia: modelList([pick(env, "NVIDIA_MODEL"), DEFAULT_NVIDIA_MODEL]),
    llmapi: modelList([pick(env, "LLMAPI_MODEL"), DEFAULT_LLMAPI_MODEL]),
  };
}

function hint(value: string): string {
  return last4(value);
}

/** Booleans and the last 4 characters. The full key is not copied onto the result. */
export function providerStatus(env: Env): ProviderStatus {
  const openrouter = pick(env, "OPENROUTER_API_KEY");
  const gateway = pick(env, "AI_GATEWAY_API_KEY") || pick(env, "VERCEL_OIDC_TOKEN");
  const gemini = pick(env, "GEMINI_API_KEY");
  const nvidia = pick(env, "NVIDIA_API_KEY");
  const llmapi = pick(env, "LLM_API_KEY");
  const keyHints: Record<string, string> = {};
  const assign = (id: string, value: string) => {
    const tail = hint(value);
    if (tail) keyHints[id] = tail;
  };
  assign("openrouter", openrouter);
  assign("space-bunny", openrouter);
  assign("vercel-gateway", gateway);
  assign("gemini", gemini);
  assign("nvidia", nvidia);
  assign("llmapi", llmapi);
  return {
    openrouterKey: Boolean(openrouter),
    gatewayKey: Boolean(gateway),
    geminiKey: Boolean(gemini),
    nvidiaKey: Boolean(nvidia),
    llmapiKey: Boolean(llmapi),
    keyHints,
  };
}

function siteUrlFrom(request: Request, origins: readonly string[]): string | undefined {
  const origin = request.headers.get("origin");
  if (origin && origins.includes(origin)) return origin;
  return origins.find((item) => item.startsWith("https://"));
}

export function handleAiProxy(
  request: Request,
  source: Env = process.env,
  fetchImpl?: typeof fetch,
): Promise<Response> {
  const env = ownerEnv(source);
  const allowedOrigins = allowedOriginsFor(request, env);
  const proxy = createAiProxy({
    allowedOrigins,
    allowMissingOrigin: false,
    providers: SERVER_PROXY_PROVIDERS,
    models: modelsFromEnv(env),
    rateLimit,
    allowByok: false,
    env,
    appName: "Canopy",
    siteUrl: siteUrlFrom(request, allowedOrigins),
    fetchImpl,
  });
  return proxy(request);
}

export function handleAiStatus(source: Env = process.env): Response {
  const body = providerStatus(ownerEnv(source));
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}
