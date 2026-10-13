"""Compare completed alternatives across the retained scientific profiles.

Each constituent keeps its physical units. Alternatives are paired only within
one profile, against the same baseline and on identical valid-cell support.
"""
from __future__ import annotations

from collections import Counter
import csv
import io
import math


def _finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _comparison(left, right, pollutant):
    a, b = left.get("metrics", {}).get(pollutant), right.get("metrics", {}).get(pollutant)
    if a is None or b is None:
        return None, "constituent not complete"
    if left.get("baseline_run_id") != right.get("baseline_run_id"):
        return None, "different paired baseline"
    if not a.get("units") or a.get("units") != b.get("units"):
        return None, "different annual units"
    if (not a.get("support_sha256") or a.get("support_sha256") != b.get("support_sha256")
            or a.get("paired_cells") != b.get("paired_cells")):
        return None, "different paired valid cells"
    if not _finite(a.get("paired_cells")) or a["paired_cells"] <= 0:
        return None, "no paired valid cells"
    if any(not _finite(row.get(name)) for row in (a, b)
           for name in ("baseline_total", "alternative_total", "reduction")):
        return None, "annual quantity unavailable"
    if a["baseline_total"] != b["baseline_total"]:
        return None, "different baseline total on the reported support"
    advantage = b["alternative_total"] - a["alternative_total"]
    return {
        "pollutant": pollutant, "units": a["units"],
        "support_sha256": a["support_sha256"], "paired_cells": a["paired_cells"],
        "a_reduction": a["reduction"], "b_reduction": b["reduction"],
        "a_advantage": advantage,
        "lower_export": "a" if advantage > 0 else "b" if advantage < 0 else "equal",
    }, None


def _relation(values):
    signs = [row["a_advantage"] for row in values]
    if all(value == 0 for value in signs):
        return "equal"
    if all(value >= 0 for value in signs):
        return "a dominates"
    if all(value <= 0 for value in signs):
        return "b dominates"
    return "tradeoff"


def analyse(summary):
    """Return pairwise physical comparisons without assigning decision weights."""
    scenario_ids = list(summary.get("selection", {}).get("scenario_ids", []))
    if len(scenario_ids) != len(set(scenario_ids)):
        raise ValueError("The selected programme repeats a scenario")
    cases = [row for row in summary.get("rows", []) if row.get("kind") == "landcover"]
    profiles = sorted({row["profile_id"] for row in cases})
    expected = summary.get("counts", {}).get("profiles", len(profiles))
    names = {row["scenario_id"]: row["scenario_title"] for row in cases}
    profile_names = {row["profile_id"]: row["profile_title"] for row in cases}
    index = {}
    for row in cases:
        key = row["profile_id"], row["scenario_id"]
        if key in index:
            raise ValueError("The selected programme repeats a profile/scenario case")
        index[key] = row
    pollutants = list(summary.get("pollutants") or sorted({
        name for row in cases for name in row.get("metrics", {})
    }))
    pairs, comparisons = [], []
    for position, a_id in enumerate(scenario_ids):
        for b_id in scenario_ids[position + 1:]:
            rows, groups = [], {}
            for profile in profiles:
                a, b = index.get((profile, a_id)), index.get((profile, b_id))
                entry = {
                    "profile_id": profile, "profile": profile_names[profile],
                    "state": "unavailable", "constituents": [], "reasons": [],
                }
                if not a or not b or a.get("state") != "complete" or b.get("state") != "complete":
                    entry["reasons"].append("both alternative cases have not completed")
                else:
                    entry.update(a_run_id=a["run_id"], b_run_id=b["run_id"],
                                 baseline_run_id=a["baseline_run_id"])
                    for pollutant in pollutants:
                        value, reason = _comparison(a, b, pollutant)
                        if value is None:
                            entry["reasons"].append(pollutant + ": " + reason)
                            continue
                        value = {**value, "profile_id": profile, "profile": profile_names[profile],
                                 "a_scenario_id": a_id, "b_scenario_id": b_id,
                                 "a_scenario": names.get(a_id, a_id),
                                 "b_scenario": names.get(b_id, b_id),
                                 "a_run_id": a["run_id"], "b_run_id": b["run_id"],
                                 "baseline_run_id": a["baseline_run_id"]}
                        entry["constituents"].append(value)
                        comparisons.append(value)
                        key = pollutant, value["units"], value["support_sha256"], value["paired_cells"]
                        groups.setdefault(key, []).append(value)
                    if pollutants and len(entry["constituents"]) == len(pollutants):
                        entry["state"] = _relation(entry["constituents"])
                    elif not pollutants:
                        entry["reasons"].append("no selected constituent outputs available")
                rows.append(entry)
            counts = Counter(row["state"] for row in rows)
            compared = sum(counts[name] for name in ("a dominates", "b dominates", "equal", "tradeoff"))
            complete = compared == expected and expected > 0
            if not compared:
                response = "awaiting comparable completed alternatives"
            elif counts["a dominates"] == compared:
                response = "A dominates in every compared profile"
            elif counts["b dominates"] == compared:
                response = "B dominates in every compared profile"
            elif counts["equal"] == compared:
                response = "equal physical exports in every compared profile"
            elif counts["a dominates"] + counts["equal"] == compared:
                response = "A improves some profiles and equals the others"
            elif counts["b dominates"] + counts["equal"] == compared:
                response = "B improves some profiles and equals the others"
            else:
                response = "profile-dependent ordering or constituent tradeoff"
            support_groups = []
            for key, values in sorted(groups.items()):
                advantages = [value["a_advantage"] for value in values]
                support_groups.append({
                    "pollutant": key[0], "units": key[1],
                    "support_sha256": key[2], "paired_cells": key[3],
                    "profile_ids": [value["profile_id"] for value in values],
                    "minimum_a_advantage": min(advantages), "maximum_a_advantage": max(advantages),
                    "a_lower_export_profiles": sum(value > 0 for value in advantages),
                    "b_lower_export_profiles": sum(value < 0 for value in advantages),
                    "equal_export_profiles": sum(value == 0 for value in advantages),
                })
            pairs.append({
                "a_scenario_id": a_id, "a_scenario": names.get(a_id, a_id),
                "b_scenario_id": b_id, "b_scenario": names.get(b_id, b_id),
                "expected_profiles": expected, "compared_profiles": compared,
                "complete": complete, "response": response,
                "profile_states": dict(counts),
                "unavailable_profiles": max(0, expected - compared),
                "support_groups": support_groups, "profiles": rows,
            })
    return {
        "schema": "upstate.study-alternative-comparison/v1",
        "experiment_id": summary["id"], "workspace_id": summary["workspace_id"],
        "generated_at": summary["generated_at"], "pollutants": pollutants,
        "pairs": pairs, "comparisons": comparisons,
        "definitions": {
            "advantage": "B annual export minus A annual export, equivalent to A reduction minus B reduction under the identical baseline; positive means A has lower export.",
            "dominance": "At least one selected constituent improves and every other selected constituent is equal or improves.",
            "pairing": "Same profile and baseline, identical valid cells and annual units within each constituent.",
            "ranges": "Across selected profiles within one identical constituent support group.",
            "complete": "Every selected profile has comparable completed alternatives for all selected constituents.",
            "ordering": "Evaluated physical alternatives; implementation costs and preferences remain separate inputs.",
            "equal": "Exactly equal recorded annual alternative exports, without an added numerical tolerance.",
        },
    }


def csv_bytes(result):
    columns = (
        "a_scenario", "b_scenario", "profile", "pollutant", "units",
        "a_reduction", "b_reduction", "a_advantage", "lower_export",
        "paired_cells", "support_sha256", "profile_id",
        "a_scenario_id", "b_scenario_id", "a_run_id", "b_run_id", "baseline_run_id",
    )
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=columns, lineterminator="\n")
    writer.writeheader()
    for row in result["comparisons"]:
        values = {name: row.get(name) for name in columns}
        for name in ("a_scenario", "b_scenario", "profile"):
            value = str(values[name])
            values[name] = "'" + value if value.startswith(("=", "+", "-", "@", "\t", "\r", "\n")) else value
        writer.writerow(values)
    return output.getvalue().encode("utf-8-sig")
