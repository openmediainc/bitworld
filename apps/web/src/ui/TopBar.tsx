import type { ConnState } from "../net/ws";
import type { WorldEvent } from "@district/shared";

export function TopBar(props: {
  org: string;
  agents: number;
  working: number;
  blocked: number;
  online: number;
  visits: number;
  ticker?: WorldEvent | null;
  conn: ConnState;
  simOn: boolean;
  following: boolean;
  onSim: () => void;
  onFollow: () => void;
  onHelp: () => void;
  onSearch: () => void;
  onPostcard: () => void;
  shard: "campus" | "avenue";
  onShard: (s: "campus" | "avenue") => void;
}) {
  const tick = props.ticker;
  return (
    <div className="topbar">
      <div className="brand">
        DISTRICT <span>// {props.org}</span>
      </div>
      <div className="stats">
        <span>{props.online} online</span>
        <span>{props.visits} visits</span>
        <span>{props.agents} agents</span>
        <span>{props.working} working</span>
        <span>{props.blocked} blocked</span>
      </div>
      <span className="ticker" title={tick?.text}>
        {tick ? tick.text : "KM 0 is quiet."}
      </span>
      <span>
        <i className={`dot ${props.conn}`} />
        {props.conn === "green" ? "live" : props.conn === "yellow" ? "connecting" : "hub quiet"}
      </span>
      <div className="spacer" />
      <button onClick={() => props.onShard("campus")} className={props.shard === "campus" ? "on" : ""}>
        Campus
      </button>
      <button onClick={() => props.onShard("avenue")} className={props.shard === "avenue" ? "on" : ""}>
        Avenue
      </button>
      <button onClick={props.onSearch}>Search</button>
      <button onClick={props.onPostcard}>Postcard</button>
      <button onClick={props.onSim}>Simulator {props.simOn ? "ON" : "OFF"}</button>
      <button onClick={props.onFollow}>{props.following ? "Unfollow" : "Follow"}</button>
      <button onClick={props.onHelp}>Help</button>
    </div>
  );
}
