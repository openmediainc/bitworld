import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { backupData } from "./persist.js";

const roots: string[] = [];

function tempDir(name: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `district-${name}-`));
  roots.push(dir);
  return dir;
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

describe("campus backups", () => {
  it("copies complete JSON snapshots and ignores partial files", () => {
    const data = tempDir("data");
    const backups = tempDir("backups");
    fs.writeFileSync(path.join(data, "world.json"), '{"ok":true}');
    fs.writeFileSync(path.join(data, "world.json.tmp"), "partial");

    const made = backupData(data, backups);

    expect(JSON.parse(fs.readFileSync(path.join(made, "world.json"), "utf8"))).toEqual({ ok: true });
    expect(fs.existsSync(path.join(made, "world.json.tmp"))).toBe(false);
  });

  it("rotates old complete snapshots", () => {
    const data = tempDir("data");
    const backups = tempDir("backups");
    fs.writeFileSync(path.join(data, "world.json"), "{}");
    for (const stamp of ["20260101T000000Z", "20260102T000000Z", "20260103T000000Z"]) {
      fs.mkdirSync(path.join(backups, `district-data-${stamp}`));
    }

    backupData(data, backups, 2);

    const complete = fs.readdirSync(backups).filter((name) => name.startsWith("district-data-"));
    expect(complete).toHaveLength(2);
    expect(complete).not.toContain("district-data-20260101T000000Z");
  });
});
