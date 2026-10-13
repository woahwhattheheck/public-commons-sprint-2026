"""Original-source periods for the existing Reach chemistry engine.

CWMS interval means are selected explicitly as intervals ending at their
timestamp. Original nulls, signed computed values and quality codes remain
unchanged; aggregation is a documented modeling choice, never a repair.
"""
from __future__ import annotations
from copy import deepcopy
from datetime import datetime, timezone
import csv
import html
import io
import math
import re

from .common import atomic_bytes, canonical, describe_file, digest, identifier, read_json, verify_file
from .reach_chemistry.model import ModelError
from .chemistry import Chemistry

KIND = "receiving-water-chemistry-preparations"
FOLDER = "receiving-water-chemistry"
SCHEMA = "upstate.receiving-water-chemistry-selection/v1"
ACTIONS = {"chemistry.water.preview", "chemistry.water.prepare", "chemistry.water.get"}


def _fail(message):
    raise ModelError(message)


def _time(value, name):
    if not isinstance(value, str) or not value.strip():
        _fail(name + ": select an explicit ISO timestamp with UTC offset")
    try:
        result = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        _fail(name + ": invalid ISO timestamp")
    if result.tzinfo is None:
        _fail(name + ": timezone is required")
    milliseconds = result.timestamp() * 1000
    if not math.isfinite(milliseconds) or milliseconds != round(milliseconds):
        _fail(name + ": timestamps must resolve to complete milliseconds")
    return round(milliseconds)


def _iso(milliseconds):
    return datetime.fromtimestamp(milliseconds / 1000, timezone.utc).isoformat().replace("+00:00", "Z")


def _finite(value, name, *, positive=False):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        _fail(name + ": expected a finite number")
    if positive and value <= 0:
        _fail(name + ": expected a positive number")
    return float(value)


def _int(value, name, low=1):
    if isinstance(value, bool) or not isinstance(value, int) or value < low:
        _fail(name + ": expected an integer >= " + str(low))
    return value



def source_preview(workspace, choice):
    path, entry = workspace.source_file(choice["source_collection_id"], choice["source_id"])
    text = path.read_text(encoding="utf-8-sig")
    metadata = {"source_collection_id": choice["source_collection_id"], "source_id": choice["source_id"],
                "sha256": entry["body"]["sha256"], "bytes": entry["body"]["bytes"],
                "title": entry.get("title"), "uri": entry.get("uri")}
    if text.lstrip().startswith("{"):
        value = read_json(path)
        if not isinstance(value, dict) or "value-columns" not in value or "values" not in value:
            _fail("Choose a CWMS JSON response or an original delimited text file")
        return {**metadata, "format": "cwms-json", "name": value.get("name"),
            "office": value.get("office-id"), "units": value.get("units"), "interval": value.get("interval"),
            "rows": len(value["values"]), "total": value.get("total"), "columns": value["value-columns"],
            "sample": value["values"][:12], "quality_codes": sorted(set(row[2] for row in value["values"])),
            "begin": value.get("begin"), "end": value.get("end")}
    delimiter = choice.get("delimiter", ",")
    if delimiter not in {",", ";", "\t", "|"}:
        _fail("Select comma, semicolon, tab or pipe as the original delimiter")
    reader = csv.reader(io.StringIO(text, newline=""), delimiter=delimiter)
    rows = list(reader)
    if not rows or not rows[0] or len(set(rows[0])) != len(rows[0]) or any(not x for x in rows[0]):
        _fail("Original delimited file needs unique nonempty column names")
    if len(rows) > 1000001:
        _fail("Select an original source file with at most 1000000 rows")
    if any(len(row) != len(rows[0]) for row in rows[1:] if any(row)):
        _fail("Original delimited rows do not all match their header width")
    return {**metadata, "format": "csv", "delimiter": delimiter, "columns": rows[0],
            "rows": sum(any(row) for row in rows[1:]), "sample": rows[1:13]}


def _csv_rows(path, binding):
    delimiter = binding.get("delimiter", ",")
    if delimiter not in {",", ";", "\t", "|"}:
        _fail("Choose an explicit supported CSV delimiter")
    columns = binding.get("columns", {})
    if not isinstance(columns, dict) or not columns.get("timestamp") or not columns.get("value"):
        _fail("Map the original timestamp and value columns")
    with path.open("r", encoding="utf-8-sig", newline="") as handle:
        reader = csv.DictReader(handle, delimiter=delimiter)
        if not reader.fieldnames or any(not name for name in reader.fieldnames) or len(set(reader.fieldnames)) != len(reader.fieldnames):
            _fail("Original CSV header must have unique names")
        for field in ("timestamp", "value", "quality"):
            if columns.get(field) and columns[field] not in reader.fieldnames:
                _fail("Mapped original column is absent: " + columns[field])
        missing = binding.get("missing_tokens")
        if not isinstance(missing, list) or any(not isinstance(x, str) for x in missing):
            _fail("Choose the original missing-value tokens explicitly")
        fmt = binding.get("timestamp_format")
        if fmt not in {"iso8601", "unix-ms", "unix-seconds"}:
            _fail("Choose ISO8601, Unix milliseconds or Unix seconds for the original timestamp")
        if binding.get("quality_type") not in {"integer", "text"}:
            _fail("Choose integer or text for the original quality field")
        result = []
        for number, row in enumerate(reader, 2):
            if None in row or any(v is None for v in row.values()):
                _fail("Original CSV width differs at row " + str(number))
            raw_time = row[columns["timestamp"]]
            try:
                if fmt == "iso8601":
                    time = datetime.fromisoformat(raw_time.replace("Z", "+00:00"))
                    if time.tzinfo is None:
                        offset = binding.get("timezone_offset")
                        if not isinstance(offset, str) or not re.fullmatch(r"[+-](?:0[0-9]|1[0-4]):[0-5][0-9]", offset):
                            _fail("Naive CSV timestamps require an explicit fixed UTC offset")
                        time = time.replace(tzinfo=datetime.fromisoformat("2000-01-01T00:00:00" + offset).tzinfo)
                    stamp = time.timestamp() * 1000
                else:
                    stamp = float(raw_time) * (1000 if fmt == "unix-seconds" else 1)
                if not math.isfinite(stamp) or stamp != round(stamp):
                    _fail("CSV timestamps must resolve to complete milliseconds")
                raw_value = row[columns["value"]]
                value = None if raw_value in missing else float(raw_value)
                if value is not None and not math.isfinite(value):
                    _fail("CSV numeric value is not finite")
                if columns.get("quality"):
                    raw_quality = row[columns["quality"]]
                    quality = int(raw_quality) if binding.get("quality_type") == "integer" else raw_quality
                else:
                    quality = binding.get("unflagged_quality_code")
                    if quality is None:
                        _fail("A file without a quality column needs an explicit unflagged code")
            except (ValueError, OverflowError) as exc:
                _fail("Original CSV row " + str(number) + ": " + str(exc))
            result.append([int(stamp), value, quality])
            if len(result) > 1000000:
                _fail("Select at most 1000000 original CSV rows")
    if not result:
        _fail("Selected original CSV contains no observations")
    return result


def _series(workspace, binding, *, storage=False):
    if not isinstance(binding, dict):
        _fail("Each source binding must be an object")
    selected = binding.get("sources")
    if not isinstance(selected, list) or not selected:
        _fail("Select one or more retained original CWMS source files")
    expected_name = binding.get("name")
    if not isinstance(expected_name, str) or not expected_name.strip():
        _fail("Select the exact original CWMS series name")
    office = binding.get("office")
    if not isinstance(office, str) or not office.strip():
        _fail("Select the exact original CWMS office")
    expected_unit = binding.get("units")
    factors = {"m3": 1, "ac-ft": 1233.48183754752, "acre-ft": 1233.48183754752} if storage else {"cms": 1, "m3/s": 1, "cfs": 0.028316846592, "m3/day": 1 / 86400}
    if expected_unit not in factors:
        _fail("Select the actual original units from " + ", ".join(factors))
    factor = factors[expected_unit]
    codes = binding.get("quality_codes")
    if not isinstance(codes, list) or not codes or any(isinstance(x, bool) or not isinstance(x, (int, str)) for x in codes) or len(set(codes)) != len(codes):
        _fail("Choose explicit distinct integer or text quality codes; no implicit interpretation is applied")
    seconds = _int(binding.get("interval_seconds"), "interval_seconds")
    if not storage and binding.get("value_support") != "interval-ending":
        _fail("Flow source support must explicitly be interval-ending")
    if storage and binding.get("value_support") != "instantaneous":
        _fail("Storage source support must explicitly be instantaneous")
    step = seconds * 1000
    data, originals = {}, []
    keys = set()
    for choice in selected:
        if not isinstance(choice, dict):
            _fail("Source selection must carry collection and source IDs")
        key = (identifier(choice.get("source_collection_id")), choice.get("source_id"))
        if not isinstance(key[1], str) or not key[1]:
            _fail("Source ID is required")
        if key in keys:
            _fail("A source file was selected twice")
        keys.add(key)
        path, entry = workspace.source_file(*key)
        if binding.get("format", "cwms-json") == "csv":
            rows = _csv_rows(path, binding)
        elif binding.get("format", "cwms-json") == "cwms-json":
            raw = read_json(path)
            if not isinstance(raw, dict) or raw.get("name") != expected_name or raw.get("office-id") != office or raw.get("units") != expected_unit:
                _fail("Source identity, office or units differ from the explicit binding: " + key[1])
            if raw.get("next-page"):
                _fail("The original CWMS response has another page; retain the complete selected response")
            rows = raw.get("values")
            if not isinstance(rows, list) or not rows or raw.get("total") != len(rows):
                _fail("Original CWMS response must contain its full reported values array")
            expected_interval = "PT" + str(seconds // 3600) + "H" if seconds % 3600 == 0 else "PT" + str(seconds) + "S"
            # CWMS also serializes full-day intervals as PT24H.
            if raw.get("interval") not in {expected_interval, "P1D" if seconds == 86400 else expected_interval}:
                _fail("Original CWMS interval differs from interval_seconds")
            columns = raw.get("value-columns", [])
            if [(x.get("name"), x.get("ordinal")) for x in columns[:3]] != [("date-time", 1), ("value", 2), ("quality-code", 3)]:
                _fail("Use the original CWMS timestamp/value/quality column layout")
        else:
            _fail("Choose original CWMS JSON or CSV source mapping")
        prior = None
        for row in rows:
            if not isinstance(row, list) or len(row) < 3:
                _fail("Malformed original CWMS value row")
            stamp, value, quality = row[:3]
            if isinstance(stamp, bool) or not isinstance(stamp, int) or isinstance(quality, bool) or not isinstance(quality, (int, str)):
                _fail("Original timestamp must be integer milliseconds and quality code must retain its selected type")
            if prior is not None and stamp <= prior:
                _fail("Original CWMS rows must have strictly increasing timestamps")
            prior = stamp
            if value is not None:
                _finite(value, "original CWMS value")
            complete = deepcopy(row)
            if stamp in data and data[stamp] != complete:
                _fail("Overlapping original source files disagree at " + _iso(stamp))
            data[stamp] = complete
        originals.append({
            "source_collection_id": key[0], "source_id": key[1], "name": expected_name,
            "office": office, "units": expected_unit, "uri": entry.get("uri"),
            "vintage": entry.get("vintage"), "sha256": entry["body"]["sha256"],
            "bytes": entry["body"]["bytes"], "values": len(rows),
            "first": _iso(rows[0][0]), "last": _iso(rows[-1][0]),
        })
    return {"binding": deepcopy(binding), "rows": data, "step": step,
            "quality_codes": set(codes), "originals": originals, "factor": factor, "original_units": expected_unit}


def _flow_period(series, start, end):
    step = series["step"]
    count, remainder = divmod(end - start, step)
    if remainder or count <= 0:
        _fail("Every selected period must contain whole original flow intervals")
    selected = [series["rows"].get(t) for t in range(start + step, end + 1, step)]
    missing = [start + (i + 1) * step for i, row in enumerate(selected) if row is None or row[1] is None]
    rejected = [row[0] for row in selected if row is not None and row[1] is not None and row[2] not in series["quality_codes"]]
    values = [row[1] for row in selected if row is not None and row[1] is not None]
    histogram = {}
    for row in selected:
        if row is not None:
            histogram[str(row[2])] = histogram.get(str(row[2]), 0) + 1
    original_mean = math.fsum(values) / count if not missing and not rejected else None
    mean = original_mean * series["factor"] if original_mean is not None else None
    return {
        "expected_values": count, "present_values": len(values),
        "missing_count": len(missing), "missing_first": [_iso(x) for x in missing[:12]],
        "rejected_quality_count": len(rejected), "rejected_quality_first": [_iso(x) for x in rejected[:12]],
        "quality_codes": histogram,
        "negative_original_values": sum(x < 0 for x in values),
        "original_units": series["original_units"], "original_mean": original_mean,
        "minimum_original_value": min(values) if values else None,
        "maximum_original_value": max(values) if values else None,
        "mean_cms": mean, "m3_day": mean * 86400 if mean is not None else None,
        "volume_m3": mean * (end - start) / 1000 if mean is not None else None,
        "state": "ready" if mean is not None and mean >= 0 else "needs-selection",
    }


def _storage_value(series, stamp, *, required=False):
    row = series["rows"].get(stamp)
    state = "missing" if row is None or row[1] is None else ("quality-excluded" if row[2] not in series["quality_codes"] else "retained")
    if state == "retained" and row[1] <= 0:
        state = "nonpositive"
    if required and state != "retained":
        _fail("Initial storage needs an exact positive original observation at " + _iso(stamp) + " (" + state + ")")
    return {"timestamp": _iso(stamp), "state": state,
            "volume_m3": row[1] * series["factor"] if row is not None and row[1] is not None else None,
            "original_value": row[1] if row is not None else None, "original_units": series["original_units"],
            "quality_code": row[2] if row is not None else None}


def preview(workspace, selection):
    if not isinstance(selection, dict) or selection.get("schema") != SCHEMA:
        _fail("Select a complete receiving-water source-period input")
    selection = deepcopy(selection)
    title, reason = selection.get("title"), selection.get("reason")
    if not isinstance(title, str) or not title.strip() or not isinstance(reason, str) or not reason.strip():
        _fail("Give the case a title and explain the source-period/physical selection")
    if selection.get("template_period_policy") != "repeat-single-phase":
        _fail("Explicitly select repeat-single-phase for the unchanged chemical template")
    if selection.get("signed_value_policy") != "mean-preserve-signed-originals":
        _fail("Explicitly select arithmetic interval means preserving signed original values")
    manager = Chemistry(workspace)
    original = manager.get_case(selection.get("template_case_id"))
    template = deepcopy(original["project"])
    if len(template.get("phases", [])) != 1:
        _fail("Select a one-phase chemical template; multi-phase chemical changes need a separately selected aligned template")
    start, end = _time(selection.get("begin"), "begin"), _time(selection.get("end"), "end")
    hours = _int(selection.get("period_hours"), "period_hours")
    period = hours * 3600000
    if end <= start or (end - start) % period:
        _fail("End must follow begin by an exact multiple of period_hours")
    if (end - start) // period > 10000:
        _fail("Select at most 10000 explicitly supported periods")
    flow_bindings = selection.get("flow_bindings")
    storage_bindings = selection.get("storage_bindings")
    if not isinstance(flow_bindings, list) or not flow_bindings or not isinstance(storage_bindings, list) or not storage_bindings:
        _fail("Select original flow and initial-storage bindings")
    flows = {x["id"]: x for x in template.get("flows", [])}
    reaches = {x["id"]: x for x in template["reaches"]}
    flow_series, storage_series = {}, {}
    for binding in flow_bindings:
        key = binding.get("flow_id")
        if key not in flows or key in flow_series:
            _fail("Select each original flow ID at most once")
        flow_series[key] = _series(workspace, binding)
    for binding in storage_bindings:
        key = binding.get("reach_id")
        if key not in reaches or key in storage_series:
            _fail("Select each original reach ID at most once")
        storage_series[key] = _series(workspace, binding, storage=True)
    originals = [row for series in [*flow_series.values(), *storage_series.values()] for row in series["originals"]]
    sources = {(x["source_collection_id"], x["source_id"]): {
        "source_collection_id": x["source_collection_id"], "source_id": x["source_id"]} for x in originals}
    source_refs = manager.source_refs(list(sources.values()))
    project = deepcopy(template)
    project["title"] = title.strip()
    project["hydrology"] = {"mode": "variable-storage"}
    reach_rows = {x["id"]: x for x in project["reaches"]}
    volume = {}
    for reach_id, reach in reach_rows.items():
        if reach_id in storage_series:
            obs = _storage_value(storage_series[reach_id], start, required=True)
            reach["volume_m3"] = obs["volume_m3"]
            reach["provenance"] = {"kind": "retained-original-initial-storage",
                "reference": storage_series[reach_id]["binding"]["name"] + " at " + _iso(start),
                "original_provenance": deepcopy(reach.get("provenance")),
                "source_files": storage_series[reach_id]["originals"], "quality_code": obs["quality_code"]}
        volume[reach_id] = float(reach["volume_m3"])
    original_phase = deepcopy(template["phases"][0])
    original_phase.pop("until_day", None)
    period_rows, phases, errors = [], [], []
    for offset, left in enumerate(range(start, end, period)):
        right = left + period
        support = {key: _flow_period(series, left, right) for key, series in flow_series.items()}
        phase = deepcopy(original_phase)
        phase["until_day"] = (right - start) / 86400000
        phase["flow_multipliers"] = dict(phase.get("flow_multipliers", {}))
        for key, row in support.items():
            if row["state"] != "ready":
                errors.append({"period": offset + 1, "flow_id": key, "begin": _iso(left), "end": _iso(right),
                    "reason": "missing/quality-excluded interval or negative aggregated flow", "support": row})
            phase["flow_multipliers"][key] = row["m3_day"] if row["state"] == "ready" else 0
        phase["provenance"] = {"kind": "retained-source-period", "reference": _iso(left) + " / " + _iso(right)}
        # Bound source flows use1m3/day so phase multipliers retain their exact derived rate.
        flow_amounts = {}
        for key, original_flow in flows.items():
            flow_amounts[key] = (1 if key in flow_series else original_flow["m3_day"]) * phase["flow_multipliers"].get(key, 1)
        budget = []
        for reach_id in reaches:
            inflow = math.fsum(flow_amounts[k] for k, f in flows.items() if f.get("target") == reach_id)
            outflow = math.fsum(flow_amounts[k] for k, f in flows.items() if f.get("source") == reach_id)
            before = volume[reach_id]
            change = (inflow - outflow) * period / 86400000
            after = before + change
            observation = _storage_value(storage_series[reach_id], right) if reach_id in storage_series else None
            budget.append({"reach": reach_id, "initial_volume_m3": before, "inflow_m3_day": inflow,
                "outflow_m3_day": outflow, "change_m3": change, "predicted_volume_m3": after,
                "observed_storage": observation,
                "observed_minus_predicted_m3": observation["volume_m3"] - after if observation and observation["state"] == "retained" else None})
            if after <= 0:
                errors.append({"period": offset + 1, "reach": reach_id, "reason": "flow-derived storage is nonpositive"})
            volume[reach_id] = after
        period_rows.append({"period": offset + 1, "begin": _iso(left), "end": _iso(right),
                            "duration_days": period / 86400000, "flows": support, "storage": budget})
        phases.append(phase)
    for flow in project.get("flows", []):
        if flow["id"] in flow_series:
            flow["m3_day"] = 1
            flow["provenance"] = {"kind": "retained-original-period-means",
                "reference": flow_series[flow["id"]]["binding"]["name"],
                "original_provenance": deepcopy(flow.get("provenance")),
                "source_files": flow_series[flow["id"]]["originals"]}
    project["phases"] = phases
    support = {"schema": "upstate.receiving-water-source-support/v1", "selection": selection,
        "template_case_id": original["id"], "template_project_sha256": original["project_sha256"],
        "source_refs": source_refs, "originals": originals, "periods": period_rows,
        "decisions": {
            "flow_units": "Original declared cms/m3s/cfs/m3day retained; explicit unit factors convert to m3/day",
            "interval_support": "Values represent the explicitly selected interval ending at each original timestamp",
            "aggregation": "Arithmetic mean of every equal-duration original interval; signed values retained",
            "missing_values": "No filling, interpolation or removal of an incomplete period",
            "storage": "Only exact initial observations set initial volume; subsequent observations are comparisons",
            "chemistry": "Original selected single-phase species, boundary concentrations, loads, reactions and initial chemical mass retained",
            "annual_loads": "No implicit conversion of annual NDR/SDR stream loads into daily loads or concentrations",
        }}
    project["source_period_support"] = support
    return {"schema": "upstate.receiving-water-chemistry-preview/v1",
        "selection_sha256": digest(selection), "state": "ready" if not errors else "needs-selection",
        "errors": errors, "project": project, "support": support,
        "source_refs": manager.source_refs([*original["source_refs"], *source_refs])}


def _csv(rows):
    stream = io.StringIO(newline="")
    writer = csv.writer(stream)
    keys = ["period", "begin", "end", "reach", "initial_volume_m3", "inflow_m3_day",
            "outflow_m3_day", "change_m3", "predicted_volume_m3",
            "observed_storage_m3", "observed_minus_predicted_m3"]
    writer.writerow(keys)
    for period in rows:
        for storage in period["storage"]:
            row = {**period, **storage, "observed_storage_m3": (storage.get("observed_storage") or {}).get("volume_m3")}
            writer.writerow([row.get(k) for k in keys])
    return stream.getvalue().encode("utf-8")


def _report(value):
    esc = lambda x: html.escape(str(x), quote=True)
    rows = []
    for period in value["support"]["periods"]:
        for storage in period["storage"]:
            rows.append("<tr>" + "".join("<td>" + esc(x) + "</td>" for x in (
                period["begin"], period["end"], storage["reach"], storage["predicted_volume_m3"],
                (storage.get("observed_storage") or {}).get("volume_m3"), storage["observed_minus_predicted_m3"])) + "</tr>")
    sources = "".join("<li>" + esc(x["name"]) + " — " + esc(x["source_id"]) + " — " + esc(x["sha256"]) + "</li>" for x in value["support"]["originals"])
    decisions = "".join("<dt>" + esc(k.replace("_", " ")) + "</dt><dd>" + esc(v) + "</dd>" for k, v in value["support"]["decisions"].items())
    return ('<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        '<title>' + esc(value["title"]) + '</title><style>body{font:16px system-ui;margin:2rem auto;padding:0 1rem;max-width:1100px;color:#202124;background:#fff}'
        'h1{font-size:1.7rem}table{border-collapse:collapse;font-variant-numeric:tabular-nums}td,th{padding:.6rem;border:1px solid #bbb;text-align:left}'
        '.scroll{overflow:auto}dt{font-weight:600;margin-top:1rem}dd{margin:.25rem 0}li{overflow-wrap:anywhere;margin:.5rem 0}a{color:#222}</style>'
        '<h1>' + esc(value["title"]) + '</h1><p>' + esc(value["reason"]) + '</p>'
        '<p>Original chemical case ' + esc(value["case_id"]) + '. Source-period selection ' + esc(value["selection_sha256"]) + '.</p>'
        '<p><a href="preparation.json">Complete preparation JSON</a> · <a href="period-storage.csv">Period storage CSV</a></p>'
        '<h2>Flow-derived storage and retained observations</h2><p>Observed storage is compared with the continuous simulation trajectory; it never resets the model between periods.</p>'
        '<div class="scroll"><table><thead><tr><th>Begin UTC</th><th>End UTC</th><th>Reach</th><th>Predicted m³</th><th>Observed m³</th><th>Observed − predicted m³</th></tr></thead><tbody>' + "".join(rows) + '</tbody></table></div>'
        '<h2>Explicit modeling selections</h2><dl>' + decisions + '</dl><h2>Complete original sources</h2><ul>' + sources + '</ul></html>').encode("utf-8")


def prepare(workspace, selection):
    value = preview(workspace, selection)
    if value["state"] != "ready":
        _fail("Source-period selection needs correction: " + str(value["errors"][:3]))
    case = Chemistry(workspace).save_case({"project": value["project"], "source_refs": value["source_refs"],
        "parent_id": selection["template_case_id"], "reason": selection["reason"]})
    record = workspace._save(KIND, {"title": selection["title"], "reason": selection["reason"],
        "selection": deepcopy(selection), "selection_sha256": value["selection_sha256"],
        "case_id": case["id"], "project_sha256": case["project_sha256"], "support": value["support"]})
    directory = workspace.root / FOLDER / record["id"]
    directory.mkdir(parents=True, exist_ok=True)
    outputs = {"preparation.json": canonical(record), "period-storage.csv": _csv(record["support"]["periods"]),
               "report.html": _report(record)}
    for name, body in outputs.items():
        atomic_bytes(directory / name, body, immutable=True)
    return get(workspace, record["id"])


def get(workspace, key):
    record = workspace._get(KIND, identifier(key))
    if digest(record["selection"]) != record["selection_sha256"]:
        _fail("Retained source-period selection changed")
    case = Chemistry(workspace).get_case(record["case_id"])
    if case["project_sha256"] != record["project_sha256"] or case["project"].get("source_period_support") != record["support"]:
        _fail("Retained chemical case differs from its original source-period selection")
    directory = workspace.root / FOLDER / record["id"]
    expected = {"preparation.json": canonical(record), "period-storage.csv": _csv(record["support"]["periods"]), "report.html": _report(record)}
    artifacts = []
    for name, body in expected.items():
        path = directory / name
        if path.read_bytes() != body:
            _fail("Retained source-period output changed: " + name)
        artifacts.append(describe_file(workspace.root, path, name=name))
    return {**record, "artifacts": artifacts}


def catalog(workspace):
    return [{k: row[k] for k in ("id", "title", "case_id", "project_sha256", "selection_sha256")}
            for row in workspace._list(KIND)]


def verify_all(workspace):
    return {"prepared": [get(workspace, row["id"])["id"] for row in workspace._list(KIND)]}
