"""Retain the actual MPXJ assignment-period calculation on its original edition."""
from __future__ import annotations

from collections import defaultdict
from datetime import datetime
import hashlib
import os
from pathlib import Path
import uuid

from portfolio.native import make_keys, native_uid
from portfolio.storage import canonical, digest, now, require
from .timephased_contract import (CAPTURE_SCHEMA, MAX_CAPTURE_BYTES, MAX_FACTS, MAX_LINE_BYTES, MAX_ACCRUAL_STEPS,
    applicable, series_semantics, source_binding)


def _rows(objects, model_rows, family):
    objects = list(objects)
    retained = [{"uid": native_uid(item.getUniqueID())} for item in objects]
    make_keys(retained, family, [])
    require(len(retained) == len(model_rows)
            and all(a["key"] == b["key"] and a["uid"] == b["uid"] and a["ordinal"] == b["ordinal"]
                    for a, b in zip(retained, model_rows)),
            "timephased_native_rows", "The reopened native row identities differ from the selected original edition.", family)
    index = defaultdict(list)
    for item, row in zip(objects, model_rows):
        index[row["uid"]].append((item, row))
    return objects, index


def _join(item, index):
    if item is None:
        return None, "not_set"
    matches = [row for native, row in index.get(native_uid(item.getUniqueID()), []) if native == item]
    require(len(matches) <= 1, "timephased_native_alias",
            "An actual native object matches multiple retained row identities.")
    return (matches[0], "native_object") if matches else (None, "derived_native_object")


def _definition(field):
    return {"name": str(field.getName()), "data_type": str(field.getDataType().name()),
            "native_type": str(field.getDataType().getValue()),
            "units_field": None if field.getUnitsType() is None else str(field.getUnitsType().name()),
            "user_defined": False}


def _native_range_admission(assignments, model_rows, profile):
    """Guard the pinned COST-resource pro-rata loop before entering JNI."""
    selected = {row["field"] for row in profile["series"]}
    calls = sum(1 for row in profile["series"] if row["field"] in {"COST", "ACTUAL_COST", "ACTUAL_REGULAR_COST"})
    if not calls:
        return {}, {"schema": "portfolio.native-period-admission.v1", "prorata_cost_assignments": 0,
                    "estimated_native_steps": 0, "per_assignment_step_limit": MAX_ACCRUAL_STEPS}
    periods = [(datetime.fromisoformat(row["start"]), datetime.fromisoformat(row["finish"]))
               for row in profile["periods"]]
    def micros(delta):
        return (delta.days * 86400 + delta.seconds) * 1_000_000 + delta.microseconds
    width = micros(periods[0][1] - periods[0][0])
    fixed = width >= 60_000_000 and width % 60_000_000 == 0
    fixed = fixed and all(micros(b - a) == width for a, b in periods)
    fixed = fixed and all(a == periods[i - 1][1] for i, (a, b) in enumerate(periods) if i)
    result, total = {}, 0
    for assignment, row in zip(assignments, model_rows):
        resource = assignment.getResource()
        if resource is None or resource.getType() is None or str(resource.getType().name()) != "COST":
            continue
        accrue = resource.getAccrueAt()
        if accrue is not None and str(accrue.name()) in {"START", "END"}:
            continue
        actual = assignment.getActualCost()
        if actual is None or actual.doubleValue() == 0.0:
            continue
        start, finish = assignment.getStart(), assignment.getFinish()
        require(start is not None and finish is not None, "timephased_native_cost_bounds",
                "This actual pro-rata COST resource needs its original native assignment bounds.", row["key"])
        start, finish = datetime.fromisoformat(str(start)), datetime.fromisoformat(str(finish))
        require(start <= finish, "timephased_native_cost_bounds",
                "The native pro-rata COST resource has reversed assignment bounds.", row["key"])
        if periods[-1][1] <= start or periods[0][0] >= finish:
            continue
        require(fixed, "timephased_native_cost_grid",
                "The pinned native pro-rata actual-cost method requires contiguous, equal-width ranges with a positive whole-minute stride. Choose a fixed daily/weekly grid for this COST resource.",
                {"assignment": row["key"], "fields": sorted(selected & {"COST", "ACTUAL_COST", "ACTUAL_REGULAR_COST"})})
        # The original method walks from the first selected boundary to the
        # assignment, then allocates ranges for its complete start/finish span.
        estimate = abs(micros(start - periods[0][0])) // width + micros(finish - start) // width + 5
        total += estimate * calls
        require(estimate <= MAX_ACCRUAL_STEPS and total <= MAX_FACTS, "timephased_native_cost_extent",
                "This exact native pro-rata cost grid would allocate too many internal ranges. Select a wider fixed reporting interval near the original assignment.",
                {"assignment": row["key"], "estimated_steps": estimate, "total_steps": total,
                 "per_assignment_limit": MAX_ACCRUAL_STEPS, "total_limit": MAX_FACTS})
        result[row["key"]] = {"native_method": "ResourceAssignment.getTimephasedActualCostProrata",
                              "resource_accrue_at": "PRORATED" if accrue is None else str(accrue.name()),
                              "minutes_per_range": width // 60_000_000,
                              "estimated_native_steps": estimate,
                              "assignment_start": start.isoformat(), "assignment_finish": finish.isoformat()}
    return result, {"schema": "portfolio.native-period-admission.v1",
                    "prorata_cost_assignments": len(result), "estimated_native_steps": total,
                    "per_assignment_step_limit": MAX_ACCRUAL_STEPS}


def capture(portfolio, operator_store, edition, profile, destination, *, stopped=None):
    """One read-only native calculation; publish complete immutable bytes only."""
    assignment_count = len(edition["model"]["assignments"])
    fact_count = assignment_count * len(profile["series"]) * len(profile["periods"])
    require(fact_count <= MAX_FACTS, "timephased_fact_limit",
            "This exact calculation exceeds two million assignment-period facts; narrow its periods or series before review.",
            {"facts": fact_count, "assignments": assignment_count, "periods": len(profile["periods"]),
             "series": len(profile["series"])})
    path = Path(destination)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    temporary = path.parent / ("." + path.name + "." + uuid.uuid4().hex + ".incoming")
    written, lines = 0, 0
    content_hash = hashlib.sha256()

    def check():
        require(stopped is None or not stopped(), "timephased_interrupted",
                "Reopen the same saved reporting request to continue its original read-only calculation.")

    try:
        with portfolio.native_project(edition["id"]) as project:
            native, model = portfolio.native, edition["model"]
            runtime = native.ensure()
            require(runtime["version"] == model["native"]["version"]
                    and runtime["upstream_commit"] == model["native"]["upstream_commit"],
                    "timephased_native_version", "Calculate this source with its original pinned native library.")
            assignments, _ = _rows(project.getResourceAssignments(), model["assignments"], "assignments")
            _, resources = _rows(project.getResources(), model["resources"], "resources")
            _, tasks = _rows(project.getTasks(), model["tasks"], "tasks")
            _, calendars = _rows(project.getCalendars(), model["calendars"], "calendars")
            enum = native.jclass("org.mpxj.AssignmentField")
            TimeUnit = native.jclass("org.mpxj.TimeUnit")
            DateTime = native.jclass("java.time.LocalDateTime")
            Range = native.jclass("org.mpxj.LocalDateTimeRange")
            ranges = native.jclass("java.util.ArrayList")()
            for period in profile["periods"]:
                ranges.add(Range(DateTime.parse(period["start"]), DateTime.parse(period["finish"])))
            selected_fields = {}
            catalogue = model["field_catalogue"].get("assignments", {})
            for series in profile["series"]:
                field = enum.valueOf(series["field"])
                require(assignment_count == 0 or _definition(field) == catalogue.get(series["field"]), "timephased_field_definition",
                        "The selected field's actual native definition differs from its saved source.", series["field"])
                selected_fields[series["name"]] = field
            range_admission, input_admission = _native_range_admission(assignments, model["assignments"], profile)
            baseline = project.getBaselineCalendar() if any(row["field"].startswith("BASELINE") for row in profile["series"]) else None
            baseline_row, baseline_resolution = _join(baseline, calendars)
            baseline_findings = []
            baseline_value = None if baseline is None else {
                "uid": native_uid(baseline.getUniqueID()),
                "name": None if baseline.getName() is None else str(baseline.getName()),
                "definition": native._calendar_details(baseline, baseline_findings, "project_baseline_calendar")}
            baseline_basis = {"key": None if baseline_row is None else baseline_row["key"],
                              "resolution": baseline_resolution, "value": baseline_value,
                              "findings": baseline_findings}
            binding = source_binding(edition, profile)
            capture_id = digest({"schema": CAPTURE_SCHEMA, "binding": binding, "native": runtime})
            header = {"record": "header", "schema": CAPTURE_SCHEMA, "capture_id": capture_id,
                      "binding": binding, "profile": profile, "native": runtime, "captured_at": now(),
                      "assignment_count": assignment_count, "fact_count": fact_count,
                      "field_definitions": {row["field"]: catalogue.get(row["field"]) for row in profile["series"]},
                      "series_semantics": {row["name"]: series_semantics(row) for row in profile["series"]},
                      "baseline_calendar": baseline_basis, "input_admission": input_admission}
            resource_rates = {}
            raw_fields = {name: enum.valueOf(name) for name in sorted(catalogue) if name.startswith("RAW_TIMEPHASED_")}
            with open(temporary, "xb") as stream:
                os.chmod(temporary, 0o600)

                def write(value):
                    nonlocal written, lines
                    raw = canonical(value) + b"\n"
                    require(len(raw) <= MAX_LINE_BYTES and written + len(raw) <= MAX_CAPTURE_BYTES,
                            "timephased_capture_size", "The complete native calculation exceeds its retained-record limit.")
                    stream.write(raw)
                    content_hash.update(raw)
                    written += len(raw)
                    lines += 1

                write(header)
                native_errors = 0
                for ordinal, (assignment, row) in enumerate(zip(assignments, model["assignments"])):
                    check()
                    require(native_uid(assignment.getTaskUniqueID()) == row.get("task_uid")
                            and native_uid(assignment.getResourceUniqueID()) == row.get("resource_uid"),
                            "timephased_assignment_links", "The original assignment's native task or resource changed.", row["key"])
                    resource, task = assignment.getResource(), assignment.getTask()
                    resource_row, resource_resolution = _join(resource, resources)
                    task_row, task_resolution = _join(task, tasks)
                    require(resource is None or resource_row is not None, "timephased_resource_identity",
                            "The native assignment's resource is outside its retained project.", row["key"])
                    require(task is None or task_row is not None, "timephased_task_identity",
                            "The native assignment's task is outside its retained project.", row["key"])
                    current_findings = []
                    # Read the exact native raw inputs before the period getters. The
                    # saved edition was captured through these same native methods.
                    for field_name, field in raw_fields.items():
                        current = native._encode(assignment.get(field), current_findings,
                                                  "assignments/" + row["key"] + "/fields/" + field_name)
                        require(current == row["fields"].get(field_name), "timephased_raw_preimage",
                                "The native raw spans differ from the selected original source.", {"assignment": row["key"], "field": field_name})
                    resource_type = None if resource is None or resource.getType() is None else str(resource.getType().name())
                    material_label = None if resource is None or resource.getMaterialLabel() is None else str(resource.getMaterialLabel())
                    if resource_row is not None and resource_row["key"] not in resource_rates:
                        current = native._resource_details(resource, current_findings, "resources/" + resource_row["key"])
                        require(current == resource_row.get("native_details"), "timephased_rates_preimage",
                                "The native resource rate or availability definitions differ from the saved source.", resource_row["key"])
                        resource_rates[resource_row["key"]] = digest(current)
                    effective = assignment.getEffectiveCalendar()
                    calendar_row, calendar_resolution = _join(effective, calendars)
                    effective_value = None if effective is None else {
                        "uid": native_uid(effective.getUniqueID()),
                        "name": None if effective.getName() is None else str(effective.getName()),
                        "definition": native._calendar_details(effective, current_findings, "effective_calendar/" + row["key"])}
                    basis = {"record": "assignment_basis", "ordinal": ordinal, "assignment_key": row["key"],
                             "assignment_uid": row["uid"], "task_key": None if task_row is None else task_row["key"],
                             "task_resolution": task_resolution,
                             "resource_key": None if resource_row is None else resource_row["key"],
                             "resource_resolution": resource_resolution, "resource_type": resource_type,
                             "material_label": material_label,
                             "calendar_key": None if calendar_row is None else calendar_row["key"],
                             "calendar_resolution": calendar_resolution, "effective_calendar": effective_value,
                             "cost_rate_table": native._encode(assignment.get(enum.COST_RATE_TABLE), current_findings,
                                                               "assignments/" + row["key"] + "/fields/COST_RATE_TABLE"),
                             "resource_rates_sha256": None if resource_row is None else resource_rates[resource_row["key"]],
                             "native_range_admission": range_admission.get(row["key"]),
                             "findings": current_findings}
                    write(basis)
                    for series in profile["series"]:
                        check()
                        value = {"record": "series", "assignment_key": row["key"], "series": series["name"],
                                 "state": "native", "values": None, "error": None}
                        if not applicable(series["kind"], resource_type):
                            value["state"] = "not_applicable"
                        else:
                            try:
                                field = selected_fields[series["name"]]
                                output = (assignment.getTimephasedDurationValues(field, ranges, TimeUnit.valueOf(series["units"]))
                                          if series["kind"] == "work" else assignment.getTimephasedNumericValues(field, ranges))
                                require(output is not None and len(output) == len(profile["periods"]),
                                        "timephased_native_cardinality", "The native method returned another period count.", series["name"])
                                encoded, errors = [], []
                                for period, item in zip(profile["periods"], output):
                                    encoded.append(native._encode(item, errors, "timephased/" + row["key"] + "/" + series["name"] + "/" + period["key"]))
                                require(not errors, "timephased_native_value", "The native period output could not be retained completely.", errors)
                                value["values"] = encoded
                            except Exception as error:
                                value.update(state="native_error", values=None,
                                             error={"type": type(error).__name__, "message": str(error)})
                                native_errors += 1
                        write(value)
                write({"record": "complete", "capture_id": capture_id, "assignments": assignment_count,
                       "series": assignment_count * len(profile["series"]), "facts": fact_count,
                       "native_errors": native_errors, "prior_records": lines})
                stream.flush()
                os.fsync(stream.fileno())
            retained = operator_store.retain_file(temporary, content_hash.hexdigest(), written)
            require(retained["sha256"] == content_hash.hexdigest() and retained["bytes"] == written,
                    "timephased_retained_identity", "The original file store returned another calculation.")
            return {"schema": CAPTURE_SCHEMA, "capture_id": capture_id, "binding": binding,
                    "sha256": retained["sha256"], "bytes": retained["bytes"], "records": lines,
                    "header_sha256": digest(header), "assignment_count": assignment_count,
                    "fact_count": fact_count, "native_errors": native_errors}
    finally:
        temporary.unlink(missing_ok=True)
