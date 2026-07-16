import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DEMO_UNLOCK_COOKIE, issueDemoUnlockCookie } from "../local-demo-auth";
import { POST } from "./route";

const bootstrapKey = "test-bootstrap-key-with-more-than-thirty-two-characters";
const uiAccessKey = "test-ui-access-key-with-more-than-thirty-two-characters";

describe("trusted local demo auth BFF", () => {
  beforeEach(() => {
    process.env.EDT_DEMO_AUTH = "true";
    process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY = bootstrapKey;
    process.env.EDT_DEMO_UI_ACCESS_KEY = uiAccessKey;
    process.env.EDT_API_INTERNAL_URL = "http://api.internal:3000";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.EDT_DEMO_AUTH;
    delete process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY;
    delete process.env.EDT_DEMO_UI_ACCESS_KEY;
    delete process.env.EDT_API_INTERNAL_URL;
  });

  it("keeps the bootstrap credential server-side and returns only a short-lived actor session", async () => {
    const upstream = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(_input)).toBe("http://api.internal:3000/v1/demo-auth/sessions");
      expect(new Headers(init?.headers).get("x-demo-auth-key")).toBe(bootstrapKey);
      expect(init?.body).toBe(JSON.stringify({ actor_alias: "usr_aster_analyst" }));
      return Response.json({
        access_token: "header.claims.signature-for-local-demo",
        token_type: "Bearer",
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        expires_in: 600,
        actor_alias: "usr_aster_analyst",
      }, { status: 201 });
    });
    vi.stubGlobal("fetch", upstream);

    const response = await POST(requestFor("usr_aster_analyst"));
    const body = await response.text();
    expect(response.status).toBe(201);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(body).toContain("header.claims.signature-for-local-demo");
    expect(body).not.toContain(bootstrapKey);
    expect(upstream).toHaveBeenCalledOnce();
  });

  it("stays locked without a valid signed unlock cookie and never reaches the actor-token issuer", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const missing = await POST(requestFor("usr_aster_analyst", false));
    expect(missing.status).toBe(401);
    expect(await missing.json()).toMatchObject({ code: "demo_auth_locked" });
    expect(upstream).not.toHaveBeenCalled();

    const validCookie = unlockCookie();
    const replacement = validCookie.endsWith("A") ? "B" : "A";
    const tampered = requestFor("usr_aster_analyst");
    tampered.headers.set("cookie", `${DEMO_UNLOCK_COOKIE}=${validCookie.slice(0, -1)}${replacement}`);
    const tamperedResponse = await POST(tampered);
    expect(tamperedResponse.status).toBe(401);
    expect(await tamperedResponse.json()).toMatchObject({ code: "demo_auth_locked" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("fails closed unless the profile is explicitly enabled and fully configured", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);
    process.env.EDT_DEMO_AUTH = "false";

    const response = await POST(requestFor("usr_aster_analyst"));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "demo_auth_disabled" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("rejects unknown actors and never forwards an expansive identity request", async () => {
    const upstream = vi.fn();
    vi.stubGlobal("fetch", upstream);

    const response = await POST(requestFor("usr_platform_operator"));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ code: "invalid_demo_session_request" });
    expect(upstream).not.toHaveBeenCalled();
  });

  it("does not reflect upstream credential errors or malformed sessions", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ detail: `bad key ${bootstrapKey}` }, { status: 401 })));

    const response = await POST(requestFor("usr_aster_ops_approver"));
    const body = await response.text();
    expect(response.status).toBe(401);
    expect(body).toContain("demo_auth_exchange_failed");
    expect(body).not.toContain(bootstrapKey);
  });
});

function requestFor(actorAlias: string, unlocked = true): Request {
  const cookie = unlockCookie();
  return new Request("http://localhost/api/demo-auth/session", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(unlocked ? { Cookie: `${DEMO_UNLOCK_COOKIE}=${cookie}` } : {}),
    },
    body: JSON.stringify({ actor_alias: actorAlias }),
  });
}

function unlockCookie(): string {
  return issueDemoUnlockCookie({
    apiUrl: "http://api.internal:3000",
    bootstrapKey,
    uiAccessKey,
  }).value;
}
