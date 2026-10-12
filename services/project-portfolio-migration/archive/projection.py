"""Relational reporting from complete original PortfolioWorkspace editions.

Every relationship is resolved within one immutable native edition. Cross-project
UIDs are never joined. Numeric and time values retain their native lexical text;
the original typed value and JSON pointer remain available beside report columns.
"""
from __future__ import annotations

from collections import defaultdict
import hashlib
import json
import re

from portfolio.storage import canonical, digest, require
from .timephased_contract import HEADERS as TIMEPHASED_HEADERS

FAMILIES = ("project", "tasks", "resources", "assignments", "dependencies", "calendars")
TABLES = ("projects", "tasks", "resources", "assignments", "dependencies", "calendars",
          "fields", "field_definitions", "relationships", "native_collections", "sources", "findings",
          "companion_sources", "companion_columns", "companion_rows", "companion_cells", "companion_links")
COLLECTION_EXCLUSIONS = frozenset({"property_values", "tasks", "resources", "assignments", "calendars"})
PREFERRED = {
    "project": ("NAME", "TITLE", "START_DATE", "FINISH_DATE", "STATUS_DATE", "CURRENCY_CODE", "CURRENCY_SYMBOL"),
    "tasks": ("NAME", "START", "FINISH", "DURATION", "WORK", "ACTUAL_WORK", "REMAINING_WORK",
              "COST", "ACTUAL_COST", "BASELINE_COST", "PERCENT_COMPLETE", "SUMMARY", "MILESTONE", "CRITICAL"),
    "resources": ("NAME", "TYPE", "MAX_UNITS", "WORK", "ACTUAL_WORK", "COST", "ACTUAL_COST"),
    "assignments": ("START", "FINISH", "WORK", "ACTUAL_WORK", "REMAINING_WORK", "COST", "ACTUAL_COST", "UNITS"),
    "dependencies": (), "calendars": (),
}
COMMON = ("entity_id", "project_key", "edition_id", "source_key", "uid", "guid",
          "name", "source_pointer", "native_details_json")
FIXED = {
    "companion_sources": ("capture_id", "original_capture_id", "capture_ordinal", "profile_sha256", "project_key", "edition_id", "source_sha256", "label", "role", "format",
                          "profile_json", "row_count", "findings_json", "source_pointer"),
    "companion_columns": ("capture_id", "project_key", "edition_id", "column_key", "name", "ordinal", "definition_json"),
    "companion_rows": ("companion_row_id", "capture_id", "project_key", "edition_id", "source_row_key",
                       "source_record", "source_line", "source_end_line", "native_source_pointer", "cells_json", "source_pointer"),
    "companion_cells": ("companion_row_id", "capture_id", "project_key", "edition_id", "column_key",
                        "value_text", "value_json", "value_sha256", "source_pointer"),
    "companion_links": ("link_id", "capture_id", "original_capture_id", "capture_ordinal", "profile_sha256", "capture_resolution", "project_key", "edition_id", "source_sha256", "source_row_key", "source_column",
                        "family", "target_key", "target_entity_id", "field", "before_json", "after_json", "source_pointer"),
    "fields": ("entity_id", "project_key", "edition_id", "family", "source_key", "capture",
               "field", "value_type", "value_text", "units", "elapsed", "value_json", "value_sha256", "source_pointer"),
    "field_definitions": ("project_key", "edition_id", "family", "field", "definition_json",
                          "definition_sha256", "source_pointer"),
    "relationships": ("relationship_id", "project_key", "edition_id", "source_entity_id", "source_family",
                      "source_key", "role", "target_family", "native_target_uid", "target_entity_id",
                      "target_key", "resolution", "source_pointer"),
    "native_collections": ("project_key", "edition_id", "collection", "value_kind", "item_count",
                           "value_sha256", "value_bytes", "source_pointer", "native_json_path"),
    "sources": ("project_key", "edition_id", "source_sha256", "bytes", "kind", "label", "filename",
                "input_profile_json", "package_path"),
    "findings": ("finding_id", "project_key", "edition_id", "kind", "code", "severity",
                 "source_pointer", "message", "details_json", "original_finding_json"),
}


def encoded(value):
    return canonical(value).decode("utf-8")


def pointer_token(value):
    return str(value).replace("~", "~0").replace("/", "~1")


def scalar(value):
    """A human-readable projection; value_json always retains the complete value."""
    if value is None:
        return None
    if isinstance(value, str):
        return value
    if isinstance(value, bool):
        return "true" if value else "false"
    if isinstance(value, (int, float)):
        return str(value)
    return encoded(value)


def typed_parts(value):
    if value is None:
        return {"type": "null", "text": None, "units": None, "elapsed": None}
    if not isinstance(value, dict) or "type" not in value:
        return {"type": "native", "text": scalar(value), "units": None, "elapsed": None}
    return {"type": value["type"], "text": scalar(value.get("value")),
            "units": scalar(value.get("units")), "elapsed": scalar(value.get("elapsed"))}


def row_identity(edition_id, family, key):
    return digest({"edition_id": edition_id, "family": family, "key": key})


def field_column(field):
    lowered = field.lower()
    if re.fullmatch(r"[a-z][a-z0-9_]{0,95}", lowered):
        return "field__" + lowered
    return "field__" + hashlib.sha256(field.encode("utf-8")).hexdigest()[:24]


def rows_for(model, family):
    rows = [model["project"]] if family == "project" else model[family]
    require(isinstance(rows, list) and all(isinstance(row, dict) and isinstance(row.get("key"), str) for row in rows),
            "archive_native_rows", "The selected edition must retain its original native row keys.", family)
    keys = [row["key"] for row in rows]
    require(len(keys) == len(set(keys)), "archive_native_keys",
            "The selected edition contains repeated original row keys.", family)
    return rows


def available_fields(editions):
    coverage = {family: {} for family in FAMILIES}
    native_families = ("project", "tasks", "resources", "assignments")
    for edition in editions:
        model = edition["model"]
        require(model.get("schema") == "project-portfolio-model.v1",
                "archive_model", "Select an original project portfolio model.")
        for family in native_families:
            catalogue = model.get("field_catalogue", {}).get(family, {})
            require(isinstance(catalogue, dict), "archive_field_catalogue", "Retain the original native field catalogue.")
            for name, definition in catalogue.items():
                require(isinstance(name, str) and name, "archive_field_name", "Retain the actual native field name.")
                info = coverage[family].setdefault(name, {"field": name, "editions": [], "definitions": {}})
                info["editions"].append(edition["id"])
                info["definitions"].setdefault(digest(definition), definition)
    return {family: sorted(items.values(), key=lambda item: item["field"]) for family, items in coverage.items()}


def selected_fields(profile, coverage):
    require(isinstance(profile, dict) and set(profile) <= {"columns"},
            "archive_profile", "Use the named reporting column selection.")
    requested = profile.get("columns")
    require(requested is None or isinstance(requested, dict) and set(requested) <= set(FAMILIES),
            "archive_columns", "Select native field columns by their original family.")
    result = {}
    for family in FAMILIES:
        known = {item["field"] for item in coverage[family]}
        fields = [name for name in PREFERRED[family] if name in known] if requested is None else requested.get(family, [])
        require(isinstance(fields, list) and len(fields) <= 96 and all(isinstance(name, str) for name in fields)
                and len(set(fields)) == len(fields) and set(fields) <= known,
                "archive_columns", "Choose at most 96 distinct original field names in each report family.", family)
        columns = [field_column(name) for name in fields]
        require(len(set(columns)) == len(columns), "archive_column_collision",
                "Selected native fields produce a colliding report column.", family)
        result[family] = list(fields)
    return {"columns": result}


def table_headers(profile):
    headers = {}
    for family in FAMILIES:
        table = "projects" if family == "project" else family
        current = list(COMMON)
        if family == "project":
            current += ["project_label", "source_kind", "model_sha256", "created_at",
                        "tasks_count", "resources_count", "assignments_count", "dependencies_count", "calendars_count",
                        "source_count", "model_path", "native_json_path"]
        if family == "dependencies":
            current += ["predecessor_uid", "successor_uid", "relation_type", "lag_json", "driving", "notes"]
        if family == "calendars":
            current += ["parent_uid", "native_calendar_json"]
        if family == "tasks":
            current += ["parent_uid"]
        if family == "assignments":
            current += ["task_uid", "resource_uid"]
        for name in profile["columns"].get(family, []):
            col = field_column(name)
            current += [col, col + "__type", col + "__units", col + "__elapsed"]
        headers[table] = current
    headers.update({table: list(names) for table, names in FIXED.items()})
    if profile.get("timephased") is not None:
        headers.update({table: list(names) for table, names in TIMEPHASED_HEADERS.items()})
    return headers


def data_dictionary(profile, headers):
    descriptions = {
        "entity_id": "SHA-256 of the exact source edition, family and original row key; joins only this captured edition.",
        "project_key": "Operator-assigned business project identity; one selected edition per project in this cohort.",
        "edition_id": "Original immutable PortfolioWorkspace edition ID.",
        "source_key": "Original native row key; numeric UID and GUID remain separate.",
        "source_pointer": "JSON Pointer into the original retained model.json, or the explicitly named source record.",
        "value_json": "Complete original typed native value encoded as JSON; distinguishes null, empty text and structured values.",
        "value_text": "Readable scalar value; exact numeric lexical text and local date/time have no inferred conversion.",
        "native_details_json": "Complete original native row details, including retained resource or calendar collections.",
        "resolution": "unique, not_set, missing or ambiguous within this exact native edition.",
        "native_json_path": "Relative package path of the byte-exact native JsonWriter output.",
        "field_definitions": "Original native field catalogue per project, family and field; shared names may have different definitions.",
    }
    result = {"schema": "portfolio.archive-data-dictionary.v1",
              "encoding": "UTF-8", "csv": {"delimiter": ",", "quotechar": '"', "newline": "CRLF", "header": True},
              "values": "CSV columns are text. The fields table and complete original models retain lossless types and values.",
              "identity": "Join entities through entity_id. Numeric UIDs and names are never cross-project keys.",
              "nulls": "CSV empty cells alone do not distinguish null and empty text; fields.value_json and original model do.",
              "numbers": "No currency conversion, hours-per-day assumption, timezone inference or cross-project sum is applied.",
              "tables": {}, "relationships": [
                  {"from": "fields.entity_id", "to": "entity table.entity_id", "scope": "family"},
                  {"from": "relationships.source_entity_id", "to": "entity table.entity_id", "scope": "source_family"},
                  {"from": "relationships.target_entity_id", "to": "entity table.entity_id", "scope": "target_family; unique only"},
                  {"from": "entity table.project_key", "to": "projects.project_key", "scope": "this one selected cohort"},
              ]}
    if profile.get("timephased") is not None:
        descriptions.update({
            "capture_id": "Exact retained MPXJ calculation for this source edition, recipe and selected period profile.",
            "period_id": "Source-edition/profile-local requested bounds; native overlap and endpoint-accrual semantics are explicit in each period/series.",
            "assignment_entity_id": "Original assignments.entity_id; task and resource joins remain within that edition.",
            "source_set_id": "Original assignment RAW_TIMEPHASED field; spans retain the original amount-per-hour and total.",
            "calendar_entity_id": "Original calendars.entity_id when the effective native calendar is a retained source object.",
            "effective_calendar_json": "Complete actual assignment effective calendar, including derived calendars; baseline series use the separately retained project baseline calendar.",
            "baseline_calendar_json": "Actual ProjectFile.getBaselineCalendar definition and source resolution used by native baseline series.",
            "calendar_basis": "Selects assignment_effective_calendar or project_baseline_calendar for this actual native series.",
            "boundary_semantics": "Native duration overlap and inclusive endpoint/first-match instant cost rules remain unchanged.",
            "native_range_admission_json": "Exact positive whole-minute equal-width contiguous grid admitted for native pro-rata COST-resource actual amounts, when that path applies.",
            "state": "native_value, native_null, not_applicable, native_error or unsupported_native_value; null is distinct from zero.",
            "value_text": "Exact native numeric lexical text. Currency, work unit, elapsed flag and material resource remain separate.",
            "source_pointer": "Original model JSON Pointer, or the named complete JSONL calculation with 1-based line and selected period.",
            "total_text": "Exact decimal sum of original native assignment values for one project, series, period and dimension.",
            "material_resource_entity_id": "Material quantities aggregate only for this exact original resource; labels alone never join resources.",
            "native_data_type": "Original MPXJ field catalogue data type used to bind work, currency and material series.",
            "definition_sha256": "Content identity of the complete original native field definition.",
            "completeness": "Native values/nulls/applicability/errors are counted separately; an all-null group has no numeric total.",
        })
        result["timephased"] = {
            "profile": profile["timephased"], "grain": "original_resource_assignments",
            "calculation": "Original ResourceAssignment period getters from the selected retained edition/recipe.",
            "storage": "Complete UTF-8 JSONL under source/operator-objects; source identity appears in timephased_captures.",
            "scope": "Assignment-period values. Task fixed cost, unsourced allocations and cross-project currency conversion are not added.",
            "totals": "Group by project, edition, series, period, currency, work units/elapsed and exact material resource.",
            "nulls": "Native null is preserved; a reported zero remains a numeric value. Error rows remain in the complete fact table.",
            "receiving": "Recomputes relational rows from original models and retained native calculation bytes without starting MPXJ.",
        }
        result["relationships"].extend([
            {"from": "timephased_values.assignment_entity_id", "to": "assignments.entity_id"},
            {"from": "timephased_values.period_id", "to": "timephased_periods.period_id"},
            {"from": "timephased_values.series_id", "to": "timephased_series.series_id"},
            {"from": "timephased_values.basis_id", "to": "timephased_assignment_basis.basis_id"},
            {"from": "timephased_assignment_basis.calendar_entity_id", "to": "calendars.entity_id", "scope": "original native object only"},
            {"from": "timephased_assignment_basis.resource_entity_id", "to": "resources.entity_id"},
            {"from": "timephased_assignment_basis.task_entity_id", "to": "tasks.entity_id"},
            {"from": "timephased_spans.source_set_id", "to": "timephased_source_sets.source_set_id"},
            {"from": "resource_rate_values.rate_entry_id", "to": "resource_rate_entries.rate_entry_id"},
            {"from": "timephased_values.capture_id", "to": "timephased_captures.capture_id"},
            {"from": "timephased_captures.baseline_calendar_entity_id", "to": "calendars.entity_id", "scope": "actual original baseline calendar; derived definitions retained in JSON"},
        ])
    for table, names in headers.items():
        family = "project" if table == "projects" else table
        generated = {}
        if family in FAMILIES:
            for field in profile["columns"].get(family, []):
                prefix = field_column(field)
                for suffix, meaning in (("", "Readable exact scalar text"),
                                        ("__type", "Original native value type"),
                                        ("__units", "Original native duration/rate units"),
                                        ("__elapsed", "Original elapsed-time flag")):
                    generated[prefix + suffix] = {"source_field": field, "capture": "fields", "meaning": meaning}
        result["tables"][table] = {"columns": [
            {"name": name, "storage": "text", "description": descriptions.get(name, ""), **generated.get(name, {})}
            for name in names
        ]}
    return result


class Projection:
    def __init__(self, profile, emit):
        self.profile, self.emit = profile, emit
        self.counts = {table: 0 for table in TABLES}
        self.relationship_findings = []

    def write(self, table, row):
        self.counts[table] += 1
        self.emit(table, row)

    def member(self, member, edition):
        model, eid, project_key = edition["model"], edition["id"], member["project_key"]
        require(model.get("schema") == "project-portfolio-model.v1",
                "archive_model", "Select a complete original native model.")
        indices = {}
        original_rows = {}
        for family in FAMILIES:
            rows = rows_for(model, family)
            original_rows[family] = rows
            index = defaultdict(list)
            for row in rows:
                if row.get("uid") is not None:
                    index[str(row["uid"])].append(row)
            indices[family] = index
        common = {"project_key": project_key, "edition_id": eid}

        def relationship(row, family, source_pointer, role, target_family, uid):
            matches = indices[target_family].get(str(uid), []) if uid is not None else []
            resolution = "not_set" if uid is None else "unique" if len(matches) == 1 else "ambiguous" if matches else "missing"
            target = matches[0] if len(matches) == 1 else None
            value = {**common, "source_entity_id": row_identity(eid, family, row["key"]),
                     "source_family": family, "source_key": row["key"], "role": role,
                     "target_family": target_family, "native_target_uid": scalar(uid),
                     "target_entity_id": row_identity(eid, target_family, target["key"]) if target else None,
                     "target_key": target["key"] if target else None, "resolution": resolution,
                     "source_pointer": source_pointer}
            value["relationship_id"] = digest(value)
            self.write("relationships", value)
            if resolution in ("missing", "ambiguous"):
                finding = {"code": "archive_relationship_" + resolution, "severity": "review",
                           "path": source_pointer,
                           "message": "This native relationship does not identify one row in the selected original edition.",
                           "details": {"family": family, "key": row["key"], "role": role,
                                       "target_family": target_family, "uid": uid,
                                       "matches": [x["key"] for x in matches]}}
                finding["id"] = digest(finding)
                self.relationship_findings.append({**common, **finding})
                self.finding(common, finding, "reporting")

        for family, rows in original_rows.items():
            table = "projects" if family == "project" else family
            for ordinal, row in enumerate(rows):
                location = "/project" if family == "project" else "/" + family + "/" + str(ordinal)
                eid_row = row_identity(eid, family, row["key"])
                fields, cached = row.get("fields", {}), row.get("cached_fields", {})
                require(isinstance(fields, dict) and isinstance(cached, dict),
                        "archive_native_fields", "Retain the original native field dictionaries.", location)
                name = typed_parts(fields.get("NAME"))["text"]
                if name is None and family == "calendars" and isinstance(row.get("native"), dict):
                    name = scalar(row["native"].get("name"))
                entity = {**common, "entity_id": eid_row, "source_key": row["key"],
                          "uid": scalar(row.get("uid")), "guid": scalar(row.get("guid")), "name": name,
                          "source_pointer": location,
                          "native_details_json": encoded(row.get("native_details")) if "native_details" in row else None}
                if family == "project":
                    entity.update(project_label=member["label"], source_kind=edition["kind"],
                                  model_sha256=edition["sha256"], created_at=edition["created_at"],
                                  source_count=str(len(edition["source_ids"])),
                                  model_path="source/portfolio-objects/" + edition["sha256"],
                                  native_json_path="source/native-json/" + model["native_json_identity"]["sha256"] + ".json")
                    entity.update({f + "_count": str(len(original_rows[f])) for f in FAMILIES if f != "project"})
                elif family == "dependencies":
                    entity.update(predecessor_uid=scalar(row.get("predecessor_uid")),
                                  successor_uid=scalar(row.get("successor_uid")), relation_type=scalar(row.get("type")),
                                  lag_json=encoded(row.get("lag")), driving=scalar(row.get("driving")), notes=scalar(row.get("notes")))
                elif family == "calendars":
                    entity.update(parent_uid=scalar(row.get("parent_uid")), native_calendar_json=encoded(row.get("native")))
                elif family == "tasks":
                    entity["parent_uid"] = scalar(row.get("parent_uid"))
                elif family == "assignments":
                    entity.update(task_uid=scalar(row.get("task_uid")), resource_uid=scalar(row.get("resource_uid")))
                for field in self.profile["columns"].get(family, []):
                    parts, col = typed_parts(fields.get(field)), field_column(field)
                    entity.update({col: parts["text"], col + "__type": parts["type"] if field in fields else "absent",
                                   col + "__units": parts["units"], col + "__elapsed": parts["elapsed"]})
                self.write(table, entity)
                for capture, values in (("fields", fields), ("cached_fields", cached)):
                    for field, value in values.items():
                        parts = typed_parts(value)
                        self.write("fields", {**common, "entity_id": eid_row, "family": family,
                                   "source_key": row["key"], "capture": capture, "field": field,
                                   "value_type": parts["type"], "value_text": parts["text"],
                                   "units": parts["units"], "elapsed": parts["elapsed"],
                                   "value_json": encoded(value), "value_sha256": digest(value),
                                   "source_pointer": location + "/" + capture + "/" + pointer_token(field)})
                # Native ProjectCalendar references and the actual standard numeric
                # calendar field join only inside this immutable source edition.
                for field, value in fields.items():
                    selected_uid, is_calendar = None, False
                    if isinstance(value, dict) and value.get("type") == "reference" and value.get("java_class") == "org.mpxj.ProjectCalendar":
                        reference = value.get("value")
                        if isinstance(reference, dict) and "uid" in reference:
                            selected_uid, is_calendar = reference["uid"], True
                    elif field == "CALENDAR_UNIQUE_ID" and field in model.get("field_catalogue", {}).get(family, {}):
                        if isinstance(value, dict) and value.get("type") == "integer" and isinstance(value.get("value"), str):
                            selected_uid, is_calendar = value["value"], True
                    if is_calendar:
                        relationship(row, family, location + "/fields/" + pointer_token(field),
                                     "calendar:" + field, "calendars", selected_uid)
                if family == "tasks":
                    relationship(row, family, location + "/parent_uid", "parent", "tasks", row.get("parent_uid"))
                elif family == "assignments":
                    relationship(row, family, location + "/task_uid", "task", "tasks", row.get("task_uid"))
                    relationship(row, family, location + "/resource_uid", "resource", "resources", row.get("resource_uid"))
                elif family == "dependencies":
                    relationship(row, family, location + "/predecessor_uid", "predecessor", "tasks", row.get("predecessor_uid"))
                    relationship(row, family, location + "/successor_uid", "successor", "tasks", row.get("successor_uid"))
                elif family == "calendars":
                    relationship(row, family, location + "/parent_uid", "parent", "calendars", row.get("parent_uid"))

        capture_selectors = {row["ordinal"]: row for row in edition.get("companion_captures", [])}
        archive_captures = {}
        for capture_ordinal, capture in enumerate(model.get("companions", [])):
            location = "/companions/" + str(capture_ordinal)
            capture_id = digest({"edition_id": eid, "ordinal": capture_ordinal, "source_id": capture["source_id"],
                                 "profile": capture.get("profile")})
            selector = capture_selectors.get(capture_ordinal, {})
            archive_captures[capture_ordinal] = {"archive_id": capture_id, "source_id": capture["source_id"],
                                               "capture_id": selector.get("capture_id"),
                                               "profile_sha256": digest(capture.get("profile"))}
            self.write("companion_sources", {**common, "capture_id": capture_id,
                       "original_capture_id": selector.get("capture_id"), "capture_ordinal": str(capture_ordinal),
                       "profile_sha256": digest(capture.get("profile")), "source_sha256": capture["source_id"],
                       "label": capture.get("label"), "role": capture.get("role"), "format": capture.get("format"),
                       "profile_json": encoded(capture.get("profile")), "row_count": str(capture.get("row_count", len(capture.get("rows", [])))),
                       "findings_json": encoded(capture.get("findings", [])), "source_pointer": location})
            for ordinal, column in enumerate(capture.get("columns", [])):
                self.write("companion_columns", {**common, "capture_id": capture_id, "column_key": column["key"],
                           "name": column.get("name"), "ordinal": str(column.get("ordinal", ordinal)),
                           "definition_json": encoded(column)})
            for ordinal, row in enumerate(capture.get("rows", [])):
                row_pointer = location + "/rows/" + str(ordinal)
                row_id = digest({"capture_id": capture_id, "row_key": row["key"]})
                self.write("companion_rows", {**common, "companion_row_id": row_id, "capture_id": capture_id,
                           "source_row_key": row["key"], "source_record": scalar(row.get("source_record")),
                           "source_line": scalar(row.get("source_line")), "source_end_line": scalar(row.get("source_end_line")),
                           "native_source_pointer": scalar(row.get("source_pointer")),
                           "cells_json": encoded(row["cells"]), "source_pointer": row_pointer})
                for column, value in row["cells"].items():
                    lexical = value.get("json_number") if isinstance(value, dict) and set(value) == {"json_number"} else scalar(value)
                    self.write("companion_cells", {**common, "companion_row_id": row_id, "capture_id": capture_id,
                               "column_key": column, "value_text": lexical, "value_json": encoded(value),
                               "value_sha256": digest(value), "source_pointer": row_pointer + "/cells/" + pointer_token(column)})
        for ordinal, link in enumerate(model.get("companion_links", [])):
            family = link["family"]
            matches = [row for row in original_rows.get(family, []) if row["key"] == link["key"]]
            captures = [(number, captured) for number, captured in archive_captures.items()
                        if captured["source_id"] == link["source_id"]
                        and ("capture_id" not in link or captured["capture_id"] == link["capture_id"])
                        and ("capture_ordinal" not in link or number == link["capture_ordinal"])
                        and ("profile_sha256" not in link or captured["profile_sha256"] == link["profile_sha256"])]
            captured_ordinal, captured = captures[0] if len(captures) == 1 else (None, None)
            capture_resolution = "unique" if captured else "ambiguous" if captures else "missing"
            if not captured:
                finding = {"code": "archive_companion_capture_" + capture_resolution, "severity": "review",
                           "path": "/companion_links/" + str(ordinal),
                           "message": "The retained source-cell link does not name one captured companion profile.",
                           "details": {"source_id": link["source_id"], "capture_id": link.get("capture_id"),
                                       "matches": [number for number, _ in captures]}}
                finding["id"] = digest(finding)
                self.relationship_findings.append({**common, **finding})
                self.finding(common, finding, "reporting")
            self.write("companion_links", {**common, "link_id": digest({"edition_id": eid, "ordinal": ordinal, "link": link}),
                       "capture_id": captured["archive_id"] if captured else None,
                       "original_capture_id": link.get("capture_id"), "capture_ordinal": scalar(captured_ordinal),
                       "profile_sha256": link.get("profile_sha256"), "capture_resolution": capture_resolution,
                       "source_sha256": link["source_id"], "source_row_key": link["source_row"],
                       "source_column": link["source_column"], "family": family, "target_key": link["key"],
                       "target_entity_id": row_identity(eid, family, link["key"]) if len(matches) == 1 else None,
                       "field": link["field"], "before_json": encoded(link.get("before")), "after_json": encoded(link.get("after")),
                       "source_pointer": "/companion_links/" + str(ordinal)})
        for family, definitions in model.get("field_catalogue", {}).items():
            for name, definition in definitions.items():
                self.write("field_definitions", {**common, "family": family, "field": name,
                           "definition_json": encoded(definition), "definition_sha256": digest(definition),
                           "source_pointer": "/field_catalogue/" + pointer_token(family) + "/" + pointer_token(name)})
        native = model.get("native_json", {})
        require(isinstance(native, dict), "archive_native_json", "Retain the complete native JsonWriter object.")
        for name, value in native.items():
            if name in COLLECTION_EXCLUSIONS:
                continue
            raw = canonical(value)
            self.write("native_collections", {**common, "collection": name,
                       "value_kind": "array" if isinstance(value, list) else "object" if isinstance(value, dict) else "scalar",
                       "item_count": str(len(value)) if isinstance(value, (list, dict)) else "1",
                       "value_sha256": hashlib.sha256(raw).hexdigest(), "value_bytes": str(len(raw)),
                       "source_pointer": "/" + pointer_token(name),
                       "native_json_path": "source/native-json/" + model["native_json_identity"]["sha256"] + ".json"})
        for source in edition.get("sources", []):
            self.write("sources", {**common, "source_sha256": source["sha256"], "bytes": str(source["bytes"]),
                       "kind": source.get("kind"), "label": source.get("label"), "filename": source.get("filename"),
                       "input_profile_json": encoded(source.get("input_profile", source.get("companion_profile"))),
                       "package_path": "source/portfolio-objects/" + source["sha256"]})
        for finding in edition.get("findings", []):
            self.finding(common, finding, "native")

    def finding(self, common, finding, kind):
        self.write("findings", {**common, "finding_id": finding.get("id") or digest(finding), "kind": kind,
                   "code": finding.get("code"), "severity": finding.get("severity", "review"),
                   "source_pointer": finding.get("path"), "message": finding.get("message"),
                   "details_json": encoded(finding.get("details")), "original_finding_json": encoded(finding)})
