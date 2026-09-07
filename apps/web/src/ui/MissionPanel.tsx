import { useMemo, useState } from "react";
import type { Agent, Mission, MissionStatus, Task, WorldEvent } from "@district/shared";
import { postJson } from "../net/ws";

export function MissionPanel(props: {
  missions: Mission[];
  tasks: Task[];
  events: WorldEvent[];
  agents: Agent[];
  visitorId?: string;
  selectedId?: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [creating, setCreating] = useState(false);
  const [addingTask, setAddingTask] = useState(false);
  const mission = props.missions.find((item) => item.id === props.selectedId) ?? null;
  const missionItems = mission ? props.tasks.filter((task) => task.missionId === mission.id) : [];
  const tasks = missionItems.filter((task) => task.kind !== "artifact");
  const artifacts = missionItems.filter((task) => task.kind === "artifact");
  const events = useMemo(
    () =>
      mission
        ? props.events
            .filter(
              (event) =>
                event.data?.missionId === mission.id ||
                (Boolean(event.agentId) &&
                  mission.participantIds.includes(event.agentId!) &&
                  event.at >= mission.createdAt),
            )
            .slice(-20)
        : [],
    [mission, props.events],
  );

  if (!mission) {
    return (
      <div className="mission-panel">
        <div className="mission-heading">
          <div>
            <strong>Live Missions</strong>
            <div className="meta">Real people and agents, one visible outcome.</div>
          </div>
          <button onClick={() => setCreating(true)}>New</button>
        </div>
        {creating && (
          <MissionForm
            visitorId={props.visitorId}
            onCreated={(created) => {
              setCreating(false);
              props.onSelect(created.id);
            }}
            onCancel={() => setCreating(false)}
          />
        )}
        {props.missions.length === 0 && !creating && (
          <div className="empty">No mission is active. Start with an outcome the whole squad can recognize.</div>
        )}
        {props.missions
          .slice()
          .sort((a, b) => b.createdAt - a.createdAt)
          .map((item) => {
            const itemTasks = props.tasks.filter(
              (task) => task.missionId === item.id && task.kind !== "artifact",
            );
            const done = itemTasks.filter((task) => task.status === "done").length;
            return (
              <button className="mission-card" key={item.id} onClick={() => props.onSelect(item.id)}>
                <span className={`mission-status ${item.helpWanted ? "active" : item.status}`}>
                  {item.helpWanted ? "help" : item.status}
                </span>
                <strong>{item.title}</strong>
                <span className="meta">
                  {done}/{itemTasks.length} tasks · {item.participantIds.length} squad
                </span>
              </button>
            );
          })}
      </div>
    );
  }

  const joined = Boolean(props.visitorId && mission.participantIds.includes(props.visitorId));
  const done = tasks.filter((task) => task.status === "done").length;
  const participantName = (id: string, recorded?: string) =>
    props.agents.find((agent) => agent.id === id)?.name ?? recorded ?? id;
  const setStatus = (status: MissionStatus) =>
    void postJson(`/api/missions/${mission.id}/status`, { status });

  return (
    <div className="mission-panel">
      <div className="mission-heading">
        <button onClick={() => props.onSelect(null)}>← All</button>
        <button
          onClick={() => void navigator.clipboard.writeText(`${location.origin}${location.pathname}#mission-${mission.id}`)}
        >
          Copy link
        </button>
      </div>
      <span className={`mission-status ${mission.status}`}>{mission.status}</span>
      {mission.helpWanted && <span className="mission-status active">open to outside agents</span>}
      <h3>{mission.title}</h3>
      <p className="mission-outcome">{mission.outcome}</p>
      <div className="mission-progress">
        <span style={{ width: `${tasks.length ? (done / tasks.length) * 100 : 0}%` }} />
      </div>
      <div className="meta">
        {done}/{tasks.length} tasks complete · {mission.participantIds.length} squad members
      </div>

      {!joined && props.visitorId && (
        <button
          className="mission-primary"
          onClick={() => void postJson(`/api/missions/${mission.id}/join`, { participantId: props.visitorId })}
        >
          Join this mission
        </button>
      )}

      <section className="mission-section">
        <div className="mission-heading">
          <strong>Squad</strong>
        </div>
        <div className="mission-squad">
          {mission.participantIds.map((id) => (
            <span key={id}>{participantName(id)}</span>
          ))}
          {mission.participantIds.length === 0 && <span className="meta">Nobody has joined yet.</span>}
        </div>
      </section>

      {artifacts.length > 0 && (
        <section className="mission-section">
          <strong>Delivered artifacts</strong>
          {artifacts.map((artifact) => (
            <details className="mission-artifact" key={artifact.id}>
              <summary>{artifact.title}</summary>
              <p>{artifact.body}</p>
            </details>
          ))}
        </section>
      )}

      <section className="mission-section">
        <div className="mission-heading">
          <strong>Quest log</strong>
          <button onClick={() => setAddingTask(true)}>Add task</button>
        </div>
        {addingTask && (
          <MissionTaskForm
            missionId={mission.id}
            helpWanted={Boolean(mission.helpWanted)}
            agents={props.agents}
            onDone={() => setAddingTask(false)}
          />
        )}
        {tasks.map((task) => (
          <div className="mission-task" key={task.id}>
            <span className={`task-check ${task.status === "done" ? "done" : ""}`}>
              {task.status === "done" ? "✓" : "·"}
            </span>
            <div>
              {task.title}
              <div className="meta">
                {task.helpWanted ? "help wanted · " : ""}
                {task.status}
                {task.accepted ? " · accepted" : task.status === "done" && task.helpWanted ? " · needs review" : ""}
                {task.agentId ? ` · ${participantName(task.agentId, task.agentName)}` : " · unassigned"}
              </div>
              {joined && task.helpWanted && task.status === "done" && !task.accepted && props.visitorId && (
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
        {tasks.length === 0 && !addingTask && <div className="empty">Break the outcome into tasks agents can claim.</div>}
      </section>

      <section className="mission-section">
        <strong>Mission timeline</strong>
        {events.map((event) => (
          <div className="mission-event" key={event.id}>
            <span>{new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            {event.text}
          </div>
        ))}
        {events.length === 0 && <div className="empty">Mission events will appear here live.</div>}
      </section>

      <div className="mission-actions">
        {mission.status !== "active" && <button onClick={() => setStatus("active")}>Activate</button>}
        {mission.status !== "blocked" && <button onClick={() => setStatus("blocked")}>Block</button>}
        {mission.status !== "completed" && <button onClick={() => setStatus("completed")}>Complete</button>}
      </div>
    </div>
  );
}

function MissionForm(props: {
  visitorId?: string;
  onCreated: (mission: Mission) => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState("");
  const [outcome, setOutcome] = useState("");
  const [helpWanted, setHelpWanted] = useState(false);
  return (
    <form
      className="mission-form"
      onSubmit={(event) => {
        event.preventDefault();
        void postJson("/api/missions", {
          title,
          outcome,
          participantId: props.visitorId,
          helpWanted,
        }).then((result) => props.onCreated(result as Mission));
      }}
    >
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Mission title" required />
      <textarea
        value={outcome}
        onChange={(event) => setOutcome(event.target.value)}
        placeholder="What observable outcome means this mission is done?"
        required
      />
      <label className="meta">
        <input type="checkbox" checked={helpWanted} onChange={(event) => setHelpWanted(event.target.checked)} /> Open
        to outside agents (public-safe only — no secrets)
      </label>
      <div>
        <button type="submit">Start mission</button>
        <button type="button" onClick={props.onCancel}>Cancel</button>
      </div>
    </form>
  );
}

function MissionTaskForm(props: {
  missionId: string;
  helpWanted?: boolean;
  agents: Agent[];
  onDone: () => void;
}) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [agentId, setAgentId] = useState("");
  const [helpWanted, setHelpWanted] = useState(Boolean(props.helpWanted));
  return (
    <form
      className="mission-form"
      onSubmit={(event) => {
        event.preventDefault();
        void postJson("/api/tasks", {
          title,
          body,
          missionId: props.missionId,
          agentId: agentId || undefined,
          helpWanted,
        }).then(props.onDone);
      }}
    >
      <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Task title" required />
      <textarea value={body} onChange={(event) => setBody(event.target.value)} placeholder="Context or acceptance notes" />
      <select value={agentId} onChange={(event) => setAgentId(event.target.value)}>
        <option value="">Open for any agent</option>
        {props.agents.filter((agent) => agent.sprite !== "visitor").map((agent) => (
          <option key={agent.id} value={agent.id}>{agent.name}</option>
        ))}
      </select>
      <label className="meta">
        <input type="checkbox" checked={helpWanted} onChange={(event) => setHelpWanted(event.target.checked)} /> Help
        wanted (outside agents may claim)
      </label>
      <div>
        <button type="submit">Add task</button>
        <button type="button" onClick={props.onDone}>Cancel</button>
      </div>
    </form>
  );
}
