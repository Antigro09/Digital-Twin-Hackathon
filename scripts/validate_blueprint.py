#!/usr/bin/env python3
"""Validate the Enterprise Digital Twin specification and emit traceability reports.

The validator intentionally uses only the repository's pinned documentation
dependencies.  It performs deterministic structural checks without requiring a
network connection or implementation services.
"""

from __future__ import annotations

import argparse
import copy
import datetime as dt
import hashlib
import json
import re
import sys
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from typing import Any, Iterable, Iterator
from urllib.parse import unquote, urlsplit

import yaml
from jsonschema import Draft202012Validator, FormatChecker, SchemaError
from referencing import Registry, Resource


SEMVER_RE = re.compile(r"^(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)\.(?:0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$")
HORIZON_RE = re.compile(r"^H[1-5]$")
NORMATIVE_ID_PATTERNS = {
    "REQ": re.compile(r"^REQ-[A-Z0-9]+-\d{3}$"),
    "QAR": re.compile(r"^QAR-[A-Z0-9]+-\d{3}$"),
    "ADR": re.compile(r"^ADR-\d{3}$"),
    "CTRL": re.compile(r"^CTRL-[A-Z0-9]+-\d{3}$"),
    "RSK": re.compile(r"^RSK-\d{3}$"),
    "AC": re.compile(r"^AC-[A-Z0-9]+-\d{3}$"),
    "TST": re.compile(r"^TST-[A-Z0-9]+-\d{3}$"),
}
NORMATIVE_REFERENCE_RE = re.compile(
    r"(?<![A-Z0-9-])(?:REQ-[A-Z0-9]+-\d{3}|QAR-[A-Z0-9]+-\d{3}|ADR-\d{3}|"
    r"CTRL-[A-Z0-9]+-\d{3}|RSK-\d{3}|AC-[A-Z0-9]+-\d{3}|TST-[A-Z0-9]+-\d{3})(?![A-Z0-9-])"
)
PLACEHOLDER_RE = re.compile(r"\b(?:TBD|TBC|TODO|FIXME)\b|\?{3,}", re.IGNORECASE)
OWNER_RE = re.compile(r"\bowners?\s*[:=]\s*(?!TBD\b|TBC\b|TODO\b|FIXME\b|none\b)[A-Za-z0-9][A-Za-z0-9 _./-]*", re.IGNORECASE)
MARKDOWN_LINK_RE = re.compile(r"!?\[[^\]]*\]\(([^)]+)\)")
MARKDOWN_REFERENCE_LINK_RE = re.compile(r"^\s*\[[^\]]+\]:\s*(\S+)", re.MULTILINE)
MARKDOWN_AUTOLINK_RE = re.compile(r"<((?:https?://)[^>]+)>", re.IGNORECASE)
MARKDOWN_BARE_URL_RE = re.compile(r"https?://[^\s<>()`\"']+", re.IGNORECASE)
SUPPORTED_MERMAID_RE = re.compile(
    r"^(?:---\s*$|flowchart\b|graph\b|sequenceDiagram\b|stateDiagram(?:-v2)?\b|"
    r"erDiagram\b|classDiagram\b|journey\b|gantt\b|pie\b|mindmap\b|timeline\b|"
    r"quadrantChart\b|requirementDiagram\b|gitGraph\b|C4(?:Context|Container|Component|Dynamic|Deployment)\b)",
    re.IGNORECASE,
)
ALLOWED_MARKDOWN_STATUSES = {
    "committed",
    "accepted",
    "provisional",
    "research",
    "rejected",
    "superseded",
    "deprecated",
    "draft",
}
REQUIRED_TRACE_DIMENSIONS = (
    "artifacts",
    "decisions",
    "components",
    "contracts",
    "controls",
    "acceptance",
    "tests_evaluations",
    "roadmap",
)
REQUIRED_TECHNOLOGIES = {
    "typescript",
    "python",
    "sql",
    "nextjs",
    "react",
    "nestjs",
    "fastify",
    "temporal",
    "postgresql",
    "pgvector",
    "neo4j",
    "s3compatibleobjectstorage",
    "valkey",
    "redis",
    "opensearch",
    "clickhouse",
    "kafka",
    "nats",
    "rest",
    "openapi",
    "sse",
    "graphql",
    "grpc",
    "asyncapi",
    "opentelemetry",
    "docker",
    "dockercompose",
    "kubernetes",
    "helm",
    "opentofu",
    "terraform",
    "servicemesh",
    "go",
    "rust",
    "webassembly",
}
H1_JIRA_COMMAND = {
    "action": "jira.issue.update",
    "connectorInstallationId": "30000000-0000-4000-8000-000000000001",
    "expectedIssueVersion": 7,
    "issueKey": "AST-142",
    "projectKey": "AST",
    "set": {
        "duedate": "2026-07-31",
        "labels": ["digital-twin-remediation", "identity", "orion"],
        "priorityId": "2",
    },
}
H1_ASTER_TENANT_ID = "10000000-0000-4000-8000-000000000001"


class DuplicateKeyError(ValueError):
    """Raised when a JSON or YAML mapping repeats a key."""


class UniqueKeyLoader(yaml.SafeLoader):
    pass


def construct_unique_mapping(loader: UniqueKeyLoader, node: yaml.MappingNode, deep: bool = False) -> dict[Any, Any]:
    loader.flatten_mapping(node)
    result: dict[Any, Any] = {}
    for key_node, value_node in node.value:
        key = loader.construct_object(key_node, deep=deep)
        try:
            duplicate = key in result
        except TypeError as exc:
            raise DuplicateKeyError(f"unhashable YAML mapping key at line {key_node.start_mark.line + 1}") from exc
        if duplicate:
            raise DuplicateKeyError(f"duplicate YAML key {key!r} at line {key_node.start_mark.line + 1}")
        result[key] = loader.construct_object(value_node, deep=deep)
    return result


UniqueKeyLoader.add_constructor(yaml.resolver.BaseResolver.DEFAULT_MAPPING_TAG, construct_unique_mapping)


def construct_unique_json(pairs: list[tuple[str, Any]]) -> dict[str, Any]:
    result: dict[str, Any] = {}
    for key, value in pairs:
        if key in result:
            raise DuplicateKeyError(f"duplicate JSON key {key!r}")
        result[key] = value
    return result


def load_unique_yaml(raw: str) -> Any:
    return yaml.load(raw, Loader=UniqueKeyLoader)


@dataclass(frozen=True, order=True)
class Issue:
    severity: str
    code: str
    path: str
    message: str


def normalize_technology(value: str) -> str:
    return re.sub(r"[^a-z0-9]", "", value.casefold())


def normalize_url(value: str) -> str:
    parsed = urlsplit(value.strip())
    scheme = parsed.scheme.casefold()
    hostname = (parsed.hostname or "").casefold()
    port = parsed.port
    netloc = hostname
    if port and not ((scheme == "http" and port == 80) or (scheme == "https" and port == 443)):
        netloc = f"{hostname}:{port}"
    path = parsed.path or "/"
    if path != "/":
        path = path.rstrip("/")
    query = f"?{parsed.query}" if parsed.query else ""
    fragment = f"#{parsed.fragment}" if parsed.fragment else ""
    return f"{scheme}://{netloc}{path}{query}{fragment}"


def canonical_data(value: Any) -> Any:
    """Normalize YAML-native dates for exact fixture/contract comparisons."""
    if isinstance(value, (dt.datetime, dt.date)):
        return value.isoformat().replace("+00:00", "Z")
    if isinstance(value, dict):
        return {str(key): canonical_data(child) for key, child in value.items()}
    if isinstance(value, list):
        return [canonical_data(child) for child in value]
    return value


def canonical_json_bytes(value: Any) -> bytes:
    """Return deterministic UTF-8 JSON bytes for content-addressed contracts.

    The connector schemas use JSON values whose number forms are already in the
    RFC 8785 canonical domain; sorted keys and compact UTF-8 serialization are
    therefore sufficient for the frozen H1 artifacts.
    """
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def canonical_json_sha256(value: Any) -> str:
    return hashlib.sha256(canonical_json_bytes(value)).hexdigest()


def json_pointer(document: Any, fragment: str) -> Any:
    if fragment in ("", "#"):
        return document
    pointer = fragment[1:] if fragment.startswith("#") else fragment
    pointer = unquote(pointer)
    if not pointer.startswith("/"):
        raise KeyError(f"unsupported JSON Pointer fragment {fragment!r}")
    current = document
    for raw_part in pointer[1:].split("/"):
        part = raw_part.replace("~1", "/").replace("~0", "~")
        if isinstance(current, list):
            current = current[int(part)]
        elif isinstance(current, dict):
            current = current[part]
        else:
            raise KeyError(part)
    return current


def walk_values(value: Any, path: tuple[str, ...] = ()) -> Iterator[tuple[tuple[str, ...], Any]]:
    yield path, value
    if isinstance(value, dict):
        for key, child in value.items():
            yield from walk_values(child, path + (str(key),))
    elif isinstance(value, list):
        for index, child in enumerate(value):
            yield from walk_values(child, path + (str(index),))


class BlueprintValidator:
    def __init__(self, repo_root: Path, spec_root: Path, report_dir: Path) -> None:
        self.repo_root = repo_root.resolve()
        self.spec_root = spec_root.resolve()
        self.report_dir = report_dir.resolve()
        self.issues: list[Issue] = []
        self.machine: dict[Path, Any] = {}
        self.text: dict[Path, str] = {}
        self.markdown_meta: dict[Path, dict[str, Any]] = {}
        self.markdown_body: dict[Path, str] = {}
        self.id_locations: dict[str, list[tuple[Path, str]]] = defaultdict(list)
        self.normative_ids: dict[str, set[str]] = {prefix: set() for prefix in NORMATIVE_ID_PATTERNS}
        self.manifest: dict[str, Any] = {}
        self.trace_report: dict[str, Any] = {}

    def rel(self, path: Path) -> str:
        try:
            return path.resolve().relative_to(self.repo_root).as_posix()
        except ValueError:
            return str(path)

    def error(self, code: str, path: Path | str, message: str) -> None:
        rendered = self.rel(path) if isinstance(path, Path) else path
        self.issues.append(Issue("error", code, rendered, message))

    def warning(self, code: str, path: Path | str, message: str) -> None:
        rendered = self.rel(path) if isinstance(path, Path) else path
        self.issues.append(Issue("warning", code, rendered, message))

    def read_text(self, path: Path) -> str | None:
        if path in self.text:
            return self.text[path]
        try:
            value = path.read_text(encoding="utf-8")
        except (OSError, UnicodeError) as exc:
            self.error("IO001", path, f"cannot read UTF-8 text: {exc}")
            return None
        self.text[path] = value
        return value

    def load_machine_files(self) -> None:
        paths = sorted(
            path
            for path in self.spec_root.rglob("*")
            if path.is_file() and path.suffix.casefold() in {".yaml", ".yml", ".json"}
        )
        for path in paths:
            raw = self.read_text(path)
            if raw is None:
                continue
            try:
                value = (
                    json.loads(raw, object_pairs_hook=construct_unique_json)
                    if path.suffix.casefold() == ".json"
                    else load_unique_yaml(raw)
                )
            except (json.JSONDecodeError, yaml.YAMLError, DuplicateKeyError) as exc:
                self.error("PARSE001", path, f"machine-readable artifact does not parse: {exc}")
                continue
            if value is None:
                self.error("PARSE002", path, "machine-readable artifact is empty")
                continue
            if not isinstance(value, (dict, list)):
                self.error("PARSE003", path, "machine-readable artifact root must be a mapping or list")
                continue
            self.machine[path.resolve()] = value

    def parse_frontmatter(self, path: Path, raw: str) -> tuple[dict[str, Any], str] | None:
        lines = raw.splitlines()
        if not lines or lines[0].strip() != "---":
            self.error("MD001", path, "Markdown file must begin with YAML frontmatter")
            return None
        closing = next((index for index in range(1, len(lines)) if lines[index].strip() == "---"), None)
        if closing is None:
            self.error("MD002", path, "Markdown frontmatter has no closing delimiter")
            return None
        try:
            metadata = load_unique_yaml("\n".join(lines[1:closing]))
        except (yaml.YAMLError, DuplicateKeyError) as exc:
            self.error("MD003", path, f"Markdown frontmatter does not parse: {exc}")
            return None
        if not isinstance(metadata, dict):
            self.error("MD004", path, "Markdown frontmatter must be a mapping")
            return None
        return metadata, "\n".join(lines[closing + 1 :]) + "\n"

    def register_id(self, identifier: str, path: Path, context: str) -> None:
        self.id_locations[identifier].append((path, context))
        for prefix, pattern in NORMATIVE_ID_PATTERNS.items():
            if pattern.fullmatch(identifier):
                self.normative_ids[prefix].add(identifier)
                break

    def validate_markdown(self) -> None:
        required = {"id", "title", "status", "version", "owners", "last_reviewed"}
        for path in sorted(self.spec_root.rglob("*.md")):
            raw = self.read_text(path)
            if raw is None:
                continue
            parsed = self.parse_frontmatter(path, raw)
            if parsed is None:
                continue
            metadata, body = parsed
            self.markdown_meta[path.resolve()] = metadata
            self.markdown_body[path.resolve()] = body
            missing = sorted(required - metadata.keys())
            if missing:
                self.error("MD005", path, f"frontmatter is missing required fields: {', '.join(missing)}")
            identifier = metadata.get("id")
            if not isinstance(identifier, str) or not identifier.strip():
                self.error("MD006", path, "frontmatter id must be a non-empty string")
            else:
                self.register_id(identifier.strip(), path, "frontmatter")
                if path.parent.name == "adrs":
                    if not NORMATIVE_ID_PATTERNS["ADR"].fullmatch(identifier):
                        self.error("ADR001", path, "ADR frontmatter id must have the form ADR-NNN")
                    if not path.name.startswith(f"{identifier}-"):
                        self.error("ADR002", path, "ADR filename must start with its frontmatter id")
            if not isinstance(metadata.get("title"), str) or not str(metadata.get("title", "")).strip():
                self.error("MD007", path, "frontmatter title must be a non-empty string")
            status = str(metadata.get("status", "")).casefold()
            if status not in ALLOWED_MARKDOWN_STATUSES:
                self.error("MD008", path, f"unsupported frontmatter status {metadata.get('status')!r}")
            if path.parent.name == "adrs" and status != "accepted":
                self.error("ADR003", path, "normative ADRs must be accepted for release 1.0.0")
            version = metadata.get("version")
            if not isinstance(version, str) or not SEMVER_RE.fullmatch(version):
                self.error("MD009", path, "frontmatter version must be semantic version text")
            owners = metadata.get("owners")
            if (
                not isinstance(owners, list)
                or not owners
                or any(not isinstance(owner, str) or not owner.strip() or PLACEHOLDER_RE.search(owner) for owner in owners)
            ):
                self.error("MD010", path, "frontmatter owners must be a non-empty list of named owners")
            reviewed = metadata.get("last_reviewed")
            if isinstance(reviewed, dt.date):
                pass
            elif not isinstance(reviewed, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", reviewed):
                self.error("MD011", path, "frontmatter last_reviewed must be an ISO date")
            if not re.search(r"^#\s+\S", body, re.MULTILINE):
                self.error("MD012", path, "Markdown body must contain a level-one heading")
            if status in {"committed", "accepted"}:
                for pointer, value in walk_values(metadata):
                    if isinstance(value, str) and PLACEHOLDER_RE.search(value):
                        self.error("MD013", path, f"committed frontmatter contains a placeholder at /{'/'.join(pointer)}")
                self.validate_placeholders(path, body)

    def validate_placeholders(self, path: Path, text: str) -> None:
        lines = text.splitlines()
        for index, line in enumerate(lines):
            if not PLACEHOLDER_RE.search(line):
                continue
            if re.search(r"\bno\s+unowned\b", line, re.IGNORECASE):
                continue
            nearby = " ".join(lines[max(0, index - 2) : min(len(lines), index + 3)])
            if OWNER_RE.search(nearby):
                self.warning("TBD002", path, f"line {index + 1}: owned placeholder remains in a committed artifact")
            else:
                self.error("TBD001", path, f"line {index + 1}: unowned placeholder remains in a committed artifact")

    def register_catalog_ids(self) -> None:
        catalog_root = (self.spec_root / "catalogs").resolve()
        candidates = [
            (path, value)
            for path, value in self.machine.items()
            if path.is_relative_to(catalog_root) or path.name in {"manifest.yaml", "source-ledger.yaml"}
        ]
        for path, document in candidates:
            for pointer, value in walk_values(document):
                if pointer and pointer[-1] == "id" and isinstance(value, str) and value.strip():
                    self.register_id(value.strip(), path, "/" + "/".join(pointer))

    def validate_unique_ids(self) -> None:
        for identifier, locations in sorted(self.id_locations.items()):
            if len(locations) <= 1:
                continue
            rendered = ", ".join(f"{self.rel(path)}:{context}" for path, context in locations)
            self.error("ID001", locations[0][0], f"identifier {identifier} is defined more than once: {rendered}")

    def machine_at(self, relative: str) -> Any | None:
        return self.machine.get((self.spec_root / relative).resolve())

    def resolve_repo_path(self, base: Path, raw: str, issue_path: Path, code: str) -> Path | None:
        candidate_text = unquote(raw.strip())
        candidate = Path(candidate_text)
        if candidate.is_absolute() or re.match(r"^[A-Za-z]:[\\/]", candidate_text):
            self.error(code, issue_path, f"absolute path is not portable: {raw}")
            return None
        resolved = (base / candidate).resolve()
        try:
            resolved.relative_to(self.repo_root)
        except ValueError:
            self.error(code, issue_path, f"path escapes the repository: {raw}")
            return None
        return resolved

    def validate_manifest(self) -> None:
        path = (self.spec_root / "manifest.yaml").resolve()
        document = self.machine.get(path)
        if not isinstance(document, dict):
            self.error("MAN001", path, "manifest.yaml must parse as a mapping")
            return
        self.manifest = document
        specification = document.get("specification")
        if not isinstance(specification, dict):
            self.error("MAN002", path, "manifest specification must be a mapping")
        else:
            version = specification.get("version")
            if not isinstance(version, str) or not SEMVER_RE.fullmatch(version):
                self.error("MAN003", path, "specification version must be semantic version text")
            if str(specification.get("status", "")).casefold() != "committed":
                self.error("MAN004", path, "release manifest status must be committed")

        listed: dict[Path, str] = {}
        for key in ("documents", "normative_catalogs", "normative_contracts", "normative_fixtures"):
            values = document.get(key)
            if not isinstance(values, list) or not values:
                self.error("MAN005", path, f"manifest {key} must be a non-empty list")
                continue
            for raw in values:
                if not isinstance(raw, str) or not raw.strip():
                    self.error("MAN006", path, f"manifest {key} contains a non-path value")
                    continue
                resolved = self.resolve_repo_path(self.spec_root, raw, path, "MAN007")
                if resolved is None:
                    continue
                if not resolved.exists() or not resolved.is_file():
                    self.error("MAN008", path, f"manifest {key} path does not exist: {raw}")
                if resolved in listed:
                    self.error("MAN009", path, f"manifest path is listed in both {listed[resolved]} and {key}: {raw}")
                listed[resolved] = key

        catalog_dir = self.spec_root / "catalogs"
        listed_catalogs = {
            (self.spec_root / raw).resolve()
            for raw in document.get("normative_catalogs", [])
            if isinstance(raw, str)
        }
        for catalog in sorted(catalog_dir.glob("*.yaml")):
            if catalog.resolve() not in listed_catalogs:
                self.error("MAN010", path, f"catalog is not declared normative: {catalog.relative_to(self.spec_root).as_posix()}")
        listed_documents = {
            (self.spec_root / raw).resolve()
            for raw in document.get("documents", [])
            if isinstance(raw, str)
        }
        for chapter in sorted((self.spec_root / "chapters").glob("*.md")):
            if chapter.resolve() not in listed_documents:
                self.error("MAN010", path, f"chapter is not declared in documents: {chapter.relative_to(self.spec_root).as_posix()}")
        listed_contracts = {
            (self.spec_root / raw).resolve()
            for raw in document.get("normative_contracts", [])
            if isinstance(raw, str)
        }
        contract_suffixes = {".yaml", ".yml", ".json", ".graphql", ".proto"}
        for contract in sorted((self.spec_root / "contracts").rglob("*")):
            if contract.is_file() and contract.suffix.casefold() in contract_suffixes and contract.resolve() not in listed_contracts:
                self.error("MAN010", path, f"contract is not declared normative: {contract.relative_to(self.spec_root).as_posix()}")
        listed_fixtures = {
            (self.spec_root / raw).resolve()
            for raw in document.get("normative_fixtures", [])
            if isinstance(raw, str)
        }
        for fixture in sorted((self.spec_root / "fixtures").rglob("*")):
            if fixture.is_file() and fixture.suffix.casefold() in {".yaml", ".yml", ".json"} and fixture.resolve() not in listed_fixtures:
                self.error("MAN010", path, f"fixture is not declared normative: {fixture.relative_to(self.spec_root).as_posix()}")

        outputs = document.get("generated_outputs")
        if not isinstance(outputs, dict):
            self.error("MAN011", path, "generated_outputs must be a mapping")
        else:
            for name in ("markdown", "html", "pdf", "coverage"):
                if not isinstance(outputs.get(name), str) or not outputs[name]:
                    self.error("MAN012", path, f"generated_outputs.{name} must be a path")
            for name, raw in outputs.items():
                if not isinstance(name, str) or not isinstance(raw, str) or not raw:
                    self.error("MAN012", path, f"generated_outputs.{name} must be a path")
                    continue
                self.resolve_repo_path(self.repo_root, raw, path, "MAN013")

        gates = document.get("release_gates")
        if not isinstance(gates, dict):
            self.error("MAN014", path, "release_gates must be a mapping")
        else:
            for key in (
                "traceability_coverage_percent",
                "maximum_open_critical_risks",
                "maximum_open_high_risks",
                "consecutive_clear_reviews",
            ):
                if not isinstance(gates.get(key), int) or gates[key] < 0:
                    self.error("MAN015", path, f"release_gates.{key} must be a non-negative integer")

    def entries(self, relative: str, key: str) -> list[dict[str, Any]]:
        document = self.machine_at(relative)
        if not isinstance(document, dict) or not isinstance(document.get(key), list):
            self.error("CAT001", self.spec_root / relative, f"catalog must contain a {key} list")
            return []
        result: list[dict[str, Any]] = []
        for index, value in enumerate(document[key]):
            if not isinstance(value, dict):
                self.error("CAT002", self.spec_root / relative, f"{key}[{index}] must be a mapping")
            else:
                result.append(value)
        return result

    def validate_catalogs(self) -> None:
        catalog_specs = (
            ("catalogs/requirements.yaml", "requirements", "REQ", ("title", "statement", "horizon", "status")),
            ("catalogs/quality-attributes.yaml", "quality_attributes", "QAR", ("attribute", "scenario", "response", "measure", "horizon")),
            ("catalogs/controls.yaml", "controls", "CTRL", ("domain", "title", "requirement")),
            ("catalogs/risks.yaml", "risks", "RSK", ("severity", "status", "title", "mitigation", "owner")),
            ("catalogs/acceptance.yaml", "acceptance_criteria", "AC", ("title", "evidence")),
        )
        for relative, key, prefix, required in catalog_specs:
            path = self.spec_root / relative
            for index, item in enumerate(self.entries(relative, key)):
                identifier = item.get("id")
                if not isinstance(identifier, str) or not NORMATIVE_ID_PATTERNS[prefix].fullmatch(identifier):
                    self.error("CAT003", path, f"{key}[{index}].id is not a valid {prefix} identifier")
                for field in required:
                    if field not in item or item[field] in (None, "", []):
                        self.error("CAT004", path, f"{identifier or key + '[' + str(index) + ']'} is missing {field}")
                if "horizon" in item and not HORIZON_RE.fullmatch(str(item["horizon"])):
                    self.error("CAT005", path, f"{identifier} has invalid horizon {item['horizon']!r}")
                if prefix == "REQ" and str(item.get("status", "")).casefold() not in {
                    "committed",
                    "provisional",
                    "research",
                    "rejected",
                }:
                    self.error("CAT006", path, f"{identifier} has an invalid decision status")

        component_path = "catalogs/components.yaml"
        for index, item in enumerate(self.entries(component_path, "components")):
            identifier = item.get("id")
            if not isinstance(identifier, str) or not re.fullmatch(r"CMP-[A-Z0-9-]+", identifier):
                self.error("CAT007", self.spec_root / component_path, f"components[{index}].id must have the form CMP-NAME")
            for field in ("name", "owner", "authority", "interfaces"):
                if item.get(field) in (None, "", []):
                    self.error("CAT008", self.spec_root / component_path, f"{identifier or index} is missing {field}")

    def validate_test_and_roadmap_catalogs(self) -> None:
        requirement_entries = self.entries("catalogs/requirements.yaml", "requirements")
        quality_entries = self.entries("catalogs/quality-attributes.yaml", "quality_attributes")
        sources = {
            item.get("id"): item
            for item in requirement_entries + quality_entries
            if isinstance(item.get("id"), str)
        }

        test_path = self.spec_root / "catalogs/tests-evaluations.yaml"
        tests = self.entries("catalogs/tests-evaluations.yaml", "tests_evaluations")
        covered_by_test: dict[str, list[str]] = defaultdict(list)
        for index, test in enumerate(tests):
            identifier = test.get("id")
            if not isinstance(identifier, str) or not NORMATIVE_ID_PATTERNS["TST"].fullmatch(identifier):
                self.error("TEST001", test_path, f"tests_evaluations[{index}].id must have the form TST-DOMAIN-NNN")
                identifier = f"tests_evaluations[{index}]"
            if test.get("kind") not in {
                "document_conformance",
                "acceptance_review",
                "architecture_test",
                "security_test",
                "contract_test",
                "evaluation",
                "numerical_test",
                "accessibility_test",
                "resilience_test",
                "compatibility_test",
                "end_to_end_test",
            }:
                self.error("TEST002", test_path, f"{identifier} has an unsupported test/evaluation kind")
            for field in ("title", "method", "oracle", "evidence"):
                if not isinstance(test.get(field), str) or not test[field].strip():
                    self.error("TEST003", test_path, f"{identifier} requires non-empty {field}")
            owners = test.get("owners")
            if not isinstance(owners, list) or not owners or any(not isinstance(owner, str) or not owner for owner in owners):
                self.error("TEST004", test_path, f"{identifier} requires named owners")
            horizons = test.get("horizons")
            if not isinstance(horizons, list) or not horizons or any(not isinstance(value, str) or not HORIZON_RE.fullmatch(value) for value in horizons):
                self.error("TEST005", test_path, f"{identifier} requires valid H1-H5 horizons")
                horizons = []
            covers = test.get("covers")
            if not isinstance(covers, list) or not covers or len(covers) != len(set(covers)):
                self.error("TEST006", test_path, f"{identifier} covers must be a non-empty duplicate-free exact-ID list")
                covers = []
            for source_id in covers:
                if source_id not in sources:
                    self.error("TEST007", test_path, f"{identifier} covers unknown source {source_id}")
                    continue
                covered_by_test[source_id].append(str(identifier))
                source_horizon = sources[source_id].get("horizon")
                if source_horizon not in horizons:
                    self.error("TEST008", test_path, f"{identifier} does not declare the {source_horizon} horizon of {source_id}")
        for source_id in sorted(sources):
            if not covered_by_test[source_id]:
                self.error("TEST009", test_path, f"{source_id} is absent from every exact test/evaluation covers list")

        roadmap_path = self.spec_root / "catalogs/roadmap.yaml"
        horizons = self.entries("catalogs/roadmap.yaml", "horizons")
        by_horizon: dict[str, dict[str, Any]] = {}
        roadmap_counts: dict[str, int] = defaultdict(int)
        for index, horizon in enumerate(horizons):
            identifier = horizon.get("id")
            if not isinstance(identifier, str) or not HORIZON_RE.fullmatch(identifier):
                self.error("ROAD001", roadmap_path, f"horizons[{index}].id must be H1-H5")
                continue
            if identifier in by_horizon:
                self.error("ROAD002", roadmap_path, f"duplicate roadmap horizon {identifier}")
            by_horizon[identifier] = horizon
            if horizon.get("status") not in {"committed", "provisional", "research", "rejected"}:
                self.error("ROAD003", roadmap_path, f"{identifier} has an invalid status")
            for field in ("title", "owner", "exit_evidence"):
                if not isinstance(horizon.get(field), str) or not horizon[field].strip():
                    self.error("ROAD004", roadmap_path, f"{identifier} requires non-empty {field}")
            for field, prefix in (("requirements", "REQ-"), ("quality_attributes", "QAR-")):
                values = horizon.get(field)
                if not isinstance(values, list) or len(values) != len(set(values)):
                    self.error("ROAD005", roadmap_path, f"{identifier}.{field} must be a duplicate-free list")
                    continue
                for source_id in values:
                    if not isinstance(source_id, str) or not source_id.startswith(prefix) or source_id not in sources:
                        self.error("ROAD006", roadmap_path, f"{identifier}.{field} references unknown or wrong-kind source {source_id!r}")
                        continue
                    roadmap_counts[source_id] += 1
                    if sources[source_id].get("horizon") != identifier:
                        self.error("ROAD007", roadmap_path, f"{source_id} is assigned to {identifier}, not source horizon {sources[source_id].get('horizon')}")
        if set(by_horizon) != {"H1", "H2", "H3", "H4", "H5"}:
            self.error("ROAD008", roadmap_path, "roadmap must define exactly H1 through H5")
        for source_id in sorted(sources):
            if roadmap_counts[source_id] != 1:
                self.error("ROAD009", roadmap_path, f"{source_id} must appear in exactly one roadmap entry; found {roadmap_counts[source_id]}")

    def validate_h1_fixtures(self) -> None:
        fixture_root = self.spec_root / "fixtures/h1"
        seed_path = fixture_root / "seed-manifest.yaml"
        source_path = fixture_root / "source-fixtures.yaml"
        identity_path = fixture_root / "identity-mappings.yaml"
        permission_path = fixture_root / "permission-matrix.yaml"
        oracle_path = fixture_root / "ground-truth-oracle.yaml"
        seed_doc = self.machine.get(seed_path.resolve())
        source_doc = self.machine.get(source_path.resolve())
        identity_doc = self.machine.get(identity_path.resolve())
        permission_doc = self.machine.get(permission_path.resolve())
        oracle_doc = self.machine.get(oracle_path.resolve())
        for path, document in (
            (seed_path, seed_doc),
            (source_path, source_doc),
            (identity_path, identity_doc),
            (permission_path, permission_doc),
            (oracle_path, oracle_doc),
        ):
            if not isinstance(document, dict):
                self.error("FIX001", path, "required H1 fixture must parse as a mapping")
            elif document.get("schema_version") != 1:
                self.error("FIX001", path, "H1 fixture schema_version must equal 1")
        if not all(isinstance(document, dict) for document in (seed_doc, source_doc, identity_doc, permission_doc, oracle_doc)):
            return

        fixture = canonical_data(seed_doc.get("fixture"))
        expected_fixture = {
            "workload_id": "edt-h1-github-jira-launch-risk",
            "fixture_version": "1.0.0",
            "root_seed": "edt-h1-20260713",
            "simulation_seed": "20260713",
            "frozen_clock": "2026-07-13T16:00:00Z",
            "synthetic_only": True,
            "namespace_marker": "EDT_SYNTHETIC_H1_V1",
            "identity_algorithm": "uuidv5",
            "identity_namespace": "urn:edt:h1",
        }
        if not isinstance(fixture, dict):
            self.error("FIX002", seed_path, "seed manifest requires a fixture mapping")
        else:
            for field, expected in expected_fixture.items():
                if fixture.get(field) != expected:
                    self.error("FIX003", seed_path, f"fixture.{field} must equal {expected!r}")
        artifacts = seed_doc.get("artifacts")
        expected_artifacts = {
            "source_fixtures": "fixtures/h1/source-fixtures.yaml",
            "identity_mappings": "fixtures/h1/identity-mappings.yaml",
            "permission_matrix": "fixtures/h1/permission-matrix.yaml",
            "oracle": "fixtures/h1/ground-truth-oracle.yaml",
        }
        if not isinstance(artifacts, dict) or artifacts != expected_artifacts:
            self.error("FIX004", seed_path, "seed artifact map must name the four frozen H1 companion fixtures exactly")
        digest_manifest = seed_doc.get("artifact_digests")
        companion_documents = {
            "source_fixtures": source_doc,
            "identity_mappings": identity_doc,
            "permission_matrix": permission_doc,
            "oracle": oracle_doc,
        }
        if not isinstance(digest_manifest, dict) or digest_manifest.get("algorithm") != "sha256-canonical-json":
            self.error("FIX004", seed_path, "seed artifact digests must declare sha256-canonical-json")
        else:
            for name, companion in companion_documents.items():
                declared = digest_manifest.get(name)
                computed = canonical_json_sha256(canonical_data(companion))
                if declared != computed:
                    self.error("FIX004", seed_path, f"seed artifact digest mismatch for {name}: declared {declared!r}, computed {computed}")

        tenants = seed_doc.get("tenants")
        if not isinstance(tenants, list) or len(tenants) != 2 or any(not isinstance(item, dict) for item in tenants):
            self.error("FIX005", seed_path, "seed manifest must define exactly two tenants")
            tenants = []
        by_alias = {tenant.get("tenant_alias"): tenant for tenant in tenants if isinstance(tenant.get("tenant_alias"), str)}
        expected_tenants = {
            "tnt_aster": {
                "tenant_id": H1_ASTER_TENANT_ID,
                "display_name": "Aster Labs",
                "human_identities": 48,
                "jira_installation_id": H1_JIRA_COMMAND["connectorInstallationId"],
            },
            "tnt_beacon": {
                "tenant_id": "10000000-0000-4000-8000-000000000002",
                "display_name": "Beacon Works",
                "human_identities": 32,
                "jira_installation_id": "30000000-0000-4000-8000-000000000003",
            },
        }
        if set(by_alias) != set(expected_tenants):
            self.error("FIX006", seed_path, "tenant aliases must be exactly tnt_aster and tnt_beacon")
        for alias, expected in expected_tenants.items():
            tenant = by_alias.get(alias, {})
            for field in ("tenant_id", "display_name", "jira_installation_id"):
                if tenant.get(field) != expected[field]:
                    self.error("FIX007", seed_path, f"{alias}.{field} must equal {expected[field]!r}")
            frozen_counts = tenant.get("frozen_counts") if isinstance(tenant.get("frozen_counts"), dict) else {}
            if frozen_counts.get("human_identities") != expected["human_identities"]:
                self.error("FIX008", seed_path, f"{alias} must freeze exactly {expected['human_identities']} human identities")
            for allowlist in ("jira_allowlist", "github_allowlist"):
                if not isinstance(tenant.get(allowlist), list) or not tenant[allowlist]:
                    self.error("FIX009", seed_path, f"{alias}.{allowlist} must be a non-empty explicit allowlist")
        if sum(
            int((tenant.get("frozen_counts") or {}).get("human_identities", 0))
            for tenant in tenants
            if isinstance(tenant.get("frozen_counts"), dict)
        ) != 80:
            self.error("FIX010", seed_path, "the frozen H1 fixture must contain 80 human identities total (48 Aster + 32 Beacon)")

        generated_people = identity_doc.get("generated_people")
        if not isinstance(generated_people, list):
            self.error("FIX011", identity_path, "identity fixture requires generated_people ranges")
            generated_people = []
        generated_counts = {
            item.get("tenant_id"): item.get("count")
            for item in generated_people
            if isinstance(item, dict)
        }
        if generated_counts != {
            H1_ASTER_TENANT_ID: 48,
            "10000000-0000-4000-8000-000000000002": 32,
        }:
            self.error("FIX012", identity_path, "generated_people must reproduce the exact 48/32 tenant identity counts")

        source_objects = source_doc.get("source_objects")
        if not isinstance(source_objects, list):
            self.error("FIX013", source_path, "source fixture requires source_objects")
            source_objects = []
        by_source_key = {
            item.get("source_key"): canonical_data(item)
            for item in source_objects
            if isinstance(item, dict) and isinstance(item.get("source_key"), str)
        }
        ast142 = by_source_key.get("AST-142")
        expected_before_fields = {
            "summary": "Complete SSO cutover",
            "status": "In Progress",
            "duedate": "2026-08-07",
            "priority": {"id": "3", "name": "Medium"},
            "labels": ["identity", "orion"],
        }
        if not isinstance(ast142, dict):
            self.error("FIX014", source_path, "source fixture must contain AST-142")
        else:
            if ast142.get("tenant_id") != H1_ASTER_TENANT_ID or ast142.get("installation_id") != H1_JIRA_COMMAND["connectorInstallationId"] or ast142.get("source_revision") != "7":
                self.error("FIX015", source_path, "AST-142 must use the frozen Aster tenant, connector installation, and source revision 7")
            fields = ast142.get("fields") if isinstance(ast142.get("fields"), dict) else {}
            for field, expected in expected_before_fields.items():
                if fields.get(field) != expected:
                    self.error("FIX016", source_path, f"AST-142 before field {field} must equal {expected!r}")
        pr184 = by_source_key.get("aster-labs/identity-service#184")
        if not isinstance(pr184, dict) or (pr184.get("fields") or {}).get("linked_issue") != "AST-142" or (pr184.get("fields") or {}).get("required_security_reviews") != 1 or (pr184.get("fields") or {}).get("received_security_reviews") != 0:
            self.error("FIX017", source_path, "identity-service#184 must implement AST-142 and be missing exactly one required security review")

        oracle = canonical_data(oracle_doc)
        if oracle.get("oracle_version") != "1.0.0" or oracle.get("fixture_version") != "1.0.0":
            self.error("FIX018", oracle_path, "oracle_version and fixture_version must both be 1.0.0")
        expected_sections = {"ingestion", "identity_resolution", "graph", "cited_answer", "simulation", "action", "tenant_isolation"}
        missing_sections = expected_sections - set(oracle)
        if missing_sections:
            self.error("FIX019", oracle_path, f"oracle omits required sections: {', '.join(sorted(missing_sections))}")
        graph = oracle.get("graph") if isinstance(oracle.get("graph"), dict) else {}
        expected_path = ["AST-142", "AST-173", "AST-201", "Orion 2.0 General Availability"]
        if graph.get("required_path") != expected_path or graph.get("scheduler_path") != expected_path:
            self.error("FIX020", oracle_path, "graph and scheduler oracle paths must be the frozen AST-142 launch chain")
        cited = oracle.get("cited_answer") if isinstance(oracle.get("cited_answer"), dict) else {}
        if cited.get("strongest_blocker") != "AST-142" or cited.get("required_citation_source_objects") != [
            "aster-jira-AST-142-v7",
            "aster-jira-AST-173-v4",
            "aster-jira-AST-201-v3",
            "aster-github-identity-service-pr-184",
        ]:
            self.error("FIX021", oracle_path, "cited-answer oracle must freeze AST-142 and the four exact source citations")
        if cited.get("required_secondary_risks") != ["OPS-61", "PROD-88"] or cited.get("required_missing_data") != [
            "future security review completion time",
            "unrecorded work",
            "external validity of synthetic duration distributions",
        ]:
            self.error("FIX021", oracle_path, "cited-answer oracle must freeze the secondary risks and three missing-data disclosures")
        simulation = oracle.get("simulation") if isinstance(oracle.get("simulation"), dict) else {}
        expected_intervention = {
            "type": "shift_completion_distribution",
            "work_item_id": "116ab4b3-b108-5f91-ab7e-111f7fba1d45",
            "delta_workdays": -5,
        }
        if simulation.get("seed") != "20260713" or simulation.get("sample_count") != 50000 or simulation.get("model_version") != "pert-monte-carlo/1.0.0" or simulation.get("intervention") != expected_intervention:
            self.error("FIX022", oracle_path, "simulation oracle must freeze the H1 seed, 50,000 trials, model, and AST-142 intervention")
        if simulation.get("baseline") != {"p50": "2026-08-20", "p80": "2026-08-24", "p95": "2026-08-27"} or simulation.get("scenario") != {"p50": "2026-08-13", "p80": "2026-08-17", "p95": "2026-08-20"}:
            self.error("FIX022", oracle_path, "simulation oracle must freeze the baseline and scenario p50/p80/p95 dates")
        action = oracle.get("action") if isinstance(oracle.get("action"), dict) else {}
        expected_internal_payload = {**H1_JIRA_COMMAND, "tenantId": H1_ASTER_TENANT_ID}
        if action.get("exact_internal_payload") != expected_internal_payload:
            self.error("FIX023", oracle_path, "action oracle exact_internal_payload does not match the frozen AST-142 command")
        if action.get("before") != {"version": 7, "duedate": "2026-08-07", "priorityId": "3", "labels": ["identity", "orion"]}:
            self.error("FIX024", oracle_path, "action oracle before snapshot is not the frozen AST-142 version 7 state")
        if action.get("expected_after") != H1_JIRA_COMMAND["set"]:
            self.error("FIX025", oracle_path, "action oracle expected_after does not match the exact Jira set fields")
        action_invariants = {
            "requester_actor_id": "20000000-0000-4000-8000-000000000001",
            "operations_approver_actor_id": "20000000-0000-4000-8000-000000000003",
            "security_approver_actor_id": "20000000-0000-4000-8000-000000000004",
            "approval_ttl_seconds": 900,
            "concurrent_execution_jira_put_count": 1,
            "exact_replay": "original_receipt_and_zero_additional_puts",
            "changed_payload": "denied_and_zero_puts",
            "expired_or_duplicate_approver": "denied_and_zero_puts",
            "ambiguous_timeout": "verification_required_and_no_blind_retry",
        }
        for field, expected in action_invariants.items():
            if action.get(field) != expected:
                self.error("FIX026", oracle_path, f"action oracle {field} must equal {expected!r}")
        if action.get("rollback") != {
            "expiry_seconds": 86400,
            "unchanged_after_state": "restores_before_snapshot_once",
            "later_human_change": "compensation_conflict_and_zero_overwrites",
        }:
            self.error("FIX026", oracle_path, "action rollback oracle must freeze expiry, single restoration, and conflict behavior")
        isolation = oracle.get("tenant_isolation") if isinstance(oracle.get("tenant_isolation"), dict) else {}
        if isolation.get("canary") != "BEACON-CANARY-7Q9K" or isolation.get("expected_aster_occurrences") != 0:
            self.error("FIX027", oracle_path, "tenant-isolation oracle must freeze the Beacon canary at zero Aster occurrences")

    def validate_unknown_references(self) -> None:
        scan_suffixes = {".md", ".yaml", ".yml", ".json", ".graphql", ".proto", ".mmd"}
        for path in sorted(self.spec_root.rglob("*")):
            if not path.is_file() or path.suffix.casefold() not in scan_suffixes:
                continue
            raw = self.read_text(path)
            if raw is None:
                continue
            for match in NORMATIVE_REFERENCE_RE.finditer(raw):
                identifier = match.group(0)
                prefix = identifier.split("-", 1)[0]
                if identifier not in self.normative_ids[prefix]:
                    line = raw.count("\n", 0, match.start()) + 1
                    self.error("REF001", path, f"line {line}: reference to undefined normative id {identifier}")

    def validate_markdown_links(self) -> None:
        for path, body in sorted(self.markdown_body.items()):
            destinations = [match.group(1).strip() for match in MARKDOWN_LINK_RE.finditer(body)]
            destinations.extend(match.group(1).strip() for match in MARKDOWN_REFERENCE_LINK_RE.finditer(body))
            for destination in destinations:
                if destination.startswith("<") and ">" in destination:
                    destination = destination[1 : destination.index(">")]
                else:
                    destination = destination.split(maxsplit=1)[0]
                destination = destination.strip("'\"")
                if not destination or destination.startswith("#"):
                    continue
                parsed = urlsplit(destination)
                if parsed.scheme or parsed.netloc:
                    continue
                local = parsed.path
                if not local:
                    continue
                resolved = self.resolve_repo_path(path.parent, local, path, "LINK001")
                if resolved is not None and not resolved.exists():
                    self.error("LINK002", path, f"local Markdown link does not exist: {destination}")

    def validate_external_citations(self) -> None:
        ledger_path = (self.spec_root / "source-ledger.yaml").resolve()
        ledger = self.machine.get(ledger_path)
        sources = ledger.get("sources") if isinstance(ledger, dict) else None
        if not isinstance(sources, list):
            self.error("SRC001", ledger_path, "source ledger must contain a sources list")
            return
        ledger_urls: set[str] = set()
        for index, source in enumerate(sources):
            if not isinstance(source, dict):
                self.error("SRC002", ledger_path, f"sources[{index}] must be a mapping")
                continue
            url = source.get("url")
            if url is None:
                continue
            if not isinstance(url, str) or urlsplit(url).scheme not in {"http", "https"}:
                self.error("SRC003", ledger_path, f"source {source.get('id', index)} has an invalid external URL")
                continue
            normalized = normalize_url(url)
            if normalized in ledger_urls:
                self.error("SRC004", ledger_path, f"source ledger repeats URL {url}")
            ledger_urls.add(normalized)
            for field in ("id", "title", "accessed", "authority"):
                if source.get(field) in (None, ""):
                    self.error("SRC005", ledger_path, f"source with URL {url} is missing {field}")

        for path, body in sorted(self.markdown_body.items()):
            destinations = [match.group(1).strip() for match in MARKDOWN_LINK_RE.finditer(body)]
            destinations.extend(match.group(1).strip() for match in MARKDOWN_REFERENCE_LINK_RE.finditer(body))
            destinations.extend(match.group(1).strip() for match in MARKDOWN_AUTOLINK_RE.finditer(body))
            destinations.extend(match.group(0).rstrip(".,;:") for match in MARKDOWN_BARE_URL_RE.finditer(body))
            checked: set[str] = set()
            for raw_destination in destinations:
                destination = raw_destination
                if destination.startswith("<") and ">" in destination:
                    destination = destination[1 : destination.index(">")]
                else:
                    destination = destination.split(maxsplit=1)[0]
                destination = destination.strip("'\"")
                parsed = urlsplit(destination)
                if parsed.scheme not in {"http", "https"}:
                    continue
                hostname = (parsed.hostname or "").casefold()
                if hostname == "example.invalid" or hostname.endswith(".example.invalid") or hostname.endswith(".example"):
                    continue
                if hostname in {"json-schema.org", "www.json-schema.org"}:
                    continue
                normalized = normalize_url(destination)
                if normalized in checked:
                    continue
                checked.add(normalized)
                if normalized not in ledger_urls:
                    line = body.count("\n", 0, body.find(raw_destination)) + 1
                    self.error("SRC006", path, f"line {line}: external Markdown citation is absent from source-ledger.yaml: {destination}")

    def validate_mermaid(self) -> None:
        sources = sorted((self.spec_root / "diagrams").glob("*.mmd"))
        if not sources:
            self.error("MMD001", self.spec_root / "diagrams", "at least one Mermaid source is required")
            return
        for path in sources:
            raw = self.read_text(path)
            if raw is None:
                continue
            stripped = raw.lstrip("\ufeff\r\n \t")
            if not stripped:
                self.error("MMD002", path, "Mermaid source is empty")
                continue
            first = stripped.splitlines()[0].strip()
            if not SUPPORTED_MERMAID_RE.match(first):
                self.error("MMD003", path, f"unsupported or missing Mermaid diagram declaration: {first!r}")
            if "```" in raw:
                self.error("MMD004", path, "standalone .mmd sources must not contain Markdown code fences")
            if "\x00" in raw:
                self.error("MMD005", path, "Mermaid source contains a NUL byte")

    def validate_ref(self, owner_path: Path, owner_document: Any, reference: str, code: str) -> None:
        if reference.startswith(("http://", "https://", "urn:")):
            return
        file_part, separator, fragment_part = reference.partition("#")
        target_path = owner_path
        target_document = owner_document
        if file_part:
            resolved = self.resolve_repo_path(owner_path.parent, file_part, owner_path, code)
            if resolved is None:
                return
            if not resolved.exists():
                self.error(code, owner_path, f"reference target does not exist: {reference}")
                return
            target_path = resolved.resolve()
            target_document = self.machine.get(target_path)
            if target_document is None and target_path.suffix.casefold() in {".json", ".yaml", ".yml"}:
                self.error(code, owner_path, f"reference target did not parse: {reference}")
                return
        if separator:
            if target_document is None:
                self.error(code, owner_path, f"cannot resolve a JSON Pointer into non-machine-readable target: {reference}")
                return
            try:
                json_pointer(target_document, "#" + fragment_part)
            except (KeyError, IndexError, ValueError, TypeError) as exc:
                self.error(code, owner_path, f"reference has an invalid JSON Pointer {reference}: {exc}")

    def validate_all_refs(self, path: Path, document: Any, code: str) -> None:
        for pointer, value in walk_values(document):
            if pointer and pointer[-1] == "$ref" and isinstance(value, str):
                self.validate_ref(path, document, value, code)

    def resolve_ref_target(self, owner_path: Path, owner_document: Any, reference: str) -> tuple[Path, Any, Any] | None:
        """Resolve a local/external file reference already covered by structural checks."""
        if reference.startswith(("http://", "https://", "urn:")):
            return None
        file_part, separator, fragment_part = reference.partition("#")
        target_path = owner_path.resolve()
        target_document = owner_document
        if file_part:
            target_path = (owner_path.parent / unquote(file_part)).resolve()
            target_document = self.machine.get(target_path)
        if target_document is None:
            return None
        target: Any = target_document
        if separator:
            try:
                target = json_pointer(target_document, "#" + fragment_part)
            except (KeyError, IndexError, ValueError, TypeError):
                return None
        return target_path, target_document, target

    def schema_parts(
        self,
        owner_path: Path,
        owner_document: Any,
        schema: Any,
        seen: set[tuple[str, str]] | None = None,
    ) -> list[dict[str, Any]]:
        if not isinstance(schema, dict):
            return []
        seen = seen or set()
        if isinstance(schema.get("$ref"), str):
            marker = (str(owner_path.resolve()), schema["$ref"])
            if marker in seen:
                return []
            seen.add(marker)
            resolved = self.resolve_ref_target(owner_path, owner_document, schema["$ref"])
            if resolved is None:
                return []
            target_path, target_document, target = resolved
            return self.schema_parts(target_path, target_document, target, seen)
        parts = [schema]
        for child in schema.get("allOf", []):
            parts.extend(self.schema_parts(owner_path, owner_document, child, seen))
        return parts

    def schema_required(self, owner_path: Path, owner_document: Any, schema: Any) -> set[str]:
        return {
            field
            for part in self.schema_parts(owner_path, owner_document, schema)
            for field in part.get("required", [])
            if isinstance(field, str)
        }

    def schema_properties(self, owner_path: Path, owner_document: Any, schema: Any) -> dict[str, Any]:
        properties: dict[str, Any] = {}
        for part in self.schema_parts(owner_path, owner_document, schema):
            if isinstance(part.get("properties"), dict):
                properties.update(part["properties"])
        return properties

    def validate_openapi_release_contract(self, path: Path, document: dict[str, Any]) -> None:
        paths = document.get("paths") if isinstance(document.get("paths"), dict) else {}
        components = document.get("components") if isinstance(document.get("components"), dict) else {}
        schemas = components.get("schemas") if isinstance(components.get("schemas"), dict) else {}

        # Tenant context is an opaque, server-issued membership choice rather than a raw tenant selector.
        selection = document.get("x-edt-context-selection")
        if not isinstance(selection, dict) or not {"sdk_cli", "browser", "invariant"}.issubset(selection):
            self.error("OAS020", path, "x-edt-context-selection must define sdk_cli, browser, and invariant contracts")
        security_schemes = components.get("securitySchemes") if isinstance(components.get("securitySchemes"), dict) else {}
        expected_context_schemes = {
            "contextHeader": ("header", "X-EDT-Context"),
            "contextCookie": ("cookie", "EDT-Context"),
        }
        for name, (location, wire_name) in expected_context_schemes.items():
            scheme = security_schemes.get(name)
            if not isinstance(scheme, dict) or scheme.get("type") != "apiKey" or scheme.get("in") != location or scheme.get("name") != wire_name:
                self.error("OAS021", path, f"security scheme {name} must be an opaque {location} context named {wire_name}")
        root_security = document.get("security")
        expected_alternatives = {frozenset(("oidc", "contextHeader")), frozenset(("oidc", "contextCookie"))}
        actual_alternatives = {
            frozenset(requirement.keys())
            for requirement in root_security or []
            if isinstance(requirement, dict)
        }
        if actual_alternatives != expected_alternatives:
            self.error("OAS022", path, "global security must require OIDC plus exactly one header/cookie context alternative")
        for pointer, value in walk_values(document):
            if pointer and pointer[-1] == "name" and isinstance(value, str) and value.casefold() == "x-tenant-id":
                self.error("OAS023", path, f"raw X-Tenant-ID parameter is forbidden at /{'/'.join(pointer)}")
        me_operation = (paths.get("/v1/me") or {}).get("get") if isinstance(paths.get("/v1/me"), dict) else None
        if not isinstance(me_operation, dict):
            self.error("OAS024", path, "GET /v1/me is required for server-known membership/context discovery")
        else:
            me_schema = (((me_operation.get("responses") or {}).get("200") or {}).get("content") or {}).get("application/json", {}).get("schema")
            if not {"actor", "active_context", "memberships", "capabilities"}.issubset(
                self.schema_required(path, document, me_schema)
            ):
                self.error("OAS025", path, "GET /v1/me response must require actor, active_context, memberships, and capabilities")

        # A completed question has a typed, evidence-first answer resource rather than an opaque run blob.
        cited_answer = schemas.get("CitedAnswer")
        citation = schemas.get("Citation")
        cited_claim = schemas.get("CitedClaim")
        if not isinstance(cited_answer, dict):
            self.error("OAS026", path, "components.schemas.CitedAnswer is required")
        else:
            expected_answer_fields = {
                "answer",
                "claims",
                "citations",
                "missing_information",
                "abstained",
                "source_freshness",
                "projection_checkpoint",
            }
            missing = expected_answer_fields - self.schema_required(path, document, cited_answer)
            if missing:
                self.error("OAS027", path, f"CitedAnswer omits required grounded-answer fields: {', '.join(sorted(missing))}")
            answer_properties = self.schema_properties(path, document, cited_answer)
            if cited_answer.get("additionalProperties") is not False:
                self.error("OAS027", path, "CitedAnswer must be a closed schema")
            expected_item_refs = {"claims": "#/components/schemas/CitedClaim", "citations": "#/components/schemas/Citation"}
            for field, expected_ref in expected_item_refs.items():
                field_schema = answer_properties.get(field)
                items = field_schema.get("items") if isinstance(field_schema, dict) else None
                if not isinstance(items, dict) or items.get("$ref") != expected_ref:
                    self.error("OAS027", path, f"CitedAnswer.{field} items must reference {expected_ref.rsplit('/', 1)[-1]}")
        if not isinstance(cited_claim, dict) or not {"claim_id", "statement", "epistemic_status", "confidence", "citation_ids"}.issubset(
            self.schema_required(path, document, cited_claim)
        ):
            self.error("OAS028", path, "components.schemas.CitedClaim must bind statements, epistemic status, confidence, and citation ids")
        if not isinstance(citation, dict):
            self.error("OAS028", path, "components.schemas.Citation is required")
        else:
            expected_citation_fields = {
                "claim_id",
                "evidence_id",
                "source_object_id",
                "source_updated_at",
            }
            citation_required = self.schema_required(path, document, citation)
            missing = expected_citation_fields - citation_required
            if not {"source_url", "authorized_locator"}.intersection(citation_required):
                missing.add("source_url_or_authorized_locator")
            if not {"ingested_at", "twin_ingested_at"}.intersection(citation_required):
                missing.add("ingested_at_or_twin_ingested_at")
            if missing:
                self.error("OAS029", path, f"Citation omits required provenance fields: {', '.join(sorted(missing))}")
        answer_operation = (paths.get("/v1/agent-runs/{run_id}/answer") or {}).get("get") if isinstance(paths.get("/v1/agent-runs/{run_id}/answer"), dict) else None
        answer_exposed = False
        if isinstance(answer_operation, dict):
            answer_schema = (((answer_operation.get("responses") or {}).get("200") or {}).get("content") or {}).get("application/json", {}).get("schema")
            answer_parts = self.schema_parts(path, document, answer_schema)
            cited_parts = self.schema_parts(path, document, cited_answer)
            answer_ref = answer_schema.get("$ref") if isinstance(answer_schema, dict) else None
            answer_exposed = bool(
                answer_parts
                and cited_parts
                and any(part is cited_part for part in answer_parts for cited_part in cited_parts)
            ) or answer_ref == "#/components/schemas/CitedAnswer"
        run_operation = (paths.get("/v1/agent-runs/{run_id}") or {}).get("get") if isinstance(paths.get("/v1/agent-runs/{run_id}"), dict) else None
        if isinstance(run_operation, dict):
            run_schema = (((run_operation.get("responses") or {}).get("200") or {}).get("content") or {}).get("application/json", {}).get("schema")
            result_schema = self.schema_properties(path, document, run_schema).get("result")
            result_parts = self.schema_parts(path, document, result_schema)
            cited_parts = self.schema_parts(path, document, cited_answer)
            answer_exposed = answer_exposed or bool(
                result_parts
                and cited_parts
                and any(part is cited_part for part in result_parts for cited_part in cited_parts)
            )
        if not answer_exposed:
            self.error("OAS030", path, "a successful agent-run read must expose the typed CitedAnswer result")

        # Simulation progress is resumable and recoverable from the durable resource.
        simulation_events = paths.get("/v1/simulations/{simulation_id}/events")
        stream_operation = simulation_events.get("get") if isinstance(simulation_events, dict) else None
        if not isinstance(stream_operation, dict):
            self.error("OAS032", path, "simulation SSE endpoint is required")
        else:
            if stream_operation.get("operationId") != "streamSimulationRun":
                self.error("OAS033", path, "simulation SSE operationId must be streamSimulationRun")
            parameters = stream_operation.get("parameters") if isinstance(stream_operation.get("parameters"), list) else []
            has_last_event = any(
                isinstance(parameter, dict)
                and parameter.get("name") == "Last-Event-ID"
                and parameter.get("in") == "header"
                for parameter in parameters
            )
            if not has_last_event:
                self.error("OAS034", path, "simulation SSE must accept the Last-Event-ID header")
            responses = stream_operation.get("responses") if isinstance(stream_operation.get("responses"), dict) else {}
            stream_content = (responses.get("200") or {}).get("content") if isinstance(responses.get("200"), dict) else {}
            if not isinstance(stream_content, dict) or "text/event-stream" not in stream_content:
                self.error("OAS035", path, "simulation SSE 200 response must define text/event-stream")
            if "410" not in responses:
                self.error("OAS036", path, "simulation SSE must define 410 recovery when event history expires")

        # The sole H1 Jira command is frozen field-for-field, including canonical label order.
        command = schemas.get("JiraIssueUpdateCommand")
        if not isinstance(command, dict):
            self.error("OAS037", path, "components.schemas.JiraIssueUpdateCommand is required")
        else:
            command_required = set(H1_JIRA_COMMAND)
            properties = self.schema_properties(path, document, command)
            if command.get("additionalProperties") is not False or self.schema_required(path, document, command) != command_required or set(properties) != command_required:
                self.error("OAS038", path, "JiraIssueUpdateCommand must be a closed schema with only the frozen command fields")
            for field in ("action", "connectorInstallationId", "expectedIssueVersion", "issueKey", "projectKey"):
                field_schema = properties.get(field)
                if not isinstance(field_schema, dict) or field_schema.get("const") != H1_JIRA_COMMAND[field]:
                    self.error("OAS039", path, f"JiraIssueUpdateCommand.{field} must equal {H1_JIRA_COMMAND[field]!r}")
            set_schema = properties.get("set")
            set_properties = self.schema_properties(path, document, set_schema)
            expected_set = H1_JIRA_COMMAND["set"]
            if not isinstance(set_schema, dict) or set_schema.get("additionalProperties") is not False or self.schema_required(path, document, set_schema) != set(expected_set) or set(set_properties) != set(expected_set):
                self.error("OAS040", path, "JiraIssueUpdateCommand.set must be closed to duedate, labels, and priorityId")
            for field in ("duedate", "priorityId"):
                field_schema = set_properties.get(field)
                if not isinstance(field_schema, dict) or field_schema.get("const") != expected_set[field]:
                    self.error("OAS041", path, f"JiraIssueUpdateCommand.set.{field} must equal {expected_set[field]!r}")
            labels_schema = set_properties.get("labels")
            labels = [item.get("const") for item in labels_schema.get("prefixItems", []) if isinstance(item, dict)] if isinstance(labels_schema, dict) else []
            if labels != expected_set["labels"] or labels_schema.get("items") is not False or labels_schema.get("uniqueItems") is not True:
                self.error("OAS042", path, "JiraIssueUpdateCommand labels must be the exact sorted H1 label tuple")
        approved = schemas.get("ApprovedJiraIssueUpdate")
        approved_properties = self.schema_properties(path, document, approved)
        tenant_schema = approved_properties.get("tenantId")
        if not isinstance(approved, dict) or not isinstance(tenant_schema, dict) or tenant_schema.get("const") != H1_ASTER_TENANT_ID:
            self.error("OAS043", path, "ApprovedJiraIssueUpdate must inject the frozen Aster tenantId")

    def validate_openapi(self) -> None:
        path = (self.spec_root / "contracts/openapi/enterprise-digital-twin.openapi.yaml").resolve()
        document = self.machine.get(path)
        if not isinstance(document, dict):
            self.error("OAS001", path, "OpenAPI contract must parse as a mapping")
            return
        if not str(document.get("openapi", "")).startswith("3.1."):
            self.error("OAS002", path, "OpenAPI contract must use OpenAPI 3.1")
        info = document.get("info")
        if not isinstance(info, dict) or not info.get("title") or not info.get("version"):
            self.error("OAS003", path, "OpenAPI info.title and info.version are required")
        paths = document.get("paths")
        if not isinstance(paths, dict) or not paths:
            self.error("OAS004", path, "OpenAPI paths must be a non-empty mapping")
            return
        operation_ids: dict[str, str] = {}
        methods = {"get", "put", "post", "delete", "options", "head", "patch", "trace"}
        for route, path_item in paths.items():
            if not isinstance(route, str) or not route.startswith("/"):
                self.error("OAS005", path, f"invalid OpenAPI route {route!r}")
                continue
            if not isinstance(path_item, dict):
                self.error("OAS006", path, f"path item {route} must be a mapping")
                continue
            for method, operation in path_item.items():
                if method.casefold() not in methods:
                    continue
                if not isinstance(operation, dict):
                    self.error("OAS007", path, f"operation {method.upper()} {route} must be a mapping")
                    continue
                operation_id = operation.get("operationId")
                if not isinstance(operation_id, str) or not operation_id:
                    self.error("OAS008", path, f"operation {method.upper()} {route} has no operationId")
                elif operation_id in operation_ids:
                    self.error("OAS009", path, f"duplicate operationId {operation_id} on {operation_ids[operation_id]} and {method.upper()} {route}")
                else:
                    operation_ids[operation_id] = f"{method.upper()} {route}"
                responses = operation.get("responses")
                if not isinstance(responses, dict) or not responses:
                    self.error("OAS010", path, f"operation {method.upper()} {route} has no responses")
        components = document.get("components")
        if not isinstance(components, dict) or not isinstance(components.get("securitySchemes"), dict):
            self.error("OAS011", path, "OpenAPI components.securitySchemes is required")
        for name, schema in (components or {}).get("schemas", {}).items():
            try:
                Draft202012Validator.check_schema(schema)
            except SchemaError as exc:
                self.error("OAS012", path, f"component schema {name} is invalid JSON Schema: {exc.message}")
        self.validate_openapi_release_contract(path, document)
        self.validate_all_refs(path, document, "OAS013")

    def validate_asyncapi(self) -> None:
        path = (self.spec_root / "contracts/asyncapi/events.asyncapi.yaml").resolve()
        document = self.machine.get(path)
        if not isinstance(document, dict):
            self.error("AAS001", path, "AsyncAPI contract must parse as a mapping")
            return
        if not str(document.get("asyncapi", "")).startswith("3."):
            self.error("AAS002", path, "AsyncAPI contract must use AsyncAPI 3.x")
        info = document.get("info")
        if not isinstance(info, dict) or not info.get("title") or not info.get("version"):
            self.error("AAS003", path, "AsyncAPI info.title and info.version are required")
        channels = document.get("channels")
        operations = document.get("operations")
        if not isinstance(channels, dict) or not channels:
            self.error("AAS004", path, "AsyncAPI channels must be a non-empty mapping")
        if not isinstance(operations, dict) or not operations:
            self.error("AAS005", path, "AsyncAPI operations must be a non-empty mapping")
        addresses: set[str] = set()
        for name, channel in (channels or {}).items():
            if not isinstance(channel, dict) or not channel.get("address") or not isinstance(channel.get("messages"), dict):
                self.error("AAS006", path, f"channel {name} requires address and messages")
                continue
            address = str(channel["address"])
            if address in addresses:
                self.error("AAS007", path, f"duplicate channel address {address}")
            addresses.add(address)
        for name, operation in (operations or {}).items():
            if not isinstance(operation, dict) or operation.get("action") not in {"send", "receive"} or "channel" not in operation:
                self.error("AAS008", path, f"operation {name} requires send/receive action and channel")
        envelope = ((document.get("components") or {}).get("schemas") or {}).get("EventEnvelope")
        if not isinstance(envelope, dict):
            self.error("AAS009", path, "CloudEvents EventEnvelope schema is required")
        else:
            required = set(envelope.get("required", []))
            missing = {"specversion", "id", "source", "type", "subject", "time", "tenant_id", "partition_key"} - required
            if not {"trace_id", "traceparent"}.intersection(required):
                missing.add("trace_id_or_traceparent")
            if missing:
                self.error("AAS010", path, f"EventEnvelope omits required CloudEvents/tenant fields: {', '.join(sorted(missing))}")
            try:
                Draft202012Validator.check_schema(envelope)
            except SchemaError as exc:
                self.error("AAS011", path, f"EventEnvelope is invalid JSON Schema: {exc.message}")

        messages = ((document.get("components") or {}).get("messages") or {})
        payload_refs: dict[str, str] = {}
        event_types: dict[str, str] = {}
        for message_name, message in messages.items():
            if not isinstance(message, dict) or not isinstance(message.get("payload"), dict):
                self.error("AAS013", path, f"message {message_name} requires a typed payload schema")
                continue
            payload = message["payload"]
            payload_ref = payload.get("$ref")
            if isinstance(payload_ref, str):
                if payload_ref in payload_refs:
                    self.error("AAS014", path, f"messages {payload_refs[payload_ref]} and {message_name} share one untyped payload {payload_ref}")
                payload_refs[payload_ref] = message_name
            parts = self.schema_parts(path, document, payload)
            required = self.schema_required(path, document, payload)
            properties = self.schema_properties(path, document, payload)
            missing = {"specversion", "id", "source", "type", "subject", "time", "tenant_id", "partition_key", "data"} - required
            if not {"trace_id", "traceparent"}.intersection(required):
                missing.add("trace_id_or_traceparent")
            if not parts or missing:
                self.error("AAS015", path, f"message {message_name} payload omits typed envelope fields: {', '.join(sorted(missing))}")
            type_schema = properties.get("type")
            event_type = type_schema.get("const") if isinstance(type_schema, dict) else None
            if not isinstance(event_type, str) or not event_type.startswith(("com.enterprisedigitaltwin.", "com.enterprise-digital-twin.")):
                self.error("AAS016", path, f"message {message_name} payload must fix a namespaced event type const")
            elif event_type in event_types:
                self.error("AAS017", path, f"messages {event_types[event_type]} and {message_name} reuse event type {event_type}")
            else:
                event_types[event_type] = message_name
            data_schema = properties.get("data")
            data_parts = self.schema_parts(path, document, data_schema)
            data_required = self.schema_required(path, document, data_schema)
            data_closed = any(part.get("additionalProperties") is False for part in data_parts)
            if not data_parts or not data_required or not data_closed:
                self.error("AAS018", path, f"message {message_name} data must resolve to a closed message-specific schema with required fields")
        self.validate_all_refs(path, document, "AAS012")

    @staticmethod
    def strip_quoted_text(value: str) -> str:
        value = re.sub(r'""".*?"""', "", value, flags=re.DOTALL)
        value = re.sub(r'"(?:\\.|[^"\\])*"', '""', value)
        return value

    def validate_balanced(self, path: Path, value: str, pairs: dict[str, str], code: str) -> None:
        stack: list[tuple[str, int]] = []
        closers = {closer: opener for opener, closer in pairs.items()}
        for index, char in enumerate(value):
            if char in pairs:
                stack.append((char, index))
            elif char in closers:
                if not stack or stack[-1][0] != closers[char]:
                    self.error(code, path, f"unbalanced delimiter {char!r} at character {index + 1}")
                    return
                stack.pop()
        if stack:
            self.error(code, path, f"unclosed delimiter {stack[-1][0]!r} at character {stack[-1][1] + 1}")

    def validate_graphql(self) -> None:
        path = self.spec_root / "contracts/graphql/schema.graphql"
        raw = self.read_text(path)
        if raw is None:
            return
        cleaned = self.strip_quoted_text(re.sub(r"#.*$", "", raw, flags=re.MULTILINE))
        self.validate_balanced(path, cleaned, {"{": "}", "(": ")", "[": "]"}, "GQL001")
        if not re.search(r"\bschema\s*\{[^}]*\bquery\s*:\s*Query\b", cleaned, re.DOTALL):
            self.error("GQL002", path, "GraphQL schema must declare Query as its query root")
        if not re.search(r"\btype\s+Query\s*\{", cleaned):
            self.error("GQL003", path, "GraphQL schema must define type Query")
        if re.search(r"\btype\s+(?:Mutation|Subscription)\s*\{", cleaned):
            self.error("GQL004", path, "the deferred GraphQL surface must remain read-only")
        definitions = re.findall(r"\b(?:type|interface|input|enum|union|scalar)\s+([_A-Za-z][_0-9A-Za-z]*)", cleaned)
        duplicates = sorted(name for name in set(definitions) if definitions.count(name) > 1)
        if duplicates:
            self.error("GQL005", path, f"duplicate GraphQL definitions: {', '.join(duplicates)}")

    @staticmethod
    def named_blocks(value: str, keyword: str) -> list[tuple[str, str]]:
        blocks: list[tuple[str, str]] = []
        pattern = re.compile(rf"\b{keyword}\s+([A-Za-z_]\w*)\s*\{{")
        for match in pattern.finditer(value):
            depth = 1
            index = match.end()
            while index < len(value) and depth:
                if value[index] == "{":
                    depth += 1
                elif value[index] == "}":
                    depth -= 1
                index += 1
            if depth == 0:
                blocks.append((match.group(1), value[match.end() : index - 1]))
        return blocks

    def validate_proto(self) -> None:
        path = self.spec_root / "contracts/proto/digital_twin.proto"
        raw = self.read_text(path)
        if raw is None:
            return
        cleaned = re.sub(r"/\*.*?\*/", "", raw, flags=re.DOTALL)
        cleaned = re.sub(r"//.*$", "", cleaned, flags=re.MULTILINE)
        cleaned = self.strip_quoted_text(cleaned)
        self.validate_balanced(path, cleaned, {"{": "}", "(": ")", "[": "]"}, "PROTO001")
        if not re.search(r'^\s*syntax\s*=\s*"proto3"\s*;', raw, re.MULTILINE):
            self.error("PROTO002", path, "Protobuf contract must declare proto3 syntax")
        if not re.search(r"^\s*package\s+[A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s*;", cleaned, re.MULTILINE):
            self.error("PROTO003", path, "Protobuf contract must declare a package")
        messages = self.named_blocks(cleaned, "message")
        services = self.named_blocks(cleaned, "service")
        enums = self.named_blocks(cleaned, "enum")
        for kind, blocks in (("message", messages), ("service", services), ("enum", enums)):
            names = [name for name, _ in blocks]
            duplicates = sorted(name for name in set(names) if names.count(name) > 1)
            if duplicates:
                self.error("PROTO004", path, f"duplicate {kind} definitions: {', '.join(duplicates)}")
        declared_types = {name for name, _ in messages + enums}
        scalar_types = {
            "double", "float", "int32", "int64", "uint32", "uint64", "sint32", "sint64",
            "fixed32", "fixed64", "sfixed32", "sfixed64", "bool", "string", "bytes",
        }
        for name, body in messages:
            tags = [int(tag) for tag in re.findall(r"\b(?:repeated\s+)?[.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*\s+[A-Za-z_]\w*\s*=\s*(\d+)\b", body)]
            duplicates = sorted(tag for tag in set(tags) if tags.count(tag) > 1)
            if duplicates:
                self.error("PROTO005", path, f"message {name} reuses field numbers: {duplicates}")
            invalid = [tag for tag in tags if tag <= 0 or tag > 536870911 or 19000 <= tag <= 19999]
            if invalid:
                self.error("PROTO006", path, f"message {name} uses invalid or reserved field numbers: {invalid}")
            field_types = re.findall(
                r"\b(?:repeated\s+|optional\s+)?([.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s+[A-Za-z_]\w*\s*=\s*\d+\b",
                body,
            )
            for field_type in field_types:
                short_name = field_type.lstrip(".").split(".")[-1]
                if field_type not in scalar_types and short_name not in declared_types and not field_type.lstrip(".").startswith("google.protobuf."):
                    self.error("PROTO010", path, f"message {name} references undefined field type {field_type}")
        for name, body in services:
            methods = re.findall(r"\brpc\s+([A-Za-z_]\w*)\s*\(", body)
            duplicates = sorted(method for method in set(methods) if methods.count(method) > 1)
            if duplicates:
                self.error("PROTO007", path, f"service {name} repeats RPC names: {', '.join(duplicates)}")
            for input_type, output_type in re.findall(
                r"\brpc\s+[A-Za-z_]\w*\s*\(\s*(?:stream\s+)?([.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\)\s*"
                r"returns\s*\(\s*(?:stream\s+)?([.A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*\)",
                body,
            ):
                for rpc_type in (input_type, output_type):
                    if rpc_type.lstrip(".").split(".")[-1] not in declared_types:
                        self.error("PROTO011", path, f"service {name} references undefined RPC type {rpc_type}")
        for imported in re.findall(r'^\s*import\s+"([^"]+)"\s*;', raw, re.MULTILINE):
            if imported.startswith("google/protobuf/"):
                continue
            target = self.resolve_repo_path(path.parent, imported, path, "PROTO008")
            if target is not None and not target.exists():
                self.error("PROTO009", path, f"Protobuf import does not exist: {imported}")

    def validate_json_schemas(self) -> None:
        schema_paths = sorted((self.spec_root / "contracts").rglob("*.schema.json"))
        if not schema_paths:
            self.error("JSC001", self.spec_root / "contracts/schemas", "at least one JSON Schema contract is required")
            return
        schema_ids: dict[str, Path] = {}
        for path in schema_paths:
            document = self.machine.get(path.resolve())
            if not isinstance(document, dict):
                self.error("JSC002", path, "JSON Schema must parse as an object")
                continue
            if document.get("$schema") != "https://json-schema.org/draft/2020-12/schema":
                self.error("JSC003", path, "JSON Schema must declare the 2020-12 dialect")
            schema_id = document.get("$id")
            if not isinstance(schema_id, str) or not schema_id:
                self.error("JSC004", path, "JSON Schema must declare a stable $id")
            elif schema_id in schema_ids:
                self.error("JSC005", path, f"duplicate JSON Schema $id also used by {self.rel(schema_ids[schema_id])}")
            else:
                schema_ids[schema_id] = path
            try:
                Draft202012Validator.check_schema(document)
            except SchemaError as exc:
                self.error("JSC006", path, f"invalid JSON Schema: {exc.message}")
            self.validate_all_refs(path.resolve(), document, "JSC007")

    def validate_connector_packages(self) -> None:
        connector_root = (self.spec_root / "contracts/connectors").resolve()
        fixture_root = (self.spec_root / "fixtures/h1/connectors").resolve()
        shared_path = (self.spec_root / "contracts/schemas/connector-manifest.schema.json").resolve()
        shared_schema = self.machine.get(shared_path)
        if not isinstance(shared_schema, dict):
            self.error("CONN001", shared_path, "shared connector manifest schema must parse as an object")
            return

        github_mutation: list[dict[str, Any]] = []
        jira_mutation = [
            {
                "command": "jira_issue_remediation_v1",
                "target_resource": "issue",
                "operation": "PUT /rest/api/3/issue/{issueIdOrKey}",
                "default_enabled": False,
                "approval_class": "two_person_exact_payload_15_minutes",
                "idempotency_class": "workflow_receipt_provider_verification",
                "compensation_command": "jira_issue_remediation_restore_v1",
            }
        ]
        profiles: dict[str, dict[str, Any]] = {
            "github": {
                "directory": "github",
                "manifest_id": "com.enterprise-digital-twin.connector.github",
                "fixture_prefix": "github-pr-184",
                "tenant_id": "10000000-0000-4000-8000-000000000001",
                "installation_id": "30000000-0000-4000-8000-000000000002",
                "source_key": "aster-labs/identity-service#184",
                "permissions": {
                    ("metadata", "read"),
                    ("contents", "read"),
                    ("pull_requests", "read"),
                    ("actions", "read"),
                    ("checks", "read"),
                    ("deployments", "read"),
                    ("members", "read"),
                },
                "forbidden": {"administration", "secrets", "variables", "billing", "emails", "security_events", "repository_hooks_write"},
                "reads": {
                    "installation_repositories": ("metadata:read", "GET /installation/repositories"),
                    "repository_metadata": ("metadata:read", "GET /repos/{owner}/{repo}"),
                    "branches": ("contents:read", "GET /repos/{owner}/{repo}/branches"),
                    "commits": ("contents:read", "GET /repos/{owner}/{repo}/commits"),
                    "comparisons": ("contents:read", "GET /repos/{owner}/{repo}/compare/{base}...{head}"),
                    "pull_requests": ("pull_requests:read", "GET /repos/{owner}/{repo}/pulls"),
                    "pull_request_reviews": ("pull_requests:read", "GET /repos/{owner}/{repo}/pulls/{number}/reviews"),
                    "workflow_runs": ("actions:read", "GET /repos/{owner}/{repo}/actions/runs"),
                    "workflow_jobs": ("actions:read", "GET /repos/{owner}/{repo}/actions/runs/{run_id}/jobs"),
                    "check_runs": ("checks:read", "GET /repos/{owner}/{repo}/commits/{ref}/check-runs"),
                    "deployments": ("deployments:read", "GET /repos/{owner}/{repo}/deployments"),
                    "deployment_statuses": ("deployments:read", "GET /repos/{owner}/{repo}/deployments/{deployment_id}/statuses"),
                    "organization_members": ("members:read", "GET /orgs/{org}/members"),
                    "teams": ("members:read", "GET /orgs/{org}/teams"),
                },
                "events": {
                    "installation": "installation_repositories",
                    "installation_repositories": "installation_repositories",
                    "repository": "repository_metadata",
                    "push": "commits",
                    "pull_request": "pull_requests",
                    "pull_request_review": "pull_request_reviews",
                    "workflow_run": "workflow_runs",
                    "check_run": "check_runs",
                    "deployment": "deployments",
                    "deployment_status": "deployment_statuses",
                    "membership": "organization_members",
                    "team": "teams",
                },
                "mutations": github_mutation,
                "network": [{"host": "api.github.com", "port": 443, "path_prefixes": ["/app/installations/", "/installation/repositories", "/orgs/", "/organizations/", "/repos/"]}],
                "included": {"repository_identity", "visibility", "topics", "branch_and_commit_metadata", "pull_request_metadata", "review_state", "workflow_run_metadata", "check_status", "deployment_status", "member_and_team_identity"},
                "excluded": {"source_file_bodies", "repository_archives", "patches_and_diffs", "secrets", "variables", "actions_logs", "private_messages", "billing", "email", "security_alert_bodies"},
            },
            "jira": {
                "directory": "jira-cloud",
                "manifest_id": "com.enterprise-digital-twin.connector.jira-cloud",
                "fixture_prefix": "jira-ast-142",
                "tenant_id": "10000000-0000-4000-8000-000000000001",
                "installation_id": "30000000-0000-4000-8000-000000000001",
                "source_key": "AST-142",
                "permissions": {
                    ("read:jira-work", "read"),
                    ("read:jira-user", "read"),
                    ("write:jira-work", "write"),
                    ("manage:jira-webhook", "manage"),
                    ("offline_access", "offline"),
                },
                "forbidden": {"manage:jira-project", "manage:jira-configuration", "admin", "service-management-write", "granular-scopes"},
                "reads": {
                    "accessible_resources": ("read:jira-work", "GET /oauth/token/accessible-resources"),
                    "self": ("read:jira-user", "GET /rest/api/3/myself"),
                    "fields": ("read:jira-work", "GET /rest/api/3/field/search"),
                    "projects": ("read:jira-work", "GET /rest/api/3/project/search"),
                    "issues": ("read:jira-work", "GET /rest/api/3/search/jql"),
                    "issue_changelog": ("read:jira-work", "GET /rest/api/3/issue/{issueIdOrKey}/changelog"),
                    "statuses": ("read:jira-work", "GET /rest/api/3/status"),
                    "versions": ("read:jira-work", "GET /rest/api/3/project/{projectIdOrKey}/version"),
                    "sprints": ("read:jira-work", "GET /rest/agile/1.0/board/{boardId}/sprint"),
                    "comments": ("read:jira-work", "GET /rest/api/3/issue/{issueIdOrKey}/comment"),
                    "webhooks": ("manage:jira-webhook", "GET /rest/api/3/webhook"),
                },
                "events": {
                    "jira:issue_created": "issues",
                    "jira:issue_updated": "issues",
                    "jira:issue_deleted": "issues",
                    "comment_created": "comments",
                    "comment_updated": "comments",
                    "comment_deleted": "comments",
                },
                "mutations": jira_mutation,
                "network": [
                    {"host": "auth.atlassian.com", "port": 443, "path_prefixes": ["/authorize", "/oauth/token"]},
                    {"host": "api.atlassian.com", "port": 443, "path_prefixes": ["/oauth/token/accessible-resources", "/ex/jira/"]},
                ],
                "included": {"accessible_resource_and_account_identity", "field_and_project_metadata", "issue_key_type_summary_and_status", "priority_labels_and_due_date", "assignee_and_reporter_references", "parent_subtask_and_issue_links", "sprint_version_and_project_membership", "created_updated_and_bounded_changelog", "comment_metadata_when_enabled", "attachment_metadata_only"},
                "excluded": {"attachment_content", "worklogs", "environment", "development_panel_content", "service_management_content", "admin_configuration", "comment_bodies_when_disabled", "secrets_tokens_and_authorization_headers"},
            },
        }

        expected_schema_files = {
            "schemas/raw-envelope.schema.json",
            "schemas/raw-payload.schema.json",
            "schemas/normalized-observation.schema.json",
            "schemas/cursor.schema.json",
            "schemas/ontology-mapping.schema.json",
        }
        expected_package_files = {"manifest.json", *expected_schema_files}
        schema_keys = {"raw_envelope", "raw_payload", "normalized_observation", "cursor", "ontology_mapping"}
        format_checker = FormatChecker()
        shared_validator = Draft202012Validator(shared_schema, format_checker=format_checker)

        def profile_violations(manifest: dict[str, Any], profile: dict[str, Any]) -> list[str]:
            violations: list[str] = []
            auth = manifest.get("auth") if isinstance(manifest.get("auth"), dict) else {}
            actual_permissions = {
                (item.get("name"), item.get("access"))
                for item in auth.get("required_permissions", [])
                if isinstance(item, dict)
            }
            if actual_permissions != profile["permissions"]:
                violations.append("required permission/scope set differs from the frozen H1 allowlist")
            if set(auth.get("forbidden_permissions", [])) != profile["forbidden"]:
                violations.append("forbidden permission/scope set differs from the frozen H1 denylist")

            capabilities = manifest.get("capabilities") if isinstance(manifest.get("capabilities"), dict) else {}
            actual_reads = {
                item.get("resource"): (item.get("required_permission"), item.get("reconciliation_fetch"))
                for item in capabilities.get("reads", [])
                if isinstance(item, dict) and isinstance(item.get("resource"), str)
            }
            if actual_reads != profile["reads"]:
                violations.append("read resource, permission, or reconciliation-fetch allowlist differs from H1")
            actual_events = {
                item.get("event"): item.get("reconciliation_resource")
                for item in capabilities.get("events", [])
                if isinstance(item, dict) and isinstance(item.get("event"), str)
            }
            if actual_events != profile["events"]:
                violations.append("event-to-reconciliation allowlist differs from H1")
            if canonical_data(capabilities.get("mutations", [])) != canonical_data(profile["mutations"]):
                violations.append("mutation capability set differs from the frozen H1 boundary")

            network = manifest.get("network_policy") if isinstance(manifest.get("network_policy"), dict) else {}
            if canonical_data(network.get("rules", [])) != canonical_data(profile["network"]):
                violations.append("egress host, port, or path-prefix allowlist differs from H1")
            data_policy = manifest.get("data_policy") if isinstance(manifest.get("data_policy"), dict) else {}
            if set(data_policy.get("included_fields", [])) != profile["included"]:
                violations.append("included data-field set differs from H1")
            if set(data_policy.get("excluded_fields", [])) != profile["excluded"]:
                violations.append("excluded data-field set differs from H1")
            health = manifest.get("health") if isinstance(manifest.get("health"), dict) else {}
            health_types = {item.get("type") for item in health.get("checks", []) if isinstance(item, dict)}
            if health_types != {"credential", "webhook", "freshness", "quota", "reconciliation"}:
                violations.append("health checks must contain each required H1 check exactly once")
            return violations

        for provider, profile in profiles.items():
            package_dir = (connector_root / profile["directory"]).resolve()
            manifest_path = (package_dir / "manifest.json").resolve()
            if not package_dir.is_dir():
                self.error("CONN002", package_dir, f"missing H1 {provider} connector package")
                continue
            actual_package_files = {
                path.relative_to(package_dir).as_posix()
                for path in package_dir.rglob("*")
                if path.is_file() and path.suffix.casefold() in {".json", ".yaml", ".yml"}
            }
            if actual_package_files != expected_package_files:
                missing = sorted(expected_package_files - actual_package_files)
                unexpected = sorted(actual_package_files - expected_package_files)
                self.error("CONN003", package_dir, f"package file set mismatch; missing={missing}, unexpected={unexpected}")

            manifest = self.machine.get(manifest_path)
            if not isinstance(manifest, dict):
                self.error("CONN004", manifest_path, "connector manifest must parse as an object")
                continue
            for failure in sorted(shared_validator.iter_errors(manifest), key=lambda item: list(item.absolute_path)):
                pointer = "/" + "/".join(str(part) for part in failure.absolute_path)
                self.error("CONN005", manifest_path, f"manifest schema violation at {pointer}: {failure.message}")
            if manifest.get("id") != profile["manifest_id"] or manifest.get("provider") != provider:
                self.error("CONN006", manifest_path, "manifest ID/provider does not match its frozen package")
            for violation in profile_violations(manifest, profile):
                self.error("CONN007", manifest_path, violation)

            refs = manifest.get("schemas")
            if not isinstance(refs, dict) or set(refs) != schema_keys:
                self.error("CONN008", manifest_path, f"schemas must contain exactly {sorted(schema_keys)}")
                refs = {}
            schema_documents: dict[str, dict[str, Any]] = {}
            registry = Registry()
            for schema_name, expected_relative in {
                "raw_envelope": "schemas/raw-envelope.schema.json",
                "raw_payload": "schemas/raw-payload.schema.json",
                "normalized_observation": "schemas/normalized-observation.schema.json",
                "cursor": "schemas/cursor.schema.json",
                "ontology_mapping": "schemas/ontology-mapping.schema.json",
            }.items():
                reference = refs.get(schema_name)
                if not isinstance(reference, dict):
                    self.error("CONN009", manifest_path, f"missing schema reference {schema_name}")
                    continue
                uri = reference.get("uri")
                if uri != expected_relative:
                    self.error("CONN010", manifest_path, f"{schema_name}.uri must be {expected_relative}")
                    continue
                pure_uri = PurePosixPath(uri)
                if pure_uri.is_absolute() or ".." in pure_uri.parts or "\\" in uri:
                    self.error("CONN011", manifest_path, f"unsafe package-relative schema URI {uri!r}")
                    continue
                target = (package_dir / Path(*pure_uri.parts)).resolve()
                try:
                    target.relative_to(package_dir)
                except ValueError:
                    self.error("CONN011", manifest_path, f"schema URI escapes package: {uri}")
                    continue
                if not target.is_file() or target.is_symlink():
                    self.error("CONN012", manifest_path, f"schema target is missing, not a file, or a symlink: {uri}")
                    continue
                document = self.machine.get(target)
                if not isinstance(document, dict):
                    self.error("CONN013", target, "referenced schema must parse as an object")
                    continue
                schema_documents[schema_name] = document
                if document.get("$id") != reference.get("id"):
                    self.error("CONN014", manifest_path, f"{schema_name} $id differs from the manifest reference")
                if reference.get("version") != manifest.get("version"):
                    self.error("CONN015", manifest_path, f"{schema_name} version differs from package version")
                digest = canonical_json_sha256(document)
                if digest != reference.get("sha256"):
                    self.error("CONN016", manifest_path, f"{schema_name} digest mismatch: declared {reference.get('sha256')}, computed {digest}")
                schema_id = document.get("$id")
                if isinstance(schema_id, str):
                    registry = registry.with_resource(schema_id, Resource.from_contents(document))

            for schema_name, document in schema_documents.items():
                expected_closed = schema_name == "raw_payload"
                if (document.get("additionalProperties") is True) != expected_closed:
                    expectation = "permit additive fields" if expected_closed else "reject unknown fields"
                    self.error("CONN017", manifest_path, f"{schema_name} top level must {expectation}")
            raw_schema = schema_documents.get("raw_envelope", {})
            raw_payload_ref = ((raw_schema.get("properties") or {}).get("payload") or {}).get("$ref") if isinstance(raw_schema, dict) else None
            if raw_payload_ref != "raw-payload.schema.json":
                self.error("CONN018", manifest_path, "raw envelope payload must reference the package raw-payload schema")

            fixture_prefix = profile["fixture_prefix"]
            fixture_specs = {
                "raw_valid": fixture_root / f"{fixture_prefix}.valid.raw.json",
                "raw_invalid": fixture_root / f"{fixture_prefix}.invalid.raw.json",
                "payload_valid": fixture_root / f"{fixture_prefix}.valid.payload.json",
                "payload_invalid": fixture_root / f"{fixture_prefix}.invalid.payload.json",
                "observation": fixture_root / f"{fixture_prefix}.valid.observation.json",
                "mapping": fixture_root / ("github-pr.mapping.json" if provider == "github" else "jira-issue.mapping.json"),
            }
            instances: dict[str, Any] = {}
            for name, path in fixture_specs.items():
                instance = self.machine.get(path.resolve())
                if not isinstance(instance, dict):
                    self.error("CONN019", path, f"missing or invalid connector fixture {name}")
                else:
                    instances[name] = instance
            schema_for_fixture = {
                "raw_valid": "raw_envelope",
                "raw_invalid": "raw_envelope",
                "payload_valid": "raw_payload",
                "payload_invalid": "raw_payload",
                "observation": "normalized_observation",
                "mapping": "ontology_mapping",
            }
            for name, schema_name in schema_for_fixture.items():
                if name not in instances or schema_name not in schema_documents:
                    continue
                validator = Draft202012Validator(schema_documents[schema_name], registry=registry, format_checker=format_checker)
                failures = sorted(validator.iter_errors(instances[name]), key=lambda item: list(item.absolute_path))
                should_reject = name in {"raw_invalid", "payload_invalid"}
                if should_reject and not failures:
                    self.error("CONN020", fixture_specs[name], f"negative {name} fixture unexpectedly validates")
                if not should_reject and failures:
                    for failure in failures:
                        pointer = "/" + "/".join(str(part) for part in failure.absolute_path)
                        self.error("CONN021", fixture_specs[name], f"fixture schema violation at {pointer}: {failure.message}")

            raw = instances.get("raw_valid")
            payload = instances.get("payload_valid")
            observation = instances.get("observation")
            mapping = instances.get("mapping")
            if isinstance(raw, dict) and isinstance(payload, dict):
                if raw.get("payload") != payload:
                    self.error("CONN022", fixture_specs["raw_valid"], "raw envelope payload differs from the standalone valid payload fixture")
                payload_digest = canonical_json_sha256(payload)
                if raw.get("payload_sha256") != payload_digest or not str(raw.get("payload_object_uri", "")).endswith("/" + payload_digest):
                    self.error("CONN023", fixture_specs["raw_valid"], "raw payload hash/object URI is not the canonical payload digest")
                for field in ("tenant_id", "installation_id"):
                    if raw.get(field) != profile[field]:
                        self.error("CONN024", fixture_specs["raw_valid"], f"raw fixture {field} differs from the frozen seed")
                if raw.get("provider") != provider or raw.get("external_object_id") != profile["source_key"]:
                    self.error("CONN025", fixture_specs["raw_valid"], "raw fixture provider/source key differs from the frozen H1 oracle")
            if isinstance(raw, dict) and isinstance(observation, dict):
                for raw_field, observation_field in (
                    ("tenant_id", "tenant_id"),
                    ("installation_id", "installation_id"),
                    ("provider", "provider"),
                    ("external_object_id", "source_key"),
                    ("external_version", "source_revision"),
                    ("payload_sha256", "raw_payload_sha256"),
                ):
                    if raw.get(raw_field) != observation.get(observation_field):
                        self.error("CONN026", fixture_specs["observation"], f"observation {observation_field} does not preserve raw {raw_field}")
            if isinstance(mapping, dict) and refs:
                if mapping.get("input_schema_id") != (refs.get("raw_envelope") or {}).get("id"):
                    self.error("CONN027", fixture_specs["mapping"], "mapping input_schema_id differs from manifest raw envelope")
                if mapping.get("output_schema_id") != (refs.get("normalized_observation") or {}).get("id"):
                    self.error("CONN028", fixture_specs["mapping"], "mapping output_schema_id differs from manifest observation schema")

            # Mutation testing keeps the shared structural and exact-profile gates honest.
            excess_permission = copy.deepcopy(manifest)
            excess_permission.setdefault("auth", {}).setdefault("required_permissions", []).append({"name": "unapproved", "access": "write"})
            if not profile_violations(excess_permission, profile):
                self.error("CONN029", manifest_path, "exact-profile gate accepted an extra provider permission")
            wildcard_host = copy.deepcopy(manifest)
            wildcard_host["network_policy"]["rules"][0]["host"] = "*.example.com"
            if not list(shared_validator.iter_errors(wildcard_host)):
                self.error("CONN030", manifest_path, "shared manifest schema accepted a wildcard egress host")
            changed_mutations = copy.deepcopy(manifest)
            changed_mutations["capabilities"]["mutations"] = jira_mutation if provider == "github" else []
            if not list(shared_validator.iter_errors(changed_mutations)) and not profile_violations(changed_mutations, profile):
                self.error("CONN031", manifest_path, "manifest gates accepted a changed mutation boundary")

    def validate_mcp_manifest(self) -> None:
        path = (self.spec_root / "contracts/mcp-manifest.json").resolve()
        document = self.machine.get(path)
        if not isinstance(document, dict):
            self.error("MCP001", path, "MCP manifest must parse as a mapping")
            return
        if not isinstance(document.get("name"), str) or not document["name"]:
            self.error("MCP002", path, "MCP manifest name is required")
        if not isinstance(document.get("version"), str) or not SEMVER_RE.fullmatch(document["version"]):
            self.error("MCP003", path, "MCP manifest version must be semantic version text")
        resources = document.get("resources")
        tools = document.get("tools")
        if not isinstance(resources, list) or not resources:
            self.error("MCP004", path, "MCP manifest resources must be a non-empty list")
        if not isinstance(tools, list) or not tools:
            self.error("MCP005", path, "MCP manifest tools must be a non-empty list")
            tools = []
        names: set[str] = set()
        for index, tool in enumerate(tools):
            if not isinstance(tool, dict):
                self.error("MCP006", path, f"tools[{index}] must be a mapping")
                continue
            name = tool.get("name")
            if not isinstance(name, str) or not name:
                self.error("MCP007", path, f"tools[{index}] has no name")
            elif name in names:
                self.error("MCP008", path, f"duplicate MCP tool name {name}")
            else:
                names.add(name)
            has_inline = "input_schema" in tool
            has_ref = "input_schema_ref" in tool
            if has_inline == has_ref:
                self.error("MCP009", path, f"tool {name or index} must define exactly one input_schema or input_schema_ref")
            if has_inline:
                try:
                    Draft202012Validator.check_schema(tool["input_schema"])
                except SchemaError as exc:
                    self.error("MCP010", path, f"tool {name or index} has invalid input schema: {exc.message}")
            if has_ref and isinstance(tool["input_schema_ref"], str):
                self.validate_ref(path, document, tool["input_schema_ref"], "MCP011")
            for field in ("risk", "approval"):
                if not isinstance(tool.get(field), str) or not tool[field]:
                    self.error("MCP012", path, f"tool {name or index} requires {field}")
        security = document.get("security")
        required_security = {"tenant_context", "delegation", "untrusted_content", "sensitive_actions", "audit"}
        if not isinstance(security, dict) or not required_security.issubset(security):
            self.error("MCP013", path, "MCP security policy is incomplete")

    def validate_technologies(self) -> None:
        path = self.spec_root / "catalogs/technologies.yaml"
        decisions = self.entries("catalogs/technologies.yaml", "decisions")
        seen: dict[str, str] = {}
        for index, decision in enumerate(decisions):
            technology = decision.get("technology")
            if not isinstance(technology, str) or not technology.strip():
                self.error("TECH001", path, f"decisions[{index}] has no technology")
                continue
            normalized = normalize_technology(technology)
            if normalized in seen:
                self.error("TECH002", path, f"duplicate technology entries {seen[normalized]!r} and {technology!r}")
            seen[normalized] = technology
            disposition = str(decision.get("disposition", "")).casefold()
            if disposition not in {"adopt", "conditional", "reject", "rejected"}:
                self.error("TECH003", path, f"{technology} has invalid disposition {disposition!r}")
            if not HORIZON_RE.fullmatch(str(decision.get("horizon", ""))):
                self.error("TECH004", path, f"{technology} has invalid or missing horizon")
            if not isinstance(decision.get("ownership"), str) or not decision["ownership"].strip():
                self.error("TECH005", path, f"{technology} has no ownership declaration")
            if disposition == "conditional" and not str(decision.get("trigger", "")).strip():
                self.error("TECH006", path, f"conditional technology {technology} requires an introduction trigger")
            if disposition in {"adopt", "reject", "rejected"} and not str(decision.get("rationale", "")).strip():
                self.error("TECH007", path, f"{disposition} technology {technology} requires rationale")
        missing = sorted(REQUIRED_TECHNOLOGIES - set(seen))
        if missing:
            self.error("TECH008", path, f"technology disposition catalog omits named technologies: {', '.join(missing)}")

    def validate_machine_placeholders(self) -> None:
        for path, document in sorted(self.machine.items()):
            for pointer, value in walk_values(document):
                if not isinstance(value, str) or not PLACEHOLDER_RE.search(value):
                    continue
                if re.search(r"\bno\s+unowned\b", value, re.IGNORECASE):
                    continue
                parent = document
                try:
                    for part in pointer[:-1]:
                        parent = parent[int(part)] if isinstance(parent, list) else parent[part]
                except (KeyError, IndexError, ValueError, TypeError):
                    parent = None
                owner = parent.get("owner") if isinstance(parent, dict) else None
                if isinstance(owner, str) and owner and not PLACEHOLDER_RE.search(owner):
                    self.warning("TBD004", path, f"owned placeholder at /{'/'.join(pointer)}")
                else:
                    self.error("TBD003", path, f"unowned placeholder at /{'/'.join(pointer)}")

    def validate_risk_and_review_gates(self) -> None:
        risk_path = self.spec_root / "catalogs/risks.yaml"
        risks = self.entries("catalogs/risks.yaml", "risks")
        gates = self.manifest.get("release_gates", {}) if isinstance(self.manifest, dict) else {}
        resolved_statuses = {"mitigated", "closed", "resolved", "rejected"}
        counts = {"critical": 0, "high": 0}
        accepted_medium_ids: list[str] = []
        for risk in risks:
            identifier = risk.get("id", "<unknown>")
            severity = str(risk.get("severity", "")).casefold()
            status = str(risk.get("status", "")).casefold()
            if severity not in {"critical", "high", "medium", "low"}:
                self.error("RISK001", risk_path, f"{identifier} has invalid severity {severity!r}")
            if severity in counts and status not in resolved_statuses:
                counts[severity] += 1
            if status == "accepted" and severity in {"critical", "high"}:
                self.error("RISK002", risk_path, f"{identifier} cannot accept a {severity} release risk")
            if status == "accepted" and severity == "medium":
                if isinstance(identifier, str):
                    accepted_medium_ids.append(identifier)
                for field in ("owner", "revisit", "mitigation"):
                    if not str(risk.get(field, "")).strip():
                        self.error("RISK003", risk_path, f"accepted Medium {identifier} requires {field}")
        for severity in ("critical", "high"):
            maximum = gates.get(f"maximum_open_{severity}_risks")
            if isinstance(maximum, int) and counts[severity] > maximum:
                self.error("RISK004", risk_path, f"open {severity} risks ({counts[severity]}) exceed release gate ({maximum})")

        acceptance_path = self.spec_root / "reviews/risk-acceptance.md"
        acceptance_body = self.markdown_body.get(acceptance_path.resolve())
        if acceptance_body is None:
            self.error("RISK005", acceptance_path, "residual risk acceptance record is required")
        else:
            for identifier in accepted_medium_ids:
                if not re.search(rf"(?<![A-Z0-9-]){re.escape(identifier)}(?![A-Z0-9-])", acceptance_body):
                    self.error("RISK006", acceptance_path, f"accepted Medium {identifier} has no residual-risk acceptance record")

        ledger_path = self.spec_root / "reviews/review-ledger.md"
        body = self.markdown_body.get(ledger_path.resolve())
        if body is None:
            self.error("REV001", ledger_path, "review ledger is required")
            return
        headings = list(re.finditer(r"^##\s+Review\s+\d+\b.*$", body, re.MULTILINE | re.IGNORECASE))
        clear: list[bool] = []
        unresolved_re = re.compile(r"\b(?:open|unresolved|pending|deferred|tbd|not\s+remediated)\b", re.IGNORECASE)
        for index, heading in enumerate(headings):
            end = headings[index + 1].start() if index + 1 < len(headings) else len(body)
            section = body[heading.end() : end]
            section_clear = True
            for line in section.splitlines():
                cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
                if len(cells) < 3 or cells[1].casefold() not in {"critical", "high"}:
                    continue
                resolution = cells[2]
                if not resolution or unresolved_re.search(resolution):
                    section_clear = False
            if unresolved_re.search(section):
                # Ignore affirmative convergence phrases containing "no remaining" or "no unresolved".
                scrubbed = re.sub(r"\bno\s+(?:remaining\s+)?(?:open|unresolved)\b", "", section, flags=re.IGNORECASE)
                if unresolved_re.search(scrubbed):
                    section_clear = False
            clear.append(section_clear)
        required = gates.get("consecutive_clear_reviews")
        if isinstance(required, int):
            if len(clear) < required or (required and not all(clear[-required:])):
                self.error("REV002", ledger_path, f"release requires {required} consecutive clear cross-domain reviews")

    def validate_trace_path(self, relative: Any, owner_path: Path, code: str) -> bool:
        if not isinstance(relative, str) or not relative:
            self.error(code, owner_path, f"traceability path is not a non-empty string: {relative!r}")
            return False
        resolved = self.resolve_repo_path(self.spec_root, relative, owner_path, code)
        if resolved is None:
            return False
        if not resolved.exists() or not resolved.is_file():
            self.error(code, owner_path, f"traceability path does not exist: {relative}")
            return False
        return True

    def expand_traceability(self) -> None:
        trace_path = self.spec_root / "catalogs/traceability.yaml"
        trace = self.machine_at("catalogs/traceability.yaml")
        if not isinstance(trace, dict):
            self.error("TRACE001", trace_path, "traceability catalog must parse as a mapping")
            return
        requirements = self.entries("catalogs/requirements.yaml", "requirements")
        quality_attributes = self.entries("catalogs/quality-attributes.yaml", "quality_attributes")
        components = {item.get("id") for item in self.entries("catalogs/components.yaml", "components") if isinstance(item.get("id"), str)}
        tests_by_id = {
            item.get("id"): item
            for item in self.entries("catalogs/tests-evaluations.yaml", "tests_evaluations")
            if isinstance(item.get("id"), str)
        }
        roadmap_by_id = {
            item.get("id"): item
            for item in self.entries("catalogs/roadmap.yaml", "horizons")
            if isinstance(item.get("id"), str)
        }

        rule_sets = [
            ("requirement", requirements, trace.get("rules"), "requirement_prefix", "REQ"),
            (
                "quality_attribute",
                quality_attributes,
                trace.get("quality_rules", trace.get("quality_attribute_rules")),
                "quality_prefix",
                "QAR",
            ),
        ]
        results: list[dict[str, Any]] = []
        counts: dict[str, dict[str, int]] = {}
        accepted_adrs = {
            identifier
            for identifier in self.normative_ids["ADR"]
            for path, _ in self.id_locations.get(identifier, [])
            if str(self.markdown_meta.get(path.resolve(), {}).get("status", "")).casefold() == "accepted"
        }
        for kind, sources, rules_value, prefix_key, normative_prefix in rule_sets:
            rules: list[dict[str, Any]] = []
            if not isinstance(rules_value, list) or not rules_value:
                self.error("TRACE002", trace_path, f"traceability {kind} rules must be a non-empty list")
            else:
                for index, rule in enumerate(rules_value):
                    if not isinstance(rule, dict):
                        self.error("TRACE003", trace_path, f"{kind} rule {index} must be a mapping")
                        continue
                    prefix = rule.get(prefix_key)
                    if not isinstance(prefix, str) or not prefix.startswith(normative_prefix + "-"):
                        self.error("TRACE004", trace_path, f"{kind} rule {index} has invalid {prefix_key}")
                        continue
                    if not any(str(source.get("id", "")).startswith(prefix) for source in sources):
                        self.error("TRACE005", trace_path, f"{kind} rule prefix matches no source: {prefix}")
                    rules.append(rule)

            complete_count = 0
            for source in sorted(sources, key=lambda item: str(item.get("id", ""))):
                identifier = source.get("id")
                mappings: dict[str, list[str]] = {dimension: [] for dimension in REQUIRED_TRACE_DIMENSIONS}
                item_complete = True
                for rule in rules:
                    if isinstance(identifier, str) and identifier.startswith(str(rule[prefix_key])):
                        for dimension in REQUIRED_TRACE_DIMENSIONS:
                            values = rule.get(dimension, [])
                            if not isinstance(values, list):
                                self.error("TRACE006", trace_path, f"rule {rule[prefix_key]} field {dimension} must be a list")
                                item_complete = False
                                continue
                            for value in values:
                                if not isinstance(value, str) or not value:
                                    self.error("TRACE006", trace_path, f"rule {rule[prefix_key]} field {dimension} contains a non-string value")
                                    item_complete = False
                                    continue
                                if value not in mappings[dimension]:
                                    mappings[dimension].append(value)
                horizon = source.get("horizon")
                if not isinstance(horizon, str) or not HORIZON_RE.fullmatch(horizon):
                    self.error("TRACE008", trace_path, f"{identifier} has no valid horizon trace")
                    item_complete = False
                else:
                    # Prefix rules may name every horizon used by their domain,
                    # but the expanded exact trace resolves to the source's one
                    # authoritative roadmap entry. Omitting it leaves no trace.
                    mappings["roadmap"] = [horizon] if horizon in mappings["roadmap"] else []
                for dimension in REQUIRED_TRACE_DIMENSIONS:
                    if not mappings[dimension]:
                        self.error("TRACE007", trace_path, f"{identifier} has no {dimension} trace")
                        item_complete = False
                for relative in mappings["artifacts"]:
                    item_complete &= self.validate_trace_path(relative, trace_path, "TRACE009")
                for relative in mappings["contracts"]:
                    item_complete &= self.validate_trace_path(relative, trace_path, "TRACE010")
                for decision in mappings["decisions"]:
                    if decision not in accepted_adrs:
                        self.error("TRACE011", trace_path, f"{identifier} references unknown or unaccepted decision {decision}")
                        item_complete = False
                for component in mappings["components"]:
                    if component not in components:
                        self.error("TRACE012", trace_path, f"{identifier} references unknown component {component}")
                        item_complete = False
                for control in mappings["controls"]:
                    if control not in self.normative_ids["CTRL"]:
                        self.error("TRACE013", trace_path, f"{identifier} references unknown control {control}")
                        item_complete = False
                for criterion in mappings["acceptance"]:
                    if criterion not in self.normative_ids["AC"]:
                        self.error("TRACE014", trace_path, f"{identifier} references unknown acceptance criterion {criterion}")
                        item_complete = False
                for test_id in mappings["tests_evaluations"]:
                    test = tests_by_id.get(test_id)
                    if not isinstance(test, dict):
                        self.error("TRACE016", trace_path, f"{identifier} references unknown test/evaluation {test_id}")
                        item_complete = False
                    elif identifier not in test.get("covers", []):
                        self.error("TRACE017", trace_path, f"{test_id} does not explicitly cover exact source {identifier}")
                        item_complete = False
                for roadmap_id in mappings["roadmap"]:
                    roadmap_entry = roadmap_by_id.get(roadmap_id)
                    roadmap_field = "requirements" if kind == "requirement" else "quality_attributes"
                    if not isinstance(roadmap_entry, dict) or identifier not in roadmap_entry.get(roadmap_field, []):
                        self.error("TRACE018", trace_path, f"{roadmap_id} does not explicitly schedule exact source {identifier}")
                        item_complete = False
                if item_complete:
                    complete_count += 1
                results.append(
                    {
                        "id": identifier,
                        "kind": kind,
                        "title": source.get("title", source.get("attribute", "")),
                        "status": source.get("status", "committed"),
                        "horizon": horizon,
                        "complete": item_complete,
                        **mappings,
                    }
                )
            counts[kind] = {"total": len(sources), "complete": complete_count}

        total = sum(value["total"] for value in counts.values())
        complete = sum(value["complete"] for value in counts.values())
        coverage = round((complete / total * 100) if total else 0.0, 2)
        gate = (self.manifest.get("release_gates") or {}).get("traceability_coverage_percent") if self.manifest else None
        if isinstance(gate, int) and coverage < gate:
            self.error("TRACE015", trace_path, f"traceability coverage {coverage:.2f}% is below release gate {gate}%")
        self.trace_report = {
            "schema_version": 1,
            "specification": {
                "id": (self.manifest.get("specification") or {}).get("id") if self.manifest else None,
                "version": (self.manifest.get("specification") or {}).get("version") if self.manifest else None,
                "release_stage": (self.manifest.get("specification") or {}).get("release_stage") if self.manifest else None,
                "publication_date": str((self.manifest.get("specification") or {}).get("published_on", (self.manifest.get("specification") or {}).get("released_on", ""))) if self.manifest else "",
            },
            "summary": {
                "total": total,
                "complete": complete,
                "coverage_percent": coverage,
                "release_gate_percent": gate,
                "required_dimensions": list(REQUIRED_TRACE_DIMENSIONS),
                **counts,
            },
            "traces": results,
        }
        self.write_trace_reports()

    def write_trace_reports(self) -> None:
        try:
            self.report_dir.mkdir(parents=True, exist_ok=True)
            json_path = self.report_dir / "traceability-report.json"
            json_path.write_text(json.dumps(self.trace_report, indent=2, sort_keys=True, ensure_ascii=True) + "\n", encoding="utf-8")
            summary = self.trace_report.get("summary", {})
            lines = [
                "# Enterprise Digital Twin Traceability Report",
                "",
                f"Specification: `{self.trace_report.get('specification', {}).get('version', '')}`",
                "",
                f"Coverage: **{summary.get('coverage_percent', 0):.2f}%** ({summary.get('complete', 0)} of {summary.get('total', 0)})",
                "",
                "| ID | Kind | Horizon | Artifact | ADR | Component | Contract | Control | Acceptance | Test/Eval | Roadmap | Complete |",
                "|---|---|---|---:|---:|---:|---:|---:|---:|---:|---:|:---:|",
            ]
            for item in self.trace_report.get("traces", []):
                lines.append(
                    "| {id} | {kind} | {horizon} | {artifacts} | {decisions} | {components} | {contracts} | {controls} | {acceptance} | {tests_evaluations} | {roadmap} | {complete} |".format(
                        id=item.get("id", ""),
                        kind=item.get("kind", ""),
                        horizon=item.get("horizon", ""),
                        artifacts=len(item.get("artifacts", [])),
                        decisions=len(item.get("decisions", [])),
                        components=len(item.get("components", [])),
                        contracts=len(item.get("contracts", [])),
                        controls=len(item.get("controls", [])),
                        acceptance=len(item.get("acceptance", [])),
                        tests_evaluations=len(item.get("tests_evaluations", [])),
                        roadmap=len(item.get("roadmap", [])),
                        complete="yes" if item.get("complete") else "no",
                    )
                )
            (self.report_dir / "traceability-report.md").write_text("\n".join(lines) + "\n", encoding="utf-8")
        except OSError as exc:
            self.error("REPORT001", self.report_dir, f"cannot write traceability reports: {exc}")

    def run(self) -> int:
        if not self.spec_root.exists():
            self.error("ROOT001", self.spec_root, "specification root does not exist")
        else:
            self.load_machine_files()
            self.validate_markdown()
            self.register_catalog_ids()
            self.validate_unique_ids()
            self.validate_manifest()
            self.validate_catalogs()
            self.validate_test_and_roadmap_catalogs()
            self.validate_h1_fixtures()
            self.validate_unknown_references()
            self.validate_markdown_links()
            self.validate_external_citations()
            self.validate_mermaid()
            self.validate_openapi()
            self.validate_asyncapi()
            self.validate_graphql()
            self.validate_proto()
            self.validate_json_schemas()
            self.validate_connector_packages()
            self.validate_mcp_manifest()
            self.validate_technologies()
            self.validate_machine_placeholders()
            self.validate_risk_and_review_gates()
            self.expand_traceability()

        errors = sorted(issue for issue in self.issues if issue.severity == "error")
        warnings = sorted(issue for issue in self.issues if issue.severity == "warning")
        for issue in errors + warnings:
            print(f"{issue.severity.upper()} {issue.code} {issue.path}: {issue.message}")
        coverage = self.trace_report.get("summary", {}).get("coverage_percent")
        coverage_text = f", traceability {coverage:.2f}%" if isinstance(coverage, (int, float)) else ""
        print(f"Validated {len(self.markdown_meta)} Markdown files and {len(self.machine)} machine-readable artifacts: {len(errors)} error(s), {len(warnings)} warning(s){coverage_text}.")
        return 1 if errors else 0


def parse_args(argv: list[str]) -> argparse.Namespace:
    script_repo = Path(__file__).resolve().parents[1]
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repo-root", type=Path, default=script_repo)
    parser.add_argument("--spec-root", type=Path, default=None)
    parser.add_argument("--report-dir", type=Path, default=None)
    args = parser.parse_args(argv)
    args.repo_root = args.repo_root.resolve()
    args.spec_root = (args.spec_root or args.repo_root / "docs/enterprise-digital-twin").resolve()
    args.report_dir = (args.report_dir or args.repo_root / "output").resolve()
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv or sys.argv[1:])
    return BlueprintValidator(args.repo_root, args.spec_root, args.report_dir).run()


if __name__ == "__main__":
    raise SystemExit(main())
