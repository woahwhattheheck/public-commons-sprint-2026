"""Bind source-derived utility observations to a retained original utility selection."""
from __future__ import annotations

import copy
import hashlib
import json
import os
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

SCHEMA = "upstate.utility-observed-context/v1"
MANIFEST = "utility_observed_context.sources.json"
SOURCE_ID = "upper-savannah-utility-observed-context-20261013"


def _hash(body):
    return hashlib.sha256(body).hexdigest()


def _relative(value):
    if not isinstance(value, str) or not value or "\\" in value:
        raise ValueError("Retain a canonical observed-source member")
    path = PurePosixPath(value)
    if path.is_absolute() or path.as_posix() != value or any(part in ("", ".", "..") for part in value.split("/")):
        raise ValueError("The observed-source member leaves its edition")
    return value


def load_for_utility(application, utility):
    """Return one original selection plus complete source bytes, when installed.

    An absent optional source edition yields None. A present but altered edition
    raises at its actual source boundary. The caller retains this binding in the
    export identity and copies the returned source bodies into the saved export.
    """
    root = Path(application).resolve(strict=True)
    manifest_path = root / MANIFEST
    if not manifest_path.is_file():
        return None, {}
    manifest_body = manifest_path.read_bytes()
    manifest = json.loads(manifest_body)
    if manifest.get("schema") != "upstate.sources/v1":
        raise ValueError("The observed source needs its original import manifest")
    matches = [row for row in manifest.get("entries", []) if row.get("id") == SOURCE_ID]
    if len(matches) != 1:
        raise ValueError("The utility-observation source selection is ambiguous")
    entry = matches[0]
    bodies, descriptors = {}, {}
    for row in [entry, *entry.get("companions", [])]:
        name = _relative(row.get("path"))
        path = (manifest_path.parent / name).resolve(strict=True)
        if not path.is_relative_to(root):
            raise ValueError("The observed source leaves its application")
        body = path.read_bytes()
        if row.get("sha256") != _hash(body) or row.get("bytes") != len(body):
            raise ValueError("The original observed-source body changed: " + name)
        if name in bodies and bodies[name] != body:
            raise ValueError("The observed edition repeats a different member")
        bodies[name] = body
        descriptors[name] = {"path": "observed-sources/" + name, "bytes": len(body), "sha256": _hash(body)}
    original = json.loads(bodies[entry["path"]])
    if original.get("schema") != SCHEMA:
        raise ValueError("Select the retained utility observed-context source")
    for identity in original["source_identities"].values():
        member = identity["path"]
        body = bodies.get(_relative(member))
        if body is None or len(body) != identity["bytes"] or _hash(body) != identity["sha256"]:
            raise ValueError("The observed result and its retained original input differ: " + member)
    if original.get("profile_sha256") != utility["profile_source"]["sha256"]:
        return None, {}
    selected = [row for row in original["utilities"] if row["utility_id"] == utility["utility_id"]]
    if len(selected) != 1 or sorted(selected[0]["huc12s"]) != sorted(utility["huc12s"]):
        return None, {}
    result = {
        "schema": "upstate.utility-observed-selection/v1",
        "version": original["version"], "edition": original["edition"],
        "utility_id": utility["utility_id"], "profile_sha256": original["profile_sha256"],
        "microbial_query_period": original["microbial_query_period"],
        "utility": copy.deepcopy(selected[0]), "regional_stream": copy.deepcopy(original["regional_stream"]),
        "methods": copy.deepcopy(original["methods"]), "source_identities": copy.deepcopy(original["source_identities"]),
        "source": {"source_id": SOURCE_ID, "title": entry["title"], "uri": entry["uri"],
                   "vintage": entry["vintage"], "body_sha256": entry["sha256"], "body_bytes": entry["bytes"],
                   "manifest_sha256": _hash(manifest_body)},
        "retained_files": descriptors,
    }
    bodies["_source-manifest.json"] = manifest_body
    result["retained_files"]["_source-manifest.json"] = {
        "path": "observed-sources/_source-manifest.json", "bytes": len(manifest_body),
        "sha256": _hash(manifest_body)}
    return result, bodies


def retain(directory, context, bodies):
    """Copy the complete verified edition into the existing saved export."""
    root = Path(directory).resolve()
    files = {}
    for name, body in bodies.items():
        descriptor = context["retained_files"][name]
        relative = _relative(descriptor["path"])
        target = root / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.resolve().is_relative_to(root):
            raise ValueError("The observed export member leaves its saved directory")
        if len(body) != descriptor["bytes"] or _hash(body) != descriptor["sha256"]:
            raise ValueError("The observed source changed before export")
        if target.exists() and target.read_bytes() != body:
            raise ValueError("The saved observed export member already has different bytes")
        target.write_bytes(body)
        files[relative] = dict(descriptor)
    return files


def brief_lines(selection, table, number):
    observed = selection.get("observed_context")
    if observed is None:
        return []
    u, region = observed["utility"], observed["regional_stream"]
    summary, period = u["summary"], observed["microbial_query_period"]
    lines = ["## Original utility observations", "",
             "E. coli sampling period: " + period["start"] + " to " + period["end"] + ".",
             u["geographic_basis"] + ".", ""]
    lines += table(["Original records", "Stations", "Unique sample dates", "Information Only", "Field replicates"], [[
        summary["records"], summary["stations"], summary["unique_dates"],
        summary["information_only_records"], summary["activity_types"].get("Quality Control Sample-Field Replicate", 0)]])
    lines += ["", "Original concentration units: " + ", ".join(summary["source_units"]) + ".",
              "Original detection states: " + json.dumps(summary["detection_status"], sort_keys=True) + ".", ""]
    lines += table(["Year", "Active stations", "Records", "Sample dates", "Sampled months"], [
        [row["year"], row["stations"], row["records"], row["unique_dates"], len(row["observed_months"])] for row in u["years"]])
    lines += ["", "Station sets change across years; these counts describe the selected original sampling cohort.", ""]
    lines += table(["Station", "Original HUC12", "Records", "Dates", "First sample", "Last sample"], [
        [row["station_id"], row["matched_huc12"], row["records"], row["unique_dates"], row["first_date"], row["last_date"]]
        for row in u["station_summaries"]])
    without = u["huc12_coverage"]["without_selected_stations"]
    if without is not None:
        lines += ["", "Utility HUC12s without a station in this source cohort: " + (", ".join(without) or "none") + "."]
    lines += ["", u["model_interpretation"], "",
              "## Regional stream context and model comparison", "", region["geographic_meaning"], ""]
    lines += table(["Station", "Original HUC8", "ARJWS relation", "Pioneer relation", "Gauge network relation"], [
        [row["station_id"], row["original_huc8"], row["arjws_scope"], row["prwd_scope"], row["gauge_network_relation"]]
        for row in region["stations"]])
    flow = region["flow_coverage"]
    lines += ["", str(flow["result_rows"]) + " original nutrient rows cover " + str(flow["unique_sampling_dates"]) +
              " distinct sampling dates alongside " + str(flow["gauge_daily_records"]) + " original daily flows.",
              str(flow["unsampled_extreme_episodes"]) + " of " + str(flow["extreme_flow_episodes"]) +
              " source-defined high-flow episodes had no sample date in this regional four-station cohort.", ""]
    lines += table(["Year", "Daily flows", "Sample dates", "Days >= P95", "Sample dates >= P95",
                    "Flow-volume share on P95 days (%)", "Provisional", "Estimated"], [
        [row["period"], row["daily_records"], row["sampled_dates"], row["extreme_flow_days"],
         row["extreme_sampled_dates"], number(row["extreme_flow_volume_percent"]), row["provisional_days"], row["estimated_days"]] for row in flow["network_years"]])
    lines += ["", region["quantity_meaning"], "", region["interpretation"], "",
              "## Complete observed source and export files", ""]
    for name, descriptor in sorted(observed["retained_files"].items()):
        if name.endswith(("report.html", ".csv", "utility-observed-context.json", "_source-manifest.json")):
            lines.append("- [" + name + "](<" + descriptor["path"] + ">)")
    lines += ["", "Original observed-context SHA-256: " + observed["source"]["body_sha256"] + ".",
              "Original utility-profile SHA-256: " + observed["profile_sha256"] + ".", ""]
    return lines


def catalog(application):
    """Read the verified presentation summary without rereading original tables."""
    root = Path(application).resolve(strict=True)
    path = root / MANIFEST
    if not path.is_file():
        return None
    manifest = json.loads(path.read_bytes())
    entries = [row for row in manifest.get("entries", []) if row.get("id") == SOURCE_ID]
    if manifest.get("schema") != "upstate.sources/v1" or len(entries) != 1:
        raise ValueError("Choose the original utility-observation source manifest")
    entry = entries[0]
    body_path = (path.parent / _relative(entry["path"])).resolve(strict=True)
    if not body_path.is_relative_to(root):
        raise ValueError("The utility observation summary leaves its source root")
    body = body_path.read_bytes()
    if len(body) != entry["bytes"] or _hash(body) != entry["sha256"]:
        raise ValueError("The original utility observation summary changed")
    result = json.loads(body)
    if result.get("schema") != SCHEMA:
        raise ValueError("The original utility observation summary has a different schema")
    return {"schema": SCHEMA, "profile_sha256": result["profile_sha256"],
            "source_id": SOURCE_ID, "body_sha256": entry["sha256"],
            "utilities": [{"utility_id": row["utility_id"], "huc12s": row["huc12s"], "summary": row["summary"],
                           "huc12_coverage": row["huc12_coverage"],
                           "geographic_basis": row["geographic_basis"]}
                          for row in result["utilities"]]}


def write_packet(directory, files):
    """Archive verified original export members at their actual relative paths."""
    root = Path(directory).resolve(strict=True)
    filename = "utility-watershed-packet.zip"
    selected = {}
    for key, descriptor in files.items():
        name = _relative(descriptor["path"])
        if name == filename:
            continue
        path = (root / name).resolve(strict=True)
        if not path.is_relative_to(root) or not path.is_file():
            raise ValueError("A utility packet member leaves its saved export: " + name)
        body = path.read_bytes()
        if len(body) != descriptor["bytes"] or _hash(body) != descriptor["sha256"]:
            raise ValueError("A utility packet member changed: " + name)
        if name in selected and selected[name][0] != body:
            raise ValueError("The utility packet repeats a different source member")
        selected[name] = (body, dict(descriptor))
    inventory = {"schema": "upstate.utility-watershed-packet/v1",
                 "path_basis": "archive_root", "open": "watershed-selection-brief.html",
                 "files": {name: descriptor for name, (_, descriptor) in sorted(selected.items())}}
    fd, pending = tempfile.mkstemp(prefix=".utility-watershed-packet-", suffix=".zip", dir=root)
    os.close(fd)
    try:
        with zipfile.ZipFile(pending, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
            for name, (body, _) in sorted(selected.items()):
                archive.writestr(name, body)
            archive.writestr("packet.json", (json.dumps(inventory, ensure_ascii=False,
                             allow_nan=False, indent=2) + "\n").encode("utf-8"))
        with open(pending, "rb") as stream:
            os.fsync(stream.fileno())
        os.replace(pending, root / filename)
    finally:
        Path(pending).unlink(missing_ok=True)
    body = (root / filename).read_bytes()
    return {"path": filename, "bytes": len(body), "sha256": _hash(body),
            "media_type": "application/zip", "title": "Complete utility watershed report and original sources"}
