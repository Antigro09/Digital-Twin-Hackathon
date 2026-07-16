import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST } from "./route";

const bootstrapKey = "test-bootstrap-key-with-more-than-thirty-two-characters";
const uiAccessKey = "test-ui-access-key-with-more-than-thirty-two-characters";

describe("trusted local demo unlock BFF", () => {
  beforeEach(() => {
    process.env.EDT_DEMO_AUTH = "true";
    process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY = bootstrapKey;
    process.env.EDT_DEMO_UI_ACCESS_KEY = uiAccessKey;
    process.env.EDT_API_INTERNAL_URL = "http://api.internal:3000";
  });

  afterEach(() => {
    delete process.env.EDT_DEMO_AUTH;
    delete process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY;
    delete process.env.EDT_DEMO_UI_ACCESS_KEY;
    delete process.env.EDT_API_INTERNAL_URL;
  });

  it("sets a short-lived signed HttpOnly Strict cookie without reflecting the key", async () => {
    const response = await POST(requestFor(uiAccessKey));
    const body = await response.text();
    const cookie = response.headers.get("set-cookie") ?? "";

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(cookie).toContain("edt_demo_unlock=");
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=strict");
    expect(cookie).toContain("Path=/");
    expect(cookie).toContain("Max-Age=900");
    expect(cookie).not.toContain("Secure");
    expect(body).not.toContain(uiAccessKey);
    expect(body).not.toContain(bootstrapKey);
  });

  it("marks the cookie Secure when the browser-facing request is HTTPS", async () => {
    const response = await POST(requestFor(uiAccessKey, "https://localhost/api/demo-auth/unlock"));
    expect(response.headers.get("set-cookie")).toContain("Secure");
  });

  it("compares the access key exactly and rejects malformed or expansive input", async () => {
    const denied = await POST(requestFor(`${uiAccessKey}-wrong`));
    expect(denied.status).toBe(401);
    expect(await denied.json()).toMatchObject({ code: "demo_auth_unlock_denied" });
    expect(denied.headers.get("set-cookie")).toBeNull();

    const expansive = await POST(new Request("http://localhost/api/demo-auth/unlock", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ access_key: uiAccessKey, actor_alias: "usr_aster_analyst" }),
    }));
    expect(expansive.status).toBe(400);
    expect(await expansive.json()).toMatchObject({ code: "invalid_demo_unlock_request" });
  });

  it("fails closed unless trusted local demo auth is explicitly enabled", async () => {
    process.env.EDT_DEMO_AUTH = "false";
    const response = await POST(requestFor(uiAccessKey));
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ code: "demo_auth_disabled" });
    expect(response.headers.get("set-cookie")).toBeNull();
  });
});

function requestFor(accessKey: string, url = "http://localhost/api/demo-auth/unlock"): Request {
  return new Request(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ access_key: accessKey }),
  });
}
