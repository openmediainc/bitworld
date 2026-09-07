#!/usr/bin/env node
const hub = process.env.HUB_URL ?? "http://127.0.0.1:4242";
const adminKey = process.env.DISTRICT_ADMIN_KEY ?? "";
if (!adminKey) {
  console.error("set DISTRICT_ADMIN_KEY (same value as the hub's) — sim control is not public");
  process.exit(1);
}
const res = await fetch(`${hub}/api/sim/start`, {
  method: "POST",
  headers: { "x-admin-key": adminKey },
});
const body = await res.text();
console.log(body);
if (!res.ok) process.exit(1);
