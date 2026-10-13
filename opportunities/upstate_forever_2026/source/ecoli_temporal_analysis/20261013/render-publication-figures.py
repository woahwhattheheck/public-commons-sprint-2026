#!/usr/bin/env python3
"""Render retained scientific numeric panels with the application's ReportLab renderer."""
from __future__ import annotations
import argparse
import hashlib
import json
from pathlib import Path
import sys

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--spec", type=Path, default=Path(__file__).with_name("publication-figures.json"))
    parser.add_argument("--output", type=Path, default=Path(__file__).with_name("figures"))
    args = parser.parse_args()
    application = Path(__file__).resolve().parents[3]
    sys.path.insert(0, str(application))
    from model.scientific_figures import panel_drawings
    from reportlab.graphics.shapes import Drawing, Group
    from reportlab.graphics import renderSVG, renderPDF
    spec_bytes = args.spec.read_bytes()
    spec = json.loads(spec_bytes)
    if spec.get("schema") != "upstate.scientific-figure-spec/v1":
        raise ValueError("Wrong retained scientific figure schema")
    args.output.mkdir(parents=True, exist_ok=True)
    files = []
    texts = {}
    for figure in spec["figures"]:
        figure_id = figure["id"]
        if not figure_id.replace("-", "").isalnum():
            raise ValueError("Unsafe figure identifier")
        drawings = panel_drawings(figure, 540)
        height = sum(d.height for d in drawings) + 12 * (len(drawings) - 1)
        combined = Drawing(540, height)
        y = height
        for drawing in drawings:
            y -= drawing.height
            group = Group()
            for item in drawing.contents:
                group.add(item)
            group.translate(0, y)
            combined.add(group)
            y -= 12
        for extension, render in (("svg", renderSVG), ("pdf", renderPDF)):
            path = args.output / (figure_id + "." + extension)
            render.drawToFile(combined, str(path))
            content = path.read_bytes()
            files.append({"path": path.name, "bytes": len(content),
                          "sha256": hashlib.sha256(content).hexdigest(),
                          "figure_id": figure_id, "panels": len(drawings)})
            if extension == "svg":
                texts[path.name] = content.decode("utf-8")
    summary = {"schema": "commons.scientific-figure-render/v1",
               "spec_sha256": hashlib.sha256(spec_bytes).hexdigest(),
               "renderer": "model.scientific_figures / ReportLab",
               "files": files}
    (args.output / "rendered-manifest.json").write_text(
        json.dumps(summary, indent=2) + "\n", encoding="utf-8")
    (args.output / "rendered-svg-bank.json").write_text(
        json.dumps({"summary": summary, "files": texts}, ensure_ascii=False) + "\n",
        encoding="utf-8")
    print(json.dumps(summary, indent=2))

if __name__ == "__main__":
    main()
