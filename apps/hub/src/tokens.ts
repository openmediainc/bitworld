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

export class OwnerStore {
  private owners = new Map<string, OwnerRecord>();
  private file: string;

  constructor(dir: string) {
    this.file = path.join(dir, "tokens.json");
    this.load();
  }

  private load(): void {
    try {
      const raw = fs.readFileSync(this.file, "utf8");
      const parsed = JSON.parse(raw) as Record<string, OwnerRecord>;
      for (const [id, rec] of Object.entries(parsed)) {
        if (rec && typeof rec.hash === "string") this.owners.set(id, rec);
      }
    } catch {
      /* no store yet — every id is unclaimed */
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(Object.fromEntries(this.owners), null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
    } catch (e) {
      console.error("[district] could not persist agent tokens", e);
    }
  }

  has(id: string): boolean {
    return this.owners.has(id);
  }

  /** Mint a token for an unclaimed id. Returns undefined if already owned. */
  claim(id: string): string | undefined {
    if (this.owners.has(id)) return undefined;
    const token = crypto.randomBytes(24).toString("base64url");
    this.owners.set(id, { hash: sha256(token), issuedAt: Date.now() });
    this.save();
    return token;
  }

  verify(id: string, token: string): boolean {
    const rec = this.owners.get(id);
    if (!rec || !token) return false;
    return equal(rec.hash, sha256(token));
  }

  /** Called on despawn so a retired id can be claimed again. */
  release(id: string): void {
    if (this.owners.delete(id)) this.save();
  }
}

export { TOKEN_HEADER };
