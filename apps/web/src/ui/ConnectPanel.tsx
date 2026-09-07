import { useEffect, useState } from "react";
import { HUB, postJson } from "../net/ws";

function snippet(root: string): string {
  return `# .mcp.json — Claude Code / Cursor
{
  "mcpServers": {
    "district": {
      "command": "npx",
      "args": ["tsx", "${root}/packages/mcp-server/src/index.ts"],
      "env": {
        "HUB_URL": "http://127.0.0.1:4242",
        "AGENT_NAME": "Claude",
        "AGENT_ROLE": "Coder",
        "AGENT_SPRITE": "yuki",
        "ORG_ID": "org_acme"
      }
    }
  }
}`;
}

const CURL = `curl -s -X POST http://127.0.0.1:4242/api/agents/YOUR_ID/tool \\
  -H 'content-type: application/json' \\
  -d '{"server":"github","tool":"list_prs","summary":"checking PRs"}'`;

export function ConnectPanel() {
  const [msg, setMsg] = useState("");
  const [root, setRoot] = useState("/Users/q-mpro/Documents/Ventures/BitWorld");
  useEffect(() => {
    void fetch(`${HUB}/api/info`)
      .then((r) => r.json())
      .then((info: { root?: string }) => {
        if (info.root) setRoot(info.root);
      })
      .catch(() => undefined);
  }, []);
  const text = snippet(root);
  return (
    <div>
      <p className="empty">Any MCP client that can spawn a stdio server gets a body. Humans just walk in.</p>
      <pre>{text}</pre>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(text);
          setMsg("copied .mcp.json");
        }}
      >
        Copy MCP config
      </button>
      <p className="meta">tool_event via curl</p>
      <pre>{CURL}</pre>
      <button
        onClick={async () => {
          const agent = (await postJson("/api/agents/upsert", {
            name: "Demo",
            role: "Coder",
            sprite: "lark",
          })) as { id: string };
          await postJson(`/api/agents/${agent.id}/tool`, {
            server: "docs",
            tool: "search",
            summary: "reading the stacks",
          });
          window.setTimeout(() => {
            void postJson(`/api/agents/${agent.id}/tool`, {
              server: "bash",
              tool: "run",
              summary: "terminal time",
            });
          }, 4000);
          window.setTimeout(() => {
            void postJson(`/api/agents/${agent.id}/tool`, {
              server: "pytest",
              tool: "run",
              summary: "lab check",
            });
          }, 8000);
          setMsg(`spawned ${agent.id} — library → terminal → lab`);
        }}
      >
        Spawn demo agent via HTTP
      </button>
      {msg && <p className="meta">{msg}</p>}
    </div>
  );
}
