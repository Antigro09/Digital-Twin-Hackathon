from __future__ import annotations

import json
import sqlite3
import threading
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Iterator
from uuid import UUID

import psycopg

from .errors import DomainError


_SCHEMA_SQLITE = """
CREATE TABLE IF NOT EXISTS ai_records (
    tenant_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    record_id TEXT NOT NULL,
    actor_id TEXT,
    created_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    PRIMARY KEY (tenant_id, kind, record_id)
);
CREATE INDEX IF NOT EXISTS ai_records_tenant_kind_created
ON ai_records (tenant_id, kind, created_at DESC);
"""

_SCHEMA_POSTGRES = """
CREATE TABLE IF NOT EXISTS edt_ai_records (
    tenant_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (char_length(kind) BETWEEN 1 AND 80),
    record_id UUID NOT NULL,
    actor_id UUID,
    created_at TIMESTAMPTZ NOT NULL,
    payload_json JSONB NOT NULL,
    PRIMARY KEY (tenant_id, kind, record_id)
);
CREATE INDEX IF NOT EXISTS edt_ai_records_tenant_kind_created
ON edt_ai_records (tenant_id, kind, created_at DESC);
ALTER TABLE edt_ai_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE edt_ai_records FORCE ROW LEVEL SECURITY;
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = current_schema()
          AND tablename = 'edt_ai_records'
          AND policyname = 'edt_ai_records_tenant_isolation'
    ) THEN
        CREATE POLICY edt_ai_records_tenant_isolation ON edt_ai_records
        USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid)
        WITH CHECK (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
    END IF;
END $$;
"""


class DurableRecordStore:
    """Tenant-qualified durable JSON records.

    PostgreSQL is the production backend. SQLite exists for isolated H1/local
    execution and tests; it is file-backed by default and is never represented
    as the enterprise system of record.
    """

    def __init__(self, dsn: str, *, required: bool = False) -> None:
        self.dsn = dsn
        self.required = required
        self._lock = threading.RLock()
        self._sqlite: sqlite3.Connection | None = None
        self.backend = "postgresql" if dsn.startswith("postgresql://") else "sqlite-h1"
        try:
            self._initialize()
        except Exception as exc:
            if required:
                raise DomainError(
                    "ai_store_unavailable",
                    "The durable AI record store is unavailable.",
                    status_code=503,
                ) from exc
            raise

    def _initialize(self) -> None:
        if self.backend == "postgresql":
            with psycopg.connect(self.dsn, autocommit=True) as connection:
                role = connection.execute(
                    "SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user"
                ).fetchone()
                if role is None or bool(role[0]) or bool(role[1]):
                    raise DomainError(
                        "insecure_ai_store_role",
                        "The AI store must use a PostgreSQL role that cannot bypass row security.",
                        status_code=500,
                    )
                connection.execute(_SCHEMA_POSTGRES)
            return
        raw_path = self.dsn.removeprefix("sqlite:///")
        if raw_path != ":memory:":
            Path(raw_path).expanduser().resolve().parent.mkdir(parents=True, exist_ok=True)
        self._sqlite = sqlite3.connect(raw_path, check_same_thread=False)
        self._sqlite.row_factory = sqlite3.Row
        self._sqlite.executescript(_SCHEMA_SQLITE)
        self._sqlite.commit()

    @contextmanager
    def _postgres(self, tenant_id: UUID | None = None) -> Iterator[psycopg.Connection[Any]]:
        try:
            with psycopg.connect(self.dsn) as connection:
                if tenant_id is not None:
                    connection.execute(
                        "SELECT set_config('app.tenant_id', %s, true)", (str(tenant_id),)
                    )
                yield connection
        except DomainError:
            raise
        except Exception as exc:
            raise DomainError(
                "ai_store_unavailable",
                "The durable AI record store is unavailable.",
                status_code=503,
            ) from exc

    @staticmethod
    def _payload(payload: dict[str, Any]) -> str:
        return json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)

    def put(
        self,
        *,
        tenant_id: UUID,
        kind: str,
        record_id: UUID,
        actor_id: UUID | None,
        created_at: str,
        payload: dict[str, Any],
    ) -> None:
        encoded = self._payload(payload)
        if self.backend == "postgresql":
            with self._postgres(tenant_id) as connection:
                connection.execute(
                    """
                    INSERT INTO edt_ai_records
                        (tenant_id, kind, record_id, actor_id, created_at, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (tenant_id, kind, record_id) DO UPDATE SET
                        actor_id = EXCLUDED.actor_id,
                        created_at = EXCLUDED.created_at,
                        payload_json = EXCLUDED.payload_json
                    """,
                    (tenant_id, kind, record_id, actor_id, created_at, encoded),
                )
            return
        assert self._sqlite is not None
        with self._lock, self._sqlite:
            self._sqlite.execute(
                """
                INSERT INTO ai_records
                    (tenant_id, kind, record_id, actor_id, created_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT (tenant_id, kind, record_id) DO UPDATE SET
                    actor_id = excluded.actor_id,
                    created_at = excluded.created_at,
                    payload_json = excluded.payload_json
                """,
                (str(tenant_id), kind, str(record_id), str(actor_id) if actor_id else None, created_at, encoded),
            )

    def put_if_absent(
        self,
        *,
        tenant_id: UUID,
        kind: str,
        record_id: UUID,
        actor_id: UUID | None,
        created_at: str,
        payload: dict[str, Any],
    ) -> bool:
        encoded = self._payload(payload)
        if self.backend == "postgresql":
            with self._postgres(tenant_id) as connection:
                cursor = connection.execute(
                    """
                    INSERT INTO edt_ai_records
                        (tenant_id, kind, record_id, actor_id, created_at, payload_json)
                    VALUES (%s, %s, %s, %s, %s, %s::jsonb)
                    ON CONFLICT (tenant_id, kind, record_id) DO NOTHING
                    """,
                    (tenant_id, kind, record_id, actor_id, created_at, encoded),
                )
                return cursor.rowcount == 1
        assert self._sqlite is not None
        with self._lock, self._sqlite:
            cursor = self._sqlite.execute(
                """
                INSERT OR IGNORE INTO ai_records
                    (tenant_id, kind, record_id, actor_id, created_at, payload_json)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (str(tenant_id), kind, str(record_id), str(actor_id) if actor_id else None, created_at, encoded),
            )
            return cursor.rowcount == 1

    def get(self, *, tenant_id: UUID, kind: str, record_id: UUID) -> dict[str, Any] | None:
        if self.backend == "postgresql":
            with self._postgres(tenant_id) as connection:
                row = connection.execute(
                    """
                    SELECT payload_json FROM edt_ai_records
                    WHERE tenant_id = %s AND kind = %s AND record_id = %s
                    """,
                    (tenant_id, kind, record_id),
                ).fetchone()
            if row is None:
                return None
            value = row[0]
            return value if isinstance(value, dict) else json.loads(value)
        assert self._sqlite is not None
        with self._lock:
            row = self._sqlite.execute(
                """
                SELECT payload_json FROM ai_records
                WHERE tenant_id = ? AND kind = ? AND record_id = ?
                """,
                (str(tenant_id), kind, str(record_id)),
            ).fetchone()
        return json.loads(row[0]) if row else None

    def list(
        self,
        *,
        tenant_id: UUID,
        kind: str,
        limit: int,
        actor_id: UUID | None = None,
    ) -> list[dict[str, Any]]:
        if self.backend == "postgresql":
            actor_sql = " AND actor_id = %s" if actor_id else ""
            parameters: tuple[Any, ...] = (tenant_id, kind, actor_id, limit) if actor_id else (
                tenant_id,
                kind,
                limit,
            )
            with self._postgres(tenant_id) as connection:
                rows = connection.execute(
                    f"""
                    SELECT payload_json FROM edt_ai_records
                    WHERE tenant_id = %s AND kind = %s{actor_sql}
                    ORDER BY created_at DESC, record_id DESC LIMIT %s
                    """,  # `actor_sql` is selected from fixed text, never caller input.
                    parameters,
                ).fetchall()
            return [row[0] if isinstance(row[0], dict) else json.loads(row[0]) for row in rows]
        assert self._sqlite is not None
        actor_sql = " AND actor_id = ?" if actor_id else ""
        parameters = (
            (str(tenant_id), kind, str(actor_id), limit)
            if actor_id
            else (str(tenant_id), kind, limit)
        )
        with self._lock:
            rows = self._sqlite.execute(
                f"""
                SELECT payload_json FROM ai_records
                WHERE tenant_id = ? AND kind = ?{actor_sql}
                ORDER BY created_at DESC, record_id DESC LIMIT ?
                """,
                parameters,
            ).fetchall()
        return [json.loads(row[0]) for row in rows]

    def count(self, *, tenant_id: UUID, kind: str) -> int:
        if self.backend == "postgresql":
            with self._postgres(tenant_id) as connection:
                row = connection.execute(
                    "SELECT count(*) FROM edt_ai_records WHERE tenant_id = %s AND kind = %s",
                    (tenant_id, kind),
                ).fetchone()
            return int(row[0]) if row else 0
        assert self._sqlite is not None
        with self._lock:
            row = self._sqlite.execute(
                "SELECT count(*) FROM ai_records WHERE tenant_id = ? AND kind = ?",
                (str(tenant_id), kind),
            ).fetchone()
        return int(row[0]) if row else 0

    def delete(self, *, tenant_id: UUID, kind: str, record_id: UUID) -> None:
        if self.backend == "postgresql":
            with self._postgres(tenant_id) as connection:
                connection.execute(
                    "DELETE FROM edt_ai_records WHERE tenant_id = %s AND kind = %s AND record_id = %s",
                    (tenant_id, kind, record_id),
                )
            return
        assert self._sqlite is not None
        with self._lock, self._sqlite:
            self._sqlite.execute(
                "DELETE FROM ai_records WHERE tenant_id = ? AND kind = ? AND record_id = ?",
                (str(tenant_id), kind, str(record_id)),
            )

    def health(self) -> bool:
        try:
            if self.backend == "postgresql":
                with self._postgres() as connection:
                    return connection.execute("SELECT 1").fetchone() == (1,)
            assert self._sqlite is not None
            with self._lock:
                return self._sqlite.execute("SELECT 1").fetchone()[0] == 1
        except Exception:
            return False
