#!/usr/bin/env python3
"""ChipTrace real-source case: Izadifar et al. 2024, Supplementary Fig. S2b TEER.

Reads the frozen normalized CSV and adapter metadata unchanged, runs the
unmodified ChipTrace core, and writes case.json and case.html.
"""
from __future__ import annotations

import argparse
import hashlib
import html
import importlib.util
import json
import math
import statistics
import sys
import time
from collections import defaultdict
from pathlib import Path
from typing import Any, Dict, List, Tuple

HERE = Path(__file__).resolve().parent
SCHEMA = "chiptrace.real_source_case.v1"
NL = "\n"
EXPECTED = {
    "csv_sha256": "70732bd81fbf613179e43f998ab64953fe7d213f02576ebb443bc5d3285fd8f5",
    "csv_bytes": 14801,
    "workbook_sha256": "0667dee0329276f70c50e65aaac0efa44518fffd447aef9fcc21ff706ad4ed1e",
    "workbook_bytes": 60701,
    "core_git_blob": "4cdd8beaa7009e05fb93913f13b02ec42edfe6ba",
    "sheet": "Supp Fig. S2b",
    "observed_rows": 72,
}
CITATION = {
    "authors": "Izadifar Z, et al.",
    "journal": "Nature Communications",
    "year": 2024,
    "doi": "10.1038/s41467-024-48910-0",
    "article_url": "https://www.nature.com/articles/s41467-024-48910-0",
    "source_data_url": "https://media.springernature.com/original/springer-static/esm/art%3A10.1038%2Fs41467-024-48910-0/MediaObjects/41467_2024_48910_MOESM4_ESM.xlsx",
    "license": "CC BY 4.0",
}
GROUPS = (
    {"key": "cervix_chip", "label": "Cervix Chip", "run_id": "doi10.1038-s41467-024-48910-0_supp-s2b_cervix-chip", "columns": "BCDEFGHI", "header_cell": "B2"},
    {"key": "transwell", "label": "Transwell", "run_id": "doi10.1038-s41467-024-48910-0_supp-s2b_transwell", "columns": "JKLMNOPQ", "header_cell": "J2"},
)
SOURCE_DAYS = tuple(range(-3, 6))
DAY_ORIGIN = -3
SECONDS_PER_DAY = 86400
FIRST_DATA_ROW = 3
UNIT = "Ohm.cm2"
CHANNEL = "barrier_TEER"
MODALITY = "TEER"
SERIES_PREFIX = "unverified_source_series_"
SOURCE_IDENTITY = "SOURCE_IDENTITY_UNVERIFIED"
BIO = "INSUFFICIENT_EVIDENCE"
PUBLIC_METADATA_EXCLUDE = ("workbook_path", "csv_path", "current_public_report_rules")
MEASURED_NOTE = ("Values in this section are TEER measurements reported in the source workbook "
                 "(unit cell A1: Ohm.cm2). Synthetic fault-control copies appear only in the "
                 "Fault controls section and are not measurements.")
REPLAY_NOTE = ("Software replay consistency demonstration: the same measured group is both reference "
               "and candidate. Not a validation and not evidence of biological quality.")
FAULT_NOTE = ("Synthetic fault control: reference is the measured group; candidate is a generated copy "
              "of the same group with one predeclared change. Shows software behaviour only.")
FAULT_CONTROLS = (
    {"id": "FI1_remove_one_source_cell", "group": "transwell", "kind": "remove_cell", "cell": "L9",
     "description": "candidate copy omits measured cell L9; no value is added"},
    {"id": "FI2_scale_one_series", "group": "cervix_chip", "kind": "scale_series", "series": "F", "factor": 3.0,
     "description": "candidate copy multiplies every measured value of source series F by 3"},
    {"id": "FI3_time_origin_misassigned", "group": "transwell", "kind": "time_offset", "offset_s": 259200,
     "description": "candidate copy anchors time_s at differentiation day 0 instead of source day -3 (all times +259200 s)"},
)
PALETTE = ("#0072B2", "#D55E00", "#009E73", "#CC79A7", "#E69F00", "#56B4E9", "#000000", "#8C6D31")
CSS = ("body{font-family:system-ui,sans-serif;max-width:1100px;margin:2rem auto;padding:0 1rem;line-height:1.45;color:#111}"
       "table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}th,td{border:1px solid #999;padding:.35rem .5rem;text-align:left;vertical-align:top}"
       "td.abs{color:#555;background:#f2f2f2}.ref{font-size:.8em;color:#444;margin-right:.3em}.status{border-left:4px solid #333;padding:.6rem 1rem;background:#f7f7f7}"
       ".measured{border-left:4px solid #0072B2;padding:.6rem 1rem;background:#eef5fb}code{background:#f3f3f3;padding:.1rem .25rem;word-break:break-all}"
       "svg.plot{max-width:680px;width:100%;height:auto;font-size:12px}svg .grid{stroke:#ddd}svg .axis{stroke:#333}svg .day0{stroke:#333;stroke-dasharray:4 3}")


class SourceCaseError(ValueError):
    pass


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def git_blob_sha1(data: bytes) -> str:
    return hashlib.sha1(b"blob " + str(len(data)).encode("ascii") + b"\x00" + data).hexdigest()


def canonical(value: object) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=False, allow_nan=False).encode("utf-8")


def load_core(path: Path):
    spec = importlib.util.spec_from_file_location("chiptrace_core_s2b_case", path)
    if spec is None or spec.loader is None:
        raise SourceCaseError(f"cannot load ChipTrace core {path.name}")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def load_metadata(path: Path) -> Dict[str, Any]:
    document = json.loads(path.read_text(encoding="utf-8"))
    meta = document.get("adapter_metadata", document)
    for key in ("csv_sha256", "csv_bytes", "workbook_sha256", "workbook_bytes", "sheet", "source_cells",
                "time_origin", "series_observation_counts", "source_series_identity"):
        if key not in meta:
            raise SourceCaseError(f"adapter metadata missing {key}")
    for key in ("csv_sha256", "csv_bytes", "workbook_sha256", "workbook_bytes", "sheet"):
        if meta[key] != EXPECTED[key]:
            raise SourceCaseError(f"adapter metadata {key} differs from the frozen value")
    origin = meta["time_origin"]
    if origin.get("source_day") != DAY_ORIGIN or origin.get("differentiation_day_0_time_s") != 259200:
        raise SourceCaseError("adapter metadata time origin differs from the frozen value")
    return meta


def parse_cell(source: str) -> Tuple[str, int]:
    marker = "Supp Fig. S2b, "
    if marker not in source:
        raise SourceCaseError(f"source field lacks a Supp Fig. S2b cell reference: {source!r}")
    ref = source.rsplit(marker, 1)[1].strip()
    column, row_text = ref[:1], ref[1:]
    if not column.isalpha() or not row_text.isdigit():
        raise SourceCaseError(f"malformed source cell reference {ref!r}")
    return column, int(row_text)


def build_cells(observations, meta: Dict[str, Any]) -> List[Dict[str, Any]]:
    group_of = {column: group for group in GROUPS for column in group["columns"]}
    cells: List[Dict[str, Any]] = []
    seen = set()
    for o in observations:
        column, row = parse_cell(o.source)
        group = group_of.get(column)
        day = row - FIRST_DATA_ROW + DAY_ORIGIN
        checks = (
            group is not None and o.run_id == group["run_id"],
            o.replicate_id == SERIES_PREFIX + column,
            day in SOURCE_DAYS,
            o.time_s == float((day - DAY_ORIGIN) * SECONDS_PER_DAY),
            (o.unit, o.channel, o.modality) == (UNIT, CHANNEL, MODALITY),
            (column, row) not in seen,
        )
        if not all(checks):
            raise SourceCaseError(f"source cell {column}{row}: row does not match the adapter lineage contract")
        seen.add((column, row))
        cells.append({"group": group["key"], "series_column": column, "replicate_id": o.replicate_id,
                      "cell": f"{column}{row}", "source_day": day, "time_s": o.time_s, "value": o.value,
                      "unit": o.unit, "source": o.source})
    if len(cells) != EXPECTED["observed_rows"]:
        raise SourceCaseError(f"expected {EXPECTED['observed_rows']} observed cells, found {len(cells)}")
    declared = meta["series_observation_counts"]
    for group in GROUPS:
        for column in group["columns"]:
            days = sorted(c["source_day"] for c in cells if c["series_column"] == column)
            entry = declared.get(group["label"], {}).get(column, {})
            if entry.get("days") != days or entry.get("observations") != len(days):
                raise SourceCaseError(f"series {column}: observed days differ from adapter metadata")
    cells.sort(key=lambda c: (c["group"], c["series_column"], c["source_day"]))
    return cells


def source_grid(cells: List[Dict[str, Any]], group: Dict[str, Any]) -> List[Dict[str, Any]]:
    lookup = {c["cell"]: c for c in cells}
    grid = []
    for day in SOURCE_DAYS:
        row = day - DAY_ORIGIN + FIRST_DATA_ROW
        entries = []
        for column in group["columns"]:
            ref = f"{column}{row}"
            cell = lookup.get(ref)
            entries.append({"cell": ref, "status": "OBSERVED" if cell else "ABSENT",
                            "value": cell["value"] if cell else None})
        grid.append({"source_day": day, "day_cell": f"A{row}", "time_s": (day - DAY_ORIGIN) * SECONDS_PER_DAY,
                     "cells": entries})
    return grid


def write_group_subset(raw: bytes, run_id: str, dest: Path) -> Dict[str, Any]:
    lines = raw.splitlines(keepends=True)
    prefix = run_id.encode("utf-8") + b","
    kept = [line for line in lines[1:] if line.startswith(prefix)]
    data = b"".join([lines[0]] + kept)
    dest.write_bytes(data)
    return {"file": dest.name, "rows": len(kept), "sha256": sha256_bytes(data),
            "construction": "header plus byte-identical parent CSV lines for this run_id only"}


def eligibility(ct, observations, min_points: int, min_baseline_points: int) -> Dict[str, Any]:
    model = ct.build_baselines(observations)[CHANNEL]
    by_series: Dict[str, List[float]] = defaultdict(list)
    for o in observations:
        by_series[o.replicate_id].append(o.time_s)
    required_groups = min(2, model.replicate_count)
    per_group_min = max(2, min_points // required_groups)
    spans = {rid: max(ts) - min(ts) for rid, ts in by_series.items()}
    nonzero = [s for s in spans.values() if s > 0]
    reference_span = float(statistics.median(nonzero)) if nonzero else 0.0
    series = []
    for rid in sorted(by_series):
        n, span = len(by_series[rid]), spans[rid]
        fraction = span / reference_span if reference_span else None
        series.append({"replicate_id": rid, "identity_status": SOURCE_IDENTITY, "observations": n,
                       "span_s": span, "span_days": span / SECONDS_PER_DAY,
                       "meets_min_points": n >= min_points, "meets_points_per_group": n >= per_group_min,
                       "span_fraction_of_reference": None if fraction is None else round(fraction, 6),
                       "meets_75pct_span": fraction is not None and fraction >= 0.75})
    return {
        "baseline_n": model.n,
        "baseline_n_meets_min_baseline_points": model.n >= min_baseline_points,
        "source_series_labels": model.replicate_count,
        "source_series_label_status": SOURCE_IDENTITY,
        "core_required_groups": required_groups,
        "core_min_points_per_group": per_group_min,
        "series_meeting_min_points": sum(s["meets_min_points"] for s in series),
        "series_meeting_points_per_group": sum(s["meets_points_per_group"] for s in series),
        "reference_median_span_s": reference_span,
        "series_meeting_75pct_span": sum(s["meets_75pct_span"] for s in series),
        "series_below_75pct_span": sum(not s["meets_75pct_span"] for s in series),
        "core_center": round(model.center, 10),
        "core_scale": round(model.scale, 10),
        "core_scale_method": model.scale_method,
        "core_cadence_s": model.cadence_s,
        "series": series,
    }


def summarize_report(ct, report: Dict[str, Any], kind: str, report_file: str) -> Dict[str, Any]:
    return {
        "analysis_kind": kind,
        "interpretation": REPLAY_NOTE if kind == "SOFTWARE_REPLAY_CONSISTENCY" else FAULT_NOTE,
        "core_report_file": report_file,
        "core_overall_state": report["overall_state"],
        "core_receipt_sha256": report["receipt_sha256"],
        "core_receipt_verifies": bool(ct.verify_report(report)),
        "core_inputs": report["inputs"],
        "core_config": report["config"],
        "channels": [{"channel": a["channel"], "core_state": a["state"],
                      "quality_risk_score": a["quality_risk_score"], "uncertainty": a["uncertainty"],
                      "reasons": a["reasons"], "metrics": a["metrics"]} for a in report["channel_assessments"]],
        "source_identity": SOURCE_IDENTITY,
        "biological_quality_disposition": BIO,
    }


def make_fault_rows(ct, observations, spec: Dict[str, Any], parent_sha: str):
    rows, lineage = [], []
    for o in observations:
        column, row = parse_cell(o.source)
        ref = f"{column}{row}"
        record = {"parent_cell": ref, "parent_time_s": o.time_s, "parent_value": o.value}
        if spec["kind"] == "remove_cell" and ref == spec["cell"]:
            lineage.append({**record, "action": "removed", "generated_time_s": None, "generated_value": None})
            continue
        value, t, action = o.value, o.time_s, "unchanged"
        if spec["kind"] == "scale_series" and column == spec["series"]:
            value, action = o.value * spec["factor"], "value_scaled"
        if spec["kind"] == "time_offset":
            t, action = o.time_s + spec["offset_s"], "time_offset"
        tag = (f"synthetic_fault_injection:{spec['id']} | parent_csv_sha256={parent_sha} "
               f"| parent_cell=Supp Fig. S2b!{ref}")
        rows.append(ct.Observation(run_id=o.run_id + "__" + spec["id"], replicate_id=o.replicate_id, time_s=t,
                                   channel=o.channel, value=value, unit=o.unit, source=tag, modality=o.modality))
        lineage.append({**record, "action": action, "generated_time_s": t, "generated_value": value})
    if len(rows) > len(observations):
        raise SourceCaseError("fault control must not add observations")
    return rows, lineage


def next_measurement_request(groups: List[Dict[str, Any]]) -> Dict[str, Any]:
    absent = {g["label"]: g["absent_cells"] for g in groups}
    absent_text = "; ".join(f"{label}: {len(cells)} cells ({', '.join(cells)})" for label, cells in absent.items())
    return {
        "purpose": "evidence required before any disposition other than INSUFFICIENT_EVIDENCE",
        "data_rules": "coded, non-personal identifiers only; no donor, patient or personal information",
        "items": [
            {"id": "R1_series_identity", "missing_evidence": SOURCE_IDENTITY,
             "request": "For each workbook column B:Q, state whether all values come from one physical device or well measured on successive days, and give a coded device/well identifier per cell."},
            {"id": "R2_replicate_structure", "missing_evidence": "independent biological replicate count",
             "request": "For each column, give coded experiment-batch and cell-lot labels so independent replicates can be counted."},
            {"id": "R3_absent_cells", "missing_evidence": "reason for blank source cells",
             "request": "For each blank cell, state whether it was not scheduled, not measured, or excluded, and the exclusion rule. " + absent_text},
            {"id": "R4_phase_matched_reference", "missing_evidence": "independent reference on a shared time origin",
             "request": "Per group, designate a pre-specified reference set of series, distinct from candidate series, measured on the same source-day schedule (-3 to 5) with the same TEER instrument, electrode, blank subtraction and area correction."},
            {"id": "R5_measurement_annotations", "missing_evidence": "QC ground truth",
             "request": "Any recorded per-cell measurement events (electrode fault, bubble, temperature, medium-change timing) if they exist."},
            {"id": "R6_fig3h_units", "missing_evidence": "unit and normalization for Fig. 3h",
             "request": "Unit and normalization reference for the Fig. 3h series before they can be included."},
        ],
    }


def build_case(csv_path: Path, metadata_path: Path, core_path: Path, out_dir: Path, *, min_points: int = 6,
               min_baseline_points: int = 12, run_core: bool = True, allow_core_mismatch: bool = False) -> Dict[str, Any]:
    raw = csv_path.read_bytes()
    csv_sha = sha256_bytes(raw)
    if csv_sha != EXPECTED["csv_sha256"] or len(raw) != EXPECTED["csv_bytes"]:
        raise SourceCaseError("normalized CSV bytes differ from the frozen source CSV (sha256/bytes)")
    meta = load_metadata(metadata_path)
    meta_sha = sha256_bytes(metadata_path.read_bytes())
    core_bytes = core_path.read_bytes()
    core_blob = git_blob_sha1(core_bytes)
    if core_blob != EXPECTED["core_git_blob"] and not allow_core_mismatch:
        raise SourceCaseError(f"ChipTrace core git blob {core_blob} differs from expected {EXPECTED['core_git_blob']}")
    ct = load_core(core_path)
    observations = ct.load_csv(csv_path)
    cells = build_cells(observations, meta)
    work, reports = out_dir / "work", out_dir / "core_reports"
    work.mkdir(parents=True, exist_ok=True)
    reports.mkdir(parents=True, exist_ok=True)
    groups_out: List[Dict[str, Any]] = []
    subsets: Dict[str, Any] = {}
    for group in GROUPS:
        subset_path = work / f"s2b_{group['key']}_measured.csv"
        subset = write_group_subset(raw, group["run_id"], subset_path)
        group_obs = ct.load_csv(subset_path)
        if {o.run_id for o in group_obs} != {group["run_id"]}:
            raise SourceCaseError(f"group subset {subset_path.name} mixes run_ids")
        subsets[group["key"]] = (subset_path, subset, group_obs)
        group_cells = [c for c in cells if c["group"] == group["key"]]
        grid = source_grid(cells, group)
        absent_cells = [e["cell"] for row in grid for e in row["cells"] if e["status"] == "ABSENT"]
        entry: Dict[str, Any] = {
            "key": group["key"], "label": group["label"], "run_id": group["run_id"], "columns": group["columns"],
            "header_cell": group["header_cell"],
            "value_range_cells": f"{group['columns'][0]}3:{group['columns'][-1]}11",
            "grid_cell_count": len(SOURCE_DAYS) * len(group["columns"]),
            "observed_cell_count": len(group_cells), "absent_cell_count": len(absent_cells),
            "absent_cells": absent_cells, "source_cell_grid": grid, "measured_subset": subset,
            "series": [{"series_column": col, "replicate_id": SERIES_PREFIX + col, "identity_status": SOURCE_IDENTITY,
                        "observations": [{k: c[k] for k in ("cell", "source_day", "time_s", "value", "unit", "source")}
                                         for c in group_cells if c["series_column"] == col]}
                       for col in group["columns"]],
            "eligibility": eligibility(ct, group_obs, min_points, min_baseline_points),
        }
        if run_core:
            report = ct.analyze(subset_path, subset_path, min_points=min_points, min_baseline_points=min_baseline_points)
            report_path = reports / f"replay_{group['key']}.json"
            report_path.write_text(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + NL, encoding="utf-8")
            entry["self_reference_replay"] = summarize_report(ct, report, "SOFTWARE_REPLAY_CONSISTENCY", report_path.name)
        groups_out.append(entry)
    faults: List[Dict[str, Any]] = []
    if run_core:
        for spec in FAULT_CONTROLS:
            subset_path, subset, group_obs = subsets[spec["group"]]
            rows, lineage = make_fault_rows(ct, group_obs, spec, csv_sha)
            candidate = work / f"{spec['id']}.csv"
            ct.write_csv(candidate, rows)
            report = ct.analyze(subset_path, candidate, min_points=min_points, min_baseline_points=min_baseline_points)
            report_path = reports / f"fault_{spec['id']}.json"
            report_path.write_text(json.dumps(report, indent=2, sort_keys=True, ensure_ascii=False) + NL, encoding="utf-8")
            faults.append({
                **spec, "tag": "synthetic_fault_injection", "measurement_status": "GENERATED_NOT_MEASURED",
                "parent_csv_sha256": csv_sha, "parent_workbook_sha256": EXPECTED["workbook_sha256"],
                "reference_file": subset["file"], "reference_sha256": subset["sha256"],
                "candidate_file": candidate.name, "candidate_sha256": sha256_bytes(candidate.read_bytes()),
                "rows_parent": len(group_obs), "rows_generated": len(rows), "lineage": lineage,
                "core": summarize_report(ct, report, "SYNTHETIC_FAULT_CONTROL", report_path.name),
            })
    case: Dict[str, Any] = {
        "schema": SCHEMA,
        "citation": CITATION,
        "source": {
            "workbook_sha256": EXPECTED["workbook_sha256"], "workbook_bytes": EXPECTED["workbook_bytes"],
            "sheet": EXPECTED["sheet"], "normalized_csv_sha256": csv_sha, "normalized_csv_bytes": len(raw),
            "adapter_metadata_file_sha256": meta_sha,
            "adapter_metadata_public": {k: v for k, v in sorted(meta.items()) if k not in PUBLIC_METADATA_EXCLUDE},
        },
        "core": {"file": core_path.name, "version": ct.VERSION, "git_blob_sha1": core_blob,
                 "sha256": sha256_bytes(core_bytes), "matches_expected_blob": core_blob == EXPECTED["core_git_blob"]},
        "time_origin": {"time_s_formula": "(source_day + 3) * 86400", "source_day_minus_3_time_s": 0,
                        "differentiation_day_0_time_s": 259200, "day_cells": "A3:A11"},
        "config": {"min_points": min_points, "min_baseline_points": min_baseline_points, "core_analyses_run": run_core},
        "data_classes": {"measured": MEASURED_NOTE, "generated": FAULT_NOTE},
        "groups": groups_out,
        "fault_controls": faults,
        "dispositions": {"source_identity": SOURCE_IDENTITY, "biological_quality": BIO,
                         "qc_ground_truth": "NONE_IN_SOURCE", "independent_baseline": "NONE_AVAILABLE",
                         "cross_group_comparison": "NOT_PERFORMED", "pooling": "NOT_PERFORMED",
                         "interpolation": "NOT_PERFORMED"},
        "excluded": [
            {"item": "Fig. 3h", "reason": "unit and normalization not stated; baseline-zeroed, predominantly negative values"},
            {"item": "Fig. 3i", "reason": "no such sheet in the workbook"},
        ],
        "next_measurement_request": next_measurement_request(groups_out),
    }
    case["case_receipt_sha256"] = sha256_bytes(canonical(case))
    (out_dir / "case.json").write_text(json.dumps(case, indent=2, sort_keys=True, ensure_ascii=False, allow_nan=False) + NL, encoding="utf-8")
    (out_dir / "case.html").write_text(render_html(case), encoding="utf-8")
    return case


def _num(value: Any) -> str:
    return "n/a" if value is None else repr(value)


def svg_panel(group: Dict[str, Any], y_max: float) -> str:
    key = group["key"]
    w, h, left, right, top, bottom = 680, 360, 72, 150, 24, 56
    pw, ph = w - left - right, h - top - bottom
    d0, d1 = SOURCE_DAYS[0], SOURCE_DAYS[-1]

    def sx(day: float) -> float:
        return left + (day - d0) / (d1 - d0) * pw

    def sy(value: float) -> float:
        return top + ph - value / y_max * ph

    out = [f"<svg class='plot' role='img' aria-labelledby='t-{key} d-{key}' viewBox='0 0 {w} {h}' xmlns='http://www.w3.org/2000/svg'>",
           f"<title id='t-{key}'>{html.escape(group['label'])}: measured TEER by source day</title>",
           f"<desc id='d-{key}'>{group['observed_cell_count']} measured cells from workbook range {group['value_range_cells']}. "
           "Points are not connected; absent cells are not drawn; points are offset horizontally by series for visibility. "
           "All values are listed in the table below.</desc>"]
    for i in range(5):
        value = y_max * i / 4
        y = sy(value)
        out.append(f"<line class='grid' x1='{left}' x2='{left + pw}' y1='{y:.1f}' y2='{y:.1f}'/>")
        out.append(f"<text x='{left - 8}' y='{y + 4:.1f}' text-anchor='end'>{value:.0f}</text>")
    for day in SOURCE_DAYS:
        out.append(f"<text x='{sx(day):.1f}' y='{top + ph + 18}' text-anchor='middle'>{day}</text>")
    out.append(f"<line class='axis' x1='{left}' x2='{left + pw}' y1='{top + ph}' y2='{top + ph}'/>")
    out.append(f"<line class='axis' x1='{left}' x2='{left}' y1='{top}' y2='{top + ph}'/>")
    x0 = sx(0)
    out.append(f"<line class='day0' x1='{x0:.1f}' x2='{x0:.1f}' y1='{top}' y2='{top + ph}'/>")
    out.append(f"<text x='{x0 + 4:.1f}' y='{top + 12}'>differentiation day 0 (time_s 259200)</text>")
    out.append(f"<text x='{left + pw / 2:.1f}' y='{h - 12}' text-anchor='middle'>source day (time_s = (day + 3) x 86400)</text>")
    out.append(f"<text transform='rotate(-90)' x='{-(top + ph / 2):.1f}' y='18' text-anchor='middle'>TEER (Ohm.cm2)</text>")
    for idx, series in enumerate(group["series"]):
        color = PALETTE[idx % len(PALETTE)]
        ly = top + 14 + idx * 20
        out.append(f"<circle cx='{left + pw + 24}' cy='{ly - 4}' r='5' fill='{color}'/>"
                   f"<text x='{left + pw + 36}' y='{ly}'>series {series['series_column']} (n={len(series['observations'])})</text>")
        offset = (idx - (len(group["series"]) - 1) / 2) * 3.0
        for obs in series["observations"]:
            out.append(f"<circle cx='{sx(obs['source_day']) + offset:.1f}' cy='{sy(obs['value']):.1f}' r='4.5' fill='{color}' stroke='#ffffff'>"
                       f"<title>{obs['cell']}: day {obs['source_day']}, {_num(obs['value'])} Ohm.cm2</title></circle>")
    out.append("</svg>")
    return "".join(out)


def grid_table(group: Dict[str, Any]) -> str:
    e = html.escape
    head = "".join(f"<th scope='col'>{c}</th>" for c in group["columns"])
    body = []
    for row in group["source_cell_grid"]:
        tds = "".join(
            f"<td><span class='ref'>{c['cell']}</span>{_num(c['value'])}</td>" if c["status"] == "OBSERVED"
            else f"<td class='abs'><span class='ref'>{c['cell']}</span>ABSENT</td>" for c in row["cells"])
        body.append(f"<tr><th scope='row'>{row['source_day']} <span class='ref'>{row['day_cell']}</span></th><td>{row['time_s']}</td>{tds}</tr>")
    caption = (f"{e(group['label'])}: workbook cells {group['value_range_cells']}, sheet Supp Fig. S2b, header {group['header_cell']}, "
               f"unit A1 (Ohm.cm2). {group['observed_cell_count']} observed, {group['absent_cell_count']} ABSENT of {group['grid_cell_count']}.")
    return (f"<table><caption>{caption}</caption><thead><tr><th scope='col'>Source day</th><th scope='col'>time_s</th>{head}</tr></thead>"
            f"<tbody>{''.join(body)}</tbody></table>")


def eligibility_table(group: Dict[str, Any]) -> str:
    el = group["eligibility"]
    rows = "".join(
        f"<tr><td>{html.escape(s['replicate_id'])}</td><td>{s['observations']}</td><td>{s['span_days']:g}</td>"
        f"<td>{'yes' if s['meets_min_points'] else 'no'}</td><td>{'yes' if s['meets_points_per_group'] else 'no'}</td>"
        f"<td>{_num(s['span_fraction_of_reference'])}</td><td>{'yes' if s['meets_75pct_span'] else 'no'}</td></tr>"
        for s in el["series"])
    summary = (f"<p>{html.escape(group['label'])}: baseline n = {el['baseline_n']} (min {el['baseline_n_meets_min_baseline_points'] and 'met' or 'not met'}); "
               f"{el['source_series_labels']} source series labels ({el['source_series_label_status']}); core requires {el['core_required_groups']} groups with "
               f"&ge; {el['core_min_points_per_group']} points: {el['series_meeting_points_per_group']} series meet it; "
               f"{el['series_meeting_min_points']} series have &ge; min_points; {el['series_below_75pct_span']} series below 75% of the median span "
               f"({el['reference_median_span_s'] / SECONDS_PER_DAY:g} days).</p>")
    return (summary + "<table><caption>Core-configured evidence eligibility per source series (" + html.escape(group["label"]) +
            ")</caption><thead><tr><th scope='col'>Series</th><th scope='col'>Observations</th><th scope='col'>Span (days)</th>"
            "<th scope='col'>&ge; min_points</th><th scope='col'>&ge; points per group</th><th scope='col'>Span fraction</th>"
            "<th scope='col'>&ge; 75% span</th></tr></thead><tbody>" + rows + "</tbody></table>")


def core_rows(items: List[Tuple[str, str, str, Dict[str, Any]]]) -> str:
    e = html.escape
    out = []
    for name, group, candidate_sha, summary in items:
        reasons = "; ".join("; ".join(ch["reasons"]) for ch in summary["channels"])
        out.append(f"<tr><td>{e(name)}</td><td>{e(group)}</td><td><code>{e(candidate_sha)}</code></td>"
                   f"<td>{e(summary['core_overall_state'])}</td><td>{e(reasons)}</td><td>{e(summary['source_identity'])}</td>"
                   f"<td>{e(summary['biological_quality_disposition'])}</td><td><code>{e(summary['core_receipt_sha256'])}</code></td></tr>")
    return ("<table><thead><tr><th scope='col'>Analysis</th><th scope='col'>Group</th><th scope='col'>Candidate SHA-256</th>"
            "<th scope='col'>Core state</th><th scope='col'>Core reasons</th><th scope='col'>Source identity</th>"
            "<th scope='col'>Biological quality</th><th scope='col'>Core receipt</th></tr></thead><tbody>" + "".join(out) + "</tbody></table>")


def render_html(case: Dict[str, Any]) -> str:
    e = html.escape
    src, core, cit = case["source"], case["core"], case["citation"]
    values = [o["value"] for g in case["groups"] for s in g["series"] for o in s["observations"]]
    y_max = max(200.0, math.ceil(max(values) / 200.0) * 200.0)
    kv = [
        ("Article", f"{cit['authors']} {cit['journal']} {cit['year']}. doi:{cit['doi']} ({cit['article_url']})"),
        ("License", cit["license"]),
        ("Source workbook", f"{src['workbook_bytes']} bytes, SHA-256 {src['workbook_sha256']} ({cit['source_data_url']})"),
        ("Sheet and cells", "Supp Fig. S2b; unit A1; days A3:A11; Cervix Chip B3:I11 (header B2); Transwell J3:Q11 (header J2)"),
        ("Normalized CSV", f"{src['normalized_csv_bytes']} bytes, SHA-256 {src['normalized_csv_sha256']}"),
        ("Adapter metadata file", f"SHA-256 {src['adapter_metadata_file_sha256']}"),
        ("ChipTrace core", f"{core['file']} v{core['version']}, git blob {core['git_blob_sha1']}, SHA-256 {core['sha256']}"),
        ("Time origin", "time_s = (source day + 3) x 86400; source day -3 = 0 s; differentiation day 0 = 259200 s"),
        ("Series labels", "unverified_source_series_<column> identifies a workbook column only"),
    ]
    parts = ["<!doctype html>", "<html lang='en'><head><meta charset='utf-8'><meta name='viewport' content='width=device-width,initial-scale=1'>",
             "<title>ChipTrace real-source case: Supp Fig. S2b TEER</title>", f"<style>{CSS}</style></head><body><main>",
             "<h1>Cervix epithelium TEER, Supplementary Fig. S2b: source-cell case</h1>",
             f"<p class='status'><strong>Source series identity:</strong> {SOURCE_IDENTITY}<br><strong>Biological quality disposition:</strong> {BIO}"
             "<br><strong>QC ground truth in source:</strong> none<br><strong>Groups:</strong> analysed separately; not pooled, not compared, not interpolated</p>",
             "<h2>Source and provenance</h2><table><tbody>" + "".join(f"<tr><th scope='row'>{e(k)}</th><td>{e(v)}</td></tr>" for k, v in kv) + "</tbody></table>",
             "<h2>Measured data</h2>", f"<p class='measured'>{e(MEASURED_NOTE)}</p>"]
    for group in case["groups"]:
        parts.append(f"<h3>{e(group['label'])}</h3>")
        parts.append(svg_panel(group, y_max))
        parts.append(grid_table(group))
    parts.append("<h2>Evidence eligibility under the configured core</h2>")
    parts.append(f"<p>min_points = {case['config']['min_points']}, min_baseline_points = {case['config']['min_baseline_points']}. "
                 "Counts treat each workbook column as the core's replicate group; column independence is unverified.</p>")
    for group in case["groups"]:
        parts.append(eligibility_table(group))
    replays = [("self-reference replay", g["label"], g["measured_subset"]["sha256"], g["self_reference_replay"])
               for g in case["groups"] if "self_reference_replay" in g]
    if replays:
        parts.append("<h2>Software replay consistency</h2>")
        parts.append(f"<p>{e(REPLAY_NOTE)}</p>")
        parts.append(core_rows(replays))
    if case["fault_controls"]:
        parts.append("<h2>Fault controls</h2>")
        parts.append(f"<p>{e(FAULT_NOTE)} Each generated row carries tag synthetic_fault_injection, the parent CSV SHA-256 and its parent workbook cell. No observation is added and no series crosses groups.</p>")
        parts.append("<ul>" + "".join(f"<li><strong>{e(f['id'])}</strong> ({e(f['group'])}): {e(f['description'])}; rows {f['rows_parent']} to {f['rows_generated']}</li>" for f in case["fault_controls"]) + "</ul>")
        parts.append(core_rows([(f["id"], f["group"], f["candidate_sha256"], f["core"]) for f in case["fault_controls"]]))
    request = case["next_measurement_request"]
    parts.append("<h2>Next measurement request</h2>")
    parts.append(f"<p>{e(request['purpose'])}. {e(request['data_rules'])}.</p><ol>" +
                 "".join(f"<li><strong>{e(i['missing_evidence'])}</strong>: {e(i['request'])}</li>" for i in request["items"]) + "</ol>")
    parts.append("<h2>Excluded source items</h2><ul>" + "".join(f"<li>{e(x['item'])}: {e(x['reason'])}</li>" for x in case["excluded"]) + "</ul>")
    parts.append(f"<p>Machine-readable record: case.json; case receipt <code>{e(case['case_receipt_sha256'])}</code></p>")
    parts.append("</main></body></html>")
    return NL.join(parts) + NL


def main(argv=None) -> int:
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("--csv", default=str(HERE / "data" / "cervix_chip_teer_supp_s2b.csv"))
    p.add_argument("--metadata", default=str(HERE / "data" / "adapter_metadata.json"))
    p.add_argument("--core", default=str(HERE.parent / "chiptrace.py"))
    p.add_argument("--out-dir", required=True)
    p.add_argument("--min-points", type=int, default=6)
    p.add_argument("--min-baseline-points", type=int, default=12)
    p.add_argument("--descriptive-only", action="store_true", help="skip replay and fault-control core analyses")
    p.add_argument("--allow-core-mismatch", action="store_true", help="record, rather than reject, a core git-blob mismatch")
    args = p.parse_args(argv)
    started = time.perf_counter()
    try:
        case = build_case(Path(args.csv), Path(args.metadata), Path(args.core), Path(args.out_dir),
                          min_points=args.min_points, min_baseline_points=args.min_baseline_points,
                          run_core=not args.descriptive_only, allow_core_mismatch=args.allow_core_mismatch)
    except (ValueError, OSError) as exc:
        print(f"ERROR: {exc}")
        return 2
    print(json.dumps({"case_receipt_sha256": case["case_receipt_sha256"], "core_git_blob": case["core"]["git_blob_sha1"],
                      "csv_sha256": case["source"]["normalized_csv_sha256"], "out_dir": args.out_dir,
                      "runtime_s": round(time.perf_counter() - started, 6)}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
