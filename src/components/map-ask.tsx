import { useEffect, useRef, useState, type FormEvent } from "react";
import {
  createLocalStorageStore,
  createProviderSelectionStore,
  defaultModelFor,
  loadDashboard,
  type AiProviderId,
  type DashboardRow,
  type ProviderSelectionStore,
} from "ai-buffer";
import { AiBufferDashboard } from "@/components/ai-buffer-dashboard";
import { askCanopy, CANOPY_PROMPT, forgetBrowserProviderKeys, loadCanopyProbe, mapNotes } from "@/lib/canopy-ai.js";
import type { CanopyNode } from "@/lib/canopy";

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

function readPuterSignedIn() {
  const puter = (window as Window & { puter?: { auth?: { isSignedIn?: () => boolean } } }).puter;
  try {
    return Boolean(puter?.auth?.isSignedIn?.());
  } catch {
    return false;
  }
}

export function MapAsk({ nodes }: { nodes: CanopyNode[] }) {
  const storeRef = useRef<ProviderSelectionStore | null>(null);
  const [rows, setRows] = useState<DashboardRow[]>([]);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function refresh(store: ProviderSelectionStore) {
    const probe = await loadCanopyProbe(fetch, readPuterSignedIn());
    setRows(await loadDashboard(store, probe));
  }

  useEffect(() => {
    forgetBrowserProviderKeys(window.localStorage);
    forgetBrowserProviderKeys(window.sessionStorage);
    const store = createProviderSelectionStore(createLocalStorageStore());
    storeRef.current = store;
    let cancel = false;
    void refresh(store).catch(() => {
      if (!cancel) setRows([]);
    });
    return () => {
      cancel = true;
    };
  }, []);

  async function onSelect(id: AiProviderId) {
    const store = storeRef.current;
    if (!store) return;
    await store.setProvider(id);
    await refresh(store);
  }

  async function onModel(id: AiProviderId, model: string) {
    const store = storeRef.current;
    if (!store) return;
    try {
      await store.setModel(id, model);
    } catch {
      // The library rejects a key-shaped model. Refresh puts the saved model back.
    }
    await refresh(store);
  }

  async function onAsk(event: FormEvent) {
    event.preventDefault();
    const message = question.trim();
    if (!message || busy) return;
    setBusy(true);
    setError("");
    setAnswer("");
    try {
      const selection = await storeRef.current?.getSelection();
      const provider = selection?.provider ?? "puter";
      const model = selection?.model || defaultModelFor(provider);
      let streamed = "";
      const text = await askCanopy({
        provider,
        model,
        message,
        systemPrompt: CANOPY_PROMPT,
        context: mapNotes(nodes),
        loadPuter,
        onChunk: (chunk: string) => {
          streamed += chunk;
          setAnswer(streamed);
        },
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
      <div className="mt-3">
        <AiBufferDashboard rows={rows} onSelect={(id) => void onSelect(id)} onModel={(id, model) => void onModel(id, model)} />
      </div>
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
