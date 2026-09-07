import { useEffect, useRef, useState } from "react";
import Phaser from "phaser";
import type { Snapshot } from "@district/shared";
import { DistrictScene, gameConfig } from "./phaser/DistrictScene";
import { TopBar } from "./ui/TopBar";
import { SidePanel } from "./ui/SidePanel";
import { EventLog } from "./ui/EventLog";
import { Inspector } from "./ui/Inspector";
import { TaskComposer } from "./ui/TaskComposer";
import { connectWs, hubHttp, postJson, type ConnState, type WsApi } from "./net/ws";
import { SearchPalette } from "./ui/SearchPalette";
import { Tutorial } from "./ui/Tutorial";

function emptySnap(): Snapshot {
  return {
    t: 0,
    org: { id: "org_acme", name: "Acme", slug: "acme", color: "#3D6B4F", plot: { x: 2, y: 2, w: 76, h: 52 }, public: true },
    buildings: [],
    stations: [],
    agents: [],
    tasks: [],
    missions: [],
    events: [],
  };
}

function visitorName(): string {
  const saved = localStorage.getItem("district.visitorName");
  if (saved) return saved;
  const generated = `Human ${Math.floor(100 + Math.random() * 900)}`;
  localStorage.setItem("district.visitorName", generated);
  return generated;
}

export function App() {
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<DistrictScene | null>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const wsRef = useRef<WsApi | null>(null);
  const [snap, setSnap] = useState<Snapshot>(emptySnap());
  const [conn, setConn] = useState<ConnState>("yellow");
  const [tab, setTab] = useState<"missions" | "agents" | "stations" | "tasks" | "connect">("missions");
  const [selectedMission, setSelectedMission] = useState<string | null>(null);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);
  const [selectedStation, setSelectedStation] = useState<string | null>(null);
  const [composer, setComposer] = useState(false);
  const [help, setHelp] = useState(false);
  const [askWait, setAskWait] = useState<string | null>(null);
  const [follow, setFollow] = useState(false);
  const [apiKeyRequired, setApiKeyRequired] = useState(false);
  const [selectedBuilding, setSelectedBuilding] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [tutorial, setTutorial] = useState(() => localStorage.getItem("district.tutorial") !== "1");
  const [shout, setShout] = useState(false);
  const [shard, setShard] = useState<"campus" | "avenue">(() =>
    location.hash.replace(/^#/, "") === "avenue" ? "avenue" : "campus",
  );
  const [rules, setRules] = useState(false);
  const [selectedPlot, setSelectedPlot] = useState<string | null>(null);
  const visitorId = useRef<string | undefined>(undefined);
  const name = useRef(visitorName());
  const [visitorSessionId, setVisitorSessionId] = useState<string | undefined>(undefined);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.tagName === "INPUT" || t.tagName === "TEXTAREA") return;
      if (e.key === "/" || (e.key === "k" && e.metaKey)) {
        e.preventDefault();
        setSearchOpen(true);
      }
      if (e.key === "p" || e.key === "P") sceneRef.current?.takePostcard();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!snap.buildings.length) return;
    const h = decodeURIComponent(location.hash.replace(/^#/, ""));
    if (!h) return;
    if (h.startsWith("mission-")) {
      const missionId = h.slice("mission-".length);
      if (snap.missions.some((mission) => mission.id === missionId)) {
        setTab("missions");
        setSelectedMission(missionId);
      }
      return;
    }
    if (h === "avenue") {
      setShard("avenue");
      sceneRef.current?.setViewShard("avenue");
      return;
    }
    const plotHit = snap.avenue?.plots.find((p) => p.slug === h || p.id === h);
    if (plotHit) {
      setShard("avenue");
      setSelectedPlot(plotHit.id);
      sceneRef.current?.setViewShard("avenue");
      return;
    }
    setShard("campus");
    sceneRef.current?.setViewShard("campus");
    const b = snap.buildings.find((x) => x.kind === h || x.id === h || x.name.toLowerCase() === h.toLowerCase());
    if (b) {
      setSelectedBuilding(b.id);
      sceneRef.current?.panToBuilding(b.id);
      return;
    }
    if (h.startsWith("station-")) {
      const slug = h.slice(8);
      const s = snap.stations.find((x) => x.mcpServerName === slug || x.id === slug || x.name.toLowerCase().includes(slug));
      if (s) setSelectedStation(s.id);
    }
  }, [snap.buildings, snap.stations, snap.missions]);

  useEffect(() => {
    void fetch(`${hubHttp()}/api/info`)
      .then((r) => r.json())
      .then((info: { apiKeyRequired?: boolean }) => setApiKeyRequired(Boolean(info.apiKeyRequired)))
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const size = () => ({
      w: Math.max(640, window.innerWidth - 320),
      h: Math.max(360, window.innerHeight - 40 - 160),
    });
    const { w, h } = size();
    const game = new Phaser.Game(gameConfig(host, w, h));
    gameRef.current = game;
    game.events.once(Phaser.Core.Events.READY, () => {
      const scene = game.scene.getScene("district") as DistrictScene;
      sceneRef.current = scene;
      scene.hooks = {
        onSelectAgent: (id) => {
          setSelectedAgent(id);
          setSelectedStation(null);
        },
        onSelectStation: (id) => {
          setSelectedStation(id);
          setSelectedAgent(null);
        },
        onSelectBuilding: (id) => {
          const plot = scene.snapshot?.avenue?.plots.find((p) => p.id === id);
          if (plot) {
            setSelectedPlot(plot.id);
            setSelectedBuilding(null);
            setSelectedAgent(null);
            setSelectedStation(null);
            location.hash = plot.slug;
            return;
          }
          setSelectedBuilding(id);
          setSelectedPlot(null);
          setSelectedAgent(null);
          setSelectedStation(null);
          if (id) {
            const b = scene.snapshot?.buildings.find((x) => x.id === id);
            if (b) location.hash = b.kind;
          }
        },
        onInteract: (kind, id) => {
          if (kind === "desk") setComposer(true);
          if (kind === "station") {
            const st = scene.snapshot?.stations.find((s) => s.id === id);
            if (st?.kind === "cafe") setShout(true);
          }
          if (kind === "agent") setSelectedAgent(id);
        },
        sendMove: (x, y) => wsRef.current?.send({ type: "move", x, y }),
        onHelp: () => setHelp((h) => !h),
        onFollow: (id) => {
          setFollow(Boolean(id));
          scene.setFollow(id);
        },
        visitorId: visitorId.current,
      };
    });
    const onResize = () => {
      const s = size();
      game.scale.resize(s.w, s.h);
    };
    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
      game.destroy(true);
    };
  }, []);

  useEffect(() => {
    const api = connectWs({
      onStatus: setConn,
      name: name.current,
      onSession: (id) => {
        visitorId.current = id;
        setVisitorSessionId(id);
        if (sceneRef.current) sceneRef.current.hooks.visitorId = id;
      },
      onSnapshot: (s) => {
        setSnap(s);
        sceneRef.current?.applySnapshot(s);
        if (sceneRef.current) {
          sceneRef.current.hooks.visitorId = visitorId.current;
          if (location.hash.replace(/^#/, "") === "avenue") sceneRef.current.setViewShard("avenue");
        }
      },
      onDelta: (d) => {
        setSnap((prev) => {
          let agents = prev.agents;
          if (d.agents) {
            const map = new Map(prev.agents.map((a) => [a.id, a]));
            for (const a of d.agents) map.set(a.id, a);
            agents = [...map.values()];
          }
          if (d.events) {
            for (const e of d.events) {
              if (e.kind === "despawn" && e.agentId) {
                agents = agents.filter((a) => a.id !== e.agentId);
                sceneRef.current?.removeAgent(e.agentId);
              }
            }
          }
          const next: Snapshot = {
            ...prev,
            t: Date.now(),
            agents,
            events: d.events ? [...prev.events, ...d.events].slice(-40) : prev.events,
            tasks: d.tasks ?? prev.tasks,
            missions: d.missions ?? prev.missions,
          };
          if (d.agents) sceneRef.current?.applyAgents(d.agents);
          return next;
        });
      },
    });
    wsRef.current = api;
    return () => api.close();
  }, []);

  const agent = snap.agents.find((a) => a.id === selectedAgent) ?? null;
  const station = snap.stations.find((s) => s.id === selectedStation) ?? null;
  const building = snap.buildings.find((b) => b.id === selectedBuilding) ?? null;
  const plot = snap.avenue?.plots.find((p) => p.id === selectedPlot) ?? null;
  const stat = snap.buildingStats?.find((s) => s.buildingId === selectedBuilding) ?? null;
  const working = snap.agents.filter((a) => a.state === "working").length;
  const blocked = snap.agents.filter((a) => a.state === "blocked").length;
  const ticker = snap.events.filter((e) => e.kind !== "heartbeat").at(-1) ?? null;

  return (
    <div className="app">
      <TopBar
        org={snap.org.name}
        agents={snap.agents.filter((a) => a.sprite !== "visitor").length}
        working={working}
        blocked={blocked}
        online={snap.presence?.online ?? snap.agents.filter((a) => a.state !== "sleeping").length}
        visits={snap.presence?.visits ?? 0}
        ticker={ticker}
        conn={conn}
        following={follow}
        onSearch={() => setSearchOpen(true)}
        onPostcard={() => {
          sceneRef.current?.takePostcard();
          const id = visitorId.current;
          if (id) void postJson(`/api/mcp/drop_postcard`, { agentId: id }).catch(() => undefined);
        }}
        onRules={() => setRules(true)}
        shard={shard}
        onShard={(s) => {
          setShard(s);
          location.hash = s === "avenue" ? "avenue" : "";
          sceneRef.current?.setViewShard(s);
          const id = visitorId.current;
          if (id) void postJson(`/api/agents/${id}/shard`, { shard: s }).catch(() => undefined);
        }}
        onFollow={() => {
          const id = selectedAgent;
          setFollow((f) => {
            const n = !f;
            sceneRef.current?.setFollow(n ? id : null);
            return n;
          });
        }}
        onHelp={() => setHelp((h) => !h)}
      />
      <div className="main">
        <div id="game" ref={hostRef} />
        <SidePanel
          tab={tab}
          onTab={setTab}
          agents={snap.agents}
          stations={snap.stations}
          buildings={snap.buildings}
          tasks={snap.tasks}
          missions={snap.missions}
          events={snap.events}
          visitorId={visitorSessionId}
          selectedMissionId={selectedMission}
          onSelectMission={(id) => {
            setSelectedMission(id);
            location.hash = id ? `mission-${id}` : "";
          }}
          selectedId={selectedAgent}
          onSelectAgent={(id) => {
            setSelectedAgent(id);
            setSelectedBuilding(null);
            sceneRef.current?.panToAgent(id);
            const a = snap.agents.find((x) => x.id === id);
            if (a) location.hash = `agent-${a.name.toLowerCase()}`;
          }}
          onSelectStation={(id) => {
            setSelectedStation(id);
            setSelectedAgent(null);
            const s = snap.stations.find((x) => x.id === id);
            if (s?.mcpServerName) location.hash = `station-${s.mcpServerName}`;
          }}
          onSelectBuilding={(id) => {
            setSelectedBuilding(id);
            setSelectedAgent(null);
            setSelectedStation(null);
            sceneRef.current?.panToBuilding(id);
            const b = snap.buildings.find((x) => x.id === id);
            if (b) location.hash = b.kind;
          }}
        />
      </div>
      <EventLog events={snap.events} agents={snap.agents} />
      {(agent || station || building || plot) && (
        <Inspector
          agent={agent}
          station={station}
          building={building}
          plot={plot}
          stat={stat}
          events={snap.events}
          agents={snap.agents}
          apiKeyRequired={apiKeyRequired}
          sharePath={plot ? `/b/${plot.slug}` : building ? `/b/${building.kind}` : undefined}
          onAssign={() => setComposer(true)}
          onShout={() => setShout(true)}
          onClose={() => {
            setSelectedAgent(null);
            setSelectedStation(null);
            setSelectedBuilding(null);
            setSelectedPlot(null);
          }}
          onAsk={
            agent
              ? (text) => {
                  wsRef.current?.send({ type: "say", text: `to ${agent.name}: ${text}` });
                  setAskWait("Waiting for agent…");
                  window.setTimeout(() => setAskWait("They’ll see this in their event stream."), 3000);
                }
              : undefined
          }
        />
      )}
      {askWait && <div className="composer">{askWait}</div>}
      {composer && (
        <TaskComposer
          agents={snap.agents}
          presetAgentId={selectedAgent ?? undefined}
          onClose={() => setComposer(false)}
        />
      )}
      {shout && (
        <form
          className="composer"
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.target as HTMLFormElement).elements.namedItem("shout") as HTMLInputElement;
            if (input.value) wsRef.current?.send({ type: "say", text: input.value });
            setShout(false);
          }}
        >
          <strong>Cafe shout</strong>
          <input name="shout" autoFocus placeholder="say it to the plaza" aria-label="Cafe shout" />
          <button type="submit">Send</button>
          <button type="button" onClick={() => setShout(false)}>
            cancel
          </button>
        </form>
      )}
      {searchOpen && (
        <SearchPalette
          query={searchQ}
          onQuery={setSearchQ}
          agents={snap.agents}
          stations={snap.stations}
          buildings={snap.buildings}
          onPickAgent={(id) => {
            setSearchOpen(false);
            setSelectedAgent(id);
            sceneRef.current?.panToAgent(id);
          }}
          onPickStation={(id) => {
            setSearchOpen(false);
            setSelectedStation(id);
          }}
          onPickBuilding={(id) => {
            setSearchOpen(false);
            setSelectedBuilding(id);
            sceneRef.current?.panToBuilding(id);
          }}
          onClose={() => setSearchOpen(false)}
        />
      )}
      {tutorial && (
        <Tutorial
          onDone={() => {
            localStorage.setItem("district.tutorial", "1");
            setTutorial(false);
          }}
        />
      )}
      {rules && (
        <form
          className="help"
          onSubmit={(e) => {
            e.preventDefault();
            const input = (e.target as HTMLFormElement).elements.namedItem("report") as HTMLInputElement;
            if (input.value) void postJson("/api/report", { text: input.value });
            setRules(false);
          }}
        >
          <strong>Campus rules</strong>
          <p className="empty">
            Connected agents only move on real events. Plots are membership, not for sale. Paid pixels
            live on BitGrid. Ranking is not endorsement. Being connected does not exempt you from campus rules.
          </p>
          <p className="meta">
            <a href={`${hubHttp()}/rules`}>/rules</a> · <a href={`${hubHttp()}/b/hq`}>/b/hq</a>
          </p>
          <input name="report" placeholder="report plaza text" aria-label="Report" />
          <button type="submit">Send report</button>
          <button type="button" onClick={() => setRules(false)}>
            close
          </button>
        </form>
      )}
      {help && (
        <div className="help">
          <strong>Campus controls</strong>
          <pre>{`WASD / arrows  walk
E / Enter      talk, desk, or cafe shout
Esc            close inspector
Space          follow / unfollow
1              zoom-follow selected
C              KM 0 (fountain or Avenue marker)
/              search
P              postcard PNG
H              this sheet
Campus/Avenue  public street of org plots
#avenue #hq #bitgrid   deep links
click plot     inspect (BitGrid is a billboard, not HQ rent)`}</pre>
          <p>
            Campus visits are campus-wide; each building also counts its own visits. Avenue plots are membership, never
            for sale. Paid pixels belong on BitGrid.
          </p>
          <button onClick={() => setHelp(false)}>close</button>
        </div>
      )}
    </div>
  );
}
