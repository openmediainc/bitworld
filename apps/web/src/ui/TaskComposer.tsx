import { useState } from "react";
import type { Agent } from "@district/shared";
import { postJson } from "../net/ws";

export function TaskComposer(props: { agents: Agent[]; presetAgentId?: string; onClose: () => void }) {
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [agentId, setAgentId] = useState(props.presetAgentId ?? "");
  return (
    <form
      className="composer"
      onSubmit={(e) => {
        e.preventDefault();
        void postJson("/api/tasks", { title, body, agentId: agentId || undefined });
        props.onClose();
      }}
    >
      <strong>Drop a task</strong>
      <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="title" required />
      <textarea value={body} onChange={(e) => setBody(e.target.value)} placeholder="what should happen" />
      <select value={agentId} onChange={(e) => setAgentId(e.target.value)}>
        <option value="">unassigned — whoever claims it</option>
        {props.agents
          .filter((a) => a.sprite !== "visitor")
          .map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
      </select>
      <div style={{ display: "flex", gap: 6, marginTop: 8 }}>
        <button type="submit">Submit</button>
        <button type="button" onClick={props.onClose}>
          cancel
        </button>
      </div>
    </form>
  );
}
