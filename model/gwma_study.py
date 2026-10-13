"""Regional pathogen study intake, explicit scientific review and editable handover.

Uses the original Workspace, source object store and observation intake. No risk
model is selected here; complete input contracts and original observations travel
with the study for the named laboratory and risk-model leads.
"""
from __future__ import annotations
import base64
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import html
import io
import json
from pathlib import Path
import re
import tempfile
import zipfile
from .common import atomic_bytes, canonical, digest, file_digest, relative_file
from . import observations

PLURALS = {"study": "studies", "mapping": "mappings", "batch": "batches", "review": "reviews",
           "contract": "contracts", "plan": "plans", "handover": "handovers"}
KINDS = {name: "gwma-" + plural for name, plural in PLURALS.items()}
FIELDS = ("result_id", "sample_id", "station_id", "watershed", "event_id",
          "collected_at", "timezone", "weather", "matrix", "parameter", "method",
          "fraction", "value", "unit", "qualifier", "detected", "mdl", "rl",
          "laboratory", "batch_id", "sample_type", "replicate_id", "qa_code",
          "qa_note", "latitude", "longitude")
MAX_UPLOAD = 4 * 1024 * 1024
PROFILE_PATH = Path(__file__).with_name("gwma_source_contracts.json")


def _text(value, name, *, required=False):
    if not isinstance(value, str):
        raise ValueError(name + " must be text")
    value = value.strip()
    if required and not value:
        raise ValueError("Supply " + name)
    return value


def _object(value, name):
    if not isinstance(value, dict):
        raise ValueError(name + " must be an object")
    return value


def _strings(value, name):
    value = _object(value, name)
    if any(key not in FIELDS or not isinstance(item, str) for key, item in value.items()):
        raise ValueError(name + " requires supported field names and text values")
    return dict(value)


def profiles():
    supplied = json.loads(PROFILE_PATH.read_text(encoding="utf-8")) if PROFILE_PATH.exists() else {}
    rows = supplied.get("profiles", [])
    if not isinstance(rows, list) or any(not isinstance(row, dict) or not row.get("id") for row in rows):
        raise ValueError("Installed GWMA source contracts are malformed")
    return [{"id": "mapped_csv", "title": "Map an original laboratory or agency CSV",
             "columns": {}, "constants": {}, "required_fields": ["parameter", "value", "unit"]},
            *[row for row in rows if row["id"] != "mapped_csv"]]


def item(workspace, kind, key):
    if kind not in KINDS:
        raise ValueError("Choose a study, mapping, batch, review, contract, plan or handover")
    return workspace._get(KINDS[kind], key)


def _save(workspace, kind, value):
    return workspace._save(KINDS[kind], value)


def _study(workspace, payload):
    return item(workspace, "study", payload["study_id"])


def _same_study(study, *records):
    if any(record.get("study_id") != study["id"] for record in records):
        raise ValueError("Select editions from the same retained study")


def save_study(workspace, payload):
    title = _text(payload.get("title", ""), "study title", required=True)
    areas = payload.get("watersheds", [])
    if not isinstance(areas, list) or not areas or any(not isinstance(a, str) or not a.strip() for a in areas):
        raise ValueError("List the study's named watershed areas")
    if len(set(areas)) != len(areas):
        raise ValueError("Watershed areas must be distinct")
    owners = _object(payload.get("owners", {}), "study owners")
    if any(not isinstance(v, str) for v in owners.values()):
        raise ValueError("Study owner names must be text")
    return _save(workspace, "study", {"title": title, "watersheds": areas,
                 "owners": owners, "notes": _text(payload.get("notes", ""), "study notes")})


def save_mapping(workspace, payload):
    study = _study(workspace, payload)
    profile_id = payload.get("profile", "mapped_csv")
    profile = next((row for row in profiles() if row["id"] == profile_id), None)
    if profile is None:
        raise ValueError("Choose an installed source profile or map the original CSV")
    columns = {**profile.get("columns", {}), **_strings(payload.get("columns", {}), "mapping columns")}
    constants = {**profile.get("constants", {}), **_strings(payload.get("constants", {}), "mapping constants")}
    columns = {key: value for key, value in columns.items() if value}
    for name in profile.get("required_fields", ["parameter", "value", "unit"]):
        if name not in columns and name not in constants:
            raise ValueError("Map the original " + name + " field")
    return _save(workspace, "mapping", {"study_id": study["id"],
                 "title": _text(payload.get("title", ""), "mapping title", required=True),
                 "profile": profile_id, "profile_contract": profile,
                 "columns": columns, "constants": constants})


def _decimal(value):
    try:
        number = Decimal(str(value).strip())
        return number if number.is_finite() else None
    except (InvalidOperation, TypeError, ValueError):
        return None


def _issue(code, field, message):
    return {"code": code, "field": field, "message": message}


def _collection(fields, profile):
    """Parse only the selected source's date formats; retain the original text."""
    raw = fields.get("collected_at", "")
    result = {"original": raw, "parsed_local": None, "source_timezone": fields.get("timezone", ""),
              "offset_present": False, "time_precision": "unknown", "midnight_may_mean_unknown": False}
    if not raw:
        return result, []
    parsed = None
    try:
        parsed = dt.datetime.fromisoformat(raw.replace("Z", "+00:00"))
    except ValueError:
        pass
    selected = profile.get("collection_formats", [])
    if not isinstance(selected, list):
        raise ValueError("The installed collection_formats must be a list")
    formats = list(selected)
    if profile.get("collection_datetime_format") == "MM/DD/YYYY HH:MM":
        formats.append("%m/%d/%Y %H:%M")
    for pattern in formats:
        if parsed is not None:
            break
        if not isinstance(pattern, str):
            raise ValueError("The installed collection format must be text")
        try:
            parsed = dt.datetime.strptime(raw, pattern)
        except ValueError:
            pass
    if parsed is None:
        return result, [_issue("collection_time", "collected_at",
                               "Review the original collection date/time against this selected source profile")]
    result["parsed_local"] = parsed.isoformat()
    result["offset_present"] = parsed.utcoffset() is not None
    has_time = bool(re.search(r"(?:T|\s)\d{1,2}:\d{2}", raw))
    result["time_precision"] = "reported_time" if has_time else "date_only"
    issues = []
    if not result["offset_present"] and not result["source_timezone"]:
        issues.append(_issue("collection_timezone", "timezone",
                             "Record or explicitly review the source collection timezone; no UTC offset was inferred"))
    if not has_time:
        issues.append(_issue("collection_time_precision", "collected_at",
                             "The original value supplies a date only; preserve the missing collection time"))
    if (profile.get("detection_contract") == "ceden_2_chemistry" and has_time
            and parsed.hour == 0 and parsed.minute == 0):
        result["midnight_may_mean_unknown"] = True
        issues.append(_issue("collection_midnight", "collected_at",
                             "CEDEN 2.0 00:00 may mean unknown collection time; retain a source-backed decision"))
    return result, issues


def assess(fields, profile):
    """Preserve original numeric text and profile-specific detection semantics."""
    issues = []
    for name in ("station_id", "collected_at", "parameter", "method", "matrix", "unit"):
        if not fields.get(name):
            issues.append(_issue("missing_" + name, name, "Supply or review the original " + name))
    collection, time_issues = _collection(fields, profile)
    issues.extend(time_issues)
    if fields.get("weather") and fields["weather"].lower() not in ("wet", "dry", "unknown"):
        issues.append(_issue("weather_class", "weather", "Review the source wet/dry event classification"))
    value = fields.get("value", "").strip()
    detected = fields.get("detected", "").strip().upper()
    qualifier = fields.get("qualifier", "").strip().upper()
    ceden2 = profile.get("detection_contract") == "ceden_2_chemistry"
    qa_tokens = {part.strip().upper() for part in fields.get("qa_code", "").split(",") if part.strip()}
    dnq = "DNQ" in qa_tokens if ceden2 else qualifier == "DNQ"
    number, bound, bound_value = _decimal(value), "", None
    match = re.fullmatch(r"\s*(<=|>=|<|>)\s*(.+?)\s*", value)
    if match:
        bound, bound_value = match.group(1), _decimal(match.group(2))
        if bound_value is None or bound_value < 0:
            issues.append(_issue("bound_value", "value", "Original censor bound is not a finite nonnegative concentration"))
    nondetect = detected == "N" or qualifier in ("ND", "U", "NONDETECT", "NON-DETECT")
    censoring = "less_than" if bound in ("<", "<=") else "greater_than" if bound else (
        "nondetect" if nondetect else "detected_not_quantified" if dnq else "estimated" if qualifier == "J" else
        "quantified" if number is not None else "unquantified")
    if detected and detected not in ("Y", "N"):
        issues.append(_issue("detected_flag", "detected", "Review the source detection flag"))
    if ceden2 and not detected:
        issues.append(_issue("ceden2_detection_required", "detected", "CEDEN 2.0 requires the original Y/N detection flag"))
    if ceden2 and detected == "N" and value:
        issues.append(_issue("ceden2_nondetect_result", "value",
                             "CEDEN 2.0 nondetects require a blank Result; retain and review this source value"))
    if detected == "Y" and (bound or qualifier in ("ND", "U", "NONDETECT", "NON-DETECT")):
        issues.append(_issue("detection_conflict", "detected", "DetectedAboveMDL conflicts with the original qualifier or bound"))
    if not value and not nondetect:
        issues.append(_issue("missing_result", "value", "Review the blank result and its detection/qualification basis"))
    if value and number is None and not bound and not nondetect:
        issues.append(_issue("nonnumeric_result", "value", "Retain and review the original nonnumeric result"))
    if number is not None and number < 0:
        issues.append(_issue("negative_result", "value", "Review the negative result or source sentinel"))
    limits = {}
    documented_bacteria = {"E. coli", "Coliform, Total", "Coliform, Fecal", "Enterococcus"}
    selected_bacteria = set(profile.get("indicator_bacteria_analytes", [])) & documented_bacteria
    for name in ("mdl", "rl"):
        raw = fields.get(name, "").strip()
        num = _decimal(raw) if raw else None
        sentinel = (ceden2 and name == "mdl" and num == Decimal(-88) and
                    fields.get("parameter") in selected_bacteria)
        usable = num is not None and num >= 0 and not sentinel
        limits[name] = {"original": raw, "numeric": str(num) if usable else None,
                        "sentinel": "indicator_bacteria_not_applicable" if sentinel else None}
        if raw and (num is None or (num < 0 and not sentinel)):
            issues.append(_issue("invalid_" + name, name, "Review the original detection/reporting limit or sentinel"))
        if ceden2 and not raw:
            issues.append(_issue("missing_" + name, name, "CEDEN 2.0 requires the original detection/reporting limit"))
        if ceden2 and num is not None and num == 0:
            issues.append(_issue("nonpositive_" + name, name, "Review the nonpositive CEDEN 2.0 detection/reporting limit"))
    mdl, rl = (_decimal(limits[key]["numeric"]) for key in ("mdl", "rl"))
    if mdl is not None and rl is not None and (mdl >= rl if ceden2 else mdl > rl):
        issues.append(_issue("limit_order", "mdl", "Review detection and reporting limits; CEDEN 2.0 requires MRL greater than MDL"))
    if ceden2:
        if qualifier == "DNQ" and not dnq:
            issues.append(_issue("ceden2_dnq_field", "qa_code",
                                 "CEDEN 2.0 DNQ belongs in the original QACode; review this separately mapped qualifier"))
        positive_limits = mdl is not None and rl is not None and 0 < mdl < rl
        between = positive_limits and number is not None and mdl < number < rl
        if between and (not dnq or detected != "Y"):
            issues.append(_issue("ceden2_estimated_dnq", "qa_code",
                                 "A result between positive MDL and MRL requires Y and DNQ in the original QACode"))
        if dnq and (detected != "Y" or number is None or bound or
                    positive_limits and not between):
            issues.append(_issue("ceden2_dnq_conflict", "qa_code",
                                 "Review DNQ against the original numeric result, detection flag and positive MDL/MRL"))
        if dnq and not positive_limits:
            issues.append(_issue("ceden2_dnq_limits", "qa_code",
                                 "DNQ needs a reviewed limit basis; an unknown/sentinel MDL is not a numeric censor bound"))
        if number is not None and mdl is not None and mdl > 0 and number <= mdl:
            issues.append(_issue("ceden2_result_mdl", "value",
                                 "Review the result at or below MDL against the original detection and laboratory decision"))
        if number is not None and rl is not None and rl > 0 and number == rl:
            issues.append(_issue("ceden2_reporting_boundary", "value",
                                 "Retain the laboratory's explicit decision for a result exactly at MRL"))
    if qualifier and qualifier not in ("ND", "U", "NONDETECT", "NON-DETECT", "DNQ", "J", "="):
        issues.append(_issue("source_qualifier", "qualifier", "Review the source result qualifier"))
    if fields.get("qa_code") or fields.get("qa_note"):
        issues.append(_issue("source_qa", "qa_code", "Review the original laboratory or agency QA annotations"))
    for name, low, high in (("latitude", -90, 90), ("longitude", -180, 180)):
        if fields.get(name):
            coordinate = _decimal(fields[name])
            if coordinate is None or not Decimal(low) <= coordinate <= Decimal(high):
                issues.append(_issue("invalid_" + name, name, "Review the original coordinate"))
    return {"censoring": censoring,
            "numeric_value": str(number) if number is not None and number >= 0 and censoring in ("quantified", "estimated") else None,
            "bound_operator": bound or None,
            "bound_value": str(bound_value) if bound_value is not None and bound_value >= 0 else None,
            "limits": limits, "collection": collection, "issues": issues}


def _raw_fields(original, mapping):
    columns, constants = mapping["columns"], mapping["constants"]
    return {name: constants[name] if name in constants else
            str(original.get(columns.get(name), "") or "").strip() for name in FIELDS}


def intake(workspace, payload):
    mapping = item(workspace, "mapping", payload["mapping_id"])
    study = item(workspace, "study", mapping["study_id"])
    choices = sum(bool(payload.get(key)) for key in ("observation_id", "csv_base64", "source_collection_id"))
    if choices != 1:
        raise ValueError("Select one original observation, registered source, or CSV upload")
    provenance = {}
    title = _text(payload.get("title", ""), "batch title", required=True)
    source_uri = _text(payload.get("source_uri", ""), "original source URI", required=True)
    if payload.get("observation_id"):
        observed = workspace._get("observations", payload["observation_id"])
        original_path = relative_file(workspace.root, observed["original"]["object"])
        if file_digest(original_path) != observed["original"]["sha256"]:
            raise ValueError("The retained original CSV changed")
    else:
        temporary = None
        try:
            if payload.get("source_collection_id"):
                original_path, _ = workspace.source_file(payload["source_collection_id"], payload["source_id"])
                provenance = {"gwma_source_collection_id": payload["source_collection_id"],
                              "gwma_source_id": payload["source_id"]}
            else:
                encoded = payload["csv_base64"]
                if not isinstance(encoded, str) or len(encoded) > (MAX_UPLOAD + 2) // 3 * 4:
                    raise ValueError("Use an existing source or observation for CSVs over 4 MiB")
                body = base64.b64decode(encoded, validate=True)
                if len(body) > MAX_UPLOAD:
                    raise ValueError("Use an existing source or observation for CSVs over 4 MiB")
                filename = Path(payload.get("filename", "original.csv")).name
                if not filename or filename in (".", ".."):
                    raise ValueError("Supply the original CSV filename")
                temporary = tempfile.TemporaryDirectory(prefix="gwma-intake-", dir=workspace.root)
                original_path = Path(temporary.name) / filename
                original_path.write_bytes(body)
            # The original context importer retains every original cell and exact
            # source bytes. Source result IDs are data, not a uniqueness filter.
            mapped = {key: mapping["columns"].get(key, "__gwma_unmapped_" + key) for key in
                      ("station_id", "parameter", "value", "unit", "qualifier", "method")}
            mapped["record_id"] = "__gwma_original_record_ordinal__"
            context_constants = {key: val for key, val in mapping["constants"].items() if key in mapped}
            observed = observations.ingest(workspace, original_path, {
                "title": title, "source_uri": source_uri, "columns": mapped,
                "constants": context_constants, "value_basis": "original_context",
                "observation_kind": "pathogen_study", "time_support": "original_sample", **provenance})
        finally:
            if temporary:
                temporary.cleanup()
    provenance = {key: observed.get("metadata", {}).get(key) for key in
                  ("gwma_source_collection_id", "gwma_source_id")}
    if any(provenance.values()):
        if not all(provenance.values()):
            raise ValueError("The original observation has incomplete registered-source provenance")
        _, entry = workspace.source_file(provenance["gwma_source_collection_id"], provenance["gwma_source_id"])
        if entry["body"]["sha256"] != observed["original"]["sha256"]:
            raise ValueError("The registered source differs from the original observation")
    headers = observed["columns"]
    missing = sorted(set(mapping["columns"].values()) - set(headers))
    if missing:
        raise ValueError("Original CSV lacks mapped columns: " + ", ".join(missing))
    rows = []
    for ordinal, source in enumerate(observed["rows"], 1):
        fields = _raw_fields(source["original"], mapping)
        evaluated = assess(fields, mapping["profile_contract"])
        if fields["watershed"] and fields["watershed"] not in study["watersheds"]:
            evaluated["issues"].append(_issue("study_watershed", "watershed", "Assign this source area to the study's named watershed"))
        row_id = digest({"source_sha256": observed["original"]["sha256"], "record": ordinal})
        rows.append({"row_id": row_id, "source_record": ordinal, "source_line": source["line"],
                     "fields": fields, "assessment": evaluated})
    return _save(workspace, "batch", {"title": title, "study_id": study["id"],
                 "mapping_id": mapping["id"], "observation_id": observed["id"],
                 "source_uri": source_uri, "original": observed["original"],
                 "source_collection_id": provenance.get("gwma_source_collection_id"),
                 "source_id": provenance.get("gwma_source_id"),
                 "row_count": len(rows), "issue_count": sum(bool(row["assessment"]["issues"]) for row in rows),
                 "rows": rows})


def save_review(workspace, payload):
    batch = item(workspace, "batch", payload["batch_id"])
    previous = payload.get("previous_review_id")
    decisions = {}
    if previous:
        old = item(workspace, "review", previous)
        if old["batch_id"] != batch["id"]:
            raise ValueError("Continue a review of this exact batch edition")
        decisions.update({row["row_id"]: row for row in old["decisions"]})
    reviewer = _text(payload.get("reviewer", ""), "reviewer", required=True)
    known = {row["row_id"] for row in batch["rows"]}
    changes = payload.get("decisions", [])
    if not isinstance(changes, list):
        raise ValueError("Supply a list of row decisions")
    seen = set()
    for change in changes:
        change = _object(change, "row decision")
        key = change.get("row_id")
        if key not in known or key in seen:
            raise ValueError("Review each selected original row once")
        seen.add(key)
        disposition = change.get("disposition")
        if disposition not in ("accepted", "excluded", "pending"):
            raise ValueError("Choose accepted, excluded or pending for each row")
        reason = _text(change.get("reason", ""), "review reason", required=disposition != "pending")
        decisions[key] = {"row_id": key, "disposition": disposition, "reason": reason,
                          "reviewer": reviewer, "overrides": _strings(change.get("overrides", {}), "row corrections")}
    return _save(workspace, "review", {"title": batch["title"] + " — " + reviewer,
                 "study_id": batch["study_id"], "batch_id": batch["id"],
                 "previous_review_id": previous, "reviewer": reviewer,
                 "decisions": [decisions[key] for key in sorted(decisions)]})


def resolved_rows(workspace, batch_id, review_id=None):
    batch = item(workspace, "batch", batch_id)
    mapping = item(workspace, "mapping", batch["mapping_id"])
    study = item(workspace, "study", batch["study_id"])
    reviews = {}
    if review_id:
        review = item(workspace, "review", review_id)
        if review["batch_id"] != batch_id:
            raise ValueError("Select a review bound to this original batch")
        reviews = {row["row_id"]: row for row in review["decisions"]}
    for source in batch["rows"]:
        decision = reviews.get(source["row_id"])
        fields = {**source["fields"], **(decision or {}).get("overrides", {})}
        assessment = assess(fields, mapping["profile_contract"])
        if fields["watershed"] and fields["watershed"] not in study["watersheds"]:
            assessment["issues"].append(_issue("study_watershed", "watershed", "Assign this source area to the study's named watershed"))
        disposition = decision["disposition"] if decision else ("pending" if assessment["issues"] else "accepted")
        yield {**source, "fields": fields, "assessment": assessment,
               "review": decision, "disposition": disposition, "batch_id": batch_id,
               "source_sha256": batch["original"]["sha256"], "mapping_id": mapping["id"]}


def rows(workspace, payload):
    offset, limit = int(payload.get("offset", 0)), int(payload.get("limit", 100))
    if offset < 0 or not 1 <= limit <= 500:
        raise ValueError("Choose a nonnegative offset and a page of 1–500 rows")
    batch = item(workspace, "batch", payload["batch_id"])
    import itertools
    selected = list(itertools.islice(resolved_rows(workspace, batch["id"], payload.get("review_id") or None),
                                    offset, offset + limit))
    return {"rows": selected, "total": batch["row_count"], "offset": offset,
            "next_offset": offset + limit if offset + limit < batch["row_count"] else None,
            "review_id": payload.get("review_id") or None}


def _unit_factor(source, target):
    if source == target and source:
        return Decimal(1)
    pattern = r"(CFU|MPN|copies|gene copies)/(100\s*mL|mL|L)"
    left, right = re.fullmatch(pattern, source), re.fullmatch(pattern, target)
    if not left or not right or left.group(1) != right.group(1):
        raise ValueError("Use the same measurement unit or an explicit same-method volume conversion")
    volume = lambda match: Decimal(100 if match.group(2).replace(" ", "") == "100mL"
                                   else 1 if match.group(2) == "mL" else 1000)
    return volume(right) / volume(left)


def save_contract(workspace, payload):
    study = _study(workspace, payload)
    model = _object(payload.get("model", {}), "model contract")
    selected = {key: _text(model.get(key, ""), "model " + key, required=True)
                for key in ("name", "version", "input_schema", "output_schema")}
    rules = payload.get("rules", [])
    if not isinstance(rules, list) or not rules:
        raise ValueError("Supply the model's explicit measurement and unit contracts")
    normalized, keys = [], set()
    for rule in rules:
        row = {key: _text(rule.get(key, ""), key, required=True)
               for key in ("parameter", "method", "matrix", "from_unit", "to_unit")}
        row["fraction"] = _text(rule.get("fraction", ""), "sample fraction")
        key = tuple(row[name] for name in ("parameter", "method", "matrix", "fraction", "from_unit"))
        if key in keys:
            raise ValueError("Each measurement/method/matrix/unit contract must be unambiguous")
        keys.add(key)
        expected = _unit_factor(row["from_unit"], row["to_unit"])
        factor = _decimal(rule.get("factor", "1"))
        if factor != expected:
            raise ValueError("The declared concentration factor must match its explicit volume units")
        if rule.get("censoring") != "preserve_bounds":
            raise ValueError("This input contract preserves original censor bounds without substituting results")
        normalized.append({**row, "factor": str(factor), "censoring": "preserve_bounds"})
    return _save(workspace, "contract", {"title": _text(payload.get("title", ""), "contract title", required=True),
                 "study_id": study["id"], "reviewer": _text(payload.get("reviewer", ""), "technical reviewer", required=True),
                 "model": selected, "rules": normalized, "notes": _text(payload.get("notes", ""), "contract notes")})


def save_plan(workspace, payload):
    study = _study(workspace, payload)
    decisions, tasks, scenarios = (payload.get(key, []) for key in ("decisions", "tasks", "scenarios"))
    for name, collection in (("decisions", decisions), ("tasks", tasks), ("scenarios", scenarios)):
        if not isinstance(collection, list) or any(not isinstance(row, dict) for row in collection):
            raise ValueError("Supply editable " + name + " records")
        keys = [row.get("id") for row in collection]
        if any(not isinstance(key, str) or not key for key in keys) or len(set(keys)) != len(keys):
            raise ValueError(name + " require distinct nonempty IDs")
        for row in collection:
            _text(row.get("title", ""), name + " title", required=True)
    task_ids = {row["id"] for row in tasks}
    edges = {}
    for task in tasks:
        dependencies = task.get("depends_on", [])
        if not isinstance(dependencies, list) or any(key not in task_ids for key in dependencies):
            raise ValueError("Task dependencies must name this plan's task IDs")
        supplied_duration = task.get("duration_months", "")
        if supplied_duration is None:
            basis = _text(task.get("duration_basis", ""), "unagreed task duration basis")
            if not basis and task.get("duration_status") != "to_be_agreed":
                raise ValueError("An unagreed task duration needs its explicit basis or to_be_agreed status")
        else:
            duration = _decimal(supplied_duration)
            if duration is None or duration < 0:
                raise ValueError("Give a nonnegative task duration or an explicit unagreed duration")
        edges[task["id"]] = dependencies
    visiting, done = set(), set()
    def visit(key):
        if key in visiting:
            raise ValueError("The study workplan contains a dependency cycle")
        if key in done:
            return
        visiting.add(key)
        for dep in edges[key]:
            visit(dep)
        visiting.remove(key)
        done.add(key)
    for key in edges:
        visit(key)
    for scenario in scenarios:
        if scenario.get("cost") not in (None, ""):
            cost = _decimal(scenario["cost"])
            if cost is None or cost < 0 or not scenario.get("cost_unit"):
                raise ValueError("Scenario costs require a nonnegative value and explicit cost denominator")
    for decision in decisions:
        if decision.get("status") not in ("open", "resolved", "deferred"):
            raise ValueError("Study decisions use open, resolved or deferred status")
        if decision["status"] == "resolved" and (not decision.get("owner") or not decision.get("note")):
            raise ValueError("Resolved study decisions retain the named owner and decision")
    sources = payload.get("sources", [])
    if not isinstance(sources, list) or any(not isinstance(source, dict) for source in sources):
        raise ValueError("Workplan sources must be complete source-reference objects")
    from urllib.parse import urlsplit
    for source in sources:
        _text(source.get("title", ""), "workplan source title", required=True)
        uri = _text(source.get("url", ""), "workplan source URL", required=True)
        parsed = urlsplit(uri)
        if parsed.scheme not in ("http", "https") or not parsed.netloc:
            raise ValueError("Retain the workplan source's complete HTTP(S) URL")
        if source.get("retained_sha256") and not re.fullmatch(r"[0-9a-f]{64}", source["retained_sha256"]):
            raise ValueError("Retain the exact complete workplan source SHA256")
    context = dict(_object(payload.get("template_context", {}), "source template context"))
    for key in ("watersheds", "phase", "phases", "scope", "authorization"):
        if key in payload:
            context[key] = payload[key]
    template_schema = payload.get("template_schema", "")
    if str(payload.get("schema", "")).startswith("upstate.gwma-workplan-template/"):
        template_schema = payload["schema"]
    _text(template_schema, "original template schema")
    return _save(workspace, "plan", {"study_id": study["id"],
                 "title": _text(payload.get("title", ""), "plan title", required=True),
                 "owners": _object(payload.get("owners", {}), "plan owners"),
                 "sources": sources, "template_schema": template_schema, "template_context": context,
                 "decisions": decisions, "tasks": tasks, "scenarios": scenarios})


def _analytical(row, contract):
    fields, evaluation = row["fields"], row["assessment"]
    base = {"batch_id": row["batch_id"], "row_id": row["row_id"], "source_record": row["source_record"],
            "source_sha256": row["source_sha256"], "mapping_id": row["mapping_id"],
            "disposition": row["disposition"], **fields,
            "censoring": evaluation["censoring"], "reviewer": (row.get("review") or {}).get("reviewer", ""),
            "review_reason": (row.get("review") or {}).get("reason", "")}
    rule = next((rule for rule in (contract or {}).get("rules", []) if
                 all(rule[name] == fields[field] for name, field in
                     (("parameter", "parameter"), ("method", "method"), ("matrix", "matrix"), ("fraction", "fraction"), ("from_unit", "unit")))), None)
    base.update({"analytical_status": "excluded" if row["disposition"] == "excluded" else
                 "needs_review" if row["disposition"] == "pending" else
                 "contract_unmapped" if rule is None else "ready",
                 "target_unit": rule["to_unit"] if rule else "", "factor": rule["factor"] if rule else "",
                 "model_contract_id": (contract or {}).get("id", ""),
                 "numeric_value": "", "bound_operator": evaluation["bound_operator"] or "",
                 "bound_value": "", "mdl_numeric": "", "rl_numeric": ""})
    # Only explicit non-substitution volume normalization. The original strings,
    # qualifier, sentinel and every review remain in the same exported record.
    if rule:
        factor = Decimal(rule["factor"])
        for target, value in (("numeric_value", evaluation["numeric_value"]),
                              ("bound_value", evaluation["bound_value"]),
                              ("mdl_numeric", evaluation["limits"]["mdl"]["numeric"]),
                              ("rl_numeric", evaluation["limits"]["rl"]["numeric"])):
            if value is not None:
                # The allowed factors are exact powers of ten. Shift the Decimal
                # tuple instead of rounding a long original through the default context.
                original = Decimal(value).as_tuple()
                base[target] = str(Decimal((original.sign, original.digits,
                                             original.exponent + factor.adjusted())))
    return base


def _csv(rows, fieldnames=None):
    rows = list(rows)
    fields = fieldnames or list(dict.fromkeys(key for row in rows for key in row))
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for row in rows:
        writer.writerow({key: json.dumps(value, ensure_ascii=False, sort_keys=True)
                         if isinstance(value, (list, dict)) else value for key, value in row.items()})
    return output.getvalue().encode("utf-8")


def _appendix(study, batches, contract, plan, counts):
    esc = lambda value: html.escape(str(value))
    section = lambda title, value: "<h2>" + esc(title) + "</h2><pre>" + esc(
        json.dumps(value, ensure_ascii=False, indent=2)) + "</pre>"
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width">'
            '<title>' + esc(study["title"]) + '</title><style>body{font:16px/1.5 system-ui;max-width:72rem;'
            'margin:2rem auto;padding:0 1rem;color:#202124;background:white}pre{white-space:pre-wrap;'
            'overflow-wrap:anywhere;border:1px solid #aaa;padding:1rem}h1,h2{line-height:1.2}</style>'
            '<h1>' + esc(study["title"]) + '</h1><p>Study data management and analytical handover</p>'
            '<p>The original CSVs, complete mapped observations, reviews, unit and censor contracts, '
            'editable workplan, scenarios and decisions are included in this package. Row status '
            'identifies source review and analytical contract readiness.</p>'
            + section("Study responsibilities", study)
            + section("Source inventory and lineage", [{key: value for key, value in row.items() if key != "rows"} for row in batches])
            + section("Receiving totals", counts)
            + section("Analytical model contract", contract or {})
            + section("Workplan, study decisions and scenarios", plan or {})
            + '<h2>Collection and interpretation</h2><p>Sample, station, event, matrix, method, analyte, '
              'fraction, original values, limits, qualifiers and QC annotations remain distinct. '
              'No nondetect result is filled. Culture, MPN and molecular measurements retain separate units. '
              'Scientific reviewers record original method-specific duplicate and PCR quality decisions. '
              'The original operator workspace archive carries editable records for reopening.</p></html>').encode("utf-8")


def _registered_sources(workspace, batch):
    """Carry the complete original collection, including raw API pages and sidecars."""
    collection_id, source_id = batch.get("source_collection_id"), batch.get("source_id")
    if not collection_id and not source_id:
        return None, {}
    if not collection_id or not source_id:
        raise ValueError("Retained batch has incomplete registered-source provenance")
    collection = workspace._get("sources", collection_id)
    _, selected = workspace.source_file(collection_id, source_id)
    if (selected["body"]["sha256"] != batch["original"]["sha256"]
            or selected["body"]["bytes"] != batch["original"]["bytes"]):
        raise ValueError("Registered source differs from the retained original batch")
    originals = {}
    for entry in collection["entries"]:
        workspace.source_file(collection_id, entry["id"])
        for body in [entry["body"], *entry.get("companions", [])]:
            path = relative_file(workspace.root, body["object"])
            if path.stat().st_size != body["bytes"] or file_digest(path) != body["sha256"]:
                raise ValueError("A complete registered-source member changed")
            originals["source-collections/" + collection_id + "/objects/" + body["sha256"]] = path
    manifest = collection["original_manifest"]
    path = relative_file(workspace.root, manifest["object"])
    if path.stat().st_size != manifest["bytes"] or file_digest(path) != manifest["sha256"]:
        raise ValueError("Original registered-source manifest changed")
    originals["source-collections/" + collection_id + "/original-manifest.json"] = path
    return collection, originals


def build_handover(workspace, payload):
    study = _study(workspace, payload)
    selections = payload.get("batch_reviews", [])
    if not isinstance(selections, list) or not selections:
        raise ValueError("Select the study batches and their exact review editions")
    if any(not isinstance(row, dict) for row in selections):
        raise ValueError("Select batch/review objects")
    if len({row.get("batch_id") for row in selections}) != len(selections):
        raise ValueError("Select each batch once")
    contract = item(workspace, "contract", payload["contract_id"]) if payload.get("contract_id") else None
    plan = item(workspace, "plan", payload["plan_id"]) if payload.get("plan_id") else None
    _same_study(study, *[record for record in (contract, plan) if record])
    batch_records, all_rows, records, originals, registered = [], [], {}, {}, {}
    records[KINDS["study"] + "/" + study["id"] + ".json"] = canonical(
        {key: value for key, value in study.items() if key != "id"}) + b"\n"
    def record(kind, value):
        records[KINDS[kind] + "/" + value["id"] + ".json"] = canonical(
            {key: body for key, body in value.items() if key != "id"}) + b"\n"
    for kind, value in (("contract", contract), ("plan", plan)):
        if value:
            record(kind, value)
    for selected in selections:
        batch = item(workspace, "batch", selected["batch_id"])
        _same_study(study, batch)
        source_hash = batch["original"]["sha256"]
        if source_hash in originals:
            raise ValueError("Two selected batches map the same original CSV. Select one mapping edition per original source.")
        original = relative_file(workspace.root, batch["original"]["object"])
        if file_digest(original) != source_hash or original.stat().st_size != batch["original"]["bytes"]:
            raise ValueError("The original retained source changed")
        originals[source_hash] = original
        collection, source_files = _registered_sources(workspace, batch)
        registered.update(source_files)
        if collection:
            records["sources/" + collection["id"] + ".json"] = canonical(
                {key: data for key, data in collection.items() if key != "id"}) + b"\n"
        batch_records.append(batch)
        record("batch", batch)
        record("mapping", item(workspace, "mapping", batch["mapping_id"]))
        observed = workspace._get("observations", batch["observation_id"])
        records["observations/" + observed["id"] + ".json"] = canonical(
            {key: value for key, value in observed.items() if key != "id"}) + b"\n"
        if selected.get("review_id"):
            review = item(workspace, "review", selected["review_id"])
            if review["batch_id"] != batch["id"]:
                raise ValueError("Selected review belongs to a different batch")
            # Complete reviewer history is retained, not merely the selected tip.
            seen_reviews = set()
            while review:
                if review["id"] in seen_reviews:
                    raise ValueError("Review history contains a cycle")
                seen_reviews.add(review["id"])
                _same_study(study, review)
                if review["batch_id"] != batch["id"]:
                    raise ValueError("Review history changed its original batch")
                record("review", review)
                review = item(workspace, "review", review["previous_review_id"]) if review.get("previous_review_id") else None
        all_rows.extend(resolved_rows(workspace, batch["id"], selected.get("review_id")))
    analytical = [_analytical(row, contract) for row in all_rows]
    counts = {"source_files": len(originals), "rows": len(all_rows)}
    for status in ("ready", "needs_review", "excluded", "contract_unmapped"):
        counts[status] = sum(row["analytical_status"] == status for row in analytical)
    issue_rows = [{"batch_id": row["batch_id"], "row_id": row["row_id"], "source_record": row["source_record"],
                   "disposition": row["disposition"], **problem}
                  for row in all_rows for problem in row["assessment"]["issues"]]
    body = {"title": _text(payload.get("title", ""), "handover title", required=True),
            "study_id": study["id"], "batch_reviews": selections,
            "contract_id": contract["id"] if contract else None, "plan_id": plan["id"] if plan else None,
            "counts": counts}
    # Content-derived directory permits exact retries and complete workspace moves.
    files = {**records, "analytical/all-observations.csv": _csv(analytical),
             "analytical/model-inputs.csv": _csv(
                 [row for row in analytical if row["analytical_status"] == "ready"],
                 list(analytical[0]) if analytical else ["row_id"]),
             "analytical/source-issues.csv": _csv(issue_rows,
                 ["batch_id", "row_id", "source_record", "disposition", "code", "field", "message"]),
             "study/study.json": canonical(study) + b"\n",
             "study/contract.json": canonical(contract) + b"\n",
             "study/workplan.json": canonical(plan) + b"\n",
             "study/scenarios.csv": _csv((plan or {}).get("scenarios", []), None if (plan or {}).get("scenarios") else ["id", "title"]),
             "study/decisions.csv": _csv((plan or {}).get("decisions", []), None if (plan or {}).get("decisions") else ["id", "title", "status", "owner", "note"]),
             "study/dependencies.csv": _csv((plan or {}).get("tasks", []), None if (plan or {}).get("tasks") else ["id", "title", "depends_on", "owner", "duration_months"]),
             "methods.html": _appendix(study, batch_records, contract, plan, counts),
             "README.txt": ("GWMA study handover\n\nOpen methods.html for the complete source-linked methods appendix. "
                 "Edit study/workplan.json and the scenarios, decisions and dependencies CSVs, then save a new plan in "
                 "the operator. Import the original complete workspace archive to reopen the exact saved study and reviews. "
                 "Original CSVs are named by their unchanged SHA256. Model inputs retain censor bounds and explicit "
                 "unit contracts; all-observations.csv also contains pending, excluded and unmapped rows. "
                 "This package carries complete record bodies and reviewer history.\n").encode("utf-8")}
    manifest = {"schema": "upstate.gwma-handover-files/v2", **body, "files": []}
    import hashlib
    for name, content in sorted(files.items()):
        manifest["files"].append({"path": name, "bytes": len(content), "sha256": hashlib.sha256(content).hexdigest()})
    for checksum, path in sorted(originals.items()):
        manifest["files"].append({"path": "originals/" + checksum + ".csv", "bytes": path.stat().st_size, "sha256": checksum})
    for name, path in sorted(registered.items()):
        manifest["files"].append({"path": name, "bytes": path.stat().st_size, "sha256": file_digest(path)})
    # Bind the edition to every actual emitted member, including the current
    # scientific interpretation. An upgraded assessment gets a distinct edition.
    edition = digest(manifest)
    manifest["edition"] = edition
    files["manifest.json"] = canonical(manifest) + b"\n"
    directory = workspace.root / "gwma-exports" / edition
    directory.mkdir(parents=True, exist_ok=True)
    archive = directory / "GWMA_Study_Handover.zip"
    if archive.exists():
        if archive.is_symlink() or not archive.is_file():
            raise ValueError("The retained study archive must be an ordinary file")
        retained = {**body, "edition": edition,
                    "archive": {"path": archive.relative_to(workspace.root).as_posix(),
                                "bytes": archive.stat().st_size, "sha256": file_digest(archive)}}
        # Reuse the fully verified original container. A receiving host may have
        # another zlib version while every original member and edition agrees.
        _verify_handover(workspace, retained)
        return _save(workspace, "handover", retained)
    # Fixed member metadata yields the same bytes when retrying the same edition.
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as output:
        for name, content in sorted(files.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, content)
        for checksum, path in sorted(originals.items()):
            info = zipfile.ZipInfo("originals/" + checksum + ".csv", (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, path.read_bytes())
        for name, path in sorted(registered.items()):
            info = zipfile.ZipInfo(name, (1980, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            output.writestr(info, path.read_bytes())
    atomic_bytes(archive, buffer.getvalue(), immutable=True)
    return _save(workspace, "handover", {**body, "edition": edition,
                 "archive": {"path": archive.relative_to(workspace.root).as_posix(),
                             "bytes": archive.stat().st_size, "sha256": file_digest(archive)}})


def catalog(workspace):
    template = Path(__file__).with_name("gwma_workplan_template.json")
    result = {"fields": list(FIELDS), "profiles": profiles(),
              "plan_template": json.loads(template.read_text(encoding="utf-8")) if template.exists() else {}}
    for kind, folder in KINDS.items():
        result[PLURALS[kind]] = [{key: value[key] for key in
                              ("id", "title", "study_id", "mapping_id", "observation_id",
                               "source_collection_id", "source_id", "batch_id", "reviewer", "row_count", "issue_count", "counts")
                              if key in value} for value in workspace._list(folder)]
    return result


def overview(workspace):
    return {name: len(list((workspace.root / folder).glob("*.json")))
            for name, folder in KINDS.items()}


def _verify_batch(workspace, batch):
    study = item(workspace, "study", batch["study_id"])
    mapping = item(workspace, "mapping", batch["mapping_id"])
    _same_study(study, batch, mapping)
    observed = workspace._get("observations", batch["observation_id"])
    if observed["original"] != batch["original"]:
        raise ValueError("Received GWMA batch changed its original observation source")
    original = relative_file(workspace.root, batch["original"]["object"])
    if (file_digest(original) != batch["original"]["sha256"]
            or original.stat().st_size != batch["original"]["bytes"]):
        raise ValueError("Received GWMA original CSV changed")
    table = csv.DictReader(io.StringIO(original.read_text(encoding="utf-8-sig")))
    if table.fieldnames != observed["columns"]:
        raise ValueError("Received GWMA original column order changed")
    source_rows = list(table)
    if (len(source_rows) != len(observed["rows"]) or len(source_rows) != batch["row_count"]
            or len(batch["rows"]) != batch["row_count"]):
        raise ValueError("Received GWMA batch lost its original observation rows")
    missing = set(mapping["columns"].values()) - set(observed["columns"])
    if missing:
        raise ValueError("Received GWMA mapping names absent source columns")
    for ordinal, (raw, source, row) in enumerate(zip(source_rows, observed["rows"], batch["rows"]), 1):
        expected_id = digest({"source_sha256": batch["original"]["sha256"], "record": ordinal})
        if (raw != source["original"] or row["row_id"] != expected_id
                or row["source_record"] != ordinal or row["source_line"] != source["line"]
                or row["fields"] != _raw_fields(raw, mapping)):
            raise ValueError("Received GWMA row changed its original source/mapping identity")
    if batch["issue_count"] != sum(bool(row["assessment"]["issues"]) for row in batch["rows"]):
        raise ValueError("Received GWMA issue count changed")
    _registered_sources(workspace, batch)
    return mapping, observed


def _verify_review(workspace, review):
    batch = item(workspace, "batch", review["batch_id"])
    if batch["study_id"] != review["study_id"]:
        raise ValueError("Received GWMA review changed study")
    known = {row["row_id"] for row in batch["rows"]}
    seen = set()
    for decision in review["decisions"]:
        key = decision["row_id"]
        if key not in known or key in seen or decision["disposition"] not in ("accepted", "excluded", "pending"):
            raise ValueError("Received GWMA review changed its original row decisions")
        seen.add(key)
        _strings(decision["overrides"], "received row corrections")
        _text(decision["reviewer"], "received reviewer", required=True)
        _text(decision["reason"], "received review reason", required=decision["disposition"] != "pending")
    if review.get("previous_review_id"):
        previous = item(workspace, "review", review["previous_review_id"])
        if previous["batch_id"] != batch["id"] or previous["study_id"] != review["study_id"]:
            raise ValueError("Received GWMA reviewer history changed batch")


def _verify_handover(workspace, value):
    archive = relative_file(workspace.root, value["archive"]["path"])
    if archive.stat().st_size != value["archive"]["bytes"] or file_digest(archive) != value["archive"]["sha256"]:
        raise ValueError("Received GWMA analytical handover changed")
    study = item(workspace, "study", value["study_id"])
    expected_records = {}
    sources, registered = {}, {}
    expected_rows = {}
    def record(kind, selected):
        if kind != "study":
            _same_study(study, selected)
        path = KINDS[kind] + "/" + selected["id"] + ".json"
        expected_records[path] = canonical({key: data for key, data in selected.items() if key != "id"}) + b"\n"
    record("study", study)
    selected_objects = {}
    for kind in ("contract", "plan"):
        selected = item(workspace, kind, value[kind + "_id"]) if value.get(kind + "_id") else None
        selected_objects[kind] = selected
        if selected:
            record(kind, selected)
    for selected in value["batch_reviews"]:
        batch = item(workspace, "batch", selected["batch_id"])
        record("batch", batch)
        mapping, observed = _verify_batch(workspace, batch)
        record("mapping", mapping)
        collection, source_files = _registered_sources(workspace, batch)
        registered.update(source_files)
        if collection:
            expected_records["sources/" + collection["id"] + ".json"] = canonical(
                {key: data for key, data in collection.items() if key != "id"}) + b"\n"
        expected_records["observations/" + observed["id"] + ".json"] = canonical(
            {key: data for key, data in observed.items() if key != "id"}) + b"\n"
        source_sha = batch["original"]["sha256"]
        if source_sha in sources:
            raise ValueError("Received handover double-counts an original source")
        sources[source_sha] = batch["original"]
        for row in batch["rows"]:
            expected_rows[(batch["id"], row["row_id"])] = (source_sha, mapping["id"], str(row["source_record"]))
        review_id, seen = selected.get("review_id"), set()
        while review_id:
            if review_id in seen:
                raise ValueError("Received GWMA reviewer history contains a cycle")
            seen.add(review_id)
            review = item(workspace, "review", review_id)
            if review["batch_id"] != batch["id"]:
                raise ValueError("Received handover reviewer history changed batch")
            _verify_review(workspace, review)
            record("review", review)
            review_id = review.get("previous_review_id")
    import hashlib
    with zipfile.ZipFile(archive) as zipped:
        names = zipped.namelist()
        if len(names) != len(set(names)) or any(
                name.startswith("/") or "\\" in name or any(p in ("", ".", "..") for p in name.split("/"))
                for name in names):
            raise ValueError("Received GWMA handover has ambiguous member paths")
        manifest = json.loads(zipped.read("manifest.json"))
        members = manifest["files"]
        paths = [member["path"] for member in members]
        if len(paths) != len(set(paths)) or set(names) != set(paths) | {"manifest.json"}:
            raise ValueError("Received GWMA handover manifest is incomplete")
        for member in members:
            content = zipped.read(member["path"])
            if len(content) != member["bytes"] or hashlib.sha256(content).hexdigest() != member["sha256"]:
                raise ValueError("Received GWMA handover member changed: " + member["path"])
        for key in ("title", "study_id", "batch_reviews", "contract_id", "plan_id", "counts", "edition"):
            if manifest.get(key) != value.get(key):
                raise ValueError("Received GWMA handover changed its selected " + key)
        if manifest["schema"] == "upstate.gwma-handover-files/v2":
            if digest({key: data for key, data in manifest.items() if key != "edition"}) != value["edition"]:
                raise ValueError("Received GWMA handover changed its complete output edition")
        elif manifest["schema"] != "upstate.gwma-handover-files/v1":
            raise ValueError("Unsupported GWMA handover manifest")
        for name, expected in expected_records.items():
            if zipped.read(name) != expected:
                raise ValueError("Received GWMA handover lost original record history: " + name)
        if {name for name in names if name.startswith("source-collections/")} != set(registered):
            raise ValueError("Received GWMA handover lost complete registered-source provenance")
        for name, path in registered.items():
            if zipped.read(name) != path.read_bytes():
                raise ValueError("Received GWMA registered-source member changed: " + name)
        source_members = {name for name in names if name.startswith("originals/")}
        if source_members != {"originals/" + key + ".csv" for key in sources}:
            raise ValueError("Received GWMA handover lost an original source file")
        for checksum, original in sources.items():
            body = zipped.read("originals/" + checksum + ".csv")
            if len(body) != original["bytes"] or hashlib.sha256(body).hexdigest() != checksum:
                raise ValueError("Received GWMA handover changed original source bytes")
        for name, selected in (("study/study.json", study), ("study/contract.json", selected_objects["contract"]),
                               ("study/workplan.json", selected_objects["plan"])):
            if json.loads(zipped.read(name)) != selected:
                raise ValueError("Received GWMA handover changed the selected study records")
        analytical = list(csv.DictReader(io.StringIO(zipped.read("analytical/all-observations.csv").decode("utf-8"))))
        incoming = [(row["batch_id"], row["row_id"]) for row in analytical]
        if len(incoming) != len(set(incoming)) or set(incoming) != set(expected_rows):
            raise ValueError("Received GWMA analytical handover lost or duplicated original rows")
        for row in analytical:
            if (row["source_sha256"], row["mapping_id"], row["source_record"]) != expected_rows[(row["batch_id"], row["row_id"])]:
                raise ValueError("Received GWMA analytical row changed source lineage")
        expected_counts = {"source_files": len(sources), "rows": len(analytical)}
        for status in ("ready", "needs_review", "excluded", "contract_unmapped"):
            expected_counts[status] = sum(row["analytical_status"] == status for row in analytical)
        if expected_counts != value["counts"] or sum(expected_counts[key] for key in
                ("ready", "needs_review", "excluded", "contract_unmapped")) != len(analytical):
            raise ValueError("Received GWMA handover changed full-scope analytical dispositions")
        model_inputs = list(csv.DictReader(io.StringIO(zipped.read("analytical/model-inputs.csv").decode("utf-8"))))
        if model_inputs != [row for row in analytical if row["analytical_status"] == "ready"]:
            raise ValueError("Received GWMA model input lost its exact reviewed selection")


def verify_all(workspace):
    """Resolve complete scientific record lineage and every archived member."""
    count = 0
    for kind, folder in KINDS.items():
        for value in workspace._list(folder):
            count += 1
            if kind != "study":
                item(workspace, "study", value["study_id"])
            if kind == "batch":
                _verify_batch(workspace, value)
            elif kind == "review":
                _verify_review(workspace, value)
            elif kind == "handover":
                _verify_handover(workspace, value)
    return {"gwma_records": count}
