#!/usr/bin/env python3
"""Retain the original report and render its exact Table 7 page and crop."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import shutil


def describe(path):
    raw = path.read_bytes()
    return {"filename": path.name, "bytes": len(raw), "sha256": hashlib.sha256(raw).hexdigest()}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", required=True, help="Downloaded original SC DES report")
    parser.add_argument("--study-directory", required=True)
    args = parser.parse_args()
    source = Path(args.pdf).resolve(strict=True)
    directory = Path(args.study_directory).resolve()
    directory.mkdir(parents=True, exist_ok=True)
    try:
        import fitz
    except ImportError as error:
        raise SystemExit("Use an equipped PDF runtime with PyMuPDF to render the publisher page.") from error
    with fitz.open(source) as document:
        if len(document) != 45 or "Eighteenmile" not in document[0].get_text():
            raise SystemExit("The input does not match the 45-page Eighteenmile 2023 report.")
        page = document[20]
        caption = page.search_for("Table 7.")
        last_row = page.search_for("SV-840")
        other_row = page.search_for("SV-374")
        if not caption or not last_row or not other_row:
            raise SystemExit("The original Table 7 caption and station rows were not found on viewer page 21.")
        top = min(box.y0 for box in caption) - 5
        bottom = max(box.y1 for box in last_row) + 10
        if bottom <= top:
            raise SystemExit("The source table crop bounds do not include the final station row.")
        clip = fitz.Rect(36, max(0, top), page.rect.width - 36, min(page.rect.height, bottom))
        page_path, crop_path = directory / "table7-page21.png", directory / "table7-crop.png"
        page.get_pixmap(matrix=fitz.Matrix(2, 2), alpha=False).save(page_path)
        page.get_pixmap(matrix=fitz.Matrix(3, 3), clip=clip, alpha=False).save(crop_path)
    retained = directory / "2023LakeProgramFinalReport.pdf"
    if retained != source:
        shutil.copyfile(source, retained)
    evidence = {
        "schema": "upstate.published-study-page-render/v1",
        "source_url": "https://des.sc.gov/sites/des/files/Documents/BOW/WaterQuality/2023LakeProgramFinalReport.pdf",
        "source": describe(retained),
        "table": 7, "printed_page": 14, "pdf_viewer_page": 21, "pdf_zero_index": 20,
        "page_image": describe(page_path), "table_crop": describe(crop_path),
        "crop_rectangle_pdf_points": list(clip),
    }
    (directory / "table7-page-render.json").write_text(json.dumps(evidence, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(evidence, indent=2))


if __name__ == "__main__":
    main()
