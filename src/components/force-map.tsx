import { useEffect, useRef, useState } from "react";
import * as d3 from "d3";
import { MATURITY_COLOR, type CanopyNode, type Level } from "@/lib/canopy";

const RADIUS: Record<Level, number> = {
  workspace: 26,
  area: 20,
  project: 16,
  repo: 12,
};

type SimNode = CanopyNode & d3.SimulationNodeDatum & { radius: number };
type SimLink = d3.SimulationLinkDatum<SimNode>;

function oneHop(nodes: CanopyNode[], id: string): CanopyNode[] {
  const node = nodes.find((n) => n.id === id);
  if (!node) return nodes;
  const ids = new Set<string>([id]);
  if (node.parentId) ids.add(node.parentId);
  for (const n of nodes) if (n.parentId === id) ids.add(n.id);
  return nodes.filter((n) => ids.has(n.id));
}

export function ForceMap({
  nodes,
  selectedId,
  onSelect,
}: {
  nodes: CanopyNode[];
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const [focusId, setFocusId] = useState<string | null>(null);

  useEffect(() => {
    const el = host.current;
    if (!el) return;
    const visible = focusId ? oneHop(nodes, focusId) : nodes;
    const width = el.clientWidth || 800;
    const height = 560;
    const simNodes: SimNode[] = visible.map((n) => ({ ...n, radius: RADIUS[n.level] }));
    const ids = new Set(simNodes.map((n) => n.id));
    const links: SimLink[] = simNodes
      .filter((n) => n.parentId && ids.has(n.parentId))
      .map((n) => ({ source: n.parentId as string, target: n.id }));

    const svg = d3.select(el).select<SVGSVGElement>("svg");
    svg.attr("viewBox", `0 0 ${width} ${height}`);
    const g = svg.select<SVGGElement>("g.force-root");
    g.selectAll("*").remove();

    const sim = d3
      .forceSimulation(simNodes)
      .force("link", d3.forceLink<SimNode, SimLink>(links).id((d) => d.id).distance(88).strength(0.55))
      .force("charge", d3.forceManyBody().strength(-280))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force("collide", d3.forceCollide<SimNode>().radius((d) => d.radius + 16));

    svg.call(
      d3.zoom<SVGSVGElement, unknown>().scaleExtent([0.3, 3]).on("zoom", (event) => {
        g.attr("transform", event.transform);
      }),
    );

    const link = g
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#3d4a34")
      .attr("stroke-width", 1.6);

    const node = g
      .append("g")
      .selectAll("g")
      .data(simNodes)
      .join("g")
      .style("cursor", "pointer")
      .on("click", (event, d) => {
        event.stopPropagation();
        onSelect(d.id);
      })
      .on("dblclick", (event, d) => {
        event.stopPropagation();
        event.preventDefault();
        setFocusId(d.id);
      })
      .call(
        d3
          .drag<SVGGElement, SimNode>()
          .on("start", (event, d) => {
            if (!event.active) sim.alphaTarget(0.3).restart();
            d.fx = d.x;
            d.fy = d.y;
          })
          .on("drag", (event, d) => {
            d.fx = event.x;
            d.fy = event.y;
          })
          .on("end", (event, d) => {
            if (!event.active) sim.alphaTarget(0);
            d.fx = null;
            d.fy = null;
          }),
      );

    node.each(function (d) {
      const group = d3.select(this);
      const on = d.id === selectedId;
      group
        .append("circle")
        .attr("r", d.radius + 4)
        .attr("fill", "none")
        .attr("stroke", on ? "#d6e36a" : "#2c3826")
        .attr("stroke-width", on ? 2 : 1);
      group.append("circle").attr("r", d.radius).attr("fill", MATURITY_COLOR[d.maturity]);
      if (d.gaps.length > 0) {
        const label = `${d.gaps.length} gap${d.gaps.length === 1 ? "" : "s"}`;
        group
          .append("text")
          .text(label)
          .attr("y", -(d.radius + 8))
          .attr("text-anchor", "middle")
          .attr("fill", "#e39a4a")
          .attr("font-size", 11)
          .attr("font-family", "Outfit, sans-serif")
          .attr("pointer-events", "none");
      }
      const name = d.name.length > 28 ? d.name.slice(0, 26) + "…" : d.name;
      group
        .append("text")
        .text(name)
        .attr("y", d.radius + 16)
        .attr("text-anchor", "middle")
        .attr("fill", "#f4f1e6")
        .attr("font-size", 13)
        .attr("font-family", "Fraunces, serif")
        .attr("pointer-events", "none");
    });

    sim.on("tick", () => {
      link
        .attr("x1", (d) => (d.source as SimNode).x ?? 0)
        .attr("y1", (d) => (d.source as SimNode).y ?? 0)
        .attr("x2", (d) => (d.target as SimNode).x ?? 0)
        .attr("y2", (d) => (d.target as SimNode).y ?? 0);
      node.attr("transform", (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      sim.stop();
    };
  }, [nodes, selectedId, focusId, onSelect]);

  return (
    <div ref={host} className="relative h-[560px] overflow-hidden rounded-xl border border-line bg-[#10150e]">
      <svg
        className="block h-full w-full"
        role="img"
        aria-label="Your project map"
        onDoubleClick={() => setFocusId(null)}
      >
        <g className="force-root" />
      </svg>
    </div>
  );
}
