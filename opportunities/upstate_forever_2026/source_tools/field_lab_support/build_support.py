#!/usr/bin/env python3
"""Build an immutable analytical companion to an existing laboratory delivery."""
from __future__ import annotations

import argparse
import csv
import io
import json
from pathlib import Path
import shutil
import sys
import tempfile

if __package__ in (None, ""):
    sys.path.insert(0, str(Path(__file__).resolve().parent))
    from support import SCHEMA, EDITION, SOURCE_PATHS, CSV_COLUMNS, SourceError, build, canonical, description, export_csv, sha
else:
    from .support import SCHEMA, EDITION, SOURCE_PATHS, CSV_COLUMNS, SourceError, build, canonical, description, export_csv, sha

SOURCE = Path(__file__).resolve().parent


def write_json(path: Path, value: dict | list) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2, allow_nan=False) + "\n", encoding="utf-8")


def groups_csv(groups: list[dict]) -> bytes:
    fields = ("station_id", "parameter", "display_unit", "fraction", "basis", "method_id", "method_authority", "method_name",
              "activity_type", "project", "count", "numeric_count", "censored_count", "unresolved_count", "first_date", "last_date",
              "sum_lower", "sum_upper", "mean_lower", "mean_upper", "mean_lower_inclusive", "mean_upper_inclusive", "reporting_limits", "observation_ids")
    buffer = io.StringIO(newline="")
    writer = csv.writer(buffer, lineterminator="\r\n")
    writer.writerow(fields)
    for group in groups:
        writer.writerow(json.dumps(group[key], ensure_ascii=False) if isinstance(group[key], list) else group[key] for key in fields)
    return buffer.getvalue().encode("utf-8")


def produce(delivery: Path, output: Path) -> dict:
    delivery = delivery.resolve(strict=True)
    output = output.absolute()
    if output.exists() or output.is_relative_to(delivery):
        raise SourceError("Choose a new output directory outside the original delivery")
    data, originals = build(delivery)
    template = (SOURCE / "view.html").read_text(encoding="utf-8")
    if template.count("__DATA__") != 1 or template.count("__CSV_COLUMNS__") != 1:
        raise SourceError("The analytical view template is incomplete")
    rendered = template.replace("__DATA__", canonical(data).decode("utf-8").replace("<", "\\u003c"))
    rendered = rendered.replace("__CSV_COLUMNS__", json.dumps(CSV_COLUMNS))
    output.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=".field-lab-support-", dir=output.parent) as temporary:
        stage = Path(temporary) / "edition"
        stage.mkdir()
        (stage / "START_HERE.html").write_text(rendered, encoding="utf-8")
        write_json(stage / "analytical-support.json", data)
        (stage / "analytical-results.csv").write_bytes(export_csv(data["records"]))
        (stage / "analytical-method-groups.csv").write_bytes(groups_csv(data["groups"]))
        write_json(stage / "collection-events.json", data["events"])
        original_delivery = stage / "original-delivery"
        original_delivery.mkdir()
        shutil.copyfile(delivery / "delivery.json", original_delivery / "delivery.json")
        for label, name in SOURCE_PATHS.items():
            path = original_delivery / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(originals[label])
        (stage / "source").mkdir()
        for filename in ("support.py", "view.html", "build_support.py", "README.md"):
            shutil.copyfile(SOURCE / filename, stage / "source" / filename)
        shutil.copyfile(SOURCE / "README.md", stage / "README.md")
        companions = [{"path": p.relative_to(stage).as_posix(), **description(p.read_bytes())}
                      for p in sorted(stage.rglob("*")) if p.is_file() and p.name != "START_HERE.html"]
        suffix = data["dataset_id"][:16]
        entries = []
        for filename, title, kind, role in (
            ("START_HERE.html", "Eighteenmile field laboratory: source-linked analytical support", "document", "observed_water_quality_report"),
            ("analytical-results.csv", "Eighteenmile original results and explicitly typed reporting limits", "table", "FIELD_LAB_ANALYTICAL_SUPPORT"),
        ):
            path = stage / filename
            entries.append({"id": "eighteenmile-lab-support-" + ("report-" if kind == "document" else "rows-") + suffix,
                            "title": title, "kind": kind, "role": role, "path": filename,
                            **description(path.read_bytes()), "uri": "https://www.waterqualitydata.us/",
                            "vintage": "2023 original observations; analytical support edition " + EDITION,
                            "companions": [row for row in companions if row["path"] != filename]})
        write_json(stage / "sources.json", {"schema": "upstate.sources/v1", "title": data["title"], "captured_at": "2026-10-13",
                    "scope": {"study_id": "scdes-eighteenmile-lake-2023", "dataset_id": data["dataset_id"], "binding": data["binding"]},
                    "entries": entries})
        result = {"schema": SCHEMA, "edition": EDITION, "dataset_id": data["dataset_id"], "binding": data["binding"],
                  "counts": data["counts"], "method_groups": len(data["groups"]), "entry": "START_HERE.html",
                  "source_manifest": "sources.json", "files": {p.relative_to(stage).as_posix(): description(p.read_bytes())
                      for p in sorted(stage.rglob("*")) if p.is_file()}}
        result["id"] = sha(canonical(result))
        write_json(stage / "package.json", result)
        stage.rename(output)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delivery", type=Path, required=True, help="The original completed field-source delivery")
    parser.add_argument("--output", type=Path, required=True, help="A new analytical companion directory")
    args = parser.parse_args()
    try:
        result = produce(args.delivery, args.output)
    except (SourceError, OSError, ValueError, KeyError, csv.Error) as error:
        print("Laboratory analytical support: " + str(error), file=sys.stderr)
        return 2
    print(json.dumps({"output": str(args.output.resolve()), "id": result["id"], "dataset_id": result["dataset_id"],
                      "counts": result["counts"], "method_groups": result["method_groups"]}, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
