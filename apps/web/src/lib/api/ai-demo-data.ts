import type { AiActivityFeed, AiStatus, AiSuggestion } from "./types";
import { FROZEN_NOW } from "./demo-data";

export const AI_DEMO_STATUS: AiStatus = {
  executionMode: "offline_ui_preview",
  profile: "Offline UI shell",
  providerReadiness: [
    {
      provider: "none",
      displayName: "AI provider",
      status: "unavailable",
      detail: "Offline demo data does not connect to an AI provider and cannot produce model output.",
      approvedModels: [],
      capabilities: [],
      liveVerified: false,
      lastCheckedAt: FROZEN_NOW,
    },
  ],
  agentProfiles: [
    { agentType: "knowledge_ingestion", label: "Knowledge ingestion", purpose: "Prepare authorized knowledge for permission-scoped retrieval.", authorityBoundary: "Unavailable offline; connector administration is required.", canRun: false },
    { agentType: "entity_resolution", label: "Entity resolution", purpose: "Draft reversible entity candidates.", authorityBoundary: "Unavailable offline; ambiguous matches require review.", canRun: false },
    { agentType: "event_understanding", label: "Event understanding", purpose: "Extract a structured event candidate.", authorityBoundary: "Unavailable offline; no reality mutation authority.", canRun: false },
    { agentType: "causal_analysis", label: "Causal analysis", purpose: "Explain bounded relationships from server-derived graph evidence.", authorityBoundary: "Unavailable offline; connected runs are read-only and pending review.", canRun: false },
    { agentType: "simulation_planning", label: "Simulation planning", purpose: "Draft explicit isolated scenario assumptions.", authorityBoundary: "Unavailable offline; no reality mutation authority.", canRun: false },
    { agentType: "prediction_explanation", label: "Prediction explanation", purpose: "Explain an existing model result and its uncertainty.", authorityBoundary: "Unavailable offline; does not create a prediction.", canRun: false },
    { agentType: "technical_knowledge", label: "Technical knowledge", purpose: "Answer technical questions from private evidence.", authorityBoundary: "Unavailable offline; connector administration is required.", canRun: false },
  ],
  knowledgeImport: {
    enabled: false,
    storeReady: false,
    authorized: false,
    maxBytes: 5 * 1024 * 1024,
    allowedMediaTypes: [
      "text/plain",
      "text/markdown",
      "text/csv",
      "application/csv",
      "application/json",
      "application/yaml",
      "text/yaml",
      "application/xml",
      "text/xml",
      "image/svg+xml",
      "text/vnd.mermaid",
      "application/pdf",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
    classifications: ["public", "internal", "confidential", "restricted"],
    sourceAcl: { visibility: "private" },
  },
  canReviewSuggestions: false,
  checkedAt: FROZEN_NOW,
};

export const AI_DEMO_ACTIVITY: AiActivityFeed = { active: [], recent: [], pageSize: 10 };
export const AI_DEMO_SUGGESTIONS: AiSuggestion[] = [];
