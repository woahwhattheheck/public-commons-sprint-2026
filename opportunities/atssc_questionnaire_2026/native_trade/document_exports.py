"""Editable Word and paginated PDF exports of retained questionnaire editions.

The renderer receives one already selected current response or frozen report.
It never loads the workspace, older revisions, credentials or workbook sources.
Public field and cell projection is applied before either output is built.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import re
import threading
import zipfile
import copy
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation
from pathlib import Path
from xml.sax.saxutils import escape


ROOT = Path(__file__).resolve().parent
FONT_ROOT = ROOT / "export-assets" / "fonts"
_FONT_LOCK = threading.Lock()
_FONT_READY = False
METRIC_LABELS = {"count":"Count", "percentage":"Percentage", "sum":"Sum", "average":"Mean",
                 "minimum":"Minimum", "maximum":"Maximum", "ratio":"Ratio"}


class DocumentExportError(ValueError):
    """An edition is absent, ambiguous, or cannot be rendered faithfully."""


def _text(value):
    if value is None:
        return ""
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (str, int, float, Decimal)):
        result = str(value)
    else:
        result = json.dumps(value, ensure_ascii=False, sort_keys=True)
    # Preserve all printable text and original line breaks in both formats.
    if re.search(r"[\x00-\x08\x0b\x0c\x0e-\x1f]", result):
        raise DocumentExportError("An answer contains a nonprinting control character")
    return result.replace("\r\n", "\n").replace("\r", "\n")


def _edition(payload):
    explicit = payload.get("edition")
    inferred = next((x for x in str(payload.get("schema", "")).split(".")
                     if x in {"public", "protected"}), None)
    if explicit is not None and explicit not in {"public", "protected"}:
        raise DocumentExportError("Choose a public or protected document edition")
    if explicit and inferred and explicit != inferred:
        raise DocumentExportError("The document schema and edition disagree")
    result = explicit or inferred
    if result is None:
        raise DocumentExportError("The retained payload must identify its disclosure edition")
    return result


def _choice(question, choice, parent=None):
    default = question.get("disclosure", "protected")
    if parent == "protected":
        default = "protected"
    chosen = choice.get("classification", default)
    if chosen not in {"public", "protected"}:
        raise DocumentExportError("A disclosure classification is invalid")
    # Protected definitions, protected parents, and protected calculations
    # remain protected even if an inconsistent payload says public.
    if default == "protected" or choice.get("derived_from_protected"):
        chosen = "protected"
    return chosen


def _number(value):
    try:
        result = Decimal(str(value))
    except (InvalidOperation, ValueError):
        raise DocumentExportError("A numeric answer is not a finite decimal") from None
    if not result.is_finite():
        raise DocumentExportError("A numeric answer is not a finite decimal")
    return result


def _question_context(question):
    label = _text(question.get("label", question["id"]))
    heading = question.get("original_question_heading")
    if isinstance(heading, dict):
        heading = heading.get("text")
    context = []
    section = question.get("section")
    if isinstance(section, str) and section:
        context.append("Worksheet " + _text(section))
    if heading and _text(heading) != label:
        context.append(_text(heading))
    prompt = question.get("original_question_text")
    if prompt and _text(prompt) not in {label, _text(heading)}:
        context.append(_text(prompt))
    return context


def document_model(payload):
    """Return the common disclosure-safe content used by Word and PDF."""
    if not isinstance(payload, dict):
        raise DocumentExportError("Supply the retained document edition as an object")
    edition = _edition(payload)
    questions = payload.get("questions", payload.get("definition", {}).get("questions"))
    responses = payload.get("accepted_responses")
    if not isinstance(questions, list) or not isinstance(responses, list):
        raise DocumentExportError("The edition needs ordered questions and response records")
    if len({q.get("id") for q in questions}) != len(questions):
        raise DocumentExportError("Document question identifiers must be distinct")
    title = _text(payload.get("questionnaire_title") or payload.get("definition", {}).get("title") or "Questionnaire")
    state = _text(payload.get("state") or "Frozen report")
    model = {
        "title": title, "edition": edition, "state": state,
        "created": _text(payload.get("created") or payload.get("updated")),
        "record_id": _text(payload.get("report_id") if edition == "public" else payload.get("report_id") or payload.get("response_id") or payload.get("respondent_id")),
        "question_count": len(questions), "responses": [], "numeric_totals": [],
        "language": payload.get("language", "en"),
        "orientation":"portrait", "density":"comfortable", "columns":1,
        "description":"", "view_sections":[], "include_response_details":True,
    }
    if "report_views" in payload or "report_layout" in payload:
        views, layout = payload.get("report_views"), payload.get("report_layout")
        if not isinstance(views,dict) or not isinstance(layout,dict) or views.get("edition") != edition:
            raise DocumentExportError("Supply matching frozen layout and disclosure-specific report views")
        by_id = {x["id"]:x for x in views.get("sections",[])}
        ordered = layout.get("ordered_sections",[])
        if len(by_id) != len(views.get("sections",[])) or set(by_id) != {x["id"] for x in ordered}:
            raise DocumentExportError("The frozen ordered layout and full view inventory disagree")
        model.update(title=_text(layout.get("title") or title), questionnaire_title=title,
                     description=_text(layout.get("description")), orientation=layout.get("orientation","portrait"),
                     density=layout.get("density","comfortable"), columns=layout.get("columns",1),
                     view_sections=[copy.deepcopy(by_id[x["id"]]) for x in ordered],
                     include_response_details=layout.get("include_response_details",False) is True)
        if model["orientation"] not in {"portrait","landscape"} or model["columns"] not in {1,2} or model["density"] not in {"comfortable","compact"}:
            raise DocumentExportError("The saved report layout is invalid")
    released_numbers = {q["id"]: [] for q in questions if q.get("kind") in {"number", "integer"}}
    for response_index, response in enumerate(responses, 1):
        if not isinstance(response, dict) or not isinstance(response.get("values"), dict):
            raise DocumentExportError("Each retained response needs an answer object")
        heading = "Response " + str(response.get("response_number", response_index))
        metadata = []
        if edition == "protected":
            if response.get("name"):
                heading += "  " + _text(response["name"])
            for label, key in (("Accepted revision", "accepted_number"), ("Current revision", "revision_number")):
                if response.get(key) is not None:
                    metadata.append(label + " " + _text(response[key]))
            if response.get("revision_id"):
                metadata.append("Revision " + _text(response["revision_id"]))
        rendered = {"heading": heading, "metadata": metadata, "questions": []}
        choices = response.get("disclosures", {})
        alternatives = response.get("public_alternatives", {})
        for question in questions:
            qid = question["id"]
            choice = choices.get(qid, {})
            classification = _choice(question, choice)
            item = {
                "id": qid, "label": _text(question.get("label", qid)),
                "kind": question.get("kind", "text"), "unit": _text(question.get("unit")),
                "classification": classification,
                "alternative": _text(alternatives.get(qid) or choice.get("public_alternative")),
            }
            item["context"] = _question_context(question)
            original = response["values"].get(qid)
            withheld = edition == "public" and classification == "protected"
            if item["kind"] == "table":
                columns = question.get("columns", [])
                if not columns or not isinstance(original, (list, type(None))):
                    raise DocumentExportError("A table answer needs declared columns and retained rows")
                item["columns"] = [{"id": c["id"], "label": _text(c.get("label", c["id"])), "unit": _text(c.get("unit"))} for c in columns]
                original_rows = original or []
                cell_choices = choice.get("cells", [])
                item["rows"] = []
                for row_index in range(max(len(original_rows), len(cell_choices))):
                    row = original_rows[row_index] if row_index < len(original_rows) else {}
                    cells = cell_choices[row_index] if row_index < len(cell_choices) else {}
                    rendered_row = []
                    for column in columns:
                        cell_choice = cells.get(column["id"], {})
                        cell_classification = _choice(column, cell_choice, classification)
                        cell_withheld = edition == "public" and (withheld or cell_classification == "protected")
                        value = None if cell_withheld else row.get(column["id"])
                        rendered_row.append({
                            "text": "Protected answer withheld" if cell_withheld else _text(value) or "Not answered",
                            "classification": cell_classification,
                            "alternative": _text(cell_choice.get("public_alternative")),
                        })
                    item["rows"].append(rendered_row)
                item["empty_text"] = "Protected answer withheld" if withheld else "No answer rows"
            else:
                value = None if withheld else original
                item["text"] = "Protected answer withheld" if withheld else _text(value) or "Not answered"
                if qid in released_numbers and value is not None and value != "":
                    released_numbers[qid].append(_number(value))
            rendered["questions"].append(item)
        model["responses"].append(rendered)
    # Summary statistics are calculated only from the selected visible values.
    # Public alternatives are text and never enter numeric statistics.
    for q in questions:
        if q["id"] not in released_numbers:
            continue
        numbers = released_numbers[q["id"]]
        total = sum(numbers, Decimal(0))
        model["numeric_totals"].append({
            "label": _text(q.get("label", q["id"])), "unit": _text(q.get("unit")),
            "context": _question_context(q),
            "answered": str(len(numbers)), "sum": format(total, "f") if numbers else "No public answers" if edition == "public" else "Not answered",
            "mean": format(total / len(numbers), "f") if numbers else "",
            "minimum": format(min(numbers), "f") if numbers else "",
            "maximum": format(max(numbers), "f") if numbers else "",
        })
    return model


def _date(value):
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00")).astimezone(timezone.utc).replace(tzinfo=None)
    except (ValueError, AttributeError):
        return datetime(2000, 1, 1)


def _cell_text(cell):
    text = cell["text"]
    if cell.get("alternative"):
        text += "\nPublic alternative\n" + cell["alternative"]
    return text


def _intro(model):
    records = len(model["responses"])
    questions = model["question_count"]
    return ("This document contains " + str(records) + " response record" + ("s" if records != 1 else "")
            + " and " + str(questions) + " question" + ("s" if questions != 1 else "") + " in the saved order.")


def _metric(value):
    return "Not available" if value is None else _text(value)


def _view_chart(view):
    if view.get("kind") == "text" or view.get("chart") == "none" or not view.get("summary", {}).get("answered"):
        return None
    metric = next((x for x in view["statistics"] if x in {"sum","average","ratio","count","percentage"}),"count")
    if view.get("cross_tab"):
        cross = view["cross_tab"]
        return {"kind":view["chart"], "title":view["title"], "categories":cross["years"],
                "series":[{"name":row["label"], "values":[cell["summary"].get(metric) if cell["summary"] else None for cell in row["cells"]]} for row in cross["rows"]]}
    if view.get("groups"):
        categories = [" / ".join(_text(x) for x in row["dimensions"] + ([row["year"]] if row.get("year") is not None else [])) or "Selected answers" for row in view["groups"]]
        values = [row["summary"].get(metric) for row in view["groups"]]
    elif view["variable"]["kind"] in {"number","integer"}:
        categories, values = ["Selected answers"], [view["summary"].get(metric)]
    else:
        metric = "count"
        categories, values = [_text(x["value"]) for x in view.get("frequencies",[])], [x["count"] for x in view.get("frequencies",[])]
    return {"kind":view["chart"], "title":view["title"], "categories":categories,
            "series":[{"name":METRIC_LABELS[metric], "values":values}]}


def _view_tables(view, width_inches):
    """Full readable tables, including every metric and every retained year."""
    tables = []
    cross = view.get("cross_tab")
    if cross:
        years_per_table = max(1,min(5,int((width_inches-1.7)/.95)))
        for metric in view["statistics"]:
            for start in range(0,len(cross["years"]),years_per_table):
                years = cross["years"][start:start+years_per_table]
                rows = [[row["label"]]+[_metric(cell["summary"].get(metric) if cell["summary"] else None) for cell in row["cells"][start:start+years_per_table]] for row in cross["rows"]]
                tables.append((METRIC_LABELS[metric] + " by year", ["Group"]+[_text(x) for x in years], rows))
    elif view.get("groups"):
        for metric in view["statistics"]:
            headers = [x["label"] for x in view.get("group_by",[])] + (["Year"] if view.get("year_field") else []) + [METRIC_LABELS[metric]]
            rows = [[_text(x) for x in row["dimensions"]]+([_text(row["year"])] if view.get("year_field") else [])+[_metric(row["summary"].get(metric))] for row in view["groups"]]
            if len(headers)>5:
                rows = [[" / ".join(row[:-1]),row[-1]] for row in rows]
                headers = ["Group",METRIC_LABELS[metric]]
            tables.append((METRIC_LABELS[metric] + " by group",headers,rows))
    elif view.get("frequencies") and view["variable"]["kind"] not in {"number","integer"}:
        tables.append(("Visible answers",["Answer","Count","Percentage"],[[_text(x["value"]),_text(x["count"]),_text(x["percentage"])] for x in view["frequencies"]]))
    return tables


def _word(model):
    try:
        from docx import Document
        from docx.shared import Inches, Pt, RGBColor
        from docx.enum.table import WD_ALIGN_VERTICAL
        from docx.enum.text import WD_ALIGN_PARAGRAPH
        from docx.enum.section import WD_SECTION_START, WD_ORIENT
        from docx.oxml import OxmlElement
        from docx.oxml.ns import qn
    except ImportError as exc:
        raise DocumentExportError("Install requirements-documents.txt to enable Word exports") from exc
    doc = Document()
    # The bundled default Word template inherits an accent rule on Title.
    # Remove paragraph borders so this industrial document uses whitespace.
    for style in doc.styles:
        for border in list(style.element.xpath(".//w:pBdr")):
            border.getparent().remove(border)
    section = doc.sections[0]
    landscape = model["orientation"] == "landscape"
    section.orientation = WD_ORIENT.LANDSCAPE if landscape else WD_ORIENT.PORTRAIT
    section.page_width, section.page_height = (Inches(11),Inches(8.5)) if landscape else (Inches(8.5),Inches(11))
    section.top_margin = section.bottom_margin = Inches(0.65)
    section.left_margin = section.right_margin = Inches(0.7)
    section.footer_distance = Inches(0.3)
    for name in ("Normal", "Title", "Subtitle", "Heading 1", "Heading 2", "Heading 3"):
        style = doc.styles[name]
        style.font.name = "DejaVu Sans"
        style.font.color.rgb = RGBColor(0, 0, 0)
        style.paragraph_format.space_after = Pt(7)
        if name != "Normal":
            style.paragraph_format.keep_with_next = True
    doc.styles["Normal"].font.size = Pt(11)
    doc.styles["Normal"].paragraph_format.line_spacing = 1.08 if model["density"] == "compact" else 1.14
    if model["density"] == "compact": doc.styles["Normal"].paragraph_format.space_after = Pt(4)
    for name, size in (("Title", 22), ("Heading 1", 16), ("Heading 2", 12)):
        doc.styles[name].font.size = Pt(size)
    for name in ("Heading 1", "Heading 2", "Heading 3"):
        doc.styles[name].paragraph_format.space_before = Pt(9)
    doc.core_properties.title = model["title"]
    doc.core_properties.subject = model["edition"].capitalize() + " questionnaire edition"
    doc.core_properties.author = "Questionnaire Operations"
    doc.core_properties.created = doc.core_properties.modified = _date(model["created"])
    doc.add_paragraph(model["title"], "Title")
    doc.add_paragraph(model["edition"].capitalize() + " questionnaire edition", "Subtitle")
    doc.add_paragraph(_intro(model))
    doc.add_paragraph(model["state"] + (". Saved " + model["created"] if model["created"] else ""))
    if model["record_id"]:
        doc.add_paragraph("Record " + model["record_id"])
    if model.get("questionnaire_title") and model["questionnaire_title"] != model["title"]:
        doc.add_paragraph("Questionnaire " + model["questionnaire_title"])
    if model["description"]:
        doc.add_paragraph(model["description"])
    full_width = (11 if landscape else 8.5) - 1.4
    width = (full_width - .25 * (model["columns"]-1)) / model["columns"]
    if model["columns"] == 2:
        body_section = doc.add_section(WD_SECTION_START.CONTINUOUS)
        columns = body_section._sectPr.find(qn("w:cols"))
        columns.set(qn("w:num"),"2")
        columns.set(qn("w:space"),"360")

    def table(headers, rows, widths=None):
        result = doc.add_table(rows=1, cols=len(headers))
        result.autofit = False
        widths = [x * width / 7.1 for x in widths] if widths else [width / len(headers)] * len(headers)
        for column, column_width in zip(result.columns, widths):
            column.width = Inches(column_width)
        for cell, label in zip(result.rows[0].cells, headers):
            cell.text = label
        repeat = OxmlElement("w:tblHeader")
        result.rows[0]._tr.get_or_add_trPr().append(repeat)
        for row in rows:
            for cell, text in zip(result.add_row().cells, row):
                cell.text = text
        for index, row in enumerate(result.rows):
            # Keep normal answer rows whole; Word can still paginate a row
            # whose content is taller than the complete printable page.
            row._tr.get_or_add_trPr().append(OxmlElement("w:cantSplit"))
            for cell_index, cell in enumerate(row.cells):
                cell.width = Inches(widths[cell_index])
                cell.vertical_alignment = WD_ALIGN_VERTICAL.CENTER
                properties = cell._tc.get_or_add_tcPr()
                margins = OxmlElement("w:tcMar")
                for side in ("top", "bottom", "left", "right"):
                    margin = OxmlElement("w:" + side)
                    margin.set(qn("w:w"), "95")
                    margin.set(qn("w:type"), "dxa")
                    margins.append(margin)
                properties.append(margins)
                borders = OxmlElement("w:tcBorders")
                for side in ("top", "bottom", "left", "right"):
                    border = OxmlElement("w:" + side)
                    for key, value in (("val", "single"), ("sz", "4"), ("color", "D9D9D9")):
                        border.set(qn("w:" + key), value)
                    borders.append(border)
                properties.append(borders)
                shading = OxmlElement("w:shd")
                shading.set(qn("w:fill"), "404040" if index == 0 else "F5F5F5" if index % 2 == 0 else "FFFFFF")
                properties.append(shading)
                for paragraph in cell.paragraphs:
                    paragraph.paragraph_format.space_after = Pt(3)
                    for run in paragraph.runs:
                        run.font.size = Pt(10)
                        if index == 0:
                            paragraph.paragraph_format.keep_with_next = True
                            run.font.bold = True
                            run.font.color.rgb = RGBColor(255, 255, 255)
        doc.add_paragraph().paragraph_format.space_after = Pt(3)
        return result

    if model["numeric_totals"] and not model["view_sections"]:
        doc.add_paragraph("Summary statistics", "Heading 1")
        previous_context = None
        for summary in model["numeric_totals"]:
            context = tuple(summary["context"])
            if context and context != previous_context:
                for value in context:
                    doc.add_paragraph(value).paragraph_format.keep_with_next = True
            previous_context = context
            doc.add_paragraph(summary["label"] + ("  " + summary["unit"] if summary["unit"] else ""), "Heading 2")
            table(["Count", "Sum", "Mean", "Minimum", "Maximum"], [[summary[x] for x in ("answered", "sum", "mean", "minimum", "maximum")]], [0.75, 1.8, 1.8, 1.375, 1.375])
    if model["view_sections"]:
        from document_charts import append_word_chart, chart_panels
        for view in model["view_sections"]:
            doc.add_paragraph(_text(view["title"]),"Heading 1")
            if view.get("note"): doc.add_paragraph(_text(view["note"]))
            if view["kind"] == "text": continue
            table(["Statistic","Value"],[[METRIC_LABELS[x],_metric(view["summary"].get(x))] for x in view["statistics"]],[2.1,5.0])
            doc.add_paragraph(str(view["summary"]["answered"])+" visible answers from "+str(view["summary"]["observations"])+" observations.")
            spec = _view_chart(view)
            for panel in chart_panels(spec) if spec else []:
                doc.add_paragraph(panel["title"],"Heading 2")
                append_word_chart(doc,panel,width=width,height=3.2 if width>5 else 2.9)
            for title,headers,rows in _view_tables(view,width):
                doc.add_paragraph(title,"Heading 2")
                table(headers,rows)
    for response in model["responses"] if model["include_response_details"] else []:
        doc.add_paragraph(response["heading"], "Heading 1")
        for metadata in response["metadata"]:
            doc.add_paragraph(metadata).paragraph_format.keep_with_next = True
        previous_context = None
        for question in response["questions"]:
            context = tuple(question["context"])
            if context and context != previous_context:
                for value in context:
                    doc.add_paragraph(value).paragraph_format.keep_with_next = True
            previous_context = context
            doc.add_paragraph(question["label"], "Heading 2")
            disclosure = doc.add_paragraph(question["classification"].capitalize() + (". Unit " + question["unit"] if question["unit"] else ""))
            disclosure.paragraph_format.keep_with_next = True
            if question["kind"] == "table":
                if question["rows"]:
                    headers = [c["label"] + (" (" + c["unit"] + ")" if c["unit"] else "") for c in question["columns"]]
                    if len(headers) <= max(2,min(5,int(width/.9))):
                        table(headers, [[_cell_text(c) for c in row] for row in question["rows"]])
                    else:
                        # Preserve all original columns in readable row records.
                        for row_number, row in enumerate(question["rows"], 1):
                            doc.add_paragraph("Answer row " + str(row_number), "Heading 3")
                            table(["Column", "Answer"], list(zip(headers, [_cell_text(c) for c in row])), [2.1, 5.0])
                else:
                    doc.add_paragraph(question["empty_text"])
            else:
                doc.add_paragraph(question["text"])
            if question["alternative"]:
                doc.add_paragraph("Public alternative", "Heading 3")
                doc.add_paragraph(question["alternative"])
    footer = section.footer.paragraphs[0]
    footer.alignment = WD_ALIGN_PARAGRAPH.RIGHT
    footer.add_run(model["edition"].capitalize() + " edition  |  Page ").font.size = Pt(9)
    page = OxmlElement("w:fldSimple")
    page.set(qn("w:instr"), "PAGE")
    footer._p.append(page)
    stream = io.BytesIO()
    doc.save(stream)
    # Stable archive timestamps make repeated frozen downloads byte-identical.
    output = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(stream.getvalue())) as original, zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as result:
        for name in sorted(original.namelist()):
            info = zipfile.ZipInfo(name, (2000, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o600 << 16
            result.writestr(info, original.read(name))
    return output.getvalue()


def _pdf(model):
    try:
        from reportlab.pdfbase import pdfmetrics
        from reportlab.pdfbase.ttfonts import TTFont
        from reportlab.lib import colors
        from reportlab.lib.styles import ParagraphStyle
        from reportlab.lib.enums import TA_LEFT
        from reportlab.lib.pagesizes import letter, landscape
        from reportlab.platypus import SimpleDocTemplate, BaseDocTemplate, PageTemplate, Frame, Paragraph, Spacer, LongTable, TableStyle, CondPageBreak
    except ImportError as exc:
        raise DocumentExportError("Install requirements-documents.txt to enable PDF exports") from exc
    global _FONT_READY
    with _FONT_LOCK:
        if not _FONT_READY:
            for name, filename in (("QuestionnaireSans", "DejaVuSans.ttf"), ("QuestionnaireSansBold", "DejaVuSans-Bold.ttf")):
                path = FONT_ROOT / filename
                if not path.is_file():
                    raise DocumentExportError("The customer project is missing its embedded export font " + filename)
                pdfmetrics.registerFont(TTFont(name, str(path)))
            pdfmetrics.registerFontFamily("QuestionnaireSans", normal="QuestionnaireSans", bold="QuestionnaireSansBold", italic="QuestionnaireSans", boldItalic="QuestionnaireSansBold")
            _FONT_READY = True
    styles = {
        "body": ParagraphStyle("Body", fontName="QuestionnaireSans", fontSize=10.5, leading=14.5, spaceAfter=7, alignment=TA_LEFT, splitLongWords=True),
        "title": ParagraphStyle("Title", fontName="QuestionnaireSansBold", fontSize=22, leading=27, spaceAfter=13, keepWithNext=True),
        "heading": ParagraphStyle("Heading", fontName="QuestionnaireSansBold", fontSize=15, leading=20, spaceBefore=13, spaceAfter=8, keepWithNext=True),
        "question": ParagraphStyle("Question", fontName="QuestionnaireSansBold", fontSize=11.5, leading=16, spaceBefore=9, spaceAfter=6, keepWithNext=True),
        "metadata": ParagraphStyle("Metadata", fontName="QuestionnaireSans", fontSize=10.5, leading=14.5, spaceAfter=7, keepWithNext=True),
        "record": ParagraphStyle("Record", fontName="QuestionnaireSansBold", fontSize=11.5, leading=16, spaceBefore=9, spaceAfter=6),
        "cell": ParagraphStyle("Cell", fontName="QuestionnaireSans", fontSize=9.5, leading=13, splitLongWords=True),
        "header": ParagraphStyle("Header", fontName="QuestionnaireSansBold", fontSize=9.5, leading=13, textColor=colors.white),
    }
    compact = model["density"] == "compact"
    if compact:
        styles["body"].spaceAfter = 4
        styles["heading"].spaceBefore = 8
    page_size = landscape(letter) if model["orientation"] == "landscape" else letter
    full_width = page_size[0] - 100.8
    width = (full_width - 18*(model["columns"]-1))/model["columns"]
    def paragraph(text, kind="body"):
        return Paragraph(escape(text).replace("\n", "<br/>"), styles[kind])
    story = [paragraph(model["title"], "title"), paragraph(model["edition"].capitalize() + " questionnaire edition"), paragraph(_intro(model)), paragraph(model["state"] + (". Saved " + model["created"] if model["created"] else ""))]
    if model["record_id"]:
        story.append(paragraph("Record " + model["record_id"]))
    if model.get("questionnaire_title") and model["questionnaire_title"] != model["title"]:
        story.append(paragraph("Questionnaire " + model["questionnaire_title"]))
    if model["description"]: story.append(paragraph(model["description"]))
    intro, story = story, []
    def table(headers, rows, widths=None, caption=None):
        content = [[paragraph(label, "header") for label in headers]] + [[paragraph(text, "cell") for text in row] for row in rows]
        widths = [x*width/511.2 for x in widths] if widths else [width/len(headers)]*len(headers)
        tallest_row = max((max(cell.wrap(widths[index]-14,1000000)[1] for index,cell in enumerate(row))+14 for row in content[1:]),default=0)
        # Whole normal rows avoid a header-only partial fragment at a page
        # boundary. A genuinely page-tall answer may still split internally.
        result = LongTable(content, colWidths=widths, repeatRows=1, hAlign="LEFT", splitByRow=1, splitInRow=int(tallest_row>page_size[1]-125))
        result.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#404040")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F5F5")]),
            ("GRID", (0, 0), (-1, -1), .5, colors.HexColor("#D9D9D9")),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 7), ("RIGHTPADDING", (0, 0), (-1, -1), 7),
            ("TOPPADDING", (0, 0), (-1, -1), 5 if compact else 7), ("BOTTOMPADDING", (0, 0), (-1, -1), 5 if compact else 7),
        ]))
        if caption is not None:
            heading = paragraph(caption, "record")
            padding = 10 if compact else 14
            first_rows = sum(max(cell.wrap(widths[index]-14,1000000)[1] for index,cell in enumerate(row))+padding for row in content[:2])
            minimum = heading.wrap(width,1000000)[1]+heading.getSpaceBefore()+heading.getSpaceAfter()+first_rows+8
            prefix_start = len(story)
            while prefix_start and story[prefix_start-1].getKeepWithNext():
                prefix_start -= 1
                prefix = story[prefix_start]
                minimum += prefix.wrap(width,1000000)[1]+prefix.getSpaceBefore()+prefix.getSpaceAfter()
            # Protect the caption and first complete row, without keeping the
            # entire long table together or leaving its question context behind.
            story.insert(prefix_start,CondPageBreak(min(minimum,page_size[1]-110)))
            story.append(heading)
        story.extend([result, Spacer(1, 8)])
    if model["numeric_totals"] and not model["view_sections"]:
        story.append(paragraph("Summary statistics", "heading"))
        previous_context = None
        for summary in model["numeric_totals"]:
            context = tuple(summary["context"])
            if context and context != previous_context:
                for value in context:
                    story.append(paragraph(value, "metadata"))
            previous_context = context
            story.append(paragraph(summary["label"] + ("  " + summary["unit"] if summary["unit"] else ""), "question"))
            table(["Count", "Sum", "Mean", "Minimum", "Maximum"], [[summary[x] for x in ("answered", "sum", "mean", "minimum", "maximum")]], [54, 129.6, 129.6, 99, 99])
    if model["view_sections"]:
        from document_charts import chart_panels, pdf_chart
        for view in model["view_sections"]:
            story.append(paragraph(_text(view["title"]),"heading"))
            if view.get("note"):
                story.append(paragraph(_text(view["note"]), "metadata" if view["kind"] != "text" else "body"))
            if view["kind"] == "text": continue
            table(["Statistic","Value"],[[METRIC_LABELS[x],_metric(view["summary"].get(x))] for x in view["statistics"]],[151.2,360])
            story.append(paragraph(str(view["summary"]["answered"])+" visible answers from "+str(view["summary"]["observations"])+" observations."))
            spec = _view_chart(view)
            for panel in chart_panels(spec) if spec else []:
                story.append(paragraph(panel["title"],"question"))
                story.extend([pdf_chart(panel,width=width,height=220 if width>360 else 210),Spacer(1,8)])
            for title,headers,rows in _view_tables(view,width/72):
                table(headers,rows,caption=title)
    for response in model["responses"] if model["include_response_details"] else []:
        story.append(paragraph(response["heading"], "heading"))
        story.extend(paragraph(value,"metadata") for value in response["metadata"])
        previous_context = None
        for question in response["questions"]:
            context = tuple(question["context"])
            if context and context != previous_context:
                story.extend(paragraph(value,"metadata") for value in context)
            previous_context = context
            story.append(paragraph(question["label"], "question"))
            story.append(paragraph(question["classification"].capitalize() + (". Unit " + question["unit"] if question["unit"] else ""), "metadata"))
            if question["kind"] == "table":
                if question["rows"]:
                    headers = [c["label"] + (" (" + c["unit"] + ")" if c["unit"] else "") for c in question["columns"]]
                    if len(headers) <= max(2,min(5,int(width/64.8))):
                        table(headers, [[_cell_text(c) for c in row] for row in question["rows"]])
                    else:
                        for row_number, row in enumerate(question["rows"], 1):
                            table(["Column", "Answer"], list(zip(headers, [_cell_text(c) for c in row])), [151.2, 360],caption="Answer row " + str(row_number))
                else:
                    story.append(paragraph(question["empty_text"]))
            else:
                story.append(paragraph(question["text"]))
            if question["alternative"]:
                story.append(paragraph("Public alternative", "question"))
                story.append(paragraph(question["alternative"]))
    output = io.BytesIO()
    def footer(canvas, document):
        # Preserve deterministic bytes while giving the exported PDF the
        # retained edition's actual UTC date rather than invariant's 1999 date.
        created = _date(model["created"])
        canvas.setDateFormatter(lambda *unused: created.strftime("D:%Y%m%d%H%M%S") + "+00'00'")
        canvas.setCreator("Questionnaire Operations")
        canvas.saveState()
        canvas.setFont("QuestionnaireSans", 8)
        canvas.drawRightString(page_size[0]-50.4, 22, model["edition"].capitalize() + " edition  |  Page " + str(document.page))
        canvas.restoreState()
    options = dict(pagesize=page_size,leftMargin=50.4,rightMargin=50.4,topMargin=46.8,bottomMargin=46.8,title=model["title"],author="Questionnaire Operations",subject=model["edition"].capitalize()+" questionnaire edition",invariant=True)
    if model["columns"] == 1:
        document = SimpleDocTemplate(output,**options)
        document.build(intro+story,onFirstPage=footer,onLaterPages=footer)
    else:
        # A full-width opening followed by the saved two-column layout. Later
        # pages keep two complete text frames and the same source order.
        intro_height = sum(x.wrap(full_width,1000000)[1]+x.getSpaceBefore()+x.getSpaceAfter() for x in intro)+18
        if intro_height > page_size[1]-180:
            raise DocumentExportError("The report opening is too tall for its selected two-column layout")
        def first_page(canvas,document):
            footer(canvas,document)
            opening = Frame(50.4,page_size[1]-46.8-intro_height,full_width,intro_height,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0)
            opening.addFromList(copy.deepcopy(intro),canvas)
        def frames(height):
            return [Frame(50.4+index*(width+18),46.8,width,height,leftPadding=0,rightPadding=0,topPadding=0,bottomPadding=0,id="column"+str(index)) for index in range(2)]
        document = BaseDocTemplate(output,**options)
        document.addPageTemplates([PageTemplate(id="first",frames=frames(page_size[1]-93.6-intro_height),onPage=first_page,autoNextPageTemplate="later"),PageTemplate(id="later",frames=frames(page_size[1]-93.6),onPage=footer)])
        document.build(story)
    return output.getvalue()


def render_document(payload, format_name):
    """Render the supplied retained edition to complete PDF or editable DOCX bytes."""
    if format_name not in {"pdf", "docx"}:
        raise DocumentExportError("Questionnaire document downloads use PDF or Word")
    model = document_model(payload)
    return _pdf(model) if format_name == "pdf" else _word(model)


def main():
    parser = argparse.ArgumentParser(description="Render one retained questionnaire document edition")
    parser.add_argument("payload", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    if args.output.exists():
        parser.error("Choose a new output path")
    data = render_document(json.loads(args.payload.read_text(encoding="utf-8")), args.output.suffix.lstrip("."))
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("xb") as stream:
        stream.write(data)
    print(json.dumps({"path":str(args.output), "bytes":len(data), "sha256":hashlib.sha256(data).hexdigest()}))


if __name__ == "__main__":
    main()
