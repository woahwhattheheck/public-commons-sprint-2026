"""Publish an immutable saved observation review as an ordinary scientific source.

The existing review/store engines select and interpret records. This producer
captures their exact result, keeps the complete original review archive and
exposes selected tables through the maintained observed-report composer.
"""
from __future__ import annotations

import argparse
from copy import deepcopy
from hashlib import sha256
from html import escape
import json
import os
from pathlib import Path, PurePosixPath
import tempfile
import zipfile

from .common import (atomic_bytes, atomic_json, describe_file, digest,
                     file_digest, held, identifier, now, read_json, verify_file)
from measurement_workspace.published_studies import PublishedStudyStore, TABLE_TITLES, _json_bytes
from measurement_workspace.study_reviews import PublishedStudyReviews, _binding, _id

SCHEMA = "upstate.published-review-report-source/v1"
RECIPE_SCHEMA = "upstate.observed-report/v1"
FOLDER = "published-review-report-sources"
EDITION = "saved-observation-review-20261013-v1"
IMPLEMENTATION = (
    "model/published_review_report_source.py", "model/common.py",
    "measurement_workspace/study_reviews.py",
    "measurement_workspace/published_studies.py",
    "measurement_workspace/observation_support.py",
    "measurement_workspace/source_observations.py",
    "measurement_workspace/study_context.py",
)


def _relative(value):
    if not isinstance(value, str) or "\\" in value or "\0" in value:
        raise ValueError("Use a complete original relative source path")
    path = PurePosixPath(value)
    if (path.is_absolute() or not path.parts or ".." in path.parts
            or path.as_posix() != value or any(":" in part for part in path.parts)):
        raise ValueError("A review source member must stay in its retained directory")
    return value


def _store(workspace):
    return PublishedStudyStore(workspace, workspace.root / "published_studies")


def _semantic_context(context):
    """Remove only the store's location-dependent manifest resolver path."""
    result = json.loads(_json_bytes(context))
    result["record"]["source_manifest"]["path"] = "sources.json"
    return result


def _implementations():
    application = Path(__file__).resolve().parents[1]
    return {name: (application / name, describe_file(application, application / name))
            for name in IMPLEMENTATION}


def _capture(workspace, review_id):
    review_id = _id(review_id)
    store = _store(workspace)
    reviews = PublishedStudyReviews(store)
    opened = reviews.get(review_id)
    review = opened["review"]
    original = reviews._path(review_id)
    raw = original.read_bytes()
    if json.loads(raw) != review:
        raise ValueError("The saved review changed while its source was previewed")
    context = _semantic_context(opened["context"])
    if _binding(context["record"]) != review["content"]["binding"]:
        raise ValueError("The review no longer names the same original study edition")
    implementations = _implementations()
    identity = {
        "schema": SCHEMA, "edition": EDITION, "workspace_id": workspace.project["id"],
        "review_id": review_id,
        "review": {"bytes": len(raw), "sha256": sha256(raw).hexdigest()},
        "binding": deepcopy(review["content"]["binding"]),
        "selection": deepcopy(review["content"]["selection"]),
        "interpretation_sha256": digest(context),
        "interpretation_matches_snapshot": opened["interpretation_matches_snapshot"],
        "implementation": {name: {"bytes": item["bytes"], "sha256": item["sha256"]}
                           for name, (_, item) in sorted(implementations.items())},
    }
    return store, reviews, review, raw, context, identity, implementations


def _counts(context):
    rows = context["observations"]["rows"]
    return {
        "selected_stations": len(context["selection"]["site_ids"]),
        "observation_records": len(rows),
        "observation_activities": len({(row.get("monitoring_location_id", row["site_id"]),
                                      row.get("project_id", ""), row["activity_id"]) for row in rows}),
        "observation_series": len(context["observations"]["series"]),
        "dated_context_records": len(context["dated_context"]["rows"]),
        "selected_flow_rows": len(context["dated_context"]["flow_rows"]),
        "selected_tables": {name: len(rows) for name, rows in context["tables"].items()},
    }


def preview(workspace, review_id):
    """Read the saved selection and its current interpretation without publishing."""
    _, _, review, _, context, identity, _ = _capture(workspace, review_id)
    key = digest(identity)
    return {"schema": SCHEMA, "id": key, "preview_id": key,
            "review_id": review["id"], "review_sha256": identity["review"]["sha256"],
            "title": review["content"]["title"], "selection": identity["selection"],
            "counts": _counts(context),
            "interpretation_matches_snapshot": identity["interpretation_matches_snapshot"],
            "interpretation_sha256": identity["interpretation_sha256"],
            "binding": identity["binding"], "implementation": identity["implementation"],
            "source_scope": "Exact saved review selection and current selected interpretation"}


def _verify_export(path, raw_review, context):
    """Validate the ordinary archive before adopting it or resuming its capture."""
    with zipfile.ZipFile(path) as archive:
        names = [item.filename for item in archive.infolist() if not item.is_dir()]
        if len(names) != len(set(names)) or any(_relative(name) != name for name in names):
            raise ValueError("The original review archive has duplicate or unsafe members")
        index = json.loads(archive.read("review-export.json"))
        if index.get("schema") != "upstate.published-study-review-export/v1":
            raise ValueError("Choose the complete original saved-review export")
        declared = {item["path"]: item for item in index["files"]}
        if (len(declared) != len(index["files"])
                or set(names) != set(declared) | {"review-export.json"}):
            raise ValueError("The saved-review export lost its complete member inventory")
        for name, item in declared.items():
            h, size = sha256(), 0
            with archive.open(name) as source:
                for chunk in iter(lambda: source.read(1024 * 1024), b""):
                    h.update(chunk)
                    size += len(chunk)
            if size != item["bytes"] or h.hexdigest() != item["sha256"]:
                raise ValueError("The original review export changed: " + name)
        if archive.read("review.json") != raw_review:
            raise ValueError("The review export names another original saved review")
        if _semantic_context(json.loads(archive.read("selected/selected-context.json"))) != context:
            raise ValueError("The review interpretation changed during its original export")
        if index["review_id"] != json.loads(raw_review)["id"]:
            raise ValueError("The review archive identity differs")
        return index


def _retain_export(directory, reviews, review_id, raw_review, context):
    archive = directory / "original-review.zip"
    # The original exporter uses timestamps. Capture it once; retries adopt the
    # completed verified archive instead of rebuilding different ZIP bytes.
    if not archive.exists():
        with tempfile.TemporaryDirectory(prefix=".review-export-", dir=directory) as temporary:
            staged = Path(temporary)
            reviews.export(review_id, staged)
            candidate = staged / "saved-review.zip"
            _verify_export(candidate, raw_review, context)
            os.replace(candidate, archive)
    index = _verify_export(archive, raw_review, context)
    checkpoint = {"schema": "upstate.published-review-export-capture/v1",
                  "review_id": review_id, "archive": describe_file(directory, archive),
                  "original_export_index": index}
    atomic_json(directory / "export-capture.json", checkpoint, immutable=True)
    return checkpoint


def _cell(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True, allow_nan=False)
    return value


def _table(columns, rows):
    return {"kind": "table", "columns": columns,
            "rows": [[_cell(value) for value in row] for row in rows]}


def _columns(rows, names):
    return [[row.get(name) for name in names] for row in rows]


def _selected_files(directory, archive_path, context):
    """Keep exact original-cell exports under names without full-study inference."""
    index = []
    with zipfile.ZipFile(archive_path) as archive:
        names = sorted(name for name in archive.namelist()
                       if name.startswith("selected/") and name.endswith(".csv")
                       and not name.startswith("selected/original-sources/"))
        for number, original in enumerate(names):
            raw = archive.read(original)
            name = "selected-records/%04d.csv" % number
            atomic_bytes(directory / name, raw, immutable=True)
            index.append({"path": name, "original_export_path": original,
                          "bytes": len(raw), "sha256": sha256(raw).hexdigest()})
        selector = "selected/selected-activities/index.json"
        if selector in archive.namelist():
            atomic_bytes(directory / "selected-records/original-row-index.json",
                         archive.read(selector), immutable=True)
    atomic_json(directory / "selected-records/index.json",
                {"schema": "upstate.review-selected-record-files/v1",
                 "selection": context["selection"], "files": index,
                 "original_review_archive": "original-review.zip",
                 "scope": "Unchanged CSV bytes from the original saved-review selected export"},
                immutable=True)
    return index


def _sections(review, context, counts, csv_index):
    content = review["content"]
    selection = context["selection"]
    observations = context["observations"]
    dated = context["dated_context"]
    rows = observations["rows"]
    result = [["Saved review and selected scientific scope", [
        content["notes"] or "The saved review contains no additional author notes.",
        _table(["Selection", "Retained value"], [
            ["Review title", content["title"]], ["Original study", content["study_title"]],
            ["Saved review", review["id"]], ["Review saved at", review["saved_at"]],
            ["Original study edition", content["binding"]["version_id"]],
            ["Stations", ", ".join(selection["site_ids"])],
            ["Parameters", ", ".join(selection["parameters"]) or "All available"],
            ["Depth strata", ", ".join(selection["strata"]) or "All available"],
            ["Year", selection["year"] if selection["year"] is not None else "All available"],
            ["Months", ", ".join(map(str, selection["months"])) or "All available"],
            ["Original review view", content["table"]],
            ["Selected original result rows", counts["observation_records"]],
            ["Distinct station/project/activity combinations", counts["observation_activities"]],
        ]),
        "These tables use the existing Published studies interpretation of this exact saved selection. "
        "The selected context JSON preserves every native field, original row selector, method, unit, qualifier and comment.",
        observations.get("temporal_support", ""),
        "Calendar filter support: " + _cell(context["temporal_support"]),
    ]]]
    if content["coverage"] != context["coverage"] or content["temporal_support"] != context["temporal_support"]:
        result.append(["Saved snapshot and current interpretation", [
            "The original review remains unchanged. Its saved coverage or temporal-support snapshot differs "
            "from the current selected interpretation captured by this source edition.",
            _table(["Snapshot", "Coverage"], [
                ["At review save", content["coverage"]], ["This report source", context["coverage"]]]),
        ]])
    series = observations["series"]
    if series:
        result.append(["Selected observation series and analytical support", [
            "Series retain their original station, parameter, project, activity type, fraction, method and unit/basis. "
            "The existing engine supplies each statistic; this report adds no pooling or substituted measurements.",
            _table(["Station", "Parameter", "Project / activity type", "Method / fraction",
                    "Unit", "Records / activities", "Quantified mean", "Sample SD"],
                   [[r["site_id"], r["parameter"], r.get("project_id", "") + " / " + r.get("activity_type", ""),
                     (r.get("method_authority", "") + " " + r.get("method_id", "") + " / "
                      + r.get("sample_fraction", "")).strip(), r.get("unit", ""),
                     str(r["record_count"]) + " / " + str(r["activity_count"]),
                     r.get("mean"), r.get("sample_sd")] for r in series]),
            _table(["Station / parameter", "Support / series", "Censoring and source basis"],
                   [[r["site_id"] + " / " + r["parameter"],
                     r.get("sample_support", "") + " / " + r.get("series_key", ""),
                     r.get("basis", "")] for r in series]),
            "Quantified means follow the existing engine's inclusion rules. Original Information Only, "
            "result, activity and laboratory comments remain visible below and in the complete original-cell CSVs.",
        ]])
        supported = [r for r in series if r.get("observation_support")]
        if supported:
            result.append(["Selected concentration interval support", [
                "The original support calculation retains detection/quantitation boundaries and the actual unit. "
                "A missing or open bound stays missing or open; no substitute value is introduced.",
                _table(["Station / parameter", "Method / series", "Unit", "Records",
                        "Mean lower", "Mean upper", "Upper inclusive", "Complete support", "Basis"],
                       [[r["site_id"] + " / " + r["parameter"], r.get("series_key", ""),
                         r["observation_support"].get("unit"), r["observation_support"].get("record_count"),
                         r["observation_support"].get("mean_lower"), r["observation_support"].get("mean_upper"),
                         r["observation_support"].get("mean_upper_inclusive"),
                         r["observation_support"].get("complete_interval_support"),
                         r["observation_support"].get("basis")] for r in supported]),
            ]])
    if rows:
        result.append(["Selected original activity chronology", [
            _table(["Original record", "Station", "Date / local time", "Parameter",
                    "Original result", "Unit", "Detection condition / direction", "Limit / unit"],
                   [[r["record_id"], r["site_id"], r["date"] + " " + r.get("local_time", ""),
                     r.get("parameter_original", r["parameter"]), r.get("source_value_token", r.get("value")),
                     r.get("unit", ""), r.get("detection_condition", "") + " / " + r.get("censor_direction", ""),
                     str(_cell(r.get("detection_limit"))) + " " + r.get("detection_limit_unit", "")] for r in rows]),
        ]])
        result.append(["Selected original methods, activity identities and comments", [
            _table(["Original record", "Original activity / project", "Method",
                    "Result comment", "Activity comment", "Laboratory comment"],
                   [[r["record_id"], r["activity_id"] + " / " + r.get("project_id", ""),
                     r.get("method_authority", "") + " " + r.get("method_id", ""),
                     r.get("result_comment", ""), r.get("activity_comment", ""),
                     r.get("laboratory_comment", "")] for r in rows]),
            _table(["Original record", "Original source path", "Original CSV row", "Activity type / fraction", "Result basis"],
                   [[r["record_id"], r["source_file"], r["source_csv_row"],
                     r.get("activity_type", "") + " / " + r.get("sample_fraction", ""),
                     "; ".join(str(r.get(k, "")) for k in ("result_value_type", "result_weight_basis",
                               "result_time_basis", "result_temperature_basis", "result_particle_size_basis"))]
                    for r in rows]),
        ]])
    table_fields = {
        "stations": ("site_id", "latitude", "longitude", "datum", "epsg"),
        "seasonal": ("site_id", "stratum", "parameter", "units", "mean", "sd", "n", "statistic_basis"),
        "surface_ranges": ("site_id", "depth_m", "period_start", "period_end"),
        "monthly_do": ("site_id", "year", "month", "units", "avg_daily_minimum", "avg_daily_maximum", "n_days"),
        "monthly_ph": ("site_id", "year", "month", "units", "avg_daily_minimum", "avg_daily_maximum", "n_days"),
        "permits": ("npdes_permit_id", "report_facility_name", "source_pdf_page"),
    }
    for name, native in context["tables"].items():
        if not native:
            continue
        fields = table_fields.get(name) or tuple(k for k in native[0] if k not in ("raw_cells", "source_selector"))
        result.append(["Selected published table — " + TABLE_TITLES.get(name, name), [
            "These are the original published table values at the selected table support. "
            "Published seasonal statistics retain their own analytical cohort and are distinct from selected activity summaries.",
            _table([key.replace("_", " ") for key in fields], _columns(native, fields)),
        ]])
    if context["surface_parameter_ranges"]:
        native = context["surface_parameter_ranges"]
        fields = tuple(k for k in native[0] if k not in ("raw_cells", "source_selector"))
        result.append(["Selected published surface parameter ranges", [
            _table([key.replace("_", " ") for key in fields], _columns(native, fields))]] )
    result.append(["Original calendar, wider source context and interpretation notes", [
        *dated.get("selection_notes", []),
        "The dated-context rows and original coverage follow the existing study's explicitly documented filter support. "
        "The retained original calendar, study summary, original figures and full reports keep their complete source scope; "
        "they are not recast as figures of this selected review.",
        _table(["Context", "Retained count"], [
            ["Selected activity dates", len({r["date"] for r in rows})],
            ["Native dated-context rows", len(dated["rows"])],
            ["Native selected-date flow context rows", len(dated["flow_rows"])],
            ["Original source calendar rows", len(dated["calendar"])],
        ]),
        "Original source notes: " + _cell(context["source_notes"]),
        {"kind": "links", "items": [
            {"title": "Complete current selected interpretation and original selectors", "path": "selected-context.json"},
            {"title": "Exact saved review and its original coverage snapshot", "path": "review.json"},
            {"title": "Original full review package: selected report, original figures, source records and editable study", "path": "original-review.zip"},
            {"title": "Original-cell selected CSV inventory and source path mapping", "path": "selected-records/index.json"},
        ]},
    ]])
    result.append(["Selected original-cell downloads", [
        "Every listed CSV retains unchanged bytes from the existing saved-review export. The inventory records "
        "its original export path; the complete review archive preserves all original relative HTML/source links.",
        {"kind": "links", "items": [{"title": item["original_export_path"], "path": item["path"]} for item in csv_index]},
    ]])
    return result


def _html(title, sections):
    parts = ['<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
             "<title>" + escape(title) + "</title>",
             "<style>body{font:14px/1.5 system-ui;max-width:1280px;margin:32px auto;padding:0 24px;color:#202327;background:white}h1{font-size:28px}h2{font-size:20px;margin-top:32px}a{color:inherit}table{border-collapse:collapse;width:100%;font-size:11px}th,td{border:1px solid #ccc;padding:6px;text-align:left;vertical-align:top;overflow-wrap:anywhere}th{background:#eee}p{overflow-wrap:anywhere}@media print{body{margin:8mm;padding:0}thead{display:table-header-group}tr{break-inside:avoid}table{font-size:8px}}</style>",
             "<h1>" + escape(title) + "</h1>"]
    for heading, blocks in sections:
        parts.append("<section><h2>" + escape(heading) + "</h2>")
        for block in blocks:
            if isinstance(block, str):
                parts.append("<p>" + escape(block) + "</p>")
            elif block["kind"] == "table":
                parts.append("<table><thead><tr>" + "".join("<th>" + escape(str(v)) + "</th>" for v in block["columns"]) + "</tr></thead><tbody>")
                for row in block["rows"]:
                    parts.append("<tr>" + "".join("<td>" + escape(str(v)) + "</td>" for v in row) + "</tr>")
                parts.append("</tbody></table>")
            else:
                parts.append("<ul>" + "".join('<li><a href="' + escape(item["path"], quote=True) + '">' + escape(item["title"]) + "</a></li>" for item in block["items"]) + "</ul>")
        parts.append("</section>")
    return ("".join(parts) + "</html>\n").encode("utf-8")


def _summary(result):
    return {key: deepcopy(result[key]) for key in (
        "schema", "id", "review_id", "title", "state", "created_at", "selection",
        "counts", "source_choice", "interpretation_matches_snapshot", "lineage")}


def _record(workspace, key):
    key = identifier(key)
    directory = workspace.root / FOLDER / key
    result = read_json(directory / "result.json")
    if (result.get("schema") != SCHEMA or result.get("state") != "complete"
            or result.get("id") != key or digest(result.get("identity")) != key
            or result.get("workspace_id") != workspace.project["id"]
            or result.get("review_id") != result["identity"]["review_id"]
            or result.get("selection") != result["identity"]["selection"]):
        raise ValueError("Choose a complete review report source from this Workspace")
    return directory, result


def inspect(workspace, key):
    """Open this exact completed edition without recomputing today's selection."""
    directory, result = _record(workspace, key)
    for item in result["files"].values():
        verify_file(directory, item)
    identity = read_json(directory / "identity.json")
    review = read_json(directory / "review.json")
    PublishedStudyReviews._validate(review, result["review_id"])
    if (identity != result["identity"] or describe_file(directory, directory / "review.json")["sha256"]
            != identity["review"]["sha256"]
            or digest(read_json(directory / "selected-context.json")) != identity["interpretation_sha256"]
            or review["content"]["binding"] != identity["binding"]):
        raise ValueError("The retained review source changed its selected interpretation")
    from .observed_context import bind
    binding = bind(workspace, {"source_roles": {"OBSERVED_CONTEXT": result["source_choice"]}})
    if binding != result["observed_context_binding"]:
        raise ValueError("The retained scientific source differs from this review edition")
    return {**result, "files": {**result["files"],
            "result": describe_file(directory, directory / "result.json")}}


get = inspect


def catalog(workspace, *, review_id=None):
    if review_id is not None:
        _id(review_id)
    items = []
    for path in sorted((workspace.root / FOLDER).glob("*/result.json")):
        _, result = _record(workspace, path.parent.name)
        if review_id is None or result["review_id"] == review_id:
            items.append(_summary(result))
    return {"schema": "upstate.published-review-report-source-catalog/v1",
            "items": sorted(items, key=lambda item: (item["created_at"], item["id"]), reverse=True)}


def prepare(workspace, review_id, *, expected_preview_id=None, expected_review_sha256=None):
    """Capture one current interpretation; retry its original export unchanged."""
    store, reviews, review, raw, context, identity, implementations = _capture(workspace, review_id)
    key = digest(identity)
    if expected_preview_id is not None and identifier(expected_preview_id) != key:
        raise ValueError("The review interpretation changed; preview its current source edition again")
    if expected_review_sha256 is not None and identifier(expected_review_sha256) != identity["review"]["sha256"]:
        raise ValueError("The original saved review changed after source selection")
    directory = workspace.root / FOLDER / key
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".report-source.lock", blocking=False):
        if (directory / "result.json").exists():
            return inspect(workspace, key)
        atomic_json(directory / "identity.json", identity, immutable=True)
        atomic_bytes(directory / "review.json", raw, immutable=True)
        atomic_bytes(directory / "selected-context.json", _json_bytes(context), immutable=True)
        for name, (path, item) in implementations.items():
            original = path.read_bytes()
            if len(original) != item["bytes"] or sha256(original).hexdigest() != item["sha256"]:
                raise ValueError("The selected interpretation implementation changed: " + name)
            atomic_bytes(directory / "implementation" / name, original, immutable=True)
        _retain_export(directory, reviews, review_id, raw, context)
        # Read the source record and manifest exactly, independently of the
        # context resolver's location-dependent manifest path.
        binding = identity["binding"]
        version = store._version_root(binding["study_id"], binding["version_id"])
        for filename in ("record.json", "sources.json"):
            atomic_bytes(directory / ("original-" + filename), (version / filename).read_bytes(), immutable=True)
        original_record = read_json(directory / "original-record.json")
        if _binding(original_record) != binding:
            raise ValueError("The original published source registration changed during capture")
        if file_digest(directory / "original-sources.json") != binding["source_manifest_sha256"]:
            raise ValueError("The original source manifest changed during capture")
        csv_index = _selected_files(directory, directory / "original-review.zip", context)
        counts = _counts(context)
        sections = _sections(review, context, counts, csv_index)
        atomic_bytes(directory / "index.html", _html(review["content"]["title"], sections), immutable=True)
        lineage = {"schema": "upstate.published-review-report-lineage/v1", "report_id": key,
                   "source_project_id": workspace.project["id"], "review_id": review_id,
                   "review_sha256": identity["review"]["sha256"], "binding": binding,
                   "selection": identity["selection"], "interpretation_sha256": identity["interpretation_sha256"],
                   "interpretation_matches_snapshot": identity["interpretation_matches_snapshot"],
                   "scope": "saved_review_selected_interpretation",
                   "full_source_scope": "Original review ZIP retains complete study records, original figures and reports"}
        atomic_json(directory / "lineage.json", lineage, immutable=True)
        paths = ["identity.json", "review.json", "selected-context.json", "original-review.zip",
                 "export-capture.json", "original-record.json", "original-sources.json",
                 "lineage.json", "index.html"]
        paths += ["implementation/" + name for name in sorted(implementations)]
        paths += [path.relative_to(directory).as_posix()
                  for path in sorted((directory / "selected-records").rglob("*")) if path.is_file()]
        descriptors = [describe_file(directory, directory / name) for name in sorted(paths)]
        recipe = {"schema": RECIPE_SCHEMA, "edition": EDITION,
                  "title": review["content"]["title"],
                  "source_scope": "Exact saved review selection; complete original context is separately labeled",
                  "inputs": descriptors, "sections": sections,
                  "source_links": ["index.html", "review.json", "selected-context.json", "lineage.json",
                                   "original-review.zip", "selected-records/index.json"],
                  "metadata": {"published_review_report_id": key, "review_id": review_id,
                               "report_schema": RECIPE_SCHEMA, "selection": identity["selection"]}}
        atomic_json(directory / "observed-report.json", recipe, immutable=True)
        source_id = "published-review-" + key
        manifest = {"schema": "upstate.sources/v1", "title": review["content"]["title"],
                    "captured_at": review["saved_at"],
                    "entries": [{"id": source_id, "kind": "document", "title": review["content"]["title"],
                                 "path": "observed-report.json",
                                 "uri": "urn:upstate:published-review-report:" + key,
                                 "vintage": review["saved_at"].split("T")[0],
                                 "report_schema": RECIPE_SCHEMA,
                                 "metadata": {"published_review_report_id": key, "review_id": review_id,
                                              "source_project_id": workspace.project["id"],
                                              "report_schema": RECIPE_SCHEMA,
                                              "scientific_scope": "saved_review_selected_interpretation"},
                                 "companions": descriptors}]}
        atomic_json(directory / "sources.json", manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        choice = {"source_collection_id": collection["id"], "source_id": source_id}
        from .observed_context import bind
        observed = bind(workspace, {"source_roles": {"OBSERVED_CONTEXT": choice}})
        files = {"member_%04d" % number: item for number, item in enumerate(descriptors)
                 if item["path"] not in ("index.html", "original-review.zip")}
        files.update({name: describe_file(directory, directory / filename) for name, filename in (
            ("report", "index.html"), ("archive", "original-review.zip"),
            ("recipe", "observed-report.json"), ("manifest", "sources.json"))})
        result = {"schema": SCHEMA, "id": key, "identity": identity, "state": "complete",
                  "workspace_id": workspace.project["id"], "review_id": review_id,
                  "review_sha256": identity["review"]["sha256"], "title": review["content"]["title"],
                  "created_at": now(), "selection": identity["selection"], "counts": counts,
                  "interpretation_matches_snapshot": identity["interpretation_matches_snapshot"],
                  "lineage": lineage, "source_choice": choice, "source_collection_id": collection["id"],
                  "observed_context_binding": observed, "files": files}
        atomic_json(directory / "result.json", result, immutable=True)
        return inspect(workspace, key)


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("preview", "prepare"):
        child = commands.add_parser(name)
        child.add_argument("review_id")
        if name == "prepare":
            child.add_argument("--expected-preview-id")
            child.add_argument("--expected-review-sha256")
    child = commands.add_parser("inspect")
    child.add_argument("id")
    child = commands.add_parser("catalog")
    child.add_argument("--review-id")
    args = parser.parse_args(argv)
    from .workspace import Workspace
    workspace = Workspace(args.workspace)
    if args.command == "prepare":
        # The operator holds this same ordinary lock before invoking prepare.
        with held(workspace.root / ".workspace.lock", blocking=False):
            result = prepare(workspace, args.review_id, expected_preview_id=args.expected_preview_id,
                             expected_review_sha256=args.expected_review_sha256)
    elif args.command == "preview":
        result = preview(workspace, args.review_id)
    elif args.command == "inspect":
        result = inspect(workspace, args.id)
    else:
        result = catalog(workspace, review_id=args.review_id)
    print(json.dumps(result, ensure_ascii=False, indent=2, allow_nan=False))


if __name__ == "__main__":
    main()
