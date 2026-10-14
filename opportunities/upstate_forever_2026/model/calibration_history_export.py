"""Portable human-readable selected-profile history for Calibration."""
from __future__ import annotations

import csv
import html
import io
import json
import os
import hashlib
import tempfile
import zipfile

from model import calibration_history as science
from model import portable_fs as fs
from model.verified_files import source_identity
from model.common import (atomic_bytes, atomic_json, describe_file, file_digest,
                          held, identifier, read_json, relative_file, verify_file)

TABLES = {
    "evaluations": ("evaluation_order", "title", "selected_profile_title", "selected_models",
                    "objective_score", "training_groups", "validation_groups", "complete_units",
                    "reference_units", "created_at", "state", "calibration_id", "plan_id",
                    "selected_run_id", "selected_profile_id", "reference_csv_sha256",
                    "selected_execution_fingerprint", "native_version_labels"),
    "pair_summaries": ("earlier_title", "parameter", "units", "earlier_partition", "current_partition",
                       "matched_catchments", "earlier_rmse", "current_rmse", "rmse_change",
                       "earlier_mean_bias", "current_mean_bias", "smaller_absolute_error",
                       "equal_absolute_error", "larger_absolute_error", "external_assumption_changes",
                       "catchment_ids", "earlier_calibration_id", "current_calibration_id"),
    "paired_changes": ("earlier_title", "current_title", "catchment_id", "parameter", "units", "state",
                       "earlier_partition", "current_partition", "partition_changed",
                       "observed_annual_mass", "earlier_modeled", "current_modeled",
                       "earlier_residual", "current_residual", "earlier_absolute_error", "current_absolute_error",
                       "modeled_change", "absolute_error_change", "native_load_change", "external_load_change",
                       "external_load_assumptions_changed", "changed_reference_fields", "observation_record_ids",
                       "earlier_run_id", "current_run_id", "reference_key", "earlier_issues", "current_issues"),
    "reference_rows": ("evaluation_order", "title", "catchment_id", "station_ids", "parameter", "units",
                       "partition", "group_id", "state", "observed_annual_mass", "native_annual_mass",
                       "delivered_external_annual_mass", "predicted_annual_mass", "residual", "absolute_error",
                       "observation_record_ids", "periods", "temporal_weighting", "reference_methods",
                       "reference_csv_sha256", "catchment_source_sha256", "external_load_sources",
                       "issues", "calibration_id", "plan_id", "run_id", "profile_id", "reference_key"),
}
TITLES = {
    "evaluations": "Saved evaluations", "pair_summaries": "Physical errors on common reference support",
    "paired_changes": "Individual catchment changes and unmatched references",
    "reference_rows": "All original selected-profile predictions",
}
DISPLAY_COLUMNS = {
    "evaluations": (("evaluation_order", "Order"), ("title", "Evaluation"),
                    ("selected_profile_title", "Selected profile"), ("objective_score", "Own training loss"),
                    ("training_groups", "Training groups"), ("validation_groups", "Validation groups"),
                    ("complete_units", "Complete reference units")),
    "pair_summaries": (("earlier_title", "Earlier evaluation"), ("parameter", "Constituent"),
                       ("units", "Annual-load unit"), ("earlier_partition", "Earlier partition"),
                       ("current_partition", "Current partition"), ("matched_catchments", "Common catchments"),
                       ("earlier_rmse", "Earlier RMSE"), ("current_rmse", "Current RMSE"),
                       ("rmse_change", "RMSE change"), ("external_assumption_changes", "Changed external inputs")),
    "paired_changes": (("earlier_title", "Earlier evaluation"), ("catchment_id", "Catchment"),
                       ("parameter", "Constituent"), ("units", "Annual-load unit"), ("state", "Comparison"),
                       ("earlier_partition", "Earlier partition"), ("current_partition", "Current partition"),
                       ("observed_annual_mass", "Observed"), ("earlier_modeled", "Earlier modeled"),
                       ("current_modeled", "Current modeled"), ("absolute_error_change", "Absolute error change"),
                       ("native_load_change", "Native-load change"), ("external_load_change", "External-load change"),
                       ("changed_reference_fields", "Changed reference support")),
    "reference_rows": (("title", "Evaluation"), ("catchment_id", "Catchment"), ("parameter", "Constituent"),
                       ("units", "Annual-load unit"), ("partition", "Partition"), ("state", "Prediction"),
                       ("observed_annual_mass", "Observed"), ("native_annual_mass", "Native modeled"),
                       ("delivered_external_annual_mass", "Delivered external"),
                       ("predicted_annual_mass", "Total modeled"), ("residual", "Signed residual")),
}


def _cell(value):
    if isinstance(value, (dict, list)):
        return json.dumps(value, ensure_ascii=False, sort_keys=True)
    return value


def _csv(fields, rows):
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=fields)
    writer.writeheader()
    for row in rows:
        values = {}
        for key in fields:
            value = _cell(row.get(key))
            if isinstance(value, str) and value.lstrip().startswith(("=", "+", "-", "@")):
                value = "'" + value
            values[key] = value
        writer.writerow(values)
    return stream.getvalue().encode("utf-8-sig")


def _display(value):
    if value is None:
        return "—"
    if type(value) is bool:
        return "Yes" if value else "No"
    if type(value) in (float, int):
        return format(value, ".8g")
    if isinstance(value, list):
        return "; ".join(_display(item) for item in value)
    if isinstance(value, dict):
        return "; ".join(str(key).replace("_", " ") + ": " + _display(item) for key, item in value.items())
    labels = {"calibration": "Training", "validation": "Validation",
              "paired": "Same reference support", "incomplete_prediction": "Incomplete native prediction",
              "changed_reference_support": "Reference support changed", "new_reference_support": "New reference support",
              "earlier_reference_only": "Earlier reference only", "metric_tonnes/year": "metric tonnes/year"}
    return labels.get(str(value), str(value))


def _table(columns, rows):
    return ('<div class="scroll"><table><thead><tr>'
            + "".join("<th>" + html.escape(label) + "</th>" for unused, label in columns)
            + "</tr></thead><tbody>"
            + "".join("<tr>" + "".join("<td>" + html.escape(_display(row.get(key))) + "</td>"
                                      for key, unused in columns) + "</tr>" for row in rows)
            + "</tbody></table></div>")


def render(view):
    sections = []
    for name, title in TITLES.items():
        rows = view[name]
        sections.append('<section id="' + name + '"><h2>' + title
                        + '</h2><p><a href="' + name + '.csv">Download all '
                        + str(len(rows)) + ' rows as CSV</a></p>'
                        + (_table(DISPLAY_COLUMNS[name], rows) if rows else
                           "<p>No rows apply to this retained evaluation chain.</p>") + "</section>")
    records = "".join(
        '<li>' + html.escape(row["title"]) + ' — <a href="original/' + row["calibration_id"]
        + '/report.json">Result</a>, <a href="original/' + row["calibration_id"]
        + '/plan.json">Selection</a>, <a href="original/' + row["calibration_id"]
        + '/observations-original.csv">Original observation table</a></li>'
        for row in view["evaluations"])
    return ('<!doctype html><html lang="en"><head><meta charset="utf-8">'
            '<meta name="viewport" content="width=device-width,initial-scale=1"><title>'
            + html.escape(view["title"]) + '</title><style>'
            'body{font:15px system-ui,sans-serif;color:#202020;background:#fff;max-width:1440px;'
            'margin:auto;padding:28px}h1{font-size:28px}h2{font-size:21px}p,li{line-height:1.55}'
            'a{color:inherit;text-decoration:underline}section{padding:22px 0;border-top:1px solid #bbb}'
            'nav{display:flex;flex-wrap:wrap;gap:16px;margin:24px 0}.scroll{overflow:auto}'
            'table{border-collapse:collapse;width:100%}td,th{text-align:left;vertical-align:top;'
            'border-bottom:1px solid #ccc;padding:9px;font-variant-numeric:tabular-nums}'
            'th{background:#eee}td{overflow-wrap:anywhere}footer{font-size:12px;overflow-wrap:anywhere}'
            '@media(max-width:520px){body{padding:14px}h1{font-size:23px}}'
            '@media print{body{padding:0;font-size:9px}nav{display:none}.scroll{overflow:visible}'
            'table{font-size:8px}td,th{padding:4px}thead{display:table-header-group}tr{break-inside:avoid}}'
            '</style></head><body><header><p>TOKENJUNKIELABS · SCIENTIFIC WORKBENCH</p><h1>'
            + html.escape(view["title"]) + '</h1><p>Selected native profiles on the original annual references, '
            'in their retained evaluation order.</p><p>Negative physical-error changes mean smaller errors '
            'on identical reference support. Each training objective keeps its original design.</p></header>'
            '<nav>' + "".join('<a href="#' + key + '">' + title + '</a>' for key, title in TITLES.items())
            + '</nav>' + "".join(sections) + '<section><h2>Scientific interpretation</h2><ul>'
            + "".join("<li>" + html.escape(note) + "</li>" for note in view["notes"])
            + '</ul></section><section><h2>Original data and selections</h2><ul>' + records
            + '</ul><p><a href="history.json">Complete comparison record</a> · '
            '<a href="manifest.json">Complete retained-file inventory</a></p></section><footer>'
            + html.escape(view["id"]) + '</footer></body></html>')


def _copy(workspace, descriptor, destination):
    """Receive original Calibration history members as independent immutable files."""
    actual = {"path": descriptor.get("path", descriptor.get("object")),
              "bytes": descriptor["bytes"], "sha256": descriptor["sha256"]}
    source = relative_file(workspace.root, actual["path"])
    destination = fs.native_path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    expected = {"path": destination.name, "bytes": actual["bytes"],
                "sha256": actual["sha256"]}
    if destination.exists() or destination.is_symlink():
        verify_file(destination.parent, expected)
        return
    pending = None
    try:
        with tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".history-source-", delete=False) as output:
            pending = fs.native_path(output.name)
            with os.fdopen(fs.open_file(source, os.O_RDONLY), "rb") as incoming:
                checksum, size, unused_identity = source_identity(
                    incoming, source, "Original Calibration history source", output=output)
            output.flush()
            os.fsync(output.fileno())
        if (size, checksum) != (actual["bytes"], actual["sha256"]):
            raise ValueError("An original Calibration source differs from its retained identity")
        try:
            fs.publish_file(pending, destination)
        except FileExistsError:
            verify_file(destination.parent, expected)
        fs.sync_directory(destination.parent)
        verify_file(destination.parent, expected)
    finally:
        if pending is not None:
            pending.unlink(missing_ok=True)


def _member(value):
    return fs.relative_name(value, windows=True)

def directory(workspace, view):
    return fs.native_path(workspace.root / "calibration-history-exports" / identifier(view["id"]))


def _saved_archive(path, expected):
    """Reuse old original ZIP editions only if all members still match."""
    with zipfile.ZipFile(fs.native_path(path)) as package:
        names = package.namelist()
        if len(names) != len(expected) or set(names) != set(expected):
            raise ValueError("The retained Calibration history archive has another member inventory")
        for name, descriptor in sorted(expected.items()):
            checksum, size = hashlib.sha256(), 0
            with package.open(name) as stream:
                for block in iter(lambda: stream.read(1024 * 1024), b""):
                    checksum.update(block)
                    size += len(block)
            if (size, checksum.hexdigest()) != (descriptor["bytes"], descriptor["sha256"]):
                raise ValueError("The retained Calibration history archive changed: " + name)


def export(workspace, report_id):
    view = science.inspect(workspace, report_id)
    root = directory(workspace, view)
    root.mkdir(parents=True, exist_ok=True)
    with held(root / ".history.lock", blocking=False):
        manifest_path, archive_record = root / "manifest.json", root / "archive.json"
        if manifest_path.exists() and archive_record.exists():
            manifest = read_json(manifest_path)
            if manifest.get("history_id") != view["id"] or manifest.get("workspace_id") != workspace.project["id"]:
                raise ValueError("The retained history export belongs to another evaluation")
            for item in manifest["files"].values():
                verify_file(root, item)
            archive = read_json(archive_record)
            verify_file(root, archive)
            return {"history_id": view["id"], "report_id": report_id, "plan_id": view["current_plan_id"],
                    "files": manifest["files"], "archive": archive}
        names = {"history.json", "index.html", *(name + ".csv" for name in TABLES)}
        atomic_json(root / "history.json", view, immutable=True)
        atomic_bytes(root / "index.html", render(view).encode("utf-8"), immutable=True)
        for name, fields in TABLES.items():
            atomic_bytes(root / (name + ".csv"), _csv(fields, view[name]), immutable=True)
        for report, plan, spec in science.lineage(workspace, report_id):
            prefix = "original/" + identifier(report["id"]) + "/"
            observed_id = identifier(plan["selection"]["observation_id"])
            records = [("calibrations", report["id"], "report.json"),
                       ("calibration-plans", plan["id"], "plan.json"),
                       ("observations", observed_id, "observations.json")]
            if spec:
                records.append(("experiment-specs", spec["id"], "parameter-study.json"))
            if report.get("selected_profile_id"):
                records.append(("profiles", identifier(report["selected_profile_id"]), "selected-profile.json"))
            for kind, key, filename in records:
                workspace._get(kind, key)
                source = workspace.root / kind / (key + ".json")
                target = prefix + filename
                _copy(workspace, describe_file(workspace.root, source), root / target)
                names.add(target)
            observed = workspace._get("observations", observed_id)
            target = prefix + "observations-original.csv"
            _copy(workspace, observed["original"], root / target)
            names.add(target)
            choice = plan["selection"]["catchments"]
            unused_path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
            collection = workspace._get("sources", choice["source_collection_id"])
            target = prefix + "catchments/source-entry.json"
            atomic_json(root / target, entry, immutable=True)
            names.add(target)
            target = prefix + "catchments/original-manifest.json"
            _copy(workspace, collection["original_manifest"], root / target)
            names.add(target)
            member_names = set()
            for item in [entry["body"], *entry.get("companions", [])]:
                name = _member(item.get("view_path", item["filename"]))
                if name in member_names:
                    raise ValueError("The original catchment repeats an exported source member")
                member_names.add(name)
                target = prefix + "catchments/members/" + name
                _copy(workspace, item, root / target)
                names.add(target)
        fs.validate_members([*names, "manifest.json", "archive.json",
                             "selected-profile-history.zip"], portable=True)
        files = {name: describe_file(root, root / name) for name in sorted(names)}
        manifest = {"schema": "upstate.calibration-history-export/v1", "history_id": view["id"],
                    "workspace_id": workspace.project["id"], "report_id": report_id,
                    "title": view["title"], "files": files,
                    "reading": "Open index.html. CSVs retain complete rows; original/ retains each source and selection. "
                               "Use the native selected Study for an editable application project."}
        atomic_json(manifest_path, manifest, immutable=True)
        archive_path = root / "selected-profile-history.zip"
        archived = {**files, "manifest.json": describe_file(root, manifest_path)}
        if archive_path.exists() or archive_path.is_symlink():
            # Keep the original published ZIP if an earlier export crashed
            # before recording archive.json; verify its complete member set.
            _saved_archive(archive_path, archived)
        else:
            pending = None
            try:
                fd, name = tempfile.mkstemp(prefix=".history-package-", suffix=".zip", dir=root)
                pending = fs.native_path(name)
                with os.fdopen(fd, "w+b") as stream:
                    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED,
                                         compresslevel=6, allowZip64=True) as package:
                        for member in sorted(archived):
                            package.write(fs.native_path(root / member), member)
                    stream.flush()
                    os.fsync(stream.fileno())
                _saved_archive(pending, archived)
                try:
                    fs.publish_file(pending, archive_path)
                except FileExistsError:
                    _saved_archive(archive_path, archived)
                fs.sync_directory(root)
            finally:
                if pending is not None:
                    pending.unlink(missing_ok=True)
        archive_item = describe_file(root, archive_path)
        atomic_json(archive_record, archive_item, immutable=True)
        return {"history_id": view["id"], "report_id": report_id, "plan_id": view["current_plan_id"],
                "files": files, "archive": archive_item}


def downloads(operator, workspace_key, view):
    workspace = operator.ws(workspace_key)
    root = directory(workspace, view)
    if not (root / "manifest.json").exists() or not (root / "archive.json").exists():
        return []
    manifest = read_json(root / "manifest.json")
    if (manifest.get("history_id") != view["id"] or manifest.get("workspace_id") != workspace.project["id"]
            or manifest.get("report_id") != view["current_calibration_id"]):
        raise ValueError("The retained history export belongs to another selected profile")
    result = []
    archive = read_json(root / "archive.json")
    result.append(operator._ticket(workspace_key, verify_file(root, archive), archive, "Complete selected-profile history ZIP"))
    for name in ("index.html", *[name + ".csv" for name in TABLES], "history.json", "manifest.json"):
        item = (describe_file(root, root / name) if name == "manifest.json" else manifest["files"][name])
        label = TITLES.get(name.removesuffix(".csv"), "Selected-profile history" if name == "index.html" else name)
        result.append(operator._ticket(workspace_key, verify_file(root, item), item, label))
    return result
