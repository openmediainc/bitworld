import type { Agent, AvenuePlot, Building, BuildingStat, Station, WorldEvent } from "@district/shared";
import { postJson } from "../net/ws";
import { owns } from "../net/token";

export function Inspector(props: {
  agent?: Agent | null;
  station?: Station | null;
  building?: Building | null;
  plot?: AvenuePlot | null;
  stat?: BuildingStat | null;
  events: WorldEvent[];
  agents: Agent[];
  onAssign: () => void;
  onClose: () => void;
  onAsk?: (text: string) => void;
  onShout?: () => void;
  apiKeyRequired?: boolean;
  sharePath?: string;
}) {
  if (props.plot && !props.agent && !props.station && !props.building) {
    const p = props.plot;
    return (
      <div className="inspector" role="dialog" aria-label={p.orgName}>
        <strong>{p.orgName}</strong>
        <div className="meta">
          {p.address} · {p.kind}
        </div>
        <p className="empty">
          {p.kind === "empty"
            ? "Membership plot. Not for sale. No takeovers."
            : p.kind === "billboard"
              ? "BitGrid billboard. Paid pixels live here, not on HQ."
              : p.campusKind
                ? "Opens the Acme campus. Org plot is not rent."
                : "Public org plot. Assigned by membership, never by card."}
        </p>
        {p.href && (
          <button onClick={() => window.open(p.href, "_blank", "noopener")}>
            {p.kind === "billboard" ? "Open BitGrid" : "Visit"}
          </button>
        )}
        {p.campusKind && (
          <button
            onClick={() => {
              location.hash = "hq";
            }}
          >
            Enter campus
          </button>
        )}
        {props.sharePath && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(`${location.origin}${props.sharePath}`);
            }}
          >
            Copy address
          </button>
        )}
        <button onClick={props.onClose}>close</button>
      </div>
    );
  }
  if (props.building && !props.agent && !props.station) {
    const b = props.building;
    const here = props.agents.filter((a) => a.currentStationId && props.stat);
    const occupants = props.agents.filter((a) => {
      const r = b.rect;
      return a.tile.x >= r.x && a.tile.y >= r.y && a.tile.x < r.x + r.w && a.tile.y < r.y + r.h;
    });
    const evs = props.events.filter((e) => occupants.some((a) => a.id === e.agentId)).slice(-15);
    return (
      <div className="inspector" role="dialog" aria-label={b.name}>
        <strong>{b.name}</strong>
        <div className="meta">
          #{b.kind} · tile {b.door.x},{b.door.y}
        </div>
        <div className="stats" style={{ margin: "8px 0" }}>
          <span>{props.stat?.visits ?? 0} visits</span>
          <span>heat {props.stat?.heat ?? 0}</span>
        </div>
        <div className="meta">founded by {props.stat?.foundedByName ?? "nobody yet"}</div>
        <p className="empty">
          {occupants.length ? occupants.map((a) => a.name).join(", ") : "Nobody is in this building."}
        </p>
        <div className="list" style={{ maxHeight: 120 }}>
          {evs.map((e) => (
            <div key={e.id} className="line">
              {e.kind} {e.text}
            </div>
          ))}
        </div>
        {props.sharePath && (
          <button
            onClick={() => {
              void navigator.clipboard.writeText(`${location.origin}${props.sharePath}`);
            }}
          >
            Copy address
          </button>
        )}
        <button onClick={props.onClose}>close</button>
        {here.length ? null : null}
      </div>
    );
  }
  if (!props.agent && !props.station) return null;
  if (props.station && !props.agent) {
    const here = props.agents.filter((a) => a.currentStationId === props.station!.id);
    return (
      <div className="inspector" role="dialog" aria-label={props.station.name}>
        <strong>{props.station.name}</strong>
        <div className="meta">
          {props.station.kind}
          {props.station.mcpServerName ? ` · MCP ${props.station.mcpServerName}` : ""}
          {props.station.toolHint ? ` · ${props.station.toolHint}` : ""}
        </div>
        <p className="empty">
          {here.length
            ? here.map((a) => a.name).join(", ")
            : "Nobody is at this station. Either the stack is quiet or the stack is on fire."}
        </p>
        {props.station.kind === "cafe" && props.onShout && <button onClick={props.onShout}>Shout</button>}
        <button onClick={props.onClose}>close</button>
      </div>
    );
  }
  const a = props.agent!;
  const evs = props.events.filter((e) => e.agentId === a.id).slice(-15);
  return (
    <div className="inspector" role="dialog" aria-label={a.name}>
      <strong>
        {a.simulated ? "SIM " : ""}
        {a.name}
      </strong>
      <div className="meta">
        {a.role} · {a.state} · tile {a.tile.x},{a.tile.y}
        {a.currentTool ? ` · ${a.currentTool}` : ""}
      </div>
      <div className="list" style={{ maxHeight: 160 }}>
        {evs.map((e) => (
          <div key={e.id} className="line">
            {e.kind} {e.text}
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        <button onClick={props.onAssign}>Assign task</button>
        <button
          onClick={() => {
            // The visitor calls out. Putting words in someone else's agent is not ours to do.
            void postJson(`/api/visitor/say`, { text: `ping @${a.name}`.slice(0, 60) }).catch(
              () => undefined,
            );
          }}
        >
          Ping
        </button>
        {(a.simulated || owns(a.id)) && (
          <button
            onClick={() => {
              void postJson(`/api/agents/${a.id}/despawn`, {});
            }}
          >
            Despawn
          </button>
        )}
        <button onClick={props.onClose}>close</button>
      </div>
      {props.onAsk && (
        <form
          style={{ marginTop: 8 }}
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.target as HTMLFormElement).elements.namedItem("ask") as HTMLInputElement;
            if (input.value) props.onAsk!(input.value);
            input.value = "";
          }}
        >
          <input name="ask" placeholder="Ask…" style={{ width: "100%" }} aria-label="Ask this agent" />
        </form>
      )}
    </div>
  );
}
