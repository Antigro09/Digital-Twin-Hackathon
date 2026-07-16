import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LocalDemoUnlock } from "./LocalDemoUnlock";

describe("LocalDemoUnlock", () => {
  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    localStorage.clear();
    sessionStorage.clear();
  });

  it("submits the key once, clears the field, and never writes browser storage", async () => {
    const accessKey = "operator-entered-local-demo-key";
    const onUnlocked = vi.fn();
    const storageWrite = vi.spyOn(Storage.prototype, "setItem");
    const request = vi.fn(async (_input: RequestInfo | URL, _options?: RequestInit) => Response.json({ unlocked: true }, { status: 200 }));
    vi.stubGlobal("fetch", request);
    const user = userEvent.setup();
    render(<LocalDemoUnlock onUnlocked={onUnlocked} />);

    const input = screen.getByLabelText("Local demo access key");
    await user.type(input, accessKey);
    await user.click(screen.getByRole("button", { name: "Unlock and connect" }));

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledOnce());
    expect(input).toHaveValue("");
    expect(request).toHaveBeenCalledOnce();
    const [url, options] = request.mock.calls[0];
    expect(url).toBe("/api/demo-auth/unlock");
    expect(options).toMatchObject({ method: "POST", credentials: "same-origin", cache: "no-store" });
    expect(options?.body).toBe(JSON.stringify({ access_key: accessKey }));
    expect(storageWrite).not.toHaveBeenCalled();
    expect(localStorage.length).toBe(0);
    expect(sessionStorage.length).toBe(0);
  });

  it("shows a generic denial and keeps the rejected key out of the rendered page", async () => {
    const rejectedKey = "do-not-render-this-rejected-key";
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({
      code: "demo_auth_unlock_denied",
      detail: "The local demo access key was not accepted.",
    }, { status: 401 })));
    const user = userEvent.setup();
    render(<LocalDemoUnlock onUnlocked={vi.fn()} />);

    await user.type(screen.getByLabelText("Local demo access key"), rejectedKey);
    await user.click(screen.getByRole("button", { name: "Unlock and connect" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("The local demo access key was not accepted.");
    expect(document.body).not.toHaveTextContent(rejectedKey);
  });
});
