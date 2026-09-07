#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "apps/web/dist/index.html");
const base = process.env.DISTRICT_BASE || process.env.BASE_PATH || "/district/";
const env = {
  ...process.env,
  SERVE_WEB: process.env.SERVE_WEB ?? "1",
  BASE_PATH: (process.env.BASE_PATH ?? "/district").replace(/\/$/, ""),
  DISTRICT_BASE: base.endsWith("/") ? base : `${base}/`,
};

function run(cmd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { cwd: root, stdio: "inherit", env, shell: process.platform === "win32" });
    child.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(" ")} -> ${code}`))));
  });
}

if (!existsSync(dist)) {
  await run("npm", ["run", "build", "-w", "@district/web"]);
}

const hub = spawn("npx", ["tsx", "apps/hub/src/index.ts"], {
  cwd: root,
  stdio: "inherit",
  env,
  shell: process.platform === "win32",
});
hub.on("exit", (code) => process.exit(code ?? 0));
