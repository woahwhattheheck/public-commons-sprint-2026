"""Compile retained USGS release members into the native annual-load contract.

The original archive receiver supplies the files. This module resolves the
published data dictionary, joins actual model-review records, and writes the
unchanged source_tools.usgs_loads contract. It performs no network acquisition.
"""
from __future__ import annotations

import argparse
from collections import defaultdict
import csv
import datetime as dt
from decimal import Decimal, InvalidOperation
import fnmatch
import json
import os
from pathlib import Path, PurePosixPath
import re
import sys
import xml.etree.ElementTree as ET

from model.common import (atomic_bytes, atomic_json, describe_file,
                          digest, file_digest, held, read_json, relative_file,
                          retain_file)

RELEASE_DOI = "10.5066/P13YSTHM"
RELEASE_URL = "https://doi.org/" + RELEASE_DOI
BINDING_SCHEMA = "upstate.usgs-release-binding/v1"
CONTRACT_SCHEMA = "upstate.usgs-seasonal-loads-contract/v1"
METADATA_SHA256 = "a1caa97c038d6b716490925c03a165aa1af3cbb8b45760b3ee560e7594fb7e95"
DICTIONARY_FIELDS = (
    "folderName", "fileName", "fileDesc", "varName", "varDef",
    "varDomMin", "varDomMax", "varUnits", "varCharVal", "varCharValDef",
)
PARAMETERS = {"nitrogen": "00600", "phosphorus": "00665"}
RESERVED = "__usgs_"
ROLE_PATTERNS = {
    "dictionary": r"(?:^|/)dataDictionary\.csv$",
    "master_stations": r"(?:^|/)master_site_list/[^/]+\.(?:csv|tsv|txt)$",
    "fluxmaster_conus_station_nitrogen": r"(?:^|/)fluxmaster/net_conus/input_sitegage_TN\.csv$",
    "fluxmaster_conus_station_phosphorus": r"(?:^|/)fluxmaster/net_conus/input_sitegage_TP\.csv$",
    "fluxmaster_conus_load_nitrogen": r"(?:^|/)fluxmaster/net_conus/output_predict(?:_flux)?_all_sub_periods_TN\.csv$",
    "fluxmaster_conus_load_phosphorus": r"(?:^|/)fluxmaster/net_conus/output_predict(?:_flux)?_all_sub_periods_TP\.csv$",
    "fluxmaster_conus_fit_nitrogen": r"(?:^|/)fluxmaster/net_conus/output_wq_summary_betaest_all_TN\.csv$",
    "fluxmaster_conus_fit_phosphorus": r"(?:^|/)fluxmaster/net_conus/output_wq_summary_betaest_all_TP\.csv$",
    "wrtds_seasonal": r"(?:^|/)seasonalFluxes_dataRelease\.csv$",
    "wrtds_model_review": r"(?:^|/)MCMResults_dataRelease\.csv$",
    "wrtds_seasonal_code": r"(?:^|/)f\.sumFluxes\.R$",
    "wrtds_workflow": r"(?:^|/)workFlow\.R$",
    "wrtds_review_code": r"(?:^|/)runMCM\.R$",
    "fluxmaster_conus_code": r"(?:^|/)fluxmaster/net_conus/z_fluxmaster_WQP_CONUS_00_20_seas_5pk_(?:TN|TP)\.sas$",
}


def _path(value):
    value = str(value).replace("\\", "/").strip().strip("/")
    return value


def _table(root, selection):
    if isinstance(selection, str):
        selection = {"path": selection}
    path = relative_file(root, selection["path"])
    encoding = selection.get("encoding", "utf-8-sig")
    delimiter = selection.get("delimiter")
    if delimiter is None:
        with path.open(encoding=encoding, newline="") as stream:
            sample = stream.read(65536)
        try:
            delimiter = csv.Sniffer().sniff(sample, delimiters=",\t").delimiter
        except csv.Error as error:
            raise ValueError("Select the actual comma or tab delimiter for " + str(path)) from error
    if delimiter not in (",", "\t"):
        raise ValueError("The original release table must use its comma or tab delimiter")
    return path, {"delimiter": delimiter, "encoding": encoding}


def _rows(path, format_spec):
    with Path(path).open(encoding=format_spec["encoding"], newline="") as stream:
        reader = csv.DictReader(stream, delimiter=format_spec["delimiter"])
        header = reader.fieldnames
        if not header or any(not value for value in header) or len(set(header)) != len(header):
            raise ValueError("Source table headers must be distinct and nonempty: " + str(path))
        for number, row in enumerate(reader, 1):
            if None in row or any(value is None for value in row.values()):
                raise ValueError("Source table row has an inconsistent field count: " + str(path)
                                 + " record " + str(number))
            yield {"record_number": number, "ending_line": reader.line_num,
                   "columns": header, "row": row}


def _header(path, format_spec):
    with Path(path).open(encoding=format_spec["encoding"], newline="") as stream:
        header = next(csv.reader(stream, delimiter=format_spec["delimiter"]), [])
    if not header or any(not value for value in header) or len(set(header)) != len(header):
        raise ValueError("Source table headers must be distinct and nonempty: " + str(path))
    return header


def _metadata(path):
    if file_digest(path) != METADATA_SHA256:
        raise ValueError("Select the original 32,059-byte metadata2.xml from the retained P13YSTHM edition")
    document = ET.parse(path)
    labels = [item.text for item in document.findall(".//eainfo/detailed/attr/attrlabl")]
    if tuple(labels) != DICTIONARY_FIELDS:
        raise ValueError("The original metadata dictionary schema differs")
    return {"path": str(path), "sha256": METADATA_SHA256,
            "bytes": Path(path).stat().st_size, "dictionary_fields": list(labels)}


def _dictionary(root, selection):
    path, fmt = _table(root, selection)
    if set(_header(path, fmt)) != set(DICTIONARY_FIELDS):
        raise ValueError("Use the original dataDictionary.csv and its ten published columns")
    records = list(_rows(path, fmt))
    if not records:
        raise ValueError("The original data dictionary has no records")
    return path, fmt, records


def _folder_matches(actual, described):
    """Match an original path suffix, without inventing archive directories."""
    described = _path(described)
    if not described or described in (".", "*"):
        return True
    actual = _path(actual)
    return (fnmatch.fnmatchcase(actual, described)
            or fnmatch.fnmatchcase(actual, "*/" + described))


def _definitions(records, source_path, column, selection=None):
    candidates = [item for item in records if item["row"]["varName"].strip() == column]
    if selection is not None:
        if (not isinstance(selection, list) or not selection
                or any(type(number) is not int or number < 1 for number in selection)):
            raise ValueError("Dictionary record selection needs actual positive record numbers")
        wanted = set(selection)
        candidates = [item for item in candidates if item["record_number"] in wanted]
        if {item["record_number"] for item in candidates} != wanted:
            raise ValueError("Selected dictionary records do not define " + column)
    else:
        actual = PurePosixPath(_path(source_path))
        candidates = [
            item for item in candidates
            if fnmatch.fnmatchcase(actual.name, item["row"]["fileName"].strip())
            and _folder_matches(str(actual.parent), item["row"]["folderName"])
        ]
    if not candidates:
        raise ValueError("Select the actual dictionary records defining " + str(source_path) + " / " + column)
    identities = {(item["row"]["folderName"], item["row"]["fileName"]) for item in candidates}
    if len(identities) != 1:
        raise ValueError("Dictionary file definitions are ambiguous for " + str(source_path) + " / " + column)
    return candidates


def _definition_view(records):
    return [
        {"record_number": item["record_number"], "ending_line": item["ending_line"], **item["row"]}
        for item in records
    ]


def inspect_members(original_root, *, metadata, dictionary, table_formats=None):
    """Resolve actual received member names, headers and dictionary definitions."""
    root = Path(original_root).resolve(strict=True)
    metadata_path = relative_file(root, metadata)
    metadata_record = _metadata(metadata_path)
    dictionary_path, dictionary_format, records = _dictionary(root, dictionary)
    formats = table_formats or {}
    members = []
    for path in sorted(root.rglob("*")):
        if not path.is_file() or path.is_symlink():
            continue
        relative = path.relative_to(root).as_posix()
        roles = [role for role, pattern in ROLE_PATTERNS.items() if re.search(pattern, relative)]
        if not roles:
            continue
        entry = {"path": relative, "bytes": path.stat().st_size, "roles": roles}
        if path.suffix.lower() in (".csv", ".tsv", ".txt"):
            try:
                _, fmt = _table(root, {"path": relative, **formats.get(relative, {})})
                header = _header(path, fmt)
                definitions, unresolved = {}, {}
                for column in header:
                    try:
                        definitions[column] = _definition_view(_definitions(records, relative, column))
                    except ValueError as error:
                        unresolved[column] = str(error)
                entry.update(format=fmt, columns=header, definitions=definitions,
                             unresolved_dictionary_columns=unresolved)
            except (ValueError, UnicodeError) as error:
                entry["table_read_error"] = str(error)
        members.append(entry)
    described = defaultdict(list)
    for item in records:
        row = item["row"]
        described[(row["folderName"], row["fileName"], row["fileDesc"])].append(item["record_number"])
    return {
        "schema": "upstate.usgs-release-member-inspection/v1",
        "release": {"doi": RELEASE_DOI, "metadata": metadata_record},
        "dictionary": {**describe_file(root, dictionary_path), "format": dictionary_format,
                       "records": len(records)},
        "members": members,
        "role_members": {role: [entry["path"] for entry in members if role in entry["roles"]]
                         for role in ROLE_PATTERNS},
        "dictionary_files": [{"folderName": key[0], "fileName": key[1], "fileDesc": key[2],
                              "dictionary_records": values}
                             for key, values in sorted(described.items())],
        "source_naming": "The original metadata uses both output_predict_all_sub_periods and "
                         "output_predict_flux_all_sub_periods. Actual received members and their "
                         "dictionary rows determine the selected source.",
    }


def _strings(value, label):
    if (not isinstance(value, list) or not value or any(not isinstance(v, str) for v in value)
            or len(set(value)) != len(value)):
        raise ValueError(label + " requires distinct native string values")
    return value


def _unit(records, override=None):
    """Interpret original mass dimensions; an explicit binding never converts."""
    raw_units = sorted({item["row"]["varUnits"].strip() for item in records
                        if item["row"]["varUnits"].strip()})
    if len(raw_units) != 1:
        raise ValueError("Select one original load-unit definition")
    raw = raw_units[0]
    normalized = raw.lower().replace("kilograms", "kg").replace("kilogram", "kg")
    normalized = normalized.replace("grams", "g").replace("gram", "g")
    normalized = normalized.replace("pounds", "lb").replace("pound", "lb")
    normalized = normalized.replace("metric tons", "metric_tonnes").replace("metric tonnes", "metric_tonnes")
    normalized = normalized.replace("metric ton", "metric_tonnes").replace("metric tonne", "metric_tonnes")
    normalized = normalized.replace(" per ", "/").replace("days", "day")
    normalized = normalized.replace("⁻¹", "-1").replace("^-1", "-1").replace("·", "")
    normalized = re.sub(r"\s+", "", normalized)
    aliases = {"kg": "kg", "g": "g", "lb": "lb", "lbs": "lb",
               "metric_tonnes": "metric_tonnes"}
    unit, basis = None, None
    for spelling, mass in aliases.items():
        if normalized in (spelling + "/day", spelling + "/d", spelling + "day-1", spelling + "d-1"):
            unit, basis = mass, "mean_daily_mass"
        elif normalized in (spelling + "/season", spelling + "/quarter"):
            unit, basis = mass, "season_total_mass"
        elif normalized == spelling:
            unit = mass
    if unit is None:
        raise ValueError("The original load unit is not a supported mass or daily mass rate: " + raw)
    definitions = " ".join(item["row"]["varDef"].lower() for item in records)
    if basis is None:
        daily = re.search(r"\b(?:mean|average)\s+daily\b|\bdaily\s+(?:mean|average)\b", definitions)
        seasonal_total = re.search(
            r"\b(?:seasonal|quarterly)\s+(?:total|cumulative)\b|"
            r"\b(?:total|cumulative)\s+(?:seasonal|quarterly)\b|"
            r"\btotal\s+(?:mass|load)\s+(?:for|during|over)\s+(?:the\s+)?(?:season|quarter)\b",
            definitions)
        if daily and seasonal_total:
            raise ValueError("The dictionary contains conflicting original load time bases")
        if daily:
            basis = "mean_daily_mass"
        elif seasonal_total:
            basis = "season_total_mass"
    if override is not None:
        if set(override) != {"mass_unit", "value_basis"}:
            raise ValueError("unit_binding requires mass_unit and value_basis")
        if unit != override["mass_unit"]:
            raise ValueError("The declared mass unit differs from the original dictionary")
        if basis is not None and basis != override["value_basis"]:
            raise ValueError("The declared time basis differs from the original dictionary")
        basis = override["value_basis"]
    if basis not in ("mean_daily_mass", "season_total_mass"):
        raise ValueError("Bind the original time basis to its dictionary or source code: " + raw)
    return unit, basis, raw


class Compiler:
    """Bind original bytes and dictionary locations to one immutable contract."""

    def __init__(self, original_root, output_directory, binding_path):
        self.root = Path(original_root).resolve(strict=True)
        self.output = Path(output_directory).resolve()
        self.binding_path = Path(binding_path).resolve(strict=True)
        self.binding = read_json(self.binding_path)
        if self.binding.get("schema") != BINDING_SCHEMA:
            raise ValueError("Use " + BINDING_SCHEMA)
        self.files, self.identities, self.aliases, self.normalizations = {}, {}, {}, []
        self.output.mkdir(parents=True, exist_ok=True)
        atomic_bytes(self.output / "original-binding.json", self.binding_path.read_bytes(), immutable=True)
        metadata_id = self.retain(self.binding["metadata"], alias="metadata", kind="metadata_xml")
        self.metadata_path = relative_file(self.output, self.files[metadata_id]["path"])
        _metadata(self.metadata_path)
        dictionary = self.binding["dictionary"]
        if isinstance(dictionary, str):
            dictionary = {"path": dictionary}
        dictionary_id = self.retain(dictionary["path"], alias="dictionary", kind="table")
        self.dictionary_path, self.dictionary_format, self.dictionary_records = _dictionary(
            self.output, {**dictionary, "path": self.files[dictionary_id]["path"]})

    def retain(self, source_path, *, alias=None, kind=None, uri=None):
        path = relative_file(self.root, source_path)
        relative = path.relative_to(self.root).as_posix()
        key = "original-" + digest(relative)[:20]
        if key not in self.files:
            saved = retain_file(self.output, path)
            destination = self.output / "original" / relative
            destination.parent.mkdir(parents=True, exist_ok=True)
            if destination.exists():
                if file_digest(destination) != saved["sha256"]:
                    raise ValueError("The retained original member changed: " + relative)
            else:
                os.link(self.output / saved["object"], destination)
            if uri is not None and (not isinstance(uri, str) or not uri.strip()):
                raise ValueError("An external original source needs its actual source URI")
            entry = {**describe_file(self.output, destination), "uri": uri or RELEASE_URL,
                     "original_member": relative}
            if kind:
                entry["kind"] = kind
            self.files[key] = entry
            self.identities[relative] = saved["sha256"]
        elif uri is not None and uri != self.files[key]["uri"]:
            raise ValueError("The same original member has conflicting source URIs: " + relative)
        if alias:
            if alias in self.aliases and self.aliases[alias] != key:
                raise ValueError("Original source alias is ambiguous: " + alias)
            self.aliases[alias] = key
        return key

    def evidence(self, values):
        if not isinstance(values, list) or not values:
            raise ValueError("Bind the selected interpretation to original dictionary, metadata or code locations")
        result = []
        for value in values:
            if not isinstance(value, dict) or not value.get("location"):
                raise ValueError("Each original source reference needs its exact location")
            if value.get("path"):
                key = self.retain(value["path"], uri=value.get("uri"))
            elif value.get("alias") in self.aliases:
                key = self.aliases[value["alias"]]
            else:
                raise ValueError("Source reference requires a retained path or declared source alias")
            result.append({"file_id": key, "location": value["location"]})
        return result

    def definitions(self, table, column):
        mapping = table.get("dictionary_records", {})
        return _definitions(self.dictionary_records, table["path"], column, mapping.get(column))

    def dictionary_evidence(self, table, column):
        records = self.definitions(table, column)
        return [
            {"file_id": self.aliases["dictionary"],
             "location": "dataDictionary.csv record " + str(item["record_number"])
                         + " / folderName=" + item["row"]["folderName"]
                         + " / fileName=" + item["row"]["fileName"]
                         + " / varName=" + item["row"]["varName"]}
            for item in records
        ]

    def source_table(self, value, alias):
        key = self.retain(value["path"], alias=alias, kind="table", uri=value.get("uri"))
        path, fmt = _table(self.output, {**value, "path": self.files[key]["path"]})
        header = _header(path, fmt)
        if any(column.startswith(RESERVED) for column in header):
            raise ValueError("Original table collides with the explicit normalization prefix")
        return path, fmt, header, key

    def rules(self, values, table, header, joined):
        result = []
        for rule in values or []:
            column = rule["column"]
            accepted = _strings(rule["allowed_values"], "Original qualifier selection")
            if column in joined:
                destination, source_table, source_column = joined[column]
                records = self.definitions(source_table, source_column)
                evidence = self.dictionary_evidence(source_table, source_column)
                column = destination
            else:
                if column not in header:
                    raise ValueError("Source qualifier column is absent: " + column)
                records = self.definitions(table, column)
                evidence = self.dictionary_evidence(table, column)
            enumerated = {item["row"]["varCharVal"].strip() for item in records
                          if item["row"]["varCharVal"].strip() or item["row"]["varCharValDef"].strip()}
            if enumerated and set(accepted) - enumerated:
                raise ValueError("Accepted source qualifier is outside the original dictionary enumeration")
            if not isinstance(rule.get("meaning"), str) or not rule["meaning"].strip():
                raise ValueError("Describe the actual accepted source qualifier")
            result.append({"column": column, "allowed_values": accepted,
                           "meaning": rule["meaning"], "evidence": evidence})
        return result

    def join_indexes(self, load_table, load_header):
        definitions, joined, rules = [], {}, []
        for specification in load_table.get("joins", []):
            name = specification["name"]
            if not re.fullmatch(r"[A-Za-z][A-Za-z0-9_]*", name):
                raise ValueError("Name each original review join with a stable identifier")
            table = specification["table"]
            path, fmt, header, file_id = self.source_table(
                table, "review-" + name + "-" + digest(table["path"])[:12])
            left_on = _strings(specification["left_on"], "Load-table join keys")
            right_on = _strings(specification["right_on"], "Review-table join keys")
            if len(left_on) != len(right_on) or set(left_on) - set(load_header) or set(right_on) - set(header):
                raise ValueError("Review join keys differ from the original table headers")
            for column in left_on:
                self.dictionary_evidence(load_table, column)
            for column in right_on:
                self.dictionary_evidence(table, column)
            copied = _strings(specification["columns"], "Review fields")
            if set(copied) - set(header):
                raise ValueError("A selected original review field is absent")
            filters = specification.get("where", {})
            if not isinstance(filters, dict) or set(filters) - set(header):
                raise ValueError("Review filtering must select actual source columns")
            for column, values in filters.items():
                _strings(values, "Review filter")
                self.dictionary_evidence(table, column)
            index = {}
            for item in _rows(path, fmt):
                row = item["row"]
                if any(row[column].strip() not in values for column, values in filters.items()):
                    continue
                key = tuple(row[column].strip() for column in right_on)
                if any(not value for value in key):
                    raise ValueError("A selected review record has an empty original join key")
                if key in index:
                    raise ValueError("Review join is not one-to-one for " + name + " / " + repr(key))
                index[key] = item
            prefix = RESERVED + "review_" + name + "_"
            for column in copied:
                logical = "review." + name + "." + column
                if logical in joined:
                    raise ValueError("Review join field is repeated: " + logical)
                self.dictionary_evidence(table, column)
                joined[logical] = (prefix + column, table, column)
            required = specification.get("required", True)
            if not isinstance(required, bool):
                raise ValueError("Review join required must be true or false")
            if required:
                rules.append({
                    "column": prefix + "match", "allowed_values": ["matched"],
                    "meaning": "An actual unique original model-review record is required",
                    "evidence": self.evidence(specification["relationship_evidence"]),
                })
            definitions.append({"name": name, "left_on": left_on, "right_on": right_on,
                                "columns": copied, "prefix": prefix, "index": index,
                                "file_id": file_id, "source_table": table,
                                "where": filters, "required": required,
                                "relationship_evidence": self.evidence(specification["relationship_evidence"])})
        return definitions, joined, rules

    def calendar(self, table, header):
        calendar = dict(table["period_definition"])
        if set(calendar) - {"annual_start_month", "year_label", "quarter_values",
                            "source_end_inclusive", "evidence"}:
            raise ValueError("Use the native annual-start/year-label/quarter calendar fields")
        month = calendar.get("annual_start_month")
        labels = _strings(calendar.get("quarter_values"), "Original quarter labels")
        if type(month) is not int or not 1 <= month <= 12 or len(labels) != 4:
            raise ValueError("Select the original annual starting month and all four ordered quarter labels")
        if calendar.get("year_label") not in ("start", "end"):
            raise ValueError("State whether the original annual label names the start or end year")
        calendar["evidence"] = self.evidence(calendar["evidence"])
        return calendar

    def _derived_period(self, row, table, calendar):
        normalization = table.get("period_normalization")
        if not normalization:
            return {}
        mode = normalization["mode"]
        if mode == "label":
            pattern = normalization["pattern"]
            if len(pattern) > 500:
                raise ValueError("Use the original compact period-label format")
            found = re.fullmatch(pattern, row[normalization["column"]].strip())
            if found is None or set(found.groupdict()) != {"year", "quarter"}:
                raise ValueError("Original period label does not match its source-bound year/quarter grammar")
            year, quarter = found.group("year"), found.group("quarter")
        elif mode == "start_date":
            value = dt.datetime.strptime(row[normalization["column"]].strip(),
                                         normalization["date_format"]).date()
            start_month = calendar["annual_start_month"]
            offset = (value.month - start_month) % 12
            if value.day != 1 or offset not in (0, 3, 6, 9):
                raise ValueError("Original seasonal start date is outside the selected native calendar")
            beginning = value.year if value.month >= start_month else value.year - 1
            year = str(beginning + (calendar["year_label"] == "end" and start_month != 1))
            quarter = calendar["quarter_values"][offset // 3]
        else:
            raise ValueError("Period normalization mode must be label or start_date")
        try:
            number = Decimal(year)
        except InvalidOperation as error:
            raise ValueError("Original annual period label is not numeric") from error
        if not number.is_finite() or number != number.to_integral_value() or not 1 <= number <= 9999:
            raise ValueError("Original annual period label is not a calendar year")
        if quarter not in calendar["quarter_values"]:
            raise ValueError("Original quarter label is outside its actual dictionary definition")
        return {RESERVED + "year": str(int(number)), RESERVED + "quarter": quarter}

    def normalize(self, table, path, fmt, header, file_id, calendar, joins):
        if not table.get("period_normalization") and not joins:
            return file_id, fmt, {}, {"source_rows": None, "joins": []}
        extra = [RESERVED + "source_record_number", RESERVED + "source_ending_line",
                 RESERVED + "source_file_id", RESERVED + "original"]
        period_columns = {}
        if table.get("period_normalization"):
            definition = table["period_normalization"]
            if definition["column"] not in header:
                raise ValueError("Original period source column is absent")
            if definition.get("mode") == "label":
                pattern = definition["pattern"]
                if not isinstance(pattern, str) or len(pattern) > 500:
                    raise ValueError("Use the original compact period-label format")
                if set(re.compile(pattern).groupindex) != {"year", "quarter"}:
                    raise ValueError("Original period grammar must name exactly year and quarter")
            elif definition.get("mode") == "start_date":
                if not isinstance(definition.get("date_format"), str) or not definition["date_format"]:
                    raise ValueError("Select the original source date format")
            else:
                raise ValueError("Period normalization mode must be label or start_date")
            self.dictionary_evidence(table, definition["column"])
            self.evidence(definition["evidence"])
            extra.extend([RESERVED + "year", RESERVED + "quarter", RESERVED + "period_issue"])
            period_columns = {"year": RESERVED + "year", "quarter": RESERVED + "quarter"}
        for join in joins:
            extra.extend([join["prefix"] + column for column in join["columns"]])
            extra.extend([join["prefix"] + value for value in ("match", "source_record_number", "original")])
        if len(set(header + extra)) != len(header + extra):
            raise ValueError("Normalized source fields collide")
        source_stamp = {"table": table, "source": self.files[file_id]["sha256"],
                        "dictionary": self.files[self.aliases["dictionary"]]["sha256"],
                        "metadata": METADATA_SHA256,
                        "reviews": {join["name"]: self.files[join["file_id"]]["sha256"] for join in joins}}
        output = self.output / "normalized" / (digest(source_stamp) + ".csv")
        output.parent.mkdir(parents=True, exist_ok=True)
        pending = output.with_suffix(".csv.partial")
        counts = {join["name"]: {"matched": 0, "missing": 0} for join in joins}
        total, period_issues = 0, 0
        try:
            with pending.open("w", encoding="utf-8", newline="") as stream:
                writer = csv.DictWriter(stream, fieldnames=header + extra, lineterminator="\n")
                writer.writeheader()
                for item in _rows(path, fmt):
                    row = item["row"]
                    selected = dict(row)
                    selected.update({
                        RESERVED + "source_record_number": str(item["record_number"]),
                        RESERVED + "source_ending_line": str(item["ending_line"]),
                        RESERVED + "source_file_id": file_id,
                        RESERVED + "original": json.dumps(row, sort_keys=True, separators=(",", ":"), ensure_ascii=False),
                    })
                    if table.get("period_normalization"):
                        try:
                            selected.update(self._derived_period(row, table, calendar))
                            selected[RESERVED + "period_issue"] = ""
                        except (ValueError, TypeError, OverflowError, InvalidOperation) as error:
                            selected.update({RESERVED + "year": "", RESERVED + "quarter": "",
                                             RESERVED + "period_issue": str(error)})
                            period_issues += 1
                    for join in joins:
                        match = join["index"].get(tuple(row[column].strip() for column in join["left_on"]))
                        prefix = join["prefix"]
                        status = "matched" if match else "missing"
                        counts[join["name"]][status] += 1
                        selected[prefix + "match"] = status
                        selected[prefix + "source_record_number"] = str(match["record_number"]) if match else ""
                        selected[prefix + "original"] = json.dumps(
                            {"file_id": join["file_id"], **match}, sort_keys=True, separators=(",", ":"),
                            ensure_ascii=False) if match else ""
                        for column in join["columns"]:
                            selected[prefix + column] = match["row"][column] if match else ""
                    writer.writerow(selected)
                    total += 1
                stream.flush()
                os.fsync(stream.fileno())
            if output.exists():
                if file_digest(output) != file_digest(pending):
                    raise ValueError("The retained normalized table differs from this source binding")
                pending.unlink()
            else:
                os.replace(pending, output)
        finally:
            if pending.exists():
                pending.unlink()
        identity = describe_file(self.output, output)
        key = "normalized-" + identity["sha256"][:20]
        self.files[key] = {**identity, "uri": RELEASE_URL, "kind": "table",
                           "lineage": {"original_file_id": file_id, "period_normalization": table.get("period_normalization"),
                                       "review_joins": [{k: v for k, v in join.items() if k != "index"} for join in joins]}}
        summary = {"file_id": key, "original_file_id": file_id, "source_rows": total,
                   "period_issue_rows": period_issues, "source_stamp": source_stamp,
                   "joins": [{"name": key, **value} for key, value in sorted(counts.items())]}
        self.normalizations.append(summary)
        return key, {"delimiter": ",", "encoding": "utf-8-sig"}, period_columns, summary

    def compile(self):
        self.retain(self.binding["metadata"], alias="metadata", kind="metadata_xml")
        self.retain(self.binding["dictionary"]["path"] if isinstance(self.binding["dictionary"], dict)
                    else self.binding["dictionary"], alias="dictionary", kind="table")
        for alias, definition in self.binding.get("evidence_files", {}).items():
            self.retain(definition["path"], alias=alias, kind=definition.get("kind"), uri=definition.get("uri"))
        station = self.binding["station_table"]
        _, station_fmt, station_header, station_id = self.source_table(station, "stations")
        station_columns = dict(station["columns"])
        for role in ("station_id", "station_name", "longitude", "latitude"):
            if role not in station_columns:
                raise ValueError("Original station mapping is missing " + role)
        for column in station_columns.values():
            if column not in station_header:
                raise ValueError("Original station column is absent: " + column)
            self.dictionary_evidence(station, column)
        station_contract = {
            "file_id": station_id, **station_fmt, "columns": station_columns,
            "coordinate_crs": station["coordinate_crs"],
            "coordinate_evidence": self.evidence(station["coordinate_evidence"]),
            "inspect_columns": station.get("inspect_columns", []),
        }
        loads = []
        for number, table in enumerate(self.binding["load_tables"], 1):
            path, fmt, header, file_id = self.source_table(table, "loads-" + str(number))
            columns = dict(table["columns"])
            if "station_id" not in columns or columns["station_id"] not in header:
                raise ValueError("Select the actual seasonal water-quality station identity")
            for column in columns.values():
                if column not in header:
                    raise ValueError("Original load column is absent: " + column)
                self.dictionary_evidence(table, column)
            calendar = self.calendar(table, header)
            joins, joined, required_rules = self.join_indexes(table, header)
            row_rules = self.rules(table.get("row_rules"), table, header, joined) + required_rules
            parameters = []
            for spec in table["parameters"]:
                name = spec["parameter"]
                if name not in PARAMETERS:
                    raise ValueError("This release supplies total nitrogen and total phosphorus loads")
                load_column, method_column = spec["load_column"], spec["method_column"]
                if load_column not in header or method_column not in header:
                    raise ValueError("Select the original native load and estimator columns")
                unit_records = self.definitions(table, load_column)
                unit, basis, native_units = _unit(unit_records, spec.get("unit_binding"))
                evidence = self.dictionary_evidence(table, load_column) + self.dictionary_evidence(table, method_column)
                if spec.get("unit_binding"):
                    evidence.extend(self.evidence(spec["unit_evidence"]))
                methods = _strings(spec["accepted_methods"], "Native estimator selection")
                enumerated = {item["row"]["varCharVal"].strip() for item in self.definitions(table, method_column)
                              if item["row"]["varCharVal"].strip()}
                if enumerated and set(methods) - enumerated:
                    raise ValueError("Selected estimator is outside the original dictionary enumeration")
                uncertainties = spec.get("uncertainty_columns", [])
                if not isinstance(uncertainties, list) or set(uncertainties) - set(header):
                    raise ValueError("Select actual original uncertainty columns")
                uncertainty_evidence = []
                for column in uncertainties:
                    uncertainty_evidence.extend(self.dictionary_evidence(table, column))
                parameters.append({
                    "parameter": name, "parameter_code": PARAMETERS[name],
                    "load_column": load_column, "method_column": method_column,
                    "mass_unit": unit, "value_basis": basis, "native_dictionary_units": native_units, "evidence": evidence,
                    "accepted_methods": methods,
                    "allow_mixed_estimators": spec.get("allow_mixed_estimators") is True,
                    "uncertainty_columns": uncertainties, "uncertainty_evidence": uncertainty_evidence,
                    "row_rules": self.rules(spec.get("row_rules"), table, header, joined),
                })
            normalized_id, output_fmt, period_columns, _ = self.normalize(
                table, path, fmt, header, file_id, calendar, joins)
            columns.update(period_columns)
            if not {"year", "quarter"} <= set(columns):
                raise ValueError("Bind original year/quarter columns or normalize the actual native period label")
            loads.append({
                "file_id": normalized_id, **output_fmt,
                "series_id": table["series_id"], "series_evidence": self.evidence(table["series_evidence"]),
                "columns": columns, "period_definition": calendar,
                "parameters": parameters, "row_rules": row_rules,
                "inspect_columns": table.get("inspect_columns", []),
            })
        if not loads:
            raise ValueError("Select at least one original seasonal load table")
        reporting = dict(self.binding["reporting_area"])
        reporting_path = reporting.pop("path")
        reporting_uri = reporting.pop("uri")
        if not isinstance(reporting_uri, str) or not reporting_uri.strip():
            raise ValueError("Retain the original reporting-area source URI")
        reporting["file_id"] = self.retain(reporting_path, alias="reporting", uri=reporting_uri)
        reporting["evidence"] = self.evidence(reporting["evidence"])
        for path in self.binding.get("reporting_companions", []):
            self.retain(path, uri=reporting_uri)
        selections = []
        for selection in self.binding.get("selections", []):
            item = json.loads(json.dumps(selection, allow_nan=False))
            item["selection_evidence"] = self.evidence(item["selection_evidence"])
            item["catchment"]["identity_evidence"] = self.evidence(item["catchment"]["identity_evidence"])
            selections.append(item)
        contract = {
            "schema": CONTRACT_SCHEMA, "title": self.binding["title"],
            "release": {"doi": RELEASE_DOI, "metadata_sha256": METADATA_SHA256,
                        "archive_name": "data_release3.zip", "archive_bytes": 1897877062,
                        "publisher_md5": "2dc4d81994c4fcbf7d27728eb16fdaef"},
            "files": self.files, "station_table": station_contract, "load_tables": loads,
            "reporting_area": reporting, "selections": selections,
            "compilation": {"binding_sha256": file_digest(self.binding_path),
                            "dictionary_file_id": self.aliases["dictionary"],
                            "metadata_file_id": self.aliases["metadata"],
                            "normalizations": self.normalizations},
        }
        atomic_bytes(self.output / "original-binding.json", self.binding_path.read_bytes(), immutable=True)
        atomic_json(self.output / "source-contract.json", contract, immutable=True)
        from .usgs_loads import _load_contract
        _load_contract(self.output / "source-contract.json", self.output)
        result = {
            "schema": "upstate.usgs-release-contract-result/v1",
            "contract": describe_file(self.output, self.output / "source-contract.json"),
            "binding": describe_file(self.output, self.output / "original-binding.json"),
            "source_files": len(self.files), "load_tables": len(loads),
            "parameters": sorted({spec["parameter"] for table in loads for spec in table["parameters"]}),
            "normalizations": self.normalizations,
            "original_file_identities": self.identities,
        }
        result["id"] = digest(result)
        atomic_json(self.output / "result.json", result, immutable=True)
        return result


def compile_contract(original_root, output_directory, binding_path):
    output = Path(output_directory).resolve()
    output.mkdir(parents=True, exist_ok=True)
    with held(output / ".compile.lock", blocking=False):
        saved_result = output / "result.json"
        if saved_result.exists():
            result = read_json(saved_result)
            identity = dict(result)
            recorded_id = identity.pop("id", None)
            if recorded_id != digest(identity):
                raise ValueError("The completed source-contract result changed")
            binding_bytes = Path(binding_path).read_bytes()
            if (output / "original-binding.json").read_bytes() != binding_bytes:
                raise ValueError("Select a new output directory for a different original binding")
            root = Path(original_root).resolve(strict=True)
            for path, expected_sha256 in result["original_file_identities"].items():
                if file_digest(relative_file(root, path)) != expected_sha256:
                    raise ValueError("The original selected source member changed: " + path)
            for key in ("contract", "binding"):
                expected = result[key]
                actual = describe_file(output, relative_file(output, expected["path"]))
                if actual != expected:
                    raise ValueError("The completed source-contract artifact changed: " + key)
            from .usgs_loads import _load_contract
            _load_contract(output / "source-contract.json", output)
            return result
        compiler = Compiler(original_root, output, binding_path)
        return compiler.compile()


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect")
    inspect.add_argument("--original-root", required=True)
    inspect.add_argument("--metadata", required=True, help="Original-root-relative metadata2.xml")
    inspect.add_argument("--dictionary", required=True, help="Original-root-relative dataDictionary.csv")
    inspect.add_argument("--table-formats", help="JSON mapping of original paths to encoding/delimiter")
    inspect.add_argument("--output-json", required=True)
    compile_parser = commands.add_parser("compile")
    compile_parser.add_argument("--original-root", required=True)
    compile_parser.add_argument("--binding", required=True)
    compile_parser.add_argument("--output", required=True)
    arguments = parser.parse_args(argv)
    try:
        if arguments.command == "inspect":
            result = inspect_members(arguments.original_root, metadata=arguments.metadata,
                                     dictionary=arguments.dictionary,
                                     table_formats=read_json(arguments.table_formats)
                                     if arguments.table_formats else None)
            atomic_json(Path(arguments.output_json), result, immutable=True)
        else:
            result = compile_contract(arguments.original_root, arguments.output, arguments.binding)
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (OSError, ValueError, KeyError, TypeError, csv.Error, ET.ParseError, re.error) as error:
        print("USGS release binding error: " + str(error), file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
