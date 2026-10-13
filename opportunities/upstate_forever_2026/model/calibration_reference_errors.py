"""Typed published F7 errors for the retained P9 annual-reference evaluation.

The original observation edition and fit never change. The external binding
retains the actual imported F7 table, complete original source companions and
the exact seven-record edition bridge. It is a source-sensitivity relationship,
not an independent validation sample.
"""
from __future__ import annotations

from decimal import Decimal
import json
from pathlib import Path, PurePosixPath

from .common import digest, identifier, verify_file

SCHEMA = "upstate.calibration-external-reference-errors/v1"
P9_CSV_SHA256 = "b3571dc6363813a68032aeaa44ce3a6a41cf9befd8f07f544e5a9f3235031b43"
PRESET = Path(__file__).resolve().parents[1] / "source/usgs-southeast-sparrow-2012/candidate-course.json"
RELATIONSHIP = (
    "Related P9 mapper and F7 annual-load reference editions, matched by original "
    "station, constituent, reach and flow period. This is not independent "
    "validation. Native predictions, P9 objective scales, group membership and "
    "the original selected profile remain fixed."
)
INTERPRETATION = (
    "The sensitivity box is centered on each exact F7 annual estimate after "
    "explicit mass-unit conversion; its radius is the selected multiple of that "
    "estimate's published standard error, clipped at zero. A zero multiplier "
    "is the F7 point, not the P9 mapper point. The separately reproduced original "
    "objective uses the unchanged P9 values. The retained decimal center offsets "
    "describe mapper precision and are never silently removed. Published standard "
    "errors are not confidence intervals, probabilities or estimates of model error. "
    "Six selected Beale estimates are long-term means and the Stevens Creek "
    "phosphorus Fluxmaster estimate is detrended. The common flow window is "
    "1999-10-01 through 2014-10-01 exclusive; each original water-quality window "
    "and estimator remains separately retained."
)


def _same(actual, expected, label):
    if digest(actual) != digest(expected):
        raise ValueError(label + " differs from the retained reference source")


def _decimal(value, label):
    try:
        result = Decimal(str(value))
    except Exception as error:
        raise ValueError(label + " must be a finite decimal") from error
    if not result.is_finite():
        raise ValueError(label + " must be a finite decimal")
    return result


def _body(workspace, descriptor):
    return verify_file(workspace.root, {
        "path": descriptor.get("object", descriptor.get("path")),
        "bytes": descriptor["bytes"], "sha256": descriptor["sha256"],
    })


def _entry(workspace, observed, collection_id=None, source_id=None):
    collections = ([workspace._get("sources", identifier(collection_id))]
                   if collection_id else workspace._list("sources"))
    found = []
    for collection in collections:
        for entry in collection.get("entries", []):
            if (source_id and entry.get("id") != source_id):
                continue
            if (entry.get("role") == "OBSERVED_LOADS"
                    and entry.get("body", {}).get("sha256") == observed["original"]["sha256"]
                    and entry["body"].get("bytes") == observed["original"]["bytes"]):
                found.append((collection, entry))
    if not found:
        raise ValueError("The F7 observation needs its complete imported OBSERVED_LOADS source collection")
    # Reimporting the same original manifest is content-addressed. Different
    # collections with different source metadata must not be selected by guess.
    fingerprints = {digest(entry) for unused, entry in found}
    if len(fingerprints) != 1:
        raise ValueError("The F7 table has ambiguous source entries; retain one explicit source collection")
    collection, entry = sorted(found, key=lambda item: (item[0]["id"], item[1]["id"]))[0]
    _body(workspace, collection["original_manifest"])
    for descriptor in [entry["body"], *entry.get("companions", [])]:
        _body(workspace, descriptor)
    return collection, entry


def _members(collection, entry, observed):
    members = [
        {"path": "sources/" + collection["id"] + ".json", "label": "F7 source collection"},
        {"path": "observations/" + observed["id"] + ".json", "label": "F7 observation edition"},
    ]
    for descriptor, label in [(collection["original_manifest"], "Original F7 intake manifest"),
                              (observed["original"], "Original F7 observation CSV"),
                              (entry["body"], "Original F7 source table")]:
        members.append({"path": descriptor["object"], "bytes": descriptor["bytes"],
                        "sha256": descriptor["sha256"],
                        "filename": descriptor.get("filename") or Path(descriptor["object"]).name,
                        "view_path": descriptor.get("view_path") or descriptor.get("filename") or Path(descriptor["object"]).name,
                        "label": label})
    for descriptor in entry.get("companions", []):
        members.append({"path": descriptor["object"], "bytes": descriptor["bytes"],
                        "sha256": descriptor["sha256"],
                        "filename": descriptor.get("filename") or Path(descriptor["object"]).name,
                        "view_path": descriptor.get("view_path") or descriptor.get("filename") or Path(descriptor["object"]).name,
                        "label": "Original F7 source companion"})
    return members


def _rows(observed, expected_ids, label):
    rows = observed.get("rows", [])
    if len(rows) != len(expected_ids) or {row["id"] for row in rows} != set(expected_ids):
        raise ValueError(label + " must retain exactly the seven original reference records")
    if len({row["id"] for row in rows}) != len(rows) or not all(row.get("admitted") for row in rows):
        raise ValueError(label + " has duplicate or unadmitted reference records")
    return {row["id"]: row for row in rows}


def resolve(workspace, report, plan, original, reference_observation_id, *,
            source_collection_id=None, source_id=None):
    """Build a typed binding from actual native observation and source records."""
    from source_tools.annual_reference_bridge import build, ORIGINAL_TARGET_SHA256, F7_SOURCE
    if original["original"]["sha256"] != P9_CSV_SHA256:
        raise ValueError("This related-edition source binding requires the original P9 seven-target CSV")
    observed = workspace._get("observations", identifier(reference_observation_id))
    _body(workspace, observed["original"])
    collection, entry = _entry(workspace, observed, source_collection_id, source_id)
    targets = [item for item in entry.get("companions", [])
               if item.get("sha256") == ORIGINAL_TARGET_SHA256]
    if not targets:
        raise ValueError("The F7 source must retain the complete original eleven-record source companion")
    target = sorted(targets, key=lambda item: item.get("view_path", item["filename"]))[0]
    bridge = build(PRESET, _body(workspace, target))
    old_rows = _rows(original, [row["p9_record_id"] for row in bridge["matches"]], "P9 observation edition")
    new_rows = _rows(observed, [row["f7_record_id"] for row in bridge["matches"]], "F7 observation edition")
    if bridge["source_ids"]["f7"] != F7_SOURCE:
        raise ValueError("Unexpected published annual source edition")
    used = {key for unit in plan["units"] for key in unit["observation_record_ids"]}
    if not used or not used <= set(old_rows):
        raise ValueError("The original saved evaluation uses different reference identities")
    for match in bridge["matches"]:
        old, new = old_rows[match["p9_record_id"]], new_rows[match["f7_record_id"]]
        source = match["f7_record"]
        for row, label in ((old, "P9"), (new, "F7")):
            if (row["station_id"] != match["station_id"]
                    or row["catchment_id"] != match["p9_catchment_id"]
                    or row["parameter"] != match["parameter"]
                    or row["period_start"] != match["period_start"]
                    or row["period_end"] != match["period_end_exclusive"]):
                raise ValueError(label + " station, catchment, constituent or flow period differs")
        if (old["unit"] != match["comparison_unit"]
                or _decimal(old["value"], "P9 value") != Decimal(match["p9_value_exact"])):
            raise ValueError("The original P9 value or mass-rate unit differs")
        if (new["unit"] != source["unit"]
                or _decimal(new["value"], "F7 value") != Decimal(source["value_exact"])):
            raise ValueError("The imported F7 value or mass-rate unit differs")
        _same(new.get("uncertainty"), source["uncertainty"], "Published F7 standard error")
        retained = new.get("source_records")
        if not isinstance(retained, dict):
            raise ValueError("The F7 table must retain its original source-record dictionary")
        # The native importer appends archive/catchment provenance to this exact
        # original record. Require every original key; preserve the additions.
        for key, value in source.items():
            _same(retained.get(key), value, "Original F7 field " + key)
        expected_method = ("USGS published Beale long-term average annual load"
                           if source["final_method"] == "beale" else
                           "USGS published Fluxmaster five-parameter Kalman-smoothed, detrended long-term average annual load")
        if new.get("method") != expected_method:
            raise ValueError("The original F7 final estimator differs")
    members = _members(collection, entry, observed)
    for member in members:
        if "sha256" not in member:
            from .common import describe_file
            member.update(describe_file(workspace.root, workspace.root / member["path"]))
        verify_file(workspace.root, member)
    return {
        "schema": SCHEMA, "version": 1, "kind": "related_edition_published_standard_errors",
        "calibration_id": report["id"], "plan_id": plan["id"],
        "original_observation_id": original["id"], "original_observation": original["original"],
        "observation_id": observed["id"], "observation_original": observed["original"],
        "observation_metadata": observed["metadata"],
        "source_collection_id": collection["id"], "source_id": entry["id"],
        "source_entry_sha256": digest(entry), "source_uri": bridge["source_urls"]["f7"],
        "source_members": members, "original_target_records": target,
        "matches": bridge["matches"], "bridge": bridge,
        "relationship": RELATIONSHIP, "interpretation": INTERPRETATION,
        "center": "exact_f7_estimate", "zero_multiplier": "exact_f7_point",
        "baseline": "unchanged_p9_original_objective",
    }


def verify(workspace, report, plan, original, binding):
    """Verify retained bytes/identities, without replacing saved explanatory text."""
    if binding.get("schema") != SCHEMA or binding.get("version") != 1:
        raise ValueError("Unsupported external reference-error binding")
    actual = resolve(workspace, report, plan, original, binding["observation_id"],
                     source_collection_id=binding["source_collection_id"],
                     source_id=binding["source_id"])
    keys = ("kind", "calibration_id", "plan_id", "original_observation_id",
            "original_observation", "observation_id", "observation_original",
            "observation_metadata", "source_collection_id", "source_id",
            "source_entry_sha256", "source_uri", "source_members", "original_target_records",
            "matches", "center", "zero_multiplier", "baseline")
    for key in keys:
        _same(binding[key], actual[key], "External reference binding " + key)
    for key in ("schema", "original_inputs", "source_ids", "source_urls", "p9_preparation_id",
                "f7_source", "matches", "additional_context_records", "summary"):
        _same(binding["bridge"][key], actual["bridge"][key], "Original source bridge " + key)
    return binding


def archive_members(workspace, binding):
    """Return collision-free paths for complete original source bytes."""
    result = {}
    for index, descriptor in enumerate(binding["source_members"], 1):
        name = descriptor.get("view_path") or descriptor.get("filename") or Path(descriptor["path"]).name
        member = PurePosixPath(name)
        if (member.is_absolute() or not member.parts or ".." in member.parts
                or member.as_posix() != name or "\\" in name or "\0" in name):
            raise ValueError("Invalid original reference-source member name")
        path = verify_file(workspace.root, descriptor)
        # The numbered prefix distinguishes equal filenames from different
        # original members while preserving each original relative hierarchy.
        result["reference-source/" + str(index).zfill(3) + "/" + name] = path
    return result


def reading_bodies(binding):
    """Readable source comparison alongside the complete raw source members."""
    from source_tools.annual_reference_bridge import csv_body, html_body
    bridge = binding["bridge"]
    return {
        "external-reference.json": (json.dumps(binding, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8"),
        "reference-edition-bridge.json": (json.dumps(bridge, indent=2, ensure_ascii=False, allow_nan=False) + "\n").encode("utf-8"),
        "reference-edition-bridge.csv": csv_body(bridge).encode("utf-8"),
        "reference-edition-bridge.html": html_body(bridge).encode("utf-8"),
    }


def html_section(binding, prefix=""):
    """Compact, exact source centers, units, estimator and period distinction."""
    import html
    from urllib.parse import quote
    fields = ("catchment_name", "parameter", "p9_value_exact", "f7_value_exact",
              "f7_standard_error_exact", "comparison_unit", "published_final_method",
              "water_quality_start", "water_quality_end_inclusive")
    esc = lambda value: html.escape(str(value), quote=True)
    head = "".join("<th>" + esc(key.replace("_", " ")) + "</th>" for key in fields)
    rows = "".join("<tr>" + "".join("<td>" + esc(row[key]) + "</td>" for key in fields)
                   + "</tr>" for row in binding["matches"])
    link = lambda name, label: '<a href="' + quote(prefix + name, safe="/") + '">' + esc(label) + "</a>"
    return ("<section><h2>Related annual-source errors and exact F7 centers</h2><p>"
            + esc(binding["relationship"]) + "</p><p>" + esc(binding["interpretation"])
            + '</p><div class="scroll"><table><thead><tr>' + head
            + "</tr></thead><tbody>" + rows + "</tbody></table></div><p>"
            + link("reference-edition-bridge.html", "Read all original methods, periods and eleven source records")
            + " · " + link("reference-edition-bridge.csv", "Exact seven-record source comparison CSV")
            + " · " + link("external-reference.json", "Complete original source binding")
            + "</p></section>")


def copy_package(workspace, binding, directory):
    """Reuse the maintained review's streaming immutable-copy primitive."""
    from .calibration_review import _copy
    from .common import atomic_bytes, describe_file
    files = {}
    for name, data in reading_bodies(binding).items():
        atomic_bytes(directory / name, data, immutable=True)
        files[name] = describe_file(directory, directory / name)
    for name, source in archive_members(workspace, binding).items():
        files[name] = _copy(directory, source, name, describe_file(workspace.root, source))
    return files
