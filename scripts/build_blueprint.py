#!/usr/bin/env python3
"""Build consolidated Markdown, HTML, and audit dossier editions."""

from __future__ import annotations

import hashlib
import html
import json
import re
from pathlib import Path
from typing import Any

import markdown
import yaml


REPOSITORY = Path(__file__).resolve().parents[1]
SPEC = REPOSITORY / "docs" / "enterprise-digital-twin"
OUTPUT = REPOSITORY / "output"


def load_yaml(path: Path) -> dict[str, Any]:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def split_frontmatter(path: Path) -> tuple[dict[str, Any], str]:
    text = path.read_text(encoding="utf-8")
    if not text.startswith("---\n"):
        return {}, text
    _, raw, body = text.split("---\n", 2)
    return yaml.safe_load(raw) or {}, body.strip()


def shift_headings(text: str, levels: int = 1) -> str:
    def replacement(match: re.Match[str]) -> str:
        return "#" * min(6, len(match.group(1)) + levels) + match.group(2)

    return re.sub(r"^(#{1,6})(\s+)", replacement, text, flags=re.MULTILINE)


def digest(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def markdown_cell(value: Any) -> str:
    if value is None:
        return ""
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, list):
        return "<br>".join(markdown_cell(item) for item in value)
    if isinstance(value, dict):
        return "<br>".join(f"{key}: {markdown_cell(item)}" for key, item in value.items())
    return str(value).replace("|", "\\|").replace("\n", "<br>")


CATALOG_LAYOUTS: dict[str, tuple[str, list[str]]] = {
    "requirements.yaml": ("requirements", ["id", "title", "statement", "horizon", "status"]),
    "quality-attributes.yaml": ("quality_attributes", ["id", "attribute", "scenario", "response", "measure", "horizon"]),
    "components.yaml": ("components", ["id", "name", "workload", "owner", "authority", "interfaces"]),
    "technologies.yaml": ("decisions", ["technology", "disposition", "horizon", "ownership", "trigger", "rationale"]),
    "controls.yaml": ("controls", ["id", "domain", "title", "requirement"]),
    "risks.yaml": ("risks", ["id", "severity", "status", "title", "mitigation", "owner", "revisit"]),
    "acceptance.yaml": ("acceptance_criteria", ["id", "title", "evidence"]),
    "agents.yaml": ("profiles", ["id", "name", "horizon", "purpose", "tools", "output", "termination"]),
    "connectors.yaml": ("connectors", ["id", "name", "status", "horizon", "auth", "reads", "writes", "capabilities"]),
    "screens.yaml": ("screens", ["id", "name", "horizon", "purpose", "roles", "states", "acceptance"]),
    "simulations.yaml": ("models", ["id", "name", "status", "horizon", "purpose", "inputs", "outputs", "prohibited_uses"]),
    "ontology.yaml": ("entity_types", ["id", "name", "domain", "status", "properties", "retention"]),
}


def table(headers: list[str], rows: list[list[Any]]) -> str:
    heading = "| " + " | ".join(header.replace("_", " ").title() for header in headers) + " |"
    rule = "| " + " | ".join("---" for _ in headers) + " |"
    body = ["| " + " | ".join(markdown_cell(value) for value in row) + " |" for row in rows]
    return "\n".join([heading, rule, *body])


def render_catalog(path: Path) -> str:
    data = load_yaml(path)
    label = path.stem.replace("-", " ").title()
    chunks = [f"## {label}", f"Source: `{path.relative_to(REPOSITORY).as_posix()}`"]
    if path.name == "traceability.yaml":
        for key, prefix_key in (("rules", "requirement_prefix"), ("quality_rules", "quality_prefix")):
            rows = []
            for item in data.get(key, []):
                rows.append([
                    item.get(prefix_key), item.get("artifacts"), item.get("decisions"),
                    item.get("components"), item.get("contracts"), item.get("controls"),
                    item.get("acceptance")
                ])
            chunks.extend([f"### {key.replace('_', ' ').title()}", table(
                [prefix_key, "artifacts", "decisions", "components", "contracts", "controls", "acceptance"], rows
            )])
        return "\n\n".join(chunks)

    layout = CATALOG_LAYOUTS.get(path.name)
    rendered_keys: set[str] = {"schema_version"}
    if layout:
        key, columns = layout
        items = data.get(key, [])
        rows = [[item.get(column) for column in columns] for item in items]
        chunks.append(table(columns, rows))
        rendered_keys.add(key)

    for key, value in data.items():
        if key in rendered_keys:
            continue
        if isinstance(value, list) and value and all(isinstance(item, dict) for item in value):
            columns = list(dict.fromkeys(field for item in value for field in item.keys()))
            rows = [[item.get(column) for column in columns] for item in value]
            chunks.extend([f"### {key.replace('_', ' ').title()}", table(columns, rows)])
        else:
            chunks.extend([
                f"### {key.replace('_', ' ').title()}",
                "```yaml\n" + yaml.safe_dump(value, sort_keys=False, allow_unicode=False).strip() + "\n```",
            ])
    return "\n\n".join(chunks)


def contract_metadata(path: Path) -> tuple[str, str]:
    suffix = path.suffix.lower()
    kind = suffix.lstrip(".").upper()
    version = "1.0.0"
    try:
        if suffix == ".json":
            data = json.loads(path.read_text(encoding="utf-8"))
            kind = "JSON Schema" if "$schema" in data else "JSON"
            version = str(data.get("version") or data.get("schema_version") or data.get("$schema", "2020-12").rsplit("/", 1)[-1])
        elif suffix in {".yaml", ".yml"}:
            data = load_yaml(path)
            if "openapi" in data:
                kind, version = "OpenAPI", str(data["openapi"])
            elif "asyncapi" in data:
                kind, version = "AsyncAPI", str(data["asyncapi"])
        elif suffix == ".graphql":
            kind, version = "GraphQL SDL", "H2 read-only"
        elif suffix == ".proto":
            kind, version = "Protocol Buffers", "proto3"
    except (ValueError, yaml.YAMLError):
        pass
    return kind, version


def contract_register(manifest: dict[str, Any]) -> str:
    rows = []
    for relative in manifest["normative_contracts"]:
        path = SPEC / relative
        kind, version = contract_metadata(path)
        rows.append([relative, kind, version, len(path.read_bytes()), digest(path)[:16]])
    return "\n\n".join([
        "# Part V - Machine-Readable Contract Register",
        "The files listed here are normative and outrank prose when precedence applies. The edition records their immutable build digest without duplicating generated code.",
        table(["contract", "format", "contract version", "bytes", "sha256 prefix"], rows),
    ])


def diagram_appendix() -> str:
    chunks = [
        "# Part VI - Generated Architecture Diagrams",
        "Every figure is rendered from the adjacent version-controlled Mermaid source. The SVG is the publication artifact and the PNG supports PDF generation.",
    ]
    directory = SPEC / "diagrams"
    for source in sorted(directory.glob("*.mmd")):
        title = source.stem.split("-", 1)[-1].replace("-", " ").title()
        generated = directory / "generated" / f"{source.stem}.svg"
        chunks.append(f"## {title}")
        chunks.append(f"Source: `{source.relative_to(REPOSITORY).as_posix()}`")
        if generated.exists():
            chunks.append(f"![{title}](docs/enterprise-digital-twin/diagrams/generated/{generated.name})")
        else:
            chunks.append("Diagram output is generated by `npm run render:diagrams`.")
    return "\n\n".join(chunks)


def fixture_appendix(manifest: dict[str, Any]) -> str:
    chunks = [
        "# Part VI - Frozen H1 Fixture and Ground-Truth Oracle",
        "These files are normative inputs to the reproducible two-tenant demonstration and its isolation, citation, simulation, action, and rollback tests.",
    ]
    readme = SPEC / "fixtures" / "h1" / "README.md"
    if readme.exists():
        chunks.extend(["## Fixture contract", shift_headings(readme.read_text(encoding="utf-8").strip(), 2)])
    for relative in manifest.get("normative_fixtures", []):
        path = SPEC / relative
        chunks.extend([
            f"## {path.stem.replace('-', ' ').title()}",
            f"Source: `{path.relative_to(REPOSITORY).as_posix()}` | SHA-256: `{digest(path)}`",
            "```yaml\n" + path.read_text(encoding="utf-8").strip() + "\n```",
        ])
    return "\n\n".join(chunks)


def build_markdown(manifest: dict[str, Any]) -> str:
    spec = manifest["specification"]
    publication_date = spec.get("published_on", spec.get("released_on", "unpublished"))
    release_stage = spec.get("release_stage", "released")
    chunks = [
        "---",
        f"title: {spec['name']}",
        f"version: {spec['version']}",
        f"status: {spec['status']}",
        f"release_stage: {release_stage}",
        f"published_on: {publication_date}",
        "---",
        f"# {spec['name']}",
        f"**Specification:** `{spec['id']}`  ",
        f"**Version:** `{spec['version']}`  ",
        f"**Status:** `{spec['status']}`  ",
        f"**Release stage:** `{release_stage}`  ",
        f"**Publication date:** `{publication_date}`",
        "> Production-quality invariants are committed only inside the stated horizon boundaries. Later capabilities remain explicitly provisional, research, or rejected.",
        "# Part I - Governance and Reading Guide",
    ]

    for relative in ["README.md", "decision-precedence.md", "glossary.md", "templates/subsystem-template.md"]:
        metadata, body = split_frontmatter(SPEC / relative)
        chunks.extend([f"## {metadata.get('title', Path(relative).stem)}", shift_headings(body, 2)])

    chunks.append("# Part II - Architecture Blueprint")
    for relative in manifest["documents"]:
        metadata, body = split_frontmatter(SPEC / relative)
        chunks.extend([
            f"## {metadata.get('id')} - {metadata.get('title')}",
            f"Status: **{metadata.get('status')}** | Owners: {', '.join(metadata.get('owners', []))} | Last reviewed: {metadata.get('last_reviewed')}",
            shift_headings(body, 2),
        ])

    chunks.append("# Part III - Architecture Decision Records")
    for path in sorted((SPEC / "adrs").glob("ADR-*.md")):
        metadata, body = split_frontmatter(path)
        chunks.extend([
            f"## {metadata.get('id')} - {metadata.get('title')}",
            f"Status: **{metadata.get('status')}** | Owners: {', '.join(metadata.get('owners', []))}",
            shift_headings(body, 2),
        ])

    chunks.append("# Part IV - Normative Catalogs")
    for relative in manifest["normative_catalogs"]:
        chunks.append(render_catalog(SPEC / relative))

    chunks.extend([contract_register(manifest), fixture_appendix(manifest), diagram_appendix(), "# Part VIII - Assurance Reviews"])
    for path in sorted((SPEC / "reviews").glob("*.md")):
        metadata, body = split_frontmatter(path)
        chunks.extend([
            f"## {metadata.get('title', path.stem)}",
            f"Artifact: `{path.relative_to(REPOSITORY).as_posix()}`",
            shift_headings(body, 2),
        ])

    chunks.extend([
        "# Build Provenance",
        f"Manifest SHA-256: `{digest(SPEC / 'manifest.yaml')}`",
        "Generated by `scripts/build_blueprint.py`; generated editions are not edited directly.",
    ])
    return "\n\n".join(chunks).rstrip() + "\n"


def html_document(markdown_text: str, manifest: dict[str, Any]) -> str:
    body = markdown.markdown(
        markdown_text,
        extensions=["extra", "toc", "sane_lists", "smarty"],
        extension_configs={"toc": {"permalink": True, "toc_depth": "1-4"}},
        output_format="html5",
    )
    generated = SPEC / "diagrams" / "generated"
    for svg in generated.glob("*.svg") if generated.exists() else []:
        relative = f"docs/enterprise-digital-twin/diagrams/generated/{svg.name}"
        figure = f'<figure class="diagram" aria-label="{html.escape(svg.stem)}">{svg.read_text(encoding="utf-8")}</figure>'
        body = re.sub(rf'<p><img alt="[^"]*" src="{re.escape(relative)}"\s*/?></p>', figure, body)
    title = html.escape(manifest["specification"]["name"])
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  <title>{title}</title>
  <style>
    :root {{ --ink:#17263a; --muted:#526579; --navy:#102d50; --blue:#2e69ad; --line:#d5deea; --paper:#fff; --soft:#f4f7fb; --code:#eef2f7; }}
    * {{ box-sizing:border-box; }}
    html {{ scroll-behavior:smooth; }}
    body {{ margin:0 auto; max-width:1120px; padding:3.5rem clamp(1.2rem,4vw,4rem) 8rem; color:var(--ink); background:var(--paper); font:16px/1.62 Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif; }}
    h1,h2,h3,h4 {{ color:var(--navy); line-height:1.2; letter-spacing:-.018em; scroll-margin-top:1rem; }}
    h1 {{ margin:4rem 0 1.2rem; padding-top:1rem; border-top:3px solid var(--blue); font-size:2.2rem; }}
    body > h1:first-of-type {{ margin-top:0; border:0; font-size:3.25rem; max-width:18ch; }}
    h2 {{ margin-top:2.6rem; font-size:1.55rem; }} h3 {{ margin-top:2rem; font-size:1.22rem; }} h4 {{ font-size:1rem; text-transform:uppercase; letter-spacing:.035em; }}
    a {{ color:#145da0; text-decoration-thickness:.08em; text-underline-offset:.16em; }}
    p,li {{ max-width:88ch; }} blockquote {{ margin:1.5rem 0; padding:1rem 1.25rem; color:#24425f; background:#edf5ff; border-left:5px solid var(--blue); }}
    table {{ border-collapse:collapse; width:100%; margin:1.3rem 0 2rem; font-size:.86rem; }}
    th {{ color:#fff; background:var(--navy); text-align:left; }} th,td {{ padding:.62rem .7rem; border:1px solid var(--line); vertical-align:top; overflow-wrap:anywhere; }} tr:nth-child(even) td {{ background:var(--soft); }}
    code {{ padding:.12em .3em; border-radius:4px; background:var(--code); font: .9em/1.4 ui-monospace,SFMono-Regular,Consolas,monospace; }}
    pre {{ overflow:auto; padding:1rem; border:1px solid var(--line); border-radius:8px; background:var(--code); }} pre code {{ padding:0; }}
    .diagram {{ margin:2rem 0 3rem; padding:1rem; overflow:auto; border:1px solid var(--line); border-radius:10px; background:#fff; }} .diagram svg {{ display:block; max-width:100%; height:auto; margin:auto; }}
    .header-anchor {{ opacity:.15; text-decoration:none; }} h1:hover .header-anchor,h2:hover .header-anchor,h3:hover .header-anchor {{ opacity:.75; }}
    @media print {{ body {{ max-width:none; padding:.5in; font-size:10pt; }} h1 {{ break-before:page; }} body > h1:first-of-type {{ break-before:auto; }} table,figure,pre {{ break-inside:avoid; }} a {{ color:inherit; }} }}
    @media (prefers-color-scheme:dark) {{ :root {{ --ink:#dbe7f5; --muted:#a8bbcf; --navy:#dbeafe; --blue:#79b8ff; --line:#40536a; --paper:#101820; --soft:#172331; --code:#172331; }} th {{ color:#fff; background:#234c78; }} .diagram {{ background:#fff; }} blockquote {{ color:#dbeafe; background:#172c42; }} }}
  </style>
</head>
<body>
{body}
</body>
</html>
"""


def build_audit_dossier(manifest: dict[str, Any]) -> str:
    specification = manifest["specification"]
    publication_date = specification.get("published_on", specification.get("released_on", "unpublished"))
    chunks = [
        "# Enterprise Digital Twin Audit and Remediation Dossier",
        f"Specification `{specification['version']}` - published {publication_date}",
        "This dossier consolidates threat, privacy, failure, compliance, risk-acceptance, and cross-domain review evidence. The central ledgers remain normative.",
    ]
    risks = load_yaml(SPEC / "catalogs" / "risks.yaml")["risks"]
    chunks.extend([
        "## Risk disposition summary",
        table(
            ["severity", "status", "count"],
            [[severity, status, sum(1 for risk in risks if risk["severity"] == severity and risk["status"] == status)]
             for severity in ["critical", "high", "medium", "low"]
             for status in ["open", "mitigated", "accepted"]
             if any(risk["severity"] == severity and risk["status"] == status for risk in risks)],
        ),
    ])
    for path in sorted((SPEC / "reviews").glob("*.md")):
        metadata, body = split_frontmatter(path)
        chunks.extend([f"## {metadata.get('title', path.stem)}", shift_headings(body, 2)])
    report_path = OUTPUT / "traceability-report.json"
    if report_path.exists():
        report = json.loads(report_path.read_text(encoding="utf-8"))
        chunks.extend([
            "## Generated validation evidence",
            "```json\n" + json.dumps(report.get("summary", report), indent=2, sort_keys=True) + "\n```",
        ])
    return "\n\n".join(chunks).rstrip() + "\n"


def main() -> None:
    OUTPUT.mkdir(parents=True, exist_ok=True)
    (OUTPUT / "html").mkdir(parents=True, exist_ok=True)
    manifest = load_yaml(SPEC / "manifest.yaml")
    consolidated = build_markdown(manifest)
    markdown_path = OUTPUT / "enterprise-digital-twin-blueprint.md"
    html_path = OUTPUT / "html" / "enterprise-digital-twin-blueprint.html"
    dossier_path = OUTPUT / "audit-remediation-dossier.md"
    markdown_path.write_text(consolidated, encoding="utf-8", newline="\n")
    html_path.write_text(html_document(consolidated, manifest), encoding="utf-8", newline="\n")
    dossier_path.write_text(build_audit_dossier(manifest), encoding="utf-8", newline="\n")
    print(f"Built {markdown_path.relative_to(REPOSITORY)}")
    print(f"Built {html_path.relative_to(REPOSITORY)}")
    print(f"Built {dossier_path.relative_to(REPOSITORY)}")


if __name__ == "__main__":
    main()
