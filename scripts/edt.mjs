#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
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

async function nativeAiWorkerReady(port) {
  try {
    return (await fetch(`http://127.0.0.1:${port}/health/ready`, { signal: AbortSignal.timeout(1_000) })).ok;
  } catch {
    return false;
  }
}

async function startNativeAiWorker() {
  const port = process.env.EDT_AI_PORT ?? "8010";
  if (await nativeAiWorkerReady(port)) return true;
  if (process.platform !== "win32") {
    process.stderr.write("Native AI worker was not started automatically on this platform. Run the equivalent local Python launcher before using AI features.\n");
    return false;
  }
  const result = spawnSync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", "scripts/start-ai-worker.ps1", "-Background", "-Port", port], { cwd: root, stdio: "inherit", shell: false });
  if (result.error || result.status !== 0) {
    process.stderr.write("Native AI worker was not started. Install Python 3.12, then run npm run ai:local in a separate PowerShell window.\n");
    return false;
  }
  try {
    await waitFor(`http://127.0.0.1:${port}/health/ready`, "native AI worker", 90_000);
    return true;
  } catch {
    process.stderr.write("Native AI worker did not become ready. Start it with npm run ai:local and inspect its local logs.\n");
    return false;
  }
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

async function post(url, body, headers = {}) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
  const value = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(`${url} returned ${response.status}: ${JSON.stringify(value)}`);
  return value;
}

function ensureLocalDemoAuth() {
  const envPath = resolve(root, ".env");
  const source = existsSync(envPath) ? readFileSync(envPath, "utf8") : "";
  const fromFile = (name) => {
    const matches = [...source.matchAll(new RegExp(`^${name}=(.*)$`, "gm"))];
    return matches.at(-1)?.[1]?.trim().replace(/^(["'])(.*)\1$/, "$2") ?? "";
  };
  const credentialNames = ["EDT_DEMO_AUTH_SECRET", "EDT_DEMO_AUTH_BOOTSTRAP_KEY", "EDT_DEMO_UI_ACCESS_KEY", "AI_WORKER_SHARED_SECRET", "AI_DATABASE_PASSWORD"];
  const generated = [];
  for (const name of credentialNames) {
    let value = process.env[name] ?? fromFile(name);
    if (!value) {
      value = randomBytes(48).toString("base64url");
      generated.push(`${name}=${value}`);
    } else if (value.length < 32) {
      throw new Error(`${name} must contain at least 32 characters.`);
    }
    process.env[name] = value;
  }
  // Compose reads the first duplicate variable while this helper historically
  // read the last. Normalize the ignored local .env to one authoritative entry
  // per credential so UI unlock and service startup always use the same values.
  const credentialPattern = new RegExp(`^(?:${credentialNames.join("|")})=.*(?:\\r?\\n|$)`, "gm");
  const normalized = source.replace(credentialPattern, "").trimEnd();
  const credentialBlock = credentialNames.map((name) => `${name}=${process.env[name]}`).join("\n");
  writeFileSync(envPath, `${normalized}\n\n# Generated local-demo authentication and internal-service credentials. Do not commit this file.\n${credentialBlock}\n`, { encoding: "utf8", mode: 0o600 });
  if (generated.length) process.stdout.write("Generated signed local-demo authentication and internal-service credentials in the ignored .env file.\n");
}

async function issueDemoToken(actorAlias) {
  if (!actorAlias) throw new Error("Provide a fixture actor alias, for example: npm run demo:token -- usr_aster_analyst");
  ensureLocalDemoAuth();
  const port = process.env.EDT_API_PORT ?? "8080";
  const session = await post(
    `http://127.0.0.1:${port}/v1/demo-auth/sessions`,
    { actor_alias: actorAlias },
    { "x-demo-auth-key": process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY },
  );
  process.stdout.write(`${session.access_token}\n`);
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
  ensureLocalDemoAuth();
  compose("up", "--detach", "--build", "--remove-orphans");
  const apiPort = process.env.EDT_API_PORT ?? "8080";
  const webPort = process.env.EDT_WEB_PORT ?? "3000";
  await waitFor(`http://127.0.0.1:${apiPort}/readyz`, "API");
  await startNativeAiWorker();
  await waitFor(`http://127.0.0.1:${webPort}`, "web application");
  await seed();
  process.stdout.write(`Enterprise Digital Twin is ready: http://localhost:${webPort}\n`);
  process.stdout.write("AI runs natively on this machine; it is not a Docker service.\n");
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
    case "verify":
      ensureLocalDemoAuth();
      run(process.execPath, ["scripts/verify_live.mjs"], { env: { ...process.env, EDT_API_URL: process.env.EDT_API_URL ?? `http://127.0.0.1:${process.env.EDT_API_PORT ?? "8080"}` } });
      break;
    case "auth-token": await issueDemoToken(extra[0]); break;
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
      process.stdout.write("Usage: node scripts/edt.mjs <start|seed|verify|auth-token ACTOR|test|status|logs|stop|reset --yes>\nNative AI: npm run ai:local (foreground) or npm run ai:start (background).\n");
      if (command !== "help") process.exitCode = 2;
  }
}

main().catch((error) => {
  process.stderr.write(`edt: ${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
