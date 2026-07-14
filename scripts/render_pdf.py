#!/usr/bin/env python3
"""Render the consolidated Markdown edition as a verified publication PDF."""

from __future__ import annotations

import html
import re
from pathlib import Path

import yaml
from PIL import Image as PILImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import LETTER, landscape
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfbase import pdfmetrics
from reportlab.platypus import (
    BaseDocTemplate,
    Frame,
    Image,
    KeepTogether,
    ListFlowable,
    ListItem,
    NextPageTemplate,
    PageBreak,
    PageTemplate,
    Paragraph,
    Preformatted,
    Spacer,
    Table,
    TableStyle,
)
from reportlab.platypus.tableofcontents import TableOfContents


REPOSITORY = Path(__file__).resolve().parents[1]
SPEC = REPOSITORY / "docs" / "enterprise-digital-twin"
INPUT = REPOSITORY / "output" / "enterprise-digital-twin-blueprint.md"
OUTPUT = REPOSITORY / "output" / "pdf" / "enterprise-digital-twin-blueprint.pdf"
NAVY = colors.HexColor("#102D50")
BLUE = colors.HexColor("#2E69AD")
INK = colors.HexColor("#17263A")
MUTED = colors.HexColor("#526579")
LINE = colors.HexColor("#D5DEEA")
SOFT = colors.HexColor("#F4F7FB")


def register_fonts() -> tuple[str, str, str]:
    candidates = [
        (Path("C:/Windows/Fonts/arial.ttf"), Path("C:/Windows/Fonts/arialbd.ttf"), Path("C:/Windows/Fonts/consola.ttf")),
        (Path("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"), Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf")),
    ]
    for regular, bold, mono in candidates:
        if regular.exists() and bold.exists() and mono.exists():
            pdfmetrics.registerFont(TTFont("EDT-Regular", str(regular)))
            pdfmetrics.registerFont(TTFont("EDT-Bold", str(bold)))
            pdfmetrics.registerFont(TTFont("EDT-Mono", str(mono)))
            return "EDT-Regular", "EDT-Bold", "EDT-Mono"
    return "Helvetica", "Helvetica-Bold", "Courier"


REGULAR, BOLD, MONO = register_fonts()


class BlueprintDocument(BaseDocTemplate):
    def __init__(self, filename: str, title: str, version: str):
        super().__init__(
            filename,
            pagesize=LETTER,
            leftMargin=0.68 * inch,
            rightMargin=0.68 * inch,
            topMargin=0.7 * inch,
            bottomMargin=0.65 * inch,
            title=title,
            author="Enterprise Architecture",
            subject="Enterprise Digital Twin Architecture Blueprint",
        )
        self.document_title = title
        self.document_version = version
        frame = Frame(self.leftMargin, self.bottomMargin, self.width, self.height, id="body")
        landscape_size = landscape(LETTER)
        landscape_margin = 0.55 * inch
        landscape_frame = Frame(
            landscape_margin,
            landscape_margin,
            landscape_size[0] - 2 * landscape_margin,
            landscape_size[1] - 2 * landscape_margin,
            id="diagram-body",
        )
        self.addPageTemplates([
            PageTemplate(id="content", frames=[frame], onPage=self._decorate_page),
            PageTemplate(id="diagram", pagesize=landscape_size, frames=[landscape_frame], onPage=self._decorate_page),
        ])

    def _decorate_page(self, canvas, doc) -> None:
        canvas.saveState()
        page = canvas.getPageNumber()
        page_width, page_height = canvas._pagesize
        if page > 1:
            canvas.setStrokeColor(LINE)
            canvas.line(self.leftMargin, page_height - 0.47 * inch, page_width - self.rightMargin, page_height - 0.47 * inch)
            canvas.setFont(REGULAR, 7.5)
            canvas.setFillColor(MUTED)
            canvas.drawString(self.leftMargin, page_height - 0.35 * inch, "ENTERPRISE DIGITAL TWIN")
            canvas.drawRightString(page_width - self.rightMargin, page_height - 0.35 * inch, f"ARCHITECTURE BLUEPRINT {self.document_version}")
            canvas.line(self.leftMargin, 0.45 * inch, page_width - self.rightMargin, 0.45 * inch)
            canvas.drawString(self.leftMargin, 0.29 * inch, "Source-controlled specification")
            canvas.drawRightString(page_width - self.rightMargin, 0.29 * inch, str(page))
        canvas.restoreState()

    def afterFlowable(self, flowable) -> None:
        if isinstance(flowable, Paragraph):
            level = getattr(flowable, "heading_level", None)
            if level in (1, 2, 3):
                text = flowable.getPlainText()
                key = f"heading-{self.seq.nextf('heading')}"
                self.canv.bookmarkPage(key)
                self.canv.addOutlineEntry(text, key, level - 1, False)
                self.notify("TOCEntry", (level, text, self.page, key))


def styles():
    base = getSampleStyleSheet()
    result = {
        "body": ParagraphStyle("Body", parent=base["BodyText"], fontName=REGULAR, fontSize=8.7, leading=12.1, textColor=INK, spaceAfter=6),
        "small": ParagraphStyle("Small", parent=base["BodyText"], fontName=REGULAR, fontSize=7.2, leading=9.2, textColor=MUTED),
        "h1": ParagraphStyle("Heading1", parent=base["Heading1"], fontName=BOLD, fontSize=20, leading=23, textColor=NAVY, spaceBefore=6, spaceAfter=12, keepWithNext=True),
        "h2": ParagraphStyle("Heading2", parent=base["Heading2"], fontName=BOLD, fontSize=14, leading=17, textColor=NAVY, spaceBefore=12, spaceAfter=7, keepWithNext=True),
        "h3": ParagraphStyle("Heading3", parent=base["Heading3"], fontName=BOLD, fontSize=10.5, leading=13, textColor=BLUE, spaceBefore=9, spaceAfter=5, keepWithNext=True),
        "h4": ParagraphStyle("Heading4", parent=base["Heading4"], fontName=BOLD, fontSize=8.5, leading=10.5, textColor=NAVY, spaceBefore=7, spaceAfter=4, keepWithNext=True),
        "quote": ParagraphStyle("Quote", parent=base["BodyText"], fontName=REGULAR, fontSize=8.5, leading=11.5, leftIndent=14, rightIndent=10, borderColor=BLUE, borderWidth=1.5, borderPadding=7, backColor=colors.HexColor("#EDF5FF"), textColor=colors.HexColor("#24425F"), spaceBefore=6, spaceAfter=9),
        "code": ParagraphStyle("Code", parent=base["Code"], fontName=MONO, fontSize=6.2, leading=8, leftIndent=4, rightIndent=4, borderColor=LINE, borderWidth=.5, borderPadding=5, backColor=SOFT, textColor=INK, spaceBefore=4, spaceAfter=7),
        "cover_title": ParagraphStyle("CoverTitle", parent=base["Title"], fontName=BOLD, fontSize=29, leading=33, alignment=TA_LEFT, textColor=colors.white, spaceAfter=18),
        "cover_meta": ParagraphStyle("CoverMeta", parent=base["BodyText"], fontName=REGULAR, fontSize=11, leading=17, textColor=colors.HexColor("#D7E7FA")),
        "toc_title": ParagraphStyle("TOCTitle", parent=base["Heading1"], fontName=BOLD, fontSize=20, textColor=NAVY, spaceAfter=14),
    }
    return result


STYLES = styles()


def inline_markup(text: str) -> str:
    escaped = html.escape(text, quote=False)
    escaped = re.sub(r"`([^`]+)`", r'<font name="%s">\1</font>' % MONO, escaped)
    escaped = re.sub(r"\*\*([^*]+)\*\*", r"<b>\1</b>", escaped)
    escaped = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<i>\1</i>", escaped)
    escaped = re.sub(r"\[([^\]]+)\]\(([^)]+)\)", r'<link href="\2" color="#145DA0">\1</link>', escaped)
    return escaped.replace("  ", " ")


def parse_table(lines: list[str]) -> Table:
    rows = []
    for line in lines:
        cells = [cell.strip().replace("\\|", "|") for cell in re.split(r"(?<!\\)\|", line.strip().strip("|"))]
        if all(re.fullmatch(r":?-{3,}:?", cell) for cell in cells):
            continue
        rows.append(cells)
    columns = max(len(row) for row in rows)
    normalized = [row + [""] * (columns - len(row)) for row in rows]
    paragraph_rows = []
    for row_index, row in enumerate(normalized):
        style = ParagraphStyle(
            f"cell-{row_index}", parent=STYLES["small"], fontName=BOLD if row_index == 0 else REGULAR,
            textColor=colors.white if row_index == 0 else INK, fontSize=6.35 if columns > 5 else 7.1,
            leading=8.1 if columns > 5 else 9.1,
        )
        paragraph_rows.append([Paragraph(inline_markup(cell.replace("<br>", "<br/>")), style) for cell in row])
    width = 7.14 * inch
    col_widths = [width / columns] * columns
    result = Table(paragraph_rows, colWidths=col_widths, repeatRows=1, hAlign="LEFT", splitByRow=1)
    result.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), NAVY),
        ("GRID", (0, 0), (-1, -1), .35, LINE),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LEFTPADDING", (0, 0), (-1, -1), 4),
        ("RIGHTPADDING", (0, 0), (-1, -1), 4),
        ("TOPPADDING", (0, 0), (-1, -1), 4),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, SOFT]),
    ]))
    return result


def diagram_path(markdown_path: str) -> Path:
    relative = markdown_path.replace("/", str(Path("/")).replace("/", "\\") if False else "/")
    path = REPOSITORY / Path(relative)
    png = path.with_suffix(".png")
    if png.exists():
        path = png
    return path


def diagram_aspect(markdown_path: str) -> float | None:
    path = diagram_path(markdown_path)
    if not path.exists():
        return None
    with PILImage.open(path) as image:
        return image.width / image.height


def diagram_flowable(markdown_path: str, alt: str, landscape_mode: bool = False):
    path = diagram_path(markdown_path)
    if not path.exists():
        return Paragraph(f"Diagram unavailable: {inline_markup(alt)}", STYLES["small"])
    with PILImage.open(path) as image:
        width_px, height_px = image.size
    # Reserve explicit vertical space for the section heading, source path, caption,
    # and page furniture. ReportLab images are opaque, so an over-tall image can
    # otherwise visually cover the preceding source line even when text extraction
    # still succeeds.
    max_width, max_height = ((9.5 * inch, 4.65 * inch) if landscape_mode else (7.05 * inch, 7.05 * inch))
    scale = min(max_width / width_px, max_height / height_px)
    return KeepTogether([
        Image(str(path), width=width_px * scale, height=height_px * scale, hAlign="CENTER"),
        Paragraph(inline_markup(alt), ParagraphStyle("Caption", parent=STYLES["small"], alignment=TA_CENTER, spaceBefore=4, spaceAfter=10)),
    ])


def cover_story(manifest: dict) -> list:
    title = manifest["specification"]["name"]
    version = manifest["specification"]["version"]
    date = str(manifest["specification"].get("published_on", manifest["specification"].get("released_on", "unpublished")))
    stage = str(manifest["specification"].get("release_stage", "released")).replace("_", " ").title()
    band = Table([[Paragraph(title, STYLES["cover_title"])], [Paragraph(
        f"Specification {version} · {stage}<br/>Committed H1/H2 architecture<br/>{date}", STYLES["cover_meta"]
    )]], colWidths=[7.14 * inch], rowHeights=[3.4 * inch, 1.5 * inch])
    band.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), NAVY),
        ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
        ("LEFTPADDING", (0, 0), (-1, -1), 34),
        ("RIGHTPADDING", (0, 0), (-1, -1), 34),
        ("TOPPADDING", (0, 0), (-1, -1), 28),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 28),
        ("LINEABOVE", (0, 1), (-1, 1), 2, colors.HexColor("#69A8E5")),
    ]))
    toc = TableOfContents()
    toc.levelStyles = [
        ParagraphStyle("TOC1", fontName=BOLD, fontSize=9.2, leading=13, textColor=NAVY, leftIndent=0, firstLineIndent=0, spaceBefore=4),
        ParagraphStyle("TOC2", fontName=REGULAR, fontSize=7.8, leading=10.5, textColor=INK, leftIndent=12, firstLineIndent=0),
        ParagraphStyle("TOC3", fontName=REGULAR, fontSize=7.1, leading=9, textColor=MUTED, leftIndent=24, firstLineIndent=0),
    ]
    return [
        Spacer(1, .35 * inch), band, Spacer(1, .65 * inch),
        Paragraph("Publication boundary", STYLES["h3"]),
        Paragraph("Production-quality invariants apply within the stated horizon limits. Provisional and research capabilities are not represented as production-ready.", STYLES["body"]),
        PageBreak(), Paragraph("Contents", STYLES["toc_title"]), toc, PageBreak(),
    ]


def markdown_story(text: str) -> list:
    lines = text.splitlines()
    story = []
    paragraph: list[str] = []
    bullets: list[str] = []
    numbers: list[str] = []
    in_code = False
    code_lines: list[str] = []
    first_heading = True
    page_mode = "content"
    diagram_on_page = False

    def following_image(start: int) -> str | None:
        cursor = start + 1
        while cursor < len(lines):
            candidate = lines[cursor].strip()
            if re.match(r"^#{1,6}\s+", candidate):
                return None
            match = re.fullmatch(r"!\[([^]]*)\]\(([^)]+)\)", candidate)
            if match:
                return match.group(2)
            cursor += 1
        return None

    def flush_paragraph() -> None:
        if paragraph:
            story.append(Paragraph(inline_markup(" ".join(item.strip() for item in paragraph)), STYLES["body"]))
            paragraph.clear()

    def flush_lists() -> None:
        for values, bullet_type in ((bullets, "bullet"), (numbers, "1")):
            if values:
                items = [ListItem(Paragraph(inline_markup(value), STYLES["body"]), leftIndent=10) for value in values]
                list_start = "circle" if bullet_type == "bullet" else "1"
                story.append(ListFlowable(items, bulletType=bullet_type, start=list_start, leftIndent=20, bulletFontName=REGULAR, bulletFontSize=7.5, spaceAfter=5))
                values.clear()

    index = 0
    while index < len(lines):
        line = lines[index]
        if line.startswith("---") and index == 0:
            index += 1
            while index < len(lines) and not lines[index].startswith("---"):
                index += 1
            index += 1
            continue
        if line.startswith("```"):
            flush_paragraph(); flush_lists()
            if in_code:
                story.append(Preformatted("\n".join(code_lines), STYLES["code"], maxLineLength=112))
                code_lines.clear(); in_code = False
            else:
                in_code = True
            index += 1
            continue
        if in_code:
            code_lines.append(line)
            index += 1
            continue
        if line.startswith("|") and index + 1 < len(lines) and lines[index + 1].startswith("|"):
            flush_paragraph(); flush_lists()
            table_lines = []
            while index < len(lines) and lines[index].startswith("|"):
                table_lines.append(lines[index]); index += 1
            story.append(parse_table(table_lines)); story.append(Spacer(1, 7))
            continue
        image_match = re.fullmatch(r"!\[([^]]*)\]\(([^)]+)\)", line.strip())
        if image_match:
            flush_paragraph(); flush_lists()
            story.append(diagram_flowable(image_match.group(2), image_match.group(1), page_mode == "diagram"))
            diagram_on_page = True
            index += 1
            continue
        heading = re.match(r"^(#{1,6})\s+(.+)$", line)
        if heading:
            flush_paragraph(); flush_lists()
            level = len(heading.group(1))
            title = re.sub(r"\s+#+$", "", heading.group(2)).strip()
            image_path = following_image(index)
            desired_mode = "diagram" if image_path and (diagram_aspect(image_path) or 0) >= 1.45 else "content"
            page_changed = False
            if desired_mode != page_mode:
                story.extend([NextPageTemplate(desired_mode), PageBreak()])
                page_mode = desired_mode
                diagram_on_page = False
                page_changed = True
            elif image_path and diagram_on_page:
                story.append(PageBreak())
                diagram_on_page = False
                page_changed = True
            if level == 1 and not first_heading and not page_changed:
                story.append(PageBreak())
                diagram_on_page = False
            first_heading = False
            effective = min(level, 4)
            paragraph_flowable = Paragraph(inline_markup(title), STYLES[f"h{effective}"])
            paragraph_flowable.heading_level = effective
            story.append(paragraph_flowable)
            index += 1
            continue
        if line.startswith("> "):
            flush_paragraph(); flush_lists()
            story.append(Paragraph(inline_markup(line[2:]), STYLES["quote"])); index += 1; continue
        bullet = re.match(r"^\s*[-*]\s+(.+)$", line)
        numbered = re.match(r"^\s*\d+[.)]\s+(.+)$", line)
        if bullet:
            flush_paragraph(); numbers.clear(); bullets.append(bullet.group(1)); index += 1; continue
        if numbered:
            flush_paragraph(); bullets.clear(); numbers.append(numbered.group(1)); index += 1; continue
        if not line.strip():
            flush_paragraph()
            lookahead = index + 1
            while lookahead < len(lines) and not lines[lookahead].strip():
                lookahead += 1
            continues_bullets = bool(bullets and lookahead < len(lines) and re.match(r"^\s*[-*]\s+", lines[lookahead]))
            continues_numbers = bool(numbers and lookahead < len(lines) and re.match(r"^\s*\d+[.)]\s+", lines[lookahead]))
            if not continues_bullets and not continues_numbers:
                flush_lists()
            index += 1
            continue
        paragraph.append(line)
        index += 1

    flush_paragraph(); flush_lists()
    return story


def main() -> None:
    if not INPUT.exists():
        raise SystemExit("Run scripts/build_blueprint.py before rendering the PDF.")
    manifest = yaml.safe_load((SPEC / "manifest.yaml").read_text(encoding="utf-8"))
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    text = INPUT.read_text(encoding="utf-8")
    document = BlueprintDocument(str(OUTPUT), manifest["specification"]["name"], str(manifest["specification"]["version"]))
    story = cover_story(manifest) + markdown_story(text)
    document.multiBuild(story)
    print(f"Rendered {OUTPUT.relative_to(REPOSITORY)} ({OUTPUT.stat().st_size:,} bytes)")


if __name__ == "__main__":
    main()
