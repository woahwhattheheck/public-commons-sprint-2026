"""Receive complete Word/PDF pages from existing frozen ATSSC report editions.

This is the document phase of the original customer operation. The saved
workspace is opened in SQLite read-only mode. All generated files are written
to a new output directory; no questionnaire, report, release or revision is
created by this command.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.metadata
import json
import os
import platform
import shutil
import sqlite3
import subprocess
import sys
import traceback
import xml.etree.ElementTree as ET
import zipfile
from datetime import datetime, timezone
from html import escape
from pathlib import Path

ROOT = Path(__file__).resolve().parent
NAMESPACE = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
SOURCE_FILES = ("document_exports.py", "document_reading.py", "document_navigation.py",
                "document_charts.py", "questionnaire_workspace.py", "server.py")
SCHEMA = "atssc.document-reading-receiving.v1"


def digest_file(path):
    checksum = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            checksum.update(chunk)
    return {"bytes": path.stat().st_size, "sha256": checksum.hexdigest()}


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, sort_keys=True, indent=2) + "\n").encode("utf-8")


def save_json(path, value):
    path.write_bytes(json_bytes(value))


def original_reports(workspace, report_ids):
    path = workspace.resolve() / "questionnaires.sqlite3"
    if not path.is_file():
        raise ValueError("Choose the existing workspace containing questionnaires.sqlite3")
    with sqlite3.connect(path.as_uri() + "?mode=ro", uri=True) as db:
        db.row_factory = sqlite3.Row
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        identity = db.execute("SELECT value FROM settings WHERE key='workspace_id'").fetchone()
        if identity is None:
            raise ValueError("The existing workspace has no retained identity")
        journal = db.execute("SELECT COALESCE(MAX(sequence),0) FROM journal").fetchone()[0]
        records = []
        for report_id in report_ids:
            row = db.execute("SELECT id,publication_id,edition,created,released,release_note FROM reports WHERE id=?",
                             (report_id,)).fetchone()
            if row is None:
                raise ValueError("The requested frozen report is absent: " + report_id)
            record = dict(row)
            raw = record.pop("edition")
            editions = json.loads(raw)
            if set(editions) != {"public", "protected"}:
                raise ValueError("The saved report lacks its paired original editions")
            for name, payload in editions.items():
                if payload.get("report_id") != report_id:
                    raise ValueError("The original report identifier differs in " + name)
            records.append({"record": record, "edition": editions,
                            "retained_edition_sha256": hashlib.sha256(raw.encode("utf-8")).hexdigest()})
        return {"workspace_id": identity[0], "journal_sequence": journal}, records


def word_receiving(path, model):
    with zipfile.ZipFile(path) as package:
        if package.testzip() is not None:
            raise ValueError("A generated Word member failed its ZIP integrity check")
        xml = ET.fromstring(package.read("word/document.xml"))
        anchors = {node.attrib["{" + NAMESPACE["w"] + "}name"]
                   for node in xml.findall(".//w:bookmarkStart", NAMESPACE)}
        links = [node.attrib["{" + NAMESPACE["w"] + "}anchor"]
                 for node in xml.findall(".//w:hyperlink", NAMESPACE)
                 if "{" + NAMESPACE["w"] + "}anchor" in node.attrib]
        wanted = [entry["key"] for entry in model["reading"]["entries"]]
        if not set(wanted) <= anchors or not set(links) <= anchors:
            raise ValueError("The generated Word navigation contains a missing destination")
        text = "\n".join(node.text or "" for node in xml.findall(".//w:t", NAMESPACE))
        for label in ("contents", "references"):
            if model["reading"]["labels"][label] not in text:
                raise ValueError("The selected Word reader language is absent")
        for selected in model["reading"]["selected_sources"]:
            for reference in selected["metadata"]:
                if reference not in text:
                    raise ValueError("A protected selected response reference is absent from Word")
        return {"bookmarks": len(anchors), "internal_links": len(links),
                "expected_destinations": len(wanted),
                "charts": len([name for name in package.namelist() if name.startswith("word/charts/chart") and name.endswith(".xml")]),
                "embedded_workbooks": len([name for name in package.namelist() if name.startswith("word/embeddings/")]),
                "text_characters": len(text)}


def pdf_receiving(path, model, fitz, image_directory, render_pages):
    with fitz.open(path) as document:
        expected = [(entry["level"] + 1, entry["title"]) for entry in model["reading"]["entries"]]
        outline = document.get_toc()
        if [(entry[0], entry[1]) for entry in outline] != expected:
            raise ValueError("The generated PDF outline differs from its complete reading order")
        if any(entry[2] < 1 or entry[2] > len(document) for entry in outline):
            raise ValueError("A PDF outline destination is outside the document")
        links = 0
        pages = []
        for number, page in enumerate(document, 1):
            for link in page.get_links():
                if link.get("kind") == fitz.LINK_GOTO:
                    links += 1
                    if not 0 <= link.get("page", -1) < len(document):
                        raise ValueError("A PDF contents link has no actual destination")
            entry = {"page": number, "width": page.rect.width, "height": page.rect.height,
                     "text_characters": len(page.get_text())}
            if render_pages:
                image_directory.mkdir(parents=True, exist_ok=True)
                image = image_directory / ("page-" + str(number).zfill(4) + ".png")
                page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(image)
                entry["image"] = image.as_posix()
                entry["image_identity"] = digest_file(image)
            pages.append(entry)
        if not pages:
            raise ValueError("The generated PDF has no pages")
        return {"pages": pages, "page_count": len(pages), "outline": outline, "internal_links": links}


def office_receiving(path, destination, office, fitz, render_pages):
    destination.mkdir()
    profile = destination / "profile"
    command = [office, "-env:UserInstallation=" + profile.resolve().as_uri(),
               "--headless", "--convert-to", "pdf", "--outdir", str(destination), str(path)]
    result = subprocess.run(command, capture_output=True, text=True, timeout=600)
    (destination / "conversion.log").write_text(result.stdout + "\n" + result.stderr, encoding="utf-8")
    generated = destination / (path.stem + ".pdf")
    if result.returncode or not generated.is_file():
        raise ValueError("The original Word file did not complete LibreOffice rendering; see conversion.log")
    pages = []
    with fitz.open(generated) as document:
        for number, page in enumerate(document, 1):
            entry = {"page": number, "width": page.rect.width, "height": page.rect.height,
                     "text_characters": len(page.get_text())}
            if render_pages:
                image = destination / ("page-" + str(number).zfill(4) + ".png")
                page.get_pixmap(matrix=fitz.Matrix(1.5, 1.5), alpha=False).save(image)
                entry["image"] = image.as_posix()
                entry["image_identity"] = digest_file(image)
            pages.append(entry)
    # The temporary private Office profile is reproducible runtime state.
    # Keep the original DOCX, actual converted PDF, pages and conversion log.
    if profile.exists():
        shutil.rmtree(profile)
    return {"office_path": office, "exit_code": result.returncode,
            "pdf": generated.as_posix(), "pdf_identity": digest_file(generated),
            "page_count": len(pages), "pages": pages}


def gallery(path, documents, root):
    pieces = ["<!doctype html><html lang='en'><meta charset='utf-8'>",
              "<meta name='viewport' content='width=device-width,initial-scale=1'>",
              "<title>ATSSC retained document pages</title><style>",
              "body{margin:24px auto;padding:0 18px;max-width:1200px;font:15px system-ui;color:#202020;background:#fff}",
              "h1{font-size:26px}h2{font-size:20px;margin-top:32px}figure{margin:18px 0;padding:12px;border:1px solid #bbb}",
              "img{display:block;max-width:100%;height:auto}a{color:inherit}figcaption{margin:8px 0}",
              "</style><h1>Retained ATSSC document pages</h1>",
              "<p>These are the actual generated pages from the selected saved reports. Open each document to use its native navigation.</p>"]
    for item in documents:
        pieces.append("<h2>" + escape(item["report_id"] + " · " + item["edition"] + " · " + item["language"]) + "</h2>")
        for fmt in ("pdf", "docx"):
            relative = Path(item["files"][fmt]).relative_to(root).as_posix()
            pieces.append("<p><a href='" + escape(relative, quote=True) + "'>" + fmt.upper() + "</a></p>")
        groups = [("Native PDF", item["pdf"]["pages"])]
        if item.get("word_render"):
            groups.append(("Word rendering", item["word_render"]["pages"]))
        for label, pages in groups:
            for page in pages:
                if "image" not in page:
                    continue
                relative = Path(page["image"]).relative_to(root).as_posix()
                pieces.append("<figure><figcaption>" + escape(label + " · page " + str(page["page"])) +
                              "</figcaption><a href='" + escape(relative, quote=True) + "'><img loading='lazy' alt='" +
                              escape(label + " page " + str(page["page"]), quote=True) + "' src='" +
                              escape(relative, quote=True) + "'></a></figure>")
    pieces.append("</html>")
    path.write_text("\n".join(pieces), encoding="utf-8")


def run(args):
    import fitz
    from document_exports import document_model, render_document

    output = args.output.resolve()
    if output == args.workspace.resolve() or args.workspace.resolve() in output.parents:
        raise ValueError("Choose a new receiving directory outside the retained workspace")
    output.mkdir(parents=True, exist_ok=False)
    result = {"schema": SCHEMA, "started": datetime.now(timezone.utc).isoformat(), "status": "running",
              "source": {name: digest_file(ROOT / name) for name in SOURCE_FILES},
              "runtime": {"python": platform.python_version(),
                          **{name: importlib.metadata.version(name) for name in ("python-docx", "reportlab", "PyMuPDF")}},
              "documents": []}
    summary = output / "DOCUMENT_RECEIVING.json"
    save_json(summary, result)
    try:
        identity, reports = original_reports(args.workspace, args.report_id)
        result["original_workspace"] = identity
        if args.expected_workspace_id and identity["workspace_id"] != args.expected_workspace_id:
            raise ValueError("The retained workspace identity does not match the requested case")
        for number, report in enumerate(reports, 1):
            directory = output / ("report-" + str(number).zfill(3))
            directory.mkdir()
            save_json(directory / "original-report.json", report)
            source_identity = hashlib.sha256(json_bytes(report)).hexdigest()
            for edition in ("public", "protected"):
                payload = report["edition"][edition]
                for language in args.language:
                    model = document_model(payload, language=language)
                    reading = model["reading"]
                    if edition == "public" and (reading["selected_sources"] or reading["workbooks"]):
                        raise ValueError("Private reading references entered a public document")
                    prefix = directory / (edition + "-" + language)
                    files = {fmt: Path(str(prefix) + "." + fmt) for fmt in ("pdf", "docx")}
                    for fmt, destination in files.items():
                        destination.write_bytes(render_document(payload, fmt, language=language))
                    item = {"report_id": report["record"]["id"], "edition": edition, "language": language,
                            "frozen_edition_sha256": report["retained_edition_sha256"],
                            "response_count": len(payload["accepted_responses"]), "question_count": model["question_count"],
                            "include_response_details": model["include_response_details"],
                            "files": {fmt: path.as_posix() for fmt, path in files.items()},
                            "file_identities": {fmt: digest_file(path) for fmt, path in files.items()},
                            "word": word_receiving(files["docx"], model),
                            "pdf": pdf_receiving(files["pdf"], model, fitz, Path(str(prefix) + "-pages"), args.render_pages)}
                    if args.office:
                        item["word_render"] = office_receiving(files["docx"], Path(str(prefix) + "-word-pages"),
                                                               args.office, fitz, args.render_pages)
                    result["documents"].append(item)
                    save_json(summary, result)
                    print(json.dumps({"phase": "document_received", "report_id": item["report_id"], "edition": edition,
                                      "language": language, "pdf_pages": item["pdf"]["page_count"],
                                      "word_pages": item.get("word_render", {}).get("page_count")}), flush=True)
            if hashlib.sha256(json_bytes(report)).hexdigest() != source_identity:
                raise ValueError("Rendering changed a retained source payload")
        result["status"] = "complete"
        result["completed"] = datetime.now(timezone.utc).isoformat()
        gallery(output / "DOCUMENT_PAGES.html", result["documents"], output)
    except Exception as error:
        result["status"] = "interrupted"
        result["error"] = {"type": type(error).__name__, "message": str(error), "traceback": traceback.format_exc()}
        raise
    finally:
        save_json(summary, result)
        inventory = []
        for path in sorted(output.rglob("*")):
            if path.is_file() and path.name != "DOCUMENT_FILES.json":
                inventory.append({"path": path.relative_to(output).as_posix(), **digest_file(path)})
        save_json(output / "DOCUMENT_FILES.json", {"schema": SCHEMA + ".files", "files": inventory})
    return result


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--report-id", action="append", required=True, help="Repeat for another original frozen report.")
    parser.add_argument("--expected-workspace-id")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--language", action="append", choices=("en", "fr"), help="Defaults to both original reader languages.")
    parser.add_argument("--render-pages", action="store_true", help="Save every actual PDF and optional Word page as a PNG.")
    parser.add_argument("--office", help="Actual installed soffice executable for Word page receiving.")
    args = parser.parse_args()
    args.language = list(dict.fromkeys(args.language or ["en", "fr"]))
    args.report_id = list(dict.fromkeys(args.report_id))
    result = run(args)
    print(json.dumps({"status": result["status"], "documents": len(result["documents"]),
                      "output": str(args.output.resolve())}), flush=True)


if __name__ == "__main__":
    main()
