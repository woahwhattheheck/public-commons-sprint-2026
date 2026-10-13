"""Join one immutable FIELD12 revision to native observations and scientific reports.

The existing observation registry and OBSERVED_CONTEXT report collector remain
the only receiving surfaces. No annual load, chemistry conversion or collection
timestamp is inferred. Complete original rows and saved revision bytes travel
with the derived CSV and its source/report editions.
"""
from __future__ import annotations

import collections
import copy
import csv
import datetime as dt
import io
import json
import os
from pathlib import Path
import re
import shutil
import tempfile

from .common import atomic_bytes, atomic_json, describe_file, digest, file_digest, held, read_json
from .implementation import ImplementationStore
from .implementation_schema import ImplementationError, document_digest, validate_plan
from . import observed_context
from .implementation_observation_quality import summarize_field_quality, write_quality_sources, quality_sections, method_context

SCHEMA = "upstate.implementation-observation-context/v1"
EDITION = "field-observations-20261013-v4-source-method-context"
REPORT_IDENTITY = "upstate.implementation-observation-report-source/v1"
FIELDS = (
    "record_id", "station_id", "site_label", "site_latitude", "site_longitude",
    "site_source_ref", "candidate_id", "visit_id", "visit_status",
    "visit_planned_date", "visit_visited_at", "observer", "monitoring_plan_id",
    "activity_id", "activity_kind", "sample_id", "collected_at", "custody_ref",
    "parameter", "result_type", "numeric_value", "original_text", "display_value",
    "unit", "basis", "fraction", "qualifier", "detection_limit", "quantitation_limit",
    "method", "method_context", "method_name", "activity_method",
    "activity_method_context", "activity_method_name", "collection_equipment",
    "method_source_definition", "qa_status", "notes", "period_start", "period_end",
    "measurement_support", "quantity_basis", "source_quantity", "quantitation_class",
    "source_records",
)


def _clone(value):
    return copy.deepcopy(value)


def _json(value):
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False,
                      allow_nan=False)


def _text(value):
    if value is None:
        return ""
    if isinstance(value, (dict, list)):
        return _json(value)
    return str(value)


def _describe(root, path):
    return describe_file(Path(root), Path(path))


def _same(path, item):
    return (path.is_file() and not path.is_symlink()
            and path.stat().st_size == item["bytes"]
            and file_digest(path) == item["sha256"])


def _retain(source, destination, expected):
    """Copy a verified source without loading large attachments into memory."""
    source, destination = Path(source), Path(destination)
    if not _same(source, expected):
        raise ImplementationError("Original field source differs: " + str(source))
    destination.parent.mkdir(parents=True, exist_ok=True)
    if destination.exists() or destination.is_symlink():
        if not _same(destination, expected):
            raise ImplementationError("Retained field source differs: " + str(destination))
        return
    pending = None
    try:
        with source.open("rb") as incoming, tempfile.NamedTemporaryFile(
                dir=destination.parent, prefix=".field-source-", delete=False) as outgoing:
            pending = Path(outgoing.name)
            shutil.copyfileobj(incoming, outgoing, 1024 * 1024)
            outgoing.flush()
            os.fsync(outgoing.fileno())
        if not _same(pending, expected):
            raise ImplementationError("Original field source changed while copying")
        os.replace(pending, destination)
        pending = None
    finally:
        if pending is not None and pending.exists():
            pending.unlink()


def _attachment_inventory(workspace, plan):
    """Retain local files only through their original declared digest and size."""
    root = Path(workspace.root).resolve()
    records, available = [], []
    for link in plan["source_links"]:
        if link.get("kind") != "local_file":
            continue
        record = {"source_link_id": link["id"], "reference": link.get("reference"),
                  "sha256": link.get("sha256"), "bytes": link.get("size_bytes"),
                  "label": link["label"]}
        reference = link.get("reference")
        checksum, size = record["sha256"], record["bytes"]
        if (not isinstance(reference, str) or not reference
                or not isinstance(checksum, str) or not re.fullmatch(r"[a-f0-9]{64}", checksum)
                or type(size) is not int or size < 0):
            record["state"] = "original_reference_without_complete_file_descriptor"
            records.append(record)
            continue
        relative = Path(reference)
        if (relative.is_absolute() or ".." in relative.parts or "\\" in reference
                or "\0" in reference or relative.as_posix() != reference):
            raise ImplementationError("Original local field source must remain inside its workspace")
        path = root / relative
        if not path.resolve().is_relative_to(root) or path.is_symlink():
            raise ImplementationError("Original local field source escapes its workspace")
        if not path.is_file():
            record["state"] = "original_reference_file_unavailable"
            records.append(record)
            continue
        if not _same(path, record):
            raise ImplementationError("Original local field attachment changed: " + reference)
        record.update(state="retained", retained_path="attachments/" + checksum + "/" + relative.name)
        records.append(record)
        available.append((path, record))
    return records, available


def _report_choices(selection, choices):
    """Replace only observed-source fields, preserving the original list form."""
    selected = _clone(selection)
    roles = dict(selected.get("source_roles", {}))
    if choices:
        roles[observed_context.ROLE] = _clone(choices[0])
    else:
        roles.pop(observed_context.ROLE, None)
    selected["source_roles"] = roles
    if "observed_context_sources" in selected or len(choices) > 1:
        selected["observed_context_sources"] = _clone(choices)
    selected.pop("observed_context_binding", None)
    observed_context.source_choices(selected)
    return selected


def _bound_report_selection(workspace, value):
    selected = _clone(value if value is not None else {})
    if not isinstance(selected, dict) or not isinstance(selected.get("source_roles", {}), dict):
        raise ImplementationError("Select the original report selection object with source_roles")
    selected.setdefault("source_roles", {})
    choices = observed_context.source_choices(selected)
    actual = observed_context.bind(workspace, selected)
    declared = selected.get("observed_context_binding")
    if declared is not None and declared != actual:
        raise ImplementationError("The selected observed reports differ from their original binding")
    selected = _report_choices(selected, choices)
    if actual is not None:
        selected["observed_context_binding"] = actual
    return selected, choices, actual


def _composition_selection(workspace, value, identity_name, matches):
    """Reopen this producer in its selected slot without discarding other reports."""
    selected, choices, actual = _bound_report_selection(workspace, value)
    index = 0
    source = None
    for candidate_index, choice in enumerate(choices):
        candidate = observed_context._source(
            workspace, {"source_roles": {observed_context.ROLE: choice}})
        identity = candidate["recipe"].get(identity_name, {})
        if matches(candidate, identity):
            index, source = candidate_index, candidate
            break
    if source is None:
        return selected, actual, {"index": 0, "source": _clone(choices[0]) if choices else None}
    seen = set()
    while source is not None:
        identity = source["recipe"].get(identity_name, {})
        if not matches(source, identity):
            break
        checksum = source["binding"]["body_sha256"]
        if checksum in seen:
            raise ImplementationError("The composed report repeats an original source binding")
        seen.add(checksum)
        original, original_choices, original_binding = _bound_report_selection(
            workspace, identity["original_delivery_selection"])
        if original_binding != identity.get("original_observed_context_binding"):
            raise ImplementationError("The composed report's retained original context changed")
        composition = identity.get("report_composition")
        if composition is None:
            previous = _clone(original_choices[0]) if original_choices else None
        else:
            position = composition.get("index")
            previous = composition.get("source")
            replace_source = composition.get("replace", previous is not None)
            if (type(position) is not int or position < 0 or position > len(original_choices)
                    or type(replace_source) is not bool
                    or (previous is not None and (
                        (replace_source and (position == len(original_choices)
                                             or original_choices[position] != previous))
                        or (not replace_source and previous not in original_choices)))):
                raise ImplementationError("The composed report's original source slot changed")
        remaining = choices[:index] + choices[index + 1:]
        if previous is not None and previous in remaining:
            # A separately selected original source is a different document from
            # this composed producer. Keep both deliberate selections in place.
            selected = _report_choices(selected, remaining)
            actual = observed_context.bind(workspace, selected)
            if actual is not None:
                selected["observed_context_binding"] = actual
            return selected, actual, {"index": index, "source": _clone(previous), "replace": False}
        choices[index:index + 1] = [_clone(previous)] if previous is not None else []
        selected = _report_choices(selected, choices)
        actual = observed_context.bind(workspace, selected)
        if actual is not None:
            selected["observed_context_binding"] = actual
        if previous is None:
            return selected, actual, {"index": index, "source": None}
        source = observed_context._source(
            workspace, {"source_roles": {observed_context.ROLE: previous}})
    return selected, actual, {"index": index, "source": _clone(choices[index])}


def _compose_report_selection(workspace, selected, choice, composition):
    choices = observed_context.source_choices(selected)
    index, previous = composition["index"], composition["source"]
    replace_source = composition.get("replace", previous is not None)
    if (type(index) is not int or index < 0 or index > len(choices)
            or type(replace_source) is not bool
            or (previous is not None and (
                (replace_source and (index == len(choices) or choices[index] != previous))
                or (not replace_source and previous not in choices)))):
        raise ImplementationError("The selected report composition slot changed")
    choices[index:index + replace_source] = [_clone(choice)]
    result = _report_choices(selected, choices)
    result["observed_context_binding"] = observed_context.bind(workspace, result)
    return result


def _composition_identity(selected, composition):
    # Keep exact implicit single-source legacy identities and completed receipts.
    if "observed_context_sources" in selected or composition["index"] != 0:
        return {"report_composition": _clone(composition)}
    return {}


def _selection(workspace, selected, plan_digest):
    def matches(source, identity):
        return (identity.get("schema") == REPORT_IDENTITY
                and identity.get("project_id") == workspace.project["id"]
                and identity.get("plan", {}).get("sha256") == plan_digest
                and source["entry"].get("id") == "field-observed-report-" + digest(identity)[:24])
    return _composition_selection(
        workspace, selected, "implementation_observation_identity", matches)


def _context(workspace, saved_plan, existing_report_selection):
    plan = validate_plan(saved_plan)
    store = ImplementationStore(workspace)
    original = store.get(plan["id"], revision=plan["revision"])
    checksum = document_digest(original)
    if document_digest(plan) != checksum:
        raise ImplementationError("Import the exact saved FIELD12 revision; save edits before previewing")
    revision_path = store._directory(plan["id"]) / "revisions" / ("%016d.json" % plan["revision"])
    revision = store._read_record(revision_path)
    if document_digest(revision["plan"]) != checksum:
        raise ImplementationError("The saved FIELD12 revision changed during source selection")
    revision_file = _describe(workspace.root, revision_path)
    attachments, attachment_files = _attachment_inventory(workspace, original)
    selected, binding, composition = _selection(workspace, existing_report_selection, checksum)
    identity = {
        "schema": REPORT_IDENTITY, "edition": EDITION,
        "project_id": workspace.project["id"],
        "plan": {"id": plan["id"], "revision": plan["revision"],
                 "sha256": checksum, "title": plan["title"]},
        "revision_file": revision_file,
        "attachment_inventory": attachments,
        "original_delivery_selection": selected,
        "original_observed_context_binding": binding,
        **_composition_identity(selected, composition),
    }
    return {"plan": original, "identity": identity, "operation_id": digest(identity),
            "revision_path": revision_path, "attachment_files": attachment_files,
            "report_composition": composition}


def _rows(plan):
    sites = {row["id"]: row for row in plan["sites"]}
    visits = {row["id"]: row for row in plan["visits"]}
    activities = {row["id"]: row for row in plan["activities"]}
    pointers = {kind: {row["id"]: "/" + kind + "/" + str(index)
                       for index, row in enumerate(plan[kind])}
                for kind in ("sites", "visits", "activities", "observations")}
    plan_digest = document_digest(plan)
    rows = []
    for observation in plan["observations"]:
        activity = activities[observation["activity_id"]]
        visit = visits[activity["visit_id"]]
        site = sites[activity["site_id"]]
        result_type = observation["result_type"]
        original_text = observation["original_text"]
        numeric = observation["value"] if result_type == "numeric" else None
        # Context ingest attempts float(value). Preserve the original result type
        # even when the original nonnumeric text consists only of digits.
        display = _text(numeric) if result_type == "numeric" else "[" + result_type + "] " + original_text
        collected = activity.get("collected_at") or ""
        day = dt.datetime.fromisoformat(collected.replace("Z", "+00:00")).date().isoformat() if collected else ""
        source_records = {
            "plan_id": plan["id"], "revision": plan["revision"], "plan_sha256": plan_digest,
            "retained_original": "original/plan.json",
            "observation_id": observation["id"], "activity_id": activity["id"],
            "visit_id": visit["id"], "site_id": site["id"],
            "json_pointers": {"observation": pointers["observations"][observation["id"]],
                              "activity": pointers["activities"][activity["id"]],
                              "visit": pointers["visits"][visit["id"]],
                              "site": pointers["sites"][site["id"]]},
        }
        method = method_context(observation, activity)
        row = {
            "record_id": observation["id"], "station_id": site["id"], "site_label": site["label"],
            "site_latitude": site.get("latitude"), "site_longitude": site.get("longitude"),
            "site_source_ref": site.get("source_ref"), "candidate_id": site.get("candidate_id"),
            "visit_id": visit["id"], "visit_status": visit["status"],
            "visit_planned_date": visit.get("planned_date"), "visit_visited_at": visit.get("visited_at"),
            "observer": visit["observer"], "monitoring_plan_id": visit.get("monitoring_plan_id"),
            "activity_id": activity["id"], "activity_kind": activity["kind"],
            "sample_id": activity.get("sample_id"), "collected_at": collected,
            "custody_ref": activity.get("custody_ref"),
            "parameter": observation["parameter"], "result_type": result_type,
            "numeric_value": numeric, "original_text": original_text, "display_value": display,
            "unit": observation["unit"], "basis": observation.get("basis"),
            "fraction": observation.get("fraction"), "qualifier": observation.get("qualifier"),
            "detection_limit": observation.get("detection_limit"),
            "quantitation_limit": observation.get("quantitation_limit"),
            "method": observation.get("method"), "activity_method": activity.get("method"),
            **{key: method[key] for key in ("method_context", "method_name", "activity_method_context",
                                          "activity_method_name", "collection_equipment")},
            "method_source_definition": method,
            "qa_status": observation.get("qa_status"), "notes": observation["notes"],
            "period_start": day, "period_end": day,
            "measurement_support": "other_context", "quantity_basis": "context",
            "source_quantity": result_type,
            "quantitation_class": ("reported_with_condition" if observation.get("qualifier")
                                    else "reported") if result_type == "numeric" else "no_numeric_result",
            "source_records": source_records,
        }
        rows.append({key: _text(row[key]) for key in FIELDS})
    return rows


def _summary(plan, rows, identity):
    counts = collections.Counter(row["result_type"] for row in rows)
    used_sites = {row["station_id"] for row in rows}
    sites = {row["id"]: row for row in plan["sites"]}
    dates = sorted(row["period_start"] for row in rows if row["period_start"])
    return {
        "row_count": len(rows), "numeric_count": counts["numeric"],
        "censored_count": counts["censored"], "text_count": counts["text"],
        "missing_count": counts["missing"], "site_count": len(used_sites),
        "activity_count": len({row["activity_id"] for row in rows}),
        "collection_time_missing_count": sum(not row["collected_at"] for row in rows),
        "coordinate_missing_site_count": sum(sites[key].get("latitude") is None for key in used_sites),
        "first_collection_date": dates[0] if dates else None,
        "last_collection_date": dates[-1] if dates else None,
        "retained_attachment_count": sum(item["state"] == "retained" for item in identity["attachment_inventory"]),
        "reference_only_attachment_count": sum(item["state"] != "retained" for item in identity["attachment_inventory"]),
        "coordinate_interpretation": "Original recorded latitude/longitude; datum and modeled catchment membership are not assigned",
        "time_interpretation": "Original collection timestamps; date index uses each timestamp's recorded local calendar date",
    }


def _preview(workspace, saved_plan, existing_report_selection):
    context = _context(workspace, saved_plan, existing_report_selection)
    rows = _rows(context["plan"])
    summary = _summary(context["plan"], rows, context["identity"])
    context["quality"] = summarize_field_quality(
        context["plan"], attachment_inventory=context["identity"]["attachment_inventory"])
    summary["measurement_quality"] = context["quality"]["summary"]
    result = {"schema": SCHEMA, "edition": EDITION, "plan": context["identity"]["plan"],
              "operation_id": context["operation_id"], "summary": summary,
              "source_collection_id": None, "observation_ids": [], "report_source": None}
    return context, rows, result


def preview_observation_context(workspace, saved_plan, *, existing_report_selection=None):
    """Inspect the exact saved revision without writing a source or observation edition."""
    try:
        return _preview(workspace, saved_plan, existing_report_selection)[2]
    except ImplementationError:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ImplementationError("Field observation preview: " + str(error)) from error


def _csv(rows):
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=FIELDS, lineterminator="\r\n")
    writer.writeheader()
    writer.writerows(rows)
    return output.getvalue().encode("utf-8")


def _metadata(context, table, collection_id):
    plan = context["plan"]
    return {
        "title": plan["title"] + " — original field observations, revision " + str(plan["revision"]),
        "source_uri": _uri(context), "sha256": table["sha256"],
        "value_basis": "context", "observation_kind": "implementation_field_observations",
        "measurement_support": "other_context", "quantity_basis": "context",
        "time_support": "original collection timestamp; local calendar date index",
        "period_end_inclusive": True,
        "columns": {"value": "display_value"},
        "series_dimensions": ["basis", "fraction", "method", "method_context", "method_name",
                              "activity_method", "activity_method_context", "activity_method_name",
                              "qualifier", "qa_status", "result_type"],
        "quantitation_column": "quantitation_class",
        "limit_column": "unassigned_plot_bound", "limit_unit_column": "unassigned_plot_bound_unit",
        "interpretation": "Saved field results retain original sample collection times, units, basis, fraction, "
                          "qualifiers and QA. Censored/text/missing records remain nonnumeric. "
                          "Detection and quantitation limits remain distinct original fields. "
                          "Collection date is not an averaging interval; visit dates are separate.",
        "implementation_plan": context["identity"]["plan"],
        "implementation_observation_operation": context["operation_id"],
        "source_collection_id": collection_id,
        "source_table_path": table["path"],
    }


def _uri(context):
    p = context["identity"]
    return "urn:upstate:implementation:" + p["project_id"] + ":" + p["plan"]["id"] + ":" + str(p["plan"]["revision"]) + ":" + p["plan"]["sha256"]


def _source_collection(workspace, context, root, rows):
    atomic_json(root / "identity.json", context["identity"], immutable=True)
    atomic_json(root / "original/plan.json", context["plan"], immutable=True)
    _retain(context["revision_path"], root / "original/revision.json", context["identity"]["revision_file"])
    atomic_json(root / "original/attachment-inventory.json", context["identity"]["attachment_inventory"], immutable=True)
    names = ["identity.json", "original/plan.json", "original/revision.json",
             "original/attachment-inventory.json", "field-observations.csv"]
    for path, item in context["attachment_files"]:
        name = "original/" + item["retained_path"]
        _retain(path, root / name, item)
        names.append(name)
    atomic_bytes(root / "field-observations.csv", _csv(rows), immutable=True)
    names.extend(write_quality_sources(root, context["quality"]))
    members = [_describe(root, root / name) for name in sorted(set(names))]
    by_name = {item["path"]: item for item in members}
    entries = []
    for path, kind, suffix, title in [
        ("original/revision.json", "document", "revision", "Original saved field plan and revision event"),
        ("field-observations.csv", "table", "observations", "Original field observations and source relationships"),
        ("quality/summary.json", "document", "quality", "Original measurement definitions and campaign coverage"),
    ]:
        entries.append({
            "id": "field-" + suffix + "-" + context["operation_id"][:24],
            "kind": kind, "title": title,
            "uri": _uri(context), "vintage": "Saved plan revision " + str(context["plan"]["revision"]),
            "units": "original recorded units and result types",
            "metadata": {"implementation_plan": context["identity"]["plan"], "operation_id": context["operation_id"]},
            **by_name[path], "companions": [item for item in members if item["path"] != path],
        })
    manifest = {"schema": "upstate.sources/v1", "title": context["plan"]["title"] + " — saved field source",
                "entries": entries, "scope": {"implementation_plan": context["identity"]["plan"]}}
    atomic_json(root / "model-sources.json", manifest, immutable=True)
    collection = workspace.import_sources(root / "model-sources.json")
    return collection, members, by_name["field-observations.csv"]


def _compose_existing(workspace, selected, root, composition=None):
    binding = observed_context.bind(workspace, selected)
    if composition is None:
        choices = observed_context.source_choices(selected)
        choice = choices[0] if choices else None
    else:
        choice = composition["source"]
    source = (observed_context._source(workspace, {"source_roles": {observed_context.ROLE: choice}})
              if choice is not None else None)
    if source is None:
        return {}, binding, []
    prefix = "existing-context/"
    for relative, item in source["members"].items():
        _retain(item["path"], root / (prefix + relative), item)
    recipe = _clone(source["recipe"])
    for heading, blocks in recipe["sections"]:
        for block in blocks:
            if isinstance(block, dict) and block.get("kind") == "links":
                for item in block.get("items", []):
                    name = observed_context._relative(item["path"]).as_posix()
                    if name not in source["members"]:
                        raise ImplementationError("An existing observed report link has no retained source member")
                    item["path"] = prefix + name
    if recipe.get("figures"):
        for item in [{"path": recipe["figure_spec"]}] + recipe["figures"]:
            name = observed_context._relative(item["path"]).as_posix()
            if name not in source["members"]:
                raise ImplementationError("An existing scientific figure has no retained source member")
        recipe["figure_spec"] = prefix + recipe["figure_spec"]
        for item in recipe["figures"]:
            item["path"] = prefix + item["path"]
    links = []
    for name in recipe.get("source_links", []):
        name = observed_context._relative(name).as_posix()
        if name not in source["members"]:
            raise ImplementationError("An existing observed source link has no retained member")
        links.append(prefix + name)
    recipe["source_links"] = links
    # The new recipe replaces inputs with every verified composed member.
    return recipe, binding, sorted(prefix + name for name in source["members"])


def _sections(context, rows, summary, observation_ids):
    plan = context["plan"]
    sample_rows = []
    for row in rows[:200]:
        sample_rows.append([
            _text(row["station_id"]) + "\n" + _text(row["sample_id"]),
            row["collected_at"], row["parameter"],
            _text(row["result_type"]) + "\nNumeric: " + _text(row["numeric_value"]) +
            "\nOriginal: " + _text(row["original_text"]),
            "\n".join(label + ": " + _text(row[key]) for key, label in
                      (("unit", "Unit"), ("basis", "Basis"), ("fraction", "Fraction"))),
            "\n".join(label + ": " + _text(row[key]) for key, label in
                      (("qa_status", "QA"), ("qualifier", "Qualifier"), ("custody_ref", "Custody"))),
        ])
    return [
        ["Saved field observation source", [
            plan["title"] + "; revision " + str(plan["revision"]) + "; original plan digest " + context["identity"]["plan"]["sha256"] + ".",
            {"kind": "table", "columns": ["Quantity", "Retained count"], "rows": [
                ["Observation rows", str(summary["row_count"])],
                ["Numeric", str(summary["numeric_count"])], ["Censored", str(summary["censored_count"])],
                ["Text", str(summary["text_count"])], ["Missing", str(summary["missing_count"])],
                ["Sites represented", str(summary["site_count"])],
                ["Rows without original collection time", str(summary["collection_time_missing_count"])],
                ["Represented sites without coordinates", str(summary["coordinate_missing_site_count"])],
            ]},
            "Native observation editions: " + (", ".join(observation_ids) if observation_ids else "The saved revision contains no observation rows."),
            "Each result retains its original activity, sample, collection timestamp, custody, site, visit, units, basis, fraction, method and QA. "
            "Collection dates index original samples; they do not declare daily averages. Planned and visited dates remain separate. "
            "Original latitude/longitude are retained without assigning an unstated datum or catchment.",
        ]],
        *quality_sections(context["quality"]),
        ["Original field result detail", [
            ("The first 200 rows in original saved order are shown; the complete CSV and saved revision are included."
             if len(rows) > 200 else "All saved observation rows are shown in original order."),
            {"kind": "table", "columns": ["Site / sample", "Collected at", "Parameter",
                "Original result / type", "Unit / basis / fraction", "QA / qualifier / custody"],
             "rows": sample_rows, "widths": [1.5, 1.2, 1.3, 1.4, 1.0, 1.1]},
            "The complete linked CSV retains each exact observation ID, all displayed values and every original relationship.",
            {"kind": "links", "items": [
                {"title": "Complete field observations with original relationships and limits", "path": "field/field-observations.csv"},
                {"title": "Exact original saved revision and event", "path": "field/original/revision.json"},
                {"title": "Original local-file source availability and retained descriptors", "path": "field/original/attachment-inventory.json"},
            ]},
        ]],
    ]


def _report(workspace, context, root, rows, result, source_members, editions):
    directory = root / "report"
    directory.mkdir(parents=True, exist_ok=True)
    selected = context["identity"]["original_delivery_selection"]
    composition = context["report_composition"]
    recipe, binding, names = _compose_existing(workspace, selected, directory, composition)
    if binding != context["identity"]["original_observed_context_binding"]:
        raise ImplementationError("The selected observed report changed while composing field measurements")
    for item in source_members + [_describe(root, root / "model-sources.json")]:
        name = "field/" + item["path"]
        _retain(root / item["path"], directory / name, item)
        names.append(name)
    records = []
    for edition in editions:
        records.append({**{key: value for key, value in edition.items() if key != "rows"},
                        "row_count": len(edition["rows"]), "complete_record_sha256": digest(edition),
                        "row_source": "field/field-observations.csv"})
    atomic_json(directory / "observation-editions.json", {
        "schema": "upstate.implementation-observation-editions/v1",
        "plan": context["identity"]["plan"], "source_collection_id": result["source_collection_id"],
        "observation_ids": result["observation_ids"], "editions": records,
    }, immutable=True)
    atomic_json(directory / "original-delivery-selection.json", selected, immutable=True)
    names += ["observation-editions.json", "original-delivery-selection.json"]
    companions = [_describe(directory, directory / name) for name in sorted(set(names))]
    sections = list(recipe.get("sections", [])) + _sections(context, rows, result["summary"], result["observation_ids"])
    recipe.update({
        "schema": observed_context.SCHEMA,
        "title": context["plan"]["title"] + " — original field observations and scientific context",
        "sections": sections, "inputs": companions,
        "source_links": list(dict.fromkeys(list(recipe.get("source_links", [])) + [
            "field/field-observations.csv", "field/original/revision.json",
            "field/original/plan.json", "field/original/attachment-inventory.json", "observation-editions.json",
            "field/quality/summary.json"])),
        "implementation_observation_identity": context["identity"],
        "implementation_observation_ids": result["observation_ids"],
        "implementation_source_collection_id": result["source_collection_id"],
    })
    atomic_json(directory / "observed-report.json", recipe, immutable=True)
    entry = {
        "id": "field-observed-report-" + context["operation_id"][:24],
        "kind": "document", "role": observed_context.ROLE,
        "metadata": {"report_schema": observed_context.SCHEMA, "implementation_plan": context["identity"]["plan"]},
        "title": recipe["title"], "uri": _uri(context),
        "vintage": "Saved plan revision " + str(context["plan"]["revision"]),
        "units": "original recorded measurement units and result types",
        **_describe(directory, directory / "observed-report.json"), "companions": companions,
    }
    manifest = {"schema": "upstate.sources/v1", "title": recipe["title"], "entries": [entry]}
    atomic_json(directory / "model-sources.json", manifest, immutable=True)
    collection = workspace.import_sources(directory / "model-sources.json")
    choice = {"source_collection_id": collection["id"], "source_id": entry["id"]}
    selection = _compose_report_selection(workspace, selected, choice, composition)
    atomic_json(directory / "delivery-selection.json", selection, immutable=True)
    report_paths = sorted(set(names + ["observed-report.json", "model-sources.json", "delivery-selection.json"]))
    return {
        **choice, "source_role": observed_context.ROLE,
        "binding": selection["observed_context_binding"],
        "original_binding": binding,
        "delivery_selection": selection,
        "delivery_selection_path": (directory / "delivery-selection.json").relative_to(workspace.root).as_posix(),
        "directory": directory.relative_to(workspace.root).as_posix(),
        "files": [_describe(workspace.root, directory / name) for name in report_paths],
    }


def _reopen(workspace, path, context):
    receipt = read_json(path)
    if (receipt.get("schema") != SCHEMA or receipt.get("operation_id") != context["operation_id"]
            or receipt.get("plan") != context["identity"]["plan"]):
        raise ImplementationError("Saved field import belongs to another original operation")
    for item in receipt["files"]:
        relative = observed_context._relative(item["path"])
        source = Path(workspace.root) / relative
        if not source.resolve().is_relative_to(Path(workspace.root).resolve()) or not _same(source, item):
            raise ImplementationError("Saved field import member changed: " + item["path"])
    workspace._get("sources", receipt["source_collection_id"])
    for key in receipt["observation_ids"]:
        edition = workspace._get("observations", key)
        if edition["metadata"].get("implementation_observation_operation") != context["operation_id"]:
            raise ImplementationError("Saved field observation edition differs from its original operation")
    report = receipt["report_source"]
    if observed_context.bind(workspace, report["delivery_selection"]) != report["binding"]:
        raise ImplementationError("Saved field scientific report binding changed")
    return {**receipt, "reused": True}


def import_observation_context(workspace, saved_plan, *, existing_report_selection=None,
                               expected_operation_id=None):
    """Import the pinned source, actual context rows and bound scientific report.

    Work is restartable through immutable source/observation identities. The
    final receipt names every retained member using workspace-relative paths,
    so the ordinary working archive can restore this exact operation.
    """
    try:
        context, rows, result = _preview(workspace, saved_plan, existing_report_selection)
        if expected_operation_id is not None and expected_operation_id != context["operation_id"]:
            raise ImplementationError("The original field source selection changed; preview this saved revision again")
        root = Path(workspace.root) / "implementation" / "observed-context" / context["operation_id"]
        if root.is_symlink():
            raise ImplementationError("Field observation operation directory is a symlink")
        root.mkdir(parents=True, exist_ok=True)
        with held(root / "operation.lock"):
            receipt_path = root / "import.json"
            if receipt_path.exists():
                return _reopen(workspace, receipt_path, context)
            collection, source_members, table = _source_collection(workspace, context, root, rows)
            result["source_collection_id"] = collection["id"]
            editions = []
            if rows:
                metadata = _metadata(context, table, collection["id"])
                atomic_json(root / "observation-metadata.json", metadata, immutable=True)
                edition = workspace.import_observations(root / table["path"], metadata)
                editions.append(edition)
                result["observation_ids"] = [edition["id"]]
            result["report_source"] = _report(workspace, context, root, rows, result, source_members, editions)
            base_names = [item["path"] for item in source_members] + ["model-sources.json"]
            if rows:
                base_names.append("observation-metadata.json")
            result["files"] = ([_describe(workspace.root, root / name) for name in sorted(set(base_names))]
                               + result["report_source"]["files"])
            result["directory"] = root.relative_to(workspace.root).as_posix()
            result["state"] = "imported"
            atomic_json(receipt_path, result, immutable=True)
            return {**result, "reused": False}
    except ImplementationError:
        raise
    except (ValueError, KeyError, TypeError, OSError) as error:
        raise ImplementationError("Field observation import: " + str(error)) from error
