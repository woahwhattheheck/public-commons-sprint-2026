#!/usr/bin/env python3
"""Render the complete fixed-scope Tiptap application workshare."""
import argparse
import hashlib
import json
from pathlib import Path
from xml.sax.saxutils import escape
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.colors import HexColor, Color
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import Paragraph

W, H = A4
LEFT, RIGHT = 46, W - 46
INK, GRAY, LIGHT = HexColor("#172024"), HexColor("#546066"), HexColor("#eef1f2")
styles = {
    "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=14, textColor=INK),
    "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8.5, leading=12, textColor=GRAY),
    "item": ParagraphStyle("item", fontName="Helvetica", fontSize=9.5, leading=14, textColor=INK),
    "heading": ParagraphStyle("heading", fontName="Helvetica-Bold", fontSize=12, leading=16, textColor=INK),
}

def para(c, text, x, y, width, style="body"):
    p = Paragraph(text, styles[style])
    _, height = p.wrap(width, H)
    if y-height < 45:
        raise ValueError("The complete workshare text exceeds its selected page.")
    p.drawOn(c, x, y-height)
    return y-height

def rule(c, y):
    c.setStrokeColor(HexColor("#cdd3d6"))
    c.setLineWidth(0.6)
    c.line(LEFT, y, RIGHT, y)

def header(c, page):
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(LEFT, H-36, "TOKENJUNKIE LABS")
    c.setFont("Helvetica", 8)
    c.setFillColor(GRAY)
    c.drawRightString(RIGHT, H-36, "IMPLEMENTATION WORKSHARE  /  "+str(page)+" OF 2")
    rule(c, H-46)

def footer(c, page):
    rule(c, 35)
    c.setFont("Helvetica", 8)
    c.setFillColor(GRAY)
    c.drawString(LEFT, 22, "Prepared by Bryce  |  Proposed fixed-scope implementation")
    c.drawRightString(RIGHT, 22, str(page))

def section(c, title, y):
    y = para(c, escape(title), LEFT, y, RIGHT-LEFT, "heading")
    return y-7

def numbered(c, number, title, body, y):
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 10)
    c.drawString(LEFT, y-10, str(number).zfill(2))
    y = para(c, "<b>"+escape(title)+"</b><br/>"+escape(body), LEFT+26, y, RIGHT-LEFT-26)
    return y-11

def render(source, output):
    data = json.loads(source.read_text())
    expected = (data["fixedPrice"], data["kickoff"], data["acceptance"], data["businessDays"])
    if expected != (8400, 4200, 4200, 12):
        raise ValueError("The original approved price and delivery terms changed.")
    if data["limits"] != {"applications":1,"hosts":1,"authAdapters":1,"schemas":1,"documents":1000,"totalSourceBytes":536870912,"maxDocumentBytes":33554432}:
        raise ValueError("The original accepted application scope changed.")
    output.parent.mkdir(parents=True, exist_ok=True)
    c = canvas.Canvas(str(output), pagesize=A4, pageCompression=1, invariant=1)
    c.setTitle("Tiptap / Hocuspocus Application Migration Workshare")
    c.setAuthor("Bryce - TokenJunkie Labs")
    c.setSubject("One complete collaborative application migration and operating handoff")
    header(c, 1)
    y = H-72
    c.setFont("Helvetica-Bold", 25)
    c.setFillColor(INK)
    c.drawString(LEFT, y, "Collaborative application")
    c.drawString(LEFT, y-31, "migration and operations")
    y -= 57
    y = para(c, "A complete customer workflow around the original Tiptap, Hocuspocus and Yjs engines: retained source, reviewed migration, tenant-scoped collaboration and a complete operating handoff.", LEFT, y, RIGHT-LEFT)
    y -= 18
    c.setFillColor(LIGHT)
    c.roundRect(LEFT, y-70, RIGHT-LEFT, 70, 6, fill=1, stroke=0)
    c.setFillColor(INK)
    c.setFont("Helvetica-Bold", 23)
    c.drawString(LEFT+16, y-29, "USD 8,400")
    c.setFont("Helvetica", 9)
    c.drawString(LEFT+16, y-49, "Fixed implementation price")
    c.setFont("Helvetica-Bold", 15)
    c.drawString(LEFT+280, y-27, "12 business days")
    c.setFont("Helvetica", 9)
    c.drawString(LEFT+280, y-46, "After accepted inputs and scope")
    y -= 91
    y = section(c, "The application delivery", y)
    for i, title, body in [
        (1, "Source and migration", "Retain the original document population and source hashes; review schema and tenant mapping; import accepted JSON, HTML or native Yjs binary through the shared original schema."),
        (2, "Native collaboration and access", "Integrate the customer's existing identity adapter, explicit tenant/document grants, real editor and viewer roles, original Hocuspocus deployment and full Yjs binary storage."),
        (3, "Operator and recovery workflow", "Deliver source, mapping, deployment, checkpoint, content restore, review and history screens. Preserve original requests and jobs when an operation is interrupted."),
        (4, "Complete receiving and handoff", "Deliver editable application source, exact package lock, operating guide and full project/runtime handoffs, with fresh receiving and a 60-minute engineering handoff.")
    ]:
        y = numbered(c, i, title, body, y)
    y -= 2
    y = section(c, "Scope that fits one active customer", y)
    y = para(c, "<b>One application, one host, one identity adapter and one agreed document schema.</b> Up to 1,000 source documents, 512 MiB total source and 32 MiB per document. Two consolidated review rounds and ten business days of correction for delivered-scope defects are included.", LEFT, y, RIGHT-LEFT)
    y -= 12
    para(c, "Reference selection: three explicitly authored documents across two tenants. The included source and receiving programme are reviewable; actual execution evidence is supplied as its separate, source-bound result. No customer deployment or performance result is implied.", LEFT, y, RIGHT-LEFT, "small")
    footer(c, 1)
    c.showPage()
    header(c, 2)
    y = H-72
    y = section(c, "Delivery and acceptance", y)
    y = para(c, "The 12-business-day period begins after the application, source population, host, identity adapter and written scope are accepted. Changes to those inputs are recorded with their schedule effect before implementation.", LEFT, y, RIGHT-LEFT)
    y -= 15
    rows = [
        ("Days 1-2", "Source and application intake", "Accepted population, schema, actor/tenant mapping, host and original source identities."),
        ("Days 3-5", "Native migration and permissions", "Reviewed import, retained binary documents, original deployment and exact access rules."),
        ("Days 6-8", "Editor and operator integration", "Customer editor plus source, deployment, checkpoint, restore and history workflow."),
        ("Days 9-10", "Recovery and receiving", "Concurrent editing, offline merge, content restore, configuration rollback and complete receiving."),
        ("Days 11-12", "Review and engineering handoff", "Consolidated corrections, complete editable source, receiving guide and handoff.")
    ]
    for days, title, body in rows:
        rule(c, y)
        y -= 10
        c.setFillColor(GRAY)
        c.setFont("Helvetica-Bold", 9)
        c.drawString(LEFT, y-10, days)
        yy = para(c, "<b>"+escape(title)+"</b><br/>"+escape(body), LEFT+83, y, RIGHT-LEFT-83)
        y = yy-12
    y -= 2
    y = section(c, "What acceptance demonstrates", y)
    for text in [
        "Every accepted source document has a retained identity and an explicit migration outcome; unsupported or excluded content stays visible in the reviewed mapping.",
        "Two authorized editors merge concurrent and offline changes through native Hocuspocus/Yjs. A stored deletion is confirmed by the complete persisted binary.",
        "Viewers and other tenants cannot write to the document. Revoked or earlier-epoch clients cannot continue writing to the current target.",
        "The original job can continue without repeating a committed migration. Content restore creates a new epoch; configuration rollback preserves current content.",
        "The full package opens on a fresh private receiving workspace with original source, native documents, histories, decisions and editable source intact."
    ]:
        y = para(c, "&#8226; "+escape(text), LEFT, y, RIGHT-LEFT)
        y -= 7
    y -= 6
    y = section(c, "Terms and next step", y)
    y = para(c, "<b>USD 4,200 at kickoff and USD 4,200 at acceptance.</b> Hosting, third-party licenses, paid extensions and expanded scope are separate agreed items. Acceptance covers the agreed application and population; it does not promise an unmeasured concurrency or multi-region availability target.", LEFT, y, RIGHT-LEFT)
    y -= 10
    para(c, "Route one current Hocuspocus onboarding or application migration to the integrations owner. The complete operating application and this scope can then be mapped to its actual source, identity and host.", LEFT, y, RIGHT-LEFT)
    footer(c, 2)
    c.save()
    body = output.read_bytes()
    return {"path":str(output),"bytes":len(body),"sha256":hashlib.sha256(body).hexdigest(),"pages":2,
            "input_sha256":hashlib.sha256(source.read_bytes()).hexdigest()}

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=Path(__file__).with_name("workshare-input.json"))
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(render(args.input, args.output)))
