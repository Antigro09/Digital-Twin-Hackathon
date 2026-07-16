import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { resetApiForTests } from "@/lib/api/client";
import { DigitalTwinApp } from "./DigitalTwinApp";

describe("DigitalTwinApp H1 journey", () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_ENABLE_DEMO_DATA = "true";
    delete process.env.NEXT_PUBLIC_API_URL;
    resetApiForTests();
  });

  afterEach(() => {
    cleanup();
    resetApiForTests();
    vi.unstubAllGlobals();
  });

  it("shows the local operator unlock ceremony when connected actor-token minting is locked", async () => {
    process.env.NEXT_PUBLIC_ENABLE_DEMO_DATA = "false";
    process.env.NEXT_PUBLIC_API_URL = "http://api.local";
    resetApiForTests();
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("/api/demo-auth/session");
      return Response.json({
        code: "demo_auth_locked",
        detail: "Unlock the trusted local demo before requesting an actor session.",
      }, { status: 401 });
    }));

    render(<DigitalTwinApp />);

    expect(await screen.findByRole("heading", { name: "Unlock trusted local demo" })).toBeInTheDocument();
    expect(screen.getByLabelText("Local demo access key")).toHaveAttribute("type", "password");
    expect(screen.getByText(/does not replace the distinct approvals/i)).toBeInTheDocument();
  });

  it("loads the evidence-backed control room and exposes semantic navigation", async () => {
    render(<DigitalTwinApp />);
    expect(screen.getByLabelText("Loading Digital Twin")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /one dependency chain/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Active membership")).toHaveValue("mem_aster_operator");
    expect(screen.getByText("AST-142 is the strongest recorded blocker", { exact: false })).toBeInTheDocument();
  });

  it("opens the AI Control Center from primary navigation without simulating offline AI output", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /AI Control Center/ }));
    expect(await screen.findByRole("heading", { name: "AI Control Center" })).toBeInTheDocument();
    expect(screen.getByText(/does not connect to an AI provider/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run bounded explanation" })).toBeDisabled();
  });

  it("switches membership through a server-known ID and discloses no revoked graph evidence", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    const selector = await screen.findByLabelText("Active membership");
    await user.selectOptions(selector, "mem_beacon_observer");
    expect(await screen.findByRole("heading", { name: "Launch posture is unavailable." })).toBeInTheDocument();
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Evidence graph/ }));
    expect(await screen.findByRole("heading", { name: "No authorized graph projection" })).toBeInTheDocument();
    expect(screen.queryByText("BEACON-CANARY-7Q9K")).not.toBeInTheDocument();
    expect(screen.queryByText("AST-142 · Complete SSO cutover")).not.toBeInTheDocument();
  });

  it("provides a keyboard-operable graph with an accessible path table", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Evidence graph/ }));
    expect(await screen.findByRole("heading", { name: "Orion 2.0 launch dependency path" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Show accessible path" }));
    const table = screen.getByRole("table", { name: "Authorized dependency path in traversal order" });
    expect(within(table).getByText("PR #184")).toBeInTheDocument();
    expect(within(table).getAllByText("BLOCKS")).toHaveLength(2);
    await user.click(screen.getByRole("button", { name: /AST-201: Launch certification/ }));
    expect(screen.getByRole("heading", { name: "Launch certification" })).toBeInTheDocument();
  });

  it("explores the synthetic pump, streams telemetry, and executes an idempotent control rehearsal", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Asset twin/ }));

    expect(await screen.findByRole("heading", { name: "Interactive asset twin" })).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "Live simulator telemetry" })).toBeInTheDocument();
    const pump = screen.getByRole("application", { name: /centrifugal pump view/i });
    pump.focus();
    await user.keyboard("{ArrowRight}");
    expect(pump).toHaveAttribute("aria-label", expect.stringContaining("rotated -2 degrees"));

    await user.click(screen.getByRole("button", { name: "Drive-end bearing" }));
    expect(screen.getByText("Radial bearing with a rising vibration signature.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Preview exact command" }));
    expect(await screen.findByRole("heading", { name: "Set drive speed" })).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /confirm this exact synthetic command/i }));
    await user.click(screen.getByRole("button", { name: "Execute once in simulation" }));
    expect(await screen.findByRole("heading", { name: "Synthetic command executed once" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replay same idempotency key" }));
    expect(await screen.findByRole("heading", { name: "Replay returned the original receipt" })).toBeInTheDocument();
  });

  it("interprets an event, explores causal effects, and applies an exact dual-approved synthetic reality update", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Event intelligence/ }));

    expect(await screen.findByRole("heading", { name: /Understand what changed/i })).toBeInTheDocument();
    expect(screen.getByText("External write: false")).toBeInTheDocument();
    expect(screen.getAllByText("Local demo data").length).toBeGreaterThan(0);
    await user.click(screen.getByRole("button", { name: "Interpret event and trace impacts" }));

    expect(await screen.findByRole("heading", { name: "Lead backend engineer departure" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: /Sarah Kim/ })).not.toBeChecked();
    expect(screen.getByRole("button", { name: "Build exact reality review" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Sarah Kim/ }));
    expect(screen.getByRole("button", { name: /Causal link: Authentication Service raises risk Payment Platform delivery/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Causal link: Authentication Service raises risk Payment Platform delivery/ }));
    expect(screen.getByRole("heading", { name: "Authentication Service → Payment Platform delivery" })).toBeInTheDocument();
    expect(screen.getByText("Conditional estimate from the recorded owner and dependency graph.")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Build exact reality review" }));
    expect(await screen.findByText("Server-sealed payload displayed")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /reviewed this exact server-sealed payload/i }));
    await user.click(screen.getByRole("button", { name: "Request operations and security approval" }));
    expect(await screen.findByText(/Production requires each approver to use a separate signed-in session/i)).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Synthetic demo: approve as operations actor" }));
    await user.click(await screen.findByRole("button", { name: "Synthetic demo: approve as security actor" }));
    const applyButton = screen.getByRole("button", { name: "Apply once to synthetic reality graph" });
    await waitFor(() => expect(applyButton).toBeEnabled());
    await user.click(applyButton);
    expect(await screen.findByRole("heading", { name: "Synthetic reality graph updated" })).toBeInTheDocument();
    expect(screen.getByText("Event version")).toBeInTheDocument();
    expect(screen.getAllByText("Graph version").length).toBeGreaterThan(0);
    expect(screen.getAllByText(/synthetic tenant projection only/i).length).toBeGreaterThan(0);
    expect(await screen.findByRole("button", { name: /Lead backend engineer departure/ })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Reconstruct this event" }));
    expect(await screen.findByText("Audited reconstruction")).toBeInTheDocument();
  }, 10_000);

  it("routes uncertain event language into an isolated scenario branch", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Event intelligence/ }));
    await user.click(await screen.findByRole("button", { name: "Customer may leave" }));
    await user.click(screen.getByRole("button", { name: "Interpret event and trace impacts" }));

    expect(await screen.findByRole("heading", { name: "Potential strategic customer loss" })).toBeInTheDocument();
    expect(screen.getByLabelText("Review destination")).toHaveValue("scenario");
    expect(screen.getByRole("option", { name: "Reality graph—synthetic projection only" })).toBeDisabled();
    await user.click(screen.getByRole("radio", { name: /Northstar Bank/ }));
    await user.click(screen.getByRole("button", { name: "Build exact scenario review" }));
    await user.click(await screen.findByRole("checkbox", { name: /reviewed this exact server-sealed payload/i }));
    await user.click(screen.getByRole("button", { name: "Request scenario isolation policy" }));
    expect(await screen.findByText("Scenario isolation policy passed")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Create isolated scenario branch" }));
    expect(await screen.findByRole("heading", { name: "Alternate future created" })).toBeInTheDocument();
    expect(screen.getAllByText(/reality graph and external systems were not changed/i).length).toBeGreaterThan(0);
    expect(await screen.findByText("Scenario base graph version")).toBeInTheDocument();
    expect(screen.getByText("Scenario base graph hash")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Compare branches" }));
    expect(await screen.findByText("Same base snapshot")).toBeInTheDocument();
  });

  it("rebuilds the displayed reviewed payload for the explicitly selected ambiguous entity", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Event intelligence/ }));
    await user.click(screen.getByRole("button", { name: "Interpret event and trace impacts" }));
    await user.click(await screen.findByRole("radio", { name: /Sarah Ibrahim/ }));
    await user.click(screen.getByRole("button", { name: "Build exact reality review" }));
    expect(await screen.findByText("Server-sealed payload displayed")).toBeInTheDocument();
    expect(screen.getAllByText("Sarah Ibrahim").length).toBeGreaterThan(1);
    const approvalButton = screen.getByRole("button", { name: "Request operations and security approval" });
    expect(approvalButton).toBeDisabled();

    await user.click(screen.getByRole("checkbox", { name: /restore the synthetic projection/i }));
    await user.click(screen.getByRole("button", { name: "Roll back this event" }));
    expect(await screen.findByText("Compensation receipt")).toBeInTheDocument();
    const outageHistory = screen.getAllByRole("button", { name: /Identity database outage resolved/ });
    expect(outageHistory).toHaveLength(2);
    expect(outageHistory.filter((button) => button.getAttribute("aria-pressed") === "true")).toHaveLength(1);

    await user.click(screen.getByRole("checkbox", { name: /reviewed this exact server-sealed payload/i }));
    expect(approvalButton).toBeEnabled();
  });

  it("abstains from an excluded workforce inference without citations", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Cited analysis/ }));
    await user.click(screen.getByRole("button", { name: "Protected workforce request" }));
    await user.click(screen.getByRole("button", { name: /Analyze launch risk/ }));
    expect(await screen.findByText("I can’t rank people or infer productivity from work metadata.")).toBeInTheDocument();
    expect(screen.getByText("Evidence threshold not met")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Evidence used" })).not.toBeInTheDocument();
  });

  it("locks an exact scenario before showing the reproducible forecast comparison", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Scenario lab/ }));
    await user.click(screen.getByRole("button", { name: "Compile exact draft" }));
    expect(await screen.findByText("sha256:99f5bb9eaa944a892acb09914e22ee276e3dfac2346775b83840f9f923087a52")).toBeInTheDocument();
    await user.click(screen.getByRole("checkbox", { name: /confirm this exact digest/i }));
    await user.click(screen.getByRole("button", { name: "Confirm and lock scenario" }));
    expect(await screen.findByRole("heading", { name: "Scenario sealed" })).toBeInTheDocument();
    expect(screen.getByLabelText("Shift completion distribution")).toBeDisabled();
    await user.click(screen.getByRole("button", { name: /Run 50,000 samples/ }));
    expect(await screen.findByRole("heading", { name: "A five-day p80 improvement" })).toBeInTheDocument();
    expect(screen.getByText("Aug 24, 2026")).toBeInTheDocument();
    expect(screen.getByText("Aug 17, 2026")).toBeInTheDocument();
  });

  it("executes once after separate approvals, replays safely, and compensates", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    await user.click(within(screen.getByRole("navigation", { name: "Primary navigation" })).getByRole("button", { name: /Action control/ }));
    await user.click(screen.getByRole("button", { name: "Preview AST-142 remediation" }));
    expect(await screen.findByRole("heading", { name: /AST-142 · Complete SSO cutover/ })).toBeInTheDocument();
    expect(screen.getByText("Jul 31, 2026")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /Request operations \+ security approval/ }));
    await user.click(await screen.findByRole("button", { name: "Review and approve as operations" }));
    expect(await screen.findByText("Approved Jul 13, 12:00 PM EDT")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Execute one Jira update" })).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Review and approve as security" }));
    const executeButton = screen.getByRole("button", { name: "Execute one Jira update" });
    await waitFor(() => expect(executeButton).toBeEnabled());
    await user.click(executeButton);
    expect(await screen.findByRole("heading", { name: "AST-142 updated once" })).toBeInTheDocument();
    expect(screen.getByText("1", { selector: ".definition-list strong" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Replay same idempotency key" }));
    expect(await screen.findByText("Replay returned the original receipt.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Preview compensation" }));
    expect(await screen.findByText("Compare-and-set guard")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Review and approve as operations" }));
    await user.click(screen.getByRole("button", { name: "Review and approve as security" }));
    const rollbackButton = screen.getByRole("button", { name: "Execute guarded rollback" });
    await waitFor(() => expect(rollbackButton).toBeEnabled());
    await user.click(rollbackButton);
    expect(await screen.findByRole("heading", { name: "Original values restored once" })).toBeInTheDocument();
  });

  it("exposes deterministic loading, empty, error, stale, and revoked demo states", async () => {
    const user = userEvent.setup();
    render(<DigitalTwinApp />);
    await screen.findByRole("heading", { name: /one dependency chain/i });
    const stateSelector = screen.getByLabelText("Preview interface state");
    await user.selectOptions(stateSelector, "empty");
    expect(screen.getByRole("heading", { name: "No results in this authorized scope" })).toBeInTheDocument();
    await user.selectOptions(stateSelector, "error");
    expect(screen.getByRole("heading", { name: "This surface is temporarily unavailable" })).toBeInTheDocument();
    await user.selectOptions(stateSelector, "stale");
    expect(screen.getByText("Source projection is stale.")).toBeInTheDocument();
    await user.selectOptions(stateSelector, "revoked");
    expect(screen.getByRole("heading", { name: "Authorization intersection is empty" })).toBeInTheDocument();
  });
});
