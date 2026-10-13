#!/usr/bin/env python3
"""Populate retained profile evidence from its exact supplied table and cited CSV cells."""
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
from pathlib import Path
import sys


def _inside(path, parent):
    return path == parent or parent in path.parents


def populate(workspace, profile_id, output, *, evidence_csv=None, resume=False):
    from model import biophysical_evidence as evidence
    from model.common import atomic_json, file_digest, held, read_json

    original = workspace._get("profiles", profile_id)
    source_path, source_entry = workspace.source_file(
        original["source_collection_id"], original["biophysical_source_id"])
    original_sha = file_digest(source_path)
    original_size = source_path.stat().st_size
    if (original_sha != source_entry["body"]["sha256"]
            or original_size != source_entry["body"]["bytes"]):
        raise ValueError("The retained original coefficient table changed")
    template = evidence.template(workspace, original["id"])
    if template["table_sha256"] != original_sha:
        raise ValueError("The template selects a different source table")

    supplied = Path(evidence_csv).resolve(strict=True) if evidence_csv else None
    supplied_sha = file_digest(supplied) if supplied else None
    selection = {
        "schema": "upstate.supplied-profile-evidence-selection/v1",
        "workspace_id": workspace.project["id"], "profile_id": original["id"],
        "original_table_sha256": original_sha, "original_table_bytes": original_size,
        "supplied_evidence_sha256": supplied_sha,
    }
    output = Path(output).resolve()
    if _inside(output, workspace.root.resolve()):
        raise ValueError("Keep the receiving output outside the original Workspace")
    if output.exists() and not resume:
        raise ValueError("Use a new output directory or resume its exact saved selection")
    if not output.exists() and resume:
        raise ValueError("Resume an existing receiving output")
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".receiving.lock", blocking=False):
        selected = output / "selection.json"
        if selected.exists() and read_json(selected) != selection:
            raise ValueError("Resume the original profile, table and supplied evidence selection")
        if resume and not selected.exists():
            unexpected = [path.name for path in output.iterdir()
                          if path.name != ".receiving.lock"]
            if unexpected:
                raise ValueError("The receiving output has no original selection and contains "
                                 "unrelated or incomplete files: " + ", ".join(sorted(unexpected)))
        atomic_json(selected, selection, immutable=True)

        rows = template["rows"]
        index = {(int(row["lucode"]), row["parameter"]): row for row in rows}
        row_numbers = {}
        with source_path.open(encoding="utf-8-sig", newline="") as stream:
            for number, row in enumerate(csv.DictReader(stream), 2):
                row_numbers[int(row["lucode"])] = number
        for row in rows:
            row.update(
                source_title="Supplied profile table: " + source_entry["title"],
                source_uri=source_entry["uri"],
                source_locator="CSV row " + str(row_numbers[int(row["lucode"])])
                + "; lucode=" + str(row["lucode"]) + "; column=" + row["parameter"],
                source_period=source_entry["vintage"],
                notes="Exact supplied-table provenance, SHA256 " + original_sha
                + ". This documents the selected coefficient and its original load type; "
                "it does not establish empirical calibration or an uncertainty range. "
                "Profile references remain attached to the original profile.",
            )

        supplied_keys = set()
        seen_keys = set()
        if supplied:
            for line, incoming in evidence._source_rows(supplied):
                try:
                    key = (int(incoming["lucode"]), incoming["parameter"])
                except ValueError as exc:
                    raise ValueError("Supplied evidence line " + str(line)
                                     + " requires an integer lucode") from exc
                if key in seen_keys:
                    raise ValueError("Repeated supplied evidence cell: " + str(key))
                seen_keys.add(key)
                if key not in index:
                    raise ValueError("Supplied evidence cell is outside the selected profile: "
                                     + str(key))
                target = index[key]
                incoming_value = evidence.sourced._value("table." + key[1], incoming["value"])
                original_value = evidence.sourced._value("table." + key[1], target["value"])
                if incoming_value != original_value:
                    raise ValueError("Supplied evidence changes the original value: " + str(key))
                if any(incoming[field] != target[field] for field in ("units", "load_type")):
                    raise ValueError("Supplied evidence changes original units or load type: " + str(key))
                cited = bool(incoming["source_title"] or incoming["source_uri"])
                if cited and not (incoming["source_title"] and incoming["source_uri"]):
                    raise ValueError("Supplied replacement cells need both title and source URI")
                if not cited:
                    detail_fields = ("source_locator", "source_period", "notes",
                                     "lower", "upper", "range_basis")
                    if any(incoming[field] for field in detail_fields):
                        raise ValueError("Unattributed supplied cells cannot contain source details "
                                         "or ranges: " + str(key))
                    # Fully unentered evidence retains the already populated exact
                    # supplied-table citation; numerical identity was checked above.
                    continue
                # The existing parser validates supplied ranges and source details.
                target.update(incoming)
                supplied_keys.add(key)

        buffer = io.StringIO(newline="")
        writer = csv.DictWriter(buffer, fieldnames=evidence.CSV_FIELDS, lineterminator="\n")
        writer.writeheader()
        writer.writerows(rows)
        body = buffer.getvalue().encode("utf-8")
        csv_path = output / "biophysical-evidence.csv"
        if csv_path.exists():
            if csv_path.read_bytes() != body:
                raise ValueError("The existing evidence CSV differs from its original selection")
        else:
            with csv_path.open("xb") as stream:
                stream.write(body)
        csv_sha = hashlib.sha256(body).hexdigest()
        if supplied and file_digest(supplied) != supplied_sha:
            raise ValueError("Supplied evidence changed during the operation")
        source_id = "profile-coefficient-evidence"
        manifest = {
            "schema": "upstate.sources/v1",
            "title": "Coefficient source provenance for " + original["title"],
            "notes": [
                "The original coefficient table and profile remain unchanged.",
                "Every cell has exact supplied-table provenance unless explicitly replaced "
                "by a supplied, value-matching citation.",
                "Uncertainty endpoints exist only where explicitly present in supplied evidence.",
            ],
            "entries": [{
                "id": source_id, "kind": "table", "path": csv_path.name,
                "sha256": csv_sha,
                "title": "Coefficient evidence for " + original["title"],
                "uri": "urn:upstate:profile-coefficient-evidence:" + csv_sha,
                "vintage": "Derived from original profile " + original["id"]
                           + "; supplied table vintage: " + source_entry["vintage"],
            }],
        }
        atomic_json(output / "source-manifest.json", manifest, immutable=True)
        collection = workspace.import_sources(output / "source-manifest.json")
        request = {"profile_id": original["id"],
                   "source_collection_id": collection["id"], "source_id": source_id}
        proposed = evidence.preview_evidence(workspace, request)
        saved = evidence.save_evidence(workspace, request)
        if proposed != saved or evidence.inspect_evidence(workspace, saved["id"]) != saved:
            raise RuntimeError("Saved evidence differs from the original sources")
        if (workspace._get("profiles", original["id"]) != original
                or file_digest(source_path) != original_sha
                or source_path.stat().st_size != original_size):
            raise RuntimeError("The original profile or coefficient table changed")
        if saved["coverage"]["documented"] != saved["coverage"]["total"]:
            raise RuntimeError("The complete source-provenance population omitted a selected cell")
        result = {
            "schema": "upstate.supplied-profile-evidence-result/v1",
            "state": "complete", "selection": selection, "evidence_selection": request,
            "evidence_id": saved["id"], "workspace": str(workspace.root),
            "profile_id": original["id"], "profile_title": original["title"],
            "evidence_csv_sha256": csv_sha, "evidence_csv_bytes": len(body),
            "coverage": saved["coverage"],
            "attribution": {
                "supplied_table_cells": len(rows) - len(supplied_keys),
                "explicitly_cited_cells": len(supplied_keys),
                "meaning": "Citation coverage describes original coefficient provenance; "
                           "it does not count calibrated cells or establish uncertainty.",
            },
            "files": {"csv": str(csv_path), "manifest": str(output / "source-manifest.json")},
        }
        atomic_json(output / "evidence-selection.json", request, immutable=True)
        atomic_json(output / "operation-result.json", result, immutable=True)
        return result


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--application", type=Path)
    parser.add_argument("--workspace", type=Path, required=True)
    parser.add_argument("--profile", required=True, help="Actual saved profile ID")
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--evidence-csv", type=Path,
                        help="Optional cited cells matching the original profile exactly")
    parser.add_argument("--resume", action="store_true")
    args = parser.parse_args(argv)
    application = (args.application.resolve(strict=True) if args.application
                   else Path(__file__).resolve().parents[1])
    if _inside(args.output.resolve(), application):
        raise ValueError("Keep receiving outputs outside application source")
    sys.path.insert(0, str(application))
    from model.workspace import Workspace
    result = populate(Workspace(args.workspace), args.profile, args.output,
                      evidence_csv=args.evidence_csv, resume=args.resume)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
