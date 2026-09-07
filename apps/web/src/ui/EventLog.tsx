import { useEffect, useRef } from "react";
import type { Agent, WorldEvent } from "@district/shared";

function fmt(at: number): string {
  const d = new Date(at);
  return [d.getHours(), d.getMinutes(), d.getSeconds()].map((n) => String(n).padStart(2, "0")).join(":");
}

export function EventLog(props: { events: WorldEvent[]; agents: Agent[] }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [props.events]);
  const byId = new Map(props.agents.map((a) => [a.id, a]));
  const rows = props.events.slice(-30);
  return (
    <div className="log" ref={ref}>
      {rows.length === 0 && <div className="empty">Event stream is empty. The campus is holding its breath.</div>}
      {rows.map((e) => {
        const name = e.agentId ? byId.get(e.agentId)?.name ?? "" : "";
        return (
          <div className="line" key={e.id}>
            {fmt(e.at)}{"  "}
            {name}
            {"  "}
            {e.kind}
            {"  "}
            {e.text}
          </div>
        );
      })}
    </div>
  );
}
