"""Retain source-backed biophysical and native parameter choices as profiles.

Copyright TokenJunkieLabs. The existing model.experiments engine consumes the
returned profile_ids and owns native execution, paired comparisons and reports.
"""
from __future__ import annotations
import argparse
import copy
import csv
import hashlib
import io
import itertools
import json
from pathlib import Path
import sys
from .common import (INVEST_VERSION, atomic_bytes, atomic_json, canonical,
                     describe_file, digest, file_digest, finite, held, identifier,
                     now, read_json, relative_file, selected_models)
from .profiles import checked_parameters, inspect_table

PROFILE_SET_SCHEMA = "upstate.sourced-experiment-profiles/v1"
SOURCE_ROOT = (
    "https://storage.googleapis.com/releases.naturalcapitalproject.org/"
    "invest/3.20.0/userguide/en/"
)
NDR_REFERENCE = SOURCE_ROOT + "ndr.html"
SDR_REFERENCE = SOURCE_ROOT + "sdr.html"

# Physical constraints are the same as the selected native profile validator.
# Levels are explicit operator choices; the catalogue supplies no regional range.
PARAMETERS = {
    "ndr.threshold_flow_accumulation": {
        "label": "NDR stream threshold", "units": "upstream pixels",
        "minimum": 0, "exclusive_minimum": True, "reference": NDR_REFERENCE,
        "description": "Stream initiation threshold; changing it can change output coverage."},
    "ndr.k_param": {
        "label": "NDR connectivity response", "units": "dimensionless",
        "minimum": 0, "exclusive_minimum": True, "reference": NDR_REFERENCE,
        "description": "Shape of nutrient delivery response to hydrologic connectivity."},
    "ndr.flow_dir_algorithm": {
        "label": "NDR flow routing", "units": "method",
        "choices": ["mfd", "d8"], "reference": NDR_REFERENCE,
        "description": "Native multiple-flow or single-flow routing."},
    "ndr.subsurface_critical_length_n": {
        "label": "Nitrogen subsurface retention length", "units": "m",
        "minimum": 0, "exclusive_minimum": True, "reference": NDR_REFERENCE,
        "description": "Length controlling the native subsurface retention function."},
    "ndr.subsurface_eff_n": {
        "label": "Nitrogen subsurface retention efficiency", "units": "ratio",
        "minimum": 0, "maximum": 1, "reference": NDR_REFERENCE,
        "description": "Maximum subsurface retention fraction."},
    "ndr.runoff_proxy_av": {
        "label": "NDR runoff normalization average", "units": "runoff-proxy units",
        "nullable": True,
        "minimum": 0, "exclusive_minimum": True, "reference": NDR_REFERENCE,
        "description": "Explicit normalization average, when selected in the profile."},
    "sdr.threshold_flow_accumulation": {
        "label": "SDR stream threshold", "units": "upstream pixels",
        "minimum": 0, "exclusive_minimum": True, "reference": SDR_REFERENCE,
        "description": "Stream initiation threshold; changing it can change output coverage."},
    "sdr.k_param": {
        "label": "SDR connectivity response", "units": "dimensionless",
        "minimum": 0, "exclusive_minimum": True, "reference": SDR_REFERENCE,
        "description": "Shape of sediment delivery response to hydrologic connectivity."},
    "sdr.flow_dir_algorithm": {
        "label": "SDR flow routing", "units": "method",
        "choices": ["mfd", "d8"], "reference": SDR_REFERENCE,
        "description": "Native multiple-flow or single-flow routing."},
    "sdr.sdr_max": {
        "label": "Maximum sediment delivery ratio", "units": "ratio",
        "minimum": 0, "maximum": 1, "reference": SDR_REFERENCE,
        "description": "Upper limit of the native delivery ratio."},
    "sdr.ic_0_param": {
        "label": "SDR connectivity midpoint", "units": "dimensionless",
        "reference": SDR_REFERENCE,
        "description": "Midpoint of the sediment connectivity response."},
    "sdr.l_max": {
        "label": "Maximum RUSLE L factor", "units": "dimensionless",
        "minimum": 0, "exclusive_minimum": True, "reference": SDR_REFERENCE,
        "description": "Upper limit applied to the L parameter in the native LS factor."},
}
for _name, _label, _units, _reference, _minimum, _maximum, _exclusive in (
    ("load_n", "Nitrogen load", "kg/ha/year", NDR_REFERENCE, 0, None, False),
    ("load_p", "Phosphorus load", "kg/ha/year", NDR_REFERENCE, 0, None, False),
    ("eff_n", "Nitrogen retention efficiency", "ratio", NDR_REFERENCE, 0, 1, False),
    ("eff_p", "Phosphorus retention efficiency", "ratio", NDR_REFERENCE, 0, 1, False),
    ("crit_len_n", "Nitrogen retention length", "m", NDR_REFERENCE, 0, None, True),
    ("crit_len_p", "Phosphorus retention length", "m", NDR_REFERENCE, 0, None, True),
    ("proportion_subsurface_n", "Subsurface nitrogen fraction", "ratio", NDR_REFERENCE, 0, 1, False),
    ("usle_c", "Land-cover erosion factor C", "dimensionless", SDR_REFERENCE, 0, 1, False),
    ("usle_p", "Erosion management factor P", "dimensionless", SDR_REFERENCE, 0, 1, False),
):
    PARAMETERS["table." + _name] = {
        "label": _label, "units": _units, "reference": _reference,
        "minimum": _minimum, "exclusive_minimum": _exclusive,
        "description": "Applied only to the selected original land-cover codes.",
    }
    if _maximum is not None:
        PARAMETERS["table." + _name]["maximum"] = _maximum
for _name in ("load_type_n", "load_type_p"):
    PARAMETERS["table." + _name] = {
        "label": "Nitrogen load basis" if _name.endswith("_n") else "Phosphorus load basis",
        "units": "method", "reference": NDR_REFERENCE,
        "choices": ["application-rate", "measured-runoff"],
        "description": "Native nutrient load interpretation for selected land-cover codes.",
    }


def _text(value, label):
    if not isinstance(value, str) or not value.strip():
        raise ValueError(label + " must be nonempty text")
    return value.strip()


def _refs(value):
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list) or not value:
        raise ValueError("Each level needs its actual source references")
    return list(dict.fromkeys(_text(v, "Source reference") for v in value))


def _value(target, value):
    rule = PARAMETERS[target]
    if target == "ndr.runoff_proxy_av" and value is None:
        return None
    if "choices" in rule:
        if value not in rule["choices"]:
            raise ValueError(target + " must be one of " + ", ".join(rule["choices"]))
        return value
    value = finite(value, target, minimum=rule.get("minimum"),
                   positive=rule.get("exclusive_minimum", False))
    if rule.get("maximum") is not None and value > rule["maximum"]:
        raise ValueError(target + " exceeds its physical upper limit")
    return value


def _base(workspace, profile_id):
    """Read original retained objects; preview creates no files or profiles."""
    profile = workspace._get("profiles", identifier(profile_id))
    checked_parameters(profile)
    collection = workspace._get("sources", profile["source_collection_id"])
    entries = [entry for entry in collection["entries"]
               if entry["id"] == profile["biophysical_source_id"]]
    if len(entries) != 1 or entries[0]["kind"] != "table":
        raise ValueError("The baseline profile needs its retained biophysical CSV")
    entry = entries[0]
    body = entry["body"]
    path = relative_file(workspace.root, body["object"])
    if path.stat().st_size != body["bytes"] or file_digest(path) != body["sha256"]:
        raise ValueError("The original biophysical source changed")
    table = inspect_table(path, selected_models=selected_models(profile))
    if profile["table_summary"]["sha256"] != body["sha256"]:
        raise ValueError("The baseline profile refers to a different biophysical edition")
    return profile, entry, table


def _target_model(target):
    domain, name = target.split(".", 1)
    if domain == "table":
        return "sdr" if name in ("usle_c", "usle_p") else "ndr"
    return domain


def catalog(workspace=None, baseline_profile_id=None):
    result = {
        "schema": "upstate.experiment-profile-catalog/v1",
        "invest_version": INVEST_VERSION,
        "parameters": [{"target": key, **copy.deepcopy(value)}
                       for key, value in PARAMETERS.items()],
        "designs": ["one_at_a_time", "factorial"],
    }
    if workspace is not None and baseline_profile_id is not None:
        profile, entry, table = _base(workspace, baseline_profile_id)
        active = selected_models(profile)
        result["parameters"] = [item for item in result["parameters"]
                                if _target_model(item["target"]) in active]
        result.update(
            baseline_profile_id=profile["id"],
            biophysical_source_id=entry["id"],
            biophysical_sha256=entry["body"]["sha256"],
            lucodes=table["lucodes"],
            table_rows=table["rows"],
            baseline_parameters={model: profile[model] for model in active},
            models=active,
        )
    return result


def _normalise(workspace, spec):
    if not isinstance(spec, dict):
        raise ValueError("Provide the source-backed profile selection as an object")
    allowed = {"title", "reason", "baseline_profile_id", "design", "factors"}
    if set(spec) - allowed:
        raise ValueError("Unknown source-backed profile fields")
    clean = {
        "title": _text(spec.get("title"), "Profile set title"),
        "reason": _text(spec.get("reason"), "Profile set purpose"),
        "baseline_profile_id": identifier(spec["baseline_profile_id"]),
        "design": spec.get("design", "one_at_a_time"),
    }
    if clean["design"] not in ("one_at_a_time", "factorial"):
        raise ValueError("Select one_at_a_time or factorial")
    base, entry, table = _base(workspace, clean["baseline_profile_id"])
    active = selected_models(base)
    by_code = {int(row["lucode"]): row for row in table["rows"]}
    factors = spec.get("factors", [])
    if not isinstance(factors, list):
        raise ValueError("Factors must be a list")
    selected, occupied = [], set()
    for factor in factors:
        if not isinstance(factor, dict) or set(factor) - {"name", "target", "lucodes", "levels"}:
            raise ValueError("Each factor needs name, target, levels and table lucodes where applicable")
        target = factor.get("target")
        if not isinstance(target, str) or target not in PARAMETERS:
            raise ValueError("Select a supported native parameter or biophysical column")
        if _target_model(target) not in active:
            raise ValueError("A source factor selects a model outside the retained baseline scope: " + target)
        value = {"name": _text(factor.get("name") or PARAMETERS[target]["label"], "Factor name"),
                 "target": target, "levels": []}
        if target.startswith("table."):
            codes = factor.get("lucodes")
            if not isinstance(codes, list) or not codes or any(type(v) is not int for v in codes):
                raise ValueError("Table factors select existing integer lucodes")
            value["lucodes"] = sorted(set(codes))
            if set(codes) - set(by_code):
                raise ValueError("A selected lucode is absent from the original table")
            cells = {(target, code) for code in codes}
        else:
            if factor.get("lucodes"):
                raise ValueError("An algorithm parameter does not select lucodes")
            cells = {(target, None)}
        if occupied & cells:
            raise ValueError("Two factors change the same parameter cell")
        occupied |= cells
        levels = factor.get("levels")
        if not isinstance(levels, list) or not levels:
            raise ValueError("Supply explicit source-backed factor levels")
        for level in levels:
            if not isinstance(level, dict) or set(level) - {"label", "value", "references", "reason"}:
                raise ValueError("Each level needs value, references and reason")
            if "value" not in level:
                raise ValueError("Supply the factor level value")
            actual = _value(target, level["value"])
            value["levels"].append({
                "label": _text(level.get("label", str(actual)), "Level label"),
                "value": actual, "references": _refs(level.get("references")),
                "reason": _text(level.get("reason"), "Level scientific rationale"),
            })
        selected.append(value)
    clean["factors"] = selected
    canonical(clean)
    return clean, base, entry, table


def _change(factor, level, base, rows):
    target = factor["target"]
    domain, name = target.split(".", 1)
    common = {"target": target, "name": factor["name"], "label": level["label"],
              "value": level["value"], "references": level["references"],
              "reason": level["reason"], "units": PARAMETERS[target]["units"]}
    if domain == "table":
        values = {str(code): _value(target, rows[code][name]) for code in factor["lucodes"]}
        codes = [code for code in factor["lucodes"] if values[str(code)] != level["value"]]
        return ({**common, "before": values, "lucodes": codes,
                 "selected_lucodes": factor["lucodes"]} if codes else None)
    before = base[domain].get(name)
    before = _value(target, before) if before is not None else None
    return {**common, "before": before} if before != level["value"] else None


def _configurations(spec, base, table):
    by_code = {int(row["lucode"]): row for row in table["rows"]}
    factors = spec["factors"]
    candidates = itertools.chain([[]], (
        ([(factor, level)] for factor in factors for level in factor["levels"])
        if spec["design"] == "one_at_a_time" else
        (list(zip(factors, levels))
         for levels in itertools.product(*(factor["levels"] for factor in factors)))
    ))
    records, observed = [], {}
    for candidate in candidates:
        changes = [change for factor, level in candidate
                   if (change := _change(factor, level, base, by_code)) is not None]
        science = sorted(
            [{"target": change["target"], "lucodes": change.get("lucodes"),
              "value": change["value"]} for change in changes],
            key=lambda change: (change["target"], change["lucodes"] or []))
        key = digest(science)
        choices = [{**copy.deepcopy(level), "target": factor["target"],
                    "name": factor["name"], "lucodes": factor.get("lucodes")}
                   for factor, level in candidate]
        if key in observed:
            observed[key]["equivalent_choices"].append(choices)
            continue
        value = {
            "configuration_id": key,
            "label": "; ".join(change["name"] + " = " + change["label"] for change in changes)
                     or "Original parameters",
            "changes": changes, "equivalent_choices": [choices],
            "is_baseline": not changes,
        }
        records.append(value)
        observed[key] = value
    return records


def preview(workspace, spec):
    clean, base, entry, table = _normalise(workspace, spec)
    identity = {
        "schema": PROFILE_SET_SCHEMA, "workspace_id": workspace.project["id"],
        "spec": clean, "baseline_profile_id": base["id"],
        "baseline_table_sha256": entry["body"]["sha256"],
        "invest_version": INVEST_VERSION,
    }
    choices = _configurations(clean, base, table)
    return {
        **identity, "id": digest(identity),
        "configurations": choices, "profile_count": len(choices),
        "derived_profile_count": sum(not value["is_baseline"] for value in choices),
        "source_table": {"id": entry["id"], "uri": entry["uri"],
                         "vintage": entry["vintage"], "sha256": entry["body"]["sha256"]},
        "state": "preview",
    }


def _references(base, config):
    selected = copy.deepcopy(base.get("references", []))
    if not isinstance(selected, list):
        selected = [selected]
    for choices in config["equivalent_choices"]:
        for choice in choices:
            selected.extend(choice["references"])
            selected.append(PARAMETERS[choice["target"]]["reference"])
    result, seen = [], set()
    for reference in selected:
        token = canonical(reference)
        if token not in seen:
            seen.add(token)
            result.append(reference)
    return result


def _working_profile(base, profile_set, config):
    result = copy.deepcopy(base)
    # The parent's original scientific status remains with its immutable ID.
    # A changed table/parameter choice is a working profile and runs normally.
    for name in (
        "id", "schema", "table_summary", "approved", "approved_at", "approved_by",
        "approval", "approvals", "scientific_approval", "scientific_signoff",
        "review_status", "calibration_results", "calibration_status",
    ):
        result.pop(name, None)
    result.update(
        title=profile_set["spec"]["title"] + " / " + config["label"],
        status="working", scientific_status="working",
        references=_references(base, config),
        experiment_derivation={
            "base_profile_id": base["id"], "profile_set_id": profile_set["id"],
            "configuration_id": config["configuration_id"],
            "parameters": copy.deepcopy(config["changes"]),
            "equivalent_choices": copy.deepcopy(config["equivalent_choices"]),
        },
    )
    for change in config["changes"]:
        domain, name = change["target"].split(".", 1)
        if domain == "table":
            continue
        if domain == "ndr" and name == "runoff_proxy_av" and change["value"] is None:
            result[domain].pop(name, None)
        else:
            result[domain][name] = change["value"]
    result.update(checked_parameters(result))
    return result


def _derive_table(workspace, directory, base, entry, table, profile_set, config):
    changes = [change for change in config["changes"] if change["target"].startswith("table.")]
    if not changes:
        return None
    folder = directory / "tables" / config["configuration_id"]
    folder.mkdir(parents=True, exist_ok=True)
    rows = copy.deepcopy(table["rows"])
    by_code = {int(row["lucode"]): row for row in rows}
    lineage = []
    for change in changes:
        column = change["target"].split(".", 1)[1]
        for code in change["lucodes"]:
            before = by_code[code][column]
            after = str(change["value"])
            by_code[code][column] = after
            lineage.append({
                "lucode": code, "column": column,
                "before_numeric_or_category": change["before"][str(code)],
                "before_original_text": before, "after_text": after,
                "value": change["value"], "units": change["units"],
                "references": change["references"], "reason": change["reason"],
            })
    out = io.StringIO(newline="")
    writer = csv.DictWriter(out, fieldnames=table["columns"], lineterminator="\n")
    writer.writeheader()
    writer.writerows(rows)
    body = out.getvalue().encode("utf-8")
    sha = hashlib.sha256(body).hexdigest()
    csv_path = folder / "biophysical.csv"
    atomic_bytes(csv_path, body, immutable=True)
    inspect_table(csv_path, selected_models=selected_models(base))
    provenance = {
        "schema": "upstate.biophysical-derivation/v1",
        "profile_set_id": profile_set["id"],
        "configuration_id": config["configuration_id"],
        "base_profile_id": base["id"],
        "original_source_collection_id": base["source_collection_id"],
        "original_source_id": entry["id"], "original_uri": entry["uri"],
        "original_vintage": entry["vintage"], "original_sha256": entry["body"]["sha256"],
        "derived_sha256": sha, "changes": lineage,
        "equivalent_choices": config["equivalent_choices"],
        "unchanged_fields": "Original column order, row order and untouched cell text are retained.",
    }
    atomic_json(folder / "lineage.json", provenance, immutable=True)
    manifest = {
        "schema": "upstate.sources/v1",
        "title": profile_set["spec"]["title"] + " / " + config["label"],
        "notes": [profile_set["spec"]["reason"], "Derived from retained original CSV; cell lineage is included."],
        "entries": [{
            "id": "experiment-biophysical", "kind": "table",
            "title": config["label"], "path": "biophysical.csv", "sha256": sha,
            "uri": "urn:upstate:derived-biophysical:" + sha,
            "vintage": "Derived choice from " + entry["vintage"],
            "units": "per-column; original table and lineage",
            "companions": [{"path": "lineage.json"}],
            "derivation": provenance,
        }],
    }
    atomic_json(folder / "source-manifest.json", manifest, immutable=True)
    collection = workspace.import_sources(folder / "source-manifest.json")
    return {
        "source_collection_id": collection["id"],
        "biophysical_source_id": "experiment-biophysical",
        "table_sha256": sha, "lineage": provenance,
        "files": {
            "table": describe_file(directory, csv_path),
            "lineage": describe_file(directory, folder / "lineage.json"),
            "manifest": describe_file(directory, folder / "source-manifest.json"),
        },
    }


def materialize(workspace, spec):
    """Save native-compatible profiles and sources, without starting model runs."""
    proposed = preview(workspace, spec)
    clean, base, entry, table = _normalise(workspace, proposed["spec"])
    directory = workspace.root / "sourced-profiles" / proposed["id"]
    directory.mkdir(parents=True, exist_ok=True)
    with held(directory / ".profiles.lock", blocking=False):
        definition_path = directory / "selection.json"
        atomic_json(definition_path, proposed, immutable=True)
        state_path = directory / "state.json"
        state = read_json(state_path) if state_path.exists() else {
            "schema": PROFILE_SET_SCHEMA, "id": proposed["id"],
            "workspace_id": workspace.project["id"], "state": "preparing",
            "created_at": now(), "profiles": [], "files": {},
        }
        if state["id"] != proposed["id"] or state["workspace_id"] != workspace.project["id"]:
            raise ValueError("Retained profile preparation belongs to another selection")
        completed = {value["configuration_id"]: value for value in state["profiles"]}
        state.update(state="preparing", updated_at=now())
        state.pop("error", None)
        atomic_json(state_path, state)
        try:
            for config in proposed["configurations"]:
                prior = completed.get(config["configuration_id"])
                if prior:
                    profile_path = workspace.root / "profiles" / (prior["profile_id"] + ".json")
                    if profile_path.exists():
                        workspace._get("profiles", prior["profile_id"])
                        continue
                    # Reconstruct a missing retained profile from the same
                    # immutable selection and source lineage, retaining its ID.
                derived = None
                if config["is_baseline"]:
                    profile = base
                else:
                    payload = _working_profile(base, proposed, config)
                    derived = _derive_table(workspace, directory, base, entry, table, proposed, config)
                    if derived:
                        payload["source_collection_id"] = derived["source_collection_id"]
                        payload["biophysical_source_id"] = derived["biophysical_source_id"]
                        payload["experiment_derivation"]["biophysical"] = derived["lineage"]
                    profile = workspace.save_profile(payload)
                if prior and profile["id"] != prior["profile_id"]:
                    raise ValueError("Reconstructed profile differs from its retained native identity")
                item = {
                    "configuration_id": config["configuration_id"],
                    "profile_id": profile["id"], "title": profile["title"],
                    "is_baseline": config["is_baseline"], "changes": config["changes"],
                    "biophysical_sha256": profile["table_summary"]["sha256"],
                }
                if derived:
                    item["source_collection_id"] = derived["source_collection_id"]
                    item["files"] = derived["files"]
                state["profiles"] = [
                    value for value in state["profiles"]
                    if value["configuration_id"] != config["configuration_id"]]
                state["profiles"].append(item)
                completed[config["configuration_id"]] = item
                state["updated_at"] = now()
                atomic_json(state_path, state)
            # Always return original design order after an interrupted resume.
            state["profiles"] = [completed[c["configuration_id"]] for c in proposed["configurations"]]
            state["profile_ids"] = [value["profile_id"] for value in state["profiles"] if not value["is_baseline"]]
            state["all_profile_ids"] = [value["profile_id"] for value in state["profiles"]]
            state.update(state="complete", completed_at=state.get("completed_at") or now(),
                         updated_at=now())
            state["files"]["selection"] = describe_file(directory, definition_path)
            atomic_json(state_path, state)
            return state
        except BaseException as exc:
            state.update(state="failed", updated_at=now(),
                         error={"type": type(exc).__name__, "message": str(exc)})
            atomic_json(state_path, state)
            raise


def selection_with_profiles(workspace, selection, profile_spec):
    """Compose the sourced profiles into the existing experiment engine selection.

    All scalar/table factors in profile_spec expand together before the native
    experiment is prepared. Existing scalar axes are rejected here if also set:
    callers include those axes in profile_spec to retain a coherent design.
    """
    from . import experiments
    selected = copy.deepcopy(selection)
    normalized, baseline, _, _ = experiments._normalise(workspace, selected)
    if normalized["axes"]:
        raise ValueError("Put combined scalar/table factors in profile_spec; leave selection.axes empty")
    if profile_spec.get("baseline_profile_id") != baseline["selection"]["profile_id"]:
        raise ValueError("Source choices must use the selected experiment baseline profile")
    result = materialize(workspace, profile_spec)
    selected["profile_ids"] = list(dict.fromkeys(normalized["profile_ids"] + result["profile_ids"]))
    selected["axes"] = []
    selected["design"] = profile_spec.get("design", "one_at_a_time")
    normalized, _, _, _ = experiments._normalise(workspace, selected)
    return {"selection": normalized, "profile_set": result}


def main(argv=None):
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    cat = commands.add_parser("catalog")
    cat.add_argument("--baseline-profile")
    for name in ("preview", "materialize"):
        command = commands.add_parser(name)
        command.add_argument("--spec", type=Path, required=True)
    compose = commands.add_parser("compose")
    compose.add_argument("--selection", type=Path, required=True)
    compose.add_argument("--spec", type=Path, required=True)
    compose.add_argument("--output", type=Path, required=True)
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    try:
        if args.command == "catalog":
            result = catalog(workspace, args.baseline_profile)
        elif args.command == "compose":
            result = selection_with_profiles(workspace, read_json(args.selection), read_json(args.spec))
            atomic_json(args.output, result["selection"], immutable=True)
        else:
            result = globals()[args.command](workspace, read_json(args.spec))
        print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
        return 0
    except (ValueError, KeyError, OSError, RuntimeError) as exc:
        print(json.dumps({"state": "failed", "type": type(exc).__name__, "message": str(exc)}),
              file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
