import type { Agent, Building, Station, Task } from "@district/shared";
import { ConnectPanel } from "./ConnectPanel";

export function SidePanel(props: {
  tab: "agents" | "stations" | "tasks" | "connect";
  onTab: (t: "agents" | "stations" | "tasks" | "connect") => void;
  agents: Agent[];
  stations: Station[];
  buildings: Building[];
  tasks: Task[];
  selectedId?: string | null;
  onSelectAgent: (id: string) => void;
  onSelectStation?: (id: string) => void;
  onSelectBuilding?: (id: string) => void;
}) {
  const visitors = props.agents.filter((a) => a.sprite === "visitor");
  return (
    <aside className="side">
      <div className="tabs">
        {(["agents", "stations", "tasks", "connect"] as const).map((t) => (
          <button key={t} className={props.tab === t ? "on" : ""} onClick={() => props.onTab(t)}>
            {t}
          </button>
        ))}
      </div>
      <div className="list">
        {props.tab === "agents" && (
          <>
            {visitors.length > 0 && (
              <div className="meta" style={{ padding: "8px 6px 2px" }}>
                plaza · {visitors.length} visitor{visitors.length === 1 ? "" : "s"}
              </div>
            )}
            {visitors.map((a) => (
              <div key={a.id} className="row" onClick={() => props.onSelectAgent(a.id)}>
                <span className="dot" style={{ background: a.color }} />
                <div>
                  {a.name}
                  <div className="meta">Human · {a.state}</div>
                </div>
              </div>
            ))}
          </>
        )}
        {props.tab === "agents" &&
          (props.agents.filter((a) => a.sprite !== "visitor").length ? (
            props.agents
              .filter((a) => a.sprite !== "visitor")
              .map((a) => (
              <div
                key={a.id}
                className={`row ${props.selectedId === a.id ? "on" : ""}`}
                onClick={() => props.onSelectAgent(a.id)}
              >
                <span className="dot" style={{ background: a.color }} />
                <div>
                  {a.simulated ? <span className="badge">SIM</span> : null}
                  {a.name}
                  <div className="meta">
                    {a.role} · {a.state}
                    {a.currentTool ? ` · ${a.currentTool}` : ""}
                  </div>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">Nobody on campus. Either they despawned or you turned the simulator off for the quiet.</div>
          ))}
        {props.tab === "stations" &&
          props.buildings.map((b) => {
            const sts = props.stations.filter((s) => s.buildingId === b.id);
            if (!sts.length) return null;
            return (
              <div key={b.id}>
                <div
                className="meta"
                style={{ padding: "8px 6px 2px", cursor: "pointer" }}
                onClick={() => props.onSelectBuilding?.(b.id)}
              >
                  {b.name}
                </div>
                {sts.map((s) => (
                  <div key={s.id} className="row" onClick={() => props.onSelectStation?.(s.id)}>
                    <div>
                      {s.name}
                      <div className="meta">
                        {s.kind}
                        {s.mcpServerName ? ` · ${s.mcpServerName}` : ""}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })}
        {props.tab === "tasks" &&
          (props.tasks.length ? (
            props.tasks.map((t) => (
              <div key={t.id} className="row">
                <div>
                  {t.title}
                  <div className="meta">{t.status}</div>
                </div>
              </div>
            ))
          ) : (
            <div className="empty">No tasks. The desks are clear. That never lasts.</div>
          ))}
        {props.tab === "connect" && <ConnectPanel />}
      </div>
    </aside>
  );
}
