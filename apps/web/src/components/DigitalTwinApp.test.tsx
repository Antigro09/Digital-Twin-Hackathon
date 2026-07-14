import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
  });

  it("loads the evidence-backed control room and exposes semantic navigation", async () => {
    render(<DigitalTwinApp />);
    expect(screen.getByLabelText("Loading Digital Twin")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: /one dependency chain/i })).toBeInTheDocument();
    expect(screen.getByRole("navigation", { name: "Primary navigation" })).toBeInTheDocument();
    expect(screen.getByLabelText("Active membership")).toHaveValue("mem_aster_operator");
    expect(screen.getByText("AST-142 is the strongest recorded blocker", { exact: false })).toBeInTheDocument();
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
