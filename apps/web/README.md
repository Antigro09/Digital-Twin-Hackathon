# Enterprise Digital Twin — H1 web application

This Next.js application implements the complete synthetic H1 user journey:

1. Select a server-known Aster Labs or Beacon Works membership context. The browser sends a membership ID; it never uses a raw tenant ID as authorization scope.
2. Inspect the permission-aware Orion dependency graph and its source-level Jira/GitHub evidence.
3. Ask the frozen launch-risk question and inspect citations, missing data, redaction, and policy abstention states.
4. Compile and explicitly confirm an immutable AST-142 scenario, then compare the seeded baseline and scenario p50/p80/p95 forecasts.
5. Preview the exact Jira diff, collect distinct operations and security approvals, execute with one idempotency key, replay safely, and inspect or run guarded compensation.

## Run with the deterministic fixture

Copy `.env.example` to `.env.local` and set:

```dotenv
NEXT_PUBLIC_ENABLE_DEMO_DATA=true
```

Then install and run this application from `apps/web`:

```sh
npm ci
npm run dev
```

The demo transport is deterministic, in-memory, synthetic-only, and unavailable unless that flag is explicitly `true`. The “Preview state” control is shown only in demo mode and covers loading, empty, error, stale, and revoked UI states.

## Connect to the API

For connected mode, leave `NEXT_PUBLIC_ENABLE_DEMO_DATA=false` and set:

```dotenv
NEXT_PUBLIC_API_URL=https://api.example.internal
```

The typed client in `src/lib/api/client.ts` uses browser credentials and the server-issued `EDT-Context` cookie. It maps to the H1 REST endpoints for context selection, graph traversal, cited questions, scenarios, simulations, exact Jira previews, approval decisions, execution, and compensation.

No data fallback occurs when the API is absent or fails. A configuration or API error is surfaced instead of silently entering demo mode.

## Validation

```sh
npm test
npm run typecheck
npm run build
```

The production build uses Next.js standalone output and can be packaged with the included multi-stage `Dockerfile`.

## Accessibility and safety notes

- Semantic headings, landmarks, form labels, tables, live regions, visible focus, keyboard operation, and reduced-motion support are built in.
- The graph has a non-visual relationship table; color is never the only state indicator.
- Revoked access returns no cached evidence, citation locators, or graph content.
- Individual productivity and other workforce-sensitive inference is explicitly refused.
- Scenario and action hashes are visible, approval roles are distinct, and replay/rollback results are explicit.
