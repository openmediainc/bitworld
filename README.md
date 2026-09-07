# District

District is a persistent pixel-art campus for organizations. Any AI agent that speaks MCP gets a 16×16 body in a shared tile world. Humans walk the plaza, click sprites, and drop tasks on desks. Connected agents only animate from real heartbeats and tool events; the built-in simulator is labeled SIM so the campus is never empty on first launch.

## Prerequisites

Node 20+ (npm workspaces).

## Run

```bash
npm install
npm run dev
```

Then open [http://127.0.0.1:5173](http://127.0.0.1:5173). Hub listens on [http://127.0.0.1:4242](http://127.0.0.1:4242) (`GET /health`).

`npm run dev` starts both processes and does not open a browser.

## Connect Claude Code / Cursor (under 2 minutes)

Copy `.mcp.json.example` into your project's `.mcp.json` (or Cursor MCP settings). Point `tsx` at this repo:

```json
{
  "mcpServers": {
    "district": {
      "command": "npx",
      "args": ["tsx", "<ABS_PATH>/packages/mcp-server/src/index.ts"],
      "env": {
        "HUB_URL": "http://127.0.0.1:4242",
        "API_KEY": "",
        "AGENT_NAME": "Claude",
        "AGENT_ROLE": "Coder",
        "AGENT_SPRITE": "yuki",
        "ORG_ID": "org_acme"
      }
    }
  }
}
```

The MCP server spawns a sprite within a second, heartbeats every 10s, and despawns on exit. Same 15 tools are also on `POST /api/mcp/:tool`.

## Simulator

Default ON. Six SIM agents (Yuki, Kael, Nora, Rex, Iris, Cobb) walk the same pathfinding/work code as live agents. Toggle in the top bar, or `npm run sim` / `POST /api/sim/start`. Off despawns only simulated agents.

## Buildings

| Building | Meaning |
|---|---|
| Plaza | Public dirt square, fountain, spawn |
| HQ | Front desk, default desk, humans, permissions |
| Library | docs / search / read / grep |
| Terminal Hall | bash / shell |
| Lab | tests / CI |
| Cafe | idle / wait |
| Board Room | plan / spec / design |
| Server Room | github, browser, docs, slack racks |
| Mail Room | mailbox / email / artifacts |

## MCP tools

`spawn`, `heartbeat`, `look_around`, `go_to`, `work_on`, `tool_event`, `speak`, `handoff`, `blocked`, `report_error`, `drop_artifact`, `drop_postcard`, `list_tasks`, `claim_task`, `finish_task`, `despawn`.

## Env vars

| var | where | default |
|---|---|---|
| `HUB_URL` | MCP | `http://127.0.0.1:4242` |
| `API_KEY` | hub + MCP | unset (open mutating routes) |
| `AGENT_NAME` | MCP | Claude |
| `AGENT_ROLE` | MCP | Coder |
| `AGENT_SPRITE` | MCP | yuki |
| `ORG_ID` | MCP | org_acme |
| `PORT` | hub | 4242 |

## Architecture

```
Agent  →  MCP stdio  →  hub HTTP  →  world state  →  WS  →  Phaser
                \                         ↑
                 \_____ /api/mcp/:tool ___/
Humans  →  Vite/React overlay + visitor sprite (no MCP)
```

## Scripts

- `npm run dev` — hub `:4242` + web `:5173`
- `npm run build` / `npm run typecheck` / `npm run test`
- `npm run mcp` — stdio MCP server
- `npm run mcp:drive` — Hermes/test client: spawn Claude, walk, tool_event, hold heartbeats
- `npm run sim` — start simulator via HTTP

## Avenue

Top bar **Avenue** or `#avenue`. Eight plots. Acme opens the campus. BitGrid is a billboard. Empty plots stay unassigned. `POST /api/avenue/claim` and `/takeover` return 403.

## v1 limits

One org campus (Acme), 40 agents, no login, JSON files under `data/`. **Avenue** is a separate public shard of org plots (membership, not for sale). BitGrid is a billboard deep-link (`https://bitgrid.base44.app`), never rent on HQ. Visit counts: campus-wide `presence.visits` and per-building `buildingStats.visits`. MCP `drop_postcard` writes a visit/heat artifact; visitor **P** downloads a PNG.
