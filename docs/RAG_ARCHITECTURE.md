# Permission-Aware RAG and Memory Architecture

Status: H1 implementation contract  
Last reviewed: 2026-07-15

## Objective

Retrieval-augmented generation supplies a bounded model request with only the evidence relevant to the task and currently accessible to the authenticated actor. The entire company database is never copied into a prompt. Retrieval itself is an authorization boundary and every returned fact keeps provenance.

## Ingestion pipeline

```mermaid
flowchart LR
    UPLOAD[Authorized upload/connector source] --> VALIDATE[Type, size, malware and policy validation]
    VALIDATE --> EXTRACT[Format-specific deterministic extraction]
    EXTRACT --> CHUNK[Structure-aware chunks]
    CHUNK --> EMBED[Approved embedding route]
    CHUNK --> STORE[(Evidence + vector index)]
    EMBED --> STORE
    STORE --> REVIEW[Knowledge ingestion suggestion]
    REVIEW -->|human approved| MEMORY[Validated enterprise memory]
```

The immutable source record stores tenant, source ID, source version/hash, filename/title, media type, classification, source ACL, observed/effective time, extractor/version, and retention/deletion metadata. A chunk stores its parent source, stable locator (page, sheet/cell range, heading, paragraph, diagram region), text hash, extraction confidence, embedding model/version, vector, and lifecycle state.

H1 browser/API uploads are private to the authenticated importer. The public caller can choose only `{ "visibility": "private" }`; the API derives the internal actor ACL and permission requirement. Tenant-wide sharing and arbitrary principal lists are not an H1 upload feature.

Supported formats must have explicit extractors and tests. Plain text and Markdown can be decoded under strict character/size rules. PDF, DOCX, XLSX/CSV, and diagrams require format-aware extraction that retains page/sheet/object locators. Encrypted, malformed, macro-bearing, archive-bomb, unsupported, or image-only inputs are rejected or marked for a governed OCR/extraction path. Raw binary bytes are never sent as if they were text.

## Storage model

The Compose/H1 implementation durably stores tenant-qualified AI records in PostgreSQL `JSONB`. Real embedding vectors, when configured, are stored with their evidence payload and ranked by bounded application-side cosine over a capped authorized candidate set. A file-backed SQLite adapter exists only for isolated worker development/tests and identifies itself as `sqlite-h1`; Compose requires PostgreSQL. No process-local corpus is represented as enterprise memory.

This is intentionally not the H2 scale design. Before design-partner volume, records normalize into tenant-qualified PostgreSQL tables and vectors move to pgvector indexes with database-side ACL predicates and ranking. The logical target records are:

| Record | Required fields |
|---|---|
| `ai_source` | tenant, source/version/hash, media type, classification, ACL, provenance, status, retention |
| `ai_chunk` | tenant, source, locator, text/object reference, hash, extraction version/confidence |
| `ai_embedding` | tenant, chunk, embedding provider/model/version, dimensions, vector, created time |
| `ai_memory` | tenant, scope, reviewed artifact, provenance, validation/review refs, lifecycle/expiry |
| `ai_run` | tenant, actor, agent/profile, route, usage, evidence set, validation, terminal state |
| `ai_suggestion` | tenant, run, typed proposal, evidence, digest, confidence, review state |

Tenant-qualified foreign keys and row-level security are required for the normalized production profile. Vector, lexical, and graph indexes are derived and rebuildable from authoritative evidence records. Deletion/revocation propagates to chunks, vectors, caches, session summaries, and future retrieval.

The reduced SQLite store must preserve the same tenant/ACL/provenance contract and never satisfy the enterprise-memory release gate. The PostgreSQL H1 store is restart-durable, but its generic JSONB table and application-side vector scan are limited by `AI_MAX_RETRIEVAL_CANDIDATES`; it cannot satisfy H2 scale/latency evidence until the pgvector migration and representative benchmark pass.

## Query pipeline

1. The API derives tenant, actor, groups/roles, classification ceiling, and policy version from the authenticated principal.
2. The selected agent turns the user question into a bounded retrieval request containing query text and allowlisted filters—not SQL, Cypher, or a tenant ID.
3. The retrieval service applies tenant, lifecycle, classification, and source-ACL predicates before lexical/vector ranking.
4. H1 performs lexical ranking and, only when an authorized compatible stored vector exists, calls the configured embedding route and blends bounded cosine similarity. It exposes lexical/vector contribution and the provider-returned embedding model; recency/source-authority/graph-proximity ranking remain future extensions. Scores are signals, not truth confidence.
5. Bounded graph expansion uses registered relationship types, depth, node, edge, and time limits. It cannot return a node whose supporting evidence is inaccessible.
6. Results are deduplicated, capped, context-budgeted at whole-item boundaries, and serialized with evidence ID, locator, content hash, time, classification, lexical/vector provenance, and an untrusted-data marker. H1 does not yet implement diversity/source-authority reranking.
7. The model returns only evidence IDs from the supplied set. The gateway re-authorizes those IDs and validates claim support before display or suggestion persistence.

No result count, nearest-neighbor score, cache hit, error message, or timing difference may reveal the presence of inaccessible data.

## Retrieval result contract

```json
{
  "query_id": "irq_...",
  "partial": false,
  "items": [
    {
      "evidence_id": "ev_...",
      "kind": "document_chunk",
      "text": "authorized bounded excerpt",
      "source": "architecture.md",
      "locator": "page 4 / section Availability",
      "classification": "internal",
      "observed_at": "2026-07-15T00:00:00Z",
      "source_hash": "sha256:...",
      "retrieval": {
        "vector_score": 0.0,
        "lexical_score": 0.0,
        "rank": 1
      }
    }
  ],
  "omissions": []
}
```

The public API may omit raw text for classifications the screen is not authorized to render. Retrieval scores are never presented as factual confidence.

## Memory scopes

### Session memory

Short-lived context for the current actor, tenant, and session. It stores bounded sanitized structured user/assistant summaries—not raw hidden reasoning—and marks them unverified. Sensitive-key values and instruction-like strings are replaced before persistence. It has a TTL plus internal purge/reset capability and cannot cross sessions, actors, or tenants. It is not citable evidence and does not claim immediate upstream source-revocation propagation.

### Enterprise memory

Only human-validated knowledge artifacts with evidence and review receipts. It is versioned, tenant-scoped, permission-trimmed, correctable, and deletable. Approval does not automatically change the canonical graph; a governed domain command consumes reviewed artifacts where appropriate.

### Learning memory

Validated outcomes that compare a prior prediction/simulation/recommendation with an observed result. Records include prediction and outcome versions, horizon, evidence, validation owner, calibration cohort, applicable scope, and correction. Unreviewed model output, user reactions, and cross-tenant data cannot enter learning memory.

## Embedding policy

Embedding generation is a provider capability separate from text generation. The H1 adapter calls an explicitly configured real OpenAI-compatible `/embeddings` endpoint using `AI_EMBEDDING_API_KEY`, `AI_EMBEDDING_MODEL`, `AI_EMBEDDING_ENDPOINT`, and the model-supported `AI_VECTOR_DIMENSIONS`. The system cannot synthesize placeholder vectors, hashes, or random values and call them semantic embeddings. If no approved embedding provider is configured, lexical and graph retrieval remain available and status says vector retrieval is unavailable. Query embedding calls short-circuit when no authorized compatible vectors exist. Provider-reported embedding tokens and returned model identifiers are recorded; embedding monetary cost remains unpriced because generation rates are not reused.

Embedding cache keys include tenant, content hash, classification/data-processing profile, provider, exact model/version, dimensions, and normalization. A route change requires re-embedding into a new versioned index and supports rollback. Embedding content is treated as potentially reversible sensitive data and receives the same access, encryption, retention, deletion, and residency controls as its source.

## Ranking, grounding, and abstention

The system distinguishes retrieval relevance, extraction confidence, source authority, model confidence, and verifier support; they are not collapsed into one opaque score. A grounded result reports evidence, conflicts, missing data, and whether the retrieval envelope was partial. Material unsupported claims are removed, marked as assumptions, or cause abstention.

RAG does not guarantee truth. It reduces context and links claims to evidence; source quality, temporal validity, conflicts, model behavior, and reviewer judgment still matter.

## Testing and operations

Required suites cover relevant-item recall on a golden corpus, irrelevant-item rejection, ACL trimming, tenant isolation, revocation, deleted documents, classification changes, stale vectors, embedding-model migration, duplicate chunks, malicious document instructions, invented citations, inaccessible graph neighbors, token-bound truncation, cache isolation, database/vector outage, and rebuild reproducibility.

Metrics include authorized retrieval latency, item counts, partial rate, no-result rate, lexical/vector contribution, citation coverage/precision, stale/index lag, embedding throughput/failures, cache hits by safe category, revocation propagation, and cost. Query or document text is excluded from ordinary metric labels and logs.
