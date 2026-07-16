# Retrieval and knowledge architecture

The gateway never sends the complete enterprise corpus to a model.

## Ingestion

The import boundary accepts text/Markdown/CSV/JSON/YAML/XML/SVG/Mermaid or base64-encoded PDF, DOCX, and XLSX. Format-specific pinned parsers enforce byte, page, sheet, table, and cell limits. Unsupported binaries, encrypted PDFs, invalid encodings, and documents with no extracted text fail explicitly.

Documents are split into bounded overlapping chunks. Each chunk stores a stable evidence ID, tenant, document/source locator, classification, normalized ACL, confidence, timestamp, content hash, security flags, and optional real embedding. Suspicious chunks are quarantined and redacted before any embedding/model call.

## Retrieval

1. SQL selects only the authenticated tenant.
2. The worker applies actor/role/required-capability ACLs and removes quarantined chunks.
3. Honest lexical relevance is always available.
4. The query is sent to the embedding endpoint only when at least one authorized stored vector exists. Bounded cosine relevance is blended only for vectors whose provider-returned model identifier matches the query vector.
5. Results expose content hash, lexical/vector contribution, retrieval mode, embedding model, and real embedding token usage. Embedding monetary cost remains `unpriced` because generation-token rates are not reused as embedding rates.
6. The model receives only whole evidence items that fit both the requested result count and the configured full-route context budget.

The `context_evidence` run field supports bounded, server-derived graph/event/simulation/prediction facts and a human event statement labeled `user_input`, without persisting source content as knowledge. The worker derives tenant/actor at the API boundary, rechecks the captured ACL, scans content, and allows only exact ID/locator citations.

## Provenance and hallucination gate

Every output has top-level citations and every proposed entity, relationship, constraint, fact, or causal step carries evidence IDs. The post-model gate requires every ID and locator to match the authorized retrieval set. Unknown or inaccessible citations reject the entire suggestion; they are never silently removed.

## Persistence and evolution

Knowledge, embeddings, suggestions, reviews, and validated memories are durable SQL records. The production backend is PostgreSQL. The current bounded similarity scan is appropriate for the H1 data shape; native pgvector indexes and PostgreSQL-side distance/ACL queries are the next benchmark-gated transition.

Validated enterprise/learning memory retains the exact cited evidence bindings. Every future use recursively re-authorizes durable source provenance; a deleted, replaced, quarantined, or revoked source prevents that memory from entering a prompt.
