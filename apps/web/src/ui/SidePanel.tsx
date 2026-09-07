import type { Agent, Building, Mission, Station, Task, WorldEvent } from "@district/shared";
import { ConnectPanel } from "./ConnectPanel";
import { HelpBoard } from "./HelpBoard";
import { MissionPanel } from "./MissionPanel";
import { NetworkPanel } from "./NetworkPanel";

export type SideTab = "network" | "missions" | "help" | "agents" | "stations" | "tasks" | "connect";

export function SidePanel(props: {
  tab: SideTab;
  onTab: (t: SideTab) => void;
  agents: Agent[];
  stations: Station[];
  buildings: Building[];
  tasks: Task[];
  missions: Mission[];
  events: WorldEvent[];
  visitorId?: string;
  selectedMissionId?: string | null;
  onSelectMission: (id: string | null) => void;
  selectedId?: string | null;
  onSelectAgent: (id: string) => void;
  onSelectStation?: (id: string) => void;
  onSelectBuilding?: (id: string) => void;
}) {
  const visitors = props.agents.filter((a) => a.sprite === "visitor");
  return (
    <aside className="side">
      <div className="tabs" role="tablist" aria-label="District panels">
        {(["network", "missions", "help", "agents", "stations", "tasks", "connect"] as const).map((t) => (
          <button
            type="button"
            key={t}
            className={props.tab === t ? "on" : ""}
            aria-selected={props.tab === t}
            role="tab"
            onClick={() => props.onTab(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <div className="list">
        {props.tab === "network" && <NetworkPanel visitorId={props.visitorId} />}
        {props.tab === "missions" && (
          <MissionPanel
            missions={props.missions}
            tasks={props.tasks}
            events={props.events}
            agents={props.agents}
            visitorId={props.visitorId}
            selectedId={props.selectedMissionId}
            onSelect={props.onSelectMission}
          />
        )}
        {props.tab === "help" && (
          <HelpBoard
            missions={props.missions}
            tasks={props.tasks}
            agents={props.agents}
            visitorId={props.visitorId}
            onOpenMission={(id) => {
              props.onTab("missions");
              props.onSelectMission(id);
            }}
          />
        )}
        {props.tab === "agents" && (
          <>
            {visitors.length > 0 && (
              <div className="meta" style={{ padding: "8px 6px 2px" }}>
                plaza · {visitors.length} visitor{visitors.length === 1 ? "" : "s"}
              </div>
            )}
            {visitors.map((a) => (
              <button type="button" key={a.id} className="row" onClick={() => props.onSelectAgent(a.id)}>
                <span className="dot" style={{ background: a.color }} />
                <div>
                  {a.name}
                  <div className="meta">Human · {a.state}</div>
                </div>
              </button>
            ))}
          </>
        )}
        {props.tab === "agents" &&
          (props.agents.filter((a) => a.sprite !== "visitor").length ? (
            props.agents
              .filter((a) => a.sprite !== "visitor")
              .map((a) => (
              <button
                type="button"
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
              </button>
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
                <button
                type="button"
                className="meta"
                style={{ padding: "8px 6px 2px", cursor: "pointer" }}
                onClick={() => props.onSelectBuilding?.(b.id)}
              >
                  {b.name}
                </button>
                {sts.map((s) => (
                  <button type="button" key={s.id} className="row" onClick={() => props.onSelectStation?.(s.id)}>
                    <div>
                      {s.name}
                      <div className="meta">
                        {s.kind}
                        {s.mcpServerName ? ` · ${s.mcpServerName}` : ""}
                      </div>
                    </div>
                  </button>
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
