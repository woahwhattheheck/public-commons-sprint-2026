"""Explain original Parameter totals on their different retained valid-cell supports.

Pure arithmetic over saved rows. This module opens no raster, runs no model and
does not replace any original change, percentage, area or range.
"""
from __future__ import annotations

from copy import deepcopy
import csv
import hashlib
import io
import math
from pathlib import Path

SCHEMA = "upstate.parameter-support-reconciliation/v1"
EDITION = 1
JSON_FILE = "support-reconciliation.json"
CSV_FILE = "support-reconciliation.csv"
SOURCE_FILE = "parameter-support-reconciliation.py"
FILES = (JSON_FILE, CSV_FILE, SOURCE_FILE)
KEYS = ("case_id", "case", "run_id", "profile_id", "area_id", "area", "pollutant", "units")
MASS_KEYS = ("baseline_mass", "case_mass", "change", "baseline_full_mass", "case_full_mass")
COUNT_KEYS = ("baseline_valid_cells", "case_valid_cells", "paired_valid_cells")
DERIVED = (
    "baseline_only_cells", "case_only_cells", "baseline_only_area_ha", "case_only_area_ha",
    "baseline_common_fraction", "case_common_fraction", "independent_full_change",
    "baseline_only_mass_difference", "case_only_mass_difference",
    "paired_mass_difference", "stored_change_arithmetic_residual",
    "reconciliation_residual", "reconciliation_available", "unavailable_reason",
    "sign_reversal", "area_derivation_basis",
)
CSV_FIELDS = (
    "selected_row_index", "original_row_index", "original_artifact_sha256",
    "selected_row_pointer", "original_member", *KEYS, *COUNT_KEYS,
    "paired_area_ha", "pixel_area_ha", *MASS_KEYS, *DERIVED,
)
NOTES = [
    "Independent full change is case own-valid mass minus baseline own-valid mass. The stored paired change compares only cells valid in both runs. Both quantities remain distinct.",
    "Full change = stored paired change + case-only mass difference - baseline-only mass difference + reconciliation residual. Exclusive mass terms are arithmetic differences between each run's full and paired reductions, not a new raster aggregation.",
    "The explicit residual retains any disagreement between the original stored paired change and a subtraction of the two stored paired masses. Separately reduced floating-point quantities need not close exactly; small signed residuals are not clipped or interpreted as physical loss.",
    "Own-valid and paired counts define exclusive support. Missing cells are not zero export. With no paired cells, the original paired nulls remain null and no paired reconciliation or sign comparison is supplied.",
    "Exclusive hectares are derived only when the original row retains a finite positive pixel_area_ha. No nominal grid size is assumed. The original paired area is copied, not recalculated.",
    "An opposite sign describes these two saved summaries on different supports. It is not a restoration benefit, causal attribution, observed-load validation, confidence interval or four-case common-mask interaction.",
    "Every row retains the original result SHA256, case/run/profile/area/pollutant key and its selected-results.json row pointer. An original full-result row index is supplied only when that original index is actually available.",
]


def _finite(value, label, *, nullable=False):
    if value is None and nullable:
        return None
    if type(value) not in (int, float) or not math.isfinite(value):
        raise ValueError("Retain a finite original " + label)
    return value


def _difference(left, right):
    if left is None or right is None:
        return None
    value = math.fsum((left, -right))
    if not math.isfinite(value):
        raise ValueError("Support reconciliation exceeds finite arithmetic")
    return value


def _key(row):
    return tuple(row[name] for name in ("case_id", "area_id", "pollutant"))


def reconcile_row(row):
    """Return an independent projection; the caller's original row is untouched."""
    result = {name: deepcopy(row.get(name)) for name in KEYS}
    for name in MASS_KEYS:
        result[name] = _finite(row.get(name), name, nullable=True)
    for name in COUNT_KEYS:
        value = row.get(name)
        if type(value) is not int or value < 0:
            raise ValueError("Retain an original nonnegative integer " + name)
        result[name] = value
    paired, baseline, case = (result[name] for name in
                             ("paired_valid_cells", "baseline_valid_cells", "case_valid_cells"))
    if paired > min(baseline, case):
        raise ValueError("Original paired cells exceed their own-valid support")
    result["paired_area_ha"] = _finite(row.get("paired_area_ha"), "paired area", nullable=True)
    area = row.get("pixel_area_ha")
    known_area = type(area) in (int, float) and math.isfinite(area) and area > 0
    result.update(
        pixel_area_ha=area if known_area else None,
        baseline_only_cells=baseline - paired, case_only_cells=case - paired,
        baseline_only_area_ha=(baseline - paired) * area if known_area else None,
        case_only_area_ha=(case - paired) * area if known_area else None,
        baseline_common_fraction=paired / baseline if baseline else None,
        case_common_fraction=paired / case if case else None,
        area_derivation_basis=("exclusive original cell count times original pixel_area_ha"
                               if known_area else "original positive pixel area unavailable"),
        independent_full_change=_difference(result["case_full_mass"], result["baseline_full_mass"]),
        baseline_only_mass_difference=None, case_only_mass_difference=None,
        paired_mass_difference=None, stored_change_arithmetic_residual=None,
        reconciliation_residual=None, reconciliation_available=False,
        unavailable_reason=None, sign_reversal=None,
    )
    if not paired:
        result["unavailable_reason"] = "no_paired_valid_cells"
    elif any(result[name] is None for name in MASS_KEYS):
        result["unavailable_reason"] = "original_mass_or_change_unavailable"
    else:
        baseline_only = _difference(result["baseline_full_mass"], result["baseline_mass"])
        case_only = _difference(result["case_full_mass"], result["case_mass"])
        paired_difference = _difference(result["case_mass"], result["baseline_mass"])
        residual = math.fsum((result["independent_full_change"], -result["change"],
                              -case_only, baseline_only))
        result.update(
            baseline_only_mass_difference=baseline_only, case_only_mass_difference=case_only,
            paired_mass_difference=paired_difference,
            stored_change_arithmetic_residual=_difference(result["change"], paired_difference),
            reconciliation_residual=residual, reconciliation_available=True,
            sign_reversal=((result["change"] < 0 < result["independent_full_change"])
                           or (result["independent_full_change"] < 0 < result["change"])),
        )
    for value in result.values():
        if type(value) is float and not math.isfinite(value):
            raise ValueError("Support reconciliation contains a nonfinite derived quantity")
    return result


def calculate(selected, rows, *, original_rows=None):
    """Bind every selected row without paging or parsing another native artifact."""
    choice = selected["selection"]
    artifact = choice["expected_artifact_sha256"]
    if (not isinstance(artifact, str) or len(artifact) != 64
            or any(letter not in "0123456789abcdef" for letter in artifact)):
        raise ValueError("Retain the exact original Parameter artifact SHA256")
    original_indices = None
    if original_rows is not None:
        original_indices = {_key(row): index for index, row in enumerate(original_rows)}
        if len(original_indices) != len(original_rows):
            raise ValueError("Original result repeats a case/area/pollutant key")
    archived = choice.get("source_basis") == "saved_parameter_result_archive"
    member = "original-result.json" if archived else "original-study/results.json"
    calculated, seen = [], set()
    for index, row in enumerate(rows):
        key = _key(row)
        if key in seen:
            raise ValueError("Selected reconciliation rows repeat an original identity")
        seen.add(key)
        if original_indices is not None and key not in original_indices:
            raise ValueError("Selected reconciliation row is absent from the original result")
        item = reconcile_row(row)
        item.update(
            selected_row_index=index,
            original_row_index=original_indices[key] if original_indices is not None else None,
            original_artifact_sha256=artifact,
            selected_row_pointer="selected-results.json#/rows/" + str(index),
            original_member=member,
        )
        calculated.append(item)
    return {
        "schema": SCHEMA, "edition": EDITION, "selection": deepcopy(choice),
        "source_basis": choice.get("source_basis", "saved_parameter_study"),
        "original_artifact_sha256": artifact, "original_member": member,
        "original_row_index_basis": ("original complete result array" if original_indices is not None
                                     else "not loaded; retained original row key and selected row pointer"),
        "rows": calculated, "notes": list(NOTES),
    }


def _table(columns, rows):
    return {"kind": "table", "columns": columns, "rows": rows, "widths": None}


def _show(value):
    return "Unavailable" if value is None else value


def sections(selected, rows):
    """Use the existing observed-report table/link contract, with original units."""
    packet = calculate(selected, rows)
    positions = {key: index + 1 for index, key in enumerate(selected["selection"]["case_ids"])}
    blocks = [*NOTES, {"kind": "links", "items": [
        {"title": "Complete support reconciliation and original row bindings", "path": JSON_FILE},
        {"title": "All derived support-accounting rows (CSV)", "path": CSV_FILE},
        {"title": "Exact support-accounting implementation", "path": SOURCE_FILE},
    ]}]
    result = [["Accounting for different native valid-cell support", blocks]]
    for area in selected["areas"]:
        for pollutant in selected["selection"]["pollutants"]:
            chosen = [row for row in packet["rows"]
                      if row["area_id"] == area["id"] and row["pollutant"] == pollutant]
            for offset in range(0, len(chosen), 60):
                page = chosen[offset:offset + 60]
                title = area["name"] + " / " + pollutant.replace("_export", "") + " — support accounting"
                if len(chosen) > 60:
                    title += " / rows " + str(offset + 1) + "–" + str(offset + len(page))
                result.append([title, [
                    "These are arithmetic projections of the unchanged saved rows. All mass columns "
                    "retain the stated annual mass unit. The original paired change remains authoritative.",
                    _table(["Position", "Units", "Stored paired change", "Plus case-only mass",
                            "Minus baseline-only mass", "Plus residual", "Equals own-valid full change"], [
                        [positions[row["case_id"]], row["units"], _show(row["change"]),
                         _show(row["case_only_mass_difference"]), _show(row["baseline_only_mass_difference"]),
                         _show(row["reconciliation_residual"]), _show(row["independent_full_change"])]
                        for row in page]),
                    _table(["Position", "Common cells", "Baseline-only cells", "Case-only cells",
                            "Opposite nonzero signs", "Unavailable reconciliation reason"], [
                        [positions[row["case_id"]], row["paired_valid_cells"], row["baseline_only_cells"],
                         row["case_only_cells"], _show(row["sign_reversal"]),
                         row["unavailable_reason"] or "Available"] for row in page]),
                ]])
    reversals = [row for row in packet["rows"] if row["sign_reversal"] is True]
    if reversals:
        original = {_key(row): row for row in rows}
        example = min(reversals, key=lambda row: len(original[_key(row)].get("overrides", {})))
        result.append(["Why the direction can change with the support", [
            example["case"] + " / " + example["pollutant"] + " / " + example["area"] +
            " is an original saved example. A single changed assumption is preferred when available; "
            "the selected rows and figure order are unchanged.",
            _table(["Arithmetic term", "Meaning", example["units"]], [
                ["Stored paired change", "Case minus baseline on the same valid cells", example["change"]],
                ["Plus case-only mass", "Case full total minus case paired total",
                 example["case_only_mass_difference"]],
                ["Minus baseline-only mass", "Baseline full total minus baseline paired total",
                 example["baseline_only_mass_difference"]],
                ["Plus arithmetic residual", "Preserved separate-reduction difference",
                 example["reconciliation_residual"]],
                ["Equals own-valid full change", "Case full total minus baseline full total",
                 example["independent_full_change"]],
            ]),
            _table(["Original support", "Cells", "Area (ha)"], [
                ["Common", example["paired_valid_cells"], _show(example["paired_area_ha"])],
                ["Valid only in baseline", example["baseline_only_cells"], _show(example["baseline_only_area_ha"])],
                ["Valid only in case", example["case_only_cells"], _show(example["case_only_area_ha"])],
            ]),
            "The two signs describe different supports, not conflicting model calculations. "
            "Neither summary replaces the other. These aggregate records do not identify the cause "
            "of every excluded cell, establish one common mask across all parameter cases, or "
            "turn this parameter comparison into a measured restoration benefit.",
            _table(["Original source binding", "Retained identity"], [
                ["Selected source row", example["selected_row_pointer"]],
                ["Original result SHA256", packet["original_artifact_sha256"]],
                ["Original case", example["case_id"]], ["Original run", example["run_id"]],
                ["Original profile", example["profile_id"]], ["Original area", example["area_id"]],
            ]),
        ]])
    return result


def write(directory, selected, rows, *, original_rows=None, origin_uri=""):
    """Retain complete derived projections before the existing source inventory."""
    from .common import atomic_bytes, atomic_json
    directory = Path(directory)
    packet = calculate(selected, rows, original_rows=original_rows)
    body = Path(__file__).read_bytes()
    packet["implementation"] = {
        "path": SOURCE_FILE, "bytes": len(body), "sha256": hashlib.sha256(body).hexdigest()}
    packet["origin_uri"] = origin_uri
    atomic_json(directory / JSON_FILE, packet, immutable=True)
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=CSV_FIELDS)
    writer.writeheader()
    for row in packet["rows"]:
        # Preserve numeric negatives; neutralize only textual spreadsheet formulae.
        writer.writerow({name: ("'" + row[name] if isinstance(row[name], str)
                               and row[name].startswith(("=", "+", "-", "@", "\t", "\r"))
                               else row[name]) for name in CSV_FIELDS})
    atomic_bytes(directory / CSV_FILE, stream.getvalue().encode("utf-8"), immutable=True)
    atomic_bytes(directory / SOURCE_FILE, body, immutable=True)
    return packet
