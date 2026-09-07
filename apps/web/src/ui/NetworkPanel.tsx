import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  AgreementStatus,
  CollaborationWorkspace,
  Mission,
  WorkAgreement,
} from "@district/shared";
import {
  builderPost,
  builderSession,
  loadWorkspace,
  registerBuilder,
  restoreBuilder,
  rotateBuilderToken,
} from "../net/builder";

export function NetworkPanel(props: { visitorId?: string }) {
  const [workspace, setWorkspace] = useState<CollaborationWorkspace | null>(null);
  const [selectedId, setSelectedId] = useState<string>();
  const [error, setError] = useState("");
  const [invite, setInvite] = useState("");

  const refresh = useCallback(async () => {
    if (!builderSession()) return;
    try {
      const next = await loadWorkspace();
      setWorkspace(next);
      setSelectedId((current) => current ?? next.missions[0]?.id);
      setError("");
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => window.clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (!props.visitorId || !builderSession()) return;
    void builderPost("/api/builders/me/presence", { visitorId: props.visitorId })
      .then(refresh)
      .catch((value) => setError(value instanceof Error ? value.message : String(value)));
  }, [props.visitorId, refresh]);

  if (!builderSession()) {
    return (
      <BuilderRegistration
        onRegistered={() => void refresh()}
        error={error}
        onError={setError}
      />
    );
  }

  if (!workspace) return <div className="empty">{error || "Loading builder workspace…"}</div>;
  const mission = workspace.missions.find((item) => item.id === selectedId);

  const run = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
      setError("");
      await refresh();
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
    }
  };

  return (
    <div className="mission-panel">
      <div className="mission-heading">
        <div>
          <strong>{workspace.builder.displayName}</strong>
          <div className="meta">
            @{workspace.builder.handle} · {workspace.builder.agentIds.length} fleet agents
          </div>
        </div>
        <span className="badge">{workspace.notifications.filter((item) => !item.readAt).length} inbox</span>
      </div>
      {error ? <p className="error">{error}</p> : null}
      <details>
        <summary>Edit builder profile</summary>
        <form
          className="mission-form"
          onSubmit={(event) => {
            event.preventDefault();
            const data = new FormData(event.currentTarget);
            void run(() =>
              builderPost("/api/builders/me", {
                bio: data.get("bio"),
                skills: String(data.get("skills"))
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
                availability: data.get("availability"),
                collaborationTerms: data.get("terms"),
              }),
            );
          }}
        >
          <textarea name="bio" defaultValue={workspace.builder.bio} placeholder="What do you build?" />
          <input name="skills" defaultValue={workspace.builder.skills.join(", ")} placeholder="Skills" />
          <select name="availability" defaultValue={workspace.builder.availability ?? "available"}>
            <option value="available">Available</option>
            <option value="limited">Limited</option>
            <option value="unavailable">Unavailable</option>
          </select>
          <input name="terms" defaultValue={workspace.builder.collaborationTerms} placeholder="Collaboration terms" />
          <button type="submit">Save profile</button>
        </form>
      </details>

      <section className="mission-section">
        <strong>Inbox</strong>
        {workspace.notifications.filter((item) => !item.readAt).slice(0, 8).map((item) => (
          <button
            className="mission-task linkish"
            key={item.id}
            onClick={() =>
              void run(async () => {
                if (item.kind === "invite" && item.inviteId) {
                  await builderPost(`/api/invites/${item.inviteId}/accept`);
                }
                await builderPost(`/api/notifications/${item.id}/read`);
              })
            }
          >
            <span className="task-check">!</span>
            <span>
              {item.text}
              <span className="meta">
                {" · "}{item.kind === "invite" && item.inviteId ? "accept" : "mark read"}
              </span>
            </span>
          </button>
        ))}
        {!workspace.notifications.some((item) => !item.readAt) ? (
          <div className="empty">No unread handoffs or decisions.</div>
        ) : null}
      </section>

      <section className="mission-section">
        <strong>Open builder opportunities</strong>
        {workspace.opportunities.map((opportunity) => (
          <div className="mission-card" key={opportunity.id}>
            <strong>{opportunity.title}</strong>
            <div className="meta">
              {opportunity.consideration.kind === "external" ? "external settlement" : "volunteer"}
            </div>
            <ul>
              {opportunity.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
            </ul>
            <button
              onClick={() =>
                void run(() => builderPost(`/api/agreements/${opportunity.id}/claim`))
              }
            >
              Claim for your fleet
            </button>
          </div>
        ))}
        {!workspace.opportunities.length ? <div className="empty">No open agreements right now.</div> : null}
      </section>

      <section className="mission-section">
        <strong>Builder directory</strong>
        {workspace.directory.filter((item) => item.id !== workspace.builder.id).slice(0, 20).map((builder) => (
          <div className="mission-task" key={builder.id}>
            <span className="task-check">{builder.availability === "available" ? "●" : "○"}</span>
            <div>
              {builder.displayName} <span className="meta">@{builder.handle}</span>
              <div className="meta">
                {builder.skills.join(", ") || "No skills listed"} · {builder.availability ?? "available"}
              </div>
              {builder.collaborationTerms ? <div className="meta">{builder.collaborationTerms}</div> : null}
            </div>
            {mission?.ownerBuilderId === workspace.builder.id &&
            !mission.builderIds?.includes(builder.id) ? (
              <button
                onClick={() =>
                  void run(() =>
                    builderPost(`/api/missions/${mission.id}/invites`, {
                      expiresInHours: 72,
                      inviteeBuilderId: builder.id,
                    }),
                  )
                }
              >
                Invite
              </button>
            ) : null}
          </div>
        ))}
        {workspace.directory.length <= 1 ? <div className="empty">You are the first builder here.</div> : null}
      </section>

      <MissionCreate onRun={run} onCreated={(created) => setSelectedId(created.id)} />
      <form
        className="mission-form"
        onSubmit={(event) => {
          event.preventDefault();
          void run(() => builderPost("/api/invites/accept", { token: invite }));
          setInvite("");
        }}
      >
        <strong>Join a private mission</strong>
        <input
          value={invite}
          onChange={(event) => setInvite(event.target.value)}
          placeholder="Paste invite token"
          required
        />
        <button type="submit">Join</button>
      </form>

      <section className="mission-section">
        <strong>Your missions</strong>
        {workspace.missions.map((item) => (
          <button
            className={`mission-card linkish ${selectedId === item.id ? "on" : ""}`}
            key={item.id}
            onClick={() => setSelectedId(item.id)}
          >
            <span>{item.title}</span>
            <span className="meta">
              {item.visibility ?? "public"} · {item.status}
            </span>
          </button>
        ))}
      </section>

      {mission ? (
        <MissionWorkspace
          mission={mission}
          workspace={workspace}
          onRun={run}
        />
      ) : null}

      <section className="mission-section">
        <strong>Builder relationships</strong>
        {workspace.relationships.map((relationship) => (
          <div className="mission-task" key={relationship.builderId}>
            <span className="task-check">↔</span>
            <div>
              {relationship.displayName}
              <div className="meta">
                {relationship.sharedMissionIds.length} shared missions ·{" "}
                {relationship.approvedAgreements} approved agreements
              </div>
            </div>
            {mission?.ownerBuilderId === workspace.builder.id &&
            !mission.builderIds?.includes(relationship.builderId) ? (
              <button
                onClick={() =>
                  void run(() =>
                    builderPost(`/api/missions/${mission.id}/invites`, {
                      expiresInHours: 72,
                      inviteeBuilderId: relationship.builderId,
                    }),
                  )
                }
              >
                Invite again
              </button>
            ) : null}
          </div>
        ))}
        {!workspace.relationships.length ? (
          <div className="empty">Accept an invite and complete work together to build this graph.</div>
        ) : null}
      </section>

      <section className="mission-section">
        <strong>Agent connection</strong>
        <p className="meta">
          Create a 15-minute, single-use enrollment token and give only that token to an
          agent. The agent calls <code>join_builder_fleet</code>. Never give an agent your
          builder token.
        </p>
        <button
          onClick={() => {
            void builderPost<{ token: string; expiresAt: number }>(
              "/api/builders/me/fleet-enrollments",
              { expiresInMinutes: 15 },
            )
              .then((enrollment) =>
                navigator.clipboard.writeText(`FLEET_TOKEN=${enrollment.token}`),
              )
              .then(() => window.alert("Single-use fleet token copied. It expires in 15 minutes."))
              .catch((value) => setError(value instanceof Error ? value.message : String(value)));
          }}
        >
          Enroll an agent
        </button>
        <button
          onClick={() => {
            if (!window.confirm("Rotate the human builder token? Other signed-in browsers will stop working.")) return;
            void rotateBuilderToken()
              .then((token) =>
                navigator.clipboard.writeText(
                  `BUILDER_ID=${workspace.builder.id}\nBUILDER_TOKEN=${token}`,
                ),
              )
              .then(() => window.alert("New human identity credential copied. Keep it out of agent configuration."))
              .catch((value) => setError(value instanceof Error ? value.message : String(value)));
          }}
        >
          Rotate human credential
        </button>
      </section>
    </div>
  );
}

function BuilderRegistration(props: {
  onRegistered: () => void;
  error: string;
  onError: (message: string) => void;
}) {
  return (
    <form
      className="mission-form"
      onSubmit={(event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        void registerBuilder({
          handle: String(data.get("handle") ?? "").toLowerCase(),
          displayName: String(data.get("displayName") ?? ""),
          bio: String(data.get("bio") ?? "") || undefined,
          skills: String(data.get("skills") ?? "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
          availability: String(data.get("availability")) as "available" | "limited" | "unavailable",
          collaborationTerms: String(data.get("terms") ?? "") || undefined,
        })
          .then(props.onRegistered)
          .catch((value) =>
            props.onError(value instanceof Error ? value.message : String(value)),
          );
      }}
    >
      <strong>Establish your builder identity</strong>
      <p className="meta">
        This durable profile owns your fleet, private missions, relationships, and decisions.
      </p>
      {props.error ? <p className="error">{props.error}</p> : null}
      <input name="displayName" placeholder="Display name" required />
      <input name="handle" placeholder="handle" pattern="[a-z0-9][a-z0-9_-]{2,31}" required />
      <textarea name="bio" placeholder="What do you build?" />
      <input name="skills" placeholder="Skills, comma separated" />
      <select name="availability" defaultValue="available">
        <option value="available">Available to collaborate</option>
        <option value="limited">Limited availability</option>
        <option value="unavailable">Not currently available</option>
      </select>
      <input name="terms" placeholder="Volunteer, reciprocal, paid externally…" />
      <button type="submit">Create identity</button>
      <details>
        <summary>Restore an existing identity</summary>
        <div className="mission-form">
          <input name="restoreId" placeholder="builder_…" />
          <input name="restoreToken" type="password" placeholder="Builder token" />
          <button
            type="button"
            onClick={(event) => {
              const details = event.currentTarget.closest("details");
              const id = (details?.querySelector("[name=restoreId]") as HTMLInputElement | null)?.value;
              const token = (details?.querySelector("[name=restoreToken]") as HTMLInputElement | null)?.value;
              if (!id || !token) return;
              void restoreBuilder(id, token)
                .then(props.onRegistered)
                .catch((value) =>
                  props.onError(value instanceof Error ? value.message : String(value)),
                );
            }}
          >
            Restore
          </button>
        </div>
      </details>
    </form>
  );
}

function MissionCreate(props: {
  onRun: (operation: () => Promise<unknown>) => Promise<void>;
  onCreated: (mission: Mission) => void;
}) {
  const [visibility, setVisibility] = useState<"private" | "public">("private");
  return (
    <form
      className="mission-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        void props.onRun(async () => {
          const mission = await builderPost<Mission>("/api/collaboration/missions", {
            title: String(data.get("title")),
            outcome: String(data.get("outcome")),
            visibility: data.get("visibility"),
            helpWanted: data.get("helpWanted") === "on",
          });
          props.onCreated(mission);
          form.reset();
        });
      }}
    >
      <strong>Start real work</strong>
      <input name="title" placeholder="Mission title" required />
      <textarea name="outcome" placeholder="Measurable outcome" required />
      <select
        name="visibility"
        value={visibility}
        onChange={(event) => setVisibility(event.target.value as "private" | "public")}
      >
        <option value="private">Private — invite only</option>
        <option value="public">Public</option>
      </select>
      {visibility === "public" ? (
        <label className="meta">
          <input type="checkbox" name="helpWanted" /> public volunteer help wanted
        </label>
      ) : null}
      <button type="submit">Create mission</button>
    </form>
  );
}

function MissionWorkspace(props: {
  mission: Mission;
  workspace: CollaborationWorkspace;
  onRun: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const { mission, workspace } = props;
  const owner = mission.ownerBuilderId === workspace.builder.id;
  const resources = workspace.resources.filter((item) => item.missionId === mission.id);
  const grants = workspace.grants.filter((item) => item.missionId === mission.id);
  const agreements = workspace.agreements.filter((item) => item.missionId === mission.id);
  const tasks = workspace.tasks.filter(
    (item) => item.missionId === mission.id && item.kind !== "artifact",
  );
  const members = workspace.builders.filter((item) => mission.builderIds?.includes(item.id));

  return (
    <>
      <section className="mission-section">
        <strong>{mission.title}</strong>
        <p>{mission.outcome}</p>
        <div className="meta">
          {members.map((item) => item.displayName).join(" · ")} · {mission.visibility}
        </div>
        {owner ? (
          <div className="mission-actions">
            {(["active", "blocked", "completed"] as const).map((status) => (
              <button
                key={status}
                disabled={mission.status === status}
                onClick={() =>
                  void props.onRun(() =>
                    builderPost(`/api/missions/${mission.id}/status`, { status }),
                  )
                }
              >
                {status}
              </button>
            ))}
          </div>
        ) : null}
        {owner ? (
          <button
            onClick={() =>
              void props.onRun(async () => {
                const result = await builderPost<{ token: string }>(
                  `/api/missions/${mission.id}/invites`,
                  { expiresInHours: 72 },
                );
                await navigator.clipboard.writeText(result.token);
                window.alert("Invite token copied. It expires in 72 hours.");
              })
            }
          >
            Copy private invite
          </button>
        ) : null}
      </section>

      <form
        className="mission-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void props.onRun(() =>
            builderPost("/api/tasks", {
              title: data.get("title"),
              body: data.get("body"),
              missionId: mission.id,
            }),
          ).then(() => form.reset());
        }}
      >
        <strong>Task</strong>
        <input name="title" placeholder="Task title" required />
        <textarea name="body" placeholder="Context and constraints" />
        <button type="submit">Add task</button>
      </form>
      {tasks.map((task) => (
        <div className="mission-task" key={task.id}>
          <span className="task-check">{task.status === "done" ? "✓" : "·"}</span>
          <div>
            {task.title}
            <div className="meta">
              {task.status} {task.agreementId ? "· agreement attached" : ""}
            </div>
          </div>
        </div>
      ))}

      <form
        className="mission-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = event.currentTarget;
          const data = new FormData(form);
          void props.onRun(() =>
            builderPost(`/api/missions/${mission.id}/resources`, {
              kind: data.get("kind"),
              label: data.get("label"),
              url: data.get("url"),
              providerInstallationId: data.get("installationId")
                ? Number(data.get("installationId"))
                : undefined,
            }),
          ).then(() => form.reset());
        }}
      >
        <strong>Work resource</strong>
        <select name="kind">
          <option value="github_repo">GitHub repository</option>
          <option value="github_issue">GitHub issue</option>
          <option value="document">Document</option>
          <option value="tracker">Tracker</option>
          <option value="custom">Other link</option>
        </select>
        <input name="label" placeholder="Label" required />
        <input name="url" type="url" placeholder="https://…" required />
        <input name="installationId" type="number" min="1" placeholder="GitHub App installation id (optional)" />
        <button type="submit">Link metadata</button>
      </form>
      {resources.map((resource) => (
        <div className="mission-task" key={resource.id}>
          <span className="task-check">↗</span>
          <div>
            <a href={resource.url} target="_blank" rel="noreferrer">
              {resource.label}
            </a>
            <div className="meta">{resource.kind} · credentials stay with provider</div>
          </div>
        </div>
      ))}

      {owner && resources.length && members.length > 1 ? (
        <form
          className="mission-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            void props.onRun(() =>
              builderPost(`/api/missions/${mission.id}/grants`, {
                resourceId: data.get("resourceId"),
                granteeBuilderId: data.get("builderId"),
                actions: String(data.get("actions"))
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              }),
            ).then(() => form.reset());
          }}
        >
          <strong>Scoped capability</strong>
          <select name="resourceId">{resources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          <select name="builderId">
            {members.filter((item) => item.id !== workspace.builder.id).map((item) => (
              <option key={item.id} value={item.id}>{item.displayName}</option>
            ))}
          </select>
          <input name="actions" placeholder="read, issues:write, pull_requests:write" required />
          <button type="submit">Grant</button>
        </form>
      ) : null}
      {grants.map((grant) => (
        <div className="mission-task" key={grant.id}>
          <span className="task-check">{grant.revokedAt ? "×" : "🔑"}</span>
          <div>
            {grant.actions.join(", ")}
            <div className="meta">{grant.revokedAt ? "revoked" : "active and revocable"}</div>
          </div>
          {owner && !grant.revokedAt ? (
            <button onClick={() => void props.onRun(() => builderPost(`/api/grants/${grant.id}/revoke`))}>
              Revoke
            </button>
          ) : null}
        </div>
      ))}

      {owner && members.length > 1 ? (
        <AgreementCreate
          mission={mission}
          members={members}
          requesterId={workspace.builder.id}
          tasks={tasks}
          onRun={props.onRun}
        />
      ) : null}
      {agreements.map((agreement) => (
        <AgreementCard
          key={agreement.id}
          agreement={agreement}
          builderId={workspace.builder.id}
          onRun={props.onRun}
        />
      ))}

      <section className="mission-section">
        <strong>Audit</strong>
        {workspace.audit.filter((item) => item.missionId === mission.id).slice(-12).reverse().map((item) => (
          <div className="mission-event" key={item.id}>
            {item.action}
            <span className="meta"> · {new Date(item.at).toLocaleString()}</span>
          </div>
        ))}
      </section>
    </>
  );
}

function AgreementCreate(props: {
  mission: Mission;
  members: CollaborationWorkspace["builders"];
  requesterId: string;
  tasks: CollaborationWorkspace["tasks"];
  onRun: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  return (
    <form
      className="mission-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
        const kind = String(data.get("consideration"));
        const openToBuilders = data.get("openToBuilders") === "on";
        void props.onRun(() =>
          builderPost("/api/agreements", {
            missionId: props.mission.id,
            taskId: data.get("taskId") || undefined,
            providerBuilderId: openToBuilders ? undefined : data.get("providerBuilderId"),
            openToBuilders,
            title: data.get("title"),
            acceptanceCriteria: String(data.get("criteria"))
              .split("\n")
              .map((item) => item.trim())
              .filter(Boolean),
            consideration:
              kind === "volunteer"
                ? { kind }
                : {
                    kind,
                    externalReference: data.get("externalReference") || undefined,
                  },
          }),
        ).then(() => form.reset());
      }}
    >
      <strong>Work agreement</strong>
      <select name="providerBuilderId">
        {props.members.filter((item) => item.id !== props.requesterId).map((item) => (
          <option key={item.id} value={item.id}>{item.displayName}</option>
        ))}
      </select>
      <select name="taskId">
        <option value="">No linked task</option>
        {props.tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <input name="title" placeholder="Deliverable" required />
      <textarea name="criteria" placeholder={"Acceptance criteria\nOne per line"} required />
      <select name="consideration">
        <option value="volunteer">Volunteer / reciprocal</option>
        <option value="external">Settled externally</option>
      </select>
      {props.mission.visibility !== "private" ? (
        <label className="meta">
          <input type="checkbox" name="openToBuilders" /> list publicly for another builder
        </label>
      ) : null}
      <input name="externalReference" type="url" placeholder="Optional invoice or escrow URL" />
      <p className="meta">District records the agreement and decision trail. It never holds funds.</p>
      <button type="submit">Propose</button>
    </form>
  );
}

const nextActions: Partial<Record<AgreementStatus, string[]>> = {
  proposed: ["accept", "cancel"],
  accepted: ["start", "deliver", "dispute", "cancel"],
  in_progress: ["deliver", "dispute"],
  delivered: ["approve", "dispute"],
};

function AgreementCard(props: {
  agreement: WorkAgreement;
  builderId: string;
  onRun: (operation: () => Promise<unknown>) => Promise<void>;
}) {
  const agreement = props.agreement;
  const actions = useMemo(() => nextActions[agreement.status] ?? [], [agreement.status]);
  return (
    <div className="mission-card">
      <strong>{agreement.title}</strong>
      <div className="meta">
        {agreement.status} · {agreement.consideration.kind === "external" ? "external settlement" : "volunteer"}
      </div>
      <ul>{agreement.acceptanceCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
      {agreement.deliveryNote ? <p>{agreement.deliveryNote}</p> : null}
      {agreement.disputeReason ? <p className="error">{agreement.disputeReason}</p> : null}
      <div className="mission-actions">
        {actions.map((action) => {
          const requester = agreement.requesterBuilderId === props.builderId;
          const provider = agreement.providerBuilderId === props.builderId;
          if (["accept", "start", "deliver"].includes(action) && !provider) return null;
          if (["approve", "cancel"].includes(action) && !requester) return null;
          return (
            <button
              key={action}
              onClick={() => {
                const deliveryNote =
                  action === "deliver" ? window.prompt("Delivery note or artifact URL") ?? undefined : undefined;
                const reason =
                  action === "dispute" ? window.prompt("What is disputed?") ?? undefined : undefined;
                if (action === "deliver" && !deliveryNote) return;
                if (action === "dispute" && !reason) return;
                void props.onRun(() =>
                  builderPost(`/api/agreements/${agreement.id}/${action}`, { deliveryNote, reason }),
                );
              }}
            >
              {action}
            </button>
          );
        })}
      </div>
    </div>
  );
}
