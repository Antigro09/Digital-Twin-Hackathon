#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const command = process.argv[2] ?? "help";
const extra = process.argv.slice(3);

function run(program, args, options = {}) {
  const result = spawnSync(program, args, { cwd: root, stdio: "inherit", shell: false, ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${program} ${args.join(" ")} exited with ${result.status}`);
}

function compose(...args) {
  run("docker", ["compose", "--file", "compose.yaml", ...args]);
}

async function waitFor(url, label, timeoutMs = 180_000) {
  const started = Date.now();
  process.stdout.write(`Waiting for ${label}`);
  while (Date.now() - started < timeoutMs) {
    try {
      const response = await fetch(url, { signal: AbortSignal.timeout(2_000) });
      if (response.ok) {
        process.stdout.write(" ready.\n");
        return;
      }
    } catch {}
    process.stdout.write(".");
    await new Promise((resolveWait) => setTimeout(resolveWait, 2_000));
  }
  process.stdout.write("\n");
  throw new Error(`${label} did not become ready within ${timeoutMs / 1000} seconds`);
}

async function post(url, body) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

async function seed() {
  const port = process.env.EDT_SYNC_PORT ?? "8090";
  const base = `http://127.0.0.1:${port}`;
  await waitFor(`${base}/healthz`, "synchronization worker");
  const aster = await post(`${base}/v1/sync/run`, { tenant_id: "10000000-0000-4000-8000-000000000001" });
  const beacon = await post(`${base}/v1/sync/run`, { tenant_id: "10000000-0000-4000-8000-000000000002" });
  process.stdout.write(`Seeded Aster (${aster.source_count} sources) and Beacon (${beacon.source_count} sources); external effects: 0.\n`);
}

async function start() {
  compose("up", "--detach", "--build", "--remove-orphans");
  const apiPort = process.env.EDT_API_PORT ?? "8080";
  const webPort = process.env.EDT_WEB_PORT ?? "3000";
  await waitFor(`http://127.0.0.1:${apiPort}/readyz`, "API");
  await waitFor(`http://127.0.0.1:${webPort}`, "web application");
  await seed();
  process.stdout.write(`Enterprise Digital Twin is ready: http://localhost:${webPort}\n`);
  process.stdout.write(`Temporal UI: http://localhost:${process.env.TEMPORAL_UI_PORT ?? "8233"}\n`);
}

function verifyWorkspace() {
  const required = ["compose.yaml", "docs/enterprise-digital-twin/manifest.yaml", "apps/api", "apps/web"];
  if (!required.every((item) => existsSync(resolve(root, item)))) throw new Error("Refusing operation outside the Enterprise Digital Twin workspace.");
}

async function main() {
  verifyWorkspace();
  switch (command) {
    case "start": await start(); break;
    case "seed": await seed(); break;
    case "verify": run(process.execPath, ["scripts/verify_live.mjs"], { env: { ...process.env, EDT_API_URL: process.env.EDT_API_URL ?? `http://127.0.0.1:${process.env.EDT_API_PORT ?? "8080"}` } }); break;
    case "test": run("npm", ["test"]); break;
    case "status": compose("ps"); break;
    case "logs": compose("logs", "--follow", "--tail", "200", ...extra); break;
    case "stop": compose("down", "--remove-orphans"); break;
    case "reset":
      if (!extra.includes("--yes")) throw new Error("Reset removes only this Compose project's synthetic volumes. Re-run as: node scripts/edt.mjs reset --yes");
      compose("down", "--volumes", "--remove-orphans");
      process.stdout.write("Removed Enterprise Digital Twin synthetic containers and named volumes.\n");
      break;
    case "help":
    default:
      process.stdout.write("Usage: node scripts/edt.mjs <start|seed|verify|test|status|logs|stop|reset --yes>\n");
      if (command !== "help") process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`edt: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
