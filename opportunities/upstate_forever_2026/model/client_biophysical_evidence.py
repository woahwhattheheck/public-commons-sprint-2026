"""Selected coefficient evidence in existing scientific and customer deliveries.

The original profile, source-bound evidence reader and endpoint materializer own
scientific values. This adapter selects, retains and presents their saved records.
"""
from __future__ import annotations

import copy
import csv
import hashlib
import io
from pathlib import Path

from .common import (atomic_bytes, atomic_json, canonical, describe_file, digest,
                     file_digest, identifier, selected_models, verify_file)
from . import biophysical_evidence as evidence

VERSION = "upstate.client-coefficient-evidence/v1"
CATALOG = "upstate.client-coefficient-catalog/v1"
TITLE = "Coefficient sources and selected ranges"
PREFIX = "coefficient-evidence"
MAX_ROWS = 12
METHODS = {
    "selection": "Evidence and range editions are explicitly selected. The original table is "
                 "retained for every profile used in this report.",
    "coverage": "Coverage counts coefficient cells in the selected model scope. It is not "
                "geographic coverage, statistical confidence or a calibration score.",
    "ranges": "Saved lower and upper values are coefficient endpoints from their cited sources. "
              "They do not imply lower or higher modeled pollution or a confidence interval.",
    "load_basis": "Original nutrient load_type tags and input values are unchanged. Application "
                  "rates retain their native model interpretation; no load is pre-reduced here.",
    "multiple": "Separate evidence editions retain separate coverage and citations. Their counts "
                "are not added together or silently ranked.",
}


def _ids(value, label):
    if not isinstance(value, list):
        raise ValueError(label + " must be a list of original saved IDs")
    result = [identifier(item) for item in value]
    if len(result) != len(set(result)):
        raise ValueError(label + " must contain distinct original IDs")
    return sorted(result)


def _profile(workspace, key):
    value = evidence.catalog(workspace, identifier(key))
    return {
        "id": value["profile"]["id"], "title": value["profile"]["title"],
        "models": value["profile"]["models"], "table": value["table"],
        "coverage": value["coverage"],
    }


def _matches(record, profile_ids):
    return [
        {"profile_id": key,
         "positions": [position for position in ("central", "lower", "upper")
                       if record["profiles"][position]["profile_id"] == key]}
        for key in profile_ids
        if any(item["profile_id"] == key for item in record["profiles"].values())
    ]


def _evidence_choice(record):
    return {
        "id": record["id"], "profile_id": record["profile_id"],
        "title": record["source"]["title"], "coverage": copy.deepcopy(record["coverage"]),
        "source": copy.deepcopy(record["source"]),
    }


def _range_choice(record, profile_ids):
    return {
        "id": record["id"], "title": record["title"], "reason": record["reason"],
        "evidence_id": record["evidence_id"], "profile_id": record["profile_id"],
        "profiles": copy.deepcopy(record["profiles"]),
        "matched_profiles": _matches(record, profile_ids),
        "parameter_count": len(record["selected_cells"]),
        "parameters": sorted({cell["parameter"] for cell in record["selected_cells"]}),
        "coverage": copy.deepcopy(record["coverage"]),
    }


def catalog(workspace, profile_ids):
    """Choices for actual selected run profiles, including saved endpoint profiles."""
    ids = _ids(profile_ids, "Selected profiles")
    profiles = [_profile(workspace, key) for key in ids]
    direct = []
    for row in workspace._list(evidence.EVIDENCE_KIND):
        if row["profile_id"] in ids:
            direct.append(_evidence_choice(evidence.inspect_evidence(workspace, row["id"])))
    ranges = []
    for row in workspace._list(evidence.RANGES_KIND):
        if _matches(row, ids):
            ranges.append(_range_choice(evidence.inspect_ranges(workspace, row["id"]), ids))
    return {
        "schema": CATALOG, "workspace_id": workspace.project["id"], "profiles": profiles,
        "evidence": sorted(direct, key=lambda row: row["id"]),
        "ranges": sorted(ranges, key=lambda row: row["id"]), "methods": METHODS,
    }


def _implementation():
    from . import client_report, experiment_profiles, profiles, scientific_report
    modules = {
        "client_biophysical_evidence": Path(__file__),
        "biophysical_evidence": Path(evidence.__file__),
        "experiment_profiles": Path(experiment_profiles.__file__),
        "profiles": Path(profiles.__file__),
        "scientific_report": Path(scientific_report.__file__),
        "client_report": Path(client_report.__file__),
    }
    return modules


def bind(workspace, selection, profile_ids):
    """Bind exact selected original sources before the delivery ID is calculated."""
    ids = _ids(profile_ids, "Selected profiles")
    requested = selection.get("coefficient_evidence", {})
    if not isinstance(requested, dict) or set(requested) - {"evidence_ids", "range_ids"}:
        raise ValueError("Choose coefficient_evidence with evidence_ids and range_ids")
    chosen = {
        "evidence_ids": _ids(requested.get("evidence_ids", []), "Coefficient evidence"),
        "range_ids": _ids(requested.get("range_ids", []), "Coefficient ranges"),
    }
    profiles = [_profile(workspace, key) for key in ids]
    records = {}
    ranges = []
    for key in chosen["evidence_ids"]:
        record = evidence.inspect_evidence(workspace, key)
        if record["profile_id"] not in ids:
            raise ValueError("Selected coefficient evidence belongs to another run profile")
        records[key] = record
    for key in chosen["range_ids"]:
        record = evidence.inspect_ranges(workspace, key)
        if not _matches(record, ids):
            raise ValueError("Selected coefficient range has no profile in this report's actual runs")
        ranges.append(record)
        original = evidence.inspect_evidence(workspace, record["evidence_id"])
        records[original["id"]] = original
    body = {
        "schema": VERSION, "workspace_id": workspace.project["id"],
        "selection": chosen, "profiles": profiles,
        "evidence": [
            {**_evidence_choice(record), "record_sha256": digest(record),
             "selected_directly": key in chosen["evidence_ids"],
             "range_ids": sorted(row["id"] for row in ranges if row["evidence_id"] == key)}
            for key, record in sorted(records.items())
        ],
        "ranges": [
            {**_range_choice(record, ids), "record_sha256": digest(record)}
            for record in sorted(ranges, key=lambda row: row["id"])
        ],
        "implementation": {name: file_digest(path)
                           for name, path in sorted(_implementation().items())},
        "methods": METHODS,
    }
    return {**body, "sha256": digest(body)}


def _checked_binding(workspace, binding):
    if not isinstance(binding, dict) or binding.get("schema") != VERSION:
        raise ValueError("Retain the selected coefficient report binding")
    body = {name: value for name, value in binding.items() if name != "sha256"}
    if digest(body) != binding.get("sha256") or binding["workspace_id"] != workspace.project["id"]:
        raise ValueError("Coefficient report binding differs from this original project")
    selected = {"coefficient_evidence": binding["selection"]}
    current = bind(workspace, selected, [row["id"] for row in binding["profiles"]])
    if canonical(current) != canonical(binding):
        raise ValueError("Selected coefficient source, profile or report implementation changed")
    return binding


def _retain_bytes(directory, relative, content, *, title):
    target = directory / relative
    if target.exists():
        if target.read_bytes() != content:
            raise ValueError("Retained coefficient member differs: " + relative)
    else:
        atomic_bytes(target, content, immutable=True)
    return describe_file(directory, target, title=title)


def _source(workspace, directory, collection_id, source_id):
    path, entry = workspace.source_file(collection_id, source_id)
    original = entry["body"]
    content = Path(path).read_bytes()
    if len(content) != original["bytes"] or file_digest(path) != original["sha256"]:
        raise ValueError("Original coefficient source body differs")
    relative = PREFIX + "/sources/" + original["sha256"] + ".csv"
    copied = _retain_bytes(directory, relative, content, title=entry["title"])
    if copied["sha256"] != original["sha256"] or copied["bytes"] != original["bytes"]:
        raise ValueError("Copied coefficient source differs from its original bytes")
    return copied


def _saved_record(workspace, directory, kind, key):
    original = workspace.root / kind / (identifier(key) + ".json")
    # Reading through the ordinary immutable registry checks its saved identity.
    workspace._get(kind, key)
    return _retain_bytes(directory, PREFIX + "/records/" + kind + "/" + key + ".json",
                         original.read_bytes(), title="Original " + kind + " record")


def _citations(record):
    observed, result = set(), []
    for cell in record["cells"]:
        source = cell.get("source")
        if not source:
            continue
        token = canonical(source)
        if token in observed:
            continue
        observed.add(token)
        result.append(copy.deepcopy(source))
    return result


def _display(value):
    if value is None or value == "":
        return "Not recorded"
    if isinstance(value, bool):
        return "Yes" if value else "No"
    if isinstance(value, (int, float)):
        return format(value, ".8g")
    return str(value)


def _span(values):
    values = sorted(set(values))
    if not values:
        return "Not recorded"
    if len(values) == 1:
        return _display(values[0])
    return _display(values[0]) + " to " + _display(values[-1]) + " across selected cells"


def _range_rows(record, match):
    result = []
    for parameter in sorted({cell["parameter"] for cell in record["selected_cells"]}):
        cells = [cell for cell in record["selected_cells"] if cell["parameter"] == parameter]
        positions = match["positions"]
        # Equal endpoint and central profiles can match more than one position.
        # Report that equality rather than selecting an unrecorded experiment role.
        values = [cell["value"] if "central" in positions else cell["range"][positions[0]]
                  for cell in cells]
        result.append([
            parameter.replace("_", " "), str(len(cells)),
            ", ".join(positions), _span(values), cells[0]["units"],
        ])
    return result


def _csv_text(binding, records, ranges):
    buffer = io.StringIO(newline="")
    columns = ["evidence_id", "profile_id", "lucode", "parameter", "value", "units",
               "load_type", "source_status", "source_title", "source_uri", "source_locator",
               "source_period", "notes", "lower", "upper", "range_basis",
               "selected_range_ids"]
    writer = csv.DictWriter(buffer, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for record in records:
        selected = {}
        for group in ranges:
            if group["evidence_id"] == record["id"]:
                for cell in group["selected_cells"]:
                    selected.setdefault((cell["lucode"], cell["parameter"]), []).append(group["id"])
        for cell in record["cells"]:
            source, interval = cell.get("source") or {}, cell.get("range") or {}
            writer.writerow({
                "evidence_id": record["id"], "profile_id": record["profile_id"],
                "lucode": cell["lucode"], "parameter": cell["parameter"],
                "value": cell["table_value_text"], "units": cell["units"],
                "load_type": cell.get("load_type") or "", "source_status": cell["source_status"],
                "source_title": source.get("title") or "", "source_uri": source.get("uri") or "",
                "source_locator": source.get("locator") or "", "source_period": source.get("period") or "",
                "notes": source.get("notes") or "", "lower": interval.get("lower_text") or "",
                "upper": interval.get("upper_text") or "", "range_basis": interval.get("basis") or "",
                "selected_range_ids": ";".join(sorted(selected.get((cell["lucode"], cell["parameter"]), []))),
            })
    return buffer.getvalue()


def collect(workspace, directory, state, binding):
    """Retain exact originals and report inputs in the ordinary delivery inventory."""
    binding = _checked_binding(workspace, binding)
    directory = Path(directory)
    files = state.setdefault("files", {})
    retained = {}

    def add(key, descriptor):
        if key in files and any(files[key].get(field) != descriptor[field]
                                for field in ("path", "bytes", "sha256")):
            raise ValueError("Original coefficient inventory member changed: " + key)
        files[key] = descriptor
        retained[key] = descriptor
        verify_file(directory, descriptor)
        return descriptor["path"]

    profiles = []
    for profile in binding["profiles"]:
        table = profile["table"]
        table_path = add("coefficient_table_" + table["sha256"],
                         _source(workspace, directory, table["source_collection_id"], table["source_id"]))
        record_path = add("coefficient_profile_" + profile["id"],
                          _saved_record(workspace, directory, "profiles", profile["id"]))
        profiles.append({**copy.deepcopy(profile), "table_path": table_path, "record_path": record_path})
    records, evidence_rows = [], []
    for selected in binding["evidence"]:
        record = evidence.inspect_evidence(workspace, selected["id"])
        source = record["source"]
        source_path = add("coefficient_source_" + source["sha256"],
                          _source(workspace, directory, source["source_collection_id"], source["source_id"]))
        record_path = add("coefficient_evidence_" + record["id"],
                          _saved_record(workspace, directory, evidence.EVIDENCE_KIND, record["id"]))
        central_table = record["table"]
        central_table_path = add("coefficient_table_" + central_table["sha256"],
                                 _source(workspace, directory, central_table["source_collection_id"],
                                         central_table["source_id"]))
        central_profile_path = add("coefficient_profile_" + record["profile_id"],
                                   _saved_record(workspace, directory, "profiles", record["profile_id"]))
        records.append(record)
        evidence_rows.append({
            **copy.deepcopy(selected), "source_path": source_path, "record_path": record_path,
            "profile_title": record["profile_title"], "citations": _citations(record),
            "central_table_path": central_table_path, "central_profile_path": central_profile_path,
        })
    ranges, range_rows = [], []
    for selected in binding["ranges"]:
        record = evidence.inspect_ranges(workspace, selected["id"])
        record_path = add("coefficient_range_" + record["id"],
                          _saved_record(workspace, directory, evidence.RANGES_KIND, record["id"]))
        ranges.append(record)
        range_rows.append({**copy.deepcopy(selected), "record_path": record_path,
                           "summaries": [
                               {"profile_id": match["profile_id"], "positions": match["positions"],
                                "rows": _range_rows(record, match)}
                               for match in selected["matched_profiles"]]})
    for name, path in sorted(_implementation().items()):
        original = path.read_bytes()
        if hashlib.sha256(original).hexdigest() != binding["implementation"][name]:
            raise ValueError("Selected coefficient report implementation changed during retention: " + name)
        add("coefficient_implementation_" + name,
            _retain_bytes(directory, PREFIX + "/implementation/" + name + ".py",
                          original, title="Report source / " + name))
    csv_path = PREFIX + "/selected-coefficient-evidence.csv"
    add("coefficient_evidence_csv",
        _retain_bytes(directory, csv_path, _csv_text(binding, records, ranges).encode("utf-8"),
                      title="Complete selected coefficient evidence and range cells"))
    product = {
        "schema": VERSION, "binding": binding, "profiles": profiles,
        "evidence": evidence_rows, "ranges": range_rows, "csv_path": csv_path,
        "methods": METHODS,
    }
    manifest_path = PREFIX + "/coefficient-evidence.json"
    atomic_json(directory / manifest_path, product, immutable=True)
    add("coefficient_evidence_manifest",
        describe_file(directory, directory / manifest_path, title="Selected coefficient source inventory"))
    product["manifest_path"] = manifest_path
    product["files"] = copy.deepcopy(retained)
    state["coefficient_evidence"] = {"binding": binding, "manifest": retained["coefficient_evidence_manifest"]}
    return product


def _limited(rows, maximum=MAX_ROWS):
    return rows[:maximum], len(rows) - min(len(rows), maximum)


def scientific_sections(product):
    """Use the established scientific table/link blocks, without coefficient dumps."""
    from .scientific_report import _table, link
    if product is None:
        return []
    blocks = [
        METHODS["selection"], METHODS["coverage"], METHODS["load_basis"],
    ]
    profile_rows = [
        [row["title"], ", ".join(name.upper() for name in row["models"]),
         row["table"]["title"], row["table"]["vintage"], row["table"]["sha256"]]
        for row in product["profiles"]
    ]
    blocks.append(_table(["Run profile", "Models", "Original table", "Vintage", "Original SHA256"],
                         profile_rows, widths=[1.3, .55, 1.3, .8, 2.3]))
    rows = []
    for row in product["evidence"]:
        coverage = row["coverage"]
        context = "Direct profile evidence" if row["selected_directly"] else "Central evidence for selected range"
        rows.append([row["profile_title"], context, row["source"]["title"],
                     str(coverage["documented"]) + " / " + str(coverage["total"]),
                     str(coverage["documented_load_cells"]) + " / " + str(coverage["load_cells"]),
                     str(coverage["ranged"])])
    shown, remaining = _limited(rows)
    if shown:
        blocks.extend([METHODS["multiple"], _table(
            ["Original profile", "Selection", "Evidence edition", "Documented cells",
             "Documented load cells", "Ranged cells"],
            shown, widths=[1.1, 1.1, 1.5, .8, .8, .65])])
        if remaining:
            blocks.append(str(remaining) + " additional explicitly selected evidence editions are retained in the linked complete inventory.")
    else:
        blocks.append("The original input table is retained. No coefficient evidence or range edition was selected for this report; citation coverage remains unassessed here.")
    for row in product["ranges"]:
        blocks.extend(["Selected range: " + row["title"], row["reason"], METHODS["ranges"]])
        for summary in row["summaries"]:
            title = next(item["title"] for item in product["profiles"] if item["id"] == summary["profile_id"])
            blocks.append("Actual report profile: " + title + ". Matches the saved "
                          + ", ".join(summary["positions"]) + " coefficient profile.")
            blocks.append(_table(["Parameter", "Selected cells", "Matching profile", "Actual input values", "Units"],
                                 summary["rows"], widths=[1.2, .65, 1.0, 2.2, 1.2],
                                 caption=("Selected range: " + row["title"] + ". Actual report profile: " + title
                                          + " (" + ", ".join(summary["positions"]) + "). "
                                          "Value spans describe differences among selected land-cover cells. "
                                          "Full original cell values and sourced endpoints are in the companion CSV.")))
    citations, seen = [], set()
    for row in product["evidence"]:
        for source in row["citations"]:
            token = canonical(source)
            if token in seen:
                continue
            seen.add(token)
            citations.append([source.get("title") or "", source.get("uri") or "",
                              source.get("locator") or "", source.get("period") or ""])
    shown, remaining = _limited(citations)
    if shown:
        blocks.append(_table(["Coefficient source", "Citation", "Locator", "Source period"], shown,
                             widths=[1.6, 2.6, 1.4, .7]))
        if remaining:
            blocks.append(str(remaining) + " additional distinct citations are retained in the complete evidence CSV and source records.")
    links = [("Complete evidence and selected-range cells", product["csv_path"]),
             ("Complete selected source inventory", product["manifest_path"])]
    links.extend(("Original table / " + row["title"], row["table_path"]) for row in product["profiles"])
    links.extend(("Original evidence CSV / " + row["source"]["title"], row["source_path"])
                 for row in product["evidence"])
    selected_profiles = {row["id"] for row in product["profiles"]}
    links.extend(("Original central table / " + row["profile_title"], row["central_table_path"])
                 for row in product["evidence"] if row["profile_id"] not in selected_profiles)
    for title, path in dict.fromkeys(links):
        blocks.append(link(title, path))
    return [(TITLE, blocks)]


def client_sections(product):
    """Equivalent concise content in the established client report schema."""
    if product is None:
        return []
    blocks = scientific_sections(product)[0][1]
    section = {"id": "coefficient-evidence", "title": TITLE,
               "paragraphs": [], "tables": [], "assets": [], "figures": []}
    for block in blocks:
        if isinstance(block, str):
            section["paragraphs"].append(block)
        elif block.get("kind") == "table":
            section["tables"].append({
                "columns": block["columns"], "rows": block["rows"],
                "caption": block.get("caption"),
            })
        elif block.get("kind") == "link":
            section["assets"].append({"title": block["label"], "path": block["href"]})
        else:
            raise ValueError("Unsupported coefficient report block")
    return [section]
