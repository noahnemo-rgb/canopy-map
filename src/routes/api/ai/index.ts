import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ai/")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const { handleAiProxy } = await import("@/lib/ai-proxy.server");
        return handleAiProxy(request);
      },
    },
  },
});
