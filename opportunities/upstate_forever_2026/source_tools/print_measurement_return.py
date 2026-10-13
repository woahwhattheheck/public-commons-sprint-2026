#!/usr/bin/env python3
"""Print a source-bound working brief from a completed returned-review comparison."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sqlite3
from xml.sax.saxutils import escape
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle, KeepTogether


def sha(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def print_brief(plan_directory: Path, output: Path, result_directory: Path | None = None) -> dict:
    root = plan_directory.resolve(strict=True)
    plan = json.loads((root / "plan.json").read_text("utf-8"))
    if plan.get("format") != "upper-savannah-returned-reviews/v1" or sha(root / "plan.sqlite") != plan["database"]["sha256"]:
        raise ValueError("The original saved comparison differs")
    result = json.loads((result_directory / "incorporated.json").read_text("utf-8")) if result_directory else None
    if result and result["planId"] != plan["id"]:
        raise ValueError("The native result belongs to another comparison")
    if output.exists():
        raise FileExistsError("Choose a new PDF output")
    output.parent.mkdir(parents=True, exist_ok=True)
    styles = {
        "kicker": ParagraphStyle("kicker", fontName="Helvetica", fontSize=8, leading=11, textColor=colors.HexColor("#555555"), spaceAfter=9),
        "title": ParagraphStyle("title", fontName="Helvetica-Bold", fontSize=25, leading=29, textColor=colors.HexColor("#222222"), spaceAfter=12),
        "h2": ParagraphStyle("h2", fontName="Helvetica-Bold", fontSize=13, leading=17, spaceBefore=15, spaceAfter=7, keepWithNext=True),
        "body": ParagraphStyle("body", fontName="Helvetica", fontSize=9.5, leading=14, spaceAfter=8),
        "small": ParagraphStyle("small", fontName="Helvetica", fontSize=8, leading=11, spaceAfter=5, wordWrap="CJK"),
        "cell": ParagraphStyle("cell", fontName="Helvetica", fontSize=8, leading=11, spaceAfter=0, wordWrap="CJK"),
    }
    def p(text: str, style: str = "body") -> Paragraph:
        return Paragraph(text, styles[style])
    story = [p("ECOSYSTEM SCIENCES / MEASUREMENTS", "kicker"), p(escape(plan["title"]), "title"),
             p("A complete review-return handoff: compare the exact sent edition, returned reviewer work and current scientist work, then carry selected changes into a separate editable native project.")]
    counts = plan["counts"]
    metric_rows = [["CURRENT RECORDS", "READY TO INCORPORATE", "OVERLAPPING CHANGES"],
                   [f'{plan["inventory"]["current"]["recordCount"]:,}', str(counts["apply-return"]), str(counts["conflict"])],
                   ["ORIGINAL SOURCES", "ALREADY CURRENT", "SOURCE / REVIEW REQUIRED"],
                   [str(plan["inventory"]["current"]["sourceCount"]), str(counts["already-current"]), str(counts["source-needed"])]]
    metrics = Table(metric_rows, colWidths=[166, 166, 167], rowHeights=[24, 38, 24, 38])
    metrics.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, -1), colors.HexColor("#f2f2f2")), ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#aaaaaa")), ("FONTNAME", (0, 0), (-1, -1), "Helvetica"), ("FONTSIZE", (0, 0), (-1, -1), 7), ("FONTSIZE", (0, 1), (-1, 1), 21), ("FONTSIZE", (0, 3), (-1, 3), 21), ("BOTTOMPADDING", (0, 1), (-1, 1), 13), ("BOTTOMPADDING", (0, 3), (-1, 3), 13), ("TOPPADDING", (0, 0), (-1, 0), 12), ("LEFTPADDING", (0, 0), (-1, -1), 12), ("VALIGN", (0, 0), (-1, -1), "TOP")]))
    story += [Spacer(1, 6), metrics, p("Original editions", "h2")]
    data = [[p("EDITION", "cell"), p("RECORDS / SOURCES", "cell"), p("SOURCE REVISION", "cell"), p("COMPLETE ARCHIVE", "cell")]]
    for role in ("baseline", "returned", "current"):
        inventory = plan["inventory"][role]
        data.append([p(escape(role.title()), "cell"), p(f'{inventory["recordCount"]:,} / {inventory["sourceCount"]}', "cell"), p(str(plan["sourceRevisions"][role]), "cell"), p(f'inputs/{role}.zip<br/>{plan["inputs"][role]["bytes"]:,} bytes', "cell")])
    table = Table(data, colWidths=[95, 105, 100, 199], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")), ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#bbbbbb")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
    story.append(table)
    if result:
        story += [p("Completed native incorporation", "h2"), p(f'{result["adoptedGroups"]} returned groups incorporated through {result["actionCount"]} original native edit calls; {result["retainedGroups"]} changed groups explicitly kept current. Result revision {result["resultRevision"]}. The complete result contains {result["recordCount"]:,} records and all retained original source companions.'),
                  p("Incorporating reviewer: " + escape(result["reviewer"]) + ". " + escape(result["reason"]), "small")]
    story += [p("What the recipient can use", "h2"), p("<b>review.html</b> opens the complete three-way decision desk. <b>changes.csv</b>, <b>changes.jsonl</b> and <b>plan.sqlite</b> retain every changed group. Each input archive is complete. The native result contains an editable <b>measurements/</b> workspace, a complete <b>edition/project.zip</b> and all-record/calibration exports."),
              p("Only review decisions and explicit station assignments change. Reported values, original identities, censor bounds and native eligibility remain intact. The scientist’s independent current work is preserved. Reviewer names and reasons are recorded provenance, not authenticated signatures.", "small")]
    db = sqlite3.connect((root / "plan.sqlite").as_uri() + "?mode=ro", uri=True)
    try:
        detail_column = "details" if "details" in {row[1] for row in db.execute("PRAGMA table_info(changes)")} else "'{}'"
        changes = db.execute("SELECT kind,key,classification,returned,current," + detail_column + " FROM changes ORDER BY CASE classification WHEN 'conflict' THEN 0 ELSE 1 END,kind,key")
        story.append(p("Changed groups in this edition", "h2"))
        data = [[p(x, "cell") for x in ("ORIGINAL MEASUREMENT / STATION", "DISPOSITION", "RETURNED / CURRENT REVIEW")]]
        for kind, key, classification, returned_text, current_text, details_text in changes:
            returned, current = json.loads(returned_text), json.loads(current_text)
            if kind == "measurement":
                original = (returned["records"] or current["records"])[0]
                details = json.loads(details_text)
                source = details.get("returned", {}).get(original["id"], {}) or details.get("current", {}).get(original["id"], {})
                label = f'{original["stationId"]}<br/>{source.get("characteristic") or original["parameter"]} · {original["sampledDate"]}<br/>{key[:16]}…'
                states = lambda state: ", ".join(sorted({row["review"]["state"] for row in state["records"]}))
                detail = f'Returned: {states(returned)}<br/>Current: {states(current)}'
            else:
                label = key
                detail = 'Returned: ' + (returned.get("reachId") or "explicitly unassigned") if returned else 'Returned: no assignment'
                detail += '<br/>Current: ' + ((current.get("reachId") or "explicitly unassigned") if current else "no assignment")
            data.append([p("<br/>".join(escape(x) for x in label.split("<br/>")), "cell"), p(escape(classification.replace("-", " ")), "cell"), p("<br/>".join(escape(x) for x in detail.split("<br/>")), "cell")])
        if len(data) == 1:
            story.append(p("No returned changes; the original current work is retained."))
        else:
            ledger = Table(data, colWidths=[226, 109, 164], repeatRows=1, hAlign="LEFT")
            ledger.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#eeeeee")), ("LINEBELOW", (0, 0), (-1, -1), 0.4, colors.HexColor("#bbbbbb")), ("VALIGN", (0, 0), (-1, -1), "TOP"), ("TOPPADDING", (0, 0), (-1, -1), 8), ("BOTTOMPADDING", (0, 0), (-1, -1), 8)]))
            story.append(ledger)
    finally:
        db.close()
    story += [Spacer(1, 12), p("Complete comparison identity: " + plan["id"], "small"), p("All source archive hashes and full review rationales are retained in the companion comparison. This brief is a printable view of those saved records.", "small")]
    def footer(canvas, doc):
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#aaaaaa"))
        canvas.line(48, 38, A4[0] - 48, 38)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#555555"))
        canvas.drawString(48, 25, "Measurements / returned work / " + plan["id"][:12])
        canvas.drawRightString(A4[0] - 48, 25, str(doc.page))
        canvas.restoreState()
    doc = SimpleDocTemplate(str(output), pagesize=A4, leftMargin=48, rightMargin=48, topMargin=40, bottomMargin=53, title=plan["title"], author="Token Junkie Labs")
    doc.build(story, onFirstPage=footer, onLaterPages=footer)
    return {"planId": plan["id"], "file": str(output), "bytes": output.stat().st_size, "sha256": sha(output)}


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--plan", type=Path, required=True)
    parser.add_argument("--result", type=Path)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    print(json.dumps(print_brief(args.plan, args.output, args.result), indent=2))
