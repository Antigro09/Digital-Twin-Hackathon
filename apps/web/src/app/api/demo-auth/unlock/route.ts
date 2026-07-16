import { NextResponse } from "next/server";
import {
  demoAuthConfiguration,
  issueDemoUnlockCookie,
  safelyMatchesAccessKey,
  setDemoUnlockCookie,
} from "../local-demo-auth";

export const runtime = "nodejs";

export async function POST(request: Request): Promise<NextResponse> {
  const configuration = demoAuthConfiguration();
  if (!configuration.ok) return problem(503, configuration.code, configuration.detail);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return problem(400, "invalid_demo_unlock_request", "The request body must be valid JSON.");
  }
  if (!isExactUnlockRequest(body)) {
    return problem(400, "invalid_demo_unlock_request", "Enter the local demo access key.");
  }
  if (!safelyMatchesAccessKey(body.access_key, configuration.value.uiAccessKey)) {
    return problem(401, "demo_auth_unlock_denied", "The local demo access key was not accepted.");
  }

  const cookie = issueDemoUnlockCookie(configuration.value);
  const response = NextResponse.json({
    unlocked: true,
    expires_at: cookie.expiresAt.toISOString(),
  }, {
    status: 200,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
  setDemoUnlockCookie(response, request, cookie.value, cookie.expiresAt);
  return response;
}

function isExactUnlockRequest(value: unknown): value is { access_key: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1
    && typeof record.access_key === "string"
    && record.access_key.length > 0
    && record.access_key.length <= 512;
}

function problem(status: number, code: string, detail: string): NextResponse {
  return NextResponse.json({
    type: "about:blank",
    title: "Local demo unlock failed",
    status,
    code,
    detail,
  }, {
    status,
    headers: { "Cache-Control": "private, no-store, max-age=0" },
  });
}
