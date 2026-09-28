import { createServerFn } from "@tanstack/react-start";
import { authMiddleware } from "@/lib/auth/middleware";
import {
  FREE_MAP_CAP,
  FREE_NODE_CAP,
  PRO_MAP_CAP,
  PRO_NODE_CAP,
  type CanopyNode,
  type CanopySnapshot,
  type Level,
  type Maturity,
  childLevel,
  cleanRepo,
  isLevel,
  isMaturity,
  normKey,
  parseMapYaml,
  slugId,
} from "@/lib/canopy";

type PlanRow = { plan: string; pro_interest: boolean; seeded: boolean };
type MapRow = { id: string; name: string };
type NodeRow = {
  id: string;
  map_id: string;
  parent_id: string | null;
  name: string;
  level: string;
  repo: string;
  maturity: string;
  gaps: string;
  scan_flags: string;
};

async function db() {
  const { getSql } = await import("@/lib/db");
  return getSql();
}

function asList(raw: string): string[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x) => typeof x === "string") : [];
  } catch {
    return [];
  }
}

function limits(plan: "free" | "pro") {
  return plan === "pro"
    ? { mapCap: PRO_MAP_CAP, nodeCap: PRO_NODE_CAP, scanEnabled: true }
    : { mapCap: FREE_MAP_CAP, nodeCap: FREE_NODE_CAP, scanEnabled: false };
}

async function snapshot(userId: string): Promise<CanopySnapshot> {
  const sql = await db();
  await sql`insert into canopy_plans (user_id) values (${userId}) on conflict (user_id) do nothing`;
  const won = await sql<{ user_id: string }>`
    update canopy_plans set seeded = true
    where user_id = ${userId} and seeded = false
    returning user_id
  `;
  if (won.length) await seedExample(userId);

  const plans = await sql<PlanRow>`select plan, pro_interest, seeded from canopy_plans where user_id = ${userId}`;
  const plan = plans[0]?.plan === "pro" ? "pro" : "free";
  const maps = await sql<MapRow>`select id, name from canopy_maps where user_id = ${userId} order by created_at`;
  const rows = await sql<NodeRow>`
    select id, map_id, parent_id, name, level, repo, maturity, gaps, scan_flags
    from canopy_nodes where user_id = ${userId} order by created_at
  `;
  const nodes: CanopyNode[] = rows.map((r) => ({
    id: r.id,
    mapId: r.map_id,
    parentId: r.parent_id,
    name: r.name,
    level: isLevel(r.level) ? r.level : "project",
    repo: r.repo || "",
    maturity: isMaturity(r.maturity) ? r.maturity : "idea",
    gaps: asList(r.gaps),
    scanFlags: asList(r.scan_flags),
  }));
  return {
    plan,
    proInterest: Boolean(plans[0]?.pro_interest),
    ...limits(plan),
    maps,
    nodes,
  };
}

async function seedExample(userId: string) {
  const sql = await db();
  const mapId = "map-my-work";
  await sql`insert into canopy_maps (id, user_id, name) values (${mapId}, ${userId}, ${"My work"}) on conflict (user_id, id) do nothing`;
  const rows: Array<[string, string | null, string, Level, string, Maturity, string[]]> = [
    ["my-work", null, "My work", "workspace", "", "started", []],
    ["learning", "my-work", "Learning", "area", "", "started", []],
    ["first-website", "learning", "First website", "project", "", "building", ["decide who it is for"]],
    ["hello-pages", "first-website", "Hello pages", "repo", "octocat/Hello-World", "started", ["pick a real name", "write what the site is for"]],
    ["client-work", "my-work", "Client work", "area", "", "idea", []],
    ["bakery", "client-work", "Neighborhood bakery", "project", "", "idea", ["no repo yet"]],
  ];
  for (const [id, parent, name, level, repo, maturity, gaps] of rows) {
    await sql`
      insert into canopy_nodes (id, user_id, map_id, parent_id, name, level, repo, maturity, gaps)
      values (${id}, ${userId}, ${mapId}, ${parent}, ${name}, ${level}, ${repo}, ${maturity}, ${JSON.stringify(gaps)})
      on conflict (user_id, id) do nothing
    `;
  }
}

async function nodeCount(userId: string, mapId: string) {
  const sql = await db();
  const rows = await sql<{ n: number }>`select count(*)::int as n from canopy_nodes where user_id = ${userId} and map_id = ${mapId}`;
  return rows[0]?.n ?? 0;
}

async function ownedMap(userId: string, mapId: string) {
  const sql = await db();
  const rows = await sql<{ id: string }>`select id from canopy_maps where id = ${mapId} and user_id = ${userId}`;
  if (!rows.length) throw new Error("That map is not yours.");
}

export const getCanopy = createServerFn({ method: "GET" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => snapshot(context.userId));

export const createMap = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((name: string) => name.trim().slice(0, 80))
  .handler(async ({ context, data: name }) => {
    if (!name) throw new Error("Name the map.");
    const snap = await snapshot(context.userId);
    if (snap.maps.length >= snap.mapCap) {
      throw new Error(snap.plan === "free" ? "The free plan holds one map. Pro holds six." : "Map limit reached.");
    }
    const sql = await db();
    const id = slugId(name);
    await sql`insert into canopy_maps (id, user_id, name) values (${id}, ${context.userId}, ${name})`;
    const rootId = slugId(name + "-root");
    await sql`
      insert into canopy_nodes (id, user_id, map_id, parent_id, name, level, maturity)
      values (${rootId}, ${context.userId}, ${id}, ${null}, ${name}, ${"workspace"}, ${"idea"})
    `;
    return snapshot(context.userId);
  });

export const addNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { mapId: string; path: string; name: string; repo: string; level: string; maturity: string; parentId: string }) => input)
  .handler(async ({ context, data }) => {
    const userId = context.userId;
    await ownedMap(userId, data.mapId);
    const snap = await snapshot(userId);
    const repo = cleanRepo(data.repo || "");
    const maturity: Maturity = isMaturity(data.maturity) ? data.maturity : "idea";
    const chosen = data.level === "auto" || !isLevel(data.level) ? null : data.level;
    const tokens = (data.path || "")
      .split("/")
      .map((s) => s.trim())
      .filter(Boolean);
    const name = (data.name || "").trim();
    if (!tokens.length && !name) throw new Error("Type a path or a name.");

    const sql = await db();
    const rows = await sql<NodeRow>`
      select id, map_id, parent_id, name, level, repo, maturity, gaps, scan_flags
      from canopy_nodes where user_id = ${userId} and map_id = ${data.mapId}
    `;
    const nodes = rows.map((r) => ({
      id: r.id,
      parentId: r.parent_id,
      name: r.name,
      level: (isLevel(r.level) ? r.level : "project") as Level,
    }));
    const byParent = new Map<string | null, typeof nodes>();
    for (const n of nodes) {
      const list = byParent.get(n.parentId) ?? [];
      list.push(n);
      byParent.set(n.parentId, list);
    }
    const findChild = (parentId: string | null, token: string) => {
      const k = normKey(token);
      return (byParent.get(parentId) ?? []).find((n) => normKey(n.id) === k || normKey(n.name) === k) ?? null;
    };

    let parentId: string | null = null;
    let parentLevel: Level = "workspace";
    const roots = byParent.get(null) ?? [];
    if (roots[0]) {
      parentId = roots[0].id;
      parentLevel = roots[0].level;
    }

    const steps = tokens.length ? tokens : [name];
    if (!data.path && data.parentId) {
      const p = nodes.find((n) => n.id === data.parentId);
      if (p) {
        parentId = p.id;
        parentLevel = p.level;
      }
    }
    if (tokens.length && roots[0] && (normKey(tokens[0]) === normKey(roots[0].name) || normKey(tokens[0]) === normKey(roots[0].id))) {
      steps.shift();
    }
    if (!steps.length) throw new Error("That path is already the top of the map.");

    let leafId = "";
    for (let i = 0; i < steps.length; i++) {
      const last = i === steps.length - 1;
      const token = steps[i];
      const existing = findChild(parentId, token);
      if (existing && !last) {
        parentId = existing.id;
        parentLevel = existing.level;
        continue;
      }
      if (existing && last) throw new Error(`${existing.name} is already on the map.`);
      const display = last && name ? name : token;
      const level: Level = last && chosen ? chosen : childLevel(parentLevel);
      if ((await nodeCount(userId, data.mapId)) >= snap.nodeCap) {
        throw new Error(`This plan holds ${snap.nodeCap} nodes. Download your YAML before you add more, or join Pro.`);
      }
      const id = slugId(display);
      await sql`
        insert into canopy_nodes (id, user_id, map_id, parent_id, name, level, repo, maturity, gaps)
        values (
          ${id}, ${userId}, ${data.mapId}, ${parentId}, ${display}, ${level},
          ${last ? repo : ""}, ${last ? maturity : "idea"}, ${"[]"}
        )
      `;
      const created = { id, parentId, name: display, level };
      const list = byParent.get(parentId) ?? [];
      list.push(created);
      byParent.set(parentId, list);
      parentId = id;
      parentLevel = level;
      leafId = id;
    }
    const next = await snapshot(userId);
    return { snapshot: next, leafId };
  });

export const saveNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; name: string; repo: string; maturity: string; level: string }) => input)
  .handler(async ({ context, data }) => {
    if (!isLevel(data.level) || !isMaturity(data.maturity)) throw new Error("Pick a level and a stage.");
    const name = data.name.trim().slice(0, 80);
    if (!name) throw new Error("A node needs a name.");
    const repo = cleanRepo(data.repo || "");
    const sql = await db();
    await sql`
      update canopy_nodes
      set name = ${name}, repo = ${repo}, maturity = ${data.maturity}, level = ${data.level}
      where id = ${data.id} and user_id = ${context.userId}
    `;
    return snapshot(context.userId);
  });

export const addGap = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; text: string }) => input)
  .handler(async ({ context, data }) => {
    const text = data.text.trim().slice(0, 180);
    if (!text) throw new Error("Write the gap in a few words.");
    const sql = await db();
    const rows = await sql<{ gaps: string }>`select gaps from canopy_nodes where id = ${data.id} and user_id = ${context.userId}`;
    if (!rows.length) throw new Error("Node not found.");
    const gaps = asList(rows[0].gaps);
    gaps.push(text);
    await sql`update canopy_nodes set gaps = ${JSON.stringify(gaps)} where id = ${data.id} and user_id = ${context.userId}`;
    return snapshot(context.userId);
  });

export const removeGap = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { id: string; index: number }) => input)
  .handler(async ({ context, data }) => {
    const sql = await db();
    const rows = await sql<{ gaps: string }>`select gaps from canopy_nodes where id = ${data.id} and user_id = ${context.userId}`;
    if (!rows.length) throw new Error("Node not found.");
    const gaps = asList(rows[0].gaps);
    gaps.splice(data.index, 1);
    await sql`update canopy_nodes set gaps = ${JSON.stringify(gaps)} where id = ${data.id} and user_id = ${context.userId}`;
    return snapshot(context.userId);
  });

export const deleteNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const sql = await db();
    const rows = await sql<{ id: string; parent_id: string | null; map_id: string }>`
      select id, parent_id, map_id from canopy_nodes where user_id = ${context.userId}
    `;
    const target = rows.find((r) => r.id === id);
    if (!target) throw new Error("Node not found.");
    if (!target.parent_id) throw new Error("The top of the map stays. Rename it instead.");
    const drop = new Set<string>();
    const pile = [id];
    while (pile.length) {
      const cur = pile.pop()!;
      drop.add(cur);
      for (const r of rows) if (r.parent_id === cur) pile.push(r.id);
    }
    for (const dropId of drop) {
      await sql`delete from canopy_nodes where id = ${dropId} and user_id = ${context.userId}`;
    }
    return snapshot(context.userId);
  });

export const importYaml = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((input: { mapId: string; yaml: string }) => input)
  .handler(async ({ context, data }) => {
    await ownedMap(context.userId, data.mapId);
    const parsed = parseMapYaml(data.yaml);
    const snap = await snapshot(context.userId);
    const sql = await db();
    const existing = snap.nodes.filter((n) => n.mapId === data.mapId);
    const byId = new Map(existing.map((n) => [n.id, n]));
    let room = snap.nodeCap - existing.length;
    for (const n of parsed.nodes) {
      const repo = n.repo ? cleanRepo(n.repo) : "";
      const found = byId.get(n.id);
      if (found) {
        await sql`
          update canopy_nodes
          set name = ${n.name}, level = ${n.level}, parent_id = ${n.parentId}, repo = ${repo},
              maturity = ${n.maturity}, gaps = ${JSON.stringify(n.gaps)}
          where id = ${n.id} and user_id = ${context.userId} and map_id = ${data.mapId}
        `;
        continue;
      }
      if (room <= 0) throw new Error(`Stopped at the ${snap.nodeCap} node limit. The rest of the file was not added.`);
      await sql`
        insert into canopy_nodes (id, user_id, map_id, parent_id, name, level, repo, maturity, gaps)
        values (${n.id}, ${context.userId}, ${data.mapId}, ${n.parentId}, ${n.name}, ${n.level}, ${repo}, ${n.maturity}, ${JSON.stringify(n.gaps)})
      `;
      room -= 1;
    }
    if (parsed.mapName) {
      await sql`update canopy_maps set name = ${parsed.mapName.slice(0, 80)} where id = ${data.mapId} and user_id = ${context.userId}`;
    }
    return snapshot(context.userId);
  });

export const scanNode = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .validator((id: string) => id)
  .handler(async ({ context, data: id }) => {
    const snap = await snapshot(context.userId);
    if (!snap.scanEnabled) throw new Error("Live GitHub checks are part of Pro. Your written gaps stay on the free plan.");
    const sql = await db();
    const rows = await sql<{ repo: string }>`select repo from canopy_nodes where id = ${id} and user_id = ${context.userId}`;
    if (!rows.length) throw new Error("Node not found.");
    const repo = rows[0].repo;
    if (!repo) throw new Error("Add a GitHub owner/name before a live check.");
    const flags = await githubFlags(repo);
    await sql`update canopy_nodes set scan_flags = ${JSON.stringify(flags)} where id = ${id} and user_id = ${context.userId}`;
    return snapshot(context.userId);
  });

async function githubFlags(repo: string): Promise<string[]> {
  const res = await fetch(`https://api.github.com/repos/${repo}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "canopy-map" },
  });
  if (res.status === 404) return ["repo not found on GitHub"];
  if (!res.ok) return [`GitHub answered ${res.status}`];
  const meta = (await res.json()) as { pushed_at?: string; open_issues_count?: number };
  const flags: string[] = [];
  if (meta.pushed_at) {
    const days = (Date.now() - new Date(meta.pushed_at).getTime()) / 86400000;
    if (days > 30) flags.push(`no push in ${Math.round(days)} days`);
  } else flags.push("no push date");
  const open = meta.open_issues_count ?? 0;
  if (open) flags.push(`${open} open on GitHub`);
  if (!flags.length) flags.push("quiet on GitHub");
  return flags;
}

export const requestPro = createServerFn({ method: "POST" })
  .middleware([authMiddleware])
  .handler(async ({ context }) => {
    const sql = await db();
    await sql`update canopy_plans set pro_interest = true where user_id = ${context.userId}`;
    return snapshot(context.userId);
  });
