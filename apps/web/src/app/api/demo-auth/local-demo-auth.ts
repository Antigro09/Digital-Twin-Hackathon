import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { NextResponse } from "next/server";

export const DEMO_UNLOCK_COOKIE = "edt_demo_unlock";
export const DEMO_UNLOCK_TTL_SECONDS = 15 * 60;

export type DemoAuthConfiguration = {
  apiUrl: string;
  bootstrapKey: string;
  uiAccessKey: string;
};

export type DemoAuthConfigurationResult =
  | { ok: true; value: DemoAuthConfiguration }
  | { ok: false; code: string; detail: string };

export function demoAuthConfiguration(): DemoAuthConfigurationResult {
  if (process.env.EDT_DEMO_AUTH !== "true") {
    return {
      ok: false,
      code: "demo_auth_disabled",
      detail: "Trusted local-demo authentication is not explicitly enabled.",
    };
  }

  const bootstrapKey = process.env.EDT_DEMO_AUTH_BOOTSTRAP_KEY ?? "";
  const uiAccessKey = process.env.EDT_DEMO_UI_ACCESS_KEY ?? "";
  if (bootstrapKey.length < 32 || uiAccessKey.length < 32) {
    return {
      ok: false,
      code: "demo_auth_not_configured",
      detail: "Trusted local-demo authentication is not configured.",
    };
  }

  const configuredApiUrl = process.env.EDT_API_INTERNAL_URL ?? "";
  try {
    const parsed = new URL(configuredApiUrl);
    if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error("invalid URL");
    }
    return {
      ok: true,
      value: {
        apiUrl: parsed.toString().replace(/\/$/, ""),
        bootstrapKey,
        uiAccessKey,
      },
    };
  } catch {
    return {
      ok: false,
      code: "demo_auth_not_configured",
      detail: "The internal API endpoint for trusted local-demo authentication is invalid.",
    };
  }
}

export function safelyMatchesAccessKey(candidate: string, configured: string): boolean {
  const candidateDigest = createHash("sha256").update(candidate, "utf8").digest();
  const configuredDigest = createHash("sha256").update(configured, "utf8").digest();
  return timingSafeEqual(candidateDigest, configuredDigest);
}

export function issueDemoUnlockCookie(configuration: DemoAuthConfiguration, now = Date.now()): {
  value: string;
  expiresAt: Date;
} {
  const expiresAtSeconds = Math.floor(now / 1_000) + DEMO_UNLOCK_TTL_SECONDS;
  const nonce = randomBytes(18).toString("base64url");
  const payload = `v1.${expiresAtSeconds}.${nonce}`;
  return {
    value: `${payload}.${sign(payload, configuration)}`,
    expiresAt: new Date(expiresAtSeconds * 1_000),
  };
}

export function hasValidDemoUnlockCookie(request: Request, configuration: DemoAuthConfiguration, now = Date.now()): boolean {
  const cookie = readSingleCookie(request.headers.get("cookie"), DEMO_UNLOCK_COOKIE);
  if (!cookie) return false;

  const parts = cookie.split(".");
  if (parts.length !== 4 || parts[0] !== "v1" || !/^\d{10}$/.test(parts[1]) || !/^[A-Za-z0-9_-]{20,40}$/.test(parts[2])) {
    return false;
  }
  const expiresAtSeconds = Number(parts[1]);
  const nowSeconds = Math.floor(now / 1_000);
  if (!Number.isSafeInteger(expiresAtSeconds)
    || expiresAtSeconds <= nowSeconds
    || expiresAtSeconds > nowSeconds + DEMO_UNLOCK_TTL_SECONDS + 5) {
    return false;
  }

  const payload = parts.slice(0, 3).join(".");
  const expected = Buffer.from(sign(payload, configuration), "base64url");
  let actual: Buffer;
  try {
    actual = Buffer.from(parts[3], "base64url");
  } catch {
    return false;
  }
  if (actual.toString("base64url") !== parts[3]) return false;
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function setDemoUnlockCookie(response: NextResponse, request: Request, value: string, expiresAt: Date): void {
  response.cookies.set({
    name: DEMO_UNLOCK_COOKIE,
    value,
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: DEMO_UNLOCK_TTL_SECONDS,
    expires: expiresAt,
  });
}

export function clearDemoUnlockCookie(response: NextResponse, request: Request): void {
  response.cookies.set({
    name: DEMO_UNLOCK_COOKIE,
    value: "",
    httpOnly: true,
    sameSite: "strict",
    secure: isSecureRequest(request),
    path: "/",
    maxAge: 0,
    expires: new Date(0),
  });
}

function sign(payload: string, configuration: DemoAuthConfiguration): string {
  const signingKey = createHmac("sha256", configuration.bootstrapKey)
    .update("edt-local-demo-ui-cookie-v1\0", "utf8")
    .update(createHash("sha256").update(configuration.uiAccessKey, "utf8").digest())
    .digest();
  return createHmac("sha256", signingKey).update(payload, "utf8").digest("base64url");
}

function readSingleCookie(header: string | null, name: string): string | undefined {
  if (!header || header.length > 8_192) return undefined;
  const matches = header
    .split(";")
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
    .map((part) => part.slice(name.length + 1));
  return matches.length === 1 ? matches[0] : undefined;
}

function isSecureRequest(request: Request): boolean {
  const forwardedProtocol = request.headers.get("x-forwarded-proto")?.split(",", 1)[0]?.trim().toLowerCase();
  return forwardedProtocol === "https" || new URL(request.url).protocol === "https:";
}
