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
  clearBuilderSession,
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
  const [secret, setSecret] = useState<{ label: string; value: string }>();

  const refresh = useCallback(async () => {
    if (!builderSession()) return;
    try {
      const next = await loadWorkspace();
      const builderMissions = next.missions.filter((mission) =>
        mission.builderIds?.includes(next.builder.id),
      );
      setWorkspace(next);
      setSelectedId((current) =>
        current && builderMissions.some((mission) => mission.id === current)
          ? current
          : builderMissions[0]?.id,
      );
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
  }, [props.visitorId, workspace?.builder.id, refresh]);

  if (!builderSession()) {
    return (
      <BuilderRegistration
        onRegistered={() => void refresh()}
        onCredential={(label, value) => setSecret({ label, value })}
        error={error}
        onError={setError}
      />
    );
  }

  if (!workspace) {
    return (
      <div className="empty">
        <p>{error || "Loading builder workspace…"}</p>
        {error ? (
          <button
            onClick={() => {
              clearBuilderSession();
              location.reload();
            }}
          >
            Clear invalid session and restore
          </button>
        ) : null}
      </div>
    );
  }
  const mission = workspace.missions.find((item) => item.id === selectedId);
  const builderMissions = workspace.missions.filter((item) =>
    item.builderIds?.includes(workspace.builder.id),
  );

  const run = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
      setError("");
      await refresh();
      return true;
    } catch (value) {
      setError(value instanceof Error ? value.message : String(value));
      return false;
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
      {secret ? (
        <section className="mission-section credential">
          <strong>{secret.label}</strong>
          <textarea value={secret.value} readOnly aria-label={secret.label} />
          <div className="mission-actions">
            <button
              onClick={() =>
                void navigator.clipboard.writeText(secret.value).catch(() => {
                  setError("Clipboard access failed. Copy the credential from the field above.");
                })
              }
            >
              Copy
            </button>
            <button onClick={() => setSecret(undefined)}>Hide</button>
          </div>
        </section>
      ) : null}
      <details>
        <summary>Edit builder profile</summary>
        <form
          key={workspace.builder.updatedAt}
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
          <button
            type="button"
            onClick={() => {
              if (!window.confirm("Sign out of this builder identity on this browser?")) return;
              clearBuilderSession();
              location.reload();
            }}
          >
            Sign out / restore another identity
          </button>
        </form>
      </details>

      <section className="mission-section">
        <strong>Inbox</strong>
        {workspace.notifications.filter((item) => !item.readAt).slice(0, 20).map((item) => (
          <div className="mission-task" key={item.id}>
            <span className="task-check">!</span>
            <span>
              {item.text}
            </span>
            <div className="mission-actions">
              {item.kind === "invite" && item.inviteId ? (
                <button
                  onClick={() => {
                    if (!window.confirm(`Accept this invitation?\n\n${item.text}`)) return;
                    void run(async () => {
                      await builderPost(`/api/invites/${item.inviteId}/accept`);
                      await builderPost(`/api/notifications/${item.id}/read`);
                    });
                  }}
                >
                  Accept
                </button>
              ) : null}
              <button
                onClick={() =>
                  void run(() => builderPost(`/api/notifications/${item.id}/read`))
                }
              >
                {item.kind === "invite" ? "Dismiss" : "Mark read"}
              </button>
            </div>
          </div>
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
              {considerationLabel(opportunity)}
            </div>
            <ul>
              {opportunity.acceptanceCriteria.map((criterion) => <li key={criterion}>{criterion}</li>)}
            </ul>
            <button
              onClick={() => {
                if (!window.confirm(`Claim “${opportunity.title}” for your fleet?`)) return;
                void run(() => builderPost(`/api/agreements/${opportunity.id}/claim`)).then((ok) => {
                  if (ok) setSelectedId(opportunity.missionId);
                })
              }}
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
          void run(() => builderPost("/api/invites/accept", { token: invite })).then((ok) => {
            if (ok) setInvite("");
          });
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
        <strong>Builder missions</strong>
        {builderMissions.map((item) => (
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
        {!builderMissions.length ? (
          <p className="meta">No builder missions yet. Public campus missions remain in the Missions tab.</p>
        ) : null}
      </section>

      {mission ? (
        <MissionWorkspace
          mission={mission}
          workspace={workspace}
          onRun={run}
          onSecret={(label, value) => setSecret({ label, value })}
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
            !mission.builderIds?.includes(relationship.builderId) &&
            !workspace.invites.some(
              (invite) =>
                invite.missionId === mission.id &&
                invite.inviteeBuilderId === relationship.builderId &&
                !invite.acceptedAt &&
                !invite.revokedAt &&
                invite.expiresAt > Date.now(),
            ) ? (
              <button
                onClick={() => {
                  if (!window.confirm(`Invite ${relationship.displayName} to ${mission.title}?`)) return;
                  void run(() =>
                    builderPost(`/api/missions/${mission.id}/invites`, {
                      expiresInHours: 72,
                      inviteeBuilderId: relationship.builderId,
                    }),
                  )
                }}
              >
                Invite to {mission.title}
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
        {workspace.builder.agentIds.map((agentId) => (
          <div className="mission-task" key={agentId}>
            <span className="task-check">A</span>
            <code>{agentId}</code>
            <button
              onClick={() => {
                if (!window.confirm(`Remove ${agentId} from this fleet and revoke its direct grants?`)) return;
                void run(() => builderPost(`/api/builders/me/agents/${agentId}/remove`));
              }}
            >
              Remove
            </button>
          </div>
        ))}
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
              .then((enrollment) => {
                const value = `FLEET_TOKEN=${enrollment.token}`;
                setSecret({ label: "Single-use fleet token · expires in 15 minutes", value });
                return navigator.clipboard.writeText(value).catch(() => undefined);
              })
              .catch((value) => setError(value instanceof Error ? value.message : String(value)));
          }}
        >
          Enroll an agent
        </button>
        <button
          onClick={() => {
            if (!window.confirm("Rotate the human builder token? Other signed-in browsers will stop working.")) return;
            void rotateBuilderToken()
              .then((token) => {
                const value = `BUILDER_ID=${workspace.builder.id}\nBUILDER_TOKEN=${token}`;
                setSecret({ label: "New human identity credential · never give this to agents", value });
                return navigator.clipboard.writeText(value).catch(() => undefined);
              })
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
  onCredential: (label: string, value: string) => void;
  error: string;
  onError: (message: string) => void;
}) {
  return (
    <div className="mission-panel">
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
          .then((profile) => {
            const session = builderSession();
            if (session) {
              props.onCredential(
                "Save this human identity credential · never give it to agents",
                `BUILDER_ID=${profile.id}\nBUILDER_TOKEN=${session.token}`,
              );
            }
            props.onRegistered();
          })
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
      <input name="displayName" placeholder="Display name" aria-label="Display name" required />
      <input
        name="handle"
        placeholder="lowercase_handle"
        aria-label="Builder handle"
        autoCapitalize="none"
        autoCorrect="off"
        pattern="[a-z0-9][a-z0-9_-]{2,31}"
        required
      />
      <p className="meta">3–32 lowercase letters, numbers, underscores, or hyphens.</p>
      <textarea name="bio" placeholder="What do you build?" />
      <input name="skills" placeholder="Skills, comma separated" />
      <select name="availability" defaultValue="available">
        <option value="available">Available to collaborate</option>
        <option value="limited">Limited availability</option>
        <option value="unavailable">Not currently available</option>
      </select>
      <input name="terms" placeholder="Volunteer, reciprocal, paid externally…" />
        <button type="submit">Create identity</button>
      </form>
      <details>
        <summary>Restore an existing identity</summary>
        <form
          className="mission-form"
          onSubmit={(event) => {
              event.preventDefault();
              const data = new FormData(event.currentTarget);
              const id = String(data.get("restoreId") ?? "");
              const token = String(data.get("restoreToken") ?? "");
              if (!id || !token) {
                props.onError("Builder id and token are required");
                return;
              }
              void restoreBuilder(id, token)
                .then(props.onRegistered)
                .catch((value) =>
                  props.onError(value instanceof Error ? value.message : String(value)),
                );
            }}
        >
          <input name="restoreId" placeholder="builder_…" required />
          <input name="restoreToken" type="password" placeholder="Builder token" required />
          <button type="submit">Restore</button>
        </form>
      </details>
    </div>
  );
}

function MissionCreate(props: {
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
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
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
  onSecret: (label: string, value: string) => void;
}) {
  const [resourceKind, setResourceKind] = useState<
    "github_repo" | "github_issue" | "document" | "tracker" | "custom"
  >("github_repo");
  const { mission, workspace } = props;
  const owner = mission.ownerBuilderId === workspace.builder.id;
  const resources = workspace.resources.filter((item) => item.missionId === mission.id);
  const grants = workspace.grants.filter((item) => item.missionId === mission.id);
  const agreements = workspace.agreements.filter((item) => item.missionId === mission.id);
  const pendingInvites = workspace.invites.filter(
    (item) =>
      item.missionId === mission.id &&
      item.createdBy === workspace.builder.id &&
      !item.acceptedAt &&
      !item.revokedAt &&
      item.expiresAt > Date.now(),
  );
  const tasks = workspace.tasks.filter(
    (item) => item.missionId === mission.id && item.kind !== "artifact",
  );
  const members = workspace.builders.filter((item) => mission.builderIds?.includes(item.id));
  const grantTargets = [
    ...members
      .filter((item) => item.id !== workspace.builder.id)
      .map((item) => ({ value: `builder:${item.id}`, label: `${item.displayName} · whole fleet` })),
    ...members.flatMap((item) =>
      item.agentIds.map((agentId) => ({
        value: `agent:${agentId}`,
        label: `${agentId} · ${item.displayName}`,
      })),
    ),
  ];

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
                onClick={() => {
                  if (status === "completed" && !window.confirm(`Complete ${mission.title}?`)) return;
                  void props.onRun(() =>
                    builderPost(`/api/missions/${mission.id}/status`, { status }),
                  )
                }}
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
                props.onSecret("Private mission invite · expires in 72 hours", result.token);
                await navigator.clipboard.writeText(result.token).catch(() => undefined);
              })
            }
          >
            Copy private invite
          </button>
        ) : null}
        {pendingInvites.map((invite) => (
          <div className="mission-task" key={invite.id}>
            <span className="task-check">i</span>
            <span className="meta">
              {invite.inviteeBuilderId ? "Targeted invite" : "Bearer invite"} · expires{" "}
              {new Date(invite.expiresAt).toLocaleString()}
            </span>
            <button
              onClick={() => {
                if (!window.confirm("Revoke this pending invite?")) return;
                void props.onRun(() => builderPost(`/api/invites/${invite.id}/revoke`));
              }}
            >
              Revoke
            </button>
          </div>
        ))}
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
          ).then((ok) => {
            if (ok) form.reset();
          });
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
          ).then((ok) => {
            if (ok) form.reset();
          });
        }}
      >
        <strong>Work resource</strong>
        <select
          name="kind"
          value={resourceKind}
          onChange={(event) => setResourceKind(event.target.value as typeof resourceKind)}
        >
          <option value="github_repo">GitHub repository</option>
          <option value="github_issue">GitHub issue</option>
          <option value="document">Document</option>
          <option value="tracker">Tracker</option>
          <option value="custom">Other link</option>
        </select>
        <input name="label" placeholder="Label" required />
        <input name="url" type="url" placeholder="https://…" required />
        {resourceKind === "github_repo" ? (
          <input name="installationId" type="number" min="1" placeholder="GitHub App installation id (optional)" />
        ) : null}
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

      {owner && resources.length && grantTargets.length ? (
        <form
          className="mission-form"
          onSubmit={(event) => {
            event.preventDefault();
            const form = event.currentTarget;
            const data = new FormData(form);
            const target = String(data.get("target"));
            const separator = target.indexOf(":");
            const targetType = target.slice(0, separator);
            const targetId = target.slice(separator + 1);
            if (!window.confirm("Grant these actions to the selected target?")) return;
            void props.onRun(() =>
              builderPost(`/api/missions/${mission.id}/grants`, {
                resourceId: data.get("resourceId"),
                granteeBuilderId: targetType === "builder" ? targetId : undefined,
                granteeAgentId: targetType === "agent" ? targetId : undefined,
                actions: String(data.get("actions"))
                  .split(",")
                  .map((item) => item.trim())
                  .filter(Boolean),
              }),
            ).then((ok) => {
              if (ok) form.reset();
            });
          }}
        >
          <strong>Scoped capability</strong>
          <select name="resourceId">{resources.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
          <select name="target">
            {grantTargets.map((item) => (
              <option key={item.value} value={item.value}>{item.label}</option>
            ))}
          </select>
          <input
            name="actions"
            defaultValue="contents:read, pull_requests:create"
            aria-label="Capability actions"
            required
          />
          <p className="meta">
            GitHub: issues:read, issues:comment, contents:read, contents:write,
            branches:create, pull_requests:create
          </p>
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
          builders={workspace.directory}
          onRun={props.onRun}
        />
      ))}

      <section className="mission-section">
        <strong>Private mission timeline</strong>
        {workspace.events
          .filter((event) => event.data?.missionId === mission.id)
          .slice(-20)
          .reverse()
          .map((event) => (
            <div className="mission-event" key={event.id}>
              <span>
                {new Date(event.at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
              {event.text}
            </div>
          ))}
        {!workspace.events.some((event) => event.data?.missionId === mission.id) ? (
          <div className="empty">Agent activity for this mission will appear here.</div>
        ) : null}
      </section>

      <section className="mission-section">
        <strong>Audit</strong>
        {workspace.audit.filter((item) => item.missionId === mission.id).slice(-12).reverse().map((item) => (
          <div className="audit-event" key={item.id}>
            <span>{new Date(item.at).toLocaleString()}</span>
            <span>{item.action}</span>
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
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const [openToBuilders, setOpenToBuilders] = useState(false);
  const [consideration, setConsideration] = useState<"volunteer" | "external">("volunteer");
  return (
    <form
      className="mission-form"
      onSubmit={(event) => {
        event.preventDefault();
        const form = event.currentTarget;
        const data = new FormData(form);
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
              consideration === "volunteer"
                ? { kind: consideration }
                : {
                    kind: consideration,
                    amountMinor: data.get("amount")
                      ? Math.round(Number(data.get("amount")) * 100)
                      : undefined,
                    currency: data.get("amount") ? data.get("currency") : undefined,
                    externalReference: data.get("externalReference") || undefined,
                  },
          }),
        ).then((ok) => {
          if (ok) {
            form.reset();
            setOpenToBuilders(false);
            setConsideration("volunteer");
          }
        });
      }}
    >
      <strong>Work agreement</strong>
      {!openToBuilders ? (
        <select name="providerBuilderId">
          {props.members.filter((item) => item.id !== props.requesterId).map((item) => (
            <option key={item.id} value={item.id}>{item.displayName}</option>
          ))}
        </select>
      ) : null}
      <select name="taskId">
        <option value="">No linked task</option>
        {props.tasks.map((item) => <option key={item.id} value={item.id}>{item.title}</option>)}
      </select>
      <input name="title" placeholder="Deliverable" required />
      <textarea name="criteria" placeholder={"Acceptance criteria\nOne per line"} required />
      <select
        name="consideration"
        value={consideration}
        onChange={(event) => setConsideration(event.target.value as "volunteer" | "external")}
      >
        <option value="volunteer">Volunteer / reciprocal</option>
        <option value="external">Settled externally</option>
      </select>
      {props.mission.visibility !== "private" ? (
        <label className="meta">
          <input
            type="checkbox"
            name="openToBuilders"
            checked={openToBuilders}
            onChange={(event) => setOpenToBuilders(event.target.checked)}
          />{" "}
          list publicly for another builder
        </label>
      ) : null}
      {consideration === "external" ? (
        <>
          <div className="mission-actions">
            <input name="amount" type="number" min="0" step="0.01" placeholder="Amount (optional)" />
            <input name="currency" defaultValue="USD" pattern="[A-Z]{3}" aria-label="Currency code" />
          </div>
          <input name="externalReference" type="url" placeholder="Optional invoice or escrow URL" />
        </>
      ) : null}
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

function considerationLabel(agreement: WorkAgreement): string {
  if (agreement.consideration.kind === "volunteer") return "volunteer / reciprocal";
  const { amountMinor, currency } = agreement.consideration;
  if (amountMinor === undefined || !currency) return "external settlement";
  return `${currency} ${(amountMinor / 100).toFixed(2)} · external settlement`;
}

function linkOrText(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol === "https:" || url.protocol === "http:") {
      return <a href={url.toString()} target="_blank" rel="noreferrer">{url.toString()}</a>;
    }
  } catch {
    /* delivery notes may be plain text */
  }
  return value;
}

function AgreementCard(props: {
  agreement: WorkAgreement;
  builderId: string;
  builders: CollaborationWorkspace["directory"];
  onRun: (operation: () => Promise<unknown>) => Promise<boolean>;
}) {
  const agreement = props.agreement;
  const actions = useMemo(() => nextActions[agreement.status] ?? [], [agreement.status]);
  const [deliveryNote, setDeliveryNote] = useState("");
  const [disputeReason, setDisputeReason] = useState("");
  const requester = agreement.requesterBuilderId === props.builderId;
  const provider = agreement.providerBuilderId === props.builderId;
  const nameOf = (id?: string) =>
    id ? props.builders.find((builder) => builder.id === id)?.displayName ?? id : "Open";
  return (
    <div className="mission-card">
      <strong>{agreement.title}</strong>
      <div className="meta">
        {agreement.status} · {considerationLabel(agreement)}
      </div>
      <div className="meta">
        {nameOf(agreement.requesterBuilderId)} → {nameOf(agreement.providerBuilderId)}
      </div>
      <ul>{agreement.acceptanceCriteria.map((item) => <li key={item}>{item}</li>)}</ul>
      {agreement.deliveryNote ? <p>{linkOrText(agreement.deliveryNote)}</p> : null}
      {agreement.consideration.kind === "external" && agreement.consideration.externalReference ? (
        <p>{linkOrText(agreement.consideration.externalReference)}</p>
      ) : null}
      {agreement.disputeReason ? <p className="error">{agreement.disputeReason}</p> : null}
      <div className="mission-actions">
        {actions.map((action) => {
          if (action === "deliver" || action === "dispute") return null;
          if (["accept", "start", "deliver"].includes(action) && !provider) return null;
          if (action === "approve" && !requester) return null;
          if (action === "cancel" && !requester && !(provider && agreement.status === "proposed")) {
            return null;
          }
          return (
            <button
              key={action}
              onClick={() => {
                if (
                  (action === "approve" || action === "cancel") &&
                  !window.confirm(
                    `${action === "approve" ? "Approve" : provider && !requester ? "Decline" : "Cancel"} this agreement?`,
                  )
                ) return;
                void props.onRun(() =>
                  builderPost(`/api/agreements/${agreement.id}/${action}`),
                );
              }}
            >
              {action === "cancel" && provider && !requester ? "decline" : action}
            </button>
          );
        })}
      </div>
      {actions.includes("deliver") && provider ? (
        <form
          className="mission-actions"
          onSubmit={(event) => {
            event.preventDefault();
            void props.onRun(() =>
              builderPost(`/api/agreements/${agreement.id}/deliver`, { deliveryNote }),
            ).then((ok) => {
              if (ok) setDeliveryNote("");
            });
          }}
        >
          <input
            value={deliveryNote}
            onChange={(event) => setDeliveryNote(event.target.value)}
            placeholder="Delivery note or artifact URL"
            aria-label="Delivery note or artifact URL"
            required
          />
          <button type="submit">Deliver</button>
        </form>
      ) : null}
      {actions.includes("dispute") && (requester || provider) ? (
        <form
          className="mission-actions"
          onSubmit={(event) => {
            event.preventDefault();
            if (!window.confirm("Open a dispute with this reason?")) return;
            void props.onRun(() =>
              builderPost(`/api/agreements/${agreement.id}/dispute`, { reason: disputeReason }),
            ).then((ok) => {
              if (ok) setDisputeReason("");
            });
          }}
        >
          <input
            value={disputeReason}
            onChange={(event) => setDisputeReason(event.target.value)}
            placeholder="What is disputed?"
            aria-label="Dispute reason"
            required
          />
          <button type="submit">Dispute</button>
        </form>
      ) : null}
    </div>
  );
}
