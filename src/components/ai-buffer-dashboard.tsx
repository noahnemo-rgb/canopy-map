import type { AiProviderId, DashboardRow } from "ai-buffer";

export function AiBufferDashboard({
  rows,
  onSelect,
  onModel,
}: {
  rows: DashboardRow[];
  onSelect: (id: AiProviderId) => void;
  onModel: (id: AiProviderId, model: string) => void;
}) {
  return (
    <section>
      <h3 className="text-sm text-paper">ai-buffer</h3>
      <ul className="mt-2 space-y-2">
        {rows.map((row) => (
          <li
            key={row.id}
            data-active={row.activeLabel ? "true" : "false"}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 rounded-md border px-3 py-2 ${row.activeLabel ? "border-leaf" : "border-line"}`}
          >
            <button type="button" className="text-sm text-paper" onClick={() => onSelect(row.id)}>
              {row.label}
            </button>
            <span className="text-xs text-mute">{row.status}</span>
            <span className="text-xs text-mute">{row.keyHint}</span>
            <span className="text-xs text-leaf">{row.activeLabel}</span>
            <label className="flex items-center gap-2 text-xs text-mute">
              <span>{row.modelLabel}</span>
              <input
                className="w-44 rounded-md border border-line bg-ink px-2 py-1 text-sm text-paper"
                value={row.model}
                autoComplete="off"
                spellCheck={false}
                onChange={(event) => onModel(row.id, event.target.value)}
              />
            </label>
          </li>
        ))}
      </ul>
    </section>
  );
}
