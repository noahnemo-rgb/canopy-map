import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/ai/status")({
  server: {
    handlers: {
      GET: async () => {
        const { handleAiStatus } = await import("@/lib/ai-proxy.server");
        return handleAiStatus();
      },
    },
  },
});
