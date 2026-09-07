#!/usr/bin/env node
const hub = process.env.HUB_URL ?? "http://127.0.0.1:4242";
const res = await fetch(`${hub}/api/sim/start`, { method: "POST" });
const body = await res.text();
console.log(body);
if (!res.ok) process.exit(1);
