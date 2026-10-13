"""Original SCC form geometry and guarded, private-source PDF overlays.

The rectangles are retained from the original application builder. This module
contains no applicant answers, budget, contact, CV or signature material.
"""
from __future__ import annotations

import hashlib
import io
import re
from decimal import Decimal, InvalidOperation

LAYOUT_ID = "scc-cfp-2026-01-en-original-13-page.v1"
FORM_SHA256 = "145a7cc034da6928f405a9bd07e01e25eaeae1a6c6a5dffcc27b9055c53bff09"
RFP_SHA256 = "35ed019f958246615201a8b661e66a4f47ae3f36faab2eb0c224388d8ea88980"
# key, one-based page, x, top from page top, width, height, compact font.
FIELD_LAYOUT = (
 ("applicant_organization",1,80,184,450,18,True),
 ("signer_primary",1,80,265,208,17,True),
 ("signer_alternate",1,303,265,228,17,True),
 ("signer_primary_title",1,80,309,208,17,True),
 ("signer_alternate_title",1,303,309,228,17,True),
 ("contact_primary",1,80,375,208,17,True),
 ("contact_alternate",1,303,375,228,17,True),
 ("contact_primary_title",1,80,419,208,17,True),
 ("contact_alternate_title",1,303,419,228,17,True),
 ("email_primary",1,80,550,208,17,True),
 ("email_alternate",1,303,550,228,17,True),
 ("address_primary",1,80,593,208,18,True),
 ("address_alternate",1,303,593,228,18,True),
 ("start_month",2,316,587,210,16,True),
 ("duration",2,316,609,210,16,True),
 ("standards_evidence",3,407,145,150,150,True),
 ("team_evidence",3,407,350,150,125,True),
 ("roadmap",4,407,275,150,130,True),
 ("language",5,407,98,150,153,True),
 ("application_completeness",5,407,305,150,125,True),
 ("canadian_eligibility",6,407,98,150,170,True),
 ("budget",7,407,95,150,230,True),
 ("attachments",8,78,180,471,50,False),
 ("proposal_title",9,112,490,435,40,False),
 ("scope",9,117,534,430,37,False),
 ("sector",9,78,622,468,59,False),
 ("standard_type",10,219,145,330,20,False),
 ("process",10,78,204,471,27,False),
 ("outline",10,78,290,471,76,False),
 ("related_standards",10,78,490,471,38,True),
 ("gap",10,78,654,471,43,True),
 ("roadmap_mechanisms",11,78,491,471,73,False),
 ("audience",11,78,661,471,37,True),
 ("source_evidence",12,78,172,471,48,False),
 ("stakeholder_support",12,78,287,471,36,False),
 ("benefits",12,78,389,471,43,False),
 ("schedule",13,78,119,471,33,True),
 ("promotion_experience",13,78,309,471,54,False),
 ("promotion_plan",13,78,455,471,74,False),
 ("measurement",13,78,598,471,75,False),
)


def source_bytes(read_source, descriptor, *, expected_sha=None):
    """Read one original source through the caller's existing custody."""
    if not isinstance(descriptor, dict):
        raise ValueError("Retain the complete original source descriptor.")
    source_id = descriptor.get("sourceId")
    sha = descriptor.get("sha256")
    size = descriptor.get("bytes")
    if (not isinstance(source_id, str) or not source_id
            or not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha)
            or type(size) is not int or size < 1):
        raise ValueError("Original source identity, bytes and SHA256 are required.")
    value = read_source(source_id)
    if not isinstance(value, tuple) or len(value) != 2:
        raise ValueError("Source custody must return (complete bytes, metadata).")
    raw, metadata = value
    if not isinstance(raw, bytes) or not isinstance(metadata, dict):
        raise ValueError("Receive the original bytes and source metadata.")
    if len(raw) != size or hashlib.sha256(raw).hexdigest() != sha:
        raise ValueError("The original source differs from the selected edition: " + source_id)
    if expected_sha is not None and sha != expected_sha:
        raise ValueError("This geometry belongs to another original source edition.")
    # Metadata is not substituted for the independently checked actual bytes.
    for key, actual in (("bytes", size), ("sha256", sha)):
        if key in metadata and metadata[key] != actual:
            raise ValueError("The custody metadata conflicts with its original bytes.")
    return raw


def resolve_fields(fields, section_pages):
    if not isinstance(fields, dict) or set(fields) != {row[0] for row in FIELD_LAYOUT}:
        raise ValueError("Retain all forty explicit original-form field selections.")
    result = {}
    for key, selected in fields.items():
        if isinstance(selected, str):
            text, refs = selected, []
        elif isinstance(selected, dict) and set(selected) <= {"text", "references"}:
            text, refs = selected.get("text"), selected.get("references", [])
        else:
            raise ValueError("Invalid original form field: " + key)
        if not isinstance(text, str) or not isinstance(refs, list):
            raise ValueError("Retain original form text and explicit continuation references.")
        tokens = set()
        for ref in refs:
            if not isinstance(ref, dict) or set(ref) != {"token", "section"}:
                raise ValueError("A continuation reference needs its token and exact heading.")
            token, section = ref["token"], ref["section"]
            if (not isinstance(token, str) or not token or token in tokens
                    or token not in text or section not in section_pages):
                raise ValueError("Unresolved original continuation reference in " + key)
            tokens.add(token)
            text = text.replace(token, "C" + str(section_pages[section]))
        if re.search(r"\{\{[^{}]+\}\}", text):
            raise ValueError("Unresolved original form template token in " + key)
        result[key] = text
    return result


def application_overlay(original_bytes, fields, section_pages, draw_field, footer):
    from pypdf import PdfReader
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors

    original = PdfReader(io.BytesIO(original_bytes))
    if len(original.pages) != 13:
        raise ValueError("The selected original application must retain all thirteen pages.")
    if original.get_fields():
        raise ValueError("This static-overlay adapter cannot replace interactive AcroForm values.")
    for page in original.pages:
        box = page.mediabox
        if (abs(float(box.width)-612) > .01 or abs(float(box.height)-792) > .01
                or float(box.left) != 0 or float(box.bottom) != 0
                or int(page.get("/Rotate", 0)) % 360 != 0
                or tuple(page.cropbox) != tuple(box)):
            raise ValueError("The original form geometry does not match this retained adapter.")
    values = resolve_fields(fields, section_pages)
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(612, 792), invariant=1)
    for number in range(1, 14):
        c.setFillColor(colors.HexColor("#333333"))
        c.setFont("Packet", 7.4)
        if c.stringWidth(footer, "Packet", 7.4) > 466:
            raise ValueError("The form footer is too long for its original margin.")
        c.drawString(73, 29, footer)
        for key, page, x, top, width, height, compact in FIELD_LAYOUT:
            if page == number:
                draw_field(c, values[key], x, top, width, height, compact, key)
        c.showPage()
    c.save()
    return original, PdfReader(io.BytesIO(buffer.getvalue()))


def financial_values(financial):
    if not isinstance(financial, dict) or financial.get("currency") != "CAD":
        raise ValueError("The original SCC Appendix D requires explicitly selected CAD values.")
    def amount(value):
        # Decimal strings prevent loss of the original minor-unit value.
        if not isinstance(value, str) or not re.fullmatch(r"(0|[1-9]\d*)(\.\d{1,2})?", value):
            raise ValueError("Use nonnegative CAD decimal strings with at most two decimal places.")
        try:
            result = Decimal(value)
        except InvalidOperation as exc:
            raise ValueError("Invalid selected financial amount.") from exc
        if result > Decimal("999999999999.99"):
            raise ValueError("The selected amount exceeds the financial form allowance.")
        return result
    phases = financial.get("phaseAmounts")
    if not isinstance(phases, list) or len(phases) != 4:
        raise ValueError("Retain each of the four original phase amounts.")
    phases = list(map(amount, phases))
    base = amount(financial.get("baseBudget"))
    allowance = amount(financial.get("olaMaximum"))
    maximum = amount(financial.get("maximumBudget"))
    if sum(phases) != base or base + allowance != maximum:
        raise ValueError("Selected financial amounts do not reconcile.")
    return list(zip(("Report 1", "Report 2", "Report 3", "Report 4",
                     "Total before contingency", "Contingency Amount", "Maximum Total"),
                    phases + [base, allowance, maximum]))


def financial_overlay(rfp_bytes, financial, *, footer, title, author):
    """Fill the original Appendix D page; preserve its complete printed notes."""
    import pdfplumber
    from pypdf import PdfReader, PdfWriter
    from reportlab.pdfgen import canvas
    from reportlab.lib import colors

    values = financial_values(financial)
    source = PdfReader(io.BytesIO(rfp_bytes))
    if len(source.pages) <= 28:
        raise ValueError("The selected original RFP has no Appendix D page 29.")
    selected = source.pages[28]
    if int(selected.get("/Rotate", 0)) % 360 or tuple(selected.cropbox) != tuple(selected.mediabox):
        raise ValueError("The retained Appendix D page geometry changed.")
    with pdfplumber.open(io.BytesIO(rfp_bytes)) as pdf:
        page = pdf.pages[28]
        lines, words = page.extract_text_lines(), page.extract_words()
        width, height = float(page.width), float(page.height)
    buffer = io.BytesIO()
    c = canvas.Canvas(buffer, pagesize=(width, height), invariant=1)
    c.setFont("Packet", 11)
    for label, amount in values:
        matches = [row for row in lines if label in row["text"]]
        if len(matches) != 1:
            raise ValueError("The original financial row is missing or ambiguous: " + label)
        row = matches[0]
        display = format(amount, ",.0f") if amount == amount.to_integral_value() else format(amount, ",.2f")
        if label == "Contingency Amount":
            placeholders = [line for line in lines if line["text"].startswith("Up to $")]
            if len(placeholders) != 1:
                raise ValueError("The original allowance placeholder is ambiguous.")
            tokens = [w for w in words if w["text"] == "XX"
                      and abs(w["top"] - placeholders[0]["top"]) < 3]
            if len(tokens) != 1:
                raise ValueError("The original allowance token is missing or ambiguous.")
            token = tokens[0]
            x, top = token["x0"], token["top"]
            following = [w["x0"] for w in words if w["x0"] >= token["x1"]
                         and abs(w["top"]-top) < 3]
            right_edge = min(following) - 2 if following else min(width-72, x+65)
            if c.stringWidth(display, "Packet", 11) > right_edge-x:
                raise ValueError("The selected allowance cannot fit without covering original financial notes.")
            c.setFillColor(colors.white)
            c.rect(x-1, height-token["bottom"]-2,
                   token["x1"]-x+2, token["bottom"]-top+4, stroke=0, fill=1)
            c.setFillColor(colors.black)
            c.drawString(x, height-top-10.7, display)
        else:
            dollars = [w for w in words if w["text"] == "$" and abs(w["top"]-row["top"]) < 3]
            if len(dollars) != 1:
                raise ValueError("The original amount field is missing or ambiguous: " + label)
            dollar = dollars[0]
            x = dollar["x1"]+5
            if c.stringWidth(display, "Packet", 11) > width-72-x:
                raise ValueError("The selected financial amount exceeds its original field.")
            c.drawString(x, height-dollar["top"]-10.7, display)
    c.setFont("Packet", 7.6)
    if c.stringWidth(footer, "Packet", 7.6) > width-144:
        raise ValueError("The financial footer exceeds the original margin.")
    c.drawString(72, 30, footer)
    c.save()
    selected.merge_page(PdfReader(io.BytesIO(buffer.getvalue())).pages[0])
    writer = PdfWriter()
    writer.add_page(selected)
    writer.add_metadata({"/Title": title, "/Author": author})
    result = io.BytesIO()
    writer.write(result)
    return result.getvalue()
