import { createCallRouter } from "ai-buffer";

export const CANOPY_PROMPT =
  "You help a person read their Canopy map. The notes list work they are building and gaps they are tracking. Be concrete and short. Do not write the missing code.";

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
 * Puter first. A saved OpenRouter key tries Space Bunny Alpha, then gpt-4o-mini.
 */
export function createCanopyRouter({ apiKey, fetchImpl, loadPuter, timeoutMs, siteUrl }) {
  const key = typeof apiKey === "string" ? apiKey.trim() : "";
  const shared = key
    ? {
        getApiKey: () => key,
        appName: "Canopy",
        siteUrl: siteUrl || "https://canopy.local",
        fetchImpl,
        timeoutMs,
      }
    : null;
  return createCallRouter({
    puter: { model: "openai/gpt-4o-mini", loadPuter, timeoutMs },
    ...(shared
      ? {
          spaceBunny: shared,
          openrouter: { ...shared, model: "openai/gpt-4o-mini" },
        }
      : {}),
    order: ["puter", "space-bunny", "openrouter"],
  });
}
