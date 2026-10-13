"""Utility/community planning over the original scientific Workspace and sources."""
from __future__ import annotations

from copy import deepcopy
import csv
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
import io
import re

from .common import canonical, digest, file_digest, identifier, read_json, verify_file

TABLE_KIND = "community-tables"
PLAN_KIND = "community-plans"
REPORT_KIND = "community-reports"
TABLE_COLUMNS = (
    "utility_id", "watershed_id", "watershed_name", "geoid", "population",
    "households", "median_household_income", "below_state_median_income",
    "households_below_poverty", "reported_poverty_percent",
)
NUMERIC_GROUP_FIELDS = (
    "population", "households", "median_household_income",
    "households_below_poverty", "reported_poverty_percent",
    "below_state_median_income",
)
PRIORITIES = ("high", "medium", "low", "watch")
STRATEGIES = ("protect", "restore", "monitor", "investigate", "other")
STATUSES = ("proposed", "selected", "in_progress", "complete")
MISSING = {"", "n/a", "na", "null", "suppressed", "-", "**"}
PHYSICAL_NAMES = ("nitrogen_export", "phosphorus_export", "sediment_export")


def text(value, name, *, required=False, maximum=20000):
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValueError(name + " must be text")
    value = value.strip()
    if required and not value:
        raise ValueError(name + " is required")
    if len(value) > maximum or "\0" in value:
        raise ValueError(name + " is too long or contains a null character")
    return value


def decimal(value, name, *, integer=False, maximum=None):
    if value is None or isinstance(value, str) and value.strip().lower() in MISSING:
        return None
    if isinstance(value, bool):
        raise ValueError(name + " must be a numeric source value")
    value = str(value).strip().replace(",", "").replace("$", "").removesuffix("%")
    if len(value) > 100 or not re.fullmatch(r"\+?(?:\d+(?:\.\d*)?|\.\d+)", value):
        raise ValueError(name + " must use ordinary decimal notation")
    try:
        number = Decimal(value)
    except InvalidOperation as error:
        raise ValueError(name + " is not a number") from error
    if not number.is_finite() or number < 0:
        raise ValueError(name + " must be a finite nonnegative value")
    if integer and number != number.to_integral_value():
        raise ValueError(name + " must contain a whole count")
    if maximum is not None and number > maximum:
        raise ValueError(name + " exceeds the selected source range")
    return int(number) if integer else format(number, "f")


def percent(numerator, denominator):
    if numerator is None or denominator in (None, 0):
        return None
    return format((Decimal(numerator) * 100 / Decimal(denominator)).quantize(
        Decimal("0.01"), rounding=ROUND_HALF_UP), "f")


def _flag(value, name):
    if value is None or str(value).strip().lower() in MISSING:
        return None
    value = str(value).strip().lower()
    if value in {"true", "yes", "y", "1", "x", "✓"}:
        return True
    if value in {"false", "no", "n", "0"}:
        return False
    raise ValueError(name + " must be true, false or an empty source value")


def _ids(value, name):
    if value is None:
        return []
    if not isinstance(value, list) or any(not isinstance(x, str) or not x for x in value):
        raise ValueError(name + " must be an array of identifiers")
    return list(dict.fromkeys(value))


def _metadata(value):
    if not isinstance(value, dict):
        raise ValueError("The retained table entry needs community_metadata")
    value = deepcopy(value)
    if value.get("schema") != "upstate.community-source-metadata/v1":
        raise ValueError("Use upstate.community-source-metadata/v1")
    if value.get("geography_basis") != "whole_block_group":
        raise ValueError("This table operation retains complete census block-group counts")
    reference = value.get("income_reference")
    if not isinstance(reference, dict):
        raise ValueError("Retain the table's income reference")
    threshold = decimal(reference.get("threshold"), "Income reference")
    if threshold is None:
        raise ValueError("Retain the income reference value used by the source")
    reference["threshold"] = threshold
    reference["currency"] = text(reference.get("currency"), "Income currency", required=True, maximum=20)
    reference["source_reference"] = text(reference.get("source_reference"), "Income source reference",
                                         required=True)
    utilities = value.get("utilities")
    if not isinstance(utilities, list) or not utilities:
        raise ValueError("Retain the original utility descriptions")
    seen = set()
    for utility in utilities:
        if not isinstance(utility, dict):
            raise ValueError("Each utility must be an object")
        utility["id"] = text(utility.get("id"), "Utility identifier", required=True, maximum=100)
        if utility["id"] in seen:
            raise ValueError("Utility identifiers must be unique")
        seen.add(utility["id"])
        utility["name"] = text(utility.get("name"), "Utility name", required=True, maximum=300)
        utility["approximate_service_population"] = decimal(
            utility.get("approximate_service_population"), "Utility service population", integer=True)
        utility["source_reference"] = text(utility.get("source_reference"), "Utility source reference",
                                             required=True)
        utility["service_population_basis"] = text(
            utility.get("service_population_basis"), "Utility population basis", required=True)
        utility["watershed_ids"] = _ids(utility.get("watershed_ids"), "Utility watershed identifiers")
    value["limitations"] = _ids(value.get("limitations"), "Source interpretation notes")
    return value


def aggregate(groups, *, scope_id="all", label="Selected whole block groups"):
    groups = list({row["geoid"]: row for row in groups}.values())
    result = {"scope_id": scope_id, "label": label, "geoid_count": len(groups),
              "geoids": sorted(row["geoid"] for row in groups)}
    for source, output in (
        ("population", "population_total"),
        ("households", "households_total"),
        ("households_below_poverty", "poverty_households_total"),
    ):
        known = [row[source] for row in groups if row[source] is not None]
        result[output] = sum(known) if len(known) == len(groups) else None
        result[output + "_known_sum"] = sum(known)
        result[output + "_known_groups"] = len(known)
    paired = [row for row in groups if row["households"] is not None
              and row["households_below_poverty"] is not None]
    numerator = sum(row["households_below_poverty"] for row in paired)
    denominator = sum(row["households"] for row in paired)
    result.update(
        household_poverty_percent=percent(numerator, denominator) if len(paired) == len(groups) else None,
        household_poverty_known_percent=percent(numerator, denominator),
        household_poverty_known_groups=len(paired),
        household_poverty_numerator=numerator,
        household_poverty_denominator=denominator,
        below_state_median_count=sum(row["below_state_median_income"] is True for row in groups),
        income_known_groups=sum(row["median_household_income"] is not None for row in groups),
        shared_membership_groups=sum(len(row.get("all_memberships", row["memberships"])) > 1 for row in groups),
    )
    incomes = [Decimal(row["median_household_income"]) for row in groups
               if row["median_household_income"] is not None]
    result["median_income_min"] = format(min(incomes), "f") if incomes else None
    result["median_income_max"] = format(max(incomes), "f") if incomes else None
    return result


def summaries(groups, metadata):
    utility_names = {row["id"]: row["name"] for row in metadata["utilities"]}
    utility_members, watershed_members, watershed_names = {}, {}, {}
    for group in groups:
        for member in group["memberships"]:
            utility_members.setdefault(member["utility_id"], {})[group["geoid"]] = group
            watershed_members.setdefault(member["watershed_id"], {})[group["geoid"]] = group
            watershed_names[member["watershed_id"]] = member["watershed_name"]
    return {
        "all": aggregate(groups),
        "utilities": [aggregate(list(rows.values()), scope_id=key, label=utility_names.get(key, key))
                      for key, rows in sorted(utility_members.items())],
        "watersheds": [aggregate(list(rows.values()), scope_id=key, label=watershed_names[key])
                       for key, rows in sorted(watershed_members.items())],
    }


def import_table(workspace, selection):
    collection_id = identifier(selection.get("source_collection_id"))
    source_id = text(selection.get("source_id"), "Original table source", required=True, maximum=300)
    path, entry = workspace.source_file(collection_id, source_id)
    if entry["kind"] != "table":
        raise ValueError("Select a retained community CSV table")
    metadata = _metadata(entry.get("community_metadata"))
    threshold = Decimal(metadata["income_reference"]["threshold"])
    utility_defs = {row["id"]: row for row in metadata["utilities"]}
    raw = path.read_text(encoding="utf-8-sig")
    reader = csv.DictReader(io.StringIO(raw, newline=""))
    if (not reader.fieldnames or len(reader.fieldnames) != len(set(reader.fieldnames))
            or set(TABLE_COLUMNS) - set(reader.fieldnames)):
        raise ValueError("Community CSV needs the distinct original Table 1 column headings")
    rows, groups, membership_ids, notes = [], {}, set(), []
    for number, original in enumerate(reader, 2):
        if None in original or any(value is None for value in original.values()):
            raise ValueError("Community CSV column count differs at row " + str(number))
        geoid = original["geoid"].strip()
        if not re.fullmatch(r"\d{12}", geoid):
            raise ValueError("Block-group GEOID must retain all 12 digits at row " + str(number))
        utility = original["utility_id"].strip()
        watershed = original["watershed_id"].strip()
        if utility not in utility_defs or not re.fullmatch(r"\d{12}", watershed):
            raise ValueError("Select an original utility and complete HUC12 at row " + str(number))
        if utility_defs[utility]["watershed_ids"] and watershed not in utility_defs[utility]["watershed_ids"]:
            raise ValueError("The table's watershed is absent from that utility's original source mapping")
        member = {"utility_id": utility, "watershed_id": watershed,
                  "watershed_name": text(original["watershed_name"], "Watershed name", required=True, maximum=300)}
        membership = (geoid, utility, watershed)
        if membership in membership_ids:
            raise ValueError("The original table repeats a block-group/utility/watershed membership")
        membership_ids.add(membership)
        values = {key: decimal(original[key], key, integer=True)
                  for key in ("population", "households", "households_below_poverty")}
        values["median_household_income"] = decimal(original["median_household_income"], "Median household income")
        values["reported_poverty_percent"] = decimal(original["reported_poverty_percent"], "Reported poverty percent",
                                                       maximum=100)
        reported_flag = _flag(original["below_state_median_income"], "Reported income comparison")
        values["below_state_median_income"] = (
            Decimal(values["median_household_income"]) < threshold
            if values["median_household_income"] is not None else None)
        row_notes = []
        calculated = percent(values["households_below_poverty"], values["households"])
        if (values["households_below_poverty"] is not None and values["households"] is not None
                and values["households_below_poverty"] > values["households"]):
            row_notes.append("The source poverty-household count exceeds its household denominator.")
        if (calculated is not None and values["reported_poverty_percent"] is not None
                and Decimal(calculated) != Decimal(values["reported_poverty_percent"])):
            row_notes.append("The printed poverty percentage differs from the rounded ratio of the printed counts.")
        if reported_flag is not None and reported_flag != values["below_state_median_income"]:
            row_notes.append("The printed income flag differs from the printed median/reference comparison.")
        row = {"record_id": digest({"geoid": geoid, **member}), "source_line": number,
               "geoid": geoid, **member, **values, "original": original,
               "reported_below_state_median_income": reported_flag,
               "calculated_poverty_percent": calculated, "source_notes": row_notes}
        rows.append(row)
        if geoid not in groups:
            groups[geoid] = {"geoid": geoid, **values, "memberships": [],
                             "calculated_poverty_percent": calculated, "source_notes": []}
        group = groups[geoid]
        if any(group[key] != values[key] for key in NUMERIC_GROUP_FIELDS):
            raise ValueError("The same block group has conflicting original demographic values: " + geoid)
        group["memberships"].append(member)
        group["source_notes"] = list(dict.fromkeys(group["source_notes"] + row_notes))
        if row_notes:
            notes.append({"geoid": geoid, "source_line": number, "notes": row_notes})
    if not rows:
        raise ValueError("The community table has no original rows")
    group_list = sorted(groups.values(), key=lambda row: row["geoid"])
    for group in group_list:
        group["memberships"].sort(key=lambda member: (member["utility_id"], member["watershed_id"]))
    summary = summaries(group_list, metadata)
    declared = metadata.get("source_reported_population")
    if declared is not None and declared != summary["all"]["population_total"]:
        notes.append({"notes": ["The source's stated population total differs from the unique table rows."],
                      "source_reported_population": declared,
                      "table_population_total": summary["all"]["population_total"]})
    value = {
        "title": text(selection.get("title") or entry["title"], "Community table title", required=True, maximum=300),
        "source": {"collection_id": collection_id, "source_id": source_id, "uri": entry["uri"],
                   "vintage": entry["vintage"], "sha256": entry["body"]["sha256"],
                   "original": deepcopy(entry["body"]), "title": entry["title"]},
        "metadata": metadata, "columns": list(reader.fieldnames), "rows": rows,
        "groups": group_list, "row_count": len(rows), "group_count": len(group_list),
        "summaries": summary, "source_notes": notes,
    }
    return workspace._save(TABLE_KIND, value)


def select_groups(table, selection):
    if not isinstance(selection, dict):
        raise ValueError("Choose utility, watershed and block-group filters")
    normalized = {name: _ids(selection.get(name), name)
                  for name in ("utility_ids", "watershed_ids", "geoids")}
    available = {
        "utility_ids": {member["utility_id"] for group in table["groups"] for member in group["memberships"]},
        "watershed_ids": {member["watershed_id"] for group in table["groups"] for member in group["memberships"]},
        "geoids": {group["geoid"] for group in table["groups"]},
    }
    for key, identifiers in normalized.items():
        if set(identifiers) - available[key]:
            raise ValueError("The selected " + key + " contains an identifier absent from the original table")
    selected = []
    for group in table["groups"]:
        if normalized["geoids"] and group["geoid"] not in normalized["geoids"]:
            continue
        members = [member for member in group["memberships"]
                   if (not normalized["utility_ids"] or member["utility_id"] in normalized["utility_ids"])
                   and (not normalized["watershed_ids"] or member["watershed_id"] in normalized["watershed_ids"])]
        if members:
            selected.append({**deepcopy(group), "all_memberships": deepcopy(group["memberships"]),
                             "memberships": deepcopy(members)})
    if not selected:
        raise ValueError("The selected filters do not contain an original block-group membership")
    return normalized, selected


def _watershed_context(workspace, report_id, groups):
    """Select plan HUCs from the existing completed regional report registry."""
    if not isinstance(report_id, str) or not re.fullmatch(r"watershed-[0-9a-f]{20}", report_id):
        raise ValueError("Choose a saved regional watershed report")
    directory = workspace.root / "watershed-context" / report_id
    record = read_json(directory / "operator-report.json")
    if (record.get("schema") != "upstate.operator-watershed-context/v1"
            or record.get("id") != report_id or record.get("state") != "complete"):
        raise ValueError("Choose a completed original regional watershed report")
    descriptor = record.get("files", {}).get("watershed-context.json")
    if not isinstance(descriptor, dict) or descriptor.get("path") != "watershed-context.json":
        raise ValueError("The regional registry needs its original report file")
    path = verify_file(directory, descriptor)
    report = read_json(path)
    if report.get("schema") != "upstate.watershed-context/v1" or report.get("id") != report_id:
        raise ValueError("The regional registry and original report identities differ")
    huc12s = sorted({member["watershed_id"] for group in groups for member in group["memberships"]})
    if not huc12s:
        raise ValueError("Select Community watersheds before binding their regional context")
    from .watershed_context import selected_watershed_export
    selected = selected_watershed_export(report, huc12s)
    return {
        **selected, "report_id": report_id,
        "title": record.get("title") or report.get("title") or "Regional watershed context",
        "analysis_version": report.get("analysis_version"),
        "report_file": {**descriptor, "path": path.relative_to(workspace.root).as_posix()},
        "source_fingerprint": record.get("source_fingerprint"),
        "source_edition_fingerprint": record.get("source_edition_fingerprint"),
        "source_inputs": deepcopy(record.get("source_inputs", [])),
        "network_status": report.get("network", {}).get("status"),
    }


def _context(workspace, value, groups=()):
    if not isinstance(value, dict):
        raise ValueError("Select original scientific context identifiers")
    value = deepcopy(value)
    collections = _ids(value.get("source_collection_ids"), "Scientific source collections")
    grid_id = value.get("grid_id") or None
    baseline_id = value.get("baseline_run_id") or None
    scenario_ids = _ids(value.get("scenario_run_ids"), "Scenario run identifiers")
    delivery_id = value.get("delivery_id") or None
    if scenario_ids and not baseline_id:
        raise ValueError("Select the original baseline beside alternative model runs")
    if baseline_id in scenario_ids:
        raise ValueError("A baseline cannot also be an alternative")
    snapshots = {"source_collections": [], "grid": None, "runs": [], "comparisons": [], "delivery": None}
    for key in collections:
        snapshots["source_collections"].append(workspace._get("sources", identifier(key)))
    if grid_id:
        snapshots["grid"] = workspace.get_grid(identifier(grid_id))
    for key in ([baseline_id] if baseline_id else []) + scenario_ids:
        run = workspace.inspect_run(identifier(key))
        if grid_id and run["selection"]["grid_id"] != grid_id:
            raise ValueError("The selected run uses another original model grid")
        snapshots["runs"].append(run)
    if snapshots["runs"]:
        baseline = snapshots["runs"][0]
        for run in snapshots["runs"][1:]:
            if run["selection"]["grid_id"] != baseline["selection"]["grid_id"]:
                raise ValueError("Alternative runs must share the baseline's original grid")
        if grid_id is None:
            grid_id = baseline["selection"]["grid_id"]
            snapshots["grid"] = workspace.get_grid(grid_id)
    if delivery_id:
        identifier(delivery_id)
        delivery = read_json(workspace.root / "deliveries" / delivery_id / "delivery-state.json")
        if delivery.get("id") != delivery_id:
            raise ValueError("Original delivery identity differs")
        selected_baseline = delivery.get("selection", {}).get("baseline_run_id")
        if baseline_id and selected_baseline and selected_baseline != baseline_id:
            raise ValueError("The selected delivery belongs to another baseline")
        snapshots["delivery"] = delivery
    if baseline_id and scenario_ids:
        for comparison_path in sorted((workspace.root / "comparisons").glob("*/comparison.json")):
            comparison = read_json(comparison_path)
            if comparison.get("baseline_run_id") != baseline_id:
                continue
            alternatives = comparison.get("alternatives", [])
            if not any(row.get("run_id") in scenario_ids for row in alternatives):
                continue
            comparison_id = identifier(comparison.get("id"))
            if comparison_path.parent.name != comparison_id:
                raise ValueError("Original comparison identity differs")
            from .native_versions import validate_run_comparison
            validate_run_comparison(workspace, comparison, expected_id=comparison_id)
            snapshots["comparisons"].append(comparison)
    watershed_id = value.get("watershed_context_id") or None
    if watershed_id:
        snapshots["watershed_context"] = _watershed_context(workspace, watershed_id, groups)
    totals = []
    for run in snapshots["runs"]:
        for pollutant in PHYSICAL_NAMES:
            artifact = run.get("artifacts", {}).get(pollutant)
            if not artifact:
                continue
            total = artifact.get("sum")
            if total is not None:
                Decimal(str(total))
            totals.append({
                "run_id": run["id"], "run_state": run.get("state"), "pollutant": pollutant,
                "value": total, "unit": artifact.get("sum_units") or artifact.get("units"),
                "spatial_basis": "The original run's reporting-area raster, before any demographic selection",
                "grid_id": run["selection"]["grid_id"], "profile_id": run["selection"]["profile_id"],
                "scenario_id": run["selection"]["scenario_id"], "artifact": deepcopy(artifact),
            })
    result = {"source_collection_ids": collections, "grid_id": grid_id,
              "baseline_run_id": baseline_id, "scenario_run_ids": scenario_ids, "delivery_id": delivery_id,
              "snapshots": snapshots, "physical_totals": totals}
    if watershed_id:
        result["watershed_context_id"] = watershed_id
    result["snapshot_sha256"] = digest(snapshots)
    return result


def _interventions(value, selected_groups, previous=None):
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError("Interventions must be an array of complete planning records")
    available = {row["geoid"]: row for row in selected_groups}
    known_ids, result = set(), []
    for position, original in enumerate(value, 1):
        if not isinstance(original, dict):
            raise ValueError("Each intervention must be a planning object")
        item = {}
        item["id"] = text(original.get("id"), "Intervention identifier", required=True, maximum=100)
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]{0,99}", item["id"]) or item["id"] in known_ids:
            raise ValueError("Intervention identifiers must be distinct portable labels")
        known_ids.add(item["id"])
        item["title"] = text(original.get("title"), "Intervention title", required=True, maximum=300)
        for name in ("utility_id", "watershed_id"):
            item[name] = text(original.get(name), name, required=True, maximum=100)
        item["geoids"] = _ids(original.get("geoids"), "Intervention block groups")
        if not item["geoids"]:
            item["geoids"] = [row["geoid"] for row in selected_groups if any(
                member["utility_id"] == item["utility_id"] and member["watershed_id"] == item["watershed_id"]
                for member in row["memberships"])]
        if not item["geoids"]:
            raise ValueError("Intervention utility/watershed has no selected block-group membership")
        for geoid in item["geoids"]:
            if geoid not in available or not any(
                    member["utility_id"] == item["utility_id"] and member["watershed_id"] == item["watershed_id"]
                    for member in available[geoid]["memberships"]):
                raise ValueError("An intervention must use its selected utility/watershed/block-group relationship")
        for name, choices, default in (("priority", PRIORITIES, "medium"),
                                        ("strategy", STRATEGIES, "investigate"),
                                        ("status", STATUSES, "proposed")):
            item[name] = original.get(name, default)
            if item[name] not in choices:
                raise ValueError("Choose a supported intervention " + name)
        for name in ("reason", "owner", "next_step", "notes"):
            item[name] = text(original.get(name), "Intervention " + name, required=name == "reason")
        item["cost_estimate_usd"] = decimal(original.get("cost_estimate_usd"), "Intervention cost estimate")
        if item["cost_estimate_usd"] is not None:
            amount = Decimal(item["cost_estimate_usd"])
            if amount != amount.quantize(Decimal("0.01")):
                raise ValueError("Intervention USD estimates use at most two decimal places")
            item["cost_estimate_usd"] = format(amount.quantize(Decimal("0.01")), "f")
        item["position"] = position
        item["community_context"] = aggregate([available[geoid] for geoid in item["geoids"]],
                                                scope_id=item["id"], label=item["title"])
        result.append(item)
    return result



INTERVENTION_FIELDS = (
    "id", "title", "priority", "strategy", "status", "utility_id", "watershed_id",
    "geoids", "reason", "owner", "next_step", "cost_estimate_usd", "notes",
)
INTERVENTION_DERIVED_COLUMNS = ("position", "population_context", "household_context")
INTERVENTION_REQUIRED_COLUMNS = ("id", "title", "utility_id", "watershed_id", "reason")


def _csv_original_text(value, previous):
    """Undo a known derived-CSV text escape against this exact prior plan."""
    if isinstance(previous, str):
        escaped = previous
        if (previous.lstrip().startswith(("=", "+", "@"))
                or previous.lstrip().startswith("-")
                and not re.fullmatch(r"-\d+(?:\.\d+)?", previous.strip())):
            escaped = "'" + previous
        if value == escaped:
            return previous
    return value


def _intervention_changes(before, after):
    fields = ("position",) + INTERVENTION_FIELDS
    left = {row["id"]: row for row in before}
    right = {row["id"]: row for row in after}
    shared = set(left) & set(right)
    changed = sorted(key for key in shared if any(
        left[key].get(field) != right[key].get(field) for field in fields))
    return {
        "added_ids": sorted(set(right) - set(left)),
        "removed_ids": sorted(set(left) - set(right)),
        "changed_ids": changed,
        "unchanged_ids": sorted(shared - set(changed)),
    }


def intervention_column_mapping(headers, mapping=None):
    """Bind plan fields to original CSV columns without rewriting the received file."""
    explicit = mapping is not None
    if explicit and (not isinstance(mapping, dict) or set(mapping) - set(INTERVENTION_FIELDS)):
        raise ValueError("Map only the original intervention plan fields")
    if not explicit:
        missing = set(INTERVENTION_REQUIRED_COLUMNS) - set(headers)
        if missing:
            raise ValueError("The intervention CSV lacks columns: " + ", ".join(sorted(missing)))
    selected, provenance = {}, []
    for field in INTERVENTION_FIELDS:
        column = (mapping.get(field, field if field in headers else None)
                  if explicit else field if field in headers else None)
        if column == "":
            column = None
        if column is not None and (not isinstance(column, str) or column not in headers):
            raise ValueError("Intervention field " + field + " needs an original CSV column")
        if column is None and field in INTERVENTION_REQUIRED_COLUMNS and field != "id":
            raise ValueError("Choose an original CSV column for " + field)
        selected[field] = column
        provenance.append({"field": field, "source_column": column,
                           "source_column_number": headers.index(column) + 1 if column is not None else None,
                           "basis": ("original-column" if column is not None else
                                     "generated-source-row-id" if field == "id" else "native-default")})
    return selected, provenance


def _intervention_import(value, table, previous):
    """Read the received CSV and retain its complete original bytes in the plan."""
    if not isinstance(value, dict) or value.get("schema") != "upstate.intervention-csv-import/v1":
        raise ValueError("Select an upstate.intervention-csv-import/v1 source")
    source = value.get("source")
    if not isinstance(source, dict):
        raise ValueError("Retain the original intervention CSV source")
    filename = text(source.get("filename"), "Intervention CSV filename", required=True, maximum=255)
    if "/" in filename or "\\" in filename or filename in {".", ".."}:
        raise ValueError("Use the original intervention CSV filename without a directory")
    raw = source.get("text")
    if not isinstance(raw, str) or "\0" in raw:
        raise ValueError("The original intervention CSV must contain UTF-8 text")
    encoded = raw.encode("utf-8")
    import hashlib
    checksum = hashlib.sha256(encoded).hexdigest()
    if source.get("bytes") != len(encoded) or source.get("sha256") != checksum:
        raise ValueError("The intervention CSV differs from its received byte count or SHA-256")
    if not encoded:
        raise ValueError("The selected intervention CSV is empty")
    import_selection, import_groups = select_groups(
        table, value.get("selection", (previous or {}).get("selection", {})))
    previous_rows = (previous or {}).get("interventions", [])
    prior = {row["id"]: row for row in previous_rows}
    available_watersheds = {member["watershed_id"] for group in table["groups"]
                            for member in group["memberships"]}
    available_geoids = {group["geoid"] for group in table["groups"]}
    normalized_geographies, records, source_rows, errors, seen = [], [], [], [], set()

    def geography(value, available, line, column):
        original = value.strip()
        resolved = original
        if original not in available and re.fullmatch(r"\d{1,12}", original):
            candidate = original.zfill(12)
            if candidate in available:
                resolved = candidate
                normalized_geographies.append({"row": line, "column": column,
                                                "original": original, "resolved": resolved})
        return resolved

    reader = csv.reader(io.StringIO(raw.removeprefix("\ufeff"), newline=""), strict=True)
    try:
        headers = next(reader)
    except StopIteration as error:
        raise ValueError("The intervention CSV has no column headings") from error
    except csv.Error as error:
        raise ValueError("Intervention CSV row 1: " + str(error)) from error
    if not headers or any(not column for column in headers) or len(headers) != len(set(headers)):
        raise ValueError("The intervention CSV needs distinct, nonempty column headings")
    columns, field_provenance = intervention_column_mapping(headers, value.get("column_mapping"))
    ignored = [column for column in headers if column not in set(columns.values())]
    record_number = 0
    while True:
        line = reader.line_num + 1
        try:
            cells = next(reader)
        except StopIteration:
            break
        except csv.Error as error:
            errors.append("CSV row " + str(line) + ": " + str(error))
            break
        if not cells or all(not value.strip() for value in cells):
            continue
        record_number += 1
        if len(cells) != len(headers):
            errors.append("CSV row " + str(line) + ": expected " + str(len(headers))
                          + " columns; received " + str(len(cells)))
            continue
        source_values = dict(zip(headers, cells))
        original = {field: source_values[column] if column is not None else ""
                    for field, column in columns.items()}
        key = original["id"].strip() or ("I-CSV-" + checksum[:16] + "-" + str(record_number))
        if key in seen:
            errors.append("CSV row " + str(line) + ": intervention identifier repeats: " + key)
            continue
        seen.add(key)
        old = prior.get(key, {})
        row = {field: _csv_original_text(original.get(field, ""), old.get(field))
               for field in INTERVENTION_FIELDS if field != "geoids"}
        row["id"] = key
        row["watershed_id"] = geography(row["watershed_id"], available_watersheds, line, "watershed_id")
        row["geoids"] = [
            geography(item, available_geoids, line, "geoids")
            for item in original.get("geoids", "").split(";") if item.strip()
        ]
        for field, default in (("priority", "medium"), ("strategy", "investigate"), ("status", "proposed")):
            row[field] = row[field].strip() or default
        row["cost_estimate_usd"] = row["cost_estimate_usd"].strip() or None
        try:
            normalized = _interventions([row], import_groups)[0]
        except (ValueError, InvalidOperation) as error:
            errors.append("CSV row " + str(line) + " [" + key + "]: " + str(error))
            continue
        normalized["position"] = len(records) + 1
        records.append(normalized)
        source_rows.append({"record": record_number, "source_line": line, "id": key})
    if errors:
        raise ValueError("The intervention CSV needs correction:\n" + "\n".join(errors))
    if not records:
        raise ValueError("The intervention CSV contains no intervention rows")
    return {
        "schema": "upstate.intervention-csv-import/v1",
        "source": {"filename": filename, "media_type": "text/csv; charset=utf-8",
                   "bytes": len(encoded), "sha256": checksum, "text": raw},
        "table_id": table["id"], "previous_plan_id": previous["id"] if previous else None,
        **({"column_mapping": columns, "source_headers": headers, "field_provenance": field_provenance}
           if value.get("column_mapping") is not None else {}),
        "selection": import_selection,
        "rows": source_rows,
        "summary": {"row_count": len(records),
                    **_intervention_changes(previous_rows, records),
                    "normalized_geographies": normalized_geographies,
                    "derived_columns": [column for column in ignored
                                        if column in INTERVENTION_DERIVED_COLUMNS],
                    "additional_columns": [column for column in ignored
                                           if column not in INTERVENTION_DERIVED_COLUMNS],
                    "order_basis": "Received CSV row order; derived context is recalculated from the saved plan"},
        "imported_interventions": records,
    }


def save_plan(workspace, selection):
    table = workspace._get(TABLE_KIND, identifier(selection.get("table_id")))
    filters, groups = select_groups(table, selection.get("selection", {}))
    previous_id = selection.get("previous_plan_id") or None
    if previous_id:
        previous = workspace._get(PLAN_KIND, identifier(previous_id))
        if previous["table_id"] != table["id"]:
            raise ValueError("A revision retains its original table; create a new plan for another source edition")
    else:
        previous = None
    context = _context(workspace, selection.get("context", {}), groups)
    requested_import = selection.get("intervention_import")
    retained_import = (previous or {}).get("intervention_import")
    if (retained_import is not None and requested_import == retained_import):
        # A later plan edition retains the original CSV parsing context, including
        # its known spreadsheet escapes and original comparison plan. Editor changes
        # below are compared with those original parsed rows without reinterpreting them.
        imported = deepcopy(retained_import)
    else:
        imported = (_intervention_import(requested_import, table, previous)
                    if requested_import is not None else None)
    supplied_interventions = selection.get(
        "interventions", imported["imported_interventions"] if imported is not None else [])
    interventions = _interventions(supplied_interventions, groups, previous)
    costs = [Decimal(row["cost_estimate_usd"]) for row in interventions if row["cost_estimate_usd"] is not None]
    value = {
        "title": text(selection.get("title"), "Community plan title", required=True, maximum=300),
        "purpose": text(selection.get("purpose"), "Community plan purpose", required=True),
        "table_id": table["id"], "selection": filters, "previous_plan_id": previous_id,
        "revision_number": previous["revision_number"] + 1 if previous else 1,
        "metadata": deepcopy(table["metadata"]), "source": deepcopy(table["source"]),
        "selected_groups": groups, "summaries": summaries(groups, table["metadata"]),
        "context": context, "interventions": interventions,
        "cost_summary": {"currency": "USD", "known_estimate_total": format(sum(costs, Decimal(0)), ".2f"),
                         "known_estimate_count": len(costs), "intervention_count": len(interventions),
                         "basis": "Operator-entered intervention planning estimates"},
        "notes": (_ids(selection.get("notes"), "Plan notes")
                  if isinstance(selection.get("notes"), list)
                  else [line for line in text(selection.get("notes"), "Plan notes").splitlines() if line.strip()]),
    }
    if imported is not None:
        imported["saved_changes"] = _intervention_changes(imported["imported_interventions"], interventions)
        value["intervention_import"] = imported
    return workspace._save(PLAN_KIND, value)


def get_table(workspace, key):
    return workspace._get(TABLE_KIND, identifier(key))


def get_plan(workspace, key):
    return workspace._get(PLAN_KIND, identifier(key))


def overview(workspace):
    return {"community_tables": workspace._list(TABLE_KIND),
            "community_plans": workspace._list(PLAN_KIND),
            "community_reports": workspace._list(REPORT_KIND)}


def verify_plan_context(workspace, plan):
    """Verify original selected files without launching or re-running a model."""
    original, entry = workspace.source_file(plan["source"]["collection_id"], plan["source"]["source_id"])
    if file_digest(original) != plan["source"]["sha256"]:
        raise ValueError("The plan's original community table changed")
    snapshots = plan["context"]["snapshots"]
    if digest(snapshots) != plan["context"]["snapshot_sha256"]:
        raise ValueError("The saved scientific context changed")
    regional = snapshots.get("watershed_context")
    if regional:
        original_regional = verify_file(workspace.root, regional["report_file"])
        report = read_json(original_regional)
        if (report.get("schema") != "upstate.watershed-context/v1"
                or report.get("id") != regional["report_id"]
                or plan["context"].get("watershed_context_id") != regional["report_id"]):
            raise ValueError("The saved Community watershed context changed")
    for run in snapshots["runs"]:
        if run.get("state") == "complete":
            for artifact in run.get("artifacts", {}).values():
                verify_file(workspace.root / "runs" / run["id"], artifact)
    for comparison in snapshots.get("comparisons", []):
        for alternative in comparison.get("alternatives", []):
            if alternative.get("run_id") in plan["context"]["scenario_run_ids"]:
                for artifact in alternative.get("artifacts", {}).values():
                    verify_file(workspace.root / "comparisons" / comparison["id"], artifact)
    return {"community_table": entry["body"]["sha256"],
            "context_snapshot": plan["context"]["snapshot_sha256"]}


def invoke(workspace, action, payload):
    if action == "community.table.import":
        return import_table(workspace, payload)
    if action == "community.plan.save":
        return save_plan(workspace, payload)
    if action == "community.report.build":
        from .community_reports import build
        return build(workspace, payload)
    raise ValueError("Unknown community operation")
