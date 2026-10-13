"""Explicit canonical Measurements source handoff to native context observations.

The existing SQLite source is captured consistently by its maintained service.
No model is run, source review is edited, or annual-mass eligibility inferred.
"""
from __future__ import annotations
from collections import Counter
import csv
from hashlib import sha256
import io
import json
import math
from pathlib import Path
from model.common import atomic_bytes, atomic_json, canonical, digest, file_digest, held, identifier, read_json
from model import observations

SCHEMA = "upstate.measurement-native-handoff/v1"
FAMILY = "measurement-native-handoffs"
FIELDS = ("record_id", "station_id", "parameter", "value", "unit", "period_start",
          "period_end", "qualifier", "method", "measurement_support", "quantity_basis",
          "species", "source_quantity", "source_records", "activity", "fraction",
          "method_authority", "depth", "depth_unit", "value_type", "weight_basis",
          "time_basis", "temperature_basis", "particle_size_basis", "project", "time",
          "timezone", "reporting_limit", "reporting_limit_unit", "comment",
          "original_value", "original_unit", "original_source_line", "canonical_record_id",
          "canonical_row_json", "review_json", "source_disposition")


def _text(value):
    return "" if value is None else str(value)


def _number(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        return ""
    return str(value)


def _selection(payload):
    if not isinstance(payload, dict):
        raise ValueError("Choose one complete retained Measurements import")
    title = payload.get("title", "")
    if not isinstance(title, str) or not title.strip() or len(title) > 300:
        raise ValueError("Give this context handoff a title of 1 to 300 characters")
    if payload.get("value_policy") != "retained-canonical-context":
        raise ValueError("Explicitly choose the retained canonical values and source context policy")
    return {"import_id": identifier(payload.get("import_id")), "title": title.strip(),
            "value_policy": "retained-canonical-context"}


def _capture(service, selection, expected_revision=None):
    if expected_revision is not None and (type(expected_revision) is not int or expected_revision < 0):
        raise ValueError("Choose the inspected nonnegative Measurements revision")
    suffix = "" if expected_revision is None else "?expected_revision=" + str(expected_revision)
    snap = service.json("GET", "native-observations/imports/" + selection["import_id"] + suffix)
    if snap.get("schema") != "upstate.measurement-native-source/v1" or snap["source"]["id"] != selection["import_id"]:
        raise ValueError("The measured source capture does not match the selected original")
    raw = snap["source"]["content"].encode("utf-8")
    if sha256(raw).hexdigest() != snap["source"]["sha"]:
        raise ValueError("Original measured source bytes differ from their retained hash")
    if not isinstance(snap.get("rows"), list) or not snap["rows"]:
        raise ValueError("The selected import has no retained property measurements")
    return snap


def _rows(snap):
    result = []
    for item in snap["rows"]:
        c = item["canonical"]
        issues = list(c.get("issues", []))
        disposition = []
        if item.get("review", {}).get("state") == "exclude":
            disposition.append("original review excludes this record")
        if len(item.get("variants", [])) > 1 and item.get("selected_version") != item["record_id"]:
            disposition.append("original source revision is unresolved or not selected")
        # Preserve the original normalization/quality semantics. An explicit include
        # may resolve reviewable status/qualifier flags, never malformed values.
        hard = {"review-detection-condition", "conflicting-censor-directions",
                "ambiguous-or-incompatible-censor-limit", "censor-limit-unresolved",
                "unrecognized-unit", "missing-numeric-result", "quality-control-sample",
                "non-water-or-unspecified-medium", "negative-detection-limit", "negative-concentration",
                "conflicting-characteristic-basis", "conflicting-source-chemical-basis"}
        disposition.extend(v for v in issues if v in hard)
        if item.get("review", {}).get("state") != "include":
            disposition.extend(v for v in issues if v in
                               {"qualified-result", "review-source-status", "unit-from-single-detection-limit", "derived-source-value"})
        censor = c.get("censor")
        qualifier, value, limit = "", "", ""
        if censor == "none":
            value = _number(c.get("value"))
        elif censor == "left":
            qualifier, value = "<", _number(c.get("upper"))
            limit = value
        elif censor == "right":
            qualifier, value = ">", _number(c.get("lower"))
            limit = value
        else:
            disposition.append("unsupported canonical interval retained as context")
        if not value:
            disposition.append("original quantity has no resolved finite point or bound")
        if disposition:
            qualifier = "context-only"
        # A separate original source occurrence remains a separate native row.
        identity = digest([snap["source"]["id"], item["record_id"], item["source_line"]])
        scientific = {k: c.get(k) for k in ("characteristic", "parameter", "basis", "unit",
            "reportedValue", "reportedUnit", "censor", "lower", "upper", "detection",
            "detectionLimits", "detectionInterpretation", "characteristicInterpretation",
            "method", "methodContext", "methodName", "speciation", "resultDepth", "resultDepthUnit",
            "resultDepthReference", "activityDepth", "activityDepthUnit", "activityDepthReference", "relativeDepth",
            "timeBasis", "temperatureBasis", "weightBasis", "particleSizeBasis")}
        depth = {k: c[k] for k in ("resultDepth", "resultDepthUnit", "resultDepthReference",
            "activityDepth", "activityDepthUnit", "activityDepthReference", "relativeDepth") if c.get(k) not in (None, "")}
        row = {"record_id": identity, "station_id": _text(c.get("stationId")),
            "parameter": _text(c.get("characteristic")), "value": value, "unit": _text(c.get("unit")),
            "period_start": _text(c.get("sampledDate")), "period_end": _text(c.get("sampledDate")),
            "qualifier": qualifier, "method": _text(c.get("method")), "measurement_support": "other_context",
            "quantity_basis": "retained canonical property measurement; original unit/value also retained",
            "species": _text(c.get("speciation") or c.get("basis") or c.get("characteristic")),
            "source_quantity": canonical(scientific).decode("utf-8"),
            "source_records": canonical({"import_id": snap["source"]["id"], "import_sha256": snap["source"]["sha"],
                "canonical_record_id": item["record_id"], "original_source_line": item["source_line"],
                "source_result_id": c.get("sourceResultId"), "activity_id": c.get("activityId")}).decode("utf-8"),
            "activity": _text(c.get("activityId") or identity), "fraction": _text(c.get("fraction")),
            "method_authority": _text(c.get("methodContext")), "depth": canonical(depth).decode("utf-8") if depth else "",
            "depth_unit": "", "value_type": _text(c.get("valueType")),
            "weight_basis": _text(c.get("weightBasis")), "time_basis": _text(c.get("timeBasis") or c.get("timePrecision")),
            "temperature_basis": _text(c.get("temperatureBasis")), "particle_size_basis": _text(c.get("particleSizeBasis")),
            "project": snap["source"]["id"], "time": _text(c.get("sourceTime")),
            "timezone": _text(c.get("timeZone")), "reporting_limit": limit,
            "reporting_limit_unit": _text(c.get("unit")) if limit else "", "comment": _text(c.get("comment")),
            "original_value": _text(c.get("reportedValue")), "original_unit": _text(c.get("reportedUnit")),
            "original_source_line": str(item["source_line"]), "canonical_record_id": item["record_id"],
            "canonical_row_json": canonical(c).decode("utf-8"), "review_json": canonical(item.get("review", {})).decode("utf-8"),
            "source_disposition": "; ".join(dict.fromkeys(disposition))}
        row.update({"original:" + key: _text(value) for key, value in c.get("raw", {}).items()})
        result.append(row)
    return result


def _prepare(service, payload):
    selection = _selection(payload)
    snap = _capture(service, selection, payload.get("expected_revision"))
    rows = _rows(snap)
    out = io.StringIO(newline="")
    original_columns = sorted({key for row in rows for key in row if key.startswith("original:")})
    writer = csv.DictWriter(out, fieldnames=[*FIELDS, *original_columns], lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    raw = out.getvalue().encode("utf-8")
    producer = {"adapter_sha256": file_digest(Path(__file__)),
                "native_observations_sha256": file_digest(Path(observations.__file__))}
    binding = {"schema": SCHEMA, "selection": selection, "capture": snap, "producer": producer,
               "projection": {"sha256": sha256(raw).hexdigest(), "bytes": len(raw)}}
    identity = digest(binding)
    summary = {"source_rows": len(rows), "rejected_original_rows": len(snap["source"]["rejected"]),
               "context_only_rows": sum(r["qualifier"] == "context-only" for r in rows),
               "left_censored_rows": sum(r["qualifier"] == "<" for r in rows),
               "right_censored_rows": sum(r["qualifier"] == ">" for r in rows),
               "characteristics": dict(Counter(r["parameter"] for r in rows)),
               "native_annual_admitted": 0}
    return binding, identity, rows, raw, summary


def preview(service, payload):
    binding, identity, rows, _, summary = _prepare(service, payload)
    return {"id": identity, "schema": SCHEMA, "selection": binding["selection"],
            "source": {k: binding["capture"]["source"][k] for k in ("id", "label", "sha", "mapping", "origin")},
            "revision": binding["capture"]["revision"], "summary": summary, "preview": rows[:20],
            "producer": binding["producer"], "projection": binding["projection"],
            "interpretation": "Canonical values and units remain distinct from original reported values. Rejected source rows and review/variant context stay in the full capture. Native annual admission is always zero."}


def prepare(workspace, service, payload):
    if payload.get("confirmed") is not True or not payload.get("expected_id"):
        raise ValueError("Review and explicitly confirm the complete source handoff preview")
    binding, identity, rows, raw, summary = _prepare(service, payload)
    if identity != payload["expected_id"]:
        raise ValueError("Source, review, mapping or implementation changed after preview; inspect it again")
    directory = workspace.root / FAMILY / identity
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".prepare.lock"):
        receipt_path = directory / "receipt.json"
        if receipt_path.exists():
            receipt = read_json(receipt_path)
            return get(workspace, receipt["handoff_id"])
        original = binding["capture"]["source"]["content"].encode("utf-8")
        atomic_bytes(directory / "original.csv", original, immutable=True)
        atomic_json(directory / "source-capture.json", binding, immutable=True)
        atomic_bytes(directory / "canonical-context.csv", raw, immutable=True)
        source_id = "measured-native-" + identity
        source_manifest = {"schema": "upstate.sources/v1", "title": binding["selection"]["title"],
            "entries": [{"id": source_id, "kind": "document", "title": binding["selection"]["title"],
                "uri": "urn:original-measurements:" + binding["capture"]["source"]["id"],
                "vintage": "Original Measurements revision " + str(binding["capture"]["revision"]),
                "path": "source-capture.json", "sha256": file_digest(directory / "source-capture.json"),
                "companions": [{"path": name, "bytes": (directory / name).stat().st_size,
                                "sha256": file_digest(directory / name)}
                               for name in ("original.csv", "canonical-context.csv")]}]}
        atomic_json(directory / "sources.json", source_manifest, immutable=True)
        collection = workspace.import_sources(directory / "sources.json")
        reference = {"source_collection_id": collection["id"], "source_id": source_id}
        metadata = {"title": binding["selection"]["title"], "source_uri": source_manifest["entries"][0]["uri"],
            "sha256": binding["projection"]["sha256"], "value_basis": "context",
            "observation_kind": "source_context", "measurement_support": "other_context",
            "time_support": "Original source calendar day; exact source time retained per row",
            "columns": {name: name for name in FIELDS}, "accepted_qualifiers": [""],
            "source_refs": [reference], "measurement_native_handoff": identity,
            # The original temporal receiver retains this complete native record,
            # so its offline source package also contains the full original import.
            "measurement_capture": binding, "handoff_summary": summary}
        observed = observations.ingest(workspace, directory / "canonical-context.csv", metadata)
        if observed["admitted_count"] != 0 or len(observed["rows"]) != len(rows):
            raise ValueError("Native context handoff changed row accounting or annual admission")
        saved = workspace._save(FAMILY, {"schema": SCHEMA, "title": binding["selection"]["title"],
            "handoff_id": identity, "observation_id": observed["id"], "source": reference,
            "source_sha256": file_digest(directory / "source-capture.json"), "summary": summary,
            "selection": binding["selection"], "measurement_revision": binding["capture"]["revision"],
            "producer": binding["producer"]})
        atomic_json(receipt_path, {"handoff_id": saved["id"]}, immutable=True)
        return get(workspace, saved["id"])


def get(workspace, key):
    row = workspace._get(FAMILY, identifier(key))
    source, _ = workspace.source_file(row["source"]["source_collection_id"], row["source"]["source_id"])
    if file_digest(source) != row["source_sha256"]:
        raise ValueError("Original measured source handoff changed")
    observed = workspace._get("observations", row["observation_id"])
    return {**row, "observation": {"id": observed["id"], "rows": len(observed["rows"]),
        "admitted_count": observed["admitted_count"], "context_count": observed["context_count"]},
        "temporal_selection": {"observation_id": observed["id"], "interpretation": {
            "columns": {name: name for name in ("activity", "fraction", "method_authority",
                "depth", "depth_unit", "value_type", "weight_basis", "time_basis",
                "temperature_basis", "particle_size_basis", "project", "time", "timezone",
                "reporting_limit", "reporting_limit_unit", "comment")},
            "below_qualifiers": ["<"], "above_qualifiers": [">"], "numeric_qualifiers": [""],
            "nonnegative": False, "use_limit_unit_when_missing": False}}}


def handle(workspace, service, payload):
    action = payload.get("action", "catalog")
    if action == "catalog":
        return {**service.json("GET", "native-observations/catalogue"),
                "handoffs": [{k: r.get(k) for k in ("id", "title", "observation_id", "summary", "measurement_revision")}
                             for r in workspace._list(FAMILY)]}
    if action == "preview":
        return preview(service, payload["selection"])
    if action == "prepare":
        return prepare(workspace, service, payload["selection"])
    if action == "get":
        return get(workspace, payload["id"])
    if action == "export":
        row = get(workspace, payload["id"])
        path, _ = workspace.source_file(row["source"]["source_collection_id"], row["source"]["source_id"])
        return {"handoff": row, "source": read_json(path),
                "observation": workspace._get("observations", row["observation_id"])}
    raise ValueError("Choose catalogue, preview, retain, reopen or full-source export")


def main(argv=None):
    import argparse
    from model.workspace import Workspace
    from .extension import MeasuredObservationExtension
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", required=True)
    parser.add_argument("--output", required=True, help="Complete JSON outside the original Workspace")
    parser.add_argument("--action", required=True, choices=("catalog", "preview", "prepare", "get", "export"))
    parser.add_argument("--selection", help="Complete explicit preview/prepare selection JSON")
    parser.add_argument("--id", help="Retained handoff identifier for get/export")
    args = parser.parse_args(argv)
    workspace = Workspace(Path(args.workspace))
    output = Path(args.output).resolve()
    if output.is_relative_to(workspace.root.resolve()):
        raise ValueError("Choose a new output file outside the original Workspace")
    extension = MeasuredObservationExtension(None, lambda *args: ValueError(str(args)))
    try:
        payload = {"action": args.action}
        if args.action in ("preview", "prepare"):
            if not args.selection:
                raise ValueError("Supply the exact selected source and reviewed interpretation")
            payload["selection"] = read_json(args.selection)
        if args.action in ("get", "export"):
            payload["id"] = args.id
        result = handle(workspace, extension._service(workspace), payload)
        atomic_json(output, result, immutable=True)
        print(json.dumps({"output": str(output), "id": result.get("id"),
                          "observation_id": result.get("observation_id")}))
    finally:
        extension.close()


if __name__ == "__main__":
    main()
