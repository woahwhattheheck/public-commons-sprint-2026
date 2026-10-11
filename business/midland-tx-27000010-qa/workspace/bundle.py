#!/usr/bin/env python3
"""Original Midland file inventory and portable package carrier. No GIS engine."""
import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import shutil
import stat
import sys
import uuid
import zipfile
from xml.sax.saxutils import escape


def file_digest(path):
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            size += len(block)
            digest.update(block)
    return digest.hexdigest(), size


def inventory_pdf(source, output):
    import reportlab
    from reportlab.pdfbase import pdfmetrics
    from reportlab.pdfbase.ttfonts import TTFont
    from reportlab.lib import colors
    from reportlab.lib.pagesizes import landscape, letter
    from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
    from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, LongTable, TableStyle

    value = json.loads(Path(source).read_text(encoding="utf-8"))
    font_root = Path(reportlab.__file__).parent / "fonts"
    pdfmetrics.registerFont(TTFont("InventoryRegular", str(font_root / "Vera.ttf")))
    pdfmetrics.registerFont(TTFont("InventoryBold", str(font_root / "VeraBd.ttf")))
    styles = getSampleStyleSheet()
    styles["Normal"].fontName = "InventoryRegular"
    styles["Normal"].fontSize = 9
    styles["Normal"].leading = 13
    styles["Title"].fontName = "InventoryBold"
    styles["Title"].fontSize = 18
    styles["Title"].leading = 23
    styles["Title"].alignment = 0
    styles["Heading2"].fontName = "InventoryBold"
    styles["Heading2"].fontSize = 12
    styles["Heading2"].leading = 16
    styles.add(ParagraphStyle("InventoryCell", fontName="InventoryRegular", fontSize=8, leading=10,
                             spaceAfter=0, splitLongWords=True))
    styles.add(ParagraphStyle("InventoryHash", fontName="InventoryRegular", fontSize=7.3, leading=10))
    story = [Paragraph("Midland geospatial delivery inventory", styles["Title"]),
             Paragraph(escape(value["title"]), styles["Heading2"]),
             Paragraph(escape(value["label"]) + " · Prepared " + escape(value["created_at"]),
                       styles["Normal"]),
             Paragraph("Reviewer: " + escape(value["reviewer"]), styles["Normal"]),
             Spacer(1, 10), Paragraph(escape(value["note"]), styles["Normal"]),
             Spacer(1, 10),
             Paragraph("SHA-256 identifies the exact retained bytes. This inventory records the selected delivery "
                       "edition and its attribute review; acquisition, spatial accuracy, billing validation and "
                       "City acceptance remain separate source-linked project records. CSV and PDF inventory files "
                       "are listed in SHA256SUMS.txt after generation.", styles["Normal"]), Spacer(1, 14)]
    cell = lambda value: Paragraph(escape(str(value)), styles["InventoryCell"])
    rows = [[cell(x) for x in ["File", "Bytes", "SHA-256", "Role", "Original source"]]]
    for item in value["files"]:
        sha = item["sha256"]
        rows.append([cell(item["path"]), cell(item["size"]),
                     Paragraph(sha[:32] + "<br/>" + sha[32:], styles["InventoryHash"]),
                     cell(item.get("role", "").replace("_", " ")), cell(item.get("source_ref", ""))])
    table = LongTable(rows, colWidths=[205, 55, 165, 90, 205], repeatRows=1, hAlign="LEFT")
    table.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#e7e9ec")),
        ("TEXTCOLOR", (0, 0), (-1, -1), colors.HexColor("#18202a")),
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("LINEBELOW", (0, 0), (-1, 0), 0.75, colors.HexColor("#697380")),
        ("LINEBELOW", (0, 1), (-1, -1), 0.25, colors.HexColor("#ccd1d8")),
        ("LEFTPADDING", (0, 0), (-1, -1), 5), ("RIGHTPADDING", (0, 0), (-1, -1), 5),
        ("TOPPADDING", (0, 0), (-1, -1), 6), ("BOTTOMPADDING", (0, 0), (-1, -1), 6)]))
    story.append(table)
    def footer(canvas, document):
        canvas.setFont("InventoryRegular", 7.5)
        canvas.setFillColor(colors.HexColor("#515a66"))
        canvas.drawString(36, 20, "RFP 27000010 · " + value["release_id"])
        canvas.drawRightString(756, 20, "Page " + str(document.page))
    document = SimpleDocTemplate(output, pagesize=landscape(letter), rightMargin=36, leftMargin=36,
                                topMargin=30, bottomMargin=36, title=value["title"] + " — file inventory",
                                author=value["reviewer"])
    document.build(story, onFirstPage=footer, onLaterPages=footer)
    os.chmod(output, 0o600)


def safe_name(value):
    if not isinstance(value, str) or not value or len(value) > 1000 or "\\" in value or "\x00" in value or ":" in value:
        raise ValueError("Invalid package path")
    name = PurePosixPath(value)
    if name.is_absolute() or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("Package path must be relative")
    return value


def create_package(descriptor, output):
    value = json.loads(Path(descriptor).read_text(encoding="utf-8"))
    files = value["files"]
    names = [safe_name(item["path"]) for item in files]
    if len(set(names)) != len(names) or "manifest.json" in names:
        raise ValueError("Duplicate package path")
    manifest = {"schema": "midland.delivery-package.v1", "kind": value["kind"],
                "created_at": value["created_at"],
                "files": [{k: v for k, v in item.items() if k != "input_path"} for item in files]}
    output = Path(output)
    if output.exists():
        raise ValueError("Destination already exists")
    temporary = output.with_name(output.name + "." + str(uuid.uuid4()) + ".part")
    try:
        with zipfile.ZipFile(temporary, "x", allowZip64=True) as archive:
            archive.writestr("manifest.json", json.dumps(manifest, indent=2, ensure_ascii=False) + "\n",
                             compress_type=zipfile.ZIP_DEFLATED)
            for item in files:
                source = Path(item["input_path"])
                if source.is_symlink() or not source.is_file():
                    raise ValueError("Package source must be a regular file")
                info = zipfile.ZipInfo(item["path"])
                info.external_attr = (stat.S_IFREG | 0o600) << 16
                info.compress_type = zipfile.ZIP_DEFLATED if item["size"] < 16 * 1024 * 1024 else zipfile.ZIP_STORED
                digest = hashlib.sha256()
                size = 0
                with source.open("rb") as incoming, archive.open(info, "w", force_zip64=True) as outgoing:
                    for block in iter(lambda: incoming.read(1024 * 1024), b""):
                        outgoing.write(block)
                        digest.update(block)
                        size += len(block)
                if digest.hexdigest() != item["sha256"] or size != item["size"]:
                    raise ValueError("Package source changed while being copied: " + item["path"])
        os.chmod(temporary, 0o600)
        with temporary.open("rb") as retained:
            os.fsync(retained.fileno())
        os.link(temporary, output)
        temporary.unlink()
    except BaseException:
        temporary.unlink(missing_ok=True)
        raise
    print(json.dumps({"path": str(output), "sha256": file_digest(output)[0], "files": len(files)}))


def extract_package(source, output, max_bytes):
    output = Path(output)
    output.mkdir(mode=0o700, parents=False, exist_ok=False)
    try:
        with zipfile.ZipFile(source) as archive:
            entries = archive.infolist()
            names = [safe_name(item.filename) for item in entries]
            if len(names) > 100000 or len(set(names)) != len(names):
                raise ValueError("Too many or duplicate package entries")
            by_name = {item.filename: item for item in entries}
            if "manifest.json" not in by_name or by_name["manifest.json"].file_size > 32 * 1024 * 1024:
                raise ValueError("Package manifest is missing or too large")
            manifest = json.loads(archive.read("manifest.json"))
            if manifest.get("schema") != "midland.delivery-package.v1" or manifest.get("kind") != "WORKSPACE":
                raise ValueError("Choose a reopenable Midland workspace package")
            files = manifest["files"]
            if not isinstance(files, list) or len(files) > 99999:
                raise ValueError("Invalid package manifest")
            expected = {safe_name(item["path"]): item for item in files}
            if len(expected) != len(files) or set(expected) | {"manifest.json"} != set(by_name):
                raise ValueError("Package entries differ from their manifest")
            total = 0
            for name, item in expected.items():
                entry = by_name[name]
                mode = entry.external_attr >> 16
                if entry.is_dir() or stat.S_ISLNK(mode) or (stat.S_IFMT(mode) not in (0, stat.S_IFREG)):
                    raise ValueError("Package contains a nonregular file")
                if not isinstance(item.get("size"), int) or item["size"] < 0 or entry.file_size != item["size"]:
                    raise ValueError("Package length mismatch")
                total += entry.file_size
                if total > max_bytes:
                    raise ValueError("Package exceeds configured expanded byte limit")
                destination = output.joinpath(*PurePosixPath(name).parts)
                destination.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
                digest = hashlib.sha256()
                size = 0
                with archive.open(entry) as incoming, destination.open("xb") as outgoing:
                    for block in iter(lambda: incoming.read(1024 * 1024), b""):
                        size += len(block)
                        if size > item["size"]:
                            raise ValueError("Expanded source exceeds its inventory length")
                        digest.update(block)
                        outgoing.write(block)
                os.chmod(destination, 0o600)
                if size != item["size"] or digest.hexdigest() != item.get("sha256"):
                    raise ValueError("Package source SHA-256 differs: " + name)
            (output / "manifest.json").write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
        print(json.dumps({"path": str(output), "files": len(expected), "bytes": total}))
    except BaseException:
        shutil.rmtree(output, ignore_errors=True)
        raise


def main():
    os.umask(0o077)
    parser = argparse.ArgumentParser()
    sub = parser.add_subparsers(dest="command", required=True)
    for command in ("pdf", "create"):
        item = sub.add_parser(command)
        item.add_argument("source")
        item.add_argument("output")
    item = sub.add_parser("extract")
    item.add_argument("source")
    item.add_argument("output")
    item.add_argument("--max-bytes", type=int, default=8 * 1024 * 1024 * 1024)
    args = parser.parse_args()
    if args.command == "pdf":
        inventory_pdf(args.source, args.output)
    elif args.command == "create":
        create_package(args.source, args.output)
    else:
        extract_package(args.source, args.output, args.max_bytes)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        sys.stderr.write(str(error) + "\n")
        sys.exit(1)
