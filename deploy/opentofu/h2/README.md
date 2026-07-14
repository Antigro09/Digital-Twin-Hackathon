# H2 OpenTofu deployment wrapper

This wrapper installs the four workload images into an existing Kubernetes cluster. PostgreSQL, S3-compatible storage, Neo4j, Temporal, ingress, identity, backup, and key-management endpoints must be provisioned by approved environment modules and supplied through the runtime secret and Helm values. State must use an encrypted remote backend with locking; local state is for disposable development only.

Run `tofu init`, `tofu plan -var-file=<approved-secret-source>`, and require a reviewed plan before `tofu apply`. Do not commit secret-bearing variable files or state.
