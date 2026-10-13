"""Complete application document rendering from one reviewed private input.

This is a generic continuation of the original form/document builder. The caller
owns application editions, source custody, requests and saved output history.
"""
from __future__ import annotations

import hashlib
import html
import io
import json
import re
import threading
from pathlib import Path
from tempfile import TemporaryDirectory

from docx import Document
from docx.enum.table import WD_TABLE_ALIGNMENT, WD_CELL_VERTICAL_ALIGNMENT
from docx.oxml import OxmlElement
from docx.oxml.ns import qn
from docx.shared import Inches, Pt, RGBColor
from pypdf import PdfReader, PdfWriter
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas
from reportlab.platypus import BaseDocTemplate, Frame, PageTemplate, Paragraph, Spacer, Table, TableStyle, PageBreak

if __package__:
    from .application_form_adapter import (
        LAYOUT_ID, FORM_SHA256, RFP_SHA256, FIELD_LAYOUT, source_bytes,
        application_overlay, financial_overlay, financial_values,
    )
else:
    from application_form_adapter import (
        LAYOUT_ID, FORM_SHA256, RFP_SHA256, FIELD_LAYOUT, source_bytes,
        application_overlay, financial_overlay, financial_values,
    )

RENDERER_SCHEMA = "scc.application-renderer-inputs.v1"
RESULT_SCHEMA = "scc.application-render-result.v1"
_RENDER_LOCK = threading.Lock()
MAX_RENDER_INPUT_BYTES = 64 * 1024 * 1024

STYLES = {
    'title': ParagraphStyle('Title', fontName='Packet-Bold', fontSize=21, leading=25, spaceAfter=14, textColor=colors.black),
    'h1': ParagraphStyle('Heading1', fontName='Packet-Bold', fontSize=15, leading=19, spaceBefore=15, spaceAfter=8, keepWithNext=True),
    'h2': ParagraphStyle('Heading2', fontName='Packet-Bold', fontSize=11.5, leading=15, spaceBefore=10, spaceAfter=5, keepWithNext=True),
    'body': ParagraphStyle('Body', fontName='Packet', fontSize=11, leading=14.4, spaceAfter=7, allowWidows=0, allowOrphans=0),
    'small': ParagraphStyle('Small', fontName='Packet', fontSize=9.2, leading=12.2, spaceAfter=6),
    'cell': ParagraphStyle('Cell', fontName='Packet', fontSize=9.5, leading=12.3, spaceAfter=0),
    'cellhead': ParagraphStyle('CellHead', fontName='Packet-Bold', fontSize=9.5, leading=12.3, spaceAfter=0),
    'field': ParagraphStyle('Field', fontName='Packet', fontSize=9.3, leading=12.0, spaceAfter=0),
    'fieldsmall': ParagraphStyle('FieldSmall', fontName='Packet', fontSize=8.6, leading=11.3, spaceAfter=0),
    'source': ParagraphStyle('Source', fontName='Packet', fontSize=9.2, leading=12.5, spaceAfter=7, splitLongWords=True),
}

def plain(s):
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', str(s))
    return re.sub(r'\*\*|`', '', s).strip()


def heading(s):
    return re.sub(r'\s+', ' ', re.sub(r'[^\w\s]', ' ', plain(s), flags=re.UNICODE)).strip()


def rich(s):
    s = html.escape(str(s))
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`([^`]+)`', r'\1', s)
    s = re.sub(r'\[([^\]]+)\]\((https?://[^)]+)\)', r'<link href="\2" color="#222222">\1</link>', s)
    return s


def _markdown_cells(line):
    # Preserve escaped pipes and inline code without dropping empty edge cells.
    text = line.strip()
    if text.startswith("|"):
        text = text[1:]
    if text.endswith("|") and not text.endswith("\\|"):
        text = text[:-1]
    cells, current, code_run, index = [], [], 0, 0
    while index < len(text):
        character = text[index]
        if character == "\\" and index+1 < len(text) and text[index+1] in ("|", "\\"):
            current.append(text[index+1])
            index += 2
            continue
        if character == "\x60":
            count = 1
            while index+count < len(text) and text[index+count] == "\x60":
                count += 1
            if code_run == 0:
                code_run = count
            elif code_run == count:
                code_run = 0
            current.append("\x60"*count)
            index += count
            continue
        if character == "|" and code_run == 0:
            cells.append("".join(current).strip())
            current = []
        else:
            current.append(character)
        index += 1
    cells.append("".join(current).strip())
    return cells


def parse_markdown(text):
    lines, blocks, index = text.splitlines(), [], 0
    while index < len(lines):
        line = lines[index].strip()
        if not line:
            index += 1
            continue
        match = re.match(r"^(#{1,6})\s+(.+)", line)
        if match:
            blocks.append(("heading", len(match.group(1)), match.group(2)))
            index += 1
            continue
        if line.startswith("|"):
            rows = []
            while index < len(lines) and lines[index].strip().startswith("|"):
                cells = _markdown_cells(lines[index])
                if not all(re.fullmatch(r":?-+:?", cell) for cell in cells):
                    rows.append(cells)
                index += 1
            blocks.append(("table", rows))
            continue
        if line.startswith("- "):
            blocks.append(("bullet", line[2:]))
            index += 1
            continue
        if re.match(r"^\[R\d+\]:", line):
            blocks.append(("source", line))
            index += 1
            continue
        pieces = [line]
        index += 1
        while index < len(lines) and lines[index].strip() and not re.match(r"^(#|\||- |\[R\d+\]:)", lines[index].strip()):
            pieces.append(lines[index].strip())
            index += 1
        blocks.append(("paragraph", " ".join(pieces)))
    return blocks


class PacketDoc(BaseDocTemplate):
    def __init__(self, path, *, title, author, subject, label, footer, prefix="C"):
        super().__init__(str(path), pagesize=(612, 792), leftMargin=54,
                         rightMargin=54, topMargin=52, bottomMargin=47,
                         title=title, author=author, subject=subject)
        self.section_pages = {}
        self.label, self.footer, self.prefix = label, footer, prefix
        frame = Frame(54, 47, 504, 693, leftPadding=0, rightPadding=0,
                      topPadding=0, bottomPadding=0)
        self.addPageTemplates(PageTemplate(id="Packet", frames=frame, onPage=self.page_decor))

    def page_decor(self, c, doc):
        c.saveState()
        c.setFont("Packet", 8)
        c.setFillColor(colors.HexColor("#444444"))
        for value, y in ((self.label, 765), (self.footer, 27)):
            if c.stringWidth(value, "Packet", 8) > 448:
                raise ValueError("Document header/footer exceeds its readable margin.")
            c.drawString(54, y, value)
        c.drawRightString(558, 27, self.prefix + str(doc.page))
        c.restoreState()

    def afterFlowable(self, flowable):
        key = getattr(flowable, "_packet_section", None)
        if key is not None:
            if key in self.section_pages:
                raise ValueError("Continuation headings must identify one exact section: " + key)
            self.section_pages[key] = self.page


def pdf_table(rows, widths=None):
    n = len(rows[0])
    if widths is None:
        if rows[0] == ['Clause', 'Proposed content', 'Existing authored example support']:
            widths = [50, 214, 240]
        elif rows[0] == ['Phase', 'Engineering', 'Total phase budget', 'Release']:
            widths = [122, 122, 144, 116]
        elif rows[0] == ['SCC phase', 'Proposed timing', 'Main work and concrete delivery', 'Responsible roles']:
            widths = [92, 64, 240, 108]
        elif n == 10:
            widths = [126] + [42] * 9
        elif n == 6:
            widths = [214, 58, 58, 58, 58, 58]
        elif n == 4:
            widths = [74, 63, 259, 108]
        elif n == 3:
            widths = [126, 169, 209]
        elif n == 2:
            widths = [146, 358]
        else:
            widths = [504 / n] * n
    cells = [[Paragraph(rich(v), STYLES['cellhead' if i == 0 else 'cell']) for v in row] for i, row in enumerate(rows)]
    table = Table(cells, colWidths=widths, repeatRows=1, hAlign='LEFT', splitInRow=1)
    table.setStyle(TableStyle([
        ('BACKGROUND', (0, 0), (-1, 0), colors.HexColor('#EEEEEE')),
        ('TEXTCOLOR', (0, 0), (-1, -1), colors.black),
        ('VALIGN', (0, 0), (-1, -1), 'TOP'),
        ('LEFTPADDING', (0, 0), (-1, -1), 3 if n == 10 else 6),
        ('RIGHTPADDING', (0, 0), (-1, -1), 3 if n == 10 else 6),
        ('TOPPADDING', (0, 0), (-1, -1), 6), ('BOTTOMPADDING', (0, 0), (-1, -1), 6),
        ('BOX', (0, 0), (-1, -1), .4, colors.HexColor('#999999')),
        ('INNERGRID', (0, 0), (-1, -1), .3, colors.HexColor('#BBBBBB')),
    ]))
    return table


def pdf_story(blocks, title=None):
    story = []
    if title:
        story.extend([Paragraph(heading(title), STYLES['title'])])
    for block in blocks:
        kind = block[0]
        if kind == 'heading':
            p = Paragraph(heading(block[2]), STYLES['h1' if block[1] <= 2 else 'h2'])
            p._packet_section = block[2]
            story.append(p)
        elif kind == 'table':
            story.extend([pdf_table(block[1]), Spacer(1, 8)])
        elif kind == 'bullet':
            story.append(Paragraph('• ' + rich(block[1]), STYLES['body']))
        elif kind == 'source':
            key, url = block[1].split(':', 1)
            url = url.strip()
            story.append(Paragraph(html.escape(key) + ' <link href="' + html.escape(url) + '" color="#222222">' + html.escape(url) + '</link>', STYLES['source']))
        else:
            story.append(Paragraph(rich(block[1]), STYLES['body']))
    return story


def docx_base(title, subtitle, *, author, subject, footer_text):
    doc = Document()
    sec = doc.sections[0]
    sec.page_width = Inches(8.5)
    sec.page_height = Inches(11)
    sec.top_margin = sec.bottom_margin = Inches(.7)
    sec.left_margin = sec.right_margin = Inches(.75)
    normal = doc.styles['Normal']
    normal.font.name = 'DejaVu Sans'
    normal.font.size = Pt(11)
    normal.font.color.rgb = RGBColor(0, 0, 0)
    normal.paragraph_format.line_spacing = 1.1
    normal.paragraph_format.space_after = Pt(7)
    for name, size in [('Title', 21), ('Heading 1', 15), ('Heading 2', 11.5), ('Heading 3', 11)]:
        style = doc.styles[name]
        style.font.name = 'DejaVu Sans'
        style.font.size = Pt(size)
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.font.bold = True
        style.paragraph_format.space_before = Pt(12 if name != 'Title' else 0)
        style.paragraph_format.space_after = Pt(7)
        style.paragraph_format.keep_with_next = True
        ppr = style.element.find(qn('w:pPr'))
        if ppr is not None:
            for b in list(ppr.findall(qn('w:pBdr'))):
                ppr.remove(b)
    doc.core_properties.title = title
    doc.core_properties.author = author
    doc.core_properties.subject = subject
    doc.add_paragraph(heading(title), 'Title')
    doc.add_paragraph(subtitle)
    footer = sec.footer.paragraphs[0]
    footer.text = footer_text + '  |  '
    for run in footer.runs:
        run.font.name = 'DejaVu Sans'
        run.font.size = Pt(8)
    fld = OxmlElement('w:fldSimple')
    fld.set(qn('w:instr'), 'PAGE')
    footer._p.append(fld)
    return doc


def docx_runs(paragraph, text):
    chunks = re.split(r'(\*\*.+?\*\*)', str(text))
    for chunk in chunks:
        run_text = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'\1 (\2)', chunk)
        run_text = re.sub(r'\*\*|`', '', run_text)
        r = paragraph.add_run(run_text)
        if chunk.startswith('**') and chunk.endswith('**'):
            r.bold = True


def docx_table(doc, rows):
    table = doc.add_table(rows=1, cols=len(rows[0]))
    table.alignment = WD_TABLE_ALIGNMENT.CENTER
    table.autofit = False
    n = len(rows[0])
    if rows[0] == ['Clause', 'Proposed content', 'Existing authored example support']:
        widths = [.7, 2.97, 3.33]
    elif rows[0] == ['Phase', 'Engineering', 'Total phase budget', 'Release']:
        widths = [1.7, 1.7, 2.0, 1.6]
    elif rows[0] == ['SCC phase', 'Proposed timing', 'Main work and concrete delivery', 'Responsible roles']:
        widths = [1.3, .9, 3.3, 1.5]
    else:
        widths = ([1.75] + [5.25/9]*9 if n == 10 else [2.7, .86, .86, .86, .86, .86] if n == 6 else [1.0, .85, 3.65, 1.5] if n == 4 else [1.75, 2.35, 2.9] if n == 3 else [2.0, 5.0] if n == 2 else [7/n]*n)
    for col, width in zip(table.columns, widths):
        col.width = Inches(width)
    for i, row_data in enumerate(rows):
        row = table.rows[0] if i == 0 else table.add_row()
        for j, value in enumerate(row_data):
            cell = row.cells[j]
            cell.width = Inches(widths[j])
            cell.vertical_alignment = WD_CELL_VERTICAL_ALIGNMENT.TOP
            p = cell.paragraphs[0]
            p.paragraph_format.space_after = Pt(0)
            p.paragraph_format.line_spacing = 1.06
            p.paragraph_format.keep_with_next = False
            docx_runs(p, value)
            for r in p.runs:
                r.font.name = 'DejaVu Sans'
                r.font.size = Pt(9.5)
                if i == 0:
                    r.bold = True
            tcpr = cell._tc.get_or_add_tcPr()
            margins = OxmlElement('w:tcMar')
            for side in ['top', 'left', 'bottom', 'right']:
                el = OxmlElement('w:' + side)
                compact = (n == 10 and side in ('left', 'right')) or (rows[0] == ['Clause', 'Proposed content', 'Existing authored example support'] and side in ('top', 'bottom'))
                el.set(qn('w:w'), '60' if compact else '85')
                el.set(qn('w:type'), 'dxa')
                margins.append(el)
            tcpr.append(margins)
            borders = OxmlElement('w:tcBorders')
            for side in ['top', 'left', 'bottom', 'right']:
                el = OxmlElement('w:' + side)
                el.set(qn('w:val'), 'single')
                el.set(qn('w:sz'), '4')
                el.set(qn('w:color'), 'BBBBBB')
                borders.append(el)
            tcpr.append(borders)
            if i == 0:
                shd = OxmlElement('w:shd')
                shd.set(qn('w:fill'), 'EEEEEE')
                tcpr.append(shd)
        if i == 0:
            repeat = OxmlElement('w:tblHeader')
            row._tr.get_or_add_trPr().append(repeat)
    doc.add_paragraph().paragraph_format.space_after = Pt(1)


def docx_blocks(doc, blocks):
    for block in blocks:
        if block[0] == 'heading':
            doc.add_paragraph(heading(block[2]), 'Heading 1' if block[1] <= 2 else 'Heading 2')
        elif block[0] == 'table':
            docx_table(doc, block[1])
        elif block[0] == 'bullet':
            p = doc.add_paragraph(style='List Bullet')
            docx_runs(p, block[1])
        elif block[0] == 'source':
            p = doc.add_paragraph(block[1])
            for r in p.runs:
                r.font.size = Pt(9)
        else:
            p = doc.add_paragraph()
            docx_runs(p, block[1])



def _canonical(value):
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"), allow_nan=False)


def _text(value, name, *, maximum=MAX_RENDER_INPUT_BYTES, empty=False):
    if not isinstance(value, str) or (not empty and not value.strip()) or len(value.encode("utf-8")) > maximum:
        raise ValueError("Retain complete " + name + " within its documented allowance.")
    return value


def _input(value):
    # Freeze once before any source read. Concurrent caller changes cannot change
    # one selected rendering halfway through its documents.
    raw = _canonical(value).encode("utf-8")
    if len(raw) > MAX_RENDER_INPUT_BYTES:
        raise ValueError("Complete selected rendering inputs exceed 64 MiB.")
    selected = json.loads(raw)
    if selected.get("schema") != RENDERER_SCHEMA or selected.get("layoutId") != LAYOUT_ID:
        raise ValueError("Use the complete reviewed input and its exact original-form layout.")
    for key in ("title", "date", "author", "subject", "footer", "formFooter", "financialFooter"):
        _text(selected.get(key), key, maximum=2000)
    if "token junkie labs" not in selected["author"].lower() and "tjlabs" not in selected["author"].lower():
        raise ValueError("Retain TJLabs producer attribution in document metadata.")
    for key in ("responseMarkdown", "outlineMarkdown", "scheduleMarkdown", "offerMarkdown"):
        _text(selected.get(key), key)
    titles = selected.get("documentTitles")
    required = {"application", "responses", "attachments", "financial", "offer"}
    if not isinstance(titles, dict) or set(titles) != required:
        raise ValueError("Retain all five selected document titles.")
    for key, val in titles.items():
        _text(val, "document title " + key, maximum=1000)
    fields = selected.get("formFields")
    if not isinstance(fields, dict) or set(fields) != {row[0] for row in FIELD_LAYOUT}:
        raise ValueError("Retain the complete forty-field original-form selection.")
    financial_values(selected.get("financial"))
    return selected, raw


def _fonts(font_dir=None):
    # All original emitted documents use the same fully embedded Unicode faces.
    # No network/font download and no silently substituted fallback font.
    roots = ([Path(font_dir)] if font_dir is not None else [
        Path("/usr/share/fonts/truetype/dejavu"),
        Path("/usr/local/share/fonts/dejavu"),
        Path(__file__).resolve().parent / "fonts",
    ])
    root = next((p for p in roots if all((p/f).is_file()
                 for f in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf"))), None)
    if root is None:
        raise RuntimeError("Install DejaVu Sans and Bold or supply the existing font_dir.")
    identities = {}
    for suffix, filename in (("", "DejaVuSans.ttf"), ("-Bold", "DejaVuSans-Bold.ttf")):
        path = root / filename
        raw = path.read_bytes()
        identities[filename] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
        pdfmetrics.registerFont(TTFont("Packet" + suffix, io.BytesIO(raw)))
    pdfmetrics.registerFontFamily("Packet", normal="Packet", bold="Packet-Bold",
                                 italic="Packet", boldItalic="Packet-Bold")
    return identities


def _blocks(markdown):
    blocks = parse_markdown(markdown)
    for block in blocks:
        if block[0] == "table":
            rows = block[1]
            if not rows or not rows[0] or any(len(row) != len(rows[0]) for row in rows):
                raise ValueError("Every selected Markdown table must retain its complete rectangular cells.")
    return blocks


def _panels(blocks):
    # Original nine-month charts retain their ten-column layout. Longer selected
    # calendars are complete ordered panels, with the first identifying column
    # repeated; no smaller unreadable type or omitted month.
    result = []
    for block in blocks:
        if block[0] != "table" or len(block[1][0]) <= 10:
            result.append(block)
            continue
        rows = block[1]
        for start in range(1, len(rows[0]), 9):
            end = min(len(rows[0]), start+9)
            result.append(("paragraph", "Continued table columns " + str(start+1) + " to " + str(end) + "."))
            result.append(("table", [[row[0]] + row[start:end] for row in rows]))
    return result


def _draw_field(c, text, x, top, width, height, compact, key):
    if not text:
        return
    paragraph = Paragraph(rich(text), STYLES["fieldsmall" if compact else "field"])
    _, needed = paragraph.wrap(width, height)
    if needed > height + .01:
        # Do not include private answer contents in raised/logged diagnostics.
        raise ValueError("Original form field " + key + " overflows its retained rectangle; shorten the selected summary and reference its full continuation.")
    paragraph.drawOn(c, x, 792-top-needed)


def _code_identity():
    result = {}
    for name in ("application_renderer.py", "application_form_adapter.py"):
        raw = Path(__file__).with_name(name).read_bytes()
        result[name] = {"bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}
    return result


def render_application(renderer_inputs, read_source, *, font_dir=None):
    """Return every newly rendered document as bytes for the original Workspace.

    read_source(source_id) returns (complete original bytes, metadata). The
    Workspace alone commits the selected edition, output bytes and request.
    This function never overwrites a prior output or signs/submits a document.
    """
    selected, input_bytes = _input(renderer_inputs)
    if not callable(read_source):
        raise TypeError("The original source reader is required.")
    original_form = source_bytes(read_source, selected.get("sourceForm"), expected_sha=FORM_SHA256)
    original_rfp = source_bytes(read_source, selected.get("sourceRfp"), expected_sha=RFP_SHA256)
    # ReportLab's font registry is process-global; serialize only this renderer's
    # complete invocation, not the caller's workspace/revision transaction.
    with _RENDER_LOCK, TemporaryDirectory(prefix="scc-application-edition-") as temporary:
        fonts = _fonts(font_dir)
        directory = Path(temporary)
        titles = selected["documentTitles"]
        common = {"author": selected["author"], "subject": selected["subject"],
                  "footer": selected["footer"]}
        answer_blocks = _panels(_blocks(selected["responseMarkdown"]))
        continuation = PacketDoc(directory/"application-continuation.pdf",
                                 title=titles["responses"], label="Application continuation", **common)
        continuation.build(pdf_story(answer_blocks, titles["responses"]))
        original, overlay = application_overlay(original_form, selected["formFields"],
                                                continuation.section_pages, _draw_field,
                                                selected["formFooter"])
        writer = PdfWriter()
        writer.add_metadata({"/Title": titles["application"], "/Author": selected["author"],
                             "/Subject": selected["subject"]})
        for index, page in enumerate(original.pages):
            page.merge_page(overlay.pages[index])
            writer.add_page(page)
        writer.add_outline_item("Original application form", 0)
        continuation_pdf = PdfReader(directory/"application-continuation.pdf")
        writer.append(continuation_pdf, import_outline=False)
        root = writer.add_outline_item("Integral continuation responses", 13)
        for label, number in continuation.section_pages.items():
            writer.add_outline_item(heading(label), 12+number, parent=root)
        with (directory/"application-form.pdf").open("wb") as stream:
            writer.write(stream)
        responses = docx_base(titles["responses"], selected["title"] + " | " + selected["date"],
                              author=selected["author"], subject=selected["subject"],
                              footer_text=selected["footer"])
        docx_blocks(responses, answer_blocks)
        responses.save(directory/"application-responses.docx")
        outline = _panels(_blocks(selected["outlineMarkdown"]))
        schedule = _panels(_blocks(selected["scheduleMarkdown"]))
        attachments = PacketDoc(directory/"outline-and-schedule.pdf", title=titles["attachments"],
                                label="Outline and work schedule", prefix="A", **common)
        attachments.build(pdf_story(outline, titles["attachments"]) + [PageBreak()] + pdf_story(schedule))
        document = docx_base(titles["attachments"], selected["title"] + " | " + selected["date"],
                             author=selected["author"], subject=selected["subject"],
                             footer_text=selected["footer"])
        docx_blocks(document, outline)
        document.add_page_break()
        docx_blocks(document, schedule)
        document.save(directory/"outline-and-schedule.docx")
        (directory/"financial-proposal.pdf").write_bytes(financial_overlay(
            original_rfp, selected["financial"], footer=selected["financialFooter"],
            title=titles["financial"], author=selected["author"]))
        offer = PacketDoc(directory/"technical-delivery-offer.pdf", title=titles["offer"],
                          label="Technical delivery offer", prefix="P", **common)
        offer.build(pdf_story(_panels(_blocks(selected["offerMarkdown"])), titles["offer"]))
        expected = ("application-form.pdf", "application-continuation.pdf",
                    "application-responses.docx", "outline-and-schedule.pdf",
                    "outline-and-schedule.docx", "financial-proposal.pdf",
                    "technical-delivery-offer.pdf")
        outputs = {name: (directory/name).read_bytes() for name in expected}
        outputs.update({
            "application-responses.md": selected["responseMarkdown"].encode("utf-8"),
            "outline.md": selected["outlineMarkdown"].encode("utf-8"),
            "schedule.md": selected["scheduleMarkdown"].encode("utf-8"),
            "technical-delivery-offer.md": selected["offerMarkdown"].encode("utf-8"),
            "selected-renderer-inputs.json": input_bytes+b"\n",
        })
        manifest = {
            "schema": RESULT_SCHEMA,
            "rendererInputSha256": hashlib.sha256(input_bytes).hexdigest(),
            "layoutId": LAYOUT_ID,
            "sourceForm": selected["sourceForm"],
            "sourceRfp": selected["sourceRfp"],
            "renderer": _code_identity(), "fonts": fonts,
            "continuationSections": continuation.section_pages,
            "financial": selected["financial"],
            "originalFormPages": 13,
            "pages": {name: len(PdfReader(io.BytesIO(value)).pages)
                      for name, value in outputs.items() if name.endswith(".pdf")},
            "files": {name: {"bytes": len(value), "sha256": hashlib.sha256(value).hexdigest()}
                      for name, value in outputs.items()},
            "state": "RENDERED_AWAITING_PRODUCING_OPERATOR_INSPECTION",
        }
        outputs["render-result.json"] = (_canonical(manifest)+"\n").encode("utf-8")
        return outputs
