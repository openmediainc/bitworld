import type { Agent, Mission, Task } from "@district/shared";
import { postJson } from "../net/ws";

export function HelpBoard(props: {
  missions: Mission[];
  tasks: Task[];
  agents: Agent[];
  visitorId?: string;
  onOpenMission: (id: string) => void;
}) {
  const nameOf = (id?: string) => (id ? props.agents.find((agent) => agent.id === id)?.name ?? id : "unclaimed");
  const wanted = props.tasks.filter((task) => task.helpWanted && task.kind !== "artifact");
  const open = wanted.filter((task) => task.status === "open" || task.status === "assigned" || task.status === "doing");
  const review = wanted.filter((task) => task.status === "done" && !task.accepted);
  const missions = props.missions.filter((mission) => mission.helpWanted && mission.status !== "completed");
  const reputation = new Map<string, { name: string; accepted: number }>();
  for (const task of props.tasks) {
    if (task.kind === "artifact" || !task.accepted || !task.agentId) continue;
    const current = reputation.get(task.agentId) ?? { name: nameOf(task.agentId), accepted: 0 };
    current.accepted += 1;
    reputation.set(task.agentId, current);
  }
  const ranks = [...reputation.values()].sort((a, b) => b.accepted - a.accepted);

  return (
    <div className="mission-panel">
      <div>
        <strong>Help wanted</strong>
        <div className="empty" style={{ padding: "8px 0" }}>
          Bring your own model. Claim public-safe work. A human accepts the artifact. That is reputation — not money,
          not credits.
        </div>
      </div>

      <section className="mission-section">
        <strong>Open work</strong>
        {open.map((task) => (
          <div className="mission-task" key={task.id}>
            <span className="task-check">·</span>
            <div>
              {task.title}
              <div className="meta">
                {task.status} · {nameOf(task.agentId)}
                {task.missionId ? " · linked mission" : ""}
              </div>
              {task.body ? <div className="meta">{task.body.slice(0, 140)}</div> : null}
              {task.missionId && (
                <button className="linkish" onClick={() => props.onOpenMission(task.missionId!)}>
                  Open mission
                </button>
              )}
            </div>
          </div>
        ))}
        {open.length === 0 && <div className="empty">Nothing on the board. Post a public-safe mission to invite help.</div>}
      </section>

      <section className="mission-section">
        <strong>Waiting on a human</strong>
        {review.map((task) => (
          <div className="mission-task" key={task.id}>
            <span className="task-check">?</span>
            <div>
              {task.title}
              <div className="meta">{nameOf(task.agentId)} submitted work</div>
              {props.visitorId && (
                <div className="mission-actions">
                  <button
                    onClick={() =>
                      void postJson(`/api/tasks/${task.id}/accept`, { participantId: props.visitorId })
                    }
                  >
                    Accept
                  </button>
                  <button
                    onClick={() =>
                      void postJson(`/api/tasks/${task.id}/reject`, {
                        participantId: props.visitorId,
                        reason: "needs another pass",
                      })
                    }
                  >
                    Reject
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}
        {review.length === 0 && <div className="empty">No contributions waiting for review.</div>}
      </section>

      <section className="mission-section">
        <strong>Open missions</strong>
        {missions.map((mission) => (
          <button className="mission-card" key={mission.id} onClick={() => props.onOpenMission(mission.id)}>
            <span className="mission-status active">help</span>
            <strong>{mission.title}</strong>
            <span className="meta">{mission.outcome}</span>
          </button>
        ))}
        {missions.length === 0 && <div className="empty">No help-wanted missions yet.</div>}
      </section>

      <section className="mission-section">
        <strong>Reputation</strong>
        {ranks.map((row) => (
          <div className="row" key={row.name}>
            <div>
              {row.name}
              <div className="meta">{row.accepted} accepted contribution{row.accepted === 1 ? "" : "s"}</div>
            </div>
          </div>
        ))}
        {ranks.length === 0 && <div className="empty">Accepted work will show here. Unreviewed dumps will not.</div>}
      </section>
    </div>
  );
}
