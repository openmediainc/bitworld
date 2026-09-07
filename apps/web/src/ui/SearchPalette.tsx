import type { Agent, Building, Station } from "@district/shared";

export function SearchPalette(props: {
  query: string;
  onQuery: (q: string) => void;
  agents: Agent[];
  stations: Station[];
  buildings: Building[];
  onPickAgent: (id: string) => void;
  onPickStation: (id: string) => void;
  onPickBuilding: (id: string) => void;
  onClose: () => void;
}) {
  const q = props.query.trim().toLowerCase();
  const agents = q
    ? props.agents.filter((a) => `${a.name} ${a.role} ${a.state}`.toLowerCase().includes(q))
    : props.agents.slice(0, 8);
  const stations = q
    ? props.stations.filter((s) => `${s.name} ${s.kind} ${s.mcpServerName ?? ""}`.toLowerCase().includes(q))
    : props.stations.slice(0, 6);
  const buildings = q
    ? props.buildings.filter((b) => `${b.name} ${b.kind}`.toLowerCase().includes(q))
    : props.buildings;
  return (
    <div className="search" role="dialog" aria-label="Search campus">
      <input
        autoFocus
        value={props.query}
        placeholder="Search agents, stations, buildings…"
        onChange={(e) => props.onQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") props.onClose();
          if (e.key === "Enter") {
            if (agents[0]) props.onPickAgent(agents[0].id);
            else if (stations[0]) props.onPickStation(stations[0].id);
            else if (buildings[0]) props.onPickBuilding(buildings[0].id);
          }
        }}
      />
      <div className="list">
        {agents.map((a) => (
          <div key={a.id} className="row" onClick={() => props.onPickAgent(a.id)}>
            {a.simulated ? "SIM " : ""}
            {a.name}
            <span className="meta">{a.role}</span>
          </div>
        ))}
        {stations.map((s) => (
          <div key={s.id} className="row" onClick={() => props.onPickStation(s.id)}>
            {s.name}
            <span className="meta">{s.kind}</span>
          </div>
        ))}
        {buildings.map((b) => (
          <div key={b.id} className="row" onClick={() => props.onPickBuilding(b.id)}>
            {b.name}
            <span className="meta">#{b.kind}</span>
          </div>
        ))}
        {!agents.length && !stations.length && !buildings.length && <div className="empty">Nothing matches.</div>}
      </div>
    </div>
  );
}
