# Editable company node graph — implementation plan

## Audit findings

- The existing Evidence graph is a read-only, fixed launch-dependency projection. It is not backed by the company `TwinGraph` node and relationship APIs.
- The platform already exposes tenant-scoped node, relationship, and type endpoints under `/v1/twin`. Those services enforce read permission, `connector.admin` for changes, idempotency, audit history, and tenant isolation.
- Creating a second marketing or people graph would duplicate data and bypass those controls. The user interface must consume the existing graph endpoints.

## Security boundary

The browser never chooses a tenant or grants a permission. The API derives both from its signed session. Graph mutations remain restricted to tenant graph administrators (`connector.admin`), carry an idempotency key, and are logged by the existing graph service. The UI may hide disabled controls, but it does not replace server enforcement.

## Delivery steps

1. Add typed client access for node types, relationship types, graph reads, and governed node/relationship creation.
2. Replace the fixed graph strip with an interactive, accessible SVG relationship map backed by the authoritative graph.
3. Add administrator-only forms to add a person (an `Employee` node) or any available entity and connect any two visible nodes.
4. Keep a bounded fallback view for the legacy evidence projection when the authoritative graph has no entities.
5. Verify TypeScript, targeted UI tests, and the running Docker web application.

## Local-demo adjustment

The local demo must be usable for graph modeling, but production permissions must not be weakened. Its explicit, access-key-gated default identity is therefore a synthetic tenant graph administrator. The API issues a short-lived signed `usr_aster_admin` session only through the existing local unlock ceremony; normal tenant memberships remain subject to the same server-side `connector.admin` check. The industrial asset surface is removed from primary navigation because this product is positioned as a company digital twin, not a factory-floor application.
