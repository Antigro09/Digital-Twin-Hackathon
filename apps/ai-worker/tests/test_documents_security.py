from __future__ import annotations

import base64
import io
import zipfile
from uuid import UUID

import pytest
from docx import Document

from edt_ai_worker.documents import DOCX, parse_document
from edt_ai_worker.errors import DomainError
from edt_ai_worker.intelligence_models import DocumentImportRequest


TENANT_ACTOR = UUID("20000000-0000-4000-8000-000000000001")


def request(raw: bytes) -> DocumentImportRequest:
    return DocumentImportRequest.model_validate(
        {
            "document_id": "70000000-0000-4000-8000-000000000001",
            "source_locator": "upload://security-test.docx",
            "media_type": DOCX,
            "content_base64": base64.b64encode(raw).decode("ascii"),
            "source_acl": {
                "visibility": "private",
                "allowed_actor_ids": [str(TENANT_ACTOR)],
            },
        }
    )


def test_normal_docx_remains_supported() -> None:
    document = Document()
    document.add_paragraph("Server01 supports 128 GB RAM.")
    stream = io.BytesIO()
    document.save(stream)

    parsed = parse_document(request(stream.getvalue()), max_bytes=5 * 1024 * 1024)

    assert "Server01 supports 128 GB RAM." in parsed.text
    assert parsed.parser == "python-docx/1.2.0"


def test_expansion_heavy_office_archive_fails_before_document_parser() -> None:
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        archive.writestr("word/document.xml", "A" * (2 * 1024 * 1024))

    with pytest.raises(DomainError) as failure:
        parse_document(request(stream.getvalue()), max_bytes=5 * 1024 * 1024)

    assert failure.value.code == "document_archive_limit_exceeded"
