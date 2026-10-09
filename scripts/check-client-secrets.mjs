#!/usr/bin/env node
/**
 * Fail the production build when client JS contains a key-shaped string
 * or a provider key that was present in the environment during the build.
 */
import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const KEY_SHAPES = [
  /\bsk-[A-Za-z0-9]{16,}/,
  /\bnvapi-[A-Za-z0-9]{16,}/i,
  /\bAIza[0-9A-Za-z_-]{20,}/,
  /\b(?:OPENROUTER_API_KEY|AI_GATEWAY_API_KEY|VERCEL_OIDC_TOKEN|GEMINI_API_KEY|NVIDIA_API_KEY|LLM_API_KEY|AI_BUFFER_VAULT_KEY)\s*=\s*\S+/,
];

const SECRET_ENV_NAMES = [
  "OPENROUTER_API_KEY",
  "AI_GATEWAY_API_KEY",
  "VERCEL_OIDC_TOKEN",
  "GEMINI_API_KEY",
  "NVIDIA_API_KEY",
  "LLM_API_KEY",
  "AI_BUFFER_VAULT_KEY",
];

const CLIENT_DIRS = [".vercel/output/static", ".output/public", "dist/client"];

const SKIP_EXT = new Set([".map", ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".woff", ".woff2", ".wasm"]);

export function secretSentinels(env) {
  const sentinels = [];
  for (const name of SECRET_ENV_NAMES) {
    const value = env[name]?.trim();
    if (value && value.length >= 8) sentinels.push(value);
  }
  return sentinels;
}

export function scanText(text, sentinels = []) {
  const hits = [];
  for (const pattern of KEY_SHAPES) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) hits.push(pattern.source);
  }
  for (const sentinel of sentinels) {
    if (text.includes(sentinel)) hits.push("env");
  }
  return hits;
}

function filesUnder(dir) {
  const found = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      if (name === "node_modules") continue;
      found.push(...filesUnder(path));
    } else {
      found.push(path);
    }
  }
  return found;
}

export function clientOutputDirs(root) {
  return CLIENT_DIRS.map((dir) => join(root, dir)).filter((dir) => existsSync(dir));
}

export function scanClientOutput(root, sentinels = secretSentinels(process.env)) {
  const dirs = clientOutputDirs(root);
  const hits = [];
  let files = 0;
  for (const dir of dirs) {
    for (const path of filesUnder(dir)) {
      const lower = path.toLowerCase();
      if ([...SKIP_EXT].some((ext) => lower.endsWith(ext))) continue;
      files += 1;
      const text = readFileSync(path, "utf8");
      const found = scanText(text, sentinels);
      if (found.length) hits.push(relative(root, path));
    }
  }
  return { dirs, files, hits };
}

function projectRoot() {
  return fileURLToPath(new URL("..", import.meta.url));
}

function isMainModule() {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

function main() {
  const root = projectRoot();
  const { dirs, files, hits } = scanClientOutput(root);
  if (!dirs.length) {
    console.error(`[client-secrets] no client build output under ${CLIENT_DIRS.join(", ")}`);
    process.exit(1);
  }
  if (!files) {
    console.error("[client-secrets] client build output has no files to scan");
    process.exit(1);
  }
  if (hits.length) {
    console.error(`[client-secrets] key-shaped string in client output: ${hits.join(", ")}`);
    process.exit(1);
  }
  console.log(`[client-secrets] scanned ${files} client file(s)`);
}

if (isMainModule()) main();
