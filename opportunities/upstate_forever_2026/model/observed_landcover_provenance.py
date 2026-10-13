"""Readable original-input custody for retained selected-HUC land-cover reports.

This module describes the source binding already checked by the maintained
producer. It never imports a source, changes a selection or computes quantities.
"""
from __future__ import annotations

from copy import deepcopy
from pathlib import Path, PurePosixPath

from .common import atomic_bytes, atomic_json, describe_file, file_digest

SCHEMA = "upstate.observed-landcover-source-provenance/v1"
ADMISSION_SCHEMA = "upstate.received-landcover-copy/v1"
EDITION = "original-landcover-source-custody/1"
DATA = "source-provenance.json"
IMPLEMENTATION = "source-provenance-implementation.py"
MARKER = "received_landcover_copy"


def _require(condition, message):
    if not condition:
        raise ValueError(message)


def implementation():
    return {"edition": EDITION, "sha256": file_digest(__file__)}


def _relative(value):
    _require(isinstance(value, str) and value and "\\" not in value and "\0" not in value,
             "Retained original source files need portable relative names")
    path = PurePosixPath(value)
    _require(path.parts and not path.is_absolute() and ".." not in path.parts
             and path.as_posix() == value and all(":" not in part for part in path.parts),
             "Retained original source member escapes its directory")
    return value


def _ancestry(entry):
    value = (entry.get("metadata") or {}).get(MARKER)
    result = []
    seen = set()
    while value is not None:
        _require(isinstance(value, dict) and value.get("schema") == ADMISSION_SCHEMA,
                 "Retained input has an unsupported admission history")
        for name in ("copy_id", "project_id", "source_project_id", "original_source_body_sha256",
                     "original_selection_id", "original_input_collection_id",
                     "original_input_source_id", "original_input_entry_sha256"):
            _require(isinstance(value.get(name), str) and value[name],
                     "Retained input admission is missing " + name)
        original_source = value.get("original_source")
        _require(isinstance(original_source, dict)
                 and all(isinstance(original_source.get(name), str) and original_source[name]
                         for name in ("source_collection_id", "source_id")),
                 "Retained input admission lost its original report source")
        identity = (value["project_id"], value["copy_id"], value["original_input_source_id"])
        _require(identity not in seen, "Retained input admission history repeats an edition")
        seen.add(identity)
        # Preserve every original field, while representing the linked history
        # as ordered rows for inspection. The full nested marker remains in
        # the retained source entry as well.
        result.append(deepcopy({key: item for key, item in value.items() if key != "previous"}))
        value = value.get("previous")
    return result


def describe(report, current_project_id, *, comparison_id=None):
    _require(isinstance(current_project_id, str) and current_project_id,
             "Source history needs the actual current project identifier")
    _require(comparison_id is None or isinstance(comparison_id, str) and comparison_id,
             "Source history needs the actual saved comparison identifier")
    binding = report["binding"]
    originals = binding["inputs"]
    _require(isinstance(originals, list) and len(originals) == 4,
             "The original analysis, two annual inventories and transition inventory must all be retained")
    before, after = binding["rasters"]["before"]["year"], binding["rasters"]["after"]["year"]
    roles = ("Original analysis and input identities", "Earlier annual inventory (" + str(before) + ")",
             "Later annual inventory (" + str(after) + ")", "Paired directional transitions")
    seen = set()
    inputs = []
    for index, (original, role) in enumerate(zip(originals, roles)):
        _require(isinstance(original, dict) and isinstance(original.get("entry"), dict),
                 "The original source entry must be retained in full")
        entry = original["entry"]
        identity = (original["source_collection_id"], original["source_id"])
        _require(identity not in seen and entry.get("id") == original["source_id"],
                 "The original four input sources must retain distinct matching identities")
        seen.add(identity)
        members = []
        for position, body in enumerate([entry["body"], *entry.get("companions", [])]):
            name = _relative(body.get("view_path", body["filename"]))
            members.append({"role": "body" if position == 0 else "companion",
                            "path": "originals/" + str(index) + "/" + name,
                            "descriptor": deepcopy(body)})
        _require(len({row["path"] for row in members}) == len(members),
                 "Original input companion names collide")
        inputs.append({"role": role, "source_collection_id": original["source_collection_id"],
                       "source_id": original["source_id"], "entry": deepcopy(entry),
                       "members": members, "admission_history": _ancestry(entry)})
    imported = sum(bool(row["admission_history"]) for row in inputs)
    current_admissions = [
        row["admission_history"][0] for row in inputs
        if row["admission_history"] and row["admission_history"][0]["project_id"] == current_project_id
    ]
    relationship = ("local_copy_of_received_inputs" if len(current_admissions) == len(inputs) else
                    "retained_input_history" if imported else "original_retained_inputs")
    return {
        "schema": SCHEMA, "edition": EDITION, "current_project_id": current_project_id,
        "current_comparison_id": comparison_id, "title": report["title"],
        "relationship": relationship, "selection": deepcopy(report["selection"]),
        "original_analysis": {
            "source_collection_id": binding["source_collection_id"],
            "source_id": binding["analysis_source_id"], "sha256": binding["analysis_sha256"]},
        "rasters": deepcopy(binding["rasters"]),
        "source_domain_sha256": binding["source_domain_sha256"],
        "grid": deepcopy(binding["grid"]), "coordinate_operation": deepcopy(binding["coordinate_operation"]),
        "method": deepcopy(binding["method"]),
        "original_huc_count": binding["original_huc_count"],
        "original_overlap_cells": binding["original_overlap_cells"],
        "inputs": inputs,
        "custody": {
            "input_bytes": "Original body and companion bytes are retained; copying does not regenerate the annual analysis.",
            "local_editing": "The current comparison uses its own project and saved comparison identity. Changing the title or watershed selection creates a new comparison.",
            "foreign_report": "An explicit local admission preserves its received original report and source. The local comparison does not replace the original report.",
            "interpretation": "Source history describes custody and selection. It does not establish raster calibration, causal attribution, stream load or intake exposure.",
        },
    }


def _text(value):
    return "Not recorded" if value is None or value == "" else str(value)


def _short(value):
    value = _text(value)
    # This is a labeled display identifier, never an input to source matching.
    return value if len(value) <= 48 else value[:20] + "…" + value[-12:] + " (abbreviated)"


def sections(provenance):
    if provenance is None:
        return []
    _require(provenance.get("schema") == SCHEMA, "Choose the retained original source-history edition")
    inputs = provenance["inputs"]
    blocks = [
        "Current project: " + _text(provenance["current_project_id"]) + ".",
        "Saved comparison: " + _short(provenance.get("current_comparison_id")) + ".",
        "Selected watersheds: " + str(len(provenance["selection"]["huc12s"])) +
        "; exact identifiers are retained in the comparison tables and JSON.",
        "Original Annual NLCD product years: " + str(provenance["rasters"]["before"]["year"]) +
        " to " + str(provenance["rasters"]["after"]["year"]) + ".",
    ]
    if provenance["relationship"] == "local_copy_of_received_inputs":
        blocks.append("This is a local editable comparison of explicitly admitted, received original inputs. "
                      "The received report and its original source remain preserved. You can revise the local "
                      "watershed selection and save another comparison without replacing that original report.")
    elif provenance["relationship"] == "retained_input_history":
        blocks.append("These inputs retain earlier admission history. The project identifiers below distinguish "
                      "those earlier copies from the current project; an earlier copy is not relabeled as a current admission.")
    else:
        blocks.append("This comparison uses the original retained analysis and its three complete result documents. "
                      "No explicit received-to-local admission is recorded in these input entries.")
    blocks.extend([
        provenance["custody"]["input_bytes"],
        "The original analysis covers " + str(provenance["original_huc_count"]) +
        " watersheds. This report selects " + str(len(provenance["selection"]["huc12s"])) +
        "; the complete original inputs remain attached so another selection can be prepared.",
        {"kind": "table", "columns": ["Original input", "Original source title", "Source edition"],
         "widths": [1.6, 2.8, 1.6],
         "rows": [[row["role"], _text(row["entry"].get("title")),
                   _text(row["entry"].get("vintage"))] for row in inputs]},
    ])
    for row in inputs:
        entry = row["entry"]
        blocks.append(row["role"] + ": source " + _short(row["source_id"]) +
                      "; collection " + _short(row["source_collection_id"]) + ".")
        if entry.get("uri"):
            blocks.append("Original retained source URI: " + str(entry["uri"]) + ".")
        blocks.append("Retained files: " + str(len(row["members"])) +
                      " (original body plus " + str(len(row["members"]) - 1) + " companions).")
    # Present common admission steps once, with all participating input roles.
    # Per-input entry digests and full nested history remain in the JSON.
    steps = {}
    for row in inputs:
        for admission in row["admission_history"]:
            key = (admission["project_id"], admission["copy_id"])
            if key not in steps:
                steps[key] = {"admission": admission, "roles": []}
            item = steps[key]
            for field in ("source_project_id", "original_selection_id", "original_source",
                          "original_source_body_sha256"):
                _require(item["admission"][field] == admission[field],
                         "Shared admission history disagrees about its original report")
            item["roles"].append(row["role"])
    for ordinal, item in enumerate(steps.values(), 1):
        admission = item["admission"]
        blocks.extend([
            "Retained admission " + str(ordinal) + ": " + _short(admission["copy_id"]) +
            ". Receiving project: " + admission["project_id"] +
            ". Original report project: " + admission["source_project_id"] + ".",
            "Original saved comparison: " + _short(admission["original_selection_id"]) +
            ". Original report source: " + _short(admission["original_source"]["source_id"]) +
            "; collection " + _short(admission["original_source"]["source_collection_id"]) + ".",
            "Inputs in this admission: " + "; ".join(item["roles"]) + ".",
        ])
    if steps:
        blocks.append("Shared admission steps are grouped here. Each input's full ordered history runs from its most recent "
                      "retained admission toward earlier copies in the source-history JSON.")
    blocks.extend([
        provenance["custody"]["interpretation"],
        "Full identifiers, exact hashes, publisher metadata, original body and companion descriptors, "
        "and every retained admission step are available in the linked JSON. Display abbreviations do not change source identity.",
        {"kind": "links", "items": [
            {"title": "Complete source custody and admission history", "path": DATA},
            {"title": "Original analysis and all four input bindings", "path": "original-inputs.json"},
            {"title": "Saved comparison and exact scientific quantities", "path": "selection.json"},
        ]},
    ])
    return [["Original inputs and editable comparison history", blocks]]


def retain(directory, report, expected_implementation):
    _require(implementation() == expected_implementation,
             "The source-history implementation changed during report preparation")
    provenance = report.get("source_provenance")
    _require(provenance is not None and provenance.get("schema") == SCHEMA,
             "The new saved comparison needs its original source-history binding")
    # Validate readable ancestry before publishing its immutable representation.
    sections(provenance)
    atomic_json(directory / DATA, provenance, immutable=True)
    atomic_bytes(directory / IMPLEMENTATION, Path(__file__).read_bytes(), immutable=True)
    return {name: describe_file(directory, directory / name) for name in (DATA, IMPLEMENTATION)}
