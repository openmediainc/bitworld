const KEY = "district.agentTokens";
const HEADER = "x-district-token";

type TokenMap = Record<string, string>;

function read(): TokenMap {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "{}") as TokenMap;
  } catch {
    return {};
  }
}

function write(map: TokenMap): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(map));
  } catch {
    /* private mode — the tab just loses its agents on reload */
  }
}

/** Agent this request acts as: /api/agents/:id/... or an agentId in the body. */
export function agentIdOf(path: string, body: unknown): string | undefined {
  const m = /^\/api\/agents\/([^/]+)\//.exec(path);
  if (m) return decodeURIComponent(m[1]);
  const b = body as { agentId?: string } | null;
  return b?.agentId;
}

export function tokenFor(id: string | undefined): string | undefined {
  return id ? read()[id] : undefined;
}

export function rememberToken(id: string, token: string): void {
  const map = read();
  map[id] = token;
  write(map);
}

/** True when this browser holds the secret for an agent, so it may act as it. */
export function owns(id: string): boolean {
  return Boolean(read()[id]);
}

export { HEADER as TOKEN_HEADER };
