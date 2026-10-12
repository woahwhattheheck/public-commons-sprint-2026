"""Original spans, calendar/rate tables and retained native period facts."""
from __future__ import annotations

from collections import defaultdict
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import tempfile

from portfolio.storage import canonical, checked_id, digest, open_regular, require
from .measures import currency_context, decimal_value, exact_sum
from .projection import encoded, pointer_token, row_identity, scalar, typed_parts
from .timephased_contract import (CAPTURE_SCHEMA, MAX_CAPTURE_BYTES, MAX_LINE_BYTES,
    HEADERS, RANGE_SEMANTICS, applicable, method, period_identity, profile_sha, series_identity, series_semantics, source_binding)


def _value(row, field):
    value = row.get("fields", {}).get(field)
    return value.get("value") if isinstance(value, dict) else None


def _common(member, edition):
    return {"project_key": member["project_key"], "edition_id": edition["id"]}


def _entity(edition, family, row):
    return None if row is None else row_identity(edition["id"], family, row["key"])


def _by_uid(rows):
    result = defaultdict(list)
    for row in rows:
        result[row.get("uid")].append(row)
    return result


def _unique(index, uid):
    matches = index.get(uid, [])
    return matches[0] if uid is not None and len(matches) == 1 else None


def source_rows(member, edition, emit):
    """Normalize original captured values without calculating or allocating them."""
    common, model = _common(member, edition), edition["model"]
    currency, currency_source = currency_context(member, model)
    resources = _by_uid(model["resources"])
    catalogue = model["field_catalogue"].get("assignments", {})
    for ordinal, row in enumerate(model["assignments"]):
        aid = _entity(edition, "assignments", row)
        resource = _unique(resources, row.get("resource_uid"))
        resource_type = None if resource is None else _value(resource, "TYPE")
        material_label = None if resource is None else _value(resource, "MATERIAL_LABEL")
        for field in sorted(name for name in catalogue if name.startswith("RAW_TIMEPHASED_")):
            pointer = "/assignments/" + str(ordinal) + "/fields/" + pointer_token(field)
            original = row["fields"].get(field)
            entries = original.get("value") if isinstance(original, dict) and original.get("type") == "list" else None
            state = ("not_present_in_fields" if field not in row["fields"] else
                     "null" if original is None else "list" if isinstance(entries, list) else "unsupported_structure")
            definition = catalogue[field]
            dimension = ("money" if field.endswith("_COST") else "material_stored_as_duration" if resource_type == "MATERIAL"
                         else "work" if resource_type == "WORK" else "native_storage")
            source_set_id = digest({"edition": edition["id"], "assignment": row["key"], "field": field, "capture": "fields"})
            emit("timephased_source_sets", {"source_set_id": source_set_id, **common,
                 "assignment_entity_id": aid, "source_key": row["key"], "field": field,
                 "native_data_type": definition.get("data_type"), "definition_sha256": digest(definition),
                 "capture": "fields", "state": state, "span_count": len(entries) if isinstance(entries, list) else None,
                 "value_sha256": digest(original), "source_pointer": pointer,
                 "resource_type": resource_type, "dimension": dimension})
            for index, entry in enumerate(entries if isinstance(entries, list) else []):
                body = entry.get("value", {}) if isinstance(entry, dict) and entry.get("type") == "map" else {}
                start, finish = typed_parts(body.get("start")), typed_parts(body.get("finish"))
                amount, total = typed_parts(body.get("amount_per_hour")), typed_parts(body.get("total_amount"))
                emit("timephased_spans", {"span_id": digest({"set": source_set_id, "ordinal": index}),
                     "source_set_id": source_set_id, **common, "assignment_entity_id": aid,
                     "source_key": row["key"], "field": field, "ordinal": index,
                     "start_text": start["text"], "finish_text": finish["text"],
                     "amount_per_hour_text": amount["text"], "amount_per_hour_type": amount["type"],
                     "amount_per_hour_units": amount["units"], "amount_per_hour_elapsed": amount["elapsed"],
                     "total_amount_text": total["text"], "total_amount_type": total["type"],
                     "total_amount_units": total["units"], "total_amount_elapsed": total["elapsed"],
                     "resource_type": resource_type, "dimension": dimension, "material_label": material_label,
                     "value_json": encoded(entry), "source_pointer": pointer + "/value/" + str(index)})
    for ordinal, row in enumerate(model["resources"]):
        rid = _entity(edition, "resources", row)
        details = row.get("native_details", {})
        prefix = "/resources/" + str(ordinal) + "/native_details"
        for table_index, entries in sorted(details.get("cost_rate_tables", {}).items(), key=lambda item: int(item[0])):
            for index, entry in enumerate(entries or []):
                pointer = prefix + "/cost_rate_tables/" + pointer_token(table_index) + "/" + str(index)
                identity = digest({"edition": edition["id"], "resource": row["key"], "table": table_index, "entry": index})
                cost = typed_parts(entry.get("cost_per_use"))
                emit("resource_rate_entries", {"rate_entry_id": identity, **common, "resource_entity_id": rid,
                     "source_key": row["key"], "table_index": table_index, "entry_ordinal": index,
                     "start_text": typed_parts(entry.get("start"))["text"], "finish_text": typed_parts(entry.get("end"))["text"],
                     "cost_per_use_text": cost["text"], "cost_per_use_type": cost["type"],
                     "currency": currency, "currency_source": currency_source,
                     "value_json": encoded(entry), "source_pointer": pointer})
                for rate_index, rate in sorted(entry.get("rates", {}).items(), key=lambda item: int(item[0])):
                    parts = typed_parts(rate)
                    emit("resource_rate_values", {"rate_value_id": digest({"entry": identity, "rate": rate_index}),
                         "rate_entry_id": identity, **common, "resource_entity_id": rid, "rate_index": rate_index,
                         "amount_text": parts["text"], "units": parts["units"], "currency": currency,
                         "value_json": encoded(rate), "source_pointer": pointer + "/rates/" + pointer_token(rate_index)})
        for index, entry in enumerate(details.get("availability", [])):
            emit("resource_availability", {"availability_id": digest({"edition": edition["id"], "resource": row["key"], "availability": index}),
                 **common, "resource_entity_id": rid, "source_key": row["key"], "ordinal": index,
                 "range_json": encoded(entry.get("range")), "units_text": typed_parts(entry.get("units"))["text"],
                 "value_json": encoded(entry), "source_pointer": prefix + "/availability/" + str(index)})
    for ordinal, row in enumerate(model["calendars"]):
        cid, details = _entity(edition, "calendars", row), row.get("native_details", {})
        prefix = "/calendars/" + str(ordinal) + "/native_details"

        def write(kind, index, value, pointer, **more):
            emit("calendar_rules", {"rule_id": digest({"edition": edition["id"], "calendar": row["key"], "path": pointer}),
                 **common, "calendar_entity_id": cid, "source_key": row["key"],
                 "rule_kind": kind, "ordinal": index, "value_json": encoded(value), "source_pointer": pointer, **more})

        for index, (day, value) in enumerate(details.get("week", {}).items()):
            write("week_day", index, value, prefix + "/week/" + pointer_token(day),
                  weekday=day, day_type=typed_parts(value.get("type"))["text"])
        for index, value in enumerate(details.get("exceptions", [])):
            write("exception", index, value, prefix + "/exceptions/" + str(index), name=value.get("name"),
                  start_text=typed_parts(value.get("from"))["text"], finish_text=typed_parts(value.get("to"))["text"],
                  working=scalar(value.get("working")))
        for index, value in enumerate(details.get("work_weeks", [])):
            write("work_week", index, value, prefix + "/work_weeks/" + str(index), name=value.get("name"))
        for index, name in enumerate(("minutes_per_day", "minutes_per_week", "minutes_per_month", "minutes_per_year")):
            if name in details:
                write("native_unit_conversion", index, details[name], prefix + "/" + name, name=name)


def capture_records(operator_store, descriptor, edition, profile):
    """Read the exact complete retained calculation; no native engine is needed."""
    require(isinstance(descriptor, dict) and descriptor.get("schema") == CAPTURE_SCHEMA
            and descriptor.get("binding") == source_binding(edition, profile),
            "timephased_capture_binding", "Choose the retained native calculation for this exact source and period profile.")
    sha = checked_id(descriptor.get("sha256"))
    require(type(descriptor.get("bytes")) is int and 0 < descriptor["bytes"] <= MAX_CAPTURE_BYTES,
            "timephased_capture_size", "Retain the complete original calculation descriptor.")
    path = operator_store.root / "objects" / sha
    with open_regular(path) as stream:
        before = os.fstat(stream.fileno())
        measured, byte_count, count = hashlib.sha256(), 0, 0

        def read():
            nonlocal byte_count, count
            line = stream.readline(MAX_LINE_BYTES + 1)
            require(line and len(line) <= MAX_LINE_BYTES and line.endswith(b"\n"),
                    "timephased_capture_record", "The native calculation contains a missing or incomplete record.")
            measured.update(line)
            byte_count += len(line)
            count += 1
            require(byte_count <= descriptor["bytes"], "timephased_capture_bytes", "The original calculation grew after capture.")
            value = json.loads(line.decode("utf-8"))
            require(isinstance(value, dict), "timephased_capture_record", "Retain the complete native record object.")
            return value

        header = read()
        require(digest(header) == descriptor.get("header_sha256") and header.get("record") == "header"
                and header.get("schema") == CAPTURE_SCHEMA and header.get("binding") == descriptor["binding"]
                and header.get("profile") == profile and header.get("capture_id") == descriptor.get("capture_id")
                and header.get("capture_id") == digest({"schema": CAPTURE_SCHEMA, "binding": header["binding"], "native": header["native"]})
                and header.get("native", {}).get("version") == edition["model"]["native"]["version"]
                and header.get("native", {}).get("upstream_commit") == edition["model"]["native"]["upstream_commit"],
                "timephased_capture_header", "The retained native calculation header changed.")
        assignment_count, period_count, series_count = len(edition["model"]["assignments"]), len(profile["periods"]), len(profile["series"])
        require(header["assignment_count"] == descriptor.get("assignment_count") == assignment_count
                and header["fact_count"] == descriptor.get("fact_count") == assignment_count * period_count * series_count,
                "timephased_capture_cardinality", "The saved calculation names another complete source selection.")
        definitions = edition["model"]["field_catalogue"].get("assignments", {})
        require(header["field_definitions"] == {item["field"]: definitions.get(item["field"]) for item in profile["series"]},
                "timephased_capture_definition", "The native calculation's selected field definitions changed.")
        require(header.get("series_semantics") == {item["name"]: series_semantics(item) for item in profile["series"]}
                and isinstance(header.get("baseline_calendar"), dict)
                and header.get("input_admission", {}).get("schema") == "portfolio.native-period-admission.v1",
                "timephased_capture_basis", "The original native calendar/range basis is incomplete or changed.")
        yield "header", header
        errors = 0
        for ordinal, row in enumerate(edition["model"]["assignments"]):
            basis = read()
            require(basis.get("record") == "assignment_basis" and basis.get("ordinal") == ordinal
                    and basis.get("assignment_key") == row["key"] and basis.get("assignment_uid") == row["uid"],
                    "timephased_capture_assignment", "The calculation belongs to another original assignment.")
            yield "basis", basis
            for selected in profile["series"]:
                record = read()
                require(record.get("record") == "series" and record.get("assignment_key") == row["key"]
                        and record.get("series") == selected["name"]
                        and record.get("state") in {"native", "not_applicable", "native_error"},
                        "timephased_capture_series", "The original assignment series is missing or out of order.")
                if record["state"] == "native":
                    require(isinstance(record.get("values"), list) and len(record["values"]) == period_count and record.get("error") is None,
                            "timephased_capture_values", "Retain one native value or null for every selected period.")
                else:
                    require(record.get("values") is None, "timephased_capture_values", "A non-value native result contains fabricated period values.")
                    if record["state"] == "native_error":
                        require(isinstance(record.get("error"), dict), "timephased_capture_error", "Retain the actual native calculation error.")
                        errors += 1
                    else:
                        require(record.get("error") is None and not applicable(selected["kind"], basis.get("resource_type")),
                                "timephased_capture_applicability", "The retained native series applicability changed.")
                yield "series", record
        trailer = read()
        require(trailer == {"record": "complete", "capture_id": header["capture_id"], "assignments": assignment_count,
                            "series": assignment_count * series_count, "facts": assignment_count * period_count * series_count,
                            "native_errors": errors, "prior_records": count - 1}
                and descriptor.get("native_errors") == errors and descriptor.get("records") == count and not stream.read(1),
                "timephased_capture_complete", "The complete native calculation footer or file closure changed.")
        after = os.fstat(stream.fileno())
        require(byte_count == descriptor["bytes"] and measured.hexdigest() == sha
                and (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) ==
                    (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns, after.st_ctime_ns),
                "timephased_capture_hash", "The original calculation bytes changed during receiving.")


class _Totals:
    """Bounded-memory scratch aggregation; final decimal text remains exact."""
    def __init__(self, directory):
        self.temporary = tempfile.TemporaryDirectory(prefix="timephased-totals-", dir=directory)
        self.connection = sqlite3.connect(str(Path(self.temporary.name) / "totals.sqlite"))
        self.connection.execute("PRAGMA journal_mode=OFF")
        self.connection.execute("PRAGMA cache_size=-8192")
        self.connection.execute("CREATE TABLE totals (id TEXT PRIMARY KEY, meta TEXT NOT NULL, total TEXT, values_n INTEGER, nulls_n INTEGER, na_n INTEGER, errors_n INTEGER)")

    def add(self, meta, state, number=None):
        identity = digest(meta)
        row = self.connection.execute("SELECT total, values_n, nulls_n, na_n, errors_n FROM totals WHERE id=?", (identity,)).fetchone()
        total, values, nulls, na, errors = row if row else (None, 0, 0, 0, 0)
        if state == "native_value":
            total = str(number) if total is None else exact_sum([decimal_value(total), number])
            values += 1
        elif state == "native_null":
            nulls += 1
        elif state == "not_applicable":
            na += 1
        else:
            errors += 1
        self.connection.execute("INSERT OR REPLACE INTO totals VALUES (?,?,?,?,?,?,?)",
                                (identity, encoded(meta), total, values, nulls, na, errors))

    def rows(self):
        for identity, meta, total, values, nulls, na, errors in self.connection.execute("SELECT * FROM totals ORDER BY id"):
            yield {"total_id": identity, **json.loads(meta), "total_text": total, "value_rows": values,
                   "null_rows": nulls, "not_applicable_rows": na, "error_rows": errors,
                   "completeness": "native_errors" if errors else "native_values_and_nulls" if values
                                   else "all_native_null" if nulls else "not_applicable"}

    def close(self):
        self.connection.close()
        self.temporary.cleanup()


def project_rows(member, edition, profile, descriptor, operator_store, emit, directory, *, stopped=None):
    """Emit one source-bound projection from a complete native capture."""
    source_rows(member, edition, emit)
    common, model = _common(member, edition), edition["model"]
    currency, currency_source = currency_context(member, model)
    selected_sha = profile_sha(profile)
    by_key = {family: {row["key"]: row for row in model[family]}
              for family in ("assignments", "resources", "tasks", "calendars")}
    definitions = model["field_catalogue"].get("assignments", {})
    series_by_name = {item["name"]: item for item in profile["series"]}
    for ordinal, period in enumerate(profile["periods"]):
        emit("timephased_periods", {"period_id": period_identity(edition["id"], profile, period["key"]),
             **common, "profile_sha256": selected_sha, "period_key": period["key"],
             "label": period["label"], "ordinal": ordinal, "start_text": period["start"],
             "finish_text": period["finish"], "range_semantics": RANGE_SEMANTICS})
    for series in profile["series"]:
        definition = definitions.get(series["field"])
        emit("timephased_series", {"series_id": series_identity(edition["id"], profile, series["name"]),
             **common, "profile_sha256": selected_sha, "series": series["name"], "field": series["field"],
             "kind": series["kind"], "requested_units": series.get("units"),
             "native_data_type": None if definition is None else definition.get("data_type"),
             "definition_sha256": digest(definition), "definition_json": encoded(definition),
             "method": method(series), "grain": "original_resource_assignments", **series_semantics(series),
             "source_pointer": "/field_catalogue/assignments/" + pointer_token(series["field"])})
    totals = _Totals(directory)
    capture_id, basis, row, resource, line_number = None, None, None, None, 0
    baseline_value = None
    finding_groups, preview, total_count = {}, [], 0

    def finding(code, series, pointer, error):
        key = (code, series)
        group = finding_groups.setdefault(key, {"code": code, "series": series, "occurrences": 0, "examples": []})
        group["occurrences"] += 1
        if len(group["examples"]) < 10:
            group["examples"].append({"source_pointer": pointer, "error": error})

    try:
        for record_kind, value in capture_records(operator_store, descriptor, edition, profile):
            require(stopped is None or not stopped(), "timephased_interrupted",
                    "Reopen this original reporting projection to continue its retained calculation.")
            line_number += 1
            locator = "source/operator-objects/" + descriptor["sha256"] + "#line=" + str(line_number)
            if record_kind == "header":
                capture_id = value["capture_id"]
                baseline = value["baseline_calendar"]
                baseline_value = baseline.get("value")
                baseline_row = by_key["calendars"].get(baseline.get("key"))
                require(baseline.get("resolution") in {"not_set", "native_object", "derived_native_object"}
                        and ((baseline.get("key") is None and baseline_row is None)
                             or baseline_row is not None and isinstance(baseline_value, dict)
                             and baseline_row["uid"] == baseline_value.get("uid"))
                        and (baseline_row is not None) == (baseline.get("resolution") == "native_object")
                        and (baseline_value is not None) == (baseline.get("resolution") != "not_set"),
                        "timephased_baseline_calendar", "The native baseline calendar points to another original source.")
                for error in baseline.get("findings", []):
                    finding("timephased_native_baseline_finding", "", locator, error)
                emit("timephased_captures", {"capture_id": capture_id, **common,
                     "model_sha256": edition["sha256"], "profile_sha256": selected_sha,
                     "recipe_sha256": value["binding"]["recipe_sha256"], "native_version": value["native"]["version"],
                     "native_runtime_json": encoded(value["native"]), "captured_at": value["captured_at"],
                     "assignment_count": value["assignment_count"], "fact_count": value["fact_count"],
                     "sha256": descriptor["sha256"], "bytes": descriptor["bytes"],
                     "package_path": "source/operator-objects/" + descriptor["sha256"],
                     "baseline_calendar_uid": None if baseline_value is None else baseline_value.get("uid"),
                     "baseline_calendar_entity_id": _entity(edition, "calendars", baseline_row),
                     "baseline_calendar_resolution": baseline["resolution"],
                     "baseline_calendar_sha256": digest(baseline_value),
                     "baseline_calendar_json": encoded(baseline_value),
                     "input_admission_json": encoded(value["input_admission"]),
                     "binding_json": encoded(value["binding"])})
                continue
            if record_kind == "basis":
                basis, row = value, by_key["assignments"][value["assignment_key"]]
                resource = by_key["resources"].get(basis.get("resource_key"))
                task = by_key["tasks"].get(basis.get("task_key"))
                calendar = by_key["calendars"].get(basis.get("calendar_key"))
                require((basis.get("resource_key") is None or resource is not None and resource["uid"] == row.get("resource_uid"))
                        and (basis.get("task_key") is None or task is not None and task["uid"] == row.get("task_uid")),
                        "timephased_basis_links", "The native calculation refers to another original assignment relationship.")
                require(basis.get("resource_resolution") in {"not_set", "native_object"}
                        and basis.get("task_resolution") in {"not_set", "native_object"}
                        and (resource is not None) == (basis.get("resource_resolution") == "native_object")
                        and (task is not None) == (basis.get("task_resolution") == "native_object"),
                        "timephased_basis_resolution", "Retain the original native object's exact source-row resolution.")
                require(resource is None or basis.get("resource_rates_sha256") == digest(resource.get("native_details")),
                        "timephased_basis_rates", "The calculation's native rates differ from the retained original resource.")
                if resource is not None:
                    require(basis.get("resource_type") == _value(resource, "TYPE")
                            and basis.get("material_label") == _value(resource, "MATERIAL_LABEL"),
                            "timephased_basis_resource", "The source resource type or material unit changed.")
                effective = basis.get("effective_calendar")
                require(calendar is None if basis.get("calendar_key") is None else calendar is not None
                        and isinstance(effective, dict) and calendar["uid"] == effective.get("uid"),
                        "timephased_basis_calendar", "The selected effective calendar refers to another source.")
                basis_id = digest({"capture": capture_id, "assignment": row["key"]})
                emit("timephased_assignment_basis", {"basis_id": basis_id, "capture_id": capture_id, **common,
                     "assignment_entity_id": _entity(edition, "assignments", row), "source_key": row["key"],
                     "task_entity_id": _entity(edition, "tasks", task), "task_resolution": basis["task_resolution"],
                     "resource_entity_id": _entity(edition, "resources", resource), "resource_resolution": basis["resource_resolution"],
                     "resource_type": basis.get("resource_type"), "material_label": basis.get("material_label"),
                     "effective_calendar_uid": None if effective is None else effective.get("uid"),
                     "calendar_entity_id": _entity(edition, "calendars", calendar),
                     "calendar_resolution": basis.get("calendar_resolution"), "calendar_sha256": digest(effective),
                     "effective_calendar_json": encoded(effective), "cost_rate_table_json": encoded(basis.get("cost_rate_table")),
                     "resource_rates_sha256": basis.get("resource_rates_sha256"),
                     "native_range_admission_json": encoded(basis.get("native_range_admission")), "source_pointer": locator})
                for error in basis.get("findings", []):
                    finding("timephased_native_basis_finding", "", locator, error)
                continue
            series = series_by_name[value["series"]]
            definition = definitions.get(series["field"])
            sid = series_identity(edition["id"], profile, series["name"])
            aid, rid = _entity(edition, "assignments", row), _entity(edition, "resources", resource)
            bid = digest({"capture": capture_id, "assignment": row["key"]})
            if value["state"] == "native_error":
                finding("timephased_native_calculation_error", series["name"], locator, value["error"])
            for index, period in enumerate(profile["periods"]):
                pid = period_identity(edition["id"], profile, period["key"])
                original = value["values"][index] if value["state"] == "native" else None
                parts = typed_parts(original)
                state = "native_null" if value["state"] == "native" and original is None else "native_value" if value["state"] == "native" else value["state"]
                error, number = value.get("error"), None
                if state == "native_value":
                    try:
                        if series["kind"] == "work":
                            valid_type = (parts["type"] == "duration" and parts["units"] == series["units"]
                                          and type(original.get("elapsed")) is bool
                                          and original["elapsed"] == series["units"].startswith("ELAPSED_"))
                        else:
                            valid_type = parts["type"] in {"integer", "number"}
                        require(valid_type, "timephased_native_value_type",
                                "Retain the selected native value type and exact requested unit.")
                        number = decimal_value(parts["text"])
                    except Exception as invalid:
                        state = "unsupported_native_value"
                        error = {"type": type(invalid).__name__, "message": str(invalid), "original": original}
                        finding("timephased_native_value_error", series["name"], locator + "&period=" + period["key"], error)
                selected_currency = currency if series["kind"] == "money" else None
                selected_currency_source = currency_source if series["kind"] == "money" else None
                units = series.get("units") if series["kind"] == "work" else basis.get("material_label") if series["kind"] == "material" else None
                elapsed = ("true" if series["units"].startswith("ELAPSED_") else "false") if series["kind"] == "work" else None
                meta = {"capture_id": capture_id, **common, "series_id": sid, "series": series["name"],
                        "field": series["field"], "kind": series["kind"], "grain": "original_resource_assignments",
                        "period_id": pid, "period_key": period["key"], "start_text": period["start"], "finish_text": period["finish"],
                        "currency": selected_currency, "currency_source": selected_currency_source,
                        "units": units, "elapsed": elapsed,
                        "material_resource_entity_id": rid if series["kind"] == "material" and state != "not_applicable" else None,
                        "material_label": basis.get("material_label") if series["kind"] == "material" and state != "not_applicable" else None,
                        "native_data_type": None if definition is None else definition.get("data_type"),
                        "definition_sha256": digest(definition)}
                emit("timephased_values", {"fact_id": digest({"capture": capture_id, "assignment": row["key"],
                                                             "series": series["name"], "period": period["key"]}),
                     "capture_id": capture_id, "basis_id": bid, **common, "assignment_entity_id": aid,
                     "source_key": row["key"], "series_id": sid, "series": series["name"], "field": series["field"],
                     "kind": series["kind"], "calendar_basis": series_semantics(series)["calendar_basis"],
                     "calendar_sha256": digest(baseline_value if series["field"].startswith("BASELINE") else basis.get("effective_calendar")),
                     "period_id": pid, "period_key": period["key"],
                     "start_text": period["start"], "finish_text": period["finish"], "state": state,
                     "value_text": parts["text"], "value_type": parts["type"], "units": units, "elapsed": elapsed,
                     "currency": selected_currency, "currency_source": selected_currency_source,
                     "material_label": basis.get("material_label"), "resource_entity_id": rid,
                     "resource_type": basis.get("resource_type"),
                     "native_data_type": meta["native_data_type"], "definition_sha256": meta["definition_sha256"],
                     "value_json": encoded(original), "error_json": encoded(error),
                     "source_pointer": locator + "&period=" + period["key"]})
                totals.add(meta, state, number)
        for total in totals.rows():
            emit("timephased_totals", total)
            total_count += 1
            if len(preview) < 200:
                preview.append(total)
    finally:
        totals.close()
    findings = []
    for group in finding_groups.values():
        value = {"code": group["code"], "severity": "review",
                 "message": "The original native period calculation retained findings; inspect its exact source records and complete fact table.",
                 "details": group}
        findings.append({"id": digest(value), **value})
    return {"findings": findings, "totals_count": total_count, "totals_preview": preview,
            "capture": {"edition_id": edition["id"], "capture_id": descriptor["capture_id"],
                        "sha256": descriptor["sha256"], "bytes": descriptor["bytes"],
                        "assignment_count": descriptor["assignment_count"],
                        "fact_count": descriptor["fact_count"], "native_errors": descriptor["native_errors"]}}
