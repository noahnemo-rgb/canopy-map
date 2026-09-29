import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { GROK_PROVIDERS, signIn } from "@/lib/auth/client";
import { enterFreeMap } from "@/lib/auth/guest.server";
import { UserButton } from "@/lib/auth/gates";
import {
  LEVELS,
  MATURITY,
  MATURITY_COLOR,
  PRO_PRICE,
  type CanopyNode,
  type CanopySnapshot,
  type Level,
  type Maturity,
  dumpYaml,
  layoutTree,
} from "@/lib/canopy";
import { addGap, addNode, deleteNode, getCanopy, importYaml, removeGap, requestPro, saveNode, scanNode } from "@/lib/canopy-fns";

const inputClass =
  "w-full rounded-md border border-line bg-ink px-3 py-2.5 text-sm text-paper placeholder:text-mute focus:border-leaf focus:outline-none";

export function Landing() {
  return (
    <main className="min-h-screen bg-ink text-paper">
      <div className="mx-auto flex max-w-3xl flex-col gap-8 px-5 py-12">
        <p className="font-display text-4xl text-leaf">Canopy</p>
        <h1 className="font-display text-4xl leading-tight sm:text-5xl">One map for every repo you are building.</h1>
        <p className="max-w-xl text-lg leading-relaxed text-mute">
          Put a workspace, the areas inside it, the projects inside those, and each GitHub repo on a single graph.
          Write the gaps you still see. Canopy tracks them. It does not write the code.
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <PlanCard title="Free" price="$0" points={["1 map", "20 nodes", "Gap notes", "Download YAML"]} />
          <PlanCard title="Pro" price={PRO_PRICE} points={["6 maps", "400 nodes", "Live GitHub check", "Same one-graph map"]} />
        </div>
        <p className="text-sm text-mute">Pro is not charged in this first build. Sign in and the free map is yours.</p>
        <div className="flex max-w-sm flex-col gap-2">
          {GROK_PROVIDERS.map((p) => (
            <button
              key={p.providerId}
              type="button"
              onClick={() => signIn(p.providerId, { callbackURL: "/" })}
              className="rounded-md border border-line bg-panel px-4 py-3 text-sm font-medium hover:border-leaf"
            >
              Continue with {p.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => {
              void enterFreeMap().then(() => {
                window.location.assign("/");
              });
            }}
            className="rounded-md bg-leaf px-4 py-3 text-sm font-medium text-leaf-ink"
          >
            Use the free map
          </button>
          <p className="text-sm text-mute">
            This browser keeps one free map. Download YAML so you do not lose it. Sign-in comes later.
          </p>
        </div>
      </div>
    </main>
  );
}

function PlanCard({ title, price, points }: { title: string; price: string; points: string[] }) {
  return (
    <section className="rounded-xl border border-line bg-panel p-4">
      <h2 className="font-display text-2xl">{title}</h2>
      <p className="mt-1 text-sm text-leaf">{price}</p>
      <ul className="mt-3 space-y-1 text-sm text-mute">
        {points.map((p) => (
          <li key={p}>{p}</li>
        ))}
      </ul>
    </section>
  );
}

export function CanopyApp({ guest = false }: { guest?: boolean }) {
  const [snap, setSnap] = useState<CanopySnapshot | null>(null);
  const [mapId, setMapId] = useState<string>("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [plansOpen, setPlansOpen] = useState(false);
  const [path, setPath] = useState("");
  const [name, setName] = useState("");
  const [repo, setRepo] = useState("");
  const [level, setLevel] = useState<string>("auto");
  const [maturity, setMaturity] = useState<Maturity>("idea");
  const [parentId, setParentId] = useState("");
  const [gapText, setGapText] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLDivElement>(null);

  useEffect(() => {
    getCanopy()
      .then((s) => {
        setSnap(s);
        setMapId((cur) => cur || s.maps[0]?.id || "");
      })
      .catch((e: Error) => setError(e.message || "Could not load your map."));
  }, []);

  const nodes = useMemo(() => (snap?.nodes ?? []).filter((n) => n.mapId === mapId), [snap, mapId]);
  const layout = useMemo(() => layoutTree(nodes), [nodes]);
  const selected = nodes.find((n) => n.id === selectedId) ?? null;
  const map = snap?.maps.find((m) => m.id === mapId) ?? null;

  useEffect(() => {
    const el = scroller.current;
    const root = nodes.find((n) => !n.parentId);
    const p = root ? layout.pos.get(root.id) : undefined;
    if (!el || !p) return;
    el.scrollLeft = Math.max(0, p.x - el.clientWidth / 2);
    el.scrollTop = 0;
  }, [mapId, nodes.length]);

  async function run(fn: () => Promise<CanopySnapshot | { snapshot: CanopySnapshot; leafId: string }>) {
    setBusy(true);
    setError("");
    try {
      const result = await fn();
      if ("snapshot" in result) {
        setSnap(result.snapshot);
        setSelectedId(result.leafId);
      } else setSnap(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }

  async function onAdd(e: FormEvent) {
    e.preventDefault();
    if (!mapId) return;
    setBusy(true);
    setError("");
    try {
      const result = await addNode({ data: { mapId, path, name, repo, level, maturity, parentId } });
      setSnap(result.snapshot);
      setSelectedId(result.leafId);
      setPath("");
      setName("");
      setRepo("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not add that.");
    } finally {
      setBusy(false);
    }
  }

  function download() {
    if (!map) return;
    const blob = new Blob([dumpYaml(map.name, nodes)], { type: "text/yaml" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "canopy-map.yaml";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onUpload(file: File) {
    const yaml = await file.text();
    await run(() => importYaml({ data: { mapId, yaml } }));
  }

  return (
    <div className="min-h-screen bg-ink text-paper">
      <header className="flex flex-wrap items-center gap-3 border-b border-line px-4 py-3">
        <div className="mr-auto">
          <p className="font-display text-2xl leading-none text-leaf">Canopy</p>
          <p className="text-xs text-mute">One graph. Every level of your work.</p>
        </div>
        {snap && (
          <button type="button" onClick={() => setPlansOpen((v) => !v)} className="rounded-full border border-line px-3 py-2 text-xs text-mute">
            {snap.plan === "pro" ? "Pro" : "Free"} · {nodes.length}/{snap.nodeCap}
          </button>
        )}
        {guest ? (
          <>
            <p className="text-sm text-mute">Guest · this browser</p>
            <button type="button" onClick={download} className="rounded-md border border-line px-3 py-2 text-sm">
              Download YAML
            </button>
          </>
        ) : (
          <UserButton />
        )}
      </header>

      {plansOpen && snap && (
        <div className="border-b border-line bg-panel px-4 py-4 text-sm">
          <p>Free is {snap.mapCap === 1 ? "one map" : `${snap.mapCap} maps`} and {snap.nodeCap} nodes on your plan. Pro is six maps, 400 nodes, and a live GitHub check, at {PRO_PRICE}.</p>
          <p className="mt-1 text-mute">Nothing is charged in this build. Asking for Pro only puts you on the list.</p>
          {snap.proInterest ? (
            <p className="mt-2 text-leaf">You are on the list.</p>
          ) : (
            <button type="button" disabled={busy} onClick={() => run(() => requestPro())} className="mt-3 rounded-md bg-leaf px-3 py-2 text-sm font-medium text-leaf-ink">
              Put me on the Pro list
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 p-4 lg:grid-cols-[300px_1fr]">
        <form onSubmit={onAdd} className="space-y-3 rounded-xl border border-line bg-panel p-4">
          <h2 className="font-display text-xl">Add to this map</h2>
          <label className="block text-xs text-mute">
            Path
            <input className={`${inputClass} mt-1`} value={path} onChange={(e) => setPath(e.target.value)} placeholder="Learning/First website/About page" spellCheck={false} />
          </label>
          <label className="block text-xs text-mute">
            Name, if you are not using a path
            <input className={`${inputClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} placeholder="About page" />
          </label>
          <label className="block text-xs text-mute">
            GitHub repo, optional
            <input className={`${inputClass} mt-1`} value={repo} onChange={(e) => setRepo(e.target.value)} placeholder="owner/repo" spellCheck={false} />
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-xs text-mute">
              Level
              <select className={`${inputClass} mt-1`} value={level} onChange={(e) => setLevel(e.target.value)} aria-label="Level">
                <option value="auto">Auto from path</option>
                {LEVELS.map((l) => (
                  <option key={l} value={l}>{l}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs text-mute">
              Stage
              <select className={`${inputClass} mt-1`} value={maturity} onChange={(e) => setMaturity(e.target.value as Maturity)} aria-label="Stage">
                {MATURITY.map((m) => (
                  <option key={m} value={m}>{m}</option>
                ))}
              </select>
            </label>
          </div>
          <label className="block text-xs text-mute">
            Parent, if you typed a name and no path
            <select className={`${inputClass} mt-1`} value={parentId} onChange={(e) => setParentId(e.target.value)} aria-label="Parent">
              <option value="">Top of the path</option>
              {nodes.map((n) => (
                <option key={n.id} value={n.id}>{n.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" disabled={busy || !mapId} className="w-full rounded-md bg-leaf px-3 py-3 text-sm font-semibold text-leaf-ink disabled:opacity-50">
            Add to map
          </button>
          <p className="text-xs leading-relaxed text-mute">
            The last part of the path is the new piece. Missing middle names are created. Download the YAML and keep that file. Uploading adds and updates. It does not delete nodes that are absent from the file.
          </p>
          <div className="flex gap-2">
            <button type="button" onClick={download} className="flex-1 rounded-md border border-line px-3 py-2 text-sm">Download YAML</button>
            <button type="button" onClick={() => fileRef.current?.click()} className="flex-1 rounded-md border border-line px-3 py-2 text-sm">Upload YAML</button>
            <input ref={fileRef} type="file" accept=".yaml,.yml,text/yaml" hidden onChange={(e) => { const f = e.target.files?.[0]; if (f) void onUpload(f); e.target.value = ""; }} />
          </div>
          {error && <p role="alert" className="text-sm text-amber">{error}</p>}
        </form>

        <section className="min-w-0 space-y-3">
          <div className="flex flex-wrap items-end justify-between gap-2">
            <div>
              <h2 className="font-display text-2xl">{map?.name ?? "Map"}</h2>
              <p className="text-xs text-mute">Workspace, area, project, repo — all on this drawing.</p>
            </div>
            <div className="flex flex-wrap gap-2 text-[11px] text-mute">
              {MATURITY.map((m) => (
                <span key={m} className="inline-flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: MATURITY_COLOR[m] }} />
                  {m}
                </span>
              ))}
            </div>
          </div>

          <div ref={scroller} className="relative max-h-[70vh] overflow-auto rounded-xl border border-line bg-[#10150e]">
            <svg width={layout.width} height={layout.height} role="img" aria-label="Your project map" className="block">
              {nodes.map((n) => {
                if (!n.parentId) return null;
                const a = layout.pos.get(n.parentId);
                const b = layout.pos.get(n.id);
                if (!a || !b) return null;
                const mid = (a.y + b.y) / 2;
                return (
                  <path key={n.id + "-link"} d={`M${a.x},${a.y + a.r} C${a.x},${mid} ${b.x},${mid} ${b.x},${b.y - b.r}`} fill="none" stroke="#3d4a34" strokeWidth={1.6} />
                );
              })}
              {nodes.map((n) => {
                const p = layout.pos.get(n.id);
                if (!p) return null;
                const gapN = n.gaps.length + n.scanFlags.filter((f) => f !== "quiet on GitHub").length;
                const on = selectedId === n.id;
                return (
                  <g key={n.id} transform={`translate(${p.x},${p.y})`} className="cursor-pointer" onClick={() => setSelectedId(n.id)}>
                    <circle r={p.r + 4} fill="none" stroke={on ? "#d6e36a" : "#2c3826"} strokeWidth={on ? 2 : 1} />
                    <circle r={p.r} fill={MATURITY_COLOR[n.maturity]} />
                    {gapN > 0 && (
                      <text y={-(p.r + 8)} textAnchor="middle" fill="#e39a4a" fontSize={11} fontFamily="Outfit, sans-serif">
                        {n.gaps.length ? `${n.gaps.length} gap${n.gaps.length === 1 ? "" : "s"}` : `${gapN} flag${gapN === 1 ? "" : "s"}`}
                      </text>
                    )}
                    <text y={p.r + 16} textAnchor="middle" fill="#f4f1e6" fontSize={13} fontFamily="Fraunces, serif">
                      {n.name.length > 28 ? n.name.slice(0, 26) + "…" : n.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          {selected && (
            <NodeCard
              node={selected}
              busy={busy}
              scanEnabled={!!snap?.scanEnabled}
              gapText={gapText}
              setGapText={setGapText}
              onSave={(draft) => run(() => saveNode({ data: { id: selected.id, ...draft } }))}
              onGap={() => run(async () => { const next = await addGap({ data: { id: selected.id, text: gapText } }); setGapText(""); return next; })}
              onRemoveGap={(index) => run(() => removeGap({ data: { id: selected.id, index } }))}
              onScan={() => run(() => scanNode({ data: selected.id }))}
              onDelete={() => {
                if (!confirm(`Remove ${selected.name} and everything under it from the map? The GitHub repo is not deleted.`)) return;
                setSelectedId(null);
                void run(() => deleteNode({ data: selected.id }));
              }}
            />
          )}

          <div className="rounded-xl border border-line">
            <p className="border-b border-line px-3 py-2 text-xs text-mute">Same map, as a list</p>
            <ul>
              {nodes.map((n) => (
                <li key={n.id}>
                  <button type="button" onClick={() => setSelectedId(n.id)} className="flex w-full items-baseline justify-between gap-3 px-3 py-2.5 text-left text-sm hover:bg-panel">
                    <span>{n.name}</span>
                    <span className="text-xs text-mute">{n.level}{n.gaps.length ? ` · ${n.gaps.length} gaps` : ""}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </section>
      </div>
    </div>
  );
}

function NodeCard({
  node, busy, scanEnabled, gapText, setGapText, onSave, onGap, onRemoveGap, onScan, onDelete,
}: {
  node: CanopyNode;
  busy: boolean;
  scanEnabled: boolean;
  gapText: string;
  setGapText: (v: string) => void;
  onSave: (d: { name: string; repo: string; maturity: Maturity; level: Level }) => void;
  onGap: () => void;
  onRemoveGap: (index: number) => void;
  onScan: () => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(node.name);
  const [repo, setRepo] = useState(node.repo);
  const [level, setLevel] = useState<Level>(node.level);
  const [maturity, setMaturity] = useState<Maturity>(node.maturity);
  useEffect(() => {
    setName(node.name);
    setRepo(node.repo);
    setLevel(node.level);
    setMaturity(node.maturity);
  }, [node.id, node.name, node.repo, node.level, node.maturity]);

  return (
    <article className="rounded-xl border border-line bg-panel p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="font-display text-2xl">{node.name}</h3>
        {node.parentId && (
          <button type="button" onClick={onDelete} className="text-xs text-mute underline-offset-2 hover:underline">Remove from map</button>
        )}
      </div>
      <div className="mt-3 grid gap-2 sm:grid-cols-2">
        <label className="text-xs text-mute">Name
          <input className={`${inputClass} mt-1`} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <label className="text-xs text-mute">GitHub owner/name
          <input className={`${inputClass} mt-1`} value={repo} onChange={(e) => setRepo(e.target.value)} spellCheck={false} />
        </label>
        <label className="text-xs text-mute">Level
          <select className={`${inputClass} mt-1`} value={level} onChange={(e) => setLevel(e.target.value as Level)}>
            {LEVELS.map((l) => <option key={l} value={l}>{l}</option>)}
          </select>
        </label>
        <label className="text-xs text-mute">Stage
          <select className={`${inputClass} mt-1`} value={maturity} onChange={(e) => setMaturity(e.target.value as Maturity)}>
            {MATURITY.map((m) => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" disabled={busy} onClick={() => onSave({ name, repo, maturity, level })} className="rounded-md bg-leaf px-3 py-2 text-sm font-medium text-leaf-ink disabled:opacity-50">Save details</button>
        {node.repo && (
          <a className="rounded-md border border-line px-3 py-2 text-sm" href={`https://github.com/${node.repo}`} target="_blank" rel="noreferrer">Open GitHub</a>
        )}
        <button type="button" disabled={busy || !scanEnabled} onClick={onScan} className="rounded-md border border-line px-3 py-2 text-sm disabled:opacity-50">
          {scanEnabled ? "Check GitHub" : "GitHub check is Pro"}
        </button>
      </div>
      <div className="mt-4">
        <p className="text-xs text-mute">Gaps you are tracking. Removing one only takes it off the map.</p>
        <ul className="mt-2 space-y-1 text-sm">
          {node.gaps.map((g, i) => (
            <li key={g + i} className="flex items-start justify-between gap-3">
              <span className="text-amber">{g}</span>
              <button type="button" onClick={() => onRemoveGap(i)} className="text-xs text-mute">Stop tracking</button>
            </li>
          ))}
          {!node.gaps.length && <li className="text-mute">None written yet.</li>}
        </ul>
        {node.scanFlags.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-mute">
            {node.scanFlags.map((f) => <li key={f}>GitHub: {f}</li>)}
          </ul>
        )}
        <div className="mt-2 flex gap-2">
          <input className={inputClass} value={gapText} onChange={(e) => setGapText(e.target.value)} placeholder="What is still open?" />
          <button type="button" disabled={busy} onClick={onGap} className="rounded-md border border-line px-3 text-sm">Track</button>
        </div>
      </div>
    </article>
  );
}
