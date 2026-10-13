"""Scientific setup snapshots using ordinary source editions and customer reviews.

The captured setup is a source collection. Review decisions and reconciliation
remain exclusively in model.reviews and model.review_reconciliation.
"""
from __future__ import annotations

import csv
import html
import io
import json
import math
import os
from pathlib import Path, PurePosixPath
import shutil
import tempfile

from .common import (INVEST_SOURCE, INVEST_VERSION, atomic_json, canonical,
                     describe_file, digest, file_digest, held, identifier, now,
                     read_json, relative_file, verify_file)
from .model_selection import grid_models, selected, required_roles
from . import reviews

SELECTION_SCHEMA = "upstate.scientific-setup-selection/v1"
SPECIFICATION_SCHEMA = "upstate.scientific-setup-specification/v1"
KIND = "scientific-setups"
SOURCE_ID = "scientific-setup-specification"
IMPLEMENTATION = "scientific-setup-v1"

REQUIREMENTS = (
    ("setup.question", "Scientific question and selected areas",
     "Identify the question, selected reporting area, model domain, and reason for the domain extent."),
    ("setup.sources", "Original sources and prepared inputs",
     "Locate the selected editions and companions; trace aligned inputs to their originals, units, coverage, dates and transformations."),
    ("setup.grid", "Grid specification and alignment",
     "Identify the actual CRS, bounds, cell size, affine transform, NoData and aligned model inputs; review any difference from the requested specification."),
    ("setup.method", "Selected models and parameter profile",
     "Review the retained model/version, selected parameter profile, original coefficient table and references."),
    ("setup.alternatives", "Baseline and explicit alternatives",
     "Review the named baseline and each selected alternative's source-bound land-cover changes, masks and reasons."),
    ("setup.validation", "Observations and proposed validation",
     "Review retained observations, measurement units and periods, their comparison basis, and the proposed validation method and limitations."),
    ("setup.review", "Scientific review and consolidated corrections",
     "The assigned scientific reviewer records their actual decision or consolidated corrections using the existing review response."),
    ("setup.reopen", "Receiving operator can reopen the project",
     "A second operator reopens the transferred Workspace and reproduces its source inventory, grid, parameter profile and scenario selections."),
)


def _text(value, label, *, required=False, limit=40000):
    if value is None:
        value = ""
    if not isinstance(value, str) or "\0" in value or len(value) > limit:
        raise ValueError(label + " must be a text value within its declared limit")
    value = value.strip()
    if required and not value:
        raise ValueError("State " + label)
    return value


def _ids(value, label):
    if not isinstance(value, list):
        raise ValueError(label + " must list actual Workspace IDs")
    result = [identifier(item) for item in value]
    if len(result) != len(set(result)):
        raise ValueError(label + " contains a repeated selection")
    return result


def normalize(value):
    if not isinstance(value, dict) or value.get("schema") != SELECTION_SCHEMA:
        raise ValueError("Select an " + SELECTION_SCHEMA + " document")
    known = {
        "schema", "title", "question", "domain_rationale", "grid_id", "profile_id",
        "baseline_scenario_id", "alternative_scenario_ids", "source_collection_ids",
        "observation_ids", "validation", "roles", "expected_resolution_m",
        "expected_alternative_count", "notes",
    }
    if set(value) - known:
        raise ValueError("Unknown setup field: " + ", ".join(sorted(set(value) - known)))
    out = {"schema": SELECTION_SCHEMA}
    for field in ("title", "question", "domain_rationale"):
        out[field] = _text(value.get(field), field.replace("_", " "), required=True,
                           limit=300 if field == "title" else (20000 if field == "question" else 40000))
    for field in ("grid_id", "profile_id", "baseline_scenario_id"):
        out[field] = identifier(value.get(field))
    for field in ("alternative_scenario_ids", "source_collection_ids", "observation_ids"):
        out[field] = _ids(value.get(field, []), field.replace("_", " "))
    if out["baseline_scenario_id"] in out["alternative_scenario_ids"]:
        raise ValueError("Select the baseline separately from its alternatives")
    validation = value.get("validation")
    if not isinstance(validation, dict) or set(validation) - {"method", "intended_comparison", "limitations"}:
        raise ValueError("Retain the proposed validation method, intended comparison and limitations")
    out["validation"] = {key: _text(validation.get(key), "validation " + key,
                                   required=key == "method")
                         for key in ("method", "intended_comparison", "limitations")}
    roles = value.get("roles", {})
    if not isinstance(roles, dict) or set(roles) - {"scientific_reviewer", "receiving_operator"}:
        raise ValueError("Use the scientific_reviewer and receiving_operator assignments")
    out["roles"] = {}
    for name in ("scientific_reviewer", "receiving_operator"):
        role = roles.get(name, {})
        if not isinstance(role, dict) or set(role) - {"name", "role", "organization"}:
            raise ValueError("Retain each role's name, role and organization")
        out["roles"][name] = {field: _text(role.get(field), name + " " + field, limit=500)
                             for field in ("name", "role", "organization")}
    if value.get("expected_resolution_m") is not None:
        number = value["expected_resolution_m"]
        if isinstance(number, bool) or not isinstance(number, (int, float)) or not math.isfinite(number) or number <= 0:
            raise ValueError("Requested grid resolution must be a finite positive number of metres")
        out["expected_resolution_m"] = number
    if value.get("expected_alternative_count") is not None:
        count = value["expected_alternative_count"]
        if type(count) is not int or count < 0:
            raise ValueError("Requested alternative count must be a nonnegative integer")
        out["expected_alternative_count"] = count
    notes = value.get("notes", [])
    if not isinstance(notes, list):
        raise ValueError("Setup notes must be a list")
    out["notes"] = [_text(item, "setup note", limit=20000) for item in notes]
    return out


def _descriptor_path(ws, descriptor):
    return verify_file(ws.root, {"path": descriptor["object"],
                                "bytes": descriptor["bytes"],
                                "sha256": descriptor["sha256"]})


def _portable_name(value):
    if not isinstance(value, str) or not value or "\\" in value or "\0" in value:
        raise ValueError("Retain an ordinary portable source path")
    path = PurePosixPath(value)
    if path.is_absolute() or ".." in path.parts or path.as_posix() != value:
        raise ValueError("Source path must remain inside its retained edition")
    return value


def _source_inventory(collections, uses):
    rows = []
    for collection in collections:
        for entry in collection["entries"]:
            metadata = {key: value for key, value in entry.items()
                        if key not in ("body", "companions")}
            rows.append({
                "collection_id": collection["id"], "source_id": entry["id"],
                "title": entry["title"], "kind": entry["kind"], "uri": entry["uri"],
                "vintage": entry["vintage"], "units": entry.get("units"),
                "source_crs": entry.get("source_crs"),
                "coverage": entry.get("coverage", entry.get("scope")),
                "intended_use": entry.get("intended_use"),
                "conversion": entry.get("conversion"),
                "transformations": entry.get("transformations", entry.get("derivation")),
                "resampling": entry.get("resampling"),
                "selected_for": uses.get((collection["id"], entry["id"]), []),
                "metadata": metadata,
                "body": dict(entry["body"]),
                "companions": [dict(item) for item in entry.get("companions", [])],
            })
    return rows


def _check(key, title, actual, expected=None, *, status=None, detail=""):
    if status is None:
        status = "not_requested" if expected is None else ("matches" if actual == expected else "differs")
    return {"id": key, "title": title, "status": status,
            "actual": actual, "expected": expected, "detail": detail}


def preview(ws, value):
    selection = normalize(value)
    grid = ws.get_grid(selection["grid_id"])
    profile = ws._get("profiles", selection["profile_id"])
    baseline = ws._get("scenarios", selection["baseline_scenario_id"])
    alternatives = [ws._get("scenarios", key) for key in selection["alternative_scenario_ids"]]
    observations = [ws._get("observations", key) for key in selection["observation_ids"]]
    if baseline.get("kind") != "baseline" or baseline.get("patches"):
        raise ValueError("The selected baseline must be an actual saved baseline with no patches")
    for alternative in alternatives:
        if alternative.get("kind") != "landcover" or not alternative.get("patches"):
            raise ValueError("Each selected alternative needs its actual saved land-cover patches")
    collection_ids = []
    uses = {}
    def use(collection_id, source_id, purpose):
        collection_id = identifier(collection_id)
        if collection_id not in collection_ids:
            collection_ids.append(collection_id)
        if source_id is not None:
            uses.setdefault((collection_id, source_id), []).append(purpose)
    spec = grid["spec"]
    for role, source_id in spec["input_sources"].items():
        use(spec["source_collection_id"], source_id, "grid input " + role)
    for role in ("reporting_area", "model_domain"):
        use(spec["source_collection_id"], spec[role]["source_id"], role.replace("_", " "))
    use(profile["source_collection_id"], profile["biophysical_source_id"], "biophysical coefficients")
    for scenario in [baseline, *alternatives]:
        use(scenario["source_collection_id"], None, "scenario edition")
        for index, patch in enumerate(scenario.get("patches", []), 1):
            use(scenario["source_collection_id"], patch["mask_source_id"],
                scenario["title"] + " / patch " + str(index))
    for key in selection["source_collection_ids"]:
        use(key, None, "additional selected context")
    collections = [ws._get("sources", key) for key in collection_ids]
    source_entries = {(row["id"], entry["id"]): entry for row in collections for entry in row["entries"]}
    missing = set(uses) - set(source_entries)
    if missing:
        raise ValueError("A selected native source is absent from its original collection")
    inventory = _source_inventory(collections, uses)
    active = list(grid_models(grid))
    profile_models = list(selected(profile))
    checks = [
        _check("models", "Profile contains the grid's selected models", profile_models, active,
               status="matches" if set(active).issubset(profile_models) else "differs"),
        _check("alternatives", "Selected alternative count", len(alternatives),
               selection.get("expected_alternative_count")),
    ]
    coefficient = source_entries[(profile["source_collection_id"], profile["biophysical_source_id"])]
    checks.append(_check("coefficient_table", "Profile binds its original coefficient table",
                         coefficient["body"]["sha256"], profile["table_summary"]["sha256"]))
    for role in required_roles(active):
        original = source_entries[(spec["source_collection_id"], spec["input_sources"][role])]
        provenance = grid["inputs"][role]
        expected_source = {"source_id": original["id"], "sha256": original["body"]["sha256"]}
        actual_source = {"source_id": provenance.get("source_id"),
                         "sha256": provenance.get("source_sha256")}
        checks.append(_check("source." + role, "Prepared input traces to its selected original: " + role,
                             actual_source, expected_source))
    actual_resolution = grid["grid"]["resolution_m"]
    expected = selection.get("expected_resolution_m")
    resolution_match = expected is not None and math.isclose(actual_resolution, expected, rel_tol=1e-9, abs_tol=1e-12)
    checks.append(_check("resolution", "Actual grid cell size in metres", actual_resolution, expected,
                         status="not_requested" if expected is None else ("matches" if resolution_match else "differs")))
    available = {int(code) for code in grid["inputs"]["NLCD"].get("class_counts", {})}
    defined = set(profile["table_summary"]["lucodes"])
    checks.append(_check("landcover_codes", "Profile covers retained grid land-cover classes",
                         sorted(available - defined), [], detail="Missing original grid class codes, if any."))
    for scenario in alternatives:
        from .scenario_footprint import validate_destination_codes
        try:
            validate_destination_codes(profile, scenario)
            issue = ""
        except ValueError as error:
            issue = str(error)
        checks.append(_check("scenario." + scenario["id"], "Alternative destination codes: " + scenario["title"],
                             issue, "", detail="Existing native destination-code validation."))
    for role, assignment in selection["roles"].items():
        checks.append(_check(role, role.replace("_", " ").title(), assignment,
                             status="matches" if assignment["name"] else "needs_description",
                             detail="This assignment records responsibility; decisions remain in the actual review response."))
    input_rows = []
    for role, descriptor in grid["files"].items():
        input_rows.append({"role": role, "prepared_file": dict(descriptor),
                           "provenance": grid.get("inputs", {}).get(role),
                           "header": None})
    requirement_rows = [{"id": key, "title": title, "detail": detail}
                        for key, title, detail in REQUIREMENTS]
    specification = {
        "schema": SPECIFICATION_SCHEMA, "implementation": IMPLEMENTATION,
        "project": ws.project, "selection": selection,
        "question": selection["question"], "domain_rationale": selection["domain_rationale"],
        "areas": {"reporting_area": spec["reporting_area"], "model_domain": spec["model_domain"],
                  "source_collection_id": spec["source_collection_id"],
                  "upstream_buffer_m": spec["upstream_buffer_m"]},
        "grid": {"id": grid["id"], "state": grid["state"], "spec": spec,
                 "definition": grid["grid"], "prepared_inputs": input_rows},
        "method": {"model_implementation": "Natural Capital Project InVEST",
                   "version": INVEST_VERSION, "source": INVEST_SOURCE,
                   "selected_models": active, "profile_models": profile_models,
                   "profile": profile},
        "baseline": baseline, "alternatives": alternatives,
        "observations": [{"id": row["id"], "metadata": row["metadata"],
                          "admitted_count": row["admitted_count"],
                          "context_count": row["context_count"], "row_count": len(row["rows"]),
                          "original": row["original"]}
                         for row in observations],
        "validation": selection["validation"], "roles": selection["roles"],
        "source_collection_ids": collection_ids, "source_inventory": inventory, "checks": checks,
        "requirements": requirement_rows, "notes": selection["notes"],
    }
    return {"selection": selection, "specification": specification, "checks": checks,
            "source_inventory": inventory, "requirements": requirement_rows}


def _capture_headers(ws, specification):
    """Read actual retained raster headers; never substitute a nominal NoData."""
    import rasterio
    from rasterio.crs import CRS
    grid = specification["grid"]
    expected = grid["definition"]
    root = ws.root / "grids" / grid["id"]
    checks = []
    for row in grid["prepared_inputs"]:
        path = verify_file(root, row["prepared_file"])
        if path.suffix.lower() not in (".tif", ".tiff"):
            continue
        with rasterio.open(path) as dataset:
            transform = list(dataset.transform)[:6]
            nodata = dataset.nodata
            header = {
                "crs": dataset.crs.to_wkt() if dataset.crs else None,
                "crs_name": dataset.crs.to_string() if dataset.crs else None,
                "transform": transform, "width": dataset.width, "height": dataset.height,
                "bounds": list(dataset.bounds), "count": dataset.count,
                "dtypes": list(dataset.dtypes),
                "nodata": nodata if nodata is None or math.isfinite(nodata) else str(nodata),
                "nodata_is_nonfinite": nodata is not None and not math.isfinite(nodata),
                "units": row["prepared_file"].get("units"),
            }
            crs_matches = dataset.crs == CRS.from_user_input(expected["crs"])
            transform_matches = all(math.isclose(a, b, rel_tol=0, abs_tol=1e-8)
                                    for a, b in zip(transform, expected["transform"]))
            matches = (crs_matches and transform_matches
                       and dataset.width == expected["width"] and dataset.height == expected["height"])
        row["header"] = header
        checks.append(_check("aligned." + row["role"], "Prepared grid alignment: " + row["role"],
                             header, status="matches" if matches else "differs",
                             detail="Compared the actual retained raster header with the selected grid definition."))
    specification["checks"].extend(checks)


def _copy_verified(source, destination, *, sha256=None, size=None):
    source = Path(source)
    if sha256 is not None and (file_digest(source) != sha256 or (size is not None and source.stat().st_size != size)):
        raise ValueError("An original setup input changed before capture: " + source.name)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists():
        if not destination.is_file() or file_digest(destination) != file_digest(source):
            raise ValueError("Existing setup member differs from its original")
        return
    handle, name = tempfile.mkstemp(prefix=".setup-", dir=destination.parent)
    os.close(handle)
    temporary = Path(name)
    try:
        temporary.unlink()
        try:
            os.link(source, temporary)
        except OSError:
            shutil.copyfile(source, temporary)
        if file_digest(temporary) != file_digest(source):
            raise ValueError("Setup source changed during capture")
        os.replace(temporary, destination)
    finally:
        temporary.unlink(missing_ok=True)


def _csv(rows, fields):
    buffer = io.StringIO(newline="")
    writer = csv.DictWriter(buffer, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: json.dumps(row.get(field), ensure_ascii=False, sort_keys=True)
                         if isinstance(row.get(field), (dict, list))
                         else row.get(field) for field in fields})
    return buffer.getvalue()


def _display(value):
    if value is None or value == "":
        return "Not declared"
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return str(value)


def render_html(specification):
    e = lambda value: html.escape(_display(value), quote=True)
    def table(headings, rows):
        return ("<table><thead><tr>" + "".join("<th>" + e(x) + "</th>" for x in headings)
                + "</tr></thead><tbody>" + "".join("<tr>" + "".join("<td>" + e(x) + "</td>" for x in row)
                                                    + "</tr>" for row in rows) + "</tbody></table>")
    s = specification
    method, grid = s["method"], s["grid"]
    parts = [
        "<!doctype html><html lang='en'><meta charset='utf-8'><meta name='viewport' content='width=device-width'>",
        "<title>" + e(s["selection"]["title"]) + "</title>",
        "<style>body{font:15px/1.5 system-ui,sans-serif;margin:2rem auto;padding:0 1rem;max-width:1100px;color:#222;background:#fff}"
        "h1{font-size:1.8rem}h2{margin-top:2rem;border-bottom:1px solid #aaa;padding-bottom:.3rem}"
        "table{border-collapse:collapse;width:100%;margin:1rem 0;font-size:.9rem}th,td{border:1px solid #bbb;padding:.55rem;text-align:left;vertical-align:top;overflow-wrap:anywhere}"
        "th{background:#eee}code{overflow-wrap:anywhere}a{color:inherit}p{max-width:90ch}"
        "@media print{body{font-size:11px;margin:0;max-width:none}tr{break-inside:avoid}h2{break-after:avoid}}</style>",
        "<main><h1>" + e(s["selection"]["title"]) + "</h1>",
        "<p><strong>Project:</strong> " + e(s["project"]["title"]) + " · <strong>Captured:</strong> " + e(s.get("captured_at", "Preview")) + "</p>",
        "<p><a href='specification.json'>Complete machine-readable specification</a> · "
        "<a href='source-inventory.csv'>Source inventory</a> · <a href='prepared-inputs.csv'>Prepared input inventory</a> · "
        "<a href='scenario-changes.csv'>Scenario changes</a></p>",
        "<h2>1. Scientific question and selected areas</h2><p>" + e(s["question"]) + "</p>",
        table(["Selection", "Actual selection"], [
            ("Reporting area", s["areas"]["reporting_area"]), ("Model domain", s["areas"]["model_domain"]),
            ("Source collection", s["areas"]["source_collection_id"]),
            ("Upstream/context buffer (m)", s["areas"]["upstream_buffer_m"])]),
        "<p><strong>Why this model domain:</strong> " + e(s["domain_rationale"]) + "</p>",
        "<h2>2. Sources and prepared inputs</h2>",
        "<p>The following inventory preserves the original source metadata and companion relationships. "
        "Prepared inputs link each transformation to its retained source edition.</p>",
        table(["Source and edition", "Use / coverage", "Units / transformations", "Original"],
              [(row["title"] + " · " + row["vintage"], {"selected_for": row["selected_for"], "coverage": row["coverage"], "intended_use": row["intended_use"]},
                {"units": row["units"], "conversion": row["conversion"], "derivation": row["transformations"], "resampling": row["resampling"]},
                {"uri": row["uri"], "collection_id": row["collection_id"], "source_id": row["source_id"],
                 "sha256": row["body"]["sha256"], "companions": len(row["companions"])})
               for row in s["source_inventory"]]),
        "<h2>3. Actual grid and alignment</h2>",
        table(["Grid field", "Retained value"], [(key, grid["definition"].get(key)) for key in (
            "crs_name", "bounds", "resolution_m", "width", "height", "transform", "pixel_area_ha", "reference_alignment")]),
        table(["Prepared input", "Units and NoData", "Original source / transformation", "Actual alignment"],
              [(row["role"], {"units": row["prepared_file"].get("units"), "nodata": (row.get("header") or {}).get("nodata"),
                               "header_captured": row.get("header") is not None},
                row["provenance"], row.get("header")) for row in grid["prepared_inputs"]]),
        "<h2>4. Models and parameter profile</h2>",
        table(["Selection", "Retained value"], [("Model", method["model_implementation"]),
              ("Version", method["version"]), ("Selected models", method["selected_models"]),
              ("Profile", {"id": method["profile"]["id"], "title": method["profile"]["title"]}),
              ("Native source", method["source"]), ("Coefficient source", {
                  "source_collection_id": method["profile"]["source_collection_id"],
                  "biophysical_source_id": method["profile"]["biophysical_source_id"],
                  "table_summary": method["profile"]["table_summary"]}),
              ("NDR parameters", method["profile"].get("ndr")), ("SDR parameters", method["profile"].get("sdr")),
              ("Reference sources", method["profile"].get("references")), ("Model period", method["profile"].get("model_period"))]),
        "<h2>5. Baseline and explicit alternatives</h2>",
        table(["Scenario", "Reason", "Exact source-bound changes"],
              [(s["baseline"]["title"] + " (baseline)", s["baseline"].get("reason"), s["baseline"].get("patches", []))]
              + [(row["title"], row.get("reason"), row["patches"]) for row in s["alternatives"]]),
        "<h2>6. Observations and proposed validation</h2>",
        table(["Observation edition", "Original metadata", "Retained measurement rows"],
              [(row["id"], row["metadata"], {"total": row["row_count"], "annual_load_comparison": row["admitted_count"],
                                            "context": row["context_count"]}) for row in s["observations"]]),
        "<p><strong>Method:</strong> " + e(s["validation"]["method"]) + "</p>",
        "<p><strong>Intended comparison:</strong> " + e(s["validation"]["intended_comparison"]) + "</p>",
        "<p><strong>Limitations:</strong> " + e(s["validation"]["limitations"]) + "</p>",
        "<h2>7. Responsibilities and review findings</h2>",
        table(["Responsibility", "Assigned person"], [(key.replace("_", " ").title(),
               row if row["name"] else "Unassigned") for key, row in s["roles"].items()]),
        table(["Check", "Result", "Actual", "Requested / detail"],
              [(row["title"], row["status"], row["actual"], {"expected": row["expected"], "detail": row["detail"]})
               for row in s["checks"]]),
        "<p>Record scientific decisions and consolidated corrections in the accompanying customer-review response. "
        "The transferred Workspace retains the selected native object identities for the receiving operator to reopen.</p>",
        "<h2>8. Reopening the selected project</h2><p>Use the complete Workspace transfer with the installed application. "
        "Open this setup in Scientific setup or run the receiving command with its saved selection. The selected grid, "
        "profile, baseline, alternatives, observation records and original source collections retain their IDs. "
        "The review packet contains the specification and captured originals; the Workspace transfer reproduces the working project.</p>",
        "<h2>9. Retained originals and native objects</h2>",
        "<p>Open the original files beside this sheet. The inventory preserves each source edition and its companion paths.</p>",
        "".join("<details><summary>" + e(row["title"]) + " · " + e(row["source_id"]) + "</summary><ul>"
                + "".join("<li><a href='" + html.escape(path, quote=True) + "'>" + e(path) + "</a></li>"
                          for path in ([row["captured_primary"], *row.get("captured_companions", [])]
                                       if row.get("captured_primary") else []))
                + "</ul></details>" for row in s["source_inventory"]),
        "<details><summary>Exact Workspace objects, grid inputs and observations</summary><ul>"
        + "".join("<li><a href='" + html.escape(row["path"], quote=True) + "'>" + e(row["path"]) + "</a></li>"
                  for row in s.get("retained_members", [])
                  if row["path"].startswith(("workspace/", "observations/")))
        + "</ul></details>",
        "<p><strong>Notes:</strong> " + e(s["notes"]) + "</p></main></html>",
    ]
    return "\n".join(parts) + "\n"


def _write_text(path, content):
    data = content.encode("utf-8")
    if path.exists():
        if path.read_bytes() != data:
            raise ValueError("Previously captured setup document differs")
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name("." + path.name + ".pending")
    temporary.write_bytes(data)
    os.replace(temporary, path)


def _capture(ws, prepared, directory, captured_at):
    specification = json.loads(json.dumps(prepared["specification"], allow_nan=False))
    specification["captured_at"] = captured_at
    _capture_headers(ws, specification)
    retained = []
    def copy(source, relative, *, sha256=None, size=None, origin=None):
        target = directory / _portable_name(relative)
        _copy_verified(source, target, sha256=sha256, size=size)
        item = describe_file(directory, target, origin=origin or {})
        if not any(row["path"] == item["path"] for row in retained):
            retained.append(item)
        return item
    def record(kind, key):
        row = ws._get(kind, key)
        copy(ws.root / kind / (key + ".json"), "workspace/" + kind + "/" + key + ".json",
             origin={"kind": kind, "id": key})
        return row
    copy(ws.root / "workspace.json", "workspace/workspace.json", origin={"kind": "project"})
    grid_id = prepared["selection"]["grid_id"]
    copy(ws.root / "grids" / grid_id / "grid.json", "workspace/grids/" + grid_id + "/grid.json",
         origin={"kind": "grid", "id": grid_id})
    for row in specification["grid"]["prepared_inputs"]:
        body = row["prepared_file"]
        path = verify_file(ws.root / "grids" / grid_id, body)
        item = copy(path, "workspace/grids/" + grid_id + "/" + _portable_name(body["path"]),
                    sha256=body["sha256"], size=body["bytes"],
                    origin={"kind": "prepared-grid-input", "grid_id": grid_id, "role": row["role"]})
        row["captured_path"] = item["path"]
    record("profiles", prepared["selection"]["profile_id"])
    for key in [prepared["selection"]["baseline_scenario_id"], *prepared["selection"]["alternative_scenario_ids"]]:
        record("scenarios", key)
    collections = specification["source_collection_ids"]
    for key in collections:
        collection = record("sources", key)
        descriptor = collection["original_manifest"]
        copy(_descriptor_path(ws, descriptor), "originals/" + key + "/original-manifest.json",
             sha256=descriptor["sha256"], size=descriptor["bytes"],
             origin={"kind": "source-manifest", "collection_id": key})
    for row in specification["source_inventory"]:
        primary, entry = ws.source_file(row["collection_id"], row["source_id"])
        root = ws.root / "source-views" / row["collection_id"] / digest(row["source_id"])
        namespace = "originals/" + row["collection_id"] + "/" + digest(row["source_id"]) + "/"
        parts = [entry["body"], *entry.get("companions", [])]
        captured = []
        for index, descriptor in enumerate(parts):
            view_path = _portable_name(descriptor.get("view_path") or descriptor["filename"])
            path = relative_file(root, view_path)
            item = copy(path, namespace + view_path, sha256=descriptor["sha256"], size=descriptor["bytes"],
                        origin={"kind": "source-entry", "collection_id": row["collection_id"],
                                "source_id": row["source_id"], "part": index, "view_path": view_path})
            captured.append(item["path"])
        row["captured_primary"] = captured[0]
        row["captured_companions"] = captured[1:]
    for row in specification["observations"]:
        observation = record("observations", row["id"])
        body = observation["original"]
        item = copy(_descriptor_path(ws, body), "observations/" + row["id"] + "/" + _portable_name(body["filename"]),
                    sha256=body["sha256"], size=body["bytes"],
                    origin={"kind": "original-observation", "observation_id": row["id"]})
        row["captured_original"] = item["path"]
    specification["retained_members"] = retained
    atomic_json(directory / "specification.json", specification, immutable=True)
    _write_text(directory / "index.html", render_html(specification))
    _write_text(directory / "source-inventory.csv", _csv(specification["source_inventory"],
                ["collection_id", "source_id", "title", "kind", "uri", "vintage", "units", "source_crs",
                 "coverage", "intended_use", "selected_for", "conversion", "transformations", "resampling",
                 "captured_primary", "captured_companions"]))
    _write_text(directory / "prepared-inputs.csv", _csv(specification["grid"]["prepared_inputs"],
                ["role", "prepared_file", "provenance", "header", "captured_path"]))
    scenario_rows = []
    for scenario in [specification["baseline"], *specification["alternatives"]]:
        for index, patch in enumerate(scenario.get("patches", []) or [None]):
            scenario_rows.append({"scenario_id": scenario["id"], "title": scenario["title"], "kind": scenario["kind"],
                                  "source_collection_id": scenario["source_collection_id"],
                                  "reason": scenario.get("reason"), "patch_index": index if patch else None,
                                  "patch": patch})
    _write_text(directory / "scenario-changes.csv", _csv(scenario_rows,
                ["scenario_id", "title", "kind", "source_collection_id", "reason", "patch_index", "patch"]))
    companion_paths = [row["path"] for row in retained] + [
        "index.html", "source-inventory.csv", "prepared-inputs.csv", "scenario-changes.csv"]
    companions = [describe_file(directory, directory / path) for path in companion_paths]
    manifest = {
        "schema": "upstate.sources/v1", "title": prepared["selection"]["title"],
        "captured_at": captured_at,
        "scope": {"project_id": ws.project["id"], "setup_selection_sha256": digest(prepared["selection"])},
        "notes": ["Captured native scientific setup; decisions use the existing customer-review response."],
        "entries": [{
            "id": SOURCE_ID, "title": prepared["selection"]["title"], "kind": "document",
            "uri": "urn:upstate:scientific-setup:" + digest({"project": ws.project["id"], "selection": prepared["selection"], "captured_at": captured_at}),
            "vintage": captured_at, "path": "specification.json",
            "sha256": file_digest(directory / "specification.json"), "companions": companions,
            "metadata": {"role": "SCIENTIFIC_SETUP_SPECIFICATION", "implementation": IMPLEMENTATION,
                         "guide_file": "index.html", "source_inventory_file": "source-inventory.csv",
                         "prepared_inputs_file": "prepared-inputs.csv", "scenario_changes_file": "scenario-changes.csv",
                         "selected_grid_id": grid_id, "selected_profile_id": prepared["selection"]["profile_id"],
                         "baseline_scenario_id": prepared["selection"]["baseline_scenario_id"],
                         "alternative_scenario_ids": prepared["selection"]["alternative_scenario_ids"]},
        }],
    }
    atomic_json(directory / "sources.json", manifest, immutable=True)
    return specification


def create(ws, value, *, operation_id=None, created_at=None):
    selection = normalize(value)
    operation_id = identifier(operation_id) if operation_id else digest({"project_id": ws.project["id"], "selection": selection})
    directory = ws.root / "setup-packages" / operation_id
    with held(ws.root / "setup-packages" / (operation_id + ".lock")):
        # The ordinary project transfer takes this same Workspace lock. Keep
        # each source snapshot/import generation complete while it is captured.
        with held(ws.root / ".workspace.lock", blocking=False):
            directory.mkdir(parents=True, exist_ok=True)
            operation_path = directory / "operation.json"
            if operation_path.exists():
                operation = read_json(operation_path)
                if operation["selection"] != selection or operation["project_id"] != ws.project["id"]:
                    raise ValueError("Setup operation ID already belongs to another selected setup")
                if operation.get("setup_id"):
                    return detail(ws, operation["setup_id"])
            else:
                operation = {"schema": "upstate.scientific-setup-operation/v1",
                             "project_id": ws.project["id"], "selection": selection,
                             "created_at": created_at or now(), "operation_id": operation_id}
                atomic_json(operation_path, operation)
            if (directory / "sources.json").exists():
                specification = read_json(directory / "specification.json")
                if specification["selection"] != selection:
                    raise ValueError("Captured setup selection changed")
            else:
                prepared = preview(ws, selection)
                specification = _capture(ws, prepared, directory, operation["created_at"])
            # This exact Workspace.import_sources implementation does not take
            # the project lock itself; source intake stays in the captured scope.
            collection = ws.import_sources(directory / "sources.json")
        # The maintained review operation acquires .workspace.lock internally.
        review = reviews.create_review(ws, {
            "schema": reviews.SELECTION_SCHEMA, "title": selection["title"],
            "purpose": selection["question"], "source_collection_ids": [collection["id"]],
            "run_ids": [], "delivery_ids": [], "spatial_export_ids": [],
            "requirements": specification["requirements"], "notes": selection["notes"],
        }, created_at=operation["created_at"])
        with held(ws.root / ".workspace.lock", blocking=False):
            record = ws._save(KIND, {
                "title": selection["title"], "created_at": operation["created_at"],
                "project_id": ws.project["id"], "operation_id": operation_id, "selection": selection,
                "source_collection_id": collection["id"], "source_id": SOURCE_ID,
                "review_id": review["id"], "specification_sha256": file_digest(directory / "specification.json"),
                "implementation": IMPLEMENTATION,
            })
            atomic_json(operation_path, {**operation, "setup_id": record["id"]})
    return detail(ws, record["id"])


def detail(ws, setup_id):
    setup = ws._get(KIND, setup_id)
    if setup["project_id"] != ws.project["id"]:
        raise ValueError("Scientific setup belongs to another project")
    primary, entry = ws.source_file(setup["source_collection_id"], setup["source_id"])
    if file_digest(primary) != setup["specification_sha256"]:
        raise ValueError("Captured scientific specification changed")
    specification = read_json(primary)
    if specification.get("schema") != SPECIFICATION_SCHEMA or specification["selection"] != setup["selection"]:
        raise ValueError("Captured setup and its retained selection differ")
    review = reviews.show_review(ws, setup["review_id"], previews=False)
    return {"setup_id": setup["id"], "source_collection_id": setup["source_collection_id"],
            "review_id": setup["review_id"], "setup": setup, "specification": specification,
            "checks": specification["checks"], "review": review,
            "files": [{"path": "specification.json", "bytes": entry["body"]["bytes"],
                       "sha256": entry["body"]["sha256"], "label": "Scientific setup specification"},
                      *[{**item, "path": item.get("view_path") or item["filename"]}
                        for item in entry.get("companions", [])]]}


def catalog(ws):
    def basic(row):
        return {"id": row["id"], "title": row.get("title") or row.get("metadata", {}).get("title") or row["id"][:12]}
    grids = []
    for path in sorted((ws.root / "grids").glob("*/grid.json")):
        row = read_json(path)
        if row.get("state") != "complete":
            continue
        actual = ws.get_grid(row["id"])
        grids.append({**basic(actual), "title": actual["spec"].get("title") or "Grid " + actual["id"][:12],
                      "state": "complete", "resolution_m": actual["grid"]["resolution_m"],
                      "crs": actual["grid"].get("crs_name"), "models": list(grid_models(actual)),
                      "spec": actual["spec"]})
    sources = ws.sources()
    return {
        "project": ws.project, "grids": grids,
        "profiles": [{**basic(row), "models": list(selected(row)),
                      "source_collection_id": row["source_collection_id"],
                      "biophysical_source_id": row["biophysical_source_id"]}
                     for row in ws._list("profiles")],
        "scenarios": [{**basic(row), "kind": row["kind"], "reason": row.get("reason"),
                       "source_collection_id": row["source_collection_id"], "patches": row.get("patches", [])}
                      for row in ws._list("scenarios")],
        "source_collections": [{**basic(row), "captured_at": row.get("captured_at"), "entries": len(row["entries"])}
                               for row in sources
                               if not any(entry.get("metadata", {}).get("role") == "SCIENTIFIC_SETUP_SPECIFICATION"
                                          for entry in row["entries"])],
        "observations": [{**basic(row), "admitted_count": row["admitted_count"],
                          "context_count": row["context_count"], "metadata": row["metadata"]}
                         for row in ws._list("observations")],
        "setups": [{**basic(row), "created_at": row["created_at"], "review_id": row["review_id"],
                    "source_collection_id": row["source_collection_id"], "selection": row["selection"]}
                   for row in ws._list(KIND)],
    }


def verify_all(ws):
    result = []
    for row in ws._list(KIND):
        current = detail(ws, row["id"])
        selection = current["setup"]["selection"]
        ws.get_grid(selection["grid_id"])
        ws._get("profiles", selection["profile_id"])
        for key in [selection["baseline_scenario_id"], *selection["alternative_scenario_ids"]]:
            ws._get("scenarios", key)
        for key in selection["observation_ids"]:
            ws._get("observations", key)
        result.append({"setup_id": row["id"], "review_id": row["review_id"],
                       "specification_sha256": row["specification_sha256"]})
    return {"setups": result, "count": len(result)}
