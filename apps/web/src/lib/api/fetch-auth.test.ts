import { afterEach, describe, expect, it, vi } from "vitest";
import { browserDemoTokenProvider, DemoTokenProvider, FetchDigitalTwinApi } from "./client";

describe("FetchDigitalTwinApi trusted local demo authentication", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("caches a short-lived token per actor and sends only Authorization Bearer", async () => {
    const tokenProvider = vi.fn<DemoTokenProvider>(async (actorAlias) => ({
      accessToken: `signed-token-for-${actorAlias}`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }));
    const requests: Array<{ url: string; headers: Headers }> = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push({ url: String(input), headers: new Headers(init?.headers) });
      return Response.json({ capabilities: ["evidence.read.aster_orion", "scenario.create", "simulation.run"] });
    }));
    const api = new FetchDigitalTwinApi("http://api.local", tokenProvider);

    await Promise.all([api.getActorContext(), api.getActorContext()]);
    await api.getActorContext();
    expect(tokenProvider).toHaveBeenCalledTimes(1);
    expect(requests.every((request) => request.headers.get("authorization") === "Bearer signed-token-for-usr_aster_analyst")).toBe(true);
    expect(requests.every((request) => !request.headers.has("x-demo-actor"))).toBe(true);

    await api.selectMembership("mem_beacon_observer");
    expect(tokenProvider).toHaveBeenLastCalledWith("usr_beacon_analyst", undefined);
    expect(requests.at(-1)?.headers.get("authorization")).toBe("Bearer signed-token-for-usr_beacon_analyst");
  });

  it("refreshes once after an unauthorized response without changing the request payload", async () => {
    let tokenNumber = 0;
    const tokenProvider = vi.fn<DemoTokenProvider>(async () => ({
      accessToken: `signed-token-${++tokenNumber}`,
      expiresAt: new Date(Date.now() + 10 * 60_000).toISOString(),
    }));
    const authorizations: string[] = [];
    vi.stubGlobal("fetch", vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      authorizations.push(new Headers(init?.headers).get("authorization") ?? "");
      return authorizations.length === 1
        ? Response.json({ code: "demo_token_expired", detail: "expired" }, { status: 401 })
        : Response.json({ capabilities: ["evidence.read.aster_orion", "scenario.create", "simulation.run"] });
    }));

    await new FetchDigitalTwinApi("http://api.local", tokenProvider).getActorContext();
    expect(tokenProvider).toHaveBeenCalledTimes(2);
    expect(authorizations).toEqual(["Bearer signed-token-1", "Bearer signed-token-2"]);
  });

  it("uses the same-origin BFF and never includes a bootstrap credential in browser requests", async () => {
    const requestHeaders: Headers[] = [];
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toBe("/api/demo-auth/session");
      requestHeaders.push(new Headers(init?.headers));
      expect(init?.body).toBe(JSON.stringify({ actor_alias: "usr_aster_security_approver" }));
      return Response.json({
        access_token: "signed-browser-session-token",
        token_type: "Bearer",
        expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
        actor_alias: "usr_aster_security_approver",
      }, { status: 201 });
    }));

    const token = await browserDemoTokenProvider("usr_aster_security_approver");
    expect(token.accessToken).toBe("signed-browser-session-token");
    expect(requestHeaders[0].has("x-demo-auth-key")).toBe(false);
    expect(JSON.stringify([...requestHeaders[0].entries()])).not.toContain("bootstrap");
  });
});
