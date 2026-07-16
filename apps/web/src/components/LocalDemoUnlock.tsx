"use client";

import { FormEvent, useState } from "react";
import { Button } from "./ui";

export function LocalDemoUnlock({ onUnlocked }: { onUnlocked: () => void | Promise<void> }) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string>();

  async function unlock(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const accessKey = String(new FormData(form).get("local-demo-access-key") ?? "");
    form.reset();
    setProblem(undefined);
    if (!accessKey) {
      setProblem("Enter the local demo access key.");
      return;
    }

    setBusy(true);
    try {
      const response = await fetch("/api/demo-auth/unlock", {
        method: "POST",
        credentials: "same-origin",
        cache: "no-store",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify({ access_key: accessKey }),
      });
      const payload = await response.json().catch(() => ({})) as { detail?: unknown };
      if (!response.ok) {
        setProblem(typeof payload.detail === "string" ? payload.detail : "The local demo could not be unlocked.");
        return;
      }
      await onUnlocked();
    } catch {
      setProblem("The local demo unlock service is unavailable.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="configuration-screen local-demo-unlock">
      <div className="brand-mark large" aria-hidden="true">DT</div>
      <div>
        <p className="eyebrow">Trusted local ceremony</p>
        <h1>Unlock trusted local demo</h1>
        <p>This operator gate protects local actor-token minting. It is not an enterprise sign-in and does not replace the distinct approvals recorded by the demo.</p>
      </div>
      <form onSubmit={(event) => void unlock(event)} autoComplete="off">
        <label htmlFor="local-demo-access-key">Local demo access key</label>
        <input
          id="local-demo-access-key"
          name="local-demo-access-key"
          type="password"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          required
          disabled={busy}
          aria-describedby="local-demo-key-help"
        />
        <small id="local-demo-key-help">Use the UI access key generated for this local demo session. The browser does not persist it.</small>
        {problem ? <p className="unlock-error" role="alert">{problem}</p> : null}
        <Button type="submit" busy={busy}>Unlock and connect</Button>
      </form>
    </main>
  );
}
