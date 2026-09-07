import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

/**
 * Per-agent ownership. Spawning stays open to anyone — the first claim on an
 * agent id mints a secret, and only the holder of that secret may act as that
 * agent afterwards. No accounts, no login, no shared key.
 *
 * Tokens are stored hashed and never leave the hub except once, in the
 * `x-district-token` response header of the request that claimed them.
 */
export type OwnerRecord = { hash: string; issuedAt: number };

const TOKEN_HEADER = "x-district-token";

function sha256(v: string): string {
  return crypto.createHash("sha256").update(v).digest("hex");
}

function equal(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

function parseRecords(raw: string): Map<string, OwnerRecord> {
  const parsed = JSON.parse(raw) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("token store must be an object");
  }
  const records = new Map<string, OwnerRecord>();
  for (const [id, value] of Object.entries(parsed)) {
    const rec = value as Partial<OwnerRecord> | null;
    if (
      !rec ||
      typeof rec.hash !== "string" ||
      !/^[a-f0-9]{64}$/.test(rec.hash) ||
      typeof rec.issuedAt !== "number" ||
      !Number.isFinite(rec.issuedAt)
    ) {
      throw new Error(`invalid token record for ${id}`);
    }
    records.set(id, { hash: rec.hash, issuedAt: rec.issuedAt });
  }
  return records;
}

export class OwnerStore {
  private owners = new Map<string, OwnerRecord>();
  private file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "tokens.json");
    this.load();
  }

  private load(): void {
    if (!fs.existsSync(this.file)) return;
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      this.owners = parseRecords(raw);
    } catch (error) {
      throw new Error(`could not load agent ownership tokens from ${this.file}`, { cause: error });
    }
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.owners), null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  has(id: string): boolean {
    return this.owners.has(id);
  }

  /** Mint a token for an unclaimed id. Returns undefined if already owned. */
  claim(id: string): string | undefined {
    if (this.owners.has(id)) return undefined;
    const token = crypto.randomBytes(24).toString("base64url");
    this.owners.set(id, { hash: sha256(token), issuedAt: Date.now() });
    try {
      this.save();
    } catch (error) {
      this.owners.delete(id);
      throw error;
    }
    return token;
  }

  verify(id: string, token: string): boolean {
    const rec = this.owners.get(id);
    if (!rec || !token) return false;
    return equal(rec.hash, sha256(token));
  }

  /** Called on despawn so a retired id can be claimed again. */
  release(id: string): void {
    const record = this.owners.get(id);
    if (!record) return;
    this.owners.delete(id);
    try {
      this.save();
    } catch (error) {
      this.owners.set(id, record);
      throw error;
    }
  }
}

/** Durable human principal tokens. Unlike agent ownership, these are never
 * released on disconnect because builder identity must survive browser sessions. */
export class BuilderTokenStore {
  private owners = new Map<string, OwnerRecord>();
  private file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "builder-tokens.json");
    if (!fs.existsSync(this.file)) return;
    try {
      this.owners = parseRecords(fs.readFileSync(this.file, "utf8"));
    } catch (error) {
      throw new Error(`could not load builder tokens from ${this.file}`, { cause: error });
    }
  }

  issue(id: string): string {
    if (this.owners.has(id)) throw new Error("builder already has a token");
    return this.replace(id);
  }

  rotate(id: string): string {
    if (!this.owners.has(id)) throw new Error("builder has no token");
    return this.replace(id);
  }

  private replace(id: string): string {
    const token = crypto.randomBytes(32).toString("base64url");
    const previous = this.owners.get(id);
    this.owners.set(id, { hash: sha256(token), issuedAt: Date.now() });
    try {
      this.save();
    } catch (error) {
      if (previous) this.owners.set(id, previous);
      else this.owners.delete(id);
      throw error;
    }
    return token;
  }

  verify(id: string, token: string): boolean {
    const record = this.owners.get(id);
    return Boolean(record && token && equal(record.hash, sha256(token)));
  }

  private save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.owners), null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}

export const BUILDER_ID_HEADER = "x-builder-id";
export const BUILDER_TOKEN_HEADER = "x-builder-token";
export { TOKEN_HEADER };
