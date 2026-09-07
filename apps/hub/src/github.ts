import crypto from "node:crypto";
import type { MissionResource } from "@district/shared";

type GitHubAction =
  | "issues:read"
  | "issues:comment"
  | "contents:read"
  | "contents:write"
  | "branches:create"
  | "pull_requests:create";

type CachedToken = { token: string; expiresAt: number };

function fail(message: string, statusCode = 400): never {
  throw Object.assign(new Error(message), { statusCode });
}

function string(input: Record<string, unknown>, key: string, required = true): string | undefined {
  const value = input[key];
  if (typeof value === "string" && value.length > 0) return value;
  if (required) fail(`${key} is required`);
  return undefined;
}

function integer(input: Record<string, unknown>, key: string): number {
  const value = input[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    fail(`${key} must be a positive integer`);
  }
  return value;
}

function repository(resource: MissionResource): { owner: string; repo: string } {
  const url = new URL(resource.url);
  if (url.hostname !== "github.com") fail("GitHub actions require a github.com resource");
  const [owner, rawRepo] = url.pathname.split("/").filter(Boolean);
  const repo = rawRepo?.replace(/\.git$/, "");
  if (!owner || !repo) fail("resource must point to a GitHub repository");
  return { owner, repo };
}

function contentPath(input: Record<string, unknown>): string {
  const value = string(input, "path")!;
  const segments = value.split("/");
  if (
    value.startsWith("/") ||
    value.length > 1000 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    fail("path must be a relative repository path without dot segments");
  }
  return segments.map(encodeURIComponent).join("/");
}

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

export class GitHubConnector {
  private tokens = new Map<number, CachedToken>();

  configured(): boolean {
    return Boolean(process.env.GITHUB_APP_ID && process.env.GITHUB_APP_PRIVATE_KEY);
  }

  async execute(
    resource: MissionResource,
    action: GitHubAction,
    input: Record<string, unknown>,
  ): Promise<unknown> {
    if (!this.configured()) fail("GitHub connector is disabled on this hub", 503);
    if (!resource.providerInstallationId) {
      fail("resource has no GitHub App installation id", 409);
    }
    const { owner, repo } = repository(resource);
    const token = await this.installationToken(resource.providerInstallationId);
    let method = "GET";
    let endpoint = "";
    let body: Record<string, unknown> | undefined;

    if (action === "issues:read") {
      endpoint = `/repos/${owner}/${repo}/issues/${integer(input, "number")}`;
    } else if (action === "issues:comment") {
      method = "POST";
      endpoint = `/repos/${owner}/${repo}/issues/${integer(input, "number")}/comments`;
      body = { body: string(input, "body") };
    } else if (action === "contents:read") {
      endpoint = `/repos/${owner}/${repo}/contents/${contentPath(input)}`;
      const ref = string(input, "ref", false);
      if (ref) endpoint += `?ref=${encodeURIComponent(ref)}`;
    } else if (action === "contents:write") {
      method = "PUT";
      endpoint = `/repos/${owner}/${repo}/contents/${contentPath(input)}`;
      const content = input.contentBase64;
      if (typeof content !== "string") fail("contentBase64 is required");
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(content) || content.length % 4 !== 0) {
        fail("contentBase64 must be valid base64");
      }
      body = {
        message: string(input, "message"),
        content,
        branch: string(input, "branch"),
        ...(string(input, "sha", false) ? { sha: string(input, "sha", false) } : {}),
      };
    } else if (action === "branches:create") {
      method = "POST";
      endpoint = `/repos/${owner}/${repo}/git/refs`;
      body = {
        ref: `refs/heads/${string(input, "name")}`,
        sha: string(input, "fromSha"),
      };
    } else {
      method = "POST";
      endpoint = `/repos/${owner}/${repo}/pulls`;
      body = {
        title: string(input, "title"),
        head: string(input, "head"),
        base: string(input, "base"),
        body: string(input, "body", false),
      };
    }

    const response = await fetch(`https://api.github.com${endpoint}`, {
      method,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "District-Agent-Economy",
        "x-github-api-version": "2022-11-28",
      },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    const result = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) fail(`GitHub ${response.status}: ${result.message ?? "request failed"}`, response.status);
    return result;
  }

  private async installationToken(installationId: number): Promise<string> {
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await fetch(
      `https://api.github.com/app/installations/${installationId}/access_tokens`,
      {
        method: "POST",
        headers: {
          accept: "application/vnd.github+json",
          authorization: `Bearer ${this.appJwt()}`,
          "user-agent": "District-Agent-Economy",
          "x-github-api-version": "2022-11-28",
        },
        signal: AbortSignal.timeout(15_000),
      },
    );
    const body = (await response.json().catch(() => ({}))) as {
      token?: string;
      expires_at?: string;
      message?: string;
    };
    if (!response.ok || !body.token || !body.expires_at) {
      fail(`GitHub App token failed: ${body.message ?? response.status}`, 502);
    }
    const token = { token: body.token, expiresAt: Date.parse(body.expires_at) };
    this.tokens.set(installationId, token);
    return token.token;
  }

  private appJwt(): string {
    const appId = process.env.GITHUB_APP_ID;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY?.replaceAll("\\n", "\n");
    if (!appId || !privateKey) fail("GitHub connector is disabled", 503);
    const now = Math.floor(Date.now() / 1000);
    const header = base64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64url(JSON.stringify({ iat: now - 30, exp: now + 9 * 60, iss: appId }));
    const unsigned = `${header}.${payload}`;
    const signature = crypto.sign("RSA-SHA256", Buffer.from(unsigned), privateKey);
    return `${unsigned}.${base64url(signature)}`;
  }
}
