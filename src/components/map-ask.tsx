import { useEffect, useState, type FormEvent } from "react";
import { CANOPY_PROMPT, createCanopyRouter, mapNotes } from "@/lib/canopy-ai.js";
import type { CanopyNode } from "@/lib/canopy";

const KEY_NAME = "canopy_openrouter_key";

function loadPuter() {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") {
      reject(new Error("Puter runs in the browser."));
      return;
    }
    const existing = (window as Window & { puter?: { ai?: { chat?: unknown } } }).puter;
    if (existing?.ai?.chat) {
      resolve(existing);
      return;
    }
    const prior = document.querySelector('script[data-canopy="puter"]');
    if (prior) {
      prior.addEventListener("load", () => resolve((window as Window & { puter?: unknown }).puter));
      prior.addEventListener("error", () => reject(new Error("Puter script failed")));
      return;
    }
    const script = document.createElement("script");
    script.src = "https://js.puter.com/v2/";
    script.async = true;
    script.dataset.canopy = "puter";
    script.onload = () => resolve((window as Window & { puter?: unknown }).puter);
    script.onerror = () => reject(new Error("Puter script failed"));
    document.head.appendChild(script);
  });
}

export function MapAsk({ nodes }: { nodes: CanopyNode[] }) {
  const [key, setKey] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setKey(localStorage.getItem(KEY_NAME) || "");
  }, []);

  function saveKey(value: string) {
    setKey(value);
    const trimmed = value.trim();
    if (trimmed) localStorage.setItem(KEY_NAME, trimmed);
    else localStorage.removeItem(KEY_NAME);
  }

  async function onAsk(event: FormEvent) {
    event.preventDefault();
    const message = question.trim();
    if (!message || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const router = createCanopyRouter({
        apiKey: key,
        loadPuter,
        siteUrl: window.location.origin,
      });
      const text = await router.streamChat({
        message,
        systemPrompt: CANOPY_PROMPT,
        context: mapNotes(nodes),
      });
      setAnswer(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The map question did not go through.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onAsk} className="rounded-xl border border-line bg-panel p-4">
      <h2 className="font-display text-xl">Ask about this map</h2>
      <p className="mt-1 text-xs leading-relaxed text-mute">
        Puter runs first in this browser. An OpenRouter key saved here tries Space Bunny Alpha, then gpt-4o-mini. The key stays in this browser.
      </p>
      <label className="mt-3 block text-xs text-mute">
        OpenRouter key, optional
        <input
          type="password"
          className="mt-1 w-full rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-paper"
          value={key}
          onChange={(event) => saveKey(event.target.value)}
          placeholder="sk-or-..."
          autoComplete="off"
        />
      </label>
      <label className="mt-3 block text-xs text-mute">
        Question
        <textarea
          className="mt-1 min-h-20 w-full rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-paper"
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Which gap is the next one to look at?"
        />
      </label>
      <button type="submit" disabled={busy} className="mt-3 rounded-md bg-leaf px-3 py-2 text-sm font-medium text-leaf-ink disabled:opacity-50">
        {busy ? "Asking…" : "Ask"}
      </button>
      {error && <p role="alert" className="mt-3 text-sm text-amber">{error}</p>}
      {answer && <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed">{answer}</p>}
    </form>
  );
}
