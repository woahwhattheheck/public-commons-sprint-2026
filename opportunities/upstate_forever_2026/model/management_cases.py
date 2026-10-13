"""Named land-management cases on the original sourced-profile/native experiment engines."""
from __future__ import annotations

import copy
import json
from pathlib import Path

from . import experiment_profiles as sourced
from .common import canonical, digest, identifier, read_json, selected_models

KIND = "management-cases"
CATEGORIES = {
    "nutrient_load": ("load_n", "load_p", "proportion_subsurface_n"),
    "cover_support": ("usle_c", "usle_p"),
    "retention": ("eff_n", "eff_p", "crit_len_n", "crit_len_p"),
}
METHODS = {
    "scope": "A changed coefficient applies to every selected land-cover code in the modeled domain. "
             "Use a retained land-cover scenario to represent an actual mapped intervention area.",
    "load_basis": "Keep each original application-rate or measured-runoff tag. Native NDR applies "
                  "load * (1 - efficiency) to application rates; changing efficiency also changes "
                  "that source term. Measured-runoff loads enter directly.",
    "source_control": "For a controlled retention comparison, hold_effective_source explicitly adjusts "
                      "application-rate loads when efficiency changes. In a combined loading case it preserves "
                      "that selected load's effective source at the original efficiency. Measured-runoff "
                      "values remain direct. Nitrogen surface/subsurface proportions remain the selected inputs.",
    "values": "Enter absolute model coefficients in their original units. Fertilizer application, "
              "observed runoff, erosion measurements and whole-buffer removal are distinct quantities.",
    "design": "Every named practice runs separately. Explicit named combinations contain the selected "
              "practices together. Conflicting edits to a coefficient require a separate resolved practice.",
    "interpretation": "Native experiments retain annual delivery to streams: nitrogen/phosphorus kg/year "
                      "and sediment tonnes/year. Source-input changes are not observed treatment outcomes.",
    "native_guides": [sourced.NDR_REFERENCE, sourced.SDR_REFERENCE],
}


def _object(value, fields, label):
    if not isinstance(value, dict) or set(value) - set(fields):
        raise ValueError(label + " requires these fields: " + ", ".join(fields))
    return value


def _text(value, label):
    return sourced._text(value, label)


def _source(value):
    value = _object(value, ("title", "uri", "locator", "period", "applicability"), "Coefficient source")
    return {key: _text(value.get(key), "Source " + key) for key in
            ("title", "uri", "locator", "applicability")} | {
                "period": str(value.get("period") or "").strip()}


def catalog(workspace, profile_id):
    original = sourced.catalog(workspace, profile_id)
    return {
        **original, "categories": [
            {"id": name, "parameters": [p for p in fields
             if "table." + p in {row["target"] for row in original["parameters"]}]}
            for name, fields in CATEGORIES.items()],
        "methods": METHODS,
        "saved": [{"id": record["id"], "title": record["selection"]["title"],
                   "profile_count": len(record["profiles"]), "profile_ids": record["profile_ids"]}
                  for record in workspace._list(KIND)
                  if record["baseline_profile_id"] == profile_id],
    }


def _hold_effective_source(factors, selected, rows):
    """Explicit experimental control, retaining load tags and all derived input lineage."""
    result = copy.deepcopy(factors)
    indexed = {(factor["lucodes"][0], factor["target"]): factor for factor in result}
    for change in selected:
        field, code = change["parameter"], change["lucode"]
        if field not in ("eff_n", "eff_p"):
            continue
        nutrient = field[-1]
        if rows[code]["load_type_" + nutrient].strip() != "application-rate":
            continue
        before_eff = float(rows[code][field])
        after_eff = indexed[(code, "table." + field)]["levels"][0]["value"]
        if after_eff == before_eff:
            continue
        load_target = "table.load_" + nutrient
        prior = indexed.get((code, load_target))
        chosen_load = prior["levels"][0]["value"] if prior else float(rows[code]["load_" + nutrient])
        effective = chosen_load * (1 - before_eff)
        if after_eff == 1:
            if effective != 0:
                raise ValueError("A retention efficiency of one cannot preserve a positive application-rate source")
            adjusted = chosen_load
        else:
            adjusted = effective / (1 - after_eff)
        adjusted = sourced._value(load_target, adjusted)
        explanation = ("Controlled retention comparison: preserve the effective total nutrient source "
                       "before runoff normalization and N pathway splitting. Raw application load = "
                       "selected unadjusted load * (1 - original efficiency) / (1 - selected efficiency). "
                       "This derived experimental input is not a new observed fertilizer application.")
        if prior:
            prior["levels"][0].update(value=adjusted, label=str(adjusted))
            prior["levels"][0]["references"] = list(dict.fromkeys(
                prior["levels"][0]["references"] + [sourced.NDR_REFERENCE]))
            prior["levels"][0]["reason"] += " " + explanation
        else:
            factor = {"name": "Hold effective " + nutrient.upper() + " source / " + str(code),
                      "target": load_target, "lucodes": [code],
                      "levels": [{"label": str(adjusted), "value": adjusted,
                                  "references": [sourced.NDR_REFERENCE, change["source"]["uri"]],
                                  "reason": explanation}]}
            result.append(factor)
            indexed[(code, load_target)] = factor
    return result


def _normalise(workspace, selection):
    value = _object(selection, ("title", "reason", "baseline_profile_id", "expected_table_sha256",
                                "practices", "combinations"), "Management selection")
    base, entry, table = sourced._base(workspace, identifier(value.get("baseline_profile_id")))
    if value.get("expected_table_sha256") != entry["body"]["sha256"]:
        raise ValueError("The selected original table changed; reopen its retained coefficient edition")
    by_code = {int(row["lucode"]): row for row in table["rows"]}
    active = selected_models(base)
    clean = {
        "title": _text(value.get("title"), "Management design title"),
        "reason": _text(value.get("reason"), "Management purpose"),
        "baseline_profile_id": base["id"], "expected_table_sha256": entry["body"]["sha256"],
        "practices": [], "combinations": [],
    }
    practices = value.get("practices")
    if not isinstance(practices, list) or not practices:
        raise ValueError("Add at least one explicit management practice")
    keys, names, cases, by_key = set(), set(), [], {}
    for practice in practices:
        practice = _object(practice, ("key", "name", "category", "reason", "source_mode", "changes"), "Management practice")
        key, name = _text(practice.get("key"), "Practice key"), _text(practice.get("name"), "Practice name")
        if key in keys or name in names:
            raise ValueError("Practice keys and names must be distinct")
        keys.add(key)
        names.add(name)
        category = practice.get("category")
        if category not in CATEGORIES:
            raise ValueError("Choose nutrient_load, cover_support or retention")
        reason = _text(practice.get("reason"), "Practice purpose and assumptions")
        source_mode = practice.get("source_mode", "coupled")
        if source_mode not in ("coupled", "hold_effective_source"):
            raise ValueError("Select coupled management or hold_effective_source")
        if category != "retention" and source_mode != "coupled":
            raise ValueError("Source holding applies only to the retention practice")
        changes = practice.get("changes")
        if not isinstance(changes, list) or not changes:
            raise ValueError("A practice needs its actual changed coefficient cells")
        occupied, selected, factors = set(), [], []
        for change in changes:
            change = _object(change, ("lucode", "parameter", "value", "units", "load_type", "source"),
                             "Management coefficient")
            code, field = change.get("lucode"), change.get("parameter")
            if type(code) is not int or code not in by_code:
                raise ValueError("Select an integer land-cover code from the original table")
            if field not in CATEGORIES[category] or sourced._target_model("table." + field) not in active:
                raise ValueError("The coefficient must belong to this practice and selected native model")
            cell = (code, field)
            if cell in occupied:
                raise ValueError("A practice changes a coefficient cell only once")
            occupied.add(cell)
            rule = sourced.PARAMETERS["table." + field]
            if change.get("units") != rule["units"]:
                raise ValueError("Keep original model units for " + field + ": " + rule["units"])
            basis = by_code[code]["load_type_" + field[-1]].strip() if field in ("load_n", "load_p") else ""
            if (change.get("load_type") or "") != basis:
                raise ValueError("Keep the original nutrient load basis for this selected cell")
            amount = sourced._value("table." + field, change.get("value"))
            source = _source(change.get("source"))
            row = {"lucode": code, "parameter": field, "value": amount,
                   "units": rule["units"], "load_type": basis, "source": source}
            selected.append(row)
            citation = source["title"] + " | " + source["uri"] + " | " + source["locator"]
            if source["period"]:
                citation += " | " + source["period"]
            factors.append({"name": name + " / " + field + " / " + str(code),
                            "target": "table." + field, "lucodes": [code],
                            "levels": [{"label": str(amount), "value": amount,
                                        "references": [citation],
                                        "reason": reason + " Applicability: " + source["applicability"]}]})
        normalized = {"key": key, "name": name, "category": category,
                      "reason": reason, "source_mode": source_mode, "changes": selected}
        clean["practices"].append(normalized)
        case = {"name": name, "reason": reason, "factors": factors}
        by_key[key] = case
        retained = copy.deepcopy(case)
        if source_mode == "hold_effective_source":
            retained["factors"] = _hold_effective_source(retained["factors"], selected, by_code)
        cases.append(retained)
    combinations = value.get("combinations", [])
    if not isinstance(combinations, list):
        raise ValueError("Explicit combinations must be a list")
    seen_combinations = set()
    for combination in combinations:
        combination = _object(combination, ("name", "reason", "practice_keys"), "Management combination")
        name = _text(combination.get("name"), "Combination name")
        if name in names:
            raise ValueError("Every single and combined case needs a distinct name")
        names.add(name)
        reason = _text(combination.get("reason"), "Combination purpose")
        chosen = combination.get("practice_keys")
        if (not isinstance(chosen, list) or len(chosen) < 2
                or any(not isinstance(key, str) or key not in by_key for key in chosen)
                or len(set(chosen)) != len(chosen)):
            raise ValueError("A combination selects at least two distinct existing practices")
        token = tuple(sorted(chosen))
        if token in seen_combinations:
            raise ValueError("This combination of practices is already present")
        seen_combinations.add(token)
        factors, cells = [], set()
        for key in chosen:
            for factor in by_key[key]["factors"]:
                selected_cell = (factor["target"], factor["lucodes"][0])
                if selected_cell in cells:
                    raise ValueError("Combined practices overlap a coefficient cell; supply one explicit resolved choice")
                cells.add(selected_cell)
                factors.append(copy.deepcopy(factor))
        clean["combinations"].append({"name": name, "reason": reason, "practice_keys": list(chosen)})
        retained_cells = [change for practice in clean["practices"]
                          if practice["key"] in chosen and practice["source_mode"] == "hold_effective_source"
                          for change in practice["changes"]]
        factors = _hold_effective_source(factors, retained_cells, by_code)
        cases.append({"name": name, "reason": reason, "factors": factors})
    spec = {"title": clean["title"], "reason": clean["reason"],
            "baseline_profile_id": base["id"], "design": "explicit_cases", "cases": cases}
    return clean, spec, base, entry, table


def preview(workspace, selection):
    clean, spec, base, entry, table = _normalise(workspace, selection)
    proposed = sourced.preview(workspace, spec)
    rows = {int(row["lucode"]): row for row in table["rows"]}
    effects = []
    for config in proposed["configurations"]:
        if config["is_baseline"] and not config.get("management_cases"):
            continue
        modified = copy.deepcopy(rows)
        for change in config["changes"]:
            field = change["target"].split(".", 1)[1]
            for code in change["lucodes"]:
                modified[code][field] = str(change["value"])
        coupled = []
        for code, before in rows.items():
            after = modified[code]
            for nutrient in ("n", "p") if "ndr" in selected_models(base) else ():
                load, efficiency, basis = "load_" + nutrient, "eff_" + nutrient, before["load_type_" + nutrient].strip()
                if before[load] == after[load] and before[efficiency] == after[efficiency]:
                    continue
                raw_before, raw_after = float(before[load]), float(after[load])
                eff_before, eff_after = float(before[efficiency]), float(after[efficiency])
                coupled.append({
                    "lucode": code, "nutrient": nutrient, "load_type": basis,
                    "load_before": raw_before, "load_after": raw_after,
                    "efficiency_before": eff_before, "efficiency_after": eff_after,
                    "on_pixel_source_before": raw_before * (1 - eff_before) if basis == "application-rate" else raw_before,
                    "on_pixel_source_after": raw_after * (1 - eff_after) if basis == "application-rate" else raw_after,
                    "units": "kg/ha/year",
                    "meaning": "Native load-basis input before runoff normalization and delivery routing",
                })
        effects.append({"configuration_id": config["configuration_id"], "name": config["label"],
                        "management_cases": config.get("management_cases", []),
                        "changes": config["changes"], "unchanged_from_baseline": config["is_baseline"],
                        "nutrient_source_terms": coupled})
    return {"selection": clean, "profile_spec": spec, "profile_preview": proposed,
            "cases": effects, "methods": METHODS, "models": selected_models(base)}


def prepare(workspace, selection):
    proposed = preview(workspace, selection)
    profiles = sourced.materialize(workspace, proposed["profile_spec"])
    return workspace._save(KIND, {
        "workspace_id": workspace.project["id"], "baseline_profile_id": proposed["selection"]["baseline_profile_id"],
        "selection": proposed["selection"], "profile_set_id": profiles["id"],
        "profiles": profiles["profiles"], "profile_ids": profiles["profile_ids"],
        "cases": proposed["cases"], "methods": METHODS,
    })


def inspect(workspace, case_id):
    record = workspace._get(KIND, identifier(case_id))
    proposed = preview(workspace, record["selection"])
    if proposed["profile_preview"]["id"] != record["profile_set_id"] or canonical(proposed["cases"]) != canonical(record["cases"]):
        raise ValueError("The retained management design differs from its original profile and source choices")
    state = read_json(workspace.root / "sourced-profiles" / record["profile_set_id"] / "state.json")
    if state.get("state") != "complete" or canonical(state["profiles"]) != canonical(record["profiles"]):
        raise ValueError("The original management profiles are incomplete or differ")
    for row in record["profiles"]:
        profile, entry, table = sourced._base(workspace, row["profile_id"])
        if entry["body"]["sha256"] != row["biophysical_sha256"]:
            raise ValueError("A management profile no longer matches its retained source table")
    return record


def prepare_experiment(workspace, value):
    value = _object(value, ("case_id", "baseline_run_id", "scenario_ids", "source_run_ids"),
                    "Management native experiment")
    record = inspect(workspace, value.get("case_id"))
    baseline = workspace.inspect_run(identifier(value.get("baseline_run_id")))
    if baseline["selection"]["profile_id"] != record["baseline_profile_id"]:
        raise ValueError("Choose the original profile's native baseline run")
    from . import experiments
    selection = {
        "title": record["selection"]["title"],
        "reason": record["selection"]["reason"] + " Retained management design: " + record["id"],
        "baseline_run_id": baseline["id"], "scenario_ids": value.get("scenario_ids", []),
        "profile_ids": record["profile_ids"], "design": "factorial", "axes": [],
    }
    if value.get("source_run_ids"):
        selection["source_run_ids"] = value["source_run_ids"]
    return experiments.prepare(workspace, selection)


def main(argv=None):
    import argparse
    from .workspace import Workspace
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--workspace", type=Path, required=True)
    commands = parser.add_subparsers(dest="command", required=True)
    catalog_parser = commands.add_parser("catalog")
    catalog_parser.add_argument("--profile", required=True)
    for command in ("preview", "prepare", "prepare-experiment"):
        sub = commands.add_parser(command)
        sub.add_argument("--selection", type=Path, required=True)
    inspected = commands.add_parser("inspect")
    inspected.add_argument("--case", required=True)
    args = parser.parse_args(argv)
    workspace = Workspace(args.workspace)
    if args.command == "catalog":
        result = catalog(workspace, args.profile)
    elif args.command == "inspect":
        result = inspect(workspace, args.case)
    else:
        result = {"preview": preview, "prepare": prepare,
                  "prepare-experiment": prepare_experiment}[args.command](workspace, read_json(args.selection))
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
