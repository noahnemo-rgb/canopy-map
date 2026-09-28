export const LEVELS = ["workspace", "area", "project", "repo"] as const;
export type Level = (typeof LEVELS)[number];

export const MATURITY = ["idea", "started", "building", "usable", "live"] as const;
export type Maturity = (typeof MATURITY)[number];

export const MATURITY_COLOR: Record<Maturity, string> = {
  idea: "#8d9684",
  started: "#7ec8c3",
  building: "#e0b15a",
  usable: "#d6e36a",
  live: "#f7f4ea",
};

export const LEVEL_RADIUS: Record<Level, number> = {
  workspace: 26,
  area: 20,
  project: 15,
  repo: 11,
};

export const FREE_NODE_CAP = 20;
export const PRO_NODE_CAP = 400;
export const FREE_MAP_CAP = 1;
export const PRO_MAP_CAP = 6;
export const PRO_PRICE = "$9 a month";

export type CanopyNode = {
  id: string;
  mapId: string;
  parentId: string | null;
  name: string;
  level: Level;
  repo: string;
  maturity: Maturity;
  gaps: string[];
  scanFlags: string[];
};

export type CanopyMap = { id: string; name: string };

export type CanopySnapshot = {
  plan: "free" | "pro";
  proInterest: boolean;
  mapCap: number;
  nodeCap: number;
  scanEnabled: boolean;
  maps: CanopyMap[];
  nodes: CanopyNode[];
};

export function isLevel(v: string): v is Level {
  return (LEVELS as readonly string[]).includes(v);
}

export function isMaturity(v: string): v is Maturity {
  return (MATURITY as readonly string[]).includes(v);
}

export function childLevel(parent: Level): Level {
  if (parent === "workspace") return "area";
  if (parent === "area") return "project";
  if (parent === "project") return "repo";
  return "repo";
}

export function normKey(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

export function slugId(name: string) {
  const base = normKey(name).slice(0, 40) || "node";
  const tail = Math.random().toString(36).slice(2, 6);
  return `${base}-${tail}`;
}

export function cleanRepo(raw: string): string {
  let s = raw.trim().replace(/^https?:\/\//i, "").replace(/\.git$/i, "").replace(/\/$/, "");
  s = s.replace(/^github\.com\//i, "");
  if (!s) return "";
  if (!/^[\w.-]+\/[\w.-]+$/.test(s)) {
    throw new Error("Repo should look like owner/name");
  }
  return s;
}

export function layoutTree(nodes: CanopyNode[]) {
  const kids = new Map<string, CanopyNode[]>();
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    const key = n.parentId && byId.has(n.parentId) ? n.parentId : "";
    const list = kids.get(key) ?? [];
    list.push(n);
    kids.set(key, list);
  }
  for (const list of kids.values()) list.sort((a, b) => a.name.localeCompare(b.name));

  const pos = new Map<string, { x: number; y: number; r: number }>();
  const COL = 172;
  const ROW = 112;
  let maxDepth = 0;

  function place(n: CanopyNode, depth: number, x0: number): number {
    maxDepth = Math.max(maxDepth, depth);
    const children = kids.get(n.id) ?? [];
    const r = LEVEL_RADIUS[n.level] ?? 14;
    if (!children.length) {
      pos.set(n.id, { x: x0 + COL / 2, y: 56 + depth * ROW, r });
      return COL;
    }
    let cursor = x0;
    for (const child of children) cursor += place(child, depth + 1, cursor);
    const first = pos.get(children[0].id)!;
    const last = pos.get(children[children.length - 1].id)!;
    pos.set(n.id, { x: (first.x + last.x) / 2, y: 56 + depth * ROW, r });
    return Math.max(COL, cursor - x0);
  }

  let edge = 20;
  for (const root of kids.get("") ?? []) edge += place(root, 0, edge);
  const width = Math.max(680, edge + 28);
  const height = Math.max(320, 56 + (maxDepth + 1) * ROW + 48);
  return { width, height, pos };
}

function yamlQuote(s: string) {
  if (s === "") return '""';
  if (/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/.test(s) && !/^(true|false|null|yes|no)$/i.test(s)) return s;
  return JSON.stringify(s);
}

export function dumpYaml(mapName: string, nodes: CanopyNode[]) {
  const lines = [`map: ${yamlQuote(mapName)}`, "nodes:"];
  for (const n of nodes) {
    lines.push(`  - id: ${yamlQuote(n.id)}`);
    lines.push(`    name: ${yamlQuote(n.name)}`);
    lines.push(`    level: ${n.level}`);
    lines.push(`    parent: ${n.parentId ? yamlQuote(n.parentId) : '""'}`);
    lines.push(`    maturity: ${n.maturity}`);
    lines.push(`    repo: ${yamlQuote(n.repo)}`);
    if (!n.gaps.length) lines.push("    gaps: []");
    else {
      lines.push("    gaps:");
      for (const g of n.gaps) lines.push(`      - ${yamlQuote(g)}`);
    }
  }
  return lines.join("\n") + "\n";
}

export function parseMapYaml(text: string): { mapName: string; nodes: Array<Omit<CanopyNode, "mapId" | "scanFlags">> } {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let mapName = "My map";
  const nodes: Array<Omit<CanopyNode, "mapId" | "scanFlags">> = [];
  let cur: Omit<CanopyNode, "mapId" | "scanFlags"> | null = null;
  let inGaps = false;

  const unquote = (raw: string) => {
    const s = raw.trim();
    if (s === '""' || s === "''" || s === "~" || s === "null") return "";
    if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
      try {
        return JSON.parse(s.startsWith("'") ? `"${s.slice(1, -1).replace(/"/g, '\\"')}"` : s);
      } catch {
        return s.slice(1, -1);
      }
    }
    return s;
  };

  const flush = () => {
    if (!cur) return;
    if (!cur.name) cur.name = cur.id;
    if (!isLevel(cur.level)) cur.level = "project";
    if (!isMaturity(cur.maturity)) cur.maturity = "idea";
    nodes.push(cur);
    cur = null;
    inGaps = false;
  };

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const mapHit = line.match(/^map:\s*(.*)$/);
    if (mapHit && !line.startsWith(" ")) {
      mapName = unquote(mapHit[1]) || mapName;
      continue;
    }
    if (/^\s*-\s+id:\s*/.test(line)) {
      flush();
      const id = unquote(line.replace(/^\s*-\s+id:\s*/, ""));
      cur = {
        id: id || slugId("node"),
        parentId: null,
        name: "",
        level: "project",
        repo: "",
        maturity: "idea",
        gaps: [],
      };
      inGaps = false;
      continue;
    }
    if (!cur) continue;
    const gapItem = line.match(/^\s+-\s+(.*)$/);
    if (inGaps && gapItem) {
      const g = unquote(gapItem[1]);
      if (g) cur.gaps.push(g);
      continue;
    }
    const field = line.match(/^\s{4}([A-Za-z_]+):\s*(.*)$/);
    if (!field) continue;
    const key = field[1];
    const val = unquote(field[2] ?? "");
    if (key === "gaps") {
      inGaps = true;
      if (val === "[]") cur.gaps = [];
      continue;
    }
    inGaps = false;
    if (key === "name") cur.name = val;
    else if (key === "level" && isLevel(val)) cur.level = val;
    else if (key === "parent") cur.parentId = val || null;
    else if (key === "maturity" && isMaturity(val)) cur.maturity = val;
    else if (key === "repo") cur.repo = val;
  }
  flush();
  if (!nodes.length) throw new Error("No nodes found. Use Download YAML and edit that file.");
  return { mapName, nodes };
}
