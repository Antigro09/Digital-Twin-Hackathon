import { NextResponse } from "next/server";
import {
  clearDemoUnlockCookie,
  demoAuthConfiguration,
  hasValidDemoUnlockCookie,
} from "../local-demo-auth";

export const runtime = "nodejs";

const ALLOWED_ACTORS = new Set([
  "usr_aster_analyst",
  "usr_beacon_analyst",
  "usr_aster_ops_approver",
  "usr_aster_security_approver",
  "usr_aster_admin",
]);

type DemoSession = {
  access_token: string;
  token_type: "Bearer";
  expires_at: string;
  expires_in: number;
  actor_alias: string;
};

export async function POST(request: Request): Promise<NextResponse> {
  const configuration = demoAuthConfiguration();
  if (!configuration.ok) return problem(503, configuration.code, configuration.detail);
  if (!hasValidDemoUnlockCookie(request, configuration.value)) {
    const response = problem(401, "demo_auth_locked", "Unlock the trusted local demo before requesting an actor session.");
    clearDemoUnlockCookie(response, request);
    return response;
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_demo_session_request", "The request body must be valid JSON.");
  }
  if (!isExactActorRequest(body)) {
    return problem(400, "invalid_demo_session_request", "The request must contain one allowed actor_alias.");
  }

  try {
    const upstream = await fetch(`${configuration.value.apiUrl}/v1/demo-auth/sessions`, {
      method: "POST",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Demo-Auth-Key": configuration.value.bootstrapKey,
      },
      body: JSON.stringify({ actor_alias: body.actor_alias }),
      signal: AbortSignal.timeout(5_000),
    });
    const payload = await upstream.json().catch(() => undefined) as unknown;
    if (!upstream.ok || !isDemoSession(payload, body.actor_alias)) {
      return problem(upstream.status === 401 ? 401 : 502, "demo_auth_exchange_failed", "The trusted local-demo session exchange failed closed.");
    }
    return NextResponse.json(payload, {
      status: 201,
      headers: { "Cache-Control": "private, no-store, max-age=0" },
    });
  } catch {
    return problem(502, "demo_auth_exchange_unavailable", "The trusted local-demo session exchange is unavailable.");
  }
}

function isExactActorRequest(value: unknown): value is { actor_alias: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && typeof record.actor_alias === "string" && ALLOWED_ACTORS.has(record.actor_alias);
}

function isDemoSession(value: unknown, actorAlias: string): value is DemoSession {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const session = value as Record<string, unknown>;
  return typeof session.access_token === "string"
    && session.access_token.length > 20
    && session.token_type === "Bearer"
    && session.actor_alias === actorAlias
    && typeof session.expires_at === "string"
    && Number.isFinite(Date.parse(session.expires_at))
    && typeof session.expires_in === "number"
    && Number.isSafeInteger(session.expires_in)
    && session.expires_in > 0
    && session.expires_in <= 15 * 60;
}

function problem(status: number, code: string, detail: string): NextResponse {
  return NextResponse.json({ type: "about:blank", title: "Local demo authentication failed", status, code, detail }, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
